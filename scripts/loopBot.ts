/**
 * The bot and the arenas of the field measures (scripts/measure-loops.ts, scripts/realtime-style-change.ts): the run's
 * params made harmless, an arena that never ends, the greedy chain of the specs' bots, the run's 12 arenas and the seeds.
 * A heuristic for the design, not a test.
 */
import type { ArenaTemplate } from '../src/realtime/sim/arenas';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { dist, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import type { Simulation } from '../src/realtime/sim/simulation';
import { ARENA_POOLS, FINAL_ARENA, HARD_ARENA } from '../src/realtime/run/arenaPools';
import { rtRunParams } from '../src/realtime/run/rtRun';

/** Seeds of the measures: `Math.imul(k, 2654435761) >>> 0`. */
export const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** The run's params, harmless: the hero cannot fall. */
export function harmlessRunParams(): Params {
  const p = rtRunParams(defaultParams());
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  return p;
}

/** The arena without an end: a kill goal out of reach, the door off the field. */
export const endless = (a: ArenaTemplate): ArenaTemplate => ({ ...a, id: `${a.id}-loops`, killGoal: a.goal === 'kills' ? 100000 : a.killGoal, door: { x: -100, y: -100 } });

/** The greedy chain of the bots of the specs (sliceArenas.spec.ts, realtime-big-arenas.ts): 1 — a chain was released. */
export function playChain(sim: Simulation): number {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return 0;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return 0;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
  return 1;
}

/** The run's 12 arenas: the pools, «Застава», «Последний рубеж». */
export const RUN_ARENAS: readonly string[] = [...ARENA_POOLS.map(e => e.arena), HARD_ARENA, FINAL_ARENA];
