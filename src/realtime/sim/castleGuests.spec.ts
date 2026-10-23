/**
 * Task 60а «Замок: гости» — Подсвечник, Ферзь, Дворецкий и Люстра, Полтергейст, Шут (enemies/castleGuests.ts, shove.ts, shots.ts,
 * chain.ts; docs/realtime-elite-behaviors.md, «Замок: гости»; spec docs/design-notes/task-60-castle-enemies.md, 18 «Node»). Node only:
 * `npm run test:realtime-castle-guests`.
 *
 * Every check plays journalled commands (clear, place, teleport, walk, begin, drag, release, chill) and looks at what the player meets:
 * the hero's HP, the kills and their credit, where things stand, the shots on the arena. The highlight (`planChain`) is read before the
 * release and compared with what the pass did. Seeds `Math.imul(k, 2654435761) >>> 0`; replays to the same hash.
 */
import { registerArena } from './arenas';
import { BARREL, ROOK, WARDROBE } from './enemies/castle';
import {
  BUTLER, CANDELABRA, CANDELABRA_SOURCE, FALL_SOURCE, JESTER, POLTERGEIST, QUEEN, QUEEN_WAYS, REFLECT_SOURCE, THROW_SOURCE, WAX_SOURCE,
  candelabraCross, jesterStunned, queenLines,
} from './enemies/castleGuests';
import { GUEST_ARENAS } from './arenasCastleGuests';
import { wall, type Vec } from './geometry';
import { worldState } from './hash';
import { enemyRefusal, planChain } from './chain';
import { DEFAULT_PARAMS, defaultParams, type Params } from './params';
import { FROST_PASS, FUSIONS } from './buildIds';
import { durabilityOf, shovePath } from './shove';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест гостей' };
registerArena({ ...base, id: 'guests-field', name: 'Поле гостей', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [wall(22, 0, 2, 14)], door: { x: 1, y: 0.7 }, castle: true, snuffShots: true });
registerArena({ ...base, id: 'guests-timer', name: 'Таймер гостей', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 1, y: 0.7 }, castle: true, snuffShots: true, volleyGap: 2.5 });

/** The new keys (spec 11): a journal without them plays the same world. */
const GUEST_KEYS = (Object.keys(DEFAULT_PARAMS) as (keyof Params)[]).filter(k => /^(candelabra|queen|butler|chandelier|poltergeist|jester)/.test(k));

/** Nothing comes, nobody walks; the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}, arena = 'guests-field'): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const now = [...sim.world.events];
    sim.world.events.length = 0;
    out.push(...now);
    if (until(sim.world, now)) break;
  }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const alive = (sim: Simulation, e: Enemy): boolean => sim.world.enemies.includes(e);
/** Draws a chain through the bodies (journalled begin / drag). */
function draw(sim: Simulation, links: readonly Vec[]): void {
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const q of links.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and ticks until the dash and its shove are over. */
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(4), out, w => !w.move && !w.shoves);
}
const heroHits = (events: readonly WorldEvent[], source: string): number => of(events, 'hit').filter(h => h.source === source).length;

// ---- Подсвечник ----

check('candelabra: a chain [weak, candelabra] — after it «цепь закончена»; the release topples it along the last segment: the weak of the preview die (the player\'s), the tough in the lane does not, the lane burns 2 s (the tough loses 1 to the fire, never dies), the fires are out, it broke; from the other side — another lane (6 seeds)', () => {
  for (let k = 1; k <= 6; k++) {
    const east = k % 2 === 1, sx = east ? 1 : -1, off = (k % 3) * 0.12;
    const sim = field(k), w = sim.world;
    const cx = 12, cy = 7;
    sim.command({ t: 'teleport', x: cx - sx * 3.2, y: cy });
    const a = place(sim, { x: cx - sx * 1.6, y: cy }, 0), candle = place(sim, { x: cx, y: cy }, 0, CANDELABRA);
    const inLane = [place(sim, { x: cx + sx * 0.9, y: cy + off }, 0, 'basic', 1), place(sim, { x: cx + sx * 1.8, y: cy - 0.3 - off }, 0, 'basic', 2)];
    const offLane = [place(sim, { x: cx + sx * 1.2, y: cy + 1.2 }, 0, 'basic', 3), place(sim, { x: cx - sx * 0.2, y: cy - 1.4 }, 0, 'basic', 1)];
    const tough = place(sim, { x: cx + sx * 1.4, y: cy + 0.1 }, 1, 'basic', 2);
    draw(sim, [a, candle]);
    const after = place(sim, { x: cx, y: cy + 1.6 }, 0, 'basic', 3);
    const plan = planChain(w);
    assert(plan.endsOnThing && enemyRefusal(w, after, plan) === 'afterObject', `seed ${k}: after the candelabra — ${enemyRefusal(w, after, plan)}`);
    const topple = plan.shove?.topple;
    assert(topple && topple.id === candle.id && Math.abs(topple.to.x - (cx + sx * 2)) < 1e-6 && Math.abs(topple.to.y - cy) < 1e-6, `seed ${k}: the lane along the last segment ${JSON.stringify(topple)}`);
    assert(JSON.stringify([...topple.crushed].sort()) === JSON.stringify(inLane.map(e => e.id).sort()), `seed ${k}: the preview crushes ${topple.crushed} (lane ${inLane.map(e => e.id)})`);
    const kills = w.stats.kills, events = release(sim);
    assert(inLane.every(e => !alive(sim, e)) && offLane.every(e => alive(sim, e)) && alive(sim, tough) && tough.hp >= 0, `seed ${k}: the lane's weak died, the others live`);
    assert(w.stats.kills === kills + 1 + inLane.length && of(events, 'kill').every(e => e.credited), `seed ${k}: the player's kills (${w.stats.kills - kills})`);
    assert(!alive(sim, candle) && of(events, 'thing').some(e => e.id === candle.id) && of(events, 'candelabra').some(e => e.action === 'topple' && e.id === candle.id), `seed ${k}: it toppled and broke`);
    const fire = w.trails.filter(t => t.ownerId === candle.id);
    assert(fire.length >= 4 && fire.every(t => t.life <= 2 + 1e-9 && Math.abs(t.y - cy) < 1e-6 && (t.x - cx) * sx > 0), `seed ${k}: the lane burns (${fire.length} points)`);
    ticks(sim, ticksOf(1));
    assert(tough.hp === 0 && alive(sim, tough), `seed ${k}: the fire weakens the tough one, never kills (${tough.hp})`);
    ticks(sim, ticksOf(1.2));
    assert(!w.trails.some(t => t.ownerId === candle.id), `seed ${k}: the fire is out after 2 s`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('candelabra: a wardrobe shoved into it wears it and topples it along the wardrobe\'s way — the plan of the wardrobe shows the lane and the weak in it; the run does it (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world, dy = 0.1 * k;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const a = place(sim, { x: 4.6, y: 7 }, 0), wardrobe = place(sim, { x: 6.2, y: 7 }, 0, WARDROBE), candle = place(sim, { x: 8.6, y: 7 }, 0, CANDELABRA);
    const weak = place(sim, { x: 9.8, y: 7 + dy }, 0, 'basic', 1), side = place(sim, { x: 8.6, y: 9 }, 0, 'basic', 2);
    draw(sim, [a, wardrobe]);
    const plan = planChain(w).shove!;
    assert(plan.stop === 'thing' && plan.target === candle.id && plan.breaks.includes(candle.id) && plan.topple?.id === candle.id && plan.topple.to.x > candle.x + 1.9 && plan.topple.crushed.includes(weak.id), `seed ${k}: the plan ${JSON.stringify({ stop: plan.stop, topple: plan.topple })}`);
    const events = release(sim);
    assert(!alive(sim, candle) && !alive(sim, weak) && alive(sim, side) && alive(sim, wardrobe) && durabilityOf(wardrobe) === 1, `seed ${k}: toppled east, the weak crushed, the wardrobe 2 → 1`);
    assert(of(events, 'kill').filter(e => e.enemyId === weak.id).every(e => e.credited), `seed ${k}: the player's`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('candelabra: «Вертушка» — the lighting does not hurt, the spinning cross hits the hero who stands (−1); the hero who walks with the gap stays whole the 4 s; the cross only hurts the hero (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    for (const follow of [false, true]) {
      const sim = field(k, { invulnerability: 0.5 }), w = sim.world, r = 1.5;
      const candle = place(sim, { x: 12, y: 7 }, 0, CANDELABRA);
      const start = { x: 12 + r * Math.cos(0.4 * k), y: 7 + r * Math.sin(0.4 * k) };
      sim.command({ t: 'teleport', x: start.x, y: start.y });
      // A weak enemy on the cross's way: the fires pass through it.
      const near = place(sim, { x: 12 + r * Math.cos(0.4 * k + Math.PI), y: 7 + r * Math.sin(0.4 * k + Math.PI) }, 0, 'basic', 1);
      const events = ticks(sim, ticksOf(4), [], (_w, now) => now.some(e => e.type === 'candelabra' && e.action === 'light'));
      const light = of(events, 'candelabra').find(e => e.action === 'light')!;
      assert(light && light.dir === 1, `seed ${k}: it lit (the first way +1)`);
      // The hero steps onto a ray for the lighting (its fires light one by one and hurt nobody), then back into the gap.
      const hp = w.hero.hp, lit: WorldEvent[] = [], onRay = { x: 12 + Math.cos(light.angle!) * 1.0, y: 7 + Math.sin(light.angle!) * 1.0 };
      sim.command({ t: 'teleport', x: onRay.x, y: onRay.y });
      ticks(sim, ticksOf(1) - 2, lit);
      assert(w.hero.hp === hp && !of(lit, 'hit').length && candelabraCross(w, candle)?.phase === 'light', `seed ${k}: the lighting hurts nobody, on a ray too`);
      sim.command({ t: 'teleport', x: start.x, y: start.y });
      ticks(sim, 1, lit);
      const spin: WorldEvent[] = [];
      const angle0 = Math.atan2(start.y - 7, start.x - 12);
      for (let i = 0; i < ticksOf(4.2); i++) {
        if (follow) {
          const cross = candelabraCross(w, candle);
          // The gap's middle: 45° off the first ray (where the hero stood at the lighting), it turns with the cross.
          const a = cross ? cross.angle - Math.PI / 4 : angle0;
          const goal = { x: 12 + r * Math.cos(a), y: 7 + r * Math.sin(a) }, d = dist(goal, w.hero);
          sim.command(d > 0.05 ? { t: 'walk', x: (goal.x - w.hero.x) / d, y: (goal.y - w.hero.y) / d } : { t: 'walk', x: 0, y: 0 });
        }
        ticks(sim, 1, spin);
      }
      const hits = heroHits(spin, CANDELABRA_SOURCE);
      if (follow) assert(hits === 0 && w.hero.hp === hp, `seed ${k}: walking with the gap — whole (${hits} hits)`);
      else assert(hits >= 1 && of(spin, 'hit').find(h => h.source === CANDELABRA_SOURCE)!.damage === 1, `seed ${k}: standing — hit by the cross (${hits})`);
      assert(alive(sim, near) && near.hp === 0, `seed ${k}: the fires spare the enemy on their way`);
      assert(of(spin, 'candelabra').some(e => e.action === 'out'), `seed ${k}: the fires went out after the spin`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

// ---- Ферзь ----

/** Ticks until the queen's windup begins; returns its aim event. */
function untilAim(sim: Simulation, out: WorldEvent[] = []): Extract<WorldEvent, { type: 'queen' }> {
  ticks(sim, ticksOf(12), out, (_w, now) => now.some(e => e.type === 'queen' && e.action === 'aim'));
  const aim = of(out, 'queen').find(e => e.action === 'aim');
  assert(aim, 'the queen aims');
  return aim;
}

check('queen: «Ход ферзя» goes before the volley and hurts nobody (it stops before a body); the 8 lines are fixed at the windup\'s start — the stars fly along them whatever the hero does (5 seeds)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = field(k, { contactDamage: 1 }), w = sim.world;
    const queen = place(sim, { x: 12, y: 7 }, 2, QUEEN, 1);
    sim.command({ t: 'teleport', x: 12 + 2 + 0.3 * k, y: 7 + (k % 2 ? 2 : -2) });
    const events = ticks(sim, ticksOf(3), [], (_w, now) => now.some(e => e.type === 'queen' && e.action === 'move'));
    const move = of(events, 'queen').find(e => e.action === 'move');
    assert(move, `seed ${k}: it moves first`);
    // A body on its way: the hero steps onto the line, the queen stops before him.
    const mid = { x: (move.x + move.x1!) / 2, y: (move.y + move.y1!) / 2 };
    sim.command({ t: 'teleport', x: mid.x, y: mid.y });
    const hp = w.hero.hp, slide = ticks(sim, ticksOf(1.5));
    assert(dist(queen, w.hero) >= 0.6 - 1e-6 && w.hero.hp === hp && !of(slide, 'hit').length, `seed ${k}: it stopped before the hero (${dist(queen, w.hero).toFixed(2)}), no hit`);
    sim.command({ t: 'teleport', x: queen.x + 4, y: queen.y + 1 });
    const aim = untilAim(sim);
    const lines = JSON.stringify(queenLines(w, queen)!.lines);
    assert(JSON.stringify(aim.lines) === lines && aim.lines!.length === 8, `seed ${k}: 8 lines`);
    sim.command({ t: 'teleport', x: queen.x - 3, y: queen.y - 2 });
    ticks(sim, 10);
    assert(JSON.stringify(queenLines(w, queen)!.lines) === lines, `seed ${k}: the lines do not follow the hero`);
    ticks(sim, ticksOf(2), [], x => !!x.shots?.length);
    const stars = (w.shots ?? []).filter(s => s.kind === 'star');
    assert(stars.length === 8 && stars.every(s => s.hang > 0) && QUEEN_WAYS.every(way => stars.some(s => Math.abs(s.vx / 6 - way.x) < 1e-9 && Math.abs(s.vy / 6 - way.y) < 1e-9)), `seed ${k}: 8 stars hang on the ways`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('queen: a star hits the first body — a weak enemy before the hero dies (not the player\'s), a tough one loses 1; behind a barrel the hero is whole and the barrel too; with nothing between — −1 (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    for (const cover of ['weak', 'tough', 'barrel', 'none'] as const) {
      const sim = field(k, { queenMove: 0.01 }), w = sim.world;
      const queen = place(sim, { x: 10, y: 7 }, 2, QUEEN, 1);
      const way = QUEEN_WAYS[(k * 2) % 8], at = (d: number): Vec => ({ x: queen.x + way.x * d, y: queen.y + way.y * d });
      sim.command({ t: 'teleport', x: at(3.4).x, y: at(3.4).y });
      untilAim(sim);
      const body = cover === 'none' ? null : place(sim, at(1.8), cover === 'tough' ? 2 : 0, cover === 'barrel' ? BARREL : 'basic', 2);
      const hp = w.hero.hp, kills = w.stats.kills, events = ticks(sim, ticksOf(2.5));
      const hit = heroHits(events, 'queen-star');
      if (cover === 'none') assert(hit === 1 && w.hero.hp === hp - 1, `seed ${k}: open — −1 (${hit})`);
      else assert(hit === 0 && w.hero.hp === hp, `seed ${k}, ${cover}: the hero is whole`);
      if (cover === 'weak') assert(!alive(sim, body!) && w.stats.kills === kills && of(events, 'kill').some(e => e.enemyId === body!.id && !e.credited && e.source === 'queen-star'), `seed ${k}: the weak died, not the player's`);
      if (cover === 'tough') assert(alive(sim, body!) && body!.hp === 1, `seed ${k}: the tough lost 1 (2 → ${body!.hp})`);
      if (cover === 'barrel') assert(alive(sim, body!) && durabilityOf(body!) === 1 && of(events, 'shot').some(s => s.by === 'thing'), `seed ${k}: the barrel sheltered, whole`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('queen: the dash through the flying stars puts out those its path touches (task 57\'s rule: `snuffShots`) — the hero is not hit, the rest fly on to the walls (8 seeds)', () => {
  for (let k = 1; k <= 8; k++) {
    const sim = field(k, { queenMove: 0.01 }), w = sim.world;
    const queen = place(sim, { x: 10, y: 7 }, 2, QUEEN, 1);
    const d0 = 4 + (k % 3) * 0.3;
    sim.command({ t: 'teleport', x: queen.x + d0, y: queen.y });
    untilAim(sim);
    // The east star flies at the hero: when it is near, a chain back along its line (towards the queen).
    ticks(sim, ticksOf(3), [], x => (x.shots ?? []).some(s => s.kind === 'star' && s.hang === 0 && s.vx > 5 && x.hero.x - s.x < 1.4));
    const eastStar = w.shots!.find(s => s.kind === 'star' && s.vx > 5)!;
    const link = place(sim, { x: w.hero.x - 1.7, y: w.hero.y + 0.1 * (k % 2) }, 0, 'basic', 3);
    const hp = w.hero.hp;
    draw(sim, [link]);
    const events = release(sim);
    const snuffed = of(events, 'shot').filter(s => s.action === 'snuff' && s.by === 'dash').map(s => s.id);
    assert(snuffed.includes(eastStar.id) && w.hero.hp === hp, `seed ${k}: the dash put out the east star (${snuffed}), the hero is whole`);
    ticks(sim, ticksOf(4), events);
    assert(of(events, 'shot').filter(s => s.kind === 'star' && s.action === 'end').length === 8 - snuffed.length - (of(events, 'shot').filter(s => s.kind === 'star' && s.action === 'hit').length), `seed ${k}: the others flew on to an end`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the arena\'s shooters\' timer: the queen and the jester on one arena never begin their windups nearer than `volleyGap` (2.5 s) to each other; both shoot (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k, { queenMove: 0.01 }, 'guests-timer'), w = sim.world;
    // The jester off the queen's 8 lines (her stars hit the first body).
    place(sim, { x: 8, y: 7 }, 2, QUEEN, 1); place(sim, { x: 15, y: 4.2 }, 2, JESTER, 2);
    sim.command({ t: 'teleport', x: 12, y: 9 });
    const starts: { who: string; t: number }[] = [];
    for (let i = 0; i < ticksOf(24); i++) {
      for (const e of ticks(sim, 1)) if ((e.type === 'queen' || e.type === 'jester') && e.action === 'aim') starts.push({ who: e.type, t: w.time });
    }
    const gaps = starts.slice(1).map((s, i) => s.t - starts[i].t);
    assert(starts.filter(s => s.who === 'queen').length >= 2 && starts.filter(s => s.who === 'jester').length >= 2, `seed ${k}: both shoot (${starts.map(s => s.who)})`);
    assert(gaps.every(g => g >= 2.5 - 1e-6), `seed ${k}: the gaps ${gaps.map(g => g.toFixed(2))}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Дворецкий и Люстра ----

/** Ticks until the chandelier hangs. */
function untilHang(sim: Simulation): void {
  ticks(sim, ticksOf(5), [], x => !!x.chandelier);
  assert(sim.world.chandelier, 'the chandelier hangs');
}

check('butler: the chandelier hangs over the hero after the bow and floats after him at 3 u/s; «Капля воска» on the mark −1; the hero who walks out at the mark is whole (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    for (const walk of [false, true]) {
      const sim = field(k), w = sim.world;
      place(sim, { x: 12, y: 1.6 }, 1, BUTLER, 2);
      sim.command({ t: 'teleport', x: 12, y: 8 });
      const bow = ticks(sim, ticksOf(2.5), [], (_w, now) => now.some(e => e.type === 'chandelier' && e.action === 'bow'));
      assert(of(bow, 'chandelier').some(e => e.action === 'bow') && !w.chandelier, `seed ${k}: it bows first`);
      untilHang(sim);
      assert(dist(w.chandelier!, w.hero) < 1e-6, `seed ${k}: over the hero`);
      sim.command({ t: 'teleport', x: 12 + 5, y: 8 - 0.2 * k });
      const before = dist(w.chandelier!, w.hero);
      ticks(sim, ticksOf(1));
      assert(Math.abs(before - dist(w.chandelier!, w.hero) - 3) < 0.06, `seed ${k}: 3 u/s (${(before - dist(w.chandelier!, w.hero)).toFixed(3)})`);
      ticks(sim, ticksOf(3));
      // Under it again, then the next drop.
      const marks = ticks(sim, ticksOf(4), [], (_w, now) => now.some(e => e.type === 'chandelier' && e.action === 'drop' && e.stage === 'mark'));
      const mark = of(marks, 'chandelier').find(e => e.action === 'drop' && e.stage === 'mark')!;
      assert(mark, `seed ${k}: a drop`);
      if (walk) sim.command({ t: 'walk', x: k % 2 ? 1 : -1, y: 0 });
      const hp = w.hero.hp;
      const fell = ticks(sim, ticksOf(1), [], (_w, now) => now.some(e => e.type === 'chandelier' && e.action === 'drop' && e.stage === 'land'));
      sim.command({ t: 'walk', x: 0, y: 0 });
      const hits = heroHits(fell, WAX_SOURCE);
      if (walk) assert(hits === 0 && w.hero.hp === hp && dist(w.hero, mark) > 0.88, `seed ${k}: walked out — whole`);
      else assert(dist(w.hero, mark) <= 0.88 && hits === 1 && w.hero.hp === hp - 1, `seed ${k}: under the drop — −1 (${hits})`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('butler: a chain [weak, butler] kills it — the highlight\'s «упадёт» is where it falls (the chandelier stands while the dash runs; its own speed); 0.8 s later the weak in its circle die as the player\'s kills, the tough loses 1, the hero in it −2; killed by the rook\'s strike — the same fall, not the player\'s (6 seeds)', () => {
  for (let k = 1; k <= 6; k++) {
    for (const by of ['chain', 'rook'] as const) {
      // No newcomers (the rook's wait is long; they would stand under the chandelier that follows the hero).
      const sim = field(k, { maxEnemies: 0 }), w = sim.world;
      const butler = place(sim, { x: 7, y: 3 }, 1, BUTLER, 2);
      if (by === 'rook') place(sim, { x: 3, y: 3 }, 2, ROOK, 1);
      sim.command({ t: 'teleport', x: 13, y: 9 + 0.2 * (k % 2) });
      untilHang(sim);
      const kills = w.stats.kills, events: WorldEvent[] = [];
      let shown: { x: number; y: number } | null = null;
      if (by === 'chain') {
        // The hero 3.2 from the butler, a weak link half way: the dash runs ~0.2 s while the chandelier would follow him.
        const hx = butler.x + 3.2 * Math.cos(0.3 * k), hy = butler.y + 3.2 * Math.sin(0.3 * k);
        sim.command({ t: 'teleport', x: hx, y: hy });
        const weak = place(sim, { x: (hx + butler.x) / 2, y: (hy + butler.y) / 2 }, 0, 'basic', 2);
        draw(sim, [weak, butler]);
        const plan = planChain(w);
        assert(plan.chandelierFall && plan.chandelierFall.radius === 1, `seed ${k}: «упадёт» in the highlight`);
        shown = { x: plan.chandelierFall.x, y: plan.chandelierFall.y };
        release(sim, events);
      } else {
        // The hero by the rook's row: it strikes the row, the butler is its first body.
        sim.command({ t: 'teleport', x: 13, y: 4.6 });
        ticks(sim, ticksOf(6), events, x => !x.enemies.includes(butler));
        assert(!alive(sim, butler) && of(events, 'kill').some(e => e.enemyId === butler.id && e.source === 'rook-strike' && !e.credited), `seed ${k}: the rook killed it`);
      }
      const fall = of(events, 'chandelier').find(e => e.action === 'fall');
      assert(fall && w.chandelier?.fall, `seed ${k}, ${by}: the fall began`);
      if (shown) assert(Math.abs(shown.x - fall.x) < 1e-9 && Math.abs(shown.y - fall.y) < 1e-9, `seed ${k}: shown (${shown.x.toFixed(2)}; ${shown.y.toFixed(2)}), fell at (${fall.x.toFixed(2)}; ${fall.y.toFixed(2)})`);
      // The bodies under the falling chandelier (it stands now), the hero in its circle.
      const c = { x: fall.x, y: fall.y };
      const weak = [place(sim, { x: c.x + 0.6, y: c.y }, 0, 'basic', 1), place(sim, { x: c.x - 0.3, y: c.y + 0.7 }, 0, 'basic', 3)];
      const tough = place(sim, { x: c.x, y: c.y - 0.8 }, 2, 'basic', 0), outside = place(sim, { x: c.x + 2, y: c.y }, 0, 'basic', 1);
      sim.command({ t: 'teleport', x: c.x + 0.3, y: c.y + 0.2 });
      const before = w.stats.kills, hp = w.hero.hp, crash = ticks(sim, ticksOf(1), [], (_w, now) => now.some(e => e.type === 'chandelier' && e.action === 'crash'));
      const at = of(crash, 'chandelier').find(e => e.action === 'crash')!;
      assert(at && at.x === c.x && at.y === c.y, `seed ${k}, ${by}: it fell where the sign stood`);
      assert(!w.chandelier && weak.every(e => !alive(sim, e)) && alive(sim, outside) && tough.hp === 1 && alive(sim, tough), `seed ${k}, ${by}: the weak in the circle died, the tough lost 1`);
      assert(heroHits(crash, FALL_SOURCE) === 1 && w.hero.hp === hp - 2, `seed ${k}, ${by}: the hero in the circle −2`);
      const fallKills = of(crash, 'kill').filter(e => e.source === FALL_SOURCE);
      assert(fallKills.length === 2 && fallKills.every(e => e.credited === (by === 'chain')), `seed ${k}, ${by}: credited ${fallKills.map(e => e.credited)}`);
      assert(w.stats.kills === before + (by === 'chain' ? 2 : 0) && w.stats.kills - kills === (by === 'chain' ? 4 : 0), `seed ${k}, ${by}: kills ${w.stats.kills - kills}`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('butler: «Подрыв» at the chain\'s end kills it — the highlight shows «упадёт» and the chandelier falls there (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'guests-field', params: quiet({ eliteArmor: true }), seed: seedOf(k), record: true, loadout: { talismans: [FUSIONS.hunterBlast] } }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    const butler = place(sim, { x: 9.5, y: 8.9 + 0.05 * k }, 1, BUTLER, 2);
    sim.command({ t: 'teleport', x: 13, y: 11 });
    untilHang(sim);
    sim.command({ t: 'teleport', x: 5, y: 7 });
    const a = place(sim, { x: 6.5, y: 7 }, 0), b = place(sim, { x: 8, y: 7 }, 0);
    const eliteId = sim.command({ t: 'place', x: 9.5, y: 7, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    const elite = w.enemies.find(e => e.id === eliteId)!;
    draw(sim, [a, b, elite]);
    const plan = planChain(w);
    assert(plan.blast?.detonate && plan.blast.bodies.some(x => x.id === butler.id && x.killed) && !plan.links.some(l => l.link.id === butler.id), `seed ${k}: «Подрыв» kills the butler (${JSON.stringify(plan.blast?.bodies)})`);
    assert(plan.chandelierFall, `seed ${k}: «упадёт» in the highlight`);
    const events = release(sim);
    const fall = of(events, 'chandelier').find(e => e.action === 'fall');
    assert(!alive(sim, butler) && fall && fall.x === plan.chandelierFall.x && fall.y === plan.chandelierFall.y, `seed ${k}: it falls where shown`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('butler: frozen — the chandelier stands and its drop waits; one chandelier for the arena (a second butler does not hang its own)', () => {
  const sim = field(1), w = sim.world;
  const a = place(sim, { x: 6, y: 2 }, 1, BUTLER, 1), b = place(sim, { x: 18, y: 2 }, 1, BUTLER, 2);
  sim.command({ t: 'teleport', x: 12, y: 9 });
  const events = ticks(sim, ticksOf(6));
  assert(w.chandelier && of(events, 'chandelier').filter(e => e.action === 'hang').length === 1, 'one chandelier');
  const owner = w.chandelier.owner === a.id ? a : b;
  sim.command({ t: 'chill', id: owner.id, seconds: 3 });
  sim.command({ t: 'teleport', x: 15, y: 9 });
  const at = { x: w.chandelier.x, y: w.chandelier.y }, next = w.chandelier.next;
  ticks(sim, ticksOf(2));
  assert(w.chandelier.x === at.x && w.chandelier.y === at.y && w.chandelier.next === next, 'frozen: it stands, the drop waits');
  assert(replays(sim), 'replay');
});

// ---- Полтергейст ----

check('poltergeist: it lifts only light things (the barrels, not the wardrobe nor the candelabra); a lifted barrel — «в движении»; thrown, it stands in the mark with its durability 1 and a shove rolls it; the hero in the mark −2 (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = field(k, { poltergeistPeriod: 1 }), w = sim.world;
    place(sim, { x: 10, y: 7 }, 0, POLTERGEIST, 3);
    const wardrobe = place(sim, { x: 9, y: 7 }, 0, WARDROBE), candle = place(sim, { x: 11, y: 6 }, 0, CANDELABRA);
    const b1 = place(sim, { x: 10, y: 9.4 }, 0, BARREL), b2 = place(sim, { x: 7.2 - 0.1 * k, y: 7.8 }, 0, BARREL), far = place(sim, { x: 4, y: 3 }, 0, BARREL);
    sim.command({ t: 'teleport', x: 15, y: 7 + 0.2 * k });
    const lift = ticks(sim, ticksOf(3), [], (_w, now) => now.some(e => e.type === 'poltergeist' && e.action === 'lift'));
    const ev = of(lift, 'poltergeist').find(e => e.action === 'lift')!;
    assert(ev && JSON.stringify([...ev.things].sort()) === JSON.stringify([b1.id, b2.id].sort()), `seed ${k}: lifted ${ev?.things}`);
    assert(wardrobe.vars.lf === undefined && candle.vars.lf === undefined && far.vars.lf === undefined, `seed ${k}: only the light ones in reach`);
    assert(enemyRefusal(w, b1) === 'sliding', `seed ${k}: a lifted barrel — «в движении» (${enemyRefusal(w, b1)})`);
    const hp = w.hero.hp, events = ticks(sim, ticksOf(2.5));
    const lands = of(events, 'poltergeist').filter(e => e.action === 'land');
    assert(lands.length === 2 && heroHits(events, THROW_SOURCE) === 2 && w.hero.hp === hp - 4, `seed ${k}: two throws hit the hero (${heroHits(events, THROW_SOURCE)})`);
    for (const b of [b1, b2]) {
      const land = lands.find(e => e.things[0] === b.id)!;
      assert(alive(sim, b) && b.vars.lf === undefined && durabilityOf(b) === 1 && Math.abs(b.x - land.x) < 1e-9, `seed ${k}: the barrel stands in its mark, durability 1`);
    }
    // A shove rolls the thrown barrel (a chain that ends on it).
    const b = b1, from = { x: b.x, y: b.y };
    sim.command({ t: 'teleport', x: b.x - 1.4, y: b.y });
    draw(sim, [b]);
    assert(planChain(w).shove?.thing === b.id, `seed ${k}: the chain ends on it`);
    release(sim);
    assert(!alive(sim, b) || dist(b, from) > 0.5, `seed ${k}: the shove rolled it`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('poltergeist: its death while it lifts — the things drop where they stood at once, the weak under them die (the player\'s: the chain killed it) (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k, { poltergeistPeriod: 1, poltergeistLift: 2 });
    const polter = place(sim, { x: 10, y: 7 }, 0, POLTERGEIST, 3);
    const b1 = place(sim, { x: 11.6, y: 8.2 }, 0, BARREL);
    sim.command({ t: 'teleport', x: 15, y: 7 });
    ticks(sim, ticksOf(3), [], () => b1.vars.lf !== undefined);
    assert(b1.vars.lf === polter.id, `seed ${k}: lifted`);
    const under = place(sim, { x: b1.x + 0.05 * k, y: b1.y }, 0, 'basic', 1);
    const at = { x: b1.x, y: b1.y };
    sim.command({ t: 'teleport', x: polter.x + 1.3, y: polter.y - 0.5 });
    draw(sim, [polter]);
    const events = release(sim);
    assert(!alive(sim, polter) && b1.vars.lf === undefined && b1.x === at.x && b1.y === at.y && of(events, 'poltergeist').some(e => e.action === 'drop'), `seed ${k}: dropped in place`);
    assert(!alive(sim, under) && of(events, 'kill').some(e => e.enemyId === under.id && e.credited), `seed ${k}: the weak under it died, the player's`);
    assert(!of(events, 'poltergeist').some(e => e.action === 'throw'), `seed ${k}: no throw`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Шут ----

/** Ticks until the jester's ball flies within `near` of the hero (not reflected). */
function untilBallNear(sim: Simulation, near: number): void {
  ticks(sim, ticksOf(8), [], x => (x.shots ?? []).some(s => s.kind === 'ball' && !s.back && dist(s, x.hero) < near));
}

check('jester: a chain through the ball reflects it (the highlight = the result); two reflected are caught (the throws speed up 3 → 4 → 5), the third strikes it −1 (the player\'s) and stuns it 2 s (5 seeds)', () => {
  for (let k = 1; k <= 5; k++) {
    const sim = field(k), w = sim.world;
    const jester = place(sim, { x: 7, y: 7 }, 2, JESTER, 2);
    const home = { x: 12.5, y: 7 + 0.25 * (k % 3) };
    sim.command({ t: 'teleport', x: home.x, y: home.y });
    const speeds: number[] = [], all: WorldEvent[] = [];
    const outcome = (ball: number): 'catch' | 'miss' | null => {
      const i = all.findIndex(e => e.type === 'jester' && e.action === 'reflect' && e.ball === ball);
      const next = i < 0 ? undefined : of(all.slice(i), 'jester').find(e => e.action === 'catch' || e.action === 'miss');
      return next ? next.action as 'catch' | 'miss' : null;
    };
    for (let round = 0; round < 3; round++) {
      // Back at his place each round (the dash carried him towards the jester).
      sim.command({ t: 'teleport', x: home.x, y: home.y });
      untilBallNear(sim, 1.3);
      const ball = w.shots!.find(s => s.kind === 'ball')!;
      assert(ball, `seed ${k}: a ball (round ${round})`);
      speeds.push(Math.round(Math.hypot(ball.vx, ball.vy) * 1000) / 1000);
      const d = dist(ball, w.hero), dx = (ball.x - w.hero.x) / d, dy = (ball.y - w.hero.y) / d;
      const link = place(sim, { x: w.hero.x + dx * 1.75, y: w.hero.y + dy * 1.75 }, 0, 'basic', round % 4);
      draw(sim, [link]);
      const plan = planChain(w);
      assert(plan.reflects?.length === 1 && plan.reflects[0].ball === ball.id && plan.reflects[0].miss === (round === 2), `seed ${k}, round ${round}: the highlight ${JSON.stringify(plan.reflects)}`);
      const hp = jester.hp;
      release(sim, all);
      assert(of(all, 'jester').some(e => e.action === 'reflect' && e.ball === ball.id), `seed ${k}, round ${round}: reflected`);
      if (!outcome(ball.id)) ticks(sim, ticksOf(3), all, () => !!outcome(ball.id));
      if (round < 2) assert(outcome(ball.id) === 'catch' && jester.hp === hp, `seed ${k}, round ${round}: caught`);
      else assert(outcome(ball.id) === 'miss' && jester.hp === hp - 1 && jesterStunned(jester) && of(all, 'kill').every(e => e.enemyId !== jester.id), `seed ${k}: the miss — −1, stunned`);
    }
    assert(JSON.stringify(speeds) === JSON.stringify([3, 4, 5]), `seed ${k}: the speeds ${speeds}`);
    assert(of(all, 'enemyHit').some(e => e.enemyId === jester.id && e.source === REFLECT_SOURCE), `seed ${k}: the reflected ball's hit`);
    const stunAt = [...all].reverse().findIndex(e => e.type === 'jester' && e.action === 'stun');
    assert(stunAt >= 0, `seed ${k}: stunned`);
    // The stun lasts 2 s from the miss: count from now what is left of it.
    const left = jester.vars.jt, stun: WorldEvent[] = [];
    ticks(sim, ticksOf(left) - 2, stun);
    assert(jesterStunned(jester) && !of(stun, 'jester').some(e => e.action === 'aim' || e.action === 'throw'), `seed ${k}: it throws nothing stunned`);
    ticks(sim, 4);
    assert(!jesterStunned(jester), `seed ${k}: the stun is over after 2 s`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('jester: the ball flies through enemies; a thing on its way puts it out (whole); a frozen jester does not catch — the reflected ball is its miss', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    const jester = place(sim, { x: 6, y: 7 }, 2, JESTER, 2);
    sim.command({ t: 'teleport', x: 12, y: 7 });
    const weak = place(sim, { x: 9, y: 7 }, 0, 'basic', 1);
    ticks(sim, ticksOf(6), [], x => !!x.shots?.length && x.shots.some(s => s.kind === 'ball' && s.x > 9.6));
    assert(alive(sim, weak) && w.shots?.some(s => s.kind === 'ball'), `seed ${k}: through the enemy`);
    // A barrel between: the next ball goes out on it.
    const barrel = place(sim, { x: 10.6, y: 7 }, 0, BARREL);
    const out = ticks(sim, ticksOf(10), [], (_w, now) => now.some(e => e.type === 'shot' && e.kind === 'ball' && e.by === 'thing'));
    assert(of(out, 'shot').some(e => e.kind === 'ball' && e.by === 'thing') && alive(sim, barrel) && durabilityOf(barrel) === 1, `seed ${k}: the barrel put it out`);
    sim.command({ t: 'teleport', x: 12, y: 9.5 });
    untilBallNear(sim, 1.3);
    const ball = w.shots!.find(s => s.kind === 'ball')!, d = dist(ball, w.hero);
    const link = place(sim, { x: w.hero.x + (ball.x - w.hero.x) / d * 1.75, y: w.hero.y + (ball.y - w.hero.y) / d * 1.75 }, 0, 'basic', 3);
    sim.command({ t: 'chill', id: jester.id, seconds: 4 });
    draw(sim, [link]);
    assert(planChain(w).reflects?.[0]?.miss === true, `seed ${k}: frozen — the highlight shows the miss`);
    const hp = jester.hp, back = release(sim);
    ticks(sim, ticksOf(3), back, (_w, now) => now.some(e => e.type === 'jester' && (e.action === 'catch' || e.action === 'miss')));
    assert(of(back, 'jester').some(e => e.action === 'miss') && jester.hp === hp - 1, `seed ${k}: frozen — the miss`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('jester: the pass that freezes him («Наледь» along its path) — the highlight shows the miss and he misses (−1, «оглушён»); without «Наледь» the same pass is a catch (4 seeds)', () => {
  for (let k = 1; k <= 4; k++) {
    for (const frost of [true, false]) {
      const sim = new Simulation({ arena: 'guests-field', params: quiet(), seed: seedOf(k), record: true, loadout: { talismans: frost ? [FROST_PASS] : [] } }), w = sim.world;
      sim.command({ t: 'clear', keepMarked: false });
      const jester = place(sim, { x: 7, y: 7.15 }, 2, JESTER, 2);
      sim.command({ t: 'teleport', x: 12.5, y: 7 });
      untilBallNear(sim, 1.3);
      const ball = w.shots!.find(s => s.kind === 'ball')!;
      // The pass runs by the jester (0.15 aside): «Наледь» lays a frost point next to him.
      const links = [place(sim, { x: 10.75, y: 7.05 }, 0), place(sim, { x: 9.2, y: 7 }, 0), place(sim, { x: 7.65, y: 7 - 0.02 * k }, 0), place(sim, { x: 6, y: 7 }, 0)];
      draw(sim, links);
      const plan = planChain(w);
      assert(plan.reflects?.length === 1 && plan.reflects[0].ball === ball.id && plan.reflects[0].miss === frost && !jesterStunned(jester) && !jester.chill, `seed ${k}, frost ${frost}: the highlight ${JSON.stringify(plan.reflects)}`);
      const hp = jester.hp, events = release(sim);
      ticks(sim, ticksOf(3), events, () => of(events, 'jester').some(e => e.action === 'catch' || e.action === 'miss'));
      const outcome = of(events, 'jester').find(e => e.action === 'catch' || e.action === 'miss')!;
      assert(outcome && outcome.action === (frost ? 'miss' : 'catch') && jester.hp === hp - (frost ? 1 : 0), `seed ${k}, frost ${frost}: ${outcome?.action}`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('jester: a pass that kills him reflects nothing — no return line in the highlight, his ball flies on; one that leaves him alive reflects it (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    for (const hp of [0, 9]) {
      const sim = field(k), w = sim.world;
      const jester = place(sim, { x: 9.5, y: 7 }, hp, JESTER, 2);
      sim.command({ t: 'teleport', x: 12.5, y: 7 + 0.1 * k });
      untilBallNear(sim, 1.3);
      const ball = w.shots!.find(s => s.kind === 'ball')!, d = dist(ball, w.hero);
      const link = place(sim, { x: w.hero.x + (ball.x - w.hero.x) / d * 1.75, y: w.hero.y + (ball.y - w.hero.y) / d * 1.75 }, 0, 'basic', 2);
      draw(sim, [link, jester]);
      const plan = planChain(w);
      const killed = plan.links.some(l => l.link.id === jester.id && l.outcome?.killed);
      assert(killed === (hp === 0), `seed ${k}, hp ${hp}: the pass ${killed ? 'kills' : 'spares'} him`);
      assert(hp === 0 ? !plan.reflects : plan.reflects?.[0]?.ball === ball.id, `seed ${k}, hp ${hp}: the highlight ${JSON.stringify(plan.reflects)}`);
      const events = release(sim);
      assert(of(events, 'jester').some(e => e.action === 'reflect') === (hp !== 0), `seed ${k}, hp ${hp}: reflected as shown`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('poltergeist: its lift during a dash leaves the barrel of the dash\'s fixed shove alone — the shove runs as planned; it lifts another (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k, { poltergeistPeriod: 1 }), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    // Off the barrel's lane (it rolls east and would crush it).
    place(sim, { x: 10, y: 4.6 }, 0, POLTERGEIST, 3);
    const a = place(sim, { x: 4.6, y: 7 }, 0), b = place(sim, { x: 6.2, y: 7 }, 0), barrel = place(sim, { x: 7.8, y: 7 }, 0, BARREL), other = place(sim, { x: 11.5, y: 5.4 - 0.1 * k }, 0, BARREL);
    // Its rest ends (1 s) after the hero reached the barrel (~0.35 s into the dash) and before the dash's end (the way back to b).
    ticks(sim, ticksOf(0.6));
    draw(sim, [a, b, barrel]);
    const plan = planChain(w).shove!;
    assert(plan.thing === barrel.id, `seed ${k}: the chain ends on the barrel`);
    assert(sim.command({ t: 'release' }), 'released');
    let liftedInDash = false, lifts = 0;
    for (let i = 0; i < ticksOf(3) && (w.move || w.shoves || i < 2); i++) {
      for (const e of ticks(sim, 1)) if (e.type === 'poltergeist' && e.action === 'lift') lifts++;
      if (barrel.vars.lf !== undefined) liftedInDash = true;
    }
    assert(lifts >= 1 && !liftedInDash && other.vars.lf !== undefined, `seed ${k}: the shoved barrel stayed down, the other one lifted`);
    assert(!alive(sim, barrel) || dist(barrel, { x: 7.8, y: 7 }) > 0.5, `seed ${k}: the shove ran`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Determinism, the arenas ----

check('a journal of a guests\' arena without the new keys plays the same world (worldState without params), several seeds; a world without a guest has no new field', () => {
  for (const arena of GUEST_ARENAS) {
    for (const k of [1, 2]) {
      const sim = new Simulation({ arena: arena.id, params: defaultParams(), seed: seedOf(k), record: true }), w = sim.world;
      for (let i = 0; i < ticksOf(14); i++) {
        if (i % 90 === 45 && !w.move) {
          const first = w.enemies.filter(e => e.kind === 'basic').sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
          if (first) { sim.command({ t: 'teleport', x: first.x + 1, y: first.y + 0.5 }); sim.command({ t: 'begin', x: first.x, y: first.y }); sim.command({ t: 'release' }); }
        }
        sim.tick();
        if (w.status !== 'playing') break;
      }
      const journal = sim.exportJournal()!, stripped = JSON.parse(JSON.stringify(journal));
      for (const key of GUEST_KEYS) delete stripped.params[key];
      const a = replay(JSON.parse(JSON.stringify(journal))), b = replay(stripped);
      assert(a.hash() === sim.hash(), `${arena.id}, seed ${k}: replay`);
      const strip = (x: Simulation): string => { const s = worldState(x.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
      assert(strip(a) === strip(b), `${arena.id}, seed ${k}: the journal without the keys differs`);
    }
  }
  assert(GUEST_KEYS.length === 38, `the keys of spec 11: ${GUEST_KEYS.length}`);
  const plain = new Simulation({ arena: 'c-hall', params: defaultParams(), seed: seedOf(1) });
  for (let i = 0; i < 600; i++) plain.tick();
  assert(!('chandelier' in (worldState(plain.world) as object)), 'no chandelier field without a butler');
});

check('the arenas: the probes stand one guest each with the crowd; «Столовая» — the spec\'s layout (two candelabras at the table\'s ends, the butler north, two barrels, 8 enemies of colours 0–3); each plays the castle\'s laws and the layer of shots', () => {
  const kinds = (id: string): string[] => GUEST_ARENAS.find(a => a.id === id)!.enemies.map(e => e.kind ?? 'basic');
  for (const [id, guest] of [['c-probe-candelabra', CANDELABRA], ['c-probe-queen', QUEEN], ['c-probe-butler', BUTLER], ['c-probe-poltergeist', POLTERGEIST], ['c-probe-jester', JESTER]] as const) {
    const ks = kinds(id);
    assert(ks.filter(x => x === guest).length === 1 && ks.filter(x => x === 'basic').length === 8, `${id}: ${ks}`);
  }
  const dining = GUEST_ARENAS.find(a => a.id === 'c-dining')!, dk = kinds('c-dining');
  assert(dining.width === 18 && dining.height === 11 && dining.killGoal === 25 && dk.filter(x => x === CANDELABRA).length === 2 && dk.filter(x => x === BUTLER).length === 1 && dk.filter(x => x === BARREL).length === 2 && dk.filter(x => x === 'basic').length === 8, `c-dining: ${dk}`);
  for (const a of GUEST_ARENAS) {
    const sim = new Simulation({ arena: a.id, params: defaultParams(), seed: 1 });
    assert(sim.world.params.shove && sim.world.params.snuffShots && sim.world.params.volleyGap === 2.5, `${a.id}: the laws on`);
    // The shove's lane of a candelabra on «Столовая» along the table's edge stays in the hall.
    if (a.id === 'c-dining') {
      const c = sim.world.enemies.find(e => e.kind === CANDELABRA)!;
      const plan = shovePath(sim.world, c, { x: 1, y: 0 });
      assert(plan.topple && plan.topple.to.x <= 5 + 1e-6, `c-dining: the table cuts the lane (${plan.topple?.to.x})`);
    }
  }
});

console.log(`castle guests: ${checks} checks passed`);
