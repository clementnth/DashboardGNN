/**
 * chartEngine.js — Chart.js Rendering
 * =====================================
 * Murni render charts. Tidak ada logika DOM lain.
 * Semua fungsi menerima data eksplisit sebagai parameter.
 */

// ===================================================================
// Chart Registry (untuk destroy sebelum re-render)
// ===================================================================
const _charts = {};

function _destroyChart(id) {
  if (_charts[id]) {
    _charts[id].destroy();
    delete _charts[id];
  }
}

function _getCtx(canvasId) {
  const canvas = document.getElementById(canvasId);
  return canvas ? canvas.getContext('2d') : null;
}

// ===================================================================
// Shared Chart Theme
// ===================================================================
const FONT = "'DM Sans', sans-serif";
const MONO = "'Space Mono', monospace";
const GRID_COLOR = 'rgba(0,0,0,0.06)';

Chart.defaults.font.family = FONT;
Chart.defaults.color = '#64748B';

// ===================================================================
// 1. Scatter: Aktual vs Prediksi (dengan garis y=x ideal)
// ===================================================================
export function renderActualVsPred(canvasId, data, highlightProv = null) {
  _destroyChart(canvasId);
  const ctx = _getCtx(canvasId);
  if (!ctx) return;

  const sorted = [...data]; // No sorting, maintain raw array order
  
  const labels = sorted.map(d => d.provinsi.replace(/^(Kalimantan|Sulawesi|Sumatera|Nusa Tenggara)\s/, m => m.slice(0, 3) + '. '));
  const dataAktual = sorted.map(d => d.produktivitas_aktual);
  const dataPrediksi = sorted.map(d => d.prediksi_mean);
  
  const bgAktual = sorted.map(d => d.provinsi === highlightProv ? 'rgba(245, 158, 11, 0.8)' : 'rgba(99, 102, 241, 0.6)');
  const borderAktual = sorted.map(d => d.provinsi === highlightProv ? '#D97706' : '#4F46E5');
  
  const bgPrediksi = sorted.map(d => d.provinsi === highlightProv ? 'rgba(234, 179, 8, 0.8)' : 'rgba(34, 197, 94, 0.6)');
  const borderPrediksi = sorted.map(d => d.provinsi === highlightProv ? '#CA8A04' : '#16A34A');

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Aktual',
          data: dataAktual,
          backgroundColor: bgAktual,
          borderColor: borderAktual,
          borderWidth: 1,
          borderRadius: 2,
        },
        {
          label: 'Prediksi',
          data: dataPrediksi,
          backgroundColor: bgPrediksi,
          borderColor: borderPrediksi,
          borderWidth: 1,
          borderRadius: 2,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(4)} Ton/Ha`,
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { size: 7 }, maxRotation: 90 },
          grid: { display: false }
        },
        y: {
          title: { display: true, text: 'Produktivitas (Ton/Ha)', font: { size: 9 } },
          grid: { color: GRID_COLOR },
          ticks: { font: { family: MONO, size: 8 } }
        }
      },
      animation: { duration: 400 },
    }
  });
}

// ===================================================================
// 2. Bar Chart: Residual Nasional
// ===================================================================
export function renderResidual(canvasId, data) {
  _destroyChart(canvasId);
  const ctx = _getCtx(canvasId);
  if (!ctx) return;

  const sorted = [...data].sort((a, b) => a.produktivitas_aktual - b.produktivitas_aktual - (b.prediksi_mean - a.prediksi_mean));
  const labels    = sorted.map(d => d.provinsi.replace(/^(Kalimantan|Sulawesi|Sumatera|Nusa Tenggara)\s/, m => m.slice(0, 3) + '. '));
  const residuals = sorted.map(d => +(d.produktivitas_aktual - d.prediksi_mean).toFixed(5));

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Residual (Y − ŷ)',
        data: residuals,
        backgroundColor: residuals.map(v => v >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'),
        borderColor:     residuals.map(v => v >= 0 ? '#16A34A'               : '#DC2626'),
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            zeroline: {
              type: 'line',
              yMin: 0, yMax: 0,
              borderColor: 'rgba(0,0,0,0.3)',
              borderWidth: 1,
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 7 }, maxRotation: 90 },
          grid: { display: false },
        },
        y: {
          title: { display: true, text: 'Residual', font: { size: 9 } },
          grid: { color: GRID_COLOR },
          ticks: { font: { family: MONO, size: 8 } },
        },
      },
      animation: { duration: 500 },
    },
  });
}

// ===================================================================
// 3. Mini Chart: Residual Provinsi Terpilih vs Rata-rata Nasional
// ===================================================================
export function renderProvinceDetail(canvasId, prov, allData) {
  _destroyChart(canvasId);
  const ctx = _getCtx(canvasId);
  if (!ctx) return;

  const residuals    = allData.map(d => Math.abs(d.produktivitas_aktual - d.prediksi_mean));
  const meanResidual = residuals.reduce((s, v) => s + v, 0) / residuals.length;
  const provResidual = Math.abs(prov.produktivitas_aktual - prov.prediksi_mean);

  const barData = [
    { label: 'Residual Provinsi', value: provResidual,  color: 'rgba(239,68,68,0.7)',    border: '#DC2626' },
    { label: 'Rata-rata Nasional', value: meanResidual, color: 'rgba(99,102,241,0.5)',   border: '#6366F1' },
  ];

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: barData.map(b => b.label),
      datasets: [{
        data:            barData.map(b => b.value),
        backgroundColor: barData.map(b => b.color),
        borderColor:     barData.map(b => b.border),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` |Residual| = ${ctx.raw.toFixed(4)} Ton/Ha`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '|Y − ŷ| (Ton/Ha)', font: { size: 9 } },
          grid: { color: GRID_COLOR },
          ticks: { font: { family: MONO, size: 8 } },
          beginAtZero: true,
        },
        y: {
          ticks: { font: { size: 10, weight: '600' } },
          grid: { display: false },
        },
      },
      animation: { duration: 300 },
    },
  });
}

// ===================================================================
// 4. MC Histogram — Distribusi Posterior Prediksi
// ===================================================================
export function renderMCHistogram(canvasId, predictions, mean, std) {
  _destroyChart(canvasId);
  const ctx = _getCtx(canvasId);
  if (!ctx) return;

  const N_BINS = 25;
  const mn  = Math.min(...predictions);
  const mx  = Math.max(...predictions);
  const bw  = (mx - mn) / N_BINS;
  const counts = new Array(N_BINS).fill(0);
  predictions.forEach(p => {
    const i = Math.min(N_BINS - 1, Math.floor((p - mn) / bw));
    counts[i]++;
  });
  const mids = counts.map((_, i) => mn + (i + 0.5) * bw);

  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: mids.map(m => m.toFixed(3)),
      datasets: [{
        label: 'Frekuensi MC',
        data: counts,
        backgroundColor: mids.map(m =>
          Math.abs(m - mean) <= std
            ? 'rgba(34,197,94,0.75)'
            : 'rgba(34,197,94,0.2)'
        ),
        borderColor: mids.map(m =>
          Math.abs(m - mean) <= std ? '#16A34A' : 'rgba(34,197,94,0.3)'
        ),
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => `${items[0].label} Ton/Ha`,
            label: ctx => `Frekuensi: ${ctx.raw}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { family: MONO, size: 7 }, maxTicksLimit: 8 },
          title: { display: true, text: 'Prediksi (Ton/Ha)', font: { size: 9 } },
          grid: { display: false },
        },
        y: {
          title: { display: true, text: 'Frekuensi', font: { size: 9 } },
          grid: { color: GRID_COLOR },
          ticks: { font: { size: 9 } },
          beginAtZero: true,
        },
      },
      animation: { duration: 400 },
    },
  });
}

// ===================================================================
// Destroy semua chart (cleanup)
// ===================================================================
export function destroyAll() {
  Object.keys(_charts).forEach(_destroyChart);
}