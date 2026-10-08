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
import { behaviorOf, bodyRadiusOf, enemyKind, kindOf } from './enemies/kinds';
import { FlowField, type Vec, dist, hasZone, inThorns, inWater, lineOfSight, overCliff, pushOutOfCliffs, pushOutOfObstacles } from './geometry';
import { type Params, type Pressure, enemyBodyRadius, heroRadius, invulnerabilityFor, pressureAt } from './params';
import { hasTalisman, kitOf, type ItemKind, type Kit, type Loadout, type ResourceKind } from './kit';
import { eliteDeath, makeElite, touchLoot } from './elites';
import { updateBurning } from './items';
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
  /**
   * Game seconds left of the cold (stage 2 of the transition, docs/realtime-slice.md, section 4: «холод выключает
   * механику»). A frozen enemy stands, does not touch and its behaviour's mechanic is off (`enemyFrozen`); the field is
   * absent when the enemy is not frozen (worlds without cold hash as before). Set only by the test command `chill` until
   * the cold consumable (step 3).
   */
  chill?: number;
  /**
   * Stage 2, step 3: the cold consumable made it brittle — the next chain hit on it while it is frozen is ×`frostFactor`
   * (docs/realtime-slice.md, section 6). Spent by that hit; gone when the cold thaws. Absent otherwise.
   */
  brittle?: true;
  /** Stage 2, step 3: burning from the fire consumable — ticks left and game seconds to the next one. Absent otherwise. */
  burn?: { left: number; timer: number };
  /**
   * Stage 2, step 3: the elite modifier (docs/realtime-slice.md, section 7; elites.ts): HP ×2 (set when it became one),
   * art ×1.25, +1 to every hit on the hero, loot when the player kills it. `true` — an elite of the arena template (or
   * placed by a test); `random` — a random elite (a newcomer, the event modifier): its loot is always a resource.
   * Absent on an ordinary enemy.
   */
  elite?: true | 'random';
}

/** The enemy is frozen now: it stands, does not touch, its behaviour's mechanic (shield, shot, fuse, quills) is off. */
export function enemyFrozen(e: Enemy): boolean { return (e.chill ?? 0) > 0; }

/**
 * Button or door: a chain link of any color that gives no power and takes no damage (design answer 5),
 * always the last link. Crystal (iteration 2, stage C): a colour-change link of any color anywhere in
 * the chain — the next enemy sets the new color; no power, not a kill; breaking it gives score.
 * Not a body: enemies and the walking hero pass over it.
 */
export interface ArenaObject {
  id: number;
  /**
   * Stage 2, step 3: `loot` — what an elite dropped (a consumable or a crafting resource), picked up by a chain or a touch.
   * Stage 3a (М4): `brazier` — a link of any colour anywhere in the chain (no colour change); the rest of the chain gets
   * +`brazierPower`; the dash puts it out for `brazierCooldown` game seconds (`out`).
   */
  kind: 'button' | 'door' | 'crystal' | 'loot' | 'brazier';
  x: number;
  y: number;
  /** Button: pressed once and for all. */
  pressed: boolean;
  /** Crystal: kills of the chain that dropped it (its final length; score = crystalScorePerKill × value). */
  value?: number;
  /** Crystal: game time it fell (the lifetime slider). */
  born?: number;
  /** Loot (stage 2, step 3): a consumable (`frost`, `bomb`, `healing`, `fire`) or a crafting resource (`dew`, `powder`, `resin`, `herbs`). */
  loot?: ItemKind | ResourceKind;
  /** Brazier (stage 3a, М4): game seconds left until it burns again; absent — it burns (a chain may take it). */
  out?: number;
}

/** Radius of a button, the door or a crystal (units): the drawn circle, the pick circle, the door entry. */
export const OBJECT_RADIUS = 0.45;

/** A chain link: an enemy, or an arena object (a button or the door can only be the last link; a crystal anywhere). */
export type ChainLink = { kind: 'enemy'; id: number } | { kind: 'object'; id: number };

/** The last finished dash (render: combo counter, score popup; result screen). */
export interface ChainSummary { kills: number; hits: number; crystals: number; score: number; time: number }

/**
 * Stage 2 of the transition (design answer 08.10.2026): a link of the released chain killed during the dash by something
 * else (a blast, an arrow) stays a link: the hero passes its last point and it gives +1 power; it is a kill of the chain
 * (combo, crystal, score) only when its death is the player's (`credited`).
 */
export interface FallenLink { id: number; x: number; y: number; credited: boolean }

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
  /** Links of this dash killed before the hero reached them (absent when none: dashes without them hash as before). */
  fallen?: FallenLink[];
  /** Stage 2, step 3: links frozen and brittle at the release — struck ×2 even if they thaw on the way (absent when none). */
  brittle?: number[];
  /**
   * Iteration 2.1 (docs/realtime-slice.md, section 12): links armed at the release (`EnemyBehavior.armed`: porcupines with
   * their quills up) — their chain
   * hit hurts the hero even if the quills went down on the way; others do not, even if the quills went up (absent when none).
   */
  armed?: number[];
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
  /**
   * Stage 3a (М3): game seconds to the next prick while the hero is on foot in thorns (the walk-in pricks at once; a dash or
   * a jump ending in thorns gives a full interval first). Absent out of thorns — worlds without thorns hash as before.
   */
  thorns?: number;
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
  /** Stage 2 of the transition: an enemy hit by something other than the chain (an arrow, a blast). */
  | { type: 'enemyHit'; enemyId: number; damage: number; killed: boolean; x: number; y: number; source: string }
  | { type: 'crystal'; objectId: number; x: number; y: number }
  | { type: 'crystalBreak'; objectId: number; x: number; y: number; score: number; combo: number }
  | { type: 'finisher'; kills: number }
  | { type: 'chainEnd'; kills: number; score: number }
  | { type: 'kill'; enemyId: number; x: number; y: number; color: number; source?: string; credited?: boolean; fall?: boolean }
  /** Stage 3a (М4): the dash took a brazier (`lit` false — it went out) or it burns again (`lit` true). */
  | { type: 'brazier'; objectId: number; x: number; y: number; lit: boolean }
  | { type: 'jump' }
  /** Stage 2 of the transition: a blast went off (render: the flash). */
  | { type: 'blast'; x: number; y: number; radius: number; source: string }
  /** Stage 2, step 3: the hero's spin (Q) — its circle and how many enemies it struck (render: the flash). */
  | { type: 'spin'; x: number; y: number; radius: number; hits: number }
  /** Stage 2, step 3: a consumable used — its kind, where it acts, its circle (0 — one target or the hero) and targets. */
  | { type: 'item'; kind: ItemKind; x: number; y: number; radius: number; targets: number }
  /** Stage 2, step 3: an elite dropped its loot (`dropped`) or the hero picked it up. */
  | { type: 'loot'; objectId: number; loot: ItemKind | ResourceKind; x: number; y: number; picked: boolean }
  /** Stage 2, step 3: a newcomer became an elite (a random elite). */
  | { type: 'elite'; enemyId: number }
  /** Stage 2, step 3: «Пепельный оберег» saved the hero from a lethal hit (1 HP left) and crumbled. */
  | { type: 'ward' }
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
  /** Stage 2 of the transition: delayed blasts (lit fuses) on the arena. Hashed only when not empty. */
  blasts: Blast[];
  /**
   * Stage 2, step 3: what the hero brought into the arena and holds now (consumables; kit.ts). Absent — an arena started
   * without a loadout (journals before step 3): no consumables, the world hashes as before.
   */
  kit?: Kit;
}

/**
 * A delayed blast on the arena (stage 2 of the transition: the sapper's fuse): after `timeLeft` game seconds it hurts
 * the hero within `radius` (his body circle touching it; invulnerability protects) for `damage` and hits every enemy
 * whose body touches it for `damage` (`damageEnemy`). `credited` — its kills are the player's. `ownerId` — the enemy that
 * burns (a sapper lit by touch): it dies in its own blast. Not a body, not a link.
 */
export interface Blast {
  id: number;
  x: number;
  y: number;
  radius: number;
  damage: number;
  timeLeft: number;
  /** The whole delay (render: the ring grows over it). */
  total: number;
  credited: boolean;
  source: string;
  ownerId: number;
  /** Stage 2, step 3: the blast of an elite sapper (+1 to the hero). Absent otherwise. */
  elite?: true;
}

/** Stage 2, step 3: «Песочные часы» — game seconds the phase table after the goals starts later in this arena. */
export function phaseDelayOf(world: World): number { return hasTalisman(world, 'hourglass') ? world.params.hourglassDelay : 0; }

/** Energy cap (chain.ts `ENERGY_MAX`, as in the main game). */
const ENERGY_CAP = 7;

/** HP the hero enters an arena with: a run carries its HP and maximum between arenas (stage 2 of the transition). */
export interface HeroStart { hp: number; maxHp: number }

/**
 * A fresh arena from its template. `seed` drives every random choice (rng.ts streams); `params` is the live object of
 * the debug panel in the browser (its changes come as journalled `param` commands, simulation.ts). `start`: the hero's
 * HP and maximum (a run arena; the HP is kept within 1…maximum); absent — the panel's `heroHp`, full.
 */
export function createWorld(arena: ArenaTemplate, params: Params, seed = 1, start?: HeroStart, loadout?: Loadout): World {
  const maxHp = start ? Math.max(1, Math.floor(start.maxHp)) : params.heroHp;
  const hp = start ? Math.max(1, Math.min(maxHp, Math.floor(start.hp))) : params.heroHp;
  // Stage 2, step 3 («Песочные часы»): the phase table starts later — the delay is the talisman's, read once at the start.
  const phaseDelay = loadout?.talismans?.includes('hourglass') ? params.hourglassDelay : 0;
  let nextId = 1;
  const objects: ArenaObject[] = [
    ...arena.buttons.map(b => ({ id: nextId++, kind: 'button' as const, x: b.x, y: b.y, pressed: false })),
    { id: nextId++, kind: 'door', x: arena.door.x, y: arena.door.y, pressed: false },
    // Stage 3a (М4): braziers of the template (after the door: arenas without them keep their ids).
    ...(arena.braziers ?? []).map(b => ({ id: nextId++, kind: 'brazier' as const, x: b.x, y: b.y, pressed: false })),
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
    pressure: pressureAt(params, 0, null, arena, phaseDelay),
    flow: new FlowField(arena, enemyBodyRadius(params), flowOptions(arena, params)),
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
    blasts: [],
  };
  // Stage 2, step 3: the loadout of the arena — its consumables and the energy the run banked for it (up to the cap).
  if (loadout) {
    world.kit = kitOf(loadout);
    world.energy = Math.max(0, Math.min(ENERGY_CAP, Number.isFinite(loadout.energy) ? loadout.energy! : 0));
  }
  // Start enemies of the template stand at their posts from the start (no markers): the marked ones of the third arena.
  for (const s of arena.enemies) {
    const kind = s.kind ?? 'basic';
    const e = spawnEnemy(world, s, s.color, s.hp ?? enemyKind(kind).hp(params) ?? 0, kind);
    e.marked = !!s.marked;
    // Stage 2, step 3: an elite from the start (arenas 9–10 of step 4).
    if (s.elite) makeElite(world, e);
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
  // The elite bonus comes in `hurtHero` (every hit of an elite, stage 2, step 3).
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

/** Walking speed multiplier at a point: `waterSlow` in the pond (stage B) and in a river (stage 3a, М1), 1 elsewhere. */
export function waterFactor(world: World, p: Vec): number {
  return inWater(p, world.arena) ? world.params.waterSlow : 1;
}

/** Walking multiplier of an enemy at a point (stage 3a): water × thorns (`thornSlow`, М3; the hero walks thorns at full speed). */
export function enemyGroundFactor(world: World, p: Vec): number {
  const water = waterFactor(world, p);
  return world.arena.terrain && inThorns(p, world.arena) ? water * world.params.thornSlow : water;
}

/** Flow field options of an arena: the water cost, and the thorn cost where it has thorns (stage 3a). */
function flowOptions(arena: World['arena'], params: Params): { waterCost: number; thornCost?: number } {
  const waterCost = 1 / Math.max(0.05, params.waterSlow);
  return hasZone(arena, 'thorns') ? { waterCost, thornCost: 1 / Math.max(0.05, params.thornSlow) } : { waterCost };
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

/**
 * The damage a hit of `damage` from `striker` does to the hero (0 stays 0). Stage 2, step 3 (design answer 5): an elite hits
 * harder with everything — touch, arrow, charge, its blast, its quills. `hurtHero` and the «−N HP» badge of the quills read it.
 */
export function heroDamage(world: World, striker: { elite?: Enemy['elite'] }, damage: number): number {
  if (damage <= 0) return 0;
  return damage + (striker.elite ? Math.max(0, world.params.eliteDamageBonus) : 0);
}

/**
 * Applies damage to the hero: invulnerability, flash, stats, defeat. The caller decides whether he can be hurt now
 * (`canBeHurt`; the porcupine's quills ignore it). `striker` — the enemy (or the id of a dead one: a blast) in the event.
 */
export function hurtHero(world: World, striker: { id: number; elite?: Enemy['elite'] }, damage: number, source: HitSource): void {
  const { hero, params } = world;
  if (damage <= 0) return;
  damage = heroDamage(world, striker, damage);
  hero.hp = Math.max(0, hero.hp - damage);
  // Stage 2, step 3 («Пепельный оберег», once a run): a hit that would kill leaves the hero with 1 HP; the ward crumbles.
  const kit = world.kit;
  if (hero.hp <= 0 && kit?.ward) { hero.hp = 1; kit.ward = false; kit.wardUsed = true; world.events.push({ type: 'ward' }); }
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

/**
 * Who killed an enemy outside the chain (stage 2 of the transition, docs/realtime-slice.md, section 4, «Зачёт убийств»):
 * `credited` — the player's kill (counted in kills and score; the blast of a sapper the player killed); not credited —
 * an enemy's ability (an arrow, the blast of a sapper lit by touch). `source` names it in the events.
 */
export interface KillCause { source: string; credited: boolean; fall?: boolean }

/**
 * An enemy dies outside the chain: it leaves the arena with a `kill` event. A credited kill counts as the player's
 * (kills, score per kill, the kill goal). A marked enemy counts for the goal whoever killed it (as the targets of the
 * turn-based game: a target killed by an enemy's ability still counts for the task, not for the player's counters).
 * The chain kills through chain.ts (`hitEnemy`).
 */
export function killEnemy(world: World, e: Enemy, cause: KillCause): void {
  const index = world.enemies.indexOf(e);
  if (index < 0) return;
  world.enemies.splice(index, 1);
  world.events.push({ type: 'kill', enemyId: e.id, x: e.x, y: e.y, color: e.color, source: cause.source, credited: cause.credited, ...cause.fall ? { fall: true } : {} });
  // A link of the dash ahead of the hero stays a link (chain.ts, `passFallen`): its score comes with the chain's.
  const move = world.move, link = move?.kind === 'dash' && move.links.some(l => l.kind === 'enemy' && l.id === e.id);
  if (link) (move.fallen ??= []).push({ id: e.id, x: e.x, y: e.y, credited: cause.credited });
  if (cause.credited) { world.stats.kills++; if (!link) world.stats.score += world.params.scorePerKill; }
  if (e.marked) world.stats.markedKills++;
  checkGoals(world);
  behaviorOf(e).onDeath?.(world, e, cause);
  // Stage 2, step 3: an elite killed by the player drops its loot.
  eliteDeath(world, e, cause);
}

/**
 * A hit of `damage` on an enemy from outside the chain (an arrow, a blast). As a chain hit: it kills when the damage is not
 * less than the HP (a weak enemy, 0 HP, dies from any hit), otherwise the HP drop. An immune kind (the reaper) is not hurt.
 */
export function damageEnemy(world: World, e: Enemy, damage: number, cause: KillCause): void {
  if (damage <= 0 || kindOf(e).immune || !world.enemies.includes(e)) return;
  const killed = damage >= e.hp;
  e.hurtFlash = Math.max(world.params.hitFlash, 0.01);
  world.events.push({ type: 'enemyHit', enemyId: e.id, damage, killed, x: e.x, y: e.y, source: cause.source });
  if (killed) killEnemy(world, e, cause);
  else e.hp -= damage;
}

/** A blast lit on the arena (`delay` game seconds; 0 — it goes off in this tick's blast step). */
export function addBlast(world: World, at: Vec, blast: { radius: number; damage: number; delay: number; credited: boolean; source: string; ownerId: number; elite?: boolean }): Blast {
  const b: Blast = { id: world.nextId++, x: at.x, y: at.y, radius: blast.radius, damage: blast.damage, timeLeft: blast.delay, total: blast.delay, credited: blast.credited, source: blast.source, ownerId: blast.ownerId,
    ...blast.elite ? { elite: true as const } : {} };
  world.blasts.push(b);
  return b;
}

/** A blast goes off: its burning owner dies in it, then the hero (first: his death comes before a goal) and the enemies are hit. */
function detonate(world: World, b: Blast): void {
  const cause: KillCause = { source: b.source, credited: b.credited }, p = world.params;
  world.events.push({ type: 'blast', x: b.x, y: b.y, radius: b.radius, source: b.source });
  const owner = world.enemies.find(e => e.id === b.ownerId);
  if (owner) killEnemy(world, owner, cause);
  if (canBeHurt(world) && dist(world.hero, b) <= b.radius + heroRadius(p)) hurtHero(world, { id: b.ownerId, ...b.elite ? { elite: true as const } : {} }, b.damage, b.source);
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => dist(e, b) <= b.radius + bodyRadiusOf(p, e));
  for (const e of struck) damageEnemy(world, e, b.damage, cause);
  // Stage 3a (М2; the sandbox slider «Взрыв отбрасывает», 0 — off): the survivors are thrown off the blast; one thrown over a
  // cliff falls — the blast's kill (credited as the blast).
  const push = p.blastPush ?? 0;
  if (push <= 0) return;
  for (const e of struck) {
    if (!world.enemies.includes(e)) continue;
    const dx = e.x - b.x, dy = e.y - b.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    e.x += dx / d * push; e.y += dy / d * push;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena, false);
  }
  dropIntoCliffs(world, null, { ...cause, fall: true });
}

/** Fuses burn on game time; the blasts that are due go off in the order they were lit (a blast may light new ones). */
function updateBlasts(world: World, dt: number): void {
  if (!world.blasts.length) return;
  const due: Blast[] = [];
  for (const b of world.blasts) { b.timeLeft -= dt; if (b.timeLeft <= 1e-9) due.push(b); }
  if (!due.length) return;
  world.blasts = world.blasts.filter(b => !due.includes(b));
  for (const b of due) { if (world.status !== 'playing') return; detonate(world, b); }
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
  // A behaviour's step may kill (the archer's arrow): walk over a copy, so the list shrinking never skips the next enemy's
  // step; an enemy killed earlier in this step does not move.
  const list = [...world.enemies];
  for (const e of list) {
    if (list.length !== world.enemies.length && !world.enemies.includes(e)) continue;
    // A frozen enemy stands: no own step (its timers wait), no walk.
    if (enemyFrozen(e)) continue;
    // A behaviour with its own movement (the boar's windup, charge and rest) skips the common walk this step.
    const own = behaviorOf(e).step;
    if (own && own(world, e, dt)) continue;
    if (e.knock > 0) {
      const t = Math.min(dt, e.knock);
      e.x += e.knockVx * t; e.y += e.knockVy * t; e.knock -= t;
      // Stage 3a (М2): a survivor knocked back by the chain over a cliff falls — the chain's kill.
      if (arena.terrain && overCliff(e, arena) && !kindOf(e).immune) killEnemy(world, e, { source: 'chain', credited: true, fall: true });
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
    const step = Math.min(enemySpeed(world, e) * enemyGroundFactor(world, e) * dt, Math.max(0, d - stop));
    e.x += dx * step; e.y += dy * step;
    // Stage 3a (М2): walking never enters a cliff — its edge is a wall for the walk (a push may still throw a body over it).
    if (arena.terrain) pushOutOfCliffs(e, r, arena);
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
function separate(world: World): Map<Enemy, Enemy> | null {
  const { enemies, hero, params, arena } = world;
  // Stage 3a (М2): on an arena with a cliff the pushing does not stop at its edge; who was shoved by a heavier body (the
  // charging boar) is noted for the fall's cause (`dropIntoCliffs`).
  const cliffs = hasZone(arena, 'cliff'), shoved = cliffs ? new Map<Enemy, Enemy>() : null;
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
        if (shoved) { if (ma > mb) shoved.set(b, a); else if (mb > ma) shoved.set(a, b); }
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
      pushOutOfObstacles(e, radii[i], arena, !cliffs);
    }
  }
  return shoved;
}

/**
 * Stage 3a (М2): every enemy whose center is over a cliff falls and dies (`killEnemy` with `fall`). The cause is the push:
 * `cause` when given (a blast); else a chain knockback still running (`knock`, the survivor's knockback — the player's);
 * else a heavier body that shoved it this tick (the charging boar: its source, not credited); else the crowd's pushing or
 * the walking hero's parting (`push`, not credited — design 08.10.2026, step 1: walking the crowd off the edge is not a kill
 * of the player). An immune kind (the reaper) does not fall: it is put back on the edge.
 */
export function dropIntoCliffs(world: World, shoved: Map<Enemy, Enemy> | null, cause?: KillCause): void {
  const arena = world.arena;
  if (!hasZone(arena, 'cliff')) return;
  for (const e of [...world.enemies]) {
    if (world.status !== 'playing') return;
    if (!world.enemies.includes(e) || !overCliff(e, arena)) continue;
    if (kindOf(e).immune) { pushOutOfObstacles(e, bodyRadiusOf(world.params, e), arena); continue; }
    const by = shoved?.get(e);
    const why: KillCause = cause ?? (e.knock > 0 ? { source: 'chain', credited: true, fall: true }
      : by ? { source: by.kind, credited: false, fall: true } : { source: 'push', credited: false, fall: true });
    killEnemy(world, e, why);
  }
}

/**
 * Stage 3a (М3): thorns prick the hero on foot — at once when he walks in, then every `thornInterval` game seconds while
 * his center stays in them. Not during a dash or a jump (the timer waits); a dash or a jump ending in thorns starts a full
 * interval (chain.ts, `finishMove`). Invulnerability (after a hit or a chain) and the focus spare skip a prick, the
 * interval runs on (no reset). Source `thorns`.
 */
function updateThorns(world: World, dt: number): void {
  const hero = world.hero, p = world.params;
  if (!world.arena.terrain || world.move) return;
  if (!inThorns(hero, world.arena)) { if (hero.thorns !== undefined) delete hero.thorns; return; }
  hero.thorns = (hero.thorns ?? 0) - dt;
  if (hero.thorns > 1e-9) return;
  hero.thorns += Math.max(0.05, p.thornInterval);
  if (canBeHurt(world)) hurtHero(world, { id: 0 }, p.thornDamage, 'thorns');
}

/** Stage 3a (М4): a brazier put out by a dash burns again after its cooldown (game time). */
function updateBraziers(world: World, dt: number): void {
  for (const o of world.objects) {
    if (o.kind !== 'brazier' || o.out === undefined) continue;
    o.out -= dt;
    if (o.out <= 1e-9) { delete o.out; world.events.push({ type: 'brazier', objectId: o.id, x: o.x, y: o.y, lit: true }); }
  }
}

function contactDamage(world: World, dt: number): void {
  const { hero, params } = world;
  for (const e of world.enemies) {
    e.brake = Math.max(0, e.brake - dt);
    e.strikeFlash = Math.max(0, e.strikeFlash - dt);
    e.age += dt;
    // The cold thaws on game time; the brittleness of the cold consumable goes with it.
    if (e.chill !== undefined) { e.chill -= dt; if (e.chill <= 1e-9) { delete e.chill; delete e.brittle; } }
  }
  if (!canBeHurt(world)) return;
  // Invulnerability alone limits the damage rate: one hit, then a grace window for the whole crowd.
  // The strongest touching enemy counts: the reaper (design answer 30) or a wolf with its pack.
  // A behaviour may say its touch does not hurt now: the charging boar's hit is the charge (enemies/boar.ts).
  let striker: Enemy | null = null, damage = 0;
  for (const e of world.enemies) {
    if (dist(e, hero) > touchDistanceOf(params, e) + CONTACT_SLACK || enemyFrozen(e)) continue;
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
  const options = flowOptions(world.arena, p);
  const body = enemyBodyRadius(p);
  if (Math.abs(world.flow.radius - body) > 1e-9 || world.flow.options.waterCost !== options.waterCost || world.flow.options.thornCost !== options.thornCost) {
    world.flow = new FlowField(world.arena, body, options);
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
  world.pressure = pressureAt(world.params, world.time, world.greedStart, world.arena, phaseDelayOf(world));
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
  // Stage 2, step 3: the walking hero picks up the loot he touches.
  touchLoot(world);
  // Walking in wins on a NEW touch of the open door only (design 07.10.2026): a hero standing on the door when it opens
  // keeps the choice to stay greedy — he must step off and touch it again (or enter by a chain or a jump).
  const onDoor = heroTouchesDoor(world), touchedNow = onDoor && !world.heroOnDoor;
  world.heroOnDoor = onDoor;
  if (world.params.doorWalkIn && !world.move && touchedNow && doorOpen(world)) { win(world); return; }
  updateFlow(world, dt);
  moveEnemies(world, dt);
  const shoved = separate(world);
  // Stage 3a (М2): bodies pushed over a cliff fall (only on an arena with a cliff).
  dropIntoCliffs(world, shoved);
  updateBlasts(world, dt);
  if (world.status !== 'playing') return;
  // Stage 2, step 3: burning enemies (the fire consumable) take their ticks after the blasts, before the touches.
  updateBurning(world, dt);
  // Stage 3a: thorns prick the hero on foot (М3); braziers burn again (М4). Arenas without them: nothing.
  updateThorns(world, dt);
  if (world.status !== 'playing') return;
  updateBraziers(world, dt);
  contactDamage(world, dt);
}
