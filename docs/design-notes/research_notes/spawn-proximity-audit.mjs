// Diagnostic fixtures, not production arenas or acceptance tests.
// Run from the repository root: node --import tsx docs/design-notes/research_notes/spawn-proximity-audit.mjs
import assert from 'node:assert/strict';
import { registerArena } from '../../../src/realtime/sim/arenas.ts';
import { defaultParams } from '../../../src/realtime/sim/params.ts';
import { Simulation, replay } from '../../../src/realtime/sim/simulation.ts';

for (const [id, width, height, heroStart] of [
  ['audit-spawn-open', 16, 10, { x: 8, y: 5 }],
  ['audit-spawn-small', 4, 4, { x: 0.5, y: 0.5 }],
]) registerArena({ id, name: id, summary: 'Diagnostic fixture', width, height, heroStart,
  obstacles: [], buttons: [], enemies: [], goal: 'kills', killGoal: 999, door: { x: width - 0.5, y: 0.5 } });

function make(arena, k) {
  const params = Object.assign(defaultParams(), {
    baseFloor: 1, baseIntervalMin: 1000, baseIntervalMax: 1000,
    groupMin: 1, groupMax: 1, baseWolfShare: 0, baseBoarShare: 0,
    spawnGroupHold: true, enemySpeed: 0, contactDamage: 0, heroHp: 999,
  });
  return new Simulation({ arena, seed: Math.imul(k, 2654435761) >>> 0, params, record: true });
}
function step(sim, count) { for (let i = 0; i < count; i++) sim.tick(); }
function verifyReplay(sim) { assert.equal(replay(sim.exportJournal()).hash(), sim.hash()); }
function walkTo(sim, point) {
  const h = sim.world.hero, dx = point.x - h.x, dy = point.y - h.y;
  const distance = Math.hypot(dx, dy);
  sim.command({ t: 'walk', x: dx / distance, y: dy / distance });
  step(sim, Math.round(distance / sim.world.params.heroSpeed * 60));
  sim.command({ t: 'walk', x: 0, y: 0 });
}

const open = [];
for (let k = 1; k <= 8; k++) {
  const baseline = make('audit-spawn-open', k);
  step(baseline, 240);
  verifyReplay(baseline);
  const sim = make('audit-spawn-open', k);
  sim.tick();
  const marker = sim.world.markers[0];
  assert.ok(marker);
  const original = { x: marker.x, y: marker.y };
  const dx = marker.x - sim.world.hero.x, dy = marker.y - sim.world.hero.y, d = Math.hypot(dx, dy);
  sim.command({ t: 'walk', x: dx / d, y: dy / d });
  let relocation = null;
  for (let t = 0; t < 180; t++) {
    const before = { x: marker.x, y: marker.y, timeLeft: marker.timeLeft };
    sim.tick();
    if (marker.x !== original.x || marker.y !== original.y) {
      relocation = { at: +sim.world.time.toFixed(3), previousTimeLeft: +before.timeLeft.toFixed(3), resetTimeLeft: marker.timeLeft };
      break;
    }
    if (!sim.world.markers.includes(marker)) break;
  }
  sim.command({ t: 'walk', x: 0, y: 0 });
  step(sim, 180);
  verifyReplay(sim);
  open.push({ k, baselineEnemies: baseline.world.enemies.length, relocation, eventualEnemies: sim.world.enemies.length });
}

const constrained = [];
for (let k = 1; k <= 8; k++) {
  const sim = make('audit-spawn-small', k);
  // Some seeds need a second tick to sample the small admissible corner.
  for (let t = 0; t < 30 && !sim.world.markers.length; t++) sim.tick();
  assert.ok(sim.world.markers.length);
  walkTo(sim, { x: 2, y: 2 });
  step(sim, 300);
  const blocked = { enemies: sim.world.enemies.length, markers: sim.world.markers.length,
    queue: sim.world.queue.length, timeLeft: sim.world.markers[0]?.timeLeft, total: sim.world.markers[0]?.total };
  assert.equal(blocked.enemies, 0);
  assert.equal(blocked.timeLeft, blocked.total);
  walkTo(sim, { x: 0.5, y: 0.5 });
  step(sim, 180);
  assert.ok(sim.world.enemies.length > 0);
  verifyReplay(sim);
  constrained.push({ k, blockedAfterFiveSeconds: blocked, enemiesAfterLeaving: sim.world.enemies.length });
}
console.log(JSON.stringify({ note: 'Synthetic fixtures; defaults radius=3 and markerDelay=1; stationary enemies, one newcomer, Node replay only.', open, constrained }, null, 2));
