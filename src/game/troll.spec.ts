// Forest troll: a colourless 2×2 boss with a club cycle (windup → strike → rest) and regeneration.
// Every scenario is played through real engine commands (preview → begin/extend/release chain, rest, frost,
// fire, jump, restart); the forecast must equal execution, including `damageBySource.troll`.
import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomEnemy, type CustomLevelDefinition } from './customLevel';
import type { ChainPreview, EngineEvent, TerrainKind } from './forestTypes';
import { TROLL_CLUB_DAMAGE, TROLL_REGEN } from './troll';
import { BOAR_DAMAGE } from './boarCharge';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const COLS = 7;
const at = (x: number, y: number) => y * COLS + x;
const sorted = (cells: number[]) => [...cells].sort((a, b) => a - b);
type Tile = { enemy?: Omit<CustomEnemy, 'index'>; terrain?: TerrainKind; door?: boolean; device?: { kind: 'pits'; targets: number[]; charges?: number } };
const TROLL_TEST_HP = 24;
/**
 * `#` wall, `@` cat, digits: weak (0 HP) enemies of that colour, `T` a 2×2 troll anchored at its top-left square
 * (`t` marks its other three squares), `S` a single-cell troll, `H` a sturdy green goblin (3 HP), `K` a boar,
 * `D` a door, `O` a prism, `B` a beacon. Other symbols come from `legend`.
 */
function level(rows: string[], legend: Record<string, Tile> = {}, extra: Partial<CustomLevelDefinition> = {}, trollHp = TROLL_TEST_HP): CustomLevelDefinition {
  const tiles: Record<string, Tile> = {
    H: { enemy: { kind: 'melee', color: 1, hp: 3 } }, K: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' } },
    S: { enemy: { kind: 'boss', color: null, hp: trollHp, variant: 'troll' } }, O: { enemy: { kind: 'prism', color: null, hp: 1 } },
    B: { enemy: { kind: 'boss', color: null, hp: 8, variant: 'beacon' } }, D: { door: true }, ...legend,
  };
  const terrain: TerrainKind[] = [], enemies: CustomEnemy[] = [], doors: CustomLevelDefinition['doors'] = [], devices: NonNullable<CustomLevelDefinition['devices']> = [];
  let heroIndex = -1;
  rows.join('').split('').forEach((symbol, index) => {
    const tile = /\d/.test(symbol) ? { enemy: { kind: 'melee' as const, color: Number(symbol) as 0, hp: 0 } } : tiles[symbol] ?? {};
    terrain.push(symbol === '#' ? 'wall' : tile.terrain ?? 'floor');
    if (symbol === '@') heroIndex = index;
    if (symbol === 'T') enemies.push({ index, kind: 'boss', color: null, hp: trollHp, variant: 'troll', footprint: [index, index + 1, index + COLS, index + COLS + 1] });
    if (tile.enemy) enemies.push({ index, ...tile.enemy });
    if (tile.door) doors.push({ index });
    if (tile.device) devices.push({ index, kind: 'pits', charges: tile.device.charges ?? 1, targets: tile.device.targets });
  });
  return { version: 1, name: 'Troll fixture', seed: 4242, cols: COLS, rows: rows.length, terrain, heroIndex, enemies, doors,
    goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    ...(devices.length ? { devices } : {}), ...extra };
}
function start(definition: CustomLevelDefinition, seed?: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(seed === undefined ? definition : { ...definition, seed }), 'fixture level starts');
  return g;
}
const trollOf = (g: ForestEngine) => g.state.board.find(cell => cell?.variant === 'troll') ?? null;
const bodyOf = (g: ForestEngine, id: number) => g.state.board.flatMap((cell, index) => cell?.id === id ? [index] : []);
const idAt = (g: ForestEngine, index: number) => g.state.board[index]?.id;
const clubDamage = (events: EngineEvent[]) => events.filter(event => event.type === 'damage' && event.text === 'club').reduce((sum, event) => sum + (event.amount ?? 0), 0);
const clubSwings = (events: EngineEvent[]) => events.filter(event => event.type === 'attack' && event.text === 'club');

/** Real input with the forecast contract: pure preview, same total and troll damage, same club deaths and regeneration. */
async function commit(g: ForestEngine, path: number[], label: string): Promise<{ prediction: ChainPreview; events: EngineEvent[] }> {
  const before = JSON.stringify(g.state), snapshot = g.captureAnalysisSnapshot();
  const prediction = g.preview(path);
  equal(JSON.stringify(g.state), before, `${label}: preview does not change the state`);
  const after = g.captureAnalysisSnapshot();
  equal([after.rng, after.nextId], [snapshot.rng, snapshot.nextId], `${label}: preview spends no RNG and no IDs`);
  assert(prediction.valid, `${label}: ${prediction.reason}`);
  equal(Object.values(prediction.damageBySource).reduce((sum, value) => sum + value, 0), prediction.damage, `${label}: sources sum to the damage`);
  const events: EngineEvent[] = [];
  const off = g.subscribe((_state, event) => { events.push({ ...event }); });
  assert(g.beginChain(path[0]), `${label}: chain starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${label}: chain reaches ${step}`);
  assert(await g.releaseChain(), `${label}: chain resolves`);
  off();
  equal(g.state.lastDamage, prediction.damage, `${label}: incoming damage equals the forecast`);
  equal(clubDamage(events), prediction.damageBySource.troll, `${label}: club damage to the cat equals damageBySource.troll`);
  equal(g.state.phase === 'LOSE', !!prediction.playerDies, `${label}: death equals the forecast`);
  if (prediction.enemyPhase && g.state.phase !== 'LOSE') {
    const clubKills = events.filter(event => event.type === 'kill' && event.text === 'club').length;
    equal(prediction.enemyPhase.deaths.filter(death => death.cause === 'club').length, clubKills, `${label}: forecast club deaths equal the kills`);
    const regen = events.filter(event => event.type === 'regen').map(event => event.amount);
    equal(prediction.enemyPhase.regenerated.map(entry => entry.amount), regen, `${label}: forecast regeneration equals execution`);
  }
  return { prediction, events };
}
async function rest(g: ForestEngine, label: string): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  const off = g.subscribe((_state, event) => { events.push({ ...event }); });
  assert(await g.waitTurn(), `${label}: rest resolves`);
  off();
  return events;
}
function dense(g: ForestEngine, label: string) {
  g.state.board.forEach((cell, index) => {
    const open = g.state.terrain[index] !== 'wall' && index !== g.state.player.index && !g.state.devices.some(device => device.index === index) && !g.state.pits.some(pit => pit.index === index);
    assert(!open || cell, `${label}: refill fills ${index}`);
  });
}

// Windup announces the zone, the next phase strikes everyone in it (enemies included, kills credited), then one rest.
async function cycle() {
  const g = start(level(['11Tt111', '11tt111', '111OD11', '11H1111', '1111111', '111@111']));
  const troll = trollOf(g)!, zone = [at(2, 2), at(3, 2), at(4, 2), at(2, 3), at(3, 3), at(4, 3)];
  equal(sorted(troll.intent.cells), sorted(zone), 'the windup zone: 3 wide, 2 deep, from the edge of the body toward the cat');
  equal([troll.intent.label, troll.behavior.club?.raised], ['Замах дубиной', false], 'the windup is announced');
  const windup = await rest(g, 'windup turn');
  equal(clubSwings(windup).length, 0, 'the windup phase does not strike');
  equal(windup.filter(event => event.type === 'windup').map(event => sorted(event.indices!)), [sorted(zone)], 'the windup event names the fixed zone');
  equal([troll.intent.label, troll.behavior.club?.raised, sorted(troll.intent.cells)], ['Удар дубиной', true, sorted(zone)], 'the strike keeps the announced zone');

  const sturdy = idAt(g, at(2, 3))!, door = idAt(g, at(4, 2))!, prism = idAt(g, at(3, 2))!;
  const doomed = [at(2, 2), at(3, 3), at(4, 3)].map(index => idAt(g, index)!);
  const killsBefore = g.state.objective.kills;
  // The chain keeps the cat out of the zone (row 5 and the lower left).
  const { prediction, events } = await commit(g, [at(2, 4), at(1, 5)], 'strike');
  equal(clubSwings(events).length, 1, 'the club swings once');
  equal(prediction.damageBySource.troll, 0, 'the cat outside the zone takes no club damage');
  equal(clubDamage(events), 0, 'no club damage event for a cat outside the zone');
  equal(sorted(prediction.enemyPhase!.deaths.filter(death => death.cause === 'club').map(death => death.id)), sorted(doomed), 'forecast: the weak enemies in the zone die');
  assert(doomed.every(id => !g.state.board.some(cell => cell?.id === id)), 'the club victims are gone');
  equal(g.state.board.find(cell => cell?.id === sturdy)?.hp, 3 - TROLL_CLUB_DAMAGE, 'the sturdy goblin in the zone takes the club');
  assert(g.state.board.some(cell => cell?.id === door) && g.state.board.some(cell => cell?.id === prism), 'doors and prisms are untouched');
  equal(g.state.objective.kills - killsBefore, 2 + doomed.length, 'chain kills and club kills are credited to the player');
  equal(events.filter(event => event.type === 'kill' && event.text === 'club').length, doomed.length, 'one kill event per club victim');
  equal([troll.behavior.restTurns, troll.behavior.club, troll.intent.label], [1, undefined, 'Отдых'], 'after the strike the troll rests');
  dense(g, 'after the strike');

  const resting = await rest(g, 'rest turn');
  equal(clubSwings(resting).length + resting.filter(event => event.type === 'windup').length, 0, 'the rest phase neither strikes nor winds up');
  equal([troll.intent.label, troll.behavior.club?.raised], ['Замах дубиной', false], 'after the rest a new windup is announced');
  const again = await rest(g, 'second windup');
  equal(again.filter(event => event.type === 'windup').length, 1, 'the cycle repeats: windup');
  const strike = await rest(g, 'second strike');
  equal(clubSwings(strike).length, 1, 'the cycle repeats: strike');
}

// The cat standing in the zone at the strike takes the club; a chain that leaves the zone is safe.
async function catInZone() {
  const definition = level(['11Tt111', '11tt111', '1111111', '111@111', '1111111', '1111111']);
  const inside = start(definition);
  equal(sorted(trollOf(inside)!.intent.cells), sorted([at(2, 2), at(3, 2), at(4, 2), at(2, 3), at(3, 3), at(4, 3)]), 'the zone covers the cat');
  await rest(inside, 'windup');
  const hit = await commit(inside, [at(4, 4), at(4, 3)], 'cat ends in the zone');
  equal([hit.prediction.damageBySource.troll, clubDamage(hit.events)], [TROLL_CLUB_DAMAGE, TROLL_CLUB_DAMAGE], 'the club hits the cat in the zone');
  assert(hit.prediction.threats.includes(at(2, 0)), 'the troll is listed among the threats');

  const outside = start(definition);
  await rest(outside, 'windup');
  const safe = await commit(outside, [at(4, 4), at(5, 5)], 'cat leaves the zone');
  equal([safe.prediction.damageBySource.troll, clubDamage(safe.events)], [0, 0], 'the cat outside the zone is not hurt by the club');
  equal(clubSwings(safe.events).length, 1, 'the troll still spends its strike on a miss');
  equal(trollOf(outside)!.behavior.restTurns, 1, 'a missed strike is followed by a rest');

  // The zone is fixed at the windup: the cat walking away during the windup turn does not drag it along.
  const fixed = start(definition);
  const announced = sorted(trollOf(fixed)!.intent.cells);
  await commit(fixed, [at(4, 2), at(5, 1), at(6, 1)], 'cat walks aside during the windup');
  equal(sorted(trollOf(fixed)!.intent.cells), announced, 'the strike keeps the zone announced at the windup');
  const struck = await rest(fixed, 'strike on the old zone');
  equal([clubSwings(struck).map(event => sorted(event.indices!)), clubDamage(struck)], [[announced], 0], 'the club falls on the announced zone, away from the cat');
}

// Orthogonal only: dominant axis from the body's centre to the cat, vertical on a tie; the band covers the troll's front.
function geometry() {
  const cases: { rows: string[]; zone: [number, number][]; dir: [number, number]; label: string }[] = [
    { rows: ['11Tt111', '11tt111', '1111111', '1111111', '1111111', '111@111'], zone: [[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]], dir: [0, 1], label: 'straight below' },
    { rows: ['11Tt111', '11tt111', '1111111', '11111@1', '1111111', '1111111'], zone: [[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]], dir: [0, 1], label: 'a tie is vertical' },
    { rows: ['11Tt111', '11tt111', '1111111', '111111@', '1111111', '1111111'], zone: [[4, 0], [4, 1], [4, 2], [5, 0], [5, 1], [5, 2]], dir: [1, 0], label: 'horizontal right' },
    { rows: ['111Tt11', '@11tt11', '1111111', '1111111', '1111111', '1111111'], zone: [[2, 0], [2, 1], [2, 2], [1, 0], [1, 1], [1, 2]], dir: [-1, 0], label: 'horizontal left' },
    { rows: ['1111111', '@111111', '1111111', '1111111', '1111Tt1', '1111tt1'], zone: [[3, 3], [3, 4], [3, 5], [2, 3], [2, 4], [2, 5]], dir: [-1, 0], label: 'leftward from the bottom' },
    { rows: ['111S111', '1111111', '11111@1', '1111111', '1111111', '1111111'], zone: [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2]], dir: [0, 1], label: 'single-cell troll, tie is vertical' },
    { rows: ['S111111', '1111111', '1111111', '1@11111', '1111111', '1111111'], zone: [[0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], dir: [0, 1], label: 'the band stays on the board' },
    { rows: ['1111111', '1111111', '1@11111', '1111111', '11Tt111', '11tt111'], zone: [[1, 3], [2, 3], [3, 3], [1, 2], [2, 2], [3, 2]], dir: [0, -1], label: 'upward, leaning toward the cat' },
  ];
  for (const test of cases) {
    const g = start(level(test.rows));
    const troll = trollOf(g)!;
    equal(sorted(troll.intent.cells), sorted(test.zone.map(([x, y]) => at(x, y))), `${test.label}: zone`);
    equal([troll.behavior.club!.dx, troll.behavior.club!.dy], test.dir, `${test.label}: direction`);
    const xs = troll.intent.cells.map(index => index % COLS), ys = troll.intent.cells.map(index => Math.floor(index / COLS));
    assert(test.dir[0] ? new Set(xs).size === 2 && new Set(ys).size === 3 : new Set(xs).size === 3 && new Set(ys).size === 2, `${test.label}: a 3×2 band across the axis`);
  }
  // Walls are dropped from the band, and a club never reaches behind them onto another row.
  const walled = start(level(['11Tt111', '11tt111', '11#1111', '1111111', '1111111', '111@111']));
  assert(!trollOf(walled)!.intent.cells.includes(at(2, 2)) && trollOf(walled)!.intent.cells.length === 5, 'impassable terrain is not part of the zone');
}

// Frost on a wet troll: the strike is skipped and the cycle waits; the brittle troll takes double chain damage.
async function frost() {
  const definition = level(['11Tt111', '11tt111', '1111111', '111@111', '1111111', '1111111']);
  definition.terrain[at(3, 1)] = 'puddle';
  const g = start(definition);
  const troll = trollOf(g)!, anchor = at(2, 0);
  assert(troll.status.wet, 'a troll with a square on a puddle is wet');
  await rest(g, 'windup');
  assert(troll.behavior.club?.raised, 'the club is raised');
  const preview = g.previewFrost(anchor);
  assert(preview.valid && preview.freezes, `frost is valid on the wet troll: ${preview.reason}`);
  equal(sorted(preview.skippedCells), sorted(troll.intent.cells), 'frost preview lists the skipped club zone');
  assert(g.useFrost(anchor), 'frost applied');
  const frozen = await commit(g, [at(4, 4), at(4, 3)], 'frozen strike turn');
  equal([frozen.prediction.damageBySource.troll, clubSwings(frozen.events).length], [0, 0], 'the frozen troll skips its strike');
  assert(troll.behavior.club?.raised && troll.behavior.restTurns === 0, 'the cycle is paused, not lost');
  equal(troll.intent.label, 'Удар дубиной', 'after the thaw the strike is announced again with its zone');
  assert(troll.status.brittle, 'frost left the troll brittle');
  const body = bodyOf(g, troll.id), chain = g.availableMoves(6).find(path => body.includes(path.at(-1)!))!;
  assert(chain, 'a chain can reach the troll');
  const brittle = g.preview(chain);
  const hit = brittle.hits.at(-1);
  assert(brittle.valid && hit && hit.damage === 2 * hit.availablePower!, `a brittle troll takes double chain damage: ${JSON.stringify(hit)}`);
  const strike = await rest(g, 'thawed strike');
  equal(clubSwings(strike).length, 1, 'the delayed strike lands after the thaw');

  // Frost during the windup turn: the windup waits, so the strike comes one turn later.
  const early = start(definition);
  assert(early.useFrost(anchor), 'frost on the windup turn');
  const skipped = await rest(early, 'frozen windup');
  equal([skipped.filter(event => event.type === 'windup').length, trollOf(early)!.behavior.club?.raised], [0, false], 'a frozen troll does not wind up');
  equal((await rest(early, 'windup after thaw')).filter(event => event.type === 'windup').length, 1, 'the windup resumes after the thaw');
  equal(clubSwings(await rest(early, 'strike after thaw')).length, 1, 'then the strike');
}

// A boar cannot push the troll: the troll holds the row, takes the ram and does not regenerate that turn.
async function boar() {
  const g = start(level(['11K1111', '11Tt111', '11tt111', '1111111', '1111111', '11@1111']));
  const troll = trollOf(g)!, body = bodyOf(g, troll.id);
  const { prediction, events } = await commit(g, [at(1, 4), at(0, 5)], 'boar hits the troll');
  equal(bodyOf(g, troll.id), body, 'the troll does not move');
  assert(!prediction.enemyPhase!.knockedDown.includes(troll.id) && prediction.enemyPhase!.charges[0].stunned, 'the troll holds the row and stuns the boar');
  equal(troll.hp, TROLL_TEST_HP - BOAR_DAMAGE, 'the ram still hurts the troll');
  equal([prediction.enemyPhase!.regenerated, events.filter(event => event.type === 'regen').length], [[], 0], 'a ram counts as damage: no regeneration');
  const healed = await commit(g, [at(0, 4), at(0, 3)], 'quiet turn');
  equal(healed.prediction.enemyPhase!.regenerated, [{ id: troll.id, index: at(2, 1), amount: BOAR_DAMAGE }], 'regeneration is capped at max HP');
  equal(troll.hp, TROLL_TEST_HP, 'the troll is back to full HP');
  // A single-cell troll is just as heavy.
  const single = start(level(['11K1111', '11S1111', '1111111', '1111111', '1111111', '11@1111']));
  const small = trollOf(single)!;
  const rammed = await commit(single, [at(1, 4), at(0, 5)], 'boar hits a single-cell troll');
  equal([bodyOf(single, small.id), rammed.prediction.enemyPhase!.charges[0].stunned], [[at(2, 1)], true], 'a single-cell troll holds the row too');
}

// An open pit never swallows the troll; its square jams the trapdoor.
async function pits() {
  const g = start(level(['11Tt111', '11tt111', '1111111', '1111111', '11P1111', '111@111'], { P: { device: { kind: 'pits', targets: [at(3, 1), at(0, 0)] } } }));
  const troll = trollOf(g)!, body = bodyOf(g, troll.id), victim = idAt(g, at(0, 0))!;
  const { prediction } = await commit(g, [at(3, 4), at(2, 4), at(1, 5)], 'pit lever');
  equal([prediction.pitImmuneCells, prediction.pitCells], [[at(3, 1)], [at(0, 0)]], 'forecast: the troll square jams, the other opens');
  equal(bodyOf(g, troll.id), body, 'the troll stays on all four squares');
  assert(!g.state.board.some(cell => cell?.id === victim), 'the goblin on the open trapdoor fell');
  equal(g.state.pits.map(pit => pit.index), [at(0, 0)], 'only the free square is a pit');
  const single = start(level(['111S111', '1111111', '1111111', '1111111', '11P1111', '111@111'], { P: { device: { kind: 'pits', targets: [at(3, 0)] } } }));
  const small = trollOf(single)!.id;
  const jammed = await commit(single, [at(3, 4), at(2, 4), at(1, 5)], 'pit under a single-cell troll');
  equal([jammed.prediction.pitImmuneCells, idAt(single, at(3, 0))], [[at(3, 0)], small], 'a single-cell troll never falls');
}

// One entity in a chain: two of its squares cannot both be struck; one hit spends power once.
async function chainOnce() {
  const g = start(level(['1111111', '11Tt111', '11tt111', '1111111', '111@111', '1111111']));
  // Even a troll that dies at the first square leaves no second square to strike.
  const weak = start(level(['1111111', '11Tt111', '11tt111', '1111111', '111@111', '1111111'], {}, {}, 1));
  const twice = weak.preview([at(3, 3), at(3, 2), at(2, 2)]);
  assert(!twice.valid && twice.reason.includes('Одну сущность'), `the same troll cannot be struck twice through two squares: ${twice.reason}`);
  assert(!g.preview([at(3, 3), at(3, 2), at(2, 2)]).valid, 'a surviving troll cannot be passed through either');
  const { prediction } = await commit(g, [at(2, 3), at(3, 3), at(3, 2)], 'chain ends on the troll');
  const hits = prediction.hits.filter(hit => [at(2, 1), at(3, 1), at(2, 2), at(3, 2)].includes(hit.index));
  equal(hits.length, 1, 'the troll is hit once');
  // A struck entity is replaced by its simulated copy: read it from the board again.
  equal(trollOf(g)!.hp, TROLL_TEST_HP - hits[0].damage, 'the troll loses exactly one hit of HP');
  equal([hits[0].availablePower, hits[0].damage], [3, 3], 'the colourless troll takes the whole power once');
  equal(g.state.objective.bossHits, 1, 'one boss hit');
}

// Killing the troll: the whole body is removed, the cat steps onto the struck square, the squares refill;
// with a bossKills goal the kill is the victory.
async function kill() {
  const g = start(level(['1111111', '11Tt111', '11tt111', '1111111', '111@111', '1111111'], {}, {}, 3));
  const troll = trollOf(g)!;
  const { prediction } = await commit(g, [at(2, 3), at(3, 3), at(3, 2)], 'kill the troll');
  assert(prediction.hits.at(-1)!.killed, 'forecast: the troll dies');
  assert(!g.state.board.some(cell => cell?.id === troll.id), 'every square of the troll is cleared');
  equal(g.state.objective.bossKills, 1, 'the kill counts for bossKills');
  dense(g, 'after the troll dies');

  const goal = start(level(['1111111', '11Tt111', '11tt111', '1111111', '111@111', '1111111'], {}, { goals: [{ key: 'bossKills', target: 1 }] }, 3));
  const won = goal.preview([at(2, 3), at(3, 3), at(3, 2)]);
  assert(won.completesRoom, 'forecast: the troll kill wins');
  await commit(goal, [at(2, 3), at(3, 3), at(3, 2)], 'victory');
  equal([goal.state.phase, goal.state.objective.bossKills], ['WIN', 1], 'bossKills victory');

  // A lethal jump onto any square of the body removes the whole troll.
  const jump = start(level(['1111111', '11Tt111', '11tt111', '1111111', '111@111', '1111111'], {}, {}, 4));
  jump.state.player.energy = 2; // State setup: enough energy for one jump.
  const landing = jump.previewAbility('jump', at(3, 1));
  assert(landing.valid && landing.hits.length === 1 && landing.hits[0].killed, `jump kills the troll: ${landing.reason}`);
  assert(jump.setAbility('jump') && await jump.useAbility('jump', at(3, 1)), 'jump resolves');
  equal([jump.state.player.index, jump.state.board.some(cell => cell?.variant === 'troll')], [at(3, 1), false], 'the cat lands, the troll is gone');
  dense(jump, 'after the jump');
}

// Regeneration: +TROLL_REGEN at the end of a turn without damage; none after a hit or while burning.
async function regeneration() {
  const g = start(level(['1111111', '1111111', '1111111', '111111@', '11Tt111', '11tt111']));
  const trollId = trollOf(g)!.id;
  const hit = await commit(g, [at(5, 3), at(4, 3), at(3, 4)], 'hit the troll');
  const wound = hit.prediction.hits.at(-1)!.damage;
  equal([trollOf(g)!.hp, hit.prediction.enemyPhase!.regenerated], [TROLL_TEST_HP - wound, []], 'no regeneration in the turn it was hurt');
  const quiet = await commit(g, g.availableMoves(4).find(path => !path.some(index => g.state.board[index]?.id === trollId))!, 'quiet turn');
  equal(quiet.prediction.enemyPhase!.regenerated.map(entry => entry.amount), [Math.min(TROLL_REGEN, wound)], 'forecast: regeneration after a quiet turn');
  equal(trollOf(g)!.hp, Math.min(TROLL_TEST_HP, TROLL_TEST_HP - wound + TROLL_REGEN), 'the troll regenerates');

  const burning = start(level(['1111111', '1111111', '1111111', '111111@', '11Tt111', '11tt111']));
  await commit(burning, [at(5, 3), at(4, 3), at(3, 4)], 'wound');
  const scorched = trollOf(burning)!;
  assert(burning.useItem('fire', at(3, 4)), 'fire flask on the troll');
  let turns = 0;
  while (scorched.damageEffects?.burning && turns < 4) {
    const hp = scorched.hp;
    const quietPath = burning.availableMoves(4).find(path => !path.some(index => burning.state.board[index]?.id === scorched.id))!;
    const turn = await commit(burning, quietPath, `burning turn ${turns}`);
    equal(turn.events.filter(event => event.type === 'regen').length, 0, 'no regeneration while burning');
    assert(scorched.hp < hp, 'the burning tick hurts the troll');
    turns++;
  }
  assert(turns > 0 && !scorched.damageEffects?.burning, 'the fire burned out');
  const hp = scorched.hp;
  const after = await commit(burning, burning.availableMoves(4).find(path => !path.some(index => burning.state.board[index]?.id === scorched.id))!, 'after the fire');
  equal([after.events.filter(event => event.type === 'regen').length, scorched.hp], [1, Math.min(scorched.maxHp, hp + TROLL_REGEN)], 'regeneration resumes once the fire is out');

  // Poison is not burning, but its end-of-turn tick is damage: the forecast must foresee it (no regeneration).
  const poisoned = start(level(['1111111', '1111111', '1111111', '111111@', '11Tt111', '11tt111'], {}, { playerAttackEffect: 'poison' }));
  await commit(poisoned, [at(5, 3), at(4, 3), at(3, 4)], 'poisoned hit');
  const sick = trollOf(poisoned)!;
  assert(sick.damageEffects?.poison, 'the surviving troll is poisoned');
  const sickHp = sick.hp;
  const tick = await commit(poisoned, poisoned.availableMoves(4).find(path => !path.some(index => poisoned.state.board[index]?.id === sick.id))!, 'poison tick turn');
  equal([tick.prediction.enemyPhase!.regenerated, tick.events.filter(event => event.type === 'regen').length], [[], 0], 'a poison tick blocks regeneration, in the forecast too');
  assert(sick.hp < sickHp, 'the poison tick hurt the troll');
}

// Arrivals and summons never replace the troll; the beacon picks ordinary goblins only.
async function arrivals() {
  const g = start(level(['111111B', '11Tt111', '11tt111', '1111111', '111@111', '1111111']));
  const troll = trollOf(g)!, body = bodyOf(g, troll.id);
  let announced = 0;
  for (let turn = 0; turn < 4; turn++) {
    await rest(g, `beacon turn ${turn}`);
    const beacon = g.state.board.find(cell => cell?.variant === 'beacon')!;
    announced += beacon.intent.summonCells?.length ?? 0;
    assert(!(beacon.intent.summonCells ?? []).some(index => body.includes(index)), 'the beacon never announces a troll square');
    equal(bodyOf(g, troll.id), body, 'the troll keeps its body');
  }
  assert(announced > 0, 'the beacon did announce summons');
}

function validation() {
  const base = level(['11Tt111', '11tt111', '1111111', '111@111', '1111111', '1111111']);
  assert(validateCustomLevel(base).valid, 'a 2×2 troll is valid');
  assert(validateCustomLevel(level(['111S111', '1111111', '1111111', '111@111', '1111111', '1111111'])).valid, 'a single-cell troll is valid');
  const bar = structuredClone(base); bar.enemies.find(enemy => enemy.variant === 'troll')!.footprint = [at(2, 0), at(3, 0), at(4, 0), at(5, 0)];
  bar.enemies = bar.enemies.filter(enemy => enemy.variant === 'troll' || ![at(4, 0), at(5, 0)].includes(enemy.index));
  assert(!validateCustomLevel(bar).valid, 'a 1×4 troll is rejected');
  const coloured = structuredClone(base); coloured.enemies.find(enemy => enemy.variant === 'troll')!.color = 1;
  assert(!validateCustomLevel(coloured).valid, 'the troll is colourless');
  const melee = structuredClone(base); melee.enemies.find(enemy => enemy.variant === 'troll')!.kind = 'melee';
  assert(!validateCustomLevel(melee).valid, 'the troll is a boss variant');
  const bigJailer = structuredClone(base); bigJailer.enemies.find(enemy => enemy.variant === 'troll')!.variant = 'jailer';
  assert(!validateCustomLevel(bigJailer).valid, 'other bosses stay single-cell');
}

// Seeded replay with rests, frost and chains; extra previews change nothing.
async function determinism() {
  const definition = level(['11Tt111', '11tt111', '1111111', '111@111', '1111111', '1111111']);
  definition.terrain[at(3, 1)] = 'puddle';
  for (const seed of [4242, 77, 901]) {
    const a = start(definition, seed), b = start(definition, seed);
    for (let turn = 0; turn < 7 && a.state.phase === 'PLAYER_INPUT'; turn++) {
      if (turn === 1) { assert(a.useFrost(at(2, 0)) && b.useFrost(at(2, 0)), 'frost on both twins'); }
      if (turn === 3) { await rest(a, 'rest a'); await rest(b, 'rest b'); }
      else {
        const path = a.availableMoves(6)[0];
        for (let n = 0; n < 3; n++) a.preview(path);
        await commit(a, path, `replay seed ${seed} turn ${turn}`);
        await commit(b, path, `replay seed ${seed} turn ${turn} (twin)`);
      }
      equal(JSON.stringify(a.state), JSON.stringify(b.state), `seed ${seed} turn ${turn}: identical replay`);
    }
  }
}

// A restart from a troll event, or during its animation, stops the stale turn.
async function cancellation() {
  const definition = level(['11Tt111', '11tt111', '11H1111', '111@111', '1111111', '1111111']);
  const entry = start(definition);
  const entryState = JSON.stringify(entry.state);
  for (const boundary of ['windup', 'attack', 'hit', 'kill', 'regen'] as const) {
    const g = start(definition);
    let restarted = false; const trace: string[] = [];
    const off = g.subscribe((_state, event) => {
      trace.push(event.type);
      const troll = event.type === 'windup' || event.type === 'regen' || event.text === 'club';
      if (!restarted && troll && event.type === boundary) { restarted = true; g.restartLevel(); }
    });
    let cancelled = false;
    for (let turn = 0; turn < 5 && !restarted; turn++) {
      // Turn 0 wounds the troll, so the quiet turn after its strike regenerates it; later turns rest.
      let result: boolean;
      if (turn === 0) {
        assert(g.beginChain(at(4, 3)) && g.extendChain(at(4, 2)) && g.extendChain(at(3, 1)), `${boundary}: chain onto the troll`);
        result = await g.releaseChain();
      } else result = await g.waitTurn();
      if (restarted) cancelled = !result;
    }
    off();
    assert(restarted, `${boundary}: the troll event happened`);
    assert(cancelled, `${boundary}: the stale turn reports cancellation`);
    equal(trace.at(-1), 'start', `${boundary}: nothing of the old turn runs after the restart`);
    equal(JSON.stringify(g.state), entryState, `${boundary}: the restart restores the entry`);
  }
  const slow = start(definition); slow.animationScale = 0.05;
  await slow.waitTurn();
  let later = false;
  slow.subscribe((_state, event) => { if (event.type === 'attack' && event.text === 'club' && !later) { later = true; setTimeout(() => slow.restartLevel(), 0); } });
  equal(await slow.waitTurn(), false, 'a restart during the club animation cancels the turn');
  equal([slow.state.turn, slow.state.objective.kills], [0, 0], 'no stale club kills after the restart');
}

async function main() {
  await cycle();
  await catInZone();
  geometry();
  await frost();
  await boar();
  await pits();
  await chainOnce();
  await kill();
  await regeneration();
  await arrivals();
  validation();
  await determinism();
  await cancellation();
  console.log('PASS troll: windup → strike → rest, club on enemies with credited kills, doors and prisms spared, cat in/out of the zone, orthogonal zone and tie rule, walls, frost pause and brittleness, boar holds, pit jams, chain hits once, kill/jump/refill/bossKills victory, regeneration with cap, damage and burning, beacon never targets the troll, validation, forecast = execution (damageBySource.troll, club deaths, regeneration), seeded replay, cancellation');
}
main().catch(error => { console.error(error); throw error; });
