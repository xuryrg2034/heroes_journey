/**
 * PixiJS view of the real-time arena (src/realtime/view). Reads the simulation's world, never changes it.
 * Terrain and the hero reuse the art of the turn-based game (src/realtime/art/art.ts: drawTerrain, makePlayer);
 * enemies are colored discs with the chain sigil (or the melee illustration),
 * which keeps 60+ enemies cheap: each disc is a sprite of one pre-rendered texture per color.
 * Stage 3: wolf ears and pack lines, boar tusks with the charge lane (threat color, hatched)
 * and «!», target reticles of marked enemies, buttons and the door.
 * Stage 2 of the transition, step 2 (docs/realtime-slice.md, section 4): the signals of the new enemies — the shield
 * arc of the shieldbearer, the archer's line, the sapper's fuse and blast ring (`drawSignals`); the porcupine's quills (its
 * drawing) and the «−1 HP» badge on a porcupine link of the drawn chain (`drawChain`).
 */
import { Application, Container, Graphics, GraphicsContext, Sprite, Text, type Texture } from 'pixi.js';
import { COLORS, PALE, drawTerrain, makePlayer } from '../art/art';
import { characterSprite } from '../art/characterAssets';
import type { ArenaLayout } from '../sim/arenas';
import { OBJECT_RADIUS, armedDamage, canJump, chainAnchor, chainColor, colorShiftIds, colorShiftLeft, heroAnchorOn, jumpLanding, linkPoint, loopCandidates, nextCandidates, nextObjectCandidates, planChain, type ChainPlan } from '../sim/chain';
import { enemyArtScale } from '../sim/enemies/kinds';
import { BOAR_ART_SCALE, archerLine, archerMark, lynxLine, lynxStunned, quillsUp, quillsWarning, sapperFuse, shamanBeam, shieldUp, wolfHowl, wolfRushLine } from '../sim/enemies/index';
import { brittleNow } from '../sim/items';
import { chameleonWarn, eliteAffixes, eliteArmorView, type AffixId } from '../sim/elites';
import { activeEliteBehavior, boarLane, formationOf } from '../sim/eliteBehaviors';
import { NewSeenStore, KIND_CAPTIONS, AFFIX_CAPTIONS } from './newSeen';
import { ELITE_LEMON, PLAQUE_FADE, PLAQUE_LIFE, drawPlatePips, drawWindowPulse, plaqueText, platesWord } from './eliteView';
import type { ItemKind } from '../sim/kit';
import { areaContains, inWater, type Area, type TerrainZone, type Vec } from '../sim/geometry';
import { Camera, CAMERA, placeEdgeArrows, type CameraBounds, type PlacedArrow } from './camera';
import { collectEdgeMarkers } from './edgeMarkers';
import { drawRoleGlyph, roleOf, type EnemyRole } from './roles';
import { enemyBodyRadius, enemyDrawRadius, heroRadius, type EnemyLook } from '../sim/params';
import { NO_COLOR, SECOND_WIND_HP, doorOpen, focusGuarded, touchDistance, type Enemy, type EnemyKind, type World, type WorldEvent } from '../sim/world';
import { itemHealOf, linkRadiusOf } from '../sim/build';
import { FIRE_LIFE, FIRE_RADIUS, hammerFirePoints } from '../sim/hammers';
import { HAMMERS } from '../sim/buildIds';
import { fireTextOf } from './buildColumn';
import { findLoopHint, type LoopHintFigure } from './loopHint';
// Casino stage 1: «Однорукий гоблин» (the idol, the reels, the odds line; the arrow marks are drawn in `drawSignals`).
import { SlotView } from './slotView';
import { slotPlanOdds } from '../sim/slotPlan';
import { hordeGroup } from './hordeView';
import { BagView } from './bagView';
import { FEAT_DOOR_GAP, FeatDoorView } from './featView';
import { planPowerNumber } from './powerNumber';
import { SLOT_BUST_SOURCE } from '../sim/slot';
import { bustBlink } from './bustBlink';
import { dashCheque } from '../sim/purse';
import { chainFeel, DashLinks, QUIET_LINKS } from './chainFeel';
import { LINK_DEPTH_SHOWN, linkDepths, type LinkDepth } from '../sim/linkDepth';
import { CHEST_CURSE_KILLS, cursed } from '../sim/chest';

/**
 * Phase B (Т5, design 10.10.2026): the chain colours of the real-time view. Red, green and blue are those of the turn-based
 * art (`COLORS`, read only); the yellow of the chain becomes ochre `c8962e` — under deuteranopia the old `d8b66a` stood
 * close to the gold of goals and elites (ΔE2000 8.7; ochre against the lemon `ffff66` — 21.3). A fifth colour, if any,
 * keeps the turn-based one. `art/art.ts` is not changed.
 */
export const CHAIN_COLORS: readonly number[] = [COLORS[0], COLORS[1], COLORS[2], 0xc8962e, ...COLORS.slice(4)];
/** The view colour of chain colour `index` (out of range — the last one, as a guard). */
const chainInk = (index: number): number => CHAIN_COLORS[index] ?? CHAIN_COLORS[CHAIN_COLORS.length - 1];
/** The part of `SealPreview` the view reads. */
type SealPreviewLike = NonNullable<ReturnType<typeof planChain>['seal']>;
/** Loop research, step 3: the plan's pierce the view reads. */
type PiercePreviewLike = NonNullable<ReturnType<typeof planChain>['pierce']>;
/**
 * Phase B (design answer 23): the effects of the player's build — a pale-blue rim (the spin's colour), no hatching and no
 * dark threat outline: the wave, the hammer's blast, the cut, the fire of the dash; the player's bomb too (apart from the
 * sapper's blast).
 */
export const PLAYER_FX = 0xbfe3ff;
/** The dash and the return run of the hammer «Возврат» are drawn alike (a halo, the combo counter). */
const dashLike = (world: World): boolean => world.move?.kind === 'dash' || world.move?.kind === 'return';
/** Phase B: seconds the cut trail along the dash path stays (design answer 23: 0.2 s). */
const CUT_TRAIL_TIME = 0.2;
/**
 * Phase B: the fire of the hammer «Огненный проход» — its module's points (`World.build['fire-pass'].points`,
 * sim/hammers.ts `hammerFirePoints`: `{ x, y, life }`), circles of `FIRE_RADIUS` fading by `life / FIRE_LIFE`. The only
 * source: the `hammer` `fire` events are not drawn (the state is the fire).
 */
export function hammerFireOf(world: World): { x: number; y: number; k: number; r: number }[] {
  return hammerFirePoints(world).map(p => ({ x: p.x, y: p.y, k: Math.max(0, Math.min(1, p.life / FIRE_LIFE)), r: FIRE_RADIUS }));
}

/** Phase B: effects of the player's build shown so far (fire and cut trail — in the last frame; tests read them). */
export interface PlayerEffectCounts { waves: number; blasts: number; cuts: number; cutTrail: number; cutFrames: number; fire: number; bombs: number; returns: number }

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
/** Task 5б: real seconds the bust's spark to the hero lasts. */
const BUST_SPARK_LIFE = 0.4;
/** П3 «Финальная цепь»: real seconds of the final flash of a chain into the door (the result screen waits as long, main.ts). */
export const FINAL_FLASH = 0.8;
/** П2: real seconds of the hero's outline flash at the end of a 6–9 link dash. */
const OUTLINE_LIFE = 0.4;
/** Casino «Котёл»: the cheque stands this many pixels over the hero (where the score popup «+N» starts: above the combo counter). */
const CHEQUE_ABOVE = 122;
/** Task 8b: the power number's foot over the hero's centre (px of the arena) — over the head; the HP bar is under the hero. */
const POWER_ABOVE = 40;
const POWER_WARM = 0xffb86b;
const POWER_RED = 0xff5a4a;
/** Threat color outside the chain palette (design answer 18): white with a dark outline — spawn markers, stage 3 boar lanes. */
export const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const REAPER_FILL = 0x1b1b24;
const NAVY = 0x18232d;
const BASE_ENEMY_RADIUS = 0.4;
/** Boar art is drawn a bit larger than the crowd (its body circle stays the same); the link reach uses the same scale. */
const BOAR_SCALE = BOAR_ART_SCALE;
const BONE = 0xeadbb9;
/**
 * Target reticle of marked enemies, the rim of elites, the goal arrows, the button rings, the loot halo: lemon, outside the
 * chain sigils (phase B, Т5: was the gold `ffd36b`, close to the yellow chain under deuteranopia; `FLAME` keeps that gold).
 */
export const TARGET = 0xffff66;
/** Shield of the shieldbearer: cold steel with a pale rim (outside the chain palette). */
const STEEL = 0xa9b8c6;
/** Fuse sparks of the sapper and flames: hot orange (outside the chain palette; phase A: the blast circle is THREAT). */
/** Task 7: the red of the goblin's lit bust circle. */
const BUST_RED = 0xe0402f;
const SPARK = 0xffb04a;
/** Stage 3a (П4): the shaman's beam — violet magic, outside the chain palette. */
const MAGIC = 0xc58cff;
/** Phase A (Т5): pointers to spawn markers off screen on a large arena — a cold pale grey, apart from the white of a
 * danger and the gold of a goal; smaller and steady (no blinking). */
const SPAWN_ARROW = 0xc9d5de;
/** Task 6: the words over a struck elite («−1 пластина», «окно») rise this many px over it (the power number stands up to ~75 px over the hero) — over the chain power number, which stands beside the hero (the hero is at the elite when it strikes). */
const ELITE_WORD_UP = 120;
/** Review 12.10.2026: an elite at the top edge (the words would stand under the HUD plate or off the screen) gets its words UNDER it, this many px below its centre, drifting down — as its plaques (`stackUnderHud`). */
const ELITE_WORD_DOWN = 78;
/** Phase A (Т3): the plaque of a badge under a body and the ink of its glyph. */
const BADGE_PLAQUE = 0x10171d;
/** Phase A (Т3): the badge glyph in screen pixels (its half size) and the plaque around it. */
const BADGE_GLYPH_PX = 6;
const BADGE_PLAQUE_PX = 9;
/**
 * Phase A (Т4): short labels of elite affixes in the badge strip (readable at ~11 px) and their ink — a hint of the rule:
 * fire warm, the chameleon pale, the swift cold, the fat bone.
 */
const AFFIX_SHORT: Readonly<Record<AffixId, string>> = { fiery: 'Огн', chameleon: 'Хам', swift: 'Стрем', fat: 'Толст' };
const AFFIX_INK: Readonly<Record<AffixId, number>> = { fiery: 0xffa25a, chameleon: 0xf2dfb4, swift: 0xa9dcff, fat: 0xeadbb9 };
/** Phase A (Т4): the affix label in screen pixels. */
const AFFIX_FONT_PX = 11;
/** At most this many affix labels under one body (design: do not overload). */
const AFFIX_MAX_SHOWN = 2;
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
export interface SignalCounts { shields: number; arrowLanes: number; fuses: number; quillBadges: number; frozen: number; burning: number; elites: number; loot: number; quillsRaised: number; quillsTrembling: number; braziersLit: number; braziersOut: number; howls: number; leapLines: number; stunned: number; beams: number; rushLanes: number; roleBadges: number; archerMarks: number; affixLabels: number; trailPoints: number; chameleonWarns: number; bustCircles: number }

/** Stage 3a: terrain zones drawn by `buildArena` (tests read it: the river, the cliff, the thorns are on screen). */
export interface TerrainCounts { river: number; cliff: number; thorns: number }

/** Stage 3a: colours of the terrain — water as the pond, a dark drop with a pale rim, thorny scrub. */
const WATER = 0x243c3d, WATER_RIM = 0x73918a, WATER_LIGHT = 0x548b88;
const CHASM = 0x07090a, CHASM_RIM = 0x9a8a66;
const THORN = 0x2b3a1d, THORN_INK = 0x9a8452;
/** Stage 3a (М4): the brazier's fire and the grey of a brazier put out. */
const EMBER = 0xff8a3a, FLAME = 0xffd36b, ASH = 0x7a7a72;
/** П8: the colour of the caption plates (lavender: not the elite's lemon, not the player's pale blue). */
const CAPTION_COLOR = 0xc8b0ff;
/** К7 «Проклятый сундук»: the curse's violet (the chest's eye and chain glow, the hero's border, the counter). */
const CURSE = 0xb57cff, CURSE_DARK = 0x2a1440;
/** «Щит фокуса»: the hero's rim while the drawn chain guards him (the focus bar's blue) and its dark outline. */
const FOCUS_GUARD = 0x8fd3ff, NAVY_RIM = 0x18232d;
/** Task 13: the glow of the after-chain shield and its block spark (warm gold, unlike the focus guard's pale blue). */
const SHIELD_GLOW = 0xffd36b;

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
  /** The colour the disc was drawn in (phase A: «Хамелеон» changes colour — the body is rebuilt). */
  color: number;
  /** Porcupine (iteration 2.1): the raised crown of quills and the lowered quills lying flat (one of them shown). */
  quills: { up: Graphics; down: Graphics } | null;
}

/** A killed enemy: spins and shrinks for `deathDuration` (design answer 22); one that fell into a cliff also darkens. */
interface DyingView { root: Container; life: number; total: number; spin: number; scale: number }

interface FloatingText { text: Text; life: number; vy: number }

/**
 * The chain sigil of a colour: triangle, cross, square, ring (colour 3 — explicit, phase B, Т5); any other colour gets a
 * fallback sign — a diamond — so a fifth colour never borrows the ring.
 */
function drawSigil(g: GraphicsContext, color: number, size: number, ink: number, y = 0): void {
  const s = size;
  if (color === 0) g.poly([0, y - s, s * 0.95, y + s * 0.75, -s * 0.95, y + s * 0.75]).fill(ink);
  else if (color === 1) g.rect(-s * 0.3, y - s, s * 0.6, s * 2).rect(-s, y - s * 0.3, s * 2, s * 0.6).fill(ink);
  else if (color === 2) g.rect(-s * 0.8, y - s * 0.8, s * 1.6, s * 1.6).stroke({ color: ink, width: s * 0.4 });
  else if (color === 3) g.circle(0, y, s * 0.8).stroke({ color: ink, width: s * 0.4 });
  else g.poly([0, y - s, s * 0.85, y, 0, y + s, -s * 0.85, y]).stroke({ color: ink, width: s * 0.35 });
}

/** П1 «Глубина звена»: render frames between two searches of the same drawn chain (design answer 11.10.2026). */
export const LINK_DEPTH_FRAMES = 6;

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
  /** Phase A (Т6): the archers' marks seen in the last frame (id → point and progress): a mark gone at the end of its fill
   * flashes where it was (the arrow fell); one gone early (the archer died, the fight ended) does not. */
  private archerMarksSeen = new Map<number, { x: number; y: number; r: number; progress: number }>();
  /** Arrow-fall flashes shown so far (tests read it). */
  arrowFlashes = 0;
  /** Casino stage 1 («Однорукий гоблин»): the idol view; the arrow marks drawn in the last frame and the falls flashed so far. */
  readonly slotView = new SlotView(UNIT);
  /** Task 14 «Котомка у двери»: the sack beside the open door, its marks and number (view/bagView.ts). */
  readonly bagView = new BagView(UNIT);
  /** Task 16 «Подвиги»: the feat's small line by the open door while it is not done (view/featView.ts). */
  readonly featDoor = new FeatDoorView(UNIT);
  slotMarks = 0;
  slotFlashes = 0;
  /** Phase A (Т4): the fire trail of «Огненный» elites — ground under the crowd. */
  private readonly trailLayer = new Graphics();
  /** Fire trail points drawn in the last frame (carried into `signals`). */
  private trailCount = 0;
  /** Phase A (Т4): texts of the affix labels in the badge strip (a pool over `badgeLayer`). */
  private readonly affixTextLayer = new Container();
  private readonly affixTexts: Text[] = [];
  /** Elite armour (package «Урон имеет значение»): plate pips, the window pulse and the plaques over elites (over the badges). */
  private readonly eliteLayer = new Graphics();
  private readonly elitePlaqueLayer = new Container();
  /** Elites already announced with a plaque (by id), and the plaques now on screen. */
  private readonly plaqued = new Set<number>();
  private readonly plaques = new Map<number, { box: Container; until: number }>();
  /**
   * П8 «Новое на карте»: the one-time captions of a kind / an elite affix (newSeen.ts) — plates like the elite's, in the arena
   * layer, 1.5 s at the enemy. `newSeen` is set by main.ts for a run only (the sandbox has none: it neither reads nor writes
   * the memory); `live` — a run fight is on screen; `on` — the toggle «Новое на карте» (off: memory is still written, nothing drawn).
   */
  newSeen: { store: NewSeenStore; live(): boolean; on(): boolean; meet?(id: string): void } | null = null;
  private readonly captionLayer = new Container();
  private readonly captions: { id: number; box: Container; until: number; slot: number }[] = [];
  /** What the captions drew (tests read it): the texts shown since the last reset, and the plates on screen now. */
  readonly captionShown = { texts: [] as string[], live: 0 };
  /** «−1 пластина» badges over armoured links of the drawn chain (reused texts). */
  private readonly plateLabels: Text[] = [];
  /** What the elite view drew (tests read it): last-frame counts and totals since the last reset. */
  readonly eliteShown = { markers: 0, pips: 0, filledPips: 0, windows: 0, hotWindows: 0, planPlates: 0, formationLines: 0, secondLanes: 0, plaques: 0, plaquesSeen: 0, plaqueText: '', stripFlashes: 0, downFlashes: 0, cleanBreaks: 0, edgeArrows: 0 };
  /** Wolf rush lanes drawn in the last frame (carried into `signals`). */
  private rushLaneCount = 0;
  private readonly enemyLayer = new Container();
  private readonly heroLayer = new Container();
  private readonly overlay = new Graphics();
  /** Chain lines, link highlights, candidate outlines, jump aim. */
  private readonly chainLayer = new Graphics();
  private readonly dying: DyingView[] = [];
  private readonly fxLayer = new Container();
  /** The prologue's lamps, hand and smoke (view/prologueView.ts): arena pixels, over the heroes, under the floating texts. */
  readonly prologueLayer = new Container();
  private readonly enemyViews = new Map<number, EnemyView>();
  /** Iteration 2.1: porcupines drawn with raised / trembling quills in the last `syncEnemies`. */
  private quillCounts = { quillsRaised: 0, quillsTrembling: 0 };
  private readonly bodyTextures = new Map<string, { texture: Texture; ax: number; ay: number }>();
  private readonly floating: FloatingText[] = [];
  /** Task 7: the goblin's area busts that went off on screen (tests read it). */
  bustBlastsShown = 0;
  /** Task 5б: the sparks from a bursting idol to the hero (see `bustSpark`). */
  private readonly sparks: { g: Graphics; fx: number; fy: number; tx: number; ty: number; life: number; seed: number }[] = [];
  /** Stage 2, step 2: blast flashes fading out. */
  private readonly bursts: { g: Graphics; life: number; total: number; grow?: boolean }[] = [];
  /** Stage 2, step 2: «−1 HP» badges over porcupine links of the drawn chain (reused texts). */
  private readonly quillLabels: Text[] = [];
  /**
   * П1 «Глубина звена»: the number next to each next-link candidate ring — how many enemy links the chain could take from it
   * on (sim/linkDepth.ts). A local setting of the view (main.ts keeps it in its own storage key), not a Param.
   */
  showLinkDepth = true;
  /** The numbers last computed (candidate id → depth), the drawn chain they were computed for, render frames since. */
  private depthCache = new Map<number, LinkDepth>();
  private depthChain = '';
  private depthFrames = 0;
  private readonly depthLabels: Text[] = [];
  /**
   * What «Глубина звена» drew in the last frame and its cost (tests and the snapshot read it): `labels` — candidate id and
   * number shown; `computes` — searches run so far; `lastMs` / `maxMs` — the real milliseconds of the last and the
   * longest search (all candidates of one frame).
   */
  readonly linkDepthShown: { labels: { id: number; depth: number }[]; computes: number; lastMs: number; maxMs: number } = { labels: [], computes: 0, lastMs: 0, maxMs: 0 };
  /** Loop research, step 2: the hit numbers on enemies inside a closed ring (reused texts). */
  private readonly sealLabels: Text[] = [];
  /**
   * Loop research, step 2: what the loop drew (tests read it): `candidates` — «замкни» rings shown on an open chain, `closed` — a
   * closed ring filled, `marks` — enemies marked inside it, `flashes` — outline flashes shown so far (release and strike), `hint` —
   * the experiment's highlighted figure is on screen.
   */
  readonly loopShown = { candidates: 0, closed: 0, marks: 0, flashes: 0, hint: 0 };
  /**
   * Loop research, step 3 («Прямая»): what the pierce drew (tests read it): `arrow` — the arrow of the drawn chain's pierce is on
   * screen, `marks` — corridor bodies marked with their outcome, `end` — the end mark; `releases` / `ends` — `pierce` events seen
   * so far (fixed at a release, a run that reached its end).
   */
  readonly pierceShown = { arrow: 0, marks: 0, end: 0, releases: 0, ends: 0 };
  /** The experiment `loopHint`: the figure found at the last search (the view recomputes it every few frames, never in the sim). */
  private hintFigure: LoopHintFigure | null = null;
  private hintFrame = 0;
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
  /** The top band of the window taken by the HUD plate: the view starts under it. */
  private freeTop = 0;
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
  readonly signals: SignalCounts = { shields: 0, arrowLanes: 0, fuses: 0, quillBadges: 0, frozen: 0, burning: 0, elites: 0, loot: 0, quillsRaised: 0, quillsTrembling: 0, braziersLit: 0, braziersOut: 0, howls: 0, leapLines: 0, stunned: 0, beams: 0, rushLanes: 0, roleBadges: 0, archerMarks: 0, affixLabels: 0, trailPoints: 0, chameleonWarns: 0, bustCircles: 0 };
  /** Stage 3a: terrain zones of the current arena drawn by `buildArena`. */
  readonly terrainShown: TerrainCounts = { river: 0, cliff: 0, thorns: 0 };
  /** Stage 3a (М2): enemies seen falling into a cliff so far. */
  fallsShown = 0;
  /** Stage 2, step 3: consumable flashes drawn so far, by kind (tests read it: the effect was on screen). */
  readonly itemsShown: Record<ItemKind, number> = { frost: 0, bomb: 0, healing: 0, fire: 0 };
  /** Stage 2, step 3: spin flashes shown so far (tests read it: the flash was on screen). */
  spinsShown = 0;
  /** Phase B (Д5): effects of the player's build — waves, blasts, cuts, bombs, return runs so far; fire points and cut trail segments in the last frame, frames with a cut trail so far. */
  readonly playerEffects: PlayerEffectCounts = { waves: 0, blasts: 0, cuts: 0, cutTrail: 0, cutFrames: 0, fire: 0, bombs: 0, returns: 0 };
  /** Phase B (Д5): the radius R of the circle around the hero in the last frame, in units (`linkRadiusOf`). */
  heroReachRadius = 0;
  /** Phase B (Д5): short texts at the hero for fired items so far (`talismanFired`). */
  talismanTexts = 0;
  /** П9 «Второе дыхание»: flashes with the text «второе дыхание» shown at the hero so far (tests read it). */
  secondWindShown = 0;
  /** The text of the last second wind shown (tests read it). */
  secondWindText = '';
  /**
   * П2 «Тихая мелочь, громкая цепь» (view/chainFeel.ts): enemy links of the dash as released — the shake, the sound (main.ts)
   * and the sandbox «+N» follow them.
   */
  readonly dashLinks = new DashLinks();
  /**
   * П2 (tests read it): pop-ups over the hero at the end of a dash (the cheque or the sandbox «+N»), dashes that ended quietly
   * (1–2 links: no pop-up), flashes of the hero's outline (6–9 links). П3: final flashes of a chain into the door.
   */
  readonly feelShown = { popups: 0, quiet: 0, outlines: 0, finals: 0 };
  /** П2: real seconds left of the hero's outline flash. */
  private outlineLeft = 0;
  /** Phase B: the cut trail and the fire of the hammer drawn per frame (the fire under the crowd, the trail over it). */
  private readonly playerFxLayer = new Graphics();
  /** The hero's path in the current or last dash / return run (view memory, age in real seconds) for the cut trail. */
  private dashTrail: { x: number; y: number; age: number }[] = [];
  /** A `cut` event came in the current move: its trail is drawn even without the hammer in the kit (test modules). */
  private cutSeen = false;

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
    this.root.addChild(this.staticLayer, this.objectLayer, this.markerLayer, this.trailLayer, this.laneLayer, this.rippleLayer, this.enemyLayer, this.signalLayer, this.badgeLayer, this.affixTextLayer, this.eliteLayer, this.elitePlaqueLayer, this.captionLayer, this.slotView.layer, this.targetLayer, this.chainLayer, this.slotView.textLayer, this.bagView.layer, this.featDoor.layer, this.playerFxLayer, this.heroLayer, this.overlay, this.prologueLayer, this.fxLayer, this.flash);
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
      const dashing = dashLike(world);
      const kills = dashing ? world.move!.kills : world.lastChain?.kills ?? 0;
      if (!dashing) this.comboLife = Math.max(0, this.comboLife - dt);
      const show = world.params.comboCounter && kills > 0 && (dashing || this.comboLife > 0);
      text.visible = show;
      if (show) {
        if (kills !== this.comboValue) { this.comboValue = kills; text.text = `×${kills}`; text.scale.set(1.35); }
        this.comboShown = Math.max(this.comboShown, kills);
        const s = Math.max(1, text.scale.x - dt * 3);
        text.scale.set(s);
        // Task 8b: the power number holds the place over the head — the combo stands over it (beside it «2 ×2» read as a product).
        const power = this.powerText?.visible ? this.powerText : null;
        text.position.set(world.hero.x * UNIT, power ? world.hero.y * UNIT - POWER_ABOVE - power.height + 4 : world.hero.y * UNIT - 52);
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
  layout(freeWidth: number, height: number, top = 0): void {
    this.freeW = freeWidth; this.freeH = height; this.freeTop = top;
    this.fitScale();
    this.camera.clamp(this.bounds());
    this.placeRoot();
  }

  /**
   * The scale from the window and the arena. The reference view (16×10) is fitted into the whole free part — a larger arena
   * keeps this zoom and scrolls under the camera, its view starting below the HUD plate. An arena that fits the reference
   * view (16×10) is fitted into the part under the plate (`freeTop`), so its top row is not hidden by the plate.
   */
  private fitScale(): void {
    const margin = 12;
    let scale = Math.min((this.freeW - margin * 2) / (CAMERA.refW * UNIT), (this.freeH - margin * 2) / (CAMERA.refH * UNIT));
    const a = this.arena;
    if (!a || (a.width <= CAMERA.refW && a.height <= CAMERA.refH)) scale = Math.min(scale, (this.freeH - this.freeTop - margin * 2) / (CAMERA.refH * UNIT));
    this.scale = Math.max(0.1, scale);
    this.root.scale.set(this.scale);
  }

  /** The view in units and the arena it stays inside. */
  private bounds(): CameraBounds {
    const k = UNIT * this.scale;
    return { viewW: this.freeW / k, viewH: (this.freeH - this.freeTop) / k, arenaW: this.arena?.width ?? CAMERA.refW, arenaH: this.arena?.height ?? CAMERA.refH };
  }

  /** The origin of the arena on screen from the camera: the camera's point is in the middle of the free area. */
  private placeRoot(): void {
    const k = UNIT * this.scale;
    this.base.x = Math.round(this.freeW / 2 - this.camera.x * k);
    this.base.y = Math.round(this.freeTop + (this.freeH - this.freeTop) / 2 - this.camera.y * k);
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
    const cx = this.freeW / 2, cy = this.freeTop + (this.freeH - this.freeTop) / 2;
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
    this.eliteShown.edgeArrows = this.edgeArrows.filter(a => a.kind === 'goal').length;
  }

  /** Pixels at each side of the window taken by HUD elements the pointers must not sit under (measured by main.ts). */
  setEdgeInset(inset: { left: number; top: number; right: number; bottom: number }): void { this.edgeInset = inset; }

  /** The pointers drawn in the last frame (stage pixels; tests check them against the HUD). */
  get edgePositions(): readonly { x: number; y: number; kind: 'threat' | 'goal' | 'spawn' }[] { return this.edgeArrows; }

  buildArena(arena: ArenaLayout): void {
    this.arena = arena;
    this.fitScale();
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
    const fill = grey ? greyOf(chainInk(color)) : chainInk(color);
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
      plaque.circle(0, r * 0.62, r * 0.34).fill(chainInk(e.color)).stroke({ color: NAVY, width: 2 });
      drawSigil(plaque.context, e.color, r * 0.19, NAVY, r * 0.62);
      body.addChild(plaque);
    }
    let hpLabel: Text | null = null;
    if (e.hp > 0 && e.leader) {
      // Task 12: the leader's HP — the number a chain must beat: the HP badge's place (top right, clear of the face), half as large
      // again, a gold rim and a bright number.
      const badge = new Graphics().circle(r * 0.85, -r * 0.8, r * 0.56).fill(0x233039).stroke({ color: NAVY, width: 5 }).circle(r * 0.85, -r * 0.8, r * 0.56).stroke({ color: TARGET, width: 3 });
      hpLabel = new Text({ text: String(e.hp), style: { fontFamily: 'Georgia, serif', fontSize: 28, fontWeight: 'bold', fill: 0xfff2c4 } });
      hpLabel.anchor.set(0.5); hpLabel.position.set(r * 0.85, -r * 0.8);
      body.addChild(badge, hpLabel);
    } else if (e.hp > 0) {
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
    let dimmed = 0;
    for (const e of world.enemies) {
      seen.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (view && (view.look !== look || view.color !== e.color || (view.hp > 0) !== (e.hp > 0))) { view.root.destroy({ children: true }); this.enemyViews.delete(e.id); view = undefined; }
      if (!view) {
        const root = new Container(), { body, grey, hpLabel, exclaim, quills } = this.buildEnemyBody(e, look);
        root.addChild(body); this.enemyLayer.addChild(root);
        view = { root, body, grey, hpLabel, exclaim, hp: e.hp, look, color: e.color, quills };
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
      // Stage 2, step 3: an elite is drawn larger (its body stays); task 12 — a leader too (`enemyArtScale`, the sim's own scale).
      view.root.scale.set(scale * pop * enemyArtScale(world.params, e));
      view.root.zIndex = e.y;
      // Camera: bodies off screen are not drawn (a margin keeps a body half in view and its strike lunge).
      view.root.visible = this.sees(e, 1.5);
      const dim = color !== null && e.color !== color ? strength : 0;
      if (dim > 0 && view.root.visible) dimmed++;
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
    this.dimmedShown = dimmed;
    for (const [id, view] of this.enemyViews) if (!seen.has(id)) { view.root.destroy({ children: true }); this.enemyViews.delete(id); }
    this.enemyLayer.sortableChildren = true;
  }

  private drawMarkers(world: World): void {
    const g = this.markerLayer.clear(), r = enemyDrawRadius(world.params) * UNIT;
    let eliteMarkers = 0;
    for (const m of world.markers) {
      if (!this.sees(m, 1.5)) continue;
      const x = m.x * UNIT, y = m.y * UNIT, k = m.total > 0 ? 1 - m.timeLeft / m.total : 1;
      // The package: a marker announcing an elite (decided as it appears) is larger, with a lemon rim under the countdown.
      const big = m.elite ? 1.4 : 1, rr = r * big, s = rr * 0.6;
      if (m.elite) {
        eliteMarkers++;
        g.circle(x, y, rr * 1.18).stroke({ color: NAVY, width: 7, alpha: 0.55 });
        g.circle(x, y, rr * 1.18).stroke({ color: ELITE_LEMON, width: 4, alpha: 0.75 + 0.25 * Math.sin(this.clock * 6) });
      }
      const pulse = 0.6 + 0.4 * Math.sin(this.clock * 14);
      const rim = m.color === NO_COLOR ? THREAT : chainInk(m.color);
      // Rim in the color of the coming enemy, filling up as the countdown runs.
      g.circle(x, y, rr * 0.95).stroke({ color: rim, width: 3, alpha: 0.35 });
      // moveTo first: otherwise the arc is joined by a line from the previous path point (the arena corner).
      g.moveTo(x, y - rr * 0.95).arc(x, y, rr * 0.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k).stroke({ color: rim, width: 4, alpha: 0.95 });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT_OUTLINE, width: 9, alpha: pulse, cap: 'round' });
      g.moveTo(x - s, y - s).lineTo(x + s, y + s).moveTo(x + s, y - s).lineTo(x - s, y + s).stroke({ color: THREAT, width: 4.5, alpha: pulse, cap: 'round' });
    }
    this.eliteShown.markers = eliteMarkers;
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
    let lanes = 0, packs = 0, rushes = 0, secondLanes = 0;
    for (const e of world.enemies) {
      // The lane comes from the sim (`boarLane`): the windup fills by its own length — the 0.6 s second windup of the elite
      // boar's «Двойной рывок» counts from `boarSecondWindup`, not from `boarWindup`.
      const lane = boarLane(world, e);
      if (!lane) continue;
      lanes++;
      const len = lane.len * UNIT + half, fade = lane.charging ? 0.5 : 1;
      threatStrip(g, e.x * UNIT, e.y * UNIT, lane.dx, lane.dy, len, half, lane.progress, fade);
      stripHead(g, e.x * UNIT, e.y * UNIT, lane.dx, lane.dy, len, half, fade);
      // The second charge is a new telegraph along a new line: a lemon rim round the strip and a second head.
      if (lane.second) {
        secondLanes++;
        const nx = -lane.dy, ny = lane.dx, ox = e.x * UNIT, oy = e.y * UNIT, w = half * 1.28;
        g.poly([ox - nx * w, oy - ny * w, ox + lane.dx * len - nx * w, oy + lane.dy * len - ny * w, ox + lane.dx * len + nx * w, oy + lane.dy * len + ny * w, ox + nx * w, oy + ny * w])
          .stroke({ color: ELITE_LEMON, width: 3, alpha: 0.85 * fade });
        stripHead(g, e.x * UNIT, e.y * UNIT, lane.dx, lane.dy, len - half * 1.1, half, fade);
      }
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
    // «Ведёт строем»: a faint line in the colour of the column from the leader through its followers in slot order.
    let columns = 0;
    for (const e of world.enemies) {
      if (!e.elite || e.kind !== 'basic') continue;
      const followers = formationOf(world, e);
      if (!followers.length) continue;
      columns++;
      let prev: { x: number; y: number } = e;
      for (const f of followers) { dashedLine(g, prev.x * UNIT, prev.y * UNIT, f.x * UNIT, f.y * UNIT, 8, 7); prev = f; }
      g.stroke({ color: chainInk(e.color), width: 3, alpha: 0.5, cap: 'round' });
    }
    this.eliteShown.formationLines = columns;
    this.eliteShown.secondLanes = secondLanes;
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
    const counts: SignalCounts = { shields: 0, arrowLanes: 0, fuses: 0, quillBadges: this.signals.quillBadges, frozen: 0, burning: 0, elites: 0, loot: world.objects.filter(o => o.kind === 'loot').length, ...this.quillCounts, braziersLit: this.signals.braziersLit, braziersOut: this.signals.braziersOut, howls: 0, leapLines: 0, stunned: 0, beams: 0, rushLanes: this.rushLaneCount, roleBadges: 0, archerMarks: 0, affixLabels: 0, trailPoints: this.trailCount, chameleonWarns: 0, bustCircles: 0 };
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
    // Task 7 (design 13.10.2026, «Взрыв по площади»): the lit idol — a red circle of the blast's radius that blinks the whole
    // fuse (faster as it burns), hatched, with the ring growing to its edge; nobody is hit until it goes off. Task 19: the blink runs
    // on the fuse's own time (`bustBlink`), bright at «lit».
    const bustCircle = (x: number, y: number, R0: number, left: number, total: number): void => {
      counts.bustCircles++;
      const k = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 1, R = R0 * UNIT, X = x * UNIT, Y = y * UNIT;
      const blink = bustBlink(left, total);
      g.circle(X, Y, R).fill({ color: BUST_RED, alpha: 0.1 + 0.18 * blink });
      hatchCircle(g, X, Y, R, 0.4 * UNIT);
      g.stroke({ color: BUST_RED, width: 2, alpha: 0.35 + 0.25 * blink });
      g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 6, alpha: 0.7 });
      g.circle(X, Y, R).stroke({ color: BUST_RED, width: 3.5, alpha: 0.6 + 0.4 * blink });
      // Task 19: the countdown ring on a dark under-stroke — it reads over the hatching and the crowd in the run's 0.6 s.
      g.circle(X, Y, Math.max(2, R * k)).stroke({ color: THREAT_OUTLINE, width: 8, alpha: 0.55 });
      g.circle(X, Y, Math.max(2, R * k)).stroke({ color: 0xffe08a, width: 5, alpha: 0.95 });
      for (let i = 0; i < 6; i++) {
        const a = this.clock * 9 + i * Math.PI / 3, l = r * (0.45 + 0.3 * Math.abs(Math.sin(this.clock * 23 + i)));
        g.moveTo(X, Y).lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l);
      }
      g.stroke({ color: SPARK, width: 3, cap: 'round' });
    };
    for (const b of world.blasts) {
      if (b.bust) bustCircle(b.x, b.y, b.radius, b.timeLeft, b.total);
      else fuse(b.x, b.y, b.timeLeft, b.total);
    }
    const marks = new Map<number, { x: number; y: number; r: number; progress: number }>();
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
      // Phase A (Т6): the archer's mark — a hatched threat circle at the fixed point, filling as the windup runs (a frozen
      // archer keeps it, the fill waits); the arrow falls at the end (a flash, `drawArcherFlashes`). No flight of the arrow.
      const mark = archerMark(world, e);
      if (mark) {
        counts.archerMarks++;
        marks.set(e.id, { x: mark.at.x, y: mark.at.y, r: mark.r, progress: mark.progress });
        const X = mark.at.x * UNIT, Y = mark.at.y * UNIT, R = mark.r * UNIT;
        g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.16 });
        if (mark.progress > 0) g.circle(X, Y, R * Math.min(1, mark.progress)).fill({ color: THREAT, alpha: 0.28 });
        hatchCircle(g, X, Y, R, 0.32 * UNIT);
        g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
        g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(X, Y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
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
        // Phase A (Т4): «Хамелеон» in its window — the rim blinks the colour it turns to (a chain of any colour takes it now).
        const warn = chameleonWarn(world, e);
        if (warn) counts.chameleonWarns++;
        const rim = warn && Math.floor(this.clock * 8) % 2 === 0 ? chainInk(warn.next) : TARGET;
        g.circle(e.x * UNIT, e.y * UNIT, R).stroke({ color: NAVY, width: 7, alpha: 0.9 }).circle(e.x * UNIT, e.y * UNIT, R).stroke({ color: rim, width: warn ? 5 : 4 });
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
    // Phase A (Т6): a mark gone right at the end of its fill — the arrow fell there: a short flash. Gone earlier (the archer
    // died, frozen and bombed, the fight ended) — no flash.
    if (world.status === 'playing') for (const [id, m] of this.archerMarksSeen) {
      if (marks.has(id) || m.progress < 0.85) continue;
      const flash = new Graphics().circle(0, 0, m.r * UNIT).fill({ color: THREAT, alpha: 0.5 }).stroke({ color: THREAT_OUTLINE, width: 4 });
      flash.position.set(m.x * UNIT, m.y * UNIT);
      this.fxLayer.addChild(flash);
      this.bursts.push({ g: flash, life: 0.25, total: 0.25 });
      this.arrowFlashes++;
    }
    this.archerMarksSeen = marks;
    Object.assign(this.signals, counts);
    // Casino stage 1 («Однорукий гоблин»): the arrows of the rain and the volley — the archer's mark (a hatched threat circle
    // filling until the arrow falls); the fall flashes on its `land` event (`handleEvents`).
    let slotMarks = 0;
    if (world.status === 'playing') for (const m of world.slot?.marks ?? []) {
      slotMarks++;
      const X = m.x * UNIT, Y = m.y * UNIT, R = m.r * UNIT, progress = m.total > 0 ? Math.max(0, Math.min(1, 1 - m.left / m.total)) : 1;
      g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.16 });
      if (progress > 0) g.circle(X, Y, R * progress).fill({ color: THREAT, alpha: 0.28 });
      hatchCircle(g, X, Y, R, 0.32 * UNIT);
      g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
      g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(X, Y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
    }
    this.slotMarks = slotMarks;
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
    let total = 0, labels = 0;
    const color = world.chain.length ? chainColor(world) : null, strength = p.dimStrength;
    const px = 1 / Math.max(0.1, this.scale), glyph = BADGE_GLYPH_PX * px, plate = BADGE_PLAQUE_PX * px, gap = 2 * px;
    for (const e of world.enemies) {
      if (e.color === NO_COLOR || !this.sees(e, 1.5)) continue;
      const role = this.showRoleBadges ? roleOf(e.kind) : null;
      // Phase A (Т4): the affixes of an elite are rules of the fight — shown whatever the role toggle says, at most two.
      const affixes = e.elite ? eliteAffixes(e).slice(0, AFFIX_MAX_SHOWN) : [];
      if (!role && !affixes.length) continue;
      const alpha = color !== null && e.color !== color ? 1 - strength : 1;
      // Under an elite: below its larger drawing and its gold rim.
      const y = e.y * UNIT + r * 1.25 * enemyArtScale(p, e) + (e.elite ? plate * 0.6 : 0);
      const texts = affixes.map(id => { const t = this.affixText(labels++); t.text = AFFIX_SHORT[id]; t.style.fill = AFFIX_INK[id]; t.scale.set(px / 2); return t; });
      const widths = [...(role ? [plate * 2] : []), ...texts.map(t => t.width + plate * 0.9)];
      let x = e.x * UNIT - (widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)) / 2;
      if (role) {
        g.roundRect(x, y - plate, plate * 2, plate * 2, plate * 0.45).fill({ color: BADGE_PLAQUE, alpha: 0.85 * alpha }).stroke({ color: PALE, width: px, alpha: 0.35 * alpha });
        drawRoleGlyph(g, role, x + plate, y, glyph, PALE, alpha);
        counts[role]++; total++;
        x += plate * 2 + gap;
      }
      texts.forEach((t, i) => {
        const w = widths[(role ? 1 : 0) + i];
        g.roundRect(x, y - plate, w, plate * 2, plate * 0.45).fill({ color: BADGE_PLAQUE, alpha: 0.85 * alpha }).stroke({ color: AFFIX_INK[affixes[i]], width: px, alpha: 0.55 * alpha });
        t.position.set(x + w / 2, y);
        t.alpha = alpha;
        t.visible = true;
        x += w + gap;
      });
    }
    for (let i = labels; i < this.affixTexts.length; i++) this.affixTexts[i].visible = false;
    Object.assign(this.badgeRoles, counts);
    this.signals.roleBadges = total;
    this.signals.affixLabels = labels;
  }

  /** Tests read it: the power number's rectangle (stage px, null — hidden) and the floating words now (text and rectangle). */
  floatRects(): { power: { left: number; top: number; right: number; bottom: number } | null; words: { text: string; left: number; top: number; right: number; bottom: number }[] } {
    const box = (t: Text) => { const b = t.getBounds(); return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }; };
    return { power: this.powerText?.visible ? box(this.powerText) : null, words: this.floating.map(f => ({ text: f.text.text, ...box(f.text) })) };
  }

  /** Tests read it: the rectangles (stage px) of the elite plaques and the caption plates on screen now. */
  plateRects(): { kind: 'plaque' | 'caption'; enemyId: number; left: number; top: number; right: number; bottom: number }[] {
    const rect = (kind: 'plaque' | 'caption', enemyId: number, box: Container) => { const b = box.getBounds(); return { kind, enemyId, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }; };
    return [...[...this.plaques.entries()].filter(([, p]) => p.box.visible && p.box.alpha > 0).map(([id, p]) => rect('plaque', id, p.box)), ...this.captions.filter(c => c.box.visible && c.box.alpha > 0).map(c => rect('caption', c.id, c.box))];
  }

  /** Would a stack standing `liftPx` screen px over the arena y `top` (drawing px) reach the HUD plate or the screen top? */
  private stackUnderHud(top: number, liftPx: number): boolean {
    return this.base.y + top * this.scale - liftPx < this.freeTop + 6;
  }
  /** The y (drawing px) of the top of a stack UNDER an enemy: below its chips (the world label dodges the plates, `WorldLabelLayer`). */
  /** Where a word over a struck elite at arena y `y` (drawing px) goes: `ELITE_WORD_UP` over it, or under it when that would reach the HUD plate or the screen top. `extra` — a further lift (the second word). */
  private eliteWord(y: number, extra = 0): { y: number; dir: number } {
    const up = y - ELITE_WORD_UP - extra;
    return this.base.y + (up - 34) * this.scale < this.freeTop + 6 ? { y: y + ELITE_WORD_DOWN + extra, dir: 45 } : { y: up, dir: -45 };
  }
  private underElite(e: Enemy, y: number, R: number, px: number): number {
    return y + R + (e.elite ? 34 : 8) * px;
  }

  /**
   * Elite armour and presence (package «Урон имеет значение», docs/realtime-design-research.md, 4.3): over an armoured elite a
   * row of plate pips (filled — left, empty — lost, the growing one has a ring); at 0 plates a lemon pulse with a clock ring
   * (the window); over any new elite a plaque «Элита · <поведение>» for `PLAQUE_LIFE` seconds. Drawn in screen-sized units.
   */
  private drawElites(world: World): void {
    const g = this.eliteLayer.clear(), p = world.params, px = 1 / Math.max(0.1, this.scale), shown = this.eliteShown;
    let pips = 0, filled = 0, windows = 0, hot = 0;
    for (const e of world.enemies) {
      if (!e.elite) continue;
      const R = enemyDrawRadius(p) * UNIT * p.eliteArtScale * 1.06, x = e.x * UNIT, y = e.y * UNIT;
      const seen = this.sees(e, 1.5);
      if (seen) {
        const a = eliteArmorView(e);
        if (a) {
          if (a.open > 0) { windows++; if (a.clean > 0) hot++; drawWindowPulse(g, x, y, R, a.open, Math.max(0.01, p.eliteWindow), this.clock, px, a.clean); }
          const d = drawPlatePips(g, x, y, R, a, p.elitePlateRegrow, px);
          pips += d.pips; filled += d.filled;
        }
      }
      // The plaque of a newcomer: once per elite, 1.5 s of real time.
      if (!this.plaqued.has(e.id)) {
        this.plaqued.add(e.id);
        const label = plaqueText(activeEliteBehavior(world, e)?.title);
        const text = new Text({ text: label, style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: 'bold', fill: ELITE_LEMON } });
        text.anchor.set(0.5, 0.5); text.scale.set(0.5);
        const w = text.width + 14, h = text.height + 8, box = new Container(), bg = new Graphics();
        bg.roundRect(-w / 2, -h, w, h, h * 0.4).fill({ color: 0x16202a, alpha: 0.92 }).stroke({ color: ELITE_LEMON, width: 1.5, alpha: 0.9 });
        text.position.set(0, -h / 2);
        box.addChild(bg, text);
        this.elitePlaqueLayer.addChild(box);
        this.plaques.set(e.id, { box, until: this.clock + PLAQUE_LIFE });
        shown.plaquesSeen++;
        shown.plaqueText = label;
      }
      const pl = this.plaques.get(e.id);
      if (pl) {
        pl.box.visible = seen;
        pl.box.scale.set(px);
        const lift = (e.armor ? 30 : 8) + 24, boxH = pl.box.height / Math.max(1e-6, pl.box.scale.y);
        // No room over the elite (the HUD plate, the screen top): the plaque goes UNDER it, below its chips; the world label «Пластина — 1 удар» (view/worldLabels.ts) steps aside to stand clear of the plates.
        if (this.stackUnderHud(y - R, lift)) pl.box.position.set(x, this.underElite(e, y, R, px) + boxH * px);
        else pl.box.position.set(x, y - R - (e.armor ? 30 : 8) * px);
        pl.box.alpha = Math.max(0, Math.min(1, (pl.until - this.clock) / PLAQUE_FADE));
      }
    }
    for (const [id, pl] of this.plaques) {
      if (this.clock < pl.until && world.enemies.some(e => e.id === id)) continue;
      pl.box.destroy({ children: true });
      this.plaques.delete(id);
    }
    shown.pips = pips; shown.filledPips = filled; shown.windows = windows; shown.hotWindows = hot; shown.plaques = this.plaques.size;
  }

  /**
   * П8: the first enemy of a captioned kind (and each affix of an elite) that comes into view in a run fight is met for good
   * (`NewSeenStore`); with the toggle on it gets a plate of its caption — lavender, above the elite plaque when the enemy is
   * an elite, the kind's first and the affixes' above it. Memory is written with the toggle off too.
   */
  private drawCaptions(world: World): void {
    const px = 1 / Math.max(0.1, this.scale), host = this.newSeen, shown = this.captionShown;
    if (host && host.live()) {
      const on = host.on();
      for (const e of world.enemies) {
        const kindDue = KIND_CAPTIONS[e.kind] !== undefined && !host.store.hasKind(e.kind);
        const affixDue = e.affixes?.some(a => !host.store.hasAffix(a));
        if (!kindDue && !affixDue) continue;
        if (!this.sees(e, 1.5)) continue;
        let slot = 0;
        const add = (label: string): void => {
          if (!on) return;
          const text = new Text({ text: label, style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: 'bold', fill: CAPTION_COLOR } });
          text.anchor.set(0.5, 0.5); text.scale.set(0.5);
          const w = text.width + 14, h = text.height + 8, box = new Container(), bg = new Graphics();
          bg.roundRect(-w / 2, -h, w, h, h * 0.4).fill({ color: 0x1b1730, alpha: 0.92 }).stroke({ color: CAPTION_COLOR, width: 1.5, alpha: 0.9 });
          text.position.set(0, -h / 2);
          box.addChild(bg, text);
          this.captionLayer.addChild(box);
          this.captions.push({ id: e.id, box, until: this.clock + PLAQUE_LIFE, slot: slot++ });
          shown.texts.push(label);
        };
        // Task 16 telemetry: the first meeting goes to the recorder (`meet`, main.ts) — the store decided «first».
        if (kindDue && host.store.meetKind(e.kind)) { add(KIND_CAPTIONS[e.kind]); host.meet?.(`kind:${e.kind}`); }
        for (const a of e.affixes ?? []) if (!host.store.hasAffix(a) && host.store.meetAffix(a)) { add(AFFIX_CAPTIONS[a]); host.meet?.(`affix:${a}`); }
      }
    }
    const byId = new Map(world.enemies.map(e => [e.id, e] as const));
    for (let i = this.captions.length - 1; i >= 0; i--) {
      const c = this.captions[i], e = byId.get(c.id);
      if (!e || this.clock >= c.until) { c.box.destroy({ children: true }); this.captions.splice(i, 1); continue; }
      const R = enemyDrawRadius(world.params) * UNIT * (e.elite || e.leader ? enemyArtScale(world.params, e) * 1.06 : 1), lift = e.elite ? (e.armor ? 30 : 8) + 26 : 8;
      c.box.visible = this.sees(e, 1.5);
      c.box.scale.set(px);
      // The same under the HUD rule as the elite's plaque: under the elite, the plaque first and the captions after it.
      if (this.stackUnderHud(e.y * UNIT - R, lift + c.slot * 26 + 24)) {
        const boxH = c.box.height / Math.max(1e-6, c.box.scale.y);
        c.box.position.set(e.x * UNIT, this.underElite(e, e.y * UNIT, R, px) + ((e.elite ? 1 : 0) + c.slot) * 26 * px + boxH * px);
      } else c.box.position.set(e.x * UNIT, e.y * UNIT - R - (lift + c.slot * 26) * px);
      c.box.alpha = Math.max(0, Math.min(1, (c.until - this.clock) / PLAQUE_FADE));
    }
    shown.live = this.captions.length;
  }

  /** Phase A (Т4): the `i`-th affix label text (a pool; drawn at twice the font size and scaled down — crisp at any zoom). */
  private affixText(i: number): Text {
    while (this.affixTexts.length <= i) {
      const text = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: AFFIX_FONT_PX * 2, fontWeight: 'bold', fill: PALE } });
      text.anchor.set(0.5);
      text.visible = false;
      this.affixTextLayer.addChild(text);
      this.affixTexts.push(text);
    }
    return this.affixTexts[i];
  }

  /**
   * Phase A (Т4): the fire trail of «Огненный» — ground, not a telegraph: warm embers of the trail radius (no white outline,
   * no hatching), fading with the time left; a flicker keeps them alive. Reads «do not stand here» like thorns.
   */
  private drawTrails(world: World): void {
    const g = this.trailLayer.clear(), p = world.params, life = Math.max(0.01, p.trailLife), R = p.trailRadius * UNIT;
    let count = 0;
    for (const t of world.trails ?? []) {
      if (!this.sees(t, p.trailRadius + 0.5)) continue;
      count++;
      const k = Math.max(0, Math.min(1, t.life / life)), f = 0.85 + 0.15 * Math.sin(this.clock * 13 + t.x * 7 + t.y * 5);
      const X = t.x * UNIT, Y = t.y * UNIT;
      g.circle(X, Y, R).fill({ color: EMBER, alpha: 0.38 * k });
      g.circle(X, Y, R * 0.6 * f).fill({ color: FLAME, alpha: 0.4 * k });
      g.circle(X, Y, R).stroke({ color: 0x7a2a12, width: 2, alpha: 0.5 * k });
    }
    this.trailCount = count;
    // Phase B (design answer 23): the fire of the hammer «Огненный проход» — the same embers, but with the pale-blue rim of
    // the player's effects (the elite's trail above keeps its dark-red rim). From the module's state, else from its events.
    const fire = hammerFireOf(world);
    let shown = 0;
    for (const f of fire) {
      if (f.k <= 0 || !this.sees(f, f.r + 0.5)) continue;
      shown++;
      const X = f.x * UNIT, Y = f.y * UNIT, R = f.r * UNIT, k = f.k, flick = 0.85 + 0.15 * Math.sin(this.clock * 13 + f.x * 7 + f.y * 5);
      g.circle(X, Y, R).fill({ color: EMBER, alpha: 0.38 * k });
      g.circle(X, Y, R * 0.6 * flick).fill({ color: FLAME, alpha: 0.4 * k });
      g.circle(X, Y, R).stroke({ color: PLAYER_FX, width: 2, alpha: 0.75 * k });
    }
    this.playerEffects.fire = shown;
  }

  /**
   * Phase B (design answer 23): the cut of the hammer «Режущий проход» — a thin white line along the hero's path of the last
   * 0.2 s of a dash or a return run, with a pale-blue rim under it; drawn while the kit holds the hammer or a `cut` event came
   * in this move. View memory only (`dashTrail`).
   */
  private drawPlayerFx(world: World, dt: number): void {
    const g = this.playerFxLayer.clear();
    for (const p of this.dashTrail) p.age += dt;
    if (dashLike(world)) this.dashTrail.push({ x: world.hero.x, y: world.hero.y, age: 0 });
    this.dashTrail = this.dashTrail.filter(p => p.age <= CUT_TRAIL_TIME);
    if (!world.move && !this.dashTrail.length) this.cutSeen = false;
    let segments = 0;
    if ((world.kit?.hammer === HAMMERS.cut || this.cutSeen) && this.dashTrail.length > 1) {
      for (let i = 1; i < this.dashTrail.length; i++) {
        const a = this.dashTrail[i - 1], b = this.dashTrail[i], k = 1 - b.age / CUT_TRAIL_TIME;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) continue;
        segments++;
        g.moveTo(a.x * UNIT, a.y * UNIT).lineTo(b.x * UNIT, b.y * UNIT).stroke({ color: PLAYER_FX, width: 6, alpha: 0.5 * k, cap: 'round' });
        g.moveTo(a.x * UNIT, a.y * UNIT).lineTo(b.x * UNIT, b.y * UNIT).stroke({ color: 0xffffff, width: 2, alpha: 0.95 * k, cap: 'round' });
      }
    }
    this.playerEffects.cutTrail = segments;
    if (segments) this.playerEffects.cutFrames++;
  }

  /** Task 12: what the marked view drew in the last frame — the horde ring (its members), the reticles, the leaders' crowns (tests read it). */
  readonly markedShown = { hordeRing: false, hordeMembers: 0, reticles: 0, crowns: 0 };

  /**
   * Marked enemies: a rotating gold reticle and a star badge — the goal of the third arena. Task 12 (design 13.10.2026): on an
   * arena whose goal layout is a horde (`world.arena.horde`), the marked bodies that stand close together now (`hordeGroup`:
   * HORDE_MIN+, found from where they stand — the horde moves as it chases) share one slowly turning ring of dashes and keep only
   * their stars; a straggler keeps its reticle. A leader (`leader`) wears a gold crown over its head (its art scale, the sim's).
   */
  private drawTargets(world: World): void {
    const g = this.targetLayer.clear(), r = enemyDrawRadius(world.params) * UNIT, shown = this.markedShown;
    shown.hordeRing = false; shown.hordeMembers = 0; shown.reticles = 0; shown.crowns = 0;
    const horde = world.arena.horde ? hordeGroup(world.enemies.filter(e => e.marked).map(e => ({ id: e.id, x: e.x, y: e.y }))) : null;
    if (horde) {
      shown.hordeRing = true; shown.hordeMembers = horde.members.size;
      const x = horde.x * UNIT, y = horde.y * UNIT, R = horde.radius * UNIT + r * 1.6, dashes = Math.max(12, Math.round(R / 14)), a0 = this.clock * 0.5;
      g.circle(x, y, R).fill({ color: TARGET, alpha: 0.07 }).stroke({ color: THREAT_OUTLINE, width: 7, alpha: 0.5 });
      for (let i = 0; i < dashes; i++) {
        const a = a0 + i * 2 * Math.PI / dashes;
        g.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R).arc(x, y, R, a, a + Math.PI / dashes).stroke({ color: TARGET, width: 4, cap: 'round' });
      }
    }
    for (const e of world.enemies) {
      if (!e.marked) continue;
      const x = e.x * UNIT, y = e.y * UNIT, R = r * 1.35 * enemyArtScale(world.params, e), a0 = this.clock * 1.6;
      const sx = x + r * 0.78, sy = y + r * 0.82, pts: number[] = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.16 : r * 0.36; pts.push(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
      if (e.leader) {
        // The crown sits on top of the reticle (clear of the body and of the ring's ticks): three gold points, navy outline.
        const w = r * 0.75, cy = y - R - w * 0.1;
        g.poly([x - w, cy, x - w, cy - w * 0.9, x - w * 0.45, cy - w * 0.45, x, cy - w * 1.15, x + w * 0.45, cy - w * 0.45, x + w, cy - w * 0.9, x + w, cy])
          .fill(TARGET).stroke({ color: THREAT_OUTLINE, width: 3, join: 'round' });
        shown.crowns++;
      }
      if (horde?.members.has(e.id)) { g.poly(pts).fill(TARGET).stroke({ color: THREAT_OUTLINE, width: 2 }); continue; }
      shown.reticles++;
      g.circle(x, y, R).stroke({ color: THREAT_OUTLINE, width: 6, alpha: 0.6 }).circle(x, y, R).stroke({ color: TARGET, width: 3 });
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
        g.moveTo(x + c * R * 0.82, y + s * R * 0.82).lineTo(x + c * R * 1.25, y + s * R * 1.25);
      }
      g.stroke({ color: TARGET, width: 4, cap: 'round' });
      g.poly(pts).fill(TARGET).stroke({ color: THREAT_OUTLINE, width: 2 });
    }
  }

  /** Sleep marks drawn in the last frame (tests read it). */
  sleepShown = 0;

  /**
   * The prologue's sleep (design 13.10.2026): while the enemies stand by the sim's rule — a calm arena (rooms 1–4) or `world.asleep`
   * (until the first press; «Щит» after the door opens) — a small pale «z» over each body (left of the head, clear of the HP badge), drifting up and fading, quieter than the
   * HP number. The condition is the sim's own (world.ts: the enemies take no step while `arena.calm || world.asleep`).
   */
  private drawSleep(world: World): void {
    this.sleepShown = 0;
    if (!world.arena.calm && !world.asleep) return;
    const g = this.targetLayer, r = enemyDrawRadius(world.params) * UNIT;
    for (const e of world.enemies) {
      if (!this.sees(e, 0.5)) continue;
      const t = (this.clock * 0.6 + e.id * 0.37) % 1, s = r * 0.22, x = e.x * UNIT - r * 0.55 - t * r * 0.15, y = e.y * UNIT - r * 0.95 - t * r * 0.45;
      const alpha = 0.55 * Math.sin(Math.PI * t);
      g.moveTo(x - s, y - s).lineTo(x + s, y - s).lineTo(x - s, y + s).lineTo(x + s, y + s).stroke({ color: 0xe9f3ff, width: 3, alpha, cap: 'round', join: 'round' });
      this.sleepShown++;
    }
  }

  /** Buttons (stone plates, sunk and green when pressed) and the door (barred, glowing when open). */
  private drawObjects(world: World): void {
    const g = this.objectLayer.clear(), R = OBJECT_RADIUS * UNIT, pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
    let lit = 0, out = 0, chests = 0;
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
      // Casino stage 1: the goblin's lever is drawn with its idol (slotView.ts).
      if (o.kind === 'lever') continue;
      if (o.kind === 'chest') {
        // К7 «Проклятый сундук»: a dark chest bound with a chain, an eye on its lid, a violet glow.
        chests++;
        const w = R * 1.9, h = R * 1.35, top = y - h * 0.55;
        g.ellipse(x, y + h * 0.55, w * 0.55, R * 0.22).fill({ color: 0x050a07, alpha: 0.45 });
        g.circle(x, y, R * 1.55).fill({ color: CURSE, alpha: 0.1 + 0.1 * pulse });
        g.roundRect(x - w / 2, top, w, h, 6).fill(0x4a2f22).stroke({ color: NAVY, width: 3 });
        g.roundRect(x - w / 2, top, w, h * 0.38, 6).fill(0x5d3b2b).stroke({ color: NAVY, width: 3 });
        g.moveTo(x - w / 2, top + h * 0.15).lineTo(x + w / 2, top + h * 0.75).moveTo(x - w / 2, top + h * 0.75).lineTo(x + w / 2, top + h * 0.15).stroke({ color: 0x8f8a9a, width: 4, alpha: 0.95 });
        g.ellipse(x, top + h * 0.45, R * 0.42, R * 0.26).fill(BONE).stroke({ color: NAVY, width: 2 });
        g.circle(x, top + h * 0.45, R * 0.15).fill(CURSE).circle(x, top + h * 0.45, R * 0.06).fill(CURSE_DARK);
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
        g.poly([...top, ...right, ...mid]).fill(CHAIN_COLORS[0]);
        g.poly([...right, ...bottom, ...mid]).fill(CHAIN_COLORS[1]);
        g.poly([...bottom, ...left, ...mid]).fill(CHAIN_COLORS[2]);
        g.poly([...left, ...top, ...mid]).fill(CHAIN_COLORS[3]);
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
    this.curseShown.chests = chests;
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
    // П2: the end of a 6–9 link dash — a bright outline round the hero, widening and fading.
    if (this.outlineLeft > 0) {
      const k = this.outlineLeft / OUTLINE_LIFE;
      ring.circle(0, 0, UNIT * (0.66 + 0.3 * (1 - k))).stroke({ color: 0xfff2c4, width: 6 * k + 2, alpha: 0.95 * k });
    }
    // Stage F: the after-chain invulnerability. Task 13 (design 13.10.2026): a steady glow the whole shield — a gold halo behind
    // the hero and a thick rim, both thinning as the shield runs out (`shieldFull` — its length when it was given), unlike the hurt blink.
    if (hero.chainShield > this.shieldLast) this.shieldFull = hero.chainShield;
    this.shieldLast = hero.chainShield;
    this.chainShieldShown = hero.chainShield > 0 && world.status === 'playing';
    if (this.chainShieldShown) {
      const k = Math.min(1, hero.chainShield / Math.max(this.shieldFull, 0.01)), pulse = 0.5 + 0.5 * Math.sin(this.clock * 18);
      ring.circle(0, 0, UNIT * 0.86).fill({ color: SHIELD_GLOW, alpha: 0.18 + 0.2 * k });
      ring.circle(0, 0, UNIT * 0.68).stroke({ color: NAVY_RIM, width: 8, alpha: 0.55 * k + 0.2 })
        .circle(0, 0, UNIT * 0.68).stroke({ color: SHIELD_GLOW, width: 3 + 2.5 * k, alpha: 0.75 + 0.25 * pulse });
    }
    // «Щит фокуса»: while the drawn chain guards the hero — a steady pale-blue rim (the focus colour), unlike the gold blink.
    this.focusGuardShown = focusGuarded(world);
    if (this.focusGuardShown) ring.circle(0, 0, UNIT * 0.64).stroke({ color: NAVY_RIM, width: 6, alpha: 0.6 }).circle(0, 0, UNIT * 0.64).stroke({ color: FOCUS_GUARD, width: 3.5, alpha: 0.95 });
    // К7 «Проклятый сундук»: while the curse lasts — a violet border round the hero, breathing.
    const curse = cursed(world) && world.status === 'playing';
    if (curse) {
      const breath = 0.5 + 0.5 * Math.sin(this.clock * 3);
      ring.circle(0, 0, UNIT * 0.7).stroke({ color: CURSE_DARK, width: 7, alpha: 0.7 }).circle(0, 0, UNIT * 0.7).stroke({ color: CURSE, width: 3 + 2 * breath, alpha: 0.75 + 0.25 * breath });
    }
    this.curseShown.border = curse;
    // Small HP bar under the hero: the eye stays near the action.
    const w = 58, frac = hero.maxHp > 0 ? hero.hp / hero.maxHp : 0;
    ring.roundRect(-w / 2, 40, w, 7, 3).fill(0x1a1d17).stroke({ color: 0x0b0d0a, width: 1 });
    ring.roundRect(-w / 2 + 1, 41, (w - 2) * frac, 5, 2).fill(frac > 0.34 ? 0xbd7165 : 0xe0523f);
  }

  // ---- К7 «Проклятый сундук» (sim/chest.ts): view-only — the chest, the hero's border and the counter under the HP bar ----
  private curseText: Text | null = null;
  /** Tests read these: chests drawn, the border drawn, the counter's text now (empty — hidden) in the last frame. */
  curseShown = { chests: 0, border: false, label: '' };
  /** «Щит фокуса»: the rim was drawn this frame (tests read it). */
  focusGuardShown = false;
  /** Task 13: the after-chain shield's glow was drawn this frame (tests read it). */
  chainShieldShown = false;
  /** The shield's length when it was last given and its value last frame (the glow thins with what is left). */
  private shieldFull = 0;
  private shieldLast = 0;
  /** «Смена цвета»: the enemy id of the link with the rainbow ring this frame (0 — none; tests read it). */
  colorShiftShown = 0;
  /**
   * Task 10: the enemy id of the link that freed the colour while it is free (0 — not free) and the one with the small rainbow mark
   * (`colorShiftKeep`: the ring rides the chain's end, the mark stays where the shift was earned; 0 — no mark).
   */
  colorShiftFreedBy = 0;
  colorShiftMarkShown = 0;
  /** Bodies on screen dimmed as «another colour» of the drawn chain in the last frame (tests read it: a free colour dims none). */
  dimmedShown = 0;

  /** «проклятие 7/12» under the hero's HP bar while the curse lasts: the dash's kills toward lifting it. */
  private drawCurseCounter(world: World): void {
    if (!this.curseText) {
      this.curseText = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 'bold', fill: CURSE, stroke: { color: CURSE_DARK, width: 4 } } });
      this.curseText.anchor.set(0.5, 0);
      this.curseText.visible = false;
      this.root.addChild(this.curseText);
    }
    const text = this.curseText, curse = world.curse, on = !!curse && cursed(world) && world.status === 'playing';
    text.visible = on;
    if (!on) { this.curseShown.label = ''; return; }
    const label = `проклятие ${curse!.kills}/${CHEST_CURSE_KILLS}`;
    if (text.text !== label) text.text = label;
    text.position.set(world.hero.x * UNIT, world.hero.y * UNIT + 50);
    this.curseShown.label = label;
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

  /**
   * Phase B (design answer 23): a burst of the player's build at an arena point — the pale-blue rim, no hatching, no dark
   * threat outline. `grow` — a ring widening from the hero to its radius (the wave, as the spin's ring).
   */
  private playerBurst(x: number, y: number, r: number, fill: number, fillAlpha: number, life: number, grow = false): void {
    const g = new Graphics().circle(0, 0, r * UNIT).fill({ color: fill, alpha: fillAlpha }).stroke({ color: PLAYER_FX, width: 5, alpha: 0.95 });
    g.position.set(x * UNIT, y * UNIT);
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life, total: life, grow });
  }

  /** Task 13: block sparks shown so far (one per `shieldBlock` event; tests read it). */
  shieldBlocksShown = 0;

  /**
   * Task 13 «Щит» (design 13.10.2026): the after-chain shield took a touch (`shieldBlock`, the enemy at x, y). On the hero's rim
   * facing the enemy: a bright arc of the shield and short rays thrown back at the enemy — the touch bounced off, no hurt flash.
   */
  private shieldBlockSpark(world: World, ex: number, ey: number): void {
    const hx = world.hero.x, hy = world.hero.y, d = Math.hypot(ex - hx, ey - hy), ux = d > 1e-6 ? (ex - hx) / d : 0, uy = d > 1e-6 ? (ey - hy) / d : -1;
    const a = Math.atan2(uy, ux), R = UNIT * 0.68, g = new Graphics();
    g.arc(0, 0, R, a - 0.7, a + 0.7).stroke({ color: NAVY_RIM, width: 10, alpha: 0.7, cap: 'round' });
    g.arc(0, 0, R, a - 0.7, a + 0.7).stroke({ color: 0xfff2c4, width: 6, cap: 'round' });
    for (const da of [-0.45, 0, 0.45]) {
      const ra = a + da, x0 = Math.cos(ra) * (R + 8), y0 = Math.sin(ra) * (R + 8), len = da === 0 ? 22 : 15;
      g.moveTo(x0, y0).lineTo(x0 + Math.cos(ra) * len, y0 + Math.sin(ra) * len).stroke({ color: SHIELD_GLOW, width: 4, cap: 'round' });
    }
    g.position.set(hx * UNIT, hy * UNIT);
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life: 0.4, total: 0.4 });
    this.shieldBlocksShown++;
  }

  // ---- The power number (package «Урон имеет значение», item 4; task 8b, design 13.10.2026): view-only ----
  /**
   * One number over the hero's head: while the chain is drawn — the power it brings (`planPowerNumber`: `power` after the last link,
   * or what the first surviving link gets — then red; none without an enemy link); while the dash runs — `move.power` link by link; it fades 0.8 s after.
   * It replaced the HUD line «цепь N · сила P · …» and the small «сила N» beside the hero.
   */
  private powerText: Text | null = null;
  private powerLife = 0;
  private powerValue = -1;
  private powerRed = false;
  /** The plan of the drawn chain this frame (drawChain), null — no chain drawn. */
  private drawnPlan: ChainPlan | null = null;
  /** Tests read these: the largest power shown in a dash, how many times the number grew, strike flashes and the closing flashes drawn. */
  powerShown = 0;
  powerGrowths = 0;
  strikeFlashes = 0;
  finisherFlashes = 0;
  /** Tests read it: the number now (null — hidden), whether it is red and where it stood. */
  powerNow: { value: number; red: boolean; drawing: boolean } | null = null;
  get powerVisible(): boolean { return !!this.powerText?.visible; }

  /** The power number: centred over the hero's head (clear of the HP bar under him), grows link by link. */
  private drawPowerNumber(world: World, dt: number): void {
    if (!this.powerText) {
      this.powerText = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 34, fontWeight: 'bold', fill: POWER_WARM, stroke: { color: 0x200c08, width: 6 } } });
      this.powerText.anchor.set(0.5, 1);
      this.powerText.visible = false;
      this.root.addChild(this.powerText);
    }
    const text = this.powerText, move = world.move, plan = this.drawnPlan;
    let value: number | null = null, red = false, drawing = false;
    const shown = plan && !move && world.status === 'playing' ? planPowerNumber(plan) : null;
    if (shown) {
      value = shown.value; red = shown.red;
      drawing = true;
    } else if (move?.kind === 'dash' && move.hits > 0) {
      value = move.power;
      this.powerShown = Math.max(this.powerShown, move.power);
    }
    if (value !== null) {
      this.powerLife = 0.8;
      if (value !== this.powerValue || red !== this.powerRed) {
        if (this.powerValue >= 0 && value > this.powerValue) this.powerGrowths++;
        this.powerValue = value;
        this.powerRed = red;
        text.text = String(value);
        text.scale.set(1.3);
      }
    } else if (!(move?.kind === 'dash')) this.powerLife = Math.max(0, this.powerLife - dt);
    // Between the release and the first hit the drawn number stays as it was (the dash has not struck yet).
    text.visible = this.powerLife > 0 && this.powerValue >= 0;
    if (!text.visible) { this.powerValue = -1; this.powerRed = false; this.powerNow = null; return; }
    text.scale.set(Math.max(1, text.scale.x - dt * 2.5));
    text.position.set(world.hero.x * UNIT, world.hero.y * UNIT - POWER_ABOVE);
    text.alpha = move?.kind === 'dash' || value !== null ? 1 : Math.min(1, this.powerLife / 0.4);
    // Red when the tail survives; else warmer as the power grows.
    text.style.fill = this.powerRed ? POWER_RED : this.powerValue >= 6 ? 0xffe08a : this.powerValue >= 3 ? 0xffc46b : POWER_WARM;
    this.powerNow = { value: this.powerValue, red: this.powerRed, drawing };
  }

  // ---- Casino «Котёл» (sim/purse.ts, docs/realtime-casino.md): view-only — the caption under the power number, the cheque ----
  private purseCaption: Text | null = null;
  private chequeText: Text | null = null;
  private chequeLife = 0;
  /** Tests read these: caption changes drawn, the caption now (empty — hidden), the cheques shown in order. */
  purseShown = { captions: 0, caption: '', cheques: [] as string[] };

  /** Over the power number while it shows: «угли N · ×жар» (· ◆×) — the dash's cheque if it ended now (`dashCheque`). */
  private drawPurseCaption(world: World): void {
    if (!this.purseCaption) {
      this.purseCaption = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 'bold', fill: 0xffd88a, stroke: { color: 0x200c08, width: 4 } } });
      this.purseCaption.anchor.set(0.5, 1);
      this.purseCaption.visible = false;
      this.root.addChild(this.purseCaption);
    }
    const caption = this.purseCaption, move = world.move, power = this.powerText;
    const cheque = world.params.purse && move?.kind === 'dash' && move.hits > 0 ? dashCheque(move) : null;
    if (cheque) {
      const text = `угли ${cheque.embers} · ×${cheque.heat}${cheque.mult > 1 ? ` · ◆${cheque.mult}` : ''}`;
      if (text !== caption.text) { caption.text = text; this.purseShown.captions++; }
    }
    caption.visible = !!world.params.purse && !!power?.visible && caption.text !== '';
    if (!caption.visible) { caption.text = ''; this.purseShown.caption = ''; return; }
    this.purseShown.caption = caption.text;
    // Task 8b: over the power number (it stands over the head now) and over the combo counter when that shows too.
    const combo = this.comboText?.visible ? this.comboText : null;
    caption.position.set(world.hero.x * UNIT, (combo ? combo.y - combo.height : world.hero.y * UNIT - POWER_ABOVE - power!.height) - 2);
    caption.alpha = power!.alpha;
  }

  /**
   * The end of a dash: its cheque at the hero for 0.8 s, no pause — «8 × 3 × ◆2 = 48» (where the score popup «+N» was: above
   * the combo counter). П2: a cheque of 1–2 enemy links has no pop-up — the caption takes its numbers, the HUD line the cauldron.
   */
  private showCheque(world: World, ev: { embers: number; heat: number; mult: number; total: number; links: number; door?: boolean }): void {
    if (ev.links <= QUIET_LINKS) {
      const caption = `угли ${ev.embers} · ×${ev.heat}${ev.mult > 1 ? ` · ◆${ev.mult}` : ''}`;
      if (this.purseCaption && this.purseCaption.text !== caption) { this.purseCaption.text = caption; this.purseShown.captions++; }
      this.feelShown.quiet++;
      return;
    }
    this.feelShown.popups++;
    if (!this.chequeText) {
      this.chequeText = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 'bold', fill: 0xffe08a, stroke: { color: 0x200c08, width: 5 } } });
      this.chequeText.anchor.set(0.5);
      this.root.addChild(this.chequeText);
    }
    // П3: a chain into the door — «8 × 4 · дверь = 32» (its +1 heat is in the 4).
    const text = `${ev.embers} × ${ev.heat}${ev.door ? ' · дверь' : ''}${ev.mult > 1 ? ` × ◆${ev.mult}` : ''} = ${ev.total}`;
    // The last link and the «добивание» come in the tick the dash ends: the caption takes the cheque's final numbers.
    const caption = `угли ${ev.embers} · ×${ev.heat}${ev.mult > 1 ? ` · ◆${ev.mult}` : ''}`;
    if (this.purseCaption && this.purseCaption.text !== caption) { this.purseCaption.text = caption; this.purseShown.captions++; }
    this.chequeText.text = text;
    this.chequeText.scale.set(1.25);
    this.chequeLife = 0.8;
    this.purseShown.cheques.push(text);
    if (this.purseShown.cheques.length > 20) this.purseShown.cheques.shift();
    this.chequeText.position.set(world.hero.x * UNIT, world.hero.y * UNIT - CHEQUE_ABOVE);
  }

  /** П3 «Финальная цепь»: the chain entered the door — a gold ring widens from the hero for 0.8 s, no pause of the world. */
  private finalFlash(x: number, y: number): void {
    const g = new Graphics().circle(0, 0, 2.6 * UNIT).fill({ color: 0xffd36b, alpha: 0.3 }).stroke({ color: 0xffe08a, width: 8, alpha: 0.95 });
    g.position.set(x * UNIT, y * UNIT);
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life: FINAL_FLASH, total: FINAL_FLASH, grow: true });
    this.feelShown.finals++;
  }

  private drawCheque(world: World, dt: number): void {
    const text = this.chequeText;
    if (!text) return;
    this.chequeLife = Math.max(0, this.chequeLife - dt);
    text.visible = this.chequeLife > 0;
    if (!text.visible) return;
    text.scale.set(Math.max(1, text.scale.x - dt * 2));
    text.position.set(world.hero.x * UNIT, world.hero.y * UNIT - CHEQUE_ABOVE);
    text.alpha = Math.min(1, this.chequeLife / 0.3);
  }
  // ---- end «Котёл» ----

  /**
   * One strike of the dash: the flash and the shake grow with the hit's damage (`ev.damage`, the power the link carried);
   * the last enemy hit of a chain gets a bigger gold ring (the sim's world-wide `finisher` flash for long chains stays as it is).
   */
  private strikeFx(world: World, ev: { damage: number; x: number; y: number }, last: boolean, quiet = false): void {
    const k = Math.min(1, ev.damage / 8);
    const r = (0.3 + 0.35 * k) * (last ? 1.9 : 1) * UNIT;
    const g = new Graphics().circle(0, 0, r).fill({ color: last ? 0xffd36b : 0xfff2c4, alpha: (last ? 0.5 : 0.3) + 0.25 * k }).stroke({ color: last ? 0xffb347 : 0xffffff, width: last ? 7 : 3 + 3 * k });
    g.position.set(ev.x * UNIT, ev.y * UNIT);
    this.fxLayer.addChild(g);
    const life = last ? 0.38 : 0.2;
    this.bursts.push({ g, life, total: life });
    this.strikeFlashes++;
    if (last) this.finisherFlashes++;
    // П2: a quiet dash (1–2 enemy links at the release) does not shake.
    const base = quiet ? 0 : world.params.dashShake;
    if (base > 0) {
      // A stronger hit shakes more, but never past `dashShake` (design answer 22: the shake must not grow beyond it); the
      // flash and the sound carry the rest of the growth. The last link shakes a little longer.
      const amp = base * (0.5 + 0.5 * k);
      if (this.shakeLeft <= 0.02 || amp > this.shakeAmp) { this.shakeLeft = this.shakeTotal = last ? 0.14 : 0.08; this.shakeAmp = amp; }
    }
  }

  private handleEvents(world: World): void {
    const lastHit = world.events.reduce((n, e, i) => e.type === 'chainHit' ? i : n, -1);
    const moreLinks = !!world.move?.links.some(l => l.kind === 'enemy');
    // П2: the dash's enemy links as released decide its shake, the sandbox «+N» and the outline.
    const feel = chainFeel(this.dashLinks.of(world));
    for (const [at, ev] of world.events.entries()) {
      // Casino «Котёл»: the chain's cheque at the hero (П2: over the hero only from 3 links; otherwise only the HUD line).
      // П3 «Финальная цепь»: a chain into the door — the final flash always (the cheque's pop-up follows П2).
      if (ev.type === 'cheque') { if (ev.door) this.finalFlash(ev.x, ev.y); this.showCheque(world, ev); continue; }
      // Phase B (Д5): the build. An item fired — a short text at the hero (its icon flashes in the column, main.ts).
      if (ev.type === 'talismanFired') {
        this.floatText(fireTextOf(ev.id), world.hero.x * UNIT, world.hero.y * UNIT - 150, PLAYER_FX);
        this.talismanTexts++;
        continue;
      }
      // Casino stage 1 («Однорукий гоблин»): an arrow fell (the archer's flash); the result over the idol.
      if (ev.type === 'slot') {
        if (ev.action === 'land') {
          const flash = new Graphics().circle(0, 0, (ev.r ?? 1) * UNIT).fill({ color: THREAT, alpha: 0.5 }).stroke({ color: THREAT_OUTLINE, width: 4 });
          flash.position.set(ev.x * UNIT, ev.y * UNIT);
          this.fxLayer.addChild(flash);
          this.bursts.push({ g: flash, life: 0.25, total: 0.25 });
          this.slotFlashes++;
        } else {
          // «Перебор»: the goblin blows up — a red-orange ring wider than the arrow's flash, at the event's point (the idol is gone), and a shake.
          // Task 7: with «Взрыв по площади» the reels only light the idol (the red circle of `drawSignals`); the boom, the shake and
          // the blow come with the blast after the fuse (event `blast`, source `slot-bust`) — no spark to the hero, no flash on him.
          if (ev.action === 'effect' && ev.outcome === 'bust' && !world.params.slotBustArea) {
            const boom = new Graphics().circle(0, 0, 2.2 * UNIT).fill({ color: 0xe0562f, alpha: 0.55 }).stroke({ color: 0xffe08a, width: 8, alpha: 0.95 });
            boom.position.set(ev.x * UNIT, ev.y * UNIT);
            this.fxLayer.addChild(boom);
            this.bursts.push({ g: boom, life: 0.55, total: 0.55 });
            this.shakeLeft = this.shakeTotal = 0.3; this.shakeAmp = Math.max(this.shakeAmp, 9);
            // Task 5б: the blow finds the hero wherever he is (the ring is the idol's, the hit is not): a spark from the idol to the
            // hero and a flash on him, at the point of the `hit` (source `slot-bust`) of this very tick, else at the hero.
            const hit = world.events.find((h): h is Extract<WorldEvent, { type: 'hit' }> => h.type === 'hit' && h.source === 'slot-bust');
            this.bustSpark(ev.x, ev.y, hit ? hit.x : world.hero.x, hit ? hit.y : world.hero.y);
          }
          const text = this.slotView.handle(ev);
          // The outcome word floats over the reels, or under them when the reels stand under the idol (no room above, slotView.ts).
          const anchor = this.slotView.outcomeAnchor();
          // «Длинная цепь кормит гоблина»: the long chain's text over the hero (the event's point), not over the idol.
          if (text && ev.action === 'feed') this.floatText(text, ev.x * UNIT, ev.y * UNIT - 180, 0xffd36b);
          else if (text) this.floatText(text, ev.x * UNIT, ev.y * UNIT + anchor.dy, 0xffd36b, 45 * anchor.dir);
        }
        continue;
      }
      // П9 «Второе дыхание» (the sandbox; task 17 — a gentle run's rows 1–4): the hero stood up after a lethal hit — a flash and a
      // short text at him with the HP he stands with (design 13.10.2026: «второе дыхание: 3 HP», not like the ward's «1 HP»).
      if (ev.type === 'secondWind') {
        this.playerBurst(ev.x, ev.y, 1.6, 0xffffff, 0.45, 0.5, true);
        this.secondWindText = `второе дыхание: ${Math.min(SECOND_WIND_HP, world.hero.maxHp)} HP`;
        this.floatText(this.secondWindText, ev.x * UNIT, ev.y * UNIT - 150, PLAYER_FX);
        this.secondWindShown++;
        continue;
      }
      if (ev.type === 'wave') { this.playerBurst(ev.x, ev.y, ev.r, PLAYER_FX, 0.16, 0.35, true); this.playerEffects.waves++; continue; }
      if (ev.type === 'hammer') {
        if (ev.kind === 'blast') { this.playerBurst(ev.x, ev.y, ev.r ?? 1.5, 0xffffff, 0.42, 0.35); this.playerEffects.blasts++; }
        // `fire`: the fire is drawn from the module's state (`hammerFireOf`), not from the event.
        else if (ev.kind === 'cut') { this.cutSeen = true; this.playerEffects.cuts++; }
        else if (ev.kind === 'return') this.playerEffects.returns++;
        continue;
      }
      if (ev.type === 'chainHit') {
        this.strikeFx(world, ev, at === lastHit && !moreLinks, feel === 'quiet');
        // A plate hit (damage 0): the plate text comes with the `elitePlates` event.
        if (!ev.killed && ev.plates === undefined) this.floatText(`−${ev.damage}`, ev.x * UNIT, ev.y * UNIT - 30, 0xffd36b);
        continue;
      }
      if (ev.type === 'elitePlates') {
        if (ev.action === 'strip') {
          // The strip that opens the window shows only «окно» (one text, not three on top of each other with the power).
          if (ev.plates > 0) { const at = this.eliteWord(ev.y * UNIT); this.floatText(`−${ev.removed ?? 1} ${platesWord(ev.removed ?? 1)}`, ev.x * UNIT, at.y, ELITE_LEMON, at.dir); }
          this.eliteBurst(ev.x, ev.y, 0.9, 0.22, 4);
          this.eliteShown.stripFlashes++;
        } else if (ev.action === 'open') { const at = this.eliteWord(ev.y * UNIT); this.floatText('окно', ev.x * UNIT, at.y, ELITE_LEMON, at.dir); }
        continue;
      }
      if (ev.type === 'eliteDown') {
        // The sim adds the 0.08 s hit-stop; here a flash, bigger and with a word for a clean break (killed in the window).
        this.eliteBurst(ev.x, ev.y, ev.clean ? 2.4 : 1.6, ev.clean ? 0.5 : 0.35, ev.clean ? 8 : 5, true);
        if (ev.clean) { const at = this.eliteWord(ev.y * UNIT, 16); this.floatText('чистый слом', ev.x * UNIT, at.y, ELITE_LEMON, at.dir); this.eliteShown.cleanBreaks++; }
        this.eliteShown.downFlashes++;
        continue;
      }
      if (ev.type === 'blast') {
        const flash = new Graphics().circle(0, 0, ev.radius * UNIT).fill({ color: SPARK, alpha: 0.55 }).stroke({ color: 0xfff2c4, width: 4 });
        flash.position.set(ev.x * UNIT, ev.y * UNIT);
        this.fxLayer.addChild(flash);
        this.bursts.push({ g: flash, life: 0.35, total: 0.35 });
        if (world.params.shakeOnDamage) { this.shakeLeft = this.shakeTotal = 0.15; this.shakeAmp = Math.max(this.shakeAmp, 6); }
        // Task 7: the goblin's bust goes off — the sapper's flash over its wider circle, a red-orange ring and the old bust's shake.
        if (ev.source === SLOT_BUST_SOURCE) {
          const boom = new Graphics().circle(0, 0, ev.radius * UNIT).fill({ color: 0xe0562f, alpha: 0.4 }).stroke({ color: 0xffe08a, width: 8, alpha: 0.95 });
          boom.position.set(ev.x * UNIT, ev.y * UNIT);
          this.fxLayer.addChild(boom);
          this.bursts.push({ g: boom, life: 0.55, total: 0.55 });
          this.shakeLeft = this.shakeTotal = 0.3; this.shakeAmp = Math.max(this.shakeAmp, 9);
          this.bustBlastsShown++;
        }
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
        if (ev.kind === 'healing') { this.floatText(`+${itemHealOf(world)} HP`, ev.x * UNIT, ev.y * UNIT - 46, 0x8fd18a); continue; }
        // Phase B (design answer 23): the player's bomb gets the pale-blue rim of the player's effects — the sapper's blast
        // keeps its cream rim (`blast` above).
        const color = ev.kind === 'frost' ? ICE : SPARK, radius = Math.max(ev.radius, 0.6) * UNIT, bomb = ev.kind === 'bomb';
        if (bomb) this.playerEffects.bombs++;
        const burst = new Graphics().circle(0, 0, radius).fill({ color, alpha: bomb ? 0.55 : 0.25 }).stroke(bomb ? { color: PLAYER_FX, width: 5, alpha: 0.95 } : { color: 0xffffff, width: 3, alpha: 0.9 });
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
      if (ev.type === 'seal') {
        // Loop research, step 2: the outline flashes at the release and at the strike (the ring as it was fixed).
        this.sealFlash(ev.points, ev.kind);
        continue;
      }
      if (ev.type === 'pierce') {
        // Loop research, step 3 («Прямая»): the fixed arrow flashes at the release; the run's end is counted.
        if (ev.phase === 'release') { this.pierceShown.releases++; this.pierceFlash(ev.from, ev.to); }
        else if (ev.phase === 'end') this.pierceShown.ends++;
        continue;
      }
      if (ev.type === 'shieldBlock') { this.shieldBlockSpark(world, ev.x, ev.y); continue; }
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
        // Above the combo counter (its text ends ~100 px over the hero). Casino «Котёл»: with the cauldron on the cheque takes
        // this place (`showCheque`) — the score is not the number the player collects then.
        // П2: a quiet dash (1–2 enemy links) has no «+N» over the hero; 6–9 links flash the hero's outline (10+ have the finisher).
        if (ev.score > 0 && !world.params.purse) {
          if (feel === 'quiet') this.feelShown.quiet++;
          else { this.floatText(`+${ev.score}`, world.hero.x * UNIT, world.hero.y * UNIT - 122, 0xfff2c4); this.feelShown.popups++; }
        }
        if (feel === 'chord') { this.outlineLeft = OUTLINE_LIFE; this.feelShown.outlines++; }
        this.comboLife = ev.kills > 0 ? 0.9 : 0;
        continue;
      }
      if (ev.type === 'button') {
        const o = world.objects.find(x => x.id === ev.objectId);
        if (o) this.floatText('Кнопка!', o.x * UNIT, o.y * UNIT - 40, 0x8fd18a);
        continue;
      }
      // Task 14 «Котомка у двери»: a filled step — the sack flashes and «+N» rises; a reset — the step's mark dims, a pale «сброс».
      if (ev.type === 'bag') {
        const at = this.bagView.onEvent(world, ev, this.featDoor.shown.visible ? FEAT_DOOR_GAP : 0);
        if (at && ev.action === 'step') this.floatText(`+${ev.reward ?? 0}`, at.x, at.y, 0xffd36b, at.dir);
        else if (at && ev.action === 'reset') this.floatText('сброс', at.x, at.y, 0x9a9a8a, at.dir);
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

  private floatText(value: string, x: number, y: number, fill: number, dir = -45): void {
    const text = new Text({ text: value, style: { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 'bold', fill, stroke: { color: 0x200c08, width: 4 } } });
    text.anchor.set(0.5); text.position.set(x, y);
    this.fxLayer.addChild(text);
    this.floating.push({ text, life: 0.7, vy: dir });
  }

  /**
   * Task 5б, «Перебор»: the blast found the hero. A jagged spark from the idol's point to the hero (navy outline, orange body, pale
   * core; 0.4 s, it flickers 25 times a second and fades) and a ring flash on the hero (0.45 s, widening). The jitter comes from a
   * hash of the points and the frame (`imul`), not from `Math.random`: the same blast draws the same spark.
   */
  private bustSpark(fx: number, fy: number, tx: number, ty: number): void {
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.sparks.push({ g, fx, fy, tx, ty, life: BUST_SPARK_LIFE, seed: Math.imul(Math.round(fx * 100) + 31, 2654435761) ^ Math.imul(Math.round(ty * 100) + 17, 40503) });
    this.drawSpark(this.sparks[this.sparks.length - 1]);
    const ring = new Graphics().circle(0, 0, 1.1 * UNIT).fill({ color: 0xffe08a, alpha: 0.5 }).stroke({ color: 0xe0562f, width: 6, alpha: 0.95 });
    ring.position.set(tx * UNIT, ty * UNIT);
    this.fxLayer.addChild(ring);
    this.bursts.push({ g: ring, life: 0.45, total: 0.45, grow: true });
    this.slotView.shown.sparks++; this.slotView.shown.heroFlashes++;
    this.slotView.shown.sparkFrom = { x: fx, y: fy }; this.slotView.shown.sparkTo = { x: tx, y: ty };
  }

  private drawSpark(s: { g: Graphics; fx: number; fy: number; tx: number; ty: number; life: number; seed: number }): void {
    const g = s.g.clear(), dx = s.tx - s.fx, dy = s.ty - s.fy, len = Math.hypot(dx, dy) || 1e-6, n = Math.min(40, Math.max(2, Math.ceil(len / 0.5)));
    const frame = Math.floor((BUST_SPARK_LIFE - s.life) * 25), nx = -dy / len, ny = dx / len;
    const pts: number[] = [s.fx * UNIT, s.fy * UNIT];
    for (let i = 1; i < n; i++) {
      // A hash in −1…1 per point and frame; the offset shrinks toward both ends so the spark starts at the idol and lands on the hero.
      const h = Math.imul(s.seed ^ Math.imul(i + 1, 374761393) ^ Math.imul(frame + 1, 668265263), 2246822519) >>> 0;
      const j = (h / 4294967295) * 2 - 1, t = i / n, off = j * 0.28 * UNIT * Math.min(1, 4 * t * (1 - t) * 2);
      pts.push((s.fx + dx * t) * UNIT + nx * off, (s.fy + dy * t) * UNIT + ny * off);
    }
    pts.push(s.tx * UNIT, s.ty * UNIT);
    const k = Math.max(0, s.life / BUST_SPARK_LIFE);
    g.poly(pts, false).stroke({ color: 0x18232d, width: 11, alpha: 0.8 * k, join: 'round', cap: 'round' });
    g.poly(pts, false).stroke({ color: 0xe0562f, width: 6, alpha: k, join: 'round', cap: 'round' });
    g.poly(pts, false).stroke({ color: 0xfff2c4, width: 2.5, alpha: k, join: 'round', cap: 'round' });
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) { s.g.destroy(); this.sparks.splice(i, 1); continue; }
      this.drawSpark(s);
    }
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
    this.drawnPlan = null;
    for (const label of this.quillLabels) label.visible = false;
    for (const label of this.plateLabels) label.visible = false;
    for (const label of this.depthLabels) label.visible = false;
    this.linkDepthShown.labels = [];
    this.pierceShown.arrow = 0; this.pierceShown.marks = 0; this.pierceShown.end = 0;
    this.signals.quillBadges = 0;
    this.eliteShown.planPlates = 0;
    this.colorShiftShown = 0;
    this.colorShiftFreedBy = 0;
    this.colorShiftMarkShown = 0;
    const flashR = enemyDrawRadius(p) * UNIT;
    for (const e of world.enemies) {
      if (e.hurtFlash <= 0) continue;
      g.circle(e.x * UNIT, e.y * UNIT, flashR).fill({ color: 0xffffff, alpha: Math.min(1, e.hurtFlash / Math.max(p.hitFlash, 0.01)) * 0.8 });
    }
    // Stage D (user 07.10.2026): the reach R of the first link around the hero, always — thin and faint over the crowd.
    let reach = 0;
    this.heroReachShown = world.status === 'playing';
    // Phase B (Д5): the radius drawn (units) — «Длинная рука» and «Широкий круг» widen it (tests read it).
    this.heroReachRadius = linkRadiusOf(world);
    if (this.heroReachShown) {
      g.circle(hero.x * UNIT, hero.y * UNIT, this.heroReachRadius * UNIT).stroke({ color: 0xffffff, width: 1.25, alpha: 0.22 });
      reach++;
    }
    this.visibleReachCircles = reach;
    this.heroAnchorShown = false;
    if (dashLike(world)) {
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
      this.depthChain = '';
      this.drawLoopHint(g, world);
      // Out of a chain: the reachable buttons / open door get a faint ring (a link of any color).
      if (world.status === 'playing' && !world.move) for (const o of nextObjectCandidates(world)) g.circle(o.x * UNIT, o.y * UNIT, OBJECT_RADIUS * UNIT + 10).stroke({ color: 0xffffff, width: 2, alpha: 0.45 });
      return;
    }
    const plan = planChain(world), color = chainColor(world), ink = color === null ? 0xffffff : chainInk(color);
    this.drawnPlan = plan;
    this.loopShown.hint = 0;
    // Line hero → links, navy under the chain color.
    const pts: Vec[] = [{ x: hero.x, y: hero.y }];
    for (const l of world.chain) { const pt = linkPoint(world, l); if (pt) pts.push(pt); }
    for (const [w, c] of [[9, NAVY], [4.5, ink]] as const) {
      g.moveTo(pts[0].x * UNIT, pts[0].y * UNIT);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x * UNIT, pts[i].y * UNIT);
      g.stroke({ color: c, width: w, alpha: 0.95, cap: 'round', join: 'round' });
    }
    const anchor = chainAnchor(world);
    this.drawLoop(g, world, plan.seal, ink);
    this.drawPierce(g, world, plan.pierce, ink);
    if (!plan.endsOnSurvivor && !plan.endsOnObject && !plan.seal) {
      if (ui.pointer) g.moveTo(anchor.x * UNIT, anchor.y * UNIT).lineTo(ui.pointer.x * UNIT, ui.pointer.y * UNIT).stroke({ color: ink, width: 2, alpha: 0.45 });
      // Reach of the next link and the valid next links (outlined; `nextCandidates` already counts both anchors).
      g.circle(anchor.x * UNIT, anchor.y * UNIT, linkRadiusOf(world) * UNIT).stroke({ color: ink, width: 1.5, alpha: 0.35 });
      this.visibleReachCircles = ++reach;
      // Stage G: the hero is a second anchor — his circle (always drawn faint) gets the chain color too.
      if (heroAnchorOn(world)) {
        g.circle(hero.x * UNIT, hero.y * UNIT, linkRadiusOf(world) * UNIT).stroke({ color: ink, width: 1.5, alpha: 0.35 });
        this.heroAnchorShown = true;
      }
      const candidates = nextCandidates(world);
      for (const e of candidates) g.circle(e.x * UNIT, e.y * UNIT, enemyDrawRadius(p) * UNIT + 5).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
      if (this.showLinkDepth) this.drawLinkDepths(world, candidates); else this.depthChain = '';
    } else this.depthChain = '';
    if (!plan.endsOnSurvivor && !plan.endsOnObject && !plan.seal) {
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
      if (lp.outcome.plate) {
        // An armoured elite link: a plate hit, not a kill and not a survivor — a lemon ring and «−1 пластина»; the chain goes on.
        const R = linked && (linked.elite || linked.leader) ? r * enemyArtScale(p, linked) * 1.06 : r, bx = x - R * 0.7, by = y - R * 0.75, s = r * 0.2;
        g.circle(x, y, R + 4).stroke({ color: ELITE_LEMON, width: 4 });
        g.circle(bx, by, r * 0.32).fill(ELITE_LEMON).stroke({ color: NAVY, width: 2 });
        g.roundRect(bx - s * 0.8, by - s, s * 1.6, s * 2, s * 0.5).fill(NAVY);
        const label = this.plateLabel(this.eliteShown.planPlates++);
        label.position.set(x, y - R - (armed > 0 ? 36 : 14));
        label.visible = true;
        continue;
      }
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
    // «Смена цвета» (sim `colorShiftLeft`): the chain's colour is free — the link that freed it gets a rainbow ring of the
    // arena's colours (the bodies of every colour are lit: `chainColor` is null, nothing is dimmed). The dash's rule (design
    // answer 12.10.2026): the shift comes unless the chain ends on that link as a survivor — a button, the door or a loop after
    // it does not cancel it (the sim pays «Призма» there too).
    // Task 10 (design 13.10.2026, `colorShiftKeep`): while the colour stays free the ring stands on the LAST enemy link and moves
    // with the chain's end (it answers «may I take any colour now» where the eye is, at the pointer); the link that freed the colour
    // keeps a small rainbow mark. Another colour taken — the sim's `colorShiftLeft` is no longer 0: the ring goes.
    if (!plan.endsOnSurvivor && colorShiftLeft(world) === 0) {
      const id = colorShiftIds(world).at(-1), e = id === undefined ? undefined : world.enemies.find(x => x.id === id);
      if (e) {
        this.colorShiftFreedBy = e.id;
        let ringOn = e;
        if (p.colorShiftKeep) {
          for (let i = world.chain.length - 1; i >= 0; i--) {
            const l = world.chain[i], last = l.kind === 'enemy' ? world.enemies.find(x => x.id === l.id) : undefined;
            if (last) { ringOn = last; break; }
          }
          if (ringOn !== e) { this.drawRainbowMark(g, world, e); this.colorShiftMarkShown = e.id; }
        }
        this.drawRainbow(g, world, ringOn);
        this.colorShiftShown = ringOn.id;
      }
    }
  }

  /** Task 10: the small rainbow mark under the link that freed the colour (the ring has moved on to the chain's end). */
  private drawRainbowMark(g: Graphics, world: World, e: Enemy): void {
    const p = world.params, R = enemyDrawRadius(p) * UNIT * (e.elite || e.leader ? enemyArtScale(p, e) * 1.06 : 1);
    const x = e.x * UNIT, y = e.y * UNIT + R + 11, r = 9;
    const colors = CHAIN_COLORS.slice(0, Math.max(2, Math.min(CHAIN_COLORS.length, p.colorCount))), part = (Math.PI * 2) / colors.length;
    g.circle(x, y, r).fill({ color: NAVY, alpha: 0.85 });
    colors.forEach((c, i) => {
      const a0 = -Math.PI / 2 + i * part, a1 = a0 + part;
      g.moveTo(x, y).arc(x, y, r - 1.5, a0, a1).lineTo(x, y).fill({ color: c, alpha: 1 });
    });
    g.circle(x, y, r).stroke({ color: NAVY, width: 2, alpha: 1 });
  }

  /** «Смена цвета»: a rainbow ring round `e` — arcs of the arena's chain colours over a navy rim, turning slowly. */
  private drawRainbow(g: Graphics, world: World, e: Enemy): void {
    const p = world.params, x = e.x * UNIT, y = e.y * UNIT;
    const R = enemyDrawRadius(p) * UNIT * (e.elite || e.leader ? enemyArtScale(p, e) * 1.06 : 1) + 10;
    const colors = CHAIN_COLORS.slice(0, Math.max(2, Math.min(CHAIN_COLORS.length, p.colorCount)));
    g.circle(x, y, R).stroke({ color: NAVY, width: 12, alpha: 0.8 });
    const turn = this.clock * 1.6, part = (Math.PI * 2) / colors.length;
    colors.forEach((c, i) => {
      const a0 = turn + i * part, a1 = a0 + part;
      g.moveTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R).arc(x, y, R, a0, a1).stroke({ color: c, width: 7.5, alpha: 1, cap: 'butt' });
    });
  }

  /**
   * Loop research, step 3 («Прямая», design 12.10.2026, point 12): the drawn chain gives a pierce — a faint corridor band, the
   * arrow from the last link to the fixed end (navy under the chain colour, a head at the end), an end mark across the line, and
   * on each corridor body the mark of its outcome as on a link (dies — the cross badge, wounded — the orange ring and «!», a
   * plated elite — the lemon ring and «−1 пластина»). Nothing in the HUD; nothing written to the world.
   */
  private drawPierce(g: Graphics, world: World, pierce: PiercePreviewLike | undefined, ink: number): void {
    if (!pierce) return;
    const p = world.params, r = enemyDrawRadius(p) * UNIT, shown = this.pierceShown;
    const a = { x: pierce.from.x * UNIT, y: pierce.from.y * UNIT }, b = { x: pierce.to.x * UNIT, y: pierce.to.y * UNIT };
    const ux = pierce.ux, uy = pierce.uy, nx = -uy, ny = ux, half = (p.pierceCorridor ?? 0.5) * UNIT;
    g.moveTo(a.x + nx * half, a.y + ny * half).lineTo(b.x + nx * half, b.y + ny * half).lineTo(b.x - nx * half, b.y - ny * half).lineTo(a.x - nx * half, a.y - ny * half).closePath();
    g.fill({ color: ink, alpha: 0.1 });
    // A dashed shaft (the bodies under it stay readable) stops short of the head; the head is a triangle at the end.
    const head = 15, tip = { x: b.x, y: b.y }, back = { x: b.x - ux * head, y: b.y - uy * head };
    this.dashed(g, a, back, NAVY, 7, 0.55, 12, 8);
    this.dashed(g, a, back, ink, 3.5, 0.95, 12, 8);
    g.moveTo(tip.x, tip.y).lineTo(back.x + nx * 9, back.y + ny * 9).lineTo(back.x - nx * 9, back.y - ny * 9).closePath();
    g.fill({ color: ink, alpha: 0.95 }).stroke({ color: NAVY, width: 2.5, alpha: 0.8, join: 'round' });
    shown.arrow = 1;
    // The end mark: a bar across the line at the end (where the hero stops).
    g.moveTo(b.x + nx * half, b.y + ny * half).lineTo(b.x - nx * half, b.y - ny * half).stroke({ color: NAVY, width: 7, alpha: 0.7, cap: 'round' });
    g.moveTo(b.x + nx * half, b.y + ny * half).lineTo(b.x - nx * half, b.y - ny * half).stroke({ color: 0xffffff, width: 3, alpha: 0.95, cap: 'round' });
    shown.end = 1;
    for (const body of pierce.bodies) {
      const e = world.enemies.find(x => x.id === body.id);
      if (!e) continue;
      const x = e.x * UNIT, y = e.y * UNIT, cx = x - r * 0.7, cy = y - r * 0.75, o = body.outcome;
      shown.marks++;
      if (o.plate) {
        const R = e.elite || e.leader ? r * enemyArtScale(p, e) * 1.06 : r, bx = x - R * 0.7, by = y - R * 0.75, s = r * 0.2;
        g.circle(x, y, R + 4).stroke({ color: ELITE_LEMON, width: 4 });
        g.circle(bx, by, r * 0.32).fill(ELITE_LEMON).stroke({ color: NAVY, width: 2 });
        g.roundRect(bx - s * 0.8, by - s, s * 1.6, s * 2, s * 0.5).fill(NAVY);
        const label = this.plateLabel(this.eliteShown.planPlates++);
        label.position.set(x, y - R - 14);
        label.visible = true;
      } else if (o.killed) {
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

  /** Loop research, step 3: the fixed arrow flashes white (~0.2 s) at the release. */
  private pierceFlash(from: Vec, to: Vec): void {
    const g = new Graphics();
    g.moveTo(from.x * UNIT, from.y * UNIT).lineTo(to.x * UNIT, to.y * UNIT).stroke({ color: 0xffffff, width: 8, alpha: 0.9, cap: 'round' });
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life: 0.2, total: 0.2 });
  }

  /** Loop research, step 2: the `i`-th hit number of a closed ring (a pool of texts over the chain layer). */
  private sealLabel(i: number): Text {
    while (this.sealLabels.length <= i) {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 'bold', fill: 0xffffff, stroke: { color: NAVY, width: 4 } } });
      text.anchor.set(0.5, 0.5);
      text.visible = false;
      this.root.addChild(text);
      this.sealLabels.push(text);
    }
    return this.sealLabels[i];
  }

  /** A dashed line a → b (screen pixels). */
  private dashed(g: Graphics, a: Vec, b: Vec, color: number, width: number, alpha: number, dash = 10, gap = 7): void {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (let t = 0; t < len; t += dash + gap) {
      const e = Math.min(len, t + dash);
      g.moveTo(a.x + ux * t, a.y + uy * t).lineTo(a.x + ux * e, a.y + uy * e);
    }
    g.stroke({ color, width, alpha, cap: 'round' });
  }

  /**
   * Loop research, step 2 (docs/realtime-loop-research.md, 3.2): an open chain that could close — a pulsing «замкни» ring on the
   * first link (or the hero's circle) and a dashed line from the last link to it; a closed one — the ring filled with the chain
   * colour (alpha 0.15), its outline, and a mark on each enemy inside (the cross if the seal's hit kills it, else the hit
   * number in a plaque of the chain colour and a ring on the body — held). Nothing here writes to the world.
   */
  private drawLoop(g: Graphics, world: World, seal: SealPreviewLike | undefined, ink: number): void {
    const shown = this.loopShown, r = enemyDrawRadius(world.params) * UNIT;
    shown.candidates = 0; shown.closed = 0; shown.marks = 0;
    for (const label of this.sealLabels) label.visible = false;
    if (seal) {
      shown.closed = 1;
      const pts = seal.ring.map(v => ({ x: v.x * UNIT, y: v.y * UNIT }));
      const poly = (): void => { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); };
      poly(); g.fill({ color: ink, alpha: 0.15 });
      poly(); g.stroke({ color: NAVY, width: 8, alpha: 0.6, join: 'round' });
      poly(); g.stroke({ color: ink, width: 4, alpha: 0.95, join: 'round' });
      for (const id of seal.inside) {
        const e = world.enemies.find(x => x.id === id);
        if (!e) continue;
        const x = e.x * UNIT, y = e.y * UNIT, cx = x + r * 0.7, cy = y - r * 0.75;
        shown.marks++;
        // A plated elite inside loses a plate, not HP (the package): the survivor's ring and «−1».
        const plated = (eliteArmorView(e)?.plates ?? 0) > 0;
        if (!plated && seal.damage >= e.hp) {
          const s = r * 0.2;
          g.circle(cx, cy, r * 0.34).fill(0xf4efe0).stroke({ color: NAVY, width: 2 });
          g.moveTo(cx - s, cy - s).lineTo(cx + s, cy + s).moveTo(cx + s, cy - s).lineTo(cx - s, cy + s).stroke({ color: 0xa8322a, width: 3, cap: 'round' });
        } else {
          g.circle(x, y, r + 4).stroke({ color: ink, width: 3, alpha: 0.9 });
          g.circle(cx, cy, r * 0.34).fill(ink).stroke({ color: NAVY, width: 2 });
          const label = this.sealLabel(shown.marks - 1);
          label.text = plated ? '−1' : String(seal.damage);
          label.position.set(cx, cy);
          label.visible = true;
        }
      }
      return;
    }
    const last = world.chain.length ? linkPoint(world, world.chain[world.chain.length - 1]) : null;
    if (!last) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 7);
    for (const kind of loopCandidates(world)) {
      const target = kind === 'first' ? linkPoint(world, world.chain[0]) : { x: world.hero.x, y: world.hero.y };
      if (!target) continue;
      shown.candidates++;
      const tx = target.x * UNIT, ty = target.y * UNIT, base = (kind === 'first' ? r : heroRadius(world.params) * UNIT) + 8;
      this.dashed(g, { x: last.x * UNIT, y: last.y * UNIT }, { x: tx, y: ty }, ink, 3, 0.8);
      g.circle(tx, ty, base + 4 + pulse * 6).stroke({ color: NAVY, width: 7, alpha: 0.5 });
      g.circle(tx, ty, base + 4 + pulse * 6).stroke({ color: ink, width: 3.5, alpha: 0.65 + 0.35 * pulse });
    }
  }

  /**
   * Loop research, step 2, experiment `loopHint`: with the toggle on and no chain drawn (the player is about to draw), ONE best
   * closable figure from the hero is outlined faintly — dashed, in its colour. The search runs every 10 frames, view only.
   */
  private drawLoopHint(g: Graphics, world: World): void {
    this.loopShown.hint = 0; this.loopShown.candidates = 0; this.loopShown.closed = 0; this.loopShown.marks = 0;
    for (const label of this.sealLabels) label.visible = false;
    if (!world.params.loopHint || !world.params.loopEnabled) { this.hintFigure = null; return; }
    if (this.hintFrame++ % 10 === 0) this.hintFigure = findLoopHint(world);
    const f = this.hintFigure;
    if (!f || world.status !== 'playing' || world.move) return;
    const ink = chainInk(f.color), pts = f.ring.map(v => ({ x: v.x * UNIT, y: v.y * UNIT }));
    this.loopShown.hint = 1;
    for (let i = 0; i < pts.length; i++) this.dashed(g, pts[i], pts[(i + 1) % pts.length], ink, 3, 0.4, 8, 8);
  }

  /** Loop research, step 2: the outline of the ring flashes (~0.2 s) at the release and at the strike. */
  private sealFlash(points: readonly Vec[], kind: string): void {
    if (points.length < 3) return;
    let cx = 0, cy = 0;
    for (const v of points) { cx += v.x; cy += v.y; }
    cx /= points.length; cy /= points.length;
    const g = new Graphics();
    g.moveTo((points[0].x - cx) * UNIT, (points[0].y - cy) * UNIT);
    for (let i = 1; i < points.length; i++) g.lineTo((points[i].x - cx) * UNIT, (points[i].y - cy) * UNIT);
    g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.2 }).stroke({ color: 0xffffff, width: 6, alpha: 0.95, join: 'round' });
    g.position.set(cx * UNIT, cy * UNIT);
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life: 0.2, total: 0.2 });
    this.loopShown.flashes++;
    void kind;
  }

  /** A lemon ring at an arena point (units), `r` units wide, for `life` seconds. */
  private eliteBurst(x: number, y: number, r: number, life: number, width: number, grow = false): void {
    const g = new Graphics().circle(0, 0, r * UNIT).fill({ color: ELITE_LEMON, alpha: grow ? 0.3 : 0.18 }).stroke({ color: ELITE_LEMON, width, alpha: 0.95 });
    g.position.set(x * UNIT, y * UNIT);
    this.fxLayer.addChild(g);
    this.bursts.push({ g, life, total: life, ...grow ? { grow: true } : {} });
  }

  /** «−1 пластина» badges over armoured links of the drawn chain: the `i`-th text (a pool over the root). */
  private plateLabel(i: number): Text {
    while (this.plateLabels.length <= i) {
      const text = new Text({ text: '−1 пластина', style: { fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 'bold', fill: ELITE_LEMON, stroke: { color: 0x1a2330, width: 5 } } });
      text.anchor.set(0.5, 1);
      text.visible = false;
      this.root.addChild(text);
      this.plateLabels.push(text);
    }
    return this.plateLabels[i];
  }

  /**
   * П1 «Глубина звена»: the number N next to each candidate ring, only for N ≥ 2. The search (sim/linkDepth.ts, pure) runs
   * again every `LINK_DEPTH_FRAMES` render frames and at once when the drawn chain changes (a number for another chain
   * would promise a path that is not there); between runs the last numbers are drawn at the candidates' places now.
   */
  private drawLinkDepths(world: World, candidates: readonly Enemy[]): void {
    const key = world.chain.map(l => `${l.kind[0]}${l.id}`).join(',');
    if (key !== this.depthChain || ++this.depthFrames >= LINK_DEPTH_FRAMES) {
      const t0 = performance.now();
      this.depthCache = new Map(linkDepths(world).map(d => [d.id, d]));
      const ms = performance.now() - t0, shown = this.linkDepthShown;
      shown.computes++; shown.lastMs = ms; shown.maxMs = Math.max(shown.maxMs, ms);
      this.depthChain = key;
      this.depthFrames = 0;
    }
    // Just outside the candidate ring (its radius + 5, stroke 3) on the upper-left diagonal.
    const off = (enemyDrawRadius(world.params) * UNIT + 5 + 9) * Math.SQRT1_2;
    let i = 0;
    for (const e of candidates) {
      const depth = this.depthCache.get(e.id)?.depth ?? 0;
      if (depth < LINK_DEPTH_SHOWN) continue;
      const label = this.depthLabel(i++);
      label.text = String(depth);
      // Upper left of the ring: the HP badge sits upper right, the role badge under the body.
      label.position.set(e.x * UNIT - off, e.y * UNIT - off);
      label.visible = true;
      this.linkDepthShown.labels.push({ id: e.id, depth });
    }
  }

  /** П1: the `i`-th depth number (a pool of texts over the chain layer). */
  private depthLabel(i: number): Text {
    while (this.depthLabels.length <= i) {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 'bold', fill: 0xffffff, stroke: { color: NAVY, width: 4 } } });
      text.anchor.set(0.5, 0.5);
      text.visible = false;
      this.root.addChild(text);
      this.depthLabels.push(text);
    }
    return this.depthLabels[i];
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
      if (b.grow) { b.g.alpha = Math.min(1, k * 2); b.g.scale.set(0.3 + 0.7 * (1 - k)); } else { b.g.alpha = k; b.g.scale.set(1 + (1 - k) * 0.25); }
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
    this.updateSparks(realDt);
    this.updateDying(realDt);
    this.drawObjects(world);
    this.drawMarkers(world);
    this.drawTrails(world);
    this.drawLanes(world);
    this.drawRipples(world);
    this.syncEnemies(world);
    this.drawSignals(world);
    this.drawBadges(world);
    this.drawElites(world);
    this.drawCaptions(world);
    this.slotView.setFrame(this.base.x, this.base.y, this.scale, this.edgeInset.top);
    this.slotView.draw(world, this.clock, realDt, world.chain.length && !world.move ? slotPlanOdds(world) : null);
    this.drawTargets(world);
    this.drawSleep(world);
    this.bagView.draw(world, this.clock, realDt);
    this.featDoor.draw(world, this.bagView.shown.visible);
    this.drawChain(world, ui);
    this.drawPlayerFx(world, realDt);
    this.outlineLeft = Math.max(0, this.outlineLeft - realDt);
    this.drawHero(world);
    this.drawCurseCounter(world);
    this.drawOverlay(world);
    // The power number first: the combo counter stands beside it while both show (task 8b).
    this.drawPowerNumber(world, realDt);
    this.drawJuice(world, realDt);
    // Casino «Котёл»: the caption under the power number and the cheque.
    this.drawPurseCaption(world);
    this.drawCheque(world, realDt);
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
    this.outlineLeft = 0;
    this.shieldFull = 0; this.shieldLast = 0;
    this.comboLife = 0;
    this.comboValue = 0;
    this.powerLife = 0;
    this.powerValue = -1;
    for (const sp of this.sparks) sp.g.destroy();
    this.sparks.length = 0;
    for (const f of this.floating) f.text.destroy();
    this.floating.length = 0;
    for (const b of this.bursts) b.g.destroy();
    this.bursts.length = 0;
    this.dashTrail = [];
    this.cutSeen = false;
    this.slotView.reset();
    this.bagView.reset();
    this.featDoor.reset();
    for (const view of this.enemyViews.values()) view.root.destroy({ children: true });
    this.enemyViews.clear();
    for (const d of this.dying) d.root.destroy({ children: true });
    this.dying.length = 0;
    this.plaqued.clear();
    for (const pl of this.plaques.values()) pl.box.destroy({ children: true });
    this.plaques.clear();
    for (const c of this.captions) c.box.destroy({ children: true });
    this.captions.length = 0;
    this.captionShown.texts.length = 0; this.captionShown.live = 0;
    Object.assign(this.eliteShown, { plaquesSeen: 0, plaqueText: '', stripFlashes: 0, downFlashes: 0, cleanBreaks: 0 });
  }
}

/** Bounding box of a zone (units). */
function zoneBox(area: Area): { x0: number; y0: number; x1: number; y1: number } {
  if (area.shape === 'circle') return { x0: area.x - area.r, y0: area.y - area.r, x1: area.x + area.r, y1: area.y + area.r };
  if (area.shape === 'rect') return { x0: area.x, y0: area.y, x1: area.x + area.w, y1: area.y + area.h };
  const pad = area.shape === 'band' ? area.width / 2 : 0, xs = area.points.map(p => p.x), ys = area.points.map(p => p.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}
