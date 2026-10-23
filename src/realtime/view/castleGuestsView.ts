/**
 * Task 60а «Гости замка», part ui (design 23.10.2026, docs/design-notes/task-60-castle-enemies.md, 13; docs/realtime-elite-behaviors.md,
 * «Замок: гости»): the view of the candelabra («Подсвечник»), the queen («Ферзь»), the butler and his chandelier («Дворецкий», «Люстра»), the
 * poltergeist («Полтергейст») and the jester («Шут»). Everything is read from the sim (`candelabraCross`, `queenMove`, `queenLines`,
 * `liveChandelier`, `butlerBow`, `poltergeistState`, `thingFlight`, `jesterState`, `world.shots`, the plan's `shove.topple`, `reflects`,
 * `chandelierFall`, the events); nothing here changes the world, no die is rolled:
 * - the candelabra: lighting — its fires one after another from the centre and a curved arrow of the turn at its foot; spinning — the fires
 *   with short trails (the turn's way); the plan's topple — the fall's strip with the fire's hatching and a cross on each body it crushes;
 * - the queen: the move's line (0.6 s) with an arrow; the star's eight dashed lines filling through the windup (a line breaks at a standing
 *   thing — the thing covers); the stars — four-point shots of the threat colour, flashing while they hang, a short trail in flight;
 * - the butler bows (the body tilts); over the hero the chandelier's shadow grows through the bow; the chandelier hangs over everything (a layer
 *   over the bodies), its shadow on the floor; a wax drop — a mark r 0.6 filling; the plan's «упадёт» — it trembles and a ring r 1.0; the fall —
 *   a ring filling, then a flash and shards;
 * - the poltergeist is half transparent; a lifted thing shakes over its shadow; a thrown one flies on an arc (larger at its top) to a mark
 *   r 0.7 filling through the flight;
 * - the jester: three bells on his cap (a catch puts one out), juggling through the windup, the ball (a bright ball over the heads), a
 *   reflected ball — a light trail; the plan's reflect — the way back to him, a miss marked; stunned — the lynx's stars.
 * Coordinates are arena pixels (`unit` per arena unit); `R` is an enemy's drawing radius in px.
 */
import { Container, Graphics } from 'pixi.js';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import type { ChainPlan } from '../sim/chain';
import {
  BUTLER, CANDELABRA, CHANDELIER_DROP_TIME, CHANDELIER_FALL_RADIUS, CHANDELIER_FALL_TIME, JESTER, POLTERGEIST, QUEEN,
  butlerBow, candelabraCross, jesterState, liveChandelier, poltergeistState, queenLines, queenMove, thingFlight,
} from '../sim/enemies/castleGuests';
import { liveShots, type Shot } from '../sim/shots';
import type { Enemy, World, WorldEvent } from '../sim/world';

const NAVY = 0x18232d;
const THREAT = 0xffffff, THREAT_OUTLINE = 0x0b0f14;
const FLAME = 0xffd36b, EMBER = 0xff8a3a;
const GOLD = 0xd9b44a, PALE = 0xf2ead8;
const SHADOW = 0x050a07;
const BALL = 0xe9568a, BALL_LIGHT = 0xffd0e0;

/** The chandelier hangs this high over its point (units); its drawing's box (body radii). */
export const CHANDELIER_LIFT = 1.7, CHANDELIER_ART = 3.2;

/** The shown counts of the last frame / since the fight began (tests read them through `window.__realtime`). */
export interface CastleGuestsShown {
  /** Crosses drawn (lighting / spinning), their fires drawn, the turn's arrows. */
  crossLight: number; crossSpin: number; fires: number; arrows: number;
  /** The queen's move lines, star lines (and those cut by a thing), the windup's fill; stars drawn (hanging / flying). */
  moves: number; starLines: number; starCovered: number; starFill: number; stars: number; starsHanging: number;
  /** The chandelier drawn (0/1, by its art 0/1), its shadow, a wax mark and its fill, the fall's ring and its fill; the bow's shadow over the hero. */
  chandelier: number; chandelierArt: number; drop: number; dropFill: number; fall: number; fallFill: number; bowShadow: number;
  /** Lifted things drawn shaking, flying things, their marks and the fullest flight. */
  lifted: number; flying: number; flightFill: number;
  /** Jesters' bells lit / all, juggling (0/1), balls drawn (reflected ones), stunned jesters. */
  bellsLit: number; bells: number; juggling: number; balls: number; ballsBack: number; stunned: number;
  /** In the drawn chain's plan this frame: the topple's strip, the bodies it crushes, reflects (misses), the chandelier's fall. */
  planTopple: number; planCrushed: number; planReflects: number; planMisses: number; planFall: number;
  /** Since the fight began: topples, chandelier falls (crashes), wax drops landed, things landed, catches, misses. */
  topples: number; crashes: number; drops: number; lands: number; catches: number; misses: number;
}

const emptyShown = (): CastleGuestsShown => ({
  crossLight: 0, crossSpin: 0, fires: 0, arrows: 0, moves: 0, starLines: 0, starCovered: 0, starFill: 0, stars: 0, starsHanging: 0,
  chandelier: 0, chandelierArt: 0, drop: 0, dropFill: 0, fall: 0, fallFill: 0, bowShadow: 0, lifted: 0, flying: 0, flightFill: 0,
  bellsLit: 0, bells: 0, juggling: 0, balls: 0, ballsBack: 0, stunned: 0, planTopple: 0, planCrushed: 0, planReflects: 0, planMisses: 0, planFall: 0,
  topples: 0, crashes: 0, drops: 0, lands: 0, catches: 0, misses: 0,
});

/** The look of a body this frame (the renderer applies it): a lift (px, up), a scale, an alpha, a tilt (rad). */
export interface GuestLook { lift: number; scale: number; alpha: number; tilt: number }

/** A threat circle (px) filling to `k` from the centre: a faint whole, the filled part, a dark rim under a white one. */
function threatCircle(g: Graphics, x: number, y: number, R: number, k: number): void {
  g.circle(x, y, R).fill({ color: THREAT, alpha: 0.12 });
  if (k > 0) g.circle(x, y, R * Math.min(1, k)).fill({ color: THREAT, alpha: 0.26 });
  g.circle(x, y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(x, y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
}

/** A dashed line (px), `dash` long dashes; `k` — the filled share (bright), the rest faint. */
function dashed(g: Graphics, x0: number, y0: number, x1: number, y1: number, dash: number, k: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, fill = len * Math.max(0, Math.min(1, k));
  for (let t = 0; t < len; t += dash * 2) {
    const a = t, b = Math.min(len, t + dash), bright = a < fill;
    g.moveTo(x0 + ux * a, y0 + uy * a).lineTo(x0 + ux * b, y0 + uy * b).stroke({ color: THREAT_OUTLINE, width: bright ? 6 : 4, alpha: bright ? 0.85 : 0.4, cap: 'round' });
    g.moveTo(x0 + ux * a, y0 + uy * a).lineTo(x0 + ux * b, y0 + uy * b).stroke({ color: THREAT, width: bright ? 3 : 1.5, alpha: bright ? 1 : 0.5, cap: 'round' });
  }
}

/** A small flame (px) — a fire of the cross or of the topple's strip; `r` its radius. */
function fire(g: Graphics, x: number, y: number, r: number, clock: number, seed: number): void {
  const f = 0.85 + 0.15 * Math.sin(clock * 16 + seed);
  g.circle(x, y, r * 1.5 * f).fill({ color: EMBER, alpha: 0.35 });
  g.poly([x - r, y + r * 0.6, x - r * 0.4, y - r * 0.6, x, y - r * 1.6 * f, x + r * 0.4, y - r * 0.6, x + r, y + r * 0.6]).fill(EMBER).stroke({ color: NAVY, width: 2, join: 'round' });
  g.circle(x, y + r * 0.1, r * 0.45).fill(FLAME);
}

/** A curved arrow (px) round the foot of the cross: its turn's way (`dir` +1 — clockwise on screen). */
function turnArrow(g: Graphics, x: number, y: number, R: number, dir: number, k: number): void {
  const a0 = dir > 0 ? Math.PI * 0.15 : Math.PI * 0.85, a1 = dir > 0 ? Math.PI * 0.85 : Math.PI * 0.15, sweep = a1 - a0;
  const end = a0 + sweep * Math.max(0.15, Math.min(1, k));
  for (const [color, width] of [[THREAT_OUTLINE, 7], [THREAT, 3]] as const) {
    g.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R * 0.45);
    for (let i = 1; i <= 12; i++) { const a = a0 + (end - a0) * i / 12; g.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R * 0.45); }
    g.stroke({ color, width, cap: 'round', join: 'round' });
  }
  const hx = x + Math.cos(end) * R, hy = y + Math.sin(end) * R * 0.45, tx = -Math.sin(end) * Math.sign(sweep), ty = Math.cos(end) * 0.45 * Math.sign(sweep), d = Math.hypot(tx, ty) || 1;
  const ux = tx / d, uy = ty / d, s = R * 0.22;
  g.poly([hx + ux * s, hy + uy * s, hx - ux * s * 0.5 - uy * s * 0.7, hy - uy * s * 0.5 + ux * s * 0.7, hx - ux * s * 0.5 + uy * s * 0.7, hy - uy * s * 0.5 - ux * s * 0.7]).fill(THREAT).stroke({ color: THREAT_OUTLINE, width: 2 });
}

/** A star of the queen (px): four points of the threat colour; hanging — it flashes; flying — a short trail. */
function drawStar(g: Graphics, s: Pick<Shot, 'id' | 'x' | 'y' | 'vx' | 'vy' | 'r' | 'hang'>, clock: number, unit: number): void {
  const X = s.x * unit, Y = s.y * unit, r = s.r * unit * 1.6, speed = Math.hypot(s.vx, s.vy), hanging = s.hang > 0;
  const blink = hanging ? (Math.floor(clock * 12 + s.id) % 2 === 0 ? 1 : 0.5) : 1;
  if (!hanging && speed > 1e-6) {
    const c = s.vx / speed, sn = s.vy / speed;
    g.moveTo(X, Y).lineTo(X - c * r * 2.2, Y - sn * r * 2.2).stroke({ color: THREAT, width: r * 0.6, alpha: 0.35, cap: 'round' });
  }
  if (hanging) g.circle(X, Y, r * 1.5).stroke({ color: THREAT, width: 2, alpha: 0.7 * blink });
  const a = clock * 6 + s.id, pts: number[] = [];
  for (let i = 0; i < 8; i++) { const b = a + i * Math.PI / 4, rr = i % 2 ? r * 0.38 : r; pts.push(X + Math.cos(b) * rr, Y + Math.sin(b) * rr); }
  g.poly(pts).fill({ color: THREAT, alpha: blink }).stroke({ color: THREAT_OUTLINE, width: 2.5, alpha: blink, join: 'round' });
}

/** The jester's ball (px): a bright ball with a light band over the heads; reflected — a light trail behind it. */
function drawBall(g: Graphics, s: Pick<Shot, 'id' | 'x' | 'y' | 'vx' | 'vy' | 'r' | 'back'>, clock: number, unit: number): void {
  const X = s.x * unit, Y = s.y * unit, r = s.r * unit, speed = Math.hypot(s.vx, s.vy), hop = Math.abs(Math.sin(clock * 9 + s.id)) * r * 1.2;
  g.ellipse(X, Y + r * 0.9, r * 0.9, r * 0.35).fill({ color: SHADOW, alpha: 0.35 });
  if (s.back && speed > 1e-6) {
    const c = s.vx / speed, sn = s.vy / speed;
    for (let i = 1; i <= 4; i++) g.circle(X - c * r * 1.1 * i, Y - hop - sn * r * 1.1 * i, r * (0.8 - i * 0.15)).fill({ color: PALE, alpha: 0.5 - i * 0.1 });
  }
  g.circle(X, Y - hop, r).fill(s.back ? PALE : BALL).stroke({ color: NAVY, width: 2.5 });
  g.moveTo(X - r * 0.95, Y - hop).quadraticCurveTo(X, Y - hop - r * 0.6, X + r * 0.95, Y - hop).stroke({ color: s.back ? BALL : BALL_LIGHT, width: 2 });
}

/** Three pale stars turning over a stunned head (px; the lynx's sign). */
function stunStars(g: Graphics, X: number, Y: number, r: number, clock: number): void {
  for (let i = 0; i < 3; i++) {
    const a = clock * 5 + i * Math.PI * 2 / 3, sx = X + Math.cos(a) * r * 0.6, sy = Y + Math.sin(a) * r * 0.22, pts: number[] = [];
    for (let j = 0; j < 10; j++) { const b = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? r * 0.07 : r * 0.17; pts.push(sx + Math.cos(b) * rr, sy + Math.sin(b) * rr); }
    g.poly(pts).fill(0xdbe9f4).stroke({ color: THREAT_OUTLINE, width: 1.5 });
  }
}

/** The procedural chandelier (px), its centre at (x, y): a gold ring with five candles and drops of crystal. */
function drawChandelier(g: Graphics, x: number, y: number, R: number, clock: number): void {
  g.moveTo(x, y - R * 1.6).lineTo(x, y - R * 0.4).stroke({ color: NAVY, width: 3 });
  g.ellipse(x, y, R * 1.2, R * 0.4).fill({ color: GOLD, alpha: 0.9 }).stroke({ color: NAVY, width: 3 });
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.1 + 0.8 * i / 4), cx = x - Math.cos(a) * R * 1.1, cy = y - Math.sin(a) * R * 0.15;
    g.roundRect(cx - R * 0.08, cy - R * 0.45, R * 0.16, R * 0.4, 2).fill(PALE).stroke({ color: NAVY, width: 1.5 });
    fire(g, cx, cy - R * 0.55, R * 0.1, clock, i);
    g.poly([cx - R * 0.07, cy + R * 0.2, cx, cy + R * 0.42, cx + R * 0.07, cy + R * 0.2]).fill({ color: 0xcfe6ff, alpha: 0.9 }).stroke({ color: NAVY, width: 1 });
  }
}

/** A thing's kind is a thing of the castle the poltergeist may lift (the view reads `vars.lf` only: lifted by the sim). */
const liftedBy = (e: Enemy): number | undefined => e.vars.lf;

type Burst = 'topple' | 'crash' | 'drop' | 'land' | 'catch' | 'miss' | 'star';

/** The view of the castle's guests. One per renderer. */
export class CastleGuestsView {
  /** Under the crowd: the marks, the lines, the shadows. */
  readonly floor = new Container();
  /** Over the bodies: the chandelier, the fires, the shots, the bells, the effects. */
  readonly layer = new Container();
  readonly shown: CastleGuestsShown = emptyShown();
  private readonly floorG = new Graphics();
  private readonly overG = new Graphics();
  private chandelierSprite: ReturnType<typeof characterSprite> = null;
  private bursts: { kind: Burst; x: number; y: number; born: number; life: number }[] = [];

  constructor(private readonly unit: number) {
    this.floor.addChild(this.floorG);
    this.layer.addChild(this.overG);
  }

  reset(): void {
    this.bursts = [];
    this.floorG.clear(); this.overG.clear();
    if (this.chandelierSprite) this.chandelierSprite.visible = false;
    Object.assign(this.shown, emptyShown());
  }

  /** The look of a body now (the bow's tilt, the poltergeist's ghost, a lifted or a flying thing); null — none. */
  look(world: World, e: Enemy, clock: number, R: number): GuestLook | null {
    if (e.kind === BUTLER) {
      const bow = butlerBow(e);
      return bow === null ? null : { lift: 0, scale: 1, alpha: 1, tilt: Math.sin(bow * Math.PI) * 0.45 };
    }
    if (e.kind === POLTERGEIST) return { lift: Math.sin(clock * 2.6 + e.id) * R * 0.12, scale: 1, alpha: 0.6, tilt: 0 };
    const flight = thingFlight(world, e);
    if (flight) { const s = Math.sin(flight.progress * Math.PI); return { lift: s * this.unit * 1.4, scale: 1 + 0.35 * s, alpha: 1, tilt: flight.progress * Math.PI * 2 }; }
    const by = liftedBy(e);
    if (by !== undefined) {
      // It rises with the poltergeist's lift (the sim's share), then shakes up there.
      const owner = world.enemies.find(x => x.id === by), k = owner ? poltergeistState(world, owner)?.lifting ?? 1 : 1;
      return { lift: this.unit * 0.7 * k + Math.sin(clock * 30 + e.id) * R * 0.08, scale: 1, alpha: 1, tilt: Math.sin(clock * 23 + e.id) * 0.08 };
    }
    return null;
  }

  /** Under the crowd: the queen's lines, the topple of nobody yet, the wax and fall marks, the shadows (the chandelier's, the lifted things'). */
  drawFloor(world: World, _clock: number, R: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const g = this.floorG.clear(), U = this.unit, sh = this.shown;
    sh.moves = 0; sh.starLines = 0; sh.starCovered = 0; sh.starFill = 0; sh.drop = 0; sh.dropFill = 0; sh.fall = 0; sh.fallFill = 0; sh.bowShadow = 0;
    sh.lifted = 0; sh.flying = 0; sh.flightFill = 0;
    sh.planTopple = 0; sh.planCrushed = 0; sh.planReflects = 0; sh.planMisses = 0; sh.planFall = 0;
    // Standing things cover a star (its dashed line breaks at the first one on it).
    const things = world.enemies.filter(t => (t.kind === 'barrel' || t.kind === 'wardrobe' || t.kind === CANDELABRA) && liftedBy(t) === undefined);
    for (const e of world.enemies) {
      if (e.kind === QUEEN) {
        const mv = queenMove(world, e);
        if (mv && (sees({ x: mv.x0, y: mv.y0 }, 4) || sees({ x: mv.x1, y: mv.y1 }, 4))) {
          const x0 = mv.x0 * U, y0 = mv.y0 * U, x1 = mv.x1 * U, y1 = mv.y1 * U, len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
          const alpha = mv.sliding ? 0.4 : 0.6 + 0.4 * mv.progress;
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: NAVY, width: 7, alpha: alpha * 0.7, cap: 'round' });
          g.moveTo(x0, y0).lineTo(x0 + (x1 - x0) * (mv.sliding ? 1 : mv.progress), y0 + (y1 - y0) * (mv.sliding ? 1 : mv.progress)).stroke({ color: PALE, width: 3, alpha, cap: 'round' });
          const s = R * 0.35;
          g.poly([x1 + ux * s, y1 + uy * s, x1 - ux * s - uy * s * 0.7, y1 - uy * s + ux * s * 0.7, x1 - ux * s + uy * s * 0.7, y1 - uy * s - ux * s * 0.7]).fill({ color: PALE, alpha }).stroke({ color: NAVY, width: 2, alpha });
          sh.moves++;
        }
        const st = queenLines(world, e);
        if (st && sees(e, 9)) {
          sh.starFill = Math.max(sh.starFill, st.progress);
          for (const l of st.lines) {
            // The first standing thing on the line covers the star: the line ends at its edge.
            let end = 1;
            const dx = l.x1 - l.x0, dy = l.y1 - l.y0, len = Math.hypot(dx, dy) || 1;
            for (const t of things) {
              const along = ((t.x - l.x0) * dx + (t.y - l.y0) * dy) / (len * len), off = Math.abs((t.x - l.x0) * dy - (t.y - l.y0) * dx) / len;
              if (along > 0 && along < end && off < 0.45) end = along;
            }
            if (end < 1) sh.starCovered++;
            dashed(g, l.x0 * U, l.y0 * U, (l.x0 + dx * end) * U, (l.y0 + dy * end) * U, U * 0.18, st.progress);
            sh.starLines++;
          }
        }
      } else if (e.kind === BUTLER) {
        const bow = butlerBow(e);
        if (bow !== null && !liveChandelier(world)) {
          // The chandelier's shadow grows over the hero through the bow.
          const h = world.hero;
          g.ellipse(h.x * U, (h.y + 0.25) * U, R * (0.4 + 1.1 * bow), R * (0.15 + 0.4 * bow)).fill({ color: SHADOW, alpha: 0.15 + 0.3 * bow });
          sh.bowShadow = 1;
        }
      }
      // A lifted thing's shadow under it; a flying one's mark and shadow on its way.
      const flight = thingFlight(world, e);
      if (flight) {
        const k = flight.progress, x = (flight.from.x + (flight.to.x - flight.from.x) * k) * U, y = (flight.from.y + (flight.to.y - flight.from.y) * k) * U;
        threatCircle(g, flight.to.x * U, flight.to.y * U, flight.radius * U, k);
        g.ellipse(x, y + R * 0.6, R * 0.8, R * 0.3).fill({ color: SHADOW, alpha: 0.35 });
        sh.flying++; sh.flightFill = Math.max(sh.flightFill, k);
      } else if (liftedBy(e) !== undefined) {
        g.ellipse(e.x * U, e.y * U + R * 0.6, R * 0.9, R * 0.32).fill({ color: SHADOW, alpha: 0.4 });
        sh.lifted++;
      }
    }
    const ch = liveChandelier(world);
    if (ch) {
      g.ellipse(ch.x * U, ch.y * U, R * 1.5, R * 0.55).fill({ color: SHADOW, alpha: 0.3 });
      if (ch.drop) { const k = 1 - ch.drop.left / CHANDELIER_DROP_TIME; threatCircle(g, ch.drop.x * U, ch.drop.y * U, 0.6 * U, k); sh.drop = 1; sh.dropFill = Math.max(0, Math.min(1, k)); }
      if (ch.fall) { const k = 1 - ch.fall.left / CHANDELIER_FALL_TIME; threatCircle(g, ch.x * U, ch.y * U, CHANDELIER_FALL_RADIUS * U, k); sh.fall = 1; sh.fallFill = Math.max(0, Math.min(1, k)); }
    }
  }

  /** Over the bodies: the crosses' fires and arrows, the chandelier, the stars and the balls, the jesters' bells and juggling, the effects. */
  drawOver(world: World, clock: number, R: number, sees: (p: { x: number; y: number }, margin: number) => boolean): void {
    const g = this.overG.clear(), U = this.unit, sh = this.shown;
    sh.crossLight = 0; sh.crossSpin = 0; sh.fires = 0; sh.arrows = 0; sh.chandelier = 0; sh.chandelierArt = 0; sh.stars = 0; sh.starsHanging = 0;
    sh.bellsLit = 0; sh.bells = 0; sh.juggling = 0; sh.balls = 0; sh.ballsBack = 0; sh.stunned = 0;
    for (const e of world.enemies) {
      if (!sees(e, 7)) continue;
      const X = e.x * U, Y = e.y * U;
      if (e.kind === CANDELABRA) {
        const cross = candelabraCross(world, e);
        if (!cross) continue;
        if (cross.phase === 'light') { sh.crossLight++; turnArrow(g, X, Y + R * 0.75, R * 1.2, cross.dir, cross.progress); sh.arrows++; }
        else sh.crossSpin++;
        cross.fires.forEach((f, i) => {
          const fx = f.x * U, fy = f.y * U;
          if (cross.phase === 'spin') {
            // A short trail behind each fire, against its turn.
            const ax = fx - X, ay = fy - Y, d = Math.hypot(ax, ay) || 1, tx = -ay / d * cross.dir, ty = ax / d * cross.dir;
            g.moveTo(fx, fy).lineTo(fx - tx * R * 0.6, fy - ty * R * 0.6).stroke({ color: EMBER, width: cross.radius * U * 1.6, alpha: 0.35, cap: 'round' });
          }
          fire(g, fx, fy, cross.radius * U, clock, i + e.id);
          sh.fires++;
        });
      } else if (e.kind === JESTER) {
        const st = jesterState(world, e);
        if (!st) continue;
        // Bells on the cap: lit ones gold, spent ones grey.
        const top = Y - R * 1.75;
        for (let i = 0; i < st.bells; i++) {
          const bx = X + (i - (st.bells - 1) / 2) * R * 0.45, lit = i < st.lit;
          g.circle(bx, top, R * 0.15).fill(lit ? GOLD : 0x6f7480).stroke({ color: NAVY, width: 2 });
          sh.bells++; if (lit) sh.bellsLit++;
        }
        if (st.windup !== null) {
          // Juggling: three balls turning over his hands.
          sh.juggling = 1;
          for (let i = 0; i < 3; i++) {
            const a = clock * 9 + i * Math.PI * 2 / 3, bx = X + Math.cos(a) * R * 0.7, by = Y - R * 1.1 + Math.sin(a) * R * 0.45;
            g.circle(bx, by, R * 0.16).fill(i === 0 ? BALL : i === 1 ? GOLD : PALE).stroke({ color: NAVY, width: 1.5 });
          }
        }
        if (st.stunned !== null) { sh.stunned++; stunStars(g, X, Y - R * 1.25, R, clock); }
      }
    }
    for (const s of liveShots(world)) {
      if (!sees(s, 1)) continue;
      if (s.kind === 'star') { drawStar(g, s, clock, U); sh.stars++; if (s.hang > 0) sh.starsHanging++; }
      else if (s.kind === 'ball') { drawBall(g, s, clock, U); sh.balls++; if (s.back) sh.ballsBack++; }
    }
    const ch = liveChandelier(world);
    if (ch && sees(ch, 4)) {
      sh.chandelier = 1;
      const shake = ch.fall ? Math.sin(clock * 50) * R * 0.12 : 0, x = ch.x * U + shake, y = (ch.y - CHANDELIER_LIFT) * U;
      if (hasCharacterArt('castle-chandelier')) {
        const sprite = this.chandelierSprite ??= (() => { const sp = characterSprite('castle-chandelier', R * CHANDELIER_ART, R * CHANDELIER_ART); if (sp) this.layer.addChild(sp); return sp; })();
        if (sprite) { sprite.position.set(x, y); sprite.visible = true; sh.chandelierArt = 1; }
      } else drawChandelier(g, x, y, R, clock);
    } else if (this.chandelierSprite) this.chandelierSprite.visible = false;
    // Effects.
    this.bursts = this.bursts.filter(b => clock - b.born < b.life);
    for (const b of this.bursts) {
      const k = 1 - (clock - b.born) / b.life, x = b.x * U, y = b.y * U;
      if (b.kind === 'crash') {
        g.circle(x, y, R * (1 + 2.5 * (1 - k))).fill({ color: FLAME, alpha: 0.35 * k });
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + 0.3, d = R * (0.6 + 2.2 * (1 - k));
          g.poly([x + Math.cos(a) * d, y + Math.sin(a) * d, x + Math.cos(a + 0.2) * (d + R * 0.35), y + Math.sin(a + 0.2) * (d + R * 0.35), x + Math.cos(a - 0.15) * (d + R * 0.25), y + Math.sin(a - 0.15) * (d + R * 0.25)]).fill({ color: 0xcfe6ff, alpha: k }).stroke({ color: NAVY, width: 1.5, alpha: k });
        }
      } else if (b.kind === 'topple') g.circle(x, y, R * (0.8 + 1.5 * (1 - k))).fill({ color: EMBER, alpha: 0.4 * k });
      else if (b.kind === 'drop') g.circle(x, y, 0.6 * U * (0.6 + 0.5 * (1 - k))).fill({ color: PALE, alpha: 0.5 * k }).stroke({ color: NAVY, width: 2, alpha: k });
      else if (b.kind === 'land') g.ellipse(x, y + R * 0.4, R * (1 + 1.5 * (1 - k)), R * 0.4 * (1 + (1 - k))).fill({ color: 0xc8b48c, alpha: 0.5 * k });
      else if (b.kind === 'catch') g.circle(x, y - R * 1.75, R * (0.3 + 0.6 * (1 - k))).stroke({ color: GOLD, width: 4, alpha: k });
      else if (b.kind === 'miss') g.circle(x, y - R, R * (0.6 + 1.4 * (1 - k))).stroke({ color: THREAT, width: 5, alpha: k });
      else g.circle(x, y, R * (0.3 + 0.5 * (1 - k))).fill({ color: THREAT, alpha: 0.5 * k });
    }
  }

  /**
   * The drawn chain's signs (`g` — the chain layer; px): the candelabra's topple (the fall's strip with the fire's hatching, a cross on each body
   * it crushes), the reflects (the ball's way back to its jester; a miss — a burst mark at him), the chandelier's fall (its ring r 1.0).
   */
  drawPlan(g: Graphics, world: World, plan: Pick<ChainPlan, 'shove' | 'reflects' | 'chandelierFall'>, clock: number, R: number): void {
    const U = this.unit, sh = this.shown;
    const topple = plan.shove?.topple;
    if (topple) {
      const x0 = topple.from.x * U, y0 = topple.from.y * U, x1 = topple.to.x * U, y1 = topple.to.y * U, len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux, h = topple.half * U;
      const quad = [x0 + nx * h, y0 + ny * h, x1 + nx * h, y1 + ny * h, x1 - nx * h, y1 - ny * h, x0 - nx * h, y0 - ny * h];
      g.poly(quad).fill({ color: EMBER, alpha: 0.22 });
      const step = 0.3 * U;
      for (let t = 0; t < len; t += step) g.moveTo(x0 + ux * t + nx * h, y0 + uy * t + ny * h).lineTo(x0 + ux * Math.min(len, t + step) - nx * h, y0 + uy * Math.min(len, t + step) - ny * h);
      g.stroke({ color: EMBER, width: 2.5, alpha: 0.8 });
      g.poly(quad).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).poly(quad).stroke({ color: FLAME, width: 2, alpha: 0.95 });
      sh.planTopple = 1;
      for (const id of topple.crushed) {
        const e = world.enemies.find(x => x.id === id);
        if (!e) continue;
        const cx = e.x * U - R * 0.7, cy = e.y * U - R * 0.75, s = R * 0.2;
        g.circle(cx, cy, R * 0.32).fill(0xf4efe0).stroke({ color: NAVY, width: 2 });
        g.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s).moveTo(cx + s, cy - s).lineTo(cx - s, cy + s).stroke({ color: 0xa8322a, width: 3, cap: 'round' });
        sh.planCrushed++;
      }
    }
    for (const r of plan.reflects ?? []) {
      const x0 = r.x0 * U, y0 = r.y0 * U, x1 = r.x1 * U, y1 = r.y1 * U;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: NAVY, width: 6, alpha: 0.6, cap: 'round' });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: PALE, width: 3, cap: 'round' });
      sh.planReflects++;
      if (r.miss) {
        // The miss: a burst at the jester (he will be stunned).
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, d0 = R * 0.5, d1 = R * (i % 2 ? 0.85 : 1.1); g.moveTo(x1 + Math.cos(a) * d0, y1 + Math.sin(a) * d0).lineTo(x1 + Math.cos(a) * d1, y1 + Math.sin(a) * d1); }
        g.stroke({ color: THREAT, width: 3, cap: 'round' });
        sh.planMisses++;
      }
    }
    if (plan.chandelierFall) {
      const f = plan.chandelierFall;
      threatCircle(g, f.x * U, f.y * U, f.radius * U, 0);
      sh.planFall = 1;
    }
    void clock;
  }

  /** The guests' events: bursts (a topple, a crash, a drop, a landing, a catch, a miss). True — the event was the guests'. */
  onEvent(ev: WorldEvent, clock: number): boolean {
    const sh = this.shown, at = (kind: Burst, x: number, y: number, life: number): void => { this.bursts.push({ kind, x, y, born: clock, life }); };
    if (ev.type === 'candelabra') { if (ev.action === 'topple') { sh.topples++; at('topple', ev.x, ev.y, 0.5); } return true; }
    if (ev.type === 'queen') { if (ev.action === 'shot') at('star', ev.x, ev.y, 0.25); return true; }
    if (ev.type === 'chandelier') {
      if (ev.action === 'crash') { sh.crashes++; at('crash', ev.x, ev.y, 0.5); }
      else if (ev.action === 'drop' && ev.stage === 'land') { sh.drops++; at('drop', ev.x, ev.y, 0.35); }
      return true;
    }
    if (ev.type === 'poltergeist') { if (ev.action === 'land' || ev.action === 'drop') { sh.lands++; at('land', ev.x1 ?? ev.x, ev.y1 ?? ev.y, 0.4); } return true; }
    if (ev.type === 'jester') {
      if (ev.action === 'catch') { sh.catches++; at('catch', ev.x, ev.y, 0.4); }
      else if (ev.action === 'miss') { sh.misses++; at('miss', ev.x, ev.y, 0.45); }
      return true;
    }
    return false;
  }
}
