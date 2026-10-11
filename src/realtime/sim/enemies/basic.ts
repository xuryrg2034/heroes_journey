/**
 * Prototype kinds that only walk to the hero: the basic enemy and the reaper (the time limit after the goals: fast,
 * colourless, cannot be killed). Behaviour unchanged from the prototype (f27cd4b); the numbers are the debug-panel
 * params. The wolf has its own module since stage 3a (wolf.ts: the ring).
 *
 * Elite behaviour «Ведёт строем» (package «Урон имеет значение», docs/realtime-elite-behaviors.md; the param
 * `eliteBehaviors`, off by default): an elite basic enemy leads up to `eliteLeadCount` (3) weak (0 HP) basic enemies of its
 * colour, the nearest within `eliteLeadRadius` of it. They walk in a column behind it — slot k (0, 1, 2) at (k + 1) ×
 * `eliteLeadSpacing` behind the leader along its heading — a ready chain with the elite in front (towards the hero).
 * - **Who.** Followers are kept while they stay weak, of the leader's colour, not frozen, not knocked, not elite and not
 *   marked; a free slot takes the nearest eligible enemy (distance, then id — no randomness). Slots close up in their order
 *   when a follower leaves (the column stays contiguous, so it stays a chain).
 * - **Walk.** A follower walks straight to its slot when the slot is free of walls and in sight, else straight to the one
 *   ahead of it in the column when that one is in sight, else the common walk (the flow field round walls). It walks at the
 *   faster of its own and the leader's speed, ×`CATCH_UP` while it is more than one spacing off its slot; it never steps
 *   into the hero's touch circle by itself.
 * - **Release.** All followers are released when the leader dies, is frozen or is knocked back (a survivor's knockback);
 *   a frozen leader leads again when it thaws (it picks the nearest again).
 * State in `enemy.vars` of a follower only (absent otherwise — worlds without the behaviour hash as before): `lead` — id of
 * the leader, `rank` — its slot. Distances through `dist` (detMath `dhypot`): the same bits in Node and the browser.
 */
import { dhypot } from '../detMath';
import { dist, lineOfSight, pushOutOfCliffs, pushOutOfObstacles, blockedAt, type Vec } from '../geometry';
import { enemyFrozen, enemyGroundFactor, enemySpeed, touchDistanceOf, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** A follower more than one spacing off its slot walks this much faster (it catches up with the column). */
const CATCH_UP = 1.3;
/** A follower this close to its target stands (no jitter). */
const ARRIVED = 0.02;

const leads = (world: World, e: Enemy): boolean =>
  e.kind === 'basic' && !!e.elite && !enemyFrozen(e) && e.knock <= 0 && world.params.eliteBehaviors;

/** May follow `leader`: a weak basic enemy of its colour, free to walk (not frozen, not knocked), not elite, not marked. */
function mayFollow(e: Enemy, leader: Enemy): boolean {
  return e !== leader && e.kind === 'basic' && !e.elite && !e.marked && e.hp <= 0 && e.color === leader.color && !enemyFrozen(e) && e.knock <= 0;
}

function release(e: Enemy): void { delete e.vars.lead; delete e.vars.rank; }

/** The leader's heading: its walking heading, or towards the hero (it walks to him), or along x. */
function headingOf(world: World, leader: Enemy): Vec {
  const hl = dhypot(leader.headX, leader.headY);
  if (hl > 0.2) return { x: leader.headX / hl, y: leader.headY / hl };
  const h = world.hero, d = dist(leader, h);
  return d > 1e-6 ? { x: (h.x - leader.x) / d, y: (h.y - leader.y) / d } : { x: 1, y: 0 };
}

/**
 * The group step of the basic enemies (once per tick, before anyone moves): who leads, who follows whom in which slot.
 * Without `eliteBehaviors` it only forgets a formation left from a toggle switched off mid-fight.
 */
function formationStep(world: World, members: readonly Enemy[]): void {
  const p = world.params;
  if (!p.eliteBehaviors || world.status !== 'playing') {
    for (const e of members) if (e.vars.lead !== undefined) release(e);
    return;
  }
  const leaders = members.filter(e => leads(world, e));
  const byId = new Map(leaders.map(l => [l.id, l]));
  const columns = new Map<number, Enemy[]>(leaders.map(l => [l.id, []]));
  for (const e of members) {
    if (e.vars.lead === undefined) continue;
    const leader = byId.get(e.vars.lead);
    if (leader && mayFollow(e, leader)) columns.get(leader.id)!.push(e); else release(e);
  }
  const want = Math.max(0, Math.floor(p.eliteLeadCount));
  for (const leader of leaders) {
    const column = columns.get(leader.id)!;
    // Kept followers in their slot order; one too many (the count lowered) leaves from the tail.
    column.sort((a, b) => a.vars.rank - b.vars.rank || a.id - b.id);
    while (column.length > want) release(column.pop()!);
    if (column.length < want) {
      const free = members
        .filter(e => e.vars.lead === undefined && !byId.has(e.id) && mayFollow(e, leader) && dist(e, leader) <= p.eliteLeadRadius + 1e-9)
        .map(e => ({ e, d: dist(e, leader) }))
        .sort((a, b) => a.d - b.d || a.e.id - b.e.id);
      for (const { e } of free.slice(0, want - column.length)) { e.vars.lead = leader.id; column.push(e); }
    }
    column.forEach((e, k) => { e.vars.rank = k; });
  }
}

/** The member ahead of `e` in its column: the follower of the slot before, or the leader. */
function ahead(world: World, e: Enemy, leader: Enemy): Enemy {
  if (e.vars.rank <= 0) return leader;
  return world.enemies.find(x => x.vars.lead === leader.id && x.vars.rank === e.vars.rank - 1) ?? leader;
}

/** Where slot `rank` of `leader`'s column stands now. */
export function formationSlot(world: World, leader: Enemy, rank: number): Vec {
  const h = headingOf(world, leader), s = (rank + 1) * world.params.eliteLeadSpacing;
  return { x: leader.x - h.x * s, y: leader.y - h.y * s };
}

/** A follower's own step: to its slot, or to the one ahead; false — the common walk (no sight: the flow field). */
function stepFollower(world: World, e: Enemy, dt: number): boolean {
  const p = world.params;
  if (!p.eliteBehaviors || e.vars.lead === undefined || e.knock > 0) return false;
  const leader = world.enemies.find(x => x.id === e.vars.lead);
  if (!leader) return false;
  const r = bodyRadiusOf(p, e), arena = world.arena;
  const slot = formationSlot(world, leader, e.vars.rank);
  let target: Vec | null = null, stopAt = 0;
  if (!blockedAt(slot, r, arena) && lineOfSight(e, slot, arena, r * 0.9)) target = slot;
  else {
    const front = ahead(world, e, leader);
    if (lineOfSight(e, front, arena, r * 0.9)) { target = front; stopAt = p.eliteLeadSpacing; }
  }
  if (!target) return false;
  const d = dist(e, target), gap = d - stopAt;
  if (gap <= ARRIVED) return true;
  const speed = Math.max(enemySpeed(world, e), enemySpeed(world, leader)) * (dist(e, slot) > p.eliteLeadSpacing ? CATCH_UP : 1);
  const step = Math.min(speed * enemyGroundFactor(world, e) * dt, gap);
  const dx = (target.x - e.x) / d, dy = (target.y - e.y) / d;
  const next = { x: e.x + dx * step, y: e.y + dy * step };
  // Never into the hero's touch circle by itself (the common walk stops there too); the leader in front meets him first.
  const hero = world.hero, stop = touchDistanceOf(p, e);
  if (dist(next, hero) < stop && dist(next, hero) < dist(e, hero)) return true;
  e.x = next.x; e.y = next.y;
  e.headX = dx; e.headY = dy;
  pushOutOfObstacles(e, r, arena);
  if (arena.terrain) pushOutOfCliffs(e, r, arena);
  return true;
}

/** «Ведёт строем», for the view: the followers of a leading elite in slot order (empty — it leads nobody). */
export function formationOf(world: World, leader: Enemy): Enemy[] {
  if (!world.params.eliteBehaviors) return [];
  return world.enemies.filter(e => e.vars.lead === leader.id).sort((a, b) => a.vars.rank - b.vars.rank || a.id - b.id);
}

/** The id of the elite `e` follows in its column; null — it follows nobody. */
export function leaderOf(world: World, e: Enemy): number | null {
  return world.params.eliteBehaviors && e.vars.lead !== undefined && e.kind === 'basic' ? e.vars.lead : null;
}

registerBehavior({ id: 'basic', beforeStep: (world, members) => formationStep(world, members), step: stepFollower });

registerEnemyKind({
  id: 'basic',
  behavior: 'basic',
  speedClass: 'normal',
  hp: () => null,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});

registerEnemyKind({
  id: 'reaper',
  behavior: 'chase',
  hp: () => 0,
  speed: world => world.params.reaperSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.reaperDamage,
  mass: () => 1,
  spread: false,
  chainable: false,
  hitSource: 'reaper',
  // Cannot be killed: an arrow or a blast does not hurt it either (stage 2 of the transition).
  immune: true,
});
