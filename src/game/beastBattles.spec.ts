/**
 * Beast-trail and den node battles (src/game/run/battles/beasts.ts), design: docs/levels/forest-nodes-beasts.md.
 * Every battle starts as in a run (ForestEngine.startRunBattle with the row palette and the tools guaranteed on
 * that row) and is played with real chain commands. Checks: the authored route wins on several refill seeds,
 * the forecast equals execution, the traps of each card are visible in the forecast, the same seed and actions
 * replay identically, refills stay random within the row palette and survivors keep their colors. Elites (elite.ts):
 * doubled HP, the +1 strike shown by the forecast, the run-up they need, and routes that win whether the elite's
 * loot drops or not. Exit door (decision of 02.10.2026): every beast battle ends by entering its authored door, the
 * goals only open it; the designed exit distance is checked on spread seeds (see `exits`). Heuristic bot results are
 * deliberately not asserted here (see docs/level-metrics.md).
 */
import { hasOrdinaryChain } from './boardGeneration';
import { ForestEngine } from './forestEngine';
import { planChain } from './forestSystems';
import type { ChainPreview } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { BEAST_BATTLES } from './run/battles/beasts';
import { nextReinforcementTurn, REINFORCEMENT_DELAY } from './exitRules';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import { forestNodeSeed } from './run/forestRun';
import type { RunBattleSetup } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Plan {
  /** Map node the battle is designed for and its row (palette and tools). */
  node: string; row: number;
  /** Authored winning route, one chain per turn (UI labels). */
  route: string[][];
  /** Cat HP after the route from a 5/5 entry. */
  hp: number;
  /**
   * The authored exit door and its distance class. `near`: the winning chain of the route continues into the door;
   * `turn`/`far`: the route meets the goals and the door is one / two turns away (den-breakout: the goal «hold one
   * turn» is met after the first enemy answer, so the exit is the second turn). With `search` the walk to the door
   * crosses refilled squares, so it is not fixed: it is found by a search over real chains (`exitPath`), at most
   * `search` turns, and played with real commands.
   */
  exit: { cell: string; distance: 'near' | 'turn' | 'far'; search?: number };
}
const PLANS: Record<string, Plan> = {
  'wolf-ford': { node: 'beast-wolf', row: 5, hp: 5, route: [['B5', 'C5', 'C4', 'D3', 'D2'], ['C3', 'D4', 'E3', 'E2', 'D1', 'C2', 'C1']],
    exit: { cell: 'C1', distance: 'near' } },
  // The targets fall onto the spikes in the enemy phase of turn 2; the door beside the cat is entered on turn 3.
  'boar-garden': { node: 'beast-boar', row: 6, hp: 5, route: [['G5', 'F5', 'E6', 'D5', 'C5'], ['B5', 'B6', 'C6'], ['D6']], exit: { cell: 'D6', distance: 'turn' } },
  'porcupine-thicket': { node: 'beast-porcupine', row: 7, hp: 4, route: [['A2', 'A3', 'B2', 'C1', 'D2', 'E3'], ['F2', 'F3', 'E4', 'D4', 'C5', 'C6', 'C7', 'D6']],
    exit: { cell: 'D6', distance: 'near' } },
  'den-watch': { node: 'den-battle', row: 10, hp: 5, route: [['F6', 'E5', 'E6', 'D5', 'E4', 'D4', 'C3', 'D2'], ['C2', 'D1', 'E2', 'E3', 'F2', 'G1']],
    exit: { cell: 'G1', distance: 'near' } },
  'den-nest': { node: 'den-elite', row: 12, hp: 4, route: [['E4', 'E3'], ['F2', 'E2', 'D1', 'C1', 'B1']], exit: { cell: 'A5', distance: 'far', search: 2 } },
  'den-breakout': { node: 'den-breakthrough', row: 13, hp: 5, route: [['B7', 'B6', 'B5', 'B4', 'B3', 'C3'], ['C2', 'C1']], exit: { cell: 'C1', distance: 'turn' } },
};
/** Refill variants as in the level analyzer: the authored start stays, only later refills change. */
const REFILL_SEEDS = [0, 1, 2, 3, 4, 5];
/** Spread refill variants: the first draw of the battle RNG is almost the same for neighbouring small seeds (elite loot). */
const SPREAD_SEEDS = Array.from({ length: 16 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0);

const json = (value: unknown) => JSON.stringify(value);
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const path = (g: ForestEngine, labels: string[]) => labels.map(label => at(g, label));

function setupFor(id: string, seed?: number, player: RunBattleSetup['player'] = { hp: 5, maxHp: 5, energy: 0 }): RunBattleSetup {
  const battle = forestBattle(id)!, plan = PLANS[id], tools = guaranteedRowTools(plan.row)!;
  return { nodeId: plan.node, label: battle.name, seed: seed ?? battle.definition.seed, template: { kind: 'battle', id }, row: plan.row, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, plan.row) };
}
function start(id: string, refillSeed = 0, seed?: number): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setupFor(id, seed)), `${id}: starts as a node battle`);
  if (refillSeed) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, refillSeed); g.restoreAnalysisSnapshot(snap); }
  return g;
}

/** Victory the engine forecasts: the chain completes the battle, or the following enemy phase does. */
const forecastWin = (preview: ChainPreview) => !!preview.completesRoom || !!preview.enemyPhase?.completesObjective;

/** One real chain: pure forecast, then beginChain/extendChain/releaseChain, and forecast = execution. */
async function commit(g: ForestEngine, labels: string[], where: string): Promise<ChainPreview> {
  const cells = path(g, labels), before = json(g.state), snap = json(g.captureAnalysisSnapshot()), hp = g.state.player.hp;
  const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const preview = g.preview(cells);
  assert(json(g.state) === before && json(g.captureAnalysisSnapshot()) === snap, `${where}: preview keeps state, RNG and ids`);
  assert(preview.valid, `${where} ${labels.join('-')}: ${preview.reason}`);
  const wins = forecastWin(preview);
  assert(g.beginChain(cells[0]), `${where}: chain starts`);
  for (const cell of cells.slice(1)) assert(g.extendChain(cell), `${where}: chain reaches ${cell}`);
  assert(await g.releaseChain(), `${where}: chain commits`);
  const { state } = g;
  assert(state.lastDamage === preview.damage && state.player.hp === hp - preview.damage, `${where}: damage ${state.lastDamage} matches forecast ${preview.damage}`);
  assert(state.player.index === (preview.enemyPhase?.heroIndex ?? preview.endIndex), `${where}: cat position matches forecast`);
  assert((state.phase === 'LOSE') === !!preview.playerDies, `${where}: death matches forecast`);
  assert((state.phase === 'WIN') === wins, `${where}: victory ${state.phase} matches forecast ${wins}`);
  for (const cell of state.board) {
    if (!cell) continue;
    const old = colors.get(cell.id);
    if (old !== undefined) assert(cell.color === old, `${where}: survivor ${cell.id} keeps its color`);
    else if (cell.kind === 'melee' && !cell.variant) {
      // Map rows ≥ 5 (every beast node): refills join the growing anger, never passive (mapBattleRules.ts).
      assert(!cell.behavior.passive, `${where}: refills are not passive on rows ≥ 5`);
      assert(cell.color !== null && state.customLevel!.paletteWeights[cell.color] > 0, `${where}: refill uses the node palette`);
    }
  }
  if (state.phase === 'PLAYER_INPUT') assert(hasOrdinaryChain(state), `${where}: the next turn has an ordinary chain`);
  return preview;
}

/**
 * Map battles place colour-change crystals on seeded random cells, crushing the enemy there (mapBattleRules.ts,
 * playtest 1): a fixed-label route can find one of its cells taken by a crystal. Such a seed is reported: a turn the
 * crystal makes invalid is not played, a turn through the crystal is played (forecast = execution still checked), and
 * the seed's outcome is not asserted (the crystal changes the chain colour; the route itself is not re-planned).
 */
const crystalOnRoute = (g: ForestEngine, labels: string[]) => labels.find(label => !!g.state.board[at(g, label)]?.crystalChain);
/**
 * Elite loot falls like a crystal (elite.ts) but is a colourless link that keeps the chain colour and power: a route
 * through it stays playable, only the enemy that lay there is skipped. Such a seed is still asserted (see routes()).
 */
const lootOnRoute = (g: ForestEngine, labels: string[]) => labels.find(label => !!g.state.board[at(g, label)]?.loot);

const doorOf = (g: ForestEngine) => g.state.board.findIndex(cell => cell?.kind === 'door');
const goalsMet = (g: ForestEngine) => g.state.customLevel!.goalCompletedTurn !== null;

/** Every valid chain into the (open) door from the cat, up to 16 cells, with its forecast — exhaustive within a budget. */
function doorChains(g: ForestEngine): { path: number[]; preview: ChainPreview }[] {
  const door = doorOf(g), found: { path: number[]; preview: ChainPreview }[] = [];
  let budget = 200_000;
  const walk = (chain: number[]) => {
    if (--budget < 0) return;
    const last = chain.length ? chain[chain.length - 1] : g.state.player.index;
    if (g.chainNeighbors(last).includes(door)) {
      const preview = g.preview([...chain, door]);
      if (preview.valid) found.push({ path: [...chain, door], preview });
    }
    if (chain.length >= 15) return;
    for (const next of g.chainNeighbors(last)) {
      if (next === door || chain.includes(next) || !g.state.board[next]) continue;
      const step = planChain(g.state, [...chain, next], true).preview;
      if (step.valid && !step.endsOnSurvivor) walk([...chain, next]);
    }
  };
  walk([]);
  return found;
}

/** A copy of a running battle (same setup, position, RNG and ids) for searching ahead. */
function copyOf(id: string, g: ForestEngine): ForestEngine {
  const copy = new ForestEngine(); copy.animationScale = 0;
  assert(copy.startRunBattle(setupFor(id, undefined, { hp: 5, maxHp: 5, energy: g.state.player.energy })), `${id}: copy starts`);
  copy.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  return copy;
}

/**
 * The walk to a door that is a turn or more away crosses refilled squares, so it is found, not fixed: a breadth search
 * over real chains on copies of the battle. Each turn it tries every chain into the door, otherwise keeps the `width`
 * safe chains that end closest to it. Returns the fewest-turn sequence (best HP among them) within `maxTurns`, or null.
 */
async function exitPath(id: string, g: ForestEngine, maxTurns: number, width = 12): Promise<number[][] | null> {
  const door = doorOf(g), cols = g.state.cols;
  const distance = (index: number) => Math.max(Math.abs(index % cols - door % cols), Math.abs(Math.floor(index / cols) - Math.floor(door / cols)));
  let frontier: { engine: ForestEngine; chains: number[][] }[] = [{ engine: g, chains: [] }];
  for (let turn = 1; turn <= maxTurns; turn++) {
    let best: { chains: number[][]; hp: number } | null = null;
    for (const node of frontier) for (const { path: chain, preview } of doorChains(node.engine)) {
      const hp = node.engine.state.player.hp - preview.damage;
      if (!preview.playerDies && (!best || hp > best.hp)) best = { chains: [...node.chains, chain], hp };
    }
    if (best) return best.chains;
    if (turn === maxTurns) break;
    const next: { engine: ForestEngine; chains: number[][]; score: number }[] = [];
    for (const node of frontier) {
      const scored = node.engine.availableMoves(16).map(move => ({ move, preview: node.engine.preview(move) }))
        .filter(({ preview }) => preview.valid && !preview.playerDies)
        .map(({ move, preview }) => ({ move, score: distance(preview.enemyPhase?.heroIndex ?? preview.endIndex) * 10 + preview.damage * 25 }))
        .sort((a, b) => a.score - b.score).slice(0, width);
      for (const { move } of scored) {
        const engine = copyOf(id, node.engine);
        await commit(engine, move.map(index => label(engine, index)), `${id} exit search`);
        if (engine.state.phase === 'PLAYER_INPUT') next.push({ engine, chains: [...node.chains, move], score: distance(engine.state.player.index) * 10 - engine.state.player.hp * 25 });
      }
    }
    frontier = next.sort((a, b) => a.score - b.score).slice(0, width);
  }
  return null;
}
const label = (g: ForestEngine, index: number) => `${String.fromCharCode(65 + index % g.state.cols)}${Math.floor(index / g.state.cols) + 1}`;

/** After the goals: the battle goes on with the door open; the found walk to it is played and wins only on entering. */
async function walkToExit(id: string, g: ForestEngine, where: string, maxTurns: number): Promise<number> {
  assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g), `${where}: the goals are met and the battle goes on`);
  assert(g.state.board[doorOf(g)]?.intent.label === 'Выход открыт', `${where}: the door is open`);
  const chains = await exitPath(id, g, maxTurns), door = doorOf(g);
  assert(chains, `${where}: the door is reached within ${maxTurns} turns`);
  for (const [turn, chain] of chains.entries()) {
    const preview = await commit(g, chain.map(index => label(g, index)), `${where} exit turn ${turn + 1}`);
    const phase: string = g.state.phase;
    assert((phase === 'WIN') === (turn === chains.length - 1) && (phase !== 'WIN' || preview.opensDoor === door), `${where}: won only by entering the door`);
  }
  return chains.length;
}

async function playRoute(id: string, g: ForestEngine, where: string, affected?: string[], looted?: string[]): Promise<string[]> {
  const snapshots: string[] = [];
  for (const [turn, labels] of PLANS[id].route.entries()) {
    assert(g.state.phase === 'PLAYER_INPUT', `${where}: turn ${turn + 1} is playable`);
    const loot = lootOnRoute(g, labels);
    if (loot) looted?.push(`${where}: turn ${turn + 1} passes elite loot on ${loot}`);
    const crystal = crystalOnRoute(g, labels);
    if (crystal && affected) {
      const valid = g.preview(path(g, labels)).valid;
      affected.push(`${where}: turn ${turn + 1} meets a crystal on ${crystal}${valid ? '' : ' and cannot be played'}`);
      if (!valid) return snapshots;
    }
    await commit(g, labels, `${where} turn ${turn + 1}`);
    snapshots.push(json(g.captureAnalysisSnapshot()));
    if (crystal && affected && g.state.phase !== 'PLAYER_INPUT') return snapshots;
  }
  const { search } = PLANS[id].exit;
  if (search && g.state.phase === 'PLAYER_INPUT') {
    await walkToExit(id, g, where, search);
    snapshots.push(json(g.captureAnalysisSnapshot()));
  }
  return snapshots;
}

/** Beast trail battles of 04.10.2026 (pools of rows 5–8, no fixed node): verified by beastTrailBattles.spec.ts. */
const TRAIL_BATCH = ['beast-wolf-crossing', 'beast-quill-stop'];
const DESIGNED = BEAST_BATTLES.filter(battle => !TRAIL_BATCH.includes(battle.id));

function layouts() {
  assert(DESIGNED.length === Object.keys(PLANS).length && DESIGNED.every(battle => PLANS[battle.id]), 'every beast battle has a verified plan');
  assert(BEAST_BATTLES[0].id === 'wolf-ford', 'the first registry battle is a designed one (forestRun.spec binds battles[0] to a node)');
  const shapes = new Set<string>(), starts = new Set<string>();
  for (const battle of DESIGNED) {
    const { id, definition } = battle, plan = PLANS[id];
    assert(plan, `${id}: planned node`);
    assert(!validateNodeBattle(battle).length, `${id}: ${validateNodeBattle(battle).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${id}: field 5x5..7x7`);
    shapes.add(`${definition.cols}x${definition.rows}:${definition.terrain.map(tile => tile === 'wall' ? '#' : '.').join('')}`);
    starts.add(`${definition.heroIndex % definition.cols},${Math.floor(definition.heroIndex / definition.cols)}`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index),
      ...(definition.devices ?? []).map(device => device.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), `${id}: every walkable square is authored`));
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(forestRowPalette(plan.row).every(color => colors.has(color)), `${id}: the opening already uses the colors of row ${plan.row}`);
    assert(definition.enemies.some(enemy => enemy.variant === 'wolf' || enemy.variant === 'boar' || enemy.variant === 'porcupine'), `${id}: a beast battle`);
  }
  assert(shapes.size === DESIGNED.length, 'every battle has its own field shape');
  assert(starts.size >= 5, 'the cat starts in different places');
}

async function routes() {
  const blocked: string[] = [], looted: string[] = [];
  for (const id of Object.keys(PLANS)) {
    let won = 0;
    for (const k of REFILL_SEEDS) {
      const g = start(id, k), where = `${id} refill ${k}`, before = blocked.length, lootBefore = looted.length;
      assert(g.state.runNode?.nodeId === PLANS[id].node && !!g.state.tutorial, `${where}: a map-node battle with its authored targets`);
      await playRoute(id, g, where, blocked, looted);
      // The only accepted deviation: a crystal took a cell of the fixed route (its outcome is then not asserted).
      if (blocked.length > before) continue;
      won++;
      assert(g.state.phase === 'WIN', `${where}: the authored route wins, got ${g.state.phase}`);
      // Loot on the route replaced the enemy there: it can only spare a hit (a quill), never cost one.
      const hpOk = looted.length > lootBefore ? g.state.player.hp >= PLANS[id].hp : g.state.player.hp === PLANS[id].hp;
      assert(hpOk, `${where}: ${PLANS[id].hp} HP left, got ${g.state.player.hp}`);
      assert(g.runBattleOutcome()?.won === true, `${where}: the run sees the victory`);
    }
    assert(won * 2 > REFILL_SEEDS.length, `${id}: the authored route wins on most refill seeds (the rest met a crystal), won ${won}`);
    // A run derives the refill seed from the run seed and the node id: the route does not depend on the authored seed.
    for (const runSeed of [1, 2]) {
      const g = start(id, 0, forestNodeSeed(runSeed, PLANS[id].node)), before = blocked.length;
      await playRoute(id, g, `${id} run ${runSeed}`, blocked);
      if (blocked.length === before) assert(g.state.phase === 'WIN', `${id} run ${runSeed}: the authored route wins`);
      else if (g.state.phase === 'WIN') blocked.push(`${id} run ${runSeed}: won anyway`);
    }
  }
  for (const note of blocked) console.log(`NOTE ${note}`);
  for (const note of looted) console.log(`NOTE ${note} (outcome asserted)`);
}

async function replayAndRandomRefill() {
  for (const id of Object.keys(PLANS)) {
    // A crystal on the fixed route stops both replays at the same turn (it is noted in routes()).
    const first = await playRoute(id, start(id, 3), `${id} replay A`, []);
    const second = await playRoute(id, start(id, 3), `${id} replay B`, []);
    assert(json(first) === json(second), `${id}: the same seed and actions replay identically`);
    // After the first turn the refilled squares differ between refill seeds (colors are not fixed to coordinates).
    const boards = new Set<string>();
    for (const k of REFILL_SEEDS) {
      const g = start(id, k);
      await commit(g, PLANS[id].route[0], `${id} refill ${k} first turn`);
      boards.add(json(g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(boards.size > 1, `${id}: refills vary with the seed`);
  }
}

/** The trap of each card is shown by the forecast before the chain is released. */
async function trapsInForecast() {
  const preview = (g: ForestEngine, labels: string[]) => {
    const before = json(g.state), result = g.preview(path(g, labels));
    assert(json(g.state) === before && result.valid, `${labels.join('-')}: pure valid forecast (${result.reason})`);
    return result;
  };
  const spikeKills = (g: ForestEngine, p: ChainPreview) => (p.enemyPhase?.deaths ?? []).filter(death => death.cause === 'spikes' && g.state.tutorial!.targetIds.includes(death.id)).length;

  // Wolves: a chain that stops beside a packed wolf is punished; the one that kills the middle of the pack is not.
  let g = start('wolf-ford');
  assert(preview(g, ['C6', 'D5']).damageBySource.melee === 1, 'wolf-ford: stopping next to the pack costs 1 HP in the forecast');
  const middle = preview(g, PLANS['wolf-ford'].route[0]);
  // The chain ends beside the flank wolves, but their announced strikes are shown as cancelled («СТАЯ РАЗБИТА»).
  assert(middle.damage === 0 && (middle.enemyPhase?.packBroken.length ?? 0) > 0, 'wolf-ford: killing the middle wolf is shown to break the pack');

  // Boar: killing the boar throws away the tool, before and after it is aimed at the spiked edge.
  g = start('boar-garden');
  assert(preview(g, ['E5', 'F4', 'G3']).hits.some(hit => hit.killed && g.state.board[hit.index]?.variant === 'boar'), 'boar-garden: the green bait kills the boar');
  await commit(g, PLANS['boar-garden'].route[0], 'boar-garden position');
  assert(g.state.board[at(g, 'G3')]?.intent.charge?.dx === -1, 'boar-garden: the boar now charges along its row toward the spiked edge');
  assert(spikeKills(g, preview(g, PLANS['boar-garden'].route[1])) === 2, 'boar-garden: a packed row pushes both targets onto the spikes');
  assert(spikeKills(g, preview(g, ['D4', 'E5', 'F4', 'G3', 'G2'])) === 0, 'boar-garden: a chain through the boar is shown to cancel the push');

  // Porcupine exam: the tempting second porcupine costs HP and leaves the leader alive.
  g = start('porcupine-thicket');
  await commit(g, PLANS['porcupine-thicket'].route[0], 'porcupine-thicket setup');
  const clean = preview(g, PLANS['porcupine-thicket'].route[1]);
  const greedy = preview(g, ['F2', 'F3', 'E4', 'D4', 'D5', 'C5', 'C6', 'C7']);
  assert(clean.completesRoom && clean.spikeDamage === 1, 'porcupine-thicket: the plug costs one quill and the clean lane kills the leader');
  assert(!greedy.completesRoom && greedy.spikeDamage === 2 && greedy.damage > clean.damage && greedy.enemies > clean.enemies,
    'porcupine-thicket: the longer chain through the second porcupine is shown to hurt more and to leave the leader alive');

  // Den watch: the porcupine at the leader is an avoidable quill.
  g = start('den-watch');
  const around = preview(g, PLANS['den-watch'].route[0]);
  const through = preview(g, ['F6', 'E5', 'E6', 'D5', 'E4', 'D4', 'D3', 'D2']);
  assert(around.damage === 0 && through.spikeDamage === 1 && through.damage === 1, 'den-watch: the porcupine route is shown to cost a quill');

  // Den nest: a chain through the boar's column leaves a void, and the forecast shows fewer targets on the spikes.
  g = start('den-nest');
  assert(spikeKills(g, preview(g, PLANS['den-nest'].route[0])) === 2, 'den-nest: the charge pushes the leader and a packmate onto the spikes');
  assert(spikeKills(g, preview(g, ['D4', 'C4', 'D3'])) < 2, 'den-nest: a void in the boar column is visible as a spared target');
  // The elite closes in on the cat (elite.ts): its step is announced, and a chain that ends elsewhere lets it leave the pack.
  assert(g.state.board[at(g, 'E2')]?.intent.moveTo === at(g, 'E3'), 'den-nest: the elite announces its step toward the cat');
  const away = start('den-nest');
  await commit(away, ['E4', 'F3'], 'den-nest elite leaves');
  assert(away.state.board[at(away, 'E3')]?.elite && !away.state.board[at(away, 'E2')]?.elite, 'den-nest: not blocked, the elite steps to E3, away from D1');
  // Standing on its step pins it beside D1: it now swings for 2, and a second chain that stops in reach is shown as 3.
  const pinned = start('den-nest');
  await commit(pinned, PLANS['den-nest'].route[0], 'den-nest pin');
  const guard = pinned.state.board[at(pinned, 'E2')];
  assert(guard?.elite && guard.intent.cells.includes(pinned.state.player.index), 'den-nest: the pinned elite stays and announces a strike on the cat');
  assert(preview(pinned, ['D3', 'D2']).damageBySource.melee === 3, 'den-nest: after the pin, stopping by the elite and D1 is shown as 3');

  // Breakout: stopping beside the packed wolves costs HP; the porcupine is a tempting extra kill with a quill.
  g = start('den-breakout');
  assert(preview(g, PLANS['den-breakout'].route[0]).damage === 0, 'den-breakout: breaking the pack in the middle is safe');
  assert(preview(g, ['C6', 'C5', 'C4']).damageBySource.melee >= 1, 'den-breakout: killing the lower wolf leaves the pack armed');
  assert(preview(g, ['B7', 'B6', 'A5', 'B5', 'B4', 'B3', 'C3']).spikeDamage === 1, 'den-breakout: the porcupine detour costs a quill');
}

/**
 * Elites (elite.ts) in den-watch and den-nest: doubled authored HP, the +1 strike in the forecast and in execution,
 * the run-up a 2-HP elite needs (a chain of two or more, never starting on it), and the authored route of den-nest
 * winning on spread seeds both when the elite's loot drops and when it does not.
 */
async function elites() {
  const eliteAt = { 'den-watch': 'E2', 'den-nest': 'E2' } as const;
  for (const [id, label] of Object.entries(eliteAt)) {
    const g = start(id), cell = g.state.board[at(g, label)]!;
    const authored = forestBattle(id)!.definition.enemies.find(enemy => enemy.index === at(g, label))!;
    assert(cell.elite && authored.elite && cell.hp === 2 * authored.hp && cell.maxHp === cell.hp && cell.hp === 2, `${id}: the elite on ${label} has doubled HP`);
    assert(g.state.board.filter(other => other?.elite).length === 1, `${id}: one authored elite`);
  }

  // Den watch: the elite leaves the pack toward the cat; once the leader is dead it stands alone on E3 and must be
  // the last of the finishing chain — leading with it is refused by the forecast.
  let g = start('den-watch');
  assert(g.state.board[at(g, 'E2')]?.intent.moveTo === at(g, 'E3'), 'den-watch: the elite announces a step toward the cat');
  await commit(g, PLANS['den-watch'].route[0], 'den-watch elite setup');
  assert(g.state.board[at(g, 'E3')]?.elite && !g.state.board[at(g, 'E3')]!.intent.cells.length, 'den-watch: the elite came to E3 and, without its pack, does not strike');
  const wrongOrder = g.preview(path(g, ['E3', 'E2', 'D1', 'C2']));
  assert(!wrongOrder.valid && wrongOrder.hits[0]?.killed === false, 'den-watch: a chain that starts on the elite is shown to leave it alive');

  // Den nest: pinned beside D1, the elite strikes for 2 if it is not finished (forecast = execution through commit).
  g = start('den-nest');
  await commit(g, PLANS['den-nest'].route[0], 'den-nest pin');
  const struck = await commit(g, ['D3', 'D2'], 'den-nest elite strike');
  assert(struck.damageBySource.melee === 3 && g.state.player.hp === 2, 'den-nest: the pinned elite (2) and D1 (1) strike the cat that stays');
  // The other answer to the moving elite: let it come to E3, ride the push to C2 and catch it last in the red chain.
  const rideTurns: number[] = [];
  for (const variant of SPREAD_SEEDS.slice(0, 6)) {
    const ride = start('den-nest');
    const snap = ride.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); ride.restoreAnalysisSnapshot(snap);
    await commit(ride, ['D4', 'D3', 'C4'], `den-nest ride ${variant}`);
    assert(ride.state.player.index === at(ride, 'C2') && ride.state.board[at(ride, 'E3')]?.elite, `den-nest ride ${variant}: the push carries the cat to C2, the elite steps to E3`);
    await commit(ride, ['B1', 'C1', 'D1', 'E1', 'F2', 'E3'], `den-nest ride ${variant} finish`);
    // The red chain catches the elite last; from E3 the door A5 is one turn away on most seeds (two on the rest).
    rideTurns.push(await walkToExit('den-nest', ride, `den-nest ride ${variant}`, 3));
    assert(ride.state.phase === 'WIN' && ride.state.player.hp === PLANS['den-nest'].hp, `den-nest ride ${variant}: the cat leaves with ${PLANS['den-nest'].hp} HP`);
  }
  console.log(`den-nest ride: turns to the door after the goals ${rideTurns.join(', ')}`);

  // The decision does not rest on the drop: the route meets the goals and leaves on spread seeds whether the loot falls or not.
  let dropped = 0, missed = 0;
  const pinTurns: number[] = [];
  for (const variant of SPREAD_SEEDS) {
    const run = new ForestEngine(); run.animationScale = 0;
    assert(run.startRunBattle(setupFor('den-nest')), 'den-nest: spread start');
    const snap = run.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); run.restoreAnalysisSnapshot(snap);
    const where = `den-nest spread ${variant}`, route = PLANS['den-nest'].route;
    await commit(run, route[0], `${where} turn 1`);
    await commit(run, route[1], `${where} turn 2`);
    // The elite dies inside the chain that meets the goals: its loot (if any) falls, and the battle goes on until the door.
    const loot = run.state.board.find(cell => cell?.kind === 'prism' && cell.loot);
    if (loot) dropped++; else missed++;
    assert(run.state.phase === 'PLAYER_INPUT' && run.state.player.hp === PLANS['den-nest'].hp, `${where}: the goals are met with ${PLANS['den-nest'].hp} HP (loot ${loot ? 'dropped' : 'not dropped'})`);
    pinTurns.push(await walkToExit('den-nest', run, where, PLANS['den-nest'].exit.search!));
    assert((run.state.phase as string) === 'WIN' && run.state.player.hp === PLANS['den-nest'].hp, `${where}: the cat leaves through the door with ${PLANS['den-nest'].hp} HP`);
  }
  assert(dropped > 0 && missed > 0, `den-nest: the spread seeds cover both outcomes of the loot roll (${dropped} dropped, ${missed} not)`);
  // «Far»: from B1, where the pin line meets the goals, the door A5 takes two turns on most seeds.
  assert(pinTurns.filter(turns => turns === 2).length * 2 > pinTurns.length, `den-nest: the door is two turns away after the pin on most seeds (${pinTurns.join(', ')})`);
  console.log(`den-nest elite: the route leaves on ${SPREAD_SEEDS.length} spread seeds, loot dropped on ${dropped}; turns to the door ${pinTurns.join(', ')}`);
}

/**
 * Energy is carried between nodes (a rest does not spend it), and on row 12 jump (radius 3, hit 4) and spin (hit 4 on the
 * eight neighbours) are open. Whatever the entry energy, no first action kills the den-nest elite (it is out of jump
 * and spin reach and of every first chain), and the authored route still wins.
 */
async function carriedEnergy() {
  const elite = (g: ForestEngine) => at(g, 'E2'), seeds = SPREAD_SEEDS.slice(0, 6);
  for (const energy of [0, 3, 7]) {
    for (const variant of seeds) {
      const g = new ForestEngine(); g.animationScale = 0;
      assert(g.startRunBattle(setupFor('den-nest', undefined, { hp: 5, maxHp: 5, energy })), `den-nest: starts with ${energy} energy`);
      const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); g.restoreAnalysisSnapshot(snap);
      const where = `den-nest energy ${energy} seed ${variant}`, before = json(g.state);
      const kills = (preview: ChainPreview) => preview.valid && preview.hits.some(hit => hit.index === elite(g) && hit.killed);
      // availableMoves is a pruned sample (≤240 paths), not every chain; a full search over every chain found none either (review 02.10.2026, current layout).
      for (const move of g.availableMoves(16)) assert(!kills(g.preview(move)), `${where}: no first chain kills the elite`);
      for (let cell = 0; cell < g.state.board.length; cell++) assert(!kills(g.previewAbility('jump', cell)), `${where}: no first jump kills the elite`);
      const spin = g.previewAbility('spin');
      assert(spin.valid === energy >= 3 && !kills(spin), `${where}: the first spin does not reach the elite`);
      assert(json(g.state) === before, `${where}: the previews keep the state`);
      await playRoute('den-nest', g, where);
      assert(g.state.phase === 'WIN', `${where}: the authored route wins`);
    }
  }
}

/**
 * The exit opens only after the first turn; the breakout is won through the door, before the wolves answer. The first
 * chain is forecast as «ВЫХОД ОТКРОЕТСЯ ПОСЛЕ ОТВЕТА ВРАГОВ» (the goal is met in the enemy phase); the chest falls at
 * the end of the first turn, and the reinforcement (row 13) is due REINFORCEMENT_DELAY turns later, after turn 4.
 */
async function exitRules() {
  const g = start('den-breakout');
  assert(!g.preview([at(g, 'C2'), at(g, 'C1')]).valid, 'den-breakout: the exit is closed on the first turn');
  const first = g.preview(path(g, PLANS['den-breakout'].route[0]));
  assert(first.valid && !first.unlocksExit && first.enemyPhase?.unlocksExit, 'den-breakout: the first chain opens the exit only after the enemies answer');
  assert(g.state.board.every(cell => !cell?.chest), 'den-breakout: no chest before the first turn ends');
  await commit(g, PLANS['den-breakout'].route[0], 'den-breakout first turn');
  assert(g.state.customLevel!.goalCompletedTurn === 1 && g.state.board.some(cell => !!cell?.chest), 'den-breakout: the chest falls at the end of the first turn');
  assert(nextReinforcementTurn(g.state) === 1 + REINFORCEMENT_DELAY, 'den-breakout: the reinforcement is due after turn 4');
  const door = g.preview([at(g, 'C2'), at(g, 'C1')]);
  assert(door.valid && door.completesRoom && !door.enemyPhase, 'den-breakout: after one turn the exit completes the battle before the enemy phase');
}

/**
 * Exit doors (decision of 02.10.2026). Every beast battle has one authored door and ends through it; it is closed at the
 * start. `near`: the chain that meets the last goal continues into the door — forecast «ВЫХОД · ПОБЕДА» — and the same
 * chain without the door meets the goals but is no victory: the battle goes on with the door open. `turn`: the goals
 * are met (boar-garden: by the push in the enemy phase), the battle goes on, and the door is entered next turn.
 * `far` marks a searched exit: den-nest's way to A5 crosses refilled cells, so it is found by real commands on spread
 * seeds in `elites`. Its door class is «ход» since 03.10.2026 (1–2 turns, docs/levels/forest-nodes-beasts.md).
 */
async function exits() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const g = start(id), door = at(g, plan.exit.cell), { definition } = forestBattle(id)!;
    assert(definition.completion === 'exit' && definition.doors.length === 1 && definition.doors[0].index === door, `${id}: one authored door on ${plan.exit.cell}, the battle ends through it`);
    assert(g.state.board[door]?.kind === 'door' && g.state.board[door]!.intent.label === 'Выполни цели', `${id}: the door is closed at the start`);
    if (plan.exit.distance === 'far') continue;
    for (const labels of plan.route.slice(0, -1)) await commit(g, labels, `${id} exit`);
    const last = plan.route.at(-1)!;
    if (plan.exit.distance === 'turn') {
      assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g) && (g.state.board[door]!.intent.label as string) === 'Выход открыт', `${id}: the goals are met, the battle goes on with the door open`);
      assert(last.at(-1) === plan.exit.cell && (last.length === 1 || id === 'den-breakout'), `${id}: the door is entered on the next turn`);
    }
    const into = g.preview(path(g, last));
    assert(into.valid && into.opensDoor === door && into.completesRoom && !into.enemyPhase, `${id}: the last chain enters the door — victory before the enemies answer`);
    if (plan.exit.distance !== 'near') continue;
    const stay = path(g, last.slice(0, -1)), short = g.preview(stay);
    assert(short.valid && !short.completesRoom && !short.enemyPhase?.completesObjective && short.opensDoor === undefined, `${id}: the same chain without the door is no victory`);
    await commit(g, last.slice(0, -1), `${id} stay`);
    assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g) && (g.state.board[door]!.intent.label as string) === 'Выход открыт', `${id}: the goals are met, the battle goes on with the door open`);
  }
}

/** A cat that enters a node wounded is not killed by the first turn of the authored route. */
async function woundedEntry() {
  for (const id of Object.keys(PLANS)) {
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startRunBattle(setupFor(id, undefined, { hp: 2, maxHp: 5, energy: 0 })), `${id}: wounded entry starts`);
    const first = g.preview(path(g, PLANS[id].route[0]));
    assert(first.valid && !first.playerDies, `${id}: the first authored chain is not lethal at 2 HP`);
  }
}

async function main() {
  layouts();
  await routes();
  await replayAndRandomRefill();
  await trapsInForecast();
  await exitRules();
  await exits();
  await elites();
  await carriedEnergy();
  await woundedEntry();
  console.log('beast battles: ok');
}

main().catch(error => { console.error(error); throw error; });
