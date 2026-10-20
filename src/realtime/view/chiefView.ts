/**
 * Task 54a «Главарь с котелком», part ui (design 17.10.2026, docs/design-notes/task-54-chief.md, 17; docs/realtime-elite-behaviors.md,
 * «Главарь (задача 54)»): the view of the camp branch's boss. Everything is read from the sim (`chiefCore`, `chiefMove`, `chiefState`,
 * `chiefLinkDrop`, `whistleColors`, the events `bossMove`, `partSevered`, `chiefFeast`, `chiefBrew`, `enemySignal` `recolor`); nothing here
 * changes the world and no rule is copied (the geometry of every sign is the sim's own):
 * - the core — a large drawing (`CHIEF_ART` body radii) over its disc: grey while he is closed, the brew's colour in the window (the
 *   host's `colorlessLink`); in the window a glow round the contour in the BREW's colour (the art is never recoloured) and a whole-second
 *   count over the head; the queue — `need` dots of the brew's colour over the head while a chain is drawn, each lit by a link of the brew
 *   in the drawn chain (with `chiefFeastBig` a second row of dots, dimmer); the drawn chain's last second — the core's link blinks;
 * - the parts — the ladle and the sack drawn behind their colour discs (the colour reads on the disc); a severed part falls off;
 * - the cauldron — a drawing on the floor at `ArenaTemplate.chief.cauldron` with the brew filling its throat and steam in the brew's colour
 *   (denser through «Обед!»'s windup); «Приправа» — a supply flies in an arc into it and the steam changes colour;
 * - the signs (threat colour, the sim's numbers): «Взмах половником» — the hatched half-disc; «Горсть перца» — three archer circles; «Обед!» —
 *   a dashed circle of the BREW's colour (no damage) round the cauldron and a mark of the brew's colour on each seat; «Свисток» — the
 *   circle at the gate with the dots of the colours that will come; the eaters sit lower with a bowl under them;
 * - «звон» (a hit outside the window or after its hit): a short grey spark at the hide, no text; a window that ended with the core in the
 *   drawn chain: a white ring on each link that dropped out; the recolour: a ring of the brew's colour on each body painted.
 * Coordinates are arena pixels (`unit` per arena unit); `r` is the drawing radius of a body in px.
 */
import { ColorMatrixFilter, Container, Graphics, Sprite, Text } from 'pixi.js';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import type { Vec } from '../sim/geometry';
import { CHIEF, CHIEF_LADLE, CHIEF_SACK, chiefCore, chiefLinkDrop, chiefMove, chiefState, whistleColors, type ChiefMoveId } from '../sim/enemies/chief';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { eliteArmorView } from '../sim/elites';
import { drawPlatePips, ELITE_LEMON } from './eliteView';
import { drawFlailArc, drawWhistleMark } from './jailerView';
import { corePips, partBadgeAt, partOutward, windowCount, type SignTools } from './trollView';

const NAVY = 0x18232d;
const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const SPARK_GREY = 0xc7ccd1;
const POT = 0x2f3544, POT_RIM = 0x6e7894, STONE = 0x4a5160, FIRE = 0xf2893a;
const LADLE_WOOD = 0x9a6a3a, LADLE_IRON = 0x6e7480, SACK_CLOTH = 0xb59a6a;
const SKIN = 0x7bd3a5, CLOAK = 0x4a3563;

/** The core's drawing: its box side in body radii (about 2 heroes tall), the feet's place; the parts' boxes. */
export const CHIEF_ART = 5.4;
export const CHIEF_FEET = 1.0;
const LADLE_ART = 3.4, SACK_ART = 2.8;
/** The cauldron's drawing: its width in units, the picture's aspect, its throat (the share of the picture: centre x from the middle, centre y from the middle, half sides). */
export const CAULDRON_W = 2.9;
const CAULDRON_ASPECT = 813 / 1000;
const THROAT = { cx: -0.013, cy: -0.34, rx: 0.275, ry: 0.075 };
/** Distance of a part's HP plaque from its centre along the line from the core, body radii (the weight's plaque stands at 1.45). */
const BADGE_OUT = 1.6;

/** Real seconds the effects last. */
export const SIGN_FLASH_LIFE = 0.3, SPARK_LIFE = 0.25, FALL_LIFE = 0.5, UNLINK_LIFE = 0.3, RECOLOR_LIFE = 0.4, BURST_LIFE = 0.5, HIT_LIFE = 0.35, SUPPLY_LIFE = 0.6;
/** The bowl's size under a seated eater (body radii). */
const BOWL = 0.5;

export const isChiefKind = (kind: string): boolean => kind === CHIEF || kind === CHIEF_LADLE || kind === CHIEF_SACK;
/** The seated eater (the host squashes its body and the view draws a bowl): it sits now (`vars.sit` — seconds left). */
export const eaterSits = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === 'basic' && (e.vars.sit ?? 0) > 0 && !!e.vars.eat;
/** The core's HP plaque: by the drawing's head, on the right (body-local px). */
export const chiefBadgeAt = (r: number): { x: number; y: number } => ({ x: r * CHIEF_ART * 0.4, y: r * (CHIEF_FEET - CHIEF_ART * 0.86) });
/** A part's HP plaque (body-local px): outside it on the line from the core. */
export const chiefPartBadgeAt = (core: Vec, part: Vec, r: number): { x: number; y: number } => partBadgeAt('chief-part', partOutward(core, part), r * BADGE_OUT / 1.7);

// ---- The drawings ----

/** The core's drawing: the picture and a copy behind it for the window's glow (in the brew's colour); the feet at the root's origin. */
export interface ChiefArt { root: Container; art: Container; glow: Container; filter: ColorMatrixFilter | null }

/** The glow's silhouette filter (alpha kept, colour set per frame); null where no filter can be made (Node: no canvas) — then the copy is tinted. */
function glowFilter(): ColorMatrixFilter | null {
  try { return new ColorMatrixFilter(); } catch { return null; }
}
const setGlowColor = (a: ChiefArt, color: number): void => {
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  if (a.filter) a.filter.matrix = [0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, 1, 0];
  else (a.glow as Container & { tint: number }).tint = color;
};

/** A fat goblin chief: the stand-in until the art loads (a body, a head, a crown, a cloak). */
function procChief(r: number): Graphics {
  const g = new Graphics(), w = r * CHIEF_ART * 0.5, h = r * CHIEF_ART;
  g.poly([-w * 0.9, -h * 0.55, -w * 0.5, -h * 0.2, w * 0.5, -h * 0.2, w * 0.9, -h * 0.55, w * 0.7, 0, -w * 0.7, 0]).fill(CLOAK).stroke({ color: NAVY, width: 4, join: 'round' });
  g.ellipse(0, -h * 0.3, w * 0.62, h * 0.22).fill(SKIN).stroke({ color: NAVY, width: 4 });
  g.ellipse(0, -h * 0.66, w * 0.5, h * 0.2).fill(SKIN).stroke({ color: NAVY, width: 4 });
  g.poly([-w * 0.45, -h * 0.82, -w * 0.3, -h * 0.98, -w * 0.1, -h * 0.84, 0, -h * 1.0, w * 0.1, -h * 0.84, w * 0.3, -h * 0.98, w * 0.45, -h * 0.82]).fill(0x8a8f99).stroke({ color: NAVY, width: 3, join: 'round' });
  g.circle(-w * 0.2, -h * 0.68, r * 0.22).circle(w * 0.2, -h * 0.68, r * 0.22).fill(0xf3e9a8).stroke({ color: NAVY, width: 2 });
  g.roundRect(-w * 0.22, -h * 0.58, w * 0.44, h * 0.08, 6).fill(0x6d1f34).stroke({ color: NAVY, width: 2 });
  return g;
}

/** The core's drawing and its glow copy. */
export function buildChief(r: number): ChiefArt {
  const root = new Container(), filter = glowFilter();
  const make = (glow: boolean): Container => {
    const sprite = hasCharacterArt('chief') ? characterSprite('chief', r * CHIEF_ART, r * CHIEF_ART) : null;
    const node: Container = sprite ?? procChief(r);
    if (sprite) sprite.position.set(0, -sprite.height / 2);
    if (glow) { if (filter) node.filters = [filter]; node.scale.set(node.scale.x * (sprite ? 1.08 : 1.07), node.scale.y * (sprite ? 1.08 : 1.07)); node.alpha = 0; node.visible = false; }
    return node;
  };
  const art = make(false), glow = make(true);
  root.addChild(glow, art);
  root.position.set(0, r * CHIEF_FEET);
  return { root, art, glow, filter };
}

/** A part's drawing, put behind its colour disc: the ladle (a long wooden handle, an iron bowl), the sack (a patched sack tied at the neck). Null — not a part. */
export function buildChiefPart(kind: string, r: number): Container | null {
  if (kind === CHIEF_LADLE) {
    const sprite = hasCharacterArt('chief-ladle') ? characterSprite('chief-ladle', r * LADLE_ART, r * LADLE_ART) : null;
    if (sprite) return sprite;
    const g = new Graphics();
    g.roundRect(-r * 0.2, -r * 1.8, r * 0.4, r * 2.4, r * 0.15).fill(LADLE_WOOD).stroke({ color: NAVY, width: 3 });
    g.circle(0, r * 0.7, r * 0.85).fill(LADLE_IRON).stroke({ color: NAVY, width: 3 });
    g.ellipse(0, r * 0.55, r * 0.6, r * 0.32).fill(0x20252c);
    return g;
  }
  if (kind === CHIEF_SACK) {
    const sprite = hasCharacterArt('chief-sack') ? characterSprite('chief-sack', r * SACK_ART, r * SACK_ART) : null;
    if (sprite) return sprite;
    const g = new Graphics();
    g.ellipse(0, r * 0.1, r * 1.0, r * 1.1).fill(SACK_CLOTH).stroke({ color: NAVY, width: 3 });
    g.poly([-r * 0.35, -r * 0.9, r * 0.35, -r * 0.9, r * 0.2, -r * 1.3, -r * 0.2, -r * 1.3]).fill(SACK_CLOTH).stroke({ color: NAVY, width: 3, join: 'round' });
    g.moveTo(-r * 0.35, -r * 0.9).lineTo(r * 0.35, -r * 0.9).stroke({ color: 0x7a5232, width: 4 });
    return g;
  }
  return null;
}

// ---- The view ----

interface SignGeometry { move: ChiefMoveId; x: number; y: number; r: number; dir: number; circles: Vec[] }
type FxKind = 'flash' | 'spark' | 'ring' | 'recolor' | 'burst' | 'hit' | 'supply';
interface Fx { kind: FxKind; x: number; y: number; r: number; born: number; life: number; color?: number; x1?: number; y1?: number; sign?: SignGeometry }
interface Piece { node: Container; x: number; y: number; vx: number; spin: number; born: number; life: number }

export class ChiefView {
  readonly shown = {
    /** The core is drawn this frame (0/1), its glow is lit, the count over the head ('' — none) and by its goal arrow, the cauldron drawn (0/1), the brew's colour (hex, −1 none). */
    core: 0, glow: 0, count: '', edgeCount: '', cauldron: 0, brew: -1,
    /** The sign drawn now ('' — none), its fill 0…1 and its radius in arena units (the sim's: the ladle's half-disc is exactly `SWING_RADIUS`); the signs by shape: half-disc, circles, dashed ring, gate marks; seat marks. */
    sign: '', signProgress: 0, signR: 0, halfDiscs: 0, circles: 0, rings: 0, gateMarks: 0, seatMarks: 0,
    /** The queue's dots drawn and lit, the dots' colour (hex, −1 none), the drawn chain's dropping core (0/1), the seated eaters with a bowl, the parts' drawings put. */
    dots: 0, litDots: 0, dotColor: -1, dropping: 0, bowls: 0, parts: 0, steam: 0,
    /** Seen so far: signs flashed at a hit, sparks of «звон», parts that fell off, white rings of dropped links, recolour rings, windows opened, the core's hits (plate / two), supplies flown, brews changed. */
    hits: 0, sparks: 0, severed: 0, unlinks: 0, recolors: 0, opens: 0, feastHits: 0, feastBig: 0, supplies: 0, brews: 0,
  };
  /** Under the enemies: the cauldron, its brew and steam. */
  readonly floor = new Container();
  /** Over the enemies: the count, the pieces that fell off. */
  readonly layer = new Container();
  private readonly floorG = new Graphics();
  private readonly fxG = new Graphics();
  private cauldron: Sprite | Container | null = null;
  private pieces: Piece[] = [];
  private fx: Fx[] = [];
  private lastSign: SignGeometry | null = null;
  private seenParts = new Map<number, { kind: string; x: number; y: number; r: number }>();
  private countLabel: Text | null = null;
  private edgeLabel: Text | null = null;

  /** `unit` — arena pixels per unit (render.ts `UNIT`); `ink` — a sim colour index as the view's colour (render.ts `chainInk`). */
  constructor(private readonly unit: number, private readonly ink: (color: number) => number) { this.floor.addChild(this.floorG); this.layer.addChild(this.fxG); }

  beginFrame(): void {
    const s = this.shown;
    s.core = 0; s.glow = 0; s.count = ''; s.cauldron = 0; s.brew = -1; s.sign = ''; s.signProgress = 0; s.signR = 0; s.halfDiscs = 0; s.circles = 0; s.rings = 0; s.gateMarks = 0; s.seatMarks = 0;
    s.dots = 0; s.litDots = 0; s.dotColor = -1; s.dropping = 0; s.bowls = 0; s.parts = 0; s.steam = 0;
  }

  /** The new fight: no effects, no memory. */
  reset(): void {
    this.fx = []; this.lastSign = null; this.seenParts.clear();
    for (const p of this.pieces.splice(0)) p.node.destroy({ children: true });
    this.fxG.clear(); this.floorG.clear();
    if (this.cauldron) { this.cauldron.destroy({ children: true }); this.cauldron = null; }
    if (this.countLabel) this.countLabel.visible = false;
    if (this.edgeLabel) this.edgeLabel.visible = false;
    Object.assign(this.shown, { hits: 0, sparks: 0, severed: 0, unlinks: 0, recolors: 0, opens: 0, feastHits: 0, feastBig: 0, supplies: 0, brews: 0 });
  }

  /**
   * The sim's events of the frame, in order. A move's hit flashes its sign where it stood; «звон» sparks at the hide; a window that ended with
   * the core in the drawn chain — a white ring on each link that dropped out; a hit of the chain on the core — a gold flash (two rings on a big
   * one); a body painted by «Обед!» — a ring of the brew's colour; «Приправа» — a supply flies into the cauldron and the new brew bursts there;
   * a part that is severed falls off. Returns whether the event was the Chief's (the rest go on to the common handlers).
   */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number): boolean {
    const U = this.unit;
    if (ev.type === 'bossMove') {
      const core = chiefCore(world);
      if (!core || ev.id !== core.id) return false;
      if (ev.stage === 'hit' && this.lastSign?.move === ev.move) { this.fx.push({ kind: 'flash', x: 0, y: 0, r: 0, born: clock, life: SIGN_FLASH_LIFE, sign: this.lastSign }); this.shown.hits++; }
      if (ev.move === 'season' && ev.stage === 'start') {
        const sack = world.enemies.find(p => p.partOf === core.id && p.kind === CHIEF_SACK), pot = chiefState(world)?.cauldron;
        if (sack && pot) { this.fx.push({ kind: 'supply', x: sack.x * U, y: sack.y * U, x1: pot.x * U, y1: pot.y * U, r, born: clock, life: SUPPLY_LIFE }); this.shown.supplies++; }
      }
      return true;
    }
    if (ev.type === 'chiefFeast') {
      if (ev.action === 'open') this.shown.opens++;
      else if (ev.action === 'block') {
        const hero = world.hero, dx = hero.x - ev.x, dy = hero.y - ev.y, d = Math.hypot(dx, dy) || 1;
        this.fx.push({ kind: 'spark', x: (ev.x + dx / d * 0.6) * U, y: (ev.y - 0.9 + dy / d * 0.2) * U, r, born: clock, life: SPARK_LIFE });
        this.shown.sparks++;
      } else if (ev.action === 'hit' || ev.action === 'big') {
        const color = this.ink(ev.colour);
        this.fx.push({ kind: 'hit', x: ev.x * U, y: (ev.y - 0.5) * U, r, born: clock, life: HIT_LIFE, color });
        if (ev.action === 'big') this.fx.push({ kind: 'hit', x: ev.x * U, y: (ev.y - 0.5) * U, r: r * 1.5, born: clock, life: HIT_LIFE * 1.3, color });
        this.shown.feastHits++; if (ev.action === 'big') this.shown.feastBig++;
      } else if (ev.action === 'unlink') {
        for (const id of ev.dropped ?? []) {
          const e = world.enemies.find(x => x.id === id);
          if (e) { this.fx.push({ kind: 'ring', x: e.x * U, y: e.y * U, r: r + 6, born: clock, life: UNLINK_LIFE }); this.shown.unlinks++; }
        }
      }
      return true;
    }
    if (ev.type === 'chiefBrew') {
      const pot = chiefState(world)?.cauldron;
      if (pot) this.fx.push({ kind: 'burst', x: pot.x * U, y: (pot.y - 0.2) * U, r: r * 1.6, born: clock, life: BURST_LIFE, color: this.ink(ev.colour) });
      this.shown.brews++;
      return true;
    }
    if (ev.type === 'enemySignal' && ev.signal === 'recolor') {
      const core = chiefCore(world);
      if (!core) return false;
      const e = world.enemies.find(x => x.id === ev.enemyId);
      this.fx.push({ kind: 'recolor', x: ev.x * U, y: ev.y * U, r: r + 4, born: clock, life: RECOLOR_LIFE, color: this.ink(e?.color ?? core.vars.br ?? core.color) });
      this.shown.recolors++;
      return false;
    }
    if (ev.type === 'partSevered') {
      const seen = this.seenParts.get(ev.id);
      if (!seen) return false;
      this.seenParts.delete(ev.id);
      this.shown.severed++;
      const art = buildChiefPart(seen.kind, seen.r);
      if (art) {
        art.position.set(seen.x, seen.y);
        this.layer.addChild(art);
        this.pieces.push({ node: art, x: seen.x, y: seen.y, vx: seen.kind === CHIEF_LADLE ? -16 : 16, spin: seen.kind === CHIEF_LADLE ? -2.4 : 1.8, born: clock, life: FALL_LIFE });
      }
      return true;
    }
    return false;
  }

  /** Notes the parts' places at the end of a frame (a severed part falls from there). */
  note(world: World, r: number): void {
    const core = chiefCore(world), U = this.unit, alive = new Set<number>();
    for (const e of world.enemies) {
      if (!core || e.partOf !== core.id || (e.kind !== CHIEF_LADLE && e.kind !== CHIEF_SACK)) continue;
      alive.add(e.id);
      this.seenParts.set(e.id, { kind: e.kind, x: e.x * U, y: e.y * U, r });
    }
    for (const id of [...this.seenParts.keys()]) if (!alive.has(id) && !world.events.some(ev => ev.type === 'partSevered' && ev.id === id)) this.seenParts.delete(id);
  }

  // ---- The cauldron (under the enemies) ----

  /**
   * The cauldron at `ArenaTemplate.chief.cauldron`: its drawing, the brew filling its throat in the brew's colour, the steam rising (denser
   * and faster through «Обед!»'s windup and while the window is open). No Chief on the arena — nothing.
   */
  drawFloor(world: World, clock: number): void {
    const g = this.floorG.clear(), st = chiefState(world), pot = world.arena.chief?.cauldron, U = this.unit;
    if (!st || !pot) { if (this.cauldron) this.cauldron.visible = false; return; }
    const W = CAULDRON_W * U, H = W * CAULDRON_ASPECT, cx = pot.x * U, cy = pot.y * U + 0.05 * U;
    if (!this.cauldron) {
      const sprite = hasCharacterArt('chief-cauldron') ? characterSprite('chief-cauldron', W, H) : null;
      this.cauldron = sprite ?? this.procCauldron(W, H);
      this.cauldron.position.set(cx, cy);
      this.floor.addChildAt(this.cauldron, 0);
    }
    this.cauldron.visible = true;
    const color = this.ink(st.brew), m = chiefMove(world), feast = m?.move === 'feast', open = !!st.window?.open;
    this.shown.cauldron = 1; this.shown.brew = color;
    // The brew in the throat (the picture's dark oval), a lighter ring of foam, a highlight.
    const tx = cx + THROAT.cx * W, ty = cy + THROAT.cy * H, rx = THROAT.rx * W, ry = THROAT.ry * H * 1.9;
    g.ellipse(tx, ty, rx, ry).fill({ color, alpha: 0.95 }).stroke({ color: NAVY, width: 2 });
    g.ellipse(tx - rx * 0.25, ty - ry * 0.25, rx * 0.45, ry * 0.35).fill({ color: 0xffffff, alpha: 0.28 });
    // Steam: puffs rising from the throat, in the brew's colour.
    const puffs = feast ? 9 : open ? 7 : 4, speed = feast || open ? 0.9 : 0.5;
    for (let i = 0; i < puffs; i++) {
      const t = (clock * speed + i / puffs) % 1, x = tx + Math.sin(i * 2.1 + clock) * rx * 0.5 + Math.sin(t * 6 + i) * 6, y = ty - t * 1.6 * U, rad = (0.14 + 0.3 * t) * U * (feast ? 1.25 : 1);
      g.circle(x, y, rad).fill({ color, alpha: (feast ? 0.5 : 0.32) * (1 - t) });
    }
    this.shown.steam = puffs;
  }

  /** A stand-in cauldron: a pot on three stones over a fire, an empty throat. */
  private procCauldron(W: number, H: number): Container {
    const g = new Graphics();
    for (const sx of [-0.32, 0, 0.32]) g.ellipse(sx * W, H * 0.34, W * 0.14, H * 0.12).fill(STONE).stroke({ color: NAVY, width: 3 });
    g.poly([-W * 0.1, H * 0.3, 0, H * 0.05, W * 0.1, H * 0.3]).fill(FIRE);
    g.ellipse(0, -H * 0.05, W * 0.42, H * 0.34).fill(POT).stroke({ color: NAVY, width: 4 });
    g.ellipse(THROAT.cx * W, THROAT.cy * H, THROAT.rx * W, THROAT.ry * H * 1.4).fill(0x0a0f1c).stroke({ color: POT_RIM, width: 4 });
    return g;
  }

  // ---- The signs (under the crowd) ----

  /** The signs of the Chief's moves at their fill, the sim's own geometry (`chiefMove`); the geometry is kept so a hit flashes it where it stood. */
  drawSigns(g: Graphics, world: World, tools: SignTools, sees: (p: Vec) => boolean): void {
    const m = chiefMove(world), U = this.unit, s = this.shown;
    if (!m) return;
    s.sign = m.move; s.signProgress = m.progress; s.signR = m.r;
    if (m.move === 'swing') {
      const dir = m.dir ?? 0;
      this.lastSign = { move: 'swing', x: m.at.x * U, y: m.at.y * U, r: m.r * U, dir, circles: [] };
      if (!sees(m.at)) return;
      drawFlailArc(g, m.at.x * U, m.at.y * U, m.r * U, dir, m.progress, 0.32 * U);
      s.halfDiscs++;
    } else if (m.move === 'pepper' && m.circles) {
      this.lastSign = { move: 'pepper', x: m.at.x * U, y: m.at.y * U, r: m.r * U, dir: 0, circles: m.circles.map(c => ({ x: c.x * U, y: c.y * U })) };
      for (const c of m.circles) { if (!sees(c)) continue; this.circleSign(g, tools, c.x * U, c.y * U, m.r * U, m.progress, 0); s.circles++; }
    } else if (m.move === 'feast') {
      const color = this.ink(chiefState(world)?.brew ?? 0);
      this.lastSign = { move: 'feast', x: m.at.x * U, y: m.at.y * U, r: m.r * U, dir: 0, circles: [] };
      if (sees(m.at)) { this.dashedCircle(g, m.at.x * U, m.at.y * U, m.r * U, color, m.progress); s.rings++; }
      for (const p of m.seats ?? []) {
        if (!sees(p)) continue;
        g.circle(p.x * U, p.y * U, 0.36 * U).fill({ color, alpha: 0.25 }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.7 });
        g.moveTo(p.x * U, p.y * U - 0.36 * U).arc(p.x * U, p.y * U, 0.36 * U, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, m.progress)).stroke({ color, width: 4, alpha: 0.95 });
        s.seatMarks++;
      }
    } else if (m.move === 'whistle') {
      const core = chiefCore(world), inks = (core ? [...whistleColors(world, core)] : [0]).map(c => this.ink(c));
      this.lastSign = { move: 'whistle', x: m.at.x * U, y: m.at.y * U, r: m.r * U, dir: 0, circles: [] };
      if (sees(m.at)) { drawWhistleMark(g, m.at.x * U, m.at.y * U, m.r * U, inks, m.progress, 1); s.gateMarks++; }
    }
  }

  private circleSign(g: Graphics, tools: SignTools, X: number, Y: number, R: number, progress: number, flash: number): void {
    if (flash > 0) { g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.5 * flash }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: flash }); return; }
    g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.16 });
    if (progress > 0) g.circle(X, Y, R * Math.min(1, progress)).fill({ color: THREAT, alpha: 0.28 });
    tools.hatchCircle(g, X, Y, R, 0.32 * this.unit);
    g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
    g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(X, Y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
  }

  /** «Обед!»'s circle: dashed, in the brew's colour (it hurts nobody: not the threat colour), a ring filling clockwise with the windup. */
  private dashedCircle(g: Graphics, X: number, Y: number, R: number, color: number, progress: number): void {
    const N = 48;
    for (const [w, c, a] of [[7, THREAT_OUTLINE, 0.7], [4, color, 0.95]] as const) {
      for (let i = 0; i < N; i += 2) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1.1) / N * Math.PI * 2;
        g.moveTo(X + Math.cos(a0) * R, Y + Math.sin(a0) * R).arc(X, Y, R, a0, a1);
      }
      g.stroke({ color: c, width: w, alpha: a, cap: 'round' });
    }
    g.circle(X, Y, R).fill({ color, alpha: 0.06 + 0.1 * progress });
    if (progress > 0) g.moveTo(X, Y - R).arc(X, Y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress)).stroke({ color, width: 3, alpha: 0.5 });
  }

  // ---- The core's frame ----

  /**
   * The core's glow (the brew's colour) round the contour while the window takes the hit — it blinks in the last half second — and the
   * whole-second count over the head. `art` — the drawing (`buildChief`), null when the body is not drawn. `r` — the body's drawing radius in px.
   */
  syncCore(art: ChiefArt | null, world: World, clock: number, r: number, visible: boolean): void {
    const st = chiefState(world), s = this.shown;
    if (this.countLabel) this.countLabel.visible = false;
    if (!art || !st) return;
    const win = st.window, lit = !!win && win.open && !win.hit, m = chiefMove(world);
    s.core = 1;
    const urgent = !!win && win.left < 0.5 && Math.floor(clock * 12) % 2 === 0, a = lit ? (0.55 + 0.25 * Math.sin(clock * 9)) * (urgent ? 0.45 : 1) : 0;
    art.glow.visible = lit; art.glow.alpha = a;
    if (lit) { setGlowColor(art, this.ink(st.brew)); s.glow = 1; }
    // «Обед!»: he throws his head back a little for the windup.
    const lift = m?.move === 'feast' ? Math.min(1, m.progress * 2.5) : 0;
    art.root.scale.set(1 + 0.02 * lift, 1 + 0.06 * lift);
    if (!lit || !win || !visible) return;
    const U = this.unit, label = this.countLabel ??= (() => {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 34, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: NAVY, width: 6 } } });
      text.anchor.set(0.5, 0.5);
      this.layer.addChild(text);
      return text;
    })();
    s.count = windowCount(win.left);
    label.text = s.count;
    label.style.fill = win.left <= 1 ? 0xff8a6a : 0xfff2c4;
    label.position.set(st.x * U + r * CHIEF_ART * 0.46, st.y * U - r * CHIEF_ART * 0.5);
    label.visible = true;
  }

  /** The count by the core's goal arrow while the core is off screen (the window is seen wherever the hero is). */
  drawEdge(world: World, goal: { x: number; y: number; angle: number } | undefined, coreSeen: boolean, parent: Container): void {
    const st = chiefState(world), s = this.shown, win = st?.window;
    s.edgeCount = '';
    if (this.edgeLabel) this.edgeLabel.visible = false;
    if (!win || !win.open || win.hit || !goal || coreSeen) return;
    const label = this.edgeLabel ??= (() => {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: NAVY, width: 5 } } });
      text.anchor.set(0.5, 0.5);
      parent.addChild(text);
      return text;
    })();
    s.edgeCount = windowCount(win.left);
    label.text = s.edgeCount;
    label.style.fill = win.left <= 1 ? 0xff8a6a : 0xfff2c4;
    label.position.set(goal.x - Math.cos(goal.angle) * 30, goal.y - Math.sin(goal.angle) * 30);
    label.visible = true;
  }

  // ---- Over the enemies ----

  /**
   * Over the bodies (`g` — the elite layer): the plate pips of the core and of the parts, the queue's dots, the dropping core's blink, the
   * bowls under the seated eaters; then the running effects (`fxG`) and the pieces that fell off. One call a frame, after the enemies are placed.
   */
  drawOver(g: Graphics, world: World, clock: number, dt: number, r: number, px: number, sees: (e: Enemy) => boolean): void {
    const U = this.unit, st = chiefState(world), s = this.shown, core = chiefCore(world), fxG = this.fxG;
    fxG.clear();
    if (!st && this.countLabel) this.countLabel.visible = false;
    if (core && st) {
      const coreArmor = eliteArmorView(core);
      if (coreArmor && sees(core)) { const at = corePips(core.x * U, core.y * U, r); drawPlatePips(g, at.x, at.y, at.R, coreArmor, 0, px, true); }
      for (const part of world.enemies) {
        const partArmor = part.partOf === core.id ? eliteArmorView(part) : null;
        if (!partArmor || !sees(part)) continue;
        const u = partOutward(core, part), badge = chiefPartBadgeAt(core, part, r), n = u.y > 0 ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x }, side = n.x < 0 ? -1 : 1;
        drawPlatePips(g, part.x * U + badge.x + n.x * side * r * 0.95, part.y * U + badge.y + n.y * side * r * 0.95, 0, partArmor, 0, px);
      }
      this.drawQueue(g, world, st, clock, r, px);
    }
    for (const e of world.enemies) {
      if (!eaterSits(e) || !sees(e)) continue;
      const bx = e.x * U, by = e.y * U + r * 0.62, color = this.ink(st?.brew ?? e.color);
      g.ellipse(bx, by, r * BOWL, r * BOWL * 0.45).fill(0x5b4330).stroke({ color: NAVY, width: 2 * px });
      g.ellipse(bx, by - r * 0.04, r * BOWL * 0.78, r * BOWL * 0.28).fill(color);
      s.bowls++;
    }
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) this.drawFx(fxG, f, 1 - (clock - f.born) / f.life, r, world);
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i], t = (clock - p.born) / p.life;
      if (t >= 1) { p.node.destroy({ children: true }); this.pieces.splice(i, 1); continue; }
      p.node.position.set(p.x + p.vx * t, p.y + t * t * 40 * (U / 72) + t * 6);
      p.node.rotation += p.spin * dt; p.node.alpha = 1 - t * t;
    }
  }

  /**
   * The queue: over the core's head, `need` dots of the brew's colour while a chain is drawn and the window takes the hit; the first `queue`
   * are lit (links of the brew before him in the drawn chain), all lit and ringed when the queue is made. With `big` a second row, dimmer.
   * The core's link in the drawn chain whose window runs out within the second blinks (the sim's `chiefLinkDrop`).
   */
  private drawQueue(g: Graphics, world: World, st: NonNullable<ReturnType<typeof chiefState>>, clock: number, r: number, px: number): void {
    const win = st.window, s = this.shown, U = this.unit;
    const drop = chiefLinkDrop(world, world.chain);
    if (drop && win && win.open && drop.left < 1 && Math.floor(clock * 8) % 2 === 0) {
      for (const l of world.chain.slice(drop.index)) {
        const e = l.kind === 'enemy' ? world.enemies.find(x => x.id === l.id) : undefined;
        if (e) g.circle(e.x * U, e.y * U, r + 7).stroke({ color: 0xff8a6a, width: 4, alpha: 0.95 });
      }
      s.dropping = 1;
    }
    if (!win || !win.open || win.hit || !st.rule || !world.chain.length || st.need <= 0) return;
    const color = this.ink(st.brew), x0 = st.x * U, y0 = st.y * U - r * (CHIEF_ART * 0.86 + 0.5), dot = Math.max(5, r * 0.2), gap = dot * 2.9, total = st.big > 0 ? st.big : st.need;
    const made = st.queue >= st.need;
    s.dotColor = color;
    for (let i = 0; i < total; i++) {
      const row = i < st.need ? 0 : 1, k = row === 0 ? i : i - st.need, n = row === 0 ? st.need : total - st.need;
      const x = x0 + (k - (n - 1) / 2) * gap, y = y0 - row * gap * 0.85, lit = i < st.queue;
      g.circle(x, y, dot).fill({ color: lit ? color : 0x16202a, alpha: lit ? 1 : row === 0 ? 0.75 : 0.45 }).stroke({ color: lit ? NAVY : color, width: (lit ? 2 : 1.6) * px, alpha: lit ? 1 : row === 0 ? 0.9 : 0.45 });
      s.dots++; if (lit) s.litDots++;
    }
    if (made) g.circle(x0, y0, (st.need * gap) / 2 + dot * 1.4).stroke({ color, width: 2.5 * px, alpha: 0.7 });
  }

  private drawFx(g: Graphics, f: Fx, k: number, r: number, world: World): void {
    if (f.kind === 'spark') {
      const R = f.r * (0.5 + 0.5 * (1 - k));
      for (const [w, color] of [[6, NAVY], [3, SPARK_GREY]] as const) {
        for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a); g.moveTo(f.x + c * R * 0.3, f.y + sn * R * 0.3).lineTo(f.x + c * R, f.y + sn * R); }
        g.stroke({ color, width: w, alpha: k, cap: 'round' });
      }
    } else if (f.kind === 'ring') {
      g.circle(f.x, f.y, f.r * (1 + 0.5 * (1 - k))).stroke({ color: 0xffffff, width: 5, alpha: 0.9 * k });
    } else if (f.kind === 'recolor') {
      g.circle(f.x, f.y, f.r * (1 + 0.6 * (1 - k))).stroke({ color: f.color ?? 0xffffff, width: 5, alpha: k });
      g.circle(f.x, f.y, f.r * (0.8 + 0.5 * (1 - k))).fill({ color: f.color ?? 0xffffff, alpha: 0.3 * k });
    } else if (f.kind === 'burst') {
      g.circle(f.x, f.y, f.r * (0.6 + 1.2 * (1 - k))).stroke({ color: f.color ?? 0xffffff, width: 7, alpha: k });
      g.circle(f.x, f.y, f.r * (0.4 + 0.8 * (1 - k))).fill({ color: f.color ?? 0xffffff, alpha: 0.3 * k });
    } else if (f.kind === 'hit') {
      g.circle(f.x, f.y, f.r * (1.2 + 1.4 * (1 - k))).stroke({ color: ELITE_LEMON, width: 6, alpha: k });
      g.circle(f.x, f.y, f.r * (1.2 + 1.4 * (1 - k))).fill({ color: f.color ?? ELITE_LEMON, alpha: 0.2 * k });
    } else if (f.kind === 'supply' && f.x1 !== undefined && f.y1 !== undefined) {
      const t = 1 - k, x = f.x + (f.x1 - f.x) * t, y = f.y + (f.y1 - f.y) * t - Math.sin(t * Math.PI) * 1.8 * this.unit;
      g.circle(x, y, r * 0.32).fill(0xb8864a).stroke({ color: NAVY, width: 3 });
      g.circle(x - r * 0.1, y - r * 0.1, r * 0.1).fill({ color: 0xffffff, alpha: 0.5 });
    } else if (f.sign) this.flashSign(g, world, f.sign, k);
  }

  private flashSign(g: Graphics, _world: World, sg: SignGeometry, k: number): void {
    if (sg.move === 'swing') { drawFlailArc(g, sg.x, sg.y, sg.r, sg.dir, 1, 0.32 * this.unit, k); return; }
    if (sg.move === 'pepper') { for (const c of sg.circles) g.circle(c.x, c.y, sg.r).fill({ color: THREAT, alpha: 0.5 * k }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: k }); return; }
    g.circle(sg.x, sg.y, sg.r).fill({ color: THREAT, alpha: 0.4 * k }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: k });
  }
}
