/** Reference-model data only. Property presence differs from a property's value. */
export interface Entity {
  subtype: number; power: number; max_power: number; colour: number;
  properties: Record<number, number>; attack_power: number; attack_mode: number;
}
export type Point = readonly [number, number];
export type BoardQuery<E = Entity> = (col: number, row: number) => E | null;
export const has = (entity: { properties: Record<number, number> }, property: number): boolean =>
  Object.prototype.hasOwnProperty.call(entity.properties, property);
