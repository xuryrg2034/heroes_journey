/**
 * Task 59б (the bot of the step-3 measures; spec docs/design-notes/task-59-garrison-step3.md, 13: the bot must leave the mark, find the
 * chain by the numbers, find the chain through the colour shift to the pair; docs/realtime-elite-behaviors.md, «Арены шага 3») — a
 * heuristic of the measures, not a rule. The greedy chain of scripts/loopBot.ts `playChain` with the step-3 skills (the mark — the pot
 * dodge, scripts/shotDodge.ts `potDodge`):
 * - **the numbers** (both modes): the chain begins at a recruit whose number is current (the law lets no other be a candidate — the
 *   refusal `order`) when one is within reach, and after a recruit goes on to the next number of its formation when it can — the
 *   route 1 → 4 instead of the nearest body;
 * - **the pair** (`planner` only): the chain of the pair's colour A leans to the warden A (each next link the one nearest it); a warden
 *   of a standing pair becomes a link only when it frees the colour (`colorShiftLeft` 1: «Смена цвета» with the build's links, as the
 *   view's «до смены N») or its partner is in the chain already; the partner comes next at once; before the release the bot reads the
 *   game's own highlight — a chain that angers a warden (`planChain(...).anger`) is cancelled and the greedy chain goes without the pair.
 * No numbered recruit and no pair for the planner — exactly `playChain` (the same commands). The «careless» bot (no `planner`) takes the
 * wardens as any enemy.
 */
import { chainAnchor, colorShiftLeft, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { RECRUIT, recruitGroup, recruitNumber } from '../src/realtime/sim/enemies/recruit';
import { WARDEN, wardenPartner } from '../src/realtime/sim/enemies/warden';
import { dist, type Vec } from '../src/realtime/sim/geometry';
import type { Simulation } from '../src/realtime/sim/simulation';
import type { Enemy, World } from '../src/realtime/sim/world';
import { playChain } from './loopBot';

/** A warden whose pair still stands. */
const paired = (w: World, e: Enemy): boolean => e.kind === WARDEN && !!wardenPartner(w, e);
/** A recruit with its number drawn (the law of order on). */
const numbered = (e: Enemy): boolean => recruitNumber(e) > 0;
/** How the drawing treats the wardens of a standing pair: `pair` — the planner's way, `avoid` — never links, `free` — as any enemy. */
type Wardens = 'pair' | 'avoid' | 'free';

/** The step-3 chain of `sim` (see the file's comment); `planner` — the pair's planner. 1 — a chain was released. */
export function step3Chain(sim: Simulation, planner: boolean): number {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return 0;
  const pair = planner && w.enemies.some(e => paired(w, e));
  if (!pair && !w.enemies.some(numbered)) return playChain(sim);
  return pair ? attempt(sim, 'pair') || attempt(sim, 'avoid') : attempt(sim, 'free');
}

/** One drawing. 0 — nothing released (cancelled, or nothing to begin). */
function attempt(sim: Simulation, wardens: Wardens): number {
  const w = sim.world;
  const allowed = (e: Enemy): boolean => {
    if (wardens === 'free' || !paired(w, e)) return true;
    if (wardens === 'avoid') return false;
    const partner = wardenPartner(w, e);
    return w.chain.some(l => l.kind === 'enemy' && l.id === partner?.id) || colorShiftLeft(w) === 1;
  };
  const near = (from: Vec) => (a: Vec, b: Vec): number => dist(a, from) - dist(b, from);
  const starts = nextCandidates(w).filter(allowed).sort(near(w.hero));
  const first = starts.find(numbered) ?? starts[0];
  if (!first) return 0;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w), enemies = nextCandidates(w).filter(allowed);
    const lastLink = w.chain[w.chain.length - 1], last = lastLink.kind === 'enemy' ? w.enemies.find(e => e.id === lastLink.id) : undefined;
    // The pair: the partner of the warden just taken; the numbers: the next of the recruit just taken.
    const partner = wardens === 'pair' && last && paired(w, last) ? wardenPartner(w, last) : undefined;
    const drill = last?.kind === RECRUIT ? enemies.filter(e => e.kind === RECRUIT && recruitGroup(e) === recruitGroup(last)).sort(near(from))[0] : undefined;
    // The warden of the chain's colour while a pair stands (the lower id draws A): the chain leans to it.
    const lead = wardens === 'pair' && last ? w.enemies.find(e => paired(w, e) && e.color === last.color && e.id < (wardenPartner(w, e)?.id ?? 0)) : undefined;
    const next = (partner && enemies.includes(partner) ? partner : undefined) ?? drill
      ?? [...enemies, ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort(near(lead ?? from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  if (wardens === 'pair' && planChain(w).anger?.length) { sim.command({ t: 'cancel' }); return 0; }
  sim.command({ t: 'release' });
  return 1;
}
