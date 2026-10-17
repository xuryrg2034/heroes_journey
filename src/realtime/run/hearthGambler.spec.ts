/**
 * Task 51 «Лагерь, этап 3», step 51в (docs/design-notes/task-51-camp-l3.md, section 3.2; docs/realtime-slice.md, «Лагерь, этап 3»): Шиш,
 * the goblin card sharp. Node only: `npm run test:realtime-hearth-gambler`. Whole runs walked by the run's own commands (metaWalk.testkit.ts),
 * the profile as the view keeps it (`createRtProfileStore(storage, { gambler: true })` — his camp on; the game's default is off until the
 * camp's view of Шиш):
 * - he comes by a real game of the goblins' circle, not without one; `last.casino` — the last game won or lost; with his camp off nothing
 *   changes (no arrival, no field); the fallback queue Марфа → Ерофей → Шиш;
 * - «Шишова лавка»: a forest merchant's goods drawn again once a run (the stream `hearth-shop`, the same by the seed), before a good is
 *   bought; the opening goods are the merchant's of before (300 seeds); «Лавка в гарнизоне» — a garrison merchant's too;
 * - «Размен» once a run, 3 → 2; the quest «Вернись с 10 ресурсами» done and not done.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { parseRtRun, rtCasinoResult, rtNode, rtShopReroll, rtShopRerollView, rtShopSwap, rtShopSwapView, serializeRtRun, type RtHearthFlags, type RtRunState } from './rtRun';
import { RT_GAMBLER_HOARD } from './rtMeta';
import { stockTotal } from '../forest/merchant';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
/** The walk steers to the goblins' circle (an event node from row 3 that may stand it): the event nodes first. */
const toEvents: WalkOptions['pickNode'] = (run, ids) => ids.find(id => rtNode(run, id)?.type === 'event') ?? null;

check('Шиш comes by a real game of the circle, not without one; `last.casino` won/lost; his camp off — nothing changes', () => {
  let came = 0, without = 0;
  const outcomes = new Set<string>();
  for (let k = 1; k <= 30; k++) {
    const on = createRtProfileStore(memoryStorage(), { gambler: true }), off = memoryStorage(), offStore = createRtProfileStore(off);
    const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: on.locked() }, circle: true, pickNode: toEvents });
    const end = on.endRunMeta(walk.run)!; offStore.endRunMeta(walk.run);
    const games = walk.run.casino?.games ?? [];
    const meta = on.load().meta!, hearth = meta.hearth!;
    if (games.length) {
      came++;
      const last = rtCasinoResult(games[games.length - 1]).win ? 'won' : 'lost';
      outcomes.add(last);
      assert(hearth.met.gambler && hearth.last?.casino === last && on.hearth().met.gambler, `seed ${k}: came, ${last}`);
      assert(end.arrived?.some(a => a.npc === 'gambler' && !a.self), `seed ${k}: the end tells his arrival by the deed`);
    } else {
      without++;
      assert(!hearth.met.gambler && hearth.last?.casino === undefined, `seed ${k}: no game — no Шиш`);
    }
    const plain = JSON.parse(off.data.get(RT_PROFILE_STORAGE_KEY)!).meta.hearth;
    assert(!plain.met.gambler && plain.last.casino === undefined, `seed ${k}: his camp off — no arrival, no field`);
  }
  assert(came >= 3 && without >= 3 && outcomes.size === 2, `came ${came}, without ${without}, outcomes ${[...outcomes]}`);
});

check('the fallback queue Марфа → Ерофей → Шиш: three quiet runs each; his camp off — Шиш never comes by it', () => {
  const on = createRtProfileStore(memoryStorage(), { gambler: true }), offStorage = memoryStorage(), off = createRtProfileStore(offStorage);
  const order: string[] = [];
  for (let k = 1; k <= 14; k++) {
    // Quiet runs: no event node (no choice brings anyone), no circle.
    const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: on.locked() }, circle: false, pickNode: (run, ids) => ids.find(id => rtNode(run, id)?.type !== 'event') ?? null });
    const end = on.endRunMeta(walk.run)!; off.endRunMeta(walk.run);
    for (const npc of ['herb', 'smith', 'gambler'] as const) if (on.hearth().met[npc] && !order.includes(npc)) { order.push(npc); assert(same(end.arrived, [{ npc, self: true }]), `${npc}: the end tells the fallback arrival`); }
  }
  assert(same(order, ['herb', 'smith', 'gambler']) && on.hearth().self.gambler === true, `the order ${order}`);
  assert(!off.hearth().met.gambler && off.hearth().met.herb && off.hearth().met.smith, 'off: Марфа, Ерофей, no Шиш');
});

/** A profile with Шиш at `level` (met), his camp on: a stored profile as setup (the camp's levels are bought in the camp's view). */
function gamblerCamp(level: number, quest?: boolean): ReturnType<typeof createRtProfileStore> {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { gambler: true });
  store.endRunMeta(walkRun({ k: 2, create: { gift: 'full', garrison: false, locked: store.locked() } }).run);
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  p.meta.hearth.levels.gambler = level; p.meta.hearth.met.gambler = true;
  if (quest) p.meta.hearth.quest = { npc: 'gambler', id: 'gambler-hoard' };
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  return store;
}
/** Thrown to stop a walk at the state it found. */
class Found extends Error { constructor(readonly run: RtRunState) { super('found'); } }
/** The first merchant's screen of a walk (the forest's, or the garrison's with `garrison`), the walk steered to merchants. */
function firstShop(k: number, flags: RtHearthFlags | undefined, garrison = false): RtRunState | null {
  try {
    walkRun({ k, create: { gift: 'full', garrison, locked: [], ...flags ? { hearth: flags } : {} }, pickNode: (run, ids) => ids.find(id => rtNode(run, id)?.type === 'shop') ?? null,
      each: run => { if (run.pending?.kind === 'shop' && (!garrison || run.pending.nodeId.startsWith('g:'))) throw new Found(run); } });
  } catch (e) { if (e instanceof Found) return e.run; throw e; }
  return null;
}

check('«Шишова лавка»: the opening goods are the merchant\'s of before (300 seeds); a free reroll draws them again (the same by the seed), once a run, before a good is bought', () => {
  let shops = 0, changed = 0, rerolled = 0;
  for (let k = 1; k <= 300; k++) {
    const plain = firstShop(k, undefined), flagged = firstShop(k, { shopRerolls: 1 });
    if (!plain || !flagged) { assert(!plain && !flagged, `seed ${k}: the same walk`); continue; }
    shops++;
    const a = plain.pending as Extract<RtRunState['pending'], { kind: 'shop' }>, b = flagged.pending as typeof a;
    assert(same(a.stock, b.stock) && rtShopRerollView(plain) === null, `seed ${k}: the opening goods`);
    if (k > 24) continue;
    const view = rtShopRerollView(flagged)!;
    assert(view.available && !view.garrison, `seed ${k}: the reroll`);
    const step = rtShopReroll(flagged), again = rtShopReroll(flagged);
    rerolled++;
    assert(step.ok && again.ok && same(step.run, again.run) && step.run.shopRerolled === true, `seed ${k}: rerolled, the same by the seed`);
    const c = step.run.pending as typeof a;
    if (!same(c.stock, b.stock)) changed++;
    assert(!rtShopRerollView(step.run)!.available && same(parseRtRun(serializeRtRun(step.run)), step.run), 'once; the save round-trips');
    const good = c.stock.items.length ? 'item:0' : null;
    if (good) { const bought = rtShopReroll({ ...flagged, pending: { ...b, bought: [{ good: 'item', slot: 0, item: b.stock.items[0], price: 2, paid: { dew: 0, powder: 0, resin: 0, herbs: 0 } }] } }); assert(!bought.ok, 'not after a good bought'); }
  }
  // Random goods may come again (one open kind, the same talisman): not every reroll changes them.
  assert(shops >= 150 && rerolled >= 10 && changed >= rerolled / 3, `merchants ${shops}, rerolls ${rerolled}, of them changed the goods ${changed}`);
  // «Лавка в гарнизоне»: a garrison merchant with `shopRerolls` 2, not with 1.
  let garrisonShops = 0;
  for (let k = 1; k <= 30 && garrisonShops < 3; k++) {
    const two = firstShop(k, { shopRerolls: 2 }, true), one = firstShop(k, { shopRerolls: 1 }, true);
    if (!two || !one) continue;
    garrisonShops++;
    assert(rtShopRerollView(one) === null && rtShopRerollView(two)?.garrison === true, `seed ${k}: the garrison's merchant`);
    const step = rtShopReroll(two);
    assert(step.ok && step.run.garrisonShopRerolled === true && step.run.shopRerolled === two.shopRerolled && same(parseRtRun(serializeRtRun(step.run)), step.run), 'its own counter');
  }
  assert(garrisonShops >= 2, `garrison merchants ${garrisonShops}`);
});

check('«Размен»: 3 of a kind for 2 of another, once a run; without the flag none; wrong kinds refused', () => {
  let swaps = 0;
  for (let k = 1; k <= 40 && swaps < 4; k++) {
    const shop = firstShop(k, { swap: true }), plain = firstShop(k, undefined);
    if (!shop || !plain) continue;
    assert(rtShopSwapView(plain) === null, 'no flag — none');
    const view = rtShopSwapView(shop)!;
    if (!view.available) { assert(view.give.length === 0, 'no kind of 3'); continue; }
    const from = view.give[0], to = from === 'dew' ? 'powder' : 'dew';
    assert(!rtShopSwap(shop, from, from).ok, 'the same kind refused');
    const step = rtShopSwap(shop, from, to);
    assert(step.ok && step.run.materials[from] === shop.materials[from] - 3 && step.run.materials[to] === shop.materials[to] + 2 && step.run.swapped === true, 'swapped');
    assert(!rtShopSwapView(step.run)!.available && !rtShopSwap(step.run, to, from).ok && same(parseRtRun(serializeRtRun(step.run)), step.run), 'once; the save');
    swaps++;
  }
  assert(swaps >= 3, `swaps ${swaps}`);
});

check('the quest «Вернись с 10 ресурсами»: done with 10+ resources at the end (what «Повозка» sent counts), not done with fewer; the flags of his levels', () => {
  for (const [level, shop, swap] of [[1, 1, false], [2, 1, true], [3, 2, true]] as const) {
    const flags = gamblerCamp(level).hearthStart(seedOf(1)).flags;
    assert(flags.shopRerolls === shop && !!flags.swap === swap, `level ${level}: ${JSON.stringify(flags)}`);
  }
  const results: boolean[] = [];
  for (const [k, loot] of [[3, 0], [4, 6]] as const) {
    const store = gamblerCamp(1, true), start = store.hearthStart(seedOf(k));
    assert(same(start.flags.quest, { npc: 'gambler', id: 'gambler-hoard' }), 'his quest');
    const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: start.flags }, loot, loseAt: (run: RtRunState) => run.battles.length >= 4 });
    const end = store.endRunMeta(walk.run)!, total = stockTotal(walk.run.materials) + (walk.run.cart?.n ?? 0);
    assert(end.quest?.npc === 'gambler' && end.quest.done === total >= RT_GAMBLER_HOARD, `seed ${k}: ${total} resources — done ${end.quest?.done}`);
    results.push(end.quest.done);
    assert(store.hearth().done.gambler === (end.quest.done ? 1 : undefined), 'counted for Шиш');
  }
  assert(same(results, [false, true]), `results ${results}`);
});

console.log(`hearth Шиш (51в): ${checks} checks passed`);
