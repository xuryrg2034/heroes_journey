/**
 * Task 55а «Замок: толчок» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 2; docs/realtime-elite-behaviors.md,
 * «Замок: толчок»): the law of the castle — a chain that ends on a thing (the barrel, the wardrobe; enemies/castle.ts) shoves it at the
 * dash's end along the chain's last segment.
 *
 * - **The path** (`shovePath`, one function for the highlight and the dash): the thing — a circle of its body — slides straight on
 *   from where it stands. It stops at the first of: a wall, a tree or the edge (`blockedAt` with its radius, no cliffs; marched by
 *   `PATH_STEP`); a tough body (an enemy with HP ≥ 1 or plates, another thing, a boss core; the circle touches the thing's lane — the
 *   lane is the thing's diameter wide); a cliff (its centre over one: it falls, no strike); the end of its length (the wardrobe —
 *   `shoveDistance`; the barrel — `barrelRoll` at most). The weak (HP 0, no plates) the lane meets before the stop are **crushed**, in
 *   the order of the path. The hero is neither a stop nor a target.
 * - **The strike at the stop:** a tough body — `shoveImpact` (the wardrobe) or `barrelImpact` (the barrel) HP, an armoured one loses a
 *   plate (the law of the elites' armour, `damageEnemy`); a boss core — the same hit (`damageEnemy` decides); the warlock's core (task 55,
 *   stage Д) — `WARLOCK_IMPACT` from any thing, charmed or not, in a window or out of one; a wardrobe at him wears 1, his own breaks; another thing — both lose 1 of their durability; a wall — the wardrobe loses 1. The barrel breaks at any stop; a
 *   thing whose durability reached 0 breaks (it leaves the arena, event `thing` `break` — not a kill).
 * - **The plan is fixed** (the pattern of the garrison's `cuts`): the release fixes the preview (chain.ts, task 55а, its last step) and
 *   the dash's end runs exactly it (`startShove`): the thing slides to the fixed stop at `shoveSpeed` (`world.shoves`, present only while
 *   a thing slides; hashed); each crushed body dies when the thing passes its point (dead already — skipped); the strike lands when the
 *   thing arrives (the stop dead — no strike, the thing still stands at the fixed point and wears as planned). A body that moved during
 *   the dash is still crushed or struck — the price of «highlight = dash» (spec, risk Р1).
 * - **Credit** (design В4): kills of the shove are the player's (`kill` with `source` `shove`, `credited`).
 *
 * - **Task 60а «Замок: гости»** (spec task-60 4.4): the candelabra does not slide — a shove **topples** it (`Topple`): a lane
 *   `candelabraFall` × `FALL_WIDTH` from its centre along the shove (walls cut it); the weak in it are crushed (the player's, as the
 *   shove's), the tough and the elites are untouched; the lane burns `candelabraFire` s (points of the fire trail, `world.trails`);
 *   it breaks. A thing that strikes a candelabra wears it (1 → 0) and topples it along its own way — that topple is in the plan of
 *   that thing (fixed by the release as the rest). A lifted thing (the poltergeist's, `thingLifted`) is no body: a shove passes under it.
 *
 * Events (the view; the rules never read them): `shove` — `start` (the plan), `crush` (a body crushed), `impact` (the strike at the
 * stop: `target`, or the wall), `stop` (the thing stands at its point), `fall` (it fell into a cliff), `cancel` (the dash did not reach
 * it, chain.ts); `thing` `break` (`by`: `wall`, `thing`, `body`, `core`, `end` — the barrel breaks at any stop); `candelabra` `topple`.
 */
import { dhypot } from './detMath';
import { blockedAt, dist, overCliff, type Vec } from './geometry';
import { behaviorOf, bodyRadiusOf, kindOf } from './enemies/kinds';
import { BOSS_CORES } from './enemies/jailer';
import { platesOf } from './elites';
// Task 59а: a recruit out of order is a stop, not a crushed body (the law of order; enemies/recruit.ts).
import { RECRUIT, recruitInOrder } from './enemies/recruit';
import { damageEnemy, killEnemy, pushOutOfSolids, type Enemy, type World } from './world';

export type ShoveStop = 'wall' | 'body' | 'thing' | 'core' | 'cliff' | 'end';

/** The strike at a body or a core: a plate off (`plate`), or `damage` HP (`killed` — it dies). */
export interface ShoveImpact { id: number; damage: number; plate: boolean; killed: boolean }

/** A shove as the highlight shows it and the dash runs it. Distances along the path from the thing's place at the release. */
export interface ShovePlan {
  /** The thing and its kind. */
  thing: number;
  kind: string;
  /** Where it stands at the release, the unit direction, how far it slides and where it stops. */
  from: Vec;
  dir: Vec;
  length: number;
  to: Vec;
  /** What stops it, and the body or thing it stops at (`body`, `thing`, `core`). */
  stop: ShoveStop;
  target?: number;
  /** The weak bodies it crushes, in the order of the path (`at` — the distance where it meets each). */
  crushed: { id: number; at: number }[];
  /** The strike at the body or the core it stops at (none at a wall, a thing, a cliff, the end, or an immune body). */
  impact?: ShoveImpact;
  /** The things' durability after the stop (this thing; and the other one for `thing`). */
  wear: { id: number; left: number }[];
  /** The things that break at the stop (this thing; the other one too when its durability runs out). */
  breaks: number[];
  /**
   * Task 60а: the candelabra that falls at the stop — the shoved one itself (it does not slide: `length` 0), or the one this thing
   * strikes and breaks: its lane (from its centre, the walls cut it) and the weak it crushes (fixed with the plan). Absent — none.
   */
  topple?: Topple;
}

/** Task 60а: a candelabra's fall — its id, its lane (`from` its centre `to` the end, `half` its half width), the weak it crushes. */
export interface Topple { id: number; from: Vec; to: Vec; half: number; crushed: number[] }

/** A shove running (`world.shoves`): its plan, how far the thing has slid and how many of `crushed` have been met. */
export interface Shove extends ShovePlan { run: number; met: number }

/** Step of the march along the path (units; as the crossbow's line). */
export const PATH_STEP = 0.05;
/** The barrel and the wardrobe (enemies/castle.ts; no import: the kinds register after); the warlock's core (enemies/warlock.ts). */
const BARREL = 'barrel';
const WARLOCK = 'warlock';
/** Task 60а: the candelabra (enemies/castleGuests.ts; no import, as the barrel). */
const CANDELABRA = 'candelabra';
/** Task 60а (spec 4.4): the toppled candelabra's lane — its width; its length and its fire (journals without the keys). */
export const FALL_WIDTH = 0.8;
export const CANDELABRA_FALL = 2;
export const CANDELABRA_FIRE = 2;
/** Task 55 §23 «Колдун v1»: his orb — a living shot; no part of the plan (it flies): a sliding thing that meets it kills it, not the player's. */
const WARLOCK_ORB = 'warlock-orb';
/** Task 55, stage Д: a thing's strike at the warlock's core (spec 2.3, 6.2): a plate, none — 1 HP. */
export const WARLOCK_IMPACT = 1;
// ---- Баланс (journals without the keys play these) ----
export const SHOVE_DISTANCE = 3;
export const SHOVE_SPEED = 12;
export const SHOVE_IMPACT = 1;
export const BARREL_ROLL = 16;
export const BARREL_IMPACT = 2;

export const isThing = (e: Pick<Enemy, 'kind'>): boolean => !!kindOf(e as Enemy).thing;
/** Task 60а: a thing the poltergeist holds up or throws (`vars.lf` — its lifter) — no body now: no link, no stop, no cover. */
export const thingLifted = (e: Enemy): boolean => e.vars.lf !== undefined;
/** A thing's durability now (`vars.du`; set when it appears). */
export const durabilityOf = (e: Enemy): number => e.vars.du ?? 0;
/** The law is on (`Params.shove`). */
export const shoveOn = (world: World): boolean => !!world.params.shove;
const lengthOf = (world: World, kind: string): number => Math.max(0, kind === BARREL ? world.params.barrelRoll ?? BARREL_ROLL : world.params.shoveDistance ?? SHOVE_DISTANCE);
const impactOf = (world: World, kind: string): number => Math.max(0, kind === BARREL ? world.params.barrelImpact ?? BARREL_IMPACT : world.params.shoveImpact ?? SHOVE_IMPACT);
const speedOf = (world: World): number => Math.max(0.1, world.params.shoveSpeed ?? SHOVE_SPEED);

/** A body that stops a thing: a thing, a boss core, an enemy with HP ≥ 1 or plates, an immune one (the reaper: no strike). */
function stopKind(e: Enemy): 'thing' | 'core' | 'body' | null {
  if (isThing(e)) return 'thing';
  if (BOSS_CORES.includes(e.kind)) return 'core';
  if (kindOf(e).immune || e.hp >= 1 || platesOf(e) > 0) return 'body';
  return null;
}

/**
 * The path of `thing` shoved along the unit direction `dir` (task 55а, spec 2.3): the same function for the highlight and the dash.
 * Reads the world only (no state, no random draw). `gone` (task 59а) — the chain's links the pass kills before the shove: the law of
 * order counts them dead (as «Прямая»'s `chainKills`).
 */
export function shovePath(world: World, thing: Enemy, dir: Vec, gone?: ReadonlySet<number>): ShovePlan {
  const p = world.params, arena = world.arena, r = bodyRadiusOf(p, thing), from = { x: thing.x, y: thing.y };
  // Task 60а: a candelabra does not slide — it falls along the shove where it stands.
  if (thing.kind === CANDELABRA) {
    return { thing: thing.id, kind: thing.kind, from, dir: { x: dir.x, y: dir.y }, length: 0, to: { ...from }, stop: 'end', crushed: [], wear: [{ id: thing.id, left: 0 }], breaks: [thing.id], topple: toppleOf(world, thing, dir, gone) };
  }
  const most = lengthOf(world, thing.kind);
  // Walls, trees, the edge, a cliff: marched along the path.
  let stopAt = most, stop: ShoveStop = 'end', target: number | undefined;
  for (let t = PATH_STEP; t <= most + 1e-9; t += PATH_STEP) {
    const q = { x: from.x + dir.x * t, y: from.y + dir.y * t };
    if (blockedAt(q, r, arena, false)) { stopAt = Math.max(0, t - PATH_STEP); stop = 'wall'; break; }
    if (arena.terrain && overCliff(q, arena)) { stopAt = t; stop = 'cliff'; break; }
  }
  // Bodies: where the thing's circle first touches each (its lane is the thing's diameter wide); ahead of it only.
  const met: { e: Enemy; at: number; kind: 'thing' | 'core' | 'body' | null }[] = [];
  for (const e of world.enemies) {
    if (e === thing || e.kind === WARLOCK_ORB || thingLifted(e)) continue;
    const rx = e.x - from.x, ry = e.y - from.y, along = rx * dir.x + ry * dir.y, lat = Math.abs(rx * dir.y - ry * dir.x), reach = r + bodyRadiusOf(p, e);
    if (along <= 0 || lat > reach) continue;
    met.push({ e, at: Math.max(0, along - Math.sqrt(Math.max(0, reach * reach - lat * lat))), kind: stopKind(e) });
  }
  met.sort((a, b) => a.at - b.at || a.e.id - b.e.id);
  // Task 59а: the weak recruits ahead are crushed by their numbers — one out of order (counting those crushed before it) stops the thing
  // as a body and is not struck (nothing hurts it out of order); nothing changes without recruits.
  const crushedRecruits = new Set<number>(gone);
  let refused: number | undefined;
  for (const m of met) {
    if (m.at >= stopAt || m.kind !== null) break;
    if (m.e.kind !== RECRUIT) continue;
    if (!recruitInOrder(world, m.e, world.enemies, crushedRecruits)) { m.kind = 'body'; refused = m.e.id; break; }
    crushedRecruits.add(m.e.id);
  }
  const first = met.find(m => m.kind !== null);
  if (first && first.at < stopAt) { stopAt = first.at; stop = first.kind!; target = first.e.id; }
  const crushed = met.filter(m => m.kind === null && m.at < stopAt).map(m => ({ id: m.e.id, at: m.at }));
  // The strike and the wear at the stop.
  const barrel = thing.kind === BARREL, own = durabilityOf(thing);
  let ownLeft = barrel ? 0 : own, impact: ShoveImpact | undefined;
  const wear: { id: number; left: number }[] = [], breaks: number[] = [];
  let topple: Topple | undefined;
  const hit = target !== undefined ? world.enemies.find(e => e.id === target)! : null;
  if (stop === 'wall') ownLeft = barrel ? 0 : own - 1;
  if ((stop === 'body' || stop === 'core') && hit && !kindOf(hit).immune && hit.id !== refused) {
    // Task 55, stage Д: the warlock's core takes 1 (a plate, none — 1 HP) from any thing (spec 2.3, «то же» for the barrel).
    const damage = hit.kind === WARLOCK ? WARLOCK_IMPACT : impactOf(world, thing.kind), plate = platesOf(hit) > 0;
    if (damage > 0) impact = { id: hit.id, damage, plate, killed: !plate && damage >= hit.hp };
    // Task 55, stage Д: a wardrobe at the warlock's core wears 1 (design 21.10.2026); his own wardrobe breaks on him (spec 6.2).
    if (hit.kind === WARLOCK && !barrel) ownLeft = thing.vars.wl === hit.id ? 0 : own - 1;
  }
  if (stop === 'thing' && hit) {
    if (!barrel) ownLeft = own - 1;
    const other = durabilityOf(hit) - 1;
    wear.push({ id: hit.id, left: Math.max(0, other) });
    if (other <= 0) breaks.push(hit.id);
    // Task 60а: a candelabra broken by the strike falls along this thing's way.
    if (other <= 0 && hit.kind === CANDELABRA) topple = toppleOf(world, hit, dir, new Set([...gone ?? [], ...crushed.map(c => c.id)]));
  }
  wear.unshift({ id: thing.id, left: Math.max(0, ownLeft) });
  if (stop !== 'cliff' && ownLeft <= 0) breaks.unshift(thing.id);
  const to = { x: from.x + dir.x * stopAt, y: from.y + dir.y * stopAt };
  return { thing: thing.id, kind: thing.kind, from, dir: { x: dir.x, y: dir.y }, length: stopAt, to, stop, ...target !== undefined ? { target } : {}, crushed, ...impact ? { impact } : {}, wear, breaks, ...topple ? { topple } : {} };
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/**
 * Task 60а (spec 4.4): the fall of `candelabra` along the unit `dir` — its lane from its centre, `candelabraFall` long (the first wall or
 * tree cuts it, marched by `PATH_STEP`), `FALL_WIDTH` wide; the weak in it now (HP 0, no plates; not a thing, a core or an immune body; a
 * recruit out of order is spared — the law of order) are crushed. `gone` — bodies dead by then (the pass, the shove before it). Reads
 * the world only (the highlight and the release read the same).
 */
export function toppleOf(world: World, candelabra: Enemy, dir: Vec, gone?: ReadonlySet<number>): Topple {
  const p = world.params, from = { x: candelabra.x, y: candelabra.y }, most = Math.max(0, p.candelabraFall ?? CANDELABRA_FALL), half = FALL_WIDTH / 2;
  let len = most;
  for (let t = PATH_STEP; t <= most + 1e-9; t += PATH_STEP) if (blockedAt({ x: from.x + dir.x * t, y: from.y + dir.y * t }, 0.02, world.arena, false)) { len = Math.max(0, t - PATH_STEP); break; }
  const to = { x: from.x + dir.x * len, y: from.y + dir.y * len }, dead = new Set<number>(gone);
  const crushed: number[] = [];
  for (const e of world.enemies) {
    if (e === candelabra || dead.has(e.id) || e.kind === WARLOCK_ORB || thingLifted(e) || stopKind(e) !== null || segmentDistance(from, to, e) > half + bodyRadiusOf(p, e)) continue;
    if (e.kind === RECRUIT && !recruitInOrder(world, e, world.enemies, dead)) continue;
    if (e.kind === RECRUIT) dead.add(e.id);
    crushed.push(e.id);
  }
  return { id: candelabra.id, from, to, half, crushed };
}

/**
 * Task 60а: the candelabra falls (the arrival of its shove, or of the thing that broke it): the planned weak die — the player's kills
 * (`shove`, credited; dead already — skipped); its lane burns (fire trail points `trailRadius` apart, `candelabraFire` s). Its break is
 * the plan's (`breaks`).
 */
function fall(world: World, t: Topple): void {
  world.events.push({ type: 'candelabra', action: 'topple', id: t.id, x: t.from.x, y: t.from.y, x1: t.to.x, y1: t.to.y });
  for (const id of t.crushed) {
    const victim = world.enemies.find(e => e.id === id);
    if (!victim) continue;
    world.events.push({ type: 'shove', action: 'crush', thingId: t.id, x: victim.x, y: victim.y, target: victim.id });
    killEnemy(world, victim, { source: 'shove', credited: true });
    if (world.status !== 'playing') return;
  }
  const p = world.params, life = Math.max(0.05, p.candelabraFire ?? CANDELABRA_FIRE), step = Math.max(0.05, p.trailRadius);
  const dx = t.to.x - t.from.x, dy = t.to.y - t.from.y, len = dhypot(dx, dy);
  if (len > 1e-9) for (let d = Math.min(step / 2, len); d <= len + 1e-9; d += step) world.trails.push({ x: t.from.x + dx / len * d, y: t.from.y + dy / len * d, life, ownerId: t.id });
}

/** The thing is sliding now, or a sliding thing is about to strike it (the refusal «в движении», chain.ts). */
export function sliding(world: World, id: number): boolean {
  return !!world.shoves?.some(s => s.thing === id || (s.stop === 'thing' && s.target === id));
}

/** The dash's end runs a fixed plan (the field `world.shoves` appears with it). The thing gone — nothing. */
export function startShove(world: World, plan: ShovePlan): void {
  const thing = world.enemies.find(e => e.id === plan.thing);
  if (!thing || world.status !== 'playing') return;
  // The kind's own reaction (`EnemyBehavior.onShoved`: the wardrobe drops its topple). No registry here: shove.ts loads world.ts, which
  // loads the kinds — a registry of this module would not be ready when a kind registers (the cycle of task 57а).
  behaviorOf(thing).onShoved?.(world, thing);
  (world.shoves ??= []).push({ ...JSON.parse(JSON.stringify(plan)) as ShovePlan, run: 0, met: 0 });
  world.events.push({ type: 'shove', action: 'start', thingId: plan.thing, x: plan.from.x, y: plan.from.y, x1: plan.to.x, y1: plan.to.y, stop: plan.stop, ...plan.target !== undefined ? { target: plan.target } : {} });
}

/** A thing leaves the arena: broken (`thing` `break`) or fallen (`shove` `fall`) — not a kill. */
export function removeThing(world: World, thing: Enemy, by: ShoveStop | 'fall'): void {
  const i = world.enemies.indexOf(thing);
  if (i < 0) return;
  world.enemies.splice(i, 1);
  if (by === 'fall') world.events.push({ type: 'shove', action: 'fall', thingId: thing.id, x: thing.x, y: thing.y });
  else world.events.push({ type: 'thing', action: 'break', id: thing.id, x: thing.x, y: thing.y, by });
}

/** The thing arrived: the strike, the wear, the breaks. */
function arrive(world: World, s: Shove, thing: Enemy): void {
  world.events.push({ type: 'shove', action: 'stop', thingId: s.thing, x: s.to.x, y: s.to.y, stop: s.stop, ...s.target !== undefined ? { target: s.target } : {} });
  if (s.stop === 'cliff') { removeThing(world, thing, 'fall'); return; }
  const target = s.target !== undefined ? world.enemies.find(e => e.id === s.target) : undefined;
  if (s.impact && target) {
    world.events.push({ type: 'shove', action: 'impact', thingId: s.thing, x: target.x, y: target.y, target: target.id });
    damageEnemy(world, target, s.impact.damage, { source: 'shove', credited: true, plates: 1, firing: s.thing });
  } else if (s.stop === 'wall' || (s.stop === 'thing' && target)) world.events.push({ type: 'shove', action: 'impact', thingId: s.thing, x: s.to.x, y: s.to.y, ...target ? { target: target.id } : {} });
  if (world.status !== 'playing') return;
  for (const w of s.wear) { const t = world.enemies.find(e => e.id === w.id); if (t) t.vars.du = w.left; }
  // Task 60а: the plan's candelabra falls before it breaks (none — nothing).
  if (s.topple && world.enemies.some(e => e.id === s.topple!.id)) { fall(world, s.topple); if (world.status !== 'playing') return; }
  for (const id of s.breaks) { const t = world.enemies.find(e => e.id === id); if (t) removeThing(world, t, s.stop); }
}

/**
 * The shoves' step (world.ts `update`, after the enemies moved, before the parting): each thing slides on (game time), crushes the
 * bodies it passes, arrives and strikes. The hero is put out of a thing that slid onto him (solid bodies, task 48). Nothing without a
 * shove.
 */
export function updateShoves(world: World, dt: number): void {
  const list = world.shoves;
  if (!list?.length || world.status !== 'playing') return;
  const speed = speedOf(world);
  for (const s of [...list]) {
    const thing = world.enemies.find(e => e.id === s.thing);
    if (!thing) { list.splice(list.indexOf(s), 1); continue; }
    s.run = Math.min(s.length, s.run + speed * dt);
    thing.x = s.from.x + s.dir.x * s.run; thing.y = s.from.y + s.dir.y * s.run;
    // Task 55 §23: the warlock's orbs it meets die, not the player's kills (nothing without an orb).
    for (const orb of world.enemies.filter(e => e.kind === WARLOCK_ORB && dist(e, thing) < bodyRadiusOf(world.params, thing) + bodyRadiusOf(world.params, e))) {
      killEnemy(world, orb, { source: 'shove', credited: false });
      if (world.status !== 'playing') return;
    }
    while (s.met < s.crushed.length && s.crushed[s.met].at <= s.run + 1e-9) {
      const c = s.crushed[s.met++], victim = world.enemies.find(e => e.id === c.id);
      if (!victim) continue;
      world.events.push({ type: 'shove', action: 'crush', thingId: s.thing, x: victim.x, y: victim.y, target: victim.id });
      killEnemy(world, victim, { source: 'shove', credited: true });
      if (world.status !== 'playing') return;
    }
    if (s.run >= s.length - 1e-9) { list.splice(list.indexOf(s), 1); arrive(world, s, thing); if (world.status !== 'playing') return; }
  }
  if (!list.length) delete world.shoves;
  pushOutOfSolids(world, world.hero);
}
