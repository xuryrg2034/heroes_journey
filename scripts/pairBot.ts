/**
 * Task 59б (the bot of the step-3 measures, docs/realtime-elite-behaviors.md, «Арены шага 3»): the «planner» of the wardens' pair — a
 * heuristic of the measures, not a rule. The greedy chain of scripts/loopBot.ts `playChain` with two changes while a pair stands:
 * - the chain of the pair's colour A leans to the warden A (each next link the one nearest it); a warden of a standing pair becomes a
 *   link only once the chain holds `colorShiftLinks` − 1 links (it is the link that frees the colour; «Смена цвета» off — whenever), and
 *   the partner comes next at once when it can;
 * - before the release the bot reads the game's own highlight: a chain that would anger a warden (`planChain(...).anger`) is cancelled,
 *   and the bot draws the greedy chain again without the pair's wardens.
 * No pair standing — exactly `playChain`. The «careless» bot is `playChain` itself (scripts/garrisonBot.ts without `pairs`).
 */
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { WARDEN, wardenPartner } from '../src/realtime/sim/enemies/warden';
import { dist, type Vec } from '../src/realtime/sim/geometry';
import type { Simulation } from '../src/realtime/sim/simulation';
import type { Enemy, World } from '../src/realtime/sim/world';
import { playChain } from './loopBot';

/** A warden whose pair still stands. */
const paired = (w: World, e: Enemy): boolean => e.kind === WARDEN && !!wardenPartner(w, e);

/** The pair's chain of `sim` (see the file's comment): 1 — a chain was released. */
export function pairChain(sim: Simulation): number {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return 0;
  if (!w.enemies.some(e => paired(w, e))) return playChain(sim);
  return attempt(sim, true) || attempt(sim, false);
}

/** One drawing; `wardens` false — the pair's wardens are never links. 0 — nothing released (cancelled or nothing to begin). */
function attempt(sim: Simulation, wardens: boolean): number {
  const w = sim.world, shift = w.params.colorShiftLinks ?? 0;
  const allowed = (e: Enemy): boolean => !paired(w, e) || (wardens && (shift <= 0 || w.chain.length >= shift - 1 || !!w.chain.find(l => l.kind === 'enemy' && l.id === wardenPartner(w, e)?.id)));
  const first = nextCandidates(w).filter(allowed).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return 0;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w), enemies = nextCandidates(w).filter(allowed);
    const lastLink = w.chain[w.chain.length - 1], last = lastLink.kind === 'enemy' ? w.enemies.find(e => e.id === lastLink.id) : undefined;
    const partner = last && paired(w, last) ? wardenPartner(w, last) : undefined;
    // The warden of the chain's colour, when a pair stands (the lower id draws A): the chain leans to it.
    const lead = wardens && last ? w.enemies.find(e => paired(w, e) && e.color === last.color && e.id < (wardenPartner(w, e)?.id ?? 0)) : undefined;
    const next = (partner && enemies.includes(partner) ? partner : undefined)
      ?? [...enemies, ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => (lead ? dist(a, lead) - dist(b, lead) : dist(a, from) - dist(b, from)))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  if (planChain(w).anger?.length) { sim.command({ t: 'cancel' }); return 0; }
  sim.command({ t: 'release' });
  return 1;
}
