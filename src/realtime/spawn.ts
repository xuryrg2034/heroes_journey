/**
 * Horde arrival: a marker appears on the arena edge, the enemy steps out after the
 * marker delay (Brotato-style warning). Pace and composition come from `pressureAt`.
 */
import { blockedAt, dist, type Vec } from './arena';
import type { World } from './world';

/** Four chain colors, as in the trail palette of the map. */
export const COLOR_COUNT = 4;

export interface SpawnMarker {
  id: number;
  x: number;
  y: number;
  color: number;
  hp: number;
  timeLeft: number;
  total: number;
}

const PLACE_TRIES = 24;

function randomEdgePoint(world: World): Vec {
  const { width: w, height: h } = world.arena;
  const inset = world.params.enemyRadius + 0.05;
  let t = Math.random() * (2 * (w + h));
  if (t < w) return { x: t, y: inset };
  t -= w;
  if (t < h) return { x: w - inset, y: t };
  t -= h;
  if (t < w) return { x: w - t, y: h - inset };
  t -= w;
  return { x: inset, y: h - t };
}

function findSpawnPoint(world: World): Vec | null {
  const r = world.params.enemyRadius;
  for (let i = 0; i < PLACE_TRIES; i++) {
    const p = randomEdgePoint(world);
    p.x = Math.max(r, Math.min(world.arena.width - r, p.x));
    p.y = Math.max(r, Math.min(world.arena.height - r, p.y));
    if (blockedAt(p, r * 0.99, world.arena)) continue;
    if (dist(p, world.hero) < world.params.spawnMinDistance) continue;
    if (world.markers.some(m => dist(m, p) < r * 2)) continue;
    return p;
  }
  return null;
}

function rollHp(world: World): number {
  if (Math.random() >= world.pressure.toughShare) return 0;
  return Math.random() < 0.5 ? 1 : 2;
}

function placeMarker(world: World): void {
  const p = findSpawnPoint(world);
  if (!p) return;
  const delay = world.params.markerDelay;
  world.markers.push({ id: world.nextId++, x: p.x, y: p.y, color: Math.floor(Math.random() * COLOR_COUNT), hp: rollHp(world), timeLeft: delay, total: delay });
}

export function updateSpawning(world: World, dt: number): void {
  const params = world.params;
  world.spawnTimer -= dt;
  while (world.spawnTimer <= 0) {
    world.spawnTimer += world.pressure.spawnInterval;
    if (world.enemies.length + world.markers.length < params.maxEnemies) placeMarker(world);
  }
  for (let i = world.markers.length - 1; i >= 0; i--) {
    const m = world.markers[i];
    m.timeLeft -= dt;
    if (m.timeLeft > 0) continue;
    world.markers.splice(i, 1);
    // The hero may have moved onto the marker (stage 2): the enemy comes out elsewhere.
    if (dist(m, world.hero) < params.spawnMinDistance) { placeMarker(world); continue; }
    spawnEnemy(world, m, m.color, m.hp);
  }
}

export function spawnEnemy(world: World, at: Vec, color: number, hp: number): void {
  const id = world.nextId++;
  world.enemies.push({ id, kind: 'basic', x: at.x, y: at.y, color, hp, cooldown: 0, age: 0, strikeFlash: 0 });
  world.stats.spawned++;
  world.events.push({ type: 'spawn', enemyId: id });
}

/** Debug: drop up to `count` enemies on free edge points immediately, skipping the marker delay (limit still applies). */
export function spawnBurst(world: World, count: number): void {
  const room = Math.max(0, world.params.maxEnemies - world.enemies.length - world.markers.length);
  for (let i = 0; i < Math.min(count, room); i++) {
    const p = findSpawnPoint(world);
    if (p) spawnEnemy(world, p, Math.floor(Math.random() * COLOR_COUNT), rollHp(world));
  }
}
