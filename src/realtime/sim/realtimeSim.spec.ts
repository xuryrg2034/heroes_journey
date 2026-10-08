/**
 * Determinism and data of the real-time simulation core (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»). Node only, no browser: `npm run test:realtime-sim`.
 *
 * - a minute and more of real play through commands only (walking, chains, a 7-kill chain with a crystal, a chain
 *   through crystals, a jump, a boar's charge, a panel value changed mid-fight) replays from its journal to the same
 *   world hash, checkpoint after checkpoint; the JSON journal replays the same;
 * - a second run covers the greed stage, its phase table and the reaper;
 * - different seeds bring different newcomers; the same seed brings the same ones;
 * - the runner: a frame pays real time for whole ticks of 1/60 s of game time — four frames per tick in focus, the
 *   hit-stop freezes ticks, a stall is not caught up; the frame pattern does not change the world;
 * - a test enemy kind (own behaviour, size, damage, mass) and a test arena (own pace, phase table, newcomers) are
 *   registered from here — the core is not edited;
 * - a journal recorded in the browser (tests/fixtures/realtime-browser-journal.json, written by tests/realtime.spec.ts)
 *   replays to its hash.
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import { registerArena } from './arenas';
import { canJump, chainAnchor, jumpLanding, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { registerBehavior, registerEnemyKind } from './enemies/index';
import { dist, wall } from './geometry';
import { copyParams, defaultParams, type Params } from './params';
import { MAX_TICKS_PER_FRAME, SIM_DT, Simulation, replay, type Journal } from './simulation';
import type { World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  console.log(`ok - ${name}`);
}

// ---- A bot that plays through commands only ----

interface Played { sim: Simulation; checkpoints: string[]; events: Record<string, number> }

/** Builds the longest chain it greedily can from the hero (enemies and crystals), then releases it. */
function playChain(sim: Simulation): boolean {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return false;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return false;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  if (!w.chain.length) return false;
  for (let k = 0; k < 16; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from = chainAnchor(w);
    const targets = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'crystal')];
    const next = targets.sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
  return true;
}

const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

/** Plays `ticks` ticks of arena `arena`; `script` adds scheduled commands. Hashes every 300 ticks. */
function play(arena: string, seed: number, params: Params, ticks: number, script: (sim: Simulation, tick: number) => void): Played {
  const sim = new Simulation({ arena, params, seed, record: true });
  const checkpoints: string[] = [];
  const events: Record<string, number> = {};
  for (let tick = 0; tick < ticks; tick++) {
    const w = sim.world;
    if (tick % 60 === 0) {
      const [x, y] = WALK[(tick / 60) % WALK.length];
      sim.command({ t: 'walk', x, y });
    }
    script(sim, tick);
    if (tick % 45 === 20) playChain(sim);
    sim.tick();
    for (const ev of w.events) events[ev.type] = (events[ev.type] ?? 0) + 1;
    w.events.length = 0;
    if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash());
  }
  return { sim, checkpoints, events };
}

function replayed(journal: Journal): { sim: Simulation; checkpoints: string[] } {
  const checkpoints: string[] = [];
  const sim = replay(journal, s => {
    s.world.events.length = 0;
    if (s.world.tick % 300 === 0) checkpoints.push(s.hash());
  });
  return { sim, checkpoints };
}

/** Seven weak enemies of one colour on a ring around the hero (each within R of the next), then a chain through all. */
function ringChain(sim: Simulation, color: number): void {
  const w = sim.world;
  sim.command({ t: 'cancel' });
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const ring: { x: number; y: number }[] = [];
  for (let k = 0; k < 7; k++) ring.push({ x: 8 + 1.2 * Math.cos(k * 2 * Math.PI / 7), y: 5 + 1.2 * Math.sin(k * 2 * Math.PI / 7) });
  for (const p of ring) sim.command({ t: 'place', x: p.x, y: p.y, color, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: ring[0].x, y: ring[0].y });
  for (const p of ring.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length >= 7, `the ring chain took ${w.chain.length} links`);
  sim.command({ t: 'release' });
}

function longRunParams(): Params {
  const p = defaultParams();
  p.heroHp = 40;
  p.killGoal = 200; // the door stays closed: the minute is spent fighting
  return p;
}

let longRun: Played;

check('a minute of play through commands replays from its journal to the same hash at every checkpoint', () => {
  const ticks = 4200;
  const jumpedAt: number[] = [];
  longRun = play('kills', 20261008, longRunParams(), ticks, (sim, tick) => {
    const w = sim.world;
    if (tick === 600) ringChain(sim, 2);
    if (tick === 1500) sim.command({ t: 'param', key: 'heroAnchor', value: true });
    if (tick === 1800) {
      sim.command({ t: 'cancel' });
      sim.command({ t: 'place', x: Math.min(14, w.hero.x + 3.4), y: w.hero.y, color: 1, hp: 2, kind: 'boar' });
    }
    if (tick === 2390) sim.command({ t: 'energy', value: 4 });
    if (tick >= 2400 && tick < 2460 && !jumpedAt.length && canJump(w)) {
      for (const [dx, dy] of [[-2.5, 0], [2.5, 0], [0, 2.5], [0, -2.5]]) {
        const p = { x: w.hero.x + dx, y: w.hero.y + dy };
        if (jumpLanding(w, p) && sim.command({ t: 'jump', x: p.x, y: p.y })) { jumpedAt.push(tick); break; }
      }
    }
    if (tick === 3000) ringChain(sim, 0);
  });
  const { sim, checkpoints, events } = longRun;
  const w = sim.world;
  assert(w.tick === ticks && ticks >= 3600, `ticks ${w.tick}`);
  assert(w.status === 'playing' && w.time > 60, `the hero should still fight after a minute: ${w.status}, ${w.time.toFixed(1)} s`);
  assert(w.stats.kills >= 20, `kills ${w.stats.kills}`);
  assert(w.stats.crystals >= 2, `crystals dropped ${w.stats.crystals}`);
  assert((events.crystalBreak ?? 0) >= 1, 'a chain went through a crystal');
  assert(jumpedAt.length === 1 && (events.jump ?? 0) === 1, 'one jump');
  assert((events.boarCharge ?? 0) >= 1, 'the boar announced a charge');
  assert((events.chainEnd ?? 0) >= 10, `chains ${events.chainEnd}`);
  assert(w.params.heroAnchor, 'the param command changed the live value');
  const journal = sim.exportJournal()!;
  assert(journal.ticks === ticks && journal.commands.length > 100, `journal: ${journal.commands.length} commands`);
  const again = replayed(journal);
  assert(again.checkpoints.length === checkpoints.length, 'checkpoint count');
  checkpoints.forEach((h, i) => assert(again.checkpoints[i] === h, `checkpoint ${(i + 1) * 300}: ${again.checkpoints[i]} ≠ ${h}`));
  assert(again.sim.hash() === sim.hash(), 'final hash');
  // The journal is plain JSON: a file replays the same.
  const fromText = replayed(JSON.parse(JSON.stringify(journal)) as Journal);
  assert(fromText.sim.hash() === sim.hash(), 'JSON journal hash');
  console.log(`   ${ticks} ticks, ${w.time.toFixed(1)} s, kills ${w.stats.kills}, crystals ${w.stats.crystals}, chains ${events.chainEnd}, commands ${journal.commands.length}, hash ${sim.hash()}`);
});

check('the greed stage, its phase table and the reaper replay the same', () => {
  const p = defaultParams();
  p.heroHp = 40; p.reaperEnabled = true; p.reaperTime = 10;
  const run = play('marked', 77, p, 2400, (sim, tick) => { if (tick === 120) sim.command({ t: 'goals' }); });
  const w = run.sim.world;
  assert(w.stage === 'greed' && w.pressure.phaseIndex >= 1, `phase ${w.pressure.phaseIndex}`);
  assert(w.reaperSpawned, 'the reaper came');
  const again = replayed(run.sim.exportJournal()!);
  run.checkpoints.forEach((h, i) => assert(again.checkpoints[i] === h, `checkpoint ${(i + 1) * 300}`));
  assert(again.sim.hash() === run.sim.hash(), 'final hash');
});

/** The first newcomers of a quiet fight: kind, colour, HP and place of every marker set in the first 4 s. */
function newcomers(seed: number): string[] {
  const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed });
  const seen = new Map<number, string>();
  for (let i = 0; i < 240; i++) {
    sim.tick();
    for (const m of sim.world.markers) if (!seen.has(m.id)) seen.set(m.id, `${m.kind}/${m.color}/${m.hp}@${m.x.toFixed(2)},${m.y.toFixed(2)}`);
  }
  return [...seen.values()];
}

check('different seeds bring different newcomers; the same seed the same ones', () => {
  const seeds = [1, 2, 3, 4, 5, 1234567];
  const lists = seeds.map(newcomers);
  for (const list of lists) assert(list.length >= 20, `newcomers ${list.length}`);
  for (let i = 0; i < lists.length; i++) for (let j = i + 1; j < lists.length; j++) {
    const shared = lists[i].filter(x => lists[j].includes(x)).length;
    assert(shared < lists[i].length / 4, `seeds ${seeds[i]} and ${seeds[j]} share ${shared} of ${lists[i].length} newcomers`);
  }
  // Colours vary within a seed too (not one colour per seed).
  for (const list of lists) assert(new Set(list.map(x => x.split('/')[1])).size >= 3, 'colours of one seed');
  assert(JSON.stringify(newcomers(3)) === JSON.stringify(lists[2]), 'same seed, same newcomers');
});

// ---- The runner: frames, focus, hit-stop ----

function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 20; p.baseIntervalMax = 20; p.enemySpeed = 0; p.speedSpread = 0;
  return p;
}

check('a frame pays real time for whole ticks: 1/60 s of game time each, four frames per tick in focus', () => {
  const sim = new Simulation({ arena: 'kills', params: quiet(), seed: 5 });
  for (let i = 0; i < 60; i++) assert(sim.advance(1 / 60) === 1, `normal frame ${i}`);
  assert(sim.world.tick === 60 && near(sim.world.time, 60 * SIM_DT, 1e-9), `time ${sim.world.time}`);
  // Focus: a chain is held — the same real second runs a quarter of the ticks and of the game time.
  sim.command({ t: 'clear', keepMarked: false });
  const id = sim.command({ t: 'place', x: sim.world.hero.x + 1, y: sim.world.hero.y, color: 0, hp: 0, kind: 'basic' }) as number;
  sim.command({ t: 'begin', x: sim.world.hero.x + 1, y: sim.world.hero.y });
  assert(sim.world.chain.length === 1 && sim.world.chain[0].id === id, 'chain started');
  const t0 = sim.world.time, focus0 = sim.world.focus;
  let ran = 0;
  for (let i = 0; i < 60; i++) ran += sim.advance(1 / 60);
  assert(ran === 15, `ticks in a focused second: ${ran}`);
  assert(near(sim.world.time - t0, 15 * SIM_DT, 1e-9), 'game time in focus');
  assert(near(focus0 - sim.world.focus, 1, 1e-6), `focus spent ${focus0 - sim.world.focus}`);
  // A stall is not caught up: one frame runs at most MAX_TICKS_PER_FRAME ticks.
  sim.command({ t: 'cancel' });
  assert(sim.advance(5) === MAX_TICKS_PER_FRAME, 'stall');
});

check('the hit-stop freezes whole ticks: no game time passes until it runs out', () => {
  const sim = new Simulation({ arena: 'kills', params: quiet(), seed: 6 });
  sim.command({ t: 'clear', keepMarked: false });
  const { x, y } = sim.world.hero;
  sim.command({ t: 'place', x: x + 1, y, color: 0, hp: 0, kind: 'basic' });
  sim.command({ t: 'begin', x: x + 1, y });
  sim.command({ t: 'release' });
  let guard = 0;
  while (sim.world.hitstop <= 0 && guard++ < 60) sim.tick();
  const stop = sim.world.hitstop, time = sim.world.time;
  assert(stop > 0 && sim.world.stats.kills === 1, 'the kill set a hit-stop');
  const frozen = Math.ceil(stop / SIM_DT - 1e-9);
  for (let i = 0; i < frozen; i++) { sim.tick(); assert(sim.world.time === time, `frozen tick ${i}`); }
  assert(sim.world.hitstop === 0, 'hit-stop spent');
  sim.tick();
  assert(sim.world.time > time, 'time runs again');
});

check('the frame pattern does not change the world: the same commands by tick give the same hash', () => {
  const journal = longRun.sim.exportJournal()!;
  const cut: Journal = { ...journal, ticks: 1500, commands: journal.commands.filter(c => c.tick <= 1500) };
  const reference = replay(cut).hash();
  // Live runs with jittery frames: commands applied between frames at the ticks the journal names.
  for (const frames of [[1 / 60], [1 / 144, 1 / 30, 1 / 75], [0.05, 0.001, 0.02]]) {
    const sim = new Simulation({ arena: cut.arena, params: copyParams(cut.params), seed: cut.seed });
    let next = 0, f = 0;
    const apply = () => { while (next < cut.commands.length && cut.commands[next].tick <= sim.world.tick) sim.command(cut.commands[next++].cmd); };
    while (sim.world.tick < cut.ticks) {
      apply();
      // One tick at a time so each tick's commands come before it, whatever the frame length.
      const before = sim.world.tick;
      sim.advance(frames[f++ % frames.length], 1);
      if (sim.world.tick === before) continue;
    }
    apply();
    assert(sim.hash() === reference, `frames ${frames.join(', ')}`);
  }
});

// ---- Data: a test kind and a test arena, registered from here ----

registerBehavior({
  id: 'test-drift',
  onSpawn(_world, e) { e.vars.dir = 1; },
  // Drifts right at 1 u/s whatever the hero does; counts its own steps.
  step(_world, e, dt) { e.x += e.vars.dir * dt; e.vars.steps = (e.vars.steps ?? 0) + 1; return true; },
});
registerEnemyKind({
  id: 'test-stone',
  behavior: 'test-drift',
  hp: () => 3,
  speed: () => 0,
  bodyScale: 1.5,
  artScale: 1.5,
  touchDamage: () => 2,
  mass: () => 4,
  spread: false,
  chainable: true,
  hitSource: 'stone',
});
registerArena({
  id: 'test-yard',
  name: 'Тестовый двор',
  summary: 'Регистрация из теста',
  goal: 'marked',
  width: 10,
  height: 8,
  heroStart: { x: 5, y: 4 },
  obstacles: [wall(1, 6, 2, 1)],
  buttons: [],
  door: { x: 9.3, y: 4 },
  enemies: [{ x: 3, y: 4, color: 1, hp: 3, kind: 'test-stone', marked: true }],
  pace: { floor: 0, intervalMin: 20, intervalMax: 20, toughShare: 0, wolfShare: 0, boarShare: 0 },
  phases: [{ duration: 30, floor: 5, intervalMin: 1, intervalMax: 1, toughShare: 0, wolfShare: 0, boarShare: 0 }],
  newcomers: [{ kind: 'test-stone', share: 1 }],
});

check('a test enemy kind and a test arena registered from the test run in the unchanged core', () => {
  const p = defaultParams();
  p.markerDelay = 0.5;
  const sim = new Simulation({ arena: 'test-yard', params: p, seed: 9 });
  const w: World = sim.world;
  const stone = w.enemies[0];
  assert(w.enemies.length === 1 && stone.kind === 'test-stone' && stone.marked && stone.hp === 3, 'start enemy of the template');
  const events: WorldEvent[] = [];
  for (let i = 0; i < 60; i++) { sim.tick(); events.push(...w.events); w.events.length = 0; }
  // Its own behaviour: 1 u/s to the right for one game second, every step its own.
  assert(near(stone.x, 4, 1e-6) && stone.vars.steps === 60, `drift: x ${stone.x}, steps ${stone.vars.steps}`);
  for (let i = 0; i < 60; i++) { sim.tick(); events.push(...w.events); w.events.length = 0; }
  // Its own size and damage: it touches the hero at the larger touch distance and hits for 2.
  const hits = events.filter(e => e.type === 'hit');
  assert(hits.length >= 1 && hits.every(h => h.type === 'hit' && h.damage === 2 && h.source === 'stone' && h.enemyId === stone.id), `hits ${JSON.stringify(hits)}`);
  assert(w.hero.hp === w.hero.maxHp - 2 * hits.length, 'hero hp');
  // It stopped at its own (larger) touch distance: 0.28 + 0.32 × 1.5 × 0.8.
  assert(near(dist(stone, w.hero), 0.28 + 0.32 * 1.5 * 0.8, 1e-6), `touch distance ${dist(stone, w.hero)}`);
  // The template's own pace before the goals: one group at the start, no density floor (the panel says 28).
  const present = () => w.enemies.length + w.markers.length + w.queue.length;
  const startGroup = present() - 1;
  assert(startGroup >= 2 && startGroup <= 4, `first group ${startGroup}`);
  // Newcomers come as the template's kind.
  for (let i = 0; i < 60; i++) sim.tick();
  assert(w.enemies.length === startGroup + 1 && w.enemies.every(e => e.kind === 'test-stone'), `newcomers of the template kind: ${JSON.stringify(w.enemies.map(e => e.kind))}, markers ${w.markers.length}, queue ${w.queue.length}, group ${startGroup}`);
  // The template's own phase table after the goals: floor 5 (the panel's first phase says 30).
  sim.command({ t: 'goals' });
  for (let i = 0; i < 120; i++) sim.tick();
  assert(w.pressure.phase.floor === 5 && present() >= 5, `greed floor ${w.pressure.phase.floor}, present ${present()}`);
  assert(w.enemies.every(e => e.kind === 'test-stone'), 'greed newcomers of the template kind');
  // Unknown ids fail loudly instead of falling back silently.
  let threw = false;
  try { sim.command({ t: 'place', x: 2, y: 2, color: 0, hp: 0, kind: 'no-such-kind' }); } catch { threw = true; }
  assert(threw, 'unknown kind');
});

// ---- A journal recorded in the browser ----

check('a journal recorded in the browser replays in Node to the browser hash', () => {
  // Re-record after a change of the simulation: RT_RECORD_JOURNAL=1 npx playwright test -c playwright.realtime.config.ts -g journal
  const fixture = browserJournal as unknown as { journal: Journal; hash: string };
  const sim = replay(fixture.journal);
  assert(sim.hash() === fixture.hash, `browser ${fixture.hash}, Node ${sim.hash()} after ${fixture.journal.ticks} ticks`);
  console.log(`   ${fixture.journal.ticks} ticks, ${fixture.journal.commands.length} commands, hash ${fixture.hash}`);
});

// ---- Cost ----

check('cost of a tick with 60 enemies (report only)', () => {
  const p = defaultParams();
  p.contactDamage = 0; p.boarDamage = 0; p.baseFloor = 60;
  const sim = new Simulation({ arena: 'kills', params: p, seed: 11 });
  sim.command({ t: 'burst', count: 60 });
  for (let i = 0; i < 300; i++) sim.tick();
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) { sim.command({ t: 'walk', x: Math.cos(i / 60), y: Math.sin(i / 60) }); sim.tick(); }
  console.log(`   ${sim.world.enemies.length} enemies: ${((performance.now() - t0) / 600).toFixed(3)} ms per tick`);
});

console.log(`realtime-sim: ${checks} checks passed`);
