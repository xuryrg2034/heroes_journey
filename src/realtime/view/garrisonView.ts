/**
 * Task 38 «Гарнизон, шаг 1а» (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md): drawing helpers of the garrison's
 * view, as jailerView.ts — pure, they read nothing of the world and write to a Graphics or a GraphicsContext:
 * - the tether (a leash): a navy rope with links of the holder's colour, sagging a little; a tether the drawn chain's dash will cut
 *   (the plan's `cuts`) — red and thicker, with the cut mark (two short slashes) where the dash crosses it;
 * - the snap after the dash: the two halves recoil from the cut point and fade;
 * - the hound's frenzy: a red jagged ring that flickers round the body and two speed streaks behind it;
 * - the stand-in silhouettes of the guard, the dog handler, the hound and the Castellan (until the art comes).
 * Task 40 «Гарнизон, шаг 1б» (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 2):
 * - the shackle (the keymaster's tether): an iron chain of cold grey links, not a colour of the player's chain; a shackle the drawn
 *   chain's dash will cut — red with the cut mark, as the leash;
 * - the prisoner's padlock over its body; the keymaster's stand-in silhouette (a cap and a ring of keys).
 * Task 41 «Узник на воле» (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 2): the broken shackle falls off the freed
 * prisoner — the open padlock and two split cuffs drop and fade; the prisoner's riot is drawn as the hound's frenzy (`drawFrenzy`).
 * Coordinates are arena pixels.
 */
import type { Graphics, GraphicsContext } from 'pixi.js';

const NAVY = 0x18232d;
/** The cut tether (the dash will cut it), the frenzy. */
export const CUT_RED = 0xff3b30;
export const FRENZY_RED = 0xe0302a;
const STEEL = 0xa9b8c6;
const LEATHER = 0x7a5232;
/** Task 40: the padlock's dark iron. */
const IRON = 0x5d6a77;

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

/** Task 40: an ellipse of `rx` × `ry` round (`x`, `y`) turned by `angle` (a chain's link), as a polygon. */
function linkOval(x: number, y: number, rx: number, ry: number, angle: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle), pts: number[] = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry; pts.push(x + ex * c - ey * s, y + ex * s + ey * c); }
  return pts;
}

/**
 * Task 40: the shackle from the keymaster (`ax`, `ay`) to its prisoner — an iron chain: flat links (grey ovals) and links seen edge
 * on (short bars) by turns, on a navy line, hanging a little. `cut` — the drawn chain's dash will cut it: the leash's red chord and
 * cut mark (the same sign).
 */
export function drawShackle(g: Graphics, ax: number, ay: number, bx: number, by: number, cut: boolean, at: { x: number; y: number } | null = null): void {
  if (cut) { drawLeash(g, ax, ay, bx, by, STEEL, true, at); return; }
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const sag = Math.min(6, len * 0.04), n = Math.max(3, Math.round(len / 11)), angle = Math.atan2(by - ay, bx - ax);
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) { const p = leashPoint(ax, ay, bx, by, i / n, sag); pts.push(p.x, p.y); }
  g.poly(pts, false).stroke({ color: NAVY, width: 3, alpha: 0.85, cap: 'round', join: 'round' });
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const p = leashPoint(ax, ay, bx, by, (i + 0.5) / n, sag);
    if (i % 2 === 0) {
      const oval = linkOval(p.x, p.y, step * 0.62, 3.6, angle);
      g.poly(oval).stroke({ color: NAVY, width: 4.5 });
      g.poly(oval).stroke({ color: STEEL, width: 2.2 });
    } else {
      const ux = Math.cos(angle) * step * 0.32, uy = Math.sin(angle) * step * 0.32;
      g.moveTo(p.x - ux, p.y - uy).lineTo(p.x + ux, p.y + uy).stroke({ color: NAVY, width: 5.5, cap: 'round' });
      g.moveTo(p.x - ux, p.y - uy).lineTo(p.x + ux, p.y + uy).stroke({ color: STEEL, width: 2.5, cap: 'round' });
    }
  }
}

/** Task 40: the prisoner's padlock, its body `s` px wide, centred at (`x`, `y`): a steel shackle over a dark iron body with a keyhole. */
export function drawLock(g: Graphics, x: number, y: number, s: number): void {
  const top = y - s * 0.18, h = s * 0.74, arc = s * 0.3;
  g.moveTo(x - arc, top).arc(x, top, arc, Math.PI, 0).stroke({ color: NAVY, width: s * 0.26, cap: 'round' });
  g.moveTo(x - arc, top).arc(x, top, arc, Math.PI, 0).stroke({ color: STEEL, width: s * 0.12, cap: 'round' });
  g.roundRect(x - s / 2, top, s, h, s * 0.14).fill(IRON).stroke({ color: NAVY, width: 2.5 });
  g.moveTo(x - s * 0.36, top + s * 0.12).lineTo(x + s * 0.36, top + s * 0.12).stroke({ color: STEEL, width: 1.5, alpha: 0.7 });
  g.circle(x, top + h * 0.45, s * 0.1).fill(NAVY);
  g.poly([x - s * 0.05, top + h * 0.5, x + s * 0.05, top + h * 0.5, x + s * 0.08, top + h * 0.78, x - s * 0.08, top + h * 0.78]).fill(NAVY);
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

/**
 * Task 41: the broken shackle falling off the freed prisoner, `k` — 1 at the cut, 0 at the end: the open padlock (its body `s` px wide,
 * from (`x`, `lockY`)) and two split cuffs at the body's sides (`r` — the body's radius, centre `bodyY`) drop, spread and fade.
 */
export function drawFallenShackle(g: Graphics, x: number, lockY: number, bodyY: number, s: number, r: number, k: number): void {
  const a = Math.max(0, Math.min(1, k)), t = 1 - a, drop = t * t * r * 2.2;
  // The padlock: its shackle swung open (the arc's right leg out of the body), it slides aside as it falls.
  const lx = x + t * r * 0.6, ly = lockY + drop, top = ly - s * 0.18, h = s * 0.74, arc = s * 0.3;
  g.moveTo(lx - arc, top).arc(lx - arc * 0.2, top - s * 0.12, arc, Math.PI, Math.PI * 1.75).stroke({ color: NAVY, width: s * 0.26, cap: 'round', alpha: a });
  g.moveTo(lx - arc, top).arc(lx - arc * 0.2, top - s * 0.12, arc, Math.PI, Math.PI * 1.75).stroke({ color: STEEL, width: s * 0.12, cap: 'round', alpha: a });
  g.roundRect(lx - s / 2, top, s, h, s * 0.14).fill({ color: IRON, alpha: a }).stroke({ color: NAVY, width: 2.5, alpha: a });
  // The cuffs: open rings at the wrists, each split where the dash cut it.
  for (const side of [-1, 1]) {
    const cx = x + side * r * (0.95 + 0.5 * t), cy = bodyY + r * 0.2 + drop, cr = r * 0.32, gap = 0.9, turn = side * t * 1.4;
    for (const [w, c] of [[s * 0.22, NAVY], [s * 0.1, STEEL]] as const) {
      g.moveTo(cx + Math.cos(gap / 2 + turn) * cr, cy + Math.sin(gap / 2 + turn) * cr).arc(cx, cy, cr, gap / 2 + turn, Math.PI * 2 - gap / 2 + turn).stroke({ color: c, width: w, cap: 'round', alpha: a });
    }
  }
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
/** Task 40: the keymaster's stand-in — a brown cap, a ring of big keys at one side and a shackle at the other. */
export function keymasterMarks(ctx: GraphicsContext, r: number): void {
  ctx.ellipse(0, -r * 0.86, r * 0.62, r * 0.3).fill(LEATHER).stroke({ color: NAVY, width: 3 });
  ctx.circle(-r * 0.95, r * 0.05, r * 0.3).stroke({ color: NAVY, width: 5 });
  ctx.circle(-r * 0.95, r * 0.05, r * 0.3).stroke({ color: 0xc8a56b, width: 2.5 });
  for (const [dx, len] of [[-1.15, 0.75], [-0.85, 0.6]] as const) {
    ctx.moveTo(r * dx, r * 0.3).lineTo(r * dx, r * (0.3 + len)).stroke({ color: NAVY, width: 5, cap: 'round' });
    ctx.moveTo(r * dx, r * 0.3).lineTo(r * dx, r * (0.3 + len)).stroke({ color: STEEL, width: 2.5, cap: 'round' });
    ctx.moveTo(r * dx, r * (0.15 + len)).lineTo(r * (dx + 0.18), r * (0.15 + len)).stroke({ color: STEEL, width: 2.5, cap: 'round' });
  }
  ctx.moveTo(r * 0.75, -r * 0.1).arc(r * 0.95, -r * 0.1, r * 0.2, Math.PI, Math.PI * 2.6).stroke({ color: NAVY, width: 5 });
  ctx.moveTo(r * 0.75, -r * 0.1).arc(r * 0.95, -r * 0.1, r * 0.2, Math.PI, Math.PI * 2.6).stroke({ color: STEEL, width: 2.5 });
}
export function castellanMarks(ctx: GraphicsContext, r: number): void {
  // A crenellated crown of a tower and plate shoulders.
  const top = -r * 1.05, w = r * 0.7;
  ctx.poly([-w, top + r * 0.35, -w, top - r * 0.1, -w * 0.55, top - r * 0.1, -w * 0.55, top + r * 0.05, -w * 0.18, top + r * 0.05, -w * 0.18, top - r * 0.1,
    w * 0.18, top - r * 0.1, w * 0.18, top + r * 0.05, w * 0.55, top + r * 0.05, w * 0.55, top - r * 0.1, w, top - r * 0.1, w, top + r * 0.35]).fill(0xc8a56b).stroke({ color: NAVY, width: 3, join: 'round' });
  for (const s of [-1, 1]) ctx.ellipse(s * r * 0.95, -r * 0.2, r * 0.32, r * 0.24).fill(STEEL).stroke({ color: NAVY, width: 3 });
}

/** Task 43: the knight's stand-in — broad pauldrons, a great helm with a slit and a blue plume, a sword at the side. */
export function knightMarks(ctx: GraphicsContext, r: number): void {
  for (const s of [-1, 1]) ctx.ellipse(s * r * 0.98, -r * 0.2, r * 0.4, r * 0.32).fill(STEEL).stroke({ color: NAVY, width: 3 });
  ctx.poly([r * 0.12, -r * 1.4, r * 0.62, -r * 1.95, r * 0.5, -r * 1.3]).fill(0x3d6fa8).stroke({ color: NAVY, width: 3, join: 'round' });
  ctx.roundRect(-r * 0.5, -r * 1.5, r, r * 0.95, r * 0.2).fill(STEEL).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(-r * 0.34, -r * 1.05).lineTo(r * 0.34, -r * 1.05).stroke({ color: NAVY, width: 4, cap: 'round' });
  ctx.moveTo(-r * 1.3, r * 0.75).lineTo(-r * 1.3, -r * 0.55).stroke({ color: NAVY, width: 7, cap: 'round' });
  ctx.moveTo(-r * 1.3, r * 0.75).lineTo(-r * 1.3, -r * 0.55).stroke({ color: STEEL, width: 3.5, cap: 'round' });
  ctx.moveTo(-r * 1.5, r * 0.55).lineTo(-r * 1.1, r * 0.55).stroke({ color: 0xc8a56b, width: 4, cap: 'round' });
}

/** Task 59а: the pitcher's stand-in — a sooty leather apron over the belly, a ladle at the side, a dark kerchief with a sly brow. */
export function pitcherMarks(ctx: GraphicsContext, r: number): void {
  ctx.roundRect(-r * 0.62, r * 0.05, r * 1.24, r * 0.82, r * 0.2).fill(0x5a3a22).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(-r * 0.3, r * 0.2).lineTo(r * 0.3, r * 0.2).stroke({ color: NAVY, width: 2, alpha: 0.7 });
  ctx.ellipse(0, -r * 0.82, r * 0.7, r * 0.26).fill(0x3a2a20).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(r * 1.0, r * 0.7).lineTo(r * 1.0, -r * 0.35).stroke({ color: NAVY, width: 6, cap: 'round' });
  ctx.moveTo(r * 1.0, r * 0.7).lineTo(r * 1.0, -r * 0.35).stroke({ color: LEATHER, width: 3, cap: 'round' });
  ctx.circle(r * 1.0, -r * 0.5, r * 0.22).fill(IRON).stroke({ color: NAVY, width: 3 });
}
/** Task 59а: the recruit's stand-in — a helmet too big, slipped over the eyes, and a wooden spear (head up) at the side. */
export function recruitMarks(ctx: GraphicsContext, r: number): void {
  ctx.ellipse(r * 0.04, -r * 0.62, r * 0.88, r * 0.62).fill(STEEL).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(-r * 0.75, -r * 0.3).lineTo(r * 0.8, -r * 0.34).stroke({ color: NAVY, width: 4, cap: 'round' });
  ctx.moveTo(-r * 1.1, r * 0.8).lineTo(-r * 1.1, -r * 1.0).stroke({ color: NAVY, width: 6, cap: 'round' });
  ctx.moveTo(-r * 1.1, r * 0.8).lineTo(-r * 1.1, -r * 1.0).stroke({ color: LEATHER, width: 3, cap: 'round' });
  ctx.poly([-r * 1.25, -r * 1.0, -r * 1.1, -r * 1.45, -r * 0.95, -r * 1.0]).fill(STEEL).stroke({ color: NAVY, width: 2.5, join: 'round' });
}
/** Task 59а: the warden's stand-in — a dark hood with a squint and a big key on the shoulder (the pair's belt key is drawn per frame). */
export function wardenMarks(ctx: GraphicsContext, r: number): void {
  ctx.ellipse(0, -r * 0.7, r * 0.86, r * 0.5).fill(0x2b3440).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(-r * 0.4, -r * 0.3).lineTo(-r * 0.08, -r * 0.24).moveTo(r * 0.08, -r * 0.24).lineTo(r * 0.4, -r * 0.3).stroke({ color: NAVY, width: 3, cap: 'round' });
  ctx.moveTo(r * 0.6, -r * 0.2).lineTo(r * 1.15, -r * 1.15).stroke({ color: NAVY, width: 7, cap: 'round' });
  ctx.moveTo(r * 0.6, -r * 0.2).lineTo(r * 1.15, -r * 1.15).stroke({ color: 0xc8a56b, width: 3.5, cap: 'round' });
  ctx.circle(r * 1.2, -r * 1.3, r * 0.26).stroke({ color: NAVY, width: 6 });
  ctx.circle(r * 1.2, -r * 1.3, r * 0.26).stroke({ color: 0xc8a56b, width: 3 });
}
