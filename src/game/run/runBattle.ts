/**
 * Contract between the forest-map run model (forestRun.ts) and the battle engine (ForestEngine.startRunBattle).
 * Types only: the pure model does not import the engine, and the engine does not import the model.
 */
import type { DamageEffects } from '../damageEffects';
import type { PaletteWeights } from '../customLevel';
import type { ResourceKind, AbilityKind, ItemKind } from '../forestTypes';
import type { BattleModifier, TalismanId } from '../talismans';

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
  /** The run's talismans and oaths (talismans.ts); absent — none. */
  talismans?: TalismanId[];
  /** The Ash ward is still whole (the run holds it and it has not saved the cat yet). */
  wardReady?: boolean;
  /** The run's ladder step (ladder.ts); absent — 0. */
  ladder?: number;
  /** The node is a hard battle (ladder steps 3 and 8). */
  hard?: boolean;
  /** Ladder step 8: the run's stock reached LADDER_GREED_RESOURCES — one more random elite at the start. */
  greedElite?: boolean;
  /** One-battle modifiers set by an event for this battle (talismans.ts). */
  modifiers?: BattleModifier[];
}

/** Result of a finished node battle, read with ForestEngine.runBattleOutcome(). */
export interface RunBattleOutcome {
  nodeId: string;
  won: boolean;
  player: RunPlayerResources;
  inventory: Record<ItemKind, number>;
  /** Resources picked up in this battle (elite loot); the run adds them to its stock. */
  materials?: Record<ResourceKind, number>;
  /** Points of this battle (`state.score`); the run sums them for its result screen. */
  score?: number;
  /** The Ash ward saved the cat in this battle and crumbled (the run drops it). */
  wardUsed?: true;
  /** Cat damage taken in this battle, consumables used, and the exit chest (fell, opened) — for the run's score (runScore.ts). */
  damageTaken?: number;
  itemsUsed?: number;
  chest?: 'dropped' | 'opened';
  /** Battle points of kills and crystals only (no turn or win bonus): the «очки боёв» line of the run's score. */
  chainPoints?: number;
}
