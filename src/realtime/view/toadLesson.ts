/**
 * Task 49 «Второй герой», the lesson of the mage on the spot (docs/design-notes/task-49-second-hero.md, section 8; docs/realtime-onboarding.md):
 * no plates, two labels at the hero and the ghost hand, each once per viewer (`HintStore` — the profile in the run, the page in the sandbox).
 *
 * - «Замкни на себя»: the hero's ring is available (view/loopHint.ts `findLoopHint`, the arc on the hero) and no chain is drawn — the label
 *   hangs at the hero, after `TOAD_HAND_IDLE` of rest the ghost hand draws that ring on its links. The first seal of the viewer ends both.
 * - «Без кольца — без щита»: the first hit on the hero right after an open chain that killed (the price of the law: sim/heroLaw.ts, no shield
 *   without a seal) — a short crack on the hero and the label for `TOAD_BARE_LIFE` s, once.
 * - After the first seal the glow of the shield it gives is brighter than ordinary (`boost`): the player sees where the shield came from.
 *
 * A view feature only: it reads the world and its events (called before the frame's events are cleared), never changes them; no Param, no
 * journal, no hash, no run save. The rules are the sim's (`seal` events, `hit`, `chainEnd`, `hero.chainShield`), nothing is computed here.
 */
import type { Vec } from '../sim/geometry';
import { HERO_LAWS } from '../sim/buildIds';
import type { World } from '../sim/world';
import type { HintStore } from './hints';
import type { LoopHintFigure } from './loopHint';
import type { LabelSpec } from './worldLabels';

/** The viewer's memory keys (`HintStore`): the first seal made (the ring's lesson is done), the price's label shown. */
export const TOAD_KEYS = { ring: 'toad-ring', bare: 'toad-bare' } as const;
export const TOAD_TEXT = { ring: 'Замкни на себя', bare: 'Без кольца — без щита' } as const;
/** Real seconds of rest (with the arc on the hero available) before the hand draws the ring. */
export const TOAD_HAND_IDLE = 2.5;
/** Real seconds «Без кольца — без щита» stays, and the game seconds after an open chain in which a hit is «right after» it. */
export const TOAD_BARE_LIFE = 2.4;
export const TOAD_BARE_WINDOW = 1.5;
/** Arena units: how high over the hero the labels hang. */
const LABEL_LIFT = 1.0;

/** The world's hero is Ведунья: her law module is in the kit (`Loadout.hero` `toad`). */
export const isToad = (w: World): boolean => !!w.kit?.talismans.includes(HERO_LAWS.toad);

/** What the lesson shows in one frame. */
export interface ToadLessonFrame {
  specs: LabelSpec[];
  /** The ghost hand's links (arena units, in order); empty — no hand. */
  hand: Vec[];
  /** The crack started in this frame. */
  crack: boolean;
  /** The shield's glow is the brighter one (the first seal's). */
  boost: boolean;
}

export class ToadLesson {
  private sealedDash = false;
  private openAt = -Infinity;
  private idle = 0;
  private bareLeft = 0;
  private boost = false;
  private shieldSeen = false;

  constructor(private readonly store: HintStore) {}

  /** A new fight: nothing of the last one is left (the memory stays). */
  reset(): void { this.sealedDash = false; this.openAt = -Infinity; this.idle = 0; this.bareLeft = 0; this.boost = false; this.shieldSeen = false; }

  /** The arc on the hero is wanted this frame: the ring's lesson not done yet. */
  needsFigure(w: World): boolean { return isToad(w) && this.store.count(TOAD_KEYS.ring) === 0 && w.status === 'playing' && !w.chain.length && !w.move; }

  /**
   * One frame. `dt` — real seconds the fight is live (0 while it is not); `figure` — the arc on the hero of the last search (null — none);
   * the world's events of the frame are still in `w.events`.
   */
  frame(w: World, dt: number, figure: LoopHintFigure | null): ToadLessonFrame {
    let crack = false, ended = false;
    for (const ev of w.events) {
      if (ev.type === 'seal' && ev.phase === 'release') {
        this.sealedDash = true;
        if (this.store.count(TOAD_KEYS.ring) === 0) { this.store.bump(TOAD_KEYS.ring); this.boost = true; this.shieldSeen = false; }
      } else if (ev.type === 'chainEnd') {
        if (ev.kills > 0 && !this.sealedDash) this.openAt = w.time;
        this.sealedDash = false; ended = true;
      } else if (ev.type === 'hit' && ev.damage > 0 && w.time - this.openAt <= TOAD_BARE_WINDOW && w.hero.chainShield <= 0 && this.store.count(TOAD_KEYS.bare) === 0) {
        this.store.bump(TOAD_KEYS.bare); this.bareLeft = TOAD_BARE_LIFE; crack = true;
      }
    }
    // The brighter glow lasts the first seal's shield: gone with it, or at once when the dash gave none.
    if (this.boost) {
      if (w.hero.chainShield > 0) this.shieldSeen = true;
      else if (this.shieldSeen || ended) this.boost = false;
    }
    if (this.bareLeft > 0) this.bareLeft -= dt;
    const ringLesson = this.store.count(TOAD_KEYS.ring) === 0 && w.status === 'playing' && !w.chain.length && !w.move && !!figure;
    this.idle = ringLesson ? this.idle + dt : 0;
    const at = { x: w.hero.x, y: w.hero.y }, specs: LabelSpec[] = [];
    if (this.bareLeft > 0 && w.status === 'playing') specs.push({ id: TOAD_KEYS.bare, text: TOAD_TEXT.bare, at, place: 'above', lift: LABEL_LIFT });
    else if (ringLesson) specs.push({ id: TOAD_KEYS.ring, text: TOAD_TEXT.ring, at, place: 'above', lift: LABEL_LIFT });
    const hand = ringLesson && this.idle >= TOAD_HAND_IDLE && figure ? figure.ring.slice(1).map(v => ({ x: v.x, y: v.y })) : [];
    return { specs, hand, crack, boost: this.boost };
  }
}
