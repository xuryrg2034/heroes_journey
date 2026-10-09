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
import { rollRandomElite } from './elites';
import { EVENT_EXTRA_ENEMIES, EVENT_PACE_FACTOR } from './kit';
import { type ArenaShape, blockedAt, dist, inWater, type Vec } from './geometry';
import { enemyBodyRadius, rollGroupInterval, type Params } from './params';
import type { Rng } from './rng';
import { NO_COLOR, type Enemy, type EnemyKind, type World } from './world';

/** Four chain colors, as in the trail palette of the map. */
export const COLOR_COUNT = 4;

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
}

export interface QueuedSpawn {
  kind: EnemyKind;
  color: number;
  hp: number;
  /** Group center: members appear around it while it stays valid. */
  anchor: Vec | null;
  /** Stage 2, step 3: an extra enemy of the event modifier «злость» — never an elite. Absent otherwise. */
  plain?: true;
}

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

function rollHp(world: World): number {
  const rng = rollRng(world);
  if (rng.next() >= world.pressure.phase.toughShare) return 0;
  return rng.next() < 0.5 ? 1 : 2;
}

function rollSize(world: World, min: number, max: number): number {
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return lo + Math.floor(rollRng(world).next() * (hi - lo + 1));
}

/** A random chain colour (spawnRoll). */
function rollColor(world: World): number { return Math.floor(rollRng(world).next() * COLOR_COUNT); }

/** Boars on the arena, at markers and in the queue: the cap `boarMax` counts all of them. */
function boarCount(world: World): number {
  return world.enemies.filter(e => e.kind === 'boar').length + world.markers.filter(m => m.kind === 'boar').length + world.queue.filter(q => q.kind === 'boar').length;
}

/**
 * A newcomer outside a pack: the arena template's own kinds by their shares (stage 1 of the transition: new kinds join
 * without a change here), then a boar by its share (under the cap), otherwise a basic enemy.
 */
function rollSingle(world: World, color: number, anchor: Vec | null): QueuedSpawn {
  const p = world.params;
  for (const extra of world.arena.newcomers ?? []) {
    if (rollRng(world).next() >= extra.share) continue;
    const hp = extra.hp ?? enemyKind(extra.kind).hp(p) ?? rollHp(world);
    return { kind: extra.kind, color, hp, anchor };
  }
  if (rollRng(world).next() < world.pressure.phase.boarShare && boarCount(world) < p.boarMax) return { kind: 'boar', color, hp: p.boarHp, anchor };
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
    world.queue.push(pack ? { kind: 'wolf', color, hp: rollHp(world), anchor } : rollSingle(world, color, anchor));
  }
}

function placeQueued(world: World): void {
  const max = enemyLimit(world.params, world.arena), delay = world.params.markerDelay;
  while (world.queue.length && world.enemies.length + world.markers.length < max) {
    const q = world.queue[0];
    if (!q.anchor || !anchorCurrent(world, q.anchor)) q.anchor = findAnchor(world);
    const p = q.anchor ? pointNear(world, q.anchor) : null;
    if (!p) { q.anchor = null; return; }
    world.queue.shift();
    world.markers.push({ id: world.nextId++, kind: q.kind, x: p.x, y: p.y, color: q.color, hp: q.hp, timeLeft: delay, total: delay, ...q.plain ? { plain: true as const } : {} });
  }
}

/** The hero stands near a marker: the marker moves and its countdown restarts. */
function relocateMarker(world: World, m: SpawnMarker): void {
  const anchor = findAnchor(world);
  const p = anchor ? pointNear(world, anchor) : null;
  if (p) { m.x = p.x; m.y = p.y; }
  m.timeLeft = m.total;
}

/**
 * Density floor of the phase: when the arena thins out, the gap is queued at once (singles or a wolf pack, any color).
 * Т5: the floor and the limit grow with the arena's area (`scaledFloor`, `enemyLimit`; 16×10 — as before).
 */
function topUpToFloor(world: World): void {
  const floor = Math.min(scaledFloor(world.pressure.phase.floor, world.arena), enemyLimit(world.params, world.arena));
  const present = (): number => world.enemies.filter(e => e.kind !== 'reaper').length + world.markers.length + world.queue.length;
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
    world.groupTimer += rollGroupInterval(world.pressure.phase, rollRng(world)) * pace;
    rollGroup(world);
    // Stage 2, step 3 (event modifier «злость»): the first wave brings EVENT_EXTRA_ENEMIES more — singles of the arena's
    // own composition (its kinds by their shares, `rollSingle`), never elites; the spawn streams decide them.
    if (kit?.extraStart) {
      kit.extraStart = false;
      for (let i = 0; i < EVENT_EXTRA_ENEMIES; i++) world.queue.push({ ...rollSingle(world, rollColor(world), null), plain: true });
    }
  }
  topUpToFloor(world);
  placeQueued(world);
  for (let i = world.markers.length - 1; i >= 0; i--) {
    const m = world.markers[i];
    if (dist(m, world.hero) < world.params.spawnMinDistance) { relocateMarker(world, m); continue; }
    m.timeLeft -= dt;
    if (m.timeLeft > 0) continue;
    world.markers.splice(i, 1);
    const e = spawnEnemy(world, m, m.color, m.hp, m.kind);
    // Stage 2, step 3: a newcomer may be a random elite (a run from its row 3, or the sandbox toggle) — not an extra
    // enemy of «злость».
    if (!m.plain) rollRandomElite(world, e);
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
  const room = Math.max(0, enemyLimit(world.params, world.arena) - world.enemies.length - world.markers.length);
  for (let i = 0; i < Math.min(count, room); i++) {
    const anchor = findAnchor(world);
    const p = anchor ? pointNear(world, anchor) : null;
    if (!p) continue;
    const q = rollSingle(world, rollColor(world), null);
    spawnEnemy(world, p, q.color, q.hp, q.kind);
  }
}
