/**
 * Which off-screen things get a pointer on the border of the view (docs/realtime-stage3.md, section 11). View only: reads
 * the world through the same signal functions the renderer draws from (`archerLine`, `lynxLine`, …); no rules of its own.
 *
 * - dangers aimed at the hero, shown at their source when it is off screen: the boar's lane (windup, charge), the
 *   archer's line, the lynx's leap line, a wolf's rush line (howl, rush; phase A), the lit fuse of a sapper and a bomb on
 *   the ground (only when the blast circle reaches the view), the shaman's beam (only when its target is on screen or near
 *   the hero — otherwise noise);
 * - goals of the arena: marked enemies, buttons not pressed, the open door;
 * - spawn markers (phase A, Т5; design answer 9 of docs/realtime-phase-a.md): only when `spawns` is on — the arena is
 *   larger than the view. On an arena that fits the view every marker is on screen anyway.
 */
import { lynxLine } from '../sim/enemies/lynx';
import { archerLine } from '../sim/enemies/archer';
import { sapperFuse } from '../sim/enemies/sapper';
import { shamanBeam } from '../sim/enemies/shaman';
import { wolfRushLine } from '../sim/enemies/wolf';
import { doorOpen, type World } from '../sim/world';

export type EdgeKind = 'threat' | 'goal' | 'spawn';
export interface EdgeMarker { x: number; y: number; kind: EdgeKind }

/** The shaman's beam is worth a pointer when its target is within this many units of the hero (or on screen). */
const BEAM_NEAR_HERO = 4;
/** A source counts as off screen when its centre is outside the view (a half-visible body still gets the pointer: its line is the danger). */
const SEEN_MARGIN = 0;

/** `sees(point, margin)` — the point is inside the view grown by `margin` units; `spawns` — pointers to spawn markers too. */
export function collectEdgeMarkers(world: World, sees: (p: { x: number; y: number }, margin: number) => boolean, spawns = false): EdgeMarker[] {
  const out: EdgeMarker[] = [];
  const threat = (p: { x: number; y: number }): void => { if (!sees(p, SEEN_MARGIN)) out.push({ x: p.x, y: p.y, kind: 'threat' }); };
  for (const e of world.enemies) {
    if (e.kind === 'boar' && (e.boar === 'windup' || e.boar === 'charge')) threat(e);
    else if (archerLine(world, e) || lynxLine(world, e) || wolfRushLine(world, e)) threat(e);
    else if (sapperFuse(world, e)) { if (sees(e, world.params.sapperRadius) && !sees(e, SEEN_MARGIN)) threat(e); }
    else {
      const beam = shamanBeam(world, e);
      if (beam && (sees(beam.target, 0) || Math.hypot(beam.target.x - world.hero.x, beam.target.y - world.hero.y) <= BEAM_NEAR_HERO)) threat(e);
    }
    if (e.marked && !sees(e, SEEN_MARGIN)) out.push({ x: e.x, y: e.y, kind: 'goal' });
  }
  for (const b of world.blasts) if (sees(b, world.params.sapperRadius) && !sees(b, SEEN_MARGIN)) threat(b);
  const open = doorOpen(world);
  for (const o of world.objects) {
    if (o.kind === 'button' && !o.pressed && !sees(o, SEEN_MARGIN)) out.push({ x: o.x, y: o.y, kind: 'goal' });
    else if (o.kind === 'door' && open && !sees(o, SEEN_MARGIN)) out.push({ x: o.x, y: o.y, kind: 'goal' });
  }
  if (spawns) for (const m of world.markers) if (!sees(m, SEEN_MARGIN)) out.push({ x: m.x, y: m.y, kind: 'spawn' });
  return out;
}
