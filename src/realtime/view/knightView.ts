/**
 * Task 43, part ui (design 16.10.2026, docs/design-notes/task-43-garrison-step2.md, 5): the view of the knight «Рыцарь».
 * Everything is read from the sim (`knightState`, `knightLane`, `knightSwing`, `eliteArmorView`, the events `knightShed` and
 * `knightMove`); nothing here changes the world:
 * - the plate pips over a knight in armour (the elite's plate pips; the knight is not an elite, so no rim and no plaque);
 * - «Размах» — a hatched circle of the sim's radius round the knight, an arc filling clockwise with the windup (`drawSwing`,
 *   on the ground layer under the bodies);
 * - the shed: the plates fall apart (three shards drop and fade) and a red ring flares (`drawFx`, over the bodies); the swing's
 *   hit is a short flash of the circle's size;
 * - «Рывок» — the lane is the boar's strip, drawn by render.ts `drawLanes` (`threatStrip`); this file only counts it.
 * Coordinates are arena pixels; `px` is `1 / scale`. The stand-in silhouette of the art is `garrisonView.ts` `knightMarks`.
 */
import type { Graphics } from 'pixi.js';
import { eliteArmorView } from '../sim/elites';
import { KNIGHT, knightSwing } from '../sim/enemies/garrison';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { drawPlatePips } from './eliteView';

const NAVY = 0x18232d;
const STEEL = 0xa9b8c6;
const RED = 0xd8402e;
const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
/** How long the shed's shards and ring last, and the swing's hit flash (real seconds). */
export const SHED_LIFE = 0.7;
export const SWING_FLASH_LIFE = 0.3;
/** The shards of the fallen plates: start (body radii from the centre), the sideways drift, the turn (rad). */
const SHARDS = [
  { x: -0.55, y: -0.5, vx: -0.9, rot: -2.4, s: 0.5 },
  { x: 0.5, y: -0.6, vx: 0.8, rot: 2.8, s: 0.45 },
  { x: 0.05, y: 0.1, vx: 0.15, rot: 1.6, s: 0.55 },
] as const;

interface Fx { kind: 'shed' | 'swing'; x: number; y: number; r: number; born: number; life: number }

export class KnightView {
  /** What the last frame drew and what the events brought (the test's snapshot). */
  readonly shown = { pips: 0, filled: 0, lanes: 0, swings: 0, sheds: 0, hits: 0 };
  private fx: Fx[] = [];
  /** `unit` — arena pixels per unit (render.ts `UNIT`). */
  constructor(private readonly unit: number) {}

  /** The sim's events of the frame: the shed and the swing's hit start their effects (`clock` — real seconds, `r` — the body's radius, px). */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number, swingRadius: number): void {
    if (ev.type === 'knightShed') {
      this.fx.push({ kind: 'shed', x: ev.x * this.unit, y: ev.y * this.unit, r, born: clock, life: SHED_LIFE });
      this.shown.sheds++;
    } else if (ev.type === 'knightMove' && ev.move === 'swing' && ev.stage === 'hit') {
      const e = world.enemies.find(x => x.id === ev.id);
      if (e) { this.fx.push({ kind: 'swing', x: e.x * this.unit, y: e.y * this.unit, r: swingRadius * this.unit, born: clock, life: SWING_FLASH_LIFE }); this.shown.hits++; }
    }
  }

  /** The counters of the frame start from zero (`sheds` and `hits` count events and stay). */
  beginFrame(): void { this.shown.pips = 0; this.shown.filled = 0; this.shown.lanes = 0; this.shown.swings = 0; }

  /** «Размах»: the hatched circle round each winding-up knight, filling clockwise with the windup — the threat look of the sapper's blast. */
  drawSwing(g: Graphics, world: World, sees: (e: Enemy) => boolean): void {
    for (const e of world.enemies) {
      const sw = e.kind === KNIGHT ? knightSwing(world, e) : null;
      if (!sw || !sees(e)) continue;
      this.shown.swings++;
      const x = sw.x * this.unit, y = sw.y * this.unit, R = sw.r * this.unit, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * sw.progress;
      g.circle(x, y, R).fill({ color: THREAT, alpha: 0.1 });
      if (sw.progress > 0.005) g.moveTo(x, y).lineTo(x, y - R).arc(x, y, R, a0, a1).closePath().fill({ color: THREAT, alpha: 0.2 });
      const k = Math.SQRT1_2, step = 0.32 * this.unit;
      for (let s = -R + step / 2; s < R; s += step) {
        const h = Math.sqrt(Math.max(0, R * R - s * s)), cx = x + k * s, cy = y + k * s;
        g.moveTo(cx - k * h, cy + k * h).lineTo(cx + k * h, cy - k * h);
      }
      g.stroke({ color: THREAT, width: 2.5, alpha: 0.5 });
      g.circle(x, y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(x, y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
      if (sw.progress > 0.005) {
        g.moveTo(x, y - R).arc(x, y, R, a0, a1).stroke({ color: THREAT_OUTLINE, width: 10, alpha: 0.85, cap: 'round' });
        g.moveTo(x, y - R).arc(x, y, R, a0, a1).stroke({ color: THREAT, width: 5, alpha: 1, cap: 'round' });
      }
    }
  }

  /**
   * Over the bodies: the plate pips of each knight in armour (above its drawing: its box is `art` body radii of `r` px; no art — the
   * stand-in's height), and the running effects. A knight that sheds its armour has no pips (`eliteArmorView` — null).
   */
  drawOver(g: Graphics, world: World, clock: number, px: number, r: number, art: number, sees: (e: Enemy) => boolean): void {
    for (const e of world.enemies) {
      if (e.kind !== KNIGHT || !sees(e)) continue;
      const a = eliteArmorView(e);
      if (!a) continue;
      const d = drawPlatePips(g, e.x * this.unit, e.y * this.unit, r * Math.max(1.4, art - 1), a, 0, px);
      this.shown.pips += d.pips; this.shown.filled += d.filled;
    }
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) {
      const k = Math.max(0, Math.min(1, (clock - f.born) / f.life));
      if (f.kind === 'swing') {
        g.circle(f.x, f.y, f.r).fill({ color: RED, alpha: 0.28 * (1 - k) }).stroke({ color: THREAT, width: 5 * (1 - k) + 1, alpha: 1 - k });
        continue;
      }
      // The red glint: a flash on the body and a ring that grows past it.
      g.circle(f.x, f.y, f.r * 1.1).fill({ color: RED, alpha: 0.45 * (1 - k) * (1 - k) });
      g.circle(f.x, f.y, f.r * (0.9 + 1.6 * k)).stroke({ color: THREAT_OUTLINE, width: 8 * px * (1 - k) + 2, alpha: 0.7 * (1 - k) });
      g.circle(f.x, f.y, f.r * (0.9 + 1.6 * k)).stroke({ color: RED, width: 5 * px * (1 - k) + 1.5, alpha: 1 - k * k });
      // The plates fall apart: three steel shards drop (gravity), drift sideways, turn and fade.
      for (const s of SHARDS) {
        const sx = f.x + (s.x + s.vx * k) * f.r * 1.4, sy = f.y + (s.y + k * k * 3.2) * f.r, w = f.r * s.s, h = w * 0.7, ang = s.rot * k, c = Math.cos(ang), n = Math.sin(ang);
        const pt = (u: number, v: number): [number, number] => [sx + u * c - v * n, sy + u * n + v * c];
        g.poly([...pt(-w, -h), ...pt(w * 0.8, -h * 0.8), ...pt(w, h), ...pt(-w * 0.6, h)]).fill({ color: STEEL, alpha: 1 - k * k }).stroke({ color: NAVY, width: 2.5, alpha: 1 - k * k, join: 'round' });
      }
    }
  }
}
