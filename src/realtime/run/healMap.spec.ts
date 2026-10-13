/**
 * Task 15 «Лечение на карте» (run/rtRun.ts `healOffer`, `healOnMap`, `healVisible`; docs/realtime-slice.md, section 3). Node
 * only: `npm run test:realtime-heal-map`.
 *
 * The run goes by its own commands. Its arenas are real fights (journalled commands on the quiet test field of
 * runFight.testkit.ts): the hero loses HP to a touch, and the door's bag (task 14, from run row 2) pays the resources the
 * heal costs. Checks:
 * - between fights the map heal costs 2, then 3, then 4 resources over three purchases (fights in between), +2 HP each, paid
 *   as the merchant is paid (`shopPayment`: the most numerous kinds first); a reload in the middle keeps the price step;
 * - full HP — not ok (`full`), nothing changes; too few resources — not ok (`poor`, `need`, `have`), nothing changes;
 * - the heal stops at the maximum: one HP short gives +1 and costs the full price;
 * - not between fights (a node screen open, the run over) — not ok (`closed`); the button is shown only with ≥ 1 resource;
 * - a save before the rule (no flag `healMap`; fixture of 12.10.2026) has no map heal (`off`) and saves byte for byte as
 *   before; malformed fields are no run;
 * - telemetry: the purchases are in the run record (`mapHeals`: row, price, HP before and after), the node's HP out is left
 *   as the node left it.
 * The test sets resources or HP by hand only where it says so (a case the real walk does not reach on its own).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import {
  createRtRun, healOffer, healOnMap, healVisible, parseRtRun, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, rtResourceTotal,
  rtRunParams, serializeRtRun, RT_BAG_ROW, RT_HEAL_MAP_GAIN, RT_HEAL_MAP_PRICE, type RtRunState, type RtRunStep,
} from './rtRun';
import { runRow } from './arenaPools';
import { RESOURCE_KINDS } from '../forest/resources';
import { shopPayment } from '../forest/merchant';
import { defaultParams } from '../sim/params';
import type { Simulation } from '../sim/simulation';
import { createFightObserver } from '../telemetry/observe';
import { RtRecorder, type SessionStore } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { assert, closeNode, ok, playFight, quiet, same, seedOf, takeGift } from './runFight.testkit';
import before from '../../../tests/fixtures/rt-run-save-before-reroll.json';

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }

const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back, 'the save loads'); return back; };
const bossBattle = (run: RtRunState): boolean => run.pending?.kind === 'battle' && ['checkpoint', 'boss'].includes(rtNode(run, run.pending.nodeId)!.type);
const battleRow = (run: RtRunState): number => run.pending?.kind === 'battle' ? runRow(rtNode(run, run.pending.nodeId)!.row) : 0;
/** Closes a screen with a simple choice (runFight.testkit.ts `closeNode`: a rest heals; each fight below hurts the hero after it). */
const close = closeNode;
/** Closes the screens until the map (no screen open) or a battle. */
function toMap(run: RtRunState): RtRunState {
  for (let i = 0; i < 20 && run.pending && run.pending.kind !== 'battle' && !run.result; i++) run = close(run);
  return run;
}

/**
 * The hero is touched (journalled: the touch on, one enemy on the hero) until its HP is at most `target`, then the field is
 * cleared and the touch off again.
 */
function hurt(sim: Simulation, target: number): void {
  if (sim.world.hero.hp <= target) return;
  sim.command({ t: 'param', key: 'contactDamage', value: 1 });
  sim.command({ t: 'place', x: sim.world.hero.x, y: sim.world.hero.y, color: 1, hp: 0, kind: 'basic' });
  for (let i = 0; i < 60 * 60 && sim.world.hero.hp > target && sim.world.status === 'playing'; i++) { sim.tick(); sim.world.events.length = 0; }
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'param', key: 'contactDamage', value: 0 });
  assert(sim.world.hero.hp <= target && sim.world.hero.hp >= 1, `the hero was hurt to ${sim.world.hero.hp} (≤ ${target})`);
}

/** The open battle won on the quiet field: hurt to HP ≤ `target`, the goals, `kills` after them (35 fill the bag: 6 resources). */
function win(run: RtRunState, k: number, target: number, kills: number): RtRunState {
  const chains = Array.from({ length: Math.ceil(kills / 5) }, () => 5);
  const { outcome } = playFight(run, { chains, k, params: rtRunParams(quiet()), start: sim => { hurt(sim, target); sim.command({ t: 'goals' }); } });
  return ok(resolveArena(run, outcome), 'resolve');
}

/**
 * The run walks by its own commands (battle nodes first) to its next open battle with the bag (run row 2 or later, not the
 * Jailer's or the final one); the battles before it are won on the quiet field without a hurt.
 */
function toBagBattle(run: RtRunState, k: number): RtRunState {
  for (let i = 0; i < 300 && !run.result; i++) {
    run = toMap(run);
    if (run.pending?.kind === 'battle') {
      if (battleRow(run) >= RT_BAG_ROW && !bossBattle(run)) return run;
      run = win(run, k, run.maxHp, 10);
      continue;
    }
    const next = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (next.find(n => n.type === 'battle') ?? next.find(n => n.type !== 'rest') ?? next[0]).id), 'enter');
  }
  throw new Error('no battle with the bag');
}

/** One map heal, checked against the state before it: the price, HP, the payment, the event, nothing else changed. */
function buy(run: RtRunState, price: number): RtRunState {
  const offer = healOffer(run), gain = Math.min(RT_HEAL_MAP_GAIN, run.maxHp - run.hp);
  assert(offer.ok && offer.price === price && offer.gain === gain && offer.have === rtResourceTotal(run) && offer.reason === undefined && offer.need === undefined, `the offer: ${JSON.stringify(offer)} (price ${price})`);
  assert(healVisible(run), 'the button is shown');
  const text = serializeRtRun(run);
  const step = healOnMap(run);
  assert(step.ok, `bought: ${step.ok ? '' : step.reason}`);
  assert(serializeRtRun(run) === text, 'the run before is not changed');
  const after = step.run, paid = shopPayment(run.materials, price);
  assert(after.hp === Math.min(run.maxHp, run.hp + RT_HEAL_MAP_GAIN) && after.hp === run.hp + gain && after.maxHp === run.maxHp, `HP ${run.hp} → ${after.hp}`);
  assert(RESOURCE_KINDS.every(kind => after.materials[kind] === run.materials[kind] - paid[kind]) && rtResourceTotal(after) === rtResourceTotal(run) - price, `paid ${price} by the merchant's rule: ${JSON.stringify(run.materials)} → ${JSON.stringify(after.materials)}`);
  // The merchant's rule: each unit from the kind held most then (not just any `price` units).
  const most = RESOURCE_KINDS.reduce((best, next) => run.materials[next] > run.materials[best] ? next : best, RESOURCE_KINDS[0]);
  assert(paid[most] >= 1, `the most numerous kind (${most}) pays first`);
  assert(after.healBought === (run.healBought ?? 0) + 1, `the count ${after.healBought}`);
  const node = run.currentNodeId ? rtNode(run, run.currentNodeId) : undefined;
  assert(step.events.length === 1 && same(step.events[0], { type: 'map-healed', nodeId: run.currentNodeId, row: node ? runRow(node.row) : 0, price, paid, hpBefore: run.hp, hpAfter: after.hp }), `the event ${JSON.stringify(step.events)}`);
  const rest = (r: RtRunState) => serializeRtRun({ ...r, hp: 0, materials: { ...r.materials, dew: 0, powder: 0, resin: 0, herbs: 0 }, healBought: 0 });
  assert(rest(after) === rest(run), 'nothing else changes');
  return after;
}

/** A refused map heal leaves the run as it was. */
function refused(run: RtRunState, reason: string, step: RtRunStep = healOnMap(run)): void {
  const text = serializeRtRun(run);
  assert(!step.ok && step.reason === reason, `refused: ${step.ok ? 'bought' : step.reason}`);
  assert(serializeRtRun(run) === text, 'nothing changes');
}

const runs: { k: number; run: RtRunState }[] = [];

await check('three map heals between real fights cost 2, 3, 4 resources (the merchant\'s payment), +2 HP each; a reload keeps the price step — 3 seeds', () => {
  for (const k of [1, 2, 3]) {
    let run = toBagBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini' })), k);
    assert(run.healMap === true && run.healBought === undefined, 'a new run has the flag and no purchase yet');
    // Fight 1: hurt to 5 below the maximum; 35 kills after the goals — the bag pays 6.
    const before1 = rtResourceTotal(run);
    run = toMap(win(run, k, run.maxHp - 5, 35));
    assert(!run.pending && !run.result && rtResourceTotal(run) >= before1 + 6 && run.hp <= run.maxHp - 5, `seed ${k}: back on the map, HP ${run.hp}/${run.maxHp}, resources ${rtResourceTotal(run)}`);
    run = buy(run, RT_HEAL_MAP_PRICE);
    run = buy(run, RT_HEAL_MAP_PRICE + 1);
    assert(run.healBought === 2 && healOffer(run).price === 4, 'the third costs 4');
    // A reload keeps the step: the same offer, and the next fight and purchase go as without it.
    const back = reload(run);
    assert(same(healOffer(back), healOffer(run)) && back.healBought === 2, 'the reload keeps the price');
    // Fight 2 (the bag again; the hero hurt below the maximum by 3 or more).
    const play = (r: RtRunState): RtRunState => toMap(win(toBagBattle(r, k), k, r.maxHp - 3, 35));
    const on = play(run), onBack = play(back);
    assert(serializeRtRun(on) === serializeRtRun(onBack), 'the run after a reload goes on byte for byte');
    const third = buy(on, RT_HEAL_MAP_PRICE + 2);
    assert(serializeRtRun(third) === serializeRtRun(buy(onBack, 4)) && third.healBought === 3, 'the third purchase: 4, the same after a reload');
    assert(healOffer(third).price === 5, 'the next would cost 5');
    runs.push({ k, run: third });
  }
});

await check('full HP: not ok (`full`), the price shown, nothing changes; the button still shows with resources', () => {
  // A fresh run (15 / 15) after its gift; resources by hand (the run has none before row 2's bag).
  const run = takeGift(createRtRun(seedOf(4), { gift: 'mini' }));
  const rich = { ...run, materials: { ...run.materials, resin: 5 } };
  assert(rich.hp === rich.maxHp, 'full HP');
  const offer = healOffer(rich);
  assert(!offer.ok && offer.reason === 'full' && offer.gain === 0 && offer.price === RT_HEAL_MAP_PRICE && offer.have === 5 && offer.need === undefined, `full: ${JSON.stringify(offer)}`);
  assert(healVisible(rich), 'shown (off) with resources');
  refused(rich, 'Здоровье полное');
  // Healed up to the maximum by the map heal itself: then full.
  for (const { run: r } of runs) {
    let x: RtRunState = { ...r, materials: { ...r.materials, dew: r.materials.dew + 40 } }, price = healOffer(x).price;
    while (x.hp < x.maxHp) { x = buy(x, price); price++; }
    assert(healOffer(x).reason === 'full' && x.hp === x.maxHp, 'full after the heals');
    refused(x, 'Здоровье полное');
  }
});

await check('too few resources: not ok (`poor`) with `need` and `have`, nothing changes; no resources — no button', () => {
  for (const { k, run } of runs) {
    // After three purchases the price is 5; leave 4 resources (by hand), the HP of the real fight.
    const poor: RtRunState = { ...run, hp: Math.min(run.hp, run.maxHp - 2), materials: { dew: 1, powder: 3, resin: 0, herbs: 0 } };
    const offer = healOffer(poor);
    assert(!offer.ok && offer.reason === 'poor' && offer.need === 5 && offer.have === 4 && offer.price === 5 && offer.gain === 2, `seed ${k}: ${JSON.stringify(offer)}`);
    assert(healVisible(poor), 'shown (off) with 4 resources');
    refused(poor, 'Нужно ресурсов: 5, есть 4');
    const none: RtRunState = { ...poor, materials: { dew: 0, powder: 0, resin: 0, herbs: 0 } };
    assert(healOffer(none).reason === 'poor' && healOffer(none).have === 0 && !healVisible(none), 'no resources: no button');
    const one: RtRunState = { ...none, materials: { ...none.materials, herbs: 1 } };
    assert(healVisible(one), 'one resource: the button shows');
  }
});

await check('the heal stops at the maximum: one HP short gives +1 and costs the full price', () => {
  for (const { k, run } of runs) {
    // One HP short of the maximum (HP by hand), the price 5 after three purchases, 7 resources.
    const short: RtRunState = { ...run, hp: run.maxHp - 1, materials: { dew: 3, powder: 0, resin: 4, herbs: 0 } };
    const offer = healOffer(short);
    assert(offer.ok && offer.gain === 1 && offer.price === 5, `seed ${k}: ${JSON.stringify(offer)}`);
    const after = buy(short, 5);
    assert(after.hp === after.maxHp && rtResourceTotal(after) === 2 && same(after.materials, { dew: 1, powder: 0, resin: 1, herbs: 0 }), `seed ${k}: HP ${after.hp}, ${JSON.stringify(after.materials)}`);
    assert(healOffer(after).reason === 'full' && healOffer(after).price === 6, 'then full; the step went on');
  }
});

await check('not between fights (a screen open, the run over): not ok (`closed`), no button', () => {
  let run = takeGift(createRtRun(seedOf(5), { gift: 'mini' }));
  run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  assert(run.pending?.kind === 'battle', 'a battle is open');
  const open: RtRunState = { ...run, hp: run.maxHp - 4, materials: { ...run.materials, dew: 9 } };
  assert(healOffer(open).reason === 'closed' && !healOffer(open).ok && !healVisible(open), `open battle: ${JSON.stringify(healOffer(open))}`);
  refused(open, 'Лечение — между боями, на карте.');
  // The run lost (a real lost fight): over.
  const lost = ok(resolveArena(run, playFight(run, { chains: [3], k: 5, lose: true }).outcome), 'lose');
  const over: RtRunState = { ...lost, hp: 1, materials: { ...lost.materials, dew: 9 } };
  assert(over.result?.outcome === 'defeat' && healOffer(over).reason === 'closed' && !healVisible(over), 'the run is over');
  refused(over, 'Лечение — между боями, на карте.');
});

await check('a save before the rule (no flag; fixture of 12.10.2026) has no map heal (`off`) and saves byte for byte as before', () => {
  for (const text of [before.hard, before.event]) {
    const old = parseRtRun(text);
    assert(old && old.healMap === undefined && serializeRtRun(old) === text, 'the old save loads and saves byte for byte');
    // On the map (its open screen closed), with resources and HP short.
    const map = toMap(old);
    assert(!map.pending && !map.result, 'on the map');
    const want: RtRunState = { ...map, hp: Math.max(1, map.maxHp - 6), materials: { ...map.materials, dew: map.materials.dew + 10 } };
    const offer = healOffer(want);
    assert(!offer.ok && offer.reason === 'off' && !healVisible(want), `no map heal: ${JSON.stringify(offer)}`);
    refused(want, 'В этом походе нет лечения на карте.');
    const saved = serializeRtRun(map);
    assert(!saved.includes('healMap') && !saved.includes('healBought'), 'its saves gain no field');
  }
  const without = takeGift(createRtRun(seedOf(6), { gift: 'mini', healMap: false }));
  assert(without.healMap === undefined && healOffer({ ...without, hp: 3, materials: { ...without.materials, dew: 9 } }).reason === 'off', 'a run created without the flag: off');
  assert(!serializeRtRun(without).includes('healMap'), 'its save has no field');
});

await check('a save keeps the flag and the count; malformed fields are no run', () => {
  const { run } = runs[0];
  const text = serializeRtRun(run), back = parseRtRun(text)!;
  assert(back.healMap === true && back.healBought === 3 && serializeRtRun(back) === text, 'kept');
  const bad = (patch: Record<string, unknown>, drop: string[] = []): boolean => {
    const value: Record<string, unknown> = { ...JSON.parse(text), ...patch };
    for (const key of drop) delete value[key];
    return parseRtRun(JSON.stringify(value)) === null;
  };
  assert(bad({ healMap: false }) && bad({ healMap: 1 }) && bad({ healMap: false }, ['healBought']) && bad({ healMap: 'yes' }, ['healBought']), 'the flag is true or absent (with or without a count)');
  assert(bad({ healBought: 0 }) && bad({ healBought: -1 }) && bad({ healBought: 1.5 }) && bad({ healBought: '3' }), 'the count is 1 or more');
  assert(bad({}, ['healMap']), 'a count needs the flag');
  assert(!bad({}, ['healBought']) && !bad({ healBought: 1 }), 'no count, or any count ≥ 1, loads');
});

await check('telemetry: the purchases are in the run record (`mapHeals`), the record passes the check; the node\'s HP out stays', async () => {
  const fake = (): KeyValueStore => {
    const map = new Map<string, string>();
    return { getItem: k => map.get(k) ?? null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, setItem: (k, v) => { map.set(k, v); } };
  };
  const sessionFake = (): SessionStore => { const map = new Map<string, string>(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } }; };
  const local = fake();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: rtRunParams(defaultParams()), observer: createFightObserver, local, sessionStore: sessionFake(), channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const k = 7;
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  rec.runStarted(null, run);
  const latest = async (): Promise<RunRecord> => { await new Promise(r => setTimeout(r, 10)); return (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run' && r.seed === run.seed).pop()!; };
  const feed = (step: RtRunStep): void => { assert(step.ok, step.ok ? '' : step.reason); rec.runStep(run, step); run = step.run; };
  // The walk by the run's commands, fed to the recorder (as the view does), to the first bag fight and through it.
  for (let i = 0; i < 300 && !(run.pending?.kind === 'battle' && battleRow(run) >= RT_BAG_ROW && !bossBattle(run)); i++) {
    if (run.pending?.kind === 'battle') feed(resolveArena(run, playFight(run, { chains: [5, 5], k, params: rtRunParams(quiet()), start: s => { s.command({ t: 'goals' }); } }).outcome));
    else if (run.pending) feed({ ok: true, run: close(run), events: [] });
    else { const next = rtAvailableNodes(run); feed(rtEnterNode(run, (next.find(n => n.type === 'battle') ?? next[0]).id)); }
  }
  const { outcome } = playFight(run, { chains: [5, 5, 5, 5, 5, 5, 5], k, params: rtRunParams(quiet()), start: sim => { hurt(sim, run.maxHp - 5); sim.command({ t: 'goals' }); } });
  feed(resolveArena(run, outcome));
  while (run.pending && run.pending.kind !== 'battle') feed({ ok: true, run: close(run), events: [] });
  const nodeRec = await latest(), lastVisit = nodeRec.nodes[nodeRec.nodes.length - 1], hpOut = lastVisit.hpOut;
  assert(nodeRec.mapHeals === undefined && checkRecord(nodeRec) === null, 'no purchase yet: no field');
  const row = runRow(rtNode(run, run.currentNodeId!)!.row), hp0 = run.hp;
  feed(healOnMap(run)); feed(healOnMap(run));
  const r = await latest();
  assert(checkRecord(r) === null, `the record passes: ${checkRecord(r)}`);
  assert(same(r.mapHeals, [{ row, price: 2, hpBefore: hp0, hpAfter: hp0 + 2 }, { row, price: 3, hpBefore: hp0 + 2, hpAfter: hp0 + 4 }]), `mapHeals ${JSON.stringify(r.mapHeals)}`);
  assert(r.nodes[r.nodes.length - 1].hpOut === hpOut && r.kit.hp === hp0 + 4, `the node's HP out stays ${hpOut}; the kit has ${r.kit.hp}`);
  assert(checkRecord({ ...r, mapHeals: [{ row, price: 0, hpBefore: 3, hpAfter: 5 }] }) === 'run mapHeals' && checkRecord({ ...r, mapHeals: {} }) === 'run mapHeals', 'malformed mapHeals are refused');
  rec.dispose();
});

console.log(`heal map: ${checks} checks ok`);
