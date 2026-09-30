/**
 * Schedule of turn systems (ECS plan, stage 2: docs/ecs-architecture.md §3.4). A schedule is an ordered list of named
 * system sets; inside a set the systems run in declaration order (the Flecs rule «phase, then declaration»). The order
 * is a game rule the player sees, so nothing is inferred from data access.
 *
 * Every system is a synchronous generator (`TurnSequence`) that yields events and presentation delays and returns
 * false when a restart cancelled it. After each system the schedule asks the caller's `after` hook whether to go on:
 * the turn may be cancelled (scene restarted) or finished (battle over).
 */
import type { TurnSequence } from '../turnRuntime';

export interface TurnSystem<C> {
  readonly name: string;
  run(ctx: C): TurnSequence;
}
export interface SystemSet<C> {
  readonly name: string;
  readonly systems: readonly TurnSystem<C>[];
}
/** What the schedule does after a system returned normally. */
export type ScheduleVerdict = 'continue' | 'finished' | 'cancelled';

/** A system that only changes state (no events or delays). */
export function instant<C>(name: string, apply: (ctx: C) => void): TurnSystem<C> {
  return { name, *run(ctx) { apply(ctx); return true; } };
}

/** Run the sets in order. Returns false when cancelled (by a system or by the `after` verdict), true otherwise. */
export function* runSchedule<C>(ctx: C, sets: readonly SystemSet<C>[], after: (ctx: C) => ScheduleVerdict): TurnSequence {
  for (const set of sets) for (const system of set.systems) {
    if (!(yield* system.run(ctx))) return false;
    const verdict = after(ctx);
    if (verdict === 'cancelled') return false;
    if (verdict === 'finished') return true;
  }
  return true;
}
