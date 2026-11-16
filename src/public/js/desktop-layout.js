/* Pure grid calculations shared by pointer, keyboard, resize, and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  function dimensions(width, height, size, count) {
    const cell = { small: [88, 100], medium: [108, 116], large: [128, 138] }[size] || [108, 116];
    const cols = Math.max(1, Math.floor(width / cell[0]));
    const visibleRows = Math.max(1, Math.floor(height / cell[1]));
    const rows = Math.max(visibleRows, Math.ceil(count / cols));
    return { cols, rows, cellWidth: Math.min(cell[0], width), cellHeight: cell[1], height: rows * cell[1] };
  }
  function arrange(ids, grid, saved = {}, flow = 'row') {
    const positions = Object.create(null);
    const occupied = new Set();
    const cells = [];
    for (let i = 0; i < grid.cols * grid.rows; i++) {
      cells.push(flow === 'column' ? { col: Math.floor(i / grid.rows), row: i % grid.rows } :
        { col: i % grid.cols, row: Math.floor(i / grid.cols) });
    }
    const key = p => `${p.col},${p.row}`;
    const pending = [];
    // Reserve existing positions before assigning new applications.
    ids.forEach(id => {
      const original = Object.hasOwn(saved, id) && saved[id];
      if (!original) { pending.push(id); return; }
      const p = { col: clamp(original.col, 0, grid.cols - 1), row: clamp(original.row, 0, grid.rows - 1) };
      if (occupied.has(key(p))) pending.push(id);
      else { positions[id] = p; occupied.add(key(p)); }
    });
    let cursor = 0;
    pending.forEach(id => {
      while (cursor < cells.length && occupied.has(key(cells[cursor]))) cursor++;
      if (cursor < cells.length) { positions[id] = cells[cursor]; occupied.add(key(cells[cursor++])); }
    });
    return positions;
  }
  function move(positions, id, target, grid) {
    const next = Object.assign(Object.create(null), positions);
    if (!Object.hasOwn(next, id)) return next;
    const dest = { col: clamp(target.col, 0, grid.cols - 1), row: clamp(target.row, 0, grid.rows - 1) };
    const occupant = Object.keys(next).find(other => other !== id && next[other].col === dest.col && next[other].row === dest.row);
    if (occupant) next[occupant] = next[id];
    next[id] = dest;
    return next;
  }
  return { clamp, dimensions, arrange, move };
});
