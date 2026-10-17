/**
 * Task 55а «Замок, шаг 1а», part ui (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 11): the view of the castle's
 * things and its shove. Everything is read from the sim (`world.shoves`, `durabilityOf`, `wardrobeTopple`, `wardrobeLying`, `rookLine`
 * and the events `shove`, `thing`, `wardrobe`, `rook`); nothing here changes the world, and no rule is counted here:
 * - the stand-in drawings over the disc (the art comes later, `character-art`): the barrel (oak, copper hoops), the wardrobe (a
 *   crooked tall cabinet with a toothy maw between its doors), the rook (a stone tower over its colour's disc);
 * - a thing's durability — one or two grey notches at its feet (not the elite's gold plate pips);
 * - «Падение шкафа» — the boar's strip from the wardrobe's edge along the fixed lane, filling with the windup; the wardrobe leans
 *   towards the lane while it winds up, lies flat on it after the hit and stands up (`poseWardrobe`);
 * - «Удар ладьи» — the bolt's dashed line along the fixed axis both ways, filling with the windup; a flash along it at the strike;
 * - a running shove — the streak behind the sliding thing and the path ahead of it to the fixed stop; the events add the crush's red
 *   slash, the impact's flash (and a kick of the camera), the stop's dust, the break's splinters, the fall, the cancel's puff;
 * - the castle's parquet and its walls drawn to their true size (the hangers are thinner than a wall tile).
 * Coordinates are arena pixels; `px` is `1 / scale`. The rules of the shove and of the two moves: sim/shove.ts, sim/enemies/castle.ts.
 */
import type { Graphics, GraphicsContext } from 'pixi.js';
import { BARREL, ROOK, ROOK_HALF, TOPPLE_LENGTH, WARDROBE, rookLine, wardrobeLying, wardrobeTopple } from '../sim/enemies/castle';
import { durabilityOf } from '../sim/shove';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { drawBoltLine } from './courtView';
import type { SignTools } from './trollView';

const NAVY = 0x18232d;
const WHITE = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const RED = 0xd8402e;
/** Oak, dark cabinet wood, copper hoops, brass, stone. */
const OAK = 0x8a5a2e, OAK_DARK = 0x5f3d1f, WOOD = 0x5b4130, WOOD_LIGHT = 0x7a5a3f, COPPER = 0xb8733a, BRASS = 0xd9b44a, STONE = 0xb9b2a2, STONE_DARK = 0x8c8576;
/** The grey of a thing's notches and dust. */
const NOTCH = 0xcfd3d8, DUST = 0xb7b2a6;
/** Lives of the effects (real seconds). */
export const TRAIL_LIFE = 0.6, CRUSH_LIFE = 0.35, IMPACT_LIFE = 0.3, DUST_LIFE = 0.5, DEBRIS_LIFE = 0.5, FALL_LIFE = 0.5, CANCEL_LIFE = 0.3, TOPPLE_FLASH_LIFE = 0.3, ROOK_FLASH_LIFE = 0.25;
/** The camera's kick at a shove's impact and a wardrobe's fall (px; the juice level scales it). */
export const IMPACT_KICK = 7, TOPPLE_KICK = 5;
/** How fast the wardrobe leans and lies down (rad/s) and the angle it lies at. */
const TURN_SPEED = 7, LYING = 1.5, LEAN = 0.42;

type FxKind = 'trail' | 'crush' | 'impact' | 'dust' | 'debris' | 'fall' | 'cancel' | 'topple' | 'rook';
interface Fx {
  kind: FxKind; x: number; y: number; born: number; life: number; r: number;
  x1?: number; y1?: number; from?: string; half?: number;
}
/** The shape a wardrobe's pose leaves: lean angle, flattening, and the side it falls to. */
interface Pose { ang: number; sy: number; side: number }
/** The part of a PixiJS container `poseWardrobe` moves (a Node test passes a stub). */
export interface Posable { rotation: number; pivot: { set(x: number, y: number): void }; position: { set(x: number, y: number): void }; scale: { set(x: number, y: number): void } }

export const isThingKind = (kind: string): boolean => kind === BARREL || kind === WARDROBE;

export class CastleView {
  /** What the last frame drew and what the events brought (the test's snapshot). */
  readonly shown = {
    notches: 0, topples: 0, rookLines: 0, runs: 0, trails: 0,
    starts: 0, crushes: 0, impacts: 0, stops: 0, breaks: 0, falls: 0, cancels: 0, windups: 0, hits: 0, rises: 0, aims: 0, shots: 0, kicks: 0,
  };
  private fx: Fx[] = [];
  /** The kind of each thing seen (a broken thing is gone from the world when its event comes). */
  private readonly kinds = new Map<number, string>();
  /** The last topple lane of each wardrobe as drawn (the hit's flash reads it: the lane is cleared in the tick of the hit). */
  private readonly lanes = new Map<number, { from: { x: number; y: number }; to: { x: number; y: number }; half: number }>();
  private readonly poses = new Map<number, Pose>();
  /** `unit` — arena pixels per unit (render.ts `UNIT`). */
  constructor(private readonly unit: number) {}

  /**
   * The sim's events of the frame start their effects (`clock` — real seconds). Returns the camera's kick in px (0 — none): the
   * caller shakes the arena by it.
   */
  onEvent(ev: WorldEvent, clock: number, r: number): number {
    const u = this.unit;
    if (ev.type === 'shove') {
      const kind = this.kinds.get(ev.thingId);
      if (ev.action === 'start' && ev.x1 !== undefined && ev.y1 !== undefined) { this.fx.push({ kind: 'trail', x: ev.x * u, y: ev.y * u, x1: ev.x1 * u, y1: ev.y1 * u, born: clock, life: TRAIL_LIFE, r }); this.shown.starts++; }
      else if (ev.action === 'crush') { this.fx.push({ kind: 'crush', x: ev.x * u, y: ev.y * u, born: clock, life: CRUSH_LIFE, r }); this.shown.crushes++; }
      else if (ev.action === 'impact') { this.fx.push({ kind: 'impact', x: ev.x * u, y: ev.y * u, born: clock, life: IMPACT_LIFE, r }); this.shown.impacts++; this.shown.kicks++; return IMPACT_KICK; }
      else if (ev.action === 'stop') { this.fx.push({ kind: 'dust', x: ev.x * u, y: ev.y * u, born: clock, life: DUST_LIFE, r }); this.shown.stops++; }
      else if (ev.action === 'fall') { this.fx.push({ kind: 'fall', x: ev.x * u, y: ev.y * u, born: clock, life: FALL_LIFE, r, from: kind }); this.shown.falls++; }
      else if (ev.action === 'cancel') { this.fx.push({ kind: 'cancel', x: ev.x * u, y: ev.y * u, born: clock, life: CANCEL_LIFE, r }); this.shown.cancels++; }
    } else if (ev.type === 'thing') {
      this.fx.push({ kind: 'debris', x: ev.x * u, y: ev.y * u, born: clock, life: DEBRIS_LIFE, r, from: this.kinds.get(ev.id) ?? BARREL });
      this.shown.breaks++;
    } else if (ev.type === 'wardrobe') {
      if (ev.action === 'windup') this.shown.windups++;
      else if (ev.action === 'rise') { this.fx.push({ kind: 'dust', x: ev.x * u, y: ev.y * u, born: clock, life: DUST_LIFE * 0.7, r }); this.shown.rises++; }
      else {
        const lane = this.lanes.get(ev.id);
        if (lane) this.fx.push({ kind: 'topple', x: lane.from.x * u, y: lane.from.y * u, x1: lane.to.x * u, y1: lane.to.y * u, half: lane.half * u, born: clock, life: TOPPLE_FLASH_LIFE, r });
        this.fx.push({ kind: 'dust', x: ev.x * u, y: ev.y * u, born: clock, life: DUST_LIFE, r });
        this.shown.hits++; this.shown.kicks++;
        return TOPPLE_KICK;
      }
    } else if (ev.type === 'rook') {
      if (ev.action === 'aim') this.shown.aims++;
      else { this.fx.push({ kind: 'rook', x: ev.x0 * u, y: ev.y0 * u, x1: ev.x1 * u, y1: ev.y1 * u, born: clock, life: ROOK_FLASH_LIFE, r }); this.shown.shots++; }
    }
    return 0;
  }

  /** The counters of the frame start from zero (the event counts stay). */
  beginFrame(): void { this.shown.notches = 0; this.shown.topples = 0; this.shown.rookLines = 0; this.shown.runs = 0; this.shown.trails = 0; }

  /** The end of a frame: the kinds of the things (a broken thing's debris takes its colours from them), the lanes of the wardrobes. */
  note(world: World): void {
    const ids = new Set<number>();
    for (const e of world.enemies) {
      if (!isThingKind(e.kind)) continue;
      ids.add(e.id); this.kinds.set(e.id, e.kind);
    }
    for (const id of this.lanes.keys()) if (!ids.has(id)) this.lanes.delete(id);
    for (const id of this.poses.keys()) if (!ids.has(id)) this.poses.delete(id);
  }

  reset(): void { this.fx = []; this.kinds.clear(); this.lanes.clear(); this.poses.clear(); }

  /** The wardrobe's pose as last drawn (a test reads it): the lean angle (rad, + to the right) and the flattening (1 — upright). */
  poseOf(id: number): { ang: number; sy: number } | null { const p = this.poses.get(id); return p ? { ang: p.ang, sy: p.sy } : null; }

  /** The topple lane drawn for the wardrobe last frame (a test reads it), or null. */
  laneOf(id: number): { from: { x: number; y: number }; to: { x: number; y: number }; half: number } | null { return this.lanes.get(id) ?? null; }

  /**
   * Under the bodies (the lane layer): the wardrobe's strip, the rook's line, the running shoves. `sees(p)` — the camera sees the
   * point (px margin is the caller's).
   */
  drawLanes(g: Graphics, world: World, tools: SignTools, sees: (p: { x: number; y: number }) => boolean): void {
    const u = this.unit;
    for (const e of world.enemies) {
      if (e.kind === WARDROBE) {
        const lane = wardrobeTopple(world, e);
        if (!lane) { continue; }
        this.lanes.set(e.id, { from: lane.from, to: lane.to, half: lane.half });
        const len = Math.hypot(lane.to.x - lane.from.x, lane.to.y - lane.from.y);
        if (len < 1e-6 || !(sees(lane.from) || sees(lane.to) || sees(e))) continue;
        const ux = (lane.to.x - lane.from.x) / len, uy = (lane.to.y - lane.from.y) / len, w = lane.half * u;
        tools.strip(g, lane.from.x * u, lane.from.y * u, ux, uy, TOPPLE_LENGTH * u, w, lane.progress, 1);
        tools.head(g, lane.from.x * u, lane.from.y * u, ux, uy, TOPPLE_LENGTH * u, w, 1);
        this.shown.topples++;
      } else if (e.kind === ROOK) {
        const line = rookLine(world, e);
        if (!line || !(sees({ x: line.x0, y: line.y0 }) || sees({ x: line.x1, y: line.y1 }) || sees(e))) continue;
        drawBoltLine(g, line.x0 * u, line.y0 * u, line.x1 * u, line.y1 * u, line.half * u, line.progress);
        this.shown.rookLines++;
      }
    }
    // A running shove: the streak behind the thing, the path ahead of it to the fixed stop (the sim's plan, not recounted).
    for (const s of world.shoves ?? []) {
      const thing = world.enemies.find(e => e.id === s.thing);
      if (!thing) continue;
      const x = thing.x * u, y = thing.y * u, fx = s.from.x * u, fy = s.from.y * u, tx = s.to.x * u, ty = s.to.y * u;
      this.shown.runs++;
      const behind = Math.hypot(x - fx, y - fy);
      if (behind > 2) {
        const nx = -s.dir.y, ny = s.dir.x;
        for (const off of [-0.18, 0, 0.18]) {
          const a = Math.max(0, behind - 1.1 * u), side = off * u;
          g.moveTo(fx + (x - fx) * (a / behind) + nx * side, fy + (y - fy) * (a / behind) + ny * side).lineTo(x - s.dir.x * 0.25 * u + nx * side, y - s.dir.y * 0.25 * u + ny * side);
        }
        g.stroke({ color: NOTCH, width: 3, alpha: 0.55, cap: 'round' });
      }
      const ahead = Math.hypot(tx - x, ty - y);
      if (ahead > 4) {
        const ux = (tx - x) / ahead, uy = (ty - y) / ahead;
        for (let t = 0; t < ahead; t += 22) { const e = Math.min(ahead, t + 11); g.moveTo(x + ux * t, y + uy * t).lineTo(x + ux * e, y + uy * e); }
        g.stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.5, cap: 'round' });
        for (let t = 0; t < ahead; t += 22) { const e = Math.min(ahead, t + 11); g.moveTo(x + ux * t, y + uy * t).lineTo(x + ux * e, y + uy * e); }
        g.stroke({ color: WHITE, width: 2.2, alpha: 0.7, cap: 'round' });
        g.circle(tx, ty, 7).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.6 }).circle(tx, ty, 7).stroke({ color: WHITE, width: 2, alpha: 0.9 });
      }
      this.shown.trails++;
    }
  }

  /**
   * Over the bodies: the notches of each thing's durability at its feet and the running effects. `r` — the body's drawn radius (px).
   */
  drawOver(g: Graphics, world: World, clock: number, px: number, r: number, sees: (e: Enemy) => boolean): void {
    const u = this.unit;
    for (const e of world.enemies) {
      if (!isThingKind(e.kind) || !sees(e)) continue;
      const n = Math.max(0, Math.min(4, durabilityOf(e)));
      if (n <= 0) continue;
      const w = Math.max(8, r * 0.3), gap = w * 0.45, total = n * w + (n - 1) * gap, y = e.y * u + r * 1.12;
      for (let i = 0; i < n; i++) {
        const x = e.x * u - total / 2 + i * (w + gap);
        g.roundRect(x, y, w, w * 0.7, 2).fill(NOTCH).stroke({ color: NAVY, width: 1.6 * Math.max(1, px) });
      }
      this.shown.notches += n;
    }
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) this.drawFx(g, f, Math.max(0, Math.min(1, (clock - f.born) / f.life)), px);
  }

  private drawFx(g: Graphics, f: Fx, k: number, px: number): void {
    const R = f.r, a = 1 - k;
    switch (f.kind) {
      case 'trail': {
        if (f.x1 === undefined || f.y1 === undefined) return;
        const len = Math.hypot(f.x1 - f.x, f.y1 - f.y);
        if (len < 2) return;
        const ux = (f.x1 - f.x) / len, uy = (f.y1 - f.y) / len;
        for (let t = 0; t < len; t += 16) { const e = Math.min(len, t + 8); g.moveTo(f.x + ux * t, f.y + uy * t).lineTo(f.x + ux * e, f.y + uy * e); }
        g.stroke({ color: NOTCH, width: 4, alpha: 0.45 * a, cap: 'round' });
        return;
      }
      case 'crush': {
        const s = R * (0.45 + 0.35 * k);
        g.circle(f.x, f.y, R * (0.5 + 0.9 * k)).fill({ color: RED, alpha: 0.28 * a });
        g.moveTo(f.x - s, f.y - s).lineTo(f.x + s, f.y + s).moveTo(f.x + s, f.y - s).lineTo(f.x - s, f.y + s).stroke({ color: THREAT_OUTLINE, width: 9 * a + 2, alpha: a, cap: 'round' });
        g.moveTo(f.x - s, f.y - s).lineTo(f.x + s, f.y + s).moveTo(f.x + s, f.y - s).lineTo(f.x - s, f.y + s).stroke({ color: RED, width: 5 * a + 1.5, alpha: a, cap: 'round' });
        return;
      }
      case 'impact': {
        g.circle(f.x, f.y, R * 1.1).fill({ color: WHITE, alpha: 0.5 * a * a });
        g.circle(f.x, f.y, R * (0.9 + 1.5 * k)).stroke({ color: THREAT_OUTLINE, width: 8 * px * a + 2, alpha: 0.7 * a });
        g.circle(f.x, f.y, R * (0.9 + 1.5 * k)).stroke({ color: WHITE, width: 5 * px * a + 1.5, alpha: a });
        return;
      }
      case 'dust': {
        for (let i = 0; i < 3; i++) {
          const ang = -Math.PI / 2 + (i - 1) * 0.9, d = R * (0.4 + 0.9 * k);
          g.circle(f.x + Math.cos(ang) * d, f.y + R * 0.5 + Math.sin(ang) * d * 0.6, R * (0.28 + 0.3 * k)).fill({ color: DUST, alpha: 0.55 * a });
        }
        return;
      }
      case 'debris': {
        const wood = f.from === WARDROBE ? WOOD : OAK;
        for (let i = 0; i < 6; i++) {
          const ang = i * 1.05 + 0.4, d = R * (0.3 + 1.5 * k), x = f.x + Math.cos(ang) * d, y = f.y + Math.sin(ang) * d * 0.8 + k * k * R * 0.9, rot = ang + k * 4, c = Math.cos(rot), n = Math.sin(rot), w = R * 0.36, h = R * 0.12;
          g.poly([x - w * c + h * n, y - w * n - h * c, x + w * c + h * n, y + w * n - h * c, x + w * c - h * n, y + w * n + h * c, x - w * c - h * n, y - w * n + h * c]).fill({ color: i % 3 === 0 ? COPPER : wood, alpha: a }).stroke({ color: NAVY, width: 1.6, alpha: a });
        }
        return;
      }
      case 'fall': {
        const s = 1 - k;
        g.circle(f.x, f.y + R * 0.4 * k, R * 0.9 * s).fill({ color: 0x2a2f33, alpha: 0.9 * a }).stroke({ color: NAVY, width: 2.5 * s + 0.5, alpha: a });
        return;
      }
      case 'cancel': {
        const s = R * 0.4;
        g.circle(f.x, f.y, R * (0.7 + 0.5 * k)).stroke({ color: NOTCH, width: 3, alpha: 0.8 * a });
        g.moveTo(f.x - s, f.y - s).lineTo(f.x + s, f.y + s).moveTo(f.x + s, f.y - s).lineTo(f.x - s, f.y + s).stroke({ color: NOTCH, width: 3.5, alpha: a, cap: 'round' });
        return;
      }
      case 'topple': {
        if (f.x1 === undefined || f.y1 === undefined || f.half === undefined) return;
        const len = Math.hypot(f.x1 - f.x, f.y1 - f.y);
        if (len < 1) return;
        const ux = (f.x1 - f.x) / len, uy = (f.y1 - f.y) / len, nx = -uy * f.half, ny = ux * f.half;
        g.poly([f.x + nx, f.y + ny, f.x1 + nx, f.y1 + ny, f.x1 - nx, f.y1 - ny, f.x - nx, f.y - ny]).fill({ color: WHITE, alpha: 0.45 * a * a }).stroke({ color: WHITE, width: 4 * a + 1, alpha: 0.9 * a });
        return;
      }
      case 'rook': {
        if (f.x1 === undefined || f.y1 === undefined) return;
        const half = ROOK_HALF * this.unit;
        g.moveTo(f.x, f.y).lineTo(f.x1, f.y1).stroke({ color: THREAT_OUTLINE, width: half * 2 * a + 4, alpha: 0.6 * a, cap: 'round' });
        g.moveTo(f.x, f.y).lineTo(f.x1, f.y1).stroke({ color: WHITE, width: half * 1.2 * a + 2, alpha: a, cap: 'round' });
      }
    }
  }

  /**
   * The wardrobe's pose (the body container of its view, `foot` — the y of its feet in the body's own pixels): it leans towards the
   * lane while it winds up (more as the windup runs out, a tremble at the end), lies flat on the lane after the hit, stands up. A
   * lane that runs up or down the screen (the wardrobe falls towards or away from the viewer) flattens it instead of turning it.
   */
  poseWardrobe(world: World, e: Enemy, body: Posable, foot: number, dt: number): void {
    const top = wardrobeTopple(world, e), lying = wardrobeLying(e) > 0;
    const pose = this.poses.get(e.id) ?? { ang: 0, sy: 1, side: 1 };
    this.poses.set(e.id, pose);
    let target = 0, flat = 1;
    if (top) {
      const dx = top.to.x - top.from.x, dy = top.to.y - top.from.y, len = Math.hypot(dx, dy) || 1;
      pose.side = Math.abs(dx / len) < 0.3 ? 0 : dx > 0 ? 1 : -1;
      const lean = top.progress * top.progress * LEAN, shake = top.progress > 0.7 ? Math.sin(top.progress * 90) * 0.03 : 0;
      if (pose.side !== 0) target = pose.side * lean + shake; else flat = 1 - lean * 0.6;
    } else if (lying) {
      if (pose.side !== 0) target = pose.side * LYING; else flat = 0.42;
    }
    const step = Math.max(0, dt) * TURN_SPEED;
    pose.ang += Math.max(-step, Math.min(step, target - pose.ang));
    pose.sy += Math.max(-step, Math.min(step, flat - pose.sy));
    body.pivot.set(0, foot); body.position.set(0, foot); body.rotation = pose.ang; body.scale.set(1, pose.sy);
  }
}

// ---- Stand-in drawings (until the art comes: `character-art`, castle-wardrobe / castle-rook / castle-barrel) ----

/** The barrel: an oak cask with two copper hoops and a lid, a wine stain on its belly (no face). `r` — the disc's radius. */
export function barrelMarks(ctx: GraphicsContext, r: number): void {
  const w = r * 0.82, top = -r * 0.92, bot = r * 0.86;
  ctx.moveTo(-w * 0.82, top).quadraticCurveTo(-w * 1.18, 0, -w * 0.82, bot).lineTo(w * 0.82, bot).quadraticCurveTo(w * 1.18, 0, w * 0.82, top).closePath().fill(OAK).stroke({ color: NAVY, width: 3, join: 'round' });
  for (const sx of [-0.42, 0, 0.42]) ctx.moveTo(sx * w, top + 3).quadraticCurveTo(sx * w * 1.18, 0, sx * w, bot - 2).stroke({ color: OAK_DARK, width: 1.8, alpha: 0.8 });
  for (const hy of [-0.52, 0.5]) {
    const y = r * hy, bulge = 1.1;
    ctx.moveTo(-w * bulge * 0.98, y).lineTo(w * bulge * 0.98, y).stroke({ color: NAVY, width: 7.5, cap: 'butt' });
    ctx.moveTo(-w * bulge * 0.98, y).lineTo(w * bulge * 0.98, y).stroke({ color: COPPER, width: 4.5, cap: 'butt' });
  }
  ctx.ellipse(0, top, w * 0.82, r * 0.2).fill(0xa97b4c).stroke({ color: NAVY, width: 2.5 });
  ctx.ellipse(w * 0.18, r * 0.1, r * 0.2, r * 0.13).fill({ color: 0x7a1f35, alpha: 0.55 });
}

/** The wardrobe: a tall crooked cabinet, a cornice, two doors with brass knobs and a toothy maw across them, short paws. */
export function wardrobeMarks(ctx: GraphicsContext, r: number): void {
  const w = r * 0.95, top = -r * 1.55, bot = r * 0.8;
  ctx.roundRect(-w, top, w * 2, bot - top, 4).fill(WOOD).stroke({ color: NAVY, width: 3, join: 'round' });
  ctx.poly([-w * 1.12, top - r * 0.16, w * 1.12, top - r * 0.16, w * 1.0, top + r * 0.12, -w * 1.0, top + r * 0.12]).fill(WOOD_LIGHT).stroke({ color: NAVY, width: 2.5, join: 'round' });
  ctx.moveTo(0, top + r * 0.12).lineTo(0, bot).stroke({ color: NAVY, width: 3 });
  ctx.roundRect(-w + 5, top + r * 0.3, w - 8, bot - top - r * 0.45, 3).stroke({ color: 0x3c2a1d, width: 2 });
  ctx.roundRect(3, top + r * 0.3, w - 8, bot - top - r * 0.45, 3).stroke({ color: 0x3c2a1d, width: 2 });
  // The maw: a dark band across the doors with crooked teeth top and bottom.
  const my = -r * 0.1, mh = r * 0.5;
  ctx.roundRect(-w + 3, my - mh / 2, w * 2 - 6, mh, 3).fill(0x1d1410);
  for (let i = 0; i < 5; i++) {
    const x = -w + 8 + i * ((w * 2 - 16) / 4), h = r * (0.18 + (i % 2) * 0.1);
    ctx.poly([x - 4, my - mh / 2, x + 4, my - mh / 2, x + 1 - (i % 2) * 2, my - mh / 2 + h]).fill(0xe8e0c8).stroke({ color: NAVY, width: 1.2 });
    ctx.poly([x - 3 + 4, my + mh / 2, x + 5 + 4, my + mh / 2, x + 3, my + mh / 2 - h * 0.8]).fill(0xe8e0c8).stroke({ color: NAVY, width: 1.2 });
  }
  for (const sx of [-1, 1]) ctx.circle(sx * w * 0.2, -r * 0.82, r * 0.1).fill(BRASS).stroke({ color: NAVY, width: 1.8 });
  for (const sx of [-1, 1]) ctx.poly([sx * w * 0.9, bot, sx * w * 0.5, bot, sx * w * 0.55, bot + r * 0.22, sx * w * 0.95, bot + r * 0.22]).fill(OAK_DARK).stroke({ color: NAVY, width: 2 });
}

/** The rook: a squat stone tower over the colour's disc — battlements for brows, a grumpy slit mouth. */
export function rookMarks(ctx: GraphicsContext, r: number): void {
  const w = r * 0.62, top = -r * 0.42, bot = r * 0.74;
  ctx.poly([-w, bot, -w * 0.84, top, w * 0.84, top, w, bot]).fill(STONE).stroke({ color: NAVY, width: 3, join: 'round' });
  for (const sx of [-0.84, -0.28, 0.28]) ctx.roundRect(sx * w, top - r * 0.3, w * 0.56, r * 0.32, 1.5).fill(STONE_DARK).stroke({ color: NAVY, width: 2.2 });
  ctx.roundRect(-w * 0.95, top - 2, w * 1.9, r * 0.12, 2).fill(STONE_DARK).stroke({ color: NAVY, width: 2 });
  for (let i = 0; i < 2; i++) ctx.moveTo(-w * 0.7, top + r * (0.5 + i * 0.4)).lineTo(w * 0.7, top + r * (0.5 + i * 0.4)).stroke({ color: STONE_DARK, width: 1.4, alpha: 0.7 });
  for (const sx of [-1, 1]) {
    ctx.circle(sx * w * 0.36, top + r * 0.3, r * 0.09).fill(NAVY);
    ctx.moveTo(sx * w * 0.62, top + r * 0.14).lineTo(sx * w * 0.14, top + r * 0.24).stroke({ color: NAVY, width: 3, cap: 'round' });
  }
  ctx.roundRect(-w * 0.34, top + r * 0.62, w * 0.68, r * 0.17, 3).fill(0x2a2420).stroke({ color: NAVY, width: 1.6 });
}

// ---- The castle's floor and walls ----

/** Parquet: planks laid in a basket weave (two across, two along) in a warm brown, each a little lighter or darker by a hash of its place. */
export function drawParquet(f: Graphics, cols: number, rows: number, unit: number): void {
  f.rect(0, 0, cols * unit, rows * unit).fill(0x2a2018);
  const half = unit / 2, tones = [0x3a2c20, 0x403023, 0x352819, 0x44342a];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const horizontal = (cx + cy) % 2 === 0;
    for (let i = 0; i < 2; i++) {
      const h = (Math.imul(cx * 2 + i + 13, 2654435761) ^ Math.imul(cy + 29, 40503)) >>> 0, tone = tones[h & 3];
      if (horizontal) f.rect(cx * unit + 1, cy * unit + i * half + 1, unit - 2, half - 2).fill(tone);
      else f.rect(cx * unit + i * half + 1, cy * unit + 1, half - 2, unit - 2).fill(tone);
    }
    if ((cx * 7 + cy * 3) % 5 === 0) f.circle(cx * unit + unit * 0.5, cy * unit + unit * 0.5, 2).fill({ color: 0x1c140e, alpha: 0.5 });
  }
}

/** A hanger or any thin wall of the castle drawn to its true size (units): dark wood with pegs along its top edge. */
export function drawHanger(t: Graphics, x: number, y: number, w: number, h: number, unit: number): void {
  const X = x * unit, Y = y * unit, W = w * unit, H = h * unit;
  t.ellipse(X + W / 2, Y + H + 3, W / 2 + 2, 5).fill({ color: 0x0b0e11, alpha: 0.5 });
  t.roundRect(X, Y, W, H, 4).fill(0x4a3828).stroke({ color: 0x1c1410, width: 2.5 });
  t.moveTo(X + 3, Y + 3).lineTo(X + W - 3, Y + 3).stroke({ color: 0x8a6a4a, width: 1.8, alpha: 0.7 });
  const pegs = Math.max(2, Math.round(w / 0.4));
  for (let i = 0; i < pegs; i++) { const px = X + (i + 0.5) * (W / pegs); t.circle(px, Y + H / 2, 4).fill(BRASS).stroke({ color: 0x1c1410, width: 1.5 }); }
}
