/**
 * Task 50 «Сноровка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, 3.5): the view's words for the counters' rank
 * II — the rule line of a card, the rank mark (two notches under an icon) and which items wear it. View only: the numbers are the
 * sim's `HONE` (sim/talismansRt.ts), the rules themselves live in the build modules.
 *
 * The player's word is «Ранг II»; the Roman «II» never stands in one line with «Испытание» (one name, one meaning).
 */
import { COUNTER_TALISMANS as T, fusionRecipe } from '../sim/buildIds';
import { HONE } from '../sim/talismansRt';

/** «Ранг II: …» — what rank II adds to the counter's rule (docs/realtime-prototype.md, 9ш). The id is the counter's. */
export const HONE_RULES: Readonly<Record<string, string>> = {
  [T.fifthLink]: `каждое ${HONE.edgeEvery}-е звено цепи (3, 6, 9…) получает +2 силы.`,
  [T.thirdChain]: `бесплатный прыжок заряжает следующую цепь: её первое вражеское звено получает +${HONE.catchPower} силы.`,
  [T.prism]: `каждая смена цвета в цепи даёт +${HONE.prismEnergy} энергии.`,
  [T.shockwave]: 'вторая волна — вокруг места, где цепь началась.',
  [T.finisher]: 'щит даётся и цепи с одним убийством.',
  [T.eliteHunter]: `элита в цепи теряет ${HONE.hunterPlates} пластину до удара.`,
  [T.longArm]: `звено дальше обычного R получает +${HONE.armPower} силы.`,
  [T.frostEdge]: 'замерзает и ближайший к выжившему враг.',
};

/** The line of a card: «Ранг II: …». An id that is not a counter — empty. */
export const honeLine = (id: string): string => (HONE_RULES[id] ? `Ранг II: ${HONE_RULES[id]}` : '');

/** The rank mark: two notches (HTML; styled by `.rt-rank`). `test` — an optional test id. */
export const rankMarkHtml = (test?: string): string => `<s class="rt-rank" title="Ранг II"${test ? ` data-testid="${test}"` : ''} aria-label="Ранг II"><i></i><i></i></s>`;

/**
 * The item `id` wears rank II: a counter in the list, or a fusion whose counter part is in it (a part keeps its rank inside a
 * fusion, task 44 / design 6.1).
 */
export function wearsRank(honed: readonly string[] | undefined, id: string): boolean {
  if (!honed?.length) return false;
  if (honed.includes(id)) return true;
  const recipe = fusionRecipe(id);
  return !!recipe && honed.includes(recipe.counter);
}
