/**
 * PixiJS view of the real-time arena (src/realtime/view). Reads the simulation's world, never changes it.
 * Terrain and the hero reuse the art of the main game (drawTerrain, makePlayer);
 * enemies are colored discs with the chain sigil (or the melee illustration),
 * which keeps 60+ enemies cheap: each disc is a sprite of one pre-rendered texture per color.
 * Stage 3: wolf ears and pack lines, boar tusks with the charge lane (threat color, hatched)
 * and «!», target reticles of marked enemies, buttons and the door.
 * Stage 2 of the transition, step 2 (docs/realtime-slice.md, section 4): the signals of the new enemies — the shield
 * arc of the shieldbearer, the archer's line, the sapper's fuse and blast ring (`drawSignals`); the porcupine's quills (its
 * drawing) and the «−1 HP» badge on a porcupine link of the drawn chain (`drawChain`).
 */
import { Application, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from 'pixi.js';
import { COLORS, PALE, drawTerrain, makePlayer } from '../../render/art';
import { characterSprite } from '../../render/characterAssets';
import type { ArenaLayout } from '../sim/arenas';
import { OBJECT_RADIUS, armedDamage, canJump, chainAnchor, chainColor, heroAnchorOn, jumpLanding, linkPoint, nextCandidates, nextObjectCandidates, planChain } from '../sim/chain';
import { BOAR_ART_SCALE, archerLine, lynxLine, lynxStunned, quillsUp, quillsWarning, sapperFuse, shamanBeam, shieldUp, wolfHowl, wolfRushLine } from '../sim/enemies/index';
import { brittleNow } from '../sim/items';
import type { ItemKind } from '../sim/kit';
import { areaContains, inWater, type Area, type TerrainZone, type Vec } from '../sim/geometry';
import { Camera, CAMERA, placeEdgeArrows, type CameraBounds, type PlacedArrow } from './camera';
import { collectEdgeMarkers } from './edgeMarkers';
import { drawRoleGlyph, roleOf, type EnemyRole } from './roles';
import { enemyBodyRadius, enemyDrawRadius, heroRadius, type EnemyLook } from '../sim/params';
import { NO_COLOR, doorOpen, touchDistance, type Enemy, type EnemyKind, type World } from '../sim/world';

/** Input state the view shows (pointer line, jump aim); owned by main.ts. */
export interface RenderUi {
  pointer: Vec | null;
  jumpMode: boolean;
  /** Camera (docs/realtime-stage3.md, section 11): the pointer in stage pixels; `render` turns it into `pointer` after moving the camera. */
  pointerScreen?: Vec | null;
  /** The camera stands (a chain is being drawn); it still follows a chain pass and a jump (`world.move`). */
  cameraFrozen?: boolean;
  /** The camera stands whatever happens (the fight is over). */
  cameraStill?: boolean;
  /** The pointer is over the scene (not over the debug panel or a button): only then does it lead the camera. */
  pointerOverStage?: boolean;
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
/** Fuse sparks of the sapper and flames: hot orange (outside the chain palette; phase A: the blast circle is THREAT). */
const SPARK = 0xffb04a;
/** Stage 3a (П4): the shaman's beam — violet magic, outside the chain palette. */
const MAGIC = 0xc58cff;
/** Phase A (Т5): pointers to spawn markers off screen on a large arena — a cold pale grey, apart from the white of a
 * danger and the gold of a goal; smaller and steady (no blinking). */
const SPAWN_ARROW = 0xc9d5de;
/** Phase A (Т3): the plaque of a badge under a body and the ink of its glyph. */
const BADGE_PLAQUE = 0x10171d;
/** Phase A (Т3): the badge glyph in screen pixels (its half size) and the plaque around it. */
const BADGE_GLYPH_PX = 6;
const BADGE_PLAQUE_PX = 9;
/** Stage 2, step 3: the cold consumable — pale ice blue. */
const ICE = 0x9fd8ff;
/** Stage 2, step 3: colours of the loot of elites — consumables and crafting resources. */
/** Stage 2, step 3: names of the loot shown when it is picked up. */
const LOOT_TITLE: Readonly<Record<string, string>> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь', dew: 'Роса', powder: 'Порох', resin: 'Смола', herbs: 'Травы' };
const LOOT_COLOR: Readonly<Record<string, number>> = { frost: ICE, bomb: 0x3a3f46, healing: 0x8fd18a, fire: SPARK, dew: 0xbfe3ff, powder: 0x6d6a58, resin: 0xc88a3a, herbs: 0x6fae5a };

/** Signals of the new enemies drawn in the last frame (tests read them: the signal is on screen). */
/** `quillsRaised` / `quillsTrembling` (iteration 2.1): porcupines drawn with their quills up / trembling before going up. */
/** `braziersLit` / `braziersOut` (stage 3a, М4): braziers drawn burning / put out. */
/** Stage 3a: `howls` — the wolves' howl circle round the hero (П1); `leapLines`, `stunned` — the lynx's leap line and its stun (П2); `beams` — the shaman's beam (П4). */
/** Phase A (Д3): `rushLanes` — the rush lanes of howling and rushing wolves; `roleBadges` — role badges under bodies. */
export interface SignalCounts { shields: number; arrowLanes: number; fuses: number; quillBadges: number; frozen: number; burning: number; elites: number; loot: number; quillsRaised: number; quillsTrembling: number; braziersLit: number; braziersOut: number; howls: number; leapLines: number; stunned: number; beams: number; rushLanes: number; roleBadges: number }

/** Stage 3a: terrain zones drawn by `buildArena` (tests read it: the river, the cliff, the thorns are on screen). */
export interface TerrainCounts { river: number; cliff: number; thorns: number }

/** Stage 3a: colours of the terrain — water as the pond, a dark drop with a pale rim, thorny scrub. */
const WATER = 0x243c3d, WATER_RIM = 0x73918a, WATER_LIGHT = 0x548b88;
const CHASM = 0x07090a, CHASM_RIM = 0x9a8a66;
const THORN = 0x2b3a1d, THORN_INK = 0x9a8452;
/** Stage 3a (М4): the brazier's fire and the grey of a brazier put out. */
const EMBER = 0xff8a3a, FLAME = 0xffd36b, ASH = 0x7a7a72;

/** Path of a zone outline (a band is a stroke along its spine, drawn by the caller). */
function areaPath(g: Graphics, area: Area): Graphics {
  if (area.shape === 'circle') return g.circle(area.x * UNIT, area.y * UNIT, area.r * UNIT);
  if (area.shape === 'rect') return g.rect(area.x * UNIT, area.y * UNIT, area.w * UNIT, area.h * UNIT);
  return g.poly(area.points.flatMap(p => [p.x * UNIT, p.y * UNIT]));
}
function spinePath(g: Graphics, points: readonly Vec[]): Graphics {
  g.moveTo(points[0].x * UNIT, points[0].y * UNIT);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x * UNIT, points[i].y * UNIT);
  return g;
}

/**
 * Phase A (Т3, design answer 11): one look for every announced line — a strip of the threat colour `2·half` wide from
 * (ox, oy) along (ux, uy), `len` long: a faint fill, a stronger fill up to `progress` (how far the windup has gone), diagonal
 * hatching and a dark outline under a white one. `fade` dims it all (a strip already running). Pixels of the arena layer.
 */
function threatStrip(g: Graphics, ox: number, oy: number, ux: number, uy: number, len: number, half: number, progress: number, fade: number, filled = 0.22): void {
  const nx = -uy, ny = ux;
  const at = (t: number, s: number): [number, number] => [ox + ux * t + nx * s, oy + uy * t + ny * s];
  const quad = (t0: number, t1: number): number[] => [...at(t0, -half), ...at(t1, -half), ...at(t1, half), ...at(t0, half)];
  g.poly(quad(0, len)).fill({ color: THREAT, alpha: 0.12 * fade });
  if (progress > 0) g.poly(quad(0, len * Math.min(1, progress))).fill({ color: THREAT, alpha: filled * fade });
  const step = 0.32 * UNIT;
  for (let t = 0; t < len - step * 0.5; t += step) {
    const [x0, y0] = at(t, -half), [x1, y1] = at(Math.min(len, t + step), half);
    g.moveTo(x0, y0).lineTo(x1, y1);
  }
  g.stroke({ color: THREAT, width: 3, alpha: 0.7 * fade });
  g.poly(quad(0, len)).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 * fade }).poly(quad(0, len)).stroke({ color: THREAT, width: 2, alpha: 0.95 * fade });
}

/** An arrow head of a strip at distance `t` along it (pointing along (ux, uy)), `half` — half the strip width. */
function stripHead(g: Graphics, ox: number, oy: number, ux: number, uy: number, t: number, half: number, fade: number): void {
  const nx = -uy, ny = ux, bx = ox + ux * t, by = oy + uy * t;
  g.poly([bx - nx * half, by - ny * half, bx + ux * half * 0.9, by + uy * half * 0.9, bx + nx * half, by + ny * half]).fill({ color: THREAT, alpha: 0.85 * fade }).stroke({ color: THREAT_OUTLINE, width: 2, alpha: fade });
}

/**
 * Diagonal hatching inside a circle (the sapper's blast ring, phase A): chords at 45° every `step` pixels, in one path —
 * the caller strokes it.
 */
function hatchCircle(g: Graphics, X: number, Y: number, R: number, step: number): void {
  const k = Math.SQRT1_2;
  for (let s = -R + step / 2; s < R; s += step) {
    const h = Math.sqrt(Math.max(0, R * R - s * s));
    // The chord at signed distance s from the centre along the normal (k, k), direction (k, −k).
    const cx = X + k * s, cy = Y + k * s;
    g.moveTo(cx - k * h, cy + k * h).lineTo(cx + k * h, cy - k * h);
  }
}

/** A dashed segment (the wolves' pack lines, phase A), in one path — the caller strokes it. */
function dashedLine(g: Graphics, x0: number, y0: number, x1: number, y1: number, dash: number, gap: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash);
    g.moveTo(x0 + ux * t, y0 + uy * t).lineTo(x0 + ux * e, y0 + uy * e);
  }
}

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
  /** Porcupine (iteration 2.1): the raised crown of quills and the lowered quills lying flat (one of them shown). */
  quills: { up: Graphics; down: Graphics } | null;
}

/** A killed enemy: spins and shrinks for `deathDuration` (design answer 22); one that fell into a cliff also darkens. */
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
  /** Phase A (Т3): the badge strip under bodies — the role on the left, room for elite affixes on the right (over the signals). */
  private readonly badgeLayer = new Graphics();
  /** Phase A (Т3): role badges on or off — a local setting of the view (main.ts keeps it in its own storage key), not a Param. */
  showRoleBadges = true;
  /** Role badges drawn in the last frame, by role (tests read it). */
  readonly badgeRoles: Record<EnemyRole, number> = { shooter: 0, blocker: 0, punisher: 0, master: 0, diver: 0 };
  /** Wolf rush lanes drawn in the last frame (carried into `signals`). */
  private rushLaneCount = 0;
  private readonly enemyLayer = new Container();
  private readonly heroLayer = new Container();
  private readonly overlay = new Graphics();
  /** Chain lines, link highlights, candidate outlines, jump aim. */
  private readonly chainLayer = new Graphics();
  private readonly dying: DyingView[] = [];
  private readonly fxLayer = new Container();
  private readonly enemyViews = new Map<number, EnemyView>();
  /** Iteration 2.1: porcupines drawn with raised / trembling quills in the last `syncEnemies`. */
  private quillCounts = { quillsRaised: 0, quillsTrembling: 0 };
  private readonly bodyTextures = new Map<string, { texture: Texture; ax: number; ay: number }>();
  private readonly floating: FloatingText[] = [];
  /** Stage 2, step 2: blast flashes fading out. */
  private readonly bursts: { g: Graphics; life: number; total: number }[] = [];
  /** Stage 2, step 2: «−1 HP» badges over porcupine links of the drawn chain (reused texts). */
  private readonly quillLabels: Text[] = [];
  private heroArt: Container | null = null;
  private readonly heroRing = new Graphics();
  private arena: ArenaLayout | null = null;
  private clock = 0;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeAmp = 0;
  /** Screen position of the arena origin without the shake (the camera's view of the arena). */
  private readonly base = { x: 0, y: 0 };
  /** Camera: follows the hero; the view is `viewW × viewH` units, its centre is the middle of the free part of the window. */
  readonly camera = new Camera();
  private scale = 1;
  private freeW = 1280;
  private freeH = 720;
  private readonly edgeLayer = new Graphics();
  /** Off-screen pointers drawn in the last frame, by kind (tests read it). */
  readonly edgeShown = { threat: 0, goal: 0, spawn: 0 };
  private edgeInset = { left: 0, top: 70, right: 0, bottom: 60 };
  private edgeArrows: PlacedArrow[] = [];
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
  readonly signals: SignalCounts = { shields: 0, arrowLanes: 0, fuses: 0, quillBadges: 0, frozen: 0, burning: 0, elites: 0, loot: 0, quillsRaised: 0, quillsTrembling: 0, braziersLit: 0, braziersOut: 0, howls: 0, leapLines: 0, stunned: 0, beams: 0, rushLanes: 0, roleBadges: 0 };
  /** Stage 3a: terrain zones of the current arena drawn by `buildArena`. */
  readonly terrainShown: TerrainCounts = { river: 0, cliff: 0, thorns: 0 };
  /** Stage 3a (М2): enemies seen falling into a cliff so far. */
  fallsShown = 0;
  /** Stage 2, step 3: consumable flashes drawn so far, by kind (tests read it: the effect was on screen). */
  readonly itemsShown: Record<ItemKind, number> = { frost: 0, bomb: 0, healing: 0, fire: 0 };
  /** Stage 2, step 3: spin flashes shown so far (tests read it: the flash was on screen). */
  spinsShown = 0;

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
    this.root.addChild(this.staticLayer, this.objectLayer, this.markerLayer, this.laneLayer, this.rippleLayer, this.enemyLayer, this.signalLayer, this.badgeLayer, this.targetLayer, this.chainLayer, this.heroLayer, this.overlay, this.fxLayer, this.flash);
    this.app.stage.addChild(this.root, this.edgeLayer);
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

  /**
   * Sets the scale and the view (the debug panel may cover the right side). The scale fits the reference view (16×10 units,
   * `CAMERA.refW/refH`) into the free part, as the whole arena was fitted before the camera: a 16×10 arena looks the same.
   * The view shows `freeWidth / (UNIT·scale)` units across; a larger arena scrolls under the camera.
   */
  layout(freeWidth: number, height: number): void {
    const margin = 12;
    this.scale = Math.max(0.1, Math.min((freeWidth - margin * 2) / (CAMERA.refW * UNIT), (height - margin * 2) / (CAMERA.refH * UNIT)));
    this.freeW = freeWidth; this.freeH = height;
    this.root.scale.set(this.scale);
    this.camera.clamp(this.bounds());
    this.placeRoot();
  }

  /** The view in units and the arena it stays inside. */
  private bounds(): CameraBounds {
    const k = UNIT * this.scale;
    return { viewW: this.freeW / k, viewH: this.freeH / k, arenaW: this.arena?.width ?? CAMERA.refW, arenaH: this.arena?.height ?? CAMERA.refH };
  }

  /** The origin of the arena on screen from the camera: the camera's point is in the middle of the free area. */
  private placeRoot(): void {
    const k = UNIT * this.scale;
    this.base.x = Math.round(this.freeW / 2 - this.camera.x * k);
    this.base.y = Math.round(this.freeH / 2 - this.camera.y * k);
    this.root.position.set(this.base.x, this.base.y);
  }

  /**
   * A new fight (restart, a run node): the camera stands on the hero at once. A hero moved inside a fight (the test hook
   * `teleport`) is not snapped to: the camera catches up smoothly.
   */
  snapCamera(hero: Vec): void {
    this.camera.snap(hero, this.bounds());
    this.placeRoot();
  }

  /** One camera step on the drawn hero; the pointer in stage pixels becomes an arena point again for the new view. */
  private updateCamera(world: World, dt: number, ui: RenderUi): void {
    const hero = world.hero;
    let lead: Vec | null = null;
    if (ui.pointerScreen && ui.pointerOverStage !== false) {
      const p = this.toArena(ui.pointerScreen.x, ui.pointerScreen.y);
      lead = { x: p.x - hero.x, y: p.y - hero.y };
    }
    this.camera.update(ui.cameraStill ? 0 : dt, hero, lead, !!ui.cameraFrozen && !world.move, this.bounds());
    this.placeRoot();
    if (ui.pointerScreen) ui.pointer = this.toArena(ui.pointerScreen.x, ui.pointerScreen.y);
  }

  /** Is the arena point in the view (grown by `margin` units). */
  sees(p: Vec, margin = 0): boolean { return this.camera.sees(p, this.bounds(), margin); }

  /** Screen position of an arena point (tests and input use the inverse); the shake is not part of the mapping. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.base.x + x * UNIT * this.scale, y: this.base.y + y * UNIT * this.scale };
  }

  toArena(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.base.x) / (UNIT * this.scale), y: (sy - this.base.y) / (UNIT * this.scale) };
  }

  /** Camera state for tests: its centre and the view in units. */
  cameraState(): { x: number; y: number; viewW: number; viewH: number; scale: number } {
    const b = this.bounds();
    return { x: this.camera.x, y: this.camera.y, viewW: b.viewW, viewH: b.viewH, scale: this.scale };
  }

  /**
   * Pointers on the border of the view to dangers aimed at the hero and to the goals of the arena that are off screen
   * (edgeMarkers.ts): a white arrow with a dark outline for a danger (blinks), a gold one for a goal.
   */
  private drawEdgeMarkers(world: World): void {
    const g = this.edgeLayer.clear(), b = this.bounds(), counts = { threat: 0, goal: 0, spawn: 0 };
    const cx = this.freeW / 2, cy = this.freeH / 2;
    // Phase A (Т5, design answer 9): pointers to spawn markers only on an arena larger than the view.
    const large = b.arenaW > b.viewW + 1e-6 || b.arenaH > b.viewH + 1e-6;
    const items = collectEdgeMarkers(world, (p, margin) => this.camera.sees(p, b, margin), large).map(m => {
      const at = this.toScreen(m.x, m.y);
      return { dx: at.x - cx, dy: at.y - cy, kind: m.kind };
    });
    // The rectangle the arrow centres stay in: inside the free area and outside the HUD, the action bar and the jump button
    // (main.ts measures them); the arrow's own size is added.
    const e = this.edgeInset, pad = 16;
    const rect = { left: e.left + pad, top: e.top + pad, right: this.freeW - e.right - pad, bottom: this.freeH - e.bottom - pad };
    this.edgeArrows = placeEdgeArrows(items, cx, cy, rect);
    // Spawn markers first, then goals, dangers last: a danger is drawn over a goal.
    for (const a of this.edgeArrows) {
      counts[a.kind]++;
      const spawn = a.kind === 'spawn';
      const color = a.kind === 'threat' ? THREAT : spawn ? SPAWN_ARROW : TARGET;
      const alpha = a.kind === 'threat' ? 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 7)) : spawn ? 0.75 : 0.9;
      const c = Math.cos(a.angle), sn = Math.sin(a.angle), L = spawn ? 11 : 15, W = spawn ? 7 : 10;
      const pts = [a.x + c * L, a.y + sn * L, a.x - c * L * 0.6 - sn * W, a.y - sn * L * 0.6 + c * W, a.x - c * L * 0.25, a.y - sn * L * 0.25, a.x - c * L * 0.6 + sn * W, a.y - sn * L * 0.6 - c * W];
      g.poly(pts).fill({ color, alpha }).stroke({ color: THREAT_OUTLINE, width: spawn ? 2 : 3, alpha });
    }
    Object.assign(this.edgeShown, counts);
  }

  /** Pixels at each side of the window taken by HUD elements the pointers must not sit under (measured by main.ts). */
  setEdgeInset(inset: { left: number; top: number; right: number; bottom: number }): void { this.edgeInset = inset; }

  /** The pointers drawn in the last frame (stage pixels; tests check them against the HUD). */
  get edgePositions(): readonly { x: number; y: number; kind: 'threat' | 'goal' | 'spawn' }[] { return this.edgeArrows; }

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
    this.drawTerrainZones(arena.terrain ?? []);
    this.staticLayer.cacheAsTexture(false);
    this.staticLayer.cacheAsTexture({ resolution: Math.min(window.devicePixelRatio || 1, 2), antialias: true });
  }

  /**
   * Stage 3a: terrain zones under everything (simple shapes): water as the pond (a band — a wide stroke along its spine),
   * a cliff — a dark drop with a pale rim and a shadow over its edge, thorns — scrub with thorny hatching. Enemy colours stay
   * readable: the zones are darker and less saturated than the chain colours.
   */
  private drawTerrainZones(zones: readonly TerrainZone[]): void {
    const t = this.terrain, counts: TerrainCounts = { river: 0, cliff: 0, thorns: 0 };
    for (const z of zones) {
      counts[z.kind]++;
      if (z.kind === 'river') {
        if (z.shape === 'band') {
          const w = z.width * UNIT;
          spinePath(t, z.points).stroke({ color: WATER_RIM, width: w + 6, alpha: 0.6, cap: 'butt', join: 'round' });
          spinePath(t, z.points).stroke({ color: WATER, width: w, cap: 'butt', join: 'round' });
          spinePath(t, z.points).stroke({ color: WATER_LIGHT, width: w * 0.55, alpha: 0.3, cap: 'butt', join: 'round' });
          spinePath(t, z.points).stroke({ color: 0x91b7ac, width: 1.5, alpha: 0.5, cap: 'butt', join: 'round' });
        } else {
          areaPath(t, z).fill(WATER).stroke({ color: WATER_RIM, width: 3, alpha: 0.6 });
        }
        continue;
      }
      if (z.kind === 'cliff') {
        if (z.shape === 'band') spinePath(t, z.points).stroke({ color: CHASM, width: z.width * UNIT, cap: 'butt', join: 'round' });
        else {
          // The shadow straddles the edge (darkens the ground near the drop), then the drop and its pale crumbling rim.
          areaPath(t, z).stroke({ color: 0x000000, width: 16, alpha: 0.35, join: 'round' });
          areaPath(t, z).fill(CHASM);
          areaPath(t, z).stroke({ color: CHASM_RIM, width: 4, join: 'round' });
          areaPath(t, z).stroke({ color: 0xd8c690, width: 1.5, alpha: 0.5, join: 'round' });
        }
        continue;
      }
      // Thorns: dark scrub, then thorny ticks on a grid inside the zone.
      if (z.shape === 'band') spinePath(t, z.points).stroke({ color: THORN, width: z.width * UNIT, alpha: 0.8, cap: 'butt', join: 'round' });
      else areaPath(t, z).fill({ color: THORN, alpha: 0.8 }).stroke({ color: THORN_INK, width: 2, alpha: 0.7 });
      const step = 0.45, box = zoneBox(z);
      for (let y = box.y0 + step / 2; y < box.y1; y += step) for (let x = box.x0 + step / 2 + ((Math.round(y / step) % 2) * step) / 2; x < box.x1; x += step) {
        if (!areaContains(z, { x, y })) continue;
        const cx = x * UNIT, cy = y * UNIT, a = 7;
        t.moveTo(cx - a, cy + a * 0.6).lineTo(cx + a, cy - a * 0.6).moveTo(cx - a * 0.4, cy - a * 0.8).lineTo(cx + a * 0.3, cy + a * 0.7);
      }
      t.stroke({ color: THORN_INK, width: 2, alpha: 0.8, cap: 'round' });
    }
    Object.assign(this.terrainShown, counts);
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
    if (kind === 'lynx') {
      // Lynx (stage 3a): tall ears with black tufts and pale cheek ruffs (silhouette, not a color).
      for (const sx of [-1, 1]) {
        ctx.poly([sx * r * 0.2, -r * 0.82, sx * r * 0.5, -r * 1.55, sx * r * 0.82, -r * 0.6]).fill(fill).stroke({ color: NAVY, width: 3, join: 'round' });
        ctx.moveTo(sx * r * 0.5, -r * 1.55).lineTo(sx * r * 0.5, -r * 1.95).stroke({ color: NAVY, width: 4, cap: 'round' });
        ctx.poly([sx * r * 0.78, r * 0.05, sx * r * 1.32, r * 0.3, sx * r * 0.85, r * 0.6]).fill(PALE).stroke({ color: NAVY, width: 2, join: 'round' });
      }
    }
    if (kind === 'shaman') {
      // Shaman (stage 3a): a crooked staff with a glowing tip on its side and a feathered crest (silhouette, not a color).
      ctx.moveTo(r * 1.05, r * 0.95).lineTo(r * 1.2, -r * 1.25).stroke({ color: NAVY, width: 6, cap: 'round' });
      ctx.moveTo(r * 1.05, r * 0.95).lineTo(r * 1.2, -r * 1.25).stroke({ color: BONE, width: 3, cap: 'round' });
      ctx.circle(r * 1.22, -r * 1.35, r * 0.24).fill(MAGIC).stroke({ color: NAVY, width: 2.5 });
      for (const a of [-0.5, 0, 0.5]) ctx.poly([Math.sin(a) * r * 0.55, -r * 0.8, Math.sin(a) * r * 1.0 - r * 0.12, -r * 1.55, Math.sin(a) * r * 1.0 + r * 0.12, -r * 1.55]).fill(PALE).stroke({ color: NAVY, width: 2, join: 'round' });
    }
    // Porcupine (iteration 2.1): its quills go up and down — drawn per frame over the texture (`quillGraphics`).
    if (kind === 'sapper') {
      // Sapper: a black powder keg on its back with a short fuse (silhouette, not a color).
      ctx.circle(-r * 0.62, -r * 0.62, r * 0.48).fill(0x22262c).stroke({ color: NAVY, width: 3 });
      ctx.moveTo(-r * 0.85, -r * 0.98).quadraticCurveTo(-r * 1.15, -r * 1.35, -r * 0.9, -r * 1.55).stroke({ color: BONE, width: 3, cap: 'round' });
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

  /**
   * Iteration 2.1: the porcupine's quills as two drawings behind its disc — a crown of long bone quills all around
   * (raised) and short quills lying flat along its back (lowered, not sticking out). One of them is shown each frame.
   */
  private quillGraphics(): { up: Graphics; down: Graphics } {
    const r = BASE_ENEMY_RADIUS * UNIT, up = new Graphics(), down = new Graphics();
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.95 + i * (Math.PI * 1.9 / 13), c = Math.cos(a), s = Math.sin(a), w = 0.16;
      up.poly([Math.cos(a - w) * r * 0.85, Math.sin(a - w) * r * 0.85, c * r * 1.5, s * r * 1.5, Math.cos(a + w) * r * 0.85, Math.sin(a + w) * r * 0.85]).fill(BONE).stroke({ color: NAVY, width: 2, join: 'round' });
    }
    // Lowered: short quills laid back along the top of the body, hardly past its edge.
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.85 + i * (Math.PI * 0.7 / 8), w = 0.2, t = a + 0.5;
      down.poly([Math.cos(a - w) * r * 0.82, Math.sin(a - w) * r * 0.82, Math.cos(t) * r * 1.16, Math.sin(t) * r * 1.16, Math.cos(a + w) * r * 0.82, Math.sin(a + w) * r * 0.82]).fill(BONE).stroke({ color: NAVY, width: 1.5, join: 'round' });
    }
    down.visible = false;
    return { up, down };
  }

  private tusks(ctx: GraphicsContext, r: number): void {
    for (const sx of [-1, 1]) ctx.poly([sx * r * 0.32, r * 0.55, sx * r * 0.72, r * 0.98, sx * r * 0.78, r * 0.42, sx * r * 0.52, r * 0.5]).fill(BONE).stroke({ color: NAVY, width: 2.5, join: 'round' });
  }

  private buildEnemyBody(e: Enemy, look: EnemyLook): { body: Container; grey: Sprite | null; hpLabel: Text | null; exclaim: Text | null; quills: { up: Graphics; down: Graphics } | null } {
    const body = new Container();
    // Iteration 2.1: the porcupine's quills behind its disc (raised or lowered each frame).
    const quills = e.kind === 'porcupine' ? this.quillGraphics() : null;
    if (quills) body.addChild(quills.up, quills.down);
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
    return { body, grey, hpLabel, exclaim, quills };
  }

  private syncEnemies(world: World): void {
    const look = world.params.enemyLook, seen = new Set<number>();
    let quillsRaised = 0, quillsTrembling = 0;
    const scale = enemyDrawRadius(world.params) / BASE_ENEMY_RADIUS;
    // Crowd readability (design answer 10): while a chain is drawn, other colors are muted.
    const color = world.chain.length ? chainColor(world) : null;
    const mode = world.params.dimMode, strength = world.params.dimStrength;
    for (const e of world.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (view && (view.look !== look || (view.hp > 0) !== (e.hp > 0))) { view.root.destroy({ children: true }); this.enemyViews.delete(e.id); view = undefined; }
      if (!view) {
        const root = new Container(), { body, grey, hpLabel, exclaim, quills } = this.buildEnemyBody(e, look);
        root.addChild(body); this.enemyLayer.addChild(root);
        view = { root, body, grey, hpLabel, exclaim, hp: e.hp, look, quills };
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
      // Stage 2, step 3: an elite is drawn larger (its body stays).
      view.root.scale.set(scale * pop * (e.elite ? world.params.eliteArtScale : 1));
      view.root.zIndex = e.y;
      // Camera: bodies off screen are not drawn (a margin keeps a body half in view and its strike lunge).
      view.root.visible = this.sees(e, 1.5);
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
      // Iteration 2.1: the quills up — the crown; down — lying flat; trembling (going up soon) — the flat quills shake and
      // half rise. Frozen: down (the cold takes them off).
      if (view.quills) {
        const up = quillsUp(world, e), trembling = !up && quillsWarning(world, e);
        view.quills.up.visible = up; view.quills.down.visible = !up;
        if (trembling) {
          const shake = Math.sin(this.clock * 70 + e.id) * 3;
          view.quills.down.position.set(shake, -Math.abs(shake) * 0.4); view.quills.down.scale.set(1.22);
        } else { view.quills.down.position.set(0, 0); view.quills.down.scale.set(1); }
        if (up) quillsRaised++;
        if (trembling) quillsTrembling++;
      }
    }
    this.quillCounts = { quillsRaised, quillsTrembling };
    for (const [id, view] of this.enemyViews) if (!seen.has(id)) { view.root.destroy({ children: true }); this.enemyViews.delete(id); }
    this.enemyLayer.sortableChildren = true;
  }

  private drawMarkers(world: World): void {
    const g = this.markerLayer.clear(), r = enemyDrawRadius(world.params) * UNIT;
    for (const m of world.markers) {
      if (!this.sees(m, 1.5)) continue;
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
   * Phase A (Т3, design answer 11): the rush lane of each howling wolf, the same strip of its body width from the wolf to
   * the end of its rush (`wolfRushLine`), filling as the howl runs out and fading while it rushes.
   * Wolf pack lines: wolves within the pack radius of each other — dashed and faint (phase A: alpha 0.3).
   */
  private drawLanes(world: World): void {
    const g = this.laneLayer.clear(), p = world.params, half = enemyBodyRadius(p) * UNIT;
    let lanes = 0, packs = 0, rushes = 0;
    for (const e of world.enemies) {
      if (e.kind !== 'boar' || (e.boar !== 'windup' && e.boar !== 'charge')) continue;
      lanes++;
      const left = e.boar === 'windup' ? p.boarRange : Math.max(0, p.boarRange - e.charged);
      const len = left * UNIT + half, k = e.boar === 'windup' && p.boarWindup > 0 ? 1 - Math.max(0, e.boarTimer) / p.boarWindup : 1;
      const fade = e.boar === 'charge' ? 0.5 : 1;
      threatStrip(g, e.x * UNIT, e.y * UNIT, e.dirX, e.dirY, len, half, k, fade);
      stripHead(g, e.x * UNIT, e.y * UNIT, e.dirX, e.dirY, len, half, fade);
    }
    for (const e of world.enemies) {
      const rush = wolfRushLine(world, e);
      if (!rush || rush.len <= 0) continue;
      rushes++;
      const fade = rush.rushing ? 0.5 : 1, len = rush.len * UNIT;
      threatStrip(g, e.x * UNIT, e.y * UNIT, rush.dx, rush.dy, len, half, rush.progress, fade);
      stripHead(g, e.x * UNIT, e.y * UNIT, rush.dx, rush.dy, len, half, fade);
    }
    const wolves = world.enemies.filter(e => e.kind === 'wolf');
    for (let i = 0; i < wolves.length; i++) for (let j = i + 1; j < wolves.length; j++) {
      const a = wolves[i], b = wolves[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > p.wolfPackRadius) continue;
      packs++;
      dashedLine(g, a.x * UNIT, a.y * UNIT, b.x * UNIT, b.y * UNIT, 10, 8);
    }
    if (packs) g.stroke({ color: PALE, width: 3, alpha: 0.3, cap: 'round' });
    this.visibleLanes = lanes;
    this.visiblePackLines = packs;
    this.rushLaneCount = rushes;
  }

  /**
   * Signals of the new enemies (stage 2, step 2; docs/realtime-slice.md, section 4, column «Сигнал»):
   * - the shieldbearer: a thick steel arc of the shield width in front of it, turning with the shield (gone while frozen);
   * - the archer: its announced line — a strip of the threat color (as the boar's lane) that fills up during the windup;
   * - the sapper: a burning fuse — sparks at the bomb and a ring growing to the blast radius while it burns (on the living
   *   sapper lit by touch, and where a dead one lies); a blast flashes (`handleEvents`).
   * Phase A (Т3, design answer 11): every danger is hatched; the blast circle is in the threat colour (the sparks stay
   * orange); the howl is a thin circle without fill (the rush lanes are `drawLanes`); the lynx's stun stars are pale; the
   * shaman's beam is a thin wavy thread; the shield keeps its arc without the wedge.
   */
  private drawSignals(world: World): void {
    const g = this.signalLayer.clear(), p = world.params, r = enemyDrawRadius(p) * UNIT;
    const counts: SignalCounts = { shields: 0, arrowLanes: 0, fuses: 0, quillBadges: this.signals.quillBadges, frozen: 0, burning: 0, elites: 0, loot: world.objects.filter(o => o.kind === 'loot').length, ...this.quillCounts, braziersLit: this.signals.braziersLit, braziersOut: this.signals.braziersOut, howls: 0, leapLines: 0, stunned: 0, beams: 0, rushLanes: this.rushLaneCount, roleBadges: 0 };
    // Stage 3a (П1): the wolves howl — a thin threat circle on the ring round the hero, no fill (phase A: the rush lanes of
    // the wolves carry the timing).
    const howl = wolfHowl(world);
    if (howl) {
      counts.howls++;
      const X = world.hero.x * UNIT, Y = world.hero.y * UNIT, R = p.wolfRingRadius * UNIT;
      g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 3.5, alpha: 0.55 });
      g.circle(X, Y, R).stroke({ color: THREAT, width: 1.5, alpha: 0.8 });
    }
    const fuse = (x: number, y: number, left: number, total: number): void => {
      counts.fuses++;
      const k = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 1, R = p.sapperRadius * UNIT, X = x * UNIT, Y = y * UNIT;
      // Phase A: the blast circle in the threat colour, hatched; the ring grows to it while the fuse burns.
      g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.06 + 0.1 * k });
      hatchCircle(g, X, Y, R, 0.32 * UNIT);
      g.stroke({ color: THREAT, width: 2, alpha: 0.45 });
      g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 4, alpha: 0.6 });
      g.circle(X, Y, R).stroke({ color: THREAT, width: 2, alpha: 0.9 });
      g.circle(X, Y, Math.max(2, R * k)).stroke({ color: THREAT, width: 3, alpha: 0.95 });
      // Sparks of the fuse: short rays turning with the clock (the view's own clock: drawing only).
      for (let i = 0; i < 6; i++) {
        const a = this.clock * 9 + i * Math.PI / 3, l = r * (0.35 + 0.25 * Math.abs(Math.sin(this.clock * 23 + i)));
        g.moveTo(X, Y - r * 0.9).lineTo(X + Math.cos(a) * l, Y - r * 0.9 + Math.sin(a) * l);
      }
      g.stroke({ color: SPARK, width: 3, cap: 'round' });
    };
    for (const b of world.blasts) fuse(b.x, b.y, b.timeLeft, b.total);
    for (const e of world.enemies) {
      const lit = sapperFuse(world, e);
      if (lit) fuse(e.x, e.y, lit.left, lit.total);
      const line = archerLine(world, e);
      if (line) {
        counts.arrowLanes++;
        const half = line.half * UNIT, ux = e.vars.dx, uy = e.vars.dy, nx = -uy, ny = ux, ox = line.from.x * UNIT, oy = line.from.y * UNIT;
        const len = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y) * UNIT;
        threatStrip(g, ox, oy, ux, uy, len, half, line.progress, 1, 0.4);
        // The arrow head at the filling front.
        const tx = ox + ux * len * line.progress, ty = oy + uy * len * line.progress;
        g.poly([tx + ux * half * 1.6, ty + uy * half * 1.6, tx - nx * half * 1.3, ty - ny * half * 1.3, tx + nx * half * 1.3, ty + ny * half * 1.3]).fill(THREAT).stroke({ color: THREAT_OUTLINE, width: 2 });
      }
      // Stage 3a (П2): the lynx's leap line — a strip of its body width (threat colour) filling during the windup, fading in
      // the leap; stunned — three stars turning over it.
      const leap = lynxLine(world, e);
      if (leap) {
        counts.leapLines++;
        const half = enemyBodyRadius(p) * UNIT, ux = leap.dx, uy = leap.dy, nx = -uy, ny = ux, ox = e.x * UNIT, oy = e.y * UNIT, len = leap.len * UNIT;
        const fade = leap.leaping ? 0.5 : 1;
        threatStrip(g, ox, oy, ux, uy, len, half, leap.progress, fade, 0.35);
        // Claw marks at the landing point.
        const tx = ox + ux * len, ty = oy + uy * len;
        for (const k of [-0.5, 0, 0.5]) g.moveTo(tx + nx * half * k - ux * half * 0.4, ty + ny * half * k - uy * half * 0.4).lineTo(tx + nx * half * k + ux * half * 0.5, ty + ny * half * k + uy * half * 0.5);
        g.stroke({ color: THREAT, width: 3, alpha: 0.9 * fade, cap: 'round' });
      }
      if (lynxStunned(e)) {
        counts.stunned++;
        const X = e.x * UNIT, Y = e.y * UNIT - r * 1.25;
        for (let i = 0; i < 3; i++) {
          const a = this.clock * 5 + i * Math.PI * 2 / 3, sx = X + Math.cos(a) * r * 0.6, sy = Y + Math.sin(a) * r * 0.22, pts: number[] = [];
          for (let j = 0; j < 10; j++) { const b = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? r * 0.07 : r * 0.17; pts.push(sx + Math.cos(b) * rr, sy + Math.sin(b) * rr); }
          g.poly(pts).fill(PALE).stroke({ color: THREAT_OUTLINE, width: 1.5 });
        }
      }
      // Stage 3a (П4): the shaman's beam — phase A: a thin wavy violet thread to its target (no body width, no threat
      // outline: it is magic on an enemy, not a danger to the hero); a ring round the target fills as it runs.
      const beam = shamanBeam(world, e);
      if (beam) {
        counts.beams++;
        const X = e.x * UNIT, Y = e.y * UNIT, TX = beam.target.x * UNIT, TY = beam.target.y * UNIT;
        const dx = TX - X, dy = TY - Y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, steps = Math.max(6, Math.round(d / 6));
        g.moveTo(X, Y);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, w = Math.sin(t * d / 14 - this.clock * 12) * 3 * Math.sin(t * Math.PI);
          g.lineTo(X + dx * t + nx * w, Y + dy * t + ny * w);
        }
        g.stroke({ color: MAGIC, width: 2, alpha: 0.6 + 0.35 * beam.progress, cap: 'round', join: 'round' });
        g.circle(TX, TY, r * 1.2).stroke({ color: MAGIC, width: 3, alpha: 0.9 });
        g.moveTo(TX, TY - r * 1.2).arc(TX, TY, r * 1.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * beam.progress).stroke({ color: PALE, width: 4, alpha: 0.95 });
      }
      // Stage 2, step 3: an elite — a thick gold rim around its (larger) drawing.
      if (e.elite) {
        counts.elites++;
        const R = r * p.eliteArtScale * 1.06;
        g.circle(e.x * UNIT, e.y * UNIT, R).stroke({ color: NAVY, width: 7, alpha: 0.9 }).circle(e.x * UNIT, e.y * UNIT, R).stroke({ color: TARGET, width: 4 });
      }
      // Stage 2, step 3: the cold — an icy ring (a double ring while the next chain hit on it is ×2); burning — flames.
      if ((e.chill ?? 0) > 0) {
        counts.frozen++;
        const X = e.x * UNIT, Y = e.y * UNIT;
        g.circle(X, Y, r * 1.08).fill({ color: ICE, alpha: 0.32 }).stroke({ color: 0xeaf6ff, width: 3, alpha: 0.95 });
        if (brittleNow(e)) g.circle(X, Y, r * 1.3).stroke({ color: ICE, width: 2, alpha: 0.9 });
      }
      if (e.burn) {
        counts.burning++;
        const X = e.x * UNIT, Y = e.y * UNIT - r * 0.9;
        for (let i = 0; i < 3; i++) {
          const fx = X + (i - 1) * r * 0.42, h = r * (0.55 + 0.25 * Math.abs(Math.sin(this.clock * 11 + i * 1.7 + e.id)));
          g.poly([fx - r * 0.18, Y, fx, Y - h, fx + r * 0.18, Y]).fill({ color: SPARK, alpha: 0.95 }).stroke({ color: 0x7a2a12, width: 1.5 });
        }
      }
      if (!shieldUp(world, e)) continue;
      counts.shields++;
      const x = e.x * UNIT, y = e.y * UNIT, half = Math.min(Math.PI, p.shieldArc * Math.PI / 360), f = e.vars.facing ?? 0, R = r * 1.22;
      g.moveTo(x + Math.cos(f - half) * R, y + Math.sin(f - half) * R).arc(x, y, R, f - half, f + half).stroke({ color: NAVY, width: 11, cap: 'round' });
      g.moveTo(x + Math.cos(f - half) * R, y + Math.sin(f - half) * R).arc(x, y, R, f - half, f + half).stroke({ color: STEEL, width: 6, cap: 'round' });
    }
    Object.assign(this.signals, counts);
  }

  /**
   * Phase A (Т3): the badge strip under each body, centred at y ≈ 1.25·r (lower under an elite: ×`eliteArtScale`). Its slots
   * go left to right: the role first (`roles.ts`; the presser and the reaper have none), then — track Т4, not yet — the
   * affixes of an elite. A slot is a dark rounded plaque with a pale glyph about 12 px across, the same size on screen at
   * any scale. Bodies off screen get none; while a chain is drawn the badges of other colours fade with their bodies.
   */
  private drawBadges(world: World): void {
    const g = this.badgeLayer.clear(), p = world.params, r = enemyDrawRadius(p) * UNIT;
    const counts: Record<EnemyRole, number> = { shooter: 0, blocker: 0, punisher: 0, master: 0, diver: 0 };
    let total = 0;
    if (this.showRoleBadges) {
      const color = world.chain.length ? chainColor(world) : null, strength = p.dimStrength;
      const px = 1 / Math.max(0.1, this.scale), glyph = BADGE_GLYPH_PX * px, plate = BADGE_PLAQUE_PX * px, gap = 2 * px;
      for (const e of world.enemies) {
        if (e.color === NO_COLOR || !this.sees(e, 1.5)) continue;
        const slots: EnemyRole[] = [];
        const role = roleOf(e.kind);
        if (role) slots.push(role);
        // Т4 (second pass): the affixes of an elite go here, after the role.
        if (!slots.length) continue;
        const alpha = color !== null && e.color !== color ? 1 - strength : 1;
        // Under an elite: below its larger drawing and its gold rim.
        const y = e.y * UNIT + r * 1.25 * (e.elite ? p.eliteArtScale : 1) + (e.elite ? plate * 0.6 : 0);
        const width = slots.length * plate * 2 + (slots.length - 1) * gap;
        let x = e.x * UNIT - width / 2 + plate;
        for (const slot of slots) {
          g.roundRect(x - plate, y - plate, plate * 2, plate * 2, plate * 0.45).fill({ color: BADGE_PLAQUE, alpha: 0.85 * alpha }).stroke({ color: PALE, width: px, alpha: 0.35 * alpha });
          drawRoleGlyph(g, slot, x, y, glyph, PALE, alpha);
          counts[slot]++; total++;
          x += plate * 2 + gap;
        }
      }
    }
    Object.assign(this.badgeRoles, counts);
    this.signals.roleBadges = total;
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
    let lit = 0, out = 0;
    for (const o of world.objects) {
      const x = o.x * UNIT, y = o.y * UNIT;
      if (o.kind === 'brazier') {
        // Stage 3a (М4): an iron bowl on three legs; burning — flickering flames; put out — grey ash and the ring of its cooldown.
        g.ellipse(x, y + R * 0.75, R * 0.8, R * 0.25).fill({ color: 0x050a07, alpha: 0.45 });
        g.moveTo(x - R * 0.5, y + R * 0.75).lineTo(x - R * 0.3, y + R * 0.2).moveTo(x + R * 0.5, y + R * 0.75).lineTo(x + R * 0.3, y + R * 0.2).stroke({ color: NAVY, width: 4, cap: 'round' });
        g.ellipse(x, y + R * 0.15, R * 0.85, R * 0.42).fill(o.out === undefined ? 0x3a3530 : 0x45443f).stroke({ color: NAVY, width: 3 });
        if (o.out === undefined) {
          lit++;
          const f = 0.85 + 0.15 * Math.sin(this.clock * 11 + o.id * 1.7), h = R * 1.25 * f;
          g.circle(x, y - R * 0.2, R * 1.25).fill({ color: EMBER, alpha: 0.1 + 0.08 * pulse });
          g.poly([x - R * 0.6, y + R * 0.05, x - R * 0.15, y - h, x + R * 0.1, y - h * 0.35, x + R * 0.35, y - h * 0.85, x + R * 0.62, y + R * 0.05]).fill(EMBER).stroke({ color: 0x5a1e0c, width: 2 });
          g.poly([x - R * 0.3, y + R * 0.05, x - R * 0.05, y - h * 0.6, x + R * 0.3, y + R * 0.05]).fill(FLAME);
        } else {
          out++;
          g.ellipse(x, y + R * 0.08, R * 0.6, R * 0.22).fill(ASH);
          const total = Math.max(0.01, world.params.brazierCooldown), k = Math.max(0, Math.min(1, o.out / total));
          g.arc(x, y, R * 1.2, -Math.PI / 2, -Math.PI / 2 + (1 - k) * Math.PI * 2).stroke({ color: ASH, width: 3, alpha: 0.8 });
        }
        continue;
      }
      if (o.kind === 'loot') {
        // Stage 2, step 3: the loot of an elite — a consumable (a flask of its colour) or a resource (a small bundle), bobbing.
        const bob = Math.sin(this.clock * 3 + o.id) * 2, cy = y + bob, color = LOOT_COLOR[o.loot ?? ''] ?? 0xd8c690, item = ['frost', 'bomb', 'healing', 'fire'].includes(o.loot ?? '');
        g.ellipse(x, y + R * 0.7, R * 0.55, R * 0.18).fill({ color: 0x050a07, alpha: 0.4 });
        g.circle(x, cy, R * 1.05).fill({ color: TARGET, alpha: 0.12 + 0.12 * pulse }).stroke({ color: TARGET, width: 2, alpha: 0.6 });
        if (item) g.roundRect(x - R * 0.42, cy - R * 0.5, R * 0.84, R * 1.05, R * 0.3).fill(color).stroke({ color: NAVY, width: 3 }).rect(x - R * 0.16, cy - R * 0.78, R * 0.32, R * 0.3).fill(BONE).stroke({ color: NAVY, width: 2 });
        else g.poly([x - R * 0.55, cy + R * 0.4, x, cy - R * 0.55, x + R * 0.55, cy + R * 0.4]).fill(color).stroke({ color: NAVY, width: 3 });
        continue;
      }
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
    this.signals.braziersLit = lit; this.signals.braziersOut = out;
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
      if (ev.type === 'blast') {
        const flash = new Graphics().circle(0, 0, ev.radius * UNIT).fill({ color: SPARK, alpha: 0.55 }).stroke({ color: 0xfff2c4, width: 4 });
        flash.position.set(ev.x * UNIT, ev.y * UNIT);
        this.fxLayer.addChild(flash);
        this.bursts.push({ g: flash, life: 0.35, total: 0.35 });
        if (world.params.shakeOnDamage) { this.shakeLeft = this.shakeTotal = 0.15; this.shakeAmp = Math.max(this.shakeAmp, 6); }
        continue;
      }
      if (ev.type === 'spin') {
        // Stage 2, step 3: the spin (Q) — a pale ring of its circle around the hero, widening and fading.
        const ring = new Graphics().circle(0, 0, ev.radius * UNIT).fill({ color: 0xbfe3ff, alpha: 0.18 }).stroke({ color: 0xffffff, width: 5, alpha: 0.95 });
        ring.position.set(ev.x * UNIT, ev.y * UNIT);
        this.fxLayer.addChild(ring);
        this.bursts.push({ g: ring, life: 0.3, total: 0.3 });
        this.spinsShown++;
        continue;
      }
      if (ev.type === 'item') {
        // Stage 2, step 3: a consumable acts — cold: an icy circle; bomb: a hot burst on the target; fire: an orange ring;
        // healing: «+N» over the hero.
        this.itemsShown[ev.kind]++;
        if (ev.kind === 'healing') { this.floatText(`+${world.params.itemHeal} HP`, ev.x * UNIT, ev.y * UNIT - 46, 0x8fd18a); continue; }
        const color = ev.kind === 'frost' ? ICE : SPARK, radius = Math.max(ev.radius, 0.6) * UNIT;
        const burst = new Graphics().circle(0, 0, radius).fill({ color, alpha: ev.kind === 'bomb' ? 0.55 : 0.25 }).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
        burst.position.set(ev.x * UNIT, ev.y * UNIT);
        this.fxLayer.addChild(burst);
        this.bursts.push({ g: burst, life: 0.35, total: 0.35 });
        continue;
      }
      if (ev.type === 'loot') {
        // Stage 2, step 3: the loot of an elite fell, or the hero picked it up.
        if (ev.picked) this.floatText(`+ ${LOOT_TITLE[ev.loot] ?? ev.loot}`, ev.x * UNIT, ev.y * UNIT - 36, 0xffd36b);
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
        // Stage 3a (М2): a fall into a cliff — the body darkens as it spins down.
        if (ev.fall) { view.root.tint = 0x3a3a3a; this.fallsShown++; }
        this.dying.push({ root: view.root, life: total, total, spin: Math.random() < 0.5 ? -1 : 1, scale: view.root.scale.x });
        continue;
      }
      if (ev.type === 'crystal') { this.floatText('◆ кристалл', ev.x * UNIT, ev.y * UNIT - 36, 0xf4efe0); continue; }
      // Stage 3a (П4): the shaman's beam made its target tough.
      if (ev.type === 'enemySignal' && ev.signal === 'empower') { this.floatText('крепче', ev.x * UNIT, ev.y * UNIT - 36, MAGIC); continue; }
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

  /** Stage 2, step 3: a short note at an arena point (why a consumable was not used). */
  notice(text: string, x: number, y: number): void { this.floatText(text, x * UNIT, y * UNIT - 30, 0xf2e6c8); }

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
    for (const label of this.quillLabels) label.visible = false;
    this.signals.quillBadges = 0;
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
      if (heroAnchorOn(world)) {
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
    // Stage 2, step 2: a link that will hurt the hero (the porcupine's quills) — a red «−N HP» badge over it while the chain
    // is drawn. Iteration 2.1: through the common hook (`armedDamage` → `EnemyBehavior.armed`): the damage it really does now
    // (an elite +1), and any kind with an armed reaction gets the badge.
    let quills = 0;
    for (const lp of plan.links) {
      const pt = linkPoint(world, lp.link);
      if (!pt || !lp.outcome) continue;
      const linked = lp.link.kind === 'enemy' ? world.enemies.find(e => e.id === lp.link.id) : undefined;
      const armed = linked ? armedDamage(world, linked) : 0;
      if (armed > 0) {
        quills++;
        const label = this.quillLabel(quills - 1);
        label.text = `−${armed} HP`;
        label.position.set(pt.x * UNIT, pt.y * UNIT - r * 1.55);
        label.visible = true;
      }
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
    this.signals.quillBadges = quills;
  }

  /** Stage 2, step 2: the `i`-th «−1 HP» badge of porcupine links (a pool of texts over the chain layer). */
  private quillLabel(i: number): Text {
    while (this.quillLabels.length <= i) {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 'bold', fill: 0xff8a73, stroke: { color: 0x200c08, width: 5 } } });
      text.anchor.set(0.5, 1);
      text.visible = false;
      this.root.addChild(text);
      this.quillLabels.push(text);
    }
    return this.quillLabels[i];
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) { b.g.destroy(); this.bursts.splice(i, 1); continue; }
      const k = b.life / b.total;
      b.g.alpha = k; b.g.scale.set(1 + (1 - k) * 0.25);
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
    this.updateCamera(world, realDt, ui);
    this.applyShake(realDt);
    this.handleEvents(world);
    this.updateFloating(realDt);
    this.updateBursts(realDt);
    this.updateDying(realDt);
    this.drawObjects(world);
    this.drawMarkers(world);
    this.drawLanes(world);
    this.drawRipples(world);
    this.syncEnemies(world);
    this.drawSignals(world);
    this.drawBadges(world);
    this.drawTargets(world);
    this.drawChain(world, ui);
    this.drawHero(world);
    this.drawOverlay(world);
    this.drawJuice(world, realDt);
    this.drawEdgeMarkers(world);
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
    for (const b of this.bursts) b.g.destroy();
    this.bursts.length = 0;
    for (const view of this.enemyViews.values()) view.root.destroy({ children: true });
    this.enemyViews.clear();
    for (const d of this.dying) d.root.destroy({ children: true });
    this.dying.length = 0;
  }
}

/** Bounding box of a zone (units). */
function zoneBox(area: Area): { x0: number; y0: number; x1: number; y1: number } {
  if (area.shape === 'circle') return { x0: area.x - area.r, y0: area.y - area.r, x1: area.x + area.r, y1: area.y + area.r };
  if (area.shape === 'rect') return { x0: area.x, y0: area.y, x1: area.x + area.w, y1: area.y + area.h };
  const pad = area.shape === 'band' ? area.width / 2 : 0, xs = area.points.map(p => p.x), ys = area.points.map(p => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}
