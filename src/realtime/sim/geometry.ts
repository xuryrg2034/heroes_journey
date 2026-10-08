/**
 * Arena geometry of the real-time simulation (no DOM): bounds, obstacles, collision push-out,
 * line of sight and a flow field that leads enemies around obstacles to the hero.
 * Units: 1 unit ≈ one cell of the turn-based board. Arena templates live in arenas.ts.
 */

export interface Vec { x: number; y: number }

export type ObstacleKind = 'wall' | 'tree' | 'pond';
export interface RectObstacle { shape: 'rect'; kind: 'wall'; x: number; y: number; w: number; h: number }
export interface CircleObstacle { shape: 'circle'; kind: 'tree' | 'pond'; x: number; y: number; r: number }
export type Obstacle = RectObstacle | CircleObstacle;

/**
 * Stage 3a, step 1 (docs/realtime-stage3.md, section 2): terrain zones of an arena — not obstacles, they block no sight.
 * - `river` (М1) — water as the pond, of any shape: walking ×`waterSlow` (hero and enemies); the dash, the jump, the
 *   boar's charge and arrows cross it as they are.
 * - `cliff` (М2) — no walking for the hero and the enemies (the flow field, the walk, the charge and the hero's push-out
 *   keep off it); the dash and the jump fly over it, but never end over it; sight and arrows cross it; an enemy whose
 *   center is pushed over it (`separate`, a knockback, a blast) falls and dies (world.ts, `dropIntoCliffs`).
 * - `thorns` (М3) — the hero on foot in it is pricked (`thornDamage` at the entry, then every `thornInterval` s);
 *   enemies walk it at ×`thornSlow`, unhurt; the dash and the jump are not pricked.
 * The center of a body decides «in a zone» (as the pond). Arenas without zones (`terrain` absent) behave as before.
 */
export type TerrainKind = 'river' | 'cliff' | 'thorns';
/** A zone outline: a polygon (any simple one), a band along a polyline (`width` — full width: a river), a rectangle or a circle. */
export type Area =
  | { shape: 'poly'; points: Vec[] }
  | { shape: 'band'; points: Vec[]; width: number }
  | { shape: 'rect'; x: number; y: number; w: number; h: number }
  | { shape: 'circle'; x: number; y: number; r: number };
export type TerrainZone = Area & { kind: TerrainKind };

/** What the geometry needs of an arena: its size, obstacles and terrain zones (the arena template, arenas.ts, adds the rest). */
export interface ArenaShape {
  width: number;
  height: number;
  obstacles: Obstacle[];
  /** Stage 3a: terrain zones (river, cliff, thorns); absent — none. */
  terrain?: TerrainZone[];
}

/** Obstacle builders for arena templates. A tree trunk is 0.42 units. */
export const wall = (x: number, y: number, w: number, h: number): RectObstacle => ({ shape: 'rect', kind: 'wall', x, y, w, h });
export const tree = (x: number, y: number): CircleObstacle => ({ shape: 'circle', kind: 'tree', x, y, r: 0.42 });
export const pond = (x: number, y: number, r: number): CircleObstacle => ({ shape: 'circle', kind: 'pond', x, y, r });
/** Terrain builders (stage 3a): a river band along a polyline of full `width`, or any zone of a given outline. */
export const riverBand = (points: Vec[], width: number): TerrainZone => ({ kind: 'river', shape: 'band', points, width });
export const zone = (kind: TerrainKind, area: Area): TerrainZone => ({ ...area, kind });
export const polygon = (...xy: number[]): Area => {
  const points: Vec[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) points.push({ x: xy[i], y: xy[i + 1] });
  return { shape: 'poly', points };
};

/** Nearest point of the segment a–b to p. */
function closestOnSegment(a: Vec, b: Vec, p: Vec): Vec {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return { x: a.x + vx * t, y: a.y + vy * t };
}

/** Nearest point of a polyline (a band's spine, a polygon's closed outline) to p. */
function closestOnPolyline(points: readonly Vec[], p: Vec, closed: boolean): Vec {
  let best = points[0], bestD = Infinity;
  const n = points.length, edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const q = closestOnSegment(points[i], points[(i + 1) % n], p), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** True when p is inside the polygon (even–odd rule). */
function insidePolygon(points: readonly Vec[], p: Vec): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Bounding box of an area (cached per area object: arena templates do not change). */
const boxes = new WeakMap<Area, { x0: number; y0: number; x1: number; y1: number }>();
function boxOf(area: Area): { x0: number; y0: number; x1: number; y1: number } {
  let box = boxes.get(area);
  if (box) return box;
  if (area.shape === 'circle') box = { x0: area.x - area.r, y0: area.y - area.r, x1: area.x + area.r, y1: area.y + area.r };
  else if (area.shape === 'rect') box = { x0: area.x, y0: area.y, x1: area.x + area.w, y1: area.y + area.h };
  else {
    const pad = area.shape === 'band' ? area.width / 2 : 0;
    box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const q of area.points) { box.x0 = Math.min(box.x0, q.x - pad); box.y0 = Math.min(box.y0, q.y - pad); box.x1 = Math.max(box.x1, q.x + pad); box.y1 = Math.max(box.y1, q.y + pad); }
  }
  boxes.set(area, box);
  return box;
}
/** The point is farther than `margin` outside the area's bounding box (a cheap «surely outside»). */
function farFrom(area: Area, p: Vec, margin: number): boolean {
  const b = boxOf(area);
  return p.x < b.x0 - margin || p.x > b.x1 + margin || p.y < b.y0 - margin || p.y > b.y1 + margin;
}

/** True when p is inside the area (on the outline counts as outside). */
export function areaContains(area: Area, p: Vec): boolean {
  if (farFrom(area, p, 0)) return false;
  switch (area.shape) {
    case 'circle': return Math.hypot(p.x - area.x, p.y - area.y) < area.r;
    case 'rect': return p.x > area.x && p.x < area.x + area.w && p.y > area.y && p.y < area.y + area.h;
    case 'poly': return insidePolygon(area.points, p);
    case 'band': { const q = closestOnPolyline(area.points, p, false); return Math.hypot(q.x - p.x, q.y - p.y) < area.width / 2; }
  }
}

/**
 * Signed distance from p to the area's outline (negative inside) and the unit direction out of the area at p (away from
 * the nearest outline point when outside; towards it when inside). The direction falls back to «away from the area's
 * middle» when p lies exactly on the outline.
 */
export function areaDistance(area: Area, p: Vec): { d: number; nx: number; ny: number } {
  let qx: number, qy: number, inside: boolean;
  if (area.shape === 'circle') {
    const dx = p.x - area.x, dy = p.y - area.y, d = Math.hypot(dx, dy);
    if (d < 1e-9) return { d: -area.r, nx: 1, ny: 0 };
    return { d: d - area.r, nx: dx / d, ny: dy / d };
  }
  if (area.shape === 'band') {
    const q = closestOnPolyline(area.points, p, false), dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy), half = area.width / 2;
    if (d > 1e-9) return { d: d - half, nx: dx / d, ny: dy / d };
    // On the spine: out across the first segment.
    const a = area.points[0], b = area.points[Math.min(1, area.points.length - 1)], sx = b.x - a.x, sy = b.y - a.y, sl = Math.hypot(sx, sy) || 1;
    return { d: -half, nx: -sy / sl, ny: sx / sl };
  }
  if (area.shape === 'rect') {
    inside = areaContains(area, p);
    if (inside) {
      const left = p.x - area.x, right = area.x + area.w - p.x, top = p.y - area.y, bottom = area.y + area.h - p.y, m = Math.min(left, right, top, bottom);
      if (m === left) return { d: -left, nx: -1, ny: 0 };
      if (m === right) return { d: -right, nx: 1, ny: 0 };
      if (m === top) return { d: -top, nx: 0, ny: -1 };
      return { d: -bottom, nx: 0, ny: 1 };
    }
    qx = Math.max(area.x, Math.min(p.x, area.x + area.w)); qy = Math.max(area.y, Math.min(p.y, area.y + area.h));
  } else {
    inside = insidePolygon(area.points, p);
    const q = closestOnPolyline(area.points, p, true);
    qx = q.x; qy = q.y;
  }
  const dx = qx - p.x, dy = qy - p.y, d = Math.hypot(dx, dy);
  if (d > 1e-9) return inside ? { d: -d, nx: dx / d, ny: dy / d } : { d, nx: -dx / d, ny: -dy / d };
  const mid = areaMiddle(area), mx = p.x - mid.x, my = p.y - mid.y, ml = Math.hypot(mx, my) || 1;
  return { d: 0, nx: mx / ml, ny: my / ml };
}

function areaMiddle(area: Area): Vec {
  if (area.shape === 'circle') return { x: area.x, y: area.y };
  if (area.shape === 'rect') return { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  const n = area.points.length;
  return { x: area.points.reduce((s, q) => s + q.x, 0) / n, y: area.points.reduce((s, q) => s + q.y, 0) / n };
}

/** Distance between the segments a–b and c–d (0 when they cross). */
function segmentSegmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  const cross = (o: Vec, p: Vec, q: Vec): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const pd = (p: Vec, s: Vec, t: Vec): number => { const q = closestOnSegment(s, t, p); return Math.hypot(q.x - p.x, q.y - p.y); };
  return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}

/** True when the segment a–b comes within `r` of the area (or runs inside it). */
export function segmentTouchesArea(a: Vec, b: Vec, area: Area, r: number): boolean {
  const box = boxOf(area), m = Math.max(0, r);
  if (Math.max(a.x, b.x) < box.x0 - m || Math.min(a.x, b.x) > box.x1 + m || Math.max(a.y, b.y) < box.y0 - m || Math.min(a.y, b.y) > box.y1 + m) return false;
  if (areaDistance(area, a).d < r || areaDistance(area, b).d < r) return true;
  switch (area.shape) {
    case 'circle': return segmentPointDistance(a, b, area) < area.r + r;
    case 'rect': return segmentHitsRect(a, b, area.x - r, area.y - r, area.x + area.w + r, area.y + area.h + r);
    case 'band': {
      for (let i = 0; i + 1 < area.points.length; i++) if (segmentSegmentDistance(a, b, area.points[i], area.points[i + 1]) < area.width / 2 + r) return true;
      return false;
    }
    case 'poly': {
      const pts = area.points;
      for (let i = 0; i < pts.length; i++) {
        const gap = segmentSegmentDistance(a, b, pts[i], pts[(i + 1) % pts.length]);
        if (gap < r || gap === 0) return true;
      }
      return false;
    }
  }
}

/** True when p is in a zone of `kind`. */
export function inZone(p: Vec, arena: ArenaShape, kind: TerrainKind): boolean {
  if (!arena.terrain) return false;
  for (const z of arena.terrain) if (z.kind === kind && areaContains(z, p)) return true;
  return false;
}
/** The arena has a zone of `kind`. */
export const hasZone = (arena: ArenaShape, kind: TerrainKind): boolean => !!arena.terrain?.some(z => z.kind === kind);
/** M2: the center is over a cliff (an enemy there falls; the hero and the walk never get there). */
export const overCliff = (p: Vec, arena: ArenaShape): boolean => inZone(p, arena, 'cliff');
/** M3: the center is in thorns. */
export const inThorns = (p: Vec, arena: ArenaShape): boolean => inZone(p, arena, 'thorns');

/** M2: moves a walking circle off every cliff (the edge is a wall for walking); arenas without cliffs — nothing. */
export function pushOutOfCliffs(p: Vec, r: number, arena: ArenaShape): void {
  if (!arena.terrain) return;
  for (const z of arena.terrain) {
    if (z.kind !== 'cliff' || farFrom(z, p, r)) continue;
    const { d, nx, ny } = areaDistance(z, p);
    if (d < r) { p.x += nx * (r - d); p.y += ny * (r - d); }
  }
}

/** M2: a circle of radius r at p overlaps a cliff. */
export function cliffAt(p: Vec, r: number, arena: ArenaShape): boolean {
  if (!arena.terrain) return false;
  for (const z of arena.terrain) if (z.kind === 'cliff' && !farFrom(z, p, r) && areaDistance(z, p).d < r) return true;
  return false;
}

/**
 * Clock for the rebuild time shown on the debug panel and in the pockets report. The simulation reads no clock: the view
 * (and the report script) injects one; without it `lastBuildMs` stays 0. Never part of the simulation state or hash.
 */
let measureClock: (() => number) | null = null;
export function setFlowClock(clock: (() => number) | null): void { measureClock = clock; }
const clockMs = (): number => (measureClock ? measureClock() : 0);

export function dist(a: Vec, b: Vec): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/**
 * Solid obstacles: walls and trees. The pond is passable water since iteration 2, stage B
 * (docs/realtime-prototype.md, section 9г, item 3): it slows walkers (`waterSlow`) and blocks nothing.
 */
export function isSolid(o: Obstacle): boolean { return o.kind !== 'pond'; }

/** True when the point is in a pond or a river (stage 3a, М1) — the center of a body decides. */
export function inWater(p: Vec, arena: ArenaShape): boolean {
  for (const o of arena.obstacles) if (o.kind === 'pond' && Math.hypot(p.x - o.x, p.y - o.y) < o.r) return true;
  return arena.terrain ? inZone(p, arena, 'river') : false;
}

/**
 * Moves a circle out of every solid obstacle — and, for a walker (`cliffs`, the default; stage 3a, М2), off every cliff —
 * and keeps it inside the arena bounds. `cliffs` false: the crowd's pushing (`separate`), which may shove a body over the edge.
 */
export function pushOutOfObstacles(p: Vec, r: number, arena: ArenaShape, cliffs = true): void {
  for (const o of arena.obstacles) {
    if (!isSolid(o)) continue;
    if (o.shape === 'circle') {
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), min = o.r + r;
      if (d < min) {
        if (d < 1e-6) { p.x = o.x + min; continue; }
        p.x = o.x + dx / d * min; p.y = o.y + dy / d * min;
      }
    } else {
      const cx = Math.max(o.x, Math.min(p.x, o.x + o.w)), cy = Math.max(o.y, Math.min(p.y, o.y + o.h));
      const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 1e-6) { p.x = cx + dx / d * r; p.y = cy + dy / d * r; continue; }
      // Center inside the rectangle: leave through the nearest side.
      const left = p.x - o.x, right = o.x + o.w - p.x, top = p.y - o.y, bottom = o.y + o.h - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = o.x - r; else if (m === right) p.x = o.x + o.w + r; else if (m === top) p.y = o.y - r; else p.y = o.y + o.h + r;
    }
  }
  if (cliffs && arena.terrain) pushOutOfCliffs(p, r, arena);
  p.x = Math.max(r, Math.min(arena.width - r, p.x));
  p.y = Math.max(r, Math.min(arena.height - r, p.y));
}

/**
 * True when a circle of radius r at p overlaps a solid obstacle or the arena edge (water is passable) — or a cliff, unless
 * `cliffs` is false (stage 3a, М2: a cliff stops walking, the charge, a landing, a spawn and a drop, not an arrow).
 */
export function blockedAt(p: Vec, r: number, arena: ArenaShape, cliffs = true): boolean {
  if (cliffs && arena.terrain && cliffAt(p, r, arena)) return true;
  if (p.x < r || p.y < r || p.x > arena.width - r || p.y > arena.height - r) return true;
  for (const o of arena.obstacles) {
    if (!isSolid(o)) continue;
    if (o.shape === 'circle') { if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + r) return true; }
    else {
      const cx = Math.max(o.x, Math.min(p.x, o.x + o.w)), cy = Math.max(o.y, Math.min(p.y, o.y + o.h));
      if (Math.hypot(p.x - cx, p.y - cy) < r) return true;
    }
  }
  return false;
}

function segmentPointDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

function segmentHitsRect(a: Vec, b: Vec, x0: number, y0: number, x1: number, y1: number): boolean {
  // Liang–Barsky clip of the segment against the rectangle.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const checks: [number, number][] = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/**
 * Line of sight between two points for a body of radius r (0 for a thin ray).
 * Stage 2 uses it with r = 0 for chain links when obstacles break links. Water does not break
 * sight (iteration 2, stage B); `waterBlocks` makes the pond count — the enemies' straight-walk
 * shortcut uses it, so a walk across slow water is left to the flow field and its water cost.
 */
export function lineOfSight(a: Vec, b: Vec, arena: ArenaShape, r = 0, waterBlocks = false): boolean {
  for (const o of arena.obstacles) {
    if (!waterBlocks && !isSolid(o)) continue;
    if (o.shape === 'circle') { if (segmentPointDistance(a, b, o) < o.r + r) return false; }
    else if (segmentHitsRect(a, b, o.x - r, o.y - r, o.x + o.w + r, o.y + o.h + r)) return false;
  }
  // Stage 3a: terrain zones never cut sight (a cliff, a river, thorns — design 08.10.2026, step 1); the walk's straight
  // shortcut (`waterBlocks`) leaves every zone to the flow field: a cliff cannot be walked, water and thorns cost more.
  if (waterBlocks && arena.terrain) for (const z of arena.terrain) if (segmentTouchesArea(a, b, z, r)) return false;
  return true;
}

/**
 * Water cost of the flow field: `null` — the pond is impassable (stage A); a number — cost multiplier of a water cell (stage B:
 * 1 ÷ water speed; a river cell too, stage 3a). `thornCost` (stage 3a, М3) — of a thorn cell (1 ÷ the enemies' speed there).
 */
export interface FlowOptions { waterCost: number | null; thornCost?: number }

/**
 * Flow field to the hero (iteration 2, stages A–B; docs/realtime-prototype.md, section 9г):
 * a grid of 0.5-unit cells, 8 directions, Dijkstra from the hero's cell over cell costs
 * (water: `waterCost`; the crowd: `extra`, the density penalty toggle). Each reachable cell stores a unit direction
 * to its best neighbour; `direction` blends the four nearest cells (bilinear) so a body
 * turns smoothly instead of zigzagging between cell centers. Arena edges are not blocked
 * in the grid: the body clamp keeps enemies inside, and edge spawns must stay reachable.
 */
export class FlowField {
  readonly cell = 0.5;
  readonly cols: number;
  readonly rows: number;
  /** 1 — no body of the field radius fits (wall, tree, impassable pond). */
  readonly blocked: Uint8Array;
  /** Cost multiplier of entering a cell (1 on grass, `waterCost` in water). */
  readonly cost: Float32Array;
  /** Extra cost per cell set by the caller before a rebuild (density penalty: enemies standing there); 0 by default. */
  readonly extra: Float32Array;
  readonly distance: Float32Array;
  private readonly dirX: Float32Array;
  private readonly dirY: Float32Array;
  private readonly heap: Int32Array;
  private readonly heapKey: Float32Array;
  private targetCell = -1;
  /** Milliseconds of the last rebuild and the number of rebuilds (debug panel, perf report). */
  lastBuildMs = 0;
  builds = 0;

  constructor(arena: ArenaShape, private readonly bodyRadius: number, readonly options: FlowOptions = { waterCost: null }) {
    this.cols = Math.ceil(arena.width / this.cell);
    this.rows = Math.ceil(arena.height / this.cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.cost = new Float32Array(n).fill(1);
    this.extra = new Float32Array(n);
    this.distance = new Float32Array(n).fill(Infinity);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    // A cell enters the heap once per improving neighbour: 8 × cells is enough.
    this.heap = new Int32Array(n * 8 + 8);
    this.heapKey = new Float32Array(n * 8 + 8);
    const clearance = bodyRadius * 0.9;
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++) {
      const c = this.center(col, row), i = row * this.cols + col;
      for (const o of arena.obstacles) {
        if (o.shape === 'circle') {
          const d = Math.hypot(c.x - o.x, c.y - o.y);
          if (o.kind === 'pond' && options.waterCost !== null) { if (d < o.r) this.cost[i] = Math.max(this.cost[i], options.waterCost); continue; }
          if (d < o.r + clearance) this.blocked[i] = 1;
        } else {
          const cx = Math.max(o.x, Math.min(c.x, o.x + o.w)), cy = Math.max(o.y, Math.min(c.y, o.y + o.h));
          if (Math.hypot(c.x - cx, c.y - cy) < clearance) this.blocked[i] = 1;
        }
      }
      // Stage 3a: a cliff blocks as a wall (with the body clearance); a river costs as the pond; thorns cost `thornCost`.
      if (arena.terrain) for (const z of arena.terrain) {
        if (z.kind === 'cliff') { if (areaDistance(z, c).d < clearance) this.blocked[i] = 1; continue; }
        if (!areaContains(z, c)) continue;
        if (z.kind === 'river') { if (options.waterCost !== null) this.cost[i] = Math.max(this.cost[i], options.waterCost); else this.blocked[i] = 1; }
        else this.cost[i] = Math.max(this.cost[i], options.thornCost ?? 1);
      }
    }
  }

  get radius(): number { return this.bodyRadius; }

  center(col: number, row: number): Vec { return { x: (col + 0.5) * this.cell, y: (row + 0.5) * this.cell }; }

  cellOf(p: Vec): number {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(p.x / this.cell)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(p.y / this.cell)));
    return row * this.cols + col;
  }

  /** A cell has a usable direction: free and reached by the last rebuild. */
  reachable(i: number): boolean { return !this.blocked[i] && Number.isFinite(this.distance[i]); }

  /**
   * Rebuilds the field towards `target` (the hero). Skipped when the target stays in the same
   * cell, unless `force`. Returns true when the field was rebuilt.
   */
  setTarget(target: Vec, force = false): boolean {
    const start = this.cellOf(target);
    if (!force && start === this.targetCell) return false;
    const t0 = clockMs();
    this.targetCell = start;
    const d = this.distance, cols = this.cols, rows = this.rows, heap = this.heap, keys = this.heapKey;
    d.fill(Infinity);
    let size = 0;
    const push = (i: number, key: number): void => {
      let k = size++;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        if (keys[parent] <= key) break;
        heap[k] = heap[parent]; keys[k] = keys[parent]; k = parent;
      }
      heap[k] = i; keys[k] = key;
    };
    const pop = (): number => {
      const top = heap[0], lastI = heap[--size], lastK = keys[size];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= size) break;
        if (c + 1 < size && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastK) break;
        heap[k] = heap[c]; keys[k] = keys[c]; k = c;
      }
      heap[k] = lastI; keys[k] = lastK;
      return top;
    };
    if (!this.blocked[start]) { d[start] = 0; push(start, 0); }
    else {
      // The hero (smaller than an enemy body) stands where no enemy fits: seed the free cells around.
      const sc = start % cols, sr = (start - sc) / cols;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
        const nc = sc + dc, nr = sr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (this.blocked[ni]) continue;
        const c = this.center(nc, nr), key = Math.hypot(c.x - target.x, c.y - target.y) / this.cell;
        if (key < d[ni]) { d[ni] = key; push(ni, key); }
      }
    }
    while (size > 0) {
      const key = keys[0], cur = pop();
      if (key > d[cur]) continue;
      const cc = cur % cols, cr = (cur - cc) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (this.blocked[ni]) continue;
        // No corner cutting: a diagonal step needs both side cells free.
        if (dr && dc && (this.blocked[cr * cols + nc] || this.blocked[nr * cols + cc])) continue;
        const nd = d[cur] + (dr && dc ? Math.SQRT2 : 1) * (this.cost[cur] + this.extra[cur] + this.cost[ni] + this.extra[ni]) * 0.5;
        if (nd < d[ni]) { d[ni] = nd; push(ni, nd); }
      }
    }
    // Direction of every reached cell: towards its best neighbour; the hero's cell points at the hero.
    for (let i = 0; i < d.length; i++) {
      this.dirX[i] = 0; this.dirY[i] = 0;
      if (this.blocked[i] || !Number.isFinite(d[i])) continue;
      const col = i % cols, row = (i - col) / cols;
      if (i === start) {
        const c = this.center(col, row), dx = target.x - c.x, dy = target.y - c.y, len = Math.hypot(dx, dy);
        if (len > 1e-6) { this.dirX[i] = dx / len; this.dirY[i] = dy / len; }
        continue;
      }
      let best = -1, bestD = d[i], bdc = 0, bdr = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (this.blocked[ni]) continue;
        if (dr && dc && (this.blocked[row * cols + nc] || this.blocked[nr * cols + col])) continue;
        if (d[ni] < bestD) { bestD = d[ni]; best = ni; bdc = dc; bdr = dr; }
      }
      if (best < 0) {
        // A seeded cell next to a hero standing in a tight spot: head straight for the hero.
        const c = this.center(col, row), dx = target.x - c.x, dy = target.y - c.y, len = Math.hypot(dx, dy);
        if (len > 1e-6) { this.dirX[i] = dx / len; this.dirY[i] = dy / len; }
        continue;
      }
      const len = Math.hypot(bdc, bdr);
      this.dirX[i] = bdc / len; this.dirY[i] = bdr / len;
    }
    this.lastBuildMs = clockMs() - t0;
    this.builds++;
    return true;
  }

  /**
   * Unit direction to follow at `p` into `out`: a bilinear blend of the four nearest reachable
   * cells. Where the blend cancels out (a split around an obstacle) the own cell decides; a body
   * pushed into a blocked or unreached cell heads for the nearest reachable one. False — no way known.
   */
  direction(p: Vec, out: Vec): boolean {
    const fx = p.x / this.cell - 0.5, fy = p.y / this.cell - 0.5;
    const c0 = Math.floor(fx), r0 = Math.floor(fy), tx = fx - c0, ty = fy - r0;
    let x = 0, y = 0, weight = 0;
    for (let k = 0; k < 4; k++) {
      const col = c0 + (k & 1), row = r0 + (k >> 1);
      if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
      const i = row * this.cols + col;
      if (!this.reachable(i)) continue;
      const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      x += this.dirX[i] * w; y += this.dirY[i] * w; weight += w;
    }
    const len = Math.hypot(x, y);
    if (weight > 1e-6 && len > 0.3 * weight) { out.x = x / len; out.y = y / len; return true; }
    const own = this.cellOf(p);
    if (this.reachable(own) && (this.dirX[own] || this.dirY[own])) { out.x = this.dirX[own]; out.y = this.dirY[own]; return true; }
    // Off the field: steer to the nearest reachable cell (rings up to 3 cells out).
    const oc = own % this.cols, orow = (own - oc) / this.cols;
    let best = -1, bestScore = Infinity;
    for (let ring = 1; ring <= 3 && best < 0; ring++) {
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const nc = oc + dc, nr = orow + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (!this.reachable(ni)) continue;
        const c = this.center(nc, nr), score = Math.hypot(c.x - p.x, c.y - p.y);
        if (score < bestScore) { bestScore = score; best = ni; }
      }
    }
    if (best < 0) return false;
    const bc = best % this.cols, c = this.center(bc, (best - bc) / this.cols);
    const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy);
    if (l < 1e-6) return false;
    out.x = dx / l; out.y = dy / l;
    return true;
  }
}
