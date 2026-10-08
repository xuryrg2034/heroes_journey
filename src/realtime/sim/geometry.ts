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

/** What the geometry needs of an arena: its size and obstacles (the arena template, arenas.ts, adds the rest). */
export interface ArenaShape {
  width: number;
  height: number;
  obstacles: Obstacle[];
}

/** Obstacle builders for arena templates. A tree trunk is 0.42 units. */
export const wall = (x: number, y: number, w: number, h: number): RectObstacle => ({ shape: 'rect', kind: 'wall', x, y, w, h });
export const tree = (x: number, y: number): CircleObstacle => ({ shape: 'circle', kind: 'tree', x, y, r: 0.42 });
export const pond = (x: number, y: number, r: number): CircleObstacle => ({ shape: 'circle', kind: 'pond', x, y, r });

/** Wall clock for the rebuild time shown on the debug panel only (never part of the simulation state). */
const clockMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function dist(a: Vec, b: Vec): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/**
 * Solid obstacles: walls and trees. The pond is passable water since iteration 2, stage B
 * (docs/realtime-prototype.md, section 9г, item 3): it slows walkers (`waterSlow`) and blocks nothing.
 */
export function isSolid(o: Obstacle): boolean { return o.kind !== 'pond'; }

/** True when the point is in a pond (the center of a body decides). */
export function inWater(p: Vec, arena: ArenaShape): boolean {
  for (const o of arena.obstacles) if (o.kind === 'pond' && Math.hypot(p.x - o.x, p.y - o.y) < o.r) return true;
  return false;
}

/** Moves a circle out of every solid obstacle and keeps it inside the arena bounds. */
export function pushOutOfObstacles(p: Vec, r: number, arena: ArenaShape): void {
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
  p.x = Math.max(r, Math.min(arena.width - r, p.x));
  p.y = Math.max(r, Math.min(arena.height - r, p.y));
}

/** True when a circle of radius r at p overlaps a solid obstacle or the arena edge (water is passable). */
export function blockedAt(p: Vec, r: number, arena: ArenaShape): boolean {
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
  return true;
}

/** Water cost of the flow field: `null` — the pond is impassable (stage A); a number — cost multiplier of a water cell (stage B: 1 ÷ water speed). */
export interface FlowOptions { waterCost: number | null }

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
