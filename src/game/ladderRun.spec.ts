/**
 * «Ступени клятвы», the run side (docs/roguelike-runs.md, section 6; ladder.ts): every change of the run on its step and
 * its absence one step lower, through real run commands — createForestRun, enterNode, battleSetup, the real engine with
 * the debug win, restHeal, the merchant — plus the profile (a victory on step N opens N+1), saves and determinism. The
 * battle side of the steps (2, 3, 4, 7, 8, 9 chest, 10) is checked in ladder.spec.ts; here the run hands the step to the
 * battle and the battle starts with it. Battles end with the engine's debug win: the run model is checked, never a bot's
 * victory. Seeds are spread with Math.imul(k, 2654435761).
 */
import { ForestEngine } from './forestEngine';
import { availableNodes, battleSetup, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventView, forestRunMap, parseForestRun,
  resolveBattle, restHeal, restView, serializeForestRun, shopBuy, shopLeave, shopView, type ForestRunEvent, type ForestRunState, type ForestRunStep } from './run/forestRun';
import { eventOption } from './run/forestEvents';
import { FOREST_REST_HEAL } from './run/forestMap';
import { createPlayerProfileStore, ladderAfterVictory, parsePlayerProfile, PLAYER_PROFILE_KEY, winsRun } from './run/playerProfile';
import type { RunStorage } from './run/forestRunStorage';
import { LADDER_GREED_RESOURCES, LADDER_MAX, LADDER_SHOP_MARKUP, LADDER_START_HP } from './ladder';
import { emptyMaterials } from './resources';
import { SHOP_HARDEN_PRICE, SHOP_HEAL_PRICE, SHOP_ITEM_PRICE } from './run/merchant';
import type { ResourceKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function ok(step: ForestRunStep, what: string): ForestRunState { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const roundTrip = (run: ForestRunState) => parseForestRun(serializeForestRun(run));
const forge = (run: ForestRunState, change: (value: any) => void) => { const value = JSON.parse(serializeForestRun(run)); change(value); return parseForestRun(JSON.stringify(value)); };
type Stock = Partial<Record<ResourceKind, number>>;

const TRUNK = ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4'];
const TO_CAMP_ELITE = [...TRUNK, 'goblin-archer', 'goblin-shield', 'goblin-shaman', 'trail-banners', 'jailer', 'camp-battle', 'camp-rest', 'camp-elite'];
const TO_CHIEF = [...TO_CAMP_ELITE, 'camp-breakthrough', 'camp-chief'];

/** Finish the open battle in the engine: `loot` resources and the cat's `hp` are left as a real battle could leave them. */
function winBattle(run: ForestRunState, options: { loot?: Stock; hp?: number } = {}): { run: ForestRunState; events: ForestRunEvent[] } {
  const e = new ForestEngine(); e.animationScale = 0;
  assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`);
  if (options.loot) e.state.materials = { ...emptyMaterials(), ...e.state.materials, ...options.loot };
  if (options.hp !== undefined) e.state.player.hp = options.hp;
  e.winLevel();
  const step = resolveBattle(run, e.runBattleOutcome()!);
  return { run: ok(step, `resolve ${run.pending?.nodeId}`), events: step.ok ? step.events : [] };
}
/**
 * Walk the authored graph through `ids` on `ladder`: battles won in the engine (`loot` by node, every battle leaving the
 * cat at `hp`), talisman choices refused, finds take the first item, rests on the way heal; the last id is only entered.
 */
function walk(seed: number, ladder: number, ids: string[], options: { loot?: Record<string, Stock>; hp?: number } = {}) {
  let run = createForestRun(seed, { ladder }), events: ForestRunEvent[] = [];
  ids.forEach((id, n) => {
    run = ok(enterNode(run, id), `enter ${id}`);
    if (n === ids.length - 1) return;
    if (run.pending?.kind === 'battle') ({ run, events } = winBattle(run, { loot: options.loot?.[id], hp: options.hp }));
    if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), `refuse at ${id}`);
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
    if (run.pending?.kind === 'rest') run = ok(restHeal(run), `heal at ${id}`);
  });
  return { run, events };
}

/** Step 1: hard battles on the map 1.5 times as often in the generator (the rules of the paths still hold); step 0 keeps the map. */
function stepOneMap() {
  let hard0 = 0, hard1 = 0, differ = 0;
  const SEEDS = Array.from({ length: 300 }, (_, k) => spread(k + 1));
  for (const seed of SEEDS) {
    const plain = createForestRun(seed, { map: 'generated' }), zero = createForestRun(seed, { map: 'generated', ladder: 0 }), one = createForestRun(seed, { map: 'generated', ladder: 1 });
    assert(json(zero) === json(plain) && zero.ladder === undefined, `${seed}: step 0 is the run without the ladder`);
    if (json(one.map) !== json(zero.map)) differ++;
    assert(json(createForestRun(seed, { map: 'generated', ladder: LADDER_MAX }).map) === json(one.map), `${seed}: higher steps keep the map of step 1`);
    hard0 += zero.map.kind === 'generated' ? zero.map.nodes.filter(node => node.type === 'hard').length : 0;
    hard1 += one.map.kind === 'generated' ? one.map.nodes.filter(node => node.type === 'hard').length : 0;
    // The rules of the paths hold on step 1: a rest 1–3 rows before every hard battle, no two in a row, a choice of risk per branch.
    const map = forestRunMap(one), walkFrom = (id: string): string[][] => { const node = map.node(id)!; return node.next.length ? node.next.flatMap(next => walkFrom(next).map(path => [id, ...path])) : [[id]]; };
    const routes = map.starts(true).flatMap(walkFrom).map(route => route.map(id => map.node(id)!));
    for (const route of routes) route.forEach((node, n) => {
      if (node.type !== 'hard') return;
      assert(route[n - 1].type !== 'hard' && route.slice(Math.max(0, n - 3), n).some(before => before.type === 'rest'), `${seed}: step 1 keeps a rest before ${node.id}`);
    });
    for (const branch of ['den', 'camp']) {
      const counts = routes.filter(route => route.some(node => node.lane === branch)).map(route => route.filter(node => node.type === 'hard').length);
      assert(counts.includes(0) && counts.some(count => count > 0), `${seed}: step 1 keeps a route with and without a hard battle in ${branch}`);
    }
  }
  assert(hard1 > hard0 * 1.25 && differ > SEEDS.length * 0.8, `step 1: hard battles ${hard0} → ${hard1} on ${SEEDS.length} maps, ${differ} maps differ`);
  console.log(`PASS step 1: hard battles ${hard0} → ${hard1} (×${(hard1 / hard0).toFixed(2)}) on ${SEEDS.length} maps; step 0 is the map without the ladder; the path rules hold`);
}

/** Step 5: the rest heals 1 less (a real rest after a battle that left the cat at 1 HP); step 4 heals in full. */
function stepFiveRest() {
  for (let k = 1; k <= 4; k++) {
    const seed = spread(k);
    for (const [ladder, heal] of [[4, FOREST_REST_HEAL], [5, FOREST_REST_HEAL - 1], [10, FOREST_REST_HEAL - 1]] as const) {
      const { run } = walk(seed, ladder, [...TRUNK, 'beast-wolf', 'trail-rest'], { hp: 1 });
      assert(run.pending?.kind === 'rest' && run.resources.player.hp === 1, `seed ${k}, step ${ladder}: the rest opens with the cat at 1 HP`);
      assert(restView(run)!.heal.value === heal, `seed ${k}, step ${ladder}: the rest offers +${heal}`);
      const healed = ok(restHeal(run), 'heal');
      assert(healed.resources.player.hp === 1 + heal && json(roundTrip(healed)) === json(healed), `seed ${k}, step ${ladder}: the rest healed ${heal}`);
    }
  }
  console.log(`PASS step 5: the rest heals ${FOREST_REST_HEAL - 1} instead of ${FOREST_REST_HEAL} (step 4 — in full)`);
}

/** Step 6: the run starts with 4 of 5 HP, and so does its first battle; step 5 starts with 5. */
function stepSixStart() {
  for (let k = 1; k <= 4; k++) {
    for (const [ladder, hp] of [[5, 5], [6, LADDER_START_HP], [9, LADDER_START_HP]] as const) {
      const run = createForestRun(spread(k), { map: 'generated', skipTrunk: true, ladder });
      assert(run.resources.player.hp === hp && run.resources.player.maxHp === 5, `seed ${k}, step ${ladder}: the run starts at ${hp}/5`);
      const entered = ok(enterNode(run, availableNodes(run)[0].id), 'enter the first battle');
      const e = new ForestEngine(); e.animationScale = 0;
      assert(e.startRunBattle(battleSetup(entered)!) && e.state.player.hp === hp && e.state.player.maxHp === 5, `seed ${k}, step ${ladder}: the first battle starts at ${hp}/5`);
      assert(json(roundTrip(entered)) === json(entered), `seed ${k}, step ${ladder}: the run saves`);
    }
  }
  console.log(`PASS step 6: the run and its first battle start at ${LADDER_START_HP}/5 HP (step 5 — 5/5)`);
}

const randomElites = (e: ForestEngine) => e.state.board.filter(cell => cell?.elite === 'random').length;
const authoredEliteHp = (e: ForestEngine) => [...new Set(e.state.board.filter(cell => cell?.elite === true))].reduce((sum, cell) => sum + cell!.hp, 0);
/** The engine at the start of the entered battle of `run`. */
function startOf(run: ForestRunState) { const e = new ForestEngine(); e.animationScale = 0; assert(e.startRunBattle(battleSetup(run)!), `${run.pending?.nodeId} starts`); return e; }

/**
 * The run hands the step to the battle: `ladder` and `hard` in the setup (step 3: the hard battle's authored elites
 * +1 HP; step 2 not), and step 8's greed — a hard battle entered with at least 6 resources starts with one more random
 * elite (not with 5, not on step 7, not in an ordinary battle).
 */
function battleHandOff() {
  for (let k = 1; k <= 3; k++) {
    const seed = spread(k);
    const at = (ladder: number, stock: number) => walk(seed, ladder, TO_CAMP_ELITE, { loot: { 'camp-battle': { dew: stock } } }).run;
    const zero = at(0, 6), setup0 = battleSetup(zero)!;
    assert(setup0.ladder === undefined && setup0.hard === true && !setup0.greedElite, `seed ${k}: step 0 hands no step (the hard node is marked)`);
    const two = startOf(at(2, 0)), three = at(3, 0), elites = new Set(two.state.board.filter(cell => cell?.elite === true)).size;
    assert(elites > 0 && battleSetup(three)!.ladder === 3 && authoredEliteHp(startOf(three)) === authoredEliteHp(two) + elites,
      `seed ${k}: step 3 raises each of the hard battle's ${elites} authored elites by 1 HP (step 2 does not)`);
    const greedy = at(8, LADDER_GREED_RESOURCES), short = at(8, LADDER_GREED_RESOURCES - 1), seven = at(7, LADDER_GREED_RESOURCES);
    assert(battleSetup(greedy)!.greedElite === true && randomElites(startOf(greedy)) === 1, `seed ${k}: step 8 with ${LADDER_GREED_RESOURCES} resources — one more random elite`);
    assert(!battleSetup(short)!.greedElite && randomElites(startOf(short)) === 0, `seed ${k}: step 8 with ${LADDER_GREED_RESOURCES - 1} resources — none`);
    assert(!battleSetup(seven)!.greedElite && randomElites(startOf(seven)) === 0, `seed ${k}: step 7 — none`);
    const ordinary = walk(seed, 8, TO_CAMP_ELITE.slice(0, TO_CAMP_ELITE.indexOf('camp-battle') + 1), { loot: { jailer: { dew: 9 } } }).run;
    assert(battleSetup(ordinary)!.ladder === 8 && !battleSetup(ordinary)!.hard && !battleSetup(ordinary)!.greedElite, `seed ${k}: an ordinary battle is not greedy`);
    assert(json(roundTrip(greedy)) === json(greedy), `seed ${k}: the greedy run saves`);
  }
  console.log('PASS hand-off: the setup carries the step and the hard battle; step 3 (+1 HP to authored elites), step 8 greed from 6 resources');
}

/** A generated run on `ladder` at the merchant node `shop` with `loot` from its first battle. */
function atShop(seed: number, ladder: number, loot: Stock): ForestRunState {
  let run = createForestRun(seed, { map: 'generated', skipTrunk: true, ladder });
  const map = forestRunMap(run), shop = map.nodes.find(node => node.type === 'shop')!.id;
  const reaches = (id: string): boolean => id === shop || map.node(id)!.next.some(reaches);
  let looted = false;
  for (let guard = 0; guard < 60; guard++) {
    if (run.pending?.nodeId === shop) return run;
    if (run.pending?.kind === 'battle') { run = winBattle(run, looted ? {} : { loot, hp: 1 }).run; looted = true; }
    else if (run.pending?.kind === 'talisman') run = ok(chooseTalisman(run, null), 'refuse');
    else if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), 'find');
    else if (run.pending?.kind === 'rest') run = ok(restHeal(run), 'heal');
    else if (run.pending?.kind === 'event') {
      const view = eventView(run)!;
      run = ok(chooseEventOption(run, view.options.find(entry => entry.available && eventOption(view.event, entry.id)!.outcomes.every(outcome => !outcome.effect.resources && !outcome.effect.hp))!.id), 'event');
    } else if (run.pending?.kind === 'shop') run = ok(shopLeave(run), 'leave');
    else run = ok(enterNode(run, availableNodes(run).find(node => reaches(node.id))!.id), 'enter');
  }
  throw new Error(`${seed}: the merchant is not reached`);
}

/** Step 9: every merchant price +1 (step 8 — the base prices); the save checks the prices of the step. */
function stepNineMerchant() {
  for (let k = 1; k <= 4; k++) {
    const seed = spread(k), base = atShop(seed, 8, { dew: 12 }), dear = atShop(seed, 9, { dew: 12 });
    const prices = (run: ForestRunState) => Object.fromEntries(shopView(run)!.goods.map(good => [good.id, good.fullPrice]));
    const low = prices(base), high = prices(dear);
    assert(json(Object.keys(low)) === json(Object.keys(high)) && Object.keys(low).every(id => high[id] === low[id] + LADDER_SHOP_MARKUP), `seed ${k}: step 9 adds ${LADDER_SHOP_MARKUP} to every price: ${json(low)} → ${json(high)}`);
    assert(low['item:0'] === SHOP_ITEM_PRICE && low.heal === SHOP_HEAL_PRICE && low.harden === SHOP_HARDEN_PRICE, `seed ${k}: step 8 keeps the base prices`);
    const bought = ok(shopBuy(dear, 'item:0'), 'buy on step 9');
    assert(dear.resources.materials!.dew - bought.resources.materials!.dew === SHOP_ITEM_PRICE + LADDER_SHOP_MARKUP && json(roundTrip(bought)) === json(bought), `seed ${k}: step 9 pays ${SHOP_ITEM_PRICE + 1}`);
    assert(forge(bought, value => { value.pending.bought[0].price = SHOP_ITEM_PRICE; value.pending.bought[0].paid.dew = SHOP_ITEM_PRICE; value.resources.materials.dew += 1; }) === null, `seed ${k}: a step-8 price on step 9 is rejected`);
  }
  console.log(`PASS step 9: the merchant's prices +${LADDER_SHOP_MARKUP} (step 8 — base); the save checks them`);
}

/** In-memory storage for the profile. */
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

/** The profile: 0 at first; a won run on step N opens N+1 (up to 10); a lower win or a defeat opens nothing. */
function profileOpens() {
  const storage = memoryStorage(), profile = createPlayerProfileStore(storage);
  assert(profile.load().ladder === 0, 'a new profile has step 0 open');
  // A real won run on step 0 to the Chief: its last step reports the victory and opens step 1.
  const won = walk(spread(5), 0, TO_CHIEF);
  const finished = winBattle(won.run);
  assert(finished.run.result?.outcome === 'victory' && winsRun(finished.events), 'the Chief\'s defeat wins the run');
  assert(profile.winLadder(finished.run.ladder ?? 0) === 1 && profile.load().ladder === 1, 'a victory on step 0 opens step 1');
  assert(profile.winLadder(0) === null && profile.load().ladder === 1, 'winning step 0 again opens nothing new');
  // A won run on step 3 opens 4; a lost run reports no victory.
  const three = winBattle(walk(spread(6), 3, TO_CHIEF).run);
  assert(three.run.ladder === 3 && winsRun(three.events) && profile.winLadder(three.run.ladder!) === 4, 'a victory on step 3 opens step 4');
  const lost = walk(spread(7), 4, TO_CHIEF);
  const e = new ForestEngine(); e.animationScale = 0; e.startRunBattle(battleSetup(lost.run)!); e.damagePlayer(99);
  const defeat = resolveBattle(lost.run, e.runBattleOutcome()!);
  assert(defeat.ok && defeat.run.result?.outcome === 'defeat' && !winsRun(defeat.events) && profile.load().ladder === 4, 'a defeat opens nothing');
  assert(profile.winLadder(2) === null && profile.load().ladder === 4, 'a lower win keeps the open step');
  assert(ladderAfterVictory(9, 9) === 10 && ladderAfterVictory(10, 10) === 10 && ladderAfterVictory(4, 1) === 4, 'step 10 is the top');
  assert(profile.load().trunkCleared === false && JSON.parse(storage.data.get(PLAYER_PROFILE_KEY)!).ladder === 4, 'the open step is stored beside the trunk mark');
  for (const bad of [11, -1, 2.5, '3', null]) assert(parsePlayerProfile(JSON.stringify({ version: 1, trunkCleared: true, ladder: bad })).ladder === 0, `a profile step ${json(bad)} reads as 0`);
  assert(parsePlayerProfile(JSON.stringify({ version: 1, trunkCleared: true })).ladder === 0, 'a profile before the ladder reads as step 0');
  assert(createPlayerProfileStore(null).winLadder(3) === null, 'without storage nothing opens');
  console.log('PASS profile: step 0 at first; a victory on N opens N+1 up to 10; lower wins and defeats open nothing; old profiles read as 0');
}

/** Saves keep the step; a forged step is rejected; an old save without one plays step 0; the same seed and step repeat exactly. */
function savesAndDeterminism() {
  for (let k = 1; k <= 3; k++) {
    const seed = spread(k + 20), run = createForestRun(seed, { map: 'generated', skipTrunk: true, ladder: 7 });
    assert(json(roundTrip(run)) === json(run) && roundTrip(run)!.ladder === 7, `seed ${k}: the step survives a save`);
    for (const bad of [0, 11, -1, 2.5, '3']) assert(forge(run, value => { value.ladder = bad; }) === null, `seed ${k}: a step ${json(bad)} is rejected`);
    const old = forge(createForestRun(seed, { map: 'generated', skipTrunk: true }), value => { delete value.ladder; });
    assert(old !== null && old.ladder === undefined && battleSetup(ok(enterNode(old, availableNodes(old)[0].id), 'enter'))!.ladder === undefined, `seed ${k}: a save without a step plays step 0`);
    const again = createForestRun(seed, { map: 'generated', skipTrunk: true, ladder: 7 });
    const first = ok(enterNode(run, availableNodes(run)[0].id), 'enter'), second = ok(enterNode(again, availableNodes(again)[0].id), 'enter');
    assert(json(first) === json(second) && json(startOf(first).state) === json(startOf(second).state), `seed ${k}: the same seed and step give the same run and battle`);
  }
  console.log('PASS saves and determinism: the step is saved and checked; old saves play step 0; the same seed and step repeat');
}

stepOneMap();
stepFiveRest();
stepSixStart();
battleHandOff();
stepNineMerchant();
profileOpens();
savesAndDeterminism();
console.log('Ladder run checks passed.');
