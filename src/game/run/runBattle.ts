/**
 * Contract between the forest-map run model (forestRun.ts) and the battle engine (ForestEngine.startRunBattle).
 * Types only: the pure model does not import the engine, and the engine does not import the model.
 */
import type { DamageEffects } from '../damageEffects';
import type { PaletteWeights } from '../customLevel';
import type { AbilityKind, ItemKind } from '../forestTypes';

/** Cat resources carried between map nodes. */
export interface RunPlayerResources { hp: number; maxHp: number; energy: number; damageEffects?: DamageEffects }

/** Battle template of a node: an authored lesson layout (by index in TUTORIAL_LESSONS) or the forest trial. */
export type RunBattleTemplate = { kind: 'lesson'; index: number } | { kind: 'forest-trial' };

/** Everything needed to (re)create a node battle deterministically. */
export interface RunBattleSetup {
  nodeId: string;
  label: string;
  /** Derived from the run seed and the node id; replaces the template's own seed. */
  seed: number;
  template: RunBattleTemplate;
  player: RunPlayerResources;
  inventory: Record<ItemKind, number>;
  /** Tools opened by the run so far; they replace the lesson's own permissions. */
  allowedItems: ItemKind[];
  allowedAbilities: AbilityKind[];
  /** Refill palette of a lesson template on the map (row palette plus the authored opening colors); absent keeps the template's. */
  paletteWeights?: PaletteWeights;
}

/** Result of a finished node battle, read with ForestEngine.runBattleOutcome(). */
export interface RunBattleOutcome {
  nodeId: string;
  won: boolean;
  player: RunPlayerResources;
  inventory: Record<ItemKind, number>;
}
