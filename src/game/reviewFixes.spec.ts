/**
 * Regressions for the September 2026 core review. Every case plays the engine
 * through its public commands and fails on the defect that was reported.
 */
import { isCellAlive } from './cellLife';
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { planEnemyPhase } from './enemyPhase';
import { ForestEngine } from './forestEngine';
import type { ForestEvent } from './forestTypes';
import { lesson } from './tutorialLevels';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function fresh(seed?: number) { const g = new ForestEngine(seed); g.animationScale = 0; return g; }
function level(cols: number, rows: number, patch: Partial<CustomLevelDefinition>): CustomLevelDefinition {
  return { version: 1, name: 'review', seed: 1, cols, rows, terrain: Array(cols * rows).fill('floor'), heroIndex: 0, enemies: [], doors: [],
    goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [], ...patch };
}
async function commit(g: ForestEngine, path: number[]) {
  const preview = g.preview(path);
  assert(preview.valid, `route ${path.join('→')}: ${preview.reason}`);
  assert(g.beginChain(path[0]), 'route starts');
  for (const index of path.slice(1)) assert(g.extendChain(index), `route reaches ${index}`);
  assert(await g.releaseChain(), 'route commits');
  return preview;
}

/** 1. An opening search through many devices answers quickly, whether or not a chain exists. */
function deviceSearchIsBounded() {
  const braziers = (enemies: CustomLevelDefinition['enemies']) => level(4, 4, { enemies, goals: [{ key: 'kills', target: 2 }],
    paletteWeights: [100, 0, 0, 0, 0], devices: Array.from({ length: 16 }, (_, index) => index).filter(index => index > 1 && !enemies.some(enemy => enemy.index === index))
      .map(index => ({ index, kind: 'fire' as const, charges: 1, targets: [] })) });
  const lonely = braziers([{ index: 1, kind: 'melee', color: 0, hp: 0 }]);
  assert(validateCustomLevel(lonely).valid, 'brazier field is a well-formed level');
  const g = fresh(), before = JSON.stringify(g.state);
  let started = performance.now();
  assert(!g.startCustomLevel(lonely), 'one enemy among braziers has no opening chain');
  const rejectMs = performance.now() - started;
  assert(rejectMs < 1000, `rejection took ${Math.round(rejectMs)} ms`);
  assert(JSON.stringify(g.state) === before, 'rejected start leaves the previous scene intact');
  const paired = braziers([{ index: 1, kind: 'melee', color: 0, hp: 0 }, { index: 15, kind: 'melee', color: 0, hp: 0 }]);
  const h = fresh(); started = performance.now();
  assert(h.startCustomLevel(paired), 'second enemy behind the braziers opens the field');
  const startMs = performance.now() - started;
  assert(startMs < 1000, `accepted start took ${Math.round(startMs)} ms`);
  assert(h.preview([1, 2, 3, 7, 11, 15]).valid, 'the chain through several braziers is a real route');
  console.log(`PASS bounded device search: reject ${Math.round(rejectMs)} ms, accept ${Math.round(startMs)} ms`);
}

/** 2. Three prisms in a row link two enemies of different colours, as a played chain does. */
async function prismCorridorOpens() {
  const terrain = Array(32).fill('wall'); for (let index = 8; index <= 13; index++) terrain[index] = 'floor';
  const corridor = level(8, 4, { terrain, heroIndex: 8, goals: [{ key: 'kills', target: 2 }],
    enemies: [{ index: 9, kind: 'melee', color: 0, hp: 0 }, { index: 13, kind: 'melee', color: 1, hp: 0 },
      ...[10, 11, 12].map(index => ({ index, kind: 'prism' as const, color: null, hp: 0 }))] });
  const g = fresh();
  assert(g.startCustomLevel(corridor), 'prism corridor has an opening chain');
  const preview = await commit(g, [9, 10, 11, 12, 13]);
  assert(preview.enemies === 2 && preview.completesRoom, 'route kills both enemies');
  assert(g.state.phase === 'WIN', 'prism corridor is won by the found route');
  console.log('PASS long prism chains count as openings');
}

/** 3. A lethal gate volley ends the turn before later arrows hit, kill or credit enemies. */
async function volleyStopsAtCatDeath() {
  let checked = 0;
  for (const seed of [55, 701, 83]) {
    const g = fresh(seed); g.startCampaign(seed);
    g.state.player.hp = g.state.player.maxHp = 99;
    for (let turn = 0; turn < 6 && g.state.hazard.turnsUntil !== 1; turn++) await g.waitTurn();
    const { cells } = g.state.hazard;
    assert(g.state.phase === 'PLAYER_INPUT' && g.state.hazard.turnsUntil === 1 && cells[0] === g.state.player.index, 'volley is announced on the resting cat');
    if (!cells.slice(1).some(index => { const cell = g.state.board[index]; return cell && cell.kind !== 'door' && cell.kind !== 'prism'; })) continue;
    // Survive the ordinary attacks exactly; the arrows then deal the last points.
    const attacks = planEnemyPhase(g.state.board, g.state.player.index).attacks.filter(attack => attack.hitsHero);
    g.state.player.hp = g.state.hazard.damage + attacks.reduce((sum, attack) => sum + attack.cell.intent.damage, 0);
    const kills = g.state.room.combatKills, objective = g.state.objective.kills;
    const living = new Set(g.state.board.flatMap(cell => cell && cell.kind !== 'door' ? [cell.id] : []));
    const events: ForestEvent[] = [];
    g.subscribe((_state, event) => events.push({ ...event }));
    await g.waitTurn();
    const lethal = events.findIndex(event => event.type === 'damage' && event.index === cells[0] && g.state.player.hp === 0);
    assert(g.state.phase === 'LOSE' && g.state.player.hp === 0, 'the volley kills the cat');
    assert(lethal >= 0 && !events.slice(lethal + 1).some(event => event.type === 'hit' || event.type === 'kill'), 'no arrow lands after the lethal one');
    assert(g.state.room.combatKills === kills && g.state.objective.kills === objective, 'no kill is credited after the cat dies');
    assert([...living].every(id => g.state.board.some(cell => cell?.id === id)), 'every enemy survives the unfinished volley');
    checked++;
  }
  assert(checked > 0, 'at least one volley also targeted enemies');
  console.log(`PASS lethal volley stops immediately (${checked} seeds)`);
}

/** 4. The beacon only announces replacements that the arrival step performs. */
async function beaconAnnouncementsArrive() {
  const enemies: CustomLevelDefinition['enemies'] = [{ index: 3, kind: 'boss', variant: 'beacon', color: null, hp: 8 }];
  for (let index = 0; index < 49; index++) if (index !== 3 && index !== 45) enemies.push(index >= 35
    ? { index, kind: 'melee', color: 1, hp: 0 } : { index, kind: 'melee', variant: 'stool', color: 0, hp: 0 });
  const g = fresh();
  assert(g.startCustomLevel(level(7, 7, { heroIndex: 45, enemies, goals: [{ key: 'bossKills', target: 1 }], playerHp: 20 })), 'beacon field starts');
  const arrivals: number[] = [];
  g.subscribe((_state, event) => { if (event.type === 'special-arrival') arrivals.push(event.index!); });
  let announced: { index: number; id: number }[] = [];
  for (let turn = 0; turn < 4 && !announced.length; turn++) {
    await g.waitTurn();
    const beacon = g.state.board[3]!;
    announced = (beacon.intent.summonCells ?? []).map((index, n) => ({ index, id: beacon.intent.summonIds![n] }));
  }
  assert(announced.length === 2, 'beacon announces two calm weak targets');
  assert(announced.every(({ index }) => !g.state.board[index]!.variant), 'stools are never announced');
  await g.waitTurn();
  assert(JSON.stringify(arrivals) === JSON.stringify(announced.map(target => target.index)), `announced ${announced.map(target => target.index)} arrived at ${arrivals}`);
  assert(announced.every(({ index, id }) => g.state.board[index]!.id !== id && g.state.board[index]!.behavior.aggressive), 'armed goblins replaced every announced enemy');
  console.log('PASS beacon announcements match arrivals');
}

/** 5. A large cabinet guards an ally next to any of its squares; a sentinel stays single-square. */
async function largeCabinetGuardsPerimeter() {
  const terrain = Array(49).fill('floor'); for (const index of [0, 1, 2, 7, 14]) terrain[index] = 'wall';
  const enemies: CustomLevelDefinition['enemies'] = [{ index: 8, kind: 'melee', variant: 'cabinet', color: 0, hp: 4, footprint: [8, 9, 15, 16] }];
  for (let index = 0; index < 49; index++) if (terrain[index] === 'floor' && ![8, 9, 15, 16, 11].includes(index))
    enemies.push({ index, kind: 'melee', color: [3, 4, 5].includes(index) ? 0 : 1, hp: index === 3 ? 3 : 0 });
  const g = fresh();
  assert(g.startCustomLevel(level(7, 7, { terrain, heroIndex: 11, enemies, playerHp: 20 })), 'cabinet field starts');
  const cabinet = g.state.board[8]!, guarded = g.state.board[3]!;
  assert(cabinet.supportTargetId === guarded.id, 'first ally around the whole cabinet is guarded, although its first square touches only walls');
  const preview = await commit(g, [5, 4, 3]);
  const hit = preview.hits.at(-1)!;
  assert(hit.index === 3 && hit.availablePower === 3 && hit.damage === 2 && !hit.killed, 'guard lowers the 3-power hit to 2');
  const survivor = g.state.board[3];
  assert(survivor?.id === guarded.id && survivor.hp === 1 && isCellAlive(survivor), 'guarded ally survives with the forecast HP');
  const sentinel = level(7, 7, { heroIndex: 45, enemies: [{ index: 8, kind: 'melee', variant: 'sentinel', color: 0, hp: 3, footprint: [8, 9] }] });
  assert(!validateCustomLevel(sentinel).valid, 'a multi-square sentinel has no shield facing and is rejected');
  sentinel.enemies[0].footprint = undefined;
  assert(validateCustomLevel(sentinel).valid, 'a single-square sentinel stays valid');
  console.log('PASS large cabinet guards around its footprint; sentinel stays one square');
}

/** 6. Enumerated JSON fields must be strings, not arrays that stringify to a valid value. */
function strictEnumerations() {
  const base = level(4, 4, { heroIndex: 0, enemies: [{ index: 1, kind: 'melee', color: 0, hp: 0 }, { index: 2, kind: 'melee', color: 0, hp: 0 }],
    devices: [{ index: 5, kind: 'fire', charges: 1, targets: [] }] });
  assert(validateCustomLevel(base).valid, 'baseline JSON is valid');
  const mutations: [string, (value: any) => void][] = [
    ['kind', value => { value.enemies[0].kind = ['melee']; }],
    ['variant', value => { value.enemies[0].variant = ['stool']; }],
    ['goal key', value => { value.goals[0].key = ['kills']; }],
    ['device kind', value => { value.devices[0].kind = ['fire']; }],
    ['terrain', value => { value.terrain[3] = ['floor']; }],
  ];
  for (const [label, mutate] of mutations) {
    const value = JSON.parse(JSON.stringify(base)); mutate(value);
    assert(!validateCustomLevel(value).valid, `${label} given as an array is rejected`);
    const g = fresh(), before = JSON.stringify(g.state);
    assert(!g.startCustomLevel(value) && JSON.stringify(g.state) === before, `${label} array does not start a broken level`);
  }
  console.log('PASS strict enum validation');
}

/** 7. Walls and the cat do not add red to a lesson palette; refill then never produces red. */
async function lessonPaletteFromEnemiesOnly() {
  const blueGreen = lesson('chain', 'Без красного', '', '', ['#BBGG', '#BBGG', '#HBGG', '#BBGG'], 11, 99);
  assert(blueGreen.definition.paletteWeights[0] === 0, 'red is absent from a map without red enemies');
  let refilled = 0;
  for (const seed of [11, 83, 701, 4242]) {
    const g = fresh(); blueGreen.definition.seed = seed;
    assert(g.startCustomLevel(blueGreen.definition), 'blue/green lesson map starts');
    const initial = new Set(g.state.board.flatMap(cell => cell ? [cell.id] : []));
    for (let turn = 0; turn < 6 && g.state.phase === 'PLAYER_INPUT'; turn++) {
      const route = g.availableMoves(6).find(path => path.length > 1);
      if (!route) { await g.waitTurn(); continue; }
      await commit(g, route);
    }
    for (const cell of g.state.board) if (cell && !initial.has(cell.id)) { refilled++; assert(cell.color !== 0, `seed ${seed}: refill produced red`); }
  }
  assert(refilled >= 20, `refill was exercised (${refilled} new enemies)`);
  console.log(`PASS lesson palette ignores walls and the cat (${refilled} refilled enemies)`);
}

async function main() {
  deviceSearchIsBounded();
  await prismCorridorOpens();
  await volleyStopsAtCatDeath();
  await beaconAnnouncementsArrive();
  await largeCabinetGuardsPerimeter();
  strictEnumerations();
  await lessonPaletteFromEnemiesOnly();
  console.log('PASS review fixes');
}
main().catch(error => { console.error(error); throw error; });
