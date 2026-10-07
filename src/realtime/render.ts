/**
 * PixiJS view of the real-time arena. Reads the world, never changes it.
 * Terrain and the hero reuse the art of the main game (drawTerrain, makePlayer);
 * enemies are colored discs with the chain sigil (or the melee illustration),
 * which keeps 60+ enemies cheap: each disc is a sprite of one pre-rendered texture per color.
 */
import { Application, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from 'pixi.js';
import { COLORS, PALE, drawTerrain, makePlayer } from '../render/art';
import { characterSprite } from '../render/characterAssets';
import type { ArenaLayout, Vec } from './arena';
import { canJump, chainAnchor, chainColor, jumpLanding, linkPoint, nextCandidates, planChain } from './chain';
import { heroRadius, type EnemyLook } from './params';
import { NO_COLOR, touchDistance, type Enemy, type World } from './world';

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

interface EnemyView {
  root: Container;
  body: Container;
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
    this.root.addChild(this.staticLayer, this.markerLayer, this.enemyLayer, this.chainLayer, this.heroLayer, this.overlay, this.fxLayer);
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

  /** Disc sprite of an enemy: vector art rendered once per (look, color, tough, fast) into a texture. */
  private enemyDisc(color: number, tough: boolean, fast: boolean, look: EnemyLook, grey = false): Sprite {
    const key = `${look}-${color}-${tough ? 1 : 0}-${fast ? 1 : 0}${grey ? '-grey' : ''}`;
    let entry = this.bodyTextures.get(key);
    if (!entry) {
      const g = new Graphics(this.enemyContext(color, tough, fast, look, grey)), b = g.getLocalBounds();
      const texture = this.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
      entry = { texture, ax: -b.minX / b.width, ay: -b.minY / b.height };
      this.bodyTextures.set(key, entry);
      g.destroy(true);
    }
    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.ax, entry.ay);
    return sprite;
  }

  private enemyContext(color: number, tough: boolean, fast: boolean, look: EnemyLook, grey = false): GraphicsContext {
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
    if (fast) {
      // Fast enemies: two swept marks trailing behind the disc (silhouette, not a color).
      for (const dy of [-r * 0.45, r * 0.15]) ctx.poly([-r * 0.75, dy, -r * 1.35, dy - r * 0.18, -r * 1.2, dy + r * 0.1]).fill(PALE).stroke({ color: NAVY, width: 2 });
    }
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

  private buildEnemyBody(e: Enemy, look: EnemyLook): { body: Container; grey: Sprite | null; hpLabel: Text | null } {
    const body = new Container();
    body.addChild(this.enemyDisc(e.color, e.hp > 0, e.fast, look));
    let grey: Sprite | null = null;
    if (e.color !== NO_COLOR) { grey = this.enemyDisc(e.color, e.hp > 0, e.fast, look, true); grey.alpha = 0; body.addChild(grey); }
    const r = BASE_ENEMY_RADIUS * UNIT;
    if (look === 'sprite' && e.color !== NO_COLOR) {
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
    return { body, grey, hpLabel };
  }

  private syncEnemies(world: World): void {
    const look = world.params.enemyLook, seen = new Set<number>();
    const scale = world.params.enemyRadius / BASE_ENEMY_RADIUS;
    // Crowd readability (design answer 10): while a chain is drawn, other colors are muted.
    const color = world.chain.length ? chainColor(world) : null;
    const mode = world.params.dimMode, strength = world.params.dimStrength;
    for (const e of world.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (view && (view.look !== look || (view.hp > 0) !== (e.hp > 0))) { view.root.destroy({ children: true }); this.enemyViews.delete(e.id); view = undefined; }
      if (!view) {
        const root = new Container(), { body, grey, hpLabel } = this.buildEnemyBody(e, look);
        root.addChild(body); this.enemyLayer.addChild(root);
        view = { root, body, grey, hpLabel, hp: e.hp, look };
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
    }
    for (const [id, view] of this.enemyViews) if (!seen.has(id)) { view.root.destroy({ children: true }); this.enemyViews.delete(id); }
    this.enemyLayer.sortableChildren = true;
  }

  private drawMarkers(world: World): void {
    const g = this.markerLayer.clear(), r = world.params.enemyRadius * UNIT;
    for (const m of world.markers) {
      const x = m.x * UNIT, y = m.y * UNIT, k = m.total > 0 ? 1 - m.timeLeft / m.total : 1, s = r * 0.6;
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * 14);
      const rim = m.color === NO_COLOR ? THREAT : COLORS[m.color];
      // Rim in the color of the coming enemy, filling up as the countdown runs.
      g.circle(x, y, r * 0.95).stroke({ color: rim, width: 3, alpha: 0.35 });
      g.arc(x, y, r * 0.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: rim, width: 4, alpha: 0.95 });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT_OUTLINE, width: 9, alpha: pulse, cap: 'round' });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT, width: 4.5, alpha: pulse, cap: 'round' });
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
      g.circle(e.x * UNIT, e.y * UNIT, p.bodyRadius * UNIT).stroke({ color: 0xffd36b, width: 1, alpha: 0.6 });
      g.circle(e.x * UNIT, e.y * UNIT, p.bodyRadius * p.touchFactor * UNIT).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
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
    const flashR = p.enemyRadius * UNIT;
    for (const e of world.enemies) {
      if (e.hurtFlash <= 0) continue;
      g.circle(e.x * UNIT, e.y * UNIT, flashR).fill({ color: 0xffffff, alpha: Math.min(1, e.hurtFlash / Math.max(p.hitFlash, 0.01)) * 0.8 });
    }
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
    if (!world.chain.length) return;
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
    if (!plan.endsOnSurvivor) {
      if (ui.pointer) g.moveTo(anchor.x * UNIT, anchor.y * UNIT).lineTo(ui.pointer.x * UNIT, ui.pointer.y * UNIT).stroke({ color: ink, width: 2, alpha: 0.45 });
      // Reach of the next link and the valid next links (outlined).
      g.circle(anchor.x * UNIT, anchor.y * UNIT, p.linkRadius * UNIT).stroke({ color: ink, width: 1.5, alpha: 0.35 });
      for (const e of nextCandidates(world)) g.circle(e.x * UNIT, e.y * UNIT, p.enemyRadius * UNIT + 5).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
    }
    // Outcome of each link: dies — white badge with a red cross; wounded — orange ring and «!».
    const r = p.enemyRadius * UNIT;
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
    this.drawMarkers(world);
    this.syncEnemies(world);
    this.drawChain(world, ui);
    this.drawHero(world);
    this.drawOverlay(world);
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
    for (const f of this.floating) f.text.destroy();
    this.floating.length = 0;
    for (const view of this.enemyViews.values()) view.root.destroy({ children: true });
    this.enemyViews.clear();
    for (const d of this.dying) d.root.destroy({ children: true });
    this.dying.length = 0;
  }
}
