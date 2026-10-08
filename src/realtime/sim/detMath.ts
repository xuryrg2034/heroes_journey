/**
 * Math that gives the same bits in every JavaScript engine (stage 3a; the rule of the whole simulation since 09.10.2026).
 *
 * `Math.sin`, `Math.cos`, `Math.atan2`, `Math.hypot` and `Math.pow` are not required to be correctly rounded, and engines
 * differ in their last bits: the V8 of Chromium and the V8 of Node gave different wolf positions after a few hundred ticks
 * of the wolves' ring, and a fight recorded in the browser no longer replayed in Node to the same hash. These functions
 * use only `+`, `−`, `×`, `÷`, `Math.sqrt`, `Math.round`, `Math.floor` and `Math.abs` — correctly rounded by IEEE 754
 * everywhere — so the simulation can turn angles and measure distances every tick and still replay across engines. The
 * simulation (`src/realtime/sim/**`) uses these, never the transcendental `Math.*` (decision 09.10.2026: determinism is a
 * rule of the project; `test:realtime-detmath` scans the sources); the view may use `Math.*` (it does not change the world).
 *
 * Accuracy against `Math.*` in Node (measured 09.10.2026, 200 000 random arguments per range): `datan2` — 9e-16;
 * `dsin`/`dcos` — 7e-16 for |x| < 10, 1e-14 for |x| < 100, 1e-12 for |x| < 1e4, 1e-10 for |x| < 1e6, and worse beyond
 * (1e-6 at |x| < 1e10): the reduction by 2π loses bits as |x| grows. Working range — |x| < 1e4; the simulation passes
 * angles within a few turns (the wolves: |x| < 13). `dhypot` — one rounding of the sum of squares (relative 4e-16),
 * scaled at the extremes; `dpowi` — integer powers by squaring (relative 1e-13 up to |n| ≤ 60).
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

/**
 * atan2(y, x) in [−π, π], as `Math.atan2`: −0 for y gives the lower side (−π for x < 0), both infinite — the diagonal,
 * NaN — NaN. Unlike `Math.atan2`, the origin (±0, ±0) gives 0 whatever the signs.
 */
export function datan2(y: number, x: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  // The angle from the x axis in the first quadrant, through the octant: atan(min/max), or π/2 less it.
  let a = ax === Infinity && ay === Infinity ? PI / 4 : ay <= ax ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 || (y === 0 && 1 / y < 0) ? -a : a;
}

/** Below and above these the square of a component under- or overflows: `dhypot` scales first. */
const HYPOT_SMALL = 1e-150, HYPOT_LARGE = 1e150;

/**
 * √(x² + y²), as `Math.hypot(x, y)`: Infinity if either is infinite, NaN if either is NaN (and neither infinite). The
 * square root of the sum of squares is correctly rounded everywhere; components beyond 1e±150 are scaled by the larger
 * one first, so the squares neither underflow nor overflow.
 */
export function dhypot(x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  const m = ax > ay ? ax : ay;
  if (m < HYPOT_LARGE && (m > HYPOT_SMALL || m === 0)) return Math.sqrt(x * x + y * y);
  if (m !== m || ax !== ax || ay !== ay) return NaN;
  const sx = ax / m, sy = ay / m;
  return m * Math.sqrt(sx * sx + sy * sy);
}

/** `base` to the integer power `n` (any sign) by squaring — the same bits everywhere, unlike `Math.pow`. */
export function dpowi(base: number, n: number): number {
  if (!Number.isInteger(n)) throw new Error(`dpowi: integer power expected, got ${n}`);
  let k = Math.abs(n), result = 1, square = base;
  while (k > 0) {
    if (k % 2 === 1) result *= square;
    k = Math.floor(k / 2);
    if (k > 0) square *= square;
  }
  return n < 0 ? 1 / result : result;
}
