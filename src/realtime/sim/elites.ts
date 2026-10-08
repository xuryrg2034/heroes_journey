/**
 * Elites of the real-time slice (stage 2 of the transition, step 3; docs/realtime-slice.md, section 7) — the modifier of
 * the turn-based game (src/game/elite.ts) over any enemy kind. Numbers — the panel group «Элиты».
 *
 * - **Modifier** (`makeElite`): HP × `eliteHpFactor` (2; a weak enemy, 0 HP, gets 1), art × `eliteArtScale` (1.25 — the
 *   drawing, the link reach edge and the press circle; the body stays), touch + `eliteTouchBonus` (1; world.ts
 *   `touchDamage`), a gold rim (render). Its kind's behaviour is unchanged: an elite shieldbearer keeps its shield.
 * - **Loot** (`eliteDeath`): an elite killed by the player (`credited`: the chain, the spin, a consumable, burning, the
 *   blast of the player's sapper) drops one thing: with `eliteLootChance` (50%) a consumable open in the run (none open —
 *   a crafting resource), otherwise a crafting resource. The kind and the spot read the arena's `loot` stream. It falls
 *   within `eliteLootRadius` of the kill, off walls and trees, other objects and the rest of the dash (as a crystal), and
 *   lies until picked up: by a chain (a link of any colour anywhere in it, as a crystal — no colour change, no power, not
 *   a kill; chain.ts `passObject`) or by the walking hero's touch (`touchLoot`). An elite killed by an enemy's ability (an
 *   arrow, the blast of a sapper lit by touch) drops nothing.
 * - **Start elites**: `StartEnemy.elite` of an arena template (arenas 9–10 of step 4 stand two), the test command
 *   `place {elite}`.
 * - **Random elites** (`rollRandomElite`): a newcomer stepping out of its marker becomes an elite with `eliteChance` (3%)
 *   before the goals and `eliteChanceAfter` (12%) after them, while fewer than `eliteCap` (2) / `eliteCapAfter` (4) elites
 *   live (start elites counted). On in a run from its row 3 (`Kit.randomElites`) and in the sandbox by the toggle
 *   `eliteSandbox`. One draw of the arena's `elite` stream per newcomer that may roll (none at the cap).
 */
import { kindOf } from './enemies/kinds';
import { blockedAt, dist, type Vec } from './geometry';
import { heroRadius } from './params';
import { RESOURCE_KINDS, emptyKit, type ItemKind, type ResourceKind } from './kit';
import { OBJECT_RADIUS, type ArenaObject, type Enemy, type KillCause, type World } from './world';

/** A weak elite (0 HP) gets this HP. */
const ELITE_WEAK_HP = 1;
/** Loot clearance: not this close to the rest of the dash, the hero, other objects. */
const LOOT_CLEARANCE = 0.6;
const LOOT_TRIES = 40;

/** Puts the elite modifier on an enemy (once): HP × factor (a weak one gets 1). Colourless kinds (the reaper) are not elites. */
export function makeElite(world: World, e: Enemy): void {
  if (e.elite || !kindOf(e).chainable || kindOf(e).immune) return;
  e.elite = true;
  e.hp = e.hp > 0 ? Math.round(e.hp * world.params.eliteHpFactor) : ELITE_WEAK_HP;
}

/** Living elites on the arena (start ones counted). */
export const eliteCount = (world: World): number => world.enemies.filter(e => e.elite).length;

/** Random elites are on in this arena: a run from its row 3, or the sandbox toggle. */
export const randomElitesOn = (world: World): boolean => !!world.kit?.randomElites || world.params.eliteSandbox;

/** A newcomer just stepped out of its marker: it may become a random elite (one `elite` draw while under the cap). */
export function rollRandomElite(world: World, e: Enemy): void {
  if (!randomElitesOn(world) || e.elite || !kindOf(e).chainable || kindOf(e).immune) return;
  const p = world.params, after = world.stage === 'greed';
  if (eliteCount(world) >= (after ? p.eliteCapAfter : p.eliteCap)) return;
  if (world.rng.stream('elite').next() >= (after ? p.eliteChanceAfter : p.eliteChance)) return;
  makeElite(world, e);
  world.events.push({ type: 'elite', enemyId: e.id });
}

function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** The rest of the dash as points (hero → links ahead), or just the hero. */
function restOfDash(world: World): Vec[] {
  const path: Vec[] = [{ x: world.hero.x, y: world.hero.y }];
  for (const link of world.move?.kind === 'dash' ? world.move.links : []) {
    const at = link.kind === 'enemy' ? world.enemies.find(e => e.id === link.id) ?? world.move!.fallen?.find(f => f.id === link.id) : world.objects.find(o => o.id === link.id);
    if (at) path.push({ x: at.x, y: at.y });
  }
  return path;
}

/** A free spot for the loot near `at` (off obstacles, objects, the rest of the dash); the kill point when none is found. */
function lootSpot(world: World, at: Vec): Vec {
  const arena = world.arena, radius = world.params.eliteLootRadius, margin = OBJECT_RADIUS, rng = world.rng.stream('loot'), path = restOfDash(world);
  for (let i = 0; i < LOOT_TRIES && radius > 0; i++) {
    const r = radius * Math.sqrt(rng.next()), a = rng.next() * Math.PI * 2;
    const p = { x: Math.min(arena.width - margin, Math.max(margin, at.x + r * Math.cos(a))), y: Math.min(arena.height - margin, Math.max(margin, at.y + r * Math.sin(a))) };
    if (blockedAt(p, OBJECT_RADIUS * 0.6, arena)) continue;
    if (world.objects.some(o => dist(o, p) < LOOT_CLEARANCE + OBJECT_RADIUS)) continue;
    let near = dist(path[0], p) < LOOT_CLEARANCE;
    for (let k = 1; k < path.length && !near; k++) near = segmentDistance(path[k - 1], path[k], p) < LOOT_CLEARANCE;
    if (!near) return p;
  }
  return { x: at.x, y: at.y };
}

/** What the loot of one elite is: 50% a consumable open in the run (none open — a resource), otherwise a resource. */
export function rollLoot(world: World): ItemKind | ResourceKind {
  const rng = world.rng.stream('loot'), open = world.kit?.openItems ?? [];
  const kinds: readonly (ItemKind | ResourceKind)[] = rng.next() < world.params.eliteLootChance && open.length ? open : RESOURCE_KINDS;
  return kinds[Math.floor(rng.next() * kinds.length)];
}

/** An enemy has just died: an elite killed by the player drops its loot on the arena. */
export function eliteDeath(world: World, e: Enemy, cause: KillCause): void {
  if (!e.elite || !cause.credited) return;
  const loot = rollLoot(world), spot = lootSpot(world, e);
  const object: ArenaObject = { id: world.nextId++, kind: 'loot', x: spot.x, y: spot.y, pressed: false, loot, born: world.time };
  world.objects.push(object);
  world.events.push({ type: 'loot', objectId: object.id, loot, x: spot.x, y: spot.y, picked: false });
}

const isItemKind = (kind: string): kind is ItemKind => kind === 'frost' || kind === 'bomb' || kind === 'healing' || kind === 'fire';

/** The hero picks the loot up: a consumable goes to his hand, a resource to the arena's take; it leaves the arena. */
export function pickLoot(world: World, object: ArenaObject): void {
  const index = world.objects.indexOf(object);
  if (index < 0 || object.kind !== 'loot' || !object.loot) return;
  world.objects.splice(index, 1);
  const kit = world.kit ??= emptyKit();
  if (isItemKind(object.loot)) kit.items[object.loot]++; else kit.materials[object.loot]++;
  world.events.push({ type: 'loot', objectId: object.id, loot: object.loot, x: object.x, y: object.y, picked: true });
}

/** The walking hero (not in a dash or a jump) picks up every loot his body touches. */
export function touchLoot(world: World): void {
  if (world.move || world.status !== 'playing' || !world.objects.some(o => o.kind === 'loot')) return;
  const reach = OBJECT_RADIUS + heroRadius(world.params);
  for (const o of world.objects.filter(o => o.kind === 'loot' && dist(o, world.hero) <= reach)) pickLoot(world, o);
}
