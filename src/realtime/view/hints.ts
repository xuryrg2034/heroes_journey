/**
 * «Обучение»: the viewer's memory of what was shown, the lines on the run screens (Э2, Э4), the Э1 text of the cauldron's payout.
 * A view feature only: not a Param, never in the journal, the hash or the run save; the simulation and the run do not read it.
 *
 * The hint box at the bottom of a run fight (v1: Б1–Б9 in a queue) was REMOVED on 12.10.2026 (user: «Надписи снизу это не
 * обучение»; docs/realtime-onboarding.md). Б1, Б2, Б3, Б7 are taught by the prologue, Б4 and Б5 belong to the cauldron the run
 * does not play. Б6, Б8, Б9 are WORLD labels at their object (view/worldLabels.ts); the ids `b6`, `b8`, `b9` stay as keys of
 * the memory and of the run record (`RunRecord.hints`).
 *
 * This module is the pure part, testable in Node (`npm run test:realtime-hints`): the memory (`HintStore`, `HINTS_KEY`,
 * `{version: 1, shown: {id: count}}`; a label counts when its ACTION is done, a screen line on its appearances), the screen
 * lines and the texts. The gear of the run map resets the memory.
 */
import { multText, payoutCap, purseResources, type PurseDoor } from '../sim/purse';

export const HINTS_KEY = 'ashen-oath-realtime-hints';
const HINTS_VERSION = 1;
/** A screen line (Э2, Э4) shows on this many appearances of its screen, then stays quiet. */
export const SCREEN_LINE_SHOWS = 2;
/** The ids of the v1 hints (Б1–Б9, kept for the memory and the run record; only b6, b8, b9 are alive as world labels). */
export const HINT_IDS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'] as const;
export type HintId = typeof HINT_IDS[number];
/**
 * The screen lines: Э2 (the map's resources), Э4 (the die). Э1 is the fight result's row, Э3 is the node card's stake line.
 * Э1, Э3 and Э4 belong to their rules (the cauldron, the oath stake, the die): they show only where the rule is on — the
 * «Котёл» row with `purse`, the stake line with the node's oaths, the die line on the die screen (task 5, 12.10.2026: none
 * of the three in the run).
 */
export const SCREEN_LINE_IDS = ['e2', 'e4'] as const;
export type ScreenLineId = typeof SCREEN_LINE_IDS[number];
/** Short names for the telemetry report. */
export const HINT_TITLES: Readonly<Record<HintId, string>> = {
  b1: 'Б1 Фокус', b2: 'Б2 Сила цепи', b3: 'Б3 Выживший', b4: 'Б4 Котёл', b5: 'Б5 Дверь', b6: 'Б6 Элита', b7: 'Б7 Энергия', b8: 'Б8 Сундук', b9: 'Б9 Гоблин',
};
export const isHintId = (value: unknown): value is HintId => typeof value === 'string' && (HINT_IDS as readonly string[]).includes(value);

/** Э2, the run map (below the header). */
export const LINE_RESOURCES = 'Ресурсы — крафт на привале, покупки у торговца, переброс талисманов.';
/** Э3, the node card of an oath node: kept and broken multipliers of the stake (`sim/oath.ts`), always shown with the offer. */
export function stakeLine(kept: number, broken: number): string { return `Ставка на котёл этого боя: сдержишь ×${multText(kept)}, нарушишь ×${multText(broken)}.`; }
/** Э4, the die screen: the halves of the roll (`lowFaces` — the faces of the lower half, run/rtRun.ts `DIE_LOW_FACES`). */
export function dieLine(lowFaces: number): string { return `1–${lowFaces} — половина, ${lowFaces + 1}–6 — вдвое, но не выше потолка. «Забрать» — без риска.`; }

/**
 * Э1, the value of the «Котёл» row of a run fight's result (the label is the row's own): «250 ×1,5 ×2 ÷ 120 → ресурсов 4 (потолок 6)». The greed step and the
 * oath are written only when they are not 1; the cap only when the payout stands at it. The numbers are `purseResources` of
 * the door's record (the rate it paid at), the same call the run pays with.
 */
export function purseResultLine(door: PurseDoor): string {
  const greed = door.greed ?? 1, paid = purseResources(door.cauldron, door.oath, 1, door.rate, greed), cap = payoutCap(door.oath);
  return `${door.cauldron}${greed !== 1 ? ` ×${multText(greed)}` : ''}${door.oath !== 1 ? ` ×${multText(door.oath)}` : ''} ÷ ${door.rate} → ресурсов ${paid}${paid >= cap ? ` (потолок ${cap})` : ''}`;
}

/** The part of `Storage` the store uses (a plain object in the Node test). */
export interface HintStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** What the viewer has been shown: ids with a count. Storage is optional: without it (or when it throws) nothing is kept past the page. */
export class HintStore {
  private shown: Record<string, number> = {};

  constructor(private readonly storage: HintStorage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })()) {
    try {
      const raw = this.storage?.getItem(HINTS_KEY);
      const value = raw ? JSON.parse(raw) as { version?: unknown; shown?: unknown } : null;
      if (value && value.version === HINTS_VERSION && value.shown && typeof value.shown === 'object' && !Array.isArray(value.shown)) {
        for (const [id, count] of Object.entries(value.shown as Record<string, unknown>)) if (typeof count === 'number' && Number.isFinite(count) && count > 0) this.shown[id] = Math.floor(count);
      }
    } catch { /* unreadable: nothing shown */ }
  }

  count(id: string): number { return this.shown[id] ?? 0; }
  /** Ids shown at least once, sorted. */
  shownIds(): string[] { return Object.keys(this.shown).sort(); }

  /** The id was shown once more. */
  bump(id: string): void { this.shown[id] = this.count(id) + 1; this.save(); }
  /** The gear of the run map: everything is new again. */
  reset(): void { this.shown = {}; this.save(); }

  private save(): void {
    try { this.storage?.setItem(HINTS_KEY, JSON.stringify({ version: HINTS_VERSION, shown: this.shown })); } catch { /* storage may be unavailable */ }
  }
}

/**
 * The lines on the run screens (Э2, Э4): `show(id, appearance)` is true while the screen appearance named by `appearance` is
 * one of the first `SCREEN_LINE_SHOWS` of the line. A redraw of the same appearance is not a new show; with `on()` false the
 * line is hidden and nothing counts.
 */
export class ScreenLines {
  private readonly current = new Map<string, string>();
  constructor(private readonly store: HintStore, private readonly on: () => boolean) {}

  show(id: ScreenLineId, appearance: string): boolean {
    if (!this.on()) return false;
    if (this.current.get(id) === appearance) return true;
    if (this.store.count(id) >= SCREEN_LINE_SHOWS) return false;
    this.store.bump(id);
    this.current.set(id, appearance);
    return true;
  }
}
