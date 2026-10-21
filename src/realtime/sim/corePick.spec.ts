/**
 * «Ядро в окне — первым» (design 21.10.2026; `Params.corePickFirst`, chain.ts `pick`): a crowd body standing on a boss core is nearer
 * to the pointer, and a click into the window took the body. With the key a core in its open window that the chain may take now and
 * that has the pointer inside its press circle (`pickRadius`) is picked first. Node only: `npm run test:realtime-core-pick`.
 *
 * Every check plays journalled commands (place, crystal, teleport, chill, begin / drag, release) on «Берлога тролля», «Стан Главаря»
 * and «Зал колдуна»:
 * - a body on the core, the window open, the pointer on the body inside the core's circle: with the key the chain takes the core (the
 *   press, the drag; `pickAt` and the highlight say the same, the hint shows no refusal); without it — the body (the old path);
 * - the window closed (the Troll before it, the warlock charmed), the pointer outside the core's circle, the core struck in this window,
 *   the Chief's queue short (the core may not join yet), no window rule at all (turned off by `param`) — the body, with the key too;
 * - a crystal on the core in its window: with the key the core, without it the crystal;
 * - «Печать»: the chain's first link on the core, the pointer back on it inside the core's circle — with the key the loop does not
 *   close and the core joins (`loopKindAt` and `pickAt` agree), without it the loop closes;
 * - the bosses' arenas put the key on from the panel's values (off); values without it keep it absent; another arena keeps it off;
 * - the run: a new run's fights have the key, a save without the flag — no key in its fights' values;
 * - every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { WARLOCK_ARENA } from './arenasCastle';
import { hoverRefusal, loopKindAt, pickAt, pickRadius, planChain } from './chain';
import { CHIEF, CHIEF_LADLE, CHIEF_SACK, chiefState } from './enemies/chief';
import { WARDROBE } from './enemies/castle';
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
  if (key) p.corePickFirst = true; else delete p.corePickFirst;
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
function settle(sim: Simulation): void { for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); sim.world.events.splice(0); } }
const place = (sim: Simulation, at: Vec, color: number, hp = 1): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const freeze = (sim: Simulation, e: Enemy | undefined, seconds = 600): void => { if (e) sim.command({ t: 'chill', id: e.id, seconds }); };
const kindOf = (w: World, kind: string): Enemy | undefined => w.enemies.find(e => e.kind === kind);
/** A point on the core's body: `r` from its centre (south-east), inside its press circle for `r` < `pickRadius`. */
const onCore = (core: Enemy, r: number): Vec => ({ x: core.x + r * 0.6, y: core.y + r * 0.8 });

/** «Берлога тролля»: the club's window open (the rock and then the club frozen), the hero below the core. */
function trollOpen(k: number, key: true | undefined): { sim: Simulation; w: World; core: Enemy } {
  const sim = new Simulation({ arena: 'troll', params: quiet(key, { trollWindowClub: 5 }), seed: seedOf(k), record: true }), w = sim.world;
  ticks(sim, 1);
  const core = kindOf(w, TROLL)!;
  freeze(sim, kindOf(w, TROLL_ROCK));
  sim.command({ t: 'teleport', x: 12, y: 6.5 });
  const out = ticks(sim, ticksOf(12), [], (_w, ev) => ev.some(e => e.type === 'trollWindow' && e.action === 'open'));
  assert(out.some(e => e.type === 'trollWindow' && e.action === 'open'), `seed ${k}: the Troll's window opened`);
  freeze(sim, kindOf(w, TROLL_CLUB));
  sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
  return { sim, w, core };
}
/** The press at `p`: what `pickAt` said before it, the chain's first link after it, the highlight's first body, the hint. */
function press(sim: Simulation, p: Vec): { said: number | null; took: number | null; shown: number | null; hint: string | null } {
  const w = sim.world, said = pickAt(w, p)?.id ?? null, hint = hoverRefusal(w, p);
  sim.command({ t: 'begin', x: p.x, y: p.y });
  const took = w.chain[0]?.id ?? null, shown = planChain(w).links[0]?.link.id ?? null;
  return { said, took, shown, hint };
}

check('the Troll\'s window, a body on the core, the pointer on the body inside the core\'s circle: with the key the core (the press, `pickAt`, the highlight; no hint), without it the body; outside the circle — the body', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, w, core } = trollOpen(k, key);
      const r = pickRadius(w, core), body = place(sim, onCore(core, r * 0.5), 1);
      const at = { x: body.x, y: body.y }, got = press(sim, at);
      const want = key ? core.id : body.id;
      assert(got.took === want && got.said === want && got.shown === want && got.hint === null, `seed ${k}, key ${key}: took ${got.took}, said ${got.said}, shown ${got.shown} (core ${core.id}, body ${body.id})`);
      sim.command({ t: 'cancel' });
      // Outside the core's circle: the body, the key or not.
      const far = place(sim, onCore(core, r + 0.25), 2), out = press(sim, { x: far.x, y: far.y });
      assert(out.took === far.id && out.said === far.id, `seed ${k}, key ${key}: outside the circle — the body (${out.took})`);
      sim.command({ t: 'cancel' });
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('«Печать» (sandbox `loopEnabled`), the Troll\'s window: the chain\'s first link on the core, four links drawn, the pointer back on the first link inside the core\'s circle — with the key the loop does not close and the core joins (`loopKindAt` null, `pickAt` the core); without it the loop closes on the first link', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, w, core } = trollOpen(k, key);
      sim.command({ t: 'param', key: 'loopEnabled', value: true });
      const first = place(sim, onCore(core, pickRadius(w, core) * 0.5), 1, 0);
      const rest = [{ x: 12.9, y: 3.3 }, { x: 13.3, y: 4.4 }, { x: 11.5, y: 3.6 }].map(q => place(sim, q, 1, 0));
      // The press on the first link's far side, out of the core's circle (inside it the press takes the core, the rule).
      const ux = (first.x - core.x) / Math.hypot(first.x - core.x, first.y - core.y), uy = (first.y - core.y) / Math.hypot(first.x - core.x, first.y - core.y);
      sim.command({ t: 'begin', x: first.x + ux * 0.35, y: first.y + uy * 0.35 });
      for (const e of rest) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
      assert(w.chain.length === 4 && w.chain[0].id === first.id, `seed ${k}, key ${key}: four links from the one on the core (${w.chain.map(l => l.id)})`);
      const at = { x: first.x, y: first.y };
      const closes = loopKindAt(w, at), said = pickAt(w, at)?.id;
      sim.command({ t: 'drag', x: at.x, y: at.y, mode: 'full' });
      if (key) {
        assert(closes === null && said === core.id, `seed ${k}: the loop does not close (${closes}), pickAt the core (${said})`);
        assert(!w.chainClosed && (w.chain.length as number) === 5 && w.chain[4].id === core.id, `seed ${k}: the core joined, no loop (${w.chainClosed}, ${w.chain.map(l => l.id)})`);
      } else assert(closes === 'first' && w.chainClosed === 'first' && w.chain.length === 4, `seed ${k}: without the key the loop closes on the first link (${closes}, ${w.chainClosed})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Troll: his window closed (before it), or struck in this window — the body, with the key too', () => {
  for (const k of SEEDS) {
    // Closed: the club and the rock frozen from the start, no move opens the window.
    const sim = new Simulation({ arena: 'troll', params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
    ticks(sim, 1);
    const core = kindOf(w, TROLL)!;
    freeze(sim, kindOf(w, TROLL_CLUB)); freeze(sim, kindOf(w, TROLL_ROCK));
    sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
    const body = place(sim, onCore(core, pickRadius(w, core) * 0.5), 1), shut = press(sim, { x: body.x, y: body.y });
    assert(shut.took === body.id && shut.said === body.id, `seed ${k}: the window closed — the body (${shut.took})`);
    assert(replays(sim), `seed ${k}: replay (closed)`);
    // Struck: the window's hit spent by a chain of the core alone; then a body on the core — the body.
    const open = trollOpen(k, true);
    open.sim.command({ t: 'begin', x: open.core.x, y: open.core.y });
    assert(open.w.chain[0]?.id === open.core.id, `seed ${k}: the core taken in the window`);
    open.sim.command({ t: 'release' });
    settle(open.sim);
    open.sim.command({ t: 'teleport', x: open.core.x + 0.3, y: open.core.y + 1.6 });
    const after = place(open.sim, onCore(open.core, pickRadius(open.w, open.core) * 0.5), 1), spent = press(open.sim, { x: after.x, y: after.y });
    assert(spent.took === after.id, `seed ${k}: the window's hit spent — the body (${spent.took})`);
    assert(replays(open.sim), `seed ${k}: replay (struck)`);
  }
});

check('the Troll\'s window, a crystal on the core: with the key the core, without it the crystal (the nearer object)', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const { sim, w, core } = trollOpen(k, key);
      const at = onCore(core, pickRadius(w, core) * 0.4);
      sim.command({ t: 'crystal', x: at.x, y: at.y, value: 1 });
      const crystal = w.objects[w.objects.length - 1];
      const got = press(sim, at);
      assert(key ? got.took === core.id && w.chain[0].kind === 'enemy' : w.chain[0]?.kind === 'object' && got.took === crystal.id, `seed ${k}, key ${key}: took ${JSON.stringify(w.chain[0])}`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Chief\'s feast, a body of the brew on the core: two eaters before it — the body (the queue short), with the key too; three — with the key the drag takes the core (a plate shown), without it the body', () => {
  const SEATS: readonly Vec[] = [{ x: 11.8, y: 4.4 }, { x: 10.7, y: 4.6 }, { x: 9.8, y: 4 }];
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const sim = new Simulation({ arena: 'chief', params: quiet(key), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, CHIEF)!;
      freeze(sim, kindOf(w, CHIEF_LADLE)); freeze(sim, kindOf(w, CHIEF_SACK));
      sim.command({ t: 'teleport', x: 12.9, y: 5.6 });
      const opened = ticks(sim, ticksOf(30), [], (_w, ev) => ev.some(e => e.type === 'chiefFeast' && e.action === 'open'));
      assert(opened.some(e => e.type === 'chiefFeast' && e.action === 'open'), `seed ${k}: the feast opened`);
      const three = SEATS.map(s => w.enemies.find(e => e.vars.eat && Math.hypot(e.x - s.x, e.y - s.y) < 0.05)!);
      assert(three.every(Boolean), `seed ${k}: three eaters seated`);
      sim.command({ t: 'begin', x: three[0].x, y: three[0].y });
      sim.command({ t: 'drag', x: three[1].x, y: three[1].y, mode: 'full' });
      // Two links of the brew: the core may not join yet («в очередь») — the body, with the key too.
      const body = place(sim, onCore(core, pickRadius(w, core) * 0.5), chiefState(w)!.brew, 0), at = { x: body.x, y: body.y };
      assert(w.chain.length as number === 2 && pickAt(w, at)?.id === body.id, `seed ${k}, key ${key}: a short queue — the body (${pickAt(w, at)?.id})`);
      sim.command({ t: 'drag', x: three[2].x, y: three[2].y, mode: 'full' });
      assert(w.chain.length as number === 3, `seed ${k}: three links (${w.chain.length})`);
      const said = pickAt(w, at)?.id;
      sim.command({ t: 'drag', x: at.x, y: at.y, mode: 'full' });
      const want = key ? core.id : body.id, plan = planChain(w);
      assert(w.chain.length === 4 && w.chain[3].id === want && said === want, `seed ${k}, key ${key}: the 4th link ${w.chain[3]?.id}, said ${said} (core ${core.id}, body ${body.id})`);
      if (key) assert(plan.links[3].link.id === core.id && plan.links[3].outcome?.plate, `seed ${k}: the highlight's plate on the core`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

/** «Зал колдуна»: his wardrobe broken at the north wall (two shoves), then his window open after «Перенос». */
function warlockOpen(k: number, key: true | undefined): { sim: Simulation; w: World; core: Enemy } {
  const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(key, { shoveDistance: 6, invulnerability: 0, chainShield: 0 }), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 14 });
  ticks(sim, 1);
  const core = kindOf(w, WARLOCK)!, wardrobe = kindOf(w, WARDROBE)!;
  for (let n = 0; n < 2; n++) {
    const d = Math.abs(wardrobe.y + 10) || 1;
    sim.command({ t: 'teleport', x: wardrobe.x, y: wardrobe.y + (wardrobe.y + 10) / d });
    sim.command({ t: 'begin', x: wardrobe.x, y: wardrobe.y });
    sim.command({ t: 'release' });
    ticks(sim, ticksOf(4), [], ww => !ww.move && !ww.shoves);
  }
  assert(!w.enemies.includes(wardrobe) || durabilityOf(wardrobe) === 0, `seed ${k}: the wardrobe broken`);
  ticks(sim, ticksOf(3), [], (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
  assert(warlockState(w)?.window?.open, `seed ${k}: the warlock's window open (${JSON.stringify(warlockState(w)?.window)})`);
  sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
  return { sim, w, core };
}

check('the warlock: charmed — the body, with the key too; his window open after the charm — with the key the core, without it the body', () => {
  for (const k of SEEDS) {
    // Charmed (the start): the chain never takes him.
    const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
    ticks(sim, 1);
    const core = kindOf(w, WARLOCK)!;
    sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
    const body = place(sim, onCore(core, pickRadius(w, core) * 0.5), 1), charmed = press(sim, { x: body.x, y: body.y });
    assert(charmed.took === body.id, `seed ${k}: charmed — the body (${charmed.took})`);
    assert(replays(sim), `seed ${k}: replay (charmed)`);
    for (const key of [undefined, true] as const) {
      const open = warlockOpen(k, key);
      const b = place(open.sim, onCore(open.core, pickRadius(open.w, open.core) * 0.5), 1), got = press(open.sim, { x: b.x, y: b.y });
      const want = key ? open.core.id : b.id;
      assert(got.took === want && got.said === want && got.shown === want, `seed ${k}, key ${key}: took ${got.took} (core ${open.core.id}, body ${b.id})`);
      assert(replays(open.sim), `seed ${k}, key ${key}: replay (open)`);
    }
  }
});

check('no window rule (the Troll\'s window, the Chief\'s feast, the warlock\'s charm turned off by `param`): the core is taken any time — no window, the nearest body, with the key too', () => {
  for (const k of SEEDS) {
    for (const [arena, kind, rule] of [['troll', TROLL, 'trollWindow'], ['chief', CHIEF, 'chiefFeast'], [WARLOCK_ARENA.id, WARLOCK, 'warlockCharm']] as const) {
      const sim = new Simulation({ arena, params: quiet(true), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, kind)!;
      for (const part of [TROLL_CLUB, TROLL_ROCK, CHIEF_LADLE, CHIEF_SACK]) freeze(sim, kindOf(w, part));
      sim.command({ t: 'param', key: rule, value: false });
      sim.command({ t: 'teleport', x: core.x + 0.3, y: core.y + 1.6 });
      const body = place(sim, onCore(core, pickRadius(w, core) * 0.5), 1);
      assert(pickAt(w, { x: core.x, y: core.y })?.id === core.id, `seed ${k}, ${arena}: the core takeable without the rule`);
      const got = press(sim, { x: body.x, y: body.y });
      assert(got.took === body.id, `seed ${k}, ${arena}: no window — the body (${got.took})`);
      assert(replays(sim), `seed ${k}, ${arena}: replay`);
    }
  }
});

check('the sandbox: the Troll\'s, the Chief\'s and the warlock\'s arenas put the key on from the panel\'s values (off); values without it keep it absent; another arena keeps it off', () => {
  for (const arena of ['troll', 'chief', WARLOCK_ARENA.id]) {
    assert(new Simulation({ arena, params: defaultParams(), seed: seedOf(1) }).world.params.corePickFirst === true, `${arena}: the key on`);
    assert(!('corePickFirst' in new Simulation({ arena, params: quiet(undefined), seed: seedOf(1) }).world.params), `${arena}: values without the key keep it absent`);
  }
  assert(new Simulation({ arena: 'jailer', params: defaultParams(), seed: seedOf(1) }).world.params.corePickFirst === false, 'the Jailer\'s arena: the key as the panel has it');
});

check('the run: a new run keeps the flag `corePickFirst` and its fights have the key; a save without it — no key in its fights\' values; a malformed flag — no run', () => {
  for (const k of SEEDS) {
    const run = createRtRun(seedOf(k)), old = createRtRun(seedOf(k), { corePickFirst: false });
    assert(run.corePickFirst === true && old.corePickFirst === undefined && !serializeRtRun(old).includes('corePickFirst'), `seed ${k}: the flag`);
    assert(rtArenaParams(run, rtRunParams(defaultParams())).corePickFirst === true, `seed ${k}: the new run's fights — the key`);
    const back = parseRtRun(serializeRtRun(old));
    assert(back && !('corePickFirst' in rtArenaParams(back, rtRunParams(defaultParams()))), `seed ${k}: the old save — no key`);
    assert(JSON.stringify(parseRtRun(serializeRtRun(run))) === JSON.stringify(run), `seed ${k}: the save reads back`);
    assert(parseRtRun(serializeRtRun({ ...run, corePickFirst: 1 as unknown as true })) === null, `seed ${k}: a malformed flag`);
  }
});

console.log(`core pick: ${checks} checks passed`);
