/**
 * uiController.js — DOM, Sidebar, dan PDF Controller
 * =====================================================
 * Murni: manipulasi DOM, render sidebar, list provinsi, PDF generation.
 * Mendengarkan StateManager untuk react to state changes.
 * TIDAK langsung import mapEngine atau api — semua lewat StateManager.
 */

import StateManager from './stateManager.js';
import { getCategory, CATEGORY_STYLE, LAYER_CONFIG, PROVINCE_ORDER } from './config.js';
import { renderActualVsPred, renderResidual, renderProvinceDetail, renderMCHistogram } from './chartEngine.js';

// ===================================================================
// Loader Overlay
// ===================================================================
export function showLoader(show, msg = '') {
  const el = document.getElementById('overlay-loader');
  if (!el) return;
  el.classList.toggle('d-none', !show);
  const msgEl = document.getElementById('loader-msg');
  if (msgEl && msg) msgEl.textContent = msg;
}

export function showError(title, body) {
  const el = document.getElementById('overlay-error');
  if (!el) { alert(`${title}\n${body}`); return; }
  _setText('err-title', title);
  const bodyEl = document.getElementById('err-body');
  if (bodyEl) bodyEl.innerHTML = body;
  el.classList.remove('d-none');
  document.getElementById('overlay-loader')?.classList.add('d-none');
}

// ===================================================================
// View Switching
// ===================================================================
export function initViewSwitcher() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewId = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.app-view').forEach(v => v.classList.add('d-none'));
      document.getElementById(`view-${viewId}`)?.classList.remove('d-none');
      StateManager.set('activeView', viewId);
    });
  });
}


// ===================================================================
// Metric Cards — Five-Number Summary (Macro View)
// ===================================================================
export function renderMetricCards(data) {
  const means = data.map(d => d.prediksi_mean).sort((a, b) => a - b);
  const n = means.length;
  const fns = {
    min:    means[0],
    q1:     means[Math.floor(n * 0.25)],
    median: means[Math.floor(n * 0.5)],
    q3:     means[Math.floor(n * 0.75)],
    max:    means[n - 1],
  };

  // Count-up animation untuk setiap kartu
  animateCountUp('metric-min',    fns.min,    4);
  animateCountUp('metric-q1',     fns.q1,     4);
  animateCountUp('metric-median', fns.median, 4);
  animateCountUp('metric-q3',     fns.q3,     4);
  animateCountUp('metric-max',    fns.max,    4);

  // Isi juga Five-Number Summary panel di tab stat (sidebar kiri)
  _setText('fns-mean-min',    fns.min.toFixed(4));
  _setText('fns-mean-q1',     fns.q1.toFixed(4));
  _setText('fns-mean-median', fns.median.toFixed(4));
  _setText('fns-mean-q3',     fns.q3.toFixed(4));
  _setText('fns-mean-max',    fns.max.toFixed(4));
}

// ===================================================================
// Province List (Sidebar Kiri — Tab Provinsi)
// ===================================================================
export function renderProvinceList(data, onProvinceClick) {
  const listEl = document.getElementById('prov-list');
  if (!listEl) return;

  function render(query = '') {
    const filtered = query
      ? data.filter(d => d.provinsi.toLowerCase().includes(query.toLowerCase()))
      : data;

    const orderMap = new Map(PROVINCE_ORDER.map((p, i) => [p, i]));
    const sorted = [...filtered].sort((a, b) => {
      const orderA = orderMap.has(a.provinsi) ? orderMap.get(a.provinsi) : 999;
      const orderB = orderMap.has(b.provinsi) ? orderMap.get(b.provinsi) : 999;
      return orderA - orderB;
    });

    listEl.innerHTML = '';
    sorted.forEach(d => {
      const cat   = getCategory(d.prediksi_mean);
      const style = CATEGORY_STYLE[cat];
      const li    = document.createElement('li');
      li.className = 'prov-item';
      li.dataset.provinsi = d.provinsi;
      li.innerHTML = `
        <div class="prov-item-left">
          <span class="prov-dot" style="background:${style.dot}"></span>
          <span class="prov-item-name">${d.provinsi}</span>
        </div>
        <span class="prov-item-val" style="background:${style.bg};color:${style.color}">
          ${d.prediksi_mean.toFixed(3)}
        </span>
      `;
      li.addEventListener('click', () => onProvinceClick(d));
      listEl.appendChild(li);
    });
  }

  render();

  const searchInput = document.getElementById('search-prov');
  searchInput?.addEventListener('input', e => render(e.target.value));
}

// ===================================================================
// Highlight Province Item di List
// ===================================================================
export function highlightListItem(provinceName) {
  document.querySelectorAll('.prov-item').forEach(li => {
    li.classList.toggle('selected', li.dataset.provinsi === provinceName);
  });
}

// ===================================================================
// Sidebar Detail (Micro View — saat provinsi diklik)
// ===================================================================
export function renderSidebarDetail(prov, allData) {
  const emptyEl  = document.getElementById('sidebar-empty');
  const detailEl = document.getElementById('sidebar-detail');
  if (!emptyEl || !detailEl) return;

  emptyEl.classList.add('d-none');
  detailEl.classList.remove('d-none');

  const cat   = getCategory(prov.prediksi_mean);
  const style = CATEGORY_STYLE[cat];

  // Header
  _setText('det-prov-name', prov.provinsi);
  const badge = document.getElementById('det-badge');
  if (badge) {
    badge.textContent  = `${style.emoji} ${style.label}`;
    badge.style.background  = style.bg;
    badge.style.color       = style.color;
    badge.style.borderColor = style.border;
  }

  // Nilai utama
  _setText('det-pred',   prov.prediksi_mean.toFixed(4) + ' Ton/Ha');
  _setText('det-aktual', prov.produktivitas_aktual.toFixed(4) + ' Ton/Ha');

  const residual = prov.produktivitas_aktual - prov.prediksi_mean;
  const resEl = document.getElementById('det-residual');
  if (resEl) {
    resEl.textContent  = (residual >= 0 ? '+' : '') + residual.toFixed(4) + ' Ton/Ha';
    resEl.style.color  = residual >= 0 ? '#16A34A' : '#DC2626';
  }

  // Uncertainty
  _setText('det-std', '± ' + prov.uncertainty_std.toFixed(4) + ' Ton/Ha');

  // Uncertainty bar (relatif terhadap max uncertainty dalam dataset)
  const allStds    = allData.map(d => d.uncertainty_std);
  const maxStd     = Math.max(...allStds);
  const uncPercent = Math.min(100, (prov.uncertainty_std / maxStd) * 100);
  const barEl = document.getElementById('det-unc-bar');
  if (barEl) {
    barEl.style.width = uncPercent + '%';
    // Warna bar sesuai uncertainty level
    const t = uncPercent / 100;
    const r = Math.round(255 - t * (255 - 189));
    const g = Math.round(255 - t * 255);
    const b = Math.round(178 - t * 178);
    barEl.style.background = `linear-gradient(to right, #FFFFB2, rgb(${r},${g},${b}))`;
  }

  // Variabel agroklimat
  _setText('det-rain',   (prov.curah_hujan ?? 0).toLocaleString('id-ID') + ' mm/th');
  _setText('det-suhu',   (prov.suhu_minimum ?? 0).toFixed(1) + '°C');
  _setText('det-lembab', (prov.kelembaban ?? 0).toFixed(1) + '%');
  _setText('det-ntp',    (prov.ntp ?? 0).toFixed(1));
  _setText('det-sun',    (prov.penyinaran ?? 0).toFixed(1) + ' Jam/Hr');

  // Mini chart: residual provinsi vs nasional
  renderProvinceDetail('chart-prov-residual', prov, allData);

  // Interval confidence
  const lower = Math.max(0, prov.prediksi_mean - prov.uncertainty_std).toFixed(4);
  const upper = (prov.prediksi_mean + prov.uncertainty_std).toFixed(4);
  _setText('det-interval', `[${lower}, ${upper}] Ton/Ha`);
}

// ===================================================================
// Reset Sidebar ke Empty State
// ===================================================================
export function resetSidebar() {
  document.getElementById('sidebar-empty')?.classList.remove('d-none');
  document.getElementById('sidebar-detail')?.classList.add('d-none');
}

// ===================================================================
// Prediksi View — Dropdown Provinsi
// ===================================================================
export function populatePredictDropdown(data) {
  const select = document.getElementById('f-prov-select');
  if (!select) return;

  select.innerHTML = '<option value="">— Pilih Provinsi —</option>';
  data.forEach((d, idx) => {
    const opt = document.createElement('option');
    opt.value       = idx;
    opt.textContent = d.provinsi;
    select.appendChild(opt);
  });

  // Saat memilih dari dropdown, isi slider dengan data provinsi tersebut
  select.addEventListener('change', () => {
    const idx = parseInt(select.value);
    if (isNaN(idx) || idx < 0) return;
    const prov = data[idx];
    _setVal('f-prov-idx', idx);
    _setSlider('f-rain',  prov.curah_hujan,  'lv-rain',  false);
    _setSlider('f-suhu',  prov.suhu_minimum, 'lv-suhu',  true);
    _setSlider('f-lembab',prov.kelembaban,   'lv-lembab', true);
    _setSlider('f-ntp',   prov.ntp,          'lv-ntp',   true);
    _setSlider('f-sun',   prov.penyinaran,   'lv-sun',   true);
  });
}

// ===================================================================
// Slider Label Update
// ===================================================================
export function initSliders() {
  const sliders = [
    { key: 'rain',  integer: true  },
    { key: 'suhu',  integer: false },
    { key: 'lembab',integer: false },
    { key: 'ntp',   integer: false },
    { key: 'sun',   integer: false },
    { key: 'mc',    integer: true  },
  ];
  sliders.forEach(({ key, integer }) => {
    const input = document.getElementById(`f-${key}`);
    const label = document.getElementById(`lv-${key}`);
    if (!input || !label) return;
    const update = () => {
      const v = Number(input.value);
      label.textContent = integer
        ? v.toLocaleString('id-ID')
        : v.toFixed(1);
    };
    input.addEventListener('input', update);
    update();
  });
}

// ===================================================================
// Prediction Result Display
// ===================================================================
export function renderPredictResult(result) {
  const cat   = getCategory(result.prediksi_mean);
  const style = CATEGORY_STYLE[cat];
  const fns   = result.five_number_summary;

  _setText('res-prov', result.provinsi || '—');
  _setText('res-mean', result.prediksi_mean.toFixed(4));
  _setText('res-std',  '± ' + result.uncertainty_std.toFixed(4));
  _setText('res-lower', result.interval_1sigma?.lower.toFixed(4) ?? '—');
  _setText('res-upper', result.interval_1sigma?.upper.toFixed(4) ?? '—');

  const catEl = document.getElementById('res-cat');
  if (catEl) {
    catEl.textContent       = `${style.emoji} ${style.label}`;
    catEl.style.background  = style.bg;
    catEl.style.color       = style.color;
    catEl.style.borderColor = style.border;
  }

  // Confidence bar (berdasarkan CV = std/mean)
  if (result.prediksi_mean > 0) {
    const cv = result.uncertainty_std / result.prediksi_mean;
    const confidence = Math.max(0, Math.min(100, (1 - cv) * 100));
    const barEl = document.getElementById('res-conf-bar');
    if (barEl) {
      barEl.style.width = confidence + '%';
      barEl.title = `Confidence ~${confidence.toFixed(0)}%`;
    }
    _setText('res-conf-pct', confidence.toFixed(0) + '%');
  }

  // FNS cards
  if (fns) {
    _setText('res-fns-min',    fns.min.toFixed(4));
    _setText('res-fns-q1',     fns.q1.toFixed(4));
    _setText('res-fns-median', fns.median.toFixed(4));
    _setText('res-fns-q3',     fns.q3.toFixed(4));
    _setText('res-fns-max',    fns.max.toFixed(4));
  }

  // MC Histogram
  if (result.semua_prediksi_mc?.length > 0) {
    renderMCHistogram('chart-mc-hist', result.semua_prediksi_mc, result.prediksi_mean, result.uncertainty_std);
  }

  document.getElementById('predict-loader')?.classList.add('d-none');
  document.getElementById('predict-empty')?.classList.add('d-none');
  document.getElementById('predict-result')?.classList.remove('d-none');
}

// ===================================================================
// PDF Generation (jsPDF — no CDN dependency)
// ===================================================================
export async function downloadPDF(data) {
  if (!window.jspdf) { alert('jsPDF belum dimuat'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210
  const MARGIN = 14;
  const GREEN  = [15, 110, 86];
  const DARK   = [15, 23, 42];
  const GRAY   = [100, 116, 139];
  const LIGHT  = [241, 245, 249];

  // ── HEADER ──
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('WebGIS Produktivitas Kopi Indonesia', MARGIN, 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Bayesian Spatial GNN (K=8, Dim=64, MC×1000) — BPS & BMKG 2024', MARGIN, 15);
  doc.text(`Digenerate: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`, W - MARGIN, 15, { align: 'right' });

  // ── RINGKASAN STATISTIK ──
  let y = 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text('RINGKASAN STATISTIK NASIONAL', MARGIN, y);
  y += 5;

  const means = data.map(d => d.prediksi_mean).sort((a, b) => a - b);
  const n = means.length;
  const fns = [
    ['Minimum',   means[0]],
    ['Q1 (25%)',  means[Math.floor(n * 0.25)]],
    ['Median',    means[Math.floor(n * 0.5)]],
    ['Q3 (75%)',  means[Math.floor(n * 0.75)]],
    ['Maksimum',  means[n - 1]],
  ];

  const colW  = (W - 2 * MARGIN) / fns.length;
  fns.forEach(([label, val], i) => {
    const cx = MARGIN + i * colW + colW / 2;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(MARGIN + i * colW + 1, y, colW - 2, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(label, cx, y + 5, { align: 'center' });
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...GREEN);
    doc.text(val.toFixed(4) + ' Ton/Ha', cx, y + 12, { align: 'center' });
  });
  y += 20;

  // ── KOMPARASI MODEL ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text('KOMPARASI PERFORMA MODEL', MARGIN, y);
  y += 5;

  const models = [
    { name: 'OLS (Baseline)',       r2: '0.4170', adj_r2: '0.3130', mae: '0.1460', highlight: false },
    { name: 'GWR (Baseline)',       r2: '0.6850', adj_r2: '0.5010', mae: '0.1110', highlight: false },
    { name: 'GNN Bayesian ★',       r2: '0.7066', adj_r2: '0.6540', mae: '0.1120', highlight: true  },
  ];
  const mColW = [(W - 2 * MARGIN) * 0.35, (W - 2 * MARGIN) * 0.22, (W - 2 * MARGIN) * 0.22, (W - 2 * MARGIN) * 0.21];
  const mCols = ['Model', 'R²', 'Adj. R²', 'MAE'];

  // Header row
  doc.setFillColor(...GREEN);
  doc.rect(MARGIN, y, W - 2 * MARGIN, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  let cx = MARGIN;
  mCols.forEach((h, i) => {
    doc.text(h, cx + 3, y + 5);
    cx += mColW[i];
  });
  y += 7;

  models.forEach(m => {
    if (m.highlight) {
      doc.setFillColor(234, 247, 242);
      doc.rect(MARGIN, y, W - 2 * MARGIN, 7, 'F');
    }
    doc.setFont(m.highlight ? 'helvetica-bold' : 'helvetica', m.highlight ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(m.highlight ? GREEN[0] : DARK[0], m.highlight ? GREEN[1] : DARK[1], m.highlight ? GREEN[2] : DARK[2]);
    const vals = [m.name, m.r2, m.adj_r2, m.mae];
    cx = MARGIN;
    vals.forEach((v, i) => {
      doc.text(v, cx + 3, y + 5);
      cx += mColW[i];
    });
    y += 7;
  });
  y += 5;

  // ── TABEL DATA SEMUA PROVINSI ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  doc.text('DATA PREDIKSI SEMUA PROVINSI (34 PROVINSI)', MARGIN, y);
  y += 5;

  const headers = ['No', 'Provinsi', 'Aktual', 'Prediksi', 'Residual', 'Uncertainty σ', 'CH (mm)', 'Suhu Min', 'Kategori'];
  const colWidths = [8, 55, 20, 22, 22, 26, 22, 20, 22];

  // Tabel header
  doc.setFillColor(...GREEN);
  doc.rect(MARGIN, y, W - 2 * MARGIN, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  cx = MARGIN;
  headers.forEach((h, i) => {
    doc.text(h, cx + 2, y + 5);
    cx += colWidths[i];
  });
  y += 7;

  // Tabel rows
  const sortedData = [...data].sort((a, b) => b.prediksi_mean - a.prediksi_mean);
  sortedData.forEach((d, rowIdx) => {
    if (y > H - 15) {
      doc.addPage();
      y = 15;
    }
    if (rowIdx % 2 === 0) {
      doc.setFillColor(...LIGHT);
      doc.rect(MARGIN, y, W - 2 * MARGIN, 6, 'F');
    }
    const cat = getCategory(d.prediksi_mean);
    const residual = d.produktivitas_aktual - d.prediksi_mean;
    const vals = [
      String(rowIdx + 1),
      d.provinsi,
      d.produktivitas_aktual.toFixed(4),
      d.prediksi_mean.toFixed(4),
      (residual >= 0 ? '+' : '') + residual.toFixed(4),
      '± ' + d.uncertainty_std.toFixed(4),
      (d.curah_hujan ?? 0).toFixed(0),
      (d.suhu_minimum ?? 0).toFixed(1) + '°C',
      CATEGORY_STYLE[cat].label,
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...DARK);
    cx = MARGIN;
    vals.forEach((v, i) => {
      doc.text(v, cx + 2, y + 4);
      cx += colWidths[i];
    });
    y += 6;
  });

  // Footer
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(
      `Universitas Bina Nusantara 2025 · Clement Nathanael — Halaman ${p}/${totalPages}`,
      W / 2, H - 5, { align: 'center' }
    );
  }

  const blob = doc.output('blob');
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Tidak di-revoke segera agar tab baru sempat merender PDF-nya.
  // Browser akan cleanup blob URL secara otomatis saat tab ditutup.
}

// ===================================================================
// Excel Download
// ===================================================================
export function downloadExcel(data) {
  if (!window.XLSX) { alert('XLSX belum dimuat'); return; }
  const rows = data.map((d, i) => ({
    'No':             i + 1,
    'Provinsi':       d.provinsi,
    'Aktual (T/Ha)':  d.produktivitas_aktual,
    'Prediksi (T/Ha)':d.prediksi_mean,
    'Residual':       d.produktivitas_aktual - d.prediksi_mean,
    'Uncertainty σ':  d.uncertainty_std,
    'Curah Hujan (mm/th)': d.curah_hujan,
    'Suhu Min (°C)':  d.suhu_minimum,
    'Kelembaban (%)': d.kelembaban,
    'NTP':            d.ntp,
    'Penyinaran (Jam/Hr)': d.penyinaran,
    'Kategori':       CATEGORY_STYLE[getCategory(d.prediksi_mean)].label,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Prediksi GNN');
  XLSX.writeFile(wb, `data_webgis_kopi_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ===================================================================
// Helper: Count-Up Animation
// ===================================================================
export function animateCountUp(id, target, decimals = 4, duration = 800) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;   // ease-in-out
    el.textContent = (eased * target).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ===================================================================
// DOM Helpers
// ===================================================================
function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _setSlider(inputId, val, labelId, decimal = true) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  if (input) input.value = val;
  if (label) label.textContent = decimal ? Number(val).toFixed(1) : Number(val).toLocaleString('id-ID');
}
