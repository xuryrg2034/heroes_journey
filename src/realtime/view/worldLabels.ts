/**
 * World labels (task 6, 12.10.2026; docs/realtime-onboarding.md): a short verb or price AT an object of the arena, instead of the
 * box of hints at the bottom. A view feature only: it reads the world and its events, never changes them, is not a Param and
 * never in the journal, the hash or the run save.
 *
 * - **Rules of a label** — at most 4 words (the chest's price is the exception the design named), at a world point with an
 *   offset (it moves with the camera), one label per object, ONE per id on screen, stays until the player does the action it
 *   names (not on a timer), and is shown once per viewer: the action marks the id in the viewer's memory (`HintStore`).
 * - **Pure part** (testable in Node, `npm run test:realtime-hints`): `detectLabels` (what stands now), `labelActions` (what was
 *   done in the frame, from the frame's events — read BEFORE main.ts clears them), `placeLabel` (where the box goes).
 * - **DOM part** — `WorldLabelLayer`: absolutely positioned elements over the stage; they never take the pointer. It will also
 *   serve the prologue's labels («Зажми и веди», «Цвет свободен», «Закончи цепь здесь»).
 * - The numbers in the texts come from the code (`sim/chest.ts`), not from literals.
 */
import type { Vec } from '../sim/geometry';
import type { World } from '../sim/world';
import { CHEST_CURSE_KILLS, CHEST_CURSE_TOUCH } from '../sim/chest';
import { leverOf } from '../sim/slot';

/** The three labels of the run (the ids are the v1 hints' Б6, Б8, Б9: the memory and the run record keep their keys). */
export type LabelId = 'b6' | 'b8' | 'b9';
/** A label to show: its id, text, the world point of its object and where it hangs relative to it. */
export interface LabelSpec {
  id: string;
  text: string;
  /** The object's point (arena units). */
  at: Vec;
  /** 'above' — centred over the point, `lift` arena units up; 'side' — to the right of it (to the left when the right edge is near), `lift` units away. */
  place: 'above' | 'side';
  lift: number;
}

export const LABEL_TEXT = {
  /** Б6: an armoured elite — its plate takes one hit. */
  elite: 'Пластина — 1 удар',
  /** Б9: the goblin's lever. */
  lever: 'Закончи цепь здесь',
} as const;
/** Б8: the price of the chest of «Застава», both numbers read from `sim/chest.ts`. */
export const chestText = (): string => `+${CHEST_CURSE_TOUCH} урон касания, ${CHEST_CURSE_KILLS} убийств`;

/** Arena units: how high above an elite's centre the label hangs; above the chest; how far the goblin's label stands from the idol's centre. */
const ELITE_LIFT = 1.15, CHEST_LIFT = 0.85, LEVER_SIDE = 1.15;

/**
 * The labels whose object stands now: an armoured enemy with plates left in view (the nearest to the hero — one label for all
 * the elites), the chest in view, the goblin's lever in view. `onScreen` is the camera's view (renderer.sees). The caller drops
 * the ids the viewer has done.
 */
export function detectLabels(w: World, onScreen: (p: Vec) => boolean): LabelSpec[] {
  const out: LabelSpec[] = [];
  let elite: typeof w.enemies[number] | null = null, best = Infinity;
  for (const e of w.enemies) {
    if (!e.armor || e.armor.plates <= 0 || !onScreen(e)) continue;
    const d = (e.x - w.hero.x) ** 2 + (e.y - w.hero.y) ** 2;
    if (d < best) { best = d; elite = e; }
  }
  if (elite) out.push({ id: 'b6', text: LABEL_TEXT.elite, at: { x: elite.x, y: elite.y }, place: 'above', lift: ELITE_LIFT });
  const chest = w.objects.find(o => o.kind === 'chest' && onScreen(o));
  if (chest) out.push({ id: 'b8', text: chestText(), at: { x: chest.x, y: chest.y }, place: 'above', lift: CHEST_LIFT });
  const lever = leverOf(w);
  if (lever && onScreen(lever)) out.push({ id: 'b9', text: LABEL_TEXT.lever, at: { x: lever.x, y: lever.y }, place: 'side', lift: LEVER_SIDE });
  return out;
}

/**
 * The labels whose action was done in this frame (read from `w.events`, before they are cleared): the first plate taken off
 * (any elite's), the chest taken, the first pull of the lever.
 */
export function labelActions(w: World): LabelId[] {
  const ids: LabelId[] = [];
  const events = w.events;
  if (events.some(e => e.type === 'chainHit' && e.plates !== undefined)) ids.push('b6');
  if (events.some(e => e.type === 'chest')) ids.push('b8');
  if (events.some(e => e.type === 'slot' && e.action === 'pull')) ids.push('b9');
  return ids;
}

/** A pixel rectangle. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where a label of size `size` goes, in px of the stage: from the object's screen point `at`, `k` px per arena unit, kept
 * inside `bounds` (the stage minus the HUD plate and the action bar). A 'side' label flips to the left of the object when the
 * right does not fit.
 */
export function placeLabel(spec: Pick<LabelSpec, 'place' | 'lift'>, at: Vec, k: number, size: { w: number; h: number }, bounds: Rect, gap = 6): Rect {
  let left: number, top: number;
  if (spec.place === 'above') {
    left = at.x - size.w / 2; top = at.y - spec.lift * k - size.h;
  } else {
    left = at.x + spec.lift * k; top = at.y - size.h / 2;
    if (left + size.w > bounds.right - gap) left = at.x - spec.lift * k - size.w;
  }
  left = Math.max(bounds.left + gap, Math.min(bounds.right - gap - size.w, left));
  top = Math.max(bounds.top + gap, Math.min(bounds.bottom - gap - size.h, top));
  return { left, top, right: left + size.w, bottom: top + size.h };
}

/** What the layer shows now (the tests read it through `snapshot().onboarding.labels`). */
export interface ShownLabel extends Rect { id: string; text: string }

/** The DOM layer of the labels: an element per id, made when the label first shows, hidden when it goes. */
export class WorldLabelLayer {
  private readonly els = new Map<string, HTMLElement>();
  private shownNow: ShownLabel[] = [];
  constructor(private readonly parent: HTMLElement) {}

  /** `project` — arena units to px of the stage; `k` — px per arena unit; `bounds` — where a label may stand. Returns the ids that appeared in this call. */
  update(specs: readonly LabelSpec[], project: (x: number, y: number) => Vec, k: number, bounds: Rect): string[] {
    const appeared: string[] = [], keep = new Set<string>();
    this.shownNow = [];
    for (const spec of specs) {
      let el = this.els.get(spec.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rt-world-label';
        el.setAttribute('data-testid', 'world-label');
        el.dataset.id = spec.id;
        el.hidden = true;
        this.parent.append(el);
        this.els.set(spec.id, el);
      }
      if (el.hidden) appeared.push(spec.id);
      if (el.textContent !== spec.text) el.textContent = spec.text;
      el.hidden = false;
      const rect = placeLabel(spec, project(spec.at.x, spec.at.y), k, { w: el.offsetWidth, h: el.offsetHeight }, bounds);
      el.style.left = `${Math.round(rect.left)}px`;
      el.style.top = `${Math.round(rect.top)}px`;
      keep.add(spec.id);
      this.shownNow.push({ id: spec.id, text: spec.text, ...rect });
    }
    for (const [id, el] of this.els) if (!keep.has(id) && !el.hidden) el.hidden = true;
    return appeared;
  }

  hideAll(): void { for (const el of this.els.values()) el.hidden = true; this.shownNow = []; }
  shown(): ShownLabel[] { return this.shownNow.map(l => ({ ...l })); }
}
