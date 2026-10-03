/**
 * Battle pools of the generated forest map (docs/roguelike-runs.md, section 4; docs/biomes/forest-map.md, «Пулы боёв»).
 * Metadata of every pooled battle is kept here by battle id, not in the layout files battles/*.ts: a battle gets its row
 * band, node type, branch, required tools, main enemy and the field feature shown on the map. A node of the generated
 * map takes its battle from the pool of its row, type and branch on entering (forestRun.ts); the trunk is fixed and is
 * not pooled. Pure data and selection rules: no engine, no run state.
 */
import type { AbilityKind, ItemKind } from '../forestTypes';
import type { ForestLane, ForestNodeType } from './forestMap';
import { FOREST_BATTLE_GROUPS, FOREST_NODE_BATTLES, forestBattle } from './forestBattles';

/** Node types that play a battle. */
export type PoolBattleType = Extract<ForestNodeType, 'battle' | 'hard' | 'checkpoint' | 'breakthrough' | 'boss'>;
/** Branch of a battle: the trails (beasts, goblins, shared by both) and the second-half branches (den, camp). */
export type PoolBranch = Extract<ForestLane, 'beasts' | 'goblins' | 'shared' | 'den' | 'camp'>;
/** The enemy a battle is remembered by; the pick avoids the same main enemy twice in a row where it can. */
export type MainEnemy = 'wolf' | 'boar' | 'porcupine' | 'archer' | 'sentinel' | 'shaman' | 'goblin' | 'jailer' | 'troll' | 'chief';
export type RunTool = AbilityKind | ItemKind;

export interface BattlePoolEntry {
  /** First and last map row the battle may stand on (inclusive). */
  rows: readonly [number, number];
  type: PoolBattleType;
  branch: PoolBranch;
  /** Tools the battle's intended solution needs; it is placed only where the run has opened them. */
  requires: readonly RunTool[];
  main: MainEnemy;
  /** Field feature shown on the map once the battle of a node is known. */
  feature?: string;
  /** A stand-in battle: what replaces it once the enemies exist (shown as «временно» on the map). */
  placeholder?: string;
}

export const MAIN_ENEMY_NAMES: Record<MainEnemy, string> = {
  wolf: 'волк', boar: 'кабан', porcupine: 'дикобраз', archer: 'лучник', sentinel: 'щитоносец', shaman: 'шаман',
  goblin: 'гоблины', jailer: 'Тюремщик', troll: 'Тролль', chief: 'Главарь',
};

/**
 * Pool metadata by battle id. Requirements come from the authored graph's grants and the battle specs: a route that
 * needs a jump or a spin requires it. Every registry battle outside the trunk must be listed (validateBattlePools).
 */
export const BATTLE_POOLS: Readonly<Record<string, BattlePoolEntry>> = {
  // Trails, rows 5–8.
  'wolf-ford': { rows: [5, 8], type: 'battle', branch: 'beasts', requires: [], main: 'wolf', feature: 'Стая волков' },
  'boar-garden': { rows: [5, 8], type: 'battle', branch: 'beasts', requires: [], main: 'boar', feature: 'Кабан и шипы по краю' },
  // The spec route is chains only: the jump the authored row 7 opens is not needed.
  'porcupine-thicket': { rows: [5, 8], type: 'battle', branch: 'beasts', requires: [], main: 'porcupine', feature: 'Дикобразы' },
  'goblin-archer-watch': { rows: [5, 8], type: 'battle', branch: 'goblins', requires: [], main: 'archer', feature: 'Лучник' },
  'goblin-shield-flank': { rows: [5, 8], type: 'battle', branch: 'goblins', requires: [], main: 'sentinel', feature: 'Щитоносец' },
  // The last target is taken by a jump into the niche (docs/levels/forest-nodes-goblins.md).
  'goblin-shaman-rite': { rows: [7, 8], type: 'battle', branch: 'goblins', requires: ['jump'], main: 'shaman', feature: 'Шаман' },
  'three-banners': { rows: [8, 8], type: 'battle', branch: 'shared', requires: [], main: 'goblin', feature: 'Кристалл в проломе' },
  // The checkpoint, row 9.
  'jailer-gate': { rows: [9, 9], type: 'checkpoint', branch: 'shared', requires: [], main: 'jailer', feature: 'Тюремщик за щитом' },
  // Branches, rows 10–12.
  'den-watch': { rows: [10, 12], type: 'battle', branch: 'den', requires: ['jump', 'spin'], main: 'wolf', feature: 'Волки, дикобраз, лучник' },
  'camp-cauldron-ring': { rows: [10, 12], type: 'battle', branch: 'camp', requires: ['jump', 'spin'], main: 'shaman', feature: 'Гоблины у котла' },
  'den-nest': { rows: [10, 12], type: 'hard', branch: 'den', requires: [], main: 'wolf', feature: 'Кабан, стая, шипы', placeholder: 'Медведь или Зверовод, когда появятся' },
  'camp-shield-wall': { rows: [10, 12], type: 'hard', branch: 'camp', requires: [], main: 'sentinel', feature: 'Щитоносцы, лучник, шаман' },
  // Breakthroughs, row 13, and bosses, row 14.
  'den-breakout': { rows: [13, 13], type: 'breakthrough', branch: 'den', requires: [], main: 'wolf', feature: 'Цель — выход' },
  'camp-gate-run': { rows: [13, 13], type: 'breakthrough', branch: 'camp', requires: [], main: 'sentinel', feature: 'Цель — выход' },
  'troll-lair': { rows: [14, 14], type: 'boss', branch: 'den', requires: [], main: 'troll', feature: 'Тролль, стая и жаровня' },
  'chief-breakfast': { rows: [14, 14], type: 'boss', branch: 'camp', requires: [], main: 'chief', feature: 'Главарь и котелок' },
};

export function battlePoolEntry(id: string): BattlePoolEntry | undefined {
  return Object.prototype.hasOwnProperty.call(BATTLE_POOLS, id) ? BATTLE_POOLS[id] : undefined;
}

/**
 * Rows from which the run has opened each tool on every path of the generated map: every node of row 5 opens frost,
 * every node of row 7 the jump, the checkpoint victory (row 9) the spin. The authored graph gives the same rows.
 */
export const TOOL_ROWS: Readonly<Record<'frost' | 'jump' | 'spin', number>> = { frost: 5, jump: 7, spin: 10 };
/** Tools guaranteed on entering a node of map row `row` (finds are a choice and never guaranteed). */
export function rowTools(row: number): { items: ItemKind[]; abilities: AbilityKind[] } {
  return { items: row >= TOOL_ROWS.frost ? ['frost'] : [],
    abilities: [...row >= TOOL_ROWS.jump ? ['jump' as const] : [], ...row >= TOOL_ROWS.spin ? ['spin' as const] : []] };
}
const hasTool = (tools: { items: readonly ItemKind[]; abilities: readonly AbilityKind[] }, tool: RunTool) =>
  (tools.items as readonly string[]).includes(tool) || (tools.abilities as readonly string[]).includes(tool);

/** Row bands of the generated map by node type and branch: where a pooled battle may stand. */
export const POOL_BANDS: Readonly<Record<PoolBattleType, { rows: readonly [number, number]; branches: readonly PoolBranch[] }>> = {
  battle: { rows: [5, 12], branches: ['beasts', 'goblins', 'shared', 'den', 'camp'] },
  hard: { rows: [10, 12], branches: ['den', 'camp'] },
  checkpoint: { rows: [9, 9], branches: ['shared'] },
  breakthrough: { rows: [13, 13], branches: ['den', 'camp'] },
  boss: { rows: [14, 14], branches: ['den', 'camp'] },
};
/** Trail rows (first half) and branch rows (second half) of ordinary battles. */
export const TRAIL_BAND: readonly [number, number] = [5, 8];
export const BRANCH_BAND: readonly [number, number] = [10, 12];
const TRAIL_BRANCHES: readonly PoolBranch[] = ['beasts', 'goblins', 'shared'];

/** A node of the generated map asking for a battle: its row, type and lane (the trail column or the branch). */
export interface PoolSlot { row: number; type: PoolBattleType; lane: ForestLane }

/**
 * Branches a node's lane accepts: the beast column takes beast battles, the goblin column goblin battles, the middle
 * trail column («shared») any trail battle; the checkpoint takes shared ones; a branch takes its own.
 */
export function laneBranches(slot: PoolSlot): readonly PoolBranch[] {
  if (slot.lane === 'shared') return slot.type === 'battle' ? TRAIL_BRANCHES : ['shared'];
  return slot.lane === 'trunk' ? [] : [slot.lane];
}

/** Ids of the pooled battles a slot may play with the tools open there, in registry order. */
export function poolCandidates(slot: PoolSlot, tools: { items: readonly ItemKind[]; abilities: readonly AbilityKind[] } = rowTools(slot.row)): string[] {
  const branches = laneBranches(slot);
  return Object.keys(FOREST_NODE_BATTLES).filter(id => {
    const entry = battlePoolEntry(id);
    return !!entry && entry.type === slot.type && branches.includes(entry.branch) && slot.row >= entry.rows[0] && slot.row <= entry.rows[1]
      && entry.requires.every(tool => hasTool(tools, tool));
  });
}

/**
 * Pick the battle of a slot (decision of 04.10.2026, docs/roguelike-runs.md, section 4):
 * - the window: a battle unused in this run while the pool has one; otherwise one that is not among the two previous
 *   battles of the run; with a smaller pool, not the previous one; with a single battle, that one;
 * - soft: by possibility not the same main enemy as the previous battle;
 * - `roll` (an unsigned 32-bit number from the run's battle stream) chooses among the rest.
 * `history`: battle ids of the run so far, in entering order. Null for an empty pool.
 */
export function pickPoolBattle(candidates: readonly string[], history: readonly string[], roll: number): string | null {
  if (!candidates.length) return null;
  const recent = (count: number) => history.slice(Math.max(0, history.length - count));
  const tiers = [candidates.filter(id => !history.includes(id)), candidates.filter(id => !recent(2).includes(id)),
    candidates.filter(id => !recent(1).includes(id)), [...candidates]];
  const tier = tiers.find(list => list.length)!;
  const last = history.length ? battlePoolEntry(history[history.length - 1])?.main : undefined;
  const fresh = tier.filter(id => battlePoolEntry(id)?.main !== last);
  const choice = fresh.length ? fresh : tier;
  return choice[(roll >>> 0) % choice.length];
}

/** Slots the generated map can create: every one must have a battle (validateBattlePools). */
export function generatedPoolSlots(): PoolSlot[] {
  const slots: PoolSlot[] = [];
  for (let row = TRAIL_BAND[0]; row <= TRAIL_BAND[1]; row++) for (const lane of ['beasts', 'shared', 'goblins'] as const) slots.push({ row, type: 'battle', lane });
  slots.push({ row: 9, type: 'checkpoint', lane: 'shared' });
  for (const lane of ['den', 'camp'] as const) {
    for (let row = BRANCH_BAND[0]; row <= BRANCH_BAND[1]; row++) slots.push({ row, type: 'battle', lane }, { row, type: 'hard', lane });
    slots.push({ row: 13, type: 'breakthrough', lane }, { row: 14, type: 'boss', lane });
  }
  return slots;
}

const TOOL_NAMES: Record<RunTool, string> = { frost: 'холод', bomb: 'бомба', healing: 'лечение', fire: 'огонь', jump: 'прыжок', spin: 'круговой удар' };

/**
 * Checks of the pool metadata against the registry; an empty list means valid. A registry battle outside the trunk
 * without metadata is an error that names its file: a new battle never silently drops out of the pools.
 */
export function validateBattlePools(pools: Readonly<Record<string, BattlePoolEntry>> = BATTLE_POOLS): string[] {
  const errors: string[] = [];
  const trunk = new Set((FOREST_BATTLE_GROUPS.trunk ?? []).map(battle => battle.id));
  for (const [group, battles] of Object.entries(FOREST_BATTLE_GROUPS)) {
    if (group === 'trunk') continue;
    for (const battle of battles) {
      if (!Object.prototype.hasOwnProperty.call(pools, battle.id)) errors.push(`Бой «${battle.id}» (src/game/run/battles/${group}.ts) не описан в пулах: добавь в BATTLE_POOLS (src/game/run/battlePools.ts) полосу рядов, тип, ветку, требуемые инструменты и главного врага.`);
    }
  }
  for (const [id, entry] of Object.entries(pools)) {
    const at = `Пул «${id}»`;
    if (!forestBattle(id)) { errors.push(`${at}: такого боя нет в реестре (src/game/run/battles/*.ts).`); continue; }
    if (trunk.has(id)) { errors.push(`${at}: бой ствола не входит в пулы — ствол фиксированный.`); continue; }
    const band = POOL_BANDS[entry.type];
    if (!band) { errors.push(`${at}: неизвестный тип ${entry.type}.`); continue; }
    const [from, to] = entry.rows;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) errors.push(`${at}: полоса рядов ${from}–${to} задана неверно.`);
    else {
      const trail = TRAIL_BRANCHES.includes(entry.branch), allowed: readonly [number, number] = entry.type !== 'battle' ? band.rows : trail ? TRAIL_BAND : BRANCH_BAND;
      if (from < allowed[0] || to > allowed[1]) errors.push(`${at}: тип ${entry.type} ветки ${entry.branch} стоит только на рядах ${allowed[0]}–${allowed[1]}, а задано ${from}–${to}.`);
    }
    if (!band.branches.includes(entry.branch)) errors.push(`${at}: тип ${entry.type} не бывает в ветке ${entry.branch}.`);
    for (const tool of entry.requires) {
      if (!(tool in TOOL_NAMES)) errors.push(`${at}: неизвестный инструмент ${tool}.`);
      else if (!hasTool(rowTools(from), tool)) errors.push(`${at}: требует «${TOOL_NAMES[tool]}», а на ряду ${from} он ещё не открыт (холод — с ряда ${TOOL_ROWS.frost}, прыжок — с ${TOOL_ROWS.jump}, круговой удар — с ${TOOL_ROWS.spin}).`);
    }
    if (!(entry.main in MAIN_ENEMY_NAMES)) errors.push(`${at}: неизвестный главный враг ${entry.main}.`);
  }
  if (pools === BATTLE_POOLS) {
    for (const slot of generatedPoolSlots()) {
      if (!poolCandidates(slot).length) errors.push(`Пусто: для ряда ${slot.row}, типа ${slot.type}, полосы ${slot.lane} нет ни одного боя.`);
    }
  }
  return errors;
}
