import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { shieldIsActive } from './combatRules';
import { prepareIntents } from './forestSystems';
import { planEnemyPhase } from './enemyPhase';
import { applyDeviceVolley } from './devices';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message = 'Values differ') {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function definition(variant: 'jailer' | 'beacon'): CustomLevelDefinition {
  return { version: 1, name: 'Chapter enemy rules', seed: 917, cols: 5, rows: 5, terrain: Array(25).fill('floor'), heroIndex: 21,
    enemies: Array.from({ length: 25 }, (_, index) => index === 12
      ? { index, kind: 'boss' as const, color: null, hp: 8, variant }
      : { index, kind: 'melee' as const, color: (index < 5 ? 2 : 0) as 0 | 2, hp: 0 }).filter(enemy => enemy.index !== 21),
    doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 0, 100, 0, 0], extraColors: [], playerHp: 10 };
}
function fixture(variant: 'jailer' | 'beacon' = 'jailer') {
  const game = new ForestEngine(); game.animationScale = 0; assert(game.startCustomLevel(definition(variant)));
  for (const cell of game.state.board) if (cell?.kind === 'melee') cell.behavior.passive = true;
  prepareIntents(game.state); return game;
}
async function chain(game: ForestEngine, path: number[]) {
  assert(game.beginChain(path[0]), `begin ${path}`); for (const index of path.slice(1)) assert(game.extendChain(index), `extend ${index}`);
  assert(await game.releaseChain());
}
async function run() {
  const hit = fixture(), initial = structuredClone(hit.state), before = JSON.stringify(hit.state);
  assert(shieldIsActive(hit.state.board[12]!)); equal(hit.state.board[12]!.shield, { dx: 0, dy: 1 });
  assert(!hit.preview([16, 17, 12]).valid, 'frontal approach blocked');
  const side = hit.preview([16, 11, 12]); assert(side.valid); equal(side.hits.at(-1)?.hpAfter, 5); equal(side.damage, 0);
  const forecast = hit.preview([16, 17]); assert(forecast.valid); equal(forecast.damage, 2);
  equal(JSON.stringify(hit.state), before, 'previews are pure');
  await chain(hit, [16, 17]); equal(hit.state.player.hp, 8); equal(hit.state.board[12]!.behavior.restTurns, 1);
  assert(!shieldIsActive(hit.state.board[12]!)); equal(hit.state.board[12]!.intent.cells, []);
  for (const cell of hit.state.board) if (cell?.kind === 'melee') { cell.behavior.passive = true; cell.intent.cells = []; }
  await hit.waitTurn(); equal(hit.state.player.hp, 8); assert(shieldIsActive(hit.state.board[12]!));
  equal(hit.state.board[12]!.shield, initial.board[12]!.shield, 'shield facing never follows player');
  hit.restartLevel(); equal(hit.state.board[12]!.behavior.restTurns, 0); assert(shieldIsActive(hit.state.board[12]!));

  const miss = fixture(); await chain(miss, [16, 11, 12]); equal(miss.state.player.hp, 10);
  equal(miss.state.board[12]!.behavior.restTurns, 1, 'miss spends heavy strike and earns recovery');
  miss.state.player.index = 21; miss.state.board[16]!.color = miss.state.board[17]!.color = 0; assert(miss.preview([16, 17, 12]).valid, 'lowered shield permits front hit');
  const frozen = fixture(); frozen.state.terrain[12] = 'puddle'; frozen.state.board[12]!.status.wet = true;
  assert(frozen.useItem('frost', 12)); assert(!shieldIsActive(frozen.state.board[12]!));
  assert(frozen.preview([16, 17, 12]).valid); await chain(frozen, [16, 17, 12]); equal(frozen.state.player.hp, 10);
  equal(frozen.state.board[12]!.behavior.restTurns, 0, 'frozen enemy never attempts attack');
  const jump = fixture(); jump.state.player.energy = 2; jump.state.board[12]!.hp = 4;
  assert(jump.previewAbility('jump', 12).valid, 'jump bypasses shield'); assert(await jump.useAbility('jump', 12));
  equal(jump.state.objective.bossKills, 1);

  const burning = fixture(); burning.state.board[12]!.hp = 1; assert(burning.useItem('fire', 12));
  const burnForecast = burning.preview([16, 17]); equal(burnForecast.damage, 2, 'fire does not prevent the reply');
  const events: string[] = []; burning.subscribe((_state, event) => events.push(`${event.type}:${event.index}`));
  await chain(burning, [16, 17]); equal(burning.state.player.hp, 8); equal(burning.state.objective.bossKills, 1);
  assert(events.indexOf('attack:12') < events.indexOf('kill:12'));
  const pit = fixture(); const pitBoss = pit.state.board[12]!;
  [...applyDeviceVolley(pit.state, { index: 20, kind: 'pits', charges: 1, targets: [12] })];
  assert(!pit.state.pits.length && pit.state.board[12] === pitBoss, 'jailer is immune to pits');

  const beacon = fixture('beacon'); let arrivals = 0;
  beacon.subscribe((_state, event) => { if (event.type === 'special-arrival') arrivals++; });
  equal(planEnemyPhase(beacon.state.board, beacon.state.player.index).attacks.length, 0);
  equal(beacon.state.board[12]!.intent.summonCells, undefined); await beacon.waitTurn();
  const announced = [...beacon.state.board[12]!.intent.summonCells!], announcedIds = [...beacon.state.board[12]!.intent.summonIds!];
  equal(announced.length, 2); equal(arrivals, 0); await beacon.waitTurn(); equal(arrivals, 2);
  announced.forEach((index, n) => {
    const cell = beacon.state.board[index]!; assert(cell.id !== announcedIds[n] && cell.behavior.aggressive && !cell.behavior.passive);
    equal(cell.hp, 0); equal(cell.intent.damage, 1);
  });
  equal(beacon.state.player.hp, 10, 'fresh reinforcements do not attack on summon turn');
  await beacon.waitTurn(); equal(arrivals, 2, 'one charging turn between summons');
  await beacon.waitTurn(); equal(arrivals, 4);

  const identity = fixture('beacon'); await identity.waitTurn();
  const target = identity.state.board[12]!.intent.summonCells![0], originalId = identity.state.board[target]!.id;
  identity.state.board[target]!.id = originalId + 1000; let replacement = false;
  identity.subscribe((_state, event) => { if (event.type === 'special-arrival' && event.index === target) replacement = true; });
  await identity.waitTurn(); assert(!replacement, 'summon refuses an occupant different from announced ID');

  const doomed = fixture('beacon'); await doomed.waitTurn(); doomed.state.board[12]!.hp = 1;
  assert(doomed.useItem('fire', 12)); let deadSourceArrivals = 0;
  doomed.subscribe((_state, event) => { if (event.type === 'special-arrival') deadSourceArrivals++; });
  await doomed.waitTurn(); equal(deadSourceArrivals, 0, 'source killed by end-turn effect cannot summon');
  const ice = fixture('beacon'); await ice.waitTurn(); ice.state.board[12]!.status.frozen = 1;
  await ice.waitTurn(); equal(ice.state.board[12]!.behavior.cycle, 1, 'frozen source pauses cycle');
  assert(ice.state.board[12]!.intent.summonCells?.length === 2, 'summon is announced again on thaw');

  for (const boundary of ['attack', 'damage', 'special-arrival']) {
    const reset = fixture(boundary === 'special-arrival' ? 'beacon' : 'jailer');
    if (boundary === 'special-arrival') await reset.waitTurn();
    let restarted = false; const trace: string[] = [];
    reset.subscribe((_state, event) => { trace.push(event.type); if (!restarted && event.type === boundary) { restarted = true; reset.restartLevel(); } });
    if (boundary === 'damage') { assert(reset.beginChain(16)); assert(reset.extendChain(17)); equal(await reset.releaseChain(), false); }
    else equal(await reset.waitTurn(), false);
    assert(restarted); equal(trace.at(-1), 'start'); equal(reset.state.turn, 0); equal(reset.state.board[12]!.behavior.cycle, 0);
  }
  const delayed = fixture(); delayed.animationScale = 0.05; let pendingRestart = false;
  delayed.subscribe((_state, event) => { if (event.type === 'attack' && !pendingRestart) {
    pendingRestart = true; setTimeout(() => delayed.restartLevel(), 0);
  } });
  equal(await delayed.waitTurn(), false, 'restart during animation cancels the old boss turn'); equal(delayed.state.turn, 0);
  const replay = fixture('beacon'); await replay.waitTurn(); await replay.waitTurn(); const result = structuredClone(replay.state);
  const fresh = fixture('beacon'); fresh.preview([16, 17]); await fresh.waitTurn(); fresh.preview([16, 17]); await fresh.waitTurn();
  equal(fresh.state, result, 'prediction preserves summon IDs and RNG');
  for (const variant of ['jailer', 'beacon'] as const) {
    assert(validateCustomLevel(definition(variant)).valid);
    const invalid = definition(variant); invalid.enemies.find(enemy => enemy.index === 12)!.kind = 'melee';
    assert(!validateCustomLevel(invalid).valid);
  }
  console.log('PASS jailer shield, heavy strike/miss/recovery, frost/jump/fire, pit immunity; beacon cadence, identity, death, freeze, RNG and cancellation');
}
void run();
