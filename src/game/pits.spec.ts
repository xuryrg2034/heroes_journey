import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { applyDeviceVolley, deviceTargets } from './devices';
import { isCellAlive } from './cellLife';
import { adjacent, isWalkable, prepareIntents, rotationPreview } from './forestSystems';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message = 'Values differ') {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function definition(): CustomLevelDefinition {
  return { version: 1, name: 'Pit test', seed: 808, cols: 5, rows: 5, terrain: Array(25).fill('floor'), heroIndex: 21,
    enemies: Array.from({ length: 25 }, (_, index) => ({ index, kind: 'melee' as const, color: (index === 16 || index === 18 ? 0 : 1) as 0 | 1, hp: 0 }))
      .filter(enemy => ![21, 17].includes(enemy.index)), devices: [{ index: 17, kind: 'pits', charges: 2, targets: [10, 12, 14] }],
    doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [] };
}
function fixture() {
  const game = new ForestEngine(); game.animationScale = 0; assert(game.startCustomLevel(definition()));
  game.state.board.forEach(cell => { if (cell) { cell.behavior.passive = true; cell.intent.cells = []; } });
  return game;
}
async function chain(game: ForestEngine, path = [16, 17, 18]) {
  assert(game.beginChain(path[0])); for (const index of path.slice(1)) assert(game.extendChain(index));
  assert(await game.releaseChain());
}
async function run() {
  const game = fixture(), before = JSON.stringify(game.state), doomed = game.state.board[10]!;
  const preview = game.preview([16, 17, 18]);
  assert(preview.valid); equal(preview.pitCells, [10, 12, 14]); equal(preview.trapKills, 3);
  equal(JSON.stringify(game.state), before, 'preview does not alter runtime overlay or enemies');
  assert(game.beginChain(16)); assert(game.extendChain(17)); game.cancelChain(); equal(game.state.pits, []);
  const events: string[] = []; game.subscribe((_state, event) => events.push(event.type));
  await chain(game);
  equal(game.state.objective.kills, 5); assert(!isCellAlive(doomed), 'natural zero-HP enemy explicitly defeated');
  equal(game.state.pits, [10, 12, 14].map(index => ({ index, closesAfterTurn: 2 })));
  assert(events.indexOf('move') < events.indexOf('pit-open') && events.indexOf('pit-open') < events.indexOf('enemy-turn'));
  assert([10, 12, 14].every(index => game.state.board[index] === null && !isWalkable(game.state, index)), 'no refill in open holes');
  game.state.player.energy = 7; assert(!game.previewAbility('jump', 12).valid, 'jump cannot land in a hole');
  assert(!game.preview([12, 11]).valid, 'chain cannot start in a hole');
  game.state.player.hp = 4; game.state.inventory.healing = 1; assert(game.useItem('healing'));
  equal(game.state.pits.length, 3, 'preparing an item is not a turn');
  await game.waitTurn(); equal(game.state.pits, []); assert(game.state.board[12], 'wait closes holes then refills');
  assert(events.indexOf('pit-close') < events.lastIndexOf('refill'));
  game.restartLevel(); equal(game.state.pits, []); equal(game.state.devices[0].charges, 2);

  const lethal = fixture(); lethal.state.devices[0].targets = [18]; lethal.state.customLevel!.definition.goals[0].target = 2;
  const danger = lethal.preview([16, 17, 18]); assert(danger.playerDies && !danger.completesRoom); equal(danger.trapDamage, 5);
  await chain(lethal); equal(lethal.state.phase, 'LOSE', 'fall defeats simultaneous victory'); equal(lethal.state.player.hp, 0);

  const marked = fixture(); const markedId = marked.state.board[10]!.id;
  marked.state.tutorial = { index: 0, targetIds: [markedId], hintDismissed: true, allowedItems: [], allowedAbilities: [] };
  await chain(marked); equal(marked.state.objective.tutorialTargets, 1, 'fall credits original authored target ID');

  const immune = fixture(); immune.state.devices[0].targets = [10, 11, 12, 13, 14];
  const boss = immune.state.board[10]!; boss.kind = 'boss'; boss.hp = boss.maxHp = 12;
  const door = immune.state.board[11]!; door.kind = 'door';
  const big = immune.state.board[12]!; big.footprint = [12, 13]; immune.state.board[13] = big;
  const prism = immune.state.board[14]!; prism.kind = 'prism'; prism.hp = prism.maxHp = 1;
  const safe = immune.preview([16, 17, 18]); equal(safe.pitImmuneCells, [10, 11, 12, 13]); equal(safe.pitCells, [14]); equal(safe.trapKills, 0);
  await chain(immune); equal(immune.state.objective.kills, 2); equal(immune.state.objective.prisms, 0);
  equal(immune.state.pits.map(pit => pit.index), [14]); assert(!isCellAlive(prism)); assert(isCellAlive(boss));

  const blocked = fixture(); blocked.state.devices[0].targets = [12];
  blocked.state.rotations = [{ from: 11, to: 13, sourceId: blocked.state.board[11]!.id, targetId: blocked.state.board[13]!.id, geometry: 'rook' }];
  blocked.state.board[12] = null;
  assert(rotationPreview(blocked.state)[0].active); assert(!blocked.preview([16, 17, 18]).rotations[0].active, 'preview blocks exchange across future hole');
  let swapped = false; blocked.subscribe((_state, event) => { if (event.type === 'enemy-swap') swapped = true; });
  await chain(blocked); assert(!swapped);
  blocked.state.pits.push({ index: 7, closesAfterTurn: 2 }); assert(!adjacent(blocked.state, 6, 12));
  const archer = blocked.state.board[11]!; archer.kind = 'ranged'; archer.behavior.passive = false; archer.behavior.restTurns = 0;
  blocked.state.player.index = 14; prepareIntents(blocked.state); assert(archer.intent.cells.includes(14), 'arrows fly above holes');

  const renewed = fixture(); await chain(renewed);
  for (const index of [13, 16]) { renewed.state.board[index]!.color = 0; renewed.state.board[index]!.hp = renewed.state.board[index]!.maxHp = 0; }
  await chain(renewed, [13, 17, 16]); equal(renewed.state.pits.map(pit => pit.closesAfterTurn), [3, 3, 3], 'reopening renews lifetime');
  await renewed.waitTurn(); equal(renewed.state.pits, []);
  const ability = fixture(); await chain(ability); ability.state.player.energy = 7;
  assert(await ability.useAbility('jump', 19)); equal(ability.state.pits, [], 'ability turn closes pits');

  for (const boundary of ['trap', 'pit-open', 'hit', 'kill', 'pit-close']) {
    const reset = fixture(); if (boundary === 'pit-close') await chain(reset);
    let restarted = false, pitStarted = false; const trace: string[] = [];
    reset.subscribe((_state, event) => {
      trace.push(event.type); if (event.type === 'pit-open') pitStarted = true;
      if (!restarted && event.type === boundary && (!['hit', 'kill'].includes(boundary) || pitStarted)) { restarted = true; reset.restartLevel(); }
    });
    if (boundary === 'pit-close') equal(await reset.waitTurn(), false);
    else { assert(reset.beginChain(16)); assert(reset.extendChain(17)); assert(reset.extendChain(18)); equal(await reset.releaseChain(), false); }
    assert(restarted, boundary); equal(trace.at(-1), 'start'); equal(reset.state.pits, []); equal(reset.state.turn, 0);
  }
  const slow = fixture(); slow.animationScale = 0.05; let resetSlow = false;
  slow.subscribe((_state, event) => { if (event.type === 'pit-open' && !resetSlow) { resetSlow = true; setTimeout(() => slow.restartLevel(), 0); } });
  assert(slow.beginChain(16)); assert(slow.extendChain(17)); assert(slow.extendChain(18)); equal(await slow.releaseChain(), false); equal(slow.state.pits, []);

  const replayA = fixture(), replayB = fixture(); replayA.preview([16, 17, 18]); replayA.preview([16, 17, 18]);
  await chain(replayA); await chain(replayB); await replayA.waitTurn(); await replayB.waitTurn();
  equal(replayA.state, replayB.state, 'preview and closure preserve deterministic RNG');
  const puddle = fixture(); puddle.state.terrain[12] = 'puddle'; await chain(puddle); await puddle.waitTurn(); equal(puddle.state.terrain[12], 'puddle'); assert(puddle.state.board[12]!.status.wet);
  const independent = fixture(); independent.state.terrain[11] = 'wall';
  equal(deviceTargets(independent.state, { index: 17, kind: 'pits', charges: 1, targets: [10, 11, 14] }), [10, 14]);
  [...applyDeviceVolley(independent.state, { index: 17, kind: 'pits', charges: 1, targets: [10, 11, 14] })]; equal(independent.state.pits.map(pit => pit.index), [10, 14]);
  assert(validateCustomLevel(definition()).valid);
  for (const targets of [[], [10, 10], [-1], [25]]) { const invalid = definition(); invalid.devices![0].targets = targets; assert(!validateCustomLevel(invalid).valid); }
  const invalidTerrain = definition(); invalidTerrain.terrain[12] = 'wall'; assert(!validateCustomLevel(invalidTerrain).valid);
  assert(!validateCustomLevel({ ...definition(), pits: [{ index: 12, closesAfterTurn: 2 }] }).valid);
  const selfTarget = definition(); selfTarget.devices![0].targets = [17, 21]; assert(validateCustomLevel(selfTarget).valid);
  console.log('PASS pit preview/live, death, identity, immunity, expiry, wait/ability, routes, RNG, restart/cancellation and validation');
}
void run();
