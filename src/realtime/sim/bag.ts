/**
 * Task 14 «Котомка у двери» (user decision 13.10.2026; docs/realtime-slice.md, «Котомка у двери»): a reason to stay after
 * the goals. When the goals open the door the bag appears (`world.bag`). The player's credited kills after that moment fill
 * three steps — `bagStep1`…`bagStep3` kills in all (10, 20, 35) worth `bagReward1`…`bagReward3` resources (1, 2, 3; 6 in all).
 * A real HP loss of the hero (a touch, an arrow, a blast, the goblin's bust, the porcupine's quills…) sends the progress of
 * the unfilled step back to its start; filled steps are never lost. A hit the hero does not feel (invulnerability, the
 * after-chain shield, «Щит фокуса», the dash) never reaches `hurtHero` and resets nothing. The door pays the filled steps:
 * resource kinds of the arena's stream `bag` (a new stream: the others do not shift), recorded in `world.bag.paid`; a defeat
 * pays nothing.
 *
 * Off by default (`Params.doorBag`); journals without the key play as before: no `world.bag`, no `bag` events, the stream is
 * never touched. A run turns it on (run/rtRun.ts `RT_RUN_FORCED`); its fights of row 1 (`RT_BAG_ROW` 2), the Jailer's and the final fight carry `Loadout.noBag`; the
 * prologue keeps it off (run/prologue.ts `prologueParams`).
 *
 * Counted kills: the same credit as the player's kill counter (`world.stats.kills`: the chain, the build, a sapper's blast set
 * off by the chain, the goblin's arrows and its bust blast — `credited`); an enemy's ability, a fall by the crowd's pushing
 * and an enemy that leaves by itself do not count. The kill that completes the goals is before the bag (it opened the door).
 * Type-only imports from world.ts: world.ts and chain.ts call this module at run time.
 */
import { RESOURCE_KINDS, type ResourceKind } from './kit';
import type { World } from './world';

/** The bag of the fight (`World.bag`; present only from the goals of a fight with the rule on — hashed only when present). */
export interface BagWorld {
  /** Kills counted toward the steps since the goals (a reset sends them back to the start of the unfilled step). */
  kills: number;
  /** Filled steps, 0–3. */
  step: number;
  /** Resets: hits that took progress off the unfilled step. */
  resets: number;
  /** What the door paid (resource kinds and counts); absent until the hero goes through the door with a filled step. */
  paid?: Partial<Record<ResourceKind, number>>;
}

/** The number of steps. */
export const BAG_STEPS = 3;

/** The rule acts in this world: `doorBag` on and the fight not marked `noBag` (the run's row 1, the Jailer's and the final fight). */
export function bagOn(world: World): boolean { return !!world.params.doorBag && !world.kit?.noBag; }

const whole = (v: unknown, fallback: number): number => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : fallback;
};

/** Kills after the goals that fill steps 1, 2, 3 (cumulative, never decreasing: a smaller value is raised to the one before). */
export function bagThresholds(world: World): number[] {
  const p = world.params, raw = [whole(p.bagStep1, 10), whole(p.bagStep2, 20), whole(p.bagStep3, 35)];
  const out: number[] = [];
  for (const v of raw) out.push(Math.max(1, v, out.length ? out[out.length - 1] : 0));
  return out;
}

/** Resources of steps 1, 2, 3. */
export function bagRewards(world: World): number[] {
  const p = world.params;
  return [whole(p.bagReward1, 1), whole(p.bagReward2, 2), whole(p.bagReward3, 3)];
}

/** Resources the filled steps of the bag are worth now (the door pays this many). */
export function bagTotal(world: World): number {
  const bag = world.bag;
  if (!bag) return 0;
  return bagRewards(world).slice(0, bag.step).reduce((a, b) => a + b, 0);
}

/** Where the unfilled step stands, for the view: its kills from / to, the kills now, its reward; null — no bag. */
export interface BagProgress {
  /** Filled steps, 0–3. */
  step: number;
  /** Kills counted since the goals. */
  kills: number;
  /** The unfilled step's start and end in kills (`to` null — all steps filled). */
  from: number; to: number | null;
  /** Resources of the unfilled step (null — all filled) and of the filled ones together. */
  reward: number | null; total: number;
}
export function bagProgress(world: World): BagProgress | null {
  const bag = world.bag;
  if (!bag) return null;
  const t = bagThresholds(world), r = bagRewards(world), full = bag.step >= BAG_STEPS;
  return {
    step: bag.step, kills: bag.kills, from: bag.step > 0 ? t[bag.step - 1] : 0, to: full ? null : t[bag.step],
    reward: full ? null : r[bag.step], total: bagTotal(world),
  };
}

/** The goals opened the door (world.ts `completeGoals`): the bag appears. Event `bag` `appear`. */
export function bagAppear(world: World): void {
  if (!bagOn(world) || world.bag) return;
  world.bag = { kills: 0, step: 0, resets: 0 };
  world.events.push({ type: 'bag', action: 'appear', step: 0 });
}

/**
 * A credited kill after the goals (chain.ts `hitEnemy`, world.ts `killEnemy`): +1 toward the unfilled step; reaching its
 * end fills it (event `bag` `step` with its reward). Kills after the last step still count (telemetry), nothing more fills.
 */
export function bagKill(world: World): void {
  const bag = world.bag;
  if (!bag || world.status !== 'playing') return;
  bag.kills++;
  const t = bagThresholds(world), r = bagRewards(world);
  while (bag.step < BAG_STEPS && bag.kills >= t[bag.step]) {
    bag.step++;
    world.events.push({ type: 'bag', action: 'step', step: bag.step, reward: r[bag.step - 1] });
  }
}

/**
 * The hero lost HP (world.ts `hurtHero`, after «Пепельный оберег»: `lost` — HP actually gone): the unfilled step goes back to
 * its start. Nothing to take (no progress on it, or every step filled) — no change. Event `bag` `reset`.
 */
export function bagHurt(world: World, lost: number): void {
  const bag = world.bag;
  if (!bag || lost <= 0) return;
  // Task 56 «Урожай» (`Params.bagResetAll`): every step goes, the filled ones too (nothing to take — no progress at all).
  if (world.params.bagResetAll) {
    if (bag.kills <= 0) return;
    bag.kills = 0; bag.step = 0; bag.resets++;
    world.events.push({ type: 'bag', action: 'reset', step: 0 });
    return;
  }
  if (bag.step >= BAG_STEPS) return;
  const start = bag.step > 0 ? bagThresholds(world)[bag.step - 1] : 0;
  if (bag.kills <= start) return;
  bag.kills = start;
  bag.resets++;
  world.events.push({ type: 'bag', action: 'reset', step: bag.step });
}

/**
 * The hero goes through the door (world.ts `win`): the filled steps' resources get their kinds from the stream `bag` (one
 * draw per resource) into `world.bag.paid`. No filled step — no draw, no record.
 */
export function bagDoor(world: World): void {
  const bag = world.bag, total = bagTotal(world);
  if (!bag || total <= 0) return;
  const rng = world.rng.stream('bag'), paid: Partial<Record<ResourceKind, number>> = {};
  for (let i = 0; i < total; i++) {
    const kind = RESOURCE_KINDS[Math.floor(rng.next() * RESOURCE_KINDS.length)];
    paid[kind] = (paid[kind] ?? 0) + 1;
  }
  bag.paid = paid;
}

/** What the door paid in this fight (the run adds it to its materials, `RtArenaOutcome.bag`); null — nothing (no door, no step, a defeat). */
export function bagPayout(world: World): Partial<Record<ResourceKind, number>> | null {
  return world.status === 'victory' && world.bag?.paid ? { ...world.bag.paid } : null;
}
