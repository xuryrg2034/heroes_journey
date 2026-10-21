/**
 * Task 59а «Гарнизон, шаг 3», part ui (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 8; contract —
 * docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3»): the view of the pitcher («Смолокур»), the recruits («Новобранцы») and the
 * wardens («Привратники»). Procedural (the art of the three is the design's, later). Everything is read from the sim's helpers
 * (`pitcherWindup`, `potsInFlight`, `pitchPools`, `recruitCurrent`, `wardenAnger`, `wardenSwing`, …), from the plan (`planChain`:
 * `fire.pitch`, `anger`, the `order` refusals) and from the events `pot` / `recruit` / `warden`; nothing here changes the world,
 * rolls a die or counts a rule.
 * - the pitcher: the pot over its head while it winds up (smoke, a rust glow, the windup's arc); the pot on its arc with a shadow
 *   that grows to the fall; the mark — the threat circle (white, hatched, outside the chain's palette) blinking every 0.12 s the
 *   whole flight; the splash at the fall; the pool — a dark glossy amber disc with bubbles, dimming as it dries; a lit pool — the
 *   hammer's fire; the drops at the feet of the hero and of the enemies in pitch, the hero's sticky trail;
 * - the recruits: a small plaque with the number over the head in the group's colour — the current one brighter and bigger, the
 *   others dim; a hit out of order — a block spark and the digit shivers; «+2 ⚡» when the whole line fell by one pass;
 * - the wardens: the partner's key on the belt (not a line: a line would read as a tether the chain cuts), the keys burn gold when
 *   both are in the chain, a flickering red ring on the one who will be angry; the anger — a red ring of the countdown at the feet,
 *   red eyes, «Размах» (the knight's circle).
 * - the chain's highlight: the pools the lit path touches have a fiery rim; the bodies the law of order refuses wear a grey ban.
 * Coordinates are arena pixels; `px` is `1 / scale`. View only: never a Param, never the hash.
 */
import type { Graphics } from 'pixi.js';
import type { ChainPlan } from '../sim/chain';
import { PITCHER, pitcherWindup } from '../sim/enemies/pitcher';
import { RECRUIT, recruitCurrent, recruitGroup, recruitNumber } from '../sim/enemies/recruit';
import { WARDEN, wardenAnger, wardenAngry, wardenPartner, wardenSwing } from '../sim/enemies/warden';
import type { Vec } from '../sim/geometry';
import { heroPitchFactor, inPitch, pitchMarkRadius, pitchPoolRadiusOf, pitchPools, potsInFlight } from '../sim/pitch';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { drawSwingCircle } from './knightView';
import type { SignTools } from './trollView';

const NAVY = 0x18232d;
const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const RED = 0xd8402e;
const GOLD = 0xffd36b;
/** The hammer's fire (render.ts `EMBER`, `FLAME`, `PLAYER_FX`): the lit pitch is the same fire. */
const EMBER = 0xff8a3a, FLAME = 0xffd36b, PLAYER_FX = 0xbfe3ff;
/** The pitch: a dark amber disc, its rim, its gloss; the pot's clay. */
const PITCH_DARK = 0x24150a, PITCH_RIM = 0xb5701c, PITCH_GLOSS = 0x6a4420, SMOKE = 0x9a958c;
const POT = 0x3b2a1c, POT_BAND = 0x1d140c, POT_GLOW = 0xc2762b;
const STEEL = 0xa9b8c6;
const BAN = 0xb9b4a8;

/** The mark blinks once in this many real seconds (spec 3.2: «вспышка раз в 0,12 с», as `GrenadeBullet` of Cult of the Lamb). */
export const MARK_BLINK = 0.12;
/** Real seconds: a pool dims over its last `DRY_FADE` game seconds; a lit pool over its last `BURN_FADE`. */
const DRY_FADE = 1.2, BURN_FADE = 0.5;
/** Real seconds the effects last. */
const SPLASH_LIFE = 0.45, FLASH_LIFE = 0.35, SPARK_LIFE = 0.3, RING_LIFE = 0.5, SHIVER_LIFE = 0.28, TRAIL_LIFE = 1.4;
/** The hero's trail in pitch: a new blot every this many arena units. */
const TRAIL_STEP = 0.14;

/** The shown counts of the last frame / since the fight began (tests read them through `window.__realtime`). */
export interface Garrison3Shown {
  /** Frame: pitchers winding up, pots in the air, marks drawn (and of them lit by the blink), pools drawn (and burning), pools with a fiery rim in the plan, the hero stands in pitch (0/1), drops at the feet. */
  windups: number; pots: number; marks: number; marksLit: number; pools: number; burning: number; poolFire: number; heroInPitch: number; drops: number; trail: number;
  /** Events seen since the fight began: throws, landings (and of them on the hero), splashes of pools, ignitions. */
  throws: number; lands: number; heroHits: number; pooled: number; ignites: number;
  /** Frame: the pools drawn (arena units; `burning` — lit) and the marks drawn (the pot's target), for the tests' real input. */
  poolAt: { id: number; x: number; y: number; burning: boolean }[]; markAt: { x: number; y: number }[];
  recruits: {
    /** Frame: plaques drawn, of them the current ones (bright), dim ones, the bans on bodies the law refuses in the plan. */
    numbers: number; current: number; dim: number; bans: number;
    /** The number of the current recruit of the nearest group drawn (0 — none). */
    currentNumber: number;
    /** Events seen: hits out of order, whole lines by one pass, links dropped from the drawn chain. */
    refused: number; drills: number; unlinks: number;
  };
  wardens: {
    /** Frame: belt keys drawn, keys burning gold (both in the chain), warn rings (anger will be), anger rings, «Размах» circles. */
    keys: number; gold: number; warn: number; anger: number; swings: number;
    /** Events seen: angers started and ended, swing hits. */
    starts: number; ends: number; hits: number;
  };
}

type FxKind = 'splash' | 'flash' | 'spark' | 'ring' | 'swing';
interface Fx { kind: FxKind; x: number; y: number; r: number; born: number; life: number; color?: number }

const emptyShown = (): Garrison3Shown => ({
  windups: 0, pots: 0, marks: 0, marksLit: 0, pools: 0, burning: 0, poolFire: 0, heroInPitch: 0, drops: 0, trail: 0,
  throws: 0, lands: 0, heroHits: 0, pooled: 0, ignites: 0, poolAt: [], markAt: [],
  recruits: { numbers: 0, current: 0, dim: 0, bans: 0, currentNumber: 0, refused: 0, drills: 0, unlinks: 0 },
  wardens: { keys: 0, gold: 0, warn: 0, anger: 0, swings: 0, starts: 0, ends: 0, hits: 0 },
});

/** The segments of a seven-segment digit (a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle). */
const DIGITS: Readonly<Record<number, string>> = { 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc' };

/** A digit 1…4 centred at (`x`, `y`), `h` px tall: a white stroke on a navy one. */
function drawDigit(g: Graphics, n: number, x: number, y: number, h: number): void {
  const segs = DIGITS[n];
  if (!segs) return;
  const w = h * 0.55, x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, ym = y;
  const line: Record<string, [number, number, number, number]> = {
    a: [x0, y0, x1, y0], b: [x1, y0, x1, ym], c: [x1, ym, x1, y1], d: [x0, y1, x1, y1], e: [x0, ym, x0, y1], f: [x0, y0, x0, ym], g: [x0, ym, x1, ym],
  };
  for (const [width, color] of [[h * 0.3, NAVY], [h * 0.15, 0xffffff]] as const) {
    for (const s of segs) { const [ax, ay, bx, by] = line[s]; g.moveTo(ax, ay).lineTo(bx, by); }
    g.stroke({ color, width, cap: 'round', join: 'round' });
  }
}

/**
 * A key `size` px long hung at (`x`, `y`) (its bow up): a navy outline under the shaft and the bow, the bow in `ink`, the teeth
 * on the shaft. `glow` — a soft halo behind it (the keys burning gold).
 */
export function drawKey(g: Graphics, x: number, y: number, size: number, ink: number, glow = false): void {
  const bow = size * 0.3, top = y - size / 2 + bow, bottom = y + size / 2, tilt = -0.35, c = Math.cos(tilt), s = Math.sin(tilt);
  const pt = (u: number, v: number): [number, number] => [x + u * c - (v - y) * s, y + u * s + (v - y) * c];
  if (glow) g.circle(x, y, size * 0.85).fill({ color: GOLD, alpha: 0.28 });
  const [bx, by] = pt(0, top), [tx, ty] = pt(0, bottom), [ax, ay] = pt(-size * 0.22, bottom), [cx, cy] = pt(0, bottom - size * 0.2), [dx, dy] = pt(-size * 0.22, bottom - size * 0.2);
  for (const [w, shaft] of [[size * 0.3, NAVY], [size * 0.14, STEEL]] as const) {
    g.moveTo(bx, by).lineTo(tx, ty).moveTo(tx, ty).lineTo(ax, ay).moveTo(cx, cy).lineTo(dx, dy);
    g.stroke({ color: shaft, width: w, cap: 'round' });
  }
  g.circle(bx, by - bow * 0.2, bow).stroke({ color: NAVY, width: size * 0.3 });
  g.circle(bx, by - bow * 0.2, bow).stroke({ color: ink, width: size * 0.15 });
}

/** The belt key of warden `e` (body radius `r` px): where it hangs. */
export const keyAt = (e: Enemy, unit: number, r: number): Vec => ({ x: e.x * unit + r * 0.62, y: e.y * unit + r * 0.55 });

export class Garrison3View {
  readonly shown: Garrison3Shown = emptyShown();
  private fx: Fx[] = [];
  /** Recruit id → when its plaque began to shiver (out of order). */
  private shivers = new Map<number, number>();
  /** The recruits' last drawn points by id (an end-of-line flash stands where the last one fell). */
  private recruitAt = new Map<number, { x: number; y: number; group: number; n: number }>();
  /** The hero's sticky trail in pitch (arena units; `born` — real seconds). */
  private trail: { x: number; y: number; born: number }[] = [];
  /** Wardens' «Размах» radius as last drawn (a hit flashes the circle where it stood). */
  private swingR = new Map<number, number>();

  /** `unit` — arena pixels per unit; `float` — a rising word over a point (render.ts `floatText`). */
  constructor(private readonly unit: number, private readonly float: (text: string, x: number, y: number, color: number) => void) {}

  /** The frame's counters start from zero (event counts stay). */
  beginFrame(): void {
    const s = this.shown;
    s.windups = 0; s.pots = 0; s.marks = 0; s.marksLit = 0; s.pools = 0; s.burning = 0; s.poolFire = 0; s.heroInPitch = 0; s.drops = 0; s.trail = 0; s.poolAt = []; s.markAt = [];
    Object.assign(s.recruits, { numbers: 0, current: 0, dim: 0, bans: 0, currentNumber: 0 });
    Object.assign(s.wardens, { keys: 0, gold: 0, warn: 0, anger: 0, swings: 0 });
  }

  /** A new fight: forget what was seen. */
  reset(): void {
    this.fx = []; this.shivers.clear(); this.recruitAt.clear(); this.trail = []; this.swingR.clear();
    Object.assign(this.shown, emptyShown());
  }

  /** The sim's events of the frame; true — the event is the three kinds' and is taken (`clock` — real seconds, `r` — the body's radius, px). */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number): boolean {
    const u = this.unit, s = this.shown;
    if (ev.type === 'pot') {
      if (ev.action === 'throw') s.throws++;
      else if (ev.action === 'land') {
        s.lands++;
        if (ev.hit) s.heroHits++;
        this.fx.push({ kind: 'splash', x: ev.x * u, y: ev.y * u, r: pitchMarkRadius(world) * u, born: clock, life: SPLASH_LIFE });
      } else if (ev.action === 'pool') s.pooled++;
      else if (ev.action === 'ignite') {
        s.ignites++;
        this.fx.push({ kind: 'flash', x: ev.x * u, y: ev.y * u, r: pitchPoolRadiusOf(world) * u, born: clock, life: FLASH_LIFE });
      }
      return true;
    }
    if (ev.type === 'recruit') {
      if (ev.action === 'refused') {
        s.recruits.refused++;
        this.fx.push({ kind: 'spark', x: ev.x * u, y: ev.y * u, r, born: clock, life: SPARK_LIFE });
        this.shivers.set(ev.id, clock);
      } else if (ev.action === 'unlink') {
        s.recruits.unlinks++;
        this.fx.push({ kind: 'ring', x: ev.x * u, y: ev.y * u, r, born: clock, life: SPARK_LIFE, color: THREAT });
      } else {
        // The whole line fell by one pass (`id` — the group): a flash over the last one that fell, «+N ⚡» over the hero (as the Призма's).
        s.recruits.drills++;
        let last: { x: number; y: number; n: number } | null = null;
        for (const m of this.recruitAt.values()) if (m.group === ev.id && (!last || m.n > last.n)) last = m;
        if (last) this.fx.push({ kind: 'flash', x: last.x, y: last.y, r: r * 1.5, born: clock, life: FLASH_LIFE, color: GOLD });
        this.float(`+${ev.energy ?? 0} ⚡`, ev.x * u, ev.y * u - 150, GOLD);
        for (const [id, m] of this.recruitAt) if (m.group === ev.id) this.recruitAt.delete(id);
      }
      return true;
    }
    if (ev.type === 'warden') {
      if (ev.action === 'anger') {
        if (ev.stage === 'start') { s.wardens.starts++; this.fx.push({ kind: 'ring', x: ev.x * u, y: ev.y * u, r, born: clock, life: RING_LIFE, color: RED }); }
        else { s.wardens.ends++; this.fx.push({ kind: 'ring', x: ev.x * u, y: ev.y * u, r, born: clock, life: SPARK_LIFE, color: BAN }); }
      } else if (ev.stage === 'hit') {
        s.wardens.hits++;
        const e = world.enemies.find(x => x.id === ev.id);
        this.fx.push({ kind: 'swing', x: (e?.x ?? ev.x) * u, y: (e?.y ?? ev.y) * u, r: (this.swingR.get(ev.id) ?? 1.6) * u, born: clock, life: FLASH_LIFE });
      }
      return true;
    }
    return false;
  }

  /**
   * Under the bodies: the pools, the marks of the pots in the air, the angry wardens' rings and «Размах» circles. `sees` — the camera
   * (with a margin in arena units).
   */
  drawGround(g: Graphics, world: World, tools: SignTools, clock: number, r: number, sees: (p: Vec, margin: number) => boolean): void {
    const u = this.unit, s = this.shown;
    const poolR = pitchPoolRadiusOf(world) * u;
    for (const q of pitchPools(world)) {
      if (!sees(q, poolR / u + 0.5)) continue;
      const X = q.x * u, Y = q.y * u;
      s.pools++;
      s.poolAt.push({ id: q.id, x: q.x, y: q.y, burning: q.burn !== undefined });
      if (q.burn !== undefined) {
        // The hammer's fire over a scorched disc: the same embers, the same pale-blue rim of the hero's own fire.
        s.burning++;
        const k = Math.max(0, Math.min(1, q.burn / BURN_FADE)), flick = 0.85 + 0.15 * Math.sin(clock * 13 + q.x * 7 + q.y * 5);
        g.circle(X, Y, poolR).fill({ color: PITCH_DARK, alpha: 0.7 * k });
        g.circle(X, Y, poolR).fill({ color: EMBER, alpha: 0.5 * k });
        g.circle(X, Y, poolR * 0.62 * flick).fill({ color: FLAME, alpha: 0.5 * k });
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + q.id, tip = poolR * (0.22 + 0.16 * Math.sin(clock * 11 + i * 1.7 + q.id));
          g.poly([X + Math.cos(a - 0.2) * poolR * 0.9, Y + Math.sin(a - 0.2) * poolR * 0.9, X + Math.cos(a) * (poolR + tip), Y + Math.sin(a) * (poolR + tip), X + Math.cos(a + 0.2) * poolR * 0.9, Y + Math.sin(a + 0.2) * poolR * 0.9])
            .fill({ color: FLAME, alpha: 0.75 * k });
        }
        g.circle(X, Y, poolR).stroke({ color: PLAYER_FX, width: 2, alpha: 0.75 * k });
        continue;
      }
      const k = Math.max(0.15, Math.min(1, q.life / DRY_FADE));
      g.circle(X, Y, poolR).fill({ color: PITCH_DARK, alpha: 0.85 * k });
      g.ellipse(X - poolR * 0.28, Y - poolR * 0.3, poolR * 0.46, poolR * 0.2).fill({ color: PITCH_GLOSS, alpha: 0.55 * k });
      // Bubbles: three rings that swell and burst, out of step.
      for (let i = 0; i < 3; i++) {
        const phase = (clock * 0.9 + q.id * 0.37 + i / 3) % 1, a = q.id * 2.1 + i * 2.4, d = poolR * (0.2 + 0.3 * ((i * 0.37 + q.id * 0.13) % 1));
        g.circle(X + Math.cos(a) * d, Y + Math.sin(a) * d, poolR * 0.12 * phase + 1).stroke({ color: PITCH_RIM, width: 1.8, alpha: 0.8 * (1 - phase) * k });
      }
      g.circle(X, Y, poolR).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.6 * k });
      g.circle(X, Y, poolR).stroke({ color: PITCH_RIM, width: 2, alpha: 0.9 * k });
    }
    // The marks: the threat circle (white, hatched) blinking every `MARK_BLINK` s the whole flight.
    const markR = pitchMarkRadius(world) * u;
    for (const pot of potsInFlight(world)) {
      if (!sees(pot, markR / u + 0.5)) continue;
      s.marks++;
      s.markAt.push({ x: pot.x, y: pot.y });
      const X = pot.x * u, Y = pot.y * u, lit = Math.floor(clock / MARK_BLINK) % 2 === 0;
      if (!lit) { g.circle(X, Y, markR).stroke({ color: THREAT, width: 1.5, alpha: 0.3 }); continue; }
      s.marksLit++;
      g.circle(X, Y, markR).fill({ color: THREAT, alpha: 0.22 });
      tools.hatchCircle(g, X, Y, markR, 0.28 * u);
      g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
      g.circle(X, Y, markR).stroke({ color: THREAT_OUTLINE, width: 6, alpha: 0.8 }).circle(X, Y, markR).stroke({ color: THREAT, width: 3, alpha: 1 });
    }
    // The angry wardens: the countdown ring at the feet (it runs down clockwise) and «Размах».
    for (const e of world.enemies) {
      if (e.kind !== WARDEN || !sees(e, 3)) continue;
      const sw = wardenSwing(world, e);
      if (sw) { s.wardens.swings++; this.swingR.set(e.id, sw.r); drawSwingCircle(g, u, sw); }
      const an = wardenAnger(world, e);
      if (!an) continue;
      s.wardens.anger++;
      const R = r * 1.28, X = e.x * u, Y = e.y * u, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.max(0, Math.min(1, an.left / Math.max(1e-6, an.total)));
      g.circle(X, Y, R).stroke({ color: RED, width: 2, alpha: 0.25 });
      g.moveTo(X + Math.cos(a0) * R, Y + Math.sin(a0) * R).arc(X, Y, R, a0, a1).stroke({ color: THREAT_OUTLINE, width: 8, alpha: 0.6, cap: 'round' });
      g.moveTo(X + Math.cos(a0) * R, Y + Math.sin(a0) * R).arc(X, Y, R, a0, a1).stroke({ color: RED, width: 4, alpha: 0.95, cap: 'round' });
    }
  }

  /**
   * Over the bodies: the pot over a winding-up pitcher, the pots on their arcs, the drops and the trail in pitch, the recruits'
   * plaques, the wardens' belt keys and eyes, and the running effects. `r` — the body's radius (px), `px` — `1 / scale`.
   */
  drawOver(g: Graphics, world: World, clock: number, r: number, px: number, ink: (color: number) => number, sees: (e: Vec) => boolean): void {
    const u = this.unit, s = this.shown;
    for (const e of world.enemies) {
      if (e.kind === PITCHER && sees(e)) {
        const wu = pitcherWindup(world, e);
        if (wu) {
          s.windups++;
          const sz = r * 0.55, X = e.x * u, Y = e.y * u - r * 1.95;
          g.circle(X, Y, sz * 1.7).fill({ color: EMBER, alpha: 0.16 + 0.08 * Math.sin(clock * 9) });
          this.drawPot(g, X, Y, sz, clock * 2, clock);
          const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * wu.progress, R = sz * 1.7;
          g.moveTo(X, Y - R).arc(X, Y, R, a0, a1).stroke({ color: THREAT_OUTLINE, width: 7, alpha: 0.85, cap: 'round' });
          g.moveTo(X, Y - R).arc(X, Y, R, a0, a1).stroke({ color: THREAT, width: 3.5, alpha: 1, cap: 'round' });
        }
      }
    }
    // The pots in the air: the arc rises with the distance, the shadow grows to the fall.
    for (const pot of potsInFlight(world)) {
      if (!sees(pot) && !sees({ x: pot.x0, y: pot.y0 })) continue;
      s.pots++;
      const t = Math.max(0, Math.min(1, 1 - pot.left / Math.max(1e-6, pot.flight))), dist = Math.hypot(pot.x - pot.x0, pot.y - pot.y0);
      const apex = Math.min(4.2, 1.6 + 0.35 * dist) * u, h = 4 * apex * t * (1 - t);
      const gx = (pot.x0 + (pot.x - pot.x0) * t) * u, gy = (pot.y0 + (pot.y - pot.y0) * t) * u, sz = r * 0.5;
      const sr = sz * (0.7 + 0.9 * t);
      g.ellipse(gx, gy, sr, sr * 0.45).fill({ color: 0x000000, alpha: 0.15 + 0.3 * t });
      this.drawPot(g, gx, gy - h, sz, t * 9.4, clock);
    }
    this.drawPitchedFeet(g, world, clock, r, sees);
    this.drawRecruits(g, world, clock, r, ink, sees);
    for (const e of world.enemies) {
      if (e.kind !== WARDEN || !sees(e)) continue;
      const partner = wardenPartner(world, e);
      if (partner) {
        const k = keyAt(e, u, r);
        drawKey(g, k.x, k.y, r * 0.8, ink(partner.color));
        s.wardens.keys++;
      }
      if (wardenAngry(e)) {
        // The eyes glow red.
        const X = e.x * u, Y = e.y * u - r * 0.3, glow = 0.7 + 0.3 * Math.sin(clock * 12 + e.id);
        for (const sx of [-1, 1]) {
          g.ellipse(X + sx * r * 0.3, Y, r * 0.2, r * 0.1).fill({ color: RED, alpha: 0.35 * glow });
          g.ellipse(X + sx * r * 0.3, Y, r * 0.14, r * 0.06).fill({ color: RED, alpha: glow }).stroke({ color: NAVY, width: 1, alpha: 0.8 });
        }
      }
    }
    this.drawFx(g, clock, px);
  }

  /** A clay pot at (`x`, `y`), `sz` px wide, turned by `spin`, smoking. */
  private drawPot(g: Graphics, x: number, y: number, sz: number, spin: number, clock: number): void {
    // Smoke: three puffs rising and thinning.
    for (let i = 0; i < 3; i++) {
      const ph = (clock * 0.9 + i / 3) % 1;
      g.circle(x + Math.sin(clock * 3 + i * 2) * sz * 0.5, y - sz * 0.9 - ph * sz * 2.2, sz * 0.28 * (1 + ph)).fill({ color: SMOKE, alpha: 0.4 * (1 - ph) });
    }
    g.circle(x, y, sz).fill(POT).stroke({ color: NAVY, width: 3 });
    // The band and the glow of the hot pitch at the mouth turn with the pot.
    const c = Math.cos(spin), n = Math.sin(spin);
    g.moveTo(x - sz * c, y - sz * n).lineTo(x + sz * c, y + sz * n).stroke({ color: POT_BAND, width: 3, alpha: 0.9 });
    g.ellipse(x + sz * 0.05 * n, y - sz * 0.55, sz * 0.62, sz * 0.2).fill(POT_BAND).stroke({ color: NAVY, width: 2 });
    g.ellipse(x + sz * 0.05 * n, y - sz * 0.55, sz * 0.4, sz * 0.1).fill({ color: POT_GLOW, alpha: 0.9 });
    g.arc(x, y, sz * 0.78, Math.PI * 0.75, Math.PI * 1.15).stroke({ color: 0xffffff, width: 1.6, alpha: 0.25 });
  }

  /** Drops at the feet of the hero and of the enemies in pitch, and the hero's sticky trail. */
  private drawPitchedFeet(g: Graphics, world: World, clock: number, r: number, sees: (e: Vec) => boolean): void {
    if (!pitchPools(world).length && !this.trail.length) { this.trail.length = 0; return; }
    const u = this.unit, s = this.shown, hero = world.hero;
    const heroIn = world.status === 'playing' && heroPitchFactor(world) < 1;
    s.heroInPitch = heroIn ? 1 : 0;
    if (heroIn) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(hero.x - last.x, hero.y - last.y) >= TRAIL_STEP) this.trail.push({ x: hero.x, y: hero.y, born: clock });
    }
    this.trail = this.trail.filter(t => clock - t.born < TRAIL_LIFE);
    for (const t of this.trail) {
      const k = 1 - (clock - t.born) / TRAIL_LIFE;
      g.ellipse(t.x * u, t.y * u + r * 0.5, r * 0.34 * (0.5 + 0.5 * k), r * 0.14 * (0.5 + 0.5 * k)).fill({ color: PITCH_DARK, alpha: 0.6 * k });
      s.trail++;
    }
    const drops = (x: number, y: number, seed: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const dx = (i - (n - 1) / 2) * r * 0.5, sag = (clock * 0.8 + seed * 0.31 + i * 0.4) % 1;
        g.ellipse(x + dx, y + r * 0.62 + sag * r * 0.22, r * 0.11, r * 0.17 * (1 + sag * 0.6)).fill({ color: PITCH_DARK, alpha: 0.9 * (1 - sag * 0.5) }).stroke({ color: PITCH_RIM, width: 1, alpha: 0.7 });
        s.drops++;
      }
    };
    if (heroIn) drops(hero.x * u, hero.y * u, 0, 3);
    if (!pitchPools(world).length) return;
    for (const e of world.enemies) {
      if (!sees(e) || !inPitch(world, e)) continue;
      drops(e.x * u, e.y * u, e.id, 2);
    }
  }

  /** The recruits' plaques. */
  private drawRecruits(g: Graphics, world: World, clock: number, r: number, ink: (color: number) => number, sees: (e: Vec) => boolean): void {
    const u = this.unit, s = this.shown.recruits;
    const gone = new Set(world.chain.flatMap(l => (l.kind === 'enemy' ? [l.id] : [])));
    const currents = new Map<number, number>();
    for (const e of world.enemies) {
      if (e.kind !== RECRUIT) continue;
      const n = recruitNumber(e), group = recruitGroup(e);
      this.recruitAt.set(e.id, { x: e.x * u, y: e.y * u, group, n });
      if (n <= 0 || !sees(e)) continue;
      let cur = currents.get(group);
      if (cur === undefined) { cur = recruitCurrent(world.enemies, group, gone); currents.set(group, cur); }
      const isCur = n === cur && !gone.has(e.id);
      const shiverAt = this.shivers.get(e.id), shiver = shiverAt === undefined ? 0 : Math.max(0, 1 - (clock - shiverAt) / SHIVER_LIFE);
      const half = r * (isCur ? 0.72 : 0.5), X = e.x * u + Math.sin(clock * 90) * r * 0.14 * shiver, Y = e.y * u - r * (isCur ? 1.95 : 1.8);
      const body = ink(e.color), a = isCur ? 1 : 0.6;
      if (isCur) g.roundRect(X - half - 3, Y - half - 3, (half + 3) * 2, (half + 3) * 2, half * 0.35).stroke({ color: THREAT, width: 3, alpha: 0.9 });
      g.roundRect(X - half, Y - half, half * 2, half * 2, half * 0.3).fill({ color: body, alpha: a }).stroke({ color: NAVY, width: 2.5, alpha: a });
      g.roundRect(X - half * 0.8, Y - half * 0.85, half * 1.6, half * 0.3, half * 0.15).fill({ color: 0xffffff, alpha: 0.2 * a });
      drawDigit(g, n, X, Y, half * 1.25);
      s.numbers++;
      if (isCur) { s.current++; if (!s.currentNumber || n < s.currentNumber) s.currentNumber = n; } else s.dim++;
    }
    if (this.recruitAt.size > 64) for (const id of this.recruitAt.keys()) { if (this.recruitAt.size <= 32) break; if (!world.enemies.some(e => e.id === id)) this.recruitAt.delete(id); }
    for (const [id, t] of this.shivers) if (clock - t > SHIVER_LIFE) this.shivers.delete(id);
  }

  /** The running effects. */
  private drawFx(g: Graphics, clock: number, px: number): void {
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) {
      const k = Math.max(0, Math.min(1, (clock - f.born) / f.life));
      if (f.kind === 'splash') {
        g.circle(f.x, f.y, f.r * (0.5 + 1.1 * k)).stroke({ color: PITCH_RIM, width: 5 * (1 - k) + 1, alpha: 1 - k });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + 0.3, d = f.r * (0.5 + 1.5 * k), up = Math.sin(Math.PI * k) * f.r * 0.9;
          g.circle(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.7 - up, f.r * 0.1 * (1 - k * 0.5)).fill({ color: PITCH_DARK, alpha: 1 - k }).stroke({ color: PITCH_RIM, width: 1, alpha: 1 - k });
        }
      } else if (f.kind === 'flash') {
        g.circle(f.x, f.y, f.r * (1 + 0.15 * k)).fill({ color: f.color ?? FLAME, alpha: 0.85 * (1 - k) * (1 - k) });
        g.circle(f.x, f.y, f.r * (1 + 0.5 * k)).stroke({ color: 0xffffff, width: 4 * (1 - k) + 1, alpha: 1 - k });
      } else if (f.kind === 'spark') {
        // A block spark: a star of short rays, white on navy.
        for (const [w, c] of [[6 * px + 2, THREAT_OUTLINE], [3, THREAT]] as const) {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + 0.4, r0 = f.r * (0.3 + 0.3 * k), r1 = f.r * (0.7 + 0.6 * k);
            g.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0).lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
          }
          g.stroke({ color: c, width: w, alpha: 1 - k, cap: 'round' });
        }
      } else if (f.kind === 'ring') {
        const R = f.r * (0.9 + 1.6 * k);
        g.circle(f.x, f.y, R).stroke({ color: THREAT_OUTLINE, width: 8 * (1 - k) + 2, alpha: 0.7 * (1 - k) });
        g.circle(f.x, f.y, R).stroke({ color: f.color ?? RED, width: 5 * (1 - k) + 1.5, alpha: 1 - k * k });
      } else {
        g.circle(f.x, f.y, f.r).fill({ color: RED, alpha: 0.28 * (1 - k) }).stroke({ color: THREAT, width: 5 * (1 - k) + 1, alpha: 1 - k });
      }
    }
  }

  /**
   * The chain's highlight (chain layer, over the bodies), all of it read from the plan: the pools the lit path touches wear a fiery
   * rim (`fire.pitch`), the warden who will be angry — a flickering red ring (`anger`), a pair both in the chain — gold keys, the
   * recruits the law refuses (`order` of the links, the pierce, the return, the seal) — a grey ban.
   */
  drawPlan(g: Graphics, world: World, plan: ChainPlan, clock: number, r: number, sees: (e: Vec) => boolean): void {
    const u = this.unit, s = this.shown;
    const poolR = pitchPoolRadiusOf(world) * u;
    for (const id of plan.fire?.pitch ?? []) {
      const q = pitchPools(world).find(x => x.id === id);
      if (!q || !sees(q)) continue;
      const X = q.x * u, Y = q.y * u;
      s.poolFire++;
      g.circle(X, Y, poolR).fill({ color: EMBER, alpha: 0.28 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, tip = poolR * (0.3 + 0.18 * Math.sin(clock * 12 + i * 1.3));
        g.poly([X + Math.cos(a - 0.14) * poolR, Y + Math.sin(a - 0.14) * poolR, X + Math.cos(a) * (poolR + tip), Y + Math.sin(a) * (poolR + tip), X + Math.cos(a + 0.14) * poolR, Y + Math.sin(a + 0.14) * poolR])
          .fill({ color: FLAME, alpha: 0.9 }).stroke({ color: NAVY, width: 1.2, alpha: 0.7 });
      }
      g.circle(X, Y, poolR).stroke({ color: NAVY, width: 7, alpha: 0.6 }).circle(X, Y, poolR).stroke({ color: PLAYER_FX, width: 4, alpha: 0.9 }).circle(X, Y, poolR).stroke({ color: EMBER, width: 2, alpha: 0.95 });
    }
    const angry = new Set(plan.anger ?? []);
    for (const id of angry) {
      const e = world.enemies.find(x => x.id === id);
      if (!e || !sees(e)) continue;
      s.wardens.warn++;
      const X = e.x * u, Y = e.y * u, R = r * 1.5, flick = 0.55 + 0.45 * Math.sin(clock * 14);
      g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 7, alpha: 0.6 });
      g.circle(X, Y, R).stroke({ color: RED, width: 3.5, alpha: flick });
      for (let i = 0; i < 8; i++) {
        const a = clock * 2.5 + (i / 8) * Math.PI * 2;
        g.moveTo(X + Math.cos(a) * R, Y + Math.sin(a) * R).lineTo(X + Math.cos(a) * (R + r * 0.25), Y + Math.sin(a) * (R + r * 0.25));
      }
      g.stroke({ color: RED, width: 3, alpha: flick, cap: 'round' });
    }
    // Both of a pair in the chain, and nobody angry: the keys burn gold.
    const struck = new Set(plan.links.flatMap(l => (l.link.kind === 'enemy' ? [l.link.id] : [])));
    for (const e of world.enemies) {
      if (e.kind !== WARDEN || !struck.has(e.id) || angry.has(e.id) || !sees(e)) continue;
      const partner = wardenPartner(world, e);
      if (!partner || !struck.has(partner.id) || angry.has(partner.id)) continue;
      const k = keyAt(e, u, r);
      drawKey(g, k.x, k.y, r * 0.95, GOLD, true);
      s.wardens.gold++;
    }
    // The law of order refuses these bodies (the strike is out and gone): a grey ban over the plaque.
    const refused = new Set<number>(plan.seal?.order ?? []);
    for (const l of plan.links) if (l.outcome?.order && l.link.kind === 'enemy') refused.add(l.link.id);
    for (const b of plan.pierce?.bodies ?? []) if (b.outcome.order) refused.add(b.id);
    for (const h of plan.back?.hits ?? []) if (h.outcome.order) refused.add(h.id);
    for (const id of refused) {
      const e = world.enemies.find(x => x.id === id);
      if (!e || e.kind !== RECRUIT || !sees(e)) continue;
      const X = e.x * u, Y = e.y * u - r * 1.0, R = r * 0.62, d = R * 0.7;
      g.circle(X, Y, R).fill({ color: 0x20262c, alpha: 0.7 });
      for (const [w, c] of [[6, NAVY], [3, BAN]] as const) {
        g.circle(X, Y, R).stroke({ color: c, width: w });
        g.moveTo(X - d, Y + d).lineTo(X + d, Y - d).stroke({ color: c, width: w, cap: 'round' });
      }
      s.recruits.bans++;
    }
  }
}
