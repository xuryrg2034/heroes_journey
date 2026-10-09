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
} as const;

/** The size of the view in units and the arena it must stay inside. */
export interface CameraBounds { viewW: number; viewH: number; arenaW: number; arenaH: number }

export interface Vec2 { x: number; y: number }

const clampAxis = (c: number, view: number, arena: number): number => (arena <= view ? arena / 2 : Math.max(view / 2, Math.min(arena - view / 2, c)));

export class Camera {
  x = 0;
  y = 0;

  /** Puts the camera on the hero at once (a new fight, a teleport): no lead, no dead zone. */
  snap(hero: Vec2, b: CameraBounds): void {
    this.x = clampAxis(hero.x, b.viewW, b.arenaW);
    this.y = clampAxis(hero.y, b.viewH, b.arenaH);
  }

  /** Keeps the camera inside the arena after the view changed size (window resize, the debug panel). */
  clamp(b: CameraBounds): void {
    this.x = clampAxis(this.x, b.viewW, b.arenaW);
    this.y = clampAxis(this.y, b.viewH, b.arenaH);
  }

  /**
   * One frame. `hero` — the drawn hero; `lead` — the hero→pointer vector in units (null — none); `dt` — real seconds
   * (0 on pause and in menus); `frozen` — the camera stands (a chain is being drawn: the world must not move under the
   * pointer).
   */
  update(dt: number, hero: Vec2, lead: Vec2 | null, frozen: boolean, b: CameraBounds): void {
    if (frozen || dt <= 0) { this.clamp(b); return; }
    const gx = hero.x + (lead ? Math.max(-CAMERA.leadMaxX, Math.min(CAMERA.leadMaxX, lead.x * CAMERA.lead)) : 0);
    const gy = hero.y + (lead ? Math.max(-CAMERA.leadMaxY, Math.min(CAMERA.leadMaxY, lead.y * CAMERA.lead)) : 0);
    // The dead zone: the camera moves only as far as needed to keep the goal on its border.
    const hw = CAMERA.deadW / 2, hh = CAMERA.deadH / 2;
    const tx = gx > this.x + hw ? gx - hw : gx < this.x - hw ? gx + hw : this.x;
    const ty = gy > this.y + hh ? gy - hh : gy < this.y - hh ? gy + hh : this.y;
    const k = 1 - Math.exp(-dt / CAMERA.smooth);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
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
