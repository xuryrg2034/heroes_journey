/**
 * Generated forest map (docs/roguelike-runs.md, section 3; docs/biomes/forest-map.md, «Генерация карты»): a new map
 * by the run seed every run, after the Slay the Spire generator. Pure, deterministic, no engine and no run state.
 *
 * Skeleton:
 * - rows 1–4: the trunk of the authored graph (played only in the first run, playerProfile.ts);
 * - rows 5–8: the trails, a grid of 3 columns walked by TRAIL_PASSES passes from bottom to top;
 * - row 9: the Jailer, the only node: every path meets there; its victory opens the spin;
 * - rows 10–12: two branches, den (beasts → Troll) and camp (goblins → Chief), 3 columns each (decision of 04.10.2026),
 *   BRANCH_PASSES passes; on a branch path 0–1 hard battle (two do not fit three rows with a rest 1–3 rows before);
 *   events stand on rows 10–11 of a branch (event catalogue, docs/events.md, from generator 3);
 * - row 13: the branch breakthrough; row 14: the branch boss.
 * A pass steps to the same or a neighbouring column and never crosses an edge already drawn (it goes straight
 * instead), so every node has an entry and an exit.
 *
 * Node types are laid out on the free nodes (rows 6–8 and 10–12) from a bag of shares, then the rules are checked on
 * every path; a violation is not patched into a battle (that greedy fix of StS piles hard battles and rests on one
 * row): the layout is shuffled again, and after LAYOUT_ATTEMPTS the section's paths are walked again, all from the
 * same seeded sequence. The map depends only on the run seed: battles, events and refills use other streams.
 *
 * Node ids come from row, column and branch (`r6c1`, `r9c1`, `den-r11c0`, `camp-r14c0`), so the node seed of a battle,
 * find or event (forestRun.ts, forestNodeSeed) is stable for a seed.
 */
import { mixSeed } from '../items';
import { TOOL_ROWS } from './battlePools';
import { FOREST_EVENTS } from './forestEvents';
import { FOREST_MAP, FOREST_REST_HEAL, FROST, JUMP, SPIN_REWARD, isTrunkNode, type ForestLane, type ForestMapNode, type ForestNodeType, type ForestRunMap } from './forestMap';

/**
 * Version of the generator; a saved run keeps its map, so a newer generator does not change a run in progress.
 * 2 (04.10.2026): the merchant (`shop`) and the ladder's share of hard battles.
 * 3 (04.10.2026): events in the branches, rows 10–11 (BRANCH_SHARES.event); the trails are laid out as in version 2.
 */
export const MAP_GENERATOR_VERSION = 3;

// Баланс: shape of the map.
/** Trail rows and columns, and the passes walked through them (StS: 6 passes over 7 columns). */
export const TRAIL_FIRST_ROW = 5, TRAIL_LAST_ROW = 8, TRAIL_COLUMNS = 3, TRAIL_PASSES = 4;
export const CHECKPOINT_ROW = 9;
/** Rows and columns of each branch and the passes walked through it. */
export const BRANCH_FIRST_ROW = 10, BRANCH_LAST_ROW = 12, BRANCH_COLUMNS = 3, BRANCH_PASSES = 4;
export const BREAKTHROUGH_ROW = 13, BOSS_ROW = 14;
export const BRANCHES = ['den', 'camp'] as const;
export type MapBranch = typeof BRANCHES[number];

// Баланс: shares of the free node types (StS: rest 12%, event 22%, elite 8%; ours are hypotheses for the playtest).
/** Trails, rows 6–8 (row 5 is battles only): the rest of the bag is battles. */
export const TRAIL_SHARES = { find: 0.15, rest: 0.15, event: 0.20 } as const;
/**
 * Branches, rows 10–12: the rest of the bag is battles. At least one hard battle and one rest per branch. Events
 * (docs/events.md, section 4): about this share of a branch's nodes, laid on its rows up to BRANCH_EVENT_LAST_ROW.
 */
export const BRANCH_SHARES = { hard: 0.2, rest: 0.25, event: 0.15 } as const;
/** The last branch row an event stands on (rows 10–11; row 12 is the last before the breakthrough). */
export const BRANCH_EVENT_LAST_ROW = 11;
/**
 * The merchant (docs/roguelike-runs.md, 5б): about this share of the free nodes of a map (rows 6–8 and 10–12), at least
 * one per map, so every map has a path through a merchant. The count is decided for the whole map and spread over the
 * three sections by their free nodes; each section then lays its merchants out with the rest of its bag.
 */
export const SHOP_SHARE = 0.05, SHOPS_PER_MAP_MIN = 1;
/** A rest stands 1–3 rows before every hard battle on every path (playtest decision 30.09.2026). */
export const REST_BEFORE_HARD = { min: 1, max: 3 } as const;
/** Types that never stand twice in a row on a path. */
export const NO_REPEAT_TYPES: readonly ForestNodeType[] = ['hard', 'rest', 'find', 'shop'];
/** Events on one path at most: an event does not repeat in a run. */
export const EVENTS_PER_PATH = Object.keys(FOREST_EVENTS).length;
const LAYOUT_ATTEMPTS = 200, STRUCTURE_ATTEMPTS = 200;

/** One node of a saved map: everything else (name, lane, place, content, grants) is derived from the id and type. */
export interface StoredMapNode { id: string; type: ForestNodeType; next: string[] }
export interface GeneratedForestMap { generator: number; nodes: StoredMapNode[] }

const textHash = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let n = 0; n < text.length; n++) hash = Math.imul(hash ^ text.charCodeAt(n), 0x01000193) >>> 0;
  return hash;
};
/** mulberry32: a small seeded generator of [0, 1). */
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = state + 0x6d2b79f5 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n) };
}
type Random = ReturnType<typeof seeded>;

// ---------- Ids ----------

export interface NodePlace { row: number; column: number; lane: ForestLane; branch?: MapBranch }
const TRAIL_LANES: readonly ForestLane[] = ['beasts', 'shared', 'goblins'];
export const trailId = (row: number, column: number) => `r${row}c${column}`;
export const branchId = (branch: MapBranch, row: number, column: number) => `${branch}-r${row}c${column}`;
export const CHECKPOINT_ID = trailId(CHECKPOINT_ROW, 1);

/** Row, column and lane of a generated node id; null for an id the generator never makes. */
export function nodePlace(id: string): NodePlace | null {
  let match = /^r(\d+)c(\d)$/.exec(id);
  if (match) {
    const row = Number(match[1]), column = Number(match[2]);
    if (row === CHECKPOINT_ROW && column === 1) return { row, column, lane: 'shared' };
    if (row >= TRAIL_FIRST_ROW && row <= TRAIL_LAST_ROW && column < TRAIL_COLUMNS) return { row, column, lane: TRAIL_LANES[column] };
    return null;
  }
  match = /^(den|camp)-r(\d+)c(\d)$/.exec(id);
  if (!match) return null;
  const branch = match[1] as MapBranch, row = Number(match[2]), column = Number(match[3]);
  if (row >= BRANCH_FIRST_ROW && row <= BRANCH_LAST_ROW && column < BRANCH_COLUMNS) return { row, column, lane: branch, branch };
  if ((row === BREAKTHROUGH_ROW || row === BOSS_ROW) && column === 0) return { row, column, lane: branch, branch };
  return null;
}

/** Node types a place may hold. */
export function placeTypes(place: NodePlace): readonly ForestNodeType[] {
  if (place.row === TRAIL_FIRST_ROW) return ['battle'];
  if (place.row <= TRAIL_LAST_ROW) return ['battle', 'rest', 'find', 'event', 'shop'];
  if (place.row === CHECKPOINT_ROW) return ['checkpoint'];
  if (place.row <= BRANCH_EVENT_LAST_ROW) return ['battle', 'hard', 'rest', 'shop', 'event'];
  if (place.row <= BRANCH_LAST_ROW) return ['battle', 'hard', 'rest', 'shop'];
  return place.row === BREAKTHROUGH_ROW ? ['breakthrough'] : ['boss'];
}

// ---------- Building the run map ----------

const NAMES: Record<ForestNodeType, string> = {
  battle: 'Бой', hard: 'Трудный бой', rest: 'Привал', find: 'Находка', event: 'Событие', shop: 'Торговец', checkpoint: 'Тюремщик', breakthrough: 'Прорыв', boss: 'Босс',
};
const BRANCH_NAMES: Record<MapBranch, { breakthrough: string; boss: string }> = {
  den: { breakthrough: 'Выход из логова', boss: 'Тролль' }, camp: { breakthrough: 'Прорыв к воротам', boss: 'Главарь с котелком' },
};
/** Vertical place on the screen: the trails in the middle three quarters, den above, camp below. */
function slotOf(place: NodePlace): number {
  if (!place.branch) return place.row === CHECKPOINT_ROW ? 0.5 : (place.column + 1) / (TRAIL_COLUMNS + 1);
  const base = place.branch === 'den' ? 0 : 0.5;
  return place.row > BRANCH_LAST_ROW ? base + 0.25 : base + (place.column + 0.5) / (BRANCH_COLUMNS * 2);
}

/** Full node of a stored one: generic name (the pick names it later), lane, place, content and the row grants. */
export function generatedNode(stored: StoredMapNode): ForestMapNode {
  const place = nodePlace(stored.id);
  if (!place) throw new Error(`Узел ${stored.id} не принадлежит сгенерированной карте.`);
  const { type } = stored;
  const name = place.branch && (type === 'breakthrough' || type === 'boss') ? BRANCH_NAMES[place.branch][type] : NAMES[type];
  const content: ForestMapNode['content'] = type === 'rest' ? { kind: 'rest', heal: FOREST_REST_HEAL } : type === 'find' ? { kind: 'find' } : type === 'shop' ? { kind: 'shop' } : { kind: 'pool' };
  return { id: stored.id, type, name, lane: place.lane, row: place.row, column: place.column as 0 | 1 | 2, slot: slotOf(place), content, next: [...stored.next],
    ...place.row === TOOL_ROWS.frost ? { grants: FROST } : place.row === TOOL_ROWS.jump ? { grants: JUMP } : {},
    ...type === 'checkpoint' ? { rewardGrants: SPIN_REWARD } : {} };
}

const TRUNK = FOREST_MAP.filter(isTrunkNode);

/** The run map of a generated map: the authored trunk, its exit leading to the first trail row, then the generated nodes. */
export function generatedRunMap(map: GeneratedForestMap): ForestRunMap {
  const nodes = map.nodes.map(generatedNode);
  const firstRow = nodes.filter(node => node.row === TRAIL_FIRST_ROW).map(node => node.id);
  const trunk = TRUNK.map(node => node.next.some(id => !TRUNK.some(entry => entry.id === id)) ? { ...node, next: [...firstRow] } : { ...node, next: [...node.next] });
  const all = [...trunk, ...nodes], byId = new Map(all.map(node => [node.id, node]));
  return { kind: 'generated', nodes: all, node: id => byId.get(id), starts: skipTrunk => skipTrunk ? [...firstRow] : [TRUNK[0].id] };
}

/**
 * Structural checks of a stored map (a saved run): ids and types of the generator, edges one row deeper and at most one
 * column aside, the fixed rows, no node without an entry or an exit. Balance rules (shares, forks) are the generator's
 * and are not required of a save, so a run survives a later tuning of the generator. An empty list means valid.
 */
export function validateStoredMap(map: unknown): string[] {
  const errors: string[] = [];
  if (!map || typeof map !== 'object' || !Array.isArray((map as GeneratedForestMap).nodes) || !Number.isInteger((map as GeneratedForestMap).generator)) return ['Карта: нет узлов.'];
  const nodes = (map as GeneratedForestMap).nodes, places = new Map<string, NodePlace>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !Array.isArray(node.next) || node.next.some(id => typeof id !== 'string')) { errors.push('Карта: неверный узел.'); continue; }
    const place = nodePlace(node.id);
    if (!place) { errors.push(`${node.id}: такого места нет на сгенерированной карте.`); continue; }
    if (places.has(node.id)) errors.push(`${node.id}: повтор.`);
    places.set(node.id, place);
    if (!placeTypes(place).includes(node.type)) errors.push(`${node.id}: тип ${node.type} не стоит на ряду ${place.row}.`);
  }
  if (errors.length) return errors;
  const fixed = [CHECKPOINT_ID, ...BRANCHES.flatMap(branch => [branchId(branch, BREAKTHROUGH_ROW, 0), branchId(branch, BOSS_ROW, 0)])];
  for (const id of fixed) if (!places.has(id)) errors.push(`${id}: обязательный узел отсутствует.`);
  const entries = new Map<string, number>();
  for (const node of nodes) {
    const from = places.get(node.id)!;
    if (from.row === BOSS_ROW) { if (node.next.length) errors.push(`${node.id}: босс завершает путь.`); continue; }
    if (!node.next.length) errors.push(`${node.id}: нет выхода.`);
    for (const id of node.next) {
      const to = places.get(id);
      if (!to) { errors.push(`${node.id} → ${id}: нет такого узла.`); continue; }
      entries.set(id, (entries.get(id) ?? 0) + 1);
      // Inside a grid (trail rows 5–8, branch rows 10–12) a step goes one column aside at most; the fixed nodes join them.
      const inGrid = (place: NodePlace) => place.row !== CHECKPOINT_ROW && place.row < BREAKTHROUGH_ROW;
      if (to.row !== from.row + 1) errors.push(`${node.id} → ${id}: переход только на следующий ряд.`);
      else if (from.row !== CHECKPOINT_ROW && from.branch !== to.branch) errors.push(`${node.id} → ${id}: переход между ветками.`);
      else if (inGrid(from) && inGrid(to) && Math.abs(to.column - from.column) > 1) errors.push(`${node.id} → ${id}: шаг больше чем на одну колонку.`);
    }
  }
  for (const [id, place] of places) if (place.row !== TRAIL_FIRST_ROW && !entries.get(id)) errors.push(`${id}: нет входа.`);
  if (![...places.values()].some(place => place.row === TRAIL_FIRST_ROW)) errors.push('Карта: нет узлов первого ряда троп.');
  for (const branch of BRANCHES) if (!nodes.some(node => node.id === CHECKPOINT_ID && node.next.some(id => places.get(id)?.branch === branch))) errors.push(`${CHECKPOINT_ID}: нет перехода в ветку ${branch}.`);
  return errors;
}

// ---------- Generation ----------

/** A grid section walked by passes: cells `row:column` and the next columns of each cell. */
interface Grid { firstRow: number; lastRow: number; columns: number; next: Map<string, Set<number>> }
const key = (row: number, column: number) => `${row}:${column}`;
const cellsOf = (grid: Grid) => [...grid.next.keys()].map(cell => cell.split(':').map(Number) as [number, number])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

/** Passes from the first to the last row: a step to the same or a neighbouring column, never across a drawn edge. */
function walkPasses(random: Random, firstRow: number, lastRow: number, columns: number, passes: number): Grid {
  const grid: Grid = { firstRow, lastRow, columns, next: new Map() };
  const touch = (row: number, column: number) => { if (!grid.next.has(key(row, column))) grid.next.set(key(row, column), new Set()); };
  let firstStart = -1;
  for (let pass = 0; pass < passes; pass++) {
    let column = random.int(columns);
    // As in StS, the first two passes start in different columns: the map always opens with a choice.
    if (pass === 1) while (column === firstStart) column = random.int(columns);
    if (pass === 0) firstStart = column;
    touch(firstRow, column);
    for (let row = firstRow; row < lastRow; row++) {
      const options = [column - 1, column, column + 1].filter(next => next >= 0 && next < columns);
      let next = options[random.int(options.length)];
      // A diagonal step across an edge going the other way would cross it: go straight instead.
      if (next === column + 1 && grid.next.get(key(row, column + 1))?.has(column)) next = column;
      if (next === column - 1 && grid.next.get(key(row, column - 1))?.has(column)) next = column;
      grid.next.get(key(row, column))!.add(next); touch(row + 1, next); column = next;
    }
  }
  return grid;
}

/** Every path of a section from its first to its last row, as cell keys. */
function sectionPaths(grid: Grid): string[][] {
  const walk = (row: number, column: number): string[][] => {
    const here = key(row, column), next = [...grid.next.get(here)!].sort();
    return row === grid.lastRow ? [[here]] : next.flatMap(to => walk(row + 1, to).map(path => [here, ...path]));
  };
  return cellsOf(grid).filter(([row]) => row === grid.firstRow).flatMap(([row, column]) => walk(row, column));
}

/** A bag count: the expected share with a random rounding, so small sections keep the share on average. */
const share = (random: Random, count: number, part: number) => Math.floor(count * part + random.next());
function shuffle<T>(random: Random, list: T[]): T[] {
  for (let n = list.length - 1; n > 0; n--) { const k = random.int(n + 1); [list[n], list[k]] = [list[k], list[n]]; }
  return list;
}

/** Rule violations of a typed section on its paths and forks (the parent of the first row is the section's entry). */
function sectionErrors(grid: Grid, types: Map<string, ForestNodeType>, free: (cell: string) => boolean, branch: boolean): string | null {
  const paths = sectionPaths(grid);
  let withHard = false, withoutHard = false;
  for (const path of paths) {
    const kinds = path.map(cell => types.get(cell)!);
    for (let n = 1; n < kinds.length; n++) if (kinds[n] === kinds[n - 1] && NO_REPEAT_TYPES.includes(kinds[n])) return `${kinds[n]} twice in a row`;
    if (kinds.filter(kind => kind === 'event').length > EVENTS_PER_PATH) return 'too many events';
    for (let n = 0; n < kinds.length; n++) {
      if (kinds[n] !== 'hard') continue;
      const before = kinds.slice(Math.max(0, n - REST_BEFORE_HARD.max), n - REST_BEFORE_HARD.min + 1);
      if (!before.includes('rest')) return 'hard without a rest before';
    }
    if (kinds.includes('hard')) withHard = true; else withoutHard = true;
  }
  if (branch && !(withHard && withoutHard)) return 'no choice of risk';
  // Forks: the children of one parent differ in type (the section entry is the parent of the first row).
  const parents = [[...cellsOf(grid).filter(([row]) => row === grid.firstRow).map(([row, column]) => key(row, column))],
    ...cellsOf(grid).map(([row, column]) => [...grid.next.get(key(row, column))!].map(next => key(row + 1, next)))];
  for (const children of parents) {
    const typed = children.filter(free).map(cell => types.get(cell)!);
    if (new Set(typed).size !== typed.length) return 'equal siblings';
  }
  return null;
}

/** Free cells of a trail section (rows 6–8; row 5 is battles only). */
const trailFree = (grid: Grid) => cellsOf(grid).filter(([row]) => row > TRAIL_FIRST_ROW).map(([row, column]) => key(row, column));

/** Type layout of a trail section: row 5 battles; rows 6–8 from the bag with `shops` merchants. Null when no attempt passes the rules. */
function layTrails(random: Random, grid: Grid, shops: number): Map<string, ForestNodeType> | null {
  const cells = cellsOf(grid).map(([row, column]) => key(row, column)), free = trailFree(grid);
  for (let attempt = 0; attempt < LAYOUT_ATTEMPTS; attempt++) {
    const bag: ForestNodeType[] = Array<ForestNodeType>(shops).fill('shop');
    for (const [type, part] of Object.entries(TRAIL_SHARES) as [ForestNodeType, number][]) bag.push(...Array<ForestNodeType>(share(random, free.length, part)).fill(type));
    if (bag.length > free.length) continue;
    while (bag.length < free.length) bag.push('battle');
    shuffle(random, bag);
    const types = new Map<string, ForestNodeType>(cells.map(cell => [cell, 'battle']));
    free.forEach((cell, n) => types.set(cell, bag[n]));
    if (!sectionErrors(grid, types, cell => free.includes(cell), false)) return types;
  }
  return null;
}

/**
 * Type layout of a branch: battles, hard battles (`hardShare` of the cells, at least one), rests, `shops` merchants and
 * events (BRANCH_SHARES.event of the cells, on rows up to BRANCH_EVENT_LAST_ROW: those cells are drawn first, the bag
 * fills the rest). Null when no attempt passes the rules.
 */
function layBranch(random: Random, grid: Grid, shops: number, hardShare: number): Map<string, ForestNodeType> | null {
  const cells = cellsOf(grid).map(([row, column]) => key(row, column)), eventCells = cellsOf(grid).filter(([row]) => row <= BRANCH_EVENT_LAST_ROW).map(([row, column]) => key(row, column));
  for (let attempt = 0; attempt < LAYOUT_ATTEMPTS; attempt++) {
    const hard = Math.max(1, share(random, cells.length, hardShare)), rest = Math.max(1, share(random, cells.length, BRANCH_SHARES.rest));
    const events = Math.min(eventCells.length, share(random, cells.length, BRANCH_SHARES.event));
    if (hard + rest + shops + events > cells.length) continue;
    const eventAt = new Set(shuffle(random, [...eventCells]).slice(0, events)), others = cells.filter(cell => !eventAt.has(cell));
    const bag: ForestNodeType[] = [...Array<ForestNodeType>(hard).fill('hard'), ...Array<ForestNodeType>(rest).fill('rest'), ...Array<ForestNodeType>(shops).fill('shop')];
    while (bag.length < others.length) bag.push('battle');
    shuffle(random, bag);
    const types = new Map<string, ForestNodeType>([...eventAt].map(cell => [cell, 'event']));
    others.forEach((cell, n) => types.set(cell, bag[n]));
    if (!sectionErrors(grid, types, () => true, true)) return types;
  }
  return null;
}

/**
 * Lay out one section on its first walk, walking it again until its rules hold; every retry continues the same seeded
 * sequence.
 */
function section(first: Grid, walk: () => Grid, lay: (grid: Grid) => Map<string, ForestNodeType> | null, what: string, seed: number) {
  let grid = first;
  for (let attempt = 0; attempt < STRUCTURE_ATTEMPTS; attempt++) {
    if (attempt) grid = walk();
    const types = lay(grid);
    if (types) return { grid, types, attempts: attempt + 1 };
  }
  throw new Error(`Генератор карты: ${what} не раскладывается для seed ${seed}.`);
}

/** Statistics of the last generation (attempts per section), for the tests and the map report. */
export interface GenerationStats { trails: number; den: number; camp: number }

/**
 * Options of a run's map. `hardFactor`: factor of the branches' hard-battle share (the ladder's step 1, ladder.ts;
 * absent — 1, the map of step 0).
 */
export interface MapOptions { hardFactor?: number }

/** The map of a run seed (and options). The same seed and options always give the same map. */
export function generateForestMap(seed: number, stats?: GenerationStats, options: MapOptions = {}): GeneratedForestMap {
  const random = seeded(mixSeed(seed >>> 0, textHash('forest-map')));
  const hardShare = BRANCH_SHARES.hard * (options.hardFactor ?? 1);
  const walkTrails = () => walkPasses(random, TRAIL_FIRST_ROW, TRAIL_LAST_ROW, TRAIL_COLUMNS, TRAIL_PASSES);
  const walkBranch = () => walkPasses(random, BRANCH_FIRST_ROW, BRANCH_LAST_ROW, BRANCH_COLUMNS, BRANCH_PASSES);
  // The merchants are counted for the whole map (SHOP_SHARE of its free nodes, at least one) and spread over the
  // sections in proportion to their free nodes on the first walk; a section walked again keeps its count.
  const firstWalks = [walkTrails(), ...BRANCHES.map(() => walkBranch())];
  const free = [trailFree(firstWalks[0]).length, ...firstWalks.slice(1).map(grid => grid.next.size)], total = free.reduce((a, b) => a + b, 0);
  const shops = [0, 0, 0];
  for (let n = Math.max(SHOPS_PER_MAP_MIN, share(random, total, SHOP_SHARE)); n > 0; n--) {
    let at = random.int(total), part = 0;
    while (at >= free[part]) at -= free[part++];
    shops[part]++;
  }
  const trails = section(firstWalks[0], walkTrails, grid => layTrails(random, grid, shops[0]), 'тропы', seed);
  const branches = BRANCHES.map((branch, n) => ({ branch, ...section(firstWalks[n + 1], walkBranch,
    grid => layBranch(random, grid, shops[n + 1], hardShare), `ветка ${branch}`, seed) }));
  if (stats) { stats.trails = trails.attempts; stats.den = branches[0].attempts; stats.camp = branches[1].attempts; }
  const nodes: StoredMapNode[] = [];
  for (const [row, column] of cellsOf(trails.grid)) {
    nodes.push({ id: trailId(row, column), type: trails.types.get(key(row, column))!,
      next: row < TRAIL_LAST_ROW ? [...trails.grid.next.get(key(row, column))!].sort().map(next => trailId(row + 1, next)) : [CHECKPOINT_ID] });
  }
  const entries = branches.flatMap(({ branch, grid }) => cellsOf(grid).filter(([row]) => row === BRANCH_FIRST_ROW).map(([row, column]) => branchId(branch, row, column)));
  nodes.push({ id: CHECKPOINT_ID, type: 'checkpoint', next: entries });
  for (const { branch, grid, types } of branches) {
    for (const [row, column] of cellsOf(grid)) {
      nodes.push({ id: branchId(branch, row, column), type: types.get(key(row, column))!,
        next: row < BRANCH_LAST_ROW ? [...grid.next.get(key(row, column))!].sort().map(next => branchId(branch, row + 1, next)) : [branchId(branch, BREAKTHROUGH_ROW, 0)] });
    }
    nodes.push({ id: branchId(branch, BREAKTHROUGH_ROW, 0), type: 'breakthrough', next: [branchId(branch, BOSS_ROW, 0)] },
      { id: branchId(branch, BOSS_ROW, 0), type: 'boss', next: [] });
  }
  return { generator: MAP_GENERATOR_VERSION, nodes };
}
