/**
 * A chain of one enemy (decision of 04.10.2026, Grindstone): a full hit in every battle — power 1, the ordinary hit
 * rules (a weak enemy dies, an enemy with HP loses 1), the cat steps onto the killed enemy's cell, +0.5 energy. Checked
 * through real engine commands on spread seeds: forecast = execution, exact replay; map battle and editor level.
 */
import { ForestEngine } from './forestEngine';
import { authoredLesson } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';
import type { CustomLevelDefinition } from './customLevel';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const json = (value: unknown) => JSON.stringify(value);

// The cat on C3 (12) with a weak goblin W on B2 (6), a goblin S with 2 HP on C2 (7) and the marked target T on D2 (8).
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
registry['spec-single'] = authoredLesson({ id: 'spec-single', name: 'Один удар', description: '', hint: '', seed: 7401,
  rows: ['GGGGG', 'GWSTG', 'GGHGG', 'GGGGG', 'GGGGD'], legend: { W: { color: 0 }, S: { color: 1, hp: 2 }, T: { color: 2, target: true }, D: { door: true } } });
const W = 6, S = 7, T = 8;

function start(seed: number, row = 6): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id: 'spec-single' }, row,
    player: { hp: 20, maxHp: 20, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'battle starts');
  return g;
}
/** One real single hit: a pure forecast, then real input; damage, kill and position as forecast. */
async function hit(g: ForestEngine, index: number, where: string) {
  const before = g.captureAnalysisSnapshot(), preview = g.preview([index]), after = g.captureAnalysisSnapshot();
  assert(json(before) === json(after), `${where}: the forecast spends no state, RNG or IDs`);
  assert(preview.valid && preview.enemies === 1 && preview.hits[0].availablePower === 1, `${where}: a one-enemy chain is valid with power 1 (${preview.reason})`);
  const hp = g.state.player.hp, energy = g.state.player.energy, target = g.state.board[index]!;
  assert(g.beginChain(index) && await g.releaseChain(), `${where}: released`);
  assert(hp - g.state.player.hp === preview.damage && g.state.player.energy === energy + preview.energyGain && preview.energyGain === 0.5,
    `${where}: damage ${preview.damage} and +0.5 energy as forecast`);
  return { preview, target };
}

async function singleHits() {
  for (let k = 1; k <= 4; k++) {
    const g = start(spread(k));
    // A weak goblin dies; the cat steps onto its cell.
    const weak = await hit(g, W, `seed ${k} weak`);
    assert(weak.preview.kills === 1 && g.state.player.index === W && g.state.board[W]?.id !== weak.target.id, `seed ${k}: the weak goblin dies and the cat steps onto B2`);
    // An enemy with 2 HP loses 1 and the cat stays (it cannot pass a survivor).
    const at = g.state.player.index;
    const durable = await hit(g, S, `seed ${k} durable`);
    assert(durable.preview.endsOnSurvivor && g.state.board[S]?.id === durable.target.id && g.state.board[S]!.hp === 1 && g.state.player.index === at,
      `seed ${k}: the goblin with 2 HP keeps 1 HP and the cat stays`);
    // The marked target (D2, diagonal to the cat on C3) falls to a single hit and counts for the task.
    const fresh = start(spread(k));
    assert(fresh.chainNeighbors(fresh.state.player.index).includes(T), `seed ${k}: the target stands beside the cat`);
    const goal = await hit(fresh, T, `seed ${k} target`);
    assert(goal.preview.kills === 1 && fresh.state.objective.tutorialTargets === 1 && fresh.state.customLevel!.goalCompletedTurn !== null, `seed ${k}: the marked target counts and the goals are met`);
  }
  console.log('PASS single hits: a weak goblin dies (the cat steps in), a 2-HP goblin loses 1 (the cat stays), a marked target counts; +0.5 energy; forecast = execution');
}

/** The editor allows single hits too. */
/** No hit without an enemy: a crystal (or loot, a chest) alone is not a chain. */
async function noEnemyNoHit() {
  registry['spec-single-prism'] = authoredLesson({ id: 'spec-single-prism', name: 'Кристалл', description: '', hint: '', seed: 7402,
    rows: ['GGGGG', 'GGGGG', 'GPHGG', 'GGGGG', 'GGGGD'], legend: { P: { kind: 'prism' }, D: { door: true } }, goals: [{ key: 'kills', target: 99 }] });
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed: spread(1), template: { kind: 'battle', id: 'spec-single-prism' }, row: 6,
    player: { hp: 20, maxHp: 20, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [] };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), 'battle starts');
  const prism = 11, preview = g.preview([prism]);
  assert(g.state.board[prism]?.kind === 'prism' && !preview.valid && preview.reason === 'Нужен хотя бы один противник в цепочке.', `a crystal alone is no hit (${preview.reason})`);
  assert(!g.availableMoves().some(path => path.length === 1 && path[0] === prism), 'no move steps onto the crystal alone');
  console.log('PASS no hit without an enemy: a crystal alone is not a chain');
}

async function editorSingleHit() {
  const def: CustomLevelDefinition = { ...registry['spec-single'].definition, seed: spread(5), playerHp: 20 };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(def), 'editor level starts');
  await hit(g, W, 'editor');
  assert(g.state.player.index === W, 'editor: the cat steps onto the killed goblin');
  console.log('PASS the editor allows single hits');
}

async function replay() {
  const play = async (seed: number) => { const g = start(seed); await hit(g, W, 'replay'); await hit(g, S, 'replay'); await g.waitTurn(); return json(g.captureAnalysisSnapshot()); };
  for (let k = 1; k <= 3; k++) assert(await play(spread(k)) === await play(spread(k)), `seed ${k}: exact replay`);
  console.log('PASS exact replay through single hits');
}

await singleHits();
await noEnemyNoHit();
await editorSingleHit();
await replay();
console.log('PASS single hit');
