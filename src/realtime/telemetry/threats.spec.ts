/**
 * Track ТB of the real-time telemetry (docs/realtime-telemetry.md, sections 3, 7 and 8, «ТB»). Node only, part of
 * `npm run test:realtime-report`.
 *
 * Hand scenarios on a quiet arena: the hero meets one warning and acts — stands in it, walks out, jumps or is shielded by
 * the chain, kills the enemy. The fight is recorded as a journal and the report's replay (`analyzeJournal`) must give the
 * outcome the definitions of section 7 name (hit / shielded / dodged / interrupted) and the same hash as the live fight.
 * Also: the observer's summary on real actions (chains, a cancel, a step back, kills, the throw of a wolf), and the cost
 * of the observer per tick on «Большая поляна» (printed; the condition is < 0.1 ms).
 */
import { archerMark } from '../sim/enemies/archer';
import { WOLF_HOWL, WOLF_RUSH } from '../sim/enemies/wolf';
import { LYNX_WINDUP } from '../sim/enemies/lynx';
import type { Vec } from '../sim/geometry';
import { defaultParams, type Params } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { Enemy, World } from '../sim/world';
import { createFightObserver } from './observe';
import { analyzeJournal, type FightAnalysis } from './report';
import type { CoverKind, ThreatKind, ThreatOutcome } from './threats';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** A quiet fight: no newcomers, walkers stand (enemy speed 0), touches do not hurt — only what the scenario places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  p.heroHp = 30;
  return Object.assign(p, extra);
}

/** A recorded fight on «Убить 30» (16×10, the hero at 8, 5), emptied of its first group. */
function fight(extra: Partial<Params> = {}, seed = 7, arena = 'kills'): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed, record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'energy', value: 7 });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind: string, hp = 0, color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
/** Ticks until `until` (or `max` ticks, or the end of the fight). */
function run(sim: Simulation, max: number, until: (w: World) => boolean = () => false): void {
  for (let i = 0; i < max && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); sim.world.events.length = 0; }
}
/** Walk towards a direction (a key held) for `ticks`, then stand. */
function walk(sim: Simulation, x: number, y: number, ticks: number): void {
  sim.command({ t: 'walk', x, y });
  run(sim, ticks);
  sim.command({ t: 'walk', x: 0, y: 0 });
}
/** A chain from the hero through `links` and the release; the dash runs out. */
function chain(sim: Simulation, links: readonly Enemy[]): void {
  assert(sim.command({ t: 'begin', x: links[0].x, y: links[0].y }), 'the chain starts');
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(sim.command({ t: 'release' }), 'the chain is released');
  run(sim, 240, w => !w.move);
}

/** The report's replay of the recorded fight: the same hash, and the warnings of `kind`. */
function replayed(sim: Simulation): FightAnalysis {
  const journal = sim.exportJournal()!, a = analyzeJournal(JSON.parse(JSON.stringify(journal)));
  assert(a.hash === sim.hash(), `the replay hash ${a.hash} differs from the fight's ${sim.hash()}`);
  return a;
}
function expectOne(sim: Simulation, kind: ThreatKind, outcome: ThreatOutcome, reason?: string, cover?: CoverKind): FightAnalysis {
  const a = replayed(sim), list = a.warnings.filter(w => w.kind === kind);
  const seen = list.map(w => `${w.outcome}${w.reason ? `/${w.reason}` : ''} (exit ${w.exitTicks})`).join(', ') || 'none';
  assert(list.length === 1, `${kind}: one warning expected, got ${seen}`);
  assert(list[0].outcome === outcome, `${kind}: ${outcome} expected, got ${seen}`);
  if (reason) assert(list[0].reason === reason, `${kind}: reason ${reason} expected, got ${seen}`);
  if (cover) assert(list[0].coverKind === cover, `${kind}: cover by ${cover} expected, got ${list[0].coverKind}`);
  const t = a.summary.threats[kind];
  assert(t && t.warned === 1 && t[outcome] === 1, `${kind}: the summary tally counts it (${JSON.stringify(t)})`);
  return a;
}

const HERO: Vec = { x: 8, y: 5 };

// ---- Archer: the mark on the hero ----

/** An archer 2.8 to the left of the hero; the mark falls on him after its first delay. Runs until it aims. */
function archerAims(sim: Simulation): Enemy {
  const a = place(sim, { x: 5.2, y: 5 }, 'archer');
  run(sim, 120, w => !!archerMark(w, a));
  assert(archerMark(sim.world, a), 'the archer aims');
  return a;
}

check('archer: the hero stands in the mark — hit', () => {
  const sim = fight();
  archerAims(sim);
  run(sim, 90);
  expectOne(sim, 'archer', 'hit');
});

check('archer: the hero walks out of the mark — dodged, with the exit time', () => {
  const sim = fight();
  archerAims(sim);
  walk(sim, 0, 1, 40);
  run(sim, 60);
  const a = expectOne(sim, 'archer', 'dodged'), w = a.warnings.find(x => x.kind === 'archer')!;
  // The mark radius 1 + the hero's body 0.28 at 4 units/s: about 19 ticks.
  assert(w.exitTicks !== null && w.exitTicks >= 15 && w.exitTicks <= 25, `exit after ${w.exitTicks} ticks`);
  assert(w.exitGame !== null && Math.abs(w.exitGame - w.exitTicks / 60) < 1e-9 && w.exitReal !== null && w.exitReal > 0, 'exit in game and real seconds');
  assert(a.summary.threats.archer.exitTicks[0] === w.exitTicks, 'the tally keeps the exit of the dodge');
});

check('archer: the arrow falls while the hero jumps inside the mark — shielded', () => {
  const sim = fight();
  const a = archerAims(sim);
  // A short jump that stays inside the mark, started so the arrow falls while he is in the air.
  run(sim, 90, w => w.enemies.find(e => e.id === a.id)!.vars.timer <= 3 / 60);
  assert(sim.command({ t: 'jump', x: HERO.x + 0.6, y: HERO.y }), 'the jump starts');
  run(sim, 30);
  expectOne(sim, 'archer', 'shielded');
});

check('archer: the chain kills the archer while it aims — interrupted', () => {
  const sim = fight();
  const a = archerAims(sim);
  walk(sim, -1, 0, 20);
  chain(sim, [a]);
  run(sim, 30);
  assert(!alive(sim.world, a), 'the archer is dead');
  expectOne(sim, 'archer', 'interrupted', 'dead');
});

// ---- Boar: the lane ----

/** A boar 3 below the hero (in sight, within its trigger 5); runs until it winds up. */
function boarWindsUp(sim: Simulation, at: Vec = { x: 8, y: 8 }, hp = 0): Enemy {
  const b = place(sim, at, 'boar', hp);
  run(sim, 120, w => w.enemies.find(e => e.id === b.id)?.boar === 'windup');
  assert(sim.world.enemies.find(e => e.id === b.id)!.boar === 'windup', 'the boar winds up');
  return b;
}

check('boar: the hero stays in the lane — hit', () => {
  const sim = fight();
  boarWindsUp(sim);
  run(sim, 120);
  expectOne(sim, 'boar', 'hit');
});

check('boar: the hero steps out of the lane during the windup — dodged', () => {
  const sim = fight();
  boarWindsUp(sim);
  walk(sim, 1, 0, 25);
  run(sim, 120);
  expectOne(sim, 'boar', 'dodged');
});

check('boar: the charge stops on a tree in front of the hero standing behind it — dodged, cover by a wall', () => {
  // «Убить 30» has a tree at (9.5, 2.5) of radius 0.42: the lane at x = 10.15 passes its side — the sight (half the body)
  // is clear, the charging body (0.32) is not; the hero stands at the end of the lane behind the tree.
  const sim = fight();
  sim.command({ t: 'teleport', x: 10.15, y: 2 });
  boarWindsUp(sim, { x: 10.15, y: 6.45 });
  run(sim, 120);
  expectOne(sim, 'boar', 'dodged', 'cover', 'wall');
});

check('boar: the charge runs into the corner of a wall the hero stands beside — dodged, cover by a wall', () => {
  // The wall x 3…4, y 2…5 of «Убить 30»: the lane at x = 4.29 clears the sight (0.16) but not the charging body (0.304);
  // the hero stands beside the wall a unit past its corner, at the end of the lane.
  const sim = fight();
  sim.command({ t: 'teleport', x: 4.29, y: 4 });
  boarWindsUp(sim, { x: 4.29, y: 8 });
  run(sim, 120);
  expectOne(sim, 'boar', 'dodged', 'cover', 'wall');
});

check('boar: the charge stops at the edge of a cliff between it and the hero — dodged, cover by a cliff', () => {
  // «Обрыв»: the drop spans x ≈ 7.3…8.7 at y 4.4 and does not cut the sight; the boar charges at the hero across it.
  const sim = fight({}, 7, 'cliff');
  sim.command({ t: 'teleport', x: 6.6, y: 4.4 });
  boarWindsUp(sim, { x: 10.6, y: 4.4 });
  run(sim, 120);
  expectOne(sim, 'boar', 'dodged', 'cover', 'cliff');
});

check('boar: the charge reaches the hero under the chain\'s shield — shielded', () => {
  const sim = fight({ chainShield: 3 });
  const prey = place(sim, { x: 6.6, y: 5 }, 'basic', 0, 1);
  boarWindsUp(sim);
  chain(sim, [prey]);
  // Back into the lane (he dashed 1.4 to the left), shielded for 3 s.
  walk(sim, 1, 0, 21);
  run(sim, 120);
  expectOne(sim, 'boar', 'shielded');
});

check('boar: the chain kills the winding boar — interrupted', () => {
  const sim = fight();
  const b = boarWindsUp(sim, { x: 8, y: 6.6 });
  chain(sim, [b]);
  run(sim, 30);
  expectOne(sim, 'boar', 'interrupted', 'dead');
});

// ---- Wolves: one warning per pack ----

/** Three wolves on the ring (radius 3) round the hero at 120°: they stand at their slots and howl at once. */
function packHowls(sim: Simulation, turn = 0): Enemy[] {
  const wolves = [0, 1, 2].map(k => place(sim, { x: HERO.x + 3 * Math.cos(turn + k * 2 * Math.PI / 3), y: HERO.y + 3 * Math.sin(turn + k * 2 * Math.PI / 3) }, 'wolf', 0, k));
  run(sim, 60, w => w.enemies.some(e => e.kind === 'wolf' && e.vars.st === WOLF_HOWL));
  assert(sim.world.enemies.filter(e => e.kind === 'wolf' && e.vars.st === WOLF_HOWL).length === 3, 'the pack howls');
  return wolves;
}

/** Runs until no wolf howls or rushes (the pack's attack is over; the next howl is another warning). */
function calm(sim: Simulation): void {
  run(sim, 30);
  run(sim, 240, w => !w.enemies.some(e => e.kind === 'wolf' && (e.vars.st === WOLF_HOWL || e.vars.st === WOLF_RUSH)));
}

check('wolves: the hero stands — the pack\'s throw hits once; the observer counts it as «бросок волка»', () => {
  const sim = fight({ contactDamage: 1 });
  packHowls(sim);
  calm(sim);
  const a = expectOne(sim, 'wolf', 'hit');
  assert((a.summary.damage.bySource['wolf-rush'] ?? 0) > 0 && !a.summary.damage.bySource.wolf, `the throw is «wolf-rush»: ${JSON.stringify(a.summary.damage.bySource)}`);
});

check('wolves: the hero jumps out of the lines when they rush — dodged', () => {
  const sim = fight({ contactDamage: 1 });
  packHowls(sim, Math.PI / 2);
  run(sim, 60, w => w.enemies.some(e => e.kind === 'wolf' && e.vars.st === WOLF_RUSH));
  // Between two lines, away from the third: the lines are fixed now.
  assert(sim.command({ t: 'jump', x: HERO.x + 3 * Math.cos(Math.PI / 2 + Math.PI / 3), y: HERO.y + 3 * Math.sin(Math.PI / 2 + Math.PI / 3) }), 'the jump starts');
  calm(sim);
  expectOne(sim, 'wolf', 'dodged');
});

check('wolves: the hero jumps off the lane and the rush stops at a cliff edge behind him — dodged, cover by a cliff; the lane is fixed after the howl starts', () => {
  // «Обрыв»: a lone wolf 3 to the left of the hero, the drop 0.7 behind him; the rush (4) would run on into it.
  const sim = fight({ contactDamage: 1, wolfLoneWait: 0.3 }, 7, 'cliff');
  sim.command({ t: 'teleport', x: 6.6, y: 4.4 });
  place(sim, { x: 3.6, y: 4.4 }, 'wolf');
  run(sim, 120, w => w.enemies.some(e => e.kind === 'wolf' && e.vars.st === WOLF_RUSH));
  assert(sim.command({ t: 'jump', x: 6.6, y: 1.9 }), 'the jump starts');
  calm(sim);
  const a = expectOne(sim, 'wolf', 'dodged', 'cover', 'cliff'), w = a.warnings.find(x => x.kind === 'wolf')!;
  assert(w.lockTick !== undefined && w.lockTick > w.tick, `the lane is fixed (tick ${w.lockTick}) after the howl starts (tick ${w.tick})`);
  // The exit counts from the howl: the hero left the lane only with the jump, after the lane was fixed.
  assert(w.exitTicks !== null && w.tick + w.exitTicks > w.lockTick, `exit ${w.exitTicks} ticks from the howl`);
});

check('wolves: the throw reaches the hero under the chain\'s shield — shielded', () => {
  const sim = fight({ contactDamage: 1, chainShield: 3 });
  const prey = place(sim, { x: 8, y: 6.2 }, 'basic', 0, 1);
  packHowls(sim, Math.PI / 6);
  chain(sim, [prey]);
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  calm(sim);
  expectOne(sim, 'wolf', 'shielded');
});

check('wolves: the chain kills a wolf of the howling pack — the howl breaks, interrupted', () => {
  const sim = fight({ contactDamage: 1, wolfHowl: 2 });
  const wolves = packHowls(sim);
  walk(sim, 1, 0, 20);
  chain(sim, [wolves[0]]);
  calm(sim);
  expectOne(sim, 'wolf', 'interrupted');
});

// ---- Lynx: the leap line ----

function lynxWindsUp(sim: Simulation, at: Vec = { x: 5.5, y: 5 }): Enemy {
  const l = place(sim, at, 'lynx');
  run(sim, 120, w => w.enemies.find(e => e.id === l.id)?.vars.st === LYNX_WINDUP);
  assert(sim.world.enemies.find(e => e.id === l.id)!.vars.st === LYNX_WINDUP, 'the lynx winds up');
  return l;
}

check('lynx: the hero stands on the line — hit', () => {
  const sim = fight();
  lynxWindsUp(sim);
  run(sim, 90);
  expectOne(sim, 'lynx', 'hit');
});

check('lynx: the hero steps off the line during the windup — dodged', () => {
  const sim = fight();
  lynxWindsUp(sim);
  walk(sim, 0, 1, 25);
  run(sim, 90);
  expectOne(sim, 'lynx', 'dodged');
});

check('lynx: the leap lands beside the hero under the chain\'s shield — shielded', () => {
  const sim = fight({ chainShield: 3 });
  const prey = place(sim, { x: 8, y: 6.3 }, 'basic', 0, 1);
  lynxWindsUp(sim);
  chain(sim, [prey]);
  sim.command({ t: 'teleport', x: HERO.x, y: HERO.y });
  run(sim, 90);
  expectOne(sim, 'lynx', 'shielded');
});

check('lynx: the chain kills it during the windup — interrupted', () => {
  const sim = fight();
  const l = lynxWindsUp(sim, { x: 6.5, y: 5 });
  chain(sim, [l]);
  run(sim, 60);
  expectOne(sim, 'lynx', 'interrupted', 'dead');
});

// ---- Sapper: the fuse lit by the touch and its blast are one warning ----

/** A sapper touching the hero: it lights its fuse (1.2 s). */
function sapperLit(sim: Simulation): Enemy {
  const s = place(sim, { x: HERO.x - 0.5, y: HERO.y }, 'sapper');
  run(sim, 5, w => w.enemies.find(e => e.id === s.id)?.vars.lit === 1);
  assert(sim.world.enemies.find(e => e.id === s.id)!.vars.lit === 1, 'the fuse burns');
  return s;
}

check('sapper: the hero stays by the lit sapper — hit', () => {
  const sim = fight();
  sapperLit(sim);
  run(sim, 120);
  expectOne(sim, 'sapper', 'hit');
});

check('sapper: the hero walks out of the blast circle — dodged', () => {
  const sim = fight();
  sapperLit(sim);
  walk(sim, 1, 0, 40);
  run(sim, 90);
  expectOne(sim, 'sapper', 'dodged');
});

check('sapper: the hero kills the lit sapper and its fuse goes off on him under the shield — still one warning, shielded', () => {
  const sim = fight({ chainShield: 3 });
  const s = sapperLit(sim);
  chain(sim, [s]);
  run(sim, 90);
  expectOne(sim, 'sapper', 'shielded');
});

check('sapper: a blast with no fuse (sapperFuse 0) is «без предупреждения», not a sapper warning', () => {
  const sim = fight({ sapperFuse: 0 });
  const s = place(sim, { x: HERO.x - 1.5, y: HERO.y }, 'sapper');
  chain(sim, [s]);
  run(sim, 30);
  const a = replayed(sim);
  assert(!a.warnings.some(w => w.kind === 'sapper'), 'no sapper warning');
  assert(a.warnings.filter(w => w.kind === 'sapper-instant').length === 1, `one instant blast: ${JSON.stringify(a.warnings)}`);
});

check('sapper: the fight ends before the blast — interrupted', () => {
  const sim = fight({ heroHp: 1 });
  const archer = place(sim, { x: 5.2, y: 7 }, 'archer');
  run(sim, 120, w => !!archerMark(w, archer));
  // Lit when the arrow is about to fall: the arrow kills the hero first.
  run(sim, 90, w => w.enemies.find(e => e.id === archer.id)!.vars.timer <= 20 / 60);
  sapperLit(sim);
  run(sim, 120);
  assert(sim.world.status === 'defeat', 'the arrow ended the fight');
  expectOne(sim, 'sapper', 'interrupted', 'end');
});

// ---- The observer on real actions ----

check('observer: chains, a cancel, a step back, kills by the chain and the exact summary of the replay', () => {
  const sim = fight();
  const a = place(sim, { x: 7, y: 5 }, 'basic', 0, 2), b = place(sim, { x: 6, y: 5 }, 'basic', 0, 2), c = place(sim, { x: 5, y: 5 }, 'basic', 0, 2);
  const live = createFightObserver(sim.world);
  const cmd = (c: Parameters<Simulation['command']>[0]): void => { sim.command(c); live.command(c, sim.world); };
  const tick = (n: number): void => { for (let i = 0; i < n; i++) { sim.tick(); live.tick(sim.world); sim.world.events.length = 0; } };
  // A cancelled chain, then a chain with a step back, then a chain of three.
  cmd({ t: 'begin', x: a.x, y: a.y }); tick(5); cmd({ t: 'cancel' }); tick(5);
  cmd({ t: 'begin', x: a.x, y: a.y }); cmd({ t: 'drag', x: b.x, y: b.y, mode: 'full' }); tick(3); cmd({ t: 'drag', x: a.x, y: a.y, mode: 'full' }); tick(3);
  cmd({ t: 'drag', x: b.x, y: b.y, mode: 'full' }); cmd({ t: 'drag', x: c.x, y: c.y, mode: 'full' }); tick(5); cmd({ t: 'release' }); tick(120);
  const s = live.summary();
  assert(s.chain.count === 1 && s.chain.cancels === 1 && s.chain.backsteps === 1, `chains ${s.chain.count}, cancels ${s.chain.cancels}, steps back ${s.chain.backsteps}`);
  assert(s.chain.lengthMax === 3 && s.chain.lengthMedian === 3 && s.kills.chain === 3, `length ${s.chain.lengthMax}, kills ${s.kills.chain}`);
  assert(s.chain.focusSpent > 0 && s.movement.path > 2.5, `focus ${s.chain.focusSpent}, path ${s.movement.path}`);
  // The report's replay sees the same (the observer is the same code on the same commands).
  const r = replayed(sim).summary;
  r.threats = {};
  assert(JSON.stringify(r) === JSON.stringify(s), `the replay's summary differs: ${JSON.stringify(r)} vs ${JSON.stringify(s)}`);
});

// ---- Cost on «Большая поляна» ----

check('observer cost per tick on «Большая поляна» is below 0.1 ms', () => {
  const params = defaultParams();
  params.heroHp = 1000;
  const sim = new Simulation({ arena: 'big-clearing', params, seed: 20261010 });
  sim.command({ t: 'goals' });
  const observer = createFightObserver(sim.world), w = sim.world;
  let spent = 0, ticks = 0, peak = 0;
  for (let t = 0; t < 60 * 60; t++) {
    if (t % 90 === 0) { const e = w.enemies[0]; if (e) { sim.command({ t: 'begin', x: e.x, y: e.y }); observer.command({ t: 'begin', x: e.x, y: e.y }, w); } }
    if (t % 90 === 30) { sim.command({ t: 'release' }); observer.command({ t: 'release' }, w); }
    sim.tick();
    const start = performance.now();
    observer.tick(w);
    spent += performance.now() - start;
    ticks++;
    peak = Math.max(peak, w.enemies.length);
    w.events.length = 0;
  }
  const perTick = spent / ticks;
  console.log(`  observer: ${(perTick * 1000).toFixed(2)} µs per tick over ${ticks} ticks, up to ${peak} enemies; ${observer.summary().chain.count} chains`);
  assert(perTick < 0.1, `observer ${perTick.toFixed(4)} ms per tick`);
  assert(peak >= 20, `a crowded arena (${peak} enemies)`);
});

console.log(`${checks} checks passed`);
