import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { shieldIsActive } from './combatRules';
import { prepareIntents } from './forestSystems';
import { applyDeviceVolley } from './devices';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message = 'Values differ') {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
// The Jailer's rules on an editor fixture (the battle itself: sharedBattles.spec.ts). The bell of reinforcements
// was removed with the opening chapter on 30.09.2026, so only the Jailer is checked here.
function definition(): CustomLevelDefinition {
  const variant = 'jailer' as const;
  return { version: 1, name: 'Jailer rules', seed: 917, cols: 5, rows: 5, terrain: Array(25).fill('floor'), heroIndex: 21,
    enemies: Array.from({ length: 25 }, (_, index) => index === 12
      ? { index, kind: 'boss' as const, color: null, hp: 8, variant }
      : { index, kind: 'melee' as const, color: (index < 5 ? 2 : 0) as 0 | 2, hp: 0 }).filter(enemy => enemy.index !== 21),
    doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 0, 100, 0, 0], extraColors: [], playerHp: 10 };
}
function fixture() {
  const game = new ForestEngine(); game.animationScale = 0; assert(game.startCustomLevel(definition()));
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

  for (const boundary of ['attack', 'damage']) {
    const reset = fixture();
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
  const replay = fixture(); await replay.waitTurn(); await replay.waitTurn(); const result = structuredClone(replay.state);
  const fresh = fixture(); fresh.preview([16, 17]); await fresh.waitTurn(); fresh.preview([16, 17]); await fresh.waitTurn();
  equal(fresh.state, result, 'prediction preserves the Jailer turn and RNG');
  assert(validateCustomLevel(definition()).valid);
  const invalid = definition(); invalid.enemies.find(enemy => enemy.index === 12)!.kind = 'melee';
  assert(!validateCustomLevel(invalid).valid, 'the Jailer must be a boss');
  console.log('PASS jailer shield, heavy strike/miss/recovery, frost/jump/fire, pit immunity, replay, RNG and cancellation');
}
run().catch(error => { console.error(error); throw error; });
