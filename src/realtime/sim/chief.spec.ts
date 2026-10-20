/**
 * Task 54 «Главарь с котелком» — the boss of the camp's branch in the sandbox (sim/enemies/chief.ts, sim/arenasBoss.ts `chief`;
 * docs/realtime-elite-behaviors.md, «Главарь (задача 54)»). Node only: `npm run test:realtime-chief`.
 *
 * Every check plays journalled commands (teleport, place, chill, item, begin / drag, release) on «Стан Главаря» and looks at what the
 * player meets — the highlight (`planChain`) and then the dash:
 * - outside a window the core is refused (`outOfWindow`), the fire on it does not hurt it (`block`);
 * - «Обед!»: the enemies round the cauldron take the brew's colour for good (not the parts, not the links of the drawn chain), four
 *   eaters sit on their seats for the window and then walk, at most eight eaters; the strike waits for the hero's dash;
 * - the window: two links of the brew before the core — refused «в очередь»; three — a plate (the highlight = the dash); a second
 *   chain in the same window is refused; «Возврат» passes the struck core by; a queue of six takes two plates;
 * - the queue counts the brew's links anywhere before the core (after «Смена цвета» too);
 * - the window ends while the core is in the drawn chain: the core and the links after it leave the chain, the highlight is the rest's;
 * - «Приправа»: a new brew after each window (never the last one), the brews vary over seeds; the sack severed — the brew stays;
 * - a severed part: its move never starts again, the core loses a plate after the dash; the phases (a part, plates, time, ×0.85);
 *   «Свисток» — the living parts' colours; the cold stops the core's timers; the core's death ends the fight, the door opens;
 * - «Взмах половником» and «Горсть перца» hurt the hero where their signs stood;
 * - every fight replays from its journal; a world without the key plays the old path (the core open).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { COUNTER_TALISMANS, HAMMERS } from './buildIds';
import { enemyRefusal, planChain, REFUSAL_TEXT } from './chain';
import {
  CHIEF, CHIEF_LADLE, CHIEF_SACK, FEAST_EATERS_MAX, FEAST_RADIUS, PEPPER_RADIUS, PEPPER_STEP, PHASE2_TIME, PHASE3_TIME, SWING_RADIUS, chiefMove, chiefState,
} from './enemies/chief';
import type { Vec } from './geometry';
import type { Loadout } from './kit';
import { defaultParams, heroRadius, type Params } from './params';
import { replay, Simulation, SIM_DT } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { worldState } from './hash';
import { registerArena } from './arenas';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

/** Nothing comes but the Chief's own, the hero cannot fall, nobody walks, no touch. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  return Object.assign(p, extra);
}
interface Camp { sim: Simulation; w: World; core: Enemy; ladle: Enemy; sack: Enemy }
/** «Стан Главаря», the hero at (12, 12.5) — out of every move's reach; one tick. */
function camp(k = 1, extra: Partial<Params> = {}, loadout?: Loadout, params?: Params): Camp {
  const sim = new Simulation({ arena: 'chief', params: params ?? quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} }), w = sim.world;
  ticks(sim, 1);
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  return { sim, w, core: kind(CHIEF), ladle: kind(CHIEF_LADLE), sack: kind(CHIEF_SACK) };
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
/** Ticks until the hero stands again (the dash and its return run over). */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
const place = (sim: Simulation, at: Vec, hp: number, color: number, kind = 'basic'): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const feastEvents = (events: readonly WorldEvent[], action?: Ev<'chiefFeast'>['action']): Ev<'chiefFeast'>[] => of(events, 'chiefFeast').filter(e => !action || e.action === action);
const starts = (events: readonly WorldEvent[], move: string): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.move === move && e.stage === 'start');
const strikes = (events: readonly WorldEvent[], move: string): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.move === move && e.stage === 'hit');
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const freeze = (sim: Simulation, e: Enemy, seconds = 600): void => { sim.command({ t: 'chill', id: e.id, seconds }); };
const eaters = (w: World): Enemy[] => w.enemies.filter(e => e.vars.eat);
/** The eaters' seats of the arena. */
const SEATS: readonly Vec[] = [{ x: 11.8, y: 4.4 }, { x: 10.7, y: 4.6 }, { x: 9.8, y: 4 }, { x: 9.4, y: 3 }];
/** Beside the first seat, out of every seat (the eaters open), within R of it. */
const BY_SEATS: Vec = { x: 12.9, y: 5.6 };

/** «Обед!»'s window: the parts frozen (no part's move), the hero by the seats; ticks until it opens. */
function feastWindow(c: Camp, out: WorldEvent[] = [], at: Vec = BY_SEATS): WorldEvent[] {
  freeze(c.sim, c.ladle); freeze(c.sim, c.sack);
  c.sim.command({ t: 'teleport', x: at.x, y: at.y });
  ticks(c.sim, ticksOf(30), out, (_w, events) => feastEvents(events, 'open').length > 0);
  assert(feastEvents(out, 'open').length > 0, 'the window opened');
  return out;
}
/** The eaters on their seats, in the order of the seats. */
function seated(w: World): Enemy[] {
  return SEATS.map(s => w.enemies.find(e => e.vars.eat && Math.hypot(e.x - s.x, e.y - s.y) < 0.05)!);
}

check('outside a window the core is refused (`outOfWindow`, «вне окна»): clicks take nothing; the fire on it does not hurt it (`block`)', () => {
  for (const k of SEEDS) {
    const c = camp(k, {}, { items: { fire: 1 } }), { sim, w, core } = c;
    freeze(sim, c.ladle); freeze(sim, c.sack);
    sim.command({ t: 'teleport', x: 11.2, y: 4.6 });
    ticks(sim, 1);
    assert(!chiefState(w)!.window && enemyRefusal(w, core) === 'outOfWindow' && REFUSAL_TEXT.queue === 'в очередь', `seed ${k}: refused (${enemyRefusal(w, core)})`);
    assert(core.armor?.plates === 4 && core.hp === 2, `seed ${k}: 4 plates, HP 2`);
    for (let n = 0; n < 3; n++) { sim.command({ t: 'begin', x: core.x, y: core.y }); assert(w.chain.length === 0, `seed ${k}: click ${n}`); sim.command({ t: 'release' }); ticks(sim, 10); }
    const events: WorldEvent[] = [];
    sim.command({ t: 'item', kind: 'fire', x: core.x, y: core.y });
    ticks(sim, ticksOf(3.5), events);
    const fire = feastEvents(events, 'block').filter(e => e.source === 'fire');
    assert(fire.length >= 2 && core.armor?.plates === 4 && core.hp === 2, `seed ${k}: the fire blocked (${fire.length}), the core whole`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Обед!»: the enemies round the cauldron take the brew for good (not the parts, not the drawn chain\'s links, not those farther), four eaters sit their window and then walk; the strike waits for the dash; at most eight eaters', () => {
  for (const k of SEEDS) {
    const c = camp(k, { enemySpeed: 1 }), { sim, w, ladle, sack } = c;
    freeze(sim, ladle); freeze(sim, sack);
    sim.command({ t: 'teleport', x: 16, y: 7 });
    // Before the strike: the hero dashes; one enemy round the cauldron in his drawn chain, one inside the circle, one outside.
    const out: WorldEvent[] = [];
    ticks(sim, ticksOf(10), out, (_w, events) => starts(events, 'feast').length > 0);
    const brew = chiefState(w)!.brew, other = (brew + 1) % 4;
    const inside = place(sim, { x: 14.6, y: 4.6 }, 3, other), outside = place(sim, { x: 17.6, y: 4.2 }, 3, other);
    const drawnLink = place(sim, { x: 15.4, y: 5.6 }, 3, other);
    freeze(sim, inside); freeze(sim, outside); freeze(sim, drawnLink);
    draw(sim, [drawnLink]);
    assert(w.chain.length === 1, `seed ${k}: the chain holds one link`);
    ticks(sim, ticksOf(4), out, (_w, events) => feastEvents(events, 'open').length > 0);
    const open = feastEvents(out, 'open')[0];
    assert(open && open.colour === brew, `seed ${k}: the window opened with the brew (${JSON.stringify(open)})`);
    assert(Math.hypot(inside.x - 12.8, inside.y - 2.9) <= FEAST_RADIUS && inside.color === brew, `seed ${k}: the one inside took the brew`);
    assert(outside.color === other && drawnLink.color === other, `seed ${k}: the one outside and the drawn link kept their colour`);
    assert(of(out, 'enemySignal').some(e => e.signal === 'recolor' && e.enemyId === inside.id) && !of(out, 'enemySignal').some(e => e.enemyId === drawnLink.id || e.enemyId === ladle.id || e.enemyId === sack.id), `seed ${k}: recolour signals`);
    const four = seated(w);
    assert(four.every(e => e && e.color === brew && e.hp === 0 && !e.elite) && eaters(w).length === 4, `seed ${k}: four eaters on the seats (${eaters(w).map(e => `${e.x.toFixed(2)},${e.y.toFixed(2)}`)})`);
    // They sit the window (the hero 4+ away, the crowd's pace on); then they walk.
    ticks(sim, ticksOf(3.5));
    assert(four.every((e, i) => Math.hypot(e.x - SEATS[i].x, e.y - SEATS[i].y) < 0.05), `seed ${k}: still sitting`);
    ticks(sim, ticksOf(1));
    assert(four.some((e, i) => Math.hypot(e.x - SEATS[i].x, e.y - SEATS[i].y) > 0.1), `seed ${k}: they walk after the window`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  // The strike waits for the hero's dash: a long chain released as the windup ends.
  for (const k of SEEDS) {
    const c = camp(k), { sim, w } = c;
    freeze(sim, c.ladle); freeze(sim, c.sack);
    sim.command({ t: 'teleport', x: 4, y: 13 });
    const links = [5.4, 7.2, 9.0, 10.8, 12.6].map(x => place(sim, { x, y: 13 }, 3, 0));
    ticks(sim, ticksOf(10), [], (_w, events) => starts(events, 'feast').length > 0);
    ticks(sim, ticksOf(2.25) - 3);
    draw(sim, links);
    sim.command({ t: 'release' });
    const out: WorldEvent[] = [];
    let during = 0;
    for (let i = 0; i < 300 && (w.move || i === 0); i++) { sim.tick(); const ev = w.events.splice(0); out.push(...ev); if (w.move && strikes(ev, 'feast').length) during++; }
    assert(during === 0, `seed ${k}: no feast during the dash`);
    ticks(sim, 2, out);
    assert(strikes(out, 'feast').length === 1, `seed ${k}: it struck after the dash`);
  }
  // At most eight eaters alive.
  const c = camp(1, { enemySpeed: 1 }), { sim, w } = c;
  freeze(sim, c.ladle); freeze(sim, c.sack);
  sim.command({ t: 'teleport', x: 12, y: 12.5 });
  ticks(sim, ticksOf(40));
  assert(eaters(w).length === FEAST_EATERS_MAX, `eight eaters after three feasts (${eaters(w).length})`);
});

check('the window: two links of the brew before the core — «в очередь»; three — a plate (the highlight = the dash), the window closes, a second chain is refused; a queue of six takes two plates', () => {
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    assert(four.every(Boolean), `seed ${k}: four eaters seated`);
    // Two: refused «в очередь» (the core within reach of the second seat).
    draw(sim, [four[0], four[1]]);
    assert(w.chain.length as number === 2 && enemyRefusal(w, core) === 'queue', `seed ${k}: two — «в очередь» (${enemyRefusal(w, core)})`);
    // Three: the core joins, the plan takes a plate.
    sim.command({ t: 'drag', x: four[2].x, y: four[2].y, mode: 'full' });
    sim.command({ t: 'drag', x: core.x, y: core.y, mode: 'full' });
    assert(w.chain.length === 4 && w.chain[3].id === core.id, `seed ${k}: the core joined (${w.chain.map(l => l.id)})`);
    const plan = planChain(w), last = plan.links[3].outcome;
    assert(last?.plate && last.platesAfter === 3 && plan.chiefDrop?.index === 3, `seed ${k}: the highlight — a plate (${JSON.stringify(last)})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    ticks(sim, 1, out);
    assert(core.armor?.plates === 3 && feastEvents(out, 'hit').length === 1 && feastEvents(out, 'hit')[0].links === 3, `seed ${k}: the dash took the plate (${core.armor?.plates}, ${JSON.stringify(feastEvents(out, 'hit'))})`);
    assert(feastEvents(out, 'close').length === 1 && !chiefState(w)!.window && enemyRefusal(w, core) === 'outOfWindow', `seed ${k}: the window closed, the core refused`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, core } = c;
    feastWindow(c, [], { x: 14.6, y: 7.6 });
    const brew = chiefState(w)!.brew, four = seated(w);
    const p1 = place(sim, { x: 13.8, y: 6.4 }, 0, brew), p2 = place(sim, { x: 12.9, y: 5.2 }, 0, brew);
    draw(sim, [p1, p2, four[0], four[1], four[2], four[3], core]);
    assert(w.chain.length === 7, `seed ${k}: six links of the brew and the core (${w.chain.length})`);
    const plan = planChain(w);
    assert(plan.links[6].outcome?.plate && plan.links[6].outcome.platesAfter === 2, `seed ${k}: the highlight — two plates (${JSON.stringify(plan.links[6].outcome)})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    assert(core.armor?.plates === 2 && feastEvents(out, 'big').length === 1 && feastEvents(out, 'big')[0].links === 6, `seed ${k}: the dash took two (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Возврат» passes the struck core by (the highlight\'s run and the run); the queue counts the brew\'s links anywhere before the core — after «Смена цвета» too', () => {
  for (const k of SEEDS) {
    const c = camp(k, {}, { hammer: HAMMERS.return }), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    draw(sim, [four[0], four[1], four[2], core]);
    const plan = planChain(w);
    assert(plan.back && !plan.back.hits.some(h => h.id === core.id), `seed ${k}: the highlight's run passes the core (${plan.back?.hits.map(h => h.id)})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    assert(core.armor?.plates === 3 && feastEvents(out, 'hit').length === 1 && !feastEvents(out, 'block').some(e => e.source === 'hammer-return'), `seed ${k}: one plate, the run never on the core (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    const c = camp(k, { colorShiftLinks: 6, crystals: false, colorCount: 4 }), { sim, w, core } = c;
    feastWindow(c, [], { x: 20, y: 7.8 });
    const brew = chiefState(w)!.brew, other = (brew + 1) % 4, four = seated(w);
    const six = [{ x: 18.8, y: 7.4 }, { x: 17.4, y: 6.9 }, { x: 16, y: 6.4 }, { x: 14.6, y: 5.9 }, { x: 13.6, y: 6.9 }, { x: 13.2, y: 5.4 }].map(p => place(sim, p, 0, other));
    draw(sim, [...six, four[0], four[1], four[2]]);
    assert(w.chain.length === 9, `seed ${k}: six of another colour, then three of the brew (${w.chain.length})`);
    assert(enemyRefusal(w, core) === null, `seed ${k}: the core joins (${enemyRefusal(w, core)})`);
    sim.command({ t: 'drag', x: core.x, y: core.y, mode: 'full' });
    assert(w.chain.length as number === 10 && planChain(w).links[9].outcome?.plate, `seed ${k}: the highlight — a plate`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 3, `seed ${k}: the dash took it (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the window ends while the core is in the drawn chain: the core and the links after it leave the chain (`unlink`), the highlight is the rest\'s and the dash does just that', () => {
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    draw(sim, [four[0], four[1], four[2], core]);
    const before = planChain(w);
    assert(before.chiefDrop?.index === 3 && before.chiefDrop.left > 3, `seed ${k}: the highlight knows the drop (${JSON.stringify(before.chiefDrop)})`);
    const out = ticks(sim, ticksOf(4.5), [], (_w, ev) => feastEvents(ev, 'unlink').length > 0);
    const unlink = feastEvents(out, 'unlink')[0];
    assert(unlink && JSON.stringify(unlink.dropped) === JSON.stringify([core.id]) && w.chain.length === 3, `seed ${k}: the core dropped (${JSON.stringify(unlink)})`);
    const plan = planChain(w);
    assert(plan.links.length === 3 && plan.links.every(l => l.outcome?.killed) && !plan.chiefDrop, `seed ${k}: the highlight is the three`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 4 && four.slice(0, 3).every(e => !w.enemies.includes(e)), `seed ${k}: the dash killed the three, the core whole`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Приправа»: after each window a new brew, never the last; the brews vary over seeds; the sack severed — the brew stays', () => {
  const firsts = new Set<number>(), seconds = new Set<string>();
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const c = camp(k), { sim, w } = c;
    freeze(sim, c.ladle);
    sim.command({ t: 'teleport', x: 1.5, y: 14 });
    const brews: number[] = [chiefState(w)!.brew];
    const out = ticks(sim, ticksOf(32));
    for (const e of of(out, 'chiefBrew')) brews.push(e.colour);
    assert(brews.length >= 3 && brews.every((b, i) => i === 0 || b !== brews[i - 1]), `seed ${k}: a new brew each time (${brews})`);
    assert(strikes(out, 'season').length === brews.length - 1 && feastEvents(out, 'close').length >= brews.length - 1, `seed ${k}: after the windows`);
    firsts.add(brews[0]); seconds.add(brews.slice(0, 3).join());
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(firsts.size >= 2 && seconds.size >= 3, `the brews vary (${[...firsts]}; ${[...seconds]})`);
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, sack } = c;
    freeze(sim, c.ladle);
    // The sack severed before the first feast: two links of its colour.
    sim.command({ t: 'teleport', x: 8.4, y: 5.4 });
    const links = [place(sim, { x: 8.8, y: 4.4 }, 0, sack.color), place(sim, { x: 9.5, y: 3.2 }, 0, sack.color)];
    draw(sim, [...links, sack]);
    assert(w.chain.length === 3 && planChain(w).links[2].severs, `seed ${k}: the chain severs the sack`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(!w.enemies.includes(sack), `seed ${k}: severed`);
    sim.command({ t: 'teleport', x: 1.5, y: 14 });
    const brew = chiefState(w)!.brew, out = ticks(sim, ticksOf(30));
    assert(feastEvents(out, 'close').length >= 2 && of(out, 'chiefBrew').length === 0 && starts(out, 'season').length === 0 && chiefState(w)!.brew === brew && starts(out, 'pepper').length === 0, `seed ${k}: the brew stays (${chiefState(w)!.brew} vs ${brew})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a severed part: its move never starts again; the core loses a plate after the dash; phase 2 comes; «Свисток» calls the living part\'s colour at the far gate', () => {
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, core, ladle, sack } = c;
    freeze(sim, ladle);
    sim.command({ t: 'teleport', x: 8.4, y: 5.4 });
    const links = [place(sim, { x: 8.8, y: 4.4 }, 0, sack.color), place(sim, { x: 9.5, y: 3.2 }, 0, sack.color)];
    draw(sim, [...links, sack]);
    assert(w.chain.length === 3 && planChain(w).links[2].severs, `seed ${k}: the chain severs the sack (${w.chain.length})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    ticks(sim, 1, out);
    assert(of(out, 'partSevered').some(e => e.id === sack.id) && core.armor?.plates === 3 && of(out, 'bossPhase').some(e => e.phase === 2), `seed ${k}: severed, a plate, phase 2`);
    // The hero in the pepper's range, out of the swing's: no pepper ever; the whistle calls the ladle's colour at the far gate.
    sim.command({ t: 'teleport', x: 7, y: 10.5 });
    const later = ticks(sim, ticksOf(14), [], (_w, ev) => strikes(ev, 'whistle').length > 0);
    assert(starts(later, 'pepper').length === 0 && strikes(later, 'whistle').length === 1, `seed ${k}: no pepper; the whistle`);
    const markers = w.markers.filter(m => m.kind === 'basic' && Math.hypot(m.x - 23, m.y - 5) < 1);
    assert(markers.length === 4 && markers.every(m => m.color === ladle.color), `seed ${k}: four of the ladle's colour at the east gate (${markers.map(m => `${m.x.toFixed(1)},${m.y.toFixed(1)}:${m.color}`)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('phases: 2 at 30 s and 3 at 70 s without a hit (×0.85 with the kit\'s `phaseScale`); 3 by plates at 2; the cold stops the core\'s timers and opens no window', () => {
  for (const scale of [1, 0.85]) {
    const { sim, w } = camp(1, {}, scale === 1 ? undefined : { phaseScale: scale });
    sim.command({ t: 'teleport', x: 1.5, y: 14 });
    const times: Record<number, number> = {};
    for (let i = 0; i < ticksOf(75); i++) { sim.tick(); for (const e of of(w.events.splice(0), 'bossPhase')) times[e.phase] = w.time; }
    assert(Math.abs(times[2] - PHASE2_TIME * scale) < 0.05 && Math.abs(times[3] - PHASE3_TIME * scale) < 0.05, `×${scale}: phases at ${JSON.stringify(times)}`);
    assert(replays(sim), `×${scale}: replay`);
  }
  for (const k of SEEDS) {
    const c = camp(k, { chiefPlates: 3 }), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    draw(sim, [four[0], four[1], four[2], core]);
    sim.command({ t: 'release' });
    const out = settle(sim);
    ticks(sim, 1, out);
    assert(core.armor?.plates === 2 && JSON.stringify(of(out, 'bossPhase').map(e => e.phase)) === '[2,3]', `seed ${k}: 2 plates — phases 2 and 3`);
  }
  for (const k of SEEDS) {
    const c = camp(k), { sim, w, core } = c;
    freeze(sim, c.ladle); freeze(sim, c.sack); freeze(sim, core, 20);
    sim.command({ t: 'teleport', x: 1.5, y: 14 });
    const out = ticks(sim, ticksOf(19));
    assert(starts(out, 'feast').length === 0 && !chiefState(w)!.window, `seed ${k}: frozen — no feast`);
    freeze(sim, core, 0);
    const after = ticks(sim, ticksOf(4.5), [], (_w, ev) => starts(ev, 'feast').length > 0);
    assert(starts(after, 'feast').length === 1 && Math.abs(w.time - 19 - 4) < 0.1, `seed ${k}: the feast's timer went on after the thaw (${w.time.toFixed(2)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Взмах половником» hurts the hero in its half-disc, not behind its edge; «Горсть перца» — in its circles, not between them', () => {
  for (const k of SEEDS) {
    for (const inside of [true, false]) {
      const c = camp(k), { sim, w, core } = c;
      freeze(sim, c.sack);
      sim.command({ t: 'teleport', x: 11, y: 6.2 });
      const out = ticks(sim, ticksOf(6), [], (_w, ev) => starts(ev, 'swing').length > 0);
      assert(starts(out, 'swing').length === 1, `seed ${k}: the swing winds up`);
      const sign = chiefMove(w);
      assert(sign?.move === 'swing' && sign.r === SWING_RADIUS, `seed ${k}: its sign`);
      // In: a step towards the core (2 from it, in the half-disc); out: 0.6 beyond its edge on the same line.
      sim.command({ t: 'teleport', x: 11, y: inside ? 5 : 3 + SWING_RADIUS + heroRadius(w.params) + 0.6 });
      const hp = w.hero.hp, hit = ticks(sim, ticksOf(2), [], (_w, ev) => strikes(ev, 'swing').length > 0);
      assert(strikes(hit, 'swing').length === 1 && (w.hero.hp < hp) === inside && of(hit, 'hit').some(e => e.source === 'chief-ladle') === inside, `seed ${k}, inside ${inside}: HP ${hp} → ${w.hero.hp}`);
      void core;
    }
  }
  for (const k of SEEDS) {
    for (const where of ['centre', 'side', 'between'] as const) {
      const c = camp(k), { sim, w, core } = c;
      freeze(sim, c.ladle);
      sim.command({ t: 'teleport', x: 11, y: 8 });
      const out = ticks(sim, ticksOf(6), [], (_w, ev) => starts(ev, 'pepper').length > 0);
      assert(starts(out, 'pepper').length === 1, `seed ${k}: the pepper winds up`);
      const sign = chiefMove(w)!, circles = sign.circles!;
      assert(circles.length === 3 && Math.abs(Math.hypot(circles[2].x - circles[1].x, circles[2].y - circles[1].y) - PEPPER_STEP) < 1e-9 && sign.r === PEPPER_RADIUS, `seed ${k}: three circles`);
      const to = where === 'centre' ? circles[1] : where === 'side' ? circles[2] : { x: (circles[1].x + circles[2].x) / 2 + 1.3, y: (circles[1].y + circles[2].y) / 2 };
      sim.command({ t: 'teleport', x: to.x, y: to.y });
      const hp = w.hero.hp, hit = ticks(sim, ticksOf(2), [], (_w, ev) => strikes(ev, 'pepper').length > 0);
      assert(strikes(hit, 'pepper').length === 1 && (w.hero.hp < hp) === (where !== 'between'), `seed ${k}, ${where}: HP ${hp} → ${w.hero.hp}`);
      void core;
    }
  }
});

check('the core\'s death ends the fight: the crowd and the parts die uncredited, the door opens; a world without the key plays the old path (the core open outside a window)', () => {
  for (const k of SEEDS) {
    const c = camp(k, { chiefPlates: 0, chiefHp: 1 }), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    draw(sim, [four[0], four[1], four[2], core]);
    assert(planChain(w).links[3].outcome?.killed && planChain(w).bossClear, `seed ${k}: the highlight — the core dies`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    assert(!w.enemies.includes(core) && w.bossCleared && w.enemies.length === 0 && of(out, 'kill').some(e => e.source === 'boss-clear'), `seed ${k}: the fight is over (${w.enemies.map(e => e.kind)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    const params = quiet();
    delete (params as Partial<Params>).chiefFeast;
    const c = camp(k, {}, undefined, params), { sim, w, core } = c;
    assert(w.params.chiefFeast === undefined, `seed ${k}: no key`);
    freeze(sim, c.ladle); freeze(sim, c.sack);
    sim.command({ t: 'teleport', x: 11.2, y: 4.6 });
    ticks(sim, 1);
    assert(enemyRefusal(w, core) === null, `seed ${k}: no refusal`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 3, `seed ${k}: a plate taken outside the window`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('ranks II and Ведунья: «Ударная волна» II\'s start wave round the core does not land (the highlight leaves it out, one hit — the chain\'s); «Иней на клинке» II freezes the struck core\'s neighbour; Ведунья\'s open chain into the core gives no shield (`noShield` ⇔ no shield at the chain\'s end)', () => {
  for (const k of SEEDS) {
    const kit: Loadout = { talismans: [COUNTER_TALISMANS.shockwave], honed: [COUNTER_TALISMANS.shockwave] };
    const c = camp(k, { counterWindow: true }, kit), { sim, w, core } = c;
    feastWindow(c);
    const four = seated(w);
    sim.command({ t: 'teleport', x: 12.4, y: 4 });
    draw(sim, [four[0], four[1], four[2], core]);
    const plan = planChain(w);
    assert(w.chain.length === 4 && plan.honed?.waves && !plan.honed.waves.some(x => x.ids.includes(core.id)), `seed ${k}: the waves leave the core out (${JSON.stringify(plan.honed?.waves)})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    assert(core.armor?.plates === 3 && feastEvents(out, 'hit').length === 1 && feastEvents(out, 'hit')[0].links === 3, `seed ${k}: one plate, the chain's (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    const kit: Loadout = { talismans: [COUNTER_TALISMANS.frostEdge], honed: [COUNTER_TALISMANS.frostEdge] };
    const c = camp(k, { counterWindow: true }, kit), { sim, w, core, ladle, sack } = c;
    feastWindow(c);
    // The parts thawed: the neighbour the frost takes is warm before the chain.
    freeze(sim, ladle, 0); freeze(sim, sack, 0);
    const four = seated(w);
    draw(sim, [four[0], four[1], four[2], core]);
    const plan = planChain(w), frost = plan.honed?.frost;
    assert(frost?.survivor === core.id && frost.near !== undefined, `seed ${k}: the highlight's frost — the core's neighbour (${JSON.stringify(frost)})`);
    const near = w.enemies.find(e => e.id === frost!.near)!;
    assert(!near.chill, `seed ${k}: ${near.kind} warm before`);
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 3 && (core.chill ?? 0) > 0 && (near.chill ?? 0) > 0, `seed ${k}: the core and ${near.kind} frozen (${core.chill}, ${near.chill})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    for (const hero of ['toad', null] as const) {
      const c = camp(k, {}, hero ? { hero } : undefined), { sim, w, core } = c;
      feastWindow(c);
      const four = seated(w);
      draw(sim, [four[0], four[1], four[2], core]);
      const plan = planChain(w);
      sim.command({ t: 'release' });
      let shield = -1;
      for (let i = 0; i < 400 && shield < 0; i++) { sim.tick(); if (w.events.splice(0).some(e => e.type === 'chainEnd')) shield = w.hero.chainShield; }
      assert(!!plan.noShield === (hero === 'toad') && (shield === 0) === !!plan.noShield && core.armor?.plates === 3, `seed ${k}, ${hero ?? 'cat'}: noShield ${plan.noShield}, shield ${shield}`);
      assert(replays(sim), `seed ${k}, ${hero ?? 'cat'}: replay`);
    }
  }
});

check('the core under the feast\'s rule is out of every shadow: the return run that passes it does not strike it (the highlight\'s run and the run); the window\'s timer stands while the hero\'s dash runs', () => {
  // `returnFixed` (the sandbox's) — the release fixes the highlight's run; off (the run's) — the run finds its bodies as it goes.
  for (const k of SEEDS) for (const returnFixed of [true, false]) {
    const c = camp(k, { returnFixed }, { hammer: HAMMERS.return }), { sim, w, core } = c;
    freeze(sim, c.ladle); freeze(sim, c.sack);
    // Before the first feast: two links south of the core, the last beside it — the way back passes its body.
    sim.command({ t: 'teleport', x: 11.2, y: 6.8 });
    const links = [place(sim, { x: 11.2, y: 5.4 }, 0, 0), place(sim, { x: 11.2, y: 3.75 }, 0, 0)];
    draw(sim, links);
    const plan = planChain(w);
    assert(w.chain.length === 2 && plan.back && !plan.back.hits.some(h => h.id === core.id), `seed ${k}: the highlight's run passes the core (${plan.back?.hits.map(h => h.id)})`);
    sim.command({ t: 'release' });
    const out = settle(sim);
    assert(core.armor?.plates === 4 && !feastEvents(out, 'block').some(e => e.source === 'hammer-return'), `seed ${k}: the run never on the core`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  for (const k of SEEDS) {
    const c = camp(k), { sim, w } = c;
    feastWindow(c, [], { x: 4, y: 13 });
    const brew = chiefState(w)!.brew;
    const links = [5.6, 7.4, 9.2, 11, 12.8, 14.6].map(x => place(sim, { x, y: 13 }, 3, brew));
    for (const e of links) freeze(sim, e);
    ticks(sim, ticksOf(4), [], wd => (chiefState(wd)!.window?.left ?? 0) <= 0.1);
    const left = chiefState(w)!.window!.left;
    draw(sim, links);
    sim.command({ t: 'release' });
    let during = 0;
    for (let i = 0; i < 300 && (w.move || i === 0); i++) { sim.tick(); w.events.length = 0; if (w.move) during++; }
    assert(during > ticksOf(left) && chiefState(w)!.window?.open && Math.abs(chiefState(w)!.window!.left - left) < 0.02, `seed ${k}: the window waited for the dash (${left} → ${chiefState(w)!.window?.left}, ${during} ticks)`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the Chief\'s keys are read on his arena only: another arena (the boss arenas, the run\'s, the sandbox\'s) with every `chief*` changed plays the same world but the params', () => {
  const changed: Partial<Params> = { chiefFeast: true, chiefHp: 9, chiefPlates: 7, chiefFeastLinks: 1, chiefFeastTime: 9, chiefFeastGap: 1, chiefFeastBig: 1, chiefCrowd: 2 };
  for (const arena of ['jailer', 'troll', 'last-stand', 'outpost', 'glade', 'g-castellan']) {
    for (const k of [1, 2]) {
      const play = (extra: Partial<Params>): Simulation => {
        const p = { ...defaultParams(), heroHp: 999, hitstop: false, ...extra };
        const sim = new Simulation({ arena, params: p, seed: seedOf(k), record: true }), w = sim.world;
        for (let t = 0; t < ticksOf(12); t++) {
          // A chain every second from the nearest candidate (the same journal of commands in both worlds).
          if (t % 60 === 30 && !w.move && w.status === 'playing') {
            const near = [...w.enemies].sort((a, b) => Math.hypot(a.x - w.hero.x, a.y - w.hero.y) - Math.hypot(b.x - w.hero.x, b.y - w.hero.y))[0];
            if (near) { sim.command({ t: 'begin', x: near.x, y: near.y }); sim.command({ t: 'release' }); }
          }
          sim.tick();
        }
        return sim;
      };
      const plain = play({}), keyed = play(changed);
      const state = (sim: Simulation): string => { const s = worldState(sim.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
      assert(keyed.world.params.chiefHp === 9 && state(plain) === state(keyed), `${arena}, seed ${k}: the same world`);
    }
  }
});

registerArena({
  id: 'chief-seal-field', name: 'Поле Главаря (тест печати)', summary: 'Тест: печать вокруг Главаря', goal: 'marked', width: 20, height: 12,
  heroStart: { x: 10, y: 10.5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 1 }, enemies: [{ x: 10, y: 6, color: 0, kind: CHIEF, marked: true }],
  bossFrame: true, bossClears: true, jailerColorless: true,
  chief: { cauldron: { x: 10, y: 9.5 }, seats: [{ x: 8.6, y: 9.6 }, { x: 9.6, y: 9.9 }, { x: 10.6, y: 9.9 }, { x: 11.6, y: 9.6 }] },
});

check('«Печать» never hurts the Chief: a ring round his core (an open field) — the highlight leaves the core out of the seal, the strike gives its «звон» and no damage; in his window and outside it', () => {
  for (const k of SEEDS) {
    for (const open of [true, false]) {
      const sim = new Simulation({ arena: 'chief-seal-field', params: quiet({ loopEnabled: true }), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const core = w.enemies.find(e => e.kind === CHIEF)!;
      sim.command({ t: 'teleport', x: 8, y: 5.1 });
      if (open) ticks(sim, ticksOf(10), [], (_w, ev) => feastEvents(ev, 'open').length > 0);
      assert(!!chiefState(w)!.window?.open === open, `seed ${k}: the window ${open}`);
      const colour = open ? (chiefState(w)!.brew + 1) % 4 : 0;
      const ring = [{ x: 9.1, y: 5.1 }, { x: 10.9, y: 5.1 }, { x: 10.9, y: 6.9 }, { x: 9.1, y: 6.9 }].map(p => place(sim, p, 0, colour));
      const inner = place(sim, { x: 9.5, y: 6.5 }, 0, (colour + 1) % 4);
      draw(sim, [...ring, ring[0]]);
      const plan = planChain(w);
      assert(w.chainClosed && plan.seal && plan.seal.damage > 0, `seed ${k}, open ${open}: the ring closed (${w.chainClosed}, ${JSON.stringify(plan.seal?.inside)})`);
      assert(plan.seal.inside.includes(inner.id) && !plan.seal.inside.includes(core.id), `seed ${k}, open ${open}: the seal strikes the inner one, not the core (${plan.seal.inside})`);
      const plates = core.armor!.plates, hp = core.hp;
      sim.command({ t: 'release' });
      const out = settle(sim);
      ticks(sim, 1, out);
      assert(!w.enemies.includes(inner) && core.armor?.plates === plates && core.hp === hp, `seed ${k}, open ${open}: the inner one died, the core whole`);
      assert(feastEvents(out, 'block').some(e => e.source === 'seal') && !feastEvents(out, 'hit').length && !feastEvents(out, 'big').length, `seed ${k}, open ${open}: the seal's «звон» (${JSON.stringify(feastEvents(out))})`);
      assert(replays(sim), `seed ${k}, open ${open}: replay`);
    }
  }
});

console.log(`chief: ${checks} checks passed`);
