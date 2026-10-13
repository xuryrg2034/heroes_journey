/**
 * The prologue «Опушка», the drawing and the DOM (task 6, step 4; docs/realtime-onboarding.md, «Пролог: вид и поток»): the lamps over
 * the door, the ghost hand, the arrow and the blinking circle, the smoke of the enemies' return (Pixi, in the arena's pixels), and the
 * room's name, the corner button «Пропустить обучение» and the fade between rooms (DOM). A view feature only: nothing here is read
 * by the simulation; no command is sent.
 */
import { Container, Graphics } from 'pixi.js';
import type { Vec } from '../sim/geometry';
import { UNIT } from './render';
import { handFrame, lampPoints, type HandGuide } from './prologueFlow';

const NAVY = 0x14213d;
const GOLD = 0xffd36b;

/** Real seconds a puff of smoke lives. */
const SMOKE_LIFE = 0.75;
/** Puffs of one return. */
const SMOKE_PUFFS = 6;
/** Task 13: real seconds a spark flies from the hero to a lamp it lit. */
const LAMP_SPARK_LIFE = 0.45;

/** What the layer drew in the last frame (the tests read it through `snapshot().prologue`). */
export interface PrologueShown {
  lampsLit: number;
  lampsTotal: number;
  hand: boolean;
  /** Links the hand has drawn so far in this loop. */
  handLinks: number;
  arrow: boolean;
  circle: Vec | null;
  /** Puffs of smoke started so far / alive now. */
  smokesStarted: number;
  smokesAlive: number;
  /** Task 13: sparks flown from the hero to a lamp so far / in flight now. */
  lampSparks: number;
  lampSparksAlive: number;
}

/** What `draw` takes from the page each frame. */
export interface PrologueScene {
  lamps: { lit: number; total: number } | null;
  door: Vec;
  arena: { width: number; height: number };
  hero: Vec;
  guide: HandGuide | null;
  /** The positions of the hand's links (arena units), in order; empty — no hand. */
  handPoints: readonly Vec[];
  /** Task 13 «Щит»: a lamp that lights sends a spark from the hero to it (the rooms whose lamps light and go out with each chain do not). */
  lampSpark?: boolean;
}

export class PrologueLayer {
  /** Added to the renderer's root (arena pixels) over the heroes and under the floating texts. */
  readonly layer = new Container();
  private readonly lamps = new Graphics();
  private readonly guide = new Graphics();
  private readonly hand = new Graphics();
  private readonly smoke = new Graphics();
  private clock = 0;
  private handTime = 0;
  private handKey = '';
  private smokes: { x: number; y: number; life: number; seed: number }[] = [];
  private started = 0;
  /** Task 13: lamps lit last frame (−1 — none seen yet in this room), the sparks in flight (from — arena units, lamp — its index). */
  private litBefore = -1;
  private lampSparks: { from: Vec; lamp: number; life: number }[] = [];
  private readonly sparkLayer = new Graphics();
  readonly shown: PrologueShown = { lampsLit: 0, lampsTotal: 0, hand: false, handLinks: 0, arrow: false, circle: null, smokesStarted: 0, smokesAlive: 0, lampSparks: 0, lampSparksAlive: 0 };

  constructor() {
    this.layer.addChild(this.lamps, this.guide, this.hand, this.smoke, this.sparkLayer);
    this.drawHandShape();
  }

  /** A new room: nothing is left of the last one. */
  reset(): void {
    this.smokes = []; this.started = 0; this.handTime = 0; this.handKey = ''; this.litBefore = -1; this.lampSparks = [];
    this.lamps.clear(); this.guide.clear(); this.smoke.clear(); this.sparkLayer.clear(); this.hand.visible = false;
    Object.assign(this.shown, { lampsLit: 0, lampsTotal: 0, hand: false, handLinks: 0, arrow: false, circle: null, smokesStarted: 0, smokesAlive: 0, lampSparks: 0, lampSparksAlive: 0 });
  }

  /** Smoke at an arena point (an enemy that came back, the hero put back). */
  puff(p: Vec): void {
    this.smokes.push({ x: p.x, y: p.y, life: SMOKE_LIFE, seed: this.started * 7 + 3 });
    this.started++;
  }

  /** The hand's shape with the fingertip at the origin (arena pixels), drawn once. */
  private drawHandShape(): void {
    const g = this.hand;
    g.clear();
    const fill = 0xf6ecd2, line = NAVY;
    // Index finger, palm, thumb: rounded boxes, a pointing cursor-hand.
    g.roundRect(-6, 0, 12, 30, 6).fill(fill).stroke({ color: line, width: 2.5 });
    g.roundRect(-16, 20, 34, 30, 9).fill(fill).stroke({ color: line, width: 2.5 });
    g.roundRect(-26, 28, 13, 18, 6.5).fill(fill).stroke({ color: line, width: 2.5 });
    g.roundRect(-5, 22, 10, 14, 5).fill(fill);
    this.hand.visible = false;
  }

  /** One frame: `dt` real seconds while the room is live. */
  draw(dt: number, s: PrologueScene): void {
    this.clock += dt;
    this.drawLamps(s);
    this.drawLampSparks(dt, s);
    this.drawGuide(dt, s);
    this.drawSmoke(dt);
  }

  /**
   * Task 13 «Щит» (design 13.10.2026): each lamp the room lights sends a spark from where the hero stands to it — a bright head with
   * a short tail along a low arc; the lamp is drawn lit at once (the spark points the eye at it).
   */
  private drawLampSparks(dt: number, s: PrologueScene): void {
    const g = this.sparkLayer, lit = s.lamps?.lit ?? 0, total = s.lamps?.total ?? 0;
    if (s.lampSpark && this.litBefore >= 0) for (let i = this.litBefore; i < Math.min(lit, total); i++) {
      this.lampSparks.push({ from: { x: s.hero.x, y: s.hero.y }, lamp: i, life: LAMP_SPARK_LIFE });
      this.shown.lampSparks++;
    }
    this.litBefore = lit;
    g.clear();
    const points = total > 0 ? lampPoints(s.door, s.arena, total) : [];
    this.lampSparks = this.lampSparks.filter(sp => (sp.life -= dt) > 0 && !!points[sp.lamp]);
    this.shown.lampSparksAlive = this.lampSparks.length;
    for (const sp of this.lampSparks) {
      const to = points[sp.lamp], k = 1 - sp.life / LAMP_SPARK_LIFE;
      const at = (t: number): Vec => {
        // A low arc: the straight line lifted by a parabola (arena units).
        const lift = Math.min(1.5, 0.25 * Math.hypot(to.x - sp.from.x, to.y - sp.from.y)) * 4 * t * (1 - t);
        return { x: sp.from.x + (to.x - sp.from.x) * t, y: sp.from.y + (to.y - sp.from.y) * t - lift };
      };
      const head = at(k), tail = at(Math.max(0, k - 0.18));
      g.moveTo(tail.x * UNIT, tail.y * UNIT).lineTo(head.x * UNIT, head.y * UNIT).stroke({ color: GOLD, width: 5, alpha: 0.8, cap: 'round' });
      g.circle(head.x * UNIT, head.y * UNIT, 7).fill(0xfff2c4).stroke({ color: NAVY, width: 2 });
    }
  }

  private drawLamps(s: PrologueScene): void {
    const g = this.lamps;
    g.clear();
    const lamps = s.lamps;
    this.shown.lampsLit = lamps?.lit ?? 0; this.shown.lampsTotal = lamps?.total ?? 0;
    if (!lamps || lamps.total <= 0) return;
    const points = lampPoints(s.door, s.arena, lamps.total);
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 5);
    points.forEach((p, i) => {
      const x = p.x * UNIT, y = p.y * UNIT;
      if (i < lamps.lit) {
        // Burning: bright, with a halo.
        g.circle(x, y, 26).fill({ color: GOLD, alpha: 0.22 + 0.12 * pulse });
        g.circle(x, y, 14).fill(0xfff2c4).stroke({ color: 0xe0a62e, width: 3.5 });
      } else {
        // Waiting: a dark fill with a light rim (a place to light, not a hole).
        g.circle(x, y, 14).fill(0x2b2519).stroke({ color: 0xd9cba0, width: 3.5 });
      }
    });
  }

  private drawGuide(dt: number, s: PrologueScene): void {
    const g = this.guide, guide = s.guide;
    g.clear();
    this.shown.hand = false; this.shown.arrow = false; this.shown.circle = guide?.circle ? { ...guide.circle } : null; this.shown.handLinks = 0;
    if (!guide) { this.hand.visible = false; return; }
    const circle = guide.circle;
    if (circle) {
      // The blinking circle: a ring and a faint disc at the spot.
      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.clock * 6));
      const x = circle.x * UNIT, y = circle.y * UNIT;
      g.circle(x, y, 0.5 * UNIT).fill({ color: GOLD, alpha: 0.12 * blink });
      g.circle(x, y, 0.5 * UNIT).stroke({ color: GOLD, width: 4, alpha: 0.85 * blink });
    }
    if (guide.arrow && circle) {
      // The pale arrow from the hero towards the circle (no text).
      const dx = circle.x - s.hero.x, dy = circle.y - s.hero.y, len = Math.hypot(dx, dy);
      if (len > 1.3) {
        const ux = dx / len, uy = dy / len, from = 0.85, to = Math.min(len - 0.55, from + 1.5);
        const ax = (s.hero.x + ux * from) * UNIT, ay = (s.hero.y + uy * from) * UNIT, bx = (s.hero.x + ux * to) * UNIT, by = (s.hero.y + uy * to) * UNIT;
        const alpha = 0.45 + 0.2 * Math.sin(this.clock * 4), head = 16, nx = -uy, ny = ux;
        g.moveTo(ax, ay).lineTo(bx - ux * head * 0.6, by - uy * head * 0.6).stroke({ color: 0xe9f3ff, width: 7, alpha, cap: 'round' });
        g.poly([bx, by, bx - ux * head + nx * head * 0.7, by - uy * head + ny * head * 0.7, bx - ux * head - nx * head * 0.7, by - uy * head - ny * head * 0.7]).fill({ color: 0xe9f3ff, alpha });
        this.shown.arrow = true;
      }
    }
    const points = guide.show === 'hand' ? s.handPoints : [];
    if (!points.length) { this.hand.visible = false; this.handKey = ''; this.handTime = 0; return; }
    // The loop restarts when the route changes.
    const key = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';');
    if (key !== this.handKey) { this.handKey = key; this.handTime = 0; }
    this.handTime += dt;
    const f = handFrame(points, this.handTime);
    // The line drawn so far, the rings on the links passed, the press ring under the fingertip.
    if (f.trail.length > 1) {
      g.moveTo(f.trail[0].x * UNIT, f.trail[0].y * UNIT);
      for (let i = 1; i < f.trail.length; i++) g.lineTo(f.trail[i].x * UNIT, f.trail[i].y * UNIT);
      g.stroke({ color: GOLD, width: 7, alpha: 0.5 * f.alpha, cap: 'round', join: 'round' });
    }
    for (let i = 0; i < Math.min(f.links, points.length); i++) g.circle(points[i].x * UNIT, points[i].y * UNIT, 0.42 * UNIT).stroke({ color: GOLD, width: 3, alpha: 0.6 * f.alpha });
    if (f.pressed) g.circle(f.pos.x * UNIT, f.pos.y * UNIT, (0.18 + 0.06 * Math.sin(this.clock * 10)) * UNIT).stroke({ color: 0xfff2c4, width: 3, alpha: 0.8 * f.alpha });
    this.hand.visible = true;
    this.hand.alpha = 0.6 * f.alpha;
    this.hand.position.set(f.pos.x * UNIT, f.pos.y * UNIT);
    this.hand.scale.set(f.pressed ? 0.95 : 1.1);
    this.shown.hand = true; this.shown.handLinks = f.links;
  }

  private drawSmoke(dt: number): void {
    const g = this.smoke;
    g.clear();
    for (const sm of this.smokes) sm.life -= dt;
    this.smokes = this.smokes.filter(sm => sm.life > 0);
    for (const sm of this.smokes) {
      const k = 1 - sm.life / SMOKE_LIFE;
      for (let i = 0; i < SMOKE_PUFFS; i++) {
        // A fixed fan of puffs per smoke (no random draw): index and seed decide the direction, they drift up and widen.
        const a = (i / SMOKE_PUFFS) * Math.PI * 2 + sm.seed, r = (0.2 + 0.45 * k) * UNIT * (0.6 + 0.4 * ((i * 5 + sm.seed) % 3) / 2);
        g.circle(sm.x * UNIT + Math.cos(a) * r, sm.y * UNIT + Math.sin(a) * r * 0.7 - k * 0.5 * UNIT, (0.16 + 0.22 * k) * UNIT).fill({ color: 0xd9d6c4, alpha: 0.5 * (1 - k) });
      }
    }
    this.shown.smokesStarted = this.started; this.shown.smokesAlive = this.smokes.length;
  }
}

/** The DOM of the prologue: the room's name (big, at the start), the corner button, the fade between rooms. */
export class PrologueDom {
  readonly title = document.createElement('div');
  readonly skip = document.createElement('button');
  readonly fade = document.createElement('div');

  constructor() {
    this.title.className = 'rt-prologue-title';
    this.title.setAttribute('data-testid', 'prologue-title');
    this.title.hidden = true;
    this.skip.className = 'rt-prologue-skip';
    this.skip.type = 'button';
    this.skip.setAttribute('data-testid', 'prologue-skip');
    this.skip.textContent = 'Пропустить обучение';
    this.skip.hidden = true;
    // A focused button would be clicked again by Space (the jump key).
    this.skip.addEventListener('click', () => this.skip.blur());
    this.fade.className = 'rt-prologue-fade';
    this.fade.setAttribute('data-testid', 'prologue-fade');
    this.fade.style.opacity = '0';
  }

  /** The three elements for `host.append`. */
  get elements(): HTMLElement[] { return [this.title, this.skip, this.fade]; }

  showTitle(text: string): void { this.title.textContent = text; this.title.style.opacity = '1'; this.title.hidden = false; }
  hideTitle(): void { this.title.hidden = true; }
  setFade(opacity: number): void { this.fade.style.opacity = String(Math.max(0, Math.min(1, opacity))); }
}
