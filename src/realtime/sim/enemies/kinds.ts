/**
 * Enemy kinds and behaviours of the real-time simulation (stage 1 of the transition, docs/realtime-prototype.md,
 * «Ядро реального времени»). A kind is a description — HP, speed, body and art size, touch damage, mass, whether a
 * chain may take it, and a reference to a behaviour; a behaviour is a module with its own step (a charge, a dash, a
 * cast). New kinds and behaviours are registered (`registerEnemyKind`, `registerBehavior`) — the simulation core
 * (world.ts, chain.ts, spawn.ts) reads them through `kindOf` / `behaviorOf` and is not edited.
 *
 * Speeds, HP and damage are functions of the live params: the debug-panel sliders keep working for the prototype kinds.
 */
import { enemyBodyRadius, enemyDrawRadius, type Params } from '../params';
import type { Enemy, World } from '../world';

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

/** The common walk only: no own step. */
export const CHASE = registerBehavior({ id: 'chase' });
