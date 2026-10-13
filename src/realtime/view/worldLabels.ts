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
import { OBJECT_RADIUS } from '../sim/chain';
import { leverOf } from '../sim/slot';
import { BUILD_SOURCES } from '../sim/buildIds';

/** The three labels of the run (the ids are the v1 hints' Б6, Б8, Б9: the memory and the run record keep their keys). */
export type LabelId = 'b6' | 'b8' | 'b9';
/** A label to show: its id, text, the world point of its object and where it hangs relative to it. */
export interface LabelSpec {
  id: string;
  text: string;
  /** The object's point (arena units). */
  at: Vec;
  /** 'above' — centred over the point, `lift` arena units up; 'below' — centred under it, `lift` units down (over it when there is no room under: the elite's tags and chips hang over it and under it, so the label stands clear of both); 'side' — to the right of it (to the left when the right edge is near), `lift` units away. */
  place: 'above' | 'below' | 'side';
  lift: number;
  /** 'side' only: a point (arena units) the label keeps away from — it stands on the other side of `at` when there is room (the door by the goblin, design 13.10.2026). */
  away?: Vec;
  /** A point (arena units) the label's tail points at (the lever's knob); none — no tail. */
  tail?: Vec;
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
const ELITE_LIFT = 1.0, CHEST_LIFT = 0.85, LEVER_SIDE = 1.15;

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
  if (elite) out.push({ id: 'b6', text: LABEL_TEXT.elite, at: { x: elite.x, y: elite.y }, place: 'below', lift: ELITE_LIFT });
  const chest = w.objects.find(o => o.kind === 'chest' && onScreen(o));
  if (chest) out.push({ id: 'b8', text: chestText(), at: { x: chest.x, y: chest.y }, place: 'above', lift: CHEST_LIFT });
  const lever = leverOf(w);
  if (lever && onScreen(lever)) {
    // Design 13.10.2026 (task 11 shots): the label read as the door's when the door stood beside it — it stands on the idol's side
    // away from the door, and its tail points at the lever's red knob (slotView.ts `drawIdol`: 1.07 object radii right of the idol).
    const door = w.objects.find(o => o.kind === 'door');
    out.push({ id: 'b9', text: LABEL_TEXT.lever, at: { x: lever.x, y: lever.y }, place: 'side', lift: LEVER_SIDE, ...door ? { away: { x: door.x, y: door.y } } : {}, tail: leverKnob(lever) });
  }
  return out;
}

/** The lever's red knob (arena units): slotView.ts `drawIdol` draws it 1.07 object radii right of the idol's point, a little up. */
export function leverKnob(lever: Vec): Vec { return { x: lever.x + OBJECT_RADIUS * 1.07, y: lever.y - 0.1 }; }

/** Which side of the label the tail sits on to point at `p` (stage px), or none when `p` is inside it. */
export function tailSide(rect: Rect, p: Vec): 'left' | 'right' | 'up' | 'down' | null {
  if (p.x < rect.left) return 'left';
  if (p.x > rect.right) return 'right';
  if (p.y < rect.top) return 'up';
  if (p.y > rect.bottom) return 'down';
  return null;
}

/** Sources whose strip of a plate is the PLAYER's (`elitePlates` `source`): the chain, the spin (Q), the items, the goblin's effects, the tools of the player's build (a hammer's fire, blast, cut and return, the wave: `BUILD_SOURCES`). The archer's arrow, a sapper's blast, a push and the elite's own fire trail (`fire-trail`, an enemy's property) are not. */
export const PLAYER_PLATE_SOURCES: ReadonlySet<string> = new Set(['chain', 'spin', 'bomb', 'fire', 'slot', ...Object.values(BUILD_SOURCES)]);

/**
 * The labels whose action was done in this frame (read from `w.events`, before they are cleared): a plate of any elite taken off
 * BY THE PLAYER (event `elitePlates` `strip`, whatever the way: the chain, the spin Q, a bomb, fire, the goblin), the chest
 * taken, the first pull of the lever.
 */
export function labelActions(w: World): LabelId[] {
  const ids: LabelId[] = [];
  const events = w.events;
  if (events.some(e => e.type === 'elitePlates' && e.action === 'strip' && e.source !== undefined && PLAYER_PLATE_SOURCES.has(e.source))) ids.push('b6');
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
export function placeLabel(spec: Pick<LabelSpec, 'place' | 'lift'> & { /** In the same space as `at` (stage px). */ away?: Vec }, at: Vec, k: number, size: { w: number; h: number }, bounds: Rect, gap = 6, avoid: readonly Rect[] = [], bodies: readonly Rect[] = []): Rect {
  const clampTo = (left: number, top: number): Rect => {
    left = Math.max(bounds.left + gap, Math.min(bounds.right - gap - size.w, left));
    top = Math.max(bounds.top + gap, Math.min(bounds.bottom - gap - size.h, top));
    return { left, top, right: left + size.w, bottom: top + size.h };
  };
  const spot = (kind: 'above' | 'below' | 'side' | 'left'): Rect => {
    if (kind === 'above') return clampTo(at.x - size.w / 2, at.y - spec.lift * k - size.h);
    if (kind === 'below') {
      // No room under the object (the action bar, the screen edge): over it, as the 'side' label flips to the other side.
      let top = at.y + spec.lift * k;
      if (top + size.h > bounds.bottom - gap) top = at.y - spec.lift * k - size.h;
      return clampTo(at.x - size.w / 2, top);
    }
    if (kind === 'left') return clampTo(at.x - spec.lift * k - size.w, at.y - size.h / 2);
    const right = at.x + spec.lift * k, left = at.x - spec.lift * k - size.w;
    const rightFits = right + size.w <= bounds.right - gap, leftFits = left >= bounds.left + gap;
    // Away from `away` (it stands right of the point: the left side first) while that side has room; else as before — right, left at the edge.
    const goLeft = spec.away && spec.away.x >= at.x ? leftFits || !rightFits : !rightFits;
    return clampTo(goLeft ? left : right, at.y - size.h / 2);
  };
  const hits = (r: Rect, list: readonly Rect[]): Rect | undefined => list.find(a => r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top);
  let rect = spot(spec.place);
  // Clear of the bodies of the enemies (review 12.10.2026): the first of the other places that covers none; none — as it was.
  if (bodies.length && hits(rect, bodies)) {
    const order = (['above', 'below', 'side', 'left'] as const).filter(kind => kind !== spec.place);
    const free = order.map(spot).find(r => !hits(r, bodies));
    if (free) rect = free;
  }
  let { left, top } = rect;
  // Clear of the elite plaques and caption plates (`avoid`): under the plate that is in the way, else over it.
  for (let pass = 0; pass < avoid.length; pass++) {
    const hit = hits({ left, top, right: left + size.w, bottom: top + size.h }, avoid);
    if (!hit) break;
    const under = hit.bottom + 4, over = hit.top - 4 - size.h;
    top = under + size.h <= bounds.bottom - gap ? under : Math.max(bounds.top + gap, over);
  }
  return { left, top, right: left + size.w, bottom: top + size.h };
}

/** What the layer shows now (the tests read it through `snapshot().onboarding.labels`). */
export interface ShownLabel extends Rect { id: string; text: string; tail?: 'left' | 'right' | 'up' | 'down' }

/** The DOM layer of the labels: an element per id, made when the label first shows, hidden when it goes. */
export class WorldLabelLayer {
  private readonly els = new Map<string, HTMLElement>();
  private shownNow: ShownLabel[] = [];
  constructor(private readonly parent: HTMLElement) {}

  /** `project` — arena units to px of the stage; `k` — px per arena unit; `bounds` — where a label may stand; `avoid` — rectangles (the elite plaques) it keeps clear of. Returns the ids that appeared in this call. */
  update(specs: readonly LabelSpec[], project: (x: number, y: number) => Vec, k: number, bounds: Rect, avoid: readonly Rect[] = [], bodies: readonly Rect[] = []): string[] {
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
      // `placeLabel` works in stage px: the point to keep away from is projected as the label's own point.
      const rect = placeLabel({ place: spec.place, lift: spec.lift, ...spec.away ? { away: project(spec.away.x, spec.away.y) } : {} }, project(spec.at.x, spec.at.y), k, { w: el.offsetWidth, h: el.offsetHeight }, bounds, 6, avoid, bodies);
      el.style.left = `${Math.round(rect.left)}px`;
      el.style.top = `${Math.round(rect.top)}px`;
      const side = spec.tail ? tailSide(rect, project(spec.tail.x, spec.tail.y)) : null;
      if (side) el.dataset.tail = side; else delete el.dataset.tail;
      keep.add(spec.id);
      this.shownNow.push({ id: spec.id, text: spec.text, ...rect, ...side ? { tail: side } : {} });
    }
    for (const [id, el] of this.els) if (!keep.has(id) && !el.hidden) el.hidden = true;
    return appeared;
  }

  hideAll(): void { for (const el of this.els.values()) el.hidden = true; this.shownNow = []; }
  shown(): ShownLabel[] { return this.shownNow.map(l => ({ ...l })); }
}
