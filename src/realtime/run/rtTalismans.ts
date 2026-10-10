/**
 * Talismans of the real-time run (stage 2 of the transition, step 3; docs/realtime-slice.md, section 8). The talismans of
 * the turn-based game (src/game/talismans.ts) carried over «by number» where real time has their rule, plus «Якорь у
 * героя» (decision 3 of the transition: the hero anchor of the prototype as a rare talisman). Where a turn-based talisman
 * has no analogue in real time it is not offered at all (`RT_TALISMANS_OFF`): nothing is invented — a question to design.
 *
 * Offers follow the turn-based rules (talismanOffers.ts, merchant.ts): a hard battle offers three by the rarity roll
 * 50/33/17%, an empty rarity gives way to the next one (nothing left — fewer options, no «пустышка»); the merchant one
 * talisman by the rarity roll. All of them run here over the slice's list (same algorithm, own salts).
 *
 * Phase B (docs/realtime-phase-b.md, sections 3–5 and 8, track Д4): the catalogue holds the counter talismans (Т1) and the
 * relics (Т3, rarity `relic`); the hammers (Т2) are a catalogue of their own. Sources (design answers 1–5): one place of a
 * hard-battle offer is always rare; the Jailer's row offers a hammer 3 of 4 (`rtHammerOffer`, by the node's roll) and then
 * an oath or a relic 1 of 3; the gift and events draw by their own real-time draws (`rtTalismanDraw`) whose chain stops at
 * the uncommon ones — rare talismans come only from a hard battle and the merchant. One value of the run's stream per
 * source, as before: the streams do not move.
 */
import { mixSeed } from '../../game/items';
import { COUNTER_TALISMANS as CT, HAMMER_IDS as HAMMER_LIST, RELICS as RL, type HammerId as Hammer } from '../sim/buildIds';
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
/** `effect` — the rule (a relic: its plus); `price` — the price of a relic, shown as plainly as the plus (section 5). */
export interface RtTalismanDef { id: RtTalismanId; name: string; rarity: RtRarity; effect: string; price?: string; excludes?: readonly string[] }
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
/** Texts in real-time numbers; rarity and exclusions — the turn-based ones. The talismans of the slice before phase B. */
const RT_SLICE_TALISMANS: readonly RtTalismanDef[] = [
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
export const RT_TURN_TALISMANS: readonly TalismanId[] = RT_SLICE_TALISMANS.map(entry => entry.id).filter(isTalismanId);

/** Т1. Counter talismans (section 3): a condition and a trigger; «Добивание» never with «Быстрые ноги» (design answer 14). */
export const RT_COUNTER_TALISMANS: readonly RtTalismanDef[] = [
  { id: CT.fifthLink, name: 'Пятое звено', rarity: 'common', effect: 'Каждое 5-е звено цепи (5, 10, 15…) получает +2 силы перед ударом' },
  { id: CT.thirdChain, name: 'Третья цепь', rarity: 'common', effect: 'Каждая 3-я цепь арены, убившая хотя бы одного: следующий прыжок за 5 с бесплатен' },
  { id: CT.prism, name: 'Призма', rarity: 'common', effect: '+1 энергия за каждый кристалл, разбитый проходом' },
  { id: CT.shockwave, name: 'Ударная волна', rarity: 'uncommon', effect: 'Цепь из 8+ звеньев: в конце прохода волна радиусом 2 вокруг героя бьёт на 1 всех врагов' },
  { id: CT.finisher, name: 'Добивание', rarity: 'uncommon', effect: 'Последнее звено цепи погибло: неуязвимость после цепи 1 с вместо 0,5 с', excludes: [RL.swiftFeet] },
  { id: CT.eliteHunter, name: 'Охотник на элит', rarity: 'uncommon', effect: 'Элита в цепи: звенья после неё получают +3 силы (один раз)' },
  { id: CT.longArm, name: 'Длинная рука', rarity: 'rare', effect: 'Каждая 4-я цепь арены: радиус звена R +50% на всю эту цепь' },
  { id: CT.frostEdge, name: 'Иней на клинке', rarity: 'rare', effect: 'Каждая 4-я цепь арены: выжившее последнее звено замерзает на 2 с' },
];
/** Т3. Relics (section 5): a strong plus and a price; offered with the oaths by the Jailer's row, never sold. */
export const RT_RELICS: readonly RtTalismanDef[] = [
  { id: RL.millstone, name: 'Жернов', rarity: 'relic', effect: 'Кристалл за каждые 4 убийства цепью', price: 'максимум HP −3' },
  { id: RL.heavyBlade, name: 'Тяжёлый клинок', rarity: 'relic', effect: 'Каждое звено даёт +2 силы вместо +1', price: 'запас фокуса вдвое меньше' },
  { id: RL.swiftFeet, name: 'Быстрые ноги', rarity: 'relic', effect: 'Скорость героя +25%', price: 'нет неуязвимости после цепи', excludes: [CT.finisher] },
  { id: RL.wideCircle, name: 'Широкий круг', rarity: 'relic', effect: 'Радиус звена R +25%', price: 'враги ходят на 10% быстрее' },
  { id: RL.bloodOath, name: 'Кровавая клятва', rarity: 'relic', effect: '+1 энергия за каждые 6 убийств цепью на арене', price: 'лечение расходником вдвое слабее (9 → 5)' },
];
/** Every talisman of the real-time run: the slice's, the counter talismans (Т1), the relics (Т3). */
export const RT_TALISMANS: readonly RtTalismanDef[] = [...RT_SLICE_TALISMANS, ...RT_COUNTER_TALISMANS, ...RT_RELICS];

const BY_ID = new Map(RT_TALISMANS.map(entry => [entry.id, entry]));
export const rtTalisman = (id: RtTalismanId): RtTalismanDef | undefined => BY_ID.get(id);
export const isRtTalisman = (value: unknown): value is RtTalismanId => typeof value === 'string' && BY_ID.has(value);
export const isRtOath = (id: RtTalismanId): boolean => rtTalisman(id)?.rarity === 'oath';
export const isRtRelic = (id: RtTalismanId): boolean => rtTalisman(id)?.rarity === 'relic';
/** The rule of a talisman in one line; a relic — its plus and its price («цена: …»). */
export const rtTalismanText = (id: RtTalismanId): string => { const def = rtTalisman(id); return def ? `${def.effect}${def.price ? `; цена: ${def.price}` : ''}` : ''; };
/** Names of the rarities (offer cards). */
export const RT_RARITY_NAME: Readonly<Record<RtRarity, string>> = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', oath: 'клятва', relic: 'реликвия' };

/** Т2. Hammers (section 4): one per run (`Loadout.hammer`); the Jailer's row offers 3 of 4. */
export interface RtHammerDef { id: Hammer; name: string; effect: string }
export const RT_HAMMERS: readonly RtHammerDef[] = [
  { id: 'fire-pass', name: 'Огненный проход', effect: 'Путь героя по цепи горит 2 с: огонь бьёт врагов на 1 при входе; героя не жжёт, в воде не горит' },
  { id: 'end-blast', name: 'Взрыв на конце', effect: 'В конце прохода — взрыв радиусом 1,5 вокруг последнего звена: удар 1 по всем врагам' },
  { id: 'cutting-pass', name: 'Режущий проход', effect: 'Проход бьёт на 1 врагов любого цвета в 0,5 от пути (кроме звеньев)' },
  { id: 'return-pass', name: 'Возврат', effect: 'После прохода герой бежит к началу цепи вторым проходом с половиной силы; неуязвим на бегу' },
];
const HAMMER_BY_ID = new Map<string, RtHammerDef>(RT_HAMMERS.map(entry => [entry.id, entry]));
export const rtHammer = (id: string): RtHammerDef | undefined => HAMMER_BY_ID.get(id);
/** Баланс: hammers in the Jailer's offer. */
export const RT_HAMMER_OFFER_SIZE = 3;
/** The salt of a node's hammer roll (design answer 1: `mixSeed(arenaSeed, «rt-hammer»)`, no stream spent). */
export const HAMMER_SALT = [...'rt-hammer'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The hammer offer of the Jailer's row: RT_HAMMER_OFFER_SIZE different hammers of 4 by the node's roll (mixSeed(arenaSeed, HAMMER_SALT)). */
export function rtHammerOffer(roll: number): Hammer[] {
  const left = [...HAMMER_LIST], options: Hammer[] = [];
  for (let n = 0; n < RT_HAMMER_OFFER_SIZE && left.length; n++) options.push(left.splice(mixSeed(roll >>> 0, n) % left.length, 1)[0]);
  return options;
}
/** An offer option: a talisman (design answer 10 to step 3: no «пустышка» in the slice — an empty pool offers nothing). */
export type RtTalismanOption = RtTalismanId;

/** What the run took and what left the pool (shown and refused). */
export interface RtTalismanPool { taken: readonly RtTalismanId[]; gone: readonly RtTalismanId[] }
/**
 * The pool for the turn-based rolls the run still calls (the gift's buttons `rollGift`, the merchant's stock `shopStock`;
 * their talismans are drawn again by the real-time draws, phase B): the turn-based ids only, both abilities open
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
const eligibleOf = (rarity: RtRarity, pool: RtTalismanPool, offered: readonly RtTalismanOption[]) =>
  RT_TALISMANS.filter(entry => entry.rarity === rarity && rtTalismanEligible(entry.id, pool, offered)).map(entry => entry.id);

/** Баланс (design answer 4): the place of a hard-battle offer that is always rare (the first one). */
export const RT_RARE_SLOT = 0;
/**
 * The talisman offer of a won hard battle (`hard`) or of the Jailer's row (`oath`) — talismanOffer of the turn-based run
 * over the slice's list: up to three different options; a talisman option rolls its rarity, an empty rarity gives way to
 * the next one, all empty — no option (design answer 10: no «пустышка»; only the refusal stays). Phase B: the place
 * RT_RARE_SLOT of a hard battle is always rare (design answer 4; no rare left — it gives way as any other); the Jailer's
 * offer draws among the oaths and the relics (design answer 2). `base` is one draw of the run's `talismans` stream.
 */
export function rtTalismanOffer(base: number, source: 'hard' | 'oath', pool: RtTalismanPool): RtTalismanOption[] {
  const seed = mixSeed(base >>> 0, OFFER_SALT), options: RtTalismanOption[] = [];
  for (let slot = 0; slot < 3; slot++) {
    let candidates: RtTalismanId[] = [];
    if (source === 'oath') candidates = [...eligibleOf('oath', pool, options), ...eligibleOf('relic', pool, options)];
    else {
      const rolled = slot === RT_RARE_SLOT ? RARITIES.indexOf('rare') : RARITIES.indexOf(rarityOfRoll(unit(mixSeed(mixSeed(seed, slot), RARITY_SALT))));
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

/** The rarities the gift and events draw (design answer 5): the chain stops at the uncommon ones. */
const DRAW_RARITIES = ['common', 'uncommon'] as const;
const DRAW_SALT = 0x4d1f_86b5;
/**
 * Phase B (design answer 5): the real-time draw of the gift and of events — `count` different talismans of `rarity` from
 * the run's pool. An empty rarity gives way to the next one, and the chain stops at the uncommon ones: common → uncommon,
 * uncommon → none (rare ones come only from a hard battle and the merchant); an empty chain leaves the slot empty. An oath
 * draws among the oaths only (the relics come from the Jailer's row). `exclude` are not drawn either. `base` is one value
 * of the caller's stream — the same value the turn-based draw took: the streams do not move.
 */
export function rtTalismanDraw(base: number, rarity: 'common' | 'uncommon' | 'oath', count: number, pool: RtTalismanPool, exclude: readonly RtTalismanId[] = []): RtTalismanId[] {
  const drawn: RtTalismanId[] = [];
  for (let slot = 0; slot < count; slot++) {
    const eligible = (of: RtRarity) => eligibleOf(of, pool, drawn).filter(id => !exclude.includes(id));
    let candidates: RtTalismanId[] = [];
    if (rarity === 'oath') candidates = eligible('oath');
    else for (const of of DRAW_RARITIES.slice(DRAW_RARITIES.indexOf(rarity))) { candidates = eligible(of); if (candidates.length) break; }
    if (candidates.length) drawn.push(candidates[mixSeed(mixSeed(base >>> 0, slot), DRAW_SALT) % candidates.length]);
  }
  return drawn;
}
/** The reward of an event's battle: `count` different common talismans to choose from (an empty rarity gives way to uncommon). */
export const rtEventTalismanOffer = (base: number, count: number, pool: RtTalismanPool): RtTalismanOption[] => rtTalismanDraw(base, 'common', count, pool);
/** Some talisman an event may give is still in the pool (common or uncommon): an event's sure talisman needs one. */
export const rtTalismanLeft = (pool: RtTalismanPool): boolean => DRAW_RARITIES.some(rarity => eligibleOf(rarity, pool, []).length > 0);
