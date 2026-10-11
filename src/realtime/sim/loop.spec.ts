/**
 * Loop research, step 2 (docs/realtime-loop-research.md, sections 2.3 and 3.1–3.4; user decisions 11.10.2026): the loop
 * («Печать») of the barbarian in the sandbox. Node only: `npm run test:realtime-loop`.
 *
 * Every check plays journalled commands (place, teleport, begin, drag, release, param) on a quiet field and looks at what
 * the player meets:
 * - off (the default): the pointer on the first link of 4 does nothing, as before;
 * - the pointer on the first link of 4 closes the chain; the highlight's «inside» is exactly who the seal strikes at the end of
 *   the dash; the hit ⌊(n − 2) ÷ 2⌋ ≥ 1 and the hold (the cold without the ×2); seal kills are the player's (kill counter,
 *   goal) but not the chain's (no combo, no crystal, no chain score);
 * - closing on the hero with 3 links (he is a corner);
 * - refusals with their texts: «далеко», «нет видимости», «нить пересеклась»; with 3 links the step back is as before;
 * - a closed chain takes nothing more, the pointer on its last link opens it; Esc cancels it;
 * - the reaper and the ring's own links are never inside; a sapper killed by the seal blows up as the player's;
 * - every fight replays from its journal to the same hash. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { hoverRefusal, planChain, REFUSAL_TEXT, type Refusal } from './chain';
import { wall, type Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { sealDamage } from './seal';
import { Simulation, replay } from './simulation';
import type { WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'loop-field', name: 'Поле петли', summary: 'Тест петли', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
registerArena({
  id: 'loop-wall', name: 'Поле петли со стеной', summary: 'Тест петли', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [wall(5.6, 4.7, 0.8, 0.6)], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** A quiet fight: nobody walks or touches, no newcomers; the loop on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false;
  p.loopEnabled = true;
  return Object.assign(p, extra);
}
function field(extra: Partial<Params> = {}, arena = 'loop-field', k = 1): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, at: Vec, opts: { color?: number; hp?: number; kind?: string } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind: opts.kind ?? 'basic' }) as number;
/** Draws the chain through `points` (the first by a press, the rest by drags). */
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the dash is over (and a little more), collecting the events. */
function run(sim: Simulation, ticks = 120): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let t = 0; t < ticks; t++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the seal strikes (the end of the dash), collecting the events; the hold is read on that tick. */
function runToStrike(sim: Simulation): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let t = 0; t < 240 && !out.some(e => e.type === 'seal' && e.phase === 'strike'); t++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const len = (sim: Simulation): number => sim.world.chain.length;
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** A square of four colour-0 links round (7, 5); the first is in the hero's reach. */
const SQUARE: Vec[] = [{ x: 6, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 6 }, { x: 6, y: 6 }];

check('off (the default): the pointer on the first of 4 links does nothing — no closing, the chain stays open', () => {
  const sim = field({ loopEnabled: false });
  for (const p of SQUARE) place(sim, p);
  draw(sim, [...SQUARE, SQUARE[0]]);
  assert(defaultParams().loopEnabled === false && sim.world.chain.length === 4 && !sim.world.chainClosed, 'open');
  assert(!planChain(sim.world).seal, 'no seal in the plan');
  assert(replays(sim), 'replays');
});

check('closing on the first link: the highlight\'s inside = whom the seal strikes; the hit 1 and the hold 1.5 s; links and outsiders untouched', () => {
  const sim = field();
  const ring = SQUARE.map(p => place(sim, p));
  const inner = place(sim, { x: 7, y: 5 }, { color: 2, hp: 2 }), outer = place(sim, { x: 10, y: 5 }, { color: 2, hp: 2 });
  draw(sim, SQUARE);
  assert(!sim.world.chainClosed, 'open before the gesture');
  sim.command({ t: 'drag', x: SQUARE[0].x, y: SQUARE[0].y, mode: 'full' });
  const events = [...sim.world.events];
  assert(sim.world.chainClosed === 'first' && events.some(e => e.type === 'loop' && e.action === 'close'), 'closed');
  const seal = planChain(sim.world).seal!;
  assert(seal && seal.inside.join() === String(inner) && seal.links === 4 && seal.damage === 1, `the plan's seal ${JSON.stringify(seal)}`);
  sim.command({ t: 'release' });
  const after = runToStrike(sim);
  const strike = after.find(e => e.type === 'seal' && e.phase === 'strike');
  assert(strike && strike.type === 'seal' && strike.inside.join() === seal.inside.join(), 'struck = the highlight\'s inside');
  const w = sim.world, e = w.enemies.find(x => x.id === inner)!;
  assert(e && e.hp === 1 && Math.abs((e.chill ?? 0) - 1.5) < 0.05 && !e.brittle, `inner hp ${e?.hp} chill ${e?.chill}`);
  assert(w.enemies.find(x => x.id === outer)!.hp === 2 && ring.every(id => !w.enemies.some(x => x.id === id)), 'the outsider untouched, the ring killed by the dash');
  assert(replays(sim), 'replays');
});

check('seal kills are the player\'s (counter, credited `seal`) but not the chain\'s (combo, crystal, chain score); damage ⌊(n−2)/2⌋, long hold from 8', () => {
  assert([4, 5, 6, 7, 8, 10].map(sealDamage).join() === '1,1,2,2,3,4', 'the hit table');
  const sim = field({ crystalEvery: 6 } as Partial<Params>);
  for (const p of SQUARE) place(sim, p);
  const inner = [{ x: 6.6, y: 4.8 }, { x: 7.4, y: 5.2 }, { x: 7, y: 4.6 }].map(p => place(sim, p, { color: 1 }));
  draw(sim, [...SQUARE, SQUARE[0]]);
  sim.command({ t: 'release' });
  const events = run(sim);
  const kills = events.filter(e => e.type === 'kill');
  assert(kills.filter(e => e.type === 'kill' && e.source === 'seal' && e.credited).length === 3, 'three seal kills, credited');
  assert(inner.every(id => !sim.world.enemies.some(x => x.id === id)), 'all three died');
  assert(sim.world.stats.kills === 7 && sim.world.lastChain?.kills === 4, `kills ${sim.world.stats.kills}, chain kills ${sim.world.lastChain?.kills}`);
  assert(!events.some(e => e.type === 'crystal') && !sim.world.objects.some(o => o.kind === 'crystal'), 'no crystal (7 kills, only 4 of the chain)');
  // Eight links: the hit 3, the long hold 2 s.
  const big = field({}, 'loop-field', 2);
  const octagon: Vec[] = [{ x: 6, y: 4 }, { x: 7.5, y: 3.2 }, { x: 9, y: 4 }, { x: 9.8, y: 5.5 }, { x: 9, y: 7 }, { x: 7.5, y: 7.8 }, { x: 6, y: 7 }, { x: 5.4, y: 5.5 }];
  for (const p of octagon) place(big, p);
  const tough = place(big, { x: 7.6, y: 5.5 }, { color: 3, hp: 4 });
  draw(big, [...octagon, octagon[0]]);
  assert(big.world.chainClosed === 'first' && planChain(big.world).seal!.damage === 3 && planChain(big.world).seal!.hold === 2, 'n 8: 3 and 2 s');
  big.command({ t: 'release' });
  runToStrike(big);
  const t = big.world.enemies.find(x => x.id === tough)!;
  assert(t.hp === 1 && Math.abs((t.chill ?? 0) - 2) < 0.05, `tough hp ${t.hp} chill ${t.chill}`);
  assert(replays(sim) && replays(big), 'replays');
});

check('closing on the hero with 3 links: he is a corner; the enemy between him and the arc is struck', () => {
  const sim = field();
  const arc: Vec[] = [{ x: 6, y: 3.6 }, { x: 7.6, y: 5 }, { x: 6, y: 6.4 }];
  for (const p of arc) place(sim, p);
  const inner = place(sim, { x: 6.4, y: 5 }, { color: 2, hp: 1 });
  draw(sim, arc);
  sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  assert(sim.world.chainClosed === 'hero', 'closed on the hero');
  const seal = planChain(sim.world).seal!;
  assert(seal.ring.length === 4 && seal.ring[0].x === 4.5 && seal.inside.join() === String(inner), 'the hero is the first corner; the inner one inside');
  sim.command({ t: 'release' });
  run(sim);
  assert(!sim.world.enemies.some(x => x.id === inner), 'struck (hp 1, hit 1)');
  // Off by its own toggle: the pointer on the hero does nothing with 3 links.
  const off = field({ loopHeroCloses: false });
  for (const p of arc) place(off, p);
  draw(off, arc);
  off.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  assert(!off.world.chainClosed && off.world.chain.length === 3, 'no closing on the hero');
  assert(replays(sim) && replays(off), 'replays');
});

check('refusals with their texts: far, no sight (a wall), the closing edge crosses the ring; the hint at the pointer says the same', () => {
  const cases: { name: Refusal; arena: string; points: Vec[] }[] = [
    { name: 'far', arena: 'loop-field', points: [{ x: 6, y: 4 }, { x: 8, y: 4 }, { x: 10, y: 4.5 }, { x: 10, y: 6.5 }] },
    { name: 'sight', arena: 'loop-wall', points: SQUARE },
    { name: 'crossed', arena: 'loop-field', points: [{ x: 6, y: 4 }, { x: 6, y: 5.5 }, { x: 7.5, y: 4 }, { x: 7.5, y: 5.5 }] },
  ];
  for (const c of cases) {
    const sim = field({}, c.arena);
    for (const p of c.points) place(sim, p);
    draw(sim, c.points);
    assert(sim.world.chain.length === 4, `${c.name}: 4 links drawn (${sim.world.chain.length})`);
    assert(hoverRefusal(sim.world, c.points[0], true) === c.name, `${c.name}: the hint ${hoverRefusal(sim.world, c.points[0], true)}`);
    sim.command({ t: 'drag', x: c.points[0].x, y: c.points[0].y, mode: 'full' });
    const ev = sim.world.events.find(e => e.type === 'loop');
    assert(!sim.world.chainClosed && ev?.type === 'loop' && ev.action === 'refused' && ev.refusal === c.name, `${c.name}: refused`);
    assert(sim.world.chain.length === 4, `${c.name}: the chain stays`);
    assert(replays(sim), `${c.name}: replays`);
  }
  assert(REFUSAL_TEXT.far === 'далеко' && REFUSAL_TEXT.sight === 'нет видимости' && REFUSAL_TEXT.crossed === 'нить пересеклась', 'the texts');
});

check('the step back is as before: with 3 links the pointer on the second takes the last off; on the first — nothing', () => {
  const sim = field();
  const three = SQUARE.slice(0, 3);
  for (const p of three) place(sim, p);
  draw(sim, three);
  sim.command({ t: 'drag', x: three[0].x, y: three[0].y, mode: 'full' });
  assert(len(sim) === 3 && !sim.world.chainClosed, 'on the first: nothing');
  sim.command({ t: 'drag', x: three[1].x, y: three[1].y, mode: 'full' });
  assert(len(sim) === 2 && !sim.world.chainClosed, 'on the second: the step back');
  assert(replays(sim), 'replays');
});

check('a closed chain takes nothing more; the pointer on its last link opens it, the first closes it again; Esc cancels it', () => {
  const sim = field();
  for (const p of SQUARE) place(sim, p);
  const extra = place(sim, { x: 6, y: 2.2 });
  draw(sim, [...SQUARE, SQUARE[0]]);
  assert(sim.world.chainClosed === 'first', 'closed');
  assert(hoverRefusal(sim.world, { x: 6, y: 2.2 }, true) === 'sealed', 'the hint «петля замкнута»');
  sim.command({ t: 'drag', x: 6, y: 2.2, mode: 'full' });
  assert(sim.world.chain.length === 4 && !sim.world.chain.some(l => l.id === extra), 'nothing joins');
  sim.command({ t: 'drag', x: SQUARE[3].x, y: SQUARE[3].y, mode: 'full' });
  assert(!sim.world.chainClosed && sim.world.chain.length === 4 && sim.world.events.some(e => e.type === 'loop' && e.action === 'open'), 'opened, no link taken off');
  sim.command({ t: 'drag', x: SQUARE[0].x, y: SQUARE[0].y, mode: 'full' });
  assert(sim.world.chainClosed === 'first', 'closed again');
  sim.command({ t: 'cancel' });
  assert(!sim.world.chain.length && !sim.world.chainClosed, 'cancelled');
  assert(replays(sim), 'replays');
});

check('the reaper and the ring\'s links are never inside; a sapper killed by the seal blows up as the player\'s', () => {
  const sim = field();
  for (const p of SQUARE) place(sim, p);
  const reaper = place(sim, { x: 7.3, y: 5.3 }, { kind: 'reaper', color: -1 });
  const sapper = place(sim, { x: 6.8, y: 4.8 }, { kind: 'sapper', color: 2 });
  draw(sim, [...SQUARE, SQUARE[0]]);
  const seal = planChain(sim.world).seal!;
  assert(seal.inside.join() === String(sapper), `inside ${seal.inside.join()}`);
  sim.command({ t: 'release' });
  const events = run(sim, 40);
  assert(events.some(e => e.type === 'kill' && e.enemyId === sapper && e.source === 'seal' && e.credited), 'the sapper died by the seal');
  assert(sim.world.blasts.some(b => b.ownerId === sapper && b.credited) || events.some(e => e.type === 'blast'), 'its blast is the player\'s');
  assert(sim.world.enemies.some(e => e.id === reaper), 'the reaper stands');
  assert(replays(sim), 'replays');
});

check('a closed chain opens when one of its links dies while it is drawn (the ring changed)', () => {
  const sim = field();
  const ids = SQUARE.map(p => place(sim, p));
  draw(sim, [...SQUARE, SQUARE[0]]);
  assert(sim.world.chainClosed === 'first', 'closed');
  sim.world.enemies = sim.world.enemies.filter(e => e.id !== ids[2]);
  sim.tick();
  assert(!sim.world.chainClosed && sim.world.chain.length === 3, 'opened');
});

console.log(`${checks} checks passed`);
