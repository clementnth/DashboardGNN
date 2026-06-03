"""
Bayesian Spatial GNN Core — Model Architecture + Inference
============================================================
Memuat bobot terlatih dari .pth dan menjalankan Monte Carlo Dropout
untuk memberikan distribusi posterior prediksi.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import pandas as pd
from sklearn.neighbors import kneighbors_graph
from sklearn.preprocessing import StandardScaler, PowerTransformer
from sklearn.metrics import r2_score, mean_absolute_error
from typing import List, Dict, Tuple
import logging

logger = logging.getLogger(__name__)


# ===================================================================
# GNN Architecture (sama dengan training setup)
# ===================================================================
class SimpleGCNLayer(nn.Module):
    """Graph Convolutional Layer sederhana"""
    def __init__(self, in_features: int, out_features: int):
        super(SimpleGCNLayer, self).__init__()
        self.linear = nn.Linear(in_features, out_features)

    def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
        """Forward: A @ W @ x"""
        return torch.mm(adj, self.linear(x))


class BayesianSpatialGNN(nn.Module):
    """
    Bayesian Spatial GNN dengan MC Dropout untuk epistemic uncertainty
    
    Args:
        in_features: Jumlah variabel input (X1-X5 = 5)
        hidden_dim: Dimensi hidden layer (optimal = 64)
        dropout_p: Dropout probability (optimal = 0.10)
        activation_type: 'relu', 'leaky_relu', atau 'elu' (optimal = 'leaky_relu')
    """
    def __init__(
        self,
        in_features: int,
        hidden_dim: int,
        dropout_p: float = 0.1,
        activation_type: str = "leaky_relu",
    ):
        super(BayesianSpatialGNN, self).__init__()
        self.gcn1 = SimpleGCNLayer(in_features, hidden_dim)
        self.dropout = nn.Dropout(p=dropout_p)
        self.gcn2 = SimpleGCNLayer(hidden_dim, 1)
        self.activation_type = activation_type

    def forward(
        self,
        x: torch.Tensor,
        adj: torch.Tensor,
        mc_inference: bool = False,
    ) -> torch.Tensor:
        """
        Forward pass dengan optional MC Dropout.
        
        Args:
            x: Feature matrix [N, 5]
            adj: Adjacency matrix [N, N] yang sudah dinormalisasi
            mc_inference: Jika True, aktifkan dropout bahkan saat eval mode
        
        Returns:
            Prediksi [N, 1]
        """
        # GCN layer 1 + Aktivasi non-linear
        x = self.gcn1(x, adj)
        
        if self.activation_type == "relu":
            x = F.relu(x)
        elif self.activation_type == "leaky_relu":
            x = F.leaky_relu(x, negative_slope=0.01)
        elif self.activation_type == "elu":
            x = F.elu(x)
        else:
            x = F.relu(x)
        
        # Dropout layer (untuk Bayesian inference)
        if mc_inference:
            # Force dropout aktif meski di eval mode
            x = F.dropout(x, p=self.dropout.p, training=True)
        else:
            # Dropout normal
            x = self.dropout(x)
        
        # GCN layer 2 → output scalar per node
        return self.gcn2(x, adj)


# ===================================================================
# Utility: Normalisasi adjacency matrix
# ===================================================================
def normalize_adjacency(A: np.ndarray) -> torch.Tensor:
    """
    Normalisasi adjacency matrix: Â = D^(-1/2) @ A @ D^(-1/2)
    
    Args:
        A: Adjacency matrix [N, N]
    
    Returns:
        Normalized adjacency tensor [N, N]
    """
    A_hat = A + np.eye(A.shape[0])  # Add self-loops
    D = np.array(np.sum(A_hat, axis=1)).flatten()
    D_inv_sqrt = np.power(D, -0.5, where=(D > 0), dtype=np.float32)
    D_inv_sqrt[D == 0] = 0.0
    D_mat = np.diag(D_inv_sqrt)
    
    normalized = D_mat @ A_hat @ D_mat
    return torch.tensor(normalized, dtype=torch.float32)


# ===================================================================
# GNN Manager (Encapsulation untuk load model + inference)
# ===================================================================
class GNNInferenceEngine:
    """
    Engine untuk memuat model pre-trained dan menjalankan inference + MC Bayesian.
    Dimuat SEKALI SAJA di startup FastAPI.
    """
    
    @staticmethod
    def _parse_numeric_column(series: pd.Series) -> pd.Series:
        cleaned = (
            series.astype(str)
                  .str.strip()
                  .str.replace(r"\.", "", regex=True)
                  .str.replace(",", ".", regex=False)
                  .replace(r"^nan$", "", regex=True)
        )
        return pd.to_numeric(cleaned, errors="coerce")

    def __init__(
        self,
        model_weights_path: str,
        csv_data_path: str,
        device: str = "cpu",
        k_neighbors: int = 8,
        hidden_dim: int = 64,
        dropout_p: float = 0.1,
        activation_type: str = "leaky_relu",
    ):
        """
        Inisialisasi engine.
        
        Args:
            model_weights_path: Path ke .pth file
            csv_data_path: Path ke CSV dengan kolom:
                          [Provinsi, Longitude, Latitude, 
                           Jumlah_Curah_Hujan, Suhu_Minimum, Kelembaban_avg, 
                           Nilai_Tukar_Petani, Penyinaran, Produktivitas]
            device: 'cpu' atau 'cuda'
            k_neighbors: K untuk KNN-graph
            hidden_dim: Hidden dimension GNN
            dropout_p: Dropout probability
            activation_type: Tipe aktivasi
        """
        self.device = torch.device(device)
        self.k_neighbors = k_neighbors
        
        # 1. Load CSV data
        logger.info(f"Loading CSV data from {csv_data_path} ...")
        self.df = pd.read_csv(
            csv_data_path,
            sep=";",
            decimal=",",
            thousands=".",
            encoding="utf-8",
            skipinitialspace=True,
            engine="python",
        )

        # Buang kolom kosong akibat trailing ';'
        self.df = self.df.loc[:, ~self.df.columns.str.match(r"^Unnamed")]
        self.df = self.df.dropna(axis=1, how="all")

        self.df.columns = (
            self.df.columns.astype(str)
                .str.strip()
                .str.lower()
                .str.replace(r"[\s/]+", "_", regex=True)
                .str.replace(r"[^a-z0-9_]+", "", regex=True)
        )

        numeric_cols = [
            "longitude",
            "latitude",
            "jumlah_curah_hujan",
            "suhu_minimum",
            "kelembaban_avg",
            "nilai_tukar_petani",
            "penyinaran",
            "produktivitas",
        ]
        for col in numeric_cols:
            self.df[col] = pd.to_numeric(self.df[col], errors="coerce")

        na_counts = self.df[numeric_cols].isna().sum()
        if na_counts.sum() > 0:
            raise ValueError(f"CSV numeric parsing failed, NaN counts: {na_counts.to_dict()}")

        self.provinces = self.df["provinsi"].astype(str).tolist()
        self.n_provinces = len(self.provinces)
        
        # 2. Ekstrak koordinat untuk KNN graph
        coords = self.df[["longitude", "latitude"]].values.astype(np.float32)
        
        # 3. Bangun adjacency matrix (KNN graph)
        logger.info(f"Building KNN graph (K={k_neighbors}) ...")
        A = kneighbors_graph(coords, n_neighbors=k_neighbors, mode="connectivity", include_self=False).toarray()
        self.adj_normalized = normalize_adjacency(A).to(self.device)
        
        # 4. Load feature transformers dan inisialisasi model
        feature_cols = [
            "jumlah_curah_hujan",
            "suhu_minimum",
            "kelembaban_avg",
            "nilai_tukar_petani",
            "penyinaran",
        ]
        target_col = "produktivitas"
        
        logger.info("Fitting PowerTransformer for features ...")
        self.scaler_X = PowerTransformer(method="yeo-johnson")
        X_scaled = self.scaler_X.fit_transform(self.df[feature_cols])
        
        logger.info("Fitting StandardScaler for target ...")
        self.scaler_Y = StandardScaler()
        Y_scaled = self.scaler_Y.fit_transform(self.df[[target_col]])
        
        self.X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)
        self.Y_tensor = torch.tensor(Y_scaled, dtype=torch.float32).to(self.device)
        
        # 5. Inisialisasi model dan load weights
        logger.info(f"Initializing BayesianSpatialGNN (hidden_dim={hidden_dim}) ...")
        self.model = BayesianSpatialGNN(
            in_features=5,
            hidden_dim=hidden_dim,
            dropout_p=dropout_p,
            activation_type=activation_type,
        ).to(self.device)
        
        logger.info(f"Loading model weights from {model_weights_path} ...")
        checkpoint = torch.load(model_weights_path, map_location=self.device, weights_only=False)  # noqa: S614 — trusted local file
        if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
            self.model.load_state_dict(checkpoint["model_state_dict"])
        else:
            self.model.load_state_dict(checkpoint)
        
        self.model.eval()
        
        # 6. Hitung metrik in-sample (untuk reference)
        with torch.no_grad():
            out = self.model(self.X_tensor, self.adj_normalized, mc_inference=False)
            y_pred_scaled = out.cpu().numpy()
            y_actual = self.df[target_col].values.reshape(-1, 1)
            y_pred_actual = self.scaler_Y.inverse_transform(y_pred_scaled)
            
            self.r2_insample = r2_score(y_actual, y_pred_actual)
            self.mae_insample = mean_absolute_error(y_actual, y_pred_actual)
        
        logger.info(f"✓ GNN Engine ready. R²={self.r2_insample:.4f}, MAE={self.mae_insample:.4f}")
    
    def get_province_index(self, province_name: str) -> int:
        """Dapatkan index provinsi dari nama"""
        try:
            return self.provinces.index(province_name)
        except ValueError:
            raise ValueError(f"Provinsi '{province_name}' tidak ditemukan. Gunakan: {self.provinces}")
    
    def inference_deterministic(self) -> List[Dict]:
        """
        Jalankan inference deterministic untuk semua provinsi.
        """
        results = []
        with torch.no_grad():
            out = self.model(self.X_tensor, self.adj_normalized, mc_inference=False)
            y_pred_scaled = out.cpu().numpy()
            y_pred_actual = self.scaler_Y.inverse_transform(y_pred_scaled)
        
        for i in range(self.n_provinces):
            results.append({
                "provinsi": self.df.iloc[i]["provinsi"],
                "produktivitas_aktual": float(self.df.iloc[i]["produktivitas"]),
                "prediksi_mean": float(y_pred_actual[i, 0]),
            })
        
        return results
    
    def inference_mc_dropout(
        self,
        province_idx: int,
        n_samples: int = 1000,
        custom_features: Optional[Dict[str, float]] = None,
    ) -> Dict[str, any]:
        """
        Monte Carlo Dropout inference untuk satu provinsi.
        Menjalankan forward pass 1000x dengan dropout aktif untuk estimasi posterior.
        
        Args:
            province_idx: Index provinsi (0-33)
            n_samples: Jumlah MC samples
        
        Returns:
            {
                'provinsi': str,
                'prediksi_mean': float,
                'uncertainty_std': float,
                'five_number_summary': {min, q1, median, q3, max},
                'interval_1sigma': {lower, upper},
                'semua_prediksi_mc': [float, ...],
            }
        """
        # Use a cloned tensor if there are custom features
        X_input = self.X_tensor
        if custom_features:
            X_input = self.X_tensor.clone()
            row_data = self.df.iloc[province_idx].copy()
            for k, v in custom_features.items():
                if k in row_data.index:
                    row_data[k] = v
            
            feature_cols = [
                "jumlah_curah_hujan",
                "suhu_minimum",
                "kelembaban_avg",
                "nilai_tukar_petani",
                "penyinaran",
            ]
            new_features_df = pd.DataFrame([row_data[feature_cols].values], columns=feature_cols)
            new_features_scaled = self.scaler_X.transform(new_features_df)
            X_input[province_idx] = torch.tensor(new_features_scaled[0], dtype=torch.float32).to(self.device)

        predictions_scaled = []
        
        # MC Dropout: run forward 1000x dengan dropout aktif
        with torch.no_grad():
            for _ in range(n_samples):
                out_scaled = self.model(X_input, self.adj_normalized, mc_inference=True)
                pred_prov = out_scaled[province_idx, 0].item()
                predictions_scaled.append(pred_prov)
        
        predictions_scaled = np.array(predictions_scaled)
        
        # Transform balik ke satuan asli (Ton/Ha)
        predictions_actual = (predictions_scaled * self.scaler_Y.scale_[0]) + self.scaler_Y.mean_[0]
        
        # Hitung statistik
        mean_pred = predictions_actual.mean()
        std_pred = predictions_actual.std()
        sorted_preds = np.sort(predictions_actual)
        
        fns = {
            "min": float(sorted_preds[0]),
            "q1": float(np.percentile(sorted_preds, 25)),
            "median": float(np.percentile(sorted_preds, 50)),
            "q3": float(np.percentile(sorted_preds, 75)),
            "max": float(sorted_preds[-1]),
        }
        fns["iqr"] = fns["q3"] - fns["q1"]
        
        return {
            "provinsi": self.provinces[province_idx],
            "prediksi_mean": float(mean_pred),
            "uncertainty_std": float(std_pred),
            "five_number_summary": fns,
            "interval_1sigma": {
                "lower": float(max(0, mean_pred - std_pred)),
                "upper": float(mean_pred + std_pred),
            },
            "semua_prediksi_mc": [float(x) for x in predictions_actual.tolist()],
        }
    
    def get_model_config(self) -> Dict[str, any]:
        """Return konfigurasi model untuk dashboard info"""
        return {
            "K": self.k_neighbors,
            "hidden_dim": 64,
            "activation": "leaky_relu",
            "dropout": 0.1,
            "weight_decay": 1e-4,
            "learning_rate": 0.01,
            "train_epochs": 5000,
            "mc_samples": 1000,
            "r2_insample": float(self.r2_insample),
            "mae_insample": float(self.mae_insample),
        }