/**
 * api.js — Data Fetching Layer
 * =============================
 * Semua komunikasi dengan backend FastAPI ada di sini.
 * Tidak ada logika UI — hanya fetch + error handling.
 * Notifikasi loading state ke StateManager.
 */

import { API_BASE_URL, GEOJSON_URL } from './config.js';
import { normalizeProvinceName } from './config.js';
import StateManager from './stateManager.js';

// ===================================================================
// Health Check
// ===================================================================
/**
 * Cek apakah backend siap.
 * @returns {{ ok: boolean, message: string, model_config?: object }}
 */
export async function healthCheck() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return res.json();
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// ===================================================================
// Fetch All Results (34 provinsi)
// ===================================================================
/**
 * Ambil semua hasil prediksi termasuk uncertainty nyata.
 * @returns {Array<Object>} array data semua provinsi
 * @throws {Error} jika request gagal
 */
export async function fetchAllResults() {
  const res = await fetch(`${API_BASE_URL}/api/results`);
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`[API] /results gagal (HTTP ${res.status}): ${text}`);
  }
  return res.json();
}

// ===================================================================
// Fetch Prediction (MC Dropout — JSON Body)
// ===================================================================
/**
 * Kirim permintaan prediksi what-if ke backend.
 * Menggunakan JSON body (bukan query string).
 *
 * @param {{
 *   province_index: number,
 *   jumlah_curah_hujan: number,
 *   suhu_minimum: number,
 *   kelembaban_avg: number,
 *   nilai_tukar_petani: number,
 *   penyinaran: number,
 *   mc_samples: number,
 * }} payload
 * @returns {Object} hasil distribusi posterior dari backend
 */
export async function fetchPrediction(payload) {
  StateManager.set('isLoading', true);
  try {
    const res = await fetch(`${API_BASE_URL}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(errData.detail || `HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    StateManager.set('isLoading', false);
  }
}

// ===================================================================
// Load GeoJSON
// ===================================================================
/**
 * Muat GeoJSON lokal.
 * @returns {Object} GeoJSON FeatureCollection
 */
export async function loadGeoJSON() {
  const res = await fetch(GEOJSON_URL);
  if (!res.ok) throw new Error(`[API] GeoJSON gagal dimuat: HTTP ${res.status}`);
  return res.json();
}

// ===================================================================
// Join Data ke GeoJSON
// ===================================================================
/**
 * Gabungkan data provinsi dari API ke features GeoJSON berdasarkan
 * nama provinsi yang sudah dinormalisasi.
 *
 * GeoJSON Indonesia biasanya menyimpan nama di salah satu dari:
 *   properties.NAME_1, properties.PROVINSI, properties.nama, properties.Name
 *
 * @param {Object} geojson - GeoJSON asli
 * @param {Array}  data    - array dari /api/results
 * @returns {Object} GeoJSON dengan properties diperkaya
 */
export function joinDataToGeoJSON(geojson, data) {
  // Buat lookup map: normalized_name → data
  const lookup = new Map();
  data.forEach(item => {
    lookup.set(normalizeProvinceName(item.provinsi), item);
  });

  let matched = 0;
  const features = geojson.features.map(feature => {
    const props = feature.properties || {};

    // Coba berbagai field nama dari GeoJSON (urutan prioritas)
    const rawName = (
      props.Propinsi ||
      props.NAME_1 ||
      props.PROVINSI ||
      props.nama ||
      props.Name ||
      props.name ||
      ''
    );
    const normalizedKey = normalizeProvinceName(rawName);
    const match = lookup.get(normalizedKey);

    if (match) matched++;

    return {
      ...feature,
      properties: {
        ...props,
        ...(match || {}),
        __province_key: normalizedKey,
        __has_data: !!match,
      },
    };
  });

  console.info(`[API] GeoJSON join: ${matched}/${features.length} features matched`);
  if (matched < data.length) {
    console.warn('[API] Beberapa provinsi tidak ter-match. Cek normalizeProvinceName di config.js.');
  }

  return { ...geojson, features };
}