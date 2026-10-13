/**
 * Task 16 «Подвиги» (user 13.10.2026: «заказы переименуем в подвиги»; design 13.10.2026; docs/realtime-slice.md, «Подвиги»):
 * an optional feat of a run fight. The run picks it for the node (run/rtRun.ts `rtFeatOf`) and passes `{ kind, n }` in the
 * loadout (`Loadout.feat` → `Kit.feat`); the simulation only watches it and latches it done:
 * - `score` — «Набери N очков»: the fight's score (`stats.score`) reaches N;
 * - `afterGoals` — «Продержись N с после целей»: N game seconds have passed since the goals (`greedStart`) and the hero is alive;
 * - `arena` — «Продержись N с на арене»: the fight's game time reaches N.
 * Done is checked at the end of every playing tick (world.ts `update`, `featCheck`) and once in the tick the hero goes through
 * the door (`featExit`, after the door: the score of a chain that ended in it and the exit tick's game time count): the first
 * moment the condition holds while the hero is alive latches `world.feat` (`{ tick, time }`) and sends the event `feat` `done`. A defeat latches nothing more; a done feat stays done. The reward is the run's: paid only for a won fight
 * (the door), after the run reads `featResult`.
 *
 * Off by default (`Params.feats`); journals without the key, kits without `feat`: no `world.feat`, no event, no draw — worlds
 * hash as before. The run turns it on (`RT_RUN_FORCED`); the sandbox has no node feat (its panel toggle does nothing without
 * a loadout feat). No randomness here. Type-only import of world.ts: world.ts calls this module at run time.
 */
import type { World } from './world';

/** The three kinds of a feat. */
export type FeatKind = 'score' | 'afterGoals' | 'arena';
export const FEAT_KINDS: readonly FeatKind[] = ['score', 'afterGoals', 'arena'];
export const isFeatKind = (value: unknown): value is FeatKind => typeof value === 'string' && (FEAT_KINDS as readonly string[]).includes(value);

/** What the fight's feat asks (the run's `RtFeat` without its reward). */
export interface FeatGoal { kind: FeatKind; n: number }
/** A valid feat goal (a known kind, a whole N ≥ 1) or null. */
export function featGoalOf(value: unknown): FeatGoal | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { kind?: unknown; n?: unknown };
  return isFeatKind(v.kind) && typeof v.n === 'number' && Number.isInteger(v.n) && v.n >= 1 ? { kind: v.kind, n: v.n } : null;
}

/** The latch of the fight's feat (`World.feat`): present only once done — the tick and the game time it was done. */
export interface FeatWorld { tick: number; time: number }

/** The feat of this fight (`Params.feats` on and the kit carries one); null — none. */
export function featOf(world: World): FeatGoal | null {
  return world.params.feats && world.kit?.feat ? world.kit.feat : null;
}

/**
 * The feat's progress for the view (the HUD line «Подвиг 12/30 с», the result screen): `value` toward `target` (score points or
 * game seconds, capped at the target once done), `done`; `waiting` — an `afterGoals` feat before the goals (its seconds have
 * not started). Null — no feat in this fight.
 */
export interface FeatProgress { kind: FeatKind; value: number; target: number; done: boolean; waiting?: true }
export function featProgress(world: World): FeatProgress | null {
  const feat = featOf(world);
  if (!feat) return null;
  const done = !!world.feat, target = feat.n;
  if (feat.kind === 'score') return { kind: feat.kind, value: done ? Math.max(target, world.stats.score) : world.stats.score, target, done };
  if (feat.kind === 'arena') return { kind: feat.kind, value: done ? target : Math.min(target, world.time), target, done };
  if (world.greedStart === null) return { kind: feat.kind, value: 0, target, done, waiting: true };
  return { kind: feat.kind, value: done ? target : Math.min(target, Math.max(0, world.time - world.greedStart)), target, done };
}

/** The condition holds at game time `time` (not latched yet). Tiny slack for the sum of 1/60 s ticks. */
function featMet(world: World, feat: FeatGoal, time: number): boolean {
  if (feat.kind === 'score') return world.stats.score >= feat.n;
  if (feat.kind === 'arena') return time + 1e-9 >= feat.n;
  return world.greedStart !== null && time - world.greedStart + 1e-9 >= feat.n;
}

function latch(world: World, feat: FeatGoal, time: number): void {
  world.feat = { tick: world.tick, time };
  world.events.push({ type: 'feat', action: 'done', kind: feat.kind, n: feat.n });
}

/**
 * The end of a playing tick (world.ts `update`): the first moment the feat's condition holds while the hero plays latches it
 * (`world.feat`) and sends `feat` `done`. Nothing without a feat, once done, or after the fight ended (the exit tick —
 * `featExit`).
 */
export function featCheck(world: World): void {
  if (world.feat || world.status !== 'playing') return;
  const feat = featOf(world);
  if (feat && featMet(world, feat, world.time)) latch(world, feat, world.time);
}

/**
 * The tick the hero went through the door (review of task 16, 14.10.2026): the exit tick counts whole — the score of the chain
 * that ended in the door (added by chain.ts `finishMove` after `win`) and the tick's game time. `ahead` — game seconds of the
 * exit tick not yet on `world.time`: a chain or a jump enters the door in `stepHero`, before `update` adds the tick's `SIM_DT`
 * (simulation.ts `tick` calls it with `SIM_DT` right after a `stepHero` that won); walking in comes after it (world.ts `update`,
 * 0). Only a victory; nothing without a feat or once done. Called once, in the exit tick.
 */
export function featExit(world: World, ahead: number): void {
  if (world.feat || world.status !== 'victory') return;
  const feat = featOf(world), time = world.time + ahead;
  if (feat && featMet(world, feat, time)) latch(world, feat, time);
}

/**
 * What the fight's feat came to (the run reads it from the finished world, `RtArenaOutcome.feat`): done or not, the progress at
 * the end (`value`), the game time it was done (`at`; absent — not done). Null — no feat in this fight.
 */
export interface FeatResult { kind: FeatKind; n: number; done: boolean; value: number; at?: number }
export function featResult(world: World): FeatResult | null {
  const progress = featProgress(world), feat = featOf(world);
  if (!progress || !feat) return null;
  return { kind: feat.kind, n: feat.n, done: progress.done, value: progress.value, ...world.feat ? { at: world.feat.time } : {} };
}

/**
 * The fight's feat as the run takes it (run/rtRun.ts `RtArenaOutcome.feat`: done, the progress at the end, when done) — the view
 * spreads it into the outcome it feeds back (`...featOutcome(world)`); nothing without a feat.
 */
export function featOutcome(world: World): { feat?: { done: boolean; value: number; at?: number } } {
  const result = featResult(world);
  return result ? { feat: { done: result.done, value: result.value, ...result.at !== undefined ? { at: result.at } : {} } } : {};
}
