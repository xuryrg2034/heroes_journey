import { readFileSync } from 'node:fs';
const current = JSON.parse(readFileSync(new URL('./current-arena-data.json', import.meta.url), 'utf8')).arenas;
export const point = (x, y) => ({ x, y });
export const wall = (x, y, w, h) => ({ kind: 'wall', shape: 'rect', x, y, w, h });
export const tree = (x, y, r = .42) => ({ kind: 'tree', shape: 'circle', x, y, r });
export const pond = (x, y, r) => ({ kind: 'pond', shape: 'circle', x, y, r });
export const rectZone = (kind, x, y, w, h) => ({ kind, shape: 'rect', x, y, w, h });
export const polyZone = (kind, points) => ({ kind, shape: 'poly', points: points.map(([x,y]) => point(x,y)) });
export const band = (kind, width, points) => ({ kind, shape: 'band', width, points: points.map(([x,y]) => point(x,y)) });
export const enemy = (kind, x, y, flags = {}) => ({ kind, x, y, color: 0, ...flags });
export const basics = (pairs) => pairs.map(([x,y]) => enemy('basic', x, y));
export const route = (label, pairs, mode = 'walk') => ({ label, points: pairs.map(([x,y]) => point(x,y)), mode });
export const area = (x, y, r = 1, label = '') => ({ x, y, r, label });
export function base(id, overrides) {
  const source = current.find(a => a.id === id);
  if (!source) throw new Error(`Unknown arena: ${id}`);
  return { ...structuredClone(source), variant: 'base', variantLabel: 'Предложение', routes: [], spawnAreas: [], annotations: [], ...overrides };
}
