/**
 * Built-in enemy kinds of the prototype (basic, wolf, reaper, boar) registered on import, and the registry API.
 * A new kind: a file that calls `registerBehavior` / `registerEnemyKind`, imported here (or by a test) — no change
 * of world.ts, chain.ts or spawn.ts.
 */
import './basic';
import './boar';

export { BOAR_ART_SCALE, type BoarState } from './boar';
export { packmates } from './basic';
export * from './kinds';
