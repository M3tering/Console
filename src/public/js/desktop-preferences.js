/* Shared, versioned preferences. Loaded before CSS to avoid a theme flash. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopPreferences = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'm3tering.desktop.v1';
  const themes = Object.freeze({
    retro: { name: 'Retro 8-Bit', description: 'Pixel soul. A familiar classic.', flow: 'column', color: '#173c39' },
    macos: { name: 'macOS Inspired', description: 'Soft light. Room to breathe.', flow: 'column', color: '#52445d' },
    linux: { name: 'Linux Inspired', description: 'Focused. Flexible. Yours.', flow: 'row', color: '#21252f' },
    windows: { name: 'Windows Inspired', description: 'A fresh perspective on work.', flow: 'column', color: '#173b68' },
  });
  function normalize(value) {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const positions = Object.create(null);
    // Unknown versions fail back to defaults instead of interpreting an incompatible schema.
    if (data.version !== undefined && data.version !== 1) return normalize({});
    if (data.positions && typeof data.positions === 'object' && !Array.isArray(data.positions)) {
      Object.entries(data.positions).slice(0, 2000).forEach(([id, point]) => {
        if (point && Number.isInteger(point.col) && Number.isInteger(point.row) &&
            point.col >= 0 && point.col < 1000 && point.row >= 0 && point.row < 1000) {
          positions[id] = { col: point.col, row: point.row };
        }
      });
    }
    const appColorModes = Object.create(null);
    if (data.appColorModes && typeof data.appColorModes === 'object') {
      Object.entries(data.appColorModes).slice(0, 2000).forEach(([id, mode]) => {
        if (['light', 'dark'].includes(mode)) appColorModes[id] = mode;
      });
    }
    return {
      appColorModes,
      version: 1,
      theme: Object.hasOwn(themes, data.theme) ? data.theme : 'retro',
      mode: data.mode === 'manual' ? 'manual' : 'auto',
      iconSize: ['small', 'medium', 'large'].includes(data.iconSize) ? data.iconSize : 'medium',
      background: ['theme', 'dusk', 'forest', 'plain'].includes(data.background) ? data.background : 'theme',
      reduceMotion: data.reduceMotion === true,
      sounds: data.sounds === true,
      clock24: data.clock24 !== false,
      positions,
    };
  }
  function load(storage) {
    try { return normalize(JSON.parse((storage || localStorage).getItem(KEY))); }
    catch (_) { return normalize({}); }
  }
  function save(value, storage) {
    try { (storage || localStorage).setItem(KEY, JSON.stringify(normalize(value))); return true; }
    catch (_) { return false; }
  }
  function apply(value) {
    if (typeof document === 'undefined') return;
    const prefs = normalize(value);
    Object.assign(document.documentElement.dataset, {
      theme: prefs.theme, background: prefs.background, iconSize: prefs.iconSize,
      arrangement: prefs.mode, reducedMotion: String(prefs.reduceMotion),
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = themes[prefs.theme].color;
  }
  return { KEY, themes, normalize, load, save, apply };
});
