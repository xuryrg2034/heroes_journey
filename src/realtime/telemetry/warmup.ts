/**
 * The warmup's telemetry (task 51ж, 17.10.2026; docs/realtime-telemetry.md, «Разминка»): one light record per attempt of a camp's
 * warmup layout (run/warmup.ts) — the layout, how it ended, the score, the best before it and whether it set a new one, the game and
 * real seconds. No fight journal: the layouts' determinism is checked by the Node tests of `run/warmup.ts`.
 *
 * `warmupBody` builds the record's body from the attempt's end (the view calls the recorder's `warmupAttempt` with it). Pure: no DOM,
 * no clock.
 */
import type { WarmupMerge } from '../run/warmup';
import type { WarmupEndKind, WarmupRecord } from './schema';

/** The record without its header. */
export type WarmupBody = Pick<WarmupRecord, 'layout' | 'end' | 'score' | 'before' | 'record' | 'gameSeconds' | 'realSeconds'>;

const round2 = (x: number): number => Math.round(Math.max(0, x) * 100) / 100;

/**
 * The body of an attempt of `layout` that ended `end` (`exit` — the view's «Выход»): `score` — `warmupScore` of its last tick (null
 * for an exit), `merge` — `warmupMerge` of that score into the records before it; `game` and `real` — its seconds.
 */
export function warmupBody(layout: string, end: WarmupEndKind, score: number | null, merge: Pick<WarmupMerge, 'before' | 'record'>, game: number, real: number): WarmupBody {
  const scored = end === 'exit' ? null : score;
  return { layout, end, score: scored, before: merge.before, record: scored !== null && merge.record, gameSeconds: round2(game), realSeconds: round2(real) };
}
