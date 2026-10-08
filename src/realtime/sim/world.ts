/**
 * World state and the game-time step of the real-time simulation (no DOM; stage 1 of the transition,
 * docs/realtime-prototype.md, «Ядро реального времени»). Deterministic: every random choice reads a seeded stream
 * (`world.rng`, rng.ts), and the step runs on a fixed game time (`SIM_DT` ticks of simulation.ts).
 * The chain, focus and the hero's dash live in chain.ts (`stepHero` runs before `update` on every tick).
 * Enemy kinds and their behaviours (the wolf's pack, the boar's charge, the reaper) are registered data and modules
 * (enemies/*), the arena is a template (arenas.ts). Iteration 2, stage A: the hero walks (the `walk` command →
 * `world.input`), enemies follow the flow field around obstacles.
 */
import { type ArenaTemplate, markedCount } from './arenas';
// The prototype kinds register on import (enemies/index.ts); the core reads them through the registry only.
import './enemies/index';
import type { BoarState } from './enemies/boar';
import { behaviorOf, bodyRadiusOf, kindOf } from './enemies/kinds';
import { FlowField, type Vec, dist, inWater, lineOfSight, pushOutOfObstacles } from './geometry';
import { type Params, type Pressure, enemyBodyRadius, heroRadius, invulnerabilityFor, pressureAt } from './params';
import { RngStreams } from './rng';
import { spawnEnemy, spawnReaper, updateSpawning, type QueuedSpawn, type SpawnMarker } from './spawn';

/**
 * Id of a registered enemy kind (enemies/*): prototype kinds `basic`, `wolf` (fast, hits harder next to other wolves),
 * `boar` (announces a charge along a line, then runs with extra mass), `reaper` (the time limit, design answer 25 —
 * fast, cannot be killed, colorless).
 */
export type EnemyKind = string;
export type { BoarState };
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
  /** Own numbers of a registered behaviour (new kinds keep their state here; part of the world hash). */
  vars: Record<string, number>;
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

/** Radius of a button, the door or a crystal (units): the drawn circle, the pick circle, the door entry. */
export const OBJECT_RADIUS = 0.45;

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
  /** Stage F: game seconds left of the invulnerability after a chain (shown by its own blink); the larger of it and
   * `invulnerable` protects. */
  chainShield: number;
  /** Real seconds left of the hurt flash (render). */
  hurtFlash: number;
  /** Knockback from a boar charge: velocity and game seconds left. */
  knockVx: number;
  knockVy: number;
  knock: number;
}

/** Source of a hit on the hero: `touch`, `wolf`, `reaper` (a kind's touch), `boar` (the charge) or a new kind's own. */
export type HitSource = string;

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
  | { type: 'focusRefill' }
  | { type: 'defeat' };

export interface World {
  arena: ArenaTemplate;
  params: Params;
  /** Seeded random streams (rng.ts): every random choice of the simulation. */
  rng: RngStreams;
  hero: Hero;
  enemies: Enemy[];
  markers: SpawnMarker[];
  /** Enemies of rolled groups waiting for room under the arena limit. */
  queue: QueuedSpawn[];
  /** Game time in seconds: `SIM_DT` per tick (real time runs faster in focus and the finisher slow-motion). */
  time: number;
  /** Ticks run so far (simulation.ts); journal commands are stamped with the tick they come before. */
  tick: number;
  /** Game seconds until the next group. */
  groupTimer: number;
  nextId: number;
  status: 'playing' | 'defeat' | 'victory';
  /** Buttons and the door of the arena. */
  objects: ArenaObject[];
  /** Game seconds per real second in the last tick: focus (×0.25) and the finisher slow-motion lower it (`stepHero`). */
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
  /** Stage C: real seconds of hit-stop left: the following ticks are frozen (no game time) until it runs out. */
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
  /** The hero touched the door in the last update: walking in needs a new touch (stage G). */
  heroOnDoor: boolean;
  /** Real seconds of focus left (design answer 14). */
  focus: number;
  /** Links («enemy:id», «object:id») that refreshed focus in the chain being drawn: each once per chain (stage E). */
  focusRefreshed: Set<string>;
  /** True while focus slows the world (a chain is drawn and focus is left). */
  focusing: boolean;
  /** Energy for the jump: +energyPerKill per attacked enemy, up to ENERGY_MAX. */
  energy: number;
}

/** HP the hero enters an arena with: a run carries its HP and maximum between arenas (stage 2 of the transition). */
export interface HeroStart { hp: number; maxHp: number }

/**
 * A fresh arena from its template. `seed` drives every random choice (rng.ts streams); `params` is the live object of
 * the debug panel in the browser (its changes come as journalled `param` commands, simulation.ts). `start`: the hero's
 * HP and maximum (a run arena; the HP is kept within 1…maximum); absent — the panel's `heroHp`, full.
 */
export function createWorld(arena: ArenaTemplate, params: Params, seed = 1, start?: HeroStart): World {
  const maxHp = start ? Math.max(1, Math.floor(start.maxHp)) : params.heroHp;
  const hp = start ? Math.max(1, Math.min(maxHp, Math.floor(start.hp))) : params.heroHp;
  let nextId = 1;
  const objects: ArenaObject[] = [
    ...arena.buttons.map(b => ({ id: nextId++, kind: 'button' as const, x: b.x, y: b.y, pressed: false })),
    { id: nextId++, kind: 'door', x: arena.door.x, y: arena.door.y, pressed: false },
  ];
  const world: World = {
    arena,
    params,
    rng: new RngStreams(seed),
    hero: { x: arena.heroStart.x, y: arena.heroStart.y, hp, maxHp, invulnerable: 0, chainShield: 0, hurtFlash: 0, knockVx: 0, knockVy: 0, knock: 0 },
    enemies: [],
    markers: [],
    queue: [],
    time: 0,
    tick: 0,
    groupTimer: 0,
    nextId,
    status: 'playing',
    objects,
    timeScale: 1,
    pressure: pressureAt(params, 0, null, arena),
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
    heroOnDoor: false,
    focus: params.focusMax,
    focusRefreshed: new Set(),
    focusing: false,
    energy: 0,
  };
  // Start enemies of the template stand at their posts from the start (no markers): the marked ones of the third arena.
  for (const s of arena.enemies) {
    const e = spawnEnemy(world, s, s.color, s.hp, s.kind ?? 'basic');
    e.marked = !!s.marked;
    pushOutOfObstacles(e, bodyRadiusOf(params, e), arena);
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
  if (goal === 'marked') return { done: world.stats.markedKills, total: markedCount(world.arena), label: 'отмеченные' };
  const total = world.arena.killGoal ?? world.params.killGoal;
  return { done: Math.min(world.stats.kills, total), total, label: 'убито' };
}

/** Called after a chain kill or a button press: the arena goals complete the stage. */
export function checkGoals(world: World): void {
  if (world.stage !== 'goals') return;
  const { done, total } = goalProgress(world);
  if (done >= total) completeGoals(world);
}

/**
 * Stage G (user 07.10.2026, toggle «Вход в дверь ходьбой»): after the goals the hero's body touching the open door wins —
 * walking in (or pushed in by the boar). Not during a dash or a jump: those enter by their own rule (the chain ends on the
 * door, the jump lands in it). The closed door is not a body and does nothing: the hero walks over it.
 */
export function heroTouchesOpenDoor(world: World): boolean {
  return doorOpen(world) && heroTouchesDoor(world);
}
/** The hero's body touches the door, open or closed. */
export function heroTouchesDoor(world: World): boolean {
  return dist(doorOf(world), world.hero) <= OBJECT_RADIUS + heroRadius(world.params);
}

/** Entering the open door: the arena is won. */
export function win(world: World): void {
  if (world.status !== 'playing') return;
  world.status = 'victory';
  world.endTime = world.time;
  world.chain = [];
  world.events.push({ type: 'victory' });
}

/** Contact damage of one enemy now: its kind decides (the reaper, a wolf with its pack bonus, the base touch). */
export function touchDamage(world: World, e: Enemy): number {
  return kindOf(e).touchDamage(world, e);
}

/**
 * Distance at which an enemy of the common size touches the hero: hero circle plus the reduced body circle
 * (the body scales with the enemy size, stage D). Enemies stop exactly here and never push the hero.
 */
export function touchDistance(params: Params): number {
  return heroRadius(params) + enemyBodyRadius(params) * params.touchFactor;
}

/** `touchDistance` for this enemy's own body (a kind may be larger or smaller; the prototype kinds are all 1). */
export function touchDistanceOf(params: Params, e: Enemy): number {
  return heroRadius(params) + bodyRadiusOf(params, e) * params.touchFactor;
}

/**
 * Distance at which the walking hero stops at an enemy (toggle «сквозь врагов» off): hero circle
 * plus the full body circle (design answer 37). It exceeds the touch reach (`touchDistance` + contact
 * slack) while touchFactor < 1 − 0.03 ÷ body radius (≈ 0.92 at 0.4, ≈ 0.91 at 0.32 — the enemy
 * size 0.8 of stage D): brushing past a crowd does not hurt.
 */
export function heroBlockDistance(params: Params, e?: Enemy): number {
  return heroRadius(params) + (e ? bodyRadiusOf(params, e) : enemyBodyRadius(params));
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
  const hr = heroRadius(params);
  return world.enemies.some(e => dist(e, hero) < hr + bodyRadiusOf(params, e) && (e.x - hero.x) * heroWalk.x + (e.y - hero.y) * heroWalk.y > 0);
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

/** Speed of an enemy right now, in units per game second: its kind's speed × spread and braking × the marked slowdown. */
export function enemySpeed(world: World, e: Enemy): number {
  const p = world.params;
  return kindOf(e).speed(world, e) * enemySpeedFactor(e, p) * (e.marked ? p.markedSpeed : 1);
}

const SEPARATION_PASSES = 4;
/** Slack of the touch reach (and of the boar charge reaching the hero). */
export const CONTACT_SLACK = 0.03;
/** Game seconds over which a knockback (the boar's charge) moves the hero. */
const HERO_KNOCK_TIME = 0.15;

/** The hero can be hurt now: playing, no invulnerability or after-chain shield, not dashing or jumping, not spared by focus. */
export function canBeHurt(world: World): boolean {
  if (world.status !== 'playing' || world.hero.invulnerable > 0 || world.hero.chainShield > 0 || world.move) return false;
  return !(world.params.focusNoDamage && world.focusing);
}

/** Applies damage to the hero: invulnerability, flash, stats, defeat. */
export function hurtHero(world: World, striker: Enemy, damage: number, source: HitSource): void {
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

/** Knocks the hero `distance` units along the unit direction over `HERO_KNOCK_TIME` game seconds (the boar's charge). */
export function knockHero(world: World, dirX: number, dirY: number, distance: number): void {
  const hero = world.hero;
  hero.knock = HERO_KNOCK_TIME;
  hero.knockVx = dirX * distance / HERO_KNOCK_TIME;
  hero.knockVy = dirY * distance / HERO_KNOCK_TIME;
}

function moveEnemies(world: World, dt: number): void {
  const { hero, params, arena, flow } = world;
  for (const e of world.enemies) {
    // A behaviour with its own movement (the boar's windup, charge and rest) skips the common walk this step.
    const own = behaviorOf(e).step;
    if (own && own(world, e, dt)) continue;
    if (e.knock > 0) {
      const t = Math.min(dt, e.knock);
      e.x += e.knockVx * t; e.y += e.knockVy * t; e.knock -= t;
      continue;
    }
    const r = bodyRadiusOf(params, e), stop = touchDistanceOf(params, e);
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
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const e of world.enemies) {
        const min = heroBlockDistance(params, e);
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
      const min = heroBlockDistance(params, e);
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
 * Two bodies at the very same point part in a random direction (the seeded `separate` stream).
 */
function separate(world: World): void {
  const { enemies, hero, params, arena } = world;
  const wx = world.heroWalk.x, wy = world.heroWalk.y, parting = params.heroThroughEnemies && (wx !== 0 || wy !== 0);
  const rng = world.rng.stream('separate');
  // Body radii once per step (a kind may have its own size; the prototype kinds share one).
  const radii = enemies.map(e => bodyRadiusOf(params, e)), touch = enemies.map(e => touchDistanceOf(params, e));
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i], ra = radii[i];
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j], min = ra + radii[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { const ang = rng.next() * Math.PI * 2; dx = Math.cos(ang); dy = Math.sin(ang); d = 0; }
        else { dx /= d; dy /= d; }
        // Overlap split by mass: the charging boar barely yields, the crowd gets shoved aside.
        const ma = kindOf(a).mass(world, a), mb = kindOf(b).mass(world, b), overlap = min - d;
        const pa = overlap * mb / (ma + mb), pb = overlap * ma / (ma + mb);
        a.x -= dx * pa; a.y -= dy * pa; b.x += dx * pb; b.y += dy * pb;
      }
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i], heroMin = touch[i];
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
      pushOutOfObstacles(e, radii[i], arena);
    }
  }
}

function contactDamage(world: World, dt: number): void {
  const { hero, params } = world;
  for (const e of world.enemies) {
    e.brake = Math.max(0, e.brake - dt);
    e.strikeFlash = Math.max(0, e.strikeFlash - dt);
    e.age += dt;
  }
  if (!canBeHurt(world)) return;
  // Invulnerability alone limits the damage rate: one hit, then a grace window for the whole crowd.
  // The strongest touching enemy counts: the reaper (design answer 30) or a wolf with its pack.
  // A behaviour may say its touch does not hurt now: the charging boar's hit is the charge (enemies/boar.ts).
  let striker: Enemy | null = null, damage = 0;
  for (const e of world.enemies) {
    if (dist(e, hero) > touchDistanceOf(params, e) + CONTACT_SLACK) continue;
    const touches = behaviorOf(e).touches;
    if (touches && !touches(world, e)) continue;
    const dmg = touchDamage(world, e);
    if (!striker || dmg > damage) { striker = e; damage = dmg; }
  }
  if (!striker || damage <= 0) return;
  striker.brake = params.brakeRecovery;
  striker.strikeFlash = 0.18;
  hurtHero(world, striker, damage, kindOf(striker).hitSource);
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

/**
 * One game-time step: `dt` game seconds (the fixed `SIM_DT` of simulation.ts), `realDt` — the real seconds it stands
 * for (`dt ÷ timeScale`: longer in focus). Invulnerability, braking and walking run on game time; render flashes on
 * real time. `stepHero` (chain.ts) runs first on every tick.
 */
export function update(world: World, dt: number, realDt = dt): void {
  if (world.status !== 'playing') return;
  world.time += dt;
  world.pressure = pressureAt(world.params, world.time, world.greedStart, world.arena);
  const hero = world.hero;
  hero.invulnerable = Math.max(0, hero.invulnerable - dt);
  hero.chainShield = Math.max(0, hero.chainShield - dt);
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
  // Walking in wins on a NEW touch of the open door only (design 07.10.2026): a hero standing on the door when it opens
  // keeps the choice to stay greedy — he must step off and touch it again (or enter by a chain or a jump).
  const onDoor = heroTouchesDoor(world), touchedNow = onDoor && !world.heroOnDoor;
  world.heroOnDoor = onDoor;
  if (world.params.doorWalkIn && !world.move && touchedNow && doorOpen(world)) { win(world); return; }
  updateFlow(world, dt);
  moveEnemies(world, dt);
  separate(world);
  contactDamage(world, dt);
}
