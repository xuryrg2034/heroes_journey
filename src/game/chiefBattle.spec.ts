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
// The first turn takes authored cells only. Later turns go through refilled cells (random by seed, and random elites
// draw the same RNG), so victory routes are not fixed: a small search over real commands finds one on each of several
// spread seeds, and the route is then replayed on a fresh engine with every forecast checked. The search is test data,
// not a balance claim: it sees the real outcome of each action (an oracle). Analyzer metrics are recorded in docs.

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const cells = (g: ForestEngine, route: string) => route.split('-').map(label => at(g, label));
const labels = (g: ForestEngine, indices: number[]) => indices.map(index => String.fromCharCode(65 + index % g.state.cols) + (Math.floor(index / g.state.cols) + 1));
const chief = (g: ForestEngine) => g.state.board.find(cell => cell?.kind === 'boss');

/** Authored first turn: the right flank along blue, authored cells only (refill-independent). */
const AUTHORED_ROUTE = ['D6-E6-F5-E4-E3-F2-F1'];
/** Run seed of the run-victory check (the camp branch, all earlier nodes won). */
const RUN_SEED = 701;
/** Spread refill seeds: neighbouring small seeds share the first draws of the generator. */
const SEARCH_SEEDS = [1, 2, 3, 4, 5, 6].map(k => Math.imul(k, 2654435761) >>> 0);

type Action = { chain: number[] } | { ability: 'jump' | 'spin'; target?: number };
async function execute(g: ForestEngine, action: Action): Promise<boolean> {
  if ('chain' in action) { g.beginChain(action.chain[0]); for (const step of action.chain.slice(1)) g.extendChain(step); return g.releaseChain(); }
  return g.useAbility(action.ability, action.target);
}
/**
 * Greedy one-turn lookahead over real commands: every chain of `availableMoves`, the spin and every valid jump is
 * played on a snapshot and undone; the best outcome is kept (victory, else damage to the Chief, HP, energy). It
 * knows the refill that follows each action, so it only shows that a victory is reachable on this seed.
 */
async function searchVictory(g: ForestEngine, maxTurns = 12): Promise<Action[]> {
  const played: Action[] = [];
  const score = () => g.state.phase === 'WIN' ? Infinity : g.state.phase === 'LOSE' ? -Infinity
    : (20 - chief(g)!.hp) * 10 + g.state.player.hp * 15 + g.state.player.energy * 3;
  for (let turn = 0; turn < maxTurns && g.state.phase === 'PLAYER_INPUT'; turn++) {
    const snapshot = g.captureAnalysisSnapshot();
    const actions: Action[] = g.availableMoves(12).map(chain => ({ chain }));
    if (g.previewAbility('spin').valid) actions.push({ ability: 'spin' });
    g.state.board.forEach((_cell, index) => { if (g.previewAbility('jump', index).valid) actions.push({ ability: 'jump', target: index }); });
    let best: Action | undefined, bestScore = -Infinity;
    for (const action of actions) {
      await execute(g, action);
      const value = score();
      g.restoreAnalysisSnapshot(snapshot);
      if (value > bestScore) { bestScore = value; best = action; }
      if (value === Infinity) break;
    }
    if (!best) break;
    await execute(g, best); played.push(best);
  }
  return played;
}
/** An ability by real input: pure forecast, then damage, energy, death and victory match it. */
async function useChecked(g: ForestEngine, ability: 'jump' | 'spin', target?: number): Promise<ChainPreview> {
  const before = json(g.captureAnalysisSnapshot()), hp = g.state.player.hp, energy = g.state.player.energy;
  const forecast = g.previewAbility(ability, target);
  assert(json(g.captureAnalysisSnapshot()) === before && forecast.valid, `${ability}: pure and valid forecast (${forecast.reason})`);
  assert(await g.useAbility(ability, target), `${ability} resolves`);
  assert(g.state.lastDamage === forecast.damage && g.state.player.hp === hp - forecast.damage, `${ability}: damage matches the forecast`);
  assert(g.state.player.energy === Math.min(7, energy - forecast.energyCost + forecast.energyGain) || g.state.phase !== 'PLAYER_INPUT', `${ability}: energy as forecast`);
  assert((g.state.phase === 'WIN') === !!forecast.completesRoom && (g.state.phase === 'LOSE') === !!forecast.playerDies, `${ability}: outcome matches the forecast`);
  return forecast;
}
/** Replay found actions on a fresh engine through the checked commands. */
async function replayChecked(g: ForestEngine, actions: Action[]) {
  for (const action of actions) {
    if ('chain' in action) await commit(g, labels(g, action.chain).join('-'));
    else await useChecked(g, action.ability, action.target);
  }
}

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
  // Colourless: chains of different colours may end on him. Cells after the first turn come from the refill (random
  // by seed), so the chains are found on the board rather than fixed: any two whose first enemies differ in colour.
  const onChief = g.availableMoves(8).filter(path => path.at(-1) === chief(g)!.footprint?.[0] || g.state.board[path.at(-1)!]?.id === chief(g)!.id);
  const path = onChief.find(candidate => g.preview(candidate).valid);
  assert(path, 'a chain ends on the Chief');
  // The same chain repainted in another colour still ends on him (the snapshot restores the board after).
  const snapshot = g.captureAnalysisSnapshot(), colour = g.state.board[path[0]]!.color!, other = ((colour + 1) % 5) as typeof colour;
  for (const index of path.slice(0, -1)) g.state.board[index]!.color = other;
  const repainted = g.preview(path).valid;
  g.restoreAnalysisSnapshot(snapshot);
  assert(repainted, 'chains of two colours both end on the Chief');
  // A chain that leaves the cat in the sweep costs 1 HP, dealt by the Chief.
  const swept = onChief.find(path => { const preview = g.preview(path); return preview.valid && preview.endsOnSurvivor && preview.damageBySource.boss === 1; });
  assert(swept, 'a chain ending on the surviving Chief leaves the cat in his sweep');
  const hp = g.state.player.hp, chiefAt = g.state.board.findIndex(cell => cell?.id === chief(g)!.id);
  const { forecast, events } = await commit(g, swept.map(index => labels(g, [index])[0]).join('-'));
  assert(forecast.endsOnSurvivor && chief(g)!.hp > 0, 'the surviving Chief stops the cat inside the sweep');
  assert(forecast.damageBySource.boss === 1 && g.state.player.hp === hp - forecast.damage, 'the sweep hits the cat for 1, as forecast');
  const attack = events.findIndex(event => event.type === 'attack' && event.index === chiefAt);
  assert(attack >= 0 && events.slice(attack).some(event => event.type === 'damage' && event.index === forecast.endIndex && event.amount === 1), 'the Chief strikes the cat in his sweep');
}

/**
 * Victory on spread refill seeds: the authored first turn (refill-independent), then a route found by the search
 * and replayed on a fresh engine with checked forecasts. The Chief dies, the battle is won, the run gets the result.
 * Deliberate exception to AGENTS.md («do not assert bot wins»), accepted by the orchestrator on 02.10.2026: from turn 2
 * the Chief's route runs over random refill (with random elites), so no authored route can exist; the search stands in
 * for it. A failure means either the battle or the search changed — check which before touching the threshold.
 */
async function searchedVictories() {
  const found: string[] = [];
  for (const seed of SEARCH_SEEDS) {
    const probe = startNodeBattle('chief-breakfast', { seed });
    const first = await commit(probe, AUTHORED_ROUTE[0]);
    assert(first.forecast.damage === 0 && chief(probe)!.hp === 20, 'turn 1 takes the right flank safely on authored cells');
    const route = await searchVictory(probe);
    if (probe.state.phase !== 'WIN') { console.log(`NOTE chief-breakfast seed ${seed}: the search found no victory`); continue; }
    const g = startNodeBattle('chief-breakfast', { seed }), id = chief(g)!.id;
    await commit(g, AUTHORED_ROUTE[0]);
    await replayChecked(g, route);
    assert(g.state.phase === 'WIN' && !g.state.board.some(cell => cell?.id === id) && g.state.objective.bossKills === 1, `seed ${seed}: the Chief dies and the battle is won`);
    const outcome = g.runBattleOutcome();
    assert(outcome?.won && outcome.nodeId === 'camp-chief' && outcome.player.hp === g.state.player.hp, `seed ${seed}: the run receives the victory`);
    found.push(`${seed}: ${route.length + 1} turns, ${g.state.player.hp} HP`);
  }
  // Not a balance claim: the search must find enough routes for the victory check to mean something.
  assert(found.length >= SEARCH_SEEDS.length - 2, `victory routes found on ${found.length}/${SEARCH_SEEDS.length} spread seeds`);
  return found;
}

/**
 * A prepared position: after the authored first turn the Chief is wounded to 4 HP. Chains ending on him are found on
 * the board (its cells after the first turn come from the refill): one with less than 4 power only wounds him — no
 * victory is forecast — and one with 4 or more defeats him: victory.
 */
async function preparedFinish() {
  const g = startNodeBattle('chief-breakfast');
  await commit(g, AUTHORED_ROUTE[0]);
  const boss = chief(g)!;
  boss.hp = 4;
  const onChief = g.availableMoves(12).map(path => ({ path, preview: g.preview(path) }))
    .filter(({ path, preview }) => preview.valid && g.state.board[path.at(-1)!]?.id === boss.id);
  const short = onChief.find(({ preview }) => (preview.hits.at(-1)?.availablePower ?? 0) < 4);
  const long = onChief.find(({ preview }) => (preview.hits.at(-1)?.availablePower ?? 0) >= 4);
  assert(short && long, `chains of less and of more power end on the Chief (${onChief.length})`);
  assert(!short.preview.completesRoom && (short.preview.hits.at(-1)?.hpAfter ?? 0) > 0, 'too little power only wounds the prepared Chief: no victory is forecast');
  assert(long.preview.completesRoom, 'enough power to kill him: the victory is forecast');
  await commit(g, long.path.map(index => labels(g, [index])[0]).join('-'));
  assert(g.state.phase === 'WIN' && g.state.objective.bossKills === 1, 'the Chief dies: victory');
}

/** The same seed and actions replay refills, crystals, IDs and the result; restart restores the authored opening. */
async function replay() {
  const g = startNodeBattle('chief-breakfast'), entry = json(g.captureAnalysisSnapshot());
  const played: string[] = [AUTHORED_ROUTE[0]];
  await commit(g, AUTHORED_ROUTE[0]);
  for (let turn = 0; turn < 3 && g.state.phase === 'PLAYER_INPUT'; turn++) {
    const path = g.availableMoves(8)[0];
    if (!path) break;
    const route = path.map(index => labels(g, [index])[0]).join('-');
    played.push(route); await commit(g, route);
  }
  const final = json(g.captureAnalysisSnapshot());
  g.restartLevel(); assert(json(g.captureAnalysisSnapshot()) === entry, 'restart restores the authored opening exactly');
  for (const route of played) await commit(g, route);
  assert(json(g.captureAnalysisSnapshot()) === final, 'the same seed and actions replay refills, crystals, IDs and the result');
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
  // The route is searched on a copy of this very battle, then played here with checked forecasts.
  const probe = new ForestEngine(); probe.animationScale = 0;
  assert(probe.startRunBattle(setup), 'the probe battle starts');
  const route = await searchVictory(probe);
  assert(probe.state.phase === 'WIN', 'the search finds a victory on the run seed');
  await replayChecked(g, route);
  assert(g.state.phase === 'WIN' && g.state.objective.bossKills === 1, 'real commands defeat the Chief in the run');
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
  const found = await searchedVictories();
  await runVictory();
  await preparedFinish();
  await replay();
  console.log(`PASS chief-breakfast: colourless 20-HP Chief from the start, no waves, sweep of the cat side for 1, victory on his death (searched routes on spread seeds — ${found.join('; ')}; prepared position; run victory), validator, exact replay`);
}
main().catch(error => { console.error(error); throw error; });
