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
  /**
   * «Смена цвета» (design 12.10.2026, task 4): after this many enemy links of one colour segment the drawn chain is free — the
   * next enemy link may be of any colour; it sets the colour and the count starts again (6: the 7th, 13th … link). A crystal
   * resets the colour and the count. An elite's plate hit is a link. Talismans: «Осколок жернова» −1, «Жернов» −2, not below 2
   * (build.ts `colorShiftOf`). 0 — off; a journal without the key plays the old path. A run plays 6 (`RT_RUN_FORCED`).
   */
  colorShiftLinks: number;
  /**
   * «Свобода цвета держится» (design 13.10.2026, task 10): with «Смена цвета» on, a free colour stays free while the chain
   * takes links of the same colour — they continue the segment (the count grows); only a link of another colour opens a new
   * segment. Shifts (the `colorShift` event, «Призма», the oath) at every multiple of the step within a segment (6, 12, 18…):
   * for a one-colour chain the same links as before. Off (no key) — the old path: the free link of the same colour restarts
   * the count. A run plays it on (`RT_RUN_FORCED`).
   */
  colorShiftKeep: boolean;
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
  /**
   * Loop research, step 1 (docs/realtime-loop-research.md, section 4.2): chain colours of the newcomers in the sandbox, the
   * first this many of the four and the colours of the arena's start enemies (spawn.ts `palette`). Journals without the
   * value: 4. A run plays 4 (`RUN_FORCED`); its palette by the row comes from `colorsByRow`. Task 45: up to 5 (the fifth chain
   * colour, for the view's snapshots); «Испытание VIII» gives a run 5 through the kit (`Loadout.colors`).
   */
  colorCount: number;
  /**
   * Loop research, step 1: the run's palette by its row, as in the turn-based game (decision 30.09.2026): run rows 1–2 — 2
   * colours, 3–4 — 3, from 5 — 4 (`Loadout.colors`, run/rtRun.ts `rtColorsByRow`). Off by default: the run plays 4 colours.
   */
  colorsByRow: boolean;
  maxEnemies: number;
  markerDelay: number;
  spawnMinDistance: number;
  /**
   * A queued group stays together (spawn.ts `placeQueued`; design 12.10.2026, docs/realtime-prototype.md, «Появление»): a
   * member that finds no free point at its group's anchor keeps the anchor and tries again every tick; after
   * `SPAWN_HOLD_LIMIT` (1 s of game time) the whole remaining group takes a new anchor, as it does at once when the anchor
   * goes stale. Off by default; journals without the value: off (the member drops its anchor, the path of before). A run
   * turns it on (run/rtRun.ts `RT_RUN_FORCED`); the sandbox panel has a toggle.
   */
  spawnGroupHold: boolean;
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
  /**
   * «Щит фокуса» (design 12.10.2026, playtest v34: 28 % of the damage came while drawing a chain): from this many enemy links of
   * the drawn chain on, while the focus is not empty, touches and hits do not hurt the hero (`canBeHurt`); the goblin's bust
   * still does. 0 — off; a journal without the key plays the old path. A run plays 3 (`RT_RUN_FORCED`).
   */
  focusGuardLinks: number;
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
  /**
   * Task 41 «Три зелья» (elites.ts `potionHandFull`): at most this many healing potions in hand — a healing loot is not picked up
   * while the hand holds this many (it stays on the floor; the chain refuses it, `handFull`). 0 — no cap (the default; a journal
   * without the key plays as before). A run with the flag `potionCap` passes its cap (`rtArenaParams`).
   */
  potionCap: number;
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
  /**
   * Hammer «Взрыв на конце» (sim/hammers.ts, decision of the user 11.10.2026): the blast needs a chain of at least this many
   * enemy links reached by the dash. A journal without the value (recorded before 12.10.2026) plays the old path: 1 — the
   * blast on any chain with a last enemy link. A run forces 3.
   */
  endBlastMinLinks: number;
  /**
   * Hammer «Огненный проход» (sim/hammers.ts, task 31, decision of the user 15.10.2026): the path of the dash lights only when
   * the dash reaches this many enemy links (counted as `endBlastMinLinks`) — then the whole path from the start of the dash at
   * once. A journal without the value (recorded before 15.10.2026) plays the old path: the fire from the release on any chain.
   * A run forces 3.
   */
  fireMinLinks: number;
  /**
   * Task 29 (sim/hammers.ts «Возврат», sim/returnRun.ts): the release fixes the way back and the bodies of the return run as the
   * highlight shows them (as the pierce's); bodies that walked off the way are struck by the fixation. A journal without the
   * value plays the old path (the bodies near the path the hero really runs). The sandbox: on; a run forces it off (`RUN_FORCED`) — task 30: a run with the flag `forms` turns it on (run/rtRun.ts `RT_FORMS_PARAMS`).
   */
  returnFixed: boolean;
  /**
   * The shadow of «Возврат» (chain.ts `planReturn`; the defect closed 15.10.2026, before task 30): the highlight's way back and
   * second pass see the end of the same dash — the build modules' end (`endShadow`: «Ударная волна» kills and wounds before
   * the run). With `returnFixed` the release fixes this plan, so the key changes the run; without `returnFixed` only the
   * highlight. A journal without the key plays the old path (the shadow without the wave). The sandbox and a run: on.
   */
  returnShadowEnd: boolean;
  /**
   * The wave's bodies fixed at the release (design 15.10.2026, before task 30): with «Возврат» in the kit, `returnFixed` and
   * `returnShadowEnd` the release fixes the bodies the shadow's «Ударная волна» strikes (`ReturnPreview.ends`), as the run's
   * bodies: at the end of the dash the wave strikes those still on the arena, even one that walked out of the circle; one that
   * walked in is not struck. Otherwise (no «Возврат», `returnFixed` off — a run without the flag `forms`) the wave strikes who stands in
   * the circle now. A journal without the key plays the old wave. The sandbox and a run: on (a run changes nothing while
   * `returnFixed` is off there).
   */
  returnWaveFixed: boolean;
  /**
   * Task 29 (design 15.10.2026, «Переделка восьми счётчиков»): the eight counter talismans count within one chain
   * (sim/talismansRt.ts: «Острие», «Улов», «Призма» +1 power after a crystal or a colour shift, …). Off — the old windows
   * between chains. A journal without the key plays the old path. The sandbox's toggle; a run plays it off (`RUN_FORCED`).
   */
  counterWindow: boolean;
  /**
   * «Ударная волна» with `counterWindow`: a chain of at least this many enemy links reached sends the wave (the old window:
   * 8, a constant). Read only with `counterWindow` on.
   */
  shockwaveLinks: number;
  /**
   * Task 50 «Сноровка» (sim/talismansRt.ts; docs/realtime-prototype.md, «Ранг II»): the numbers of the counters' rank II — read only
   * while the kit holds the counter in `Kit.honed` (and the chain window `counterWindow` is on); a journal without them plays these
   * defaults, a fight without `Kit.honed` never reads them. «Острие» II: every `honeEdgeEvery`-th enemy link +2. «Улов» II: the free
   * jump charges the next released chain — its first enemy link +`honeCatchPower`. «Призма» II: +`honePrismEnergy` energy for every
   * colour shift of the dash. «Ударная волна» II: a second wave of radius `honeWaveStart` round the chain's start. «Добивание» II: the
   * shield from a chain of `honeFinisherKills` kills. «Охотник на элит» II: an elite link loses `honeHunterPlates` plates before its
   * hit. «Длинная рука» II: a link taken beyond the ordinary R +`honeArmPower`. «Иней на клинке» II: the nearest enemy within
   * `honeFrostNear` of the survivor freezes `honeFrostTime` s too.
   */
  honeEdgeEvery: number;
  honeCatchPower: number;
  honePrismEnergy: number;
  honeWaveStart: number;
  honeFinisherKills: number;
  honeHunterPlates: number;
  honeArmPower: number;
  honeFrostNear: number;
  honeFrostTime: number;
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
  // Archer (stage 2 of the transition, docs/realtime-slice.md, section 4; the point shot — phase A, Т6)
  archerHp: number;
  /** Nearer than this to the hero the archer backs away. */
  archerNear: number;
  /** Farther than this from the hero the archer walks up. */
  archerFar: number;
  /** One aim (the mark or the line) every … game seconds (the windup is part of it). */
  archerCooldown: number;
  /** The mark (or the line) fills this long before the arrow falls. */
  archerWindup: number;
  /** Game seconds after appearing before the first aim. */
  archerFirstDelay: number;
  /** The hero is aimed at within this distance (centre to centre); the length of the old line. */
  archerRange: number;
  /** Width of the line. */
  archerWidth: number;
  /** Damage of the arrow to the hero. */
  archerDamage: number;
  /** Hit of the arrow on an enemy on the line. */
  archerHit: number;
  /**
   * Phase A, Т6 (user decision 09.10.2026, docs/realtime-phase-a.md, section 7): the archer marks a point (the hero's centre
   * at the aim) with a circle of `archerMarkRadius`; the arrow falls there at the end of the windup and hurts only the
   * hero. Off — the line of stage 2 (`archerRange` long, `archerWidth` wide, it hits enemies for `archerHit`); journals
   * without this value replay with the line. A run forces it on.
   */
  archerPoint: boolean;
  archerMarkRadius: number;
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
  /**
   * Loop research, step 2 (docs/realtime-loop-research.md, sections 3.1–3.4; user decisions 11.10.2026): the loop («Печать»).
   * Off by default (the sandbox panel turns it on; a run does not yet): a chain closes by the pointer on its first link with
   * `loopMinLinks`+ enemy links, or on the hero with `loopHeroMinLinks`+ (`loopHeroCloses`); at the end of its dash every
   * enemy that was inside at the release takes the seal hit ⌊(n − 2) ÷ 2⌋ (at least 1) and is held `sealHold` game seconds
   * (`sealHoldLong` from `sealLongLinks` enemy links; the cold without the ×2). Journals without these values: off.
   */
  loopEnabled: boolean;
  loopMinLinks: number;
  loopHeroCloses: boolean;
  loopHeroMinLinks: number;
  sealHold: number;
  sealHoldLong: number;
  sealLongLinks: number;
  /** Loop research, step 2 (experiment): in focus before the first link the view hints the best loop from the hero. Off by default. */
  loopHint: boolean;
  /**
   * Loop research, step 3 (docs/realtime-loop-research.md, К1; design decisions 12.10.2026): «Прямая», the barbarian's pierce
   * (sim/pierce.ts). Sandbox only: off by default, a run forces it off (`RUN_FORCED`). A chain whose tail of the last 3 enemy
   * links turns at most `pierceTurn` degrees at every corner, whose last enemy link dies and whose power after it is ≥ 1, goes on
   * `pierceLength` along the line (cut by obstacles, the edge and cliffs); every body within `pierceCorridor` of the line takes
   * the chain's power (not spent). Journals without these values: off (the numbers read their defaults).
   */
  pierceEnabled: boolean;
  pierceTurn: number;
  pierceLength: number;
  pierceCorridor: number;
  /**
   * Task 44 «Сплавы» (sim/fusions.ts; docs/realtime-prototype.md, section 9ц): the numbers of the fusions, read only while the kit
   * holds the fusion's id — a journal without them plays these defaults, a fight without a fusion never reads them.
   * «Копьё»: the pierce's length × `fusionSpearFactor` (2) and `fusionSpearPlates` (2) plates off an elite instead of one.
   * «Ледяная печать»: the survivors inside the ring freeze for max(the seal's hold, `fusionIceTime` 3 s), brittle (×`frostFactor`
   * on the next chain hit) while `fusionIceBrittle`.
   */
  fusionSpearFactor: number;
  fusionSpearPlates: number;
  fusionIceTime: number;
  fusionIceBrittle: boolean;
  /**
   * Task 46 «Сплавы v2» (sim/fusions.ts; docs/realtime-prototype.md, section 9ц): read only while the kit holds the fusion's id (a
   * journal without them plays these defaults). «Клеймо»: bodies within `fusionBrandReach` (1, plus the body radius) of the lit path
   * take the chain's colour. «Подрыв»: the last link an elite or tough — the end blast's radius × `fusionBlastFactor` (1.5), its hit
   * 1 + `fusionBlastPower` (3), `fusionBlastPlates` (2) plates off an elite (a boss's armour — 1). «Ледяная волна»: the wave's
   * survivors freeze max(their cold, `fusionWaveTime` 3 s), brittle while `fusionWaveBrittle`.
   */
  fusionBrandReach: number;
  fusionBlastFactor: number;
  fusionBlastPower: number;
  fusionBlastPlates: number;
  fusionWaveTime: number;
  fusionWaveBrittle: boolean;
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
  // ---- Elite behaviours (package «Урон имеет значение», docs/realtime-design-research.md, 4.3 item 6; eliteBehaviors.ts) ----
  /**
   * Elite behaviours by kind (docs/realtime-elite-behaviors.md): the basic elite leads a column of weak enemies of its colour,
   * the wolf elite is the pack leader, the boar elite charges twice. Off by default; journals without the value: off (every
   * existing journal replays to the same hash). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`, design answer 11.10.2026).
   */
  eliteBehaviors: boolean;
  /** «Ведёт строем»: weak enemies of its colour the basic elite leads, the radius it picks them up in, the spacing of the column. */
  eliteLeadCount: number;
  eliteLeadRadius: number;
  eliteLeadSpacing: number;
  /** «Вожак»: wolves standing at their slots for the ring's howl while the elite wolf is in the ring (instead of `wolfRushPack`). */
  wolfLeaderSettleCount: number;
  /** «Вожак»: the rush length of a howl the elite wolf joins (instead of `wolfRushRange`). */
  wolfLeaderThrow: number;
  /** «Двойной рывок»: the windup of the elite boar's second charge (its line re-aimed at the hero). */
  boarSecondWindup: number;
  // ---- Package «Урон имеет значение» (docs/realtime-damage.md; user decision 11.10.2026). Every value off / as before by
  // default; journals without them replay as before (a missing value reads as off / the old number). A run turns the
  // package on (run/rtRun.ts `RT_RUN_FORCED`) and passes its numbers by the row in the loadout.
  /**
   * Elite armour (docs/realtime-design-research.md, 4.3): an elite made while it is on gets plates instead of HP × the factor
   * (its HP is the kind's, ×1); a hit takes plates off before any HP; 0 plates — the window. Off — the elite of before.
   */
  eliteArmor: boolean;
  /** Sandbox: plates of an armoured elite (a run passes its own by the row, `Loadout.elitePlates`). */
  elitePlates: number;
  /** Game seconds an armoured elite stands open at 0 plates (stands, does not hit, its mechanic off). */
  eliteWindow: number;
  /** The first game seconds of the window when a kill is a clean break (+1 energy, the loot ×2; design answer 11.10.2026). */
  eliteCleanWindow: number;
  /** The marker of a newcomer that will be an elite waits this long (game seconds; the plain marker — `markerDelay`). */
  eliteMarkerDelay: number;
  /** After the window: 1 plate at once, then +1 every this many game seconds up to its maximum (the cold stops it). */
  elitePlateRegrow: number;
  /**
   * The elite-loot cliff (calibration 12.10.2026, docs/realtime-casino.md, «Калибровка экономики»): while no consumable is
   * open (`Kit.openItems` empty), an armoured elite's loot opens one — its kind by the arena's `loot` stream — and drops it
   * instead of the resources; from then on the loot follows the rule of before (a consumable open in the run). Off by
   * default; journals without the value: off (the resources of before). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`).
   */
  eliteLootOpens: boolean;
  /**
   * Task 17 Е2 (design 13.10.2026): a newcomer becomes an elite (guaranteed, random, the event's start elite) only if its kind
   * is in `Kit.eliteKinds` — the run gives the list on the first elite row of a gentle run (the kinds met before that have an
   * elite behaviour). Off by default; journals without the value: off (every kind as before). A run turns it on (`RT_RUN_FORCED`);
   * the sandbox kit never has the list, so the toggle changes nothing there.
   */
  eliteMetKinds: boolean;
  /**
   * Task 26 «Расписание леса» (design 15.10.2026): an elite's affixes are drawn only among the types of `Kit.affixKinds` — the
   * run gives the types the viewer met and at most one more (run/schedule.ts `allowedAffixes`). Off by default; journals without
   * the value: off (every type as before). A run turns it on (`RT_RUN_FORCED`); the sandbox kit never has the list.
   */
  affixMetKinds: boolean;
  /** Touch of an armoured elite (instead of the base touch; no `eliteDamageBonus` on top) and the knock of the hero, units. */
  eliteTouchDamage: number;
  eliteKnockback: number;
  /** With armour on: no random elite while this many elites live — before the goals, and after them (instead of `eliteCap*`). */
  eliteArmorCap: number;
  eliteArmorCapAfter: number;
  /** Tough enemies: a tough newcomer gets 1…this HP, uniform (2 — the 1 or 2 of before; a run passes its own by the row). */
  toughHpMax: number;
  /** Touch of an enemy with HP ≥ 2 at the touch, or of an elite: `toughTouchDamage` instead of the base touch. */
  toughTouch: boolean;
  toughTouchDamage: number;
  // ---- Casino stage 1: «Однорукий гоблин» (slot.ts; docs/realtime-casino.md). Off by default; journals without the key: off
  // (every existing journal replays to the same hash). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`) and says in the
  // loadout which battles may get it (`Loadout.slot`); the sandbox has the panel button «Гоблин».
  /** The slot: a stone goblin idol with a lever may appear after the goals; a chain ending on the lever spins 3 reels. */
  slot: boolean;
  /** Chance of the goblin in a battle that may get it (stream `slot:appear`). */
  slotChance: number;
  /** Game seconds after the goals it appears. */
  slotDelay: number;
  /** Game seconds of its marker (the lever is not a target yet). */
  slotMarker: number;
  /** Its spot: this near … this far from the hero (seen from him). */
  slotNear: number;
  slotFar: number;
  /** Pulls a fight; game seconds between pulls; game seconds the reels spin (the effect comes at their end). */
  slotPulls: number;
  slotCooldown: number;
  slotSpin: number;
  /** Skulls on each reel at the start (each reel has 4 good symbols too: a skull with s ÷ (4 + s)). */
  slotSkulls: number;
  /** Enemy links the dash really struck per skull taken off for the pull. */
  slotLinksPerSkull: number;
  /** The rain: waves, marks per wave (min … max), game seconds between waves. */
  slotRainWaves: number;
  slotRainMin: number;
  slotRainMax: number;
  slotRainStep: number;
  /** The volley: marks around the hero, within this radius. */
  slotVolleyMarks: number;
  slotVolleyRadius: number;
  /** Damage of one arrow (to the hero and to an enemy). */
  slotDamage: number;
  /**
   * «Перебор» (design 12.10.2026, playtest v34): pulls after the first `slotSafePulls` are risky — in the tick of the pull a
   * bust roll (stream `slot:bust`) with `slotBustChance`: the goblin blows up when the reels stop, `slotBustDamage` to the
   * hero wherever he is (nothing protects; with `slotBustArea` — the area blast instead); else a sure triple of a good symbol. Off by default; a journal without the key
   * plays the old path (no roll, the stream untouched). A run turns it on (`RT_RUN_FORCED`).
   */
  slotBust: boolean;
  slotSafePulls: number;
  slotBustChance: number;
  slotBustDamage: number;
  /**
   * «Длинная цепь кормит гоблина» (design 12.10.2026, task 5): every chain of `slotLongChainLinks` or more enemy links in the
   * fight (struck, a plate taken, passed fallen — counted at the dash's end), before or after the goblin appears, gives
   * +`slotSafePerLongChain` safe pulls; safe pulls never exceed `slotPulls` − 1 while it is on (the last pull is always
   * risky). Acts with `slot` and `slotBust`, only in a battle the goblin may still come to or stands in (slot.ts
   * `slotFeedOpen`). 0 — off (the default; a journal without the key plays the old path: no `world.slotChains`). The run: 1.
   */
  slotSafePerLongChain: number;
  slotLongChainLinks: number;
  /**
   * «Взрыв по площади» (design 13.10.2026, playtest v39, task 7): with «Перебор» on, a bust no longer hits the hero wherever
   * he is. When the reels stop the idol lights: a circle of `slotBustRadius` around it, `slotBustFuse` game seconds later the
   * blast (world.ts `detonate`, a blast of `world.blasts` with `bust`) hits everyone inside — the hero −`slotBustDamage`
   * (invulnerability, the dash and the jump spare him; the chain shield and «Щит фокуса» do not), every enemy
   * −`slotBustEnemyDamage` (the player's kills, source `slot-bust`; survivors thrown by `blastPush`). Off by default; a journal
   * without the key plays the old bust. A run turns it on (`RT_RUN_FORCED`).
   */
  slotBustArea: boolean;
  slotBustRadius: number;
  slotBustFuse: number;
  slotBustEnemyDamage: number;
  /**
   * «Гоблин раньше» (design 13.10.2026, В3, task 7): a battle that may get the goblin rolls at this fight time (game seconds)
   * or `slotDelay` after the goals, whichever comes first — still once a battle. 0 (the default; a journal without the key
   * too) — only after the goals. The run: 5.
   */
  slotAppearAt: number;
  /**
   * «Гоблин-сюрприз» (design 13.10.2026, playtest v40, task 11): with «Перебор» on, a goblin rolls its own safe pulls when it
   * appears — a whole number 0 … `slotSafePulls`, uniform (stream `slot:safe`; the run: 0 … 3) — stored on it
   * (`Goblin.safe`) and read instead of `slotSafePulls`. The view does not show the number. Off by default; a journal without
   * the key plays the old path (`slotSafePulls`, no roll). A run turns it on (`RT_RUN_FORCED`); the prologue room 8 «Гоблин» keeps it off; the last room «Толпа» plays the run's numbers (design 13.10.2026).
   */
  slotSafeRandom: boolean;
  /**
   * «Безопасный рывок — тройка» (design 13.10.2026, task 11): a safe pull is a sure triple of a good symbol (❤ ⚡ ◆ 🍲, equally
   * likely, the stream `slot:bust` as the risky pull's triple) — no skulls, no rain, no volley, no pair. Off by default; a
   * journal without the key plays the old reels. The run and the prologue turn it on.
   */
  slotSafeTriple: boolean;
  /**
   * Task 24 «Урок перебора» (design 15.10.2026): the arena goal `pull` (the prologue's room 8) counts a pull once it settled — its
   * reels stopped, and a bust's blast went off — not in the tick of the pull: the door opens after the show bust, not before it.
   * Off by default; a journal without the key counts the pull at once (the old path). Only the prologue's room 8 turns it on.
   */
  slotPullGoalSettled: boolean;
  // ---- Casino stage 1, item 1 — «Котёл» (purse.ts, docs/realtime-casino.md). ----
  /**
   * The cauldron: every chain puts its cheque (embers × heat × crystals), the build's kills outside the chain 1 ember each; the
   * door pays crafting resources for it (⌊котёл ÷ purseRate⌋ — 60, at most 3). Off by default; journals without the value: off (no new
   * world fields, the stream `purse:loot` untouched). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`).
   */
  purse: boolean;
  /** «Котёл»: embers per crafting resource at the door (60; design 11.10.2026 — a calibration before the playtest). */
  purseRate: number;
  /**
   * П4 «Раздув за дела» (casino stage 2, purse.ts, docs/realtime-casino.md; design 11.10.2026): after the goals every 2 chains
   * of 3+ enemy links released with the door open raise the cauldron's greed step ×1 → ×1,5 → ×2 → ×3; a hit on the hero
   * takes one step off. The door multiplies the cauldron by the step (the payout's cap stays). Acts only with `purse`. Off by
   * default; journals without the value: off (no `world.purse.greed`, no `door.greed`). A run turns it on (`RT_RUN_FORCED`).
   */
  greedByDeeds: boolean;
  /**
   * П3 «Финальная цепь» (purse.ts, docs/realtime-casino.md, «Финальная цепь (П3)»; design 12.10.2026): a chain that enters the
   * open door gets +1 heat in its cheque (the forecast shows it); an exit by walking or a jump gets nothing. Acts only with
   * `purse`. Off by default; journals without the value: off (the cheque as before). A run turns it on (`RT_RUN_FORCED`).
   */
  doorFinale: boolean;
  // ---- Casino stage 1, item 2 — «Ставка клятвы» (oath.ts, docs/realtime-casino.md). ----
  /**
   * The oath stake: the fight may be under one oath (the run's node card, `Loadout.oath`; the sandbox — the panel's choice);
   * kept — the door pays the cauldron ×2, broken — ×0.5. Off by default; journals without the value: off (no `world.oath`).
   * A run turns it on (run/rtRun.ts `RT_RUN_FORCED`).
   */
  oathStake: boolean;
  // ---- Casino stage 1, item 4 — «Кость у двери» (run/rtRun.ts, docs/realtime-casino.md). ----
  /**
   * The die at the door: after a won run arena whose cauldron is above 0 the run shows the die screen — «Забрать» pays the
   * cauldron as it is, «Бросить» pays it ×0.5 (1–3) or ×2 (4–6) by the run's own die stream. A run-layer rule: the
   * simulation never reads it (main.ts passes it to the run with the arena's outcome). Off by default — the run pays at
   * the door at once, as before. A run turns it on (run/rtRun.ts `RT_RUN_FORCED`); the sandbox has no die (no run).
   */
  doorDie: boolean;
  // ---- B7 К9 — «Игорный круг гоблинов» (run/rtRun.ts, docs/realtime-casino.md, «Игорный круг (К9)»). ----
  /**
   * The goblins' gambling circle: an event node of run row 3 and later may stand as the circle instead of its event (30 % by
   * the run's own stream `rt-casino`, at most one a run, not with 0 resources). A run-layer rule: the simulation never reads
   * it (the run view passes it to `rtEnterNode`). Off by default — every event node is its event, as before. A run turns
   * it on (run/rtRun.ts `RT_RUN_FORCED`); the sandbox has no run.
   */
  goblinCircle: boolean;
  // ---- Roster mix (run/arenaPools.ts, docs/realtime-phase-a.md, section 4; design decision 11.10.2026). ----
  /**
   * The roster mix of the run: «Застава» and «Брод» take a pool roster whose kinds are all met in about half of their fights
   * («Шаманский щит» never on «Брод»), «Логово» stands in the pools of run rows 6–8 instead of 2–5. A run-layer rule: the
   * simulation never reads it (the roster comes as `Simulation` option `roster`). Off by default — the choice of arenas
   * and rosters as before. A run turns it on (run/rtRun.ts `RT_RUN_FORCED`) and keeps it in its save (`rosterMix`); the
   * sandbox has no run.
   */
  rosterMix: boolean;
  // ---- Task 12 «Отмеченные — атаман или орда» (sim/arenas.ts `markedGoal`, docs/realtime-slice.md, section 5; design 13.10.2026). ----
  /**
   * The marked goals: a `marked` arena with a goal layout (`ArenaTemplate.markedGoal`: «Логово», «Стрелковая гряда», «Брод»,
   * «Круг шамана») plays it — a horde of 12 or one leader (`StartEnemy.leader`: HP at least the row's tough HP + 2, reached and
   * pressed like an elite). Read once when the world is made (world.ts `createWorld`). Off by default; journals without the key: off (the old
   * layouts). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`) for a run with the flag `RtRunState.markedGoals` (a save before
   * 13.10.2026 keeps the old layouts); the sandbox has the panel toggle (a new fight of the arena).
   */
  markedGoals: boolean;
  // ---- П9 «Второе дыхание» (world.ts `hurtHero`, docs/realtime-prototype.md; design decision 11.10.2026: sandbox only). ----
  /**
   * The second wind: once per fight a lethal hit does not end it — the hero stands up with 3 HP, invulnerable 2 s; the
   * cauldron of the fight goes to 0 and its oath counts as broken. «Пепельный оберег» saves first. Off by default; journals
   * without the value: off (no `world.secondWind`). A sandbox rule: a run arena plays it off (`RUN_FORCED`); task 17 «Пологий
   * вход» gives a gentle run the same rule through its kit instead (`Loadout.secondWind`: rows 1–4, once a run).
   */
  secondWind: boolean;
  // ---- К7 «Проклятый сундук» (chest.ts, docs/realtime-casino.md, «Проклятый сундук (К7)»; design 12.10.2026). ----
  /**
   * The cursed chest: an arena with an authored chest point (only «Застава», `ArenaTemplate.chest`) puts the chest there. A
   * chain takes it as a pass-through link (as an elite's loot: any colour, anywhere, no power, no embers) or the walking
   * hero by touch. Taken, the curse starts: +1 to every touch (`touchDamage`; not the reaper's) until 12 kills of the dash or
   * the end of the fight. Off by default; journals without the value: off (no chest, no `world.curse`). A run turns it on
   * (run/rtRun.ts `RT_RUN_FORCED`; the reward screen after the victory is the run's).
   */
  cursedChest: boolean;
  // ---- Task 14 «Котомка у двери» (sim/bag.ts, docs/realtime-slice.md, «Котомка у двери»; user decision 13.10.2026). ----
  /**
   * The bag at the door: when the goals open the door the bag appears (`world.bag`); the player's credited kills after it
   * fill three steps (`bagStep1`–`bagStep3` kills in all: 10, 20, 35) worth `bagReward1`–`bagReward3` resources (1, 2, 3 —
   * 6 in all); a real HP loss of the hero sends the unfilled step back to its start (filled steps stay); the door pays the
   * filled steps (kinds of the stream `bag`), a defeat pays nothing. Off by default; journals without the key: off (no
   * `world.bag`, the stream untouched). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`) except the Jailer and the final
   * fight and its fights of row 1 (`Loadout.noBag`, run/rtRun.ts `RT_BAG_ROW`); the prologue keeps it off (`prologueParams`); the sandbox — the panel toggle.
   */
  doorBag: boolean;
  /** «Котомка у двери»: kills after the goals that fill steps 1, 2, 3 (counted from the goals: 10, 20, 35). */
  bagStep1: number;
  bagStep2: number;
  bagStep3: number;
  /** «Котомка у двери»: resources of steps 1, 2, 3 (1, 2, 3). */
  bagReward1: number;
  bagReward2: number;
  bagReward3: number;
  // ---- Task 16 «Подвиги» (sim/feat.ts, docs/realtime-slice.md, «Подвиги»; user 13.10.2026, design 13.10.2026). ----
  /**
   * The feat of a run fight: the run gives the node's feat in the loadout (`Loadout.feat`: «Набери N очков», «Продержись N с после
   * целей», «Продержись N с на арене»); the simulation latches it done (`world.feat`, event `feat` `done`). Off by default;
   * journals without the key: off (no `world.feat`, no event). A run turns it on (run/rtRun.ts `RT_RUN_FORCED`); which fights
   * get a feat and the reward are the run's (a run with its flag `feats`). The sandbox has no node feat.
   */
  feats: boolean;
  // ---- Task 27 «Каркас босса и Тюремщик в песочнице» (sim/enemies/jailer.ts, docs/realtime-elite-behaviors.md, «Каркас босса»). ----
  /**
   * The boss frame: a boss is a core and its parts — enemies of the common body (the Jailer: the core `jailer` and its part, the
   * weight `jailer-weight`); the conductor picks the moves (weights, `eventMax`, `missedMax`, the stream `behavior:jailer`); a
   * severed part takes one plate off the core after the dash; the boss's state (the core's plates, the phase, the despair)
   * changes only when no dash runs. Off by default; journals without the key: off (the kinds walk as plain enemies, no new
   * fields). The boss arenas turn it on for themselves (`ArenaTemplate.bossFrame`, world.ts `createWorld`): the sandbox arena
   * «Тюремщик» and, task 28, the run's Jailer fight (the same arena, run/rtRun.ts `RtRunState.jailer`).
   */
  bossFrame: boolean;
  // ---- Task 28 «Тюремщик в походе» (sim/enemies/jailer.ts `bossClear`, docs/realtime-elite-behaviors.md, «Смерть босса кончает бой»). ----
  /**
   * The boss's death ends the fight (design 15.10.2026, playtest of task 27): with the frame on, the moment the core dies every
   * other enemy dies with it (`kill` events of the source `boss-clear`, not the player's: no score, kills, bag, feat, cauldron),
   * the markers and the queue are dropped, nothing spawns any more, the door opens, the hero is not hurt any more; a dash that
   * killed the core ends on it (its links after the core are not struck — the highlight shows them without an outcome). Off by
   * default; journals without the key: off (the old path: the crowd lives on). The boss arenas turn it on for themselves
   * (`ArenaTemplate.bossClears`, world.ts `createWorld`: only when the given values have it off, so a journal recorded before
   * the key replays as it was).
   */
  bossClears: boolean;
  /**
   * Task 28: a part of a boss severed by the player drops its loot as an armoured elite does (elites.ts `armorLoot`, the stream
   * `loot`). Off by default; journals without the key: off. The run turns it on (run/rtRun.ts `RT_RUN_FORCED`).
   */
  bossPartLoot: boolean;
  // ---- Task 32 «Бесцветный Тюремщик, больше HP» (sim/enemies/jailer.ts, docs/realtime-elite-behaviors.md). ----
  /**
   * The Jailer's core is colourless (design 15.10.2026): with the frame on, a chain of any colour takes it, as any link (the first
   * too); it does not set or change the chain's colour (the first coloured enemy sets it), is not counted by «Смена цвета» and is
   * neither «Чужак» nor a colour of «Близнецы» (chain.ts `colorlessLink`). The weight keeps its colour. Off by default; journals
   * without the key: off. The boss arenas turn it on for themselves (`ArenaTemplate.jailerColorless`, world.ts `createWorld`).
   */
  jailerColorless: boolean;
  /**
   * HP of the Jailer's core at its spawn (enemies/jailer.ts `jailerHpOf`). Default 2 (the old core); journals without the key: 2.
   * The boss arenas put 5 (`ArenaTemplate.jailerHp`, world.ts `createWorld`: only when the given values hold the default).
   */
  jailerHp: number;
  // ---- Task 48 «Тролль» (sim/enemies/troll.ts, sim/arenasBoss.ts `troll`; docs/realtime-elite-behaviors.md, «Тролль (задача 48)»). ----
  /**
   * The Troll's window (design 16.10.2026, docs/design-notes/task-48-troll.md, 6): with the frame on, the Troll's core is closed
   * outside a window his own moves open — the chain refuses it (`outOfWindow`, «вне окна»), and no other source hurts it (fire, the
   * cutting dash, blasts, the wave, the pierce, the seal, the return run, enemies: event `trollWindow` `block`); one hit per window
   * (the first hit of any source acts, the window closes once the hero's move that struck it is over). Off by default and in journals
   * without the key: the core is open always. The arena «Берлога тролля» turns it on for itself (`ArenaTemplate.troll`).
   */
  trollWindow: boolean;
  /**
   * Task 48 (design 16.10.2026, docs/design-notes/task-48-troll.md, 24.10): the boss's solid bodies — the Troll's core and parts (task 54:
   * the Chief's too; the key keeps its name for the journals) are solid for the hero — he never
   * stands inside them (walking, a knockback, the end of a dash or a jump put him out as out of an obstacle; the plan's end and the
   * jump's landing show that point), and the bodies are never moved by the parting or the crowd. Off by default and in journals without
   * the key (the old path: the bodies parted). The arena «Берлога тролля» turns it on for itself.
   */
  trollSolid: boolean;
  /**
   * Task 48, the Troll's numbers (read only on his arena; journals without a key play the defaults below): the core's HP and plates
   * (the ceiling of «Храп»'s regrowth too), the window after «Удар дубиной» and after «Хвост метёт» (game s), «Храп»'s length (its
   * window), the plates a «Храп» left alone regrows (0 — none), «Рык» every this many s in phase 2 and 3, the crowd's factor — its
   * density floor and its top-up pace (the groups' interval ÷ it; the arena puts `TROLL_CROWD` when the values hold 1).
   */
  trollHp: number;
  trollPlates: number;
  trollWindowClub: number;
  trollWindowTail: number;
  trollSnore: number;
  trollSnoreRegrow: number;
  trollRoarPeriod: number;
  trollCrowd: number;
  // ---- Task 54 «Главарь с котелком» (sim/enemies/chief.ts, sim/arenasBoss.ts `chief`; docs/realtime-elite-behaviors.md, «Главарь (задача 54)»). ----
  /**
   * The Chief's feast (design 17.10.2026, docs/design-notes/task-54-chief.md, 7): with the frame on, the Chief's core is closed outside
   * the window «Обед!» opens — the chain refuses it (`outOfWindow`, «вне окна»); in the window it is a link of the brew's colour that a
   * chain takes only with `chiefFeastLinks` enemy links of that colour before it (`queue`, «в очередь»); one hit per window, the
   * chain's only — no other source ever hurts the core (event `chiefFeast` `block`). Off by default and in journals without the key:
   * the core is open always (the feast still recolours and seats its eaters). The arena «Стан Главаря» turns it on for itself
   * (`ArenaTemplate.chief`).
   */
  chiefFeast: boolean;
  /**
   * Task 54, the Chief's numbers (read only on his arena — no journal before the task has it; the defaults are the design's): the
   * core's HP and plates, the queue (enemy links of the brew's colour before the core), the window's and the eaters' seconds, the gap
   * from a window's end to the next «Обед!»'s windup in phases 1–2, the queue from which the hit takes two plates (0 — never), the
   * crowd's factor — its density floor and its top-up pace (the groups' interval ÷ it).
   */
  chiefHp: number;
  chiefPlates: number;
  chiefFeastLinks: number;
  chiefFeastTime: number;
  chiefFeastGap: number;
  chiefFeastBig: number;
  chiefCrowd: number;
  // ---- Task 33 «Цена „Близнецов“ и „Развилки“» (sim/forms.ts, chain.ts; docs/realtime-prototype.md, 9ф). ----
  /**
   * «Близнецы»: strict alternation (design 15.10.2026). While the chain goes by one colour of the pair, as before; once it took
   * the pair's other colour, the pair's colours must alternate (A-A-Б-A-Б…; A-Б-Б is refused «не тот цвет»). A crystal (a new
   * colour segment) starts it again. The sandbox — on (`DEFAULT_PARAMS`); the run — off (`RUN_FORCED`); journals without the
   * key: off (the free pair).
   */
  twinsAlternate: boolean;
  /** «Близнецы» turn «Смена цвета» off (`colorShiftOf` 0 with the form in the kit). Sandbox on, run off, journals without the key: off. */
  twinsNoShift: boolean;
  /**
   * «Развилка»: links a chain may take from an older link — not from the last one, nor from the hero with «Якорь» (`ChainLink.fork`);
   * once spent, the anchors are the last link (and the hero with «Якорь») again. 0 — no limit (the old path). Sandbox 1, run 0,
   * journals without the key: 0.
   */
  forkBranches: number;
  /**
   * Task 52 «Числа», Р2 (docs/design-notes/task-52-numbers.md, 3.5): «Развилка»'s gesture — game seconds the pointer rests on an older
   * link of the chain (not the last, not the one before it) to make it the fork's anchor; the next link is taken only from it (`fork`).
   * 0 — the old rule (every link an anchor). The sandbox 0,25 (`DEFAULT_PARAMS`, design 17.10.2026); the run — 0 (`RUN_FORCED`); journals
   * without the key: 0 (the old rule; their hashes as before).
   */
  forkDwell: number;
  // ---- Task 34 «Смена цвета — только точкой курсора» (chain.ts `dragChain`; docs/realtime-prototype.md, «Смена цвета»). ----
  /**
   * While the chain's colour is free by «Смена цвета» (`colorShiftLinks`), an enemy of another colour joins only at the pointer
   * event itself (`full`); the sweep points and the held still pointer (`sweep`, `append`) take only the chain's colour (and the
   * colourless core) and pass the others by, without a refusal (user 15.10.2026, playtest v57: a swipe through the crowd changed
   * the colour by accident). Sandbox and run on; journals without the key: off.
   */
  shiftAtPointer: boolean;
  // ---- Task 39 «Неподвижный курсор берёт ближайшее» (chain.ts `pickAt`; docs/realtime-prototype.md, «Неподвижный курсор»). ----
  /**
   * The held still pointer (`append`, `holdPicks`) picks the nearest body in its press circle among the candidates AND the chain's
   * links; the nearest a link — nothing happens (no take, no truncation). Without it the held pointer resting on the last link took
   * a neighbour and the next pointer event stepped back («мерцание»; log analysis 15.10.2026). Sandbox and run on; journals without
   * the key: off.
   */
  holdNearest: boolean;
  // ---- Task 42 «Неподвижный курсор у героя ничего не берёт» (chain.ts `heroHeld`; docs/realtime-prototype.md, «Неподвижный курсор»). ----
  /**
   * A drag point in the hero's circle (`HERO_CANCEL_RADIUS`) treats the hero as a link: the held still pointer (`append`) and the
   * sweep points take nothing and cancel nothing; the pointer event (`full`) on an empty chain takes nothing (one link — still the
   * step back, two or more — nothing). Without it the pointer event there took the only link off and the next frame took the same
   * body again («мерцание у героя»; logs 16.10.2026). The press is unchanged. Sandbox and run on; journals without the key: off.
   */
  holdHeroLink: boolean;
  // ---- Task 38 «Гарнизон, шаг 1» (sim/tethers.ts, sim/enemies/garrison.ts; docs/realtime-elite-behaviors.md, «Гарнизон»). ----
  /**
   * The law of tethers (design 15.10.2026): a tether is a line between two bodies (the dog handler's leash, the Castellan's
   * leashes) — not a link. A segment of the dash (the hero → link 1 → link 2 …, up to the link the dash stops on) that crosses
   * its inner part (without `TETHER_END_GAP` at each end) cuts it after the dash; the highlight (`ChainPlan.cuts`) lists the same
   * tethers, the release fixes them (`HeroMove.cuts`). The jump, the walk, the spin, consumables, the return run, the pierce and
   * hammers never cut. A tether is gone when either end dies. Off by default; journals without the key: off (no tether is made,
   * no `World.tethers`). The run turns it on (`RT_RUN_FORCED`).
   */
  tethers: boolean;
  /** Task 38: the leash's length — a leashed hound stays within it of its holder (units; journals without the key: 3). */
  leashLength: number;
  /** Task 38: game seconds of a loosed hound's frenzy (journals without the key: 6). */
  houndFrenzy: number;
  /** Task 38: a frenzied hound's bite on an enemy (`damageEnemy`; an armoured elite loses a plate). Journals without the key: 1. */
  houndFrenzyDamage: number;
  /**
   * Task 38: the guards walk in a line across their way to the hero, 0.9 apart (enemies/garrison.ts). Off by default; journals
   * without the key: off (a guard walks as a plain slow enemy). The run turns it on (`RT_RUN_FORCED`).
   */
  guardFormation: boolean;
  // ---- Task 40 «Гарнизон, шаг 1б» (sim/enemies/garrison.ts «Ключник», sim/tethers.ts; docs/realtime-elite-behaviors.md). ----
  /**
   * The keymaster's shackles (design 16.10.2026): every `shacklePeriod` s (the first 3 s after it appears) the keymaster shackles
   * the nearest enemy within `shackleRange` (a plain one, a guard, a dog handler — not an elite, a boss or its part, a hound,
   * another keymaster, a body held already, a link of the drawn chain), at most `shackleMax` at once. A shackle is a tether (the
   * law of tethers.ts: the dash's segment across it cuts it after the dash; the highlight's `cuts` lists it); the prisoner stands
   * and no chain takes it (refusal `shackled`). The keymaster's death drops its shackles after the dash. Needs `tethers`. Off by
   * default; journals without the key: off (no shackle is made). The run turns it on (`RT_RUN_FORCED`); «Ров» on itself.
   */
  shackles: boolean;
  /** Task 40: game seconds between the keymaster's shackles (journals without the key: 6). */
  shacklePeriod: number;
  /** Task 40: the keymaster shackles an enemy within this of its centre (units; journals without the key: 4). */
  shackleRange: number;
  /** Task 40: prisoners a keymaster holds at most (journals without the key: 2). */
  shackleMax: number;
  /**
   * Task 41 «Узник на воле» (design 16.10.2026, docs/design-notes/task-41-prisoner-potions.md, 2): a shackle cut by the dash sets
   * its prisoner loose by the law of a loosed hound — `houndFrenzy` s of riot (`vars.fz`): it runs at the nearest body and bites an
   * enemy it touches for `houndFrenzyDamage` (not the player's kills, source `riot`); then a plain enemy again. The keymaster's death
   * frees its prisoners without a riot; a rioting body is no keymaster's target. Journals without the key: off (a cut only frees the
   * prisoner, as task 40). The sandbox and the run: on (`RT_RUN_FORCED`).
   */
  prisonerRiot: boolean;
  // ---- Task 43 «Гарнизон, шаг 2», А (sim/enemies/crossbow.ts; docs/realtime-elite-behaviors.md, «Арбалетчик»). ----
  /** Task 43: the crossbow's windup — the line fixed at its start (game s; journals without the key: 1). */
  crossbowWindup: number;
  /** Task 43: the crossbow's reload after a shot (game s; journals without the key: 4). */
  crossbowReload: number;
  /** Task 43: the bolt's damage to the hero (journals without the key: 2; an enemy hit dies, an armoured elite loses a plate). */
  crossbowDamage: number;
  /** Task 43: the crossbowman keeps this far from the hero at least (backs off nearer; journals without the key: 5). */
  crossbowNear: number;
  /** Task 43: … and at most (walks up farther; journals without the key: 7). */
  crossbowFar: number;
  /**
   * Task 43 «Кастелян полный» (enemies/garrison.ts, sim/arenasGarrison.ts): «Двор кастеляна» plays the full Castellan — the yard and
   * the gallery split by a moat, the grate (the core refused while down; a chain ending on a lever raises it for 5 s), his crossbow
   * on a stand, three phases. Off by default and in journals without the key: the Castellan v0. The run: on (`RT_RUN_FORCED`); the
   * sandbox — its own arena «Двор кастеляна (полный)».
   */
  castellanFull: boolean;
  /**
   * Task 43, the full Castellan's numbers (read only on his arena, `castellanFull`; the Castellan v0 never reads them; journals without
   * a key play the numbers of before — 4 plates, the crowd ×1, «Караул!» every 15 s): the core's plates; the yard crowd's factor — its
   * density floor and its top-up pace (the groups' interval ÷ it); «Караул!» every this many game s (phase 2 and 3).
   */
  castellanPlates: number;
  castellanCrowd: number;
  castellanGuardPeriod: number;
  // ---- Task 43 «Гарнизон, шаг 2», part В «Рыцарь» (sim/enemies/garrison.ts «Рыцарь»; docs/realtime-elite-behaviors.md). ----
  // The knight comes only by an arena's roster (no knight — none of these is read). Journals without the keys: the defaults below.
  /** Task 43: the knight's plates in armour (the law of a boss's plates: one per pass, no regrowth, no window). */
  knightPlates: number;
  /** Task 43: the knight's HP (behind its plates; the offensive takes it as an ordinary enemy's). */
  knightHp: number;
  /** Task 43: the knight's touch (never raised by the tough touch: it is its own). */
  knightTouch: number;
  /** Task 43: «Рывок» — game seconds of the windup (the lane from the knight to the hero, fixed at its start). */
  knightChargeWindup: number;
  /** Task 43: «Рывок» — damage to the hero the knight's run meets in its lane. */
  knightChargeDamage: number;
  /** Task 43: «Размах» — game seconds of the windup (the knight stands). */
  knightSwingWindup: number;
  /** Task 43: «Размах» — the circle's radius around the knight (units). */
  knightSwingRadius: number;
  /** Task 43: «Размах» — damage to the hero in the circle (enemies in it take 1, an elite a plate, not the player's kills). */
  knightSwingDamage: number;
  /** Task 43: game seconds between the knight's moves in the offensive (and from the shed armour to its first move). */
  knightPause: number;
  // ---- Task 55а «Замок: толчок» (sim/shove.ts, sim/enemies/castle.ts; docs/realtime-elite-behaviors.md, «Замок: толчок»). ----
  // The things (the barrel, the wardrobe) and the rook stand only on the castle's arenas; without one no key below is read and no world
  // field appears. Journals without a key play the default below (the kinds' numbers: `params.x ?? CONST`).
  /**
   * Task 55а: the law of the shove — a thing is the last link of a chain; the dash's end shoves it along the chain's last segment: it
   * crushes the weak on its way and strikes the first tough body (or a wall). Off by default and in journals without the key; the
   * castle's arenas turn it on for themselves (`ArenaTemplate.castle`), the run will (task 55в).
   */
  shove: boolean;
  /** Task 55а: the wardrobe's shove — its length (units; journals without the key: 3). */
  shoveDistance: number;
  /** Task 55а: the speed a shoved thing slides (units / game s; 12). */
  shoveSpeed: number;
  /** Task 55а: the wardrobe's strike on the tough body it stops at (HP; 1). */
  shoveImpact: number;
  /** Task 55а: the barrel rolls to its first stop, this far at most (units; 16). */
  barrelRoll: number;
  /** Task 55а: the barrel's strike on the tough body it stops at (HP; 2). */
  barrelImpact: number;
  /** Task 55а «Падение шкафа»: the wardrobe's rest from rising to its next windup (game s; 5). */
  wardrobePeriod: number;
  /** Task 55а: the topple's windup — its lane fixed at the start (game s; 1.2; the first of a fight ×1.5). */
  wardrobeWindup: number;
  /** Task 55а: the topple's damage to the hero in its lane (2). */
  wardrobeDamage: number;
  /** Task 55а «Удар ладьи»: the rook's rest after a strike (game s; 3.5). */
  rookPeriod: number;
  /** Task 55а: the strike's windup — the axis fixed at the start (game s; 1.0; the first of a fight 1.5). */
  rookWindup: number;
  /** Task 55а: the strike's damage to the hero (2). */
  rookDamage: number;
  // ---- Task 55, stage Д «Колдун v0» (sim/enemies/warlock.ts; spec task-55 §6). Read on his arena only («Зал колдуна»). ----
  /**
   * The warlock's charm and windows: while his wardrobe stands he is spellbound (the chain refuses him, `spellbound`; nothing but a
   * shove hurts him); his wardrobe broken — a window `warlockWindow` s after each «Перенос», one hit. Off by default and in journals
   * without the key (the core takes every hit); his arena turns it on for itself.
   */
  warlockCharm: boolean;
  /** The core's HP (2) and boss plates (4). */
  warlockHp: number;
  warlockPlates: number;
  /** «Перенос»: every this many s while charmed (10; the first on the 6th s), then every `warlockShiftFast` s from the arrival (5). */
  warlockShift: number;
  warlockShiftFast: number;
  /** The window after an arrival, his wardrobe broken (game s; 1.5). */
  warlockWindow: number;
  /** The crowd's floor and pace on his arena (×; 1 — his arena plays `WARLOCK_CROWD` 0.45 when the values hold 1). */
  warlockCrowd: number;
  // ---- Task 56 «Приметы» (sim/omens.ts, docs/realtime-slice.md, «Приметы»; spec docs/design-notes/task-56-omens.md). ----
  // Every rule is off by default; journals without a key play as before (the numbers — their defaults, `omenNum`). The run turns a
  // rule on for the fight of a node or a level with that omen (run/omens.ts); the sandbox — the panel group «Приметы».
  /** «Гроза»: the storm's marks and strikes (`World.storm`). */
  omenStorm: boolean;
  /** «Гроза»: the first mark's game second, then a mark every this many s (from the last mark). */
  omenStormFirst: number;
  omenStormEvery: number;
  /** «Гроза»: game seconds from the mark to its strike; the mark's radius (units). */
  omenStormFuse: number;
  omenStormRadius: number;
  /** «Гроза»: damage to every enemy whose body touches the circle (credited; an armoured elite — a plate) and to the hero whose centre is in it. */
  omenStormDamage: number;
  omenStormHero: number;
  /** «Гроза»: enemies within the radius of the best point a mark needs (fewer — the count waits). */
  omenStormMin: number;
  /** «Сонный час»: the enemies of the first `omenDrowseTime` s sleep until the first dash (`World.drowse`, `Enemy.sleep`). */
  omenDrowse: boolean;
  omenDrowseTime: number;
  /** «Сонный час»: the woken walk ×`omenWakeWalk` for `omenWakeTime` s (`Enemy.rage`). */
  omenWakeWalk: number;
  omenWakeTime: number;
  /** «Половодье»: pools placed at the start by the stream `omen` (`World.flood`); a link taken in water hits +`omenFloodHit`. */
  omenFlood: boolean;
  omenFloodPools: number;
  omenFloodRadius: number;
  omenFloodHit: number;
  /** «Перекличка»: a colour on the roll call (`World.rollcall`) from `omenRollcallFirst` s, every `omenRollcallEvery` s. */
  omenRollcall: boolean;
  omenRollcallFirst: number;
  omenRollcallEvery: number;
  /** «Перекличка»: energy a link of that colour adds over the usual; damage a touch of that colour adds. */
  omenRollcallEnergy: number;
  omenRollcallTouch: number;
  /** «Урожай» (bag.ts `bagHurt`): a real HP loss takes every step of the bag, the filled ones too (event `bag` `reset` with step 0). */
  bagResetAll: boolean;
  // ---- Task 57а «Лес: стрелки» (sim/shots.ts, enemies/slinger.ts, hive.ts, wisp.ts; docs/realtime-elite-behaviors.md, «Лес: стрелки»). ----
  // The slinger, the hive and the wisp come only by an arena's template or roster; the layer's keys act only while one stands or a
  // shot flies (no world field before). Journals without a key play the default below (the kinds' numbers: `params.x ?? CONST`).
  /**
   * Task 57а: the arena's shooters' timer (game s) — a slinger or a hive starts its windup only while it is empty, and the start
   * fills it (the first who waits longest, then the smaller id). 0 — no timer (default; journals without the key).
   */
  volleyGap: number;
  /** Task 57а: the archer obeys the shooters' timer too (with `volleyGap` > 0). Off — the archer plays the old path everywhere. */
  volleyArcher: boolean;
  /** Task 57а: shots on the arena at most — a volley that would pass it waits (the timer is not spent). Journals without the key: 24. */
  shotCap: number;
  /** Task 57а: the hero's dash (its path) and a bomb (a circle round its target) put out the light shots (wasps, stones). Off by default. */
  snuffShots: boolean;
  /** Task 57а «Пращник»: the windup — three lines fixed at its start (game s; journals without the key: 0.7). */
  slingWindup: number;
  /** Task 57а: the slinger's period, windup included (game s; 3.5). */
  slingPeriod: number;
  /** Task 57а: the angle between the slinger's stones (degrees; 20). */
  slingSpread: number;
  /** Task 57а: the stone's speed (units / game s; 6). */
  slingSpeed: number;
  /** Task 57а «Улей»: wasps in the ring (8). */
  hiveRing: number;
  /** Task 57а: the wasp's speed (units / game s; 2.5). */
  hiveSpeed: number;
  /** Task 57а: the hive's swell before its ring (game s; 0.8). */
  hiveSwell: number;
  /** Task 57а: the hive's period, swell included (game s; 4.5). */
  hivePeriod: number;
  /** Task 57а «Светляк»: its flight speed (units / game s; 2). */
  wispSpeed: number;
  /** Task 57а: its turn at most (degrees / game s; 90). */
  wispTurn: number;
  /** Task 57а: its flight before it fades (game s; 6). */
  wispLife: number;
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
  colorShiftLinks: 0,
  colorShiftKeep: false,
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
  colorCount: 4,
  colorsByRow: false,
  maxEnemies: 60,
  markerDelay: 1,
  spawnMinDistance: 3,
  spawnGroupHold: false,
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
  focusGuardLinks: 0,
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
  // Task 41: no cap on healing potions by default (a run passes its own).
  potionCap: 0,
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
  // Баланс: decision of the user 11.10.2026 (playtest v17) — a chain of 3+ links.
  endBlastMinLinks: 3,
  // Баланс: decision of the user 15.10.2026 (task 31, playtest 15.10.2026) — the fire from a chain of 3+ links, as the blast.
  fireMinLinks: 3,
  returnFixed: true,
  returnShadowEnd: true,
  returnWaveFixed: true,
  // Task 29: off — the old windows of the counters; the wave of the chain window from 4 links.
  counterWindow: false,
  shockwaveLinks: 4,
  // Task 50: the counters' rank II (acts only with `Kit.honed`).
  honeEdgeEvery: 3,
  honeCatchPower: 2,
  honePrismEnergy: 1,
  honeWaveStart: 2,
  honeFinisherKills: 1,
  honeHunterPlates: 1,
  honeArmPower: 1,
  honeFrostNear: 1.5,
  honeFrostTime: 2,
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
  archerPoint: true,
  archerMarkRadius: 1,
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
  loopEnabled: false,
  loopMinLinks: 4,
  loopHeroCloses: true,
  loopHeroMinLinks: 3,
  sealHold: 1.5,
  sealHoldLong: 2,
  sealLongLinks: 8,
  loopHint: false,
  pierceEnabled: false,
  pierceTurn: 25,
  pierceLength: 1.875,
  pierceCorridor: 0.5,
  fusionSpearFactor: 2,
  fusionSpearPlates: 2,
  fusionIceTime: 3,
  fusionIceBrittle: true,
  fusionBrandReach: 1,
  fusionBlastFactor: 1.5,
  fusionBlastPower: 3,
  fusionBlastPlates: 2,
  fusionWaveTime: 3,
  fusionWaveBrittle: true,
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
  // Elite behaviours (eliteBehaviors.ts): off by default.
  eliteBehaviors: false,
  eliteLeadCount: 3,
  eliteLeadRadius: 4,
  eliteLeadSpacing: 1.2,
  wolfLeaderSettleCount: 2,
  wolfLeaderThrow: 5,
  boarSecondWindup: 0.6,
  // Package «Урон имеет значение» (docs/realtime-damage.md): off by default.
  eliteArmor: false,
  elitePlates: 3,
  eliteWindow: 3,
  eliteCleanWindow: 1,
  eliteMarkerDelay: 2,
  elitePlateRegrow: 4,
  eliteLootOpens: false,
  eliteMetKinds: false,
  affixMetKinds: false,
  eliteTouchDamage: 2,
  eliteKnockback: 1,
  eliteArmorCap: 1,
  eliteArmorCapAfter: 2,
  toughHpMax: 2,
  toughTouch: false,
  toughTouchDamage: 2,
  // Casino stage 1: «Однорукий гоблин» (slot.ts) — off by default.
  slot: false,
  slotChance: 0.35,
  slotDelay: 3,
  slotMarker: 2,
  slotNear: 3,
  slotFar: 7,
  slotPulls: 3,
  slotCooldown: 8,
  slotSpin: 1.2,
  slotSkulls: 2,
  slotLinksPerSkull: 2,
  slotRainWaves: 3,
  slotRainMin: 10,
  slotRainMax: 12,
  slotRainStep: 0.8,
  slotVolleyMarks: 5,
  slotVolleyRadius: 2.5,
  slotDamage: 1,
  // «Перебор» (design 12.10.2026): off by default; 3 safe pulls, then 55 % to blow up for 4 HP.
  slotBust: false,
  slotSafePulls: 3,
  slotBustChance: 0.55,
  slotBustDamage: 4,
  // «Длинная цепь кормит гоблина» (slot.ts): off by default (0); a chain of 6+ enemy links counts.
  slotSafePerLongChain: 0,
  slotLongChainLinks: 6,
  // «Взрыв по площади» (slot.ts): off by default (the old bust: the hero hit wherever he is).
  slotBustArea: false,
  slotBustRadius: 3.5,
  slotBustFuse: 1.2,
  slotBustEnemyDamage: 3,
  // «Гоблин раньше» (slot.ts): off by default (0 — only after the goals).
  slotAppearAt: 0,
  // «Гоблин-сюрприз», «Безопасный рывок — тройка» (slot.ts): off by default.
  slotSafeRandom: false,
  slotSafeTriple: false,
  slotPullGoalSettled: false,
  // Casino «Котёл» (purse.ts): off by default.
  purse: false,
  purseRate: 60,
  // П4 «Раздув за дела» (purse.ts): off by default.
  greedByDeeds: false,
  // П3 «Финальная цепь» (purse.ts): off by default.
  doorFinale: false,
  // Casino «Ставка клятвы» (oath.ts): off by default.
  oathStake: false,
  // Casino «Кость у двери» (run/rtRun.ts): off by default.
  doorDie: false,
  // B7 К9 «Игорный круг гоблинов» (run/rtRun.ts): off by default.
  goblinCircle: false,
  // Roster mix (run/arenaPools.ts): off by default.
  rosterMix: false,
  markedGoals: false,
  // П9 «Второе дыхание» (world.ts `hurtHero`): off by default.
  secondWind: false,
  // К7 «Проклятый сундук» (chest.ts): off by default.
  cursedChest: false,
  // Task 14 «Котомка у двери» (bag.ts): off by default; 10 / 20 / 35 kills after the goals pay 1 / 2 / 3.
  doorBag: false,
  bagStep1: 10,
  bagStep2: 20,
  bagStep3: 35,
  bagReward1: 1,
  bagReward2: 2,
  bagReward3: 3,
  // Task 16 «Подвиги» (feat.ts): off by default.
  feats: false,
  // Task 27 «Каркас босса» (enemies/jailer.ts): off by default; the sandbox arena «Тюремщик» turns it on for itself.
  bossFrame: false,
  // Task 28 «Тюремщик в походе» (enemies/jailer.ts): off by default; the boss arenas turn `bossClears` on for themselves, the run `bossPartLoot`.
  bossClears: false,
  bossPartLoot: false,
  // Task 32 (enemies/jailer.ts): the old core by default; the boss arenas turn both on for themselves.
  jailerColorless: false,
  jailerHp: 2,
  // Task 48 «Тролль» (enemies/troll.ts): the window off by default (the arena «Берлога тролля» turns it on); his numbers (hypotheses of the spec).
  trollWindow: false,
  trollSolid: false,
  // Design 16.10.2026 (spec 24.11, the bot's grid): HP 2, 4 plates; the crowd ×0.3 on the arena (design 17.10.2026, spec 24.17).
  trollHp: 2,
  trollPlates: 4,
  trollWindowClub: 1.5,
  trollWindowTail: 1,
  trollSnore: 4,
  trollSnoreRegrow: 1,
  trollRoarPeriod: 20,
  trollCrowd: 1,
  // Task 54 «Главарь с котелком» (enemies/chief.ts): the feast off by default (the arena «Стан Главаря» turns it on); his numbers
  // (hypotheses of the spec, read on his arena only).
  chiefFeast: false,
  chiefHp: 2,
  chiefPlates: 4,
  chiefFeastLinks: 3,
  chiefFeastTime: 4,
  chiefFeastGap: 6,
  chiefFeastBig: 6,
  chiefCrowd: 0.3,
  // Task 33 (forms.ts): the sandbox's price of the forms; `RUN_FORCED` turns it off, a run with forms on (task 30, `RT_FORMS_PARAMS`).
  twinsAlternate: true,
  twinsNoShift: true,
  forkBranches: 1,
  // Task 52, Р2: the sandbox plays the dwell gesture (0,25 s); the run — 0 (`RUN_FORCED`); journals without the key — 0.
  forkDwell: 0.25,
  // Task 34 (chain.ts): another colour on a free chain only at the pointer; the run turns it on too (`RUN_FORCED`).
  shiftAtPointer: true,
  // Task 39 (chain.ts `pickAt`): the held pointer takes a body only when it is nearer than every link of the chain.
  holdNearest: true,
  // Task 42 (chain.ts `heroHeld`): a drag point in the hero's circle takes nothing (the step back from one link stays).
  holdHeroLink: true,
  // Task 38 «Гарнизон» (tethers.ts, enemies/garrison.ts): off by default; the run turns `tethers` and `guardFormation` on.
  tethers: false,
  leashLength: 3,
  houndFrenzy: 6,
  houndFrenzyDamage: 1,
  guardFormation: false,
  // Task 40 «Гарнизон, шаг 1б» (enemies/garrison.ts «Ключник»): off by default; the run and «Ров» turn `shackles` on.
  shackles: false,
  shacklePeriod: 6,
  shackleRange: 4,
  shackleMax: 2,
  // Task 41 «Узник на воле»: on in the sandbox (and the run, `RT_RUN_FORCED`); journals without the key — off.
  prisonerRiot: true,
  // Task 43 «Арбалетчик» (enemies/crossbow.ts): read only while a crossbow stands (no world field without one).
  crossbowWindup: 1,
  crossbowReload: 4,
  crossbowDamage: 2,
  crossbowNear: 5,
  crossbowFar: 7,
  // Task 43 «Кастелян полный»: off by default (v0); the run turns it on, the sandbox has its own arena.
  castellanFull: false,
  // Task 43: the full Castellan's numbers (the design's pick 16.10.2026 by the bot grid: 5 plates, the yard crowd ×0.5, «Караул!» every 15 s).
  castellanPlates: 5,
  castellanCrowd: 0.5,
  castellanGuardPeriod: 15,
  // Task 43 «Рыцарь» (enemies/garrison.ts): the knight's numbers (it comes only by a roster).
  knightPlates: 2,
  knightHp: 3,
  knightTouch: 2,
  knightChargeWindup: 1,
  knightChargeDamage: 2,
  knightSwingWindup: 0.8,
  knightSwingRadius: 1.6,
  knightSwingDamage: 2,
  knightPause: 2,
  // Task 55а «Замок: толчок»: off by default (the castle's arenas turn it on for themselves).
  shove: false,
  shoveDistance: 3,
  shoveSpeed: 12,
  shoveImpact: 1,
  barrelRoll: 16,
  barrelImpact: 2,
  wardrobePeriod: 5,
  wardrobeWindup: 1.2,
  wardrobeDamage: 2,
  rookPeriod: 3.5,
  rookWindup: 1,
  rookDamage: 2,
  // Task 55, stage Д «Колдун v0»: off by default (his arena turns the charm on and his crowd for itself).
  warlockCharm: false,
  warlockHp: 2,
  warlockPlates: 4,
  warlockShift: 10,
  warlockShiftFast: 5,
  warlockWindow: 1.5,
  warlockCrowd: 1,
  // Task 56 «Приметы» (sim/omens.ts, bag.ts): every rule off; the numbers of the spec (section 2.2).
  omenStorm: false,
  omenStormFirst: 6,
  omenStormEvery: 7,
  omenStormFuse: 1.2,
  omenStormRadius: 1,
  omenStormDamage: 3,
  omenStormHero: 2,
  omenStormMin: 3,
  omenDrowse: false,
  omenDrowseTime: 4,
  omenWakeWalk: 1.25,
  omenWakeTime: 4,
  omenFlood: false,
  omenFloodPools: 3,
  omenFloodRadius: 1,
  omenFloodHit: 1,
  omenRollcall: false,
  omenRollcallFirst: 3,
  omenRollcallEvery: 12,
  omenRollcallEnergy: 0.5,
  omenRollcallTouch: 1,
  bagResetAll: false,
  // Task 57а «Лес: стрелки»: no timer, no snuffing by default (the run with `forestShooters` turns both on, run/rtRun.ts).
  volleyGap: 0,
  volleyArcher: false,
  shotCap: 24,
  snuffShots: false,
  slingWindup: 0.7,
  slingPeriod: 3.5,
  slingSpread: 20,
  slingSpeed: 6,
  hiveRing: 8,
  hiveSpeed: 2.5,
  hiveSwell: 0.8,
  hivePeriod: 4.5,
  wispSpeed: 2,
  wispTurn: 90,
  wispLife: 6,
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
  // П9 «Второе дыхание» (world.ts `hurtHero`, docs/realtime-prototype.md): sandbox only.
  { kind: 'bool', key: 'secondWind', group: 'Герой и урон', label: 'Второе дыхание (песочница)', stage: 5,
    hint: 'Раз за бой смертельный удар не кончает бой: герой встаёт с 3 HP, неуязвим 2 с. Котёл боя обнуляется, клятва боя считается нарушенной. Пепельный оберег спасает первым. В походе не действует.' },
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
  n('colorShiftLinks', 'Кристаллы', 'Смена цвета: после … звеньев', 0, 20, 1, 4, '', 'После стольких вражеских звеньев одного цвета следующее звено может быть любого цвета, с него цвет и счёт начинаются заново. Кристалл тоже сбрасывает цвет и счёт. «Осколок жернова» −1, «Жернов» −2 (не меньше 2). 0 — выкл. В походе — 6, кристаллы выключены.'),
  { kind: 'bool', key: 'colorShiftKeep', group: 'Кристаллы', label: 'Смена цвета: свобода держится', stage: 4,
    hint: 'Пока цепь берёт звенья того же цвета, цвет остаётся свободным (счёт растёт); новый отрезок начинает только звено другого цвета. Смены — на каждом кратном шагу смены звене отрезка (при шаге 6: 6-м, 12-м…). Выкл. — свободное звено того же цвета начинает счёт заново. В походе — вкл.' },
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
  n('colorCount', 'Появление', 'Цветов у новых врагов', 2, 5, 1, 5, '', 'Только песочница (исследование петли): новые враги — первых N цветов и цветов врагов арены; 5 — с пятым цветом (задача 45, для снимков). В походе — 4 или по ряду (ниже), на «Испытании VIII» — 5.'),
  { kind: 'bool', key: 'colorsByRow', group: 'Появление', label: 'Поход: палитра по рядам (исследование петли)', stage: 5,
    hint: 'Ряды похода 1–2 — 2 цвета, 3–4 — 3, с 5-го — 4. Выключено — всегда 4.' },
  n('maxEnemies', 'Появление', 'Предел врагов на арене', 1, 150, 1, 1, '', 'При пределе новые ждут в очереди меток.'),
  n('markerDelay', 'Появление', 'Задержка метки', 0, 3, 0.1, 1, 'с'),
  n('spawnMinDistance', 'Появление', 'Запретный радиус у героя', 0, 6, 0.25, 1, 'ед.'),
  { kind: 'bool', key: 'spawnGroupHold', group: 'Появление', label: 'Группа держится вместе', stage: 5,
    hint: 'Члену группы негде встать у якоря — он ждёт у того же якоря до 1 с, потом новый якорь всей оставшейся группе. Выключено — член группы теряет якорь и может выйти далеко от своих. В походе включено.' },
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
  { kind: 'bool', key: 'shiftAtPointer', group: 'Цепь', label: 'Смена цвета — только точкой курсора', stage: 5,
    hint: 'Пока цвет цепи свободен («Смена цвета»), тело другого цвета берётся только там, где остановилась мышь (или нажатием). Протяжка и неподвижный курсор берут только цвет цепи, другие цвета пропускают без отказа.' },
  { kind: 'bool', key: 'holdNearest', group: 'Цепь', label: 'Неподвижный курсор берёт ближайшее', stage: 5,
    hint: 'Зажатый неподвижный курсор берёт тело, только если оно ближе к курсору, чем любое звено цепи. Курсор на звене цепи ничего не берёт и не обрезает.' },
  { kind: 'bool', key: 'holdHeroLink', group: 'Цепь', label: 'Неподвижный курсор у героя ничего не берёт', stage: 5,
    hint: 'Курсор в круге героя считает героя звеном цепи: неподвижный курсор и протяжка там ничего не берут и не отменяют, событие мыши на пустой цепи ничего не берёт. Единственное звено курсор на героя по-прежнему снимает; нажатие не меняется.' },
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
  n('focusGuardLinks', 'Фокус', 'Щит фокуса: со звена', 0, 10, 1, 5, '', 'С этого вражеского звена цепи, пока фокус не пуст, касания и удары не ранят (взрыв гоблина ранит). 0 — выкл. В походе — 3.'),
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
  n('potionCap', 'Расходники', 'Зелий лечения в руке: не больше', 0, 9, 1, 5, '', 'Задача 41. При полной руке зелье-добыча не подбирается и лежит до конца боя; цепь его не берёт («рука полна»). 0 — без предела. В новом походе — 3.'),
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
      { value: 'hourglass', label: 'Песочные часы' }, { value: 'nimble-paws', label: 'Ловкие лапы' }, { value: 'ash-ward', label: 'Пепельный оберег' },
      // Task 44: the fusions (each with its parts, kit.ts `kitOf`).
      { value: 'fusion-ice-seal', label: 'Сплав: Ледяная печать' }, { value: 'fusion-spear', label: 'Сплав: Копьё' }, { value: 'fusion-boomerang', label: 'Сплав: Бумеранг' },
      // Task 46.
      { value: 'fusion-brand', label: 'Сплав: Клеймо' }, { value: 'fusion-hunter-blast', label: 'Сплав: Подрыв' }, { value: 'fusion-frost-wave', label: 'Сплав: Ледяная волна' }] },
  n('endBlastMinLinks', 'Талисманы', '«Взрыв на конце»: звеньев от', 1, 6, 1, 5, '', 'Молот срабатывает, если проход дошёл до стольких вражеских звеньев (погибшие по пути и выживший на конце считаются). В походе — 3.'),
  n('fireMinLinks', 'Талисманы', '«Огненный проход»: звеньев от', 1, 6, 1, 5, '', 'Путь прохода загорается, когда проход дошёл до стольких вражеских звеньев (погибшие по пути и выживший на конце считаются), — весь путь от начала разом. В походе — 3.'),
  { kind: 'bool', key: 'returnFixed', group: 'Талисманы', label: '«Возврат»: путь и тела при отпускании', stage: 5,
    hint: 'Задача 29. Отпускание фиксирует путь назад и тела второго прохода, как их показала подсветка; ушедшее с пути тело всё равно получает удар. В походе выключено (до задачи 30).' },
  { kind: 'bool', key: 'returnShadowEnd', group: 'Талисманы', label: '«Возврат»: тень видит конец прохода', stage: 5,
    hint: 'Подсветка бега «Возврата» учитывает «Ударную волну» той же цепи: тела, которые волна убьёт, бег не бьёт, раненые — с меньшим HP. С «путь и тела при отпускании» меняет и сам бег. Выкл. — прежняя тень.' },
  { kind: 'bool', key: 'returnWaveFixed', group: 'Талисманы', label: '«Возврат»: тела волны при отпускании', stage: 5,
    hint: 'С «Возвратом», «путь и тела при отпускании» и «тень видит конец прохода»: отпускание фиксирует и тела «Ударной волны» той же цепи. Тело, ушедшее из круга за проход, всё равно получает удар; вошедшее — нет. Выкл. — волна бьёт тех, кто в круге в конце прохода.' },
  { kind: 'bool', key: 'counterWindow', group: 'Талисманы', label: 'Счётчики: окно — одна цепь', stage: 5,
    hint: 'Только песочница (со следующей арены). Восемь талисманов-счётчиков считают внутри одной цепи: «Острие» — 3-е вражеское звено +2 силы; «Улов» — цепь с 3+ убийствами даёт бесплатный прыжок на 5 с; «Призма» — звенья после кристалла или смены цвета +1 силы (без энергии); «Ударная волна» — цепь от N звеньев; «Добивание» — последнее звено самое крепкое и погибло; «Охотник на элит» — и после крепкого; «Длинная рука» — с 3-го звена R ×1,5; «Иней на клинке» — цепь 3+ на выжившем. Выкл. — прежние счётчики между цепями. В походе выключено.' },
  n('shockwaveLinks', 'Талисманы', '«Ударная волна» (окно — цепь): звеньев от', 2, 12, 1, 5, '', 'Только при «Счётчики: окно — одна цепь». Без него — 8.'),
  // Task 50 «Сноровка»: the counters' rank II (only for a counter on rank II in the kit, `Loadout.honed`; only with the chain window).
  n('honeEdgeEvery', 'Ранг II', '«Острие» II: каждое N-е звено +2', 2, 6, 1, 5, '', 'Задача 50. Только счётчик на ранге II и окно — одна цепь: вместо одного 3-го звена — каждое N-е (3, 6, 9…).'),
  n('honeCatchPower', 'Ранг II', '«Улов» II: сила первого звена', 0, 6, 1, 5, '', 'Бесплатный прыжок заряжает следующую отпущенную цепь: её первое вражеское звено получает столько силы.'),
  n('honePrismEnergy', 'Ранг II', '«Призма» II: энергия за смену цвета', 0, 3, 1, 5, '', 'За каждую смену цвета в проходе (до 7).'),
  n('honeWaveStart', 'Ранг II', '«Ударная волна» II: радиус второй волны', 0.5, 4, 0.25, 5, 'ед.', 'Вторая волна — вокруг точки, где герой стоял при отпускании, в тот же такт.'),
  n('honeFinisherKills', 'Ранг II', '«Добивание» II: щит от убийств', 1, 5, 1, 5, '', 'Последнее звено — самое крепкое и погибло: щит после цепи ×2 и у цепи с этим числом убийств.'),
  n('honeHunterPlates', 'Ранг II', '«Охотник на элит» II: пластин до удара', 0, 3, 1, 5, '', 'Элита в цепи теряет столько пластин перед ударом звена.'),
  n('honeArmPower', 'Ранг II', '«Длинная рука» II: сила дальнего звена', 0, 4, 1, 5, '', 'Звено дальше обычного R (без ×1,5) от прежнего звена получает столько силы.'),
  n('honeFrostNear', 'Ранг II', '«Иней на клинке» II: радиус соседа', 0.5, 4, 0.25, 5, 'ед.', 'Ближайший к выжившему враг в этом радиусе (не Жнец) замерзает тоже. Сосед выбирается при отпускании.'),
  n('honeFrostTime', 'Ранг II', '«Иней на клинке» II: заморозка соседа', 0.5, 6, 0.5, 5, 'с'),
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
  { kind: 'bool', key: 'archerPoint', group: 'Лучник', label: 'Выстрел в точку (фаза A)', stage: 5,
    hint: 'Лучник помечает кругом точку героя в момент прицела; в конце заполнения стрела падает туда и ранит только героя (враги не задеваются, стены между лучником и точкой стрелу не режут). Выключено — прежняя линия этапа 2. В походе включено всегда.' },
  n('archerCooldown', 'Лучник', 'Выстрел раз в', 0.5, 10, 0.1, 5, 'с', 'Прицел (метка или линия) входит в этот срок.'),
  n('archerWindup', 'Лучник', 'Прицел: заполнение метки (линии)', 0.1, 3, 0.1, 5, 'с'),
  n('archerFirstDelay', 'Лучник', 'Первый прицел: через … после появления', 0, 10, 0.1, 5, 'с'),
  n('archerRange', 'Лучник', 'Дальность прицела (длина линии)', 1, 16, 0.25, 5, 'ед.', 'Целится, если герой не дальше и виден (стены и деревья закрывают, вода — нет). Старая линия: стены и деревья её обрезают.'),
  n('archerMarkRadius', 'Лучник', 'Метка: радиус круга', 0.25, 3, 0.05, 5, 'ед.', 'Выстрел в точку: стрела ранит героя, если его тело касается круга.'),
  n('archerWidth', 'Лучник', 'Ширина линии (старый путь)', 0.1, 2, 0.05, 5, 'ед.', 'Только при выключенном «Выстреле в точку».'),
  n('archerDamage', 'Лучник', 'Урон стрелы герою', 0, 6, 1, 5),
  n('archerHit', 'Лучник', 'Удар стрелы по врагу (старый путь)', 0, 6, 1, 5, '', 'Только при выключенном «Выстреле в точку»: враг на линии гибнет, если удар не меньше его HP (слабые — всегда); иначе теряет HP. Убийства стрелой игроку не засчитываются. Выстрел в точку врагов не задевает.'),
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
  { kind: 'bool', key: 'loopEnabled', group: 'Петля', label: 'Петля (печать)', stage: 5,
    hint: 'Исследование петли, шаг 2. Только песочница. Цепь замыкается указателем на первом звене (от 4 врагов) или на герое (от 3): в конце прохода все внутри получают удар печати и оковы.' },
  n('loopMinLinks', 'Петля', 'Замыкание на первое: врагов от', 3, 10, 1, 5),
  { kind: 'bool', key: 'loopHeroCloses', group: 'Петля', label: 'Замыкание на героя', stage: 5 },
  n('loopHeroMinLinks', 'Петля', 'Замыкание на героя: врагов от', 2, 10, 1, 5),
  n('sealHold', 'Петля', 'Оковы', 0, 5, 0.1, 5, 'с', 'Удар печати — ⌊(n − 2) ÷ 2⌋, не меньше 1 (n — враги кольца); выжившие стоят столько.'),
  n('sealHoldLong', 'Петля', 'Оковы длинной петли', 0, 5, 0.1, 5, 'с'),
  n('sealLongLinks', 'Петля', 'Длинная петля: врагов от', 4, 20, 1, 5),
  { kind: 'bool', key: 'loopHint', group: 'Петля', label: 'Подсказка петли (эксперимент)', stage: 5,
    hint: 'В фокусе до первого звена слабо подсвечена одна лучшая петля от героя.' },
  { kind: 'bool', key: 'pierceEnabled', group: 'Прямая', label: 'Прямая (пробой)', stage: 5,
    hint: 'Исследование петли, шаг 3. Только песочница. Хвост цепи из последних 3 врагов почти прямой, последнее звено гибнет, сила после него ≥ 1: проход продолжается по линии, все тела в коридоре получают силу цепи (она не тратится).' },
  n('pierceTurn', 'Прямая', 'Поворот хвоста не больше', 0, 60, 1, 5, '°', 'Каждый поворот хвоста (последние 3 вражеских звена и предметы между ними). Отрезок герой → первое звено не считается.'),
  n('pierceLength', 'Прямая', 'Длина пробоя', 0.5, 5, 0.125, 5, 'ед.', 'От последнего звена по линии; препятствие, край и обрыв обрезают.'),
  n('pierceCorridor', 'Прямая', 'Коридор: от линии не дальше', 0.1, 1.5, 0.05, 5, 'ед.', 'До центра тела.'),
  n('fusionSpearFactor', 'Сплавы', '«Копьё»: длина пробоя ×', 1, 4, 0.25, 5, '×', 'Задача 44. Только с «Копьём» в ките: длина «Прямой» умножается (R на неё не влияет).'),
  n('fusionSpearPlates', 'Сплавы', '«Копьё»: пластин с элиты', 1, 4, 1, 5, '', 'Пробой «Копья» снимает с элиты столько пластин вместо одной.'),
  n('fusionIceTime', 'Сплавы', '«Ледяная печать»: заморозка', 0.5, 10, 0.5, 5, 'с', 'Выжившие внутри кольца замерзают на наибольшее из оков «Печати» и этого числа.'),
  { kind: 'bool', key: 'fusionIceBrittle', group: 'Сплавы', label: '«Ледяная печать»: хрупкость ×2', stage: 5, hint: 'Замёрзшие печатью хрупки, как от холода-расходника: следующий удар цепи ×2.' },
  n('fusionBrandReach', 'Сплавы', '«Клеймо»: полоса краски от пути', 0, 3, 0.1, 5, 'ед.', 'Задача 46. Только с «Клеймом» в ките: путь загорелся — тела в полосе (плюс радиус тела) принимают цвет цепи.'),
  n('fusionBlastFactor', 'Сплавы', '«Подрыв»: радиус взрыва ×', 1, 3, 0.05, 5, '×', 'Последнее звено — элита или крепкий: радиус «Взрыва на конце» умножается.'),
  n('fusionBlastPower', 'Сплавы', '«Подрыв»: удар сверх 1', 0, 6, 1, 5, '', 'Удар подрыва — 1 и это число.'),
  n('fusionBlastPlates', 'Сплавы', '«Подрыв»: пластин с элиты', 1, 4, 1, 5, '', 'Броня босса (ядра, рыцарь, самострел) — 1 пластина.'),
  n('fusionWaveTime', 'Сплавы', '«Ледяная волна»: заморозка', 0.5, 10, 0.5, 5, 'с', 'Выжившие после удара волны замерзают на наибольшее из своего холода и этого числа.'),
  { kind: 'bool', key: 'fusionWaveBrittle', group: 'Сплавы', label: '«Ледяная волна»: хрупкость ×2', stage: 5, hint: 'Замёрзшие волной хрупки, как от холода-расходника: следующий удар цепи ×2.' },
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
  // Elite behaviours (eliteBehaviors.ts).
  { kind: 'bool', key: 'eliteBehaviors', group: 'Элиты: поведение', label: 'Поведение элит по видам', stage: 5,
    hint: 'Обычный — ведёт строем слабых своего цвета; волк — вожак (вой за 2, бросок длиннее); кабан — два рывка подряд. В походе включено всегда.' },
  n('eliteLeadCount', 'Элиты: поведение', 'Строй: слабых за элитой', 0, 6, 1, 5, '', 'Ближайшие слабые (0 HP) обычные враги её цвета идут колонной за ней.'),
  n('eliteLeadRadius', 'Элиты: поведение', 'Строй: берёт в радиусе', 0.5, 12, 0.25, 5, 'ед.'),
  n('eliteLeadSpacing', 'Элиты: поведение', 'Строй: шаг колонны', 0.5, 3, 0.05, 5, 'ед.', 'Меньше R цепи: колонна — готовая цепь.'),
  n('wolfLeaderSettleCount', 'Элиты: поведение', 'Вожак: вой за волков', 1, 8, 1, 5, '', 'Пока вожак в кольце, стая воет, когда столько волков на местах.'),
  n('wolfLeaderThrow', 'Элиты: поведение', 'Вожак: длина броска', 0.5, 10, 0.25, 5, 'ед.', 'Бросок воя, в котором вожак.'),
  n('boarSecondWindup', 'Элиты: поведение', 'Кабан: замах второго рывка', 0.1, 3, 0.05, 5, 'с', 'Второй рывок — по новой линии к герою.'),
  // Package «Урон имеет значение» (docs/realtime-damage.md).
  { kind: 'bool', key: 'eliteArmor', group: 'Броня элит', label: 'Броня элит (пластины)', stage: 5,
    hint: 'Элита получает пластины вместо HP ×2 (HP — как у вида). Удар снимает пластину (бомба — две), цепь проходит сквозь элиту. 0 пластин — окно: стоит, не бьёт. В походе включено всегда.' },
  n('elitePlates', 'Броня элит', 'Пластин у элиты', 1, 6, 1, 5, '', 'Только песочница. В походе по ряду: 1–4 — 2, 5–8 — 3, 9–10 — 4. «Стремительный» −1, «Толстый» +1.'),
  n('eliteWindow', 'Броня элит', 'Окно без пластин', 0.5, 10, 0.1, 5, 'с', 'Элита стоит, не бьёт, механика выключена.'),
  n('eliteMarkerDelay', 'Броня элит', 'Метка элиты', 0, 5, 0.1, 5, 'с', 'Новичок, который станет элитой, объявлен заранее: метка крупнее, с лимонным ободком, ждёт столько.'),
  n('eliteCleanWindow', 'Броня элит', 'Чистый слом: первые', 0, 10, 0.1, 5, 'с', 'Убийство в эти первые секунды окна — +1 энергия и добыча ×2; позже — обычная добыча.'),
  n('elitePlateRegrow', 'Броня элит', 'Пластина отрастает раз в', 0.5, 20, 0.5, 5, 'с', 'После окна сразу 1 пластина, дальше по одной. Холод останавливает.'),
  { kind: 'bool', key: 'eliteLootOpens', group: 'Броня элит', label: 'Добыча открывает расходник', stage: 5,
    hint: 'Пока в походе не открыт ни один расходник, добыча элиты с бронёй открывает один (вид — по потоку добычи) и роняет его вместо ресурсов. Дальше — как раньше. В походе включено всегда.' },
  { kind: 'bool', key: 'eliteMetKinds', group: 'Броня элит', label: 'Элита только из встреченных видов (поход)', stage: 5,
    hint: 'Новичок становится элитой, только если его вид в списке снаряжения боя. Список даёт поход: первый ряд элит — виды, встреченные раньше и с поведением элиты. В песочнице списка нет — ничего не меняет.' },
  { kind: 'bool', key: 'affixMetKinds', group: 'Броня элит', label: 'Свойства элит только из встреченных (поход)', stage: 5,
    hint: 'Свойства элиты выпадают только из типов в списке снаряжения боя. Список даёт поход с расписанием: встреченные типы и не больше одного нового. В песочнице списка нет — ничего не меняет.' },
  n('eliteTouchDamage', 'Броня элит', 'Касание элиты', 0, 6, 1, 5, '', 'Вместо обычного касания; прибавка урона элиты к касанию не добавляется.'),
  n('eliteKnockback', 'Броня элит', 'Касание элиты отбрасывает героя', 0, 4, 0.25, 5, 'ед.'),
  n('eliteArmorCap', 'Броня элит', 'Не больше элит до целей (броня)', 0, 10, 1, 5),
  n('eliteArmorCapAfter', 'Броня элит', 'Не больше элит после целей (броня)', 0, 10, 1, 5),
  n('toughHpMax', 'Крепкие враги', 'HP крепкого: до', 2, 4, 1, 5, '', 'Крепкий новичок получает от 1 до стольких HP, равновероятно. В походе по ряду: 1–4 — 2, 5–8 — 3, с 9 — 4.'),
  { kind: 'bool', key: 'toughTouch', group: 'Крепкие враги', label: 'Касание крепких и элит сильнее', stage: 5,
    hint: 'Касание врага с HP от 2 (в момент удара) и элиты — урон ниже; HP 0–1 — обычное касание. В походе включено всегда.' },
  n('toughTouchDamage', 'Крепкие враги', 'Касание крепкого', 0, 6, 1, 5),
  // Casino stage 1: «Однорукий гоблин» (slot.ts).
  { kind: 'bool', key: 'slot', group: 'Однорукий гоблин', label: 'Однорукий гоблин (слот)', stage: 5,
    hint: 'Каменный идол с рычагом. В походе появляется после целей в каждом бою (с ряда 1, не у Тюремщика и боссов). В песочнице — кнопка «Гоблин». Цепь на рычаг крутит 3 барабана.' },
  n('slotChance', 'Однорукий гоблин', 'Шанс в бою', 0, 1, 0.05, 5, '', 'Только поход: бросок на бой.'),
  n('slotDelay', 'Однорукий гоблин', 'Появляется после целей через', 0, 30, 0.5, 5, 'с'),
  n('slotMarker', 'Однорукий гоблин', 'Метка появления', 0, 5, 0.1, 5, 'с', 'Пока метка, рычаг не цель.'),
  n('slotNear', 'Однорукий гоблин', 'Место: не ближе', 0, 10, 0.5, 5, 'ед.'),
  n('slotFar', 'Однорукий гоблин', 'Место: не дальше', 1, 15, 0.5, 5, 'ед.'),
  n('slotPulls', 'Однорукий гоблин', 'Рывков за бой', 1, 10, 1, 5),
  n('slotCooldown', 'Однорукий гоблин', 'Между рывками', 0, 30, 0.5, 5, 'с'),
  n('slotSpin', 'Однорукий гоблин', 'Барабаны крутятся', 0, 5, 0.1, 5, 'с', 'Эффект — когда встаёт третий барабан.'),
  n('slotSkulls', 'Однорукий гоблин', 'Черепов на барабане', 0, 6, 1, 5, '', 'Череп выпадает с шансом s ÷ (4 + s). После рывка +1 череп (барабаны по очереди).'),
  n('slotLinksPerSkull', 'Однорукий гоблин', 'Звеньев за снятый череп', 1, 6, 1, 5, '', 'Считаются вражеские звенья, по которым рывок реально ударил.'),
  n('slotRainWaves', 'Однорукий гоблин', 'Дождь: волн', 1, 6, 1, 5),
  n('slotRainMin', 'Однорукий гоблин', 'Дождь: меток в волне от', 1, 30, 1, 5),
  n('slotRainMax', 'Однорукий гоблин', 'Дождь: меток в волне до', 1, 30, 1, 5),
  n('slotRainStep', 'Однорукий гоблин', 'Дождь: шаг волн', 0.1, 3, 0.1, 5, 'с'),
  n('slotVolleyMarks', 'Однорукий гоблин', 'Залп: меток', 1, 12, 1, 5),
  n('slotVolleyRadius', 'Однорукий гоблин', 'Залп: радиус', 0.5, 6, 0.25, 5, 'ед.'),
  n('slotDamage', 'Однорукий гоблин', 'Урон стрелы', 0, 5, 1, 5),
  { kind: 'bool', key: 'slotBust', group: 'Однорукий гоблин', label: '«Перебор»: рискованные рывки', stage: 5,
    hint: 'После безопасных рывков каждый рывок может взорвать гоблина: урон герою где угодно, защиты нет (с «взрывом по площади» — круг и фитиль). Не взорвался — тройка доброго символа. В походе включено.' },
  n('slotSafePulls', 'Однорукий гоблин', '«Перебор»: безопасных рывков', 0, 10, 1, 5),
  n('slotBustChance', 'Однорукий гоблин', '«Перебор»: шанс взрыва', 0, 1, 0.05, 5),
  n('slotBustDamage', 'Однорукий гоблин', '«Перебор»: урон взрыва', 0, 15, 1, 5, 'HP'),
  n('slotSafePerLongChain', 'Однорукий гоблин', 'Длинная цепь: +безопасных рывков', 0, 3, 1, 5, '',
    'Каждая цепь из N+ врагов за бой (до и после появления гоблина) даёт столько безопасных рывков; последний рывок всегда с риском. 0 — выкл. В походе — 1.'),
  n('slotLongChainLinks', 'Однорукий гоблин', 'Длинная цепь: врагов от', 2, 12, 1, 5, '', 'Вражеские звенья, до которых дошёл рывок (удар, снятая пластина, павший по пути).'),
  { kind: 'bool', key: 'slotBustArea', group: 'Однорукий гоблин', label: '«Перебор»: взрыв по площади', stage: 5,
    hint: 'Взрыв не бьёт героя где угодно: идол загорается, круг вокруг него, через фитиль взрыв бьёт всех в круге. Героя щадят неуязвимость, проход и прыжок; щит цепи и щит фокуса не щадят. В походе включено.' },
  n('slotBustRadius', 'Однорукий гоблин', 'Взрыв по площади: радиус', 0.5, 8, 0.25, 5, 'ед.'),
  n('slotBustFuse', 'Однорукий гоблин', 'Взрыв по площади: фитиль', 0, 5, 0.1, 5, 'с', 'От остановки барабанов до взрыва.'),
  n('slotBustEnemyDamage', 'Однорукий гоблин', 'Взрыв по площади: урон врагам', 0, 10, 1, 5, '', 'Убитые — зачёт игроку.'),
  n('slotAppearAt', 'Однорукий гоблин', 'Появляется не позже, с боя', 0, 60, 0.5, 5, 'с', 'Бросок на этой секунде боя или после целей — что раньше. 0 — только после целей. В походе — 5.'),
  { kind: 'bool', key: 'slotSafeRandom', group: 'Однорукий гоблин', label: '«Перебор»: безопасных рывков — случайно', stage: 5,
    hint: 'Гоблин при появлении бросает число безопасных рывков от 0 до «безопасных рывков» (равновероятно). Игроку число не показано. В походе включено (0–3).' },
  { kind: 'bool', key: 'slotSafeTriple', group: 'Однорукий гоблин', label: 'Безопасный рывок — тройка', stage: 5,
    hint: 'Безопасный рывок всегда даёт тройку доброго символа: без черепов, дождя, залпа и пар. В походе и прологе включено.' },
  { kind: 'bool', key: 'slotPullGoalSettled', group: 'Однорукий гоблин', label: 'Цель «рычаг» — после барабанов', stage: 5,
    hint: 'Цель арены «рычаг» засчитывает рывок, когда встали барабаны, а перебор — когда прогремел взрыв. Только комната 8 пролога.' },
  // Casino «Котёл» (purse.ts, docs/realtime-casino.md).
  { kind: 'bool', key: 'purse', group: 'Котёл', label: 'Котёл (угли × жар)', stage: 5,
    hint: 'Цепь кладёт в котёл чек: угли × жар × кристаллы. Угли: слабый 1, крепкий — его HP, пластина 2, элита +5. Жар: +1 за каждое 3-е звено, +1 добивание (4+ звеньев). В двери — 1 ресурс за «Углей за ресурс» (60), не больше 3 без ставок. Только песочница: в походе выключен с 12.10.2026.' },
  n('purseRate', 'Котёл', 'Углей за ресурс', 10, 200, 5, 5, '', 'В двери: ресурс крафта за каждые N углей, не больше 3 без ставок. Котла в походе нет с 12.10.2026.'),
  { kind: 'bool', key: 'greedByDeeds', group: 'Котёл', label: 'Раздув за дела', stage: 5,
    hint: 'Только с котлом. После целей каждые 2 цепи из 3+ врагов поднимают ступень котла: ×1 → ×1,5 → ×2 → ×3. Удар по герою снимает ступень. В двери котёл × ступень; потолок выплаты прежний. Котла в походе нет с 12.10.2026 — правило там не действует.' },
  { kind: 'bool', key: 'doorFinale', group: 'Котёл', label: 'Финальная цепь', stage: 5,
    hint: 'Только с котлом. Цепь, которая входит в открытую дверь, получает +1 жар в чеке (прогноз «≈ N · дверь +1» — от 1 звена). Выход ходьбой или прыжком — без бонуса. Котла в походе нет с 12.10.2026 — правило там не действует.' },
  // Casino «Ставка клятвы» (oath.ts, docs/realtime-casino.md).
  { kind: 'bool', key: 'oathStake', group: 'Ставка клятвы', label: 'Ставка клятвы', stage: 5,
    hint: 'Клятва на бой: выполнил — котёл ×2 в двери, нарушил — ×0,5, бой идёт дальше. В походе выключена с 12.10.2026. В песочнице — выбор клятвы ниже.' },
  // Casino «Кость у двери» (run/rtRun.ts, docs/realtime-casino.md).
  { kind: 'bool', key: 'doorDie', group: 'Котёл', label: 'Кость у двери (поход)', stage: 5,
    hint: 'Только поход: после победы с котлом больше 0 — экран кости. «Забрать» — котёл как есть, «Бросить» — 1–3 ×0,5, 4–6 ×2. В походе выключена с 12.10.2026; в песочнице не действует.' },
  // B7 К9 «Игорный круг гоблинов» (run/rtRun.ts, docs/realtime-casino.md).
  { kind: 'bool', key: 'goblinCircle', group: 'Котёл', label: 'Игорный круг (поход)', stage: 5,
    hint: 'Только поход: узел события с ряда 3 с шансом 30 % — игорный круг гоблинов (не больше одного за поход, нужен хотя бы 1 ресурс): «Кости» и «Колесо костей», до 3 игр. В походе включено всегда; в песочнице не действует.' },
  // Roster mix (run/arenaPools.ts, docs/realtime-phase-a.md, section 4).
  { kind: 'bool', key: 'rosterMix', group: 'Составы', label: 'Составы Заставы и Брода (поход)', stage: 5,
    hint: 'Только поход: «Застава» и «Брод» примерно в половине боёв берут состав пула из встреченных видов («Шаманский щит» — не на «Броде»); «Логово» — на рядах 6–8. В походе включено всегда; в песочнице не действует.' },
  // Task 12 «Отмеченные — атаман или орда» (sim/arenas.ts `markedGoal`, docs/realtime-slice.md, section 5).
  { kind: 'bool', key: 'markedGoals', group: 'Составы', label: 'Отмеченные: атаман или орда', stage: 5,
    hint: 'Логово — орда из 12 в центре; Стрелковая гряда, Брод, Круг шамана — один атаман с большим HP (не меньше HP крепкого ряда + 2), досягаем и нажимается как элита. Действует с нового боя арены. В походе включено (поход до 13.10.2026 — прежние расстановки).' },
  // К7 «Проклятый сундук» (chest.ts, docs/realtime-casino.md).
  { kind: 'bool', key: 'cursedChest', group: 'Котёл', label: 'Проклятый сундук', stage: 5,
    hint: 'Только «Застава»: в её точке стоит сундук (новый бой арены). Взять — звеном цепи любого цвета или касанием. Проклятие: касание врага +1 (не Жнец; стрелы, иглы, взрывы, шипы — без +1), пока проход не убьёт 12 врагов, или до конца боя. В походе включено всегда; награда — экран талисманов после победы.' },
  // Task 14 «Котомка у двери» (bag.ts, docs/realtime-slice.md).
  { kind: 'bool', key: 'doorBag', group: 'Котомка у двери', label: 'Котомка у двери', stage: 5,
    hint: 'С открытием двери появляется котомка: убийства игрока после целей наполняют три ступени (10, 20, 35 — 1, 2, 3 ресурса). Потеря HP откатывает незаполненную ступень к её началу, заполненные остаются. Платит дверь; смерть — ничего. В походе включено с ряда 2 (кроме Тюремщика и финала), в прологе выключено.' },
  n('bagStep1', 'Котомка у двери', 'Ступень 1: убийств после целей', 1, 100, 1, 5),
  n('bagStep2', 'Котомка у двери', 'Ступень 2: убийств после целей', 1, 100, 1, 5),
  n('bagStep3', 'Котомка у двери', 'Ступень 3: убийств после целей', 1, 100, 1, 5),
  n('bagReward1', 'Котомка у двери', 'Ступень 1: ресурсов', 0, 6, 1, 5),
  n('bagReward2', 'Котомка у двери', 'Ступень 2: ресурсов', 0, 6, 1, 5),
  n('bagReward3', 'Котомка у двери', 'Ступень 3: ресурсов', 0, 6, 1, 5),
  // Task 16 «Подвиги» (feat.ts, docs/realtime-slice.md).
  { kind: 'bool', key: 'feats', group: 'Подвиги', label: 'Подвиги (поход)', stage: 5,
    hint: 'Только поход: бой узла может нести подвиг — «Набери N очков», «Продержись N с после целей», «Продержись N с на арене»; награда — у двери. Подвиги приходят со второго похода (после первого Тюремщика). В песочнице подвига узла нет — переключатель ничего не меняет.' },
  // Task 27 «Каркас босса» (enemies/jailer.ts, docs/realtime-elite-behaviors.md).
  { kind: 'bool', key: 'bossFrame', group: 'Босс', label: 'Каркас босса (Тюремщик)', stage: 5,
    hint: 'Ядро и части — враги обычного тела. Отрубленная часть снимает пластину ядра после прохода; фаза, пластины и отчаяние меняются только после прохода. Арена «Тюремщик» включает каркас сама (и в песочнице, и в бою Тюремщика в походе). Без каркаса Тюремщик и гиря — обычные враги.' },
  // Task 28 «Тюремщик в походе» (enemies/jailer.ts, docs/realtime-elite-behaviors.md).
  { kind: 'bool', key: 'bossClears', group: 'Босс', label: 'Смерть босса кончает бой', stage: 5,
    hint: 'Ядро босса умерло — вся толпа гибнет без зачёта игроку (очки, убийства, котомка, котёл не растут), метки появления снимаются, новых врагов нет, дверь открыта, герой больше не теряет HP. Проход, убивший ядро, кончается на нём. Арена «Тюремщик» включает правило сама.' },
  { kind: 'bool', key: 'bossPartLoot', group: 'Босс', label: 'Добыча отрубленной части', stage: 5,
    hint: 'Часть босса, отрубленная игроком, роняет добычу как элита в броне (расходник открытого вида или ресурсы). Включено в походе.' },
  // Task 32 «Бесцветный Тюремщик, больше HP» (enemies/jailer.ts, docs/realtime-elite-behaviors.md).
  { kind: 'bool', key: 'jailerColorless', group: 'Босс', label: 'Тюремщик: бесцветный', stage: 5,
    hint: 'Ядро Тюремщика берёт цепь любого цвета, звеном в любом месте (и первым). Цвет цепи оно не задаёт и не меняет, в счёт «Смены цвета» не входит. Гиря свой цвет хранит. Арена «Тюремщик» включает правило сама.' },
  // Task 33 «Цена „Близнецов“ и „Развилки“» (forms.ts, docs/realtime-prototype.md, 9ф).
  { kind: 'bool', key: 'twinsAlternate', group: 'Талисманы', label: '«Близнецы»: чередование', stage: 5,
    hint: 'Пока цепь идёт по одному цвету пары — как раньше. Когда цепь взяла второй цвет пары, цвета пары чередуются: A-A-Б-A-Б. Тот же цвет подряд — отказ «не тот цвет». Кристалл начинает заново. В походе выключено.' },
  { kind: 'bool', key: 'twinsNoShift', group: 'Талисманы', label: '«Близнецы» выключают «Смену цвета»', stage: 5,
    hint: 'С «Близнецами» в сборке смена цвета не наступает, даже если «Смена цвета: после … звеньев» больше 0. В походе выключено.' },
  n('forkBranches', 'Талисманы', '«Развилка»: развилок за цепь', 0, 4, 1, 5, '', 'Сколько звеньев цепь может взять не от последнего звена (и не от героя с «Якорем»). Потом якорь — снова только последнее звено. 0 — без предела. В походе — 0.'),
  n('forkDwell', 'Талисманы', '«Развилка»: задержка на старом звене', 0, 1, 0.05, 5, 'с', 'Задача 52. 0 — прежнее правило: якорь — любое звено цепи. Больше 0 — якорь последнее звено; курсор, неподвижный на старом звене (не на последнем и не на предыдущем — там шаг назад) столько игровых секунд, делает его якорем: следующее звено берётся только от него. Песочница: 0,25 с; поход: 0.'),
  n('jailerHp', 'Босс', 'Тюремщик: HP ядра', 2, 10, 1, 5, '', 'HP ядра при появлении (новый бой). Арена «Тюремщик» ставит 5, если на панели значение по умолчанию (2).'),
  // Task 48 «Тролль» (enemies/troll.ts, docs/realtime-elite-behaviors.md, «Тролль (задача 48)»).
  { kind: 'bool', key: 'trollWindow', group: 'Тролль', label: 'Окно Тролля', stage: 5,
    hint: 'Ядро Тролля закрыто вне окна: цепь его не берёт («вне окна»), огонь, взрывы, волна, прямая, печать и возврат его не ранят. Окно открывают «Удар дубиной» (1,5 с), «Хвост метёт» (1 с) и «Храп». Одно попадание за окно. Арена «Берлога тролля» включает правило сама.' },
  { kind: 'bool', key: 'trollSolid', group: 'Тролль', label: 'Тела босса — препятствие', stage: 5,
    hint: 'Тела-препятствия босса (Тролль, Главарь): герой не входит в тело ядра и частей — его выталкивает, как от стены; сами тела не сдвигаются. Арены «Берлога тролля» и «Стан Главаря» включают правило сами.' },
  n('trollHp', 'Тролль', 'Тролль: HP ядра', 1, 12, 1, 5, '', 'Со следующего запуска арены.'),
  n('trollPlates', 'Тролль', 'Тролль: пластины ядра', 0, 10, 1, 5, '', 'И потолок отрастания «Храпа». Со следующего запуска арены.'),
  n('trollWindowClub', 'Тролль', 'Окно после «Удара дубиной»', 0.2, 5, 0.1, 5, 'с'),
  n('trollWindowTail', 'Тролль', 'Окно после «Хвост метёт»', 0.2, 5, 0.1, 5, 'с'),
  n('trollSnore', 'Тролль', '«Храп»: длина', 1, 10, 0.5, 5, 'с', 'Всё это время окно открыто. Не задет — отрастает пластина.'),
  n('trollSnoreRegrow', 'Тролль', '«Храп»: пластин за сон', 0, 3, 1, 5, '', '0 — «Храп» без отрастания.'),
  n('trollRoarPeriod', 'Тролль', '«Рык»: раз в', 5, 60, 1, 5, 'с', 'Во второй и третьей фазе; первый — при входе во вторую.'),
  n('trollCrowd', 'Тролль', 'Тролль: толпа', 0.25, 2, 0.05, 5, '×', 'Множитель плотности и темпа пополнения толпы. Арена «Берлога тролля» ставит 0,3, если на панели 1.'),
  // Task 54 «Главарь с котелком» (enemies/chief.ts, docs/realtime-elite-behaviors.md, «Главарь (задача 54)»).
  { kind: 'bool', key: 'chiefFeast', group: 'Главарь', label: '«Обед!» Главаря', stage: 5,
    hint: 'Главарь закрыт вне окна «Обеда!» («вне окна»). В окне его берёт только цепь цвета варева, в которой до него не меньше трёх звеньев этого цвета («в очередь»); одно попадание за окно, другой урон его не ранит. Арена «Стан Главаря» включает правило сама.' },
  n('chiefHp', 'Главарь', 'Главарь: HP ядра', 1, 12, 1, 5, '', 'Со следующего запуска арены.'),
  n('chiefPlates', 'Главарь', 'Главарь: пластины ядра', 0, 10, 1, 5, '', 'Со следующего запуска арены.'),
  n('chiefFeastLinks', 'Главарь', 'Очередь: звеньев цвета варева', 0, 8, 1, 5, '', 'Столько звеньев цвета варева нужно в цепи до Главаря.'),
  n('chiefFeastTime', 'Главарь', '«Обед!»: окно', 1, 10, 0.5, 5, 'с', 'Столько же сидят едоки.'),
  n('chiefFeastGap', 'Главарь', '«Обед!»: перерыв', 1, 20, 0.5, 5, 'с', 'От конца окна до замаха следующего «Обеда!» в первой и второй фазе (в третьей — 4 с).'),
  n('chiefFeastBig', 'Главарь', 'Очередь на два', 0, 12, 1, 5, '', 'Очередь от стольких звеньев снимает две пластины. 0 — никогда.'),
  n('chiefCrowd', 'Главарь', 'Главарь: толпа', 0.25, 2, 0.05, 5, '×', 'Множитель плотности и темпа пополнения толпы на арене «Стан Главаря».'),
  // Task 38 «Гарнизон, шаг 1» (tethers.ts, enemies/garrison.ts, docs/realtime-elite-behaviors.md).
  { kind: 'bool', key: 'tethers', group: 'Гарнизон', label: 'Закон связи', stage: 5,
    hint: 'Поводок — линия между псарём (или Кастеляном) и псом, не звено. Отрезок прохода цепи, пересекающий поводок, рубит его после прохода; подсветка показывает те же поводки. Прыжок, ходьба, круговой удар и расходники не рубят. Сорвавшийся пёс в ярости кусает всех. В походе включено.' },
  n('leashLength', 'Гарнизон', 'Длина поводка', 1, 6, 0.25, 5, 'ед.'),
  n('houndFrenzy', 'Гарнизон', 'Ярость пса', 0, 15, 0.5, 5, 'с', 'Сорвавшийся пёс бежит к ближайшему телу и кусает всех; потом — обычный пёс.'),
  n('houndFrenzyDamage', 'Гарнизон', 'Укус пса в ярости', 0, 4, 1, 5, '', 'Урон укуса врагу (элите — пластина). Убийства яростью игроку не засчитываются.'),
  { kind: 'bool', key: 'guardFormation', group: 'Гарнизон', label: 'Строй стражников', stage: 5,
    hint: 'Стражники идут строем по 3 в линию поперёк пути к герою, шаг 0,9. Без строя — обычные медленные враги. В походе включено.' },
  // Task 40 «Гарнизон, шаг 1б» (enemies/garrison.ts «Ключник»).
  { kind: 'bool', key: 'shackles', group: 'Гарнизон', label: 'Кандалы Ключника', stage: 5,
    hint: 'Ключник надевает кандалы на ближайшего врага рядом (не элиту, не пса, не другого Ключника). Узник стоит и не берётся в цепь. Цепь поперёк кандалов рубит их после прохода — узник свободен для следующей цепи. Нужен закон связи. В походе и на арене «Ров» включено.' },
  n('shacklePeriod', 'Гарнизон', 'Кандалы: раз в', 1, 20, 0.5, 5, 'с', 'Первые кандалы — через 3 с после появления Ключника.'),
  n('shackleRange', 'Гарнизон', 'Кандалы: дальность', 1, 8, 0.25, 5, 'ед.'),
  n('shackleMax', 'Гарнизон', 'Кандалы: узников на Ключника', 1, 5, 1, 5),
  // Task 41 «Узник на воле» (enemies/garrison.ts `riotStep`).
  { kind: 'bool', key: 'prisonerRiot', group: 'Гарнизон', label: 'Узник срывается после рубки', stage: 5,
    hint: 'Кандалы, разрубленные цепью, спускают узника: как сорвавшийся пёс, он бежит к ближайшему телу и кусает врагов (убийства не засчитываются игроку), потом — обычный враг. Смерть Ключника освобождает узника без срыва. В походе включено.' },
  // Task 43 «Арбалетчик» (enemies/crossbow.ts).
  n('crossbowWindup', 'Гарнизон', 'Арбалет: замах', 0.2, 3, 0.1, 5, 'с', 'Линия фиксируется в начале замаха: от арбалета через героя до стены. Болт бьёт первое тело на линии.'),
  n('crossbowReload', 'Гарнизон', 'Арбалет: перезарядка', 0, 10, 0.5, 5, 'с'),
  n('crossbowDamage', 'Гарнизон', 'Арбалет: урон героя', 0, 5, 1, 5, '', 'Врага болт убивает (элита теряет пластину); такие убийства не засчитываются ни игроку, ни в цель «убей N»; отмеченная цель — засчитывается.'),
  n('crossbowNear', 'Гарнизон', 'Арбалетчик: ближе не подходит', 1, 10, 0.5, 5, 'ед.'),
  n('crossbowFar', 'Гарнизон', 'Арбалетчик: дальше не отходит', 1, 12, 0.5, 5, 'ед.'),
  // Task 43 «Кастелян полный» (enemies/garrison.ts; the arena's template when the fight starts).
  { kind: 'bool', key: 'castellanFull', group: 'Гарнизон', label: 'Кастелян полный', stage: 5,
    hint: '«Двор кастеляна» играется полным: ров, решётка и три рычага, арбалет на станке, три фазы. Действует со следующего запуска арены. «Двор кастеляна (полный)» включает его сам; в походе включено.' },
  n('castellanPlates', 'Гарнизон', 'Кастелян полный: пластины ядра', 1, 8, 1, 5, '', 'Со следующего запуска арены.'),
  n('castellanCrowd', 'Гарнизон', 'Кастелян полный: толпа двора', 0.25, 2, 0.05, 5, '×', 'Множитель плотности и темпа пополнения толпы (интервал групп ÷ множитель).'),
  n('castellanGuardPeriod', 'Гарнизон', 'Кастелян полный: «Караул!» раз в', 5, 60, 1, 5, 'с'),
  // Task 43 «Рыцарь» (enemies/garrison.ts).
  n('knightPlates', 'Гарнизон', 'Рыцарь: пластин лат', 0, 6, 1, 5, '', 'Каждая цепь через рыцаря снимает одну пластину; пока латы целы, HP не теряет; латы не растут. После прохода, снявшего последнюю, — наступление.'),
  n('knightHp', 'Гарнизон', 'Рыцарь: HP', 0, 8, 1, 5),
  n('knightTouch', 'Гарнизон', 'Рыцарь: касание', 0, 5, 1, 5),
  n('knightChargeWindup', 'Гарнизон', 'Рыцарь: замах рывка', 0.2, 3, 0.1, 5, 'с', 'Полоса 5 × 0,8 от рыцаря к герою; рыцарь пробегает её до конца.'),
  n('knightChargeDamage', 'Гарнизон', 'Рыцарь: урон рывка', 0, 5, 1, 5),
  n('knightSwingWindup', 'Гарнизон', 'Рыцарь: замах размаха', 0.2, 3, 0.1, 5, 'с'),
  n('knightSwingRadius', 'Гарнизон', 'Рыцарь: радиус размаха', 0.5, 4, 0.1, 5, 'ед.', 'Враги в круге теряют 1 HP (элита — пластину); убийства не засчитываются игроку.'),
  n('knightSwingDamage', 'Гарнизон', 'Рыцарь: урон размаха', 0, 5, 1, 5),
  n('knightPause', 'Гарнизон', 'Рыцарь: пауза между приёмами', 0.5, 6, 0.25, 5, 'с'),
  // Task 55а «Замок: толчок» (sim/shove.ts, sim/enemies/castle.ts).
  { kind: 'bool', key: 'shove', group: 'Замок', label: 'Толчок', stage: 5,
    hint: 'Вещь (бочка, шкаф) — последнее звено цепи; конец прохода толкает её по последнему отрезку: давит слабых, бьёт первое крепкое. Арены замка включают сами.' },
  n('shoveDistance', 'Замок', 'Толчок шкафа: длина', 1, 8, 0.25, 5, 'ед.'),
  n('shoveSpeed', 'Замок', 'Толчок: скорость', 2, 24, 1, 5, 'ед./с'),
  n('shoveImpact', 'Замок', 'Шкаф: удар по крепкому', 0, 5, 1, 5),
  n('barrelRoll', 'Замок', 'Бочка: путь не дальше', 2, 30, 1, 5, 'ед.'),
  n('barrelImpact', 'Замок', 'Бочка: удар по крепкому', 0, 5, 1, 5),
  n('wardrobePeriod', 'Замок', 'Падение шкафа: отдых', 1, 15, 0.5, 5, 'с'),
  n('wardrobeWindup', 'Замок', 'Падение шкафа: замах', 0.2, 3, 0.1, 5, 'с', 'Полоса 3 × 1,2 от шкафа к герою фиксируется в начале замаха. Первый замах боя ×1,5.'),
  n('wardrobeDamage', 'Замок', 'Падение шкафа: урон героя', 0, 5, 1, 5),
  n('rookPeriod', 'Замок', 'Ладья: отдых', 0.5, 10, 0.25, 5, 'с'),
  n('rookWindup', 'Замок', 'Удар ладьи: замах', 0.2, 3, 0.1, 5, 'с', 'Ось через ладью в обе стороны фиксируется в начале замаха; бьёт первое тело на каждой половине. Первый замах боя 1,5 с.'),
  n('rookDamage', 'Замок', 'Удар ладьи: урон героя', 0, 5, 1, 5),
  // Task 55, stage Д «Колдун v0» (sim/enemies/warlock.ts).
  { kind: 'bool', key: 'warlockCharm', group: 'Замок', label: 'Колдун: чары и окна', stage: 5,
    hint: 'Пока цел шкаф Колдуна — Колдун под чарами: цепь его не берёт, ранит только толчок. Шкаф сломан — окно 1,5 с после каждого «Переноса», одно попадание. Арена «Зал колдуна» включает сама.' },
  n('warlockHp', 'Замок', 'Колдун: HP', 1, 6, 1, 5),
  n('warlockPlates', 'Замок', 'Колдун: пластины', 0, 8, 1, 5),
  n('warlockShift', 'Замок', '«Перенос» под чарами: раз в', 3, 20, 0.5, 5, 'с'),
  n('warlockShiftFast', 'Замок', '«Перенос» без чар: раз в', 2, 12, 0.5, 5, 'с'),
  n('warlockWindow', 'Замок', 'Колдун: окно после «Переноса»', 0.5, 4, 0.1, 5, 'с'),
  n('warlockCrowd', 'Замок', 'Колдун: толпа', 0.25, 2, 0.05, 5, '×', 'Множитель плотности и темпа пополнения толпы. Арена «Зал колдуна» ставит 0,45, если на панели 1.'),
  // Task 56 «Приметы» (sim/omens.ts): the sandbox's toggles of the omens that are new rules (off; the run sets them by its omens).
  { kind: 'bool', key: 'omenStorm', group: 'Приметы', label: '«Гроза»', stage: 5,
    hint: 'Раз в 7 с (первая — на 6-й) метка у самой плотной толпы (от 3 врагов); через 1,2 с удар: враги в круге −3 в зачёт, элита — пластина; герой в круге −2 (не в проходе, не в прыжке, щиты не спасают). Жнец и боссы — не цель.' },
  n('omenStormFirst', 'Приметы', '«Гроза»: первая метка', 0, 30, 0.5, 5, 'с'),
  n('omenStormEvery', 'Приметы', '«Гроза»: метка раз в', 1, 30, 0.5, 5, 'с'),
  n('omenStormFuse', 'Приметы', '«Гроза»: от метки до удара', 0.2, 5, 0.1, 5, 'с'),
  n('omenStormRadius', 'Приметы', '«Гроза»: радиус', 0.5, 3, 0.1, 5, 'ед.'),
  n('omenStormDamage', 'Приметы', '«Гроза»: урон врагам', 0, 6, 1, 5),
  n('omenStormHero', 'Приметы', '«Гроза»: урон герою', 0, 5, 1, 5),
  n('omenStormMin', 'Приметы', '«Гроза»: врагов для метки', 1, 8, 1, 5),
  { kind: 'bool', key: 'omenDrowse', group: 'Приметы', label: '«Сонный час»', stage: 5,
    hint: 'Враги первых 4 с спят: стоят, не касаются, не стреляют. Будит первый проход цепи или конец 4 с; разбуженные 4 с ходят ×1,25. Действует со следующего запуска арены.' },
  n('omenDrowseTime', 'Приметы', '«Сонный час»: сон', 0, 15, 0.5, 5, 'с'),
  n('omenWakeWalk', 'Приметы', '«Сонный час»: ярость, ходьба', 1, 3, 0.05, 5, '×'),
  n('omenWakeTime', 'Приметы', '«Сонный час»: ярость', 0, 15, 0.5, 5, 'с'),
  { kind: 'bool', key: 'omenFlood', group: 'Приметы', label: '«Половодье»', stage: 5,
    hint: 'Лужи на арене (вода, как пруд: ходьба ×0,5). Звено врага, взятое в воде, бьёт +1. Со следующего запуска арены.' },
  n('omenFloodPools', 'Приметы', '«Половодье»: луж', 0, 6, 1, 5),
  n('omenFloodRadius', 'Приметы', '«Половодье»: радиус лужи', 0.5, 2, 0.1, 5, 'ед.'),
  n('omenFloodHit', 'Приметы', '«Половодье»: сила мокрого звена', 0, 3, 1, 5, '+'),
  { kind: 'bool', key: 'omenRollcall', group: 'Приметы', label: '«Перекличка»', stage: 5,
    hint: 'Раз в 12 с (первая — на 3-й) один цвет на перекличке: его звено +0,5 энергии, касание врага этого цвета +1 урона.' },
  n('omenRollcallFirst', 'Приметы', '«Перекличка»: первая', 0, 30, 0.5, 5, 'с'),
  n('omenRollcallEvery', 'Приметы', '«Перекличка»: раз в', 1, 60, 1, 5, 'с'),
  n('omenRollcallEnergy', 'Приметы', '«Перекличка»: энергия звена', 0, 2, 0.5, 5, '+'),
  n('omenRollcallTouch', 'Приметы', '«Перекличка»: касание', 0, 3, 1, 5, '+'),
  { kind: 'bool', key: 'bagResetAll', group: 'Приметы', label: '«Урожай»: удар сбрасывает всю котомку', stage: 5,
    hint: 'Потеря HP сбрасывает все ступени котомки у двери, и заполненные. Цены ступеней «Урожая» (2 / 4 / 6) — в группе «Котомка у двери».' },
  // Task 57а «Лес: стрелки» (sim/shots.ts, enemies/slinger.ts, hive.ts, wisp.ts).
  n('volleyGap', 'Стрелки леса', 'Общий таймер стрелков', 0, 8, 0.25, 5, 'с', 'Пращник и улей начинают замах, только когда таймер арены пуст; начало замаха заводит его. 0 — таймера нет. В походе — 2,5.'),
  { kind: 'bool', key: 'volleyArcher', group: 'Стрелки леса', label: 'Лучник в общем таймере', stage: 5, hint: 'Лучник тоже ждёт общий таймер (при таймере > 0).' },
  n('shotCap', 'Стрелки леса', 'Снарядов на арене не больше', 4, 60, 1, 5, '', 'Залп, который превысил бы потолок, ждёт; таймер не тратится.'),
  { kind: 'bool', key: 'snuffShots', group: 'Стрелки леса', label: 'Проход гасит осы и камни', stage: 5, hint: 'Путь прохода и круг бомбы гасят лёгкие снаряды. В походе включено.' },
  n('slingWindup', 'Стрелки леса', 'Пращник: замах', 0.2, 2, 0.05, 5, 'с', 'Три линии фиксируются в начале замаха: средняя — через героя, две — под углом.'),
  n('slingPeriod', 'Стрелки леса', 'Пращник: период', 1, 10, 0.25, 5, 'с'),
  n('slingSpread', 'Стрелки леса', 'Пращник: угол между камнями', 5, 45, 1, 5, '°'),
  n('slingSpeed', 'Стрелки леса', 'Пращник: скорость камня', 1, 12, 0.5, 5, 'ед/с'),
  n('hiveRing', 'Стрелки леса', 'Улей: ос в кольце', 3, 16, 1, 5),
  n('hiveSpeed', 'Стрелки леса', 'Улей: скорость осы', 0.5, 8, 0.25, 5, 'ед/с'),
  n('hiveSwell', 'Стрелки леса', 'Улей: набухание', 0.2, 2, 0.05, 5, 'с'),
  n('hivePeriod', 'Стрелки леса', 'Улей: период', 1, 12, 0.25, 5, 'с'),
  n('wispSpeed', 'Стрелки леса', 'Светляк: скорость', 0.5, 5, 0.25, 5, 'ед/с'),
  n('wispTurn', 'Стрелки леса', 'Светляк: поворот', 15, 360, 5, 5, '°/с'),
  n('wispLife', 'Стрелки леса', 'Светляк: жизнь', 1, 15, 0.5, 5, 'с'),
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
 * speed classes are on; the sandbox's affix count is 0 (the run passes its own by the row, `Loadout.eliteAffixes`); Т6: the
 * archer's point shot is on. Loop research, step 1: the sandbox palette `colorCount` is 4 (the run's palette by its row comes
 * from `colorsByRow`, `Loadout.colors`). Step 2: the loop is a sandbox experiment — off in a run; step 3, «Прямая», too
 * (design 12.10.2026). П9 «Второе дыхание» (design decision 11.10.2026): a sandbox rule — off in a run, whatever the saved
 * panel holds. Task 29: the counters' chain window (`counterWindow`) — off here; task 30: a run with the flag `forms` turns it on with the
 * forms' price and `returnFixed` (run/rtRun.ts `RT_FORMS_PARAMS`, `rtArenaParams`).
 */
export const RUN_FORCED: Readonly<Partial<Params>> = Object.freeze({ heroAnchor: false, eliteSandbox: false, sandboxTalismans: '', shieldFollowsHero: false, wolfRing: true, speedClasses: true, eliteAffixes: 0, archerPoint: true, colorCount: 4, loopEnabled: false, loopHint: false, pierceEnabled: false, secondWind: false, endBlastMinLinks: 3, fireMinLinks: 3, returnFixed: false, counterWindow: false, twinsAlternate: false, twinsNoShift: false, forkBranches: 0, forkDwell: 0, shiftAtPointer: true, holdNearest: true, holdHeroLink: true });
/**
 * The values a run arena plays with: the saved panel with the stand-ins of run rules off (`RUN_FORCED`) and the run's own
 * numbers on top (`forced`; iteration 2.1: the healing consumable — `rtRunParams`, run/rtRun.ts).
 */
export function runParams(params: Params, forced: Readonly<Partial<Params>> = {}): Params { return Object.assign(copyParams(params), RUN_FORCED, forced); }

/** A deep copy (the journal keeps the values a run started with). */
export function copyParams(params: Params): Params { return { ...params, phases: params.phases.map(p => ({ ...p })) }; }

/** Keys of `source` in the order of `order`'s keys, then the keys `order` lacks in their given order; values as they are. */
function inKeyOrder<T extends object>(source: T, order: object): T {
  const src = source as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const k of Object.keys(order)) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out as T;
}

/**
 * Params in the key order the browser builds them (`sanitizeParams`, then `copyParams` / `runParams`): top-level keys in
 * `DEFAULT_PARAMS` order, then unknown keys in their given order; each `phases` entry in the key order of the default
 * entry at its index (the last one beyond the table, as `sanitizePhases` does). Values are not touched; a deep copy.
 *
 * Why: the world hash (sim/hash.ts) serializes `world.params` in insertion order, while `paramsHash` is key-order free.
 * A store that returns the run record with its keys sorted (the claude.ai artifact database, playtest v32, 12.10.2026)
 * keeps the Params' hash but changes the world hash of a replay. For Params built by the game this is the identity.
 */
export function canonicalParams(params: Params): Params {
  const out = inKeyOrder(params, DEFAULT_PARAMS);
  if (Array.isArray(params.phases)) {
    out.phases = params.phases.map((p, i) => p && typeof p === 'object'
      ? inKeyOrder({ ...p }, DEFAULT_PHASES[Math.min(i, DEFAULT_PHASES.length - 1)]) : p);
  }
  return out;
}

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
 * (null before): only then the phase table runs, counted from that moment. `pace` (task 18 «Испытание V», `Kit.phaseScale`):
 * each phase lasts `duration × pace` (1 — as before).
 */
export function pressureAt(params: Params, time: number, greedStart: number | null = null, arena?: ArenaTemplate, delay = 0, pace = 1): Pressure {
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
    const duration = pace === 1 ? phases[i].duration : phases[i].duration * pace;
    if (t < start + duration) { phaseIndex = i; phaseLeft = start + duration - t; break; }
    start += duration;
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
