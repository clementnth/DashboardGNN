/**
 * stateManager.js — Centralized Observer-based State Management
 * =============================================================
 * Pola: simple pub/sub + immutable state snapshots.
 * Modul lain TIDAK boleh import langsung satu sama lain untuk koordinasi —
 * semua komunikasi antar modul melewati StateManager ini.
 *
 * Usage:
 *   import StateManager from './stateManager.js';
 *
 *   // Daftar listener
 *   StateManager.on('provinceSelected', (province) => { ... });
 *
 *   // Trigger perubahan state
 *   StateManager.set('selectedProvince', data);
 *
 *   // Baca state saat ini
 *   const data = StateManager.get('globalData');
 */

// ===================================================================
// Initial State
// ===================================================================
const _state = {
  activeView:        'peta',        // 'peta' | 'prediksi' | 'info'
  activeLayer:       'prediksi_mean', // 'prediksi_mean' | 'uncertainty_std'
  selectedProvince:  null,          // objek data provinsi yang diklik
  globalData:        [],            // array semua 34 provinsi dari API
  geojson:           null,          // GeoJSON yang sudah di-join
  isLoading:         false,
  isReady:           false,         // true setelah data berhasil dimuat
};

// ===================================================================
// Event Listeners Registry
// ===================================================================
const _listeners = {};

// ===================================================================
// Public API
// ===================================================================
const StateManager = {

  /**
   * Daftar listener untuk sebuah event key.
   * @param {string} event  - nama event, e.g. 'provinceSelected', 'layerChanged'
   * @param {Function} fn   - callback(newValue, prevValue)
   */
  on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  },

  /**
   * Hapus listener.
   */
  off(event, fn) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(f => f !== fn);
  },

  /**
   * Emit event tanpa mengubah state (untuk one-shot events).
   */
  emit(event, payload) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(payload); }
      catch (err) { console.error(`[StateManager] Error in listener for "${event}":`, err); }
    });
  },

  /**
   * Set nilai state dan notify semua listener.
   * @param {string} key   - kunci state (harus sudah ada di _state)
   * @param {*}      value - nilai baru
   */
  set(key, value) {
    if (!(key in _state)) {
      console.warn(`[StateManager] Unknown state key: "${key}"`);
    }
    const prev = _state[key];
    _state[key] = value;

    // Notify listeners untuk key ini
    (_listeners[key] || []).forEach(fn => {
      try { fn(value, prev); }
      catch (err) { console.error(`[StateManager] Error in listener for "${key}":`, err); }
    });
  },

  /**
   * Baca nilai state saat ini (read-only).
   */
  get(key) {
    return _state[key];
  },

  /**
   * Snapshot seluruh state (shallow copy, untuk debugging).
   */
  snapshot() {
    return { ..._state };
  },
};

export default StateManager;
