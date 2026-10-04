/**
 * The Jailer closes in on the cat (decision of 04.10.2026 after playtest 4: «не ощущался угрозой — стоит далеко»),
 * checked through real engine commands:
 * - in its rest turn, with the cat out of reach (not a neighbour), it announces an exchange with a side neighbour
 *   strictly nearer to the cat (Chebyshev) — the melee elite rules; in a strike turn and with the cat beside it, it stays;
 * - the exchange is announced before the player's turn, the forecast shows it and execution does exactly that;
 * - the next heavy strike is announced from the new cell; the shield keeps its fixed facing (down) and moves with it;
 * - frost postpones the announced step (the rest lasts a turn longer, the step is announced again); the same seed and actions repeat exactly; previews leave the state untouched.
 * The battle itself: jailer-gate (sharedBattles.spec.ts); the shield and rest rules: jailerRules.spec.ts.
 */
import { neighbors } from './boardGeometry';
import { shieldIsActive } from './combatRules';
import type { CustomLevelDefinition } from './customLevel';
import { ForestEngine } from './forestEngine';
import { prepareIntents } from './forestSystems';
import type { ChainPreview, ForestCell } from './forestTypes';
import { startNodeBattle } from './testing/fixtures';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const COLS = 7, CAT = 45; // D7

/** 7×7 editor level: the Jailer on D1 (30 HP, so chains do not kill it), the cat on D7, weak goblins everywhere else. */
function level(seed: number): ForestEngine {
  const definition: CustomLevelDefinition = { version: 1, name: 'jailer-approach', seed, cols: COLS, rows: 7, terrain: Array(49).fill('floor'),
    heroIndex: CAT, enemies: Array.from({ length: 49 }, (_, index) => index === 3
      ? { index, kind: 'boss' as const, color: null, hp: 30, variant: 'jailer' as const }
      : { index, kind: 'melee' as const, color: ((index * 7 + Math.floor(index / 3)) % 2) as 0 | 1, hp: 0 }).filter(enemy => enemy.index !== CAT),
    doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 100, 0, 0, 0], extraColors: [], playerHp: 20 };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(definition), 'level starts');
  return g;
}
/** The same level with unarmed goblins (no refill while the cat rests): only the Jailer acts. */
function calmLevel(seed: number): ForestEngine {
  const g = level(seed);
  for (const cell of g.state.board) if (cell?.kind === 'melee') cell.behavior.passive = true;
  prepareIntents(g.state);
  return g;
}
const jailerOf = (g: ForestEngine) => g.state.board.find((cell): cell is ForestCell => cell?.variant === 'jailer');
const indexOf = (g: ForestEngine, cell: ForestCell) => g.state.board.indexOf(cell);
const chebyshev = (g: ForestEngine, a: number, b: number) => Math.max(Math.abs(a % g.state.cols - b % g.state.cols), Math.abs(Math.floor(a / g.state.cols) - Math.floor(b / g.state.cols)));
const snapshot = (g: ForestEngine) => JSON.stringify(g.captureAnalysisSnapshot());

/**
 * What the player sees before acting, then the action, then the result against it. `chain` picks a real move;
 * none — the cat rests. Returns whether the Jailer moved.
 */
async function turn(g: ForestEngine, label: string, chain: boolean): Promise<boolean> {
  const jailer = jailerOf(g)!, from = indexOf(g, jailer), cat = g.state.player.index, hp = g.state.player.hp;
  const announced = g.state.rotations.find(rotation => rotation.sourceId === jailer.id);
  // The announcement, judged against the cat where it stood when the enemies announced their intents.
  if (jailer.behavior.restTurns === 0 || jailer.status.frozen > 0) assert(!announced, `${label}: no step in a strike or frozen turn`);
  else if (neighbors(g.state, from).includes(cat)) assert(!announced, `${label}: the cat is in reach, the Jailer stays`);
  if (announced) {
    assert(announced.from === from && chebyshev(g, announced.to, cat) < chebyshev(g, from, cat), `${label}: the step is strictly nearer to the cat (${from} → ${announced.to}, cat ${cat})`);
    assert(Math.abs(announced.to - from) === 1 || Math.abs(announced.to - from) === g.state.cols, `${label}: a side neighbour`);
    assert(jailer.intent.label.endsWith('сближение') && jailer.intent.moveTo === announced.to, `${label}: the intent names the step`);
  }
  const path = chain ? g.availableMoves(6).find(candidate => !candidate.includes(from)) : undefined;
  const before = snapshot(g);
  const preview: ChainPreview = path ? g.preview(path) : g.previewRest();
  assert(snapshot(g) === before, `${label}: the forecast leaves the state, RNG and IDs untouched`);
  const planned = preview.rotations.find(rotation => rotation.sourceId === jailer.id && rotation.active);
  if (path) { assert(g.beginChain(path[0]), `${label}: chain`); for (const index of path.slice(1)) assert(g.extendChain(index), `${label}: extend`); assert(await g.releaseChain(), `${label}: release`); }
  else assert(await g.waitTurn(), `${label}: rest`);
  assert(g.state.player.hp === hp - preview.damage, `${label}: damage ${hp - g.state.player.hp} as forecast ${preview.damage}`);
  if (!g.state.board.includes(jailer)) return false;
  const to = indexOf(g, jailer);
  assert(to === (planned?.to ?? from), `${label}: forecast ${planned?.to ?? from}, executed ${to}`);
  assert(JSON.stringify(jailer.shield) === JSON.stringify({ dx: 0, dy: 1 }), `${label}: the shield keeps facing down after the step`);
  // The heavy strike is announced from the cell it stands on now.
  if (jailer.intent.cells.length) assert(jailer.intent.cells.every(cell => neighbors(g.state, to).includes(cell)), `${label}: the strike is announced from ${to}`);
  return to !== from;
}

/** The cat rests on D7: the Jailer walks down the D column one cell per rest turn and stops beside the cat. */
async function walksDown() {
  const g = calmLevel(spread(1)), jailer = jailerOf(g)!;
  assert(jailer.intent.label === 'Тяжёлый удар' && !g.state.rotations.some(rotation => rotation.sourceId === jailer.id), 'turn 0: a strike, no step');
  let steps = 0, struck = 0;
  for (let n = 0; n < 14; n++) {
    const resting = jailer.behavior.restTurns > 0;
    const plan = g.previewRest().rotations.find(rotation => rotation.sourceId === jailer.id && rotation.active);
    if (plan) assert(resting, 'a step only in the rest turn');
    if (g.previewRest().damageBySource.boss > 0) struck++;
    if (await turn(g, `rest ${n}`, false)) steps++;
  }
  const at = indexOf(g, jailer);
  assert(steps === 5 && at === CAT - COLS, `the Jailer reached D6 above the cat in 5 steps (${steps} steps, at ${at})`);
  assert(struck > 0, 'once beside the cat, its heavy strike lands on it');
  console.log(`PASS the Jailer walks to the resting cat in its rest turns (${steps} steps), stays beside it and strikes`);
}

/** Frost on the resting Jailer postpones its announced step: the forecast says so, it stays and announces the step again. */
async function frostHolds() {
  const g = calmLevel(spread(2)), jailer = jailerOf(g)!;
  assert(await g.waitTurn(), 'the first strike misses');
  assert(g.state.rotations.some(rotation => rotation.sourceId === jailer.id), 'resting, the Jailer announces a step');
  g.state.inventory.frost = 1;
  assert(g.useItem('frost', 3), 'frost on the Jailer');
  const plan = g.previewRest().rotations.find(rotation => rotation.sourceId === jailer.id);
  assert(plan && !plan.active, 'the forecast shows the frozen step cancelled');
  assert(await g.waitTurn() && indexOf(g, jailer) === 3, 'the frozen Jailer stays');
  assert(jailer.behavior.restTurns > 0 && g.state.rotations.some(rotation => rotation.sourceId === jailer.id), 'still resting, it announces the step again');
  console.log('PASS frost postpones the announced step: the rest lasts a turn longer');
}

/** Real chains on spread seeds: the rule holds on every turn, the forecast equals execution, the replay is exact. */
async function chains() {
  let steps = 0, turns = 0;
  const play = async (seed: number) => {
    const g = level(seed);
    for (let n = 0; n < 10 && g.state.phase === 'PLAYER_INPUT' && jailerOf(g); n++) { if (await turn(g, `seed ${seed} turn ${n}`, true)) steps++; turns++; }
    return snapshot(g);
  };
  for (let k = 1; k <= 8; k++) {
    const first = await play(spread(k));
    assert(first === await play(spread(k)), `seed ${spread(k)}: the same actions repeat exactly`);
  }
  assert(steps > 0, 'the Jailer moved at least once under real chains');
  console.log(`PASS real chains on 8 spread seeds: ${turns / 2} turns (each played twice), ${steps / 2} Jailer steps, forecast = execution, exact replay`);
}

/**
 * jailer-gate as a map node: the pool trap leaves the cat on C3, out of reach; resting, the Jailer stays on D1 for the
 * player's turn (the window) and steps toward the cat afterwards, unless no nearer side cell can be exchanged.
 */
async function gate() {
  const g = startNodeBattle('jailer-gate'), at = (label: string) => (Number(label.slice(1)) - 1) * g.state.cols + label.charCodeAt(0) - 65;
  const path = ['E3', 'E2', 'D2', 'C2', 'B3', 'C3'].map(at);
  assert(g.beginChain(path[0]), 'trap chain'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend'); assert(await g.releaseChain(), 'release');
  const jailer = jailerOf(g)!;
  assert(indexOf(g, jailer) === at('D1') && !shieldIsActive(jailer) && g.state.player.index === at('C3'), 'after the trap: the Jailer rests on D1, the cat on C3');
  const announced = g.state.rotations.find(rotation => rotation.sourceId === jailer.id);
  const below = g.state.board[at('D2')];
  // The seed and the path are fixed: D2 always holds a weak goblin after the trap, so the step is asserted outright.
  assert(below && (below.kind === 'melee' || below.kind === 'ranged') && announced?.to === at('D2'), 'it announces the step down to D2');
  await turn(g, 'jailer-gate rest window', false);
  assert(indexOf(g, jailer) === at('D2'), 'after the rest window it stands on D2');
  console.log('PASS jailer-gate: after the pool trap the Jailer steps from D1 to D2 after the rest window');
}

await walksDown();
await frostHolds();
await chains();
await gate();
