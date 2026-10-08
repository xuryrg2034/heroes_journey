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
}

export interface EnemyKindDef {
  id: string;
  /** Behaviour id (`registerBehavior`); `chase` — the common walk to the hero only. */
  behavior: string;
  /** HP of a newcomer of this kind; null — the tough roll of the phase (0, or 1–2 for a tough one). */
  hp(params: Params): number | null;
  /** Walking speed, units per game second, before the personal spread, the braking and the marked slowdown. */
  speed(world: World, enemy: Enemy): number;
  /** Body (pushing, touch zone, obstacles) and art (drawing, link reach edge, press circle) as a share of the common size. */
  bodyScale: number;
  artScale: number;
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

/** Body radius of this enemy: the common body (`bodyRadius × enemyScale`) × its kind's share. */
export function bodyRadiusOf(params: Params, enemy: Enemy): number { return enemyBodyRadius(params) * kindOf(enemy).bodyScale; }

/** Drawn radius of an enemy of `kind` — the edge the link radius R reaches with «R до края тела» (prototype stage G). */
export function artRadiusOf(params: Params, kind: string): number { return enemyDrawRadius(params) * enemyKind(kind).artScale; }

/** Drawn radius of this enemy: its kind's, × `eliteArtScale` for an elite (stage 2, step 3: the body stays). */
export function enemyArtRadius(params: Params, enemy: Enemy): number {
  return artRadiusOf(params, enemy.kind) * (enemy.elite ? params.eliteArtScale : 1);
}

/** The common walk only: no own step. */
export const CHASE = registerBehavior({ id: 'chase' });
