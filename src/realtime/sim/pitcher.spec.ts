/**
 * Task 59а «Гарнизон, шаг 3», А — «Смолокур» and the law of pitch (enemies/pitcher.ts, pitch.ts; docs/realtime-elite-behaviors.md,
 * «Гарнизон, шаг 3»). Node only: `npm run test:realtime-pitcher`.
 *
 * Every check plays journalled commands (clear, place, teleport, walk, begin / drag / release, items / item, chill, param) and looks at
 * what the player meets:
 * - the cycle: the windup, the throw at the hero's centre at the throw (not at the windup's start), the landing 1.8 s after (the
 *   fight's first) and 1.2 s after; the hero in the circle −1, the hero who walked off — nothing; the reload;
 * - the pool: the hero walks ×0.6 in it, an enemy ×0.4 (by the step of a tick); it dries after 4 s; the fifth dries the oldest; none in water;
 * - the pitchers' common clock (a second waits 2.5 s after the first's throw, one pot in the air), a crossbow's aim holds the windup,
 *   a frozen pitcher waits, its death in the windup drops the throw, a pot in the air lands after its thrower's death;
 * - the fire: a chain of 3 with «Огненный проход» across a pool — the highlight's `fire.pitch` before the release is what lights
 *   after the pass (4 seeds); a listed pool does not dry during the pass; a chain of 2 lights nothing; a burning pool burns an enemy
 *   −1 and again after 1 s (credited, `pitch-fire`), never the hero, and is gone after 2 s; an enemy burning by the fire consumable
 *   lights the pool it stands in; the fiery elite's trail does not;
 * - the law off: a plain slow enemy, no pot; a journal without the numbers' keys plays the same world; replays.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { HAMMERS } from './buildIds';
import { planChain } from './chain';
import { CROSSBOW } from './enemies/crossbow';
import { PITCHER, pitcherWindup } from './enemies/pitcher';
import { inWater, pond, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { PITCH_FIRE_SOURCE, POT_SOURCE, inPitch, pitchPools, potsInFlight } from './pitch';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Loadout } from './kit';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

registerArena({
  id: 'pitch-yard', name: 'Двор смолокура', summary: 'Тест смолокура', goal: 'kills', killGoal: 999, width: 24, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 23.3, y: 6 }, enemies: [], pitch: true,
});
registerArena({
  id: 'pitch-pond', name: 'Пруд смолокура', summary: 'Тест смолокура', goal: 'kills', killGoal: 999, width: 24, height: 12,
  heroStart: { x: 5, y: 6 }, obstacles: [pond(5, 6, 3)], buttons: [], door: { x: 23.3, y: 6 }, enemies: [], pitch: true,
});
registerArena({
  id: 'pitch-off', name: 'Двор без смолы', summary: 'Тест смолокура', goal: 'kills', killGoal: 999, width: 24, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 23.3, y: 6 }, enemies: [],
});

/** Nothing comes, nobody walks (unless asked), touches do not hurt, no grace window after a hit or a chain. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function yard(k: number, extra: Partial<Params> = {}, arena = 'pitch-yard', loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, extra: { elite?: boolean; affixes?: string[] } = {}): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...extra }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const now = sim.world.events.splice(0);
    out.push(...now);
    if (until(sim.world, now)) break;
  }
  return out;
}
type Pot = Extract<WorldEvent, { type: 'pot' }>;
const pots = (events: readonly WorldEvent[], action?: Pot['action']): Pot[] => events.filter((e): e is Pot => e.type === 'pot' && (!action || e.action === action));
const has = (action: Pot['action']) => (_w: World, now: readonly WorldEvent[]): boolean => pots(now, action).length > 0;
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Ticks until the hero stands (the dash and a return run after it). */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}
function draw(sim: Simulation, links: readonly Vec[]): void {
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const q of links.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
  assert(sim.world.chain.length === links.length, `chain drawn: ${sim.world.chain.length} of ${links.length}`);
}
/** The pitcher 6 to the right of the hero standing at (6, 6): its first pot lands on the hero, a pool lies there. */
function firstPool(k: number, extra: Partial<Params> = {}, loadout?: Loadout): { sim: Simulation; pitcher: Enemy; events: WorldEvent[] } {
  const sim = yard(k, extra, 'pitch-yard', loadout);
  sim.command({ t: 'teleport', x: 6, y: 6 });
  const pitcher = place(sim, { x: 12, y: 6 }, 1, PITCHER, 1);
  const events = ticks(sim, ticksOf(4), [], has('pool'));
  assert(pitchPools(sim.world).length === 1, `seed ${k}: the first pool lies (${pitchPools(sim.world).length})`);
  return { sim, pitcher, events };
}

check('the cycle: the windup 0.6 s, the mark is the hero\'s centre at the throw (he walked in the windup), the fight\'s first lands 1.8 s after — the hero in it −1 (source `pot`); the reload 5 s; the next flies 1.2 s — the hero who walked off takes nothing (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = yard(k), w = sim.world;
    sim.command({ t: 'teleport', x: 6, y: 6 });
    const pitcher = place(sim, { x: 12, y: 6 }, 1, PITCHER, 1);
    const aim = ticks(sim, 30, [], has('aim'));
    const aimAt = w.tick;
    assert(pots(aim, 'aim').length === 1 && pitcherWindup(w, pitcher), `seed ${k}: the windup began`);
    // The hero walks in the windup: the mark is where he stands at the throw, not where he stood at its start.
    sim.command({ t: 'walk', x: 0, y: 1 });
    ticks(sim, 12);
    sim.command({ t: 'walk', x: 0, y: 0 });
    const thrown = ticks(sim, 60, [], has('throw'));
    const throwAt = w.tick, mark = pots(thrown, 'throw')[0];
    assert(mark && Math.abs((throwAt - aimAt) * SIM_DT - 0.6) <= SIM_DT + 1e-9, `seed ${k}: thrown 0.6 s after the windup's start (${((throwAt - aimAt) * SIM_DT).toFixed(3)})`);
    assert(dist(mark, w.hero) < 1e-9 && Math.abs(mark.y - 6) > 0.5 && Math.abs(mark.flight! - 1.8) < 1e-9, `seed ${k}: the mark at the hero at the throw (${mark.x.toFixed(2)}, ${mark.y.toFixed(2)}), flight ${mark.flight}`);
    const hp = w.hero.hp;
    const landed = ticks(sim, ticksOf(2.5), [], has('land'));
    const land = pots(landed, 'land')[0];
    assert(land && Math.abs((w.tick - throwAt) * SIM_DT - 1.8) <= SIM_DT + 1e-9, `seed ${k}: landed 1.8 s after the throw (${((w.tick - throwAt) * SIM_DT).toFixed(3)})`);
    assert(land.hit === 'hero' && w.hero.hp === hp - 1 && landed.some(e => e.type === 'hit' && e.source === POT_SOURCE), `seed ${k}: the hero in the circle −1 (HP ${hp} → ${w.hero.hp})`);
    assert(pots(landed, 'pool').length === 1 && inPitch(w, w.hero), `seed ${k}: a pool lies where it fell`);
    // The reload: the next windup no sooner than 5 s after the throw.
    const next = ticks(sim, ticksOf(6), [], has('aim'));
    assert(pots(next, 'aim').length === 1 && (w.tick - throwAt) * SIM_DT >= 5 - SIM_DT, `seed ${k}: the reload 5 s (${((w.tick - throwAt) * SIM_DT).toFixed(2)})`);
    const again = ticks(sim, 60, [], has('throw'));
    const second = pots(again, 'throw')[0], secondAt = w.tick;
    assert(Math.abs((second?.flight ?? 0) - 1.2) < 1e-9, `seed ${k}: the next flies 1.2 s (${second?.flight})`);
    // He walks off the mark (more than 0.7 + 0.28 in 0.5 s).
    sim.command({ t: 'walk', x: 0, y: -1 });
    const off = ticks(sim, ticksOf(2), [], has('land'));
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(Math.abs((w.tick - secondAt) * SIM_DT - 1.2) <= SIM_DT + 1e-9, `seed ${k}: landed 1.2 s after`);
    assert(pots(off, 'land')[0] && !pots(off, 'land')[0].hit && w.hero.hp === hp - 1, `seed ${k}: walked off — nothing (HP ${w.hero.hp})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the pool slows: the hero walks ×0.6 in it, an enemy ×0.4 (the step of one tick in and out of the pool; 2 seeds)', () => {
  for (const k of [1, 2]) {
    const { sim } = firstPool(k), w = sim.world, pool = pitchPools(w)[0];
    sim.command({ t: 'walk', x: 1, y: 0 });
    let x = w.hero.x; ticks(sim, 1);
    const inside = w.hero.x - x;
    ticks(sim, 60, [], ww => dist(ww.hero, pool) > 1.5);
    x = w.hero.x; ticks(sim, 1);
    const outside = w.hero.x - x;
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(outside > 0 && Math.abs(inside / outside - 0.6) < 1e-6, `seed ${k}: the hero ×0.6 (${inside.toFixed(4)} / ${outside.toFixed(4)})`);
    // Two plain enemies 2.5 from the hero: one in the pool, one out of it; both walk at the same speed.
    sim.command({ t: 'param', key: 'enemySpeed', value: 1 });
    const hero = { x: w.hero.x, y: w.hero.y };
    const a = place(sim, { x: hero.x - 2.5, y: hero.y }, 1), b = place(sim, { x: hero.x, y: hero.y + 2.5 }, 1);
    assert(inPitch(w, a) && !inPitch(w, b), `seed ${k}: one in the pool, one out`);
    const a0 = { x: a.x, y: a.y }, b0 = { x: b.x, y: b.y };
    ticks(sim, 1);
    const ratio = dist(a, a0) / dist(b, b0);
    assert(Math.abs(ratio - 0.4) < 1e-6, `seed ${k}: the enemy ×0.4 (${ratio.toFixed(4)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the pool dries after 4 s; the fifth pool dries the oldest; a pot in water leaves no pool', () => {
  const { sim, events } = firstPool(1), w = sim.world;
  const pool = pots(events, 'pool')[0], born = w.tick;
  const dried = ticks(sim, ticksOf(5), [], (_ww, now) => pots(now, 'dry').some(e => e.id === pool.id));
  assert(pots(dried, 'dry').some(e => e.id === pool.id) && Math.abs((w.tick - born) * SIM_DT - 4) <= SIM_DT + 1e-9 && !pitchPools(w).length, `the pool dried after 4 s (${((w.tick - born) * SIM_DT).toFixed(3)})`);
  // Fast throws, long pools: the fifth lands — the oldest dries, four lie.
  const many = yard(2, { pitchReload: 0.5, pitchGap: 0, pitchLife: 60 }), mw = many.world;
  many.command({ t: 'teleport', x: 6, y: 6 });
  place(many, { x: 12, y: 6 }, 1, PITCHER, 1);
  const all: WorldEvent[] = [];
  ticks(many, ticksOf(30), all, () => pots(all, 'pool').length >= 5);
  const pools = pots(all, 'pool');
  assert(pools.length === 5 && pitchPools(mw).length === 4, `five pools landed, four lie (${pools.length}, ${pitchPools(mw).length})`);
  assert(pots(all, 'dry').map(e => e.id).join() === String(pools[0].id) && !pitchPools(mw).some(q => q.id === pools[0].id), 'the oldest dried');
  // The hero in the pond: the pot lands, no pool.
  const wet = yard(3, {}, 'pitch-pond'), ww = wet.world;
  wet.command({ t: 'teleport', x: 5, y: 6 });
  place(wet, { x: 12, y: 6 }, 1, PITCHER, 1);
  const splash = ticks(wet, ticksOf(4), [], has('land'));
  assert(inWater(ww.hero, ww.arena) && pots(splash, 'land').length === 1, 'landed in the pond');
  ticks(wet, 2, splash);
  assert(!pots(splash, 'pool').length && !pitchPools(ww).length, 'no pool in water');
  assert(replays(many) && replays(wet), 'replay');
});

check('the common clock: a second pitcher winds up no sooner than 2.5 s after the first\'s throw, one pot in the air; a crossbow\'s aim holds the windup (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = yard(k), w = sim.world;
    sim.command({ t: 'teleport', x: 6, y: 6 });
    place(sim, { x: 12, y: 4.5 }, 1, PITCHER, 1); place(sim, { x: 12, y: 7.5 }, 1, PITCHER, 2);
    const events: WorldEvent[] = [];
    let most = 0, throwAt = -1, secondAim = -1;
    for (let i = 0; i < ticksOf(8) && secondAim < 0; i++) {
      const now = ticks(sim, 1);
      events.push(...now);
      most = Math.max(most, potsInFlight(w).length);
      if (throwAt < 0 && pots(now, 'throw').length) throwAt = w.tick;
      if (throwAt >= 0 && pots(now, 'aim').length) secondAim = w.tick;
    }
    const aims = pots(events, 'aim');
    assert(aims.length === 2 && aims[0].id !== aims[1].id && secondAim > 0, `seed ${k}: both wound up in turn`);
    assert((secondAim - throwAt) * SIM_DT >= 2.5 - SIM_DT && most === 1, `seed ${k}: the second ${((secondAim - throwAt) * SIM_DT).toFixed(2)} s after the throw, in the air at most ${most}`);
    // A crossbowman aiming: the pitcher's windup waits for its bolt.
    const cb = yard(k), cw = cb.world;
    cb.command({ t: 'teleport', x: 6, y: 6 });
    place(cb, { x: 12, y: 3 }, 1, CROSSBOW, 1); place(cb, { x: 12, y: 8 }, 1, PITCHER, 2);
    const seen = ticks(cb, ticksOf(3), [], has('aim'));
    const shot = seen.findIndex(e => e.type === 'bolt' && e.action === 'shot'), aim = seen.findIndex(e => e.type === 'pot' && e.action === 'aim');
    assert(seen.some(e => e.type === 'bolt' && e.action === 'aim') && shot >= 0 && aim > shot, `seed ${k}: the windup after the bolt (${shot}, ${aim})`);
    assert(cw.status === 'playing' && replays(sim) && replays(cb), `seed ${k}: replay`);
  }
});

check('a frozen pitcher waits; its death in the windup drops the throw; a pot in the air lands after its thrower died', () => {
  const cold = yard(1), w = cold.world;
  cold.command({ t: 'teleport', x: 6, y: 6 });
  const p = place(cold, { x: 12, y: 6 }, 1, PITCHER, 1);
  ticks(cold, 30, [], has('aim'));
  const aimAt = w.tick;
  cold.command({ t: 'chill', id: p.id, seconds: 2 });
  const thrown = ticks(cold, ticksOf(4), [], has('throw'));
  assert(pots(thrown, 'throw').length === 1 && (w.tick - aimAt) * SIM_DT >= 2.5, `frozen 2 s: thrown ${((w.tick - aimAt) * SIM_DT).toFixed(2)} s after the windup's start`);
  const dead = yard(2, { bombRange: 20 }), dw = dead.world;
  dead.command({ t: 'teleport', x: 6, y: 6 });
  const q = place(dead, { x: 12, y: 6 }, 1, PITCHER, 1);
  ticks(dead, 30, [], has('aim'));
  dead.command({ t: 'items', kind: 'bomb', count: 1 });
  assert(dead.command({ t: 'item', kind: 'bomb', x: q.x, y: q.y }) && !dw.enemies.includes(q), 'bombed in the windup');
  const none = ticks(dead, ticksOf(3));
  assert(!pots(none, 'throw').length && !potsInFlight(dw).length && !dw.pitch, 'no throw');
  const late = yard(3, { bombRange: 20 }), lw = late.world;
  late.command({ t: 'teleport', x: 6, y: 6 });
  const r = place(late, { x: 12, y: 6 }, 1, PITCHER, 1);
  ticks(late, 90, [], has('throw'));
  late.command({ t: 'items', kind: 'bomb', count: 1 });
  late.command({ t: 'item', kind: 'bomb', x: r.x, y: r.y });
  const after = ticks(late, ticksOf(2.5), [], has('land'));
  assert(!lw.enemies.includes(r) && pots(after, 'land').length === 1 && pitchPools(lw).length === 1, 'the pot in the air landed, a pool lies');
  assert(replays(cold) && replays(dead) && replays(late), 'replay');
});

/** The hero at (3, 6) beside the pool at (6, 6); three weak links along y = 6 across it (or the first `n`). */
function acrossPool(sim: Simulation, n = 3): Vec[] {
  sim.command({ t: 'teleport', x: 3, y: 6 });
  return [{ x: 4.4, y: 6 }, { x: 5.8, y: 6 }, { x: 7.2, y: 6 }].slice(0, n).map(at => place(sim, at, 0));
}

check('«Огненный проход»: a chain of 3 across a pool — the highlight\'s `fire.pitch` before the release is what lights after the pass; a chain of 2 lights nothing (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const { sim } = firstPool(k, {}, { talismans: [], hammer: HAMMERS.fire }), w = sim.world, pool = pitchPools(w)[0];
    draw(sim, acrossPool(sim));
    const plan = planChain(w);
    assert(plan.fire?.lit && JSON.stringify(plan.fire.pitch) === JSON.stringify([pool.id]), `seed ${k}: the highlight lists the pool (${JSON.stringify(plan.fire)})`);
    sim.command({ t: 'release' });
    assert(JSON.stringify(w.move?.pitch) === JSON.stringify([pool.id]), `seed ${k}: the release fixed the list`);
    const events = settle(sim);
    const lit = pots(events, 'ignite');
    assert(JSON.stringify(lit.map(e => e.id)) === JSON.stringify(plan.fire.pitch) && lit.every(e => e.cause === 'path'), `seed ${k}: lit after the pass = the highlight (${JSON.stringify(lit)})`);
    assert(replays(sim), `seed ${k}: replay`);
    // A chain of 2: no fire, no list, nothing lit.
    const short = firstPool(k, {}, { talismans: [], hammer: HAMMERS.fire }), sw = short.sim.world;
    draw(short.sim, acrossPool(short.sim, 2));
    assert(!planChain(sw).fire?.lit && !planChain(sw).fire?.pitch, `seed ${k}: a chain of 2 — no fire in the highlight`);
    short.sim.command({ t: 'release' });
    const none = settle(short.sim);
    ticks(short.sim, 10, none);
    assert(!pots(none, 'ignite').length && pitchPools(sw).every(q => q.burn === undefined), `seed ${k}: a chain of 2 lights nothing`);
  }
});

check('a listed pool does not dry during the pass: released as its life runs out, it still lights after the pass', () => {
  for (const k of [1, 2]) {
    const { sim } = firstPool(k, {}, { talismans: [], hammer: HAMMERS.fire }), w = sim.world, pool = pitchPools(w)[0];
    ticks(sim, ticksOf(5), [], ww => (ww.pitch?.pools[0]?.life ?? 0) <= 2 * SIM_DT);
    assert(pitchPools(w)[0] === pool && pool.life <= 2 * SIM_DT, `seed ${k}: the pool about to dry (${pool.life})`);
    draw(sim, acrossPool(sim));
    assert(JSON.stringify(planChain(w).fire?.pitch) === JSON.stringify([pool.id]), `seed ${k}: listed`);
    sim.command({ t: 'release' });
    const events = settle(sim);
    assert(!pots(events, 'dry').length && pots(events, 'ignite').some(e => e.id === pool.id), `seed ${k}: not dried in the pass, lit after it`);
  }
});

check('four pools held by the pass\u2019s list: a pot landing in the pass still lands (the hero in the pass — blocked), no fifth pool, no listed pool dries; all four light after (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = yard(k, { pitchReload: 0.5, pitchGap: 0, pitchLife: 60 }, 'pitch-yard', { talismans: [], hammer: HAMMERS.fire }), w = sim.world;
    place(sim, { x: 12, y: 6 }, 1, PITCHER, 1);
    for (const x of [4, 5.5, 7, 8.5]) {
      sim.command({ t: 'teleport', x, y: 6 });
      const got = ticks(sim, ticksOf(6), [], has('pool'));
      assert(pots(got, 'pool').length === 1, `seed ${k}: a pool at ${x}`);
    }
    const four = pitchPools(w).map(q => q.id);
    assert(four.length === 4, `seed ${k}: four pools (${four.length})`);
    // The fifth pot in the air: released so that it lands in the pass.
    ticks(sim, ticksOf(4), [], has('throw'));
    ticks(sim, ticksOf(2), [], ww => (potsInFlight(ww)[0]?.left ?? 0) <= 0.25);
    assert(potsInFlight(w).length === 1, `seed ${k}: a pot in the air`);
    sim.command({ t: 'teleport', x: 3, y: 6 });
    draw(sim, [4.5, 6, 7.5, 9].map(x => place(sim, { x, y: 6 }, 0)));
    const plan = planChain(w);
    assert(JSON.stringify([...plan.fire?.pitch ?? []].sort()) === JSON.stringify([...four].sort()), `seed ${k}: the highlight lists all four (${JSON.stringify(plan.fire?.pitch)})`);
    const hp = w.hero.hp;
    sim.command({ t: 'release' });
    const events: WorldEvent[] = [];
    let landedInPass = false;
    for (let i = 0; i < 300 && (w.move || i === 0); i++) { const now = ticks(sim, 1); events.push(...now); if (w.move && pots(now, 'land').length) landedInPass = true; }
    assert(landedInPass && pots(events, 'land').length === 1, `seed ${k}: the pot landed in the pass`);
    assert(!pots(events, 'pool').length && !pots(events, 'dry').length, `seed ${k}: no fifth pool, nothing dried`);
    assert(w.hero.hp === hp, `seed ${k}: the hero in the pass not hurt (HP ${hp} → ${w.hero.hp})`);
    const lit = pots(events, 'ignite').map(e => e.id).sort();
    assert(JSON.stringify(lit) === JSON.stringify([...four].sort()), `seed ${k}: all four lit after the pass (${JSON.stringify(lit)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a burning pool: an enemy in it −1, again after 1 s — killed, credited (`pitch-fire`); the hero in it loses nothing; gone after 2 s', () => {
  const { sim } = firstPool(1, {}, { talismans: [], hammer: HAMMERS.fire }), w = sim.world, pool = pitchPools(w)[0];
  draw(sim, acrossPool(sim));
  sim.command({ t: 'release' });
  const lit = settle(sim);
  const litAt = w.tick;
  assert(pots(lit, 'ignite').length === 1 && pool.burn !== undefined, 'lit');
  // Out of the path's own fire (0.8 from it), in the pool.
  const victim = place(sim, { x: 6, y: 6.8 }, 2, 'basic', 2);
  const kills = w.stats.kills;
  sim.command({ t: 'walk', x: -1, y: 0 });
  const hp = w.hero.hp;
  const burn = ticks(sim, ticksOf(0.3));
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(inPitch(w, w.hero) && w.hero.hp === hp, `the hero in the burning pool: HP ${hp} → ${w.hero.hp}`);
  const first = burn.filter(e => e.type === 'enemyHit' && e.enemyId === victim.id);
  assert(first.length === 1 && first[0].type === 'enemyHit' && first[0].source === PITCH_FIRE_SOURCE && victim.hp === 1, `−1 on entry (${JSON.stringify(first)})`);
  const rest = ticks(sim, ticksOf(1));
  const kill = rest.find(e => e.type === 'kill' && e.enemyId === victim.id);
  assert(kill?.type === 'kill' && kill.source === PITCH_FIRE_SOURCE && kill.credited === true && w.stats.kills === kills + 1, `again after 1 s — killed, credited (${JSON.stringify(kill)})`);
  const out = ticks(sim, ticksOf(2), [], (_ww, now) => pots(now, 'dry').length > 0);
  const dry = pots(out, 'dry')[0];
  assert(dry?.id === pool.id && dry.burnt && Math.abs((w.tick - litAt) * SIM_DT - 2) <= SIM_DT + 1e-9 && !pitchPools(w).length, `burnt out after 2 s (${((w.tick - litAt) * SIM_DT).toFixed(3)})`);
  assert(replays(sim), 'replay');
});

check('an enemy burning by the fire consumable lights the pool it stands in; the fiery elite\'s trail across a pool does not', () => {
  for (const k of [1, 2]) {
    const { sim } = firstPool(k), w = sim.world, pool = pitchPools(w)[0];
    sim.command({ t: 'teleport', x: 8.6, y: 6 });
    const torch = place(sim, { x: 5.6, y: 6 }, 5, 'basic', 2);
    sim.command({ t: 'items', kind: 'fire', count: 1 });
    assert(sim.command({ t: 'item', kind: 'fire', x: torch.x, y: torch.y }) && torch.burn, `seed ${k}: the enemy burns`);
    const lit = ticks(sim, 2);
    assert(pots(lit, 'ignite').some(e => e.id === pool.id && e.cause === 'burning'), `seed ${k}: lit by the burning enemy`);
    // A fiery elite walks across a fresh pool, its trail in the pool: nothing lights.
    const trail = firstPool(k, { pitchLife: 10 }), tw = trail.sim.world, fresh = pitchPools(tw)[0];
    trail.sim.command({ t: 'teleport', x: 9.6, y: 6 });
    trail.sim.command({ t: 'param', key: 'enemySpeed', value: 1 });
    place(trail.sim, { x: 3.4, y: 6 }, 3, 'basic', 2, { elite: true, affixes: ['fiery'] });
    const walked = ticks(trail.sim, ticksOf(4));
    assert(tw.trails.some(p => dist(p, fresh) <= 1), `seed ${k}: the trail lies in the pool (${JSON.stringify(tw.trails.map(p => [p.x.toFixed(2), p.y.toFixed(2)]))} pool ${JSON.stringify(fresh)} ${JSON.stringify(tw.enemies.map(e => [e.kind, e.x.toFixed(2), e.y.toFixed(2)]))})`);
    assert(!pots(walked, 'ignite').length && fresh.burn === undefined, `seed ${k}: the trail lit nothing`);
    assert(replays(sim) && replays(trail.sim), `seed ${k}: replay`);
  }
});

check('the law off: the pitcher is a plain slow enemy (it walks up, no pot, no state); a journal without the numbers\' keys plays the same world', () => {
  for (const k of [1, 2]) {
    const off = yard(k, { enemySpeed: 1 }, 'pitch-off'), w = off.world;
    off.command({ t: 'teleport', x: 6, y: 6 });
    const p = place(off, { x: 12, y: 6 }, 1, PITCHER, 1);
    const events = ticks(off, ticksOf(5));
    assert(!pots(events).length && !w.pitch && !w.pots && !('pitch' in (worldState(w) as object)) && p.x < 10, `seed ${k}: no pot, it walked up (${p.x.toFixed(2)})`);
    const { sim } = firstPool(k);
    ticks(sim, ticksOf(2));
    const journal = sim.exportJournal()! as Journal;
    for (const key of ['pitchWindup', 'pitchFlight', 'pitchRadius', 'pitchDamage', 'pitchPoolRadius', 'pitchLife', 'pitchHeroSlow', 'pitchEnemySlow', 'pitchReload', 'pitchGap', 'pitchNear', 'pitchFar', 'pitchBurn', 'pitch']) {
      delete (journal.params as unknown as Record<string, unknown>)[key];
    }
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(sim.world), `seed ${k}: the same world without the keys (the arena turns the law on)`);
  }
});

console.log(`pitcher: ${checks} checks passed`);
