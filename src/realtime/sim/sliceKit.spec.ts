/**
 * Step 3 of the slice (stage 2 of the transition; docs/realtime-slice.md, sections 6–8 and 11, «Шаг 3»): the spin (Q),
 * the consumables 1–4, elites and the talismans in the arena. Node only: `npm run test:realtime-kit`.
 *
 * Every check plays the simulation through journalled commands (place, teleport, energy, spin, item, begin, drag,
 * release, walk …) and looks at what the player sees: who dies, the hero's HP and energy, the kill counter, what lies on
 * the arena. Seeds are spread (`Math.imul(k, 2654435761) >>> 0`); fights replay from their journals to the same hash.
 */
import { canSpin } from './abilities';
import { planChain } from './chain';
import { itemRefusal } from './items';
import type { ItemKind } from './kit';
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

// ---- Consumables 1–4 ----

/** A fight with consumables in hand (the arena's loadout, as a run passes it). */
const armed = (arena: string, params: Params, seed: number, count = 3): Simulation =>
  fight(arena, params, seed, { loadout: { items: { frost: count, bomb: count, healing: count, fire: count } } });
const use = (sim: Simulation, kind: ItemKind, x: number, y: number): boolean => sim.command({ t: 'item', kind, x, y }) as boolean;
const itemsOf = (w: World, kind: ItemKind): number => w.kit?.items[kind] ?? 0;
const hpOf = (w: World): number => w.hero.hp;
/** HP of an enemy (a function: an assertion narrowing the field must not stick after ticks). */
const hpOfEnemy = (e: Enemy): number => e.hp;
const blastsOf = (w: World): number => w.blasts.length;

check('cold: every body in the circle of 1.5 at the pointer freezes for 3 s — stands, does not touch; others walk and hit', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = armed('kills', quiet({ enemySpeed: 1.2, contactDamage: 1 }), seedOf(10 + k)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const a = place(sim, 10, 5, 'basic', 0, 1), b = place(sim, 10.6, 6, 'basic', 1, 1), out = place(sim, 6, 5, 'basic', 2, 1);
    const hits: number[] = [];
    assert(use(sim, 'frost', 10.5, 5.5) && itemsOf(w, 'frost') === 2, 'cold used, one spent');
    assert(a.chill === 3 && b.chill === 3 && out.chill === undefined, 'the two in the circle are frozen, the far one not');
    const ax = a.x, bx = b.x;
    for (let i = 0; i < 170; i++) { sim.tick(); for (const ev of w.events) if (ev.type === 'hit') hits.push(ev.enemyId); w.events.length = 0; }
    assert(a.x === ax && b.x === bx, 'frozen enemies stand');
    assert(hits.length > 0 && hits.every(id => id === out.id), `only the unfrozen one hits: ${JSON.stringify(hits)}`);
    ticks(sim, 15);
    assert(a.chill === undefined && b.chill === undefined && !a.brittle, 'thawed after 3 s, the ×2 gone with the cold');
    // Nothing in the circle: refused, nothing spent.
    assert(itemRefusal(w, 'frost', { x: 2, y: 2 }) === 'target' && !use(sim, 'frost', 2, 2) && itemsOf(w, 'frost') === 2, 'cold on nothing refused');
    assert(replays(sim), 'replay');
  }
});

check('cold: the next chain hit on a frozen enemy is ×2 (the highlight shows it) — and only the next one', () => {
  const sim = armed('kills', quiet(), seedOf(14)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const tough = place(sim, 9.2, 5, 'basic', 0, 2);
  assert(!planChain(w, [{ kind: 'enemy', id: tough.id }]).links[0].outcome!.killed, 'plain: power 1 wounds HP 2');
  assert(use(sim, 'frost', 9.2, 5), 'cold');
  const plan = planChain(w, [{ kind: 'enemy', id: tough.id }]).links[0].outcome!;
  assert(plan.killed && plan.damage === 2, `frozen: hit ${plan.damage}, killed ${plan.killed}`);
  sim.command({ t: 'begin', x: tough.x, y: tough.y }); sim.command({ t: 'release' }); settle(sim);
  assert(!alive(w, tough) && w.stats.kills === 1, 'the frozen HP 2 enemy dies from power 1');
  // A frozen HP 5 enemy struck by power 1: hit 2 (wounded to 3, the ×2 is spent); the next hit on it is plain.
  const big = place(sim, w.hero.x + 1.2, w.hero.y, 'basic', 1, 5);
  assert(use(sim, 'frost', big.x, big.y), 'cold again');
  sim.command({ t: 'begin', x: big.x, y: big.y }); sim.command({ t: 'release' }); settle(sim);
  assert(alive(w, big) && big.hp === 3 && !big.brittle && (big.chill ?? 0) > 0, `HP ${big.hp}, still frozen, no longer ×2`);
  assert(planChain(w, [{ kind: 'enemy', id: big.id }]).links[0].outcome!.damage === 1, 'the next hit is plain');
  assert(replays(sim), 'replay');
});

check('cold switches off the mechanic of each new enemy: the shield, the arrow, the fuse of a living sapper, the quills', () => {
  // Shield: frozen, it is taken from the front.
  {
    const sim = armed('shields', quiet(), seedOf(15)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const shield = place(sim, 9.2, 5, 'shield', 1, 1);
    assert(!sim.command({ t: 'begin', x: shield.x, y: shield.y }), 'the shield faces the hero');
    assert(use(sim, 'frost', shield.x, shield.y), 'cold');
    assert(sim.command({ t: 'begin', x: shield.x, y: shield.y }) === true, 'frozen: taken from the front');
    sim.command({ t: 'release' }); settle(sim);
    assert(!alive(w, shield), 'killed through the front');
  }
  // Archer: the announced line waits while it is frozen; the arrow flies after the thaw.
  {
    const sim = armed('kills', quiet(), seedOf(16)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const archer = place(sim, 8, 9.2, 'archer', 0, 0);
    for (let i = 0; i < 120 && archer.vars.aim !== 1; i++) sim.tick();
    assert(archer.vars.aim === 1, 'the line is announced');
    const hp = hpOf(w);
    assert(use(sim, 'frost', archer.x, archer.y), 'cold on the archer');
    ticks(sim, 175);
    assert(hpOf(w) === hp && archer.vars.aim === 1, 'no arrow while frozen');
    ticks(sim, 70);
    assert(hpOf(w) === hp - 1, `the arrow after the thaw: HP ${hpOf(w)}`);
  }
  // Sapper: the fuse of a living sapper lit by touch waits; the fuse of a dead one burns on.
  {
    const sim = armed('kills', quiet(), seedOf(17)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const sapper = place(sim, 8.5, 5, 'sapper', 0, 0);
    sim.tick();
    assert(sapper.vars.lit === 1, 'lit by touch');
    const hp = hpOf(w);
    assert(use(sim, 'frost', sapper.x, sapper.y), 'cold on the lit sapper');
    ticks(sim, 175);
    assert(alive(w, sapper) && hpOf(w) === hp, 'the fuse waits while frozen');
    ticks(sim, 80);
    assert(!alive(w, sapper) && hpOf(w) === hp - 2, `blown after the thaw: HP ${hpOf(w)}`);
    // A dead sapper's fuse: the cold on the spot (an enemy there) does not stop it.
    const sim2 = armed('kills', quiet(), seedOf(18)), w2 = sim2.world;
    sim2.command({ t: 'teleport', x: 4.5, y: 5 });
    const dead = place(sim2, 9, 5, 'sapper', 1, 0), next = place(sim2, 9.6, 5, 'basic', 2, 3);
    assert(use(sim2, 'bomb', dead.x, dead.y) && !alive(w2, dead) && blastsOf(w2) === 1, 'the bomb kills the sapper, its fuse lies');
    assert(use(sim2, 'frost', dead.x, dead.y) && (next.chill ?? 0) > 0, 'cold on the spot');
    ticks(sim2, 48);
    assert(blastsOf(w2) === 0 && hpOfEnemy(next) === 1, `the dead sapper's blast went off in 0.8 s: neighbour HP ${next.hp}`);
  }
  // Porcupine: a frozen one does not hurt the hero when struck.
  {
    const sim = armed('thorns', quiet(), seedOf(19)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const porcupine = place(sim, 9.2, 5, 'porcupine', 0, 1);
    const hp = hpOf(w);
    assert(use(sim, 'frost', porcupine.x, porcupine.y), 'cold');
    sim.command({ t: 'begin', x: porcupine.x, y: porcupine.y }); sim.command({ t: 'release' }); settle(sim);
    assert(!alive(w, porcupine) && hpOf(w) === hp, `no quills: HP ${hpOf(w)}`);
  }
});

check('bomb: 6 to the enemy under the pointer within 5 of the hero; farther — refused, nothing spent; the kill is credited', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = armed('kills', quiet(), seedOf(20 + k)), w = sim.world;
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const six = place(sim, 9.4, 5, 'basic', 0, 6), seven = place(sim, 8, 6, 'basic', 1, 7), far = place(sim, 10.2, 5.6, 'basic', 2, 0);
    assert(use(sim, 'bomb', six.x + 0.1, six.y) && !alive(w, six) && w.stats.kills === 1, 'HP 6 at 4.9 dies, credited');
    assert(use(sim, 'bomb', seven.x, seven.y) && alive(w, seven) && seven.hp === 1, `HP 7 → ${seven.hp}`);
    assert(itemRefusal(w, 'bomb', far) === 'far' && !use(sim, 'bomb', far.x, far.y) && alive(w, far) && itemsOf(w, 'bomb') === 1, 'out of range: refused');
    assert(!use(sim, 'bomb', 2, 2) && itemsOf(w, 'bomb') === 1, 'nothing under the pointer: refused');
    assert(replays(sim), 'replay');
  }
});

check('healing: +8, not above the maximum; at full HP it is not spent', () => {
  const sim = fight('kills', quiet(), seedOf(24), { hero: { hp: 3, maxHp: 12 }, loadout: { items: { healing: 2 } } }), w = sim.world;
  assert(use(sim, 'healing', 0, 0) && hpOf(w) === 11 && itemsOf(w, 'healing') === 1, `3 → ${hpOf(w)}`);
  assert(use(sim, 'healing', 0, 0) && hpOf(w) === 12 && itemsOf(w, 'healing') === 0, 'capped at 12');
  const full = fight('kills', quiet(), seedOf(25), { loadout: { items: { healing: 1 } } }), wf = full.world;
  assert(itemRefusal(wf, 'healing', wf.hero) === 'full' && !use(full, 'healing', 0, 0) && itemsOf(wf, 'healing') === 1, 'full HP: refused');
  assert(replays(sim), 'replay');
});

check('fire: the enemy under the pointer and those within 1 of it burn — 1 every 1.5 s, three times; kills credited', () => {
  for (let k = 1; k <= 3; k++) {
    const sim = armed('kills', quiet(), seedOf(26 + k)), w = sim.world;
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const target = place(sim, 9, 5, 'basic', 0, 3), near = place(sim, 9.9, 5.3, 'basic', 1, 5), weak = place(sim, 8.4, 5.8, 'basic', 2, 0);
    const out = place(sim, 10.8, 5, 'basic', 3, 5);
    assert(use(sim, 'fire', target.x, target.y), 'fire');
    assert(!!target.burn && !!near.burn && !!weak.burn && !out.burn, 'the target and its neighbours burn');
    ticks(sim, 89);
    assert(target.hp === 3 && near.hp === 5 && alive(w, weak), 'nothing before 1.5 s');
    ticks(sim, 1);
    assert(hpOfEnemy(target) === 2 && hpOfEnemy(near) === 4 && !alive(w, weak), 'first tick at 1.5 s');
    ticks(sim, 90);
    assert(hpOfEnemy(target) === 1 && hpOfEnemy(near) === 3, 'second at 3 s');
    ticks(sim, 90);
    assert(!alive(w, target) && hpOfEnemy(near) === 2 && !near.burn, 'third at 4.5 s: the HP 3 target dies, the burning ends');
    ticks(sim, 120);
    assert(hpOfEnemy(near) === 2 && hpOfEnemy(out) === 5, 'three ticks only; the far one untouched');
    assert(w.stats.kills === 2, `credited kills ${w.stats.kills}`);
    assert(replays(sim), 'replay');
  }
});

check('consumables: not during the dash; while a chain is drawn they work and focus goes on', () => {
  const sim = armed('kills', quiet(), seedOf(30)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const a = place(sim, 9.2, 5, 'basic', 1, 0), b = place(sim, 10.4, 5, 'basic', 1, 2), c = place(sim, 6, 5, 'basic', 2, 0);
  sim.command({ t: 'begin', x: a.x, y: a.y });
  sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
  sim.tick();
  assert(w.focusing, 'focus runs');
  assert(use(sim, 'frost', b.x, b.y) && use(sim, 'bomb', c.x, c.y) && !alive(w, c), 'cold and bomb while drawing');
  sim.tick();
  assert(w.focusing && chainOf(w).length === 2, 'the chain and focus go on');
  // The frozen tough link (HP 2) dies from power 2 either way; the highlight shows a hit of 4.
  const last = planChain(w).links[1].outcome!;
  assert(last.killed && last.damage === 4, `the highlight counts the ×2: hit ${last.damage}`);
  sim.command({ t: 'release' });
  sim.tick();
  assert(moveOf(w) === 'dash', 'dashing');
  assert(itemRefusal(w, 'bomb', b) === 'move' && !use(sim, 'healing', 0, 0) && itemsOf(w, 'bomb') === 2, 'refused in the dash');
  settle(sim);
  assert(!alive(w, a) && !alive(w, b), 'both links died');
  assert(replays(sim), 'replay');
});

check('loadout: the arena starts with the consumables and the banked energy it is given; without one — none (as before)', () => {
  const sim = fight('kills', quiet(), seedOf(31), { loadout: { items: { frost: 1, fire: 2 }, energy: 9 } }), w = sim.world;
  assert(itemsOf(w, 'frost') === 1 && itemsOf(w, 'fire') === 2 && itemsOf(w, 'bomb') === 0 && w.energy === 7, `kit ${JSON.stringify(w.kit)}, energy ${w.energy}`);
  const bare = fight('kills', quiet(), seedOf(31)).world;
  assert(!bare.kit && bare.energy === 0, 'no loadout: no kit, energy 0');
  const journal = sim.exportJournal()!;
  assert(JSON.stringify(journal.loadout) === JSON.stringify({ items: { frost: 1, fire: 2 }, energy: 9 }), 'the loadout is journalled');
});

console.log(`realtime-kit: ${checks} checks passed`);
