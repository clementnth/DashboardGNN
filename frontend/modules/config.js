/**
 * config.js — Konfigurasi Global & Design Tokens
 * ================================================
 */

// ===================================================================
// API & Data URLs
// ===================================================================
// export const API_BASE_URL = 'http://127.0.0.1:8000';
export const API_BASE_URL = 'https://clementnth-webgis-kopi-backend.hf.space';

export const GEOJSON_URL = './data/indonesia.geojson';

// ===================================================================
// Map Configuration
// ===================================================================
export const MAP_CENTER = [-2.5, 118.0];
export const MAP_ZOOM = 5;
export const MAP_MIN_ZOOM = 4;
export const MAP_MAX_ZOOM = 10;

// ===================================================================
// Layer Configuration — hanya Prediksi Mean
// ===================================================================
export const LAYER_CONFIG = {
  prediksi_mean: {
    title: 'Prediksi Produktivitas (Ton/Ha)',
    unit: 'Ton/Ha',
    min: 0.0,
    max: 1.1,
    colorFn: (t) => {
      const stops = [
        [255, 255, 229],
        [217, 240, 163],
        [120, 198, 121],
        [49, 163, 84],
        [0, 104, 55],
      ];
      const idx = t * (stops.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(stops.length - 1, lo + 1);
      const frac = idx - lo;
      const r = Math.round(stops[lo][0] + frac * (stops[hi][0] - stops[lo][0]));
      const g = Math.round(stops[lo][1] + frac * (stops[hi][1] - stops[lo][1]));
      const b = Math.round(stops[lo][2] + frac * (stops[hi][2] - stops[lo][2]));
      return `rgb(${r},${g},${b})`;
    },
    legendLabels: ['Rendah', '', 'Sedang', '', 'Tinggi'],
  },
};

// ===================================================================
// Kategori Produktivitas
// ===================================================================
export const CATEGORY_STYLE = {
  high: {
    label: 'Tinggi',
    emoji: '🟢',
    bg: '#DCFCE7',
    color: '#14532D',
    border: '#4ADE80',
    dot: '#22C55E',
  },
  medium: {
    label: 'Sedang',
    emoji: '🟡',
    bg: '#FEF9C3',
    color: '#713F12',
    border: '#EAB308',
    dot: '#F59E0B',
  },
  low: {
    label: 'Rendah',
    emoji: '🔴',
    bg: '#FEE2E2',
    color: '#7F1D1D',
    border: '#F87171',
    dot: '#EF4444',
  },
};

export function getCategory(value) {
  if (value >= 0.75) return 'high';
  if (value >= 0.55) return 'medium';
  return 'low';
}

// ===================================================================
// Province Name Normalization
// ===================================================================

/**
 * Peta EKSPLISIT dari nilai field `Propinsi` GeoJSON (uppercase) ke
 * nama provinsi dari API backend (Title Case).
 *
 * Diperlukan karena GeoJSON pakai konvensi berbeda:
 *   - "DI. ACEH"          → "Aceh"
 *   - "NUSATENGGARA BARAT"→ "Nusa Tenggara Barat"  (tanpa spasi)
 *   - "DAERAH ISTIMEWA YOGYAKARTA" → "D.I. Yogyakarta"
 */
const GEOJSON_TO_API = {
  // GeoJSON value (uppercase)    → API value
  'DI. ACEH': 'Aceh',
  'SUMATERA UTARA': 'Sumatera Utara',
  'SUMATERA BARAT': 'Sumatera Barat',
  'RIAU': 'Riau',
  'KEPULAUAN RIAU': 'Kepulauan Riau',
  'JAMBI': 'Jambi',
  'SUMATERA SELATAN': 'Sumatera Selatan',
  'BANGKA BELITUNG': 'Bangka Belitung',
  'BENGKULU': 'Bengkulu',
  'LAMPUNG': 'Lampung',
  'DKI JAKARTA': 'DKI Jakarta',
  'JAWA BARAT': 'Jawa Barat',
  'BANTEN': 'Banten',
  'JAWA TENGAH': 'Jawa Tengah',
  'DAERAH ISTIMEWA YOGYAKARTA': 'D.I. Yogyakarta',
  'JAWA TIMUR': 'Jawa Timur',
  'BALI': 'Bali',
  'NUSATENGGARA BARAT': 'Nusa Tenggara Barat',
  'NUSA TENGGARA TIMUR': 'Nusa Tenggara Timur',
  'KALIMANTAN BARAT': 'Kalimantan Barat',
  'KALIMANTAN TENGAH': 'Kalimantan Tengah',
  'KALIMANTAN SELATAN': 'Kalimantan Selatan',
  'KALIMANTAN TIMUR': 'Kalimantan Timur',
  'KALIMANTAN UTARA': 'Kalimantan Utara',
  'SULAWESI UTARA': 'Sulawesi Utara',
  'GORONTALO': 'Gorontalo',
  'SULAWESI TENGAH': 'Sulawesi Tengah',
  'SULAWESI BARAT': 'Sulawesi Barat',
  'SULAWESI SELATAN': 'Sulawesi Selatan',
  'SULAWESI TENGGARA': 'Sulawesi Tenggara',
  'MALUKU': 'Maluku',
  'MALUKU UTARA': 'Maluku Utara',
  'PAPUA BARAT': 'Papua Barat',
  'PAPUA': 'Papua',
};

/**
 * Normalisasi nama provinsi dari GeoJSON ke nama API.
 * Input bisa berupa raw value dari GeoJSON `Propinsi` field (uppercase).
 *
 * @param {string} name - nama provinsi (dari GeoJSON atau API)
 * @returns {string}    - nama ternormalisasi (sesuai API)
 */
export function normalizeProvinceName(name) {
  if (!name) return '';
  const upper = String(name).trim().toUpperCase();
  // Cek peta eksplisit dulu (untuk GeoJSON values)
  if (GEOJSON_TO_API[upper]) return GEOJSON_TO_API[upper];
  // Fallback: kembalikan as-is (untuk API values yang sudah Title Case)
  return String(name).trim();
}

/**
 * Urutan baku 34 Provinsi Indonesia (BPS resmi, Aceh sampai Papua).
 */
export const PROVINCE_ORDER = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau',
  'Jambi', 'Sumatera Selatan', 'Bangka Belitung', 'Bengkulu', 'Lampung',
  'DKI Jakarta', 'Jawa Barat', 'Banten', 'Jawa Tengah', 'D.I. Yogyakarta',
  'Jawa Timur', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan',
  'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat',
  'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua Barat', 'Papua',
];




/**
 * Batas geografis ketat Indonesia.
 * Mencegah user scroll jauh di luar wilayah.
 */
export const MAP_BOUNDS = {
  southWest: L => L.latLng(-11, 94),
  northEast: L => L.latLng(6.5, 142),
};


