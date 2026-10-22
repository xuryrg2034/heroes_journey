/**
 * Consumables in the arena (stage 2 of the transition, step 3; docs/realtime-slice.md, section 6): keys 1–4, the target
 * under the pointer, the command `item {kind, x, y}`. Numbers — the panel group «Расходники».
 *
 * | Key | Consumable | Effect |
 * | --- | --- | --- |
 * | 1 | Cold | every enemy whose body touches the circle of `frostRadius` (1.5) at the pointer freezes for `frostTime` (3 s):
 *   stands, does not touch, its mechanic is off (`enemyFrozen`); the next chain hit on it while frozen is ×`frostFactor`. |
 * | 2 | Bomb | the enemy under the pointer within `bombRange` (5) of the hero takes `bombDamage` (6). |
 * | 3 | Healing | +`itemHeal` HP (9 = the turn-based elixir +3 × 3; a run arena always 9 — `rtRunParams`; the build may change it,
 *   build.ts `itemHealOf`), not above the maximum. |
 * | 4 | Fire | the enemy under the pointer and every enemy whose body touches the circle of `fireRadius` (1) around it burn:
 *   `fireDamage` (1) every `fireInterval` (1.5 s), `fireTicks` (3) times. |
 *
 * Rules of step 3:
 * - not during the dash or a jump (`world.move`); while a chain is drawn — allowed (focus goes on);
 * - a consumable is spent only when it acts: a cold or fire with no enemy in reach, a bomb with no enemy under the pointer
 *   or too far, healing at full HP — refused, nothing spent (`itemRefusal` names why; the view shows it at the pointer);
 * - the cold's ×2 is the brittleness of the turn-based game: it doubles the chain and the spin (physical hits) and is
 *   spent by them; a bomb, burning, an arrow or a blast neither double nor spend it (`item`, `effect` sources there);
 * - burning goes on during the dash: a link it wounds on the way only gets easier than the highlight showed;
 * - kills by a bomb and by burning are the player's (`credited`, as the turn-based items and the player's burning):
 *   kill counter, score per kill, the kill goal, a sapper blows up as the player's;
 * - the reaper (`immune`) is not a target: a bomb does not hurt it, cold and fire do not take it;
 * - the cold does not stop the fuse of a dead sapper (a blast of the world, design answer 5 to step 2): only the living
 *   one's fuse waits; a burning enemy burns on while frozen (burning is not its mechanic).
 * - task 57б: the cold and fire act on a rootling's stump (enemies/rootling.ts) by one rule of the target (design 22.10.2026): the
 *   stump under the pointer, within its radius, when no enemy is there. The cold holds its countdown `frostTime`; fire burns it for good
 *   (and the enemies in the fire's circle round it burn). Fire never burns a firebrand: a put-out one lights again
 *   (enemies/firebrand.ts `brandFire`).
 */
import { itemHealOf } from './build';
import { bodyRadiusOf, enemyArtRadius, kindOf } from './enemies/kinds';
import { dist, type Vec } from './geometry';
import { completeGoals, damageEnemy, enemyFrozen, type Enemy, type World } from './world';
import type { ItemKind } from './kit';
import { snuffAround } from './shots';
import { brandFire, brandLit, douse } from './enemies/firebrand';
import { burnStump, chillStump, stumpAt, type Stump } from './enemies/rootling';

/** Why the consumable cannot be used at `p` now (the view shows it); null — it can. */
export type ItemRefusal = 'over' | 'none' | 'move' | 'target' | 'far' | 'full';
export const ITEM_REFUSAL_TEXT: Readonly<Record<ItemRefusal, string>> = {
  over: 'бой окончен',
  none: 'нет в запасе',
  move: 'идёт проход',
  target: 'нет цели',
  far: 'далеко',
  full: 'здоровье полное',
};

/** An enemy the consumables may act on: not the reaper (immune, colourless). */
const affectable = (e: Enemy): boolean => !kindOf(e).immune;

/** The enemy under the pointer: within its drawn circle × the press slack (as a chain press), nearest first. */
export function enemyAt(world: World, p: Vec): Enemy | null {
  let best: Enemy | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    const d = dist(e, p);
    if (d <= enemyArtRadius(world.params, e) * world.params.pickSlack && d < bestD && affectable(e)) { best = e; bestD = d; }
  }
  return best;
}

/** Enemies whose body touches the circle of `radius` at `p` (not the reaper). */
function bodiesInCircle(world: World, p: Vec, radius: number): Enemy[] {
  return world.enemies.filter(e => affectable(e) && dist(e, p) <= radius + bodyRadiusOf(world.params, e));
}

/** What the consumable would act on at `p`: the enemies it takes (cold, bomb, fire) — empty for healing. */
export function itemTargets(world: World, kind: ItemKind, p: Vec): Enemy[] {
  const params = world.params;
  if (kind === 'frost') return bodiesInCircle(world, p, params.frostRadius);
  if (kind === 'healing') return [];
  const target = enemyAt(world, p);
  if (kind === 'bomb') return target && dist(target, world.hero) <= params.bombRange ? [target] : [];
  // Task 57б: no enemy under the pointer — fire may take the stump there (its circle round the stump).
  const center = target ?? (world.stumps?.length ? stumpAt(world, p) : null);
  if (!center) return [];
  const around = bodiesInCircle(world, center, params.fireRadius);
  return target ? [target, ...around.filter(e => e !== target)] : around;
}

/** Task 57б: the stump the cold or fire would act on at `p` — under the pointer, when no enemy is there (one rule for both). */
export function itemStumps(world: World, kind: ItemKind, p: Vec): Stump[] {
  if (!world.stumps?.length || (kind !== 'frost' && kind !== 'fire') || enemyAt(world, p)) return [];
  const s = stumpAt(world, p);
  return s ? [s] : [];
}

/** Why `kind` cannot be used at `p` now; null — it can (playing, not moving, one in hand, something to act on). */
export function itemRefusal(world: World, kind: ItemKind, p: Vec): ItemRefusal | null {
  if (world.status !== 'playing') return 'over';
  if ((world.kit?.items[kind] ?? 0) < 1) return 'none';
  if (world.move) return 'move';
  if (kind === 'healing') return world.hero.hp >= world.hero.maxHp ? 'full' : null;
  if (itemTargets(world, kind, p).length || itemStumps(world, kind, p).length) return null;
  // A bomb on an enemy out of its range: «далеко»; otherwise nothing to act on.
  return kind === 'bomb' && enemyAt(world, p) ? 'far' : 'target';
}

/** Uses the consumable `kind` aimed at `p`. False — refused (`itemRefusal`), nothing spent. */
export function useItem(world: World, kind: ItemKind, p: Vec): boolean {
  if (itemRefusal(world, kind, p)) return false;
  const params = world.params, hero = world.hero, targets = itemTargets(world, kind, p), stumps = itemStumps(world, kind, p);
  world.kit!.items[kind]--;
  if (kind === 'healing') {
    // Phase B (build.ts `itemHealOf`): «Кровавая клятва» weakens it; without a build module — `itemHeal`.
    hero.hp = Math.min(hero.maxHp, hero.hp + itemHealOf(world));
    world.events.push({ type: 'item', kind, x: hero.x, y: hero.y, radius: 0, targets: 0 });
    usedForGoal(world);
    return true;
  }
  if (kind === 'frost') {
    world.events.push({ type: 'item', kind, x: p.x, y: p.y, radius: params.frostRadius, targets: targets.length + stumps.length });
    // Task 57б: a burning firebrand goes out at once — a link of the drawn chain too (design 22.10.2026).
    for (const e of targets) { e.chill = Math.max(e.chill ?? 0, params.frostTime); e.brittle = true; if (brandLit(e)) douse(world, e, 'cold'); }
    for (const s of stumps) chillStump(s, params.frostTime);
    usedForGoal(world);
    return true;
  }
  if (kind === 'bomb') {
    const at = targets[0];
    world.events.push({ type: 'item', kind, x: at.x, y: at.y, radius: 0, targets: 1 });
    // The bombs left tell this use from another one in the same tick (elites.ts `stripPlates`: one firing, one strip).
    damageEnemy(world, at, params.bombDamage, { source: 'bomb', credited: true, firing: world.kit!.items.bomb });
    // Task 57а (`snuffShots`, shots.ts): the light shots round its target are put out (nothing without the key or a shot).
    snuffAround(world, at);
    usedForGoal(world);
    return true;
  }
  // Fire: a new burning replaces what is left of an old one (ticks from the start). Task 57б: its target may be a stump (the centre).
  const at: Vec = stumps[0] ?? targets[0];
  world.events.push({ type: 'item', kind, x: at.x, y: at.y, radius: params.fireRadius, targets: targets.length + stumps.length });
  for (const e of targets) if (!brandFire(world, e)) e.burn = { left: Math.max(1, Math.round(params.fireTicks)), timer: params.fireInterval };
  for (const s of stumps) burnStump(world, s);
  usedForGoal(world);
  return true;
}

/** The prologue, task 9 (goal `item`, the potion room): a consumable used completes the goals (nothing on another arena). */
function usedForGoal(world: World): void {
  if (world.arena.goal === 'item' && world.status === 'playing') completeGoals(world);
}

/** Ticks reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** Burning enemies take their ticks on game time (world.ts `update`, after the blasts): the player's damage, credited. */
export function updateBurning(world: World, dt: number): void {
  if (!world.enemies.some(e => e.burn)) return;
  // Over a copy: a kill (a sapper's fuse, a fallen link) changes the list.
  for (const e of [...world.enemies]) {
    const burn = e.burn;
    if (!burn || !world.enemies.includes(e) || world.status !== 'playing') continue;
    burn.timer -= dt;
    if (burn.timer > TIME_EPS) continue;
    burn.left--;
    if (burn.left > 0) burn.timer += world.params.fireInterval; else delete e.burn;
    damageEnemy(world, e, world.params.fireDamage, { source: 'fire', credited: true });
  }
}

/** The enemy burns now (render). */
export const burning = (e: Enemy): boolean => !!e.burn;
/** The enemy is frozen and brittle: the next chain hit on it is ×`frostFactor` (render, plan). */
export const brittleNow = (e: Enemy): boolean => !!e.brittle && enemyFrozen(e);
