/**
 * Which off-screen things get a pointer on the border of the view (docs/realtime-stage3.md, section 11). View only: reads
 * the world through the same signal functions the renderer draws from (`archerLine`, `lynxLine`, …); no rules of its own.
 *
 * - dangers aimed at the hero, shown at their source when it is off screen: the boar's lane (windup, charge), the
 *   archer's line (old path) or its mark — the circle, when no part of it is in view, at the circle's centre (phase A, Т6), the lynx's leap line, a wolf's rush line (howl, rush; phase A), the lit fuse of a sapper and a bomb on
 *   the ground (only when the blast circle reaches the view), the shaman's beam (only when its target is on screen or near
 *   the hero — otherwise noise);
 * - goals of the arena: marked enemies, buttons not pressed, the open door;
 * - spawn markers (phase A, Т5; design answer 9 of docs/realtime-phase-a.md): only when `spawns` is on — the arena is
 *   larger than the view. On an arena that fits the view every marker is on screen anyway.
 */
import { lynxLine } from '../sim/enemies/lynx';
import { archerLine, archerMark } from '../sim/enemies/archer';
import { sapperFuse } from '../sim/enemies/sapper';
import { shamanBeam } from '../sim/enemies/shaman';
import { wolfRushLine } from '../sim/enemies/wolf';
import { CHIEF } from '../sim/enemies/chief';
import { TROLL } from '../sim/enemies/troll';
import { WARLOCK } from '../sim/enemies/warlock';
import { doorOpen, type Enemy, type World } from '../sim/world';

export type EdgeKind = 'threat' | 'goal' | 'spawn';
export interface EdgeMarker { x: number; y: number; kind: EdgeKind }

/** The shaman's beam is worth a pointer when its target is within this many units of the hero (or on screen). */
const BEAM_NEAR_HERO = 4;
/** A source counts as off screen when its centre is outside the view (a half-visible body still gets the pointer: its line is the danger). */
const SEEN_MARGIN = 0;

/** The cores whose window is the fight (task 55 Д, design 21.10.2026): the Troll's, the Chief's and the warlock's. */
export const hudBossCore = (e: Pick<Enemy, 'kind' | 'partOf'>): boolean => (e.kind === TROLL || e.kind === CHIEF || e.kind === WARLOCK) && e.partOf === undefined;

/** The visible area of the stage in px: inside the HUD above, the action bar below and the sides (`edgeInset`). */
export interface VisibleArea { x0: number; y0: number; x1: number; y1: number }

/**
 * The boss core cannot be taken (design 21.10.2026): the centre of his ring — the point the player clicks — is outside the visible area
 * (under the HUD or the bar, or off the sides). A drawing cut by the HUD whose ring is in view is no reason for a pointer.
 */
export const coreCentreHidden = (centre: { x: number; y: number }, area: VisibleArea): boolean => centre.x < area.x0 || centre.x > area.x1 || centre.y < area.y0 || centre.y > area.y1;

/**
 * Where a boss window's count stands: at `head` while that is in the visible area; else pushed inside it and, where it would sit on the ring,
 * moved beside the ring (left of it, right when the left is off the area) — so the count is always in view and never on the ring.
 * `ring` — the ring's radius, `pad` — the count's half size (same units as the points).
 */
export function countPlace(head: { x: number; y: number }, core: { x: number; y: number }, ring: number, area: VisibleArea, pad: number): { x: number; y: number } {
  if (head.x >= area.x0 + pad && head.x <= area.x1 - pad && head.y >= area.y0 + pad && head.y <= area.y1 - pad) return { x: head.x, y: head.y };
  const y = Math.min(area.y1 - pad, Math.max(area.y0 + pad, core.y)), left = core.x - ring - pad * 1.4, right = core.x + ring + pad * 1.4;
  return { x: left >= area.x0 + pad ? left : right, y };
}

/**
 * `base` with one exception: a boss core (`hudBossCore`) that `hidden` says is under the HUD or the action bar is not seen — it gets the goal
 * pointer and its window's count by the pointer, as off screen. Any other point is seen as `base` says (the camera and the other pointers stay).
 */
export function seesUnderHud<P extends { x: number; y: number }>(base: (p: P, margin: number) => boolean, hidden: (e: Enemy) => boolean): (p: P, margin: number) => boolean {
  return (p, margin) => base(p, margin) && !(hudBossCore(p as unknown as Enemy) && hidden(p as unknown as Enemy));
}

/** `sees(point, margin)` — the point is inside the view grown by `margin` units; `spawns` — pointers to spawn markers too. */
export function collectEdgeMarkers(world: World, sees: (p: { x: number; y: number }, margin: number) => boolean, spawns = false): EdgeMarker[] {
  const out: EdgeMarker[] = [];
  const threat = (p: { x: number; y: number }): void => { if (!sees(p, SEEN_MARGIN)) out.push({ x: p.x, y: p.y, kind: 'threat' }); };
  for (const e of world.enemies) {
    const mark = archerMark(world, e);
    if (mark) { if (!sees(mark.at, mark.r)) out.push({ x: mark.at.x, y: mark.at.y, kind: 'threat' }); }
    else if (e.kind === 'boar' && (e.boar === 'windup' || e.boar === 'charge')) threat(e);
    else if (archerLine(world, e) || lynxLine(world, e) || wolfRushLine(world, e)) threat(e);
    else if (sapperFuse(world, e)) { if (sees(e, world.params.sapperRadius) && !sees(e, SEEN_MARGIN)) threat(e); }
    else {
      const beam = shamanBeam(world, e);
      if (beam && (sees(beam.target, 0) || Math.hypot(beam.target.x - world.hero.x, beam.target.y - world.hero.y) <= BEAM_NEAR_HERO)) threat(e);
    }
    // A marked enemy is a goal; an elite off screen gets the same gold pointer (its rim is gold; package «Урон имеет значение»).
    if ((e.marked || e.elite) && !sees(e, SEEN_MARGIN)) out.push({ x: e.x, y: e.y, kind: 'goal' });
  }
  // Each blast by its own radius (the goblin's bust is 3.5, a sapper's `sapperRadius`; task 7).
  for (const b of world.blasts) if (sees(b, b.radius) && !sees(b, SEEN_MARGIN)) threat(b);
  const open = doorOpen(world);
  for (const o of world.objects) {
    if (o.kind === 'button' && !o.pressed && !sees(o, SEEN_MARGIN)) out.push({ x: o.x, y: o.y, kind: 'goal' });
    else if (o.kind === 'door' && open && !sees(o, SEEN_MARGIN)) out.push({ x: o.x, y: o.y, kind: 'goal' });
  }
  if (spawns) for (const m of world.markers) if (!sees(m, SEEN_MARGIN)) out.push({ x: m.x, y: m.y, kind: 'spawn' });
  return out;
}
