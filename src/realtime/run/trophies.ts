/**
 * Task 51е «Трофеи на стене лагеря» (docs/design-notes/task-51-camp-l3.md, sections 4, 8.1 and 10): the profile's trophies —
 * `meta.trophies`. Only a sight: a trophy gives nothing in a run (no pool, price or XP). Earned at the end of a meta run (`rtApplyMeta`)
 * by what the run did, no randomness; a run with a given seed («Поход дня» too) has no meta end, so no trophy. The retro of an old
 * profile (`rtTrophiesImport`) takes only what the profile knows for sure. The field is absent until the first trophy: a profile without
 * it reads and writes as before, byte for byte.
 */
import type { RtMeta } from './rtMeta';
import { rtForestCleared, rtLevel, type RtRunState } from './rtRun';
import { RT_HERO_IDS } from './metaCatalog';
import { JAILER_RUN_ARENAS, TROLL_RUN_ARENAS } from '../sim/arenasBoss';
import { RT_CHRONICLE_FOREST_KINDS } from './chronicleCatalog';
import type { RtChronicle } from './chronicle';

/**
 * The trophies in the order of the perch's hooks (spec 4): the Jailer's weight, the chain cut off, the Troll's horn, the Chief's pot,
 * the broken shackles, the Castellan's banner, «Доска Испытания» (a mark a step), «Чернильница Неясыти», the long chain.
 */
export type RtTrophyId = 'jailer' | 'severed' | 'troll' | 'chief' | 'shackles' | 'castellan' | 'ash' | 'bestiary' | 'long-chain';
export const RT_TROPHY_IDS: readonly RtTrophyId[] = ['jailer', 'severed', 'troll', 'chief', 'shackles', 'castellan', 'ash', 'bestiary', 'long-chain'];
export const isRtTrophyId = (id: unknown): id is RtTrophyId => typeof id === 'string' && (RT_TROPHY_IDS as readonly string[]).includes(id);
/** The perch's hooks (spec 4): up to 10. */
export const RT_TROPHY_HOOKS = 10;
/** «Длинная цепь»: a chain of this many links in one fight (`RtBattleRecord.bestChain`). */
export const RT_TROPHY_LONG_CHAIN = 12;
/** «Доска Испытания»: the steps of «Испытание» it marks (I–VIII). */
export const RT_TROPHY_ASH_STEPS = 8;

/** A trophy on the perch: the viewer's run it was earned in (`RtProfile.runs`; 0 — the retro, no number); «Доска Испытания» — its marks, sorted. */
export interface RtTrophy { id: RtTrophyId; run: number; marks?: number[] }
/** What a run earned (the end screen and the camp's drop): a trophy new, or a new mark of «Доска Испытания» (`mark`). */
export interface RtTrophyEarned { id: RtTrophyId; mark?: number }

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMark = (value: unknown): value is number => isCount(value) && value >= 1 && value <= RT_TROPHY_ASH_STEPS;

/** A stored list: known ids, each once, a whole run number from 0; marks only on `ash` (steps I–VIII, each once, sorted). Empty — absent. */
export function parseRtTrophies(value: unknown): RtTrophy[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: RtTrophy[] = [];
  for (const entry of value) {
    if (!isPlain(entry) || !isRtTrophyId(entry.id) || !isCount(entry.run) || out.some(t => t.id === entry.id)) continue;
    const marks = entry.id === 'ash' && Array.isArray(entry.marks) ? [...new Set(entry.marks.filter(isMark))].sort((a, b) => a - b) : [];
    // «Доска Испытания» without a valid mark is no trophy.
    if (entry.id === 'ash' && !marks.length) continue;
    out.push({ id: entry.id, run: entry.run, ...marks.length ? { marks } : {} });
  }
  return out.length ? out : undefined;
}

/**
 * The forest's chapter of the chronicle's bestiary is full (every kind of the forest met in a meta run, or by the retro): `kinds` — the
 * chapter's kinds (task 57а: those of this build, `RT_CHRONICLE_FOREST_KINDS` — with the shooters' flag on, eleven).
 */
export const rtBestiaryFull = (chronicle: Pick<RtChronicle, 'kinds'> | undefined, kinds: readonly string[] = RT_CHRONICLE_FOREST_KINDS): boolean =>
  kinds.every(id => chronicle?.kinds?.includes(id));

/**
 * What a meta run earned (spec 4), no randomness: the Jailer won (a won fight on his arenas), his weight severed, the Troll won (the
 * forest's final on the Troll's branch), shackles cut, the garrison passed, a chain of 12+ links in a fight, «Испытание» `run.ash` with
 * the forest passed (its step's mark), the forest's bestiary full (the chronicle after this run). The Chief's pot comes with the Chief in
 * the run (task 54б): «Последний рубеж», the final of the camp's branch before it, is no boss — no trophy.
 */
export function rtRunTrophies(run: RtRunState, chronicle: RtChronicle | undefined): RtTrophyEarned[] {
  const won = (arenas: readonly string[]) => run.battles.some(entry => entry.won && arenas.includes(entry.arena));
  const out: RtTrophyEarned[] = [];
  if (won(JAILER_RUN_ARENAS)) out.push({ id: 'jailer' });
  if (run.battles.some(entry => entry.severed)) out.push({ id: 'severed' });
  if (won(TROLL_RUN_ARENAS)) out.push({ id: 'troll' });
  if (run.battles.some(entry => (entry.cuts ?? 0) >= 1)) out.push({ id: 'shackles' });
  if (run.result?.outcome === 'victory' && rtLevel(run) === 2) out.push({ id: 'castellan' });
  // The forest passed: the run won (a forest run's final, or the garrison after it) or went on past the forest's final.
  if (run.ash && (run.result?.outcome === 'victory' || rtForestCleared(run))) out.push({ id: 'ash', mark: run.ash });
  if (rtBestiaryFull(chronicle)) out.push({ id: 'bestiary' });
  if (run.battles.some(entry => (entry.bestChain ?? 0) >= RT_TROPHY_LONG_CHAIN)) out.push({ id: 'long-chain' });
  return out;
}

/**
 * The earned joins the list: a trophy new — with the viewer's run `viewerRun`; «Доска Испытания» held — a new mark only. The list keeps
 * the order the trophies came in. `added` — what is new (empty — nothing changed).
 */
export function rtTrophiesAdd(previous: readonly RtTrophy[] | undefined, earned: readonly RtTrophyEarned[], viewerRun: number): { trophies: RtTrophy[] | undefined; added: RtTrophyEarned[] } {
  const list: RtTrophy[] = structuredClone([...previous ?? []]), added: RtTrophyEarned[] = [];
  for (const e of earned) {
    const held = list.find(t => t.id === e.id);
    if (!held) { list.push({ id: e.id, run: viewerRun, ...e.mark ? { marks: [e.mark] } : {} }); added.push({ ...e }); continue; }
    if (e.mark && !held.marks?.includes(e.mark)) { held.marks = [...held.marks ?? [], e.mark].sort((a, b) => a - b); added.push({ ...e }); }
  }
  return { trophies: list.length ? list : undefined, added };
}

/**
 * The retro (spec 4, question 9), once a profile (review 21.10.2026: `trophiesSince` marks it done, as the chronicle's `since`) — only
 * what the profile knows for sure, with run 0: the Castellan's banner (a hero's record passed the garrison, `wonLevel` 2), «Чернильница
 * Неясыти» (the chronicle's forest bestiary full without the kinds of the run in progress, `chronicle.fresh`: those are that run's, its
 * end gives the trophy with its number). Done before — `changed` false (no write); else the mark and the trophies found are written.
 */
export function rtTrophiesImport(meta: RtMeta | undefined, runs: number): { trophies: RtTrophy[] | undefined; since: number; changed: boolean } {
  if (meta?.trophiesSince !== undefined) return { trophies: meta.trophies, since: meta.trophiesSince, changed: false };
  const fresh = meta?.chronicle?.fresh ?? [], kinds = (meta?.chronicle?.kinds ?? []).filter(id => !fresh.includes(`kind:${id}`));
  const earned: RtTrophyEarned[] = [
    ...RT_HERO_IDS.some(id => meta?.heroes[id]?.record?.wonLevel === 2) ? [{ id: 'castellan' as const }] : [],
    ...rtBestiaryFull({ kinds }) ? [{ id: 'bestiary' as const }] : [],
  ];
  const { trophies } = rtTrophiesAdd(meta?.trophies, earned, 0);
  return { trophies, since: runs, changed: true };
}
