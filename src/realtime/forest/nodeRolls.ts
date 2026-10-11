/**
 * Rolls of a forest-run node: the node seed (the arena seed, the find) and the event outcome and resource rolls. Moved
 * from the removed turn-based run model (src/game/run/forestRun.ts, tag `turn-based-final`) without change: saves and
 * journals keep their results.
 */
import { mixSeed } from './items';
import { RESOURCE_KINDS } from './resources';
import type { ResourceKind } from './types';
import { attemptChances, type EventOption } from './forestEvents';

const textHash = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let n = 0; n < text.length; n++) hash = Math.imul(hash ^ text.charCodeAt(n), 0x01000193) >>> 0;
  return hash;
};
/** Deterministic node seed: the same run seed and node id always give the same arena seed, find or roster roll. */
export function forestNodeSeed(runSeed: number, nodeId: string): number {
  return mixSeed(runSeed >>> 0, textHash(nodeId));
}

/**
 * Index of the outcome an option gives: rolled from `base` (the node's `events` draw; an escalation attempt: its own
 * draw) and the option, so options of one event roll apart. `chances`: the chances of this roll (an attempt's escalation
 * row; default — the option's own). The same run always gets the same outcome, also after a reload.
 */
export function eventOutcomeIndex(base: number, option: EventOption, chances: readonly number[] = attemptChances(option)): number {
  if (chances.length === 1) return 0;
  // floor(u × sum): percent weights roll as before, equal shares exactly 1 of n.
  const sum = chances.reduce((total, chance) => total + chance, 0);
  const roll = Math.floor(mixSeed(base >>> 0, textHash(option.id)) / 0x100000000 * sum);
  let total = 0;
  for (let n = 0; n < chances.length; n++) { total += chances[n]; if (roll < total) return n; }
  return chances.length - 1;
}
/** Kinds of the crafting resources an option gives (decided by the roll's base, so they are shown before the choice). */
export function eventResourceKinds(eventBase: number, option: EventOption): ResourceKind[] {
  const count = Math.max(0, ...option.outcomes.map(outcome => outcome.effect.resources ?? 0));
  const base = mixSeed(eventBase >>> 0, textHash(`${option.id}:resources`));
  return Array.from({ length: count }, (_, n) => RESOURCE_KINDS[mixSeed(base, n) % RESOURCE_KINDS.length]);
}
