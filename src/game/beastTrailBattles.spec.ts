/**
 * Beast trail battles of 04.10.2026 (the last entries of src/game/run/battles/beasts.ts), design:
 * docs/levels/forest-nodes-beasts.md, «Новые бои тропы зверей». They stand in the beast trail pools (battlePools.ts,
 * rows 5–8), not on a fixed node: every battle starts through ForestEngine.startRunBattle as a node battle on row 5
 * (rows 6–8 in `otherRows`, row 8 in the first-action sweep): the row palette (four colors), the tools guaranteed on
 * the row (frost; the jump from row 7), 5/5 HP, no items, entry energy 0 or 3 (the run carries energy between nodes).
 * Checks with real commands: the designed routes meet the goals and enter the door on spread refill seeds and both
 * entry energies; the traps of each card are visible in the forecast; forecast equals execution; the same seed and
 * actions replay identically; refills stay random within the palette, are not passive, and survivors keep their
 * colors; no first action (single hits and jumps included) meets the goals; late goals (turn 10–14) are no dead end.
 * Where a walk crosses refilled cells it is found by a search over real actions, never fixed. Heuristic bot results
 * are deliberately not asserted (docs/level-metrics.md).
 */
import { hasOrdinaryChain } from './boardGeneration';
import { ForestEngine } from './forestEngine';
import { planChain } from './forestSystems';
import type { ChainPreview } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { BEAST_BATTLES } from './run/battles/beasts';
import { battlePoolEntry } from './run/battlePools';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';
import { walkableTerrain } from './terrain';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

/** Trail band 5–8: checked on its first row; rows 6–8 in `otherRows` (the jump opens on row 7). */
const ROW = 5;
const TRAIL_ROWS = [5, 6, 7, 8];
/** Spread refill variants: neighbouring small seeds give almost the same first draws of the battle RNG. */
const SPREAD = Array.from({ length: 12 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0);
const ENERGIES = [0, 3];

interface Plan {
  /** Designed winning line, one chain per turn; the last chain enters the door. */
  route: string[][];
  /** Cat HP when the route has met the goals (5/5 entry). */
  hp: number;
  /** Door cell and its distance class (docs/biomes/forest-map.md, «Двери выхода»). */
  door: string; exit: 'near' | 'turn';
}
const PLANS: Record<string, Plan> = {
  // The ford leader first (the red runner C2 with it), then the northern leader and on into the door.
  'beast-wolf-crossing': { route: [['D4', 'C3', 'C2', 'D3'], ['E3', 'E2', 'D2', 'C1', 'B2']], hp: 5, door: 'B2', exit: 'near' },
  // Leave the porcupine and its row alone: the boar rams it, cannot push the row and stalls; then the ochre lane
  // kills the brittle boar and enters the door.
  'beast-quill-stop': { route: [['B5', 'C5', 'C4', 'D4', 'D5'], ['E5', 'E4', 'E3', 'D3', 'D2']], hp: 5, door: 'D2', exit: 'near' },
};
const BATCH = Object.keys(PLANS);

function setupFor(id: string, player: RunPlayerResources, row: number): RunBattleSetup {
  const battle = forestBattle(id)!, tools = guaranteedRowTools(row)!;
  return { nodeId: `spec:${id}`, label: battle.name, seed: battle.definition.seed, template: { kind: 'battle', id }, row, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, row) };
}
/** A fresh battle; `variant` replaces the refill RNG as the level analyzer does (the authored start stays). */
function start(id: string, variant = 0, energy = 0, hp = 5, row = ROW): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setupFor(id, { hp, maxHp: 5, energy }, row)), `${id}: starts as a node battle on row ${row}`);
  if (variant) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); g.restoreAnalysisSnapshot(snap); }
  return g;
}
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const label = (g: ForestEngine, index: number) => `${String.fromCharCode(65 + index % g.state.cols)}${Math.floor(index / g.state.cols) + 1}`;
const path = (g: ForestEngine, labels: string[]) => labels.map(cell => at(g, cell));
const doorOf = (g: ForestEngine) => g.state.board.findIndex(cell => cell?.kind === 'door');
const goalsMet = (g: ForestEngine) => g.state.customLevel!.goalCompletedTurn !== null;
const meetsGoals = (p: ChainPreview) => p.valid && !p.playerDies && (!!p.unlocksExit || !!p.enemyPhase?.unlocksExit || !!p.completesRoom);
/** Victory the engine forecasts: the chain completes the battle (enters the open door). */
const forecastWin = (preview: ChainPreview) => !!preview.completesRoom || !!preview.enemyPhase?.completesObjective;
/** Marked targets that die in this action, by the chain or in the following enemy phase. */
function targetDeaths(g: ForestEngine, preview: ChainPreview): number {
  const targets = new Set(g.state.tutorial!.targetIds);
  const dead = new Set([...preview.hits.filter(hit => hit.killed).map(hit => g.state.board[hit.index]?.id), ...(preview.enemyPhase?.deaths ?? []).map(death => death.id)]);
  return [...targets].filter(id => dead.has(id)).length;
}

/** Shared checks after any committed action: forecast = execution, survivors keep colors, refills are random and armed. */
function afterAction(g: ForestEngine, preview: ChainPreview, before: { hp: number; colors: Map<number, number | null> }, where: string) {
  const { state } = g;
  assert(state.player.hp === Math.max(0, before.hp - preview.damage), `${where}: HP ${state.player.hp} matches the forecast damage ${preview.damage}`);
  assert((state.phase === 'LOSE') === !!preview.playerDies, `${where}: death matches the forecast`);
  assert((state.phase === 'WIN') === forecastWin(preview), `${where}: victory ${state.phase} matches the forecast`);
  if (state.phase === 'PLAYER_INPUT') assert(state.player.index === (preview.enemyPhase?.heroIndex ?? preview.endIndex), `${where}: cat position matches the forecast`);
  for (const cell of state.board) {
    if (!cell) continue;
    const old = before.colors.get(cell.id);
    if (old !== undefined) assert(cell.color === old, `${where}: survivor ${cell.id} keeps its color`);
    else if (cell.kind === 'melee' && !cell.variant) {
      assert(!cell.behavior.passive, `${where}: refills are not passive on row ${state.runNode!.row}`);
      assert(cell.color !== null && state.customLevel!.paletteWeights[cell.color] > 0, `${where}: a refill uses the node palette`);
    }
  }
  if (state.phase === 'PLAYER_INPUT') assert(hasOrdinaryChain(state), `${where}: the next turn has an ordinary chain`);
}
const snapshotBefore = (g: ForestEngine) => ({ hp: g.state.player.hp, colors: new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : [])) });

/** One real chain: pure forecast, then beginChain/extendChain/releaseChain, and forecast = execution. */
async function chain(g: ForestEngine, labels: string[], where: string): Promise<ChainPreview> {
  const cells = path(g, labels), state = json(g.state), snap = json(g.captureAnalysisSnapshot()), before = snapshotBefore(g);
  const preview = g.preview(cells);
  assert(json(g.state) === state && json(g.captureAnalysisSnapshot()) === snap, `${where}: the forecast keeps state, RNG and ids`);
  assert(preview.valid, `${where} ${labels.join('-')}: ${preview.reason}`);
  assert(g.beginChain(cells[0]), `${where}: chain starts`);
  for (const cell of cells.slice(1)) assert(g.extendChain(cell), `${where}: chain reaches ${label(g, cell)}`);
  assert(await g.releaseChain(), `${where}: chain commits`);
  afterAction(g, preview, before, where);
  return preview;
}
type Step = string[] | { jump: string };
async function step(g: ForestEngine, action: Step, where: string): Promise<ChainPreview> {
  if (Array.isArray(action)) return chain(g, action, where);
  const before = snapshotBefore(g), state = json(g.state), preview = g.previewAbility('jump', at(g, action.jump));
  assert(json(g.state) === state && preview.valid, `${where}: jump ${action.jump} is a pure valid forecast (${preview.reason})`);
  assert(await g.useAbility('jump', at(g, action.jump)), `${where}: jump commits`);
  afterAction(g, preview, before, where);
  return preview;
}

/** Every valid chain from the cat (a full depth-first walk, single hits included). */
function allChains(g: ForestEngine): number[][] {
  const found: number[][] = [];
  let budget = 400_000;
  const walk = (cells: number[]) => {
    assert(--budget > 0, 'allChains: the walk fits its budget');
    const last = cells.length ? cells[cells.length - 1] : g.state.player.index;
    for (const next of g.chainNeighbors(last)) {
      if (cells.includes(next) || !g.state.board[next]) continue;
      const partial = planChain(g.state, [...cells, next], true).preview;
      if (!partial.valid) continue;
      found.push([...cells, next]);
      if (!partial.endsOnSurvivor) walk([...cells, next]);
    }
  };
  walk([]);
  return found.filter(cells => g.preview(cells).valid);
}
function copyOf(id: string, g: ForestEngine): ForestEngine {
  const copy = new ForestEngine(); copy.animationScale = 0;
  assert(copy.startRunBattle(setupFor(id, { hp: g.state.player.hp, maxHp: 5, energy: g.state.player.energy }, g.state.runNode!.row)), `${id}: copy starts`);
  copy.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  return copy;
}

/** Every valid chain from the cat into the open door (up to 16 cells), with its forecast. */
function doorChains(g: ForestEngine): { path: number[]; preview: ChainPreview }[] {
  const door = doorOf(g), found: { path: number[]; preview: ChainPreview }[] = [];
  let budget = 150_000;
  const walk = (cells: number[]) => {
    if (--budget < 0) return;
    const last = cells.length ? cells[cells.length - 1] : g.state.player.index;
    if (g.chainNeighbors(last).includes(door)) {
      const preview = g.preview([...cells, door]);
      if (preview.valid) found.push({ path: [...cells, door], preview });
    }
    if (cells.length >= 15) return;
    for (const next of g.chainNeighbors(last)) {
      if (next === door || cells.includes(next) || !g.state.board[next]) continue;
      const partial = planChain(g.state, [...cells, next], true).preview;
      if (partial.valid && !partial.endsOnSurvivor) walk([...cells, next]);
    }
  };
  walk([]);
  return found;
}
/**
 * The walk to a door over refilled cells: a breadth search over real chains on copies of the battle. Each turn it
 * tries every chain into the door, otherwise keeps the `width` safe chains that end closest to it. Returns the
 * fewest-turn sequence (best HP among them) within `maxTurns`, or null.
 */
async function exitPath(id: string, g: ForestEngine, maxTurns: number, width = 10): Promise<number[][] | null> {
  const door = doorOf(g), cols = g.state.cols;
  const distance = (index: number) => Math.max(Math.abs(index % cols - door % cols), Math.abs(Math.floor(index / cols) - Math.floor(door / cols)));
  let frontier: { engine: ForestEngine; chains: number[][] }[] = [{ engine: g, chains: [] }];
  for (let turn = 1; turn <= maxTurns; turn++) {
    let best: { chains: number[][]; hp: number } | null = null;
    for (const node of frontier) for (const { path: cells, preview } of doorChains(node.engine)) {
      const hp = node.engine.state.player.hp - preview.damage;
      if (!preview.playerDies && (!best || hp > best.hp)) best = { chains: [...node.chains, cells], hp };
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
        await chain(engine, move.map(index => label(engine, index)), `${id} exit search`);
        if (engine.state.phase === 'PLAYER_INPUT') next.push({ engine, chains: [...node.chains, move], score: distance(engine.state.player.index) * 10 - engine.state.player.hp * 25 });
      }
    }
    frontier = next.sort((a, b) => a.score - b.score).slice(0, width);
  }
  return null;
}
/** After the goals: the door is open, the found walk is played and wins only on entering. Returns the turns it took. */
async function walkToExit(id: string, g: ForestEngine, where: string, maxTurns: number): Promise<number> {
  assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g), `${where}: the goals are met and the battle goes on`);
  assert(g.state.board[doorOf(g)]?.intent.label === 'Выход открыт', `${where}: the door is open`);
  const chains = await exitPath(id, g, maxTurns);
  assert(chains, `${where}: the door is reached within ${maxTurns} turns`);
  for (const [turn, cells] of chains.entries()) {
    const preview = await chain(g, cells.map(index => label(g, index)), `${where} exit turn ${turn + 1}`);
    const phase: string = g.state.phase;
    assert((phase === 'WIN') === (turn === chains.length - 1) && (phase !== 'WIN' || (preview.opensDoor !== undefined && preview.completesRoom)), `${where}: won only by entering the door`);
  }
  return chains.length;
}

/** Plays a route; returns snapshots after each action (for the replay check) and the HP when the goals were met. */
async function playRoute(g: ForestEngine, route: Step[], where: string): Promise<{ snapshots: string[]; goalHp: number | null }> {
  const snapshots: string[] = [];
  let goalHp: number | null = null;
  for (const [turn, action] of route.entries()) {
    assert(g.state.phase === 'PLAYER_INPUT', `${where}: turn ${turn + 1} is playable`);
    const preview = await step(g, action, `${where} turn ${turn + 1}`);
    snapshots.push(json(g.captureAnalysisSnapshot()));
    const phase: string = g.state.phase;
    if (goalHp === null && (goalsMet(g) || phase === 'WIN')) goalHp = g.state.player.hp;
    if (phase === 'WIN') assert(preview.opensDoor !== undefined && preview.completesRoom, `${where}: the victory is entering the door`);
  }
  return { snapshots, goalHp };
}

const shapeOf = (definition: { cols: number; rows: number; terrain: string[] }) =>
  `${definition.cols}x${definition.rows}:${definition.terrain.map(tile => walkableTerrain(tile) ? '.' : '#').join('')}`;

function layouts() {
  const ids = BEAST_BATTLES.map(battle => battle.id);
  assert(BATCH.every(id => ids.includes(id)), 'every trail battle of the batch is in BEAST_BATTLES');
  const shapes = new Set<string>(), palette = forestRowPalette(ROW);
  for (const id of BATCH) {
    const battle = forestBattle(id)!, { definition } = battle, pool = battlePoolEntry(id);
    assert(pool && pool.type === 'battle' && pool.branch === 'beasts' && json(pool.rows) === json([5, 8]) && !pool.requires.length,
      `${id}: a beast trail battle of rows 5–8 without required tools`);
    assert(!validateNodeBattle(battle).length, `${id}: ${validateNodeBattle(battle).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${id}: field 5x5..7x7`);
    shapes.add(shapeOf(definition));
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === walkableTerrain(terrain), `${id}: every walkable square is authored`));
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(json([...colors].sort()) === json([...palette].sort()), `${id}: the opening uses exactly the ${palette.length} colors of rows 5–8`);
    for (const row of TRAIL_ROWS) {
      const weights = authoredRefillPalette(battle, row);
      assert(weights.every((weight, color) => (weight > 0) === forestRowPalette(row).includes(color as 0)), `${id}: the refill palette on row ${row} is the row palette`);
    }
    assert(definition.doors.length === 1 && definition.completion === 'exit', `${id}: one door, the battle ends through it`);
    const targetColors = battle.targetIndices.map(index => definition.enemies.find(enemy => enemy.index === index)!.color);
    assert(new Set(targetColors).size === targetColors.length, `${id}: the marked targets have different colors`);
    // Ordinary authored enemies stand in same-color groups (a beast of that color counts as a neighbour).
    for (const enemy of definition.enemies.filter(enemy => !enemy.variant && enemy.kind === 'melee')) {
      const x = enemy.index % definition.cols, y = Math.floor(enemy.index / definition.cols);
      const grouped = definition.enemies.some(other => other !== enemy && other.color === enemy.color
        && Math.max(Math.abs(other.index % definition.cols - x), Math.abs(Math.floor(other.index / definition.cols) - y)) === 1);
      assert(grouped, `${id}: the ${'RGBOV'[enemy.color ?? 0]} enemy at ${String.fromCharCode(65 + x)}${y + 1} has a same-color neighbour`);
    }
  }
  assert(shapes.size === BATCH.length, 'the new battles have their own field shapes');
  for (const other of ['wolf-ford', 'boar-garden', 'porcupine-thicket']) {
    assert(!shapes.has(shapeOf(forestBattle(other)!.definition)), `the new battles do not repeat the field of ${other}`);
  }
}

/** The designed routes meet the goals and leave through the door on spread seeds and both entry energies. */
async function routes() {
  for (const [id, plan] of Object.entries(PLANS)) {
    for (const energy of ENERGIES) for (const variant of [0, ...SPREAD.slice(0, energy ? 6 : 12)]) {
      const g = start(id, variant, energy), where = `${id} energy ${energy} seed ${variant}`;
      const { goalHp } = await playRoute(g, plan.route, where);
      assert(g.state.phase === 'WIN', `${where}: the designed route wins, got ${g.state.phase}`);
      assert(goalHp === plan.hp, `${where}: the goals are met with ${plan.hp} HP, got ${goalHp}`);
      assert(g.runBattleOutcome()?.won === true, `${where}: the run sees the victory`);
    }
  }
}

/** The designed routes hold on the other rows of the band (row 7 and 8 open the jump). */
async function otherRows() {
  for (const row of [6, 7, 8]) for (const [id, plan] of Object.entries(PLANS)) for (const energy of ENERGIES) for (const variant of [0, SPREAD[3]]) {
    const g = start(id, variant, energy, 5, row), where = `${id} row ${row} energy ${energy} seed ${variant}`;
    const { goalHp } = await playRoute(g, plan.route, where);
    assert(g.state.phase === 'WIN' && goalHp === plan.hp, `${where}: the designed route wins with ${plan.hp} HP at the goals, got ${g.state.phase} ${goalHp}`);
  }
}

async function replayAndRandomRefill() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const first = await playRoute(start(id, SPREAD[2]), plan.route, `${id} replay A`);
    const second = await playRoute(start(id, SPREAD[2]), plan.route, `${id} replay B`);
    assert(json(first.snapshots) === json(second.snapshots), `${id}: the same seed and actions replay identically`);
    const boards = new Set<string>();
    for (const variant of [0, ...SPREAD.slice(0, 5)]) {
      const g = start(id, variant);
      await step(g, plan.route[0], `${id} refill ${variant} first turn`);
      boards.add(json(g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(boards.size > 1, `${id}: refills vary with the seed (colors are not fixed to coordinates)`);
  }
}

/** The main decision of each card and its traps are visible in the forecast before the chain is released. */
async function traps() {
  const forecast = (g: ForestEngine, labels: string[]) => {
    const before = json(g.state), result = g.preview(path(g, labels));
    assert(json(g.state) === before && result.valid, `${labels.join('-')}: a pure valid forecast (${result.reason})`);
    return result;
  };
  const wolfAt = (g: ForestEngine, cell: string) => g.state.board[at(g, cell)]?.variant === 'wolf';

  // Wolf crossing. The longest first chain takes the northern leader C1, but its wolves B1 and D1 stay armed: their
  // only other packmate is the red wolf C2 of the ford pack. The forecast shows three bites; at 2 HP the chain is fatal.
  let g = start('beast-wolf-crossing');
  const leaderFirst = ['E4', 'E3', 'E2', 'D2', 'C1'];
  const north = forecast(g, leaderFirst);
  assert(targetDeaths(g, north) === 1 && north.damage === 3 && north.damageBySource.melee === 3 && !(north.enemyPhase?.packBroken ?? []).length,
    'beast-wolf-crossing: killing the northern leader first is shown as three wolf bites');
  const packmates = (cell: string) => ['A1', 'B1', 'C1', 'D1', 'E1', 'A2', 'B2', 'C2', 'D2', 'E2']
    .filter(other => other !== cell && Math.abs(other.charCodeAt(0) - cell.charCodeAt(0)) <= 1 && Math.abs(Number(other[1]) - Number(cell[1])) <= 1 && wolfAt(g, other));
  assert(json(packmates('B1')) === json(['C1', 'C2']) && json(packmates('D1')) === json(['C1', 'C2']) && g.state.board[at(g, 'C2')]!.color === 0,
    'beast-wolf-crossing: B1 and D1 have two packmates, their leader and the red wolf C2');
  assert(forecast(start('beast-wolf-crossing', 0, 0, 2), leaderFirst).playerDies, 'beast-wolf-crossing: at 2 HP the leader-first chain is shown to be fatal');
  const ford = forecast(g, PLANS['beast-wolf-crossing'].route[0]);
  assert(targetDeaths(g, ford) === 1 && ford.damage === 0 && ford.hits.some(hit => hit.index === at(g, 'C2') && hit.killed),
    'beast-wolf-crossing: the red chain kills the ford leader and the runner C2 without a bite');
  const direct = forecast(g, ['D4', 'C3', 'D3']);
  assert(targetDeaths(g, direct) === 1 && direct.damage === 0, 'beast-wolf-crossing: the red chain without the runner also takes the ford leader safely');
  const short = forecast(g, ['D4', 'D3']);
  assert(targetDeaths(g, short) === 0 && short.damage === 3 && short.damageBySource.melee === 3,
    'beast-wolf-crossing: a short run-up only wounds the ford leader (3 HP) and leaves the cat between three armed wolves');
  const runnerOnly = forecast(g, ['D4', 'C3', 'C2']);
  assert(targetDeaths(g, runnerOnly) === 0 && runnerOnly.damage === 1, 'beast-wolf-crossing: stopping on C2 beside the northern leader is shown as a bite');
  // After the ford leader, the same northern lane kills the leader and enters the door before the wolves answer.
  await chain(g, PLANS['beast-wolf-crossing'].route[0], 'beast-wolf-crossing ford');
  const finish = forecast(g, PLANS['beast-wolf-crossing'].route[1]);
  assert(finish.completesRoom && finish.damage === 0 && !finish.enemyPhase, 'beast-wolf-crossing: the northern lane ends in the door');

  // Quill stop. The boar is aimed left (the cat starts on A5): a chain that leaves the porcupine (3 HP) and row 3 alone
  // makes the ram wound the porcupine, the row cannot move and the boar stalls; a chain through row 3 or the porcupine
  // lets it run. The stalled boar rests and is brittle: the ochre lane of power 4 hits it for 8.
  g = start('beast-quill-stop');
  const boar = g.state.board[at(g, 'D3')]!, quill = g.state.board[at(g, 'C3')]!;
  assert(boar.variant === 'boar' && boar.hp === 6 && boar.intent.charge?.dx === -1, 'beast-quill-stop: the boar (6 HP) is aimed left at the start');
  assert(quill.variant === 'porcupine' && quill.hp === 3, 'beast-quill-stop: the porcupine has 3 HP');
  const stall = forecast(g, PLANS['beast-quill-stop'].route[0]);
  assert(stall.damage === 0 && stall.enemyPhase?.charges.length === 1 && stall.enemyPhase.charges[0].stunned
    && stall.enemyPhase.rams.some(ram => ram.id === quill.id && ram.damage === 2 && !ram.killed),
  'beast-quill-stop: the right chain is shown to stall the boar against the wounded porcupine');
  const greedy = forecast(g, ['A4', 'A3', 'A2', 'B2', 'B3', 'B4']);
  assert(greedy.enemyPhase?.charges.length === 1 && !greedy.enemyPhase.charges[0].stunned && greedy.enemyPhase.charges[0].to !== at(g, 'D3'),
    'beast-quill-stop: the green chain through row 3 lets the boar run');
  const through = forecast(g, ['A4', 'B4', 'C3', 'B2']);
  assert(through.spikeDamage === 1 && through.hits.some(hit => hit.index === at(g, 'C3') && hit.killed) && !through.enemyPhase?.charges[0].stunned,
    'beast-quill-stop: killing the porcupine costs a quill and frees the boar');
  // Ending in the lane: the boar rams the cat instead (2) — it stalls against the cat, but the chain cost 3 HP.
  const inLane = forecast(g, ['A4', 'B4', 'C3']);
  assert(inLane.damage === 3 && inLane.damageBySource.charge === 2 && inLane.spikeDamage === 1, 'beast-quill-stop: stopping in the lane is shown as a ram of 2 and a quill');
  await chain(g, PLANS['beast-quill-stop'].route[0], 'beast-quill-stop stall');
  const stalled = g.state.board[at(g, 'D3')]!;
  assert(stalled.id === boar.id && stalled.status.brittle && stalled.hp === 6 && stalled.behavior.restTurns > 0 && !stalled.intent.charge,
    'beast-quill-stop: the boar stays on D3, brittle and resting');
  const kill = forecast(g, PLANS['beast-quill-stop'].route[1]);
  const hit = kill.hits.find(entry => entry.index === at(g, 'D3'));
  assert(hit && hit.damage === 8 && hit.killed && kill.completesRoom && kill.damage === 0, 'beast-quill-stop: the brittle boar takes 8 and the chain enters the door');
  // Without the stall the same power only wounds it: after the green chain the boar keeps 6 HP and is not brittle.
  const free = start('beast-quill-stop');
  await chain(free, ['A4', 'A3', 'A2', 'B2', 'B3', 'B4'], 'beast-quill-stop free run');
  const runner = free.state.board.find(cell => cell?.id === boar.id)!;
  assert(runner.hp === 6 && !runner.status.brittle, 'beast-quill-stop: a boar that ran is neither stunned nor brittle');
}

/**
 * No first action meets the goals: every chain (single hits included), every jump where the row opens it, on rows 5
 * and 8 and entry energy 0 and 3.
 */
function firstActions() {
  for (const id of BATCH) for (const row of [5, 8]) for (const energy of ENERGIES) {
    const g = start(id, 0, energy, 5, row), before = json(g.state), where = `${id} row ${row} energy ${energy}`;
    const chains = allChains(g);
    for (const cells of chains) assert(!meetsGoals(g.preview(cells)), `${where}: ${cells.map(index => label(g, index)).join('-')} does not meet the goals on turn 1`);
    let jumps = 0;
    for (let cell = 0; cell < g.state.board.length; cell++) {
      const jump = g.previewAbility('jump', cell);
      if (jump.valid) jumps++;
      assert(!meetsGoals(jump), `${where}: the jump to ${label(g, cell)} does not meet the goals`);
    }
    assert(jumps > 0 === (row >= 7 && energy >= 2), `${where}: the jump is available only from row 7 with energy`);
    assert(!meetsGoals(g.previewRest()), `${where}: resting does not meet the goals`);
    assert(json(g.state) === before, `${where}: the previews keep the state`);
    if (row === ROW && energy === 0) console.log(`${id}: ${chains.length} first chains checked`);
  }
}

/** Doors: closed at the start; `near` — the chain that meets the goals enters it, without the door it only opens it. */
async function exits() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const g = start(id), door = at(g, plan.door);
    assert(doorOf(g) === door && g.state.board[door]!.intent.label === 'Выполни цели', `${id}: the door on ${plan.door} is closed at the start`);
    for (const action of plan.route.slice(0, -1)) await step(g, action, `${id} exit`);
    const last = plan.route.at(-1)!;
    const into = g.preview(path(g, last));
    assert(into.valid && into.opensDoor === door && into.completesRoom && !into.enemyPhase, `${id}: the last chain enters the door before the enemies answer`);
    const stay = g.preview(path(g, last.slice(0, -1)));
    assert(stay.valid && !stay.completesRoom && stay.opensDoor === undefined && stay.unlocksExit && stay.exitNext === door, `${id}: the same chain without the door only opens it`);
  }
}

/**
 * Protracted variant: the cat spends nine turns on short safe chains that do not hit the beasts, any enemy with HP or
 * a marked target (unless only such a hit still delays the goals), do not meet the goals and end as far from the
 * targets as possible; then a search over real actions (chains, the jump where open) meets the goals on turn 10–14,
 * and a second search reaches the door — late goals are no dead end.
 */
async function protracted() {
  const special = (g: ForestEngine, index: number) => {
    const cell = g.state.board[index];
    return !!cell && (!!cell.variant || !!cell.elite || cell.hp > 0 || g.state.tutorial!.targetIds.includes(cell.id));
  };
  const awayFrom = (g: ForestEngine, p: ChainPreview) => {
    const end = p.enemyPhase?.heroIndex ?? p.endIndex, cols = g.state.cols;
    return Math.min(...g.state.board.flatMap((cell, index) => cell && g.state.tutorial!.targetIds.includes(cell.id)
      ? [Math.max(Math.abs(index % cols - end % cols), Math.abs(Math.floor(index / cols) - Math.floor(end / cols)))] : []));
  };
  const lines: string[] = [];
  let forced = 0, late = 0;
  for (const id of BATCH) for (const variant of SPREAD.slice(0, 3)) {
    const g = start(id, variant), where = `${id} protracted seed ${variant}`;
    for (let turn = 0; turn < 9; turn++) {
      const delaying = g.availableMoves(16).map(cells => ({ cells, p: g.preview(cells) }))
        .filter(move => move.p.valid && !move.p.playerDies && !meetsGoals(move.p))
        .sort((a, b) => a.p.damage - b.p.damage || awayFrom(g, b.p) - awayFrom(g, a.p) || a.cells.length - b.cells.length);
      const spared = delaying.filter(move => !move.p.hits.some(hit => special(g, hit.index)));
      const moves = spared.length ? spared : delaying;
      if (!moves.length) { forced++; break; }
      await chain(g, moves[0].cells.map(index => label(g, index)), `${where} delay ${turn + 1}`);
    }
    const delayed = g.state.turn;
    assert(g.state.phase === 'PLAYER_INPUT' && !goalsMet(g), `${where}: still fighting after the delaying turns`);
    const actions = () => {
      const out: { action: Step; p: ChainPreview }[] = g.availableMoves(16).map(cells => ({ action: cells.map(index => label(g, index)), p: g.preview(cells) }));
      for (let cell = 0; cell < g.state.board.length; cell++) out.push({ action: { jump: label(g, cell) }, p: g.previewAbility('jump', cell) });
      return out.filter(entry => entry.p.valid && !entry.p.playerDies);
    };
    const progress = (p: ChainPreview) => targetDeaths(g, p) * 100 + p.hits.reduce((sum, hit) => sum + (special(g, hit.index) ? Math.max(0, hit.hpBefore - hit.hpAfter) * 10 : 0), 0)
      + (p.enemyPhase?.deaths ?? []).length * 5 - p.damage * 8;
    const search = async (depth: number): Promise<boolean> => {
      if (goalsMet(g)) return true;
      if (depth === 0 || g.state.phase !== 'PLAYER_INPUT') return false;
      const snapshot = g.captureAnalysisSnapshot();
      for (const { action } of actions().sort((a, b) => progress(b.p) - progress(a.p)).slice(0, 6)) {
        await step(g, action, `${where} search`);
        if (g.state.phase === 'PLAYER_INPUT' && await search(depth - 1)) return true;
        g.restoreAnalysisSnapshot(snapshot);
      }
      return false;
    };
    assert(await search(5), `${where}: the goals are still reachable after a slow start`);
    const goalTurn = g.state.customLevel!.goalCompletedTurn!;
    assert(goalTurn <= 14 && (delayed < 9 || goalTurn >= 10), `${where}: late goals on turn ${goalTurn}`);
    if (goalTurn >= 10) late++;
    const hpAtGoals = g.state.player.hp, turns = await walkToExit(id, g, where, 3);
    lines.push(`${id} seed ${variant}: goals on turn ${goalTurn} with ${hpAtGoals} HP, door in ${turns} turn(s) with ${g.state.player.hp} HP`);
  }
  for (const line of lines) console.log(line);
  assert(late * 3 >= lines.length * 2, `the protracted runs mostly meet the goals on turn 10 or later (${late} of ${lines.length}; ${forced} forced early)`);
}

async function main() {
  layouts();
  await traps();
  firstActions();
  await exits();
  await replayAndRandomRefill();
  await routes();
  await otherRows();
  await protracted();
  console.log('beast trail battles: ok');
}

main().catch(error => { console.error(error); throw error; });
