/**
 * Task 56 «Приметы» (docs/design-notes/task-56-omens.md, section 2.2; docs/realtime-slice.md, «Приметы»): the fight rules of the
 * omens that are new rules — «Гроза», «Сонный час», «Половодье», «Перекличка» (and «Урожай»'s `bagResetAll`, bag.ts). The other
 * omens of a fight are values of keys that were there before (the run sets them, run/omens.ts). Each rule is a `Params` key, off
 * by default: journals without it play as before, and the world fields below are absent until the rule acts (worlds without an
 * omen hash as before). The run turns a rule on for the fight of a node or a level with that omen; the sandbox — the panel group
 * «Приметы».
 *
 * - «Гроза» (`omenStorm`): from `omenStormFirst` s, every `omenStormEvery` s, a mark of radius `omenStormRadius` stands on the
 *   enemy with the most enemies within that radius of it (itself counted; a tie — the smaller id) — when there are at least
 *   `omenStormMin`; else the count waits for the tick when there are. `omenStormFuse` s later it strikes: every enemy whose body
 *   touches the circle takes `omenStormDamage` (credited to the player; an armoured elite loses a plate), the hero whose centre is
 *   in it loses `omenStormHero` HP — not invulnerable, not in a dash or a jump (the shields do not spare him, as the bust blast).
 *   The reaper and the bosses (cores and parts) are neither the mark's target nor hurt by it. No random draw: the point is the
 *   positions'. `World.storm`.
 * - «Сонный час» (`omenDrowse`): the enemies on the arena at the start and those that appear in the first `omenDrowseTime` s
 *   sleep (`Enemy.sleep`: held as frozen — they stand, do not touch, their mechanic is off). The first dash of a chain (the
 *   release, commands.ts) or the end of that time wakes them all; for `omenWakeTime` s after it the woken walk ×`omenWakeWalk`
 *   (`Enemy.rage`). The goblin is not an enemy; the reaper and the bosses never sleep. `World.drowse`.
 * - «Половодье» (`omenFlood`): `omenFloodPools` pools of radius `omenFloodRadius` (ponds: walking ×`waterSlow`) are placed when
 *   the world is made, by the arena's stream `omen`, before the flow field is built; no pool touches a cliff, thorns, a solid
 *   obstacle, a brazier, a button, a lever, the chest, another pool, the door (2 units) or the hero's start (2.5 units). A link of
 *   an enemy whose centre was in water when it was taken hits +`omenFloodHit` (chain.ts — the flag is fixed at the link).
 *   `World.flood`.
 * - «Перекличка» (`omenRollcall`): from `omenRollcallFirst` s, every `omenRollcallEvery` s, one colour is «on the roll call» — a
 *   draw of the stream `omen` among the colours of the enemies on the arena now (none — the fight's palette), not the last one
 *   when there is another. A link of that colour gives +`omenRollcallEnergy` energy (chain.ts — fixed at the link); a touch of an
 *   enemy of that colour hurts +`omenRollcallTouch` (world.ts `touchDamage`). `World.rollcall`.
 *
 * Runtime imports from world.ts are called only at run time (world.ts calls this module too).
 */
import { dhypot } from './detMath';
import { areaContains, areaDistance, cliffAt, blockedAt, dist, inWater, pond, type Vec } from './geometry';
import { DEFAULT_PARAMS, type Params } from './params';
import type { ArenaTemplate } from './arenas';
import type { RngStreams } from './rng';
import { bodyRadiusOf, kindOf } from './enemies/kinds';
import { JAILER, JAILER_WEIGHT } from './enemies/jailer';
import { TROLL } from './enemies/troll';
import { CASTELLAN, STAND } from './enemies/garrison';
import { palette } from './spawn';
import { OBJECT_RADIUS, bustCanHurt, damageEnemy, hurtHero, type ChainLink, type Enemy, type HeroMove, type World } from './world';

/** The omens of v1 that are fight rules with keys of their own (the run's catalogue, run/omens.ts, names all twelve). */
export type OmenRule = 'storm' | 'drowse' | 'flood' | 'rollcall';

/** «Гроза»: the next mark's game time and the mark standing now (its point and the game time it strikes). */
export interface StormWorld { next: number; mark?: { x: number; y: number; due: number } }
/** «Сонный час»: ids below `next` were looked at (a newcomer from `next` on); `woke` — the game time they woke (absent — asleep). */
export interface DrowseWorld { next: number; woke?: number }
/** «Половодье»: the pools placed (centre and radius; the same ponds are in `world.arena.obstacles`). */
export interface FloodWorld { pools: { x: number; y: number; r: number }[] }
/** «Перекличка»: the next call's game time and the colour on the roll call now (absent before the first). */
export interface RollcallWorld { next: number; color?: number }

/** A number key of the omens: the value, or its default (a journal from before the key, a world the panel turned it on in). */
const num = (p: Params, key: 'omenStormFirst' | 'omenStormEvery' | 'omenStormFuse' | 'omenStormRadius' | 'omenStormDamage' | 'omenStormHero' | 'omenStormMin'
  | 'omenDrowseTime' | 'omenWakeWalk' | 'omenWakeTime' | 'omenFloodPools' | 'omenFloodRadius' | 'omenFloodHit' | 'omenRollcallFirst' | 'omenRollcallEvery'
  | 'omenRollcallEnergy' | 'omenRollcallTouch'): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_PARAMS[key];
};
export const omenNum = num;

/** Bosses (cores and parts): never the storm's target, never asleep (the goblin is not an enemy at all). */
const bossBody = (e: Enemy): boolean => e.partOf !== undefined || e.kind === JAILER || e.kind === JAILER_WEIGHT || e.kind === TROLL || e.kind === CASTELLAN || e.kind === STAND;
/** The omens act on it: not the reaper (immune), not a boss. */
export const omenTarget = (e: Enemy): boolean => !kindOf(e).immune && !bossBody(e);

// ---------- «Половодье» ----------

/** Tries per pool before the next one is given up (a crowded arena may get fewer pools: the same ones for the same seed). */
const POOL_TRIES = 120;
/** Clearances of a pool's edge (units): the door, the hero's start. */
const POOL_DOOR = 2, POOL_START = 2.5;

/** A pool of radius r at p may stand: inside the arena, off every cliff, thorns and solid obstacle, clear of the points above. */
function poolFits(arena: ArenaTemplate, pools: readonly Vec[], p: Vec, r: number): boolean {
  if (blockedAt(p, r, arena)) return false;
  if (arena.terrain) {
    if (cliffAt(p, r, arena)) return false;
    for (const z of arena.terrain) if (z.kind === 'thorns' && (areaContains(z, p) || areaDistance(z, p).d < r)) return false;
  }
  if (dist(p, arena.door) < r + POOL_DOOR || dist(p, arena.heroStart) < r + POOL_START) return false;
  const things: Vec[] = [...arena.buttons, ...arena.braziers ?? [], ...arena.gateLevers ?? [], ...arena.chest ? [arena.chest] : []];
  if (things.some(t => dist(p, t) < r + OBJECT_RADIUS)) return false;
  return pools.every(q => dist(p, q) >= 2 * r);
}

/**
 * «Половодье»: the arena of a world with the rule on — the template with the pools as ponds after its obstacles (the given object
 * stays as it is), and the pools. Off — the template itself and null (the stream `omen` untouched).
 */
export function floodArena(arena: ArenaTemplate, params: Params, rng: RngStreams): { arena: ArenaTemplate; flood: FloodWorld | null } {
  if (!params.omenFlood) return { arena, flood: null };
  const count = Math.max(0, Math.floor(num(params, 'omenFloodPools'))), r = Math.max(0.1, num(params, 'omenFloodRadius'));
  const stream = rng.stream('omen'), pools: Vec[] = [];
  for (let k = 0; k < count; k++) {
    for (let t = 0; t < POOL_TRIES; t++) {
      const p = { x: r + stream.next() * (arena.width - 2 * r), y: r + stream.next() * (arena.height - 2 * r) };
      if (poolFits(arena, pools, p, r)) { pools.push(p); break; }
    }
  }
  const flood: FloodWorld = { pools: pools.map(p => ({ x: p.x, y: p.y, r })) };
  return { arena: { ...arena, obstacles: [...arena.obstacles, ...pools.map(p => pond(p.x, p.y, r))] }, flood };
}

/** «Половодье»: the enemy's centre is in water now (a pool or the template's water) — the link taken now hits +1 (chain.ts). */
export function wetNow(world: World, e: Vec): boolean { return !!world.params.omenFlood && inWater(e, world.arena); }

// ---------- The link (chain.ts) ----------

/**
 * A link of the drawn chain as it is taken (chain.ts `beginChain`, `dragChain`): «Половодье» marks an enemy whose centre is in water
 * (`wet`), «Перекличка» one of the colour on the roll call (`call`). The marks hold to the end of this chain — the highlight and the
 * dash read the same marks (an enemy that walks out of the water while the focus runs keeps its +1). Neither rule — the link as it is.
 */
export function omenLink(world: World, link: ChainLink, enemy: Enemy | undefined): ChainLink {
  if (link.kind !== 'enemy' || !enemy) return link;
  const wet = wetNow(world, enemy), call = world.params.omenRollcall && world.rollcall?.color !== undefined && enemy.color === world.rollcall.color;
  return wet || call ? { ...link, ...wet ? { wet: true as const } : {}, ...call ? { call: true as const } : {} } : link;
}
/** «Половодье»: the power a link adds before its hit — `omenFloodHit` for a link taken in water (the plan's link, or the dash's id). */
export const wetHit = (world: World, wet: boolean): number => (wet && world.params.omenFlood ? Math.max(0, num(world.params, 'omenFloodHit')) : 0);
/** «Перекличка»: the energy a dash's hit adds over the usual — `omenRollcallEnergy` for a link of the colour called when taken. */
export const callEnergy = (world: World, move: HeroMove, id: number): number => (move.call?.includes(id) ? Math.max(0, num(world.params, 'omenRollcallEnergy')) : 0);
/** The release fixes the marks of the links (`HeroMove.wet`, `.call`; absent when none). */
export function fixOmenLinks(move: HeroMove, links: readonly ChainLink[]): void {
  const wet = links.flatMap(l => (l.kind === 'enemy' && l.wet ? [l.id] : [])), call = links.flatMap(l => (l.kind === 'enemy' && l.call ? [l.id] : []));
  if (wet.length) move.wet = wet;
  if (call.length) move.call = call;
}

// ---------- «Сонный час» ----------

/** «Сонный час»: the newcomers since the last look fall asleep while the sleep lasts (not the reaper, not a boss). */
export function drowseSweep(world: World): void {
  const d = world.drowse;
  if (!d) return;
  if (d.woke === undefined) for (const e of world.enemies) if (e.id >= d.next && omenTarget(e)) e.sleep = true;
  d.next = world.nextId;
}

/** «Сонный час»: every sleeper wakes (`cause`: the first dash, or the time ran out); the woken rage `omenWakeTime` s. */
export function drowseWake(world: World, cause: 'pass' | 'time'): void {
  const d = world.drowse;
  if (!d || d.woke !== undefined) return;
  drowseSweep(world);
  d.woke = world.time;
  const rage = Math.max(0, num(world.params, 'omenWakeTime'));
  let woken = 0;
  for (const e of world.enemies) {
    if (!e.sleep) continue;
    delete e.sleep;
    woken++;
    if (rage > 0) e.rage = rage;
  }
  world.events.push({ type: 'omen', omen: 'drowse', action: 'wake', cause, count: woken });
}

/** «Сонный час»: the walk of a woken enemy in its rage (×`omenWakeWalk`), else 1. */
export function rageFactor(world: World, e: Enemy): number {
  return e.rage !== undefined && e.rage > 0 ? Math.max(0, num(world.params, 'omenWakeWalk')) : 1;
}

// ---------- «Перекличка» ----------

/** «Перекличка»: the touch of `e` is raised (+`omenRollcallTouch`) — its colour is on the roll call. */
export function rollcallTouch(world: World, e: Enemy, damage: number): number {
  const call = world.rollcall?.color;
  return call !== undefined && damage > 0 && e.color === call ? damage + Math.max(0, num(world.params, 'omenRollcallTouch')) : damage;
}

/** «Перекличка»: the colour of the next call — the colours on the arena now (none — the palette), not the last when another is. */
function rollcallColor(world: World, last: number | undefined): number {
  const on = new Set<number>();
  for (const e of world.enemies) if (e.color >= 0 && kindOf(e).chainable) on.add(e.color);
  let colors = on.size ? [...on].sort((a, b) => a - b) : [...palette(world)];
  if (last !== undefined && colors.length > 1) colors = colors.filter(c => c !== last);
  return colors[Math.min(colors.length - 1, Math.floor(world.rng.stream('omen').next() * colors.length))];
}

// ---------- «Гроза» ----------

/** «Гроза»: the point of a mark now — the target enemy with the most targets within `r` (itself counted; a tie — the smaller id). */
export function stormPoint(world: World): { x: number; y: number; count: number } | null {
  const r = Math.max(0, num(world.params, 'omenStormRadius')), targets = world.enemies.filter(omenTarget);
  let best: Enemy | null = null, most = 0;
  for (const e of targets) {
    let count = 0;
    for (const o of targets) if (dhypot(o.x - e.x, o.y - e.y) <= r) count++;
    if (count > most || (count === most && best && e.id < best.id)) { best = e; most = count; }
  }
  return best ? { x: best.x, y: best.y, count: most } : null;
}

/** «Гроза»: the strike of the mark — the enemies whose body touches the circle, then the hero whose centre is in it. */
function stormStrike(world: World, mark: { x: number; y: number }): void {
  const p = world.params, r = Math.max(0, num(p, 'omenStormRadius')), damage = Math.max(0, num(p, 'omenStormDamage'));
  world.events.push({ type: 'omen', omen: 'storm', action: 'strike', x: mark.x, y: mark.y, r });
  const struck = world.enemies.filter(e => omenTarget(e) && dist(e, mark) <= r + bodyRadiusOf(p, e));
  for (const e of struck) damageEnemy(world, e, damage, { source: 'storm', credited: true });
  if (world.status !== 'playing') return;
  const hero = Math.max(0, num(p, 'omenStormHero'));
  if (hero > 0 && dist(world.hero, mark) <= r && bustCanHurt(world)) hurtHero(world, { id: 0 }, hero, 'storm');
}

/** «Гроза»: the mark's count, the mark and its strike (game time). */
function updateStorm(world: World): void {
  const p = world.params;
  const s = world.storm ??= { next: Math.max(0, num(p, 'omenStormFirst')) };
  if (s.mark && world.time >= s.mark.due - 1e-9) {
    const mark = s.mark;
    delete s.mark;
    stormStrike(world, mark);
    if (world.status !== 'playing') return;
  }
  if (s.mark || world.time < s.next - 1e-9) return;
  const point = stormPoint(world);
  if (!point || point.count < Math.max(1, Math.floor(num(p, 'omenStormMin')))) return;
  s.mark = { x: point.x, y: point.y, due: world.time + Math.max(0, num(p, 'omenStormFuse')) };
  s.next = world.time + Math.max(0.1, num(p, 'omenStormEvery'));
  world.events.push({ type: 'omen', omen: 'storm', action: 'mark', x: point.x, y: point.y, r: Math.max(0, num(p, 'omenStormRadius')) });
}

// ---------- The step ----------

/**
 * The omens' step at the start of a tick (world.ts `update`, after the clock): «Сонный час» (the first look, the end of the
 * sleep by time, the rage running out) and «Перекличка» (the call). Nothing while their keys are off.
 */
export function omensEarly(world: World, dt: number): void {
  const p = world.params;
  if (p.omenDrowse || world.drowse) {
    if (p.omenDrowse && !world.drowse) world.drowse = { next: 0 };
    if (world.drowse) {
      if (world.drowse.woke === undefined && world.time >= Math.max(0, num(p, 'omenDrowseTime')) - 1e-9) drowseWake(world, 'time');
      else drowseSweep(world);
    }
    for (const e of world.enemies) if (e.rage !== undefined) { e.rage -= dt; if (e.rage <= 1e-9) delete e.rage; }
  }
  if (p.omenRollcall) {
    const c = world.rollcall ??= { next: Math.max(0, num(p, 'omenRollcallFirst')) };
    if (world.time >= c.next - 1e-9) {
      c.color = rollcallColor(world, c.color);
      c.next = world.time + Math.max(0.1, num(p, 'omenRollcallEvery'));
      world.events.push({ type: 'omen', omen: 'rollcall', action: 'call', color: c.color });
    }
  }
}

/** The omens' step after the blasts and the slot (world.ts `update`): «Гроза». Nothing while its key is off. */
export function omensLate(world: World): void {
  if (world.params.omenStorm) updateStorm(world);
}
