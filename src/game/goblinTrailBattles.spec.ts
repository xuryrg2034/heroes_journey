/**
 * Goblin trail battles of 04.10.2026 for the pools of rows 5–8 (src/game/run/battles/goblins.ts, the two last entries;
 * docs/levels/forest-nodes-goblins.md, «Новые бои тропы»). They are not bound to a node: the generated map may put them
 * on any trail row, so the routes are played on rows 5 and 8 at entry energy 0 and 3, the palette and the tools are
 * checked on every row 5–8. Every battle starts through ForestEngine.startRunBattle exactly as in a run.
 * The checks play real commands: intended routes on spread refill seeds, forecast against execution, the traps of the
 * main decision visible in the forecast, replay by seed, no action that meets the goals at once, refill variety and a
 * protracted variant (goals on turns 10–14 still leave a way out). Ways over refilled cells are found by a search over
 * real moves, never fixed. No bot is expected to win or lose.
 */
import { hasOrdinaryChain } from './boardGeneration';
import { ForestEngine } from './forestEngine';
import { planChain } from './forestSystems';
import type { ChainPreview } from './forestTypes';
import { battlePoolEntry } from './run/battlePools';
import { GOBLIN_BATTLES } from './run/battles/goblins';
import { forestBattle, validateNodeBattle } from './run/forestBattles';
import { authoredRefillPalette, forestRowPalette, guaranteedRowTools } from './run/forestMap';
import type { RunBattleSetup, RunPlayerResources } from './run/runBattle';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const json = (value: unknown) => JSON.stringify(value);

const TRAIL_IDS = ['goblin-watch-relief', 'goblin-pike-gate'];
/** Every row of the trail band; the routes are played on its ends. */
const TRAIL_ROWS = [5, 6, 7, 8];
const ROUTE_ROWS = [5, 8];
/** Spread refill seeds (golden ratio): neighbouring small seeds barely differ in the first draws. */
const SEEDS = [1, 2, 3, 4, 5, 13, 14, 15].map(k => Math.imul(k, 2654435761) >>> 0);
const ENERGIES = [0, 3];

function setupFor(id: string, seed: number, energy = 0, row = 5, hp = 5): RunBattleSetup {
  const battle = forestBattle(id)!, tools = guaranteedRowTools(row)!;
  const player: RunPlayerResources = { hp, maxHp: 5, energy };
  return { nodeId: `spec-${id}`, label: battle.name, seed, template: { kind: 'battle', id }, row, player,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [...tools.items], allowedAbilities: [...tools.abilities],
    paletteWeights: authoredRefillPalette(battle, row) };
}

type Action = { chain: string[] } | { ability: 'jump' | 'spin'; target?: string };

/**
 * Every valid chain from the cat, by a full walk over chain neighbours (as beastTrailBattles.spec.ts): `availableMoves`
 * merges paths with the same result and would miss some first chains.
 */
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

/** A running battle that records every committed action for the replay check. */
class Play {
  readonly g = new ForestEngine();
  readonly log: Action[] = [];
  readonly snapshots: string[] = [];
  constructor(readonly id: string, readonly seed: number, readonly energy = 0, readonly row = 5, hp = 5) {
    this.g.animationScale = 0;
    assert(this.g.startRunBattle(setupFor(id, seed, energy, row, hp)), `${id}: starts as a node battle (seed ${seed})`);
    this.snapshots.push(json(this.g.state));
  }
  get where() { return `${this.id} (seed ${this.seed}, energy ${this.energy}, row ${this.row})`; }
  at(label: string) { return (Number(label.slice(1)) - 1) * this.g.state.cols + label.charCodeAt(0) - 65; }
  cell(label: string) { return this.g.state.board[this.at(label)]; }
  label(index: number) { return String.fromCharCode(65 + index % this.g.state.cols) + (Math.floor(index / this.g.state.cols) + 1); }
  labels(indices: readonly number[]) { return indices.map(index => this.label(index)); }
  door() { return this.g.state.board.findIndex(cell => cell?.kind === 'door'); }
  preview(...labels: string[]): ChainPreview {
    const before = json(this.g.state), rng = this.g.captureAnalysisSnapshot().rng;
    const prediction = this.g.preview(labels.map(label => this.at(label)));
    assert(json(this.g.state) === before && this.g.captureAnalysisSnapshot().rng === rng, `${this.where}: preview ${labels.join('-')} is pure`);
    return prediction;
  }
  /** Commit a chain by real input and compare everything the forecast promised with the result. */
  async chain(...labels: string[]): Promise<ChainPreview> {
    const { g } = this, path = labels.map(label => this.at(label)), hp = g.state.player.hp;
    const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    const prediction = this.preview(...labels);
    assert(prediction.valid, `${this.where}: ${labels.join('-')} — ${prediction.reason}`);
    assert(g.beginChain(path[0]), 'chain starts');
    for (const step of path.slice(1)) assert(g.extendChain(step), `chain reaches ${step}`);
    assert(await g.releaseChain(), 'chain commits');
    this.after(prediction, hp, colors);
    this.log.push({ chain: labels });
    return prediction;
  }
  async ability(ability: 'jump' | 'spin', target?: string): Promise<ChainPreview> {
    const { g } = this, index = target === undefined ? undefined : this.at(target), hp = g.state.player.hp, energy = g.state.player.energy;
    const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
    const before = json(g.state);
    const prediction = g.previewAbility(ability, index);
    assert(json(g.state) === before, `${this.where}: ${ability} preview is pure`);
    assert(prediction.valid, `${this.where}: ${ability} ${target ?? ''} — ${prediction.reason}`);
    assert(await g.useAbility(ability, index), `${ability} commits`);
    assert(g.state.player.energy === energy - prediction.energyCost, `${ability}: energy spent as forecast`);
    this.after(prediction, hp, colors);
    this.log.push({ ability, target });
    return prediction;
  }
  private after(prediction: ChainPreview, hp: number, colors: Map<number, number | null>) {
    const { state } = this.g;
    assert(state.lastDamage === prediction.damage && state.player.hp === hp - prediction.damage, `${this.where}: damage ${state.lastDamage} matches forecast ${prediction.damage}`);
    assert(state.player.index === prediction.endIndex, `${this.where}: endpoint matches forecast`);
    assert((state.phase === 'LOSE') === !!prediction.playerDies, `${this.where}: death matches forecast`);
    assert((state.phase === 'WIN') === !!prediction.completesRoom, `${this.where}: completion matches forecast`);
    const alive = new Set(state.board.flatMap(cell => cell ? [cell.id] : []));
    if (state.phase === 'PLAYER_INPUT') {
      for (const death of prediction.enemyPhase?.deaths ?? []) assert(!alive.has(death.id), `${this.where}: forecast ${death.cause} death happened`);
      // Announced rotations the forecast marks active do happen: the swapped pair stands on the exchanged cells.
      for (const rotation of prediction.rotations.filter(entry => entry.active)) {
        if (alive.has(rotation.sourceId)) assert(state.board[rotation.to]?.id === rotation.sourceId, `${this.where}: forecast rotation ${this.label(rotation.from)} → ${this.label(rotation.to)} happened`);
      }
      assert(hasOrdinaryChain(state), `${this.where}: an ordinary chain is available after the turn`);
    }
    const palette = state.customLevel!.paletteWeights;
    for (const cell of state.board) {
      if (!cell || cell.kind !== 'melee' || cell.variant) continue;
      if (colors.has(cell.id)) assert(cell.color === colors.get(cell.id), `${this.where}: survivors keep their color`);
      else assert(cell.color !== null && palette[cell.color] > 0, `${this.where}: refills use the row palette`);
    }
    this.snapshots.push(json(state));
  }
  won(hp: number) { assert(this.g.state.phase === 'WIN' && this.g.state.player.hp === hp, `${this.where}: victory with ${hp} HP, got ${this.g.state.phase} ${this.g.state.player.hp}`); }
  /** Actions available now (chains, jumps, the spin) with their forecasts; `full` — every chain (allChains). */
  actions(full = false) {
    const { g } = this, list: { p: ChainPreview; commit: () => Promise<unknown>; kind: 'chain' | 'ability'; label: string }[] = [];
    for (const path of full ? allChains(g) : g.availableMoves(16)) {
      const p = g.preview(path);
      if (p.valid) list.push({ p, kind: 'chain', label: this.labels(path).join('-'), commit: async () => { g.beginChain(path[0]); for (const step of path.slice(1)) g.extendChain(step); await g.releaseChain(); } });
    }
    for (let index = 0; index < g.state.board.length; index++) {
      const p = g.previewAbility('jump', index);
      if (p.valid) list.push({ p, kind: 'ability', label: `jump ${this.label(index)}`, commit: () => g.useAbility('jump', index) });
    }
    const spin = g.previewAbility('spin');
    if (spin.valid) list.push({ p: spin, kind: 'ability', label: 'spin', commit: () => g.useAbility('spin') });
    return list;
  }
  /** The goals are met by this forecast (in the chain or after the enemies answer). */
  static meetsGoals(p: ChainPreview) { return !!(p.unlocksExit || p.enemyPhase?.unlocksExit || p.completesRoom); }
  /**
   * The way out over refilled cells: a search of real moves (no death, least damage first) for a chain into the open door
   * within `turns` turns, then committed by real input. Returns the number of turns it took.
   */
  async leave(turns: number): Promise<number> {
    const { g } = this, root = g.captureAnalysisSnapshot(), door = this.door();
    const search = async (depth: number): Promise<number[][] | null> => {
      const moves = g.availableMoves(16).map(path => ({ path, p: g.preview(path) })).filter(move => move.p.valid && !move.p.playerDies);
      const exit = moves.filter(move => move.p.completesRoom && move.path.at(-1) === door).sort((a, b) => a.p.damage - b.p.damage || a.path.length - b.path.length)[0];
      if (exit) return [exit.path];
      if (depth <= 1) return null;
      const snapshot = g.captureAnalysisSnapshot();
      for (const { path } of moves.sort((a, b) => a.p.damage - b.p.damage).slice(0, 8)) {
        assert(g.beginChain(path[0]) && path.slice(1).every(step => g.extendChain(step)) && await g.releaseChain(), 'search move commits');
        const rest = g.state.phase === 'PLAYER_INPUT' ? await search(depth - 1) : null;
        g.restoreAnalysisSnapshot(snapshot);
        if (rest) return [path, ...rest];
      }
      return null;
    };
    const plan = await search(turns);
    g.restoreAnalysisSnapshot(root);
    if (!plan) throw new Error(`${this.where}: the open door is reached within ${turns} turn(s)`);
    for (const path of plan) await this.chain(...this.labels(path));
    assert(this.g.state.phase === 'WIN' && this.g.state.player.index === door, `${this.where}: the cat leaves through the door`);
    return plan.length;
  }
}

/** Replay the recorded actions on a fresh engine with the same seed: every snapshot must repeat exactly. */
async function replayMatches(play: Play) {
  const again = new Play(play.id, play.seed, play.energy, play.row);
  assert(again.snapshots[0] === play.snapshots[0], `${play.id}: same start`);
  for (const [step, action] of play.log.entries()) {
    if ('chain' in action) await again.chain(...action.chain);
    else await again.ability(action.ability, action.target);
    assert(again.snapshots[step + 1] === play.snapshots[step + 1], `${play.id}: replay by seed repeats step ${step + 1}`);
  }
}

/**
 * No first action — every chain of the full walk (single hits included), jump, spin or rest — meets the goals, on both
 * ends of the band and energy.
 */
function noOneTurnGoals(id: string) {
  for (const row of ROUTE_ROWS) for (const energy of ENERGIES) {
    const play = new Play(id, SEEDS[0], energy, row);
    const actions = play.actions(true);
    assert(!Play.meetsGoals(play.g.previewRest()), `${play.where}: resting does not meet the goals`);
    assert(actions.some(action => action.label.split('-').length === 1 && action.kind === 'chain'), `${play.where}: single hits are among the first actions`);
    if (row >= 7 && energy >= 2) assert(actions.some(action => action.kind === 'ability'), `${play.where}: jumps are among the first actions`);
    const instant = actions.filter(action => Play.meetsGoals(action.p));
    assert(instant.length === 0, `${play.where}: no first action meets the goals (${instant.map(action => action.label).join(', ')})`);
  }
}

function layouts() {
  const battles = TRAIL_IDS.map(id => GOBLIN_BATTLES.find(battle => battle.id === id));
  assert(battles.every(Boolean), 'both trail battles are in the goblin registry');
  const frames = new Set<string>(), mains = new Set<string>();
  // Frames of the other goblin trail battles: a new battle has its own field shape and cat cell.
  for (const battle of GOBLIN_BATTLES.filter(entry => battlePoolEntry(entry.id)?.branch === 'goblins' && !TRAIL_IDS.includes(entry.id))) {
    const { definition } = battle;
    frames.add(`${definition.cols}x${definition.rows}:${definition.heroIndex}:${definition.terrain.map(terrain => terrain === 'wall' ? '#' : '.').join('')}`);
    mains.add(battlePoolEntry(battle.id)!.main);
  }
  const palette = forestRowPalette(5);
  for (const row of TRAIL_ROWS) assert(json(forestRowPalette(row)) === json(palette), `row ${row}: the trail palette has four colors`);
  for (const battle of battles) {
    const { definition } = battle!, pool = battlePoolEntry(battle!.id);
    assert(pool && pool.type === 'battle' && pool.branch === 'goblins' && json(pool.rows) === json([5, 8]) && pool.requires.length === 0,
      `${battle!.id}: a goblin trail battle of rows 5–8 without required tools`);
    assert(validateNodeBattle(battle!).length === 0, `${battle!.id}: ${validateNodeBattle(battle!).join(' ')}`);
    assert(definition.cols >= 5 && definition.cols <= 7 && definition.rows >= 5 && definition.rows <= 7, `${battle!.id}: field 5×5…7×7`);
    assert(definition.doors.length === 1 && definition.completion === 'exit', `${battle!.id}: one exit door`);
    // The opening uses exactly the four trail colors, so the refill palette is the row palette on every trail row.
    const colors = new Set(definition.enemies.flatMap(enemy => enemy.color === null ? [] : [enemy.color]));
    assert(json([...colors].sort()) === json([...palette].sort()), `${battle!.id}: opening uses the four trail colors`);
    for (const row of TRAIL_ROWS) {
      assert(json(authoredRefillPalette(battle!, row)) === json([100, 100, 100, 100, 0]), `${battle!.id}: refill palette of row ${row} is the row palette`);
    }
    const goalColors = battle!.targetIndices.map(index => definition.enemies.find(enemy => enemy.index === index)!.color);
    assert(goalColors.length === 2 && new Set(goalColors).size === goalColors.length, `${battle!.id}: two goals of different colors`);
    const frame = `${definition.cols}x${definition.rows}:${definition.heroIndex}:${definition.terrain.map(terrain => terrain === 'wall' ? '#' : '.').join('')}`;
    assert(!frames.has(frame), `${battle!.id}: own field shape and cat position`);
    frames.add(frame);
  }
  // The two new battles are remembered by different main enemies; the goblins one is new to the goblin trail pool.
  const [relief, pikes] = TRAIL_IDS.map(id => battlePoolEntry(id)!.main);
  assert(relief === 'archer' && pikes === 'goblin' && !mains.has(pikes), 'main enemies: the archer and the goblins');
  for (const row of TRAIL_ROWS) {
    const tools = guaranteedRowTools(row)!;
    assert(json(tools.items) === json(['frost']) && json(tools.abilities) === json(row >= 7 ? ['jump'] : []), `row ${row}: frost from row 5, the jump from row 7`);
  }
}

/** A cat arriving with 1 HP has at least one safe first chain in every battle. */
function woundedArrival() {
  for (const id of TRAIL_IDS) for (const row of ROUTE_ROWS) {
    const play = new Play(id, SEEDS[0], 0, row, 1);
    const safe = play.g.availableMoves(16).some(path => { const p = play.g.preview(path); return p.valid && !p.playerDies && p.damage === 0; });
    assert(safe, `${play.where}: a safe first chain exists at 1 HP`);
  }
}

/**
 * «Сменный дозор»: the archer X sits on the corner tower A1 (5 HP, beyond a jump), reachable only through the guard K
 * (B1) or A2, neither of its color. After its volley it rests and swaps with the side neighbour nearer the cat, so the
 * end of the first turn decides where it comes down. East of the diagonal it comes to B1, beside the moss lane D3–C2
 * and the door C1; south of it, to A2, where the lane reaches it only through B3 and the door is a turn further. Every first chain that ends south of the diagonal ends beside an
 * armed goblin (D6, E7, F7) and the forecast shows the blow. The guard Q (D2) is out of reach on the first turn and is
 * the second turn: its red lane E1/E2 is next to the eastern ends.
 */
async function watchRelief() {
  noOneTurnGoals('goblin-watch-relief');
  // The side of the descent is never a hidden roll: every first action (all chains, jumps on row 8, rest) whose forecast
  // costs nothing sends the archer to B1; every action that may send it to A2 — a southern end or a cell of the
  // diagonal A1–F6, where the side is drawn by the battle RNG — shows a blow in the forecast.
  for (const row of ROUTE_ROWS) for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('goblin-watch-relief', seed, energy, row), { g } = play, root = g.captureAnalysisSnapshot();
    const sides = new Map<string, Set<string>>();
    const entries = [...play.actions(true).map(action => ({ label: action.label, p: action.p, commit: action.commit })),
      { label: 'rest', p: g.previewRest(), commit: () => g.waitTurn() }];
    for (const action of entries) {
      await action.commit();
      const archer = g.state.board[play.at('A1')]!;
      assert(archer.kind === 'ranged' && archer.intent.moveTo !== undefined, `${play.where}: ${action.label} — the archer announces its descent`);
      const side = play.label(archer.intent.moveTo);
      g.restoreAnalysisSnapshot(root);
      if (action.p.damage === 0) assert(side === 'B1', `${play.where}: the free action ${action.label} sends the archer to B1, not ${side}`);
      const end = play.label(action.p.endIndex);
      sides.set(end, new Set([...sides.get(end) ?? [], side]));
    }
    for (const [end, seen] of sides) if (seen.has('A2')) assert(entries.filter(entry => play.label(entry.p.endIndex) === end).every(entry => entry.p.damage >= 1), `${play.where}: every action ending on ${end} shows a blow`);
  }
  for (const row of ROUTE_ROWS) for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('goblin-watch-relief', seed, energy, row), archer = play.cell('A1')!, guard = play.cell('B1')!;
    assert(archer.kind === 'ranged' && archer.hp === 5 && guard.hp === 2 && guard.color !== archer.color && play.cell('A2')!.color !== archer.color,
      'the tower: a 5-HP archer whose neighbours are not of its color');
    assert(json(archer.intent.cells) === json(['B1', 'C1', 'D1'].map(label => play.at(label))), 'the first volley runs along row 1');
    // The traps of the first turn: the long chains south of the diagonal end beside an armed goblin.
    for (const trap of [['F3', 'E4', 'D5', 'E6', 'F7'], ['E3', 'D4', 'E5', 'F6'], ['F3', 'E4', 'D5']]) {
      const p = play.preview(...trap);
      assert(p.valid && p.damage >= 1 && p.damage === p.damageBySource.melee, `${trap.join('-')}: the forecast shows the blow at the southern end`);
    }
    // Answer, turn 1: the ochre pair east of the diagonal (no Q yet: no red lane reaches it).
    const first = await play.chain('E3', 'F2');
    assert(first.damage === 0, 'the eastern end is safe');
    const resting = play.cell('A1')!;
    assert(resting.id === archer.id && resting.behavior.restTurns > 0 && resting.intent.moveTo === play.at('B1'),
      'the resting archer announces its swap toward the cat: down to B1');
    // Turn 2: the red lane takes the guard Q; the forecast shows the swap that comes with this enemy phase.
    const second = await play.chain('E1', 'D2');
    assert(second.damage === 0 && second.hits.at(-1)?.killed && second.rotations.some(rotation => rotation.active && rotation.from === play.at('A1') && rotation.to === play.at('B1')),
      'the guard falls and the forecast shows the swap A1 → B1');
    assert(play.cell('B1')?.id === archer.id && play.cell('A1')?.id === guard.id, 'the archer came down to B1, the guard went up');
    if (row >= 7) {
      const jump = play.g.previewAbility('jump', play.at('B1'));
      assert(!jump.valid && jump.reason.includes('погибнуть'), 'a jump (4) cannot take the 5-HP archer');
    }
    // Turn 3: the moss lane, four strong, kills the 5-HP archer and continues into the door.
    const out = await play.chain('D3', 'C4', 'C3', 'C2', 'B1', 'C1');
    assert(out.completesRoom && out.opensDoor === play.at('C1') && out.damage === 0, 'the moss lane takes the archer and leaves at once');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
  // The wrong side: a chain south of the diagonal sends the archer to A2, out of the lane's and the door's reach.
  for (const seed of SEEDS.slice(0, 3)) {
    const south = new Play('goblin-watch-relief', seed), archer = south.cell('A1')!;
    const p = await south.chain('F3', 'E4', 'D5');
    assert(p.damage === 1, 'the southern end costs a blow');
    assert(south.cell('A1')!.intent.moveTo === south.at('A2'), 'the archer will come down to A2');
    const keep = new Set(['A2', 'B3', 'C2', 'C3', 'C4', 'D3'].map(label => south.at(label)));
    const wait = south.g.availableMoves(16).map(path => ({ path, p: south.g.preview(path) }))
      .filter(move => move.p.valid && move.p.damage === 0 && move.path.every(index => !keep.has(index)))[0];
    assert(wait, 'a safe second chain away from the swap');
    const second = await south.chain(...south.labels(wait.path));
    assert(second.rotations.some(rotation => rotation.active && rotation.to === south.at('A2')), 'the forecast shows the swap A1 → A2');
    assert(south.cell('A2')?.kind === 'ranged' && south.cell('B1')?.kind !== 'ranged', 'the archer came down to A2, away from the door');
    // Not a dead end: within two turns a real chain (found by search) ends the archer on A2 through B3; the door C1 is
    // not next to A2.
    const { g } = south, root = g.captureAnalysisSnapshot();
    const kills = async (depth: number): Promise<boolean> => {
      const moves = g.availableMoves(16).map(path => ({ path, p: g.preview(path) })).filter(move => move.p.valid && !move.p.playerDies);
      if (moves.some(move => move.p.hits.some(hit => hit.index === south.at('A2') && hit.killed) && move.path.includes(south.at('B3')))) return true;
      if (depth <= 1) return false;
      const snapshot = g.captureAnalysisSnapshot();
      for (const { path } of moves.sort((a, b) => a.p.damage - b.p.damage).slice(0, 8)) {
        g.beginChain(path[0]); for (const step of path.slice(1)) g.extendChain(step); await g.releaseChain();
        const found = g.state.phase === 'PLAYER_INPUT' && g.state.board[south.at('A2')]?.id === archer.id && await kills(depth - 1);
        g.restoreAnalysisSnapshot(snapshot);
        if (found) return true;
      }
      return false;
    };
    assert(await kills(2), `${south.where}: the moss lane still reaches the archer on A2 within two turns`);
    g.restoreAnalysisSnapshot(root);
  }
}

/**
 * «Копья у ворот»: armed goblins strike their four sides, never the diagonals. The guard Q1 (C2, 3 HP) stands between
 * two pikes under the door C1, the guard Q2 (F4, 2 HP) between two pikes at the trail. Ending on a guard's cell costs
 * the pikes' blows, so Q2 is taken in passing — the red lane goes through it to E4 or F5 — and Q1 last: the chain that
 * kills it continues into the door and wins before the enemies answer.
 */
async function pikeGate() {
  noOneTurnGoals('goblin-pike-gate');
  for (const row of ROUTE_ROWS) for (const energy of ENERGIES) for (const seed of SEEDS) {
    const play = new Play('goblin-pike-gate', seed, energy, row);
    const pikes = ['B2', 'D2', 'F3', 'G4'].map(label => play.cell(label)!);
    assert(pikes.every(pike => pike.behavior.aggressive && pike.hp === 0), 'four armed pikes');
    assert(pikes[0].intent.cells.includes(play.at('C2')) && pikes[1].intent.cells.includes(play.at('C2')), 'two pikes strike the gate guard cell');
    assert(pikes[2].intent.cells.includes(play.at('F4')) && pikes[3].intent.cells.includes(play.at('F4')), 'two pikes strike the trail guard cell');
    // Traps: ending on the trail guard's cell, or taking the gate guard first.
    const onGuard = play.preview('D6', 'E5', 'F5', 'F4');
    assert(onGuard.valid && onGuard.hits.at(-1)?.killed && onGuard.damage === 2 && onGuard.damageBySource.melee === 2, 'the forecast shows both pikes on the guard cell');
    const gateFirst = play.preview('B6', 'C5', 'D4', 'C3', 'C2');
    assert(gateFirst.valid && gateFirst.hits.at(-1)?.killed && gateFirst.damage === 2 && !gateFirst.completesRoom && !gateFirst.unlocksExit,
      'the gate guard first: the door stays shut and both pikes strike');
    // Answer: through the trail guard to E4, beside the blue lane; then the blue lane takes the gate guard into the door.
    const lane = await play.chain('D6', 'E5', 'F5', 'F4', 'E4');
    assert(lane.damage === 0 && lane.hits.some(hit => hit.index === play.at('F4') && hit.killed), 'the red lane takes Q2 in passing and ends safe');
    if (row >= 7) {
      // The jump also takes the gate guard, but it does not enter the door: the cat lands between the pikes.
      const jump = play.g.previewAbility('jump', play.at('C2'));
      assert(jump.valid && jump.unlocksExit && !jump.completesRoom && jump.damage === 2 && jump.damageBySource.melee === 2, 'the jump to the gate guard lands between the pikes');
    }
    const out = await play.chain('D4', 'D3', 'C2', 'C1');
    assert(out.completesRoom && out.opensDoor === play.at('C1') && out.damage === 0, 'the gate guard falls and the chain leaves before the pikes answer');
    play.won(5);
    if (seed === SEEDS[0]) await replayMatches(play);
  }
}

/**
 * Protracted variant: the cat spends nine turns on short safe chains that spare the marked guards, the archer and
 * any enemy with HP, then a search of real moves meets the goals (turn 10–14) and a second search reaches the door.
 */
async function protracted() {
  const late: string[] = [];
  const special = (play: Play, index: number) => { const cell = play.g.state.board[index]; return !!cell && (!!cell.variant || cell.kind === 'ranged' || !!cell.elite || cell.hp > 0); };
  for (const id of TRAIL_IDS) for (const row of ROUTE_ROWS) for (const seed of SEEDS.slice(0, 3)) {
    const play = new Play(id, seed, 0, row);
    for (let turn = 0; turn < 9; turn++) {
      const moves = play.g.availableMoves(16).map(path => ({ path, p: play.g.preview(path) }))
        .filter(move => move.p.valid && !move.p.playerDies && !move.p.unlocksExit && !move.p.enemyPhase?.unlocksExit && !move.p.hits.some(hit => special(play, hit.index)))
        .sort((a, b) => a.p.damage - b.p.damage || a.path.length - b.path.length);
      assert(moves.length, `${play.where}: a safe delaying chain on turn ${turn + 1}`);
      await play.chain(...play.labels(moves[0].path));
    }
    const { g } = play;
    const progress = (p: ChainPreview) => p.hits.reduce((sum, hit) => sum + (special(play, hit.index) ? (g.state.board[hit.index]!.hp - (hit.hpAfter ?? 0)) * 10 : 0), 0) - p.damage * 8;
    const search = async (depth: number): Promise<boolean> => {
      if ((g.state.customLevel?.goalCompletedTurn ?? null) !== null) return true;
      if (depth === 0 || g.state.phase !== 'PLAYER_INPUT') return false;
      const snapshot = g.captureAnalysisSnapshot();
      for (const action of play.actions().filter(entry => !entry.p.playerDies).sort((a, b) => progress(b.p) - progress(a.p)).slice(0, 6)) {
        await action.commit();
        if (g.state.phase === 'PLAYER_INPUT' && await search(depth - 1)) return true;
        g.restoreAnalysisSnapshot(snapshot);
      }
      return false;
    };
    assert(await search(5), `${play.where}: the goals are still reachable after a slow start`);
    const goalTurn = g.state.customLevel!.goalCompletedTurn!;
    assert(goalTurn >= 10 && goalTurn <= 14, `${play.where}: late goals on turn ${goalTurn}`);
    const hp = g.state.player.hp, exit = await play.leave(3);
    late.push(`${id}@${row}/${seed}: goals ${goalTurn} (HP ${hp}), exit +${exit}, HP ${g.state.player.hp}`);
  }
  // Refill statistics, not a claim about any player: only reported.
  console.log(`protracted: ${late.join('; ')}`);
}

/** Refills after the same first move differ between seeds; the authored start never does. */
async function refillVariety() {
  const firstMoves: Record<string, string[]> = {
    'goblin-watch-relief': ['E3', 'F2'],
    'goblin-pike-gate': ['D6', 'E5', 'F5', 'F4', 'E4'],
  };
  for (const [id, move] of Object.entries(firstMoves)) {
    const starts = new Set<string>(), refills = new Set<string>();
    for (const seed of SEEDS.slice(0, 5)) {
      const play = new Play(id, seed);
      starts.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
      await play.chain(...move);
      refills.add(json(play.g.state.board.map(cell => cell?.color ?? null)));
    }
    assert(starts.size === 1, `${id}: the authored start is the same for every seed`);
    assert(refills.size > 1, `${id}: refills differ between seeds`);
  }
}

layouts();
woundedArrival();
await watchRelief();
await pikeGate();
await protracted();
await refillVariety();
console.log('goblin trail battles: layouts, routes on eight spread seeds on rows 5 and 8 at entry energy 0/3, traps in the forecast, no one-turn goals, replay, late goals and refill variety pass');
