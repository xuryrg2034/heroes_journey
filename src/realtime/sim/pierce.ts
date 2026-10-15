/**
 * Loop research, step 3 (docs/realtime-loop-research.md, К1 and 4.4; design decisions 12.10.2026): «Прямая», the barbarian's
 * pierce. Sandbox only (`Params.pierceEnabled`, off; a run forces it off, `RUN_FORCED`). The shape and the corridor live here
 * as pure functions — the highlight (chain.ts `planChain`), the dash (`releaseChain` fixes what the plan shows) and the
 * measurement (scripts/measure-loops.ts) call the same ones.
 *
 * - The tail: the polyline of the chain from its third-to-last enemy link to its last link (a crystal, a brazier or loot in
 *   between is a corner; the hero → first link segment never counts). Every turn of the tail is at most `pierceTurn` degrees
 *   (cos ≥ dcos(turn), no atan2); a segment shorter than `PIERCE_EPS` breaks the line. The last link must be an enemy.
 * - The axis: from the second-to-last corner to the last one, starting at the last link. The end: `pierceLength` along it, cut
 *   at the first point (steps of `PIERCE_STEP`) where the hero's body would be blocked — an obstacle, the arena's edge, a
 *   cliff (the pierce never flies over a cliff). Water and thorns do not stop it; enemies do not block. A cut to 0 — no pierce.
 * - The corridor: bodies whose centre is at t ∈ (0, L] along the axis and at most `pierceCorridor` off it; any colour, not the
 *   chain's own links, never the reaper (`immune`). Ordered by t (the arena's order on a tie): the order the hero passes them.
 *
 * Deterministic: `+ − × ÷`, `dhypot`, `dcos`; no randomness.
 */
import { dcos, dhypot } from './detMath';
import { kindOf } from './enemies/kinds';
import { FORMS } from './buildIds';
import { hasTalisman } from './kit';
import { blockedAt, type ArenaShape, type Vec } from './geometry';
import { heroRadius, type Params } from './params';
import type { ChainLink, Enemy, World } from './world';

/** The source of the pierce's hit (kill and hit events, telemetry `kills.tools.pierce`). Not in `PURSE_KILL_SOURCES`. */
export const PIERCE_SOURCE = 'pierce';
/** Hit-stop of the pierce (game seconds, once per pierce; only with the `hitstop` toggle). */
export const PIERCE_HITSTOP = 0.04;
/** The step of the cut: the end is the last free point before the first blocked one. */
export const PIERCE_STEP = 0.05;
/** A tail segment shorter than this breaks the line (no direction). */
export const PIERCE_EPS = 0.05;
/** Defaults of the panel numbers (also the values of a world whose params lack them). */
export const PIERCE_TURN = 25;
export const PIERCE_LENGTH = 1.875;
export const PIERCE_CORRIDOR = 0.5;
/** Enemy links of the tail. */
export const PIERCE_TAIL_LINKS = 3;

/**
 * The pierce is on in this world: the sandbox toggle (journals without the key: off) or «Прямая» as a form in the kit (task 29,
 * buildIds.ts `FORMS.pierce`; a kit without the id — the old path).
 */
export function pierceOn(world: World): boolean { return !!world.params.pierceEnabled || hasTalisman(world, FORMS.pierce); }

/** A corner of the chain's polyline: its point and whether it is an enemy link. */
export interface PierceCorner { x: number; y: number; enemy: boolean }

/** The axis of a straight tail: its start (the last link) and the unit direction. */
export interface PierceAxis { from: Vec; ux: number; uy: number }

/** A body of the corridor: its id and its distance along the axis. */
export interface PierceBody { id: number; t: number }

/** The pierce's geometry: the axis, the cut end and its length, the corridor's bodies by t. */
export interface PierceShape extends PierceAxis { to: Vec; length: number; bodies: PierceBody[] }

/** cos of the turn limit (degrees, 0–90). */
export function pierceTurnCos(turn: number): number { return dcos(Math.max(0, Math.min(90, turn)) * Math.PI / 180); }

/**
 * The axis of the chain's tail (rule 1): the last `PIERCE_TAIL_LINKS` enemy corners and the corners between them form a
 * polyline whose every turn has cos ≥ `cosLimit` and whose every segment is at least `PIERCE_EPS` long; the last corner is an
 * enemy. Null — no straight tail.
 */
export function pierceAxis(corners: readonly PierceCorner[], cosLimit: number): PierceAxis | null {
  const n = corners.length;
  if (!n || !corners[n - 1].enemy) return null;
  let start = -1;
  for (let i = n - 1, seen = 0; i >= 0; i--) if (corners[i].enemy && ++seen === PIERCE_TAIL_LINKS) { start = i; break; }
  if (start < 0) return null;
  let px = 0, py = 0, plen = 0;
  for (let i = start + 1; i < n; i++) {
    const dx = corners[i].x - corners[i - 1].x, dy = corners[i].y - corners[i - 1].y, len = dhypot(dx, dy);
    if (len < PIERCE_EPS) return null;
    if (i > start + 1 && px * dx + py * dy < cosLimit * plen * len) return null;
    px = dx; py = dy; plen = len;
  }
  const last = corners[n - 1];
  return { from: { x: last.x, y: last.y }, ux: px / plen, uy: py / plen };
}

/** The point at `t` along the axis. */
export function pierceAt(axis: PierceAxis, t: number): Vec { return { x: axis.from.x + axis.ux * t, y: axis.from.y + axis.uy * t }; }

/**
 * The free length of the axis up to `length` (rule 6): the last sample (every `PIERCE_STEP`, and `length` itself) before
 * the first where a body of radius `r` would be blocked (obstacles, the edge, cliffs — `blockedAt`). Water, thorns and
 * bodies do not stop it.
 */
export function pierceCut(axis: PierceAxis, length: number, r: number, arena: ArenaShape): number {
  let free = 0;
  for (let k = 1; free < length; k++) {
    const s = Math.min(k * PIERCE_STEP, length);
    if (blockedAt(pierceAt(axis, s), r, arena)) return free;
    free = s;
  }
  return free;
}

/** The corridor's bodies (rule 5): centre at t ∈ (0, length], at most `half` off the axis; not `skip`, not immune; by t. */
export function pierceCorridor(enemies: readonly Enemy[], axis: PierceAxis, length: number, half: number, skip: ReadonlySet<number>): PierceBody[] {
  const out: (PierceBody & { i: number })[] = [];
  enemies.forEach((e, i) => {
    if (skip.has(e.id) || kindOf(e).immune) return;
    const dx = e.x - axis.from.x, dy = e.y - axis.from.y;
    const t = dx * axis.ux + dy * axis.uy, off = Math.abs(dy * axis.ux - dx * axis.uy);
    if (t > 0 && t <= length && off <= half) out.push({ id: e.id, t, i });
  });
  out.sort((a, b) => a.t - b.t || a.i - b.i);
  return out.map(({ id, t }) => ({ id, t }));
}

/** The panel numbers of a world (a world whose params lack them plays the defaults). */
export function pierceNumbers(params: Params): { turn: number; length: number; corridor: number } {
  return { turn: params.pierceTurn ?? PIERCE_TURN, length: Math.max(0, params.pierceLength ?? PIERCE_LENGTH), corridor: Math.max(0, params.pierceCorridor ?? PIERCE_CORRIDOR) };
}

/**
 * The pierce's shape for the chain `links` now (`point` gives a link's position, null — gone): the straight tail, the cut
 * end and the corridor. Null — no straight tail, a link is gone, or the cut leaves nothing. Pure: it only reads the world.
 * Power and outcomes are the chain's business (chain.ts `planChain`).
 */
export function pierceShape(world: World, links: readonly ChainLink[], point: (link: ChainLink) => Vec | null): PierceShape | null {
  const corners: PierceCorner[] = [];
  for (const link of links) {
    const p = point(link);
    if (!p) return null;
    corners.push({ x: p.x, y: p.y, enemy: link.kind === 'enemy' });
  }
  const nums = pierceNumbers(world.params);
  const axis = pierceAxis(corners, pierceTurnCos(nums.turn));
  if (!axis) return null;
  const length = pierceCut(axis, nums.length, heroRadius(world.params), world.arena);
  if (length <= 0) return null;
  const own = new Set(links.filter(l => l.kind === 'enemy').map(l => l.id));
  return { ...axis, to: pierceAt(axis, length), length, bodies: pierceCorridor(world.enemies, axis, length, nums.corridor, own) };
}
