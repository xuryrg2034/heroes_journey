/**
 * Horde arrival (Brotato-style): groups of 2–4 every 3–5 s, each enemy announced by a
 * marker; the enemy steps out after the marker delay. Under the arena limit the
 * rest waits in a queue. Pace and composition come from `pressureAt` (the panel values or the arena template's own).
 * Stage 3: a share of groups comes as a wolf pack (mixed colors by default, as the pack rule of the main game: a pack does not tell colors apart); boars join
 * other groups by their share, capped on the arena. An arena template may add newcomers of other registered kinds.
 * Deterministic: places read the seeded `spawnPlace` stream, composition (interval, size, kind, colour, HP) — `spawnRoll`,
 * the personal speed spread — `speed` (rng.ts).
 *
 * Phase A, Т5 (docs/realtime-phase-a.md, section 6): on an arena bigger than the camera's view (`VIEW_W × VIEW_H`) the
 * groups come at the edge of a rectangle `SPAWN_RECT_W × SPAWN_RECT_H` round the hero, shifted inside the arena — inside
 * the view, so the player sees the markers — and the density floor and the arena limit grow with the area
 * (`areaScale`). An arena not bigger than the view takes the old code path: the same points, the same draws of the
 * random streams, the same hash.
 */
import { dcos, dsin } from './detMath';
import { behaviorOf, enemyKind } from './enemies/kinds';
import { eliteRoll, makeElite, rollRandomElite } from './elites';
import { COLOR_COUNT, EVENT_EXTRA_ENEMIES, EVENT_PACE_FACTOR, MAX_COLORS, MAX_TOUGH_HP, MIN_COLORS } from './kit';
import { type ArenaShape, blockedAt, dist, inWater, type Vec } from './geometry';
import { enemyBodyRadius, rollGroupInterval, type Params } from './params';
import type { Rng } from './rng';
import { NO_COLOR, type Enemy, type EnemyKind, type World } from './world';


export interface SpawnMarker {
  id: number;
  x: number;
  y: number;
  kind: EnemyKind;
  color: number;
  hp: number;
  timeLeft: number;
  total: number;
  /** Stage 2, step 3: an extra enemy of the event modifier «злость» — never an elite. Absent otherwise. */
  plain?: true;
  /**
   * The package «Урон имеет значение» (armour on): this marker announces an elite — decided when it appears (`eliteRoll`),
   * it waits `eliteMarkerDelay` (the view draws it larger, with a lemon rim). Absent otherwise.
   */
  elite?: true;
  /** Task 38: the formation of a guard (`QueuedSpawn.formation`; the enemy keeps it in `vars.fm`). Absent otherwise. */
  formation?: number;
}

export interface QueuedSpawn {
  kind: EnemyKind;
  color: number;
  hp: number;
  /** Group center: members appear around it while it stays valid. */
  anchor: Vec | null;
  /** Stage 2, step 3: an extra enemy of the event modifier «злость» — never an elite. Absent otherwise. */
  plain?: true;
  /**
   * `spawnGroupHold` on: game seconds since this member, at the head of the queue, first found no free point at its anchor
   * (0 on that tick; up to `SPAWN_HOLD_LIMIT`). Absent while it has not waited — and always without the rule (worlds hash
   * as before).
   */
  held?: number;
  /**
   * Task 38 «Гарнизон»: the members of one formation (a newcomer of a kind the arena brings in a group, `NewcomerShare.group`:
   * the guards' line of 3 of one colour) share this number (a fresh id). Absent on every other newcomer (worlds hash as before).
   */
  formation?: number;
}

/** `spawnGroupHold` (design 12.10.2026): a member waits at its group's anchor this long (game seconds), then the group moves. */
export const SPAWN_HOLD_LIMIT = 1;

const ANCHOR_TRIES = 24;
const POINT_TRIES = 16;

const placeRng = (world: World): Rng => world.rng.stream('spawnPlace');
const rollRng = (world: World): Rng => world.rng.stream('spawnRoll');

// ---- Phase A, Т5: big arenas (constants of the spawn, not panel params: params go into the hash) ----

/** The camera's view at 1280×720 (units; docs/realtime-stage3.md, section 11): an arena not bigger spawns as before. */
export const VIEW_W = 18.4;
export const VIEW_H = 10.3;
/** Spawn rectangle round the hero on a bigger arena (design 09.10.2026, phase A, answer 8): inside the view on every side. */
export const SPAWN_RECT_W = 16;
export const SPAWN_RECT_H = 9;
/** Area of the reference arena 16×10: the density floor and the arena limit grow as √(area ÷ this). */
export const AREA_REF = 160;
/**
 * Баланс: the cap of the area factor `s`. The design's 1.5 gave +22…+46% enemies in the view on 24×15 and 24×14; 1.1 keeps
 * them within −5…+7% of 16×10 at the same phases (the condition ±15%; the measure — docs/realtime-phase-a.md, section 6).
 */
export const AREA_SCALE_MAX = 1.1;
/** The cap of the scaled arena limit (design 09.10.2026: `min(90; 60·s)`). */
export const BIG_MAX_ENEMIES = 90;

/** A rectangle of the arena (units). */
export interface SpawnRect { x: number; y: number; w: number; h: number }

/** The arena is bigger than the camera's view: spawning follows the hero (Т5). */
export function isBigArena(arena: ArenaShape): boolean { return arena.width > VIEW_W || arena.height > VIEW_H; }

/** One axis of the spawn rectangle: centred on the hero, shifted inside the arena (as the camera's `clampAxis`). */
function rectAxis(c: number, size: number, arena: number): [start: number, size: number] {
  if (arena <= size) return [0, arena];
  return [Math.max(0, Math.min(arena - size, c - size / 2)), size];
}

/** Spawn rectangle `SPAWN_RECT_W × SPAWN_RECT_H` round `hero`, shifted inside the arena (the whole arena on a short side). */
export function spawnRect(arena: ArenaShape, hero: Vec): SpawnRect {
  const [x, w] = rectAxis(hero.x, SPAWN_RECT_W, arena.width), [y, h] = rectAxis(hero.y, SPAWN_RECT_H, arena.height);
  return { x, y, w, h };
}

/** The point lies in the rectangle (its edge included). */
export function inRect(p: Vec, r: SpawnRect, eps = 1e-9): boolean {
  return p.x >= r.x - eps && p.x <= r.x + r.w + eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps;
}

/** Area factor of the pressure: `s = A > 160 ? min(AREA_SCALE_MAX; √(A/160)) : 1` (design 09.10.2026). 16×10 — exactly 1. */
export function areaScale(arena: ArenaShape): number {
  const area = arena.width * arena.height;
  return area > AREA_REF ? Math.min(AREA_SCALE_MAX, Math.sqrt(area / AREA_REF)) : 1;
}

/** Density floor of a phase on this arena: `round(floor × s)`; s = 1 — the phase's own number, untouched. */
export function scaledFloor(floor: number, arena: ArenaShape): number {
  const s = areaScale(arena);
  return s === 1 ? floor : Math.round(floor * s);
}

/**
 * Task 18 «Испытание V»: the density floor with the run's factor `k` (`Kit.floorScale`) — one rounding, `round(floor × s × k)`.
 * `k` is taken in whole percent (1.15 → 115) so that the product is exact where it can be: 1.15 is not exact in binary, and
 * `50 × 1.15` gives 57.49999… (57), while `50 × 115 / 100` is 57.5 (58, ties up as `Math.round`). Absent — `scaledFloor` as before.
 */
export function floorWithScale(floor: number, arena: ArenaShape, k?: number): number {
  if (k === undefined) return scaledFloor(floor, arena);
  return Math.round(floor * areaScale(arena) * Math.round(k * 100) / 100);
}

/**
 * The arena limit: `min(90; round(maxEnemies × s))`, never below the panel value (a slider above 90 stays as set);
 * s = 1 — the panel value, untouched.
 */
export function enemyLimit(params: Params, arena: ArenaShape): number {
  const s = areaScale(arena);
  return s === 1 ? params.maxEnemies : Math.max(params.maxEnemies, Math.min(BIG_MAX_ENEMIES, Math.round(params.maxEnemies * s)));
}

/**
 * A point on the edge of the spawn rectangle (one draw of `spawnPlace`, as the old edge point): an edge that lies on the
 * arena's own edge is inset as before (the body stays inside), an inner edge is taken as it is.
 */
function rectEdgePoint(world: World, r: SpawnRect): Vec {
  const inset = enemyBodyRadius(world.params) + 0.05, W = world.arena.width, H = world.arena.height;
  const left = r.x <= 0 ? inset : r.x, right = r.x + r.w >= W ? W - inset : r.x + r.w;
  const top = r.y <= 0 ? inset : r.y, bottom = r.y + r.h >= H ? H - inset : r.y + r.h;
  let t = placeRng(world).next() * (2 * (r.w + r.h));
  if (t < r.w) return { x: r.x + t, y: top };
  t -= r.w;
  if (t < r.h) return { x: right, y: r.y + t };
  t -= r.h;
  if (t < r.w) return { x: r.x + r.w - t, y: bottom };
  t -= r.w;
  return { x: left, y: r.y + r.h - t };
}

function randomEdgePoint(world: World): Vec {
  if (isBigArena(world.arena)) return rectEdgePoint(world, spawnRect(world.arena, world.hero));
  const { width: w, height: h } = world.arena;
  const inset = enemyBodyRadius(world.params) + 0.05;
  let t = placeRng(world).next() * (2 * (w + h));
  if (t < w) return { x: t, y: inset };
  t -= w;
  if (t < h) return { x: w - inset, y: t };
  t -= h;
  if (t < w) return { x: w - t, y: h - inset };
  t -= w;
  return { x: inset, y: h - t };
}

function randomInsidePoint(world: World): Vec {
  const r = enemyBodyRadius(world.params);
  const rng = placeRng(world);
  if (isBigArena(world.arena)) {
    // Т5: inside the spawn rectangle (`findAnchor` keeps the body off the arena's own edges).
    const box = spawnRect(world.arena, world.hero);
    const x = box.x + rng.next() * box.w;
    return { x, y: box.y + rng.next() * box.h };
  }
  const x = r + rng.next() * (world.arena.width - 2 * r);
  return { x, y: r + rng.next() * (world.arena.height - 2 * r) };
}

/** A spawn point: free of walls and trees, not in the pond (passable since stage B, but markers stay on dry land), outside the hero's radius. */
function anchorValid(world: World, p: Vec): boolean {
  return !blockedAt(p, enemyBodyRadius(world.params) * 0.99, world.arena) && !inWater(p, world.arena) && dist(p, world.hero) >= world.params.spawnMinDistance;
}

/** Т5: a queued group's anchor serves only while it lies in the current spawn rectangle (the hero walked on: a new one). */
function anchorCurrent(world: World, p: Vec): boolean {
  return anchorValid(world, p) && (!isBigArena(world.arena) || inRect(p, spawnRect(world.arena, world.hero)));
}

/** A group's anchor (24 tries of `spawnPlace`); null — none found. Exported for the Node checks of Т5 (bigArenas.spec.ts). */
export function findAnchor(world: World): Vec | null {
  const inside = world.params.spawnPlace === 'edgesAndInside';
  for (let i = 0; i < ANCHOR_TRIES; i++) {
    const p = inside && placeRng(world).next() < 0.5 ? randomInsidePoint(world) : randomEdgePoint(world);
    const r = enemyBodyRadius(world.params);
    p.x = Math.max(r, Math.min(world.arena.width - r, p.x));
    p.y = Math.max(r, Math.min(world.arena.height - r, p.y));
    if (anchorValid(world, p)) return p;
  }
  return null;
}

/** A free point for one marker near the group anchor: not in an obstacle, outside the hero's radius, not on another marker. */
function pointNear(world: World, anchor: Vec): Vec | null {
  const r = enemyBodyRadius(world.params), spread = r * 2.6, rng = placeRng(world);
  for (let i = 0; i < POINT_TRIES; i++) {
    const a = rng.next() * Math.PI * 2, d = i === 0 ? 0 : Math.sqrt(rng.next()) * spread;
    const p = { x: anchor.x + dcos(a) * d, y: anchor.y + dsin(a) * d };
    if (!anchorValid(world, p)) continue;
    if (world.markers.some(m => dist(m, p) < r * 1.8)) continue;
    if (world.enemies.some(e => dist(e, p) < r * 1.5)) continue;
    return p;
  }
  return null;
}

/**
 * The top of the tough HP table (package «Урон имеет значение», docs/realtime-damage.md): the run's by its row
 * (`Kit.toughHp`: 5–8 — 3, 9+ — 4), else the panel's `toughHpMax`; journals without it — 2 (the 1 or 2 of before).
 */
export function toughHpMaxOf(world: World): number {
  const n = world.kit?.toughHp ?? world.params.toughHpMax ?? 2;
  return Number.isFinite(n) ? Math.max(2, Math.min(MAX_TOUGH_HP, Math.floor(n))) : 2;
}

/**
 * HP of a newcomer of the tough roll: 0 (weak), or 1…`toughHpMaxOf` uniform for a tough one. Two draws whatever the table —
 * tough or not, then its HP (at 2: below 0.5 — 1, else 2, the draws and numbers of before).
 */
function rollHp(world: World): number {
  const rng = rollRng(world);
  if (rng.next() >= world.pressure.phase.toughShare) return 0;
  const top = toughHpMaxOf(world);
  return 1 + Math.min(top - 1, Math.floor(rng.next() * top));
}

function rollSize(world: World, min: number, max: number): number {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return lo + Math.floor(rollRng(world).next() * (hi - lo + 1));
}

/** The full palette: every chain colour. */
const FULL_PALETTE: readonly number[] = Array.from({ length: COLOR_COUNT }, (_, i) => i);
/** Task 45 «Испытание VIII»: the four and the fifth chain colour (index 4). */
const FIFTH_PALETTE: readonly number[] = Array.from({ length: MAX_COLORS }, (_, i) => i);

/**
 * Loop research, step 1 (docs/realtime-loop-research.md, sections 4.2 and 4.5): the colours newcomers take, ascending — the
 * first N (the run's by its row, `Kit.colors`, else the sandbox's `colorCount`; journals without it — 4) and the colours of
 * the arena's own start enemies, as the turn-based palette (row palette + the authored colours, decision 30.09.2026): a
 * marked target of another colour still gets partners. The chameleon cycles in it too. N = 4 — all four, as before. Task 45
 * «Испытание VIII»: N = 5 — the five (`MAX_COLORS`; the sandbox's `colorCount` 5 too); a draw is one whatever the size.
 */
export function palette(world: World): readonly number[] {
  const raw = world.kit?.colors ?? world.params.colorCount ?? COLOR_COUNT;
  const n = Number.isFinite(raw) ? Math.min(MAX_COLORS, Math.max(MIN_COLORS, Math.floor(raw))) : COLOR_COUNT;
  if (n > COLOR_COUNT) return FIFTH_PALETTE;
  if (n === COLOR_COUNT) return FULL_PALETTE;
  const colors = new Set(FULL_PALETTE.slice(0, n));
  for (const s of world.arena.enemies) if (s.color >= 0 && s.color < COLOR_COUNT) colors.add(s.color);
  return [...colors].sort((a, b) => a - b);
}

/** The colour after `color` in the palette (the chameleon's turn); with all four — `(color + 1) % 4`, as before. */
export function nextPaletteColor(world: World, color: number): number {
  const p = palette(world);
  return p[(p.indexOf(color) + 1) % p.length];
}

/** A random chain colour of the palette (spawnRoll; one draw whatever its size — with all four the draws of before). */
function rollColor(world: World): number { const p = palette(world); return p[Math.floor(rollRng(world).next() * p.length)]; }

/** Task 55а: the enemies of the crowd — the things (the barrel, the wardrobe) are not in its density or its limit (no thing — every enemy). */
function crowdOf(world: World): number {
  let n = 0;
  for (const e of world.enemies) if (!enemyKind(e.kind).thing) n++;
  return n;
}

/** Boars on the arena, at markers and in the queue: the cap (the arena's `boarMax`, else the panel's) counts all of them. */
function boarCount(world: World): number {
  return world.enemies.filter(e => e.kind === 'boar').length + world.markers.filter(m => m.kind === 'boar').length + world.queue.filter(q => q.kind === 'boar').length;
}

/** Task 57а: bodies of these kinds on the arena, at markers and in the queue (the caps of the new shooters count them all). */
export function kindCount(world: World, kinds: readonly string[]): number {
  const of = (k: string): boolean => kinds.includes(k);
  return world.enemies.filter(e => of(e.kind)).length + world.markers.filter(m => of(m.kind)).length + world.queue.filter(q => of(q.kind)).length;
}

/**
 * A newcomer outside a pack: the arena template's own kinds by their shares (stage 1 of the transition: new kinds join
 * without a change here), then a boar by its share (under the cap), otherwise a basic enemy.
 */
function rollSingle(world: World, color: number, anchor: Vec | null): QueuedSpawn {
  const p = world.params;
  for (const extra of world.arena.newcomers ?? []) {
    if (rollRng(world).next() >= extra.share) continue;
    // Task 57а: a kind at its cap brings none (the next kinds roll on); nothing for a kind without a cap.
    if (enemyKind(extra.kind).capped?.(world, kinds => kindCount(world, kinds))) continue;
    const hp = extra.hp ?? enemyKind(extra.kind).hp(p) ?? rollHp(world);
    return { kind: extra.kind, color, hp, anchor };
  }
  if (rollRng(world).next() < world.pressure.phase.boarShare && boarCount(world) < (world.arena.boarMax ?? p.boarMax)) return { kind: 'boar', color, hp: p.boarHp, anchor };
  return { kind: 'basic', color, hp: rollHp(world), anchor };
}

/** A group of newcomers: a wolf pack by the share of packs, otherwise 2–4 basic enemies (boars by their share). */
function rollGroup(world: World, forceSingle = false): void {
  const p = world.params;
  const pack = !forceSingle && rollRng(world).next() < world.pressure.phase.wolfShare;
  const size = forceSingle ? 1 : pack ? rollSize(world, p.wolfPackMin, p.wolfPackMax) : rollSize(world, p.groupMin, p.groupMax);
  const monoColor = rollColor(world);
  const anchor = forceSingle ? null : findAnchor(world);
  for (let i = 0; i < size; i++) {
    // Waiting enemies are capped by the arena limit: an endless stand would otherwise grow the queue forever.
    if (world.queue.length >= enemyLimit(p, world.arena)) break;
    const sameColor = pack ? p.wolfPackMono || p.groupColor === 'mono' : p.groupColor === 'mono';
    const color = sameColor ? monoColor : rollColor(world);
    const q: QueuedSpawn = pack ? { kind: 'wolf', color, hp: rollHp(world), anchor } : rollSingle(world, color, anchor);
    world.queue.push(q);
    // Task 38: a newcomer of a kind that comes in a formation (the guards' line) brings the rest of it — its places in the group.
    if (!pack) i += pushFormation(world, q);
  }
}

/**
 * Task 38 «Гарнизон» (`NewcomerShare.group`): a newcomer of a formation kind — `q` and `group − 1` copies of it (the same kind,
 * colour, HP and anchor) share a fresh formation number; the members added (0 for every other kind: no draw, no change).
 */
function pushFormation(world: World, q: QueuedSpawn): number {
  const size = world.arena.newcomers?.find(entry => entry.kind === q.kind)?.group ?? 1;
  if (size < 2) return 0;
  q.formation = world.nextId++;
  for (let k = 1; k < size; k++) world.queue.push({ ...q });
  return size - 1;
}

/**
 * `spawnGroupHold`: the group of `q` (every queued member sharing its anchor object) moves to a new anchor (`findAnchor`),
 * their waits restart. A single (no anchor) moves alone. None found — nothing changes (the group keeps its anchor and
 * tries again next tick); false.
 */
function moveGroup(world: World, q: QueuedSpawn): boolean {
  const stale = q.anchor, fresh = findAnchor(world);
  if (!fresh) return false;
  if (stale) for (const r of world.queue) if (r !== q && r.anchor === stale) { r.anchor = fresh; delete r.held; }
  q.anchor = fresh;
  delete q.held;
  return true;
}

/**
 * `spawnGroupHold` (design 12.10.2026): a free point for the head of the queue, or null (it waits; the queue waits behind it).
 * - An anchor gone stale (or none) — at once a new anchor for the whole remaining group, on every arena.
 * - No free point at a current anchor — the member keeps the anchor and tries again next tick (every try draws
 *   `spawnPlace` as `pointNear` does); after `SPAWN_HOLD_LIMIT` game seconds of waiting the whole group takes a new anchor.
 * - `findAnchor` finds none — the group keeps its anchor and tries again next tick (no stall beyond the arena having no
 *   anchor at all, as before the rule).
 */
function heldPoint(world: World, q: QueuedSpawn, dt: number): Vec | null {
  if ((!q.anchor || !anchorCurrent(world, q.anchor)) && !moveGroup(world, q)) return null;
  const p = pointNear(world, q.anchor!);
  if (p) { delete q.held; return p; }
  // The wait counts from the first failed try (0 then): the group moves on the try 1 s of game time after it.
  const held = q.held === undefined ? 0 : q.held + dt;
  q.held = held;
  // 1e-9: sixty ticks of 1/60 add up to a hair under 1.
  if (held < SPAWN_HOLD_LIMIT - 1e-9) return null;
  return moveGroup(world, q) ? pointNear(world, q.anchor!) : null;
}

function placeQueued(world: World, dt: number): void {
  const max = enemyLimit(world.params, world.arena), delay = world.params.markerDelay;
  const hold = world.params.spawnGroupHold === true;
  while (world.queue.length && crowdOf(world) + world.markers.length < max) {
    const q = world.queue[0];
    if (hold) {
      const p = heldPoint(world, q, dt);
      if (!p) return;
      world.queue.shift();
      pushMarker(world, q, p, delay);
      continue;
    }
    if (!q.anchor || !anchorCurrent(world, q.anchor)) {
      const stale = q.anchor, fresh = findAnchor(world);
      // Т5 (review 09.10.2026): on a big arena the group keeps together — its members still in the queue share the new
      // anchor (a pack would otherwise come as singles all over the rectangle). 16×10 keeps the old path to the bit.
      if (stale && isBigArena(world.arena)) for (const r of world.queue) if (r !== q && r.anchor === stale) r.anchor = fresh;
      q.anchor = fresh;
    }
    const p = q.anchor ? pointNear(world, q.anchor) : null;
    if (!p) { q.anchor = null; return; }
    world.queue.shift();
    pushMarker(world, q, p, delay);
  }
}

/** The marker of a queued newcomer at `p`. */
function pushMarker(world: World, q: QueuedSpawn, p: Vec, delay: number): void {
  // The package (armour on): the elite is decided as the marker appears, so the marker can show it (a longer wait). The
  // `elite` stream draws in another order than without armour (at the marker, not at the step-out) — only with armour.
  const elite = !q.plain && !!world.params.eliteArmor && eliteRoll(world, q.kind);
  const wait = elite ? Math.max(delay, world.params.eliteMarkerDelay ?? delay) : delay;
  world.markers.push({ id: world.nextId++, kind: q.kind, x: p.x, y: p.y, color: q.color, hp: q.hp, timeLeft: wait, total: wait, ...q.plain ? { plain: true as const } : {}, ...elite ? { elite: true as const } : {}, ...q.formation !== undefined ? { formation: q.formation } : {} });
}

/** The hero stands near a marker: the marker moves and its countdown restarts. */
function relocateMarker(world: World, m: SpawnMarker): void {
  const anchor = findAnchor(world);
  const p = anchor ? pointNear(world, anchor) : null;
  if (p) { m.x = p.x; m.y = p.y; }
  m.timeLeft = m.total;
}

/** «Метка у героя» (`Params.markerSeek`): the scan's step (units) — a bound on the points it tries, not a rule of the game. */
export const SEEK_STEP = 0.5;
/**
 * `Params.markerSeek`: the marker `m` the hero came near — the random search first (as `relocateMarker`, the same draws); nothing
 * found — the free point nearest to the marker by the scan (`seekPoint`); either way a whole warning at the new place. No free point
 * anywhere — the marker waits where it is, its timer held (the caller skips its countdown this tick).
 */
function seekMarker(world: World, m: SpawnMarker): void {
  const anchor = findAnchor(world);
  const p = (anchor ? pointNear(world, anchor) : null) ?? seekPoint(world, m);
  if (!p) return;
  m.x = p.x; m.y = p.y;
  m.timeLeft = m.total;
}

/**
 * The scan of `Params.markerSeek`: the points of a `SEEK_STEP` grid over the arena (Т5: over the spawn rectangle of a big arena),
 * kept off its edges by a body's radius, that a marker may take (`anchorValid` — no wall, tree or water, off the hero's ring; not on
 * another marker; not on an enemy) — the one nearest to `from` (the first in the grid's order of equals). No draw of any stream.
 */
function seekPoint(world: World, from: Vec): Vec | null {
  const r = enemyBodyRadius(world.params), a = world.arena;
  const box = isBigArena(a) ? spawnRect(a, world.hero) : { x: 0, y: 0, w: a.width, h: a.height };
  const x0 = Math.max(r, box.x), x1 = Math.min(a.width - r, box.x + box.w), y0 = Math.max(r, box.y), y1 = Math.min(a.height - r, box.y + box.h);
  let best: Vec | null = null, bestD = Infinity;
  for (let y = y0; y <= y1 + 1e-9; y += SEEK_STEP) {
    for (let x = x0; x <= x1 + 1e-9; x += SEEK_STEP) {
      const p = { x, y }, d = dist(p, from);
      if (d >= bestD || !anchorValid(world, p)) continue;
      if (world.markers.some(o => o !== from && dist(o, p) < r * 1.8)) continue;
      if (world.enemies.some(e => dist(e, p) < r * 1.5)) continue;
      best = p; bestD = d;
    }
  }
  return best;
}

/**
 * Density floor of the phase: when the arena thins out, the gap is queued at once (singles or a wolf pack, any color).
 * Т5: the floor and the limit grow with the arena's area (`scaledFloor`, `enemyLimit`; 16×10 — as before).
 */
/**
 * Task 43: the yard crowd's factor of the full Castellan's fight (`Params.castellanCrowd`); task 48: the crowd's factor of the Troll's
 * fight (`Params.trollCrowd`); else (and without the key) 1.
 */
function crowdFactorOf(world: World): number {
  if (world.arena.troll) return world.params.trollCrowd ?? 1;
  // Task 54: the Chief's crowd (`Params.chiefCrowd`; read on his arena only).
  if (world.arena.chief) return world.params.chiefCrowd ?? 1;
  return world.arena.castellanFull ? world.params.castellanCrowd ?? 1 : 1;
}

function topUpToFloor(world: World): void {
  // Task 18 «Испытание V»: the run's factor of the floor (`Kit.floorScale`; absent — the floor as before), under the arena limit.
  // Task 43: the full Castellan's yard crowd (`Params.castellanCrowd`; 1 — no factor, the path of before).
  const crowd = crowdFactorOf(world), k = crowd === 1 ? world.kit?.floorScale : (world.kit?.floorScale ?? 1) * crowd;
  const floor = Math.min(floorWithScale(world.pressure.phase.floor, world.arena, k), enemyLimit(world.params, world.arena));
  const present = (): number => world.enemies.filter(e => e.kind !== 'reaper' && !enemyKind(e.kind).thing).length + world.markers.length + world.queue.length;
  for (let guard = 0; guard < 200 && present() < floor; guard++) {
    const before = world.queue.length;
    rollGroup(world, rollRng(world).next() >= world.pressure.phase.wolfShare);
    if (world.queue.length === before) break;
  }
}

export function updateSpawning(world: World, dt: number): void {
  world.groupTimer -= dt;
  const kit = world.kit;
  while (world.groupTimer <= 0) {
    // Stage 2, step 3 (event modifier «подкрепление раньше»): before the goals the groups come EVENT_PACE_FACTOR times as often.
    const pace = kit?.earlyPace && world.stage === 'goals' ? 1 / EVENT_PACE_FACTOR : 1;
    // Task 43: the full Castellan's crowd tops up slower by its factor (the interval ÷ it).
    const crowd = crowdFactorOf(world);
    world.groupTimer += rollGroupInterval(world.pressure.phase, rollRng(world)) * pace / crowd;
    rollGroup(world);
    // Stage 2, step 3 (event modifier «злость»): the first wave brings EVENT_EXTRA_ENEMIES more — singles of the arena's
    // own composition (its kinds by their shares, `rollSingle`), never elites; the spawn streams decide them.
    if (kit?.extraStart) {
      kit.extraStart = false;
      for (let i = 0; i < EVENT_EXTRA_ENEMIES; i++) world.queue.push({ ...rollSingle(world, rollColor(world), null), plain: true });
    }
  }
  topUpToFloor(world);
  placeQueued(world, dt);
  for (let i = world.markers.length - 1; i >= 0; i--) {
    const m = world.markers[i];
    if (dist(m, world.hero) < world.params.spawnMinDistance) {
      // «Метка у героя»: with `markerSeek` the marker finds a place or waits with its timer held (the old path: the whole warning again).
      if (world.params.markerSeek) seekMarker(world, m); else relocateMarker(world, m);
      continue;
    }
    m.timeLeft -= dt;
    if (m.timeLeft > 0) continue;
    world.markers.splice(i, 1);
    const e = spawnEnemy(world, m, m.color, m.hp, m.kind);
    // Task 38: a guard of a formation keeps its number (enemies/garrison.ts reads it).
    if (m.formation !== undefined) e.vars.fm = m.formation;
    // Stage 2, step 3: a newcomer may be a random elite (a run from its row 3, or the sandbox toggle) — not an extra
    // enemy of «злость». The package (armour on): its marker already decided it.
    if (world.params.eliteArmor) { if (m.elite) { makeElite(world, e, true); world.events.push({ type: 'elite', enemyId: e.id }); } }
    else if (!m.plain) rollRandomElite(world, e);
  }
}

/** The time limit: one marker for the reaper, outside the arena limit and the queue. */
export function spawnReaper(world: World): void {
  world.reaperSpawned = true;
  const anchor = findAnchor(world) ?? randomEdgePoint(world);
  const delay = world.params.markerDelay;
  world.markers.push({ id: world.nextId++, kind: 'reaper', x: anchor.x, y: anchor.y, color: NO_COLOR, hp: 0, timeLeft: delay, total: delay });
}

/** A new enemy of a registered kind at a point; its behaviour's `onSpawn` runs (the boar's first-charge delay). */
export function spawnEnemy(world: World, at: Vec, color: number, hp: number, kind: EnemyKind = 'basic'): Enemy {
  const def = enemyKind(kind);
  const id = world.nextId++, spread = def.spread ? world.params.speedSpread : 0;
  const enemy: Enemy = {
    id, kind, x: at.x, y: at.y, color, hp, marked: false, speedFactor: 1 + (world.rng.stream('speed').next() * 2 - 1) * spread,
    brake: 0, age: 0, strikeFlash: 0, hurtFlash: 0, knock: 0, knockVx: 0, knockVy: 0,
    boar: 'walk', boarTimer: 0, dirX: 0, dirY: 0, charged: 0, headX: 0, headY: 0, vars: {},
  };
  world.enemies.push(enemy);
  behaviorOf(enemy).onSpawn?.(world, enemy);
  world.stats.spawned++;
  world.events.push({ type: 'spawn', enemyId: id });
  return enemy;
}

/** Debug: drop up to `count` enemies on free edge points immediately, skipping markers (limit still applies). */
export function spawnBurst(world: World, count: number): void {
  const room = Math.max(0, enemyLimit(world.params, world.arena) - crowdOf(world) - world.markers.length);
  for (let i = 0; i < Math.min(count, room); i++) {
    const anchor = findAnchor(world);
    const p = anchor ? pointNear(world, anchor) : null;
    if (!p) continue;
    const q = rollSingle(world, rollColor(world), null);
    spawnEnemy(world, p, q.color, q.hp, q.kind);
  }
}
