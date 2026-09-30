import { startForestFixture } from './testing/fixtures';

// Consumables on the generic camp fixture (moved from the removed castle-campaign suite on 30.09.2026): the bomb is a
// strong single-target hit, the fire flask applies burning in a cross without impact or friendly damage, one item per
// turn, and a restart from the first burning event cancels the rest of the area effect. Burning ticks and stacks:
// damageEffectsIntegration.spec.ts; tool gates of map nodes: nodeTools.spec.ts.

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

function bombAndFire() {
  const items = startForestFixture();
  items.state.inventory = { frost: 1, bomb: 1, healing: 1, fire: 1 };
  const target = 38, cat = items.state.player.index;
  assert(cat === 45, 'the cat stands on D7 of the camp');
  items.state.board[target]!.hp = items.state.board[target]!.maxHp = 7;
  const before = JSON.stringify(items.captureAnalysisSnapshot());
  const bomb = items.previewItem('bomb', target);
  assert(bomb.indices.join() === String(target) && bomb.damage === 6, 'bomb is stronger single-target damage');
  const fire = items.previewItem('fire', target);
  assert(fire.indices.length === 4 && fire.indices.includes(target) && !fire.indices.includes(cat) && fire.damage === 0,
    'fire applies burning in a cross without impact or friendly damage');
  assert(JSON.stringify(items.captureAnalysisSnapshot()) === before, 'item forecasts are pure');
  assert(items.useItem('fire', target) && items.state.player.hp === 5 && items.state.board[target]?.hp === 7
    && items.state.board[target]?.damageEffects?.burning === 1, 'fire applies one burning stack and preserves current HP');
  assert(!items.useItem('bomb', target) && items.state.inventory.bomb === 1, 'only one item can be prepared per turn');
}

function restartCancelsArea() {
  const cancelFire = startForestFixture(), entry = JSON.stringify(cancelFire.getBoardState());
  cancelFire.state.board[38]!.hp = 1;
  let restarted = false;
  cancelFire.subscribe((_state, event) => { if (event.type === 'status' && !restarted) { restarted = true; cancelFire.restartLevel(); } });
  assert(!cancelFire.useItem('fire', 38) && restarted, 'restart on the first burning application cancels the item');
  assert(JSON.stringify(cancelFire.getBoardState()) === entry && cancelFire.state.inventory.fire === 1,
    'the remaining area effects never reach the fresh board and the flask is back');
}

bombAndFire();
restartCancelsArea();
console.log('PASS items: bomb single target, fire cross without impact, one item per turn, restart cancels the area effect');
