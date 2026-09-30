import { ForestEngine } from './forestEngine';
import { forestFixtureLevel, startForestFixture } from './testing/fixtures';
import { applyDamageEffect, summarizeDamageEffects } from './damageEffects';
import type { CustomLevelDefinition } from './customLevel';
import type { ForestCell } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let nextId = 300000;
function cell(kind: ForestCell['kind'] = 'melee', hp = kind === 'melee' ? 0 : 4): ForestCell {
  return { id: nextId++, kind, color: 0, hp, maxHp: hp, armor: 0, countdown: 2,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 },
    intent: { cells: [], damage: 1, label: 'Fixture' } };
}
/** Camp patch whose goal is one boss kill (validation wants an authored boss; the tests rebuild the board anyway). */
const BOSS_GOAL: Partial<CustomLevelDefinition> = { goals: [{ key: 'bossKills', target: 1 }],
  enemies: forestFixtureLevel().enemies.map(enemy => enemy.index === 1 ? { index: 1, kind: 'boss', color: null, hp: 20 } : enemy) };
/** The camp fixture (hero entry 45) rebuilt as an open floor of inert prisms around the cat on 24. */
function fixture(patch: Partial<CustomLevelDefinition> = {}): ForestEngine {
  const game = startForestFixture(701, patch);
  game.state.player.index = 24;
  game.state.terrain.fill('floor');
  game.state.board = Array.from({ length: 49 }, (_, index) => index === 24 ? null : cell('prism', 1));
  return game;
}
async function chain(game: ForestEngine, path: number[]): Promise<boolean> {
  assert(game.beginChain(path[0]), `chain starts at ${path[0]}`);
  for (const index of path.slice(1)) assert(game.extendChain(index), `chain extends to ${index}`);
  return game.releaseChain();
}

async function fireAndPoison(): Promise<void> {
  const game = fixture(), target = cell('melee', 9);
  target.footprint = [16, 17, 23, 24];
  game.state.player.index = 45;
  game.state.board[24] = target;
  for (const index of target.footprint) game.state.board[index] = target;
  game.state.board[45] = null;
  game.state.inventory.fire = 2;
  const hp = target.hp;
  const events: { type: string; effect?: string }[] = [];
  game.subscribe((_state, event) => events.push({ type: event.type, effect: event.effect }));
  const preview = game.previewItem('fire', 23);
  assert(preview.valid && preview.damage === 0, 'fire flask forecasts no impact damage');
  assert(game.useItem('fire', 23), 'fire flask applies to the target');
  equal([target.hp, summarizeDamageEffects(target.damageEffects).burning], [hp, 1],
    'cross area applies one fire stack to a shared footprint without immediate HP loss');
  assert(events.filter(event => event.type === 'status' && event.effect === 'fire').length === 1,
    'shared footprint publishes one fire status event');
  assert(await game.waitTurn(), 'first burning turn completes');
  equal([target.hp, target.damageEffects?.burning, target.damageEffects?.burningTurns], [hp - 1, 1, 1],
    'one burning stack deals one end-turn damage and advances decay');
  assert(game.useItem('fire', 23), 'fire can be reapplied next turn');
  equal([target.hp, target.damageEffects?.burningTurns], [hp - 1, 1],
    'reapplication leaves HP and the shared decay timer unchanged');
  assert(await game.waitTurn(), 'second burning turn completes');
  equal([target.hp, target.damageEffects?.burning, target.damageEffects?.burningTurns], [hp - 3, 1, 0],
    'two stacks tick before one stack decays on the second full turn');

  const poison = fixture(), victim = cell('melee', 9);
  poison.state.board[30] = victim;
  victim.damageEffects = applyDamageEffect(applyDamageEffect(undefined, 'poison'), 'poison');
  for (let turn = 1; turn <= 2; turn++) {
    assert(await poison.waitTurn(), `poison turn ${turn} completes`);
    equal([victim.hp, victim.damageEffects?.poison], [9 - 2 * turn, 2],
      'poison deals one damage per stack each turn without decaying');
  }
}

async function attackForecastAndHealing(): Promise<void> {
  const game = fixture();
  game.state.board[23] = cell(); game.state.board[22] = cell();
  const attacker = cell(); attacker.behavior.aggressive = true;
  attacker.intent = { cells: [22], damage: 1, label: 'Poison attack' };
  attacker.attackEffect = 'poison'; game.state.board[15] = attacker;
  const before = JSON.stringify(game.state), forecast = game.preview([23, 22]);
  assert(forecast.valid && forecast.damage === 2 && forecast.effectDamage === 1,
    'forecast includes physical attack and end-turn poison damage');
  assert(forecast.endEffects?.poison === 1 && JSON.stringify(game.state) === before,
    'forecast reports the final effect stack and leaves live state untouched');
  assert(await chain(game, [23, 22]), 'poison attack turn completes');
  equal([game.state.lastDamage, game.state.player.hp, game.state.player.damageEffects?.poison],
    [forecast.damage, 3, forecast.endEffects?.poison], 'execution matches incoming damage and final status forecast');

  const healing = fixture();
  healing.state.player.damageEffects = applyDamageEffect(
    applyDamageEffect(applyDamageEffect(undefined, 'bleeding'), 'poison'), 'fire');
  healing.state.player.damageEffects!.bleedingSteps = 2;
  healing.state.inventory.healing = 1;
  assert(healing.previewItem('healing').valid && healing.useItem('healing'),
    'healing is usable at full HP when a curable effect is present');
  equal([healing.state.player.hp, healing.state.player.damageEffects?.burning,
    healing.state.player.damageEffects?.poison, healing.state.player.damageEffects?.bleeding,
    healing.state.player.damageEffects?.bleedingSteps], [5, 1, 0, 0, 0],
  'full-HP healing clears poison, bleeding and step progress but preserves burning');
}

async function bleedingMovement(): Promise<void> {
  const game = fixture(); game.state.board[23] = cell(); game.state.board[22] = cell();
  for (let n = 0; n < 4; n++) game.state.player.damageEffects = applyDamageEffect(game.state.player.damageEffects, 'bleeding');
  const first = game.preview([23, 22]);
  assert(first.valid && first.movementDamage === 0 && first.endEffects?.bleedingSteps === 2,
    'two ordinary moves advance bleeding progress without damage');
  assert(await chain(game, [23, 22]), 'first bleeding chain completes');
  equal([game.state.player.index, game.state.player.hp, game.state.player.damageEffects?.bleeding,
    game.state.player.damageEffects?.bleedingSteps], [22, 5, 3, 2],
  'bleeding loses one stack at turn end and carries two-step remainder');
  game.state.board[21] = cell(); game.state.board[14] = cell();
  const second = game.preview([21, 14]);
  assert(second.valid && second.movementDamage === 3, 'next ordinary step triggers carried bleeding at current stack count');
  assert(await chain(game, [21, 14]), 'second bleeding chain completes');
  equal([game.state.player.index, game.state.player.hp, game.state.player.damageEffects?.bleedingSteps], [14, 2, 1],
    'movement damage occurs once and the remaining step carries across another turn');

  const lethal = fixture(); lethal.state.player.hp = 1;
  lethal.state.board[23] = cell(); lethal.state.board[22] = cell();
  lethal.state.player.damageEffects = applyDamageEffect(undefined, 'bleeding');
  lethal.state.player.damageEffects!.bleedingSteps = 2;
  const hpBefore = lethal.state.board[22]!.hp, energyBefore = lethal.state.player.energy;
  const predicted = lethal.preview([23, 22]);
  assert(predicted.valid && predicted.playerDies && predicted.movementDamage === 1,
    'preview identifies lethal bleeding on first ordinary move');
  const hitIndices: number[] = [];
  lethal.subscribe((_state, event) => { if (event.type === 'hit') hitIndices.push(event.index!); });
  assert(await chain(lethal, [23, 22]), 'lethal bleeding turn resolves');
  assert(lethal.state.phase === 'LOSE' && lethal.state.player.index === 23 && lethal.state.board[22]!.hp === hpBefore,
    'death on first move stops the later hit and leaves its target untouched');
  assert(!hitIndices.includes(22) && lethal.state.player.energy <= energyBefore + 0.5,
    'lethal movement does not award energy for a skipped hit');

  const diagonal = fixture(); diagonal.state.board[16] = cell(); diagonal.state.board[8] = cell();
  diagonal.state.player.damageEffects = applyDamageEffect(applyDamageEffect(undefined, 'bleeding'), 'bleeding');
  diagonal.state.player.damageEffects!.bleedingSteps = 2;
  assert(diagonal.preview([16, 8]).movementDamage === 2,
    'one diagonal grid move completes the carried three-step bleeding interval');
  assert(await chain(diagonal, [16, 8]), 'diagonal bleeding chain completes');
  equal([diagonal.state.player.hp, diagonal.state.player.damageEffects?.bleedingSteps], [3, 1],
    'diagonal counts as one ordinary move, then the second move starts the next interval');

  const third = fixture(); third.state.player.hp = 1;
  for (const index of [23, 22, 21, 14]) third.state.board[index] = cell();
  third.state.player.damageEffects = applyDamageEffect(undefined, 'bleeding');
  assert(third.preview([23, 22, 21, 14]).playerDies, 'preview identifies lethal third-step bleeding');
  const fourthHp = third.state.board[14]!.hp;
  assert(await chain(third, [23, 22, 21, 14]), 'third-step lethal chain resolves');
  assert(third.state.phase === 'LOSE' && third.state.player.index === 21 && third.state.board[14]!.hp === fourthHp,
    'death on the third ordinary move stops the fourth hit');

  const jump = fixture(); jump.state.board[23] = cell(); jump.state.player.energy = 2;
  jump.state.player.damageEffects = applyDamageEffect(undefined, 'bleeding');
  jump.state.player.damageEffects!.bleedingSteps = 2;
  assert(jump.previewAbility('jump', 23).movementDamage === 0, 'jump does not forecast an ordinary step');
  assert(await jump.useAbility('jump', 23), 'jump with bleeding completes');
  equal([jump.state.player.hp, jump.state.player.index], [5, 23], 'jump does not trigger bleeding movement damage');

  const spin = fixture(); spin.state.board[23] = cell(); spin.state.player.energy = 3;
  spin.state.player.damageEffects = applyDamageEffect(undefined, 'bleeding');
  spin.state.player.damageEffects!.bleedingSteps = 2;
  assert(spin.previewAbility('spin').movementDamage === 0, 'spin does not forecast an ordinary step');
  assert(await spin.useAbility('spin'), 'spin with bleeding completes');
  equal([spin.state.player.hp, spin.state.player.index], [5, 24], 'spin does not trigger bleeding movement damage');
}

async function delayedDefeatAndRestart(): Promise<void> {
  const game = fixture(), victim = cell('melee', 1);
  victim.damageEffects = applyDamageEffect(undefined, 'poison', true);
  game.state.board[30] = victim;
  assert(await game.waitTurn(), 'credited poison defeat resolves');
  assert(game.state.objective.kills === 1 && !game.state.board.some(target => target?.id === victim.id),
    'credited delayed kill counts once and removes the victim');

  const pending = fixture(); pending.animationScale = 0.2;
  pending.state.player.damageEffects = applyDamageEffect(undefined, 'poison');
  const before = JSON.stringify(pending.state), oldTurn = pending.waitTurn();
  pending.restartLevel(); await oldTurn;
  assert(pending.state.turn === 0 && pending.state.player.hp === 5
    && pending.state.player.damageEffects === undefined && JSON.stringify(pending.state) !== before,
  'restart cancels pending DOT and restores the clean room snapshot');
}

async function swapsAndDelayedWins(): Promise<void> {
  const swap = fixture(), source = cell('ranged', 7), partner = cell();
  source.behavior.restTurns = 1;
  source.intent.moveTo = 13; source.intent.swapWithId = partner.id;
  swap.state.board[20] = source; swap.state.board[13] = partner;
  swap.state.rotations = [{ from: 20, to: 13, sourceId: source.id, targetId: partner.id, geometry: 'cardinal' }];
  swap.state.player.damageEffects = applyDamageEffect(applyDamageEffect(undefined, 'bleeding'), 'bleeding');
  swap.state.player.damageEffects!.bleedingSteps = 2;
  let swaps = 0;
  swap.subscribe((_state, event) => { if (event.type === 'enemy-swap') swaps++; });
  assert(await swap.waitTurn(), 'enemy exchange completes while hero is bleeding');
  equal([swaps, swap.state.player.hp, swap.state.player.damageEffects?.bleedingSteps], [1, 5, 2],
    'enemy swap does not count as hero movement or trigger bleeding');

  const bossGame = fixture(BOSS_GOAL), boss = cell('boss', 2);
  boss.color = null; boss.status.frozen = 2;
  boss.damageEffects = applyDamageEffect(undefined, 'poison', true);
  bossGame.state.board[30] = boss;
  assert(await bossGame.waitTurn(), 'first boss poison tick resolves');
  equal([boss.hp, bossGame.state.phase, bossGame.state.objective.bossKills], [1, 'PLAYER_INPUT', 0],
    'a surviving boss keeps the battle going');
  assert(await bossGame.waitTurn(), 'final boss poison tick resolves');
  equal([bossGame.state.phase, bossGame.state.objective.bossKills], ['WIN', 1],
    'credited DOT boss defeat wins and credits exactly once');

  const definition: CustomLevelDefinition = {
    version: 1, name: 'Delayed goal', seed: 701, cols: 4, rows: 4,
    terrain: Array(16).fill('floor'), heroIndex: 12,
    enemies: [{ index: 8, kind: 'melee', hp: 4, color: 0 }, { index: 4, kind: 'melee', hp: 4, color: 0 }],
    doors: [], goals: [{ key: 'kills', target: 1 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [1, 0, 0, 0, 0], extraColors: [], playerHp: 5,
  };
  const custom = new ForestEngine(701); custom.animationScale = 0;
  assert(custom.startCustomLevel(definition), 'custom direct-goal fixture starts');
  const victim = custom.state.board[8]!; victim.hp = 1; victim.intent.cells = [];
  victim.damageEffects = applyDamageEffect(undefined, 'poison', true);
  assert(await custom.waitTurn(), 'credited delayed custom defeat resolves');
  assert(custom.state.phase === 'WIN' && custom.state.objective.kills === 1
    && custom.state.customLevel?.goalCompletedTurn === 1,
  'credited DOT satisfies direct custom kill goal in the same turn');
}

async function restartAtEffectCallbacks(): Promise<void> {
  for (const boundary of ['status', 'damage', 'kill'] as const) {
    const game = fixture(); game.animationScale = 0.2;
    if (boundary === 'status') {
      const attacker = cell(); attacker.behavior.aggressive = true;
      attacker.intent = { cells: [24], damage: 1, label: 'Poison attack' };
      attacker.attackEffect = 'poison'; game.state.board[17] = attacker;
    } else if (boundary === 'damage') {
      game.state.player.damageEffects = applyDamageEffect(undefined, 'poison');
    } else {
      const victim = cell('melee', 1);
      victim.damageEffects = applyDamageEffect(undefined, 'poison', true);
      game.state.board[30] = victim;
    }
    let restarted = false;
    const stale: string[] = [];
    game.subscribe((_state, event) => {
      if (restarted) { if (event.type !== 'start') stale.push(event.type); return; }
      if (event.type !== boundary || boundary === 'status' && event.effect !== 'poison'
        || boundary === 'damage' && event.effect !== 'poison'
        || boundary === 'kill' && event.effect !== 'poison') return;
      restarted = true; game.restartLevel();
    });
    const result = await game.waitTurn();
    assert(restarted && !result && stale.length === 0, `${boundary}: restart at effect callback cancels stale events`);
    assert(game.state.turn === 0 && game.state.phase === 'PLAYER_INPUT'
      && game.state.player.hp === 5 && game.state.player.damageEffects === undefined,
    `${boundary}: fresh room has no status or damage from canceled turn`);
  }
}

async function roomReplayAndClone(): Promise<void> {
  const game = startForestFixture(701);
  const targetIndex = game.state.board.findIndex(target => target?.kind === 'melee');
  assert(targetIndex >= 0, 'camp contains a delayed-damage target');
  const run = async () => {
    for (const target of game.state.board) if (target) target.status.frozen = 2;
    const victim = game.state.board[targetIndex]!;
    victim.hp = 1; victim.damageEffects = applyDamageEffect(undefined, 'poison', true);
    const copied = game.getBoardState();
    copied[targetIndex]!.damageEffects!.poison = 99;
    assert(victim.damageEffects?.poison === 1, 'board snapshot owns its own damage-effect counters');
    assert(await game.waitTurn(), 'DOT turn completes');
    assert(game.state.objective.kills === 1 && game.state.board[targetIndex]?.id !== victim.id, 'the poisoned goblin dies and is credited');
    return JSON.stringify({ board: game.getBoardState(), player: game.state.player, objective: game.state.objective });
  };
  const first = await run();
  game.restartLevel();
  equal(await run(), first, 'battle restart replays credited DOT, refill and RNG-dependent state exactly');
}

void fireAndPoison().then(attackForecastAndHealing).then(bleedingMovement).then(delayedDefeatAndRestart)
  .then(swapsAndDelayedWins).then(restartAtEffectCallbacks).then(roomReplayAndClone)
  .then(() => console.log('PASS damage effect integration: items, turns, attacks, movement, delayed wins and replay'))
  .catch(error => { console.error(error); throw error; });
