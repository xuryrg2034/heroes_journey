/**
 * Den branch battles of the generated map (src/game/run/battles/den.ts), design: docs/levels/forest-branch-den.md.
 * They stand in the den branch pools (battlePools.ts, rows 10–12), not on a fixed node: every battle starts through
 * ForestEngine.startRunBattle as a node battle on row 11 (rows 10 and 12 in `otherRows` and the old tusker's first-move
 * sweep): the row palette (five colors) plus the authored colors, the tools guaranteed
 * on the row (frost, jump, spin), 5/5 HP, no items, entry energy 0, 3 or 7 (the run carries energy between nodes).
 * Checks with real commands: the designed routes meet the goals and enter the door on spread refill seeds and every
 * entry energy; the traps of each card are visible in the forecast; forecast equals execution; the same seed and
 * actions replay identically; refills stay random within the palette, are not passive, and survivors keep their
 * colors; the marked targets have different colors; late goals (turn 10–16) are no dead end. Where the way to the door crosses refilled cells it is found by a
 * search over real chains, never fixed. Heuristic bot results are deliberately not asserted (docs/level-metrics.md).
 */
import { hasOrdinaryChain } from './boardGeneration';
import { heroStrikeDamage } from './elite';
import { ForestEngine } from './forestEngine';
import { planChain } from './forestSystems';
import type { ChainPreview } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { DEN_BATTLES } from './run/battles/den';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

/** Branch band 10–12; checked on its middle row, and on rows 10 and 12 in `otherRows` (same palette and tools). */
const ROW = 11;
const BRANCH_ROWS = [10, 11, 12];
/** Spread refill variants: neighbouring small seeds give almost the same first draws of the battle RNG. */
const SPREAD = Array.from({ length: 12 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0);
const ENERGIES = [0, 3, 7];

/** One action of a designed route: a chain (UI labels) or an ability. */
type Step = string[] | { jump: string } | { spin: true };
interface Plan {
  /** Designed winning line: the last step enters the door unless `exitSearch` is set. */
  route: Step[];
  /** Cat HP when the route has met the goals (5/5 entry). */
  hp: number;
  /** Door cell and its distance class (docs/biomes/forest-map.md, «Двери выхода»). */
  door: string; exit: 'near' | 'turn';
  /** The way to the door crosses refilled cells: found by `exitPath` within this many turns. */
  exitSearch?: number;
}
const PLANS: Record<string, Plan> = {
  // Pay with quills: the fuel lane runs through both porcupines into the leader; the lone wolf and the door next turn.
  'den-quill-screen': { route: [['D5', 'C5', 'C4', 'B3', 'C3', 'D2', 'E2', 'F1'], ['E1', 'F2']], hp: 3, door: 'F2', exit: 'near' },
  // Aim the boar along the rut from the left, dig its far end, enter the door after the drag.
  'den-thorn-rut': { route: [['D6', 'C6', 'B6', 'A6'], ['A5', 'A4', 'A3', 'A2'], ['A1']], hp: 5, door: 'A1', exit: 'turn' },
  // Climb out of the rut on the east without digging it (two packmates fall on the spikes, the boar lands on D4 aimed
  // up again), step beside the ochre ring while the second charge drops the leader, then the ring into the boar on D1.
  'den-old-tusker': { route: [['E5', 'E4', 'E3'], ['F4'], ['F3', 'G3', 'G2', 'G1', 'F1', 'F2', 'E2', 'E1', 'D1']], hp: 5, door: 'A1', exit: 'turn', exitSearch: 3 },
};
/** Pay with energy instead: a chain to a pocket within jump range, the jump onto the leader, the door. */
const QUILL_JUMP: Step[] = [['E5', 'E6', 'F6', 'F5', 'F4', 'F3'], { jump: 'F1' }, ['E1', 'F2']];

function setupFor(id: string, seed?: number, player: RunPlayerResources = { hp: 5, maxHp: 5, energy: 0 }, row = ROW): RunBattleSetup {
  const battle = forestBattle(id)!, tools = guaranteedRowTools(row)!;
  return { nodeId: `spec:${id}`, label: battle.name, seed: seed ?? battle.definition.seed, template: { kind: 'battle', id }, row, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, row) };
}
/** A fresh battle; `variant` replaces the refill RNG as the level analyzer does (the authored start stays). */
function start(id: string, variant = 0, energy = 0, hp = 5, row = ROW): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setupFor(id, undefined, { hp, maxHp: 5, energy }, row)), `${id}: starts as a node battle on row ${row}`);
  if (variant) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); g.restoreAnalysisSnapshot(snap); }
  return g;
}
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const label = (g: ForestEngine, index: number) => `${String.fromCharCode(65 + index % g.state.cols)}${Math.floor(index / g.state.cols) + 1}`;
const path = (g: ForestEngine, labels: string[]) => labels.map(cell => at(g, cell));
const doorOf = (g: ForestEngine) => g.state.board.findIndex(cell => cell?.kind === 'door');
const goalsMet = (g: ForestEngine) => g.state.customLevel!.goalCompletedTurn !== null;
const targetsLeft = (g: ForestEngine) => g.state.tutorial!.targetIds.filter(id => g.state.board.some(cell => cell?.id === id)).length;
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
      assert(!cell.behavior.passive, `${where}: refills are not passive on row ${ROW}`);
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
async function step(g: ForestEngine, action: Step, where: string): Promise<ChainPreview> {
  if (Array.isArray(action)) return chain(g, action, where);
  const before = snapshotBefore(g), state = json(g.state);
  const preview = 'jump' in action ? g.previewAbility('jump', at(g, action.jump)) : g.previewAbility('spin');
  assert(json(g.state) === state && preview.valid, `${where}: ${'jump' in action ? `jump ${action.jump}` : 'spin'} is a pure valid forecast (${preview.reason})`);
  assert(await g.useAbility('jump' in action ? 'jump' : 'spin', 'jump' in action ? at(g, action.jump) : undefined), `${where}: ability commits`);
  afterAction(g, preview, before, where);
  return preview;
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
function copyOf(id: string, g: ForestEngine): ForestEngine {
  const copy = new ForestEngine(); copy.animationScale = 0;
  assert(copy.startRunBattle(setupFor(id, undefined, { hp: g.state.player.hp, maxHp: 5, energy: g.state.player.energy }, g.state.runNode!.row)), `${id}: copy starts`);
  copy.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  return copy;
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
async function playRoute(id: string, g: ForestEngine, route: Step[], where: string): Promise<{ snapshots: string[]; goalHp: number | null; exitTurns: number }> {
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
  let exitTurns = 0;
  const search = PLANS[id].exitSearch;
  if (search && g.state.phase === 'PLAYER_INPUT') { exitTurns = await walkToExit(id, g, where, search); snapshots.push(json(g.captureAnalysisSnapshot())); }
  return { snapshots, goalHp, exitTurns };
}

function layouts() {
  assert(DEN_BATTLES.length === Object.keys(PLANS).length && DEN_BATTLES.every(battle => PLANS[battle.id]), 'every den branch battle has a verified plan');
  const shapes = new Set<string>(), palette = forestRowPalette(ROW);
  for (const battle of DEN_BATTLES) {
    const { id, definition } = battle;
    assert(id.startsWith('den-'), `${id}: den branch id`);
    assert(!validateNodeBattle(battle).length, `${id}: ${validateNodeBattle(battle).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${id}: field 5x5..7x7`);
    shapes.add(`${definition.cols}x${definition.rows}:${definition.terrain.map(tile => tile === 'wall' ? '#' : '.').join('')}`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain !== 'wall'), `${id}: every walkable square is authored`));
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(palette.every(color => colors.has(color)), `${id}: the opening uses the ${palette.length} colors of row ${ROW}`);
    assert(definition.doors.length === 1 && definition.completion === 'exit', `${id}: one door, the battle ends through it`);
    // Targets of different colors (the run brief of 04.10.2026): no single color chain takes them all.
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
  assert(shapes.size === DEN_BATTLES.length, 'every den branch battle has its own field shape');
  for (const other of ['den-watch', 'den-nest']) {
    const { definition } = forestBattle(other)!;
    assert(!shapes.has(`${definition.cols}x${definition.rows}:${definition.terrain.map(tile => tile === 'wall' ? '#' : '.').join('')}`), `the new battles do not repeat the field of ${other}`);
  }
}

/** The designed routes meet the goals and leave through the door on spread seeds and every entry energy. */
async function routes() {
  const exitTurns: Record<string, number[]> = {};
  for (const [id, plan] of Object.entries(PLANS)) {
    for (const energy of ENERGIES) for (const variant of [0, ...SPREAD.slice(0, energy ? 4 : 12)]) {
      const g = start(id, variant, energy), where = `${id} energy ${energy} seed ${variant}`;
      const { goalHp, exitTurns: turns } = await playRoute(id, g, plan.route, where);
      assert(g.state.phase === 'WIN', `${where}: the designed route wins, got ${g.state.phase}`);
      assert(goalHp === plan.hp, `${where}: the goals are met with ${plan.hp} HP, got ${goalHp}`);
      assert(g.runBattleOutcome()?.won === true, `${where}: the run sees the victory`);
      if (plan.exitSearch) (exitTurns[id] ??= []).push(turns);
    }
  }
  // Paying with energy instead of quills: the jump line of den-quill-screen keeps full HP.
  for (const variant of [0, ...SPREAD.slice(0, 6)]) {
    const g = start('den-quill-screen', variant), where = `den-quill-screen jump line seed ${variant}`;
    await playRoute('den-quill-screen', g, QUILL_JUMP, where);
    assert(g.state.phase === 'WIN' && g.state.player.hp === 5, `${where}: the jump line wins with 5 HP, got ${g.state.phase} ${g.state.player.hp}`);
  }
  for (const [id, turns] of Object.entries(exitTurns)) console.log(`${id}: turns from the goals to the door ${turns.join(', ')}`);
}

async function replayAndRandomRefill() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const first = await playRoute(id, start(id, SPREAD[2]), plan.route, `${id} replay A`);
    const second = await playRoute(id, start(id, SPREAD[2]), plan.route, `${id} replay B`);
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

  // Quill screen: the quill lane costs 2 HP and kills the leader; a short run-up pays the same quills and fails;
  // the pocket chain costs nothing and the jump onto the leader no quills; at 2 HP the quill lane is fatal.
  let g = start('den-quill-screen');
  const quills = forecast(g, PLANS['den-quill-screen'].route[0] as string[]);
  assert(quills.spikeDamage === 2 && quills.damage === 2 && targetDeaths(g, quills) === 1, 'den-quill-screen: the quill lane is shown to cost 2 HP and to kill the leader');
  const short = forecast(g, ['C5', 'C4', 'C3', 'D2', 'E2', 'F1']);
  assert(short.spikeDamage === 2 && targetDeaths(g, short) === 0 && short.endsOnSurvivor, 'den-quill-screen: a short run-up pays both quills and leaves the leader alive');
  const charged = start('den-quill-screen', 0, 7);
  assert(!charged.previewAbility('jump', at(charged, 'F1')).valid, 'den-quill-screen: even with 7 energy the leader is out of jump reach from the start');
  await chain(g, QUILL_JUMP[0] as string[], 'den-quill-screen pocket');
  const jump = g.previewAbility('jump', at(g, 'F1'));
  assert(jump.valid && jump.damage === 0 && !jump.spikeDamage && targetDeaths(g, jump) === 1, 'den-quill-screen: the jump kills the leader without quills');
  const wounded = start('den-quill-screen', 0, 0, 2);
  assert(forecast(wounded, PLANS['den-quill-screen'].route[0] as string[]).playerDies, 'den-quill-screen: at 2 HP the quill lane is shown to be fatal');
  assert(!forecast(wounded, QUILL_JUMP[0] as string[]).damage, 'den-quill-screen: at 2 HP the pocket chain is safe');

  // Thorn rut: from the left the boar aims along the rut; digging its far end drags the whole pack over the thorns,
  // digging only the inner cell spares two wolves, and stopping in the rut costs thorns.
  g = start('den-thorn-rut');
  assert(g.state.board[at(g, 'F4')]?.intent.label === 'Упёрся', 'den-thorn-rut: at the start the boar is stuck (the cat is below it)');
  const wrong = start('den-thorn-rut');
  await chain(wrong, ['F6', 'G6', 'G5', 'G4'], 'den-thorn-rut wrong side');
  assert(wrong.state.board[at(wrong, 'F4')]?.intent.charge?.dx !== -1, 'den-thorn-rut: from the right the boar does not aim along the rut');
  await chain(g, PLANS['den-thorn-rut'].route[0] as string[], 'den-thorn-rut aim');
  assert(g.state.board[at(g, 'F4')]?.intent.charge?.dx === -1, 'den-thorn-rut: from the left the boar aims along the rut');
  const far = forecast(g, PLANS['den-thorn-rut'].route[1] as string[]);
  assert(targetDeaths(g, far) === 3 && far.damage === 0 && far.enemyPhase?.unlocksExit, 'den-thorn-rut: digging the far end drags the pack over the thorns');
  assert((far.enemyPhase?.deaths ?? []).some(death => death.cause === 'thorns'), 'den-thorn-rut: the forecast names the thorns');
  const inner = forecast(g, ['B5', 'B4', 'B3', 'B2', 'C2']);
  assert(targetDeaths(g, inner) === 1 && inner.enemies > far.enemies, 'den-thorn-rut: the longer chain digs only the inner cell and spares two wolves');
  const inRut = forecast(g, ['A5', 'A4']);
  assert((inRut.thornDamage ?? 0) >= 1 && targetDeaths(g, inRut) < 3, 'den-thorn-rut: stopping in the rut costs thorns and spares wolves');

  // Old tusker: the cat starts in the rut; staying there is a ram of 3. The first charge drops only the two packmates in
  // front of the leader, so the boar must charge up twice: the cat has to climb out of the rut to row 3 (east, not into
  // the bitten west end), and a single hit beside it leaves the cat below the boar — it then charges down, away from the
  // leader. On turn 2 the cat waits beside the ochre ring; burning it puts the cat in line with the boar's landing.
  g = start('den-old-tusker');
  const boar = g.state.board[at(g, 'D7')]!;
  assert(boar.elite && boar.hp === 8 && boar.intent.charge?.dy === -1, 'den-old-tusker: the elite boar (8 HP) is aimed up the rut');
  const stay = forecast(g, ['D7']);
  assert(stay.chargeDamage === 3 && stay.damageBySource.charge === 3, 'den-old-tusker: a hit that leaves the cat in the rut is shown as a ram of 3');
  const leave = forecast(g, PLANS['den-old-tusker'].route[0] as string[]);
  const spiked = (p: ChainPreview) => (p.enemyPhase?.deaths ?? []).filter(death => death.cause === 'spikes').length;
  assert(leave.damage === 0 && targetDeaths(g, leave) === 0 && spiked(leave) === 2 && leave.enemyPhase?.charges.some(charge => charge.to === at(g, 'D4')),
    'den-old-tusker: the first charge drops the two packmates, the leader slides to D1 and the boar lands on D4');
  assert(spiked(forecast(g, ['E6', 'D5'])) < 2, 'den-old-tusker: wounding the blocker in the rut weakens the first charge');
  assert(forecast(g, ['C5', 'C4', 'C3']).damageBySource.melee === 1, 'den-old-tusker: the west end under the sentry is bitten');
  for (const single of ['C5', 'E5', 'C6', 'E6']) {
    const out = start('den-old-tusker');
    await chain(out, [single], `den-old-tusker single ${single}`);
    assert(out.state.board[at(out, 'D4')]?.intent.charge?.dy === 1, `den-old-tusker: after the single hit ${single} the boar charges down, away from the leader`);
  }
  await chain(g, PLANS['den-old-tusker'].route[0] as string[], 'den-old-tusker climb');
  assert(g.state.board[at(g, 'D4')]?.intent.charge?.dy === -1, 'den-old-tusker: from E3 the boar aims up again');
  // Burning the ring on turn 2 (the longest chain) still drops the leader, but the authored fuel for power 9 is gone and
  // the boar keeps all 8 HP next to the cat (its ram is 3).
  const burn = copyOf('den-old-tusker', g);
  const ringIds = ['F3', 'G3', 'G2', 'G1', 'F1', 'F2', 'E2', 'E1'].map(cell => burn.state.board[at(burn, cell)]!.id);
  await chain(burn, ['F3', 'G3', 'G2', 'G1', 'F1', 'F2', 'E2', 'E1'], 'den-old-tusker ring burn');
  const tusk = burn.state.board.find(cell => cell?.elite === true)!;
  assert(tusk && tusk.hp === 8 && heroStrikeDamage(tusk) === 3 && targetsLeft(burn) === 1 && !burn.state.board.some(cell => cell && ringIds.includes(cell.id)),
    'den-old-tusker: burning the ring on turn 2 leaves the 8-HP boar (ram 3) without the authored fuel');
  const wait = await chain(g, PLANS['den-old-tusker'].route[1] as string[], 'den-old-tusker wait');
  assert(targetDeaths(g, wait) === 1 && wait.damage === 0 && g.state.board[at(g, 'D1')]?.elite, 'den-old-tusker: the second charge drops the leader, the boar lands on D1');
  assert(targetsLeft(g) === 1, 'den-old-tusker: the leader is dead after turn 2');
  const ring = forecast(g, PLANS['den-old-tusker'].route[2] as string[]);
  assert(ring.hits.some(hit => hit.index === at(g, 'D1') && hit.killed) && ring.damage === 0 && ring.unlocksExit, 'den-old-tusker: the intact ring (power 9) kills the boar and opens the door');
}

/** Every valid chain from the cat (a full depth-first walk, single hits included) — for exhaustive first-move checks. */
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

/**
 * Old tusker, exhaustive over the first action on rows 10–12 and entry energy 0/3/7: no first chain (single hits
 * included), jump or spin kills the boar, and after none of them can a second action (every chain of the second turn's
 * sample, every jump, the spin) meet both goals — the goals take at least three turns (review 04.10.2026).
 */
async function tuskerFirstTurn() {
  for (const row of BRANCH_ROWS) for (const energy of ENERGIES) {
    const g = start('den-old-tusker', 0, energy, 5, row), boar = at(g, 'D7'), before = json(g.state), where = `den-old-tusker row ${row} energy ${energy}`;
    const kills = (preview: ChainPreview) => preview.valid && preview.hits.some(hit => hit.index === boar && hit.killed);
    const first: { label: string; commit: (e: ForestEngine) => Promise<unknown> }[] = [];
    for (const cells of allChains(g)) {
      assert(!kills(g.preview(cells)), `${where}: no first chain kills the boar`);
      first.push({ label: cells.map(index => label(g, index)).join('-'), commit: e => chain(e, cells.map(index => label(e, index)), `${where} first`) });
    }
    for (let cell = 0; cell < g.state.board.length; cell++) {
      const jump = g.previewAbility('jump', cell);
      assert(!kills(jump), `${where}: no first jump kills the boar`);
      if (jump.valid) first.push({ label: `jump ${label(g, cell)}`, commit: e => step(e, { jump: label(e, cell) }, `${where} first`) });
    }
    const spin = g.previewAbility('spin');
    assert(spin.valid === energy >= 3 && !kills(spin), `${where}: the first spin does not kill the boar`);
    if (spin.valid) first.push({ label: 'spin', commit: e => step(e, { spin: true }, `${where} first`) });
    assert(json(g.state) === before, `${where}: the previews keep the state`);
    for (const action of first) {
      const e = copyOf('den-old-tusker', g);
      await action.commit(e);
      if (e.state.phase !== 'PLAYER_INPUT') continue;
      assert(!goalsMet(e), `${where}: ${action.label} does not meet the goals on turn 1`);
      const seconds: ChainPreview[] = e.availableMoves(16).map(cells => e.preview(cells));
      for (let cell = 0; cell < e.state.board.length; cell++) seconds.push(e.previewAbility('jump', cell));
      seconds.push(e.previewAbility('spin'));
      assert(!seconds.some(p => p.valid && (p.unlocksExit || p.enemyPhase?.unlocksExit)), `${where}: after ${action.label} no second action meets both goals`);
    }
    if (row === ROW && energy === 0) console.log(`den-old-tusker: ${first.length} first actions checked per row and energy`);
  }
}

/** Doors: closed at the start; `near` — the chain that meets the goals enters it; `turn` — the goals open it, entry next turn. */
async function exits() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const g = start(id), door = at(g, plan.door);
    assert(doorOf(g) === door && g.state.board[door]!.intent.label === 'Выполни цели', `${id}: the door on ${plan.door} is closed at the start`);
    if (plan.exitSearch) continue;
    for (const action of plan.route.slice(0, -1)) await step(g, action, `${id} exit`);
    const last = plan.route.at(-1) as string[];
    if (plan.exit === 'turn') {
      assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g) && (g.state.board[door]!.intent.label as string) === 'Выход открыт', `${id}: the goals are met and the door is open`);
      assert(last.length === 1 && last[0] === plan.door, `${id}: the door is entered on the next turn`);
    }
    const into = g.preview(path(g, last));
    assert(into.valid && into.opensDoor === door && into.completesRoom && !into.enemyPhase, `${id}: the last chain enters the door before the enemies answer`);
    if (plan.exit !== 'near') continue;
    const stay = g.preview(path(g, last.slice(0, -1)));
    assert(stay.valid && !stay.completesRoom && stay.opensDoor === undefined && stay.unlocksExit, `${id}: the same chain without the door only opens it`);
  }
  assert(targetsLeft(start('den-old-tusker')) === 2, 'den-old-tusker: two marked targets (the leader and the old boar)');
}

/** The designed routes hold on the first and the last row of the branch as well (rows 10 and 12). */
async function otherRows() {
  for (const row of [10, 12]) for (const [id, plan] of Object.entries(PLANS)) for (const variant of [0, SPREAD[3]]) {
    const g = start(id, variant, 0, 5, row), where = `${id} row ${row} seed ${variant}`;
    const { goalHp } = await playRoute(id, g, plan.route, where);
    assert(g.state.phase === 'WIN' && goalHp === plan.hp, `${where}: the designed route wins with ${plan.hp} HP at the goals, got ${g.state.phase} ${goalHp}`);
  }
}

/**
 * Protracted variant (as in campBranchBattles.spec.ts): the cat spends nine turns on short safe chains that do not hit
 * the beasts, the elites, any enemy with HP or a marked target (unless only such a hit still delays the goals), do not
 * meet the goals and end as far from the targets as possible (a boar may still ram a target in between); then a search over real actions (chains, jump, spin)
 * meets the goals on turn 10–16, and a second search reaches the door — late goals are no dead end.
 */
async function protracted() {
  const special = (g: ForestEngine, index: number) => {
    const cell = g.state.board[index];
    return !!cell && (!!cell.variant || !!cell.elite || cell.hp > 0 || g.state.tutorial!.targetIds.includes(cell.id));
  };
  // A waiting cat keeps away from the targets (it does not line up a boar on them by accident).
  const awayFrom = (g: ForestEngine, p: ChainPreview) => {
    const end = p.enemyPhase?.heroIndex ?? p.endIndex, cols = g.state.cols;
    return Math.min(...g.state.board.flatMap((cell, index) => cell && g.state.tutorial!.targetIds.includes(cell.id)
      ? [Math.max(Math.abs(index % cols - end % cols), Math.abs(Math.floor(index / cols) - Math.floor(end / cols)))] : []));
  };
  const lines: string[] = [];
  let forced = 0, late = 0;
  for (const id of Object.keys(PLANS)) for (const variant of SPREAD.slice(0, 3)) {
    const g = start(id, variant), where = `${id} protracted seed ${variant}`;
    for (let turn = 0; turn < 9; turn++) {
      const delaying = g.availableMoves(16).map(cells => ({ cells, p: g.preview(cells) }))
        .filter(move => move.p.valid && !move.p.playerDies && !move.p.unlocksExit && !move.p.enemyPhase?.unlocksExit)
        .sort((a, b) => a.p.damage - b.p.damage || awayFrom(g, b.p) - awayFrom(g, a.p) || a.cells.length - b.cells.length);
      // Sparing the special enemies first; when only a hit on one of them still delays the goals (a boar about to
      // finish the targets), the waiting cat takes it.
      const spared = delaying.filter(move => !move.p.hits.some(hit => special(g, hit.index)));
      const moves = spared.length ? spared : delaying;
      // No delaying chain: every action, a rest included, meets the goals (a boar aimed along the rut finishes the last
      // wolf). The goals then come early; the exit is still checked below.
      if (!moves.length) { forced++; break; }
      await chain(g, moves[0].cells.map(index => label(g, index)), `${where} delay ${turn + 1}`);
    }
    const delayed = g.state.turn;
    assert(g.state.phase === 'PLAYER_INPUT' && !goalsMet(g), `${where}: still fighting after the delaying turns`);
    const actions = () => {
      const out: { action: Step; p: ChainPreview }[] = g.availableMoves(16).map(cells => ({ action: cells.map(index => label(g, index)), p: g.preview(cells) }));
      for (let cell = 0; cell < g.state.board.length; cell++) out.push({ action: { jump: label(g, cell) }, p: g.previewAbility('jump', cell) });
      out.push({ action: { spin: true }, p: g.previewAbility('spin') });
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
    assert(goalTurn <= 16 && (delayed < 9 || goalTurn >= 10), `${where}: late goals on turn ${goalTurn}`);
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
  await tuskerFirstTurn();
  await exits();
  await replayAndRandomRefill();
  await routes();
  await otherRows();
  await protracted();
  console.log('den branch battles: ok');
}

main().catch(error => { console.error(error); throw error; });
