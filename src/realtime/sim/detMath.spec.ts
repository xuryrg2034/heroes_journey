/**
 * Math of the simulation that gives the same bits in every engine (`sim/detMath.ts`; docs/realtime-stage3.md, section 10;
 * decision 09.10.2026: determinism is a rule of the project). Node only: `npm run test:realtime-detmath`.
 *
 * The functions use only IEEE 754 operations, so the same input gives the same bits in Chromium and in Node — that is
 * checked by the browser journals (tests/realtime.spec.ts, tests/realtime-behavior.spec.ts and their fixtures replayed
 * by `test:realtime-sim`). Here: the values agree with `Math.*` within 1e-13 over the ranges the simulation uses and at
 * the extremes (zeros of both signs, the turning points of the range reduction, subnormal and huge numbers, infinities,
 * NaN), and no file of the simulation calls a transcendental `Math.*` — a new call would bring the drift back.
 */
import { datan2, dcos, dhypot, dpowi, dsin } from './detMath';
import { RngStreams } from './rng';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const TOL = 1e-13;
/** Within TOL absolutely, or relatively for values above 1. */
const near = (a: number, b: number): boolean => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));
const rng = new RngStreams(20261009).stream('detmath');
const uniform = (lo: number, hi: number): number => lo + (hi - lo) * rng.next();

check('dsin, dcos: within 1e-13 of Math on [−100, 100] and at the quarter turns', () => {
  const xs: number[] = [0, -0, 1e-300, -1e-300, 5e-324, 1e-8, Math.PI, -Math.PI, 2 * Math.PI, 100, -100];
  // The turning points of the range reduction: k·π/4 and a hair either side.
  for (let k = -16; k <= 16; k++) for (const e of [0, 1e-15, -1e-15, 1e-9, -1e-9]) xs.push(k * Math.PI / 4 + e);
  for (let i = 0; i < 100_000; i++) xs.push(uniform(-100, 100));
  for (let i = 0; i < 20_000; i++) xs.push(uniform(-2 * Math.PI, 2 * Math.PI));
  let worst = 0;
  for (const x of xs) {
    assert(near(dsin(x), Math.sin(x)), `dsin(${x}) = ${dsin(x)}, Math ${Math.sin(x)}`);
    assert(near(dcos(x), Math.cos(x)), `dcos(${x}) = ${dcos(x)}, Math ${Math.cos(x)}`);
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
  }
  assert(Object.is(dsin(0), 0) && dcos(0) === 1 && dsin(Math.PI / 2) === 1, 'exact at 0 and π/2');
  assert(Number.isNaN(dsin(NaN)) && Number.isNaN(dcos(Infinity)), 'NaN and infinity give NaN');
  console.log(`   ${xs.length} points, worst ${worst.toExponential(2)}`);
});

check('datan2: within 1e-13 of Math in every octant, on the axes, at zeros, infinities and NaN', () => {
  let worst = 0;
  const pairs: [number, number][] = [];
  for (let i = 0; i < 100_000; i++) pairs.push([uniform(-20, 20), uniform(-20, 20)]);
  // Octant borders and the shift of atanUnit at tan(π/12).
  for (const t of [1, 1 - 1e-15, 1 + 1e-15, 2 - Math.sqrt(3), 2 - Math.sqrt(3) + 1e-15, 1e-300, 1e300]) for (const sx of [1, -1]) for (const sy of [1, -1]) { pairs.push([sy * t, sx]); pairs.push([sy, sx * t]); }
  for (const [y, x] of pairs) {
    const d = datan2(y, x), m = Math.atan2(y, x);
    assert(near(d, m), `datan2(${y}, ${x}) = ${d}, Math ${m}`);
    worst = Math.max(worst, Math.abs(d - m));
  }
  // Axes and signed zeros (off the origin): as Math.
  const special: [number, number][] = [[0, 1], [-0, 1], [0, -1], [-0, -1], [1, 0], [1, -0], [-1, 0], [-1, -0], [5e-324, -1], [-5e-324, -1],
    [Infinity, 1], [-Infinity, 1], [1, Infinity], [1, -Infinity], [Infinity, Infinity], [-Infinity, -Infinity], [Infinity, -Infinity], [-Infinity, Infinity]];
  for (const [y, x] of special) {
    const d = datan2(y, x), m = Math.atan2(y, x);
    assert(Object.is(d, m) || (near(d, m) && Math.sign(d) === Math.sign(m)), `datan2(${y}, ${x}) = ${d}, Math ${m}`);
  }
  // The origin is 0 whatever the signs (Math.atan2 gives ±0 or ±π): a direction to oneself has no angle.
  for (const [y, x] of [[0, 0], [-0, 0], [0, -0], [-0, -0]]) assert(datan2(y, x) === 0, `origin (${y}, ${x})`);
  assert(Number.isNaN(datan2(NaN, 1)) && Number.isNaN(datan2(1, NaN)), 'NaN');
  console.log(`   ${pairs.length} pairs, worst ${worst.toExponential(2)}`);
});

check('dhypot: within 1e-13 (relative) of Math.hypot, without overflow or underflow at the extremes', () => {
  let worst = 0;
  const pairs: [number, number][] = [];
  for (let i = 0; i < 100_000; i++) pairs.push([uniform(-30, 30), uniform(-30, 30)]);
  for (let i = 0; i < 10_000; i++) pairs.push([uniform(-1e-6, 1e-6), uniform(-1e-6, 1e-6)]);
  for (const v of [5e-324, 1e-320, 1e-200, 1e-160, 1e-150, 1e150, 1e160, 1e200, 1e300, Number.MAX_VALUE]) for (const w of [0, v, v / 3, 1]) { pairs.push([v, w]); pairs.push([-w, -v]); }
  for (const [x, y] of pairs) {
    const d = dhypot(x, y), m = Math.hypot(x, y);
    assert(d === m || Math.abs(d - m) <= TOL * m, `dhypot(${x}, ${y}) = ${d}, Math ${m}`);
    if (m > 0 && Number.isFinite(m)) worst = Math.max(worst, Math.abs(d - m) / m);
  }
  assert(dhypot(Number.MAX_VALUE / 2, Number.MAX_VALUE / 4) === Math.hypot(Number.MAX_VALUE / 2, Number.MAX_VALUE / 4) && Number.isFinite(dhypot(Number.MAX_VALUE / 2, Number.MAX_VALUE / 4)), 'no overflow while the result fits');
  assert(dhypot(0, 0) === 0 && dhypot(-0, -0) === 0 && dhypot(3, 4) === 5 && dhypot(-3, 4) === 5, 'exact small cases');
  assert(dhypot(Infinity, NaN) === Infinity && dhypot(NaN, -Infinity) === Infinity && Number.isNaN(dhypot(NaN, 1)) && Number.isNaN(dhypot(1e200, NaN)), 'infinity wins over NaN, as Math.hypot');
  console.log(`   ${pairs.length} pairs, worst relative ${worst.toExponential(2)}`);
});

check('dpowi: integer powers within 1e-13 (relative) of Math.pow; a non-integer power throws', () => {
  for (const base of [1.05, 1.1, 1.25, 0.5, 0.9, -2, -0.75, 1e-3, 3, 0, -0, Infinity]) for (let n = -40; n <= 60; n++) {
    const d = dpowi(base, n), m = Math.pow(base, n);
    assert(d === m || Math.abs(d - m) <= TOL * Math.abs(m), `dpowi(${base}, ${n}) = ${d}, Math ${m}`);
  }
  assert(dpowi(NaN, 0) === 1 && Number.isNaN(dpowi(NaN, 2)), 'NaN to 0 is 1, as Math.pow');
  let threw = false;
  try { dpowi(2, 0.5); } catch { threw = true; }
  assert(threw, 'a non-integer power throws');
});

// Node's file system, loaded by name: the project's typecheck has no Node types under src/ (the spec runs in Node only).
interface NodeFs { readdirSync(path: string): string[]; readFileSync(path: string, encoding: 'utf8'): string; statSync(path: string): { isDirectory(): boolean } }
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const fs = await nodeModule('node:fs') as NodeFs;
const { fileURLToPath } = await nodeModule('node:url') as { fileURLToPath(url: URL): string };

check('no file of the simulation calls a transcendental Math function', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url)), found: string[] = [];
  const walk = (path: string): void => {
    for (const name of fs.readdirSync(path)) {
      const file = `${path.replace(/\/$/, '')}/${name}`;
      if (fs.statSync(file).isDirectory()) { walk(file); continue; }
      if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name === 'detMath.ts') continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line: string, i: number) => {
        if (/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt)\s*\(/.test(line)) found.push(`${file}:${i + 1}`);
        if (/[\w)\]]\s*\*\*\s*[\w(]/.test(line.replace(/\/\*\*.*|^\s*\*.*/g, ''))) found.push(`${file}:${i + 1} (**)`);
      });
    }
  };
  walk(dir);
  assert(!found.length, `transcendental Math in the simulation: ${found.join(', ')}`);
});

console.log(`realtime-detmath: ${checks} checks passed`);
