/**
 * World state and the game-time step of the real-time simulation (no DOM; stage 1 of the transition,
 * docs/realtime-prototype.md, «Ядро реального времени»). Deterministic: every random choice reads a seeded stream
 * (`world.rng`, rng.ts), and the step runs on a fixed game time (`SIM_DT` ticks of simulation.ts).
 * The chain, focus and the hero's dash live in chain.ts (`stepHero` runs before `update` on every tick).
 * Enemy kinds and their behaviours (the wolf's pack, the boar's charge, the reaper) are registered data and modules
 * (enemies/*), the arena is a template (arenas.ts). Iteration 2, stage A: the hero walks (the `walk` command →
 * `world.input`), enemies follow the flow field around obstacles.
 */
import { dcos, dhypot, dsin } from './detMath';
import { type ArenaTemplate, type StartEnemy, arenaTemplate, LEADER_HP_OVER_TOUGH, markedCount, markedGoalArena } from './arenas';
// The prototype kinds register on import (enemies/index.ts); the core reads them through the registry only.
import './enemies/index';
// Phase B: the build modules (talismans Т1, hammers Т2, relics Т3) register on import; the core reads them through build.ts.
import './buildModules';
import { enemyWalkFactorOf, focusMaxOf, heroSpeedOf, jumpCostOf, runHook, type DashBuild } from './build';
import type { HammerEventKind } from './buildIds';
import type { BoarState } from './enemies/boar';
import { behaviorOf, bodyRadiusOf, enemyKind, groupBehaviors, kindOf } from './enemies/kinds';
import { FlowField, type Vec, dist, hasZone, inThorns, inWater, lineOfSight, overCliff, pushOutOfCliffs, pushOutOfObstacles } from './geometry';
import { type Params, type Pressure, DEFAULT_PARAMS, copyParams, enemyBodyRadius, heroRadius, invulnerabilityFor, pressureAt } from './params';
import { hasTalisman, kitOf, type ItemKind, type Kit, type Loadout, type ResourceKind } from './kit';
import { affixSpeedFactor, eliteDeath, makeElite, platesOf, stripPlates, touchLoot, updateAffixes, updateArmor, type AffixId, type EliteArmor, type TrailPoint } from './elites';
import { updateBurning } from './items';
import { RngStreams } from './rng';
// Task 40: the keymaster's prisoner stands (tethers.ts).
import { dropShackleOf, shackled } from './tethers';
// Task 41: the rioting prisoner (enemies/garrison.ts).
import { riotStep } from './enemies/garrison';
// Casino stage 1 («Однорукий гоблин», slot.ts): the slot's state and step.
import { goblinOf, placeArenaGoblin, updateSlot, type SlotOutcome, type SlotState, type SlotSymbol } from './slot';
import { fallenEmbers, greedHurt, purseDoor, purseKill, type DoorExit, type PurseMove, type PurseWorld } from './purse';
// Task 14 «Котомка у двери» (bag.ts): the bag of the fight after the goals.
import { bagAppear, bagDoor, bagHurt, bagKill, type BagWorld } from './bag';
// Task 16 «Подвиги» (feat.ts): the feat of a run fight, latched when done.
import { featCheck, featExit, type FeatKind, type FeatWorld } from './feat';
// Casino stage 1, item 2 («Ставка клятвы», oath.ts): the oath of the fight, its checks and the door.
import { oathDoor, oathForfeit, oathHurt, startOath, type OathId, type OathState } from './oath';
import { spawnEnemy, spawnReaper, toughHpMaxOf, updateSpawning, type QueuedSpawn, type SpawnMarker } from './spawn';
// К7 «Проклятый сундук» (chest.ts): the chest of «Застава», its touch, the curse on the touch.
import { curseTouch, placeChest, touchChest, type CurseState } from './chest';

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
  /**
   * Task 12 «Отмеченные — атаман или орда»: a leader of a goal layout (`StartEnemy.leader`) — raised HP, reached and pressed like an
   * elite (enemies/kinds.ts `enemyArtScale`); the seam for the view's leader (the ui session). Absent on every other enemy
   * (worlds without leaders hash as before).
   */
  leader?: true;
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
  /**
   * Phase A, T4 (docs/realtime-phase-a.md, section 2; elites.ts): the affixes of an elite, in the order of `AFFIX_IDS`.
   * Absent on an elite without affixes (the slice's elite) and on an ordinary enemy — those hash as before. Not in `vars`:
   * the wolves' ring clears `vars`.
   */
  affixes?: AffixId[];
  /** «Хамелеон»: game seconds to its next colour (stands while it is a link of the chain or the dash, or frozen). */
  chameleon?: number;
  /** «Огненный»: where its last trail point lies (the next one falls `trailStep` away from it). */
  trail?: { x: number; y: number };
  /** Game seconds before a fire trail may hurt this enemy again (absent — it may now). */
  singed?: number;
  /**
   * Package «Урон имеет значение» (docs/realtime-damage.md; elites.ts): the armour of an elite made while `eliteArmor` was
   * on — plates, their maximum, the open window, the regrowth. Absent on every other enemy (worlds without it hash as before).
   */
  armor?: EliteArmor;
  /**
   * Task 27 «Каркас босса» (enemies/jailer.ts): the id of the boss's core this enemy is a part of (the Jailer's weight). Absent
   * on every other enemy and while `Params.bossFrame` is off (worlds without it hash as before).
   */
  partOf?: number;
}

/**
 * The enemy is held now: it stands, does not touch, its behaviour's mechanic (shield, shot, fuse, quills) is off — frozen by
 * the cold, or an armoured elite in its open window (elites.ts; the window is not the cold: no brittleness, no ×2).
 */
export function enemyFrozen(e: Enemy): boolean { return (e.chill ?? 0) > 0 || (e.armor?.open ?? 0) > 0; }

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
  kind: 'button' | 'door' | 'crystal' | 'loot' | 'brazier' | 'lever' | 'chest';
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
  /** Task 43: a lever of the full Castellan's grate (absent — the goblin's lever); `ready` — the game time it is ready again (absent — ready). */
  gate?: true;
  ready?: number;
  // Casino stage 1: `lever` — the lever of «Однорукий гоблин» (slot.ts): any colour, the last link, as a button; its state
  // (marker, cooldown, pulls) lives in `World.slot`. К7: `chest` — the cursed chest (chest.ts): a pass-through link as the
  // loot, taken by a chain or a touch; its curse lives in `World.curse`.
}

/** Radius of a button, the door or a crystal (units): the drawn circle, the pick circle, the door entry. */
export const OBJECT_RADIUS = 0.45;

/** A chain link: an enemy, or an arena object (a button or the door can only be the last link; a crystal anywhere). */
/**
 * A link of the drawn chain. `fork` (task 33, `Params.forkBranches`): «Развилка» took it from that older link (its anchor, fixed
 * when it was taken: bodies move) — absent otherwise.
 */
export type ChainLink = ({ kind: 'enemy'; id: number } | { kind: 'object'; id: number }) & { fork?: { kind: 'enemy' | 'object'; id: number } };

/** The last finished dash (render: combo counter, score popup; result screen). */
export interface ChainSummary { kills: number; hits: number; crystals: number; score: number; time: number }

/**
 * Stage 2 of the transition (design answer 08.10.2026): a link of the released chain killed during the dash by something
 * else (a blast, an arrow) stays a link: the hero passes its last point and it gives +1 power; it is a kill of the chain
 * (combo, crystal, score) only when its death is the player's (`credited`).
 */
export interface FallenLink {
  id: number; x: number; y: number; credited: boolean;
  /** Casino «Котёл»: embers for the chain's cheque — a credited death while the cauldron is on (absent otherwise). */
  embers?: number;
  /** Phase B: it was an elite — noted only on a dash the build layer counts (`HeroMove.build`), so older dashes hash as before. */
  elite?: true;
}

/** A hero move without contact damage: the dash along the chain or a jump. */
export interface HeroMove {
  /**
   * `dash` — along the released chain; `jump`; `return` (phase B, the hammer «Возврат»: chain.ts `startReturnRun`) — a run
   * along fixed points after a dash, no links, no chain end; the hero is untouchable during any move.
   */
  kind: 'dash' | 'jump' | 'return';
  /** Chain links still to strike (dash) — struck in order on arrival. */
  links: ChainLink[];
  /** Power carried to the next link: +1 per enemy, HP spend it (docs/realtime-prototype.md). */
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
  /**
   * Stage 3a (М2): points of links that fell into a cliff, flown over since the last stop on the ground (absent when none).
   * If the dash ends or stops on a survivor with them, the hero flies back over them to the stop (`route`).
   */
  detour?: Vec[];
  /** Stage 3a (М2): the rest of the way back after `point` (absent when none). */
  route?: Vec[];
  /** Stage 2, step 3: links frozen and brittle at the release — struck ×2 even if they thaw on the way (absent when none). */
  brittle?: number[];
  /**
   * Iteration 2.1 (docs/realtime-slice.md, section 12): links armed at the release (`EnemyBehavior.armed`: porcupines with
   * their quills up) — their chain
   * hit hurts the hero even if the quills went down on the way; others do not, even if the quills went up (absent when none).
   */
  armed?: number[];
  /** Phase B (build.ts): the build layer's count of this dash — present only while a build module acts. */
  build?: DashBuild;
  /** Loop research, step 2: the seal of a closed chain, fixed at the release, struck at the end of the dash (absent otherwise). */
  seal?: SealMove;
  /** Casino «Котёл» (purse.ts): the dash's cheque so far — embers, enemy links, the last one dead (absent while the cauldron is off). */
  purse?: PurseMove;
  /**
   * «Длинная цепь кормит гоблина» (slot.ts `pullLever`): this dash already fed the goblin at the lever (its long chain counted
   * before the pull, design answer 12.10.2026) — the dash's end does not count it again. Absent otherwise.
   */
  slotFed?: true;
  /**
   * Loop research, step 3 («Прямая», sim/pierce.ts): the pierce fixed at the release — run after the last link died on the
   * ground (absent otherwise: dashes without it hash as before).
   */
  pierce?: PierceMove;
  /**
   * Task 29, the rank of the field «Конец»: the pierce ran to its end on this dash (set by its end, read by the dash's end in the
   * same tick; only while the kit holds «Печать» or «Прямая» as a form, chain.ts `endRankOn`). Absent otherwise.
   */
  pierced?: true;
  /**
   * «Смена цвета» (`colorShiftLinks`, chain.ts `colorShiftIds`): the links of the release that freed the chain's colour (the
   * last link of each colour segment), not reached yet (absent when none: dashes without the rule hash as before).
   */
  shifts?: number[];
  /**
   * Task 38 (`Params.tethers`, tethers.ts): the tethers the release fixed for this dash to cut (the plan's `cuts`, by their held
   * body) — cut when the dash ends, whatever the bodies did on the way. Absent when none (dashes without them hash as before).
   */
  cuts?: number[];
}

/**
 * Loop research, step 3: the pierce a dash carries (fixed at the release, as the seal). The hero runs from where the last link
 * died to `to`; a body is hit when he passes its share `t ÷ length` of that run, if it is still on the arena.
 */
export interface PierceMove {
  /** The axis's start (the last link at the release) and its fixed end; `length` — the cut length between them. */
  from: Vec;
  to: Vec;
  length: number;
  /** Corridor bodies not passed yet, by t. */
  bodies: { id: number; t: number }[];
  /** Bodies frozen and brittle at the release: struck ×`frostFactor` (absent when none). */
  brittle?: number[];
  /** The firing id of its plate strips (absent while the elites' armour is off). */
  firing?: number;
  /** Where the run began (absent until the last link died on the ground). */
  start?: Vec;
  /** Bodies struck and killed so far. */
  hits: number;
  kills: number;
  /** The pierce's one hit-stop was given (absent until then). */
  stopped?: true;
}

/** Loop research, step 2: where a chain closes — on its first link, or on the hero (he is a corner of the ring). */
export type LoopKind = 'first' | 'hero';

/** Loop research, step 2: the seal a dash carries — who was inside at the release, the hit and the hold (docs/realtime-loop-research.md, 3.1). */
export interface SealMove {
  kind: LoopKind;
  /** Enemy links of the ring (n). */
  links: number;
  /** Corners of the ring at the release (the view flashes it at the strike). */
  ring: Vec[];
  /** Enemies whose centre was inside the ring at the release (arena order). */
  inside: number[];
  damage: number;
  /** Game seconds a survivor is held (the cold without the ×2). */
  hold: number;
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
  /**
   * Phase A, T4 («Огненный»): game seconds to the next burn while the hero is on foot in a fire trail (as `thorns`). Absent
   * out of a trail.
   */
  flames?: number;
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
  /** `plates` (the package «Урон имеет значение»): the hit took a plate off an armoured elite, this many left (absent otherwise). */
  | { type: 'chainHit'; enemyId: number; damage: number; killed: boolean; x: number; y: number; combo: number; plates?: number }
  /** Stage 2 of the transition: an enemy hit by something other than the chain (an arrow, a blast). */
  | { type: 'enemyHit'; enemyId: number; damage: number; killed: boolean; x: number; y: number; source: string }
  | { type: 'crystal'; objectId: number; x: number; y: number }
  | { type: 'crystalBreak'; objectId: number; x: number; y: number; score: number; combo: number }
  /** «Смена цвета»: the dash reached the link that freed the chain's colour (the N-th link of a colour segment). */
  | { type: 'colorShift'; enemyId: number; x: number; y: number }
  /**
   * Task 34 (`Params.shiftAtPointer`): a sweep point or the held still pointer passed by an enemy of another colour on a free
   * chain — without the rule it would have joined and changed the colour. `links` — the drawn chain's length then (telemetry).
   */
  | { type: 'shiftSkip'; enemyId: number; links: number }
  | { type: 'finisher'; kills: number }
  /**
   * Loop research, step 2: the loop gesture — closed (`close`), refused with a reason (`refused`), opened by the pointer on
   * the last link (`open`, no reason) or by the rules (`open` with `refusal`: `far`, `sight`, `crossed`, `changed` — a link
   * died, `off` — the loop was turned off).
   */
  | { type: 'loop'; action: 'close' | 'refused' | 'open'; kind: LoopKind; refusal?: string }
  /**
   * Loop research, step 2: a closed chain released (`release`: its ring and who is inside) and its seal at the end of the
   * dash (`strike`: who of them was still on the arena and was hit).
   */
  | { type: 'seal'; phase: 'release' | 'strike'; kind: LoopKind; points: Vec[]; inside: number[]; links: number }
  /**
   * Loop research, step 3 («Прямая»): the pierce fixed at the release (the axis's start, the end, the corridor's bodies, the
   * power), its end (bodies struck and killed) or its cancel (the last link did not die on the ground at the dash).
   */
  | { type: 'pierce'; phase: 'release'; from: Vec; to: Vec; bodies: number[]; power: number }
  | { type: 'pierce'; phase: 'end'; hits: number; kills: number; x: number; y: number }
  | { type: 'pierce'; phase: 'cancel' }
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
  /**
   * Task 41 «Три зелья» (`Params.potionCap`): the hero touched a healing loot with a full hand — it stays on the floor. Every tick of
   * the touch (the telemetry counts each loot once).
   */
  | { type: 'lootRefused'; objectId: number; loot: ItemKind }
  /** Stage 2, step 3: a newcomer became an elite (a random elite). */
  | { type: 'elite'; enemyId: number }
  /** Stage 2, step 3: «Пепельный оберег» saved the hero from a lethal hit (1 HP left) and crumbled. */
  | { type: 'ward' }
  /**
   * П9 «Второе дыхание»: a lethal hit did not end the fight — the hero stood up here (render: a flash and a short text).
   * `hp` — his HP before the lethal hit; `enemyId` and `source` — its striker and source, as the `hit` event of that hit names
   * them; `enemy` and `elite` — the striker's kind if it stood on the arena at the hit (a porcupine the same dash kills next).
   */
  | { type: 'secondWind'; x: number; y: number; hp: number; enemyId: number; source: HitSource; enemy?: EnemyKind; elite?: boolean }
  /** К7 «Проклятый сундук» (chest.ts): the hero took the chest (`by` a chain link or a touch); the dash's kills lifted the curse. */
  | { type: 'chest'; objectId: number; x: number; y: number; by: CurseState['by'] }
  | { type: 'curseLifted'; kills: number }
  | { type: 'focusRefill' }
  /**
   * Stage 3a, steps 3–4: a kind's own signal for the view and the sound — the wolves' howl (`howl`), the lynx announcing
   * its leap (`leap`), the shaman's beam (`beam`) and its end (`empower`). The rules never read it.
   */
  | { type: 'enemySignal'; enemyId: number; signal: string; x: number; y: number }
  | { type: 'defeat' }
  /** Phase B (build.ts `talismanFired`): an item of the build triggered — a flash of its icon, a short text at the hero. */
  | { type: 'talismanFired'; id: string }
  /**
   * Phase B, Т2: a hammer acted — `fire` laid, the end `blast`, a `cut`, the `return` run; at a point, with a circle if any.
   * Task 31 (`Params.fireMinLinks`): `fire` comes in the tick the dash reaches the threshold, at the start of the chain, and
   * `flare` holds the places of the points of the path that lit at once then (the view's flash); without the key — at the
   * release, no `flare`.
   */
  | { type: 'hammer'; kind: HammerEventKind; x: number; y: number; r?: number; flare?: Vec[] }
  /** Phase B, Т1 («Ударная волна»): a wave of radius `r` around the hero at the end of the dash. */
  | { type: 'wave'; x: number; y: number; r: number }
  /**
   * Package «Урон имеет значение» (elites.ts): the armour of an elite changed — `strip` (a hit took `removed` plates; `source`
   * names it), `open` (0 plates: the window starts), `close` (the window ended: 1 plate), `regrow` (+1 plate). `plates` — left now.
   */
  | { type: 'elitePlates'; enemyId: number; action: 'strip' | 'open' | 'close' | 'regrow'; plates: number; removed?: number; source?: string; x: number; y: number }
  /** The package: an armoured elite died (`clean` — in its window, by the player: +1 energy, loot ×2). */
  | { type: 'eliteDown'; enemyId: number; x: number; y: number; clean: boolean; inWindow: boolean; credited: boolean }
  /**
   * Casino stage 1 («Однорукий гоблин», slot.ts): the idol appeared (`appear`); the lever was pulled (`pull`: the reels, the
   * outcome, the struck enemy links, skulls taken off and the skulls of this pull, the odds of the rain and the volley, the
   * pull's number); the 3rd reel stopped (`effect`); a rain wave dropped its marks (`wave`); an arrow fell (`land`, its circle).
   * «Перебор» (`slotBust` on): a pull says whether it was risky and whether it busts (the effect `bust` blows the goblin up).
   * «Длинная цепь кормит гоблина» (`slotSafePerLongChain` > 0): a long chain raised the safe pulls (`feed`: `safe` — by how
   * many, `links` — the chain's enemy links, `chains` — long chains of the fight; where the hero stands). Only when they grew.
   * «Взрыв по площади» (`slotBustArea` on): the bust lit the idol (`lit`: its spot, the circle `r`, the `fuse`, the blast's id
   * `blastId` in `world.blasts`); the blast went off (`blast`: the circle; `inside` — the hero's body touched it, `hurt` — he
   * took the damage, else spared by invulnerability, the dash or the jump).
   * «Безопасный рывок — тройка» (`slotSafeTriple` on): a safe pull's `pull` has `triple` (a sure triple, no skulls: `rain` and
   * `volley` 0). «Гоблин-сюрприз» (`slotSafeRandom`) adds no event: the goblin's roll is `Goblin.safe`, hidden from the view.
   */
  | { type: 'slot'; action: 'appear' | 'pull' | 'effect' | 'wave' | 'land' | 'feed' | 'lit' | 'blast'; x: number; y: number; objectId?: number; reels?: SlotSymbol[]; outcome?: SlotOutcome;
      links?: number; removed?: number; skulls?: number[]; rain?: number; volley?: number; pull?: number; r?: number; firing?: number; risky?: boolean; bust?: boolean;
      safe?: number; chains?: number; fuse?: number; blastId?: number; inside?: boolean; hurt?: boolean; triple?: boolean }
  /**
   * Casino «Котёл» (purse.ts): a chain's cheque went into the cauldron (embers × heat × the crystal multiplier = total; the
   * cauldron after it; where the hero stands); a build kill put 1 ember (`purseKill`); the door recorded the cauldron
   * (`purseDoor`: the oath and the resources it pays without the die, how the hero went in; with П4 on — the greed step's
   * multiplier and the step). П3 «Финальная цепь»: the cheque of a chain entering the door with `doorFinale` on has `door`.
   * П4 «Раздув за дела»: the greed step went up or down (`greed`: a counted chain or a hit; the step 0–3 after it, the counted
   * chains toward the next one, the step's multiplier).
   */
  | { type: 'cheque'; embers: number; heat: number; crystals: number; mult: number; total: number; links: number; finish: boolean; door?: true; cauldron: number; x: number; y: number }
  | { type: 'purseKill'; source: string; cauldron: number }
  | { type: 'purseDoor'; cauldron: number; oath: number; by: DoorExit; resources: number; greed?: number; step?: number }
  | { type: 'greed'; cause: 'chain' | 'hit'; step: number; chains: number; mult: number }
  /**
   * Task 14 «Котомка у двери» (bag.ts): the bag appeared with the goals (`appear`, step 0); a step filled (`step`: the filled
   * steps now, `reward` — that step's resources); a real HP loss sent the unfilled step back to its start (`reset`: the filled
   * steps, unchanged).
   */
  | { type: 'bag'; action: 'appear' | 'step' | 'reset'; step: number; reward?: number }
  /** Task 16 «Подвиги» (feat.ts): the fight's feat was done (its kind and N); once a fight. */
  | { type: 'feat'; action: 'done'; kind: FeatKind; n: number }
  /**
   * Casino stage 1, item 2 («Ставка клятвы», oath.ts): the oath broke (`broken`) or an «at least once» oath was met (`met`) in
   * `tick`; the exit into the door settled it (`door`: kept or not, the cauldron's multiplier).
   */
  | { type: 'oath'; action: 'broken' | 'met' | 'door'; id: OathId; tick: number; kept?: boolean; mult?: number }
  /**
   * The prologue «Опушка» (`ArenaTemplate.restore`, `updateRestore`): the start enemies stand at their posts with full HP again
   * (the view's smoke) — every start enemy now, its id (a new one for those that came back from death) and its post; `hero` —
   * where the hero was put back (`ArenaTemplate.restoreHero`; absent otherwise); `late` — the late batch of posts that waited
   * under the hero (`RestoreState.wait`): the same return, not a new one (telemetry review 13.10.2026; events are not hashed).
   */
  | { type: 'restore'; enemies: { id: number; x: number; y: number }[]; hero?: { x: number; y: number }; late?: true }
  /**
   * The prologue, task 13 (goal `shield`, the room «Щит»; `noteShieldBlocks`): the after-chain shield (`Hero.chainShield` > 0)
   * absorbed a touch of enemy `enemyId` that would have hurt the hero; (`x`, `y`) — the enemy at the touch. Once per enemy per
   * shield window; never for the «Щит фокуса» or the invulnerability after a hit alone. Only on an arena with that goal.
   */
  | { type: 'shieldBlock'; enemyId: number; x: number; y: number }
  /**
   * Task 23 «Щит виден» (design 15.10.2026; `noteBlock`): a hit that reached the hero was absorbed by the after-chain shield,
   * «Щит фокуса» or the invulnerability (`heroGuarded`); (`x`, `y`) — where it came from (the striker, the blow's centre),
   * `source` — the hit it would have been, `enemyId` — the striker if any. A touch gives one per touching enemy per tick (the view
   * limits the sparks). Never for a dash or a jump. Not hashed (events are not), and nothing else changes.
   */
  | { type: 'block'; x: number; y: number; source: HitSource; enemyId?: number }
  /**
   * Task 27 «Каркас босса» (enemies/jailer.ts): a move of the boss whose core is `id` began its windup (`start`) or struck (`hit`);
   * a part died (`partSevered`: its id and spot; only while its core lives); after the dash the core lost plates to severed parts
   * (`bossPlate`: plates left) or entered a phase (`bossPhase`). The rules never read them.
   */
  | { type: 'bossMove'; id: number; move: 'flail' | 'throw' | 'whistle'; stage: 'start' | 'hit' }
  | { type: 'partSevered'; id: number; x: number; y: number }
  | { type: 'bossPlate'; id: number; plates: number }
  | { type: 'bossPhase'; id: number; phase: number }
  /**
   * Task 38 (tethers.ts): a tether is gone — `cut` by the dash (at its end; `x`, `y` — where the dash crossed it first), `death` of
   * an end (the holder's death frees every hound it held). Task 40: `shackle` — the keymaster shackled `held` (a new tether);
   * `kind` — `shackle` on every event of a shackle (absent — a leash). The rules never read it.
   */
  | { type: 'tether'; action: 'cut' | 'death' | 'shackle'; holder: number; held: number; x: number; y: number; kind?: 'shackle' }
  /**
   * Task 43 (enemies/crossbow.ts): a crossbow's windup began (`aim`: the line fixed from (`x0`, `y0`) to the wall at (`x1`, `y1`)) or
   * its bolt flew (`shot`: `hit` — the hero, an enemy `target`, or absent — nobody on the line). The rules never read it.
   */
  | { type: 'bolt'; action: 'aim' | 'shot'; id: number; x0: number; y0: number; x1: number; y1: number; hit?: 'hero' | 'enemy'; target?: number }
  /** Task 38 (enemies/garrison.ts): a loosed hound's frenzy began (`start`) or ended (`end`); it bit an enemy (`bite`). */
  | { type: 'frenzy'; action: 'start' | 'end' | 'bite'; id: number; target?: number; x: number; y: number; /** Task 41: a prisoner's riot (absent — a hound's frenzy). */ riot?: true }
  /** Task 38 (enemies/garrison.ts): the Castellan's move — «Спустить пса» (`lunge`: windup `start`, `hit`) or «Караул!» (`guard`). */
  | { type: 'castellanMove'; id: number; move: 'lunge' | 'guard'; stage: 'start' | 'hit' }
  /**
   * Task 43 (the full Castellan, enemies/garrison.ts): `lever` — a chain ended on a lever of the grate (`objectId`); `up` / `down` —
   * the grate rose or fell; `keys` — the despair (his crossbow cut: the grate stuck open 3 s of every 10); `jam` — phase 3 (open
   * for good). `id` — the core. The rules never read it.
   */
  | { type: 'grate'; action: 'lever' | 'up' | 'down' | 'keys' | 'jam'; id: number; objectId?: number; x: number; y: number };

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
  /**
   * Loop research, step 2: the drawn chain is closed — on its first link or on the hero (absent while open: worlds without
   * the loop hash as before). Nothing may join a closed chain; the pointer on its last link opens it.
   */
  chainClosed?: LoopKind;
  /** Package «Урон имеет значение»: the last firing id given (`nextFiring`; absent until one is — worlds without it hash as before). */
  firing?: number;
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
  /** Phase A, T4: points of the fire trails of «Огненный» elites (elites.ts). Hashed only when not empty. */
  trails: TrailPoint[];
  /**
   * Stage 2, step 3: what the hero brought into the arena and holds now (consumables; kit.ts). Absent — an arena started
   * without a loadout (journals before step 3): no consumables, the world hashes as before.
   */
  kit?: Kit;
  /**
   * Phase B (build.ts `buildStateOf` / `setBuildState`): structures of the build modules on the arena by module id (the
   * hammer's fire …); JSON values only. Absent while empty — hashed only when present.
   */
  build?: Record<string, unknown>;
  /** Casino stage 1 («Однорукий гоблин», slot.ts): the slot of the arena — absent until the battle rolls (hashed only when present). */
  slot?: SlotState;
  /**
   * «Длинная цепь кормит гоблина» (slot.ts `slotFeedEnd`): long chains of this fight that fed the goblin (each +`slotSafePerLongChain`
   * safe pulls, `slotCharges`). Absent while 0 — hashed only when present.
   */
  slotChains?: number;
  /** Casino «Котёл» (purse.ts): the cauldron of the fight and the door's record (absent until used — hashed only when present). */
  purse?: PurseWorld;
  /** Task 14 «Котомка у двери» (bag.ts): the bag of the fight — absent until the goals of a fight with the rule on (hashed only when present). */
  bag?: BagWorld;
  /** Task 16 «Подвиги» (feat.ts): the fight's feat was done — the tick and game time (absent until then; hashed only when present). */
  feat?: FeatWorld;
  /** Casino stage 1, item 2 («Ставка клятвы», oath.ts): the oath of the fight (absent without one — hashed only when present). */
  oath?: OathState;
  /**
   * П9 «Второе дыхание» (`Params.secondWind` in the sandbox; `Kit.secondWind` in a gentle run, task 17): the tick and the game time the hero stood up after a lethal hit —
   * once per fight. `time` counts the recovery window (`secondWindRecovering`: game seconds, a hit-stop does not shorten it).
   * Absent until used (worlds without it hash as before).
   */
  secondWind?: { tick: number; time: number };
  /** К7 «Проклятый сундук» (chest.ts, `Params.cursedChest`): the curse of the fight, absent until the chest is taken. */
  curse?: CurseState;
  /**
   * The prologue «Опушка» (`ArenaTemplate.restore`): the ids of the start enemies now (index — the template's enemy; a new id
   * after one came back from death), the game time the return is due, the posts waiting for the hero. Present only on an arena
   * with `restore` (`none` too: the ids are kept for the hand's route; other worlds hash as before).
   */
  restore?: RestoreState;
  /** The prologue (`ArenaTemplate.sleepUntilChain`): the enemies sleep until the first press. Absent otherwise and once awake. */
  asleep?: true;
  /**
   * The prologue, task 9 (goal `strike`, the spin room): the most kills of one spin so far and the last spin's kills with its
   * game time (the lamps hold them `LAMPS_HOLD`). Present only on an arena with that goal (other worlds hash as before).
   */
  strike?: StrikeState;
  /**
   * The prologue, task 13 (goal `shield`, the room «Щит»): the lamps lit by the after-chain shield and the shield window now.
   * Present only on an arena with that goal (other worlds hash as before).
   */
  shieldGoal?: ShieldGoalState;
  /**
   * Task 28 «Тюремщик в походе» (`Params.bossClears`, enemies/jailer.ts): the boss died and the fight is over — every enemy died with
   * it, nothing spawns, the hero is not hurt any more. Absent until then (worlds without it hash as before).
   */
  bossCleared?: true;
  /**
   * Task 38 «Гарнизон» (`Params.tethers`, tethers.ts): the tethers on the arena — absent until a fight makes one (and again once the
   * last is gone: worlds without them hash as before).
   */
  tethers?: Tether[];
}

/**
 * Task 38 (tethers.ts): a tether between two bodies — `holder` holds `held` (the dog handler or the Castellan and a hound). One
 * tether a held body: `held` names it (the dash's `cuts`, the plan's `cuts`). `kind` — `leash`; task 40 — `shackle` (the keymaster
 * and its prisoner: the prisoner stands and no chain takes it).
 */
export type TetherKind = 'leash' | 'shackle';
export interface Tether { holder: number; held: number; kind: TetherKind }

/**
 * The lamps of a `shield` arena (`World.shieldGoal`): `lit` — shield windows that absorbed a touch which would have hurt (at
 * most one lamp per window); `window` — the window of the after-chain shield now (absent — none, or it ran out): the enemies
 * whose touch it absorbed (each sends `shieldBlock` once), `lit` — this window has lit its lamp.
 */
export interface ShieldGoalState { lit: number; window?: { enemies: number[]; lit?: true } }

/** The spins of a `strike` arena (`World.strike`): the best one's kills; the last one's kills and game time (absent — none yet). */
export interface StrikeState { best: number; last?: { kills: number; time: number } }

/**
 * The prologue's start enemies and their return (`World.restore`): their ids now (by the template's index), the game time a
 * return is due (absent — none waits), the posts waiting for the hero to step off them (absent — none).
 */
export interface RestoreState { ids: number[]; due?: number; wait?: number[] }

/** The prologue: game seconds from the moment a return is needed to the return (design 12.10.2026: 1 s). */
export const RESTORE_DELAY = 1;

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
  /**
   * «Взрыв по площади» (slot.ts `bustGoblin`, `slotBustArea`): the goblin's bust — the lit idol at (`x`, `y`). The hero takes
   * `hero` (not `damage`, the enemies' damage) by the bust's own rule (`bustCanHurt`). Absent on every other blast.
   */
  bust?: { hero: number };
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
export function createWorld(template: ArenaTemplate, params: Params, seed = 1, start?: HeroStart, loadout?: Loadout): World {
  // Task 43: «Двор кастеляна» with `Params.castellanFull` plays the full Castellan's arena under its own id (journals without the key — v0).
  if (template.castellanFullArena && params.castellanFull) template = { ...arenaTemplate(template.castellanFullArena), id: template.id, name: template.name };
  // Task 12: with `markedGoals` on, a template's goal layout (its enemies, summary and horde) — the world plays it throughout.
  const marked = markedGoalArena(template, params.markedGoals);
  // Task 40: a deep fight (`Loadout.deep`) stands the template's deep enemies too, after its own (absent — the template as it is).
  const arena = loadout?.deep === true && marked.deepEnemies?.length ? { ...marked, enemies: [...marked.enemies, ...marked.deepEnemies] } : marked;
  // Task 27 «Каркас босса»: a boss arena plays the frame — a copy of the values with it on (the given object stays as it is).
  if (arena.bossFrame && !params.bossFrame) params = { ...copyParams(params), bossFrame: true };
  // Task 28: a boss arena's death of the boss ends the fight — on when the values have the key off (absent: an older journal, as it was).
  if (arena.bossClears && params.bossClears === false) params = { ...copyParams(params), bossClears: true };
  // Task 32: the boss arena's colourless core and its HP — when the values hold the old ones (absent: an older journal, as it was).
  if (arena.jailerColorless && params.jailerColorless === false) params = { ...copyParams(params), jailerColorless: true };
  if (arena.jailerHp !== undefined && params.jailerHp === DEFAULT_PARAMS.jailerHp) params = { ...copyParams(params), jailerHp: arena.jailerHp };
  // Task 38: an arena of the garrison plays the law of tethers and the guards' formation (the given object stays as it is).
  if (arena.garrison && (!params.tethers || !params.guardFormation)) params = { ...copyParams(params), tethers: true, guardFormation: true };
  // Task 40: «Ров» plays the keymaster's shackles (the given object stays as it is; a journal keeps the copy).
  if (arena.shackles && !params.shackles) params = { ...copyParams(params), shackles: true };
  // Task 43: the full Castellan's arena plays its key on (the sandbox «Двор кастеляна (полный)»; a journal keeps the copy).
  if (arena.castellanFull && !params.castellanFull) params = { ...copyParams(params), castellanFull: true };
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
    // Task 43: the levers of the full Castellan's grate (after the braziers: arenas without them keep their ids).
    ...(arena.gateLevers ?? []).map(l => ({ id: nextId++, kind: 'lever' as const, x: l.x, y: l.y, pressed: false, gate: true as const })),
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
    trails: [],
  };
  // Stage 2, step 3: the loadout of the arena — its consumables and the energy the run banked for it (up to the cap).
  if (loadout) {
    world.kit = kitOf(loadout);
    world.energy = Math.max(0, Math.min(ENERGY_CAP, Number.isFinite(loadout.energy) ? loadout.energy! : 0));
    // Phase B: the build may change the focus reserve (without a build module — `focusMax`, as above).
    world.focus = focusMaxOf(world);
    // Casino «Ставка клятвы»: the oath the run's node card took (only while `oathStake` is on).
    if (loadout.oath !== undefined) startOath(world, loadout.oath);
  }
  // The prologue: the arena's own start energy instead of the loadout's (`'jump'` — the price of one jump), up to the cap.
  if (arena.startEnergy !== undefined) world.energy = startEnergyOf(world);
  // The prologue, task 9 (the potion room): the hero starts wounded (not above his maximum, at least 1).
  if (arena.startHp !== undefined) world.hero.hp = Math.max(1, Math.min(world.hero.maxHp, arena.startHp));
  // The prologue, task 9 (goal `strike`): the spins are counted (only on such an arena).
  if (arena.goal === 'strike') world.strike = { best: 0 };
  // The prologue, task 13 (goal `shield`): the shield's lamps are counted (only on such an arena).
  if (arena.goal === 'shield') world.shieldGoal = { lit: 0 };
  // Start enemies of the template stand at their posts from the start (no markers): the marked ones of the third arena.
  const startIds = arena.enemies.map(s => placeStartEnemy(world, s).id);
  // The prologue: the start enemies are watched for their return (only on an arena with `restore`).
  if (arena.restore) world.restore = { ids: startIds };
  // The prologue: the enemies sleep until the first press (only on an arena with `sleepUntilChain`).
  if (arena.sleepUntilChain) world.asleep = true;
  // К7 «Проклятый сундук»: the chest at the template's point (after the start enemies: they keep their ids).
  placeChest(world);
  // The prologue: the goblin of the template stands from the start (after the start enemies: they keep their ids).
  if (arena.goblin) placeArenaGoblin(world, arena.goblin);
  world.stats.spawned = 0;
  world.events.length = 0;
  // Phase B: the build modules see the arena start (the kit and the start enemies are there).
  runHook(world, 'onArenaStart', m => m.onArenaStart!(world));
  return world;
}

/**
 * The prologue: the arena's start energy (`ArenaTemplate.startEnergy`) in this world — `'jump'` the price of one jump, `'spin'`
 * of one spin, a number as it is — up to the cap; 0 without it.
 */
export function startEnergyOf(world: World): number {
  const e = world.arena.startEnergy;
  if (e === undefined) return 0;
  return Math.max(0, Math.min(ENERGY_CAP, e === 'jump' ? jumpCostOf(world) : e === 'spin' ? world.params.spinCost : e));
}

/**
 * HP a start enemy of the template has at its post (its own, or its kind's from the panel). Task 12: a leader has at least the
 * row's tough HP (`toughHpMaxOf`: the run's table by the row through the kit, else the panel's) + `LEADER_HP_OVER_TOUGH`.
 */
function startHp(world: World, s: StartEnemy): number {
  const hp = s.hp ?? enemyKind(s.kind ?? 'basic').hp(world.params) ?? 0;
  return s.leader ? Math.max(hp, toughHpMaxOf(world) + LEADER_HP_OVER_TOUGH) : hp;
}

/** A start enemy of the template at its post (`createWorld`; the prologue's return brings a dead one back the same way). */
function placeStartEnemy(world: World, s: StartEnemy): Enemy {
  const kind = s.kind ?? 'basic';
  const e = spawnEnemy(world, s, s.color, startHp(world, s), kind);
  e.marked = !!s.marked;
  // Task 12: a leader of a goal layout (the field only on it).
  if (s.leader) e.leader = true;
  // Task 28: a boss core without its shield (the run's viewer has not met the shieldbearer; the var only on it).
  if (s.shieldless) e.vars.bare = 1;
  // Task 38: a start guard of a formation (the var only on it; −n, apart from the newcomers' ids).
  if (s.formation !== undefined) e.vars.fm = -s.formation;
  // Stage 2, step 3: an elite from the start (arenas 9–10 of step 4).
  if (s.elite) makeElite(world, e);
  pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
  return e;
}

/**
 * The prologue «Опушка»: a return is needed now — the goal is not met and, by the arena's mode, a start enemy is dead or
 * wounded (`afterDash`), or none is left and the lever was never pulled (`whenGone`); never with `none`. Task 9: an
 * `afterDash` arena with `startEnergy` (the jump and spin rooms) needs one too when the energy is below it (a jump or a spin
 * spent it — the room gives it back).
 */
function restoreNeeded(world: World, state: RestoreState): boolean {
  const mode = world.arena.restore;
  if (world.stage !== 'goals' || mode === 'none') return false;
  const starts = world.arena.enemies, alive = state.ids.map(id => world.enemies.find(e => e.id === id));
  if (mode === 'whenGone') return alive.every(e => !e) && (goblinOf(world)?.pulls ?? 0) === 0;
  if (world.arena.startEnergy !== undefined && world.energy < startEnergyOf(world) - 1e-9) return true;
  return alive.some((e, i) => !e || e.hp < startHp(world, starts[i]));
}

/** The prologue: a start enemy put on its post now would stand on the hero's body (it would touch him at once). */
function postOnHero(world: World, post: Vec): boolean {
  return dist(post, world.hero) <= touchDistance(world.params) + CONTACT_SLACK;
}

/**
 * The prologue: start enemy `i` stands at its post with full HP — a living one is put back (its knockback, cold and burning
 * gone), a dead one comes back (a new id; no `spawn` event, not counted as spawned: the `restore` event says it).
 */
function restoreStart(world: World, state: RestoreState, i: number): { id: number; x: number; y: number } {
  const s = world.arena.enemies[i];
  let e = world.enemies.find(x => x.id === state.ids[i]);
  if (e) {
    e.x = s.x; e.y = s.y; e.hp = startHp(world, s);
    e.knock = 0; e.knockVx = 0; e.knockVy = 0; e.brake = 0; e.headX = 0; e.headY = 0;
    delete e.chill; delete e.brittle; delete e.burn;
    pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
  } else {
    const spawned = world.stats.spawned, from = world.events.length;
    e = placeStartEnemy(world, s);
    const id = e.id;
    world.events.splice(from, world.events.length - from, ...world.events.slice(from).filter(ev => !(ev.type === 'spawn' && ev.enemyId === id)));
    world.stats.spawned = spawned;
    state.ids[i] = e.id;
  }
  return { id: e.id, x: e.x, y: e.y };
}

/**
 * The prologue «Опушка» (`ArenaTemplate.restore`, design 12.10.2026; review 12.10.2026). While a dash (any move) runs the
 * count is off: the `RESTORE_DELAY` game seconds start anew when the last one ends. While no chain is drawn and nothing runs, a
 * needed return is due `RESTORE_DELAY` later; when it is due (still needed, still nothing drawn or run — a chain drawn then
 * makes it wait for its end): with `restoreHero` the hero stands on his start again, then every start enemy stands at its post
 * with full HP (`restoreStart`). A post on the hero's body waits (`RestoreState.wait`) until he steps off it; the others come at
 * once. Event `restore` for each batch (the late ones in their own event, marked `late`).
 */
function updateRestore(world: World, state: RestoreState): void {
  if (world.move) { delete state.due; return; }
  if (world.chain.length) return;
  if (state.wait) {
    // Late posts (review 12.10.2026: they too wait for the end of a chain and of a dash): each comes once the hero is off it,
    // while the goal is still not met.
    if (world.stage !== 'goals') { delete state.wait; return; }
    const ready = state.wait.filter(i => !postOnHero(world, world.arena.enemies[i]));
    if (ready.length) {
      state.wait = state.wait.filter(i => !ready.includes(i));
      if (!state.wait.length) delete state.wait;
      world.events.push({ type: 'restore', enemies: ready.map(i => restoreStart(world, state, i)), late: true });
    }
    return;
  }
  // Task 13 (room 9 «Щит», `restoreAfterShield`): while the after-chain shield is up a needed return is held due now — it comes
  // in the tick the shield ends (the touches of that tick run after it, `update`).
  if (world.arena.restoreAfterShield && world.hero.chainShield > 0) {
    if (restoreNeeded(world, state)) state.due = world.time; else delete state.due;
    return;
  }
  if (!restoreNeeded(world, state)) { delete state.due; return; }
  if (state.due === undefined) { state.due = world.time + RESTORE_DELAY; return; }
  if (world.time + 1e-9 < state.due) return;
  delete state.due;
  // Design answer 12.10.2026 (rooms 2–4): the hero goes back to the start with the same return (first: the posts are checked
  // against where he stands then).
  const hero = world.hero, back = world.arena.restoreHero ? world.arena.heroStart : null;
  if (back) {
    hero.x = back.x; hero.y = back.y; hero.knock = 0; hero.knockVx = 0; hero.knockVy = 0;
    pushOutOfObstacles(hero, heroRadius(world.params), world.arena);
  }
  // Task 9 (the jump and spin rooms): the energy comes back up to the room's start energy (more earned by chains is kept).
  if (world.arena.startEnergy !== undefined) world.energy = Math.max(world.energy, startEnergyOf(world));
  const out: { id: number; x: number; y: number }[] = [], wait: number[] = [];
  world.arena.enemies.forEach((s, i) => { if (postOnHero(world, s)) wait.push(i); else out.push(restoreStart(world, state, i)); });
  if (wait.length) state.wait = wait;
  // A return of the energy alone (the jump room: no enemies, the hero stays) has no smoke to draw — no event.
  if (out.length || wait.length || back) world.events.push({ type: 'restore', enemies: out, ...back ? { hero: { x: hero.x, y: hero.y } } : {} });
}

export function findObject(world: World, id: number): ArenaObject | undefined {
  return world.objects.find(o => o.id === id);
}

export function doorOf(world: World): ArenaObject {
  return world.objects.find(o => o.kind === 'door')!;
}

/** The door opens with the goals (greed stage); the prologue's goal `door` (task 9, the jump room) — open from the start. */
export function doorOpen(world: World): boolean { return world.stage === 'greed' || world.arena.goal === 'door'; }

/** Goal progress for the HUD and the goal check: done / total. */
export function goalProgress(world: World): { done: number; total: number; label: string } {
  const goal = world.arena.goal;
  if (goal === 'buttons') {
    const buttons = world.objects.filter(o => o.kind === 'button');
    return { done: buttons.filter(b => b.pressed).length, total: buttons.length, label: 'кнопки' };
  }
  if (goal === 'marked') return { done: world.stats.markedKills, total: markedCount(world.arena), label: 'отмеченные' };
  // The prologue: N kills by one dash — the best finished one, or the dash going now (the goal is met at its N-th kill).
  if (goal === 'chain') {
    const total = world.arena.killGoal ?? 1, move = world.move, now = move?.kind === 'dash' ? move.kills : 0;
    return { done: Math.min(total, Math.max(world.stats.bestChain, now)), total, label: 'одной цепью' };
  }
  // The prologue, task 9: N kills by one action — the best dash (as `chain`) or the best spin (`World.strike`).
  if (goal === 'strike') {
    const total = world.arena.killGoal ?? 1, move = world.move, now = move?.kind === 'dash' ? move.kills : 0;
    return { done: Math.min(total, Math.max(world.stats.bestChain, now, world.strike?.best ?? 0)), total, label: 'одним ударом' };
  }
  // The prologue, task 9: the door open from the start — entering it is the goal (the jump room).
  if (goal === 'door') return { done: world.status === 'victory' ? 1 : 0, total: 1, label: 'дверь' };
  // The prologue, task 9: a consumable used (the potion room) — its use completes the goals (items.ts `useItem`).
  if (goal === 'item') return { done: world.stage === 'greed' ? 1 : 0, total: 1, label: 'зелье' };
  // The prologue, task 13: the after-chain shield absorbed a touch — one lamp per shield window (`World.shieldGoal`).
  if (goal === 'shield') {
    const total = world.arena.killGoal ?? 1;
    return { done: Math.min(total, world.shieldGoal?.lit ?? 0), total, label: 'щит' };
  }
  // The prologue: the goblin's lever pulled N times.
  if (goal === 'pull') {
    const total = world.arena.killGoal ?? 1, g = goblinOf(world);
    // Task 24 (`slotPullGoalSettled`): a pull counts once settled — its reels stopped and no bust of it burns.
    // The goblin that busted is gone: its pulls are kept on the slot (`bustPulls`).
    const settled = world.params.slotPullGoalSettled, pulls = g?.pulls ?? (settled ? world.slot?.bustPulls ?? 0 : 0);
    const unsettled = settled && (g?.spin || world.blasts.some(b => b.bust)) ? 1 : 0;
    return { done: Math.min(total, Math.max(0, pulls - unsettled)), total, label: 'рычаг' };
  }
  const total = world.arena.killGoal ?? world.params.killGoal;
  return { done: Math.min(world.stats.kills, total), total, label: 'убито' };
}

/** The prologue: game seconds the lamps of a dash that ended short still burn (its last kill and its end fall in one tick). */
export const LAMPS_HOLD = 0.4;

/**
 * The prologue's lamps over the door (design 12.10.2026): how many burn and how many there are (the goal's number). For
 * `chain` they burn by the kills of the dash going now; when it ends short they hold its count `LAMPS_HOLD` game seconds
 * (`World.lastChain`) and go out; all burn once the goal is met. `strike` (task 9) — the same, and a spin's kills burn and
 * hold the same way (`World.strike.last`). For every other goal — its progress (`goalProgress`).
 */
export function goalLamps(world: World): { lit: number; total: number } {
  const { done, total } = goalProgress(world), goal = world.arena.goal;
  if ((goal !== 'chain' && goal !== 'strike') || world.stage === 'greed' || done >= total) return { lit: done, total };
  const move = world.move, last = world.lastChain, spun = world.strike?.last;
  if (move?.kind === 'dash') return { lit: Math.min(total, move.kills), total };
  const held = (x: { kills: number; time: number } | null | undefined): number => x && world.time - x.time < LAMPS_HOLD - 1e-9 ? Math.min(total, x.kills) : 0;
  return { lit: Math.max(held(last), held(spun)), total };
}

/**
 * The prologue, task 9 (goal `strike`): a spin killed `kills` — the best and the last spin are noted, the goal is checked. Nothing
 * on another arena (no `World.strike`).
 */
export function noteSpin(world: World, kills: number): void {
  const strike = world.strike;
  if (!strike) return;
  strike.best = Math.max(strike.best, kills);
  strike.last = { kills, time: world.time };
  checkGoals(world);
}

/**
 * The prologue, task 13 (goal `shield`): a dash just gave the after-chain shield (chain.ts `finishMove`: a chain of
 * `chainShieldMinKills`+ kills) — a new shield window starts (a new chain's shield replaces the rest of the old one, so its
 * window is a new one too). Nothing on another arena (no `World.shieldGoal`).
 */
export function startShieldWindow(world: World): void {
  if (world.shieldGoal) world.shieldGoal.window = { enemies: [] };
}

/**
 * The prologue, task 13 (goal `shield`, design 13.10.2026): each tick before the touches. While the after-chain shield is up
 * (`chainShield` > 0, whatever else protects the hero then — the invulnerability after a hit or «Щит фокуса» overlapping it
 * count as the shield's), every enemy whose touch would hurt the hero now (as `contactDamage` reads it: in reach, not frozen,
 * its behaviour touches, damage > 0; the hero playing on a non-calm arena, not dashing or jumping) is absorbed: `shieldBlock`
 * once per enemy per window, and the window's first block lights one lamp while the goals run (then the goal is checked).
 * When the shield is gone the window ends. Blocks of «Щит фокуса» or of the invulnerability after a hit alone light nothing.
 */
function noteShieldBlocks(world: World, state: ShieldGoalState): void {
  const { hero, params } = world;
  if (!(hero.chainShield > 0)) { if (state.window) delete state.window; return; }
  const current = state.window;
  if (!current || world.arena.calm || world.asleep || world.status !== 'playing' || world.move) return;
  for (const e of world.enemies) {
    if (current.enemies.includes(e.id) || dist(e, hero) > touchDistanceOf(params, e) + CONTACT_SLACK || enemyFrozen(e)) continue;
    const touches = behaviorOf(e).touches;
    if ((touches && !touches(world, e)) || touchDamage(world, e) <= 0) continue;
    current.enemies.push(e.id);
    world.events.push({ type: 'shieldBlock', enemyId: e.id, x: e.x, y: e.y });
    if (!current.lit && world.stage === 'goals') {
      current.lit = true;
      state.lit++;
      checkGoals(world);
    }
  }
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

/**
 * Package «Урон имеет значение»: a new firing id of a source that has none of its own (the spin) — a counter in the world,
 * present only once used (with armour on), so worlds without it hash as before. One firing takes plates once (elites.ts).
 */
export function nextFiring(world: World): number {
  world.firing = (world.firing ?? 0) + 1;
  return world.firing;
}

/** Entering the open door: the arena is won. */
/** The hero goes through the open door — `by` the chain ending on it, a jump landing in it or walking in. */
export function win(world: World, by: DoorExit): void {
  if (world.status !== 'playing') return;
  world.status = 'victory';
  world.endTime = world.time;
  world.chain = [];
  delete world.chainClosed;
  // Casino «Ставка клятвы»: an «at least once» oath not met by now breaks here; the door then records its multiplier.
  if (world.oath) oathDoor(world);
  // Casino «Котёл»: the chain entering the door puts its cheque first, then the door records the cauldron (purse.ts).
  purseDoor(world, by);
  // Task 14 «Котомка у двери»: the door pays the filled steps (kinds of the stream `bag`; nothing without a bag).
  if (world.bag) bagDoor(world);
  world.events.push({ type: 'victory' });
}

/** Contact damage of one enemy now: its kind decides (the reaper, a wolf with its pack bonus, the base touch). */
export function touchDamage(world: World, e: Enemy): number {
  // К7 «Проклятый сундук»: the curse adds +1 to the touch (not the reaper's); nothing while the chest is not taken.
  const damage = touchBase(world, e);
  return world.curse ? curseTouch(world, e, damage) : damage;
}
function touchBase(world: World, e: Enemy): number {
  // The elite bonus comes in `hurtHero` (every hit of an elite, stage 2, step 3) — not on a raised touch (`touchRaised`).
  const base = kindOf(e).touchDamage(world, e);
  if (base <= 0 || !touchRaised(world, e)) return base;
  // Package «Урон имеет значение»: the base touch (`contactDamage`) is raised to the elite's / the tough one's; the kind's own
  // part on top of it (the wolf's pack bonus) stays.
  const p = world.params, raised = elitePlated(e) ? p.eliteTouchDamage : p.toughTouchDamage ?? 2;
  return base + Math.max(0, raised - p.contactDamage);
}

/** An elite's armour (not a boss's plates, task 27): its touch is the elite's and knocks the hero back. */
const elitePlated = (e: Enemy): boolean => !!e.armor && !e.armor.boss;

/**
 * Package «Урон имеет значение» (docs/realtime-damage.md): the touch of `e` is raised now — an armoured elite (its touch
 * `eliteTouchDamage`), or with `toughTouch` an elite or an enemy with HP ≥ 2 at this moment (`toughTouchDamage`). Never the
 * reaper. A raised touch of an elite takes no `eliteDamageBonus` on top.
 */
export function touchRaised(world: World, e: Enemy): boolean {
  if (kindOf(e).immune) return false;
  if (elitePlated(e)) return true;
  return !!world.params.toughTouch && (!!e.elite || e.hp >= 2);
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

/**
 * Walking speed of a kind before the spread: with speed classes (phase A, T1; `speedClasses` — journals without it have the
 * old formulas) the pace's enemy speed × the class (slow `speedSlow`, normal 1, fast `speedFast`), else the kind's own speed.
 * A kind without a class (the reaper) always walks by its own.
 */
export function kindSpeed(world: World, e: Enemy): number {
  const p = world.params, def = kindOf(e), cls = p.speedClasses ? def.speedClass : undefined;
  if (!cls) return def.speed(world, e);
  return world.pressure.enemySpeed * (cls === 'slow' ? p.speedSlow : cls === 'fast' ? p.speedFast : 1);
}

/**
 * Speed of an enemy right now, in units per game second: its kind's (or class's) speed × spread and braking × the marked
 * slowdown × its affixes («Стремительный», «Толстый»; phase A, T4).
 */
export function enemySpeed(world: World, e: Enemy): number {
  const p = world.params;
  let speed = kindSpeed(world, e) * enemySpeedFactor(e, p) * (e.marked ? p.markedSpeed : 1);
  if (e.affixes) speed *= affixSpeedFactor(world, e);
  // Phase B (build.ts, decision 22): the build's multiplier of the walk — not the reaper (charges and leaps do not read it).
  const walk = kindOf(e).immune ? 1 : enemyWalkFactorOf(world);
  return walk === 1 ? speed : speed * walk;
}

const SEPARATION_PASSES = 4;
/** Slack of the touch reach (and of the boar charge reaching the hero). */
export const CONTACT_SLACK = 0.03;
/** Game seconds over which a knockback (the boar's charge) moves the hero. */
const HERO_KNOCK_TIME = 0.15;

/** The hero can be hurt now: playing, no invulnerability or after-chain shield, not dashing or jumping, not spared by focus. */
export function canBeHurt(world: World): boolean {
  // The prologue: nothing hurts the hero in a calm arena.
  if (world.arena.calm) return false;
  if (world.status !== 'playing' || world.hero.invulnerable > 0 || world.hero.chainShield > 0 || world.move) return false;
  if (focusGuarded(world)) return false;
  return !(world.params.focusNoDamage && world.focusing);
}

/**
 * «Взрыв по площади» (design 13.10.2026, В1): the goblin's bust blast may hurt the hero now — playing, not a calm arena, no
 * invulnerability, not dashing or jumping (`world.move`). The after-chain shield and the focus («Щит фокуса», «фокус без
 * урона») do not spare him: «риск должен быть настоящим».
 */
export function bustCanHurt(world: World): boolean {
  if (world.arena.calm) return false;
  return world.status === 'playing' && !(world.hero.invulnerable > 0) && !world.move;
}

/** «Взрыв по площади»: the hero's body touches the bust circle `b` (as the blast tests it: radius + the hero's body). */
export function bustInside(world: World, b: Blast): boolean {
  return dist(world.hero, b) <= b.radius + heroRadius(world.params);
}

/**
 * The bust blast `b` takes HP from the hero if it goes off now: a bust with damage, his body in it, `bustCanHurt`. `bustHero` hurts
 * by it; task 23 (`guard.ts` `bustThreat`, the view's «щит не держит») reads the same.
 */
export function bustHurts(world: World, b: Blast): boolean {
  return !!b.bust && b.bust.hero > 0 && bustInside(world, b) && bustCanHurt(world);
}

/**
 * Task 23 «Щит виден» (design 15.10.2026): what spares the hero now is a shield — the after-chain shield, «Щит фокуса» or the
 * invulnerability after a hit — and not a dash or a jump (`world.move`), a calm arena, the fight's end or the sandbox's «фокус без
 * урона». True only while `canBeHurt` is false.
 */
export function heroGuarded(world: World): boolean {
  if (world.arena.calm || world.status !== 'playing' || world.move) return false;
  return world.hero.invulnerable > 0 || world.hero.chainShield > 0 || focusGuarded(world);
}

/**
 * Task 23: a hit reached the hero where `canBeHurt` is false — event `block` when a shield spared him (`heroGuarded`). Reads the
 * world only (no state, no random draw): the world hashes as before.
 */
export function noteBlock(world: World, x: number, y: number, source: HitSource, enemyId?: number): void {
  if (heroGuarded(world)) world.events.push({ type: 'block', x, y, source, ...enemyId ? { enemyId } : {} });
}

/**
 * «Щит фокуса» (`focusGuardLinks`, design 12.10.2026): the drawn chain has that many enemy links (an elite with plates is a
 * link) and the focus is not empty (`focusing`: the time slowed) — touches and hits spare the hero. The released dash plays
 * by the usual rules (the dash itself, then the after-chain shield). Off (0 or no key) — never. The view's rim reads it.
 */
export function focusGuarded(world: World): boolean {
  const need = world.params.focusGuardLinks;
  if (!(need > 0) || !world.focusing || world.move || world.status !== 'playing') return false;
  let links = 0;
  for (const link of world.chain) if (link.kind === 'enemy' && ++links >= need) return true;
  return false;
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
 * (`canBeHurt`; the porcupine's quills ignore it, except the recovery window of the second wind, `secondWindRecovering`).
 * `striker` — the enemy (or the id of a dead one: a blast) in the event.
 */
export function hurtHero(world: World, striker: { id: number; elite?: Enemy['elite'] }, damage: number, source: HitSource): void {
  const { hero, params } = world;
  // The prologue: a calm arena never hurts the hero (whatever the source).
  if (damage <= 0 || world.arena.calm) return;
  // Task 28: the boss died — the fight is over, nothing hurts the hero any more (a blast still lit, the thorns …).
  if (world.bossCleared) return;
  damage = heroDamage(world, striker, damage);
  const hpBefore = hero.hp;
  hero.hp = Math.max(0, hero.hp - damage);
  // Stage 2, step 3 («Пепельный оберег», once a run): a hit that would kill leaves the hero with 1 HP; the ward crumbles.
  const kit = world.kit;
  if (hero.hp <= 0 && kit?.ward) { hero.hp = 1; kit.ward = false; kit.wardUsed = true; world.events.push({ type: 'ward' }); }
  // Task 14 «Котомка у двери» (bag.ts): HP actually lost sends the unfilled step back to its start (nothing without a bag).
  if (world.bag) bagHurt(world, hpBefore - hero.hp);
  hero.invulnerable = invulnerabilityFor(params, params.invulnerabilityMode, damage, hero.maxHp);
  hero.hurtFlash = Math.max(params.hitFlash, 0.01);
  world.stats.hitsTaken++;
  world.stats.damageTaken += damage;
  world.events.push({ type: 'hit', enemyId: striker.id, damage, x: hero.x, y: hero.y, source });
  // Casino «Ставка клятвы»: a lost HP may break «Без урона после целей» or «Не больше 2 урона» (in this tick).
  if (world.oath) oathHurt(world);
  // П4 «Раздув за дела» (purse.ts): a hit takes one greed step off and resets the count (nothing while the rule is off).
  if (world.purse?.greed) greedHurt(world);
  // П9 «Второе дыхание» (sandbox; the ward above goes first): once per fight the lethal hit leaves the hero standing. Task 17
  // «Пологий вход»: the run's own second wind comes in the kit (`Kit.secondWind`: rows 1–4, once a run) — the same rule.
  if (hero.hp <= 0 && (world.params.secondWind || kit?.secondWind) && !world.secondWind) secondWind(world, { hp: hpBefore, enemyId: striker.id, source });
  if (hero.hp <= 0) {
    world.status = 'defeat';
    world.endTime = world.time;
    world.events.push({ type: 'defeat' });
  }
}

/** П9 «Второе дыхание»: HP the hero stands up with (at most his max) and game seconds of his invulnerability after it. */
export const SECOND_WIND_HP = 3;
export const SECOND_WIND_INVULNERABLE = 2;

/**
 * П9 «Второе дыхание» (design decision 11.10.2026; docs/realtime-prototype.md): called by `hurtHero` after the lethal hit
 * counted as an ordinary hit (stats, the hit event, the oath's own check, П4's step off). The hero stands up with 3 HP and
 * 2 s of invulnerability — a recovery window (design decision 12.10.2026): the porcupine's quills, which pierce any other
 * invulnerability, do not pierce it (`secondWindRecovering`). The cauldron of the fight goes to 0 (later cheques fill it
 * again); the oath of the fight counts as broken. Once per fight (`world.secondWind`). `lethal` — the HP before the lethal
 * hit, its striker and source (the event: telemetry).
 */
function secondWind(world: World, lethal: { hp: number; enemyId: number; source: HitSource }): void {
  const { hero } = world;
  hero.hp = Math.min(SECOND_WIND_HP, hero.maxHp);
  hero.invulnerable = SECOND_WIND_INVULNERABLE;
  world.secondWind = { tick: world.tick, time: world.time };
  if (world.purse) world.purse.cauldron = 0;
  if (world.oath) oathForfeit(world);
  const striker = world.enemies.find(e => e.id === lethal.enemyId);
  world.events.push({ type: 'secondWind', x: hero.x, y: hero.y, ...lethal, ...striker ? { enemy: striker.kind } : {}, ...striker?.elite ? { elite: true } : {} });
}

/** Slack of the recovery window against the sums of 1/60 s (its last tick is the last tick of the wind's invulnerability). */
const SECOND_WIND_EPS = 1e-6;

/**
 * П9 (design decision 12.10.2026): the hero is in the recovery window of the second wind — less than
 * `SECOND_WIND_INVULNERABLE` game seconds since he stood up (the same seconds as the invulnerability it gave; a hit-stop
 * freezes both). The porcupine's quills do not pierce it; false without the wind (worlds without it play as before).
 */
export function secondWindRecovering(world: World): boolean {
  const wind = world.secondWind;
  return !!wind && world.time - wind.time < SECOND_WIND_INVULNERABLE - SECOND_WIND_EPS;
}

/**
 * Who killed an enemy outside the chain (stage 2 of the transition, docs/realtime-slice.md, section 4, «Зачёт убийств»):
 * `credited` — the player's kill (counted in kills and score; the blast of a sapper the player killed); not credited —
 * an enemy's ability (an arrow, the blast of a sapper lit by touch). `source` names it in the events.
 */
export interface KillCause {
  source: string; credited: boolean; fall?: boolean;

  /**
   * Package «Урон имеет значение» (elites.ts `stripPlates`): which firing of the source this is (a blast's id) — one firing
   * takes plates off an elite once. Absent — the source and the tick tell the firing.
   */
  firing?: number;
}

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
  // Casino «Котёл»: a link the player's tool killed keeps its embers for the chain's cheque (only while the cauldron is on).
  if (link) (move.fallen ??= []).push({ id: e.id, x: e.x, y: e.y, credited: cause.credited, ...e.elite && move.build ? { elite: true as const } : {}, ...cause.credited && move.purse ? { embers: fallenEmbers(e) } : {} });
  if (cause.credited) { world.stats.kills++; if (!link) world.stats.score += world.params.scorePerKill; }
  // Task 14 «Котомка у двери» (bag.ts): a credited kill after the goals fills the bag (nothing without one).
  if (cause.credited && world.bag) bagKill(world);
  // Casino «Котёл»: a kill of the player's build outside the chain — 1 ember, no heat (the source decides, purse.ts). A link of
  // the dash ahead is the chain's: its embers come in the cheque (`fallenEmbers`, as its score comes with the chain's).
  if (!link) purseKill(world, cause);
  if (e.marked) world.stats.markedKills++;
  checkGoals(world);
  // Task 40: a prisoner's shackle goes with it (nothing while no shackle holds it).
  if (world.tethers) dropShackleOf(world, e);
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
  // Package «Урон имеет значение»: an armoured elite with plates loses plates, not HP (elites.ts — the one place of the rule).
  if (platesOf(e) > 0) { stripPlates(world, e, cause); return; }
  const killed = damage >= e.hp;
  e.hurtFlash = Math.max(world.params.hitFlash, 0.01);
  world.events.push({ type: 'enemyHit', enemyId: e.id, damage, killed, x: e.x, y: e.y, source: cause.source });
  if (killed) killEnemy(world, e, cause);
  else e.hp -= damage;
}

/**
 * A blast lit on the arena (`delay` game seconds; 0 — it goes off in this tick's blast step when lit before it, as a sapper's;
 * one lit after the blast step — the goblin's bust, slot.ts `updateSlot` — goes off in the next tick's).
 */
export function addBlast(world: World, at: Vec, blast: { radius: number; damage: number; delay: number; credited: boolean; source: string; ownerId: number; elite?: boolean; bust?: { hero: number } }): Blast {
  const b: Blast = { id: world.nextId++, x: at.x, y: at.y, radius: blast.radius, damage: blast.damage, timeLeft: blast.delay, total: blast.delay, credited: blast.credited, source: blast.source, ownerId: blast.ownerId,
    ...blast.elite ? { elite: true as const } : {}, ...blast.bust ? { bust: { hero: blast.bust.hero } } : {} };
  world.blasts.push(b);
  return b;
}

/** A blast goes off: its burning owner dies in it, then the hero (first: his death comes before a goal) and the enemies are hit. */
function detonate(world: World, b: Blast): void {
  const cause: KillCause = { source: b.source, credited: b.credited, firing: b.id }, p = world.params;
  world.events.push({ type: 'blast', x: b.x, y: b.y, radius: b.radius, source: b.source });
  const owner = world.enemies.find(e => e.id === b.ownerId);
  if (owner) killEnemy(world, owner, cause);
  if (b.bust) {
    bustHero(world, b, b.bust.hero);
    // Task 24 (`slotPullGoalSettled`): the bust's pull counts for the goal «pull» once it went off.
    if (world.params.slotPullGoalSettled && world.arena.goal === 'pull' && world.status === 'playing') checkGoals(world);
  }
  else if (dist(world.hero, b) <= b.radius + heroRadius(p)) {
    if (canBeHurt(world)) hurtHero(world, { id: b.ownerId, ...b.elite ? { elite: true as const } : {} }, b.damage, b.source);
    else noteBlock(world, b.x, b.y, b.source, b.ownerId);
  }
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => dist(e, b) <= b.radius + bodyRadiusOf(p, e));
  for (const e of struck) damageEnemy(world, e, b.damage, cause);
  // Stage 3a (М2; the sandbox slider «Взрыв отбрасывает», 0 — off): the survivors are thrown off the blast; one thrown over a
  // cliff falls — the blast's kill (credited as the blast).
  const push = p.blastPush ?? 0;  // journals before stage 3a have no such value: no push
  if (push <= 0) return;
  for (const e of struck) {
    if (!world.enemies.includes(e)) continue;
    const dx = e.x - b.x, dy = e.y - b.y, d = dhypot(dx, dy);
    if (d < 1e-6) continue;
    e.x += dx / d * push; e.y += dy / d * push;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena, false);
  }
  dropIntoCliffs(world, null, { ...cause, fall: true });
}

/**
 * «Взрыв по площади»: the goblin's bust blast and the hero — inside when his body circle touches it; hurt by `bustCanHurt`
 * (no striker: the idol is not an enemy). Event `slot` `blast`: inside or not, hurt or spared (telemetry, the view).
 */
function bustHero(world: World, b: Blast, damage: number): void {
  const inside = bustInside(world, b), hurt = damage > 0 && bustHurts(world, b);
  world.events.push({ type: 'slot', action: 'blast', x: b.x, y: b.y, r: b.radius, inside, hurt });
  if (hurt) hurtHero(world, { id: 0 }, damage, b.source);
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

/** Enemies moved by a running knockback in this tick (stage 3a: only they fall as the knockback's kill); null — no cliff. */
function moveEnemies(world: World, dt: number): Set<Enemy> | null {
  const { hero, params, arena, flow } = world;
  const knocked = hasZone(arena, 'cliff') ? new Set<Enemy>() : null;
  // The prologue: in a calm arena (and while they sleep) the enemies stand — no group step, no own step, no walk (a knockback
  // still slides them).
  const calm = !!arena.calm || !!world.asleep;
  // Stage 3a, step 3: group steps of the behaviours that have one (the wolves' ring), once per tick before anyone moves.
  if (!calm) for (const group of groupBehaviors()) {
    const members = world.enemies.filter(e => behaviorOf(e) === group);
    if (members.length) group.beforeStep!(world, members, dt);
  }
  // A behaviour's step may kill (the archer's arrow): walk over a copy, so the list shrinking never skips the next enemy's
  // step; an enemy killed earlier in this step does not move.
  const list = [...world.enemies];
  for (const e of list) {
    if (list.length !== world.enemies.length && !world.enemies.includes(e)) continue;
    // A frozen enemy stands: no own step (its timers wait), no walk.
    if (enemyFrozen(e)) continue;
    // Task 40: the keymaster's prisoner stands — no own step, no walk (a knockback still slides it; tethers.ts `shackled`).
    const held = !!world.tethers && shackled(world, e);
    // Task 41: a prisoner a cut shackle set loose riots (the hound's law; only with `prisonerRiot`, never a hound: its own step).
    if (!calm && !held && e.kind !== 'hound' && (e.vars.loose || e.vars.fz) && riotStep(world, e, dt)) continue;
    // A behaviour with its own movement (the boar's windup, charge and rest) skips the common walk this step.
    const own = calm || held ? undefined : behaviorOf(e).step;
    if (own && own(world, e, dt)) continue;
    if (e.knock > 0) {
      const t = Math.min(dt, e.knock);
      e.x += e.knockVx * t; e.y += e.knockVy * t; e.knock -= t;
      knocked?.add(e);
      // Stage 3a (М2): a survivor knocked back by the chain over a cliff falls — the chain's kill.
      if (arena.terrain && overCliff(e, arena) && !kindOf(e).immune) killEnemy(world, e, { source: 'chain', credited: true, fall: true });
      continue;
    }
    if (calm || held) continue;
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
        const hx = e.headX + (dx - e.headX) * k, hy = e.headY + (dy - e.headY) * k, hl = dhypot(hx, hy);
        if (hl > 0.2) { dx = hx / hl; dy = hy / hl; }
      }
      e.headX = dx; e.headY = dy;
    }
    const step = Math.min(enemySpeed(world, e) * enemyGroundFactor(world, e) * dt, Math.max(0, d - stop));
    e.x += dx * step; e.y += dy * step;
    // Stage 3a (М2): walking never enters a cliff — its edge is a wall for the walk (a push may still throw a body over it).
    if (arena.terrain) pushOutOfCliffs(e, r, arena);
  }
  return knocked;
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
  const len = dhypot(input.x, input.y);
  // Phase B: the build may change the hero's speed (`heroSpeedOf`; without a build module — `heroSpeed`).
  const heroSpeed = heroSpeedOf(world);
  if (len < 1e-6 || heroSpeed <= 0) return;
  world.heroWalk.x = input.x / len; world.heroWalk.y = input.y / len;
  // Water × crowd (stage D): the only walking multipliers; focus slows the game time itself, not the walk.
  const k = heroSpeed * waterFactor(world, hero) * crowdFactor(world) * dt / Math.max(1, len);
  let mx = input.x * k, my = input.y * k;
  if (!params.heroThroughEnemies) {
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const e of world.enemies) {
        const min = heroBlockDistance(params, e);
        const ex = hero.x - e.x, ey = hero.y - e.y, d = dhypot(ex, ey);
        if (d > min + 0.05 || d < 1e-6) continue;
        const nx = ex / d, ny = ey / d, into = -(mx * nx + my * ny);
        // Only the part of the step that goes into the enemy (and would end inside its body circle).
        if (into <= 0 || dhypot(hero.x + mx - e.x, hero.y + my - e.y) >= min) continue;
        mx += nx * into; my += ny * into; changed = true;
      }
      if (!changed) break;
    }
    // Squeezed between several enemies: no step gets out without entering one — stand.
    for (const e of world.enemies) {
      const min = heroBlockDistance(params, e);
      const before = dist(hero, e), after = dhypot(hero.x + mx - e.x, hero.y + my - e.y);
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
  // The prologue: in a calm arena the enemies hold their posts — the walking hero passes through them without parting them.
  if (arena.calm || world.asleep) return null;
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
        if (d < 1e-6) { const ang = rng.next() * Math.PI * 2; dx = dcos(ang); dy = dsin(ang); d = 0; }
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
      const dx = e.x - hero.x, dy = e.y - hero.y, d = dhypot(dx, dy);
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
 * `cause` when given (a blast); else a chain knockback that moved it in this tick (`knocked`; the survivor's knockback — the
 * player's; a knockback held by the cold moves nothing and counts for nothing); else a heavier body that shoved it this tick
 * (the charging boar: its source, not credited); else the crowd's pushing or the walking hero's parting (`push`, not credited
 * — design answer 09.10.2026: a kill counts for the player only by the player's action). An immune kind (the reaper) does
 * not fall: it is put back on the edge.
 */
export function dropIntoCliffs(world: World, shoved: Map<Enemy, Enemy> | null, cause?: KillCause, knocked?: Set<Enemy> | null): void {
  const arena = world.arena;
  if (!hasZone(arena, 'cliff')) return;
  for (const e of [...world.enemies]) {
    if (world.status !== 'playing') return;
    if (!world.enemies.includes(e) || !overCliff(e, arena)) continue;
    if (kindOf(e).immune) { pushOutOfObstacles(e, bodyRadiusOf(world.params, e), arena); continue; }
    // Task 27 (design 15.10.2026): a boss's part is held by its core — no push throws it over (a sever by chance is no skill).
    if (e.partOf !== undefined && world.params.bossFrame) { pushOutOfObstacles(e, bodyRadiusOf(world.params, e), arena); continue; }
    const by = shoved?.get(e);
    const why: KillCause = cause ?? (knocked?.has(e) ? { source: 'chain', credited: true, fall: true }
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
  else noteBlock(world, hero.x, hero.y, 'thorns');
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
  // The prologue, task 13 (goal `shield`): touches the after-chain shield absorbs light its lamps (nothing on another arena).
  if (world.shieldGoal) noteShieldBlocks(world, world.shieldGoal);
  // The prologue: sleeping enemies do not touch.
  if (world.asleep) return;
  // Task 23: a shield (`heroGuarded`) absorbs every touch that would hurt — event `block` per touching enemy, nothing else.
  const hurtable = canBeHurt(world);
  if (!hurtable && !heroGuarded(world)) return;
  // Invulnerability alone limits the damage rate: one hit, then a grace window for the whole crowd.
  // The strongest touching enemy counts: the reaper (design answer 30) or a wolf with its pack.
  // A behaviour may say its touch does not hurt now: the charging boar's hit is the charge (enemies/boar.ts).
  let striker: Enemy | null = null, damage = 0;
  for (const e of world.enemies) {
    if (dist(e, hero) > touchDistanceOf(params, e) + CONTACT_SLACK || enemyFrozen(e)) continue;
    const touches = behaviorOf(e).touches;
    if (touches && !touches(world, e)) continue;
    const dmg = touchDamage(world, e);
    if (!hurtable) { if (dmg > 0) noteBlock(world, e.x, e.y, kindOf(e).hitSource, e.id); continue; }
    if (!striker || dmg > damage) { striker = e; damage = dmg; }
  }
  if (!striker || damage <= 0) return;
  striker.brake = params.brakeRecovery;
  striker.strikeFlash = 0.18;
  // Package «Урон имеет значение»: a raised touch of an elite takes no elite bonus on top (it is the elite's touch already).
  const raisedElite = !!striker.elite && touchRaised(world, striker);
  hurtHero(world, raisedElite ? { id: striker.id } : striker, damage, kindOf(striker).hitSource);
  // An armoured elite's touch knocks the hero back (as the boar's charge, `knockHero`), away from it.
  const knock = elitePlated(striker) ? params.eliteKnockback : 0;
  if (knock > 0 && world.status === 'playing') {
    const dx = hero.x - striker.x, dy = hero.y - striker.y, d = dhypot(dx, dy);
    if (d > 1e-6) knockHero(world, dx / d, dy / d, knock);
  }
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
  // Task 14 «Котомка у двери» (bag.ts): the bag appears with the open door (nothing while the rule is off).
  bagAppear(world);
  // The prologue, task 13 (room 9 «Щит», `sleepOnDoor`): the enemies fall asleep with the door's opening (nothing elsewhere).
  if (world.arena.sleepOnDoor) world.asleep = true;
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
  // Task 18 «Испытание V»: the run's pace of the phase table (`Kit.phaseScale`; absent — as before).
  world.pressure = pressureAt(world.params, world.time, world.greedStart, world.arena, phaseDelayOf(world), world.kit?.phaseScale ?? 1);
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
  // Task 28: the boss died — nothing spawns any more (no reaper, no groups; the markers were dropped).
  if (!world.bossCleared) {
    if (world.params.reaperEnabled && world.greedStart !== null && !world.reaperSpawned && world.time - world.greedStart >= world.params.reaperTime) spawnReaper(world);
    updateSpawning(world, dt);
  }
  stepHeroKnock(world, dt);
  stepHeroWalk(world, dt);
  // Stage 2, step 3: the walking hero picks up the loot he touches.
  touchLoot(world);
  // К7 «Проклятый сундук»: and the chest (nothing on an arena without it).
  touchChest(world);
  // Walking in wins on a NEW touch of the open door only (design 07.10.2026): a hero standing on the door when it opens
  // keeps the choice to stay greedy — he must step off and touch it again (or enter by a chain or a jump).
  const onDoor = heroTouchesDoor(world), touchedNow = onDoor && !world.heroOnDoor;
  world.heroOnDoor = onDoor;
  // Task 16: walking in — the tick's time is on `world.time` already (`featExit`, nothing without a feat).
  if (world.params.doorWalkIn && !world.move && touchedNow && doorOpen(world)) { win(world, 'walk'); featExit(world, 0); return; }
  updateFlow(world, dt);
  const knocked = moveEnemies(world, dt);
  const shoved = separate(world);
  // Stage 3a (М2): bodies pushed over a cliff fall (only on an arena with a cliff).
  dropIntoCliffs(world, shoved, undefined, knocked);
  updateBlasts(world, dt);
  if (world.status !== 'playing') return;
  // Casino stage 1 («Однорукий гоблин»): the roll after the goals, the reels, the arrows (nothing while the toggle is off).
  updateSlot(world, dt);
  if (world.status !== 'playing') return;
  // Stage 2, step 3: burning enemies (the fire consumable) take their ticks after the blasts, before the touches.
  updateBurning(world, dt);
  // Phase B: the build modules' own step (the hammer's fire), after burning, before thorns.
  runHook(world, 'onUpdate', m => { if (world.status === 'playing') m.onUpdate!(world, dt); });
  if (world.status !== 'playing') return;
  // Stage 3a: thorns prick the hero on foot (М3); braziers burn again (М4). Arenas without them: nothing.
  updateThorns(world, dt);
  if (world.status !== 'playing') return;
  // Phase A, T4: the elites' affixes — the chameleon's colour, the fire trail (it burns the hero and enemies).
  updateAffixes(world, dt);
  if (world.status !== 'playing') return;
  updateBraziers(world, dt);
  // Package «Урон имеет значение»: the armour's window and regrowth (elites with armour only), before the touches.
  updateArmor(world, dt);
  // The prologue, task 13 (room 9 «Щит», `restoreAfterShield`): the return runs before the touches, so the ring and the hero are
  // back in the tick the shield ends, before a touch could hurt (every other arena: after the touches, as before).
  const restoreFirst = !!world.arena.restoreAfterShield;
  if (restoreFirst && world.restore) updateRestore(world, world.restore);
  contactDamage(world, dt);
  // The prologue: the start enemies' return (only on an arena with `restore`).
  if (!restoreFirst && world.restore && world.status === 'playing') updateRestore(world, world.restore);
  // Task 16 «Подвиги» (feat.ts): the feat is latched at the end of a tick the hero lived through (nothing without a feat).
  featCheck(world);
}
