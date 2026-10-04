/**
 * The start gift (design agreed 04.10.2026, docs/roguelike-runs.md, section 2а; after the Neow of Slay the Spire): a
 * screen before the choice of the row-5 nodes where every run starts with a real decision. Pure data and the roll; the
 * run model (forestRun.ts) keeps the gift, applies the choice and checks saves.
 *
 * - The full gift (the previous run reached the Jailer, or a run with an entered seed): four buttons in a fixed order,
 *   each rolled from a stream of its own (runStreams.ts: `gift-item`, `gift-supply`, `gift-deal`, `gift-gamble`) —
 *   a ladder of risk: a consumable, a small resource, a talisman for a price, a random oath.
 * - The mini gift (the first run, or the previous one did not reach the Jailer): two safe buttons — two random
 *   consumables or +1 to the maximum HP — rolled from the `gift-item` stream.
 * - A price never cancels a reward of the same currency (the rule of Neow): «−1 к максимуму HP» never comes with
 *   «+1 к максимуму HP» of button 2, nor with «Крепкая шкура» as the reward of the same deal.
 * - The gift cannot be refused; buttons 1–2 are always safe.
 */
import { mixSeed, ITEM_KINDS } from '../items';
import type { ItemKind, ResourceKind } from '../forestTypes';
import { RESOURCE_KINDS } from '../resources';
import { isTalismanId, type TalismanId } from '../talismans';
import { talismanDraw, type TalismanPool } from './talismanOffers';
import { streamValue, type RunStream } from './runStreams';

// Баланс (docs/roguelike-runs.md, 2а).
/** Button 1: «выбрать 1 из 3 расходников», «2 случайных расходника», «+2 энергии». */
export const GIFT_PICK_ITEMS = 3, GIFT_RANDOM_ITEMS = 2, GIFT_ENERGY = 2;
/** Button 2: «3 ресурса крафта», «+1 к максимуму HP», «в первых 2 боях злость до целей 0». */
export const GIFT_RESOURCES = 3, GIFT_MAX_HP = 1, GIFT_CALM_BATTLES = 2;
/** Button 3: «обычный талисман на выбор из 2»; the price «−1 HP сейчас» never takes the cat below 1; «−1 к максимуму HP». */
export const GIFT_TALISMAN_CHOICE = 2, GIFT_HP_PRICE = 1, GIFT_MAX_HP_PRICE = 1;
/** A run that entered this map row (the Jailer) or went further gives the next run the full gift. */
export const GIFT_FULL_ROW = 9;

export type GiftKind = 'full' | 'mini';
/** Price of the deal: −1 HP now (not below 1), −1 to the maximum HP, the next rest does not heal. */
export type GiftPrice = 'hp' | 'max-hp' | 'rest';
/** Reward of the deal: a common talisman of two (a choice), or a random uncommon one. */
export type GiftReward = { kind: 'pick-talisman'; talismans: TalismanId[] } | { kind: 'talisman'; talisman: TalismanId | null };
export type GiftOption =
  | { kind: 'pick-item'; items: ItemKind[] }
  | { kind: 'items'; items: ItemKind[] }
  | { kind: 'energy'; amount: number }
  | { kind: 'resources'; resources: ResourceKind[] }
  | { kind: 'max-hp'; amount: number }
  | { kind: 'calm'; battles: number }
  | { kind: 'deal'; reward: GiftReward; price: GiftPrice }
  | { kind: 'oath'; oath: TalismanId | null };
export type GiftOptionKind = GiftOption['kind'];

/**
 * The gift of a run. `options` are rolled when the run is created (the talisman pool is still empty then and the trunk
 * opens nothing, so nothing could change before the gift screen). `chosen`: the button taken; `pick`: the item or
 * talisman taken by a button with a choice of its own (absent while that choice is open).
 */
export interface RunGift { kind: GiftKind; options: GiftOption[]; chosen?: number; pick?: ItemKind | TalismanId }

/** The button opens a choice of its own: a consumable of three or a common talisman of two. */
export function giftNeedsPick(option: GiftOption): boolean {
  return option.kind === 'pick-item' || option.kind === 'deal' && option.reward.kind === 'pick-talisman';
}
/** What a button with a choice of its own offers. */
export function giftPicks(option: GiftOption): (ItemKind | TalismanId)[] {
  if (option.kind === 'pick-item') return [...option.items];
  return option.kind === 'deal' && option.reward.kind === 'pick-talisman' ? [...option.reward.talismans] : [];
}
/** The gift is taken: a button chosen, and its own choice made if it has one. */
export function giftDone(gift: RunGift | undefined): boolean {
  if (!gift || gift.chosen === undefined) return false;
  return !giftNeedsPick(gift.options[gift.chosen]) || gift.pick !== undefined;
}
/** The streams a gift of this kind draws from, one value each (runStreams.ts). */
export const GIFT_STREAMS: Readonly<Record<GiftKind, readonly RunStream[]>> = {
  full: ['gift-item', 'gift-supply', 'gift-deal', 'gift-gamble'],
  mini: ['gift-item'],
};

const VARIANT_SALT = 0x51c3_9a07, ITEM_SALT = 0x2d4b_8e61, PRICE_SALT = 0x7f19_c2b3, REWARD_SALT = 0x0e6a_45d9, KIND_SALT = 0x6b2e_93f1;
/** `count` consumables drawn with repeats (two random ones may be of a kind). */
const randomItems = (base: number, count: number): ItemKind[] =>
  Array.from({ length: count }, (_, n) => ITEM_KINDS[mixSeed(mixSeed(base, ITEM_SALT), n) % ITEM_KINDS.length]);
/** `count` different consumables (a choice of three of the four). */
function distinctItems(base: number, count: number): ItemKind[] {
  const left = [...ITEM_KINDS], items: ItemKind[] = [];
  for (let n = 0; n < count && left.length; n++) items.push(left.splice(mixSeed(mixSeed(base, ITEM_SALT), n) % left.length, 1)[0]);
  return items;
}

/**
 * The gift a run of `runSeed` gets: the first value of each of its streams (a run rolls its gift once, when it is created).
 * `pool`: the talisman pool at that moment (nothing taken, no abilities: «Ловкие лапы» need the jump, which row 7 opens).
 */
export function rollGift(runSeed: number, kind: GiftKind, pool: TalismanPool): RunGift {
  const draw = (stream: RunStream) => streamValue(runSeed, stream, 0);
  if (kind === 'mini') return { kind, options: [{ kind: 'items', items: randomItems(draw('gift-item'), GIFT_RANDOM_ITEMS) }, { kind: 'max-hp', amount: GIFT_MAX_HP }] };
  const item = draw('gift-item'), supply = draw('gift-supply'), deal = draw('gift-deal'), gamble = draw('gift-gamble');
  const first: GiftOption = [
    { kind: 'pick-item', items: distinctItems(item, GIFT_PICK_ITEMS) },
    { kind: 'items', items: randomItems(item, GIFT_RANDOM_ITEMS) },
    { kind: 'energy', amount: GIFT_ENERGY },
  ][mixSeed(item, VARIANT_SALT) % 3] as GiftOption;
  const second: GiftOption = [
    { kind: 'resources', resources: Array.from({ length: GIFT_RESOURCES }, (_, n) => RESOURCE_KINDS[mixSeed(mixSeed(supply, KIND_SALT), n) % RESOURCE_KINDS.length]) },
    { kind: 'max-hp', amount: GIFT_MAX_HP },
    { kind: 'calm', battles: GIFT_CALM_BATTLES },
  ][mixSeed(supply, VARIANT_SALT) % 3] as GiftOption;
  // The price never cancels a reward of the same currency: no −1 maximum HP beside +1 maximum HP of button 2.
  const prices: GiftPrice[] = (['hp', 'max-hp', 'rest'] as const).filter(price => !(price === 'max-hp' && second.kind === 'max-hp'));
  const price = prices[mixSeed(deal, PRICE_SALT) % prices.length];
  // …nor «Крепкая шкура» (+1 maximum HP) as the reward of a deal that costs a point of the maximum.
  const exclude: TalismanId[] = price === 'max-hp' ? ['tough-hide'] : [];
  const reward: GiftReward = mixSeed(deal, REWARD_SALT) % 2 === 0
    ? { kind: 'pick-talisman', talismans: talismanDraw(deal, 'common', GIFT_TALISMAN_CHOICE, pool, exclude) }
    : { kind: 'talisman', talisman: talismanDraw(deal, 'uncommon', 1, pool, exclude)[0] ?? null };
  const oath = talismanDraw(gamble, 'oath', 1, pool)[0] ?? null;
  return { kind, options: [first, second, { kind: 'deal', reward, price }, { kind: 'oath', oath }] };
}

/** A gift record of a save, the same as the roll (the options are compared whole), with a valid choice. Null if not. */
export function parseGift(value: unknown, rolled: RunGift): RunGift | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['kind', 'options', 'chosen', 'pick'].includes(key))) return null;
  if (record.kind !== rolled.kind || JSON.stringify(record.options) !== JSON.stringify(rolled.options)) return null;
  const gift: RunGift = structuredClone(rolled);
  if (record.chosen !== undefined) {
    if (typeof record.chosen !== 'number' || !Number.isInteger(record.chosen) || record.chosen < 0 || record.chosen >= rolled.options.length) return null;
    gift.chosen = record.chosen;
  }
  if (record.pick !== undefined) {
    if (gift.chosen === undefined || !giftPicks(gift.options[gift.chosen]).includes(record.pick as ItemKind | TalismanId)) return null;
    gift.pick = record.pick as ItemKind | TalismanId;
  }
  // A button without a choice of its own leaves nothing to pick; a deal without a talisman to give cannot be taken.
  if (gift.chosen !== undefined && !giftNeedsPick(gift.options[gift.chosen]) && gift.pick !== undefined) return null;
  return gift;
}

/** What the taken gift changes in the run, for the save check: items gained, resources, maximum HP, talismans. */
export function giftEffects(gift: RunGift | undefined) {
  const none = { items: [] as ItemKind[], resources: [] as ResourceKind[], maxHp: 0, talismans: [] as TalismanId[], gone: [] as TalismanId[], rest: false, calm: 0 };
  if (!gift || !giftDone(gift)) return none;
  const option = gift.options[gift.chosen!], pick = gift.pick;
  switch (option.kind) {
    case 'pick-item': return { ...none, items: [pick as ItemKind] };
    case 'items': return { ...none, items: [...option.items] };
    case 'energy': return none;
    case 'resources': return { ...none, resources: [...option.resources] };
    case 'max-hp': return { ...none, maxHp: option.amount };
    case 'calm': return { ...none, calm: option.battles };
    case 'oath': return { ...none, talismans: option.oath ? [option.oath] : [] };
    case 'deal': {
      const taken = option.reward.kind === 'pick-talisman' ? [pick as TalismanId] : option.reward.talisman ? [option.reward.talisman] : [];
      const gone = option.reward.kind === 'pick-talisman' ? option.reward.talismans.filter(id => id !== pick) : [];
      return { ...none, talismans: taken.filter(isTalismanId), gone, maxHp: option.price === 'max-hp' ? -GIFT_MAX_HP_PRICE : 0, rest: option.price === 'rest' };
    }
  }
}
