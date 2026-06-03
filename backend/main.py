"""
WebGIS Kopi — FastAPI Backend
=============================
Decoupled architecture: Backend = ML Engine, Frontend = UI Layer
"""

import logging
from contextlib import asynccontextmanager
from typing import List, Dict, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import torch

from gnn_core import GNNInferenceEngine

# ===================================================================
# Logging Setup
# ===================================================================
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ===================================================================
# Global State (Loaded at startup, reused for all requests)
# ===================================================================
_gnn_engine: Optional[GNNInferenceEngine] = None
_all_results_cache: List[Dict] = []


# ===================================================================
# Startup / Shutdown Lifecycle
# ===================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager untuk FastAPI 0.93+
    Memastikan model hanya di-load SEKALI SAJA saat startup.
    """
    global _gnn_engine, _all_results_cache
    
    # STARTUP
    logger.info("🚀 Initializing GNNInferenceEngine ...")
    try:
        # Tentukan path ke model dan data
        # (Sesuaikan dengan struktur folder Anda)
        base_dir = Path(__file__).parent
        model_path = base_dir / "model_weights.pth"
        csv_path = base_dir / "Dataset_Produksi_Kopi_2024.csv"
        
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        if not csv_path.exists():
            raise FileNotFoundError(f"CSV file not found: {csv_path}")
        
        # Tentukan device (GPU jika tersedia)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")
        
        # Inisialisasi engine (memuat model + data)
        _gnn_engine = GNNInferenceEngine(
            model_weights_path=str(model_path),
            csv_data_path=str(csv_path),
            device=device,
            k_neighbors=8,
            hidden_dim=64,
            dropout_p=0.1,
            activation_type="leaky_relu",
        )
        
        # Pre-compute uncertainty untuk semua provinsi di startup
        logger.info("Computing initial uncertainty cache (100 samples)...")
        results_det = _gnn_engine.inference_deterministic()
        _all_results_cache = []
        for i, det in enumerate(results_det):
            row = _gnn_engine.df.iloc[i]
            mc_res = _gnn_engine.inference_mc_dropout(province_idx=i, n_samples=100)
            _all_results_cache.append({
                "provinsi": det["provinsi"],
                "produktivitas_aktual": float(row["produktivitas"]),
                "prediksi_mean": det["prediksi_mean"],
                "curah_hujan": float(row["jumlah_curah_hujan"]),
                "suhu_minimum": float(row["suhu_minimum"]),
                "kelembaban": float(row["kelembaban_avg"]),
                "penyinaran": float(row["penyinaran"]),
                "ntp": float(row["nilai_tukar_petani"]),
                "uncertainty_std": float(mc_res["uncertainty_std"]),
            })
        
        logger.info("✓ GNN Engine initialized and cache built successfully")
    except Exception as e:
        logger.error(f"✗ Failed to initialize GNN Engine: {e}")
        raise
    
    yield  # App runs here
    
    # SHUTDOWN
    logger.info("🛑 Shutting down ...")
    if _gnn_engine:
        del _gnn_engine
    logger.info("✓ Goodbye")


# ===================================================================
# FastAPI Application
# ===================================================================
app = FastAPI(
    title="WebGIS Produktivitas Kopi Indonesia",
    description="Bayesian Spatial GNN Backend API",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===================================================================
# Health Check Endpoint
# ===================================================================
@app.get("/api/health")
async def health_check():
    """
    Health check endpoint untuk memverifikasi backend siap.
    Frontend akan cek ini terlebih dahulu sebelum fetch data.
    """
    if _gnn_engine is None:
        return JSONResponse(
            {"ok": False, "message": "GNN Engine not initialized"},
            status_code=503,
        )
    
    return {
        "ok": True,
        "message": "Backend API is running",
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "model_config": _gnn_engine.get_model_config(),
    }


# ===================================================================
# Data Endpoint: Semua hasil prediksi 34 provinsi + statistik
# ===================================================================
@app.get("/api/results", response_model=List[Dict])
async def get_all_results():
    """
    GET /api/results
    
    Return semua hasil prediksi deterministic + precomputed uncertainty.
    """
    if _gnn_engine is None:
        raise HTTPException(status_code=503, detail="GNN Engine not initialized")
    
    return _all_results_cache


# ===================================================================
# Prediction Endpoint: What-If Skenario dengan MC Dropout
# ===================================================================
@app.post("/api/predict")
async def predict_scenario(
    payload: Dict = Body(...)
):
    """
    POST /api/predict
    
    Input: JSON Body dengan field:
      - province_index (int)
      - jumlah_curah_hujan (float)
      - suhu_minimum (float)
      - kelembaban_avg (float)
      - nilai_tukar_petani (float)
      - penyinaran (float)
      - mc_samples (int, default=1000)
    """
    if _gnn_engine is None:
        raise HTTPException(status_code=503, detail="GNN Engine not initialized")
    
    try:
        # Extract parameters from body
        province_index = payload["province_index"]
        # Extract what-if features
        custom_features = {
            "jumlah_curah_hujan": payload.get("jumlah_curah_hujan"),
            "suhu_minimum": payload.get("suhu_minimum"),
            "kelembaban_avg": payload.get("kelembaban_avg"),
            "nilai_tukar_petani": payload.get("nilai_tukar_petani"),
            "penyinaran": payload.get("penyinaran"),
        }
        # Hapus nilai None agar tidak me-replace dengan None
        custom_features = {k: v for k, v in custom_features.items() if v is not None}
        
        # Validasi index
        if not (0 <= province_index < _gnn_engine.n_provinces):
            raise ValueError(
                f"province_index harus antara 0-{_gnn_engine.n_provinces - 1}"
            )
        
        # Jalankan MC inference
        result = _gnn_engine.inference_mc_dropout(
            province_idx=province_index,
            n_samples=payload.get("mc_samples", 1000),
            custom_features=custom_features,
        )
        
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in /api/predict: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================================================================
# Root Endpoint (untuk debugging)
# ===================================================================
@app.get("/")
async def root():
    return {
        "message": "WebGIS Produktivitas Kopi Indonesia",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/health",
        "endpoints": {
            "GET /api/results": "Dapatkan semua hasil prediksi 34 provinsi",
            "POST /api/predict": "Prediksi what-if dengan Monte Carlo Dropout",
        },
    }


# ===================================================================
# Main
# ===================================================================
if __name__ == "__main__":
    # Development server
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )