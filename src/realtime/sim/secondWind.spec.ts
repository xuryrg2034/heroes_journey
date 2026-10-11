/**
 * П9 «Второе дыхание» (world.ts `hurtHero`, `Params.secondWind`; docs/realtime-prototype.md, «Второе дыхание»; research
 * docs/realtime-engagement-research.md, П9 and decision 9.1.1: sandbox only). Node only: `npm run test:realtime-second-wind`.
 *
 * Every check plays journalled commands (place, begin / drag, release, teleport, clear, oath) and lets enemies hit the hero
 * to death, then reads what the player sees:
 * - off: the lethal hit ends the fight; on: the hero stands up with 3 HP, the next hit waits 2 s, the second lethal hit of
 *   the fight kills;
 * - the lethal hit is still a hit (stats, П4 takes a greed step off); the cauldron of the fight is 0 after it and later
 *   chains fill it again; the oath of the fight is broken — the door pays the cauldron ×0,5;
 * - «Пепельный оберег» saves first, the second wind only after it;
 * - fights on several seeds with walking enemies replay to the same hash; a journal without the
 *   key plays the old world (the lethal hit ends it); a run arena plays it off whatever the panel holds. The fights last a
 *   few hundred ticks: hashes every 60 ticks.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { worldState } from './hash';
import { oathMark } from './oath';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import type { World, WorldEvent } from './world';
import { rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'wind-field', name: 'Поле дыхания', summary: 'Тест второго дыхания', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** A quiet fight with the rule on: no newcomers, nobody walks, no hit-stop; a touch does `contactDamage` (only who stands on the hero). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.hitstop = false; p.survivorKnockback = false;
  p.secondWind = true;
  return Object.assign(p, extra);
}

/** Checkpoints: the fights here last a few hundred ticks, so the replay compares the hash every 60 (stricter than 300). */
const CHECKPOINT = 60;
interface Fight { sim: Simulation; hashes: Map<number, string>; events: WorldEvent[] }
function fight(params: Params = quiet(), options: { k?: number; hp?: number; ward?: boolean } = {}): Fight {
  const hp = options.hp ?? 2;
  const sim = new Simulation({
    arena: 'wind-field', params, seed: seedOf(options.k ?? 1), record: true, hero: { hp, maxHp: 12 },
    ...options.ward ? { loadout: { talismans: ['ash-ward'], ward: true } } : {},
  });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, hashes: new Map(), events: [] };
}
function tick(f: Fight): void {
  f.sim.tick();
  f.events.push(...f.sim.world.events);
  f.sim.world.events.length = 0;
  if (f.sim.world.tick % CHECKPOINT === 0) f.hashes.set(f.sim.world.tick, f.sim.hash());
}
function settle(f: Fight): void { for (let i = 0; i < 900 && (f.sim.world.move || i === 0); i++) tick(f); }

type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);

/** An enemy stands on the hero until it hits once; the field is cleared then. Returns the hit and the tick it came in. */
function touch(f: Fight): { hit: Ev<'hit'>; tick: number } {
  const w = f.sim.world, before = f.events.length;
  f.sim.command({ t: 'place', x: w.hero.x, y: w.hero.y, color: 1, hp: 0, kind: 'basic' });
  for (let i = 0; i < 1200 && statusOf(w) === 'playing' && !of(f.events.slice(before), 'hit').length; i++) tick(f);
  // The hit came in the last tick run: its number is one less than the world's count after it.
  const at = w.tick - 1;
  f.sim.command({ t: 'clear', keepMarked: false });
  const hits = of(f.events.slice(before), 'hit');
  assert(hits.length === 1, `one hit: ${hits.length}`);
  return { hit: hits[0], tick: at };
}

/** A chain of `n` weak enemies in a row from the hero (teleported to x = 3), released and played to the end. */
function chain(f: Fight, n: number, door = false): void {
  const w = f.sim.world, d = w.objects.find(o => o.kind === 'door')!;
  const from = door ? d.x - 1.4 * (n + 1) : 3;
  f.sim.command({ t: 'teleport', x: from, y: 6 });
  const points = Array.from({ length: n }, (_, i) => ({ x: from + 1.4 * (i + 1), y: 6 }));
  for (const p of points) f.sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  if (door) points.push({ x: d.x, y: d.y });
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === points.length, `the chain took ${w.chain.length} links, wanted ${points.length}`);
  f.sim.command({ t: 'release' });
  settle(f);
}

const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % CHECKPOINT === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && f.hashes.size > 0 && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};
const winds = (f: Fight): Ev<'secondWind'>[] => of(f.events, 'secondWind');
/** Reads through a call: commands change the world between asserts (no narrowing across them). */
const statusOf = (w: World): World['status'] => w.status;
const hpOf = (w: World): number => w.hero.hp;
const cauldronOf = (w: World): number | undefined => w.purse?.cauldron;
const stepOf = (w: World): number | undefined => w.purse?.greed?.step;

// ---- The rule ----

check('off: the lethal hit ends the fight (as before); on: the hero stands up with 3 HP, the fight goes on', () => {
  const off = fight(quiet({ secondWind: false }), { hp: 1 });
  const lethal = touch(off);
  assert(statusOf(off.sim.world) === 'defeat' && hpOf(off.sim.world) === 0 && lethal.hit.damage === 1, 'off: defeat at 0 HP');
  assert(!off.sim.world.secondWind && !winds(off).length && !('secondWind' in (worldState(off.sim.world) as object)), 'off: no field, no event');

  const on = fight(), w = on.sim.world;
  touch(on);
  assert(statusOf(w) === 'playing' && hpOf(w) === 1, `the first hit is not lethal: ${w.hero.hp} HP`);
  for (let i = 0; i < 60; i++) tick(on);
  const hitsBefore = w.stats.hitsTaken;
  const second = touch(on);
  assert(statusOf(w) === 'playing' && hpOf(w) === 3, `the lethal hit: the hero stands with 3 HP (${w.hero.hp}, ${w.status})`);
  assert(w.hero.invulnerable === 2, `invulnerable 2 s: ${w.hero.invulnerable}`);
  assert(w.stats.hitsTaken === hitsBefore + 1 && w.stats.damageTaken === 2 && second.hit.damage === 1, 'the lethal hit counts as a hit');
  assert(w.secondWind?.tick === second.tick && winds(on).length === 1, 'used in this tick, one event');
  const ev = winds(on)[0];
  assert(ev.x === w.hero.x && ev.y === w.hero.y, 'the event is at the hero');
  assert(replays(on), 'the fight replays');
});

check('invulnerable 2 s: an enemy on the hero hits only after 2 s; the second lethal hit of the fight kills', () => {
  const f = fight(quiet({ contactDamage: 3 })), w = f.sim.world;
  const lethal = touch(f);
  assert(statusOf(w) === 'playing' && hpOf(w) === 3, 'the second wind');
  // An enemy stands on the hero from the tick he stood up: the next hit comes when the 2 s are over (120 ticks), not before.
  const next = touch(f);
  const waited = next.tick - lethal.tick;
  assert(waited >= 120 && waited <= 122, `the next hit after ${waited} ticks (2 s = 120)`);
  assert(statusOf(w) === 'defeat' && hpOf(w) === 0, `a 3-damage hit at 3 HP: the second lethal hit kills (${w.status})`);
  assert(winds(f).length === 1 && of(f.events, 'defeat').length === 1, 'once per fight');
  assert(replays(f), 'the fight replays');
});

check('the cauldron of the fight goes to 0, later chains fill it again; П4: the lethal hit still takes a greed step off', () => {
  const f = fight(quiet({ purse: true, greedByDeeds: true, purseRate: 200 }), { hp: 1 }), w = f.sim.world;
  chain(f, 3);
  assert(w.stage === 'greed', 'the goals');
  chain(f, 3); chain(f, 3);
  assert(stepOf(w) === 1 && cauldronOf(w) === 18, `×1,5 and 18 in the cauldron: ${JSON.stringify(w.purse)}`);
  touch(f);
  assert(statusOf(w) === 'playing' && hpOf(w) === 3, 'the second wind');
  assert(cauldronOf(w) === 0, `the cauldron is 0: ${w.purse!.cauldron}`);
  assert(stepOf(w) === 0, `the hit took the step off: ${w.purse!.greed?.step}`);
  const greedHits = of(f.events, 'greed').filter(e => e.cause === 'hit');
  assert(greedHits.length === 1, 'one greed step off');
  chain(f, 3);
  assert(cauldronOf(w) === 6, `a chain after it fills the cauldron again: ${w.purse!.cauldron}`);
  assert(replays(f), 'the fight replays');
});

check('the oath of the fight is broken: the door pays the cauldron ×0,5; off — the same oath is kept (×2)', () => {
  const play = (on: boolean): { w: World; f: Fight } => {
    const f = fight(quiet({ purse: true, oathStake: true, secondWind: on, heroHp: 12 }), { hp: 12 }), w = f.sim.world;
    f.sim.command({ t: 'oath', id: 'no-jump' });
    chain(f, 3);
    touch(f);
    return { w, f };
  };
  const off = play(false);
  assert(statusOf(off.w) === 'playing' && hpOf(off.w) === 11 && oathMark(off.w)?.mark === 'holds', 'a hit that does not kill: the oath holds');
  chain(off.f, 3, true);
  const kept = of(off.f.events, 'purseDoor');
  assert(statusOf(off.w) === 'victory' && kept.length === 1 && kept[0].oath === 2, `the door without the wind: oath ×${kept[0]?.oath}`);

  const f = fight(quiet({ purse: true, oathStake: true, heroHp: 12 }), { hp: 1 }), w = f.sim.world;
  f.sim.command({ t: 'oath', id: 'no-jump' });
  chain(f, 3);
  assert(oathMark(w)?.mark === 'holds', 'no jump yet: holds');
  const lethal = touch(f);
  assert(statusOf(w) === 'playing' && w.oath?.broken === lethal.tick && oathMark(w)?.mark === 'broken', 'the second wind broke the oath');
  assert(of(f.events, 'oath').filter(e => e.action === 'broken').length === 1, 'one «broken» event');
  chain(f, 3, true);
  const door = of(f.events, 'purseDoor');
  assert(statusOf(w) === 'victory' && door.length === 1 && door[0].oath === 0.5, `the door: oath ×${door[0]?.oath}`);
  assert(replays(f), 'the fight replays');
});

check('«Пепельный оберег» saves first; the second wind only on the next lethal hit', () => {
  const f = fight(quiet({ contactDamage: 3 }), { ward: true }), w = f.sim.world;
  touch(f);
  assert(statusOf(w) === 'playing' && hpOf(w) === 1 && w.kit!.wardUsed && !w.secondWind, `the ward: 1 HP, the wind unused (${w.hero.hp})`);
  assert(of(f.events, 'ward').length === 1 && !winds(f).length, 'the ward event only');
  touch(f);
  assert(statusOf(w) === 'playing' && hpOf(w) === 3 && !!w.secondWind && winds(f).length === 1, 'the next lethal hit: the second wind');
  touch(f);
  assert(statusOf(w) === 'defeat', 'the third lethal hit kills');
  assert(replays(f), 'the fight replays');
});

// ---- Determinism and the run ----

/** A real fight: the arena «kills» with its walking enemies and newcomers, the hero stands; 2 HP, touch 1. */
function standing(on: boolean, k: number): Fight {
  const p = defaultParams();
  p.secondWind = on; p.heroHp = 2;
  const sim = new Simulation({ arena: 'kills', params: p, seed: seedOf(k), record: true });
  const f: Fight = { sim, hashes: new Map(), events: [] };
  for (let i = 0; i < 60 * 120 && statusOf(sim.world) === 'playing'; i++) {
    sim.tick();
    f.events.push(...sim.world.events);
    sim.world.events.length = 0;
    if (sim.world.tick % CHECKPOINT === 0) f.hashes.set(sim.world.tick, sim.hash());
  }
  return f;
}

check('several seeds, walking enemies: off — defeat at the lethal hit; on — the wind in that tick, defeat later; replay; a journal without the key plays the old world', () => {
  const ends = new Set<number>();
  for (let k = 1; k <= 3; k++) {
    const off = standing(false, k), on = standing(true, k);
    assert(statusOf(off.sim.world) === 'defeat' && statusOf(on.sim.world) === 'defeat', `k=${k}: both end in defeat`);
    const offEnd = off.sim.world.tick, wind = on.sim.world.secondWind;
    // `world.tick` counts ticks run: the lethal hit came in tick `offEnd − 1`.
    assert(wind?.tick === offEnd - 1, `k=${k}: the wind comes in the tick the hero fell without it (${wind?.tick} vs ${offEnd - 1})`);
    assert(on.sim.world.tick > offEnd, `k=${k}: the fight went on (${on.sim.world.tick} > ${offEnd})`);
    ends.add(offEnd);
    assert(replays(on) && replays(off), `k=${k}: replays (hashes every ${CHECKPOINT} ticks)`);
    // A journal without the key: the lethal hit ends it (the old world, `params` aside — they are hashed).
    const journal = JSON.parse(JSON.stringify(on.sim.exportJournal()!)) as Journal;
    delete (journal.params as Partial<Params>).secondWind;
    const old = replay(journal);
    const strip = (w: World): string => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    // The replay runs all the journal's ticks; the fight ended where the off fight did.
    assert(statusOf(old.world) === 'defeat' && old.world.endTime === off.sim.world.endTime && !old.world.secondWind, `k=${k}: without the key — defeat at ${old.world.endTime}`);
    const offJournal = JSON.parse(JSON.stringify(off.sim.exportJournal()!)) as Journal;
    delete (offJournal.params as Partial<Params>).secondWind;
    assert(strip(replay(offJournal).world) === strip(off.sim.world), `k=${k}: the off journal without the key — the same world`);
  }
  console.log(`  defeat ticks without the rule: ${[...ends].join(', ')}`);
});

check('a run arena plays it off whatever the panel holds; the sandbox default is off', () => {
  const panel = defaultParams();
  assert(panel.secondWind === false, 'off by default');
  panel.secondWind = true;
  assert(rtRunParams(panel).secondWind === false && panel.secondWind === true, 'the run copy is off, the panel keeps it');
});

console.log(`second wind: ${checks} checks passed`);
