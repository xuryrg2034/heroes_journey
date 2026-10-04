/**
 * Talismans and oaths (design agreed 04.10.2026, docs/talismans.md): permanent passive effects of a run. A talisman
 * changes the economy, the risk or the first move, never the battle mechanics; everything it changes in a turn is in
 * the forecast. An oath is a talisman with a price: +1 energy at the start of every battle for one system switched off.
 * Declarative data in one place; the battle effects read the run's talismans from `state.runNode.talismans`.
 */
import type { ForestState } from './forestTypes';

export type TalismanRarity = 'common' | 'uncommon' | 'rare' | 'oath';
export type TalismanId = 'whetstone' | 'dew-flask' | 'ragman-pouch' | 'tough-hide' | 'millstone-shard' | 'hourglass' | 'nimble-paws' | 'ash-ward'
  | 'oath-hunger' | 'oath-poverty' | 'oath-wrath';

export interface TalismanDefinition {
  id: TalismanId;
  name: string;
  rarity: TalismanRarity;
  /** One line: the effect, as shown on hover and in the choice. */
  effect: string;
  /** Not offered together with these (taken or offered in the same choice). */
  excludes?: readonly TalismanId[];
  /** Offered only when the run opened this ability. */
  requiresAbility?: 'jump' | 'spin';
}

export const TALISMANS: readonly TalismanDefinition[] = [
  { id: 'whetstone', name: 'Точильный камень', rarity: 'common', effect: 'Первая обычная цепь в каждом бою начинается с запасом силы 1' },
  { id: 'dew-flask', name: 'Фляга росы', rarity: 'common', effect: 'Отдых на привале лечит на 1 больше', excludes: ['oath-hunger'] },
  { id: 'ragman-pouch', name: 'Кисет старьёвщика', rarity: 'common', effect: 'Сундук даёт на 1 ресурс больше', excludes: ['oath-poverty'] },
  { id: 'tough-hide', name: 'Крепкая шкура', rarity: 'uncommon', effect: '+1 к максимуму HP (и +1 HP сразу)' },
  { id: 'millstone-shard', name: 'Осколок жернова', rarity: 'uncommon', effect: 'Кристалл падает за каждые 5 убийств цепью вместо 6' },
  { id: 'hourglass', name: 'Песочные часы', rarity: 'uncommon', effect: 'Подкрепление после целей приходит на 1 ход позже (через 4 хода, затем каждые 3)' },
  { id: 'nimble-paws', name: 'Ловкие лапы', rarity: 'rare', effect: 'Прыжок стоит 1 энергию вместо 2', requiresAbility: 'jump' },
  { id: 'ash-ward', name: 'Пепельный оберег', rarity: 'rare', effect: 'Один раз за поход: удар, который убил бы кота, оставляет его с 1 HP; оберег рассыпается' },
  { id: 'oath-hunger', name: 'Клятва голода', rarity: 'oath', effect: '+1 энергия в начале каждого боя; привал не лечит (крафт остаётся)', excludes: ['dew-flask'] },
  { id: 'oath-poverty', name: 'Клятва бедности', rarity: 'oath', effect: '+1 энергия в начале каждого боя; сундуки пусты', excludes: ['ragman-pouch'] },
  { id: 'oath-wrath', name: 'Клятва ярости', rarity: 'oath', effect: '+1 энергия в начале каждого боя; до целей злость 2 врага за ход вместо 1' },
];
const BY_ID = new Map(TALISMANS.map(talisman => [talisman.id, talisman]));
export const talisman = (id: TalismanId): TalismanDefinition => BY_ID.get(id)!;
export const isTalismanId = (value: unknown): value is TalismanId => typeof value === 'string' && BY_ID.has(value as TalismanId);
export const isOath = (id: TalismanId): boolean => talisman(id).rarity === 'oath';

/** Баланс: energy an oath adds at the start of every battle (up to the cap of 7). */
export const OATH_ENERGY = 1;

/** The run's talisman `id` is held in this battle. */
export function hasTalisman(state: Pick<ForestState, 'runNode'>, id: TalismanId): boolean {
  return !!state.runNode?.talismans?.includes(id);
}
/** Oaths held in this battle (each adds OATH_ENERGY at the start). */
export function oathCount(state: Pick<ForestState, 'runNode'>): number {
  return state.runNode?.talismans?.filter(isOath).length ?? 0;
}

/**
 * One-battle modifiers of the run (event catalogue, docs/events.md section 5): set by an event, they act on the next
 * map battle only and are dropped after it. They stack with the talismans that do the same.
 */
export type BattleModifier = 'first-chain-power' | 'wrath' | 'start-elite' | 'early-reinforcement';
export const BATTLE_MODIFIERS: Record<BattleModifier, string> = {
  'first-chain-power': 'Первая цепь начинается с запасом силы 1',
  wrath: 'До целей злятся 2 врага за ход',
  'start-elite': 'Бой начинается со случайной элитой',
  'early-reinforcement': 'Первое подкрепление после целей на 1 ход раньше',
};
export const isBattleModifier = (value: unknown): value is BattleModifier => typeof value === 'string' && Object.hasOwn(BATTLE_MODIFIERS, value);
const hasModifier = (state: Pick<ForestState, 'runNode'>, modifier: BattleModifier) => !!state.runNode?.modifiers?.includes(modifier);

/** Starting power of the first ordinary chain of the battle: Whetstone +1, the event modifier +1. */
export const firstChainPower = (state: Pick<ForestState, 'runNode'>): number =>
  (hasTalisman(state, 'whetstone') ? 1 : 0) + (hasModifier(state, 'first-chain-power') ? 1 : 0);
/** Extra calm enemies made angry per turn before the goals: the Oath of wrath +1, the event modifier +1. */
export const extraAngerBeforeGoals = (state: Pick<ForestState, 'runNode'>): number =>
  (hasTalisman(state, 'oath-wrath') ? 1 : 0) + (hasModifier(state, 'wrath') ? 1 : 0);
/** Shift of the first reinforcement after the goals: the Hourglass +1, the event modifier −1. */
export const reinforcementShift = (state: Pick<ForestState, 'runNode'>): number =>
  (hasTalisman(state, 'hourglass') ? 1 : 0) - (hasModifier(state, 'early-reinforcement') ? 1 : 0);
/** The battle starts with a random elite (the event modifier). */
export const startsWithElite = (state: Pick<ForestState, 'runNode'>): boolean => hasModifier(state, 'start-elite');
