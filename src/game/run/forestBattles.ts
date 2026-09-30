/**
 * Registry of authored forest-map node battles (design: docs/biomes/forest-map.md, «Как добавить бой узла»).
 * Battles use the lesson format built by `authoredLesson` (lessonBuilder.ts) with a free string id and live in
 * battles/*.ts by faction. A map node refers to one with `content: { kind: 'battle', battleId }`.
 * Pure data: no engine, no run model.
 */
import { validateCustomLevel } from '../customLevel';
import type { AuthoredLesson } from '../lessonBuilder';
import { BEAST_BATTLES } from './battles/beasts';
import { BOSS_BATTLES } from './battles/bosses';
import { GOBLIN_BATTLES } from './battles/goblins';

/**
 * A node battle: the authored layout, marked targets, passivity (`armed`), devices, pits and `spikedEdges` of a lesson.
 * The run supplies the rest: refill seed, refill palette (map row plus the authored colors), the cat's HP, energy,
 * items and the opened tools. Therefore `allowedItems`, `allowedAbilities`, `initialEnergy`, `nextLessonIndices`
 * and a starting inventory are rejected by `validateNodeBattle`.
 */
export type NodeBattle = AuthoredLesson<string>;

/** Collect battle groups into one registry; a repeated id is an authoring error and fails on load. */
export function buildNodeBattleRegistry(groups: Record<string, readonly NodeBattle[]>): Record<string, NodeBattle> {
  const registry: Record<string, NodeBattle> = Object.create(null);
  const origin = new Map<string, string>();
  for (const [group, battles] of Object.entries(groups)) {
    for (const battle of battles) {
      const previous = origin.get(battle.id);
      if (previous !== undefined) throw new Error(`Повторяющийся id боя узла «${battle.id}»: ${previous} и ${group}.`);
      origin.set(battle.id, group); registry[battle.id] = battle;
    }
  }
  return registry;
}

export const FOREST_NODE_BATTLES: Readonly<Record<string, NodeBattle>> = buildNodeBattleRegistry({
  beasts: BEAST_BATTLES, goblins: GOBLIN_BATTLES, bosses: BOSS_BATTLES,
});

/** Registered battle by id, or undefined (never an inherited object key). */
export function forestBattle(id: string): NodeBattle | undefined {
  return Object.prototype.hasOwnProperty.call(FOREST_NODE_BATTLES, id) ? FOREST_NODE_BATTLES[id] : undefined;
}

/** Authoring checks of one node battle; an empty list means valid. The engine also requires an opening chain. */
export function validateNodeBattle(battle: NodeBattle): string[] {
  const errors: string[] = [], at = `Бой узла «${battle.id}»`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(battle.id)) errors.push(`${at}: id — латиница в нижнем регистре, цифры и дефисы.`);
  const validation = validateCustomLevel(battle.definition);
  if (!validation.valid) errors.push(...validation.errors.map(error => `${at}: ${error}`));
  const enemies = new Set(battle.definition.enemies.map(enemy => enemy.index));
  if (battle.targetIndices.some(index => !enemies.has(index))) errors.push(`${at}: отмеченная цель не стоит на враге.`);
  if (battle.allowedItems || battle.allowedAbilities) errors.push(`${at}: инструменты в бою узла открывает поход, не бой.`);
  if (battle.initialEnergy !== undefined) errors.push(`${at}: энергию в бой узла переносит поход.`);
  if (battle.nextLessonIndices) errors.push(`${at}: переходы задаёт карта (next узла), не бой.`);
  if (Object.values(battle.definition.inventory ?? {}).some(count => (count ?? 0) > 0)) errors.push(`${at}: предметы в бой узла переносит поход.`);
  return errors;
}

/** Checks of every registered battle. */
export function validateForestBattles(): string[] {
  return Object.values(FOREST_NODE_BATTLES).flatMap(validateNodeBattle);
}
