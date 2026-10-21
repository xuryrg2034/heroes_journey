/**
 * Task 62 «Ведунья v2: радиус и фигуры», stage A (docs/design-notes/task-62-witch-v2.md, sections 2–3; docs/realtime-prototype.md,
 * «Ведунья v2»): the circle of casting and the figures of a closed chain. The rules of the chain (the reach from Ведунья, the discharge, the
 * ring's seal) live in chain.ts; this module is the geometry. Everything reads `witchOn` (kit.ts): the key `witchV2` with Ведунья's law.
 *
 * - **The circle** (`castCircle`): its centre is Ведунья, its radius `witchCastRadius` × R of the build without «Длинная рука»
 *   (`linkRadiusBaseOf`). An enemy is in it when its centre (to its drawn edge with «R до края тела») is within the radius and in sight
 *   from her (`castReach`); a crystal and a brazier — the same; a button, the door, a lever, loot — in the ordinary R.
 * - **The runes** (`ChainLink.rune`): the point of an enemy link when it was taken; the contour of a figure is made of them, in order.
 * - **The figure** (`classifyGlyph`), in a fixed order, comparisons and `+ − × ÷` only (lengths — `dhypot`):
 *   1. the contour of the runes crosses itself — «нить пересеклась»;
 *   2. the simplification (cyclic): a rune nearer than `glyphStraight` × the contour's diameter to the line of its two neighbours
 *      (the first rune's are the last and the second) is dropped; the walk starts at the first rune and goes on until nothing changes;
 *      at least 3 corners stay;
 *   3. the shape (design 21.10.2026): 3 or 4 corners — convex (the cross products of the corners of one sign); 5 and more — star-shaped
 *      from the centre of its area c (every (v_i − c) × (v_{i+1} − c) of one sign, zeros skipped: a ring may have a dent); else «не
 *      фигура»; the area under `glyphMinArea` or the thickness (2 × area ÷ the largest diameter) under `glyphMinThick` — «мала»;
 *   4. by the corners k: 3 — a triangle; 4 — a square (sides within `glyphSquareSides`, diagonals within `glyphSquareDiag`, every
 *      corner 60°–120°: |cos| ≤ 0.5), else «не фигура»; 5 and more with `glyphRingMin` runes — a ring (the largest ÷ the least
 *      distance from c to a corner within `glyphRingRatio`, 2; no corner sharper than its `glyphRingCorner` — the dot product of the
 *      two edges out of a corner not above `glyphRingCorner` × their lengths: 0.707 — 45°, 0 — 90°), else «не фигура».
 *   One answer: a figure or a refusal. Stage A acts on the ring only: a square and a triangle are refused «не фигура» (`glyphShapes`
 *   of stage B turns them on); `glyphClass` names any contour's class for the sandbox's tuning.
 */
import { dhypot } from './detMath';
import { segmentsCross } from './seal';
import type { Vec } from './geometry';
import type { Params } from './params';

/** The figures (stage A acts on the ring only). */
export type GlyphKind = 'ring' | 'square' | 'triangle';
/** Why a closed contour is no figure: it crosses itself, it is not one of the figures, it is too small. */
export type GlyphRefusal = 'crossed' | 'notFigure' | 'small';
/** A figure: its kind and its corners after the simplification (the contour of the runes stays the chain's). */
export interface GlyphShape { kind: GlyphKind; corners: Vec[] }
export type GlyphResult = GlyphShape | { refusal: GlyphRefusal };

/** The numbers of stage B (a square), read for the class only while stage A refuses squares. */
const SQUARE_SIDES = 1.5, SQUARE_DIAG = 1.25;

/** A number key of the figures: its value, or its default (a world the panel turned v2 on in, a journal without the key). */
const num = (p: Params, key: 'glyphStraight' | 'glyphMinArea' | 'glyphMinThick' | 'glyphRingMin' | 'glyphRingRatio' | 'glyphRingCorner', fallback: number): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const len = (a: Vec, b: Vec): number => dhypot(b.x - a.x, b.y - a.y);

/** The contour crosses itself: two edges that are not neighbours cross at an inner point. */
export function contourCrosses(points: readonly Vec[]): boolean {
  const k = points.length;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    if (j === i + 1 || (i === 0 && j === k - 1)) continue;
    if (segmentsCross(points[i], points[(i + 1) % k], points[j], points[(j + 1) % k])) return true;
  }
  return false;
}
/** The largest distance between two points. */
export function diameterOf(points: readonly Vec[]): number {
  let d = 0;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) d = Math.max(d, len(points[i], points[j]));
  return d;
}
/** The area of a closed contour (shoelace, unsigned). */
export function areaOf(points: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}
/** The centre of a contour's area (its corners' mean when the area is 0). */
export function areaCentre(points: readonly Vec[]): Vec {
  let s = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = a.x * b.y - b.x * a.y;
    s += c; cx += (a.x + b.x) * c; cy += (a.y + b.y) * c;
  }
  if (Math.abs(s) < 1e-12) return { x: points.reduce((t, p) => t + p.x, 0) / points.length, y: points.reduce((t, p) => t + p.y, 0) / points.length };
  return { x: cx / (3 * s), y: cy / (3 * s) };
}
/** The distance of `p` from the line through `a` and `b` (from `a` when they coincide). */
function lineDistance(p: Vec, a: Vec, b: Vec): number {
  const l = len(a, b);
  return l < 1e-12 ? len(a, p) : Math.abs(cross(a, b, p)) / l;
}

/** The simplification (step 2): the corners left of the runes, cyclic, from the first rune, until nothing changes; at least 3. */
export function simplifyContour(points: readonly Vec[], straight: number): Vec[] {
  const out = points.map(p => ({ x: p.x, y: p.y }));
  const limit = straight * diameterOf(points);
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3;) {
      const n = out.length, prev = out[(i - 1 + n) % n], next = out[(i + 1) % n];
      if (lineDistance(out[i], prev, next) < limit) { out.splice(i, 1); changed = true; } else i++;
    }
  }
  return out;
}

/** Every corner is seen from `c` turning the same way (a star-shaped contour; a zero cross product breaks no side). */
function starFrom(points: readonly Vec[], c: Vec): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], s = (a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x);
    if (s === 0) continue;
    if (sign === 0) sign = s > 0 ? 1 : -1; else if ((s > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}
/** Every corner turns the same way (a convex contour; a straight corner — the cross product 0 — breaks no side). */
function convex(points: readonly Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const n = points.length, c = cross(points[i], points[(i + 1) % n], points[(i + 2) % n]);
    if (c === 0) continue;
    if (sign === 0) sign = c > 0 ? 1 : -1; else if ((c > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

/** The class of a contour of runes (steps 1–4 above) — the figure or the refusal, whatever stage A acts on. */
export function glyphClass(params: Params, runes: readonly Vec[]): GlyphResult {
  if (runes.length < 3) return { refusal: 'notFigure' };
  if (contourCrosses(runes)) return { refusal: 'crossed' };
  const corners = simplifyContour(runes, Math.max(0, num(params, 'glyphStraight', 0.08)));
  // Design 21.10.2026: a triangle and a square are convex; a ring is star-shaped from its area's centre (a dent allowed).
  if (corners.length < 5 ? !convex(corners) : !starFrom(corners, areaCentre(corners))) return { refusal: 'notFigure' };
  const area = areaOf(corners), diameter = diameterOf(corners);
  if (area < num(params, 'glyphMinArea', 1.5) || (diameter > 0 ? 2 * area / diameter : 0) < num(params, 'glyphMinThick', 0.6)) return { refusal: 'small' };
  const k = corners.length;
  if (k === 3) return { kind: 'triangle', corners };
  if (k === 4) {
    const sides = corners.map((p, i) => len(p, corners[(i + 1) % 4])), d1 = len(corners[0], corners[2]), d2 = len(corners[1], corners[3]);
    const right = corners.every((p, i) => {
      const a = corners[(i + 3) % 4], b = corners[(i + 1) % 4], ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
      return Math.abs(ux * vx + uy * vy) <= 0.5 * dhypot(ux, uy) * dhypot(vx, vy);
    });
    const square = Math.max(...sides) <= SQUARE_SIDES * Math.min(...sides) && Math.max(d1, d2) <= SQUARE_DIAG * Math.min(d1, d2) && right;
    return square ? { kind: 'square', corners } : { refusal: 'notFigure' };
  }
  if (runes.length < Math.max(3, Math.floor(num(params, 'glyphRingMin', 5)))) return { refusal: 'notFigure' };
  const c = areaCentre(corners), r = corners.map(p => len(c, p)), rMin = Math.min(...r);
  const round = rMin > 0 && Math.max(...r) <= num(params, 'glyphRingRatio', 2) * rMin;
  const corner = num(params, 'glyphRingCorner', 0.707);
  const blunt = corners.every((p, i) => {
    const n = corners.length, a = corners[(i - 1 + n) % n], b = corners[(i + 1) % n], ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
    return ux * vx + uy * vy <= corner * dhypot(ux, uy) * dhypot(vx, vy);
  });
  return round && blunt ? { kind: 'ring', corners } : { refusal: 'notFigure' };
}

/** The figure a closed contour of runes makes in stage A: the ring, or a refusal (a square and a triangle — «не фигура» until stage B). */
export function classifyGlyph(params: Params, runes: readonly Vec[]): GlyphResult {
  const result = glyphClass(params, runes);
  return 'kind' in result && result.kind !== 'ring' ? { refusal: 'notFigure' } : result;
}
