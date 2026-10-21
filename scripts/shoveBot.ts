/**
 * Task 55а «Замок: толчок» (docs/design-notes/task-55-castle-step1a.md, 13): the bots' policy «толчок в цель». A heuristic of the measures,
 * not a rule: the candidates are the chains that end on a thing — the thing alone, or one enemy link before it (the last segment decides
 * the direction); each is drawn by journalled commands, read by `planChain(...).shove` and cancelled. The best one is played when it is
 * worth it: a boss core as the stop first, then the bodies crushed and the tough one struck (killed counts more). Otherwise — nothing (the
 * caller plays its greedy chain). No thing on the arena — no command at all.
 */
import { canLink, planChain } from '../src/realtime/sim/chain';
import { dist } from '../src/realtime/sim/geometry';
import { isThing } from '../src/realtime/sim/shove';
import type { Simulation } from '../src/realtime/sim/simulation';
import type { Enemy } from '../src/realtime/sim/world';

/** The least value a shove must have to be played (two crushed, or one crushed and a struck tough one…). */
export const SHOVE_WORTH = 2;

/** Plays the best shove of the arena now; true — a chain was released. */
export function shoveChain(sim: Simulation): boolean {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return false;
  const things = w.enemies.filter(e => isThing(e) && !w.shoves?.some(s => s.thing === e.id));
  if (!things.length) return false;
  let best: { ids: number[]; value: number } | null = null;
  const tryChain = (links: Enemy[]): void => {
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const l of links.slice(1)) sim.command({ t: 'drag', x: l.x, y: l.y, mode: 'full' });
    const drawn = w.chain.length === links.length && w.chain.every((l, i) => l.id === links[i].id);
    const shove = drawn ? planChain(w).shove : undefined;
    sim.command({ t: 'cancel' });
    if (!shove) return;
    const value = (shove.stop === 'core' && shove.impact ? 10 : 0) + shove.crushed.length + (shove.impact ? (shove.impact.killed ? 1.5 : 0.75) : 0);
    if (!best || value > best.value) best = { ids: links.map(l => l.id), value };
  };
  for (const thing of things) {
    if (canLink(w, thing)) tryChain([thing]);
    // One enemy link before it: the bodies near the thing the hero can take first (at most four).
    const before = w.enemies.filter(e => !isThing(e) && canLink(w, e) && dist(e, thing) < 2.4).sort((a, b) => dist(a, w.hero) - dist(b, w.hero)).slice(0, 4);
    for (const e of before) tryChain([e, thing]);
  }
  const pick = best as { ids: number[]; value: number } | null;
  if (!pick || pick.value < SHOVE_WORTH) return false;
  const links = pick.ids.map(id => w.enemies.find(e => e.id === id)!);
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const l of links.slice(1)) sim.command({ t: 'drag', x: l.x, y: l.y, mode: 'full' });
  return sim.command({ t: 'release' }) === true;
}
