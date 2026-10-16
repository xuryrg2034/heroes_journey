/**
 * Task 48 «Тролль» — the boss of the forest in the sandbox (sim/enemies/troll.ts, sim/arenasBoss.ts `troll`; docs/realtime-elite-
 * behaviors.md, «Тролль (задача 48)»). Node only: `npm run test:realtime-troll`.
 *
 * Every check plays journalled commands (teleport, place, chill, item, param, begin / drag, release, walk) and looks at what the
 * player meets — the problem of the playtest «подошёл и закликал»:
 * - outside a window the core is refused (`outOfWindow`, «вне окна»), a click on it takes nothing, the fire on it and the cutting
 *   dash past it do not hurt it (event `trollWindow` `block`);
 * - «Удар дубиной» opens the window for 1.5 s: a chain into the core takes a plate (the highlight = the dash), a second chain in the
 *   same window is refused; the return run of «Возврат» passes the struck core by (the highlight's and the run's) — without the key the
 *   same journal strikes it twice;
 * - the window ends while the core is in the drawn chain: the core and the links after it leave the chain, the highlight is the rest's;
 * - a severed part: its move never starts again, one winding up is dropped, the core loses a plate after the dash;
 * - the phases by a part, by plates, by time (×0.85 with the kit's `phaseScale`); «Рык» — a wolf from each lair, the living parts'
 *   colours, at most 4 wolves; «Храп» — left alone +1 plate (not above the start's), struck — nothing, the parts do not strike;
 * - the cold: the core's windup and window wait, the cold opens no window; the core's death ends the fight, the door opens;
 * - the worst point «посадка на месте отрубленной части» in the tail's ring: the hero walks out before the strike;
 * - every fight replays from its journal; a world without the key plays the old path (the core open).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { TROLL_BACK } from './arenasBoss';
import { HAMMERS } from './buildIds';
import { enemyRefusal, planChain, REFUSAL_TEXT } from './chain';
import {
  CLUB_LIE, MOVE_GAP, PHASE2_TIME, PHASE3_TIME, ROAR_WINDUP, ROAR_WOLVES_MAX, TAIL_OUTER, TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL, trollMove, trollState,
} from './enemies/troll';
import { heroRadius, defaultParams, type Params } from './params';
import type { Vec } from './geometry';
import type { Loadout } from './kit';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { analyzeJournal } from '../telemetry/report';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

/** Nothing comes but the Troll's own wolves, the hero cannot fall, nobody walks, no touch. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  return Object.assign(p, extra);
}
interface Den { sim: Simulation; w: World; core: Enemy; club: Enemy; rock: Enemy; tail: Enemy }
/** «Берлога тролля», the hero at (12, 12) — out of every move's reach; one tick. */
function den(k = 1, extra: Partial<Params> = {}, loadout?: Loadout, params?: Params): Den {
  const sim = new Simulation({ arena: 'troll', params: params ?? quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 12 });
  ticks(sim, 1);
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  return { sim, w, core: kind(TROLL), club: kind(TROLL_CLUB), rock: kind(TROLL_ROCK), tail: kind(TROLL_TAIL) };
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
/** Ticks until the hero stands again (the dash and its return run over); `during` sees the world while it runs. */
function settle(sim: Simulation, out: WorldEvent[] = [], during?: (w: World) => void): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); if (sim.world.move) during?.(sim.world); }
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
const windowEvents = (events: readonly WorldEvent[], action: Ev<'trollWindow'>['action']): Ev<'trollWindow'>[] => of(events, 'trollWindow').filter(e => e.action === action);
const starts = (events: readonly WorldEvent[], move: string): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.move === move && e.stage === 'start');
const strikes = (events: readonly WorldEvent[], move: string): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.move === move && e.stage === 'hit');
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const freeze = (sim: Simulation, e: Enemy, seconds = 600): void => { sim.command({ t: 'chill', id: e.id, seconds }); };
/** Beside the core, off the tail's knot and the braziers: the core is a link of one (within R of its edge). */
const BESIDE: Vec = { x: 11.4, y: 4.2 };

/** The club's window: the rock frozen (the club's move alone), the hero in the club's reach until «Удар дубиной» strikes; then beside the core. */
function clubWindow(d: Den, out: WorldEvent[] = [], source = 'club'): WorldEvent[] {
  freeze(d.sim, d.rock);
  d.sim.command({ t: 'teleport', x: 12, y: 6.5 });
  ticks(d.sim, ticksOf(12), out, (_w, events) => windowEvents(events, 'open').length > 0);
  const open = windowEvents(out, 'open').at(-1);
  assert(open?.source === source, `the ${source} opened the window (${JSON.stringify(open)})`);
  d.sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
  return out;
}

check('outside a window the core is refused (`outOfWindow`, «вне окна») — clicks beside it take nothing; the fire on it and the cutting dash past it do not hurt it (`block`)', () => {
  for (const k of SEEDS) {
    const d = den(k, {}, { items: { fire: 1 }, hammer: HAMMERS.cut }), { sim, w, core } = d;
    // No window opens: the club and the rock frozen (phase 1 has no tail).
    freeze(sim, d.club); freeze(sim, d.rock);
    sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
    ticks(sim, 1);
    assert(enemyRefusal(w, core) === 'outOfWindow' && REFUSAL_TEXT.outOfWindow === 'вне окна', `seed ${k}: refused (${enemyRefusal(w, core)})`);
    assert(core.armor?.plates === 5 && core.hp === 4 && core.armor.max === 5, `seed ${k}: 5 plates, HP 4`);
    // «Подошёл и закликал»: five clicks on the core.
    for (let n = 0; n < 5; n++) {
      sim.command({ t: 'begin', x: core.x, y: core.y });
      assert(w.chain.length === 0, `seed ${k}: click ${n} takes nothing`);
      sim.command({ t: 'release' });
      ticks(sim, 20);
    }
    const events: WorldEvent[] = [];
    // The fire on the core: three ticks of burning, each blocked.
    sim.command({ t: 'item', kind: 'fire', x: core.x, y: core.y });
    ticks(sim, ticksOf(5), events);
    const fire = windowEvents(events, 'block').filter(e => e.source === 'fire');
    assert(fire.length === 3 && !of(events, 'enemyHit').some(e => e.enemyId === core.id), `seed ${k}: the fire is blocked three times (${fire.length})`);
    // The cutting dash past the core (its path 0.65 from the centre: the body of 0.32 within the cut's 0.5), northwards beside it.
    sim.command({ t: 'teleport', x: 12.65, y: 6 });
    const links = [4.9, 3.7, 2.5].map(y => place(sim, { x: 12.65, y }, 0, 0));
    draw(sim, links);
    assert(w.chain.length === 3, `seed ${k}: the chain past the core (${w.chain.length})`);
    sim.command({ t: 'release' });
    const cut = settle(sim);
    assert(of(cut, 'hammer').some(e => e.kind === 'cut') && windowEvents(cut, 'block').some(e => e.source === 'hammer-cut'), `seed ${k}: the cut reached the core and was blocked`);
    assert(core.armor?.plates === 5 && core.hp === 4 && windowEvents([...events, ...cut], 'hit').length === 0, `seed ${k}: the core untouched (${core.armor?.plates}, ${core.hp})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Удар дубиной» opens the window: a chain into the core takes a plate (the highlight = the dash); a second chain in the same window is refused; after the window — refused again', () => {
  for (const k of SEEDS) {
    const d = den(k), { sim, w, core } = d;
    const events = clubWindow(d);
    assert(starts(events, 'club').length === 1 && strikes(events, 'club').length === 1, `seed ${k}: one club`);
    const state = trollState(w)!;
    assert(state.window?.source === 'club' && state.window.open && Math.abs(state.window.left - 1.5) < 0.05 && state.rule, `seed ${k}: the window 1.5 s (${JSON.stringify(state)})`);
    assert(enemyRefusal(w, core) === null, `seed ${k}: the core may be taken (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    const plan = planChain(w), outcome = plan.links[0]?.outcome;
    assert(w.chain.length === 1 && outcome?.plate && outcome.platesAfter === 4, `seed ${k}: the highlight takes a plate (${JSON.stringify(outcome)})`);
    assert(plan.trollDrop?.index === 0 && plan.trollDrop.left > 1, `seed ${k}: the highlight knows the window's time (${JSON.stringify(plan.trollDrop)})`);
    sim.command({ t: 'release' });
    const dash = settle(sim);
    assert(core.armor?.plates === 4 && core.hp === 4, `seed ${k}: the dash took the plate (${core.armor?.plates})`);
    assert(windowEvents(dash, 'hit').length === 1 && windowEvents(dash, 'hit')[0].source === 'chain', `seed ${k}: the window's hit — the chain`);
    // The window had time left: the hit spent it — a second chain is refused, a click takes nothing.
    assert(enemyRefusal(w, core) === 'outOfWindow', `seed ${k}: the second chain refused (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    assert((w.chain.length as number) === 0, `seed ${k}: no second chain`);
    ticks(sim, 1, dash);
    assert(windowEvents(dash, 'close').length === 1 && !trollState(w)!.window, `seed ${k}: the window closed after the dash`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Возврат»: the return run passes the struck core by — the highlight\'s run has no outcome on it and the run takes no second plate; without the key the same journal strikes it twice', () => {
  for (const k of SEEDS) {
    // `returnFixed` (the sandbox's) — the release fixes the highlight's run; off (the run's) — the run finds its bodies as it goes.
    for (const fixed of [true, false]) {
    const one = (window: boolean): { plates: number; backHits: number[]; core: number } => {
      // Without the key at all (an older journal): the arena does not turn it on (it does only when the values have it off).
      const params = quiet({ returnFixed: fixed });
      if (!window) delete (params as Partial<Params>).trollWindow;
      const d = den(k, {}, { hammer: HAMMERS.return }, params), { sim, w, core } = d;
      assert(!!w.params.trollWindow === window, `seed ${k}: the key ${window}`);
      clubWindow(d);
      // The core, then a weak link behind it: the dash takes the core's plate on its way, kills the link; the run comes back past the core.
      sim.command({ t: 'teleport', x: 12.5, y: 4.3 });
      const behind = place(sim, { x: 12.95, y: 1.92 }, 0, 0);
      draw(sim, [core, behind]);
      assert(w.chain.length === 2, `seed ${k}: the chain core → behind (${w.chain.length})`);
      const plan = planChain(w);
      assert(plan.links[0].outcome?.plate && plan.links[1].outcome?.killed && plan.back, `seed ${k}: the plan — a plate, a kill, a run back`);
      const backHits = plan.back!.hits.map(h => h.id);
      // Every other body the highlight's run strikes — struck by the run (no power lost on the core first).
      const others = plan.back!.hits.filter(h => h.id !== core.id).map(h => ({ e: w.enemies.find(x => x.id === h.id)!, outcome: h.outcome }));
      sim.command({ t: 'release' });
      settle(sim);
      if (window) for (const { e, outcome } of others) {
        const now = w.enemies.includes(e) ? (outcome.plate ? e.armor?.plates : e.hp) : 'dead';
        const want = outcome.killed ? 'dead' : outcome.plate ? outcome.platesAfter : outcome.hpAfter;
        assert(now === want, `seed ${k}, fixed ${fixed}: the run struck ${e.kind} as the highlight said (${now} vs ${want})`);
      }
      assert(!window || others.length > 0, `seed ${k}: the run strikes another body past the core`);
      assert(replays(sim), `seed ${k}: replay`);
      return { plates: core.armor!.plates, backHits, core: core.id };
    };
    const kept = one(true), old = one(false);
    assert(!kept.backHits.includes(kept.core) && kept.plates === 4, `seed ${k}, fixed ${fixed}: with the window — the run passes the core (${JSON.stringify(kept)})`);
    assert(old.backHits.includes(old.core) && old.plates === 3, `seed ${k}, fixed ${fixed}: without the key — the run strikes it again (${JSON.stringify(old)})`);
    }
  }
});

check('the hit is held for the hero: a burning tick on the core while a chain to it is drawn, or while the released dash runs whose return run strikes it, is blocked — the chain and the run take the plate as the highlight said', () => {
  for (const k of SEEDS) {
    for (const by of ['drawn', 'return'] as const) {
      const d = den(k, {}, { items: { fire: 1 }, hammer: HAMMERS.return }), { sim, w, core } = d;
      freeze(sim, d.rock);
      sim.command({ t: 'teleport', x: 12, y: 6.5 });
      ticks(sim, ticksOf(4), [], (_w, ev) => starts(ev, 'club').length > 0);
      // The fire 0.5 s into the club's windup: its first tick comes 0.5 s into the window.
      ticks(sim, ticksOf(0.5));
      sim.command({ t: 'item', kind: 'fire', x: core.x, y: core.y });
      ticks(sim, ticksOf(3), [], (_w, ev) => windowEvents(ev, 'open').length > 0);
      assert(trollState(w)?.window?.source === 'club', `seed ${k}: the club's window`);
      const events: WorldEvent[] = [];
      if (by === 'drawn') {
        sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
        draw(sim, [core]);
        assert(w.chain.length === 1 && planChain(w).links[0].outcome?.plate, `seed ${k}: the chain holds the core`);
        ticks(sim, ticksOf(0.7), events);
        assert(w.chain.length === 1, `seed ${k}: still in the chain after the burning tick`);
        sim.command({ t: 'release' });
        settle(sim, events);
        assert(windowEvents(events, 'hit').map(e => e.source).join() === 'chain', `seed ${k}: the window's hit — the chain (${JSON.stringify(windowEvents(events, 'hit'))})`);
      } else {
        // Three weak links up to the core's side (0.65 from its centre): the return run comes back along them and strikes it first.
        sim.command({ t: 'teleport', x: 12.65, y: 6 });
        const links = [4.9, 3.7, 2.5].map(y => place(sim, { x: 12.65, y }, 0, 0));
        ticks(sim, ticksOf(0.3));
        draw(sim, links);
        const plan = planChain(w);
        assert(w.chain.length === 3 && plan.back?.hits.some(h => h.id === core.id), `seed ${k}: the highlight's return run strikes the core`);
        sim.command({ t: 'release' });
        settle(sim, events);
        assert(windowEvents(events, 'hit').map(e => e.source).join() === 'hammer-return', `seed ${k}: the window's hit — the return run (${JSON.stringify(windowEvents(events, 'hit'))})`);
      }
      assert(windowEvents(events, 'block').some(e => e.source === 'fire') && core.armor?.plates === 4, `seed ${k}, ${by}: the burning tick blocked, one plate taken (${core.armor?.plates})`);
      assert(replays(sim), `seed ${k}, ${by}: replay`);
    }
  }
});

check('the window ends while the core is in the drawn chain: the core and the links after it leave the chain (`unlink`), the highlight is the rest\'s and the dash does just that; released in time — the dash is the highlight', () => {
  for (const k of SEEDS) {
    for (const hold of [true, false]) {
      const d = den(k), { sim, w, core } = d;
      clubWindow(d);
      sim.command({ t: 'teleport', x: 12.3, y: 6 });
      const before = place(sim, { x: 12.6, y: 4.2 }, 0, 0), behind = place(sim, { x: 12.95, y: 1.92 }, 0, 0);
      draw(sim, [before, core, behind]);
      const drawn = w.chain.map(l => l.id);
      assert(drawn.length === 3 && drawn[1] === core.id, `seed ${k}: the chain holds the core (${drawn})`);
      const plan = planChain(w);
      assert(plan.trollDrop?.index === 1, `seed ${k}: the highlight marks the core (${JSON.stringify(plan.trollDrop)})`);
      if (hold) {
        // Held until the window ends (the next «Удар дубиной» winds up then: released at once).
        const events = ticks(sim, ticksOf(2.5), [], (_w, ev) => windowEvents(ev, 'unlink').length > 0);
        const unlink = windowEvents(events, 'unlink')[0];
        assert(unlink && JSON.stringify(unlink.dropped) === JSON.stringify(drawn.slice(1)) && JSON.stringify(w.chain.map(l => l.id)) === JSON.stringify([before.id]), `seed ${k}: the core and after it dropped (${JSON.stringify(unlink)})`);
        const rest = planChain(w);
        assert(rest.links.length === 1 && rest.links[0].outcome?.killed && !rest.trollDrop, `seed ${k}: the highlight is the rest's (${JSON.stringify(rest)}, ${w.enemies.includes(before)})`);
        sim.command({ t: 'release' });
        settle(sim);
        assert(!w.enemies.includes(before) && w.enemies.includes(behind) && core.armor?.plates === 5, `seed ${k}: the dash did the rest`);
      } else {
        const expect = plan.links.map(l => l.outcome);
        sim.command({ t: 'release' });
        settle(sim);
        assert(expect[0]?.killed && !w.enemies.includes(before) && expect[1]?.plate && core.armor?.plates === expect[1].platesAfter && expect[2]?.killed && !w.enemies.includes(behind),
          `seed ${k}: the dash is the highlight (${JSON.stringify(expect)}, plates ${core.armor?.plates})`);
      }
      assert(replays(sim), `seed ${k}, hold ${hold}: replay`);
    }
  }
});

/** The rock severed by a chain of two weak links of its colour (HP 3, no plate): the hero below it. */
function severRock(d: Den, out: WorldEvent[] = []): WorldEvent[] {
  const { sim, w, rock } = d;
  sim.command({ t: 'teleport', x: 13.5, y: 6 });
  const links = [4.8, 3.7].map(y => place(sim, { x: 13.5, y }, 0, rock.color));
  draw(sim, [...links, rock]);
  assert(w.chain.length === 3, `the chain reaches the rock (${w.chain.length})`);
  const plan = planChain(w);
  assert(plan.links[2].outcome?.killed && plan.links[2].severs, 'the highlight: the rock severed');
  sim.command({ t: 'release' });
  settle(sim, out);
  ticks(sim, 1, out);
  return out;
}

check('a severed part: its move winding up is dropped at once, it never starts again; the core loses a plate after the dash; phase 2 comes', () => {
  for (const k of SEEDS) {
    const d = den(k), { sim, w, core } = d;
    freeze(sim, d.club);
    sim.command({ t: 'teleport', x: 13.5, y: 6 });
    const events = ticks(sim, ticksOf(6), [], (_w, ev) => starts(ev, 'rock').length > 0);
    assert(starts(events, 'rock').length === 1 && core.vars.mv === 2, `seed ${k}: «Бросок камня» winds up`);
    const sever = severRock(d);
    assert(of(sever, 'partSevered').length === 1 && !w.enemies.includes(d.rock), `seed ${k}: the rock severed`);
    assert(of(sever, 'bossPlate').some(e => e.plates === 4) && core.armor?.plates === 4, `seed ${k}: −1 plate after the dash (${core.armor?.plates})`);
    assert(!strikes(sever, 'rock').length && core.vars.mv !== 2, `seed ${k}: the throw dropped`);
    assert(of(sever, 'bossPhase').some(e => e.phase === 2) && core.vars.phase === 2, `seed ${k}: phase 2 by a part`);
    const later = ticks(sim, ticksOf(20));
    assert(!starts(later, 'rock').length, `seed ${k}: no throw again`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('phases: 2 at 30 s and 3 at 70 s without a hit (×0.85 with the kit\'s `phaseScale`: 25.5 and 59.5 s); 3 by plates at 2 (through 2 in the same tick)', () => {
  for (const scale of [1, 0.85]) {
    const { sim, w } = den(1, {}, scale === 1 ? undefined : { phaseScale: scale });
    // The hero in the south-west corner, out of every reach: no move, no hit.
    sim.command({ t: 'teleport', x: 1.5, y: 14 });
    const times: Record<number, number> = {};
    for (let i = 0; i < ticksOf(75); i++) { sim.tick(); for (const e of of(w.events.splice(0), 'bossPhase')) times[e.phase] = w.time; }
    assert(Math.abs(times[2] - PHASE2_TIME * scale) < 0.05 && Math.abs(times[3] - PHASE3_TIME * scale) < 0.05, `×${scale}: phases at ${JSON.stringify(times)}`);
    assert(replays(sim), `×${scale}: replay`);
  }
  for (const k of SEEDS) {
    const d = den(k, { trollPlates: 3 }), { sim, w, core } = d;
    clubWindow(d);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    const events = settle(sim);
    ticks(sim, 1, events);
    const phases = of(events, 'bossPhase').map(e => e.phase);
    assert(core.armor?.plates === 2 && JSON.stringify(phases) === '[2,3]' && core.vars.phase === 3, `seed ${k}: 2 plates — phases ${phases}`);
    assert(replays(sim), `seed ${k}: replay`);
    void w;
  }
});

check('«Рык»: in phase 2 a wolf marker at each of the three lairs, coloured by the living parts in turn; at most 4 wolves', () => {
  for (const k of SEEDS) {
    for (const already of [0, 2]) {
      const d = den(k), { sim, w } = d;
      freeze(sim, d.club);
      severRock(d);
      const parts = [d.club, d.tail].map(p => p.color);
      for (let i = 0; i < already; i++) place(sim, { x: 18 + i, y: 13 }, 0, 0, 'wolf');
      sim.command({ t: 'teleport', x: 20, y: 13 });
      const events = ticks(sim, ticksOf(MOVE_GAP + ROAR_WINDUP + 1), [], (_w, ev) => strikes(ev, 'roar').length > 0);
      assert(starts(events, 'roar').length === 1 && strikes(events, 'roar').length === 1, `seed ${k}: the roar`);
      const markers = w.markers.filter(m => m.kind === 'wolf');
      const gates = w.arena.gates!;
      assert(markers.length === Math.min(gates.length, ROAR_WOLVES_MAX - already), `seed ${k}, ${already} wolves: ${markers.length} markers`);
      markers.forEach((m, i) => {
        assert(Math.abs(m.x - gates[i].x) < 1e-9 && Math.abs(m.y - gates[i].y) < 1e-9 && m.color === parts[i % parts.length], `seed ${k}: the marker ${i} at its lair, the part's colour (${m.color} vs ${parts})`);
      });
      ticks(sim, ticksOf(1.1));
      assert(w.enemies.filter(e => e.kind === 'wolf').length === Math.min(ROAR_WOLVES_MAX, already + gates.length), `seed ${k}: the wolves stand`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('«Храп»: left alone +1 plate (not above the start\'s), the window open all along and the parts do not strike; struck — he wakes, nothing regrows', () => {
  for (const k of SEEDS) {
    // 3 plates: the rock severed — 2 plates, phases 2 and 3; then «Рык», then «Храп».
    const d = den(k, { trollPlates: 3 }), { sim, w, core } = d;
    severRock(d);
    assert(core.vars.phase === 3 && core.armor?.plates === 2, `seed ${k}: phase 3 at 2 plates`);
    // The hero in the club's reach (and out of the tail's): no part strikes while he sleeps.
    sim.command({ t: 'teleport', x: 12, y: 6.8 });
    const toSnore = ticks(sim, ticksOf(20), [], (_w, ev) => starts(ev, 'snore').length > 0);
    assert(starts(toSnore, 'snore').length === 1 && trollState(w)!.snore !== null && trollState(w)!.window?.source === 'snore', `seed ${k}: asleep`);
    const asleep = ticks(sim, ticksOf(4.2));
    assert(!starts(asleep, 'club').length && !starts(asleep, 'tail').length, `seed ${k}: the parts do not strike in his sleep`);
    assert(strikes(asleep, 'snore').length === 1 && (core.armor?.plates as number) === 3 && of(asleep, 'bossPlate').some(e => e.plates === 3), `seed ${k}: +1 plate (${core.armor?.plates})`);
    // The second sleep: the ceiling of 3 — no plate more. The hero far away (no moves of the parts in between).
    sim.command({ t: 'teleport', x: 1.5, y: 12 });
    const second = ticks(sim, ticksOf(14), [], (_w, ev) => strikes(ev, 'snore').length > 0);
    assert(strikes(second, 'snore').length === 1 && (core.armor?.plates as number) === 3 && !of(second, 'bossPlate').length, `seed ${k}: not above the start's (${core.armor?.plates})`);
    // The third sleep, struck: the window's hit — no regrowth.
    ticks(sim, ticksOf(10), [], (_w, ev) => starts(ev, 'snore').length > 0);
    assert(trollState(w)!.snore !== null, `seed ${k}: asleep again`);
    sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
    sim.command({ t: 'begin', x: core.x, y: core.y });
    assert(w.chain.length === 1, `seed ${k}: the sleeping core is a link`);
    sim.command({ t: 'release' });
    const woke = settle(sim);
    ticks(sim, ticksOf(5), woke);
    assert(core.armor?.plates === 2 && !strikes(woke, 'snore').length && windowEvents(woke, 'close').some(e => e.source === 'snore'), `seed ${k}: woken — no regrowth (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the cold: a frozen core\'s windup and window wait; the cold opens no window', () => {
  for (const k of SEEDS) {
    const d = den(k), { sim, w, core } = d;
    freeze(sim, d.rock);
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    ticks(sim, ticksOf(4), [], (_w, ev) => starts(ev, 'club').length > 0);
    assert(core.vars.mv === 1, `seed ${k}: the club winds up`);
    freeze(sim, core, 3);
    const frozen = ticks(sim, ticksOf(2.9));
    assert(!strikes(frozen, 'club').length && !trollState(w)!.window && enemyRefusal(w, core) === 'outOfWindow', `seed ${k}: no strike, no window while frozen`);
    const after = ticks(sim, ticksOf(2), [], (_w, ev) => strikes(ev, 'club').length > 0);
    assert(strikes(after, 'club').length === 1 && trollState(w)!.window?.open, `seed ${k}: thawed — the strike, the window`);
    // Frozen in the window: its seconds wait.
    const left = trollState(w)!.window!.left;
    freeze(sim, core, 2);
    ticks(sim, ticksOf(1.8));
    sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
    assert(Math.abs(trollState(w)!.window!.left - left) < 1e-9 && enemyRefusal(w, core) === null, `seed ${k}: the window waits (${left} → ${trollState(w)!.window!.left})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the core\'s death ends the fight: the crowd and the parts die with it (not the player\'s), the door opens', () => {
  for (const k of SEEDS) {
    // No plates: phase 3 from the start — «Рык», then «Храп» opens the window.
    const d = den(k, { trollPlates: 0, trollHp: 1 }), { sim, w, core } = d;
    clubWindow(d, [], 'snore');
    sim.command({ t: 'begin', x: core.x, y: core.y });
    const plan = planChain(w);
    assert(plan.links[0].outcome?.killed && plan.bossClear, `seed ${k}: the highlight — the boss dies`);
    sim.command({ t: 'release' });
    const events = settle(sim);
    ticks(sim, 1, events);
    assert(w.bossCleared && !w.enemies.length && w.stage === 'greed', `seed ${k}: the fight ended, the door open`);
    assert(of(events, 'kill').filter(e => e.source === 'boss-clear').length >= 3, `seed ${k}: the parts died with it`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the worst point «посадка на месте отрубленной части» in the tail\'s ring: the club severed while «Хвост метёт» winds up — the hero lands ≈1.6 from the core and walks out before the strike, in phase 2 and in phase 3 (the tail is not sped up there)', () => {
  let measured = 0;
  for (const k of SEEDS) for (const phase3 of [false, true]) {
    // Phase 3: 3 plates — the rock severed leaves 2 (phases 2 and 3 at once).
    const d = den(k, phase3 ? { trollPlates: 3 } : {}), { sim, w, core, club } = d;
    // The club frozen all along: it stays in hand (the tail's move alone in phase 2).
    freeze(sim, club);
    severRock(d);
    // The club's plate first (a plate pass: the hero goes back to his stop).
    sim.command({ t: 'teleport', x: 10.5, y: 4.6 });
    draw(sim, [club]);
    sim.command({ t: 'release' });
    settle(sim);
    assert(club.armor?.plates === 0, `seed ${k}: the club's plate gone`);
    // The tail in reach (and the club too): wait for the second «Хвост метёт» (the first winds up ×1.5).
    sim.command({ t: 'teleport', x: 12, y: 5.6 });
    let tails = 0, events: WorldEvent[] = [];
    for (let i = 0; i < 12 && tails < 2; i++) {
      events = ticks(sim, ticksOf(8), [], (_w, ev) => starts(ev, 'tail').length > 0);
      if (starts(events, 'tail').length) tails++;
      if (tails < 2) ticks(sim, ticksOf(1.5));
      sim.command({ t: 'teleport', x: 12, y: 5.6 });
    }
    assert(tails === 2 && core.vars.mv === 3 && core.vars.phase === (phase3 ? 3 : 2), `seed ${k}, phase 3 ${phase3}: the second tail winds up (phase ${core.vars.phase})`);
    const due = w.time + core.vars.t;
    // Sever the club: four weak links of its colour (HP 4) from the hero at the ring's edge.
    sim.command({ t: 'teleport', x: 8.2, y: 6.4 });
    const links = [{ x: 8.6, y: 5.3 }, { x: 9.2, y: 4.3 }, { x: 10.2, y: 4.6 }].map(p => place(sim, p, 0, club.color));
    draw(sim, [...links, club]);
    assert(w.chain.length === 4 && planChain(w).links[3].severs, `seed ${k}: the chain severs the club (${w.chain.length})`);
    sim.command({ t: 'release' });
    settle(sim);
    const hero = w.hero, dx = hero.x - core.x, dy = hero.y - core.y, d0 = Math.sqrt(dx * dx + dy * dy), left = due - w.time;
    const need = 0.2 + (TAIL_OUTER + heroRadius(w.params) - d0) / w.params.heroSpeed;
    console.log(`   seed ${k}, Ф${phase3 ? 3 : 2}: посадка в ${d0.toFixed(2)} от ядра (кольцо 1,2–3,2), до удара ${left.toFixed(2)} с, нужно ${need.toFixed(2)} с`);
    assert(!w.enemies.includes(club) && d0 < TAIL_OUTER, `seed ${k}: landed in the ring`);
    sim.command({ t: 'walk', x: dx / d0, y: dy / d0 });
    const out = ticks(sim, ticksOf(left + 0.3));
    assert(strikes(out, 'tail').length === 1 && !of(out, 'hit').some(e => e.source === 'troll-tail'), `seed ${k}: walked out before the strike`);
    measured++;
    void CLUB_LIE;
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(measured === SEEDS.length * 2, 'measured');
});

check('a strike due while the hero\'s dash runs waits for its end (the highlight stays what the dash does); then it strikes and opens the window', () => {
  for (const k of SEEDS) {
    const d = den(k), { sim, w, core } = d;
    freeze(sim, d.rock);
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    ticks(sim, ticksOf(4), [], (_w, ev) => starts(ev, 'club').length > 0);
    ticks(sim, ticksOf(3), [], () => core.vars.t < 0.05);
    const links = [7.7, 8.9, 10.1, 11.3].map(y => place(sim, { x: 12, y }, 0, 0));
    draw(sim, links);
    assert(w.chain.length === 4, `seed ${k}: a long chain (${w.chain.length})`);
    sim.command({ t: 'release' });
    let during = 0, after = -1, moved = 0;
    for (let i = 0; i < ticksOf(2) && after < 0; i++) {
      sim.tick();
      const hit = strikes(w.events.splice(0), 'club').length > 0;
      if (w.move) { moved++; if (hit) during++; } else if (hit) after = i;
    }
    assert(moved > 3 && during === 0 && after >= 0 && trollState(w)?.window?.source === 'club', `seed ${k}: no strike during the dash (${moved} ticks), then the strike (${after})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Прямая» (sandbox `pierceEnabled`): outside a window it passes the core by — the highlight has no outcome on it, the core is untouched; in the window it takes a plate as the highlight said', () => {
  for (const k of SEEDS) {
    for (const open of [false, true]) {
      const d = den(k, { pierceEnabled: true }), { sim, w, core } = d;
      if (open) clubWindow(d); else { freeze(sim, d.club); freeze(sim, d.rock); }
      // Three weak links on a straight line from the south-east towards the core; the pierce's corridor beyond holds only the core.
      sim.command({ t: 'teleport', x: 15.6, y: 5.8 });
      const links = [[14.83, 5.03], [13.98, 4.18], [13.13, 3.33]].map(([x, y]) => place(sim, { x, y }, 0, 0));
      draw(sim, links);
      const plan = planChain(w), body = plan.pierce?.bodies.find(b => b.id === core.id);
      assert(w.chain.length === 3 && plan.pierce, `seed ${k}: a pierce (${w.chain.length}, ${!!plan.pierce})`);
      assert(open ? body?.outcome.plate === true : !body, `seed ${k}, open ${open}: the highlight on the core (${JSON.stringify(body)})`);
      sim.command({ t: 'release' });
      const events = settle(sim);
      assert(core.armor?.plates === (open ? 4 : 5), `seed ${k}, open ${open}: plates ${core.armor?.plates}`);
      assert(open ? windowEvents(events, 'hit').some(e => e.source === 'pierce') : !windowEvents(events, 'block').length, `seed ${k}, open ${open}: the pierce's hit or no try at all`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('«Печать» (sandbox `loopEnabled`): a ring of four links round the closed core — the highlight has it outside the seal\'s strike and the core is untouched; in the window — one hit, a plate, as the highlight said', () => {
  for (const k of SEEDS) {
    for (const open of [false, true]) {
      const d = den(k, { loopEnabled: true }), { sim, w, core } = d;
      if (open) clubWindow(d); else { freeze(sim, d.club); freeze(sim, d.rock); }
      // The ring: four weak links round the core (the club, the rock and the tail's knot stay outside), closed on the first.
      sim.command({ t: 'teleport', x: 10.8, y: 1.95 });
      const links = [[11.2, 1.95], [12.8, 1.95], [12.8, 3], [11.2, 3]].map(([x, y]) => place(sim, { x, y }, 0, 0));
      draw(sim, [...links, links[0]]);
      const plan = planChain(w), seal = plan.seal;
      assert(w.chain.length === 4 && w.chainClosed && seal, `seed ${k}: the ring closed (${w.chain.length}, ${w.chainClosed})`);
      assert(seal.inside.includes(core.id) === open, `seed ${k}, open ${open}: the highlight's seal on the core (${JSON.stringify(seal.inside)})`);
      sim.command({ t: 'release' });
      const events = settle(sim);
      ticks(sim, 1, events);
      assert(core.armor?.plates === (open ? 4 : 5) && core.hp === 4, `seed ${k}, open ${open}: plates ${core.armor?.plates}`);
      const hits = windowEvents(events, 'hit');
      assert(open ? hits.length === 1 && hits[0].source === 'seal' : !hits.length && !windowEvents(events, 'block').length, `seed ${k}, open ${open}: the seal's one hit or no try (${JSON.stringify(hits)})`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('no place at the Troll\'s back: the hero walking north through him, or jumping behind him, never stands between his body and the den\'s back wall', () => {
  for (const k of SEEDS) {
    for (const x of [11.4, 12, 12.6]) {
      const d = den(k), { sim, w, core } = d;
      freeze(sim, d.club); freeze(sim, d.rock);
      const limit = TROLL_BACK + heroRadius(w.params) - 1e-6;
      sim.command({ t: 'teleport', x, y: 5 });
      sim.command({ t: 'walk', x: 0, y: -1 });
      let least = Infinity;
      for (let i = 0; i < ticksOf(3); i++) { sim.tick(); w.events.length = 0; least = Math.min(least, w.hero.y); }
      assert(least >= limit && least > core.y - 0.6, `seed ${k}, x ${x}: walked up to y ${least.toFixed(2)} (the back at ${TROLL_BACK})`);
      // A jump towards the back: refused, or it lands off the wall (never behind the body).
      sim.command({ t: 'walk', x: 0, y: 0 });
      sim.command({ t: 'teleport', x, y: 3.4 });
      sim.command({ t: 'energy', value: 7 });
      sim.command({ t: 'jump', x, y: 0.6 });
      settle(sim);
      assert(w.hero.y >= limit, `seed ${k}, x ${x}: the jump landed at y ${w.hero.y.toFixed(2)}`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('the view\'s read of «Удар дубиной»: a lane 4.5 × 1.6 from the core\'s edge towards the hero', () => {
  const d = den(1), { sim, w, core } = d;
  freeze(sim, d.rock);
  sim.command({ t: 'teleport', x: 12, y: 6.5 });
  ticks(sim, ticksOf(4), [], (_w, ev) => starts(ev, 'club').length > 0);
  const move = trollMove(w)!;
  const r = core.vars.ax - core.x, len = Math.hypot(move.to!.x - move.from!.x, move.to!.y - move.from!.y);
  assert(move.move === 'club' && Math.abs(len - 4.5) < 1e-6 && Math.abs(move.from!.y - core.y - 0.32) < 0.01 && Math.abs(r) < 1e-6 && move.width === 1.6, `the lane: ${JSON.stringify(move)}`);
});

check('a world without the key (`trollWindow` absent, as an older journal): the core is open always — a chain takes it outside any window', () => {
  for (const k of SEEDS) {
    const params = quiet();
    delete (params as Partial<Params>).trollWindow;
    const d = den(k, {}, undefined, params), { sim, w, core } = d;
    assert(w.params.trollWindow === undefined, `seed ${k}: no key`);
    freeze(sim, d.club); freeze(sim, d.rock);
    sim.command({ t: 'teleport', x: BESIDE.x, y: BESIDE.y });
    ticks(sim, 1);
    assert(enemyRefusal(w, core) === null, `seed ${k}: no refusal (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    settle(sim);
    assert(core.armor?.plates === 4, `seed ${k}: a plate taken outside the window`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the fight summary of the boss (`boss.troll`, by the replay): the fire blocked, the window of the club with its hit, the rock severed, phase 2', () => {
  for (const k of SEEDS) {
    const d = den(k, {}, { items: { fire: 1 } }), { sim, core } = d;
    freeze(sim, d.club); freeze(sim, d.rock);
    sim.command({ t: 'item', kind: 'fire', x: core.x, y: core.y });
    ticks(sim, ticksOf(5));
    freeze(sim, d.club, 0);
    clubWindow(d);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    sim.command({ t: 'release' });
    settle(sim);
    ticks(sim, 1);
    freeze(sim, d.rock, 0);
    severRock(d);
    const boss = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal).summary.boss, t = boss?.troll;
    assert(t && t.blocks.fire === 3 && t.windows.club?.opened === 1 && t.windows.club.hit === 1, `seed ${k}: the windows and the blocks (${JSON.stringify(t)})`);
    assert(t.parts.length === 1 && t.parts[0].kind === TROLL_ROCK && t.phase === 2 && (boss!.moves.club ?? 0) >= 1, `seed ${k}: the parts and the phase (${JSON.stringify(t.parts)}, ${t.phase})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

console.log(`troll: ${checks} checks passed`);
