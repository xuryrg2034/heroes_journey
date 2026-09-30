// Forest wolf (pack), porcupine (quills) and shaman (rites). Every scenario is played through real engine
// commands (preview → begin/extend/release chain, rest, frost, jump/spin, restart); the forecast must equal execution.
import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomEnemy, type CustomLevelDefinition } from './customLevel';
import { authoredLesson } from './lessonBuilder';
import { PORCUPINE_SPIKE_DAMAGE, SHAMAN_STURDY_HP, WOLF_DAMAGE } from './forestBeasts';
import type { ChainPreview, EngineEvent, TerrainKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const COLS = 5;
const at = (x: number, y: number) => y * COLS + x;
type Tile = { enemy?: Omit<CustomEnemy, 'index'>; terrain?: TerrainKind };
/**
 * `#` wall, `@` cat, digits: weak (0 HP) goblins of that color. `W` wolf (green), `w` wolf (red), `P` weak porcupine
 * (green), `Q` porcupine with 5 HP (green), `S` shaman (red, 2 HP). Other symbols come from `legend`.
 */
function level(rows: string[], legend: Record<string, Tile> = {}, extra: Partial<CustomLevelDefinition> = {}): CustomLevelDefinition {
  const tiles: Record<string, Tile> = {
    W: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'wolf' } }, w: { enemy: { kind: 'melee', color: 0, hp: 0, variant: 'wolf' } },
    P: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'porcupine' } }, Q: { enemy: { kind: 'melee', color: 1, hp: 5, variant: 'porcupine' } },
    S: { enemy: { kind: 'melee', color: 0, hp: 2, variant: 'shaman' } }, ...legend,
  };
  const terrain: TerrainKind[] = [], enemies: CustomEnemy[] = [];
  let heroIndex = -1;
  rows.join('').split('').forEach((symbol, index) => {
    const tile = /\d/.test(symbol) ? { enemy: { kind: 'melee' as const, color: Number(symbol) as 0, hp: 0 } } : tiles[symbol] ?? {};
    terrain.push(symbol === '#' ? 'wall' : tile.terrain ?? 'floor');
    if (symbol === '@') heroIndex = index;
    if (tile.enemy) enemies.push({ index, ...tile.enemy });
  });
  return { version: 1, name: 'Beast fixture', seed: 4242, cols: COLS, rows: rows.length, terrain, heroIndex, enemies, doors: [],
    goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [],
    inventory: { frost: 3, bomb: 0, healing: 0, fire: 0 }, playerHp: 20, ...extra };
}
function start(definition: CustomLevelDefinition, seed?: number) {
  const g = new ForestEngine(); g.animationScale = 0;
  assert(g.startCustomLevel(seed === undefined ? definition : { ...definition, seed }), 'fixture level starts');
  return g;
}
const idAt = (g: ForestEngine, index: number) => g.state.board[index]?.id;
const cellById = (g: ForestEngine, id: number) => g.state.board.find(cell => cell?.id === id) ?? null;
function record(g: ForestEngine) {
  const events: EngineEvent[] = [];
  const off = g.subscribe((_state, event) => { events.push(event); });
  return { events, off };
}

/** Real input with the forecast contract: pure preview, same damage, death and final cat cell. */
async function commit(g: ForestEngine, path: number[], label: string): Promise<ChainPreview> {
  const before = JSON.stringify(g.state), snapshot = g.captureAnalysisSnapshot();
  const prediction = g.preview(path);
  equal(JSON.stringify(g.state), before, `${label}: preview does not change the state`);
  const after = g.captureAnalysisSnapshot();
  equal([after.rng, after.nextId], [snapshot.rng, snapshot.nextId], `${label}: preview spends no RNG and no IDs`);
  assert(prediction.valid, `${label}: ${prediction.reason}`);
  assert(g.beginChain(path[0]), `${label}: chain starts`);
  for (const step of path.slice(1)) assert(g.extendChain(step), `${label}: chain reaches ${step}`);
  assert(await g.releaseChain(), `${label}: chain resolves`);
  equal(g.state.lastDamage, prediction.damage, `${label}: incoming damage equals the forecast`);
  equal(g.state.phase === 'LOSE', !!prediction.playerDies, `${label}: death equals the forecast`);
  return prediction;
}

// A wolf with a living wolf beside it is armed and angry; a lone wolf is passive even next to the cat.
async function packArming() {
  const g = start(level(['00000', '0WW00', '00@00', '00W00', '00000']));
  const pack = g.state.board[at(2, 1)]!, mate = g.state.board[at(1, 1)]!, lone = g.state.board[at(2, 3)]!;
  assert(pack.behavior.aggressive && pack.intent.cells.includes(at(2, 2)) && pack.intent.damage === WOLF_DAMAGE, 'a pack wolf announces a strike on the cat');
  assert(mate.behavior.aggressive && !mate.intent.cells.includes(at(2, 2)), 'its packmate is armed too, the cat is outside its sides');
  assert(!lone.behavior.aggressive && !lone.intent.cells.length, 'a lone wolf beside the cat is passive');
  assert(await g.waitTurn(), 'rest resolves');
  equal([g.state.lastDamage, g.state.player.hp], [WOLF_DAMAGE, 20 - WOLF_DAMAGE], 'only the pack wolf strikes');
  assert(pack.behavior.restTurns === 1 && !pack.intent.cells.length, 'after its strike the wolf rests one turn');
  assert(await g.waitTurn(), 'second rest resolves');
  const rested = g.state.board[at(2, 1)]!; // re-read: assertions above narrowed the fields
  assert(rested === pack && rested.behavior.restTurns === 0 && rested.behavior.aggressive && rested.intent.cells.includes(at(2, 2)), 'the rested pack wolf is armed again');
}

// Killing the neighbour with the chain breaks the pack before the enemy phase: the announced strike is cancelled.
async function packBroken() {
  // w(0,3) also loses its packmate W(1,2), but its strike never reached the cat: it is not listed.
  const rows = ['00000', '0Ww00', '0W@00', 'w0000', '00000'];
  const g = start(level(rows));
  const striker = g.state.board[at(2, 1)]!, bystander = g.state.board[at(0, 3)]!;
  assert(bystander.behavior.aggressive && !bystander.intent.cells.includes(at(1, 1)), 'the second pack wolf is armed, the chain end is outside its sides');
  assert(striker.intent.cells.includes(at(1, 1)), 'the red wolf announces its sides, including its packmate cell');
  const broken = await commit(g, [at(1, 2), at(1, 1)], 'pack broken');
  equal(broken.damage, 0, 'forecast: no strike once the neighbour is dead');
  equal(broken.enemyPhase!.packBroken, [striker.id], 'forecast names only the disarmed wolf whose strike would have hit the cat');
  assert(!bystander.behavior.aggressive, 'the bystander lost its pack too');
  assert(g.state.player.index === at(1, 1) && g.state.player.hp === 20, 'execution: the cat stands on the announced cell unhurt');
  assert(!striker.behavior.aggressive && !striker.intent.cells.length && striker.intent.label === 'Одинок', 'the lone survivor stays passive');

  // Control: a second packmate keeps the pack alive, the same chain end takes the strike.
  const control = start(level(['00000', '0Www0', '0W@00', '00000', '00000']));
  const held = await commit(control, [at(1, 2), at(1, 1)], 'pack holds');
  equal([held.damage, held.enemyPhase!.packBroken], [WOLF_DAMAGE, []], 'forecast: the pack still strikes');
  equal(control.state.player.hp, 20 - WOLF_DAMAGE, 'execution: the strike lands');

  // A lesson porcupine without `armed` is passive, but its quills work: the label says so.
  const lessonQuills = start(level(['00000', '00P00', '00@00', '00000', '00000']));
  lessonQuills.state.board[at(2, 1)]!.behavior.passive = true; // state setup: lessons mark unarmed enemies passive
  assert(await lessonQuills.waitTurn(), 'rest');
  equal(lessonQuills.state.board[at(2, 1)]!.intent.label, 'Иглы', 'a passive porcupine still shows its quills');

  // Frost switches the wolf off: a frozen pack wolf does not strike.
  const cold = start(level(['00000', '0WF00', '00@00', '00000', '00000'], { F: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'wolf' }, terrain: 'puddle' } }));
  assert(cold.state.board[at(2, 1)]!.intent.cells.includes(at(2, 2)), 'the wet wolf announces a strike');
  assert(cold.prepareFrost(at(2, 1)) && await cold.waitTurn(), 'frost then rest');
  equal(cold.state.player.hp, 20, 'a frozen wolf skips its strike');
}

// Quills: every ordinary chain hit on a porcupine wounds the cat at that hit; the chain goes on by the usual rules.
async function quills() {
  const rows = ['00000', '00000', '00000', '01P10', '00@00'];
  const g = start(level(rows));
  const porcupine = idAt(g, at(2, 3))!, after = idAt(g, at(3, 3))!;
  const { events, off } = record(g);
  const prediction = await commit(g, [at(1, 3), at(2, 3), at(3, 3)], 'quills');
  off();
  equal([prediction.spikeDamage, prediction.damage, prediction.hits.map(hit => hit.spikeDamage ?? 0)], [PORCUPINE_SPIKE_DAMAGE, PORCUPINE_SPIKE_DAMAGE, [0, PORCUPINE_SPIKE_DAMAGE, 0]], 'forecast: one quill hit at the porcupine');
  equal(g.state.player.hp, 20 - PORCUPINE_SPIKE_DAMAGE, 'execution: the cat is wounded once');
  assert(!cellById(g, porcupine) && !cellById(g, after), 'the chain went on past the porcupine');
  const quill = events.findIndex(event => event.type === 'damage' && event.text === 'quills');
  const porcupineHit = events.findIndex(event => event.type === 'hit' && event.index === at(2, 3)), nextHit = events.findIndex(event => event.type === 'hit' && event.index === at(3, 3));
  assert(porcupineHit >= 0 && porcupineHit < quill && quill < nextHit, 'the quills strike at the porcupine hit, before the next hit');

  // A surviving last target still fires; frost switches the quills off.
  const sturdy = start(level(['00000', '00000', '00000', '01Q00', '00@00']));
  const survivor = await commit(sturdy, [at(1, 3), at(2, 3)], 'surviving porcupine');
  assert(survivor.endsOnSurvivor && survivor.spikeDamage === PORCUPINE_SPIKE_DAMAGE && sturdy.state.player.hp === 20 - PORCUPINE_SPIKE_DAMAGE, 'a wounded porcupine still fires');
  const cold = start(level(['00000', '00000', '00000', '01F10', '00@00'], { F: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'porcupine' }, terrain: 'puddle' } }));
  assert(cold.prepareFrost(at(2, 3)), 'frost reaches the wet porcupine');
  const frozen = await commit(cold, [at(1, 3), at(2, 3), at(3, 3)], 'frozen porcupine');
  assert(!frozen.spikeDamage && cold.state.player.hp === 20, 'a frozen porcupine has no quills');
}

// Only chain hits trigger quills: jump, spin, the boar ram and arrows do not.
async function quillSources() {
  const g = start(level(['00000', '00000', '00000', '0PPP0', '00@00']));
  g.state.player.energy = 3; // resource setup: the fixture has no tool restrictions
  const spin = g.previewAbility('spin');
  assert(spin.valid && !spin.spikeDamage && spin.damage === 0, 'spin forecast: no quills');
  assert(await g.useAbility('spin') && g.state.player.hp === 20, 'spin through three porcupines costs no HP');
  const jumper = start(level(['00000', '00000', '00000', '01P10', '00@00']));
  jumper.state.player.energy = 2;
  assert(jumper.previewAbility('jump', at(2, 3)).valid && await jumper.useAbility('jump', at(2, 3)) && jumper.state.player.hp === 20, 'landing on a porcupine costs no HP');

  const enemyPhase = start(level(['K0A00', 'P0000', '00P00', '00000', '1@000'], {
    K: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' } }, A: { enemy: { kind: 'ranged', color: 1, hp: 3 } },
  }, { spikedEdges: ['bottom'] }));
  const archer = enemyPhase.state.board[at(2, 0)]!;
  assert(archer.intent.cells.includes(at(2, 2)), 'the archer line crosses a porcupine');
  const prediction = await commit(enemyPhase, [at(2, 4), at(3, 4)], 'ram and arrows on porcupines');
  assert(prediction.enemyPhase!.deaths.some(death => death.cause === 'ram' && death.index === at(0, 1)) && prediction.enemyPhase!.deaths.some(death => death.cause === 'arrow' && death.index === at(2, 2)), 'the ram and an arrow reach porcupines');
  equal([prediction.spikeDamage, enemyPhase.state.player.hp], [undefined, 20 - prediction.damage], 'no quills from the enemy phase');
}

// A lethal quill ends the chain at once: defeat before the goal, later cells are never struck.
async function lethalQuills() {
  const rows = ['00000', '00000', '00000', '01P10', '00@00'];
  const g = start(level(rows, {}, { playerHp: 1, goals: [{ key: 'kills', target: 2 }] }));
  const last = idAt(g, at(3, 3))!;
  const prediction = await commit(g, [at(1, 3), at(2, 3), at(3, 3)], 'lethal quills');
  assert(prediction.playerDies && !prediction.completesRoom, 'forecast: the cat dies, the goal-completing hit is not a victory');
  equal([g.state.phase, g.state.player.hp], ['LOSE', 0], 'execution: defeat');
  assert(cellById(g, last), 'the cell after the porcupine is not struck');
  const direct = start(level(rows, {}, { playerHp: 1, goals: [{ key: 'kills', target: 2 }] }));
  const shortPath = await commit(direct, [at(1, 3), at(2, 3)], 'goal on the porcupine hit');
  assert(shortPath.playerDies && direct.state.phase === 'LOSE', 'death at the porcupine wins over the goal completed by the same hit');
}

// Shaman: announced rite every second active phase; weak → armed (angry at once), armed → sturdy.
async function shamanLadder() {
  const rows = ['11111', '11S11', '10@11', '11111', '11111'];
  const g = start(level(rows));
  const shaman = g.state.board[at(2, 1)]!;
  assert(!shaman.intent.empowerIds, 'no rite announced at the start');
  assert(await g.waitTurn(), 'turn 1');
  const ids = [...shaman.intent.empowerIds!];
  equal([ids, shaman.intent.empowerCells], [[idAt(g, at(1, 0)), idAt(g, at(2, 0))], [at(1, 0), at(2, 0)]], 'two neighbouring goblins announced in board order');
  const targets = ids.map(id => cellById(g, id)!);
  assert(targets.every(cell => !cell.behavior.aggressive && cell.maxHp === 0), 'both are weak before the rite');
  const { events, off } = record(g);
  assert(await g.waitTurn(), 'turn 2: rite');
  off();
  equal(events.filter(event => event.type === 'empower').map(event => [event.index, event.text]), [[at(1, 0), 'armed'], [at(2, 0), 'armed']], 'rite events');
  assert(targets.every(cell => cell.behavior.aggressive && cell.intent.label === 'Замах'), 'weak goblins are armed and angry at once');
  assert(!shaman.intent.empowerIds, 'no rite on the next turn');
  assert(await g.waitTurn(), 'turn 3');
  equal(shaman.intent.empowerIds, ids, 'the next rite targets the same armed goblins');
  assert(await g.waitTurn(), 'turn 4: second rite');
  assert(targets.every(cell => cell.hp === SHAMAN_STURDY_HP && cell.maxHp === SHAMAN_STURDY_HP && cell.behavior.aggressive), 'armed goblins become sturdy');
  assert(await g.waitTurn() && await g.waitTurn(), 'turns 5–6');
  const later: number[] = g.state.board[at(2, 1)]!.intent.empowerIds ?? [];
  assert(!later.some(id => ids.includes(id)), 'sturdy is the top step: they are not targeted again');

  // Both announced goblins strike the cat in the rite phase and calm down: their step is persistent, so the forecast
  // equals execution; both are angry again after their rest (the aggression queue would arm only one per turn);
  // and the ladder still reaches sturdy.
  const fighters = start(level(['#####', '#Sa##', '#a0##', '##0##', '##@##'], { a: { enemy: { kind: 'melee', color: 0, hp: 0, aggressive: true } } }));
  const brawlers = [fighters.state.board[at(2, 1)]!, fighters.state.board[at(1, 2)]!];
  assert(await fighters.waitTurn(), 'announcement turn');
  equal(fighters.state.board[at(1, 1)]!.intent.empowerIds, brawlers.map(cell => cell.id), 'both angry goblins are announced');
  let log = record(fighters);
  const struck = await commit(fighters, [at(2, 3), at(2, 2)], 'announced goblins strike');
  log.off();
  equal([struck.damageBySource.melee, fighters.state.player.hp], [2, 18], 'both announced goblins strike the cat in the rite phase');
  equal(struck.enemyPhase!.empowered.map(entry => entry.tier), ['armed', 'armed'], 'forecast: weak → armed');
  equal(log.events.filter(event => event.type === 'empower').map(event => event.text), ['armed', 'armed'], 'execution: the same steps');
  assert(brawlers.every(cell => cell.behavior.tier === 'armed' && cell.behavior.restTurns === 1), 'armed and resting after the strike');
  assert(await fighters.waitTurn(), 'rest turn');
  assert(brawlers.every(cell => cell.behavior.restTurns === 0 && cell.behavior.aggressive && cell.intent.label === 'Замах'), 'after the rest both armed goblins are angry again');
  log = record(fighters);
  assert(await fighters.waitTurn(), 'second rite turn');
  log.off();
  equal(log.events.filter(event => event.type === 'empower').map(event => event.text), ['sturdy', 'sturdy'], 'the fighting goblins become sturdy');
  assert(brawlers.every(cell => cell.hp === SHAMAN_STURDY_HP && cell.maxHp === SHAMAN_STURDY_HP && cell.behavior.tier === 'sturdy'), 'sturdy HP');
  // Past the top step there are no rites left: a strike outside a rite phase is followed by re-arming after the rest.
  const hits: number[] = []; fighters.subscribe((state, event) => { if (event.type === 'damage' && event.from !== undefined && brawlers.includes(state.board[event.from]!)) hits.push(state.turn); });
  for (let turn = 0; turn < 3; turn++) assert(await fighters.waitTurn(), `after the ladder, turn ${turn}`);
  assert(hits.join() === '6,6' && brawlers.every(cell => cell.behavior.restTurns === 0 && cell.behavior.aggressive && cell.intent.label === 'Замах'), `both sturdy goblins struck and are angry again after the rest: ${hits}`);

  // Two shamans, one goblin between them: one step per phase, the second shaman announces no duplicate.
  const pair = start(level(['#S1S#', '#####', '00000', '00@00', '00000']));
  const shared = pair.state.board[at(2, 0)]!;
  assert(await pair.waitTurn(), 'announcement turn');
  equal([pair.state.board[at(1, 0)]!.intent.empowerIds, pair.state.board[at(3, 0)]!.intent.empowerIds], [[shared.id], []], 'only the first shaman announces the shared goblin');
  log = record(pair);
  const once = await commit(pair, [at(1, 2), at(0, 2)], 'two shamans');
  log.off();
  equal(once.enemyPhase!.empowered.map(entry => [entry.id, entry.tier]), [[shared.id, 'armed']], 'forecast: one step');
  equal(log.events.filter(event => event.type === 'empower').map(event => event.text), ['armed'], 'execution: one step');
  equal([shared.behavior.tier, shared.maxHp], ['armed', 0], 'the shared goblin is armed, not sturdy');

  // Only ordinary goblins: wolf, porcupine, boar, a weak shield bearer (a 0-HP variant, in place of the removed castle stool) and a sturdy goblin are never announced.
  const picky = start(level(['WPK00', 'TSH00', '00000', '00000', '00@00'], {
    K: { enemy: { kind: 'melee', color: 1, hp: 3, variant: 'boar' } }, T: { enemy: { kind: 'melee', color: 1, hp: 0, variant: 'sentinel' } },
    H: { enemy: { kind: 'melee', color: 1, hp: 3 } },
  }));
  assert(await picky.waitTurn(), 'rest');
  const rite = picky.state.board[at(1, 1)]!.intent;
  equal(rite.empowerCells, [at(0, 2), at(1, 2)], 'only the weak goblins below the shaman are announced');
}

// The rite is cancelled by the shaman's death, by the target's death, and by frost; forecast = execution.
async function shamanCancel() {
  const rows = ['11111', '11F11', '10@11', '11111', '11111'];
  const legend = { F: { enemy: { kind: 'melee' as const, color: 0 as const, hp: 2, variant: 'shaman' as const }, terrain: 'puddle' as const } };
  const announced = async () => { const g = start(level(rows, legend)); assert(await g.waitTurn(), 'announcement turn'); return g; };
  const rites = (events: EngineEvent[]) => events.filter(event => event.type === 'empower').map(event => [event.index, event.text]);

  const control = await announced();
  const ids = [...control.state.board[at(2, 1)]!.intent.empowerIds!];
  let log = record(control);
  const plain = await commit(control, [at(3, 2), at(3, 3)], 'rite control');
  log.off();
  equal(plain.enemyPhase!.empowered.map(entry => [entry.id, entry.tier]), ids.map(id => [id, 'armed']), 'forecast lists both rites');
  equal(rites(log.events), [[at(1, 0), 'armed'], [at(2, 0), 'armed']], 'execution performs them');

  const killed = await announced();
  log = record(killed);
  const noSource = await commit(killed, [at(1, 2), at(2, 1)], 'shaman killed');
  log.off();
  equal([noSource.enemyPhase!.empowered, rites(log.events)], [[], []], 'the dead shaman performs no rite');

  const victim = await announced();
  const survivor = victim.state.board[at(2, 1)]!.intent.empowerIds![1];
  log = record(victim);
  const oneLeft = await commit(victim, [at(1, 1), at(1, 0)], 'target killed');
  log.off();
  equal(oneLeft.enemyPhase!.empowered.map(entry => entry.id), [survivor], 'forecast: only the surviving target is raised');
  equal(rites(log.events), [[victim.state.board.findIndex(cell => cell?.id === survivor), 'armed']], 'execution: the dead target is skipped, never retargeted');

  const cold = await announced();
  const shaman = cold.state.board[at(2, 1)]!;
  assert(cold.prepareFrost(at(2, 1)), 'frost reaches the wet shaman');
  log = record(cold);
  const frozen = await commit(cold, [at(3, 2), at(3, 3)], 'frozen shaman');
  log.off();
  equal([frozen.enemyPhase!.empowered, rites(log.events)], [[], []], 'a frozen shaman performs no rite');
  assert(shaman.intent.empowerIds?.length === 2, 'after the thaw the rite is announced again');

  // An arrow that kills the shaman during the attacks cancels its rite (the rite follows the attacks).
  const shot = start(level(['11F11', '11s11', '11111', '11@11', '11111'], {
    F: { enemy: { kind: 'ranged', color: 1, hp: 3 }, terrain: 'puddle' }, s: { enemy: { kind: 'melee', color: 0, hp: 1, variant: 'shaman' } },
  }));
  const target = shot.state.board[at(2, 1)]!;
  assert(shot.prepareFrost(at(2, 0)) && await shot.waitTurn(), 'the frozen archer waits while the rite is announced');
  assert(target.intent.empowerIds?.length === 2 && shot.state.board[at(2, 0)]!.intent.cells.includes(at(2, 1)), 'rite announced; the archer line crosses the shaman');
  log = record(shot);
  const arrow = await commit(shot, [at(1, 4), at(0, 4)], 'shaman shot');
  log.off();
  assert(arrow.enemyPhase!.deaths.some(death => death.id === target.id && death.cause === 'arrow'), 'forecast: the arrow kills the shaman');
  equal([arrow.enemyPhase!.empowered, rites(log.events)], [[], []], 'a shaman killed during the attacks performs no rite');

  // A lesson goblin without a weapon is passive; the shaman's arming removes the passivity.
  const lesson = await announced();
  const passiveId = lesson.state.board[at(2, 1)]!.intent.empowerIds![0];
  cellById(lesson, passiveId)!.behavior.passive = true; // state setup: lessons mark unarmed goblins passive
  assert(await lesson.waitTurn(), 'rite turn');
  const armed = cellById(lesson, passiveId)!;
  assert(!armed.behavior.passive && armed.behavior.aggressive && armed.intent.label === 'Замах', 'the armed goblin is no longer passive');
}

// Seeded replay with all three enemies, preview purity, and cancellation of a stale turn at the new events.
async function determinism() {
  const definition = level(['1S100', '0WW1P', '01@10', '1P010', '00101']);
  const seen = { rites: 0, quills: 0, wolf: 0 };
  for (const seed of [4242, 77, 901]) {
    const a = start(definition, seed), b = start(definition, seed);
    a.subscribe((state, event) => {
      if (event.type === 'empower') seen.rites++;
      if (event.type === 'damage' && event.text === 'quills') seen.quills++;
      if (event.type === 'damage' && event.from !== undefined && state.board[event.from]?.variant === 'wolf') seen.wolf++;
    });
    for (let turn = 0; turn < 6 && a.state.phase === 'PLAYER_INPUT'; turn++) {
      if (turn < 2 || turn === 4) {
        // Rests let the pack strike and the announced rite resolve without the chain removing its actors.
        assert(await a.waitTurn() && await b.waitTurn(), `seed ${seed} turn ${turn}: rest`);
        equal(JSON.stringify(a.state), JSON.stringify(b.state), `seed ${seed} turn ${turn}: identical replay after rest`);
        continue;
      }
      const path = a.availableMoves(6)[0];
      assert(path, `seed ${seed} turn ${turn}: a move exists`);
      for (let n = 0; n < 3; n++) a.preview(path); // extra previews must not change the outcome
      await commit(a, path, `replay seed ${seed} turn ${turn}`);
      await commit(b, path, `replay seed ${seed} turn ${turn} (twin)`);
      equal(JSON.stringify(a.state), JSON.stringify(b.state), `seed ${seed} turn ${turn}: identical replay`);
    }
  }
  assert(seen.rites > 0 && seen.quills > 0 && seen.wolf > 0, `the replay exercises rites, quills and wolf strikes: ${JSON.stringify(seen)}`);

  const rows = ['11111', '11S11', '10@11', '01P11', '11111'];
  for (const boundary of ['quills', 'empower'] as const) {
    const g = start(level(rows));
    assert(await g.waitTurn(), 'announcement turn');
    const entry = JSON.stringify(g.state);
    g.restartLevel();
    assert(await g.waitTurn(), 'announcement turn again');
    equal(JSON.stringify(g.state), entry, `${boundary}: rest after restart replays identically`);
    let restarted = false; const trace: string[] = [];
    const off = g.subscribe((_state, event) => {
      trace.push(event.type);
      if (!restarted && (boundary === 'quills' ? event.text === 'quills' : event.type === 'empower')) { restarted = true; g.restartLevel(); }
    });
    const path = [at(3, 2), at(2, 3), at(3, 3)];
    assert(g.beginChain(path[0]) && g.extendChain(path[1]) && g.extendChain(path[2]), 'chain prepared');
    equal(await g.releaseChain(), false, `${boundary}: the stale turn reports cancellation`);
    off();
    assert(restarted && trace.at(-1) === 'start', `${boundary}: nothing of the old turn runs after the restart`);
    equal([g.state.turn, g.state.phase, g.state.player.hp], [0, 'PLAYER_INPUT', 20], `${boundary}: the restart restores the entry`);
    assert(!g.state.board[at(2, 1)]!.intent.empowerIds && g.state.board[at(1, 0)]!.maxHp === 0, `${boundary}: no rite survives the restart`);
  }
  const slow = start(level(rows));
  assert(await slow.waitTurn(), 'announcement turn');
  slow.animationScale = 0.05; let later = false;
  slow.subscribe((_state, event) => { if (event.type === 'empower' && !later) { later = true; setTimeout(() => slow.restartLevel(), 0); } });
  assert(slow.beginChain(at(3, 2)) && slow.extendChain(at(3, 3)), 'slow chain prepared');
  equal(await slow.releaseChain(), false, 'a restart during the rite animation cancels the turn');
  equal([slow.state.turn, slow.state.objective.kills], [0, 0], 'no stale progress after the restart');
}

function validation() {
  const base = level(['1W1W0', 'WS10P', '01@10', '1P010', '00101']);
  assert(validateCustomLevel(base).valid, 'wolf, porcupine and shaman are accepted');
  const json = validateCustomLevel(JSON.parse(JSON.stringify(base)));
  equal(json.definition!.enemies.filter(enemy => enemy.variant).map(enemy => enemy.variant).sort(), ['porcupine', 'porcupine', 'shaman', 'wolf', 'wolf', 'wolf'], 'JSON round trip keeps the variants');
  for (const variant of ['wolf', 'porcupine', 'shaman'] as const) {
    const ranged = structuredClone(base); ranged.enemies.find(enemy => enemy.variant === variant)!.kind = 'ranged';
    assert(!validateCustomLevel(ranged).valid, `${variant} is a melee variant`);
    const big = structuredClone(base); const enemy = big.enemies.find(entry => entry.variant === variant)!;
    const neighbour = big.enemies.find(entry => !entry.variant && Math.abs(entry.index - enemy.index) === 1 && Math.floor(entry.index / COLS) === Math.floor(enemy.index / COLS))!;
    enemy.footprint = [enemy.index, neighbour.index]; big.enemies = big.enemies.filter(entry => entry !== neighbour);
    assert(!validateCustomLevel(big).valid, `${variant} occupies one cell`);
  }
  const lesson = authoredLesson({ id: 'chain', name: 'Beast lesson', description: '', hint: '', seed: 1,
    rows: ['RRRR', 'RWWR', 'RRHR', 'RPSR'], legend: { W: { color: 1, variant: 'wolf', hp: 0, armed: true, target: true }, P: { color: 1, variant: 'porcupine', hp: 1 }, S: { color: 0, variant: 'shaman', hp: 2, armed: true } } });
  assert(validateCustomLevel(lesson.definition).valid, 'the lesson legend supports the new variants');
  equal(lesson.definition.enemies.filter(enemy => enemy.variant).map(enemy => [enemy.variant, enemy.aggressive]), [['wolf', true], ['wolf', true], ['porcupine', false], ['shaman', true]], 'legend variants and armed flags');
}

async function main() {
  validation();
  await packArming();
  await packBroken();
  await quills();
  await quillSources();
  await lethalQuills();
  await shamanLadder();
  await shamanCancel();
  await determinism();
  console.log('PASS forest beasts: pack arming and rest, pack broken by the chain, frozen wolf, quills forecast/order/frost, only chain hits fire quills, lethal quills before victory, shaman ladder and targets, rite cancelled by death/target/frost, lesson passivity, forecast = execution, replay and restart');
}
main().catch(error => { console.error(error); throw error; });
