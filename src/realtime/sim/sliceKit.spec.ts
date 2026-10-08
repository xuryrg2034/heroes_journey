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
const statusOf = (w: World): string => w.status;

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

check('cold ×2 is fixed at the release (review finding A): a link that thaws on the way still takes ×2; its mechanic comes back with the thaw', () => {
  // The reviewer's scenario: three weak links, then an HP 6 enemy frozen 170 ticks before the release (0.17 s of cold left).
  for (const wait of [0, 150, 170, 175, 178]) {
    const sim = fight('kills', quiet(), 77, { loadout: { items: { frost: 3 } } }), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 5 });
    const links = [0, 1, 2].map(i => place(sim, 5.2 + i * 1.4, 5, 'basic', 0, 0));
    const tough = place(sim, 5.2 + 3 * 1.4, 5, 'basic', 0, 6);
    assert(use(sim, 'frost', tough.x, tough.y), 'cold');
    ticks(sim, wait);
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const e of [...links.slice(1), tough]) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    const planned = planChain(w).links[3].outcome!, frozen = (tough.chill ?? 0) > 0;
    sim.command({ t: 'release' }); settle(sim);
    assert(planned.killed === frozen && alive(w, tough) === !frozen, `wait ${wait}: frozen ${frozen}, planned ${planned.killed}, ${alive(w, tough) ? `alive HP ${tough.hp}` : 'dead'}`);
    if (wait === 170) assert(frozen && !alive(w, tough), 'thawed on the way, still ×2');
    assert(replays(sim), 'replay');
  }
  // Only the ×2 is fixed: a porcupine frozen at the release that thaws on the way gets its quills back (the hero −1).
  const sim = fight('thorns', quiet(), seedOf(78), { loadout: { items: { frost: 1 } } }), w = sim.world;
  sim.command({ t: 'teleport', x: 3, y: 2 });
  const weak = [place(sim, 4.2, 2, 'basic', 0, 0), place(sim, 5.6, 2, 'basic', 0, 0)];
  const porcupine = place(sim, 7, 2, 'porcupine', 0, 6);
  assert(use(sim, 'frost', porcupine.x, porcupine.y), 'cold');
  ticks(sim, 175);
  sim.command({ t: 'begin', x: weak[0].x, y: weak[0].y });
  sim.command({ t: 'drag', x: weak[1].x, y: weak[1].y, mode: 'full' });
  sim.command({ t: 'drag', x: porcupine.x, y: porcupine.y, mode: 'full' });
  const hp = hpOf(w);
  sim.command({ t: 'release' }); settle(sim);
  assert(!alive(w, porcupine) && hpOf(w) === hp - 1, `×2 kept (power 3 × 2 kills HP 6), quills back: HP ${hp} → ${hpOf(w)}`);
});

check('cold ×2 follows the turn-based brittleness (design answer 7): the spin 4 → 8 and spends it; a bomb neither doubles nor spends it', () => {
  const sim = armed('kills', quiet(), seedOf(79)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const eight = place(sim, 9, 5, 'basic', 0, 8), plain = place(sim, 7, 5, 'basic', 1, 5);
  assert(use(sim, 'frost', eight.x, eight.y) && !plain.chill, 'cold on one');
  sim.command({ t: 'energy', value: 3 });
  assert(sim.command({ t: 'spin' }) === true && !alive(w, eight) && plain.hp === 1, `frozen HP 8 dies (8), the other 5 → ${plain.hp}`);
  // A bomb on a frozen enemy: 6, and the ×2 is still there for the chain.
  const ten = place(sim, 10, 5, 'basic', 2, 10);
  assert(use(sim, 'frost', ten.x, ten.y) && use(sim, 'bomb', ten.x, ten.y) && ten.hp === 4 && ten.brittle, `bomb 6 on a frozen HP 10: ${ten.hp}, still ×2`);
  assert(replays(sim), 'replay');
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

// ---- Elites ----

/** An elite of the arena template (`random` — a random elite: its loot is always a resource). */
const placeElite = (sim: Simulation, x: number, y: number, kind = 'basic', color = 0, hp = 0, random = false): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind, elite: random ? 'random' : true }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
const lootOf = (w: World) => w.objects.filter(o => o.kind === 'loot');
const hpOfE = (e: Enemy): number => e.hp;

check('elite: HP ×2 (a weak one gets 1), +1 to every hit on the hero (touch here), a larger press circle; an elite shieldbearer keeps its shield', () => {
  const sim = fight('shields', quiet({ contactDamage: 1 }), seedOf(40)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const weak = placeElite(sim, 3, 8.5, 'basic', 0, 0), two = placeElite(sim, 13, 8.5, 'basic', 1, 2);
  assert(weak.elite && weak.hp === 1 && two.hp === 4, `HP ${weak.hp}, ${two.hp}`);
  const shield = placeElite(sim, 9.2, 5, 'shield', 2, 1);
  assert(shield.hp === 2 && !sim.command({ t: 'begin', x: shield.x, y: shield.y }), 'an elite shieldbearer: HP 2, still not taken from the front');
  // The press circle is its drawing × 1.25: a press 0.66 from its centre takes it (0.59 for an ordinary enemy).
  sim.command({ t: 'chill', id: shield.id, seconds: 5 });
  assert(sim.command({ t: 'begin', x: shield.x - 0.66, y: shield.y }) === true, 'the larger circle of an elite');
  sim.command({ t: 'cancel' });
  const plain = place(sim, 8, 6.4, 'basic', 3, 3);
  assert(!sim.command({ t: 'begin', x: plain.x, y: plain.y + 0.66 }), 'an ordinary enemy: not at 0.66');
  // Touch: an elite next to the hero hits for 1 + 1.
  sim.command({ t: 'clear', keepMarked: false });
  const hp = w.hero.hp;
  placeElite(sim, 8.5, 5, 'basic', 0, 3);
  ticks(sim, 2);
  assert(w.hero.hp === hp - 2, `elite touch: ${hp} → ${w.hero.hp}`);
  assert(replays(sim), 'replay');
});

check('elite +1 to every hit on the hero (design answer 5): the arrow, the boar charge, the sapper blast, the quills', () => {
  // An archer's arrow: 1 → 2.
  for (const [elite, loss] of [[false, 1], [true, 2]] as const) {
    const sim = fight('kills', quiet(), seedOf(70)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    elite ? placeElite(sim, 8, 9.2, 'archer', 0, 0) : place(sim, 8, 9.2, 'archer', 0, 0);
    const hp = hpOf(w);
    for (let i = 0; i < 200 && hpOf(w) === hp; i++) sim.tick();
    assert(hp - hpOf(w) === loss, `arrow of ${elite ? 'an elite' : 'an archer'}: −${hp - hpOf(w)}`);
  }
  // A sapper lit by touch: its blast 2 → 3.
  for (const [elite, loss] of [[false, 2], [true, 3]] as const) {
    const sim = fight('kills', quiet(), seedOf(71)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    elite ? placeElite(sim, 8.5, 5, 'sapper', 0, 0) : place(sim, 8.5, 5, 'sapper', 0, 0);
    const hp = hpOf(w);
    ticks(sim, 120);
    assert(hp - hpOf(w) === loss, `blast of ${elite ? 'an elite' : 'a'} sapper: −${hp - hpOf(w)}`);
  }
  // A porcupine struck by a chain: quills 1 → 2.
  for (const [elite, loss] of [[false, 1], [true, 2]] as const) {
    const sim = fight('thorns', quiet(), seedOf(72)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    const p = elite ? placeElite(sim, 9.2, 5, 'porcupine', 0, 1) : place(sim, 9.2, 5, 'porcupine', 0, 1);
    const hp = hpOf(w);
    sim.command({ t: 'begin', x: p.x, y: p.y }); sim.command({ t: 'release' }); settle(sim);
    assert(hp - hpOf(w) === loss, `quills of ${elite ? 'an elite' : 'a'} porcupine: −${hp - hpOf(w)}`);
  }
  // A boar's charge: boarDamage 2 → 3 (the boar starts its charge within 5 of the hero).
  for (const [elite, loss] of [[false, 2], [true, 3]] as const) {
    const sim = fight('kills', quiet({ enemySpeed: 1.2 }), seedOf(73)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    elite ? placeElite(sim, 11.5, 5, 'boar', 0, 2) : place(sim, 11.5, 5, 'boar', 0, 2);
    const hp = hpOf(w);
    for (let i = 0; i < 600 && hpOf(w) === hp; i++) sim.tick();
    assert(hp - hpOf(w) === loss, `charge of ${elite ? 'an elite' : 'a'} boar: −${hp - hpOf(w)}`);
  }
});

check('elite loot as in the turn-based game (design answer 6): a template elite — 50% a consumable open in the run, else nothing; a random one — always a resource; by an enemy — nothing', () => {
  const tally = { item: 0, none: 0 }, kinds = new Set<string>();
  for (let k = 1; k <= 80; k++) {
    const sim = fight('kills', quiet(), seedOf(100 + k), { loadout: { items: { bomb: 1 }, openItems: ['fire', 'bomb'] } }), w = sim.world;
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const elite = placeElite(sim, 8, 5, 'basic', 0, 2);
    assert(sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y }) === true && !alive(w, elite), 'the bomb kills the elite');
    const loot = lootOf(w);
    assert(loot.length <= 1, 'at most one loot');
    if (!loot.length) { tally.none++; continue; }
    assert(['fire', 'bomb'].includes(loot[0].loot!) && Math.hypot(loot[0].x - 8, loot[0].y - 5) <= w.params.eliteLootRadius + 1e-9, `a consumable open in the run near the kill: ${loot[0].loot}`);
    kinds.add(loot[0].loot!); tally.item++;
    if (k <= 3) assert(replays(sim), 'replay');
  }
  assert(tally.item >= 28 && tally.item <= 52 && kinds.size === 2, `consumables ${tally.item} of 80 (nothing ${tally.none}), kinds ${[...kinds]}`);
  // A template elite with nothing open in the run: a resource when it drops.
  let resources = 0;
  for (let k = 1; k <= 20; k++) {
    const sim = fight('kills', quiet(), seedOf(200 + k), { loadout: { items: { bomb: 1 } } }), w = sim.world;
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const elite = placeElite(sim, 8, 5, 'basic', 0, 2);
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    const loot = lootOf(w)[0];
    if (loot) { assert(['dew', 'powder', 'resin', 'herbs'].includes(loot.loot!), 'nothing open: a resource'); resources++; }
  }
  assert(resources > 4 && resources < 16, `nothing open: ${resources} of 20 drop a resource`);
  // A random elite: always a resource, even with consumables open.
  for (let k = 1; k <= 20; k++) {
    const sim = fight('kills', quiet(), seedOf(250 + k), { loadout: { items: { bomb: 1 }, openItems: ['fire', 'bomb'] } }), w = sim.world;
    sim.command({ t: 'teleport', x: 4.5, y: 5 });
    const elite = placeElite(sim, 8, 5, 'basic', 0, 2, true);
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    assert(['dew', 'powder', 'resin', 'herbs'].includes(lootOf(w)[0]?.loot ?? ''), 'a random elite: always a resource');
  }
  // Killed by an archer's arrow: not the player's — no loot.
  const sim = fight('kills', quiet(), seedOf(300)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  place(sim, 8, 9.2, 'archer', 0, 0);
  const victim = placeElite(sim, 8, 7.5, 'basic', 1, 0, true);
  for (let i = 0; i < 200 && alive(w, victim); i++) sim.tick();
  assert(!alive(w, victim) && lootOf(w).length === 0 && w.stats.kills === 0, 'an elite killed by an arrow drops nothing');
});

check('elite loot is picked up by a chain (a link of any colour, no power, no colour change) or by the walking hero', () => {
  const sim = fight('kills', quiet(), seedOf(41), { loadout: { items: { bomb: 2 }, openItems: ['bomb'] } }), w = sim.world;
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  // Random elites: their loot always drops (a resource).
  const a = placeElite(sim, 8, 5, 'basic', 0, 2, true);
  sim.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
  const loot = lootOf(w)[0];
  assert(loot, 'loot fell');
  // A chain hero → enemy → the loot → enemy of the same colour with HP 3: the loot keeps the colour and gives no power (power 2 wounds the HP 3).
  sim.command({ t: 'teleport', x: loot.x - 1.2, y: loot.y });
  const first = place(sim, loot.x - 0.6, loot.y + 0.9, 'basic', 1, 0), last = place(sim, loot.x + 1.0, loot.y + 0.3, 'basic', 1, 3);
  const other = place(sim, loot.x + 0.9, loot.y - 0.6, 'basic', 2, 0);
  sim.command({ t: 'begin', x: first.x, y: first.y });
  sim.command({ t: 'drag', x: loot.x, y: loot.y, mode: 'full' });
  assert(chainOf(w).length === 2, 'the loot is a link');
  sim.command({ t: 'drag', x: other.x, y: other.y, mode: 'full' });
  assert(chainOf(w).length === 2, 'another colour after the loot: refused (the colour stays)');
  sim.command({ t: 'drag', x: last.x, y: last.y, mode: 'full' });
  assert(chainOf(w).length === 3 && planChain(w).links[2].outcome!.available === 2 && !planChain(w).links[2].outcome!.killed, 'power 2 after the loot (no power from it)');
  const before = w.kit!.items.bomb + w.kit!.materials.dew + w.kit!.materials.powder + w.kit!.materials.resin + w.kit!.materials.herbs;
  sim.command({ t: 'release' }); settle(sim);
  assert(lootOf(w).length === 0 && hpOfE(last) === 1, 'the dash picked it up; the last link wounded to 1');
  const after = w.kit!.items.bomb + w.kit!.materials.dew + w.kit!.materials.powder + w.kit!.materials.resin + w.kit!.materials.herbs;
  assert(after === before + 1, 'one thing more in the kit');
  // By touch: a second elite's loot, the hero walks onto it.
  const b = placeElite(sim, 4, 3, 'basic', 3, 0, true);
  sim.command({ t: 'teleport', x: 6.5, y: 3 });
  sim.command({ t: 'item', kind: 'bomb', x: b.x, y: b.y });
  const second = lootOf(w)[0];
  assert(second, 'second loot');
  sim.command({ t: 'teleport', x: second.x + 1.2, y: second.y });
  sim.command({ t: 'walk', x: -1, y: 0 });
  for (let i = 0; i < 40 && lootOf(w).length; i++) sim.tick();
  assert(lootOf(w).length === 0, 'picked up by walking into it');
  assert(replays(sim), 'replay');
});

check('elite loot falls off the rest of the dash (as a crystal)', () => {
  for (let k = 1; k <= 6; k++) {
    const sim = fight('kills', quiet(), seedOf(50 + k), { loadout: { openItems: ['frost'] } }), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 5 });
    const elite = placeElite(sim, 5.2, 5, 'basic', 0, 0, true);
    const rest = [place(sim, 6.4, 5, 'basic', 0, 0), place(sim, 7.6, 5, 'basic', 0, 0), place(sim, 8.8, 5, 'basic', 0, 0)];
    sim.command({ t: 'begin', x: elite.x, y: elite.y });
    for (const e of rest) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    sim.command({ t: 'release' });
    for (let i = 0; i < 60 && !lootOf(w).length; i++) sim.tick();
    const loot = lootOf(w)[0];
    assert(loot, 'loot fell in the dash');
    // The rest of the dash when the elite died: from its spot (the hero takes it) along y = 5 to the last link at x = 8.8.
    const tx = Math.max(elite.x, Math.min(8.8, loot.x)), off = Math.hypot(loot.x - tx, loot.y - 5);
    assert(off >= 0.6 - 1e-9, `loot at ${loot.x.toFixed(2)}, ${loot.y.toFixed(2)} is ${off.toFixed(2)} from the rest of the dash`);
    settle(sim);
  }
});

check('random elites: 3% of newcomers before the goals, 12% after (many seeds); at most 2 / 4 living; off without the run or the toggle', () => {
  /** A fast horde that never reaches the hero: newcomers pour in, the test clears them every second. */
  const horde = (extra: Partial<Params> = {}): Params => Object.assign(defaultParams(), {
    baseFloor: 40, baseIntervalMin: 0.3, baseIntervalMax: 0.3, maxEnemies: 60, markerDelay: 0.1, spawnMinDistance: 0, enemySpeed: 0, speedSpread: 0, contactDamage: 0,
    baseWolfShare: 0, baseBoarShare: 0, groupMin: 4, groupMax: 4, hitstop: false,
  }, extra);
  const count = (loadout: object, params: Params, greed: boolean, seeds: number, cleared = true) => {
    let newcomers = 0, elites = 0, most = 0;
    for (let k = 1; k <= seeds; k++) {
      const sim = new Simulation({ arena: 'glade', params, seed: seedOf(400 + k + (greed ? 50 : 0)), record: true, loadout }), w = sim.world;
      if (greed) sim.command({ t: 'goals' });
      for (let i = 0; i < 60 * 30; i++) {
        sim.tick();
        for (const ev of w.events) { if (ev.type === 'spawn') newcomers++; if (ev.type === 'elite') elites++; }
        w.events.length = 0;
        most = Math.max(most, w.enemies.filter(e => e.elite).length);
        if (cleared && i % 60 === 59) sim.command({ t: 'clear', keepMarked: false });
      }
      if (k === 1) assert(replays(sim), 'replay');
    }
    return { newcomers, elites, most, share: elites / Math.max(1, newcomers) };
  };
  // Shares with the caps out of the way (caps are sliders).
  const before = count({ randomElites: true }, horde({ eliteCap: 99 }), false, 6), after = count({ randomElites: true }, horde({ eliteCapAfter: 99 }), true, 4);
  console.log(`   before the goals ${before.elites}/${before.newcomers} (${(before.share * 100).toFixed(1)}%), after ${after.elites}/${after.newcomers} (${(after.share * 100).toFixed(1)}%)`);
  assert(before.newcomers > 1500 && before.share > 0.018 && before.share < 0.045, `before the goals: ${before.share}`);
  assert(after.newcomers > 1000 && after.share > 0.09 && after.share < 0.15, `after the goals: ${after.share}`);
  // Caps: never more than 2 / 4 living elites (enemies are not cleared: they pile up to the arena limit).
  const capBefore = count({ randomElites: true }, horde({ eliteChance: 0.5 }), false, 2, false), capAfter = count({ randomElites: true }, horde({ eliteChanceAfter: 0.5 }), true, 2, false);
  assert(capBefore.most === 2 && capAfter.most === 4, `living elites at most ${capBefore.most} / ${capAfter.most}`);
  // Off: no loadout flag and no toggle — no elites; the sandbox toggle turns them on.
  assert(count({}, horde({ eliteChance: 0.5 }), false, 1).elites === 0, 'off without the run flag');
  assert(count({}, horde({ eliteChance: 0.5, eliteSandbox: true }), false, 1).elites > 0, 'the sandbox toggle');
});

// ---- Talismans in the arena ----

const withTalismans = (arena: string, talismans: string[], seed: number, extra: Partial<Params> = {}, ward = false): Simulation =>
  fight(arena, quiet(extra), seed, { loadout: { talismans, ward } });

check('«Якорь у героя»: the next link is also taken within R of the hero; without it — «далеко»', () => {
  for (const [talismans, taken] of [[['hero-anchor'], true], [[], false]] as const) {
    const sim = withTalismans('kills', [...talismans], seedOf(60)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    // The first link 1.6 to the right; the second 1.6 to the left of the hero: 3.2 from the first, within R of the hero.
    const first = place(sim, 9.6, 5, 'basic', 0, 0), second = place(sim, 6.4, 5, 'basic', 0, 0);
    sim.command({ t: 'begin', x: first.x, y: first.y });
    sim.command({ t: 'drag', x: second.x, y: second.y, mode: 'full' });
    assert((chainOf(w).length === 2) === taken, `${talismans.join() || 'none'}: chain ${chainOf(w).length}`);
  }
});

check('«Точильный камень»: the first chain of the arena starts with power 1 (the highlight shows it); the next ones with 0', () => {
  const sim = withTalismans('kills', ['whetstone'], seedOf(61)), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  // A chain of a button only does not spend it; the first chain with an enemy does.
  const tough = place(sim, 9.2, 5, 'basic', 0, 2);
  const plan = planChain(w, [{ kind: 'enemy', id: tough.id }]).links[0].outcome!;
  assert(plan.available === 2 && plan.killed, 'the highlight: power 1 + 1 kills HP 2');
  sim.command({ t: 'begin', x: tough.x, y: tough.y }); sim.command({ t: 'release' }); settle(sim);
  assert(!alive(w, tough), 'the first chain killed the HP 2 enemy');
  const next = place(sim, w.hero.x + 1.2, w.hero.y, 'basic', 1, 2);
  assert(!planChain(w, [{ kind: 'enemy', id: next.id }]).links[0].outcome!.killed, 'the second chain starts with 0');
  sim.command({ t: 'begin', x: next.x, y: next.y }); sim.command({ t: 'release' }); settle(sim);
  assert(alive(w, next) && next.hp === 1, 'wounded only');
  // Without the talisman the first chain starts with 0.
  const plain = withTalismans('kills', [], seedOf(61)), wp = plain.world;
  plain.command({ t: 'teleport', x: 8, y: 5 });
  const other = place(plain, 9.2, 5, 'basic', 0, 2);
  assert(!planChain(wp, [{ kind: 'enemy', id: other.id }]).links[0].outcome!.killed, 'no talisman: power 0');
  assert(replays(sim), 'replay');
});

check('event modifier «первая цепь с силой 1» adds to «Точильный камень» (power 2); «бой со случайной элитой» makes the first newcomer a random elite', () => {
  const sim = fight('kills', quiet(), seedOf(66), { loadout: { talismans: ['whetstone'], firstPower: 1 } }), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  const three = place(sim, 9.2, 5, 'basic', 0, 3);
  assert(planChain(w, [{ kind: 'enemy', id: three.id }]).links[0].outcome!.available === 3, 'power 1 + 1 + 1 hits 3');
  const elite = new Simulation({ arena: 'glade', params: defaultParams(), seed: seedOf(67), record: true, loadout: { startElite: true } }), we = elite.world;
  let first: Enemy | undefined;
  for (let i = 0; i < 60 * 6 && !first; i++) { elite.tick(); first = we.enemies[0]; }
  assert(first && first.elite === 'random' && we.enemies.filter(e => e.elite).length === 1 && !we.kit!.startElite, 'the first newcomer is a random elite');
  for (let i = 0; i < 60 * 10; i++) elite.tick();
  assert(we.enemies.filter(e => e.elite).length === 1, 'only one');
  assert(replays(elite), 'replay');
});

check('event prices in the arena: «злость» — +3 enemies of the arena\'s composition in the first wave, never elites; «подкрепление раньше» — groups before the goals ×1.5, after them the same', () => {
  // «злость» on arena 4 (a quarter of its newcomers are shieldbearers) with random elites at 100%: the extras are no elites.
  let shields = 0;
  for (let k = 1; k <= 30; k++) {
    const params = Object.assign(defaultParams(), { eliteSandbox: true, eliteChance: 1, eliteCap: 999, contactDamage: 0 });
    const sim = new Simulation({ arena: 'shields', params, seed: seedOf(500 + k), record: true, loadout: { extraStart: true } }), w = sim.world;
    sim.tick();
    const plain = [...w.queue, ...w.markers].filter(entry => entry.plain);
    assert(plain.length === 3 && !w.kit!.extraStart, `three extras with the first wave: ${plain.length}`);
    shields += plain.filter(entry => entry.kind === 'shield').length;
    // Every other newcomer of that moment becomes an elite (100%); the three extras do not.
    for (let i = 0; i < 70; i++) sim.tick();
    assert(w.enemies.filter(e => !e.elite).length === 3 && w.enemies.filter(e => e.elite).length > 3, `extras are no elites: ${w.enemies.filter(e => !e.elite).length} plain of ${w.enemies.length}`);
    if (k === 1) assert(replays(sim), 'replay');
  }
  assert(shields > 5 && shields < 45, `the arena's composition: ${shields} shieldbearers of 90 extras`);
  // «подкрепление раньше»: count the groups (newcomers with groups of one, no floor) over 60 s before and after the goals.
  const groups = (earlyPace: boolean, greed: boolean): number => {
    let n = 0;
    for (let k = 1; k <= 6; k++) {
      const params = Object.assign(defaultParams(), { baseFloor: 0, groupMin: 1, groupMax: 1, baseWolfShare: 0, maxEnemies: 150, contactDamage: 0, enemySpeed: 0, spawnMinDistance: 0 });
      for (const phase of params.phases) { phase.floor = 0; phase.wolfShare = 0; }
      const sim = new Simulation({ arena: 'glade', params, seed: seedOf(600 + k), loadout: earlyPace ? { earlyPace: true } : {} }), w = sim.world;
      if (greed) sim.command({ t: 'goals' });
      for (let i = 0; i < 60 * 60; i++) { sim.tick(); for (const ev of w.events) if (ev.type === 'spawn') n++; w.events.length = 0; if (i % 600 === 599) sim.command({ t: 'clear', keepMarked: false }); }
    }
    return n;
  };
  const before = groups(false, false), early = groups(true, false), afterPlain = groups(false, true), afterEarly = groups(true, true);
  console.log(`   groups before the goals ${before} → ${early} (×${(early / before).toFixed(2)}); after the goals ${afterPlain} → ${afterEarly}`);
  assert(early / before > 1.35 && early / before < 1.65, `before the goals ×${early / before}`);
  assert(afterEarly / afterPlain > 0.9 && afterEarly / afterPlain < 1.1, `after the goals ×${afterEarly / afterPlain}`);
});

check('«Осколок жернова»: a crystal falls at the 5th kill of a chain instead of the 6th', () => {
  for (const [talismans, crystals] of [[['millstone-shard'], 1], [[], 0]] as const) {
    const sim = withTalismans('kills', [...talismans], seedOf(62)), w = sim.world;
    sim.command({ t: 'teleport', x: 2.5, y: 9 });
    const links = [0, 1, 2, 3, 4].map(i => place(sim, 3.6 + i * 1.1, 9, 'basic', 0, 0));
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    sim.command({ t: 'release' }); settle(sim);
    assert(w.stats.kills === 5 && w.stats.crystals === crystals, `${talismans.join() || 'none'}: kills ${w.stats.kills}, crystals ${w.stats.crystals}`);
  }
});

check('«Песочные часы»: the phase table after the goals starts 10 s later (the base pace goes on meanwhile)', () => {
  for (const [talismans, delay] of [[['hourglass'], 10], [[], 0]] as const) {
    const sim = withTalismans('kills', [...talismans], seedOf(63)), w = sim.world;
    sim.command({ t: 'goals' });
    ticks(sim, 1);
    assert(w.pressure.phaseIndex === (delay ? -1 : 0), `${talismans.join() || 'none'}: right after the goals phase ${w.pressure.phaseIndex}`);
    ticks(sim, 60 * 10 - 2);
    assert(w.pressure.phaseIndex === (delay ? -1 : 0), 'just before 10 s');
    ticks(sim, 2);
    assert(w.pressure.phaseIndex === 0, `after 10 s: phase ${w.pressure.phaseIndex}`);
  }
});

check('«Ловкие лапы»: the jump costs 1 energy instead of 2', () => {
  for (const [talismans, jumps] of [[['nimble-paws'], true], [[], false]] as const) {
    const sim = withTalismans('kills', [...talismans], seedOf(64)), w = sim.world;
    sim.command({ t: 'teleport', x: 8, y: 5 });
    sim.command({ t: 'energy', value: 1 });
    assert((sim.command({ t: 'jump', x: 8, y: 7 }) === true) === jumps && (energyOf(w) === (jumps ? 0 : 1)), `${talismans.join() || 'none'}: jump ${jumps}`);
  }
});

check('«Пепельный оберег»: a hit that would kill leaves the hero with 1 HP once; the next lethal hit kills', () => {
  const sim = fight('kills', quiet({ contactDamage: 3 }), seedOf(65), { hero: { hp: 2, maxHp: 12 }, loadout: { talismans: ['ash-ward'], ward: true } }), w = sim.world;
  sim.command({ t: 'teleport', x: 8, y: 5 });
  place(sim, 8.5, 5, 'basic', 0, 9);
  ticks(sim, 2);
  assert(w.hero.hp === 1 && w.status === 'playing' && w.kit!.wardUsed && !w.kit!.ward, `saved at 1 HP: ${w.hero.hp}`);
  ticks(sim, 60);
  assert(statusOf(w) === 'defeat', 'the next lethal hit kills');
  // A ward the run already spent (ward false) does not save.
  const spent = fight('kills', quiet({ contactDamage: 3 }), seedOf(65), { hero: { hp: 2, maxHp: 12 }, loadout: { talismans: ['ash-ward'], ward: false } });
  spent.command({ t: 'teleport', x: 8, y: 5 });
  place(spent, 8.5, 5, 'basic', 0, 9);
  ticks(spent, 2);
  assert(spent.world.status === 'defeat', 'a crumbled ward does nothing');
  assert(replays(sim), 'replay');
});

console.log(`realtime-kit: ${checks} checks passed`);
