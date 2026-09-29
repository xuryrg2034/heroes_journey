import type { TerrainKind } from './forestTypes';

/** Terrain a creature may stand on. Thorns are passable ground that hurts only on a push or a chain end. */
export const WALKABLE_TERRAIN: readonly TerrainKind[] = ['floor', 'puddle', 'thorns'];
export const walkableTerrain = (kind: string | undefined): boolean => WALKABLE_TERRAIN.includes(kind as TerrainKind);
/** Balance value: whoever a push drives onto thorns, and a cat ending an ordinary chain there, loses this much HP. */
export const THORN_DAMAGE = 1;
