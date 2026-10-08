/**
 * Built-in enemy kinds of the prototype (basic, wolf, reaper, boar) and of the slice (shield, archer) registered on import, and the registry API.
 * A new kind: a file that calls `registerBehavior` / `registerEnemyKind`, imported here (or by a test) — no change
 * of world.ts, chain.ts or spawn.ts.
 */
import './basic';
import './boar';
// Stage 2 of the transition (docs/realtime-slice.md, section 4): the new enemies of the slice, one module each.
import './shield';
import './archer';

export { BOAR_ART_SCALE, type BoarState } from './boar';
export { packmates } from './basic';
export { inShieldArc, shieldUp } from './shield';
export { archerLine } from './archer';
export * from './kinds';
