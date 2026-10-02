import type { DamageEffects, DamageEffectKind } from './damageEffects';
import type { CustomLevelRuntime } from './customLevel';
import type { CellBehaviorComponent, CellFootprintComponent, CellHealthComponent, CellIdentityComponent,
  CellIntentComponent, CellLinkComponent, CellShieldComponent, CellStatusComponent, DamageEffectComponent, CellEliteComponent } from './components';
export type EnemyColor = 0 | 1 | 2 | 3 | 4;
export type TerrainKind = 'floor' | 'tree' | 'pond' | 'campfire' | 'puddle' | 'wall' | 'thorns';
export type CellKind = 'melee' | 'ranged' | 'boss' | 'prism' | 'door';
export type EnemyVariant = 'sentinel' | 'jailer' | 'boar' | 'wolf' | 'porcupine' | 'shaman' | 'troll';
export type ItemKind = 'frost' | 'bomb' | 'healing' | 'fire';
/** Crafting resource (resources.ts): dew, powder, resin, herbs. */
export type ResourceKind = 'dew' | 'powder' | 'resin' | 'herbs';
/** What an elite drops: a consumable, or a resource where no consumable is open (elite.ts). */
export type LootKind = ItemKind | ResourceKind;
export type AbilityKind = 'jump' | 'spin';
export interface RewardOption { item: ItemKind; label: string; description: string }
/** Authored exit of a battle with `completion: 'exit'`: it opens (`breached`) once every goal is met. */
export interface DoorData { label: string; breached: boolean; footprint: number[] }
/** Archer swaps exchange side neighbours only. */
export type RotationGeometry = 'cardinal';
export interface RotationPlan { from: number; to: number; sourceId: number; targetId: number; geometry: RotationGeometry }
export interface RotationPreview extends RotationPlan { active: boolean; reason?: string }
export type Phase = 'TITLE' | 'PLAYER_INPUT' | 'PLAYER_RESOLVE' | 'ENEMY_RESOLVE' | 'BOARD_UPDATE' | 'WIN' | 'LOSE';
/** Entity data assembled from structural components; no registry or render objects. */
export interface ForestCell extends CellIdentityComponent, CellHealthComponent, CellLinkComponent,
  CellStatusComponent, CellBehaviorComponent, CellIntentComponent, CellFootprintComponent, CellShieldComponent, DamageEffectComponent, CellEliteComponent {}
export interface ObjectiveProgress { kills: number; rangedKills: number; bossKills: number; turns: number; armorKills: number; prisms: number; bossHits: number; tutorialTargets?: number }
export interface ObjectiveRequirement { key: keyof ObjectiveProgress; target: number; label: string }
export interface ForestLevel {
  name: string; subtitle: string; description: string; tutorial: string; seed: number; map: string[];
  objectives: ObjectiveRequirement[]; turnLimit: number;
}
export interface InteractionDevice { index: number; kind: 'arrows' | 'fire' | 'pits'; charges: number; targets: number[]; damage?: number }
/** Runtime overlay; authored terrain is retained and restored simply by removing the entry. */
export interface TemporaryPit { index: number; closesAfterTurn: number }
export interface DeviceActivation { index: number; kind: InteractionDevice['kind']; chargesBefore: number; chargesAfter: number }
export interface ForestState {
  phase: Phase; level: ForestLevel; cols: number; rows: number; board: (ForestCell | null)[];
  terrain: TerrainKind[]; devices: InteractionDevice[]; pits: TemporaryPit[]; player: { index: number; hp: number; maxHp: number; energy: number } & DamageEffectComponent; chain: number[];
  chosenAbility: AbilityKind | null;
  inventory: Record<ItemKind, number>; itemPrepared: boolean;
  /** Resources picked up in this battle (elite loot); absent until the first one. The run keeps them. */
  materials?: Record<ResourceKind, number>;
  objective: ObjectiveProgress; turn: number; score: number; message: string; bossWarning: number[]; lastDamage: number;
  rotations: RotationPlan[];
  customLevel?: CustomLevelRuntime;
  /**
   * Authored battle metadata (a map-node battle): marked target IDs, the hint and the tool permissions. Absent in an
   * editor level, where every tool is allowed.
   */
  tutorial?: { targetIds: number[]; hintDismissed: boolean;
    allowedItems: ItemKind[]; allowedAbilities: AbilityKind[] };
  /** Forest-map run battle (src/game/run): tools opened by the run, which replace lesson permissions. */
  runNode?: { nodeId: string; label: string; allowedItems: ItemKind[]; allowedAbilities: AbilityKind[];
    /** Map row of the node (1 = first trunk battle); growing anger applies from RUN_PRESSURE_FIRST_ROW (mapBattleRules.ts). */
    row: number };
}
export interface EngineEvent { type: string; effect?: DamageEffectKind; index?: number; from?: number; to?: number; amount?: number; text?: string; indices?: number[]; oldId?: number; newId?: number; geometry?: RotationGeometry }
export interface ChainHit {
  index: number; damage: number; hpBefore: number; hpAfter: number; killed: boolean; physical: boolean;
  attackEffect?: DamageEffectKind; doorOpened?: boolean;
  /** Porcupine quills that wound the cat at this ordinary chain hit (before HP clamping). */
  spikeDamage?: number;
  /** Score for breaking a crystal at this hit (CRYSTAL_SCORE_PER_KILL × its chain kills). */
  crystalScore?: number;
  /** A consumable or resource dropped by an elite, picked up at this cell (elite.ts). */
  loot?: LootKind;
  /** The exit's chest opened at this cell: the crafting resources it gives (exitRules.ts). */
  chest?: ResourceKind[];
  /** Ordinary chain budget: available includes this enemy's +1; abilities omit these fields. */
  availablePower?: number; powerSpent?: number; remainingPower?: number;
}
/**
 * Sources of cat damage in a forecast, as the engine applies them: porcupine quills, bleeding steps, thorns at the
 * chain end, traps (levers), boar charges, enemy attacks by attacker kind (the troll's club apart from other bosses)
 * and end-of-turn ticks.
 */
export type HeroDamageSource = 'quills' | 'bleeding' | 'thorns' | 'trap' | 'charge' | 'melee' | 'ranged' | 'boss' | 'troll' | 'burning' | 'poison';
export type ChargeDamageCause = 'ram' | 'spikes' | 'thorns' | 'pit';
export interface ChainPreview {
  valid: boolean; length: number; enemies: number; power: number; endIndex: number; damage: number;
  /** `damage` split by source; the values always sum to `damage` exactly. */
  damageBySource: Record<HeroDamageSource, number>;
  /** `charge` split by cause (boar ram, spiked edge, pushed onto thorns, pushed into a pit); sums to `chargeDamage`. */
  chargeBreakdown?: Record<ChargeDamageCause, number>;
  threats: number[]; createsPrism: boolean; reason: string; hits: ChainHit[]; kills: number; endsOnSurvivor: boolean;
  opensDoor?: number; completesRoom?: boolean;
  rotations: RotationPreview[];
  energyCost: number; energyGain: number;
  deviceActivations?: DeviceActivation[]; trapHits?: ChainHit[]; trapDamage?: number; trapKills?: number;
  pitCells?: number[]; pitImmuneCells?: number[];
  movementDamage?: number; effectDamage?: number; playerDies?: boolean; endEffects?: DamageEffects;
  /** Chain ended on thorns (ordinary chains only). */
  thornDamage?: number;
  /** Cat damage during boar charges: ram, spiked edge, thorns, open pit. Included in `damage`. */
  chargeDamage?: number;
  /** Porcupine quills: cat damage from ordinary chain hits on porcupines, applied at each hit. Included in `damage`. */
  spikeDamage?: number;
  /** Positions after the enemy phase that follows this action (absent when the battle ends first). */
  enemyPhase?: EnemyPhaseForecast;
  /**
   * Crystals this chain creates, in every mode (one per CRYSTAL_KILLS chain-hit kills). They fall during the chain, at
   * the 6th, 12th… kill, on cells drawn from a copy of the battle RNG; the forecast gives only the number (a surprise:
   * the cell and the crushed enemy are never exposed), but its damage, deaths and outcome already include them.
   * `createsPrism` mirrors `> 0`.
   */
  crystals?: number;
  /** Score for the crystals this chain breaks (sum of `hits[].crystalScore`). */
  crystalScore?: number;
  /**
   * This action meets the goals of an exit battle without entering the door: the door opens and the chest falls
   * (its cell, like a crystal's, is never shown). Set only when true.
   */
  unlocksExit?: true;
}
export type ForcedDeathCause = 'ram' | 'spikes' | 'thorns' | 'pit' | 'arrow' | 'club';
/** UI data for the enemy phase: the same rules as execution, computed on a copy. */
export interface EnemyPhaseForecast {
  /** Cat cell after every charge; enemy attacks, the volley and swaps use it. */
  heroIndex: number;
  charges: { boarId: number; from: number; to: number; stunned: boolean }[];
  /**
   * Bodies each boar actually rams, in order (the cat has id 0): the first body of its row, once per charge, as the
   * live charge resolves it — none when the boar hits a void, the edge or a device first. `shielded`: a shield facing
   * the boar held the ram (0 damage). `damage` is applied damage (to the cat before HP clamping in a raw forecast).
   */
  rams: { boarId: number; id: number; index: number; damage: number; killed: boolean; shielded: boolean }[];
  /** Net displacement of pushed entities (the charging boar included); the cat has id 0. */
  moves: { id: number; from: number; to: number }[];
  /** Entities that die in the enemy phase from rams, spikes, thorns, pits, archer arrows and the troll's club. */
  deaths: { id: number; index: number; cause: ForcedDeathCause }[];
  /** Pushed entities that skip their action in this phase. */
  knockedDown: number[];
  /** Wolves whose announced attack is cancelled because no living packmate stands next to them any more. */
  packBroken: number[];
  /** Goblins a shaman raises one step in this phase (after attacks): `armed` or `sturdy`. */
  empowered: { shamanId: number; id: number; index: number; tier: 'armed' | 'sturdy' }[];
  /** Trolls that regenerate at the end of this phase (no damage this turn, no burning) and the HP they restore. */
  regenerated: { id: number; index: number; amount: number }[];
  /**
   * The battle is won during this enemy phase: the authored goals (with credited forced deaths and the finished
   * turn) are met at the end of the phase while the cat lives.
   * Enemy deaths from their own burning/poison ticks are not projected. Set only when true.
   */
  completesObjective?: true;
  /** The goals of an exit battle are met during this enemy phase or at the end of the turn: the door opens. Set only when true. */
  unlocksExit?: true;
}
export interface AbilityPreview extends ChainPreview { ability: AbilityKind; cost: number; indices: number[]; targetIndex?: number }
export interface FrostPreview { valid: boolean; reason: string; targetIndex: number; freezes: boolean; skippedCells: number[] }
export interface ItemPreview { valid: boolean; reason: string; indices: number[]; damage: number; healing: number }
