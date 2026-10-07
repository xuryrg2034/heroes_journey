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

/**
 * Goal of an arena (stage 3, docs/realtime-prototype.md section 3): kill N (`killGoal` slider),
 * press every button, or kill the marked enemies. After the goals the door opens and the greed stage runs.
 */
export type ArenaGoal = 'kills' | 'buttons' | 'marked';

/** A marked enemy of the third arena: placed at the start, a visible target mark. */
export interface MarkedSpec { x: number; y: number; color: number; hp: number }

export interface ArenaLayout {
  id: string;
  name: string;
  /** One line on the arena menu. */
  summary: string;
  goal: ArenaGoal;
  width: number;
  height: number;
  heroStart: Vec;
  obstacles: Obstacle[];
  /** Buttons: a chain link of any color; pressed once and for all when a chain ends on it. */
  buttons: Vec[];
  /** The exit: opens after the goals; entering it (chain end or jump landing) wins. */
  door: Vec;
  marked: MarkedSpec[];
}

const wall = (x: number, y: number, w: number, h: number): RectObstacle => ({ shape: 'rect', kind: 'wall', x, y, w, h });
const tree = (x: number, y: number): CircleObstacle => ({ shape: 'circle', kind: 'tree', x, y, r: 0.42 });
const pond = (x: number, y: number, r: number): CircleObstacle => ({ shape: 'circle', kind: 'pond', x, y, r });

/** Arena 1 «Убить 30» (the stage 1 clearing): open middle around the hero, cover at the sides, the door on top. */
export const KILL_ARENA: ArenaLayout = {
  id: 'kills',
  name: 'Убить 30',
  summary: 'Поляна: убей цепью 30 врагов. Потом откроется дверь сверху.',
  goal: 'kills',
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
  buttons: [],
  door: { x: 8, y: 0.7 },
  marked: [],
};

/** Arena 2 «Нажать 3 кнопки»: two wall screens split the yard, buttons behind them and behind the pond. */
export const BUTTON_ARENA: ArenaLayout = {
  id: 'buttons',
  name: 'Нажать 3 кнопки',
  summary: 'Двор: закончи цепь на каждой из трёх кнопок (кнопка — звено любого цвета). Дверь — снизу.',
  goal: 'buttons',
  width: 16,
  height: 10,
  heroStart: { x: 8, y: 5 },
  obstacles: [
    wall(4, 3, 1, 4),
    wall(11, 3, 1, 4),
    wall(6, 8, 1, 1),
    wall(9, 8, 1, 1),
    pond(8, 2.3, 0.9),
    tree(2, 8.2),
    tree(14, 8.2),
    tree(2.4, 1.6),
    tree(13.6, 1.6),
    tree(6.2, 1.2),
  ],
  buttons: [{ x: 1.6, y: 5 }, { x: 14.4, y: 5 }, { x: 8, y: 0.8 }],
  door: { x: 8, y: 9.3 },
  marked: [],
};

/** Arena 3 «Убить отмеченных и выйти в дверь»: a walled den, five marked enemies (three tough), the door far right. */
export const MARKED_ARENA: ArenaLayout = {
  id: 'marked',
  name: 'Отмеченные и дверь',
  summary: 'Логово: убей 5 отмеченных врагов (трое крепкие), затем выйди в дверь справа.',
  goal: 'marked',
  width: 16,
  height: 10,
  heroStart: { x: 2.5, y: 4.5 },
  obstacles: [
    wall(5, 0, 1, 3),
    wall(10, 7, 1, 3),
    wall(2, 6, 3, 1),
    wall(11, 3, 3, 1),
    pond(8, 7.6, 0.8),
    tree(3.5, 2.6),
    tree(12.5, 6.5),
    tree(7, 2.5),
    tree(14.5, 1.5),
  ],
  buttons: [],
  door: { x: 15.3, y: 5.2 },
  marked: [
    { x: 7.5, y: 5, color: 0, hp: 0 },
    { x: 12.5, y: 1.5, color: 1, hp: 2 },
    { x: 13, y: 8.5, color: 2, hp: 1 },
    { x: 5.5, y: 8.5, color: 3, hp: 0 },
    { x: 9, y: 1.2, color: 2, hp: 2 },
  ],
};

/** The three arenas of the playtest, keys 1–3 on the menu. */
export const ARENAS: readonly ArenaLayout[] = [KILL_ARENA, BUTTON_ARENA, MARKED_ARENA];

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
