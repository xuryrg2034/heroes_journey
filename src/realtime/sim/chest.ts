/**
 * К7 «Проклятый сундук» (docs/realtime-casino.md, «Проклятый сундук (К7)»; docs/realtime-casino-research.md, К7; design
 * decisions 12.10.2026). `Params.cursedChest`; off — no chest, no `world.curse` (worlds hash as before).
 *
 * - The chest stands at the arena's authored point (`ArenaTemplate.chest`: only «Застава») from the start of the fight. It is
 *   always there — no chance.
 * - Taken by a chain as a pass-through link, as an elite's loot (chain.ts `passObject`): any colour, anywhere in the chain,
 *   no power, no embers, no colour change, not a kill; the hero takes its spot and the chain goes on. The walking hero takes
 *   it by touch too (not in a dash or a jump; a jump that lands on it takes it on the next tick, as the loot).
 * - Taken, the curse starts at once: +`CHEST_CURSE_TOUCH` to every touch of an enemy (world.ts `touchDamage`) — not the
 *   reaper's; arrows, quills, blasts, thorns, the boar's charge, the lynx's leap, the goblin's arrows and the fire trail are
 *   not touches and get nothing. The curse is lifted by `CHEST_CURSE_KILLS` kills of the dash (chain.ts `hitEnemy`: no
 *   hammers, no goblin, no wave, no link that died on the way); otherwise it lasts to the end of the fight.
 * - The reward is the run's (run/rtRun.ts): after a won fight with the chest taken (lifted or not) a talisman screen of its
 *   own follows the «Застава» talismans. The simulation keeps only the fact (`world.curse`).
 */
import { OBJECT_RADIUS, type ArenaObject, type Enemy, type World } from './world';
import { dist } from './geometry';
import { heroRadius } from './params';
import { kindOf } from './enemies/kinds';

/** Баланс (design 12.10.2026; research К7 with the correction «+1, не +2»): kills of the dash that lift the curse. */
export const CHEST_CURSE_KILLS = 12;
/** Баланс (design 12.10.2026): what the curse adds to a touch. */
export const CHEST_CURSE_TOUCH = 1;

/**
 * The curse of the fight (`world.curse`, absent until the chest is taken): `tick` — when it was taken, `by` — a chain link or
 * a touch, `kills` — kills of the dash since (at most `CHEST_CURSE_KILLS`), `lifted` — the tick the curse was lifted (absent
 * while it lasts). Present to the end of the fight: the run reads it as «the chest was taken».
 */
export interface CurseState { tick: number; by: 'chain' | 'touch'; kills: number; lifted?: number }

/** The chest of the arena at the start of the fight: the template's point, while the rule is on. */
export function placeChest(world: World): void {
  const at = world.arena.chest;
  if (!world.params.cursedChest || !at) return;
  world.objects.push({ id: world.nextId++, kind: 'chest', x: at.x, y: at.y, pressed: false });
}

/** The curse is on now: the chest was taken and the dash has not killed `CHEST_CURSE_KILLS` since. */
export function cursed(world: World): boolean { return !!world.curse && world.curse.lifted === undefined; }

/** The hero takes the chest (a chain link or a touch): it leaves the arena, the curse starts. */
export function takeChest(world: World, object: ArenaObject, by: CurseState['by']): void {
  const index = world.objects.indexOf(object);
  if (index < 0 || object.kind !== 'chest') return;
  world.objects.splice(index, 1);
  // One chest a fight; a second one (none on any arena) would not start the curse again.
  world.curse ??= { tick: world.tick, by, kills: 0 };
  world.events.push({ type: 'chest', objectId: object.id, x: object.x, y: object.y, by });
}

/** The walking hero (not in a dash or a jump) takes the chest his body touches. */
export function touchChest(world: World): void {
  if (world.move || world.status !== 'playing' || !world.objects.some(o => o.kind === 'chest')) return;
  const reach = OBJECT_RADIUS + heroRadius(world.params);
  for (const o of world.objects.filter(o => o.kind === 'chest' && dist(o, world.hero) <= reach)) takeChest(world, o, 'touch');
}

/** A kill of the dash (chain.ts `hitEnemy`) counts toward lifting the curse. */
export function curseKill(world: World): void {
  const curse = world.curse;
  if (!curse || curse.lifted !== undefined) return;
  curse.kills++;
  if (curse.kills < CHEST_CURSE_KILLS) return;
  curse.lifted = world.tick;
  world.events.push({ type: 'curseLifted', kills: curse.kills });
}

/** The touch of `e` with the curse: +`CHEST_CURSE_TOUCH` to a touch that hurts, not the reaper's (an immune kind). */
export function curseTouch(world: World, e: Enemy, damage: number): number {
  return damage > 0 && cursed(world) && !kindOf(e).immune ? damage + CHEST_CURSE_TOUCH : damage;
}
