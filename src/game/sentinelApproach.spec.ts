/**
 * The shield-bearer closes in on the cat (decision of 06.10.2026 after the prototype A playtest: «пока противник стоит
 * на месте, приходится чистить всё вокруг»), checked through real engine commands:
 * - every `SENTINEL_STEP_EVERY` turns (its step lands in the enemy phase of turns 3, 6, 9…), with the cat out of reach
 *   (not a side neighbour, not on its announced swing), it announces an exchange with a side neighbour strictly nearer
 *   to the cat (Chebyshev) — the melee elite rules; in other turns, when it swings at the cat and with the cat beside
 *   it, it stays; an exact diagonal holds it (no side neighbour is nearer);
 * - the exchange is announced before the player's turn, the forecast shows it and execution does exactly that;
 * - after the step its shield faces the cat from the new cell; a shield-bearer killed before the enemy phase does not
 *   step (its exchange is dropped, the partner stays);
 * - an elite shield-bearer moves by the same rule, once per step turn (no elite movement on top);
 * - the same seed and actions repeat exactly; previews leave the state untouched.
 * The shield itself: sentinelShield.spec.ts; the Jailer's approach (the same pass): jailerApproach.spec.ts.
 */
import { meleeTargets } from './boardGeometry';
import type { CustomEnemy, CustomLevelDefinition } from './customLevel';
import { SENTINEL_STEP_EVERY } from './enemyBehaviors';
import { ForestEngine } from './forestEngine';
import { prepareIntents } from './forestSystems';
import type { ChainPreview, EnemyColor, ForestCell } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const COLS = 7, ROWS = 7;
const at = (label: string) => (Number(label.slice(1)) - 1) * COLS + label.charCodeAt(0) - 65;

interface Setup { seed: number; sentinel: number; cat: number; hp?: number; color?: EnemyColor; elite?: boolean; colorOf?: (index: number) => EnemyColor }
/**
 * 7×7 editor level: an armed shield-bearer (30 HP and a colour outside the palette by default, so chains neither
 * kill nor include it), the cat, weak goblins everywhere else.
 */
function level({ seed, sentinel, cat, hp = 30, color = 2, elite = false, colorOf }: Setup): ForestEngine {
  const enemies: CustomEnemy[] = [];
  for (let index = 0; index < COLS * ROWS; index++) {
    if (index === cat) continue;
    if (index === sentinel) enemies.push({ index, kind: 'melee', color, hp, variant: 'sentinel', aggressive: true, ...(elite ? { elite: true } : {}) });
    else enemies.push({ index, kind: 'melee', color: colorOf?.(index) ?? ((index * 7 + Math.floor(index / 3)) % 2) as EnemyColor, hp: 0 });
  }
  const definition: CustomLevelDefinition = { version: 1, name: 'sentinel-approach', seed, cols: COLS, rows: ROWS, terrain: Array(COLS * ROWS).fill('floor'),
    heroIndex: cat, enemies, doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 100, 0, 0, 0], extraColors: [], playerHp: 20 };
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(definition), 'level starts');
  return g;
}
/** The same level with unarmed goblins (no refill while the cat rests): only the shield-bearer acts. */
function calm(setup: Setup): ForestEngine {
  const g = level(setup);
  for (const cell of g.state.board) if (cell?.kind === 'melee' && cell.variant !== 'sentinel') cell.behavior.passive = true;
  prepareIntents(g.state);
  return g;
}
const sentinelOf = (g: ForestEngine) => g.state.board.find((cell): cell is ForestCell => cell?.variant === 'sentinel');
const indexOf = (g: ForestEngine, cell: ForestCell) => g.state.board.indexOf(cell);
const chebyshev = (a: number, b: number) => Math.max(Math.abs(a % COLS - b % COLS), Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)));
const snapshot = (g: ForestEngine) => JSON.stringify(g.captureAnalysisSnapshot());
/** The enemy phase of the coming turn is a step turn of the shield-bearer. */
const stepTurn = (g: ForestEngine) => (g.state.turn + 1) % SENTINEL_STEP_EVERY === 0;
/** The shield turned toward the cat: along the axis of the larger offset, toward the cat. */
function facesCat(g: ForestEngine, cell: ForestCell): boolean {
  const index = indexOf(g, cell), cat = g.state.player.index;
  const dx = cat % COLS - index % COLS, dy = Math.floor(cat / COLS) - Math.floor(index / COLS);
  return Math.abs(dx) > Math.abs(dy) ? cell.shield?.dx === Math.sign(dx) && !cell.shield.dy : cell.shield?.dy === (Math.sign(dy) || 1) && !cell.shield.dx;
}

/** Per battle: the shield-bearer owed its step before the last intents were announced (it rested in its step turn). */
const owedBefore = new WeakMap<ForestEngine, boolean>();
/**
 * What the player sees before acting, then the action, then the result against it. `chain` picks a real move that
 * leaves the shield-bearer alone; none — the cat rests. Returns whether the shield-bearer moved.
 */
async function turn(g: ForestEngine, label: string, chain: boolean): Promise<boolean> {
  const sentinel = sentinelOf(g)!, from = indexOf(g, sentinel), cat = g.state.player.index, hp = g.state.player.hp;
  const announced = g.state.rotations.filter(rotation => rotation.sourceId === sentinel.id);
  assert(announced.length <= 1, `${label}: at most one step`);
  // The announcement, judged against the cat where it stood when the enemies announced their intents: a step turn, or
  // the nearest turn without a rest after a step turn spent resting (the owed step, decision of 06.10.2026).
  if (!stepTurn(g) && !owedBefore.get(g)) assert(!announced.length, `${label}: no step outside its step turns`);
  else if (meleeTargets(g.state, from).includes(cat)) assert(!announced.length, `${label}: the cat is in reach, it stays`);
  owedBefore.set(g, !!sentinel.behavior.stepOwed);
  if (announced.length) {
    const [step] = announced;
    assert(step.from === from && chebyshev(step.to, cat) < chebyshev(from, cat), `${label}: the step is strictly nearer to the cat (${from} → ${step.to}, cat ${cat})`);
    assert(Math.abs(step.to - from) === 1 || Math.abs(step.to - from) === COLS, `${label}: a side neighbour`);
    assert(sentinel.intent.label === 'Сближение' && sentinel.intent.moveTo === step.to && !sentinel.intent.cells.length, `${label}: the intent names the step, no swing`);
  }
  const path = chain ? g.availableMoves(6).find(candidate => !candidate.includes(from)) : undefined;
  const before = snapshot(g);
  const preview: ChainPreview = path ? g.preview(path) : g.previewRest();
  assert(snapshot(g) === before, `${label}: the forecast leaves the state, RNG and IDs untouched`);
  const planned = preview.rotations.find(rotation => rotation.sourceId === sentinel.id && rotation.active);
  if (announced.length && !path) assert(planned?.to === announced[0].to, `${label}: the forecast shows the announced step`);
  if (path) { assert(g.beginChain(path[0]), `${label}: chain`); for (const index of path.slice(1)) assert(g.extendChain(index), `${label}: extend`); assert(await g.releaseChain(), `${label}: release`); }
  else assert(await g.waitTurn(), `${label}: rest`);
  assert(g.state.player.hp === hp - preview.damage, `${label}: damage ${hp - g.state.player.hp} as forecast ${preview.damage}`);
  if (!g.state.board.includes(sentinel)) return false;
  const to = indexOf(g, sentinel);
  assert(to === (planned?.to ?? from), `${label}: forecast ${planned?.to ?? from}, executed ${to}`);
  if (g.state.phase === 'PLAYER_INPUT') assert(facesCat(g, sentinel), `${label}: the shield faces the cat from ${to}`);
  return to !== from;
}

/** The cat rests on D7: the shield-bearer walks down the D column one cell per step turn and stops beside the cat. */
async function walksDown(elite: boolean) {
  const g = calm({ seed: spread(elite ? 2 : 1), sentinel: at('D1'), cat: at('D7'), elite }), sentinel = sentinelOf(g)!;
  const stepTurns: number[] = [];
  let struck = 0;
  for (let n = 0; n < 21; n++) {
    if (g.previewRest().damageBySource.melee > 0) struck++;
    const coming = g.state.turn + 1;
    if (await turn(g, `${elite ? 'elite ' : ''}rest ${n}`, false)) stepTurns.push(coming);
  }
  const expected = [1, 2, 3, 4, 5].map(k => k * SENTINEL_STEP_EVERY);
  assert(JSON.stringify(stepTurns) === JSON.stringify(expected), `steps in turns ${expected} (got ${stepTurns})`);
  assert(indexOf(g, sentinel) === at('D6'), `it reached D6 above the cat (at ${indexOf(g, sentinel)})`);
  assert(struck > 0, 'beside the cat, it swings at it');
  console.log(`PASS ${elite ? 'an elite' : 'the'} shield-bearer walks to the resting cat in turns ${stepTurns.join(', ')}, stays beside it and strikes`);
}

/**
 * Resting in its step turn, the shield-bearer does not step (as an elite): the step is owed to the nearest turn without
 * a rest, not to the next multiple (decision of 06.10.2026).
 */
function restDefersTheStep() {
  const g = calm({ seed: spread(5), sentinel: at('D1'), cat: at('D7') }), sentinel = sentinelOf(g)!;
  while ((g.state.turn + 1) % SENTINEL_STEP_EVERY !== 0) g.state.turn++;
  sentinel.behavior.restTurns = 1; g.state.rotations = []; prepareIntents(g.state);
  assert(!g.state.rotations.some(rotation => rotation.sourceId === sentinel.id) && sentinel.behavior.stepOwed === true, 'resting in its step turn: no step, the step is owed');
  g.state.turn++; sentinel.behavior.restTurns = 0; g.state.rotations = []; prepareIntents(g.state);
  assert((g.state.turn + 1) % SENTINEL_STEP_EVERY !== 0, 'the next turn is not a step turn');
  const step = g.state.rotations.find(rotation => rotation.sourceId === sentinel.id);
  assert(step && step.to === at('D2') && !sentinel.behavior.stepOwed, 'the owed step comes in the nearest turn without a rest');
  console.log('PASS resting in its step turn, the shield-bearer owes the step and takes it in the nearest turn without a rest');
}

/** An exact diagonal: no side neighbour is nearer to the cat, so the shield-bearer holds its cell. */
async function diagonalHolds() {
  const g = calm({ seed: spread(3), sentinel: at('A1'), cat: at('G7') }), sentinel = sentinelOf(g)!;
  for (let n = 0; n < 3 * SENTINEL_STEP_EVERY; n++) assert(!(await turn(g, `diagonal ${n}`, false)), `diagonal ${n}: it holds`);
  assert(indexOf(g, sentinel) === at('A1') && !g.state.rotations.length, 'still on A1, nothing announced');
  console.log('PASS an exact diagonal holds the shield-bearer');
}

/**
 * A shield-bearer killed before its step: the announced exchange is dropped in the forecast and in execution, the
 * partner stays. The C column and the shield-bearer are red, the rest blue: the chain C6…C1 enters it from the west
 * (its shield faces the cat below).
 */
async function deadDoesNotStep() {
  const g = calm({ seed: spread(4), sentinel: at('D1'), cat: at('D7'), hp: 3, color: 0, colorOf: index => index % COLS === 2 ? 0 : 1 });
  const sentinel = sentinelOf(g)!;
  while (!stepTurn(g)) assert(await g.waitTurn(), 'rest until a step turn');
  const step = g.state.rotations.find(rotation => rotation.sourceId === sentinel.id);
  assert(step?.to === at('D2'), 'it announces the step down to D2');
  const partner = g.state.board[at('D2')]!;
  const path = ['C6', 'C5', 'C4', 'C3', 'C2', 'C1', 'D1'].map(at);
  const preview = g.preview(path);
  assert(preview.valid && preview.hits.at(-1)?.killed, `the flank chain kills it: ${preview.reason}`);
  assert(preview.rotations.some(rotation => rotation.sourceId === sentinel.id && !rotation.active), 'the forecast drops its step');
  assert(g.beginChain(path[0]), 'chain'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend'); assert(await g.releaseChain(), 'release');
  assert(!g.state.board.includes(sentinel) && g.state.board[at('D2')] === partner, 'it is dead and the partner stays on D2');
  console.log('PASS a shield-bearer killed before its step does not step; the partner stays');
}

/** Real chains on spread seeds: the rule holds on every turn, the forecast equals execution, the replay is exact. */
async function chains() {
  let steps = 0, turns = 0;
  const play = async (seed: number) => {
    const g = level({ seed, sentinel: at('D1'), cat: at('D7') });
    for (let n = 0; n < 12 && g.state.phase === 'PLAYER_INPUT' && sentinelOf(g); n++) { if (await turn(g, `seed ${seed} turn ${n}`, true)) steps++; turns++; }
    return snapshot(g);
  };
  for (let k = 1; k <= 8; k++) {
    const first = await play(spread(k));
    assert(first === await play(spread(k)), `seed ${spread(k)}: the same actions repeat exactly`);
  }
  assert(steps > 0, 'the shield-bearer moved at least once under real chains');
  console.log(`PASS real chains on 8 spread seeds: ${turns / 2} turns (each played twice), ${steps / 2} steps, forecast = execution, exact replay`);
}

await walksDown(false);
await walksDown(true);
restDefersTheStep();
await diagonalHolds();
await deadDoesNotStep();
await chains();
