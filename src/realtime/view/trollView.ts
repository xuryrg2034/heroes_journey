/**
 * Task 48 «Тролль», part ui (design 16.10.2026, docs/design-notes/task-48-troll.md, 16 and 24): the view of the forest's boss.
 * Everything is read from the sim (`trollCore`, `trollMove`, `trollState`, the core's `vars`, the events `bossMove`, `trollWindow`,
 * `partSevered`); nothing here changes the world, and no rule is copied (the geometry of every sign is the sim's own):
 * - the core — a large seated drawing (`TROLL_ART` body radii) over the grey colourless disc, awake (`troll`) or asleep
 *   (`troll-sleep`, «Храп»); open window — a lemon glow round the contour and a whole-second count over the head;
 * - the parts — the club, the rock and the tail's knot drawn behind their colour discs (the colour reads on the disc); the tail
 *   from the body to the knot is a line of beads of the Troll's skin (not the player's chain, not the flail's steel); a severed
 *   part falls off (`FALL_LIFE`), its tail line too;
 * - the signs (threat colour, the sim's numbers): «Удар дубиной» — the boar's strip; «Бросок камня» — the archer's circle and the
 *   rock's arc through the last `ROCK_FLIGHT` s; «Хвост метёт» — the ring `TAIL_INNER`…`TAIL_OUTER` hatched, filling from its inner
 *   edge, cut by the rock walls; «Рык» — a closing circle at each lair with the wolf's colour in it; «Храп» — an arc over the head
 *   filling for the whole snore, crumbling when the Troll is struck;
 * - «звон» (a hit outside the window): a short grey spark at the hide, no text; a window ending with the core in the drawn chain —
 *   a white ring on each link that dropped out.
 * Coordinates are arena pixels (`unit` per arena unit); `r` is the drawing radius of a body in px.
 */
import { BOSS_ART } from '../sim/bossArt';
import { countPlace, type VisibleArea } from './edgeMarkers';
import { ColorMatrixFilter, Container, Graphics, Text } from 'pixi.js';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import type { Vec } from '../sim/geometry';
import { palette } from '../sim/spawn';
import {
  ROCK_FLIGHT, TAIL_INNER, TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL, trollCore, trollMove, trollState, wolfColors, type TrollMoveId,
} from '../sim/enemies/troll';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { ELITE_LEMON } from './eliteView';
import { drawWhistleMark } from './jailerView';

const NAVY = 0x18232d;
const THREAT = 0xffffff;
const THREAT_OUTLINE = 0x0b0f14;
const SKIN = 0x6f9ca6;
const SKIN_DARK = 0x3f6870;
const SPARK_GREY = 0xc7ccd1;

/** The Troll's drawing: its box side in body radii (about 2.3 times the hero's height), the share of the box's height it takes, where its feet stand. */
export const TROLL_ART = BOSS_ART.troll.side;
export const TROLL_ART_ASPECT = BOSS_ART.troll.aspect;
export const TROLL_FEET = BOSS_ART.troll.feet ?? 0;
/** The weapons' boxes in body radii: the club's longer side, the rock, the tail's knot (the same rock, smaller). */
export const CLUB_ART = BOSS_ART['troll-club'].side;
export const ROCK_ART = BOSS_ART['troll-rock'].side;
export const KNOT_ART = BOSS_ART['troll-tail'].side;
/** The club's axis in its picture (head → handle, radians) and the grip's point (the share of the picture). */
const CLUB_AXIS = Math.atan2(380, 640);
const CLUB_GRIP = { x: 0.92, y: 0.88 };
/** Where the club's head points while it is in the paw (up and a little left, radians). */
const CLUB_HAND = -1.95;
/** Distance of a part's HP plaque from its centre along the line from the core, in body radii (the weight's plaque stands at 1.45). */
const PART_BADGE: Readonly<Record<string, number>> = { [TROLL_CLUB]: 1.7, [TROLL_ROCK]: 2.3, [TROLL_TAIL]: 1.8 };

/** Real seconds the effects last. */
export const SIGN_FLASH_LIFE = 0.3;
export const SPARK_LIFE = 0.25;
export const FALL_LIFE = 0.5;
export const CRUMBLE_LIFE = 0.6;
export const REGROW_LIFE = 0.5;
export const UNLINK_LIFE = 0.3;

export const isTrollKind = (kind: string): boolean => kind === TROLL || kind === TROLL_CLUB || kind === TROLL_ROCK || kind === TROLL_TAIL;

/** The whole-seconds count of a window with `left` s: «2» at 1.5, «1» in the last second (never 0). */
export const windowCount = (left: number): string => String(Math.max(1, Math.ceil(left - 1e-6)));

// ---- Geometry helpers (pure; Node-testable) ----

type Interval = [number, number];

/** `list` without the part of it inside `cut` (intervals of a line's parameter). */
export function subtractInterval(list: readonly Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of list) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/** A rock wall of the arena (units). */
export interface WallRect { x: number; y: number; w: number; h: number }

/**
 * The parts of the line `p + t·d` (|d| = 1, t in `[t0, t1]`) that lie in the ring `rIn`…`rOut` around `c` and outside the walls:
 * intervals of t. The ring's cut by the rock — «у скалы обрезано» — for the scanlines that fill it and the chords that hatch it.
 */
export function ringSpans(c: Vec, rIn: number, rOut: number, p: Vec, d: Vec, walls: readonly WallRect[]): Interval[] {
  const cx = c.x - p.x, cy = c.y - p.y, tc = cx * d.x + cy * d.y, near2 = cx * cx + cy * cy - tc * tc;
  if (rOut * rOut <= near2) return [];
  const ho = Math.sqrt(rOut * rOut - near2);
  let spans: Interval[] = [[tc - ho, tc + ho]];
  if (rIn > 0 && rIn * rIn > near2) { const hi = Math.sqrt(rIn * rIn - near2); spans = subtractInterval(spans, [tc - hi, tc + hi]); }
  for (const w of walls) {
    // The slab test of the line against the rectangle.
    let a = -Infinity, b = Infinity, miss = false;
    for (const [o, dd, lo, hi] of [[p.x, d.x, w.x, w.x + w.w], [p.y, d.y, w.y, w.y + w.h]] as const) {
      if (Math.abs(dd) < 1e-9) { if (o < lo || o > hi) miss = true; continue; }
      const t0 = (lo - o) / dd, t1 = (hi - o) / dd;
      a = Math.max(a, Math.min(t0, t1)); b = Math.min(b, Math.max(t0, t1));
    }
    if (!miss && a < b) spans = subtractInterval(spans, [a, b]);
  }
  return spans.filter(([a, b]) => b - a > 1e-6);
}

/** The point is inside one of the walls (units). */
export const inWalls = (p: Vec, walls: readonly WallRect[]): boolean => walls.some(w => p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h);

/** The rock walls of a world's arena (the ring of «Хвост метёт» is cut by them). */
export const wallsOf = (world: World): WallRect[] => world.arena.obstacles.flatMap(o => o.shape === 'rect' ? [{ x: o.x, y: o.y, w: o.w, h: o.h }] : []);

/** The unit vector from the Troll's core to its part (down when they stand on one point) — the line the part's plaque and pips stand on. */
export function partOutward(core: Vec, part: Vec): Vec {
  const dx = part.x - core.x, dy = part.y - core.y, d = Math.hypot(dx, dy);
  return d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 0, y: 1 };
}

/** Where a part's HP plaque stands from its centre (body-local px), and the pips' point beside it (the row is drawn there). */
export function partBadgeAt(kind: string, out: Vec, r: number): { x: number; y: number } {
  const k = (PART_BADGE[kind] ?? 1.7) * r;
  return { x: out.x * k, y: out.y * k };
}

/** The core's plate row stands under its right foot (the tail line leaves the middle): the centre `x` and the pip row's `R`. */
export const corePips = (x: number, y: number, r: number): { x: number; y: number; R: number } => ({ x: x + r * 1.9, y, R: r * 0.8 });

/** The core's HP plaque: by the drawing's head, on the right (body-local px). */
export const coreBadgeAt = (r: number): { x: number; y: number } => ({ x: r * TROLL_ART * 0.46, y: r * (TROLL_FEET - TROLL_ART * TROLL_ART_ASPECT * 0.82) });

// ---- The drawings ----

function procTroll(r: number, asleep: boolean): Graphics {
  const g = new Graphics(), w = r * TROLL_ART * 0.5, h = r * TROLL_ART * TROLL_ART_ASPECT;
  g.ellipse(0, -h * 0.3, w * 0.92, h * 0.3).fill(SKIN).stroke({ color: NAVY, width: 4 });
  g.ellipse(0, -h * 0.28, w * 0.5, h * 0.18).fill(0xa9b79a);
  g.roundRect(-w * 0.45, -h * 0.95, w * 0.9, h * 0.5, 16).fill(SKIN).stroke({ color: NAVY, width: 4 });
  g.poly([-w * 0.1, -h * 0.72, w * 0.12, -h * 0.72, 0, -h * 0.58]).fill(0xd8695a).stroke({ color: NAVY, width: 2 });
  if (asleep) g.moveTo(-w * 0.3, -h * 0.8).lineTo(-w * 0.12, -h * 0.8).moveTo(w * 0.12, -h * 0.8).lineTo(w * 0.3, -h * 0.8).stroke({ color: NAVY, width: 4, cap: 'round' });
  else g.moveTo(-w * 0.3, -h * 0.82).lineTo(-w * 0.1, -h * 0.78).moveTo(w * 0.1, -h * 0.78).lineTo(w * 0.3, -h * 0.82).stroke({ color: NAVY, width: 4, cap: 'round' });
  return g;
}

/** The Troll's drawing: awake and asleep, each with a lemon copy behind it for the window's glow; the feet at the root's origin. */
export interface CoreArt {
  root: Container;
  awake: Container;
  asleep: Container;
  glowAwake: Container;
  glowAsleep: Container;
}

/** The window's glow: the drawing's silhouette in lemon (the colour matrix keeps the alpha, sets the colour), made once. */
let lemonFilter: ColorMatrixFilter | null | undefined;
/** The silhouette filter; null where no filter can be made (Node tests: no canvas) — the copy is then only tinted. */
function lemon(): ColorMatrixFilter | null {
  if (lemonFilter === undefined) {
    try { lemonFilter = new ColorMatrixFilter(); lemonFilter.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.4, 0, 0, 0, 1, 0]; } catch { lemonFilter = null; }
  }
  return lemonFilter;
}
/** Colours `node` as the window's glow: the lemon silhouette (the filter), else a lemon tint. */
function glowOf(node: Container): void {
  const f = lemon();
  if (f) node.filters = [f]; else (node as Container & { tint: number }).tint = ELITE_LEMON;
}

export function buildCore(r: number): CoreArt {
  const root = new Container();
  const make = (id: 'troll' | 'troll-sleep', asleep: boolean, glow: boolean): Container => {
    const sprite = hasCharacterArt(id) ? characterSprite(id, r * TROLL_ART, r * TROLL_ART) : null;
    if (sprite) {
      sprite.position.set(0, -sprite.height / 2);
      if (glow) { glowOf(sprite); sprite.scale.set(sprite.scale.x * 1.08, sprite.scale.y * 1.08); }
      return sprite;
    }
    const g = procTroll(r, asleep);
    if (glow) { glowOf(g); g.scale.set(1.07); }
    return g;
  };
  const art: CoreArt = { root, awake: make('troll', false, false), asleep: make('troll-sleep', true, false), glowAwake: make('troll', false, true), glowAsleep: make('troll-sleep', true, true) };
  for (const glow of [art.glowAwake, art.glowAsleep]) glow.alpha = 0;
  art.asleep.visible = false; art.glowAsleep.visible = false;
  root.addChild(art.glowAwake, art.glowAsleep, art.awake, art.asleep);
  root.position.set(0, r * TROLL_FEET);
  return art;
}

/** A part's weapon drawing, put behind its colour disc: the club (the grip at the disc), the rock, the tail's knot. Null — not a part. */
export function buildPartArt(kind: string, r: number): Container | null {
  if (kind === TROLL_CLUB) {
    const sprite = hasCharacterArt('troll-club') ? characterSprite('troll-club', r * CLUB_ART, r * CLUB_ART) : null;
    if (sprite) { sprite.anchor.set(CLUB_GRIP.x, CLUB_GRIP.y); return sprite; }
    const g = new Graphics();
    g.roundRect(-r * 3.6, -r * 0.45, r * 3.8, r * 0.9, r * 0.3).fill(0x9a6a3a).stroke({ color: NAVY, width: 4 });
    g.circle(-r * 3.4, 0, r * 0.7).fill(0x9a6a3a).stroke({ color: NAVY, width: 4 });
    return g;
  }
  if (kind === TROLL_ROCK || kind === TROLL_TAIL) {
    const box = kind === TROLL_ROCK ? ROCK_ART : KNOT_ART, sprite = hasCharacterArt('troll-rock') ? characterSprite('troll-rock', r * box, r * box) : null;
    if (sprite) return sprite;
    const g = new Graphics(), R = r * box / 2;
    g.poly([-R, R * 0.4, -R * 0.6, -R * 0.7, R * 0.1, -R, R * 0.8, -R * 0.5, R, R * 0.5, R * 0.1, R * 0.8]).fill(0x56627a).stroke({ color: NAVY, width: 4 });
    return g;
  }
  return null;
}

/** Poses a part's drawing each frame: the club points its head along the lane while it lies (up while in the paw); `hide` — the rock is in the air. */
export function posePartArt(art: Container, kind: string, part: Enemy, core: Enemy | undefined, hide: boolean): void {
  art.visible = !hide;
  if (kind !== TROLL_CLUB) return;
  const lying = part.vars.lie !== undefined && !!core, head = lying ? Math.atan2(part.y - core!.y, part.x - core!.x) : CLUB_HAND;
  art.rotation = head + Math.PI - CLUB_AXIS;
}

/** The drawing tools of render.ts that the signs share (the boar's strip and its head, the hatched circle). */
export interface SignTools {
  strip: (g: Graphics, ox: number, oy: number, ux: number, uy: number, len: number, half: number, progress: number, fade: number) => void;
  head: (g: Graphics, ox: number, oy: number, ux: number, uy: number, t: number, half: number, fade: number) => void;
  hatchCircle: (g: Graphics, X: number, Y: number, R: number, step: number) => void;
}

interface Fx { kind: 'spark' | 'ring' | 'flash' | 'crumble' | 'regrow'; x: number; y: number; r: number; born: number; life: number; ux?: number; uy?: number; progress?: number; sign?: SignGeometry }

/** A sign's geometry as it was drawn last (a hit flashes it where it stood). */
interface SignGeometry { move: Exclude<TrollMoveId, 'snore'>; x: number; y: number; r: number; ux: number; uy: number; len: number; half: number; inner: number; gates: Vec[]; ink: number[] }

interface Piece { node: Container; x: number; y: number; vx: number; spin: number; born: number; life: number }

/** The Troll's view: what the last frame drew and the events seen (`shown` — the test's snapshot), the effects, the layer over the enemies. */
export class TrollView {
  readonly shown = {
    /** The core is drawn this frame (0/1), asleep («Храп»), its glow is lit (window open), the whole-second count over it ('' — none) and by its goal arrow. */
    core: 0, asleep: 0, glow: 0, count: '', edgeCount: '',
    /** The move sign drawn now ('' — none) and its fill 0…1; the signs by shape: the strip, the circle, the ring, the lairs' circles; the snore's arc (its fill, 0 — none). */
    sign: '', signProgress: 0, strips: 0, circles: 0, rings: 0, gateMarks: 0, snoreArc: 0,
    /** The tail's line drawn (0/1), the parts' drawings put (count), the rock in the air (0/1). */
    tail: 0, weapons: 0, flight: 0,
    /** Seen so far: signs flashed at a hit, sparks of «звон», parts that fell off, the tail line that fell, white rings of dropped links, crumbled snore arcs, regrown plates, windows opened. */
    hits: 0, sparks: 0, severed: 0, tailFalls: 0, unlinks: 0, crumbles: 0, regrows: 0, opens: 0,
  };
  /** The layer over the enemies: the effects, the count, the rock in the air, the pieces that fell off. */
  readonly layer = new Container();
  private readonly fxG = new Graphics();
  private readonly pieces: Piece[] = [];
  private fx: Fx[] = [];
  private lastSign: SignGeometry | null = null;
  private tailSeen: { x0: number; y0: number; x1: number; y1: number; r: number } | null = null;
  private tailBreaks: { x0: number; y0: number; x1: number; y1: number; r: number; until: number }[] = [];
  private seenParts = new Map<number, { kind: string; x: number; y: number; rot: number; r: number }>();
  private countLabel: Text | null = null;
  private edgeLabel: Text | null = null;
  /** The dark plate under the count by the goal pointer (as under «далеко»): the count never lies on a body's disc. */
  private edgeBack: Graphics | null = null;
  private rockFlight: Container | null = null;
  private plates = new Map<number, number>();

  /** `unit` — arena pixels per unit (render.ts `UNIT`); `ink` — a sim colour index as the view's colour (render.ts `chainInk`). */
  constructor(private readonly unit: number, private readonly ink: (color: number) => number) { this.layer.addChild(this.fxG); }

  /** The counters of the frame start from zero (the cumulative ones stay). */
  beginFrame(): void {
    const s = this.shown;
    s.core = 0; s.asleep = 0; s.glow = 0; s.count = ''; s.sign = ''; s.signProgress = 0; s.strips = 0; s.circles = 0; s.rings = 0; s.gateMarks = 0; s.snoreArc = 0; s.tail = 0; s.weapons = 0; s.flight = 0;
  }

  /** The new fight: no effects, no memory. */
  reset(): void {
    this.fx = []; this.lastSign = null; this.tailSeen = null; this.tailBreaks = []; this.seenParts.clear(); this.plates.clear();
    for (const p of this.pieces.splice(0)) p.node.destroy({ children: true });
    this.fxG.clear();
    if (this.countLabel) this.countLabel.visible = false;
    if (this.edgeLabel) this.edgeLabel.visible = false;
    if (this.edgeBack) this.edgeBack.visible = false;
    if (this.rockFlight) this.rockFlight.visible = false;
    Object.assign(this.shown, { hits: 0, sparks: 0, severed: 0, tailFalls: 0, unlinks: 0, crumbles: 0, regrows: 0, opens: 0 });
  }

  /**
   * The sim's events of the frame, in order (`clock` — real seconds, `r` — the drawing radius of a body, arena px). A move's hit flashes its
   * sign where it stood; «звон» sparks at the hide; a part that is severed falls off; the snore ended — struck: the arc crumbles,
   * left alone: the plate grows back (its flash); a window that ended with the core in the drawn chain: a white ring on each link
   * that dropped out. Returns whether the event was the Troll's.
   */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number): boolean {
    const U = this.unit;
    if (ev.type === 'bossMove') {
      const core = trollCore(world);
      if (!core || ev.id !== core.id) return false;
      if (ev.stage === 'hit' && ev.move !== 'snore' && this.lastSign?.move === ev.move) {
        this.fx.push({ kind: 'flash', x: 0, y: 0, r: 0, born: clock, life: SIGN_FLASH_LIFE, sign: this.lastSign });
        this.shown.hits++;
      }
      return true;
    }
    if (ev.type === 'trollWindow') {
      if (ev.action === 'open') this.shown.opens++;
      else if (ev.action === 'block') {
        // A hit outside the window: a spark at the hide on the side of the hero (a small star of four grey strokes).
        const hero = world.hero, dx = hero.x - ev.x, dy = hero.y - ev.y, d = Math.hypot(dx, dy) || 1;
        this.fx.push({ kind: 'spark', x: (ev.x + dx / d * 0.6) * U, y: (ev.y - 0.9 + dy / d * 0.2) * U, r, born: clock, life: SPARK_LIFE });
        this.shown.sparks++;
      } else if (ev.action === 'unlink') {
        for (const id of ev.dropped ?? []) {
          const e = world.enemies.find(x => x.id === id);
          if (e) { this.fx.push({ kind: 'ring', x: e.x * U, y: e.y * U, r: r + 6, born: clock, life: UNLINK_LIFE }); this.shown.unlinks++; }
        }
      } else if (ev.action === 'close' && ev.source === 'snore') {
        // Struck in his sleep (no `bossMove` `snore` `hit` in this frame): the arc crumbles where it stood.
        const slept = world.events.some(e => e.type === 'bossMove' && e.move === 'snore' && e.stage === 'hit');
        const core = trollCore(world);
        if (!slept && core) { this.fx.push({ kind: 'crumble', x: core.x * U, y: core.y * U, r, born: clock, life: CRUMBLE_LIFE }); this.shown.crumbles++; }
      }
      return true;
    }
    if (ev.type === 'partSevered') {
      const seen = this.seenParts.get(ev.id);
      if (!seen) return false;
      this.seenParts.delete(ev.id);
      this.shown.severed++;
      if (seen.kind === TROLL_TAIL && this.tailSeen) { this.tailBreaks.push({ ...this.tailSeen, until: clock + FALL_LIFE }); this.shown.tailFalls++; }
      const art = buildPartArt(seen.kind, seen.r);
      if (art) {
        art.position.set(seen.x, seen.y); art.rotation = seen.rot;
        this.layer.addChild(art);
        this.pieces.push({ node: art, x: seen.x, y: seen.y, vx: (seen.x - ev.x * U) * 0.4 + (seen.kind === TROLL_CLUB ? -14 : 14), spin: seen.kind === TROLL_CLUB ? -2.4 : 1.6, born: clock, life: FALL_LIFE });
      }
      return true;
    }
    if (ev.type === 'bossPlate') {
      // A plate that grew back (the snore slept through): the new count is above the last drawn one — a lemon flash on the core.
      const core = trollCore(world), before = this.plates.get(ev.id);
      if (!core || ev.id !== core.id || before === undefined || ev.plates <= before) return false;
      this.fx.push({ kind: 'regrow', x: core.x * U, y: core.y * U, r, born: clock, life: REGROW_LIFE });
      this.shown.regrows++;
      return true;
    }
    return false;
  }

  /** Notes the core's plates at the end of a frame (a `bossPlate` event compares against them), and the parts' places (a severed part falls from there). */
  note(world: World, r: number): void {
    const core = trollCore(world);
    this.plates.clear();
    if (core?.armor) this.plates.set(core.id, core.armor.plates);
    const U = this.unit, alive = new Set<number>();
    for (const e of world.enemies) {
      if (e.partOf === undefined || (e.kind !== TROLL_CLUB && e.kind !== TROLL_ROCK && e.kind !== TROLL_TAIL)) continue;
      alive.add(e.id);
      const lying = e.vars.lie !== undefined && !!core, head = lying ? Math.atan2(e.y - core!.y, e.x - core!.x) : -1.95;
      this.seenParts.set(e.id, { kind: e.kind, x: e.x * U, y: e.y * U, rot: e.kind === TROLL_CLUB ? head + Math.PI - CLUB_AXIS : 0, r });
    }
    // Parts gone without an event (the core died, a new fight) are forgotten once the frame is over.
    for (const id of [...this.seenParts.keys()]) if (!alive.has(id) && !world.events.some(ev => ev.type === 'partSevered' && ev.id === id)) this.seenParts.delete(id);
  }

  /** The part's weapon is hidden while the rock is in the air (the disc stays in the paw). */
  rockInAir(world: World): { from: Enemy; to: Vec; f: number } | null {
    const m = trollMove(world), core = trollCore(world);
    if (!m || m.move !== 'rock' || !core) return null;
    const left = core.vars.t ?? 0;
    if (left > ROCK_FLIGHT + 1e-9) return null;
    const rock = world.enemies.find(p => p.partOf === core.id && p.kind === TROLL_ROCK);
    return rock && rock.vars.lie === undefined ? { from: rock, to: m.at, f: Math.max(0, Math.min(1, 1 - left / ROCK_FLIGHT)) } : null;
  }

  /**
   * The signs under the crowd (`g` — the lane layer): «Удар дубиной», «Бросок камня», «Хвост метёт», «Рык», each at its fill; the sim's
   * own geometry (`trollMove`). The geometry is kept so a hit flashes it where it stood.
   */
  drawSigns(g: Graphics, world: World, tools: SignTools, sees: (p: Vec) => boolean): void {
    const m = trollMove(world), U = this.unit, s = this.shown;
    // No move: the last sign is kept — the hit's event of the next frame flashes it where it stood.
    if (!m) return;
    s.sign = m.move; s.signProgress = m.progress;
    if (m.move === 'club' && m.from && m.to) {
      const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y, lenU = Math.hypot(dx, dy), len = lenU * U, half = (m.width ?? 1.6) / 2 * U;
      if (lenU < 1e-6) return;
      const ux = dx / lenU, uy = dy / lenU;
      this.lastSign = { move: 'club', x: m.from.x * U, y: m.from.y * U, r: 0, ux, uy, len, half, inner: 0, gates: [], ink: [] };
      if (!sees(m.from) && !sees(m.to)) return;
      tools.strip(g, m.from.x * U, m.from.y * U, ux, uy, len, half, m.progress, 1);
      tools.head(g, m.from.x * U, m.from.y * U, ux, uy, len, half, 1);
      s.strips++;
    } else if (m.move === 'rock') {
      this.lastSign = { move: 'rock', x: m.at.x * U, y: m.at.y * U, r: m.r * U, ux: 0, uy: 0, len: 0, half: 0, inner: 0, gates: [], ink: [] };
      if (!sees(m.at)) return;
      this.circleSign(g, tools, m.at.x * U, m.at.y * U, m.r * U, m.progress, 0);
      s.circles++;
    } else if (m.move === 'tail') {
      this.lastSign = { move: 'tail', x: m.at.x * U, y: m.at.y * U, r: m.r * U, ux: 0, uy: 0, len: 0, half: 0, inner: (m.inner ?? TAIL_INNER) * U, gates: [], ink: [] };
      if (!sees(m.at)) return;
      this.drawRing(g, world, m.at, m.inner ?? TAIL_INNER, m.r, m.progress, 0);
      s.rings++;
    } else if (m.move === 'roar' && m.gates) {
      const ink = this.wolfInks(world, m.gates.length);
      this.lastSign = { move: 'roar', x: 0, y: 0, r: m.r * U, ux: 0, uy: 0, len: 0, half: 0, inner: 0, gates: m.gates.map(p => ({ x: p.x * U, y: p.y * U })), ink };
      m.gates.forEach((p, k) => {
        if (!sees(p)) return;
        drawWhistleMark(g, p.x * U, p.y * U, m.r * U, [ink[k]], m.progress, 1);
        s.gateMarks++;
      });
    }
  }

  /** The colours of the wolves the roar calls: the sim's own rule (`wolfColors`), as the view's inks. */
  private wolfInks(world: World, n: number): number[] {
    const core = trollCore(world), colors = core ? wolfColors(world, core) : palette(world);
    return Array.from({ length: n }, (_, k) => this.ink(colors[k % colors.length]));
  }

  private circleSign(g: Graphics, tools: SignTools, X: number, Y: number, R: number, progress: number, flash: number): void {
    if (flash > 0) { g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.5 * flash }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: flash }); return; }
    g.circle(X, Y, R).fill({ color: THREAT, alpha: 0.16 });
    if (progress > 0) g.circle(X, Y, R * Math.min(1, progress)).fill({ color: THREAT, alpha: 0.28 });
    tools.hatchCircle(g, X, Y, R, 0.32 * this.unit);
    g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
    g.circle(X, Y, R).stroke({ color: THREAT_OUTLINE, width: 5, alpha: 0.8 }).circle(X, Y, R).stroke({ color: THREAT, width: 2, alpha: 0.95 });
  }

  /**
   * «Хвост метёт»: the ring `inner`…`outer` units round `c`, hatched, filling from its inner edge outwards with `progress`; the rock walls
   * cut it (nobody stands in them). `flash` (0…1) — the blow just fell: the whole ring lights and fades.
   */
  private drawRing(g: Graphics, world: World, c: Vec, inner: number, outer: number, progress: number, flash: number): void {
    const U = this.unit, walls = wallsOf(world), step = 3 / U, fillTo = flash > 0 ? outer : inner + (outer - inner) * Math.max(0, Math.min(1, progress));
    const rows = (rIn: number, rOut: number, alpha: number): void => {
      for (let y = c.y - rOut; y < c.y + rOut; y += step) {
        for (const [a, b] of ringSpans(c, rIn, rOut, { x: c.x, y: y + step / 2 }, { x: 1, y: 0 }, walls)) g.rect((c.x + a) * U, y * U, (b - a) * U, step * U + 0.5);
      }
      g.fill({ color: THREAT, alpha });
    };
    rows(inner, outer, flash > 0 ? 0.5 * flash : 0.12);
    if (flash > 0) { this.ringOutline(g, world, c, inner, outer, flash); return; }
    if (progress > 0) rows(inner, fillTo, 0.26);
    // Hatching: chords at 45° every 0.32 u across the ring, cut by the walls.
    const k = Math.SQRT1_2, hs = 0.32;
    for (let s = -outer + hs / 2; s < outer; s += hs) {
      const p0 = { x: c.x + k * s, y: c.y + k * s }, d = { x: k, y: -k };
      for (const [a, b] of ringSpans(c, inner, outer, p0, d, walls)) g.moveTo((p0.x + d.x * a) * U, (p0.y + d.y * a) * U).lineTo((p0.x + d.x * b) * U, (p0.y + d.y * b) * U);
    }
    g.stroke({ color: THREAT, width: 2.5, alpha: 0.6 });
    this.ringOutline(g, world, c, inner, outer, 1);
  }

  private ringOutline(g: Graphics, world: World, c: Vec, inner: number, outer: number, alpha: number): void {
    const U = this.unit, walls = wallsOf(world), N = 96;
    for (const [wd, color, a] of [[5, THREAT_OUTLINE, 0.8 * alpha], [2, THREAT, 0.95 * alpha]] as const) {
      for (const R of [inner, outer]) {
        for (let i = 0; i < N; i++) {
          const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, mid = (a0 + a1) / 2;
          if (inWalls({ x: c.x + Math.cos(mid) * R, y: c.y + Math.sin(mid) * R }, walls)) continue;
          g.moveTo((c.x + Math.cos(a0) * R) * U, (c.y + Math.sin(a0) * R) * U).lineTo((c.x + Math.cos(a1) * R) * U, (c.y + Math.sin(a1) * R) * U);
        }
      }
      g.stroke({ color, width: wd, alpha: a });
    }
  }

  /**
   * The core's frame: its drawing awake or asleep, the glow round the contour while a window is open (it dims once the hit has landed),
   * the head thrown back while he roars, the whole-second count over the head. `art` — the core's drawing (`buildCore`), null when
   * the body is not drawn. `r` — the body's drawing radius in px.
   */
  syncCore(art: CoreArt | null, world: World, clock: number, r: number, visible: boolean, area?: VisibleArea): void {
    const st = trollState(world), s = this.shown;
    if (this.countLabel) this.countLabel.visible = false;
    if (!art || !st) return;
    const m = trollMove(world), asleep = st.snore !== null, win = st.window, lit = !!win && win.open && !win.hit;
    s.core = 1; s.asleep = asleep ? 1 : 0;
    art.awake.visible = !asleep; art.asleep.visible = asleep;
    // Glow: a pulse, blinking in the last half second (the elite window's way).
    const urgent = !!win && win.left < 0.5 && Math.floor(clock * 12) % 2 === 0;
    const a = lit ? (0.5 + 0.25 * Math.sin(clock * 9)) * (urgent ? 0.45 : 1) : 0;
    art.glowAwake.visible = !asleep && lit; art.glowAsleep.visible = asleep && lit;
    art.glowAwake.alpha = a; art.glowAsleep.alpha = a;
    if (lit) s.glow = 1;
    // «Рык»: the head thrown back — a little taller and tilted for the windup.
    const lift = m?.move === 'roar' ? Math.min(1, m.progress * 2.5) : 0;
    art.root.scale.set(1 + 0.02 * lift, 1 + 0.07 * lift);
    art.root.rotation = -0.06 * lift;
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
    // Right of the head, below the snore arc's right end and the HP plaque (design 17.10.2026, task 48 §24.15: it sat on both).
    const at = { x: st.x * U + r * TROLL_ART * 0.48, y: st.y * U - r * TROLL_ART * TROLL_ART_ASPECT * 0.45 };
    const put = area ? countPlace(at, { x: st.x * U, y: st.y * U }, r * 1.4, area, 18) : at;
    label.position.set(put.x, put.y);
    label.visible = true;
  }

  /** The count by the core's goal arrow while the core is off screen (the hero by a far part): the window is seen wherever the hero is. */
  drawEdge(world: World, goal: { x: number; y: number; angle: number } | undefined, coreSeen: boolean, parent: Container): void {
    const st = trollState(world), s = this.shown, win = st?.window;
    s.edgeCount = '';
    if (this.edgeLabel) this.edgeLabel.visible = false;
    if (this.edgeBack) this.edgeBack.visible = false;
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
    const back = this.edgeBack ??= (() => { const g = new Graphics(); parent.addChildAt(g, Math.max(0, parent.getChildIndex(label))); return g; })();
    back.clear().roundRect(label.position.x - 17, label.position.y - 17, 34, 34, 8).fill({ color: 0x0f1720, alpha: 0.88 }).stroke({ color: 0x55616e, width: 2 });
    back.visible = true;
    label.visible = true;
  }

  /** The snore's arc over the head (signal layer), the rock in the air, the effects; one call a frame, after the enemies are placed. */
  drawOver(g: Graphics, world: World, clock: number, dt: number, r: number, tools: SignTools): void {
    const U = this.unit, st = trollState(world), s = this.shown, fxG = this.fxG;
    fxG.clear();
    if (!st && this.countLabel) this.countLabel.visible = false;
    if (st && st.snore !== null) {
      s.snoreArc = Math.max(0.001, st.snore);
      const cx = st.x * U + r * TROLL_ART * 0.04, top = st.y * U + r * TROLL_FEET - r * TROLL_ART * TROLL_ART_ASPECT, R = r * TROLL_ART * 0.28, cy = top + r * TROLL_ART * TROLL_ART_ASPECT * 0.22;
      this.snoreArc(g, cx, cy, R, st.snore, 1);
    }
    // The rock in the air: an arc over the ground from the paw to the mark through the last `ROCK_FLIGHT` s, spinning, its shadow on the ground.
    const air = this.rockInAir(world);
    s.flight = air ? 1 : 0;
    if (air) {
      const x = (air.from.x + (air.to.x - air.from.x) * air.f) * U, y = (air.from.y + (air.to.y - air.from.y) * air.f) * U, h = Math.sin(air.f * Math.PI) * 2.2 * U;
      const sprite = this.flightSprite(r);
      sprite.position.set(x, y - h); sprite.rotation = air.f * 7; sprite.visible = true;
      fxG.ellipse(x, y + r * 0.4, r * 1.1 * (1 - h / (3.5 * U)), r * 0.4 * (1 - h / (3.5 * U))).fill({ color: 0x050a07, alpha: 0.4 });
    } else if (this.rockFlight) this.rockFlight.visible = false;
    // Effects.
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) {
      const k = 1 - (clock - f.born) / f.life;
      if (f.kind === 'spark') {
        const R = f.r * (0.5 + 0.5 * (1 - k));
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
          fxG.moveTo(f.x + c * R * 0.3, f.y + sn * R * 0.3).lineTo(f.x + c * R, f.y + sn * R);
        }
        fxG.stroke({ color: NAVY, width: 6, alpha: k, cap: 'round' });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
          fxG.moveTo(f.x + c * R * 0.3, f.y + sn * R * 0.3).lineTo(f.x + c * R, f.y + sn * R);
        }
        fxG.stroke({ color: SPARK_GREY, width: 3, alpha: k, cap: 'round' });
      } else if (f.kind === 'ring') {
        fxG.circle(f.x, f.y, f.r * (1 + 0.5 * (1 - k))).stroke({ color: 0xffffff, width: 5, alpha: 0.9 * k });
      } else if (f.kind === 'regrow') {
        fxG.circle(f.x, f.y, f.r * (2.2 + 1.6 * (1 - k))).stroke({ color: ELITE_LEMON, width: 6, alpha: k });
        fxG.circle(f.x, f.y, f.r * (2.2 + 1.6 * (1 - k))).fill({ color: ELITE_LEMON, alpha: 0.15 * k });
      } else if (f.kind === 'crumble') {
        this.snoreArc(fxG, f.x + r * TROLL_ART * 0.04, f.y + r * TROLL_FEET - r * TROLL_ART * TROLL_ART_ASPECT + r * TROLL_ART * TROLL_ART_ASPECT * 0.22, r * TROLL_ART * 0.28, 1, k, 1 - k);
      } else if (f.sign) this.flashSign(fxG, world, tools, f.sign, k);
    }
    // The pieces that fell off: they drop, turn and fade.
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i], t = (clock - p.born) / p.life;
      if (t >= 1) { p.node.destroy({ children: true }); this.pieces.splice(i, 1); continue; }
      p.node.position.set(p.x + p.vx * t, p.y + t * t * 40 * (this.unit / 72) + t * 6);
      p.node.rotation += p.spin * dt; p.node.alpha = 1 - t * t;
    }
  }

  /** The flying rock's drawing (made once). */
  private flightSprite(r: number): Container {
    if (!this.rockFlight) { this.rockFlight = buildPartArt(TROLL_ROCK, r)!; this.layer.addChild(this.rockFlight); }
    return this.rockFlight;
  }

  /** «Храп»: the arc over the head — a dark rim, the filled part (`progress`, from the left) in lemon; crumbling (`scatter` > 0) it breaks into pieces that drop. */
  private snoreArc(g: Graphics, cx: number, cy: number, R: number, progress: number, alpha: number, scatter = 0): void {
    const a0 = Math.PI * 1.1, a1 = Math.PI * 1.9, span = a1 - a0, N = 12;
    if (scatter <= 0) {
      g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R).arc(cx, cy, R, a0, a1).stroke({ color: THREAT_OUTLINE, width: 9, alpha: 0.7 * alpha, cap: 'round' });
      g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R).arc(cx, cy, R, a0, a1).stroke({ color: THREAT, width: 2, alpha: 0.5 * alpha, cap: 'round' });
      if (progress > 0.005) {
        const e = a0 + span * Math.min(1, progress);
        g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R).arc(cx, cy, R, a0, e).stroke({ color: THREAT_OUTLINE, width: 9, alpha, cap: 'round' });
        g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R).arc(cx, cy, R, a0, e).stroke({ color: ELITE_LEMON, width: 5, alpha, cap: 'round' });
      }
      return;
    }
    // Crumbling: the arc's pieces fall apart, each with its own drift (a fixed table, not random).
    const upTo = Math.min(1, progress);
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 0.7) / N;
      if (u0 > upTo) break;
      const drift = (((i * 7) % N) / N - 0.5), dy = scatter * scatter * R * 1.6 + scatter * R * 0.15 * (i % 3), dx = drift * scatter * R * 0.9;
      const s0 = a0 + span * u0, s1 = a0 + span * Math.min(u1, upTo);
      g.moveTo(cx + dx + Math.cos(s0) * R, cy + dy + Math.sin(s0) * R).arc(cx + dx, cy + dy, R, s0, s1).stroke({ color: ELITE_LEMON, width: 5, alpha, cap: 'round' });
    }
  }

  private flashSign(g: Graphics, world: World, tools: SignTools, s: SignGeometry, k: number): void {
    if (s.move === 'club') {
      tools.strip(g, s.x, s.y, s.ux, s.uy, s.len, s.half, 1, k);
      return;
    }
    if (s.move === 'rock') { this.circleSign(g, tools, s.x, s.y, s.r, 1, k); return; }
    if (s.move === 'tail') { this.drawRing(g, world, { x: s.x / this.unit, y: s.y / this.unit }, s.inner / this.unit, s.r / this.unit, 1, k); return; }
    for (const p of s.gates) g.circle(p.x, p.y, s.r).fill({ color: THREAT, alpha: 0.4 * k }).stroke({ color: THREAT_OUTLINE, width: 4, alpha: k });
  }

  /**
   * The tail from the body to its knot (under the enemies, `cg` — the boss layer): seven beads of the Troll's skin, thinning to the
   * knot, with a navy outline; a severed tail's line falls and fades (`FALL_LIFE`). Not the player's chain, not the flail's steel.
   */
  drawTail(cg: Graphics, world: World, r: number, clock: number): void {
    const U = this.unit, core = trollCore(world), tail = core ? world.enemies.find(p => p.partOf === core.id && p.kind === TROLL_TAIL) : undefined;
    if (core && tail) {
      const line = { x0: core.x * U, y0: core.y * U + r * 0.7, x1: tail.x * U, y1: tail.y * U - r * 0.3, r };
      this.tailSeen = line;
      this.tailBeads(cg, line, 0, 1);
      this.shown.tail = 1;
    }
    this.tailBreaks = this.tailBreaks.filter(b => b.until > clock);
    for (const b of this.tailBreaks) this.tailBeads(cg, b, 1 - (b.until - clock) / FALL_LIFE, 1);
  }

  private tailBeads(g: Graphics, l: { x0: number; y0: number; x1: number; y1: number; r: number }, drop: number, alpha: number): void {
    const N = 7, len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    if (len < 1e-6) return;
    const nx = -(l.y1 - l.y0) / len, ny = (l.x1 - l.x0) / len;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N, wob = Math.sin(t * Math.PI * 1.5) * l.r * 0.22 * (1 - drop), rad = l.r * (0.42 - 0.2 * t);
      const x = l.x0 + (l.x1 - l.x0) * t + nx * wob + (i - N / 2) * drop * 5, y = l.y0 + (l.y1 - l.y0) * t + ny * wob + drop * drop * 30;
      g.circle(x, y, rad).fill({ color: i % 2 ? SKIN : SKIN_DARK, alpha: alpha * (1 - drop) }).stroke({ color: NAVY, width: 3, alpha: alpha * (1 - drop) });
    }
  }
}
