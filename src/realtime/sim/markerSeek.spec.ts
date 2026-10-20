/**
 * «Метка у героя» (codex-idea-enemy-behavior-variety.md, 13; council 20.10.2026): a spawn marker the hero comes near
 * (`spawnMinDistance`) moves away; when the random search finds no place (`findAnchor`, `pointNear`), the old path gave the marker its
 * whole warning again every tick and the enemy never came while the hero stood there. `Params.markerSeek` (sim/spawn.ts): the marker
 * then takes the free point nearest to it by a bounded scan of the arena (the spawn rectangle on a big one) with a whole warning
 * there; no free point anywhere — it waits where it is, its timer neither runs nor starts again. Node only:
 * `npm run test:realtime-marker-seek`.
 *
 * Every check plays journalled commands (walk, teleport) on test fields:
 * - «Проём»: walls along every edge but a gap in the west one — the edges are the random search's only places; the hero walks to
 *   the marker at the gap: with the key the enemy comes out inside the field within a bound, off the hero's ring; without it —
 *   the defect: no enemy, the marker's whole warning again and again;
 * - «Тесно»: every free point within the hero's ring — with the key the marker waits, its timer held (not started again), and the
 *   enemy comes out after the rest of it once the hero walks away;
 * - the run: a new run keeps the flag `markerSeek` (its battles play the key), a save without it — the key off;
 * - every fight replays from its journal to its hash. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { wall } from './geometry';
import { defaultParams, type Params } from './params';
import { replay, Simulation, SIM_DT } from './simulation';
import type { World } from './world';
import { createRtRun, parseRtRun, rtArenaParams, rtRunParams, serializeRtRun } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3, 4, 5, 6];
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

registerArena({
  id: 'marker-seek-gap', name: 'Проём (тест меток)', summary: 'Тест: метка у героя', goal: 'kills', killGoal: 999, width: 14, height: 8,
  heroStart: { x: 5, y: 4 }, obstacles: [wall(0, 0, 14, 1), wall(0, 7, 14, 1), wall(13, 0, 1, 8), wall(0, 0, 1, 2.5), wall(0, 5.5, 1, 2.5)],
  buttons: [], door: { x: 12, y: 4 }, enemies: [],
});
registerArena({
  id: 'marker-seek-tight', name: 'Тесно (тест меток)', summary: 'Тест: метка у героя', goal: 'kills', killGoal: 999, width: 14, height: 8,
  // A room in the west (x 0–5, y 3–5) and a corridor east of it 0.6 wide (the hero's body passes, an enemy's does not): standing
  // at x 3 the hero has every free point of the room within his ring.
  heroStart: { x: 5.6, y: 4 }, obstacles: [wall(0, 0, 14, 3), wall(0, 5, 14, 3), wall(5, 3, 9, 0.7), wall(5, 4.3, 9, 0.7)],
  buttons: [], door: { x: 12, y: 4 }, enemies: [],
});

/** One newcomer and no more (the floor 1, no groups), nobody walks, no touch. */
function quiet(seek: boolean | undefined): Params {
  const p = { ...defaultParams(), heroHp: 999, hitstop: false, enemySpeed: 0, contactDamage: 0, baseFloor: 1, baseIntervalMin: 1e6, baseIntervalMax: 1e6, reaperEnabled: false };
  if (seek === undefined) delete (p as Partial<Params>).markerSeek; else (p as Params).markerSeek = seek;
  return p;
}
/** Walks the hero west until he stands at `stopX` (real walking); `each` sees the world every tick. */
function walkWest(sim: Simulation, stopX: number, seconds: number, each: (w: World) => void = () => {}): void {
  const w = sim.world;
  sim.command({ t: 'walk', x: -1, y: 0 });
  let walking = true;
  for (let i = 0; i < ticksOf(seconds); i++) {
    sim.tick();
    w.events.length = 0;
    if (walking && w.hero.x <= stopX) { sim.command({ t: 'walk', x: 0, y: 0 }); walking = false; }
    each(w);
  }
}

check('«Проём»: the hero walks to the marker at the gap — with the key the enemy comes out inside the field within 2.5 s of his arrival, off his ring; without it (the defect) no enemy in 12 s, the marker\'s whole warning again and again', () => {
  for (const k of SEEDS) {
    for (const seek of [true, false]) {
      const sim = new Simulation({ arena: 'marker-seek-gap', params: quiet(seek), seed: seedOf(k), record: true }), w = sim.world;
      let arrived = -1, first = -1, held = 0;
      const firstAt = { x: NaN, y: NaN };
      walkWest(sim, 1.6, 12, wd => {
        if (arrived < 0 && wd.hero.x <= 1.6) arrived = wd.time;
        if (first < 0 && wd.enemies.length) { first = wd.time; firstAt.x = wd.enemies[0].x; firstAt.y = wd.enemies[0].y; }
        if (wd.markers.some(m => m.timeLeft === m.total && Math.hypot(m.x - wd.hero.x, m.y - wd.hero.y) < wd.params.spawnMinDistance)) held++;
      });
      assert(arrived > 0, `seed ${k}: the hero arrived`);
      if (seek) {
        assert(first > 0 && first - arrived <= 2.5, `seed ${k}: with the key the enemy came out ${first < 0 ? 'never' : `${(first - arrived).toFixed(2)} s after the arrival`}`);
        assert(Math.hypot(firstAt.x - w.hero.x, firstAt.y - w.hero.y) >= w.params.spawnMinDistance, `seed ${k}: off the hero's ring (${JSON.stringify(firstAt)})`);
      } else {
        assert(first < 0 && w.enemies.length === 0 && held > ticksOf(8), `seed ${k}: without the key — the old path (enemies ${w.enemies.length}, held ${held} ticks)`);
      }
      assert(replays(sim), `seed ${k}, key ${seek}: replay`);
    }
  }
});

check('«Тесно»: no free point outside the hero\'s ring — with the key the marker waits where it is, its timer held (not started again); the hero walks away — the enemy comes out within its warning (the rest held, or a whole one at a place freed on the way); a journal without the key plays the old path', () => {
  for (const k of SEEDS) {
    for (const seek of [true, undefined]) {
      const sim = new Simulation({ arena: 'marker-seek-tight', params: quiet(seek), seed: seedOf(k), record: true }), w = sim.world;
      // The markers come in the room (its only free places out of the hero's ring) and count down a little.
      for (let i = 0; i < ticksOf(3) && !w.markers.length; i++) { sim.tick(); w.events.length = 0; }
      for (let i = 0; i < ticksOf(0.3); i++) { sim.tick(); w.events.length = 0; }
      assert(w.markers.length >= 1 && w.markers.every(m => m.timeLeft < m.total - 0.2), `seed ${k}: markers counting (${w.markers.map(m => m.timeLeft)})`);
      // The hero steps into the room's middle: every free point is within his ring.
      sim.command({ t: 'teleport', x: 3, y: 4 });
      sim.tick(); w.events.length = 0;
      const at = w.markers.map(m => ({ m, left: m.timeLeft }));
      for (let i = 0; i < ticksOf(1.5); i++) { sim.tick(); w.events.length = 0; }
      assert(w.enemies.length === 0, `seed ${k}, key ${seek}: nobody came out in the ring (${w.enemies.length})`);
      if (seek) assert(at.every(({ m, left }) => w.markers.includes(m) && m.timeLeft === left && left < m.total), `seed ${k}: the timers held (${at.map(a => `${a.left} → ${a.m.timeLeft}`)})`);
      else assert(w.markers.every(m => m.timeLeft === m.total), `seed ${k}: without the key — the whole warning again (${w.markers.map(m => m.timeLeft)})`);
      // The hero walks back east: the marker comes out — with the key after the rest of its warning.
      const rest = Math.min(...at.map(a => a.left));
      sim.command({ t: 'walk', x: 1, y: 0 });
      let left = -1, out = -1;
      for (let i = 0; i < ticksOf(4) && out < 0; i++) {
        sim.tick(); w.events.length = 0;
        if (left < 0 && w.markers.every(m => Math.hypot(m.x - w.hero.x, m.y - w.hero.y) >= w.params.spawnMinDistance)) left = w.time;
        if (w.enemies.length) out = w.time;
      }
      assert(out > 0 && left > 0, `seed ${k}, key ${seek}: the enemy came out after the hero left`);
      // With the key: the rest of the held warning, or a whole warning at a place freed on the way (never more).
      if (seek) assert(out - left <= Math.max(rest, w.params.markerDelay) + 0.05, `seed ${k}: within the warning (${(out - left).toFixed(2)}, the rest ${rest.toFixed(2)})`);
      assert(replays(sim), `seed ${k}, key ${seek}: replay`);
    }
  }
});

check('the run: a new run keeps the flag `markerSeek` and its battles play the key; a run created without it (a save before it) — the key off; the save reads back, a malformed flag — no run; a real run fight with it replays', () => {
  for (const k of SEEDS) {
    const run = createRtRun(seedOf(k)), old = createRtRun(seedOf(k), { markerSeek: false });
    assert(run.markerSeek === true && old.markerSeek === undefined, `seed ${k}: the flag (${run.markerSeek}, ${old.markerSeek})`);
    assert(rtArenaParams(run, rtRunParams(defaultParams())).markerSeek === true && !rtArenaParams(old, rtRunParams(defaultParams())).markerSeek, `seed ${k}: the battles' key`);
    const back = parseRtRun(serializeRtRun(run));
    assert(back?.markerSeek === true && JSON.stringify(back) === JSON.stringify(run), `seed ${k}: the save reads back`);
    assert(parseRtRun(serializeRtRun({ ...run, markerSeek: 1 as unknown as true })) === null, `seed ${k}: a malformed flag — no run`);
  }
  // A real fight of a run with the flag (its first node's arena, the run's params): the hero stands; the journal keeps the key.
  const run = createRtRun(seedOf(1)), params = rtArenaParams(run, rtRunParams(defaultParams()));
  const sim = new Simulation({ arena: 'glade', params, seed: seedOf(1), record: true });
  for (let i = 0; i < ticksOf(10); i++) sim.tick();
  assert(sim.exportJournal()!.params.markerSeek === true && replays(sim), 'the run fight replays with the key');
});

console.log(`marker seek: ${checks} checks passed`);
