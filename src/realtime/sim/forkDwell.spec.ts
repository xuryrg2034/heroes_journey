/**
 * Task 52 «Числа», Р2 (docs/design-notes/task-52-numbers.md, 3.5–3.6): «Развилка»'s gesture in the sandbox — `Params.forkDwell`. Node only:
 * `npm run test:realtime-fork-dwell`.
 *
 * Every check plays real journalled commands (place, teleport, begin, drag, release, ticks) on a quiet open field, on 5 seeds
 * (`Math.imul(k, 2654435761) >>> 0`; the layout shifts with the seed):
 * - the pointer event resting on an older link for `forkDwell` game seconds makes it the anchor: the next link is taken only from it
 *   (`fork`), the highlight (`nextCandidates`, `enemyRefusal`, `chainAnchors`) shows the same; then the anchor is the last link again;
 * - a pointer that leaves before the dwell is done (jitter) chooses nothing; the last link and the one before it never become the
 *   anchor (the one before stays the step back);
 * - `forkDwell` 0 and a journal without the key play the old rule; the run keeps it 0; journals replay to the same hash.
 */
import { registerArena } from './arenas';
import { FORMS } from './buildIds';
import { chainAnchors, enemyRefusal, nextCandidates, planChain } from './chain';
import { forkAnchorNow } from './forms';
import { worldState } from './hash';
import { defaultParams, runParams, type Params } from './params';
import { SIM_DT, Simulation, replay, type Journal } from './simulation';
import type { Vec } from './geometry';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const SEEDS = [1, 2, 3, 4, 5];
function lcg(seed: number): () => number { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

registerArena({ goal: 'kills', width: 20, height: 12, heroStart: { x: 4.5, y: 6 }, buttons: [], enemies: [], killGoal: 999, id: 'fork-dwell-field', name: 'Поле развилки', summary: 'Тест жеста «Развилки»', obstacles: [], door: { x: 19.3, y: 6 } });

const DWELL = 0.25;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
/** A quiet fight with «Развилка»: no newcomers, nobody walks or touches; the loop and the pierce off. */
function fight(k: number, extra: Partial<Params> = {}, talismans: string[] = [FORMS.fork]): Simulation {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false; p.survivorKnockback = false; p.loopEnabled = false; p.pierceEnabled = false; p.forkDwell = DWELL;
  const sim = new Simulation({ arena: 'fork-dwell-field', params: Object.assign(p, extra), seed: seedOf(k), record: true, loadout: { talismans } });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  return sim;
}
const place = (sim: Simulation, at: Vec): number => sim.command({ t: 'place', x: at.x, y: at.y, color: 0, hp: 0, kind: 'basic' }) as number;
const at = (sim: Simulation, id: number): Vec => { const e = sim.world.enemies.find(x => x.id === id)!; return { x: e.x, y: e.y }; };
const drag = (sim: Simulation, p: Vec): void => { sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); };
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n; i++) { sim.tick(); sim.world.events.length = 0; } };
const ids = (sim: Simulation): number[] => sim.world.chain.map(l => l.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/**
 * Three links a, b, c in a row from the hero (a — the older link, b — the one before the last, c — the last) and d, e beside a: within
 * R of a only (far from b and c) — a fork from a. Positions shift with the seed.
 */
function scene(k: number, extra: Partial<Params> = {}, talismans?: string[]) {
  const sim = fight(k, extra, talismans), rnd = lcg(seedOf(k)), y = 6 + (rnd() - 0.5) * 0.4, reach = sim.world.params.linkRadius;
  const a = place(sim, { x: 5.7, y }), b = place(sim, { x: 6.9 + rnd() * 0.1, y }), c = place(sim, { x: 8.1 + rnd() * 0.1, y });
  const d = place(sim, { x: 5.7 - 0.3 * rnd(), y: y - reach - 0.2 }), e = place(sim, { x: 5.7 + 0.3 * rnd(), y: y + reach + 0.2 });
  sim.command({ t: 'begin', x: 5.7, y });
  drag(sim, at(sim, b)); drag(sim, at(sim, c));
  assert(ids(sim).join() === [a, b, c].join(), `seed ${k}: the chain a, b, c (${ids(sim)})`);
  return { sim, a, b, c, d, e };
}
const anchorIds = (sim: Simulation): number[] => chainAnchors(sim.world).flatMap(x => (x.link ? [x.link.id] : [-1]));
const offered = (sim: Simulation, id: number): boolean => nextCandidates(sim.world).some(x => x.id === id);

check('the dwell: the pointer resting on an older link 0,25 s makes it the anchor — the next link joins from it (`fork`), the highlight showed it; then the anchor is the last link again; plan = dash (5 seeds)', () => {
  for (const k of SEEDS) {
    const { sim, a, c, d, e } = scene(k);
    // Before: the anchor is the last link; d is beyond its reach.
    assert(anchorIds(sim).join() === String(c) && !offered(sim, d) && enemyRefusal(sim.world, sim.world.enemies.find(x => x.id === d)!) === 'far', `seed ${k}: d refused before the dwell`);
    drag(sim, at(sim, a));
    ticks(sim, ticksOf(DWELL) - 1);
    assert(forkAnchorNow(sim.world) === null && !offered(sim, d), `seed ${k}: not yet (one tick short)`);
    ticks(sim, 1);
    assert(forkAnchorNow(sim.world)?.id === a && anchorIds(sim).join() === String(a), `seed ${k}: a is the anchor (${anchorIds(sim)})`);
    assert(offered(sim, d) && enemyRefusal(sim.world, sim.world.enemies.find(x => x.id === d)!) === null, `seed ${k}: the highlight offers d`);
    // The pointer goes to d (through an empty spot: the anchor stays, the dwell was done).
    drag(sim, { x: at(sim, a).x - 1.2, y: at(sim, a).y });
    assert(forkAnchorNow(sim.world)?.id === a, `seed ${k}: the anchor stays when the pointer leaves after the dwell`);
    drag(sim, at(sim, d));
    assert(ids(sim).join() === [a, sim.world.chain[1].id, c, d].join() && sim.world.chain[3].fork?.id === a, `seed ${k}: d joins from a (${JSON.stringify(sim.world.chain)})`);
    assert(!sim.world.forkAnchor && anchorIds(sim).join() === String(d), `seed ${k}: the anchor is the last link again`);
    // One fork a chain: e (from a) is refused now.
    drag(sim, at(sim, a)); ticks(sim, ticksOf(DWELL) + 2); drag(sim, at(sim, e));
    assert(ids(sim).length === 4 && !offered(sim, e), `seed ${k}: a second fork is refused`);
    const plan = planChain(sim.world);
    sim.command({ t: 'release' });
    ticks(sim, 300);
    assert(plan.kills === 4 && [a, c, d].every(id => !sim.world.enemies.some(x => x.id === id)), `seed ${k}: the dash did what the plan said`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('jitter: the pointer leaving the older link before 0,25 s (and coming back) chooses nothing — d stays refused; the last link and the one before it never become the anchor (the one before is the step back)', () => {
  for (const k of SEEDS) {
    const { sim, a, d } = scene(k);
    for (let n = 0; n < 4; n++) { drag(sim, at(sim, a)); ticks(sim, ticksOf(DWELL) - 3); drag(sim, { x: at(sim, a).x, y: at(sim, a).y + 1.1 }); }
    assert(!sim.world.forkAnchor && forkAnchorNow(sim.world) === null, `seed ${k}: no anchor after jitter (${JSON.stringify(sim.world.forkAnchor)})`);
    drag(sim, at(sim, d));
    assert(ids(sim).length === 3 && !offered(sim, d), `seed ${k}: d refused`);
    assert(replays(sim), `seed ${k}: replay`);
    // The last link: held — nothing.
    const last = scene(k), lastId = last.c;
    drag(last.sim, at(last.sim, lastId)); ticks(last.sim, ticksOf(DWELL) * 2);
    assert(!last.sim.world.forkAnchor && anchorIds(last.sim).join() === String(lastId), `seed ${k}: the last link is no fork anchor`);
    // The one before: the step back (c taken off); held — no anchor (b is the last link now).
    const back = scene(k);
    drag(back.sim, at(back.sim, back.b)); ticks(back.sim, ticksOf(DWELL) * 2);
    assert(ids(back.sim).join() === [back.a, back.b].join() && !back.sim.world.forkAnchor, `seed ${k}: the step back, no anchor (${ids(back.sim)})`);
  }
});

check('`forkDwell` 0 and a journal without the key play the old rule (every link an anchor: d joins at once); the run keeps it 0; a fight without «Развилка» never reads it', () => {
  for (const k of SEEDS) {
    const old = scene(k, { forkDwell: 0 });
    assert(anchorIds(old.sim).includes(old.a) && offered(old.sim, old.d), `seed ${k}: 0 — every link an anchor`);
    drag(old.sim, at(old.sim, old.d));
    assert(ids(old.sim).length === 4 && old.sim.world.chain[3].fork?.id === old.a && !old.sim.world.forkAnchor, `seed ${k}: d joins at once`);
    // A journal with the dwell, the key taken out: the old rule (another world).
    const now = scene(k);
    drag(now.sim, at(now.sim, now.a)); ticks(now.sim, ticksOf(DWELL) + 1); drag(now.sim, at(now.sim, now.d));
    const journal = JSON.parse(JSON.stringify(now.sim.exportJournal())) as Journal;
    delete (journal.params as Partial<Params>).forkDwell;
    const again = replay(journal);
    assert(!again.world.forkAnchor && again.hash() !== now.sim.hash(), `seed ${k}: without the key the dwell is not played`);
    // Without «Развилка» the key changes nothing: the same world without it.
    const plain = scene(k, {}, []);
    drag(plain.sim, at(plain.sim, plain.a)); ticks(plain.sim, ticksOf(DWELL) + 1);
    const pj = JSON.parse(JSON.stringify(plain.sim.exportJournal())) as Journal;
    delete (pj.params as Partial<Params>).forkDwell;
    const strip = (s: unknown): string => { const o = s as Record<string, unknown>; delete o.params; return JSON.stringify(o); };
    assert(strip(worldState(replay(pj).world)) === strip(worldState(plain.sim.world)) && !plain.sim.world.forkAnchor, `seed ${k}: without the form the key is not read`);
  }
  assert(runParams(defaultParams()).forkDwell === 0 && defaultParams().forkDwell === 0, 'the run 0; the sandbox default 0 (the old rule) until design says otherwise');
});

console.log(`realtime-fork-dwell: ${checks} checks passed`);
