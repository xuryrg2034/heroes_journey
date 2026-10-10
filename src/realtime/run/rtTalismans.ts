/**
 * Talismans of the real-time run (stage 2 of the transition, step 3; docs/realtime-slice.md, section 8). The talismans of
 * the turn-based game (src/game/talismans.ts) carried over «by number» where real time has their rule, plus «Якорь у
 * героя» (decision 3 of the transition: the hero anchor of the prototype as a rare talisman). Where a turn-based talisman
 * has no analogue in real time it is not offered at all (`RT_TALISMANS_OFF`): nothing is invented — a question to design.
 *
 * Offers follow the turn-based rules (talismanOffers.ts, merchant.ts): a hard battle offers three by the rarity roll
 * 50/33/17%, an empty rarity gives way to the next one (nothing left — fewer options, no «пустышка»); the Jailer's row offers
 * oaths; the merchant one talisman by the rarity roll; events and the gift draw common or uncommon ones through the
 * turn-based functions with the pool limited to the slice (`turnPool`). «Якорь у героя» is rare, so it comes only from a
 * hard-battle offer or the merchant: those two run here over the slice's list (same algorithm, own salts).
 */
import { mixSeed } from '../../game/items';
import { rarityOfRoll, type TalismanPool } from '../../game/run/talismanOffers';
import { isTalismanId, TALISMANS, type TalismanId, type TalismanRarity } from '../../game/talismans';
import { rtHp } from './hpScale';

/** A talisman of the real-time run: one of the turn-based ids in the slice, or «Якорь у героя». */
export type RtTalismanId = string;
/**
 * Rarity of a real-time talisman: the turn-based ones and (phase B, Т3) `relic` — a relic with a price, offered with the
 * oaths by the Jailer's row; not an oath (`isRtOath`: no +2 energy at the start of an arena).
 */
export type RtRarity = TalismanRarity | 'relic';
export interface RtTalismanDef { id: RtTalismanId; name: string; rarity: RtRarity; effect: string; excludes?: readonly string[] }
/**
 * Phase B ids (docs/realtime-phase-b.md; sim/buildIds.ts — one place for the simulation and the run): counter talismans
 * (Т1), hammers (Т2, `Loadout.hammer`), relics (Т3, rarity `relic`). Their definitions and offers come with track Д4.
 */
export { COUNTER_TALISMANS, HAMMERS, HAMMER_IDS, OATH_HUNGER, RELICS, RELIC_IDS, isHammerId, type CounterTalismanId, type HammerId, type RelicId } from '../sim/buildIds';

/** Баланс: the turn-based HP numbers of the talismans (DEW_FLASK_HEAL, TOUGH_HIDE_HP: +1) in real-time HP. */
export const RT_TOUGH_HIDE_HP = rtHp(1);
export const RT_DEW_FLASK_HEAL = rtHp(1);
/** Баланс: energy an oath adds at the start of every arena (OATH_ENERGY of the turn-based game, section 6: «клятвы: +2»). */
export const RT_OATH_ENERGY = 2;

/** A turn-based talisman as a slice definition: its id, name, rarity and exclusions; the effect text is the slice's. */
const turn = (id: TalismanId, effect: string): RtTalismanDef => {
  const entry = TALISMANS.find(other => other.id === id)!;
  return { id, name: entry.name, rarity: entry.rarity, effect, ...entry.excludes ? { excludes: entry.excludes } : {} };
};
/** Texts in real-time numbers; rarity and exclusions — the turn-based ones. */
export const RT_TALISMANS: readonly RtTalismanDef[] = [
  turn('whetstone', 'Первая цепь каждой арены начинается с силой 1'),
  turn('dew-flask', `Лечение на привале на ${RT_DEW_FLASK_HEAL} HP больше`),
  turn('tough-hide', `+${RT_TOUGH_HIDE_HP} к максимуму HP (и +${RT_TOUGH_HIDE_HP} HP сразу)`),
  turn('millstone-shard', 'Кристалл падает за каждые 5 убийств цепью вместо 6'),
  turn('hourglass', 'Фазы после целей начинаются на 10 с позже'),
  turn('nimble-paws', 'Прыжок стоит 1 энергию вместо 2'),
  turn('ash-ward', 'Один раз за поход: удар, который убил бы героя, оставляет его с 1 HP; оберег рассыпается'),
  { id: 'hero-anchor', name: 'Якорь у героя', rarity: 'rare', effect: 'Следующее звено берётся и в радиусе R от героя (обойти щит им нельзя)' },
  turn('oath-hunger', `+${RT_OATH_ENERGY} энергии в начале каждой арены; привал не лечит (крафт остаётся)`),
];
/**
 * Turn-based talismans without an analogue in real time (not offered; questions to design): «Кисет старьёвщика» and the
 * price of «Клятва бедности» are about chests, the price of «Клятва ярости» about the anger of enemies before the goals —
 * the slice has neither.
 */
export const RT_TALISMANS_OFF: readonly { id: TalismanId; reason: string }[] = [
  { id: 'ragman-pouch', reason: 'сундуков в реальном времени нет' },
  { id: 'oath-poverty', reason: 'цена «сундуки пусты» — сундуков нет' },
  { id: 'oath-wrath', reason: 'цена «злится на 1 врага больше» — злости нет' },
];
/** The turn-based ids in the slice (the `open` list of the pool the turn-based draws read). */
export const RT_TURN_TALISMANS: readonly TalismanId[] = RT_TALISMANS.map(entry => entry.id).filter(isTalismanId);

const BY_ID = new Map(RT_TALISMANS.map(entry => [entry.id, entry]));
export const rtTalisman = (id: RtTalismanId): RtTalismanDef | undefined => BY_ID.get(id);
export const isRtTalisman = (value: unknown): value is RtTalismanId => typeof value === 'string' && BY_ID.has(value);
export const isRtOath = (id: RtTalismanId): boolean => rtTalisman(id)?.rarity === 'oath';
/** An offer option: a talisman (design answer 10 to step 3: no «пустышка» in the slice — an empty pool offers nothing). */
export type RtTalismanOption = RtTalismanId;

/** What the run took and what left the pool (shown and refused). */
export interface RtTalismanPool { taken: readonly RtTalismanId[]; gone: readonly RtTalismanId[] }
/**
 * The pool for the turn-based draws (the gift, events, the reward battle): the turn-based ids only, both abilities open
 * (the jump and the spin are open from the start of a real-time run), only the slice's talismans `open`.
 */
export function turnPool(pool: RtTalismanPool): TalismanPool {
  return { taken: pool.taken.filter(isTalismanId), gone: pool.gone.filter(isTalismanId), abilities: ['jump', 'spin'], open: RT_TURN_TALISMANS };
}

const clash = (a: RtTalismanId, b: RtTalismanId) => !!rtTalisman(a)?.excludes?.includes(b) || !!rtTalisman(b)?.excludes?.includes(a);
/** `id` may be offered now: not taken, not gone, not in this offer, no clash with a taken one or another option. */
export function rtTalismanEligible(id: RtTalismanId, pool: RtTalismanPool, offered: readonly RtTalismanOption[] = []): boolean {
  if (pool.taken.includes(id) || pool.gone.includes(id) || offered.includes(id)) return false;
  const others = [...pool.taken, ...offered];
  return !others.some(other => clash(id, other));
}

const RARITIES = ['common', 'uncommon', 'rare'] as const;
const OFFER_SALT = 0x51ab_7c03, RARITY_SALT = 0x2c9e_4f11, PICK_SALT = 0x6e07_d2a9, SHOP_SALT = 0x3f5b_91c7;
const unit = (value: number) => value / 0x100000000;
const eligibleOf = (rarity: TalismanRarity, pool: RtTalismanPool, offered: readonly RtTalismanOption[]) =>
  RT_TALISMANS.filter(entry => entry.rarity === rarity && rtTalismanEligible(entry.id, pool, offered)).map(entry => entry.id);

/**
 * The talisman offer of a won hard battle (`hard`) or of the Jailer's row (`oath`) — talismanOffer of the turn-based run
 * over the slice's list: up to three different options; a talisman option rolls its rarity, an empty rarity gives way to
 * the next one, all empty — no option (design answer 10: no «пустышка»; only the refusal stays); an oath offer draws among
 * the oaths. `base` is one draw of the run's `talismans` stream.
 */
export function rtTalismanOffer(base: number, source: 'hard' | 'oath', pool: RtTalismanPool): RtTalismanOption[] {
  const seed = mixSeed(base >>> 0, OFFER_SALT), options: RtTalismanOption[] = [];
  for (let slot = 0; slot < 3; slot++) {
    let candidates: RtTalismanId[] = [];
    if (source === 'oath') candidates = eligibleOf('oath', pool, options);
    else {
      const rolled = RARITIES.indexOf(rarityOfRoll(unit(mixSeed(mixSeed(seed, slot), RARITY_SALT))));
      for (let step = 0; step < RARITIES.length && !candidates.length; step++) candidates = eligibleOf(RARITIES[(rolled + step) % RARITIES.length], pool, options);
    }
    if (candidates.length) options.push(candidates[mixSeed(mixSeed(seed, slot), PICK_SALT) % candidates.length]);
  }
  return options;
}

/** The merchant's talisman (merchant.ts): the rarity roll, an empty rarity gives way to the next one, all empty — none. */
export function rtShopTalisman(base: number, pool: RtTalismanPool): RtTalismanId | null {
  const seed = mixSeed(base >>> 0, SHOP_SALT), rolled = RARITIES.indexOf(rarityOfRoll(unit(mixSeed(seed, RARITY_SALT))) as typeof RARITIES[number]);
  for (let step = 0; step < RARITIES.length; step++) {
    const candidates = eligibleOf(RARITIES[(rolled + step) % RARITIES.length], pool, []);
    if (candidates.length) return candidates[mixSeed(seed, PICK_SALT) % candidates.length];
  }
  return null;
}
