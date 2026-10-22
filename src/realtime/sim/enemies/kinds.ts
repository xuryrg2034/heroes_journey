/**
 * Enemy kinds and behaviours of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»). A kind is a description — HP, speed, body and art size, touch damage, mass, whether a
 * chain may take it, and a reference to a behaviour; a behaviour is a module with its own step (a charge, a dash, a
 * cast). New kinds and behaviours are registered (`registerEnemyKind`, `registerBehavior`) — the simulation core
 * (world.ts, chain.ts, spawn.ts) reads them through `kindOf` / `behaviorOf` and is not edited.
 *
 * Speeds, HP and damage are functions of the live params: the debug-panel sliders keep working for the prototype kinds.
 */
import type { StrikeOutcome } from '../chain';
import type { Vec } from '../geometry';
import { enemyBodyRadius, enemyDrawRadius, type Params } from '../params';
import type { Enemy, KillCause, World } from '../world';

export interface EnemyBehavior {
  id: string;
  /** Once, right after an enemy of a kind with this behaviour appears (a marker opened, or an arena start enemy). */
  onSpawn?(world: World, enemy: Enemy): void;
  /**
   * Own movement this step (`dt` — game seconds). True — the enemy moved by itself, the common walk to the hero
   * (flow field, braking, knockback) is skipped this step.
   */
  step?(world: World, enemy: Enemy, dt: number): boolean;
  /** False — its touch does not hurt right now (the charging boar: its hit is the charge). */
  touches?(world: World, enemy: Enemy): boolean;
  /**
   * Stage 2 of the transition (docs/realtime-slice.md, section 4): false — the enemy cannot be struck from this point (the
   * previous link of the chain, or the hero for the first link — the direction of the strike), the pointer hint says why
   * (`guarded`: the shieldbearer's shield). Checked after reach and sight (chain.ts); the hero anchor talisman only widens
   * the reach, the strike still comes from the previous link.
   */
  canBeLinkedFrom?(world: World, enemy: Enemy, anchor: Vec): boolean;
  /**
   * Stage 2 of the transition: the enemy has just died (already off the arena) — by the chain (`source` `chain`, credited)
   * or outside it (`killEnemy`: an arrow, a blast). The sapper lights its fuse here.
   */
  onDeath?(world: World, enemy: Enemy, cause: KillCause): void;
  /**
   * Stage 2 of the transition: a chain hit lands on the enemy (`outcome` — the strike about to apply), before its result.
   * The porcupine's quills hurt the hero here. If the hero falls, the strike does not land and the dash stops.
   */
  onChainHit?(world: World, enemy: Enemy, outcome: StrikeOutcome): void;
  /**
   * Iteration 2.1: the damage to the hero the enemy's reaction to a chain hit would do now (the porcupine with its quills
   * up: its quills, +1 for an elite); 0 — not armed. Read at the release of the chain for each enemy link and fixed for the
   * dash (`HeroMove.armed`), as the ×2 of the cold: `onChainHit` reads the fixed list, the drawn chain's «−N HP» badge
   * reads this function now.
   */
  armed?(world: World, enemy: Enemy): number;
  /**
   * Stage 3a, step 3 (docs/realtime-stage3.md, section 10): once per tick, before the enemies move, with every living enemy
   * of this behaviour (frozen ones too — the behaviour decides), in the order of the arena's list. A group decision of a
   * kind (the wolves' ring: slots around the hero, the pack's howl) is taken here once, not by whichever member steps
   * first. State lives in `enemy.vars`.
   */
  beforeStep?(world: World, members: readonly Enemy[], dt: number): void;
  /**
   * Task 38 (tethers.ts `cutTethers`): a dash has just cut a tether this enemy held (`held` — the body it held, loose now). The
   * Castellan loses a plate after the dash here.
   */
  onTetherCut?(world: World, holder: Enemy, held: Enemy): void;
  /**
   * Task 43: true — the enemy runs through the hero's body now (the knight's «Рывок» runs its lane to its end): the parting does
   * not put it back on his touch circle (world.ts `separate`). Absent — it is put back, as every body.
   */
  passesHero?(world: World, enemy: Enemy): boolean;
  /**
   * Task 48 (`Params.trollSolid`): true — the body is solid for the hero now (the Troll's core and parts, held at their spots): the hero
   * never stands inside it — walking, a knockback, the end of a dash or a jump put him out of it as out of an obstacle (world.ts
   * `pushOutOfSolids`), and the body itself is never moved by the parting or the crowd. Absent — an ordinary body.
   */
  solid?(world: World, enemy: Enemy): boolean;
  /** Task 55а (sim/shove.ts `startShove`): a shove of this thing starts (the wardrobe drops its topple). */
  onShoved?(world: World, thing: Enemy): void;
  /**
   * Task 57а: how the parting (world.ts `separate`) treats the body now — `anchored`: the crowd and the walking hero never move it,
   * the others yield (the hive); `ghost`: it takes no part at all — no push either way, no obstacle, no cliff (the flying wisp).
   * Absent — an ordinary body.
   */
  crowd?(world: World, enemy: Enemy): 'anchored' | 'ghost';
  /**
   * Task 57б-2 (world.ts `separate`): two overlapping anchored bodies, both of this behaviour — `kin`: parts of one creature, no push
   * either way (as any two anchored ones); `apart`: they part as ordinary bodies, by mass (two centipedes). Absent — as two anchored ones.
   */
  pairWith?(world: World, a: Enemy, b: Enemy): 'kin' | 'apart';
}

/**
 * Phase A, T1 (docs/realtime-phase-a.md, section 2): the speed class of a kind — its walk is the pace's enemy speed ×
 * `speedSlow` / 1 / `speedFast` (the panel toggle `speedClasses`, on by default and always in a run). The class replaces the
 * kind's own multiplier (`speed`), it does not stack on it; dashes, rushes and leaps keep their own speeds.
 */
export type SpeedClass = 'slow' | 'normal' | 'fast';

export interface EnemyKindDef {
  id: string;
  /** Behaviour id (`registerBehavior`); `chase` — the common walk to the hero only. */
  behavior: string;
  /** HP of a newcomer of this kind; null — the tough roll of the phase (0, or 1–2 for a tough one). */
  hp(params: Params): number | null;
  /**
   * Walking speed, units per game second, before the personal spread, the braking and the marked slowdown. With speed
   * classes on (`speedClasses`) a kind with a `speedClass` walks by its class instead (world.ts `enemySpeed`); this is the
   * formula of the journals before phase A.
   */
  speed(world: World, enemy: Enemy): number;
  /** Phase A, T1: the speed class (absent — the kind walks by `speed` always: the reaper). */
  speedClass?: SpeedClass;
  /** Task 43: the class of this enemy now, when its state changes it (the knight: slow in armour, normal in the offensive). */
  speedClassOf?(enemy: Enemy): SpeedClass;
  /** Task 43: its touch is its own (`touchDamage`) — never raised by the elite's or the tough one's touch (the knight). */
  ownTouch?: true;
  /** Task 43: never an elite (no elite roll, no elite modifier: the knight's plates are its own law). */
  noElite?: true;
  /**
   * Task 55а «Замок: толчок» (sim/shove.ts): a thing — a colourless body the shove moves (the barrel, the wardrobe): not in the crowd's
   * density, a stop of a shove, the shelter of the rook's strike. Absent — an ordinary kind.
   */
  thing?: true;
  /**
   * Task 57а: true — a newcomer of this kind would pass its cap now: spawn.ts `rollSingle` brings none (the roll goes on to the next
   * kind). `count` — bodies of these kinds on the arena, at markers and in the queue. Absent — no cap (every kind before).
   */
  capped?(world: World, count: (kinds: readonly string[]) => number): boolean;
  /** Body (pushing, touch zone, obstacles) and art (drawing, link reach edge, press circle) as a share of the common size. */
  bodyScale: number;
  artScale: number;
  /** Task 57б: the body and art shares of this enemy now, when its state changes them (the big slime). Absent — `bodyScale`, `artScale`. */
  bodyScaleOf?(enemy: Enemy): number;
  artScaleOf?(enemy: Enemy): number;
  /** Damage of its touch now (the wolf counts its pack). */
  touchDamage(world: World, enemy: Enemy): number;
  /** Share of an overlap it keeps when bodies push apart (the charging boar is heavy). */
  mass(world: World, enemy: Enemy): number;
  /** The personal speed spread applies (the reaper walks at its exact speed). */
  spread: boolean;
  /** A chain may take it (colourless kinds — the reaper — cannot be links). */
  chainable: boolean;
  /** Source of its touch in the hit event (render, stats). */
  hitSource: string;
  /** Stage 2 of the transition: hits from outside the chain (an arrow, a blast) do not hurt it (the reaper). */
  immune?: boolean;
}

const kinds = new Map<string, EnemyKindDef>();
const behaviors = new Map<string, EnemyBehavior>();

export function registerBehavior(behavior: EnemyBehavior): EnemyBehavior {
  const known = behaviors.get(behavior.id);
  if (known && known !== behavior) throw new Error(`enemy behaviour «${behavior.id}» is already registered`);
  behaviors.set(behavior.id, behavior);
  return behavior;
}

export function registerEnemyKind(kind: EnemyKindDef): EnemyKindDef {
  const known = kinds.get(kind.id);
  if (known && known !== kind) throw new Error(`enemy kind «${kind.id}» is already registered`);
  if (!behaviors.has(kind.behavior)) throw new Error(`enemy kind «${kind.id}»: unknown behaviour «${kind.behavior}»`);
  kinds.set(kind.id, kind);
  return kind;
}

export function hasEnemyKind(id: string): boolean { return kinds.has(id); }

export function enemyKind(id: string): EnemyKindDef {
  const kind = kinds.get(id);
  if (!kind) throw new Error(`unknown enemy kind «${id}»`);
  return kind;
}

export function kindOf(enemy: Enemy): EnemyKindDef { return enemyKind(enemy.kind); }

export function behaviorOf(enemy: Enemy): EnemyBehavior { return behaviors.get(kindOf(enemy).behavior)!; }

export function registeredEnemyKinds(): EnemyKindDef[] { return [...kinds.values()]; }

/** Behaviours with a group step (`beforeStep`), in the order they were registered. */
export function groupBehaviors(): EnemyBehavior[] { return [...behaviors.values()].filter(b => b.beforeStep); }

/** Body radius of this enemy: the common body (`bodyRadius × enemyScale`) × its kind's share. */
export function bodyRadiusOf(params: Params, enemy: Enemy): number {
  const kind = kindOf(enemy);
  return enemyBodyRadius(params) * (kind.bodyScaleOf?.(enemy) ?? kind.bodyScale);
}

/** Drawn radius of an enemy of `kind` — the edge the link radius R reaches with «R до края тела» (prototype stage G). */
export function artRadiusOf(params: Params, kind: string): number { return enemyDrawRadius(params) * enemyKind(kind).artScale; }

/**
 * The art scale of this enemy: `eliteArtScale` for an elite and (task 12, design 13.10.2026) for a leader of a goal layout
 * (`Enemy.leader`), else 1. The reach edge and the press circle go through `enemyArtRadius`; the view draws by it too (render.ts).
 */
export function enemyArtScale(params: Params, enemy: Pick<Enemy, 'elite' | 'leader'>): number {
  return enemy.elite || enemy.leader ? params.eliteArtScale : 1;
}

/** Drawn radius of this enemy: its kind's, × `enemyArtScale` for an elite or a leader (stage 2, step 3: the body stays). */
export function enemyArtRadius(params: Params, enemy: Enemy): number {
  const kind = kindOf(enemy);
  return enemyDrawRadius(params) * (kind.artScaleOf?.(enemy) ?? kind.artScale) * enemyArtScale(params, enemy);
}

/** The common walk only: no own step. */
export const CHASE = registerBehavior({ id: 'chase' });
