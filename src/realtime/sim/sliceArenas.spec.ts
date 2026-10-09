/**
 * The mixed arenas 8–10 of the slice (stage 2 of the transition, step 4; docs/realtime-slice.md, sections 5 and 11,
 * «Шаг 4»): «Брод», «Застава» (the hard battle), «Последний рубеж» (the final of the run). Node only:
 * `npm run test:realtime-arenas`.
 *
 * Every check plays the simulation through journalled commands (walk, teleport, place, item, items, goals, phases …) and
 * looks at what the player meets: the goal and its count, who stands on the arena from the start, which kinds come and
 * how often, the water, the door, how dense the greed stage is. Seeds are spread (`Math.imul(k, 2654435761) >>> 0`); the
 * last check replays a bot's fight on each arena from its journal to the same hash.
 */
import { arenaTemplate, FINAL_PHASES, MIXED_KIND_SHARE, type ArenaTemplate } from './arenas';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist, inWater, type Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { doorOpen, goalProgress, type Enemy, type World } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, enemies stand (speed 0), touches do not hurt — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}
/** A fight where the hero cannot fall: the arena's own pace and table, no damage to him (elites add nothing either). */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 40; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0;
  return Object.assign(p, extra);
}
const place = (sim: Simulation, x: number, y: number, kind: string, color = 0, hp = 0): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) sim.tick(); };
function runUntil(sim: Simulation, until: () => boolean, max = 600): number {
  let n = 0;
  while (n < max && !until() && sim.world.status === 'playing') { sim.tick(); n++; }
  return n;
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Read through a function: a value narrowed by an assertion stays readable after a command changes it. */
const statusOf = (w: World): string => w.status;
const stageOf = (w: World): string => w.stage;

/** Kinds of the newcomers that stepped out in `seconds` on `arena` (its own pace and table; the hero cannot fall). */
function newcomerKinds(arena: string, seed: number, seconds: number): string[] {
  const sim = new Simulation({ arena, params: harmless(), seed }), seen = new Map<number, string>();
  const start = new Set(sim.world.enemies.map(e => e.id));
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick();
    // A newcomer killed in the tick it stepped out (an arrow, a blast) is gone before it can be looked at: it is skipped.
    for (const ev of sim.world.events) {
      const kind = ev.type === 'spawn' && !start.has(ev.enemyId) ? sim.world.enemies.find(e => e.id === ev.enemyId)?.kind : undefined;
      if (ev.type === 'spawn' && kind) seen.set(ev.enemyId, kind);
    }
    sim.world.events.length = 0;
  }
  return [...seen.values()];
}
function composition(arena: string): { share: (kind: string) => number; kinds: Set<string>; total: number } {
  const all = [1, 2, 3, 4, 5, 6].flatMap(k => newcomerKinds(arena, seedOf(k + 60), 25));
  return { share: kind => all.filter(x => x === kind).length / all.length, kinds: new Set(all), total: all.length };
}
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
/** The start elites of an arena as the player meets them. */
const startElites = (w: World): Enemy[] => w.enemies.filter(e => e.elite === true);

// ---- Arena 8 «Брод» ----

check('«Брод»: five marked — three archers on the far bank, two wolves at the water; the river (stage 3a, step 2; a big pond before) slows walking and the arrows fly over it', () => {
  const sim = new Simulation({ arena: 'ford', params: quiet(), seed: seedOf(1), record: true }), w = sim.world;
  const goal = goalProgress(w), marked = w.enemies.filter(e => e.marked);
  assert(goal.label === 'отмеченные' && goal.total === 5, `goal ${goal.label} ${goal.total}`);
  assert(marked.filter(e => e.kind === 'archer').length === 3 && marked.filter(e => e.kind === 'wolf').length === 2, `marked: ${marked.map(e => e.kind)}`);
  // Phase A, Т5 (24×14): the river spans x ≈ 10.5–14.9 at its widest bends; the far bank is east of it.
  assert(marked.every(e => e.x > 14.9 && !inWater(e, w.arena)), 'the marked stand on the far bank');
  // The hero walks one second on the bank and one in the river: the water slows him by its factor.
  const walked = (from: Vec): number => {
    sim.command({ t: 'teleport', x: from.x, y: from.y });
    sim.command({ t: 'walk', x: 0, y: 1 });
    ticks(sim, 30);
    sim.command({ t: 'walk', x: 0, y: 0 });
    return Math.abs(w.hero.y - from.y);
  };
  const dry = walked({ x: 3.3, y: 5.6 }), wet = walked({ x: 12.6, y: 5.6 });
  assert(inWater({ x: 12.6, y: 5.6 }, w.arena) && Math.abs(wet / dry - w.params.waterSlow) < 0.05, `in the water ${wet.toFixed(2)} vs ${dry.toFixed(2)} on the bank`);
  console.log(`   0.5 s of walking: ${dry.toFixed(2)} on the bank, ${wet.toFixed(2)} in the river`);
  // An archer on the far bank, the hero on this one: the water does not hide him — the archer marks him across the river
  // (phase A, Т6: the point shot), the arrow hurts him.
  const shot = new Simulation({ arena: 'ford', params: quiet({ archerFirstDelay: 0.5 }), seed: seedOf(2), record: true }), sw = shot.world;
  shot.command({ t: 'clear', keepMarked: false });
  shot.command({ t: 'teleport', x: 9.4, y: 7 });
  const archer = place(shot, 16.4, 7, 'archer', 0);
  runUntil(shot, () => archer.vars.aim === 1);
  assert(archer.vars.pt === 1 && archer.vars.ax === sw.hero.x && archer.vars.ay === sw.hero.y, 'across the river the archer marks the hero');
  runUntil(shot, () => archer.vars.aim !== 1);
  assert(sw.hero.hp === sw.hero.maxHp - 1, 'the arrow across the river hits the hero');
  assert(replays(sim) && replays(shot), 'replay');
});

check('«Брод»: newcomers are archers (15% of the rolls of single newcomers, about 12% of all with the packs), wolf packs and basic enemies — no boars, no other kinds', () => {
  const { share, kinds, total } = composition('ford');
  assert(total >= 150 && share('archer') > 0.07 && share('archer') < 0.25, `archers ${pct(share('archer'))} of ${total}`);
  assert(share('wolf') > 0.1, `wolves ${pct(share('wolf'))} of ${total}`);
  assert([...kinds].every(kind => ['basic', 'archer', 'wolf'].includes(kind)), `kinds ${[...kinds].join(', ')}`);
  console.log(`   ${total} newcomers: archers ${pct(share('archer'))}, wolves ${pct(share('wolf'))}, basic ${pct(share('basic'))}`);
});

// ---- Arena 9 «Застава» ----

check('«Застава»: kill 30; two elites of the template (a shieldbearer and an archer) in the yard from the start; all four new kinds come', () => {
  const sim = new Simulation({ arena: 'outpost', params: quiet(), seed: seedOf(3) }), w = sim.world;
  const goal = goalProgress(w), elites = startElites(w);
  assert(goal.label === 'убито' && goal.total === 30, `goal ${goal.label} ${goal.total}`);
  assert(elites.length === 2 && elites.map(e => e.kind).sort().join() === 'archer,shield', `elites from the start: ${elites.map(e => e.kind)}`);
  // HP ×2 (the shieldbearer 1 → 2; the weak archer 0 → 1).
  assert(elites.find(e => e.kind === 'shield')!.hp === 2 && elites.find(e => e.kind === 'archer')!.hp === 1, `elite HP ${elites.map(e => e.hp)}`);
  const { share, kinds, total } = composition('outpost');
  for (const kind of ['shield', 'archer', 'sapper', 'porcupine']) assert(share(kind) > MIXED_KIND_SHARE * 0.4 && share(kind) < MIXED_KIND_SHARE * 1.8, `${kind} ${pct(share(kind))} of ${total}`);
  assert(total >= 150 && [...kinds].every(kind => ['basic', 'shield', 'archer', 'sapper', 'porcupine'].includes(kind)), `kinds ${[...kinds].join(', ')}`);
  console.log(`   ${total} newcomers: ${['shield', 'archer', 'sapper', 'porcupine', 'basic'].map(kind => `${kind} ${pct(share(kind))}`).join(', ')}`);
});

check('«Застава»: the start elites drop the loot of a template elite — about half a consumable open in the run, else nothing (never a resource)', () => {
  let items = 0, none = 0;
  for (let k = 1; k <= 40; k++) {
    const sim = new Simulation({ arena: 'outpost', params: quiet(), seed: seedOf(300 + k), record: true, loadout: { items: { bomb: 1 }, openItems: ['frost'] } }), w = sim.world;
    const elite = startElites(w)[k % 2];
    sim.command({ t: 'teleport', x: elite.x, y: elite.y + 2.5 });
    assert(sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y }) === true && !alive(w, elite), 'the bomb kills the elite');
    const loot = w.objects.filter(o => o.kind === 'loot');
    assert(loot.length <= 1 && (!loot.length || loot[0].loot === 'frost'), `the loot of a template elite: ${loot.map(o => o.loot)}`);
    if (loot.length) items++; else none++;
    if (k <= 2) assert(replays(sim), 'replay');
  }
  assert(items >= 10 && items <= 30, `consumables ${items} of 40 (nothing ${none})`);
  console.log(`   a template elite of «Застава» killed by a bomb: a consumable ${items} of 40, nothing ${none}`);
});

// ---- Arena 10 «Последний рубеж» ----

check('«Последний рубеж»: kill 40 — the door stays shut until the fortieth kill, then opens and the hero walks out to victory', () => {
  const sim = new Simulation({ arena: 'last-stand', params: quiet(), seed: seedOf(4), record: true, loadout: { items: { bomb: 40 } } }), w = sim.world;
  const elites = startElites(w);
  assert(elites.length === 2 && elites.map(e => e.kind).sort().join() === 'porcupine,sapper', `elites from the start: ${elites.map(e => e.kind)}`);
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 12, y: 7.5 });
  const door = w.objects.find(o => o.kind === 'door')!;
  // Thirty-nine kills by the bomb (the player's item): the goal is not done, walking at the door does not let the hero out.
  for (let n = 0; n < 40; n++) {
    if (n === 39) {
      assert(w.stats.kills === 39 && stageOf(w) === 'goals' && !doorOpen(w), `39 kills: ${w.stats.kills}, ${stageOf(w)}`);
      sim.command({ t: 'teleport', x: door.x, y: door.y + 1.4 });
      sim.command({ t: 'walk', x: 0, y: -1 });
      ticks(sim, 90);
      sim.command({ t: 'walk', x: 0, y: 0 });
      assert(statusOf(w) === 'playing', 'the shut door does not let him out');
      sim.command({ t: 'teleport', x: 12, y: 7.5 });
    }
    const e = place(sim, 13.5, 7.5, 'basic', n % 4, 0);
    assert(sim.command({ t: 'item', kind: 'bomb', x: e.x, y: e.y }) === true && !alive(w, e), `bomb ${n + 1}`);
  }
  assert(w.stats.kills === 40 && goalProgress(w).done === 40 && stageOf(w) === 'greed' && doorOpen(w), `40 kills: ${w.stats.kills}, ${stageOf(w)}`);
  sim.command({ t: 'teleport', x: door.x, y: door.y + 1.4 });
  sim.command({ t: 'walk', x: 0, y: -1 });
  ticks(sim, 120);
  assert(statusOf(w) === 'victory', `through the open door: ${statusOf(w)}`);
  assert(replays(sim), 'replay');
});

check('«Последний рубеж»: all four new kinds come; after the goals its own phase table is denser than the panel\'s, and the panel table does not reach it', () => {
  const { share, kinds, total } = composition('last-stand');
  for (const kind of ['shield', 'archer', 'sapper', 'porcupine']) assert(share(kind) > MIXED_KIND_SHARE * 0.4 && share(kind) < MIXED_KIND_SHARE * 1.8, `${kind} ${pct(share(kind))} of ${total}`);
  assert([...kinds].every(kind => ['basic', 'shield', 'archer', 'sapper', 'porcupine'].includes(kind)), `kinds ${[...kinds].join(', ')}`);
  // The same arena with the panel's table instead of its own: who stands on the arena during the first 60 s of greed.
  const own = arenaTemplate('last-stand'), panelTable: ArenaTemplate = { ...own, id: 'last-stand-panel', phases: undefined };
  const crowd = (arena: ArenaTemplate, seed: number): number => {
    const sim = new Simulation({ arena, params: harmless(), seed }), w = sim.world;
    sim.command({ t: 'goals' });
    let sum = 0, samples = 0;
    for (let i = 0; i < 60 * 60; i++) { sim.tick(); if (i % 30 === 0) { sum += w.enemies.length; samples++; } }
    return sum / samples;
  };
  const dense = [1, 2, 3].map(k => crowd(own, seedOf(k + 80))), panel = [1, 2, 3].map(k => crowd(panelTable, seedOf(k + 80)));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert(mean(dense) > mean(panel) + 4, `enemies on the arena after the goals: own table ${mean(dense).toFixed(1)}, the panel's ${mean(panel).toFixed(1)}`);
  console.log(`   ${total} newcomers: ${['shield', 'archer', 'sapper', 'porcupine', 'basic'].map(kind => `${kind} ${pct(share(kind))}`).join(', ')}; after the goals (60 s) ${mean(dense).toFixed(1)} enemies vs ${mean(panel).toFixed(1)} with the panel table`);
  // An edit of the panel's table (the sandbox) does not change the final's table.
  const sim = new Simulation({ arena: 'last-stand', params: quiet(), seed: seedOf(9), record: true }), w = sim.world;
  sim.command({ t: 'phases', phases: defaultParams().phases.map(phase => ({ ...phase, floor: 7 })) });
  sim.command({ t: 'goals' });
  sim.tick();
  assert(w.pressure.phase.floor === FINAL_PHASES[0].floor && w.pressure.phase.wolfShare === 0 && w.pressure.phase.boarShare === 0, `the final's own phase: ${JSON.stringify(w.pressure.phase)}`);
  assert(replays(sim), 'replay');
});

// ---- Determinism of the arenas 8–10 ----

/** Builds the longest chain it greedily can (enemies and crystals), then releases it — as the bot of realtimeSim.spec.ts. */
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
    const next = [...nextCandidates(w), ...nextObjectCandidates(w)].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

check('arenas 8–10: a bot fight of 50 s (with a run loadout: consumables, random elites, a talisman) replays from its journal to the same hash at every checkpoint', () => {
  for (const [k, arena] of ['ford', 'outpost', 'last-stand'].entries()) {
    const p = defaultParams();
    p.heroHp = 40;
    const loadout = { items: { frost: 1, bomb: 2, healing: 1, fire: 1 }, openItems: ['bomb' as const], randomElites: true, talismans: ['whetstone'], energy: 3 };
    const sim = new Simulation({ arena, params: p, seed: seedOf(40 + k), record: true, loadout });
    const checkpoints: string[] = [];
    for (let tick = 0; tick < 3000 && sim.world.status === 'playing'; tick++) {
      if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
      if (tick === 1500) sim.command({ t: 'goals' });
      if (tick === 700 && sim.world.enemies[0]) sim.command({ t: 'item', kind: 'fire', x: sim.world.enemies[0].x, y: sim.world.enemies[0].y });
      if (tick % 40 === 15) playChain(sim);
      sim.tick();
      sim.world.events.length = 0;
      if (sim.world.tick % 300 === 0) checkpoints.push(sim.hash());
    }
    const again: string[] = [];
    const replayed = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), s => { s.world.events.length = 0; if (s.world.tick % 300 === 0) again.push(s.hash()); });
    // Five checkpoints (25 s) — or fewer when the fight ended sooner (stage 3a, step 2: on the new layouts of «Брод» and
    // «Застава» this bot meets the goal and walks out at 15–18 s). Only a victory may end it sooner: a defeat would hide
    // a regression of the layout.
    const ended = sim.world.status === 'victory';
    assert((checkpoints.length >= 5 || (ended && checkpoints.length >= 2)) && checkpoints.length === again.length && checkpoints.every((h, i) => again[i] === h), `${arena}: checkpoints ${checkpoints.length} vs ${again.length}, status ${sim.world.status} at ${sim.world.tick}`);
    assert(replayed.hash() === sim.hash(), `${arena}: final hash`);
    // The same seed and journal on another run of the simulation: the same world (no hidden state between fights).
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `${arena}: the second replay`);
    console.log(`   ${arena}: ${sim.world.tick} ticks, kills ${sim.world.stats.kills}, hp ${sim.world.hero.hp}, hash ${sim.hash()}`);
  }
});

console.log(`realtime-arenas: ${checks} checks passed`);
