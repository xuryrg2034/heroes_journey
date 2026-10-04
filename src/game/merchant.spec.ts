/**
 * The merchant (docs/roguelike-runs.md, section 5б; merchant.ts): the run side, through real run commands on generated
 * maps. A run walks to a merchant node with the run model; its battles start in the real engine and end with the debug
 * win, and the resources a battle picked up (elite loot, a chest) are left in the engine's battle materials before the
 * win, as a real battle could leave them (restCraft.spec.ts does the same). Events on the way take an option that
 * changes neither HP nor resources, rests heal, finds take the first item, talisman choices are refused. Seeds are spread
 * with Math.imul(k, 2654435761).
 */
import { ForestEngine } from './forestEngine';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventView, forestRunMap, parseForestRun,
  resolveBattle, restHeal, serializeForestRun, shopBuy, shopLeave, shopView, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { eventOption } from './run/forestEvents';
import { SHOP_HARDEN_PRICE, SHOP_HARDEN_STEP, SHOP_HEAL_LIMIT, SHOP_HEAL_PRICE, SHOP_ITEM_PRICE, SHOP_ITEMS, SHOP_TALISMAN_PRICE } from './run/merchant';
import { emptyMaterials, RESOURCE_KINDS } from './resources';
import { talisman, type TalismanId } from './talismans';
import type { ResourceKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
const total = (run: ForestRunState) => RESOURCE_KINDS.reduce((sum, kind) => sum + (run.resources.materials?.[kind] ?? 0), 0);
type Stock = Partial<Record<ResourceKind, number>>;

/** Merchant nodes of a seed's generated map (the run starts past the trunk). */
function shopsOf(seed: number): string[] {
  return forestRunMap(createForestRun(seed, { map: 'generated', skipTrunk: true })).nodes.filter(node => node.type === 'shop').map(node => node.id);
}
/** Merchant maps among the first seeds: every map has one (mapGenerator.spec.ts); the first merchant of each. */
const SHOP_SEEDS = Array.from({ length: 12 }, (_, k) => spread(k + 1)).map(seed => ({ seed, shop: shopsOf(seed)[0] }));

/** Leave resources (and HP) in the battle's materials before its debug win, as a real battle could. */
function winBattle(run: ForestRunState, loot: Stock | undefined, hp: number | undefined): ForestRunState {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  if (loot) e.state.materials = { ...emptyMaterials(), ...e.state.materials, ...loot };
  if (hp !== undefined) e.state.player.hp = hp;
  e.winLevel();
  return ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${run.pending?.nodeId}`);
}
/** An event option that changes neither HP nor resources (every event has one). */
function quietEvent(run: ForestRunState): ForestRunState {
  const view = eventView(run)!;
  const option = view.options.find(entry => entry.available && eventOption(view.event, entry.id)!.outcomes.every(outcome => !outcome.effect.resources && !outcome.effect.hp))!;
  return ok(chooseEventOption(run, option.id), `event ${view.event.id}`);
}
/**
 * Walk `run` until `target` is entered (its pending open), entering only nodes from which it is reachable. The first
 * battle on the way leaves `loot`; every battle leaves the cat at `hp`. Other merchants on the way are left at once.
 */
function walkTo(run: ForestRunState, target: string, options: { loot?: Stock; hp?: number } = {}): ForestRunState {
  const map = forestRunMap(run), reach = new Map<string, boolean>();
  const reaches = (id: string): boolean => {
    if (id === target) return true;
    if (!reach.has(id)) reach.set(id, map.node(id)!.next.some(reaches));
    return reach.get(id)!;
  };
  let looted = false;
  for (let guard = 0; guard < 60; guard++) {
    if (run.pending?.nodeId === target) return run;
    if (run.pending?.kind === 'battle') { run = winBattle(run, looted ? undefined : options.loot, options.hp); looted = true; }
    else if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), 'refuse');
    else if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
    else if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
    else if (run.pending?.kind === 'event') run = quietEvent(run);
    else if (run.pending?.kind === 'shop') run = ok(shopLeave(run), 'leave another merchant');
    else run = ok(enterNode(run, availableNodes(run).find(node => reaches(node.id))!.id), 'enter');
  }
  throw new Error(`${run.seed}: ${target} not reached`);
}
const atShop = (seed: number, shop: string, options: { loot?: Stock; hp?: number } = {}) => walkTo(createForestRun(seed, { map: 'generated', skipTrunk: true }), shop, options);

/** The stock and the prices: two open consumables at 3, the talisman at 4/6/8 by rarity, healing 2, «Закалка» 4. */
function stockAndPrices() {
  let talismans = 0;
  for (const { seed, shop } of SHOP_SEEDS.slice(0, 8)) {
    const run = atShop(seed, shop, { loot: { dew: 4, powder: 3, resin: 2, herbs: 1 }, hp: 2 }), view = shopView(run)!;
    assert(run.pending?.kind === 'shop' && view.total === 10, `${seed}: the merchant opens with the stock of 10`);
    const items = view.goods.filter(good => good.good === 'item');
    assert(items.length === SHOP_ITEMS && items.every(good => run.tools.items.includes(good.item!) && good.price === SHOP_ITEM_PRICE && good.available), `${seed}: two open consumables at ${SHOP_ITEM_PRICE}`);
    const offered = view.goods.find(good => good.good === 'talisman');
    if (offered) {
      talismans++;
      const rarity = talisman(offered.talisman!).rarity;
      assert(rarity !== 'oath' && offered.price === SHOP_TALISMAN_PRICE[rarity] && offered.available, `${seed}: the ${rarity} talisman costs ${SHOP_TALISMAN_PRICE[rarity as 'common']}`);
    }
    const heal = view.goods.find(good => good.good === 'heal')!, harden = view.goods.find(good => good.good === 'harden')!;
    assert(heal.price === SHOP_HEAL_PRICE && heal.available && harden.price === SHOP_HARDEN_PRICE && harden.available, `${seed}: healing ${SHOP_HEAL_PRICE}, «Закалка» ${SHOP_HARDEN_PRICE}`);
    // A consumable: +1 in the inventory, the slot is sold, the stock is 3 less.
    const item = items[0].item!, bought = ok(shopBuy(run, 'item:0'), 'buy the first consumable');
    assert(bought.resources.inventory[item] === run.resources.inventory[item] + 1 && total(bought) === 7, `${seed}: the consumable is in the bag, 3 resources paid`);
    assert(!shopBuy(bought, 'item:0').ok && shopView(bought)!.goods[0].sold, `${seed}: a slot sells once`);
    // «Закалка»: +1 to the maximum HP and +1 HP; one per visit.
    const hardened = ok(shopBuy(bought, 'harden'), 'buy «Закалка»');
    assert(hardened.resources.player.maxHp === 6 && hardened.resources.player.hp === bought.resources.player.hp + 1 && total(hardened) === 3, `${seed}: «Закалка» +1 max HP and +1 HP for 4`);
    assert(!shopBuy(hardened, 'harden').ok, `${seed}: one «Закалка» per visit`);
    const left = ok(shopLeave(hardened), 'leave');
    assert(left.pending === null && left.currentNodeId === shop && left.resources.player.maxHp === 6 && json(roundTrip(left)) === json(left), `${seed}: the visit completes and the run keeps the new maximum`);
  }
  assert(talismans >= 6, `most merchants offer a talisman (${talismans} of 8)`);
  console.log(`PASS stock and prices: two open consumables at ${SHOP_ITEM_PRICE}, talismans by rarity, healing ${SHOP_HEAL_PRICE}, «Закалка» ${SHOP_HARDEN_PRICE} (+1 max HP); slots sell once`);
}

/** With a short stock the goods say why and cannot be bought; healing stays available. */
function shortStock() {
  for (const { seed, shop } of SHOP_SEEDS.slice(0, 4)) {
    const run = atShop(seed, shop, { loot: { resin: 2 }, hp: 1 }), view = shopView(run)!;
    for (const good of view.goods.filter(entry => entry.good !== 'heal')) {
      assert(!good.available && good.reason.includes('есть 2') && !shopBuy(run, good.id).ok, `${seed}: ${good.id} at ${good.price} is out of reach with 2 resources`);
    }
    assert(view.goods.find(good => good.good === 'heal')!.available, `${seed}: healing is never out of reach by its price`);
  }
  console.log('PASS a short stock: goods say why and are refused; healing stays available');
}

/** Healing costs 2 per HP cut to the stock: 0 resources — free, 1 — pays 1, 3 — pays 2; at most 2 HP a visit; not at full HP. */
function healingCut() {
  const { seed, shop } = SHOP_SEEDS[0];
  for (const [stock, first, second] of [[0, 0, 0], [1, 1, 0], [3, 2, 1]] as const) {
    const run = atShop(seed, shop, { loot: stock ? { herbs: stock } : undefined, hp: 1 }), hp = run.resources.player.hp;
    assert(total(run) === stock && hp <= 3, `stock ${stock}: the merchant opens with ${stock} resources and a wounded cat`);
    const heal = () => shopView(once)!.goods.find(good => good.good === 'heal')!;
    let once = run;
    assert(heal().price === first && heal().fullPrice === SHOP_HEAL_PRICE, `stock ${stock}: the first HP costs ${first} (price ${SHOP_HEAL_PRICE} cut to the stock)`);
    once = ok(shopBuy(once, 'heal'), 'heal 1');
    assert(once.resources.player.hp === hp + 1 && total(once) === stock - first, `stock ${stock}: +1 HP for ${first}`);
    assert(heal().price === second, `stock ${stock}: the second HP costs ${second}`);
    once = ok(shopBuy(once, 'heal'), 'heal 2');
    assert(once.resources.player.hp === hp + 2 && total(once) === stock - first - second, `stock ${stock}: +2 HP in all`);
    assert(!heal().available && heal().reason.includes(String(SHOP_HEAL_LIMIT)) && !shopBuy(once, 'heal').ok, `stock ${stock}: at most ${SHOP_HEAL_LIMIT} HP a visit`);
    assert(json(roundTrip(once)) === json(once), `stock ${stock}: the visit with healing survives a reload`);
  }
  const full = atShop(seed, shop, { loot: { herbs: 4 } });
  assert(full.resources.player.hp === full.resources.player.maxHp && !shopView(full)!.goods.find(good => good.good === 'heal')!.available && !shopBuy(full, 'heal').ok, 'no healing at full HP');
  console.log('PASS healing: 2 per HP cut to the stock (0 → free, 1 → 1, 3 → 2 then 1), at most 2 HP a visit, none at full HP');
}

/** Payment takes each unit from the kind held most at that moment, a tie to the first kind (dew, powder, resin, herbs). */
function paymentOrder() {
  const { seed, shop } = SHOP_SEEDS[1];
  const cases: [Stock, Stock][] = [
    [{ dew: 4, powder: 3, resin: 2, herbs: 1 }, { dew: 2, powder: 1 }],
    [{ dew: 3, resin: 3 }, { dew: 2, resin: 1 }],
    [{ powder: 1, herbs: 5 }, { herbs: 3 }],
    [{ dew: 1, powder: 1, resin: 1, herbs: 1 }, { dew: 1, powder: 1, resin: 1 }],
  ];
  for (const [stock, paid] of cases) {
    const run = atShop(seed, shop, { loot: stock }), after = ok(shopBuy(run, 'item:0'), 'buy a consumable');
    const expected = { ...emptyMaterials(), ...paid }, purchase = after.pending?.kind === 'shop' ? after.pending.bought[0] : undefined;
    assert(json(purchase?.paid) === json(expected), `${json(stock)}: pays ${json(expected)}, got ${json(purchase?.paid)}`);
    for (const kind of RESOURCE_KINDS) assert(after.resources.materials![kind] === (stock[kind] ?? 0) - expected[kind], `${json(stock)}: ${kind} left`);
  }
  console.log('PASS payment: the most numerous kind first, unit by unit, ties in a fixed order');
}

/** «Закалка» costs 4, then 6 at the next merchant of the same run: the price grows with each purchase in the run. */
function hardeningGrows() {
  let found = 0;
  for (let k = 1; k <= 6000 && found < 3; k++) {
    const seed = spread(k), shops = shopsOf(seed);
    if (shops.length < 2) continue;
    const map = forestRunMap(createForestRun(seed, { map: 'generated', skipTrunk: true }));
    const reaches = (from: string, to: string): boolean => from === to || map.node(from)!.next.some(id => reaches(id, to));
    const pair = shops.flatMap(a => shops.filter(b => a !== b && reaches(a, b)).map(b => [a, b] as const))[0];
    if (!pair) continue;
    found++;
    const first = atShop(seed, pair[0], { loot: { dew: 20 } });
    assert(shopView(first)!.goods.find(good => good.good === 'harden')!.price === SHOP_HARDEN_PRICE, `${seed}: the first «Закалка» costs ${SHOP_HARDEN_PRICE}`);
    const left = ok(shopLeave(ok(shopBuy(first, 'harden'), 'harden 1')), 'leave the first merchant');
    const second = walkTo(left, pair[1]), price = shopView(second)!.goods.find(good => good.good === 'harden')!;
    assert(price.price === SHOP_HARDEN_PRICE + SHOP_HARDEN_STEP && shopView(second)!.hardenings === 1, `${seed}: the second «Закалка» of the run costs ${SHOP_HARDEN_PRICE + SHOP_HARDEN_STEP}`);
    const after = ok(shopBuy(second, 'harden'), 'harden 2');
    assert(after.resources.player.maxHp === 7 && json(roundTrip(after)) === json(after), `${seed}: two «Закалки» — 7 max HP, the save replays both prices`);
    assert(forge(after, value => { value.pending.bought[0].price = SHOP_HARDEN_PRICE; value.pending.bought[0].paid.dew -= SHOP_HARDEN_STEP; value.resources.materials.dew += SHOP_HARDEN_STEP; }) === null,
      `${seed}: a second «Закалка» at the first price is rejected`);
  }
  assert(found === 3, `three maps with two merchants on one route (${found})`);
  console.log('PASS «Закалка»: 4, then 6 at the next merchant of the run; the save checks the price of the moment');
}

/** Collect every talisman offered after `run` on a bot's way to the end (choices refused, merchants left). */
function offeredLater(run: ForestRunState, choice: number): TalismanId[] {
  const seen: TalismanId[] = [];
  for (let guard = 0; guard < 60 && !run.result; guard++) {
    choice = spread(choice + 1);
    if (run.pending?.kind === 'battle') run = winBattle(run, undefined, undefined);
    else if (run.pending?.kind === 'talisman') { seen.push(...run.pending.options.filter((option): option is TalismanId => option !== 'blank')); run = ok(chooseTalisman(run, null), 'refuse'); }
    else if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
    else if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
    else if (run.pending?.kind === 'event') run = quietEvent(run);
    else if (run.pending?.kind === 'shop') { if (run.pending.stock.talisman) seen.push(run.pending.stock.talisman); run = ok(shopLeave(run), 'leave'); }
    else { const next = availableNodes(run), hard = next.find(node => node.type === 'hard'); run = ok(enterNode(run, (hard ?? next[choice % next.length]).id), 'enter'); }
  }
  return seen;
}

/** The talisman comes from the run's pool without return: bought — taken; shown and not bought — gone for the run. */
function talismanPool() {
  let checked = 0, later = 0;
  for (const { seed, shop } of SHOP_SEEDS) {
    const run = atShop(seed, shop, { loot: { dew: 10 } }), id = run.pending?.kind === 'shop' ? run.pending.stock.talisman : null;
    if (!id) continue;
    checked++;
    assert(!run.talismans.includes(id) && !run.talismansGone.includes(id), `${seed}: the merchant shows a talisman of the pool`);
    const refused = ok(shopLeave(run), 'leave without it');
    assert(refused.talismansGone.includes(id) && json(roundTrip(refused)) === json(refused), `${seed}: shown and not bought — it leaves the pool (and the save replays it)`);
    const bought = ok(shopLeave(ok(shopBuy(run, 'talisman'), 'buy the talisman')), 'leave with it');
    assert(bought.talismans.includes(id) && !bought.talismansGone.includes(id) && json(roundTrip(bought)) === json(bought), `${seed}: bought — taken`);
    for (const after of [refused, bought]) {
      const seen = offeredLater(after, seed); later += seen.length;
      assert(!seen.includes(id), `${seed}: ${id} is never offered again in the run`);
    }
  }
  assert(checked >= 8 && later >= 6, `talismans checked at ${checked} merchants, ${later} later offers`);
  console.log(`PASS the talisman pool without return: bought or only shown, it never comes again (${checked} merchants, ${later} later offers)`);
}

/** Saves: the open merchant reloads with its stock and purchases; forged purchases are rejected; saves before the merchant load. */
function saves() {
  const { seed, shop } = SHOP_SEEDS[2];
  const run = atShop(seed, shop, { loot: { dew: 5, powder: 5 }, hp: 1 });
  const again = atShop(seed, shop, { loot: { dew: 5, powder: 5 }, hp: 1 });
  assert(json(run) === json(again), 'the same seed and actions give the same stock');
  let open = ok(shopBuy(run, 'item:1'), 'buy'); open = ok(shopBuy(open, 'heal'), 'heal');
  assert(json(roundTrip(open)) === json(open) && json(shopView(roundTrip(open)!)) === json(shopView(open)), 'the open merchant reloads with the same stock and purchases');
  const reject = (what: string, change: (value: any) => void) => assert(forge(open, change) === null, `rejected: ${what}`);
  reject('another stock', value => { value.pending.stock.items[0] = value.pending.stock.items[0] === 'bomb' ? 'fire' : 'bomb'; });
  reject('a cheaper consumable', value => { value.pending.bought[0].price = 2; });
  reject('a payment short of the price', value => { value.pending.bought[0].paid.dew = 0; value.pending.bought[0].paid.powder = 1; });
  reject('a slot sold twice', value => { value.pending.bought.push(structuredClone(value.pending.bought[0])); });
  reject('a talisman not in the stock', value => { value.pending.bought.push({ good: 'talisman', talisman: 'ash-ward', price: 8, paid: { dew: 4, powder: 4, resin: 0, herbs: 0 } }); });
  reject('a third heal', value => { value.pending.bought.push({ good: 'heal', price: 2, paid: emptyMaterials() }, { good: 'heal', price: 2, paid: emptyMaterials() }); });
  reject('a payment the stock never had', value => { value.pending.bought[1].paid.herbs = 2; value.pending.bought[1].paid.dew = 0; });
  reject('a maximum HP without «Закалка»', value => { value.resources.player.maxHp = 6; });
  const done = ok(shopLeave(open), 'leave');
  assert(json(roundTrip(done)) === json(done) && forge(done, value => { value.shops = []; }) === null, 'a completed visit reloads; a visited merchant without its record is rejected');
  if (done.talismansGone.length) assert(forge(done, value => { value.talismansGone = []; }) === null, 'a talisman shown and not bought cannot return to the pool');
  // A save from before the merchant has no `shops`: a run that met none loads with an empty list.
  const before = ok(enterNode(createForestRun(seed, { map: 'generated', skipTrunk: true }), availableNodes(createForestRun(seed, { map: 'generated', skipTrunk: true }))[0].id), 'enter');
  const old = forge(before, value => { delete value.shops; });
  assert(old !== null && json(old.shops) === '[]', 'a save without merchant records loads');
  console.log('PASS saves: the open merchant reloads; forged stock, prices, payments, slots and visits are rejected; old saves load');
}

/** Determinism and variety: the stock depends on the run seed and the node; different seeds sell different things. */
function variety() {
  const stocks = new Set<string>(), rarities = { common: 0, uncommon: 0, rare: 0 };
  for (let k = 1; k <= 40; k++) {
    const seed = spread(k + 100), shop = shopsOf(seed)[0], run = atShop(seed, shop);
    const stock = run.pending?.kind === 'shop' ? run.pending.stock : null;
    assert(stock && json(atShop(seed, shop).pending) === json(run.pending), `${seed}: the same seed rolls the same stock`);
    stocks.add(json(stock));
    if (stock.talisman) rarities[talisman(stock.talisman).rarity as 'common']++;
  }
  assert(stocks.size >= 15 && rarities.common > 0 && rarities.uncommon > 0 && rarities.rare > 0, `stocks vary: ${stocks.size} distinct of 40, rarities ${json(rarities)}`);
  console.log(`PASS variety: ${stocks.size} distinct stocks over 40 seeds, talisman rarities ${json(rarities)}`);
}

stockAndPrices();
shortStock();
healingCut();
paymentOrder();
hardeningGrows();
talismanPool();
saves();
variety();
console.log('Merchant checks passed.');
