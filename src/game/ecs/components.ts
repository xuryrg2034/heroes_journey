/**
 * Component registry (ECS plan, stage 1: docs/ecs-architecture.md §3.2). Storage is «variant A»: an entity record is
 * the flat `ForestCell`, whose fields are grouped into registered components. The registry is the single place that
 * knows how to copy an entity. A new top-level field must be registered here, or `unregisteredFields` reports it;
 * a new nested object inside a registered field (e.g. in `behavior` or `intent`) needs its copier extended here —
 * nothing reports it automatically, `test:ecs-world` walks the whole state graph for shared objects instead.
 */
import type { ForestCell } from '../forestTypes';

type CellField = keyof ForestCell;
export interface ComponentDef {
  readonly name: string;
  /** Record fields that belong to this component. */
  readonly fields: readonly CellField[];
  /** Deep copy of the nested fields; fields not listed here are primitives and copied by the record spread. */
  readonly copy?: Partial<{ [K in CellField]: (value: NonNullable<ForestCell[K]>) => ForestCell[K] }>;
}

const copyArray = <T>(values: readonly T[]): T[] => [...values];

export const Identity: ComponentDef = { name: 'Identity', fields: ['id', 'kind', 'color', 'variant'] };
export const Health: ComponentDef = { name: 'Health', fields: ['hp', 'maxHp', 'armor', 'defeated'] };
export const Status: ComponentDef = { name: 'Status', fields: ['status'], copy: { status: status => ({ ...status }) } };
export const Behavior: ComponentDef = {
  name: 'Behavior', fields: ['behavior', 'countdown'],
  copy: { behavior: behavior => ({ ...behavior, ...(behavior.club ? { club: { ...behavior.club, cells: copyArray(behavior.club.cells) } } : {}) }) },
};
export const Intent: ComponentDef = {
  name: 'Intent', fields: ['intent'],
  copy: { intent: intent => ({ ...intent, cells: copyArray(intent.cells),
    ...(intent.charge ? { charge: { ...intent.charge } } : {}),
    ...(intent.empowerIds ? { empowerIds: copyArray(intent.empowerIds) } : {}),
    ...(intent.empowerCells ? { empowerCells: copyArray(intent.empowerCells) } : {}) }) },
};
export const Footprint: ComponentDef = { name: 'Footprint', fields: ['footprint'], copy: { footprint: copyArray } };
export const Door: ComponentDef = { name: 'Door', fields: ['door'], copy: { door: door => ({ ...door, footprint: copyArray(door.footprint) }) } };
export const Shield: ComponentDef = { name: 'Shield', fields: ['shield'], copy: { shield: shield => ({ ...shield }) } };
export const DamageEffects: ComponentDef = {
  name: 'DamageEffects', fields: ['damageEffects', 'attackEffect'], copy: { damageEffects: effects => ({ ...effects }) },
};
export const Crystal: ComponentDef = { name: 'Crystal', fields: ['crystalChain'] };
export const Loot: ComponentDef = { name: 'Loot', fields: ['loot', 'chest'], copy: { chest: copyArray } };
export const Elite: ComponentDef = { name: 'Elite', fields: ['elite'] };

/** Every component of an entity record, in registration order. */
export const COMPONENTS: readonly ComponentDef[] = [Identity, Health, Status, Behavior, Intent, Footprint, Door, Shield, DamageEffects, Crystal, Loot, Elite];

const OWNER = new Map<string, ComponentDef>(COMPONENTS.flatMap(component => component.fields.map(field => [field as string, component] as const)));
const COPIERS = COMPONENTS.flatMap(component => Object.entries(component.copy ?? {}) as [CellField, (value: unknown) => unknown][]);

/** Independent copy of one entity record: the record spread keeps key order, nested components are copied by the registry. */
export function cloneEntity(cell: ForestCell): ForestCell {
  const copy = { ...cell } as Record<CellField, unknown>;
  for (const [field, copier] of COPIERS) if (copy[field] !== undefined && copy[field] !== null) copy[field] = copier(copy[field]);
  return copy as unknown as ForestCell;
}

/** Fields of a record that no registered component owns (empty for a valid entity). */
export function unregisteredFields(cell: ForestCell): string[] {
  return Object.keys(cell).filter(field => !OWNER.has(field));
}

