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
// Task 54 «Главарь с котелком»: the boss of the camp's branch — his core and his two parts (`Params.bossFrame`, his feast `Params.chiefFeast`).
import './chief';
// Task 59а «Гарнизон, шаг 3»: the recruits (the law of order).
import './recruit';
// Task 59а: the wardens (the pair and the anger).
import './warden';
// Task 59а: the pitcher (the law of pitch, pitch.ts).
import './pitcher';
// Task 55а «Замок: толчок»: the barrel, the wardrobe and the rook.
import './castle';
// Task 55, stage Д «Колдун v0»: the castle's final boss (`Params.bossFrame`, his charm and windows `Params.warlockCharm`).
import './warlock';
// Task 57а «Лес: стрелки»: the slinger, the hive and the wisp («Светляк») — the layer of shots (sim/shots.ts).
import './slinger';
import './hive';
import './wisp';
// Task 57б «Лес: механики»: the rootling (stumps), the slime (merges) and the firebrand (its fire and the braziers).
import './firebrand';
import './rootling';
import './slime';

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
// Task 54: the Chief for the view.
export { CHIEF, CHIEF_LADLE, CHIEF_MOVES, CHIEF_SACK, chiefCore, chiefMove, chiefState, whistleColors, type ChiefMoveId } from './chief';
// Task 59а: the recruits for the view.
export { RECRUIT, recruitCurrent, recruitGroup, recruitNumber, recruitQueue } from './recruit';
export { WARDEN, wardenAnger, wardenAngry, wardenPartner, wardenSwing } from './warden';
export { PITCHER, pitcherWindup } from './pitcher';
// Task 55а: the castle's things and the rook for the view.
export { BARREL, ROOK, WARDROBE, rookLine, wardrobeLying, wardrobeTopple } from './castle';
// Task 57а: the forest shooters for the view.
export { SLINGER, slingerLines } from './slinger';
export { HIVE, hiveSwell } from './hive';
export { WISP, wispState } from './wisp';
// Task 57б: the forest's mechanics for the view.
export { ROOTLING, rootGroup, stumpState, type Stump } from './rootling';
export { SLIME, slimeBig, slimePairs } from './slime';
export { FIREBRAND, brandLit, brandState } from './firebrand';
export * from './kinds';
