/**
 * ECS stage 2: the turn schedule (docs/ecs-architecture.md §3.4). The order of systems is a game rule; the schedule
 * stops on a cancelled or finished turn; a synchronous drain yields the same events and state as live playback.
 */
import { instant, runSchedule, type SystemSet, type TurnSystem } from './ecs/schedule';
import { ForestEngine } from './forestEngine';
import type { EngineEvent } from './forestTypes';
import { drainSync } from './turnRuntime';
import { BOARD_UPDATE, END_OF_TURN, ENEMY_PHASE, ITEM_ACTION, PLAYER_ACTION, resolveRestTurn, type TurnContext } from './turnSystems';
import { forestFixtureLevel, nodeBattleSetup } from './testing/fixtures';

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
const names = (set: SystemSet<TurnContext>) => set.systems.map(system => system.name).join(' ');

function order() {
  assert(names(PLAYER_ACTION) === 'ChainResolve ChainEndTerrain DeviceVolleys PlayerVictory', `PlayerAction: ${names(PLAYER_ACTION)}`);
  assert(names(ENEMY_PHASE) === 'EnemyPhaseStart PhaseSnapshot BoarCharges EnemyAttacks ShamanRites CycleCounters TrollWindups GoalRefresh Rotations RestCountdown DamageEffectTicks TrollRegen ClosePits',
    `EnemyPhase: ${names(ENEMY_PHASE)}`);
  assert(names(END_OF_TURN) === 'SettleTurn ChestDrop' && names(BOARD_UPDATE) === 'Reinforcements Generation ReinforcementAnnounce ReturnToInput', 'EndOfTurn and BoardUpdate');
  assert(names(ITEM_ACTION) === 'ItemResolve ItemVictory ItemRefill', `ItemAction: ${names(ITEM_ACTION)}`);
  console.log('PASS the schedule keeps the documented phase order');
}

function semantics() {
  type Ctx = { log: string[]; verdict: 'continue' | 'finished' | 'cancelled' };
  const step = (name: string, result = true): TurnSystem<Ctx> => ({ name, *run(ctx) { ctx.log.push(name); yield { event: { type: name } }; return result; } });
  const set: SystemSet<Ctx> = { name: 'S', systems: [step('a'), instant<Ctx>('b', ctx => { ctx.log.push('b'); }), step('c')] };
  const run = (ctx: Ctx, systems = [set]) => drainSync(runSchedule(ctx, systems, current => current.verdict));
  const all: Ctx = { log: [], verdict: 'continue' };
  const whole = run(all);
  assert(whole.result && all.log.join() === 'a,b,c' && whole.events.map(event => event.type).join() === 'a,c', 'systems run in order; instant systems yield nothing');
  const finished: Ctx = { log: [], verdict: 'finished' };
  assert(run(finished).result && finished.log.join() === 'a', 'a finished verdict stops the schedule and returns true');
  const cancelled: Ctx = { log: [], verdict: 'cancelled' };
  assert(!run(cancelled).result && cancelled.log.join() === 'a', 'a cancelled verdict stops the schedule and returns false');
  const failing: Ctx = { log: [], verdict: 'continue' };
  assert(!run(failing, [{ name: 'F', systems: [step('x', false), step('y')] }]).result && failing.log.join() === 'x', 'a system returning false cancels the rest');
  let resumed = 0;
  const stopped = drainSync((function* () { yield { event: { type: 'one' } }; resumed++; yield { event: { type: 'two' } }; return true; })(), () => resumed === 0);
  assert(!stopped.result && stopped.events.length === 1, 'drainSync stops when isCurrent turns false');
  console.log('PASS schedule verdicts: continue, finished, cancelled, system cancellation; drainSync stops on isCurrent');
}

/** A drained Rest turn (no clocks) equals live playback: same events, same final state, RNG and IDs. */
async function drainEqualsPlayback() {
  const starts: [string, () => ForestEngine][] = [
    ['camp fixture', () => { const g = new ForestEngine(); g.animationScale = 0; g.startCustomLevel(forestFixtureLevel(83)); return g; }],
    ['troll lair', () => { const g = new ForestEngine(); g.animationScale = 0; g.startRunBattle(nodeBattleSetup('troll-lair', { seed: 5 })); return g; }],
  ];
  for (const [name, start] of starts) {
    for (let turns = 0; turns < 3; turns++) {
      const live = start(), drained = start();
      for (let n = 0; n < turns; n++) { await live.waitTurn(); await drained.waitTurn(); }
      const events: EngineEvent[] = [];
      live.subscribe((_state, event) => events.push({ ...event }));
      await live.waitTurn();
      // Since stage 3 every event of a turn passes through the sequence (the refill `spawn` included): no subscription needed.
      let published = 0;
      drained.subscribe(() => { published++; });
      const context = (drained as unknown as { turnContext(): TurnContext }).turnContext();
      const result = drainSync(resolveRestTurn(context));
      const drainedEvents = result.events.map(event => ({ ...event }));
      assert(published === 0, `${name} turn ${turns + 1}: a drained turn publishes nothing directly`);
      const view = (g: ForestEngine) => JSON.stringify({ state: g.state, rng: (g as unknown as { rng: number }).rng, nextId: (g as unknown as { nextId: number }).nextId });
      assert(result.result && JSON.stringify(drainedEvents) === JSON.stringify(events), `${name} turn ${turns + 1}: drained events equal the published ones`);
      assert(view(drained) === view(live), `${name} turn ${turns + 1}: drained world equals the played one`);
    }
  }
  console.log('PASS drainSync of a Rest turn equals live playback (events, state, RNG, IDs)');
}

/**
 * ECS stage 7: consumables run as the ItemAction set, synchronously. A restart from a subscriber at any event of an
 * item cancels it the same way: the stale item reports `false` (before, an item cancelled at its last event — frost's
 * only `frost`, the final `state` of the others — reported `true`) and nothing of it reaches the new scene.
 */
function itemsThroughTheSchedule() {
  const start = () => {
    const g = new ForestEngine(); g.animationScale = 0;
    assert(g.startRunBattle(nodeBattleSetup('trunk-wake', { allowedItems: ['frost', 'bomb', 'fire', 'healing'], inventory: { frost: 1, bomb: 1, healing: 1, fire: 1 } })), 'battle starts');
    // Healing with poison: its cleansing publishes a `status` before the item event.
    g.state.player.hp = 3; g.state.player.damageEffects = { burning: 0, burningTurns: 0, poison: 2, bleeding: 0, bleedingSteps: 0 };
    return g;
  };
  for (const item of ['frost', 'bomb', 'fire', 'healing'] as const) {
    const probe = start(), target = item === 'healing' ? probe.state.player.index : probe.state.board.findIndex(cell => cell && cell.kind !== 'door' && cell.kind !== 'prism');
    let total = 0; probe.subscribe(() => { total++; });
    assert(probe.useItem(item, target) === true && total > 0, `${item}: used without a restart`);
    // A restart with no item at all: the scene the cancelled item must leave behind (position, RNG, IDs).
    const reference = start(); reference.restartLevel();
    const expected = JSON.stringify(reference.captureAnalysisSnapshot());
    for (let k = 1; k <= total; k++) {
      const g = start();
      let count = 0, restarted = false;
      const late: string[] = [];
      g.subscribe((_state, event) => { if (restarted) { late.push(event.type); return; } if (++count === k) { restarted = true; g.restartLevel(); } });
      assert(g.useItem(item, target) === false, `${item}: a restart at event ${k} of ${total} cancels it`);
      assert(late.join() === 'start' && JSON.stringify(g.captureAnalysisSnapshot()) === expected,
        `${item}: nothing of the stale item reaches the restarted scene at event ${k} (late: ${late.join()})`);
    }
  }
  console.log('PASS items run as the ItemAction set; a restart at any event cancels frost, bomb, fire and healing alike');
}

async function main() {
  order();
  semantics();
  itemsThroughTheSchedule();
  await drainEqualsPlayback();
  console.log('PASS ecs schedule');
}
main().catch(error => { console.error(error); throw error; });
