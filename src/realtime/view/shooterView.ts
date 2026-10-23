/**
 * Task 57а «Лес: стрелки», part ui (design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 12; docs/realtime-elite-behaviors.md,
 * «Лес: стрелки»): the view of the slinger («Пращник»), the hive («Улей»), the wisp («Светляк») and the shots of the layer
 * (sim/shots.ts) — procedural, in the arena's style (navy outline, flat colours); the art of the three is the design's, later.
 * - the slinger: three thin guide lines from its hand (fixed at the windup's start), filling as the windup runs, a pebble at each end;
 * - the hive: the swell — a pulsing ring round the body and eight dots on the ring's radius filling as the swell runs;
 * - the shots: a wasp (a small amber diamond with wings) and a stone (a grey angular pebble with a shadow) in the shooters' colours,
 *   not the chain's; a hanging shot blinks with a faint threat ring (it hurts), a flying one has a short trail;
 * - the wisp: a light that grows while it lights, a steady halo in flight with motes behind it, a pale ring while a link of the drawn
 *   chain holds it, and a blink that dims it in its last second;
 * - sparks: a shot put out (`snuff`) — a star, a shot a shield took (`block`) — a ring, a hit — a flash, an end of flight — dust; a hive's
 *   ring leaving — a swell of the ring, a wisp going out — a ring of motes.
 * The planned chain shows no shots (spec 4.4): a shot is no link. View only: it reads the world through the sim's helpers
 * (`liveShots`, `slingerLines`, `hiveSwell`, `wispState`) and the events, never writes the world, never rolls a die.
 */
import { Container, Graphics, type GraphicsContext } from 'pixi.js';
import { hiveSwell, HIVE, RING_RADIUS, WASP_RADIUS } from '../sim/enemies/hive';
import { SLINGER, slingerLines, STONE_RADIUS } from '../sim/enemies/slinger';
import { WISP, WISP_FADE, wispState } from '../sim/enemies/wisp';
import { liveShots, type Shot } from '../sim/shots';
import type { World, WorldEvent } from '../sim/world';

const NAVY = 0x18232d;
/** The threat colour (render.ts `THREAT`: white with a dark outline). */
const THREAT = 0xffffff, THREAT_OUTLINE = 0x0b0f14;
/** The wasp: dark amber with a light wing; the shooters' colours are outside the chain palette. */
const AMBER = 0xe6a21f, AMBER_DARK = 0x5a3a10, WING = 0xfff2c4;
/** The stone: a grey pebble. */
const STONE = 0x9b9a92, STONE_DARK = 0x5f6058, STONE_LIGHT = 0xc9c8bd;
/** The wisp's light: a warm pale yellow. */
const LIGHT = 0xfff4b0, LIGHT_CORE = 0xffffff;
const LEATHER = 0x7a5a3a, LEATHER_LIGHT = 0xb08a52;

type Draw = Graphics | GraphicsContext;

/** The shown counts of the last frame / since the fight began (tests read them through `window.__realtime`). */
export interface ShooterShown {
  /** The slinger's guide lines drawn this frame. */
  lines: number;
  /** The slinger's windup now: the share filled (0 — none). */
  lineProgress: number;
  /** The hive's swell dots drawn this frame, and the swell's share. */
  dots: number;
  swellProgress: number;
  /** The shots drawn this frame: all, the hanging (blinking) and the flying (with a trail); by kind. */
  shots: number; hanging: number; flying: number; stones: number; wasps: number;
  /** The wisps drawn this frame: lighting, flying, fading (blinking), held by a link. */
  wispsLighting: number; wispsFlying: number; wispsFading: number; wispsHeld: number;
  /** The light's growth of the wisp that is lighting now (0…1; 0 — none). */
  wispLight: number;
  /** Sparks shown since the fight began: a shot put out, taken by a shield, a hit, an end of flight; a wisp going out; a ring leaving. */
  snuffs: number; fades: number; blocks: number; hits: number; ends: number; wispOuts: number; looses: number;
}

const emptyShown = (): ShooterShown => ({
  lines: 0, lineProgress: 0, dots: 0, swellProgress: 0, shots: 0, hanging: 0, flying: 0, stones: 0, wasps: 0,
  wispsLighting: 0, wispsFlying: 0, wispsFading: 0, wispsHeld: 0, wispLight: 0, snuffs: 0, fades: 0, blocks: 0, hits: 0, ends: 0, wispOuts: 0, looses: 0,
});

/** The look of a wisp's body this frame (the renderer applies it to the enemy's drawing). */
export interface WispLook { alpha: number; scale: number }

const rot = (x: number, y: number, c: number, s: number, X: number, Y: number): [number, number] => [X + x * c - y * s, Y + x * s + y * c];

// ---- Silhouettes behind the colour disc (the renderer's `enemyContext`; the missing art falls back to them) ----

/** The slinger: a sack of stones on its back and a sling hanging at the hand, a stone in the pouch (the parts stand out past the disc). */
export function slingerMarks(ctx: Draw, r: number): void {
  const sx = -r * 0.95, sy = -r * 0.8;
  ctx.circle(sx, sy, r * 0.58).fill(LEATHER).stroke({ color: NAVY, width: 3 });
  ctx.moveTo(sx - r * 0.3, sy - r * 0.45).lineTo(sx + r * 0.1, sy - r * 0.75).stroke({ color: NAVY, width: 4, cap: 'round' });
  for (const [dx, dy] of [[-0.3, -0.4], [0.12, -0.55], [-0.02, -0.82]] as const) ctx.circle(sx + r * dx, sy + r * dy, r * 0.16).fill(STONE).stroke({ color: NAVY, width: 1.5 });
  ctx.moveTo(r * 0.8, -r * 0.05).quadraticCurveTo(r * 1.9, -r * 0.5, r * 1.75, r * 0.7).stroke({ color: NAVY, width: 6, cap: 'round' });
  ctx.moveTo(r * 0.8, -r * 0.05).quadraticCurveTo(r * 1.9, -r * 0.5, r * 1.75, r * 0.7).stroke({ color: LEATHER_LIGHT, width: 3, cap: 'round' });
  ctx.ellipse(r * 1.75, r * 0.85, r * 0.36, r * 0.24).fill(LEATHER).stroke({ color: NAVY, width: 2.5 });
  ctx.circle(r * 1.75, r * 0.74, r * 0.2).fill(STONE).stroke({ color: NAVY, width: 2 });
}

/** The hive: a tall stack of amber tiers over the disc (a skep) and two long stingers below. */
export function hiveMarks(ctx: Draw, r: number): void {
  for (const sx of [-1, 1]) ctx.poly([sx * r * 0.25, r * 0.85, sx * r * 0.7, r * 0.75, sx * r * 0.42, r * 1.7]).fill(AMBER_DARK).stroke({ color: NAVY, width: 2.5, join: 'round' });
  [[1.15, 1.0], [1.55, 0.76], [1.9, 0.5]].forEach(([y, w], i) => ctx.ellipse(0, -r * y, r * w, r * 0.3).fill(i % 2 ? AMBER_DARK : AMBER).stroke({ color: NAVY, width: 3 }));
  ctx.circle(0, -r * 2.2, r * 0.14).fill(AMBER_DARK).stroke({ color: NAVY, width: 2 });
  ctx.ellipse(0, -r * 1.15, r * 0.2, r * 0.12).fill(NAVY);
}

/** The wisp: a tall flame crest over the disc and a spark trailing from its lower side. */
export function wispMarks(ctx: Draw, r: number): void {
  ctx.poly([-r * 0.6, -r * 0.6, -r * 0.45, -r * 1.3, -r * 0.15, -r * 1.15, 0, -r * 2.2, r * 0.24, -r * 1.25, r * 0.52, -r * 1.4, r * 0.6, -r * 0.6]).fill(LIGHT).stroke({ color: NAVY, width: 3, join: 'round' });
  ctx.poly([-r * 1.0, r * 0.5, -r * 1.9, r * 1.0, -r * 1.2, r * 0.9, -r * 1.45, r * 1.6, -r * 0.85, r * 0.85]).fill(LIGHT).stroke({ color: NAVY, width: 2.5, join: 'round' });
}

// ---- The shooters' signs and the shots ----

/**
 * The slinger's three lines (px): each a thin solid line — not a dashed one (a dashed line already means «the first body», spec 4.7) —
 * a faint whole and a bright part up to `progress`, a pebble at the far end. Returns how many were drawn.
 */
export function drawSlingLines(g: Graphics, lines: readonly { x0: number; y0: number; x1: number; y1: number }[], progress: number, unit: number): number {
  let n = 0;
  for (const l of lines) {
    const x0 = l.x0 * unit, y0 = l.y0 * unit, x1 = l.x1 * unit, y1 = l.y1 * unit, len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 4) continue;
    n++;
    const k = Math.max(0, Math.min(1, progress)), fx = x0 + (x1 - x0) * k, fy = y0 + (y1 - y0) * k;
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.35, cap: 'round' });
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: THREAT, width: 1.5, alpha: 0.5, cap: 'round' });
    if (k > 0) {
      g.moveTo(x0, y0).lineTo(fx, fy).stroke({ color: THREAT_OUTLINE, width: 6, alpha: 0.8, cap: 'round' });
      g.moveTo(x0, y0).lineTo(fx, fy).stroke({ color: THREAT, width: 3, alpha: 0.95, cap: 'round' });
    }
    const pr = STONE_RADIUS * unit * 1.1;
    g.circle(x1, y1, pr).fill({ color: STONE, alpha: 0.55 + 0.4 * k }).stroke({ color: THREAT_OUTLINE, width: 2, alpha: 0.9 });
  }
  return n;
}

/**
 * The hive's swell (px): a pulsing ring round the body (`bodyR` px) and a dot at each place of a wasp, each filling as the swell runs.
 * Returns the dots drawn.
 */
export function drawHiveSwell(g: Graphics, X: number, Y: number, bodyR: number, points: readonly { x: number; y: number }[], progress: number, clock: number, unit: number): number {
  const k = Math.max(0, Math.min(1, progress)), pulse = 0.5 + 0.5 * Math.sin(clock * (10 + 14 * k));
  g.circle(X, Y, bodyR * (1.12 + 0.14 * k * pulse)).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.6 });
  g.circle(X, Y, bodyR * (1.12 + 0.14 * k * pulse)).stroke({ color: AMBER, width: 2.5, alpha: 0.6 + 0.4 * k });
  g.circle(X, Y, RING_RADIUS * unit).stroke({ color: THREAT, width: 1, alpha: 0.25 + 0.2 * k });
  const wr = WASP_RADIUS * unit;
  for (const p of points) {
    const px = p.x * unit, py = p.y * unit;
    g.circle(px, py, wr * 1.5).stroke({ color: THREAT_OUTLINE, width: 3, alpha: 0.5 });
    g.circle(px, py, wr * 1.5).stroke({ color: THREAT, width: 1.5, alpha: 0.8 });
    g.circle(px, py, Math.max(1.5, wr * (0.3 + 0.9 * k))).fill({ color: AMBER, alpha: 0.3 + 0.65 * k }).stroke({ color: AMBER_DARK, width: 1.5, alpha: 0.9 });
  }
  return points.length;
}

/** One shot (px): a wasp or a stone; a hanging one blinks inside a faint threat ring, a flying one has a short trail. */
export function drawShot(g: Graphics, s: Pick<Shot, 'id' | 'kind' | 'x' | 'y' | 'vx' | 'vy' | 'r' | 'hang'>, clock: number, unit: number): void {
  const X = s.x * unit, Y = s.y * unit, rp = s.r * unit, hanging = s.hang > 0, speed = Math.hypot(s.vx, s.vy);
  const blink = hanging ? (Math.floor(clock * 10 + s.id) % 2 === 0 ? 1 : 0.45) : 1;
  const a = speed > 1e-6 ? Math.atan2(s.vy, s.vx) : 0, c = Math.cos(a), sn = Math.sin(a);
  if (hanging) {
    g.circle(X, Y, rp * 2).stroke({ color: THREAT_OUTLINE, width: 3, alpha: 0.4 * blink });
    g.circle(X, Y, rp * 2).stroke({ color: THREAT, width: 1.5, alpha: 0.7 * blink });
  } else if (speed > 1e-6) {
    // A short trail: two fading segments behind the shot.
    const len = Math.min(rp * 4.2, 0.34 * unit);
    g.moveTo(X, Y).lineTo(X - c * len * 0.55, Y - sn * len * 0.55).stroke({ color: s.kind === 'wasp' ? AMBER : STONE_LIGHT, width: rp * 0.95, alpha: 0.55, cap: 'round' });
    g.moveTo(X - c * len * 0.55, Y - sn * len * 0.55).lineTo(X - c * len, Y - sn * len).stroke({ color: s.kind === 'wasp' ? AMBER : STONE_LIGHT, width: rp * 0.55, alpha: 0.25, cap: 'round' });
  }
  if (s.kind === 'wasp') {
    const w = rp * 1.25, flap = 0.75 + 0.25 * Math.sin(clock * 40 + s.id);
    // Wings: two light ovals behind the middle, to both sides.
    for (const sy of [-1, 1]) {
      const [wx, wy] = rot(-w * 0.15, sy * w * 0.85, c, sn, X, Y);
      g.ellipse(wx, wy, w * 0.55, w * 0.32 * flap).fill({ color: WING, alpha: 0.75 * blink }).stroke({ color: NAVY, width: 1, alpha: 0.7 * blink });
    }
    const pts: number[] = [];
    for (const [x, y] of [[1.25, 0], [0, 0.72], [-1.0, 0], [0, -0.72]] as const) pts.push(...rot(x * w, y * w, c, sn, X, Y));
    g.poly(pts).fill({ color: AMBER, alpha: blink }).stroke({ color: NAVY, width: 2, alpha: blink, join: 'round' });
    g.moveTo(...rot(-w * 0.1, -w * 0.5, c, sn, X, Y)).lineTo(...rot(-w * 0.1, w * 0.5, c, sn, X, Y)).stroke({ color: AMBER_DARK, width: 2, alpha: blink });
    g.moveTo(...rot(w * 0.45, -w * 0.3, c, sn, X, Y)).lineTo(...rot(w * 0.45, w * 0.3, c, sn, X, Y)).stroke({ color: AMBER_DARK, width: 2, alpha: blink });
    g.moveTo(...rot(-w, 0, c, sn, X, Y)).lineTo(...rot(-w * 1.35, 0, c, sn, X, Y)).stroke({ color: NAVY, width: 2, alpha: blink, cap: 'round' });
  } else {
    const w = rp * 1.0, turn = (s.id * 1.7) % (Math.PI * 2);
    g.ellipse(X, Y + rp * 1.15, w * 0.95, w * 0.35).fill({ color: 0x050a07, alpha: 0.35 * blink });
    const pts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const b = turn + i * Math.PI * 2 / 5, rr = w * [1, 0.8, 1.06, 0.86, 0.96][i];
      pts.push(X + Math.cos(b) * rr, Y + Math.sin(b) * rr);
    }
    g.poly(pts).fill({ color: STONE, alpha: blink }).stroke({ color: NAVY, width: 2.5, alpha: blink, join: 'round' });
    g.poly([X - w * 0.5, Y - w * 0.25, X - w * 0.1, Y - w * 0.65, X + w * 0.15, Y - w * 0.3]).fill({ color: STONE_LIGHT, alpha: 0.75 * blink });
    g.moveTo(X + w * 0.1, Y + w * 0.15).lineTo(X + w * 0.5, Y + w * 0.45).stroke({ color: STONE_DARK, width: 1.5, alpha: 0.8 * blink });
  }
}

/**
 * The wisp's light round its body (px; `R` — the body's drawing radius): growing while it lights, a steady flickering halo in flight with
 * motes behind it (against its heading), a pale thin ring while a link holds it (the light is level — it waits), dimmer and blinking in
 * its last second. The body's own alpha and size — `WispLook`.
 */
export function drawWispGlow(g: Graphics, X: number, Y: number, R: number, st: { phase: 'lighting' | 'flying'; progress: number; left: number; fading: boolean; held: boolean; heading: number }, clock: number, id: number): void {
  if (st.phase === 'lighting') {
    const k = st.progress;
    g.circle(X, Y, R * (0.9 + 1.7 * k)).fill({ color: LIGHT, alpha: 0.12 + 0.2 * k });
    g.circle(X, Y, R * (0.9 + 1.0 * k)).fill({ color: LIGHT, alpha: 0.18 + 0.3 * k });
    g.circle(X, Y, R * (0.95 + 0.3 * k)).stroke({ color: LIGHT_CORE, width: 2, alpha: 0.3 + 0.6 * k });
    for (let i = 0; i < 6; i++) {
      const b = i * Math.PI / 3 + clock * 1.5, r0 = R * (0.9 + 0.4 * k), r1 = R * (1.1 + 1.3 * k);
      g.moveTo(X + Math.cos(b) * r0, Y + Math.sin(b) * r0).lineTo(X + Math.cos(b) * r1, Y + Math.sin(b) * r1);
    }
    g.stroke({ color: LIGHT, width: 2, alpha: 0.3 + 0.6 * k, cap: 'round' });
    return;
  }
  const dim = st.fading ? Math.max(0, Math.min(1, st.left / WISP_FADE)) : 1, blink = st.fading && Math.floor(clock * 12 + id) % 2 === 0 ? 0.5 : 1;
  const flicker = st.held ? 1 : 0.85 + 0.15 * Math.sin(clock * 17 + id * 2.3);
  g.circle(X, Y, R * 2.4 * flicker).fill({ color: LIGHT, alpha: 0.2 * dim * blink });
  g.circle(X, Y, R * 1.6 * flicker).fill({ color: LIGHT, alpha: 0.3 * dim * blink });
  g.circle(X, Y, R * 1.12).stroke({ color: LIGHT_CORE, width: 2, alpha: 0.75 * dim * blink });
  if (st.held) {
    g.circle(X, Y, R * 1.35).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.5 });
    g.circle(X, Y, R * 1.35).stroke({ color: LIGHT_CORE, width: 1.8, alpha: 0.9 });
    return;
  }
  // Motes behind it, against its heading.
  const c = Math.cos(st.heading), s = Math.sin(st.heading);
  for (let i = 1; i <= 3; i++) {
    const back = R * (0.9 + i * 0.55), wob = Math.sin(clock * 9 + i * 1.9 + id) * R * 0.18;
    g.circle(X - c * back - s * wob, Y - s * back + c * wob, R * (0.2 - i * 0.04)).fill({ color: LIGHT, alpha: (0.75 - i * 0.18) * dim * blink });
  }
}

/** A spark: a star of six rays (a shot put out), a ring (a shield took it), a flash (a hit), dust (an end of flight), a ring of motes. */
function sparkOf(kind: 'snuff' | 'block' | 'hit' | 'end' | 'out' | 'loose' | 'fade', unit: number): { g: Graphics; life: number; grow: boolean } {
  const g = new Graphics();
  if (kind === 'snuff') {
    for (let i = 0; i < 6; i++) {
      const b = i * Math.PI / 3 + 0.3, r0 = unit * 0.08, r1 = unit * (i % 2 ? 0.32 : 0.42);
      g.moveTo(Math.cos(b) * r0, Math.sin(b) * r0).lineTo(Math.cos(b) * r1, Math.sin(b) * r1);
    }
    g.stroke({ color: NAVY, width: 6, alpha: 0.7, cap: 'round' });
    for (let i = 0; i < 6; i++) {
      const b = i * Math.PI / 3 + 0.3, r0 = unit * 0.08, r1 = unit * (i % 2 ? 0.32 : 0.42);
      g.moveTo(Math.cos(b) * r0, Math.sin(b) * r0).lineTo(Math.cos(b) * r1, Math.sin(b) * r1);
    }
    g.stroke({ color: 0xfff2c4, width: 3, cap: 'round' });
    g.circle(0, 0, unit * 0.1).fill(0xffffff);
    return { g, life: 0.32, grow: true };
  }
  if (kind === 'block') {
    g.circle(0, 0, unit * 0.26).stroke({ color: NAVY, width: 6, alpha: 0.6 }).circle(0, 0, unit * 0.26).stroke({ color: 0xfff2c4, width: 3 });
    return { g, life: 0.3, grow: true };
  }
  if (kind === 'hit') {
    g.circle(0, 0, unit * 0.3).fill({ color: 0xff8a73, alpha: 0.6 }).stroke({ color: NAVY, width: 3, alpha: 0.8 });
    return { g, life: 0.25, grow: true };
  }
  if (kind === 'end') {
    g.circle(0, 0, unit * 0.14).fill({ color: STONE_LIGHT, alpha: 0.5 });
    return { g, life: 0.2, grow: true };
  }
  if (kind === 'fade') {
    // The wasps of a dead hive go out with it: a quiet amber puff, no star of a blow.
    g.circle(0, 0, unit * 0.16).fill({ color: AMBER, alpha: 0.35 }).circle(0, 0, unit * 0.16).stroke({ color: AMBER_DARK, width: 1.5, alpha: 0.6 });
    return { g, life: 0.5, grow: true };
  }
  if (kind === 'loose') {
    g.circle(0, 0, RING_RADIUS * unit).stroke({ color: AMBER, width: 4, alpha: 0.9 });
    return { g, life: 0.25, grow: true };
  }
  for (let i = 0; i < 6; i++) {
    const b = i * Math.PI / 3, rr = unit * 0.3;
    g.circle(Math.cos(b) * rr, Math.sin(b) * rr, unit * 0.05).fill({ color: LIGHT, alpha: 0.9 });
  }
  g.circle(0, 0, unit * 0.3).stroke({ color: LIGHT, width: 2, alpha: 0.5 });
  return { g, life: 0.4, grow: true };
}

/** The view of the forest's shooters: signs, shots, the wisps' light and the sparks. One per renderer. */
export class ShooterView {
  /** Over the enemies, under the hero's effects: the sparks. */
  readonly layer = new Container();
  readonly shown: ShooterShown = emptyShown();
  private readonly sparks: { g: Graphics; life: number; total: number }[] = [];

  /** Forgets the fight (a new arena, a restart). */
  reset(): void {
    for (const s of this.sparks) s.g.destroy();
    this.sparks.length = 0;
    Object.assign(this.shown, emptyShown());
  }

  /** The body's look of a wisp now (its alpha and size); null — not a wisp. */
  wispLook(world: World, e: { id: number; kind: string }, clock: number): WispLook | null {
    if (e.kind !== WISP) return null;
    const st = wispState(world, e as never);
    if (!st) return null;
    if (st.phase === 'lighting') return { alpha: 0.5 + 0.5 * st.progress, scale: 0.55 + 0.45 * st.progress };
    if (!st.fading || st.held) return { alpha: 1, scale: 1 };
    const dim = Math.max(0, Math.min(1, st.left / WISP_FADE)), blink = Math.floor(clock * 12 + e.id) % 2 === 0 ? 0.6 : 1;
    return { alpha: (0.35 + 0.65 * dim) * blink, scale: 1 };
  }

  /**
   * Draws the signs, the shots and the light into `g` (the renderer's cleared signal layer; px of the arena). `sees` — the camera's
   * test (a point in view with a margin in units). `R` — an enemy's drawing radius in px.
   */
  draw(g: Graphics, world: World, clock: number, unit: number, R: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const sh = this.shown;
    sh.lines = 0; sh.lineProgress = 0; sh.dots = 0; sh.swellProgress = 0; sh.shots = 0; sh.hanging = 0; sh.flying = 0; sh.stones = 0; sh.wasps = 0;
    sh.wispsLighting = 0; sh.wispsFlying = 0; sh.wispsFading = 0; sh.wispsHeld = 0; sh.wispLight = 0;
    for (const e of world.enemies) {
      if (e.kind === SLINGER) {
        const w = slingerLines(world, e);
        if (w) { sh.lines += drawSlingLines(g, w.lines, w.progress, unit); sh.lineProgress = w.progress; }
      } else if (e.kind === HIVE) {
        const sw = hiveSwell(world, e);
        if (sw) { sh.dots += drawHiveSwell(g, e.x * unit, e.y * unit, R * 1.2 * 0.95, sw.points, sw.progress, clock, unit); sh.swellProgress = sw.progress; }
      } else if (e.kind === WISP) {
        const st = wispState(world, e);
        if (!st || !sees(e, 2)) continue;
        drawWispGlow(g, e.x * unit, e.y * unit, R * 0.7, st, clock, e.id);
        if (st.phase === 'lighting') { sh.wispsLighting++; sh.wispLight = Math.max(sh.wispLight, st.progress); }
        else { sh.wispsFlying++; if (st.held) sh.wispsHeld++; else if (st.fading) sh.wispsFading++; }
      }
    }
    for (const s of liveShots(world)) {
      // Task 60а: the queen's stars and the jester's balls are the guests' view (castleGuestsView.ts).
      if (s.kind === 'star' || s.kind === 'ball') continue;
      if (!sees(s, 1)) continue;
      drawShot(g, s, clock, unit);
      sh.shots++;
      if (s.hang > 0) sh.hanging++; else sh.flying++;
      if (s.kind === 'wasp') sh.wasps++; else sh.stones++;
    }
  }

  /** One world event: the sparks of the shots and the shooters (everything else is not ours). Returns true when the event was ours. */
  onEvent(ev: WorldEvent, unit: number): boolean {
    if (ev.type === 'shot') {
      if (ev.action === 'end' && ev.by === 'owner') { this.shown.fades++; this.spark('fade', ev.x, ev.y, unit); return true; }
      const kind = ev.action === 'snuff' ? 'snuff' : ev.action === 'block' ? 'block' : ev.action === 'hit' ? 'hit' : 'end';
      if (kind === 'snuff') this.shown.snuffs++; else if (kind === 'block') this.shown.blocks++; else if (kind === 'hit') this.shown.hits++; else this.shown.ends++;
      this.spark(kind, ev.x, ev.y, unit);
      return true;
    }
    if (ev.type === 'wisp') {
      if (ev.action === 'out') { this.shown.wispOuts++; this.spark('out', ev.x, ev.y, unit); }
      return true;
    }
    if (ev.type === 'shooter') {
      if (ev.action === 'loose' && ev.kind === HIVE) { this.shown.looses++; this.spark('loose', ev.x, ev.y, unit); }
      else if (ev.action === 'loose') this.shown.looses++;
      return true;
    }
    return false;
  }

  private spark(kind: Parameters<typeof sparkOf>[0], x: number, y: number, unit: number): void {
    const s = sparkOf(kind, unit);
    s.g.position.set(x * unit, y * unit);
    this.layer.addChild(s.g);
    this.sparks.push({ g: s.g, life: s.life, total: s.life });
  }

  /** Real seconds pass: the sparks grow and fade. */
  update(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { s.g.destroy(); this.sparks.splice(i, 1); continue; }
      const k = s.life / s.total;
      s.g.alpha = Math.min(1, k * 1.5);
      s.g.scale.set(0.7 + (1 - k) * 0.7);
    }
  }
}
