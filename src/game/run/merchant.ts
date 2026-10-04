/**
 * The merchant (design agreed 04.10.2026, docs/roguelike-runs.md, section 5б): a map node that sells for crafting
 * resources. Pure data and functions; the run model (forestRun.ts) keeps the visit, the map screen draws it.
 *
 * - Currency: crafting resources of any kind (resources.ts). A price is paid unit by unit from the kind the run holds
 *   most of at that moment; a tie goes to the first kind in RESOURCE_KINDS. No choice, so no extra clicks.
 * - Stock of one visit, rolled on entering by the run seed and the node id (a stream of its own, SHOP_SALT): two
 *   consumables of different kinds, of those open in the run first (one open kind — the other slot is a kind not open
 *   yet; buying it opens it for the run, as a craft does), one talisman from the run's pool (talismanOffers.ts: the same eligibility and
 *   rarity roll as the hard-battle offer), healing and «Закалка». Nothing restocks during the visit.
 * - A talisman shown and not bought leaves the pool when the visit ends (docs/talismans.md: shown and refused).
 */
import { ITEM_KINDS, mixSeed } from '../items';
import type { ItemKind, ResourceKind } from '../forestTypes';
import { RESOURCE_KINDS, emptyMaterials } from '../resources';
import { TALISMANS, type TalismanId } from '../talismans';
import { rarityOfRoll, talismanEligible, type TalismanPool } from './talismanOffers';

// Баланс (docs/roguelike-runs.md, 5б).
/** Consumables on sale per visit and the price of each. */
export const SHOP_ITEMS = 2, SHOP_ITEM_PRICE = 3;
/** Talisman price by rarity (the rarity is rolled 50/33/17%, RARITY_CHANCES). */
export const SHOP_TALISMAN_PRICE: Readonly<Record<'common' | 'uncommon' | 'rare', number>> = { common: 4, uncommon: 6, rare: 8 };
/** Healing: price of 1 HP and HP per visit at most. The price is cut to the stock: short — pay what there is; empty — free. */
export const SHOP_HEAL_PRICE = 2, SHOP_HEAL_LIMIT = 2;
/** «Закалка» (+1 to the maximum HP and +1 HP): the first price in a run and the rise after each purchase; one per visit. */
export const SHOP_HARDEN_PRICE = 4, SHOP_HARDEN_STEP = 2, SHOP_HARDEN_LIMIT = 1;
const SHOP_SALT = 0x6d1f_3b27, ITEM_SALT = 0x1b87_3593, RARITY_SALT = 0x2f8e_c1a5, PICK_SALT = 0x4c9a_7e13;
const RARITIES = ['common', 'uncommon', 'rare'] as const;

/** What one visit offers: consumables by slot (always of different kinds) and the talisman (null — none fits). */
export interface ShopStock { items: ItemKind[]; talisman: TalismanId | null }
export type ShopGoodKind = 'item' | 'talisman' | 'heal' | 'harden';
/** A purchase: the good (and its slot or talisman), the full price, and the units paid per resource kind. */
export interface ShopPurchase {
  good: ShopGoodKind;
  /** Slot of the consumable in `ShopStock.items`. */
  slot?: number;
  item?: ItemKind;
  talisman?: TalismanId;
  /** The price before the cut of the healing to the stock. */
  price: number;
  /** Units taken per resource kind; their sum is the price (healing: at most the price). */
  paid: Record<ResourceKind, number>;
}

const unit = (value: number) => value / 0x100000000;

/**
 * The stock of a visit. `nodeSeed` is forestNodeSeed(run seed, node id); `openItems` the consumables open in the run
 * on entering (in opening order); `pool` the run's talisman pool on entering. Consumables are drawn without repeats
 * from the open kinds, and when they run out (one open kind) from the kinds not open yet (decision of 04.10.2026);
 * none open — no consumables.
 */
export function shopStock(nodeSeed: number, openItems: readonly ItemKind[], pool: TalismanPool): ShopStock {
  const base = mixSeed(nodeSeed >>> 0, SHOP_SALT), items: ItemKind[] = [];
  const open = [...openItems], closed = ITEM_KINDS.filter(kind => !openItems.includes(kind));
  for (let slot = 0; openItems.length && slot < SHOP_ITEMS; slot++) {
    const left = open.length ? open : closed;
    if (!left.length) break;
    const pick = mixSeed(mixSeed(base, ITEM_SALT), slot) % left.length;
    items.push(left.splice(pick, 1)[0]);
  }
  // The talisman: the rarity roll of a hard-battle option; an empty rarity gives way to the next one, all empty — none.
  const rolled = RARITIES.indexOf(rarityOfRoll(unit(mixSeed(base, RARITY_SALT))) as typeof RARITIES[number]);
  let talisman: TalismanId | null = null;
  for (let step = 0; step < RARITIES.length && !talisman; step++) {
    const candidates = TALISMANS.filter(entry => entry.rarity === RARITIES[(rolled + step) % RARITIES.length] && talismanEligible(entry.id, pool)).map(entry => entry.id);
    if (candidates.length) talisman = candidates[mixSeed(base, PICK_SALT) % candidates.length];
  }
  return { items, talisman };
}

/** Resources held in total. */
export const stockTotal = (materials: Partial<Record<ResourceKind, number>> | undefined): number =>
  RESOURCE_KINDS.reduce((sum, kind) => sum + (materials?.[kind] ?? 0), 0);

/**
 * Units taken for `amount` (at most what is held): each unit from the kind held most at that moment, a tie to the
 * first kind in RESOURCE_KINDS. Deterministic; `materials` is not changed.
 */
export function shopPayment(materials: Partial<Record<ResourceKind, number>> | undefined, amount: number): Record<ResourceKind, number> {
  const left = { ...emptyMaterials(), ...materials }, paid = emptyMaterials();
  for (let n = Math.min(amount, stockTotal(left)); n > 0; n--) {
    const kind = RESOURCE_KINDS.reduce((best, next) => left[next] > left[best] ? next : best, RESOURCE_KINDS[0]);
    left[kind]--; paid[kind]++;
  }
  return paid;
}

/** Price of a good before the cut of the healing. `hardenings`: «Закалка» bought in the run so far; `markup`: the ladder's step 9. */
export function shopPrice(good: ShopGoodKind, options: { talisman?: TalismanId | null; hardenings?: number; markup?: number } = {}): number {
  const markup = options.markup ?? 0;
  if (good === 'item') return SHOP_ITEM_PRICE + markup;
  if (good === 'heal') return SHOP_HEAL_PRICE + markup;
  if (good === 'harden') return SHOP_HARDEN_PRICE + SHOP_HARDEN_STEP * (options.hardenings ?? 0) + markup;
  const rarity = TALISMANS.find(entry => entry.id === options.talisman)?.rarity;
  return (rarity && rarity !== 'oath' ? SHOP_TALISMAN_PRICE[rarity] : 0) + markup;
}

