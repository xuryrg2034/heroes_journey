/**
 * World state and simulation step of the real-time prototype.
 * Not deterministic on purpose (prototype): randomness comes from Math.random.
 * Stage 2 adds the chain/focus state machine on top of `update` (timeScale, dash),
 * stage 3 adds enemy kinds (boar, wolf) through `EnemyKind`.
 */
import { type ArenaLayout, FlowField, dist, lineOfSight, pushOutOfObstacles } from './arena';
import { type Params, type Pressure, pressureAt } from './params';
import { updateSpawning, type SpawnMarker } from './spawn';

export type EnemyKind = 'basic';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  color: number;
  hp: number;
  /** Seconds until this enemy can strike again. */
  cooldown: number;
  /** Seconds since appearance (render pop-in). */
  age: number;
  /** Seconds left of the strike animation. */
  strikeFlash: number;
}

export interface Hero {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  invulnerable: number;
  hurtFlash: number;
}

export type WorldEvent =
  | { type: 'hit'; enemyId: number; damage: number; x: number; y: number }
  | { type: 'spawn'; enemyId: number }
  | { type: 'defeat' };

export interface World {
  arena: ArenaLayout;
  params: Params;
  hero: Hero;
  enemies: Enemy[];
  markers: SpawnMarker[];
  /** Game time in seconds (stage 2: runs slower in focus). */
  time: number;
  spawnTimer: number;
  nextId: number;
  status: 'playing' | 'defeat';
  /** Multiplier on simulation speed; stage 2 sets it from focus. */
  timeScale: number;
  pressure: Pressure;
  flow: FlowField;
  events: WorldEvent[];
  stats: { hitsTaken: number; spawned: number; kills: number };
}

export function createWorld(arena: ArenaLayout, params: Params): World {
  return {
    arena,
    params,
    hero: { x: arena.heroStart.x, y: arena.heroStart.y, hp: params.heroHp, maxHp: params.heroHp, invulnerable: 0, hurtFlash: 0 },
    enemies: [],
    markers: [],
    time: 0,
    spawnTimer: 0,
    nextId: 1,
    status: 'playing',
    timeScale: 1,
    pressure: pressureAt(params, 0),
    flow: new FlowField(arena, params.enemyRadius),
    events: [],
    stats: { hitsTaken: 0, spawned: 0, kills: 0 },
  };
}

/** Distance at which an enemy touches the hero: hero circle plus the reduced enemy circle. */
export function touchDistance(params: Params): number {
  return params.heroRadius + params.enemyRadius * params.touchFactor;
}

const SEPARATION_PASSES = 4;
const CONTACT_SLACK = 0.03;

function moveEnemies(world: World, dt: number): void {
  const { hero, params, arena, flow } = world;
  const r = params.enemyRadius, speed = world.pressure.enemySpeed;
  const stop = touchDistance(params);
  for (const e of world.enemies) {
    const d = dist(e, hero);
    if (d <= stop + 0.01) continue;
    let tx = hero.x, ty = hero.y;
    if (!lineOfSight(e, hero, arena, r * 0.9)) {
      const wp = flow.nextWaypoint(e);
      if (wp) { tx = wp.x; ty = wp.y; }
    }
    const dx = tx - e.x, dy = ty - e.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const step = Math.min(speed * dt, Math.max(0, d - stop));
    e.x += dx / len * step; e.y += dy / len * step;
  }
}

/** Circles push each other apart; hero and obstacles are solid and applied last. */
function separate(world: World): void {
  const { enemies, hero, params, arena } = world;
  const r = params.enemyRadius, min = r * 2, heroMin = touchDistance(params);
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
        else { dx /= d; dy /= d; }
        const push = (min - Math.min(d, min)) / 2;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      }
    }
    for (const e of enemies) {
      const dx = e.x - hero.x, dy = e.y - hero.y, d = Math.hypot(dx, dy);
      if (d < heroMin) {
        if (d < 1e-6) { e.x = hero.x + heroMin; }
        else { e.x = hero.x + dx / d * heroMin; e.y = hero.y + dy / d * heroMin; }
      }
      pushOutOfObstacles(e, r, arena);
    }
  }
}

function contactDamage(world: World, dt: number): void {
  const { hero, params } = world;
  const reach = touchDistance(params) + CONTACT_SLACK;
  for (const e of world.enemies) {
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.strikeFlash = Math.max(0, e.strikeFlash - dt);
    e.age += dt;
    if (world.status !== 'playing') continue;
    if (e.cooldown > 0 || hero.invulnerable > 0) continue;
    if (dist(e, hero) > reach) continue;
    const damage = params.contactDamage;
    hero.hp = Math.max(0, hero.hp - damage);
    hero.invulnerable = params.invulnerability;
    hero.hurtFlash = 0.25;
    e.cooldown = world.pressure.enemyCooldown;
    e.strikeFlash = 0.18;
    world.stats.hitsTaken++;
    world.events.push({ type: 'hit', enemyId: e.id, damage, x: hero.x, y: hero.y });
    if (hero.hp <= 0) {
      world.status = 'defeat';
      world.events.push({ type: 'defeat' });
    }
  }
}

/** One simulation step of real seconds `realDt` (scaled by timeScale). */
export function update(world: World, realDt: number): void {
  if (world.status !== 'playing') return;
  const dt = realDt * world.timeScale;
  world.time += dt;
  world.pressure = pressureAt(world.params, world.time);
  const hero = world.hero;
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.hurtFlash = Math.max(0, hero.hurtFlash - realDt);
  if (Math.abs(world.flow.radius - world.params.enemyRadius) > 1e-9) world.flow = new FlowField(world.arena, world.params.enemyRadius);
  world.flow.setTarget(hero);
  updateSpawning(world, dt);
  moveEnemies(world, dt);
  separate(world);
  contactDamage(world, dt);
}
