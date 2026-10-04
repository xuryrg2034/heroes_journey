/**
 * Offers of talismans and oaths in a forest run (docs/talismans.md, sections 2–4). Pure functions of a draw of the run's
 * `talismans` stream (runStreams.ts; saves before 04.10.2026 — the node seed) and the run's pool state: the same run
 * always gets the same offer, also after a reload, and the save check replays them. The map, the pools of battles and
 * events and the battles' RNG never draw from that stream, and it never draws from them.
 */
import { mixSeed } from '../items';
import type { AbilityKind } from '../forestTypes';
import { TALISMANS, talisman, type TalismanId, type TalismanRarity } from '../talismans';

/** An offered option: a talisman or oath, or the «пустышка» (BLANK_SCORE run points) when the pool has nothing left. */
export type TalismanOption = TalismanId | 'blank';
/**
 * `hard`: a won hard battle offers talismans; `oath`: a won Jailer battle offers oaths; `event`: a won reward battle of an
 * event offers common talismans (docs/events.md, «Засада у брода»).
 */
export type TalismanSource = 'hard' | 'oath' | 'event';
/** Баланс: options in one offer. */
export const TALISMAN_OFFER_SIZE = 3;
/** Баланс: run points of the «пустышка». */
export const BLANK_SCORE = 5;
/** Баланс: chances of the rarity each talisman option rolls, in percent (Slay the Spire chests and elites). */
export const RARITY_CHANCES: Readonly<Record<'common' | 'uncommon' | 'rare', number>> = { common: 50, uncommon: 33, rare: 17 };
const RARITIES = ['common', 'uncommon', 'rare'] as const;
const TALISMAN_SALT = 0x7a11_5a4d, RARITY_SALT = 0x3c6e_f372, PICK_SALT = 0x5be0_cd19;

/**
 * What decides an offer: talismans taken, talismans out of the pool (shown and refused), abilities open now, and the
 * talismans the bar of openings has opened for the run (unlocks.ts; absent — all).
 */
export interface TalismanPool { taken: readonly TalismanId[]; gone: readonly TalismanId[]; abilities: readonly AbilityKind[]; open?: readonly TalismanId[] }

/** `a` and `b` are not offered together (either one excludes the other). */
export function talismansClash(a: TalismanId, b: TalismanId): boolean {
  return !!talisman(a).excludes?.includes(b) || !!talisman(b).excludes?.includes(a);
}
/**
 * `id` may be offered now: open in the run, still in the pool, not in this offer yet, no clash with a taken talisman or
 * another option of this offer, and its ability open (Ловкие лапы need the jump).
 */
export function talismanEligible(id: TalismanId, pool: TalismanPool, offered: readonly TalismanOption[] = []): boolean {
  const definition = talisman(id), others = [...pool.taken, ...offered.filter((option): option is TalismanId => option !== 'blank')];
  if (pool.taken.includes(id) || pool.gone.includes(id) || offered.includes(id)) return false;
  // Closed by the bar of openings: it waits for its level.
  if (pool.open && !pool.open.includes(id)) return false;
  if (definition.requiresAbility && !pool.abilities.includes(definition.requiresAbility)) return false;
  return !others.some(other => talismansClash(id, other));
}
/** The rarity a roll of 0–1 gives: common below 50%, uncommon below 83%, rare above. */
export function rarityOfRoll(roll: number): Exclude<TalismanRarity, 'oath'> {
  let total = 0;
  for (const rarity of RARITIES) { total += RARITY_CHANCES[rarity] / 100; if (roll < total) return rarity; }
  return 'rare';
}
const unit = (value: number) => value / 0x100000000;

/**
 * Up to `count` different talismans of `rarity` from the pool (the start gift, runGift.ts): an empty rarity gives way to
 * the next one (common → uncommon → rare → common), with all three empty the slot stays empty (no «пустышка»); oaths
 * draw among the eligible oaths only. `exclude` are not drawn either. `base` is one draw of the caller's stream.
 */
export function talismanDraw(base: number, rarity: TalismanRarity, count: number, pool: TalismanPool, exclude: readonly TalismanId[] = []): TalismanId[] {
  const drawn: TalismanId[] = [];
  for (let slot = 0; slot < count; slot++) {
    const eligible = (of: TalismanRarity) => TALISMANS.filter(entry => entry.rarity === of && !exclude.includes(entry.id) && talismanEligible(entry.id, pool, drawn)).map(entry => entry.id);
    let candidates: TalismanId[] = [];
    if (rarity === 'oath') candidates = eligible('oath');
    else for (let step = 0, at = RARITIES.indexOf(rarity); step < RARITIES.length && !candidates.length; step++) candidates = eligible(RARITIES[(at + step) % RARITIES.length]);
    if (candidates.length) drawn.push(candidates[mixSeed(mixSeed(base >>> 0, slot), PICK_SALT) % candidates.length]);
  }
  return drawn;
}

/**
 * The offer of a node: up to TALISMAN_OFFER_SIZE different talismans (or oaths). A talisman option rolls its rarity;
 * an empty rarity gives way to the next one (common → uncommon → rare → common), and with all three empty the option
 * becomes the «пустышка». The «пустышка» appears at most once: a small pool offers fewer talismans plus one «пустышка».
 * An oath option draws from the eligible oaths with no rarity roll. `nodeSeed` is forestNodeSeed(run seed, node id).
 */
export function talismanOffer(nodeSeed: number, source: TalismanSource, pool: TalismanPool): TalismanOption[] {
  const base = mixSeed(nodeSeed >>> 0, TALISMAN_SALT), options: TalismanOption[] = [];
  for (let slot = 0; slot < TALISMAN_OFFER_SIZE; slot++) {
    const eligible = (rarity: TalismanRarity) => TALISMANS.filter(entry => entry.rarity === rarity && talismanEligible(entry.id, pool, options)).map(entry => entry.id);
    let candidates: TalismanId[] = [];
    if (source === 'oath') candidates = eligible('oath');
    else {
      const rolled = RARITIES.indexOf(rarityOfRoll(unit(mixSeed(mixSeed(base, slot), RARITY_SALT))));
      for (let step = 0; step < RARITIES.length && !candidates.length; step++) candidates = eligible(RARITIES[(rolled + step) % RARITIES.length]);
    }
    if (candidates.length) options.push(candidates[mixSeed(mixSeed(base, slot), PICK_SALT) % candidates.length]);
    else if (!options.includes('blank')) options.push('blank');
  }
  return options;
}

/**
 * The reward of an event's battle (docs/events.md): `count` different common talismans to choose from (an empty rarity
 * gives way, as talismanDraw), or the «пустышка» alone when the pool has nothing left. `base` is one `talismans` draw.
 */
export function eventTalismanOffer(base: number, count: number, pool: TalismanPool): TalismanOption[] {
  const drawn = talismanDraw(base, 'common', count, pool);
  return drawn.length ? drawn : ['blank'];
}
/** Some talisman (not an oath) can still be drawn from the pool: an event's sure talisman needs one. */
export function talismanLeft(pool: TalismanPool): boolean {
  return TALISMANS.some(entry => entry.rarity !== 'oath' && talismanEligible(entry.id, pool));
}
