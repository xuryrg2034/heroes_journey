/**
 * The talisman catalogue of the forest run layer (design agreed 04.10.2026, docs/talismans.md): ids, names, rarities and
 * exclusions. Moved from the removed turn-based game (src/game/talismans.ts, tag `turn-based-final`) as data: the start
 * gift's roll (runGift.ts) and the merchant's stock (merchant.ts) draw over this list, and a save keeps the gift's roll,
 * so its order, rarities and exclusions must stay as they are. The real-time run names, offers and plays its own talismans
 * (src/realtime/run/rtTalismans.ts), built on these entries.
 */

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
  { id: 'oath-hunger', name: 'Клятва голода', rarity: 'oath', effect: '+2 энергии в начале каждого боя; привал не лечит (крафт остаётся)', excludes: ['dew-flask'] },
  { id: 'oath-poverty', name: 'Клятва бедности', rarity: 'oath', effect: '+2 энергии в начале каждого боя; сундуки пусты', excludes: ['ragman-pouch'] },
  { id: 'oath-wrath', name: 'Клятва ярости', rarity: 'oath', effect: '+2 энергии в начале каждого боя; до целей злится на 1 врага за ход больше' },
];
const BY_ID = new Map(TALISMANS.map(talisman => [talisman.id, talisman]));
export const talisman = (id: TalismanId): TalismanDefinition => BY_ID.get(id)!;
export const isTalismanId = (value: unknown): value is TalismanId => typeof value === 'string' && BY_ID.has(value as TalismanId);
export const isOath = (id: TalismanId): boolean => talisman(id).rarity === 'oath';

/**
 * One-battle modifiers named by the event catalogue (docs/events.md, section 5) and the start gift (`calm`). The real-time
 * run maps the event ones to its own arena modifiers (rtRun.ts, `RtModifier`) and turns the gift's `calm` off; the texts
 * are the catalogue's (forestEvents.ts, describeOutcome).
 */
export type BattleModifier = 'first-chain-power' | 'wrath' | 'start-elite' | 'early-reinforcement' | 'calm';
export const BATTLE_MODIFIERS: Record<BattleModifier, string> = {
  'first-chain-power': 'Первая цепь начинается с запасом силы 1',
  wrath: 'До целей злится на 1 врага за ход больше',
  'start-elite': 'Бой начинается со случайной элитой',
  'early-reinforcement': 'Первое подкрепление после целей на 1 ход раньше',
  calm: 'До целей враги не злятся',
};
