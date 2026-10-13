/**
 * Task 12 «Отмеченные — вожак или орда» (design 13.10.2026): the horde of marked enemies reads as one group — one ring round the
 * living marked bodies that stand close together, not a reticle on each. Drawing only: the view finds the group from where the
 * marked enemies stand now (the horde moves as it chases the hero), never from the arena's template; nothing here is read by the sim.
 */
import type { Vec } from '../sim/geometry';

/** A horde needs this many marked bodies close together; fewer are drawn one by one (each its reticle). */
export const HORDE_MIN = 4;
/** Arena units from the group's centre within which a marked body belongs to the horde. */
export const HORDE_REACH = 3;

export interface HordeGroup {
  /** The centre and the radius (arena units) of the ring: round every member's centre, before the body's own radius. */
  x: number;
  y: number;
  radius: number;
  /** The ids of the bodies in the ring (they keep only their star; the others keep their reticle). */
  members: Set<number>;
}

/**
 * The horde among the living marked bodies (`points`, each with its id), or null — fewer than `HORDE_MIN` stand within
 * `HORDE_REACH` of their centre. The centre is found twice: of all, then of those near the first — a straggler far away does not
 * pull the ring off the crowd, it keeps its own reticle.
 */
export function hordeGroup(points: readonly (Vec & { id: number })[], min = HORDE_MIN, reach = HORDE_REACH): HordeGroup | null {
  if (points.length < min) return null;
  const centre = (ps: readonly Vec[]): Vec => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const near = (c: Vec): (Vec & { id: number })[] => points.filter(p => Math.hypot(p.x - c.x, p.y - c.y) <= reach);
  let c = centre(points), group = near(c);
  if (group.length) { c = centre(group); group = near(c); }
  if (group.length < min) return null;
  const radius = Math.max(...group.map(p => Math.hypot(p.x - c.x, p.y - c.y)));
  return { x: c.x, y: c.y, radius, members: new Set(group.map(p => p.id)) };
}
