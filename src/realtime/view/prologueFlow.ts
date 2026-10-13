/**
 * The prologue «Опушка», the view side (task 6, step 4, 12.10.2026; docs/realtime-onboarding.md, «Пролог: вид и поток»). The pure
 * part, testable in Node (`npm run test:realtime-prologue-view`): the viewer's key «пролог пройден», the ghost hand's state
 * machine (`HandGuide`), the labels at the place (`prologueLabel`), the goal line, the lamps' places over the door, the seed of a
 * room, the hooks the telemetry takes (`PrologueHooks`, telemetry/prologue.ts).
 *
 * A view feature only: it reads the world and `run/prologue.ts`, sends no command, is no Param, in no journal, no hash, no run
 * save. The hand SHOWS a chain; the player draws it.
 */
import type { Vec } from '../sim/geometry';
import { OBJECT_RADIUS, goalProgress, type ChainLink, type World } from '../sim/world';
import { goblinOf, leverOf } from '../sim/slot';
import { PROLOGUE_ROOM_COUNT, prologueRoom, prologueTitle, startEnemyIds } from '../run/prologue';
import type { LabelSpec } from './worldLabels';

/** The viewer's key: set after the last room or by «Пропустить обучение» (task 9 kept it: a viewer who passed the six rooms is not sent back). The run saves, seeds and the forest do not know it. */
export const PROLOGUE_KEY = 'ashen-oath-realtime-prologue-done';
/** The rooms (task 9: nine) — the sim's count (run/prologue.ts). */
export { PROLOGUE_ROOM_COUNT };

/** The part of `Storage` the store uses. */
export interface PrologueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export class PrologueStore {
  constructor(private readonly storage: PrologueStorage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })()) {}
  /** Was the prologue passed (or skipped) on this browser. Unreadable storage — not done (the prologue shows each launch, never traps). */
  done(): boolean { try { return this.storage?.getItem(PROLOGUE_KEY) === '1'; } catch { return false; } }
  markDone(): void { try { this.storage?.setItem(PROLOGUE_KEY, '1'); } catch { /* storage may be unavailable */ } }
  clear(): void { try { this.storage?.removeItem(PROLOGUE_KEY); } catch { /* storage may be unavailable */ } }
}

/** Real seconds the room's name shows big at its start. */
export const TITLE_SECONDS = 1.5;
/** The room's name: «1/9 · Тропа» (run/prologue.ts `prologueTitle`). */
export function roomTitle(n: number): string { return prologueTitle(n); }

/**
 * The seed of a room's fight (the view's choice, not deterministic by the player's play: the sim is). `fixed` — the page's
 * `?seed=` (tests, replays); the attempt number differs the retries of rooms 5–6.
 */
export function prologueSeed(n: number, attempt: number, fixed: number | null = null): number {
  const k = Math.imul(n * 16 + attempt, 2654435761) >>> 0;
  return fixed === null ? k : (fixed + k) >>> 0;
}

/** The goal line of the HUD in the prologue (short, no score). */
export function prologueGoalLine(w: World): string {
  if (w.stage === 'greed') return 'Дверь открыта';
  const { done, total } = goalProgress(w), goal = w.arena.goal;
  if (goal === 'chain') return `Одной цепью: ${done} / ${total}`;
  if (goal === 'marked') return `Крепкий: ${done} / ${total}`;
  if (goal === 'pull') return `Рычаг: ${done} / ${total}`;
  // Task 9: «Вихрь» (N by one blow), «Пропасть» (the door), «Зелье» (the potion drunk).
  if (goal === 'strike') return `Одним ударом: ${done} / ${total}`;
  if (goal === 'door') return `Дверь: ${done} / ${total}`;
  if (goal === 'item') return `Зелье: ${done} / ${total}`;
  return `Убей: ${done} / ${total}`;
}

/** Arena units: how far the lamps stand from the door's centre (the door's frame is ≈ 0.55 wide), the gap between neighbours. */
const LAMP_MIN_RADIUS = 1.2, LAMP_MAX_RADIUS = 2.4, LAMP_GAP = 0.46;

/**
 * The places of `total` lamps over the door: on an arc round the door, on the side that faces the arena's middle (so they stand
 * on the floor, not behind the screen's edge or under the HUD plate). One lamp stands on the axis; the arc widens with the number.
 */
export function lampPoints(door: Vec, arena: { width: number; height: number }, total: number): Vec[] {
  const out: Vec[] = [];
  if (total <= 0) return out;
  let dx = arena.width / 2 - door.x, dy = arena.height / 2 - door.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const centre = Math.atan2(dy, dx);
  const r = Math.max(LAMP_MIN_RADIUS, Math.min(LAMP_MAX_RADIUS, total * LAMP_GAP / 2.6));
  const span = Math.min(Math.PI * 1.1, (total - 1) * LAMP_GAP / r);
  for (let i = 0; i < total; i++) {
    const a = total === 1 ? centre : centre - span / 2 + span * i / (total - 1);
    out.push({ x: door.x + Math.cos(a) * r, y: door.y + Math.sin(a) * r });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The ghost hand
// ---------------------------------------------------------------------------------------------------------------------

/** Game seconds without a press before the hand (or the arrow) comes. */
export const HAND_IDLE = 4;
/** Game seconds between two questions to the sim (`prologueRoute`, `prologueHandSpot`) while nothing shows. */
export const HAND_ASK = 0.25;

/**
 * What the guide asks: the hand's chain of this world and, when there is none, the spot to walk to (both from `run/prologue.ts`).
 * `aim` (task 9, room «Пропасть»): the point the hand clicks with the jump on, when the jump can start from where the hero stands
 * (`prologueJumpAim` ready) — it counts as the hand's route; null — walk to `spot` first.
 */
export interface HandProbe { route(): ChainLink[]; spot(): Vec | null; aim?(): Vec | null }
export type HandShow = 'none' | 'hand' | 'arrow';

/**
 * The ghost hand's rules (design 12.10.2026), as a state machine on game time:
 * - a press (the pointer, Space, Q, an item, or a chain drawn or a move going) takes the hand and the arrow away and starts the
 *   4 s again; the hand comes after `HAND_IDLE` of rest when the room has a chain from where the hero stands;
 * - without such a chain, after the same rest: a pale arrow from the hero and a blinking circle at `spot()` (null — nothing, asked
 *   again every `HAND_ASK`); walking hides the arrow (the circle stays), rest of `HAND_IDLE` brings it back;
 * - the circle gone when the hero stands where a chain exists (the circle is reached): the hand comes AT ONCE, with no new 4 s,
 *   and stays through walking until a press.
 * It never sends a command.
 */
export class HandGuide {
  show: HandShow = 'none';
  /** The hand's chain while it shows. */
  route: ChainLink[] = [];
  /** Task 9: the hand's click point while it shows a jump (null — a chain or nothing). */
  target: Vec | null = null;
  /** The blinking circle's place (null — none); the arrow shows with it. */
  circle: Vec | null = null;
  private idle = 0;
  private ask = 0;
  private arrowOn = false;
  private locked = false;

  constructor(private readonly probe: HandProbe, private readonly onShow?: (show: 'hand' | 'arrow') => void) {}

  /** The seconds of rest so far (tests). */
  get rest(): number { return this.idle; }

  /** A press: the hand and the arrow go, the circle goes, the rest starts again. */
  press(): void {
    this.idle = 0; this.ask = 0; this.arrowOn = false; this.locked = false; this.circle = null;
    this.route = []; this.target = null;
    this.setShow('none');
  }

  /**
   * One step of `dt` game seconds. `walking` — a walk key is held; `busy` — a chain is drawn, a move goes or the hero is hit by the
   * fight (counts as a press).
   */
  update(dt: number, walking: boolean, busy: boolean): void {
    if (busy) { this.press(); return; }
    const before = this.idle;
    if (walking) {
      this.idle = 0;
      this.arrowOn = false;
      if (this.show === 'arrow') this.setShow('none');
      if (this.show === 'hand' && !this.locked) { this.route = []; this.target = null; this.setShow('none'); }
    } else this.idle += dt;
    this.ask += dt;
    // Ask the sim every HAND_ASK, and at once when the rest reaches HAND_IDLE (the hand comes at 4 s, not up to a moment later).
    if (this.ask < HAND_ASK && !(before < HAND_IDLE && this.idle >= HAND_IDLE)) return;
    this.ask = 0;
    this.refresh();
  }

  private refresh(): void {
    const route = this.probe.route(), target = this.probe.aim?.() ?? null;
    if (route.length || target) {
      // A chain (or the jump's click) from here: after the rest, or at once when the circle was walked to (then it stays through walking until a press).
      if (this.show === 'hand' || this.circle || this.idle >= HAND_IDLE) {
        if (this.circle) this.locked = true;
        this.circle = null; this.arrowOn = false;
        this.route = route; this.target = target;
        this.setShow('hand');
      }
      return;
    }
    // No chain from here: a hand that showed goes (the enemies moved or are gone) and the rest counts as done.
    if (this.show === 'hand') { this.route = []; this.target = null; this.locked = false; this.setShow('none'); this.idle = Math.max(this.idle, HAND_IDLE); }
    if (this.idle < HAND_IDLE) return;
    // The circle stays where it was set (the arena stands still while the room waits); the arrow comes back after each rest.
    if (!this.circle) this.circle = this.probe.spot();
    if (this.circle) { this.arrowOn = true; this.setShow('arrow'); }
  }

  private setShow(show: HandShow): void {
    if (this.show === show) return;
    this.show = show;
    if (show !== 'none') this.onShow?.(show);
  }

  /** The arrow draws now. */
  get arrow(): boolean { return this.show === 'arrow' && this.arrowOn && !!this.circle; }
}

/** Arena units per second the drawn hand travels; the pause at each link; the press, the hold at the end and the gap before the loop (seconds). */
export const HAND_SPEED = 4.5, HAND_PAUSE = 0.12, HAND_PRESS = 0.5, HAND_HOLD = 0.7, HAND_GAP = 0.9, HAND_FADE = 0.35;

/** One frame of the hand's picture. */
export interface HandFrame {
  /** The fingertip (arena units). */
  pos: Vec;
  /** 0…1: opacity factor (it fades in at the press and out in the gap). */
  alpha: number;
  /** The press is held (the first moment and the way); false at the end hold and in the gap. */
  pressed: boolean;
  /** The line the hand has drawn so far: the first link, the links passed, the fingertip. */
  trail: Vec[];
  /** The number of the links passed (the last one the fingertip stands on or has left). */
  links: number;
}

/** The length of one loop of the hand over `points`, seconds. */
export function handCycle(points: readonly Vec[]): number {
  let travel = 0;
  for (let i = 1; i < points.length; i++) travel += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / HAND_SPEED + HAND_PAUSE;
  return HAND_PRESS + travel + HAND_HOLD + HAND_GAP;
}

/**
 * Where the hand is `t` seconds into its loop over the route's `points` (≥ 1): presses on the first link, drags over the next
 * ones with a short pause at each, holds at the last, lets go and fades, then the loop starts again. View only.
 */
export function handFrame(points: readonly Vec[], t: number): HandFrame {
  const cycle = handCycle(points);
  t = ((t % cycle) + cycle) % cycle;
  const first = points[0], last = points[points.length - 1];
  if (t < HAND_PRESS) return { pos: first, alpha: Math.min(1, t / HAND_FADE * 1.4), pressed: true, trail: [first], links: 1 };
  let at = t - HAND_PRESS;
  const trail: Vec[] = [first];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y), dur = len / HAND_SPEED;
    if (at < dur) {
      const k = len > 0 ? at / dur : 1, pos = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      return { pos, alpha: 1, pressed: true, trail: [...trail, pos], links: i };
    }
    at -= dur;
    trail.push(b);
    if (at < HAND_PAUSE) return { pos: b, alpha: 1, pressed: true, trail, links: i + 1 };
    at -= HAND_PAUSE;
  }
  if (at < HAND_HOLD) return { pos: last, alpha: 1, pressed: true, trail, links: points.length };
  at -= HAND_HOLD;
  return { pos: last, alpha: Math.max(0, 1 - at / HAND_FADE), pressed: false, trail, links: points.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels at the place
// ---------------------------------------------------------------------------------------------------------------------

/** The only texts of the prologue's world (≤ 3 words, one at a time, until the action). */
export const PROLOGUE_LABEL_TEXT = { hold: 'Зажми и веди', free: 'Цвет свободен', lever: 'Закончи цепь здесь' } as const;
/** The ids of the labels in `WorldLabelLayer` (the tests read them in `snapshot().onboarding.labels`). */
export const PROLOGUE_LABEL_IDS = { hold: 'pl1', free: 'pl4', lever: 'pl5' } as const;
/** The place of the 6th blue (index in the template) whose label says «Цвет свободен»: the colour shift comes at the 6th link. */
const SIXTH_BLUE = 5;
/** A label is gone for the room once its action is done (it does not come back after a return of the enemies). */
export interface PrologueLabelMemo { done: boolean }

/**
 * The prologue's label of room `n` now, or null (rooms 2, 3 and 5–7, 9 — none; task 9 numbers). One at a time, at the object,
 * until the action (by the room's arena id, so the numbers may move):
 * - room 1 «Зажми и веди» at the nearest start enemy — gone with the first link;
 * - room 4 «Цвет свободен» at the 6th blue — comes when the drawn chain reaches the 5th link, gone with the shift (the 6th link);
 * - room 8 «Гоблин» (`prologue-5`) «Закончи цепь здесь» at the lever — gone with the first pull.
 * `memo` keeps the done actions of the room (a new room starts with `{done:false}`).
 */
export function prologueLabel(w: World, n: number, memo: PrologueLabelMemo): LabelSpec | null {
  if (w.status !== 'playing' || memo.done) return null;
  const ids = startEnemyIds(w), id = prologueRoom(n).id;
  if (id === 'prologue-1') {
    if (w.chain.length || w.move || w.stats.kills) { memo.done = true; return null; }
    let near: { x: number; y: number } | null = null, best = Infinity;
    for (const id of ids) {
      const e = w.enemies.find(x => x.id === id);
      if (!e) continue;
      const d = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2;
      if (d < best) { best = d; near = e; }
    }
    return near ? { id: PROLOGUE_LABEL_IDS.hold, text: PROLOGUE_LABEL_TEXT.hold, at: { x: near.x, y: near.y }, place: 'above', lift: 0.9 } : null;
  }
  if (id === 'prologue-4') {
    if (w.chain.length >= 6 || (w.move?.kind === 'dash' && w.move.kills >= 6) || w.stats.bestChain >= 6) { memo.done = true; return null; }
    if (w.chain.length < 5) return null;
    const e = w.enemies.find(x => x.id === ids[SIXTH_BLUE]);
    return e ? { id: PROLOGUE_LABEL_IDS.free, text: PROLOGUE_LABEL_TEXT.free, at: { x: e.x, y: e.y }, place: 'above', lift: 0.9 } : null;
  }
  if (id === 'prologue-5') {
    const g = goblinOf(w), lever = leverOf(w);
    if (!g || !lever) return null;
    if (g.pulls > 0) { memo.done = true; return null; }
    // At the red knob of the lever (slotView.ts `drawIdol`: the knob stands 1.07 object radii right of the idol's point), to its right and at the idol's height (a row higher meets the odds line and the blue ones round the idol).
    return { id: PROLOGUE_LABEL_IDS.lever, text: PROLOGUE_LABEL_TEXT.lever, at: { x: lever.x + OBJECT_RADIUS * 1.07, y: lever.y - 0.1 }, place: 'side', lift: 0.25 };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hooks for the telemetry (telemetry/prologue.ts records through them; the page also keeps a log for the tests)
// ---------------------------------------------------------------------------------------------------------------------

/** How a room ended. */
export type RoomOutcome = 'win' | 'death' | 'skip';
/** The points the prologue's telemetry takes: a room starts (attempt from 1), a room ends (game and real seconds spent in the attempt), the hand or the arrow shows, the start enemies come back, the viewer skips. */
export interface PrologueHooks {
  roomStart?(room: number, attempt: number): void;
  roomEnd?(room: number, attempt: number, outcome: RoomOutcome, seconds: number, realSeconds: number): void;
  handShown?(room: number, kind: 'hand' | 'arrow'): void;
  /** The start enemies came back (one return; the late batch of posts under the hero — event `restore` with `late` — is not a new one). */
  restore?(room: number): void;
  skip?(room: number): void;
  /** The whole prologue ends (the last room won, or skipped). */
  end?(how: 'done' | 'skip'): void;
}
