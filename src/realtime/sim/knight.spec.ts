/**
 * Task 43 «Гарнизон, шаг 2», part В — the knight (sim/enemies/garrison.ts «Рыцарь»; docs/realtime-elite-behaviors.md, «Гарнизон»;
 * design docs/design-notes/task-43-garrison-step2.md, 5 and 10). Node only: `npm run test:realtime-knight`.
 *
 * Every check plays journalled commands (clear, teleport, place, begin / drag, release, walk) and looks at what the player meets:
 * - in armour each chain through the knight takes exactly one plate, its HP stays; the highlight says the same before the release;
 *   the plates never grow back; the chain goes on through it; it is never an elite; its touch is its own (2, not raised to 3);
 * - the pass that takes the last plate sheds the armour after the dash (not while it runs) — the offensive: the normal speed class,
 *   «Рывок» `knightPause` s after the shed, windup 1.0 s, the run, the pause, «Размах» with windup 0.8 s, the pause, «Рывок» again;
 * - «Рывок» hurts the hero who stays in the lane (once, 2) and not the one who walked out of it during the windup;
 * - «Размах» hurts the hero in the circle (2), not the one outside; enemies in it lose 1 HP (a plain one dies — not the player's
 *   kill), an elite and a knight in armour lose a plate; bodies outside are untouched;
 * - the killer lines: «рыцарь», «рывок рыцаря», «размах рыцаря»;
 * - a real fight on «Рыцарь (проба)» by a greedy bot on several seeds: every chain's highlight is what its dash does; the fight
 *   replays to its hash (checkpoints every 300 ticks); the live telemetry is the replay's; a journal without the knight's keys
 *   plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. No bot win or loss is asserted.
 */
import { registerArena } from './arenas';
import type { Command } from './commands';
import { createFightObserver } from '../telemetry/observe';
import { analyzeJournal } from '../telemetry/report';
import { RtDeathWatch, rtDeathLine } from '../run/rtRunEnd';
import { planChain, nextCandidates } from './chain';
import { GUARD, KNIGHT, KNIGHT_CHARGE_SOURCE, KNIGHT_SWING_SOURCE, knightLane, knightState, knightSwing } from './enemies/garrison';
import type { Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { enemySpeed, type Enemy, type World, type WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const SEEDS = [1, 2, 3, 4];
const KNIGHT_KEYS = ['knightPlates', 'knightHp', 'knightTouch', 'knightChargeWindup', 'knightChargeDamage', 'knightSwingWindup', 'knightSwingRadius', 'knightSwingDamage', 'knightPause'] as const;

/** An open field (no garrison flag: the given values decide the laws). */
registerArena({
  id: 'knight-field', name: 'Поле рыцаря', summary: 'Тест рыцаря', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [],
});

/** A fight where nothing comes, nobody walks and the hero cannot fall; the knight's touch off unless asked. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false;
  p.survivorKnockback = false; p.enemySpeed = 0; p.knightTouch = 0;
  return Object.assign(p, extra);
}
function field(k = 1, params: Params = quiet()): Simulation {
  const sim = new Simulation({ arena: 'knight-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over); `during` sees the world and the tick's events while the dash runs. */
function settle(sim: Simulation, out: WorldEvent[] = [], during?: (w: World, events: readonly WorldEvent[]) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) {
    sim.tick();
    const events = [...sim.world.events];
    out.push(...events); sim.world.events.length = 0;
    if (sim.world.move) during?.(sim.world, events);
  }
  return out;
}
/** Draws a chain through `bodies` (real begin / drag), returns the highlight's outcome per enemy id, releases and plays the dash. */
function chain(sim: Simulation, bodies: readonly Enemy[], during?: (w: World, events: readonly WorldEvent[]) => void): { plan: Map<number, NonNullable<ReturnType<typeof planChain>['links'][number]['outcome']>>; events: WorldEvent[] } {
  sim.command({ t: 'begin', x: bodies[0].x, y: bodies[0].y });
  for (const b of bodies.slice(1)) sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
  const w = sim.world, plan = new Map<number, NonNullable<ReturnType<typeof planChain>['links'][number]['outcome']>>();
  assert(w.chain.length === bodies.length, `the chain holds ${w.chain.length} of ${bodies.length}`);
  for (const l of planChain(w).links) if (l.link.kind === 'enemy' && l.outcome) plan.set(l.link.id, l.outcome);
  sim.command({ t: 'release' });
  return { plan, events: settle(sim, [], during) };
}
type ChainHit = Extract<WorldEvent, { type: 'chainHit' }>;
const chainHits = (events: readonly WorldEvent[]): ChainHit[] => events.filter((e): e is ChainHit => e.type === 'chainHit');
type KnightMove = Extract<WorldEvent, { type: 'knightMove' }>;
const heroHits = (events: readonly WorldEvent[], source: string): number =>
  events.filter(e => e.type === 'hit' && e.source === source).reduce((a, e) => a + (e as Extract<WorldEvent, { type: 'hit' }>).damage, 0);
/** Plates of `e` now (−1 — no armour). */
const platesOf = (e: Enemy): number => e.armor?.plates ?? -1;
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** The highlight equals the dash: every planned outcome is the dash's hit on that enemy (killed, damage, the plates left). */
function planIsDash(plan: ReadonlyMap<number, { killed: boolean; damage: number; plate?: true; platesAfter?: number }>, events: readonly WorldEvent[], what: string): void {
  const hits = chainHits(events);
  for (const [id, o] of plan) {
    const h = hits.find(x => x.enemyId === id);
    assert(h, `${what}: the dash struck enemy ${id} as planned`);
    assert(h.killed === o.killed && h.damage === o.damage && (h.plates ?? null) === (o.plate ? o.platesAfter ?? 0 : null),
      `${what}: enemy ${id} planned ${JSON.stringify(o)}, the dash ${JSON.stringify(h)}`);
  }
}

/** A knight 1.6 to the right of the hero (both stand still: `enemySpeed` 0). */
function knightAhead(k: number, extra: Partial<Params> = {}): { sim: Simulation; kn: Enemy } {
  const sim = field(k, quiet(extra));
  sim.command({ t: 'teleport', x: 5, y: 6 });
  const kn = place(sim, { x: 6.6, y: 6 }, 3, KNIGHT, 0);
  ticks(sim, 1);
  return { sim, kn };
}
/** Two chains strip the knight's plates; returns the game second of the tick that shed its armour. */
function stripped(k: number, extra: Partial<Params> = {}): { sim: Simulation; kn: Enemy; shedAt: number } {
  const { sim, kn } = knightAhead(k, extra), w = sim.world;
  chain(sim, [kn]);
  sim.command({ t: 'begin', x: kn.x, y: kn.y });
  sim.command({ t: 'release' });
  // The shed comes in the first group step after the dash.
  let shedAt = NaN;
  for (let i = 0; i < 900 && Number.isNaN(shedAt); i++) {
    sim.tick();
    if (w.events.some(e => e.type === 'knightShed' && e.id === kn.id)) shedAt = w.time;
    w.events.length = 0;
  }
  assert(knightState(kn)?.armoured === false && Number.isFinite(shedAt), `seed ${k}: the armour shed (${shedAt})`);
  return { sim, kn, shedAt };
}

check('in armour: each chain through the knight takes exactly one plate, HP 3 stays; the highlight says the same; no regrowth, no window (several seeds)', () => {
  for (const k of SEEDS) {
    const { sim, kn } = knightAhead(k), w = sim.world;
    assert(kn.armor?.plates === 2 && kn.armor.max === 2 && kn.hp === 3 && !kn.elite, `seed ${k}: 2 plates, HP 3 (${JSON.stringify(kn.armor)}, ${kn.hp})`);
    for (const left of [1, 0]) {
      let shedWhileDash = false;
      const { plan, events } = chain(sim, [kn], (_w, ev) => { if (ev.some(e => e.type === 'knightShed')) shedWhileDash = true; });
      const o = plan.get(kn.id)!;
      assert(o.plate && o.platesAfter === left && o.hpAfter === 3 && !o.killed, `seed ${k}: the highlight — one plate off, ${left} left, HP 3 (${JSON.stringify(o)})`);
      planIsDash(plan, events, `seed ${k}, plate → ${left}`);
      assert(kn.hp === 3 && w.enemies.includes(kn), `seed ${k}: HP untouched (${kn.hp})`);
      assert(!shedWhileDash, `seed ${k}: no shed while the dash runs`);
      if (left === 1) {
        assert(platesOf(kn) === 1, `seed ${k}: one plate left (${JSON.stringify(kn.armor)})`);
        // No regrowth and no window: 10 s later still one plate; it stands as a link (no `open`).
        ticks(sim, ticksOf(10));
        assert(platesOf(kn) === 1 && kn.armor?.open === undefined && kn.armor.regrow === undefined, `seed ${k}: no regrowth after 10 s (${JSON.stringify(kn.armor)})`);
      } else {
        const shed = events.filter(e => e.type === 'knightShed').length + ticks(sim, 1).filter(e => e.type === 'knightShed').length;
        assert(shed === 1 && kn.armor === undefined && knightState(kn)?.armoured === false, `seed ${k}: the armour shed once after the pass (${shed})`);
      }
    }
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the chain goes on through a knight in armour: a line guard — knight — guard of one colour; the guards die, the knight loses a plate; highlight = dash', () => {
  for (const k of SEEDS) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 5, y: 6 });
    const g1 = place(sim, { x: 6.4, y: 6 }, 0, GUARD, 1), kn = place(sim, { x: 7.4, y: 6 }, 3, KNIGHT, 1), g2 = place(sim, { x: 8.4, y: 6 }, 0, GUARD, 1);
    ticks(sim, 1);
    const { plan, events } = chain(sim, [g1, kn, g2]);
    assert(plan.get(g1.id)?.killed && plan.get(kn.id)?.plate && plan.get(g2.id)?.killed, `seed ${k}: the highlight — kill, plate, kill (${JSON.stringify([...plan])})`);
    planIsDash(plan, events, `seed ${k}, the line`);
    assert(!w.enemies.includes(g1) && !w.enemies.includes(g2) && kn.armor?.plates === 1 && kn.hp === 3, `seed ${k}: guards dead, the knight 1 plate, HP 3`);
  }
});

check('never an elite: `place` with elite gives a plain knight with its own plates; its touch is its own — 2 with the tough touch on, in armour and in the offensive', () => {
  const sim = field(1, quiet({ eliteArmor: true, toughTouch: true, knightTouch: 2 })), w = sim.world;
  sim.command({ t: 'teleport', x: 5, y: 6 });
  const kn = place(sim, { x: 5.5, y: 6 }, 3, KNIGHT, 0, true);
  assert(!kn.elite && kn.armor?.plates === 2 && kn.armor.boss === true, `not an elite (${JSON.stringify({ elite: kn.elite, armor: kn.armor })})`);
  const touch = ticks(sim, ticksOf(1.5)).filter((e): e is Extract<WorldEvent, { type: 'hit' }> => e.type === 'hit' && e.source === KNIGHT);
  assert(touch.length > 0 && touch.every(h => h.damage === 2), `the armoured knight's touch is 2 (${touch.map(h => h.damage)})`);
  // The offensive: strip both plates, then its touch is still 2 (HP 3 would raise a tough one's to 3).
  chain(sim, [kn]); chain(sim, [kn]); ticks(sim, 1);
  assert(knightState(kn)?.armoured === false && kn.hp === 3, 'the offensive, HP 3');
  sim.command({ t: 'teleport', x: kn.x - 0.5, y: kn.y });
  const touch2 = ticks(sim, ticksOf(1)).filter((e): e is Extract<WorldEvent, { type: 'hit' }> => e.type === 'hit' && e.source === KNIGHT);
  assert(touch2.length > 0 && touch2.every(h => h.damage === 2), `the offensive knight's touch is 2 (${touch2.map(h => h.damage)})`);
  assert(w.status === 'playing', 'the hero stands');
});

check('the speed class: slow in armour, normal in the offensive (the walk measured over 0.5 s of real ticks)', () => {
  const p = quiet({ enemySpeed: 2, speedClasses: true });
  const walked = (sim: Simulation, kn: Enemy): number => { const at = { x: kn.x, y: kn.y }; ticks(sim, ticksOf(0.5)); return dist(at, kn); };
  const a = field(1, p);
  a.command({ t: 'teleport', x: 3, y: 6 });
  const k1 = place(a, { x: 15, y: 6 }, 3, KNIGHT, 0);
  ticks(a, 1);
  const slow = walked(a, k1), expectSlow = enemySpeed(a.world, k1) * 0.5;
  assert(Math.abs(slow - expectSlow) < 1e-6 && Math.abs(enemySpeed(a.world, k1) - a.world.pressure.enemySpeed * p.speedSlow) < 1e-9, `armour: walked ${slow}`);
  const b = field(1, { ...p, knightPlates: 0 });
  b.command({ t: 'teleport', x: 3, y: 6 });
  const k2 = place(b, { x: 15, y: 6 }, 3, KNIGHT, 0);
  ticks(b, 1);
  assert(knightState(k2)?.armoured === false, 'no plates — the offensive from the start');
  const normal = walked(b, k2);
  assert(Math.abs(normal - b.world.pressure.enemySpeed * 0.5) < 1e-6 && normal > slow * 1.2, `offensive: walked ${normal} (armour ${slow})`);
});

check('the offensive schedule: «Рывок» 2 s after the shed, windup 1.0 s, the run, 2 s, «Размах» windup 0.8 s, 2 s, «Рывок» again (several seeds)', () => {
  for (const k of SEEDS) {
    const { sim, kn, shedAt } = stripped(k), w = sim.world, moves: { t: number; ev: KnightMove }[] = [];
    for (let i = 0; i < ticksOf(14); i++) {
      sim.tick();
      for (const e of w.events) if (e.type === 'knightMove' && e.id === kn.id) moves.push({ t: w.time, ev: e });
      w.events.length = 0;
    }
    const at = (move: string, stage: string, n = 0): number => moves.filter(m => m.ev.move === move && m.ev.stage === stage)[n]?.t ?? NaN;
    const near = (a: number, b: number): boolean => Math.abs(a - b) < SIM_DT * 1.5;
    const c0 = at('charge', 'start'), r0 = at('charge', 'run'), e0 = at('charge', 'end'), s0 = at('swing', 'start'), h0 = at('swing', 'hit'), c1 = at('charge', 'start', 1);
    assert(near(c0 - shedAt, 2), `seed ${k}: the first charge ${c0 - shedAt} s after the shed`);
    assert(near(r0 - c0, 1), `seed ${k}: the charge winds up ${r0 - c0} s`);
    assert(e0 > r0 && e0 - r0 <= 5 / 8 + 2 * SIM_DT, `seed ${k}: the run ${e0 - r0} s`);
    assert(near(s0 - e0, 2) && near(h0 - s0, 0.8), `seed ${k}: the swing ${s0 - e0} s after the run, winds up ${h0 - s0} s`);
    assert(near(c1 - h0, 2), `seed ${k}: the next charge ${c1 - h0} s after the swing`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

/** The knight's charge winds up now (ticks until its `start`). */
function untilMove(sim: Simulation, kn: Enemy, move: 'charge' | 'swing', out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < ticksOf(10); i++) {
    sim.tick();
    const events = [...sim.world.events]; sim.world.events.length = 0; out.push(...events);
    if (events.some(e => e.type === 'knightMove' && e.id === kn.id && e.move === move && e.stage === 'start')) return out;
  }
  throw new Error(`no ${move}`);
}

check('«Рывок» by the lane: the hero who stays in it takes 2 once (`knight-charge`); the one who walks out sideways in the windup takes nothing; the knight runs the lane to its end', () => {
  for (const k of SEEDS) {
    for (const stay of [true, false]) {
      const { sim, kn } = stripped(k), w = sim.world;
      untilMove(sim, kn, 'charge');
      const lane = knightLane(kn)!, hp = w.hero.hp;
      assert(lane && !lane.charging && lane.len === 5 && lane.width === 0.8, `seed ${k}: the lane 5 × 0.8 (${JSON.stringify(lane)})`);
      const events: WorldEvent[] = [];
      if (!stay) {
        // Out of the lane: 0.4 s of a walk across it (≥ 0.4 + the hero's body at his speed), then he stands.
        sim.command({ t: 'walk', x: -lane.dy, y: lane.dx });
        ticks(sim, ticksOf(0.4), events);
        sim.command({ t: 'walk', x: 0, y: 0 });
      }
      for (let i = 0; i < ticksOf(3) && !events.some(e => e.type === 'knightMove' && e.move === 'charge' && e.stage === 'end'); i++) ticks(sim, 1, events);
      const got = heroHits(events, KNIGHT_CHARGE_SOURCE);
      if (stay) assert(got === 2 && w.hero.hp === hp - 2, `seed ${k}: in the lane — 2 (${got}, HP ${hp} → ${w.hero.hp})`);
      else assert(got === 0 && w.hero.hp === hp, `seed ${k}: out of the lane — nothing (${got})`);
      assert(Math.abs(dist(kn, lane.to)) < 0.05, `seed ${k}: the knight ran to the lane's end (${dist(kn, lane.to).toFixed(3)} off)`);
    }
  }
});

check('«Размах» by the circle: the hero in it takes 2, outside nothing; enemies in it lose 1 HP (a plain one dies, not the player\'s), an elite and a knight in armour lose a plate; outside untouched', () => {
  for (const k of SEEDS) {
    for (const inside of [true, false]) {
      const { sim, kn } = stripped(k, { eliteArmor: true }), w = sim.world;
      untilMove(sim, kn, 'charge');
      untilMove(sim, kn, 'swing');
      const sw = knightSwing(w, kn)!;
      assert(sw && Math.abs(sw.r - 1.6) < 1e-9, `seed ${k}: the circle 1.6 (${JSON.stringify(sw)})`);
      // Bodies around the knight (setup): a plain one inside, one outside, an elite inside, a knight in armour inside.
      const dx = kn.x < 10 ? 1 : -1;
      const plainIn = place(sim, { x: kn.x + dx * 1.1, y: kn.y }, 0, 'basic', 1), plainOut = place(sim, { x: kn.x + dx * 2.6, y: kn.y }, 0, 'basic', 1);
      const elite = place(sim, { x: kn.x, y: kn.y + (kn.y < 6 ? 1.2 : -1.2) }, 0, 'basic', 2, true), armoured = place(sim, { x: kn.x - dx * 1.2, y: kn.y }, 3, KNIGHT, 3);
      const elitePlates = elite.armor?.plates ?? 0;
      assert(elitePlates > 0 && armoured.armor?.plates === 2, `seed ${k}: the elite and the knight armoured`);
      sim.command({ t: 'teleport', x: kn.x, y: kn.y + (kn.y < 6 ? -1 : 1) * (inside ? 1.4 : 2.6) });
      const hp = w.hero.hp, kills = w.stats.kills, events: WorldEvent[] = [];
      for (let i = 0; i < ticksOf(2) && !events.some(e => e.type === 'knightMove' && e.move === 'swing' && e.stage === 'hit'); i++) ticks(sim, 1, events);
      const got = heroHits(events, KNIGHT_SWING_SOURCE);
      if (inside) assert(got === 2 && w.hero.hp === hp - 2, `seed ${k}: in the circle — 2 (${got})`);
      else assert(got === 0 && w.hero.hp === hp, `seed ${k}: outside — nothing (${got})`);
      const kill = events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === plainIn.id);
      assert(kill && kill.credited === false && kill.source === KNIGHT_SWING_SOURCE && w.stats.kills === kills, `seed ${k}: the plain one died, not the player's (${JSON.stringify(kill)})`);
      assert(w.enemies.includes(plainOut) && plainOut.hp === 0, `seed ${k}: the one outside is untouched`);
      assert(elite.armor?.plates === elitePlates - 1 && elite.hp === 0 && w.enemies.includes(elite), `seed ${k}: the elite lost a plate (${elite.armor?.plates} of ${elitePlates})`);
      assert(platesOf(armoured) === 1 && armoured.hp === 3, `seed ${k}: the armoured knight lost a plate, HP 3`);
    }
  }
});

check('«Размах» waits for the dash: a chain released at the end of the windup through a body in the circle — the swing strikes only after the dash, the highlight is what the dash does (several seeds)', () => {
  for (const k of SEEDS) {
    const { sim, kn } = stripped(k), w = sim.world;
    untilMove(sim, kn, 'charge');
    untilMove(sim, kn, 'swing');
    // The hero 5 to the side of the knight; three bodies of one colour from him to the circle (the last one in it).
    const side = kn.x < 10 ? 1 : -1, at = (dx: number): Vec => ({ x: kn.x + side * dx, y: kn.y });
    sim.command({ t: 'teleport', x: at(5).x, y: at(5).y });
    const l1 = place(sim, at(3.6), 0, 'basic', 1), l2 = place(sim, at(2.2), 0, 'basic', 1), inCircle = place(sim, at(0.9), 1, 'basic', 1);
    ticks(sim, ticksOf(0.65));
    let struckInDash = false;
    const { plan, events } = chain(sim, [l1, l2, inCircle], (_w, ev) => { if (ev.some(e => e.type === 'knightMove' && e.move === 'swing' && e.stage === 'hit')) struckInDash = true; });
    assert(!struckInDash, `seed ${k}: the swing did not strike while the dash ran`);
    planIsDash(plan, events, `seed ${k}, the chain through the circle`);
    const after = ticks(sim, ticksOf(0.5), events);
    assert(after.some(e => e.type === 'knightMove' && e.move === 'swing' && e.stage === 'hit'), `seed ${k}: the swing struck after the dash`);
    assert(w.status === 'playing', `seed ${k}: playing`);
  }
});

check('the killer lines: the knight\'s touch «рыцарь» (in armour too), «рывок рыцаря», «размах рыцаря»', () => {
  const lineOf = (play: (watch: RtDeathWatch) => void): string | null => {
    const watch = new RtDeathWatch();
    play(watch);
    return rtDeathLine(watch.death ?? undefined);
  };
  const run = (sim: Simulation, watch: RtDeathWatch, seconds: number): void => {
    for (let i = 0; i < ticksOf(seconds) && sim.world.status === 'playing'; i++) { watch.seen(sim.world); sim.tick(); watch.read(sim.world, sim.world.events); sim.world.events.length = 0; }
  };
  // The touch in armour.
  const a = field(1, quiet({ heroHp: 2, knightTouch: 2 }));
  a.command({ t: 'teleport', x: 5, y: 6 });
  place(a, { x: 5.5, y: 6 }, 3, KNIGHT, 0);
  assert(lineOf(w => run(a, w, 3)) === 'Сразил: рыцарь', 'the touch in armour');
  // The charge and the swing: the hero with 2 HP left at the move's windup, standing in its zone.
  for (const [move, line] of [['charge', 'Сразил: рывок рыцаря'], ['swing', 'Сразил: размах рыцаря']] as const) {
    const { sim, kn } = stripped(2);
    if (move === 'swing') untilMove(sim, kn, 'charge');
    untilMove(sim, kn, move);
    if (move === 'swing') sim.command({ t: 'teleport', x: kn.x, y: kn.y + (kn.y < 6 ? -1.3 : 1.3) });
    sim.command({ t: 'param', key: 'heroHp', value: 2 });
    sim.world.hero.hp = Math.min(sim.world.hero.hp, 2);
    assert(lineOf(w => run(sim, w, 3)) === line, `${move}: ${line}`);
  }
});

/**
 * A greedy bot on «Рыцарь (проба)»: chains of up to 4 nearest candidates; with none, it walks to the nearest enemy. Every release
 * compares the highlight with the dash (each enemy link's outcome).
 */
function knightBot(k: number, params: Params = defaultParams()): { sim: Simulation; chains: number; checkpoints: string[]; summary: ReturnType<ReturnType<typeof createFightObserver>['summary']>; sheds: number } {
  const p = { ...params, heroHp: 999, phases: params.phases.map(x => ({ ...x })) };
  const sim = new Simulation({ arena: 'g-knight-test', params: p, seed: seedOf(k), record: true }), w = sim.world, checkpoints: string[] = [];
  const observer = createFightObserver(w), all: WorldEvent[] = [];
  const command = (cmd: Command): void => { sim.command(cmd); observer.command(cmd, w); };
  const tick = (): void => { sim.tick(); observer.tick(w); all.push(...w.events); w.events.length = 0; if (w.tick % 300 === 0) checkpoints.push(sim.hash()); };
  let chains = 0;
  for (let s = 0; s < 90 && w.status === 'playing'; s++) {
    for (let i = 0; i < 15 && w.status === 'playing'; i++) tick();
    if (w.move) continue;
    const near = (from: Vec): Enemy | undefined => nextCandidates(w).sort((a, b) => dist(a, from) - dist(b, from))[0];
    const first = near(w.hero);
    if (!first) {
      const to = [...w.enemies].sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0], d = to ? dist(to, w.hero) : 0;
      command({ t: 'walk', x: to && d > 0.2 ? (to.x - w.hero.x) / d : 0, y: to && d > 0.2 ? (to.y - w.hero.y) / d : 0 });
      for (let i = 0; i < 20 && w.status === 'playing'; i++) tick();
      command({ t: 'walk', x: 0, y: 0 });
      continue;
    }
    command({ t: 'begin', x: first.x, y: first.y });
    for (let n = 1; n < 4; n++) {
      const last = w.enemies.find(e => e.id === w.chain[w.chain.length - 1]?.id), next = near(last ?? w.hero);
      if (!next) break;
      command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    }
    if (!w.chain.length) continue;
    const plan = new Map<number, { killed: boolean; damage: number; plate?: true; platesAfter?: number }>();
    for (const l of planChain(w).links) if (l.link.kind === 'enemy' && l.outcome) plan.set(l.link.id, l.outcome);
    command({ t: 'release' });
    const from = all.length;
    for (let i = 0; i < 900 && (w.move || i === 0) && w.status === 'playing'; i++) tick();
    chains++;
    if (w.status === 'playing') planIsDash(plan, all.slice(from), `seed ${k}, chain ${chains}`);
  }
  return { sim, chains, checkpoints, summary: observer.summary(), sheds: all.filter(e => e.type === 'knightShed').length };
}

check('«Рыцарь (проба)»: two knights in armour (one in the guards\' line), a real fight by a greedy bot on 6 seeds — highlight = dash on every chain; knights shed and move; replay with checkpoints; telemetry = replay', () => {
  const start = new Simulation({ arena: 'g-knight-test', params: defaultParams(), seed: seedOf(1), record: true });
  start.tick();
  const knights = start.world.enemies.filter(e => e.kind === KNIGHT);
  assert(knights.length === 2 && knights.every(e => e.armor?.plates === 2 && e.hp === 3), `two knights, 2 plates, HP 3 (${knights.length})`);
  assert(knights.some(e => e.vars.fm !== undefined && e.vars.ox !== undefined), 'the line\'s knight walks in the guards\' line');
  let sheds = 0, moved = 0;
  const lasts = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const run = knightBot(k);
    assert(run.chains > 10, `seed ${k}: chains ${run.chains}`);
    sheds += run.sheds;
    const journal = JSON.parse(JSON.stringify(run.sim.exportJournal()!)) as Journal;
    const again = replay(journal);
    assert(again.hash() === run.sim.hash(), `seed ${k}: replay`);
    lasts.add(run.sim.hash());
    const replayed = analyzeJournal(journal);
    assert(JSON.stringify({ ...run.summary, threats: {} }) === JSON.stringify({ ...replayed.summary, threats: {} }), `seed ${k}: the live summary is the replay's`);
    const g = run.summary.garrison;
    assert(g.knights === 2 && g.knightSheds === run.sheds && g.knightChains >= g.knightSheds * 2, `seed ${k}: knights ${JSON.stringify(g)}`);
    const t = replayed.summary.threats;
    moved += (t['knight-charge']?.warned ?? 0) + (t['knight-swing']?.warned ?? 0);
  }
  assert(sheds > 0, `the bot stripped some knights (${sheds})`);
  assert(lasts.size > 1, 'the seeds differ');
  console.log(`   sheds ${sheds}, knight warnings in the threat table ${moved}`);
});

check('a recorded fight with knights replays to its hash with the checkpoints every 300 ticks; without the knight keys the journal plays the same world', () => {
  for (const k of [3, 7]) {
    const run = knightBot(k);
    const journal = JSON.parse(JSON.stringify(run.sim.exportJournal()!)) as Journal, points: string[] = [];
    const again = replay(journal, sim => { if (sim.world.tick % 300 === 0) points.push(sim.hash()); });
    assert(again.hash() === run.sim.hash(), `seed ${k}: replay`);
    assert(run.checkpoints.length > 3 && JSON.stringify(points.slice(0, run.checkpoints.length)) === JSON.stringify(run.checkpoints), `seed ${k}: checkpoints (${run.checkpoints.length})`);
    const bare = JSON.parse(JSON.stringify(journal)) as Journal;
    for (const key of KNIGHT_KEYS) delete (bare.params as unknown as Record<string, unknown>)[key];
    const strip = (w: World): string => { const st = worldState(w) as Record<string, unknown>; delete st.params; return JSON.stringify(st); };
    assert(strip(replay(bare).world) === strip(run.sim.world), `seed ${k}: the journal without the keys plays the same world`);
  }
});

console.log(`knight: ${checks} checks passed`);
