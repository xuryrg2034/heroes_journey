/**
 * Task 41 «Три зелья», part Б (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 3): at most 3 healing potions in
 * hand. Node only: `npm run test:realtime-potion-cap`. Real commands:
 * - the run (`RtRunState.potionCap`): a new run takes the flag; a find, a merchant, a rest's craft and the gift's pick refuse the
 *   healing choice with a full hand (the option stays, «Рука полна»), other consumables still join; a reward's healing beyond the
 *   cap does not join (`items-capped`); a hand above the cap keeps what it holds; a save without the flag plays without a cap;
 * - the fight (`Params.potionCap`): the hero walking over a healing loot with a full hand leaves it on the floor (`lootRefused`),
 *   the chain refuses it (`handFull`), with room he picks it up; the fight replays from its journal to the same hash; params
 *   without the key (a journal before it) and with 0 pick it up as before; the telemetry's `abilities.capLeft`.
 */
import { registerArena } from '../sim/arenas';
import { objectRefusal, REFUSAL_TEXT } from '../sim/chain';
import type { Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, replay } from '../sim/simulation';
import type { ArenaObject, Enemy, WorldEvent } from '../sim/world';
import { createFightObserver } from '../telemetry/observe';
import {
  createRtRun, parseRtRun, rtArenaParams, rtChooseFind, rtHandFull, rtHandFullOffers, rtItemRefusal, rtPotionCap, rtRestCraft,
  rtRestView, rtRunParams, rtShopBuy, rtShopView, serializeRtRun, RT_ITEM_REFUSAL_TEXT, RT_POTION_CAP, type RtRunState, type RtRunStep,
} from './rtRun';
import { walkRun } from './metaWalk.testkit';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function ok(step: RtRunStep, what: string): RtRunState { if (!step.ok) throw new Error(`${what}: ${step.reason}`); return step.run; }

// ---- The run ----

/** The first state of a walk (run/metaWalk.testkit.ts: every screen chosen, the fights made up; seeds k = 1…) where `want` holds. */
function firstScreen(want: (run: RtRunState) => boolean, create: Parameters<typeof createRtRun>[1] = {}): RtRunState {
  for (let k = 1; k <= 40; k++) {
    let found: RtRunState | null = null;
    walkRun({ k, create: { gift: 'mini', ...create }, each: state => { if (!found && want(state)) found = structuredClone(state); } });
    if (found) return found;
  }
  throw new Error('no such screen in 40 seeds');
}
/** The hand set for a check (the state a run reaches by its finds and fights). */
const withHealing = (run: RtRunState, n: number): RtRunState => { const out = structuredClone(run); out.items.healing = n; return out; };

check('a new run takes the cap 3 (`potionCap`); it round-trips; the arena params carry it; a save without it loads with no cap', () => {
  const run = createRtRun(seedOf(1), { gift: 'mini' });
  assert(RT_POTION_CAP === 3 && run.potionCap === 3 && rtPotionCap(run) === 3, `the flag: ${run.potionCap}`);
  assert(same(parseRtRun(serializeRtRun(run)), run), 'round trip');
  const battle = { ...run, pending: null };
  assert(rtArenaParams(battle, rtRunParams(defaultParams())).potionCap === 3, 'the run passes its cap to the fight');
  const old = JSON.parse(serializeRtRun(run)) as Record<string, unknown>;
  delete old.potionCap;
  const loaded = parseRtRun(JSON.stringify(old))!;
  assert(loaded && loaded.potionCap === undefined && rtPotionCap(loaded) === null && serializeRtRun(loaded) === JSON.stringify(old), 'the old save loads byte for byte');
  assert(rtArenaParams(loaded, rtRunParams(defaultParams())).potionCap === 0, 'the old save plays no cap');
  assert(createRtRun(seedOf(1), { gift: 'mini', potionCap: 0 }).potionCap === undefined, 'the option 0: no flag');
  assert(parseRtRun(JSON.stringify({ ...old, potionCap: 0 })) === null && parseRtRun(JSON.stringify({ ...old, potionCap: 2.5 })) === null, 'a bad cap is no run');
});

check('a find with 3 potions: the healing option stays and is refused («Рука полна»), the hand stays 3; the bomb is taken; with 2 the healing joins', () => {
  const atFind = firstScreen(r => r.pending?.kind === 'find'), full = withHealing(atFind, 3);
  const options = (full.pending as Extract<RtRunState['pending'], { kind: 'find' }>).options;
  assert(options.includes('healing') && options.length === 3, `the offer stays: ${options}`);
  assert(rtHandFull(full) && rtItemRefusal(full, 'healing') === 'handFull' && rtItemRefusal(full, 'bomb') === null && rtHandFullOffers(full) === 1, 'the refusal for the view');
  const refused = rtChooseFind(full, 'healing');
  assert(!refused.ok && refused.reason === RT_ITEM_REFUSAL_TEXT.handFull && RT_ITEM_REFUSAL_TEXT.handFull === 'Рука полна', 'refused');
  assert(full.items.healing === 3 && full.pending?.kind === 'find', 'nothing changed');
  const bomb = ok(rtChooseFind(full, 'bomb'), 'bomb');
  assert(bomb.items.bomb === full.items.bomb + 1 && bomb.items.healing === 3, 'the bomb joins');
  const room = ok(rtChooseFind(withHealing(atFind, 2), 'healing'), 'healing with room');
  assert(room.items.healing === 3 && !rtItemRefusal(withHealing(atFind, 2), 'healing'), 'the healing joins up to the cap');
});

check('a run without the flag (a save before task 41, `potionCap: 0`): no cap — the healing of a find joins a hand of 3 and of 5', () => {
  const atFind = firstScreen(r => r.pending?.kind === 'find', { potionCap: 0 });
  for (const n of [3, 5]) {
    const run = ok(rtChooseFind(withHealing(atFind, n), 'healing'), 'healing');
    assert(run.items.healing === n + 1 && !rtHandFull(withHealing(atFind, n)), `${n} → ${run.items.healing}`);
  }
});

check('a hand above the cap (5, an old state) keeps what it holds; no healing joins until it is below 3', () => {
  const atFind = firstScreen(r => r.pending?.kind === 'find'), five = withHealing(atFind, 5);
  const other = (five.pending as Extract<RtRunState['pending'], { kind: 'find' }>).options.find(item => item !== 'healing')!;
  assert(!rtChooseFind(five, 'healing').ok && ok(rtChooseFind(five, other), 'other').items.healing === 5, 'kept, refused');
  assert(ok(rtChooseFind(withHealing(atFind, 2), 'healing'), 'below the cap').items.healing === 3, 'below 3 it joins again');
});

check('the merchant and the rest: the healing good and the healing recipe are shown refused with a full hand; buying and crafting them fail', () => {
  const atShop = firstScreen(r => r.pending?.kind === 'shop' && r.pending.stock.items.includes('healing'));
  const rich = withHealing(atShop, 3);
  for (const kind of Object.keys(rich.materials) as (keyof RtRunState['materials'])[]) rich.materials[kind] = 9;
  const good = rtShopView(rich)!.goods.find(g => g.item === 'healing')!;
  assert(!good.available && good.handFull === true && good.reason === 'Рука полна', `the good: ${JSON.stringify(good)}`);
  const buy = rtShopBuy(rich, good.id);
  assert(!buy.ok && buy.reason === 'Рука полна' && rtHandFullOffers(rich) >= 1, 'not bought');
  const roomGood = rtShopView(withHealing(rich, 2))!.goods.find(g => g.item === 'healing')!;
  assert(roomGood.available && !roomGood.handFull && ok(rtShopBuy(withHealing(rich, 2), roomGood.id), 'buy').items.healing === 3, 'with room it is sold');
  const atRest = firstScreen(r => r.pending?.kind === 'rest');
  const restFull = withHealing(atRest, 3);
  for (const kind of Object.keys(restFull.materials) as (keyof RtRunState['materials'])[]) restFull.materials[kind] = 4;
  const recipe = rtRestView(restFull)!.recipes.find(r => r.item === 'healing');
  assert(recipe && !recipe.available && recipe.handFull === true, `the recipe: ${JSON.stringify(recipe)}`);
  const craft = rtRestCraft(restFull, recipe.resource);
  assert(!craft.ok && craft.reason === 'Рука полна', 'not crafted');
  const other = rtRestView(restFull)!.recipes.find(r => r.item !== 'healing')!;
  assert(other.available && ok(rtRestCraft(restFull, other.resource), 'craft').items[other.item] === restFull.items[other.item] + 1, 'another recipe is crafted');
});

check('rewards count in the cap: the camp\'s start healing beside the start potion with the cap 1 does not join (`items-capped`); with the cap 3 it does', () => {
  const capped = createRtRun(seedOf(3), { gift: 'mini', locked: [], hearth: { startItems: ['healing'] }, potionCap: 1 });
  assert(capped.items.healing === 1, `cap 1: ${capped.items.healing}`);
  const roomy = createRtRun(seedOf(3), { gift: 'mini', locked: [], hearth: { startItems: ['healing'] } });
  assert(roomy.items.healing === 2 && roomy.potionCap === 3, `cap 3: ${roomy.items.healing}`);
});

// ---- The fight ----

registerArena({
  id: 'potion-cap-field', name: 'Поле зелий', summary: 'Тест предела зелий', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
/** A quiet fight with armour on and the elite loot opening a consumable (as lootOpens.spec.ts): no newcomers, nobody walks or touches. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.eliteArmor = true; p.elitePlates = 1; p.energyPerKill = 0; p.eliteLootOpens = true;
  return Object.assign(p, extra);
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
function hit(sim: Simulation, e: Enemy): WorldEvent[] {
  sim.command({ t: 'teleport', x: e.x - 2, y: 5 });
  sim.command({ t: 'begin', x: e.x, y: e.y });
  sim.command({ t: 'release' });
  return settle(sim);
}
/** An armoured elite at (x, 5) killed by two chains (the plate, then the kill after the clean second): the healing loot it dropped, if any. */
function healingDrop(sim: Simulation, x: number): ArenaObject | null {
  const id = sim.command({ t: 'place', x, y: 5, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
  const e = sim.world.enemies.find(en => en.id === id)!;
  hit(sim, e); ticks(sim, 90);
  if (!e.armor?.open) return null;
  const drops = hit(sim, e).filter((ev): ev is Extract<WorldEvent, { type: 'loot' }> => ev.type === 'loot' && !ev.picked && ev.loot === 'healing');
  return drops.length ? sim.world.objects.find(o => o.id === drops[0].objectId) ?? null : null;
}
/** A fight of the field with `params` whose first elite dropped a healing loot (seeds k = 1…), the hero away from it, 3 potions in hand. */
function fieldWithHealing(params: Params): { sim: Simulation; loot: ArenaObject; k: number } {
  for (let k = 1; k <= 60; k++) {
    const sim = new Simulation({ arena: 'potion-cap-field', params: structuredClone(params), seed: seedOf(k), record: true, loadout: {} as Loadout });
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const loot = healingDrop(sim, 9);
    if (!loot) continue;
    sim.command({ t: 'teleport', x: 4.5, y: 9 });
    sim.command({ t: 'items', kind: 'healing', count: 3 });
    ticks(sim, 2);
    return { sim, loot, k };
  }
  throw new Error('no healing drop in 60 seeds');
}

check('a fight with `potionCap` 3 and 3 potions: walking over the healing loot leaves it on the floor (`lootRefused`), the chain refuses it («рука полна»); with 2 he picks it up; the journal replays to the same hash', () => {
  const { sim, loot } = fieldWithHealing(quiet({ potionCap: 3 })), w = sim.world;
  const observer = createFightObserver(w);
  sim.command({ t: 'teleport', x: loot.x, y: loot.y });
  const events: WorldEvent[] = [];
  for (let i = 0; i < 30; i++) { sim.tick(); observer.tick(w); events.push(...w.events); w.events.length = 0; }
  assert(w.objects.includes(loot) && w.kit!.items.healing === 3, `left on the floor: ${w.kit!.items.healing}`);
  assert(events.some(e => e.type === 'lootRefused' && e.objectId === loot.id) && !events.some(e => e.type === 'loot' && e.picked), 'refused, not picked');
  assert(observer.summary().abilities.capLeft === 1, `capLeft ${observer.summary().abilities.capLeft}`);
  sim.command({ t: 'teleport', x: loot.x - 2, y: loot.y });
  assert(objectRefusal(w, loot) === 'handFull' && REFUSAL_TEXT.handFull === 'рука полна', `the chain: ${objectRefusal(w, loot)}`);
  sim.command({ t: 'begin', x: loot.x, y: loot.y });
  assert(!w.chain.some(l => l.kind === 'object' && l.id === loot.id), 'the chain does not take it');
  sim.command({ t: 'cancel' });
  sim.command({ t: 'items', kind: 'healing', count: 2 });
  assert(objectRefusal(w, loot) === null, 'with room the chain may take it');
  sim.command({ t: 'teleport', x: loot.x, y: loot.y });
  ticks(sim, 2);
  assert(!w.objects.includes(loot) && w.kit!.items.healing === 3, `picked with room: ${w.kit!.items.healing}`);
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'the fight replays from its journal');
});

check('the chain counts the healing loot already in it: with 2 potions two healing loots — the first may join the chain, the second is refused', () => {
  const { sim, loot } = fieldWithHealing(quiet({ potionCap: 3 })), w = sim.world;
  sim.command({ t: 'items', kind: 'healing', count: 2 });
  const second = healingDrop(sim, 11);
  assert(second, 'a second healing loot');
  sim.command({ t: 'teleport', x: loot.x - 1.5, y: loot.y });
  sim.command({ t: 'begin', x: loot.x, y: loot.y });
  assert(w.chain.some(l => l.kind === 'object' && l.id === loot.id), 'the first joins');
  assert(objectRefusal(w, second) === 'handFull', `the second with 2 + 1 in the chain: ${objectRefusal(w, second)}`);
  sim.command({ t: 'cancel' });
  sim.command({ t: 'items', kind: 'healing', count: 1 });
  sim.command({ t: 'begin', x: loot.x, y: loot.y });
  assert(objectRefusal(w, second) === null, `the second with 1 + 1 in the chain: ${objectRefusal(w, second)}`);
});

check('params without the key (a journal before task 41) and `potionCap: 0`: the healing loot is picked up with 3 potions as before', () => {
  const noKey = quiet() as Partial<Params>;
  delete noKey.potionCap;
  for (const params of [noKey as Params, quiet({ potionCap: 0 })]) {
    const { sim, loot } = fieldWithHealing(params), w = sim.world;
    sim.command({ t: 'teleport', x: loot.x, y: loot.y });
    ticks(sim, 2);
    assert(!w.objects.includes(loot) && w.kit!.items.healing === 4, `picked: ${w.kit!.items.healing} (key ${'potionCap' in w.params})`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replays');
  }
});

console.log(`realtime-potion-cap: ${checks} checks passed`);
