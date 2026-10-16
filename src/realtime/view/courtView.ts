/**
 * Task 43 «Гарнизон, шаг 2а» (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 3, 4, 9): the drawn parts of the full
 * Castellan's court and of the crossbow law — in the arena's style (navy outline, flat colours), procedural (no generated art):
 * - the grate's levers in the yard: the goblin lever's look without its idol (a stone foot, a handle up and lit while ready, down and
 *   grey during its cooldown, the cooldown's ring running out);
 * - the grate over the core on the gallery: iron bars in a frame — down (closed), raised (open), with the keys' sign when the Castellan
 *   threw them (despair);
 * - the bolt's line: a thin dashed line in the threat colour from the crossbow through the hero to the wall, fixed at the windup's
 *   start, brighter as the windup runs; a faint band of the bolt's width under it.
 * View only: reads what render.ts passes, never the world.
 */
import type { Graphics } from 'pixi.js';

const NAVY = 0x18232d;
const STONE = 0x8a8a7e, STONE_DARK = 0x5f6058;
/** The goblin lever's colours (slotView.ts `drawIdol`): the wooden handle, its red knob, the dark ones of a lever that waits. */
const HANDLE = 0xb08a52, HANDLE_DARK = 0x5d5a52, KNOB = 0xd65a4a, KNOB_DARK = 0x6a4a44;
const GOLD = 0xffd36b;
const IRON = 0x4a535c, IRON_LIGHT = 0x7d8a96;
/** The threat colour (render.ts `THREAT`: white with a dark outline). */
const THREAT = 0xffffff, THREAT_OUTLINE = 0x0b0f14;

/**
 * A lever of the grate at (X, Y) (px; `R` — the object's radius, px): a stone foot and a handle — up, lit and pulsing gold while
 * `ready`; down and grey otherwise, with a ring of the cooldown left (`left` of `total` s) running out round it.
 */
export function drawGateLever(g: Graphics, X: number, Y: number, R: number, ready: boolean, left: number, total: number, clock: number): void {
  g.ellipse(X, Y + R * 0.75, R * 1.0, R * 0.28).fill({ color: 0x050a07, alpha: 0.45 });
  g.roundRect(X - R * 0.8, Y + R * 0.1, R * 1.6, R * 0.6, R * 0.15).fill(STONE_DARK).stroke({ color: NAVY, width: 3 });
  g.roundRect(X - R * 0.45, Y - R * 0.25, R * 0.9, R * 0.45, R * 0.12).fill(STONE).stroke({ color: NAVY, width: 3 });
  const bx = X, by = Y - R * 0.05, tip = ready ? { x: bx + R * 0.45, y: by - R * 1.2 } : { x: bx + R * 0.95, y: by + R * 0.25 };
  g.moveTo(bx, by).lineTo(tip.x, tip.y).stroke({ color: NAVY, width: 7, cap: 'round' });
  g.moveTo(bx, by).lineTo(tip.x, tip.y).stroke({ color: ready ? HANDLE : HANDLE_DARK, width: 3.5, cap: 'round' });
  if (ready) {
    const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
    g.circle(tip.x, tip.y, R * 0.48).stroke({ color: GOLD, width: 3, alpha: 0.35 + 0.5 * pulse });
  } else if (total > 0 && left > 0) {
    // The cooldown left: an arc round the foot shrinking to nothing as the lever gets ready.
    const k = Math.max(0, Math.min(1, left / total)), a0 = -Math.PI / 2;
    g.circle(X, Y, R * 1.25).stroke({ color: NAVY, width: 5, alpha: 0.5 });
    g.moveTo(X + Math.cos(a0) * R * 1.25, Y + Math.sin(a0) * R * 1.25).arc(X, Y, R * 1.25, a0, a0 + k * Math.PI * 2).stroke({ color: HANDLE_DARK, width: 3, alpha: 0.9 });
  }
  g.circle(tip.x, tip.y, R * 0.24).fill(ready ? KNOB : KNOB_DARK).stroke({ color: NAVY, width: 2.5 });
}

/**
 * The grate over the core at (X, Y) (px; `w` — its width, `h` — its height, px; its foot at Y + h * 0.35). `raise` 0 — down (the
 * bars over the core), 1 — up (the bars drawn short under the lintel); `despair` — the keys the Castellan threw hang on the frame.
 */
export function drawGrate(g: Graphics, X: number, Y: number, w: number, h: number, raise: number, despair: boolean): void {
  const left = X - w / 2, right = X + w / 2, top = Y - h * 0.65, foot = Y + h * 0.35, k = Math.max(0, Math.min(1, raise));
  const bottom = foot - (foot - top) * k * 0.82;
  // The posts and the lintel.
  g.rect(left - 6, top - 8, w + 12, 10).fill(STONE_DARK).stroke({ color: NAVY, width: 3 });
  g.rect(left - 6, top, 7, foot - top).fill(STONE).stroke({ color: NAVY, width: 2.5 });
  g.rect(right - 1, top, 7, foot - top).fill(STONE).stroke({ color: NAVY, width: 2.5 });
  // The bars: vertical with two cross bars, spiked at the bottom.
  const n = 6, step = w / (n + 1);
  for (let i = 1; i <= n; i++) {
    const x = left + step * i;
    g.moveTo(x, top + 2).lineTo(x, bottom).stroke({ color: NAVY, width: 6, cap: 'butt' });
    g.moveTo(x, top + 2).lineTo(x, bottom).stroke({ color: IRON_LIGHT, width: 2.5, cap: 'butt' });
    g.poly([x - 3.5, bottom, x + 3.5, bottom, x, bottom + 6]).fill(IRON).stroke({ color: NAVY, width: 1.5 });
  }
  for (const t of [0.3, 0.7]) {
    const y = top + 2 + (bottom - top - 2) * t;
    g.moveTo(left + step * 0.6, y).lineTo(right - step * 0.6, y).stroke({ color: NAVY, width: 5 });
    g.moveTo(left + step * 0.6, y).lineTo(right - step * 0.6, y).stroke({ color: IRON, width: 2 });
  }
  if (despair) {
    // Two keys on a ring hung on the left post.
    const kx = left - 2, ky = top + (foot - top) * 0.45;
    g.circle(kx, ky, 6).stroke({ color: NAVY, width: 4 }).circle(kx, ky, 6).stroke({ color: GOLD, width: 2 });
    for (const [dx, a] of [[-4, 0.25], [4, -0.25]] as const) {
      const ex = kx + dx + Math.sin(a) * 14, ey = ky + 6 + Math.cos(a) * 14;
      g.moveTo(kx + dx * 0.5, ky + 5).lineTo(ex, ey).stroke({ color: NAVY, width: 5, cap: 'round' });
      g.moveTo(kx + dx * 0.5, ky + 5).lineTo(ex, ey).stroke({ color: GOLD, width: 2.5, cap: 'round' });
      g.rect(ex - 1, ey - 4, 5, 3).fill(GOLD).stroke({ color: NAVY, width: 1 });
    }
  }
}

/**
 * The bolt's line (px): from (x0, y0) to (x1, y1), `half` — half the bolt's width, `progress` — the windup 0…1. A faint band of the
 * bolt's width and a thin dashed line of the threat colour over a dark outline; both grow brighter as the windup runs out.
 * Returns the dashes drawn.
 */
export function drawBoltLine(g: Graphics, x0: number, y0: number, x1: number, y1: number, half: number, progress: number): number {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return 0;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux, k = Math.max(0, Math.min(1, progress));
  g.poly([x0 + nx * half, y0 + ny * half, x1 + nx * half, y1 + ny * half, x1 - nx * half, y1 - ny * half, x0 - nx * half, y0 - ny * half])
    .fill({ color: THREAT, alpha: 0.06 + 0.12 * k });
  let dashes = 0;
  for (let t = 0; t < len; t += 18) {
    const e = Math.min(len, t + 10);
    g.moveTo(x0 + ux * t, y0 + uy * t).lineTo(x0 + ux * e, y0 + uy * e);
    dashes++;
  }
  g.stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.55 + 0.3 * k, cap: 'round' });
  for (let t = 0; t < len; t += 18) {
    const e = Math.min(len, t + 10);
    g.moveTo(x0 + ux * t, y0 + uy * t).lineTo(x0 + ux * e, y0 + uy * e);
  }
  g.stroke({ color: THREAT, width: 2.2, alpha: 0.55 + 0.45 * k, cap: 'round' });
  return dashes;
}
