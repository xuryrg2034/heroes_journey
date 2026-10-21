/**
 * Task 51ж «Разминка» (design 16.10.2026, docs/design-notes/task-51-camp-l3.md, 5 and 12; run/warmup.ts, sim/arenasWarmup.ts): the
 * three layouts of the camp's warmup — their numbers are existing `Params` keys only; an attempt played by journalled commands ends by
 * its rule (the limit, a clear field, a death) and its journal replays to the same hash and the same score; the record's merge and the
 * stored record's check. Node only: `npm run test:realtime-warmup`. Input variants by `Math.imul(k, 2654435761) >>> 0`.
 */
import { WARMUP_ARENAS, WARMUP_CLIFF } from '../sim/arenasWarmup';
import { arenaTemplate } from '../sim/arenas';
import { DEFAULT_PARAMS } from '../sim/params';
import { replay, Simulation } from '../sim/simulation';
import { dist } from '../sim/geometry';
import type { World } from '../sim/world';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, parseRecordId, type WarmupRecord } from '../telemetry/schema';
import { warmupStats } from '../telemetry/report';
import { warmupBody, type WarmupBody } from '../telemetry/warmup';
import { defaultParams } from '../sim/params';
import {
  isWarmupBest, isWarmupId, warmupBetter, warmupEnd, warmupLayout, warmupLoadout, warmupMerge, warmupParams, warmupScore, WARMUP_LAYOUTS, WARMUP_SEED,
  type WarmupEnd, type WarmupId, type WarmupRecords,
} from './warmup';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A new attempt of layout `id` as the view starts it (the layout's values and loadout, the fixed seed), recorded. */
const attempt = (id: WarmupId): Simulation => new Simulation({ arena: id, params: warmupParams(id), seed: WARMUP_SEED, record: true, loadout: warmupLoadout() });

/** The chain from the hero to the nearest enemy and on to the nearest of its colour, `n` links at most (journalled); 1 — released. */
function greedyChain(sim: Simulation, n: number): number {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return 0;
  const left = [...w.enemies];
  const first = left.sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first || !sim.command({ t: 'begin', x: first.x, y: first.y })) return 0;
  let at = first;
  for (let i = 1; i < n; i++) {
    const next = w.enemies.filter(e => e.color === first.color && !w.chain.some(l => l.id === e.id)).sort((a, b) => dist(a, at) - dist(b, at))[0];
    if (!next || dist(next, at) > 2.2) break;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    at = next;
  }
  sim.command({ t: 'release' });
  return 1;
}

/** Ticks until the attempt ends by its rule; `play` acts before each tick. The end and the score of the last tick. */
function playOut(sim: Simulation, id: WarmupId, play: (sim: Simulation) => void = () => {}): { end: WarmupEnd; score: number | null } {
  const w = sim.world;
  let end: WarmupEnd | null = null;
  for (let guard = 0; guard < 10_000 && !(end = warmupEnd(w, id)); guard++) { play(sim); sim.tick(); }
  assert(end, `${id}: the attempt ended`);
  return { end, score: warmupScore(w, id, end) };
}

/** The journal of the attempt replayed: the same hash and, read at its last tick, the same end and score. */
function replays(sim: Simulation, id: WarmupId, end: WarmupEnd, score: number | null): void {
  const back = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)));
  assert(back.hash() === sim.hash(), `${id}: the journal replays to the same hash`);
  const endBack = warmupEnd(back.world, id);
  assert(endBack === end && warmupScore(back.world, id, endBack) === score, `${id}: the replay's end ${endBack} and score ${warmupScore(back.world, id, endBack!)} vs ${end} ${score}`);
}

check('the layouts: three fixed arenas «Строй», «Пестрота», «Через пропасть» with their limits (20 / 45 / 30 s) and metrics; their numbers are existing `Params` keys only', () => {
  assert(WARMUP_LAYOUTS.map(l => `${l.id}:${l.title}:${l.metric}:${l.limitTicks}`).join() === 'warmup-line:Строй:chain:1200,warmup-mix:Пестрота:clearTime:2700,warmup-gap:Через пропасть:kills:1800', 'ids, titles, metrics, limits');
  for (const layout of WARMUP_LAYOUTS) {
    assert(arenaTemplate(layout.id) === layout.arena && WARMUP_ARENAS.includes(layout.arena), `${layout.id}: registered`);
    for (const key of Object.keys(layout.forced)) assert(key in DEFAULT_PARAMS, `${layout.id}: ${key} is a Params key`);
    assert(layout.arena.enemies.every(e => e.hp === 1), `${layout.id}: weak enemies`);
    const w = attempt(layout.id).world;
    assert(w.enemies.length === layout.arena.enemies.length && w.hero.hp === 15 && w.kit && Object.values(w.kit.items).every(n => n === 0), `${layout.id}: the start (enemies, HP 15, nothing in hand)`);
  }
  const line = WARMUP_LAYOUTS[0].arena.enemies, blue = line.filter(e => e.color === 2);
  assert(blue.length === 9 && line.length === 12 && new Set(line.filter(e => e.color !== 2).map(e => e.color)).size === 3, '«Строй»: nine blue and three of other colours');
  const mix = WARMUP_LAYOUTS[1].arena.enemies;
  assert(mix.length === 15 && [0, 1, 2].every(c => mix.filter(e => e.color === c).length === 5), '«Пестрота»: fifteen, five of each of three colours');
  const gap = WARMUP_LAYOUTS[2].arena.enemies;
  assert(gap.some(e => e.x < WARMUP_CLIFF.near) && gap.some(e => e.x > WARMUP_CLIFF.far), '«Через пропасть»: enemies on both banks');
  assert(warmupParams('warmup-line').maxEnemies === 0 && warmupParams('warmup-mix').maxEnemies === 0 && warmupParams('warmup-gap').maxEnemies > 0, 'inflow only in «Через пропасть»');
  assert(isWarmupId('warmup-mix') && !isWarmupId('warmup-x') && warmupLayout('warmup-gap').title === 'Через пропасть', 'ids');
});

check('«Строй»: the nine blue in one chain of real commands — score 9 at the limit (20 s); a shorter chain — its length; the journals replay to the same hash and score', () => {
  for (const n of [9, 6, 4]) {
    const sim = attempt('warmup-line'), w = sim.world, blue = w.enemies.filter(e => e.color === 2);
    assert(sim.command({ t: 'begin', x: blue[0].x, y: blue[0].y }), 'the press on the first blue');
    for (const b of blue.slice(1, n)) sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    assert(w.chain.length === n, `${n}: the chain took ${w.chain.length}`);
    sim.command({ t: 'release' });
    const { end, score } = playOut(sim, 'warmup-line');
    assert(end === 'limit' && w.tick === 1200 && score === n, `${n} links: ${end} at ${w.tick}, score ${score}`);
    replays(sim, 'warmup-line', end, score);
  }
  // Two chains — four blue, then the next three: the record is the longer one (4), not the kills (7).
  const sim = attempt('warmup-line'), w = sim.world, blue = w.enemies.filter(e => e.color === 2);
  const draw = (from: number, to: number): void => {
    const links = blue.slice(from, to);
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const b of links.slice(1)) sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    sim.command({ t: 'release' });
    for (let i = 0; i < 600 && w.move; i++) sim.tick();
  };
  draw(0, 4); draw(4, 7);
  const two = playOut(sim, 'warmup-line');
  assert(w.stats.kills === 7 && two.score === 4, `two chains: kills ${w.stats.kills}, score ${two.score}`);
  replays(sim, 'warmup-line', two.end, two.score);
});

check('«Пестрота»: greedy chains of real commands clear the field — the score is the game time to 0.1 s (lower is better); idle — no clear, no score; replays', () => {
  const times: number[] = [];
  for (const k of [1, 2, 3]) {
    const sim = attempt('warmup-mix'), every = 30 + seedOf(k) % 30;
    const { end, score } = playOut(sim, 'warmup-mix', s => { if (s.world.tick % every === 0) greedyChain(s, 6); });
    assert(end === 'clear' && score !== null && score === Math.round(sim.world.time * 10) / 10 && score > 0 && score < 45, `seed ${k}: ${end} ${score}`);
    replays(sim, 'warmup-mix', end, score);
    times.push(score);
  }
  assert(new Set(times).size > 1, `different play, different times: ${times}`);
  // The hero only walks away (no chain): the time runs out or the slow crowd kills him — no score either way.
  const idle = attempt('warmup-mix');
  const out = playOut(idle, 'warmup-mix', s => { if (s.world.tick === 0) s.command({ t: 'walk', x: 0, y: 1 }); });
  assert((out.end === 'limit' || out.end === 'death') && out.score === null, `idle: ${out.end} ${out.score}`);
  replays(idle, 'warmup-mix', out.end, out.score);
});

check('«Через пропасть»: chains, a jump over the cliff and a spin of real commands for 30 s — the score is the kills (the inflow keeps coming); a death ends it with no score; replays', () => {
  for (const k of [1, 2, 3]) {
    const sim = attempt('warmup-gap'), w = sim.world, every = 30 + seedOf(k) % 20;
    let jumped = 0, wantJump = false;
    const { end, score } = playOut(sim, 'warmup-gap', s => {
      if (w.tick % 300 === 150) wantJump = true;
      // Over the cliff when the energy allows (a jump waits for no chain and no dash).
      if (wantJump && !w.move && !w.chain.length && s.command({ t: 'jump', x: w.hero.x < 8 ? 11 : 5, y: w.hero.y })) { jumped++; wantJump = false; }
      if (w.tick % every === 0) greedyChain(s, 5);
      if (w.tick % 200 === 100 && !w.move && !w.chain.length) s.command({ t: 'spin' });
    });
    assert(end === 'limit' && w.tick === 1800 && score === w.stats.kills && score > w.arena.enemies.length / 2 && jumped > 0, `seed ${k}: ${end} at ${w.tick}, ${score} kills, jumped ${jumped}`);
    replays(sim, 'warmup-gap', end, score);
  }
  // A death after some kills: the touch made deadly by a journalled panel change at 8 s, the hero stands among them.
  const sim = attempt('warmup-gap');
  const { end, score } = playOut(sim, 'warmup-gap', s => {
    if (s.world.tick < 480 && s.world.tick % 40 === 0) greedyChain(s, 5);
    if (s.world.tick === 480) s.command({ t: 'param', key: 'contactDamage', value: 20 });
  });
  assert(end === 'death' && score === null && sim.world.stats.kills > 0 && sim.world.tick < 1800, `death: ${end} ${score} after ${sim.world.stats.kills} kills at ${sim.world.tick}`);
  replays(sim, 'warmup-gap', end, score);
});

check('the record: `warmupMerge` — the first score sets the best, a better one beats it (more links / kills, less time), a worse one or none changes nothing; `prev` stays; absent stays absent', () => {
  const none = warmupMerge(undefined, 'warmup-line', null);
  assert(none.records === undefined && none.before === null && !none.record, 'no score, no records: nothing');
  const first = warmupMerge(undefined, 'warmup-line', 7);
  assert(first.record && first.before === null && first.records?.['warmup-line']?.best === 7, 'the first score');
  const prev = first.records!, worse = warmupMerge(prev, 'warmup-line', 5), better = warmupMerge(prev, 'warmup-line', 9), same = warmupMerge(prev, 'warmup-line', 7);
  assert(!worse.record && worse.records === prev && !same.record && better.record && better.before === 7 && better.records?.['warmup-line']?.best === 9 && prev['warmup-line']?.best === 7, 'more links beat; prev unchanged');
  const t1 = warmupMerge(prev, 'warmup-mix', 12.3), t2 = warmupMerge(t1.records, 'warmup-mix', 9.8), t3 = warmupMerge(t2.records, 'warmup-mix', 10.1);
  assert(t1.record && t2.record && t2.before === 12.3 && !t3.record && t3.records?.['warmup-mix']?.best === 9.8 && t3.records?.['warmup-line']?.best === 7, 'less time beats; other layouts kept');
  assert(warmupBetter('warmup-gap', 20, 19) && !warmupBetter('warmup-gap', 19, 19) && warmupBetter('warmup-mix', 5, null), 'warmupBetter');
  const death = warmupMerge(t3.records, 'warmup-gap', null);
  assert(!death.record && death.records === t3.records, 'a death or an exit: no change');
});

check('the stored record (`isWarmupBest`): `{ best }` only — whole links / kills from 1, «Пестрота» tenths within its 45 s; anything else is rejected', () => {
  assert(isWarmupBest('warmup-line', { best: 9 }) && isWarmupBest('warmup-gap', { best: 31 }) && isWarmupBest('warmup-mix', { best: 6.1 }) && isWarmupBest('warmup-mix', { best: 45 }), 'valid');
  for (const [id, v] of [['warmup-line', { best: 0 }], ['warmup-line', { best: 2.5 }], ['warmup-gap', { best: -1 }], ['warmup-mix', { best: 0 }], ['warmup-mix', { best: 6.15 }], ['warmup-mix', { best: 45.1 }],
    ['warmup-line', { best: 9, at: 1 }], ['warmup-line', {}], ['warmup-line', null], ['warmup-x', { best: 3 }], ['warmup-line', { best: Number.NaN }], ['warmup-line', { best: '9' }]] as const) {
    assert(!isWarmupBest(id, v), `rejected: ${id} ${JSON.stringify(v)}`);
  }
});

check('fixed and repeatable: the same commands give the same world (hash) and the same score; the attempt never reads the panel beyond its values', () => {
  const run = (): { hash: string; score: number | null; world: World } => {
    const sim = attempt('warmup-gap'), every = 37;
    const { score } = playOut(sim, 'warmup-gap', s => { if (s.world.tick % every === 0) greedyChain(s, 5); });
    return { hash: sim.hash(), score, world: sim.world };
  };
  const a = run(), b = run();
  assert(a.hash === b.hash && a.score === b.score, 'the same');
});

// Telemetry (as the view feeds it): real attempts → `warmupBody` → the recorder's record `S/W/warmup`; `checkRecord`; the report's «Разминка».
{
  const local: KeyValueStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: { getItem: () => null, setItem: () => undefined }, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  let records: WarmupRecords | undefined;
  const bodies: WarmupBody[] = [];
  for (const n of [4, 9, 6]) {
    const sim = attempt('warmup-line'), w = sim.world, blue = w.enemies.filter(e => e.color === 2);
    sim.command({ t: 'begin', x: blue[0].x, y: blue[0].y });
    for (const b of blue.slice(1, n)) sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    sim.command({ t: 'release' });
    const { end, score } = playOut(sim, 'warmup-line'), merge = warmupMerge(records, 'warmup-line', score);
    records = merge.records;
    bodies.push(warmupBody('warmup-line', end, score, merge, w.time, w.time * 1.1));
  }
  const exit = attempt('warmup-gap');
  for (let i = 0; i < 300; i++) exit.tick();
  bodies.push(warmupBody('warmup-gap', 'exit', warmupScore(exit.world, 'warmup-gap', 'limit'), warmupMerge(records, 'warmup-gap', null), exit.world.time, 5));
  for (const body of bodies) rec.warmupAttempt(body, warmupParams(body.layout as WarmupId));
  await new Promise(resolve => setTimeout(resolve, 20));
  const written = (await rec.buffer.all()).filter((r): r is WarmupRecord => r.kind === 'warmup');
  assert(written.length === 4 && written.every(r => checkRecord(r) === null), `four records pass: ${written.map(r => checkRecord(r))}`);
  assert(JSON.stringify(written.map(r => [r.layout, r.end, r.score, r.before, r.record])) === JSON.stringify([['warmup-line', 'limit', 4, null, true], ['warmup-line', 'limit', 9, 4, true], ['warmup-line', 'limit', 6, 9, false], ['warmup-gap', 'exit', null, null, false]]), `the bodies: ${JSON.stringify(written.map(r => [r.layout, r.end, r.score, r.before, r.record]))}`);
  assert(written.every(r => parseRecordId(r.id)?.kind === 'warmup' && /^w[0-9a-z]+-[0-9a-f]+$/.test(r.run) && r.id.endsWith(`/${r.run}/warmup`)) && new Set(written.map(r => r.run)).size === 4, `ids \`S/W/warmup\`: ${written.map(r => r.id)}`);
  const broken = { ...written[0], record: true, score: null };
  assert(checkRecord(broken) === 'warmup record without a score' && checkRecord({ ...written[0], end: 'win' }) === 'warmup layout or end' && checkRecord({ ...written[0], gameSeconds: -1 }) === 'warmup seconds', 'broken records are refused');
  const stats = warmupStats(written), line = stats.layouts.find(l => l.layout === 'warmup-line')!, gap = stats.layouts.find(l => l.layout === 'warmup-gap')!;
  assert(stats.withWarmup === 1 && line.attempts === 3 && line.repeats === 2 && line.records === 2 && line.best === 9 && line.limit === 3 && gap.exit === 1 && gap.best === null, `the report: ${JSON.stringify(stats)}`);
  checks++; console.log('ok - telemetry: real attempts → `warmupBody` → the recorder\'s `S/W/warmup` records pass `checkRecord`; broken ones are refused; the report\'s «Разминка» counts attempts, repeats, new bests, ends');
}

console.log(`warmup: ${checks} checks passed`);
