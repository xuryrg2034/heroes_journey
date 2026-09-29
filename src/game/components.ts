import type { DamageEffects, DamageEffectKind } from './damageEffects';
import type { CellKind, DoorData, EnemyColor, EnemyVariant } from './forestTypes';

/** Structural entity components. The engine stores their fields together in each cell. */
export interface CellIdentityComponent {
  id: number;
  kind: CellKind;
  color: EnemyColor | null;
  variant?: EnemyVariant;
}

export interface CellHealthComponent {
  hp: number;
  maxHp: number;
  armor: number;
  /** Only needed to distinguish a struck natural zero-HP enemy from a living one. */
  defeated?: boolean;
}

export interface CellLinkComponent {
  carriesKey?: boolean;
  supportTargetId?: number;
}

export interface CellStatus {
  wet: boolean;
  frozen: number;
  brittle: boolean;
}

export interface CellStatusComponent {
  status: CellStatus;
}

export interface CellBehavior {
  aggressive: boolean;
  /** Authored noncombatant: never joins automatic aggression. */
  passive?: boolean;
  restTurns: number;
  cycle?: number;
}

export interface CellBehaviorComponent {
  countdown: number;
  bossStage?: 1 | 2;
  behavior: CellBehavior;
}

export interface CellIntent {
  cells: number[];
  damage: number;
  label: string;
  moveTo?: number;
  swapWithId?: number;
  summonCells?: number[];
  /** IDs announced with summonCells; replacement never retargets a new occupant. */
  summonIds?: number[];
}

export interface CellIntentComponent {
  intent: CellIntent;
}

export interface CellFootprintComponent {
  footprint?: number[];
  door?: DoorData;
}

export interface CellShield {
  dx: number;
  dy: number;
}

export interface CellShieldComponent {
  shield?: CellShield;
}

/** Optional persistent damage and the extra effect applied by a successful attack. */
export interface DamageEffectComponent {
  damageEffects?: DamageEffects;
  attackEffect?: DamageEffectKind;
}
