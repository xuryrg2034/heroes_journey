/**
 * Task 43 «Гарнизон, шаг 2», part А — the law of the crossbow and the crossbowman (sim/enemies/crossbow.ts; docs/realtime-elite-
 * behaviors.md, «Арбалетчик»). Node only: `npm run test:realtime-crossbow`.
 *
 * Every check plays journalled commands (clear, teleport, place, param, chill, begin / release) and looks at what the player meets:
 * - the line is fixed at the windup's start: the hero who leaves it is not hit; the hero who stays is hit for `crossbowDamage`;
 * - the bolt strikes the FIRST body on the line: a body between the crossbowman and the hero dies (not the player's kill, but the
 *   kill goal counts it) and the hero is not hit; an armoured elite between loses a plate;
 * - the reload; the crossbowman keeps 5–7 from the hero; its death drops the shot;
 * - the threat `bolt` of the telemetry (hit, dodged); a journal without the new keys plays the old world; replays.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { BOLT_SOURCE, CROSSBOW, crossbowLine } from './enemies/crossbow';
import type { Vec } from './geometry';
import { goalProgress, type Enemy, type World, type WorldEvent } from './world';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { nextCandidates } from './chain';
import { ThreatTracker } from '../telemetry/threats';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

registerArena({
  id: 'crossbow-field', name: 'Поле арбалета', summary: 'Тест арбалета', goal: 'kills', killGoal: 999, width: 24, height: 12,
  heroStart: { x: 4, y: 6 }, obstacles: [], buttons: [], door: { x: 23.3, y: 6 }, enemies: [],
});

/** Nothing comes, nobody walks; the hero has 15 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 15; p.hitstop = false; p.enemySpeed = 0;
  return Object.assign(p, extra);
}
function field(k = 1, params: Params = quiet()): Simulation {
  const sim = new Simulation({ arena: 'crossbow-field', params, seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0, elite = false): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type Bolt = Extract<WorldEvent, { type: 'bolt' }>;
const bolts = (events: readonly WorldEvent[]): Bolt[] => events.filter((e): e is Bolt => e.type === 'bolt');
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** The crossbowman 6 to the right of the hero at (4, 6); ticks until its windup began. */
function aimed(k: number, extra: Partial<Params> = {}): { sim: Simulation; cb: Enemy; events: WorldEvent[] } {
  const sim = field(k, quiet(extra));
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const cb = place(sim, { x: 10, y: 6 }, 1, CROSSBOW, 1);
  const events = ticks(sim, 60, [], w => !!crossbowLine(w, cb));
  assert(crossbowLine(sim.world, cb), `seed ${k}: the crossbowman aims`);
  return { sim, cb, events };
}

check('the line is fixed at the windup\'s start: the hero who stays is hit for 2 (source `bolt`); the hero who steps off is not (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const stay = aimed(k), w = stay.sim.world, line = crossbowLine(w, stay.cb)!, hp = w.hero.hp;
    assert(Math.abs(line.y0 - 6) < 1e-9 && Math.abs(line.y1 - 6) < 1e-9 && line.x1 < 1, `seed ${k}: from the crossbowman through the hero to the wall (${JSON.stringify(line)})`);
    const events = ticks(stay.sim, ticksOf(1.2));
    const shot = bolts(events).find(e => e.action === 'shot');
    assert(shot?.hit === 'hero' && w.hero.hp === hp - 2 && events.some(e => e.type === 'hit' && e.source === BOLT_SOURCE), `seed ${k}: hit (${JSON.stringify(shot)}, HP ${hp} → ${w.hero.hp})`);
    const step = aimed(k), sw = step.sim.world, fixed = crossbowLine(sw, step.cb)!;
    step.sim.command({ t: 'teleport', x: 4, y: 7 });
    ticks(step.sim, 5);
    const still = crossbowLine(sw, step.cb)!;
    assert(still.y1 === fixed.y1 && still.x1 === fixed.x1, `seed ${k}: the line does not follow the hero`);
    const hp2 = sw.hero.hp, after = ticks(step.sim, ticksOf(1.2));
    assert(sw.hero.hp === hp2 && !bolts(after).find(e => e.action === 'shot')?.hit, `seed ${k}: off the line — not hit`);
    assert(replays(stay.sim) && replays(step.sim), `seed ${k}: replay`);
  }
});

check('the bolt strikes the first body: a plain enemy between dies — not the player\'s kill, the kill goal counts it; the hero is not hit; an armoured elite loses a plate', () => {
  for (const k of [1, 2, 3]) {
    const { sim } = aimed(k), w = sim.world;
    const shield = place(sim, { x: 7, y: 6 }, 2, 'basic', 2);
    sim.command({ t: 'chill', id: shield.id, seconds: 10 });
    const hp = w.hero.hp, kills = w.stats.kills, goal = goalProgress(w).done;
    const events = ticks(sim, ticksOf(1.2));
    const shot = bolts(events).find(e => e.action === 'shot'), kill = events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === shield.id);
    assert(shot?.hit === 'enemy' && shot.target === shield.id && kill?.source === BOLT_SOURCE && kill.credited === false, `seed ${k}: the body between died (${JSON.stringify(kill)})`);
    assert(w.hero.hp === hp && w.stats.kills === kills && goalProgress(w).done === goal + 1 && w.goalKills === 1, `seed ${k}: hero unhurt, no kill of the player, the goal +1`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  const { sim } = aimed(5, { eliteArmor: true }), w = sim.world;
  const elite = place(sim, { x: 7, y: 6 }, 2, 'basic', 2, true);
  sim.command({ t: 'chill', id: elite.id, seconds: 10 });
  const plates = elite.armor?.plates ?? 0;
  ticks(sim, ticksOf(1.2));
  assert(plates > 0 && w.enemies.includes(elite) && (elite.armor?.plates ?? 0) === plates - 1, `the armoured elite lost a plate (${plates} → ${elite.armor?.plates})`);
});

check('the reload: the next windup 4 s after the shot; the crossbowman\'s death drops the shot in flight', () => {
  const { sim } = aimed(2, { heroHp: 99 }), w = sim.world;
  const times: { a: string; t: number }[] = [];
  for (let i = 0; i < ticksOf(12); i++) { sim.tick(); for (const e of bolts(w.events)) times.push({ a: e.action, t: w.time }); w.events.length = 0; }
  const shots = times.filter(x => x.a === 'shot').map(x => x.t), aims = times.filter(x => x.a === 'aim').map(x => x.t);
  assert(shots.length >= 2 && aims.length >= 2 && Math.abs(aims[0] - shots[0] - 4) < 0.05 && Math.abs(shots[1] - aims[0] - 1) < 0.05, `the cycle: aims ${aims.map(t => t.toFixed(2))}, shots ${shots.map(t => t.toFixed(2))}`);
  const dead = aimed(3);
  dead.sim.command({ t: 'items', kind: 'bomb', count: 1 });
  dead.sim.command({ t: 'teleport', x: 7, y: 6 });
  dead.sim.command({ t: 'item', kind: 'bomb', x: dead.cb.x, y: dead.cb.y });
  const after = ticks(dead.sim, ticksOf(1.5));
  assert(!dead.sim.world.enemies.includes(dead.cb) && !bolts(after).some(e => e.action === 'shot'), 'dead — no shot');
});

check('the crossbowman keeps 5–7 from the hero: nearer it backs off, farther it walks up', () => {
  for (const [start, k] of [[6.5, 1], [17, 2]] as const) {
    const sim = field(k, quiet({ enemySpeed: 1.5, heroHp: 999, crossbowReload: 100 }));
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const cb = place(sim, { x: start, y: 6 }, 1, CROSSBOW, 1);
    ticks(sim, ticksOf(12));
    const d = dist(cb, sim.world.hero);
    assert(d >= 5 - 0.1 && d <= 7 + 0.1, `from ${start}: it stands ${d.toFixed(2)} from the hero`);
  }
});

check('the threat `bolt`: a windup with the hero on the line — hit when he stays, dodged when he steps off', () => {
  // Fights watched from their start.
  const sim = field(1);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const t1 = new ThreatTracker(sim.world);
  place(sim, { x: 10, y: 6 }, 1, CROSSBOW, 1);
  for (let i = 0; i < ticksOf(2.5); i++) { sim.tick(); t1.tick(sim.world); sim.world.events.length = 0; }
  const sim2 = field(2), t2 = new ThreatTracker(sim2.world);
  sim2.command({ t: 'teleport', x: 4, y: 6 });
  const cb2 = place(sim2, { x: 10, y: 6 }, 1, CROSSBOW, 1);
  for (let i = 0; i < ticksOf(2.5); i++) {
    sim2.tick(); t2.tick(sim2.world); sim2.world.events.length = 0;
    if (crossbowLine(sim2.world, cb2) && sim2.world.hero.y === 6) sim2.command({ t: 'teleport', x: 4, y: 7.2 });
  }
  assert(t1.tally().bolt?.hit === 1, `stayed: ${JSON.stringify(t1.tally())}`);
  assert(t2.tally().bolt?.dodged === 1, `stepped off: ${JSON.stringify(t2.tally())}`);
});

check('a journal without the new keys plays the old world (a forest fight with chains)', () => {
  for (const k of [1, 2]) {
    const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(k), record: true });
    for (let s = 0; s < 20; s++) {
      ticks(sim, 30);
      const c = nextCandidates(sim.world)[0];
      if (!c || sim.world.move) continue;
      sim.command({ t: 'begin', x: c.x, y: c.y });
      sim.command({ t: 'release' });
    }
    const journal = sim.exportJournal()! as Journal, without = JSON.parse(JSON.stringify(journal)) as Journal;
    for (const key of ['crossbowWindup', 'crossbowReload', 'crossbowDamage', 'crossbowNear', 'crossbowFar'] as const) delete (without.params as Partial<Params>)[key];
    const a = replay(journal), b = replay(without);
    const strip = (x: unknown): string => { const s = x as Record<string, unknown>; const { params: _p, ...rest } = s; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(a.world)) === strip(worldState(b.world)) && a.hash() === sim.hash(), `seed ${k}: the same world without the keys`);
  }
});

console.log(`crossbow: ${checks} checks passed`);
