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
import { generatedRunMap, generateForestMap, nodePlace, TRAIL_FIRST_ROW, type GeneratedForestMap, type MapBranch } from '../forest/mapGenerator';
import type { Loadout } from '../sim/kit';
import { arenaTemplate } from '../sim/arenas';
import { ARMORY_ARENA, CASTELLAN_ARENA, GALLERY_ARENA, GUARDROOM_ARENA, KENNEL_ARENA, LOOPHOLES_ARENA, MOAT_ARENA, YARD_ARENA } from '../sim/arenasGarrison';
import { CROSSBOW } from '../sim/enemies/crossbow';
import { GUARD, HANDLER, KEYMASTER, KNIGHT } from '../sim/enemies/garrison';
import { pickArena, runRow, type ArenaPoolEntry } from './arenaPools';
import { RT_TALISMANS, rtTalismanEligible, rtWeightedPick, type RtTalismanId, type RtTalismanPool } from './rtTalismans';

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
/**
 * Task 43 «Гарнизон, шаг 2», part Г: a new run with «Ров» takes the arenas of step 2 (`RtRunState.step2`): «Ристалище» and the
 * knight, «Бойницы» and the crossbowman on the branch without «Ров», the knights in the start lines, the crossbowmen deep. A run saved
 * before it (no flag) plays the garrison of step 1б to its end, its pools byte for byte.
 */
export const RT_GARRISON_STEP2_ON = true;
/**
 * Task 59б «Гарнизон, шаг 3» (docs/design-notes/task-59-garrison-step3.md, 7.2): a new run of step 2 takes the arenas of step 3
 * (`RtRunState.step3`): the trails' drill («Ристалище» and the knight, or «Казарма» and the recruits), «Барбакан» and the wardens on `den`,
 * «Смолокурня» and the pitcher on `camp`. Off until the three arenas and the view (the design's decision turns it on). A run saved before
 * it (no flag) plays the garrison of step 2 to its end, its pools byte for byte.
 */
export const RT_GARRISON_STEP3_ON = false;
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The salt of the garrison's seed (its map, its streams, its arena seeds). */
export const GARRISON_SALT = textHash('garrison-map');
/** The garrison's seed of a run seed. */
export const garrisonSeed = (seed: number): number => mixSeed(seed >>> 0, GARRISON_SALT);
/**
 * Task 59б (user's decision 17.10.2026, question В1 (а)): the trails' drill of a run of step 3 — `armory` («Ристалище», the knight) or
 * `barracks` («Казарма», the recruits; no knight in this run). The spec draws it when the run enters the garrison by the garrison's
 * stream with the salt `garrison-drill`; it depends on the run's seed alone (no stream of the forest or of the pools is spent), so the
 * run draws it at its creation — the same value the entry would draw — and keeps it (`RtRunState.step3.drill`).
 */
export type GarrisonDrill = 'armory' | 'barracks';
export const GARRISON_DRILL_SALT = textHash('garrison-drill');
export const garrisonDrill = (seed: number): GarrisonDrill => ((mixSeed(garrisonSeed(seed), GARRISON_DRILL_SALT) & 1) === 0 ? 'armory' : 'barracks');
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
/**
 * Task 43, part Г (design 16.10.2026, task-43 spec 6): the pools of a run of step 2 (`RtRunState.step2`) — «Ристалище» on rows 3–4
 * (the knight's own arena) on the trails; the branches of rows 6–9 split: `den` (the left one) — «Ров» on rows 6–9 (the keymaster),
 * `camp` (the right one) — «Бойницы» on rows 6–7 (the crossbowman). Each kind is met only on its branch.
 */
export const GARRISON_STEP2_TRAIL_POOLS: readonly ArenaPoolEntry[] = [...GARRISON_POOLS, { arena: ARMORY_ARENA.id, rows: [3, 4] }];
/** Task 43: the branch with «Ров» (the other one has «Бойницы»). */
export const GARRISON_MOAT_BRANCH: MapBranch = 'den';
export const GARRISON_STEP2_POOLS: Readonly<Record<MapBranch, readonly ArenaPoolEntry[]>> = {
  den: [...GARRISON_STEP2_TRAIL_POOLS, { arena: MOAT_ARENA.id, rows: [6, 9] }],
  camp: [...GARRISON_STEP2_TRAIL_POOLS, { arena: LOOPHOLES_ARENA.id, rows: [6, 7] }],
};
export const GARRISON_ARMORY_ARENA = ARMORY_ARENA.id;
export const GARRISON_LOOPHOLES_ARENA = LOOPHOLES_ARENA.id;
/** Every arena the garrison plays (a save naming another one at a garrison node is malformed). */
export const GARRISON_RUN_ARENAS: readonly string[] = [...GARRISON_MOAT_POOLS.map(entry => entry.arena), ARMORY_ARENA.id, LOOPHOLES_ARENA.id, GARRISON_HARD_ARENA, GARRISON_FINAL_ARENA];
/** The names of the garrison's arenas on the run's map. */
export const GARRISON_ARENA_TITLES: Readonly<Record<string, string>> = Object.fromEntries(GARRISON_RUN_ARENAS.map(id => [id, arenaTemplate(id).name]));

/**
 * The garrison's new kinds and their own arenas (design 2.5: the line on «Плац», the leash on «Псарня»; task 40: the keymaster on
 * «Ров» — a run with the flag `moat`).
 */
export const GARRISON_KINDS = [GUARD, HANDLER] as const;
export const GARRISON_MOAT_KINDS = [GUARD, HANDLER, KEYMASTER] as const;
/** Task 43: the kinds of a run of step 2 — the trails' (the knight on «Ристалище»), each branch adds its own. */
export const GARRISON_STEP2_TRAIL_KINDS = [GUARD, HANDLER, KNIGHT] as const;
export const GARRISON_STEP2_KINDS: Readonly<Record<MapBranch, readonly string[]>> = { den: [...GARRISON_STEP2_TRAIL_KINDS, KEYMASTER], camp: [...GARRISON_STEP2_TRAIL_KINDS, CROSSBOW] };
export const GARRISON_OWN_ARENAS: Readonly<Record<string, string>> = {
  [GUARD]: YARD_ARENA.id, [HANDLER]: KENNEL_ARENA.id, [KEYMASTER]: MOAT_ARENA.id, [KNIGHT]: ARMORY_ARENA.id, [CROSSBOW]: LOOPHOLES_ARENA.id,
};
/**
 * The pools' mode of a garrison node: step 1а (`moat` false), «Ров» (task 40, `moat`), or step 2 (task 43, `step2`) with the node's
 * branch (`null` — the trails and the checkpoint, rows 1–5).
 */
export interface GarrisonMode { moat: boolean; step2?: { branch: MapBranch | null } }
const modeOf = (mode: boolean | GarrisonMode): GarrisonMode => (typeof mode === 'boolean' ? { moat: mode } : mode);
const kindsOf = (mode: GarrisonMode): readonly string[] =>
  (mode.step2 ? (mode.step2.branch ? GARRISON_STEP2_KINDS[mode.step2.branch] : GARRISON_STEP2_TRAIL_KINDS) : mode.moat ? GARRISON_MOAT_KINDS : GARRISON_KINDS);
const poolsOf = (mode: GarrisonMode): readonly ArenaPoolEntry[] =>
  (mode.step2 ? (mode.step2.branch ? GARRISON_STEP2_POOLS[mode.step2.branch] : GARRISON_STEP2_TRAIL_POOLS) : mode.moat ? GARRISON_MOAT_POOLS : GARRISON_POOLS);
/** Task 43: the step-2 mode of the garrison node `id` (its branch by the generator's id: `g:den-r11c1` → `den`). */
export const garrisonStep2Mode = (id: string): GarrisonMode => ({ moat: true, step2: { branch: nodePlace(bareNodeId(id))?.branch ?? null } });
/** The garrison's new kinds an arena brings (its newcomers and its start enemies; not its deep enemies). */
export function garrisonArenaKinds(arena: string, mode: boolean | GarrisonMode = false): string[] {
  const t = arenaTemplate(arena), kinds = new Set([...(t.newcomers ?? []).map(entry => entry.kind), ...t.enemies.map(entry => entry.kind ?? 'basic')]);
  return kindsOf(modeOf(mode)).filter(kind => kinds.has(kind));
}
/** Task 43: the kinds «Караульня» (the checkpoint every path plays on row 5) brings. */
const checkpointKinds = (): string[] => garrisonArenaKinds(GUARDROOM_ARENA.id, { moat: true, step2: { branch: null } });
const lastRow = (arena: string, mode: GarrisonMode): number => poolsOf(mode).find(entry => entry.arena === arena)?.rows[1] ?? 0;

/**
 * The arenas an ordinary garrison node (a battle, the breakthrough) on garrison row `row` may play after the arenas `history` of the
 * garrison — the forest's rule «a new enemy first on its own arena» (arenaPools.ts `ordinaryArenaChoices`) over the garrison's
 * kinds: an overdue kind (its own arena's rows are past) — its own arena; the own arenas of unmet kinds of the row; the row's
 * candidates that bring no unmet kind; the whole row. Task 40: `moat` — the pools and kinds of a run with «Ров».
 */
export function garrisonArenaChoices(row: number, history: readonly string[], moatOrMode: boolean | GarrisonMode = false): string[] {
  const mode = modeOf(moatOrMode);
  const candidates = poolsOf(mode).filter(entry => row >= entry.rows[0] && row <= entry.rows[1]).map(entry => entry.arena);
  const kindsIn = (arena: string): string[] => garrisonArenaKinds(arena, mode);
  const met = new Set(history.flatMap(kindsIn)), unmet = (arena: string) => kindsIn(arena).filter(kind => !met.has(kind));
  const overdue = kindsOf(mode).filter(kind => !met.has(kind) && row > lastRow(GARRISON_OWN_ARENAS[kind], mode)).map(kind => GARRISON_OWN_ARENAS[kind]);
  if (overdue.length) return overdue;
  const own = new Set<string>();
  for (const arena of candidates) for (const kind of unmet(arena)) own.add(GARRISON_OWN_ARENAS[kind]);
  // Task 43 (step 2): «одна новинка за бой» — an own arena that would bring another unmet kind too (the knight's «Ристалище» before
  // the guards' «Плац») waits for it while another own arena brings only its own; of those, the one whose rows end first comes first
  // («Ристалище», rows 3–4, before «Псарня», rows 2–6: a path has few battles on the trails).
  if (mode.step2) {
    const single = [...own].filter(arena => unmet(arena).every(kind => GARRISON_OWN_ARENAS[kind] === arena));
    const rank = (arena: string): number => (unmet(arena).some(kind => checkpointKinds().includes(kind)) ? 0 : 100) + lastRow(arena, mode);
    const first = Math.min(...single.map(rank));
    if (single.length) for (const arena of [...own]) if (!single.includes(arena) || rank(arena) > first) own.delete(arena);
  }
  const ordered = [...candidates.filter(arena => own.has(arena)), ...[...own].filter(arena => !candidates.includes(arena))];
  if (ordered.length) return ordered;
  const fitting = candidates.filter(arena => !unmet(arena).length);
  return fitting.length ? fitting : [...candidates];
}

/**
 * The arena of a garrison node (`type`, map `row`) by the draw `roll` of the garrison's pool stream after `history` (`moat` — task 40;
 * `step2` — task 43: the pools of step 2 by the node's branch, its `id`).
 */
export function garrisonArena(node: Pick<ForestMapNode, 'id' | 'type' | 'row'>, history: readonly string[], roll: number, moat = false, step2 = false): string {
  if (node.type === 'hard' || node.type === 'checkpoint') return GARRISON_HARD_ARENA;
  if (node.type === 'boss') return GARRISON_FINAL_ARENA;
  return pickArena(garrisonArenaChoices(runRow(node.row), history, step2 ? garrisonStep2Mode(node.id) : moat), history, roll);
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

/** Баланс (task 43, part Г): the crossbowmen in «Галерея» and «Караульня» from this garrison row (the deep row of task 40). */
export const GARRISON_BOLT_ROW = GARRISON_DEEP_ROW;
/**
 * Task 43, part Г: the fight of `arena` on garrison row `row` after `history` stands its crossbowmen (`Loadout.bolts`): «Галерея» and
 * «Караульня» from `GARRISON_BOLT_ROW` once «Бойницы» was played (only on its branch: the other never plays it). Only a run of step 2 asks.
 */
export function garrisonBolts(arena: string, row: number, history: readonly string[]): boolean {
  return row >= GARRISON_BOLT_ROW && (arena === GALLERY_ARENA.id || arena === GUARDROOM_ARENA.id) && history.includes(LOOPHOLES_ARENA.id);
}
/**
 * Баланс (task 43, part Г; design decision 16.10.2026 after the bot's curve): a knight in the start line of «Галерея» (rows 4–9) and
 * of «Караульня» on the hard nodes from this garrison row; none at the checkpoint (row 5: every path plays it).
 */
export const GARRISON_KNIGHT_HARD_ROW = 6;
export const GARRISON_KNIGHTS_GALLERY = 1;
export const GARRISON_KNIGHTS_HARD = 1;
/**
 * Task 43, part Г: knights in the start formations of the fight of `arena` (node `type`, garrison row `row`) after `history`
 * (`Loadout.knights`; 0 — none): «Галерея» and the hard «Караульня» from `GARRISON_KNIGHT_HARD_ROW`, once «Ристалище» was played («a
 * new enemy first on its own arena»); never in a deep fight (`garrisonDeep`: the keymaster there — design decision 16.10.2026 after
 * the bot's curve, «Галерея» with both 53 % deaths). Only a run of step 2 asks.
 */
export function garrisonKnights(arena: string, type: ForestMapNode['type'], row: number, history: readonly string[]): number {
  if (!history.includes(ARMORY_ARENA.id) || garrisonDeep(arena, row, history)) return 0;
  if (arena === GUARDROOM_ARENA.id) return type === 'hard' && row >= GARRISON_KNIGHT_HARD_ROW ? GARRISON_KNIGHTS_HARD : 0;
  return arena === GALLERY_ARENA.id ? GARRISON_KNIGHTS_GALLERY : 0;
}

// ---------- The forest final's reward ----------

const RELIC_SALT = textHash('garrison-relic');
/** Баланс (design 1.1): the forest final's reward — a relic 1 of this many. */
export const GARRISON_RELIC_SLOTS = 3;
/**
 * The relics the forest final offers (only relics, design 1.1): `GARRISON_RELIC_SLOTS` different relics of the pool by one draw
 * `base` of the run's `talismans` stream (an empty pool — fewer, or none: only the refusal).
 */
export function garrisonRelicOffer(base: number, pool: RtTalismanPool, slots = GARRISON_RELIC_SLOTS): RtTalismanId[] {
  const options: RtTalismanId[] = [];
  // Task 48: `slots` 4 after the Troll's three parts — the same draws, one more slot (the first three are those of 3).
  for (let slot = 0; slot < slots; slot++) {
    const left = RT_TALISMANS.filter(entry => entry.rarity === 'relic' && rtTalismanEligible(entry.id, pool, options)).map(entry => entry.id);
    if (!left.length) break;
    // Task 50: the run's archetype weighs the relics (`pool.habit`; none — the pick of before).
    options.push(rtWeightedPick(mixSeed(mixSeed(base >>> 0, RELIC_SALT), slot), left, pool.habit));
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
export function garrisonKit(kit: Loadout, node: Pick<ForestMapNode, 'type' | 'row'>, battle: 'battle' | 'hard' | 'final' | 'event', deep = false, step2: { knights: number; bolts: boolean } = { knights: 0, bolts: false }): void {
  if (deep) kit.deep = true; else delete kit.deep;
  // Task 43, part Г: the knights in the formations and the crossbowmen of a run of step 2 (absent — as before).
  if (step2.knights > 0) kit.knights = step2.knights; else delete kit.knights;
  if (step2.bolts) kit.bolts = true; else delete kit.bolts;
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
