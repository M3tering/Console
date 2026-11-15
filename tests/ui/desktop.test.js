const P = require('../../src/public/js/desktop-preferences');
const L = require('../../src/public/js/desktop-layout');

describe('desktop preferences', () => {
  test('invalid, outdated, and partial preferences have safe defaults', () => {
    expect(P.normalize(null).theme).toBe('retro');
    expect(P.normalize({ version: 99, theme: 'linux' }).theme).toBe('retro');
    expect(P.normalize({ theme: '__proto__', iconSize: 'huge', mode: 'bad' })).toMatchObject({ theme: 'retro', mode: 'auto', iconSize: 'medium' });
    const value = P.normalize({ theme: 'linux', positions: { good: { col: 2, row: 3 }, bad: { col: -1, row: 2 }, invalid: null } });
    expect(value.theme).toBe('linux');
    expect(Object.keys(value.positions)).toEqual(['good']);
  });
  test('round trips all preferences and tolerates unavailable storage', () => {
    let data;
    const storage = { getItem: () => data, setItem: (_, value) => { data = value; } };
    const prefs = P.normalize({ theme: 'windows', mode: 'manual', background: 'dusk', iconSize: 'large', sounds: true, reduceMotion: true, clock24: false, positions: { m3ters: { col: 2, row: 1 } } });
    expect(P.save(prefs, storage)).toBe(true);
    expect(P.load(storage)).toEqual(prefs);
    expect(P.load({ getItem: () => '{bad json' }).theme).toBe('retro');
    expect(P.save(prefs, { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });
});
describe('desktop placement', () => {
  test.each(['row', 'column'])('bounds and uniqueness hold in %s flow for many sizes and app counts', flow => {
    for (const width of [260, 320, 390, 768, 1440, 2560]) {
      for (const height of [180, 500, 900]) {
        for (const count of [0, 1, 6, 30, 200]) {
          const ids = Array.from({ length: count }, (_, i) => `app-${i}`);
          const grid = L.dimensions(width, height, 'medium', count);
          const result = L.arrange(ids, grid, {}, flow);
          const occupied = Object.values(result).map(p => `${p.col},${p.row}`);
          expect(new Set(occupied).size).toBe(count);
          Object.values(result).forEach(p => {
            expect(p.col).toBeGreaterThanOrEqual(0); expect(p.col).toBeLessThan(grid.cols);
            expect(p.row).toBeGreaterThanOrEqual(0); expect(p.row).toBeLessThan(grid.rows);
          });
        }
      }
    }
  });
  test('reserves stable IDs, handles new and removed apps, and leaves saved wide-screen positions intact', () => {
    const grid = L.dimensions(320, 500, 'medium', 4);
    const saved = { second: { col: 1, row: 2 }, first: { col: 12, row: 30 }, removed: { col: 0, row: 0 } };
    const before = JSON.stringify(saved);
    const result = L.arrange(['new', 'first', 'second', 'another'], grid, saved);
    expect(result.second).toEqual({ col: 1, row: 2 });
    expect(result.removed).toBeUndefined();
    expect(new Set(Object.values(result).map(p => `${p.col},${p.row}`)).size).toBe(4);
    expect(JSON.stringify(saved)).toBe(before);
  });
  test('moving into an occupied cell swaps icons without overlap or mutation', () => {
    const grid = L.dimensions(400, 500, 'medium', 3);
    const positions = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 }, c: { col: 2, row: 0 } };
    const moved = L.move(positions, 'a', { col: 1, row: 0 }, grid);
    expect(moved.a).toEqual({ col: 1, row: 0 });
    expect(moved.b).toEqual({ col: 0, row: 0 });
    expect(positions.a).toEqual({ col: 0, row: 0 });
    expect(L.move(moved, 'a', { col: 999, row: -1 }, grid).a).toEqual({ col: grid.cols - 1, row: 0 });
  });
});
