/**
 * World state and simulation step of the real-time prototype.
 * Not deterministic on purpose (prototype): randomness comes from Math.random.
 * Stage 2 adds the chain/focus state machine on top of `update` (timeScale, dash),
 * stage 3 adds enemy kinds (boar, wolf) through `EnemyKind`.
 */
import { type ArenaLayout, FlowField, dist, lineOfSight, pushOutOfObstacles } from './arena';
import { type Params, type Pressure, heroRadius, invulnerabilityFor, pressureAt } from './params';
import { spawnReaper, updateSpawning, type QueuedSpawn, type SpawnMarker } from './spawn';

/** `reaper`: the time limit (design answer 25) — fast, cannot be killed, colorless. */
export type EnemyKind = 'basic' | 'reaper';
/** Color of enemies outside the chain palette (the reaper). */
export const NO_COLOR = -1;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  color: number;
  hp: number;
  /** Fast newcomer (phase table share; stage 3 turns them into wolves). */
  fast: boolean;
  /** Personal speed multiplier (spread around 1). */
  speedFactor: number;
  /** Game seconds left of the slowdown after striking the hero. */
  brake: number;
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
  /** Real seconds left of the hurt flash (render). */
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
  /** Enemies of rolled groups waiting for room under the arena limit. */
  queue: QueuedSpawn[];
  /** Game time in seconds (stage 2: runs slower in focus). */
  time: number;
  /** Game seconds until the next group. */
  groupTimer: number;
  nextId: number;
  status: 'playing' | 'defeat';
  /** Multiplier on simulation speed; stage 2 sets it from focus. */
  timeScale: number;
  pressure: Pressure;
  flow: FlowField;
  events: WorldEvent[];
  stats: { hitsTaken: number; spawned: number; kills: number };
  reaperSpawned: boolean;
  /**
   * Arena stage: `goals` — base pace; `greed` — goals done, the door is open (stages 2–3),
   * the phase table and the reaper run. Stage 1 has no goals: the panel button switches it.
   */
  stage: 'goals' | 'greed';
  /** Game time when the goals were completed (null before). */
  greedStart: number | null;
}

export function createWorld(arena: ArenaLayout, params: Params): World {
  return {
    arena,
    params,
    hero: { x: arena.heroStart.x, y: arena.heroStart.y, hp: params.heroHp, maxHp: params.heroHp, invulnerable: 0, hurtFlash: 0 },
    enemies: [],
    markers: [],
    queue: [],
    time: 0,
    groupTimer: 0,
    nextId: 1,
    status: 'playing',
    timeScale: 1,
    pressure: pressureAt(params, 0),
    flow: new FlowField(arena, params.bodyRadius),
    events: [],
    stats: { hitsTaken: 0, spawned: 0, kills: 0 },
    reaperSpawned: false,
    stage: 'goals',
    greedStart: null,
  };
}

/**
 * Distance at which an enemy touches the hero: hero circle plus the reduced body circle.
 * The hero is a static circle: enemies stop exactly here and never push it.
 */
export function touchDistance(params: Params): number {
  return heroRadius(params) + params.bodyRadius * params.touchFactor;
}

/** Current speed multiplier of an enemy: personal spread and the slowdown after a strike. */
export function enemySpeedFactor(e: Enemy, params: Params): number {
  const braking = params.brakeRecovery > 0 ? Math.max(0, e.brake) / params.brakeRecovery : 0;
  return e.speedFactor * (1 - params.brakeStrength * braking);
}

/** Speed of an enemy right now, in units per game second. */
export function enemySpeed(world: World, e: Enemy): number {
  const p = world.params;
  const base = e.kind === 'reaper' ? p.reaperSpeed : e.fast ? p.fastSpeed : world.pressure.enemySpeed;
  return base * enemySpeedFactor(e, p);
}

const SEPARATION_PASSES = 4;
const CONTACT_SLACK = 0.03;

function moveEnemies(world: World, dt: number): void {
  const { hero, params, arena, flow } = world;
  const r = params.bodyRadius, stop = touchDistance(params);
  for (const e of world.enemies) {
    const d = dist(e, hero);
    if (d <= stop + 0.01) continue;
    let tx = hero.x, ty = hero.y;
    // Default (Brotato): straight at the hero, obstacles simply block. The toggle restores detours.
    if (params.pathfinding && !lineOfSight(e, hero, arena, r * 0.9)) {
      const wp = flow.nextWaypoint(e);
      if (wp) { tx = wp.x; ty = wp.y; }
    }
    const dx = tx - e.x, dy = ty - e.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const step = Math.min(enemySpeed(world, e) * dt, Math.max(0, d - stop));
    e.x += dx / len * step; e.y += dy / len * step;
  }
}

/** Bodies push each other apart; the hero and obstacles are solid and applied last. */
function separate(world: World): void {
  const { enemies, hero, params, arena } = world;
  const r = params.bodyRadius, min = r * 2, heroMin = touchDistance(params);
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { const ang = Math.random() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; }
        else { dx /= d; dy /= d; }
        const push = (min - d) / 2;
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
    e.brake = Math.max(0, e.brake - dt);
    e.strikeFlash = Math.max(0, e.strikeFlash - dt);
    e.age += dt;
  }
  if (world.status !== 'playing' || hero.invulnerable > 0) return;
  // Invulnerability alone limits the damage rate: one hit, then a grace window for the whole crowd.
  const striker = world.enemies.find(e => dist(e, hero) <= reach);
  if (!striker) return;
  const damage = params.contactDamage;
  hero.hp = Math.max(0, hero.hp - damage);
  hero.invulnerable = invulnerabilityFor(params, params.invulnerabilityMode, damage, hero.maxHp);
  hero.hurtFlash = Math.max(params.hitFlash, 0.01);
  striker.brake = params.brakeRecovery;
  striker.strikeFlash = 0.18;
  world.stats.hitsTaken++;
  world.events.push({ type: 'hit', enemyId: striker.id, damage, x: hero.x, y: hero.y });
  if (hero.hp <= 0) {
    world.status = 'defeat';
    world.events.push({ type: 'defeat' });
  }
}

/** Goals of the arena are done: the greed stage starts (phase table, reaper). Stages 2–3 call it from real goals. */
export function completeGoals(world: World): void {
  if (world.stage === 'greed') return;
  world.stage = 'greed';
  world.greedStart = world.time;
  world.groupTimer = 0;
}

/** One simulation step of real seconds `realDt` (scaled by timeScale: invulnerability and slowdown run on game time). */
export function update(world: World, realDt: number): void {
  if (world.status !== 'playing') return;
  const dt = realDt * world.timeScale;
  world.time += dt;
  world.pressure = pressureAt(world.params, world.time, world.greedStart);
  const hero = world.hero;
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.hurtFlash = Math.max(0, hero.hurtFlash - realDt);
  if (Math.abs(world.flow.radius - world.params.bodyRadius) > 1e-9) world.flow = new FlowField(world.arena, world.params.bodyRadius);
  if (world.params.pathfinding) world.flow.setTarget(hero);
  if (world.params.reaperEnabled && world.greedStart !== null && !world.reaperSpawned && world.time - world.greedStart >= world.params.reaperTime) spawnReaper(world);
  updateSpawning(world, dt);
  moveEnemies(world, dt);
  separate(world);
  contactDamage(world, dt);
}

