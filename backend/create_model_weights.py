"""
Generate dummy model_weights.pth untuk testing backend.
File ini membuat checkpoint PyTorch yang valid dengan arsitektur GNN.
"""
import torch
from pathlib import Path
from gnn_core import BayesianSpatialGNN

def create_dummy_weights(output_path: str = "model_weights.pth"):
    print("[*] Creating BayesianSpatialGNN model...")
    
    # Inisialisasi model dengan arsitektur yang sama di gnn_core.py
    model = BayesianSpatialGNN(
        in_features=5,
        hidden_dim=64,
        dropout_p=0.1,
        activation_type="leaky_relu",
    )
    
    model.eval()
    
    # Buat checkpoint
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "in_features": 5,
        "hidden_dim": 64,
        "dropout_p": 0.1,
        "activation_type": "leaky_relu",
        "metadata": {
            "status": "DUMMY_FOR_TESTING",
            "note": "Replace dengan trained model untuk production"
        }
    }
    
    torch.save(checkpoint, output_path)
    file_size = Path(output_path).stat().st_size / 1024
    print(f"[✓] Model saved to {output_path}")
    print(f"[✓] File size: {file_size:.2f} KB")
    print(f"\n⚠️  WARNING: Ini adalah DUMMY model untuk testing saja.")
    print(f"    Prediksi TIDAK AKURAT. Gunakan model terlatih untuk production.")

if __name__ == "__main__":
    create_dummy_weights()
    print("\n✅ Done! Sekarang Anda bisa jalankan: python3 main.py")