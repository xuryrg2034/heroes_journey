/**
 * Measure of the rule `spawnGroupHold` (design 12.10.2026, docs/realtime-prototype.md, «Появление»): a queued spawn group
 * stays together. A heuristic for the design, not a test: `npm run realtime:spawn-hold` (`--seeds N`, default 6;
 * `--seconds S`, default 90).
 *
 * Six arenas as in the measure of the open risk (docs/realtime-phase-b.md, Д6): «Застава» 20×14 and its layout 16×10 (copied
 * from scripts/realtime-big-arenas.ts), «Брод», «Последний рубеж», «Большая поляна», «Стрелковая гряда». The hero takes no
 * damage and walks (a pattern of directions, the greedy chain of the specs every 40 ticks); 30 s of the base pace, then the
 * goals, and the greed table to the end. Seeds `Math.imul(k, 2654435761) >>> 0`; each seed plays with the rule off and on.
 *
 * Counted (the queue is watched from outside: an array that notes its pushes and shifts; it does not touch the world):
 * - newcomers — markers that came from the queue in the fight;
 * - queue → marker — game seconds from a member's queueing to its marker (mean, p90, max);
 * - splits — groups whose queued members ended a tick on different anchors, of them with a member without an anchor (the
 *   defect: it dropped its anchor; the rest — 16×10 before the rule: only the head takes a new anchor when the old one
 *   goes stale), and the ticks;
 * - far — members whose marker stood farther than 2.5 from every mate of their group that came out within 1.5 s of it.
 */
import { arenaTemplate, MIXED_KIND_SHARE, sharesOfAll, type ArenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasCamera';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { dist, polygon, wall, zone, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { QueuedSpawn } from '../src/realtime/sim/spawn';

const arg = (name: string, def: number): number => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : def; };
const SEEDS = arg('--seeds', 6), SECONDS = arg('--seconds', 90), BASE_S = 30;
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

const ALL_FOUR = sharesOfAll([['shield', MIXED_KIND_SHARE], ['archer', MIXED_KIND_SHARE], ['sapper', MIXED_KIND_SHARE], ['porcupine', MIXED_KIND_SHARE]]);
/** «Застава» 16×10 before phase B, Т4 (arenas.ts at 5890f3c; as in scripts/realtime-big-arenas.ts), for the comparison only. */
const OUTPOST_16: ArenaTemplate = {
  id: 'outpost-16x10', name: 'Застава 16×10', summary: '', goal: 'kills', width: 16, height: 10, heroStart: { x: 8, y: 8.9 },
  obstacles: [wall(5.6, 2.2, 1.4, 1), wall(9, 2.2, 4.4, 1), wall(12.4, 3.2, 1, 4.2), wall(2.2, 6.4, 4.8, 1), wall(9, 6.4, 3.4, 1)],
  terrain: [zone('cliff', polygon(0, 0, 3, 0, 3.4, 2, 3, 4.5, 3.5, 6, 2.4, 7.4, 0, 7.6))],
  buttons: [], door: { x: 8, y: 0.7 },
  enemies: [{ x: 7.2, y: 4.4, color: 1, kind: 'shield', elite: true }, { x: 9.4, y: 3.6, color: 2, kind: 'archer', elite: true }],
  phaseOverride: { wolfShare: 0, boarShare: 0 }, killGoal: 30, newcomers: ALL_FOUR,
};

function harmless(hold: boolean): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0; p.thornDamage = 0; p.porcupineQuills = 0;
  p.spawnGroupHold = hold;
  return p;
}
/** The fight never ends by itself: a huge kill goal, the door far outside the arena (the walking bot would step into it). */
const endless = (a: ArenaTemplate): ArenaTemplate => ({ ...a, id: `${a.id}-hold-measure`, goal: a.goal === 'marked' ? 'kills' : a.goal, killGoal: 100000, door: { x: -100, y: -100 } });

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

interface Note { group: number; queued: number }
/** The world's queue, noting each member's group (its anchor object when queued; none — a single) and queueing tick. */
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

interface Tally { fights: number; newcomers: number; waits: number[]; splitTicks: number; splitGroups: number; dropGroups: number; far: number }
const newTally = (): Tally => ({ fights: 0, newcomers: 0, waits: [], splitTicks: 0, splitGroups: 0, dropGroups: 0, far: 0 });

function measure(template: ArenaTemplate, hold: boolean, k: number, t: Tally): void {
  const sim = new Simulation({ arena: endless(template), params: harmless(hold), seed: seedOf(k) }), w = sim.world;
  const queue = new WatchedQueue();
  for (const q of w.queue) queue.push(q);
  w.queue = queue;
  const seen = new Set<number>(w.markers.map(m => m.id));
  const out: { group: number; tick: number; at: Vec }[] = [];
  const split = new Set<number>(), drop = new Set<number>();
  t.fights++;
  for (let tick = 0; tick < SECONDS * 60 && w.status === 'playing'; tick++) {
    if (tick % 60 === 0) { const [x, y] = WALK[(tick / 60) % WALK.length]; sim.command({ t: 'walk', x, y }); }
    if (tick === BASE_S * 60) sim.command({ t: 'goals' });
    if (tick % 40 === 15) playChain(sim);
    queue.tick = tick;
    queue.shifted.length = 0;
    sim.tick();
    w.events.length = 0;
    const fresh = w.markers.filter(m => !seen.has(m.id) && m.kind !== 'reaper');
    for (const m of w.markers) seen.add(m.id);
    // Markers from the queue come in the order of the shifts (the reaper's marker is not queued).
    fresh.forEach((m, i) => {
      const q = queue.shifted[i], note = q && queue.notes.get(q);
      if (!note) return;
      t.newcomers++;
      t.waits.push((tick - note.queued) / 60);
      out.push({ group: note.group, tick, at: { x: m.x, y: m.y } });
    });
    const anchors = new Map<number, unknown>();
    let splitNow = false;
    for (const q of queue) {
      const g = queue.notes.get(q)!.group;
      if (!anchors.has(g)) anchors.set(g, q.anchor);
      else if (anchors.get(g) !== q.anchor) { splitNow = true; split.add(g); if (!q.anchor || !anchors.get(g)) drop.add(g); }
    }
    if (splitNow) t.splitTicks++;
  }
  t.splitGroups += split.size;
  t.dropGroups += drop.size;
  for (const a of out) {
    const mates = out.filter(b => b !== a && b.group === a.group && Math.abs(b.tick - a.tick) <= 90);
    if (mates.length && mates.every(b => dist(a.at, b.at) > 2.5)) t.far++;
  }
}

const ARENAS: ArenaTemplate[] = [arenaTemplate('outpost'), OUTPOST_16, arenaTemplate('ford'), arenaTemplate('last-stand'), arenaTemplate('big-clearing'), arenaTemplate('archers')];
const avg = (xs: number[]): number => xs.reduce((a, c) => a + c, 0) / Math.max(1, xs.length);
const pctl = (xs: number[], q: number): number => { const s = [...xs].sort((a, c) => a - c); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

console.log(`spawnGroupHold measure: ${SEEDS} seeds × ${SECONDS} s, walking hero (base ${BASE_S} s, then greed)`);
console.log('arena | rule | newcomers / fight | queue → marker mean / p90 / max, s | split groups (of them a member without an anchor; ticks) | far members');
for (const a of ARENAS) for (const hold of [false, true]) {
  const t = newTally();
  for (let k = 1; k <= SEEDS; k++) measure(a, hold, 700 + k, t);
  console.log(`${a.name.replace(/ \d+×\d+$/, '')} ${a.width}×${a.height} | ${hold ? 'on' : 'off'} | ${(t.newcomers / t.fights).toFixed(1)} | ${avg(t.waits).toFixed(2)} / ${pctl(t.waits, 0.9).toFixed(2)} / ${Math.max(...t.waits).toFixed(2)} | ${t.splitGroups} (${t.dropGroups}; ${t.splitTicks}) | ${t.far}`);
}
