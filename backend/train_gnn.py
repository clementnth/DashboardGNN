"""
train.py — Bayesian Spatial GNN Training Script
Disesuaikan dengan algoritma & struktur dari notebook ipynb:
  - Arsitektur model inline (SimpleGCNLayer + BayesianSpatialGNN)
  - normalize_adj robust (handle D=0)
  - Hyperparameter: lr=0.01, weight_decay=1e-4
  - Monte Carlo Bayesian Inference (1000 simulasi)
  - Inverse-transform ke satuan asli sebelum disimpan
"""

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from pathlib import Path
from sklearn.neighbors import kneighbors_graph
from sklearn.preprocessing import PowerTransformer, StandardScaler
from sklearn.metrics import r2_score, mean_squared_error

# ─── PATH ────────────────────────────────────────────────────────────────────
DATA_PATH   = Path(__file__).parent / "Dataset_Produksi_Kopi_2024.csv"
OUTPUT_PATH = Path(__file__).parent / "model_weights.pth"

# ─── HYPERPARAMETER (dikunci dari hasil optimum ipynb) ────────────────────────
BEST_K      = 8
BEST_HD     = 64
DROPOUT_P   = 0.1
BEST_ACT    = "leaky_relu"
OPTIMAL_EPOCH = 5000
LR          = 0.01          # ← ipynb: 0.01  (bukan 1e-3)
WEIGHT_DECAY = 1e-4         # ← ipynb: 1e-4  (bukan 1e-5)
MC_SIMULATIONS = 1000


# ─── ARSITEKTUR MODEL (inline, konsisten dengan ipynb) ───────────────────────
class SimpleGCNLayer(nn.Module):
    """Graph Convolution: A_norm · (X · W)"""
    def __init__(self, in_features: int, out_features: int):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features)

    def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
        return torch.mm(adj, self.linear(x))


class BayesianSpatialGNN(nn.Module):
    """
    2-layer GCN dengan Bayesian approximation via MC Dropout.

    mc_inference=True  → dropout aktif saat eval (Monte Carlo sampling)
    mc_inference=False → dropout normal (training mode mengikuti self.training)
    """
    def __init__(
        self,
        in_features: int,
        hidden_dim: int,
        dropout_p: float = 0.1,
        activation_type: str = "leaky_relu",
    ):
        super().__init__()
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
        # Layer 1 + aktivasi
        h = self.gcn1(x, adj)
        if self.activation_type == "relu":
            h = F.relu(h)
        elif self.activation_type == "leaky_relu":
            h = F.leaky_relu(h)
        elif self.activation_type == "elu":
            h = F.elu(h)
        else:
            raise ValueError(f"Unknown activation: {self.activation_type}")

        # Bayesian dropout
        if mc_inference:
            # Paksa dropout aktif meski model dalam mode eval
            h = F.dropout(h, p=self.dropout.p, training=True)
        else:
            h = self.dropout(h)

        # Layer 2 (output)
        return self.gcn2(h, adj)


# ─── UTILITAS ─────────────────────────────────────────────────────────────────
def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.loc[:, ~df.columns.str.contains(r"^Unnamed", case=False)]
    df.columns = (
        df.columns.astype(str)
        .str.strip()
        .str.lower()
        .str.replace(r"[\s/]+", "_", regex=True)
        .str.replace(r"[^a-z0-9_]+", "", regex=True)
    )
    return df


def load_data():
    df = pd.read_csv(
        DATA_PATH,
        sep=";",
        decimal=",",
        thousands=".",
        encoding="utf-8",
        skipinitialspace=True,
        engine="python",
    )
    df = clean_columns(df)

    required = [
        "provinsi",
        "longitude",
        "latitude",
        "jumlah_curah_hujan",
        "suhu_minimum",
        "kelembaban_avg",
        "nilai_tukar_petani",
        "penyinaran",
        "produktivitas",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Kolom tidak ditemukan: {missing}")

    df = df.dropna(subset=required)

    feature_cols = [
        "jumlah_curah_hujan",
        "suhu_minimum",
        "kelembaban_avg",
        "nilai_tukar_petani",
        "penyinaran",
    ]
    X      = df[feature_cols].astype(float).to_numpy()
    y      = df[["produktivitas"]].astype(float).to_numpy()
    coords = df[["longitude", "latitude"]].astype(float).to_numpy()
    return df, X, y, coords


def normalize_adj(A: np.ndarray) -> torch.Tensor:
    """
    Symmetric normalization: D^{-0.5} (A + I) D^{-0.5}
    Robust terhadap baris tanpa tetangga (D=0).
    """
    A_hat = A + np.eye(A.shape[0])
    D = np.array(np.sum(A_hat, axis=1)).flatten()
    D_inv_sqrt = np.where(D > 0, np.power(D, -0.5), 0.0)
    D_mat = np.diag(D_inv_sqrt)
    A_norm = D_mat @ A_hat @ D_mat
    return torch.tensor(A_norm, dtype=torch.float32)


def build_adj(coords: np.ndarray, k_neighbors: int = 8) -> torch.Tensor:
    A = kneighbors_graph(
        coords,
        n_neighbors=k_neighbors,
        mode="connectivity",
        include_self=False,
    ).toarray()
    return normalize_adj(A)


# ─── TRAINING ─────────────────────────────────────────────────────────────────
def train():
    print("=" * 60)
    print("FASE 1: MEMUAT & PRA-PEMROSESAN DATA")
    print("=" * 60)

    df, X, y, coords = load_data()
    print(f"Jumlah sampel: {len(df)} provinsi")

    # Transformasi fitur (Yeo-Johnson mengatasi skewness ekstrem)
    tf_X = PowerTransformer(method="yeo-johnson")
    X_scaled = tf_X.fit_transform(X)

    # StandardScaler untuk target (distribusi mendekati normal)
    sc_Y = StandardScaler()
    y_scaled = sc_Y.fit_transform(y)

    print("Transformasi selesai: PowerTransformer (X) + StandardScaler (Y)")

    # ── Graf ketetanggaan ─────────────────────────────────────────────────────
    print(f"\nMembangun matriks adjacency (K={BEST_K} tetangga)...")
    adj_final = build_adj(coords, k_neighbors=BEST_K)

    X_tensor = torch.tensor(X_scaled, dtype=torch.float32)
    y_tensor = torch.tensor(y_scaled, dtype=torch.float32)

    # ── Model ─────────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("FASE 2: PELATIHAN MODEL FINAL")
    print("=" * 60)

    model = BayesianSpatialGNN(
        in_features=5,
        hidden_dim=BEST_HD,
        dropout_p=DROPOUT_P,
        activation_type=BEST_ACT,
    )
    optimizer = optim.Adam(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    criterion = nn.MSELoss()

    model.train()
    for epoch in range(1, OPTIMAL_EPOCH + 1):
        optimizer.zero_grad()
        out  = model(X_tensor, adj_final, mc_inference=False)
        loss = criterion(out, y_tensor)
        loss.backward()
        optimizer.step()

        if epoch % 500 == 0 or epoch == 1:
            print(f"  Epoch {epoch:>5}/{OPTIMAL_EPOCH}  loss={loss.item():.6f}")

    # ── Validasi deterministik in-sample ─────────────────────────────────────
    model.eval()
    with torch.no_grad():
        out_det = model(X_tensor, adj_final, mc_inference=False).numpy()

    r2_det = r2_score(y_scaled, out_det)
    print(f"\nValidasi Deterministik In-Sample R²: {r2_det:.4f}")

    # ── Monte Carlo Bayesian Inference ────────────────────────────────────────
    print("\n" + "=" * 60)
    print("FASE 3: BAYESIAN INFERENCE (MONTE CARLO DROPOUT)")
    print("=" * 60)
    print(f"Menjalankan {MC_SIMULATIONS} simulasi MC...")

    model.eval()
    predictions_list = []
    for _ in range(MC_SIMULATIONS):
        with torch.no_grad():
            pred = model(X_tensor, adj_final, mc_inference=True).numpy()
            predictions_list.append(pred)

    predictions_array = np.array(predictions_list)  # [MC, n, 1]

    # Statistik distribusi posterior
    mean_pred_scaled = predictions_array.mean(axis=0)   # [n, 1]
    std_pred_scaled  = predictions_array.std(axis=0)    # [n, 1]

    # Kembalikan ke satuan asli (Ton/Ha)
    mean_pred_asli = sc_Y.inverse_transform(mean_pred_scaled)
    std_pred_asli  = std_pred_scaled * sc_Y.scale_      # skalakan deviasi

    # ── Tabel hasil ──────────────────────────────────────────────────────────
    df_final = pd.DataFrame({
        "Provinsi":                  df["provinsi"].values,
        "Produktivitas_Aktual":      y.flatten(),
        "Prediksi_RataRata_GNN":     mean_pred_asli.flatten(),
        "Ketidakpastian_Bayesian_Std": std_pred_asli.flatten(),
    })
    df_final["Galat_Residual"] = (
        df_final["Produktivitas_Aktual"] - df_final["Prediksi_RataRata_GNN"]
    )

    print("\nSepuluh Baris Pertama Hasil Akhir:")
    print(df_final.head(10).to_string(index=False))

    # ── Metrik akhir (satuan asli) ────────────────────────────────────────────
    n  = len(df_final)
    p  = 5   # jumlah prediktor
    r2   = r2_score(df_final["Produktivitas_Aktual"], df_final["Prediksi_RataRata_GNN"])
    adj_r2 = 1 - ((1 - r2) * (n - 1) / (n - p - 1))
    rmse = np.sqrt(mean_squared_error(
        df_final["Produktivitas_Aktual"], df_final["Prediksi_RataRata_GNN"]
    ))

    print("\n" + "=" * 60)
    print("METRIK IN-SAMPLE FINAL")
    print(f"  R²              : {r2:.4f}")
    print(f"  Adjusted R²     : {adj_r2:.4f}")
    print(f"  RMSE (Ton/Ha)   : {rmse:.4f}")
    print("=" * 60)

    # ── Simpan model ──────────────────────────────────────────────────────────
    torch.save(
        {
            # Bobot model
            "model_state_dict":   model.state_dict(),
            # Arsitektur (untuk reconstruct saat inference)
            "in_features":        5,
            "hidden_dim":         BEST_HD,
            "dropout_p":          DROPOUT_P,
            "activation_type":    BEST_ACT,
            # Scaler (diperlukan untuk inverse-transform saat prediksi baru)
            "tf_X_mean_":         tf_X.lambdas_,   # Yeo-Johnson lambdas
            "sc_Y_mean_":         sc_Y.mean_,
            "sc_Y_scale_":        sc_Y.scale_,
            # Metadata
            "metadata": {
                "trained":       True,
                "epochs":        OPTIMAL_EPOCH,
                "k_neighbors":   BEST_K,
                "mc_simulations": MC_SIMULATIONS,
                "lr":            LR,
                "weight_decay":  WEIGHT_DECAY,
                "final_r2":      float(r2),
                "final_rmse":    float(rmse),
            },
        },
        OUTPUT_PATH,
    )
    print(f"\nModel tersimpan → {OUTPUT_PATH}")


if __name__ == "__main__":
    train()