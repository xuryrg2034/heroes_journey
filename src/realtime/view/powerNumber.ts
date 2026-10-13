/**
 * The power number over the hero while a chain is drawn (task 8b, design 13.10.2026; review fix 13.10.2026). Pure, Node-tested
 * (`npm run test:realtime-power-number`): what the number says for the plan of the drawn chain.
 *
 * - The first enemy link that survives (not killed, not a plate) is where the dash stops: the number is the power the chain brings
 *   into it (`available`) and is red. Links after it (the world changed while drawing) do not count.
 * - No survivor: the power after the last link (`ChainPlan.power`), warm.
 * - No enemy link at all (a chain of a button or the door alone): no number.
 */
import type { ChainPlan } from '../sim/chain';

export function planPowerNumber(plan: Pick<ChainPlan, 'links' | 'power'>): { value: number; red: boolean } | null {
  if (!plan.links.some(l => l.outcome)) return null;
  const stop = plan.links.find(l => l.outcome && !l.outcome.killed && !l.outcome.plate)?.outcome;
  return stop ? { value: stop.available, red: true } : { value: plan.power, red: false };
}
