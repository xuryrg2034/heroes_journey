/**
 * «Дыры ядра» Колдуна (task 55, stage Д, core's decision 21.10.2026; `Params.warlockHoles`): the sources that went round the warlock
 * core's rules — the fire trail of an elite (elites.ts: `hp -=` past `damageEnemy`; spec 6.2: charmed, nothing but a shove's strike
 * lands), the shaman's beam (it lifted a core of 0 HP), the highlight of two end shadows in one window (the wave and the end blast, the
 * end's wave and the start's of «Ударная волна» II). Node only: `npm run test:realtime-boss-holes`.
 *
 * Every check plays journalled commands (teleport, place, chill, begin / drag, release) on «Зал колдуна»:
 * - the fire trail over his core without plates, charmed and out of his window: with the key it rings at the trail's pace (as many
 *   «звон» as the old path's burns), the HP stays; without it — the old path, the HP drops;
 * - the shaman's beam on his core at 0 HP (the trail took its last HP in his window): with the key it never lifts it; without it — the
 *   old path;
 * - his window, «Ледяная волна» and «Подрыв», and «Ударная волна» II in «Ледяная волна», at the end of one chain beside him: with the
 *   key the highlight's plates on the core are the dash's (one); without it — the old highlight, two;
 * - charmed, the same chain: the highlight shows no plate on him and the dash takes none (the key or not);
 * - «Зал колдуна» puts the key on from the panel's values (off); values without it keep it absent; the Troll's arena keeps it as given;
 * - every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { WARLOCK_ARENA } from './arenasCastle';
import { COUNTER_TALISMANS, FUSIONS } from './buildIds';
import { planChain } from './chain';
import { WARDROBE } from './enemies/castle';
import { WARLOCK, warlockState } from './enemies/warlock';
import type { Vec } from './geometry';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { durabilityOf } from './shove';
import { replay, Simulation, SIM_DT } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/** Nobody comes, the hero cannot fall; the key on or absent (`undefined`: a journal before it). */
function quiet(key: true | undefined, extra: Partial<Params> = {}): Params {
  const p: Partial<Params> = { ...defaultParams(), baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6, speedSpread: 0, contactDamage: 0, heroHp: 999, hitstop: false, invulnerability: 0, chainShield: 0, shoveDistance: 6, ...extra };
  if (key) p.warlockHoles = true; else delete p.warlockHoles;
  // Task 55 §23: these routes are Колдун v0's — values without `warlockV1` (the hall puts v1 on only when the values have it off).
  delete p.warlockV1;
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
function settle(sim: Simulation): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 900 && (sim.world.move || sim.world.shoves || i === 0); i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}
const place = (sim: Simulation, at: Vec, hp: number, color: number, extra: { elite?: boolean; affixes?: string[]; kind?: string } = {}): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true, affixes: extra.affixes ?? [] } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};

type Gate = 'charmed' | 'open' | 'shut';
interface Hall { sim: Simulation; w: World; core: Enemy }
/** «Зал колдуна» in the state `gate`: charmed (the start); his wardrobe broken at the north wall and his window open (just arrived); closed (its time out). */
function hall(k: number, key: true | undefined, gate: Gate, extra: Partial<Params> = {}, loadout?: Loadout): Hall {
  const sim = new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(key, extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 14 });
  ticks(sim, 1);
  const core = w.enemies.find(e => e.kind === WARLOCK)!;
  if (gate === 'charmed') return { sim, w, core };
  const wardrobe = w.enemies.find(e => e.kind === WARDROBE)!;
  for (let n = 0; n < 2; n++) {
    const d = Math.abs(wardrobe.y + 10) || 1;
    sim.command({ t: 'teleport', x: wardrobe.x, y: wardrobe.y + (wardrobe.y + 10) / d });
    sim.command({ t: 'begin', x: wardrobe.x, y: wardrobe.y });
    sim.command({ t: 'release' });
    ticks(sim, ticksOf(4), [], ww => !ww.move && !ww.shoves);
  }
  assert(!w.enemies.includes(wardrobe) || durabilityOf(wardrobe) === 0, `seed ${k}: the wardrobe broken`);
  ticks(sim, ticksOf(3), [], (_w, ev) => ev.some(e => e.type === 'warlockShift' && e.action === 'arrive'));
  if (gate === 'shut') ticks(sim, ticksOf(2), [], ww => !warlockState(ww)!.window);
  const s = warlockState(w)!;
  assert(gate === 'open' ? s.window?.open : !s.window, `seed ${k}: the gate ${gate} (${JSON.stringify(s.window)})`);
  return { sim, w, core };
}

/** A fiery elite walking past the core (the hero away from it), the sandbox's wide trail. */
function trailPast(sim: Simulation, core: Enemy): void {
  const s = core.y > 8 ? -1 : 1;
  sim.command({ t: 'teleport', x: core.x + 0.9, y: core.y + 6 * s });
  place(sim, { x: core.x + 0.9, y: core.y + 0.6 * s }, 3, 0, { elite: true, affixes: ['fiery'] });
}
const TRAIL: Partial<Params> = { trailRadius: 1.6, enemySpeed: 1 };

check('the fire trail over his core without plates, charmed and out of his window: with the key it rings at the trail\'s pace (as many «звон» as the old path\'s burns), the HP stays; without it — the old path, the HP drops', () => {
  for (const k of SEEDS) {
    for (const gate of ['charmed', 'shut'] as const) {
      const fight = (key: true | undefined): { burns: number; rings: number; hp: number } => {
        const h = hall(k, key, gate, { ...TRAIL, warlockPlates: 0, warlockHp: 50 });
        trailPast(h.sim, h.core);
        const out = ticks(h.sim, ticksOf(2.5));
        assert(replays(h.sim), `seed ${k}, ${gate}, key ${key}: replay`);
        const rings = [...of(out, 'warlockCharm'), ...of(out, 'warlockWindow')].filter(e => e.action === 'block' && e.source === 'fire-trail').length;
        return { burns: of(out, 'enemyHit').filter(e => e.enemyId === h.core.id && e.source === 'fire-trail').length, rings, hp: h.core.hp };
      };
      const old = fight(undefined), ward = fight(true);
      assert(old.burns >= 2 && old.hp < 50, `seed ${k}, ${gate}: the old path burns the core (${old.burns}, HP ${old.hp})`);
      assert(ward.burns === 0 && ward.hp === 50 && ward.rings === old.burns, `seed ${k}, ${gate}: «звон» ${ward.rings} for the old burns ${old.burns}, HP ${ward.hp}`);
    }
  }
});

check('the shaman\'s beam on his core at 0 HP (the trail took its last HP in his window): with the key it never lifts it; without it — the old path', () => {
  for (const k of SEEDS) {
    for (const key of [undefined, true] as const) {
      const h = hall(k, key, 'open', { ...TRAIL, warlockPlates: 0, warlockHp: 1 });
      trailPast(h.sim, h.core);
      ticks(h.sim, ticksOf(1.4), [], () => h.core.hp === 0);
      assert(h.core.hp === 0, `seed ${k}, key ${key}: the core at 0 HP (${h.core.hp})`);
      // His timers held (no «Перенос»: the shaman keeps him within its beam), nobody walks, the hero away; a shaman beside him.
      h.sim.command({ t: 'chill', id: h.core.id, seconds: 60 });
      h.sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
      h.sim.command({ t: 'teleport', x: 12, y: 14 });
      place(h.sim, { x: h.core.x - 1.6, y: h.core.y + (h.core.y > 8 ? -1.8 : 1.8) }, 2, 1, { kind: 'shaman' });
      const out = ticks(h.sim, ticksOf(14));
      const lifted = of(out, 'enemySignal').some(e => e.signal === 'empower' && e.enemyId === h.core.id);
      if (key) assert(h.core.hp === 0 && !lifted, `seed ${k}: the shaman never lifts him (${h.core.hp})`);
      // The old path: the beam lifts him (the trail may burn him down again after it).
      else assert(lifted, `seed ${k}: without the key the old path — lifted`);
      assert(replays(h.sim), `seed ${k}, key ${key}: replay`);
    }
  }
});

/**
 * The chain drawn beside the core: `column` — four links up to its side, the last a tough one (the end blast's «Подрыв»), the hero at
 * the column's foot; `loop` — from beside the core four links that end beside it again (both waves of «Ударная волна» II reach it).
 */
function chainBeside(h: Hall, layout: 'column' | 'loop'): Enemy[] {
  const s = h.core.y > 8 ? -1 : 1, c = h.core;
  const at = (dx: number, dy: number): Vec => ({ x: c.x + dx, y: c.y + dy * s });
  let links: Enemy[];
  if (layout === 'column') {
    h.sim.command({ t: 'teleport', ...at(0.65, 5.1) });
    links = [4, 2.8, 1.6].map(d => place(h.sim, at(0.65, d), 0, 0)).concat(place(h.sim, at(0.65, 0.45), 1, 0));
  } else {
    h.sim.command({ t: 'teleport', ...at(-0.8, 1.7) });
    links = [at(-1.6, 3.1), at(-0.6, 4.3), at(0.7, 3.4), at(1, 1.8)].map(q => place(h.sim, q, 0, 0));
  }
  h.sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) h.sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  return links;
}
/** The plates the highlight shows on the core (its wave, second wave and blast bodies) and the ones the dash takes off it. */
function plates(h: Hall): { planned: number; taken: number } {
  const plan = planChain(h.w);
  // The wave's lists (the end's and the start's) both read the plates from before the dash to after both waves; the blast's — its own.
  const diff = (bodies: readonly { id: number; platesBefore?: number; platesAfter?: number }[] | undefined): number =>
    Math.max(0, ...(bodies ?? []).filter(b => b.id === h.core.id).map(b => (b.platesBefore ?? 0) - (b.platesAfter ?? 0)));
  const planned = Math.max(diff(plan.wave?.bodies), diff(plan.wave?.second?.bodies)) + diff(plan.blast?.bodies);
  h.sim.command({ t: 'release' });
  const taken = of(settle(h.sim), 'elitePlates').filter(e => e.enemyId === h.core.id && e.action === 'strip').reduce((n, e) => n + (e.removed ?? 0), 0);
  return { planned, taken };
}
const KITS: readonly [string, Loadout, 'column' | 'loop'][] = [
  ['«Ледяная волна» + «Подрыв»', { talismans: [FUSIONS.frostWave, FUSIONS.hunterBlast] }, 'column'],
  ['«Ударная волна» II in «Ледяная волна»', { talismans: [FUSIONS.frostWave], honed: [COUNTER_TALISMANS.shockwave] }, 'loop'],
];

check('his window, two end shadows round him («Ледяная волна» + «Подрыв»; «Ударная волна» II in «Ледяная волна»): with the key the highlight\'s plates on the core are the dash\'s (one); without it — the old highlight, two', () => {
  for (const [name, kit, layout] of KITS) {
    for (const k of SEEDS) {
      for (const key of [undefined, true] as const) {
        const h = hall(k, key, 'open', { counterWindow: true, warlockPlates: 5, warlockHp: 4 }, kit);
        const links = chainBeside(h, layout);
        assert(h.w.chain.length === links.length, `${name}, seed ${k}: four links (${h.w.chain.length})`);
        const { planned, taken } = plates(h);
        if (key) assert(taken === 1 && planned === taken, `${name}, seed ${k}: the highlight's plates ${planned} = the dash's ${taken}`);
        else assert(taken === 1 && planned === 2, `${name}, seed ${k}: without the key — the old highlight, ${planned} plates for the dash's ${taken}`);
        assert(replays(h.sim), `${name}, seed ${k}, key ${key}: replay`);
      }
    }
  }
});

check('charmed, the same chains beside him: the highlight shows no plate on him and the dash takes none (the key or not)', () => {
  for (const [name, kit, layout] of KITS) {
    for (const k of SEEDS) {
      for (const key of [undefined, true] as const) {
        const h = hall(k, key, 'charmed', { counterWindow: true, warlockPlates: 5, warlockHp: 4 }, kit);
        chainBeside(h, layout);
        const { planned, taken } = plates(h);
        assert(planned === 0 && taken === 0, `${name}, seed ${k}, key ${key}: charmed — planned ${planned}, taken ${taken}`);
        assert(replays(h.sim), `${name}, seed ${k}, key ${key}: replay`);
      }
    }
  }
});

check('the sandbox: «Зал колдуна» puts the key on from the panel\'s values (off); values without it keep it absent; the Troll\'s arena keeps it as given', () => {
  assert(new Simulation({ arena: WARLOCK_ARENA.id, params: defaultParams(), seed: seedOf(1) }).world.params.warlockHoles === true, 'the hall: the key on');
  assert(!('warlockHoles' in new Simulation({ arena: WARLOCK_ARENA.id, params: quiet(undefined), seed: seedOf(1) }).world.params), 'the hall: values without the key keep it absent');
  assert(new Simulation({ arena: 'troll', params: defaultParams(), seed: seedOf(1) }).world.params.warlockHoles === false, 'the Troll\'s arena: as the panel has it');
});

console.log(`warlock holes: ${checks} checks passed`);
