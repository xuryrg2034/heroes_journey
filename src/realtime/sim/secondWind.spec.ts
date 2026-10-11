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
 * - the recovery window (design decision 12.10.2026): the 2 s after it the porcupine's quills do not hurt (no «−N HP» badge,
 *   a chain released before the wind spares the hero after its first quills); after it they hurt as before, through an
 *   ordinary invulnerability too; the window lasts as the wind's invulnerability, a hit-stop included;
 * - telemetry: the fight summary (the report's replay, `analyzeJournal`) has `secondWind` — the tick, the HP before the lethal
 *   hit, its source and striker — after a real second wind, null otherwise;
 * - fights on several seeds with walking enemies replay to the same hash; a journal without the
 *   key plays the old world (the lethal hit ends it); a run arena plays it off whatever the panel holds. The fights last a
 *   few hundred ticks: hashes every 60 ticks.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { armedDamage } from './chain';
import { worldState } from './hash';
import { oathMark } from './oath';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { rtRunParams } from '../run/rtRun';
import { analyzeJournal } from '../telemetry/report';
import { withSummaryDefaults } from '../telemetry/schema';

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

// ---- The recovery window (design decision 12.10.2026): the quills do not pierce the 2 s after the wind ----

/** Quills always up (no down part of the cycle): every porcupine placed is armed. */
const quills = (extra: Partial<Params> = {}): Params => quiet({ porcupineDownTime: 0, ...extra });

/** `n` porcupines in a row from the hero (teleported to x = 3), drawn into a chain (not released yet). */
function drawPorcupines(f: Fight, n: number): Enemy[] {
  const w = f.sim.world, before = new Set(w.enemies.map(e => e.id));
  f.sim.command({ t: 'teleport', x: 3, y: 6 });
  for (let i = 1; i <= n; i++) f.sim.command({ t: 'place', x: 3 + 1.4 * i, y: 6, color: 0, hp: 0, kind: 'porcupine' });
  const list = w.enemies.filter(e => !before.has(e.id));
  f.sim.command({ t: 'begin', x: list[0].x, y: list[0].y });
  for (const e of list.slice(1)) f.sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(list.length === n && w.chain.length === n, `the chain took ${w.chain.length} porcupines, wanted ${n}`);
  return list;
}
function release(f: Fight): void { f.sim.command({ t: 'release' }); settle(f); }
const quillHits = (events: readonly WorldEvent[]): Ev<'hit'>[] => of(events, 'hit').filter(e => e.source === 'quills');
/** Runs ticks until `seconds` game seconds passed since `from` (a hit-stop tick does not count). */
function waitUntil(f: Fight, from: number, seconds: number): void {
  for (let i = 0; i < 1200 && f.sim.world.time - from < seconds; i++) tick(f);
}

check('the 2 s after the wind: the quills do not hurt and show no badge; after them they hurt as before, through an ordinary invulnerability too', () => {
  const f = fight(quills(), { hp: 1 }), w = f.sim.world;
  touch(f);
  assert(statusOf(w) === 'playing' && hpOf(w) === 3 && winds(f).length === 1, 'the second wind');
  const windAt = w.time;
  // In the window: the drawn chain shows no «−1 HP», the dash through the porcupine leaves the hero at 3 HP.
  const first = drawPorcupines(f, 1);
  assert(armedDamage(w, first[0]) === 0, `no badge in the window: −${armedDamage(w, first[0])} HP`);
  const before = f.events.length;
  release(f);
  assert(of(f.events.slice(before), 'chainHit').some(e => e.enemyId === first[0].id), 'the dash struck the porcupine');
  assert(w.time - windAt < 2, `struck inside the window (${(w.time - windAt).toFixed(3)} s)`);
  assert(hpOf(w) === 3 && !quillHits(f.events.slice(before)).length, `the quills spared the hero: ${w.hero.hp} HP`);
  // After the window: the badge is back and the quills hurt.
  waitUntil(f, windAt, 2.1);
  assert(w.hero.invulnerable === 0, 'the invulnerability of the wind is over');
  const second = drawPorcupines(f, 1);
  assert(armedDamage(w, second[0]) === 1, `the badge after the window: −${armedDamage(w, second[0])} HP`);
  const after = f.events.length;
  release(f);
  assert(hpOf(w) === 2 && quillHits(f.events.slice(after)).length === 1, `after the window the quills hurt: ${w.hero.hp} HP`);
  // An ordinary invulnerability (that quill hit's) is pierced as before.
  assert(w.hero.invulnerable > 0, 'the quills left an ordinary invulnerability');
  const third = drawPorcupines(f, 1);
  assert(armedDamage(w, third[0]) === 1, 'the badge through an ordinary invulnerability');
  const last = f.events.length;
  release(f);
  assert(hpOf(w) === 1 && quillHits(f.events.slice(last)).length === 1, `the quills pierce an ordinary invulnerability: ${w.hero.hp} HP`);
  assert(replays(f), 'the fight replays');
});

check('a chain released before the wind: its first quills stand the hero up, the next porcupines of the chain spare him (a hit-stop on)', () => {
  const play = (on: boolean): Fight => {
    const f = fight(quills({ secondWind: on, hitstop: true }), { hp: 1 });
    const list = drawPorcupines(f, 3);
    assert(list.every(e => armedDamage(f.sim.world, e) === 1), 'every link shows «−1 HP» before the release');
    release(f);
    return f;
  };
  const off = play(false);
  assert(statusOf(off.sim.world) === 'defeat' && quillHits(off.events).length === 1, 'off: the first quills kill (as before)');
  const f = play(true), w = f.sim.world;
  assert(statusOf(w) === 'playing' && hpOf(w) === 3, `on: the hero stands with 3 HP after the chain (${w.hero.hp}, ${w.status})`);
  assert(quillHits(f.events).length === 1 && winds(f)[0]?.source === 'quills', 'only the lethal quills hit; the wind names them');
  assert(of(f.events, 'kill').filter(e => e.source === 'chain').length === 3, 'the chain killed all three');
  // The dash is short: a few more ticks reach a checkpoint of the replay.
  for (let i = 0; i < CHECKPOINT; i++) tick(f);
  assert(replays(f), 'the fight replays');
});

check('without the wind the quills pierce any invulnerability as before (the rule on but unused, and off)', () => {
  for (const on of [true, false]) {
    const f = fight(quills({ secondWind: on }), { hp: 12 }), w = f.sim.world;
    touch(f);
    assert(hpOf(w) === 11 && w.hero.invulnerable > 0 && !w.secondWind, `${on}: an ordinary hit, invulnerable`);
    drawPorcupines(f, 2);
    release(f);
    assert(hpOf(w) === 9 && quillHits(f.events).length === 2, `${on}: both quills pierce: ${w.hero.hp} HP`);
  }
});

check('the window lasts as the invulnerability of the wind, a hit-stop included: the release after it arms the quills, inside it does not', () => {
  // Fights alike up to the delay: the wind, a chain of 3 (a hit-stop freezes a few ticks), then a porcupine released later
  // each time. The release fixes the quills (as their up / down state): the badge at the release tells what the strike does.
  let spared = 0, hurt = 0, frozen = 0;
  for (let delay = 100; delay <= 135; delay++) {
    const f = fight(quills({ hitstop: true }), { hp: 1 }), w = f.sim.world;
    touch(f);
    assert(hpOf(w) === 3, 'the second wind');
    const windTick = w.tick, windTime = w.time;
    chain(f, 3);
    frozen = Math.max(frozen, (w.tick - windTick) - Math.round((w.time - windTime) * 60));
    while (w.tick - windTick < delay) tick(f);
    const [p] = drawPorcupines(f, 1);
    const invAtRelease = w.hero.invulnerable, badge = armedDamage(w, p);
    // Over: nothing but the crumb of the 1/60 s sums is left of the 2 s.
    assert((badge > 0) === invAtRelease < 1e-6, `delay ${delay}: invulnerable ${invAtRelease} at the release, badge −${badge} HP`);
    const before = f.events.length;
    release(f);
    assert(of(f.events.slice(before), 'chainHit').some(e => e.enemyId === p.id), `delay ${delay}: the dash struck the porcupine`);
    const hit = quillHits(f.events.slice(before)).length > 0;
    assert(hit === badge > 0, `delay ${delay}: the badge −${badge} HP, the quills ${hit ? 'hurt' : 'spared'}`);
    if (hit) hurt++; else spared++;
  }
  assert(frozen > 0, 'the hit-stop froze ticks in the window');
  assert(spared > 0 && hurt > 0, `both sides of the edge: spared ${spared}, hurt ${hurt}`);
});

// ---- Telemetry ----

check('telemetry: the fight summary has the second wind (tick, HP before, source, striker) after a real one, null otherwise', () => {
  const touched = fight(quiet({ contactDamage: 2 }), { hp: 3 });
  touch(touched);
  const lethal = touch(touched);
  const a = analyzeJournal(touched.sim.exportJournal()!).summary.secondWind;
  assert(a && a.tick === lethal.tick && a.tick === touched.sim.world.secondWind!.tick, `the tick of the lethal hit: ${JSON.stringify(a)}`);
  assert(a.hpBefore === 1 && a.source === 'touch' && a.enemy === 'basic' && !a.elite, `HP before 1, a touch of a basic enemy: ${JSON.stringify(a)}`);

  const quilled = fight(quills({ hitstop: true }), { hp: 1 });
  drawPorcupines(quilled, 3);
  release(quilled);
  const q = analyzeJournal(quilled.sim.exportJournal()!).summary.secondWind;
  assert(q && q.hpBefore === 1 && q.source === 'quills' && q.enemy === 'porcupine', `the quills of a porcupine: ${JSON.stringify(q)}`);
  assert(q.tick === quilled.sim.world.secondWind!.tick, 'the tick of the quills');

  const unused = fight(quiet(), { hp: 12 });
  touch(unused);
  assert(analyzeJournal(unused.sim.exportJournal()!).summary.secondWind === null, 'a hit that does not kill: null');
  const off = fight(quiet({ secondWind: false }), { hp: 1 });
  touch(off);
  const offSummary = analyzeJournal(off.sim.exportJournal()!);
  assert(offSummary.status === 'defeat' && offSummary.summary.secondWind === null, 'off: defeat, null');
  assert(withSummaryDefaults({}).secondWind === null, 'an older record reads it as absent');
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
