import type { ForestEngine } from './forestEngine';
import { startForestFixture } from './testing/fixtures';
import { applyDamage, physicalDamage } from './combatRules';
import { planEnemyPhase } from './enemyPhase';
import { simulateChain } from './forestSystems';
import { playTurn, type TurnStep } from './turnRuntime';
import type { ForestCell } from './forestTypes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let nextId = 120000;
function cell(kind: ForestCell['kind'] = 'melee', hp = kind === 'melee' ? 0 : 4): ForestCell {
  return { id: nextId++, kind, color: 0, hp, maxHp: hp, armor: 0, countdown: 2,
    status: { wet: false, frozen: 0, brittle: false },
    behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: 'Fixture' } };
}

function fixture(): ForestEngine {
  const game = startForestFixture(701);
  game.state.player.index = 24;
  game.state.terrain.fill('floor');
  game.state.board = Array.from({ length: 49 }, (_, index) => index === 24 ? null : cell('prism', 1));
  return game;
}

async function runtimeCancellation(): Promise<void> {
  for (const boundary of ['event', 'wait'] as const) {
    const trace: string[] = [];
    let current = true;
    function* sequence(): Generator<TurnStep, boolean, void> {
      try {
        trace.push('before');
        yield { event: { type: 'first' } };
        trace.push('after-first');
        yield { delay: 1 };
        trace.push('after-wait');
        yield { event: { type: 'stale' } };
        return true;
      } finally {
        trace.push('closed');
      }
    }
    const result = await playTurn(sequence(), {
      isCurrent: () => current,
      emit: event => { trace.push(event.type); if (boundary === 'event') current = false; },
      wait: async () => { trace.push('wait'); if (boundary === 'wait') current = false; },
    });
    assert(!result, `${boundary}: invalidated turn reports cancellation`);
    assert(!trace.includes('stale') && trace.at(-1) === 'closed', `${boundary}: no stale event and generator closes`);
    assert(boundary === 'event' ? !trace.includes('after-first') && !trace.includes('wait')
      : !trace.includes('after-wait'), `${boundary}: no work runs after invalidation`);
  }

  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const trace: string[] = [];
  let current = true;
  function* delayed(): Generator<TurnStep, boolean, void> {
    try {
      yield { delay: 1 };
      trace.push('resumed');
      yield { event: { type: 'stale' } };
      return true;
    } finally {
      trace.push('closed');
    }
  }
  const turn = playTurn(delayed(), {
    isCurrent: () => current,
    emit: event => trace.push(event.type),
    wait: () => pending,
  });
  current = false;
  release();
  assert(!await turn && trace.join() === 'closed', 'restart while a delay is pending cannot resume the old turn');
  console.log('PASS turn runtime closes invalidated sequences at event and asynchronous wait boundaries');
}

async function attackBeforeSwap(): Promise<void> {
  const game = fixture();
  const attacker = cell(), mover = cell('ranged', 7), partner = cell('melee', 4);
  attacker.behavior.aggressive = true;
  attacker.intent = { cells: [24], damage: 1, label: 'Fixed attack' };
  mover.behavior.restTurns = 1;
  mover.intent.moveTo = 13;
  mover.intent.swapWithId = partner.id;
  game.state.board[17] = attacker;
  game.state.board[20] = mover;
  game.state.board[13] = partner;
  game.state.rotations = [{ from: 20, to: 13, sourceId: mover.id, targetId: partner.id, geometry: 'cardinal' }];
  const events: string[] = [];
  game.subscribe((_state, event) => {
    if (['attack', 'damage', 'enemy-swap', 'hit'].includes(event.type)) events.push(event.type);
  });
  assert(await game.waitTurn(), 'ordered turn completes');
  const attack = events.indexOf('attack'), swap = events.indexOf('enemy-swap');
  assert(attack >= 0 && attack < swap, 'fixed attack resolves before swap');
  assert(game.state.player.hp === 4 && game.state.lastDamage === 1, 'the attack damages the hero exactly once');
  assert(game.state.board[20]?.id === partner.id && game.state.board[13]?.id === mover.id && game.state.board[20]?.hp === 4,
    'the swap exchanges both occupants intact');
  console.log('PASS fixed attacks precede rotation');
}

async function lethalForecastStopsLaterPhases(): Promise<void> {
  const game = fixture();
  game.state.player.hp = 3;
  game.state.board[23] = cell();
  game.state.board[22] = cell();
  for (const index of [15, 21]) {
    const attacker = cell();
    attacker.behavior.aggressive = true;
    attacker.intent = { cells: [22], damage: 2, label: 'Fixed attack' };
    game.state.board[index] = attacker;
  }
  const mover = cell('ranged', 7), partner = cell();
  mover.behavior.restTurns = 1;
  mover.intent.moveTo = 13;
  mover.intent.swapWithId = partner.id;
  game.state.board[20] = mover;
  game.state.board[13] = partner;
  game.state.rotations = [{ from: 20, to: 13, sourceId: mover.id, targetId: partner.id, geometry: 'cardinal' }];

  const path = [23, 22], simulation = simulateChain(game.state, path);
  assert(simulation.preview.valid, 'lethal route is legal');
  const planned = planEnemyPhase(simulation.board, simulation.preview.endIndex);
  assert(planned.attacks.map(attack => attack.index).join() === '15,21'
    && simulation.preview.threats.join() === '15,21', 'forecast and execution planner select the same ordered attackers');
  assert(simulation.preview.damage === 4 && !simulation.preview.rotations[0].active,
    'forecast includes both fixed attacks and cancels the rotation after the lethal phase');

  const events: string[] = [];
  game.subscribe((_state, event) => events.push(event.type));
  assert(game.beginChain(23) && game.extendChain(22), 'lethal route can be committed');
  assert(await game.releaseChain(), 'lethal turn finishes with a loss');
  assert(game.state.phase === 'LOSE' && game.state.player.hp === 0 && game.state.lastDamage === 3,
    'actual damage is capped at remaining health');
  assert(events.filter(type => type === 'attack').length === 2 && !events.includes('enemy-swap'),
  'lethal attack prevents the later rotation phase');
  console.log('PASS enemy forecast matches ordered actor plan; lethal damage stops later phases');
}

async function laterActorUsesCurrentState(): Promise<void> {
  const cases = [
    { name: 'freeze', event: 'attack', initiallyFrozen: false, initialIntent: true, acts: false,
      change: (target: ForestCell) => { target.status.frozen = 1; } },
    { name: 'rest', event: 'damage', initiallyFrozen: false, initialIntent: true, acts: false,
      change: (target: ForestCell) => { target.behavior.restTurns = 1; } },
    { name: 'thaw', event: 'damage', initiallyFrozen: true, initialIntent: true, acts: true,
      change: (target: ForestCell) => { target.status.frozen = 0; } },
    { name: 'remove intent', event: 'damage', initiallyFrozen: false, initialIntent: true, acts: false,
      change: (target: ForestCell) => { target.intent.cells = []; } },
    { name: 'add intent', event: 'attack', initiallyFrozen: false, initialIntent: false, acts: true,
      change: (target: ForestCell) => { target.intent.cells = [24]; } },
  ];
  for (const scenario of cases) {
    const game = fixture(), first = cell(), later = cell();
    first.behavior.aggressive = true;
    first.intent = { cells: [24], damage: 1, label: 'First' };
    later.behavior.aggressive = true;
    later.status.frozen = scenario.initiallyFrozen ? 1 : 0;
    later.intent = { cells: scenario.initialIntent ? [24] : [], damage: 1, label: 'Later' };
    game.state.board[17] = first;
    game.state.board[23] = later;
    const attacks: number[] = [];
    let changed = false;
    game.subscribe((_state, event) => {
      if (event.type === 'attack') attacks.push(event.from!);
      if (!changed && event.from === 17 && event.type === scenario.event) {
        changed = true;
        scenario.change(later);
      }
    });
    assert(await game.waitTurn(), `${scenario.name}: turn completes`);
    assert(changed && attacks.join() === (scenario.acts ? '17,23' : '17'),
      `${scenario.name}: later actor rechecks its current status and announced intent`);
    assert(game.state.player.hp === (scenario.acts ? 3 : 4), `${scenario.name}: damage matches actual attackers`);
  }
  console.log('PASS later actors recheck frozen, rest and intent after earlier attack callbacks');
}

function damageSources(): void {
  const physical = cell('boss', 12);
  physical.status.brittle = true;
  const physicalAmount = physicalDamage(physical, 4);
  const physicalHit = applyDamage(physical, physicalAmount, 'physical');
  assert(physicalAmount === 8 && physicalHit.hpAfter === 4 && !physical.status.brittle,
    'physical hit doubles brittle damage and consumes the status');

  for (const source of ['item', 'hazard'] as const) {
    const target = cell('boss', 12);
    target.status.brittle = true;
    const outcome = applyDamage(target, source === 'item' ? 6 : 2, source);
    assert(outcome.hpAfter === (source === 'item' ? 6 : 10) && target.status.brittle,
      `${source} damage leaves brittle for a later physical hit`);
  }

  console.log('PASS physical, item and hazard damage keep distinct brittle semantics');
}

async function animationTimingDoesNotChangeRules(): Promise<void> {
  const immediate = fixture(), animated = fixture();
  const attacker = cell();
  attacker.behavior.aggressive = true;
  attacker.intent = { cells: [24], damage: 1, label: 'Fixed attack' };
  immediate.state.board[17] = attacker;
  immediate.state.board[0] = null;
  animated.state = structuredClone(immediate.state);
  animated.animationScale = 0.01;
  const firstEvents: string[] = [], secondEvents: string[] = [];
  immediate.subscribe((_state, event) => firstEvents.push(JSON.stringify(event)));
  animated.subscribe((_state, event) => secondEvents.push(JSON.stringify(event)));
  assert(await immediate.waitTurn() && await animated.waitTurn(), 'both timing modes finish the same action');
  const runtime = (game: ForestEngine) => game as unknown as { rng: number; nextId: number };
  assert(JSON.stringify(immediate.state) === JSON.stringify(animated.state)
    && firstEvents.join() === secondEvents.join()
    && runtime(immediate).rng === runtime(animated).rng
    && runtime(immediate).nextId === runtime(animated).nextId,
  'presentation delay does not change events, game state or the next generated entity');
  console.log('PASS zero and animated timing produce identical rules, events and generation state');
}

async function restartAtHitAndSpawn(): Promise<void> {
  const hit = fixture();
  hit.state.board[17] = cell();
  hit.state.board[10] = cell();
  let hitEvents = 0, hitSnapshot = '';
  hit.subscribe((_state, event) => {
    if (event.type === 'hit') {
      hitEvents++;
      if (hitEvents === 1) { hit.restartLevel(); hitSnapshot = JSON.stringify(hit.state); }
    }
  });
  assert(hit.beginChain(17) && hit.extendChain(10), 'two-hit chain is legal');
  assert(!await hit.releaseChain() && hitEvents === 1 && JSON.stringify(hit.state) === hitSnapshot,
    'restart during the first hit prevents the second hit and all stale mutations');

  const spawn = fixture();
  spawn.state.board[0] = null;
  let spawnEvents = 0, staleEvents = 0, spawnSnapshot = '';
  spawn.subscribe((_state, event) => {
    if (spawnEvents && event.type !== 'start') staleEvents++;
    if (event.type === 'spawn' && !spawnEvents) {
      spawnEvents++;
      spawn.restartLevel();
      spawnSnapshot = JSON.stringify(spawn.state);
    }
  });
  assert(!await spawn.waitTurn() && spawnEvents === 1 && staleEvents === 0
    && JSON.stringify(spawn.state) === spawnSnapshot,
  'restart on refill spawn prevents old turn from publishing further events or mutating the fresh scene');
  console.log('PASS restart at player hit and refill spawn cancels remaining work');
}

await runtimeCancellation();
await attackBeforeSwap();
await lethalForecastStopsLaterPhases();
await laterActorUsesCurrentState();
damageSources();
await animationTimingDoesNotChangeRules();
await restartAtHitAndSpawn();
