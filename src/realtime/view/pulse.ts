/**
 * The pulse (task 6, 12.10.2026; docs/realtime-onboarding.md): a general way to say «use this» without a word — a control on the
 * action bar glows and breathes until the player does the action, then stops for good (the viewer's memory, as the world labels).
 * Today the consumable slots pulse in the run until an item is used; later the prologue pulses «Пробел» and «Q» the same way.
 * A view feature only: a CSS class (`.rt-pulse`), nothing in the world, the journal or the hash.
 */
export const PULSE_CLASS = 'rt-pulse';

/** Turns the pulse of a control on or off. */
export function setPulse(el: HTMLElement, on: boolean): void {
  if (el.classList.contains(PULSE_CLASS) !== on) el.classList.toggle(PULSE_CLASS, on);
}

/** The memory id of the consumable slots' pulse: set by the first item used (the keys `b6`, `b8`, `b9` are the world labels'). */
export const ITEM_PULSE_ID = 'item';
