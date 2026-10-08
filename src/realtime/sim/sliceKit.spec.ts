/**
 * Step 3 of the slice (stage 2 of the transition; docs/realtime-slice.md, sections 6–8 and 11, «Шаг 3»): the spin (Q),
 * the consumables 1–4, elites and the talismans in the arena. Node only: `npm run test:realtime-kit`.
 *
 * Every check plays the simulation through journalled commands (place, teleport, energy, spin, item, begin, drag,
 * release, walk …) and looks at what the player sees: who dies, the hero's HP and energy, the kill counter, what lies on
 * the arena. Seeds are spread (`Math.imul(k, 2654435761) >>> 0`); fights replay from their journals to the same hash.
 */
import { canSpin } from './abilities';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, World } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Spread seeds: neighbouring small seeds roll alike. */
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, enemies stand (speed 0), touches do not hurt — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}

function fight(arena: string, params: Params, seed: number, options: Partial<ConstructorParameters<typeof Simulation>[0]> = {}): Simulation {
  const sim = new Simulation({ arena, params, seed, record: true, ...options });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, kind = 'basic', color = 0, hp = 0): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) sim.tick(); };
const settle = (sim: Simulation): void => { for (let i = 0; i < 240 && sim.world.move; i++) sim.tick(); };
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Read through a function: a value narrowed by an assertion stays readable after a command changes it. */
const energyOf = (w: World): number => w.energy;
const chainOf = (w: World): World['chain'] => w.chain;
const moveOf = (w: World): string | null => w.move?.kind ?? null;

// ---- Spin (Q) ----

check('spin: 4 to every enemy within 1.2 of the hero — any colour, a shield facing the hero — for 3 energy, kills credited', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = fight('shields', quiet(), seedOf(k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const weak = place(sim, 9, 5, 'basic', 0, 0);
    const four = place(sim, 7, 5, 'basic', 1, 4);
    const five = place(sim, 8, 6, 'basic', 2, 5);
    const shield = place(sim, 8, 4, 'shield', 3, 1);
    const far = place(sim, 10.2, 5, 'basic', 0, 0);
    assert(shield.vars.facing !== undefined && Math.abs(Math.sin(shield.vars.facing) - 1) < 1e-6, 'the shield faces the hero');
    sim.command({ t: 'energy', value: 3.5 });
    assert(canSpin(w) && sim.command({ t: 'spin' }) === true, 'spin used');
    assert(Math.abs(w.energy - 0.5) < 1e-9, `energy ${w.energy}`);
    assert(!alive(w, weak) && !alive(w, four) && !alive(w, shield), 'weak, HP 4 and the shieldbearer die');
    assert(alive(w, five) && five.hp === 1, `HP 5 → ${five.hp}`);
    assert(alive(w, far), 'an enemy out of the circle is untouched');
    assert(w.stats.kills === 3 && w.stats.score === 3 * w.params.scorePerKill, `kills ${w.stats.kills}, score ${w.stats.score}`);
    // No chain hit: no energy, no crystal.
    assert(Math.abs(w.energy - 0.5) < 1e-9 && !w.objects.some(o => o.kind === 'crystal'), 'no energy, no crystal from the spin');
    ticks(sim, 30);
    assert(replays(sim), 'replay');
  }
});

check('spin and jump need their energy: without it nothing happens', () => {
  const sim = fight('kills', quiet(), seedOf(5)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const e = place(sim, 8.8, 5, 'basic', 0, 0);
  sim.command({ t: 'energy', value: 2.5 });
  assert(sim.command({ t: 'spin' }) === false && alive(w, e) && w.energy === 2.5, 'spin at 2.5 energy refused');
  sim.command({ t: 'energy', value: 1.5 });
  assert(sim.command({ t: 'jump', x: 10, y: 5 }) === false && !moveOf(w) && energyOf(w) === 1.5, 'jump at 1.5 energy refused');
  sim.command({ t: 'energy', value: 3 });
  assert(sim.command({ t: 'spin' }) === true && !alive(w, e) && energyOf(w) === 0, 'spin at exactly 3');
});

check('spin: not during the dash or a jump; while a chain is drawn it works and its kill drops out of the chain', () => {
  const sim = fight('kills', quiet(), seedOf(6)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const a = place(sim, 9.2, 5, 'basic', 1, 0), b = place(sim, 10.6, 5, 'basic', 1, 0), c = place(sim, 7.2, 5, 'basic', 2, 5);
  sim.command({ t: 'energy', value: 7 });
  // Drawing: the spin kills the first link (within 1.2 + body) and the chain loses it.
  sim.command({ t: 'begin', x: a.x, y: a.y });
  sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
  assert(w.chain.length === 2, 'chain of two');
  assert(sim.command({ t: 'spin' }) === true, 'spin while drawing');
  assert(!alive(w, a) && alive(w, c) && c.hp === 1, 'the near link dies, the HP 5 one is wounded to 1');
  sim.tick();
  assert(chainOf(w).length === 1 && chainOf(w)[0].id === b.id, `the dead link drops out: ${JSON.stringify(w.chain)}`);
  // During the dash: refused.
  sim.command({ t: 'release' });
  sim.tick();
  assert(w.move?.kind === 'dash', 'dashing');
  const before = energyOf(w);
  assert(sim.command({ t: 'spin' }) === false && energyOf(w) === before, 'spin refused in the dash');
  settle(sim);
  // During a jump: refused.
  sim.command({ t: 'energy', value: 7 });
  assert(sim.command({ t: 'jump', x: w.hero.x - 2, y: w.hero.y }) === true && moveOf(w) === 'jump', 'jumping');
  assert(sim.command({ t: 'spin' }) === false && energyOf(w) === 5, 'spin refused in a jump');
  settle(sim);
  assert(replays(sim), 'replay');
});

check('spin: a porcupine struck by it does not hurt the hero (quills answer the chain only); a sapper it kills blows up as the player\'s', () => {
  const sim = fight('powder', quiet(), seedOf(7)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const porcupine = place(sim, 8.9, 5, 'porcupine', 0, 1);
  const sapper = place(sim, 7.1, 5, 'sapper', 1, 0);
  // Two weak enemies in the sapper's blast, out of the spin's circle.
  const near1 = place(sim, 6.0, 5, 'basic', 2, 0), near2 = place(sim, 6.2, 5.9, 'basic', 3, 0);
  sim.command({ t: 'energy', value: 3 });
  const hp = w.hero.hp;
  assert(sim.command({ t: 'spin' }) === true, 'spin');
  assert(!alive(w, porcupine) && !alive(w, sapper) && w.hero.hp === hp, `porcupine dead, hero HP ${w.hero.hp} (was ${hp})`);
  // Walk away from the blast, then let the fuse burn (0.8 s).
  sim.command({ t: 'walk', x: 1, y: 0 });
  ticks(sim, 60);
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(!alive(w, near1) && !alive(w, near2), 'the blast killed both');
  assert(w.stats.kills === 4, `credited kills ${w.stats.kills} (2 spin + 2 blast)`);
  assert(replays(sim), 'replay');
});

console.log(`realtime-kit: ${checks} checks passed`);
