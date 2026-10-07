/**
 * World state and simulation step of the real-time prototype.
 * Not deterministic on purpose (prototype): randomness comes from Math.random.
 * The chain, focus and the hero's dash live in chain.ts (`stepHero` runs before `update`
 * on every substep). Stage 3: wolves (pack damage), the boar (announced charge with mass),
 * arena objects (buttons, the door), arena goals and the victory.
 */
import { type ArenaLayout, FlowField, blockedAt, dist, lineOfSight, pushOutOfObstacles } from './arena';
import { type Params, type Pressure, heroRadius, invulnerabilityFor, pressureAt } from './params';
import { spawnEnemy, spawnReaper, updateSpawning, type QueuedSpawn, type SpawnMarker } from './spawn';

/**
 * `wolf`: fast, hits harder next to other wolves (pack); `boar`: announces a charge along a line,
 * then runs with extra mass; `reaper`: the time limit (design answer 25) — fast, cannot be killed, colorless.
 */
export type EnemyKind = 'basic' | 'wolf' | 'boar' | 'reaper';
/** Boar cycle: walk -> windup (lane, «!») -> charge -> rest -> walk (with a cooldown). */
export type BoarState = 'walk' | 'windup' | 'charge' | 'rest';
/** Color of enemies outside the chain palette (the reaper). */
export const NO_COLOR = -1;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  color: number;
  hp: number;
  /** Target of the third arena: killing every marked enemy completes the goals. */
  marked: boolean;
  /** Personal speed multiplier (spread around 1). */
  speedFactor: number;
  /** Game seconds left of the slowdown after striking the hero. */
  brake: number;
  /** Seconds since appearance (render pop-in). */
  age: number;
  /** Seconds left of the strike animation. */
  strikeFlash: number;
  /** Real seconds left of the white flash after a chain hit (render). */
  hurtFlash: number;
  /** Game seconds left of the knockback after surviving a chain hit (toggle, design answer 26). */
  knock: number;
  knockVx: number;
  knockVy: number;
  /** Boar only: state, game seconds left in it (walk: charge cooldown), charge direction and distance run. */
  boar: BoarState;
  boarTimer: number;
  dirX: number;
  dirY: number;
  charged: number;
}

/** Button or door: a chain link of any color that gives no power and takes no damage (design answer 5). */
export interface ArenaObject {
  id: number;
  kind: 'button' | 'door';
  x: number;
  y: number;
  /** Button: pressed once and for all. */
  pressed: boolean;
}

/** A chain link: an enemy, or an arena object (it can only be the last link). */
export type ChainLink = { kind: 'enemy'; id: number } | { kind: 'object'; id: number };

/** A hero move without contact damage: the dash along the chain or a jump. */
export interface HeroMove {
  kind: 'dash' | 'jump';
  /** Chain links still to strike (dash) — struck in order on arrival. */
  links: ChainLink[];
  /** Power carried to the next link: +1 per enemy, HP spend it (docs/chain-budget.md). */
  power: number;
  /** Where the hero stops: the last killed link, or the start when nothing died yet. */
  stop: { x: number; y: number };
  /** Fixed point to reach (jump, or the way back after striking a survivor). */
  point: { x: number; y: number } | null;
  speed: number;
}

export interface Hero {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  invulnerable: number;
  /** Real seconds left of the hurt flash (render). */
  hurtFlash: number;
  /** Knockback from a boar charge: velocity and game seconds left. */
  knockVx: number;
  knockVy: number;
  knock: number;
}

export type HitSource = 'touch' | 'wolf' | 'boar' | 'reaper';

export type WorldEvent =
  | { type: 'hit'; enemyId: number; damage: number; x: number; y: number; source: HitSource }
  | { type: 'boarCharge'; enemyId: number }
  | { type: 'button'; objectId: number }
  | { type: 'goals' }
  | { type: 'victory' }
  | { type: 'spawn'; enemyId: number }
  | { type: 'chainHit'; enemyId: number; damage: number; killed: boolean; x: number; y: number }
  | { type: 'kill'; enemyId: number; x: number; y: number; color: number }
  | { type: 'jump' }
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
  status: 'playing' | 'defeat' | 'victory';
  /** Buttons and the door of the arena. */
  objects: ArenaObject[];
  /** Multiplier on simulation speed; stage 2 sets it from focus. */
  timeScale: number;
  pressure: Pressure;
  flow: FlowField;
  events: WorldEvent[];
  stats: { hitsTaken: number; spawned: number; kills: number; markedKills: number; boarHits: number; damageTaken: number };
  reaperSpawned: boolean;
  /**
   * Arena stage: `goals` — base pace; `greed` — goals done, the door is open (stages 2–3),
   * the phase table and the reaper run. Stage 1 has no goals: the panel button switches it.
   */
  stage: 'goals' | 'greed';
  /** Game time when the goals were completed (null before). */
  greedStart: number | null;
  /** Game time of the victory or the defeat (null while playing). */
  endTime: number | null;
  /** Links selected so far; non-empty while the player draws a chain (focus runs). */
  chain: ChainLink[];
  /** Dash along the released chain or a jump; contact damage is off meanwhile. */
  move: HeroMove | null;
  /** Real seconds of focus left (design answer 14). */
  focus: number;
  /** True while focus slows the world (a chain is drawn and focus is left). */
  focusing: boolean;
  /** Energy for the jump: +energyPerKill per attacked enemy, up to ENERGY_MAX. */
  energy: number;
}

export function createWorld(arena: ArenaLayout, params: Params): World {
  let nextId = 1;
  const objects: ArenaObject[] = [
    ...arena.buttons.map(b => ({ id: nextId++, kind: 'button' as const, x: b.x, y: b.y, pressed: false })),
    { id: nextId++, kind: 'door', x: arena.door.x, y: arena.door.y, pressed: false },
  ];
  const world: World = {
    arena,
    params,
    hero: { x: arena.heroStart.x, y: arena.heroStart.y, hp: params.heroHp, maxHp: params.heroHp, invulnerable: 0, hurtFlash: 0, knockVx: 0, knockVy: 0, knock: 0 },
    enemies: [],
    markers: [],
    queue: [],
    time: 0,
    groupTimer: 0,
    nextId,
    status: 'playing',
    objects,
    timeScale: 1,
    pressure: pressureAt(params, 0),
    flow: new FlowField(arena, params.bodyRadius),
    events: [],
    stats: { hitsTaken: 0, spawned: 0, kills: 0, markedKills: 0, boarHits: 0, damageTaken: 0 },
    reaperSpawned: false,
    stage: 'goals',
    greedStart: null,
    endTime: null,
    chain: [],
    move: null,
    focus: params.focusMax,
    focusing: false,
    energy: 0,
  };
  // Marked enemies of the third arena stand at their posts from the start (no markers).
  for (const m of arena.marked) {
    const e = spawnEnemy(world, m, m.color, m.hp, 'basic');
    e.marked = true;
    pushOutOfObstacles(e, params.bodyRadius, arena);
  }
  world.stats.spawned = 0;
  world.events.length = 0;
  return world;
}

export function findObject(world: World, id: number): ArenaObject | undefined {
  return world.objects.find(o => o.id === id);
}

export function doorOf(world: World): ArenaObject {
  return world.objects.find(o => o.kind === 'door')!;
}

/** The door opens with the goals (greed stage). */
export function doorOpen(world: World): boolean { return world.stage === 'greed'; }

/** Goal progress for the HUD and the goal check: done / total. */
export function goalProgress(world: World): { done: number; total: number; label: string } {
  const goal = world.arena.goal;
  if (goal === 'buttons') {
    const buttons = world.objects.filter(o => o.kind === 'button');
    return { done: buttons.filter(b => b.pressed).length, total: buttons.length, label: 'кнопки' };
  }
  if (goal === 'marked') return { done: world.stats.markedKills, total: world.arena.marked.length, label: 'отмеченные' };
  return { done: Math.min(world.stats.kills, world.params.killGoal), total: world.params.killGoal, label: 'убито' };
}

/** Called after a chain kill or a button press: the arena goals complete the stage. */
export function checkGoals(world: World): void {
  if (world.stage !== 'goals') return;
  const { done, total } = goalProgress(world);
  if (done >= total) completeGoals(world);
}

/** Entering the open door: the arena is won. */
export function win(world: World): void {
  if (world.status !== 'playing') return;
  world.status = 'victory';
  world.endTime = world.time;
  world.chain = [];
  world.events.push({ type: 'victory' });
}

/** Wolves within the pack radius of `wolf` (not counting itself). */
export function packmates(world: World, wolf: Enemy): number {
  let count = 0;
  const r = world.params.wolfPackRadius;
  for (const e of world.enemies) if (e !== wolf && e.kind === 'wolf' && dist(e, wolf) <= r) count++;
  return count;
}

/** Contact damage of one enemy now: the reaper, a wolf with its pack bonus, or the base touch. */
export function touchDamage(world: World, e: Enemy): number {
  const p = world.params;
  if (e.kind === 'reaper') return p.reaperDamage;
  if (e.kind === 'wolf') return p.contactDamage + p.wolfPackBonus * packmates(world, e);
  return p.contactDamage;
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
  const base = e.kind === 'reaper' ? p.reaperSpeed : e.kind === 'wolf' ? p.wolfSpeed : world.pressure.enemySpeed;
  return base * enemySpeedFactor(e, p) * (e.marked ? p.markedSpeed : 1);
}

const SEPARATION_PASSES = 4;
const CONTACT_SLACK = 0.03;
/** Game seconds over which the boar's knockback moves the hero. */
const HERO_KNOCK_TIME = 0.15;

/** The charging boar is heavier: it shoves the crowd (design answer 21). */
function massOf(e: Enemy, params: Params): number {
  return e.kind === 'boar' && e.boar === 'charge' ? params.boarMass : 1;
}

function canBeHurt(world: World): boolean {
  if (world.status !== 'playing' || world.hero.invulnerable > 0 || world.move) return false;
  return !(world.params.focusNoDamage && world.focusing);
}

/** Applies damage to the hero: invulnerability, flash, stats, defeat. */
function hurtHero(world: World, striker: Enemy, damage: number, source: HitSource): void {
  const { hero, params } = world;
  if (damage <= 0) return;
  hero.hp = Math.max(0, hero.hp - damage);
  hero.invulnerable = invulnerabilityFor(params, params.invulnerabilityMode, damage, hero.maxHp);
  hero.hurtFlash = Math.max(params.hitFlash, 0.01);
  world.stats.hitsTaken++;
  world.stats.damageTaken += damage;
  world.events.push({ type: 'hit', enemyId: striker.id, damage, x: hero.x, y: hero.y, source });
  if (hero.hp <= 0) {
    world.status = 'defeat';
    world.endTime = world.time;
    world.events.push({ type: 'defeat' });
  }
}

/** The charge reached the hero: damage 2 and a knockback of 1.5 along the charge (design answer 7); the boar stops. */
function boarHitsHero(world: World, boar: Enemy): void {
  const { hero, params } = world;
  boar.boar = 'rest'; boar.boarTimer = params.boarRest;
  world.stats.boarHits++;
  if (params.boarKnockback > 0) {
    hero.knock = HERO_KNOCK_TIME;
    hero.knockVx = boar.dirX * params.boarKnockback / HERO_KNOCK_TIME;
    hero.knockVy = boar.dirY * params.boarKnockback / HERO_KNOCK_TIME;
  }
  if (canBeHurt(world)) { hurtHero(world, boar, params.boarDamage, 'boar'); boar.strikeFlash = 0.18; }
}

/**
 * Boar cycle on game time (slowed in focus like everything else). Returns true when the boar
 * moved by itself this step (windup, charge, rest) — otherwise it walks like a basic enemy.
 */
function stepBoar(world: World, e: Enemy, dt: number): boolean {
  const { hero, params, arena } = world;
  if (e.boar === 'walk') {
    e.boarTimer = Math.max(0, e.boarTimer - dt);
    const d = dist(e, hero);
    if (e.boarTimer > 0 || d > params.boarTrigger || d < 1e-6 || world.status !== 'playing') return false;
    if (!lineOfSight(e, hero, arena, params.bodyRadius * 0.5)) return false;
    e.boar = 'windup'; e.boarTimer = params.boarWindup;
    e.dirX = (hero.x - e.x) / d; e.dirY = (hero.y - e.y) / d;
    world.events.push({ type: 'boarCharge', enemyId: e.id });
    return true;
  }
  if (e.boar === 'windup') {
    e.boarTimer -= dt;
    if (e.boarTimer <= 0) { e.boar = 'charge'; e.charged = 0; }
    return true;
  }
  if (e.boar === 'rest') {
    e.boarTimer -= dt;
    if (e.boarTimer <= 0) { e.boar = 'walk'; e.boarTimer = params.boarCooldown; }
    return true;
  }
  // Charge: straight along the announced line for boarRange units; walls and trees stop it.
  const step = Math.min(params.boarChargeSpeed * dt, Math.max(0, params.boarRange - e.charged));
  const next = { x: e.x + e.dirX * step, y: e.y + e.dirY * step };
  if (blockedAt(next, params.bodyRadius * 0.95, arena)) { e.boar = 'rest'; e.boarTimer = params.boarRest; return true; }
  e.x = next.x; e.y = next.y; e.charged += step;
  // During the hero's dash or jump the charge passes by (the hero cannot be hit then).
  if (!world.move && dist(e, hero) <= touchDistance(params) + CONTACT_SLACK + step) { boarHitsHero(world, e); return true; }
  if (e.charged >= params.boarRange - 1e-6) { e.boar = 'rest'; e.boarTimer = params.boarRest; }
  return true;
}

function moveEnemies(world: World, dt: number): void {
  const { hero, params, arena, flow } = world;
  const r = params.bodyRadius, stop = touchDistance(params);
  for (const e of world.enemies) {
    if (e.kind === 'boar' && stepBoar(world, e, dt)) continue;
    if (e.knock > 0) {
      const t = Math.min(dt, e.knock);
      e.x += e.knockVx * t; e.y += e.knockVy * t; e.knock -= t;
      continue;
    }
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
        // Overlap split by mass: the charging boar barely yields, the crowd gets shoved aside.
        const ma = massOf(a, params), mb = massOf(b, params), overlap = min - d;
        const pa = overlap * mb / (ma + mb), pb = overlap * ma / (ma + mb);
        a.x -= dx * pa; a.y -= dy * pa; b.x += dx * pb; b.y += dy * pb;
      }
    }
    for (const e of enemies) {
      const dx = e.x - hero.x, dy = e.y - hero.y, d = Math.hypot(dx, dy);
      // While dashing or jumping the hero passes through bodies (design answer 4).
      if (d < heroMin && !world.move) {
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
  if (!canBeHurt(world)) return;
  // Invulnerability alone limits the damage rate: one hit, then a grace window for the whole crowd.
  // The strongest touching enemy counts: the reaper (design answer 30) or a wolf with its pack.
  // A charging boar is not a touch: its hit is the charge (stepBoar).
  let striker: Enemy | null = null, damage = 0;
  for (const e of world.enemies) {
    if (dist(e, hero) > reach || (e.kind === 'boar' && e.boar === 'charge')) continue;
    const dmg = touchDamage(world, e);
    if (!striker || dmg > damage) { striker = e; damage = dmg; }
  }
  if (!striker || damage <= 0) return;
  striker.brake = params.brakeRecovery;
  striker.strikeFlash = 0.18;
  hurtHero(world, striker, damage, striker.kind === 'reaper' ? 'reaper' : striker.kind === 'wolf' ? 'wolf' : 'touch');
}

/** The boar's knockback slides the hero (game time), stopped by obstacles; a dash or jump cancels it. */
function stepHeroKnock(world: World, dt: number): void {
  const hero = world.hero;
  if (hero.knock <= 0) return;
  if (world.move) { hero.knock = 0; return; }
  const t = Math.min(dt, hero.knock);
  hero.x += hero.knockVx * t; hero.y += hero.knockVy * t; hero.knock -= t;
  pushOutOfObstacles(hero, heroRadius(world.params), world.arena);
}

/** Goals of the arena are done: the greed stage starts (phase table, reaper). Stage 2: the kill goal (chain.ts); stage 3: arena goals. */
export function completeGoals(world: World): void {
  if (world.stage === 'greed') return;
  world.stage = 'greed';
  world.greedStart = world.time;
  world.groupTimer = 0;
  world.events.push({ type: 'goals' });
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
  for (const e of world.enemies) e.hurtFlash = Math.max(0, e.hurtFlash - realDt);
  if (Math.abs(world.flow.radius - world.params.bodyRadius) > 1e-9) world.flow = new FlowField(world.arena, world.params.bodyRadius);
  if (world.params.pathfinding) world.flow.setTarget(hero);
  if (world.params.reaperEnabled && world.greedStart !== null && !world.reaperSpawned && world.time - world.greedStart >= world.params.reaperTime) spawnReaper(world);
  updateSpawning(world, dt);
  stepHeroKnock(world, dt);
  moveEnemies(world, dt);
  separate(world);
  contactDamage(world, dt);
}

