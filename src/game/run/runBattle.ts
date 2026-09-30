/**
 * Contract between the forest-map run model (forestRun.ts) and the battle engine (ForestEngine.startRunBattle).
 * Types only: the pure model does not import the engine, and the engine does not import the model.
 */
import type { DamageEffects } from '../damageEffects';
import type { PaletteWeights } from '../customLevel';
import type { AbilityKind, ItemKind } from '../forestTypes';

/** Cat resources carried between map nodes. */
export interface RunPlayerResources { hp: number; maxHp: number; energy: number; damageEffects?: DamageEffects }

/**
 * Battle template of a node: an authored node battle by id in FOREST_NODE_BATTLES (src/game/run/forestBattles.ts).
 */
export type RunBattleTemplate = { kind: 'battle'; id: string };

/** Everything needed to (re)create a node battle deterministically. */
export interface RunBattleSetup {
  nodeId: string;
  label: string;
  /** Derived from the run seed and the node id; replaces the template's own seed. */
  seed: number;
  template: RunBattleTemplate;
  /** Map row of the node: from row 5 the battle uses growing anger (src/game/mapBattleRules.ts). */
  row: number;
  player: RunPlayerResources;
  inventory: Record<ItemKind, number>;
  /** Tools opened by the run so far; the battle allows only these. */
  allowedItems: ItemKind[];
  allowedAbilities: AbilityKind[];
  /** Refill palette of an authored template on the map (row palette plus the authored opening colors); absent keeps the template's. */
  paletteWeights?: PaletteWeights;
}

/** Result of a finished node battle, read with ForestEngine.runBattleOutcome(). */
export interface RunBattleOutcome {
  nodeId: string;
  won: boolean;
  player: RunPlayerResources;
  inventory: Record<ItemKind, number>;
}
