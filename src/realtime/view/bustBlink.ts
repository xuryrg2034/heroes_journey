/**
 * Task 19 «Короткий запал» (view): the blink of the goblin's lit bust circle, 0…1 (1 — the brightest).
 *
 * The blink runs on the fuse's own time (`total - left`, game seconds since «lit»), not on the view's clock: it starts bright at
 * «lit» and speeds up from `BLINK_START` to `BLINK_END` rad/s by the blast, whatever the fuse (0.6 s in the run, 1.2 s elsewhere).
 * Before 14.10.2026 the phase was `clock * (10 + 16k)` with the view's clock: the fuse's progress `k` multiplied the whole clock,
 * so a minute into the session the blink ran at hundreds of hertz and the frames showed noise.
 */
export const BLINK_START = 10;
export const BLINK_END = 26;

export function bustBlink(left: number, total: number): number {
  if (!(total > 0)) return 1;
  const t = Math.max(0, Math.min(total, total - left));
  // Phase = ∫ (START + (END − START)·s/total) ds from 0 to t.
  const phase = BLINK_START * t + (BLINK_END - BLINK_START) * t * t / (2 * total);
  return 0.5 + 0.5 * Math.cos(phase);
}
