/**
 * Casino stage 1: the view of «Однорукий гоблин» (sim/slot.ts; docs/realtime-casino.md). Simple shapes in the art language
 * of the arena (navy outline, flat colours): a stone goblin idol with a lever on its side; the 2 s marker with a gold rim; the
 * three reels over the idol — they spin 1.2 s and stop one by one, then the result glows; the lever dark during the cooldown
 * and after the last pull; the odds line «дождь N % · залп M %» over the idol while the drawn chain can end on the lever.
 * «Перебор» (`slotBust`): charge dots under the idol (gold safe, red risky, dark spent) and a caption over it — «безопасно: N»,
 * then the bust odds; the odds line of a risky pull is red. «Длинная цепь кормит гоблина» (`slotSafePerLongChain`): the event
 * `feed` floats «+1 рывок без риска» over the hero (render.ts), the caption and the dots read the grown count. Nothing in the HUD.
 * Task 5б (12.10.2026): the texts and the reels stand OVER the idol while the room above it (below the HUD plate and the screen
 * edge, `setFrame`) allows, else UNDER the dots (`place`); the bust's spark to the hero is drawn by render.ts. Drawing only: it reads the world and the plan, it never changes them. The arrow marks are drawn by the
 * renderer with the archer's mark (render.ts `drawSignals`).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { OBJECT_RADIUS } from '../sim/chain';
import { bustOdds, goblinOf, leverReady, safePullsLeft, slotCharges, type SlotOutcome, type SlotSymbol } from '../sim/slot';
import { bustText, slotOddsText, type SlotPlanOdds } from '../sim/slotPlan';
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
/** «Перебор»: the risky charge, the spent charge, the red of the risky text. */
const RISK_RED = 0xd9453a;
const SPENT = 0x3a3d3c;
const RISK_TEXT = 0xff7a66;
/** Real seconds the result of a pull glows over the idol after the 3rd reel. */
const RESULT_LIFE = 1.6;
/** The reels stand this many object radii over the idol: above the combo counter of a hero standing on the lever. */
const REELS_UP = 4.2;
/** The four good symbols of a reel, in the order a spinning strip shows them. */
const GOOD: readonly SlotSymbol[] = ['heart', 'bolt', 'gem', 'pot'];

/**
 * The strip a spinning reel runs through (drawing only; П11, design 11.10.2026): the reel's 4 good symbols and its `skulls`
 * skulls at the pull, spread evenly — the skull share on the strip is s ÷ (4 + s), the outcome's own odds. 2 skulls give
 * heart, skull, bolt, gem, skull, pot.
 */
export function reelStrip(skulls: number, each = 1): SlotSymbol[] {
  const s = Math.max(0, Math.floor(skulls)), n = GOOD.length * Math.max(1, Math.floor(each)) + s, out: SlotSymbol[] = [];
  let good = 0, placed = 0;
  for (let i = 0; i < n; i++) {
    // A skull where the even share of skulls so far falls behind (Bresenham-like spread).
    const wantSkulls = Math.floor(((i + 1) * s) / n);
    if (placed < wantSkulls) { out.push('skull'); placed++; } else out.push(GOOD[good++ % GOOD.length]);
  }
  return out;
}

/**
 * «Перебор» (review 12.10.2026, П11): the strip of a risky pull — ☠ with the bust chance `c`, each good symbol (1 − c) ÷ 4, the
 * pull's own odds (a bust stops on ☠☠☠, else a triple). `each` good symbols of a kind and `s` skulls with s ÷ (s + 4·each)
 * nearest to `c` (each 1…12); c = 1 — skulls only, c = 0 — the good symbols only.
 */
export function riskyStrip(chance: number): SlotSymbol[] {
  const c = Math.min(1, Math.max(0, chance));
  if (c >= 1) return ['skull'];
  let best = { each: 1, skulls: 0, err: Infinity };
  for (let each = 1; each <= 12; each++) {
    const skulls = Math.round((GOOD.length * each * c) / (1 - c)), err = Math.abs(skulls / (skulls + GOOD.length * each) - c);
    if (err < best.err - 1e-12) best = { each, skulls, err };
  }
  return reelStrip(best.skulls, best.each);
}

/** The outcome as a short word for the floating text over the idol. */
export const OUTCOME_TEXT: Readonly<Record<SlotOutcome, string>> = {
  rain: 'дождь стрел!', volley: 'залп!', heart3: '+3 HP', bolt3: 'энергия полна', gem3: '3 кристалла', jackpot: 'джекпот!',
  heart: '+1 HP', bolt: '+1 энергия', gem: 'кристалл', pot: 'добыча', none: 'хе-хе', bust: 'Перебор!',
};

/** «+1 рывок без риска» — the floating text of a long chain that fed the goblin (`n` — by how many the safe pulls grew). */
export function feedText(n: number): string {
  const tens = n % 100, ones = n % 10;
  const word = ones === 1 && tens !== 11 ? 'рывок' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'рывка' : 'рывков';
  return `+${n} ${word} без риска`;
}

/** Task 5б: a text stack over the idol needs this many px for the odds line (font 17 + stroke) and for the caption (font 15 + stroke). */
const ODDS_H = 24;
const CAP_H = 21;
/** Task 5б: px between the dots and the first text under the idol; between the texts and the reels under it. */
const GAP_PX = 4;
/** A rectangle in stage pixels (what the tests compare with the HUD's `getBoundingClientRect`). */
export interface ScreenRect { left: number; top: number; right: number; bottom: number }

/** What the slot view drew (tests read it): last frame — idols, markers, spinning reels, dark levers, odds lines; totals — pulls, results. */
export interface SlotShown { idols: number; markers: number; spinning: number; stopped: number; dark: number; odds: number; oddsText: string; pulls: number; results: number; lastResult: string;
  /** «Перебор»: the caption over the idol (empty — none), whether it is the risky one, the dots by colour, the busts seen. */
  caption: string; captionRisky: boolean; dots: { gold: number; red: number; dark: number }; busts: number;
  /** «Длинная цепь кормит гоблина»: texts floated for the long chains (count) and the last one. */
  feeds: number; feedText: string;
  /**
   * Task 5б: where the caption / odds line and the reels stood in the last frame — 'up' (over the idol) or 'down' (under its dots)
   * — and their rectangles in stage px (null — not shown); the spark of the last bust and the flashes at the hero so far.
   */
  textPlace: 'up' | 'down'; reelsPlace: 'up' | 'down'; captionRect: ScreenRect | null; oddsRect: ScreenRect | null; reelsRect: ScreenRect | null;
  sparks: number; sparkFrom: { x: number; y: number } | null; sparkTo: { x: number; y: number } | null; heroFlashes: number }

export class SlotView {
  /** The idol, the lever, the reels (over the crowd, under the chain). */
  readonly layer = new Graphics();
  readonly textLayer = new Container();
  private readonly oddsLabel: Text;
  private readonly captionLabel: Text;
  /** The last pull's reels and outcome shown after the effect (real seconds left). */
  private result: { reels: SlotSymbol[]; outcome: SlotOutcome; life: number } | null = null;
  /** Skulls on each reel at the last pull (its `pull` event): the spinning strips are built from them. */
  private pullSkulls: number[] | null = null;
  /** «Перебор»: the last pull was risky — its reels run the bust strip (`riskyStrip`), not the skulls'. */
  private pullRisky = false;
  /** The bust chance the risky strip shows (the world's `slotBustChance`, set each frame of a spin). */
  private bustChance = 0;
  readonly shown: SlotShown = { idols: 0, markers: 0, spinning: 0, stopped: 0, dark: 0, odds: 0, oddsText: '', pulls: 0, results: 0, lastResult: '', caption: '', captionRisky: false, dots: { gold: 0, red: 0, dark: 0 }, busts: 0, feeds: 0, feedText: '',
    textPlace: 'up', reelsPlace: 'up', captionRect: null, oddsRect: null, reelsRect: null, sparks: 0, sparkFrom: null, sparkTo: null, heroFlashes: 0 };
  /** The arena on the stage (render.ts, each frame): origin, scale and the y (stage px) under which the HUD plate ends. */
  private frame = { baseX: 0, baseY: 0, scale: 1, top: -Infinity };
  /** Where the texts and the reels stood at the last idol (kept after it is gone: the bust's word floats from the same spot). */
  private place = { textsDown: false, reelsDown: false, floatY: 0, floatDir: -1 };

  constructor(private readonly unit: number) {
    this.oddsLabel = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 'bold', fill: GOLD, stroke: { color: 0x200c08, width: 4 } } });
    this.oddsLabel.anchor.set(0.5, 1);
    this.oddsLabel.visible = false;
    this.textLayer.addChild(this.oddsLabel);
    this.captionLabel = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 'bold', fill: GOLD, stroke: { color: 0x200c08, width: 4 } } });
    this.captionLabel.anchor.set(0.5, 1);
    this.captionLabel.visible = false;
    this.textLayer.addChild(this.captionLabel);
  }

  /** A slot event of the world (render.ts `handleEvents`): returns the text to float over the idol, if any. */
  handle(ev: Extract<WorldEvent, { type: 'slot' }>): string | null {
    if (ev.action === 'feed') { const text = feedText(ev.safe ?? 1); this.shown.feeds++; this.shown.feedText = text; return text; }
    if (ev.action === 'pull') { this.shown.pulls++; this.result = null; this.pullSkulls = ev.skulls ? [...ev.skulls] : null; this.pullRisky = !!ev.risky; return null; }
    if (ev.action === 'effect' && ev.outcome) {
      this.shown.results++; this.shown.lastResult = ev.outcome;
      if (ev.outcome === 'bust') this.shown.busts++;
      return OUTCOME_TEXT[ev.outcome];
    }
    return null;
  }

  /** Task 5б: the arena's origin and scale on the stage and the stage y the HUD plate reaches (render.ts, before `draw`). */
  setFrame(baseX: number, baseY: number, scale: number, top: number): void { this.frame = { baseX, baseY, scale: scale > 0 ? scale : 1, top }; }

  /**
   * Task 5б: where the outcome word of a pull floats from, relative to the idol's centre (px in arena drawing space): over the
   * reels (dir −1, the floating text rises), or under them when they stand under the idol (dir +1, it sinks).
   */
  outcomeAnchor(): { dy: number; dir: 1 | -1 } { return { dy: this.place.floatY, dir: this.place.floatDir < 0 ? -1 : 1 }; }

  reset(): void { this.place = { textsDown: false, reelsDown: false, floatY: 0, floatDir: -1 }; this.result = null; this.pullSkulls = null; this.pullRisky = false; this.oddsLabel.visible = false; this.captionLabel.visible = false; }

  /** Draws the goblin of the world; `odds` — the plan's odds line (null — none now). */
  draw(world: World, clock: number, dt: number, odds: SlotPlanOdds | null): void {
    const g = this.layer.clear(), U = this.unit, goblin = goblinOf(world);
    const shown = this.shown;
    shown.idols = 0; shown.markers = 0; shown.spinning = 0; shown.stopped = 0; shown.dark = 0; shown.odds = 0;
    this.oddsLabel.visible = false;
    this.captionLabel.visible = false;
    shown.captionRect = null; shown.oddsRect = null; shown.reelsRect = null;
    shown.caption = ''; shown.captionRisky = false; shown.dots.gold = 0; shown.dots.red = 0; shown.dots.dark = 0;
    if (!goblin) { this.result = null; return; }
    const lever = world.objects.find(o => o.id === goblin.id);
    if (!lever) return;
    shown.idols = 1;
    const X = goblin.x * U, Y = goblin.y * U, R = OBJECT_RADIUS * U;
    // Task 5б: is there room above the idol (the HUD plate, the screen edge)? Decided from the highest stack the idol can carry
    // (the odds line over the reels; over the caption), not from what shows now, so nothing jumps while a pull runs.
    const limit = (this.frame.top - this.frame.baseY) / this.frame.scale;
    const reelsDown = Y - R * (REELS_UP + 1.1) - ODDS_H < limit, textsDown = Y - R * 2.75 - ODDS_H < limit;
    const dotsBottom = R * 1.5 + R * 0.2 + 2, textTop = dotsBottom + GAP_PX;
    const reelsDy = reelsDown ? (textsDown ? textTop + CAP_H + ODDS_H + 1 : dotsBottom) + GAP_PX * 2 + R * 0.71 : -R * REELS_UP;
    this.place = { textsDown, reelsDown, floatY: reelsDown ? reelsDy + R * 0.71 + 22 : -R * 5.8, floatDir: reelsDown ? 1 : -1 };
    shown.textPlace = textsDown ? 'down' : 'up'; shown.reelsPlace = reelsDown ? 'down' : 'up';
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
      this.drawCharges(world, goblin.pulls, g, X, Y, R, 0.25 + 0.75 * k, null);
      return;
    }
    const ready = leverReady(world, lever);
    if (!ready) shown.dark = 1;
    this.drawIdol(g, X, Y, R, 1, ready, clock);
    const caption = this.drawCharges(world, goblin.pulls, g, X, Y, R, 1, textsDown ? textTop : null);
    // The reels: spinning (each stops at a third of the spin), or the last result glowing for a moment after the effect.
    const spin = goblin.spin;
    if (spin) {
      const done = spin.total > 0 ? 1 - spin.left / spin.total : 1;
      this.bustChance = world.params.slotBustChance ?? 0;
      this.drawReels(g, X, Y + reelsDy, R, spin.reels.map((s, i) => (done >= (i + 1) / 3 ? s : null)), clock, false);
      this.result = { reels: [...spin.reels], outcome: spin.outcome, life: RESULT_LIFE };
    } else if (this.result && this.result.life > 0) {
      this.result.life -= dt;
      this.drawReels(g, X, Y + reelsDy, R, this.result.reels, clock, true);
    }
    if (odds) {
      shown.odds = 1; shown.oddsText = slotOddsText(odds);
      this.oddsLabel.text = shown.oddsText;
      this.oddsLabel.style.fill = odds.bust ? RISK_TEXT : GOLD;
      // The risky odds line already says what the red caption says: one of them on screen.
      if (odds.bust) this.captionLabel.visible = false;
      const hasCaption = caption && !odds.bust, showsReels = !!(spin || this.result?.life);
      if (textsDown) {
        // Under the dots, below the caption (the caption is one line above it); the reels hang under both.
        this.oddsLabel.anchor.set(0.5, 0);
        this.oddsLabel.position.set(X, Y + textTop + (hasCaption ? CAP_H : 0));
      } else {
        // Over the caption (when there is one) and under the reels (over them while they show and stand over the idol).
        this.oddsLabel.anchor.set(0.5, 1);
        this.oddsLabel.position.set(X, Y - R * (showsReels && !reelsDown ? REELS_UP + 1.1 : hasCaption ? 2.75 : 2.3));
      }
      this.oddsLabel.visible = true;
      shown.oddsRect = this.rectOf(this.oddsLabel);
    }
    if (spin || this.result?.life) {
      const w = R * 3.45, h = R * 1.41;
      shown.reelsRect = this.toStage(X - w / 2, Y + reelsDy - h / 2, X + w / 2, Y + reelsDy + h / 2);
    }
    if (shown.caption && this.captionLabel.visible) shown.captionRect = this.rectOf(this.captionLabel);
  }

  /** A rectangle of arena drawing space as stage px. */
  private toStage(l: number, t: number, r: number, b: number): ScreenRect {
    const f = this.frame;
    return { left: f.baseX + l * f.scale, top: f.baseY + t * f.scale, right: f.baseX + r * f.scale, bottom: f.baseY + b * f.scale };
  }

  /** The label's rectangle in stage px (its anchor decides which side of `position` it hangs). */
  private rectOf(label: Text): ScreenRect {
    // A measured size in the browser; the Node spec has no canvas to measure with — a coarse estimate there.
    let w: number, h: number;
    try { w = label.width; h = label.height; } catch { const size = Number(label.style.fontSize) || 16; w = label.text.length * size * 0.55; h = size + 6; }
    const x = label.position.x, y = label.position.y, top = label.anchor.y >= 1 ? y - h : y;
    return this.toStage(x - w / 2, top, x + w / 2, top + h);
  }

  /**
   * «Перебор»: the charge dots under the idol and the caption over its head; nothing with `slotBust` off. Returns whether a
   * caption is shown (over the idol, or `below` px under its centre). Numbers come from `slotCharges`, `safePullsLeft`, `bustOdds` (sim/slot.ts), never computed here.
   */
  private drawCharges(world: World, pulls: number, g: Graphics, X: number, Y: number, R: number, alpha: number, below: number | null): boolean {
    if (!world.params.slotBust) return false;
    const shown = this.shown, { total } = slotCharges(world), r = R * 0.2, step = R * 0.5, y = Y + R * 1.5;
    // The pulls ahead: the first `safePullsLeft` gold, the rest red (a long chain after a risky pull turns the next one gold).
    const left = safePullsLeft(world), risk = bustOdds(world), safeAhead = left ?? 0;
    for (let i = 0; i < total; i++) {
      const spent = i < pulls, safe = !spent && i - pulls < safeAhead, color = spent ? SPENT : safe ? GOLD : RISK_RED;
      g.circle(X + (i - (total - 1) / 2) * step, y, r).fill({ color, alpha }).stroke({ color: NAVY, width: 2, alpha });
      if (spent) shown.dots.dark++; else if (safe) shown.dots.gold++; else shown.dots.red++;
    }
    // No pulls left: no caption. A risky next pull: the bust odds; else the safe pulls left.
    if (pulls >= total || left === null || alpha < 1) return false;
    const text = left > 0 ? `безопасно: ${left}` : risk ? bustText(risk) : '';
    if (!text) return false;
    shown.caption = text; shown.captionRisky = left === 0;
    this.captionLabel.text = text;
    this.captionLabel.style.fill = left === 0 ? RISK_TEXT : GOLD;
    // Task 5б: under the dots (`below` — its top, px under the idol's centre) when there is no room over the idol.
    this.captionLabel.anchor.set(0.5, below === null ? 1 : 0);
    this.captionLabel.position.set(X, below === null ? Y - R * 1.7 : Y + below);
    this.captionLabel.visible = true;
    return true;
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
      const strip = this.pullRisky ? riskyStrip(this.bustChance) : reelStrip(this.pullSkulls?.[i] ?? 2);
      const t = clock * 14 + i * 1.7, k = t - Math.floor(t), a = strip[Math.floor(t) % strip.length];
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
