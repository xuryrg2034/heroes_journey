/**
 * Task 57б «Лес: механики», part ui (design 22.10.2026, docs/design-notes/task-57-forest-enemies.md, 12; docs/realtime-elite-behaviors.md,
 * «Лес: механики»): the view of the rootling («Корневик»), the slime («Слизень») and the firebrand («Головешка») — procedural where the art is
 * missing, in the arena's style (navy outline, flat colours). The design's answers (22.10.2026):
 * - the stump is a neutral brown (it is no link: a chain colour on it would ask for a click); the group's colour is only in its leaf mark —
 *   one of two leaf patterns, on every body and stump of the group; the art `forest-stump.png` stands in for the drawn stump when loaded;
 * - the stump's countdown is an arc over it — the shape of the Troll's «Храп», but white with a navy edge (lemon is the Troll's window);
 *   frozen — the cold's mark on it (the countdown waits); the hero on it with the countdown over — the full arc blinks;
 * - «рассыплются» (`ChainPlan.crumble`): the group's leaf on its stumps and on those links of the chain turns light, with 2–3 splinters
 *   falling under it — static, no ring (white rings are the Warlock's dropped links), no crack (a crack is the centipede's split);
 * - a pair of slimes: one glow under both and a thin pale bridge over their heads, both filling as the merge's clock runs; the merge — a pop;
 * - the firebrand: a flame crest while it burns (the art has its own), smoke while it is out, a flame growing at the brazier, a flash
 *   when it lights; in the plan «погаснет» (`StrikeOutcome.douse`) is the survivor's sign (render.ts) with smoke over the link.
 * View only: it reads the world through the sim's helpers (`stumpState`, `rootGroup`, `slimePairs`, `slimeBig`, `brandState`) and the
 * plan, never writes the world, never rolls a die.
 */
import { Container, Graphics, Sprite, type GraphicsContext } from 'pixi.js';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import type { ChainPlan } from '../sim/chain';
import { FIREBRAND, brandState } from '../sim/enemies/firebrand';
import { ROOTLING, rootGroup, stumpState } from '../sim/enemies/rootling';
import { kindOf } from '../sim/enemies/kinds';
import { SLIME, slimeBig, slimePairs } from '../sim/enemies/slime';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { drawIceMark } from './formsView';

const NAVY = 0x18232d;
const THREAT = 0xffffff, THREAT_OUTLINE = 0x0b0f14;
/** The stump and the rootling's wood: neutral browns, outside the chain palette. */
const WOOD = 0x8a5a34, WOOD_DARK = 0x5a3820, WOOD_CUT = 0xd9a86a, WOOD_RING = 0x9c6a3c;
/** The slime's pale line and droplets. */
const SLIME_PALE = 0xe9f6dc;
/** The firebrand's fire and smoke (outside the chain palette, the colours of the fire trail). */
const EMBER = 0xff8a3a, FLAME = 0xffd36b, CHAR = 0x3a3238, SMOKE = 0x9a9aa4;
const COLD = 0xbfe3ff, WATER = 0x6fb6e8;

type Draw = Graphics | GraphicsContext;

/** The stump's art: its box side and the stump's feet at the disc's bottom (body radii). */
export const STUMP_ART = { id: 'forest-stump' as const, size: 2.7 };

/** The shown counts of the last frame / since the fight began (tests read them through `window.__realtime`). */
export interface ForestMechShown {
  /** Stumps drawn this frame; their countdown arcs; waiting under the cold, under the hero, while the move runs; the fullest arc (0…1). */
  stumps: number; stumpArcs: number; stumpCold: number; stumpHero: number; stumpMove: number; stumpFill: number;
  /** Stumps drawn by the art (the rest — procedural). */
  stumpArt: number;
  /** Leaf marks drawn this frame (bodies and stumps of rootlings), the groups they mark and the leaf patterns among them. */
  leaves: number; groups: number; patterns: number;
  /** Slime pairs drawn this frame and the fullest merge clock (0…1); big slimes on screen. */
  pairs: number; pairFill: number; bigSlimes: number;
  /** Firebrands drawn this frame: burning, out (running, waiting or given up), lighting at a brazier; the fullest relight (0…1). */
  brandsBurning: number; brandsOut: number; brandsRelighting: number; relightFill: number;
  /** In the drawn chain's plan this frame: stumps and links marked «рассыплются», links marked «погаснет». */
  planCrumbleStumps: number; planCrumbleLinks: number; planDouses: number;
  /**
   * Since the fight began: stumps laid, risen, crumbled (stumps), burnt; merges; firebrands put out, lit again; links dropped when Fire lit
   * a firebrand of the drawn chain (render.ts says «после выжившего» over it).
   */
  lies: number; rises: number; crumbled: number; burns: number; merges: number; outs: number; lits: number; dropped: number;
}

const emptyShown = (): ForestMechShown => ({
  stumps: 0, stumpArcs: 0, stumpCold: 0, stumpHero: 0, stumpMove: 0, stumpFill: 0, stumpArt: 0, leaves: 0, groups: 0, patterns: 0,
  pairs: 0, pairFill: 0, bigSlimes: 0, brandsBurning: 0, brandsOut: 0, brandsRelighting: 0, relightFill: 0,
  planCrumbleStumps: 0, planCrumbleLinks: 0, planDouses: 0,
  lies: 0, rises: 0, crumbled: 0, burns: 0, merges: 0, outs: 0, lits: 0, dropped: 0,
});

const mix = (a: number, b: number, k: number): number => {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

// ---- Silhouettes behind the colour disc (the renderer's `enemyContext`; the missing art falls back to them) ----

/** The rootling: a cut top of a stump over the disc (with its rings) and roots spreading below. */
export function rootlingMarks(ctx: Draw, r: number): void {
  for (const sx of [-1, 1]) {
    ctx.poly([sx * r * 0.45, r * 0.6, sx * r * 1.25, r * 1.05, sx * r * 1.1, r * 0.8, sx * r * 0.8, r * 0.45]).fill(WOOD).stroke({ color: NAVY, width: 2.5, join: 'round' });
    ctx.poly([sx * r * 0.85, -r * 0.1, sx * r * 1.45, -r * 0.55, sx * r * 1.3, -r * 0.2]).fill(WOOD).stroke({ color: NAVY, width: 2.5, join: 'round' });
  }
  ctx.poly([-r * 0.75, -r * 0.65, -r * 0.6, -r * 1.2, r * 0.6, -r * 1.2, r * 0.75, -r * 0.65]).fill(WOOD).stroke({ color: NAVY, width: 3, join: 'round' });
  ctx.ellipse(0, -r * 1.2, r * 0.6, r * 0.2).fill(WOOD_CUT).stroke({ color: NAVY, width: 2.5 });
  ctx.ellipse(0, -r * 1.2, r * 0.3, r * 0.09).stroke({ color: WOOD_RING, width: 2 });
}

/** The slime: drips at its foot and two bubbles on top (the body is the disc; the big one is the same, larger). */
export function slimeMarks(ctx: Draw, r: number): void {
  for (const [x, w] of [[-0.6, 0.22], [0.1, 0.28], [0.65, 0.2]] as const) ctx.ellipse(r * x, r * 0.95, r * w, r * w * 0.6).fill(SLIME_PALE).stroke({ color: NAVY, width: 2 });
  ctx.circle(-r * 0.4, -r * 1.05, r * 0.22).fill(SLIME_PALE).stroke({ color: NAVY, width: 2 });
  ctx.circle(r * 0.25, -r * 1.25, r * 0.15).fill(SLIME_PALE).stroke({ color: NAVY, width: 2 });
}

/** The firebrand: a charred log across the disc, its ends sticking out (the flame or the smoke is drawn per frame). */
export function firebrandMarks(ctx: Draw, r: number): void {
  ctx.roundRect(-r * 1.35, -r * 0.5, r * 2.7, r * 0.55, r * 0.25).fill(CHAR).stroke({ color: NAVY, width: 3 });
  for (const sx of [-1, 1]) ctx.ellipse(sx * r * 1.3, -r * 0.22, r * 0.14, r * 0.26).fill(EMBER).stroke({ color: NAVY, width: 2 });
  ctx.moveTo(-r * 0.6, -r * 0.35).lineTo(-r * 0.3, -r * 0.15).moveTo(r * 0.2, -r * 0.4).lineTo(r * 0.5, -r * 0.2).stroke({ color: EMBER, width: 2, cap: 'round' });
}

// ---- Signs ----

/**
 * The group's leaf mark (px): pattern 0 — a pointed leaf with its vein, 1 — a three-lobed one; in the group's `ink`. `light` — the
 * plan's «рассыплются»: the leaf turns light and larger, 2–3 splinters fall under it (static).
 */
export function drawLeaf(g: Graphics, x: number, y: number, s: number, ink: number, pattern: number, light = false): void {
  const fill = light ? mix(ink, 0xffffff, 0.6) : ink, k = light ? 1.3 : 1, S = s * k;
  if (pattern % 2 === 0) {
    g.moveTo(x - S, y + S * 0.15).quadraticCurveTo(x - S * 0.1, y - S * 0.95, x + S, y - S * 0.15).quadraticCurveTo(x + S * 0.1, y + S * 0.95, x - S, y + S * 0.15)
      .fill(fill).stroke({ color: NAVY, width: light ? 4 : 3, join: 'round' });
    g.moveTo(x - S * 0.85, y + S * 0.12).lineTo(x + S * 0.8, y - S * 0.12).stroke({ color: NAVY, width: 2, cap: 'round' });
  } else {
    for (const a of [-Math.PI / 2, -Math.PI / 2 + 2.1, -Math.PI / 2 - 2.1]) g.circle(x + Math.cos(a) * S * 0.48, y + Math.sin(a) * S * 0.48, S * 0.45);
    g.fill(fill).stroke({ color: NAVY, width: light ? 4 : 3 });
    g.moveTo(x, y + S * 0.15).lineTo(x + S * 0.2, y + S * 0.95).stroke({ color: NAVY, width: 3, cap: 'round' });
  }
  if (!light) return;
  // The splinters: three short slivers of light wood falling under the leaf, tilted (a fixed table).
  for (const [dx, dy, a] of [[-0.55, 1.25, 0.5], [0.15, 1.6, -0.35], [0.7, 1.15, 0.9]] as const) {
    const cx = x + S * dx, cy = y + S * dy, c = Math.cos(a) * S * 0.32, sn = Math.sin(a) * S * 0.32;
    g.moveTo(cx - c, cy - sn).lineTo(cx + c, cy + sn).stroke({ color: NAVY, width: 4.5, cap: 'round' });
    g.moveTo(cx - c, cy - sn).lineTo(cx + c, cy + sn).stroke({ color: WOOD_CUT, width: 2.2, cap: 'round' });
  }
}

/** Where a rootling's or a stump's leaf stands: left of the body, low (clear of the plaque, the HP badge and the plan's badge). */
const leafAt = (x: number, y: number, R: number): { x: number; y: number; s: number } => ({ x: x - R * 1.0, y: y + R * 0.45, s: R * 0.5 });

/** The drawn stump (px; `R` — the body's drawing radius): a short brown trunk, its light cut top with rings, roots to the sides. */
export function drawStump(g: Graphics, X: number, Y: number, R: number): void {
  g.ellipse(X, Y + R * 0.75, R * 1.0, R * 0.3).fill({ color: 0x050a07, alpha: 0.4 });
  for (const sx of [-1, 1]) g.poly([X + sx * R * 0.5, Y + R * 0.35, X + sx * R * 1.15, Y + R * 0.8, X + sx * R * 0.95, Y + R * 0.5]).fill(WOOD_DARK).stroke({ color: NAVY, width: 2.5, join: 'round' });
  g.poly([X - R * 0.7, Y - R * 0.2, X - R * 0.75, Y + R * 0.65, X + R * 0.75, Y + R * 0.65, X + R * 0.7, Y - R * 0.2]).fill(WOOD).stroke({ color: NAVY, width: 3, join: 'round' });
  g.ellipse(X, Y - R * 0.2, R * 0.7, R * 0.28).fill(WOOD_CUT).stroke({ color: NAVY, width: 3 });
  g.ellipse(X, Y - R * 0.2, R * 0.42, R * 0.15).stroke({ color: WOOD_RING, width: 2 });
  g.ellipse(X, Y - R * 0.2, R * 0.16, R * 0.06).stroke({ color: WOOD_RING, width: 2 });
  // The slit of a mouth (the art's sleeping face, kept simple).
  g.moveTo(X - R * 0.35, Y + R * 0.25).lineTo(X + R * 0.3, Y + R * 0.2).stroke({ color: NAVY, width: 3, cap: 'round' });
}

/**
 * The stump's countdown arc (px) over it — the shape of «Храп» (from the left over the top), white with a navy edge: a faint whole and the
 * filled part `fill` 0…1. `alpha` — a blink.
 */
export function drawStumpArc(g: Graphics, cx: number, cy: number, R: number, fill: number, alpha = 1): void {
  const a0 = Math.PI * 1.1, a1 = Math.PI * 1.9, span = a1 - a0, sx = cx + Math.cos(a0) * R, sy = cy + Math.sin(a0) * R;
  g.moveTo(sx, sy).arc(cx, cy, R, a0, a1).stroke({ color: THREAT_OUTLINE, width: 8, alpha: 0.55 * alpha, cap: 'round' });
  g.moveTo(sx, sy).arc(cx, cy, R, a0, a1).stroke({ color: THREAT, width: 1.5, alpha: 0.45 * alpha, cap: 'round' });
  if (fill <= 0.005) return;
  const e = a0 + span * Math.min(1, fill);
  g.moveTo(sx, sy).arc(cx, cy, R, a0, e).stroke({ color: THREAT_OUTLINE, width: 8, alpha, cap: 'round' });
  g.moveTo(sx, sy).arc(cx, cy, R, a0, e).stroke({ color: THREAT, width: 4, alpha, cap: 'round' });
}

/**
 * A pair of slimes, the floor's part (px, under the bodies): one glow round both — a soft capsule in the pair's `ink` and pale slime,
 * growing with the merge's clock `fill` (the two bodies touch, so a glow round each would hide behind them).
 */
export function drawSlimeGlow(g: Graphics, a: { x: number; y: number }, b: { x: number; y: number }, Ra: number, Rb: number, fill: number, ink: number, clock: number): void {
  const k = Math.max(0, Math.min(1, fill)), pulse = 0.9 + 0.1 * Math.sin(clock * (8 + 10 * k)), R = Math.max(Ra, Rb) * (1.25 + 0.45 * k) * pulse;
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: ink, width: R * 2, alpha: 0.14 + 0.3 * k, cap: 'round' });
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: SLIME_PALE, width: R * 1.5, alpha: 0.08 + 0.25 * k, cap: 'round' });
}

/**
 * A pair of slimes, over the bodies (px): a thin pale bridge over their heads that fills from both ends with the merge's clock `fill` and
 * meets at the top (the big one forms there: a growing drop). Not a ring and not a chain's line: a curve above the heads.
 */
export function drawSlimeBridge(g: Graphics, a: { x: number; y: number }, b: { x: number; y: number }, Ra: number, Rb: number, fill: number): void {
  const k = Math.max(0, Math.min(1, fill)), ax = a.x, ay = a.y - Ra * 1.05, bx = b.x, by = b.y - Rb * 1.05;
  const cx = (ax + bx) / 2, cy = Math.min(ay, by) - Math.max(Ra, Rb) * 0.9;
  const at = (t: number): [number, number] => [(1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by];
  const path = (t0: number, t1: number): void => {
    const n = 10;
    g.moveTo(...at(t0));
    for (let i = 1; i <= n; i++) g.lineTo(...at(t0 + (t1 - t0) * i / n));
  };
  path(0, 1);
  g.stroke({ color: NAVY, width: 4, alpha: 0.45, cap: 'round', join: 'round' });
  path(0, 1);
  g.stroke({ color: SLIME_PALE, width: 1.5, alpha: 0.5, cap: 'round', join: 'round' });
  if (k > 0.01) {
    for (const [t0, t1] of [[0, 0.5 * k], [1, 1 - 0.5 * k]] as const) {
      path(t0, t1);
      g.stroke({ color: NAVY, width: 6, alpha: 0.8, cap: 'round', join: 'round' });
      path(t0, t1);
      g.stroke({ color: SLIME_PALE, width: 3, cap: 'round', join: 'round' });
    }
    const [mx, my] = at(0.5);
    g.circle(mx, my, Math.max(2, Math.min(Ra, Rb) * 0.35 * k)).fill({ color: SLIME_PALE, alpha: 0.4 + 0.6 * k }).stroke({ color: NAVY, width: 2, alpha: 0.9 });
  }
}

/** A flame (px) standing on `x, y` (its foot), `h` tall, flickering with the clock; `k` — its size 0…1. */
export function drawFlame(g: Graphics, x: number, y: number, h: number, clock: number, seed: number, k = 1): void {
  const H = h * Math.max(0.05, k) * (0.9 + 0.1 * Math.sin(clock * 15 + seed)), w = H * 0.42, lean = Math.sin(clock * 7 + seed * 1.7) * w * 0.25;
  g.poly([x - w, y, x - w * 0.7, y - H * 0.45, x - w * 0.25, y - H * 0.35, x + lean, y - H, x + w * 0.3, y - H * 0.4, x + w * 0.7, y - H * 0.55, x + w, y]).fill(EMBER).stroke({ color: NAVY, width: 2.5, join: 'round' });
  g.poly([x - w * 0.5, y, x - w * 0.2, y - H * 0.35, x + lean * 0.6, y - H * 0.65, x + w * 0.25, y - H * 0.3, x + w * 0.5, y]).fill(FLAME);
}

/** Smoke (px) rising from `x, y`: two or three grey curls drifting with the clock; `alpha` — how thick. */
export function drawSmoke(g: Graphics, x: number, y: number, s: number, clock: number, seed: number, alpha = 0.7, curls = 2): void {
  for (let i = 0; i < curls; i++) {
    const t = (clock * 0.8 + i / curls + seed * 0.13) % 1, up = s * (0.3 + 1.8 * t), sway = Math.sin(clock * 3 + i * 2.1 + seed) * s * 0.35;
    g.circle(x + sway + (i - (curls - 1) / 2) * s * 0.45, y - up, s * (0.28 + 0.3 * t)).fill({ color: SMOKE, alpha: alpha * (1 - t) });
  }
}

type Burst = 'crumble' | 'burn' | 'lie' | 'rise' | 'merge' | 'out' | 'cold' | 'water' | 'lit';

/** A short burst (px of the arena, its own origin): splinters, ash, dust, earth, a pop of slime, smoke, a fire's flash. */
function burstOf(kind: Burst, unit: number, ink: number): { g: Graphics; life: number; fall: boolean } {
  const g = new Graphics(), u = unit;
  if (kind === 'crumble') {
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7 + 0.3, r0 = u * 0.1, r1 = u * (0.32 + (i % 3) * 0.06), c = Math.cos(a), s = Math.sin(a);
      g.moveTo(c * r0, s * r0).lineTo(c * r1, s * r1).stroke({ color: NAVY, width: 5, cap: 'round' });
      g.moveTo(c * r0, s * r0).lineTo(c * r1, s * r1).stroke({ color: WOOD_CUT, width: 2.5, cap: 'round' });
    }
    g.circle(0, 0, u * 0.18).fill({ color: WOOD, alpha: 0.5 });
    return { g, life: 0.55, fall: true };
  }
  if (kind === 'burn') {
    g.circle(0, 0, u * 0.32).fill({ color: EMBER, alpha: 0.45 }).circle(0, 0, u * 0.18).fill({ color: FLAME, alpha: 0.6 });
    for (let i = 0; i < 5; i++) g.circle(Math.cos(i * 1.3) * u * 0.25, Math.sin(i * 1.3) * u * 0.15, u * 0.05).fill({ color: CHAR, alpha: 0.8 });
    return { g, life: 0.6, fall: true };
  }
  if (kind === 'lie') {
    g.ellipse(0, u * 0.2, u * 0.36, u * 0.12).fill({ color: WOOD_CUT, alpha: 0.35 });
    return { g, life: 0.35, fall: false };
  }
  if (kind === 'rise') {
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.45; g.circle(Math.cos(a) * u * 0.3, Math.sin(a) * u * 0.3, u * 0.06).fill({ color: WOOD_DARK, alpha: 0.85 }); }
    g.ellipse(0, u * 0.2, u * 0.4, u * 0.13).stroke({ color: WOOD, width: 3, alpha: 0.7 });
    return { g, life: 0.4, fall: false };
  }
  if (kind === 'merge') {
    g.circle(0, 0, u * 0.45).fill({ color: ink, alpha: 0.35 }).stroke({ color: NAVY, width: 3, alpha: 0.6 });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.2; g.circle(Math.cos(a) * u * 0.55, Math.sin(a) * u * 0.55, u * 0.07).fill(SLIME_PALE).stroke({ color: NAVY, width: 1.5 }); }
    return { g, life: 0.4, fall: false };
  }
  if (kind === 'lit') {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r0 = u * 0.12, r1 = u * (i % 2 ? 0.4 : 0.55);
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    g.stroke({ color: NAVY, width: 6, alpha: 0.6, cap: 'round' });
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r0 = u * 0.12, r1 = u * (i % 2 ? 0.4 : 0.55);
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    g.stroke({ color: FLAME, width: 3, cap: 'round' });
    g.circle(0, 0, u * 0.18).fill(EMBER);
    return { g, life: 0.45, fall: false };
  }
  // Put out: a puff — grey smoke for a hit, pale for the cold, a blue splash in water.
  const color = kind === 'cold' ? COLD : kind === 'water' ? WATER : SMOKE;
  g.circle(0, -u * 0.1, u * 0.3).fill({ color, alpha: 0.55 }).circle(-u * 0.2, -u * 0.3, u * 0.18).fill({ color, alpha: 0.45 }).circle(u * 0.22, -u * 0.32, u * 0.15).fill({ color, alpha: 0.4 });
  return { g, life: 0.6, fall: false };
}

/** The view of the forest's tricksters: stumps, leaves, slime pairs, the firebrands' fire and smoke, the plan's signs, the bursts. */
export class ForestMechView {
  /** On the floor, under the bodies: the stumps (their art or the drawn stump) and the slime pairs. */
  readonly floor = new Container();
  /** Over the enemies, under the hero's effects: the bursts. */
  readonly layer = new Container();
  readonly shown: ForestMechShown = emptyShown();
  private readonly floorG = new Graphics();
  private readonly stumpSprites = new Map<number, Sprite>();
  private readonly bursts: { g: Graphics; life: number; total: number; fall: boolean }[] = [];
  /** The leaf pattern of each group seen (view only: the lowest pattern no other group on screen has). */
  private readonly patterns = new Map<number, number>();
  /** The stumps' places of the last frame (a crumble names its stumps by id). */
  private readonly stumpsAt = new Map<number, { x: number; y: number }>();

  constructor(private readonly ink: (color: number) => number) {
    this.floor.addChild(this.floorG);
  }

  /** Forgets the fight (a new arena, a restart). */
  reset(): void {
    for (const b of this.bursts) b.g.destroy();
    this.bursts.length = 0;
    for (const s of this.stumpSprites.values()) s.destroy();
    this.stumpSprites.clear();
    this.patterns.clear();
    this.stumpsAt.clear();
    this.floorG.clear();
    Object.assign(this.shown, emptyShown());
  }

  /** The leaf pattern of `group` (kept while the group is seen; a new group takes the lowest free one). */
  private patternOf(group: number, live: ReadonlySet<number>): number {
    let p = this.patterns.get(group);
    if (p !== undefined) return p;
    const used = new Set([...this.patterns].filter(([g]) => live.has(g)).map(([, q]) => q));
    for (p = 0; used.has(p); p++);
    this.patterns.set(group, p);
    return p;
  }

  /**
   * A slime's drawing scale against the common one: its kind's own (`artScaleOf`: small ×0.85, big ×1.4 — the radius its press zone and
   * reach use); 1 — not a slime (the other kinds keep the common drawing).
   */
  slimeScale(e: Enemy): number {
    if (e.kind !== SLIME) return 1;
    const kind = kindOf(e);
    return kind.artScaleOf?.(e) ?? kind.artScale;
  }

  /**
   * The floor (under the bodies): the stumps and the slime pairs. `R` — an enemy's drawing radius in px; `sees` — the camera's test.
   */
  drawFloor(world: World, clock: number, unit: number, R: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const g = this.floorG.clear(), sh = this.shown, stumps = stumpState(world), live = new Set<number>();
    sh.stumps = 0; sh.stumpArt = 0; sh.pairs = 0; sh.pairFill = 0;
    // The plan's signs are drawn later in the frame, only while a chain is drawn (`drawPlan`).
    sh.planCrumbleStumps = 0; sh.planCrumbleLinks = 0; sh.planDouses = 0;
    this.stumpsAt.clear();
    const art = hasCharacterArt(STUMP_ART.id);
    for (const s of stumps) {
      live.add(s.id);
      this.stumpsAt.set(s.id, { x: s.x, y: s.y });
      let sprite = this.stumpSprites.get(s.id);
      if (art && !sprite) {
        sprite = characterSprite(STUMP_ART.id, R * STUMP_ART.size, R * STUMP_ART.size) ?? undefined;
        if (sprite) { this.floor.addChild(sprite); this.stumpSprites.set(s.id, sprite); }
      }
      const visible = sees(s, 1.5);
      if (sprite) { sprite.position.set(s.x * unit, s.y * unit + R * (1 - STUMP_ART.size / 2)); sprite.visible = visible; }
      if (!visible) continue;
      sh.stumps++;
      if (sprite) sh.stumpArt++;
      else drawStump(g, s.x * unit, s.y * unit, R);
    }
    for (const [id, sprite] of this.stumpSprites) if (!live.has(id)) { sprite.destroy(); this.stumpSprites.delete(id); }
    const byId = new Map(world.enemies.map(e => [e.id, e] as const));
    for (const p of slimePairs(world)) {
      const a = byId.get(p.a), b = byId.get(p.b);
      if (!a || !b || (!sees(a, 1.5) && !sees(b, 1.5))) continue;
      sh.pairs++;
      sh.pairFill = Math.max(sh.pairFill, p.share);
      drawSlimeGlow(g, { x: a.x * unit, y: a.y * unit }, { x: b.x * unit, y: b.y * unit }, R * this.slimeScale(a), R * this.slimeScale(b), p.share, this.ink(a.color), clock);
    }
  }

  /**
   * Over the bodies (`g` — the renderer's cleared signal layer; px of the arena): the stumps' arcs and the cold on them, the groups' leaves,
   * the firebrands' fire, smoke and relight.
   */
  draw(g: Graphics, world: World, clock: number, unit: number, R: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const sh = this.shown;
    sh.stumpArcs = 0; sh.stumpCold = 0; sh.stumpHero = 0; sh.stumpMove = 0; sh.stumpFill = 0; sh.leaves = 0; sh.groups = 0; sh.patterns = 0; sh.bigSlimes = 0;
    sh.brandsBurning = 0; sh.brandsOut = 0; sh.brandsRelighting = 0; sh.relightFill = 0;
    const stumps = stumpState(world), groups = new Set<number>();
    for (const s of stumps) groups.add(s.group);
    for (const e of world.enemies) if (e.kind === ROOTLING) groups.add(rootGroup(e));
    for (const group of [...this.patterns.keys()]) if (!groups.has(group)) this.patterns.delete(group);
    const marked = new Set<number>();
    for (const s of stumps) {
      if (!sees(s, 1.5)) continue;
      // Its countdown over (the sim's: within 1e-9 of 0) and the hero on it — the arc is full.
      const X = s.x * unit, Y = s.y * unit, fill = s.waiting === 'hero' || s.full <= 0 ? 1 : Math.min(1, 1 - s.left / s.full);
      const blink = s.waiting === 'hero' ? (Math.floor(clock * 8) % 2 === 0 ? 1 : 0.4) : 1;
      drawStumpArc(g, X, Y - R * 0.1, R * 1.25, fill, blink);
      sh.stumpArcs++;
      sh.stumpFill = Math.max(sh.stumpFill, fill);
      if (s.waiting === 'cold') { sh.stumpCold++; drawIceMark(g, X, Y, R * 0.8, false); }
      else if (s.waiting === 'hero') sh.stumpHero++;
      else if (s.waiting === 'move') sh.stumpMove++;
      const at = leafAt(X, Y, R);
      drawLeaf(g, at.x, at.y, at.s, this.ink(s.color), this.patternOf(s.group, groups));
      sh.leaves++;
      marked.add(s.group);
    }
    for (const e of world.enemies) {
      if (!sees(e, 1.5)) continue;
      if (e.kind === ROOTLING) {
        const group = rootGroup(e), at = leafAt(e.x * unit, e.y * unit, R);
        drawLeaf(g, at.x, at.y, at.s, this.ink(e.color), this.patternOf(group, groups));
        sh.leaves++;
        marked.add(group);
      } else if (e.kind === SLIME) {
        if (slimeBig(e)) sh.bigSlimes++;
      } else if (e.kind === FIREBRAND) {
        const st = brandState(world, e);
        if (!st) continue;
        const X = e.x * unit, Y = e.y * unit, art = hasCharacterArt(st.phase === 'burning' ? 'forest-firebrand' : 'forest-firebrand-out');
        if (st.phase === 'burning') {
          sh.brandsBurning++;
          // The art has its own flame; the drawn log gets a crest of fire.
          if (!art) drawFlame(g, X, Y - R * 0.55, R * 1.3, clock, e.id);
        } else if (st.phase === 'relighting') {
          sh.brandsRelighting++;
          sh.relightFill = Math.max(sh.relightFill, st.share);
          drawFlame(g, X, Y - R * 0.6, R * 1.5, clock, e.id, 0.2 + 0.8 * st.share);
        } else {
          sh.brandsOut++;
          if (!art) drawSmoke(g, X, Y - R * 0.7, R * 0.45, clock, e.id, 0.6);
        }
      }
    }
    sh.groups = marked.size;
    // The slime pairs' bridges over the heads (their glow is on the floor).
    const byId = new Map(world.enemies.map(e => [e.id, e] as const));
    for (const p of slimePairs(world)) {
      const a = byId.get(p.a), b = byId.get(p.b);
      if (a && b && (sees(a, 1.5) || sees(b, 1.5))) drawSlimeBridge(g, { x: a.x * unit, y: a.y * unit }, { x: b.x * unit, y: b.y * unit }, R * this.slimeScale(a), R * this.slimeScale(b), p.share);
    }
    sh.patterns = new Set([...marked].map(group => this.patterns.get(group))).size;
  }

  /**
   * The drawn chain's signs (`g` — the chain layer; px): «рассыплются» — the light leaf with splinters on the group's stumps and on those
   * links; «погаснет» — smoke over the link the plan puts out (render.ts draws its survivor sign).
   */
  drawPlan(g: Graphics, world: World, plan: Pick<ChainPlan, 'crumble' | 'links'>, clock: number, unit: number, R: number): void {
    const sh = this.shown;
    sh.planCrumbleStumps = 0; sh.planCrumbleLinks = 0; sh.planDouses = 0;
    const stumps = new Map(stumpState(world).map(s => [s.id, s] as const)), groups = new Set<number>([...stumps.values()].map(s => s.group));
    for (const e of world.enemies) if (e.kind === ROOTLING) groups.add(rootGroup(e));
    for (const c of plan.crumble ?? []) {
      const pattern = this.patternOf(c.group, groups);
      for (const id of c.stumps) {
        const s = stumps.get(id);
        if (!s) continue;
        const at = leafAt(s.x * unit, s.y * unit, R);
        drawLeaf(g, at.x, at.y, at.s, this.ink(s.color), pattern, true);
        sh.planCrumbleStumps++;
      }
      for (const id of c.links) {
        const e = world.enemies.find(x => x.id === id);
        if (!e) continue;
        const at = leafAt(e.x * unit, e.y * unit, R);
        drawLeaf(g, at.x, at.y, at.s, this.ink(e.color), pattern, true);
        sh.planCrumbleLinks++;
      }
    }
    for (const lp of plan.links) {
      if (!lp.outcome?.douse || lp.link.kind !== 'enemy') continue;
      const e = world.enemies.find(x => x.id === lp.link.id);
      if (!e) continue;
      drawSmoke(g, e.x * unit, e.y * unit - R * 0.9, R * 0.5, clock, e.id, 0.85, 3);
      sh.planDouses++;
    }
  }

  /** One world event: the stumps', the slimes' and the firebrands' bursts (everything else is not ours). Returns true when it was ours. */
  onEvent(ev: WorldEvent, world: World, unit: number): boolean {
    if (ev.type === 'stump') {
      if (ev.action === 'crumble') {
        this.shown.crumbled += ev.ids.length;
        for (const id of ev.ids) { const p = this.stumpsAt.get(id) ?? ev; this.burst('crumble', p.x, p.y, unit); }
      } else if (ev.action === 'burn') { this.shown.burns++; this.burst('burn', ev.x, ev.y, unit); }
      else if (ev.action === 'lie') { this.shown.lies++; this.burst('lie', ev.x, ev.y, unit); }
      else { this.shown.rises++; this.burst('rise', ev.x, ev.y, unit); }
      return true;
    }
    if (ev.type === 'slime') {
      this.shown.merges++;
      const e = world.enemies.find(x => x.id === ev.id);
      this.burst('merge', ev.x, ev.y, unit, e ? this.ink(e.color) : SLIME_PALE);
      return true;
    }
    if (ev.type === 'firebrand') {
      if (ev.action === 'lit') { this.shown.lits++; this.shown.dropped += ev.dropped?.length ?? 0; this.burst('lit', ev.x, ev.y, unit); }
      else { this.shown.outs++; this.burst(ev.why === 'cold' ? 'cold' : ev.why === 'water' ? 'water' : 'out', ev.x, ev.y, unit); }
      return true;
    }
    return false;
  }

  private burst(kind: Burst, x: number, y: number, unit: number, ink = SLIME_PALE): void {
    const b = burstOf(kind, unit, ink);
    b.g.position.set(x * unit, y * unit);
    this.layer.addChild(b.g);
    this.bursts.push({ g: b.g, life: b.life, total: b.life, fall: b.fall });
  }

  /** Real seconds pass: the bursts grow, fall (splinters, ash) and fade. */
  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) { b.g.destroy(); this.bursts.splice(i, 1); continue; }
      const k = b.life / b.total;
      b.g.alpha = Math.min(1, k * 1.6);
      b.g.scale.set(0.7 + (1 - k) * 0.6);
      if (b.fall) b.g.pivot.set(0, -(1 - k) * (1 - k) * 18);
    }
  }
}
