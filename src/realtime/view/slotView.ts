/**
 * Casino stage 1: the view of «Однорукий гоблин» (sim/slot.ts; docs/realtime-casino.md). Simple shapes in the art language
 * of the arena (navy outline, flat colours): a stone goblin idol with a lever on its side; the 2 s marker with a gold rim; the
 * three reels over the idol — they spin 1.2 s and stop one by one, then the result glows; the lever dark during the cooldown
 * and after the last pull; the odds line «дождь N % · залп M %» over the idol while the drawn chain can end on the lever.
 * Nothing in the HUD. Drawing only: it reads the world and the plan, it never changes them. The arrow marks are drawn by the
 * renderer with the archer's mark (render.ts `drawSignals`).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { OBJECT_RADIUS } from '../sim/chain';
import { goblinOf, leverReady, type SlotOutcome, type SlotSymbol } from '../sim/slot';
import { slotOddsText, type SlotPlanOdds } from '../sim/slotPlan';
import type { World, WorldEvent } from '../sim/world';

const NAVY = 0x18232d;
const STONE = 0x7d8577;
const STONE_DARK = 0x565d52;
const MOSS = 0x6f8a52;
const GOLD = 0xffd36b;
const LEVER_KNOB = 0xc8423a;
const DARK_KNOB = 0x4a4a48;
const REEL_BG = 0xf2e6c8;
const SKULL = 0xeadbb9;
/** Real seconds the result of a pull glows over the idol after the 3rd reel. */
const RESULT_LIFE = 1.6;
/** The reels stand this many object radii over the idol: above the combo counter of a hero standing on the lever. */
const REELS_UP = 4.2;
/** Symbols a spinning reel runs through (drawing only). */
const CYCLE: readonly SlotSymbol[] = ['heart', 'skull', 'bolt', 'gem', 'skull', 'pot'];

/** The outcome as a short word for the floating text over the idol. */
export const OUTCOME_TEXT: Readonly<Record<SlotOutcome, string>> = {
  rain: 'дождь стрел!', volley: 'залп!', heart3: '+3 HP', bolt3: 'энергия полна', gem3: '3 кристалла', jackpot: 'джекпот!',
  heart: '+1 HP', bolt: '+1 энергия', gem: 'кристалл', pot: 'добыча', none: 'хе-хе',
};

/** What the slot view drew (tests read it): last frame — idols, markers, spinning reels, dark levers, odds lines; totals — pulls, results. */
export interface SlotShown { idols: number; markers: number; spinning: number; stopped: number; dark: number; odds: number; oddsText: string; pulls: number; results: number; lastResult: string }

export class SlotView {
  /** The idol, the lever, the reels (over the crowd, under the chain). */
  readonly layer = new Graphics();
  readonly textLayer = new Container();
  private readonly oddsLabel: Text;
  /** The last pull's reels and outcome shown after the effect (real seconds left). */
  private result: { reels: SlotSymbol[]; outcome: SlotOutcome; life: number } | null = null;
  readonly shown: SlotShown = { idols: 0, markers: 0, spinning: 0, stopped: 0, dark: 0, odds: 0, oddsText: '', pulls: 0, results: 0, lastResult: '' };

  constructor(private readonly unit: number) {
    this.oddsLabel = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 'bold', fill: GOLD, stroke: { color: 0x200c08, width: 4 } } });
    this.oddsLabel.anchor.set(0.5, 1);
    this.oddsLabel.visible = false;
    this.textLayer.addChild(this.oddsLabel);
  }

  /** A slot event of the world (render.ts `handleEvents`): returns the text to float over the idol, if any. */
  handle(ev: Extract<WorldEvent, { type: 'slot' }>): string | null {
    if (ev.action === 'pull') { this.shown.pulls++; this.result = null; return null; }
    if (ev.action === 'effect' && ev.outcome) {
      this.shown.results++; this.shown.lastResult = ev.outcome;
      return OUTCOME_TEXT[ev.outcome];
    }
    return null;
  }

  reset(): void { this.result = null; this.oddsLabel.visible = false; }

  /** Draws the goblin of the world; `odds` — the plan's odds line (null — none now). */
  draw(world: World, clock: number, dt: number, odds: SlotPlanOdds | null): void {
    const g = this.layer.clear(), U = this.unit, goblin = goblinOf(world);
    const shown = this.shown;
    shown.idols = 0; shown.markers = 0; shown.spinning = 0; shown.stopped = 0; shown.dark = 0; shown.odds = 0;
    this.oddsLabel.visible = false;
    if (!goblin) { this.result = null; return; }
    const lever = world.objects.find(o => o.id === goblin.id);
    if (!lever) return;
    shown.idols = 1;
    const X = goblin.x * U, Y = goblin.y * U, R = OBJECT_RADIUS * U;
    // The marker as the rule fixed it when the idol appeared (`ready` before the first pull), not the live panel value.
    const age = world.time - goblin.born, marker = goblin.pulls === 0 ? Math.max(0, goblin.ready - goblin.born) : 0;
    const appearing = goblin.pulls === 0 && world.time < goblin.ready;
    if (appearing) {
      // The marker: a gold rim pulsing on the ground, the idol rising out of it.
      shown.markers = 1;
      const k = marker > 0 ? age / marker : 1, pulse = 0.5 + 0.5 * Math.sin(clock * 10);
      g.circle(X, Y, R * 2.1).fill({ color: GOLD, alpha: 0.1 + 0.12 * pulse }).stroke({ color: NAVY, width: 6, alpha: 0.8 });
      g.circle(X, Y, R * 2.1).stroke({ color: GOLD, width: 4, alpha: 0.6 + 0.4 * pulse });
      for (let i = 0; i < 6; i++) {
        const a = clock * 2 + i * Math.PI / 3, rr = R * (1.5 + 0.5 * k);
        g.circle(X + Math.cos(a) * rr, Y + Math.sin(a) * rr, 4).fill(GOLD).stroke({ color: NAVY, width: 1.5 });
      }
      this.drawIdol(g, X, Y, R, 0.25 + 0.75 * k, false, clock);
      return;
    }
    const ready = leverReady(world, lever);
    if (!ready) shown.dark = 1;
    this.drawIdol(g, X, Y, R, 1, ready, clock);
    // The reels: spinning (each stops at a third of the spin), or the last result glowing for a moment after the effect.
    const spin = goblin.spin;
    if (spin) {
      const done = spin.total > 0 ? 1 - spin.left / spin.total : 1;
      this.drawReels(g, X, Y - R * REELS_UP, R, spin.reels.map((s, i) => (done >= (i + 1) / 3 ? s : null)), clock, false);
      this.result = { reels: [...spin.reels], outcome: spin.outcome, life: RESULT_LIFE };
    } else if (this.result && this.result.life > 0) {
      this.result.life -= dt;
      this.drawReels(g, X, Y - R * REELS_UP, R, this.result.reels, clock, true);
    }
    if (odds) {
      shown.odds = 1; shown.oddsText = slotOddsText(odds);
      this.oddsLabel.text = shown.oddsText;
      this.oddsLabel.position.set(X, Y - R * (spin || this.result?.life ? REELS_UP + 1.1 : 2.3));
      this.oddsLabel.visible = true;
    }
  }

  /** The stone goblin idol with the lever on its right; `alpha` — rising out of the marker; `ready` — the lever bright. */
  private drawIdol(g: Graphics, X: number, Y: number, R: number, alpha: number, ready: boolean, clock: number): void {
    g.ellipse(X, Y + R * 0.95, R * 1.15, R * 0.3).fill({ color: 0x050a07, alpha: 0.45 * alpha });
    // Plinth and body.
    g.roundRect(X - R * 0.95, Y + R * 0.35, R * 1.9, R * 0.6, R * 0.15).fill({ color: STONE_DARK, alpha }).stroke({ color: NAVY, width: 3, alpha });
    g.poly([X - R * 0.7, Y + R * 0.4, X - R * 0.5, Y - R * 0.5, X + R * 0.5, Y - R * 0.5, X + R * 0.7, Y + R * 0.4]).fill({ color: STONE, alpha }).stroke({ color: NAVY, width: 3, alpha });
    // Head with big asymmetric ears, a grin and coin eyes.
    const hy = Y - R * 0.95;
    g.poly([X - R * 0.5, hy, X - R * 1.25, hy - R * 0.55, X - R * 0.45, hy - R * 0.25]).fill({ color: MOSS, alpha }).stroke({ color: NAVY, width: 3, alpha });
    g.poly([X + R * 0.5, hy, X + R * 1.1, hy - R * 0.35, X + R * 0.45, hy - R * 0.3]).fill({ color: MOSS, alpha }).stroke({ color: NAVY, width: 3, alpha });
    g.circle(X, hy, R * 0.58).fill({ color: STONE, alpha }).stroke({ color: NAVY, width: 3, alpha });
    g.circle(X - R * 0.22, hy - R * 0.08, R * 0.13).fill({ color: GOLD, alpha }).stroke({ color: NAVY, width: 2, alpha });
    g.circle(X + R * 0.22, hy - R * 0.08, R * 0.13).fill({ color: GOLD, alpha }).stroke({ color: NAVY, width: 2, alpha });
    g.moveTo(X - R * 0.3, hy + R * 0.22).lineTo(X - R * 0.1, hy + R * 0.32).lineTo(X + R * 0.1, hy + R * 0.22).lineTo(X + R * 0.3, hy + R * 0.3).stroke({ color: NAVY, width: 3, alpha, cap: 'round', join: 'round' });
    // The lever: up and bright while it may be pulled, down and grey otherwise.
    const bx = X + R * 0.72, by = Y - R * 0.1, tip = ready ? { x: bx + R * 0.35, y: by - R * 1.05 } : { x: bx + R * 0.75, y: by + R * 0.35 };
    g.moveTo(bx, by).lineTo(tip.x, tip.y).stroke({ color: NAVY, width: 6, alpha, cap: 'round' });
    g.moveTo(bx, by).lineTo(tip.x, tip.y).stroke({ color: ready ? 0xb08a52 : 0x5d5a52, width: 3, alpha, cap: 'round' });
    if (ready) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
      g.circle(tip.x, tip.y, R * 0.42).stroke({ color: GOLD, width: 3, alpha: 0.35 + 0.5 * pulse });
    }
    g.circle(tip.x, tip.y, R * 0.22).fill({ color: ready ? LEVER_KNOB : DARK_KNOB, alpha }).stroke({ color: NAVY, width: 2.5, alpha });
  }

  /** Three reel windows; `symbols[i]` null — that reel still spins (a blurred run of symbols). */
  private drawReels(g: Graphics, X: number, Y: number, R: number, symbols: readonly (SlotSymbol | null)[], clock: number, glow: boolean): void {
    const w = R * 0.95, h = R * 1.05, gap = R * 0.12, left = X - (w * 1.5 + gap);
    g.roundRect(left - gap * 1.5, Y - h / 2 - gap * 1.5, w * 3 + gap * 5, h + gap * 3, R * 0.2).fill({ color: 0x2b2a24 }).stroke({ color: glow ? GOLD : NAVY, width: glow ? 4 : 3 });
    symbols.forEach((sym, i) => {
      const cx = left + i * (w + gap) + w / 2;
      g.roundRect(cx - w / 2, Y - h / 2, w, h, R * 0.12).fill(REEL_BG).stroke({ color: NAVY, width: 2 });
      if (sym) { this.shown.stopped++; drawSymbol(g, sym, cx, Y, R * 0.36); return; }
      this.shown.spinning++;
      // Spinning: the next symbols scroll down, clipped to the window by drawing them small near its middle.
      const t = clock * 14 + i * 1.7, k = t - Math.floor(t), a = CYCLE[Math.floor(t) % CYCLE.length];
      drawSymbol(g, a, cx, Y + (k - 0.5) * h * 0.55, R * 0.3);
      g.rect(cx - w / 2 + 2, Y - h / 2 + 2, w - 4, h * 0.18).fill({ color: REEL_BG, alpha: 0.85 });
      g.rect(cx - w / 2 + 2, Y + h / 2 - h * 0.18 - 2, w - 4, h * 0.18).fill({ color: REEL_BG, alpha: 0.85 });
    });
  }
}

/** One reel symbol as flat shapes: ☠ skull, ❤ heart, ⚡ bolt, ◆ gem, 🍲 pot. */
export function drawSymbol(g: Graphics, sym: SlotSymbol, x: number, y: number, s: number): void {
  if (sym === 'skull') {
    g.circle(x, y - s * 0.15, s * 0.8).fill(SKULL).stroke({ color: NAVY, width: 2 });
    g.roundRect(x - s * 0.45, y + s * 0.35, s * 0.9, s * 0.5, s * 0.12).fill(SKULL).stroke({ color: NAVY, width: 2 });
    g.circle(x - s * 0.32, y - s * 0.2, s * 0.22).fill(NAVY).circle(x + s * 0.32, y - s * 0.2, s * 0.22).fill(NAVY);
  } else if (sym === 'heart') {
    g.circle(x - s * 0.4, y - s * 0.25, s * 0.45).fill(0xd9534f).circle(x + s * 0.4, y - s * 0.25, s * 0.45).fill(0xd9534f);
    g.poly([x - s * 0.82, y - s * 0.1, x, y + s * 0.85, x + s * 0.82, y - s * 0.1]).fill(0xd9534f);
    g.circle(x - s * 0.45, y - s * 0.35, s * 0.12).fill({ color: 0xffffff, alpha: 0.7 });
  } else if (sym === 'bolt') {
    g.poly([x + s * 0.2, y - s * 0.95, x - s * 0.55, y + s * 0.1, x - s * 0.05, y + s * 0.1, x - s * 0.25, y + s * 0.95, x + s * 0.6, y - s * 0.2, x + s * 0.08, y - s * 0.2]).fill(0xf5c542).stroke({ color: NAVY, width: 2 });
  } else if (sym === 'gem') {
    g.poly([x, y - s * 0.9, x + s * 0.7, y, x, y + s * 0.9, x - s * 0.7, y]).fill(0x79b0c4).stroke({ color: NAVY, width: 2 });
    g.poly([x, y - s * 0.9, x + s * 0.7, y, x, y]).fill({ color: 0xffffff, alpha: 0.35 });
  } else {
    g.ellipse(x, y - s * 0.35, s * 0.85, s * 0.22).fill(0x8a7a5a).stroke({ color: NAVY, width: 2 });
    g.poly([x - s * 0.85, y - s * 0.35, x - s * 0.6, y + s * 0.65, x + s * 0.6, y + s * 0.65, x + s * 0.85, y - s * 0.35]).fill(0x3a3f46).stroke({ color: NAVY, width: 2 });
    g.circle(x - s * 0.2, y - s * 0.45, s * 0.14).fill(0x9fba7c).circle(x + s * 0.18, y - s * 0.5, s * 0.1).fill(0x9fba7c);
  }
}
