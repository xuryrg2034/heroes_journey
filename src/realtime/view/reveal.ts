/**
 * Task 47 «Сочность, пакет 2» (design 16.10.2026, docs/design-notes/task-47-view-polish.md): the pure part of the reward screens'
 * polish — no Pixi, no DOM, nothing of the world changes (no `Params`, the hash and the journal stay). Unit-tested in Node
 * (reveal.spec.ts).
 * - С5: the tier of a reward screen's chord — common / rare / form.
 * - С6: the reveal of the choice cards — one by one, the whole layout in `REVEAL_TOTAL` seconds.
 * - С8: the run-end lines — one by one, `END_STEP` seconds apart.
 * The timers are the view's own clock (real seconds); the simulation never reads them.
 */

/** С5: the tier of a reward chord: 0 common, 1 rare, 2 form (a fusion keeps its own chord, `meta('fuse')`). */
export type RewardTier = 0 | 1 | 2;
export const REWARD_TIERS: readonly RewardTier[] = [0, 1, 2];

/** С5: the tier of one card by its rarity: common and uncommon — 0; rare, relic, oath — 1; form — 2. A hammer (no rarity) — 1. */
export function cardTier(rarity: string | undefined): RewardTier {
  if (rarity === 'form') return 2;
  if (rarity === 'rare' || rarity === 'relic' || rarity === 'oath' || rarity === 'hammer') return 1;
  return 0;
}

/** С5: the tier of a screen — its best card (the screen shows what the offer can give, not what is picked: the chord sounds as it opens). */
export function screenTier(rarities: readonly (string | undefined)[]): RewardTier {
  return rarities.reduce<RewardTier>((best, r) => Math.max(best, cardTier(r)) as RewardTier, 0);
}

/** С6: the whole layout of a screen's cards, seconds (0.4–0.6 from the design); one card shows at once. */
export const REVEAL_TOTAL = 0.5;
/** С6: a card's fade-in, seconds. */
export const REVEAL_FADE = 0.14;

/** С6: the delay of every card (seconds from the opening); the last one ends its fade at `REVEAL_TOTAL`. One card or none — no reveal. */
export function revealDelays(n: number): number[] {
  if (n < 2) return [];
  const span = REVEAL_TOTAL - REVEAL_FADE;
  return Array.from({ length: n }, (_, i) => span * i / (n - 1));
}

/** С6: how many cards stand by `t` seconds after the opening (a card counts from the start of its fade). */
export function revealShown(n: number, t: number): number {
  const delays = revealDelays(n);
  if (!delays.length) return n;
  return delays.filter(d => t >= d).length;
}

/** С6: is the reveal over at `t`? */
export function revealDone(n: number, t: number): boolean {
  return !revealDelays(n).length || t >= REVEAL_TOTAL;
}

/** С8: seconds between the run-end lines. */
export const END_STEP = 0.15;

/** С8: the lines shown by `t` seconds after the screen opened (the first at once). */
export function endShown(n: number, t: number): number {
  return Math.min(n, Math.max(0, Math.floor(t / END_STEP) + 1));
}

/** С8: when the last of `n` lines is shown, seconds; the meta block (the experience, the record) starts after it. */
export function endTotal(n: number): number {
  return n > 0 ? (n - 1) * END_STEP + END_STEP : 0;
}
