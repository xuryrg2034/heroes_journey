/**
 * Loop research, step 2 (experiment `loopHint`, docs/realtime-loop-research.md, section 3.2): the best closable figure from the
 * hero, for a faint highlight before the first link. VIEW ONLY: it reads the world and never writes to it, and nothing of
 * the simulation depends on it. Adapted from scripts/measure-loops.ts (figures б and а): an arc of 3–5 enemies of one colour
 * closed on the hero (`hero`), or a 4-cycle of one colour with a corner in the hero's reach (`first`); the best figure is
 * the one with the most bodies inside. Not counted (as in the measure): a shield's guard, a tough link that would survive,
 * crystals as corners. Cost is capped: only the nearest `MAX_BODIES` same-colour bodies are searched, and the view calls
 * it at most every few frames.
 */
import { linkRadiusOf } from '../sim/build';
import { enemyArtRadius, kindOf } from '../sim/enemies/kinds';
import { dist, insidePolygon, lineOfSight, type Vec } from '../sim/geometry';
import { loopMinOf } from '../sim/seal';
import { NO_COLOR, type Enemy, type LoopKind, type World } from '../sim/world';

export interface LoopHintFigure { kind: LoopKind; color: number; ring: Vec[]; inside: number }

/** The longest arc searched (the measure's 3–5). */
const MAX_ARC = 5;
/** Search cap: the nearest bodies to the hero, per colour. */
const MAX_BODIES = 18;

export function findLoopHint(world: World): LoopHintFigure | null {
  const p = world.params;
  if (!p.loopEnabled || world.status !== 'playing' || world.move || world.chain.length) return null;
  const R = linkRadiusOf(world), hero: Vec = { x: world.hero.x, y: world.hero.y };
  const bodies = world.enemies.filter(e => !kindOf(e).immune);
  const reach = (from: Vec, to: Enemy): boolean =>
    dist(from, to) <= R + (p.linkToEdge ? enemyArtRadius(p, to) : 0) && (!p.lineOfSight || lineOfSight(from, to, world.arena, -p.sightSlack));
  const countIn = (ring: Vec[], skip: ReadonlySet<number>): number => bodies.filter(e => !skip.has(e.id) && insidePolygon(ring, e)).length;
  const minFirst = loopMinOf(p, 'first'), minHero = loopMinOf(p, 'hero');
  let best: LoopHintFigure | null = null;
  const offer = (kind: LoopKind, color: number, path: Enemy[], ring: Vec[]): void => {
    const n = countIn(ring, new Set(path.map(e => e.id)));
    if (n >= 1 && (!best || n > best.inside)) best = { kind, color, ring: ring.map(v => ({ x: v.x, y: v.y })), inside: n };
  };
  const colors = new Set(bodies.filter(e => e.color !== NO_COLOR && kindOf(e).chainable).map(e => e.color));
  for (const color of colors) {
    const links = bodies.filter(e => e.color === color && kindOf(e).chainable)
      .sort((a, b) => dist(a, hero) - dist(b, hero)).slice(0, MAX_BODIES);
    const start = new Set(links.filter(e => reach(hero, e)).map(e => e.id));
    if (!start.size) continue;
    const adj = new Map<number, Enemy[]>(links.map(e => [e.id, []]));
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
      const a = links[i], b = links[j];
      if (reach(a, b) || reach(b, a)) { adj.get(a.id)!.push(b); adj.get(b.id)!.push(a); }
    }
    // (б) arcs closed on the hero: the first and the last link in the hero's reach.
    const path: Enemy[] = [];
    const walk = (): void => {
      const k = path.length, last = path[k - 1];
      if (p.loopHeroCloses && k >= minHero && start.has(last.id)) offer('hero', color, path, [hero, ...path]);
      if (k >= MAX_ARC) return;
      for (const next of adj.get(last.id)!) {
        if (path.includes(next)) continue;
        path.push(next); walk(); path.pop();
      }
    };
    for (const first of links) if (start.has(first.id)) { path.push(first); walk(); path.pop(); }
    // (а) 4-cycles a-b-c-d with a corner the hero can take first (the loop closes on it).
    if (minFirst <= 4) for (const a of links) {
      for (const b of adj.get(a.id)!) for (const d of adj.get(a.id)!) {
        if (b.id >= d.id) continue;
        for (const c of adj.get(b.id)!) {
          if (c.id === a.id || c.id === d.id || !adj.get(d.id)!.some(x => x.id === c.id)) continue;
          const cyc = [a, b, c, d];
          if (cyc.some(v => start.has(v.id))) offer('first', color, cyc, cyc);
        }
      }
    }
  }
  return best;
}
