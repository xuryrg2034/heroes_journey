import type { ForestEngine } from './forestEngine';
import { startForestFixture } from './testing/fixtures';
import { isCellAlive } from './cellLife';
import { canSwapEnemies, prepareIntents } from './forestSystems';
import { applyDamageEffect } from './damageEffects';
import type { ForestCell } from './forestTypes';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  assert(a === b, `${message}: ${a} != ${b}`);
}
let nextId = 80_000;
function enemy(hp = 0): ForestCell {
  return { id: nextId++, kind: 'melee', color: 0, hp, maxHp: hp,
    armor: 0, countdown: 1, status: { wet: false, frozen: 0, brittle: false },
    behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Спокоен' } };
}
function fixture() {
  const game = startForestFixture();
  game.state.board.fill(null); game.state.terrain.fill('floor');
  return game;
}
async function commit(game: ForestEngine, path: number[]) {
  assert(game.beginChain(path[0]), 'chain starts');
  for (const index of path.slice(1)) assert(game.extendChain(index), `chain extends ${index}`);
  assert(await game.releaseChain(), 'chain resolves');
}
async function budgetAccumulatesAndSpends() {
  const game = fixture(), path = [44, 37, 30, 23, 16, 9, 2];
  for (const index of path.slice(0, 5)) game.state.board[index] = enemy();
  game.state.board[9] = enemy(5); game.state.board[2] = enemy();
  const before = JSON.stringify(game.state);
  for (let n = 0; n < 4; n++) {
    const preview = game.preview(path);
    equal(preview.hits.map(hit => [hit.availablePower, hit.powerSpent, hit.remainingPower]),
      [[1, 0, 1], [2, 0, 2], [3, 0, 3], [4, 0, 4], [5, 0, 5], [6, 5, 1], [2, 0, 2]],
      'each enemy adds one power, weak enemies spend none, 5 HP spends five, and the next weak enemy adds one');
    equal([preview.power, preview.kills, preview.endIndex], [2, 7, 2], 'the remaining point continues into a seventh target');
    assert(JSON.stringify(game.state) === before, 'repeated previews do not mutate board, RNG or budget');
  }
  await commit(game, path);
  assert(game.state.player.index === 2 && game.state.objective.kills === 7, 'live route agrees with preview kills and endpoint');
}
async function survivorStopsFurtherTraversal() {
  const game = fixture(); game.state.board[44] = enemy(); game.state.board[37] = enemy(10); game.state.board[30] = enemy();
  const preview = game.preview([44, 37]);
  equal(preview.hits.map(hit => [hit.availablePower, hit.powerSpent, hit.remainingPower, hit.hpAfter]),
    [[1, 0, 1, 0], [2, 2, 0, 8]], 'terminal survivor consumes available power and keeps its wound');
  assert(preview.endsOnSurvivor && preview.endIndex === 44, 'cat stops on last defeated square');
  assert(!game.preview([44, 37, 30]).valid, 'cannot cross the surviving target');
  const guardId = game.state.board[37]!.id;
  await commit(game, [44, 37]);
  assert(game.state.board[37]?.id === guardId && game.state.board[37]?.hp === 8 && game.state.player.index === 44,
    'execution preserves target identity, wound and cat endpoint');
}
async function modifiersSpendActualRemoval() {
  const brittle = fixture(); brittle.state.board[44] = enemy(); brittle.state.board[37] = enemy();
  brittle.state.board[30] = enemy(5); brittle.state.board[30]!.status.brittle = true;
  const preview = brittle.preview([44, 37, 30]);
  equal([preview.hits[2].availablePower, preview.hits[2].powerSpent, preview.hits[2].remainingPower, preview.hits[2].killed],
    [3, 3, 0, true], 'brittle kill spends at most the three power available');
  await commit(brittle, [44, 37, 30]);
  assert(brittle.state.player.index === 30, 'brittle route commits its predicted endpoint');
}
async function zeroHpLifeAndCancellation() {
  const game = fixture(), weak = enemy(); weak.behavior.aggressive = true;
  game.state.board[44] = weak;
  assert(isCellAlive(weak), 'a natural zero-HP enemy begins alive');
  prepareIntents(game.state);
  assert(game.state.board[44]?.intent.cells.includes(game.state.player.index), 'zero-HP melee may aim at the cat');
  const id = weak.id;
  await game.waitTurn();
  assert(game.state.player.hp === 4 && game.state.board[44]?.id === id, 'zero-HP enemy attacks and survives an enemy phase');
  game.state.board[43] = enemy();
  assert(canSwapEnemies(game.state, 44, 43), 'zero-HP live enemies can exchange positions');
  const replay = JSON.stringify(game.state);
  game.restartLevel();
  assert(game.state.turn === 0 && Number(game.state.player.hp) === 5, 'restart discards the old zero-HP turn');
  assert(JSON.stringify(game.state) !== replay, 'restart restores the entry snapshot');

  const frozen = fixture(), trainee = enemy(); trainee.behavior.aggressive = true; trainee.status.frozen = 2;
  frozen.state.board[44] = trainee; prepareIntents(frozen.state);
  assert(!trainee.intent.cells.length, 'frozen zero-HP enemy has no attack intent');
  await frozen.waitTurn();
  assert(frozen.state.board[44]?.id === trainee.id && frozen.state.player.hp === 5 && trainee.status.frozen === 1,
    'freeze suppresses its action without making the zero-HP enemy disappear');

  const burning = fixture(), ember = enemy(); ember.damageEffects = applyDamageEffect(undefined, 'fire');
  burning.state.board[44] = ember;
  await burning.waitTurn();
  assert(!burning.state.board.some(cell => cell?.id === ember.id) && burning.state.objective.kills === 0,
    'positive fire tick defeats a zero-HP enemy without player chain credit');

  const canceled = fixture(); canceled.state.board[44] = enemy(); canceled.state.board[37] = enemy();
  let entry = '', hitEvents = 0;
  canceled.subscribe((_state, event) => {
    if (event.type === 'hit' && !hitEvents++) { canceled.restartLevel(); entry = JSON.stringify(canceled.state); }
  });
  assert(canceled.beginChain(44) && canceled.extendChain(37), 'cancel route starts');
  assert(!await canceled.releaseChain() && hitEvents === 1 && JSON.stringify(canceled.state) === entry,
    'restart during a weak hit cancels all stale budget and later hits');
}

void budgetAccumulatesAndSpends().then(survivorStopsFurtherTraversal).then(modifiersSpendActualRemoval)
  .then(zeroHpLifeAndCancellation).then(() => console.log('PASS chain budget, modifiers, zero-HP life/fire/freeze, preview purity and restart'))
  .catch(error => { setTimeout(() => { throw error; }, 0); });
