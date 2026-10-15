/**
 * Task 28 «Тюремщик в походе» (design 15.10.2026, docs/design-notes/tasks-26-28.md; the rules — docs/realtime-elite-behaviors.md,
 * «Смерть босса кончает бой»): `Params.bossClears` and `Params.bossPartLoot`. Node only: `npm run test:realtime-boss-clears`.
 *
 * Every check plays journalled commands (clear, teleport, place, chill, begin / drag, release, param) on the arena «Тюремщик» and
 * looks at what the player meets:
 * - a chain that kills the core in its middle: the highlight before the release shows the links up to the core as the dash strikes
 *   them and the links after it without an outcome (`bossClear`); in the tick the core dies no enemy and no marker is left (the
 *   crowd's `kill` events — source `boss-clear`, not credited), the door is open; the kills, the score, the bag and the cauldron
 *   count the chain's links up to the core only; then nothing spawns and nothing hurts the hero (an enemy placed on him);
 * - the old path: the same journal without the key — the crowd lives on, the links after the core are struck;
 * - the arena turns the rule on for a copy of the values (kept in the journal); a journal recorded before the key does not;
 * - the core without its shield (`Loadout.withoutKinds` with `shield`, the run's viewer who has not met the shieldbearer);
 * - the weight severed by the player drops the loot of an armoured elite (`bossPartLoot`), not without the key;
 * - the fight replays from its journal to its hash (checkpoints every 300 ticks) on several seeds; the seeds differ.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. No claim on winning or losing a fight.
 */
import { chainScore, enemyRefusal, planChain } from './chain';
import { BOSS_CLEAR, JAILER, JAILER_WEIGHT } from './enemies/jailer';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Loadout } from './kit';
import { doorOpen, type Enemy, type World, type WorldEvent } from './world';
import type { Vec } from './geometry';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/**
 * The fight's values: newcomers come (the floor and the groups of the panel), nobody walks (the crowd stays where it stands), no
 * hit-stop; the bag and the cauldron on (their counts are checked). `extra` on top.
 */
function values(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.enemySpeed = 0; p.speedSpread = 0; p.heroHp = 999; p.hitstop = false; p.survivorKnockback = false; p.doorBag = true; p.purse = true;
  return Object.assign(p, extra);
}
function fight(k: number, params: Params = values(), loadout?: Loadout): Simulation {
  return new Simulation({ arena: 'jailer', params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
}
const core = (w: World): Enemy => w.enemies.find(e => e.kind === JAILER)!;
const weight = (w: World): Enemy | undefined => w.enemies.find(e => e.kind === JAILER_WEIGHT);
const place = (sim: Simulation, at: Vec, hp: number, color: number): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks (at most `n`) while the fight plays; `each` sees the world after every tick before its events go. */
function ticks(sim: Simulation, n: number, each?: (w: World, events: WorldEvent[]) => void): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    each?.(sim.world, events);
  }
  return out;
}
/** Ticks until the dash is over (at least one tick). */
function settle(sim: Simulation, each?: (w: World, events: WorldEvent[]) => void): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < 900 && sim.world.status === 'playing' && (i === 0 || sim.world.move); i++) out.push(...ticks(sim, 1, each));
  return out;
}

/**
 * The core frozen (its moves and shield stop), its three plates taken by three one-link chains; then `wait` seconds for the
 * newcomers; the hero at (9, 6.5) and a chain [b1, core, b2, b3] drawn (colour 1; the weight stays in the crowd).
 */
function readyToKill(sim: Simulation, wait = 6): { b: Enemy[] } {
  const w = sim.world, c = core(w);
  sim.command({ t: 'chill', id: c.id, seconds: 120 });
  sim.command({ t: 'teleport', x: 9, y: 6.5 });
  for (let i = 0; i < 3; i++) {
    draw(sim, [c]);
    assert(w.chain.length === 1, `plate chain ${i}: the core is a link`);
    sim.command({ t: 'release' });
    for (let t = 0; t < 900 && (w.move || t === 0); t++) { sim.tick(); w.events.length = 0; }
  }
  assert((c.armor?.plates ?? -1) === 0 && w.enemies.includes(c), 'three chains took the three plates');
  ticks(sim, ticksOf(wait));
  sim.command({ t: 'teleport', x: 9, y: 6.5 });
  const b = [place(sim, { x: 9, y: 5.5 }, 0, 1), place(sim, { x: 7.5, y: 5.2 }, 0, 1), place(sim, { x: 6.5, y: 4.4 }, 0, 1)];
  draw(sim, [b[0], c, b[1], b[2]]);
  assert(w.chain.length === 4, `the chain takes [b1, core, b2, b3]: ${w.chain.length}`);
  return { b };
}

check('a chain killing the core in its middle: the highlight = the dash (links up to the core struck as planned, after it no outcome, `bossClear`); in the tick the core dies no enemy and no marker is left (`kill` of `boss-clear`, not credited), the door is open; kills, score, bag and cauldron count the chain up to the core only', () => {
  for (const k of [1, 2, 3]) {
    const sim = fight(k), w = sim.world;
    assert(w.params.bossClears === true && w.params.bossFrame === true, 'the arena plays the rule');
    const { b } = readyToKill(sim);
    const c = core(w), crowd = w.enemies.filter(e => e !== c && !b.includes(e)).length;
    assert(crowd >= 2 && weight(w), `seed ${k}: a crowd stands besides the chain (the weight among them): ${crowd}`);
    const plan = planChain(w);
    assert(plan.bossClear === true && plan.kills === 2, `seed ${k}: the highlight ends the fight on the core (${plan.kills} kills)`);
    assert(plan.links[0].outcome?.killed && plan.links[1].outcome?.killed && plan.links[2].outcome === null && plan.links[3].outcome === null, `seed ${k}: no outcome after the core: ${JSON.stringify(plan.links.map(l => l.outcome))}`);
    const before = { kills: w.stats.kills, score: w.stats.score, cauldron: w.purse?.cauldron ?? 0, spawned: w.stats.spawned };
    sim.command({ t: 'release' });
    let deathTick = -1, leftAtDeath = -1, markersAtDeath = -1;
    const events = settle(sim, world => {
      if (deathTick < 0 && !world.enemies.includes(c)) { deathTick = world.tick; leftAtDeath = world.enemies.length; markersAtDeath = world.markers.length + world.queue.length; }
    });
    assert(deathTick > 0 && leftAtDeath === 0 && markersAtDeath === 0, `seed ${k}: in the tick the core died: ${leftAtDeath} enemies, ${markersAtDeath} markers`);
    const hits = of(events, 'chainHit');
    assert(hits.length === 2 && hits[0].enemyId === b[0].id && hits[1].enemyId === c.id, `seed ${k}: the dash struck b1 and the core only: ${JSON.stringify(hits.map(h => h.enemyId))}`);
    plan.links.slice(0, 2).forEach((l, i) => assert(l.outcome!.damage === hits[i].damage && l.outcome!.killed === hits[i].killed, `seed ${k}: link ${i} as planned`));
    const cleared = of(events, 'kill').filter(e => e.source === BOSS_CLEAR);
    assert(cleared.length === crowd + 2 && cleared.every(e => e.credited === false), `seed ${k}: the crowd and b2, b3 die with the boss, not credited (${cleared.length})`);
    assert(of(events, 'kill').filter(e => e.source === 'chain').length === 2, 'two chain kills (b1, the core)');
    assert(w.stats.kills === before.kills + 2 && w.lastChain?.kills === 2 && w.stats.score === before.score + chainScore(w.params, 2), `seed ${k}: kills +2, score of a chain of 2 (${w.stats.kills - before.kills}, ${w.stats.score - before.score})`);
    const cheque = of(events, 'cheque');
    assert(cheque.length === 1 && (w.purse?.cauldron ?? 0) === before.cauldron + cheque[0].total, `seed ${k}: the cauldron got the chain's cheque only`);
    assert(doorOpen(w) && w.stage === 'greed' && w.bag && w.bag.kills === 0 && w.bag.step === 0, `seed ${k}: the door open; the bag counted nothing (${JSON.stringify(w.bag)})`);
    // Then: nothing spawns, nothing hurts the hero (an enemy placed on him; contact damage of the panel).
    const hp = w.hero.hp;
    ticks(sim, ticksOf(20), world => assert(world.enemies.length === 0 && world.markers.length === 0, `seed ${k}: something spawned at ${world.time}`));
    assert(w.stats.spawned === before.spawned, `seed ${k}: no spawn after the boss (${w.stats.spawned - before.spawned})`);
    place(sim, { x: w.hero.x + 0.3, y: w.hero.y }, 3, 0);
    const after = ticks(sim, ticksOf(3));
    assert(w.hero.hp === hp && !of(after, 'hit').length && w.status === 'playing', `seed ${k}: the hero is not hurt after the boss (${hp} → ${w.hero.hp})`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `seed ${k}: replay`);
  }
});

check('the old path: the same journal without `bossClears` — the crowd lives on, the links after the core are struck and counted', () => {
  const p = values();
  delete (p as Partial<Params>).bossClears;
  const sim = fight(1, p), w = sim.world;
  assert(w.params.bossClears === undefined, 'a journal before the key: no key');
  readyToKill(sim);
  const plan = planChain(w);
  assert(!plan.bossClear && plan.kills === 4, `the old highlight: four kills (${plan.kills})`);
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(of(events, 'chainHit').length === 4 && !of(events, 'kill').some(e => e.source === BOSS_CLEAR), 'the dash strikes all four, nobody dies with the boss');
  assert(w.enemies.length > 0 && !w.bossCleared, `the crowd lives on (${w.enemies.length})`);
  // The probe of the first check hurts here: an enemy placed on the hero.
  const hp = w.hero.hp;
  place(sim, { x: w.hero.x + 0.3, y: w.hero.y }, 3, 0);
  ticks(sim, ticksOf(3));
  assert(w.hero.hp < hp, `the old path: the placed enemy hurts the hero (${hp} → ${w.hero.hp})`);
  assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replay');
});

check('the arena turns the rule on for a copy of the values (kept in the journal); a journal without the key replays as recorded; the rule off elsewhere', () => {
  const given = defaultParams();
  const sim = new Simulation({ arena: 'jailer', params: given, seed: seedOf(1), record: true });
  assert(given.bossClears === false && sim.world.params.bossClears === true && sim.exportJournal()!.params.bossClears === true, 'a copy with the rule on, in the journal');
  const yard = new Simulation({ arena: 'jailer-yard', params: given, seed: seedOf(1) });
  assert(yard.world.params.bossClears === true && !yard.world.arena.terrain, '«Тюремщик» without the ravine: the rule on, no cliff');
  const outpost = new Simulation({ arena: 'outpost', params: given, seed: seedOf(1) });
  assert(outpost.world.params === given && !outpost.world.params.bossClears, '«Застава» plays the values given');
  // A journal of the sandbox arena before task 28: no key at all — the rule stays off in its replay.
  const journal = sim.exportJournal()! as Journal, old = JSON.parse(JSON.stringify(journal)) as Journal;
  delete (old.params as Partial<Params>).bossClears;
  assert(replay(old).world.params.bossClears === undefined, 'the old journal\'s replay plays without the rule');
});

check('the core without its shield: `withoutKinds` with `shield` (the run\'s viewer has not met the shieldbearer) — a first link from the front is taken; with the shield it is refused', () => {
  for (const without of [false, true]) {
    const sim = fight(1, values(), without ? { withoutKinds: ['shield'] } : undefined), w = sim.world, c = core(w);
    sim.command({ t: 'teleport', x: c.x + Math.cos(c.vars.facing) * 1.6, y: c.y + Math.sin(c.vars.facing) * 1.6 });
    ticks(sim, 1);
    assert(enemyRefusal(w, c) === (without ? null : 'guarded'), `withoutKinds ${without}: ${enemyRefusal(w, c)}`);
    assert((c.vars.bare === 1) === without, 'the var only on the bare core');
  }
});

check('the weight severed by the player drops the loot of an armoured elite with `bossPartLoot` (the run); without it — none', () => {
  for (const loot of [false, true]) {
    const sim = fight(2, values({ bossPartLoot: loot, baseFloor: 0, baseIntervalMin: 1e6, baseIntervalMax: 1e6 })), w = sim.world, c = core(w), wt = weight(w)!;
    sim.command({ t: 'chill', id: c.id, seconds: 60 });
    const events: WorldEvent[] = [];
    for (let i = 0; i < 4 && w.enemies.includes(wt); i++) {
      sim.command({ t: 'teleport', x: wt.x - 1.4, y: wt.y });
      const a = place(sim, { x: wt.x - 0.7, y: wt.y + 0.05 }, 0, 0);
      draw(sim, [a, wt]);
      sim.command({ t: 'release' });
      events.push(...settle(sim));
    }
    assert(!w.enemies.includes(wt) && of(events, 'partSevered').length === 1, `bossPartLoot ${loot}: the weight severed`);
    const dropped = of(events, 'loot').filter(e => !e.picked);
    assert(loot ? dropped.length >= 1 : dropped.length === 0, `bossPartLoot ${loot}: loot ${dropped.length}`);
    assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), 'replay');
  }
});

check('the fight with the boss killed replays from its journal to the same hash at every 300 ticks on several seeds; a journal without the key plays the old world; the seeds differ', () => {
  const ends: string[] = [];
  for (const k of [1, 2, 3, 4]) {
    const sim = fight(k), checkpoints: string[] = [];
    readyToKill(sim, 3 + k);
    const from = sim.world.tick;
    sim.command({ t: 'release' });
    ticks(sim, ticksOf(10), world => { if (world.tick % 300 === 0) checkpoints.push(`${world.tick}:${sim.hash()}`); });
    const again: string[] = [];
    const r = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), s => { if (s.world.tick % 300 === 0 && s.world.tick > from) again.push(`${s.world.tick}:${s.hash()}`); });
    assert(r.hash() === sim.hash() && JSON.stringify(again) === JSON.stringify(checkpoints), `seed ${k}: replay`);
    assert(sim.world.bossCleared === true && 'bossCleared' in (worldState(sim.world) as object), `seed ${k}: the cleared world hashes its flag`);
    ends.push(sim.hash());
  }
  assert(new Set(ends).size === ends.length, 'the seeds differ');
  // A sandbox fight on another arena: the journal without the new keys plays the same world.
  const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(5), record: true });
  ticks(sim, ticksOf(20));
  const journal = sim.exportJournal()! as Journal, without = JSON.parse(JSON.stringify(journal)) as Journal;
  delete (without.params as Partial<Params>).bossClears; delete (without.params as Partial<Params>).bossPartLoot;
  const strip = (x: unknown): string => { const { params: _p, ...rest } = x as Record<string, unknown>; void _p; return JSON.stringify(rest); };
  assert(strip(worldState(replay(without).world)) === strip(worldState(sim.world)), 'the same world without the keys');
});

console.log(`boss-clears: ${checks} checks passed`);
