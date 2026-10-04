/**
 * Long random streams of a run (runStreams.ts, docs/roguelike-runs.md, «Долгие потоки случайности»): checked through real
 * run commands on generated maps. Battles start in the real engine and end with its debug win (this suite checks the
 * run, not a bot's victory); resources are left in the battle's materials before the win, as a real battle could. Seeds
 * are spread with Math.imul(k, 2654435761).
 *
 * - the same seed and the same actions give the same run, every roll included;
 * - a reload at any point changes nothing that comes later;
 * - streams are independent: a purchase at the merchant or another event option does not move the next talisman offer,
 *   the battle picks or the next merchant;
 * - a preview of the map spends nothing; the battle seed still comes from the run seed and the node id;
 * - a save from before the streams keeps its node-seeded rolls; forged counters are rejected.
 */
import { ForestEngine } from './forestEngine';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventView, forestNodeSeed, forestRunMap, forestRunView,
  parseForestRun, resolveBattle, restHeal, serializeForestRun, shopBuy, shopLeave, shopView, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { talismanOffer } from './run/talismanOffers';
import { emptyMaterials } from './resources';
import { RUN_STREAMS } from './run/runStreams';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };

/** Win the open battle in the engine; the battle leaves `loot` resources (as elite loot or a chest could). */
function winBattle(run: ForestRunState, loot = 2): ForestRunState {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  e.state.materials = { ...emptyMaterials(), dew: loot, powder: 1 };
  e.winLevel();
  return ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${run.pending?.nodeId}`);
}
interface Policy {
  /** Which available node to enter at step `n` (index into availableNodes). */
  route(run: ForestRunState, n: number): string;
  /** Merchant: buy these goods (ids of shopView) while available, then leave. */
  shop?: (run: ForestRunState) => string[];
  /** Event: the option to take (the first available by default). */
  event?: (run: ForestRunState) => string;
}
/** Finish whatever is open: battles won, finds take the first, talismans the first option, rests heal, merchants per policy. */
function settle(run: ForestRunState, policy: Policy): ForestRunState {
  for (let guard = 0; run.pending && guard < 20; guard++) {
    const pending = run.pending;
    if (pending.kind === 'battle') run = winBattle(run);
    else if (pending.kind === 'find') run = ok(chooseFindItem(run, pending.options[0]), 'find');
    else if (pending.kind === 'talisman') run = ok(chooseTalisman(run, pending.options[0]), 'talisman');
    else if (pending.kind === 'rest') run = ok(restHeal(run), 'rest');
    else if (pending.kind === 'event') {
      const view = eventView(run)!, id = policy.event?.(run) ?? view.options.find(option => option.available)!.id;
      run = ok(chooseEventOption(run, id), 'event');
    } else if (pending.kind === 'shop') {
      for (const id of policy.shop?.(run) ?? []) if (shopView(run)!.goods.find(good => good.id === id)?.available) run = ok(shopBuy(run, id), `buy ${id}`);
      run = ok(shopLeave(run), 'leave');
    } else throw new Error(`unexpected pending ${(pending as { kind: string }).kind}`);
  }
  return run;
}
/** Walk a whole run with the policy; `reload` round-trips the save after every step (and checks it is unchanged). */
function play(seed: number, policy: Policy, reload = false): ForestRunState[] {
  let run = createForestRun(seed, { map: 'generated', skipTrunk: true });
  const steps = [run];
  for (let n = 0; !run.result && n < 30; n++) {
    run = settle(ok(enterNode(run, policy.route(run, n)), 'enter'), policy);
    if (reload) {
      const loaded = roundTrip(run);
      assert(loaded && json(loaded) === json(run), `seed ${seed}, step ${n}: the save reloads unchanged`);
      run = loaded;
    }
    steps.push(run);
  }
  assert(run.result?.outcome === 'victory', `seed ${seed}: the walk ends with a boss victory`);
  return steps;
}
/** A route by the seed and the step: different seeds walk different paths. */
const spreadRoute = (seed: number): Policy['route'] => (run, n) => { const list = availableNodes(run); return list[spread(seed ^ (n + 1)) % list.length].id; };
const buyAll: Policy['shop'] = run => shopView(run)!.goods.filter(good => good.good !== 'talisman').map(good => good.id);

/** The same seed and the same actions give the same run; a reload after every step changes nothing later. */
function sameSeedSameRun() {
  let shops = 0, events = 0, offers = 0;
  for (let k = 1; k <= 10; k++) {
    const seed = spread(k), policy: Policy = { route: spreadRoute(seed), shop: buyAll };
    const first = play(seed, policy), again = play(seed, policy), reloaded = play(seed, policy, true);
    assert(json(first) === json(again), `seed ${k}: the same actions give the same run at every step`);
    assert(json(first.at(-1)) === json(reloaded.at(-1)), `seed ${k}: reloading after every step gives the same run`);
    const end = first.at(-1)!;
    shops += end.streams!.merchant; events += end.streams!.events; offers += end.streams!.talismans;
    // Counters are the uses: pool battles and event nodes entered, offers made, merchants visited.
    assert(end.streams!.pool === end.picks.filter(pick => pick.battleId).length && end.streams!.merchant === end.shops.length
      && end.streams!.talismans === end.talismanChoices.length, `seed ${k}: every stream counts its uses`);
  }
  assert(shops > 0 && events > 0 && offers >= 10, `the walks met merchants (${shops}), events (${events}) and offers (${offers})`);
  console.log(`PASS the same seed and actions give the same run; a reload after every step changes nothing (10 seeds: ${shops} merchants, ${events} events, ${offers} offers)`);
}

/** A reload in the middle of an open node (merchant with purchases, event, talisman choice) keeps every later roll. */
function reloadInsideNodes() {
  let checked = 0;
  for (let k = 11; k <= 40 && checked < 12; k++) {
    const seed = spread(k), route = spreadRoute(seed);
    let run = createForestRun(seed, { map: 'generated', skipTrunk: true });
    for (let n = 0; !run.result && n < 30; n++) {
      run = ok(enterNode(run, route(run, n)), 'enter');
      if (run.pending?.kind === 'battle') run = winBattle(run);
      if (run.pending && run.pending.kind !== 'battle') {
        const reloaded = roundTrip(run)!;
        assert(reloaded && json(reloaded) === json(run), `seed ${k}: the open ${run.pending.kind} reloads unchanged`);
        const policy: Policy = { route, shop: buyAll };
        assert(json(settle(reloaded, policy)) === json(settle(run, policy)), `seed ${k}: the open ${run.pending.kind} ends the same after a reload`);
        checked++;
      }
      run = settle(run, { route, shop: buyAll });
    }
  }
  assert(checked >= 12, `open nodes reloaded mid-way (${checked})`);
  console.log(`PASS a reload inside an open merchant, event or choice keeps the same rolls (${checked} open nodes)`);
}

/** Two runs of one seed on one path; `a` and `b` differ only in what they do at the merchant or the event. */
function divergent(seed: number, target: 'shop' | 'event', a: Partial<Policy>, b: Partial<Policy>) {
  const map = forestRunMap(createForestRun(seed, { map: 'generated', skipTrunk: true }));
  // A fixed path through a node of the type: at every step the first available node that still reaches one.
  const reaches = new Map<string, boolean>();
  const reach = (id: string): boolean => {
    if (!reaches.has(id)) reaches.set(id, map.node(id)!.type === target || map.node(id)!.next.some(reach));
    return reaches.get(id)!;
  };
  let met = false;
  const route: Policy['route'] = run => {
    const list = availableNodes(run), pick = (!met && list.find(node => reach(node.id))) || list[0];
    if (pick.type === target) met = true;
    return pick.id;
  };
  const walk = (policy: Partial<Policy>) => { met = false; return play(seed, { route, ...policy }); };
  return { a: walk(a), b: walk(b) };
}

/** Streams are independent: a merchant purchase or another event option moves nothing in the other streams. */
function independence() {
  let shopSeeds = 0, eventSeeds = 0;
  for (let k = 1; k <= 40 && (shopSeeds < 4 || eventSeeds < 4); k++) {
    const seed = spread(k), map = forestRunMap(createForestRun(seed, { map: 'generated', skipTrunk: true }));
    if (shopSeeds < 4 && map.nodes.some(node => node.type === 'shop' && node.row <= 8)) {
      // Buy everything but the talisman at the merchant, or buy nothing: the talisman shown there leaves the pool in both.
      const { a, b } = divergent(seed, 'shop', { shop: buyAll }, { shop: () => [] });
      const end = { a: a.at(-1)!, b: b.at(-1)! };
      if (end.a.shops.length && end.a.shops[0].bought.length && !end.b.shops[0].bought.length) {
        assert(json(end.a.talismanChoices) === json(end.b.talismanChoices) && json(end.a.talismansGone) === json(end.b.talismansGone), `seed ${k}: buying at the merchant leaves the next talisman and oath offers as they were`);
        assert(json(end.a.picks) === json(end.b.picks), `seed ${k}: buying at the merchant leaves the battles and events of the pools as they were`);
        assert(json({ ...end.a.streams }) === json({ ...end.b.streams }), `seed ${k}: a purchase draws from no stream`);
        shopSeeds++;
      }
    }
    if (eventSeeds < 4 && map.nodes.some(node => node.type === 'event')) {
      // Two different options of the first event: the outcome of the event differs, the other streams do not.
      const options = (run: ForestRunState) => eventView(run)!.options.filter(option => option.available).map(option => option.id);
      const { a, b } = divergent(seed, 'event', { event: run => options(run)[0], shop: () => [] }, { event: run => options(run).at(-1)!, shop: () => [] });
      const end = { a: a.at(-1)!, b: b.at(-1)! };
      if (end.a.eventChoices.length && end.a.eventChoices[0].option !== end.b.eventChoices[0].option) {
        assert(json(end.a.picks) === json(end.b.picks), `seed ${k}: another event option leaves the pool battles and later events as they were`);
        const offers = (run: ForestRunState) => run.talismanChoices.map(choice => choice.nodeId);
        assert(json(offers(end.a)) === json(offers(end.b)) && json(end.a.streams) === json(end.b.streams), `seed ${k}: another event option leaves the talisman and merchant streams as they were`);
        eventSeeds++;
      }
    }
  }
  assert(shopSeeds === 4 && eventSeeds === 4, `seeds with a merchant (${shopSeeds}) and an event (${eventSeeds}) checked`);
  console.log('PASS streams are independent: a merchant purchase or another event option leaves talisman offers, pool picks and the next merchant as they were (4 + 4 seeds)');
}

/** A preview of the map spends no draw; a battle's seed is still the run seed and the node id. */
function previewsAndBattles() {
  for (let k = 1; k <= 6; k++) {
    const seed = spread(k), run = createForestRun(seed, { map: 'generated', skipTrunk: true }), before = json(run);
    forestRunView(run); availableNodes(run); availableNodes(run);
    assert(json(run) === before, `seed ${k}: viewing the map spends no draw`);
    const shown = availableNodes(run)[0], entered = ok(enterNode(run, shown.id), 'enter');
    const pick = entered.picks.at(-1);
    assert(!pick || pick.battleId === (shown.content.kind === 'battle' ? shown.content.battleId : undefined) || pick.eventId === (shown.content.kind === 'event' ? shown.content.eventId : undefined),
      `seed ${k}: the node shows what it gets on entering`);
    if (entered.pending?.kind === 'battle') assert(entered.pending.seed === forestNodeSeed(seed, shown.id), `seed ${k}: the battle seed is the run seed and the node id`);
  }
  console.log('PASS map previews spend no draw and show what a node gets; the battle seed is the run seed and the node id');
}

/** Forged counters are rejected; a save from before the streams keeps its node-seeded rolls to its end. */
function saves() {
  const seed = spread(3), policy: Policy = { route: spreadRoute(seed), shop: buyAll }, run = play(seed, policy)[6];
  for (const stream of RUN_STREAMS) assert(forge(run, value => { value.streams[stream]++; }) === null, `a forged ${stream} counter is rejected`);
  assert(forge(run, value => { value.streams.extra = 0; }) === null && forge(run, value => { value.streams = []; }) === null, 'malformed counters are rejected');
  // A run started before the streams (no `streams` in its save) rolls by the node seed: its Jailer offers what the node seed gives.
  for (let k = 1; k <= 6; k++) {
    const old = createForestRun(spread(k), { map: 'generated', skipTrunk: true }); delete old.streams;
    let walked = old;
    const route = spreadRoute(spread(k));
    for (let n = 0; n < 30 && walked.pending?.kind !== 'talisman' && !walked.result; n++) {
      walked = ok(enterNode(walked, route(walked, n)), 'enter');
      if (walked.pending?.kind === 'battle') walked = winBattle(walked);
      if (walked.pending?.kind !== 'talisman') walked = settle(walked, { route, shop: () => [] });
    }
    const pending = walked.pending;
    assert(pending?.kind === 'talisman' && walked.streams === undefined, `seed ${k}: the old run reaches an offer without streams`);
    const expected = talismanOffer(forestNodeSeed(walked.seed, pending.nodeId), pending.source, { taken: walked.talismans, gone: walked.talismansGone, abilities: walked.tools.abilities });
    assert(json(pending.options) === json(expected), `seed ${k}: the old run's offer is rolled by the node seed`);
    assert(json(roundTrip(walked)) === json(walked), `seed ${k}: the old run saves and loads without streams`);
  }
  console.log('PASS forged stream counters are rejected; a save from before the streams keeps node-seeded rolls (6 seeds)');
}

sameSeedSameRun();
reloadInsideNodes();
independence();
previewsAndBattles();
saves();
