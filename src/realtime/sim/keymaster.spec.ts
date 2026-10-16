/**
 * Task 40 «Гарнизон, шаг 1б» — the keymaster and its shackles, the arena «Ров» (sim/enemies/garrison.ts «Ключник», sim/tethers.ts,
 * sim/arenasGarrison.ts; docs/realtime-elite-behaviors.md, «Гарнизон»). Node only: `npm run test:realtime-keymaster`.
 *
 * Every check plays journalled commands (clear, teleport, place, param, begin / drag, release) and looks at what the player meets:
 * - the keymaster shackles the nearest plain enemy, guard or dog handler within 4 — the first 3 s after it appears, then every 6 s,
 *   at most 2 at once; never an elite, a hound, another keymaster; without the key — never;
 * - the prisoner stands and no chain takes it (refusal `shackled`, a real `begin` on it takes nothing); a chain whose dash crosses
 *   the shackle: the highlight's `cuts` before the release is what the dash cuts, after its end (the shackle stands while the dash
 *   runs); the prisoner is free for the next chain (a `begin` on it takes it); the keymaster's next shackle only 6 s after the cut;
 * - the keymaster's death drops its shackles after the dash (the prisoners stand while it runs);
 * - a real fight of «Ров» by a greedy bot on several seeds: every chain's highlighted cuts are the dash's; some shackles are cut;
 *   the fight replays to its hash; the live telemetry summary is the replay's (`garrison.shackles`, `shackleCuts`);
 * - a journal without the new keys plays the old world; a deep fight of «Ров» stands two keymasters and a dog handler.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import type { Command } from './commands';
import { createFightObserver } from '../telemetry/observe';
import { analyzeJournal } from '../telemetry/report';
import { withSummaryDefaults, type FightSummary } from '../telemetry/schema';
import { chainAnchor, enemyRefusal, nextCandidates, planChain } from './chain';
import { HANDLER, HOUND, KEYMASTER, SHACKLE_FIRST } from './enemies/garrison';
import type { Vec } from './geometry';
import { hashWorld, worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { shackled, tetherCrossing } from './tethers';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** An open field (no garrison flag: the given values decide the law). */
registerArena({
  id: 'keymaster-field', name: 'Поле ключника', summary: 'Тест кандалов', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [],
});

/** A fight where nothing comes and the hero cannot fall; the shackles on (the law of tethers too). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.survivorKnockback = false;
  p.tethers = true; p.shackles = true;
  return Object.assign(p, extra);
}
function field(k = 1, params: Params = quiet()): Simulation {
  const sim = new Simulation({ arena: 'keymaster-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over); `during` sees the world while the dash runs. */
function settle(sim: Simulation, out: WorldEvent[] = [], during?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; if (sim.world.move) during?.(sim.world); }
  return out;
}
type TetherEvent = Extract<WorldEvent, { type: 'tether' }>;
const tethersOf = (events: readonly WorldEvent[]): TetherEvent[] => events.filter((e): e is TetherEvent => e.type === 'tether');
const cutsOf = (events: readonly WorldEvent[]): number[] => tethersOf(events).filter(e => e.action === 'cut').map(e => e.held).sort((a, b) => a - b);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const sorted = (ids: readonly number[] | undefined): number[] => [...ids ?? []].sort((a, b) => a - b);
/** The ids the chain holds now. */
const chainIds = (w: World): number[] => w.chain.flatMap(l => (l.kind === 'enemy' ? [l.id] : []));

/**
 * The keymaster at (10, 6) and the hero at (3, 6) — 7 apart, it walks up to 5 (`KEYMASTER_FAR`); then everybody stands
 * (`enemySpeed` 0). `bodies` — plain enemies placed around it (relative to it) before it walks.
 */
function keeper(k = 1, bodies: Vec[] = [{ x: 1.5, y: 1.2 }], extra: Partial<Params> = {}): { sim: Simulation; km: Enemy; others: Enemy[] } {
  const sim = field(k, quiet({ enemySpeed: 0, ...extra }));
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const km = place(sim, { x: 8, y: 6 }, 1, KEYMASTER, 1);
  const others = bodies.map((b, i) => place(sim, { x: km.x + b.x, y: km.y + b.y }, 0, 'basic', i % 4));
  ticks(sim, 1);
  return { sim, km, others };
}

check('without the key no shackle: the keymaster stands among plain enemies 10 s, no tether, none in the hash', () => {
  const { sim } = keeper(1, [{ x: 1, y: 1 }, { x: 1, y: -1 }], { shackles: false });
  ticks(sim, ticksOf(10));
  assert(sim.world.tethers === undefined && !('tethers' in (worldState(sim.world) as object)), 'no shackle');
});

check('the schedule: the first shackle 3 s after the keymaster appears, the second 6 s later, never a third (max 2); several seeds', () => {
  for (const k of [1, 2, 3]) {
    const { sim, km, others } = keeper(k, [{ x: 1.2, y: 0.6 }, { x: 1.5, y: -1.4 }, { x: -2, y: 2 }]), w = sim.world;
    const born = w.time - SIM_DT, times: { t: number; held: number }[] = [];
    for (let i = 0; i < ticksOf(20); i++) {
      sim.tick();
      for (const e of tethersOf(w.events)) if (e.action === 'shackle') times.push({ t: w.time - born, held: e.held });
      w.events.length = 0;
    }
    assert(times.length === 2, `seed ${k}: two shackles in 20 s (${JSON.stringify(times)})`);
    assert(Math.abs(times[0].t - SHACKLE_FIRST) < 0.05 && Math.abs(times[1].t - times[0].t - 6) < 0.05, `seed ${k}: at ${times.map(x => x.t.toFixed(2))}`);
    // The nearest first: (1.2, 0.6) is nearer than (1.5, −1.4); the third body stays free.
    assert(times[0].held === others[0].id && times[1].held === others[1].id && !shackled(w, others[2]), `seed ${k}: the nearest, then the next (${times.map(x => x.held)})`);
    assert(w.tethers!.every(t => t.holder === km.id && t.kind === 'shackle'), `seed ${k}: the shackles are the keymaster's`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('targets: a plain enemy, a guard or a dog handler — never an elite, a hound, another keymaster; nothing beyond 4', () => {
  const sim = field(2, quiet({ enemySpeed: 0 })), w = sim.world;
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const km = place(sim, { x: 8, y: 6 }, 1, KEYMASTER, 1);
  place(sim, { x: 8.6, y: 6.3 }, 2, 'basic', 0, true);
  place(sim, { x: 8.7, y: 5.6 }, 0, HOUND, 1);
  place(sim, { x: 8.5, y: 6.9 }, 1, KEYMASTER, 2);
  const far = place(sim, { x: 12.7, y: 6 }, 0, 'basic', 2);
  ticks(sim, ticksOf(4));
  assert(w.tethers === undefined, `no target among the elite, the hound, the keymaster; the plain one beyond 4 of both keymasters (${JSON.stringify(w.tethers)})`);
  const handler = place(sim, { x: 10.4, y: 7.1 }, 1, HANDLER, 3);
  ticks(sim, ticksOf(1));
  assert(sim.world.tethers?.some(t => t.holder === km.id && t.held === handler.id && t.kind === 'shackle'), `the dog handler within 4 is shackled (${JSON.stringify(sim.world.tethers)})`);
  assert(!shackled(w, far), 'the far one stays free');
});

/** A keymaster with one prisoner 2.5 to its side, both standing; the hero 5 off, facing the shackle's middle. */
function prisoner(k = 1): { sim: Simulation; km: Enemy; pr: Enemy } {
  const { sim, km, others } = keeper(k, [{ x: 0, y: 2.5 }]);
  ticks(sim, ticksOf(SHACKLE_FIRST + 0.1));
  const pr = others[0];
  assert(shackled(sim.world, pr), `seed ${k}: the prisoner is shackled`);
  return { sim, km, pr };
}

check('the prisoner stands and no chain takes it: refusal «в кандалах», a real press on it takes nothing; its touch is plain', () => {
  const { sim, pr } = prisoner(1), w = sim.world;
  sim.command({ t: 'param', key: 'enemySpeed', value: 1.5 });
  const at = { x: pr.x, y: pr.y }, free = place(sim, { x: pr.x, y: pr.y + 1.5 }, 0, 'basic', 2);
  const freeAt = { x: free.x, y: free.y };
  ticks(sim, ticksOf(1));
  assert(pr.x === at.x && pr.y === at.y && dist(free, freeAt) > 0.5, `the prisoner stands (moved ${dist(pr, at).toFixed(3)}), a free one walks (${dist(free, freeAt).toFixed(2)})`);
  sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
  sim.command({ t: 'teleport', x: pr.x - 1.2, y: pr.y });
  assert(enemyRefusal(w, pr) === 'shackled', `refusal ${enemyRefusal(w, pr)}`);
  assert(!nextCandidates(w).includes(pr), 'not a candidate');
  draw(sim, [pr]);
  assert(!chainIds(w).includes(pr.id), `the press takes nothing (${chainIds(w)})`);
  sim.command({ t: 'cancel' });
});

check('a chain across the shackle: the highlight\'s cuts = the dash\'s, after its end; the prisoner is free for the NEXT chain (several seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const { sim, km, pr } = prisoner(k), w = sim.world;
    // Two plain links on both sides of the shackle's middle; the dash runs between them across it.
    const mx = (km.x + pr.x) / 2, my = (km.y + pr.y) / 2;
    const a = place(sim, { x: mx - 0.9, y: my }, 0, 'basic', 0), b = place(sim, { x: mx + 0.9, y: my }, 0, 'basic', 0);
    sim.command({ t: 'teleport', x: mx - 2.2, y: my });
    draw(sim, [a, b]);
    assert(chainIds(w).length === 2, `seed ${k}: the chain takes both links`);
    const planned = sorted(planChain(w).cuts);
    assert(JSON.stringify(planned) === JSON.stringify([pr.id]), `seed ${k}: the highlight cuts the shackle (${planned})`);
    sim.command({ t: 'release' });
    const during: boolean[] = [];
    const events = settle(sim, [], world => during.push(shackled(world, pr)));
    assert(during.length > 0 && during.every(Boolean), `seed ${k}: the shackle stands while the dash runs`);
    assert(JSON.stringify(cutsOf(events)) === JSON.stringify(planned) && tethersOf(events).some(e => e.action === 'cut' && e.kind === 'shackle'), `seed ${k}: the dash cut ${cutsOf(events)}`);
    assert(!shackled(w, pr) && w.tethers === undefined, `seed ${k}: free, no tether left`);
    // The next chain takes it.
    sim.command({ t: 'teleport', x: pr.x - 1.2, y: pr.y });
    draw(sim, [pr]);
    assert(JSON.stringify(chainIds(w)) === JSON.stringify([pr.id]), `seed ${k}: the next chain takes the freed prisoner (${chainIds(w)})`);
    sim.command({ t: 'cancel' });
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('after a cut the keymaster shackles again only shacklePeriod (6 s) later', () => {
  const { sim, km, pr } = prisoner(2), w = sim.world;
  const mx = (km.x + pr.x) / 2, my = (km.y + pr.y) / 2;
  const a = place(sim, { x: mx - 0.9, y: my }, 0, 'basic', 0), b = place(sim, { x: mx + 0.9, y: my }, 0, 'basic', 0);
  sim.command({ t: 'teleport', x: mx - 2.2, y: my });
  draw(sim, [a, b]);
  sim.command({ t: 'release' });
  settle(sim);
  const cutAt = w.time;
  let again = -1;
  for (let i = 0; i < ticksOf(8) && again < 0; i++) {
    sim.tick();
    if (tethersOf(w.events).some(e => e.action === 'shackle')) again = w.time;
    w.events.length = 0;
  }
  assert(again > 0 && again - cutAt >= 6 - 0.05 && again - cutAt < 6 + 0.1, `the next shackle ${(again - cutAt).toFixed(2)} s after the cut`);
});

check('the keymaster\'s death drops its shackles after the dash: the prisoners stand while it runs, then walk', () => {
  const { sim, km, pr } = prisoner(3), w = sim.world;
  // A chain into the keymaster from its far side, then on to two more links away from the prisoner: the dash runs on after the
  // keymaster's death (no segment crosses the shackle).
  const b = place(sim, { x: km.x - 1.4, y: km.y - 0.8 }, 0, 'basic', km.color), c = place(sim, { x: km.x - 2.8, y: km.y - 1.4 }, 0, 'basic', km.color);
  sim.command({ t: 'teleport', x: km.x + 1.2, y: km.y - 0.6 });
  draw(sim, [km, b, c]);
  assert(w.chain.length === 3, `the chain takes the keymaster and two more (${w.chain.length})`);
  assert(!(planChain(w).cuts ?? []).length && planChain(w).links[0].outcome?.killed, 'the highlight: the keymaster dies, no cut');
  sim.command({ t: 'param', key: 'enemySpeed', value: 1.5 });
  sim.command({ t: 'release' });
  const during: { held: boolean; x: number; y: number }[] = [], at = { x: pr.x, y: pr.y };
  const events = settle(sim, [], world => during.push({ held: shackled(world, pr), x: pr.x, y: pr.y }));
  assert(!w.enemies.includes(km), 'the keymaster is dead');
  const after = during.filter((_, i) => i >= during.length / 2);
  assert(after.length > 3 && after.every(d => d.held && d.x === at.x && d.y === at.y), `the prisoner stands shackled while the dash runs on past the keymaster's death (${during.map(d => d.held).join()})`);
  assert(!shackled(w, pr) && w.tethers === undefined && tethersOf(events).some(e => e.action === 'death' && e.held === pr.id && e.kind === 'shackle'), 'after the dash the shackle is gone');
  ticks(sim, ticksOf(0.5));
  assert(dist(pr, at) > 0.2, `the freed prisoner walks (${dist(pr, at).toFixed(2)})`);
  assert(replays(sim), 'replay');
});

check('a prisoner killed outside the chain (a bomb) takes its shackle along (a plain enemy has no death hook of its own)', () => {
  const { sim, pr } = prisoner(4), w = sim.world;
  sim.command({ t: 'items', kind: 'bomb', count: 1 });
  sim.command({ t: 'teleport', x: pr.x - 2, y: pr.y });
  sim.command({ t: 'item', kind: 'bomb', x: pr.x, y: pr.y });
  ticks(sim, 1);
  assert(!w.enemies.includes(pr), 'the bomb killed the prisoner');
  assert(w.tethers === undefined, `no shackle left (${JSON.stringify(w.tethers)})`);
  assert(replays(sim), 'replay');
});

/** The candidate's segment from the chain's anchor crosses a shackle now (the bot aims at the shackles, as a player would). */
function crossesShackle(w: World, e: Enemy): boolean {
  const from = chainAnchor(w);
  return (w.tethers ?? []).some(t => {
    const a = w.enemies.find(x => x.id === t.holder), b = w.enemies.find(x => x.id === t.held);
    return t.kind === 'shackle' && !!a && !!b && tetherCrossing(from, e, a, b) !== null;
  });
}

/**
 * A greedy bot on «Ров»: it spares the keymasters (their shackles stay to be cut), takes first a candidate whose segment crosses a
 * shackle, else the nearest — chains of up to 4; with no candidate it walks to the moat's edge below a keymaster. Every release
 * compares the highlight's cuts with the dash's.
 */
function moatBot(k: number, deep = false): { cuts: number; shackleCuts: number; shackles: number; chains: number; sim: Simulation; checkpoints: string[]; summary: FightSummary } {
  const p = defaultParams(); p.heroHp = 999; p.contactDamage = 0;
  const sim = new Simulation({ arena: 'g-moat', params: p, seed: seedOf(k), record: true, ...deep ? { loadout: { deep: true } } : {} }), w = sim.world, checkpoints: string[] = [];
  const observer = createFightObserver(w), all: WorldEvent[] = [];
  const command = (cmd: Command): void => { sim.command(cmd); observer.command(cmd, w); };
  const tick = (): void => { sim.tick(); observer.tick(w); all.push(...w.events); w.events.length = 0; if (w.tick % 300 === 0) checkpoints.push(sim.hash()); };
  const pick = (from: Vec): Enemy | undefined => nextCandidates(w).filter(e => e.kind !== KEYMASTER)
    .sort((a, b) => Number(crossesShackle(w, b)) - Number(crossesShackle(w, a)) || dist(a, from) - dist(b, from))[0];
  let chains = 0;
  for (let s = 0; s < 80 && w.status === 'playing'; s++) {
    for (let i = 0; i < 20 && w.status === 'playing'; i++) tick();
    if (w.move) continue;
    const first = pick(w.hero);
    if (!first) {
      const km = w.enemies.find(e => e.kind === KEYMASTER), to = { x: km?.x ?? 8, y: 6.1 }, d = dist(to, w.hero);
      command({ t: 'walk', x: d > 0.2 ? (to.x - w.hero.x) / d : 0, y: d > 0.2 ? (to.y - w.hero.y) / d : 0 });
      for (let i = 0; i < 20 && w.status === 'playing'; i++) tick();
      command({ t: 'walk', x: 0, y: 0 });
      continue;
    }
    command({ t: 'begin', x: first.x, y: first.y });
    for (let n = 1; n < 4; n++) {
      const last = w.enemies.find(e => e.id === w.chain[w.chain.length - 1]?.id);
      const next = pick(last ?? w.hero);
      if (!next) break;
      command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    }
    if (!w.chain.length) continue;
    const planned = sorted(planChain(w).cuts);
    command({ t: 'release' });
    const from = all.length;
    for (let i = 0; i < 900 && (w.move || i === 0) && w.status === 'playing'; i++) tick();
    const events = all.slice(from);
    chains++;
    assert(JSON.stringify(cutsOf(events)) === JSON.stringify(planned), `seed ${k}, chain ${chains}: the dash cut ${cutsOf(events)}, the highlight ${planned}`);
  }
  const shackleCuts = tethersOf(all).filter(e => e.action === 'cut' && e.kind === 'shackle').length;
  return { cuts: cutsOf(all).length, shackleCuts, shackles: tethersOf(all).filter(e => e.action === 'shackle').length, chains, sim, checkpoints, summary: observer.summary() };
}

check('«Ров», a real fight on 6 seeds: the keymaster shackles; every chain\'s highlighted cuts are the dash\'s; some shackles cut; replay; telemetry = replay', () => {
  let shackleCuts = 0;
  const firsts = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const run = moatBot(k);
    assert(run.sim.world.params.shackles && run.sim.world.params.tethers, 'the arena turns the shackles on');
    assert(run.chains > 10 && run.shackles > 0, `seed ${k}: chains ${run.chains}, shackles ${run.shackles}`);
    shackleCuts += run.shackleCuts;
    firsts.add(run.checkpoints[0]);
    const journal = JSON.parse(JSON.stringify(run.sim.exportJournal()!)) as Journal;
    assert(replay(journal).hash() === run.sim.hash(), `seed ${k}: replay`);
    const replayed = analyzeJournal(journal).summary;
    assert(run.summary.garrison.shackles === run.shackles && run.summary.garrison.shackleCuts === run.shackleCuts, `seed ${k}: the summary counts the shackles (${JSON.stringify(run.summary.garrison)})`);
    assert(JSON.stringify({ ...run.summary, threats: {} }) === JSON.stringify({ ...replayed, threats: {} }), `seed ${k}: the live summary is the replay's`);
  }
  assert(shackleCuts > 0, `the bot cut some shackles (${shackleCuts})`);
  assert(firsts.size > 1, 'the seeds differ');
  const old = withSummaryDefaults({ chain: { count: 3 } });
  assert(old.garrison.shackles === 0 && old.garrison.firstShackleCut === null, 'an old summary reads no shackles');
});

check('a deep «Ров» (rows 8–9): two keymasters and a dog handler with its hounds across the moat; without `deep` one keymaster', () => {
  for (const k of [1, 2]) {
    const plain = new Simulation({ arena: 'g-moat', params: defaultParams(), seed: seedOf(k), record: true });
    const deep = new Simulation({ arena: 'g-moat', params: defaultParams(), seed: seedOf(k), record: true, loadout: { deep: true } });
    plain.tick(); deep.tick();
    const count = (w: World, kind: string): number => w.enemies.filter(e => e.kind === kind).length;
    assert(count(plain.world, KEYMASTER) === 1 && count(plain.world, HANDLER) === 0, `seed ${k}: one keymaster`);
    assert(count(deep.world, KEYMASTER) === 2 && count(deep.world, HANDLER) === 1 && count(deep.world, HOUND) === 2, `seed ${k}: deep — 2 keymasters, a handler, 2 hounds`);
    assert(deep.world.kit?.deep === true && !('deep' in (plain.world.kit ?? {})), `seed ${k}: the kit says deep only when given`);
    assert(deep.world.enemies.filter(e => e.kind === KEYMASTER || e.kind === HANDLER).every(e => e.y < 4.2), `seed ${k}: across the moat`);
  }
  const run = moatBot(3, true);
  assert(run.shackles > 0 && replays(run.sim), `the deep fight shackles and replays (${run.shackles})`);
});

check('«Ров» has two walkways: plain enemies born across the moat cross it to the hero (real ticks, 4 seeds); the keymasters keep their bank, 4–5 from the standing hero', () => {
  for (const k of [1, 2, 3, 4]) {
    const p = defaultParams(); p.heroHp = 999; p.contactDamage = 0;
    const sim = new Simulation({ arena: 'g-moat', params: p, seed: seedOf(k), record: true, loadout: { deep: true } }), w = sim.world;
    const across = new Set<number>(), crossed = new Set<number>();
    let bankKept = true;
    for (let i = 0; i < ticksOf(25); i++) {
      sim.tick(); w.events.length = 0;
      for (const e of w.enemies) {
        if (e.kind === KEYMASTER) { if (e.y > 3.6 + 0.05) bankKept = false; continue; }
        if (e.y < 4.1) across.add(e.id);
        else if (e.y > 5.7 && across.has(e.id)) crossed.add(e.id);
      }
    }
    assert(crossed.size >= 3, `seed ${k}: enemies born across the moat came over (${crossed.size} of ${across.size})`);
    assert(bankKept, `seed ${k}: the keymasters stayed on their bank`);
    const kms = w.enemies.filter(e => e.kind === KEYMASTER);
    assert(kms.length === 2 && kms.every(e => dist(e, w.hero) >= 4 - 0.05 && dist(e, w.hero) <= 5 + 0.05), `seed ${k}: 4–5 from the hero (${kms.map(e => dist(e, w.hero).toFixed(2))})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a journal without the new keys plays the old world (a forest fight and a «Псарня» fight with chains: the leashes as before)', () => {
  for (const [k, arena] of [[1, 'kills'], [2, 'kills'], [1, 'g-kennel'], [2, 'g-kennel']] as const) {
    const sim = new Simulation({ arena, params: defaultParams(), seed: seedOf(k), record: true });
    for (let s = 0; s < 20; s++) {
      ticks(sim, 30);
      const c = nextCandidates(sim.world)[0];
      if (!c || sim.world.move) continue;
      draw(sim, [c]);
      sim.command({ t: 'release' });
    }
    const journal = sim.exportJournal()! as Journal;
    const without = JSON.parse(JSON.stringify(journal)) as Journal;
    for (const key of ['shackles', 'shacklePeriod', 'shackleRange', 'shackleMax'] as const) delete (without.params as Partial<Params>)[key];
    const a = replay(journal), b = replay(without);
    const strip = (x: unknown): string => { const s = x as Record<string, unknown>; const { params: _p, ...rest } = s; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(a.world)) === strip(worldState(b.world)) && a.hash() === sim.hash(), `${arena}, seed ${k}: the same world without the keys`);
    assert(hashWorld(a.world) === sim.hash(), `${arena}, seed ${k}: replay`);
  }
});

console.log(`keymaster: ${checks} checks passed`);
