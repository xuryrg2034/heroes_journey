/**
 * The fight bot of the garrison measures (task 40, part Е; scripts/realtime-garrison-curve.ts, scripts/realtime-economy.ts
 * `--garrison on`), Node only. A run's open battle played for real on its arena with the given params, loadout, seed and the
 * run's HP: the greedy chain of the field measures (scripts/loopBot.ts `playChain`: nearest first, nearest next, buttons and
 * crystals too) every 0.75 s, a walk by a pattern, a spin every 6.7 s, a jump every 8.3 s, a healing potion at 5 HP or lower;
 * after the goals it walks the grid path to the door, still chaining, and chains into the door once it is within reach. A fight
 * over the limit counts as lost. `stay` — the bot keeps fighting after the goals while it says so (scripts/realtime-economy.ts: the
 * bag and the feat, as its economy bot), then heads for the door for good. `aim` — the boss-aim policy (design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md,
 * 12: the measure of a boss fight): with a core of these kinds on the arena the bot walks at it and chains into it (or towards it);
 * the full Castellan's grate down (task 43) — it walks to the nearest ready lever and pulls it first.
 */
import { canJump, nextCandidates, objectRefusal } from '../src/realtime/sim/chain';
import { castellanGrate, gateLeverReady } from '../src/realtime/sim/enemies/garrison';
import { blockedAt, type Vec } from '../src/realtime/sim/geometry';
import { heroRadius, type Params } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { Loadout } from '../src/realtime/sim/kit';
import type { Enemy, World } from '../src/realtime/sim/world';
import type { RtRunState } from '../src/realtime/run/rtRun';
import { playChain } from './loopBot';

/** The bot drinks a healing potion at this HP or lower. */
export const HEAL_AT = 5;

const fields = new Map<string, Map<string, number>>();
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** The last `stepToward` found a walking path from the hero (false — cut off: task 43, the gallery behind the moat). */
let lastReach = true;
/** One step of a breadth-first path on a 0.25 grid to `goal` (scripts/realtime-ash-final.ts). */
export function stepToward(w: World, goal: Vec): Vec {
  const a = w.arena, s = 0.25, r = heroRadius(w.params) + 0.05, g = (v: number) => Math.round(v / s), key = `${a.id}:${g(goal.x)},${g(goal.y)}`;
  let field = fields.get(key);
  if (!field) {
    field = new Map([[`${g(goal.x)},${g(goal.y)}`, 0]]);
    const queue: [number, number][] = [[g(goal.x), g(goal.y)]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i], d = field.get(`${x},${y}`)!;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx * s > a.width || ny * s > a.height || field.has(k) || blockedAt({ x: nx * s, y: ny * s }, r, a)) continue;
        field.set(k, d + (dx && dy ? Math.SQRT2 : 1)); queue.push([nx, ny]);
      }
    }
    fields.set(key, field);
  }
  const hx = g(w.hero.x), hy = g(w.hero.y);
  lastReach = field.has(`${hx},${hy}`);
  let best: Vec | null = null, bestD = field.get(`${hx},${hy}`) ?? Infinity;
  for (const [dx, dy] of STEPS) { const d = field.get(`${hx + dx},${hy + dy}`); if (d !== undefined && d < bestD) { bestD = d; best = { x: dx, y: dy }; } }
  return best ?? { x: goal.x - w.hero.x, y: goal.y - w.hero.y };
}

/** The boss-aim policy: a walk at the core and a chain into it (or towards it); no core (or leaving) — the greedy chain. */
export function aimAtCore(sim: Simulation, kinds: readonly string[]): void {
  const w = sim.world, core = w.enemies.find(e => kinds.includes(e.kind));
  if (!core || w.move || w.chain.length || w.status !== 'playing' || w.greedStart !== null) { playChain(sim); return; }
  // Task 43: the full Castellan behind his grate — the bot goes to the nearest ready lever and pulls it (a chain of one link);
  // no lever ready — the greedy chain. With the grate up it hunts the core as below.
  const grate = castellanGrate(w);
  if (grate && !grate.open) {
    const near = (o: Vec): number => (o.x - w.hero.x) ** 2 + (o.y - w.hero.y) ** 2;
    const lever = w.objects.filter(o => o.kind === 'lever' && o.gate && gateLeverReady(w, o)).sort((a, b) => near(a) - near(b))[0];
    if (!lever) { playChain(sim); return; }
    if (objectRefusal(w, lever) === null) { sim.command({ t: 'begin', x: lever.x, y: lever.y }); sim.command({ t: 'release' }); return; }
    const step = stepToward(w, lever), len = Math.sqrt(step.x ** 2 + step.y ** 2) || 1;
    sim.command({ t: 'walk', x: step.x / len, y: step.y / len });
    playChain(sim);
    return;
  }
  const d =Math.sqrt((core.x - w.hero.x) ** 2 + (core.y - w.hero.y) ** 2) || 1;
  sim.command({ t: 'walk', x: (core.x - w.hero.x) / d, y: (core.y - w.hero.y) / d });
  const byCore = (list: Enemy[]): Enemy[] => list.sort((a, b) => ((a.x - core.x) ** 2 + (a.y - core.y) ** 2) - ((b.x - core.x) ** 2 + (b.y - core.y) ** 2));
  const first = byCore(nextCandidates(w))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let n = 0; n < 8 && first.id !== core.id; n++) {
    const next = byCore(nextCandidates(w))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before || next.id === core.id) break;
  }
  sim.command({ t: 'release' });
}

export interface BotFightOptions {
  params: Params;
  loadout: Loadout;
  /** Game seconds the fight may last before the bot gives it up as lost. */
  limit: number;
  /** The boss-aim policy: the core kinds the bot hunts; absent — the greedy chain only. */
  aim?: readonly string[];
  /** HP added to the hero's (the economy audit's hero who cannot fall); the potion is drunk at the real HP. Absent — 0. */
  buffer?: number;
  /** After the goals: true — the bot stays and fights on (asked each tick until it says false once); absent — it leaves at once. */
  stay?: (w: World) => boolean;
  /** After each tick, before its events are read (scripts/realtime-garrison-curve.ts: the Castellan's sweep). */
  afterTick?: (w: World, tick: number) => void;
  /** Each tick's events, before they go. */
  seen?: (w: World) => void;
}
export interface BotFight { sim: Simulation; timeout: boolean; lastSource: string | null }

/** The open battle of `run` played by the bot (see the file's comment); a fight over the limit ends as a defeat. */
export function botFight(run: RtRunState, options: BotFightOptions): BotFight {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const buffer = options.buffer ?? 0;
  const sim = new Simulation({ arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, params: options.params, seed: pending.seed,
    hero: { hp: run.hp + buffer, maxHp: run.maxHp + buffer }, loadout: options.loadout });
  const w = sim.world;
  let lastSource: string | null = null, timeout = false, left = false;
  for (let tick = 0; tick < options.limit * 60 && w.status === 'playing'; tick++) {
    if (w.greedStart !== null && !left && !options.stay?.(w)) left = true;
    const leaving = left;
    if (tick % 30 === 0 && !w.move) {
      if (leaving) {
        const d = stepToward(w, w.arena.door);
        // Task 43: no walking path to the door — the hero on the full Castellan's gallery (north of the moat, the door in the yard):
        // it walks south to the moat and jumps across (the jump's energy permitting; else it waits at the edge).
        if (!lastReach) {
          sim.command({ t: 'walk', x: 0, y: 1 });
          if (canJump(w) && w.hero.y > 3.2) sim.command({ t: 'jump', x: w.hero.x, y: w.hero.y + 2.5 });
        } else sim.command({ t: 'walk', x: d.x, y: d.y });
      }
      else if (tick % 60 === 0) { const [x, y] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]][(tick / 60) % 6]; sim.command({ t: 'walk', x, y }); }
    }
    // Leaving: a chain straight into the open door when it is within reach (it wins), else the greedy chain clears the way.
    if (leaving && tick % 15 === 5 && !w.move && !w.chain.length) {
      sim.command({ t: 'begin', x: w.arena.door.x, y: w.arena.door.y });
      if (w.chain.some(l => l.kind === 'object')) sim.command({ t: 'release' }); else if (w.chain.length) sim.command({ t: 'cancel' });
    }
    if (tick % 45 === 20) { if (options.aim) aimAtCore(sim, options.aim); else playChain(sim); }
    if (tick % 400 === 200) sim.command({ t: 'spin' });
    if (tick % 500 === 300 && canJump(w)) sim.command({ t: 'jump', x: w.hero.x + 2, y: w.hero.y - 1 });
    if (tick % 10 === 0 && w.hero.hp - buffer <= HEAL_AT && (w.kit?.items.healing ?? 0) > 0) sim.command({ t: 'item', kind: 'healing', x: w.hero.x, y: w.hero.y });
    sim.tick();
    options.afterTick?.(w, tick);
    for (const ev of w.events) if (ev.type === 'hit') lastSource = ev.source;
    options.seen?.(w);
    w.events.length = 0;
  }
  if (w.status === 'playing') { timeout = true; w.status = 'defeat'; }
  return { sim, timeout, lastSource };
}
