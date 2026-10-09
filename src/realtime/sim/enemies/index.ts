/**
 * Built-in enemy kinds of the prototype (basic, wolf, reaper, boar), of the slice (shield, archer, sapper, porcupine) and of
 * stage 3a (lynx, shaman) registered on import, and the registry API.
 * A new kind: a file that calls `registerBehavior` / `registerEnemyKind`, imported here (or by a test) — no change
 * of world.ts, chain.ts or spawn.ts.
 */
import './basic';
// Stage 3a, step 3: the wolf's ring (П1).
import './wolf';
import './boar';
// Stage 2 of the transition (docs/realtime-slice.md, section 4): the new enemies of the slice, one module each.
import './shield';
import './archer';
import './sapper';
import './porcupine';
// Stage 3a, step 4: the lynx (П2) and the shaman (П4).
import './lynx';
import './shaman';

export { BOAR_ART_SCALE, type BoarState } from './boar';
export { packmates, wolfHowl, wolfRushLine, wolfState, WOLF_RUSH } from './wolf';
export { inShieldArc, shieldUp } from './shield';
export { archerLine } from './archer';
export { sapperFuse } from './sapper';
export { quillsUp, quillsWarning } from './porcupine';
export { LYNX_LEAP, LYNX_STUN, LYNX_WINDUP, lynxLine, lynxStunned } from './lynx';
export { shamanBeam } from './shaman';
export * from './kinds';
