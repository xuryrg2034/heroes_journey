/**
 * Task 48, section 25 «Тролль ходит и делает рывок» (user's decision 22.10.2026; sim/enemies/troll.ts, `Params.trollMove`; spec
 * docs/design-notes/task-48-troll.md, 25). Node only: `npm run test:realtime-troll-move`.
 *
 * Every check plays journalled commands (teleport, walk, chill, place, begin / drag, release) and looks at what the player meets:
 * - the hero standing on the lane of «Рывок» takes −2 from `troll-charge` once; the lane ends in the open — no window;
 * - the hero who walks aside during the windup is not hurt;
 * - the enemies on the lane are thrown aside off its axis (each side its own) and live (event `trollPush`);
 * - a charge into a tree sticks: the window 1.5 s (source `charge`), a chain in it takes the core — the highlight = the dash;
 * - a wall between the Troll and the hero — no charge while it stands between them;
 * - the Troll walks to the hero (the distance falls over 3 s without a move); without the key he sits where he sat;
 * - a part of the drawn chain carried by the run beyond its anchors' reach leaves the chain in the tick it does (the highlight never
 *   shows it beyond the reach; the refusal `far`); with «Развилка» an older link still holds it (one reach rule, the drawing's);
 * - the strike's band is 1.6 wide (design §25.8): the hero 1.0 off the axis is struck, 1.2 off is not;
 * - the cold: a frozen Troll does not walk, his windup waits, a run begun goes on; «Испытание VII» walks him ×1.1;
 * - a barrel on the lane is not thrown (a thing), the braziers stay; a stuck charge names what it stuck in (`trollStuck`);
 * - a journal without the key plays the old world: the hashes of the base 97fdea81 (a walking route of 40 s, seeds 1–4).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { FORMS } from './buildIds';
import type { Loadout } from './kit';
import './arenasBoss';
import { enemyRefusal, planChain, reachOf } from './chain';
import {
  CHARGE_PUSH, CHARGE_WIDTH, TROLL, TROLL_CHARGE_SOURCE, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL, TROLL_WINDOW_CHARGE, trollMove, trollState,
} from './enemies/troll';
import { bodyRadiusOf, enemyArtRadius } from './enemies/kinds';
import { dist, lineOfSight, tree, type Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

/**
 * An open field for the lanes (30 × 20): the Troll at (8, 10) with his parts at the den's offsets, a tree east of him on his row (a
 * charge east sticks in it), a wall south-east (between him and a hero at (14, 16)). The arena plays the Troll's rules for itself.
 */
registerArena({
  id: 'troll-field', name: 'Поле тролля', summary: 'Тест рывка', goal: 'marked', width: 30, height: 20,
  heroStart: { x: 27, y: 10 }, obstacles: [tree(18, 10), { shape: 'rect', kind: 'wall', x: 11.5, y: 13, w: 1, h: 6 }], buttons: [], door: { x: 29.3, y: 1 },
  enemies: [
    { x: 8, y: 10, color: 1, kind: TROLL, marked: true },
    { x: 6.5, y: 10.4, color: 0, kind: TROLL_CLUB },
    { x: 9.5, y: 10.4, color: 1, kind: TROLL_ROCK },
    { x: 8, y: 11.7, color: 2, kind: TROLL_TAIL },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 }, bossFrame: true, bossClears: true, jailerColorless: true, troll: true,
});

/** Nothing comes, the hero cannot fall, the crowd stands, no touch; the spec's first numbers (HP 4, 5 plates). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.trollHp = 4; p.trollPlates = 5;
  return Object.assign(p, extra);
}
interface Fight { sim: Simulation; w: World; core: Enemy; club: Enemy; rock: Enemy; tail: Enemy }
/** A fight on `arena` with the hero at `hero`; `freeze` — the club and the rock frozen (their moves never open: «Рывок» alone). */
function fight(arena: string, k: number, hero: Vec, freeze = true, params: Params = quiet(), loadout?: Loadout): Fight {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} }), w = sim.world;
  sim.command({ t: 'teleport', x: hero.x, y: hero.y });
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  const f = { sim, w, core: kind(TROLL), club: kind(TROLL_CLUB), rock: kind(TROLL_ROCK), tail: kind(TROLL_TAIL) };
  if (freeze) for (const e of [f.club, f.rock]) sim.command({ t: 'chill', id: e.id, seconds: 600 });
  return f;
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
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const moves = (events: readonly WorldEvent[], move: string, stage: 'start' | 'hit'): Ev<'bossMove'>[] => of(events, 'bossMove').filter(e => e.move === move && e.stage === stage);
const chargeHits = (events: readonly WorldEvent[]): Ev<'hit'>[] => of(events, 'hit').filter(e => e.source === TROLL_CHARGE_SOURCE);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Ticks until the charge's run is over (its `hit`), at most `seconds`. */
const untilCharged = (sim: Simulation, out: WorldEvent[] = [], seconds = 8): WorldEvent[] => ticks(sim, ticksOf(seconds), out, (_w, ev) => moves(ev, 'charge', 'hit').length > 0);

check('the hero standing on the lane of «Рывок» takes −2 from `troll-charge`, once; the lane ends in the open (10 units) — no window, the Troll ends past the hero; no new charge in the cooldown (6 s)', () => {
  for (const k of SEEDS) {
    const { sim, w, core } = fight('troll', k, { x: 12, y: 8 });
    const events = untilCharged(sim);
    assert(moves(events, 'charge', 'start').length === 1 && moves(events, 'charge', 'hit').length === 1, `seed ${k}: one charge (${JSON.stringify(of(events, 'bossMove'))})`);
    const hits = chargeHits(events);
    assert(hits.length === 1 && hits[0].damage === 2 && w.hero.hp === 997, `seed ${k}: −2 once (${JSON.stringify(hits)}, HP ${w.hero.hp})`);
    assert(!trollState(w)!.window && !of(events, 'trollWindow').some(e => e.action === 'open'), `seed ${k}: no window`);
    assert(Math.abs(core.x - 12) < 1e-6 && Math.abs(core.y - 12.2) < 1e-6, `seed ${k}: the run ran its 10 units (${core.x}, ${core.y})`);
    // The cooldown: the hero back in its sight (8.2 away, a free line) — no new charge for `trollChargeCd` 6 s after the run's end.
    sim.command({ t: 'teleport', x: 12, y: 4 });
    const after = ticks(sim, ticksOf(5.9));
    assert(!moves(after, 'charge', 'start').length, `seed ${k}: no charge in the cooldown`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the hero who walks aside during the windup is not hurt; the lane stays where it was fixed', () => {
  for (const k of SEEDS) {
    const { sim, w } = fight('troll', k, { x: 12, y: 8 });
    const events = ticks(sim, ticksOf(4), [], (_w, ev) => moves(ev, 'charge', 'start').length > 0);
    const lane = trollMove(w)!;
    assert(lane?.move === 'charge' && !lane.running && lane.width === CHARGE_WIDTH && Math.abs(lane.to!.x - 12) < 1e-6, `seed ${k}: the lane south (${JSON.stringify(lane)})`);
    // A short step: 0.3 s × 4 = 1.2 units off the axis — out of the hit's reach 0.8 + 0.28 by 0.12.
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, ticksOf(0.3), events);
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(Math.abs(w.hero.x - 12) > CHARGE_WIDTH / 2 + 0.28, `seed ${k}: the hero off the lane (${w.hero.x})`);
    untilCharged(sim, events);
    assert(moves(events, 'charge', 'hit').length === 1 && chargeHits(events).length === 0 && w.hero.hp === 999, `seed ${k}: unhurt (${w.hero.hp})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the enemies on the lane are thrown aside off its axis — each to its own side, out of the lane — and live (`trollPush` with their ids)', () => {
  for (const k of SEEDS) {
    const { sim, w } = fight('troll', k, { x: 12, y: 9 });
    const place = (x: number, y: number): Enemy => { const id = sim.command({ t: 'place', x, y, color: 0, hp: 1, kind: 'basic' }) as number; return w.enemies.find(e => e.id === id)!; };
    const east = place(12.3, 6.5), west = place(11.7, 5.2);
    const events = untilCharged(sim);
    const pushed = of(events, 'trollPush');
    assert(pushed.some(e => e.id === east.id) && pushed.some(e => e.id === west.id), `seed ${k}: both pushed (${JSON.stringify(pushed)})`);
    assert(w.enemies.includes(east) && w.enemies.includes(west) && east.hp === 1 && west.hp === 1, `seed ${k}: both alive, unhurt`);
    const out = CHARGE_WIDTH / 2 + bodyRadiusOf(w.params, east) - 1e-6;
    assert(east.x - 12 >= out && 12 - west.x >= out, `seed ${k}: out of the lane, each its side (${east.x}, ${west.x})`);
    const first = pushed.find(e => e.id === east.id)!;
    assert(Math.abs(first.x - first.fromX - CHARGE_PUSH) < 1e-6, `seed ${k}: thrown ${CHARGE_PUSH} across (${first.fromX} → ${first.x})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a charge into a tree sticks: the window 1.5 s (`charge`, `stuck`); a chain in it takes the core — the highlight takes a plate, the dash takes the same', () => {
  for (const k of SEEDS) {
    const { sim, w, core } = fight('troll-field', k, { x: 14, y: 10 });
    const events = ticks(sim, ticksOf(4), [], (_w, ev) => moves(ev, 'charge', 'start').length > 0);
    assert(trollMove(w)?.stuck === true, `seed ${k}: the lane ends at the tree (${JSON.stringify(trollMove(w))})`);
    sim.command({ t: 'walk', x: 0, y: -1 });
    ticks(sim, ticksOf(0.5), events);
    sim.command({ t: 'walk', x: 0, y: 0 });
    untilCharged(sim, events);
    const open = of(events, 'trollWindow').filter(e => e.action === 'open');
    const st = trollState(w)!;
    assert(open.length === 1 && open[0].source === 'charge' && st.stuck && st.window?.open && Math.abs(st.window.left - TROLL_WINDOW_CHARGE) < 0.02, `seed ${k}: the window (${JSON.stringify(st)})`);
    assert(dist(core, { x: 18, y: 10 }) < 0.42 + bodyRadiusOf(w.params, core) + 0.03 && chargeHits(events).length === 0, `seed ${k}: at the tree (${core.x}, ${core.y})`);
    assert(of(events, 'trollStuck').map(e => e.on).join() === 'tree', `seed ${k}: stuck in a tree (${JSON.stringify(of(events, 'trollStuck'))})`);
    // The hero beside the core: a chain of one into it.
    sim.command({ t: 'teleport', x: core.x, y: core.y - 1.2 });
    ticks(sim, 1, events);
    assert(enemyRefusal(w, core) === null, `seed ${k}: the core may be taken (${enemyRefusal(w, core)})`);
    sim.command({ t: 'begin', x: core.x, y: core.y });
    const outcome = planChain(w).links[0]?.outcome;
    assert(w.chain.length === 1 && outcome?.plate && outcome.platesAfter === 4, `seed ${k}: the highlight takes a plate (${JSON.stringify(outcome)})`);
    sim.command({ t: 'release' });
    const dash = settle(sim);
    assert(core.armor?.plates === 4 && core.hp === 4 && of(dash, 'trollWindow').some(e => e.action === 'hit' && e.source === 'chain'), `seed ${k}: the dash took it (${core.armor?.plates})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a wall between the Troll and the hero: no charge while it stands between them (the Troll walks round it)', () => {
  for (const k of SEEDS) {
    const { sim, w, core } = fight('troll-field', k, { x: 14, y: 16 });
    let blocked = 0;
    for (let i = 0; i < ticksOf(5) && w.status === 'playing'; i++) {
      // The conductor may choose in this tick (its first move is due at the 2nd second) and nothing winds up or runs.
      const sees = lineOfSight(core, w.hero, w.arena, bodyRadiusOf(w.params, core)), idle = w.time >= 2 - 1.5 * SIM_DT && !core.vars.mv && !core.vars.kr;
      sim.tick();
      const ev = w.events.splice(0);
      if (!sees && idle) blocked++;
      assert(sees || !moves(ev, 'charge', 'start').length, `seed ${k}: a charge through the wall at ${w.time.toFixed(2)}`);
    }
    assert(blocked > ticksOf(0.5), `seed ${k}: the wall stood between them long enough (${blocked} ticks)`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the Troll walks to the hero: the distance falls over 3 s without a move (×`trollWalk` 1.2, from the 2nd second); without the key he sits', () => {
  for (const k of SEEDS) {
    const { sim, w, core } = fight('troll-field', k, { x: 27, y: 10 }, false);
    ticks(sim, ticksOf(2));
    const d0 = dist(core, w.hero);
    const events = ticks(sim, ticksOf(3));
    const d1 = dist(core, w.hero);
    assert(!of(events, 'bossMove').length && d0 - d1 > 3.4 && d0 - d1 < 3.7, `seed ${k}: walked ${(d0 - d1).toFixed(2)} in 3 s`);
    // The parts walk with him at their offsets.
    assert(Math.abs(w.enemies.find(e => e.kind === TROLL_CLUB)!.x - (core.x - 1.5)) < 1e-6, `seed ${k}: the club at its offset`);
    // Without the key (a journal before it): the same fight, the Troll where he sat.
    const old = quiet();
    delete (old as Partial<Params>).trollMove;
    const sat = fight('troll-field', k, { x: 27, y: 10 }, false, old);
    ticks(sat.sim, ticksOf(5));
    assert(sat.core.x === 8 && sat.core.y === 10 && sat.w.params.trollMove === undefined, `seed ${k}: he sits (${sat.core.x}, ${sat.core.y})`);
    assert(replays(sim) && replays(sat.sim), `seed ${k}: replay`);
  }
});

check('the run carries a part of the drawn chain beyond its anchor\'s reach: it leaves the chain in that tick (`trollLinkFar`, refusal `far`) — the highlight never holds it beyond the reach', () => {
  for (const k of SEEDS) {
    const { sim, w, club } = fight('troll-field', k, { x: 8, y: 14 });
    const place = (x: number, y: number): Enemy => { const id = sim.command({ t: 'place', x, y, color: club.color, hp: 0, kind: 'basic' }) as number; return w.enemies.find(e => e.id === id)!; };
    const b1 = place(6.8, 13.3), b2 = place(6.6, 12);
    ticks(sim, ticksOf(1.8));
    sim.command({ t: 'begin', x: b1.x, y: b1.y });
    sim.command({ t: 'drag', x: b2.x, y: b2.y, mode: 'full' });
    sim.command({ t: 'drag', x: club.x, y: club.y, mode: 'full' });
    assert(w.chain.length === 3 && w.chain[2].id === club.id, `seed ${k}: the chain to the club (${JSON.stringify(w.chain)})`);
    const events: WorldEvent[] = [];
    let dropped = false;
    for (let i = 0; i < ticksOf(6) && w.status === 'playing' && !dropped; i++) {
      sim.tick();
      const ev = w.events.splice(0);
      events.push(...ev);
      const inPlan = planChain(w).links.some(l => l.link.id === club.id), far = dist(b2, club) > reachOf(w, enemyArtRadius(w.params, club));
      assert(!(inPlan && far), `seed ${k}: the highlight holds the club beyond the reach at ${w.time.toFixed(2)}`);
      dropped = of(ev, 'trollLinkFar').some(e => e.id === club.id);
    }
    assert(dropped && moves(events, 'charge', 'start').length === 1, `seed ${k}: the run dropped the club (${JSON.stringify(of(events, 'trollLinkFar'))})`);
    assert((w.chain.length as number) === 2 && enemyRefusal(w, club) === 'far', `seed ${k}: the chain ends on b2, the club refused (${enemyRefusal(w, club)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('design §25.8: the strike\'s band is 1.6 wide (by the drawing; the stop and the sight stay by the body 0.32) — the hero standing 1.0 off the lane\'s axis is struck, 1.2 off is not', () => {
  for (const k of SEEDS) {
    for (const [off, struck] of [[1.0, true], [1.2, false]] as const) {
      const { sim } = fight('troll', k, { x: 12, y: 8 });
      ticks(sim, ticksOf(4), [], (_w, ev) => moves(ev, 'charge', 'start').length > 0);
      // The lane is fixed (south along x 12): the hero stands beside its axis.
      sim.command({ t: 'teleport', x: 12 + off, y: 8 });
      const events = untilCharged(sim);
      assert((chargeHits(events).length === 1) === struck, `seed ${k}, ${off} off: struck ${chargeHits(events).length}`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('the cold: a frozen Troll does not walk; his charge\'s windup waits for the thaw; a run begun goes on frozen; «Испытание VII» (the kit\'s walk ×1.1) walks him ×1.1', () => {
  for (const k of SEEDS) {
    // The walk: frozen 2 s at 2.5 s — he stands, then walks on.
    const a = fight('troll-field', k, { x: 27, y: 10 }, false);
    ticks(a.sim, ticksOf(2.5));
    a.sim.command({ t: 'chill', id: a.core.id, seconds: 2 });
    const at = { x: a.core.x, y: a.core.y };
    ticks(a.sim, ticksOf(1.9));
    assert(a.core.x === at.x && a.core.y === at.y, `seed ${k}: frozen, he stands`);
    ticks(a.sim, ticksOf(1));
    assert(a.core.x > at.x + 0.5, `seed ${k}: thawed, he walks (${a.core.x})`);
    // The windup waits: frozen 1 s at its start.
    const b = fight('troll', k, { x: 12, y: 8 });
    ticks(b.sim, ticksOf(4), [], (_w, ev) => moves(ev, 'charge', 'start').length > 0);
    const t0 = b.core.vars.t, start = b.w.time;
    b.sim.command({ t: 'chill', id: b.core.id, seconds: 1 });
    ticks(b.sim, ticksOf(0.9));
    assert(b.core.vars.t === t0 && !b.core.vars.kr, `seed ${k}: the windup waits (${t0} → ${b.core.vars.t})`);
    untilCharged(b.sim);
    assert(b.w.time - start > t0 + 0.95, `seed ${k}: the run came after the thaw (${(b.w.time - start).toFixed(2)})`);
    // A run begun goes on frozen.
    const c = fight('troll', k, { x: 12, y: 8 });
    ticks(c.sim, ticksOf(5), [], () => !!c.core.vars.kr);
    c.sim.command({ t: 'chill', id: c.core.id, seconds: 5 });
    const ran = untilCharged(c.sim, [], 1.2);
    assert(moves(ran, 'charge', 'hit').length === 1 && Math.abs(c.core.y - 12.2) < 1e-6, `seed ${k}: the run ran its lane frozen (${c.core.y})`);
    // «Испытание VII»: the kit's walk ×1.1.
    const plain = fight('troll-field', k, { x: 27, y: 10 }, false), trial = fight('troll-field', k, { x: 27, y: 10 }, false, quiet(), { walkScale: 1.1 });
    for (const f of [plain, trial]) ticks(f.sim, ticksOf(5));
    const walked = (f: Fight): number => f.core.x - 8, ratio = walked(trial) / walked(plain);
    assert(Math.abs(ratio - 1.1) < 0.01, `seed ${k}: ×${ratio.toFixed(3)}`);
    for (const f of [a, b, c, trial]) assert(replays(f.sim), `seed ${k}: replay`);
  }
});

check('a barrel on the lane is not thrown (a thing: no `trollPush` for it), the braziers stay where they stand', () => {
  for (const k of SEEDS) {
    const { sim, w } = fight('troll', k, { x: 12, y: 9 });
    const id = sim.command({ t: 'place', x: 12.2, y: 6, color: 0, hp: 1, kind: 'barrel' }) as number;
    const braziers = w.objects.filter(o => o.kind === 'brazier').map(o => `${o.x},${o.y}`).join(' ');
    const events = untilCharged(sim);
    assert(moves(events, 'charge', 'hit').length === 1 && !of(events, 'trollPush').some(e => e.id === id), `seed ${k}: the barrel not thrown`);
    assert(w.objects.filter(o => o.kind === 'brazier').map(o => `${o.x},${o.y}`).join(' ') === braziers && braziers.split(' ').length === 2, `seed ${k}: the braziers (${braziers})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Развилка» (every link an anchor): the run carries the club past the link before it — an older link still reaches it, it stays; it leaves when no link does, later than without «Развилка» (one reach rule — the drawing\'s)', () => {
  for (const k of SEEDS) {
    const drop = (fork: boolean): { at: number; heldByOlder: boolean } => {
      const params = quiet(fork ? { forkDwell: 0, forkBranches: 0 } : {});
      const { sim, w, club } = fight('troll-field', k, { x: 8, y: 14 }, true, params, fork ? { talismans: [FORMS.fork] } : undefined);
      const place = (x: number, y: number): Enemy => { const id = sim.command({ t: 'place', x, y, color: club.color, hp: 0, kind: 'basic' }) as number; return w.enemies.find(e => e.id === id)!; };
      const b1 = place(6.8, 13.3), b2 = place(6.6, 12);
      ticks(sim, ticksOf(1.8));
      sim.command({ t: 'begin', x: b1.x, y: b1.y });
      sim.command({ t: 'drag', x: b2.x, y: b2.y, mode: 'full' });
      sim.command({ t: 'drag', x: club.x, y: club.y, mode: 'full' });
      assert(w.chain.length === 3, `seed ${k}: the chain to the club (${fork})`);
      let heldByOlder = false;
      for (let i = 0; i < ticksOf(6) && w.status === 'playing'; i++) {
        sim.tick();
        const ev = w.events.splice(0), reach = reachOf(w, enemyArtRadius(w.params, club)), inChain = w.chain.some(l => l.id === club.id);
        if (inChain && dist(b2, club) > reach && dist(b1, club) <= reach) heldByOlder = true;
        if (of(ev, 'trollLinkFar').some(e => e.id === club.id)) { assert(replays(sim), `seed ${k}: replay`); return { at: w.time, heldByOlder }; }
      }
      throw new Error(`seed ${k}: the club never dropped (${fork})`);
    };
    const plain = drop(false), forked = drop(true);
    assert(!plain.heldByOlder && forked.heldByOlder && forked.at > plain.at, `seed ${k}: without «Развилка» at ${plain.at.toFixed(2)}, with it held by b1 and dropped at ${forked.at.toFixed(2)}`);
  }
});

check('a journal without `trollMove` plays the old world: a walking route of 40 s on «Берлога тролля» without the keys added after the base (the five of the Troll, the four of 57б-1, the two of 57б-2) gives the hashes of the base 97fdea81 (seeds 1–4)', () => {
  // The base's hashes (rules-reviewer's probe on 97fdea81, 22.10.2026, the same route): the sitting Troll byte for byte. A journal of
  // the base has none of the keys added after it: the Troll's five, task 57б-1's four and 57б-2's two (merged into main beside this branch; they
  // are hashed defaults too) — so the route deletes all nine (checked on the merge 22.10.2026: with only the five, the 57б keys move it).
  const BASE = ['602b0858924b99ed', '384787c42ccfcd4f', 'a0761294781dfab7', 'd3f886deb816e42d'];
  [1, 2, 3, 4].forEach((k, i) => {
    const p = { ...defaultParams(), heroHp: 999, hitstop: false } as Partial<Params>;
    for (const key of ['trollMove', 'trollWalk', 'trollChargeCd', 'trollChargeLen', 'trollWindowCharge', 'rootRise', 'slimeMerge', 'slimeBigHp', 'brandSeek', 'centiParts', 'centiLungeWindup'] as const) delete p[key];
    const sim = new Simulation({ arena: 'troll', params: p as Params, seed: seedOf(k), record: true });
    const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1], [1, -1], [-1, -1]];
    for (let t = 0; t < 60 * 40 && sim.world.status === 'playing'; t++) {
      if (t % 90 === 0) { const d = dirs[(t / 90 + k) % dirs.length]; sim.command({ t: 'walk', x: d[0], y: d[1] }); }
      sim.tick();
      sim.world.events.length = 0;
    }
    assert(sim.hash() === BASE[i], `seed ${k}: ${sim.hash()} (base ${BASE[i]})`);
  });
});

console.log(`troll move: ${checks} checks passed`);
