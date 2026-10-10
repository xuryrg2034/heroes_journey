/**
 * Measure of phase A, Т5 (docs/realtime-phase-a.md, section 6): how many enemies the player sees on a big arena against
 * the same arena 16×10, by phase. The view is the camera model of the game (`view/camera.ts`, 18.4×10.3 units at
 * 1280×720, following the hero without the pointer lead); enemies in it are counted every 0.5 s of game time.
 *
 * Pairs (the same phase table on both sides): «Последний рубеж» 24×15 against its layout 16×10 before Т5, «Брод» 24×14
 * against its layout 16×10, «Большая поляна» 24×15 against «Убить 30» 16×10 (the panel's table), and since phase B, Т4
 * (docs/realtime-phase-b.md, section 9, «Д6») «Застава» 20×14 against its layout 16×10 (the panel's table). Two bots — the hero
 * stands (only his chains move him) and the hero walks (a pattern of directions, the chains as well) — on several seeds
 * (`Math.imul(k, 2654435761) >>> 0`). The hero takes no damage; 30 s of the base pace, then the goals are set and the greed
 * table runs 140 s.
 *
 * Also: the time from a marker's appearance to its enemy entering the view, and the share of markers inside the view
 * when they appear. A heuristic for the design, not a test: `npm run realtime:big-arenas` (`--seeds N`, default 4).
 */
import { arenaTemplate, FINAL_PHASES, FORD_ARCHER_SHARE, FORD_WOLF_SHARE, MIXED_KIND_SHARE, sharesOfAll, type ArenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasCamera';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { dist, polygon, pond, riverBand, tree, wall, zone, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import { areaScale, enemyLimit, scaledFloor } from '../src/realtime/sim/spawn';
import { Camera, type CameraBounds } from '../src/realtime/view/camera';

const argSeeds = process.argv.indexOf('--seeds');
const SEEDS = argSeeds > 0 ? Number(process.argv[argSeeds + 1]) : 4;
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const VIEW = { w: 18.4, h: 10.3 };
const BASE_S = 30, GREED_S = 140;

// ---- The 16×10 layouts of «Брод» and «Последний рубеж» before Т5 (arenas.ts at 7b6f624), for the comparison only ----
const ALL_FOUR = sharesOfAll([['shield', MIXED_KIND_SHARE], ['archer', MIXED_KIND_SHARE], ['sapper', MIXED_KIND_SHARE], ['porcupine', MIXED_KIND_SHARE]]);
const FORD_16: ArenaTemplate = {
  id: 'ford-16x10', name: 'Брод 16×10', summary: '', goal: 'marked', width: 16, height: 10, heroStart: { x: 2.2, y: 5 },
  obstacles: [tree(4.2, 2.8), tree(4.4, 7.4), tree(12, 2.6), tree(12.1, 7.5)],
  terrain: [riverBand([{ x: 8.2, y: 0 }, { x: 8.2, y: 0.5 }, { x: 9, y: 2.6 }, { x: 8, y: 5.4 }, { x: 9, y: 8.2 }, { x: 9, y: 10 }], 3)],
  buttons: [], door: { x: 15.3, y: 5 },
  enemies: [
    { x: 13.4, y: 2.2, color: 0, kind: 'archer', marked: true },
    { x: 13.8, y: 5.6, color: 2, kind: 'archer', marked: true },
    { x: 13.2, y: 8.6, color: 3, kind: 'archer', marked: true },
    { x: 11.2, y: 4.2, color: 1, hp: 1, kind: 'wolf', marked: true },
    { x: 11.4, y: 6.2, color: 2, hp: 1, kind: 'wolf', marked: true },
  ],
  pace: { wolfShare: FORD_WOLF_SHARE }, phaseOverride: { boarShare: 0 }, newcomers: [{ kind: 'archer', share: FORD_ARCHER_SHARE }],
};
const LAST_STAND_16: ArenaTemplate = {
  id: 'last-stand-16x10', name: 'Последний рубеж 16×10', summary: '', goal: 'kills', width: 16, height: 10, heroStart: { x: 8, y: 5 },
  obstacles: [wall(3.6, 2, 1, 2), wall(3.6, 6, 1, 2), pond(11, 5, 2.4)],
  braziers: [{ x: 8, y: 2.2 }, { x: 8, y: 7.8 }], buttons: [], door: { x: 8, y: 0.7 },
  enemies: [{ x: 2.2, y: 5, color: 3, kind: 'porcupine', elite: true }, { x: 6, y: 8.8, color: 0, kind: 'sapper', elite: true }],
  phaseOverride: { wolfShare: 0, boarShare: 0 }, phases: FINAL_PHASES.map(phase => ({ ...phase })), killGoal: 40, newcomers: ALL_FOUR,
};
/** «Застава» 16×10 before phase B, Т4 (arenas.ts at 5890f3c), for the comparison only. */
const OUTPOST_16: ArenaTemplate = {
  id: 'outpost-16x10', name: 'Застава 16×10', summary: '', goal: 'kills', width: 16, height: 10, heroStart: { x: 8, y: 8.9 },
  obstacles: [wall(5.6, 2.2, 1.4, 1), wall(9, 2.2, 4.4, 1), wall(12.4, 3.2, 1, 4.2), wall(2.2, 6.4, 4.8, 1), wall(9, 6.4, 3.4, 1)],
  terrain: [zone('cliff', polygon(0, 0, 3, 0, 3.4, 2, 3, 4.5, 3.5, 6, 2.4, 7.4, 0, 7.6))],
  buttons: [], door: { x: 8, y: 0.7 },
  enemies: [{ x: 7.2, y: 4.4, color: 1, kind: 'shield', elite: true }, { x: 9.4, y: 3.6, color: 2, kind: 'archer', elite: true }],
  phaseOverride: { wolfShare: 0, boarShare: 0 }, killGoal: 30, newcomers: ALL_FOUR,
};

/**
 * The hero cannot fall; the fight never ends by itself: a huge kill goal (the goals are set by command) and the door far
 * outside the arena (the walking bot would step into it).
 */
function harmless(): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  return p;
}
const endless = (a: ArenaTemplate): ArenaTemplate => ({ ...a, id: `${a.id}-measure`, killGoal: a.goal === 'kills' ? 100000 : a.killGoal, door: { x: -100, y: -100 } });

/** The greedy chain of the bots of the specs (sliceArenas.spec.ts). */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

interface Tally { inView: number[]; total: number[]; samples: number[]; latency: number[]; markersSeen: number; markersInView: number; spawnedInView: number; spawned: number }
const PHASES = 6; // -1 (base) → 0, greed phases 0..4 → 1..5
const newTally = (): Tally => ({ inView: Array(PHASES).fill(0), total: Array(PHASES).fill(0), samples: Array(PHASES).fill(0), latency: [], markersSeen: 0, markersInView: 0, spawnedInView: 0, spawned: 0 });

function measure(template: ArenaTemplate, bot: 'stand' | 'walk', k: number, t: Tally): void {
  const arena = endless(template);
  const sim = new Simulation({ arena, params: harmless(), seed: seedOf(k) }), w = sim.world;
  const b: CameraBounds = { viewW: VIEW.w, viewH: VIEW.h, arenaW: arena.width, arenaH: arena.height };
  const cam = new Camera();
  cam.snap(w.hero, b);
  const markers = new Map<number, { x: number; y: number; born: number }>();
  const pending = new Map<number, number>();
  const total = (BASE_S + GREED_S) * 60;
  for (let tick = 0; tick < total && w.status === 'playing'; tick++) {
    if (bot === 'walk' && tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick === BASE_S * 60) sim.command({ t: 'goals' });
    if (tick % 40 === 15) playChain(sim);
    const before = new Map(markers);
    sim.tick();
    cam.update(1 / 60, w.hero, null, false, b);
    for (const m of w.markers) if (!markers.has(m.id) && m.kind !== 'reaper') {
      markers.set(m.id, { x: m.x, y: m.y, born: tick });
      t.markersSeen++;
      if (cam.sees(m, b)) t.markersInView++;
    }
    for (const m of w.markers) { const old = markers.get(m.id); if (old) { old.x = m.x; old.y = m.y; } }
    const live = new Set(w.markers.map(m => m.id));
    for (const ev of w.events) {
      if (ev.type !== 'spawn') continue;
      const e = w.enemies.find(x => x.id === ev.enemyId);
      if (!e) continue;
      let best: number | null = null, bd = Infinity;
      for (const [id, m] of before) if (!live.has(id)) { const d = dist(m, e); if (d < bd) { bd = d; best = id; } }
      if (best === null || bd > 1) continue;
      pending.set(e.id, before.get(best)!.born);
      markers.delete(best);
      t.spawned++;
      if (cam.sees(e, b)) t.spawnedInView++;
    }
    w.events.length = 0;
    for (const [id, born] of pending) {
      const e = w.enemies.find(x => x.id === id);
      if (!e) { pending.delete(id); continue; }
      if (cam.sees(e, b)) { t.latency.push((tick - born) / 60); pending.delete(id); }
    }
    if (tick % 30 === 0) {
      const ph = w.pressure.phaseIndex + 1;
      const enemies = w.enemies.filter(e => e.kind !== 'reaper');
      t.inView[ph] += enemies.filter(e => cam.sees(e, b)).length;
      t.total[ph] += enemies.length;
      t.samples[ph]++;
    }
  }
}

const PAIRS: [big: ArenaTemplate, small: ArenaTemplate][] = [
  [arenaTemplate('last-stand'), LAST_STAND_16],
  [arenaTemplate('ford'), FORD_16],
  [arenaTemplate('big-clearing'), arenaTemplate('kills')],
  [arenaTemplate('outpost'), OUTPOST_16],
];
const avg = (xs: number[]): number => xs.reduce((a, c) => a + c, 0) / Math.max(1, xs.length);
const pctl = (xs: number[], q: number): number => { const s = [...xs].sort((a, c) => a - c); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const f1 = (x: number): string => Number.isFinite(x) ? x.toFixed(1) : '—';

console.log(`Т5 measure: ${SEEDS} seeds per bot, view ${VIEW.w}×${VIEW.h}, base ${BASE_S} s + greed ${GREED_S} s`);
for (const [big, small] of PAIRS) {
  const p = defaultParams();
  console.log(`\n== ${big.name} ${big.width}×${big.height} (s ${areaScale(big).toFixed(3)}, limit ${enemyLimit(p, big)}) vs ${small.name} ${small.width}×${small.height}`);
  for (const bot of ['stand', 'walk'] as const) {
    const tb = newTally(), ts = newTally();
    for (let k = 1; k <= SEEDS; k++) { measure(big, bot, 500 + k, tb); measure(small, bot, 500 + k, ts); }
    const rows: string[] = [];
    for (let ph = 0; ph < PHASES; ph++) {
      if (!tb.samples[ph] || !ts.samples[ph]) continue;
      const vb = tb.inView[ph] / tb.samples[ph], vs = ts.inView[ph] / ts.samples[ph];
      const ab = tb.total[ph] / tb.samples[ph], as = ts.total[ph] / ts.samples[ph];
      const table = ph === 0 ? null : (big.phases ?? p.phases)[ph - 1];
      const floor = table ? `floor ${table.floor}→${scaledFloor(table.floor, big)}` : 'base';
      rows.push(`   ${ph === 0 ? 'base ' : `ph ${ph - 1}`} (${floor}): in view ${f1(vb)} vs ${f1(vs)} (${vs ? ((vb / vs - 1) * 100).toFixed(0) : '—'}%), on the arena ${f1(ab)} vs ${f1(as)}`);
    }
    const vbAll = tb.inView.reduce((a, c) => a + c, 0) / tb.samples.reduce((a, c) => a + c, 0);
    const vsAll = ts.inView.reduce((a, c) => a + c, 0) / ts.samples.reduce((a, c) => a + c, 0);
    console.log(` bot «${bot}»: in view overall ${f1(vbAll)} vs ${f1(vsAll)} (${((vbAll / vsAll - 1) * 100).toFixed(0)}%)`);
    for (const r of rows) console.log(r);
    console.log(`   marker → enemy in view: big mean ${tb.latency.length ? avg(tb.latency).toFixed(2) : '—'} s (p90 ${pctl(tb.latency, 0.9).toFixed(2)}), small mean ${avg(ts.latency).toFixed(2)} s; markers in view when they appear: big ${(100 * tb.markersInView / Math.max(1, tb.markersSeen)).toFixed(0)}% of ${tb.markersSeen}, small ${(100 * ts.markersInView / Math.max(1, ts.markersSeen)).toFixed(0)}% of ${ts.markersSeen}; enemies in view when they step out: big ${(100 * tb.spawnedInView / Math.max(1, tb.spawned)).toFixed(0)}%`);
  }
}
