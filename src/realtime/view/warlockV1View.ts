/**
 * Task 55 §23 «Колдун v1», part ui (design 22.10.2026, docs/design-notes/task-55-castle-step1a.md, 23.10; docs/realtime-elite-behaviors.md,
 * «Замок: Колдун v1»): the view of the warlock's v1 moves, over the v0 view (warlockView.ts: the core's drawing, the candles, the charm's
 * beam, the window). Everything is read from the sim (`warlockV1State`, the events `bossMove`, `bossPhase`, `warlockOrb`, `warlockRug`);
 * nothing here changes the world and no rule is copied:
 * - «Цветные шары»: the volley's guides — thin solid lines of the volley's colour from the core's edge (the sim's lines: to the wall or the
 *   flight's end), filling as the windup runs, a chevron along each (they go out from him, not the chain's line from the hero), a small
 *   orb growing at each start; phase 3's ring of 8 — the same lines all round. The orbs themselves are bodies (`warlock-orb`, links of
 *   their colour) drawn by render.ts at their kind's scale; here a faint magic halo and a short trail behind each;
 * - «Ковёр дёргает»: the rugs always (a dark red woven carpet with a gold border and fringes); the windup — a white wave running round
 *   the edge (its amplitude grows over 1.0 s) and chevrons on the rug pointing to the core; the pull — the chevrons solid;
 * - «Перенос к герою»: the rune at the arrival point (r 0.6, violet, the castle's magic) — its ring fills over the sign's 1.0 s, a star
 *   inside; «Вспышка посоха»: the threat ring r 2.0 round the core, hatched, filling over the 0.6 s windup;
 * - «Зов строя»: a violet circle widening at the candle of the call while the staff is raised (the markers are render.ts's own);
 * - phase 3, «ярость»: the staff's tip and the hat burn (flames at the drawing's staff and hat, an orange glow); a burst when it comes.
 * Coordinates are arena pixels (`unit` per arena unit); `r` is the drawing radius of a body in px.
 */
import { Container, Graphics, type GraphicsContext } from 'pixi.js';
import { BOSS_ART } from '../sim/bossArt';
import { WARLOCK, WARLOCK_ORB, warlockCore, warlockState, warlockV1State } from '../sim/enemies/warlock';
import type { World, WorldEvent } from '../sim/world';
import { drawFlame } from './forestMechView';

const NAVY = 0x18232d;
const THREAT = 0xffffff, THREAT_OUTLINE = 0x0b0f14;
const MAGIC = 0xa070ff, MAGIC_LIGHT = 0xe9dcff;
const RUG = 0x7a2a3a, RUG_DARK = 0x4e1824, RUG_GOLD = 0xd9b44a;
const EMBER = 0xff8a3a;

type Draw = Graphics | GraphicsContext;

/** The orb's stand-in over its colour disc: a light gloss and a tiny violet spark (the magic's), so it reads as a thrown ball. */
export function orbMarks(ctx: Draw, r: number): void {
  ctx.circle(-r * 0.35, -r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.55 });
  ctx.poly([r * 0.55, -r * 0.95, r * 0.65, -r * 0.65, r * 0.95, -r * 0.55, r * 0.65, -r * 0.45, r * 0.55, -r * 0.15, r * 0.45, -r * 0.45, r * 0.15, -r * 0.55, r * 0.45, -r * 0.65]).fill(MAGIC_LIGHT).stroke({ color: NAVY, width: 1.5 });
}

/** The shown counts of the last frame / since the fight began (tests read them through `window.__realtime`). */
export interface WarlockV1Shown {
  /** The rugs drawn; the windup's share (0 — none), the chevrons drawn, the pull running (0/1). */
  rugs: number; rugWave: number; rugArrows: number; rugPull: number;
  /** The volley's guides drawn and their fill; the ring of phase 3 (0/1); its colour index (−1 — none). */
  guides: number; guideFill: number; ring: number; guideColor: number;
  /** Orbs on the arena drawn (their halo). */
  orbs: number;
  /** The rune (0/1) and its fill; the flash's ring (0/1) and its fill; the call's circle (0/1) and its share. */
  rune: number; runeFill: number; flash: number; flashFill: number; summon: number; summonFill: number;
  /** Phase 3 (0/1) and its flames drawn. */
  rage: number; flames: number;
  /** Since the fight began: orbs gone (by cause), rug pulls, links dropped by a rug, rage bursts, moves begun. */
  orbOuts: number; orbHits: number; pulls: number; rugDrops: number; rages: number; moves: number;
}

const emptyShown = (): WarlockV1Shown => ({
  rugs: 0, rugWave: 0, rugArrows: 0, rugPull: 0, guides: 0, guideFill: 0, ring: 0, guideColor: -1, orbs: 0,
  rune: 0, runeFill: 0, flash: 0, flashFill: 0, summon: 0, summonFill: 0, rage: 0, flames: 0,
  orbOuts: 0, orbHits: 0, pulls: 0, rugDrops: 0, rages: 0, moves: 0,
});

/** A rug (px): a dark red carpet with a gold border, a pattern of diamonds and fringes on its short sides. */
export function drawRug(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.roundRect(x, y, w, h, 6).fill({ color: RUG, alpha: 0.85 }).stroke({ color: NAVY, width: 3 });
  const m = Math.min(w, h) * 0.12;
  g.roundRect(x + m, y + m, w - 2 * m, h - 2 * m, 4).stroke({ color: RUG_GOLD, width: 2.5, alpha: 0.9 });
  const n = Math.max(1, Math.round(w / h) * 2), cy = y + h / 2, s = h * 0.18;
  for (let i = 0; i < n; i++) {
    const cx = x + w * (i + 0.5) / n;
    g.poly([cx - s, cy, cx, cy - s, cx + s, cy, cx, cy + s]).fill({ color: RUG_DARK, alpha: 0.9 }).stroke({ color: RUG_GOLD, width: 1.5, alpha: 0.8 });
  }
  const long = w >= h;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    if (long) for (const ex of [x, x + w]) g.moveTo(ex, y + h * t).lineTo(ex + (ex === x ? -1 : 1) * m * 0.9, y + h * t);
    else for (const ey of [y, y + h]) g.moveTo(x + w * t, ey).lineTo(x + w * t, ey + (ey === y ? -1 : 1) * m * 0.9);
  }
  g.stroke({ color: RUG_GOLD, width: 1.5, alpha: 0.8 });
}

/** The rug's windup (px): a white wave running round its edge, its amplitude growing with `k` (0…1). */
export function drawRugWave(g: Graphics, x: number, y: number, w: number, h: number, k: number, clock: number): void {
  const amp = 2 + 7 * k, pts: [number, number][] = [], per = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(4, Math.round(len / 8));
    for (let i = 0; i < n; i++) { const t = i / n, s = Math.sin(t * len / 10 - clock * 14) * amp; pts.push([x0 + (x1 - x0) * t + nx * s, y0 + (y1 - y0) * t + ny * s]); }
  };
  per(x, y, x + w, y, 0, -1); per(x + w, y, x + w, y + h, 1, 0); per(x + w, y + h, x, y + h, 0, 1); per(x, y + h, x, y, -1, 0);
  for (const [color, width, alpha] of [[THREAT_OUTLINE, 6, 0.6], [THREAT, 2.5, 0.6 + 0.4 * k]] as const) {
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
    g.closePath().stroke({ color, width, alpha, join: 'round' });
  }
}

/** A chevron (px) at (x, y) pointing along (ux, uy), `s` its half size; `alpha` — faint during the windup, solid in the pull. */
function chevron(g: Graphics, x: number, y: number, ux: number, uy: number, s: number, alpha: number): void {
  const nx = -uy, ny = ux, tipX = x + ux * s, tipY = y + uy * s;
  for (const [color, width] of [[THREAT_OUTLINE, 7], [THREAT, 3.5]] as const) {
    g.moveTo(x - ux * s * 0.6 + nx * s, y - uy * s * 0.6 + ny * s).lineTo(tipX, tipY).lineTo(x - ux * s * 0.6 - nx * s, y - uy * s * 0.6 - ny * s).stroke({ color, width, alpha, cap: 'round', join: 'round' });
  }
}

/** The volley's guide (px): a thin solid line of the volley's ink, filling to `k`, a chevron along it, a small orb growing at its start. */
export function drawGuide(g: Graphics, x0: number, y0: number, x1: number, y1: number, ink: number, k: number, orbR: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 4) return;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, fx = x0 + (x1 - x0) * k, fy = y0 + (y1 - y0) * k;
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: NAVY, width: 4, alpha: 0.35, cap: 'round' });
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: ink, width: 1.5, alpha: 0.55, cap: 'round' });
  if (k > 0) {
    g.moveTo(x0, y0).lineTo(fx, fy).stroke({ color: NAVY, width: 6, alpha: 0.8, cap: 'round' });
    g.moveTo(x0, y0).lineTo(fx, fy).stroke({ color: ink, width: 3, cap: 'round' });
  }
  const cx = x0 + ux * len * 0.55, cy = y0 + uy * len * 0.55, s = 6;
  g.moveTo(cx - ux * s + -uy * s, cy - uy * s + ux * s).lineTo(cx + ux * s, cy + uy * s).lineTo(cx - ux * s - -uy * s, cy - uy * s - ux * s).stroke({ color: ink, width: 2.5, alpha: 0.9, cap: 'round', join: 'round' });
  g.circle(x0, y0, Math.max(2, orbR * (0.3 + 0.7 * k))).fill({ color: ink, alpha: 0.5 + 0.5 * k }).stroke({ color: NAVY, width: 2 });
}

/** The rune of «Перенос к герою» (px): a violet circle `R`, its ring filling to `k` (from the top, clockwise), a four-point star inside. */
export function drawRune(g: Graphics, x: number, y: number, R: number, k: number, clock: number): void {
  g.circle(x, y, R).fill({ color: MAGIC, alpha: 0.12 + 0.18 * k });
  g.circle(x, y, R).stroke({ color: NAVY, width: 6, alpha: 0.6 }).circle(x, y, R).stroke({ color: MAGIC, width: 2.5, alpha: 0.6 });
  if (k > 0.005) {
    g.moveTo(x, y - R).arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k)).stroke({ color: NAVY, width: 7, cap: 'round' });
    g.moveTo(x, y - R).arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k)).stroke({ color: MAGIC_LIGHT, width: 4, cap: 'round' });
  }
  const s = R * 0.6, a = clock * 1.5, pts: number[] = [];
  for (let i = 0; i < 8; i++) { const b = a + i * Math.PI / 4, rr = i % 2 ? s * 0.32 : s; pts.push(x + Math.cos(b) * rr, y + Math.sin(b) * rr); }
  g.poly(pts).fill({ color: MAGIC_LIGHT, alpha: 0.45 + 0.5 * k }).stroke({ color: NAVY, width: 2 });
}

/** «Вспышка посоха» (px): the threat ring `R` round the core, hatched, filling from the centre to `k`. */
export function drawFlashRing(g: Graphics, x: number, y: number, R: number, k: number, unit: number): void {
  g.circle(x, y, R).fill({ color: THREAT, alpha: 0.12 });
  if (k > 0) g.circle(x, y, R * Math.min(1, k)).fill({ color: THREAT, alpha: 0.24 });
  const step = 0.32 * unit, c = Math.SQRT1_2;
  for (let s = -R + step / 2; s < R; s += step) {
    const h = Math.sqrt(Math.max(0, R * R - s * s)), cx = x + c * s, cy = y + c * s;
    g.moveTo(cx - c * h, cy + c * h).lineTo(cx + c * h, cy - c * h);
  }
  g.stroke({ color: THREAT, width: 2.5, alpha: 0.55 });
  g.circle(x, y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(x, y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
}

/** The warlock's drawing's box (render.ts / warlockView: fitted into `side` body radii on its feet). */
const ART = BOSS_ART.warlock;

/** The view of Колдун v1's moves. One per renderer. */
export class WarlockV1View {
  /** Under the crowd: the rugs, the guides, the rune, the flash ring, the call's circle, the orbs' halos. */
  readonly floor = new Container();
  /** Over the enemies: the rage's flames and the effects. */
  readonly layer = new Container();
  readonly shown: WarlockV1Shown = emptyShown();
  private readonly floorG = new Graphics();
  private readonly fxG = new Graphics();
  private fx: { kind: 'puff' | 'hit' | 'rage' | 'ring'; x: number; y: number; r: number; color: number; born: number; life: number }[] = [];
  /** The orbs' places of the last frame (an `out` event names the orb, whose colour is gone with it). */
  private readonly orbColors = new Map<number, number>();

  /** `unit` — arena pixels per unit; `ink` — a sim colour index as the view's colour (render.ts `chainInk`). */
  constructor(private readonly unit: number, private readonly ink: (color: number) => number) {
    this.floor.addChild(this.floorG);
    this.layer.addChild(this.fxG);
  }

  reset(): void {
    this.fx = []; this.orbColors.clear();
    this.floorG.clear(); this.fxG.clear();
    Object.assign(this.shown, emptyShown());
  }

  /** The floor (under the crowd): the rugs and their windup, the guides, the rune, the flash's ring, the call's circle, the orbs' halos. */
  drawFloor(world: World, clock: number, r: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const g = this.floorG.clear(), U = this.unit, sh = this.shown, st = warlockV1State(world);
    sh.rugs = 0; sh.rugWave = 0; sh.rugArrows = 0; sh.rugPull = 0; sh.guides = 0; sh.guideFill = 0; sh.ring = 0; sh.guideColor = -1; sh.orbs = 0;
    sh.rune = 0; sh.runeFill = 0; sh.flash = 0; sh.flashFill = 0; sh.summon = 0; sh.summonFill = 0;
    this.orbColors.clear();
    if (!st) return;
    // The rugs, their windup and pull.
    const wind = st.rug.windup, pull = st.rug.sliding;
    for (const rug of st.rugs) {
      const x = rug.x * U, y = rug.y * U, w = rug.w * U, h = rug.h * U;
      drawRug(g, x, y, w, h);
      sh.rugs++;
      if (wind === null && !pull) continue;
      if (wind !== null) { drawRugWave(g, x, y, w, h, wind, clock); sh.rugWave = Math.max(sh.rugWave, Math.max(0.001, wind)); }
      if (pull) sh.rugPull = 1;
      // Chevrons on the rug pointing to the core (where it pulls).
      const n = Math.max(2, Math.round(rug.w / 1.6)), alpha = pull ? 1 : 0.35 + 0.6 * (wind ?? 0);
      for (let i = 0; i < n; i++) {
        const cx = rug.x + rug.w * (i + 0.5) / n, cy = rug.y + rug.h / 2, dx = st.rug.to.x - cx, dy = st.rug.to.y - cy, d = Math.hypot(dx, dy) || 1;
        chevron(g, cx * U, cy * U, dx / d, dy / d, Math.min(rug.h, 1.2) * U * 0.28, alpha);
        sh.rugArrows++;
      }
    }
    // The volley's guides (a ring in phase 3).
    if (st.orbs) {
      const ink = this.ink(st.orbs.color), k = st.orbs.progress, orbR = r * 0.7;
      for (const l of st.orbs.lines) { drawGuide(g, l.x0 * U, l.y0 * U, l.x1 * U, l.y1 * U, ink, k, orbR); sh.guides++; }
      sh.guideFill = k; sh.ring = st.orbs.ring ? 1 : 0; sh.guideColor = st.orbs.color;
    }
    if (st.rune) { drawRune(g, st.rune.x * U, st.rune.y * U, st.rune.r * U, st.rune.progress, clock); sh.rune = 1; sh.runeFill = st.rune.progress; }
    if (st.flash) { drawFlashRing(g, st.flash.x * U, st.flash.y * U, st.flash.r * U, st.flash.progress, U); sh.flash = 1; sh.flashFill = st.flash.progress; }
    if (st.summon) {
      const k = st.summon.progress, x = st.summon.at.x * U, y = st.summon.at.y * U;
      g.circle(x, y, (0.6 + 1.6 * k) * U).stroke({ color: NAVY, width: 6, alpha: 0.5 }).circle(x, y, (0.6 + 1.6 * k) * U).stroke({ color: MAGIC, width: 3, alpha: 0.5 + 0.5 * k });
      g.circle(x, y, 0.5 * U).fill({ color: MAGIC, alpha: 0.15 + 0.3 * k });
      sh.summon = 1; sh.summonFill = k;
    }
    // The orbs: a faint magic halo and a short trail (their bodies are render.ts's).
    for (const e of world.enemies) {
      if (e.kind !== WARLOCK_ORB) continue;
      this.orbColors.set(e.id, e.color);
      if (!sees(e, 1)) continue;
      const X = e.x * U, Y = e.y * U, R = r * 0.7, ink = this.ink(e.color), vx = e.vars.dx ?? 0, vy = e.vars.dy ?? 0, d = Math.hypot(vx, vy);
      if (d > 1e-6) for (let i = 1; i <= 3; i++) g.circle(X - vx / d * R * 0.9 * i, Y - vy / d * R * 0.9 * i, R * (0.55 - i * 0.12)).fill({ color: ink, alpha: 0.4 - i * 0.1 });
      g.circle(X, Y, R * 1.35).fill({ color: MAGIC, alpha: 0.14 }).stroke({ color: MAGIC, width: 2, alpha: 0.5 });
      sh.orbs++;
    }
  }

  /** Over the enemies: phase 3's burning staff and hat; the effects. One call a frame. */
  drawOver(g: Graphics, world: World, clock: number, r: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const U = this.unit, sh = this.shown, st = warlockV1State(world), core = warlockCore(world);
    sh.rage = 0; sh.flames = 0;
    if (st?.rage && core && sees(core, 2)) {
      sh.rage = 1;
      // The drawing stands on its feet (`ART.feet` radii below the centre) and floats (warlockView's bob; none in the window).
      const win = warlockState(world)?.window, bob = win ? 0 : Math.sin(clock * 2.2) * r * 0.07, H = r * ART.side, W = H / Math.max(1, ART.aspect);
      const fx = core.x * U, fy = core.y * U + r * (ART.feet ?? 0) + bob;
      // The staff's tip (right, at the top) and the hat's crown and tip (the art's own places; the drawn stand-in's are near).
      for (const [ox, oy, size] of [[0.43, -0.9, 0.22], [-0.06, -0.86, 0.2], [-0.33, -0.86, 0.13]] as const) {
        const x = fx + W * ox, y = fy + H * oy;
        g.circle(x, y - H * size * 0.4, H * size * 0.55).fill({ color: EMBER, alpha: 0.22 + 0.08 * Math.sin(clock * 9 + ox * 7) });
        drawFlame(g, x, y, H * size, clock, ox * 13);
        sh.flames++;
      }
    }
    const fxG = this.fxG.clear();
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) {
      const k = 1 - (clock - f.born) / f.life;
      if (f.kind === 'puff') fxG.circle(f.x, f.y, f.r * (0.4 + 0.8 * (1 - k))).fill({ color: f.color, alpha: 0.45 * k }).stroke({ color: MAGIC, width: 2, alpha: 0.6 * k });
      else if (f.kind === 'hit') fxG.circle(f.x, f.y, f.r * (0.5 + 1.2 * (1 - k))).fill({ color: 0xff8a73, alpha: 0.5 * k }).stroke({ color: NAVY, width: 3, alpha: 0.8 * k });
      else if (f.kind === 'ring') fxG.circle(f.x, f.y, f.r * (1 + 0.5 * (1 - k))).stroke({ color: 0xffffff, width: 5, alpha: 0.9 * k });
      else fxG.circle(f.x, f.y, f.r * (1.5 + 3 * (1 - k))).stroke({ color: EMBER, width: 8, alpha: k }).circle(f.x, f.y, f.r * (1.5 + 3 * (1 - k))).fill({ color: EMBER, alpha: 0.15 * k });
    }
  }

  /** The sim's events of the frame: orbs gone, a rug's pull and its dropped links, phase 3, the moves begun. True — the event was v1's own. */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number): boolean {
    const U = this.unit, sh = this.shown;
    if (ev.type === 'warlockOrb') {
      sh.orbOuts++;
      if (ev.why === 'touch') { sh.orbHits++; this.fx.push({ kind: 'hit', x: ev.x * U, y: ev.y * U, r: r * 0.7, color: 0, born: clock, life: 0.3 }); }
      else this.fx.push({ kind: 'puff', x: ev.x * U, y: ev.y * U, r: r * 0.7, color: this.ink(this.orbColors.get(ev.id) ?? 0), born: clock, life: 0.35 });
      return true;
    }
    if (ev.type === 'warlockRug') {
      for (const id of ev.dropped) {
        const e = world.enemies.find(x => x.id === id);
        if (e) { this.fx.push({ kind: 'ring', x: e.x * U, y: e.y * U, r: r + 6, color: 0, born: clock, life: 0.3 }); sh.rugDrops++; }
      }
      return true;
    }
    const core = warlockCore(world);
    if (ev.type === 'bossPhase' && core && ev.id === core.id && ev.phase === 3 && core.kind === WARLOCK) {
      sh.rages++;
      this.fx.push({ kind: 'rage', x: core.x * U, y: (core.y - 0.6) * U, r, color: 0, born: clock, life: 0.7 });
      return false;
    }
    if (ev.type === 'bossMove' && core && ev.id === core.id && (ev.move === 'orbs' || ev.move === 'rug' || ev.move === 'blink' || ev.move === 'flash' || ev.move === 'summon')) {
      if (ev.stage === 'start') sh.moves++;
      else if (ev.move === 'rug') sh.pulls++;
      return true;
    }
    return false;
  }
}
