import { ForestEngine } from './forestEngine';
import { validateCustomLevel, type CustomLevelDefinition } from './customLevel';
import { simulateChain, rotationPreview } from './forestSystems';
import { applyDamageEffect } from './damageEffects';
import { applyDeviceVolley } from './devices';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition { if (!condition) throw new Error(message); }
namespace assert {
  export function equal(actual: unknown, expected: unknown, message = 'Values differ') { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
}

function definition(kind: 'arrows' | 'fire' = 'arrows'): CustomLevelDefinition {
  return { version: 1, name: 'Devices', seed: 808, cols: 5, rows: 5, terrain: Array(25).fill('floor'), heroIndex: 21,
    enemies: Array.from({ length: 25 }, (_, index) => ({ index, kind: 'melee' as const, color: (index === 16 || index === 18 ? 0 : 1) as 0 | 1, hp: 0 }))
      .filter(enemy => ![21, 17].includes(enemy.index)), devices: [{ index: 17, kind, charges: 2, targets: kind === 'arrows' ? [10, 11, 12, 13, 14] : [] }],
    doors: [], goals: [{ key: 'kills', target: 999 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 0, 0, 0], extraColors: [] };
}
function fixture(kind: 'arrows' | 'fire' = 'arrows') {
  const game = new ForestEngine(); game.animationScale = 0;
  assert(game.startCustomLevel(definition(kind)));
  game.state.board.forEach(cell => { if (cell) { cell.behavior.passive = true; cell.intent.cells = []; } });
  return game;
}
async function chain(game: ForestEngine, path = [16, 17, 18]) {
  assert(game.beginChain(path[0]));
  for (const index of path.slice(1)) assert(game.extendChain(index), `extend ${index}`);
  assert(await game.releaseChain());
}

async function run() {
  const game = fixture(), initial = JSON.stringify(game.state);
  const preview = game.preview([16, 17, 18]);
  assert(preview.valid); assert.equal(preview.enemies, 2); assert.equal(preview.energyGain, 1);
  assert.equal(preview.hits.length, 2); assert.equal(preview.hits[1].availablePower, 2);
  assert.equal(preview.trapKills, 5); assert.equal(preview.deviceActivations?.length, 1);
  assert.equal(JSON.stringify(game.state), initial, 'preview is pure');
  assert(!game.beginChain(17)); assert(!game.preview([16, 17]).valid);
  assert(!game.preview([16, 17, 18, 17]).valid);
  game.state.board[18]!.color = 1; assert(!game.preview([16, 17, 18]).valid, 'device preserves color'); game.state.board[18]!.color = 0;
  assert(game.beginChain(16)); assert(game.extendChain(17)); game.cancelChain(); assert.equal(game.state.devices[0].charges, 2);
  const events: string[] = []; game.subscribe((_state, event) => events.push(event.type));
  await chain(game); assert.equal(game.state.objective.kills, 7); assert.equal(game.state.devices[0].charges, 1);
  assert.equal(game.state.board[17], null, 'refill protects device');
  assert(events.indexOf('trap') < events.indexOf('enemy-turn'));
  game.restartLevel(); assert.equal(game.state.devices[0].charges, 2); assert.equal(game.state.turn, 0);

  const exhausted = fixture(); exhausted.state.devices[0].charges = 0;
  await chain(exhausted); assert.equal(exhausted.state.objective.kills, 2); assert.equal(exhausted.state.board[17], null);
  exhausted.state.rotations = [{ from: 17, to: 18, sourceId: 1, targetId: 2, geometry: 'cardinal' }];
  assert(!rotationPreview(exhausted.state)[0].active);

  // Two enemies can finish on a point without granting a third hit.
  const endpoint = fixture(); endpoint.state.board[11]!.color = 0;
  const finish = endpoint.preview([16, 11, 17]); assert(finish.valid); assert.equal(finish.endIndex, 17); assert.equal(finish.enemies, 2);
  await chain(endpoint, [16, 11, 17]); assert.equal(endpoint.state.player.index, 17);

  const fire = fixture('fire'); fire.state.player.attackEffect = 'poison'; fire.state.board[18]!.hp = fire.state.board[18]!.maxHp = 4;
  const fireSimulation = simulateChain(fire.state, [16, 17, 18]);
  assert.equal(fireSimulation.board[18]?.hp, 2, 'fire has no impact damage');
  assert.equal(fireSimulation.board[18]?.damageEffects?.burning, 1);
  assert.equal(fireSimulation.board[18]?.damageEffects?.poison ?? 0, 0, 'temporary source overrides permanent effect');
  await chain(fire); assert.equal(fire.state.board[18]?.hp, 1, 'fire ticks after attacks');
  assert.equal(fire.state.player.attackEffect, 'poison');
  fire.state.board[13]!.color = 0; fire.state.board[14]!.color = 0; fire.state.board[14]!.hp = fire.state.board[14]!.maxHp = 5;
  const next = simulateChain(fire.state, [13, 14]); assert(next.preview.valid);
  assert.equal(next.board[14]?.damageEffects?.burning ?? 0, 0); assert.equal(next.board[14]?.damageEffects?.poison, 1);

  const death = fixture(); death.state.player.hp = 4; death.state.devices[0].targets = [18]; death.state.customLevel!.definition.goals[0].target = 2;
  const lethal = death.preview([16, 17, 18]); assert(lethal.playerDies); assert.equal(lethal.trapDamage, 4); assert(!lethal.completesRoom);
  await chain(death); assert.equal(death.state.phase, 'LOSE', 'trap death precedes goal victory');

  const doorway = fixture();
  doorway.state.customLevel!.definition.completion = 'exit'; doorway.state.customLevel!.definition.goals[0].target = 2;
  const door = doorway.state.board[19]!; door.kind = 'door'; door.color = null; door.hp = door.maxHp = 1;
  door.door = { branch: 'forward', label: 'Exit', destination: 'forest', magic: true, breached: false, footprint: [19] };
  doorway.state.devices[0].targets = [19]; doorway.state.player.hp = 4;
  assert(doorway.preview([16, 17, 18, 19]).playerDies);
  await chain(doorway, [16, 17, 18, 19]); assert.equal(doorway.state.phase, 'LOSE', 'door waits for lethal queued volley');

  const bleedAfter = fixture(); bleedAfter.state.player.hp = 1;
  bleedAfter.state.player.damageEffects = applyDamageEffect(undefined, 'bleeding');
  const bleedEvents: string[] = []; bleedAfter.subscribe((_state, event) => bleedEvents.push(event.type));
  const after = bleedAfter.preview([16, 17, 18]); assert(after.playerDies); assert.equal(after.trapKills, 0);
  await chain(bleedAfter); assert.equal(bleedAfter.state.devices[0].charges, 1); assert(!bleedEvents.includes('trap'), 'movement death stops trap queue');

  const attacker = fixture(); const enemy = attacker.state.board[13]!; enemy.hp = enemy.maxHp = 4; enemy.behavior.passive = false; enemy.behavior.aggressive = true; enemy.intent = { cells: [18], damage: 2, label: 'attack' };
  assert.equal(attacker.preview([16, 17, 18]).damage, 0); await chain(attacker); assert.equal(attacker.state.player.hp, 5, 'trap removes attacker before its attack');

  const multiple = fixture(); multiple.state.board[12] = null; multiple.state.devices.push({ index: 12, kind: 'arrows', charges: 1, targets: [18] });
  multiple.state.devices[0].targets = [18]; multiple.state.player.hp = 5;
  const double = multiple.preview([16, 17, 12, 18]); assert.equal(double.trapDamage, 5); assert(double.playerDies);
  await chain(multiple, [16, 17, 12, 18]); assert.equal(multiple.state.phase, 'LOSE');

  const bleed = fixture('fire'); bleed.state.player.hp = 1;
  bleed.state.player.damageEffects = { ...applyDamageEffect(undefined, 'bleeding')!, bleedingSteps: 2 };
  const b = bleed.preview([16, 17, 18]); assert(b.valid && b.playerDies); assert.equal(b.deviceActivations?.length, 0);
  await chain(bleed); assert.equal(bleed.state.devices[0].charges, 2, 'death before device does not spend charge');

  for (const type of ['device', 'trap', 'boss-phase']) {
    const reset = fixture(); let restarted = false;
    if (type === 'boss-phase') { const boss = reset.state.board[10]!; boss.kind = 'boss'; boss.variant = 'wizard'; boss.hp = boss.maxHp = 1; boss.bossStage = 1; }
    const emitted: string[] = [];
    reset.subscribe((_state, event) => emitted.push(event.type));
    reset.subscribe((_state, event) => { if (!restarted && event.type === type) { restarted = true; reset.restartLevel(); } });
    assert(reset.beginChain(16)); assert(reset.extendChain(17)); assert(reset.extendChain(18)); assert.equal(await reset.releaseChain(), false);
    assert(restarted); assert.equal(emitted[emitted.length - 1], 'start', 'no stale events after restart'); assert.equal(reset.state.turn, 0); assert.equal(reset.state.devices[0].charges, 2); assert.equal(reset.state.player.hp, 5);
  }

  const volley = fixture(); const large = volley.state.board[10]!; large.hp = large.maxHp = 9; large.footprint = [10, 11]; volley.state.board[11] = large;
  const impacts = [...applyDeviceVolley(volley.state, volley.state.devices[0])]; assert.equal(large.hp, 5); assert.equal(impacts.filter(impact => impact.cell?.id === large.id).length, 1);
  volley.state.board[12] = { ...volley.state.board[2]!, id: 9000 };
  const wizard = volley.state.board[12]!; wizard.kind = 'boss'; wizard.variant = 'wizard'; wizard.bossStage = 1; wizard.hp = wizard.maxHp = 1;
  [...applyDeviceVolley(volley.state, { index: 17, kind: 'arrows', charges: 1, targets: [12] })]; assert.equal(wizard.bossStage, 2); assert.equal(wizard.hp, 24);
  volley.state.terrain[11] = 'wall'; const hp = wizard.hp;
  [...applyDeviceVolley(volley.state, { index: 17, kind: 'arrows', charges: 1, targets: [10, 11, 12] })]; assert.equal(wizard.hp, hp, 'wall stops ray');

  const jump = fixture('fire'); jump.state.player.energy = 7; assert(await jump.useAbility('jump', 17)); assert.equal(jump.state.devices[0].charges, 2); assert.equal(jump.state.player.index, 17);
  for (const patch of [{ index: 16 }, { index: 21 }, { charges: -1 }, { targets: [100] }, { targets: [10, 10] }, { targets: [10, 12] }, { targets: [4, 5] }, { targets: [10, 11, 16] }, { kind: 'pit' }, { damage: 0 }]) {
    const invalid = definition(); Object.assign(invalid.devices![0], patch); assert(!validateCustomLevel(invalid).valid, JSON.stringify(patch));
  }
  // A dangerous partial endpoint is not a dangerous completed chain.
  const corridor = definition();
  corridor.cols = corridor.rows = 4;
  corridor.terrain = Array.from({ length: 16 }, (_, i) => i >= 12 ? 'floor' : 'wall');
  corridor.heroIndex = 12;
  corridor.enemies = [13, 15].map(index => ({ index, kind: 'melee', color: 0, hp: 0 }));
  corridor.devices = [{ index: 14, kind: 'arrows', charges: 1, targets: [14], damage: 5 }];
  corridor.goals = [{ key: 'kills', target: 2 }];
  const escape = new ForestEngine(); escape.animationScale = 0;
  assert(escape.startCustomLevel(corridor), 'generation finds a chain through a lethal partial lever endpoint');
  assert(simulateChain(escape.state, [13,14], true).preview.playerDies, 'stopping at the lever would be lethal');
  assert.equal(escape.preview([13,14,15]).damage, 0, 'continuing leaves the arrow line before the volley');
  await chain(escape, [13,14,15]);
  assert.equal(escape.state.phase, 'WIN'); assert.equal(escape.state.player.hp, 5);
  console.log('PASS device traversal, budget, preview/live, traps, fire scope, death priority, restart, generation and parser');
}
void run();
