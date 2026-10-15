/**
 * Task 38 «Гарнизон, шаг 1а» (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md): drawing helpers of the garrison's
 * view, as jailerView.ts — pure, they read nothing of the world and write to a Graphics or a GraphicsContext:
 * - the tether (a leash): a navy rope with links of the holder's colour, sagging a little; a tether the drawn chain's dash will cut
 *   (the plan's `cuts`) — red and thicker, with the cut mark (two short slashes) where the dash crosses it;
 * - the snap after the dash: the two halves recoil from the cut point and fade;
 * - the hound's frenzy: a red jagged ring that flickers round the body and two speed streaks behind it;
 * - the stand-in silhouettes of the guard, the dog handler, the hound and the Castellan (until the art comes).
 * Coordinates are arena pixels.
 */
import type { Graphics, GraphicsContext } from 'pixi.js';

const NAVY = 0x18232d;
/** The cut tether (the dash will cut it), the frenzy. */
export const CUT_RED = 0xff3b30;
export const FRENZY_RED = 0xe0302a;
const STEEL = 0xa9b8c6;
const LEATHER = 0x7a5232;

/** A point on the leash `a → b` at share `t`, with a sag of `sag` px at the middle (the rope hangs; the cut reads on the chord). */
function leashPoint(ax: number, ay: number, bx: number, by: number, t: number, sag: number): { x: number; y: number } {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t + Math.sin(Math.PI * t) * sag };
}

/**
 * The leash from the holder (`ax`, `ay`) to the held body: a navy rope under links of `ink`. `cut` — the drawn chain's dash will cut
 * it: red, thicker, no sag (the chord the cut reads on), with the cut mark at `at` (the crossing point; null — at the middle).
 */
export function drawLeash(g: Graphics, ax: number, ay: number, bx: number, by: number, ink: number, cut: boolean, at: { x: number; y: number } | null = null): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const sag = cut ? 0 : Math.min(10, len * 0.06), n = Math.max(6, Math.round(len / 9));
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) { const p = leashPoint(ax, ay, bx, by, i / n, sag); pts.push(p.x, p.y); }
  g.poly(pts, false).stroke({ color: NAVY, width: cut ? 7 : 5, alpha: 0.9, cap: 'round', join: 'round' });
  if (cut) g.poly(pts, false).stroke({ color: CUT_RED, width: 3.5, alpha: 1, cap: 'round', join: 'round' });
  else {
    // The links: short dashes of the holder's colour along the rope.
    for (let i = 0; i < n; i += 2) g.moveTo(pts[i * 2], pts[i * 2 + 1]).lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
    g.stroke({ color: ink, width: 2.5, alpha: 0.95, cap: 'round' });
  }
  if (cut) drawCutMark(g, at ?? { x: (ax + bx) / 2, y: (ay + by) / 2 }, Math.atan2(by - ay, bx - ax));
}

/** The cut mark: two short slashes across the tether at `p` (the tether's direction `angle`), white on navy. */
export function drawCutMark(g: Graphics, p: { x: number; y: number }, angle: number): void {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux, h = 15, off = 5;
  for (const [w, c] of [[8, NAVY], [4, 0xffffff]] as const) {
    for (const s of [-1, 1]) {
      const cx = p.x + ux * off * s, cy = p.y + uy * off * s;
      g.moveTo(cx - nx * h + ux * 3, cy - ny * h + uy * 3).lineTo(cx + nx * h - ux * 3, cy + ny * h - uy * 3);
    }
    g.stroke({ color: c, width: w, cap: 'round' });
  }
}

/** The snap: the halves of a cut tether recoil from `p` towards its ends and fade (`k` — 1 at the cut, 0 at the end). */
export function drawSnap(g: Graphics, ax: number, ay: number, bx: number, by: number, p: { x: number; y: number }, k: number, ink: number): void {
  const a = Math.max(0, Math.min(1, k)), pull = 1 - a;
  for (const [ex, ey] of [[ax, ay], [bx, by]] as const) {
    // Each half: from its end to a point that slides back from the cut towards the end, curling a little.
    const tx = p.x + (ex - p.x) * pull * 0.85, ty = p.y + (ey - p.y) * pull * 0.85 + 6 * pull;
    g.moveTo(ex, ey).lineTo(tx, ty).stroke({ color: NAVY, width: 5, alpha: 0.8 * a, cap: 'round' });
    g.moveTo(ex, ey).lineTo(tx, ty).stroke({ color: ink, width: 2.5, alpha: 0.9 * a, cap: 'round' });
  }
  // The spark of the cut.
  g.circle(p.x, p.y, 4 + 16 * pull).stroke({ color: 0xffffff, width: 3, alpha: 0.8 * a });
}

/** The hound's frenzy: a red jagged ring round the body (radius `r`), flickering by `clock`, and two streaks behind (`dx`, `dy` — its way). */
export function drawFrenzy(g: Graphics, x: number, y: number, r: number, clock: number, dx: number, dy: number): void {
  const n = 12, R = r * 1.45, pts: number[] = [], wob = Math.floor(clock * 14) % 2;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + clock * 3, rr = i % 2 ? R : R * (0.78 + 0.06 * wob);
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.poly(pts).fill({ color: FRENZY_RED, alpha: 0.18 }).stroke({ color: FRENZY_RED, width: 3, alpha: 0.95 });
  const len = Math.hypot(dx, dy);
  if (len > 1e-6) {
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    for (const s of [-1, 1]) g.moveTo(x - ux * r * 1.1 + nx * r * 0.45 * s, y - uy * r * 1.1 + ny * r * 0.45 * s).lineTo(x - ux * r * 2.1 + nx * r * 0.45 * s, y - uy * r * 2.1 + ny * r * 0.45 * s);
    g.stroke({ color: FRENZY_RED, width: 3, alpha: 0.8, cap: 'round' });
  }
}

/** The stand-in silhouettes (until the art): drawn over the disc of the body's colour (radius `r`), facing left as the art does. */
export function guardMarks(ctx: GraphicsContext, r: number): void {
  // A tall shield in front and a helmet's crest on top.
  ctx.roundRect(-r * 1.05, -r * 0.55, r * 0.62, r * 1.2, r * 0.18).fill(STEEL).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(-r * 0.74, -r * 0.4).lineTo(-r * 0.74, r * 0.5).stroke({ color: NAVY, width: 2 });
  ctx.poly([-r * 0.35, -r * 0.82, 0, -r * 1.35, r * 0.35, -r * 0.82]).fill(STEEL).stroke({ color: NAVY, width: 3, join: 'round' });
}
export function handlerMarks(ctx: GraphicsContext, r: number): void {
  // A wide-brimmed hat and a coiled leash at the side.
  ctx.ellipse(0, -r * 0.82, r * 0.95, r * 0.24).fill(LEATHER).stroke({ color: NAVY, width: 3 });
  ctx.roundRect(-r * 0.45, -r * 1.3, r * 0.9, r * 0.5, r * 0.15).fill(LEATHER).stroke({ color: NAVY, width: 3 });
  ctx.circle(r * 0.95, r * 0.25, r * 0.3).stroke({ color: NAVY, width: 5 });
  ctx.circle(r * 0.95, r * 0.25, r * 0.3).stroke({ color: LEATHER, width: 2.5 });
}
export function houndMarks(ctx: GraphicsContext, r: number): void {
  // Two drooping ears and a snout pointing left.
  for (const s of [-1, 1]) ctx.poly([s * r * 0.35, -r * 0.75, s * r * 0.9, -r * 0.55, s * r * 0.75, r * 0.05]).fill(0x3a2a20).stroke({ color: NAVY, width: 3, join: 'round' });
  ctx.ellipse(-r * 0.92, r * 0.12, r * 0.38, r * 0.26).fill(0xe8d7ad).stroke({ color: NAVY, width: 3 });
  ctx.circle(-r * 1.2, r * 0.06, r * 0.1).fill(NAVY);
}
export function castellanMarks(ctx: GraphicsContext, r: number): void {
  // A crenellated crown of a tower and plate shoulders.
  const top = -r * 1.05, w = r * 0.7;
  ctx.poly([-w, top + r * 0.35, -w, top - r * 0.1, -w * 0.55, top - r * 0.1, -w * 0.55, top + r * 0.05, -w * 0.18, top + r * 0.05, -w * 0.18, top - r * 0.1,
    w * 0.18, top - r * 0.1, w * 0.18, top + r * 0.05, w * 0.55, top + r * 0.05, w * 0.55, top - r * 0.1, w, top - r * 0.1, w, top + r * 0.35]).fill(0xc8a56b).stroke({ color: NAVY, width: 3, join: 'round' });
  for (const s of [-1, 1]) ctx.ellipse(s * r * 0.95, -r * 0.2, r * 0.32, r * 0.24).fill(STEEL).stroke({ color: NAVY, width: 3 });
}
