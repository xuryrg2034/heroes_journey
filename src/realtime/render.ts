/**
 * PixiJS view of the real-time arena. Reads the world, never changes it.
 * Terrain and the hero reuse the art of the main game (drawTerrain, makePlayer);
 * enemies are colored discs with the chain sigil (or the melee illustration),
 * which keeps 60+ enemies cheap: each disc is a sprite of one pre-rendered texture per color.
 */
import { Application, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from 'pixi.js';
import { COLORS, PALE, drawTerrain, makePlayer } from '../render/art';
import { characterSprite } from '../render/characterAssets';
import type { ArenaLayout } from './arena';
import type { EnemyLook } from './params';
import { touchDistance, type Enemy, type World } from './world';

/** Pixels per arena unit before fitting to the window (one board cell of the main game). */
export const UNIT = 72;
/** Threat color outside the chain palette: spawn markers (stage 3: boar lanes). */
export const THREAT = 0xff4fd8;
const NAVY = 0x18232d;
const BASE_ENEMY_RADIUS = 0.4;

interface EnemyView {
  root: Container;
  body: Container;
  hpLabel: Text | null;
  hp: number;
  look: EnemyLook;
}

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
  private readonly enemyLayer = new Container();
  private readonly heroLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly fxLayer = new Container();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly bodyTextures = new Map<string, { texture: Texture; ax: number; ay: number }>();
  private readonly floating: FloatingText[] = [];
  private heroArt: Container | null = null;
  private readonly heroRing = new Graphics();
  private arena: ArenaLayout | null = null;
  private clock = 0;

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
    this.root.addChild(this.staticLayer, this.markerLayer, this.enemyLayer, this.heroLayer, this.overlay, this.fxLayer);
    this.app.stage.addChild(this.root);
    this.heroArt = makePlayer();
    this.heroLayer.addChild(this.heroRing, this.heroArt);
  }

  /** Fits the arena into the free part of the canvas (the debug panel may cover the right side). */
  layout(freeWidth: number, height: number): void {
    if (!this.arena) return;
    const margin = 12, w = this.arena.width * UNIT, h = this.arena.height * UNIT;
    const scale = Math.max(0.1, Math.min((freeWidth - margin * 2) / w, (height - margin * 2) / h));
    this.root.scale.set(scale);
    this.root.position.set(Math.round((freeWidth - w * scale) / 2), Math.round((height - h * scale) / 2));
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

  /** Disc sprite of an enemy: vector art rendered once per (look, color, tough) into a texture. */
  private enemyDisc(color: number, tough: boolean, look: EnemyLook): Sprite {
    const key = `${look}-${color}-${tough ? 1 : 0}`;
    let entry = this.bodyTextures.get(key);
    if (!entry) {
      const g = new Graphics(this.enemyContext(color, tough, look)), b = g.getLocalBounds();
      const texture = this.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
      entry = { texture, ax: -b.minX / b.width, ay: -b.minY / b.height };
      this.bodyTextures.set(key, entry);
      g.destroy(true);
    }
    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.ax, entry.ay);
    return sprite;
  }

  private enemyContext(color: number, tough: boolean, look: EnemyLook): GraphicsContext {
    const r = BASE_ENEMY_RADIUS * UNIT, fill = COLORS[color];
    const ctx = new GraphicsContext();
    ctx.ellipse(0, r * 0.8, r * 0.9, r * 0.32).fill({ color: 0x050a07, alpha: 0.45 });
    if (look === 'circle') {
      ctx.circle(0, 0, r).fill(fill).stroke({ color: NAVY, width: 3 });
      ctx.arc(0, 0, r * 0.72, Math.PI * 1.1, Math.PI * 1.6).stroke({ color: 0xffffff, width: 3, alpha: 0.28 });
      if (tough) ctx.circle(0, 0, r - 5).stroke({ color: PALE, width: 2.5, alpha: 0.95 });
      drawSigil(ctx, color, r * 0.36, NAVY);
    } else {
      ctx.circle(0, 0, r).fill({ color: fill, alpha: 0.9 }).stroke({ color: NAVY, width: 3 });
      if (tough) ctx.circle(0, 0, r - 4).stroke({ color: PALE, width: 2.5, alpha: 0.95 });
    }
    return ctx;
  }

  private buildEnemyBody(e: Enemy, look: EnemyLook): { body: Container; hpLabel: Text | null } {
    const body = new Container();
    body.addChild(this.enemyDisc(e.color, e.hp > 0, look));
    const r = BASE_ENEMY_RADIUS * UNIT;
    if (look === 'sprite') {
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
    return { body, hpLabel };
  }

  private syncEnemies(world: World): void {
    const look = world.params.enemyLook, seen = new Set<number>();
    const scale = world.params.enemyRadius / BASE_ENEMY_RADIUS;
    for (const e of world.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (view && (view.look !== look || (view.hp > 0) !== (e.hp > 0))) { view.root.destroy({ children: true }); this.enemyViews.delete(e.id); view = undefined; }
      if (!view) {
        const root = new Container(), { body, hpLabel } = this.buildEnemyBody(e, look);
        root.addChild(body); this.enemyLayer.addChild(root);
        view = { root, body, hpLabel, hp: e.hp, look };
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
    }
    for (const [id, view] of this.enemyViews) if (!seen.has(id)) { view.root.destroy({ children: true }); this.enemyViews.delete(id); }
    this.enemyLayer.sortableChildren = true;
  }

  private drawMarkers(world: World): void {
    const g = this.markerLayer.clear(), r = world.params.enemyRadius * UNIT;
    for (const m of world.markers) {
      const x = m.x * UNIT, y = m.y * UNIT, k = m.total > 0 ? 1 - m.timeLeft / m.total : 1, s = r * 0.6;
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * 14);
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT, width: 5, alpha: pulse });
      g.arc(x, y, r * 0.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: THREAT, width: 3, alpha: 0.85 });
    }
  }

  private drawHero(world: World): void {
    const hero = world.hero, art = this.heroArt;
    this.heroLayer.position.set(hero.x * UNIT, hero.y * UNIT);
    if (art) {
      art.scale.set(0.95);
      art.alpha = hero.invulnerable > 0 && world.status === 'playing' ? (Math.floor(this.clock * 20) % 2 ? 0.4 : 1) : 1;
    }
    const ring = this.heroRing.clear(), hurt = hero.hurtFlash / 0.25;
    ring.ellipse(0, 26, 30, 9).fill({ color: 0x050a07, alpha: 0.4 });
    if (hurt > 0) ring.circle(0, 0, UNIT * 0.62).fill({ color: 0xd2453b, alpha: 0.35 * hurt });
    // Small HP bar under the hero: the eye stays near the action.
    const w = 58, frac = hero.maxHp > 0 ? hero.hp / hero.maxHp : 0;
    ring.roundRect(-w / 2, 40, w, 7, 3).fill(0x1a1d17).stroke({ color: 0x0b0d0a, width: 1 });
    ring.roundRect(-w / 2 + 1, 41, (w - 2) * frac, 5, 2).fill(frac > 0.34 ? 0xbd7165 : 0xe0523f);
  }

  private drawOverlay(world: World): void {
    const g = this.overlay.clear();
    if (!world.params.showHitboxes) return;
    const p = world.params;
    g.circle(world.hero.x * UNIT, world.hero.y * UNIT, p.heroRadius * UNIT).stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    g.circle(world.hero.x * UNIT, world.hero.y * UNIT, touchDistance(p) * UNIT).stroke({ color: 0xffd36b, width: 1, alpha: 0.5 });
    for (const e of world.enemies) g.circle(e.x * UNIT, e.y * UNIT, p.enemyRadius * p.touchFactor * UNIT).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
  }

  private handleEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type !== 'hit') continue;
      const text = new Text({ text: `−${ev.damage}`, style: { fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 'bold', fill: 0xff8a73, stroke: { color: 0x200c08, width: 4 } } });
      text.anchor.set(0.5); text.position.set(ev.x * UNIT + (Math.random() - 0.5) * 20, ev.y * UNIT - 40);
      this.fxLayer.addChild(text);
      this.floating.push({ text, life: 0.8, vy: -50 });
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
  render(world: World, realDt: number): void {
    this.clock += realDt;
    this.handleEvents(world);
    this.updateFloating(realDt);
    this.drawMarkers(world);
    this.syncEnemies(world);
    this.drawHero(world);
    this.drawOverlay(world);
  }

  resetEffects(): void {
    for (const f of this.floating) f.text.destroy();
    this.floating.length = 0;
    for (const view of this.enemyViews.values()) view.root.destroy({ children: true });
    this.enemyViews.clear();
  }
}
