/**
 * Task 14 «Котомка у двери» (sim/bag.ts, `Params.doorBag`; user decision 13.10.2026; docs/realtime-slice.md, «Котомка у
 * двери»). Node only: `npm run test:realtime-bag`.
 *
 * Every check plays journalled commands (place, begin / drag, release, teleport, walk, goals, slot, clear) and reads what the
 * player gets: the bag of the world, its events, the door's payout and the run's materials after `resolveArena`:
 * - the goals open the door and the bag appears; kills before it do not count (the kill that completes the goals neither),
 *   kills of the same chain after it do; 10 / 20 / 35 kills after the goals fill the steps — 1 / 3 / 6 resources in all;
 * - a real hit (HP lost) sends only the unfilled step back to its start (filled steps stay); a hit with nothing to take
 *   changes nothing; a hit the invulnerability or the after-chain shield absorbs resets nothing;
 * - the goblin's bust blast kills count (the player's, source `slot-bust`);
 * - the door pays (kinds of the stream `bag`), a defeat pays nothing; the run adds the payout to its materials;
 * - the Jailer's and the final fight and the prologue have no bag; the sandbox default has none;
 * - the fight replays to the same hash (every 60 ticks); a journal without the keys plays the old world;
 * - the resource kinds vary across seeds and repeat for a seed; the fight observer records the bag.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { BAG_STEPS, bagPayout, bagProgress } from './bag';
import { objectRefusal, planChain } from './chain';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, PARAM_DEFS, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import { goblinOf, leverOf } from './slot';
import type { World, WorldEvent } from './world';
import { RESOURCE_KINDS } from './kit';
import { PROLOGUE_ROOM_COUNT, prologueLoadout, prologueParams, prologueRoom } from '../run/prologue';
import { createRtRun, resolveArena, rtArenaLoadout, rtMapNodes, rtRunParams, RT_RUN_FORCED, type RtRunState } from '../run/rtRun';
import { ok, playFight, takeGift, toBattle } from '../run/runFight.testkit';
import { createFightObserver } from '../telemetry/observe';
import { withSummaryDefaults } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'bag-field', name: 'Поле котомки', summary: 'Тест котомки у двери', goal: 'kills', width: 30, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 28.5, y: 6 }, enemies: [], killGoal: 3,
});

/** A quiet fight with the bag on: no newcomers, nobody walks, no hit-stop, no reaper; a touch takes 1 HP (only who stands on the hero). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.doorBag = true;
  return Object.assign(p, extra);
}

const CHECKPOINT = 60;
interface Fight { sim: Simulation; hashes: Map<number, string>; events: WorldEvent[] }
function fight(params: Params = quiet(), k = 1, loadout?: Loadout, hero?: { hp: number; maxHp: number }): Fight {
  const sim = new Simulation({ arena: 'bag-field', params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {}, ...hero ? { hero } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return { sim, hashes: new Map(), events: [] };
}
function tick(f: Fight): void {
  f.sim.tick();
  f.events.push(...f.sim.world.events);
  f.sim.world.events.length = 0;
  if (f.sim.world.tick % CHECKPOINT === 0) f.hashes.set(f.sim.world.tick, f.sim.hash());
}
function ticks(f: Fight, n: number): void { for (let i = 0; i < n && f.sim.world.status === 'playing'; i++) tick(f); }
/** Ticks until the hero stands again. */
function settle(f: Fight): void { for (let i = 0; i < 900 && (f.sim.world.move || i === 0) && f.sim.world.status === 'playing'; i++) tick(f); }

type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const bagEvents = (events: readonly WorldEvent[], action?: Ev<'bag'>['action']): Ev<'bag'>[] => of(events, 'bag').filter(e => !action || e.action === action);

/** A chain of `n` weak enemies in a row from x = 3, y = 6 (the hero is teleported there first), drawn, released and played out. */
function chain(f: Fight, n: number): void {
  const w = f.sim.world;
  f.sim.command({ t: 'teleport', x: 3, y: 6 });
  const points = Array.from({ length: n }, (_, i) => ({ x: 3 + 1.4 * (i + 1), y: 6 }));
  for (const p of points) f.sim.command({ t: 'place', x: p.x, y: p.y, color: 0, hp: 0, kind: 'basic' });
  f.sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) f.sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
  assert(w.chain.length === n, `the chain took ${w.chain.length} of ${n} links`);
  // The highlight is a preview: it does not change the world (the bag included) and spends no randomness.
  const before = f.sim.hash();
  planChain(w);
  assert(f.sim.hash() === before, 'the highlight leaves the world as it was');
  f.sim.command({ t: 'release' });
  settle(f);
  assert(!w.move, 'the dash ended');
}
/** Several chains of `n` (kills in all: their sum). */
const chains = (f: Fight, ...ns: number[]): void => { for (const n of ns) chain(f, n); };

/** A touch: an enemy is placed on the hero and stays until it hits once; then the field is cleared. Returns the hit. */
function touch(f: Fight): Ev<'hit'> {
  const w = f.sim.world, before = f.events.length;
  f.sim.command({ t: 'place', x: w.hero.x, y: w.hero.y, color: 1, hp: 0, kind: 'basic' });
  for (let i = 0; i < 1200 && !of(f.events.slice(before), 'hit').length && w.status === 'playing'; i++) tick(f);
  f.sim.command({ t: 'clear', keepMarked: false });
  const hits = of(f.events.slice(before), 'hit');
  assert(hits.length === 1 && hits[0].damage > 0, `one hit: ${hits.length}`);
  return hits[0];
}
/** The goals by a chain of 3 (the field's goal: 3 kills). */
function goals(f: Fight): void {
  assert(!f.sim.world.bag, 'no bag before the goals');
  chain(f, 3);
  assert(f.sim.world.stage === 'greed', 'the 3 kills complete the goals');
}
/** The hero walks into the open door. */
function exit(f: Fight): void {
  f.sim.command({ t: 'teleport', x: 26.5, y: 6 });
  f.sim.command({ t: 'walk', x: 1, y: 0 });
  ticks(f, 600);
  assert(f.sim.world.status === 'victory', `the hero walked into the door (${f.sim.world.status})`);
}
const bagOf = (w: World) => w.bag;
const paidCount = (paid: Partial<Record<string, number>> | null | undefined): number => Object.values(paid ?? {}).reduce((a: number, b) => a + (b ?? 0), 0);
const replays = (f: Fight): boolean => {
  const seen = new Map<number, string>();
  const again = replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, s => { if (s.world.tick % CHECKPOINT === 0) seen.set(s.world.tick, s.hash()); });
  return again.hash() === f.sim.hash() && [...f.hashes].every(([t, h]) => seen.get(t) === h);
};
const withoutParams = (w: World): string => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };

// ---- Steps ----

check('steps: the bag appears with the goals; 10 / 20 / 35 kills after them fill the steps — 1 / 3 / 6 resources; the door pays 6', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet(), k), w = f.sim.world;
    goals(f);
    assert(bagOf(w) && bagOf(w)!.kills === 0 && bagOf(w)!.step === 0 && bagOf(w)!.resets === 0, `seed ${k}: the bag at the goals ${JSON.stringify(w.bag)}`);
    assert(bagEvents(f.events, 'appear').length === 1 && bagEvents(f.events, 'appear')[0].step === 0, 'the appear event');
    chains(f, 5, 4);
    assert(bagOf(w)!.kills === 9 && bagOf(w)!.step === 0 && !bagEvents(f.events, 'step').length, `9 kills: no step (${JSON.stringify(w.bag)})`);
    chain(f, 1);
    assert(bagOf(w)!.step === 1 && bagProgress(w)!.total === 1, `10 kills: step 1, 1 resource (${JSON.stringify(bagProgress(w))})`);
    chains(f, 5, 5);
    assert(bagOf(w)!.kills === 20 && bagOf(w)!.step === 2 && bagProgress(w)!.total === 3, `20 kills: step 2, 3 resources (${JSON.stringify(bagProgress(w))})`);
    chains(f, 5, 5, 4);
    assert(bagOf(w)!.kills === 34 && bagOf(w)!.step === 2, '34 kills: still 2 steps');
    chain(f, 1);
    assert(bagOf(w)!.step === 3 && bagProgress(w)!.total === 6 && bagProgress(w)!.to === null, `35 kills: all three, 6 resources (${JSON.stringify(bagProgress(w))})`);
    const steps = bagEvents(f.events, 'step');
    assert(JSON.stringify(steps.map(e => [e.step, e.reward])) === '[[1,1],[2,2],[3,3]]', `the step events ${JSON.stringify(steps)}`);
    // Kills after the last step still count, nothing more fills.
    chain(f, 5);
    assert(bagOf(w)!.kills === 40 && bagOf(w)!.step === 3 && bagEvents(f.events, 'step').length === 3, 'no fourth step');
    assert(bagPayout(w) === null, 'nothing paid before the door');
    exit(f);
    assert(paidCount(bagPayout(w)) === 6 && paidCount(bagOf(w)!.paid) === 6, `the door paid 6: ${JSON.stringify(bagOf(w)!.paid)}`);
    assert(Object.keys(bagOf(w)!.paid!).every(kind => (RESOURCE_KINDS as readonly string[]).includes(kind)), 'crafting resources');
    assert(replays(f), `seed ${k}: replay`);
  }
});

check('the door pays the filled steps only: 1 step — 1, 2 steps — 3, none — nothing (no draw of the stream `bag`)', () => {
  for (const [kills, want] of [[0, 0], [9, 0], [10, 1], [19, 1], [20, 3], [34, 3]] as const) {
    const f = fight(quiet(), 4), w = f.sim.world;
    goals(f);
    for (let left = kills; left > 0; left -= Math.min(5, left)) chain(f, Math.min(5, left));
    exit(f);
    assert(paidCount(bagPayout(w)) === want, `${kills} kills: paid ${JSON.stringify(w.bag?.paid)}, wanted ${want}`);
    assert(want > 0 || (!bagOf(w)!.paid && !w.rng.states().some(([name]) => name === 'bag')), `${kills} kills: no draw`);
    assert(replays(f), 'replay');
  }
});

check('kills before the goals do not count (nor the kill that completes them); kills of the same chain after it do', () => {
  const f = fight(quiet(), 5), w = f.sim.world;
  goals(f);
  assert(bagOf(w)!.kills === 0, `the goals chain: 0 (${bagOf(w)!.kills})`);
  const g = fight(quiet(), 5), gw = g.sim.world;
  chain(g, 7);
  assert(gw.stats.kills === 7 && bagOf(gw)!.kills === 4, `a chain of 7 over the goal of 3: 4 after the goals (${bagOf(gw)!.kills})`);
  assert(replays(f) && replays(g), 'replay');
});

// ---- Risk ----

check('a real hit sends only the unfilled step back to its start; filled steps stay; a hit with nothing to take changes nothing', () => {
  for (let k = 1; k <= 3; k++) {
    const f = fight(quiet(), 10 + k), w = f.sim.world;
    goals(f);
    chain(f, 5);
    let hp = w.hero.hp;
    touch(f);
    assert(w.hero.hp === hp - 1 && bagOf(w)!.kills === 0 && bagOf(w)!.step === 0 && bagOf(w)!.resets === 1, `5 kills, a hit: back to 0 (${JSON.stringify(w.bag)})`);
    assert(bagEvents(f.events, 'reset').length === 1 && bagEvents(f.events, 'reset')[0].step === 0, 'the reset event');
    // Nothing to take: no reset counted.
    touch(f);
    assert(bagOf(w)!.resets === 1 && bagEvents(f.events, 'reset').length === 1, 'a hit at the step start takes nothing');
    chains(f, 5, 5, 4);
    assert(bagOf(w)!.kills === 14 && bagOf(w)!.step === 1, '14 kills: step 1');
    hp = w.hero.hp;
    touch(f);
    assert(w.hero.hp === hp - 1 && bagOf(w)!.kills === 10 && bagOf(w)!.step === 1 && bagOf(w)!.resets === 2, `a hit: back to 10, step 1 kept (${JSON.stringify(w.bag)})`);
    chains(f, 5, 5, 5, 5, 5);
    assert(bagOf(w)!.step === 3, 'all three');
    touch(f);
    assert(bagOf(w)!.step === 3 && bagOf(w)!.resets === 2, 'every step filled: a hit takes nothing');
    exit(f);
    assert(paidCount(bagPayout(w)) === 6, 'the door pays 6');
    assert(replays(f), 'replay');
  }
});

check('absorbed hits reset nothing: the invulnerability after a hit and the after-chain shield', () => {
  // The invulnerability: 3 s after the first hit; a chain of 3 inside it; an enemy on the hero does not hurt until it ends.
  const f = fight(quiet({ invulnerability: 3, invulnerabilityMode: 'constant', chainShield: 0 }), 21), w = f.sim.world;
  goals(f);
  chain(f, 5);
  touch(f);
  assert(bagOf(w)!.kills === 0 && bagOf(w)!.resets === 1 && w.hero.invulnerable > 1.5, `the hit reset, invulnerable ${w.hero.invulnerable}`);
  chain(f, 3);
  assert(bagOf(w)!.kills === 3 && w.hero.invulnerable > 0, 'kills inside the invulnerability');
  const hp = w.hero.hp, before = f.events.length;
  f.sim.command({ t: 'place', x: w.hero.x, y: w.hero.y, color: 1, hp: 0, kind: 'basic' });
  while (w.hero.invulnerable > 1 / 60 && w.status === 'playing') tick(f);
  assert(!of(f.events.slice(before), 'hit').length && w.hero.hp === hp && bagOf(w)!.kills === 3 && bagOf(w)!.resets === 1, `absorbed: ${JSON.stringify(w.bag)}`);
  // When it ends the touch hurts and the progress goes.
  for (let i = 0; i < 120 && !of(f.events.slice(before), 'hit').length; i++) tick(f);
  assert(of(f.events.slice(before), 'hit').length === 1 && bagOf(w)!.kills === 0 && bagOf(w)!.resets === 2, `after the invulnerability: reset (${JSON.stringify(w.bag)})`);
  f.sim.command({ t: 'clear', keepMarked: false });
  assert(replays(f), 'replay');

  // The after-chain shield: 3 s after a chain of 5; an enemy on the hero does not hurt while it lasts.
  const g = fight(quiet({ chainShield: 3, chainShieldMinKills: 1, invulnerability: 0.1 }), 22), gw = g.sim.world;
  goals(g);
  chain(g, 5);
  assert(gw.hero.chainShield > 2, `the shield is up (${gw.hero.chainShield})`);
  const at = g.events.length;
  g.sim.command({ t: 'place', x: gw.hero.x, y: gw.hero.y, color: 1, hp: 0, kind: 'basic' });
  while (gw.hero.chainShield > 1 / 60 && gw.status === 'playing') tick(g);
  assert(!of(g.events.slice(at), 'hit').length && bagOf(gw)!.kills === 5 && bagOf(gw)!.resets === 0, `the shield absorbed: ${JSON.stringify(gw.bag)}`);
  for (let i = 0; i < 120 && !of(g.events.slice(at), 'hit').length; i++) tick(g);
  assert(bagOf(gw)!.kills === 0 && bagOf(gw)!.resets === 1, 'after the shield: reset');
  g.sim.command({ t: 'clear', keepMarked: false });
  assert(replays(g), 'replay');
});

check('a defeat pays nothing (filled steps included); the fight replays', () => {
  const f = fight(quiet(), 30, undefined, { hp: 3, maxHp: 40 }), w = f.sim.world;
  goals(f);
  chains(f, 5, 5, 5, 5);
  assert(bagOf(w)!.step === 2, 'two steps filled');
  f.sim.command({ t: 'place', x: w.hero.x, y: w.hero.y, color: 1, hp: 0, kind: 'basic' });
  ticks(f, 60 * 30);
  assert(w.status === 'defeat', `the hero fell (${w.status})`);
  assert(bagPayout(w) === null && !bagOf(w)!.paid && !w.rng.states().some(([name]) => name === 'bag'), 'no payout, no draw');
  assert(replays(f), 'replay');
});

// ---- The goblin's bust ----

/** The goblin with «Перебор» and «Взрыв по площади» as the run plays them, every pull risky, no cooldown; the bag on. */
const bustParams = (): Params => quiet({
  contactDamage: 0, maxEnemies: 0, slot: true, slotBust: true, slotPulls: 6, slotCooldown: 0, slotSafePulls: 0,
  slotBustArea: true, slotBustRadius: 3.5, slotBustFuse: 1.2, slotBustEnemyDamage: 3,
});
/** After the goals: the goblin by the panel command, its first pull (a bare chain of the lever); the pull and the events. */
function bustPull(k: number): { f: Fight; bust: boolean } {
  const f = fight(bustParams(), k), w = f.sim.world;
  f.sim.command({ t: 'goals' });
  assert(w.bag, 'the bag at the goals');
  assert(f.sim.command({ t: 'slot' }) === true && goblinOf(w), 'the goblin stands');
  for (let i = 0; i < 1200 && leverOf(w) && objectRefusal(w, leverOf(w)!) === 'lever'; i++) tick(f);
  const L = leverOf(w)!, dx = w.arena.width / 2 - L.x, dy = w.arena.height / 2 - L.y, d = Math.hypot(dx, dy) || 1;
  f.sim.command({ t: 'teleport', x: L.x + dx / d * 1.2, y: L.y + dy / d * 1.2 });
  assert(f.sim.command({ t: 'begin', x: L.x, y: L.y }) === true && w.chain.length === 1, 'a chain of just the lever');
  f.sim.command({ t: 'release' });
  settle(f);
  const pull = of(f.events, 'slot').find(e => e.action === 'pull');
  assert(pull, 'the dash pulled the lever');
  return { f, bust: pull.bust === true };
}

check('the goblin\'s bust blast kills count (the player\'s, source `slot-bust`); the hero who walks out keeps the progress', () => {
  let k = 7000, found: Fight | null = null;
  for (; k < 7400 && !found; k++) { const r = bustPull(k); if (r.bust) found = r.f; }
  assert(found, 'a busting seed');
  const f = found, w = f.sim.world;
  for (let i = 0; i < 300 && !of(f.events, 'slot').some(e => e.action === 'lit'); i++) tick(f);
  const lit = of(f.events, 'slot').find(e => e.action === 'lit');
  assert(lit && lit.x !== undefined && lit.y !== undefined, 'the idol lit');
  // Three weak enemies inside the circle; the hero walks out at once (the blast must not hit him).
  const dx = w.arena.width / 2 - lit.x!, dy = w.arena.height / 2 - lit.y!, d = Math.hypot(dx, dy) || 1, sx = -dy / d, sy = dx / d;
  for (const [r, s] of [[1.5, 0], [2.2, 0.8], [2.2, -0.8]]) f.sim.command({ t: 'place', x: lit.x! + dx / d * r + sx * s, y: lit.y! + dy / d * r + sy * s, color: 2, hp: 0, kind: 'basic' });
  f.sim.command({ t: 'walk', x: -dx / d, y: -dy / d });
  const before = bagOf(w)!.kills, at = f.events.length;
  for (let i = 0; i < 180 && !of(f.events.slice(at), 'slot').some(e => e.action === 'blast'); i++) tick(f);
  const dead = of(f.events.slice(at), 'kill').filter(e => e.source === 'slot-bust');
  assert(dead.length === 3 && dead.every(e => e.credited), `the blast killed 3 (${dead.length})`);
  assert(!of(f.events.slice(at), 'hit').length, 'the hero walked out');
  assert(bagOf(w)!.kills === before + 3 && bagOf(w)!.resets === 0, `the bag counts them: ${before} → ${bagOf(w)!.kills}`);
  assert(replays(f), 'replay');
});

// ---- Where the bag is ----

check('defaults: off in the sandbox (no bag at the goals); the run turns it on; the panel has the toggle and the numbers', () => {
  const d = defaultParams();
  assert(d.doorBag === false && d.bagStep1 === 10 && d.bagStep2 === 20 && d.bagStep3 === 35 && d.bagReward1 === 1 && d.bagReward2 === 2 && d.bagReward3 === 3, 'the defaults');
  assert(RT_RUN_FORCED.doorBag === true && rtRunParams(defaultParams()).doorBag === true, 'the run');
  assert(['doorBag', 'bagStep1', 'bagStep2', 'bagStep3', 'bagReward1', 'bagReward2', 'bagReward3'].every(key => PARAM_DEFS.some(x => x.key === key)), 'the panel');
  const f = fight(quiet({ doorBag: false }), 40), w = f.sim.world;
  goals(f);
  chains(f, 5, 5);
  assert(!w.bag && !bagEvents(f.events).length, 'the sandbox default: no bag');
  exit(f);
  assert(bagPayout(w) === null, 'nothing paid');
});

check('the run: the Jailer\'s and the final fight carry no bag; other battle nodes do', () => {
  let jail = 0, other = 0;
  for (let k = 1; k <= 3; k++) {
    const base = takeGift(createRtRun(seedOf(50 + k), { gift: 'mini' }));
    for (const node of rtMapNodes(base)) {
      if (!['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'].includes(node.type)) continue;
      const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'run-fight-field', seed: seedOf(1), battle: node.type === 'boss' ? 'final' : node.type === 'hard' ? 'hard' : 'battle' } };
      const no = node.type === 'checkpoint' || node.type === 'boss';
      assert(!!rtArenaLoadout(run).noBag === no, `${node.type}: noBag ${rtArenaLoadout(run).noBag}`);
      if (!no || k > 1) { other += no ? 0 : 1; continue; }
      // The fight itself: the goals and 20 kills after them — no bag, nothing paid.
      const { sim, outcome } = playFight(run, { chains: [5, 5, 5, 5], start: s => { s.command({ t: 'goals' }); } });
      assert(!sim.world.bag && outcome.bag === undefined, `${node.type}: no bag in the fight`);
      jail++;
    }
  }
  assert(jail >= 2 && other >= 10, `checked: Jailer/final ${jail}, others ${other}`);
});

check('the run: a won battle adds the bag\'s payout to the materials; a lost one ends the run with nothing', () => {
  const kinds = new Set<string>();
  for (let k = 1; k <= 3; k++) {
    const run = toBattle(takeGift(createRtRun(seedOf(60 + k), { gift: 'mini' })));
    const { sim, outcome } = playFight(run, { chains: [5, 5, 5, 5, 5, 5, 5], k, start: s => { s.command({ t: 'goals' }); } });
    assert(sim.world.bag?.step === 3 && paidCount(outcome.bag) === 6, `seed ${k}: the outcome carries 6 (${JSON.stringify(outcome.bag)})`);
    const after = ok(resolveArena(run, outcome), 'resolve');
    for (const kind of RESOURCE_KINDS) {
      const gain = after.materials[kind] - run.materials[kind], want = (outcome.bag?.[kind] ?? 0) + (outcome.materials?.[kind] ?? 0);
      assert(gain === want, `seed ${k}: ${kind} +${gain}, wanted +${want}`);
      if (outcome.bag?.[kind]) kinds.add(kind);
    }
    const lost = playFight(run, { chains: [5, 5, 5, 5], k, start: s => { s.command({ t: 'goals' }); }, lose: true });
    assert(lost.sim.world.bag?.step === 2 && lost.outcome.bag === undefined, `seed ${k}: a defeat carries nothing`);
    const end = ok(resolveArena(run, lost.outcome), 'resolve the defeat');
    assert(end.result?.outcome === 'defeat' && RESOURCE_KINDS.every(kind => end.materials[kind] === run.materials[kind]), 'the run is over, no payout');
  }
  assert(kinds.size >= 2, `kinds paid across seeds: ${[...kinds]}`);
});

check('the prologue: no bag in any room (the goals by the command)', () => {
  for (let n = 1; n <= PROLOGUE_ROOM_COUNT; n++) {
    const params = prologueParams(n), loadout = prologueLoadout(n);
    assert(params.doorBag === false, `room ${n}: doorBag off`);
    const sim = new Simulation({ arena: prologueRoom(n).id, params, seed: seedOf(n), record: true, ...loadout ? { loadout } : {} });
    sim.command({ t: 'goals' });
    for (let i = 0; i < 60; i++) { sim.tick(); sim.world.events.length = 0; }
    assert(sim.world.stage === 'greed' && !sim.world.bag, `room ${n}: the door open, no bag`);
  }
});

// ---- Determinism ----

check('a journal without the keys plays the old world: no bag, the same world (the params aside); the keys off — the same', () => {
  for (let k = 1; k <= 3; k++) {
    const play = (p: Params): Fight => { const f = fight(p, 70 + k); goals(f); chains(f, 5, 5, 2); touch(f); chain(f, 3); exit(f); return f; };
    const off = quiet({ doorBag: false }), none = { ...off } as Partial<Params>;
    for (const key of ['doorBag', 'bagStep1', 'bagStep2', 'bagStep3', 'bagReward1', 'bagReward2', 'bagReward3'] as const) delete none[key];
    const a = play(off), b = play(none as Params);
    assert(!a.sim.world.bag && !b.sim.world.bag, 'no bag');
    assert(!('bag' in (worldState(a.sim.world) as Record<string, unknown>)), 'no field in the hash');
    assert(withoutParams(a.sim.world) === withoutParams(b.sim.world), `seed ${k}: the same world without the keys`);
    const journal = JSON.parse(JSON.stringify(a.sim.exportJournal()!)) as Journal;
    for (const key of ['doorBag', 'bagStep1', 'bagStep2', 'bagStep3', 'bagReward1', 'bagReward2', 'bagReward3']) delete (journal.params as unknown as Record<string, unknown>)[key];
    assert(withoutParams(replay(journal).world) === withoutParams(a.sim.world), `seed ${k}: the journal without the keys replays the same world`);
    assert(replays(a) && replays(b), 'replays');
  }
});

check('the resource kinds: reproducible for a seed (replay, the same play again), varied across seeds', () => {
  const seen = new Set<string>(), kinds = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const play = (): Fight => { const f = fight(quiet(), 80 + k); goals(f); chains(f, 5, 5, 5, 5, 5, 5, 5); exit(f); return f; };
    const a = play(), b = play(), paid = JSON.stringify(a.sim.world.bag!.paid);
    assert(paid === JSON.stringify(b.sim.world.bag!.paid) && a.sim.hash() === b.sim.hash(), `seed ${k}: the same play pays the same`);
    assert(JSON.stringify(replay(JSON.parse(JSON.stringify(a.sim.exportJournal()!)) as Journal).world.bag!.paid) === paid, `seed ${k}: the replay pays the same`);
    seen.add(paid);
    for (const kind of Object.keys(a.sim.world.bag!.paid!)) kinds.add(kind);
  }
  assert(seen.size >= 4 && kinds.size >= 3, `8 seeds: ${seen.size} different payouts, kinds ${[...kinds]}`);
});

// ---- Telemetry ----

check('the fight observer records the bag: steps, kills after the goals, resets, the payout by kind; an old record reads «no bag»', () => {
  const f = fight(quiet(), 90), w = f.sim.world;
  goals(f);
  chains(f, 5, 5, 5, 3);
  touch(f);
  chains(f, 5, 5);
  exit(f);
  assert(bagOf(w)!.step === 2 && bagOf(w)!.resets === 1, `the bag ${JSON.stringify(w.bag)}`);
  let observer: ReturnType<typeof createFightObserver> | null = null;
  replay(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal, r => { observer ??= createFightObserver(r.world); observer.tick(r.world); });
  const s = observer!.summary().bag;
  assert(s.appeared && s.steps === 2 && s.killsAfterGoals === 28 && s.resets === 1 && s.payout === 3 && paidCount(s.kinds) === 3, `the summary ${JSON.stringify(s)}`);
  assert(JSON.stringify(s.kinds) === JSON.stringify(bagOf(w)!.paid), 'the kinds');
  const older = withSummaryDefaults({}).bag;
  assert(!older.appeared && older.steps === 0 && older.payout === null && older.killsAfterGoals === 0, 'an old record');
  assert(BAG_STEPS === 3, 'three steps');
});

console.log(`\n${checks} checks passed`);
