import type { ForestEngine } from './forestEngine';
import { startForestFixture } from './testing/fixtures';
import { meleeCanAttack, meleeLifecycle, MELEE_AGGRESSION_START_TURN } from './enemyLifecycle';
import { prepareIntents } from './forestSystems';
import type { ForestCell } from './forestTypes';

function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
let nextId = 90000;
function unit(kind: ForestCell['kind'] = 'melee'): ForestCell {
  const hp = kind === 'melee' ? 0 : 4;
  return { id: nextId++, kind, hp, maxHp: hp, color: 0, armor: 0, countdown: 2,
    status: { wet: false, frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' } };
}
function fixture(index = 17) {
  const g = startForestFixture(701);
  g.state.player.index = 24; g.state.player.energy = 0; g.state.terrain.fill('floor');
  g.state.board = Array.from({ length: 49 }, (_, i) => i === 24 ? null : unit('prism'));
  g.state.board[index] = unit(); prepareIntents(g.state);
  return { g, enemy: g.state.board[index]! };
}
async function commit(g: ForestEngine, path: number[]) {
  assert(g.beginChain(path[0]), 'chain starts'); for (const index of path.slice(1)) assert(g.extendChain(index), 'chain extends');
  assert(await g.releaseChain(), 'chain commits');
}
async function completeCycle() {
  const { g, enemy } = fixture(); assert(MELEE_AGGRESSION_START_TURN === 1 && meleeLifecycle(enemy) === 'calm', 'ordinary recruitment still begins after first action');
  await g.waitTurn(); assert(meleeLifecycle(enemy) === 'prepared' && meleeCanAttack(enemy) && g.state.player.hp === 5, 'preparation is visible for a full player input');
  const trace: string[] = [], unsubscribe = g.subscribe((_state, event) => {
    if (event.type === 'attack') {
      trace.push('windup'); assert(g.state.player.hp === 5 && enemy.behavior.aggressive && enemy.behavior.restTurns === 0, 'windup neither damages nor calms early');
      assert(g.state.phase === 'ENEMY_RESOLVE' && event.from === 17 && event.to === 24, 'fixed windup target is published');
    }
    if (event.type === 'damage') {
      trace.push('impact'); assert(g.state.player.hp === 4 && !enemy.behavior.aggressive && enemy.behavior.restTurns === 1, 'native impact applies damage and starts recovery exactly once');
    }
    if (event.type === 'enemy-recovery') {
      trace.push('recovery'); assert(g.state.player.hp === 4 && meleeLifecycle(enemy) === 'recovering', 'native attack-end follows the actual impact');
    }
  });
  const first = g.waitTurn(); assert(!await g.waitTurn() && !g.beginChain(17), 'enemy phase rejects repeated input');
  assert(await first, 'prepared attack resolves'); unsubscribe();
  assert(trace.join(',') === 'windup,impact,recovery', 'substate0 true result cannot skip state1 impact or duplicate damage');
  assert(g.state.player.energy === 1 && g.state.turn === 2 && meleeLifecycle(enemy) === 'recovering' && !enemy.intent.cells.length, 'one rest energy gain per turn and visibly calm recovery input');
  await g.waitTurn(); assert(g.state.player.hp === 4 && enemy.behavior.restTurns === 0 && meleeLifecycle(enemy) === 'prepared', 'one full recovery enemy phase before aggression can return');
  console.log('PASS complete calm/preparation/windup/native impact/attack-end/recovery cycle, event order, one impact and input lock');
}
async function missFreezeAndPressure() {
  const miss = fixture(0); miss.enemy.behavior.aggressive = true;
  miss.g.state.board[1] = unit(); miss.g.state.board[2] = unit(); prepareIntents(miss.g.state);
  let impacts = 0; miss.g.subscribe((_state, event) => { if (event.type === 'attack' || event.type === 'damage' || event.type === 'enemy-recovery') impacts++; });
  await miss.g.waitTurn(); await miss.g.waitTurn();
  assert(impacts === 0 && miss.enemy.behavior.aggressive && miss.g.state.board.filter(cell => cell?.behavior.aggressive).length === 3, 'missed fixed attacks preserve anger as pressure accumulates');
  const frozen = fixture(); frozen.enemy.behavior.aggressive = true; frozen.enemy.status.frozen = 1; prepareIntents(frozen.g.state);
  assert(meleeLifecycle(frozen.enemy) === 'frozen' && !meleeCanAttack(frozen.enemy) && !frozen.enemy.intent.cells.length, 'frozen visibility/action gate agrees with newly prepared intent');
  await frozen.g.waitTurn(); assert(frozen.g.state.player.hp === 5 && frozen.enemy.behavior.aggressive && meleeLifecycle(frozen.enemy) === 'prepared', 'freeze skips attack without consuming aggression');
  await frozen.g.waitTurn(); assert(frozen.g.state.player.hp === 4 && frozen.enemy.behavior.restTurns === 1, 'thawed prepared enemy resumes attack');
  frozen.enemy.status.frozen = 1; await frozen.g.waitTurn();
  assert(frozen.g.state.player.hp === 4 && frozen.enemy.behavior.restTurns === 1 && meleeLifecycle(frozen.enemy) === 'recovering', 'freeze pauses recovery countdown');
  await frozen.g.waitTurn(); assert(frozen.g.state.player.hp === 4 && meleeLifecycle(frozen.enemy) === 'prepared', 'recovery completes only in an unfrozen phase');
  console.log('PASS persistent missed anger, cumulative recruitment, frozen action/visibility and paused recovery');
}
async function forecastParity() {
  for (const state of ['prepared', 'calm', 'frozen', 'recovering'] as const) {
    const { g, enemy } = fixture(15); g.state.board[23] = unit(); g.state.board[22] = unit();
    enemy.behavior.aggressive = state !== 'calm'; enemy.status.frozen = state === 'frozen' ? 1 : 0; enemy.behavior.restTurns = state === 'recovering' ? 1 : 0;
    // A stale footprint cannot override lifecycle authority in preview or execution.
    enemy.intent = { cells: [22], damage: 2, label: 'Fixed custom damage' };
    const snapshot = JSON.stringify(g.state), rng = (g as unknown as { rng: number }).rng;
    const preview = g.preview([23, 22]); assert(preview.valid && preview.damage === (state === 'prepared' ? 2 : 0), `${state} actionable predicate controls forecast`);
    g.preview([23, 22]); assert(JSON.stringify(g.state) === snapshot && (g as unknown as { rng: number }).rng === rng, 'forecast never advances lifecycle or RNG');
    await commit(g, [23, 22]); assert(g.state.lastDamage === preview.damage && g.state.player.hp === 5 - preview.damage, `${state} committed custom damage matches forecast`);
  }
  const diagonal = fixture(16); diagonal.enemy.behavior.aggressive = true; prepareIntents(diagonal.g.state);
  await diagonal.g.waitTurn(); assert(diagonal.g.state.player.hp === 5 && diagonal.enemy.behavior.aggressive, 'ordinary melee remains cardinal and cannot hit diagonal hero');
  console.log('PASS lifecycle-aware pure forecast/commit parity, custom intent damage and cardinal attacks');
}
async function cancellation() {
  for (const boundary of ['attack', 'damage', 'enemy-recovery']) {
    const { g, enemy } = fixture(); enemy.behavior.aggressive = true; prepareIntents(g.state);
    let restarts = 0, staleAfterRestart = 0, snapshot = '';
    g.subscribe((_state, event) => {
      if (restarts && event.type !== 'start') staleAfterRestart++;
      if (!restarts && event.type === boundary) { restarts++; g.restartLevel(); snapshot = JSON.stringify(g.state); }
    });
    assert(!await g.waitTurn(), `restart at ${boundary} cancels old enemy phase`);
    assert(restarts === 1 && staleAfterRestart === 0 && JSON.stringify(g.state) === snapshot && g.state.turn === 0 && g.state.player.hp === 5, `${boundary} callback cannot mutate fresh scene`);
  }
  console.log('PASS reentrant restart at windup/impact/recovery cancels all stale mutations and events');
}
await completeCycle(); await missFreezeAndPressure(); await forecastParity(); await cancellation();
