/**
 * Registry of enemy definitions (ECS plan, stage 4: docs/ecs-architecture.md §3.3). One entry per enemy: the base
 * kinds (goblin, archer, Chief, prism) and every variant. It replaces the per-variant lists that were spread over the
 * engine, the level validator, the crystal rules and the editor: default HP, allowed shape, colorlessness, tags.
 *
 * Shared immutable data: definitions are never copied with the world. Behaviour stays in the rule modules; the
 * definition only says what an enemy is. Default HP is definition data; the other balance constants (damage, regen,
 * periods) keep living in their mechanic modules. The registry imports only types, so every rule module may use it.
 */
import type { CellKind, EnemyVariant, ForestCell } from './forestTypes';

export type EnemyId = 'goblin' | 'archer' | 'chief' | 'prism' | EnemyVariant;
/**
 * - `Boss`: the room boss kind — colorless, holds a pit hatch and a boar's row, never crushed by a crystal.
 * - `Colorless`: links chains of any color.
 * - `CrystalProtected`: a crystal never lands on it (besides every boss).
 * - `NeverPassive`: authored passivity of trunk rows does not apply.
 * - `Ordinary`: an ordinary goblin (refill, pressure tiers).
 * - `ColorReset`: a chain passing it may continue in another color.
 */
export type EnemyTag = 'Boss' | 'Colorless' | 'CrystalProtected' | 'NeverPassive' | 'Ordinary' | 'ColorReset';
export interface EnemyDefinition {
  readonly id: EnemyId;
  /** Kind stored on the record (`ForestCell.kind`); for a variant the validator requires exactly this kind. */
  readonly kind: Exclude<CellKind, 'door'>;
  /** Variant stored on the record; absent for the base kinds. */
  readonly variant?: EnemyVariant;
  readonly tags: readonly EnemyTag[];
  /**
   * Allowed shape: `any` connected shape (ordinary goblins), `single` cell, or `square2` (one cell or a 2×2 square).
   * `shapeError` is the validator message of a variant that forbids a large shape.
   */
  readonly shape: 'any' | 'single' | 'square2';
  readonly shapeError?: string;
  /** HP the engine gives a freshly baked enemy before the authored HP is applied. */
  readonly hp: number;
  /** Shield facing the enemy starts with. */
  readonly initialShield?: { dx: number; dy: number };
  /**
   * Editor brush: label, the HP it proposes (may differ from `hp`: an editor convenience, GDD §14) and the grid glyph
   * (absent: the color sigil of an ordinary goblin).
   */
  readonly editor: { readonly label: string; readonly hp: number; readonly glyph?: string };
}

const BEAST_SHAPE = 'волк, дикобраз и шаман занимают одну клетку.';
/** In registration order (editor lists follow it). */
export const ENEMY_DEFINITIONS: readonly EnemyDefinition[] = [
  { id: 'goblin', kind: 'melee', tags: ['Ordinary'], shape: 'any', hp: 0, editor: { label: 'Гоблин', hp: 0 } },
  { id: 'archer', kind: 'ranged', tags: [], shape: 'single', hp: 7, editor: { label: 'Лучник', hp: 7, glyph: '⌖' } },
  { id: 'chief', kind: 'boss', tags: ['Boss', 'Colorless'], shape: 'single', hp: 20, editor: { label: 'Главарь', hp: 20, glyph: '♛' } },
  { id: 'prism', kind: 'prism', tags: ['Colorless', 'ColorReset'], shape: 'single', hp: 1, editor: { label: 'Огонёк', hp: 1, glyph: '✦' } },
  { id: 'sentinel', kind: 'melee', variant: 'sentinel', tags: ['CrystalProtected'], shape: 'single', shapeError: 'страж со щитом занимает одну клетку.',
    hp: 7, editor: { label: 'Щитоносец (страж-щит)', hp: 7, glyph: '▣' } },
  { id: 'jailer', kind: 'boss', variant: 'jailer', tags: ['Boss', 'Colorless', 'CrystalProtected', 'NeverPassive'], shape: 'single',
    hp: 8, initialShield: { dx: 0, dy: 1 }, editor: { label: 'Тюремщик', hp: 12, glyph: '⛨' } },
  { id: 'boar', kind: 'melee', variant: 'boar', tags: [], shape: 'single', shapeError: 'кабан занимает одну клетку.', hp: 7, editor: { label: 'Кабан', hp: 3, glyph: '⇶' } },
  { id: 'wolf', kind: 'melee', variant: 'wolf', tags: [], shape: 'single', shapeError: BEAST_SHAPE, hp: 0, editor: { label: 'Волк', hp: 0, glyph: '≽' } },
  { id: 'porcupine', kind: 'melee', variant: 'porcupine', tags: [], shape: 'single', shapeError: BEAST_SHAPE, hp: 2, editor: { label: 'Дикобраз', hp: 2, glyph: '✳' } },
  { id: 'shaman', kind: 'melee', variant: 'shaman', tags: [], shape: 'single', shapeError: BEAST_SHAPE, hp: 2, editor: { label: 'Шаман', hp: 2, glyph: '☥' } },
  { id: 'troll', kind: 'boss', variant: 'troll', tags: ['Boss', 'Colorless', 'CrystalProtected'], shape: 'square2', hp: 24, editor: { label: 'Тролль 2×2', hp: 24, glyph: 'Ⓣ' } },
];

const BY_VARIANT = new Map(ENEMY_DEFINITIONS.flatMap(definition => definition.variant ? [[definition.variant, definition] as const] : []));
const BY_KIND = new Map(ENEMY_DEFINITIONS.flatMap(definition => definition.variant ? [] : [[definition.kind, definition] as const]));

/** Definition of a variant id, if registered. */
export function variantDefinition(variant: string): EnemyDefinition | undefined { return BY_VARIANT.get(variant as EnemyVariant); }
/** Definition of a stored enemy (by variant, else by base kind); none for doors. */
export function definitionOf(cell: Pick<ForestCell, 'kind' | 'variant'> | null | undefined): EnemyDefinition | undefined {
  if (!cell || cell.kind === 'door') return undefined;
  return cell.variant ? BY_VARIANT.get(cell.variant) : BY_KIND.get(cell.kind);
}
export function hasTag(cell: Pick<ForestCell, 'kind' | 'variant'> | null | undefined, tag: EnemyTag): boolean {
  return !!definitionOf(cell)?.tags.includes(tag);
}
/** Registered variant ids, in registration order. */
export const ENEMY_VARIANTS: readonly EnemyVariant[] = ENEMY_DEFINITIONS.flatMap(definition => definition.variant ? [definition.variant] : []);

/**
 * Modifier (ECS plan §3.3): a layer over a definition applied when an enemy is baked. A modifier changes data
 * (health, tags), never adds behaviour. None is registered yet; the elite modifier is the first planned one.
 */
export interface EnemyModifier {
  readonly id: string;
  readonly tags: readonly EnemyTag[];
  apply(cell: ForestCell): void;
}
export const ENEMY_MODIFIERS: readonly EnemyModifier[] = [];
