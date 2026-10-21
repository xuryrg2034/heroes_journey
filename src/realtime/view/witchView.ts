/**
 * Task 62 «Ведунья v2», stage A, the view (docs/design-notes/task-62-witch-v2.md, 2.1–2.3, 3.1, 3.7; design 21.10.2026): the runes of the
 * drawn chain, the first rune as the closing target, the figure's contour and word at the pointer, the sandbox's «Показать фигуру», and
 * the discharge (the thread along the runes and the white flashes of the strikes). It reads the world and the plan and writes nothing to
 * them: which links are in reach, the figure or the refusal, who is struck — `castRefusal`, `loopKindAt`, `loopRefusal`, `ChainPlan.glyph`,
 * `glyphClass` and the `chainHit` events of the sim; no rule is counted here.
 *
 * - **Rune** — a small dot of the chain's colour in a navy rim at the point the enemy stood when it was taken (`ChainLink.rune`). A thin
 *   line to the enemy only when it has left the dot farther than its body's radius. No numbers, no text.
 * - **The first rune** — a ring of the pick radius round it once the contour exists (3 runes); brighter while the pointer is on it and
 *   the closing is possible. The pointer on it: the figure — the contour dashed in the chain's colour and its word; a refusal — the same
 *   contour in grey dashes (the reason is the pointer's hint, the old one).
 * - **Discharge** — the thread from the hero along the runes in order and, one after another with a small step, a white flash on each
 *   body the sim struck (a link that left the circle or went behind a wall has no `chainHit`, so it has no flash).
 */
import { Container, Graphics, Text } from 'pixi.js';
import { castFirstRune, chainRunes, linkPoint, loopKindAt, loopRefusal, REFUSAL_TEXT, witchGlyphClass, type ChainPlan } from '../sim/chain';
import type { GlyphKind, GlyphResult } from '../sim/glyphs';
import { witchOn } from '../sim/kit';
import { enemyDrawRadius } from '../sim/params';
import type { Vec } from '../sim/geometry';
import type { World } from '../sim/world';

const NAVY = 0x18232d, GREY = 0x8c93a0;
/** The dot of a rune (px) and its rim. */
const RUNE_R = 5, RUNE_RIM = 2.5;
/** Seconds between two flashes of a discharge, how long a flash lives, how fast the thread is laid, how long it stays. */
export const CAST_STEP = 0.045, CAST_FLASH = 0.2, CAST_THREAD = 0.2, CAST_LIFE = 0.5;

/** The words of the figures on the screen (one word each; no rules are written). */
export const GLYPH_WORD: Readonly<Record<GlyphKind, string>> = { ring: 'Кольцо', square: 'Квадрат', triangle: 'Треугольник' };

/** The word of a class result for the sandbox's «Показать фигуру»: the figure's word or the refusal's old text. */
export function glyphCaption(result: GlyphResult): string {
  return 'kind' in result ? GLYPH_WORD[result.kind] : REFUSAL_TEXT[result.refusal];
}

/** The length of a polyline (px). */
function polylineLength(points: readonly Vec[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return n;
}
/** The first part of a polyline, `length` px of it. */
export function polylinePrefix(points: readonly Vec[], length: number): Vec[] {
  if (!points.length) return [];
  const out: Vec[] = [points[0]];
  let left = length;
  for (let i = 1; i < points.length && left > 0; i++) {
    const a = points[i - 1], b = points[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= left) { out.push(b); left -= d; } else { const k = left / d; out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }); left = 0; }
  }
  return out;
}

/** A discharge as the release left it: the thread (the hero, then the runes and the objects in order), the colour and the flashes to come. */
interface Cast { thread: Vec[]; ink: number; length: number; age: number; g: Graphics; flashes: { at: Vec; delay: number; g?: Graphics }[] }

/** What the highlight and the discharge drew (tests read it through the snapshot). */
export interface WitchShown {
  /** 0 — none; 1 — the circle of casting drawn thin (no chain); 2 — drawn in the chain's colour (set by the renderer's reach layer). */
  circle: 0 | 1 | 2;
  runes: number; ties: number;
  /** The ring on the first rune: 0 — none, 1 — dim, 2 — bright (the pointer on it and the closing possible). */
  firstRing: 0 | 1 | 2;
  /** The contour at the pointer: '' — none, 'figure' — dashed in the chain's colour, 'refused' — grey. */
  contour: '' | 'figure' | 'refused';
  /** The word at the first rune or at the pointer (figure), the sandbox's class word at the contour's centre. */
  word: string; classWord: string;
  /** Discharges seen, flashes started, the thread's strokes so far, the casts running now. */
  casts: number; flashes: number; running: number;
}

export class WitchView {
  readonly shown: WitchShown = { circle: 0, runes: 0, ties: 0, firstRing: 0, contour: '', word: '', classWord: '', casts: 0, flashes: 0, running: 0 };
  /** The sandbox's «Показать фигуру» (view only; not a Param). */
  showFigure = false;
  private readonly labels: Text[] = [];
  private readonly casts: Cast[] = [];
  /** The chain as the view saw it at the release (`capture`), waiting for the events of the discharge. */
  private pending: { thread: Vec[]; ink: number } | null = null;

  constructor(private readonly unit: number, private readonly labelLayer: Container, private readonly fxLayer: Container) {}

  private label(i: number): Text {
    while (this.labels.length <= i) {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 'bold', fill: 0xffffff, stroke: { color: NAVY, width: 5 } } });
      text.anchor.set(0.5, 1);
      text.visible = false;
      this.labelLayer.addChild(text);
      this.labels.push(text);
    }
    return this.labels[i];
  }

  /** Nothing drawn this frame (no chain, or not Ведунья v2). */
  clear(): void {
    const s = this.shown;
    s.runes = 0; s.ties = 0; s.firstRing = 0; s.contour = ''; s.word = ''; s.classWord = '';
    for (const label of this.labels) label.visible = false;
  }

  /** A dashed closed polygon (px): navy under the colour. */
  private dashedPolygon(g: Graphics, pts: readonly Vec[], color: number): void {
    for (const [w, c, a] of [[7, NAVY, 0.5], [3.5, color, 0.95]] as const) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 1) continue;
        const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len;
        for (let t = 0; t < len; t += 17) { const e = Math.min(len, t + 10); g.moveTo(p.x + ux * t, p.y + uy * t).lineTo(p.x + ux * e, p.y + uy * e); }
      }
      g.stroke({ color: c, width: w, alpha: a, cap: 'round' });
    }
  }

  /** The runes, the first rune's ring, the contour and the words of a drawn chain (Ведунья v2 only). Reads the plan; counts nothing. */
  draw(g: Graphics, world: World, plan: ChainPlan, ink: number, pointer: Vec | null): void {
    this.clear();
    if (!witchOn(world)) return;
    const U = this.unit, s = this.shown, bodyR = enemyDrawRadius(world.params);
    const runes = chainRunes(world.chain);
    for (const link of world.chain) {
      if (link.kind !== 'enemy' || !link.rune) continue;
      const e = world.enemies.find(x => x.id === link.id);
      // The line to the body only when it has left its point farther than its radius (the dot already says «here»).
      if (e && Math.hypot(e.x - link.rune.x, e.y - link.rune.y) > bodyR) {
        g.moveTo(link.rune.x * U, link.rune.y * U).lineTo(e.x * U, e.y * U).stroke({ color: ink, width: 1.5, alpha: 0.6 });
        s.ties++;
      }
    }
    for (const link of world.chain) {
      if (link.kind !== 'enemy' || !link.rune) continue;
      g.circle(link.rune.x * U, link.rune.y * U, RUNE_R).fill(ink).stroke({ color: NAVY, width: RUNE_RIM });
      s.runes++;
    }
    // The closing target is the sim's (`castFirstRune`: the first rune and the pick radius).
    const target = castFirstRune(world);
    if (runes.length < 3 || !target) return;
    const r0 = target, ring = target.r * U;
    const closed = !!world.chainClosed;
    // The pointer on the closing target and why it would or would not close: the sim's own answers (`loopKindAt`, `loopRefusal`).
    const on = !closed && !!pointer && loopKindAt(world, pointer) === 'first';
    const refusal = on ? loopRefusal(world, 'first') : null;
    // Closed on the first rune: the closing target is lit for good (the filled outline is the loop's).
    const bright = closed || (on && !refusal);
    s.firstRing = bright ? 2 : 1;
    if (bright) {
      g.circle(r0.x * U, r0.y * U, ring).stroke({ color: NAVY, width: 7, alpha: 0.5 });
      g.circle(r0.x * U, r0.y * U, ring).stroke({ color: ink, width: 3.5, alpha: 0.95 });
    } else g.circle(r0.x * U, r0.y * U, ring).stroke({ color: ink, width: 1.5, alpha: 0.45 });
    if (on) {
      const pts = runes.map(v => ({ x: v.x * U, y: v.y * U }));
      this.dashedPolygon(g, pts, refusal ? GREY : ink);
      s.contour = refusal ? 'refused' : 'figure';
    }
    const glyph = plan.glyph;
    if ((bright || closed) && glyph && 'kind' in glyph) {
      const text = this.label(0);
      text.text = GLYPH_WORD[glyph.kind];
      text.position.set(r0.x * U, r0.y * U - ring - 4);
      text.visible = true;
      s.word = text.text;
    }
    if (this.showFigure) {
      const result = witchGlyphClass(world);
      if (!result) return;
      let cx = 0, cy = 0;
      for (const v of runes) { cx += v.x; cy += v.y; }
      const text = this.label(1);
      text.text = glyphCaption(result);
      text.anchor.set(0.5, 0.5);
      text.position.set(cx / runes.length * U, cy / runes.length * U);
      text.visible = true;
      s.classWord = text.text;
    }
  }

  /** The thread of a drawn chain for the highlight: the hero, then each enemy link's rune (its body when it has none) and each object. */
  threadOf(world: World): Vec[] {
    const pts: Vec[] = [{ x: world.hero.x, y: world.hero.y }];
    for (const l of world.chain) {
      const at = l.kind === 'enemy' && l.rune ? l.rune : linkPoint(world, l);
      if (at) pts.push({ x: at.x, y: at.y });
    }
    return pts;
  }

  /** Before the release command: notes the thread of the chain as the player saw it (the discharge empties the chain in the same tick). */
  capture(world: World, ink: number): void {
    this.pending = witchOn(world) && world.chain.length ? { thread: this.threadOf(world), ink } : null;
  }
  /** The release was refused: nothing will come. */
  drop(): void { this.pending = null; }

  /** The events of a frame: a discharge noted at the release starts its thread and its flashes (one per `chainHit`, in order). */
  onEvents(world: World): void {
    const p = this.pending;
    if (!p || !world.events.some(ev => ev.type === 'chainEnd')) return;
    this.pending = null;
    const U = this.unit, thread = p.thread.map(v => ({ x: v.x * U, y: v.y * U }));
    const g = new Graphics();
    this.fxLayer.addChild(g);
    // The sim's `cast` event: a flash only where `struck` (a link that left the circle or went behind a wall has none), in the drawn order.
    const cast = world.events.find(ev => ev.type === 'cast');
    const flashes = (cast && cast.type === 'cast' ? cast.links.filter(l => l.struck).map(l => ({ at: { x: l.x * U, y: l.y * U } })) : []).map((f, i) => ({ ...f, delay: i * CAST_STEP }));
    this.casts.push({ thread, ink: p.ink, length: polylineLength(thread), age: 0, g, flashes });
    this.shown.casts++;
    this.shown.running = this.casts.length;
  }

  /** One frame of the running discharges (real seconds). */
  update(dt: number): void {
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i];
      c.age += dt;
      const done = c.age >= CAST_LIFE + c.flashes.length * CAST_STEP;
      for (const f of c.flashes) {
        const t = c.age - f.delay;
        if (t < 0) continue;
        if (!f.g) {
          f.g = new Graphics();
          this.fxLayer.addChild(f.g);
          f.g.position.set(f.at.x, f.at.y);
          this.shown.flashes++;
        }
        const k = Math.min(1, t / CAST_FLASH);
        f.g.clear().circle(0, 0, this.unit * (0.28 + 0.32 * k)).fill({ color: 0xffffff, alpha: 0.5 * (1 - k) }).stroke({ color: 0xffffff, width: 4 * (1 - k) + 1, alpha: 1 - k });
        f.g.visible = k < 1;
      }
      const laid = Math.min(1, c.age / CAST_THREAD), fade = c.age < CAST_THREAD + 0.1 ? 1 : Math.max(0, 1 - (c.age - CAST_THREAD - 0.1) / (CAST_LIFE - CAST_THREAD - 0.1));
      const part = polylinePrefix(c.thread, c.length * laid);
      c.g.clear();
      if (part.length > 1 && fade > 0) {
        for (const [w, col] of [[9, NAVY], [4.5, c.ink]] as const) {
          c.g.moveTo(part[0].x, part[0].y);
          for (let k = 1; k < part.length; k++) c.g.lineTo(part[k].x, part[k].y);
          c.g.stroke({ color: col, width: w, alpha: 0.95 * fade, cap: 'round', join: 'round' });
        }
      }
      if (done) { c.g.destroy(); for (const f of c.flashes) f.g?.destroy(); this.casts.splice(i, 1); }
    }
    this.shown.running = this.casts.length;
  }

  /** A new fight: nothing of the old one stays. */
  reset(): void {
    for (const c of this.casts) { c.g.destroy(); for (const f of c.flashes) f.g?.destroy(); }
    this.casts.length = 0;
    this.pending = null;
    this.shown.running = 0;
    this.clear();
  }
}
