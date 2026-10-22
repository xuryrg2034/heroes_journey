/**
 * Task 55 §23 «Колдун v1» (sim/enemies/warlock.ts; docs/realtime-elite-behaviors.md, «Колдун v1»; spec
 * docs/design-notes/task-55-castle-step1a.md, 23.10). Node only: `npm run test:realtime-warlock-v1`.
 *
 * Checks play journalled commands (teleport, walk, begin / drag / release / cancel, place) on «Зал колдуна» (`c-warlock`) and look at what
 * the player meets: the fan of orbs hurts a standing hero and misses one who left its lines; a chain through an orb volley of one colour
 * into his window strikes him as the highlight said; an orb link stands while the chain is drawn; the rug pulls the hero 1.5 towards
 * him, the things stay, a link beyond the reach drops in the highlight and the run alike; «Перенос к герою» — the rune behind his step,
 * the flash in its ring, then the window; the worst point «he stepped towards the rune»; the formation call — 4 of one colour, at most
 * 2 formations; phase 3 at 2 plates with the ring of 8; values without `warlockV1` — Колдун v0, the hash of the build before it.
 * Seeds `Math.imul(k, 2654435761) >>> 0`; every fight replays to its hash.
 */
import { WARLOCK_ARENA } from './arenasCastle';
import { BARREL, WARDROBE } from './enemies/castle';
import {
  BLINK_RADIUS, FLASH_RADIUS, ORB_DAMAGE, ORB_FAN, ORB_RING, RUG_PULL, SUMMON_SIZE, WARLOCK, WARLOCK_ORB, onRug, warlockState, warlockV1State,
} from './enemies/warlock';
import { type Vec } from './geometry';
import { enemyRefusal, planChain } from './chain';
import { defaultParams, heroRadius, type Params } from './params';
import { durabilityOf } from './shove';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const SEEDS = [1, 2, 3];
/** Moves off: no fan, rug or call unless a check turns its own on (the phase-1 call stays on its 15th s). */
const CALM: Partial<Params> = { warlockOrbPeriod: 1e6, warlockRugPeriod: 1e6, warlockSummonPeriod: 1e6 };

/** Nothing comes, nobody walks; the hero has 999 HP and no grace window to blur the count. The panel's `warlockV1` off — the hall puts v1 on. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.shoveDistance = 6;
  return Object.assign(p, extra);
}
interface Hall { sim: Simulation; w: World; core: Enemy; wardrobe: Enemy }
function hall(k: number, extra: Partial<Params> = {}, at: Vec = { x: 12, y: 14 }): Hall {
  const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(extra), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: at.x, y: at.y });
  ticks(sim, 1);
  return { sim, w, core: w.enemies.find(e => e.kind === WARLOCK)!, wardrobe: w.enemies.find(e => e.kind === WARDROBE)! };
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (until(sim.world, events)) break;
  }
  return out;
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(4), out, w => !w.move && !w.shoves);
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const moved = (events: readonly WorldEvent[], move: string, stage: 'start' | 'hit'): boolean => events.some(e => e.type === 'bossMove' && e.move === move && e.stage === stage);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const plates = (e: Enemy): number => e.armor?.plates ?? 0;
const orbs = (w: World): Enemy[] => w.enemies.filter(e => e.kind === WARLOCK_ORB);
/** A chain of one link shoves `thing` at `target` from 1 back. */
function shoveAt(h: Hall, thing: Enemy, target: Vec, out: WorldEvent[] = []): void {
  const d = dist(thing, target), at = { x: thing.x - (target.x - thing.x) / d, y: thing.y - (target.y - thing.y) / d };
  h.sim.command({ t: 'teleport', x: at.x, y: at.y });
  draw(h.sim, [{ x: thing.x, y: thing.y }]);
  assert(planChain(h.w).shove?.thing === thing.id, `a shove of ${thing.kind} planned`);
  release(h.sim, out);
}
/** Phase 2: his wardrobe broken at the north wall (two shoves), then the hero back at `at`. */
function phase2(h: Hall, at: Vec = { x: 12, y: 14 }, out: WorldEvent[] = []): void {
  const north = { x: h.wardrobe.x, y: -10 };
  shoveAt(h, h.wardrobe, north, out);
  assert(durabilityOf(h.wardrobe) === 1, 'the wall wore it');
  shoveAt(h, h.wardrobe, north, out);
  ticks(h.sim, 2, out);
  assert(!h.w.enemies.includes(h.wardrobe) && warlockState(h.w)!.phase === 2, `phase 2 (${warlockState(h.w)!.phase})`);
  h.sim.command({ t: 'teleport', x: at.x, y: at.y });
}
/** Ticks until `pred` (at most `seconds`); true — it came. */
function until(h: Hall, seconds: number, pred: (w: World, events: readonly WorldEvent[]) => boolean, out: WorldEvent[] = []): boolean {
  let hit = false;
  ticks(h.sim, ticksOf(seconds), out, (w, ev) => (hit = pred(w, ev)));
  return hit;
}
/** The distance of `p` from the line through (x0, y0) — (x1, y1). */
function offLine(l: { x0: number; y0: number; x1: number; y1: number }, p: Vec): number {
  const dx = l.x1 - l.x0, dy = l.y1 - l.y0, len = Math.sqrt(dx * dx + dy * dy);
  return Math.abs((p.x - l.x0) * dy - (p.y - l.y0) * dx) / len;
}

check('the hall: the panel\'s values (off) — v1 on; values without the key keep it absent (Колдун v0: no orb, rug, blink or call in 40 s); the run\'s fights without the flag carry no key', () => {
  for (const k of SEEDS) {
    const h = hall(k);
    assert(h.w.params.warlockV1 === true && warlockV1State(h.w) !== null, `seed ${k}: v1 on`);
    const p = quiet();
    delete (p as Partial<Params>).warlockV1;
    const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: p, seed: seedOf(k), record: true });
    assert(!('warlockV1' in sim.world.params) && warlockV1State(sim.world) === null, `seed ${k}: no key — v0`);
    const events: WorldEvent[] = [];
    for (let i = 0; i < ticksOf(40); i++) { sim.tick(); events.push(...sim.world.events.splice(0)); }
    assert(!events.some(e => e.type === 'bossMove' || (e.type === 'warlockShift' && e.candle < 0)) && !sim.world.enemies.some(e => e.kind === WARLOCK_ORB), `seed ${k}: v0 moves only`);
  }
});

check('«Цветные шары», a fan of 3 of one colour: the middle line through the standing hero — one orb hits him −2 (source `warlock-orb`) and goes out; the lines are fixed at the windup\'s start; a hero who stepped off the lines takes nothing; the colours vary with the seed', () => {
  const colors = new Set<number>();
  for (const k of SEEDS) {
    for (const leave of [false, true]) {
      const h = hall(k, { warlockOrbPeriod: 5, warlockSummonPeriod: 1e6 }, { x: 12, y: 8 }), events: WorldEvent[] = [];
      assert(until(h, 20, (_w, ev) => moved(ev, 'orbs', 'start'), events), `seed ${k}: a volley began`);
      const st = warlockV1State(h.w)!.orbs!, mid = st.lines[0], at = { x: h.w.hero.x, y: h.w.hero.y };
      assert(st.lines.length === ORB_FAN && !st.ring && offLine(mid, at) < 1e-6, `seed ${k}: three lines, the middle through the hero (${offLine(mid, at)})`);
      if (leave) {
        // Sideways off the middle line for 0.3 s (1.2 units: out of its reach 0.47, short of a side line), away from his wardrobe.
        const dx = mid.x1 - mid.x0, dy = mid.y1 - mid.y0, len = Math.sqrt(dx * dx + dy * dy), ward = h.wardrobe;
        const sx = -dy / len, sy = dx / len, sign = (at.x - ward.x) * sx + (at.y - ward.y) * sy >= 0 ? 1 : -1;
        h.sim.command({ t: 'walk', x: sx * sign, y: sy * sign });
        ticks(h.sim, ticksOf(0.3), events);
        h.sim.command({ t: 'walk', x: 0, y: 0 });
      }
      const hp = h.w.hero.hp;
      ticks(h.sim, ticksOf(4), events, w => !orbs(w).length && !warlockV1State(w)!.orbs);
      const hits = of(events, 'hit').filter(e => e.source === 'warlock-orb');
      if (leave) assert(!hits.length, `seed ${k}: the hero who left takes nothing (${hits.length}; ${JSON.stringify(of(events, 'hit').map(e => e.source))})`);
      else {
        assert(hits.length === 1 && hits[0].damage === ORB_DAMAGE && h.w.hero.hp === hp - ORB_DAMAGE, `seed ${k}: one orb hits −2 (${hits.length}, ${hp - h.w.hero.hp})`);
        assert(of(events, 'warlockOrb').some(e => e.why === 'touch'), `seed ${k}: it went out at the touch`);
      }
      colors.add(st.color);
      assert(replays(h.sim), `seed ${k}: replay`);
    }
  }
  assert(colors.size >= 2, `the volleys' colours vary: ${[...colors]}`);
});

check('a chain through the volley\'s 3 orbs of one colour into his window: the highlight — 3 kills and his plate; the run does exactly that (the orbs\' kills are the player\'s)', () => {
  let seen = 0;
  for (let k = 1; k <= 12 && seen < 3; k++) {
    const h = hall(k, { warlockOrbPeriod: 0.5, warlockRugPeriod: 1e6, warlockSummonPeriod: 1e6 });
    // In sight of every candle, farther than 3 from each.
    phase2(h, { x: 12, y: 6.5 });
    // A fan that leaves while his window is open (the hero > 3 from him, in sight).
    const events: WorldEvent[] = [];
    const ok = until(h, 30, (w, ev) => moved(ev, 'orbs', 'hit') && !!warlockState(w)!.window?.open && orbs(w).length === ORB_FAN, events);
    if (!ok) continue;
    ticks(h.sim, ticksOf(0.2));
    const core = h.core, fan = orbs(h.w);
    if (!warlockState(h.w)!.window?.open || fan.length !== ORB_FAN || new Set(fan.map(o => o.color)).size !== 1) continue;
    // The hero on the middle line, 3.5 from him; the orbs from one side to the other, then the core.
    const mid = fan.reduce((a, b) => (dist(a, h.w.hero) < dist(b, h.w.hero) ? a : b));
    const ux = (mid.x - core.x) / dist(mid, core), uy = (mid.y - core.y) / dist(mid, core);
    h.sim.command({ t: 'teleport', x: core.x + ux * 3.5, y: core.y + uy * 3.5 });
    const side = (o: Enemy): number => (o.x - core.x) * -uy + (o.y - core.y) * ux;
    const order = [...fan].sort((a, b) => side(a) - side(b));
    draw(h.sim, [...order, core]);
    if (h.w.chain.length !== 4) continue;
    const plan = planChain(h.w);
    const before = plates(core), killed = plan.links.filter(l => l.outcome?.killed).map(l => l.link.id);
    assert(killed.length === 3 && order.every(o => killed.includes(o.id)) && plan.links[3].outcome?.plate === true, `seed ${k}: the highlight ${JSON.stringify(plan.links.map(l => l.outcome))}`);
    const after = release(h.sim);
    assert(order.every(o => !h.w.enemies.includes(o)) && plates(core) === before - 1 && of(after, 'warlockWindow').some(e => e.action === 'hit'), `seed ${k}: the run (${plates(core)})`);
    assert(of(after, 'kill').filter(e => order.some(o => o.id === e.enemyId)).every(e => e.credited), `seed ${k}: the orbs\' kills are the player\'s`);
    assert(replays(h.sim), `seed ${k}: replay`);
    seen++;
  }
  assert(seen >= 3, `seeds with the chain through a volley: ${seen}`);
});

check('an orb link stands while the chain is drawn (its clock waits, it touches nobody); let go — it flies on', () => {
  for (const k of SEEDS) {
    const h = hall(k, { warlockOrbPeriod: 5, warlockSummonPeriod: 1e6 }, { x: 12, y: 8 });
    assert(until(h, 20, (_w, ev) => moved(ev, 'orbs', 'hit')), `seed ${k}: a volley left`);
    ticks(h.sim, ticksOf(0.15));
    const orb = orbs(h.w).reduce((a, b) => (dist(a, h.w.hero) < dist(b, h.w.hero) ? a : b));
    const near = { x: orb.x + (h.w.hero.x - orb.x) / dist(orb, h.w.hero) * 1.2, y: orb.y + (h.w.hero.y - orb.y) / dist(orb, h.w.hero) * 1.2 };
    h.sim.command({ t: 'teleport', x: near.x, y: near.y });
    draw(h.sim, [orb]);
    assert(h.w.chain.length === 1, `seed ${k}: the orb linked`);
    const at = { x: orb.x, y: orb.y }, life = orb.vars.ol;
    ticks(h.sim, ticksOf(1));
    assert(h.w.enemies.includes(orb) && dist(orb, at) < 1e-9 && orb.vars.ol === life, `seed ${k}: it stood (${dist(orb, at)})`);
    h.sim.command({ t: 'cancel' });
    ticks(h.sim, 3);
    assert(!h.w.enemies.includes(orb) || dist(orb, at) > 0.1, `seed ${k}: it flies on`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

/** The middle of the western rug. */
const RUG_W = (() => { const r = WARLOCK_ARENA.warlock!.rugs![0]; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; })();

check('«Ковёр дёргает» (phase 2, the hero on the rug at the windup\'s start): after 1 s the hero and an enemy on the rug slide 1.5 towards his centre; a barrel on it stays; no damage', () => {
  for (const k of SEEDS) {
    const h = hall(k, { ...CALM, warlockRugPeriod: 1 });
    phase2(h, { x: 12, y: 14 });
    h.sim.command({ t: 'teleport', x: RUG_W.x, y: RUG_W.y });
    // An enemy on the rug east of the hero; a barrel on its south-west corner, off his ways towards the candles.
    const id = h.sim.command({ t: 'place', x: RUG_W.x + 1.5, y: RUG_W.y - 0.6, color: 1, hp: 0, kind: 'basic' }) as number, foe = h.w.enemies.find(e => e.id === id)!;
    const bid = h.sim.command({ t: 'place', x: RUG_W.x - 2, y: RUG_W.y + 0.7, color: 0, hp: 0, kind: BARREL }) as number, barrel = h.w.enemies.find(e => e.id === bid)!;
    assert(onRug(h.w, foe) && onRug(h.w, barrel), 'both on the rug');
    const events: WorldEvent[] = [];
    assert(until(h, 20, (_w, ev) => moved(ev, 'rug', 'start'), events), `seed ${k}: the rug began`);
    const hero0 = { x: h.w.hero.x, y: h.w.hero.y }, foe0 = { x: foe.x, y: foe.y }, b0 = { x: barrel.x, y: barrel.y }, hp = h.w.hero.hp;
    const st = warlockV1State(h.w)!;
    assert(st.rug.windup !== null && !st.rug.sliding, `seed ${k}: the windup shows`);
    assert(until(h, 2, w => !!warlockV1State(w)!.rug.sliding, events), `seed ${k}: it slides`);
    const core = { x: h.core.x, y: h.core.y };
    until(h, 1, w => !warlockV1State(w)!.rug.sliding, events);
    const toward = (a: Vec, b: Vec): number => ((b.x - a.x) * (core.x - a.x) + (b.y - a.y) * (core.y - a.y)) / dist(a, core);
    assert(Math.abs(dist(hero0, h.w.hero) - RUG_PULL) < 0.02 && Math.abs(toward(hero0, h.w.hero) - RUG_PULL) < 0.02, `seed ${k}: the hero slid ${dist(hero0, h.w.hero).toFixed(3)} towards him`);
    assert(toward(foe0, foe) > RUG_PULL - 0.1, `seed ${k}: the enemy slid towards him (${toward(foe0, foe).toFixed(3)})`);
    assert(dist(b0, barrel) < 1e-9 && h.w.hero.hp === hp, `seed ${k}: the barrel stays, no damage`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('the rug pulls the drawing hero: the link pulled with him stays, the one left beyond the reach drops (refusal `far`) — the highlight shows it in that tick and the run kills only what it shows', () => {
  for (const k of SEEDS) {
    const h = hall(k, { ...CALM, warlockRugPeriod: 1 });
    phase2(h, { x: 12, y: 14 });
    h.sim.command({ t: 'teleport', x: RUG_W.x, y: RUG_W.y });
    assert(until(h, 20, (_w, ev) => moved(ev, 'rug', 'start')), `seed ${k}: the rug began`);
    const core = { x: h.core.x, y: h.core.y }, hero = h.w.hero, d = dist(hero, core), ux = (core.x - hero.x) / d, uy = (core.y - hero.y) / d;
    // E1 on the rug by the hero (it slides too); E2 off the rug, behind E1 away from him — near the reach's end.
    const e1p = { x: hero.x - ux * 0.9, y: hero.y - uy * 0.9 };
    let e2p: Vec | null = null;
    for (let a = 0; a <= Math.PI / 2 && !e2p; a += Math.PI / 36) for (const s of [1, -1]) {
      const c = Math.cos(a * s), sn = Math.sin(a * s), bx = -(ux * c - uy * sn), by = -(ux * sn + uy * c), q = { x: e1p.x + bx * 1.95, y: e1p.y + by * 1.95 };
      if (!e2p && !onRug(h.w, q) && q.y < 14.5 && q.x > 0.5) e2p = q;
    }
    assert(e2p && onRug(h.w, e1p), `seed ${k}: places for the links`);
    const id1 = h.sim.command({ t: 'place', x: e1p.x, y: e1p.y, color: 2, hp: 0, kind: 'basic' }) as number, e1 = h.w.enemies.find(e => e.id === id1)!;
    const id2 = h.sim.command({ t: 'place', x: e2p.x, y: e2p.y, color: 2, hp: 0, kind: 'basic' }) as number, e2 = h.w.enemies.find(e => e.id === id2)!;
    draw(h.sim, [e1, e2]);
    assert(h.w.chain.length === 2 && planChain(h.w).links.length === 2, `seed ${k}: two links drawn (${h.w.chain.length})`);
    const events: WorldEvent[] = [];
    let planned = -1;
    ticks(h.sim, ticksOf(2), events, (w, ev) => { const u = ev.find(e => e.type === 'warlockRug'); if (u) planned = planChain(w).links.length; return !!u; });
    const drop = of(events, 'warlockRug')[0];
    assert(drop && drop.dropped.length === 1 && drop.dropped[0] === e2.id && drop.refusal === 'far', `seed ${k}: E2 dropped (${JSON.stringify(drop)})`);
    assert(planned === 1 && (h.w.chain.length as number) === 1 && h.w.chain[0].id === e1.id, `seed ${k}: the highlight in that tick — one link (${planned})`);
    until(h, 1, w => !warlockV1State(w)!.rug.sliding);
    const plan = planChain(h.w);
    assert(plan.links.length === 1 && plan.links[0].outcome?.killed, `seed ${k}: the plan kills E1 only`);
    release(h.sim);
    assert(!h.w.enemies.includes(e1) && h.w.enemies.includes(e2), `seed ${k}: the run — E1 dead, E2 alive`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('«Перенос к герою» (phase 2, every second «Перенос»): the rune 2.6 behind the hero\'s last step, fixed at its sign; he arrives there; «Вспышка посоха» 0.6 s later hurts a hero in its ring −2, not one outside; then the window 1.5 s', () => {
  for (const k of SEEDS) for (const inside of [false, true]) {
    const h = hall(k, CALM);
    phase2(h, { x: 14, y: 12.5 });
    // The hero steps east (his last step), then stands.
    h.sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(h.sim, ticksOf(0.25));
    h.sim.command({ t: 'walk', x: 0, y: 0 });
    const events: WorldEvent[] = [];
    let rune: Ev<'warlockShift'> | undefined;
    // Keep him stepping east now and then (each step is his last), until the rune's sign.
    assert(until(h, 20, (_w, ev) => !!(rune = of(ev, 'warlockShift').find(e => e.action === 'mark' && e.candle < 0)), events), `seed ${k}: a rune`);
    const hero = { x: h.w.hero.x, y: h.w.hero.y };
    assert(Math.abs(dist(rune!, hero) - BLINK_RADIUS) < 1e-6, `seed ${k}: 2.6 from the hero (${dist(rune!, hero)})`);
    assert(rune!.x < hero.x - 2.5 && Math.abs(rune!.y - hero.y) < 0.5, `seed ${k}: behind his step east (${rune!.x}, ${rune!.y} vs ${hero.x}, ${hero.y})`);
    const st = warlockV1State(h.w)!.rune!;
    assert(st && st.x === rune!.x && st.y === rune!.y, `seed ${k}: the rune in the state`);
    // The point is fixed: the hero walks away north for 0.3 s — the rune stays.
    h.sim.command({ t: 'walk', x: 0, y: -1 });
    ticks(h.sim, ticksOf(0.3));
    h.sim.command({ t: 'walk', x: 0, y: 0 });
    assert(warlockV1State(h.w)!.rune!.x === rune!.x, `seed ${k}: the rune stays`);
    assert(until(h, 1.5, (_w, ev) => moved(ev, 'blink', 'hit'), events) && dist(h.core, rune!) < 1e-9, `seed ${k}: he arrived at the rune`);
    const arrived = h.w.time;
    if (inside) h.sim.command({ t: 'teleport', x: h.core.x + 1.4, y: h.core.y });
    const hp = h.w.hero.hp, d = dist(h.w.hero, h.core);
    assert(warlockV1State(h.w)!.flash && enemyRefusal(h.w, h.core) === 'outOfWindow', `seed ${k}: the flash winds up; no window yet`);
    assert(until(h, 1, (_w, ev) => moved(ev, 'flash', 'hit'), events), `seed ${k}: the flash`);
    const flashAt = h.w.time, hits = of(events, 'hit').filter(e => e.source === 'warlock-flash');
    assert(Math.abs(flashAt - arrived - 0.6) < 0.02, `seed ${k}: 0.6 s after the arrival (${(flashAt - arrived).toFixed(3)})`);
    const ring = FLASH_RADIUS + heroRadius(h.w.params);
    if (inside) assert(d <= ring && hits.length === 1 && hits[0].damage === 2 && h.w.hero.hp === hp - 2, `seed ${k}: in the ring −2 (${d.toFixed(2)}, ${hits.length})`);
    else assert(d > ring && !hits.length && h.w.hero.hp === hp, `seed ${k}: out of the ring — nothing (${d.toFixed(2)})`);
    const ws = warlockState(h.w)!.window;
    assert(ws?.open && Math.abs(ws.left - 1.5) < 0.02 && of(events, 'warlockWindow').some(e => e.action === 'open'), `seed ${k}: then the window 1.5 s (${JSON.stringify(ws)})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('the worst point «the hero stepped towards the rune»: he walks onto it through its sign, the core\'s body puts him at its edge; walking away from the arrival he leaves the flash\'s ring in time (and after a reaction of 0.2 s — the measured margin is printed)', () => {
  for (const k of SEEDS) for (const reaction of [0, 0.2]) {
    const h = hall(k, CALM);
    phase2(h, { x: 14, y: 12.5 });
    h.sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(h.sim, ticksOf(0.25));
    h.sim.command({ t: 'walk', x: 0, y: 0 });
    let rune: Ev<'warlockShift'> | undefined;
    assert(until(h, 20, (_w, ev) => !!(rune = of(ev, 'warlockShift').find(e => e.action === 'mark' && e.candle < 0))), `seed ${k}: a rune`);
    // Towards the rune through the whole sign (the walk stops at it: he stands on its point when the core comes).
    const events: WorldEvent[] = [];
    for (let i = 0; i < ticksOf(1.5) && !moved(events, 'blink', 'hit'); i++) {
      const dx = rune!.x - h.w.hero.x, dy = rune!.y - h.w.hero.y, d = Math.sqrt(dx * dx + dy * dy);
      h.sim.command({ t: 'walk', x: d > 0.07 ? dx / d : 0, y: d > 0.07 ? dy / d : 0 });
      ticks(h.sim, 1, events);
    }
    assert(moved(events, 'blink', 'hit'), `seed ${k}: he arrived`);
    const start = dist(h.w.hero, h.core);
    h.sim.command({ t: 'walk', x: 0, y: 0 });
    ticks(h.sim, ticksOf(reaction), events);
    const dx = h.w.hero.x - h.core.x, dy = h.w.hero.y - h.core.y, d = Math.sqrt(dx * dx + dy * dy);
    h.sim.command({ t: 'walk', x: dx / d, y: dy / d });
    const hp = h.w.hero.hp;
    let at = 0;
    ticks(h.sim, ticksOf(1), events, (w, ev) => { if (moved(ev, 'flash', 'hit')) { at = dist(w.hero, h.core); return true; } return false; });
    const ring = FLASH_RADIUS + heroRadius(h.w.params), hit = h.w.hero.hp < hp;
    console.log(`   seed ${k}, реакция ${reaction} с: старт ${start.toFixed(2)} от центра, при вспышке ${at.toFixed(2)} (кольцо ${ring.toFixed(2)}) — ${hit ? 'задет' : 'ушёл'}`);
    assert(Math.abs(start - (0.32 + heroRadius(h.w.params))) < 0.05, `seed ${k}: put at the core's edge (${start.toFixed(3)})`);
    if (reaction === 0) assert(!hit && at > ring, `seed ${k}: he left the ring in time (${at.toFixed(3)})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('«Зов строя» (phase 1: the 15th s, then every 20 s): 4 basic markers of one colour (1 s) at the candle farthest from the hero, one formation; at most 2 formations alive — the third call is skipped; the colours vary with the seed', () => {
  const colors = new Set<number>();
  for (const k of SEEDS) {
    const h = hall(k, { warlockOrbPeriod: 1e6 }, { x: 12, y: 13 }), events: WorldEvent[] = [];
    // Due on the 15th s; the sign of the «Перенос» at 16 s burns from 15 s — the staff waits for the arrival (no move over a sign).
    assert(until(h, 17, (_w, ev) => moved(ev, "summon", "start"), events) && h.w.time >= 15 - 0.01 && h.w.time <= 16.05, `seed ${k}: the call on the 15th s or right after the arrival it waits for (${h.w.time.toFixed(2)})`);
    assert(warlockV1State(h.w)!.summon, `seed ${k}: the staff raised shows`);
    assert(until(h, 1.5, (_w, ev) => moved(ev, 'summon', 'hit'), events), `seed ${k}: the markers`);
    const marks = h.w.markers.filter(m => m.formation !== undefined);
    const candles = WARLOCK_ARENA.warlock!.candles, here = warlockState(h.w)!.candle;
    // The line's centre stands on a candle not his own, as far from the hero as any other (ties — either).
    const mid = { x: marks.reduce((s, m) => s + m.x, 0) / marks.length, y: marks.reduce((s, m) => s + m.y, 0) / marks.length };
    const at = candles.findIndex(c => dist(c, mid) < 1e-6), most = Math.max(...candles.filter((_, i) => i !== here).map(c => dist(c, h.w.hero)));
    assert(marks.length === SUMMON_SIZE && new Set(marks.map(m => m.color)).size === 1 && new Set(marks.map(m => m.formation)).size === 1 && marks.every(m => m.kind === 'basic' && m.total === 1), `seed ${k}: 4 of one colour (${JSON.stringify(marks)})`);
    assert(at >= 0 && at !== here && Math.abs(dist(candles[at], h.w.hero) - most) < 1e-6, `seed ${k}: at the farthest candle (${at})`);
    colors.add(marks[0].color);
    ticks(h.sim, ticksOf(1.2), events);
    assert(h.w.enemies.filter(e => e.kind === 'basic' && e.vars.fm === marks[0].formation).length === SUMMON_SIZE, `seed ${k}: 4 stand`);
    // The second at the 35th s; the third (55th) is skipped: two formations stand.
    ticks(h.sim, ticksOf(42), events);
    const calls = events.filter(e => e.type === 'bossMove' && e.move === 'summon' && e.stage === 'hit').length;
    assert(calls === 2 && warlockV1State(h.w)!.formations.length === 2 && h.w.enemies.filter(e => e.kind === "basic" && e.vars.fm !== undefined).length === 2 * SUMMON_SIZE, `seed ${k}: two calls, the third skipped (${calls}, ${JSON.stringify(warlockV1State(h.w)!.formations)}, ${h.w.enemies.filter(e => e.kind === "basic").length}, ${JSON.stringify(of(events, "kill").map(e => e.source))})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
  assert(colors.size >= 2, `the formations' colours vary: ${[...colors]}`);
});

check('phase 3 «ярость»: phase 2 and a plate off — still 2; the second plate (2 of 4 left) — phase 3 once the move and the slide are over; then each «Перенос» is to the hero, every 3 s, with the ring of 8 orbs', () => {
  for (const k of SEEDS) {
    const h = hall(k, CALM);
    phase2(h, { x: 12, y: 14 });
    const events: WorldEvent[] = [];
    for (let n = 1; n <= 2; n++) {
      const id = h.sim.command({ t: 'place', x: h.core.x, y: h.core.y + 1.2, color: 0, hp: 0, kind: BARREL }) as number, barrel = h.w.enemies.find(e => e.id === id)!;
      const out: WorldEvent[] = [];
      shoveAt(h, barrel, h.core, out);
      ticks(h.sim, 1, out);
      events.push(...out);
      assert(plates(h.core) === 4 - n, `seed ${k}: a plate off (${plates(h.core)})`);
      assert(warlockState(h.w)!.phase === (n === 2 ? 3 : 2), `seed ${k}: phase ${warlockState(h.w)!.phase} at ${plates(h.core)} plates`);
    }
    assert(of(events, 'bossPhase').some(e => e.phase === 3) && warlockV1State(h.w)!.rage, `seed ${k}: the rage`);
    h.sim.command({ t: 'teleport', x: 12, y: 12.5 });
    const arrivals: { candle: number; time: number }[] = [];
    let rings = 0;
    for (let i = 0; i < ticksOf(12); i++) {
      h.sim.tick();
      for (const e of h.w.events.splice(0)) {
        if (e.type === 'warlockShift' && e.action === 'arrive') arrivals.push({ candle: e.candle, time: h.w.time });
        if (e.type === 'bossMove' && e.move === 'orbs' && e.stage === 'start') rings++;
      }
    }
    // A sign burning when the rage came keeps its candle; every «Перенос» after it is to the hero, 3 s apart, each with its ring.
    const rage = arrivals.slice(arrivals.length && arrivals[0].candle >= 0 ? 1 : 0);
    assert(rage.length >= 3 && rage.every(e => e.candle < 0), `seed ${k}: each «Перенос» to the hero (${arrivals.map(e => e.candle)})`);
    assert(rage.slice(1).every((e, i) => Math.abs(e.time - rage[i].time - 3) < 0.05), `seed ${k}: every 3 s (${rage.map(e => e.time.toFixed(2))})`);
    assert(rings >= rage.length, `seed ${k}: a ring at each arrival (${rings})`);
    assert(replays(h.sim), `seed ${k}: replay`);
  }
  // The ring itself: 8 lines, one through the hero, 8 orbs leave.
  const h = hall(1, CALM);
  phase2(h);
  for (let n = 0; n < 2; n++) {
    const id = h.sim.command({ t: 'place', x: h.core.x, y: h.core.y + 1.2, color: 0, hp: 0, kind: BARREL }) as number;
    shoveAt(h, h.w.enemies.find(e => e.id === id)!, h.core);
  }
  h.sim.command({ t: 'teleport', x: 12, y: 12.5 });
  assert(until(h, 6, (_w, ev) => moved(ev, 'orbs', 'start')), 'a ring began');
  const st = warlockV1State(h.w)!.orbs!;
  assert(st.ring && st.lines.length === ORB_RING && offLine(st.lines[0], h.w.hero) < 1e-6, `the ring: 8 lines, one through the hero (${st.lines.length})`);
  assert(until(h, 2, (_w, ev) => moved(ev, 'orbs', 'hit')) && orbs(h.w).length === ORB_RING, `8 orbs (${orbs(h.w).length})`);
});

check('the provisional rugs keep the barrels\' shoves of v0: no rug under a barrel or on a barrel\'s lane to its candle; with v1 on, B3 and B4 shoved north roll along their columns past C2 and C3', () => {
  const rugs = WARLOCK_ARENA.warlock!.rugs!, candles = WARLOCK_ARENA.warlock!.candles;
  const barrels = WARLOCK_ARENA.enemies.filter(e => e.kind === BARREL);
  // The lanes (spec 6.6): B1, B2 — C1's row; B3, B4 — the columns of C2, C3. A lane is the barrel's body wide.
  const lanes = [[barrels[0], candles[0]], [barrels[1], candles[0]], [barrels[2], candles[1]], [barrels[3], candles[2]]] as const;
  const r = 0.32 + 0.05;
  for (const [b, c] of lanes) {
    const x0 = Math.min(b.x, c.x) - r, x1 = Math.max(b.x, c.x) + r, y0 = Math.min(b.y, c.y) - r, y1 = Math.max(b.y, c.y) + r;
    assert(!rugs.some(g => g.x < x1 && g.x + g.w > x0 && g.y < y1 && g.y + g.h > y0), `the lane from (${b.x}, ${b.y}) is off the rugs`);
  }
  for (const g of rugs) assert(Math.min(g.w, g.h) <= 3, 'a rug at most 3 wide');
  for (const k of SEEDS) {
    const h = hall(k, CALM);
    for (const [bx, c] of [[4.5, candles[1]], [19.5, candles[2]]] as const) {
      const b = h.w.enemies.find(e => e.kind === BARREL && Math.abs(e.x - bx) < 1e-9)!;
      h.sim.command({ t: 'teleport', x: b.x, y: b.y + 1 });
      draw(h.sim, [b]);
      const plan = planChain(h.w).shove;
      assert(plan && Math.abs(plan.to.x - c.x) < 1e-6 && plan.to.y < c.y, `seed ${k}: B at ${bx} rolls past its candle (${JSON.stringify(plan?.to)})`);
      release(h.sim);
    }
    assert(replays(h.sim), `seed ${k}: replay`);
  }
});

check('values without `warlockV1` (a journal before it, a run saved without the flag): the hall plays the fight of the build before v1 — the hashes of 96b737a9 (walks, a barrel shoved, 40 s, 3 seeds)', () => {
  // Pinned on 96b737a9 (main before v1, 22.10.2026) by the same commands. A later hashed key in `DEFAULT_PARAMS` moves these: prove the
  // same run without that key gives them, then re-pin with the cause.
  const PINS: Readonly<Record<number, string>> = {
    1: 'cf9fc25cc30bdb9f 9914ccf3341079cf 10b2f947a5fa641b 193c9f3fd052f697',
    2: '68ba175973883d4b a2a964c25f552096 b6a17e1fedd0fb1e 062c9340f62726a5',
    3: '39b6d776f513c525 ce7a317355f653c6 98c9f54ac7f216ee f072b6fed8e79917',
  };
  for (const k of SEEDS) {
    const p = defaultParams() as Partial<Params>;
    for (const key of ['warlockV1', 'warlockOrbPeriod', 'warlockRugPeriod', 'warlockShiftRage', 'warlockSummonPeriod'] as const) delete p[key];
    p.heroHp = 999;
    const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: p as Params, seed: seedOf(k), record: true }), w = sim.world;
    const out: string[] = [];
    for (let t = 0; t < 60 * 40 && w.status === 'playing'; t++) {
      if (t % 90 === 0) { const a = t / 90; sim.command({ t: 'walk', x: Math.round(Math.cos(a) * 100) / 100, y: Math.round(Math.sin(a) * 100) / 100 }); }
      if (t === 120) {
        const b = w.enemies.find(e => e.kind === BARREL && e.x < 5 && e.y < 5)!;
        sim.command({ t: 'teleport', x: b.x - 1, y: b.y });
        sim.command({ t: 'begin', x: b.x, y: b.y });
        sim.command({ t: 'release' });
      }
      sim.tick();
      if ((t + 1) % 600 === 0) out.push(sim.hash());
    }
    assert(out.join(' ') === PINS[k], `seed ${k}: ${out.join(' ')}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

console.log(`realtime-warlock-v1: ${checks} checks passed`);
