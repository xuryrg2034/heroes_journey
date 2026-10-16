/**
 * Task 46 «Сплавы v2» (docs/design-notes/task-46-fusions-v2.md, sections 3, 5, 8, 11, 14; docs/realtime-prototype.md, section 9ц):
 * «Клеймо», «Подрыв», «Ледяная волна» in a fight. Node only: `npm run test:realtime-fusions-v2`. Every check plays journalled
 * commands (place, teleport, begin, drag, release) with the fusion in the arena's loadout, as a run or the sandbox gives it, and looks
 * at what the player meets:
 * - «Клеймо»: after a lit dash the bodies along the path take the chain's colour, a body far off keeps its own, a chain of 2 paints
 *   nothing, the Reaper never; the player's problem — a second chain through two painted bodies of different colours is taken, the
 *   same chain without the fusion is refused «не тот цвет»;
 * - «Подрыв»: the chain ends on an elite — a body 2 from the centre is struck (the plain blast misses it), a tough of 3 HP dies, an
 *   elite loses 2 plates, a knight (a boss's armour) 1; a chain ending on an ordinary link — the plain blast; on a surviving tough
 *   (the chain window) — the detonation;
 * - «Ледяная волна»: a chain of 4 — the weak in the wave die, the survivors freeze 3 s and are brittle (the next chain's hit ×2), the
 *   Reaper does not; a chain of 3 — no wave, no cold;
 * - the kit's slot (section 5): «Подрыв» with «Огненный проход» — the path burns and the end blasts; «Клеймо» with «Взрыв на конце» —
 *   the same; «Бумеранг» with «Взрыв на конце» — the kit of before;
 * - the highlight is the fight on scenes of 8 seeds with walking enemies for each fusion; outcomes vary;
 * - every fight replays to the same hash (checkpoints every 300 ticks); a journal without the new keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { hoverRefusal, planChain, type EndHit } from './chain';
import { COUNTER_TALISMANS as CT, FROST_PASS, FUSIONS, HAMMERS } from './buildIds';
import { worldState } from './hash';
import { kitOf, type Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import type { Vec } from './geometry';
import type { Enemy, WorldEvent } from './world';
import { createFightObserver } from '../telemetry/observe';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4.5, y: 5 }, buttons: [], enemies: [], killGoal: 999, id: 'fusions-v2-field', name: 'Поле сплавов 2', summary: 'Тест сплавов', obstacles: [], door: { x: 19.3, y: 6 } });

/** A quiet fight: no newcomers, nobody walks or touches, the Reaper stands; the loop and the pierce toggles off (the kit decides). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.loopEnabled = false; p.pierceEnabled = false; p.reaperSpeed = 0; p.reaperDamage = 0;
  return Object.assign(p, extra);
}
function fight(loadout: Loadout, extra: Partial<Params> = {}, k = 1): Simulation {
  const sim = new Simulation({ arena: 'fusions-v2-field', params: quiet(extra), seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, at: Vec, opts: { color?: number; hp?: number; elite?: boolean; kind?: string } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind: (opts.kind ?? 'basic') as 'basic', ...opts.elite ? { elite: true } : {} }) as number;
const enemy = (sim: Simulation, id: number): Enemy | undefined => sim.world.enemies.find(e => e.id === id);
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the hero stands, collecting the events; `seen` looks at every tick's events. */
function settle(sim: Simulation, seen?: (events: readonly WorldEvent[]) => void): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 1500 && (sim.world.move || i === 0); i++) {
    sim.tick();
    const now = [...sim.world.events];
    seen?.(now);
    out.push(...now); sim.world.events.length = 0;
  }
  return out;
}
/** The journal replays to the same hash at every 300th tick and at the end (the fight goes on 400 ticks more first). */
function replaysWithCheckpoints(sim: Simulation): boolean {
  const marks = new Map<number, string>();
  for (let i = 0; i < 400; i++) { sim.tick(); if (sim.world.tick % 300 === 0) marks.set(sim.world.tick, sim.hash()); }
  let okMarks = true;
  const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal, s => { const want = marks.get(s.world.tick); if (want !== undefined && want !== s.hash()) okMarks = false; });
  return okMarks && again.hash() === sim.hash();
}
const fired = (events: readonly WorldEvent[], id: string): number => events.filter(e => e.type === 'talismanFired' && e.id === id).length;
const hammerKinds = (events: readonly WorldEvent[]): string[] => events.flatMap(e => (e.type === 'hammer' ? [e.kind] : []));

/** An end hit of the plan is what the fight did: killed, or the HP and the plates after. */
function assertHit(sim: Simulation, h: EndHit, label: string): void {
  const e = enemy(sim, h.id);
  if (h.killed) assert(!e, `${label}: body ${h.id} killed`);
  else if (h.plate) assert(e?.armor?.plates === h.platesAfter, `${label}: body ${h.id} plates ${e?.armor?.plates}, planned ${h.platesAfter}`);
  else assert(e?.hp === h.hpAfter, `${label}: body ${h.id} hp ${e?.hp}, planned ${h.hpAfter}`);
}

/** Three weak colour-0 links on y = 5 from the hero at (4.5, 5). */
const LINE: Vec[] = [{ x: 6, y: 5 }, { x: 7.2, y: 5 }, { x: 8.4, y: 5 }];

check('the kit (section 5): «Подрыв» with «Огненный проход» — the slot is the fire, the blast a talisman; «Клеймо» with «Взрыв на конце» — the same; «Подрыв» alone — the slot is the blast; a hammer a fusion excludes leaves; «Бумеранг» with «Взрыв на конце» — the kit of before', () => {
  const a = kitOf({ talismans: [FUSIONS.hunterBlast], hammer: HAMMERS.fire });
  assert(a.hammer === HAMMERS.fire && a.talismans.includes(HAMMERS.blast) && a.talismans.includes(CT.eliteHunter), `Подрыв + fire: ${a.hammer} ${a.talismans}`);
  const b = kitOf({ talismans: [FUSIONS.brand], hammer: HAMMERS.blast });
  assert(b.hammer === HAMMERS.fire && b.talismans.includes(HAMMERS.blast) && b.talismans.includes(CT.prism), `Клеймо + blast: ${b.hammer} ${b.talismans}`);
  const c = kitOf({ talismans: [FUSIONS.hunterBlast] });
  assert(c.hammer === HAMMERS.blast && !c.talismans.includes(HAMMERS.blast), `Подрыв alone: ${c.hammer} ${c.talismans}`);
  const d = kitOf({ talismans: [FUSIONS.hunterBlast], hammer: HAMMERS.return });
  assert(d.hammer === HAMMERS.blast && !d.talismans.includes(HAMMERS.return), `Подрыв + Возврат: ${d.hammer} ${d.talismans}`);
  const e = kitOf({ talismans: [FUSIONS.frostWave], hammer: HAMMERS.cut });
  assert(e.hammer === HAMMERS.cut && e.talismans.includes(FROST_PASS) && e.talismans.includes(CT.shockwave), `Ледяная волна + cut: ${e.hammer} ${e.talismans}`);
  const f = kitOf({ talismans: [FUSIONS.boomerang], hammer: HAMMERS.blast });
  assert(f.hammer === HAMMERS.return && f.talismans.join() === [FUSIONS.boomerang, CT.finisher].join(), `Бумеранг + blast: the kit of before ${f.hammer} ${f.talismans}`);
  // In a fight: the path burns and the end blasts, in both pairs.
  for (const loadout of [{ talismans: [FUSIONS.hunterBlast], hammer: HAMMERS.fire }, { talismans: [FUSIONS.brand], hammer: HAMMERS.blast }] as Loadout[]) {
    const sim = fight(loadout);
    for (const p of LINE) place(sim, p);
    draw(sim, LINE);
    sim.command({ t: 'release' });
    const kinds = hammerKinds(settle(sim));
    assert(kinds.includes('fire') && kinds.includes('blast'), `${loadout.talismans}: fire and blast ${kinds}`);
    assert(replaysWithCheckpoints(sim), 'replays');
  }
});

/** «Клеймо» scene: two bodies of other colours along the path (outside the fire), one far off, the Reaper near the path. */
function brandScene(loadout: Loadout, links = LINE) {
  const sim = fight(loadout);
  for (const p of links) place(sim, p);
  const a = place(sim, { x: 8.0, y: 5.9 }, { color: 2 }), b = place(sim, { x: 7.6, y: 4.15 }, { color: 3 });
  const far = place(sim, { x: 7.2, y: 7.6 }, { color: 2, hp: 3 }), reaper = place(sim, { x: 6.6, y: 4.2 }, { color: 1, kind: 'reaper' });
  // A boss's core near the path (the Jailer's: colourless in a run; never painted).
  const core = place(sim, { x: 6.4, y: 6.3 }, { color: 2, kind: 'jailer' });
  draw(sim, links);
  return { sim, a, b, far, reaper, core };
}

check('«Клеймо»: the lit path paints the bodies along it in the chain\'s colour; far off, the Reaper — not; a chain of 2 — nothing; the highlight shows the paint', () => {
  const { sim, a, b, far, reaper, core } = brandScene({ talismans: [FUSIONS.brand] });
  const plan = planChain(sim.world);
  assert(plan.fire?.lit && plan.fire.paint && plan.fire.paint.color === 0 && [...plan.fire.paint.ids].sort().join() === [a, b].sort().join(), `the planned paint ${JSON.stringify(plan.fire?.paint)}`);
  const reaperColor = enemy(sim, reaper)!.color;
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(enemy(sim, a)!.color === 0 && enemy(sim, b)!.color === 0 && enemy(sim, far)!.color === 2 && enemy(sim, reaper)!.color === reaperColor && enemy(sim, core)!.color === 2, 'painted along the path only (not the Reaper, not the core)');
  assert(fired(events, FUSIONS.brand) === 1 && events.some(e => e.type === 'paint' && e.ids.length === 2 && e.color === 0), 'the signal and the event');
  assert(replaysWithCheckpoints(sim), 'replays');
  const short = brandScene({ talismans: [FUSIONS.brand] }, LINE.slice(0, 2));
  const sp = planChain(short.sim.world);
  assert(!sp.fire?.lit && !sp.fire?.paint, 'a chain of 2: the fire does not light, no paint');
  short.sim.command({ t: 'release' });
  settle(short.sim);
  assert(enemy(short.sim, short.a)!.color === 2 && enemy(short.sim, short.b)!.color === 3, 'a chain of 2 paints nothing');
});

check('«Клеймо», the player\'s problem: a second chain through two painted bodies of different colours is taken; the same chain without the fusion — refused «не тот цвет»', () => {
  const cases: [Loadout, boolean][] = [[{ talismans: [FUSIONS.brand] }, true], [{ talismans: [CT.prism], hammer: HAMMERS.fire }, false]];
  for (const [loadout, fused] of cases) {
    const { sim, a, b } = brandScene(loadout);
    sim.command({ t: 'release' });
    settle(sim);
    const pa = enemy(sim, a)!, pb = enemy(sim, b)!;
    sim.command({ t: 'begin', x: pa.x, y: pa.y });
    const chainLength = (): number => sim.world.chain.length;
    assert(chainLength() === 1, 'the first link taken');
    const refusal = hoverRefusal(sim.world, { x: pb.x, y: pb.y });
    sim.command({ t: 'drag', x: pb.x, y: pb.y, mode: 'full' });
    if (fused) assert(refusal === null && chainLength() === 2, `with «Клеймо»: the second link taken (${refusal})`);
    else assert(refusal === 'color' && chainLength() === 1, `without: refused ${refusal}`);
    assert(replaysWithCheckpoints(sim), 'replays');
  }
});

/** «Подрыв» scene: two weak links, the last link (8.4, 5) as given; around it a far body, a tough, an elite and a knight. */
function blastScene(loadout: Loadout, last: { elite?: boolean; hp?: number }, extra: Partial<Params> = {}) {
  const sim = fight(loadout, { eliteArmor: true, ...extra });
  const ids = [place(sim, LINE[0]), place(sim, LINE[1]), place(sim, LINE[2], last)];
  const far = place(sim, { x: 8.4, y: 7.0 }, { color: 2 }), tough = place(sim, { x: 9.4, y: 5 }, { color: 2, hp: 3 });
  const elite = place(sim, { x: 9.0, y: 4.0 }, { color: 3, elite: true }), knight = place(sim, { x: 7.6, y: 6.1 }, { color: 1, kind: 'knight' });
  draw(sim, LINE);
  return { sim, ids, far, tough, elite, knight };
}

check('«Подрыв»: the chain ends on an elite — the body 2 from the centre struck (the plain blast misses it), the tough of 3 HP dies, the elite −2 plates, the knight −1; the highlight shows the circle and the outcomes', () => {
  const cases: [Loadout, boolean][] = [[{ talismans: [FUSIONS.hunterBlast] }, true], [{ talismans: [CT.eliteHunter], hammer: HAMMERS.blast }, false]];
  for (const [loadout, fused] of cases) {
    const s = blastScene(loadout, { elite: true });
    const plates = enemy(s.sim, s.elite)!.armor!.plates, knightPlates = enemy(s.sim, s.knight)?.armor?.plates ?? 0;
    assert(plates >= 3 && knightPlates >= 2, `armour: elite ${plates}, knight ${knightPlates}`);
    const plan = planChain(s.sim.world);
    if (fused) assert(plan.blast && plan.blast.detonate && Math.abs(plan.blast.radius - 2.25) < 1e-9 && plan.blast.damage === 4 && plan.blast.plates === 2, `the planned blast ${JSON.stringify(plan.blast)}`);
    else assert(!plan.blast, 'no blast in the plan without the fusion');
    s.sim.command({ t: 'release' });
    const events = settle(s.sim);
    if (fused) for (const h of plan.blast!.bodies) assertHit(s.sim, h, 'Подрыв');
    assert(!enemy(s.sim, s.far) === fused, `${fused ? 'fused' : 'plain'}: the far body ${enemy(s.sim, s.far) ? 'alive' : 'killed'}`);
    assert(fused ? !enemy(s.sim, s.tough) : enemy(s.sim, s.tough)!.hp === 2, `${fused ? 'fused' : 'plain'}: the tough`);
    assert(enemy(s.sim, s.elite)!.armor!.plates === plates - (fused ? 2 : 1), `${fused ? 'fused' : 'plain'}: the elite's plates ${enemy(s.sim, s.elite)!.armor!.plates}`);
    assert((enemy(s.sim, s.knight)?.armor?.plates ?? 0) === knightPlates - 1, `${fused ? 'fused' : 'plain'}: the knight −1 (a boss's armour)`);
    assert(fired(events, FUSIONS.hunterBlast) === (fused ? 1 : 0) && events.some(e => e.type === 'hammer' && e.kind === 'blast' && !!e.detonate === fused), 'the signal');
    assert(replaysWithCheckpoints(s.sim), 'replays');
  }
});

check('«Подрыв»: a chain ending on an ordinary link — the plain blast 1.5 and 1; on a surviving tough with the chain window — the detonation; without the window a tough is no hunter\'s link', () => {
  const plain = blastScene({ talismans: [FUSIONS.hunterBlast] }, {});
  const pp = planChain(plain.sim.world);
  assert(pp.blast && !pp.blast.detonate && pp.blast.radius === 1.5 && pp.blast.damage === 1, `ordinary: ${JSON.stringify(pp.blast)}`);
  plain.sim.command({ t: 'release' });
  settle(plain.sim);
  for (const h of pp.blast.bodies) assertHit(plain.sim, h, 'plain');
  assert(enemy(plain.sim, plain.far) && enemy(plain.sim, plain.tough)!.hp === 2, 'the plain blast');
  for (const [window, detonate] of [[true, true], [false, false]] as const) {
    const s = blastScene({ talismans: [FUSIONS.hunterBlast] }, { hp: 9 }, { counterWindow: window });
    const plan = planChain(s.sim.world);
    assert(plan.endsOnSurvivor && plan.blast && plan.blast.detonate === detonate, `a surviving tough, window ${window}: ${JSON.stringify(plan.blast)}`);
    s.sim.command({ t: 'release' });
    settle(s.sim);
    for (const h of plan.blast.bodies) assertHit(s.sim, h, `survivor, window ${window}`);
    assert(replaysWithCheckpoints(s.sim), 'replays');
  }
});

/** «Ледяная волна» scene (the chain window: the wave from 4 links): links in a row, near the end a weak body, one of 2 HP, the Reaper. */
function waveScene(loadout: Loadout, n = 4, k = 1) {
  const sim = fight(loadout, { counterWindow: true }, k);
  const links = [6, 7.2, 8.4, 9.6].slice(0, n).map(x => ({ x, y: 5 }));
  for (const p of links) place(sim, p);
  const end = links[links.length - 1];
  const weak = place(sim, { x: end.x + 0.8, y: 5.8 }, { color: 2 }), tough = place(sim, { x: end.x, y: 6.4 }, { color: 3, hp: 2 });
  const reaper = place(sim, { x: end.x + 1.0, y: 4.3 }, { color: 1, kind: 'reaper' });
  draw(sim, links);
  return { sim, weak, tough, reaper };
}

check('«Ледяная волна»: a chain of 4 — the weak in the wave die, the survivor freezes 3 s, brittle, the next chain\'s hit ×2; the Reaper does not freeze; a chain of 3 — no wave, no cold; without the fusion no cold', () => {
  const cases: [Loadout, boolean][] = [[{ talismans: [FUSIONS.frostWave] }, true], [{ talismans: [FROST_PASS, CT.shockwave] }, false]];
  for (const [loadout, fused] of cases) {
    const s = waveScene(loadout);
    const plan = planChain(s.sim.world);
    if (fused) {
      assert(plan.wave && plan.wave.radius === 2 && plan.wave.bodies.some(b => b.id === s.weak && b.killed) && plan.wave.ice.ids.join() === String(s.tough) && plan.wave.ice.brittle, `the planned wave ${JSON.stringify(plan.wave)}`);
    } else assert(!plan.wave, 'no wave in the plan without the fusion');
    s.sim.command({ t: 'release' });
    let cold: { chill: number; brittle: boolean } | null = null;
    const events = settle(s.sim, now => { if (now.some(e => e.type === 'wave')) { const t = enemy(s.sim, s.tough); cold = t ? { chill: t.chill ?? 0, brittle: !!t.brittle } : null; } });
    assert(!enemy(s.sim, s.weak) && enemy(s.sim, s.tough)!.hp === 1, 'the wave struck');
    const c = cold as { chill: number; brittle: boolean } | null;
    assert(fused ? !!c && Math.abs(c.chill - 3) <= 1 / 60 + 1e-9 && c.brittle : !c || (c.chill === 0 && !c.brittle), `${fused ? 'fused' : 'plain'}: the cold ${JSON.stringify(c)}`);
    assert((enemy(s.sim, s.reaper)!.chill ?? 0) === 0, 'the Reaper does not freeze');
    assert(fired(events, FUSIONS.frostWave) === (fused ? 1 : 0), 'the signal');
    if (fused) for (const h of plan.wave!.bodies) assertHit(s.sim, h, 'wave');
    const t = enemy(s.sim, s.tough)!;
    draw(s.sim, [{ x: t.x, y: t.y }]);
    const hit = planChain(s.sim.world).links[0].outcome!;
    assert(hit.damage === hit.available * (fused ? 2 : 1), `${fused ? 'fused' : 'plain'}: the next hit ${hit.damage} of ${hit.available}`);
    assert(replaysWithCheckpoints(s.sim), 'replays');
  }
  const three = waveScene({ talismans: [FUSIONS.frostWave] }, 3);
  assert(!planChain(three.sim.world).wave, 'a chain of 3: no wave in the plan');
  three.sim.command({ t: 'release' });
  const events = settle(three.sim);
  assert(!events.some(e => e.type === 'wave') && (enemy(three.sim, three.tough)!.chill ?? 0) === 0, 'a chain of 3: no wave, no cold');
});

check('the release fixes the bodies: a body walking into the circle of «Подрыв» or of «Ледяная волна» during the dash is not struck (nor frozen)', () => {
  const row = [6, 7.2, 8.4, 9.6, 10.8].map(x => ({ x, y: 5 })), end = row[4];
  const cases: [Loadout, 'blast' | 'wave', number, Partial<Params>][] = [[{ talismans: [FUSIONS.hunterBlast] }, 'blast', 2.75, { eliteArmor: true }], [{ talismans: [FUSIONS.frostWave] }, 'wave', 2.6, { counterWindow: true }]];
  for (const [loadout, kind, off, extra] of cases) {
    const sim = fight(loadout, { enemySpeed: 1.5, ...extra });
    row.forEach((p, i) => place(sim, p, kind === 'blast' && i === 4 ? { elite: true } : {}));
    const walker = place(sim, { x: end.x + 0.5, y: 5 + off }, { color: 2, hp: 5 });
    draw(sim, row);
    const plan = planChain(sim.world), planned = kind === 'blast' ? plan.blast : plan.wave;
    assert(planned && !planned.bodies.some(b => b.id === walker), `${kind}: the walker is not in the planned bodies`);
    sim.command({ t: 'release' });
    let inside = false, dbg = "";
    settle(sim, now => {
      const ev = now.find(e => (kind === 'blast' ? e.type === 'hammer' && e.kind === 'blast' : e.type === 'wave'));
      const w = enemy(sim, walker);
      if (ev && w && "x" in ev) dbg = JSON.stringify({ ev, w: { x: w.x, y: w.y } });
      if (ev && w && "x" in ev && "r" in ev) inside = Math.hypot(w.x - ev.x, w.y - ev.y) <= (ev.r ?? 0) + sim.world.params.enemyRadius;
    });
    assert(inside, `${kind}: the walker stood in the circle when it went off (the scene): ${dbg}`);
    const w = enemy(sim, walker)!;
    assert(w.hp === 5 && (w.chill ?? 0) === 0, `${kind}: the walker untouched (hp ${w.hp}, chill ${w.chill})`);
    assert(replaysWithCheckpoints(sim), 'replays');
  }
});

check('telemetry: the fight summary counts the bodies of each fusion (`build.fusionBodies`)', () => {
  const { sim } = brandScene({ talismans: [FUSIONS.brand] });
  const obs = createFightObserver(sim.world);
  sim.command({ t: 'release' });
  for (let i = 0; i < 200; i++) { sim.tick(); obs.tick(sim.world); sim.world.events.length = 0; }
  const s = obs.summary();
  assert(s.build.fusionBodies?.[FUSIONS.brand] === 2 && s.build.fired[FUSIONS.brand] === 1, `the summary ${JSON.stringify(s.build)}`);
});

/** A tiny seeded generator for the scenes (not the simulation's: the scenes only place bodies). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A chain of `n` links on a gentle curve from the hero at (4.5, 6), and bodies of other colours around its path and its end. */
function randomScene(loadout: Loadout, k: number, n: number, extra: Partial<Params>) {
  const rnd = rngOf(seedOf(k));
  const sim = fight(loadout, { enemySpeed: 0.8, eliteArmor: true, hitstop: k % 2 === 0, counterWindow: true, ...extra }, k);
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  let angle = (rnd() - 0.5) * 0.6, at = { x: 4.5 + 1.2, y: 6 };
  const links: Vec[] = [];
  for (let i = 0; i < n; i++) { links.push(at); angle += (rnd() - 0.5) * 0.5; at = { x: at.x + 1.15 * Math.cos(angle), y: at.y + 1.15 * Math.sin(angle) }; }
  links.forEach((p, i) => place(sim, p, i === n - 1 ? (rnd() < 0.4 ? { elite: true } : { hp: Math.floor(rnd() * 4) }) : {}));
  const end = links[n - 1];
  for (let i = 0; i < 6; i++) {
    const base = i < 3 ? end : links[Math.floor(rnd() * n)];
    const a = rnd() * 6.283, r = 0.7 + rnd() * 1.6;
    place(sim, { x: base.x + r * Math.cos(a), y: base.y + r * Math.sin(a) }, { color: 1 + Math.floor(rnd() * 3), hp: Math.floor(rnd() * 4), elite: rnd() < 0.15 });
  }
  for (let t = 0; t < 8; t++) sim.tick();
  const ids = sim.world.enemies.slice(0, n).map(e => e.id);
  draw(sim, ids.map(id => { const e = enemy(sim, id)!; return { x: e.x, y: e.y }; }));
  return { sim, n };
}

check('the highlight is the fight on scenes of 8 seeds with walking enemies for each fusion: the paint, the blast\'s and the wave\'s bodies and outcomes, the frozen; outcomes vary; every fight replays', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    // «Клеймо»: the painted bodies are the planned ones (a planned body killed on the way — by the fire — is the accepted rest).
    const brand = randomScene({ talismans: [FUSIONS.brand] }, k, 4, {});
    if (brand.sim.world.chain.length >= 3) {
      const plan = planChain(brand.sim.world), before = new Map(brand.sim.world.enemies.map(e => [e.id, e.color]));
      brand.sim.command({ t: 'release' });
      settle(brand.sim);
      const paint = plan.fire?.paint;
      for (const e of brand.sim.world.enemies) {
        const was = before.get(e.id);
        if (was === undefined || was === e.color) continue;
        assert(paint && paint.ids.includes(e.id) && e.color === paint.color, `seed ${k}: body ${e.id} painted ${was} → ${e.color} not planned (${JSON.stringify(paint)})`);
      }
      for (const id of paint?.ids ?? []) { const e = enemy(brand.sim, id); assert(!e || e.color === paint!.color, `seed ${k}: planned body ${id} not painted`); }
      seen.add(`brand:${paint?.ids.length ?? 'none'}`);
      assert(replaysWithCheckpoints(brand.sim), `seed ${k}: brand replays`);
    }
    // «Подрыв»: the blast's bodies and outcomes.
    const blast = randomScene({ talismans: [FUSIONS.hunterBlast] }, k, 3, {});
    if (blast.sim.world.chain.length === 3) {
      const plan = planChain(blast.sim.world);
      blast.sim.command({ t: 'release' });
      settle(blast.sim);
      if (plan.blast) for (const h of plan.blast.bodies) assertHit(blast.sim, h, `seed ${k} blast`);
      seen.add(`blast:${plan.blast ? (plan.blast.detonate ? 'detonate' : 'plain') : 'none'}`);
      for (const h of plan.blast?.bodies ?? []) seen.add(`blast-hit:${h.killed ? 'kill' : h.plate ? 'plate' : 'wound'}`);
      assert(replaysWithCheckpoints(blast.sim), `seed ${k}: blast replays`);
    }
    // «Ледяная волна»: the wave's bodies, outcomes and the frozen.
    const wave = randomScene({ talismans: [FUSIONS.frostWave] }, k, 4, {});
    if (wave.sim.world.chain.length === 4) {
      const plan = planChain(wave.sim.world);
      wave.sim.command({ t: 'release' });
      let frozen: number[] | null = null;
      settle(wave.sim, now => { if (now.some(e => e.type === 'wave')) frozen = (plan.wave?.ice.ids ?? []).filter(id => { const e = enemy(wave.sim, id); return !!e && (e.chill ?? 0) > 0 && !!e.brittle; }); });
      if (plan.wave) {
        for (const h of plan.wave.bodies) assertHit(wave.sim, h, `seed ${k} wave`);
        assert(frozen && (frozen as number[]).join() === plan.wave.ice.ids.join(), `seed ${k}: frozen ${frozen}, planned ${plan.wave.ice.ids}`);
      }
      seen.add(`wave:${plan.wave ? plan.wave.ice.ids.length : 'none'}`);
      assert(replaysWithCheckpoints(wave.sim), `seed ${k}: wave replays`);
    }
  }
  assert(seen.size >= 7, `outcomes vary: ${[...seen].join(', ')}`);
});

check('a journal without the new keys plays the same world (a fight without the fusions never reads them)', () => {
  const sim = fight({ talismans: [CT.prism, FROST_PASS, CT.shockwave, CT.eliteHunter], hammer: HAMMERS.fire }, { counterWindow: true });
  const links = [6, 7.2, 8.4, 9.6].map(x => ({ x, y: 5 }));
  for (const p of links) place(sim, p);
  place(sim, { x: 10.3, y: 5.6 }, { color: 2, hp: 2 });
  draw(sim, links);
  sim.command({ t: 'release' });
  settle(sim);
  for (let i = 0; i < 300; i++) sim.tick();
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal & { params: Record<string, unknown> };
  for (const key of ['fusionBrandReach', 'fusionBlastFactor', 'fusionBlastPower', 'fusionBlastPlates', 'fusionWaveTime', 'fusionWaveBrittle']) {
    assert(key in journal.params, `${key} is in the journal`);
    delete journal.params[key];
  }
  const { params: _a, ...a } = worldState(sim.world) as Record<string, unknown>, { params: _b, ...b } = worldState(replay(journal).world) as Record<string, unknown>;
  assert(JSON.stringify(a) === JSON.stringify(b), 'the same world without the keys');
});

console.log(`\n${checks} checks passed`);
