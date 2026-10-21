/**
 * «Дыры ядра боссов» (task 55, stage Д, core's review 21.10.2026; design's decision): the sources that went round the boss core's
 * rules — the fire trail of an elite (elites.ts `updateAffixes`: `hp -=` past `damageEnemy`), the shaman's beam (enemies/shaman.ts:
 * it lifted a core of 0 HP), and the highlight of two end shadows in one window of the Troll (the wave and the end blast showed two
 * plates, the dash takes one). Node only: `npm run test:realtime-boss-holes`.
 *
 * Every check plays journalled commands (teleport, place, chill, begin / drag, release) on «Берлога тролля» and «Стан Главаря»:
 * - the fire trail over a closed core without plates (the sandbox's wider trail): with the key the HP stays and the core rings
 *   (`block`); without it — the old path: the HP drops; in the Troll's window the trail is the window's one hit;
 * - the shaman's beam on a core of 0 HP: with the key it never lifts the core; without it — the old path;
 * - the Troll's window, «Ледяная волна» and «Подрыв» at the end of one chain: with the key the highlight's plates on the core are
 *   the dash's (one); without it — the old highlight: two;
 * - the same with «Ударная волна» II in «Ледяная волна»: the end's wave and the start's both round the core — one plate shown;
 * - the sandbox: «Берлога тролля» and «Стан Главаря» play the keys on from the panel's values (off); another arena keeps them off;
 *   values without the keys (a journal before them) keep them absent — the old paths;
 * - every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { COUNTER_TALISMANS, FUSIONS } from './buildIds';
import { planChain } from './chain';
import { CHIEF, CHIEF_LADLE, CHIEF_SACK } from './enemies/chief';
import { TROLL, TROLL_CLUB, TROLL_ROCK } from './enemies/troll';
import type { Vec } from './geometry';
import type { Loadout } from './kit';
import { CORE_WARD_KEYS, defaultParams, type Params } from './params';
import { replay, Simulation, SIM_DT } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** Nobody comes, the hero cannot fall, no touch; the keys of this task on or off (`undefined` — absent: a journal before it). */
function quiet(key: boolean | undefined, extra: Partial<Params> = {}): Params {
  const p = { ...defaultParams(), baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6, speedSpread: 0, contactDamage: 0, heroHp: 999, hitstop: false, ...extra };
  for (const k of ['coreTrailWard', 'coreShamanWard', 'trollShadowOnce'] as const) {
    if (key === undefined) delete (p as Partial<Params>)[k]; else (p as Params)[k] = key;
  }
  return p;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (until(events)) break;
  }
  return out;
}
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}
const place = (sim: Simulation, at: Vec, hp: number, color: number, extra: { elite?: boolean; affixes?: string[]; kind?: string } = {}): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true, affixes: extra.affixes ?? [] } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const freeze = (sim: Simulation, e: Enemy, seconds = 600): void => { sim.command({ t: 'chill', id: e.id, seconds }); };
const kindOf = (w: World, kind: string): Enemy => w.enemies.find(e => e.kind === kind)!;
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/** A fiery elite walking south past the core (the hero south of it), the sandbox's trail wide enough to reach the core's centre. */
function trailPast(sim: Simulation, core: Enemy): void {
  sim.command({ t: 'teleport', x: core.x + 0.9, y: core.y + 6 });
  place(sim, { x: core.x + 0.9, y: core.y + 0.6 }, 3, 0, { elite: true, affixes: ['fiery'] });
}
const TRAIL: Partial<Params> = { trailRadius: 1.6, enemySpeed: 1 };

check('the fire trail over a closed core without plates: with the key the HP stays and the core rings (`block`); without it — the old path, the HP drops (the Troll, the Chief)', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true]) {
      // The Troll, his window closed (the club and the rock frozen: no move opens it).
      const troll = new Simulation({ arena: 'troll', params: quiet(key, { ...TRAIL, trollPlates: 0, trollHp: 3 }), seed: seedOf(k), record: true }), tw = troll.world;
      ticks(troll, 1);
      const core = kindOf(tw, TROLL);
      freeze(troll, kindOf(tw, TROLL_CLUB)); freeze(troll, kindOf(tw, TROLL_ROCK));
      trailPast(troll, core);
      const out = ticks(troll, ticksOf(4));
      const burned = of(out, 'enemyHit').filter(e => e.enemyId === core.id && e.source === 'fire-trail').length;
      if (key) assert(core.hp === 3 && burned === 0 && of(out, 'trollWindow').some(e => e.action === 'block' && e.source === 'fire-trail'), `seed ${k}: the Troll whole (${core.hp}), the trail rings`);
      else assert(core.hp < 3 && burned > 0, `seed ${k}: without the key the trail burns the closed core (${core.hp})`);
      assert(replays(troll), `seed ${k}, key ${key}: the Troll's replay`);
      // The Chief, outside his window (before the first feast).
      const chief = new Simulation({ arena: 'chief', params: quiet(key, { ...TRAIL, chiefPlates: 0, chiefHp: 3 }), seed: seedOf(k), record: true }), cw = chief.world;
      ticks(chief, 1);
      const boss = kindOf(cw, CHIEF);
      freeze(chief, kindOf(cw, CHIEF_LADLE)); freeze(chief, kindOf(cw, CHIEF_SACK));
      trailPast(chief, boss);
      const out2 = ticks(chief, ticksOf(3));
      if (key) assert(boss.hp === 3 && of(out2, 'chiefFeast').some(e => e.action === 'block' && e.source === 'fire-trail'), `seed ${k}: the Chief whole (${boss.hp}), the trail rings`);
      else assert(boss.hp < 3, `seed ${k}: without the key the trail burns the Chief (${boss.hp})`);
      assert(replays(chief), `seed ${k}, key ${key}: the Chief's replay`);
    }
  }
});

check('the shaman\'s beam on a core of 0 HP (the trail took its last HP in the Troll\'s window): with the key it never lifts the core; without it — the old path', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true]) {
      const sim = new Simulation({ arena: 'troll', params: quiet(key, { ...TRAIL, trollPlates: 0, trollHp: 1, trollWindowClub: 5 }), seed: seedOf(k), record: true }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, TROLL);
      freeze(sim, kindOf(w, TROLL_ROCK));
      // The club's window (5 s here), then the trail takes the core to 0 HP (the window's one hit — the trail's).
      sim.command({ t: 'teleport', x: 12, y: 6.5 });
      ticks(sim, ticksOf(12), [], ev => of(ev, 'trollWindow').some(e => e.action === 'open'));
      freeze(sim, kindOf(w, TROLL_CLUB));
      trailPast(sim, core);
      ticks(sim, ticksOf(3), [], () => core.hp === 0);
      assert(core.hp === 0, `seed ${k}, key ${key}: the core at 0 HP (${core.hp})`);
      // A shaman beside it; nobody walks now (the shaman keeps the core within its beam's reach), the hero away.
      sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
      sim.command({ t: 'teleport', x: 20, y: 12 });
      place(sim, { x: core.x - 1.6, y: core.y + 1.8 }, 2, 1, { kind: 'shaman' });
      // Its first beam after its cooldown and the beam's time (its first wait up to the cooldown 6 s, then the beam 1.5 s).
      const out = ticks(sim, ticksOf(14));
      const lifted = of(out, 'enemySignal').some(e => e.signal === 'empower' && e.enemyId === core.id);
      if (key) assert(core.hp === 0 && !lifted, `seed ${k}: the shaman never lifts the core (${core.hp})`);
      else assert(core.hp > 0 && lifted, `seed ${k}: without the key the old path — the core lifted (${core.hp})`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Troll\'s window, «Ледяная волна» and «Подрыв» at the end of one chain: with the key the highlight\'s plates on the core are the dash\'s (one); without it — the old highlight, two', () => {
  const kit: Loadout = { talismans: [FUSIONS.frostWave, FUSIONS.hunterBlast] };
  for (const k of SEEDS) {
    for (const key of [undefined, true]) {
      const sim = new Simulation({ arena: 'troll', params: quiet(key, { counterWindow: true, trollPlates: 5, trollHp: 4 }), seed: seedOf(k), record: true, loadout: kit }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, TROLL);
      freeze(sim, kindOf(w, TROLL_ROCK));
      sim.command({ t: 'teleport', x: 12, y: 6.5 });
      ticks(sim, ticksOf(12), [], ev => of(ev, 'trollWindow').some(e => e.action === 'open'));
      freeze(sim, kindOf(w, TROLL_CLUB));
      // Four links up to the core's side, the last a tough one (the blast's «Подрыв»): the end beside the core.
      sim.command({ t: 'teleport', x: 12.65, y: 7.3 });
      const links = [6.2, 5, 3.8].map(y => place(sim, { x: 12.65, y }, 0, 0)).concat(place(sim, { x: 12.65, y: 2.65 }, 1, 0));
      sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
      for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
      const plan = planChain(w);
      assert(w.chain.length === 4, `seed ${k}: four links (${w.chain.length})`);
      const onCore = [...plan.wave?.bodies ?? [], ...plan.blast?.bodies ?? []].filter(b => b.id === core.id);
      const planned = onCore.reduce((s, b) => s + ((b.platesBefore ?? 0) - (b.platesAfter ?? 0)), 0);
      sim.command({ t: 'release' });
      // The plates the dash's hits take off the core (a part severed by the wave or the blast costs the core its own plate after the
      // dash — not a hit of the window).
      const taken = of(settle(sim), 'elitePlates').filter(e => e.enemyId === core.id && e.action === 'strip').reduce((n, e) => n + (e.removed ?? 0), 0);
      if (key) assert(taken === 1 && planned === taken, `seed ${k}: the highlight's plates ${planned} = the dash's ${taken}`);
      else assert(taken === 1 && planned === 2, `seed ${k}: without the key — the old highlight, ${planned} plates for the dash's ${taken}`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the Troll\'s window, «Ударная волна» II in «Ледяная волна» — the end\'s wave and the start\'s both round the core: with the key the highlight\'s plates on the core are the dash\'s (one); without it — the old highlight, two', () => {
  const kit: Loadout = { talismans: [FUSIONS.frostWave], honed: [COUNTER_TALISMANS.shockwave] };
  for (const k of SEEDS) {
    for (const key of [undefined, true]) {
      const sim = new Simulation({ arena: 'troll', params: quiet(key, { counterWindow: true, trollPlates: 5, trollHp: 4 }), seed: seedOf(k), record: true, loadout: kit }), w = sim.world;
      ticks(sim, 1);
      const core = kindOf(w, TROLL);
      freeze(sim, kindOf(w, TROLL_ROCK));
      sim.command({ t: 'teleport', x: 12, y: 6.5 });
      ticks(sim, ticksOf(12), [], ev => of(ev, 'trollWindow').some(e => e.action === 'open'));
      freeze(sim, kindOf(w, TROLL_CLUB));
      // From beside the core, a loop of four links that ends beside it again: both waves reach the core.
      sim.command({ t: 'teleport', x: 11.2, y: 3.9 });
      const links = [{ x: 10.4, y: 5.3 }, { x: 11.4, y: 6.5 }, { x: 12.7, y: 5.6 }, { x: 13, y: 4 }].map(p => place(sim, p, 0, 0));
      sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
      for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
      const plan = planChain(w);
      assert(w.chain.length === 4 && plan.wave?.second, `seed ${k}: four links and both waves (${w.chain.length})`);
      const body = [...plan.wave!.bodies, ...plan.wave!.second!.bodies].find(b => b.id === core.id);
      const planned = (body?.platesBefore ?? 0) - (body?.platesAfter ?? 0);
      sim.command({ t: 'release' });
      const taken = of(settle(sim), 'elitePlates').filter(e => e.enemyId === core.id && e.action === 'strip').reduce((n, e) => n + (e.removed ?? 0), 0);
      if (key) assert(taken === 1 && planned === 1 && !plan.wave!.second!.bodies.some(b => b.id === core.id), `seed ${k}: the highlight's plates ${planned} = the dash's ${taken}; the start's wave leaves the core out`);
      else assert(taken === 1 && planned === 2, `seed ${k}: without the key — the old highlight, ${planned} plates for the dash's ${taken}`);
      assert(replays(sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

check('the sandbox: the Troll\'s and the Chief\'s arenas play the keys on from the panel\'s values (off); another arena keeps them off; values without the keys keep them absent', () => {
  for (const arena of ['troll', 'chief']) {
    const on = new Simulation({ arena, params: defaultParams(), seed: seedOf(1) }).world.params;
    assert(CORE_WARD_KEYS.every(key => on[key] === true), `${arena}: the keys on`);
    const old = new Simulation({ arena, params: quiet(undefined), seed: seedOf(1) }).world.params;
    assert(CORE_WARD_KEYS.every(key => !(key in old)), `${arena}: a journal without the keys keeps them absent`);
  }
  const other = new Simulation({ arena: 'jailer', params: defaultParams(), seed: seedOf(1) }).world.params;
  assert(CORE_WARD_KEYS.every(key => other[key] === false), 'the Jailer\'s arena: the keys as the panel has them');
});

console.log(`boss holes: ${checks} checks passed`);
