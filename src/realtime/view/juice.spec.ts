/**
 * Task 35 «Сочность, пакет 1» (view/juice.ts): the level of «Тряска и вспышки» from storage, the cap of three full-screen flashes a
 * second, the shards by the link's number, the count-up of a header number. Node only: `npm run test:realtime-juice`.
 * The level on screen (no shake at 0, the same hash, kept over a reload) is tests/realtime-juice.spec.ts.
 */
import { FLASH_CAP, FX_DEFAULT, FlashGate, SQUASH_MAX, SQUASH_TIME, WAVE_FULL, countUpTime, countUpValue, fxLevelOf, shardCount, shardLife, squashScale, waveStrength } from './juice';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

check('С1: the stored level — 0, 50, 100; junk is the default 100', () => {
  assert(fxLevelOf('0') === 0 && fxLevelOf('50') === 50 && fxLevelOf('100') === 100 && fxLevelOf(50) === 50, 'levels read');
  for (const junk of [null, undefined, '', '30', 'abc', 101, -1, {}]) assert(fxLevelOf(junk) === FX_DEFAULT, `junk ${String(junk)}`);
  assert(FX_DEFAULT === 100, 'default 100 %');
});

check('С1: at most three full-screen flashes start in any second (WCAG 2.3.1)', () => {
  const gate = new FlashGate();
  // A flash every 0.1 s for 3 s: never more than FLASH_CAP starts in a window of one second.
  const starts: number[] = [];
  for (let i = 0; i < 30; i++) { const t = i * 0.1; if (gate.allow(t)) starts.push(t); }
  for (const t of starts) assert(starts.filter(s => s >= t && s < t + 1).length <= FLASH_CAP, `window at ${t}`);
  assert(starts.length >= 8, `flashes still come: ${starts.length}`);
  // Spaced out flashes all pass.
  const calm = new FlashGate();
  for (let i = 0; i < 10; i++) assert(calm.allow(i * 0.4), `calm flash ${i}`);
});

check('С2: shards grow with the link — 4 at the first, 8 from the 6th, a kill outside a chain as the first', () => {
  assert(shardCount(1) === 4 && shardCount(0) === 4 && shardCount(-1) === 4, 'first link and no chain — 4');
  assert(shardCount(6) === 8 && shardCount(12) === 8, 'sixth and further — 8');
  for (let n = 1; n < 12; n++) assert(shardCount(n + 1) >= shardCount(n), `no drop at ${n}`);
  assert(shardLife(1) === 0.2 && Math.abs(shardLife(6) - 0.3) < 1e-9 && shardLife(20) <= 0.3, 'life 0.2–0.3 s');
});

check('С3: the count-up lasts 0.3–0.6 s and lands on the value', () => {
  assert(countUpTime(1) === 0.3 && countUpTime(100) === 0.6, 'bounds');
  assert(countUpValue(10, 25, 0, 0.5) === 10 && countUpValue(10, 25, 0.5, 0.5) === 25 && countUpValue(10, 25, 9, 0.5) === 25, 'ends');
  let last = 10;
  for (let t = 0; t <= 0.5; t += 0.05) { const v = countUpValue(10, 25, t, 0.5); assert(v >= last && v <= 25, `monotone at ${t}`); last = v; }
});

check('С7 (task 47): the squash stays within 15 %, stretches at the start and squashes at the end, fades in 0.1 s, none at level 0', () => {
  assert(SQUASH_MAX <= 0.15 && SQUASH_TIME >= 0.08 && SQUASH_TIME <= 0.12, 'the bounds of the spec');
  const start = squashScale('start', 0, 100), end = squashScale('end', 0, 100);
  assert(start.y > 1 && start.x < 1 && end.y < 1 && end.x > 1, `start ${JSON.stringify(start)}, end ${JSON.stringify(end)}`);
  for (let t = 0; t < SQUASH_TIME; t += 0.005) for (const kind of ['start', 'end'] as const) for (const level of [100, 50]) {
    const s = squashScale(kind, t, level);
    assert(Math.abs(s.x - 1) <= SQUASH_MAX + 1e-9 && Math.abs(s.y - 1) <= SQUASH_MAX + 1e-9, `${kind} ${t} ${level}: ${JSON.stringify(s)}`);
  }
  assert(Math.abs(squashScale('start', 0, 50).y - 1) < Math.abs(start.y - 1), 'half the level — a smaller squash');
  for (const s of [squashScale('start', SQUASH_TIME, 100), squashScale('end', 0, 0), squashScale('start', 0.05, 0)]) assert(s.x === 1 && s.y === 1, `none: ${JSON.stringify(s)}`);
  assert(Math.abs(squashScale('end', 0.08, 100).y - 1) < Math.abs(squashScale('end', 0.02, 100).y - 1), 'fades');
});

check('С4 «Ударная волна» (task 47): the hum grows with the bodies struck, 0.3 → 1', () => {
  assert(waveStrength(0) === 0.3 && waveStrength(WAVE_FULL) === 1 && waveStrength(WAVE_FULL + 5) === 1, 'ends');
  assert(waveStrength(2) > waveStrength(1) && waveStrength(1) > waveStrength(0), 'grows');
});
