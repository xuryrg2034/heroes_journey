/**
 * Long random streams of a run (decision of 04.10.2026, docs/roguelike-runs.md, «Долгие потоки случайности»), as in
 * Slay the Spire: every kind of run roll draws from a named stream of its own, and the run keeps how many draws each
 * stream made (`ForestRunState.streams`, saved with the run). A draw is a pure function of the run seed, the stream
 * name and its counter, so
 * - the same seed and the same actions give the same rolls;
 * - a reload restores the counters and never rerolls what is to come;
 * - streams are independent: a draw from one (a merchant visit) never moves another (the next talisman offer).
 * Each use takes exactly one draw and expands it with its own salts (talismanOffers.ts, merchant.ts, forestRun.ts), so
 * the counter of a stream is the number of its uses so far: the save check replays them in order.
 *
 * What stays outside the streams: the map (only the run seed, mapGenerator.ts) and the battle of a node (the run seed and
 * the node id, forestNodeSeed in forestRun.ts — the battle's own RNG), finds and chests (the node seed).
 */
import { mixSeed } from '../items';

/**
 * - `pool`: the battle a pool node of a generated map gets on entering (battlePools.ts);
 * - `events`: the event a pool node gets, and its outcomes (one draw per event node entered);
 * - `talismans`: talisman and oath offers after a hard battle and the Jailer (talismanOffers.ts);
 * - `merchant`: the stock of a merchant visit (merchant.ts);
 * - `gift-*`: the four buttons of the start gift (runGift.ts), one stream per button.
 */
export const RUN_STREAMS = ['pool', 'events', 'talismans', 'merchant', 'gift-item', 'gift-supply', 'gift-deal', 'gift-gamble'] as const;
export type RunStream = typeof RUN_STREAMS[number];
/** Draws made so far by each stream. */
export type RunStreams = Record<RunStream, number>;

export const emptyStreams = (): RunStreams => Object.fromEntries(RUN_STREAMS.map(name => [name, 0])) as RunStreams;
export const isRunStream = (value: unknown): value is RunStream => typeof value === 'string' && (RUN_STREAMS as readonly string[]).includes(value);

const textHash = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let n = 0; n < text.length; n++) hash = Math.imul(hash ^ text.charCodeAt(n), 0x01000193) >>> 0;
  return hash;
};
const STREAM_SALT = new Map<RunStream, number>(RUN_STREAMS.map(name => [name, textHash(`run-stream:${name}`)]));

/** The `index`-th draw (from 0) of a stream of the run seed: a 32-bit value. */
export function streamValue(runSeed: number, stream: RunStream, index: number): number {
  return mixSeed(mixSeed(runSeed >>> 0, STREAM_SALT.get(stream)!), index >>> 0);
}

/** Counters of a save: every stream a non-negative integer, no other keys. Null if malformed. */
export function parseStreams(value: unknown): RunStreams | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== RUN_STREAMS.length) return null;
  const streams = emptyStreams();
  for (const name of RUN_STREAMS) {
    const count = record[name];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    streams[name] = count;
  }
  return streams;
}
