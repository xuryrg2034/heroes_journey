/**
 * «Обучение v1» (docs/realtime-onboarding.md; design decision 12.10.2026): one-time hints in a run fight, the lines on the
 * run screens, and the Э1 text of the cauldron's payout. A view feature only: not a Param, never in the journal, the hash or
 * the run save; the simulation and the run do not read it. The sandbox shows nothing (main.ts passes no store there).
 *
 * This module is the pure part, testable in Node (`npm run test:realtime-hints`): the viewer's memory, the queue and its
 * real-time rules, the trigger detection from a world snapshot, the texts. The DOM box, the fade under the hero and the
 * wiring are main.ts / runView.ts.
 *
 * - **Memory** — `HintStore` in the viewer's `localStorage` (`HINTS_KEY`), `{version: 1, shown: {id: count}}`. A fight hint is
 *   shown once per viewer; a screen line the first `SCREEN_LINE_SHOWS` appearances. The gear of the run map resets it.
 * - **Queue** — one hint at a time, at least `HINT_GAP_MS` between the starts of two hints; a hint stays `HINT_SHOW_MS` or
 *   until the next chain release, whichever is later. Times are real (wall) time: a person reads, the fight does not pause.
 * - **Triggers** — read from the world and its events of the frame, BEFORE main.ts clears `world.events`. Rules are not
 *   copied here: the numbers in the texts come from the world's `params` and the modules' constants.
 */
import type { Vec } from '../sim/geometry';
import type { Params } from '../sim/params';
import { DEFAULT_PARAMS } from '../sim/params';
import type { World } from '../sim/world';
import { jumpCostOf } from '../sim/build';
import { CHEST_CURSE_KILLS, CHEST_CURSE_TOUCH } from '../sim/chest';
import { leverOf } from '../sim/slot';
import { GREED_LINKS, multText, payoutCap, purseResources, type PurseDoor } from '../sim/purse';

export const HINTS_KEY = 'ashen-oath-realtime-hints';
const HINTS_VERSION = 1;
/** A screen line (Э2, Э4) shows on this many appearances of its screen, then stays quiet. */
export const SCREEN_LINE_SHOWS = 2;
/** A fight hint stays at least this long (ms of real time), and until the next chain release if that is later. */
export const HINT_SHOW_MS = 4000;
/** At least this long (ms of real time) from the start of one hint to the start of the next. */
export const HINT_GAP_MS = 6000;
/** The hint box fades while the hero is within this many pixels of it. */
export const HINT_FADE_MARGIN = 40;

/** The fight hints, numbered as in the design (Б1–Б9). */
export const HINT_IDS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'] as const;
export type HintId = typeof HINT_IDS[number];
/** The screen lines: Э2 (the map's resources), Э4 (the die). Э1 is the fight result's row, Э3 is the node card's stake line. */
export const SCREEN_LINE_IDS = ['e2', 'e4'] as const;
export type ScreenLineId = typeof SCREEN_LINE_IDS[number];
/** Short names for the telemetry report. */
export const HINT_TITLES: Readonly<Record<HintId, string>> = {
  b1: 'Б1 Фокус', b2: 'Б2 Сила цепи', b3: 'Б3 Выживший', b4: 'Б4 Котёл', b5: 'Б5 Дверь', b6: 'Б6 Элита', b7: 'Б7 Энергия', b8: 'Б8 Сундук', b9: 'Б9 Гоблин',
};
export const isHintId = (value: unknown): value is HintId => typeof value === 'string' && (HINT_IDS as readonly string[]).includes(value);

/** «Каждое звено снимает» / «Каждые 2 звена снимают» / «Каждые 5 звеньев снимают» (the number is `Params.slotLinksPerSkull`). */
function skullLinks(n: number): string {
  const tens = n % 100, ones = n % 10;
  if (ones === 1 && tens !== 11) return `Каждое звено снимает череп.`;
  return `Каждые ${n} ${ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'звена' : 'звеньев'} снимают череп.`;
}

/** The final text of a fight hint (design 12.10.2026); the numbers come from `params` and the modules' constants. */
export function hintText(id: HintId, params: Pick<Params, 'slotLinksPerSkull'> = DEFAULT_PARAMS): string {
  switch (id) {
    case 'b1': return 'Пока рисуешь цепь — время замедлено. Полоса — фокус, каждый враг в цепи его пополняет.';
    case 'b2': return 'Каждый враг в цепи +1 к силе. Крепкий тратит силу на свои HP.';
    case 'b3': return 'Не хватило силы — враг выжил. Длиннее цепь — сильнее удар.';
    case 'b4': return 'Цепь кладёт в котёл угли × жар. Котёл платит ресурсами у двери.';
    case 'b5': return `Дверь открыта. Выйди — котёл станет ресурсами. Цепи ${GREED_LINKS}+ растят множитель, удар его снижает.`;
    case 'b6': return 'Броня: удар снимает пластину. Сняв все — добей в окне.';
    case 'b7': return 'Энергия — от ударов цепи. Пробел и клик — прыжок, Q — круговой удар.';
    case 'b8': return `Проклятый сундук: касания врагов +${CHEST_CURSE_TOUCH} урон до ${CHEST_CURSE_KILLS} убийств цепью. Награда за победу — талисман.`;
    case 'b9': return `Однорукий гоблин: закончи цепь на рычаге. ${skullLinks(params.slotLinksPerSkull ?? DEFAULT_PARAMS.slotLinksPerSkull)}`;
  }
}

/** Э2, the run map (below the header). */
export const LINE_RESOURCES = 'Ресурсы — крафт на привале, покупки у торговца, переброс талисманов.';
/** Э3, the node card of an oath node: kept and broken multipliers of the stake (`sim/oath.ts`), always shown with the offer. */
export function stakeLine(kept: number, broken: number): string { return `Ставка на котёл этого боя: сдержишь ×${multText(kept)}, нарушишь ×${multText(broken)}.`; }
/** Э4, the die screen: the halves of the roll (`lowFaces` — the faces of the lower half, run/rtRun.ts `DIE_LOW_FACES`). */
export function dieLine(lowFaces: number): string { return `1–${lowFaces} — половина, ${lowFaces + 1}–6 — вдвое, но не выше потолка. «Забрать» — без риска.`; }

/**
 * Э1, the «Котёл» row of a run fight's result: «Котёл 250 ×1,5 ×2 ÷ 120 → ресурсов 4 (потолок 6)». The greed step and the
 * oath are written only when they are not 1; the cap only when the payout stands at it. The numbers are `purseResources` of
 * the door's record (the rate it paid at), the same call the run pays with.
 */
export function purseResultLine(door: PurseDoor): string {
  const greed = door.greed ?? 1, paid = purseResources(door.cauldron, door.oath, 1, door.rate, greed), cap = payoutCap(door.oath);
  return `Котёл ${door.cauldron}${greed !== 1 ? ` ×${multText(greed)}` : ''}${door.oath !== 1 ? ` ×${multText(door.oath)}` : ''} ÷ ${door.rate} → ресурсов ${paid}${paid >= cap ? ` (потолок ${cap})` : ''}`;
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
  /** «Показать подсказки снова» (the gear of the run map): everything is new again. */
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

/** A hint on the screen: its id, text and when it started (ms) and whether a chain was released since. */
export interface ShownHint { id: HintId; text: string; since: number; released: boolean }

/** Hints that must come before another one in the queue (Б4 before Б5: the cauldron before the door that pays it). */
const BEFORE: Partial<Record<HintId, HintId>> = { b4: 'b5' };
/**
 * Hints that go to the front of the queue: Б8 names the price of the chest, so it must stand before the player can take the
 * chest unseen (the design: «the price visible before the decision»). It still waits for the hint on screen and the 6 s.
 */
const FIRST: ReadonlySet<HintId> = new Set<HintId>(['b8']);

/**
 * The fight hints' queue and its timing. Times are passed in (real ms), so the Node test drives a fake clock.
 * - `offer(id)` — a trigger fired: queued unless shown before (the store), already queued or on screen.
 * - `release(now)` — the player released a chain.
 * - `update(now)` — call every frame; returns the hint that started in this call (to log it), else null.
 * - `reset()` — a new fight: the queue and the hint on screen are dropped (not marked: only a started hint counts as shown).
 */
export class HintQueue {
  current: ShownHint | null = null;
  private queue: HintId[] = [];
  private lastStart = -Infinity;

  constructor(private readonly store: HintStore, private readonly text: (id: HintId) => string = id => hintText(id)) {}

  get pending(): readonly HintId[] { return this.queue; }

  reset(): void { this.queue = []; this.current = null; this.lastStart = -Infinity; }

  offer(id: HintId): void {
    if (this.store.count(id) > 0 || this.queue.includes(id) || this.current?.id === id) return;
    const after = BEFORE[id], at = after ? this.queue.indexOf(after) : -1;
    if (FIRST.has(id)) this.queue.unshift(id);
    else if (at >= 0) this.queue.splice(at, 0, id);
    else this.queue.push(id);
  }

  release(now: number): void { if (this.current && now >= this.current.since) this.current.released = true; }

  update(now: number): ShownHint | null {
    if (this.current && now - this.current.since >= HINT_SHOW_MS && this.current.released) this.current = null;
    if (this.current || !this.queue.length || now - this.lastStart < HINT_GAP_MS) return null;
    const id = this.queue.shift()!;
    this.store.bump(id);
    this.lastStart = now;
    this.current = { id, text: this.text(id), since: now, released: false };
    return this.current;
  }
}

/**
 * The hints whose trigger holds in this frame, in the design's order (Б1…Б9; so Б4 precedes Б5 when the door opens first).
 * `onScreen` is the camera's view (renderer.sees). Reads `world.events` of the frame: call before main.ts clears them.
 * The caller offers each id to the queue; ids shown before are dropped there.
 */
export function detectHints(w: World, onScreen: (p: Vec) => boolean): HintId[] {
  const ids: HintId[] = [];
  const events = w.events;
  // Б1 + Б2: the first link of a chain; Б2 follows Б1 in the queue (and stays for a later fight if the fight ended first).
  if (w.chain.length > 0) ids.push('b1', 'b2');
  // Б3: a chain hit that did not kill and took no plate.
  if (events.some(e => e.type === 'chainHit' && !e.killed && e.plates === undefined)) ids.push('b3');
  // Б4: a cheque of 3+ links, or the door opening (the door is Б5's trigger: Б4 goes before it).
  const doorOpened = w.stage === 'greed' || events.some(e => e.type === 'goals');
  if (doorOpened || events.some(e => e.type === 'cheque' && e.links >= 3)) ids.push('b4');
  if (doorOpened) ids.push('b5');
  // Б6: an armoured enemy in view (the starting elites of «Застава» send no `elite` event: read `armor`).
  if (w.enemies.some(e => e.armor && onScreen(e))) ids.push('b6');
  // Б7: energy for a jump.
  if (w.energy >= jumpCostOf(w)) ids.push('b7');
  // Б8: the chest in view, before it is taken (the price is seen before the decision).
  if (w.objects.some(o => o.kind === 'chest' && onScreen(o))) ids.push('b8');
  // Б9: the goblin's lever appeared, or stands in view.
  const lever = leverOf(w);
  if (events.some(e => e.type === 'slot' && e.action === 'appear') || (lever && onScreen(lever))) ids.push('b9');
  return ids;
}

/** A pixel rectangle (page coordinates). */
export interface Box { left: number; top: number; right: number; bottom: number }
/** The hero (page pixels) is under the box or within `margin` pixels of it: the box fades while he is there. */
export function heroUnderBox(hero: { x: number; y: number }, box: Box, margin = HINT_FADE_MARGIN): boolean {
  return hero.x >= box.left - margin && hero.x <= box.right + margin && hero.y >= box.top - margin && hero.y <= box.bottom + margin;
}
