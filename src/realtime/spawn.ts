/**
 * Horde arrival (Brotato-style): groups of 2–4 every 3–5 s, each enemy announced by a
 * marker; the enemy steps out after the marker delay. Under the arena limit the
 * rest waits in a queue. Pace and composition come from `pressureAt`.
 */
import { blockedAt, dist, type Vec } from './arena';
import { rollGroupInterval } from './params';
import { NO_COLOR, type EnemyKind, type World } from './world';

/** Four chain colors, as in the trail palette of the map. */
export const COLOR_COUNT = 4;

export interface SpawnMarker {
  id: number;
  x: number;
  y: number;
  kind: EnemyKind;
  color: number;
  hp: number;
  fast: boolean;
  timeLeft: number;
  total: number;
}

export interface QueuedSpawn {
  color: number;
  hp: number;
  fast: boolean;
  /** Group center: members appear around it while it stays valid. */
  anchor: Vec | null;
}

const ANCHOR_TRIES = 24;
const POINT_TRIES = 16;

function randomEdgePoint(world: World): Vec {
  const { width: w, height: h } = world.arena;
  const inset = world.params.bodyRadius + 0.05;
  let t = Math.random() * (2 * (w + h));
  if (t < w) return { x: t, y: inset };
  t -= w;
  if (t < h) return { x: w - inset, y: t };
  t -= h;
  if (t < w) return { x: w - t, y: h - inset };
  t -= w;
  return { x: inset, y: h - t };
}

function randomInsidePoint(world: World): Vec {
  const r = world.params.bodyRadius;
  return { x: r + Math.random() * (world.arena.width - 2 * r), y: r + Math.random() * (world.arena.height - 2 * r) };
}

function anchorValid(world: World, p: Vec): boolean {
  return !blockedAt(p, world.params.bodyRadius * 0.99, world.arena) && dist(p, world.hero) >= world.params.spawnMinDistance;
}

function findAnchor(world: World): Vec | null {
  const inside = world.params.spawnPlace === 'edgesAndInside';
  for (let i = 0; i < ANCHOR_TRIES; i++) {
    const p = inside && Math.random() < 0.5 ? randomInsidePoint(world) : randomEdgePoint(world);
    const r = world.params.bodyRadius;
    p.x = Math.max(r, Math.min(world.arena.width - r, p.x));
    p.y = Math.max(r, Math.min(world.arena.height - r, p.y));
    if (anchorValid(world, p)) return p;
  }
  return null;
}

/** A free point for one marker near the group anchor: not in an obstacle, outside the hero's radius, not on another marker. */
function pointNear(world: World, anchor: Vec): Vec | null {
  const r = world.params.bodyRadius, spread = r * 2.6;
  for (let i = 0; i < POINT_TRIES; i++) {
    const a = Math.random() * Math.PI * 2, d = i === 0 ? 0 : Math.sqrt(Math.random()) * spread;
    const p = { x: anchor.x + Math.cos(a) * d, y: anchor.y + Math.sin(a) * d };
    if (!anchorValid(world, p)) continue;
    if (world.markers.some(m => dist(m, p) < r * 1.8)) continue;
    if (world.enemies.some(e => dist(e, p) < r * 1.5)) continue;
    return p;
  }
  return null;
}

function rollHp(world: World): number {
  if (Math.random() >= world.pressure.phase.toughShare) return 0;
  return Math.random() < 0.5 ? 1 : 2;
}

function rollFast(world: World): boolean { return Math.random() < world.pressure.phase.fastShare; }

function rollGroup(world: World): void {
  const p = world.params;
  const lo = Math.min(p.groupMin, p.groupMax), hi = Math.max(p.groupMin, p.groupMax);
  const size = lo + Math.floor(Math.random() * (hi - lo + 1));
  const monoColor = Math.floor(Math.random() * COLOR_COUNT);
  const anchor = findAnchor(world);
  for (let i = 0; i < size; i++) {
    // Waiting enemies are capped by the arena limit: an endless stand would otherwise grow the queue forever.
    if (world.queue.length >= p.maxEnemies) break;
    const color = p.groupColor === 'mono' ? monoColor : Math.floor(Math.random() * COLOR_COUNT);
    world.queue.push({ color, hp: rollHp(world), fast: rollFast(world), anchor });
  }
}

function placeQueued(world: World): void {
  const max = world.params.maxEnemies, delay = world.params.markerDelay;
  while (world.queue.length && world.enemies.length + world.markers.length < max) {
    const q = world.queue[0];
    if (!q.anchor || !anchorValid(world, q.anchor)) q.anchor = findAnchor(world);
    const p = q.anchor ? pointNear(world, q.anchor) : null;
    if (!p) { q.anchor = null; return; }
    world.queue.shift();
    world.markers.push({ id: world.nextId++, kind: 'basic', x: p.x, y: p.y, color: q.color, hp: q.hp, fast: q.fast, timeLeft: delay, total: delay });
  }
}

/** The hero stands near a marker: the marker moves and its countdown restarts. */
function relocateMarker(world: World, m: SpawnMarker): void {
  const anchor = findAnchor(world);
  const p = anchor ? pointNear(world, anchor) : null;
  if (p) { m.x = p.x; m.y = p.y; }
  m.timeLeft = m.total;
}

/** Density floor of the phase: when the arena thins out, the gap is queued at once (singles, any color). */
function topUpToFloor(world: World): void {
  const floor = Math.min(world.pressure.phase.floor, world.params.maxEnemies);
  let present = world.enemies.filter(e => e.kind !== 'reaper').length + world.markers.length + world.queue.length;
  while (present < floor) {
    world.queue.push({ color: Math.floor(Math.random() * COLOR_COUNT), hp: rollHp(world), fast: rollFast(world), anchor: null });
    present++;
  }
}

export function updateSpawning(world: World, dt: number): void {
  world.groupTimer -= dt;
  while (world.groupTimer <= 0) {
    world.groupTimer += rollGroupInterval(world.pressure.phase);
    rollGroup(world);
  }
  topUpToFloor(world);
  placeQueued(world);
  for (let i = world.markers.length - 1; i >= 0; i--) {
    const m = world.markers[i];
    if (dist(m, world.hero) < world.params.spawnMinDistance) { relocateMarker(world, m); continue; }
    m.timeLeft -= dt;
    if (m.timeLeft > 0) continue;
    world.markers.splice(i, 1);
    spawnEnemy(world, m, m.color, m.hp, m.fast, m.kind);
  }
}

/** The time limit: one marker for the reaper, outside the arena limit and the queue. */
export function spawnReaper(world: World): void {
  world.reaperSpawned = true;
  const anchor = findAnchor(world) ?? randomEdgePoint(world);
  const delay = world.params.markerDelay;
  world.markers.push({ id: world.nextId++, kind: 'reaper', x: anchor.x, y: anchor.y, color: NO_COLOR, hp: 0, fast: false, timeLeft: delay, total: delay });
}

export function spawnEnemy(world: World, at: Vec, color: number, hp: number, fast: boolean, kind: EnemyKind = 'basic'): void {
  const id = world.nextId++, spread = kind === 'reaper' ? 0 : world.params.speedSpread;
  world.enemies.push({ id, kind, x: at.x, y: at.y, color, hp, fast, speedFactor: 1 + (Math.random() * 2 - 1) * spread, brake: 0, age: 0, strikeFlash: 0 });
  world.stats.spawned++;
  world.events.push({ type: 'spawn', enemyId: id });
}

/** Debug: drop up to `count` enemies on free edge points immediately, skipping markers (limit still applies). */
export function spawnBurst(world: World, count: number): void {
  const room = Math.max(0, world.params.maxEnemies - world.enemies.length - world.markers.length);
  for (let i = 0; i < Math.min(count, room); i++) {
    const anchor = findAnchor(world);
    const p = anchor ? pointNear(world, anchor) : null;
    if (p) spawnEnemy(world, p, Math.floor(Math.random() * COLOR_COUNT), rollHp(world), rollFast(world));
  }
}
