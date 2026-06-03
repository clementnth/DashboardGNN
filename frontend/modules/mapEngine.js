/**
 * mapEngine.js — Leaflet.js Map Controller
 * ==========================================
 * Murni mengurus: inisialisasi peta, choropleth, tooltip floating glassmorphism,
 * layer switching, highlight, dan click events.
 * Semua state perubahan di-emit ke StateManager — TIDAK import uiController/chartEngine.
 */

import { LAYER_CONFIG, MAP_CENTER, MAP_ZOOM, MAP_MIN_ZOOM, MAP_MAX_ZOOM, normalizeProvinceName } from './config.js';
import StateManager from './stateManager.js';

// ===================================================================
// Private state (modul-level)
// ===================================================================
let _map        = null;
let _geoLayer   = null;
let _geoData    = null;
let _currentLayer = 'prediksi_mean';
let _legend     = null;
let _tooltipEl  = null;   // Div floating tooltip

// ===================================================================
// Tooltip Floating Glassmorphism
// ===================================================================
function _createFloatingTooltip() {
  _tooltipEl = document.createElement('div');
  _tooltipEl.id = 'map-floating-tooltip';
  _tooltipEl.className = 'map-floating-tooltip hidden';
  document.getElementById('map-container')?.appendChild(_tooltipEl);
}

function _showTooltip(e, props) {
  if (!_tooltipEl) return;
  const cfg = LAYER_CONFIG[_currentLayer];
  const val = props[_currentLayer];
  const valStr = val != null ? `${val.toFixed(4)} ${cfg.unit}` : '—';
  const provName = props.provinsi || props.NAME_1 || props.name || '—';

  const actualStr = props.produktivitas_aktual != null
    ? props.produktivitas_aktual.toFixed(4) + ' Ton/Ha'
    : '—';

  _tooltipEl.innerHTML = `
    <div class="mtt-prov">${provName}</div>
    <div class="mtt-row">
      <span class="mtt-label">${cfg.title.split('(')[0].trim()}</span>
      <span class="mtt-value">${valStr}</span>
    </div>
    <div class="mtt-row">
      <span class="mtt-label">Aktual</span>
      <span class="mtt-value">${actualStr}</span>
    </div>
    <div class="mtt-hint">Klik untuk detail analitik →</div>
  `;
  _tooltipEl.classList.remove('hidden');
  _moveTooltip(e);
}

function _moveTooltip(e) {
  if (!_tooltipEl || _tooltipEl.classList.contains('hidden')) return;
  const mapRect = document.getElementById('map-container')?.getBoundingClientRect();
  if (!mapRect) return;
  const x = e.originalEvent.clientX - mapRect.left;
  const y = e.originalEvent.clientY - mapRect.top;
  const ttW = _tooltipEl.offsetWidth  || 200;
  const ttH = _tooltipEl.offsetHeight || 100;
  const left = (x + ttW + 16 > mapRect.width)  ? x - ttW - 12 : x + 14;
  const top  = (y + ttH + 16 > mapRect.height) ? y - ttH - 12 : y + 14;
  _tooltipEl.style.left = left + 'px';
  _tooltipEl.style.top  = top  + 'px';
}

function _hideTooltip() {
  if (_tooltipEl) _tooltipEl.classList.add('hidden');
}

// ===================================================================
// Choropleth Styling
// ===================================================================
function _getValue(feature) {
  return feature?.properties?.[_currentLayer];
}

function _getStyle(feature) {
  const cfg = LAYER_CONFIG[_currentLayer];
  const val = _getValue(feature);
  const hasData = feature?.properties?.__has_data;

  if (!hasData || val == null || Number.isNaN(val)) {
    return {
      fillColor:   '#CBD5E1',
      weight:      0.8,
      color:       '#94A3B8',
      opacity:     1,
      fillOpacity: 0.4,
      dashArray:   '4',
    };
  }

  const t = Math.max(0, Math.min(1, (val - cfg.min) / (cfg.max - cfg.min)));
  return {
    fillColor:   cfg.colorFn(t),
    weight:      0.8,
    color:       'rgba(0,0,0,0.25)',
    opacity:     1,
    fillOpacity: 0.82,
    dashArray:   '',
  };
}

// ===================================================================
// Feature Interaction Handlers
// ===================================================================
function _onMouseOver(e) {
  const layer = e.target;
  layer.setStyle({ weight: 2.5, color: '#1E293B', fillOpacity: 0.95 });
  if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
    layer.bringToFront();
  }
  _showTooltip(e, layer.feature.properties);
}

function _onMouseMove(e) {
  _moveTooltip(e);
}

function _onMouseOut(e) {
  _geoLayer?.resetStyle(e.target);
  _hideTooltip();
}

function _onClick(e, feature) {
  const props = feature.properties;
  if (!props.__has_data) return;

  // Temukan data lengkap dari globalData via key matching
  const allData = StateManager.get('globalData');
  const match = allData.find(d => normalizeProvinceName(d.provinsi) === props.__province_key);
  if (!match) return;

  StateManager.set('selectedProvince', match);
}

function _onEachFeature(feature, layer) {
  layer.on({
    mouseover: _onMouseOver,
    mousemove: _onMouseMove,
    mouseout:  _onMouseOut,
    click:     (e) => _onClick(e, feature),
  });
}

// ===================================================================
// Legend
// ===================================================================
function _createLegend() {
  if (_legend) {
    _legend.remove();
    _legend = null;
  }

  const cfg = LAYER_CONFIG[_currentLayer];
  const control = L.control({ position: 'bottomleft' });

  control.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');

    // Gradient bar
    const n = 100;
    const gradientStops = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return cfg.colorFn(t);
    }).join(',');

    const labels = cfg.legendLabels || ['Min', '', '', '', 'Max'];

    div.innerHTML = `
      <div class="legend-title">${cfg.title.replace(/\(.*\)/, '').trim()}</div>
      <div class="legend-gradient" style="background: linear-gradient(to right, ${gradientStops})"></div>
      <div class="legend-labels">
        ${labels.map(l => `<span>${l}</span>`).join('')}
      </div>
      <div class="legend-unit">${cfg.unit}</div>
    `;
    return div;
  };

  control.addTo(_map);
  _legend = control;
}

// ===================================================================
// Public API
// ===================================================================

/**
 * Inisialisasi peta Leaflet dengan CartoDB Positron basemap.
 * @param {string} containerId - ID div container peta
 */
export function initMap(containerId) {
  _map = L.map(containerId, {
    center:    MAP_CENTER,
    zoom:      MAP_ZOOM,
    minZoom:   MAP_MIN_ZOOM,
    maxZoom:   MAP_MAX_ZOOM,
    zoomControl: false,   // kita taruh manual di kanan bawah
  });

  // Set max bounds ketat ke Indonesia
  const sw = L.latLng(-11, 94);
  const ne = L.latLng(6.5, 142);
  _map.setMaxBounds(L.latLngBounds(sw, ne));

  // CartoDB Positron — bersih & profesional
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:     MAP_MAX_ZOOM,
    }
  ).addTo(_map);

  // CartoDB label overlay (agar label tetap tampil di atas choropleth)
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    {
      subdomains: 'abcd',
      maxZoom:    MAP_MAX_ZOOM,
      pane:       'shadowPane',   // di atas choropleth tapi di bawah popup
    }
  ).addTo(_map);

  // Zoom control di kanan bawah
  L.control.zoom({ position: 'bottomright' }).addTo(_map);

  // Floating tooltip element
  _createFloatingTooltip();

  // Sembunyikan tooltip saat klik di luar fitur
  _map.on('click', _hideTooltip);
}

/**
 * Render/re-render choropleth layer dari GeoJSON yang sudah di-join.
 * @param {Object} geojson
 */
export function renderChoropleth(geojson) {
  _geoData = geojson;

  if (_geoLayer) {
    _geoLayer.remove();
    _geoLayer = null;
  }

  _geoLayer = L.geoJSON(geojson, {
    style:         _getStyle,
    onEachFeature: _onEachFeature,
  }).addTo(_map);

  // Fit bounds ke Indonesia
  try {
    _map.fitBounds(_geoLayer.getBounds(), { padding: [10, 10] });
  } catch (_) {
    _map.setView(MAP_CENTER, MAP_ZOOM);
  }

  _createLegend();
}

/**
 * Ganti active data layer dan re-render choropleth.
 * @param {string} layerName - 'prediksi_mean' | 'uncertainty_std'
 */
export function switchLayer(layerName) {
  _currentLayer = layerName;
  if (_geoData) renderChoropleth(_geoData);
}

/**
 * Highlight & zoom ke satu provinsi.
 * @param {string} provinceName
 */
export function highlightProvince(provinceName) {
  if (!_geoLayer) return;
  const normalizedTarget = normalizeProvinceName(provinceName);

  _geoLayer.eachLayer(layer => {
    const key = layer.feature.properties.__province_key;
    if (key === normalizedTarget) {
      layer.setStyle({ weight: 3, color: '#0F172A', fillOpacity: 0.95 });
      if (layer.getBounds) {
        _map.fitBounds(layer.getBounds(), { maxZoom: 8, padding: [40, 40] });
      }
    } else {
      _geoLayer.resetStyle(layer);
    }
  });
}

/**
 * Reset semua highlight ke default choropleth.
 */
export function resetHighlight() {
  if (_geoLayer) {
    _geoLayer.eachLayer(layer => _geoLayer.resetStyle(layer));
  }
}