/**
 * The battle side of the difficulty ladder (docs/roguelike-runs.md, section 6): every change on its step and its
 * absence on the step before, through real engine commands on spread seeds; step 0 is the golden comparison.
 * Steps 1, 5, 6 and the merchant's prices of step 9 belong to the run (map, rest, start, merchant).
 */
import { ForestEngine } from './forestEngine';
import { authoredLesson, type LessonTile } from './lessonBuilder';
import { FOREST_NODE_BATTLES, type NodeBattle } from './run/forestBattles';
import type { RunBattleSetup } from './run/runBattle';
import { nextReinforcementTurn } from './exitRules';
import { RANDOM_ELITE_CHANCE } from './elite';
import { LADDER_ELITE_CHANCE } from './ladder';
import { startNodeBattle } from './testing/fixtures';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const registry = FOREST_NODE_BATTLES as Record<string, NodeBattle>;
const battle = (id: string, rows: string[], legend: Record<string, LessonTile> = {}) => {
  registry[id] = authoredLesson({ id, name: id, description: '', hint: '', seed: 7600, rows, legend: { D: { door: true }, T: { color: 3, target: true }, ...legend } });
};
battle('spec-ladder', ['GGGGG', 'RRRRR', 'RRHTR', 'BBBBB', 'BEBBD'], { E: { color: 2, hp: 1, elite: true } });
const TARGET = 13;
// The Chief in the middle (C2), the cat below (C4): its sweep faces down; step 10 adds the two upper corners.
battle('spec-ladder-chief', ['GGGGG', 'GGQGG', 'GGGGG', 'GGHGG', 'GGGGD'], { Q: { kind: 'boss', hp: 20, target: true } });
function start(id: string, seed: number, ladder: number, extra: Partial<RunBattleSetup> = {}): ForestEngine {
  const setup: RunBattleSetup = { nodeId: 'spec', label: 'spec', seed, template: { kind: 'battle', id }, row: 11,
    player: { hp: 30, maxHp: 30, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [],
    ...(ladder ? { ladder } : {}), ...extra };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startRunBattle(setup), `${id} starts on step ${ladder}`);
  return g;
}
async function chain(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'begin'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend'); assert(await g.releaseChain(), 'release');
}
const eliteOf = (g: ForestEngine) => g.state.board.find(cell => cell?.elite === true)!;

async function stepsOnBattles() {
  // Step 2: random elites before the goals at 5% (statistics of real refills on row 11).
  const rate = async (ladder: number) => {
    let made = 0, elites = 0;
    for (let k = 1; k <= 40; k++) {
      const g = start('spec-ladder', spread(k), ladder);
      const off = g.subscribe((state, event) => { if (event.type === 'spawn') for (const index of event.indices ?? []) { made++; if (state.board[index]?.elite === 'random') elites++; } });
      for (let n = 0; n < 6 && g.state.phase === 'PLAYER_INPUT'; n++) {
        const path = g.availableMoves(4).find(candidate => !candidate.includes(TARGET));
        if (path) await chain(g, path); else await g.waitTurn();
      }
      off();
    }
    return elites / Math.max(1, made);
  };
  const [low, high] = [await rate(1), await rate(2)];
  assert(Math.abs(low - RANDOM_ELITE_CHANCE) < 0.025 && Math.abs(high - LADDER_ELITE_CHANCE) < 0.025 && high > low,
    `step 2: random elites ${(high * 100).toFixed(1)}% vs ${(low * 100).toFixed(1)}% on step 1`);
  // Step 3: authored elites of a hard battle +1 HP (after the doubling); not in an ordinary battle or on step 2.
  assert(eliteOf(start('spec-ladder', spread(1), 3, { hard: true })).hp === 3, 'step 3: a hard battle\'s authored elite has 1 × 2 + 1 HP');
  assert(eliteOf(start('spec-ladder', spread(1), 2, { hard: true })).hp === 2 && eliteOf(start('spec-ladder', spread(1), 3)).hp === 2, 'not on step 2 or outside a hard battle');
  // Step 4: the Troll and the Chief +20% HP.
  for (const id of ['troll-lair', 'chief-breakfast']) {
    const base = startNodeBattle(id, { row: 14 }).state.board.find(cell => cell?.kind === 'boss')!.hp;
    const up = startNodeBattle(id, { row: 14, ladder: 4 }).state.board.find(cell => cell?.kind === 'boss')!.hp;
    assert(up === Math.round(base * 1.2) && startNodeBattle(id, { row: 14, ladder: 3 }).state.board.find(cell => cell?.kind === 'boss')!.hp === base, `step 4: ${id} ${base} → ${up}`);
  }
  // Steps 7 and 9: reinforcements every 2 turns; the chest one resource less.
  for (const [ladder, every, chest] of [[6, 3, 2], [7, 2, 2], [9, 2, 1]] as const) {
    const g = start('spec-ladder', spread(2), ladder);
    await chain(g, [TARGET]);
    const goal = g.state.customLevel!.goalCompletedTurn!;
    assert(nextReinforcementTurn(g.state) === goal + 3, `step ${ladder}: the first reinforcement at goal + 3`);
    while (g.state.phase === 'PLAYER_INPUT' && g.state.turn < goal + 3) await g.waitTurn();
    assert(nextReinforcementTurn(g.state) === goal + 3 + every, `step ${ladder}: then every ${every}`);
    assert((g.state.board.find(cell => cell?.chest)?.chest?.length ?? chest) === chest, `step ${ladder}: a chest of ${chest}`);
  }
  // Step 8: greed — a hard battle with the flag starts with one more random elite.
  const greedy = start('spec-ladder', spread(3), 8, { hard: true, greedElite: true });
  assert(greedy.state.board.filter(cell => cell?.elite === 'random').length === 1, 'step 8: one more random elite at the start');
  assert(!start('spec-ladder', spread(3), 7, { hard: true, greedElite: true }).state.board.some(cell => cell?.elite === 'random'), 'not on step 7');
  // Step 10: the Troll regrows 4; the Chief's sweep reaches the four corners too.
  const chief = (ladder: number) => start('spec-ladder-chief', spread(4), ladder);
  const boss = (g: ForestEngine) => g.state.board.findIndex(cell => cell?.kind === 'boss');
  const plain = chief(9), hard = chief(10);
  const at = boss(hard), cols = hard.state.cols;
  const corners = hard.neighbors(at).filter(index => index % cols !== at % cols && Math.floor(index / cols) !== Math.floor(at / cols));
  assert(corners.every(index => hard.state.board[at]!.intent.cells.includes(index)) && plain.state.board[boss(plain)]!.intent.cells.length < hard.state.board[at]!.intent.cells.length,
    `step 10: the Chief's sweep ${hard.state.board[at]!.intent.cells} covers the corners ${corners}`);
  assert(JSON.stringify(hard.state.bossWarning) === JSON.stringify(hard.state.board[at]!.intent.cells), 'step 10: the telegraph shows the whole sweep');
  console.log(`PASS ladder battle steps: 2 (elites ${(low * 100).toFixed(1)}% → ${(high * 100).toFixed(1)}%), 3, 4, 7, 8, 9 (chest), 10 (Chief); absent one step lower`);
}

async function trollRegrowsFour() {
  for (const [ladder, regen] of [[9, 3], [10, 4]] as const) {
    const g = startNodeBattle('troll-lair', { row: 14, ladder, player: { hp: 99, maxHp: 99, energy: 0 } });
    const troll = g.state.board.find(cell => cell?.variant === 'troll')!;
    troll.hp = troll.maxHp - 5;
    let seen = 0;
    const off = g.subscribe((_state, event) => { if (event.type === 'regen') seen = event.amount ?? 0; });
    await g.waitTurn(); off();
    assert(seen === regen, `step ${ladder}: the Troll regrows ${seen}, expected ${regen}`);
  }
  console.log('PASS step 10: the Troll regrows 4 (3 on step 9)');
}

await stepsOnBattles();
await trollRegrowsFour();
console.log('PASS ladder (battle side)');
