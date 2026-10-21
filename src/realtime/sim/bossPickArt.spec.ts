/**
 * «Зона нажатия босса по рисунку» (design 21.10.2026, task-48 §24; `Params.bossPickArt`, chain.ts `pick`, bossArt.ts): a click on a boss's
 * drawing outside its press circle (the chest, the head, a paw; a part's picture) took nothing and said nothing. With the key, nothing in
 * its circle, the boss body whose drawing holds the pointer is picked. Node only: `npm run test:realtime-boss-pick-art`.
 *
 * Every check plays journalled commands (place, teleport, chill, begin / drag) on the bosses' arenas; the points are on the drawings by
 * their offsets from the body's centre (the Troll's head 1.5 above it, his chest 0.9; the drawings reach 1.95, 1.56, 1.44, 1.58, 1.15 up):
 * - the Troll's window open: the head and the chest — with the key the press takes the core (`pickAt`, the highlight the same, no
 *   hint); without it nothing (the old path);
 * - his window closed: the head — with the key nothing taken and the hint «вне окна» (the core's refusal); without it no hint;
 * - a crowd body standing before the warlock's chest: the pointer on it takes the body, the key or not;
 * - the hero far: the head — «далеко»;
 * - the club's picture along its handle out of its circle: with the key the club, without it nothing;
 * - the Chief's feast, three eaters drawn: the drag to his head — with the key the core, without it nothing;
 * - the overlap of drawings (design 21.10.2026), the Chief's shoulder under the ladle (out of every circle): «on top» is the view's
 *   order (the larger y; the core over the parts): both takeable — the core; the core closed — the ladle; neither — the core's refusal;
 *   at an equal y the later body; the full Castellan's crossbow: the edge of its drawing takes it;
 * - the warlock charmed: his head — «под чарами»; his window after the charm: the head takes him;
 * - the Jailer and the Castellan: the head — with the key the core or the core's refusal, without it nothing;
 * - the bosses' arenas put the key on; values without it keep it absent; another arena keeps it off;
 * - the run: a new run's fights have the key, a save without the flag — no key in its fights' values;
 * - every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { WARLOCK_ARENA } from './arenasCastle';
import { artEllipseDepth, bossArtEllipse } from './bossArt';
import { enemyRefusal, hoverRefusal, pickAt, pickRadius, planChain } from './chain';
import { CHIEF, CHIEF_LADLE, CHIEF_SACK, chiefState } from './enemies/chief';
import { WARDROBE } from './enemies/castle';
import { CASTELLAN } from './enemies/garrison';
import { JAILER } from './enemies/jailer';
import { TROLL, TROLL_CLUB, TROLL_ROCK } from './enemies/troll';
import { WARLOCK, warlockState } from './enemies/warlock';
import type { Vec } from './geometry';
import { defaultParams, type Params } from './params';
import { durabilityOf } from './shove';
import { replay, Simulation, SIM_DT } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { createRtRun, parseRtRun, rtArenaParams, rtRunParams, serializeRtRun } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** Nobody comes or walks, the hero cannot fall; `key` — the key on, or absent (`undefined`: a journal before it). */
function quiet(key: true | undefined, extra: Partial<Params> = {}): Params {
  const p: Partial<Params> = { ...defaultParams(), baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6, speedSpread: 0, enemySpeed: 0, contactDamage: 0, heroHp: 999, hitstop: false, ...extra };
  if (key) p.bossPickArt = true; else delete p.bossPickArt;
  return p as Params;
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
const kindOf = (w: World, kind: string): Enemy | undefined => w.enemies.find(e => e.kind === kind);
const freeze = (sim: Simulation, e: Enemy | undefined, seconds = 600): void => { if (e) sim.command({ t: 'chill', id: e.id, seconds }); };
const at = (e: Enemy, dx: number, dy: number): Vec => ({ x: e.x + dx, y: e.y + dy });
/** The press at `p`: what `pickAt` said before it, the chain's first link after it, the highlight's first link, the hint before it. */
function press(sim: Simulation, p: Vec): { said: number | null; took: number | null; shown: number | null; hint: string | null } {
  const w = sim.world, said = pickAt(w, p)?.id ?? null, hint = hoverRefusal(w, p);
  sim.command({ t: 'begin', x: p.x, y: p.y });
  const took = w.chain[0]?.id ?? null, shown = planChain(w).links[0]?.link.id ?? null;
  sim.command({ t: 'cancel' });
  return { said, took, shown, hint };
}

/** «Берлога тролля»: the rock frozen; `open` — the club's window opened, then the club frozen; the hero below the core. */
function den(k: number, key: true | undefined, open: boolean): { sim: Simulation; w: World; core: Enemy } {
  const sim = new Simulation({ arena: 'troll', params: quiet(key, { trollWindowClub: 5 }), seed: seedOf(k), record: true }), w = sim.world;
  ticks(sim, 1);
  const core = kindOf(w, TROLL)!;
  freeze(sim, kindOf(w, TROLL_ROCK));
  if (open) {
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    const out = ticks(sim, ticksOf(12), [], (_w, ev) => ev.some(e => e.type === 'trollWindow' && e.action === 'open'));
    assert(out.some(e => e.type === 'trollWindow' && e.action === 'open'), `seed ${k}: the window opened`);
  }
  freeze(sim, kindOf(w, TROLL_CLUB));
  sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
  return { sim, w, core };
}
const HEAD = [0, -1.5] as const, CHEST = [0, -0.9] as const;

check('the Troll\'s window open: his head and chest on the drawing (out of the press circle) — with the key the press takes the core (`pickAt`, the highlight, no hint); without it nothing', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, core } = den(k, key, true);
      for (const [dx, dy] of [HEAD, CHEST]) {
        const got = press(sim, at(core, dx, dy)), want = key ? core.id : null;
        assert(got.took === want && got.said === want && got.shown === want && got.hint === null, `seed ${k}, key ${key}, (${dx}, ${dy}): took ${got.took}, said ${got.said}, shown ${got.shown}, hint ${got.hint}`);
      }
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Troll\'s window closed: his head — with the key nothing taken, the hint «вне окна» (the core\'s refusal); without it no hint; the hero far — «далеко»', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, core } = den(k, key, false);
      const shut = press(sim, at(core, ...HEAD));
      assert(shut.took === null && shut.hint === (key ? 'outOfWindow' : null), `seed ${k}, key ${key}: closed — took ${shut.took}, hint ${shut.hint}`);
      assert(replays(sim), `seed ${k}, key ${key}: replay (closed)`);
      const open = den(k, key, true);
      open.sim.command({ t: 'teleport', x: 12, y: 9 });
      const far = press(open.sim, at(open.core, ...HEAD));
      assert(far.took === null && far.hint === (key ? 'far' : null), `seed ${k}, key ${key}: far — took ${far.took}, hint ${far.hint}`);
      assert(replays(open.sim), `seed ${k}, key ${key}: replay (far)`);
    }
  }
});

check('the club\'s picture along its handle, out of its press circle: with the key the press takes the club, without it nothing', () => {
  // The club in his paw, its head up and a little left (the view's `CLUB_HAND`, −1.95 rad): 0.9 from the grip along it.
  const ux = -0.3702, uy = -0.9290;
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      // The club frozen in his paw from the start (no strike laid it down).
      const { sim, w } = den(k, key, false), club = kindOf(w, TROLL_CLUB)!;
      sim.command({ t: 'teleport', x: club.x + 0.4, y: club.y + 1.2 });
      const got = press(sim, at(club, ux * 0.9, uy * 0.9));
      assert(got.took === (key ? club.id : null) && got.said === got.took, `seed ${k}, key ${key}: took ${got.took} (club ${club.id}, hint ${got.hint})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Chief\'s feast, three eaters drawn: the drag to his head (out of his circle and the parts\') — with the key the core, without it nothing', () => {
  const SEATS: readonly Vec[] = [{ x: 11.8, y: 4.4 }, { x: 10.7, y: 4.6 }, { x: 9.8, y: 4 }];
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const sim = new Simulation({ arena: 'chief', params: quiet(key), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, CHIEF)!;
      freeze(sim, kindOf(w, CHIEF_LADLE)); freeze(sim, kindOf(w, CHIEF_SACK));
      sim.command({ t: 'teleport', x: 12.9, y: 5.6 });
      const opened = ticks(sim, ticksOf(30), [], (_w, ev) => ev.some(e => e.type === 'chiefFeast' && e.action === 'open'));
      assert(opened.some(e => e.type === 'chiefFeast' && e.action === 'open') && chiefState(w)!.window, `seed ${k}: the feast opened`);
      const three = SEATS.map(s => w.enemies.find(e => e.vars.eat && Math.hypot(e.x - s.x, e.y - s.y) < 0.05)!);
      sim.command({ t: 'begin', x: three[0].x, y: three[0].y });
      for (const e of three.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
      assert(w.chain.length === 3, `seed ${k}: three links (${w.chain.length})`);
      const head = at(core, 0, -1.3), said = pickAt(w, head)?.id ?? null;
      sim.command({ t: 'drag', x: head.x, y: head.y, mode: 'full' });
      const last = w.chain[w.chain.length - 1]?.id;
      if (key) assert(said === core.id && (w.chain.length as number) === 4 && last === core.id, `seed ${k}: the core joined (${w.chain.map(l => l.id)})`);
      else assert(said === null && w.chain.length === 3, `seed ${k}: without the key nothing (${said})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

/** «Зал колдуна»: charmed (the start), or his wardrobe broken at the north wall and his window open after «Перенос». */
function hall(k: number, key: true | undefined, open: boolean): { sim: Simulation; w: World; core: Enemy } {
  const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(key, { shoveDistance: 6, invulnerability: 0, chainShield: 0 }), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 14 });
  ticks(sim, 1);
  const core = kindOf(w, WARLOCK)!;
  if (open) {
    const wardrobe = kindOf(w, WARDROBE)!;
    for (let n = 0; n < 2; n++) {
      sim.command({ t: 'teleport', x: wardrobe.x, y: wardrobe.y + 1 });
      sim.command({ t: 'begin', x: wardrobe.x, y: wardrobe.y });
      sim.command({ t: 'release' });
      ticks(sim, ticksOf(4), [], ww => !ww.move && !ww.shoves);
    }
    assert(!w.enemies.includes(wardrobe) || durabilityOf(wardrobe) === 0, `seed ${k}: the wardrobe broken`);
    ticks(sim, ticksOf(3), [], (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
    assert(warlockState(w)?.window?.open, `seed ${k}: his window open`);
  }
  sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
  return { sim, w, core };
}

/**
 * A point in the drawings of both `lower` and `upper`, out of every press circle; `deeper` — `lower` the deeper there (so the drawing
 * order, not the depth, decides). Found on a grid round `lower` (the geometry only; the rule is what the checks then play).
 */
function overlapOf(w: World, lower: Enemy, upper: Enemy, deeper = false): Vec {
  const zl = bossArtEllipse(w, lower)!, zu = bossArtEllipse(w, upper)!;
  let best: Vec | null = null, margin = 0;
  for (let i = -80; i <= 80; i++) for (let j = -80; j <= 40; j++) {
    const p = { x: lower.x + i * 0.02, y: lower.y + j * 0.02 };
    if (w.enemies.some(e => Math.hypot(e.x - p.x, e.y - p.y) <= pickRadius(w, e) + 0.02)) continue;
    const ql = artEllipseDepth(zl, p), qu = artEllipseDepth(zu, p), m = Math.min(1 - ql, 1 - qu, deeper ? qu - ql : 1);
    if (m > margin) { best = p; margin = m; }
  }
  assert(best, `a point of ${lower.kind}'s drawing under ${upper.kind}'s, out of the circles`);
  return best;
}
const shoulderUnderLadle = (w: World, core: Enemy, ladle: Enemy): Vec => overlapOf(w, core, ladle);
/** «Стан Главаря», the parts frozen, the feast open; the hero by the far seat. */
function feast(k: number): { sim: Simulation; w: World; core: Enemy; ladle: Enemy } {
  const sim = new Simulation({ arena: 'chief', params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
  ticks(sim, 1);
  const core = kindOf(w, CHIEF)!, ladle = kindOf(w, CHIEF_LADLE)!;
  freeze(sim, ladle); freeze(sim, kindOf(w, CHIEF_SACK));
  sim.command({ t: 'teleport', x: 12.9, y: 5.6 });
  const opened = ticks(sim, ticksOf(30), [], (_w, ev) => ev.some(e => e.type === 'chiefFeast' && e.action === 'open'));
  assert(opened.some(e => e.type === 'chiefFeast' && e.action === 'open'), `seed ${k}: the feast opened`);
  return { sim, w, core, ladle };
}
/** The three seated eaters drawn from the far seat to the one by the ladle (its reach takes the ladle and the core). */
function threeEaters(sim: Simulation, w: World): void {
  const seats: readonly Vec[] = [{ x: 9.8, y: 4 }, { x: 10.7, y: 4.6 }, { x: 11.8, y: 4.4 }];
  const three = seats.map(s => w.enemies.find(e => e.vars.eat && Math.hypot(e.x - s.x, e.y - s.y) < 0.05)!);
  sim.command({ t: 'teleport', x: 9.4, y: 5.2 });
  sim.command({ t: 'begin', x: three[0].x, y: three[0].y });
  for (const e of three.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(w.chain.length === 3, `three eaters drawn (${w.chain.length})`);
}
/** «Стан Главаря» before the feast (the core closed), the parts frozen, the hero below the core clear of the cauldron. */
function camp(k: number): { sim: Simulation; w: World; core: Enemy; ladle: Enemy } {
  const sim = new Simulation({ arena: 'chief', params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
  ticks(sim, 1);
  const core = kindOf(w, CHIEF)!, ladle = kindOf(w, CHIEF_LADLE)!;
  freeze(sim, ladle); freeze(sim, kindOf(w, CHIEF_SACK));
  sim.command({ t: 'teleport', x: 11.3, y: 3.9 });
  return { sim, w, core, ladle };
}

check('the overlap of drawings, the Chief\'s shoulder under the ladle (out of every circle): «on top» is the view\'s order — the core (y 3.0) is drawn over the parts (2.2): both takeable — the core; the core closed, the ladle takeable — the ladle; neither — the core\'s refusal', () => {
  // Both takeable: the seeds whose ladle wears the brew's colour at the first feast (it joins the eaters' chain).
  for (const k of [1, 3, 5]) {
    const { sim, w, core, ladle } = feast(k), at = shoulderUnderLadle(w, core, ladle);
    assert(ladle.y < core.y && ladle.color === chiefState(w)!.brew, `seed ${k}: the ladle above the core on the screen, of the brew`);
    threeEaters(sim, w);
    assert(enemyRefusal(w, core) === null && enemyRefusal(w, ladle) === null, `seed ${k}: both takeable (${enemyRefusal(w, core)}, ${enemyRefusal(w, ladle)})`);
    const said = pickAt(w, at)?.id;
    sim.command({ t: 'drag', x: at.x, y: at.y, mode: 'full' });
    assert(said === core.id && w.chain[w.chain.length - 1]?.id === core.id, `seed ${k}: both takeable — the core drawn on top (${said}; core ${core.id}, ladle ${ladle.id})`);
    assert(replays(sim), `seed ${k}: replay (both)`);
  }
  for (const k of [1, 2, 3]) {
    // The core closed (no feast yet), the ladle takeable as the first link: the ladle.
    const one = camp(k), at = shoulderUnderLadle(one.w, one.core, one.ladle);
    assert(enemyRefusal(one.w, one.core) !== null && enemyRefusal(one.w, one.ladle) === null, `seed ${k}: only the ladle takeable`);
    const got = press(one.sim, at);
    assert(got.took === one.ladle.id && got.said === one.ladle.id, `seed ${k}: the core closed — the ladle (${got.took})`);
    assert(replays(one.sim), `seed ${k}: replay (the ladle)`);
    // Neither: the core closed, a chain of another colour than the ladle's — the hint is the core's refusal (the one on top).
    const none = camp(k), at2 = shoulderUnderLadle(none.w, none.core, none.ladle);
    const id = none.sim.command({ t: 'place', x: 11.6, y: 3.6, color: (none.ladle.color + 1) % 4, hp: 1, kind: 'basic' }) as number;
    none.sim.command({ t: 'begin', x: 11.6, y: 3.6 });
    assert(none.w.chain.length === 1 && none.w.chain[0].id === id, `seed ${k}: a link of another colour`);
    const ladleNo = enemyRefusal(none.w, none.ladle), coreNo = enemyRefusal(none.w, none.core), hint = hoverRefusal(none.w, at2);
    assert(ladleNo !== null && coreNo !== null && ladleNo !== coreNo, `seed ${k}: both refused, for different reasons (${ladleNo}, ${coreNo})`);
    assert(pickAt(none.w, at2) === null && hint === coreNo, `seed ${k}: the hint is the core's (${hint}; core ${coreNo}, ladle ${ladleNo})`);
    assert(replays(none.sim), `seed ${k}: replay (neither)`);
  }
});

check('the Troll\'s club over his shoulder (the club y 2.6, the core 2.2: the club drawn on top), the core the deeper there, both takeable (his window rule off by `param`): the club — the order, not the depth', () => {
  for (const k of SEEDS) {
    const sim = new Simulation({ arena: 'troll', params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
    ticks(sim, 1);
    const core = kindOf(w, TROLL)!, club = kindOf(w, TROLL_CLUB)!;
    freeze(sim, club); freeze(sim, kindOf(w, TROLL_ROCK));
    sim.command({ t: 'param', key: 'trollWindow', value: false });
    sim.command({ t: 'teleport', x: 11, y: 3.6 });
    const at = overlapOf(w, core, club, true);
    assert(club.y > core.y && enemyRefusal(w, core) === null && enemyRefusal(w, club) === null, `seed ${k}: both takeable, the club lower on the screen`);
    const got = press(sim, at);
    assert(got.took === club.id && got.said === club.id, `seed ${k}: the club drawn on top (${got.took}; club ${club.id}, core ${core.id})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('an equal y (the view keeps its order there): of two takeable boss drawings at one height, the later body (the higher id) is on top — whichever stands left', () => {
  for (const k of SEEDS) {
    for (const leftFirst of [true, false]) {
      const sim = new Simulation({ arena: 'glade', params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      sim.command({ t: 'teleport', x: 8.8, y: 7.6 });
      const xs = leftFirst ? [8, 9.6] : [9.6, 8];
      const [first, second] = xs.map(x => sim.command({ t: 'place', x, y: 6, color: 0, hp: 1, kind: TROLL }) as number);
      const at = { x: 8.8, y: 5 }, said = pickAt(w, at)?.id;
      assert(w.enemies.filter(e => e.kind === TROLL).length === 2 && said === second && second > first, `seed ${k}, left first ${leftFirst}: the later (${second}) on top, got ${said}`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('the full Castellan\'s crossbow on its stand: a click on the edge of its drawing out of its press circle takes the stand with the key, nothing without it', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const sim = new Simulation({ arena: 'g-castellan-full', params: quiet(key), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const stand = kindOf(w, 'castellan-crossbow')!;
      sim.command({ t: 'teleport', x: stand.x, y: stand.y + 1.4 });
      const edge = at(stand, -0.55, -0.45);
      assert(Math.hypot(edge.x - stand.x, edge.y - stand.y) > pickRadius(w, stand), `seed ${k}: the edge out of the stand's circle`);
      const got = press(sim, edge);
      assert(got.took === (key ? stand.id : null) && got.said === got.took, `seed ${k}, key ${key}: took ${got.took} (stand ${stand.id}, hint ${got.hint})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the warlock: charmed — his head says «под чарами» with the key (nothing without it); his window after the charm — the head takes him', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const charmed = hall(k, key, false), c = press(charmed.sim, at(charmed.core, 0, -1.2));
      assert(c.took === null && c.hint === (key ? 'spellbound' : null), `seed ${k}, key ${key}: charmed — took ${c.took}, hint ${c.hint}`);
      assert(replays(charmed.sim), `seed ${k}, key ${key}: replay (charmed)`);
      const open = hall(k, key, true), o = press(open.sim, at(open.core, 0, -1.2));
      assert(o.took === (key ? open.core.id : null) && o.said === o.took, `seed ${k}, key ${key}: his window — took ${o.took}`);
      assert(replays(open.sim), `seed ${k}, key ${key}: replay (open)`);
    }
  }
});

check('a crowd body standing before the warlock\'s chest (his back is open floor; the Troll\'s is the den\'s rock): the pointer on the body takes the body, the key or not', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, core } = hall(k, key, true);
      const id = sim.command({ t: 'place', x: core.x, y: core.y - 0.9, color: 1, hp: 1, kind: 'basic' }) as number;
      ticks(sim, 1);
      const body = sim.world.enemies.find(e => e.id === id)!, d = Math.hypot(body.x - core.x, body.y - core.y);
      assert(d > 0.8, `seed ${k}: the body before his chest (${d.toFixed(2)} from the core)`);
      sim.command({ t: 'teleport', x: core.x + 1.2, y: core.y - 0.9 });
      const got = press(sim, { x: body.x, y: body.y });
      assert(got.took === body.id && got.said === body.id, `seed ${k}, key ${key}: the body (${got.took}; body ${body.id}, core ${core.id})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Jailer and the Castellan: the head on the drawing — with the key the core or the core\'s refusal at the pointer; without it nothing and no hint', () => {
  for (const k of SEEDS) {
    for (const [arena, kind, up] of [['jailer', JAILER, -1.3], ['g-castellan', CASTELLAN, -0.95]] as const) {
      for (const key of [undefined, true] as const) {
        const sim = new Simulation({ arena, params: quiet(key), seed: seedOf(k), record: true }), w = sim.world;
        ticks(sim, 1);
        const core = kindOf(w, kind)!;
        sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
        const head = at(core, 0, up), said = pickAt(w, head)?.id ?? null, hint = hoverRefusal(w, head);
        if (key) assert(said === core.id ? hint === null : hint !== null, `seed ${k}, ${arena}: the core (${said}) or its refusal (${hint})`);
        else assert(said === null && hint === null, `seed ${k}, ${arena}: without the key nothing (${said}, ${hint})`);
        assert(replays(sim), `seed ${k}, ${arena}, key ${key}: replay`);
      }
    }
  }
});

check('the sandbox: the bosses\' arenas (the frame) put the key on from the panel\'s values (off); values without it keep it absent; another arena keeps it off', () => {
  for (const arena of ['troll', 'chief', WARLOCK_ARENA.id, 'jailer', 'g-castellan', 'g-castellan-full']) {
    assert(new Simulation({ arena, params: defaultParams(), seed: seedOf(1) }).world.params.bossPickArt === true, `${arena}: the key on`);
    assert(!('bossPickArt' in new Simulation({ arena, params: quiet(undefined), seed: seedOf(1) }).world.params), `${arena}: values without the key keep it absent`);
  }
  assert(new Simulation({ arena: 'glade', params: defaultParams(), seed: seedOf(1) }).world.params.bossPickArt === false, 'the glade: the key as the panel has it');
});

check('the run: a new run keeps the flag `bossPickArt` and its fights have the key; a save without it — no key in its fights\' values; a malformed flag — no run', () => {
  for (const k of SEEDS) {
    const run = createRtRun(seedOf(k)), old = createRtRun(seedOf(k), { bossPickArt: false });
    assert(run.bossPickArt === true && old.bossPickArt === undefined && !serializeRtRun(old).includes('bossPickArt'), `seed ${k}: the flag`);
    assert(rtArenaParams(run, rtRunParams(defaultParams())).bossPickArt === true, `seed ${k}: the new run's fights — the key`);
    const back = parseRtRun(serializeRtRun(old));
    assert(back && !('bossPickArt' in rtArenaParams(back, rtRunParams(defaultParams()))), `seed ${k}: the old save — no key`);
    assert(JSON.stringify(parseRtRun(serializeRtRun(run))) === JSON.stringify(run), `seed ${k}: the save reads back`);
    assert(parseRtRun(serializeRtRun({ ...run, bossPickArt: 1 as unknown as true })) === null, `seed ${k}: a malformed flag`);
  }
});

console.log(`boss pick art: ${checks} checks passed`);
