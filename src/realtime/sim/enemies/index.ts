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
// Task 27 «Каркас босса»: the Jailer's core and its weight (sandbox only, `Params.bossFrame`).
import './jailer';
// Task 38 «Гарнизон, шаг 1»: the guard, the dog handler and its hound, the Castellan v0.
import './garrison';
// Task 43 «Гарнизон, шаг 2»: the crossbowman (the law of the crossbow).
import './crossbow';
// Task 48 «Тролль»: the boss of the forest — his core and his three parts (`Params.bossFrame`, his window `Params.trollWindow`).
import './troll';

export { BOAR_ART_SCALE, type BoarState } from './boar';
export { packmates, wolfHowl, wolfRushLine, wolfState, WOLF_RUSH } from './wolf';
export { inShieldArc, shieldUp } from './shield';
export { archerLine, archerMark } from './archer';
export { sapperFuse } from './sapper';
export { quillsUp, quillsWarning } from './porcupine';
export { LYNX_LEAP, LYNX_STUN, LYNX_WINDUP, lynxLine, lynxStunned } from './lynx';
export { shamanBeam } from './shaman';
export { JAILER, JAILER_MOVES, JAILER_WEIGHT, inJailerShield, jailerCore, jailerMove, jailerShieldUp, type JailerMoveId } from './jailer';
export { CASTELLAN, GUARD, HANDLER, HOUND, castellanMove, houndFrenzied } from './garrison';
// Task 43: the knight for the view.
export { KNIGHT, KNIGHT_LANE_WIDTH, knightLane, knightOffensive, knightState, knightSwing } from './garrison';
// Task 48: the Troll for the view.
export { TROLL, TROLL_CLUB, TROLL_MOVES, TROLL_ROCK, TROLL_TAIL, trollCore, trollMove, trollState, type TrollMoveId } from './troll';
export * from './kinds';
