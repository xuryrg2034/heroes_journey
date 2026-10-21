/**
 * «Дыры ядра боссов» in the run (core's decision 21.10.2026): a new run keeps the flag `bossHoles` and its fights play the core's
 * wards (`BOSS_HOLE_KEYS`: the Troll's and the Chief's, the warlock's); a save without the flag plays the old paths. Node only: `npm run test:realtime-boss-holes`.
 *
 * Everything goes through the run's own commands (enter, resolve, choose) to the den boss — «Берлога тролля» — and, for the fight,
 * the world the run starts (its params, loadout and seed) with journalled commands (teleport, place, chill):
 * - a new run: the flag, the save reads it back; the fight's world has the three keys on; a fiery elite's trail over the Troll's
 *   closed core rings (`block`), the core keeps its HP;
 * - a save without the flag (before the task): no flag in it, read back the same; the fight's values have no key of the task (the
 *   world hashes them as before), the trail burns the closed core — the old path; a malformed flag — no run;
 * - every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 * The plates are 0 in the fights (the trail never burns a plated core): the check is of the trail on a bare core.
 */
import { TROLL, TROLL_CLUB, TROLL_ROCK } from '../sim/enemies/troll';
import { BOSS_HOLE_KEYS } from '../sim/params';
import { replay, Simulation, SIM_DT } from '../sim/simulation';
import type { Enemy, World, WorldEvent } from '../sim/world';
import {
  createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtEnterNode, rtNode, rtRunParams, serializeRtRun,
  type RtArenaOutcome, type RtRunState,
} from './rtRun';
import { assert, closeNode, ok, quiet, same, seedOf } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const SEEDS = [1, 2, 3, 4, 5];

const pendingOf = (run: RtRunState): { nodeId: string; arena: string; seed: number } => run.pending as { nodeId: string; arena: string; seed: number };
const fakeWin = (run: RtRunState): RtRunState => {
  const outcome: RtArenaOutcome = { nodeId: pendingOf(run).nodeId, won: true, hp: run.maxHp, kills: 20, damage: 0, time: 60 };
  return ok(resolveArena(run, outcome), 'resolve');
};
/** The run walks by its own commands (battles won without a fight, screens closed simply) to the den boss's battle. */
function toDenBoss(run: RtRunState, k: number): RtRunState {
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      if (rtNode(run, pending.nodeId)!.type === 'boss') return run;
      run = fakeWin(run);
    } else if (pending) run = closeNode(run);
    else {
      const next = rtAvailableNodes(run);
      run = ok(rtEnterNode(run, (next.find(n => n.id.startsWith('den-')) ?? next[(k + step) % next.length]).id), 'enter');
    }
  }
  throw new Error(`seed ${k}: no boss node`);
}

/** The fight the run starts, the hero south of the core, a fiery elite walking past the closed core (the club and the rock frozen). */
function trailFight(run: RtRunState, k: number): { sim: Simulation; core: Enemy; events: WorldEvent[] } {
  const { arena, seed } = pendingOf(run);
  assert(arena === 'troll', `seed ${k}: the den boss plays «Берлога тролля» (${arena})`);
  const params = rtArenaParams(run, rtRunParams(quiet({ enemySpeed: 1, trailRadius: 1.6, trollPlates: 0, heroHp: 999 })));
  const sim = new Simulation({ arena, params, seed, loadout: rtArenaLoadout(run), record: true }), w = sim.world;
  sim.tick();
  const of = (world: World, kind: string): Enemy => world.enemies.find(e => e.kind === kind)!;
  const core = of(w, TROLL);
  for (const part of [of(w, TROLL_CLUB), of(w, TROLL_ROCK)]) sim.command({ t: 'chill', id: part.id, seconds: 600 });
  sim.command({ t: 'teleport', x: core.x + 0.9, y: core.y + 6 });
  sim.command({ t: 'place', x: core.x + 0.9, y: core.y + 0.6, color: 0, hp: 3, kind: 'basic', elite: true, affixes: ['fiery'] });
  w.events.splice(0);
  const events: WorldEvent[] = [];
  for (let i = 0; i < Math.round(4 / SIM_DT) && w.status === 'playing'; i++) { sim.tick(); events.push(...w.events.splice(0)); }
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `seed ${k}: the fight replays from its journal`);
  return { sim, core, events };
}
const burned = (events: readonly WorldEvent[], core: Enemy): number => events.filter(e => e.type === 'enemyHit' && e.enemyId === core.id && e.source === 'fire-trail').length;

check('a new run: the flag, the save reads it back; the den boss\'s fight has the core\'s wards — the trail rings on the closed core, its HP stays', () => {
  for (const k of SEEDS) {
    const run = toDenBoss(createRtRun(seedOf(k), { gift: 'mini' }), k);
    assert(run.bossHoles === true && same(parseRtRun(serializeRtRun(run)), run), `seed ${k}: the flag read back`);
    const { sim, core, events } = trailFight(run, k), p = sim.world.params;
    assert(BOSS_HOLE_KEYS.every(key => p[key] === true), `seed ${k}: the fight's keys on (${BOSS_HOLE_KEYS.map(key => p[key]).join(', ')})`);
    const hp = sim.world.params.trollHp;
    assert(core.hp === hp && burned(events, core) === 0, `seed ${k}: the core whole (${core.hp} of ${hp})`);
    assert(events.some(e => e.type === 'trollWindow' && e.action === 'block' && e.source === 'fire-trail'), `seed ${k}: the trail rings`);
  }
});

check('a save without the flag (before the task): read back the same; the fight\'s values have no key of the task, the trail burns the closed core — the old path; a malformed flag — no run', () => {
  for (const k of SEEDS) {
    const fresh = createRtRun(seedOf(k), { gift: 'mini', bossHoles: false });
    assert(fresh.bossHoles === undefined && !serializeRtRun(fresh).includes('bossHoles'), `seed ${k}: no flag in the old save`);
    const run = toDenBoss(parseRtRun(serializeRtRun(fresh))!, k);
    const { sim, core, events } = trailFight(run, k), p = sim.world.params;
    assert(BOSS_HOLE_KEYS.every(key => !(key in p)), `seed ${k}: no key of the task in the fight's values`);
    assert(core.hp < sim.world.params.trollHp && burned(events, core) > 0, `seed ${k}: the trail burns the closed core (${core.hp})`);
    assert(parseRtRun(serializeRtRun({ ...fresh, bossHoles: 'yes' as unknown as true })) === null, `seed ${k}: a malformed flag`);
  }
});

console.log(`boss holes in the run: ${checks} checks passed`);
