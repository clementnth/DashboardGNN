/**
 * app.js — Slim Orchestrator
 * ===========================
 * Hanya bertugas:
 *   1. Bootstrap: health check → fetch data → init map
 *   2. Wire up StateManager listeners
 *   3. Delegasi semua logic ke modul spesialisnya
 *
 * TIDAK ada logika bisnis atau DOM manipulation langsung di sini.
 */

import StateManager from './modules/stateManager.js';

// Modules
import { healthCheck, fetchAllResults, loadGeoJSON, joinDataToGeoJSON, fetchPrediction } from './modules/api.js';
import { initMap, renderChoropleth, switchLayer, highlightProvince } from './modules/mapEngine.js';
import { renderActualVsPred, renderResidual } from './modules/chartEngine.js';
import {
  showLoader, showError,
  initViewSwitcher,
  renderMetricCards, renderProvinceList, highlightListItem,
  renderSidebarDetail, resetSidebar,
  populatePredictDropdown, initSliders,
  renderPredictResult,
  downloadPDF, downloadExcel,
} from './modules/uiController.js';

// ===================================================================
// Bootstrap
// ===================================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.info('[APP] Bootstrap start ...');

  // ── 1. Health Check ──
  showLoader(true, 'Memeriksa koneksi ke backend ...');
  const health = await healthCheck();
  if (!health.ok) {
    showError(
      'Backend tidak tersedia',
      `Pastikan server FastAPI sudah berjalan:<br>
       <code style="display:block;margin-top:8px;padding:8px;background:#0F172A;color:#7DD3FC;border-radius:6px">
         cd backend &amp;&amp; python main.py
       </code>
       <small style="opacity:.7">${health.message || ''}</small>`
    );
    return;
  }
  console.info('[APP] Backend OK →', health.model_config);

  // ── 2. Fetch Data ──
  showLoader(true, 'Mengunduh data prediksi (34 provinsi) ...');
  let apiData, geojson;
  try {
    [apiData, geojson] = await Promise.all([
      fetchAllResults(),
      loadGeoJSON(),
    ]);
  } catch (err) {
    showError('Gagal memuat data', err.message);
    return;
  }

  // Gabungkan ke GeoJSON
  showLoader(true, 'Menggabungkan data ke peta ...');
  const joinedGeoJSON = joinDataToGeoJSON(geojson, apiData);

  // Simpan ke state
  StateManager.set('globalData', apiData);
  StateManager.set('geojson',    joinedGeoJSON);

  // ── 3. Init Map ──
  showLoader(true, 'Merender peta ...');
  initMap('map-container');
  renderChoropleth(joinedGeoJSON);

  // ── 4. Render Macro Charts (right sidebar) ──
  renderActualVsPred('chart-avp',      apiData);
  renderResidual('chart-residual', apiData);

  // ── 5. Render Metric Cards ──
  renderMetricCards(apiData);

  // ── 6. Init UI Components ──
  initViewSwitcher();
  renderProvinceList(apiData, (prov) => StateManager.set('selectedProvince', prov));
  populatePredictDropdown(apiData);
  initSliders();
  _bindPredictForm(apiData);
  _bindDownloadButtons(apiData);

  // ── 7. StateManager Listeners ──
  _wireStateListeners(apiData);

  // ── 8. Done ──
  showLoader(false);
  StateManager.set('isReady', true);
  console.info('[APP] Ready ✓');
});

// ===================================================================
// Wire StateManager Listeners
// ===================================================================
function _wireStateListeners(allData) {
  // Provinsi diklik (dari peta atau list)
  StateManager.on('selectedProvince', (prov) => {
    if (!prov) { resetSidebar(); return; }

    // Update sidebar detail
    renderSidebarDetail(prov, allData);
    highlightListItem(prov.provinsi);

    // Highlight di peta
    highlightProvince(prov.provinsi);

    // Highlight chart scatter
    renderActualVsPred('chart-avp', allData, prov.provinsi);

    // Auto-switch ke tab detail di sidebar kanan
    _activateSidebarTab('detail');

    // Auto-fill form prediksi (hanya update, tidak switch view)
    _syncPredictForm(prov, allData);
  });
}

function _activateSidebarTab(tabId) {
  const btn = document.getElementById(`tab-btn-${tabId}`);
  if (btn) btn.click();
}

// ===================================================================
// Prediksi Form
// ===================================================================
function _syncPredictForm(prov, allData) {
  const idx = allData.findIndex(d => d.provinsi === prov.provinsi);
  _setVal('f-prov-idx',  idx);
  _setVal('f-prov-select', idx);
  _setSlider('f-rain',   prov.curah_hujan,  'lv-rain',   false);
  _setSlider('f-suhu',   prov.suhu_minimum, 'lv-suhu',   true);
  _setSlider('f-lembab', prov.kelembaban,   'lv-lembab', true);
  _setSlider('f-ntp',    prov.ntp,          'lv-ntp',    true);
  _setSlider('f-sun',    prov.penyinaran,   'lv-sun',    true);
}

function _bindPredictForm(allData) {
  const form = document.getElementById('predict-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;

    document.getElementById('predict-loader')?.classList.remove('d-none');
    document.getElementById('predict-empty')?.classList.add('d-none');
    document.getElementById('predict-result')?.classList.add('d-none');

    try {
      const payload = {
        province_index:     parseInt(_getVal('f-prov-idx') || 0),
        jumlah_curah_hujan: parseFloat(_getVal('f-rain')),
        suhu_minimum:       parseFloat(_getVal('f-suhu')),
        kelembaban_avg:     parseFloat(_getVal('f-lembab')),
        nilai_tukar_petani: parseFloat(_getVal('f-ntp')),
        penyinaran:         parseFloat(_getVal('f-sun')),
        mc_samples:         parseInt(_getVal('f-mc') || 1000),
      };
      const result = await fetchPrediction(payload);
      renderPredictResult(result);
    } catch (err) {
      document.getElementById('predict-loader')?.classList.add('d-none');
      alert(`Prediksi gagal: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ===================================================================
// Download Buttons
// ===================================================================
function _bindDownloadButtons(allData) {
  document.getElementById('btn-dl-pdf')?.addEventListener('click', () => downloadPDF(allData));
  document.getElementById('btn-dl-excel')?.addEventListener('click', () => downloadExcel(allData));
}

// ===================================================================
// Micro-helpers (hanya dipakai di app.js)
// ===================================================================
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _getVal(id) {
  return document.getElementById(id)?.value ?? '';
}

function _setSlider(inputId, val, labelId, decimal = true) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (input) input.value = val;
  if (label) label.textContent = decimal
    ? Number(val).toFixed(1)
    : Number(val).toLocaleString('id-ID');
}