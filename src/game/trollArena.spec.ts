/**
 * Troll arena of the den branch (`troll-lair`, src/game/run/battles/bosses.ts), design:
 * docs/levels/forest-nodes-beasts.md, section «Логово Тролля». The battle starts as in a run
 * (ForestEngine.startRunBattle, row 14 palette and tools) and is played with real commands: chains and the spin.
 * Checks: the authored route kills the troll on several refill seeds, forecast equals execution (club damage, club deaths,
 * regeneration), the club is shown as a threat and as a tool, burning from the brazier stops regeneration,
 * frost is usable on the wet troll, the same seed and actions replay identically. Exit door B7 (02.10.2026): the troll's
 * death opens it and the battle is won by entering it. The way out runs over refilled cells (random by seed, with random
 * elites), so it is found by a small search over real commands and replayed with checked forecasts; the search is test
 * data (an oracle that sees each outcome), not a balance claim. No bot results are asserted.
 */
import { hasOrdinaryChain } from './boardGeneration';
import { ForestEngine } from './forestEngine';
import type { ChainPreview, EngineEvent } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { BOSS_BATTLES } from './run/battles/bosses';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import { forestNodeSeed } from './run/forestRun';
import type { RunBattleSetup } from './run/runBattle';
import { TROLL_CLUB_DAMAGE, TROLL_REGEN } from './troll';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ID = 'troll-lair', NODE = 'den-troll', ROW = 14;
/** Authored route: one action per turn; a chain as UI labels, the spin or a jump onto a label. */
type Step = string[] | 'spin' | { jump: string };
const ROUTE: Step[] = [
  ['G6', 'G5', 'F6', 'E6', 'E5', 'D4'], // brazier F6: the troll burns; the cat ends in the announced zone, which only winds up now
  ['F4', 'F3'], // strike turn: leave the zone without touching the troll; burning blocks regeneration
  ['F2', 'E1', 'D1', 'C1', 'D2', 'D3'], // rest turn of the troll: the longest ochre lane
  ['C2', 'B1', 'A1', 'A2', 'A3', 'B2', 'C3'], // windup of the second zone (top): hit from the left corner, outside it
  ['B3', 'A4', 'A5', 'B5', 'B4', 'C4'], // second strike turn: the green lane on the left side stays out of the top zone
  'spin', // the energy of five chains pays for the finishing spin
];
const REFILL_SEEDS = [0, 1, 2, 3, 4, 5];
/** Exit door: the bottom edge behind the pack, the class «ход» — one or two turns from where the route kills the troll. */
const DOOR = 'B7', EXIT_TURNS = 2;
/** Spread run seeds of the exit check (neighbouring small seeds share the first draws of the generator). */
const SPREAD_SEEDS = [1, 2, 3, 4, 5, 6].map(k => Math.imul(k, 2654435761) >>> 0);

const json = (value: unknown) => JSON.stringify(value);
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const troll = (g: ForestEngine) => g.state.board.find(cell => cell?.variant === 'troll') ?? null;

function setup(seed?: number, player = { hp: 5, maxHp: 5, energy: 0 }, frost = 0): RunBattleSetup {
  const battle = forestBattle(ID)!, tools = guaranteedRowTools(ROW)!;
  return { nodeId: NODE, label: battle.name, seed: seed ?? battle.definition.seed, template: { kind: 'battle', id: ID }, row: ROW, player,
    inventory: { frost, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, ROW) };
}
function start(refillSeed = 0, seed?: number, frost = 0): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup(seed, undefined, frost)), 'the troll arena starts as a node battle');
  if (refillSeed) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, refillSeed); g.restoreAnalysisSnapshot(snap); }
  return g;
}

/** Forecast = execution for one real action, including the club and regeneration. */
async function act(g: ForestEngine, step: Step, where: string): Promise<ChainPreview> {
  const before = json(g.state), snap = json(g.captureAnalysisSnapshot()), hp = g.state.player.hp;
  const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const preview = step === 'spin' ? g.previewAbility('spin') : !Array.isArray(step) ? g.previewAbility('jump', at(g, step.jump)) : g.preview(step.map(label => at(g, label)));
  assert(json(g.state) === before && json(g.captureAnalysisSnapshot()) === snap, `${where}: the forecast keeps state, RNG and ids`);
  assert(preview.valid, `${where}: ${preview.reason}`);
  const events: EngineEvent[] = [];
  const off = g.subscribe((_state, event) => { events.push({ ...event }); });
  if (step === 'spin') assert(await g.useAbility('spin'), `${where}: spin`);
  else if (!Array.isArray(step)) assert(await g.useAbility('jump', at(g, step.jump)), `${where}: jump`);
  else {
    const cells = step.map(label => at(g, label));
    assert(g.beginChain(cells[0]), `${where}: chain starts`);
    for (const cell of cells.slice(1)) assert(g.extendChain(cell), `${where}: chain reaches ${cell}`);
    assert(await g.releaseChain(), `${where}: chain commits`);
  }
  off();
  const { state } = g;
  assert(state.lastDamage === preview.damage && state.player.hp === hp - preview.damage, `${where}: damage ${state.lastDamage} matches forecast ${preview.damage}`);
  const club = events.filter(event => event.type === 'damage' && event.text === 'club').reduce((sum, event) => sum + (event.amount ?? 0), 0);
  assert(club === preview.damageBySource.troll, `${where}: club damage matches forecast`);
  assert((state.phase === 'LOSE') === !!preview.playerDies && (state.phase === 'WIN') === !!preview.completesRoom, `${where}: outcome matches forecast`);
  if (preview.enemyPhase && state.phase === 'PLAYER_INPUT') {
    const clubKills = events.filter(event => event.type === 'kill' && event.text === 'club').length;
    assert(preview.enemyPhase.deaths.filter(death => death.cause === 'club').length === clubKills, `${where}: club deaths match forecast`);
    assert(json(preview.enemyPhase.regenerated.map(entry => entry.amount)) === json(events.filter(event => event.type === 'regen').map(event => event.amount)),
      `${where}: regeneration matches forecast`);
  }
  for (const cell of state.board) {
    if (!cell) continue;
    const old = colors.get(cell.id);
    if (old !== undefined) assert(cell.color === old, `${where}: survivor keeps its color`);
    else if (cell.kind === 'melee' && !cell.variant) assert(!cell.behavior.passive && cell.color !== null && state.customLevel!.paletteWeights[cell.color] > 0, `${where}: refill joins the growing anger (row 14) and uses the node palette`);
  }
  if (state.phase === 'PLAYER_INPUT') assert(hasOrdinaryChain(state), `${where}: the next turn has an ordinary chain`);
  return preview;
}

async function playRoute(g: ForestEngine, where: string): Promise<string[]> {
  const snapshots: string[] = [];
  for (const [turn, step] of ROUTE.entries()) {
    assert(g.state.phase === 'PLAYER_INPUT', `${where}: turn ${turn + 1} is playable`);
    await act(g, step, `${where} turn ${turn + 1}`);
    snapshots.push(json(g.captureAnalysisSnapshot()));
  }
  return snapshots;
}

function layout() {
  const battle = BOSS_BATTLES.find(entry => entry.id === ID);
  assert(battle && !validateNodeBattle(battle).length, `troll-lair is valid: ${battle ? validateNodeBattle(battle).join(' ') : 'missing'}`);
  const { definition } = battle;
  assert(definition.cols === 7 && definition.rows === 7, 'a 7x7 lair');
  const trolls = definition.enemies.filter(enemy => enemy.variant === 'troll');
  assert(trolls.length === 1 && trolls[0].kind === 'boss' && trolls[0].footprint?.length === 4 && trolls[0].aggressive, 'one armed 2x2 troll');
  assert(trolls[0].footprint!.some(index => definition.terrain[index] === 'puddle'), 'the troll stands in a puddle (frost can freeze it)');
  assert(json(definition.goals) === json([{ key: 'bossKills', target: 1 }]) && definition.completion === 'exit', 'goal: kill the boss, then leave');
  const door = 6 * definition.cols + 1; // B7
  assert(json(definition.doors) === json([{ index: door }]) && definition.terrain[door] === 'floor', 'one exit door on the floor of B7');
  assert((definition.devices ?? []).some(device => device.kind === 'fire'), 'a brazier in the lair');
  assert(definition.enemies.filter(enemy => enemy.variant === 'wolf').length === 3, 'a pack of three wolves');
  const occupied = new Set([...definition.enemies.flatMap(enemy => enemy.footprint ?? [enemy.index]), ...(definition.devices ?? []).map(device => device.index),
    ...definition.doors.map(entry => entry.index), definition.heroIndex]);
  definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), 'every walkable square is authored'));
  const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
  assert(forestRowPalette(ROW).every(color => colors.has(color)), 'the opening uses the five colors of row 14');
  const g = start();
  assert(g.state.runNode?.nodeId === NODE && !!g.state.tutorial, 'a map-node battle with its authored targets');
  assert(troll(g)!.status.wet && troll(g)!.hp === troll(g)!.maxHp, 'the troll is wet and unhurt');
  const exit = g.state.board[at(g, DOOR)];
  assert(exit?.kind === 'door' && exit.intent.label === 'Выполни цели', 'the exit is closed at the start');
  assert(!g.preview(path(g, ['A6', DOOR])).valid, 'a chain into the closed exit is refused');
}

type Action = { chain: number[] } | { ability: 'spin' } | { ability: 'jump'; target: number };
const toStep = (g: ForestEngine, action: Action): Step => 'chain' in action ? labelsOf(g, action.chain)
  : action.ability === 'spin' ? 'spin' : { jump: labelsOf(g, [action.target])[0] };
const labelsOf = (g: ForestEngine, cells: number[]) => cells.map(index => String.fromCharCode(65 + index % g.state.cols) + (Math.floor(index / g.state.cols) + 1));
async function execute(g: ForestEngine, action: Action): Promise<boolean> {
  if ('chain' in action) { g.beginChain(action.chain[0]); for (const cell of action.chain.slice(1)) g.extendChain(cell); return g.releaseChain(); }
  return g.useAbility(action.ability, action.ability === 'jump' ? action.target : undefined);
}
function actions(g: ForestEngine): Action[] {
  const list: Action[] = g.availableMoves(10).map(chain => ({ chain }));
  if (g.previewAbility('spin').valid) list.push({ ability: 'spin' });
  g.state.board.forEach((_cell, index) => { if (g.previewAbility('jump', index).valid) list.push({ ability: 'jump', target: index }); });
  return list;
}
const distance = (g: ForestEngine, a: number, b: number) =>
  Math.max(Math.abs(a % g.state.cols - b % g.state.cols), Math.abs(Math.floor(a / g.state.cols) - Math.floor(b / g.state.cols)));
/**
 * The shortest way out (at most `turns`) over real commands: every chain of `availableMoves`, the spin and every jump is
 * played on a snapshot and undone; on the second turn only the actions that end nearest the door are expanded. It sees the
 * refill of each action (an oracle), so it only shows that the exit is reachable in that many turns on this seed.
 */
async function searchExit(g: ForestEngine, turns: number, width = 25): Promise<Action[] | null> {
  if (turns === 0 || g.state.phase !== 'PLAYER_INPUT') return null;
  const snapshot = g.captureAnalysisSnapshot(), door = at(g, DOOR), next: { action: Action; score: number }[] = [];
  for (const action of actions(g)) {
    await execute(g, action);
    const phase = g.state.phase as string;
    if (phase === 'PLAYER_INPUT') next.push({ action, score: g.state.player.hp * 4 - distance(g, g.state.player.index, door) * 10 });
    g.restoreAnalysisSnapshot(snapshot);
    if (phase === 'WIN') return [action];
  }
  next.sort((a, b) => b.score - a.score);
  for (const { action } of next.slice(0, width)) {
    await execute(g, action);
    const rest = await searchExit(g, turns - 1, width);
    g.restoreAnalysisSnapshot(snapshot);
    if (rest) return [action, ...rest];
  }
  return null;
}
/** After the route the troll is dead and the exit open; a way out is searched, then replayed with checked forecasts. */
async function leave(g: ForestEngine, where: string): Promise<string> {
  assert(!troll(g) && g.state.objective.bossKills === 1 && g.state.phase === 'PLAYER_INPUT' && !g.runBattleOutcome(), `${where}: the troll is dead, the battle goes on`);
  assert(g.state.board[at(g, DOOR)]!.intent.label === 'Выход открыт', `${where}: the troll's death opens the exit`);
  const probe = new ForestEngine(); probe.animationScale = 0; probe.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  let route: Action[] | null = null;
  for (let turns = 1; turns <= EXIT_TURNS && !route; turns++) route = await searchExit(probe, turns);
  assert(route, `${where}: the exit is reached within ${EXIT_TURNS} turns`);
  for (const [n, action] of route.entries()) await act(g, toStep(g, action), `${where} exit ${n + 1}`);
  assert((g.state.phase as string) === 'WIN' && g.state.player.index === at(g, DOOR) && g.runBattleOutcome()?.won === true, `${where}: the cat leaves through ${DOOR}, the run sees the victory`);
  return `${route.length} turn(s), ${g.state.player.hp} HP`;
}

async function routes(): Promise<string[]> {
  const exits: string[] = [];
  for (const k of REFILL_SEEDS) {
    const g = start(k), where = `refill ${k}`;
    await playRoute(g, where);
    assert(g.state.turn === ROUTE.length, `${where}: the authored route kills the troll in ${ROUTE.length} turns (turn ${g.state.turn})`);
    // Growing anger on row 14 (playtest 1): the third turn now takes one melee hit from a goblin of the growing anger.
    assert(g.state.player.hp === 4, `${where}: 4 HP left when the troll dies, got ${g.state.player.hp}`);
    exits.push(`${where}: ${await leave(g, where)}`);
  }
  for (const runSeed of [1, 2]) {
    const g = start(0, forestNodeSeed(runSeed, NODE));
    await playRoute(g, `run ${runSeed}`);
    exits.push(`run ${runSeed}: ${await leave(g, `run ${runSeed}`)}`);
  }
  for (const [k, seed] of SPREAD_SEEDS.entries()) {
    const g = start(0, seed), where = `spread ${k + 1}`;
    await playRoute(g, where);
    exits.push(`${where}: ${await leave(g, where)}`);
  }
  return exits;
}

async function replay() {
  const first = await playRoute(start(3), 'replay A'), second = await playRoute(start(3), 'replay B');
  assert(json(first) === json(second), 'the same seed and actions replay identically');
  const boards = new Set<string>();
  for (const k of REFILL_SEEDS) { const g = start(k); await act(g, ROUTE[0], `refill ${k} first turn`); boards.add(json(g.state.board.map(cell => cell?.color ?? null))); }
  assert(boards.size > 1, 'refills vary with the seed');
}

/** The club is a threat and a tool; burning from the brazier stops regeneration; both are visible in the forecast. */
async function forecastSignals() {
  const g = start();
  const opening = g.preview(path(g, ROUTE[0] as string[]));
  assert(opening.damage === 0 && !opening.enemyPhase?.regenerated.length, 'turn 1: the windup does not strike yet');
  await act(g, ROUTE[0], 'turn 1');
  assert((troll(g)!.damageEffects?.burning ?? 0) > 0, 'the brazier sets the troll on fire');
  const zone = troll(g)!.intent.cells;
  assert(zone.includes(g.state.player.index), 'the cat stands in the club zone after turn 1');
  // Staying to hit the troll from the zone costs the club; leaving it costs nothing and the fire keeps the troll from healing.
  const stay = g.preview(path(g, ['D5', 'C4']));
  const leave = g.preview(path(g, ROUTE[1] as string[]));
  assert(stay.valid && stay.damageBySource.troll === TROLL_CLUB_DAMAGE, 'hitting the troll from inside the zone is shown to cost the club');
  assert(leave.damage === 0 && !leave.enemyPhase!.regenerated.length, 'leaving the zone is safe and the burning troll does not regenerate');
  const wolves = g.state.board.filter(cell => cell?.variant === 'wolf').map(cell => cell!.id);
  const clubbed = leave.enemyPhase!.deaths.filter(death => death.cause === 'club').map(death => death.id);
  assert(wolves.length === 3 && wolves.every(id => clubbed.includes(id)), 'the club is shown to kill the whole pack in its zone');
  await act(g, ROUTE[1], 'turn 2');
  assert(!g.state.board.some(cell => cell?.variant === 'wolf'), 'the club killed the pack');
  await act(g, ROUTE[2], 'turn 3');
  // Without burning, a turn that does not hurt the troll is shown to heal it.
  assert(!(troll(g)!.damageEffects?.burning ?? 0), 'the fire is out by turn 4');
  const idle = g.availableMoves(16).map(cells => g.preview(cells)).find(p => !p.hits.some(hit => g.state.board[hit.index]?.variant === 'troll') && p.damage === 0);
  assert(idle && idle.enemyPhase!.regenerated[0]?.amount === TROLL_REGEN, 'a turn without damage to an unburnt troll is shown to regenerate it');
}
const path = (g: ForestEngine, labels: string[]) => labels.map(label => at(g, label));

/** A run that still carries the frost flask can freeze the wet troll: its strike is postponed until it thaws. */
function frost() {
  const g = start(0, undefined, 1);
  const anchor = g.state.board.findIndex(cell => cell?.variant === 'troll');
  const item = g.previewItem('frost', anchor), cold = g.previewFrost(anchor);
  assert(item.valid && cold.freezes && json([...cold.skippedCells].sort()) === json([...troll(g)!.intent.cells].sort()), 'frost freezes the wet troll and skips its club zone');
}

/** A wounded cat is not killed by the first turn: the route's first chain and a rest are safe. */
async function woundedEntry() {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup(undefined, { hp: 1, maxHp: 5, energy: 0 })), 'wounded entry starts');
  const first = g.preview(path(g, ROUTE[0] as string[]));
  assert(first.valid && first.damage === 0, 'the first authored chain is safe at 1 HP');
  assert(await g.waitTurn() && g.state.player.hp === 1, 'resting on the first turn is safe');
}

async function main() {
  layout();
  const exits = await routes();
  console.log(`troll arena: the route kills the troll, way out through ${DOOR} after its death — ${exits.join('; ')}`);
  await replay();
  await forecastSignals();
  frost();
  await woundedEntry();
  console.log('troll arena: ok');
}

main().catch(error => { console.error(error); throw error; });
