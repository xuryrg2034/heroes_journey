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
  /**
   * Colour-change crystal (a `prism` cell, mapBattleRules.ts): kills of the ordinary chain that
   * created it. Breaking it with a chain scores CRYSTAL_SCORE_PER_KILL × this value. Absent on authored prisms.
   */
  crystalChain?: number;
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
  /**
   * Shaman step of an ordinary goblin, set only by a rite and independent of anger: an `armed` or `sturdy`
   * goblin is permanently armed (angry again after its rest). Absent: weak, or sturdy when maxHp > 0.
   */
  tier?: 'armed' | 'sturdy';
  /**
   * Troll club (troll.ts): the zone fixed when the windup is announced, kept until the strike. `raised` once the
   * windup phase has passed, so the next enemy phase strikes. Replaced, never mutated in place.
   */
  club?: { cells: number[]; dx: number; dy: number; raised: boolean };
  /** Troll only: damaged this turn (set by the `troll-hurt-mark` damage observer), cleared by the end-of-phase regeneration step. */
  hurtThisTurn?: boolean;
}

export interface CellBehaviorComponent {
  countdown: number;
  behavior: CellBehavior;
}

export interface CellIntent {
  cells: number[];
  damage: number;
  label: string;
  moveTo?: number;
  swapWithId?: number;
  /** Shaman rite announced at the end of a turn: fixed goblin IDs and their cells at the announcement. */
  empowerIds?: number[];
  empowerCells?: number[];
  /** Boar ram announced at the end of a turn: orthogonal direction and maximum cells to advance. */
  charge?: { dx: number; dy: number; length: number };
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
