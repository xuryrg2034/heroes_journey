// Forest laws and the boar: archer arrows strike every creature on the line, spiked board edges,
// thorny cells and the boar charge. Every scenario is played through real engine commands
// (preview → begin/extend/release chain, frost, rest, restart); the forecast must equal execution.
import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomEnemy, type CustomLevelDefinition, type EdgeSide } from './customLevel';
import { BOAR_DAMAGE, SPIKE_HERO_DAMAGE } from './boarCharge';
import { THORN_DAMAGE } from './terrain';
import type { ChainPreview, TerrainKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const COLS = 5;
const at = (x: number, y: number) => y * COLS + x;
type Tile = { enemy?: Omit<CustomEnemy, 'index'>; terrain?: TerrainKind; door?: boolean; device?: { kind: 'pits'; targets: number[]; charges?: number } };
/**
 * `#` wall, `@` cat, digits: weak (0 HP) enemies of that color, `K` boar (green, 3 HP),
 * `H` sturdy green goblin (3 HP). Other symbols come from `legend`.
 */
function level(rows: string[], legend: Record<string, Tile> = {}, extra: Partial<CustomLevelDefinition> = {}): CustomLevelDefinition {
  const tiles: Record<string, Tile> = { K: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' } }, H: { enemy: { kind: 'melee', color: 1, hp: 3 } }, ...legend };
  const terrain: TerrainKind[] = [], enemies: CustomEnemy[] = [], doors: CustomLevelDefinition['doors'] = [], devices: NonNullable<CustomLevelDefinition['devices']> = [];
  let heroIndex = -1;
  rows.join('').split('').forEach((symbol, index) => {
    const tile = /\d/.test(symbol) ? { enemy: { kind: 'melee' as const, color: Number(symbol) as 0, hp: 0 } } : tiles[symbol] ?? {};
    terrain.push(symbol === '#' ? 'wall' : tile.terrain ?? 'floor');
    if (symbol === '@') heroIndex = index;
    if (tile.enemy) enemies.push({ index, ...tile.enemy });
    if (tile.door) doors.push({ index });
    if (tile.device) devices.push({ index, kind: 'pits', charges: tile.device.charges ?? 1, targets: tile.device.targets });
  });
  return { version: 1, name: 'Boar fixture', seed: 4242, cols: COLS, rows: rows.length, terrain, heroIndex, enemies, doors,
    goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    ...(devices.length ? { devices } : {}), ...extra };
}
function start(definition: CustomLevelDefinition, seed?: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(seed === undefined ? definition : { ...definition, seed }), 'fixture level starts');
  return g;
}
const idAt = (g: ForestEngine, index: number) => g.state.board[index]?.id;
const cellById = (g: ForestEngine, id: number) => g.state.board.find(cell => cell?.id === id) ?? null;
const indexOf = (g: ForestEngine, id: number) => g.state.board.findIndex(cell => cell?.id === id);

/** Real input with the forecast contract: pure preview, same damage, chain end and final cat cell. */
async function commit(g: ForestEngine, path: number[], label: string): Promise<ChainPreview> {
  const before = JSON.stringify(g.state), rng = g.captureAnalysisSnapshot();
  const prediction = g.preview(path);
  equal(JSON.stringify(g.state), before, `${label}: preview does not change the state`);
  const afterPreview = g.captureAnalysisSnapshot();
  equal([afterPreview.rng, afterPreview.nextId], [rng.rng, rng.nextId], `${label}: preview spends no RNG and no IDs`);
  assert(prediction.valid, `${label}: ${prediction.reason}`);
  let chainEnd = -1;
  const off = g.subscribe((state, event) => { if (event.type === 'enemy-turn') chainEnd = state.player.index; });
  assert(g.beginChain(path[0]), `${label}: chain starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${label}: chain reaches ${step}`);
  assert(await g.releaseChain(), `${label}: chain resolves`);
  off();
  equal(g.state.lastDamage, prediction.damage, `${label}: incoming damage equals the forecast`);
  equal(g.state.phase === 'LOSE', !!prediction.playerDies, `${label}: death equals the forecast`);
  if (prediction.enemyPhase) {
    equal(chainEnd, prediction.endIndex, `${label}: the chain ends where forecast`);
    if (g.state.phase !== 'LOSE') equal(g.state.player.index, prediction.enemyPhase.heroIndex, `${label}: the cat ends the turn where forecast`);
  }
  return prediction;
}
/** Forecast positions of pushed entities (UI data) match the real positions, unless the entity died later. */
function movesMatch(g: ForestEngine, prediction: ChainPreview, label: string) {
  for (const move of prediction.enemyPhase!.moves) {
    if (move.id === 0) { equal(g.state.player.index, move.to, `${label}: forecast cat push`); continue; }
    if (prediction.enemyPhase!.deaths.some(death => death.id === move.id)) continue;
    equal(indexOf(g, move.id), move.to, `${label}: forecast position of pushed #${move.id}`);
  }
}
function dense(g: ForestEngine, label: string) {
  g.state.board.forEach((cell, index) => {
    const open = g.state.terrain[index] !== 'wall' && index !== g.state.player.index && !g.state.devices.some(device => device.index === index) && !g.state.pits.some(pit => pit.index === index);
    assert(!open || cell, `${label}: ordinary refill fills ${index}`);
  });
}

// Chain voids absorb the push; the rammed body takes the boar's damage; IDs and colors survive the move.
async function compression() {
  const g = start(level(['11K11', '11H11', '11011', '10001', '10001', '11@11']));
  const boar = g.state.board[at(2, 0)]!;
  equal(boar.intent.charge, { dx: 0, dy: 1, length: 3 }, 'the charge is announced toward the cat, vertically');
  equal(boar.intent.cells, [at(2, 1), at(2, 2), at(2, 3)], 'the lane is the orthogonal line of three cells');
  const sturdy = idAt(g, at(2, 1))!, middle = idAt(g, at(2, 2))!, low = idAt(g, at(2, 4))!;
  const colors = new Map(g.state.board.flatMap(cell => cell ? [[cell.id, cell.color] as const] : []));
  const prediction = await commit(g, [at(1, 4), at(2, 3), at(3, 4)], 'compression');
  equal([indexOf(g, boar.id), indexOf(g, sturdy), indexOf(g, middle), indexOf(g, low)], [at(2, 2), at(2, 3), at(2, 4), at(2, 5)], 'the row compresses into the chain voids');
  equal(cellById(g, sturdy)!.hp, 3 - BOAR_DAMAGE, 'only the first body in the row takes the ram');
  equal(prediction.enemyPhase!.knockedDown.sort(), [sturdy, middle, low].sort(), 'pushed entities are knocked down');
  equal(prediction.enemyPhase!.charges, [{ boarId: boar.id, from: at(2, 0), to: at(2, 2), stunned: false }], 'forecast charge path');
  movesMatch(g, prediction, 'compression');
  for (const id of [sturdy, middle, low, boar.id]) equal(cellById(g, id)!.color, colors.get(id), 'pushed survivors keep their colors');
  equal(g.state.objective.kills, 3, 'nobody died from the push');
  dense(g, 'compression');
}

// Spiked edge: the front enemy dies and the kill is credited; without spikes the edge holds and the boar is stunned.
async function edges() {
  const rows = ['11K11', '11H11', '11111', '11111', '01111', '0@111'];
  const g = start(level(rows, {}, { spikedEdges: ['bottom'] }));
  const boar = idAt(g, at(2, 0))!, sturdy = idAt(g, at(2, 1))!, second = idAt(g, at(2, 2))!, doomed = [at(2, 5), at(2, 4), at(2, 3)].map(index => idAt(g, index)!);
  const prediction = await commit(g, [at(0, 5), at(0, 4)], 'spiked edge');
  equal(prediction.enemyPhase!.deaths.map(death => [death.id, death.cause]), doomed.map(id => [id, 'spikes']), 'forecast names the enemies pushed onto the spikes');
  assert(doomed.every(id => !cellById(g, id)), 'three enemies die on the spikes');
  equal(g.state.objective.kills, 2 + 3, 'spike deaths are credited to the player');
  equal([indexOf(g, boar), indexOf(g, sturdy), indexOf(g, second)], [at(2, 3), at(2, 4), at(2, 5)], 'the boar advances its full length');
  movesMatch(g, prediction, 'spiked edge');
  dense(g, 'spiked edge');

  const plain = start(level(rows));
  const plainBoar = plain.state.board[at(2, 0)]!, column = [1, 2, 3, 4, 5].map(y => idAt(plain, at(2, y)));
  const held = await commit(plain, [at(0, 5), at(0, 4)], 'plain edge');
  equal([1, 2, 3, 4, 5].map(y => idAt(plain, at(2, y))), column, 'a plain edge holds the whole row');
  equal(indexOf(plain, plainBoar.id), at(2, 0), 'the boar does not move');
  assert(held.enemyPhase!.charges[0].stunned && plainBoar.behavior.restTurns === 1 && plainBoar.status.brittle, 'zero advance stuns the boar: rest and brittleness');
  equal(plain.state.objective.kills, 2, 'nobody dies at a plain edge');
  assert(!plainBoar.intent.charge && plainBoar.intent.label === 'Оглушён', 'a stunned boar announces no charge');
  let charges = 0; plain.subscribe((_state, event) => { if (event.type === 'charge') charges++; });
  assert(await plain.waitTurn(), 'rest turn resolves');
  const after = plain.state.board[at(2, 0)]!;
  assert(after.id === plainBoar.id && charges === 0 && after.behavior.restTurns === 0, 'the stunned boar skips one phase');
  assert(after.intent.charge && after.intent.label === 'Рывок', 'after the stun the boar announces again');
}

// The cat pushed against the spiked edge takes damage and holds the row.
async function heroOnSpikes() {
  const g = start(level(['11K11', '11H11', '11111', '11111', '11001', '110@1'], {}, { spikedEdges: ['bottom'] }));
  const boar = idAt(g, at(2, 0))!;
  const prediction = await commit(g, [at(3, 4), at(2, 4), at(2, 5)], 'cat on spikes');
  equal([prediction.chargeDamage, g.state.player.hp], [SPIKE_HERO_DAMAGE, 5 - SPIKE_HERO_DAMAGE], 'spikes hurt the cat once');
  equal(g.state.player.index, at(2, 5), 'the cat stays on its cell');
  equal(indexOf(g, boar), at(2, 1), 'the boar stops when the cat holds the row');
  equal(g.state.objective.kills, 3, 'the held row loses nobody');
}

// A push onto thorns: weak dies (credited), sturdy is wounded, standing on thorns is harmless; a chain end on thorns costs 1.
async function thorns() {
  const g = start(level(['11K11', '11H11', '11011', '10001', '10T01', '11@11'], {
    H: { enemy: { kind: 'melee', color: 1, hp: 4 } }, T: { enemy: { kind: 'melee', color: 0, hp: 0 }, terrain: 'thorns' },
  }));
  const sturdy = idAt(g, at(2, 1))!, weak = idAt(g, at(2, 2))!, standing = idAt(g, at(2, 4))!;
  const prediction = await commit(g, [at(1, 4), at(2, 3), at(3, 4)], 'thorns');
  equal(prediction.enemyPhase!.deaths.map(death => [death.id, death.cause]), [[weak, 'thorns']], 'forecast: the weak goblin dies on the thorns');
  assert(!cellById(g, weak), 'a weak enemy pushed onto thorns dies');
  equal([indexOf(g, sturdy), cellById(g, sturdy)!.hp], [at(2, 4), 4 - BOAR_DAMAGE - THORN_DAMAGE], 'a sturdy enemy pushed onto thorns is wounded');
  assert(cellById(g, standing), 'the goblin that merely stood on thorns was unharmed');
  equal(g.state.objective.kills, 3 + 1, 'the thorn death is credited');

  const end = start(level(['11K11', '11111', '11111', '11111', '0T111', '0@111'], { T: { enemy: { kind: 'melee', color: 0, hp: 0 }, terrain: 'thorns' } }));
  const onThorns = await commit(end, [at(0, 5), at(1, 4)], 'chain end on thorns');
  equal([onThorns.thornDamage, end.state.player.hp], [THORN_DAMAGE, 5 - THORN_DAMAGE], 'a chain ending on thorns costs 1 HP, shown in the forecast');
  const wait = end.state.player.hp; assert(await end.waitTurn() && end.state.player.hp === wait, 'resting on thorns is harmless');
}

// Knocked-down enemies skip their attack; without the push the same goblin hits the cat.
async function knockedDown() {
  const rows = ['11K11', '11a01', '11101', '111@1', '11111', '11111'];
  const legend: Record<string, Tile> = { a: { enemy: { kind: 'melee', color: 1, hp: 3, aggressive: true } } };
  const pushed = start(level(rows, legend, { spikedEdges: ['bottom'] }));
  const armed = pushed.state.board[at(2, 1)]!;
  assert(armed.intent.cells.includes(at(3, 1)), 'the armed goblin threatens the cell where the chain ends');
  const prediction = await commit(pushed, [at(3, 2), at(3, 1)], 'knocked down');
  assert(prediction.enemyPhase!.knockedDown.includes(armed.id) && prediction.damage === 0, 'the pushed goblin is knocked down and does not attack');
  assert(armed.behavior.aggressive && armed.behavior.restTurns === 0, 'it did not spend its attack');

  const control = start(level(rows, legend));
  const hit = await commit(control, [at(3, 2), at(3, 1)], 'not pushed');
  equal(hit.damage, 1, 'without the push the same goblin hits the cat');
}

// The cat is rammed, pushed down the lane and lands on a cell another enemy announced: that attack hits.
async function pushedIntoAttack() {
  const g = start(level(['11K11', '11001', '111@1', '11111', '1a111', '11111'], { a: { enemy: { kind: 'melee', color: 1, hp: 0, aggressive: true } } }, { spikedEdges: ['bottom'] }));
  const boar = idAt(g, at(2, 0))!, armed = g.state.board[at(1, 4)]!;
  assert(!armed.intent.cells.includes(at(2, 1)) && armed.intent.cells.includes(at(2, 4)), 'the goblin does not threaten the chain end, only the landing cell');
  const prediction = await commit(g, [at(3, 1), at(2, 1)], 'pushed into an attack');
  equal(prediction.enemyPhase!.heroIndex, at(2, 4), 'forecast: the cat is pushed three cells');
  equal([prediction.chargeDamage, prediction.damage], [BOAR_DAMAGE, BOAR_DAMAGE + 1], 'ram plus the attack on the landing cell');
  assert(prediction.threats.includes(at(2, 0)) && prediction.threats.includes(at(1, 4)), 'both sources are listed as threats');
  equal([g.state.player.index, g.state.player.hp, indexOf(g, boar)], [at(2, 4), 5 - BOAR_DAMAGE - 1, at(2, 3)], 'execution: cat position, HP and boar position');
  movesMatch(g, prediction, 'pushed into an attack');
}

// A shield facing the boar and a frozen creature hold the row; a shield facing away is pushed. A frozen boar does not charge.
async function holders() {
  const facing = start(level(['11K11', '11H11', '11@11', '11S11', '11111', '11111'], { H: { enemy: { kind: 'melee', color: 1, hp: 5 } }, S: { enemy: { kind: 'melee', color: 1, hp: 7, variant: 'sentinel' } } }, { spikedEdges: ['bottom'] }));
  const sentinel = facing.state.board[at(2, 3)]!, boar = facing.state.board[at(2, 0)]!;
  equal(sentinel.shield, { dx: 0, dy: -1 }, 'the shield faces the cat, toward the boar');
  const column = [1, 3, 4, 5].map(y => idAt(facing, at(2, y)));
  assert(await facing.waitTurn(), 'rest resolves');
  equal([1, 3, 4, 5].map(y => idAt(facing, at(2, y))), column, 'a facing shield holds the row');
  assert(facing.state.player.index === at(2, 2) && facing.state.player.hp === 5 && boar.behavior.restTurns === 1, 'the cat stays unhurt; the boar is stunned');

  const behind = start(level(['11K11', '11S11', '11111', '11@11', '11111', '11111'], { S: { enemy: { kind: 'melee', color: 1, hp: 7, variant: 'sentinel' } } }, { spikedEdges: ['bottom'] }));
  const back = behind.state.board[at(2, 1)]!;
  equal(back.shield, { dx: 0, dy: 1 }, 'the shield faces away from the boar');
  assert(await behind.waitTurn(), 'rest resolves');
  equal([indexOf(behind, back.id), back.hp], [at(2, 3), 7 - BOAR_DAMAGE], 'the shield bearer is rammed from behind and pushed');
  equal([behind.state.player.index, behind.state.player.hp], [at(2, 5), 5 - SPIKE_HERO_DAMAGE], 'the cat slides to the spiked edge, is hurt and holds');

  const frozen = start(level(['11K11', '11H11', '11@11', '11W11', '11111', '11111'], { H: { enemy: { kind: 'melee', color: 1, hp: 5 } }, W: { enemy: { kind: 'melee', color: 1, hp: 0 }, terrain: 'puddle' } }, { spikedEdges: ['bottom'] }));
  const ice = frozen.state.board[at(2, 3)]!;
  assert(frozen.prepareFrost(at(2, 3)) && ice.status.frozen > 0, 'real frost freezes the wet goblin');
  const frozenColumn = [1, 3, 4, 5].map(y => idAt(frozen, at(2, y)));
  assert(await frozen.waitTurn(), 'rest resolves');
  equal([1, 3, 4, 5].map(y => idAt(frozen, at(2, y))), frozenColumn, 'a frozen creature holds the row');

  const cold = start(level(['11W11', '11111', '11111', '11111', '11111', '11@11'], { W: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' }, terrain: 'puddle' } }, { spikedEdges: ['bottom'] }));
  const frozenBoar = cold.state.board[at(2, 0)]!, lane = [1, 2, 3, 4].map(y => idAt(cold, at(2, y)));
  assert(cold.prepareFrost(at(2, 0)), 'frost reaches the wet boar');
  let charges = 0; cold.subscribe((_state, event) => { if (event.type === 'charge') charges++; });
  assert(await cold.waitTurn(), 'rest resolves');
  assert(charges === 0 && indexOf(cold, frozenBoar.id) === at(2, 0) && frozenBoar.behavior.restTurns === 0, 'a frozen boar does not charge and is not stunned');
  equal([1, 2, 3, 4].map(y => idAt(cold, at(2, y))), lane, 'its lane is untouched');

  const bossRow = start(level(['11K11', '11B11', '11111', '11@11', '11111', '11111'], { B: { enemy: { kind: 'boss', color: null, hp: 9 } } }, { spikedEdges: ['bottom'] }));
  const heavy = bossRow.state.board[at(2, 1)]!;
  assert(await bossRow.waitTurn(), 'rest resolves');
  assert(indexOf(bossRow, heavy.id) === at(2, 1) && heavy.hp === 9 - BOAR_DAMAGE && bossRow.state.player.index === at(2, 3), 'a boss holds the row but takes the ram');
}

// Open pit behind the row: the front enemy falls on each step.
async function pit() {
  const g = start(level(['11K11', '11H11', '11111', '11111', '00111', 'L@111'], { L: { device: { kind: 'pits', targets: [at(2, 5)] } } }));
  const doomed = [at(2, 4), at(2, 3), at(2, 2)].map(index => idAt(g, index)!);
  const prediction = await commit(g, [at(1, 4), at(0, 4), at(0, 5)], 'pit');
  equal(prediction.pitCells, [at(2, 5)], 'the lever opens the pit behind the row');
  equal(prediction.enemyPhase!.deaths.map(death => [death.id, death.cause]), doomed.map(id => [id, 'pit']), 'forecast: three enemies fall');
  assert(doomed.every(id => !cellById(g, id)), 'pushed enemies fall into the open pit');
  equal(g.state.objective.kills, 2 + 1 + 3, 'chain, lever and pit falls are credited');
  movesMatch(g, prediction, 'pit');
}

// Orthogonal lanes only; a tie between axes is vertical; a diagonal cat is outside the lane.
async function orthogonal() {
  const tie = start(level(['K1111', '11111', '11@11', '11111', '11111']));
  equal(tie.state.board[0]!.intent.charge, { dx: 0, dy: 1, length: 3 }, 'tie between axes: vertical');
  const wide = start(level(['K1111', '111@1', '11111', '11111', '11111']));
  equal(wide.state.board[0]!.intent.charge, { dx: 1, dy: 0, length: 3 }, 'dominant horizontal axis');
  equal(wide.state.board[0]!.intent.cells, [1, 2, 3], 'the lane stays on the row');
  const diagonal = start(level(['K1111', '1@111', '11111', '11111', '11111'], {}, { spikedEdges: ['bottom', 'right'] }));
  assert(await diagonal.waitTurn() && diagonal.state.player.hp === 5 && diagonal.state.player.index === at(1, 1), 'a diagonal cat is never rammed or pushed');
}

// Archer: every creature on the announced cells is struck, kills are credited, doors and prisms are untouched,
// and an attacker killed by an earlier arrow no longer attacks.
async function archer() {
  const g = start(level(['A111A', '0111D', 'P111h', 'a0110', '00111', '@1111'], {
    A: { enemy: { kind: 'ranged', color: 1, hp: 3 } }, D: { door: true }, P: { enemy: { kind: 'prism', color: null, hp: 1 } },
    h: { enemy: { kind: 'melee', color: 1, hp: 3 } }, a: { enemy: { kind: 'melee', color: 1, hp: 0, aggressive: true } },
  }));
  equal(g.state.board[0]!.intent.cells, [at(0, 1), at(0, 2), at(0, 3)], 'the archer line is unchanged: three cells toward the cat');
  const armed = g.state.board[at(0, 3)]!, weak = idAt(g, at(0, 1))!, far = idAt(g, at(4, 3))!, door = g.state.board[at(4, 1)]!, prism = g.state.board[at(0, 2)]!, sturdy = g.state.board[at(4, 2)]!;
  assert(armed.intent.cells.includes(at(1, 3)), 'the armed goblin threatens the chain end');
  const prediction = await commit(g, [at(0, 4), at(1, 3)], 'archer');
  equal(prediction.enemyPhase!.deaths.map(death => [death.id, death.cause]).sort(), [[weak, 'arrow'], [armed.id, 'arrow'], [far, 'arrow']].sort(), 'forecast lists the arrow kills');
  equal(prediction.damage, 0, 'the goblin shot by the first archer never attacks');
  assert(!cellById(g, weak) && !cellById(g, armed.id) && !cellById(g, far), 'weak creatures on the lines die');
  equal(sturdy.hp, 2, 'a sturdy creature on the line is wounded');
  assert(cellById(g, prism.id) && cellById(g, door.id) && door.hp === 1 && !door.door?.breached, 'prisms and doors are not struck');
  equal(g.state.objective.kills, 2 + 3, 'arrow kills are credited to the player');
}

// Seeded replay, forecast purity and cancellation of a stale turn during a charge.
async function determinism() {
  const definition = level(['11K11', '11H11', '11011', '10001', '10T01', '11@11'], { T: { enemy: { kind: 'melee', color: 0, hp: 0 }, terrain: 'thorns' } }, { spikedEdges: ['bottom', 'left'] });
  for (const seed of [4242, 77, 901]) {
    const a = start(definition, seed), b = start(definition, seed);
    for (let turn = 0; turn < 4 && a.state.phase === 'PLAYER_INPUT'; turn++) {
      const path = turn === 0 ? [at(1, 4), at(2, 3), at(3, 4)] : a.availableMoves(6)[0];
      for (let n = 0; n < 3; n++) a.preview(path); // extra previews must not change the outcome
      await commit(a, path, `replay seed ${seed} turn ${turn}`);
      await commit(b, path, `replay seed ${seed} turn ${turn} (twin)`);
      equal(JSON.stringify(a.state), JSON.stringify(b.state), `seed ${seed} turn ${turn}: identical replay`);
    }
  }
  const json = validateCustomLevel(JSON.parse(JSON.stringify(definition)));
  assert(json.valid && json.definition!.spikedEdges!.join() === 'bottom,left' && json.definition!.terrain[at(2, 4)] === 'thorns', 'JSON round trip keeps spikes and thorns');

  const g = start(level(['11K11', '11H11', '11111', '11111', '01111', '0@111'], {}, { spikedEdges: ['bottom'] }));
  const column = [0, 1, 2, 3, 4, 5].map(y => idAt(g, at(2, y)));
  for (const boundary of ['charge', 'push', 'kill'] as const) {
    let restarted = false, charging = false; const trace: string[] = [];
    const off = g.subscribe((_state, event) => {
      trace.push(event.type); if (event.type === 'charge') charging = true;
      if (!restarted && charging && event.type === boundary) { restarted = true; g.restartLevel(); }
    });
    assert(g.beginChain(at(0, 5)) && g.extendChain(at(0, 4)), 'chain prepared');
    equal(await g.releaseChain(), false, `${boundary}: the stale turn reports cancellation`);
    off();
    assert(restarted && trace.at(-1) === 'start', `${boundary}: nothing of the old turn runs after the restart`);
    equal([g.state.turn, g.state.phase, g.state.player.index, g.state.player.hp], [0, 'PLAYER_INPUT', at(1, 5), 5], `${boundary}: the restart restores the entry`);
    equal([0, 1, 2, 3, 4, 5].map(y => idAt(g, at(2, y))), column, `${boundary}: the column is back in place`);
  }
  const slow = start(level(['11K11', '11H11', '11111', '11111', '01111', '0@111'], {}, { spikedEdges: ['bottom'] }));
  slow.animationScale = 0.05; let later = false;
  slow.subscribe((_state, event) => { if (event.type === 'push' && !later) { later = true; setTimeout(() => slow.restartLevel(), 0); } });
  assert(slow.beginChain(at(0, 5)) && slow.extendChain(at(0, 4)), 'slow chain prepared');
  equal(await slow.releaseChain(), false, 'a restart during the charge animation cancels the turn');
  equal([slow.state.turn, slow.state.objective.kills], [0, 0], 'no stale kills after the restart');
}

function validation() {
  const base = level(['11K11', '11111', '11@11', '11111', '11111']);
  assert(validateCustomLevel({ ...base, spikedEdges: ['top', 'left'] }).valid, 'spiked edges are accepted');
  for (const spikedEdges of [['diagonal'], ['top', 'top'], 'top', [1]] as unknown[]) assert(!validateCustomLevel({ ...base, spikedEdges }).valid, `invalid spiked edges ${JSON.stringify(spikedEdges)} are rejected`);
  const thorny = structuredClone(base); thorny.terrain[at(2, 2)] = 'thorns';
  assert(validateCustomLevel(thorny).valid, 'the cat may start on thorns');
  const big = structuredClone(base); const boar = big.enemies.find(enemy => enemy.variant === 'boar')!; boar.footprint = [boar.index, boar.index + 1];
  big.enemies = big.enemies.filter(enemy => enemy === boar || enemy.index !== boar.index + 1);
  assert(!validateCustomLevel(big).valid, 'a boar occupies one cell');
  const ranged = structuredClone(base); ranged.enemies.find(enemy => enemy.variant === 'boar')!.kind = 'ranged';
  assert(!validateCustomLevel(ranged).valid, 'a boar is a melee variant');
  const restart = start(level(['11K11', '11H11', '11111', '11111', '01111', '0@111'], {}, { spikedEdges: ['bottom'] as EdgeSide[] }));
  restart.restartLevel(); equal(restart.state.customLevel!.definition.spikedEdges, ['bottom'], 'restart keeps the spiked edges');
}

// Two boars run in board order at the start of the phase; a boar pushed by an earlier one does not charge.
async function twoBoars() {
  const g = start(level(['11K11', '11K11', '11111', '11111', '01111', '0@111'], {}, { spikedEdges: ['bottom'] }));
  const first = g.state.board[at(2, 0)]!, second = g.state.board[at(2, 1)]!;
  assert(first.intent.charge && second.intent.charge, 'both boars announce a charge');
  const charges: number[] = []; g.subscribe((_state, event) => { if (event.type === 'charge') charges.push(event.index!); });
  const prediction = await commit(g, [at(0, 5), at(0, 4)], 'stacked boars');
  equal(prediction.enemyPhase!.charges.map(charge => charge.boarId), [first.id], 'forecast: only the upper boar charges');
  equal(charges, [at(2, 0)], 'execution: one charge event');
  assert(prediction.enemyPhase!.knockedDown.includes(second.id) && second.hp === 3 - BOAR_DAMAGE, 'the lower boar is rammed and knocked down');
  equal([indexOf(g, first.id), indexOf(g, second.id)], [at(2, 3), at(2, 4)], 'the lower boar only moved with the row');
  movesMatch(g, prediction, 'stacked boars');

  const apart = start(level(['K111K', '11111', '11111', '11111', '11111', '11@11']));
  const left = apart.state.board[0]!, right = apart.state.board[4]!;
  const order: number[] = []; apart.subscribe((_state, event) => { if (event.type === 'charge') order.push(event.index!); });
  const both = await commit(apart, [at(1, 5), at(1, 4)], 'two boars');
  equal(both.enemyPhase!.charges.map(charge => charge.boarId), [left.id, right.id], 'forecast: board order');
  equal(order, [at(0, 0), at(4, 0)], 'execution: board order');
}

// A multi-cell figure holds the row: it takes the ram but does not move; the boar is stunned.
async function largeHolder() {
  const definition = level(['11K11', '11111', '11111', '11111', '11111', '1@111'], {}, { spikedEdges: ['bottom'] });
  const footprint = [at(2, 1), at(3, 1), at(2, 2), at(3, 2)];
  definition.enemies = definition.enemies.filter(enemy => !footprint.includes(enemy.index));
  definition.enemies.push({ index: at(2, 1), kind: 'melee', color: 1, hp: 10, variant: 'wardrobe', footprint });
  const g = start(definition);
  const wardrobe = g.state.board[at(2, 1)]!, boar = g.state.board[at(2, 0)]!, below = [3, 4, 5].map(y => idAt(g, at(2, y)));
  assert(boar.intent.charge, 'the boar announces its charge into the wardrobe');
  const prediction = await commit(g, [at(0, 5), at(0, 4)], 'large holder');
  equal(prediction.enemyPhase!.charges, [{ boarId: boar.id, from: at(2, 0), to: at(2, 0), stunned: true }], 'forecast: the boar is stopped and stunned');
  assert(footprint.every(index => g.state.board[index] === wardrobe) && wardrobe.hp === 10 - BOAR_DAMAGE, 'the wardrobe stays in place and takes the ram');
  equal([3, 4, 5].map(y => idAt(g, at(2, y))), below, 'nothing behind it moves');
  assert(boar.behavior.restTurns === 1 && boar.status.brittle, 'zero advance stuns the boar');
}

// The cat standing on a device in the row is rammed there but never slides off it; the row behind stays.
async function catOnDevice() {
  const g = start(level(['11K11', '11111', '1@111', '11L11', '11111', '11111'], { L: { device: { kind: 'pits', targets: [at(4, 5)], charges: 0 } } }, { spikedEdges: ['bottom'] }));
  const boar = g.state.board[at(2, 0)]!, below = [4, 5].map(y => idAt(g, at(2, y)));
  equal(boar.intent.cells, [at(2, 1), at(2, 2)], 'the device cuts the announced lane');
  const prediction = await commit(g, [at(2, 1), at(2, 2), at(2, 3)], 'cat on a device');
  equal([prediction.endIndex, prediction.chargeDamage, prediction.enemyPhase!.heroIndex], [at(2, 3), BOAR_DAMAGE, at(2, 3)], 'forecast: rammed on the device, not moved');
  equal([g.state.player.index, g.state.player.hp, indexOf(g, boar.id)], [at(2, 3), 5 - BOAR_DAMAGE, at(2, 2)], 'execution: the cat holds, the boar stops in front of it');
  equal([4, 5].map(y => idAt(g, at(2, y))), below, 'the row behind the device is untouched');
}

// A swap announced by a resting archer is cancelled when the boar pushes one of its participants.
async function swapCancelled() {
  const g = start(level(['11W11', '11A11', '11111', '11111', '11111', '1@111'], {
    W: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' }, terrain: 'puddle' }, A: { enemy: { kind: 'ranged', color: 1, hp: 3 } },
  }, { spikedEdges: ['bottom'] }));
  const archer = g.state.board[at(2, 1)]!;
  assert(g.prepareFrost(at(2, 0)) && await g.waitTurn(), 'frozen boar, the archer shoots and rests');
  const swap = g.state.rotations.find(plan => plan.sourceId === archer.id);
  assert(swap && g.state.board[at(2, 0)]!.intent.charge, 'the resting archer announces a swap; the thawed boar announces its charge');
  const swaps: number[] = []; g.subscribe((_state, event) => { if (event.type === 'enemy-swap') swaps.push(event.from!); });
  const prediction = await commit(g, [at(0, 5), at(0, 4)], 'swap cancelled');
  const planned = prediction.rotations.find(plan => plan.sourceId === archer.id)!;
  equal([planned.active, planned.reason], [false, 'Кабан сбил участника обмена.'], 'forecast: the swap is cancelled by the push');
  assert(prediction.enemyPhase!.knockedDown.includes(archer.id), 'the archer is knocked down');
  equal(swaps, [], 'execution: no swap happens');
}

// The ram carries the boar's attack effect onto a cat that already burns and is poisoned; ticks follow in order.
async function ramWithEffects() {
  const rows = ['11K11', '11111', '11111', '11@11', '11111', '11111'];
  const definition = level(rows);
  definition.enemies.find(enemy => enemy.variant === 'boar')!.attackEffect = 'poison';
  const g = start(definition);
  g.state.player.damageEffects = { burning: 1, burningTurns: 0, poison: 1, bleeding: 0, bleedingSteps: 0 }; // state setup: carried effects
  const events: string[] = []; g.subscribe((_state, event) => { if (event.type === 'damage' || event.type === 'status') events.push(`${event.type}:${event.effect ?? event.text ?? ''}`); });
  const prediction = await commit(g, [at(1, 2), at(2, 1)], 'ram with effects');
  equal(prediction.chargeDamage, BOAR_DAMAGE, 'forecast: the ram hits the cat');
  equal(g.state.player.damageEffects, prediction.endEffects, 'forecast: stacks left on the cat');
  equal(g.state.player.damageEffects!.poison, 2, 'the ram added a second poison stack');
  assert(events.indexOf('damage:ram') < events.indexOf('status:') && events.indexOf('damage:fire') < events.indexOf('damage:poison'), `ram, its effect, then burning before poison: ${events.join(' ')}`);
}

// Wizard summon victims are fixed IDs: a boar pushing another chair onto an announced cell never changes the victim.
async function wizardSummonFixed() {
  const legend: Record<string, Tile> = {
    W: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' }, terrain: 'puddle' }, Z: { enemy: { kind: 'boss', color: null, hp: 18, variant: 'wizard' } },
    E: { enemy: { kind: 'melee', color: 0, hp: 10, variant: 'elite' } }, C: { enemy: { kind: 'melee', color: 0, hp: 0, variant: 'chair' } },
    s: { enemy: { kind: 'melee', color: 0, hp: 0, variant: 'stool' } },
  };
  const rows = ['sWssZ', 'sEsss', 'sCsss', 'sCsss', 'sss@s'];
  const scene = async (freezeLast: boolean) => {
    const g = start(level(rows, legend, { playerHp: 20, inventory: { frost: 3 } }));
    for (let turn = 0; turn < 2; turn++) assert(g.prepareFrost(at(1, 0)) && await g.waitTurn(), `turn ${turn + 1}: the frozen boar waits`);
    const wizard = g.state.board[at(4, 0)]!;
    const victim = idAt(g, at(1, 3))!, other = idAt(g, at(1, 2))!;
    assert(wizard.intent.summonCells?.includes(at(1, 3)), 'the wizard announces the lower chair');
    if (freezeLast) assert(g.prepareFrost(at(1, 0)), 'control: the boar stays frozen');
    const arrivals: { index: number; oldId: number }[] = [];
    g.subscribe((_state, event) => { if (event.type === 'special-arrival' && event.text === 'ПРИЗЫВ') arrivals.push({ index: event.index!, oldId: event.oldId! }); });
    await commit(g, [at(2, 3), at(1, 4), at(2, 4)], freezeLast ? 'summon without push' : 'summon after push');
    return { g, victim, other, arrivals };
  };
  const pushed = await scene(false);
  assert(!pushed.arrivals.some(arrival => arrival.index === at(1, 3)) && cellById(pushed.g, pushed.other)?.variant === 'chair', 'the pushed-in chair is not summoned over');
  equal(idAt(pushed.g, at(1, 3)), pushed.other, 'the push moved the other chair onto the announced cell');
  const still = await scene(true);
  assert(still.arrivals.some(arrival => arrival.index === at(1, 3) && arrival.oldId === still.victim), 'control: without the push the announced chair is replaced');
}

async function main() {
  validation();
  await compression();
  await edges();
  await heroOnSpikes();
  await thorns();
  await knockedDown();
  await pushedIntoAttack();
  await holders();
  await pit();
  await orthogonal();
  await archer();
  await determinism();
  await twoBoars();
  await largeHolder();
  await catOnDevice();
  await swapCancelled();
  await ramWithEffects();
  await wizardSummonFixed();
  console.log('PASS boar: two boars in order, pushed boar skips, wardrobe holds, cat on a device, swap cancelled by a push, ram effect with burning and poison, wizard summon IDs fixed before pushes, compression, spiked/plain edges, cat on spikes, thorns, stun, knock-down, pushed into an attack, shield/frost/boss holders, frozen boar, pit, orthogonal lanes, archer friendly fire, forecast = execution, replay and restart');
}
main().catch(error => { console.error(error); throw error; });

