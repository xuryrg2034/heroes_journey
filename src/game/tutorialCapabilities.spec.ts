import { ForestEngine } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import type { ItemKind } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function start(index: number): ForestEngine {
  const engine = new ForestEngine();
  engine.animationScale = 0;
  assert(engine.startTutorial(index), `lesson ${index + 1} starts`);
  return engine;
}

async function legacyLessonsStayLocked() {
  for (let index = 0; index < 6; index++) {
    const game = start(index);
    assert(game.state.tutorial?.allowedItems.length === 0 && game.state.tutorial.allowedAbilities.length === 0,
      `lesson ${index + 1} has no unlocked commands`);
    assert(game.state.player.energy === 0 && Object.values(game.state.inventory).every(amount => amount === 0),
      `lesson ${index + 1} retains its original resources`);
    const target = game.state.board.findIndex(cell => !!cell);
    game.state.player.energy = 7;
    for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[]) game.state.inventory[item] = 1;
    assert(!game.previewFrost(target).valid && !game.prepareFrost(target), 'legacy frost is locked in preview and live command');
    for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[]) {
      assert(!game.previewItem(item, target).valid && !game.useItem(item, target), `${item} remains locked`);
      assert(game.state.inventory[item] === 1, `${item} is not spent by a rejected command`);
    }
    for (const ability of ['jump', 'spin'] as const) {
      assert(!game.setAbility(ability) && !game.previewAbility(ability, target).valid && !await game.useAbility(ability, target),
        `${ability} remains locked in selection, preview and execution`);
    }
    assert(game.state.turn === 0 && game.state.player.energy === 7, 'rejected commands do not advance the turn or spend energy');
  }
}

function tutorialResourcesAndSnapshot() {
  assert(TUTORIAL_LESSONS.length === 16, 'the opening chapter contains sixteen authored encounters');
  for (let index = 6; index < 10; index++) {
    const game = start(index), lesson = TUTORIAL_LESSONS[index], tutorial = game.state.tutorial!;
    assert(tutorial.allowedItems.join() === lesson.allowedItems?.join() && tutorial.allowedAbilities.join() === lesson.allowedAbilities?.join(),
      `lesson ${index + 1} exposes its authored capabilities`);
    assert(tutorial.allowedItems.includes('frost') && (index === 6 ? tutorial.allowedAbilities.length === 0 : tutorial.allowedAbilities.includes('jump')),
      `lesson ${index + 1} unlocks the expected cumulative commands`);
    assert(game.state.player.energy === (lesson.initialEnergy ?? 0), `lesson ${index + 1} loads its authored energy`);
    for (const item of ['frost', 'bomb', 'healing', 'fire'] as ItemKind[])
      assert(game.state.inventory[item] === (lesson.definition.inventory?.[item] ?? 0), `lesson ${index + 1} loads ${item} inventory`);
    const snapshot = JSON.stringify(game.state);
    tutorial.allowedItems.push('bomb'); tutorial.allowedAbilities.push('spin');
    assert(!lesson.allowedItems?.includes('bomb') && !lesson.allowedAbilities?.includes('spin'), 'runtime capabilities do not mutate lesson data');
    game.restartLevel();
    assert(JSON.stringify(game.state) === snapshot, `lesson ${index + 1} restores its exact entry snapshot`);
  }
}

function frostIsUsableWhereAuthored() {
  const game = start(6);
  const wet = game.state.board.findIndex(cell => cell?.status.wet && cell.kind !== 'door' && cell.kind !== 'prism');
  assert(wet >= 0 && game.state.inventory.frost > 0, 'frost lesson starts with a wet enemy and a flask');
  const before = JSON.stringify(game.state);
  assert(game.previewFrost(wet).valid && game.previewItem('frost', wet).valid && JSON.stringify(game.state) === before,
    'both frost previews are valid and pure');
  assert(game.prepareFrost(wet), 'frost live command succeeds');
  assert(game.state.board[wet]?.status.frozen === 1 && game.state.inventory.frost === 0 && game.state.itemPrepared,
    'frost freezes the target and spends exactly one flask');
  assert(!game.previewFrost(wet).valid && !game.useItem('frost', wet), 'one item per turn remains enforced');
  game.restartLevel();
  assert(JSON.stringify(game.state) === before, 'retry restores flask, status, and prepared flag');
}

async function jumpIsGatedByEnergyAndRestart() {
  const game = start(7);
  assert(game.state.player.energy === 0, 'jump lesson begins with no energy');
  const target = game.state.board.findIndex((_cell, index) => index !== game.state.player.index && game.previewAbility('jump', index).reason === 'Недостаточно энергии.');
  assert(target >= 0, 'a jump target can be queried at zero energy');
  assert(!game.setAbility('jump') && !game.previewAbility('jump', target).valid && !await game.useAbility('jump', target),
    'unlocked jump still fails at zero energy');
  assert(game.state.player.energy === 0 && game.state.turn === 0, 'failed jump spends no energy or turn');
  // Battle 8 (5×7): C6 → D5 → C5 (near guard) → B6 → A5 attacks five enemies.
  const cell = (label: string) => (Number(label.slice(1)) - 1) * game.state.cols + label.charCodeAt(0) - 65;
  const earningPath = ['C6', 'D5', 'C5', 'B6', 'A5'].map(cell);
  assert(game.preview(earningPath).valid, 'authored opening provides a five-enemy energy route');
  assert(game.beginChain(earningPath[0]), 'energy route starts');
  for (const step of earningPath.slice(1)) assert(game.extendChain(step), 'energy route extends');
  assert(await game.releaseChain() && Number(game.state.player.energy) === 2.5, 'ordinary chain earns 2.5 energy for jump');
  const landing = cell('C3');
  assert(game.state.terrain[cell('C4')] === 'wall', 'the landing lies across a real wall');
  assert(game.previewAbility('jump', landing).valid, 'authored guard is a legal landing across the wall');
  const before = JSON.stringify(game.state), preview = game.previewAbility('jump', landing);
  assert(preview.valid && JSON.stringify(game.state) === before, 'jump preview is pure');
  assert(game.setAbility('jump') && await game.useAbility('jump', landing), 'jump selection and live command succeed');
  assert(game.state.player.index === landing && Number(game.state.player.energy) === 0.5 && Number(game.state.turn) === 2,
    'jump lands, spends two energy and resolves a turn');

  const interrupted = start(7);
  interrupted.state.player.energy = 2;
  const interruptedLanding = interrupted.state.board.findIndex((_cell, index) => interrupted.previewAbility('jump', index).valid);
  assert(interruptedLanding >= 0, 'restart fixture has a valid jump');
  const opening = start(7), openingState = JSON.stringify(opening.state);
  interrupted.subscribe((_state, event) => { if (event.type === 'ability') interrupted.restartLevel(); });
  assert(!await interrupted.useAbility('jump', interruptedLanding), 'restart during jump cancels the old action');
  assert(JSON.stringify(interrupted.state) === openingState, 'cancelled jump cannot replay into the fresh lesson');
}

async function futureAbilitiesRemainLocked() {
  for (let index = 6; index < 10; index++) {
    const game = start(index), target = game.state.board.findIndex(cell => !!cell);
    game.state.player.energy = 7;
    for (const item of ['bomb', 'healing', 'fire'] as ItemKind[]) {
      game.state.inventory[item] = 1;
      assert(!game.previewItem(item, target).valid && !game.useItem(item, target) && game.state.inventory[item] === 1,
        `lesson ${index + 1} rejects locked ${item} even when stocked`);
    }
    assert(!game.setAbility('spin') && !game.previewAbility('spin').valid && !await game.useAbility('spin'),
      `lesson ${index + 1} rejects spin with enough energy`);
    assert(game.state.turn === 0 && game.state.player.energy === 7, 'locked commands leave turn and energy unchanged');
  }
}

await legacyLessonsStayLocked();
tutorialResourcesAndSnapshot();
frostIsUsableWhereAuthored();
await jumpIsGatedByEnergyAndRestart();
await futureAbilitiesRemainLocked();
console.log('PASS tutorial capability gates, resources, previews, live commands, snapshots and restart cancellation');
