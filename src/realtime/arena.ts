/**
 * Arena geometry of the real-time prototype: bounds, obstacles, collision push-out,
 * line of sight and a flow field that leads enemies around obstacles to the hero.
 * Units: 1 unit ≈ one cell of the turn-based board.
 */

export interface Vec { x: number; y: number }

export type ObstacleKind = 'wall' | 'tree' | 'pond';
export interface RectObstacle { shape: 'rect'; kind: 'wall'; x: number; y: number; w: number; h: number }
export interface CircleObstacle { shape: 'circle'; kind: 'tree' | 'pond'; x: number; y: number; r: number }
export type Obstacle = RectObstacle | CircleObstacle;

export interface ArenaLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  heroStart: Vec;
  obstacles: Obstacle[];
}

const wall = (x: number, y: number, w: number, h: number): RectObstacle => ({ shape: 'rect', kind: 'wall', x, y, w, h });
const tree = (x: number, y: number): CircleObstacle => ({ shape: 'circle', kind: 'tree', x, y, r: 0.42 });
const pond = (x: number, y: number, r: number): CircleObstacle => ({ shape: 'circle', kind: 'pond', x, y, r });

/** Stage 1 arena: open middle around the hero, cover at the sides. Stage 3 adds the three goal arenas. */
export const TEST_ARENA: ArenaLayout = {
  id: 'clearing',
  name: 'Поляна',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(3, 2, 1, 3),
    wall(10, 7, 3, 1),
    wall(12, 1, 1, 2),
    tree(5.5, 7.5),
    tree(2.5, 7.5),
    tree(9.5, 2.5),
    tree(14.5, 5.5),
    tree(6.5, 1.5),
    pond(12.6, 4.6, 0.95),
  ],
};

export function dist(a: Vec, b: Vec): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Moves a circle out of every obstacle and keeps it inside the arena bounds. */
export function pushOutOfObstacles(p: Vec, r: number, arena: ArenaLayout): void {
  for (const o of arena.obstacles) {
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
  p.x = Math.max(r, Math.min(arena.width - r, p.x));
  p.y = Math.max(r, Math.min(arena.height - r, p.y));
}

/** True when a circle of radius r at p overlaps an obstacle or the arena edge. */
export function blockedAt(p: Vec, r: number, arena: ArenaLayout): boolean {
  if (p.x < r || p.y < r || p.x > arena.width - r || p.y > arena.height - r) return true;
  for (const o of arena.obstacles) {
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
 * Stage 2 uses it with r = 0 for chain links when obstacles break links.
 */
export function lineOfSight(a: Vec, b: Vec, arena: ArenaLayout, r = 0): boolean {
  for (const o of arena.obstacles) {
    if (o.shape === 'circle') { if (segmentPointDistance(a, b, o) < o.r + r) return false; }
    else if (segmentHitsRect(a, b, o.x - r, o.y - r, o.x + o.w + r, o.y + o.h + r)) return false;
  }
  return true;
}

/** Distance field on a fine grid: enemies follow it when the hero is out of sight. */
export class FlowField {
  readonly cell = 0.5;
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly distance: Float32Array;
  private target: Vec = { x: -1, y: -1 };

  constructor(arena: ArenaLayout, private readonly bodyRadius: number) {
    this.cols = Math.ceil(arena.width / this.cell);
    this.rows = Math.ceil(arena.height / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.distance = new Float32Array(this.cols * this.rows).fill(Infinity);
    for (let row = 0; row < this.rows; row++) for (let col = 0; col < this.cols; col++)
      this.blocked[row * this.cols + col] = blockedAt(this.center(col, row), bodyRadius * 0.9, arena) ? 1 : 0;
  }

  get radius(): number { return this.bodyRadius; }

  center(col: number, row: number): Vec { return { x: (col + 0.5) * this.cell, y: (row + 0.5) * this.cell }; }

  private index(p: Vec): number {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(p.x / this.cell)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(p.y / this.cell)));
    return row * this.cols + col;
  }

  /** Recomputes the field only when the target cell changes. */
  setTarget(target: Vec): void {
    const start = this.index(target);
    if (start === this.index(this.target)) { this.target = { ...target }; return; }
    this.target = { ...target };
    const d = this.distance; d.fill(Infinity); d[start] = 0;
    // Small grid (≈640 cells): a simple Dijkstra over an array queue is fast enough.
    const open: number[] = [start];
    const queued = new Uint8Array(d.length); queued[start] = 1;
    while (open.length) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[best]]) best = i;
      const cur = open[best]; open[best] = open[open.length - 1]; open.pop(); queued[cur] = 0;
      const cc = cur % this.cols, cr = (cur - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (this.blocked[ni]) continue;
        if (dr && dc && (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc])) continue;
        const nd = d[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (nd < d[ni]) { d[ni] = nd; if (!queued[ni]) { queued[ni] = 1; open.push(ni); } }
      }
    }
  }

  /** Point to steer towards: the center of the neighbouring cell closest to the target. */
  nextWaypoint(p: Vec): Vec | null {
    const i = this.index(p), col = i % this.cols, row = (i - col) / this.cols;
    let best = -1, bestD = this.distance[i];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const ni = nr * this.cols + nc;
      if (this.blocked[ni]) continue;
      if (dr && dc && (this.blocked[row * this.cols + nc] || this.blocked[nr * this.cols + col])) continue;
      if (this.distance[ni] < bestD) { bestD = this.distance[ni]; best = ni; }
    }
    if (best < 0) return null;
    const bc = best % this.cols;
    return this.center(bc, (best - bc) / this.cols);
  }
}
