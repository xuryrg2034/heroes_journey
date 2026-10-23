/**
 * Task 55в «Замок в походе» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, sections 4–5, 7; docs/realtime-slice.md,
 * «Замок»): the rules of the castle level of the run — pure data and functions, no run state (the model: run/garrison.ts). The run's
 * flow (the Castellan continues into the castle, the relic, «Подножие», the castle's map, the Warlock ends the run) is run/rtRun.ts,
 * section «Task 55в».
 *
 * - **The map.** The forest's generator (`generateForestMap`, forest/ unchanged) with the seed `mixSeed(seed, textHash('castle-map'))`:
 *   10 rows — trails 1–4, the checkpoint «Бальный зал» on row 5, two branches 6–8 (step 1а: the same pools on both), the breakthrough 9
 *   («Прорыв к колдуну»), the boss «Колдун» on row 10 (both branches). Its nodes are the generated ones with the prefix `c:`; the
 *   garrison's boss nodes lead to its first row. An event node is a find («Кладовая»; no events, no goblins' circle).
 * - **Streams.** The castle's own long streams (the same names, the castle's seed), from 0; the garrison's are not touched after it.
 * - **Arenas** (spec 5.2): ordinary nodes play `CASTLE_POOLS` («Прихожая» 1–9, «Анфилада» 3–9) by «a new enemy first on its own arena»
 *   and «one novelty a fight»: «Прихожая» brings the barrel, its second fight (`castleDeep`) the wardrobe, «Анфилада» the rook (it
 *   waits until the wardrobe is met). The checkpoint and the hard nodes play «Бальный зал», the boss nodes «Зал колдуна».
 * - **Row tables** (spec 4.4, a hypothesis): `castleKit`.
 */
import { mixSeed } from '../forest/items';
import type { ForestMapNode, ForestRunMap } from '../forest/forestMap';
import { generatedRunMap, generateForestMap, TRAIL_FIRST_ROW, type GeneratedForestMap } from '../forest/mapGenerator';
import { MAX_TOUGH_HP, type Loadout } from '../sim/kit';
import { arenaTemplate } from '../sim/arenas';
import { BALLROOM_ARENA, ENFILADE_ARENA, HALL_ARENA, WARLOCK_ARENA } from '../sim/arenasCastle';
import { BARREL, ROOK, WARDROBE } from '../sim/enemies/castle';
import { pickArena, runRow, type ArenaPoolEntry } from './arenaPools';
import { garrisonCombinedMap, GARRISON_PREFIX } from './garrison';

/**
 * A new run with the garrison continues into the castle after the Castellan (`RtRunState.castle`). Off until the ui view of «Подножие»,
 * the castle's map and the run's end (spec 16: design turns it on with the view). A run created with `castle: false` or saved without the
 * flag ends at the Castellan, as before.
 */
export const RT_CASTLE_ON = false;
const textHash = (text: string): number => [...text].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The salt of the castle's seed (its map, its streams, its arena seeds). */
export const CASTLE_SALT = textHash('castle-map');
/** The castle's seed of a run seed (spec 4.2: the run's seed, not the garrison map chosen). */
export const castleSeed = (seed: number): number => mixSeed(seed >>> 0, CASTLE_SALT);
/** The prefix of the castle's node ids on the run's map. */
export const CASTLE_PREFIX = 'c:';
export const rtCastleNodeId = (id: string): boolean => id.startsWith(CASTLE_PREFIX);
/** The level of a node id: 3 — the castle's (`c:`), 2 — the garrison's (`g:`), 1 — the forest's. */
export const rtNodeLevel = (id: string): 1 | 2 | 3 => (rtCastleNodeId(id) ? 3 : id.startsWith(GARRISON_PREFIX) ? 2 : 1);
/** The castle's map of a run seed (the forest's generator, the castle's seed). */
export const generateCastleMap = (seed: number): GeneratedForestMap => generateForestMap(castleSeed(seed));

/** The castle's names of its fixed nodes (spec 4.2, 18). */
export const CASTLE_TITLE = 'Замок';
export const CASTLE_CHECKPOINT_NAME = 'Бальный зал';
export const CASTLE_BOSS_NAME = 'Колдун';
export const CASTLE_BREAKTHROUGH_NAME = 'Прорыв к колдуну';
export const CASTLE_FIND_NAME = 'Кладовая';

/** The castle's nodes as the run's map holds them: the prefix `c:` on ids and exits, the castle's names; an event node — a find. */
export function castleNodes(map: GeneratedForestMap): ForestMapNode[] {
  return generatedRunMap(map).nodes.map(node => {
    const name = node.type === 'checkpoint' ? CASTLE_CHECKPOINT_NAME : node.type === 'boss' ? CASTLE_BOSS_NAME : node.type === 'breakthrough' ? CASTLE_BREAKTHROUGH_NAME
      : node.type === 'event' ? CASTLE_FIND_NAME : node.name;
    const find = node.type === 'event';
    return { ...node, id: CASTLE_PREFIX + node.id, next: node.next.map(id => CASTLE_PREFIX + id), name,
      ...find ? { type: 'find' as const, content: { kind: 'find' as const } } : {} };
  });
}

/**
 * The run's map in the castle: the forest's and the garrison's nodes (`garrisonCombinedMap`; the garrison's boss nodes lead to the
 * castle's first row) and the castle's (`c:…`). `starts()` — the forest's first row.
 */
export function castleCombinedMap(forest: GeneratedForestMap, garrison: GeneratedForestMap, castle: GeneratedForestMap): ForestRunMap {
  const below = garrisonCombinedMap(forest, garrison), own = castleNodes(castle);
  const first = own.filter(node => node.row === TRAIL_FIRST_ROW).map(node => node.id);
  const nodes = [...below.nodes.map(node => (node.type === 'boss' && node.id.startsWith(GARRISON_PREFIX) ? { ...node, next: [...first] } : node)), ...own];
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { kind: 'generated', nodes, node: id => byId.get(id), starts: () => below.starts() };
}

// ---------- Arenas (spec 5.2) ----------

/** Баланс (spec 5.2): the castle's pools by its rows — «Прихожая» 1–9, «Анфилада» 3–9. */
export const CASTLE_POOLS: readonly ArenaPoolEntry[] = [
  { arena: HALL_ARENA.id, rows: [1, 9] },
  { arena: ENFILADE_ARENA.id, rows: [3, 9] },
];
/** «Бальный зал»: the castle's checkpoint (row 5) and its hard nodes. */
export const CASTLE_HARD_ARENA = BALLROOM_ARENA.id;
/** «Зал колдуна»: the castle's boss nodes. */
export const CASTLE_FINAL_ARENA = WARLOCK_ARENA.id;
/** Every arena the castle plays (a save naming another one at a castle node is malformed). */
export const CASTLE_RUN_ARENAS: readonly string[] = [...CASTLE_POOLS.map(entry => entry.arena), CASTLE_HARD_ARENA, CASTLE_FINAL_ARENA];
/** The names of the castle's arenas on the run's map. */
export const CASTLE_ARENA_TITLES: Readonly<Record<string, string>> = Object.fromEntries(CASTLE_RUN_ARENAS.map(id => [id, arenaTemplate(id).name]));
/** The castle's new kinds (the things and the rook) and their own arenas (spec 5.2, `CASTLE_OWN_ARENAS`: the wardrobe — «Прихожая» deep). */
export const CASTLE_KINDS: readonly string[] = [BARREL, WARDROBE, ROOK];
export const CASTLE_OWN_ARENAS: Readonly<Record<string, string>> = { [BARREL]: HALL_ARENA.id, [WARDROBE]: HALL_ARENA.id, [ROOK]: ENFILADE_ARENA.id };

/** Баланс (spec 5.2): the deep fights of «Анфилада» (a third rook) and of a hard «Бальный зал» (a third wardrobe) from this castle row. */
export const CASTLE_DEEP_ROW = 6;
/**
 * Spec 5.1–5.2: the fight of `arena` (node `type`, castle row `row`) after the castle's arenas `history` (this node's not among them) is
 * deep (`Loadout.deep`): «Прихожая» from its second fight (the wardrobes); «Анфилада» and a hard «Бальный зал» from `CASTLE_DEEP_ROW`
 * (the checkpoint on row 5 never).
 */
export function castleDeep(arena: string, type: ForestMapNode['type'], row: number, history: readonly string[]): boolean {
  if (arena === HALL_ARENA.id) return history.includes(HALL_ARENA.id);
  if (arena === ENFILADE_ARENA.id) return row >= CASTLE_DEEP_ROW;
  return arena === BALLROOM_ARENA.id && type === 'hard' && row >= CASTLE_DEEP_ROW;
}
/** The castle's kinds a fight of `arena` stands (its start enemies, and its deep ones when `deep`). */
export function castleArenaKinds(arena: string, deep: boolean): string[] {
  const t = arenaTemplate(arena), kinds = new Set([...t.enemies, ...deep ? t.deepEnemies ?? [] : []].map(entry => entry.kind ?? 'basic'));
  return CASTLE_KINDS.filter(kind => kinds.has(kind));
}
/**
 * The castle's kinds met after the arenas `history` (each fight's kinds; «Прихожая» deep from its second fight — the deep enemies of
 * «Анфилада» and «Бальный зал» are kinds their start lines already stand).
 */
export function castleMetKinds(history: readonly string[]): Set<string> {
  return new Set(history.flatMap((arena, i) => castleArenaKinds(arena, arena === HALL_ARENA.id && history.slice(0, i).includes(HALL_ARENA.id))));
}

/**
 * The arenas an ordinary castle node (a battle, the breakthrough) on castle row `row` may play after the castle's arenas `history`
 * (spec 5.2; the garrison's rule of step 2, `garrisonArenaChoices`): the own arenas of the unmet kinds the row's candidates bring —
 * only those that bring nothing but their own kind («одна новинка за бой»: «Анфилада» waits while the wardrobe is unmet); none — the
 * candidates that bring no unmet kind; else the whole row.
 */
export function castleArenaChoices(row: number, history: readonly string[]): string[] {
  const candidates = CASTLE_POOLS.filter(entry => row >= entry.rows[0] && row <= entry.rows[1]).map(entry => entry.arena);
  const met = castleMetKinds(history), unmet = (arena: string): string[] => castleArenaKinds(arena, arena === HALL_ARENA.id && history.includes(HALL_ARENA.id)).filter(kind => !met.has(kind));
  const own = new Set<string>();
  for (const arena of candidates) for (const kind of unmet(arena)) own.add(CASTLE_OWN_ARENAS[kind]);
  const single = candidates.filter(arena => own.has(arena) && unmet(arena).every(kind => CASTLE_OWN_ARENAS[kind] === arena));
  if (single.length) return single;
  const fitting = candidates.filter(arena => !unmet(arena).length);
  return fitting.length ? fitting : [...candidates];
}

/** The arena of a castle node (`type`, map `row`) by the draw `roll` of the castle's pool stream after `history`. */
export function castleArena(node: Pick<ForestMapNode, 'type' | 'row'>, history: readonly string[], roll: number): string {
  if (node.type === 'hard' || node.type === 'checkpoint') return CASTLE_HARD_ARENA;
  if (node.type === 'boss') return CASTLE_FINAL_ARENA;
  return pickArena(castleArenaChoices(runRow(node.row), history), history, roll);
}

// ---------- Row tables (spec 4.4, a hypothesis) ----------

/** Баланс: random elites from this castle row; the guaranteed one on ordinary nodes from `CASTLE_GUARANTEED_ROW`. */
export const CASTLE_ELITE_ROW = 2;
export const CASTLE_GUARANTEED_ROW = 3;
/** Баланс: the step of the tough HP (5) and the plates (5) from this castle row; two affixes from `CASTLE_AFFIX2_ROW`. */
export const CASTLE_STEP_ROW = 6;
export const CASTLE_AFFIX2_ROW = 7;
/** The kinds an elite of the castle may be (spec 4.4: basic only; never a thing, the rook-elite is step 1б). */
export const CASTLE_ELITE_KINDS: readonly string[] = ['basic'];

/**
 * Spec 4.4: the tough HP up to 4 on rows 1–5, up to 5 from row 6 — the kit plays at most `MAX_TOUGH_HP` (4 today: rows 6–9 play 4
 * until the simulation's cap rises; an open question of task 55в). The boss row's crowd — as row 9.
 */
export const castleToughHp = (row: number): number => Math.min(MAX_TOUGH_HP, row >= CASTLE_STEP_ROW ? 5 : 4);
export const castlePlates = (row: number): number => (row >= CASTLE_STEP_ROW ? 5 : 4);
export const castleAffixes = (row: number): number => (row >= CASTLE_AFFIX2_ROW ? 2 : 1);

/**
 * The castle's rules over the loadout of a fight of a castle node (`kit` — changed in place; the model `garrisonKit`): the row tables,
 * basic elites (random from row 2, the guaranteed one on ordinary nodes from row 3), the bag from row 1 (not the checkpoint, not the
 * boss), no second wind; the boss fight — no elites, its crowd's tables as row 9. `deep` — the arena's deep enemies stand too (`castleDeep`).
 */
export function castleKit(kit: Loadout, node: Pick<ForestMapNode, 'type' | 'row'>, battle: 'battle' | 'hard' | 'final' | 'event', deep = false): void {
  if (deep) kit.deep = true; else delete kit.deep;
  const row = Math.min(9, runRow(node.row));
  delete kit.guaranteedElite; delete kit.eliteKinds; delete kit.affixKinds; delete kit.withoutKinds; delete kit.secondWind; delete kit.colors;
  delete kit.knights; delete kit.bolts;
  kit.randomElites = battle !== 'final' && row >= CASTLE_ELITE_ROW;
  kit.eliteAffixes = castleAffixes(row);
  kit.elitePlates = castlePlates(row);
  kit.toughHp = castleToughHp(row);
  kit.eliteKinds = [...CASTLE_ELITE_KINDS];
  if ((battle === 'battle' || battle === 'event') && node.type !== 'checkpoint' && row >= CASTLE_GUARANTEED_ROW) kit.guaranteedElite = true;
  if (node.type === 'checkpoint' || node.type === 'boss') kit.noBag = true; else delete kit.noBag;
}
