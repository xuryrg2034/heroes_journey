/**
 * Task 38 «Гарнизон, шаг 1» (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md; docs/realtime-slice.md, «Гарнизон»):
 * the rules of the garrison level of the run — pure data and functions, no run state. The run's flow (the forest final continues
 * into the garrison, the relic, «Предместье», the garrison's map) is run/rtRun.ts, section «Task 38».
 *
 * - **The map.** The same generator as the forest's (`generateForestMap`, forest/ unchanged) with the seed
 *   `mixSeed(seed, textHash('garrison-map'))` (as Slay the Spire's acts: the same generator, a salt of its own): 10 rows — trails
 *   1–4, the checkpoint «Караульня» on row 5, two branches 6–8, the breakthrough 9, the boss «Кастелян» on row 10 (both branches).
 *   Its nodes are the generated ones with the prefix `g:` (`g:r6c1`): the run tells them from the forest's, and every roll by a node
 *   id differs from the forest's. An event node of the garrison is a find («Оружейная»; the forest's events are not the garrison's).
 * - **Streams.** The garrison's own long streams (the same names, the garrison's seed): its `pool`, `talismans`, `merchant` draws
 *   start at 0; the forest's counters are not touched after the transition. A node's arena seed — from the garrison's seed.
 * - **Arenas.** Ordinary nodes play the garrison's pools (`GARRISON_POOLS`) by the rule «a new enemy first on its own arena»:
 *   «Плац» brings the guards' line, «Псарня» the leash and the hound. The checkpoint and the hard nodes play «Караульня», the boss
 *   nodes «Двор кастеляна» (sim/arenasGarrison.ts).
 * - **Task 40 «Гарнизон, шаг 1б»** (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md; a run with the flag
 *   `RtRunState.moat`): «Ров» joins the pools on rows 6–9 and brings the keymaster (its own arena: the first meeting); a deep fight
 *   (`Loadout.deep`) — «Ров» on rows 8–9 (a second keymaster, a dog handler), «Галерея» and «Караульня» from row 8 once «Ров» was
 *   played (a keymaster). A run without the flag plays the pools of step 1а.
 * - **Row tables** (design 3.2, a hypothesis): tough HP up to 3 on rows 1–5, up to 4 from row 6; elite plates 3 on rows 1–5, 4 from
 *   row 6; an affix on rows 1–8, two on row 9; elites from row 3 (the guaranteed one on ordinary nodes from row 3). The tough touch
 *   2 and the invulnerability 0.5 s from row 1; no second wind; the bag from row 1.
 */
import { mixSeed } from '../forest/items';
import type { ForestMapNode, ForestRunMap } from '../forest/forestMap';
import { generatedRunMap, generateForestMap, TRAIL_FIRST_ROW, type GeneratedForestMap } from '../forest/mapGenerator';
import type { Loadout } from '../sim/kit';
import { arenaTemplate } from '../sim/arenas';
import { CASTELLAN_ARENA, GALLERY_ARENA, GUARDROOM_ARENA, KENNEL_ARENA, MOAT_ARENA, YARD_ARENA } from '../sim/arenasGarrison';
import { GUARD, HANDLER, KEYMASTER } from '../sim/enemies/garrison';
import { pickArena, runRow, type ArenaPoolEntry } from './arenaPools';
import { RT_TALISMANS, rtTalismanEligible, type RtTalismanId, type RtTalismanPool } from './rtTalismans';

/**
 * A new run continues into the garrison after the forest final (`RtRunState.garrison`). On by design decision B (16.10.2026, v65): one
 * unexplained Playwright failure (53/54) before the rebase, four clean repeats after it; a new failure is a regression. A run created
 * with `garrison: false` (old-route tests) or saved without the flag ends at the forest final.
 */
export const RT_GARRISON_ON = true;
/**
 * Task 40 «Гарнизон, шаг 1б»: a new run with the garrison takes «Ров», the keymaster and the cart (`RtRunState.moat`). A run saved
 * before it (no flag) plays the garrison of step 1а to its end. On with the ui session's view of the shackles and the cart (design
 * decision 16.10.2026, task-40 spec section 10: off until the view, on with it). «Гарнизон пройден» (`wonLevel`) and the garrison's
 * telemetry do not depend on it — they act for every run with the garrison.
 */
export const RT_GARRISON_MOAT_ON = true;
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The salt of the garrison's seed (its map, its streams, its arena seeds). */
export const GARRISON_SALT = textHash('garrison-map');
/** The garrison's seed of a run seed. */
export const garrisonSeed = (seed: number): number => mixSeed(seed >>> 0, GARRISON_SALT);
/** The prefix of the garrison's node ids on the run's map. */
export const GARRISON_PREFIX = 'g:';
export const rtGarrisonNodeId = (id: string): boolean => id.startsWith(GARRISON_PREFIX);
/** The generator's id of a garrison node (`g:r6c1` → `r6c1`). */
export const bareNodeId = (id: string): string => (rtGarrisonNodeId(id) ? id.slice(GARRISON_PREFIX.length) : id);
/** The garrison's map of a run seed (the forest's generator, the garrison's seed). */
export const generateGarrisonMap = (seed: number): GeneratedForestMap => generateForestMap(garrisonSeed(seed));

/** The garrison's names of its fixed nodes (design 1.1: «Караульня», «Кастелян»; an event node — the find «Оружейная»). */
export const GARRISON_TITLE = 'Гарнизон';
export const GARRISON_CHECKPOINT_NAME = 'Караульня';
export const GARRISON_BOSS_NAME = 'Кастелян';
export const GARRISON_BREAKTHROUGH_NAME = 'Прорыв к башне';
export const GARRISON_FIND_NAME = 'Оружейная';

/**
 * The garrison's nodes as the run's map holds them: the generated nodes with the prefix `g:` on their ids and exits, the garrison's
 * names; an event node becomes a find («Оружейная», design answer 4: the forest's events are not the garrison's — step 1).
 */
export function garrisonNodes(map: GeneratedForestMap): ForestMapNode[] {
  return generatedRunMap(map).nodes.map(node => {
    const name = node.type === 'checkpoint' ? GARRISON_CHECKPOINT_NAME : node.type === 'boss' ? GARRISON_BOSS_NAME : node.type === 'breakthrough' ? GARRISON_BREAKTHROUGH_NAME
      : node.type === 'event' ? GARRISON_FIND_NAME : node.name;
    const find = node.type === 'event';
    return { ...node, id: GARRISON_PREFIX + node.id, next: node.next.map(id => GARRISON_PREFIX + id), name,
      ...find ? { type: 'find' as const, content: { kind: 'find' as const } } : {} };
  });
}

/**
 * The run's map in the garrison: the forest's nodes (its boss nodes lead to the garrison's first row) and the garrison's (`g:…`).
 * `starts()` — the forest's first row (the path of a run starts there; it reaches the garrison through a forest boss).
 */
export function garrisonCombinedMap(forest: GeneratedForestMap, garrison: GeneratedForestMap): ForestRunMap {
  const own = garrisonNodes(garrison), first = own.filter(node => node.row === TRAIL_FIRST_ROW).map(node => node.id);
  const forestMap = generatedRunMap(forest);
  const nodes = [...forestMap.nodes.map(node => (node.type === 'boss' ? { ...node, next: [...first] } : node)), ...own];
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { kind: 'generated', nodes, node: id => byId.get(id), starts: () => forestMap.starts() };
}

// ---------- Arenas ----------

/** Баланс (design 2.3 and 2.5): the garrison's pools by its rows — «Плац» 1–3, «Псарня» 2–6, «Галерея» 4–9. */
export const GARRISON_POOLS: readonly ArenaPoolEntry[] = [
  { arena: YARD_ARENA.id, rows: [1, 3] },
  { arena: KENNEL_ARENA.id, rows: [2, 6] },
  { arena: GALLERY_ARENA.id, rows: [4, 9] },
];
/** Task 40: the pools of a run with «Ров» (`RtRunState.moat`) — «Ров» on rows 6–9 too. */
export const GARRISON_MOAT_POOLS: readonly ArenaPoolEntry[] = [...GARRISON_POOLS, { arena: MOAT_ARENA.id, rows: [6, 9] }];
export const GARRISON_MOAT_ARENA = MOAT_ARENA.id;
/** «Караульня»: the garrison's checkpoint (row 5) and its hard nodes. */
export const GARRISON_HARD_ARENA = GUARDROOM_ARENA.id;
/** «Двор кастеляна»: the garrison's boss nodes. */
export const GARRISON_FINAL_ARENA = CASTELLAN_ARENA.id;
/** Every arena the garrison plays (a save naming another one at a garrison node is malformed). */
export const GARRISON_RUN_ARENAS: readonly string[] = [...GARRISON_MOAT_POOLS.map(entry => entry.arena), GARRISON_HARD_ARENA, GARRISON_FINAL_ARENA];
/** The names of the garrison's arenas on the run's map. */
export const GARRISON_ARENA_TITLES: Readonly<Record<string, string>> = Object.fromEntries(GARRISON_RUN_ARENAS.map(id => [id, arenaTemplate(id).name]));

/**
 * The garrison's new kinds and their own arenas (design 2.5: the line on «Плац», the leash on «Псарня»; task 40: the keymaster on
 * «Ров» — a run with the flag `moat`).
 */
export const GARRISON_KINDS = [GUARD, HANDLER] as const;
export const GARRISON_MOAT_KINDS = [GUARD, HANDLER, KEYMASTER] as const;
export const GARRISON_OWN_ARENAS: Readonly<Record<string, string>> = { [GUARD]: YARD_ARENA.id, [HANDLER]: KENNEL_ARENA.id, [KEYMASTER]: MOAT_ARENA.id };
const kindsOf = (moat: boolean): readonly string[] => (moat ? GARRISON_MOAT_KINDS : GARRISON_KINDS);
const poolsOf = (moat: boolean): readonly ArenaPoolEntry[] => (moat ? GARRISON_MOAT_POOLS : GARRISON_POOLS);
/** The garrison's new kinds an arena brings (its newcomers and its start enemies; not its deep enemies). */
export function garrisonArenaKinds(arena: string, moat = false): string[] {
  const t = arenaTemplate(arena), kinds = new Set([...(t.newcomers ?? []).map(entry => entry.kind), ...t.enemies.map(entry => entry.kind ?? 'basic')]);
  return kindsOf(moat).filter(kind => kinds.has(kind));
}
const lastRow = (arena: string, moat: boolean): number => poolsOf(moat).find(entry => entry.arena === arena)?.rows[1] ?? 0;

/**
 * The arenas an ordinary garrison node (a battle, the breakthrough) on garrison row `row` may play after the arenas `history` of the
 * garrison — the forest's rule «a new enemy first on its own arena» (arenaPools.ts `ordinaryArenaChoices`) over the garrison's
 * kinds: an overdue kind (its own arena's rows are past) — its own arena; the own arenas of unmet kinds of the row; the row's
 * candidates that bring no unmet kind; the whole row. Task 40: `moat` — the pools and kinds of a run with «Ров».
 */
export function garrisonArenaChoices(row: number, history: readonly string[], moat = false): string[] {
  const candidates = poolsOf(moat).filter(entry => row >= entry.rows[0] && row <= entry.rows[1]).map(entry => entry.arena);
  const kindsIn = (arena: string): string[] => garrisonArenaKinds(arena, moat);
  const met = new Set(history.flatMap(kindsIn)), unmet = (arena: string) => kindsIn(arena).filter(kind => !met.has(kind));
  const overdue = kindsOf(moat).filter(kind => !met.has(kind) && row > lastRow(GARRISON_OWN_ARENAS[kind], moat)).map(kind => GARRISON_OWN_ARENAS[kind]);
  if (overdue.length) return overdue;
  const own = new Set<string>();
  for (const arena of candidates) for (const kind of unmet(arena)) own.add(GARRISON_OWN_ARENAS[kind]);
  const ordered = [...candidates.filter(arena => own.has(arena)), ...[...own].filter(arena => !candidates.includes(arena))];
  if (ordered.length) return ordered;
  const fitting = candidates.filter(arena => !unmet(arena).length);
  return fitting.length ? fitting : [...candidates];
}

/** The arena of a garrison node (`type`, map `row`) by the draw `roll` of the garrison's pool stream after `history` (`moat` — task 40). */
export function garrisonArena(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[], roll: number, moat = false): string {
  if (node.type === 'hard' || node.type === 'checkpoint') return GARRISON_HARD_ARENA;
  if (node.type === 'boss') return GARRISON_FINAL_ARENA;
  return pickArena(garrisonArenaChoices(runRow(node.row), history, moat), history, roll);
}

/** Баланс (task 40, design 3): the deep fights from this garrison row — «Ров» with two keymasters and a dog handler, the keymaster in «Галерея» and «Караульня». */
export const GARRISON_DEEP_ROW = 8;
/**
 * Task 40: the fight of `arena` on garrison row `row` after the garrison's arenas `history` (this node's not among them) is deep
 * (`Loadout.deep`): «Ров» from `GARRISON_DEEP_ROW`; «Галерея» and «Караульня» from it once «Ров» was played (the keymaster met on
 * its own arena first). Only a run with the flag `moat` asks.
 */
export function garrisonDeep(arena: string, row: number, history: readonly string[]): boolean {
  if (row < GARRISON_DEEP_ROW) return false;
  if (arena === MOAT_ARENA.id) return true;
  return (arena === GALLERY_ARENA.id || arena === GUARDROOM_ARENA.id) && history.includes(MOAT_ARENA.id);
}

// ---------- The forest final's reward ----------

const RELIC_SALT = textHash('garrison-relic');
/** Баланс (design 1.1): the forest final's reward — a relic 1 of this many. */
export const GARRISON_RELIC_SLOTS = 3;
/**
 * The relics the forest final offers (only relics, design 1.1): `GARRISON_RELIC_SLOTS` different relics of the pool by one draw
 * `base` of the run's `talismans` stream (an empty pool — fewer, or none: only the refusal).
 */
export function garrisonRelicOffer(base: number, pool: RtTalismanPool): RtTalismanId[] {
  const options: RtTalismanId[] = [];
  for (let slot = 0; slot < GARRISON_RELIC_SLOTS; slot++) {
    const left = RT_TALISMANS.filter(entry => entry.rarity === 'relic' && rtTalismanEligible(entry.id, pool, options)).map(entry => entry.id);
    if (!left.length) break;
    options.push(left[mixSeed(mixSeed(base >>> 0, RELIC_SALT), slot) % left.length]);
  }
  return options;
}

// ---------- Row tables (design 3.2) ----------

/** Баланс: elites (random) from this garrison row; the guaranteed one on ordinary nodes too. */
export const GARRISON_ELITE_ROW = 3;
/** Баланс: the step of the tough HP (up to 4) and the plates (4) from this garrison row. */
export const GARRISON_STEP_ROW = 6;
/** Баланс: two affixes from this garrison row. */
export const GARRISON_AFFIX2_ROW = 9;
/** The kinds an elite of the garrison may be (design 2.5: «элита знакомого вида»; the handler is an elite only by its template). */
export const GARRISON_ELITE_KINDS: readonly string[] = ['basic', GUARD];

export const garrisonToughHp = (row: number): number => (row >= GARRISON_STEP_ROW ? 4 : 3);
export const garrisonPlates = (row: number): number => (row >= GARRISON_STEP_ROW ? 4 : 3);
export const garrisonAffixes = (row: number): number => (row >= GARRISON_AFFIX2_ROW ? 2 : 1);

/**
 * The garrison's rules over the loadout of a fight of a garrison node (`kit` — changed in place): the row tables, elites of a known
 * kind, the bag from row 1 (not the checkpoint, not the boss), no second wind; the boss fight — no random elites. Task 40: `deep` —
 * the arena's deep enemies stand too (`garrisonDeep`).
 */
export function garrisonKit(kit: Loadout, node: Pick<ForestMapNode, 'type' | 'row'>, battle: 'battle' | 'hard' | 'final' | 'event', deep = false): void {
  if (deep) kit.deep = true; else delete kit.deep;
  const row = runRow(node.row);
  delete kit.guaranteedElite; delete kit.eliteKinds; delete kit.affixKinds; delete kit.withoutKinds; delete kit.secondWind; delete kit.colors;
  kit.randomElites = battle !== 'final' && row >= GARRISON_ELITE_ROW;
  kit.eliteAffixes = garrisonAffixes(row);
  kit.elitePlates = garrisonPlates(row);
  kit.toughHp = garrisonToughHp(row);
  kit.eliteKinds = [...GARRISON_ELITE_KINDS];
  if ((battle === 'battle' || battle === 'event') && node.type !== 'checkpoint' && row >= GARRISON_ELITE_ROW) kit.guaranteedElite = true;
  if (node.type === 'checkpoint' || node.type === 'boss') kit.noBag = true; else delete kit.noBag;
}
