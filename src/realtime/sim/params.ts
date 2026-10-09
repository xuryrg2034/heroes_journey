/**
 * Tunable numbers of the real-time simulation (docs/realtime-prototype.md, sections 8, 9a and 11).
 * Every value is a debug-panel control; the view stores them in localStorage (view/paramStorage.ts).
 * Stage marks which prototype stage introduced the value (all stages are implemented).
 * No DOM here: the simulation (src/realtime/sim) runs in Node too.
 */
import { dpowi } from './detMath';
import type { ArenaTemplate } from './arenas';
import type { Rng } from './rng';

export type DimMode = 'darken' | 'alpha' | 'desaturate';
export type EnemyLook = 'circle' | 'sprite';
export type InvulnerabilityMode = 'constant' | 'byDamage';
export type SpawnPlace = 'edges' | 'edgesAndInside';
export type GroupColor = 'mixed' | 'mono';

/**
 * One phase of the arena pressure table (Vampire Survivors style, design answer 23).
 * The table runs only in the greed stage — after the arena goals are done (user decision
 * 07.10.2026); before that the base pace applies. Phases run in order; the last one holds.
 */
export interface Phase {
  /** Seconds of game time. */
  duration: number;
  /** Density floor: with fewer living enemies (plus markers and queue) the gap is queued at once. */
  floor: number;
  /** Seconds between groups: uniform in [intervalMin, intervalMax]. */
  intervalMin: number;
  intervalMax: number;
  /** Share of tough enemies (1–2 HP) among newcomers. */
  toughShare: number;
  /** Share of groups that come as a wolf pack (stage 3; replaces the stage 1 «fast» share). */
  wolfShare: number;
  /** Share of boars among the other newcomers (stage 3; capped by `boarMax` on the arena). */
  boarShare: number;
}

export const PHASE_FIELDS: readonly { key: keyof Phase; label: string; min: number; max: number; step: number; percent?: boolean }[] = [
  { key: 'duration', label: 'с', min: 5, max: 300, step: 5 },
  { key: 'floor', label: 'пол', min: 0, max: 150, step: 1 },
  { key: 'intervalMin', label: 'инт. от', min: 0.2, max: 20, step: 0.1 },
  { key: 'intervalMax', label: 'до', min: 0.2, max: 20, step: 0.1 },
  { key: 'toughShare', label: 'креп. %', min: 0, max: 1, step: 0.05, percent: true },
  { key: 'wolfShare', label: 'стаи %', min: 0, max: 1, step: 0.05, percent: true },
  { key: 'boarShare', label: 'кабан %', min: 0, max: 1, step: 0.01, percent: true },
];

/**
 * Default table: build-up, a breather (phase 3), then the squeeze. Iteration 2, stage B: every floor is at
 * least the floor before the goals (`baseFloor`, 28) — greed never thins the arena; the breather keeps
 * the base floor and only slows the groups (stage 1–3 floors were 6, 12, 4, 20, 30).
 */
export const DEFAULT_PHASES: readonly Phase[] = Object.freeze([
  { duration: 25, floor: 30, intervalMin: 3, intervalMax: 5, toughShare: 0.2, wolfShare: 0.15, boarShare: 0.05 },
  { duration: 25, floor: 34, intervalMin: 2.5, intervalMax: 4, toughShare: 0.25, wolfShare: 0.2, boarShare: 0.06 },
  { duration: 20, floor: 28, intervalMin: 5, intervalMax: 7, toughShare: 0.2, wolfShare: 0.1, boarShare: 0 },
  { duration: 30, floor: 40, intervalMin: 2, intervalMax: 3.5, toughShare: 0.3, wolfShare: 0.25, boarShare: 0.08 },
  { duration: 30, floor: 48, intervalMin: 1.5, intervalMax: 3, toughShare: 0.4, wolfShare: 0.3, boarShare: 0.1 },
].map(p => Object.freeze(p)));

export interface Params {
  // Hero and damage
  heroHp: number;
  heroHitFactor: number;
  contactDamage: number;
  invulnerabilityMode: InvulnerabilityMode;
  /** Stage F (user 07.10.2026): game seconds of invulnerability after a chain that killed (to walk out of the crowd). */
  chainShield: number;
  /** Kills a chain needs to give that invulnerability. */
  chainShieldMinKills: number;
  invulnerability: number;
  touchFactor: number;
  brakeStrength: number;
  brakeRecovery: number;
  // Hero walking (iteration 2, stage A): WASD / arrows, solid against obstacles and (toggle) enemies
  heroSpeed: number;
  heroThroughEnemies: boolean;
  /** Stage D: walking multiplier while the hero's circle overlaps an enemy body (only with `heroThroughEnemies`); stacks with water only. */
  crowdSlow: number;
  // Enemies
  /** Art radius at size 1 (`enemyScale` scales it: `enemyDrawRadius`). */
  enemyRadius: number;
  /** Body radius at size 1 (`enemyScale` scales it: `enemyBodyRadius`); the hero circle is a share of this unscaled value. */
  bodyRadius: number;
  /** Stage D (user 07.10.2026): enemy size — art, body, touch zone and pushing of every kind (basic, wolf, boar, reaper). */
  enemyScale: number;
  enemySpeed: number;
  /** Personal speed spread of newcomers: ×(1 ± this), uniform (iteration 2.1, 08.10.2026: ±0.35; ±0.2 before it). */
  speedSpread: number;
  /**
   * Phase A, T1 (docs/realtime-phase-a.md, section 2): speed classes — a kind's walk is the pace's enemy speed × its class
   * (slow `speedSlow`, normal 1, fast `speedFast`) instead of the kind's own multiplier (`shieldSpeed`, `shamanSpeed`,
   * `lynxSpeed`, the wolf's absolute `wolfSpeed`). Journals without this value replay with the old formulas. A run forces it on.
   */
  speedClasses: boolean;
  speedSlow: number;
  speedFast: number;
  /** Iteration 2: the flow field leads enemies around obstacles (off — straight at the hero, as in stages 1–3). */
  pathfinding: boolean;
  /** Flow field rebuilds per game second. */
  flowRate: number;
  /** How fast an enemy turns to the field direction (1/s): smooths the 8-direction grid. */
  flowTurn: number;
  /** Stage B (design answer 39): enemies in a cell make it dearer, so the crowd spreads instead of queueing (off). */
  flowDensity: boolean;
  /** Extra cost of a cell per enemy standing in it. */
  flowDensityCost: number;
  /** Stage B: walking speed multiplier in the pond (hero and enemies walking; not the charge, dash or jump — design answer 41). */
  waterSlow: number;
  // Terrain of stage 3a (docs/realtime-stage3.md, section 2; the river uses `waterSlow`, the cliff has no numbers)
  /** М3: damage of a thorn prick to the hero on foot. */
  thornDamage: number;
  /** М3: game seconds between pricks while the hero stays in thorns (the walk-in pricks at once). */
  thornInterval: number;
  /** М3: walking speed multiplier of enemies in thorns. */
  thornSlow: number;
  /** М4: power the rest of the chain gets after a brazier. */
  brazierPower: number;
  /** М4: game seconds a brazier stays out after a dash took it. */
  brazierCooldown: number;
  /** М2 (design answer 09.10.2026): units a blast throws the enemies it struck and did not kill (not the hero; 0 — off, as before stage 3a). */
  blastPush: number;
  // Crystals (stage C): a colour-change crystal for every N kills of one chain, as in the main game
  crystals: boolean;
  crystalEvery: number;
  /** Game seconds a crystal lies on the arena; 0 — until a chain breaks it. */
  crystalLife: number;
  /** Score for breaking a crystal = this × kills of the chain that dropped it (main game: 20). */
  crystalScorePerKill: number;
  /** Radius around the kill where the crystal falls; 0 — anywhere on the arena (design 07.10.2026: keep the combo at the same crowd). */
  crystalDropRadius: number;
  // Chain juice (stage C): every effect is a toggle
  comboCounter: boolean;
  hitstop: boolean;
  hitstopMin: number;
  hitstopMax: number;
  hitstopGrowth: number;
  finisher: boolean;
  finisherLinks: number;
  finisherTime: number;
  finisherSlow: number;
  chainScoreMultiplier: boolean;
  scorePerKill: number;
  scoreLengthBonus: number;
  sound: boolean;
  soundVolume: number;
  // Wolves (stage 3): fast, hit harder next to other wolves, come in packs
  wolfSpeed: number;
  wolfPackMin: number;
  wolfPackMax: number;
  wolfPackRadius: number;
  wolfPackBonus: number;
  wolfPackMono: boolean;
  // Spawning before the goals (base pace, no growth)
  /** Stage B: density floor before the goals — fewer living enemies (with markers and queue) are topped up at once. */
  baseFloor: number;
  baseIntervalMin: number;
  baseIntervalMax: number;
  baseToughShare: number;
  baseWolfShare: number;
  baseBoarShare: number;
  // Greed stage after the goals: pressure table `phases`
  phases: Phase[];
  // Spawning, both stages
  groupMin: number;
  groupMax: number;
  spawnPlace: SpawnPlace;
  groupColor: GroupColor;
  maxEnemies: number;
  markerDelay: number;
  spawnMinDistance: number;
  // Growth over time and the time limit
  angerTierSeconds: number;
  angerSpeedStep: number;
  reaperEnabled: boolean;
  reaperTime: number;
  reaperSpeed: number;
  reaperDamage: number;
  // Arena goals (stage 3)
  killGoal: number;
  markedSpeed: number;
  // Effects
  hitFlash: number;
  shakeOnDamage: boolean;
  shakeAmplitude: number;
  shakeDuration: number;
  deathDuration: number;
  dashShake: number;
  // Chain (stage 2)
  linkRadius: number;
  /** Stage G (user 07.10.2026): R reaches the edge of a target — enemy art circle, object circle — not its center. */
  linkToEdge: boolean;
  /** Stage G: the next link is also taken within R of the hero (second anchor), not only of the last link. */
  heroAnchor: boolean;
  lineOfSight: boolean;
  /** Stage G: obstacles shrink by this much for the link sight ray — a ray grazing a tree or a wall corner still sees (0 — exact). */
  sightSlack: number;
  pickSlack: number;
  /** Stage G: a fast drag takes the links under the whole pointer path, not only under the sampled pointer events. */
  dragSweep: boolean;
  /** Stage G: while the button is held, an enemy that walks (or comes into reach) under a still pointer joins the chain. */
  holdPicks: boolean;
  /** Stage G: a short reason at the pointer why the enemy or object under it cannot be the next link. */
  refusalHint: boolean;
  /** Stage G: after the goals the hero enters the open door by touching it while walking (a chain and a jump still work). */
  doorWalkIn: boolean;
  /** Stage H (user 08.10.2026): the pointer on the second-to-last link takes the last one off; older links do nothing. */
  chainStepBack: boolean;
  /** Stage H: the pointer back on the hero cancels the chain (off: only the right button or Esc cancel). */
  cancelOnHero: boolean;
  dashSpeed: number;
  survivorKnockback: boolean;
  survivorKnockbackTime: number;
  survivorKnockbackDistance: number;
  // Focus (stage 2)
  focusSlow: number;
  focusMax: number;
  focusRegen: number;
  focusKillRefill: boolean;
  focusPerKill: number;
  focusNoDamage: boolean;
  /** Stage E (user 07.10.2026): each new link of a chain (an enemy or a crystal, once per chain) refreshes focus. */
  linkRefreshesFocus: boolean;
  /** Focus a new link gives back: 0 — to the full reserve, otherwise +N s up to the maximum. */
  focusPerLink: number;
  // Jump (stage 2)
  energyPerKill: number;
  jumpCost: number;
  jumpRadius: number;
  // Spin, key Q (stage 2 of the transition, step 3, docs/realtime-slice.md, section 6)
  /** Energy the spin costs. */
  spinCost: number;
  /** Hit of the spin on every enemy whose body touches its circle (colour and shield do not matter). */
  spinDamage: number;
  /** Radius of the spin around the hero. */
  spinRadius: number;
  // Consumables, keys 1–4 (stage 2 of the transition, step 3, docs/realtime-slice.md, section 6)
  /** Cold: radius of the circle at the pointer. */
  frostRadius: number;
  /** Cold: game seconds an enemy stays frozen. */
  frostTime: number;
  /** Cold: the next chain hit on a frozen enemy is multiplied by this. */
  frostFactor: number;
  /** Bomb: damage to the enemy under the pointer. */
  bombDamage: number;
  /** Bomb: the enemy must be within this distance of the hero. */
  bombRange: number;
  /** Healing: HP restored (the turn-based elixir +3 × RT_HP_SCALE 3 = 9, iteration 2.1; 8 = +3 × 2.4 before it). */
  itemHeal: number;
  /** Fire: radius around the enemy under the pointer within which other enemies catch fire too. */
  fireRadius: number;
  /** Fire: damage of one burn tick. */
  fireDamage: number;
  /** Fire: game seconds between ticks. */
  fireInterval: number;
  /** Fire: ticks of one burning. */
  fireTicks: number;
  /** Sandbox only: consumables of each kind an arena of the sandbox starts with (a run carries its own). */
  sandboxItems: number;
  // Elites (stage 2 of the transition, step 3, docs/realtime-slice.md, section 7)
  /** HP of an elite: the enemy's HP × this (a weak one, 0 HP, gets 1). */
  eliteHpFactor: number;
  /** Extra damage of every hit of an elite on the hero: touch, arrow, charge, its blast, its quills. */
  eliteDamageBonus: number;
  /** Art of an elite (drawing, the link reach edge, the press circle) × this; its body stays. */
  eliteArtScale: number;
  /** Chance that the loot of an elite killed by the player is a consumable open in the run; otherwise a crafting resource. */
  eliteLootChance: number;
  /** The loot falls within this radius of the kill (off obstacles, objects and the rest of the dash). */
  eliteLootRadius: number;
  /** Random elites: chance that a newcomer is an elite before the goals, and after them. */
  eliteChance: number;
  eliteChanceAfter: number;
  /** Random elites: none while this many elites live (start ones counted) — before the goals, and after them. */
  eliteCap: number;
  eliteCapAfter: number;
  /** Sandbox: random elites among the newcomers (a run turns them on from its row 3). */
  eliteSandbox: boolean;
  /**
   * Phase A, T4 (docs/realtime-phase-a.md, section 2): affixes of an elite in the sandbox (0 — the plain elite of the slice);
   * a run passes its own count by its row (`Kit.eliteAffixes`) and plays this at 0 (`RUN_FORCED`). Journals without the
   * value: 0. The numbers below act only on elites with affixes.
   */
  eliteAffixes: number;
  /** «Огненный»: a trail point every this many units of its path; its radius; game seconds it burns. */
  trailStep: number;
  trailRadius: number;
  trailLife: number;
  /** «Огненный»: damage to the hero on foot in the trail (at once, then every `trailInterval`; no elite bonus). */
  trailHeroDamage: number;
  trailInterval: number;
  /** «Огненный»: damage to an enemy in the trail (HP not below 0, never a kill), then a pause of `trailEnemyPause`. */
  trailEnemyDamage: number;
  trailEnemyPause: number;
  /** «Хамелеон»: its colour turns to the next one every `chameleonPeriod`; the last `chameleonWarn` of it is the window. */
  chameleonPeriod: number;
  chameleonWarn: number;
  /** «Стремительный»: walking × this (over the class), HP × `swiftHp` instead of the elite's ×2. */
  swiftSpeed: number;
  swiftHp: number;
  /** «Толстый»: HP × `fatHp` instead of the elite's ×2, walking × `fatSpeed`. */
  fatHp: number;
  fatSpeed: number;
  // Talismans (stage 2 of the transition, step 3, docs/realtime-slice.md, section 8)
  /** «Песочные часы»: the phase table after the goals starts this much later (the base pace goes on meanwhile). */
  hourglassDelay: number;
  /** Sandbox: a talisman an arena of the sandbox starts with (an id of run/rtTalismans.ts, '' — none); a run passes its own. */
  sandboxTalismans: string;
  // Look
  dimMode: DimMode;
  dimStrength: number;
  enemyLook: EnemyLook;
  showHitboxes: boolean;
  // Boar (stage 3)
  boarWindup: number;
  boarExclaim: boolean;
  boarRange: number;
  boarMass: number;
  boarDamage: number;
  boarKnockback: number;
  boarHp: number;
  boarMax: number;
  boarTrigger: number;
  boarChargeSpeed: number;
  boarRest: number;
  boarCooldown: number;
  // Shieldbearer (stage 2 of the transition, docs/realtime-slice.md, section 4)
  shieldHp: number;
  /** Width of the shield arc in front of it, degrees: a link whose anchor stands in it cannot be taken. */
  shieldArc: number;
  /** How fast the shield turns (to its wandering direction, or to the hero with `shieldFollowsHero`), degrees per game second. */
  shieldTurn: number;
  /** Walking speed multiplier of the shieldbearer. */
  shieldSpeed: number;
  /**
   * Iteration 2.1 (08.10.2026): the shield wanders — every `shieldWanderMin`…`shieldWanderMax` game seconds (uniform) the
   * bearer picks a new random direction (stream `behavior:shield`) and turns the shield to it at `shieldTurn`.
   */
  shieldWanderMin: number;
  shieldWanderMax: number;
  /** Sandbox: the old shield (stage 2, step 2) — it turns to the hero. Off by default; a run forces it off (`RUN_FORCED`). */
  shieldFollowsHero: boolean;
  // Archer (stage 2 of the transition, docs/realtime-slice.md, section 4)
  archerHp: number;
  /** Nearer than this to the hero the archer backs away. */
  archerNear: number;
  /** Farther than this from the hero the archer walks up. */
  archerFar: number;
  /** One announced line every … game seconds (the announcement is part of it). */
  archerCooldown: number;
  /** The line is announced this long before the arrow flies. */
  archerWindup: number;
  /** Game seconds after appearing before the first line can be announced. */
  archerFirstDelay: number;
  /** Length of the line. */
  archerRange: number;
  /** Width of the line. */
  archerWidth: number;
  /** Damage of the arrow to the hero. */
  archerDamage: number;
  /** Hit of the arrow on an enemy on the line. */
  archerHit: number;
  // Sapper (stage 2 of the transition, docs/realtime-slice.md, section 4)
  sapperHp: number;
  /** Fuse after its death, game seconds. */
  sapperFuse: number;
  /** Fuse it lights itself when it touches the hero. */
  sapperTouchFuse: number;
  /** Radius of the blast. */
  sapperRadius: number;
  /** Damage of the blast (the hero and enemies). */
  sapperDamage: number;
  // Porcupine (stage 2 of the transition, docs/realtime-slice.md, section 4)
  porcupineHp: number;
  /** Damage of the quills to the hero for every chain hit on a porcupine (invulnerability does not protect). */
  porcupineQuills: number;
  /**
   * Iteration 2.1 (08.10.2026): the quills go up and down in a cycle — up `porcupineUpTime`, down `porcupineDownTime` game
   * seconds, the start phase random (stream `behavior:porcupine`); `porcupineWarn` seconds before they go up they tremble.
   * Down time 0 — always up (the quills of step 2); up time 0 — never up.
   */
  porcupineUpTime: number;
  porcupineDownTime: number;
  porcupineWarn: number;
  // Wolf ring (stage 3a, step 3, docs/realtime-stage3.md, П1 and section 10)
  /**
   * The wolves' ring: they come up to `wolfRingRadius`, spread around the hero at equal angles; `wolfRushPack` of them in
   * the ring howl `wolfHowl` s, then all rush at once along a line fixed at the end of the howl. Off — the wolf of the
   * prototype (walks straight at the hero); journals without this value replay without the ring. A run forces it on.
   */
  wolfRing: boolean;
  wolfRingRadius: number;
  /** A wolf this much farther than the ring radius (and nearer) counts as one in the ring. */
  wolfRingSlack: number;
  /** A wolf within this many degrees of its slot stands at it; the pack howls once `wolfRushPack` of them do. */
  wolfRingSettle: number;
  wolfRushPack: number;
  wolfHowl: number;
  wolfRushSpeed: number;
  wolfRushRange: number;
  /** After the rush the wolf walks back out to the ring for this long. */
  wolfBack: number;
  /** A wolf alone in the ring (fewer than `wolfRushPack`) howls and rushes by itself after this long. */
  wolfLoneWait: number;
  // Lynx (stage 3a, step 4, П2)
  lynxHp: number;
  /** × the enemy speed of the pace. */
  lynxSpeed: number;
  /** It announces a leap when the hero is this close and in sight. */
  lynxTrigger: number;
  lynxWindup: number;
  lynxRange: number;
  lynxLeapTime: number;
  lynxDamage: number;
  lynxStun: number;
  /** From the end of the stun to the next possible announcement. */
  lynxCooldown: number;
  lynxFirstDelay: number;
  /** Mass in the leap (it shoves the crowd, as the charging boar). */
  lynxMass: number;
  // Shaman (stage 3a, step 4, П4)
  shamanHp: number;
  /** × the enemy speed of the pace. */
  shamanSpeed: number;
  shamanNear: number;
  shamanFar: number;
  /** One beam every … game seconds (the beam is part of it). */
  shamanCooldown: number;
  shamanBeam: number;
  /** It picks a weak enemy (0 HP) within this radius of itself. */
  shamanRadius: number;
  /** HP the target gets at the end of the beam. */
  shamanEmpowerHp: number;
  /** The first beam after appearing: uniform in [min, max] (stream `behavior:shaman`), so shamans standing together do not beam at once. */
  shamanFirstMin: number;
  shamanFirstMax: number;
}

export type ScalarKey = Exclude<keyof Params, 'phases'>;
export type ParamKey = keyof Params;

/** Stage that introduced the value: 1–3 — stages of the first build, 4 — iteration 2, 5 — stage 2 of the transition (the slice). */
interface BaseDef { key: ScalarKey; label: string; group: string; stage: 1 | 2 | 3 | 4 | 5; hint?: string }
export interface NumberDef extends BaseDef { kind: 'number'; min: number; max: number; step: number; unit?: string }
export interface BoolDef extends BaseDef { kind: 'bool' }
export interface ChoiceDef extends BaseDef { kind: 'choice'; options: readonly { value: string; label: string }[] }
export type ParamDef = NumberDef | BoolDef | ChoiceDef;

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  heroHp: 15,
  heroHitFactor: 0.7,
  contactDamage: 1,
  invulnerabilityMode: 'constant',
  chainShield: 0.5,
  chainShieldMinKills: 1,
  invulnerability: 0.5,
  touchFactor: 0.8,
  brakeStrength: 0.8,
  brakeRecovery: 0.8,
  heroSpeed: 4,
  heroThroughEnemies: true,
  crowdSlow: 0.7,
  enemyRadius: 0.45,
  bodyRadius: 0.4,
  enemyScale: 0.8,
  enemySpeed: 1.2,
  speedSpread: 0.35,
  // Баланс (phase A, T1, 09.10.2026): slow ×0.7, fast ×1.4 of the pace's enemy speed.
  speedClasses: true,
  speedSlow: 0.7,
  speedFast: 1.4,
  pathfinding: true,
  flowRate: 4,
  flowTurn: 8,
  flowDensity: false,
  flowDensityCost: 2,
  waterSlow: 0.5,
  // Баланс: stage 3a, section 2 — thorns 1 HP every 1 s, enemies ×0.7; brazier +2, out for 6 s.
  thornDamage: 1,
  thornInterval: 1,
  thornSlow: 0.7,
  brazierPower: 2,
  brazierCooldown: 6,
  // Баланс: design answer 09.10.2026 — a blast throws the survivors 0.8 (as the survivor knockback of the chain).
  blastPush: 0.8,
  crystals: true,
  crystalEvery: 6,
  crystalLife: 0,
  crystalScorePerKill: 20,
  crystalDropRadius: 4,
  comboCounter: true,
  hitstop: true,
  hitstopMin: 0.02,
  hitstopMax: 0.04,
  hitstopGrowth: 0.002,
  finisher: true,
  finisherLinks: 10,
  finisherTime: 0.3,
  finisherSlow: 0.2,
  chainScoreMultiplier: true,
  scorePerKill: 10,
  scoreLengthBonus: 0.1,
  sound: true,
  soundVolume: 0.3,
  wolfSpeed: 1.6,
  wolfPackMin: 3,
  wolfPackMax: 4,
  wolfPackRadius: 2,
  wolfPackBonus: 1,
  wolfPackMono: false,
  baseFloor: 28,
  baseIntervalMin: 3,
  baseIntervalMax: 5,
  baseToughShare: 0.2,
  baseWolfShare: 0.15,
  baseBoarShare: 0.05,
  phases: DEFAULT_PHASES.map(p => ({ ...p })),
  groupMin: 2,
  groupMax: 4,
  spawnPlace: 'edges',
  groupColor: 'mixed',
  maxEnemies: 60,
  markerDelay: 1,
  spawnMinDistance: 3,
  angerTierSeconds: 30,
  angerSpeedStep: 0,
  reaperEnabled: false,
  reaperTime: 130,
  reaperSpeed: 2.5,
  reaperDamage: 3,
  killGoal: 30,
  markedSpeed: 0.5,
  hitFlash: 0.1,
  shakeOnDamage: true,
  shakeAmplitude: 5,
  shakeDuration: 0.1,
  deathDuration: 0.5,
  dashShake: 3,
  linkRadius: 1.875,
  linkToEdge: true,
  // Stage 1 of the transition (user 08.10.2026, docs/realtime-transition.md, decision 3): the hero anchor becomes a
  // talisman; the base rule takes the next link only within R of the last link. Stage 2, step 3: the talisman «Якорь у героя»
  // turns it on in a run (chain.ts `heroAnchorOn`); the panel toggle stays for the sandbox.
  heroAnchor: false,
  lineOfSight: true,
  sightSlack: 0.1,
  dragSweep: true,
  holdPicks: true,
  refusalHint: true,
  doorWalkIn: true,
  chainStepBack: true,
  cancelOnHero: false,
  // 0.36 × 1.65 ≈ 0.59: the press circle of the stage before the enemies shrank (design 07.10.2026: no more misses).
  pickSlack: 1.65,
  dashSpeed: 12,
  survivorKnockback: false,
  survivorKnockbackTime: 0.12,
  survivorKnockbackDistance: 0.8,
  focusSlow: 0.25,
  focusMax: 3,
  focusRegen: 1,
  focusKillRefill: false,
  focusPerKill: 0.3,
  focusNoDamage: false,
  linkRefreshesFocus: true,
  focusPerLink: 0,
  energyPerKill: 0.5,
  jumpCost: 2,
  jumpRadius: 3,
  // Баланс: section 6 — the spin costs 3 energy and hits 4 within 1.2 of the hero.
  spinCost: 3,
  spinDamage: 4,
  spinRadius: 1.2,
  // Баланс: section 6 — cold 1.5 / 3 s / ×2, bomb 6 within 5, healing +8 (rtHp(3)), fire 1 every 1.5 s three times, radius 1.
  frostRadius: 1.5,
  frostTime: 3,
  frostFactor: 2,
  bombDamage: 6,
  bombRange: 5,
  itemHeal: 9,
  fireRadius: 1,
  fireDamage: 1,
  fireInterval: 1.5,
  fireTicks: 3,
  sandboxItems: 3,
  // Баланс: section 7 — HP ×2, art ×1.25, touch +1, loot 50% a consumable; random elites 3% / 12%, at most 2 / 4.
  eliteHpFactor: 2,
  eliteDamageBonus: 1,
  eliteArtScale: 1.25,
  eliteLootChance: 0.5,
  eliteLootRadius: 1.5,
  eliteChance: 0.03,
  eliteChanceAfter: 0.12,
  eliteCap: 2,
  eliteCapAfter: 4,
  eliteSandbox: false,
  // Баланс (phase A, T4, 09.10.2026; starting numbers, balance after the playtest).
  eliteAffixes: 0,
  trailStep: 0.4,
  trailRadius: 0.4,
  trailLife: 3,
  trailHeroDamage: 1,
  trailInterval: 1,
  trailEnemyDamage: 1,
  trailEnemyPause: 1,
  chameleonPeriod: 4,
  chameleonWarn: 0.6,
  swiftSpeed: 1.4,
  swiftHp: 1,
  fatHp: 3,
  fatSpeed: 0.7,
  // Баланс: section 8 — «Песочные часы» 10 s.
  hourglassDelay: 10,
  sandboxTalismans: '',
  dimMode: 'alpha',
  dimStrength: 0.65,
  enemyLook: 'circle',
  showHitboxes: false,
  boarWindup: 1,
  boarExclaim: true,
  boarRange: 4,
  boarMass: 5,
  boarDamage: 2,
  boarKnockback: 1.5,
  boarHp: 2,
  boarMax: 3,
  boarTrigger: 5,
  boarChargeSpeed: 8,
  boarRest: 0.8,
  boarCooldown: 3,
  shieldHp: 1,
  shieldArc: 120,
  shieldTurn: 90,
  shieldSpeed: 0.8,
  shieldWanderMin: 2,
  shieldWanderMax: 4,
  shieldFollowsHero: false,
  archerHp: 0,
  archerNear: 4,
  archerFar: 6,
  archerCooldown: 3,
  archerWindup: 1,
  archerFirstDelay: 1,
  archerRange: 7,
  archerWidth: 0.5,
  archerDamage: 1,
  archerHit: 1,
  sapperHp: 0,
  sapperFuse: 0.8,
  sapperTouchFuse: 1.2,
  sapperRadius: 1.5,
  sapperDamage: 2,
  porcupineHp: 1,
  porcupineQuills: 1,
  porcupineUpTime: 2.5,
  porcupineDownTime: 2,
  porcupineWarn: 0.5,
  wolfRing: true,
  wolfRingRadius: 3,
  wolfRingSlack: 0.75,
  wolfRingSettle: 15,
  wolfRushPack: 3,
  wolfHowl: 0.6,
  wolfRushSpeed: 6,
  wolfRushRange: 4,
  wolfBack: 1,
  wolfLoneWait: 4,
  lynxHp: 0,
  lynxSpeed: 1,
  lynxTrigger: 3.5,
  lynxWindup: 0.6,
  lynxRange: 3,
  lynxLeapTime: 0.25,
  lynxDamage: 2,
  lynxStun: 1,
  lynxCooldown: 3,
  lynxFirstDelay: 0.6,
  lynxMass: 5,
  shamanHp: 1,
  shamanSpeed: 0.7,
  shamanNear: 5,
  shamanFar: 6,
  shamanCooldown: 6,
  shamanBeam: 1.5,
  shamanRadius: 3,
  shamanEmpowerHp: 2,
  shamanFirstMin: 2,
  shamanFirstMax: 6,
});

const n = (key: ScalarKey, group: string, label: string, min: number, max: number, step: number, stage: 1 | 2 | 3 | 4 | 5 = 1, unit?: string, hint?: string): NumberDef =>
  ({ kind: 'number', key, group, label, min, max, step, stage, unit, hint });

export const PARAM_DEFS: readonly ParamDef[] = [
  n('heroHp', 'Герой и урон', 'HP героя', 1, 40, 1),
  n('heroHitFactor', 'Герой и урон', 'Круг героя, доля радиуса тела врага', 0.2, 2, 0.05, 1, '×', 'Хитбокс героя в пользу игрока (≈ 0,7 радиуса врага).'),
  n('contactDamage', 'Герой и урон', 'Урон касания', 0, 5, 1),
  { kind: 'choice', key: 'invulnerabilityMode', group: 'Герой и урон', label: 'Неуязвимость', stage: 1,
    hint: 'По доле HP (Brotato): (урон ÷ макс. HP) ÷ 0,15 × 0,4 с, в пределах 0,2–0,4 с.',
    options: [{ value: 'constant', label: 'постоянная' }, { value: 'byDamage', label: 'по доле HP' }] },
  n('invulnerability', 'Герой и урон', 'Постоянная неуязвимость', 0, 2, 0.05, 1, 'с'),
  n('chainShield', 'Герой и урон', 'Неуязвимость после цепи', 0, 1.5, 0.05, 2, 'с', 'После цепи, убившей врага: шанс выйти из толпы ходьбой. Новая заменяет остаток.'),
  n('chainShieldMinKills', 'Герой и урон', 'Мин. убийств цепи для неуязвимости', 1, 10, 1, 2),
  n('touchFactor', 'Герой и урон', 'Касание: доля радиуса тела врага', 0.3, 1.2, 0.05, 1, '×', 'Враг ранит, когда его тело, уменьшенное до этой доли, касается круга героя. На этом расстоянии враг упирается в героя.'),
  n('brakeStrength', 'Герой и урон', 'Торможение после удара', 0, 1, 0.05, 1, '×', 'Ударивший враг теряет эту долю скорости и разгоняется заново.'),
  n('brakeRecovery', 'Герой и урон', 'Разгон после удара', 0, 3, 0.05, 1, 'с'),
  n('heroSpeed', 'Перемещение', 'Скорость героя (WASD, стрелки)', 0, 10, 0.25, 4, 'ед/с', 'Свободное движение; в фокусе замедлено вместе со временем. На проходе цепи и в прыжке ввод не действует.'),
  { kind: 'bool', key: 'heroThroughEnemies', group: 'Перемещение', label: 'Сквозь врагов', stage: 4,
    hint: 'Включено (по умолчанию с этапа D): герой проходит сквозь толпу, расталкивая тела, и в толпе идёт медленнее; касание ранит. Выключено: враги — препятствие, толпа может зажать героя (выход — цепь или прыжок).' },
  n('crowdSlow', 'Перемещение', 'Замедление в толпе', 0.1, 1, 0.05, 4, '×', 'Пока круг героя перекрывает тело хотя бы одного врага (при «Сквозь врагов»), ходьба медленнее. Складывается только с водой: вода × толпа.'),
  n('enemyScale', 'Враги', 'Размер врага', 0.4, 1.5, 0.05, 4, '×', 'Множитель рисунка и тела всех врагов (кабан, волк, Жнец — тоже); зона касания и расталкивание — вместе с телом. Круг героя не меняется.'),
  n('enemyRadius', 'Враги', 'Радиус рисунка врага (при размере 1)', 0.2, 0.7, 0.01, 1, 'ед.'),
  n('bodyRadius', 'Враги', 'Радиус тела (толкание; при размере 1)', 0.15, 0.7, 0.01, 1, 'ед.'),
  n('enemySpeed', 'Враги', 'Скорость врага', 0.2, 4, 0.05, 1, 'ед/с'),
  n('speedSpread', 'Враги', 'Разброс скорости', 0, 0.6, 0.05, 1, '±'),
  { kind: 'bool', key: 'speedClasses', group: 'Враги', label: 'Классы скорости (фаза A)', stage: 5,
    hint: 'Ходьба вида = скорость врага × класс: медленные (щитоносец, дикобраз, шаман), обычные, быстрые (волк, рысь). Заменяет видовые множители. Выключено — прежние скорости видов. В походе включено всегда.' },
  n('speedSlow', 'Враги', 'Класс «медленный»', 0.1, 2, 0.05, 5, '×', 'Щитоносец, дикобраз, шаман.'),
  n('speedFast', 'Враги', 'Класс «быстрый»', 0.1, 3, 0.05, 5, '×', 'Волк, рысь (ходьба). Рывки, броски и прыжки от класса не зависят.'),
  { kind: 'bool', key: 'pathfinding', group: 'Враги', label: 'Поиск пути (поле потока)', stage: 4, hint: 'Враги обходят стены и деревья по полю потока к герою; вода дороже по замедлению. Выключено: по прямой, как в этапах 1–3, — упираются в препятствия.' },
  n('flowRate', 'Враги', 'Пересчёт поля потока', 1, 30, 1, 4, 'раз/с'),
  n('flowTurn', 'Враги', 'Плавность поворота по полю', 1, 30, 1, 4, '1/с', 'Чем больше, тем резче враг поворачивает к направлению поля.'),
  { kind: 'bool', key: 'flowDensity', group: 'Враги', label: 'Штраф за плотность (поле потока)', stage: 4,
    hint: 'Клетка с врагами дороже: толпа растекается по обходным путям, а не стоит очередью в узком месте. Поле пересчитывается и когда герой стоит.' },
  n('flowDensityCost', 'Враги', 'Штраф за врага в клетке', 0, 5, 0.1, 4, '', 'Добавка к стоимости клетки поля за каждого врага в ней (клетка травы стоит 1).'),
  n('waterSlow', 'Местность', 'Скорость в воде', 0.1, 1, 0.05, 4, '×', 'Пруд и река проходимы: ходьба героя и врагов в воде медленнее (рывок кабана, проход цепи и прыжок — нет). Поле потока считает клетку воды дороже во столько же раз.'),
  n('thornDamage', 'Местность', 'Терновник: урон герою', 0, 5, 1, 5, 'HP', 'Герой на ногах в терновнике: укол при входе и далее раз в интервал. Проход цепи и прыжок не колются; неуязвимость пропускает укол.'),
  n('thornInterval', 'Местность', 'Терновник: интервал уколов', 0.2, 3, 0.1, 5, 'с'),
  n('thornSlow', 'Местность', 'Терновник: скорость врагов', 0.1, 1, 0.05, 5, '×', 'Враги идут сквозь терновник медленнее, без урона. Поле потока считает клетку терновника дороже во столько же раз.'),
  n('brazierPower', 'Местность', 'Жаровня: сила остатку цепи', 0, 6, 1, 5, '', 'Жаровня — звено любого цвета, цвет цепи не меняет; звенья после неё получают столько силы.'),
  n('brazierCooldown', 'Местность', 'Жаровня: гаснет на', 0, 20, 0.5, 5, 'с'),
  n('blastPush', 'Местность', 'Взрыв отбрасывает', 0, 3, 0.1, 5, 'ед.', 'Выживших во взрыве врагов (не героя) отбрасывает от центра; отброшенный в обрыв гибнет (зачёт — как у взрыва). 0 — взрыв не отбрасывает (как до этапа 3а).'),
  { kind: 'bool', key: 'crystals', group: 'Кристаллы', label: 'Кристаллы смены цвета', stage: 4,
    hint: 'На каждом N-м убийстве одной цепью падает кристалл в случайной точке вне оставшегося пути цепи. Кристалл — звено любого цвета: меняет цвет цепи, силы не даёт, убийством не считается.' },
  n('crystalEvery', 'Кристаллы', 'Кристалл за каждые … убийств цепи', 2, 20, 1, 4),
  n('crystalLife', 'Кристаллы', 'Срок жизни кристалла', 0, 120, 5, 4, 'с', '0 — лежит, пока цепь его не разобьёт.'),
  n('crystalScorePerKill', 'Кристаллы', 'Очки за кристалл, × убийств породившей цепи', 0, 100, 5, 4),
  n('crystalDropRadius', 'Кристаллы', 'Радиус падения от места убийства', 0, 16, 0.5, 4, 'ед.', '0 — вся арена. Кристалл рядом с кучей продолжает комбо.'),
  { kind: 'bool', key: 'comboCounter', group: 'Сок цепи', label: 'Счётчик комбо у героя', stage: 4 },
  { kind: 'bool', key: 'hitstop', group: 'Сок цепи', label: 'Остановка кадра на убийстве', stage: 4 },
  n('hitstopMin', 'Сок цепи', 'Остановка: первое убийство', 0, 0.1, 0.005, 4, 'с'),
  n('hitstopMax', 'Сок цепи', 'Остановка: не дольше', 0, 0.2, 0.005, 4, 'с'),
  n('hitstopGrowth', 'Сок цепи', 'Остановка: прибавка за убийство', 0, 0.02, 0.001, 4, 'с'),
  { kind: 'bool', key: 'finisher', group: 'Сок цепи', label: 'Добивание: замедление и вспышка', stage: 4 },
  n('finisherLinks', 'Сок цепи', 'Добивание: от … убийств', 2, 40, 1, 4),
  n('finisherTime', 'Сок цепи', 'Добивание: замедление', 0, 2, 0.05, 4, 'с'),
  n('finisherSlow', 'Сок цепи', 'Добивание: скорость мира', 0.02, 1, 0.02, 4, '×'),
  { kind: 'bool', key: 'chainScoreMultiplier', group: 'Сок цепи', label: 'Очки с множителем длины', stage: 4,
    hint: 'Очки цепи = очки за убийство × K × (1 + бонус × K), K — убийства цепи. Выключено: очки за убийство × K.' },
  n('scorePerKill', 'Сок цепи', 'Очки за убийство', 0, 100, 1, 4),
  n('scoreLengthBonus', 'Сок цепи', 'Бонус длины за убийство', 0, 1, 0.01, 4),
  { kind: 'bool', key: 'sound', group: 'Сок цепи', label: 'Звук удара (тон растёт по цепи)', stage: 4 },
  n('soundVolume', 'Сок цепи', 'Громкость', 0, 1, 0.05, 4),
  n('baseFloor', 'До целей', 'Пол плотности', 0, 150, 1, 4, 'живых', 'Если врагов вместе с метками и очередью меньше, недостающие сразу встают в очередь меток (не больше предела арены).'),
  n('baseIntervalMin', 'До целей', 'Интервал групп: от', 0.2, 20, 0.1, 1, 'с'),
  n('baseIntervalMax', 'До целей', 'Интервал групп: до', 0.2, 20, 0.1, 1, 'с'),
  n('baseToughShare', 'До целей', 'Доля крепких', 0, 1, 0.05),
  n('baseWolfShare', 'До целей', 'Доля стай волков (групп)', 0, 1, 0.05, 3, '', 'Доля групп, которые приходят стаей волков.'),
  n('baseBoarShare', 'До целей', 'Доля кабанов', 0, 1, 0.01, 3, '', 'Доля кабанов среди прочих новых врагов (не больше «Кабанов на арене»).'),
  n('groupMin', 'Появление', 'Группа: от', 1, 10, 1),
  n('groupMax', 'Появление', 'Группа: до', 1, 10, 1),
  { kind: 'choice', key: 'spawnPlace', group: 'Появление', label: 'Место', stage: 1,
    options: [{ value: 'edges', label: 'только края' }, { value: 'edgesAndInside', label: 'края + кучки внутри' }] },
  { kind: 'choice', key: 'groupColor', group: 'Появление', label: 'Цвет группы', stage: 1,
    options: [{ value: 'mixed', label: 'смешанный' }, { value: 'mono', label: 'одноцветный' }] },
  n('maxEnemies', 'Появление', 'Предел врагов на арене', 1, 150, 1, 1, '', 'При пределе новые ждут в очереди меток.'),
  n('markerDelay', 'Появление', 'Задержка метки', 0, 3, 0.1, 1, 'с'),
  n('spawnMinDistance', 'Появление', 'Запретный радиус у героя', 0, 6, 0.25, 1, 'ед.'),
  n('angerSpeedStep', 'Время', 'Рост скорости за ступень', 0, 0.5, 0.01, 1, '', 'По умолчанию 0: быстрых даёт состав фаз.'),
  n('angerTierSeconds', 'Время', 'Ступень роста скорости', 5, 120, 5, 1, 'с'),
  { kind: 'bool', key: 'reaperEnabled', group: 'Время', label: 'Жнец (после целей)', stage: 1 },
  n('reaperTime', 'Время', 'Жнец: через … после целей', 10, 600, 5, 1, 'с'),
  n('reaperSpeed', 'Время', 'Скорость Жнеца', 0.5, 6, 0.1, 1, 'ед/с'),
  n('reaperDamage', 'Время', 'Урон касания Жнеца', 0, 12, 1),
  n('killGoal', 'Арены', 'Арена «Убить N»: врагов', 1, 200, 1, 3, '', 'Цель первой арены: после стольких убийств цепью открывается дверь и начинается стадия жадности.'),
  n('markedSpeed', 'Арены', 'Скорость отмеченных', 0, 2, 0.05, 3, '×', 'Отмеченные враги третьей арены идут медленнее толпы и не сразу сбиваются в кучу.'),
  { kind: 'bool', key: 'chainStepBack', group: 'Цепь', label: 'Откат на шаг', stage: 2,
    hint: 'Курсор на предпоследнем звене снимает последнее; более старые звенья ничего не делают. Выкл. — обрезка до любого звена.' },
  { kind: 'bool', key: 'cancelOnHero', group: 'Цепь', label: 'Отмена наведением на героя', stage: 2,
    hint: 'Выкл. — цепь отменяют только правая кнопка и Esc (с якорем у героя курсор часто проходит рядом с ним).' },
  { kind: 'bool', key: 'doorWalkIn', group: 'Арены', label: 'Вход в дверь ходьбой', stage: 4,
    hint: 'После целей касание открытой двери телом героя — победа. Цепью и прыжком — как раньше. Закрытая дверь — не препятствие и ничего не делает.' },
  n('hitFlash', 'Эффекты', 'Вспышка попадания', 0, 0.5, 0.02, 1, 'с'),
  { kind: 'bool', key: 'shakeOnDamage', group: 'Эффекты', label: 'Тряска при уроне', stage: 1 },
  n('shakeAmplitude', 'Эффекты', 'Тряска: сила', 0, 20, 1, 1, 'px'),
  n('shakeDuration', 'Эффекты', 'Тряска: длительность', 0, 0.5, 0.02, 1, 'с'),
  n('deathDuration', 'Эффекты', 'Смерть врага: оборот и сжатие', 0, 2, 0.05, 2, 'с'),
  n('dashShake', 'Эффекты', 'Тряска при проходе цепи', 0, 10, 1, 2, 'px'),
  n('linkRadius', 'Цепь', 'Радиус звена R', 0.5, 4, 0.025, 2, 'ед.', 'Круг R тонко виден вокруг героя всегда; при выделении цепи — ещё вокруг последнего звена.'),
  { kind: 'bool', key: 'linkToEdge', group: 'Цепь', label: 'R до края тела', stage: 4,
    hint: 'Враг берётся, если круг R касается его рисунка (центр не дальше R + радиус рисунка); кнопка, дверь, кристалл — до края их круга. Выключено: до центра.' },
  { kind: 'bool', key: 'heroAnchor', group: 'Цепь', label: 'Якорь у героя', stage: 4,
    hint: 'Только песочница: следующее звено берётся в R от последнего звена ИЛИ в R от героя. В походе якорь даёт только талисман «Якорь у героя».' },
  { kind: 'bool', key: 'lineOfSight', group: 'Цепь', label: 'Препятствия рвут звено', stage: 2 },
  n('sightSlack', 'Цепь', 'Допуск видимости у края препятствия', 0, 0.3, 0.01, 4, 'ед.', 'Для луча звена деревья и стены сужены на столько: луч, задевший край ствола или угол стены, не рвёт звено. 0 — точно.'),
  n('pickSlack', 'Цепь', 'Запас нажатия по врагу', 1, 2.5, 0.05, 2, '× рисунка'),
  { kind: 'bool', key: 'dragSweep', group: 'Цепь', label: 'Протяжка по всему пути мыши', stage: 4,
    hint: 'Быстрое движение мыши берёт звенья вдоль всего пути, а не только в точках событий мыши.' },
  { kind: 'bool', key: 'holdPicks', group: 'Цепь', label: 'Взятие под неподвижной мышью', stage: 4,
    hint: 'Пока кнопка зажата, враг, подошедший под курсор или вошедший в R, добавляется без движения мыши (только добавление, без обрезки).' },
  { kind: 'bool', key: 'refusalHint', group: 'Цепь', label: 'Подсказка: почему не берётся', stage: 4,
    hint: 'У курсора над врагом или объектом, который нельзя взять следующим звеном: «далеко», «не тот цвет», «нет видимости», «после выжившего»…' },
  n('dashSpeed', 'Цепь', 'Скорость прохода', 2, 40, 0.5, 2, 'ед/с'),
  { kind: 'bool', key: 'survivorKnockback', group: 'Цепь', label: 'Отброс выживших после удара', stage: 2 },
  n('survivorKnockbackTime', 'Цепь', 'Отброс выживших: время', 0, 0.5, 0.01, 2, 'с'),
  n('survivorKnockbackDistance', 'Цепь', 'Отброс выживших: расстояние', 0, 3, 0.05, 2, 'ед.'),
  n('focusSlow', 'Фокус', 'Замедление в фокусе', 0.02, 1, 0.01, 2, '×'),
  n('focusMax', 'Фокус', 'Запас фокуса', 0, 10, 0.1, 2, 'с'),
  n('focusRegen', 'Фокус', 'Восстановление', 0, 5, 0.1, 2, 'с/с'),
  { kind: 'bool', key: 'focusKillRefill', group: 'Фокус', label: 'Восстановление за убийства', stage: 2 },
  n('focusPerKill', 'Фокус', 'Фокус за убийство', 0, 2, 0.05, 2, 'с'),
  { kind: 'bool', key: 'linkRefreshesFocus', group: 'Фокус', label: 'Звено обновляет фокус', stage: 2,
    hint: 'Каждое новое звено цепи (враг или кристалл) восстанавливает фокус — один раз за цепь; кнопка и дверь — нет.' },
  n('focusPerLink', 'Фокус', 'Сколько восстанавливает звено', 0, 3, 0.1, 2, 'с', '0 — до полного запаса.'),
  { kind: 'bool', key: 'focusNoDamage', group: 'Фокус', label: 'В фокусе враги не ранят', stage: 2 },
  n('energyPerKill', 'Прыжок', 'Энергия за врага', 0, 3, 0.1, 2),
  n('jumpCost', 'Прыжок', 'Цена прыжка', 0, 10, 0.5, 2),
  n('jumpRadius', 'Прыжок', 'Радиус прыжка', 0.5, 8, 0.25, 2, 'ед.'),
  n('spinCost', 'Круговой удар', 'Цена кругового удара (Q)', 0, 7, 0.5, 5, '', 'Не во время прохода цепи и прыжка; во время выделения цепи — можно.'),
  n('spinDamage', 'Круговой удар', 'Удар по врагу', 0, 12, 1, 5, '', 'Всем врагам, чьё тело касается круга: цвет и щит не учитываются. Убийства засчитываются; энергии, кристаллов и игл дикобраза нет.'),
  n('spinRadius', 'Круговой удар', 'Радиус', 0.25, 4, 0.05, 5, 'ед.'),
  n('frostRadius', 'Расходники', 'Холод (1): радиус у курсора', 0.25, 4, 0.05, 5, 'ед.', 'Расходники — клавиши 1–4, цель под курсором; не во время прохода цепи и прыжка, во время выделения — можно.'),
  n('frostTime', 'Расходники', 'Холод: заморозка', 0.5, 10, 0.5, 5, 'с', 'Замёрзший стоит, не ранит касанием, его механика выключена (щит, выстрел, фитиль живого сапёра, иглы).'),
  n('frostFactor', 'Расходники', 'Холод: следующий удар цепи по замёрзшему', 1, 4, 0.5, 5, '×'),
  n('bombDamage', 'Расходники', 'Бомба (2): урон врагу под курсором', 0, 20, 1, 5),
  n('bombRange', 'Расходники', 'Бомба: не дальше от героя', 1, 16, 0.25, 5, 'ед.'),
  n('itemHeal', 'Расходники', 'Лечение (3): HP', 0, 20, 1, 5, '', 'Эликсир пошаговой игры +3 × 3 (HP похода 15 ÷ 5). Не выше максимума; при полном здоровье не тратится.'),
  n('fireRadius', 'Расходники', 'Огонь (4): радиус вокруг цели', 0, 4, 0.05, 5, 'ед.'),
  n('fireDamage', 'Расходники', 'Огонь: урон за раз', 0, 6, 1, 5),
  n('fireInterval', 'Расходники', 'Огонь: раз в', 0.1, 5, 0.1, 5, 'с'),
  n('fireTicks', 'Расходники', 'Огонь: сколько раз', 1, 10, 1, 5),
  n('sandboxItems', 'Расходники', 'Песочница: расходников каждого вида на старте арены', 0, 9, 1, 5, '', 'Только песочница: в походе количество переносится между аренами.'),
  n('eliteHpFactor', 'Элиты', 'HP элиты', 1, 5, 0.5, 5, '×', 'Слабый враг (0 HP) — 1.'),
  n('eliteDamageBonus', 'Элиты', 'Урон элиты герою: прибавка', 0, 5, 1, 5, '', 'К любому урону элиты герою: касание, стрела, рывок, взрыв сапёра-элиты, иглы дикобраза-элиты.'),
  n('eliteArtScale', 'Элиты', 'Рисунок элиты', 1, 2, 0.05, 5, '×', 'Рисунок, край для R и круг нажатия; тело то же.'),
  n('eliteLootChance', 'Элиты', 'Добыча элиты шаблона: шанс', 0, 1, 0.05, 5, '', 'Элита шаблона арены, убитая игроком: с этим шансом расходник из открытых в походе (нет открытых — ресурс), иначе ничего. Случайная элита — всегда ресурс.'),
  n('eliteLootRadius', 'Элиты', 'Добыча падает в радиусе', 0, 4, 0.25, 5, 'ед.', 'Вне оставшегося пути цепи; подбирается цепью (как кристалл) или касанием.'),
  n('eliteChance', 'Элиты', 'Случайная элита до целей', 0, 0.5, 0.01, 5, '', 'Доля новичков-элит. В походе — с ряда 3.'),
  n('eliteChanceAfter', 'Элиты', 'Случайная элита после целей', 0, 0.5, 0.01, 5),
  n('eliteCap', 'Элиты', 'Не больше элит до целей', 0, 10, 1, 5),
  n('eliteCapAfter', 'Элиты', 'Не больше элит после целей', 0, 10, 1, 5),
  n('eliteAffixes', 'Элиты', 'Аффиксы элит', 0, 3, 1, 5, '', 'Только песочница: столько аффиксов у каждой новой элиты. В походе — по ряду: 1–4 — 0, 5–8 — 1, 9 — 2.'),
  n('trailStep', 'Элиты', 'Огненный: точка следа каждые', 0.1, 2, 0.05, 5, 'ед.'),
  n('trailRadius', 'Элиты', 'Огненный: радиус точки', 0.1, 1.5, 0.05, 5, 'ед.'),
  n('trailLife', 'Элиты', 'Огненный: след горит', 0.5, 10, 0.25, 5, 'с'),
  n('trailHeroDamage', 'Элиты', 'Огненный: урон герою', 0, 5, 1, 5, '', 'Герою пешком в следе: сразу, затем раз в интервал (как терновник); без прибавки элиты.'),
  n('trailInterval', 'Элиты', 'Огненный: интервал урона герою', 0.1, 5, 0.1, 5, 'с'),
  n('trailEnemyDamage', 'Элиты', 'Огненный: урон врагам', 0, 5, 1, 5, '', 'HP врага не ниже 0: след не убивает и игроку не засчитывается.'),
  n('trailEnemyPause', 'Элиты', 'Огненный: пауза урона врагу', 0.1, 5, 0.1, 5, 'с'),
  n('chameleonPeriod', 'Элиты', 'Хамелеон: смена цвета раз в', 0.5, 20, 0.25, 5, 'с'),
  n('chameleonWarn', 'Элиты', 'Хамелеон: окно перед сменой', 0, 3, 0.05, 5, 'с', 'Ободок мигает новым цветом; в окне берётся цепью любого цвета и принимает её цвет.'),
  n('swiftSpeed', 'Элиты', 'Стремительный: скорость', 1, 3, 0.05, 5, '×'),
  n('swiftHp', 'Элиты', 'Стремительный: HP', 1, 5, 0.5, 5, '×'),
  n('fatHp', 'Элиты', 'Толстый: HP', 1, 6, 0.5, 5, '×'),
  n('fatSpeed', 'Элиты', 'Толстый: скорость', 0.1, 1, 0.05, 5, '×'),
  { kind: 'bool', key: 'eliteSandbox', group: 'Элиты', label: 'Песочница: случайные элиты', stage: 5, hint: 'Только песочница. В походе элиты — из шаблона арены, события и случайные с ряда похода 3; этот переключатель там не действует.' },
  n('hourglassDelay', 'Талисманы', '«Песочные часы»: фазы после целей позже на', 0, 60, 1, 5, 'с', 'Пока они не начались, идёт темп до целей.'),
  { kind: 'choice', key: 'sandboxTalismans', group: 'Талисманы', label: 'Песочница: талисман на старте арены', stage: 5,
    hint: 'Только песочница (со следующей арены); в походе действуют талисманы похода. «Якорь у героя» — и переключатель «Якорь у героя» группы «Цепь».',
    options: [{ value: '', label: 'нет' }, { value: 'hero-anchor', label: 'Якорь у героя' }, { value: 'whetstone', label: 'Точильный камень' }, { value: 'millstone-shard', label: 'Осколок жернова' },
      { value: 'hourglass', label: 'Песочные часы' }, { value: 'nimble-paws', label: 'Ловкие лапы' }, { value: 'ash-ward', label: 'Пепельный оберег' }] },
  { kind: 'choice', key: 'dimMode', group: 'Вид', label: 'Приглушение не того цвета', stage: 2,
    options: [{ value: 'darken', label: 'затемнение' }, { value: 'alpha', label: 'полупрозрачность' }, { value: 'desaturate', label: 'обесцвечивание' }] },
  n('dimStrength', 'Вид', 'Сила приглушения', 0, 1, 0.05, 2),
  { kind: 'choice', key: 'enemyLook', group: 'Вид', label: 'Вид врагов', stage: 1,
    options: [{ value: 'circle', label: 'круги со знаком' }, { value: 'sprite', label: 'иллюстрация' }] },
  { kind: 'bool', key: 'showHitboxes', group: 'Вид', label: 'Показать тела и касание', stage: 1 },
  n('boarWindup', 'Кабан', 'Объявление рывка (полоса)', 0.2, 3, 0.1, 3, 'с'),
  { kind: 'bool', key: 'boarExclaim', group: 'Кабан', label: '«!» и мигание перед рывком', stage: 3 },
  n('boarRange', 'Кабан', 'Дальность рывка', 1, 10, 0.25, 3, 'ед.'),
  n('boarMass', 'Кабан', 'Масса на рывке', 1, 20, 0.5, 3, '×'),
  n('boarDamage', 'Кабан', 'Урон рывка', 0, 6, 1, 3),
  n('boarKnockback', 'Кабан', 'Отброс героя', 0, 4, 0.25, 3, 'ед.'),
  n('boarHp', 'Кабан', 'HP кабана', 0, 6, 1, 3),
  n('boarMax', 'Кабан', 'Кабанов на арене', 0, 10, 1, 3),
  n('boarTrigger', 'Кабан', 'Начинает рывок с расстояния', 1, 12, 0.25, 3, 'ед.'),
  n('boarChargeSpeed', 'Кабан', 'Скорость рывка', 2, 20, 0.5, 3, 'ед/с'),
  n('boarRest', 'Кабан', 'Стоит после рывка', 0, 3, 0.1, 3, 'с'),
  n('boarCooldown', 'Кабан', 'Перезарядка рывка', 0, 10, 0.5, 3, 'с'),
  n('wolfSpeed', 'Волк', 'Скорость волка', 0.2, 5, 0.05, 3, 'ед/с', 'Только без классов скорости (переключатель «Классы скорости» в группе «Враги»).'),
  n('wolfPackMin', 'Волк', 'Стая: от', 1, 8, 1, 3),
  n('wolfPackMax', 'Волк', 'Стая: до', 1, 8, 1, 3),
  n('wolfPackRadius', 'Волк', 'Радиус стаи', 0.5, 6, 0.25, 3, 'ед.', 'Волки ближе этого радиуса друг к другу — стая: линии между ними.'),
  n('wolfPackBonus', 'Волк', 'Урон за волка рядом', 0, 3, 1, 3, '', 'Удар волка: урон касания + столько за каждого другого волка в радиусе стаи.'),
  { kind: 'bool', key: 'wolfPackMono', group: 'Волк', label: 'Стая одного цвета', stage: 3, hint: 'Выключено: цвет волков в стае — как у групп (переключатель «Цвет группы»).' },
  n('shieldHp', 'Щитоносец', 'HP щитоносца', 0, 6, 1, 5),
  n('shieldArc', 'Щитоносец', 'Дуга щита', 0, 360, 5, 5, '°', 'Звено нельзя взять, если якорь (предыдущее звено или герой) стоит в этой дуге перед щитоносцем.'),
  n('shieldTurn', 'Щитоносец', 'Поворот щита', 0, 720, 5, 5, '°/с', 'Щит поворачивается к новому направлению (или к герою, если щит следит за ним) не быстрее этого. Герой (4 ед/с) обходит щитоносца быстрее, чем поворачивается щит.'),
  n('shieldSpeed', 'Щитоносец', 'Скорость щитоносца', 0.1, 2, 0.05, 5, '×', 'Только без классов скорости.'),
  n('shieldWanderMin', 'Щитоносец', 'Смена направления щита: от', 0.1, 20, 0.1, 5, 'с', 'Раз в случайный срок от … до … щитоносец выбирает новое случайное направление щита.'),
  n('shieldWanderMax', 'Щитоносец', 'Смена направления щита: до', 0.1, 20, 0.1, 5, 'с'),
  { kind: 'bool', key: 'shieldFollowsHero', group: 'Щитоносец', label: 'Песочница: щит следит за героем', stage: 5,
    hint: 'Только песочница: прежний щит (шаг 2) — поворачивается к герою. В походе выключен.' },
  n('archerHp', 'Лучник', 'HP лучника', 0, 6, 1, 5),
  n('archerNear', 'Лучник', 'Отходит, если герой ближе', 0, 10, 0.25, 5, 'ед.'),
  n('archerFar', 'Лучник', 'Подходит, если герой дальше', 0, 12, 0.25, 5, 'ед.'),
  n('archerCooldown', 'Лучник', 'Выстрел раз в', 0.5, 10, 0.1, 5, 'с', 'Объявление линии входит в этот срок.'),
  n('archerWindup', 'Лучник', 'Объявление линии (полоса)', 0.1, 3, 0.1, 5, 'с'),
  n('archerFirstDelay', 'Лучник', 'Первая линия: через … после появления', 0, 10, 0.1, 5, 'с'),
  n('archerRange', 'Лучник', 'Длина линии', 1, 16, 0.25, 5, 'ед.', 'Стены и деревья обрезают линию, вода — нет.'),
  n('archerWidth', 'Лучник', 'Ширина линии', 0.1, 2, 0.05, 5, 'ед.'),
  n('archerDamage', 'Лучник', 'Урон стрелы герою', 0, 6, 1, 5),
  n('archerHit', 'Лучник', 'Удар стрелы по врагу', 0, 6, 1, 5, '', 'Враг на линии гибнет, если удар не меньше его HP (слабые — всегда); иначе теряет HP. Убийства стрелой игроку не засчитываются.'),
  n('sapperHp', 'Сапёр', 'HP сапёра', 0, 6, 1, 5),
  n('sapperFuse', 'Сапёр', 'Фитиль после гибели', 0, 3, 0.05, 5, 'с'),
  n('sapperTouchFuse', 'Сапёр', 'Фитиль от касания героя', 0, 3, 0.05, 5, 'с', 'Коснувшись героя, сапёр сам поджигает фитиль и стоит; его касание не ранит — ранит взрыв.'),
  n('sapperRadius', 'Сапёр', 'Радиус взрыва', 0.25, 4, 0.05, 5, 'ед.'),
  n('sapperDamage', 'Сапёр', 'Урон взрыва', 0, 6, 1, 5, '', 'Всем в радиусе: герою (неуязвимость защищает) и врагам. Убийства взрывом сапёра, убитого игроком, засчитываются; подожжённого касанием — нет.'),
  n('porcupineHp', 'Дикобраз', 'HP дикобраза', 0, 6, 1, 5),
  n('porcupineQuills', 'Дикобраз', 'Иглы: урон герою за удар цепи', 0, 6, 1, 5, '', 'Удар цепи по дикобразу ранит героя, если иглы были подняты в момент отпускания цепи, — и на проходе, и при неуязвимости.'),
  n('porcupineUpTime', 'Дикобраз', 'Иглы подняты', 0, 10, 0.1, 5, 'с', '0 — иглы никогда не поднимаются.'),
  n('porcupineDownTime', 'Дикобраз', 'Иглы опущены', 0, 10, 0.1, 5, 'с', '0 — иглы подняты всегда (как на шаге 2).'),
  n('porcupineWarn', 'Дикобраз', 'Иглы дрожат перед подъёмом', 0, 3, 0.1, 5, 'с'),
  { kind: 'bool', key: 'wolfRing', group: 'Волк', label: 'Кольцо волков (этап 3а)', stage: 5,
    hint: 'Волки подходят на радиус кольца, расходятся по кругу вокруг героя; когда в кольце достаточно волков — вой, затем все бросаются разом. Выключено — прежний волк (идёт прямо). В походе включено всегда.' },
  n('wolfRingRadius', 'Волк', 'Кольцо: радиус', 1, 8, 0.25, 5, 'ед.'),
  n('wolfRingSlack', 'Волк', 'Кольцо: допуск', 0, 3, 0.05, 5, 'ед.', 'Волк не дальше радиуса + допуска (и видит героя) — в кольце.'),
  n('wolfRingSettle', 'Волк', 'Кольцо: волк на месте в пределах', 0, 180, 5, 5, '°', 'Стая воет, когда столько волков стоят на своих местах кольца (равные углы вокруг героя).'),
  n('wolfRushPack', 'Волк', 'Бросок: волков в кольце', 1, 8, 1, 5),
  n('wolfHowl', 'Волк', 'Вой перед броском', 0, 3, 0.05, 5, 'с', 'Круг вокруг героя. Направление броска фиксируется в конце воя.'),
  n('wolfRushSpeed', 'Волк', 'Бросок: скорость', 0.5, 20, 0.25, 5, 'ед/с', 'По прямой; вода и терновник не замедляют, стена и обрыв останавливают.'),
  n('wolfRushRange', 'Волк', 'Бросок: длина', 0.5, 10, 0.25, 5, 'ед.'),
  n('wolfBack', 'Волк', 'После броска отходит к кольцу', 0, 5, 0.1, 5, 'с'),
  n('wolfLoneWait', 'Волк', 'Одиночка бросается через', 0, 20, 0.5, 5, 'с', 'Волк в кольце, пока волков меньше, чем нужно для броска стаи.'),
  n('lynxHp', 'Рысь', 'HP рыси', 0, 6, 1, 5),
  n('lynxSpeed', 'Рысь', 'Скорость рыси', 0.1, 3, 0.05, 5, '×', 'Только без классов скорости.'),
  n('lynxTrigger', 'Рысь', 'Замирает, если герой ближе', 0.5, 10, 0.25, 5, 'ед.'),
  n('lynxWindup', 'Рысь', 'Замах (линия прыжка)', 0, 3, 0.05, 5, 'с'),
  n('lynxRange', 'Рысь', 'Длина прыжка', 0.5, 10, 0.25, 5, 'ед.', 'Стена и обрыв обрезают прыжок; вода и терновник — нет.'),
  n('lynxLeapTime', 'Рысь', 'Прыжок длится', 0.05, 2, 0.05, 5, 'с'),
  n('lynxDamage', 'Рысь', 'Урон прыжка', 0, 6, 1, 5),
  n('lynxStun', 'Рысь', 'Оглушена после прыжка', 0, 5, 0.1, 5, 'с', 'Оглушённая стоит и не ранит касанием.'),
  n('lynxCooldown', 'Рысь', 'Перезарядка прыжка', 0, 10, 0.25, 5, 'с', 'От конца оглушения.'),
  n('lynxFirstDelay', 'Рысь', 'Первый прыжок: через … после появления', 0, 10, 0.1, 5, 'с'),
  n('lynxMass', 'Рысь', 'Масса в прыжке', 1, 20, 0.5, 5, '×'),
  n('shamanHp', 'Шаман', 'HP шамана', 0, 6, 1, 5),
  n('shamanSpeed', 'Шаман', 'Скорость шамана', 0.1, 3, 0.05, 5, '×', 'Только без классов скорости.'),
  n('shamanNear', 'Шаман', 'Отходит, если герой ближе', 0, 12, 0.25, 5, 'ед.'),
  n('shamanFar', 'Шаман', 'Подходит, если герой дальше', 0, 14, 0.25, 5, 'ед.'),
  n('shamanCooldown', 'Шаман', 'Луч раз в', 0.5, 20, 0.25, 5, 'с', 'Луч входит в этот срок.'),
  n('shamanBeam', 'Шаман', 'Луч длится', 0.1, 5, 0.1, 5, 'с', 'Убить шамана или цель до конца луча — отмена. Цепь луч не рубит.'),
  n('shamanRadius', 'Шаман', 'Цель: слабый враг в радиусе', 0.5, 8, 0.25, 5, 'ед.'),
  n('shamanEmpowerHp', 'Шаман', 'HP цели после луча', 1, 6, 1, 5),
  n('shamanFirstMin', 'Шаман', 'Первый луч: от', 0, 20, 0.5, 5, 'с'),
  n('shamanFirstMax', 'Шаман', 'Первый луч: до', 0, 20, 0.5, 5, 'с'),
];

const MAX_PHASES = 8;

function sanitizePhases(raw: unknown): Phase[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PHASES.map(p => ({ ...p }));
  return raw.slice(0, MAX_PHASES).map((item, i) => {
    const src = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const base = DEFAULT_PHASES[Math.min(i, DEFAULT_PHASES.length - 1)];
    const out = { ...base };
    for (const f of PHASE_FIELDS) {
      const v = src[f.key];
      if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
    }
    return out;
  });
}

/** Clamps stored or journalled values to the panel ranges; unknown or broken values fall back to the defaults. */
export function sanitizeParams(raw: unknown): Params {
  const out: Params = { ...DEFAULT_PARAMS, phases: DEFAULT_PHASES.map(p => ({ ...p })) };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const def of PARAM_DEFS) {
    const v = src[def.key];
    if (def.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) target[def.key] = Math.min(def.max, Math.max(def.min, v));
    else if (def.kind === 'bool' && typeof v === 'boolean') target[def.key] = v;
    else if (def.kind === 'choice' && typeof v === 'string' && def.options.some(o => o.value === v)) target[def.key] = v;
  }
  out.phases = sanitizePhases(src.phases);
  return out;
}

export function defaultParams(): Params { return sanitizeParams(null); }

/**
 * Panel values that stand in for rules of the run (review finding B of step 3; design: in a run the hero anchor comes only
 * from its talisman, elites only from the arena template, the event and the random elites from run row 3): the sandbox
 * toggles «Якорь у героя», «Песочница: случайные элиты», the sandbox talisman and (iteration 2.1) «Песочница: щит следит
 * за героем». A run arena gets them off whatever the
 * saved panel holds. Stage 3a, step 3: the wolves' ring is a rule of the run — on (the sandbox may switch it off). Phase A:
 * speed classes are on; the sandbox's affix count is 0 (the run passes its own by the row, `Loadout.eliteAffixes`).
 */
export const RUN_FORCED: Readonly<Partial<Params>> = Object.freeze({ heroAnchor: false, eliteSandbox: false, sandboxTalismans: '', shieldFollowsHero: false, wolfRing: true, speedClasses: true, eliteAffixes: 0 });
/**
 * The values a run arena plays with: the saved panel with the stand-ins of run rules off (`RUN_FORCED`) and the run's own
 * numbers on top (`forced`; iteration 2.1: the healing consumable — `rtRunParams`, run/rtRun.ts).
 */
export function runParams(params: Params, forced: Readonly<Partial<Params>> = {}): Params { return Object.assign(copyParams(params), RUN_FORCED, forced); }

/** A deep copy (the journal keeps the values a run started with). */
export function copyParams(params: Params): Params { return { ...params, phases: params.phases.map(p => ({ ...p })) }; }

export function setParam(params: Params, key: ParamKey, value: unknown): void {
  const next = sanitizeParams({ ...params, [key]: value });
  (params as unknown as Record<string, unknown>)[key] = (next as unknown as Record<string, unknown>)[key];
}

export function setPhases(params: Params, phases: unknown): void { params.phases = sanitizePhases(phases); }

/**
 * Hero circle radius: a share of the enemy body at size 1 (hitbox in the player's favour).
 * Not scaled by `enemyScale`: smaller enemies leave the hero as he was (stage D).
 */
export function heroRadius(params: Params): number { return params.bodyRadius * params.heroHitFactor; }

/** Enemy body radius (pushing, obstacles, flow field clearance, touch zone): `bodyRadius × enemyScale` (stage D). */
export function enemyBodyRadius(params: Params): number { return params.bodyRadius * params.enemyScale; }

/** Enemy art radius (drawing, click zone, markers, flashes): `enemyRadius × enemyScale` (stage D). */
export function enemyDrawRadius(params: Params): number { return params.enemyRadius * params.enemyScale; }

/** Values that follow from time and the base numbers; the panel shows them live. */
export interface Pressure {
  /** Index of the current greed phase (holds at the last one); -1 before the goals (base pace). */
  phaseIndex: number;
  phase: Phase;
  /** Seconds left in the current phase (Infinity on the last one). */
  phaseLeft: number;
  angerTier: number;
  enemySpeed: number;
}

/**
 * The base pace before the goals, as a phase without an end: the panel values, or the arena template's own pace
 * (stage 1 of the transition: arenas are data) where it sets a field.
 */
export function basePhase(params: Params, arena?: ArenaTemplate): Phase {
  const own = arena?.pace;
  return {
    duration: Infinity,
    floor: own?.floor ?? params.baseFloor,
    intervalMin: own?.intervalMin ?? params.baseIntervalMin,
    intervalMax: own?.intervalMax ?? params.baseIntervalMax,
    toughShare: own?.toughShare ?? params.baseToughShare,
    wolfShare: own?.wolfShare ?? params.baseWolfShare,
    boarShare: own?.boarShare ?? params.baseBoarShare,
    ...arena?.phaseOverride,
  };
}

/**
 * Pressure at game time `time`. `greedStart` is the time the goals were completed
 * (null before): only then the phase table runs, counted from that moment.
 */
export function pressureAt(params: Params, time: number, greedStart: number | null = null, arena?: ArenaTemplate, delay = 0): Pressure {
  const angerTier = Math.floor(time / params.angerTierSeconds);
  const enemySpeed = params.enemySpeed * dpowi(1 + params.angerSpeedStep, angerTier);
  // Stage 2, step 3 («Песочные часы»): the table starts `delay` game seconds after the goals; the base pace goes on until then.
  if (greedStart !== null && delay > 0) greedStart += delay;
  if (greedStart === null || time < greedStart) return { phaseIndex: -1, phase: basePhase(params, arena), phaseLeft: Infinity, angerTier, enemySpeed };
  const own = arena?.phases;
  const phases = own && own.length ? own : params.phases.length ? params.phases : DEFAULT_PHASES;
  const t = Math.max(0, time - greedStart);
  let start = 0, phaseIndex = phases.length - 1, phaseLeft = Infinity;
  for (let i = 0; i < phases.length - 1; i++) {
    if (t < start + phases[i].duration) { phaseIndex = i; phaseLeft = start + phases[i].duration - t; break; }
    start += phases[i].duration;
  }
  const override = arena?.phaseOverride;
  return { phaseIndex, phase: override ? { ...phases[phaseIndex], ...override } : phases[phaseIndex], phaseLeft, angerTier, enemySpeed };
}

/** Rolls the interval to the next group: uniform in the phase's [min, max] (the seeded `spawnRoll` stream). */
export function rollGroupInterval(phase: Phase, rng: Rng): number {
  const lo = Math.min(phase.intervalMin, phase.intervalMax), hi = Math.max(phase.intervalMin, phase.intervalMax);
  return lo + rng.next() * (hi - lo);
}

/** Brotato rule: (damage ÷ max HP) ÷ 0.15 × 0.4 s, clamped to 0.2–0.4 s. */
export function proportionalInvulnerability(damage: number, maxHp: number): number {
  if (maxHp <= 0) return 0.4;
  return Math.min(0.4, Math.max(0.2, damage / maxHp / 0.15 * 0.4));
}

export function invulnerabilityFor(params: Params, mode: InvulnerabilityMode, damage: number, maxHp: number): number {
  return mode === 'constant' ? params.invulnerability : proportionalInvulnerability(damage, maxHp);
}

/** Seconds a hero survives standing in a crowd: every hit is followed by invulnerability. */
export function crowdLifetime(params: Params, mode: InvulnerabilityMode): number {
  if (params.contactDamage <= 0) return Infinity;
  return Math.ceil(params.heroHp / params.contactDamage) * invulnerabilityFor(params, mode, params.contactDamage, params.heroHp);
}
