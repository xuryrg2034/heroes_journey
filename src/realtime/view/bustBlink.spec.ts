/**
 * Task 19 «Короткий запал» (view): the lit bust circle's blink (`bustBlink`) reads in the run's 0.6 s fuse. The fuse comes from a
 * run battle's own params (`rtArenaParams` with the run's flag); the blink is sampled frame by frame at 60 fps, as the view draws
 * it. Node only: `npm run test:realtime-bust-blink`. The circle by real input: tests/realtime-slot.spec.ts, «task 7».
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { defaultParams } from '../sim/params';
import { rtArenaParams, rtRunParams } from '../run/rtRun';
import { bustBlink } from './bustBlink';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

const FRAME = 1 / 60;
/** The blink at each frame of the fuse, from «lit» (left = total) to the blast (left = 0). */
function frames(total: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= total + 1e-9; t += FRAME) out.push(bustBlink(total - t, total));
  return out;
}
/** Dark dips (local minima under 0.25) — one per blink the player sees. */
function dips(xs: number[]): number[] {
  const at: number[] = [];
  for (let i = 1; i < xs.length - 1; i++) if (xs[i] < 0.25 && xs[i] <= xs[i - 1] && xs[i] < xs[i + 1]) at.push(i);
  return at;
}

const runFuse = rtArenaParams({ shortFuse: true }, rtRunParams(defaultParams())).slotBustFuse;
const oldFuse = rtArenaParams({}, rtRunParams(defaultParams())).slotBustFuse;

check('a run battle lights the bust for 0.6 s; a save before task 19 — 1.2 s', () => {
  assert(Math.abs(runFuse - 0.6) < 1e-9, `run fuse ${runFuse}`);
  assert(Math.abs(oldFuse - 1.2) < 1e-9, `old fuse ${oldFuse}`);
});

check('0.6 s: bright at «lit», smooth from frame to frame (no noise), at least two dark blinks before the blast, faster at the end', () => {
  const xs = frames(runFuse);
  assert(xs[0] > 0.99, `at «lit» ${xs[0]}`);
  for (let i = 1; i < xs.length; i++) assert(Math.abs(xs[i] - xs[i - 1]) < 0.5, `frame ${i}: ${xs[i - 1]} → ${xs[i]}`);
  // Bright, dark, bright, dark: the blink is seen twice within the fuse (dark dips at least 0.1 s apart).
  const d = dips(xs);
  assert(d.length >= 2 && (d[1] - d[0]) * FRAME >= 0.1, `dips at frames ${d}`);
  assert(xs.slice(d[0], d[1]).some(x => x > 0.9), `no bright frame between the dips: ${xs.map(x => x.toFixed(2))}`);
  // Faster to the end: the phase step of the last frames is larger than of the first.
  const step = (i: number): number => Math.abs(Math.acos(2 * xs[i + 1] - 1) - Math.acos(2 * xs[i] - 1));
  assert(step(xs.length - 3) > step(1), `steps ${step(1)} → ${step(xs.length - 3)}`);
});

check('the blink is the fuse\'s own: the same left and total give the same blink (no view clock); 1.2 s blinks more often', () => {
  assert(bustBlink(0.3, 0.6) === bustBlink(0.3, 0.6), 'stable');
  assert(dips(frames(oldFuse)).length > dips(frames(runFuse)).length, `dips 1.2 s ${dips(frames(oldFuse)).length}, 0.6 s ${dips(frames(runFuse)).length}`);
  for (const xs of [frames(oldFuse), frames(runFuse)]) for (const x of xs) assert(x >= 0 && x <= 1, `blink ${x}`);
  assert(bustBlink(0, 0) === 1, 'no fuse: bright');
});
