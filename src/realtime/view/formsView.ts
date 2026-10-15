/**
 * Task 29 «Формы в песочнице» (design 15.10.2026, docs/design-notes/tasks-29-30.md, «ЗАДАЧА 29», ui): drawing helpers of the
 * forms' highlight, as eliteView.ts and jailerView.ts — pure, they read nothing of the world and write to a Graphics:
 * - «Развилка» — a Y mark by a candidate reachable only from a link that is not the last;
 * - «Чужак» — a dashed ring of the candidate's own colour (a link of another colour, while the rule is not spent);
 * - «Близнецы» — the chain line in dashes of the pair's two colours, one after the other;
 * - «Наледь» — the cold of the consumable (render.ts `ICE`, no new shade): faint rings where the dash will leave it, then the
 *   trail fading with its life;
 * - «Возврат» — the run back as a dashed line of the chain's own colour with arrows (the second pass of the same chain).
 * Coordinates are arena pixels.
 */
import type { Graphics } from 'pixi.js';

const NAVY = 0x18232d;
/** The cold of the consumable (render.ts `ICE`). */
export const FORM_ICE = 0x9fd8ff;

/**
 * A polyline (`pts`, pixels) cut in dashes of `dash` px with gaps of `gap`; `each(i)` strokes the i-th dash (the caller picks its
 * colour). The phase runs on across the corners.
 */
export function dashPolyline(g: Graphics, pts: readonly { x: number; y: number }[], dash: number, gap: number, each: (i: number) => void): number {
  let n = 0, left = dash, on = true;
  for (let s = 1; s < pts.length; s++) {
    const a = pts[s - 1], b = pts[s], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let t = 0;
    while (t < len) {
      const step = Math.min(left, len - t);
      if (on) { g.moveTo(a.x + ux * t, a.y + uy * t).lineTo(a.x + ux * (t + step), a.y + uy * (t + step)); }
      t += step; left -= step;
      if (left <= 1e-6) { if (on) { each(n); n++; } on = !on; left = on ? dash : gap; }
    }
  }
  if (on && left < dash) { each(n); n++; }
  return n;
}

/** «Близнецы»: the chain line — navy under, then dashes of `inkA` and `inkB` in turn (no gaps). */
export function drawTwinLine(g: Graphics, pts: readonly { x: number; y: number }[], inkA: number, inkB: number): void {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke({ color: NAVY, width: 9, alpha: 0.95, cap: 'round', join: 'round' });
  dashPolyline(g, pts, 16, 0.001, i => g.stroke({ color: i % 2 ? inkB : inkA, width: 4.5, alpha: 0.95, cap: 'butt' }));
}

/** «Чужак»: a dashed ring of radius `R` in the candidate's own colour, a navy under-ring. */
export function drawAlienRing(g: Graphics, x: number, y: number, R: number, ink: number): void {
  g.circle(x, y, R).stroke({ color: NAVY, width: 6, alpha: 0.8 });
  const n = 12, arc = Math.PI * 2 / n;
  for (let i = 0; i < n; i++) g.moveTo(x + Math.cos(i * arc) * R, y + Math.sin(i * arc) * R).arc(x, y, R, i * arc, i * arc + arc * 0.6);
  g.stroke({ color: ink, width: 3.5, alpha: 0.95 });
}

/** «Развилка»: a small Y by a candidate (at its upper left) — the link may come from a link that is not the last. */
export function drawForkMark(g: Graphics, x: number, y: number, s: number): void {
  const pts = [[x, y + s], [x, y], [x - s * 0.8, y - s * 0.8], [x, y], [x + s * 0.8, y - s * 0.8]];
  for (const [w, c] of [[s * 0.55, NAVY], [s * 0.28, 0xffffff]] as const) {
    g.moveTo(pts[0][0], pts[0][1]).lineTo(pts[1][0], pts[1][1]).moveTo(pts[1][0], pts[1][1]).lineTo(pts[2][0], pts[2][1]).moveTo(pts[3][0], pts[3][1]).lineTo(pts[4][0], pts[4][1]);
    g.stroke({ color: c, width: w, cap: 'round', join: 'round' });
  }
}

/** «Наледь» before the release: a faint ring of radius `R` where the dash will leave the cold. */
export function drawFrostPreview(g: Graphics, x: number, y: number, R: number): void {
  g.circle(x, y, R).fill({ color: FORM_ICE, alpha: 0.1 }).stroke({ color: FORM_ICE, width: 1.5, alpha: 0.55 });
}

/** «Наледь» on the arena: a frost point of radius `R`, its alpha by `k` (life left ÷ the whole life), with a few rime spikes. */
export function drawFrostPoint(g: Graphics, x: number, y: number, R: number, k: number): void {
  const a = Math.max(0, Math.min(1, k));
  g.circle(x, y, R).fill({ color: FORM_ICE, alpha: 0.32 * a }).stroke({ color: FORM_ICE, width: 2, alpha: 0.7 * a });
  for (let i = 0; i < 3; i++) {
    const t = i * Math.PI * 2 / 3 + 0.4, l = R * 0.55;
    g.moveTo(x - Math.cos(t) * l, y - Math.sin(t) * l).lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l);
  }
  g.stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 * a });
}

/**
 * «Возврат»: the way back (`pts`, pixels: from the dash's end to the chain's start) — a navy under-line, dashes of the chain's
 * `ink` and an arrow head every `every` px pointing along the way; `alpha` — dimmer while the run goes. Returns the arrows drawn.
 */
export function drawReturnRoute(g: Graphics, pts: readonly { x: number; y: number }[], ink: number, every: number, alpha = 1): number {
  if (pts.length < 2) return 0;
  dashPolyline(g, pts, 12, 8, () => g.stroke({ color: NAVY, width: 7, alpha: 0.8 * alpha, cap: 'round' }));
  dashPolyline(g, pts, 12, 8, () => g.stroke({ color: ink, width: 3.5, alpha: 0.95 * alpha, cap: 'round' }));
  let arrows = 0, next = every * 0.6;
  let walked = 0;
  for (let s = 1; s < pts.length; s++) {
    const a = pts[s - 1], b = pts[s], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
    while (next <= walked + len) {
      const t = next - walked, x = a.x + ux * t, y = a.y + uy * t, h = 9;
      g.poly([x + ux * h, y + uy * h, x - ux * h * 0.6 + nx * h * 0.8, y - uy * h * 0.6 + ny * h * 0.8, x - ux * h * 0.6 - nx * h * 0.8, y - uy * h * 0.6 - ny * h * 0.8])
        .fill({ color: ink, alpha }).stroke({ color: NAVY, width: 2, alpha });
      arrows++;
      next += every;
    }
    walked += len;
  }
  return arrows;
}
