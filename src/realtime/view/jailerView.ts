/**
 * Task 27 (design 15.10.2026, docs/design-notes/tasks-26-28.md): the view of the flail Jailer in the sandbox — drawing
 * helpers only, as eliteView.ts. The core is the illustration `jailer.png` (unchanged; the flail's chain leaves the hand with
 * the keys); the weight and the chain are drawn here, no new art:
 * - the weight — a spiked ball in its chain colour (the colour reads on the body), a navy outline and one shade;
 * - the flail's chain — dark steel links that sag from the core's hand to the weight, under the enemies; grey, so it is not
 *   taken for the player's chain;
 * - «Кистень» — a hatched half-disc in the threat colour facing the hero, filling as the windup runs (the archer's mark);
 * - «Свисток» — a hatched circle at the gate with the dots of the colours that will come, filling as the call runs;
 * - «отрубит» — the plate of the core that the end of the pass takes blinks as an empty lemon ring (no text).
 * Coordinates are arena pixels; sizes marked `px` are screen pixels (the caller passes `1 / scale`).
 */
import type { Graphics } from 'pixi.js';
import { ELITE_LEMON, platePipAt, type ArmorShape } from './eliteView';

const NAVY = 0x18232d;
const STEEL = 0x5d6b78;
const STEEL_DARK = 0x2c3640;
const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;

/** How many links the flail's chain has. */
export const FLAIL_LINKS = 6;
/** How long a cut chain takes to fall and fade (real seconds). */
export const CHAIN_BREAK_LIFE = 0.5;

/** The point at `t` (0..1) of the chain from (x0, y0) to (x1, y1), sagging down by `sag` in the middle. */
export function chainPoint(x0: number, y0: number, x1: number, y1: number, sag: number, t: number): { x: number; y: number } {
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + sag * 4 * t * (1 - t) };
}

/**
 * The flail's chain: `FLAIL_LINKS` oval links along the sagging curve, each turned along it, dark steel with a navy outline.
 * `drop` (0..1, a cut chain) lets the links fall apart and fade.
 */
export function drawFlailChain(g: Graphics, x0: number, y0: number, x1: number, y1: number, sag: number, px: number, drop = 0): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return;
  const alpha = 1 - drop, w = Math.max(5 * px, Math.min(12 * px, len / FLAIL_LINKS * 0.42)), h = w * 0.55;
  for (let i = 0; i < FLAIL_LINKS; i++) {
    const t = (i + 0.5) / FLAIL_LINKS, a = chainPoint(x0, y0, x1, y1, sag, t - 0.02), b = chainPoint(x0, y0, x1, y1, sag, t + 0.02);
    const p = chainPoint(x0, y0, x1, y1, sag, t), ang = Math.atan2(b.y - a.y, b.x - a.x) + (i % 2 ? Math.PI / 2 * 0.35 : 0);
    // A cut chain: every link falls a little and spreads from the cut.
    const fx = p.x + (i - FLAIL_LINKS / 2) * drop * 4 * px, fy = p.y + drop * drop * 30 * px;
    const c = Math.cos(ang), s = Math.sin(ang), pts: number[] = [];
    for (let j = 0; j < 12; j++) {
      const q = j / 12 * Math.PI * 2, ex = Math.cos(q) * w, ey = Math.sin(q) * h;
      pts.push(fx + ex * c - ey * s, fy + ex * s + ey * c);
    }
    g.poly(pts).stroke({ color: NAVY, width: 4.5 * px, alpha }).poly(pts).stroke({ color: i % 2 ? STEEL : STEEL_DARK, width: 2.2 * px, alpha });
  }
}

/**
 * The weight: a ball of radius `R` in the chain colour `ink` with 8 steel spikes, a navy outline (outer thicker), one shade
 * and a small hard highlight (docs/character-art-style.md: metal — a cold base, one hard shade, a small highlight).
 */
export function drawWeight(g: Graphics, x: number, y: number, R: number, ink: number, px: number, spin = 0): void {
  const spikes: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const a = spin + i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a), w = R * 0.26;
    spikes.push([x + c * R * 0.82 - s * w, y + s * R * 0.82 + c * w, x + c * R * 1.38, y + s * R * 1.38, x + c * R * 0.82 + s * w, y + s * R * 0.82 - c * w]);
  }
  for (const pts of spikes) g.poly(pts).fill(STEEL).stroke({ color: NAVY, width: 3.5 * px });
  g.circle(x, y, R).fill(ink).stroke({ color: NAVY, width: 5 * px });
  // One shade (lower right) and a hard highlight (upper left).
  g.moveTo(x + R * 0.95, y - R * 0.1).arc(x, y, R * 0.95, -0.1, Math.PI * 0.75).quadraticCurveTo(x + R * 0.45, y + R * 0.35, x + R * 0.95, y - R * 0.1).fill({ color: NAVY, alpha: 0.32 });
  g.ellipse(x - R * 0.38, y - R * 0.42, R * 0.2, R * 0.12).fill({ color: 0xffffff, alpha: 0.75 });
}

/**
 * Hatching inside the half-disc of radius `R` at (X, Y) facing angle `dir` (radians): chords at 45° every `step` pixels,
 * clipped to the half-plane in front, in one path — the caller strokes it.
 */
export function hatchHalfDisc(g: Graphics, X: number, Y: number, R: number, dir: number, step: number): number {
  const k = Math.SQRT1_2, ux = Math.cos(dir), uy = Math.sin(dir);
  let chords = 0;
  for (let s = -R + step / 2; s < R; s += step) {
    const h = Math.sqrt(Math.max(0, R * R - s * s));
    // The chord at signed distance s along the normal (k, k), direction (k, −k): points c + d·t, t ∈ [−h, h].
    const cx = X + k * s, cy = Y + k * s, dx = k, dy = -k;
    // Keep the part with (p − centre)·u ≥ 0: f(t) = f0 + t·fd.
    const f0 = (cx - X) * ux + (cy - Y) * uy, fd = dx * ux + dy * uy;
    let t0 = -h, t1 = h;
    if (Math.abs(fd) < 1e-9) { if (f0 < 0) continue; } else if (fd > 0) t0 = Math.max(t0, -f0 / fd); else t1 = Math.min(t1, -f0 / fd);
    if (t1 - t0 < 1e-6) continue;
    g.moveTo(cx + dx * t0, cy + dy * t0).lineTo(cx + dx * t1, cy + dy * t1);
    chords++;
  }
  return chords;
}

/** The outline of the half-disc (the arc and its diameter) — one path, the caller strokes it. */
function halfDiscPath(g: Graphics, X: number, Y: number, R: number, dir: number): void {
  g.moveTo(X + Math.cos(dir - Math.PI / 2) * R, Y + Math.sin(dir - Math.PI / 2) * R).arc(X, Y, R, dir - Math.PI / 2, dir + Math.PI / 2).closePath();
}

/**
 * «Кистень»: the hatched half-disc of radius `R` around the core at (X, Y), facing `dir`, in the threat colour; the inner
 * half-disc grows with `progress` (0..1) of the windup; `flash` (0..1) — the blow just fell: the whole half-disc lights up and fades.
 */
export function drawFlailArc(g: Graphics, X: number, Y: number, R: number, dir: number, progress: number, step: number, flash = 0): void {
  halfDiscPath(g, X, Y, R, dir);
  g.fill({ color: THREAT, alpha: flash > 0 ? 0.5 * flash : 0.14 });
  if (flash > 0) { halfDiscPath(g, X, Y, R, dir); g.stroke({ color: THREAT, width: 4, alpha: flash }); return; }
  if (progress > 0) { halfDiscPath(g, X, Y, R * Math.min(1, progress), dir); g.fill({ color: THREAT, alpha: 0.26 }); }
  hatchHalfDisc(g, X, Y, R, dir, step);
  g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
  halfDiscPath(g, X, Y, R, dir);
  g.stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 });
  halfDiscPath(g, X, Y, R, dir);
  g.stroke({ color: THREAT, width: 2, alpha: 0.95 });
}

/**
 * «Свисток»: a circle of radius `R` at the gate (X, Y) — a dark disc, a ring in the threat colour that closes with
 * `progress` (0..1, a clock from the top), and one dot per colour in `inks` around the centre (the enemies that will come).
 */
export function drawWhistleMark(g: Graphics, X: number, Y: number, R: number, inks: readonly number[], progress: number, px: number): void {
  g.circle(X, Y, R).fill({ color: THREAT_OUTLINE, alpha: 0.35 }).stroke({ color: THREAT_OUTLINE, width: 5 * px, alpha: 0.8 });
  g.circle(X, Y, R).stroke({ color: THREAT, width: 1.5 * px, alpha: 0.45 });
  const k = Math.max(0, Math.min(1, progress));
  if (k > 0) g.moveTo(X, Y - R).arc(X, Y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: THREAT, width: 4 * px, alpha: 0.95 });
  const n = inks.length, d = n > 1 ? R * 0.45 : 0, dr = Math.min(R * 0.24, 9 * px);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n;
    g.circle(X + Math.cos(a) * d, Y + Math.sin(a) * d, dr).fill(inks[i]).stroke({ color: NAVY, width: 2 * px });
  }
}

/**
 * «Отрубит»: the core's plate that the end of the pass takes (the last filled pip) blinks as an empty lemon ring. `on` — the
 * blink phase. Returns whether a pip was marked (the core has a plate left).
 */
export function drawSeverPip(g: Graphics, x: number, y: number, R: number, a: ArmorShape, px: number, on: boolean): boolean {
  if (a.plates <= 0) return false;
  if (!on) return true;
  const pip = platePipAt(x, y, R, a, a.plates - 1, px);
  g.roundRect(pip.x - pip.w / 2, pip.y - pip.h / 2, pip.w, pip.h, pip.r).fill({ color: 0x16202a, alpha: 0.95 }).stroke({ color: ELITE_LEMON, width: 2.5 * px });
  return true;
}
