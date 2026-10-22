/**
 * Task 57б «Лес: механики», «Корневик» (`rootling`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 6.1). A presser that
 * rises from its stump: cut the whole group at once.
 *
 * **Body.** HP 0 (Д8), speed class `slow`, touch 1, never an elite. **The group** — the formation it came in (`vars.fm`: a template's
 * `StartEnemy.formation`, a roster's `NewcomerShare.group` of one colour), kept as `vars.rg` by a risen one; none — it is a group of one.
 * At most `ROOT_GROUPS_MAX` groups on the arena (alive, lying, at markers, in the queue).
 *
 * **Stump.** Killed by anything but fire (the fire consumable's burning) or a fall, it lies as a stump where it
 * died (`world.stumps`, event `stump` `lie`): no link, no wall, no body; the cold and fire act on it. After `rootRise` s (5) it rises —
 * a new enemy (a new id, no spawn, no draw) of its group and colour, HP 0, where the stump lay (event `rise`). The countdown waits while
 * the stump is frozen (the cold consumable aimed at it: `frostTime`) and while the hero's move runs (highlight = the pass); the hero on
 * the stump keeps it down until he steps off. **Every rootling of a group lies at once** (none alive, none at a marker or in the queue)
 * — every stump of the group crumbles for good (event `crumble`). Fire aimed at a stump burns it for good (event `burn`): the group
 * needs it no more. Killed by fire, it lies for good with no stump.
 *
 * **Credit** (Д7): the world's credit of a kill — the kill counter, the score of a kill outside the chain, the bag, the cauldron, the
 * curse, the marked, the telemetry's kill (the `kill` event carries `stump`; `crumble` and `burn` carry `paid`) — waits on the stump and
 * comes when it crumbles or burns; a stump that rises drops it (rising gives no endless kills). The chain's own count is at once: the
 * link's power, the dash's kills (length, combo, the counters' chain rules, the chain shield), the energy of the hit, the chain's score,
 * the cheque. A rise is no refill: no marker, no draw, the arena's limit does not hold it (the stump's place is a member's).
 *
 * **The cold and fire on a stump** — one rule of the target (items.ts): the stump under the pointer, within its radius, when no enemy
 * is there.
 *
 * **Highlight.** The drawn chain after which every living rootling of a group lies (its pass's kills: the links, the pierce, the
 * shadows of the dash's end, the return run) shows «рассыплются» on the group's stumps and those links (chain.ts `ChainPlan.crumble`).
 */
import { bagKill } from '../bag';
import { curseKill } from '../chest';
import { dist, overCliff } from '../geometry';
import { enemyBodyRadius, heroRadius } from '../params';
import { purseKill } from '../purse';
import { checkGoals, type Enemy, type KillCause, type World } from '../world';
import { fireSource } from './firebrand';
import { registerEnemyKind } from './kinds';

export const ROOTLING = 'rootling';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the key play these) ----
export const ROOT_RISE = 5;
/** Groups of rootlings on the arena at most (alive, lying, at markers, in the queue). */
export const ROOT_GROUPS_MAX = 2;
const TIME_EPS = 1e-9;

/** What a stump's kill owes the world (counted when it crumbles or burns). */
export interface StumpCredit {
  source: string;
  credited?: true;
  /** Killed by the chain's link (the chain's own count was at once; the curse waits). */
  chain?: true;
  /** A link of the dash ahead killed outside the chain (its score comes with the chain's). */
  link?: true;
  marked?: true;
}

/** A lying rootling: its id (the dead one's), place, group, colour, countdown, personal speed, the cold on it, the credit it owes. */
export interface Stump { id: number; x: number; y: number; group: number; color: number; left: number; full: number; speed: number; chill?: number; credit: StumpCredit }

export const riseOf = (world: World): number => Math.max(0, world.params.rootRise ?? ROOT_RISE);

/** The group of a rootling: kept by a risen one (`rg`), else its formation (`fm`), else itself. */
export const rootGroup = (e: Pick<Enemy, 'id' | 'vars'>): number => e.vars.rg ?? e.vars.fm ?? e.id;

/** The stump's radius: the rootling's body (×1). */
const stumpRadius = (world: World): number => enemyBodyRadius(world.params);

/** The rootling's group has a member to come (at a marker or in the queue) — a group of a roster's formation. */
function pending(world: World, group: number): boolean {
  return world.markers.some(m => m.kind === ROOTLING && m.formation === group) || world.queue.some(q => q.kind === ROOTLING && q.formation === group);
}

/** Groups on the arena now: alive, lying, at markers, in the queue (a newcomer without a formation counts as its own). */
function groupsNow(world: World): number {
  const groups = new Set<string>();
  for (const e of world.enemies) if (e.kind === ROOTLING) groups.add(`g${rootGroup(e)}`);
  for (const s of world.stumps ?? []) groups.add(`g${s.group}`);
  world.markers.forEach(m => { if (m.kind === ROOTLING) groups.add(m.formation !== undefined ? `g${m.formation}` : `m${m.id}`); });
  world.queue.forEach((q, i) => { if (q.kind === ROOTLING) groups.add(q.formation !== undefined ? `g${q.formation}` : `q${i}`); });
  return groups.size;
}

/**
 * A rootling just died (world.ts `killEnemy`, chain.ts `hitEnemy`): it lies as a stump (true) — the caller keeps the world's credit
 * of the kill off, the stump owes it. False — no stump (not a rootling, fire, a fall): the kill counts as usual.
 */
export function lieDown(world: World, e: Enemy, cause: KillCause, how: { chain?: boolean; link?: boolean } = {}): boolean {
  if (e.kind !== ROOTLING || fireSource(cause.source) || cause.fall || (world.arena.terrain && overCliff(e, world.arena))) return false;
  const full = riseOf(world);
  const credit: StumpCredit = { source: cause.source, ...cause.credited ? { credited: true as const } : {}, ...how.chain ? { chain: true as const } : {}, ...how.link ? { link: true as const } : {}, ...e.marked ? { marked: true as const } : {} };
  (world.stumps ??= []).push({ id: e.id, x: e.x, y: e.y, group: rootGroup(e), color: e.color, left: full, full, speed: e.speedFactor, credit });
  world.events.push({ type: 'stump', action: 'lie', id: e.id, x: e.x, y: e.y, group: rootGroup(e) });
  return true;
}

/** The credit a stump owed (it crumbled or burnt): the kill counter, the score, the bag, the curse, the cauldron, the marked. */
function payStump(world: World, s: Stump): void {
  const c = s.credit, outside = !c.chain && !c.link;
  if (c.credited) {
    world.stats.kills++;
    if (outside) world.stats.score += world.params.scorePerKill;
    if (world.bag) bagKill(world);
    if (c.chain && world.curse) curseKill(world);
  }
  if (outside) purseKill(world, { source: c.source, credited: !!c.credited });
  if (c.marked) world.stats.markedKills++;
}

/** The kill a stump pays (the telemetry counts it then): its source and whether it was the player's. */
const paidOf = (s: Stump): { source: string; credited: boolean } => ({ source: s.credit.source, credited: !!s.credit.credited });

/** Every group that lies whole now (no rootling of it alive or to come) crumbles: its stumps go, their credit comes. */
export function settleStumps(world: World): void {
  const stumps = world.stumps;
  if (!stumps?.length || world.status !== 'playing') return;
  const alive = new Set(world.enemies.flatMap(e => (e.kind === ROOTLING ? [rootGroup(e)] : [])));
  const whole = [...new Set(stumps.map(s => s.group))].filter(g => !alive.has(g) && !pending(world, g));
  if (!whole.length) return;
  for (const g of whole) {
    const gone = stumps.filter(s => s.group === g);
    world.stumps = world.stumps!.filter(s => s.group !== g);
    for (const s of gone) payStump(world, s);
    world.events.push({ type: 'stump', action: 'crumble', group: g, ids: gone.map(s => s.id), paid: gone.map(paidOf), x: gone[0].x, y: gone[0].y });
  }
  checkGoals(world);
}

/** Fire on the stump: it burns for good (its credit comes), its group needs it no more. */
export function burnStump(world: World, s: Stump): void {
  if (!world.stumps?.includes(s)) return;
  world.stumps = world.stumps.filter(x => x !== s);
  payStump(world, s);
  world.events.push({ type: 'stump', action: 'burn', id: s.id, x: s.x, y: s.y, group: s.group, paid: [paidOf(s)] });
  checkGoals(world);
  settleStumps(world);
}

/** The cold on the stump: its countdown waits `seconds` (the longer cold stays). */
export function chillStump(s: Stump, seconds: number): void { s.chill = Math.max(s.chill ?? 0, seconds); }

/** The stump under the point `p` (within its radius; the nearest, the first of equals); null — none. */
export function stumpAt(world: World, p: { x: number; y: number }): Stump | null {
  const r = stumpRadius(world);
  let best: Stump | null = null;
  for (const s of world.stumps ?? []) if (dist(s, p) <= r && (!best || dist(s, p) < dist(best, p))) best = s;
  return best;
}

const heroOn = (world: World, s: Stump): boolean => dist(world.hero, s) < stumpRadius(world) + heroRadius(world.params);

function rise(world: World, s: Stump): void {
  world.stumps = world.stumps!.filter(x => x !== s);
  const e: Enemy = {
    id: world.nextId++, kind: ROOTLING, x: s.x, y: s.y, color: s.color, hp: 0, marked: !!s.credit.marked, speedFactor: s.speed,
    brake: 0, age: 0, strikeFlash: 0, hurtFlash: 0, knock: 0, knockVx: 0, knockVy: 0,
    boar: 'walk', boarTimer: 0, dirX: 0, dirY: 0, charged: 0, headX: 0, headY: 0, vars: { rg: s.group },
  };
  world.enemies.push(e);
  world.events.push({ type: 'stump', action: 'rise', id: s.id, riseId: e.id, x: s.x, y: s.y, group: s.group });
}

/**
 * The stumps' step (world.ts `update`, after the burning and the pitch): the cold thaws; the countdown runs (not while frozen, not while the hero's move runs); a stump at 0 rises once the hero is off it; whole groups crumble.
 */
export function updateStumps(world: World, dt: number): void {
  if (!world.stumps || world.status !== 'playing') return;
  for (const s of [...world.stumps]) {
    if (s.chill !== undefined) { s.chill -= dt; if (s.chill <= TIME_EPS) delete s.chill; }
    if (world.move || s.chill !== undefined) continue;
    if (s.left > TIME_EPS) { s.left = Math.max(0, s.left - dt); if (s.left > TIME_EPS) continue; }
    if (!heroOn(world, s)) rise(world, s);
  }
  settleStumps(world);
}

/**
 * The drawn chain's crumble (chain.ts `planChain`): the groups whose every living rootling `killed` takes (the pass's kills) and that
 * have none to come — their stumps (`stumps`, ids) and the members the pass kills (`links`). Pure.
 */
export function planCrumble(world: World, killed: ReadonlySet<number>): { group: number; stumps: number[]; links: number[] }[] {
  const groups = new Map<number, Enemy[]>();
  for (const e of world.enemies) if (e.kind === ROOTLING) { const g = rootGroup(e), list = groups.get(g); if (list) list.push(e); else groups.set(g, [e]); }
  const out: { group: number; stumps: number[]; links: number[] }[] = [];
  for (const [group, members] of groups) {
    if (!members.every(e => killed.has(e.id)) || pending(world, group)) continue;
    out.push({ group, stumps: (world.stumps ?? []).filter(s => s.group === group).map(s => s.id), links: members.map(e => e.id) });
  }
  return out;
}

/**
 * The stumps now (the view): place, group, colour, the countdown left and full, and why it waits — `cold`, `move` (the hero's move),
 * `hero` (he stands on it, its countdown over); null — it counts down.
 */
export function stumpState(world: World): { id: number; x: number; y: number; group: number; color: number; left: number; full: number; waiting: 'cold' | 'move' | 'hero' | null }[] {
  return (world.stumps ?? []).map(s => ({
    id: s.id, x: s.x, y: s.y, group: s.group, color: s.color, left: s.left, full: s.full,
    waiting: s.chill !== undefined ? 'cold' as const : world.move ? 'move' as const : s.left <= TIME_EPS && heroOn(world, s) ? 'hero' as const : null,
  }));
}

registerEnemyKind({
  id: ROOTLING, behavior: 'chase', speedClass: 'slow', hp: () => 0, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: ROOTLING,
  noElite: true,
  capped: world => groupsNow(world) >= (world.arena.kindCaps?.[ROOTLING] ?? ROOT_GROUPS_MAX),
});
