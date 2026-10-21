/**
 * The drawing order of the bodies (design 21.10.2026, docs/design-notes/task-48-troll.md §24, «bossPickArt»): what the player sees on top is the sim's
 * `artDrawnAbove` — the larger y (lower on the screen), at an equal y the larger id. render.ts used `zIndex = e.y`, and at an equal y PixiJS's stable sort
 * keeps the history (a body whose view is made anew — a colour or hp change — came last): the order must not depend on it. The rank is the place in
 * the sorted list, one number per body, read by `zIndex`. View only: it changes nothing in the world.
 */
import { artDrawnAbove } from '../sim/bossArt';
import type { Enemy } from '../sim/world';

/** The rank of each body by its id: the first is drawn lowest, the last on top (`artDrawnAbove` — the comparison). */
export function drawRanks(enemies: readonly Pick<Enemy, 'id' | 'y'>[]): Map<number, number> {
  const order = [...enemies].sort((a, b) => (artDrawnAbove(a, b) ? 1 : artDrawnAbove(b, a) ? -1 : 0));
  return new Map(order.map((e, i) => [e.id, i]));
}
