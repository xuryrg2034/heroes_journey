/**
 * Task 56 «Приметы», the fight (sim/omens.ts, bag.ts `bagResetAll`; spec docs/design-notes/task-56-omens.md, section 11.1;
 * docs/realtime-slice.md, «Приметы»). Node only: `npm run test:realtime-omens`.
 *
 * Every check plays journalled commands (place, begin / drag, release, teleport, walk, clear, goals, jump, energy) and reads what the
 * player meets: the marks and strikes of «Гроза», the sleep of «Сонный час», the pools of «Половодье», the roll call of «Перекличка»,
 * the bag of «Урожай»:
 * - «Гроза»: a crowd of 3 — a mark at its densest point at the 6th second; 1.2 s later the enemies in it lose 3 (the weak die, the
 *   kills and the goal grow; an armoured elite loses a plate), the hero in it loses 2; the hero who walks out after the mark, and the
 *   hero in a dash, are spared; fewer than 3 — no mark;
 * - «Сонный час»: the enemies of the first 4 s stand and their touch does not hurt; the first dash wakes them all; without a chain
 *   the time wakes them at 4 s; the woken walk ×1.25 for 4 s; the reaper never sleeps;
 * - «Половодье»: 3 pools on every run arena, none touching the door, the start, a cliff, thorns, an obstacle, a brazier, a button
 *   or the chest; water slows; the flow field reaches the same cells; the other streams are not shifted; seeds differ;
 * - «Перекличка»: the first call at the 3rd second, of a colour on the arena (none — of the palette); a touch of that colour hurts
 *   +1; the next call (the 15th second) is another colour; the colours vary over seeds;
 * - «Урожай» (`bagResetAll`, rewards 2 / 4 / 6): a hit after two steps leaves none (`reset` with step 0), the steps fill again;
 * - the omens that are values of keys of before, with the run's values (`rtArenaParams` of a battle with the omen): «Полнолуние» — a held
 *   chain keeps the slow-down 4.5 s, the focus refills from 0 in 9 s; «Сорочье гнездо» — a chain of 6 kills drops a crystal, the colour
 *   frees on the 9th link; «Скудные краски» — newcomers of 30 s take 3 colours, a chain of 4 kills gives no shield, of 5 — gives;
 *   «Попутный ветер» — a jump at 1 energy to a point 4 away, the spin refused at 6 energy, struck at 7;
 * - the link (chain.ts, fixed when taken): «Половодье» — a tough one (2 HP) taken in a pool dies of one link, out of it survives; one that
 *   walked out of the pool while the focus ran keeps its +1; «Перекличка» — a link of the colour called gives 1 energy, another 0.5, the
 *   colour taken before the call changed still gives 1;
 * - the highlight is the dash (5+ seeds): the plan's strike of every link (its damage, killed or not) and its kills are the dash's, with
 *   «Половодье», «Перекличка», «Сорочье гнездо» (the crystal) and «Скудные краски» (the shield);
 * - every omen's fight replays to the same hash at every checkpoint; with every key off a fight is the world of before.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena, arenaTemplate } from './arenas';
import { bagProgress } from './bag';
import { worldState } from './hash';
import { areaContains, areaDistance, blockedAt, cliffAt, dist, inWater, FlowField } from './geometry';
import { defaultParams, enemyBodyRadius, PARAM_DEFS, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import { OBJECT_RADIUS, goalProgress, waterFactor, type World, type WorldEvent } from './world';
import { RUN_ARENAS } from '../run/arenaPools';
import { rtArenaParams, rtRunParams } from '../run/rtRun';
import { rtOmenColors } from '../run/omens';
import { SIM_DT } from './simulation';
import { planChain } from './chain';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'omen-field', name: 'Поле примет', summary: 'Тест примет', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 50,
});
registerArena({
  id: 'omen-bag', name: 'Поле урожая', summary: 'Тест «Урожая»', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** The keys of the omens' rules (the panel group «Приметы»). */
const OMEN_KEYS = PARAM_DEFS.filter(d => d.group === 'Приметы').map(d => d.key);

/** A quiet fight: no newcomers, nobody walks (unless `walk`), no hit-stop, no reaper, no touch damage (unless set). */
function quiet(extra: Partial<Params> = {}, walk = false): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  if (!walk) p.enemySpeed = 0;
  p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false;
  return Object.assign(p, extra);
}

const CHECKPOINT = 60;
interface Fight { sim: Simulation; hashes: Map<number, string>; events: WorldEvent[] }
function fight(params: Params, k = 1, arena = 'omen-field'): Fight {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, hashes: new Map(), events: [] };
}
function tick(f: Fight): void {
  f.sim.tick();
  f.events.push(...f.sim.world.events);
  f.sim.world.events.length = 0;
  if (f.sim.world.tick % CHECKPOINT === 0) f.hashes.set(f.sim.world.tick, f.sim.hash());
}
function ticks(f: Fight, n: number): void { for (let i = 0; i < n && f.sim.world.status === 'playing'; i++) tick(f); }
/** Ticks until the game time reaches `t` seconds. */
function until(f: Fight, t: number): void { while (f.sim.world.time < t - 1e-9 && f.sim.world.status === 'playing') tick(f); }
function settle(f: Fight): void { for (let i = 0; i < 900 && (f.sim.world.move || i === 0) && f.sim.world.status === 'playing'; i++) tick(f); }
const place = (f: Fight, x: number, y: number, color = 0, hp = 0, kind = 'basic', elite?: boolean): number =>
  f.sim.command({ t: 'place', x, y, color, hp, kind, ...elite ? { elite } : {} }) as number;

type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const omenEvents = (events: readonly WorldEvent[]) => of(events, 'omen');
const stormEvents = (events: readonly WorldEvent[], action: 'mark' | 'strike') => omenEvents(events).filter((e): e is Extract<Ev<'omen'>, { omen: 'storm' }> => e.omen === 'storm' && e.action === action);
const stormHits = (events: readonly WorldEvent[]) => of(events, 'hit').filter(e => e.source === 'storm');

/** A chain over the points (enemies already there), released and played out. */
function chainOver(f: Fight, points: readonly { x: number; y: number }[]): void {
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(f.sim.world.chain.length === points.length, `the chain took ${f.sim.world.chain.length} of ${points.length}`);
  f.sim.command({ t: 'release' });
}

const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % CHECKPOINT === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && f.hashes.size > 0 && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};
const withoutParams = (w: World): string => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };

// ---- Off: the world of before ----

check('off: with every omen key off a fight is the world of a journal without the keys (12 run arenas, newcomers on, 900 ticks)', () => {
  for (const [i, arena] of RUN_ARENAS.entries()) {
    const on = defaultParams();
    for (const key of OMEN_KEYS) assert((on as unknown as Record<string, unknown>)[key] !== true, `${key} is off by default`);
    const old = defaultParams() as unknown as Record<string, unknown>;
    for (const key of OMEN_KEYS) delete old[key];
    const a = new Simulation({ arena, params: on, seed: seedOf(i + 1) }), b = new Simulation({ arena, params: old as unknown as Params, seed: seedOf(i + 1) });
    for (let t = 0; t < 900; t++) { a.tick(); b.tick(); }
    assert(withoutParams(a.world) === withoutParams(b.world), `${arena}: the world differs`);
    assert(!a.world.storm && !a.world.drowse && !a.world.flood && !a.world.rollcall && !a.world.rng.states().some(([name]) => name === 'omen'), `${arena}: no omen field, no stream omen`);
  }
});

// ---- «Гроза» ----

/** Three points 0.7 apart (bodies do not overlap: nobody is parted; each has the three within 1.0) from (x, y). */
const TRIANGLE = (x: number, y: number): { x: number; y: number }[] => [{ x, y }, { x: x + 0.7, y }, { x: x + 0.35, y: y + 0.6 }];
/** A crowd of three at (10, 6) (the first placed has the smallest id: the tie of 3 goes to it) and a lone enemy. */
function crowd(f: Fight, color = 1): number[] {
  return [...TRIANGLE(10, 6).map(p => place(f, p.x, p.y, color)), place(f, 20, 6, color)];
}

check('«Гроза»: a crowd of 3 — a mark at its densest point at the 6th second; 1.2 s later the crowd dies (credited, the goal grows), the lone one lives', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenStorm: true }), k), w = f.sim.world;
    const [first, , , lone] = crowd(f);
    until(f, 5.9);
    assert(!stormEvents(f.events, 'mark').length, `seed ${k}: no mark before the 6th second`);
    until(f, 6);
    const marks = stormEvents(f.events, 'mark');
    assert(marks.length === 1 && marks[0].x === 10 && marks[0].y === 6 && marks[0].r === 1, `seed ${k}: one mark on the first of the crowd (the tie of 3 — the smaller id): ${JSON.stringify(marks)}`);
    assert(w.storm?.mark && Math.abs(w.storm.mark.due - 7.2) < 1e-6, `seed ${k}: the strike is due at 7.2 s (${JSON.stringify(w.storm)})`);
    const kills = w.stats.kills, goal = goalProgress(w).done;
    until(f, 7.15);
    assert(w.enemies.length === 4, `seed ${k}: nobody hurt before the strike`);
    until(f, 7.2);
    assert(stormEvents(f.events, 'strike').length === 1, `seed ${k}: one strike`);
    const alive = w.enemies.map(e => e.id);
    assert(alive.length === 1 && alive[0] === lone && !alive.includes(first), `seed ${k}: the crowd died, the lone one lives (${alive})`);
    assert(w.stats.kills === kills + 3 && goalProgress(w).done === goal + 3, `seed ${k}: 3 kills credited, the goal +3 (${w.stats.kills}, ${goalProgress(w).done})`);
    assert(of(f.events, 'kill').filter(e => e.source === 'storm' && e.credited).length === 3, `seed ${k}: three kills of the storm`);
    assert(replays(f), `seed ${k}: the fight replays to the same hash at every checkpoint`);
  }
});

check('«Гроза»: tough ones (2 HP) die of the 3; an armoured elite loses one plate; the next mark comes 7 s after the first', () => {
  const f = fight(quiet({ omenStorm: true, eliteArmor: true }), 4), w = f.sim.world;
  const [pa, pb, pc] = TRIANGLE(10, 6);
  const a = place(f, pa.x, pa.y, 1, 2), b = place(f, pb.x, pb.y, 1, 2), elite = place(f, pc.x, pc.y, 1, 0, 'basic', true);
  const plates = w.enemies.find(e => e.id === elite)!.armor!.plates;
  assert(plates >= 1, 'the elite has plates');
  until(f, 7.2);
  assert(!w.enemies.some(e => e.id === a || e.id === b), 'both tough ones died');
  const e = w.enemies.find(x => x.id === elite);
  assert(e && e.armor!.plates === plates - 1, `the elite lost one plate (${e?.armor?.plates} of ${plates})`);
  const strip = of(f.events, 'elitePlates').filter(x => x.action === 'strip' && x.source === 'storm');
  assert(strip.length === 1 && strip[0].removed === 1, `one strip of the storm: ${JSON.stringify(strip)}`);
  for (const q of TRIANGLE(15, 6)) place(f, q.x, q.y, 2);
  until(f, 12.95);
  assert(stormEvents(f.events, 'mark').length === 1, 'no second mark before 13 s');
  until(f, 13);
  assert(stormEvents(f.events, 'mark').length === 2, 'the second mark at 13 s (6 + 7)');
});

check('«Гроза»: fewer than 3 enemies — no mark; the count waits and marks in the tick a third comes', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenStorm: true }), k);
    const [q1, q2, q3] = TRIANGLE(10, 6);
    place(f, q1.x, q1.y); place(f, q2.x, q2.y); place(f, 20, 6);
    until(f, 10);
    assert(!stormEvents(f.events, 'mark').length && !stormEvents(f.events, 'strike').length, `seed ${k}: no mark with 2 in the best circle`);
    place(f, q3.x, q3.y);
    tick(f);
    const marks = stormEvents(f.events, 'mark');
    assert(marks.length === 1 && dist(marks[0], { x: 10, y: 6 }) < 1e-9, `seed ${k}: the mark comes in the tick the third came: ${JSON.stringify(marks)}`);
  }
});

check('«Гроза»: the hero in the mark loses 2 when it strikes; walking out 0.6 s after the mark spares him', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenStorm: true }), k), w = f.sim.world;
    crowd(f);
    until(f, 6);
    f.sim.command({ t: 'teleport', x: 10.2, y: 6.2 });
    const hp = w.hero.hp;
    until(f, 7.2);
    const hits = stormHits(f.events);
    assert(hits.length === 1 && hits[0].damage === 2 && w.hero.hp === hp - 2, `seed ${k}: the hero in the mark lost 2 (${JSON.stringify(hits)}, HP ${w.hero.hp})`);

    const g = fight(quiet({ omenStorm: true }), k), v = g.sim.world;
    crowd(g);
    until(g, 6);
    g.sim.command({ t: 'teleport', x: 10, y: 6 });
    until(g, 6.6);
    g.sim.command({ t: 'walk', x: 0, y: -1 });
    until(g, 7.2);
    assert(!stormHits(g.events).length && v.hero.hp === 40 && dist(v.hero, { x: 10, y: 6 }) > 1, `seed ${k}: walking out after 0.6 s spares him (HP ${v.hero.hp}, at ${dist(v.hero, { x: 10, y: 6 }).toFixed(2)})`);
  }
});

check('«Гроза»: the hero dashing over the mark when it strikes, or in a jump, is spared', () => {
  // The dash: from (9.3, 5.6) in the mark to the links at (11, 4.9), (12.6, 4.4) (placed after the mark stood); the release tick is
  // found so that the hero is in the dash and inside the circle in the strike's tick.
  let found = 0;
  for (let back = 1; back <= 20 && !found; back++) {
    const f = fight(quiet({ omenStorm: true }), 1), w = f.sim.world;
    crowd(f);
    until(f, 7.2 - back / 60);
    place(f, 11, 4.9, 0); place(f, 12.6, 4.4, 0);
    f.sim.command({ t: 'teleport', x: 9.3, y: 5.6 });
    chainOver(f, [{ x: 11, y: 4.9 }, { x: 12.6, y: 4.4 }]);
    let inside = false;
    while (w.time < 7.2 - 1e-9 && w.status === 'playing') {
      tick(f);
      if (stormEvents(f.events, 'strike').length) { inside = !!w.move && dist(w.hero, { x: 10, y: 6 }) <= 1; break; }
    }
    if (!inside) continue;
    found = back;
    assert(!stormHits(f.events).length && w.hero.hp === 40, `the dashing hero is spared (release ${back} ticks before)`);
  }
  assert(found > 0, 'some release puts the dashing hero in the circle at the strike');

  const g = fight(quiet({ omenStorm: true }), 2), v = g.sim.world;
  crowd(g);
  until(g, 7.2 - 2 / 60);
  g.sim.command({ t: 'teleport', x: 9.4, y: 5.4 });
  g.sim.command({ t: 'energy', value: 7 });
  assert(g.sim.command({ t: 'jump', x: 10.4, y: 5.6 }) === true, 'the jump starts');
  until(g, 7.2);
  assert(stormEvents(g.events, 'strike').length === 1 && v.move?.kind === 'jump', 'the jump is on at the strike');
  assert(!stormHits(g.events).length && v.hero.hp === 40, 'the jumping hero is spared');
});

check('«Гроза»: the reaper is not the target — four reapers close together lose the mark to a crowd of three', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenStorm: true }), k);
    until(f, 5.95);
    for (const q of [...TRIANGLE(20, 3), { x: 20.35, y: 2.4 }]) place(f, q.x, q.y, -1, 0, 'reaper');
    crowd(f);
    until(f, 6);
    const marks = stormEvents(f.events, 'mark');
    assert(marks.length === 1 && marks[0].x === 10 && marks[0].y === 6, `seed ${k}: the mark on the crowd, not the reapers (${JSON.stringify(marks)})`);
  }
});

// ---- «Сонный час» ----

check('«Сонный час»: the enemies of the first 4 s stand and do not hurt; the time wakes them at 4 s; a newcomer after it is awake', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenDrowse: true, contactDamage: 1 }, true), k), w = f.sim.world;
    const near = place(f, 3.4, 6), far = place(f, 20, 6), reaper = place(f, 25, 10, -1, 0, 'reaper');
    tick(f);
    assert(w.enemies.find(e => e.id === near)!.sleep && w.enemies.find(e => e.id === far)!.sleep, `seed ${k}: both sleep`);
    assert(!w.enemies.find(e => e.id === reaper)!.sleep, `seed ${k}: the reaper never sleeps`);
    f.sim.command({ t: 'clear', keepMarked: false });
    const a = place(f, 3.4, 6), b = place(f, 20, 6);
    until(f, 2);
    const late = place(f, 20, 9);
    until(f, 3.95);
    const ea = w.enemies.find(e => e.id === a)!, eb = w.enemies.find(e => e.id === b)!, el = w.enemies.find(e => e.id === late)!;
    assert(ea.sleep && eb.sleep && el.sleep, `seed ${k}: the start ones and the newcomer of the 2nd second sleep`);
    assert(eb.x === 20 && eb.y === 6 && el.x === 20 && el.y === 9, `seed ${k}: the sleepers stand`);
    assert(!of(f.events, 'hit').length && w.hero.hp === 40, `seed ${k}: a sleeper on the hero does not hurt`);
    until(f, 4);
    const wake = omenEvents(f.events).filter(e => e.omen === 'drowse');
    assert(wake.length === 1 && wake[0].omen === 'drowse' && wake[0].cause === 'time' && wake[0].count === 3, `seed ${k}: the time woke the three at 4 s (${JSON.stringify(wake)})`);
    assert(!w.enemies.some(e => e.sleep) && w.enemies.every(e => e.rage !== undefined), `seed ${k}: nobody sleeps, the woken rage`);
    const after = place(f, 25, 3);
    until(f, 6);
    assert(of(f.events, 'hit').length > 0, `seed ${k}: the woken touch hurts`);
    const ea2 = w.enemies.find(e => e.id === after);
    assert(ea2 && !ea2.sleep && ea2.rage === undefined && ea2.x < 25, `seed ${k}: a newcomer after the wake walks, no rage`);
    assert(replays(f), `seed ${k}: the fight replays`);
  }
});

check('«Сонный час»: the first dash wakes every sleeper in the release\'s tick', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenDrowse: true }, true), k), w = f.sim.world;
    place(f, 5, 6); place(f, 6.2, 6);
    const far = place(f, 20, 6);
    until(f, 1);
    assert(w.enemies.every(e => e.sleep), `seed ${k}: they sleep`);
    chainOver(f, [{ x: 5, y: 6 }, { x: 6.2, y: 6 }]);
    const wake = omenEvents(f.events.concat(w.events)).filter(e => e.omen === 'drowse');
    assert(wake.length === 1 && wake[0].omen === 'drowse' && wake[0].cause === 'pass' && wake[0].count === 3, `seed ${k}: the release woke the three (${JSON.stringify(wake)})`);
    settle(f);
    until(f, 2);
    const e = w.enemies.find(x => x.id === far)!;
    assert(!e.sleep && e.x < 20, `seed ${k}: the far one walks after the dash (${e.x})`);
  }
});

check('«Сонный час»: a woken enemy walks ×1.25 for 4 s (against the same walk without the omen)', () => {
  for (let k = 1; k <= 3; k++) {
    const walkFrom = (drowse: boolean): { rage: number; after: number } => {
      const f = fight(quiet({ omenDrowse: drowse }, true), k), w = f.sim.world;
      const id = place(f, 28, 6);
      const x = (): number => w.enemies.find(e => e.id === id)!.x;
      until(f, 4); const x0 = x();
      until(f, 5); const x1 = x();
      until(f, 9); const x2 = x();
      until(f, 10); const x3 = x();
      return { rage: x0 - x1, after: x2 - x3 };
    };
    const slept = walkFrom(true), plain = walkFrom(false);
    assert(Math.abs(slept.rage / plain.rage - 1.25) < 1e-6, `seed ${k}: ×1.25 in the rage (${slept.rage} vs ${plain.rage})`);
    assert(Math.abs(slept.after / plain.after - 1) < 1e-6, `seed ${k}: ×1 after it (${slept.after} vs ${plain.after})`);
  }
});

// ---- «Половодье» ----

check('«Половодье»: 3 pools on every run arena (3 seeds) — none touching the door, the start, a cliff, thorns, an obstacle, a brazier, a button, the chest; inside the arena', () => {
  for (const id of RUN_ARENAS) for (let k = 1; k <= 3; k++) {
    const sim = new Simulation({ arena: id, params: Object.assign(defaultParams(), { omenFlood: true }), seed: seedOf(k) }), w = sim.world, a = w.arena;
    const base = arenaTemplate(id), pools = w.flood?.pools ?? [];
    assert(pools.length === 3, `${id} seed ${k}: ${pools.length} pools`);
    assert(a.obstacles.length === base.obstacles.length + 3 && a.obstacles.slice(-3).every((o, i) => o.kind === 'pond' && o.shape === 'circle' && o.x === pools[i].x && o.y === pools[i].y && o.r === 1), `${id}: the pools are ponds of the arena`);
    const plain = { ...a, obstacles: base.obstacles };
    for (const p of pools) {
      assert(p.r === 1 && !blockedAt(p, p.r, plain) && !cliffAt(p, p.r, plain), `${id}: a pool in an obstacle or a cliff or out (${JSON.stringify(p)})`);
      assert(!(a.terrain ?? []).some(z => z.kind === 'thorns' && (areaContains(z, p) || areaDistance(z, p).d < p.r)), `${id}: a pool on thorns`);
      assert(dist(p, a.door) >= p.r + 2 && dist(p, a.heroStart) >= p.r + 2.5, `${id}: a pool at the door or the start (${JSON.stringify(p)})`);
      const things = [...a.buttons, ...a.braziers ?? [], ...a.gateLevers ?? [], ...a.chest ? [a.chest] : []];
      assert(things.every(t => dist(p, t) >= p.r + OBJECT_RADIUS), `${id}: a pool on a button, a brazier, a lever or the chest`);
      assert(pools.every(q => q === p || dist(p, q) >= 2 * p.r), `${id}: two pools touch`);
      assert(inWater(p, a) && waterFactor(w, p) === w.params.waterSlow, `${id}: a pool is water`);
    }
  }
});

check('«Половодье»: the flow field reaches the cells it reached before; the other streams are not shifted; seeds differ, a seed repeats', () => {
  const sets = new Set<string>();
  for (const [i, id] of RUN_ARENAS.entries()) {
    const k = i + 1, params = Object.assign(defaultParams(), { omenFlood: true });
    const on = new Simulation({ arena: id, params, seed: seedOf(k) }).world, off = new Simulation({ arena: id, params: defaultParams(), seed: seedOf(k) }).world;
    const reach = (w: World): number => { const f = new FlowField(w.arena, enemyBodyRadius(w.params), { waterCost: 2 }); f.setTarget(w.arena.heroStart, true); return f.distance.filter(d => Number.isFinite(d)).length; };
    assert(reach(on) === reach(off), `${id}: the flow field reaches ${reach(on)} cells, before ${reach(off)}`);
    const others = (w: World): string => JSON.stringify(w.rng.states().filter(([name]) => name !== 'omen'));
    assert(others(on) === others(off), `${id}: the other streams are as before`);
    const again = new Simulation({ arena: id, params, seed: seedOf(k) }).world;
    assert(JSON.stringify(again.flood) === JSON.stringify(on.flood), `${id}: the same seed — the same pools`);
    const other = new Simulation({ arena: id, params, seed: seedOf(k + 100) }).world;
    sets.add(JSON.stringify(on.flood)); sets.add(JSON.stringify(other.flood));
  }
  assert(sets.size >= RUN_ARENAS.length * 2 - 2, `the pools vary over seeds and arenas (${sets.size} sets)`);
});

check('«Половодье»: water slows the hero ×0.5 in a pool; the fight replays', () => {
  const params = Object.assign(quiet({ omenFlood: true }), {});
  const f = fight(params, 3, RUN_ARENAS[0]), w = f.sim.world, pool = w.flood!.pools[0];
  f.sim.command({ t: 'teleport', x: pool.x, y: pool.y });
  f.sim.command({ t: 'walk', x: 1, y: 0 });
  const x0 = w.hero.x;
  ticks(f, 6);
  const step = (w.hero.x - x0) / 6;
  assert(Math.abs(step - w.params.heroSpeed * w.params.waterSlow / 60) < 1e-6, `the hero wades at ×${w.params.waterSlow} (${step * 60} u/s)`);
  ticks(f, 120);
  assert(replays(f), 'the fight replays');
});

// ---- «Перекличка» ----

check('«Перекличка»: the first call at the 3rd second of a colour on the arena; its touch +1; the next call at 15 s is another colour', () => {
  const firsts: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const f = fight(quiet({ omenRollcall: true, contactDamage: 1 }), k), w = f.sim.world;
    place(f, 20, 2, 1); place(f, 20, 4, 2); place(f, 20, 8, 3);
    until(f, 2.95);
    assert(w.rollcall?.color === undefined, `seed ${k}: no call before 3 s`);
    until(f, 3);
    const call = w.rollcall?.color;
    assert(call === 1 || call === 2 || call === 3, `seed ${k}: the call is a colour on the arena (${call})`);
    firsts.push(call);
    const hit = (color: number): number => {
      const before = f.events.length;
      const id = place(f, w.hero.x, w.hero.y, color);
      for (let i = 0; i < 600 && !of(f.events.slice(before), 'hit').length; i++) tick(f);
      f.sim.command({ t: 'clear', keepMarked: false });
      place(f, 20, 2, 1); place(f, 20, 4, 2); place(f, 20, 8, 3);
      void id;
      return of(f.events.slice(before), 'hit')[0]?.damage ?? 0;
    };
    const other = [1, 2, 3].find(c => c !== call)!;
    assert(hit(call) === 2, `seed ${k}: the touch of the called colour hurts 2`);
    until(f, w.time + 1);
    assert(hit(other) === 1, `seed ${k}: the touch of another colour hurts 1`);
    until(f, 14.95);
    assert(w.rollcall!.color === call, `seed ${k}: the call holds until 15 s`);
    until(f, 15);
    assert(w.rollcall!.color !== call && [1, 2, 3].includes(w.rollcall!.color!), `seed ${k}: the second call is another colour on the arena (${call} → ${w.rollcall!.color})`);
    assert(omenEvents(f.events).filter(e => e.omen === 'rollcall').length === 2, `seed ${k}: two calls`);
    if (k <= 3) assert(replays(f), `seed ${k}: the fight replays`);
  }
  assert(new Set(firsts).size >= 2, `the first call varies over seeds (${firsts})`);
});

check('«Перекличка»: no enemy on the arena — the call is a colour of the palette; one colour only — it is called again', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ omenRollcall: true }), k), w = f.sim.world;
    until(f, 3);
    assert(w.rollcall?.color !== undefined && w.rollcall.color >= 0 && w.rollcall.color < 4, `seed ${k}: a palette colour (${w.rollcall?.color})`);
    place(f, 20, 2, 2);
    until(f, 15);
    assert(w.rollcall!.color === 2, `seed ${k}: the only colour on the arena is called (${w.rollcall!.color})`);
  }
});

// ---- «Урожай» ----

check('«Урожай» (`bagResetAll`, 2 / 4 / 6): 10 / 20 / 35 kills — 2 / 6 / 12; a hit after two steps leaves none (`reset`, step 0); the steps fill again', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet({ doorBag: true, bagResetAll: true, bagReward1: 2, bagReward2: 4, bagReward3: 6, contactDamage: 1 }), k, 'omen-bag'), w = f.sim.world;
    const row = (n: number): void => {
      f.sim.command({ t: 'teleport', x: 3, y: 6 });
      const points = Array.from({ length: n }, (_, i) => ({ x: 3 + 1.4 * (i + 1), y: 6 }));
      for (const p of points) place(f, p.x, p.y, 0);
      chainOver(f, points);
      settle(f);
    };
    row(3);
    assert(w.bag && w.bag.step === 0, `seed ${k}: the bag at the goals`);
    row(10);
    assert(bagProgress(w)!.step === 1 && bagProgress(w)!.total === 2, `seed ${k}: 10 kills — 2 (${JSON.stringify(bagProgress(w))})`);
    row(10);
    assert(bagProgress(w)!.step === 2 && bagProgress(w)!.total === 6, `seed ${k}: 20 kills — 6`);
    row(3);
    const before = f.events.length;
    place(f, w.hero.x, w.hero.y, 1);
    for (let i = 0; i < 600 && !of(f.events.slice(before), 'hit').length; i++) tick(f);
    f.sim.command({ t: 'clear', keepMarked: false });
    const resets = of(f.events.slice(before), 'bag').filter(e => e.action === 'reset');
    assert(resets.length === 1 && resets[0].step === 0, `seed ${k}: one reset with step 0 (${JSON.stringify(resets)})`);
    assert(w.bag!.step === 0 && w.bag!.kills === 0 && bagProgress(w)!.total === 0, `seed ${k}: no step left (${JSON.stringify(w.bag)})`);
    row(10); row(10); row(10); row(5);
    assert(bagProgress(w)!.step === 3 && bagProgress(w)!.total === 12, `seed ${k}: 35 kills again — 12 (${JSON.stringify(bagProgress(w))})`);
    assert(replays(f), `seed ${k}: the fight replays`);
  }
});

check('«Урожай»: without `bagResetAll` the hit after two steps keeps them (the old rule, the same fight)', () => {
  const f = fight(quiet({ doorBag: true, bagReward1: 2, bagReward2: 4, bagReward3: 6, contactDamage: 1 }), 1, 'omen-bag'), w = f.sim.world;
  const row = (n: number): void => {
    f.sim.command({ t: 'teleport', x: 3, y: 6 });
    const points = Array.from({ length: n }, (_, i) => ({ x: 3 + 1.4 * (i + 1), y: 6 }));
    for (const p of points) place(f, p.x, p.y, 0);
    chainOver(f, points);
    settle(f);
  };
  row(3); row(10); row(10); row(3);
  const before = f.events.length;
  place(f, w.hero.x, w.hero.y, 1);
  for (let i = 0; i < 600 && !of(f.events.slice(before), 'hit').length; i++) tick(f);
  assert(w.bag!.step === 2 && w.bag!.kills === 20 && bagProgress(w)!.total === 6, `the filled steps stay (${JSON.stringify(w.bag)})`);
});

// ---- The omens that are values of keys of before (the run's values of a battle with the omen) ----

/** The values of a run's battle with `omen` (`rtArenaParams`), quieted: no newcomers, nobody walks, no hit-stop. */
function omenRun(omen: string, extra: Partial<Params> = {}): Params {
  const p = rtArenaParams({ omens: [omen as never] }, rtRunParams(defaultParams()));
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false;
  return Object.assign(p, extra);
}

check('«Полнолуние»: a held chain keeps the slow-down 4.5 real s (3 without the omen); the focus refills from 0 in 9 s (3 without)', () => {
  for (const [omen, hold, refill] of [['moon', 4.5, 9], ['none', 3, 3]] as const) {
    const f = fight(omenRun(omen), 1), w = f.sim.world;
    place(f, 4.2, 6);
    f.sim.command({ t: 'begin', x: 4.2, y: 6 });
    let real = 0;
    do { tick(f); if (w.focusing) real += SIM_DT / w.timeScale; } while (w.focusing && w.chain.length);
    assert(Math.abs(real - hold) < 0.1, `${omen}: the slow-down held ${real.toFixed(2)} s`);
    f.sim.command({ t: 'cancel' });
    const start = w.time;
    while (w.focus < w.params.focusMax - 1e-9) tick(f);
    assert(Math.abs(w.time - start - refill) < 0.1, `${omen}: the focus refilled in ${(w.time - start).toFixed(2)} s`);
  }
});

check('«Сорочье гнездо»: a chain of 6 kills drops a crystal; the colour frees on the 9th link (after 8 of one colour), not on the 8th', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(omenRun('magpie'), k), w = f.sim.world;
    const row = (n: number, color = 0) => Array.from({ length: n }, (_, i) => ({ x: 4.4 + 1.4 * i, y: 6, color }));
    const draw = (points: { x: number; y: number }[]): number => {
      f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
      for (const q of points.slice(1)) f.sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
      return w.chain.length;
    };
    const six = row(6);
    for (const q of six) place(f, q.x, q.y, 0);
    assert(draw(six) === 6, `seed ${k}: six links`);
    f.sim.command({ t: 'release' }); settle(f);
    assert(w.objects.some(o => o.kind === 'crystal'), `seed ${k}: a crystal fell after 6 kills`);
    f.sim.command({ t: 'clear', keepMarked: false });
    w.objects = w.objects.filter(o => o.kind !== 'crystal');
    f.sim.command({ t: 'teleport', x: 3, y: 6 });
    const seven = row(7), eight = row(8), other = (n: number) => ({ x: 4.4 + 1.4 * n, y: 6 });
    for (const q of seven) place(f, q.x, q.y, 0);
    place(f, other(7).x, other(7).y, 1);
    assert(draw([...seven, other(7)]) === 7, `seed ${k}: after 7 of one colour another one is not taken`);
    f.sim.command({ t: 'cancel' }); f.sim.command({ t: 'clear', keepMarked: false });
    for (const q of eight) place(f, q.x, q.y, 0);
    place(f, other(8).x, other(8).y, 1);
    assert(draw([...eight, other(8)]) === 9, `seed ${k}: after 8 of one colour the 9th of another is taken`);
    f.sim.command({ t: 'cancel' });
  }
});

check('«Скудные краски»: newcomers of 30 s take 3 colours (4 without); a chain of 4 kills gives no shield, of 5 — gives (3 without the omen)', () => {
  for (let k = 1; k <= 3; k++) {
    const colorsOf = (omens: string[]): Set<number> => {
      const p = rtArenaParams({ omens: omens as never }, rtRunParams(defaultParams()));
      const sim = new Simulation({ arena: RUN_ARENAS[0], params: p, seed: seedOf(k), loadout: { colors: rtOmenColors(omens, undefined) } });
      const start = new Set(sim.world.enemies.map(e => e.id)), out = new Set<number>();
      for (let t = 0; t < 30 * 60 && sim.world.status === 'playing'; t++) { sim.tick(); for (const e of sim.world.enemies) if (!start.has(e.id) && e.color >= 0) out.add(e.color); }
      return out;
    };
    const pale = colorsOf(['pale']), plain = colorsOf([]);
    assert(pale.size === 3 && plain.size === 4, `seed ${k}: newcomers' colours ${[...pale]} / ${[...plain]}`);
    for (const [omen, kills, shield] of [['pale', 4, false], ['pale', 5, true], ['none', 3, true]] as const) {
      const f = fight(omenRun(omen), k), w = f.sim.world;
      const points = Array.from({ length: kills }, (_, i) => ({ x: 4.4 + 1.4 * i, y: 6 }));
      for (const q of points) place(f, q.x, q.y, 0);
      chainOver(f, points);
      settle(f);
      assert((w.hero.chainShield > 0) === shield, `seed ${k} ${omen}: a chain of ${kills} kills — shield ${w.hero.chainShield}`);
    }
  }
});

check('«Попутный ветер»: a jump at 1 energy to a point 4 away; the spin refused at 6 energy, struck at 7 (the run\'s jump costs 2, reaches 3)', () => {
  const f = fight(omenRun('tailwind'), 1), w = f.sim.world;
  f.sim.command({ t: 'teleport', x: 5, y: 6 });
  f.sim.command({ t: 'energy', value: 1 });
  assert(f.sim.command({ t: 'jump', x: 9, y: 6 }) === true, 'the jump at 1 energy starts');
  settle(f);
  assert(Math.abs(w.hero.x - 9) < 0.05 && w.energy === 0, `landed 4 away (${w.hero.x.toFixed(2)}), energy ${w.energy}`);
  f.sim.command({ t: 'energy', value: 6 });
  assert(f.sim.command({ t: 'spin' }) === false && Number(w.energy) === 6, 'the spin at 6 refused');
  f.sim.command({ t: 'energy', value: 7 });
  assert(f.sim.command({ t: 'spin' }) === true && Number(w.energy) === 0, 'the spin at 7 struck');
  const g = fight(omenRun('none'), 1);
  g.sim.command({ t: 'teleport', x: 5, y: 6 });
  g.sim.command({ t: 'energy', value: 1 });
  assert(g.sim.command({ t: 'jump', x: 8, y: 6 }) === false, 'without the omen a jump at 1 energy is refused');
});

// ---- The link: «Половодье» and «Перекличка» (fixed when taken) ----

/** A chain over the points, its plan when drawn, released and played out: the plan and the dash's hits. */
function planned(f: Fight, points: readonly { x: number; y: number }[]): { plan: ReturnType<typeof planChain>; hits: Ev<'chainHit'>[] } {
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) f.sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
  assert(f.sim.world.chain.length === points.length, `the chain took ${f.sim.world.chain.length} of ${points.length}`);
  const before = f.sim.hash(), plan = planChain(f.sim.world);
  assert(f.sim.hash() === before, 'the highlight leaves the world as it was');
  const from = f.events.length;
  f.sim.command({ t: 'release' });
  settle(f);
  return { plan, hits: of(f.events.slice(from), 'chainHit') };
}
/** The plan's strikes and kills are the dash's: per link — the damage and whether it died. */
function sameAsPlan(what: string, plan: ReturnType<typeof planChain>, hits: readonly Ev<'chainHit'>[]): void {
  const planned = plan.links.flatMap(l => (l.outcome && l.link.kind === 'enemy' ? [`${l.link.id}:${l.outcome.damage}:${l.outcome.killed}`] : []));
  const struck = hits.map(h => `${h.enemyId}:${h.damage}:${h.killed}`);
  assert(JSON.stringify(planned.slice(0, struck.length)) === JSON.stringify(struck) && plan.kills === hits.filter(h => h.killed).length, `${what}: the plan ${planned} vs the dash ${struck} (kills ${plan.kills})`);
}

check('«Половодье»: a tough one (2 HP) taken in a pool dies of one link, out of it survives; the highlight says so first', () => {
  for (let k = 1; k <= 5; k++) {
    for (const wet of [true, false]) {
      const f = fight(omenRun('flood'), k), w = f.sim.world, pool = w.flood!.pools[0];
      const at = wet ? { x: pool.x, y: pool.y } : { x: pool.x + 2.4 < 29 ? pool.x + 2.4 : pool.x - 2.4, y: pool.y };
      f.sim.command({ t: 'teleport', x: at.x + (at.x > 15 ? -1.2 : 1.2), y: at.y });
      const id = place(f, at.x, at.y, 0, 2);
      const { plan, hits } = planned(f, [at]);
      assert(w.chain.length === 0, 'released');
      const killed = !w.enemies.some(e => e.id === id);
      assert(killed === wet, `seed ${k}: ${wet ? 'in' : 'out of'} the pool — killed ${killed}`);
      sameAsPlan(`seed ${k} ${wet ? 'wet' : 'dry'}`, plan, hits);
    }
  }
});

check('«Половодье»: an enemy that walked out of the pool while the focus ran keeps its +1 (the mark of the link taken)', () => {
  let tried = 0;
  for (let k = 1; k <= 12 && tried < 3; k++) {
    const f = fight(omenRun('flood', { enemySpeed: 1.2 }), k, RUN_ARENAS[0]), w = f.sim.world, pool = w.flood!.pools[0];
    // The hero 2.6 from the pool's centre, the enemy at its rim on his side: it walks out towards him.
    const dir = pool.x > w.arena.width / 2 ? -1 : 1, hero = { x: pool.x + dir * 2.6, y: pool.y }, at = { x: pool.x + dir * 0.85, y: pool.y };
    if (inWater(hero, w.arena) || !inWater(at, w.arena)) continue;
    f.sim.command({ t: 'clear', keepMarked: false });
    f.sim.command({ t: 'teleport', x: hero.x, y: hero.y });
    const id = place(f, at.x, at.y, 0, 2);
    f.sim.command({ t: 'begin', x: at.x, y: at.y });
    if (w.chain.length !== 1) continue;
    assert(w.chain[0].wet === true, `seed ${k}: the link is marked wet`);
    for (let i = 0; i < 40; i++) tick(f);
    const e = w.enemies.find(x => x.id === id)!;
    if (inWater(e, w.arena)) continue;
    tried++;
    const plan = planChain(w);
    assert(plan.links[0].outcome?.killed === true, `seed ${k}: the highlight still kills it out of the water`);
    f.sim.command({ t: 'release' }); settle(f);
    assert(!w.enemies.some(x => x.id === id), `seed ${k}: the dash kills it out of the water`);
  }
  assert(tried >= 1, 'some enemy walked out of the pool during the focus');
});

check('«Перекличка»: a link of the colour called gives 1 energy, another 0.5; the colour taken before the call changed still gives 1', () => {
  for (let k = 1; k <= 5; k++) {
    const f = fight(omenRun('rollcall'), k), w = f.sim.world;
    place(f, 20, 2, 0); place(f, 20, 4, 1); place(f, 20, 8, 2); place(f, 20, 10, 3);
    until(f, 3);
    const call = w.rollcall!.color!, other = (call + 1) % 4;
    const energyOf = (color: number): number => {
      f.sim.command({ t: 'teleport', x: 3, y: 6 }); f.sim.command({ t: 'energy', value: 0 });
      const points = [{ x: 4.4, y: 6 }, { x: 5.8, y: 6 }];
      for (const q of points) place(f, q.x, q.y, color);
      const { plan, hits } = planned(f, points);
      sameAsPlan(`seed ${k}`, plan, hits);
      return w.energy;
    };
    assert(energyOf(call) === 2 && energyOf(other) === 1, `seed ${k}: energy of the called colour 2, of another 1`);
    until(f, 14.95);
    f.sim.command({ t: 'teleport', x: 3, y: 6 }); f.sim.command({ t: 'energy', value: 0 });
    const color = w.rollcall!.color!;
    place(f, 4.4, 6, color);
    f.sim.command({ t: 'begin', x: 4.4, y: 6 });
    while (w.rollcall!.color === color) tick(f);
    f.sim.command({ t: 'release' }); settle(f);
    assert(w.energy === 1, `seed ${k}: the link taken before the call changed gives 1 (${w.energy})`);
  }
});

check('the highlight is the dash (6 seeds): mixed chains with «Половодье», «Перекличка», «Сорочье гнездо», «Скудные краски» together', () => {
  for (let k = 1; k <= 6; k++) {
    const p = rtArenaParams({ omens: ['flood', 'magpie'] as never }, rtRunParams(defaultParams()));
    Object.assign(p, rtArenaParams({ omens: ['rollcall', 'pale'] as never }, rtRunParams(defaultParams())), { omenFlood: true, crystals: true, crystalEvery: 6, colorShiftLinks: 8 });
    p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false; p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false; p.finisher = false;
    const f = fight(p, k), w = f.sim.world, pool = w.flood!.pools[0];
    until(f, 3);
    // A row through the first pool (its third link at the centre: a tough one), colour 0; the last one a tough survivor on some seeds.
    const dir = pool.x > 15 ? -1 : 1, points = Array.from({ length: 7 }, (_, i) => ({ x: pool.x + dir * (1.3 * i - 2.6), y: pool.y }));
    const hps = [k % 2, (k + 1) % 2, 2, k % 2, (k + 1) % 2, 1, k % 3 === 0 ? 4 : 0];
    f.sim.command({ t: 'teleport', x: points[0].x - dir * 1.2, y: points[0].y });
    for (const [i, q] of points.entries()) place(f, q.x, q.y, 0, hps[i]);
    const { plan, hits } = planned(f, points);
    sameAsPlan(`seed ${k}`, plan, hits);
    assert(plan.links.some(l => l.link.wet), `seed ${k}: some link wet`);
    assert((w.hero.chainShield > 0) === (plan.kills >= 5), `seed ${k}: the shield of ${plan.kills} kills`);
    assert(w.objects.some(o => o.kind === 'crystal') === (plan.kills >= 6), `seed ${k}: the crystal of ${plan.kills} kills`);
  }
});

// ---- Repeat ----

check('repeat: every omen at once replays to the same hash at every checkpoint on 3 run arenas; two seeds — different fights', () => {
  for (const id of RUN_ARENAS.slice(0, 3)) {
    const params = Object.assign(defaultParams(), { omenStorm: true, omenDrowse: true, omenFlood: true, omenRollcall: true });
    const hashes: string[] = [];
    for (let k = 1; k <= 2; k++) {
      const f: Fight = { sim: new Simulation({ arena: id, params, seed: seedOf(k), record: true }), hashes: new Map(), events: [] };
      ticks(f, 1200);
      assert(replays(f), `${id} seed ${k}: replays`);
      hashes.push(f.sim.hash());
    }
    assert(hashes[0] !== hashes[1], `${id}: two seeds give different fights`);
  }
});

console.log(`omens: ${checks} checks passed`);
