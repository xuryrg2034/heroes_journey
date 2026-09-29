import type { DamageEffects, DamageEffectKind } from './damageEffects';
import type { CustomLevelRuntime } from './customLevel';
import type { CellBehaviorComponent, CellFootprintComponent, CellHealthComponent, CellIdentityComponent,
  CellIntentComponent, CellLinkComponent, CellShieldComponent, CellStatusComponent, DamageEffectComponent } from './components';
export type EnemyColor = 0 | 1 | 2 | 3 | 4;
export type TerrainKind = 'floor' | 'tree' | 'pond' | 'campfire' | 'puddle' | 'wall';
export type CellKind = 'melee' | 'ranged' | 'boss' | 'prism' | 'door';
export type EnemyVariant = 'chair' | 'stool' | 'cabinet' | 'elite' | 'sentinel' | 'wardrobe' | 'rook' | 'bishop' | 'knight' | 'commander' | 'wizard' | 'jailer' | 'beacon';
export type RoomTheme = 'forest' | 'gate' | 'banquet' | 'barracks' | 'chess' | 'library' | 'wizard';
export type ExitDirection = 'left' | 'forward' | 'right';
export type ItemKind = 'frost' | 'bomb' | 'healing' | 'fire';
export type AbilityKind = 'jump' | 'spin';
export interface RewardOption { item: ItemKind; label: string; description: string }
export interface DoorData { branch: ExitDirection; label: string; destination: RoomTheme; magic: boolean; breached: boolean; footprint: number[] }
export type RotationGeometry = 'cardinal' | 'rook' | 'bishop' | 'knight';
export interface RotationPlan { from: number; to: number; sourceId: number; targetId: number; geometry: RotationGeometry }
export interface RotationPreview extends RotationPlan { active: boolean; reason?: string }
export type Phase = 'TITLE' | 'PLAYER_INPUT' | 'PLAYER_RESOLVE' | 'ENEMY_RESOLVE' | 'BOARD_UPDATE' | 'REWARD' | 'WIN' | 'LOSE';
/** Entity data assembled from structural components; no registry or render objects. */
export interface ForestCell extends CellIdentityComponent, CellHealthComponent, CellLinkComponent,
  CellStatusComponent, CellBehaviorComponent, CellIntentComponent, CellFootprintComponent, CellShieldComponent, DamageEffectComponent {}
export type Cell = ForestCell;
export interface ObjectiveProgress { kills: number; rangedKills: number; bossKills: number; turns: number; armorKills: number; prisms: number; bossHits: number; tutorialTargets?: number }
export interface ObjectiveRequirement { key: keyof ObjectiveProgress; target: number; label: string }
export interface ForestLevel {
  name: string; subtitle: string; description: string; tutorial: string; seed: number; map: string[];
  objectives: ObjectiveRequirement[]; turnLimit: number;
}
export type Level = ForestLevel;
export interface InteractionDevice { index: number; kind: 'arrows' | 'fire' | 'pits'; charges: number; targets: number[]; damage?: number }
/** Runtime overlay; authored terrain is retained and restored simply by removing the entry. */
export interface TemporaryPit { index: number; closesAfterTurn: number }
export interface DeviceActivation { index: number; kind: InteractionDevice['kind']; chargesBefore: number; chargesAfter: number }
export interface ForestState {
  phase: Phase; levelIndex: number; level: ForestLevel; cols: number; rows: number; board: (ForestCell | null)[];
  terrain: TerrainKind[]; devices: InteractionDevice[]; pits: TemporaryPit[]; player: { index: number; hp: number; maxHp: number; energy: number } & DamageEffectComponent; chain: number[];
  chosenAbility: AbilityKind | null;
  wave: 1 | 2 | 3; waveLabel: string; inventory: Record<ItemKind, number>; itemPrepared: boolean;
  objective: ObjectiveProgress; turn: number; score: number; message: string; bossWarning: number[]; lastDamage: number;
  spawnCounts: { archers: number; boss: number };
  room: { kind: 'forest' | 'gate' | 'castle' | 'wizard' | 'custom'; theme: RoomTheme; depth: number; combatKills: number;
    key: { held: boolean; droppedAt: number | null }; commanderSpawned: boolean };
  run: { active: boolean; seed: number; path: ExitDirection[]; completedRooms: number };
  hazard: { cells: number[]; turnsUntil: number; damage: number };
  rewards: RewardOption[]; selectedExit: ExitDirection | null;
  rotations: RotationPlan[];
  customLevel?: CustomLevelRuntime;
  tutorial?: { index: number; targetIds: number[]; hintDismissed: boolean;
    allowedItems: ItemKind[]; allowedAbilities: AbilityKind[] };
}
export type GameState = ForestState;
export interface EngineEvent { type: string; effect?: DamageEffectKind; index?: number; from?: number; to?: number; amount?: number; text?: string; indices?: number[]; oldId?: number; newId?: number; geometry?: RotationGeometry }
export type ForestEvent = EngineEvent;
export interface ChainHit {
  index: number; damage: number; hpBefore: number; hpAfter: number; killed: boolean; physical: boolean;
  attackEffect?: DamageEffectKind; doorOpened?: boolean; keyCollected?: boolean; phaseChanged?: boolean;
  /** Ordinary chain budget: available includes this enemy's +1; abilities omit these fields. */
  availablePower?: number; powerSpent?: number; remainingPower?: number;
}
export interface ChainPreview {
  valid: boolean; length: number; enemies: number; power: number; endIndex: number; damage: number;
  threats: number[]; createsPrism: boolean; reason: string; hits: ChainHit[]; kills: number; endsOnSurvivor: boolean;
  keyCollected?: boolean; opensDoor?: number; completesRoom?: boolean; volleyDamage?: number; prismIndex?: number;
  rotations: RotationPreview[];
  energyCost: number; energyGain: number;
  deviceActivations?: DeviceActivation[]; trapHits?: ChainHit[]; trapDamage?: number; trapKills?: number;
  pitCells?: number[]; pitImmuneCells?: number[];
  movementDamage?: number; effectDamage?: number; playerDies?: boolean; endEffects?: DamageEffects;
}
export interface AbilityPreview extends ChainPreview { ability: AbilityKind; cost: number; indices: number[]; targetIndex?: number }
export interface FrostPreview { valid: boolean; reason: string; targetIndex: number; freezes: boolean; skippedCells: number[] }
export interface ItemPreview { valid: boolean; reason: string; indices: number[]; damage: number; healing: number; breachesDoor: boolean }
