/**
 * The view of elite armour and elite behaviours (package «Урон имеет значение», docs/realtime-damage.md, docs/realtime-elite-behaviors.md).
 * Drawing helpers only: they read what the sim exposes (`eliteArmorView`, `activeEliteBehavior`) and write to a Graphics.
 * Sizes marked `px` are screen pixels (the caller passes `1 / scale`), so the pips and plaques read the same at any zoom.
 */
import type { Graphics } from 'pixi.js';

/** Lemon `ffff66` — the colour of the player's power, the target reticle and the elite rim (render.ts `TARGET`). */
export const ELITE_LEMON = 0xffff66;
const NAVY = 0x1a2330;

/** Armour as the sim shows it (`eliteArmorView`). */
export interface ArmorShape { plates: number; max: number; open: number; clean?: number; regrow: number }

/** How long the plaque «Элита · …» stays over a newcomer (real seconds), and its fade at the end. */
export const PLAQUE_LIFE = 1.5;
export const PLAQUE_FADE = 0.3;

/** The text of the plaque over a newly seen elite: «Элита · <поведение>», without a behaviour just «Элита». */
export const plaqueText = (behaviorTitle: string | null | undefined): string => behaviorTitle ? `Элита · ${behaviorTitle}` : 'Элита';

/** «пластина» in the form a count asks for: 1 пластина, 2 пластины. */
export const platesWord = (n: number): string => n === 1 ? 'пластина' : 'пластины';

/**
 * The row of plate pips above an elite at (x, y) whose drawing has radius `R` (arena pixels). Filled — plates left; empty —
 * lost; the pip that grows back shows a ring filling with the regrowth (`regrowLeft` of `regrowTotal` game seconds).
 * Returns the pips drawn and how many are filled.
 */
export function drawPlatePips(g: Graphics, x: number, y: number, R: number, a: ArmorShape, regrowTotal: number, px: number): { pips: number; filled: number } {
  const pr = 7 * px, step = pr * 2.5, top = y - R - 13 * px;
  const x0 = x - (a.max - 1) * step / 2;
  for (let i = 0; i < a.max; i++) {
    const cx = x0 + i * step, filled = i < a.plates;
    // A rounded plate (a small shield) rather than a dot: it reads as armour at 11 px.
    const w = pr * 1.7, h = pr * 2;
    g.roundRect(cx - w / 2, top - h / 2, w, h, pr * 0.55);
    if (filled) g.fill({ color: ELITE_LEMON, alpha: 1 }).stroke({ color: NAVY, width: 2 * px });
    else g.fill({ color: 0x16202a, alpha: 0.8 }).stroke({ color: ELITE_LEMON, width: 1.2 * px, alpha: 0.4 });
    if (!filled && i === a.plates && a.open <= 0 && a.regrow > 0 && regrowTotal > 0) {
      const k = Math.max(0, Math.min(1, 1 - a.regrow / regrowTotal));
      g.moveTo(cx, top - pr * 1.55).arc(cx, top, pr * 1.55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: ELITE_LEMON, width: 2 * px, alpha: 0.95 });
    }
  }
  return { pips: a.max, filled: Math.min(a.max, a.plates) };
}

/**
 * The window of an elite with 0 plates: a lemon pulse on the body and a ring that runs down like a clock (`open` of `total`
 * game seconds left); it blinks in the last 0.7 s. `clock` — real seconds. In the first `eliteCleanWindow` second (`clean`
 * > 0: a kill is a clean break) the pulse is faster and brighter, with a white core — the one sign, no text.
 */
export function drawWindowPulse(g: Graphics, x: number, y: number, R: number, open: number, total: number, clock: number, px: number, clean = 0): void {
  const hot = clean > 0, pulse = 0.5 + 0.5 * Math.sin(clock * (hot ? 24 : 11));
  const urgent = open < 0.7 && Math.floor(clock * 12) % 2 === 0;
  const a = urgent ? 0.45 : 1;
  g.circle(x, y, R * (1.0 + 0.05 * pulse)).fill({ color: ELITE_LEMON, alpha: (0.14 + 0.2 * pulse) * a });
  g.circle(x, y, R * (1.08 + 0.07 * pulse)).stroke({ color: ELITE_LEMON, width: (hot ? 6 : 4) * px, alpha: (hot ? 1 : 0.85) * a });
  if (hot) g.circle(x, y, R * (1.0 + 0.05 * pulse)).fill({ color: 0xffffff, alpha: 0.22 * pulse });
  const k = total > 0 ? Math.max(0, Math.min(1, open / total)) : 1, RR = R * 1.3;
  if (k > 0.001) {
    g.moveTo(x, y - RR).arc(x, y, RR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: NAVY, width: 7 * px, alpha: 0.8 });
    g.moveTo(x, y - RR).arc(x, y, RR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: ELITE_LEMON, width: 3.5 * px, alpha: a });
  }
}
