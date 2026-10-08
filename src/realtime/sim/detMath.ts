/**
 * Trigonometry that gives the same bits in every JavaScript engine (stage 3a, step 3).
 *
 * `Math.sin`, `Math.cos` and `Math.atan2` are not required to be correctly rounded, and engines differ in their last bits:
 * the V8 of Chromium and the V8 of Node gave different wolf positions after a few hundred ticks of the wolves' ring, and
 * a fight recorded in the browser no longer replayed in Node to the same hash. These functions use only `+`, `−`, `×`,
 * `÷`, `Math.sqrt`, `Math.round` and `Math.abs` — correctly rounded by IEEE 754 everywhere — so the simulation can turn
 * angles every tick and still replay across engines. Accuracy: better than 1e-12 (series to the needed order after range
 * reduction). Behaviour code that runs every tick uses these, not `Math.sin`/`Math.cos`/`Math.atan2`.
 */
const PI = Math.PI, HALF_PI = Math.PI / 2, TWO_PI = 2 * Math.PI;
const SQRT3 = Math.sqrt(3);
/** tan(π/12): above it atan is shifted by π/6 first. */
const TAN_PI_12 = 2 - SQRT3;

/** sin of x in [−π/4, π/4] (Taylor series to x¹⁷). */
function sinSmall(x: number): number {
  const x2 = x * x;
  let term = x, sum = x;
  for (let k = 1; k <= 8; k++) { term *= -x2 / ((2 * k) * (2 * k + 1)); sum += term; }
  return sum;
}
/** cos of x in [−π/4, π/4] (Taylor series to x¹⁸). */
function cosSmall(x: number): number {
  const x2 = x * x;
  let term = 1, sum = 1;
  for (let k = 1; k <= 9; k++) { term *= -x2 / ((2 * k - 1) * (2 * k)); sum += term; }
  return sum;
}

/** Brings x into [−π/4, π/4] and returns it with its quarter (0–3) of the turn. */
function reduce(x: number): { r: number; q: number } {
  const turns = x - TWO_PI * Math.round(x / TWO_PI);
  const q = Math.round(turns / HALF_PI);
  return { r: turns - q * HALF_PI, q: ((q % 4) + 4) % 4 };
}

export function dsin(x: number): number {
  const { r, q } = reduce(x);
  return q === 0 ? sinSmall(r) : q === 1 ? cosSmall(r) : q === 2 ? -sinSmall(r) : -cosSmall(r);
}

export function dcos(x: number): number {
  const { r, q } = reduce(x);
  return q === 0 ? cosSmall(r) : q === 1 ? -sinSmall(r) : q === 2 ? -cosSmall(r) : sinSmall(r);
}

/** atan of t in [0, 1]: shifted by π/6 above tan(π/12), then the series (|u| ≤ 0.268, to u²⁵). */
function atanUnit(t: number): number {
  let shift = 0;
  if (t > TAN_PI_12) { t = (t * SQRT3 - 1) / (t + SQRT3); shift = PI / 6; }
  const t2 = t * t;
  let power = t, sum = t;
  for (let k = 1; k <= 12; k++) { power *= -t2; sum += power / (2 * k + 1); }
  return shift + sum;
}

/** atan2(y, x) in (−π, π], as `Math.atan2` (0 for the origin). */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  // The angle from the x axis in the first quadrant, through the octant: atan(min/max), or π/2 less it.
  let a = ay <= ax ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}


