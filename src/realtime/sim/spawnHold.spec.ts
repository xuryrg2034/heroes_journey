/**
 * The rule `spawnGroupHold` (design 12.10.2026, docs/realtime-prototype.md, «Появление»): a queued spawn group stays together.
 * Node only: `npm run test:realtime-spawn-hold`.
 *
 * - The scenario of the open risk (docs/realtime-phase-b.md, Д6): on «Застава» with seed 62 the third member of a group whose
 *   anchor went stale finds no free point at the new anchor. Without the rule it drops the anchor and steps out 10 units
 *   from its group; with it, it waits a tick and steps out by its mates.
 * - Real fights (journalled walks and chains): without the rule groups split in the queue and their members come far
 *   apart; with it no group splits.
 * - The queue never stalls: chilled bodies (journal `place` and `chill`) cover the group's anchor; the group waits there
 *   1 s of game time, then all of it takes a new anchor, and its enemies step out after the marker.
 * - Several seeds: the places differ by seed and repeat by seed; fights replay to the same hash (every 300 ticks too); a
 *   journal without the key plays the world of before; a run plays the rule, the sandbox has it off.
 * The queue is watched from outside (an array that notes each member's group as it is queued); the world is changed only by
 * journal commands. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, enemyBodyRadius, type Params } from './params';
import { Simulation, replay } from './simulation';
import { SPAWN_HOLD_LIMIT, type QueuedSpawn } from './spawn';
import { rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'spawn-hold-field', name: 'Поле появления', summary: 'Тест группы', goal: 'kills', width: 16, height: 10, heroStart: { x: 8, y: 5 },
  obstacles: [], buttons: [], enemies: [], killGoal: 999, door: { x: 15.3, y: 5 },
});

const R = enemyBodyRadius(defaultParams());
/** Two members of one group at one anchor stand within twice the spread of `pointNear` (r × 2.6) of each other. */
const GROUP_SPAN = 2 * R * 2.6 + 1e-9;

/** The hero takes no damage. */
function harmless(hold: boolean | undefined, extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  if (hold === undefined) delete (p as Partial<Params>).spawnGroupHold; else p.spawnGroupHold = hold;
  return Object.assign(p, extra);
}

interface Note { group: number; queued: number }
/** The world's queue, noting each member's group (its anchor object when queued; none — a single) and the shifts of a tick. */
class WatchedQueue extends Array<QueuedSpawn> {
  static get [Symbol.species](): ArrayConstructor { return Array; }
  notes = new Map<QueuedSpawn, Note>();
  shifted: QueuedSpawn[] = [];
  tick = 0;
  private groups = new Map<object, number>();
  private nextGroup = 0;
  override push(...items: QueuedSpawn[]): number {
    for (const q of items) {
      let g = this.nextGroup++;
      if (q.anchor) { const known = this.groups.get(q.anchor); if (known !== undefined) g = known; else this.groups.set(q.anchor, g); }
      this.notes.set(q, { group: g, queued: this.tick });
    }
    return super.push(...items);
  }
  override shift(): QueuedSpawn | undefined { const q = super.shift(); if (q) this.shifted.push(q); return q; }
}
function watch(sim: Simulation): WatchedQueue {
  const queue = new WatchedQueue();
  for (const q of sim.world.queue) queue.push(q);
  sim.world.queue = queue;
  return queue;
}

interface Out { group: number; tick: number; at: Vec }
/** One tick; the markers that came from the queue, with their groups (in the order of the shifts). */
function step(sim: Simulation, queue: WatchedQueue, seen: Set<number>, out: Out[]): void {
  const w = sim.world;
  queue.tick = w.tick;
  queue.shifted.length = 0;
  sim.tick();
  w.events.length = 0;
  const fresh = w.markers.filter(m => !seen.has(m.id) && m.kind !== 'reaper');
  for (const m of w.markers) seen.add(m.id);
  fresh.forEach((m, i) => { const q = queue.shifted[i], note = q && queue.notes.get(q); if (note) out.push({ group: note.group, tick: w.tick, at: { x: m.x, y: m.y } }); });
}
/** Groups whose queued members ended this tick on different anchors (or one of them on none). */
function splitGroups(queue: WatchedQueue): number[] {
  const anchors = new Map<number, unknown>(), split = new Set<number>();
  for (const q of queue) {
    const g = queue.notes.get(q)!.group;
    if (!anchors.has(g)) anchors.set(g, q.anchor);
    else if (anchors.get(g) !== q.anchor) split.add(g);
  }
  return [...split];
}

/** The greedy chain of the bots of the specs (sliceArenas.spec.ts), by journal commands. */
function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from: Vec = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind !== 'door')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}
const WALK = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];

/** A fight with a walking hero and chains (journal commands only); the goals after 20 s. */
function fight(arena: string, k: number, hold: boolean | undefined, seconds: number, record = false): { sim: Simulation; out: Out[]; splits: Set<number>; hashes: string[] } {
  const sim = new Simulation({ arena, params: harmless(hold), seed: seedOf(k), record }), w = sim.world;
  const queue = watch(sim), seen = new Set(w.markers.map(m => m.id)), out: Out[] = [], splits = new Set<number>(), hashes: string[] = [];
  for (let tick = 0; tick < seconds * 60 && w.status === 'playing'; tick++) {
    if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick === 20 * 60) sim.command({ t: 'goals' });
    if (tick % 40 === 15) playChain(sim);
    step(sim, queue, seen, out);
    if (w.tick % 300 === 0) hashes.push(sim.hash());
    for (const g of splitGroups(queue)) splits.add(g);
  }
  return { sim, out, splits, hashes };
}
/** Members that came out farther than `span` from every mate of their group that came out within `window` ticks. */
const farMembers = (out: Out[], span: number, window: number): Out[] =>
  out.filter(a => { const mates = out.filter(b => b !== a && b.group === a.group && Math.abs(b.tick - a.tick) <= window); return mates.length > 0 && mates.every(b => dist(a.at, b.at) > span); });

// ---- The scenario of the open risk ----

check('«Застава», seed 62 (the open risk of Д6): a group whose anchor went stale — without the rule its third member drops the anchor and steps out ~10 units away; with it the three step out together', () => {
  const spreadOf = (hold: boolean | undefined): { spread: number; ticks: number } => {
    const p = defaultParams(); p.baseFloor = 0;
    if (hold !== undefined) p.spawnGroupHold = hold;
    const sim = new Simulation({ arena: 'outpost', params: p, seed: seedOf(62) }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    // As the check of bigArenas.spec.ts: the group was rolled round the hero at the left, he walked to the right.
    w.groupTimer = 1000;
    w.hero.x = w.arena.width - 4; w.hero.y = w.arena.height / 2;
    const anchor = { x: 3, y: w.arena.height / 2 };
    for (let i = 0; i < 3; i++) w.queue.push({ kind: 'basic', color: i, hp: 0, anchor });
    let ticks = 0;
    while (w.markers.length < 3 && ticks < 120) { sim.tick(); ticks++; }
    assert(w.markers.length === 3, `${w.markers.length} markers after ${ticks} ticks`);
    let spread = 0;
    for (const a of w.markers) for (const b of w.markers) spread = Math.max(spread, dist(a, b));
    return { spread, ticks };
  };
  const off = spreadOf(undefined), on = spreadOf(true);
  assert(off.spread > 8, `without the rule: ${off.spread.toFixed(2)} apart (the defect expected)`);
  assert(on.spread <= GROUP_SPAN && on.ticks <= 1 + 60, `with the rule: ${on.spread.toFixed(2)} apart after ${on.ticks} ticks`);
  console.log(`   without: ${off.spread.toFixed(2)} apart; with: ${on.spread.toFixed(2)} apart, the last after ${on.ticks} ticks`);
});

check('real fights (walks and chains by journal commands, «Застава» 20×14 and «Стрелковая гряда» 16×10, 3 seeds × 60 s): without the rule groups split in the queue and members come far from their mates; with it no group splits', () => {
  let offSplits = 0, offFar = 0, onFar = 0;
  for (const arena of ['outpost', 'archers']) for (const k of [1, 2, 3]) {
    const off = fight(arena, k, undefined, 60), on = fight(arena, k, true, 60);
    offSplits += off.splits.size;
    offFar += farMembers(off.out, 2.5, 90).length;
    onFar += farMembers(on.out, 2.5, 90).length;
    assert(on.splits.size === 0, `${arena} seed ${k}: ${on.splits.size} groups split with the rule`);
    assert(on.out.length > 100, `${arena} seed ${k}: ${on.out.length} newcomers`);
  }
  // Far with the rule: a remaining group moved whole (its anchor went stale as the hero walked, or 1 s of waiting) — away
  // from the mates that came out before; rarer than the members that dropped their anchor without it.
  assert(offSplits > 0 && onFar < offFar, `without the rule: ${offSplits} split groups, ${offFar} far members; with it ${onFar} far`);
  console.log(`   without the rule: ${offSplits} groups split, ${offFar} members > 2.5 from every mate out within 1.5 s; with it: 0 split, ${onFar} such members`);
});

// ---- The queue never stalls ----

/** Chilled bodies on a hex grid 2r apart over a disc round `c` (every free point of `pointNear` within 1.5 r of one). */
function coverAnchor(sim: Simulation, c: Vec): number {
  const w = sim.world, s = 2 * R + 1e-3, rows = 4;
  let n = 0;
  for (let j = -rows; j <= rows; j++) for (let i = -rows; i <= rows; i++) {
    const x = c.x + (i + (j % 2 ? 0.5 : 0)) * s, y = c.y + j * s * Math.sqrt(3) / 2;
    if (dist({ x, y }, c) > R * 2.6 + R * 2) continue;
    if (x < R || x > w.arena.width - R || y < R || y > w.arena.height - R) continue;
    const id = sim.command({ t: 'place', x, y, color: 0, hp: 9, kind: 'basic' }) as number;
    sim.command({ t: 'chill', id, seconds: 30 });
    n++;
  }
  return n;
}

check(`the queue never stalls: chilled bodies cover the anchor of the first group — it waits there ${SPAWN_HOLD_LIMIT} s, then the whole group takes a new anchor and steps out after the marker (5 seeds)`, () => {
  for (const k of [1, 2, 3, 4, 5]) {
    const extra: Partial<Params> = { baseFloor: 0, enemySpeed: 0, speedSpread: 0 };
    // The probe: where the first group (rolled on tick 1) comes without the bodies.
    const probe = new Simulation({ arena: 'spawn-hold-field', params: harmless(true, extra), seed: seedOf(k) });
    probe.command({ t: 'clear', keepMarked: false });
    probe.tick();
    const size = probe.world.markers.length, anchor = { x: probe.world.markers[0].x, y: probe.world.markers[0].y };
    assert(size >= 2, `seed ${k}: the first group has ${size} members`);
    for (const hold of [true, false]) {
      const sim = new Simulation({ arena: 'spawn-hold-field', params: harmless(hold, extra), seed: seedOf(k), record: true }), w = sim.world;
      sim.command({ t: 'clear', keepMarked: false });
      const bodies = coverAnchor(sim, anchor), bodyIds = new Set(w.enemies.map(e => e.id));
      const firstOut = new Map<number, number>();
      for (let tick = 1; tick <= 200; tick++) {
        sim.tick();
        for (const m of w.markers) if (!firstOut.has(m.id)) firstOut.set(m.id, tick);
      }
      const ticks = [...firstOut.values()].sort((a, b) => a - b), first = ticks.slice(0, size);
      const markers = [...firstOut.keys()].slice(0, size);
      const stepped = w.enemies.filter(e => !bodyIds.has(e.id));
      if (!hold) {
        // Without the rule the head drops the anchor and comes out the next tick at another one.
        assert(first[0] === 2, `seed ${k}, without the rule: first marker on tick ${first[0]}`);
        continue;
      }
      // Tick 1 is the first failed try at the covered anchor; 1 s (60 ticks) later the group moves and its first marker comes.
      // A mate may wait at the new anchor in its turn (by its group), never past another second.
      assert(first.length === size && first[0] === 61 && first.every(t => t <= 121), `seed ${k}: markers of the group on ticks ${first.join(', ')} (${bodies} bodies)`);
      const ids = new Set(markers);
      assert(stepped.length >= size && stepped.slice(0, size).every(e => dist(e, anchor) > GROUP_SPAN), `seed ${k}: ${stepped.length} stepped out`);
      // Together at the new anchor; the enemies step out a marker delay (1 s) later.
      let spread = 0;
      for (const a of stepped.slice(0, size)) for (const b of stepped.slice(0, size)) spread = Math.max(spread, dist(a, b));
      assert(spread <= GROUP_SPAN, `seed ${k}: the moved group ${spread.toFixed(2)} apart`);
      assert(!w.markers.some(m => ids.has(m.id)), `seed ${k}: a marker of the group still waits on tick 200`);
      assert(replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash(), `seed ${k}: replay`);
    }
  }
});

// ---- Seeds, replay, old journals, the run ----

check('several seeds: with the rule the first places differ by seed and repeat by seed («Застава», «Стрелковая гряда», 6 seeds × 20 s)', () => {
  for (const arena of ['outpost', 'archers']) {
    const firsts = new Set<string>();
    for (const k of [1, 2, 3, 4, 5, 6]) {
      const a = fight(arena, k, true, 20).out.map(o => `${o.at.x.toFixed(3)},${o.at.y.toFixed(3)}`);
      const b = fight(arena, k, true, 20).out.map(o => `${o.at.x.toFixed(3)},${o.at.y.toFixed(3)}`);
      assert(a.length > 10 && a.join(';') === b.join(';'), `${arena} seed ${k}: ${a.length} places, repeat ${a.join(';') === b.join(';')}`);
      firsts.add(a.slice(0, 3).join(';'));
    }
    assert(firsts.size >= 4, `${arena}: ${firsts.size} distinct starts of 6`);
  }
});

check('replay: a fight with the rule replays to the same hash, every 300 ticks too; a journal without the key plays the world of before', () => {
  const { sim, hashes } = fight('outpost', 4, true, 30, true), seen: string[] = [];
  const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), r => { if (r.world.tick % 300 === 0) seen.push(r.hash()); });
  assert(again.hash() === sim.hash() && hashes.length === 6 && seen.join() === hashes.join(), `checkpoints ${seen.length}/${hashes.length}`);
  for (const arena of ['outpost', 'archers']) {
    const off = fight(arena, 5, false, 30, true).sim;
    const old = JSON.parse(JSON.stringify(off.exportJournal()!));
    delete old.params.spawnGroupHold;
    const played = replay(old);
    const strip = (s: unknown): string => { const { params: _p, ...rest } = s as Record<string, unknown>; void _p; return JSON.stringify(rest); };
    assert(strip(worldState(played.world)) === strip(worldState(off.world)), `${arena}: the old journal plays another world`);
    assert(!JSON.stringify(off.world.queue).includes('held'), `${arena}: a queue field without the rule`);
  }
});

check('the run plays the rule (`RT_RUN_FORCED`); the sandbox has it off by default', () => {
  assert(defaultParams().spawnGroupHold === false, 'the sandbox default');
  assert(rtRunParams(defaultParams()).spawnGroupHold === true, 'the run');
});

console.log(`\n${checks} checks passed`);
