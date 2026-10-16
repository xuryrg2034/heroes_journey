/**
 * Camera of the real-time arena (docs/realtime-stage3.md, section 11). View only: no Pixi, no DOM, nothing here touches
 * the simulation, the journal or the hash. `Camera` keeps the world point in the centre of the view and follows the hero
 * softly; `edgeArrow` places an off-screen pointer on the border of the view. Unit-tested in Node (camera.spec.ts).
 */

/** The camera numbers (design 09.10.2026): constants of the view, not params of the simulation. */
export const CAMERA = {
  /** Dead zone round the centre (units): the goal point may move inside it without moving the camera. */
  deadW: 2,
  deadH: 1.5,
  /** Smoothing time (real seconds): the camera closes ~63% of the distance to its target in this time. */
  smooth: 0.15,
  /** Lead towards the pointer: this share of the hero→pointer vector, at most `leadMaxX` / `leadMaxY` units. */
  lead: 0.2,
  leadMaxX: 2,
  leadMaxY: 1.2,
  /** Reference view (units) the scale is fitted to: the whole 16×10 arena fits as before the camera. */
  refW: 16,
  refH: 10,
  /**
   * Design smoke v65 (D2): a boss fight opens on the boss — the camera glides from him to the hero in this many real seconds
   * (ease-in-out); the game holds its first tick meanwhile. The scale stays the fights' own.
   */
  bossIntro: 1.2,
} as const;

/** The size of the view in units and the arena it must stay inside. */
export interface CameraBounds { viewW: number; viewH: number; arenaW: number; arenaH: number }

export interface Vec2 { x: number; y: number }

const clampAxis = (c: number, view: number, arena: number): number => (arena <= view ? arena / 2 : Math.max(view / 2, Math.min(arena - view / 2, c)));

/** A box in arena units. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** Task 38 (design smoke v65): keep `box` (the boss's drawing) in the view too, as far as the `hero` box stays in it. */
export interface CameraKeep { hero: Box; box: Box }

/**
 * The centre `c` on one axis moved the least so that [lo, hi] is in the view of size `view`, as far as [hlo, hhi] (the hero)
 * stays in it: the hero first — a box that does not fit with him is kept as near as he allows.
 */
const keepAxis = (c: number, view: number, hlo: number, hhi: number, lo: number, hi: number): number => {
  const h = view / 2;
  return Math.max(hhi - h, Math.min(hlo + h, Math.max(hi - h, Math.min(lo + h, c))));
};
const kept = (x: number, y: number, b: CameraBounds, keep: CameraKeep | null | undefined): Vec2 => (keep
  ? { x: keepAxis(x, b.viewW, keep.hero.x0, keep.hero.x1, keep.box.x0, keep.box.x1), y: keepAxis(y, b.viewH, keep.hero.y0, keep.hero.y1, keep.box.y0, keep.box.y1) }
  : { x, y });

export class Camera {
  x = 0;
  y = 0;

  /** Where `snap` puts the camera (it does not move it). */
  target(hero: Vec2, b: CameraBounds, keep?: CameraKeep | null): Vec2 {
    const t = kept(hero.x, hero.y, b, keep);
    return { x: clampAxis(t.x, b.viewW, b.arenaW), y: clampAxis(t.y, b.viewH, b.arenaH) };
  }

  /** Puts the camera on the hero at once (a new fight, a teleport): no lead, no dead zone; `keep` — the boss in view too. */
  snap(hero: Vec2, b: CameraBounds, keep?: CameraKeep | null): void {
    const t = this.target(hero, b, keep);
    this.x = t.x; this.y = t.y;
  }

  /** Puts the camera's centre at `p`, inside the arena. */
  place(p: Vec2, b: CameraBounds): void {
    this.x = clampAxis(p.x, b.viewW, b.arenaW);
    this.y = clampAxis(p.y, b.viewH, b.arenaH);
  }

  /** Keeps the camera inside the arena after the view changed size (window resize, the debug panel). */
  clamp(b: CameraBounds): void {
    this.x = clampAxis(this.x, b.viewW, b.arenaW);
    this.y = clampAxis(this.y, b.viewH, b.arenaH);
  }

  /**
   * One frame. `hero` — the drawn hero; `lead` — the hero→pointer vector in units (null — none); `dt` — real seconds
   * (0 on pause and in menus); `frozen` — the camera stands (a chain is being drawn: the world must not move under the
   * pointer); `keep` — task 38: a box (the boss) kept in view as far as the hero stays in it.
   */
  update(dt: number, hero: Vec2, lead: Vec2 | null, frozen: boolean, b: CameraBounds, keep?: CameraKeep | null): void {
    if (frozen || dt <= 0) { this.clamp(b); return; }
    const gx = hero.x + (lead ? Math.max(-CAMERA.leadMaxX, Math.min(CAMERA.leadMaxX, lead.x * CAMERA.lead)) : 0);
    const gy = hero.y + (lead ? Math.max(-CAMERA.leadMaxY, Math.min(CAMERA.leadMaxY, lead.y * CAMERA.lead)) : 0);
    // The dead zone: the camera moves only as far as needed to keep the goal on its border.
    const hw = CAMERA.deadW / 2, hh = CAMERA.deadH / 2;
    const tx = gx > this.x + hw ? gx - hw : gx < this.x - hw ? gx + hw : this.x;
    const ty = gy > this.y + hh ? gy - hh : gy < this.y - hh ? gy + hh : this.y;
    const { x: kx, y: ky } = kept(tx, ty, b, keep);
    const k = 1 - Math.exp(-dt / CAMERA.smooth);
    this.x += (kx - this.x) * k;
    this.y += (ky - this.y) * k;
    this.clamp(b);
  }

  /** The point is inside the view (grown by `margin` units). */
  sees(p: Vec2, b: CameraBounds, margin = 0): boolean {
    return Math.abs(p.x - this.x) <= b.viewW / 2 + margin && Math.abs(p.y - this.y) <= b.viewH / 2 + margin;
  }
}

/**
 * Where the pointer to an off-screen point sits: the point where the ray from the centre of the free screen area to the
 * target crosses the rectangle `[left, right] × [top, bottom]` (screen pixels, already inset from the border). `dx, dy` —
 * the screen offset of the target from the centre. Returns the position and the angle (rad) of the arrow, which points
 * outward.
 */
export function edgeArrow(cx: number, cy: number, dx: number, dy: number, left: number, top: number, right: number, bottom: number): { x: number; y: number; angle: number } {
  // Scale of the ray at which it leaves the inset rectangle (separate bounds on each side: the HUD is taller on top).
  const sx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
  const sy = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) };
}

/** The free rectangle (stage pixels) the pointers stay in: the HUD, the action bar and the jump button are outside it. */
export interface EdgeRect { left: number; top: number; right: number; bottom: number }

/** A pointer to place: the screen offset of its target from the centre, and what it points at. */
export type EdgeArrowKind = 'threat' | 'goal' | 'spawn';
export interface EdgeItem { dx: number; dy: number; kind: EdgeArrowKind }
export interface PlacedArrow { x: number; y: number; angle: number; kind: EdgeArrowKind }

/** Pointers closer than this (px) overlap: a goal arrow then slides along the border off a danger arrow. */
export const ARROW_CLASH = 26;
/** Phase A (Т5): spawn markers are grouped by direction from the centre — at most one spawn arrow per sector of 45°. */
export const SPAWN_SECTORS = 8;

/**
 * Places the pointers on the border of `rect` and orders them for drawing: spawn markers first, then goals, dangers last
 * (on top — a danger is more urgent than a goal). A goal arrow that would sit on a danger arrow slides along the border by
 * `ARROW_CLASH` (to the side that stays in the rectangle) so that both read. Spawn arrows (phase A, Т5) are grouped and give way:
 * one per sector of 45° around the centre (the nearest marker of the sector — a wave reads as one arrow, not a fence), and
 * one that would sit on any other arrow or on a spawn arrow already kept is dropped.
 */
export function placeEdgeArrows(items: readonly EdgeItem[], cx: number, cy: number, rect: EdgeRect): PlacedArrow[] {
  const all = items.map(i => ({ ...edgeArrow(cx, cy, i.dx, i.dy, rect.left, rect.top, rect.right, rect.bottom), kind: i.kind }));
  const placed = all.filter(a => a.kind !== 'spawn');
  const threats = placed.filter(a => a.kind === 'threat');
  const inside = (x: number, y: number): boolean => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  for (const g of placed) {
    if (g.kind !== 'goal') continue;
    for (const t of threats) {
      if (Math.hypot(g.x - t.x, g.y - t.y) >= ARROW_CLASH) continue;
      // Along the border: perpendicular to the outward direction.
      const tx = -Math.sin(g.angle), ty = Math.cos(g.angle);
      const sign = inside(g.x + tx * ARROW_CLASH, g.y + ty * ARROW_CLASH) ? 1 : -1;
      g.x = Math.max(rect.left, Math.min(rect.right, g.x + tx * ARROW_CLASH * sign));
      g.y = Math.max(rect.top, Math.min(rect.bottom, g.y + ty * ARROW_CLASH * sign));
      break;
    }
  }
  const nearest = new Map<number, { arrow: PlacedArrow; d: number }>();
  items.forEach((item, i) => {
    if (item.kind !== 'spawn') return;
    const sector = ((Math.round(Math.atan2(item.dy, item.dx) / (2 * Math.PI / SPAWN_SECTORS)) % SPAWN_SECTORS) + SPAWN_SECTORS) % SPAWN_SECTORS;
    const d = Math.hypot(item.dx, item.dy), held = nearest.get(sector);
    if (!held || d < held.d) nearest.set(sector, { arrow: all[i], d });
  });
  const spawns: PlacedArrow[] = [];
  for (const [, { arrow }] of [...nearest].sort((a, b) => a[0] - b[0])) {
    if ([...placed, ...spawns].some(o => Math.hypot(arrow.x - o.x, arrow.y - o.y) < ARROW_CLASH)) continue;
    spawns.push(arrow);
  }
  return [...spawns, ...placed.filter(a => a.kind === 'goal'), ...threats];
}
