/**
 * Task 14 «Котомка у двери» (design 13.10.2026; sim/bag.ts, docs/realtime-slice.md): the view of the bag. When the goals open the
 * door a sack stands beside it (on the arena's side) with three marks under it — one per step: gold when filled, a gold arc on the
 * step being filled, dark ahead — and a number over it: the kills toward the step and its resources («12/20 · +2»; all filled —
 * «✓ +6»). A filled step: the sack flashes and «+2» rises from it. A real HP loss that took progress: the step's mark dims a moment
 * and a pale «сброс» rises. Nothing in the top HUD; the door of a fight without the bag (the run's row 1) has no sack. The result
 * screen has the line «Котомка» (`bagResultLine`). Drawing only: every number is the sim's (`bagProgress`, the `bag` events).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { BAG_STEPS, bagProgress, type BagProgress } from '../sim/bag';
import { RESOURCE_KINDS, type ResourceKind } from '../sim/kit';
import type { World } from '../sim/world';
import { RESOURCES } from '../forest/resources';

/** One mark of a step: filled, the one being filled, or ahead. */
export type BagMark = 'full' | 'filling' | 'empty';

/** The number over the sack: kills toward the unfilled step and its reward, or «✓ +total» with every step filled. */
export function bagLabel(p: BagProgress): string {
  return p.to === null ? `✓ +${p.total}` : `${p.kills}/${p.to} · +${p.reward}`;
}

/** The three marks under the sack. */
export function bagMarks(p: BagProgress): BagMark[] {
  return Array.from({ length: BAG_STEPS }, (_, i) => (i < p.step ? 'full' : i === p.step ? 'filling' : 'empty'));
}

/** How far the step being filled is (0–1); 1 with every step filled. */
export function bagFraction(p: BagProgress): number {
  return p.to === null ? 1 : Math.max(0, Math.min(1, (p.kills - p.from) / Math.max(1, p.to - p.from)));
}

/**
 * The result screen's line «Котомка»: what the door paid with its kinds («+3 — 2 Роса, 1 Смола»), «0» with no step filled, and
 * «0 (поражение)» when steps were filled but the fight was lost (a defeat pays nothing).
 */
export function bagResultLine(paid: Partial<Record<ResourceKind, number>> | null, filledTotal: number, won: boolean): string {
  const kinds = paid ? RESOURCE_KINDS.filter(k => (paid[k] ?? 0) > 0) : [];
  if (won && kinds.length) {
    const sum = kinds.reduce((s, k) => s + paid![k]!, 0);
    return `+${sum} — ${kinds.map(k => `${paid![k]} ${RESOURCES[k].label}`).join(', ')}`;
  }
  return !won && filledTotal > 0 ? '0 (поражение)' : '0';
}

/** Arena units from the door's centre to the sack's: beside the door, on the arena's side of it. */
export const BAG_OFFSET = 1.5;
const GOLD = 0xffd36b, NAVY = 0x1a2330, SACK = 0x9b7447, SACK_DARK = 0x6e5030, TIE = 0xd9b36b, DIM = 0x8a8a7c;
/** The sack's size (its half-height in px is about this times the unit); the number stands over it, the marks under it. */
export const BAG_SIZE = 0.5;
/** Arena units from the top edge within which the sack's number goes under it (`BagView.under`). */
export const BAG_TOP = 2.5;
/** Real seconds of the sack's flash on a filled step, and of the dimmed mark on a reset. */
export const BAG_FLASH = 0.5;
export const BAG_DIM = 0.6;

export class BagView {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private readonly label = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: 0x200c08, width: 4 } } });
  private flash = 0;
  private dim = 0;
  private dimMark = 0;
  /** Tests read it: what the bag view drew in the last frame, and the flashes and resets shown in this fight. */
  readonly shown = { visible: false, label: '', marks: [] as BagMark[], dimmed: false, flashing: false, steps: 0, resets: 0, x: 0, y: 0, under: false };

  constructor(private readonly unit: number) {
    this.label.anchor.set(0.5, 1);
    this.layer.addChild(this.g, this.label);
    this.layer.visible = false;
  }

  /**
   * A door by the arena's top edge (the camera stops there, the HUD covers the strip above it): the number stands under the marks
   * and the texts of a step or a reset drift down from under it.
   */
  static under(world: World): boolean {
    const spot = BagView.spot(world);
    return !!spot && spot.y < BAG_TOP;
  }

  /** The sack's point in arena units: beside the door, towards the arena's middle (null — no door). */
  static spot(world: World): { x: number; y: number } | null {
    const door = world.objects.find(o => o.kind === 'door');
    if (!door) return null;
    return { x: door.x + (door.x > world.arena.width / 2 ? -BAG_OFFSET : BAG_OFFSET), y: door.y };
  }

  /**
   * A `bag` event of the sim: a step filled (flash) or a reset (the step's mark dims). Returns where its text («+N», «сброс») starts,
   * in px, and its drift: beyond the number (over it, or under it by the top edge), so the two never overlap. `lift` — px more
   * beyond it (task 16: the feat's line stands over the number while the door is open).
   */
  onEvent(world: World, ev: { action: 'appear' | 'step' | 'reset'; step: number }, lift = 0): { x: number; y: number; dir: number } | null {
    const spot = BagView.spot(world), s = this.unit * BAG_SIZE, under = BagView.under(world);
    const at = spot ? { x: spot.x * this.unit, y: spot.y * this.unit + (under ? s * 1.8 + 52 + lift : -s * 1.1 - 34 - lift), dir: under ? 45 : -45 } : null;
    if (ev.action === 'step') { this.flash = BAG_FLASH; this.shown.steps++; }
    else if (ev.action === 'reset') { this.dim = BAG_DIM; this.dimMark = ev.step; this.shown.resets++; }
    return at;
  }

  draw(world: World, clock: number, dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    this.dim = Math.max(0, this.dim - dt);
    const p = bagProgress(world), at = BagView.spot(world), shown = this.shown;
    shown.visible = !!p && !!at && world.status === 'playing';
    this.layer.visible = shown.visible;
    if (!shown.visible) { shown.label = ''; shown.marks = []; shown.dimmed = false; shown.flashing = false; return; }
    const u = this.unit, x = at!.x * u, y = at!.y * u, s = u * BAG_SIZE, marks = bagMarks(p!), g = this.g.clear();
    shown.x = at!.x; shown.y = at!.y; shown.marks = marks; shown.flashing = this.flash > 0; shown.dimmed = this.dim > 0;
    // The flash of a filled step: a gold glow behind the sack, fading.
    if (this.flash > 0) {
      const k = this.flash / BAG_FLASH;
      g.circle(x, y, s * (1.7 + 0.5 * (1 - k))).fill({ color: GOLD, alpha: 0.45 * k });
    }
    // The sack: a round body, a gathered neck and its tie; a glint of gold inside once a step is filled.
    g.ellipse(x, y + s * 0.95, s * 0.95, s * 0.28).fill({ color: 0x050a07, alpha: 0.4 });
    g.ellipse(x, y + s * 0.15, s * 0.9, s * 0.78).fill(SACK).stroke({ color: NAVY, width: 3 });
    g.ellipse(x - s * 0.3, y - s * 0.05, s * 0.22, s * 0.32).fill({ color: 0xffffff, alpha: 0.12 });
    g.poly([x - s * 0.32, y - s * 0.5, x + s * 0.32, y - s * 0.5, x + s * 0.5, y - s * 0.98, x - s * 0.5, y - s * 0.98]).fill(SACK_DARK).stroke({ color: NAVY, width: 3, join: 'round' });
    g.roundRect(x - s * 0.4, y - s * 0.62, s * 0.8, s * 0.16, 3).fill(TIE).stroke({ color: NAVY, width: 2 });
    if (p!.step > 0) g.circle(x, y - s * 0.5, s * 0.16 + s * 0.05 * p!.step).fill({ color: GOLD, alpha: 0.85 });
    // The marks under the sack: filled gold, the one being filled with its gold arc, the rest dark.
    const r = s * 0.3, gap = s * 0.82, my = y + s * 1.45;
    for (let i = 0; i < marks.length; i++) {
      const mx = x + (i - (marks.length - 1) / 2) * gap, dimmed = this.dim > 0 && i === this.dimMark;
      if (marks[i] === 'full') { g.circle(mx, my, r).fill(GOLD).stroke({ color: NAVY, width: 2.5 }); continue; }
      g.circle(mx, my, r).fill({ color: 0x2a2418, alpha: marks[i] === 'empty' ? 0.6 : 0.9 }).stroke({ color: dimmed ? DIM : NAVY, width: 2.5 });
      if (marks[i] === 'filling') {
        const f = bagFraction(p!);
        if (f > 0) g.moveTo(mx, my).arc(mx, my, r - 1, -Math.PI / 2, -Math.PI / 2 + f * 2 * Math.PI).lineTo(mx, my).fill({ color: dimmed ? DIM : GOLD, alpha: 0.85 });
        if (dimmed) g.circle(mx, my, r + 3).stroke({ color: DIM, width: 2, alpha: this.dim / BAG_DIM });
      }
    }
    // The number over the sack: gold once every step is filled, a little larger while a step flashes.
    const text = bagLabel(p!);
    if (this.label.text !== text) this.label.text = text;
    this.label.style.fill = p!.to === null ? GOLD : 0xfff2c4;
    this.label.scale.set(1 + 0.25 * (this.flash / BAG_FLASH));
    this.label.alpha = this.dim > 0 ? 0.6 + 0.4 * (1 - this.dim / BAG_DIM) : 1;
    const under = BagView.under(world);
    this.label.anchor.set(0.5, under ? 0 : 1);
    this.label.position.set(x, (under ? y + s * 1.8 : y - s * 1.1) - 2 * Math.sin(clock * 2));
    shown.under = under;
    shown.label = text;
  }

  /** A new fight: no flash, no dim, the counts start again. */
  reset(): void {
    this.flash = 0; this.dim = 0;
    Object.assign(this.shown, { visible: false, label: '', marks: [], dimmed: false, flashing: false, steps: 0, resets: 0 });
    this.layer.visible = false;
  }
}
