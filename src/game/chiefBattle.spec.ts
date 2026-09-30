import { validateCustomLevel } from './customLevel';
import { ForestEngine } from './forestEngine';
import { runPressureActive } from './mapBattleRules';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { forestNode } from './run/forestMap';
import { availableNodes, battleSetup, chooseFindItem, createForestRun, enterNode, forestNodeSeed, resolveBattle, type ForestRunState } from './run/forestRun';
import { startNodeBattle } from './testing/fixtures';
import type { ChainPreview, EngineEvent } from './forestTypes';

// The Chief's battle `chief-breakfast` (src/game/run/battles/bosses.ts, node camp-chief on row 14). It replaces the
// standalone forest trial with waves (30.09.2026): the same camp map, the Chief stands on the board from the start.
// Checked through real engine commands: the Chief is a colourless 20-HP boss, sweeps the three cells on the side that
// faces the cat with 1 damage every turn, the battle is won when he dies, and the map node ends the run in victory.
// The routes below were found once on the authored seed and on one run seed and are replayed here; they are data of
// this test, not a claim that any bot wins the battle. Analyzer metrics are recorded in docs, not asserted here.

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const cells = (g: ForestEngine, route: string) => route.split('-').map(label => at(g, label));
const labels = (g: ForestEngine, indices: number[]) => indices.map(index => String.fromCharCode(65 + index % g.state.cols) + (Math.floor(index / g.state.cols) + 1));
const chief = (g: ForestEngine) => g.state.board.find(cell => cell?.kind === 'boss');

/** Authored-seed route: the right flank, then two chains of ten into the Chief (20 → 10 → 0). */
const AUTHORED_ROUTE = ['D6-E6-F5-E4-E3-F2-F1', 'G2-F3-G3-F4-E3-E2-F2-E1-D2-C2-D1', 'B3-A4-B4-C3-B2-A3-A2-B1-C1-D2-D1'];
/** Route of run seed 701 (the camp branch, all earlier nodes won): other refills, the same plan. */
const RUN_SEED = 701;
const RUN_ROUTE = ['D6-E6-F5-E4-E3-F2-F1', 'G2-F3-G3-F4-E3-E2-F2-E1-D2-C2-D1', 'B3-C3-B4-A4-A3-A2-B1-B2-C1-D2-D1'];

/** One real chain: pure forecast, then begin/extend/release; damage, endpoint, death and victory match the forecast. */
async function commit(g: ForestEngine, route: string): Promise<{ forecast: ChainPreview; events: EngineEvent[] }> {
  const path = cells(g, route), before = json(g.captureAnalysisSnapshot()), hp = g.state.player.hp;
  const forecast = g.preview(path);
  assert(json(g.captureAnalysisSnapshot()) === before, `${route}: the forecast changes neither state, RNG nor IDs`);
  assert(forecast.valid, `${route}: ${forecast.reason}`);
  const events: EngineEvent[] = [];
  const off = g.subscribe((_state, event) => { events.push({ ...event }); });
  assert(g.beginChain(path[0]), `${route}: starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${route}: reaches ${step}`);
  assert(await g.releaseChain(), `${route}: resolves`);
  off();
  assert(g.state.lastDamage === forecast.damage && g.state.player.hp === hp - forecast.damage, `${route}: damage ${g.state.lastDamage} matches the forecast ${forecast.damage}`);
  assert((g.state.phase === 'WIN') === !!forecast.completesRoom, `${route}: victory matches the forecast`);
  assert((g.state.phase === 'LOSE') === !!forecast.playerDies, `${route}: defeat matches the forecast`);
  if (g.state.phase === 'PLAYER_INPUT') assert(g.state.player.index === forecast.endIndex, `${route}: endpoint matches the forecast`);
  return { forecast, events };
}

function layout() {
  const battle = forestBattle('chief-breakfast')!, node = forestNode('camp-chief')!, { definition } = battle;
  assert(node.type === 'boss' && node.content.kind === 'battle' && node.content.battleId === 'chief-breakfast' && !node.next.length, 'camp-chief is the final boss node playing chief-breakfast');
  assert(validateNodeBattle(battle).length === 0, `the battle passes the node validator: ${validateNodeBattle(battle).join(' ')}`);
  assert(validateCustomLevel(definition).valid, 'the battle is a valid level definition');
  assert(`${definition.cols}x${definition.rows}` === '7x7' && ['tree', 'pond', 'campfire', 'puddle'].every(kind => definition.terrain.includes(kind as never)),
    'the camp map keeps its trees, pond, campfire and puddle');
  assert(json(definition.goals) === json([{ key: 'bossKills', target: 1 }]) && !battle.targetIndices.length, 'the only goal is to defeat the boss');

  const g = startNodeBattle('chief-breakfast'), boss = chief(g)!;
  assert(g.state.runNode?.nodeId === 'camp-chief' && g.state.runNode.row === 14 && runPressureActive(g.state), 'started as camp-chief on row 14 with growing anger');
  assert(json(g.state.runNode.allowedAbilities) === json(['jump', 'spin']) && json(g.state.runNode.allowedItems) === json(['frost']), 'the tools every route has opened by then');
  assert(g.state.board.filter(cell => cell?.kind === 'boss').length === 1 && boss === g.state.board[at(g, 'D1')], 'the Chief stands on D1 from the start');
  assert(boss.hp === 20 && boss.maxHp === 20 && boss.color === null && !boss.variant && boss.behavior.aggressive && !boss.behavior.passive,
    'the Chief is a colourless armed 20-HP boss');
  assert(g.state.level.objectives.length === 1 && g.state.level.objectives[0].key === 'bossKills', 'the task shown is the boss');
  return g;
}

/** The Chief never gets company: several rests bring no second boss or wave, and he keeps his identity. */
async function noWaves() {
  const g = startNodeBattle('chief-breakfast', { player: { hp: 99, maxHp: 99, energy: 0 } }), id = chief(g)!.id;
  for (let turn = 0; turn < 6; turn++) {
    assert(await g.waitTurn(), `rest ${turn + 1}`);
    assert(g.state.board.filter(cell => cell?.kind === 'boss').map(cell => cell!.id).join() === String(id), `rest ${turn + 1}: the same single Chief, no waves`);
  }
}

async function sweep() {
  const g = startNodeBattle('chief-breakfast'), boss = chief(g)!;
  // Cat below (D7): the sweep covers the three cells under the Chief.
  assert(boss.intent.label === 'Взмах котелком' && boss.intent.damage === 1, 'the Chief announces «Взмах котелком» for 1 damage');
  assert(labels(g, boss.intent.cells).join() === 'C2,D2,E2', `the sweep faces the cat below: ${labels(g, boss.intent.cells)}`);
  await commit(g, AUTHORED_ROUTE[0]);
  // Cat to the right (F1): the sweep turns to the right side; on the top edge only two cells exist there.
  assert(labels(g, chief(g)!.intent.cells).join() === 'E1,E2' && chief(g)!.hp === 20, 'the sweep turns to the side of the cat');
  // Colourless: chains of different colours may end on him.
  const red = g.preview(cells(g, 'G2-F3-F4-E3-D2-E1-D1')), violet = g.preview(cells(g, 'E1-D2-E3-F2-E2-D1'));
  assert(red.valid && violet.valid && g.state.board[at(g, 'G2')]!.color !== g.state.board[at(g, 'E1')]!.color, 'chains of two colours both end on the Chief');
  // A chain that leaves the cat in the sweep costs 1 HP, dealt by the Chief.
  const hp = g.state.player.hp;
  const { forecast, events } = await commit(g, 'G2-F3-F4-E3-D2-E1-D1');
  assert(forecast.endsOnSurvivor && forecast.endIndex === at(g, 'E1') && chief(g)!.hp > 0, 'the surviving Chief stops the cat on E1, inside the sweep');
  assert(forecast.damage === 1 && g.state.player.hp === hp - 1, 'the sweep hits the cat for 1');
  const attack = events.findIndex(event => event.type === 'attack' && event.index === at(g, 'D1'));
  assert(attack >= 0 && events.slice(attack).some(event => event.type === 'damage' && event.index === at(g, 'E1') && event.amount === 1), 'the Chief on D1 strikes the cat on E1');
}

/** The authored-seed route: 20 → 10 → 0, the battle is won when the Chief dies. */
async function authoredVictory(g: ForestEngine) {
  const boss = chief(g)!, id = boss.id;
  const first = await commit(g, AUTHORED_ROUTE[0]);
  assert(first.forecast.damage === 0 && chief(g)!.hp === 20, 'turn 1 takes the right flank safely');
  const second = await commit(g, AUTHORED_ROUTE[1]);
  assert(second.forecast.hits.at(-1)?.index === at(g, 'D1') && chief(g)!.hp === 10 && g.state.phase === 'PLAYER_INPUT', 'ten power leaves the Chief at 10 HP; the fight goes on');
  const last = await commit(g, AUTHORED_ROUTE[2]);
  assert(last.forecast.completesRoom && last.forecast.hits.at(-1)?.killed, 'the forecast shows the killing blow and the victory');
  assert((g.state.phase as string) === 'WIN' && !g.state.board.some(cell => cell?.id === id) && g.state.objective.bossKills === 1, 'the Chief dies and the battle is won');
  assert(g.state.player.hp === 5, 'the route keeps every HP');
  const outcome = g.runBattleOutcome();
  assert(outcome?.won && outcome.nodeId === 'camp-chief' && outcome.player.hp === 5, 'the run receives the victory');
}

/** A prepared position independent of the refill: a wounded Chief falls to one opening chain, and only then is it a victory. */
async function preparedFinish() {
  const g = startNodeBattle('chief-breakfast');
  await commit(g, AUTHORED_ROUTE[0]);
  const boss = chief(g)!;
  boss.hp = 4;
  const short = g.preview(cells(g, 'E1-D2-D1'));
  assert(short.valid && !short.completesRoom && short.hits.at(-1)?.hpAfter === 1, 'three power only wounds the prepared Chief: no victory is forecast');
  await commit(g, 'E1-D2-E3-F2-E2-D1');
  assert(g.state.phase === 'WIN' && g.state.objective.bossKills === 1, 'six power defeats the 4-HP Chief: victory');
}

async function replay() {
  const g = startNodeBattle('chief-breakfast'), entry = json(g.captureAnalysisSnapshot());
  await authoredVictory(g); const final = json(g.captureAnalysisSnapshot());
  g.restartLevel(); assert(json(g.captureAnalysisSnapshot()) === entry, 'restart restores the authored opening exactly');
  await authoredVictory(g); assert(json(g.captureAnalysisSnapshot()) === final, 'the same seed and actions replay refills, crystals, IDs and the result');
}

/** The camp branch of a real run ends at camp-chief; winning the Chief by real chains wins the run. */
async function runVictory() {
  const ok = (step: ReturnType<typeof enterNode>, what: string): ForestRunState => { assert(step.ok, `${what}: ${step.ok ? '' : step.reason}`); return step.run; };
  let run = createForestRun(RUN_SEED);
  const e = new ForestEngine(); e.animationScale = 0;
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4', 'goblin-archer', 'trail-rest', 'goblin-shaman', 'trail-banners', 'jailer',
    'camp-battle', 'camp-rest', 'camp-elite', 'camp-breakthrough']) {
    run = ok(enterNode(run, id), `enter ${id}`);
    // Earlier nodes are finished with the debug victory: this check is about the last node.
    if (run.pending?.kind === 'battle') { assert(e.startRunBattle(battleSetup(run)!), `${id} starts`); e.winLevel(); run = ok(resolveBattle(run, e.runBattleOutcome()!), `resolve ${id}`); }
    if (run.pending?.kind === 'find') run = ok(chooseFindItem(run, run.pending.options[0]), `find at ${id}`);
  }
  assert(json(availableNodes(run).map(node => node.id)) === json(['camp-chief']), 'the breakthrough leads to the Chief');
  run = ok(enterNode(run, 'camp-chief'), 'enter camp-chief');
  const setup = battleSetup(run)!;
  assert(json(setup.template) === json({ kind: 'battle', id: 'chief-breakfast' }) && setup.seed === forestNodeSeed(RUN_SEED, 'camp-chief'), 'the node plays chief-breakfast on its run seed');
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'the Chief battle starts from the run');
  assert(chief(g)?.hp === 20 && g.state.player.hp === run.resources.player.hp, 'the Chief is on the board; the cat brings the run HP');
  for (const route of RUN_ROUTE) await commit(g, route);
  assert(g.state.phase === 'WIN' && g.state.objective.bossKills === 1, 'real chains defeat the Chief in the run');
  const step = resolveBattle(run, g.runBattleOutcome()!);
  const done = ok(step, 'resolve camp-chief');
  assert(done.result?.outcome === 'victory' && done.result.nodeId === 'camp-chief' && !availableNodes(done).length, 'the Chief ends the run in victory');
  assert(step.ok && step.events.some(event => event.type === 'run-won' && event.nodeId === 'camp-chief'), 'the map screen is told the run is won');
}

async function main() {
  const opening = layout();
  assert(opening.availableMoves(6).length > 0, 'the opening has an ordinary chain');
  await noWaves();
  await sweep();
  await authoredVictory(startNodeBattle('chief-breakfast'));
  await preparedFinish();
  await replay();
  await runVictory();
  console.log('PASS chief-breakfast: colourless 20-HP Chief from the start, no waves, sweep of the cat side for 1, victory on his death (authored route, prepared position, run seed), validator, exact replay, camp-chief wins the run');
}
main().catch(error => { console.error(error); throw error; });
