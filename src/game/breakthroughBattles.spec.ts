/**
 * New breakthroughs of row 13 (04.10.2026): den-boar-burrow «Кабан в лазе» (src/game/run/battles/den.ts) and
 * camp-arrow-gate «Ворота под стрелами» (camp.ts); cards: docs/levels/forest-branch-den.md, forest-branch-camp.md.
 * They stand in the breakthrough pools of their branch (battlePools.ts, row 13), not on a fixed node: every battle starts
 * through ForestEngine.startRunBattle as a node battle on row 13 — the row palette (five colors), the tools guaranteed
 * there (frost, jump, spin), 5/5 HP, no items, entry energy 0, 3 or 7 (the run carries energy between nodes).
 * Checks with real commands: the goal «hold one turn» is met in the enemy phase of turn 1 (forecast «ВЫХОД ОТКРОЕТСЯ
 * ПОСЛЕ ОТВЕТА ВРАГОВ»), no first action wins, the chest falls and the reinforcement is due after turn 4; the designed
 * first chains keep 5 HP and reach the door on spread refill seeds and every entry energy (the way over refilled cells
 * is found by a search over real chains, never fixed); the traps of each card are visible in the forecast; forecast
 * equals execution; the same seed and actions replay identically; refills stay random within the palette and survivors
 * keep their colors; a cat that delays the exit for several turns still reaches the door. Heuristic bot results are
 * deliberately not asserted (docs/level-metrics.md).
 */
import { hasOrdinaryChain } from './boardGeneration';
import { nextReinforcementTurn, REINFORCEMENT_DELAY } from './exitRules';
import { ForestEngine } from './forestEngine';
import { planChain } from './forestSystems';
import type { ChainPreview } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { battlePoolEntry, BATTLE_POOLS } from './run/battlePools';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

const ROW = 13;
/** Spread refill variants: neighbouring small seeds give almost the same first draws of the battle RNG. */
const SPREAD = Array.from({ length: 12 }, (_, k) => Math.imul(k + 1, 2654435761) >>> 0);
const ENERGIES = [0, 3, 7];

interface Plan {
  branch: 'den' | 'camp';
  /** The breakthrough the branch had before (a different main enemy and field). */
  previous: string;
  door: string;
  /** Designed first chains that keep 5 HP; the first one is the card's main line. */
  routes: string[][];
}
const PLANS: Record<string, Plan> = {
  // Beside the lair mouth, out of the boar's rut: around the porcupine to E3, or through the wolf pack to C3.
  'den-boar-burrow': { branch: 'den', previous: 'den-breakout', door: 'D1', routes: [['E5', 'F4', 'E3'], ['C6', 'B5', 'B4', 'B3', 'C3']] },
  // The dead zone under the campfire after its guard; the near archer silenced by a run-up along its own line (the cat
  // then stands beside the gate); the far corner after its guard.
  'camp-arrow-gate': { branch: 'camp', previous: 'camp-gate-run', door: 'C1', routes: [['D5', 'C4', 'C3'], ['C5', 'B4', 'B3', 'B2', 'B1'], ['B6', 'A6', 'A5', 'A4', 'A3']] },
};

function setupFor(id: string, player: RunPlayerResources = { hp: 5, maxHp: 5, energy: 0 }): RunBattleSetup {
  const battle = forestBattle(id)!, tools = guaranteedRowTools(ROW)!;
  return { nodeId: `spec:${id}`, label: battle.name, seed: battle.definition.seed, template: { kind: 'battle', id }, row: ROW, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, ROW) };
}
/** A fresh battle; `variant` replaces the refill RNG as the level analyzer does (the authored start stays). */
function start(id: string, variant = 0, energy = 0, hp = 5): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setupFor(id, { hp, maxHp: 5, energy })), `${id}: starts as a node battle on row ${ROW}`);
  if (variant) { const snap = g.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); g.restoreAnalysisSnapshot(snap); }
  return g;
}
function copyOf(id: string, g: ForestEngine): ForestEngine {
  const copy = new ForestEngine(); copy.animationScale = 0;
  assert(copy.startRunBattle(setupFor(id, { hp: g.state.player.hp, maxHp: 5, energy: g.state.player.energy })), `${id}: copy starts`);
  copy.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  return copy;
}
const at = (g: ForestEngine, label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
const label = (g: ForestEngine, index: number) => `${String.fromCharCode(65 + index % g.state.cols)}${Math.floor(index / g.state.cols) + 1}`;
const path = (g: ForestEngine, labels: string[]) => labels.map(cell => at(g, cell));
const doorOf = (g: ForestEngine) => g.state.board.findIndex(cell => cell?.kind === 'door');
const goalsMet = (g: ForestEngine) => g.state.customLevel!.goalCompletedTurn !== null;
const heroEnd = (p: ChainPreview) => p.enemyPhase?.heroIndex ?? p.endIndex;

/** Shared checks after any committed action: forecast = execution, survivors keep colors, refills are random and armed. */
function afterAction(g: ForestEngine, preview: ChainPreview, before: { hp: number; colors: Map<number, number | null> }, where: string) {
  const { state } = g;
  assert(state.player.hp === Math.max(0, before.hp - preview.damage), `${where}: HP ${state.player.hp} matches the forecast damage ${preview.damage}`);
  assert((state.phase === 'LOSE') === !!preview.playerDies, `${where}: death matches the forecast`);
  assert((state.phase === 'WIN') === !!preview.completesRoom, `${where}: victory ${state.phase} matches the forecast`);
  if (state.phase === 'PLAYER_INPUT') assert(state.player.index === heroEnd(preview), `${where}: cat position matches the forecast`);
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
 * The walk to the door over refilled cells: a breadth search over real chains on copies of the battle. Each turn it
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
        .map(({ move, preview }) => ({ move, score: distance(heroEnd(preview)) * 10 + preview.damage * 25 }))
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
/** The door is open: the found walk is played and wins only on entering. Returns the turns it took. */
async function walkToExit(id: string, g: ForestEngine, where: string, maxTurns: number): Promise<number> {
  assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g), `${where}: the goal is met and the battle goes on`);
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

function layouts() {
  const palette = forestRowPalette(ROW);
  assert(palette.length === 5, 'row 13: five colors');
  for (const [id, plan] of Object.entries(PLANS)) {
    const battle = forestBattle(id)!, { definition } = battle, entry = battlePoolEntry(id), previous = battlePoolEntry(plan.previous)!;
    assert(battle && !validateNodeBattle(battle).length, `${id}: ${battle ? validateNodeBattle(battle).join(' ') : 'not in the registry'}`);
    assert(id.startsWith(`${plan.branch}-`), `${id}: ${plan.branch} id`);
    assert(entry && entry.type === 'breakthrough' && json(entry.rows) === json([13, 13]) && entry.branch === plan.branch && !entry.requires.length,
      `${id}: a breakthrough of the ${plan.branch} pool on row 13 that needs no tool`);
    assert(previous.type === 'breakthrough' && previous.branch === plan.branch && entry.main !== previous.main, `${id}: its main enemy differs from ${plan.previous}`);
    const breakthroughs = Object.entries(BATTLE_POOLS).filter(([, other]) => other.type === 'breakthrough' && other.branch === plan.branch).map(([other]) => other);
    assert(breakthroughs.length >= 2 && breakthroughs.includes(id) && breakthroughs.includes(plan.previous), `${id}: the ${plan.branch} breakthrough pool has more than one battle`);
    assert(json(definition.goals) === json([{ key: 'turns', target: 1 }]) && definition.completion === 'exit' && definition.doors.length === 1,
      `${id}: the goal is to hold one turn, the battle ends through its one door`);
    assert(definition.doors[0].index === cellIndexOf(definition.cols, plan.door), `${id}: the door on ${plan.door}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${id}: field 5x5..7x7`);
    const occupied = new Set([...definition.enemies.map(enemy => enemy.index), ...definition.doors.map(door => door.index), definition.heroIndex]);
    definition.terrain.forEach((terrain, cell) => assert(occupied.has(cell) === (terrain === 'floor' || terrain === 'puddle' || terrain === 'thorns'), `${id}: every walkable square is authored`));
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(palette.every(color => colors.has(color)), `${id}: the opening uses the five colors of row ${ROW}`);
    assert(json(authoredRefillPalette(battle, ROW)) === json([100, 100, 100, 100, 100]), `${id}: the refill palette is the row palette`);
    // Ordinary authored enemies stand in same-color groups (a beast of that color counts as a neighbour).
    for (const enemy of definition.enemies.filter(enemy => !enemy.variant && enemy.kind === 'melee')) {
      const x = enemy.index % definition.cols, y = Math.floor(enemy.index / definition.cols);
      const grouped = definition.enemies.some(other => other !== enemy && other.color === enemy.color
        && Math.max(Math.abs(other.index % definition.cols - x), Math.abs(Math.floor(other.index / definition.cols) - y)) === 1);
      assert(grouped, `${id}: the ${'RGBOV'[enemy.color ?? 0]} enemy at ${String.fromCharCode(65 + x)}${y + 1} has a same-color neighbour`);
    }
    const shape = (d: typeof definition) => `${d.cols}x${d.rows}:${d.terrain.map(tile => tile === 'floor' ? '.' : '#').join('')}`;
    assert(shape(definition) !== shape(forestBattle(plan.previous)!.definition), `${id}: its own field, not the one of ${plan.previous}`);
  }
}
const cellIndexOf = (cols: number, cell: string) => (Number(cell.slice(1)) - 1) * cols + cell.charCodeAt(0) - 65;

/**
 * The first turn of a breakthrough, exhaustively on every entry energy: the door is closed; no first action (every chain,
 * single hits included, every jump, the spin) wins or meets the goal during the action — the goal is met only in the
 * enemy phase, so every survivable action is forecast as «ВЫХОД ОТКРОЕТСЯ ПОСЛЕ ОТВЕТА ВРАГОВ». After the designed first
 * chain the chest has fallen, the door is open and the reinforcement is due after turn 4.
 */
async function firstTurn() {
  for (const [id, plan] of Object.entries(PLANS)) {
    for (const energy of ENERGIES) {
      const g = start(id, 0, energy), before = json(g.state), where = `${id} energy ${energy}`, door = at(g, plan.door);
      assert(g.state.board[door]?.kind === 'door' && g.state.board[door]!.intent.label === 'Выполни цели', `${where}: the door is closed at the start`);
      const previews: { name: string; p: ChainPreview }[] = allChains(g).map(cells => ({ name: cells.map(index => label(g, index)).join('-'), p: g.preview(cells) }));
      for (let cell = 0; cell < g.state.board.length; cell++) {
        const jump = g.previewAbility('jump', cell);
        if (jump.valid) previews.push({ name: `jump ${label(g, cell)}`, p: jump });
      }
      const spin = g.previewAbility('spin');
      assert(spin.valid === energy >= 3, `${where}: the spin is available from 3 energy`);
      if (spin.valid) previews.push({ name: 'spin', p: spin });
      for (const { name, p } of previews) {
        assert(!p.completesRoom && !p.unlocksExit && p.opensDoor === undefined, `${where}: ${name} neither wins nor opens the door during the action`);
        assert(p.playerDies || p.enemyPhase?.unlocksExit, `${where}: ${name} is forecast to open the exit after the enemies answer`);
      }
      assert(json(g.state) === before, `${where}: the previews keep the state`);
      if (energy === 0) console.log(`${id}: ${previews.length} first actions, none wins on turn 1`);
    }
    const g = start(id);
    assert(g.state.board.every(cell => !cell?.chest), `${id}: no chest before the first turn ends`);
    await chain(g, plan.routes[0], `${id} first turn`);
    assert(g.state.customLevel!.goalCompletedTurn === 1 && g.state.board.some(cell => !!cell?.chest), `${id}: the chest falls at the end of the first turn`);
    assert(g.state.board[at(g, plan.door)]!.intent.label === 'Выход открыт', `${id}: the door is open after turn 1`);
    assert(nextReinforcementTurn(g.state) === 1 + REINFORCEMENT_DELAY, `${id}: the reinforcement is due after turn 4`);
  }
}

/** The main decision of each card and its traps are visible in the forecast before the chain is released. */
async function traps() {
  const forecast = (g: ForestEngine, labels: string[]) => {
    const before = json(g.state), result = g.preview(path(g, labels));
    assert(json(g.state) === before && result.valid, `${labels.join('-')}: a pure valid forecast (${result.reason})`);
    return result;
  };
  const enemyKind = (g: ForestEngine, cell: string) => g.state.board[at(g, cell)];

  // Boar in the burrow: it is aimed down its rut D3–D5 out of the lair mouth D2.
  let g = start('den-boar-burrow');
  const boar = enemyKind(g, 'D2')!;
  assert(boar.variant === 'boar' && json(boar.intent.cells.map(index => label(g, index))) === json(['D3', 'D4', 'D5']), 'den-boar-burrow: the boar in the mouth is aimed down its rut');
  // The straight run up the rut ends under the boar: rammed for 2 and swept back to the start.
  const rut = forecast(g, ['D5', 'D4', 'D3']);
  assert(rut.damage === 2 && rut.damageBySource.charge === 2 && label(g, heroEnd(rut)) === 'D6', 'den-boar-burrow: the run up the rut is rammed for 2 and thrown back to D6');
  // Behind a body in the rut: no ram, but the row is shoved down — the cat lands back on D6, far from the lair.
  const behind = forecast(g, ['E6', 'D5', 'D4']);
  assert(behind.damage === 0 && label(g, heroEnd(behind)) === 'D6' && (behind.enemyPhase?.deaths ?? []).some(death => death.cause === 'ram'), 'den-boar-burrow: a body in front takes the ram, the cat is shoved back');
  // Beside the mouth: the moss shortcut through the porcupine costs a quill, the way around it nothing.
  const quill = forecast(g, ['E5', 'E4', 'E3']);
  assert(quill.spikeDamage === 1 && quill.damage === 1, 'den-boar-burrow: the shortcut through the porcupine costs a quill');
  const around = forecast(g, PLANS['den-boar-burrow'].routes[0]);
  assert(around.damage === 0 && label(g, heroEnd(around)) === 'E3' && around.enemyPhase?.charges.some(charge => charge.from === at(g, 'D2') && charge.to !== at(g, 'D2')),
    'den-boar-burrow: around the porcupine the cat waits on E3 and the boar leaves the mouth');
  // The left side: with the pack intact a bite; the blue lane through the pack breaks it.
  const bitten = forecast(g, ['C5', 'C4']);
  assert(bitten.damage === 1 && bitten.damageBySource.melee === 1, 'den-boar-burrow: beside the pack the wolf bites');
  const pack = forecast(g, PLANS['den-boar-burrow'].routes[1]);
  assert(pack.damage === 0 && label(g, heroEnd(pack)) === 'C3', 'den-boar-burrow: the lane through the pack waits on C3 unbitten');
  // After the wait beside the mouth the vacated mouth leads into the lair: a two-cell chain, before the beasts answer.
  await chain(g, PLANS['den-boar-burrow'].routes[0], 'den-boar-burrow wait');
  assert(g.state.board[at(g, 'D2')]?.variant !== 'boar', 'den-boar-burrow: the mouth is free after the charge');
  const into = g.preview(path(g, ['D2', 'D1']));
  assert(into.valid && into.completesRoom && into.opensDoor === at(g, 'D1') && !into.enemyPhase, 'den-boar-burrow (authored seed): D2–D1 enters the lair before the beasts answer');

  // Arrow gate: from C6 the near archer B1 aims down B2–B4, the far one D1 down D2–D4; both cells beside the gate are
  // on a line, and every goblin on a line dies with the volley (the forecast lists them).
  g = start('camp-arrow-gate');
  assert(json(enemyKind(g, 'B1')!.intent.cells.map(index => label(g, index))) === json(['B2', 'B3', 'B4'])
    && json(enemyKind(g, 'D1')!.intent.cells.map(index => label(g, index))) === json(['D2', 'D3', 'D4']), 'camp-arrow-gate: the archers aim down both lanes to the gate');
  const deadZone = forecast(g, PLANS['camp-arrow-gate'].routes[0]);
  assert(deadZone.damage === 0 && (deadZone.enemyPhase?.deaths ?? []).filter(death => death.cause === 'arrow').length === 6, 'camp-arrow-gate: the dead zone is safe; the volley kills the six goblins on the lines');
  // A short run-up along the near line stops under its arrow; the full one kills the archer and the line stays silent.
  const short = forecast(g, ['C5', 'B4', 'B3', 'B2']);
  assert(short.damage === 1 && short.damageBySource.ranged === 1, 'camp-arrow-gate: stopping on B2 is shot');
  const silence = forecast(g, PLANS['camp-arrow-gate'].routes[1]);
  assert(silence.damage === 0 && silence.hits.some(hit => hit.index === at(g, 'B1') && hit.killed), 'camp-arrow-gate: the run-up of four kills the near archer, its line stays silent');
  // The long moss lane to the gate (the greedy line) ends under the far arrow.
  const moss = forecast(g, ['D6', 'E6', 'E5', 'D4', 'D3', 'D2']);
  assert(moss.damage === 1 && moss.damageBySource.ranged === 1, 'camp-arrow-gate: the long moss lane ends under the far arrow');
  // Beside a guard with a swing: bitten.
  const guard = forecast(g, ['B5', 'A5']);
  assert(guard.damage === 1 && guard.damageBySource.melee === 1, 'camp-arrow-gate: a pocket next to a swinging guard is bitten');
  // On the perch of the silenced archer the cat stands beside the gate: one cell into it.
  await chain(g, PLANS['camp-arrow-gate'].routes[1], 'camp-arrow-gate silence');
  const gate = g.preview(path(g, ['C1']));
  assert(gate.valid && gate.completesRoom && !gate.enemyPhase, 'camp-arrow-gate: from the perch the gate is entered before the enemies answer');
}

/** The designed first chains keep 5 HP and reach the door on spread seeds and every entry energy. */
async function routes() {
  for (const [id, plan] of Object.entries(PLANS)) for (const [n, route] of plan.routes.entries()) {
    const turns: number[] = [];
    for (const energy of ENERGIES) for (const variant of [0, ...SPREAD.slice(0, energy ? 4 : 12)]) {
      const g = start(id, variant, energy), where = `${id} route ${n + 1} energy ${energy} seed ${variant}`;
      await chain(g, route, `${where} turn 1`);
      assert(g.state.phase === 'PLAYER_INPUT' && g.state.player.hp === 5 && goalsMet(g), `${where}: the first turn keeps 5 HP and meets the goal`);
      const exit = await walkToExit(id, g, where, 3);
      const phase: string = g.state.phase;
      assert(phase === 'WIN' && g.state.player.hp === 5 && g.runBattleOutcome()?.won === true, `${where}: the door is entered with 5 HP, got ${phase} ${g.state.player.hp}`);
      turns.push(1 + exit);
    }
    const second = turns.filter(turn => turn === 2).length;
    assert(second * 4 >= turns.length * 3, `${id} route ${n + 1}: the door is mostly entered on turn 2 (${second} of ${turns.length})`);
    console.log(`${id} ${route.join('-')}: victory on turn ${turns.join(', ')}`);
  }
}

async function replayAndRandomRefill() {
  for (const [id, plan] of Object.entries(PLANS)) {
    const play = async (variant: number) => {
      const g = start(id, variant), snapshots: string[] = [];
      await chain(g, plan.routes[0], `${id} replay`);
      snapshots.push(json(g.captureAnalysisSnapshot()));
      await walkToExit(id, g, `${id} replay`, 3);
      snapshots.push(json(g.captureAnalysisSnapshot()));
      return snapshots;
    };
    assert(json(await play(SPREAD[2])) === json(await play(SPREAD[2])), `${id}: the same seed and actions replay identically`);
    const boards = new Set<string>();
    for (const variant of [0, ...SPREAD.slice(0, 5)]) {
      const g = start(id, variant);
      await chain(g, plan.routes[0], `${id} refill ${variant}`);
      boards.add(json(g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(boards.size > 1, `${id}: refills vary with the seed (colors are not fixed to coordinates)`);
  }
}

/** A cat arriving with 1 HP has a safe first chain. */
function woundedArrival() {
  for (const id of Object.keys(PLANS)) {
    const g = start(id, 0, 0, 1);
    assert(g.availableMoves(16).some(cells => { const p = g.preview(cells); return p.valid && !p.playerDies && p.damage === 0; }), `${id}: a safe first chain at 1 HP`);
  }
}

/**
 * Protracted variant: the goal is met after turn 1, then the cat delays the exit for six more turns on short safe
 * chains that keep away from the door (anger grows by one more enemy each turn, reinforcements and random elites come);
 * a search over real chains then still reaches the door — the delay is paid for, but it is no dead end.
 */
async function protracted() {
  for (const id of Object.keys(PLANS)) for (const variant of SPREAD.slice(0, 3)) {
    const g = start(id, variant), where = `${id} protracted seed ${variant}`, door = doorOf(g), cols = g.state.cols;
    const fromDoor = (index: number) => Math.max(Math.abs(index % cols - door % cols), Math.abs(Math.floor(index / cols) - Math.floor(door / cols)));
    for (let turn = 0; turn < 7 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const moves = g.availableMoves(16).map(cells => ({ cells, p: g.preview(cells) }))
        .filter(move => move.p.valid && !move.p.playerDies && !move.p.completesRoom)
        .sort((a, b) => a.p.damage - b.p.damage || fromDoor(heroEnd(b.p)) - fromDoor(heroEnd(a.p)) || a.cells.length - b.cells.length);
      assert(moves.length, `${where}: a delaying chain exists on turn ${turn + 1}`);
      await chain(g, moves[0].cells.map(index => label(g, index)), `${where} delay ${turn + 1}`);
    }
    assert(g.state.phase === 'PLAYER_INPUT' && goalsMet(g), `${where}: still in the battle after the delay`);
    const delayedTurn = g.state.turn, hp = g.state.player.hp, elites = g.state.board.filter(cell => cell?.elite).length;
    const turns = await walkToExit(id, g, where, 4);
    console.log(`${where}: door after turn ${delayedTurn} (${hp} HP, ${elites} elites on the field) in ${turns} turn(s), ${g.state.player.hp} HP left`);
  }
}

async function main() {
  layouts();
  await firstTurn();
  await traps();
  woundedArrival();
  await routes();
  await replayAndRandomRefill();
  await protracted();
  console.log('breakthrough battles: ok');
}

main().catch(error => { console.error(error); throw error; });
