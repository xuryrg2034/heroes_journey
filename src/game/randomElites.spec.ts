/**
 * Random elites and elite movement (decisions of 01.10.2026, docs/ecs-architecture.md §7 «Случайные элиты») through
 * real engine commands on spread seeds:
 * - a refill enemy may be an elite only in map battles from row 5, ~3% before the goals and ~12% after, under the cap
 *   of living elites (2, then 4); HP max(1, own) × 2, angry at once; killed by the player it always drops a resource;
 * - every elite moves: melee closes in on the cat when the cat is out of reach, ranged retreats while the cat is
 *   closer than 3 cells, defensive ones hold; ordinary enemies never close in; the move is an announced exchange, the
 *   Rest forecast shows it and execution does it; the same seed and actions repeat exactly.
 */
import type { CustomEnemy, CustomLevelDefinition } from './customLevel';
import { ELITE_CAP, ELITE_CAP_AFTER_GOALS, ELITE_HP_FACTOR, ELITE_MOVE_EVERY, setEliteMoveEvery } from './elite';
import { ForestEngine } from './forestEngine';
import type { EngineEvent, ForestCell } from './forestTypes';
import { isResource } from './resources';
import { forestFixtureLevel } from './testing/fixtures';
import { prepareIntents } from './forestSystems';
import { battleSetup, createForestRun, enterNode, parseForestRun, resolveBattle, serializeForestRun } from './run/forestRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);

/**
 * The camp fixture (39 goblins, a goal of 100 kills: a long battle) played as a map node of `row`: its refills follow
 * that row's rules. 20 HP, so a greedy player keeps refilling the board.
 */
function node(row: number, seed: number, authoredElites: number[] = []): ForestEngine {
  const level = forestFixtureLevel(seed);
  level.enemies = level.enemies.map(enemy => authoredElites.includes(enemy.index) ? { ...enemy, hp: 1, elite: true } : enemy);
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel({ ...level, playerHp: 20 }), 'camp starts');
  g.state.runNode = { nodeId: 'camp-test', label: 'тест', allowedItems: [], allowedAbilities: [], row };
  return g;
}
async function playChains(g: ForestEngine, turns: number, each: (g: ForestEngine) => void) {
  for (let turn = 0; turn < turns && g.state.phase === 'PLAYER_INPUT'; turn++) {
    const path = g.availableMoves(6)[0];
    if (path) { g.beginChain(path[0]); for (const index of path.slice(1)) g.extendChain(index); assert(await g.releaseChain(), 'chain'); }
    else assert(await g.waitTurn(), 'rest');
    each(g);
  }
}
const living = (g: ForestEngine) => [...new Set(g.state.board.filter((cell): cell is ForestCell => !!cell?.elite))];

/** Count new ordinary refill enemies and random elites over spread seeds; check the cap after every turn. */
async function survey(row: number, afterGoals: boolean, authoredElites: number[] = []) {
  let fresh = 0, elites = 0;
  const randoms: ForestCell[] = [];
  for (let k = 1; k <= 24; k++) {
    // IDs restart in every battle: the set of known entities is per battle.
    const seen = new Set<number>(), g = node(row, spread(k), authoredElites);
    if (afterGoals) g.state.customLevel!.goalCompletedTurn = g.state.turn;
    for (const cell of g.state.board) if (cell) seen.add(cell.id);
    await playChains(g, 10, engine => {
      for (const cell of engine.state.board) {
        if (!cell || seen.has(cell.id)) continue;
        seen.add(cell.id);
        if (cell.kind === 'melee' && !cell.variant) { fresh++; if (cell.elite === 'random') { elites++; randoms.push({ ...cell, behavior: { ...cell.behavior } }); } }
      }
      assert(living(engine).length <= (afterGoals ? ELITE_CAP_AFTER_GOALS : ELITE_CAP), `row ${row}: the cap of living elites holds`);
    });
  }
  return { fresh, elites, randoms };
}

async function appearance() {
  const trunk = await survey(4, false);
  assert(trunk.fresh > 30 && trunk.elites === 0, `row 4: no random elite among ${trunk.fresh} refill enemies`);
  const before = await survey(6, false), after = await survey(6, true);
  console.log(`  row 6: ${before.elites}/${before.fresh} before, ${after.elites}/${after.fresh} after the goals`);
  const rate = (s: { fresh: number; elites: number }) => s.elites / s.fresh;
  assert(before.fresh > 500 && rate(before) > 0.015 && rate(before) < 0.05, `row 6 before the goals: ${before.elites}/${before.fresh} random elites (~3%)`);
  // 12% per new enemy, less what the cap of 4 living elites holds back.
  assert(after.fresh > 500 && rate(after) > 0.07 && rate(after) < 0.14, `row 6 after the goals: ${after.elites}/${after.fresh} random elites (~12% under the cap)`);
  // Authored elites count toward the cap: with two of them on the field (the survey asserts the cap every turn), random
  // ones appear only after an authored one has died.
  const authored = await survey(6, false, [40, 20]);
  assert(authored.fresh > 300, `row 6 with two authored elites: ${authored.elites}/${authored.fresh}`);
  for (const cell of [...before.randoms, ...after.randoms]) {
    assert(cell.hp === cell.maxHp && (cell.hp === ELITE_HP_FACTOR || cell.hp === 2 * ELITE_HP_FACTOR), `a random elite has max(1, own) × 2 HP (got ${cell.hp})`);
    assert(cell.behavior.aggressive && !cell.behavior.passive, 'a random elite is angry when it appears');
  }
  console.log(`PASS random elites: none on row 4 (${trunk.fresh} refills); row 6 ${before.elites}/${before.fresh} before the goals, ${after.elites}/${after.fresh} after; caps ${ELITE_CAP}/${ELITE_CAP_AFTER_GOALS} hold; HP ×2, angry`);
}

async function resourceLootAndReplay() {
  let kills = 0, drops = 0;
  for (let k = 1; k <= 40 && kills < 8; k++) {
    const g = node(6, spread(k));
    g.state.customLevel!.goalCompletedTurn = g.state.turn;
    await playChains(g, 12, () => {});
    const found = g.state.board.findIndex(cell => cell?.elite === 'random');
    if (found < 0 || g.state.phase !== 'PLAYER_INPUT') continue;
    const target = g.state.board[found]!;
    // The player's bomb kills it (6 damage against at most 4 HP).
    g.state.runNode!.allowedItems = ['bomb']; g.state.inventory.bomb = 1; g.state.itemPrepared = false;
    const events: EngineEvent[] = []; g.subscribe((_state, event) => events.push(event));
    assert(g.useItem('bomb', found) && !g.state.board.includes(target), `seed ${k}: the bomb kills the random elite`);
    kills++;
    const loot = events.filter(event => event.type === 'loot');
    if (loot.length) drops++;
    assert(loot.every(event => isResource(event.text)), `seed ${k}: a random elite drops a resource`);
  }
  assert(kills >= 4 && drops === kills, `every random elite the player kills drops a resource (${drops}/${kills})`);
  // The same seed and actions: the same random elites in the same places.
  const run = async () => { const g = node(6, spread(3)); g.state.customLevel!.goalCompletedTurn = g.state.turn; await playChains(g, 10, () => {}); return json(g.captureAnalysisSnapshot()); };
  assert(await run() === await run(), 'random elites repeat exactly with the seed');
  console.log(`PASS a random elite killed by the player always drops a resource (${drops}/${kills}); exact replay`);
}

/** 6×6 editor level, the cat on D6 (33); `enemies` authored, the rest refilled. */
function level(enemies: CustomEnemy[], seed = 5): ForestEngine {
  const definition: CustomLevelDefinition = { version: 1, name: 'elite-moves', seed, cols: 6, rows: 6, terrain: Array(36).fill('floor'), heroIndex: 33, enemies, doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [], playerHp: 20 };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(definition), 'level starts');
  return g;
}
const at = (g: ForestEngine, id: number) => g.state.board.findIndex(cell => cell?.id === id);
const chebyshev = (a: number, b: number) => Math.max(Math.abs(a % 6 - b % 6), Math.abs(Math.floor(a / 6) - Math.floor(b / 6)));

/** Rest; the forecast's active rotation of `cell` equals where execution moves it. */
async function restAndFollow(g: ForestEngine, cell: ForestCell, label: string) {
  const plan = g.previewRest().rotations.find(rotation => rotation.sourceId === cell.id && rotation.active);
  const from = at(g, cell.id);
  assert(await g.waitTurn(), `${label}: rest`);
  if (plan) assert(at(g, cell.id) === plan.to, `${label}: forecast moves it to ${plan.to}, executed ${at(g, cell.id)}`);
  else assert(at(g, cell.id) === from, `${label}: no move forecast, none executed`);
  return { plan, from, to: at(g, cell.id) };
}

async function movement() {
  // Melee elite far from the cat: closes in by one exchange per turn, as forecast.
  for (let k = 1; k <= 5; k++) {
    const g = level([{ index: 2, kind: 'melee', color: 0, hp: 1, aggressive: true, elite: true }], spread(k));
    const elite = g.state.board[2]!;
    assert(elite.intent.label === 'Сближение' && g.state.rotations.some(rotation => rotation.sourceId === elite.id), `seed ${k}: a melee elite out of reach announces closing in`);
    const { plan, from, to } = await restAndFollow(g, elite, `close ${k}`);
    assert(plan && chebyshev(to, 33) < chebyshev(from, 33), `seed ${k}: it came closer (${from} → ${to})`);
  }
  // Melee elite beside the cat: it strikes, no closing in.
  const beside = level([{ index: 27, kind: 'melee', color: 0, hp: 1, aggressive: true, elite: true }]);
  const striker = beside.state.board[27]!;
  assert(striker.intent.cells.includes(33) && !beside.state.rotations.some(rotation => rotation.sourceId === striker.id), 'a melee elite with the cat in reach strikes instead of moving');
  // Ordinary enemies never close in: an armed ordinary goblin far away announces no exchange.
  const plain = level([{ index: 2, kind: 'melee', color: 0, hp: 1, aggressive: true }]);
  assert(!plain.state.rotations.some(rotation => rotation.sourceId === plain.state.board[2]!.id), 'an ordinary goblin does not close in');
  // Ranged elite: shoots, then in its rest turn retreats while the cat is near; far away it stands.
  let retreated = 0;
  for (let k = 1; k <= 6; k++) {
    const near = level([{ index: 21, kind: 'ranged', color: 0, hp: 2, aggressive: true, elite: true }], spread(k));
    const archer = near.state.board[21]!;
    assert(await near.waitTurn(), 'the archer shoots');
    if (archer.behavior.restTurns === 0 || at(near, archer.id) !== 21) continue;
    const { plan, from, to } = await restAndFollow(near, archer, `retreat ${k}`);
    if (plan) { retreated++; assert(chebyshev(to, 33) > chebyshev(from, 33) && archer.intent.label !== 'Отдых · ротация', `seed ${k}: the elite archer retreated (${from} → ${to})`); }
  }
  assert(retreated > 0, 'a resting elite archer near the cat retreats');
  const far = level([{ index: 0, kind: 'ranged', color: 0, hp: 2, aggressive: true, elite: true }]);
  const distant = far.state.board[0]!;
  assert(await far.waitTurn(), 'the far archer shoots');
  assert(!far.state.rotations.some(rotation => rotation.sourceId === distant.id), 'an elite archer far from the cat stands (no rotation toward the cat either)');
  // Defensive elites hold.
  const hold = level([{ index: 2, kind: 'melee', variant: 'porcupine', color: 0, hp: 1, aggressive: true, elite: true }, { index: 4, kind: 'melee', variant: 'sentinel', color: 1, hp: 1, aggressive: true, elite: true }]);
  assert(!hold.state.rotations.some(rotation => rotation.sourceId === hold.state.board[2]!.id || rotation.sourceId === hold.state.board[4]!.id), 'porcupine and shield-bearer elites hold');
  // Every second turn (the fallback value): no move on an odd turn.
  setEliteMoveEvery(2);
  try {
    const slow = level([{ index: 2, kind: 'melee', color: 0, hp: 1, aggressive: true, elite: true }]);
    const elite = slow.state.board[2]!;
    assert(slow.state.rotations.some(rotation => rotation.sourceId === elite.id), 'turn 0: moves');
    assert(await slow.waitTurn() && !slow.state.rotations.some(rotation => rotation.sourceId === elite.id), 'turn 1: holds when elites move every 2 turns');
  } finally { setEliteMoveEvery(1); }
  assert(ELITE_MOVE_EVERY === 1, 'the default is every turn');
  console.log(`PASS elite movement: melee closes in (forecast = execution), strikes when in reach; ranged retreats near the cat (${retreated}/6), stands far; defensive elites hold; ordinary goblins never close in; every 2 turns works`);
}

/** Movement conditions on a fresh level, intents re-prepared after the setup (the rule reads the final intents). */
function movementRules() {
  const moves = (g: ForestEngine, cell: ForestCell) => g.state.rotations.some(rotation => rotation.sourceId === cell.id);
  const setup = (enemies: CustomEnemy[], tweak: (g: ForestEngine) => void) => { const g = level(enemies); tweak(g); prepareIntents(g.state); return g; };
  const far = (extra: Partial<CustomEnemy> = {}): CustomEnemy => ({ index: 2, kind: 'melee', color: 0, hp: 1, aggressive: true, elite: true, ...extra });
  // Frozen, resting, passive: no move.
  let g = setup([far()], engine => { engine.state.board[2]!.status.frozen = 1; });
  assert(!moves(g, g.state.board[2]!), 'a frozen elite does not move');
  g = setup([far()], engine => { engine.state.board[2]!.behavior.restTurns = 1; });
  assert(!moves(g, g.state.board[2]!), 'a resting melee elite does not move');
  g = setup([far()], engine => { engine.state.board[2]!.behavior.passive = true; });
  assert(!moves(g, g.state.board[2]!), 'a passive elite does not move');
  // A calm elite beside the cat does not walk away from it.
  g = setup([{ index: 27, kind: 'melee', color: 0, hp: 1, elite: true }], engine => { engine.state.board[27]!.behavior.aggressive = false; });
  assert(!moves(g, g.state.board[27]!), 'a calm elite beside the cat stays');
  // Closing in only to a strictly nearer neighbour: walls left, right and below leave only a step away — it stands.
  const walled = level([{ index: 8, kind: 'melee', color: 0, hp: 1, aggressive: true, elite: true }]);
  for (const wall of [7, 9, 14]) { walled.state.terrain[wall] = 'wall'; walled.state.board[wall] = null; }
  prepareIntents(walled.state);
  assert(!moves(walled, walled.state.board[8]!), 'an elite with no nearer neighbour stands (never steps away)');
  // A charging boar elite does not move; a wolf elite out of reach closes in.
  g = level([{ index: 2, kind: 'melee', variant: 'boar', color: 0, hp: 1, aggressive: true, elite: true }]);
  assert(g.state.board[2]!.intent.charge && !moves(g, g.state.board[2]!), 'a boar elite with its charge announced does not move');
  g = level([{ index: 2, kind: 'melee', variant: 'wolf', color: 0, hp: 1, aggressive: true, elite: true }, { index: 3, kind: 'melee', variant: 'wolf', color: 0, hp: 0, aggressive: true }]);
  assert(moves(g, g.state.board[2]!) && g.state.board[2]!.intent.label === 'Сближение', 'a wolf elite out of reach closes in');
  // A shaman elite near the cat retreats in a turn without a rite, not in a turn with one.
  g = setup([{ index: 21, kind: 'melee', variant: 'shaman', color: 1, hp: 1, aggressive: true, elite: true }], engine => { engine.state.board[21]!.behavior.cycle = 0; });
  const shaman = g.state.board[21]!;
  assert(!shaman.intent.empowerIds?.length && moves(g, shaman) && shaman.intent.label === 'Отступление', 'a shaman elite near the cat retreats in a turn without a rite');
  // Its rite turn (cycle 1 of a period of 2) with ordinary goblins beside it to raise.
  g = setup([{ index: 21, kind: 'melee', variant: 'shaman', color: 1, hp: 1, aggressive: true, elite: true }], engine => { engine.state.board[21]!.behavior.cycle = 1; });
  assert(g.state.board[21]!.intent.empowerIds?.length && !moves(g, g.state.board[21]!), 'a shaman elite performing a rite does not move');
  console.log('PASS movement conditions: frozen, resting, passive and charging elites stay; a calm one beside the cat stays; never a step away; wolf closes in; shaman retreats only without a rite');
}

/** Review of 02.10.2026: a resource from a random elite in a row-5 battle without authored elites keeps the run saveable. */
function runKeepsRandomEliteResources() {
  let run = createForestRun(1);
  const engine = new ForestEngine(); engine.animationScale = 0;
  const pass = (id: string) => {
    const entered = enterNode(run, id); assert(entered.ok, `enter ${id}`); run = entered.run;
    if (run.pending?.kind === 'battle') { assert(engine.startRunBattle(battleSetup(run)!), `${id} starts`); engine.winLevel(); const won = resolveBattle(run, engine.runBattleOutcome()!); assert(won.ok, `resolve ${id}`); run = won.run; }
  };
  for (const id of ['trunk-1', 'trunk-2', 'trunk-3', 'trunk-4']) pass(id);
  const entered = enterNode(run, 'goblin-archer'); assert(entered.ok, 'enter goblin-archer'); run = entered.run;
  const entry = (run.pending as { entry: { player: { hp: number; maxHp: number; energy: number }; inventory: Record<string, number> } }).entry;
  const won = resolveBattle(run, { nodeId: 'goblin-archer', won: true, player: { ...entry.player }, inventory: { ...entry.inventory } as never, materials: { dew: 0, powder: 2, resin: 0, herbs: 0 } });
  assert(won.ok && won.run.resources.materials?.powder === 2, 'two resources from random elites join the run');
  assert(parseForestRun(serializeForestRun(won.run))?.resources.materials?.powder === 2, 'the run stays saveable');
  const item = JSON.parse(serializeForestRun(won.run)); item.loot.push({ nodeId: 'goblin-archer', item: 'bomb', count: 1 }); item.resources.inventory.bomb++;
  assert(parseForestRun(JSON.stringify(item)) === null, 'a consumable from a battle without authored elites is still rejected');
  console.log('PASS resources of random elites keep the run saveable; consumables stay bounded by authored elites');
}

await appearance();
movementRules();
runKeepsRandomEliteResources();
await resourceLootAndReplay();
await movement();
console.log('PASS random elites');
