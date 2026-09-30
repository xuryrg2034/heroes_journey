import { ForestEngine } from './forestEngine';
import { forestBattle } from './run/forestBattles';
import { nodeBattleSetup, startNodeBattle } from './testing/fixtures';
import type { AbilityKind, ItemKind } from './forestTypes';

// Tool gates of map-node battles. A battle does not choose its tools: the run opens them (node grants, finds, reward
// grants) and the engine allows only the opened ones in selection, forecast and execution. Here every battle is started
// as its node with the tools guaranteed on entering it (startNodeBattle): none on the trunk (rows 1–4), frost and jump
// from the trails to the Jailer, the spin only after the Jailer (the Chief). Run-level opening: forestRun.spec.ts.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const ITEMS: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const ABILITIES: AbilityKind[] = ['jump', 'spin'];
const NODES: { id: string; items: ItemKind[]; abilities: AbilityKind[] }[] = [
  { id: 'trunk-wake', items: [], abilities: [] },
  { id: 'trunk-arrows', items: [], abilities: [] },
  { id: 'three-banners', items: ['frost'], abilities: ['jump'] },
  { id: 'jailer-gate', items: ['frost'], abilities: ['jump'] },
  { id: 'chief-breakfast', items: ['frost'], abilities: ['jump', 'spin'] },
];

/** Every closed tool is rejected in selection, forecast and execution, even with stock and energy; nothing is spent. */
async function closedToolsStayLocked() {
  for (const { id, items, abilities } of NODES) {
    const game = startNodeBattle(id);
    assert(JSON.stringify(game.state.runNode?.allowedItems) === JSON.stringify(items) && JSON.stringify(game.state.runNode?.allowedAbilities) === JSON.stringify(abilities),
      `${id}: the node opens ${items.concat(abilities as never[]).join('+') || 'nothing'}`);
    assert(game.state.player.energy === 0 && Object.values(game.state.inventory).every(amount => amount === 0), `${id}: analysis entry without energy and items`);
    const target = game.state.board.findIndex(cell => !!cell && cell.kind !== 'prism' && cell.kind !== 'door');
    game.state.player.energy = 7;
    for (const item of ITEMS) game.state.inventory[item] = 1;
    for (const item of ITEMS.filter(item => !items.includes(item))) {
      assert(!game.previewItem(item, target).valid && !game.useItem(item, target), `${id}: closed ${item} is rejected`);
      assert(game.state.inventory[item] === 1, `${id}: ${item} is not spent by a rejected command`);
    }
    if (!items.includes('frost')) assert(!game.previewFrost(target).valid && !game.prepareFrost(target), `${id}: closed frost is rejected by its own command too`);
    for (const ability of ABILITIES.filter(ability => !abilities.includes(ability))) {
      assert(!game.setAbility(ability) && !game.previewAbility(ability, target).valid && !await game.useAbility(ability, target),
        `${id}: closed ${ability} is rejected in selection, forecast and execution`);
    }
    assert(game.state.turn === 0 && game.state.player.energy === 7, `${id}: rejected commands do not advance the turn or spend energy`);
  }
}

/** The run's tools belong to the started battle only: changing them at runtime touches neither the setup nor the battle data. */
function toolsBelongToTheRun() {
  const setup = nodeBattleSetup('three-banners'), battle = forestBattle('three-banners')!;
  const data = JSON.stringify(battle), frozen = JSON.stringify(setup);
  const game = new ForestEngine(); game.animationScale = 0;
  assert(game.startRunBattle(setup), 'three-banners starts');
  const snapshot = JSON.stringify(game.state);
  game.state.runNode!.allowedItems.push('bomb'); game.state.runNode!.allowedAbilities.push('spin');
  game.state.tutorial!.allowedItems.push('bomb'); game.state.tutorial!.allowedAbilities.push('spin');
  assert(JSON.stringify(setup) === frozen && JSON.stringify(battle) === data, 'runtime tools do not mutate the setup or the battle data');
  game.restartLevel();
  assert(JSON.stringify(game.state) === snapshot, 'restart restores the node entry with its own tools');
  // The same battle entered with other run tools gets exactly those.
  const wider = startNodeBattle('three-banners', { allowedItems: ['frost', 'bomb'], allowedAbilities: ['jump', 'spin'], inventory: { frost: 0, bomb: 2, healing: 0, fire: 0 } });
  const target = wider.state.board.findIndex(cell => !!cell && cell.kind !== 'prism');
  assert(wider.previewItem('bomb', target).valid && wider.state.inventory.bomb === 2, 'a bomb opened by the run is usable');
}

function frostIsUsableWhereOpen() {
  const game = startNodeBattle('three-banners', { inventory: { frost: 1, bomb: 0, healing: 0, fire: 0 } });
  const target = game.state.board.findIndex(cell => !!cell && cell.kind === 'melee');
  assert(target >= 0 && game.state.inventory.frost === 1, 'the run brought one frost flask');
  const before = JSON.stringify(game.captureAnalysisSnapshot());
  assert(game.previewFrost(target).valid && game.previewItem('frost', target).valid && JSON.stringify(game.captureAnalysisSnapshot()) === before,
    'both frost previews are valid and pure');
  assert(game.prepareFrost(target), 'frost live command succeeds');
  assert(game.state.board[target]?.status.frozen === 1 && (game.state.inventory.frost as number) === 0 && game.state.itemPrepared,
    'frost freezes the target and spends exactly one flask');
  assert(!game.previewFrost(target).valid && !game.useItem('frost', target), 'one item per turn remains enforced');
  game.restartLevel();
  assert(JSON.stringify(game.captureAnalysisSnapshot()) === before, 'retry restores flask, status and prepared flag');
}

async function jumpIsGatedByEnergyAndRestart() {
  const game = startNodeBattle('three-banners');
  const target = game.state.board.findIndex((_cell, index) => index !== game.state.player.index && game.previewAbility('jump', index).reason === 'Недостаточно энергии.');
  assert(target >= 0, 'a jump target can be queried at zero energy');
  assert(!game.setAbility('jump') && !game.previewAbility('jump', target).valid && !await game.useAbility('jump', target),
    'an open jump still fails at zero energy');
  assert(game.state.player.energy === 0 && game.state.turn === 0, 'failed jump spends no energy or turn');
  // Earn the energy with a real chain: the longest safe opening chain of the authored board.
  const earning = game.availableMoves(8).filter(path => { const p = game.preview(path); return !p.completesRoom && p.damage === 0 && p.energyGain >= 2; })
    .sort((a, b) => b.length - a.length)[0];
  assert(earning, 'the opening offers a safe chain that earns the jump');
  assert(game.beginChain(earning[0]), 'energy route starts');
  for (const step of earning.slice(1)) assert(game.extendChain(step), 'energy route extends');
  assert(await game.releaseChain() && game.state.player.energy >= 2, 'the ordinary chain earns the jump');
  const landing = game.state.board.findIndex((_cell, index) => game.previewAbility('jump', index).valid);
  assert(landing >= 0, 'an earned jump has a legal landing');
  const before = JSON.stringify(game.captureAnalysisSnapshot()), energy = game.state.player.energy, turn = game.state.turn;
  const preview = game.previewAbility('jump', landing);
  assert(preview.valid && JSON.stringify(game.captureAnalysisSnapshot()) === before, 'jump preview is pure');
  assert(game.setAbility('jump') && await game.useAbility('jump', landing), 'jump selection and live command succeed');
  assert(game.state.player.energy === energy - 2 && game.state.turn === turn + 1 && game.state.lastDamage === preview.damage,
    'jump spends two energy and resolves a turn as forecast');

  const interrupted = startNodeBattle('three-banners'), opening = JSON.stringify(interrupted.state);
  interrupted.state.player.energy = 2;
  const interruptedLanding = interrupted.state.board.findIndex((_cell, index) => interrupted.previewAbility('jump', index).valid);
  assert(interruptedLanding >= 0, 'restart fixture has a valid jump');
  interrupted.subscribe((_state, event) => { if (event.type === 'ability') interrupted.restartLevel(); });
  assert(!await interrupted.useAbility('jump', interruptedLanding), 'restart during jump cancels the old action');
  assert(JSON.stringify(interrupted.state) === opening, 'cancelled jump cannot replay into the fresh battle');
}

await closedToolsStayLocked();
toolsBelongToTheRun();
frostIsUsableWhereOpen();
await jumpIsGatedByEnergyAndRestart();
console.log('PASS node tool gates: closed tools rejected in selection/forecast/execution, run tools per battle, frost and earned jump where open, restart restores and cancels');
