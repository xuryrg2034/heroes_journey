/**
 * Beast-trail and den node battles (src/game/run/battles/beasts.ts), design: docs/levels/forest-nodes-beasts.md.
 * Every battle starts as in a run (ForestEngine.startRunBattle with the row palette and the tools guaranteed on
 * that row) and is played with real chain commands. Checks: the authored route wins on several refill seeds,
 * the forecast equals execution, the traps of each card are visible in the forecast, the same seed and actions
 * replay identically, refills stay random within the row palette and survivors keep their colors. Elites (elite.ts):
 * doubled HP, the +1 strike shown by the forecast, the run-up they need, and routes that win whether the elite's
 * loot drops or not. Heuristic bot results are deliberately not asserted here (see docs/level-metrics.md).
 */
import { hasOrdinaryChain } from './boardGeneration';
import { ForestEngine } from './forestEngine';
import type { ChainPreview } from './forestTypes';
import { variantSeed } from './levelAnalysis';
import { BEAST_BATTLES } from './run/battles/beasts';
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
}
const PLANS: Record<string, Plan> = {
  'wolf-ford': { node: 'beast-wolf', row: 5, hp: 5, route: [['B5', 'C5', 'C4', 'D3', 'D2'], ['C2', 'D1', 'E2', 'E3', 'D4']] },
  'boar-garden': { node: 'beast-boar', row: 6, hp: 5, route: [['G5', 'F5', 'E6', 'D5', 'C5'], ['B5', 'B6', 'C6']] },
  'porcupine-thicket': { node: 'beast-porcupine', row: 7, hp: 4, route: [['A2', 'A3', 'B2', 'C1', 'D2', 'E3'], ['F2', 'F3', 'E4', 'D4', 'C5', 'C6', 'C7']] },
  'den-watch': { node: 'den-battle', row: 10, hp: 5, route: [['F6', 'E5', 'E6', 'D5', 'E4', 'D4', 'C3', 'D2'], ['C2', 'D1', 'E2', 'E3']] },
  'den-nest': { node: 'den-elite', row: 12, hp: 4, route: [['E4', 'E3'], ['F2', 'E2', 'D1', 'C1', 'B1']] },
  'den-breakout': { node: 'den-breakthrough', row: 13, hp: 5, route: [['B7', 'B6', 'B5', 'B4', 'B3', 'C3'], ['C2', 'C1']] },
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
  return snapshots;
}

const DESIGNED = BEAST_BATTLES;

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
    const first = await playRoute(id, start(id, 2), `${id} replay A`);
    const second = await playRoute(id, start(id, 2), `${id} replay B`);
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
  for (const variant of SPREAD_SEEDS.slice(0, 6)) {
    const ride = start('den-nest');
    const snap = ride.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); ride.restoreAnalysisSnapshot(snap);
    await commit(ride, ['D4', 'D3', 'C4'], `den-nest ride ${variant}`);
    assert(ride.state.player.index === at(ride, 'C2') && ride.state.board[at(ride, 'E3')]?.elite, `den-nest ride ${variant}: the push carries the cat to C2, the elite steps to E3`);
    await commit(ride, ['B1', 'C1', 'D1', 'E1', 'F2', 'E3'], `den-nest ride ${variant} finish`);
    assert(ride.state.phase === 'WIN', `den-nest ride ${variant}: the red chain catches the elite last`);
  }

  // The decision does not rest on the drop: the route wins on spread seeds whether the loot falls or not.
  let dropped = 0, missed = 0;
  for (const variant of SPREAD_SEEDS) {
    const run = new ForestEngine(); run.animationScale = 0;
    assert(run.startRunBattle(setupFor('den-nest')), 'den-nest: spread start');
    const snap = run.captureAnalysisSnapshot(); snap.rng = variantSeed(snap.rng, variant); run.restoreAnalysisSnapshot(snap);
    const where = `den-nest spread ${variant}`, route = PLANS['den-nest'].route;
    await commit(run, route[0], `${where} turn 1`);
    await commit(run, route[1], `${where} turn 2`);
    // The elite dies inside the winning chain: its loot (if any) falls and is left behind with the battle won.
    const loot = run.state.board.find(cell => cell?.kind === 'prism' && cell.loot);
    if (loot) dropped++; else missed++;
    assert(run.state.phase === 'WIN' && run.state.player.hp === PLANS['den-nest'].hp, `${where}: the route wins with ${PLANS['den-nest'].hp} HP (loot ${loot ? 'dropped' : 'not dropped'})`);
  }
  assert(dropped > 0 && missed > 0, `den-nest: the spread seeds cover both outcomes of the loot roll (${dropped} dropped, ${missed} not)`);
  console.log(`den-nest elite: the route wins on ${SPREAD_SEEDS.length} spread seeds, loot dropped on ${dropped}`);
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

/** The exit opens only after the first turn; the breakout is won through the door, before the wolves answer. */
async function exitRules() {
  const g = start('den-breakout');
  assert(!g.preview([at(g, 'C2'), at(g, 'C1')]).valid, 'den-breakout: the exit is closed on the first turn');
  await commit(g, PLANS['den-breakout'].route[0], 'den-breakout first turn');
  const door = g.preview([at(g, 'C2'), at(g, 'C1')]);
  assert(door.valid && door.completesRoom && !door.enemyPhase, 'den-breakout: after one turn the exit completes the battle before the enemy phase');
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
  await elites();
  await carriedEnergy();
  await woundedEntry();
  console.log('beast battles: ok');
}

main().catch(error => { console.error(error); throw error; });
