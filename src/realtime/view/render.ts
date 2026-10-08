/**
 * PixiJS view of the real-time arena (src/realtime/view). Reads the simulation's world, never changes it.
 * Terrain and the hero reuse the art of the main game (drawTerrain, makePlayer);
 * enemies are colored discs with the chain sigil (or the melee illustration),
 * which keeps 60+ enemies cheap: each disc is a sprite of one pre-rendered texture per color.
 * Stage 3: wolf ears and pack lines, boar tusks with the charge lane (threat color, hatched)
 * and «!», target reticles of marked enemies, buttons and the door.
 * Stage 2 of the transition, step 2 (docs/realtime-slice.md, section 4): the signals of the new enemies — the shield
 * arc of the shieldbearer, the archer's line (`drawSignals`).
 */
import { Application, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from 'pixi.js';
import { COLORS, PALE, drawTerrain, makePlayer } from '../../render/art';
import { characterSprite } from '../../render/characterAssets';
import type { ArenaLayout } from '../sim/arenas';
import { OBJECT_RADIUS, canJump, chainAnchor, chainColor, jumpLanding, linkPoint, nextCandidates, nextObjectCandidates, planChain } from '../sim/chain';
import { BOAR_ART_SCALE, archerLine, shieldUp } from '../sim/enemies/index';
import { inWater, type Vec } from '../sim/geometry';
import { enemyBodyRadius, enemyDrawRadius, heroRadius, type EnemyLook } from '../sim/params';
import { NO_COLOR, doorOpen, touchDistance, type Enemy, type EnemyKind, type World } from '../sim/world';

/** Input state the view shows (pointer line, jump aim); owned by main.ts. */
export interface RenderUi {
  pointer: Vec | null;
  jumpMode: boolean;
}

/** Grey of the same lightness: the desaturated variant of a chain color. */
function greyOf(color: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const l = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return (l << 16) | (l << 8) | l;
}

/** Pixels per arena unit before fitting to the window (one board cell of the main game). */
export const UNIT = 72;
/** Threat color outside the chain palette (design answer 18): white with a dark outline — spawn markers, stage 3 boar lanes. */
export const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const REAPER_FILL = 0x1b1b24;
const NAVY = 0x18232d;
const BASE_ENEMY_RADIUS = 0.4;
/** Boar art is drawn a bit larger than the crowd (its body circle stays the same); the link reach uses the same scale. */
const BOAR_SCALE = BOAR_ART_SCALE;
const BONE = 0xeadbb9;
/** Target reticle of marked enemies: warm gold, outside the chain sigils. */
const TARGET = 0xffd36b;
/** Shield of the shieldbearer: cold steel with a pale rim (outside the chain palette). */
const STEEL = 0xa9b8c6;

/** Signals of the new enemies drawn in the last frame (tests read them: the signal is on screen). */
export interface SignalCounts { shields: number; arrowLanes: number }

interface EnemyView {
  root: Container;
  body: Container;
  /** Boar: «!» over it while the charge is announced. */
  exclaim: Text | null;
  /** Grey copy of the disc over the colored one: desaturation by its alpha. */
  grey: Sprite | null;
  hpLabel: Text | null;
  hp: number;
  look: EnemyLook;
}

/** A killed enemy: spins and shrinks for `deathDuration` (design answer 22). */
interface DyingView { root: Container; life: number; total: number; spin: number; scale: number }

interface FloatingText { text: Text; life: number; vy: number }

function drawSigil(g: GraphicsContext, color: number, size: number, ink: number, y = 0): void {
  const s = size;
  if (color === 0) g.poly([0, y - s, s * 0.95, y + s * 0.75, -s * 0.95, y + s * 0.75]).fill(ink);
  else if (color === 1) g.rect(-s * 0.3, y - s, s * 0.6, s * 2).rect(-s, y - s * 0.3, s * 2, s * 0.6).fill(ink);
  else if (color === 2) g.rect(-s * 0.8, y - s * 0.8, s * 1.6, s * 1.6).stroke({ color: ink, width: s * 0.4 });
  else g.circle(0, y, s * 0.8).stroke({ color: ink, width: s * 0.4 });
}

export class RealtimeRenderer {
  readonly app = new Application();
  private readonly root = new Container();
  /** Floor and obstacles never change during a fight: drawn once into a cached texture. */
  private readonly staticLayer = new Container();
  private readonly floor = new Graphics();
  private readonly terrain = new Graphics();
  private readonly markerLayer = new Graphics();
  /** Buttons and the door (under the crowd). */
  private readonly objectLayer = new Graphics();
  /** Boar lanes and wolf pack lines (under the crowd). */
  private readonly laneLayer = new Graphics();
  /** Ripples around bodies wading in the pond (iteration 2, stage B; under the crowd). */
  private readonly rippleLayer = new Graphics();
  /** Target reticles of marked enemies (over the crowd). */
  private readonly targetLayer = new Graphics();
  /** Stage 2, step 2: signals of the new enemies over the crowd (shield arcs). */
  private readonly signalLayer = new Graphics();
  private readonly enemyLayer = new Container();
  private readonly heroLayer = new Container();
  private readonly overlay = new Graphics();
  /** Chain lines, link highlights, candidate outlines, jump aim. */
  private readonly chainLayer = new Graphics();
  private readonly dying: DyingView[] = [];
  private readonly fxLayer = new Container();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly bodyTextures = new Map<string, { texture: Texture; ax: number; ay: number }>();
  private readonly floating: FloatingText[] = [];
  private heroArt: Container | null = null;
  private readonly heroRing = new Graphics();
  private arena: ArenaLayout | null = null;
  private clock = 0;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAmp = 0;
  private readonly base = { x: 0, y: 0 };
  /** Boar lanes drawn in the last frame (tests read it: the announcement is on screen). */
  visibleLanes = 0;
  /** Wolf pack lines drawn in the last frame. */
  visiblePackLines = 0;
  /** Bodies drawn with water ripples in the last frame. */
  visibleRipples = 0;
  /** Stage C: the combo counter over the hero (kills of the dash), its fade after the dash, the finisher flash. */
  private comboText: Text | null = null;
  private comboLife = 0;
  private comboValue = 0;
  private readonly flash = new Graphics();
  private flashLeft = 0;
  private flashTotal = 0;
  /** Largest combo number shown so far (tests read it: the counter was on screen). */
  comboShown = 0;
  /** Stage D: circles of the link radius R drawn in the last frame — around the hero always, plus the last link in a chain. */
  visibleReachCircles = 0;
  /** Stage D: the R circle around the hero was drawn in the last frame. */
  heroReachShown = false;
  /** Stage G: in a chain the hero's R circle is drawn as a second anchor (chain color) in the last frame. */
  heroAnchorShown = false;
  /** Stage 2, step 2: signals of the new enemies in the last frame. */
  readonly signals: SignalCounts = { shields: 0, arrowLanes: 0 };

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: 0x10150f,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    host.appendChild(this.app.canvas);
    this.staticLayer.addChild(this.floor, this.terrain);
    this.root.addChild(this.staticLayer, this.objectLayer, this.markerLayer, this.laneLayer, this.rippleLayer, this.enemyLayer, this.signalLayer, this.targetLayer, this.chainLayer, this.heroLayer, this.overlay, this.fxLayer, this.flash);
    this.app.stage.addChild(this.root);
    this.heroArt = makePlayer();
    this.heroLayer.addChild(this.heroRing, this.heroArt);
    this.comboText = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 46, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: 0x200c08, width: 7 } } });
    this.comboText.anchor.set(0.5, 1);
    this.comboText.visible = false;
    this.root.addChild(this.comboText);
  }

  /**
   * Stage C juice: the combo counter «×N» big over the hero while the dash kills (toggle), held and faded
   * after the dash; the finisher flash over the arena.
   */
  private drawJuice(world: World, dt: number): void {
    const text = this.comboText;
    if (text) {
      const dashing = world.move?.kind === 'dash';
      const kills = dashing ? world.move!.kills : world.lastChain?.kills ?? 0;
      if (!dashing) this.comboLife = Math.max(0, this.comboLife - dt);
      const show = world.params.comboCounter && kills > 0 && (dashing || this.comboLife > 0);
      text.visible = show;
      if (show) {
        if (kills !== this.comboValue) { this.comboValue = kills; text.text = `×${kills}`; text.scale.set(1.35); }
        this.comboShown = Math.max(this.comboShown, kills);
        const s = Math.max(1, text.scale.x - dt * 3);
        text.scale.set(s);
        text.position.set(world.hero.x * UNIT, world.hero.y * UNIT - 52);
        text.alpha = dashing ? 1 : Math.min(1, this.comboLife / 0.4);
        text.style.fill = kills >= world.params.finisherLinks ? 0xffd36b : 0xfff2c4;
      } else this.comboValue = 0;
    }
    const g = this.flash.clear();
    if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - dt);
      const a = this.flashTotal > 0 ? this.flashLeft / this.flashTotal : 0;
      g.rect(0, 0, world.arena.width * UNIT, world.arena.height * UNIT).fill({ color: 0xffffff, alpha: 0.45 * a });
    }
  }

  /** Fits the arena into the free part of the canvas (the debug panel may cover the right side). */
  layout(freeWidth: number, height: number): void {
    if (!this.arena) return;
    const margin = 12, w = this.arena.width * UNIT, h = this.arena.height * UNIT;
    const scale = Math.max(0.1, Math.min((freeWidth - margin * 2) / w, (height - margin * 2) / h));
    this.root.scale.set(scale);
    this.base.x = Math.round((freeWidth - w * scale) / 2); this.base.y = Math.round((height - h * scale) / 2);
    this.root.position.set(this.base.x, this.base.y);
  }

  /** Screen position of an arena point (tests and stage 2 input use the inverse). */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.root.position.x + x * UNIT * this.root.scale.x, y: this.root.position.y + y * UNIT * this.root.scale.y };
  }

  toArena(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.root.position.x) / (UNIT * this.root.scale.x), y: (sy - this.root.position.y) / (UNIT * this.root.scale.y) };
  }

  buildArena(arena: ArenaLayout): void {
    this.arena = arena;
    const f = this.floor.clear(), w = arena.width * UNIT, h = arena.height * UNIT;
    f.rect(0, 0, w, h).fill(0x1b2617);
    for (let y = 0; y < arena.height; y++) for (let x = 0; x < arena.width; x++)
      if ((x + y) % 2 === 0) f.rect(x * UNIT, y * UNIT, UNIT, UNIT).fill({ color: 0x223020, alpha: 0.7 });
    for (let x = 1; x < arena.width; x++) f.moveTo(x * UNIT, 0).lineTo(x * UNIT, h);
    for (let y = 1; y < arena.height; y++) f.moveTo(0, y * UNIT).lineTo(w, y * UNIT);
    f.stroke({ color: 0x2e3d29, width: 1, alpha: 0.6 });
    f.rect(-4, -4, w + 8, h + 8).stroke({ color: 0x5a5a40, width: 6 });
    const t = this.terrain.clear();
    for (const o of arena.obstacles) {
      if (o.shape === 'rect') {
        for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) drawTerrain(t, 'wall', (o.x + x + 0.5) * UNIT, (o.y + y + 0.5) * UNIT);
      } else if (o.kind === 'tree') {
        drawTerrain(t, 'tree', o.x * UNIT, o.y * UNIT);
      } else {
        const cx = o.x * UNIT, cy = o.y * UNIT, r = o.r * UNIT;
        t.circle(cx, cy, r).fill(0x243c3d).stroke({ color: 0x73918a, width: 3, alpha: 0.6 });
        t.circle(cx + r * 0.08, cy - r * 0.05, r * 0.72).fill({ color: 0x548b88, alpha: 0.3 });
        t.moveTo(cx - r * 0.55, cy).quadraticCurveTo(cx - r * 0.2, cy - r * 0.12, cx + r * 0.1, cy)
          .moveTo(cx - r * 0.15, cy + r * 0.35).quadraticCurveTo(cx + r * 0.15, cy + r * 0.25, cx + r * 0.5, cy + r * 0.35)
          .stroke({ color: 0x91b7ac, width: 1.5, alpha: 0.6 });
        for (let n = 0; n < 6; n++) { const a = n / 6 * Math.PI * 2 + 0.3; t.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7, 4).fill(0x78806b); }
      }
    }
    this.staticLayer.cacheAsTexture(false);
    this.staticLayer.cacheAsTexture({ resolution: Math.min(window.devicePixelRatio || 1, 2), antialias: true });
  }

  /** Disc sprite of an enemy: vector art rendered once per (look, color, tough, kind) into a texture. */
  private enemyDisc(color: number, tough: boolean, kind: EnemyKind, look: EnemyLook, grey = false): Sprite {
    const key = `${look}-${color}-${tough ? 1 : 0}-${kind}${grey ? '-grey' : ''}`;
    let entry = this.bodyTextures.get(key);
    if (!entry) {
      const g = new Graphics(this.enemyContext(color, tough, kind, look, grey)), b = g.getLocalBounds();
      const texture = this.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
      entry = { texture, ax: -b.minX / b.width, ay: -b.minY / b.height };
      this.bodyTextures.set(key, entry);
      g.destroy(true);
    }
    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.ax, entry.ay);
    return sprite;
  }

  private enemyContext(color: number, tough: boolean, kind: EnemyKind, look: EnemyLook, grey = false): GraphicsContext {
    const r = BASE_ENEMY_RADIUS * UNIT;
    const ctx = new GraphicsContext();
    ctx.ellipse(0, r * 0.8, r * 0.9, r * 0.32).fill({ color: 0x050a07, alpha: 0.45 });
    if (color === NO_COLOR) {
      // The reaper: dark, outside the palette, a white cross — cannot be chained.
      ctx.circle(0, 0, r * 1.1).fill(REAPER_FILL).stroke({ color: THREAT, width: 4 });
      const s = r * 0.45;
      ctx.moveTo(-s, -s).lineTo(s, s).moveTo(s, -s).lineTo(-s, s).stroke({ color: THREAT, width: 6, cap: 'round' });
      return ctx;
    }
    const fill = grey ? greyOf(COLORS[color]) : COLORS[color];
    if (kind === 'wolf') {
      // Wolf: two pointed ears and swept speed marks (silhouette, not a color).
      for (const dy of [-r * 0.45, r * 0.15]) ctx.poly([-r * 0.75, dy, -r * 1.35, dy - r * 0.18, -r * 1.2, dy + r * 0.1]).fill(PALE).stroke({ color: NAVY, width: 2 });
      for (const sx of [-1, 1]) ctx.poly([sx * r * 0.25, -r * 0.8, sx * r * 0.62, -r * 1.42, sx * r * 0.85, -r * 0.55]).fill(fill).stroke({ color: NAVY, width: 3, join: 'round' });
    }
    if (kind === 'boar') {
      // Boar: a bristle ridge on top and two bone tusks below (silhouette, not a color).
      ctx.poly([-r * 0.55, -r * 0.78, -r * 0.35, -r * 1.25, -r * 0.12, -r * 0.88, r * 0.1, -r * 1.32, r * 0.3, -r * 0.88, r * 0.52, -r * 1.2, r * 0.62, -r * 0.7]).fill(NAVY);
    }
    if (kind === 'archer') {
      // Archer: a bow on its side with a taut string (silhouette, not a color).
      ctx.moveTo(r * 0.55, -r * 1.15).quadraticCurveTo(r * 1.55, 0, r * 0.55, r * 1.15).stroke({ color: NAVY, width: 7, cap: 'round' });
      ctx.moveTo(r * 0.55, -r * 1.15).quadraticCurveTo(r * 1.55, 0, r * 0.55, r * 1.15).stroke({ color: BONE, width: 3.5, cap: 'round' });
      ctx.moveTo(r * 0.55, -r * 1.15).lineTo(r * 0.55, r * 1.15).stroke({ color: PALE, width: 1.5 });
    }
    if (look === 'circle') {
      ctx.circle(0, 0, r).fill(fill).stroke({ color: NAVY, width: 3 });
      ctx.moveTo(Math.cos(Math.PI * 1.1) * r * 0.72, Math.sin(Math.PI * 1.1) * r * 0.72).arc(0, 0, r * 0.72, Math.PI * 1.1, Math.PI * 1.6).stroke({ color: 0xffffff, width: 3, alpha: 0.28 });
      if (tough) ctx.circle(0, 0, r - 5).stroke({ color: PALE, width: 2.5, alpha: 0.95 });
      drawSigil(ctx, color, r * 0.36, NAVY);
      if (kind === 'boar') this.tusks(ctx, r);
    } else {
      ctx.circle(0, 0, r).fill({ color: fill, alpha: 0.9 }).stroke({ color: NAVY, width: 3 });
      if (tough) ctx.circle(0, 0, r - 4).stroke({ color: PALE, width: 2.5, alpha: 0.95 });
      if (kind === 'boar') this.tusks(ctx, r);
    }
    return ctx;
  }

  private tusks(ctx: GraphicsContext, r: number): void {
    for (const sx of [-1, 1]) ctx.poly([sx * r * 0.32, r * 0.55, sx * r * 0.72, r * 0.98, sx * r * 0.78, r * 0.42, sx * r * 0.52, r * 0.5]).fill(BONE).stroke({ color: NAVY, width: 2.5, join: 'round' });
  }

  private buildEnemyBody(e: Enemy, look: EnemyLook): { body: Container; grey: Sprite | null; hpLabel: Text | null; exclaim: Text | null } {
    const body = new Container();
    body.addChild(this.enemyDisc(e.color, e.hp > 0, e.kind, look));
    let grey: Sprite | null = null;
    if (e.color !== NO_COLOR) { grey = this.enemyDisc(e.color, e.hp > 0, e.kind, look, true); grey.alpha = 0; body.addChild(grey); }
    const r = BASE_ENEMY_RADIUS * UNIT;
    if (look === 'sprite' && e.color !== NO_COLOR && e.kind === 'basic') {
      const sprite = characterSprite('melee', r * 1.75, r * 1.75);
      if (sprite) { sprite.position.set(0, -r * 0.08); body.addChild(sprite); }
      const plaque = new Graphics();
      plaque.circle(0, r * 0.62, r * 0.34).fill(COLORS[e.color]).stroke({ color: NAVY, width: 2 });
      drawSigil(plaque.context, e.color, r * 0.19, NAVY, r * 0.62);
      body.addChild(plaque);
    }
    let hpLabel: Text | null = null;
    if (e.hp > 0) {
      const badge = new Graphics().circle(r * 0.72, -r * 0.72, r * 0.36).fill(0x233039).stroke({ color: PALE, width: 2 });
      hpLabel = new Text({ text: String(e.hp), style: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 'bold', fill: PALE } });
      hpLabel.anchor.set(0.5); hpLabel.position.set(r * 0.72, -r * 0.72);
      body.addChild(badge, hpLabel);
    }
    let exclaim: Text | null = null;
    if (e.kind === 'boar') {
      exclaim = new Text({ text: '!', style: { fontFamily: 'Georgia, serif', fontSize: 40, fontWeight: 'bold', fill: THREAT, stroke: { color: THREAT_OUTLINE, width: 6 } } });
      exclaim.anchor.set(0.5, 1); exclaim.position.set(0, -r * 1.2); exclaim.visible = false;
      body.addChild(exclaim);
    }
    if (e.kind === 'boar') body.scale.set(BOAR_SCALE);
    return { body, grey, hpLabel, exclaim };
  }

  private syncEnemies(world: World): void {
    const look = world.params.enemyLook, seen = new Set<number>();
    const scale = enemyDrawRadius(world.params) / BASE_ENEMY_RADIUS;
    // Crowd readability (design answer 10): while a chain is drawn, other colors are muted.
    const color = world.chain.length ? chainColor(world) : null;
    const mode = world.params.dimMode, strength = world.params.dimStrength;
    for (const e of world.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (view && (view.look !== look || (view.hp > 0) !== (e.hp > 0))) { view.root.destroy({ children: true }); this.enemyViews.delete(e.id); view = undefined; }
      if (!view) {
        const root = new Container(), { body, grey, hpLabel, exclaim } = this.buildEnemyBody(e, look);
        root.addChild(body); this.enemyLayer.addChild(root);
        view = { root, body, grey, hpLabel, exclaim, hp: e.hp, look };
        this.enemyViews.set(e.id, view);
      }
      if (view.hpLabel && view.hp !== e.hp) { view.hpLabel.text = String(e.hp); view.hp = e.hp; }
      // Strike: a short lunge towards the hero.
      let ox = 0, oy = 0;
      if (e.strikeFlash > 0) {
        const dx = world.hero.x - e.x, dy = world.hero.y - e.y, d = Math.hypot(dx, dy) || 1, k = Math.sin(e.strikeFlash / 0.18 * Math.PI) * 0.12;
        ox = dx / d * k; oy = dy / d * k;
      }
      view.root.position.set((e.x + ox) * UNIT, (e.y + oy) * UNIT);
      const pop = Math.min(1, 0.35 + e.age / 0.2 * 0.65);
      view.root.scale.set(scale * pop);
      view.root.zIndex = e.y;
      const dim = color !== null && e.color !== color ? strength : 0;
      view.root.alpha = mode === 'alpha' ? 1 - dim : 1;
      const shade = Math.round(255 * (mode === 'darken' ? 1 - dim : 1));
      view.root.tint = (shade << 16) | (shade << 8) | shade;
      if (view.grey) view.grey.alpha = mode === 'desaturate' ? dim : 0;
      // Boar announcing a charge: «!» over it and blinking (design answer 29).
      const announcing = e.kind === 'boar' && e.boar === 'windup' && world.params.boarExclaim;
      if (view.exclaim) view.exclaim.visible = announcing;
      if (announcing && Math.floor(this.clock * 10) % 2 === 0) view.body.alpha = 0.55;
      else view.body.alpha = 1;
    }
    for (const [id, view] of this.enemyViews) if (!seen.has(id)) { view.root.destroy({ children: true }); this.enemyViews.delete(id); }
    this.enemyLayer.sortableChildren = true;
  }

  private drawMarkers(world: World): void {
    const g = this.markerLayer.clear(), r = enemyDrawRadius(world.params) * UNIT;
    for (const m of world.markers) {
      const x = m.x * UNIT, y = m.y * UNIT, k = m.total > 0 ? 1 - m.timeLeft / m.total : 1, s = r * 0.6;
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * 14);
      const rim = m.color === NO_COLOR ? THREAT : COLORS[m.color];
      // Rim in the color of the coming enemy, filling up as the countdown runs.
      g.circle(x, y, r * 0.95).stroke({ color: rim, width: 3, alpha: 0.35 });
      // moveTo first: otherwise the arc is joined by a line from the previous path point (the arena corner).
      g.moveTo(x, y - r * 0.95).arc(x, y, r * 0.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: rim, width: 4, alpha: 0.95 });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT_OUTLINE, width: 9, alpha: pulse, cap: 'round' });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT, width: 4.5, alpha: pulse, cap: 'round' });
    }
  }

  /**
   * Boar lanes (design answers 18, 21): a white hatched strip with a dark outline from the boar
   * along the charge; it fills up during the announcement and fades while the boar runs.
   * Wolf pack lines: wolves within the pack radius of each other.
   */
  private drawLanes(world: World): void {
    const g = this.laneLayer.clear(), p = world.params, half = enemyBodyRadius(p) * UNIT;
    let lanes = 0, packs = 0;
    for (const e of world.enemies) {
      if (e.kind !== 'boar' || (e.boar !== 'windup' && e.boar !== 'charge')) continue;
      lanes++;
      const left = e.boar === 'windup' ? p.boarRange : Math.max(0, p.boarRange - e.charged);
      const len = left * UNIT + half, k = e.boar === 'windup' && p.boarWindup > 0 ? 1 - Math.max(0, e.boarTimer) / p.boarWindup : 1;
      const fade = e.boar === 'charge' ? 0.5 : 1;
      const ux = e.dirX, uy = e.dirY, nx = -uy, ny = ux, ox = e.x * UNIT, oy = e.y * UNIT;
      const at = (t: number, s: number): [number, number] => [ox + ux * t + nx * s, oy + uy * t + ny * s];
      const quad = (t0: number, t1: number): number[] => [...at(t0, -half), ...at(t1, -half), ...at(t1, half), ...at(t0, half)];
      g.poly(quad(0, len)).fill({ color: THREAT, alpha: 0.12 * fade });
      g.poly(quad(0, len * k)).fill({ color: THREAT, alpha: 0.22 * fade });
      const step = 0.32 * UNIT;
      for (let t = 0; t < len - step * 0.5; t += step) {
        const [x0, y0] = at(t, -half), [x1, y1] = at(Math.min(len, t + step), half);
        g.moveTo(x0, y0).lineTo(x1, y1);
      }
      g.stroke({ color: THREAT, width: 3, alpha: 0.7 * fade });
      g.poly(quad(0, len)).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 * fade }).poly(quad(0, len)).stroke({ color: THREAT, width: 2, alpha: 0.95 * fade });
      // Arrow head at the end of the lane.
      const [tx, ty] = at(len + half * 0.9, 0), [ax, ay] = at(len, -half), [bx, by] = at(len, half);
      g.poly([ax, ay, tx, ty, bx, by]).fill({ color: THREAT, alpha: 0.85 * fade }).stroke({ color: THREAT_OUTLINE, width: 2, alpha: fade });
    }
    const wolves = world.enemies.filter(e => e.kind === 'wolf');
    for (let i = 0; i < wolves.length; i++) for (let j = i + 1; j < wolves.length; j++) {
      const a = wolves[i], b = wolves[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > p.wolfPackRadius) continue;
      packs++;
      g.moveTo(a.x * UNIT, a.y * UNIT).lineTo(b.x * UNIT, b.y * UNIT);
    }
    if (packs) g.stroke({ color: PALE, width: 3, alpha: 0.5, cap: 'round' });
    this.visibleLanes = lanes;
    this.visiblePackLines = packs;
  }

  /**
   * Signals of the new enemies (stage 2, step 2; docs/realtime-slice.md, section 4, column «Сигнал»):
   * - the shieldbearer: a thick steel arc of the shield width in front of it, turning with the shield (gone while frozen);
   * - the archer: its announced line — a strip of the threat color (as the boar's lane) that fills up during the windup.
   */
  private drawSignals(world: World): void {
    const g = this.signalLayer.clear(), p = world.params, r = enemyDrawRadius(p) * UNIT;
    const counts: SignalCounts = { shields: 0, arrowLanes: 0 };
    for (const e of world.enemies) {
      const line = archerLine(world, e);
      if (line) {
        counts.arrowLanes++;
        const half = line.half * UNIT, ux = e.vars.dx, uy = e.vars.dy, nx = -uy, ny = ux, ox = line.from.x * UNIT, oy = line.from.y * UNIT;
        const len = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y) * UNIT;
        const quad = (t0: number, t1: number): number[] => [ox + ux * t0 - nx * half, oy + uy * t0 - ny * half, ox + ux * t1 - nx * half, oy + uy * t1 - ny * half, ox + ux * t1 + nx * half, oy + uy * t1 + ny * half, ox + ux * t0 + nx * half, oy + uy * t0 + ny * half];
        g.poly(quad(0, len)).fill({ color: THREAT, alpha: 0.12 });
        g.poly(quad(0, len * line.progress)).fill({ color: THREAT, alpha: 0.4 });
        g.poly(quad(0, len)).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.8 }).poly(quad(0, len)).stroke({ color: THREAT, width: 1.5, alpha: 0.95 });
        // The arrow head at the filling front.
        const tx = ox + ux * len * line.progress, ty = oy + uy * len * line.progress;
        g.poly([tx + ux * half * 1.6, ty + uy * half * 1.6, tx - nx * half * 1.3, ty - ny * half * 1.3, tx + nx * half * 1.3, ty + ny * half * 1.3]).fill(THREAT).stroke({ color: THREAT_OUTLINE, width: 2 });
      }
      if (!shieldUp(world, e)) continue;
      counts.shields++;
      const x = e.x * UNIT, y = e.y * UNIT, half = Math.min(Math.PI, p.shieldArc * Math.PI / 360), f = e.vars.facing ?? 0, R = r * 1.22;
      g.moveTo(x + Math.cos(f - half) * R, y + Math.sin(f - half) * R).arc(x, y, R, f - half, f + half).stroke({ color: NAVY, width: 11, cap: 'round' });
      g.moveTo(x + Math.cos(f - half) * R, y + Math.sin(f - half) * R).arc(x, y, R, f - half, f + half).stroke({ color: STEEL, width: 6, cap: 'round' });
      // A faint wedge of the arc: where an anchor cannot take it from.
      g.moveTo(x, y).arc(x, y, R * 1.9, f - half, f + half).lineTo(x, y).fill({ color: STEEL, alpha: 0.1 });
    }
    Object.assign(this.signals, counts);
  }

  /** Marked enemies: a rotating gold reticle and a star badge — the goal of the third arena. */
  private drawTargets(world: World): void {
    const g = this.targetLayer.clear(), r = enemyDrawRadius(world.params) * UNIT;
    for (const e of world.enemies) {
      if (!e.marked) continue;
      const x = e.x * UNIT, y = e.y * UNIT, R = r * 1.35, a0 = this.clock * 1.6;
      g.circle(x, y, R).stroke({ color: THREAT_OUTLINE, width: 6, alpha: 0.6 }).circle(x, y, R).stroke({ color: TARGET, width: 3 });
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
        g.moveTo(x + c * R * 0.82, y + s * R * 0.82).lineTo(x + c * R * 1.25, y + s * R * 1.25);
      }
      g.stroke({ color: TARGET, width: 4, cap: 'round' });
      const sx = x + r * 0.78, sy = y + r * 0.82, pts: number[] = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.16 : r * 0.36; pts.push(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
      g.poly(pts).fill(TARGET).stroke({ color: THREAT_OUTLINE, width: 2 });
    }
  }

  /** Buttons (stone plates, sunk and green when pressed) and the door (barred, glowing when open). */
  private drawObjects(world: World): void {
    const g = this.objectLayer.clear(), R = OBJECT_RADIUS * UNIT, pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
    for (const o of world.objects) {
      const x = o.x * UNIT, y = o.y * UNIT;
      if (o.kind === 'crystal') {
        // Colour-change crystal (stage C): a faceted prism in all four chain colors, glowing; fits any chain.
        const h = R * 1.05, w = R * 0.72, bob = Math.sin(this.clock * 3 + o.id) * 3, cy = y + bob;
        g.ellipse(x, y + R * 0.75, R * 0.6, R * 0.2).fill({ color: 0x050a07, alpha: 0.4 });
        g.circle(x, cy, R * 1.15).fill({ color: 0xffffff, alpha: 0.08 + 0.1 * pulse });
        const top = [x, cy - h], right = [x + w, cy], bottom = [x, cy + h], left = [x - w, cy], mid = [x, cy];
        g.poly([...top, ...right, ...mid]).fill(COLORS[0]);
        g.poly([...right, ...bottom, ...mid]).fill(COLORS[1]);
        g.poly([...bottom, ...left, ...mid]).fill(COLORS[2]);
        g.poly([...left, ...top, ...mid]).fill(COLORS[3]);
        g.poly([...top, ...right, ...bottom, ...left]).stroke({ color: NAVY, width: 3 });
        g.poly([x - w * 0.35, cy - h * 0.45, x - w * 0.1, cy - h * 0.75, x, cy - h * 0.3]).fill({ color: 0xffffff, alpha: 0.7 });
        continue;
      }
      if (o.kind === 'button') {
        g.circle(x, y + 4, R).fill({ color: 0x050a07, alpha: 0.45 });
        if (o.pressed) {
          g.circle(x, y + 2, R * 0.9).fill(0x3a4434).stroke({ color: 0x8fd18a, width: 3 });
          g.moveTo(x - R * 0.35, y + 2).lineTo(x - R * 0.08, y + R * 0.3).lineTo(x + R * 0.4, y - R * 0.3).stroke({ color: 0x8fd18a, width: 5, cap: 'round', join: 'round' });
        } else {
          g.circle(x, y, R + 6).stroke({ color: TARGET, width: 3, alpha: 0.35 + 0.5 * pulse });
          g.circle(x, y, R).fill(0x6d6a58).stroke({ color: NAVY, width: 3 });
          g.circle(x, y - 2, R * 0.62).fill(0x9a9478).stroke({ color: 0x47463a, width: 2 });
          g.circle(x, y - 2, R * 0.22).fill(TARGET);
        }
        continue;
      }
      const open = doorOpen(world), w = R * 2.1, h = R * 2.3;
      g.roundRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12, 10).fill(0x3b3326).stroke({ color: NAVY, width: 3 });
      if (open) {
        g.circle(x, y, R * 2.1).fill({ color: 0xfff2c4, alpha: 0.12 + 0.12 * pulse });
        g.roundRect(x - w / 2, y - h / 2, w, h, 8).fill(0xf6e3a2).stroke({ color: 0xfff6d8, width: 3 });
        g.roundRect(x - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12, 6).fill({ color: 0xffffff, alpha: 0.55 });
      } else {
        g.roundRect(x - w / 2, y - h / 2, w, h, 8).fill(0x1b1712);
        for (let i = 1; i < 4; i++) g.rect(x - w / 2 + w * i / 4 - 2, y - h / 2, 4, h).fill(0x6b5f4c);
        g.circle(x, y + h * 0.1, R * 0.22).fill(0x8a7a5a).stroke({ color: NAVY, width: 2 });
      }
    }
  }

  private drawHero(world: World): void {
    const hero = world.hero, art = this.heroArt;
    this.heroLayer.position.set(hero.x * UNIT, hero.y * UNIT);
    if (art) {
      art.scale.set(0.95);
      art.alpha = hero.invulnerable > 0 && world.status === 'playing' ? (Math.floor(this.clock * 20) % 2 ? 0.4 : 1) : 1;
    }
    const flash = Math.max(world.params.hitFlash, 0.01), hurt = Math.min(1, hero.hurtFlash / flash);
    const ring = this.heroRing.clear();
    ring.ellipse(0, 26, 30, 9).fill({ color: 0x050a07, alpha: 0.4 });
    if (hurt > 0) ring.circle(0, 0, UNIT * 0.62).fill({ color: 0xffffff, alpha: 0.55 * hurt });
    // Stage F: the after-chain invulnerability — a blinking gold rim, unlike the hurt blink, while it lasts.
    if (hero.chainShield > 0 && world.status === 'playing' && Math.floor(this.clock * 12) % 2 === 0)
      ring.circle(0, 0, UNIT * 0.6).stroke({ color: 0xffd36b, width: 3, alpha: 0.9 });
    // Small HP bar under the hero: the eye stays near the action.
    const w = 58, frac = hero.maxHp > 0 ? hero.hp / hero.maxHp : 0;
    ring.roundRect(-w / 2, 40, w, 7, 3).fill(0x1a1d17).stroke({ color: 0x0b0d0a, width: 1 });
    ring.roundRect(-w / 2 + 1, 41, (w - 2) * frac, 5, 2).fill(frac > 0.34 ? 0xbd7165 : 0xe0523f);
  }

  private drawOverlay(world: World): void {
    const g = this.overlay.clear();
    if (!world.params.showHitboxes) return;
    const p = world.params;
    // White: hero circle and enemy touch circles; yellow: enemy bodies (pushing); dashed-ish: touch reach around the hero.
    g.circle(world.hero.x * UNIT, world.hero.y * UNIT, heroRadius(p) * UNIT).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    g.circle(world.hero.x * UNIT, world.hero.y * UNIT, touchDistance(p) * UNIT).stroke({ color: 0xffd36b, width: 1, alpha: 0.5 });
    for (const e of world.enemies) {
      g.circle(e.x * UNIT, e.y * UNIT, enemyBodyRadius(p) * UNIT).stroke({ color: 0xffd36b, width: 1, alpha: 0.6 });
      g.circle(e.x * UNIT, e.y * UNIT, enemyBodyRadius(p) * p.touchFactor * UNIT).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
    }
  }

  private handleEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type === 'chainHit') {
        // Dash shake stays light: not stronger than dashShake (design answer 22).
        if (world.params.dashShake > 0 && this.shakeLeft <= 0.02) { this.shakeLeft = this.shakeTotal = 0.08; this.shakeAmp = world.params.dashShake; }
        if (!ev.killed) this.floatText(`−${ev.damage}`, ev.x * UNIT, ev.y * UNIT - 30, 0xffd36b);
        continue;
      }
      if (ev.type === 'enemyHit') {
        // Stage 2, step 2: an arrow or a blast wounds an enemy (a kill comes as its own `kill` event).
        if (!ev.killed) this.floatText(`−${ev.damage}`, ev.x * UNIT, ev.y * UNIT - 30, 0xff8a73);
        continue;
      }
      if (ev.type === 'kill') {
        const view = this.enemyViews.get(ev.enemyId);
        if (!view) continue;
        this.enemyViews.delete(ev.enemyId);
        view.root.alpha = 1; view.root.tint = 0xffffff;
        if (view.grey) view.grey.alpha = 0;
        const total = Math.max(0.01, world.params.deathDuration);
        this.dying.push({ root: view.root, life: total, total, spin: Math.random() < 0.5 ? -1 : 1, scale: view.root.scale.x });
        continue;
      }
      if (ev.type === 'crystal') { this.floatText('◆ кристалл', ev.x * UNIT, ev.y * UNIT - 36, 0xf4efe0); continue; }
      if (ev.type === 'crystalBreak') {
        this.floatText(ev.score > 0 ? `◆ +${ev.score}` : '◆', ev.x * UNIT, ev.y * UNIT - 36, 0xf4efe0);
        continue;
      }
      if (ev.type === 'finisher') {
        if (world.params.finisher) { this.flashLeft = this.flashTotal = Math.max(0.15, world.params.finisherTime); }
        continue;
      }
      if (ev.type === 'chainEnd') {
        // Above the combo counter (its text ends ~100 px over the hero).
        if (ev.score > 0) this.floatText(`+${ev.score}`, world.hero.x * UNIT, world.hero.y * UNIT - 122, 0xfff2c4);
        this.comboLife = ev.kills > 0 ? 0.9 : 0;
        continue;
      }
      if (ev.type === 'button') {
        const o = world.objects.find(x => x.id === ev.objectId);
        if (o) this.floatText('Кнопка!', o.x * UNIT, o.y * UNIT - 40, 0x8fd18a);
        continue;
      }
      if (ev.type === 'goals') {
        const door = world.objects.find(x => x.kind === 'door');
        if (door) this.floatText('Дверь открыта', door.x * UNIT, door.y * UNIT + (door.y < world.arena.height / 2 ? 60 : -60), 0xfff2c4);
        continue;
      }
      if (ev.type !== 'hit') continue;
      if (world.params.shakeOnDamage && world.params.shakeDuration > 0) {
        this.shakeLeft = this.shakeTotal = world.params.shakeDuration;
        this.shakeAmp = world.params.shakeAmplitude;
      }
      const text = new Text({ text: `−${ev.damage}`, style: { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 'bold', fill: 0xff8a73, stroke: { color: 0x200c08, width: 4 } } });
      text.anchor.set(0.5); text.position.set(ev.x * UNIT + (Math.random() - 0.5) * 20, ev.y * UNIT - 40);
      this.fxLayer.addChild(text);
      this.floating.push({ text, life: 0.8, vy: -50 });
    }
  }

  private floatText(value: string, x: number, y: number, fill: number): void {
    const text = new Text({ text: value, style: { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 'bold', fill, stroke: { color: 0x200c08, width: 4 } } });
    text.anchor.set(0.5); text.position.set(x, y);
    this.fxLayer.addChild(text);
    this.floating.push({ text, life: 0.7, vy: -45 });
  }

  /** Death of an enemy: a full turn and a shrink to nothing. */
  private updateDying(dt: number): void {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.life -= dt;
      if (d.life <= 0) { d.root.destroy({ children: true }); this.dying.splice(i, 1); continue; }
      const k = d.life / d.total;
      d.root.rotation = d.spin * (1 - k) * Math.PI * 2;
      d.root.scale.set(d.scale * k);
      d.root.alpha = Math.min(1, k * 1.5);
    }
  }

  private drawChain(world: World, ui: RenderUi): void {
    const g = this.chainLayer.clear(), p = world.params, hero = world.hero;
    const flashR = enemyDrawRadius(p) * UNIT;
    for (const e of world.enemies) {
      if (e.hurtFlash <= 0) continue;
      g.circle(e.x * UNIT, e.y * UNIT, flashR).fill({ color: 0xffffff, alpha: Math.min(1, e.hurtFlash / Math.max(p.hitFlash, 0.01)) * 0.8 });
    }
    // Stage D (user 07.10.2026): the reach R of the first link around the hero, always — thin and faint over the crowd.
    let reach = 0;
    this.heroReachShown = world.status === 'playing';
    if (this.heroReachShown) {
      g.circle(hero.x * UNIT, hero.y * UNIT, p.linkRadius * UNIT).stroke({ color: 0xffffff, width: 1.25, alpha: 0.22 });
      reach++;
    }
    this.visibleReachCircles = reach;
    this.heroAnchorShown = false;
    if (world.move?.kind === 'dash') {
      // Dash: a light halo around the hero (passes through the crowd, cannot be hurt).
      g.circle(hero.x * UNIT, hero.y * UNIT, heroRadius(p) * UNIT * 1.6).fill({ color: 0xffffff, alpha: 0.18 });
    }
    if (ui.jumpMode && world.status === 'playing' && !world.move) {
      const ok = canJump(world);
      g.circle(hero.x * UNIT, hero.y * UNIT, p.jumpRadius * UNIT).fill({ color: 0x9ad1ff, alpha: 0.06 }).stroke({ color: ok ? 0x9ad1ff : 0x8a8a8a, width: 2, alpha: 0.8 });
      if (ui.pointer) {
        const land = jumpLanding(world, ui.pointer);
        const at = land ?? ui.pointer, good = ok && !!land;
        g.moveTo(hero.x * UNIT, hero.y * UNIT).lineTo(at.x * UNIT, at.y * UNIT).stroke({ color: good ? 0x9ad1ff : 0xd08070, width: 2, alpha: 0.6 });
        g.circle(at.x * UNIT, at.y * UNIT, heroRadius(p) * UNIT * 1.4).stroke({ color: good ? 0x9ad1ff : 0xd08070, width: 3 });
      }
    }
    if (!world.chain.length) {
      // Out of a chain: the reachable buttons / open door get a faint ring (a link of any color).
      if (world.status === 'playing' && !world.move) for (const o of nextObjectCandidates(world)) g.circle(o.x * UNIT, o.y * UNIT, OBJECT_RADIUS * UNIT + 10).stroke({ color: 0xffffff, width: 2, alpha: 0.45 });
      return;
    }
    const plan = planChain(world), color = chainColor(world), ink = color === null ? 0xffffff : COLORS[color];
    // Line hero → links, navy under the chain color.
    const pts: Vec[] = [{ x: hero.x, y: hero.y }];
    for (const l of world.chain) { const pt = linkPoint(world, l); if (pt) pts.push(pt); }
    for (const [w, c] of [[9, NAVY], [4.5, ink]] as const) {
      g.moveTo(pts[0].x * UNIT, pts[0].y * UNIT);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x * UNIT, pts[i].y * UNIT);
      g.stroke({ color: c, width: w, alpha: 0.95, cap: 'round', join: 'round' });
    }
    const anchor = chainAnchor(world);
    if (!plan.endsOnSurvivor && !plan.endsOnObject) {
      if (ui.pointer) g.moveTo(anchor.x * UNIT, anchor.y * UNIT).lineTo(ui.pointer.x * UNIT, ui.pointer.y * UNIT).stroke({ color: ink, width: 2, alpha: 0.45 });
      // Reach of the next link and the valid next links (outlined; `nextCandidates` already counts both anchors).
      g.circle(anchor.x * UNIT, anchor.y * UNIT, p.linkRadius * UNIT).stroke({ color: ink, width: 1.5, alpha: 0.35 });
      this.visibleReachCircles = ++reach;
      // Stage G: the hero is a second anchor — his circle (always drawn faint) gets the chain color too.
      if (p.heroAnchor) {
        g.circle(hero.x * UNIT, hero.y * UNIT, p.linkRadius * UNIT).stroke({ color: ink, width: 1.5, alpha: 0.35 });
        this.heroAnchorShown = true;
      }
      for (const e of nextCandidates(world)) g.circle(e.x * UNIT, e.y * UNIT, enemyDrawRadius(p) * UNIT + 5).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
    }
    if (!plan.endsOnSurvivor && !plan.endsOnObject) {
      for (const o of nextObjectCandidates(world)) g.circle(o.x * UNIT, o.y * UNIT, OBJECT_RADIUS * UNIT + 10).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
    }
    // Outcome of each link: dies — white badge with a red cross; wounded — orange ring and «!».
    const r = enemyDrawRadius(p) * UNIT;
    for (const lp of plan.links) {
      const pt = linkPoint(world, lp.link);
      if (!pt || !lp.outcome) continue;
      const x = pt.x * UNIT, y = pt.y * UNIT, cx = x - r * 0.7, cy = y - r * 0.75;
      if (lp.outcome.killed) {
        const s = r * 0.2;
        g.circle(cx, cy, r * 0.32).fill(0xf4efe0).stroke({ color: NAVY, width: 2 });
        g.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s).moveTo(cx + s, cy - s).lineTo(cx - s, cy + s).stroke({ color: 0xa8322a, width: 3, cap: 'round' });
      } else {
        g.circle(x, y, r + 4).stroke({ color: 0xffa040, width: 4 });
        g.circle(cx, cy, r * 0.32).fill(0xffa040).stroke({ color: NAVY, width: 2 });
        g.rect(cx - 2, cy - r * 0.18, 4, r * 0.22).rect(cx - 2, cy + r * 0.1, 4, 4).fill(NAVY);
      }
    }
  }

  private updateFloating(dt: number): void {
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const f = this.floating[i];
      f.life -= dt; f.text.y += f.vy * dt; f.text.alpha = Math.max(0, Math.min(1, f.life / 0.4));
      if (f.life <= 0) { f.text.destroy(); this.floating.splice(i, 1); }
    }
  }

  /** Draws the current world. Consumes world.events (render-only effects). */
  render(world: World, realDt: number, ui: RenderUi = { pointer: null, jumpMode: false }): void {
    this.clock += realDt;
    this.applyShake(realDt);
    this.handleEvents(world);
    this.updateFloating(realDt);
    this.updateDying(realDt);
    this.drawObjects(world);
    this.drawMarkers(world);
    this.drawLanes(world);
    this.drawRipples(world);
    this.syncEnemies(world);
    this.drawSignals(world);
    this.drawTargets(world);
    this.drawChain(world, ui);
    this.drawHero(world);
    this.drawOverlay(world);
    this.drawJuice(world, realDt);
  }

  /** Water stays water: bodies wading in the pond get two widening rings (walking there is slower). */
  private drawRipples(world: World): void {
    const g = this.rippleLayer.clear();
    let count = 0;
    const ring = (x: number, y: number, r: number, seed: number): void => {
      count++;
      for (let k = 0; k < 2; k++) {
        const t = (this.clock * 0.9 + seed * 0.37 + k * 0.5) % 1;
        g.ellipse(x * UNIT, (y + r * 0.45) * UNIT, (r * 0.8 + t * r * 0.7) * UNIT, (r * 0.32 + t * r * 0.28) * UNIT)
          .stroke({ color: 0xcfe9ff, width: 2, alpha: 0.55 * (1 - t) });
      }
    };
    const p = world.params;
    if (inWater(world.hero, world.arena)) ring(world.hero.x, world.hero.y, 0.45, 0);
    for (const e of world.enemies) if (inWater(e, world.arena)) ring(e.x, e.y, enemyDrawRadius(p), e.id);
    this.visibleRipples = count;
  }

  /** Camera shake: random offset of the arena, fading over its duration. */
  private applyShake(dt: number): void {
    let ox = 0, oy = 0;
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const a = this.shakeAmp * (this.shakeTotal > 0 ? this.shakeLeft / this.shakeTotal : 0);
      ox = (Math.random() * 2 - 1) * a; oy = (Math.random() * 2 - 1) * a;
    }
    this.root.position.set(this.base.x + ox, this.base.y + oy);
  }

  resetEffects(): void {
    this.shakeLeft = 0;
    this.flashLeft = 0;
    this.comboLife = 0;
    this.comboValue = 0;
    for (const f of this.floating) f.text.destroy();
    this.floating.length = 0;
    for (const view of this.enemyViews.values()) view.root.destroy({ children: true });
    this.enemyViews.clear();
    for (const d of this.dying) d.root.destroy({ children: true });
    this.dying.length = 0;
  }
}
