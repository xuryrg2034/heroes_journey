/**
 * World state and simulation step of the real-time prototype.
 * Not deterministic on purpose (prototype): randomness comes from Math.random.
 * The chain, focus and the hero's dash live in chain.ts (`stepHero` runs before `update`
 * on every substep). Stage 3: wolves (pack damage), the boar (announced charge with mass),
 * arena objects (buttons, the door), arena goals and the victory. Iteration 2, stage A: the hero
 * walks (WASD / arrows → `world.input`), enemies follow the flow field around obstacles.
 */
import { type ArenaLayout, FlowField, type Vec, blockedAt, dist, inWater, lineOfSight, pushOutOfObstacles } from './arena';
import { type Params, type Pressure, enemyBodyRadius, heroRadius, invulnerabilityFor, pressureAt } from './params';
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
  /** Walking heading (unit vector, 0 before the first step): turns smoothly towards the flow field direction. */
  headX: number;
  headY: number;
}

/**
 * Button or door: a chain link of any color that gives no power and takes no damage (design answer 5),
 * always the last link. Crystal (iteration 2, stage C): a colour-change link of any color anywhere in
 * the chain — the next enemy sets the new color; no power, not a kill; breaking it gives score.
 * Not a body: enemies and the walking hero pass over it.
 */
export interface ArenaObject {
  id: number;
  kind: 'button' | 'door' | 'crystal';
  x: number;
  y: number;
  /** Button: pressed once and for all. */
  pressed: boolean;
  /** Crystal: kills of the chain that dropped it (its final length; score = crystalScorePerKill × value). */
  value?: number;
  /** Crystal: game time it fell (the lifetime slider). */
  born?: number;
}

/** A chain link: an enemy, or an arena object (a button or the door can only be the last link; a crystal anywhere). */
export type ChainLink = { kind: 'enemy'; id: number } | { kind: 'object'; id: number };

/** The last finished dash (render: combo counter, score popup; result screen). */
export interface ChainSummary { kills: number; hits: number; crystals: number; score: number; time: number }

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
  /** Stage C: kills and hits of this dash (combo counter, crystal drops), crystals it dropped and broke, crystal score so far. */
  kills: number;
  hits: number;
  dropped: number[];
  broken: number;
  crystalScore: number;
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
  | { type: 'chainHit'; enemyId: number; damage: number; killed: boolean; x: number; y: number; combo: number }
  | { type: 'crystal'; objectId: number; x: number; y: number }
  | { type: 'crystalBreak'; objectId: number; x: number; y: number; score: number; combo: number }
  | { type: 'finisher'; kills: number }
  | { type: 'chainEnd'; kills: number; score: number }
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
  /** Game seconds until the next flow field rebuild (`flowRate` per second). */
  flowTimer: number;
  /** Walking input of the hero: WASD / arrows (main.ts), components in −1…1. */
  input: Vec;
  /** Stage D: unit direction of the hero's walking step this substep (0, 0 when he does not walk); `separate` parts the crowd across it. */
  heroWalk: Vec;
  events: WorldEvent[];
  stats: { hitsTaken: number; spawned: number; kills: number; markedKills: number; boarHits: number; damageTaken: number; score: number; bestChain: number; crystals: number; finishers: number };
  /** Stage C: real seconds of hit-stop left (the whole simulation waits). */
  hitstop: number;
  /** Stage C: real seconds of the finisher slow-motion left. */
  slowmo: number;
  /** Stage C: the last finished dash. */
  lastChain: ChainSummary | null;
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
    flow: new FlowField(arena, enemyBodyRadius(params), { waterCost: 1 / Math.max(0.05, params.waterSlow) }),
    flowTimer: 0,
    input: { x: 0, y: 0 },
    heroWalk: { x: 0, y: 0 },
    events: [],
    stats: { hitsTaken: 0, spawned: 0, kills: 0, markedKills: 0, boarHits: 0, damageTaken: 0, score: 0, bestChain: 0, crystals: 0, finishers: 0 },
    hitstop: 0,
    slowmo: 0,
    lastChain: null,
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
    pushOutOfObstacles(e, enemyBodyRadius(params), arena);
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
 * Distance at which an enemy touches the hero: hero circle plus the reduced body circle
 * (the body scales with the enemy size, stage D). Enemies stop exactly here and never push the hero.
 */
export function touchDistance(params: Params): number {
  return heroRadius(params) + enemyBodyRadius(params) * params.touchFactor;
}

/**
 * Distance at which the walking hero stops at an enemy (toggle «сквозь врагов» off): hero circle
 * plus the full body circle (design answer 37). It exceeds the touch reach (`touchDistance` + contact
 * slack) while touchFactor < 1 − 0.03 ÷ body radius (≈ 0.92 at 0.4, ≈ 0.91 at 0.32 — the enemy
 * size 0.8 of stage D): brushing past a crowd does not hurt.
 */
export function heroBlockDistance(params: Params): number {
  return heroRadius(params) + enemyBodyRadius(params);
}

/** Walking speed multiplier at a point: `waterSlow` in the pond (stage B), 1 elsewhere. */
export function waterFactor(world: World, p: Vec): number {
  return inWater(p, world.arena) ? world.params.waterSlow : 1;
}

/**
 * Stage D (user 07.10.2026): the hero's circle overlaps the body circle of at least one enemy
 * (hero circle + enemy body > distance) AHEAD of him — in the half-plane of his walk (design
 * 07.10.2026: one catching up from behind or the side does not slow him, or there is no getting away;
 * its touch still hurts). Only with «сквозь врагов» on: with it off the hero stops on the body
 * circle (stage B) and the old walking stays as it was. Standing still — not slowed.
 */
export function heroInCrowd(world: World): boolean {
  const { hero, params, heroWalk } = world;
  if (!params.heroThroughEnemies || (heroWalk.x === 0 && heroWalk.y === 0)) return false;
  const reach = heroRadius(params) + enemyBodyRadius(params);
  return world.enemies.some(e => dist(e, hero) < reach && (e.x - hero.x) * heroWalk.x + (e.y - hero.y) * heroWalk.y > 0);
}

/** Walking multiplier of the crowd: `crowdSlow` while the hero is in it, 1 elsewhere. Stacks with water only. */
export function crowdFactor(world: World): number {
  return heroInCrowd(world) ? world.params.crowdSlow : 1;
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
    if (!lineOfSight(e, hero, arena, enemyBodyRadius(params) * 0.5)) return false;
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
  // Water slows walking only: the charge keeps its speed in the pond (design answer 41).
  const step = Math.min(params.boarChargeSpeed * dt, Math.max(0, params.boarRange - e.charged));
  const next = { x: e.x + e.dirX * step, y: e.y + e.dirY * step };
  if (blockedAt(next, enemyBodyRadius(params) * 0.95, arena)) { e.boar = 'rest'; e.boarTimer = params.boarRest; return true; }
  e.x = next.x; e.y = next.y; e.charged += step;
  // During the hero's dash or jump the charge passes by (the hero cannot be hit then).
  if (!world.move && dist(e, hero) <= touchDistance(params) + CONTACT_SLACK + step) { boarHitsHero(world, e); return true; }
  if (e.charged >= params.boarRange - 1e-6) { e.boar = 'rest'; e.boarTimer = params.boarRest; }
  return true;
}

function moveEnemies(world: World, dt: number): void {
  const { hero, params, arena, flow } = world;
  const r = enemyBodyRadius(params), stop = touchDistance(params);
  for (const e of world.enemies) {
    if (e.kind === 'boar' && stepBoar(world, e, dt)) continue;
    if (e.knock > 0) {
      const t = Math.min(dt, e.knock);
      e.x += e.knockVx * t; e.y += e.knockVy * t; e.knock -= t;
      continue;
    }
    const d = dist(e, hero);
    if (d <= stop + 0.01) continue;
    // Straight at the hero when in sight; otherwise (toggle «поиск пути») along the flow field.
    let dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d;
    if (params.pathfinding) {
      // Water counts here: whether to wade across or walk around is the field's call (water cost).
      if (!lineOfSight(e, hero, arena, r * 0.9, true) && flow.direction(e, FLOW_DIR)) { dx = FLOW_DIR.x; dy = FLOW_DIR.y; }
      // Smooth turn towards the wanted direction: no zigzag between grid cells.
      if (e.headX || e.headY) {
        const k = Math.min(1, params.flowTurn * dt);
        const hx = e.headX + (dx - e.headX) * k, hy = e.headY + (dy - e.headY) * k, hl = Math.hypot(hx, hy);
        if (hl > 0.2) { dx = hx / hl; dy = hy / hl; }
      }
      e.headX = dx; e.headY = dy;
    }
    const step = Math.min(enemySpeed(world, e) * waterFactor(world, e) * dt, Math.max(0, d - stop));
    e.x += dx * step; e.y += dy * step;
  }
}

/** Scratch vector of the flow field direction (no allocation per enemy and step). */
const FLOW_DIR: Vec = { x: 0, y: 0 };

/**
 * The hero walks by `world.input` at `heroSpeed` (game time: slower in focus), solid against
 * obstacles; water slows him (`waterSlow`, stage B). Enemies are solid too (toggle «сквозь врагов»
 * off): the hero stops on the enemy's body circle (`heroBlockDistance`, design answer 37), which is
 * wider than the touch zone, so he can brush past a crowd without being hit; the step loses its part
 * that goes into an enemy, so the hero slides along the crowd, and a ring of enemies holds him in
 * place — the way out is a chain or a jump. Kills come only from the chain.
 * Toggle on (the default since stage D): the hero walks through the crowd — `separate` parts the bodies
 * in front of him to the sides — at `crowdSlow` (×0.7) while his circle overlaps an enemy body; touch still hurts.
 * Ignored during the dash, the jump and the boar's knockback.
 */
function stepHeroWalk(world: World, dt: number): void {
  const { hero, params, input } = world;
  world.heroWalk.x = 0; world.heroWalk.y = 0;
  if (world.status !== 'playing' || world.move || hero.knock > 0) return;
  const len = Math.hypot(input.x, input.y);
  if (len < 1e-6 || params.heroSpeed <= 0) return;
  world.heroWalk.x = input.x / len; world.heroWalk.y = input.y / len;
  // Water × crowd (stage D): the only walking multipliers; focus slows the game time itself, not the walk.
  const k = params.heroSpeed * waterFactor(world, hero) * crowdFactor(world) * dt / Math.max(1, len);
  let mx = input.x * k, my = input.y * k;
  if (!params.heroThroughEnemies) {
    const min = heroBlockDistance(params);
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const e of world.enemies) {
        const ex = hero.x - e.x, ey = hero.y - e.y, d = Math.hypot(ex, ey);
        if (d > min + 0.05 || d < 1e-6) continue;
        const nx = ex / d, ny = ey / d, into = -(mx * nx + my * ny);
        // Only the part of the step that goes into the enemy (and would end inside its body circle).
        if (into <= 0 || Math.hypot(hero.x + mx - e.x, hero.y + my - e.y) >= min) continue;
        mx += nx * into; my += ny * into; changed = true;
      }
      if (!changed) break;
    }
    // Squeezed between several enemies: no step gets out without entering one — stand.
    for (const e of world.enemies) {
      const before = dist(hero, e), after = Math.hypot(hero.x + mx - e.x, hero.y + my - e.y);
      if (after < min - 1e-3 && after < before - 1e-6) { mx = 0; my = 0; break; }
    }
  }
  hero.x += mx; hero.y += my;
  pushOutOfObstacles(hero, heroRadius(params), world.arena);
}

/**
 * Bodies push each other apart; the hero and obstacles are solid and applied last.
 * Stage D: a body in front of the hero walking through the crowd is pushed across his way (to the side
 * it already leans to), not along it: radial pushing bulldozed an enemy standing on his line ahead of him.
 */
function separate(world: World): void {
  const { enemies, hero, params, arena } = world;
  const r = enemyBodyRadius(params), min = r * 2, heroMin = touchDistance(params);
  const wx = world.heroWalk.x, wy = world.heroWalk.y, parting = params.heroThroughEnemies && (wx !== 0 || wy !== 0);
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
      const ahead = dx * wx + dy * wy;
      if (d < heroMin && !world.move && parting && ahead > 0) {
        // Across the way: keep the distance along it, move sideways onto the touch circle.
        const side = dx * -wy + dy * wx, sign = Math.abs(side) > 1e-6 ? Math.sign(side) : (e.id % 2 ? 1 : -1);
        const across = Math.sqrt(Math.max(0, heroMin * heroMin - ahead * ahead));
        e.x = hero.x + wx * ahead - wy * sign * across; e.y = hero.y + wy * ahead + wx * sign * across;
      } else if (d < heroMin && !world.move) {
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

/**
 * Flow field towards the hero, rebuilt `flowRate` times per game second (and at once when the body
 * radius slider changes). Between rebuilds enemies follow the stale field; in sight of the hero they go straight.
 */
function updateFlow(world: World, dt: number): void {
  const p = world.params;
  const waterCost = 1 / Math.max(0.05, p.waterSlow);
  const body = enemyBodyRadius(p);
  if (Math.abs(world.flow.radius - body) > 1e-9 || world.flow.options.waterCost !== waterCost) {
    world.flow = new FlowField(world.arena, body, { waterCost });
    world.flowTimer = 0;
  }
  if (!p.pathfinding) return;
  world.flowTimer -= dt;
  if (world.flowTimer > 0 && world.flow.builds > 0) return;
  world.flowTimer = 1 / Math.max(0.1, p.flowRate);
  const flow = world.flow;
  // Density penalty (toggle, design answer 39): cells with enemies cost more, so the crowd spreads to side ways.
  const density = p.flowDensity && p.flowDensityCost > 0;
  const hadExtra = flow.extra.some(v => v !== 0);
  if (density || hadExtra) {
    flow.extra.fill(0);
    if (density) for (const e of world.enemies) flow.extra[flow.cellOf(e)] += p.flowDensityCost;
  }
  // With the penalty the crowd changes the field even while the hero stands in one cell (and once more when it is switched off).
  flow.setTarget(world.hero, density || hadExtra);
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
  // Crystals with a lifetime (slider; 0 — they lie until a chain breaks them).
  const life = world.params.crystalLife;
  if (life > 0 && world.objects.some(o => o.kind === 'crystal' && world.time - (o.born ?? 0) >= life)) {
    world.objects = world.objects.filter(o => o.kind !== 'crystal' || world.time - (o.born ?? 0) < life);
  }
  if (world.params.reaperEnabled && world.greedStart !== null && !world.reaperSpawned && world.time - world.greedStart >= world.params.reaperTime) spawnReaper(world);
  updateSpawning(world, dt);
  stepHeroKnock(world, dt);
  stepHeroWalk(world, dt);
  updateFlow(world, dt);
  moveEnemies(world, dt);
  separate(world);
  contactDamage(world, dt);
}

