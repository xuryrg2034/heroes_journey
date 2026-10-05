/**
 * Prototype A, check 7 of docs/random-coloring.md («Сценарий жив», section 4): with the random coloring of the ordinary
 * enemies, does each battle of the prototype still play its own idea?
 *
 * For every battle flagged `coloring: 'random'`, on spread battle seeds (Math.imul(k, 2654435761) >>> 0), on the first
 * and the last row of its pool band, entering with 0 energy and no items: a beam search over real commands
 * (beginChain / extendChain / releaseChain, depth up to 4 turns) looks for a line that meets the goals and plays the
 * scenario of the battle:
 * - boar-garden: a target dies from the boar's charge (ram, spikes, thorns or a pit in the enemy phase), not from a chain hit;
 * - goblin-shield-flank: at the start a chain of the shield bearer's own color (legal but for the shield) reaches it
 *   from the shield side and is rejected by the shield; and on the line the shield bearer (shield active) dies from a
 *   chain entering from another side;
 * - beast-quill-stop: the boar is stunned (the stun event of the enemy phase) and killed by a chain on a later turn;
 * - goblin-pike-gate: the target at the gate dies in a chain that enters the door with the same chain.
 * Every found line is replayed on fresh engines by real commands: forecast = execution on every turn (damage, death,
 * victory, forced deaths, the scenario events), and the same seed replays exactly with the same coloring.
 *
 * The search is staged (STAGES): a wider beam runs only on the seeds the narrower one did not solve; it is not
 * exhaustive, so «no line» is an upper estimate of the loss. The share of seeds with a living scenario is a statistic
 * over the coloring and the refill of these seeds, not the player and not a claim about a bot: the threshold is 95% per
 * battle and row, and seeds without the scenario are printed. The hook setColoringScenarioCheck is not used: the game
 * runs no scenario check.
 */
import { ForestEngine } from './forestEngine';
import type { ChainPreview, EngineEvent, ForestState } from './forestTypes';
import { BATTLE_POOLS } from './run/battlePools';
import { nodeAnalysisTargets } from './run/nodeAnalysis';
import type { RunBattleSetup } from './run/runBattle';
import { chargeDirection } from './boarCharge';
import { shieldBlocksEntry, shieldIsActive } from './combatRules';
import { planChain } from './forestSystems';
import { chainAdjacent, chainNeighbors } from './boardGeometry';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const json = (value: unknown) => JSON.stringify(value);
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;

type BattleId = 'boar-garden' | 'goblin-shield-flank' | 'beast-quill-stop' | 'goblin-pike-gate';
const PROTOTYPE: BattleId[] = ['boar-garden', 'goblin-shield-flank', 'beast-quill-stop', 'goblin-pike-gate'];
/**
 * Two modes. Short (default, `npm run test:prototype-scenario`, under a minute): 20 seeds per battle, the first row of
 * the band only, the first two search stages, soft threshold SHORT_THRESHOLD — a smoke check for verify-all. Full
 * (SCENARIO_FULL=1, a few minutes; run by hand before a playtest): 60 seeds, the first and the last row, every stage,
 * the threshold of check 7 (95%). Rows 5 and 8 gave the same numbers on 05.10.2026: with 0 energy the jump of row 7+
 * is unusable, and the palette and pressure of these rows are the same.
 * Overrides for iterating: SCENARIO_SEEDS — the first N spread seeds, SCENARIO_SEED_LIST — explicit seeds,
 * SCENARIO_ONLY — battle ids, SCENARIO_BEAM / SCENARIO_BRANCH — one search stage of that width.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const FULL = env.SCENARIO_FULL === '1';
const SEEDS = env.SCENARIO_SEED_LIST ? env.SCENARIO_SEED_LIST.split(',').map(Number)
  : Array.from({ length: Number(env.SCENARIO_SEEDS ?? (FULL ? 60 : 20)) }, (_, k) => spread(k + 1));
const ONLY = env.SCENARIO_ONLY?.split(',') ?? null;
/** Search depth in turns. */
const DEPTH = 4;
/**
 * Share of seeds on which the scenario must be alive, per battle and row: check 7 (95%) in the full mode; in the short
 * mode 85% (at most 3 of 20 seeds without a line found by the two narrower stages — the narrow search misses lines the
 * widest stage finds, so the short mode does not measure check 7, it catches a scenario that broke).
 */
const THRESHOLD = FULL ? 0.95 : 0.85;
const BOAR_CAUSES = new Set(['ram', 'spikes', 'thorns', 'pit']);

function setupOf(id: BattleId, row: number, seed: number): RunBattleSetup {
  const setup = { ...nodeAnalysisTargets(id, row)[0].setup, seed, coloring: 'random' as const };
  assert(setup.row === row && setup.player.energy === 0 && Object.values(setup.inventory).every(count => count === 0), `${id}: row ${row}, energy 0, no items`);
  return setup;
}
function start(setup: RunBattleSetup): ForestEngine {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), `${setup.template.id} (seed ${setup.seed}) starts`);
  assert(g.coloring?.attempt !== null && g.coloring?.attempt !== undefined, `${setup.template.id} (seed ${setup.seed}): the random coloring passed`);
  return g;
}
const fingerprint = (g: ForestEngine) => { const s = g.captureAnalysisSnapshot(); return json([s.state, s.rng, s.nextId]); };
const indexOf = (state: ForestState, id: number) => state.board.findIndex(cell => cell?.id === id);
const goalsMet = (state: ForestState) => state.phase === 'WIN' || (state.customLevel?.goalCompletedTurn ?? null) !== null;
const killedAt = (p: ChainPreview, index: number) => p.hits.some(hit => hit.index === index && hit.killed);

/** What a battle's scenario is about, read from its opening: the marked targets and the special enemies of the idea. */
interface Cast { targets: Set<number>; boarId?: number; sentinelId?: number; gateId?: number; sentinelColor?: number | null }
function castOf(id: BattleId, state: ForestState): Cast {
  const targets = new Set(state.tutorial!.targetIds), cells = state.board.flatMap((cell, index) => cell ? [{ cell, index }] : []);
  const cast: Cast = { targets };
  if (id === 'boar-garden' || id === 'beast-quill-stop') cast.boarId = cells.find(({ cell }) => cell.variant === 'boar')!.cell.id;
  if (id === 'goblin-shield-flank') {
    const sentinel = cells.find(({ cell }) => cell.variant === 'sentinel' && targets.has(cell.id))!.cell;
    cast.sentinelId = sentinel.id; cast.sentinelColor = sentinel.color;
  }
  if (id === 'goblin-pike-gate') {
    const door = cells.find(({ cell }) => cell.kind === 'door')!.index;
    cast.gateId = cells.find(({ cell, index }) => targets.has(cell.id) && chainAdjacent(state, index, door))!.cell.id;
  }
  return cast;
}

/** Scenario memory of a line: the scenario happened; the boar of beast-quill-stop has been stunned. */
interface Memory { hit: boolean; stunned: boolean }
/**
 * The scenario on one turn, by the full forecast of the chain from the position `before` (the same turn the execution
 * plays): `hit` — the scenario of the battle happened on this turn; `stun` — the boar is stunned in its enemy phase.
 */
function judge(id: BattleId, cast: Cast, before: ForestState, path: number[], p: ChainPreview, memory: Memory): { hit: boolean; stun: boolean } {
  switch (id) {
    case 'boar-garden':
      return { hit: !!p.enemyPhase?.deaths.some(death => cast.targets.has(death.id) && BOAR_CAUSES.has(death.cause)), stun: false };
    case 'goblin-shield-flank': {
      const at = indexOf(before, cast.sentinelId!), step = path.indexOf(at);
      if (at < 0 || step < 0 || !killedAt(p, at)) return { hit: false, stun: false };
      const from = step > 0 ? path[step - 1] : before.player.index, sentinel = before.board[at]!;
      return { hit: shieldIsActive(sentinel) && !shieldBlocksEntry(before, sentinel, from, at), stun: false };
    }
    case 'beast-quill-stop': {
      const at = indexOf(before, cast.boarId!);
      const stun = !!p.enemyPhase?.charges.some(charge => charge.boarId === cast.boarId && charge.stunned);
      return { hit: memory.stunned && at >= 0 && path.includes(at) && killedAt(p, at), stun };
    }
    case 'goblin-pike-gate': {
      const at = indexOf(before, cast.gateId!), step = path.indexOf(at);
      const door = path.findIndex(index => before.board[index]?.kind === 'door');
      return { hit: at >= 0 && step >= 0 && killedAt(p, at) && door > step && !!p.completesRoom, stun: false };
    }
  }
}

/** Search order of a chain by its forecast: scenario first, then the goals, target progress and little damage. */
function score(id: BattleId, cast: Cast, before: ForestState, path: number[], p: ChainPreview, memory: Memory): number {
  const verdict = judge(id, cast, before, path, p, memory);
  const goal = p.completesRoom || p.unlocksExit || p.opensDoor !== undefined || p.enemyPhase?.completesObjective || p.enemyPhase?.unlocksExit;
  let kills = 0, dealt = 0;
  for (const hit of p.hits) if (cast.targets.has(before.board[hit.index]?.id ?? -1)) { dealt += Math.min(hit.damage, hit.hpBefore); if (hit.killed) kills++; }
  kills += p.enemyPhase?.deaths.filter(death => cast.targets.has(death.id)).length ?? 0;
  let value = (verdict.hit && !memory.hit ? 1000 : 0) + (goal ? 300 : 0) + 100 * kills + 20 * dealt - 15 * p.damage + p.enemies;
  if (id === 'beast-quill-stop' && verdict.stun && !memory.stunned) value += 500;
  if (id === 'boar-garden' && !memory.hit) value += boarAimsAtTarget(cast, before, p) ? 250 : 0;
  const key = keyEnemy(id, cast), at = key === undefined ? -1 : indexOf(before, key);
  if (at >= 0 && !killedAt(p, at)) value -= 15 * cells(before.cols, at, p.enemyPhase?.heroIndex ?? p.endIndex);
  return value;
}
/** The enemy the idea is played on: the shield bearer, the gate target, the boar of beast-quill-stop (none in boar-garden). */
const keyEnemy = (id: BattleId, cast: Cast) => id === 'goblin-shield-flank' ? cast.sentinelId : id === 'goblin-pike-gate' ? cast.gateId : id === 'beast-quill-stop' ? cast.boarId : undefined;
/** Steps between two cells for a chain (8 directions). */
const cells = (cols: number, a: number, b: number) => Math.max(Math.abs(a % cols - b % cols), Math.abs(Math.floor(a / cols) - Math.floor(b / cols)));
/**
 * Shaping for boar-garden: after this turn the boar (alive) announces its charge toward the cat's cell along the
 * dominant axis; a living target in that ray is a candidate for the push next turn.
 */
function boarAimsAtTarget(cast: Cast, before: ForestState, p: ChainPreview): boolean {
  const at = indexOf(before, cast.boarId!);
  if (at < 0 || killedAt(p, at) || !p.enemyPhase) return false;
  const moved = (id: number, from: number) => p.enemyPhase!.moves.find(move => move.id === id)?.to ?? from;
  const boar = moved(cast.boarId!, at), cat = p.enemyPhase.heroIndex, { dx, dy } = chargeDirection(before.cols, boar, cat);
  const dead = new Set([...p.enemyPhase.deaths.map(death => death.id), ...p.hits.filter(hit => hit.killed).map(hit => before.board[hit.index]?.id)]);
  const targets = [...cast.targets].filter(id => !dead.has(id) && indexOf(before, id) >= 0).map(id => moved(id, indexOf(before, id)));
  for (let x = boar % before.cols + dx, y = Math.floor(boar / before.cols) + dy; x >= 0 && y >= 0 && x < before.cols && y < before.rows; x += dx, y += dy)
    if (targets.includes(y * before.cols + x)) return true;
  return false;
}

/**
 * Search order of a position after a turn: the cat near the enemy of the idea (the shield bearer, the gate target, the
 * boar of beast-quill-stop) and fuel of its color beside it where a chain may enter (not through an active shield, not
 * from the door).
 */
function positionValue(id: BattleId, cast: Cast, state: ForestState): number {
  const key = keyEnemy(id, cast), at = key === undefined ? -1 : indexOf(state, key);
  if (at < 0) return 0;
  const cell = state.board[at]!, distance = cells(state.cols, at, state.player.index);
  let fuel = 0;
  for (const from of chainNeighbors(state, at)) {
    const other = state.board[from];
    if (other && other.kind !== 'door' && other.color === cell.color && !shieldBlocksEntry(state, cell, from, at)) fuel++;
  }
  return -15 * distance + (id === 'beast-quill-stop' ? 0 : 50 * fuel);
}

async function play(g: ForestEngine, path: number[]): Promise<boolean> {
  if (!g.beginChain(path[0])) return false;
  for (const index of path.slice(1)) if (!g.extendChain(index)) { g.cancelChain(); return false; }
  return g.releaseChain();
}

interface Line { snap: ReturnType<ForestEngine['captureAnalysisSnapshot']>; paths: number[][]; memory: Memory; progress: number; value: number; cat: number }
/**
 * Search widths, tried in order until a line is found: states kept per turn and chains executed per state (the best by
 * forecast). A wider stage runs only on the seeds where the narrower one found nothing.
 */
const STAGES: readonly (readonly [number, number])[] = env.SCENARIO_BEAM
  ? [[Number(env.SCENARIO_BEAM), Number(env.SCENARIO_BRANCH ?? 10)]] : FULL ? [[16, 10], [60, 30], [120, 40]] : [[16, 10], [60, 30]];
/** At most this many lines per cell of the cat enter the beam before the rest fills it (positional variety). */
const PER_CELL = 2;

/**
 * Beam search over real chains: a line that meets the goals with the cat alive and plays the scenario, or null. A line
 * whose goals are met, or whose enemy of the idea is dead, without the scenario is dropped: the scenario can no longer
 * happen on it.
 */
async function findLine(id: BattleId, setup: RunBattleSetup, beamWidth: number, branch: number): Promise<number[][] | null> {
  const root = start(setup), cast = castOf(id, root.state), worker = new ForestEngine(); worker.animationScale = 0;
  const key = keyEnemy(id, cast);
  let beam: Line[] = [{ snap: root.captureAnalysisSnapshot(), paths: [], memory: { hit: false, stunned: false }, progress: 0, value: 0, cat: root.state.player.index }];
  for (let turn = 0; turn < DEPTH && beam.length; turn++) {
    const next: Line[] = [], seen = new Set<string>();
    for (const line of beam) {
      worker.restoreAnalysisSnapshot(line.snap);
      const before = structuredClone(worker.state);
      const ranked = worker.availableMoves().map(path => ({ path, p: worker.preview(path) }))
        .filter(({ p }) => p.valid && !p.playerDies)
        .map(entry => ({ ...entry, value: score(id, cast, before, entry.path, entry.p, line.memory) }))
        .sort((a, b) => b.value - a.value).slice(0, branch);
      for (const { path, p, value } of ranked) {
        worker.restoreAnalysisSnapshot(line.snap);
        const verdict = judge(id, cast, before, path, p, line.memory);
        if (!await play(worker, path)) continue;
        const state = worker.state;
        if (state.phase === 'LOSE' || state.player.hp <= 0) continue;
        const memory = { hit: line.memory.hit || verdict.hit, stunned: line.memory.stunned || verdict.stun };
        const paths = [...line.paths, path];
        if (memory.hit && goalsMet(state)) return paths;
        if (state.phase !== 'PLAYER_INPUT' || !memory.hit && (goalsMet(state) || key !== undefined && indexOf(state, key) < 0)) continue;
        const print = json([state.player.index, state.player.hp, state.board.map(cell => cell ? [cell.id, cell.hp, cell.color] : 0), memory]);
        if (seen.has(print)) continue;
        seen.add(print);
        const progress = line.progress + value;
        next.push({ snap: worker.captureAnalysisSnapshot(), paths, memory, progress, value: progress + positionValue(id, cast, state), cat: state.player.index });
      }
    }
    next.sort((a, b) => b.value - a.value);
    const perCell = new Map<number, number>(), kept: Line[] = [], rest: Line[] = [];
    for (const line of next) {
      const count = perCell.get(line.cat) ?? 0;
      if (count < PER_CELL && kept.length < beamWidth) { kept.push(line); perCell.set(line.cat, count + 1); } else rest.push(line);
    }
    beam = [...kept, ...rest].slice(0, beamWidth);
  }
  return null;
}

/** The staged search: the line and the stage (1-based) that found it. */
async function searchLine(id: BattleId, setup: RunBattleSetup): Promise<{ line: number[][]; stage: number } | null> {
  for (const [n, [beamWidth, branch]] of STAGES.entries()) {
    const line = await findLine(id, setup, beamWidth, branch);
    if (line) return { line, stage: n + 1 };
  }
  return null;
}

/**
 * Replay a found line on a fresh engine by real commands: on every turn the forecast changes nothing and equals the
 * execution (cat HP, death, victory, forced deaths), and the scenario is seen in the executed turn as well (the boar's
 * stun event, a target removed in the enemy phase, the sentinel or the gate target killed by the chain). Returns the
 * fingerprints after every turn.
 */
async function replay(id: BattleId, setup: RunBattleSetup, paths: number[][]): Promise<string[]> {
  const g = start(setup), cast = castOf(id, g.state), label = `${id} row ${setup.row} seed ${setup.seed}`;
  const events: EngineEvent[] = [];
  g.subscribe((_state, event) => events.push(event));
  const prints = [fingerprint(g)], memory: Memory = { hit: false, stunned: false };
  for (const [turn, path] of paths.entries()) {
    const before = structuredClone(g.state), print = fingerprint(g), p = g.preview(path);
    assert(fingerprint(g) === print, `${label} turn ${turn}: the forecast changes nothing`);
    const verdict = judge(id, cast, before, path, p, memory);
    events.length = 0;
    assert(await play(g, path), `${label} turn ${turn}: ${json(path)} plays`);
    const after = g.state, at = `${label} turn ${turn}`;
    assert(before.player.hp - p.damage === after.player.hp, `${at}: forecast damage ${p.damage}, executed ${before.player.hp} → ${after.player.hp}`);
    assert(!!p.playerDies === (after.player.hp === 0), `${at}: forecast death`);
    assert((!!p.completesRoom || !!p.enemyPhase?.completesObjective) === (after.phase === 'WIN'), `${at}: forecast victory`);
    for (const death of p.enemyPhase?.deaths ?? []) assert(indexOf(after, death.id) < 0, `${at}: forecast death of ${death.id} (${death.cause})`);
    for (const hit of p.hits) if (hit.killed && before.board[hit.index]?.kind !== 'door') assert(indexOf(after, before.board[hit.index]!.id) < 0, `${at}: forecast chain kill on ${hit.index}`);
    if (verdict.stun) assert(events.some(event => event.type === 'status' && event.text === 'ОГЛУШЁН'), `${at}: the forecast stun is played`);
    if (verdict.hit && id === 'boar-garden') {
      const pushed = p.enemyPhase!.deaths.filter(death => cast.targets.has(death.id) && BOAR_CAUSES.has(death.cause));
      for (const death of pushed) assert(!killedAt(p, indexOf(before, death.id)) && indexOf(after, death.id) < 0, `${at}: the target ${death.id} dies from the charge, not from the chain`);
    }
    if (verdict.hit && id === 'goblin-pike-gate') assert(after.phase === 'WIN' && events.some(event => event.type === 'win'), `${at}: the gate chain enters the door`);
    memory.hit ||= verdict.hit; memory.stunned ||= verdict.stun;
    prints.push(fingerprint(g));
  }
  assert(memory.hit && goalsMet(g.state) && g.state.player.hp > 0, `${label}: the replayed line meets the goals with the scenario`);
  return prints;
}

/**
 * goblin-shield-flank at the start: a legal chain from the cat that ends next to the shield bearer on its shield side
 * (or the cat itself stands there); stepping into the shield bearer is rejected by the shield — through the real input
 * (extendChain or beginChain refuses, the reason names the shield) and by the forecast. The shield check comes before
 * the color check, so any color is refused by the shield; `sameColor` asks for a chain of the shield bearer's own
 * color, one that only the shield stops. Returns the probe chain or null.
 */
function shieldRejects(g: ForestEngine, cast: Cast, sameColor: boolean): number[] | null {
  const state = g.state, at = indexOf(state, cast.sentinelId!), sentinel = state.board[at]!;
  let found: number[] | null = null, budget = 6000;
  const blocked = (from: number) => chainAdjacent(state, from, at) && shieldBlocksEntry(state, sentinel, from, at);
  if (blocked(state.player.index)) found = [];
  const walk = (path: number[]) => {
    if (found || --budget < 0) return;
    const preview = planChain(state, path, true).preview;
    if (!preview.valid || preview.endsOnSurvivor) return;
    const colors = path.map(index => state.board[index]?.color ?? null).filter(color => color !== null);
    if (sameColor && colors.length && colors[0] !== cast.sentinelColor) return;
    if (blocked(path[path.length - 1])) { found = path; return; }
    if (path.length >= 8) return;
    for (const index of chainNeighbors(state, path[path.length - 1])) if (index !== at && state.board[index] && !path.includes(index)) walk([...path, index]);
  };
  for (const first of chainNeighbors(state, state.player.index)) if (first !== at && state.board[first]) walk([first]);
  if (!found) return null;
  const probe: number[] = found, full = [...probe, at];
  const reason = g.preview(full);
  assert(!reason.valid && reason.reason.includes('Щит'), `the forecast rejects ${json(full)} by the shield (${reason.reason})`);
  const input = new ForestEngine(); input.animationScale = 0; input.restoreAnalysisSnapshot(g.captureAnalysisSnapshot());
  const invalid: string[] = [];
  input.subscribe((_state, event) => { if (event.type === 'invalid') invalid.push(event.text ?? ''); });
  if (probe.length) {
    assert(input.beginChain(probe[0]) && probe.slice(1).every(index => input.extendChain(index)), `the probe ${json(probe)} is a legal chain`);
    assert(!input.extendChain(at) && invalid.some(text => text.includes('Щит')), `stepping into the shield bearer from ${probe[probe.length - 1]} is refused by the shield`);
  } else assert(!input.beginChain(at) && invalid.some(text => text.includes('Щит')), 'starting on the shield bearer from the cat is refused by the shield');
  return probe;
}

interface Tally { row: number; total: number; alive: number[]; noLine: number[]; noShield: number[]; noSameColorShield: number[]; stages: number[]; turns: number[] }
async function checkBattle(id: BattleId): Promise<Tally[]> {
  const band = BATTLE_POOLS[id].rows, tallies: Tally[] = [];
  assert(BATTLE_POOLS[id].coloring === 'random', `${id} is a prototype battle`);
  for (const row of FULL ? [band[0], band[1]] : [band[0]]) {
    const tally: Tally = { row, total: 0, alive: [], noLine: [], noShield: [], noSameColorShield: [], stages: [], turns: [] }, started = Date.now();
    for (const seed of SEEDS) {
      const setup = setupOf(id, row, seed);
      tally.total++;
      let alive = true;
      if (id === 'goblin-shield-flank') {
        // The shield works when it stops a chain that would be legal without it: one of the shield bearer's own color.
        const g = start(setup), cast = castOf(id, g.state);
        if (!shieldRejects(g, cast, true)) { alive = false; tally.noSameColorShield.push(seed); }
        if (!shieldRejects(g, cast, false)) tally.noShield.push(seed);
      }
      const found = await searchLine(id, setup);
      if (!found) { alive = false; tally.noLine.push(seed); }
      else {
        tally.stages.push(found.stage); tally.turns.push(found.line.length);
        // Forecast = execution on the found line, and an exact replay: the same seed gives the same coloring and turns.
        const first = await replay(id, setup, found.line), second = await replay(id, setup, found.line);
        assert(json(first) === json(second), `${id} row ${row} seed ${seed}: the line replays exactly`);
      }
      if (alive) tally.alive.push(seed);
    }
    const share = tally.alive.length / tally.total, count = (list: number[], value: number) => list.filter(item => item === value).length;
    console.log(`${share >= THRESHOLD ? 'PASS' : 'FAIL'} ${id} row ${row}: scenario alive on ${tally.alive.length}/${tally.total} seeds (${(share * 100).toFixed(1)}%); `
      + `line in 1/2/3/4 turns: ${[1, 2, 3, 4].map(turns => count(tally.turns, turns)).join('/')}, found by stage ${STAGES.map((_, n) => count(tally.stages, n + 1)).join('/')}; ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (tally.noLine.length) console.log(`  no scenario line within ${DEPTH} turns: ${tally.noLine.join(' ')}`);
    if (tally.noSameColorShield.length) console.log(`  no chain of the shield bearer's color refused by the shield at the start: ${tally.noSameColorShield.join(' ')}`);
    if (id === 'goblin-shield-flank') console.log(`  at the start: a chain of the shield bearer's color refused by the shield on ${tally.total - tally.noSameColorShield.length}/${tally.total} seeds, `
      + `a chain of any color on ${tally.total - tally.noShield.length}/${tally.total}`);
    tallies.push(tally);
  }
  return tallies;
}

async function main() {
  const failed: string[] = [];
  for (const id of PROTOTYPE) {
    if (ONLY && !ONLY.includes(id)) continue;
    for (const tally of await checkBattle(id)) if (tally.alive.length / tally.total < THRESHOLD) failed.push(`${id} row ${tally.row}`);
  }
  assert(!failed.length, `the scenario is alive on fewer than ${THRESHOLD * 100}% of seeds: ${failed.join(', ')}`);
}
console.log(`prototype scenario: ${FULL ? 'full' : 'short'} mode (${SEEDS.length} seeds, ${FULL ? 'first and last row' : 'first row'}, ${STAGES.length} search stages, threshold ${THRESHOLD * 100}%)`);
await main();
console.log('prototype scenario: ok');
