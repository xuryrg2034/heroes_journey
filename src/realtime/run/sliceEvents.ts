/**
 * The event catalogue of the turn-based run (forestEvents.ts) in the real-time slice (docs/realtime-slice.md, section 3):
 * an outcome or a cost that refers to a rule without an analogue in the slice turns its option off; an event stays in
 * the pool while it keeps a choice — at least two options on and a safe one among them.
 *
 * The slice has HP, the maximum HP, crafting resources, arenas and (step 3) consumables and the energy banked for the
 * next arena (an arena starts with it; rtRun.ts) and the one-arena modifiers of the next arena (design answers): «первая
 * цепь с силой 1», «бой со случайной элитой», «злость» (+3 enemies in the first wave), «подкрепление раньше» (before the
 * goals groups 1.5 times as often). So:
 * - a cost alternative the run can pay: HP, maximum HP, resources, energy (banked), consumables (in hand);
 * - «снять горение, яд и кровотечение» has nothing to clear (the hero has no such effects) and changes nothing;
 * - a reward battle («Засада у брода») is an arena of the node's row.
 * A talisman outcome draws from the slice's pool (rtTalismans.ts); the reward battle gives its talisman choice.
 * The data of the catalogue is not changed: the slice reads it through these checks.
 */
import { FOREST_EVENTS, isSafeOption, optionCosts, type EventCost, type EventOption, type ForestEvent } from '../../game/run/forestEvents';

/** Why an outcome effect has no analogue in the slice ('' — it has one). */
function effectGap(_effect: EventOption['outcomes'][number]['effect']): string {
  // Design answers to step 3: every modifier acts on the next arena (rtRun.ts, `RtModifier`) — no outcome turns an option off.
  return '';
}
/** A cost alternative the slice can pay: every kind of the catalogue has an analogue since step 3. */
export const sliceCost = (cost: EventCost): boolean => !!cost;
/** The cost alternatives of an option the slice keeps, in their order. */
export const sliceCosts = (option: EventOption): EventCost[] => optionCosts(option).filter(sliceCost);

/** Why an option is off in the slice ('' — it is on): the first rule without an analogue it refers to. */
export function sliceOptionGap(option: EventOption): string {
  for (const outcome of option.outcomes) {
    const gap = effectGap(outcome.effect);
    if (gap) return gap;
  }
  return '';
}

/** A safe option in the slice: on, free (no cost kept), no HP loss, no battle. */
const sliceSafe = (option: EventOption): boolean => !sliceOptionGap(option) && isSafeOption(option);

/** The event keeps a choice in the slice: at least two options on, one of them safe. */
export function sliceEventOn(event: ForestEvent): boolean {
  const on = event.options.filter(option => !sliceOptionGap(option));
  return on.length >= 2 && on.some(sliceSafe);
}

/** Ids of the catalogue events in the slice pool, in catalogue order. */
export const SLICE_EVENTS: readonly string[] = Object.values(FOREST_EVENTS).filter(sliceEventOn).map(event => event.id);
/** Ids of the catalogue events out of the slice pool, in catalogue order (for the documents and the tests). */
export const SLICE_EVENTS_OFF: readonly string[] = Object.values(FOREST_EVENTS).filter(event => !sliceEventOn(event)).map(event => event.id);
