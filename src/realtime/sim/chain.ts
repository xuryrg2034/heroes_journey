/**
 * Chain, focus, the hero's dash and the jump of the real-time prototype (stage 2,
 * docs/realtime-prototype.md, sections 5–6 and design answers 3, 4, 9, 14, 24, 26, 27).
 *
 * Chain power (docs/realtime-prototype.md): it starts at 0, every enemy
 * adds 1 before its hit, HP removed spend it. A weak enemy (0 HP) dies from any hit.
 * When the power is short, the enemy is wounded and survives; the chain cannot pass a
 * survivor, so such a link can only be the last one. The highlight while drawing and
 * the dash use the same `strike`.
 *
 * Stage 3 (design answer 5): a button or the open door is a link of any color within R of the
 * previous link or the hero; it is always the last link. A button is pressed when the chain
 * ends on it; the chain ending on the open door (or a jump landing on it) wins the arena.
 *
 * Iteration 2, stage C (docs/realtime-prototype.md, section 9г, items 4 and 6): a colour-change
 * crystal falls at every 6th, 12th… kill of one chain (as `mapBattleRules.ts` of the main game);
 * chain juice — combo counter, hit-stop, the finisher slow-motion, chain score with a length
 * multiplier, a rising hit tone (render / audio react to the events here).
 *
 * Stage 3a, step 1 (docs/realtime-stage3.md, section 2): a brazier (М4) is a link of any colour anywhere in the chain, as a
 * crystal, but it keeps the colour: the rest of the chain gets +`brazierPower` (the highlight `planChain` and the dash add it
 * alike), the dash puts it out for `brazierCooldown` s. The dash and the jump fly over a cliff (М2) but never end over it;
 * a jump aimed over a cliff does not start (`jumpRefusal`).
 *
 * Stage 1 of the transition: no DOM — the view turns pointer input into journalled commands (simulation.ts) that call
 * `beginChain`, `dragChain`, `dragChainAlong`, `releaseChain`, `cancelChain`, `jump`. The crystal drop point reads the
 * seeded `crystal` stream; `stepHero` takes the real seconds of the tick (`SIM_DT ÷ timeScale`).
 */
import { dcos, dhypot, dsin } from './detMath';
import { behaviorOf, enemyArtRadius, kindOf } from './enemies/kinds';
import { adoptChainColor, chameleonOpen, eliteDeath, pickLoot, platesOf, potionHandFull, stripPlates, trailAt } from './elites';
import { curseKill, takeChest } from './chest';
import { hasTalisman, sealOnlyShield } from './kit';
import { afterLinkPowerOf, anchorsOf, buildActive, chainShieldMinKillsOf, chainShieldOf, colorRuleOf, colorShiftOf, crystalEveryOf, endShadowOf, focusMaxOf, hasHook, honedFired, jumpCostOf, linkGainOf, linkPowerOf, linkRadiusOf, nextChainNo, platesBeforeOf, rank2LinksOf, runHook, secondKey, talismanFired, type ChainAnchor, type ChainEnd, type HonedRelease, type LinkContext } from './build';
import { COUNTER_TALISMANS, FORMS, FUSIONS, HAMMERS } from './buildIds';
// Task 52, Р2: the dwell gesture of «Развилка» (its anchor; the anchors hook reads the same).
import { forkAnchorNow, forkDwellOn, forkSpent } from './forms';
// Task 44 «Сплавы»: the fusions' pure rules (the highlight and the dash read the same ones).
import { blastPlatesOn, boomerangFull, brandOn, brandPaintable, brandReach, endBlastOf, frostWaveCold, fusionEndOn, hunterBlastOn, hunterEnd, iceSealCold, piercePlates } from './fusions';
// Task 46: the end of the dash in the highlight (the bodies of the wave, the end blast and the paint).
import { enemiesInCircle, enemiesNearPath } from './buildHits';
import { finisherHonedKills, finisherTopIds, frostNeighbour, FROST_EDGE_LINKS, honedOn, honeWaveStartOf, SHOCKWAVE_RADIUS } from './talismansRt';
import { returnPowerFor, returnRoute, returnTargets, traceTo } from './returnRun';
import { BOSS_CORES, colorlessCore, endsFight } from './enemies/jailer';
// Task 55а «Замок: толчок» (shove.ts): a thing is the chain's last link; the dash's end shoves it.
import { isThing, shoveOn, shovePath, sliding, startShove, type ShovePlan } from './shove';
import { blockedAt, cliffAt, dist, inThorns, lineOfSight, overCliff, pushOutOfObstacles, type Vec } from './geometry';
import { heroRadius, type Params } from './params';
import { closingEdgeCrosses, enemiesInside, loopMinOf, sealDamage, sealHoldOf, strikeSeal } from './seal';
import { PIERCE_HITSTOP, PIERCE_SOURCE, pierceOn, pierceShape } from './pierce';
// Casino stage 1 («Однорукий гоблин», slot.ts): the lever — the last link, as a button.
import { leverReady, pullLever, slotFeedEnd } from './slot';
import { doorFinaleOn, greedRelease, linkEmbers, planCheque, purseOn, settleCheque, tallyLink, type Cheque } from './purse';
import { oathButton, oathCrystal, oathDashEnd, oathJump, oathLink, oathRelease } from './oath';
import { bagKill } from './bag';
// Task 38 «Гарнизон»: the law of tethers — the plan lists the tethers the dash cuts, the release fixes them, the dash's end cuts them.
import { cutTethers, dashPathPoints, dropShackleOf, planTetherCuts, settleTethers, shackled, tethersOn } from './tethers';
// Task 43: the full Castellan's grate (the refusal) and its levers.
import { behindGrate, gateLever, grateLinkDrop, jumpDownFree, onGallery } from './enemies/garrison';
// Task 48: the Troll's window (the refusal, one hit per window, the drop from the drawn chain).
import { TROLL, trollLinkDrop, trollReserve, trollShut, trollWards, trollWindowOn } from './enemies/troll';
import { WARLOCK, warlockCharmOn, warlockClosed, warlockLinkDrop, warlockReserve, warlockShut, warlockSpellbound, warlockWards } from './enemies/warlock';
// Task 57а «Лес: стрелки»: the dash puts out the light shots it touches (`Params.snuffShots`).
import { snuffAlong, snuffing } from './shots';
import { CHIEF, chiefGuarded, chiefHitOutcome, chiefLinkDrop, chiefQueue, chiefQueueShort, chiefRelease, chiefShut, chiefWards } from './enemies/chief';
import { NO_COLOR, OBJECT_RADIUS, checkGoals, damageEnemy, doorOf, doorOpen, pushOutOfSolids, enemyFrozen, findObject, nextFiring, startShieldWindow, touchDistanceOf, win, type ArenaObject, type ChainLink, type Enemy, type FallenLink, type HeroMove, type LoopKind, type World } from './world';
// Task 56 «Приметы» (omens.ts): the marks of a link taken in water or of the colour on the roll call.
import { callEnergy, fixOmenLinks, omenLink, wetHit } from './omens';

export { OBJECT_RADIUS };
export type { ChainAnchor };
// Phase B: these two moved to build.ts (the build may change them); the view and the tests import them from here as before.
export { colorShiftOf, crystalEveryOf, jumpCostOf };

/** Energy cap, as in the main game. */
export const ENERGY_MAX = 7;
/** Pointer this close to the hero cancels the drawn chain (units). */
export const HERO_CANCEL_RADIUS = 0.42;
/** Jump flight time in real seconds (contact damage is off in flight). */
const JUMP_TIME = 0.18;

export interface StrikeOutcome {
  /** Power before the hit, already +gain (1; phase B: build.ts `linkGainOf`) for this enemy. */
  available: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
  killed: boolean;
  /** Power carried to the next link. */
  powerAfter: number;
  /**
   * Package «Урон имеет значение» (docs/realtime-damage.md): the hit took a plate off an armoured elite (`platesAfter` left)
   * — no HP removed, 1 power spent, not a survivor: the chain goes on. Absent on every other hit.
   */
  plate?: true;
  platesAfter?: number;
  /** Task 55а: the link is a thing (`Params.shove`): no strike, no power — the dash stops at it and shoves it at its end. */
  thing?: true;
}

/** Power a chain hit on a plate spends (4.3, rule 1: as a weak enemy's +1 taken back). */
export const PLATE_POWER = 1;

/**
 * One chain hit on an enemy with `hp`, carrying `power` from the previous links. `factor` multiplies the hit (stage 2,
 * step 3: the cold consumable makes it ×2): as the brittleness of the former turn-based game (docs/realtime-prototype.md), the power spent is
 * the smaller of the power available and the HP really removed — a brittle 5 HP enemy dies from power 3 (hit 6), spends 3.
 * `gain` — what the enemy adds before its hit (1; phase B: «Тяжёлый клинок» 2, build.ts `linkGainOf`). `plates` (the
 * package): an armoured elite with plates left — the hit takes one plate and `PLATE_POWER` power, never HP, whatever the
 * power or the ×2.
 */
export function strike(power: number, hp: number, factor = 1, gain = 1, plates = 0): StrikeOutcome {
  if (plates > 0) {
    const available = power + gain;
    return { available, damage: 0, hpBefore: hp, hpAfter: hp, killed: false, powerAfter: available - Math.min(available, PLATE_POWER), plate: true, platesAfter: plates - 1 };
  }
  const available = power + gain, damage = available * factor;
  const killed = damage >= hp;
  const spent = Math.min(available, Math.min(damage, hp));
  return { available, damage, hpBefore: hp, hpAfter: killed ? 0 : hp - damage, killed, powerAfter: available - spent };
}

/** Task 55а: the outcome of a thing link — nothing struck, the power passes unchanged; the dash stops there (a survivor's way). */
function thingOutcome(power: number): StrikeOutcome {
  return { available: power, damage: 0, hpBefore: 0, hpAfter: 0, killed: false, powerAfter: power, thing: true };
}

/**
 * Task 55а (spec 2.2): the shove's direction — the chain's last segment, from the previous link (its place now) or, for a lone link,
 * from the hero to the thing. «Якорь у героя» gives the reach only: the direction is the previous link's.
 */
function shoveDirection(world: World, links: readonly ChainLink[], index: number, thing: Enemy): Vec {
  const prev = (index > 0 ? linkPoint(world, links[index - 1]) : null) ?? world.hero;
  const dx = thing.x - prev.x, dy = thing.y - prev.y, d = dhypot(dx, dy);
  if (d > 1e-9) return { x: dx / d, y: dy / d };
  const hx = thing.x - world.hero.x, hy = thing.y - world.hero.y, h = dhypot(hx, hy) || 1;
  return { x: hx / h, y: hy / h };
}

/** Stage 2, step 3: the multiplier of a chain hit on `enemy` now — ×`frostFactor` while it is frozen and brittle. */
export function chainFactor(world: World, enemy: Enemy): number {
  return enemy.brittle && enemyFrozen(enemy) ? Math.max(1, world.params.frostFactor) : 1;
}

/**
 * The multiplier of the dash's hit on `enemy` (finding A of the step 3 review): the ×2 is fixed when the chain is released —
 * a link frozen and brittle at the release is struck ×`frostFactor` even if it thawed on the way (the highlight promised
 * it); only the ×2 is fixed, the enemy's mechanic comes back with the thaw as usual.
 */
export function dashFactor(world: World, enemy: Enemy): number {
  return world.move?.brittle?.includes(enemy.id) ? Math.max(1, world.params.frostFactor) : 1;
}

export interface LinkPlan {
  link: ChainLink;
  outcome: StrikeOutcome | null;
  /**
   * Task 27 «Каркас босса»: the link is a part of a boss (`Enemy.partOf`) and this strike kills it — the dash severs it (the same
   * `strike`; the core loses its plate after the dash). Absent otherwise.
   */
  severs?: true;
  /** Task 50: the counters whose rank II acts on this link (build.ts `rank2LinksOf`: «Острие», «Улов», «Охотник», «Длинная рука»). */
  honed?: string[];
}

/**
 * Task 50 «Сноровка»: what the counters' rank II do with the drawn chain — the same functions the dash reads. `far` — the enemy links taken
 * beyond the ordinary R («Длинная рука» II, +1 each); `waves` — the two circles of «Ударная волна» II (round the planned end, round the
 * start) with the bodies each strikes; `shield` — «Добивание» II gives the after-chain shield to this chain (fewer kills than the panel's);
 * `frost` — «Иней на клинке» II: the survivor and the neighbour that freezes with it. The release fixes `far` and `frost`.
 */
export interface HonedPlan {
  far?: number[];
  waves?: { at: Vec; radius: number; ids: number[] }[];
  shield?: true;
  frost?: { survivor: number; near: number };
}

export interface ChainPlan {
  links: LinkPlan[];
  /** The last link survives: nothing may follow it. */
  endsOnSurvivor: boolean;
  /** The last link is a button or the door: nothing may follow it. */
  endsOnObject: boolean;
  /**
   * Task 55а (`Params.shove`): the last link is a thing — the chain is over (`endsOnObject` too: the refusal «цепь закончена»), and
   * `shove` is the shove the dash's end runs when no survivor stops the dash before it (the release fixes it, `HeroMove.shove`).
   */
  endsOnThing?: true;
  shove?: ShovePlan;
  power: number;
  kills: number;
  /**
   * Loop research, step 2: the drawn chain is closed — its ring and who is inside now (the release fixes the same set).
   * Absent while open.
   */
  seal?: SealPreview;
  /**
   * Task 49 «Второй герой» (kit.ts `sealOnlyShield`, sim/heroLaw.ts): the hero's law gives no after-chain shield to this chain when it
   * is released now — the drawn chain is open (no `seal`); a closed one gives the shield by the cat's rule (its kills, the build).
   * Absent — the cat, a closed chain, not the drawn chain.
   */
  noShield?: true;
  /**
   * Casino «Котёл» (purse.ts): the cheque this chain would put into the cauldron — the same embers and heat the dash counts
   * (`HeroMove.purse`). Absent while the cauldron is off.
   */
  cheque?: Cheque;
  /**
   * Loop research, step 3 («Прямая», pierce.ts): the pierce the release would fix now — the axis, the end, the corridor's
   * bodies with the outcome of the chain's power on each. Absent without one (off, a bent tail, the last link survives, P 0,
   * a closed loop, not the drawn chain).
   */
  pierce?: PiercePreview;
  /**
   * Task 29, item 5 (the hammer «Возврат»): the way back after this chain and the hits of the second pass — on the world as the
   * first pass leaves it (its links, the pierce's bodies, the seal's strike; with `Params.returnShadowEnd` also the build modules'
   * end of the dash — «Ударная волна», build.ts `endShadow`), with the run's own functions (returnRun.ts) and
   * `returnStrike`. `hits` empty — the first pass killed everyone near the way (the run is still made). Absent without the
   * hammer, without a way back (the chain ends in the open door, or the hero ends where he started), not the drawn chain.
   */
  back?: ReturnPreview;
  /**
   * Task 28 «Тюремщик в походе» (`Params.bossClears`): this chain kills the boss's core and the fight ends there — the links after
   * the core have no outcome (the dash ends on the core), the crowd is not «убьёт», the pierce is not run, the return run strikes
   * nobody (enemies/jailer.ts `bossClear`). Absent otherwise.
   */
  bossClear?: true;
  /**
   * Task 31 (the hammer «Огненный проход», `Params.fireMinLinks`): will the path of this dash light — see `FirePreview`. Absent
   * without the hammer.
   */
  fire?: FirePreview;
  /**
   * Task 43 «Кастелян полный» (enemies/garrison.ts `grateLinkDrop`): the drawn chain holds the core while its grate is up — the
   * core's link `index` and the seconds `left` before the grate drops; then the core and the links after it leave the chain
   * (event `grate` `unlink`) and this plan is the rest's. A release before it — the dash strikes the core as planned. Absent otherwise.
   */
  grate?: { index: number; left: number };
  /**
   * Task 48 «Тролль» (enemies/troll.ts `trollLinkDrop`): the drawn chain holds the Troll's core while his window is open — the core's
   * link `index` and the seconds `left` before the window ends; then the core and the links after it leave the chain (event
   * `trollWindow` `unlink`) and this plan is the rest's. Absent otherwise.
   */
  trollDrop?: { index: number; left: number };
  /**
   * Task 54 «Главарь с котелком» (enemies/chief.ts `chiefLinkDrop`): the drawn chain holds the Chief's core while his window is open —
   * the core's link `index` and the seconds `left` before the window ends; then the core and the links after it leave the chain
   * (event `chiefFeast` `unlink`) and this plan is the rest's. Absent otherwise.
   */
  chiefDrop?: { index: number; left: number };
  /**
   * Task 55, stage Д «Колдун v0» (enemies/warlock.ts `warlockLinkDrop`): the drawn chain holds the warlock's core while his window is
   * open — the core's link `index` and the seconds `left` before the window ends; then the core and the links after it leave the chain
   * (event `warlockWindow` `unlink`) and this plan is the rest's. Absent otherwise.
   */
  warlockDrop?: { index: number; left: number };
  /**
   * Task 38 «Гарнизон» (`Params.tethers`, tethers.ts): the tethers the dash of this chain cuts — by their held body — read from the
   * bodies where they stand now along the dash's path (the hero, then the links up to the one it stops on). The release fixes the
   * same list (`HeroMove.cuts`). Absent when none.
   */
  cuts?: number[];
  /** Task 46 «Подрыв»: the end blast with its bodies (with the fusion in the kit and a blast at this end). */
  blast?: BlastPreview;
  /** Task 46 «Ледяная волна»: the wave with its bodies and its cold (with the fusion in the kit and a wave at this end). */
  wave?: WavePreview;
  /** Task 50: the counters' rank II on this chain (only with `Kit.honed`; absent when they do nothing). */
  honed?: HonedPlan;
}

/**
 * Task 31: the fire of the planned dash. `links` — the enemy links the dash reaches (the dash's `ChainEnd.links`: struck, a plate
 * taken, the survivor it stops on; not the links after a survivor, crystals, braziers, buttons, the door, loot); `need` — the
 * threshold (`fireMinLinks`; 0 — a journal without the key, the old path: the fire from the release); `lit` — `links ≥ need`:
 * the whole path lights once the dash reaches the `need`-th link (hammers.ts `igniteFire`).
 */
export interface FirePreview {
  lit: boolean; links: number; need: number;
  /** Task 46 «Клеймо»: the colour and the bodies the lit path paints at the end of the dash (with the fusion and `lit` only). */
  paint?: PaintPreview;
}

/** Task 46 «Клеймо»: the chain's colour (the last coloured enemy link the dash reaches) and the bodies along the path it paints. */
export interface PaintPreview { color: number; ids: number[] }
/** Task 46: a body struck at the end of the dash (the wave, the end blast) on the shadow world: killed, its HP after, plates. */
export interface EndHit { id: number; killed: boolean; hpAfter: number; plate?: true; platesBefore?: number; platesAfter?: number }
/**
 * Task 46 «Подрыв»: the end blast of the drawn chain — its centre (the last enemy link reached, where it stands now), radius, hit and
 * plates off an elite, `detonate` (the last link an elite or tough: «Подрыв», not the plain blast) and the bodies with their outcomes.
 */
export interface BlastPreview { at: Vec; radius: number; damage: number; plates: number; detonate: boolean; bodies: EndHit[] }
/** Task 46 «Ледяная волна»: the wave of the drawn chain round its planned end — the bodies with their outcomes and those it freezes. */
export interface WavePreview {
  at: Vec; radius: number; bodies: EndHit[]; ice: { ids: number[]; brittle: boolean };
  /** Task 50, «Ударная волна» II in the fusion: the second wave round the chain's start (its bodies; `ice` holds the survivors of both). */
  second?: { at: Vec; radius: number; bodies: EndHit[] };
}
/** Task 46: what the release fixes for the fusions' end of the dash (build.ts `onRelease`). */
export interface FusionRelease { paint?: PaintPreview; blast?: BlastPreview; wave?: WavePreview }

/**
 * Task 29, item 5: the return run of the drawn chain as it would be released now. `route` — the way back, the point where the
 * dash ends first, then the corners to the chain's start; `power` — the run's power (⌊P ÷ 2⌋, at least 1); `hits` — the bodies
 * it strikes in order, `at` — where along `route` it reaches each (segment index + share), and the outcome of the hit.
 */
export interface ReturnPreview {
  route: Vec[];
  power: number;
  hits: { id: number; at: number; outcome: StrikeOutcome }[];
  kills: number;
  /**
   * With `Params.returnShadowEnd`: the bodies the build modules' end of the dash strikes in the shadow, by module id («Ударная
   * волна»: who stands in its circle around the planned end; an empty list — it goes off and strikes nobody). With
   * `Params.returnWaveFixed` the release fixes them (talismansRt.ts). Absent — no module acts at this end.
   */
  ends?: Record<string, number[]>;
  /** Task 44 «Бумеранг»: the run goes with the full power (the last enemy link dies). Absent — the half. */
  full?: true;
}

/**
 * Loop research, step 3: the pierce of the drawn chain as it would be released now. `power` — P, the chain's power after its
 * last link (not spent by the bodies); each body's outcome is `strike(P, hp, ×2 of the cold, 0, plates)`.
 */
export interface PiercePreview {
  from: Vec; to: Vec; length: number; ux: number; uy: number; power: number;
  bodies: { id: number; t: number; outcome: StrikeOutcome }[];
  kills: number;
  /** Task 44 «Копьё»: plates a hit takes off an elite (`fusionSpearPlates`); absent — 1 (no «Копьё»). The bodies' `platesAfter` count them. */
  plates?: number;
}

/**
 * What `planChain` computes besides the links: `pierce: false` — no pierce, `back: false` — no return run (the rule checks of
 * the drawing, П1's search).
 */
export interface PlanOptions { pierce?: boolean; back?: boolean }
/** The plan of the rule checks: the pierce and the return run never decide whether a link may join (design 12.10.2026, point 12). */
export const NO_PIERCE: Readonly<PlanOptions> = Object.freeze({ pierce: false, back: false });

/** Loop research, step 2: a closed chain's ring now and who is inside it (`sealPreview`). */
export interface SealPreview {
  kind: LoopKind; ring: Vec[]; inside: number[]; links: number; damage: number; hold: number;
  /**
   * Task 44 «Ледяная печать»: the bodies inside the seal's strike leaves alive (the frost sign of the view) — frozen `hold` seconds,
   * brittle (`brittle`, ×`frostFactor` on the next chain hit). Absent without the fusion.
   */
  ice?: { ids: number[]; brittle: boolean };
}

export function findEnemy(world: World, id: number): Enemy | undefined {
  return world.enemies.find(e => e.id === id);
}

/** Position of a link now (enemies keep moving while the chain is drawn; objects stand). */
export function linkPoint(world: World, link: ChainLink): Vec | null {
  if (link.kind === 'enemy') { const e = findEnemy(world, link.id); return e ? { x: e.x, y: e.y } : null; }
  const o = findObject(world, link.id);
  return o ? { x: o.x, y: o.y } : null;
}

/**
 * Power a released chain starts with: 0, or «Точильный камень» (stage 2, step 3) — 1 for the first chain of the arena that
 * has an enemy link. The highlight and the dash start from it.
 */
export function chainStartPower(world: World): number { return world.kit?.firstPower ?? 0; }

/**
 * Highlight of the drawn chain: who dies, who is wounded. Same `strike` as the dash; phase B: the same pure power hooks of
 * the build modules with the same link context (build.ts `linkPowerOf`, `afterLinkPowerOf`) — nothing here changes the world.
 */
export function planChain(world: World, links: readonly ChainLink[] = world.chain, options: Readonly<PlanOptions> = {}): ChainPlan {
  let power = chainStartPower(world), kills = 0, endsOnSurvivor = false;
  const out: LinkPlan[] = [];
  // Phase B: the build layer numbers the enemy links only while a build module acts (otherwise the old plan, exactly).
  const build = buildActive(world), chain = build ? nextChainNo(world) : 0, gain = linkGainOf(world);
  let index = 0, elites = 0, crystals = 0, colorless = 0;
  // Task 50: the counters' rank II (only with `Kit.honed`) — the far links of «Длинная рука» II, the marks of each link.
  const honedKit = build && !!world.kit?.honed, far = honedKit && honedOn(world, COUNTER_TALISMANS.longArm) ? farLinkIds(world, links) : null;
  // Task 29 («Возврат»): the power the dash ends with when it stops on a survivor (the links after it are not struck).
  let stopPower = 0;
  // Casino «Котёл»: the struck enemy links and the crystal links of the plan, for its cheque (only while the cauldron is on).
  const purse = purseOn(world) ? { struck: [] as { enemy: Enemy; outcome: StrikeOutcome }[], crystals: 0 } : null;
  // Task 28: the chain killed the boss's core — the fight ends on it, the links after it are not reached.
  let cleared = false;
  // Task 31: the enemy links the dash reaches (`ChainEnd.links`), up to the survivor it stops on.
  let reached = 0;
  // Task 38: how many links the dash's path runs through (up to its first survivor, or the core that ends the fight); -1 — all.
  let pathEnd = -1, linkIndex = -1;
  // Task 55а: the drawn chain ends on a thing, and the shove the dash's end runs (none when a survivor stops the dash before it).
  let endsOnThing = false, shove: ShovePlan | undefined;
  for (const link of links) {
    linkIndex++;
    if (cleared) { out.push({ link, outcome: null }); continue; }
    const enemy = link.kind === 'enemy' ? findEnemy(world, link.id) : undefined;
    if (!enemy) {
      // Stage 3a (М4): a burning brazier adds its power to the rest of the chain (the dash adds the same on arrival).
      if (isBrazier(world, link)) power += brazierPowerOf(world);
      if (build && isCrystal(world, link)) crystals++;
      if (purse && !endsOnSurvivor && isCrystal(world, link)) purse.crystals++;
      out.push({ link, outcome: null });
      continue;
    }
    // Task 55а (`Params.shove`): a thing — no strike, no power, no build link; the dash stops at it as at a survivor and shoves it
    // along the chain's last segment (from the previous link, or the hero, to the thing; positions now — the release fixes them).
    if (isThing(enemy) && shoveOn(world)) {
      out.push({ link, outcome: thingOutcome(power) });
      endsOnThing = true;
      if (!endsOnSurvivor && !cleared) { stopPower = power; pathEnd = linkIndex + 1; shove = shovePath(world, enemy, shoveDirection(world, links, linkIndex, enemy)); }
      continue;
    }
    const ctx: LinkContext | null = build ? { chain, index: ++index, enemy, id: enemy.id, elite: !!enemy.elite, elitesBefore: elites, power, plan: true, crystalsBefore: crystals, ...colorless ? { colorlessBefore: colorless } : {}, ...far?.has(enemy.id) ? { far: true as const } : {} } : null;
    // Task 50 («Охотник на элит» II): plates the link loses before its hit — the strike takes the rest.
    const pre = honedKit && ctx ? platesBeforeOf(world, ctx, platesOf(enemy)) : 0, marks = honedKit && ctx ? rank2LinksOf(world, ctx) : [];
    let outcome = strike((ctx ? power + linkPowerOf(world, ctx) : power) + wetHit(world, link.kind === 'enemy' && !!link.wet), enemy.hp, chainFactor(world, enemy), gain, platesOf(enemy) - pre);
    // Task 54: the Chief's core — a queue of `chiefFeastBig` links takes two plates (the dash reads the same, `dashStrike`).
    if (enemy.kind === CHIEF) outcome = chiefHitOutcome(world, enemy, outcome, chiefQueue(world, enemy, links, linkIndex));
    power = outcome.powerAfter;
    // The package: a plate pass is the elite's link too — «Охотник на элит» gives the tail its power (4.3, «Связь с силой цепи»).
    if (ctx) { if (outcome.killed || outcome.plate) power += afterLinkPowerOf(world, ctx, outcome); if (enemy.elite) elites++; if (colorlessLink(world, enemy)) colorless++; }
    // Casino «Котёл»: the dash stops on a survivor — links after it (the world changed since they were drawn) are not in the cheque.
    if (!endsOnSurvivor) { reached++; purse?.struck.push({ enemy, outcome }); }
    if (outcome.killed) kills++;
    // The package: a plate hit is no survivor — the chain goes on through the armoured elite.
    else if (!outcome.plate) { if (!endsOnSurvivor) { stopPower = power; pathEnd = linkIndex + 1; } endsOnSurvivor = true; }
    // Task 27: a part this strike kills, with no survivor before it (the dash reaches it), is severed.
    out.push({ link, outcome, ...outcome.killed && !endsOnSurvivor && enemy.partOf !== undefined ? { severs: true as const } : {}, ...marks.length ? { honed: marks } : {} });
    if (outcome.killed && !endsOnSurvivor && endsFight(world, enemy)) { cleared = true; pathEnd = linkIndex + 1; }
  }
  // Task 38: the tethers the dash's path crosses (only while the law acts and a tether stands); one whose end the dash kills goes
  // with that death, not by the cut.
  const reachedLinks = pathEnd < 0 ? links.length : pathEnd;
  const cuts = tethersOn(world) && world.tethers?.length
    ? planTetherCuts(world, dashPathPoints(world.hero, links, reachedLinks, l => linkPoint(world, l)),
      new Set(out.slice(0, reachedLinks).flatMap(l => l.outcome?.killed && l.link.kind === 'enemy' ? [l.link.id] : []))) : [];
  const last = links[links.length - 1];
  const endsOnObject = endsOnThing || (!!last && last.kind === 'object' && !passObject(world, last));
  let seal = links === world.chain && loopClosed(world) ? sealPreview(world, world.chainClosed!) : null;
  // Loop research, step 3: the pierce of the drawn chain only (a closed loop — the seal wins).
  // Task 28: no pierce after a chain that ends the fight (the release's pierce is cancelled when the core dies).
  let pierce = options.pierce !== false && links === world.chain && pierceOn(world) && !loopClosed(world) && !endsOnSurvivor && !cleared && !endsOnThing
    ? planPierce(world, links, out, power) : null;
  // Task 28: the pierce's run kills the core — the bodies after it are dead by then (not struck).
  const pierceEnd = pierce ? pierce.bodies.findIndex(b => b.outcome.killed && endsFight(world, findEnemy(world, b.id)!)) : -1;
  if (pierce && pierceEnd >= 0) {
    const bodies = pierce.bodies.slice(0, pierceEnd + 1);
    pierce = { ...pierce, bodies, kills: bodies.filter(b => b.outcome.killed).length };
  }
  const over = cleared || pierceEnd >= 0;
  // Task 28: the seal strikes at the end of the dash — nobody is left when the fight ended before it.
  if (seal && over) seal = { ...seal, inside: [] };
  // П3 «Финальная цепь»: the dash enters the door — its last link is the open door and no survivor stops it before.
  const end = endsOnObject && !endsOnSurvivor && !cleared && purse && doorFinaleOn(world) ? findObject(world, last.id) : undefined;
  const door = end?.kind === 'door' && doorOpen(world);
  // «Прямая» (design point 9): the pierced bodies' embers go into the cheque as links' do; heat, «Добивание» and П4 unchanged.
  const pierceEmbers = purse && pierce ? pierce.bodies.reduce((sum, b) => sum + linkEmbers(findEnemy(world, b.id)!, b.outcome), 0) : 0;
  const cheque = purse ? planCheque(purse.struck, purse.crystals, seal ? seal.inside.length : null, door, pierceEmbers) : null;
  // Task 29, item 5: the return run of the drawn chain (the hammer «Возврат»).
  // Task 44 «Бумеранг»: the last enemy link the dash reaches dies (a chain ending on a survivor — the old half).
  const lastEnemy = [...out].reverse().find(l => l.link.kind === 'enemy' && l.outcome);
  let back = options.back !== false && links === world.chain && returnOn(world)
    ? planReturn(world, out, endsOnSurvivor ? stopPower : power, pierce, seal, !endsOnSurvivor && !!lastEnemy?.outcome?.killed) : null;
  // Task 28: the return run after a chain that ended the fight strikes nobody; one that kills the core — nobody after it.
  if (back) {
    const at = over ? -1 : back.hits.findIndex(h => h.outcome.killed && endsFight(world, findEnemy(world, h.id)!));
    const hits = over ? [] : at >= 0 ? back.hits.slice(0, at + 1) : back.hits;
    if (hits !== back.hits) back = { ...back, hits, kills: hits.filter(h => h.outcome.killed).length };
  }
  // Task 31: the fire of «Огненный проход» — lit once the dash reaches the threshold.
  const need = fireMinLinks(world.params);
  let fire: FirePreview | null = fireOn(world) ? { lit: reached >= need, links: reached, need } : null;
  // Task 46: the fusions' end of the dash — the wave, the end blast, the paint (not in the rule checks' plans, not after a chain
  // that ends the fight).
  const fused = options.back !== false && links === world.chain && !over && fusionEndOn(world) ? planFusionEnd(world, links, out, pierce, seal, !!fire?.lit) : null;
  if (fire && fused?.paint) fire = { ...fire, paint: fused.paint };
  // Task 43: the core of the drawn chain behind a grate that will drop (the full Castellan only).
  const grate = links === world.chain && !world.move ? grateLinkDrop(world, links) : null;
  // Task 48: the Troll's core of the drawn chain, dropped when his window ends.
  const trollDrop = links === world.chain && !world.move ? trollLinkDrop(world, links) : null;
  // Task 54: the Chief's core of the drawn chain, dropped when his window ends.
  const chiefDrop = links === world.chain && !world.move ? chiefLinkDrop(world, links) : null;
  // Task 55, stage Д: the warlock's core of the drawn chain, dropped when his window ends.
  const warlockDrop = links === world.chain && !world.move ? warlockLinkDrop(world, links) : null;
  // Task 50: the counters' rank II at the end of the dash (the drawn chain only, not after a chain that ends the fight).
  const honed = honedKit ? planHoned(world, out, pierce, seal, far, options.back !== false && links === world.chain && !over) : null;
  // Task 49: the law of Ведунья — the drawn open chain gives no after-chain shield (the dash: heroLaw.ts, `ChainEnd.endForm`).
  const noShield = links === world.chain && !seal && sealOnlyShield(world);
  return { ...grate ? { grate } : {}, ...trollDrop ? { trollDrop } : {}, ...chiefDrop ? { chiefDrop } : {}, ...warlockDrop ? { warlockDrop } : {}, links: out, endsOnSurvivor, endsOnObject, ...endsOnThing ? { endsOnThing: true as const } : {}, ...shove ? { shove } : {}, power, kills, ...seal ? { seal } : {}, ...noShield ? { noShield: true as const } : {}, ...cheque ? { cheque } : {}, ...pierce ? { pierce } : {}, ...back ? { back } : {}, ...over ? { bossClear: true as const } : {}, ...fire ? { fire } : {}, ...cuts.length ? { cuts } : {}, ...fused?.blast ? { blast: fused.blast } : {}, ...fused?.wave ? { wave: fused.wave } : {}, ...honed && Object.keys(honed).length ? { honed } : {} };
}

/**
 * Task 50 («Длинная рука» II): the enemy links of `links` taken beyond the ordinary R — R of the build without the ×1,5 of «Длинная рука»
 * (`linkRadiusOf` of the world with no drawn chain), to the body's edge with «R до края тела»: no anchor of the link is that close — the
 * previous link on the arena (the hero for the first) and, with «Якорь у героя», the hero. Positions now: the plan and the release
 * (the same tick) read the same.
 */
export function farLinkIds(world: World, links: readonly ChainLink[]): Set<number> {
  const out = new Set<number>(), r = linkRadiusOf({ ...world, chain: [] }), hero = { x: world.hero.x, y: world.hero.y }, both = heroAnchorOn(world);
  let prev: Vec = hero;
  for (const link of links) {
    const p = linkPoint(world, link);
    if (!p) continue;
    const enemy = link.kind === 'enemy' ? findEnemy(world, link.id) : undefined;
    if (enemy) {
      const reach = r + (world.params.linkToEdge ? enemyArtRadius(world.params, enemy) : 0);
      if (dist(prev, p) > reach && !(both && dist(hero, p) <= reach)) out.add(enemy.id);
    }
    prev = p;
  }
  return out;
}

/**
 * Task 50: the counters' rank II at the end of the planned dash (`end` — the drawn chain's own plan: the waves, the shield and the
 * neighbour; otherwise only `far`). The end as `planFusionEnd` reads it: the first pass (`planDashEnd`), then the modules' end shadows
 * (the waves round the end and round the start). Pure.
 */
function planHoned(world: World, out: readonly LinkPlan[], pierce: PiercePreview | null, seal: SealPreview | null, far: ReadonlySet<number> | null, end: boolean): HonedPlan {
  const result: HonedPlan = far?.size ? { far: [...far] } : {};
  const wave = honedOn(world, COUNTER_TALISMANS.shockwave), frost = honedOn(world, COUNTER_TALISMANS.frostEdge), finisher = finisherHonedKills(world);
  if (!end || !(wave || frost || finisher !== null)) return result;
  const dash = planDashEnd(world, out, pierce, seal);
  if (!dash) return result;
  const start = { x: world.hero.x, y: world.hero.y }, ended = endShadowOf(world, { links: dash.links, at: dash.end, start }, dash.enemies);
  const struck = ended.struck[COUNTER_TALISMANS.shockwave];
  if (wave && struck) result.waves = [{ at: { ...dash.end }, radius: SHOCKWAVE_RADIUS, ids: [...struck] }, { at: start, radius: honeWaveStartOf(world), ids: [...ended.struck[secondKey(COUNTER_TALISMANS.shockwave)] ?? []] }];
  const last = lastReached(world, out);
  if (finisher !== null && last?.outcome.killed) {
    // The kills of the dash (the links it reaches) and the toughest links of the release (talismansRt.ts `finisherTopIds`).
    let kills = 0;
    for (const { link, outcome } of out) {
      if (link.kind === 'object') { if (findObject(world, link.id) && !passObject(world, link)) break; continue; }
      if (!outcome) continue;
      if (outcome.killed) kills++;
      else if (!outcome.plate) break;
    }
    const base = Math.max(1, world.params.chainShieldMinKills), links = out.map(l => l.link);
    // Task 49: with the law of Ведунья (`sealOnlyShield`) only a closed chain gives the shield (heroLaw.ts reads the dash's seal).
    if (kills >= finisher && kills < base && finisherTopIds(world, links).includes(last.enemy.id) && chainShieldOf(world) > 0 && (!sealOnlyShield(world) || !!seal)) result.shield = true;
  }
  // «Иней на клинке»: a chain of 3+ enemy links reached, its last one alive after the end's shadows (a wave may finish it). Task 48:
  // the Troll's core struck in its window is out of the shadows' lists (one hit a window: they cannot strike it) — alive after them.
  // Task 54: so is the Chief's core (no shadow ever strikes it under the feast's rule).
  // Task 55, stage Д: so is the warlock's core under his rule (one hit a window; charmed — no shadow lands).
  const spared = ((last?.enemy.kind === TROLL && trollWindowOn(world)) || (last?.enemy.kind === WARLOCK && warlockCharmOn(world)) || (!!last && chiefGuarded(world, last.enemy))) && !ended.enemies.some(e => e.id === last!.enemy.id);
  if (frost && last && !last.outcome.killed && dash.links >= FROST_EDGE_LINKS && (spared || ended.enemies.some(e => e.id === last.enemy.id))) {
    const near = frostNeighbour(world, last.enemy, ended.enemies);
    if (near !== null) result.frost = { survivor: last.enemy.id, near };
  }
  return result;
}

/** The last enemy link the dash of the plan `out` reaches (up to the survivor it stops on, or the object that ends it) and its outcome. */
function lastReached(world: World, out: readonly LinkPlan[]): { enemy: Enemy; outcome: StrikeOutcome } | null {
  let last: { enemy: Enemy; outcome: StrikeOutcome } | null = null;
  for (const { link, outcome } of out) {
    if (link.kind === 'object') { if (findObject(world, link.id) && !passObject(world, link)) break; continue; }
    const enemy = findEnemy(world, link.id);
    if (!enemy || !outcome) continue;
    // Task 55а: a thing ends the dash; the last enemy link before it is the end's centre.
    if (outcome.thing) break;
    last = { enemy, outcome };
    if (!outcome.killed && !outcome.plate) break;
  }
  return last;
}

/** The bodies `ids` of `before` struck into `after` (the shadow lists): killed (gone), or their HP and plates after. */
function endHits(before: readonly Enemy[], after: readonly Enemy[], ids: readonly number[]): EndHit[] {
  return ids.flatMap((id): EndHit[] => {
    const b = before.find(e => e.id === id);
    if (!b) return [];
    const a = after.find(e => e.id === id);
    if (!a) return [{ id, killed: true, hpAfter: 0 }];
    return [platesOf(b) > 0 ? { id, killed: false, hpAfter: a.hp, plate: true as const, platesBefore: platesOf(b), platesAfter: platesOf(a) } : { id, killed: false, hpAfter: a.hp }];
  });
}

/**
 * Task 46 (docs/design-notes/task-46-fusions-v2.md, section 8): the fusions' end of the planned dash, in the order of the dash's end —
 * the first pass (`planDashEnd`), then the build modules' end shadows («Ударная волна»; «Ледяная волна» — its bodies and who freezes),
 * then the end blast (with «Подрыв»: its numbers, bodies and outcomes; a plain blast only changes the shadow), then the paint of
 * «Клеймо» (the bodies along the lit path still alive then). The release fixes these lists; the end of the dash plays them. Pure.
 */
function planFusionEnd(world: World, links: readonly ChainLink[], out: readonly LinkPlan[], pierce: PiercePreview | null, seal: SealPreview | null, fireLit: boolean): FusionRelease {
  const dash = planDashEnd(world, out, pierce, seal);
  if (!dash) return {};
  // Task 50: the chain's start — «Ударная волна» II strikes round it too (its second list).
  const result: FusionRelease = {}, ended = endShadowOf(world, { links: dash.links, at: dash.end, start: { x: world.hero.x, y: world.hero.y } }, dash.enemies);
  let shadow = ended.enemies;
  const struck = ended.struck[COUNTER_TALISMANS.shockwave], second = ended.struck[secondKey(COUNTER_TALISMANS.shockwave)], cold = frostWaveCold(world);
  if (cold && struck) {
    const bodies = endHits(dash.enemies, shadow, struck), more = second ? endHits(dash.enemies, shadow, second) : [];
    const ice = [...new Set([...bodies, ...more].filter(b => !b.killed).map(b => b.id))];
    result.wave = { at: { ...dash.end }, radius: SHOCKWAVE_RADIUS, bodies, ice: { ids: ice, brittle: cold.brittle },
      ...second ? { second: { at: { x: world.hero.x, y: world.hero.y }, radius: honeWaveStartOf(world), bodies: more } } : {} };
  }
  // The end blast (hammers.ts): a last enemy link reached, the threshold, no seal or pierce of a higher rank.
  const last = lastReached(world, out), blastOn = world.kit?.hammer === HAMMERS.blast || hasTalisman(world, HAMMERS.blast);
  if (blastOn && last && dash.links >= endBlastMinLinks(world.params) && !(endRankOn(world) && (seal || pierce))) {
    const blast = endBlastOf(world, hunterEnd(world, !!last.enemy.elite, last.outcome.hpBefore), BLAST_RADIUS, BLAST_DAMAGE);
    const at = { x: last.enemy.x, y: last.enemy.y }, targets = new Set(enemiesInCircle({ ...world, enemies: shadow }, at, blast.radius).map(e => e.id));
    const after = shadow.flatMap(e => {
      if (!targets.has(e.id)) return [e];
      const plates = platesOf(e);
      if (plates > 0) return [{ ...e, armor: { ...e.armor!, plates: plates - Math.min(plates, blastPlatesOn(blast, e)) } }];
      return blast.damage >= e.hp ? [] : [{ ...e, hp: e.hp - blast.damage }];
    });
    if (hunterBlastOn(world)) result.blast = { at, radius: blast.radius, damage: blast.damage, plates: blast.plates, detonate: blast.detonate, bodies: endHits(shadow, after, [...targets]) };
    shadow = after;
  }
  // «Клеймо»: the colour of the last coloured enemy link reached (a colourless core does not count); no colour — no paint.
  if (brandOn(world) && fireLit) {
    let color: number | null = null;
    for (const { link, outcome } of out) {
      if (link.kind === 'object') { if (findObject(world, link.id) && !passObject(world, link)) break; continue; }
      const e = findEnemy(world, link.id);
      if (!e || !outcome) continue;
      if (!colorlessLink(world, e) && e.color >= 0) color = e.color;
      if (!outcome.killed && !outcome.plate) break;
    }
    if (color !== null) {
      const own = new Set(links.flatMap(l => (l.kind === 'enemy' ? [l.id] : []))), alive = new Set(shadow.map(e => e.id)), paint = color;
      const ids = enemiesNearPath(world, planDashPath(world, { links: out, pierce }), brandReach(world))
        .filter(e => !own.has(e.id) && alive.has(e.id) && e.color !== paint && brandPaintable(e, kindOf(e).immune ?? false, BOSS_CORES)).map(e => e.id);
      result.paint = { color, ids };
    }
  }
  return result;
}

/**
 * The path the dash of the plan would run (as `advanceMove`; task 46: from frostPass.ts `frostPassPath`): from the hero to every
 * link the plan reaches — the spot of a link it kills or of an object the chain goes on after; the touch point of a survivor or of
 * an elite whose plate it takes (the chain goes on from there); a survivor, or a plate taken on the last link, sends the hero back
 * to the last spot he took; a button, a lever or the door ends it; then the pierce of «Прямая» to its end. Pure.
 */
export function planDashPath(world: World, plan: { links: readonly LinkPlan[]; pierce?: PiercePreview | null }): Vec[] {
  const hero = { x: world.hero.x, y: world.hero.y }, path: Vec[] = [hero];
  let at: Vec = hero, stop: Vec = hero, platedLast = false;
  const go = (p: Vec): void => { at = { x: p.x, y: p.y }; path.push(at); };
  for (const { link, outcome } of plan.links) {
    if (link.kind === 'object') {
      const o = findObject(world, link.id);
      if (!o) continue;
      go(o); stop = at; platedLast = false;
      if (passObject(world, link)) continue;
      return path;
    }
    const e = findEnemy(world, link.id);
    if (!e || !outcome) continue;
    if (outcome.killed) { go(e); stop = at; platedLast = false; continue; }
    const reach = touchDistanceOf(world.params, e), d = dist(at, e);
    if (d > reach + 1e-6) go({ x: e.x + (at.x - e.x) / d * reach, y: e.y + (at.y - e.y) / d * reach });
    if (outcome.plate) { platedLast = true; continue; }
    go(stop);
    return path;
  }
  if (platedLast) go(stop);
  else if (plan.pierce) go(plan.pierce.to);
  return path;
}

// ---- Task 31: the threshold of «Огненный проход» (the fire itself — hammers.ts) ----

/**
 * Task 31 (decision of the user 15.10.2026, playtest 15.10.2026: a path of one link set a crowd on fire — 84–235 fire kills to
 * 4–10 chain kills a fight): the path of the dash lights only when the dash reaches this many enemy links — counted as the end
 * blast's (`ChainEnd.links`: struck, passed fallen, the survivor at the end; crystals, braziers, buttons, the door and loot do
 * not count). Then the whole path from the start of the dash lights at once, and the rest of the dash lays fire as before. The
 * panel key `fireMinLinks` (default 3, a run forces 3). A journal without the key — recorded before it — plays the old path:
 * `FIRE_LEGACY_MIN_LINKS` 0, the fire from the release on any chain (no waiting at all).
 */
export const FIRE_LEGACY_MIN_LINKS = 0;
export function fireMinLinks(params: Params): number { return params.fireMinLinks ?? FIRE_LEGACY_MIN_LINKS; }

/** «Взрыв на конце» (hammers.ts; task 46: here, the highlight reads them too): radius and damage. */
export const BLAST_RADIUS = 1.5;
export const BLAST_DAMAGE = 1;
/**
 * Баланс (decision of the user 11.10.2026, playtest v17: the blast went off on chains of one link — 79 hammer kills to 89
 * chain kills in 4 fights): the end blast needs a chain of at least this many enemy links — reached by the dash: struck,
 * passed fallen (as «Пятое звено»), the survivor at the end; crystals, braziers, buttons, the door and loot do not count.
 * The panel key `endBlastMinLinks` (12.10.2026; default 3, a run forces 3). A journal without the key — recorded before
 * the key — plays the old path: `END_BLAST_LEGACY_MIN_LINKS` 1, the blast on any chain with a last enemy link (a last link
 * means at least one link reached). Task 46: here (the highlight of «Подрыв» reads it), hammers.ts re-exports it.
 */
export const END_BLAST_LEGACY_MIN_LINKS = 1;
export function endBlastMinLinks(params: Params): number { return params.endBlastMinLinks ?? END_BLAST_LEGACY_MIN_LINKS; }

/** The hammer «Огненный проход» acts in this world. */
export const fireOn = (world: World): boolean => world.kit?.hammer === HAMMERS.fire;

// ---- Task 29, item 5: the return run of «Возврат» in the highlight (returnRun.ts; the run — hammers.ts) ----

/** The hammer «Возврат» acts in this world. */
export const returnOn = (world: World): boolean => world.kit?.hammer === HAMMERS.return;

/** `Params.returnFixed` with «Возврат» in the kit: the release fixes the run's way and bodies (absent key — the old path). */
export const returnFixedOn = (world: World): boolean => !!world.params.returnFixed && returnOn(world);

/** A hit of the return run on `e` with `power` (hammers.ts): `strike` without +1 and without the cold's ×2, plates as a chain hit's. */
export function returnStrike(power: number, e: Enemy): StrikeOutcome { return strike(power, e.hp, 1, 0, platesOf(e)); }

/**
 * The fight ends before the return run of the planned dash (pure): the dash enters the open door (`door`) — the arena is won,
 * `onChainEnd` is not called, no run. The only way the fight ends during a dash now: reaching the goals mid-dash opens the door
 * (world.ts `completeGoals`, the stage `greed`) and the fight goes on — the closed door is no link (`objectRefusal`: `closed`),
 * so a chain drawn before the goals cannot end in it.
 */
function fightEndsBeforeRun(_world: World, door: boolean): boolean { return door; }

/**
 * The return run of the plan `out` (pure): the dash's path as the trace the run would record (the hero takes a killed link's
 * spot and an object's; a plate or a survivor is struck from the touch distance; a survivor sends him back to the last spot;
 * the pierce runs on to its end), the way back from where he ends (pushed out of obstacles, as `finishMove`), and the hits on
 * the world after the first pass. Null — no run: the chain ends in the open door, or the way back is empty.
 */
/** The end of the planned dash: its trace, where the hero stands, the enemy links reached and the world after the first pass. */
interface DashEnd { trace: Vec[]; end: Vec; links: number; enemies: Enemy[] }

/**
 * Task 46 (from `planReturn`, task 29): the end of the dash the plan `out` gives (pure) — the trace the run would record, the point
 * where the hero stands after it (pushed out of obstacles, as `finishMove`), the enemy links it reaches (`ChainEnd.links`) and the
 * enemies after the first pass (the links struck, the pierce's bodies, the seal's strike on those inside). Null — the dash ends in
 * the open door (no end). The return run, the wave and the end blast of the highlight start from it.
 */
function planDashEnd(world: World, out: readonly LinkPlan[], pierce: PiercePreview | null, seal: SealPreview | null): DashEnd | null {
  let at: Vec = { x: world.hero.x, y: world.hero.y }, stop = at, door = false;
  const trace: Vec[] = [{ ...at }], struck = new Map<number, StrikeOutcome>();
  for (const { link, outcome } of out) {
    if (link.kind === 'object') {
      const o = findObject(world, link.id);
      if (!o) continue;
      at = stop = { x: o.x, y: o.y };
      traceTo(trace, at);
      if (passObject(world, link)) continue;
      // A button, the lever or the door ends the dash; the open door wins the arena — no end, no run.
      door = o.kind === 'door' && doorOpen(world);
      break;
    }
    const e = findEnemy(world, link.id);
    if (!e || !outcome) continue;
    // The enemy links the dash reaches (`ChainEnd.links`: struck, a plate taken, the survivor it stops on).
    struck.set(e.id, outcome);
    if (outcome.killed) { at = stop = { x: e.x, y: e.y }; traceTo(trace, at); continue; }
    const d = dist(at, e), reach = touchDistanceOf(world.params, e);
    if (d > reach) { at = { x: at.x + (e.x - at.x) / d * (d - reach), y: at.y + (e.y - at.y) / d * (d - reach) }; traceTo(trace, at); }
    if (!outcome.plate) break;
  }
  if (fightEndsBeforeRun(world, door)) return null;
  if (pierce) { at = stop = { x: pierce.to.x, y: pierce.to.y }; traceTo(trace, at); }
  else if (at !== stop) { at = stop; traceTo(trace, at); }
  const end = { x: stop.x, y: stop.y };
  pushOutOfObstacles(end, heroRadius(world.params), world.arena);
  // Task 48: out of a solid body as `finishMove` puts the hero — the bodies this dash kills are gone by then.
  pushOutOfSolids(world, end, new Set([...struck, ...pierce?.bodies.map(b => [b.id, b.outcome] as const) ?? []].flatMap(([id, o]) => (o.killed ? [id] : []))));
  // The world after the first pass: the links struck, the pierce's bodies, the seal's strike on those inside.
  const pierced = new Map((pierce?.bodies ?? []).map(b => [b.id, b.outcome] as const));
  const enemies: Enemy[] = [];
  for (const e of world.enemies) {
    const o = struck.get(e.id) ?? pierced.get(e.id);
    if (o?.killed) continue;
    // Task 48: one hit a window — the Troll's core struck by the first pass (the links, the pierce, the seal) or closed now: no hit.
    if (trollShut(world, e) || (e.kind === TROLL && trollWindowOn(world) && (o || (seal && seal.damage > 0 && seal.inside.includes(e.id))))) continue;
    // Task 54: the Chief's core under the feast's rule — only the chain's hit lands on it: no shadow of the end strikes it.
    if (chiefGuarded(world, e)) continue;
    // Task 55, stage Д: the warlock's core — closed now (charmed, out of his window), or struck by the first pass in his window: no hit.
    if (warlockClosed(world, e) || (e.kind === WARLOCK && warlockCharmOn(world) && (o || (seal && seal.damage > 0 && seal.inside.includes(e.id))))) continue;
    let hp = o ? o.hpAfter : e.hp, plates = o?.plate ? o.platesAfter ?? 0 : platesOf(e);
    if (seal && seal.damage > 0 && seal.inside.includes(e.id)) {
      if (plates > 0) plates--;
      else if (seal.damage >= hp) continue;
      else hp -= seal.damage;
    }
    enemies.push(hp === e.hp && plates === platesOf(e) ? e : { ...e, hp, ...e.armor ? { armor: { ...e.armor, plates } } : {} });
  }
  return { trace, end, links: struck.size, enemies };
}

function planReturn(world: World, out: readonly LinkPlan[], endPower: number, pierce: PiercePreview | null, seal: SealPreview | null, lastKilled = false): ReturnPreview | null {
  const dash = planDashEnd(world, out, pierce, seal);
  if (!dash) return null;
  const { trace, end, enemies } = dash, route = returnRoute(trace, end);
  if (!route.length) return null;
  // `returnShadowEnd`: the build modules' end of the same dash, in the order of `onChainEnd` (a wave kills and wounds before the
  // run). A journal without the key — the old shadow.
  // Task 50: the chain's start for «Ударная волна» II (the second wave of the same end).
  const ended = world.params.returnShadowEnd ? endShadowOf(world, { links: dash.links, at: end, start: { x: world.hero.x, y: world.hero.y } }, enemies) : null;
  const ends = ended && Object.keys(ended.struck).length ? ended.struck : null;
  // Task 48: the end of the dash struck the Troll's core in the shadow — its window's hit is spent before the run.
  // Task 55, stage Д: the warlock's window likewise.
  const endHit = ends && (trollWindowOn(world) || warlockCharmOn(world)) ? new Set(Object.values(ends).flat()) : null;
  const after = (ended ? ended.enemies : enemies).filter(e => !(endHit && (e.kind === TROLL || e.kind === WARLOCK) && endHit.has(e.id)));
  const full = boomerangFull(world, lastKilled), path = [end, ...route], shadow: World = { ...world, enemies: after }, power = returnPowerFor(world, endPower, lastKilled);
  const hits: ReturnPreview['hits'] = [];
  let left = power;
  for (const { e, at: touch } of returnTargets(shadow, path, [])) {
    if (left <= 0) break;
    const outcome = returnStrike(left, e);
    left = outcome.powerAfter;
    hits.push({ id: e.id, at: touch, outcome });
  }
  return { route: path, power, hits, kills: hits.filter(h => h.outcome.killed).length, ...ends ? { ends } : {}, ...full ? { full: true as const } : {} };
}

/**
 * Loop research, step 3 («Прямая»): the pierce the plan `out` of `links` gives (rules 1–5 of the design 12.10.2026): the last
 * link is an enemy the chain kills (a plate taken is no kill), P = the power after it ≥ 1, the tail is straight and the cut
 * leaves some length. Null — no pierce. Pure: the world is only read.
 */
function planPierce(world: World, links: readonly ChainLink[], out: readonly LinkPlan[], power: number): PiercePreview | null {
  const last = out[out.length - 1];
  if (!last || last.link.kind !== 'enemy' || !last.outcome?.killed || power < 1) return null;
  const shape = pierceShape(world, links, l => linkPoint(world, l));
  if (!shape) return null;
  // Task 44 «Копьё»: a hit takes this many plates (the same number `pierceHit` gives `stripPlates`).
  const plates = piercePlates(world);
  const bodies = shape.bodies.flatMap(b => {
    const e = findEnemy(world, b.id);
    // Task 48: the Troll's core closed now — the pierce passes it by.
    // Task 54: the Chief's core under the feast's rule — the pierce passes it by.
    // Task 55, stage Д: the warlock's core closed (charmed, out of his window) — the pierce passes it by.
    if (!e || trollShut(world, e) || chiefGuarded(world, e) || warlockClosed(world, e)) return [];
    const outcome = strike(power, e.hp, chainFactor(world, e), 0, platesOf(e));
    return [{ id: b.id, t: b.t, outcome: outcome.plate && plates > 1 ? { ...outcome, platesAfter: Math.max(0, platesOf(e) - plates) } : outcome }];
  });
  return { from: shape.from, to: shape.to, length: shape.length, ux: shape.ux, uy: shape.uy, power, bodies, kills: bodies.filter(b => b.outcome.killed).length, ...plates > 1 ? { plates } : {} };
}

// ---- Loop research, step 2: the loop («Печать», docs/realtime-loop-research.md, sections 3.1–3.4) ----

/** Enemy links of the drawn chain (n of the seal; crystals, braziers and loot are corners, not counted). */
export function chainEnemyCount(world: World, links: readonly ChainLink[] = world.chain): number {
  return links.filter(l => l.kind === 'enemy' && findEnemy(world, l.id)).length;
}

/** The ring of the drawn chain closed as `kind`: its links' points in order (closed on the hero, he is the first corner). */
export function loopRing(world: World, kind: LoopKind): Vec[] {
  const points = world.chain.flatMap(l => { const p = linkPoint(world, l); return p ? [p] : []; });
  return kind === 'hero' ? [{ x: world.hero.x, y: world.hero.y }, ...points] : points;
}

/**
 * The seal of the drawn chain closed as `kind`, as it would be released now: the ring, who is inside, the hit and the hold.
 * Null — too few enemy links for that closing.
 */
export function sealPreview(world: World, kind: LoopKind): SealPreview | null {
  // A link that died while the chain is drawn changed the ring: no seal (the loop opens on the next tick, `syncLoop`).
  if (world.chain.some(l => !linkPoint(world, l))) return null;
  const links = chainEnemyCount(world);
  if (links < loopMinOf(world.params, kind)) return null;
  // Task 48: the Troll's core closed now is no body inside (the seal does not strike it).
  const ring = loopRing(world, kind), inside = enemiesInside(world, ring, world.chain).filter(e => !trollShut(world, e) && !chiefGuarded(world, e) && !warlockClosed(world, e)), damage = sealDamage(links), hold = sealHoldOf(world.params, links);
  // Task 44 «Ледяная печать»: the survivors of the strike (a plated body loses a plate, not HP) freeze max(hold, 3 s), brittle.
  const cold = iceSealCold(world, hold);
  const ice = cold ? { ids: inside.filter(e => platesOf(e) > 0 || e.hp > damage).map(e => e.id), brittle: cold.brittle } : null;
  return { kind, ring, inside: inside.map(e => e.id), links, damage, hold: cold ? cold.time : hold, ...ice ? { ice } : {} };
}

/**
 * The closing the pointer at `p` asks for (a `full` drag point): on the hero (`loopHeroCloses`, enough enemy links), or on
 * the first link (enough enemy links, and the first is not the second-to-last — with 3 links that is the step back). Null —
 * no closing there.
 */
export function loopKindAt(world: World, p: Vec): LoopKind | null {
  const params = world.params;
  if (!loopOn(world) || !world.chain.length || world.move) return null;
  const n = chainEnemyCount(world), first = world.chain[0];
  // The same nearest pick as the drag (links of the chain and new candidates): a new link next to the first one is taken
  // as a link, not read as the closing (review 11.10.2026).
  const plan = planChain(world, world.chain, NO_PIERCE);
  const under = pick(world, p,
    e => inChain(world, e) >= 0 || canLink(world, e, plan),
    o => linkIndex(world, { kind: 'object', id: o.id }) >= 0 || canLinkObject(world, o, plan));
  if (under) return under.kind === first.kind && under.id === first.id && world.chain.length - 2 !== 0 && n >= loopMinOf(params, 'first') ? 'first' : null;
  if (params.loopHeroCloses && dist(p, world.hero) <= HERO_CANCEL_RADIUS && n >= loopMinOf(params, 'hero')) return 'hero';
  return null;
}

/**
 * Why the drawn chain cannot close as `kind`: the closing edge is checked as a link — `far` (beyond R + the edge), `sight`
 * (no line of sight); `crossed` — it crosses an edge of the ring; `afterObject` — the chain ends on a button or the door;
 * `inChain`-like `move` while a dash runs. Null — it can.
 */
export function loopRefusal(world: World, kind: LoopKind): Refusal | null {
  if (world.status !== 'playing' || world.move) return 'move';
  if (planChain(world, world.chain, NO_PIERCE).endsOnObject) return 'afterObject';
  const first = world.chain[0], last = world.chain[world.chain.length - 1];
  const from = linkPoint(world, last);
  if (!from) return 'far';
  // On the first link: from the last link to the first, R reaching the first's edge; on the hero: the hero's reach of the
  // last link, as for a first link (the same rule both ways).
  const [anchor, target, link] = kind === 'first' ? [from, linkPoint(world, first), first] : [{ x: world.hero.x, y: world.hero.y }, from, last];
  if (!target) return 'far';
  const p = world.params, edge = link.kind === 'enemy' ? enemyArtRadius(p, findEnemy(world, link.id)!) : OBJECT_RADIUS;
  if (dist(anchor, target) > linkRadiusOf(world) + (p.linkToEdge ? edge : 0)) return 'far';
  if (p.lineOfSight && !lineOfSight(anchor, target, world.arena, -p.sightSlack)) return 'sight';
  if (closingEdgeCrosses(loopRing(world, kind))) return 'crossed';
  return null;
}

/** The closings the drawn chain could make now (the view's «замкни» ring and dashed line): kinds with no refusal. */
export function loopCandidates(world: World): LoopKind[] {
  const p = world.params;
  if (!loopOn(world) || world.chainClosed || !world.chain.length || world.move) return [];
  const n = chainEnemyCount(world), out: LoopKind[] = [];
  if (world.chain.length >= 3 && n >= loopMinOf(p, 'first') && !loopRefusal(world, 'first')) out.push('first');
  if (p.loopHeroCloses && n >= loopMinOf(p, 'hero') && !loopRefusal(world, 'hero')) out.push('hero');
  return out;
}

/**
 * The loop gesture of a `full` drag point; true — the point was the loop's (nothing else happens). A closed chain: the
 * pointer on its last link opens it; anything else does nothing (nothing may join). An open one: the pointer on the first
 * link or the hero closes it, or is refused with a reason.
 */
function loopGesture(world: World, p: Vec): boolean {
  const last = world.chain[world.chain.length - 1];
  if (world.chainClosed) {
    const kind = world.chainClosed;
    // The nearest link of the chain under the pointer must be the last one: with the first and the last close together the
    // pointer between them does not flip the loop on every event.
    const under = pick(world, p, e => inChain(world, e) >= 0, o => linkIndex(world, { kind: 'object', id: o.id }) >= 0);
    if (under && under.kind === last.kind && under.id === last.id) { delete world.chainClosed; world.events.push({ type: 'loop', action: 'open', kind }); }
    return true;
  }
  const kind = loopKindAt(world, p);
  if (!kind) return false;
  const refusal = loopRefusal(world, kind);
  if (refusal) world.events.push({ type: 'loop', action: 'refused', kind, refusal });
  else { world.chainClosed = kind; world.events.push({ type: 'loop', action: 'close', kind }); }
  return true;
}

/** The drawn chain is closed and the loop is on (a `param` command may turn it off while closed). */
export function loopClosed(world: World): boolean { return !!world.chainClosed && loopOn(world); }

/**
 * Task 29: the loop («Печать») is on — the sandbox toggle `loopEnabled` or «Печать» as a form in the kit — and «Развилка» is
 * not (with any link an anchor, «the first link closes» is ambiguous: no loop, design 15.10.2026). Every rule of the loop reads
 * this one function; a kit without the forms — the old path.
 */
export function loopOn(world: World): boolean {
  return (world.params.loopEnabled || hasTalisman(world, FORMS.seal)) && !hasTalisman(world, FORMS.fork);
}

/**
 * Task 29, the rank of the field «Конец» (buildIds.ts `END_RANK`): it decides between the forms and the end blast only while the
 * kit holds «Печать» or «Прямая» as a form (the sandbox toggles alone keep the old path: both act).
 */
export function endRankOn(world: World): boolean { return hasTalisman(world, FORMS.seal) || hasTalisman(world, FORMS.pierce); }

/**
 * Keeps a closed chain true to the closing rules every tick (review 11.10.2026): it opens when the loop is off, the chain
 * emptied or lost a link (`drawn` — its length before dead links dropped), or the closing edge no longer holds as a link
 * (the hero walked away from a ring closed on him, a wall came between, the edge crosses the ring). Event `open` with the reason.
 */
function syncLoop(world: World, drawn: number): void {
  const kind = world.chainClosed;
  if (!kind) return;
  let reason: Refusal | 'off' | 'changed' | null = null;
  if (!loopOn(world)) reason = 'off';
  else if (!world.chain.length || world.chain.length !== drawn) reason = 'changed';
  else reason = loopRefusal(world, kind);
  if (!reason) return;
  delete world.chainClosed;
  if (world.chain.length) world.events.push({ type: 'loop', action: 'open', kind, refusal: reason });
}

/** A crystal link (stage C): any color, anywhere in the chain; the chain goes on after it. */
export function isCrystal(world: World, link: ChainLink): boolean {
  return link.kind === 'object' && findObject(world, link.id)?.kind === 'crystal';
}

/**
 * A link the chain goes on after: a crystal (it changes the colour), the loot of an elite (stage 2, step 3: picked up as
 * a crystal, any colour, anywhere in the chain; it does not change the colour, gives no power, is not a kill), a brazier
 * (stage 3a, М4: any colour, keeps the colour, +`brazierPower` to the rest, not a kill) or the cursed chest (К7, chest.ts:
 * taken as the loot).
 */
export function passObject(world: World, link: ChainLink): boolean {
  if (link.kind !== 'object') return false;
  const kind = findObject(world, link.id)?.kind;
  return kind === 'crystal' || kind === 'loot' || kind === 'brazier' || kind === 'chest';
}

/** Stage 3a (М4): a burning brazier link (one put out is not a link: `objectRefusal` says `unlit`). */
export function isBrazier(world: World, link: ChainLink): boolean {
  if (link.kind !== 'object') return false;
  const o = findObject(world, link.id);
  return o?.kind === 'brazier' && o.out === undefined;
}

/** Power a brazier gives the rest of the chain (the panel's `brazierPower`). */
export const brazierPowerOf = (world: World): number => Math.max(0, world.params.brazierPower);

/**
 * The colour segments of `links` (design 12.10.2026, «Смена цвета»): `color` — the colour of the last segment (null — none
 * yet: no enemy since the start or the last crystal), `count` — its enemy links, `shifts` — the ids of the links that freed
 * the colour (the `every`-th link of each segment; empty while the rule is off).
 *
 * A segment starts at the first enemy link, after a crystal (it resets the colour and the count) and, with `every` > 0, at
 * the first enemy link after `every` links of the segment (that link may be of any colour; it sets the new one). Every enemy
 * link counts, whatever its outcome (an elite's plate hit too); objects that keep the colour (loot, a brazier, the chest)
 * do not count and do not reset; nor does a colourless link (task 32, `colorlessLink`: the Jailer's core). A link of another colour inside a segment (a link before it died while the chain was
 * drawn: the chain is counted again from the links left) just counts.
 *
 * «Свобода цвета держится» (`colorShiftKeep`, design 13.10.2026): after `every` links only a link of another colour opens a
 * new segment; a link of the segment's colour continues it (the count grows past `every`, the colour stays free) and the
 * shifts fall on every multiple of `every` within the segment (6, 12, 18…) — for a one-colour chain the links of the old
 * path. Without the key the free link opens a new segment whatever its colour (the old path).
 */
function colorSegments(world: World, links: readonly ChainLink[], every: number): { color: number | null; count: number; shifts: number[]; foreign: number[]; need: number | null } {
  let color: number | null = null, count = 0;
  // Task 33 «Близнецы» (`ChainColorRule.alternate`): the segment's first colour, the pair's other colour once taken, the last link's.
  let first: number | null = null, second: number | null = null, last: number | null = null;
  const shifts: number[] = [], foreign: number[] = [], keep = !!world.params.colorShiftKeep;
  // Task 29, field «Звено»: the one colour rule (`colorRuleOf`): «Близнецы» — a pair counts as one colour; «Чужак» — links of
  // another colour the chain may take (the first such links of the chain, whatever the segment; the colour stays).
  const rule = colorRuleOf(world), key = rule?.key, foreignMax = rule?.foreign ?? 0, alternate = !!rule?.alternate?.(world);
  const same = (a: number, b: number): boolean => (key ? key(a) === key(b) : a === b);
  for (const link of links) {
    if (isCrystal(world, link)) { color = null; count = 0; first = second = last = null; continue; }
    if (link.kind !== 'enemy') continue;
    const e = findEnemy(world, link.id);
    if (!e || colorlessLink(world, e)) continue;
    if (color === null || (every > 0 && count >= every && !(keep && same(e.color, color)))) { color = e.color; count = 0; first = e.color; second = null; }
    else if (foreign.length < foreignMax && !same(e.color, color)) foreign.push(e.id);
    else if (alternate && second === null && e.color !== first && same(e.color, color)) second = e.color;
    last = e.color;
    count++;
    if (every > 0 && (keep ? count % every === 0 : count === every)) shifts.push(e.id);
  }
  // The colour the next link must be: the pair's other one than the last link's, once the chain took both (task 33).
  const need = alternate && second !== null && first !== null && last !== null ? (last === first ? second : first) : null;
  return { color, count, shifts, foreign, need };
}

/**
 * Task 33 «Близнецы» with `Params.twinsAlternate`: the exact colour the next enemy link of the drawn chain must be (the pair's
 * other colour than the last link's) once the chain took both colours of the pair; null — any colour of the pair (or the rule
 * is off). The refusal (`colorJoin`), the chameleon's colour and the view's next-colour ring read it.
 */
export function twinsNextColor(world: World, links: readonly ChainLink[] = world.chain): number | null {
  return colorRuleOf(world)?.alternate?.(world) ? colorSegments(world, links, colorShiftOf(world)).need : null;
}

/**
 * Color of the drawn chain: the first enemy link after the last crystal (a crystal changes the color:
 * the next enemy sets the new one). Null — any color (no enemy yet, or a crystal is the last link). «Смена цвета»
 * (`colorShiftOf` > 0): also null once the last colour segment has that many enemy links — the next enemy link may be of
 * any colour (with `colorShiftKeep` it stays null while the segment goes on in its colour). `canLink`, the refusals, the
 * highlight and П1 (linkDepth.ts) read this one function.
 */
export function chainColor(world: World): number | null {
  const every = colorShiftOf(world), { color, count } = colorSegments(world, world.chain, every);
  return every > 0 && count >= every ? null : color;
}

/**
 * «Смена цвета»: enemy links the drawn chain's colour segment still needs before the colour is free (0 — free now: the last
 * enemy link freed it; with `colorShiftKeep` it stays 0 while the segment goes on in its colour). Null — the rule is off or
 * no colour is set yet (no enemy link since the start or the last crystal). The view's «до смены N» and the rainbow ring
 * read it.
 */
export function colorShiftLeft(world: World): number | null {
  const every = colorShiftOf(world);
  if (every <= 0) return null;
  const { color, count } = colorSegments(world, world.chain, every);
  return color === null ? null : Math.max(0, every - count);
}

/**
 * «Смена цвета»: the ids of the enemy links of `links` that free the colour (the last link of each full colour segment; with
 * `colorShiftKeep` every `every`-th link of a segment), in order. The view's rainbow ring stands on the last of them. Empty while the rule is off. The release fixes them for the dash (`HeroMove.shifts`).
 */
export function colorShiftIds(world: World, links: readonly ChainLink[] = world.chain): number[] {
  const every = colorShiftOf(world);
  return every > 0 ? colorSegments(world, links, every).shifts : [];
}

/**
 * Task 29, field «Звено»: the two colours count as one for the chain — the colour rule's key («Близнецы»: the pair; without a
 * rule — equal). The view reads it to light the pair.
 */
export function sameColor(world: World, a: number, b: number): boolean {
  const key = colorRuleOf(world)?.key;
  return key ? key(a) === key(b) : a === b;
}

/**
 * Task 29 «Близнецы»: the colour pairs of this arena's palette (indices; a single colour of a row of 2–3 colours is a group of
 * one) — null without the rule. The view's two-coloured chain line.
 */
export function colorGroups(world: World): number[][] | null {
  const key = colorRuleOf(world)?.key;
  if (!key) return null;
  const groups = new Map<number, number[]>();
  for (let c = 0; c < paletteSize(world); c++) { const k = key(c); groups.set(k, [...groups.get(k) ?? [], c]); }
  return [...groups.values()];
}

/** Colours of the arena's palette (the kit's row colours, else the panel's `colorCount`). */
function paletteSize(world: World): number { return world.kit?.colors ?? world.params.colorCount; }

/**
 * Task 29 «Чужак»: links of another colour the drawn chain may still take (0 — spent this chain); null — no such rule. The
 * view's «не потрачен».
 */
export function foreignLeft(world: World, links: readonly ChainLink[] = world.chain): number | null {
  const max = colorRuleOf(world)?.foreign ?? 0;
  if (max <= 0) return null;
  return Math.max(0, max - colorSegments(world, links, colorShiftOf(world)).foreign.length);
}

/** Task 29 «Чужак»: the links of `links` taken as links of another colour (empty without the rule). */
export function foreignLinkIds(world: World, links: readonly ChainLink[] = world.chain): number[] {
  return (colorRuleOf(world)?.foreign ?? 0) > 0 ? colorSegments(world, links, colorShiftOf(world)).foreign : [];
}

/**
 * How `enemy` may join the drawn chain by colour (task 29: the one rule of colour for the refusal, the drawing and the view):
 * `chain` — its colour is the chain's (or none is set; «Близнецы»: the pair), `chameleon` — «Хамелеон» in its window (it takes
 * the chain's colour), `foreign` — «Чужак» not spent this chain; null — refused, «не тот цвет».
 */
export type ColorJoin = 'chain' | 'chameleon' | 'foreign';
export function colorJoin(world: World, enemy: Enemy, color: number | null = chainColor(world)): ColorJoin | null {
  if (colorlessLink(world, enemy)) return 'chain';
  // Task 33: «Близнецы» alternate — only the pair's next colour (a chameleon in its window takes it).
  const need = twinsNextColor(world);
  if (need !== null) return enemy.color === need ? 'chain' : chameleonOpen(world, enemy) ? 'chameleon' : null;
  if (color === null || sameColor(world, enemy.color, color)) return 'chain';
  if (chameleonOpen(world, enemy)) return 'chameleon';
  return (foreignLeft(world) ?? 0) > 0 ? 'foreign' : null;
}

/**
 * Task 32 (`Params.jailerColorless`, design 15.10.2026): `enemy` is a colourless link — a chain of any colour takes it, anywhere (the
 * first link too); it does not set, change or count the chain's colour (`colorSegments`: the next coloured enemy sets it), and is
 * neither «Чужак» nor a colour of «Близнецы». The Jailer's core with the frame on. The refusal, the highlight, П1 and the view
 * read it through `colorJoin`, `chainColor`; the view draws such a body without a team colour.
 */
export function colorlessLink(world: World, enemy: Pick<Enemy, 'kind'>): boolean { return colorlessCore(world, enemy) || (isThing(enemy) && shoveOn(world)); }

/**
 * Task 34 (`Params.shiftAtPointer`, user 15.10.2026): the colour of the drawn chain's last segment while «Смена цвета» holds it
 * free (`chainColor` null by length, not by a crystal or an empty chain) — the sweep points and the held pointer take only this
 * colour then (`dragChain`). Null — the key is off, the rule is off or the colour is not free.
 */
export function pointerShiftColor(world: World): number | null {
  if (!world.params.shiftAtPointer) return null;
  const every = colorShiftOf(world);
  if (every <= 0) return null;
  const { color, count } = colorSegments(world, world.chain, every);
  return color !== null && count >= every ? color : null;
}

/** Score of a finished chain with `kills` kills: per kill × K × (1 + bonus × K), or flat per kill with the toggle off. */
export function chainScore(params: World['params'], kills: number): number {
  if (kills <= 0) return 0;
  const k = params.chainScoreMultiplier ? 1 + params.scoreLengthBonus * kills : 1;
  return Math.round(params.scorePerKill * kills * k);
}

/** Where the next link is measured from: the last link, or the hero. */
export function chainAnchor(world: World): Vec {
  for (let i = world.chain.length - 1; i >= 0; i--) {
    const p = linkPoint(world, world.chain[i]);
    if (p) return p;
  }
  return { x: world.hero.x, y: world.hero.y };
}

/**
 * Stage G (user 07.10.2026): every point the next link may be taken from. The first link — the hero; then the last
 * link, and with «Якорь у героя» also the hero (second anchor). The dash still runs along the links in order.
 */
export function chainAnchors(world: World): ChainAnchor[] {
  const hero = { x: world.hero.x, y: world.hero.y };
  if (!world.chain.length) return [hero];
  const last = lastAnchor(world);
  // Task 29, field «Звено» («Развилка»): the build's `anchors` hook — every link of the chain (and the hero with «Якорь»).
  return [...anchorsOf(world, heroAnchorOn(world) ? [last, hero] : [last], () => world.chain.flatMap(link => {
    const p = linkPoint(world, link);
    return p ? [{ x: p.x, y: p.y, link }] : [];
  }))];
}

/**
 * Task 33 «Развилка» (`Params.forkBranches` > 0): `target` as the next link of the drawn chain — marked `fork` when the plain
 * anchors (the last link, the hero with «Якорь») do not reach it, so the chain took it from an older link: the latest link of
 * the chain that reaches it (`anchorRefusal`, the order of `chainAnchors`), noted in `fork`. The drawing
 * (`dragChain`) and П1 (linkDepth.ts) append through it; without the limit the link as it is.
 */
export function nextLink(world: World, target: ChainLink): ChainLink {
  const plain: ChainLink = { kind: target.kind, id: target.id } as ChainLink;
  // Task 52, Р2: the dwell chose the anchor — the link is taken from it (the only anchor then, forms.ts).
  const chosen = world.chain.length ? forkAnchorNow(world) : null;
  if (chosen) return { ...plain, fork: { kind: chosen.kind, id: chosen.id } };
  if (!((world.params.forkBranches ?? 0) > 0) || !world.chain.length) return plain;
  const point = linkPoint(world, plain), enemy = plain.kind === 'enemy' ? findEnemy(world, plain.id) : undefined;
  if (!point) return plain;
  const reach = reachOf(world, enemy ? enemyArtRadius(world.params, enemy) : OBJECT_RADIUS);
  const anchors = heroAnchorOn(world) ? [lastAnchor(world), { x: world.hero.x, y: world.hero.y }] : [lastAnchor(world)];
  if (anchors.some(anchor => !anchorRefusal(world, anchor, point, reach))) return plain;
  const from = chainAnchors(world).filter(a => a.link && !anchorRefusal(world, a, point, reach)).at(-1)?.link;
  return from ? { ...plain, fork: { kind: from.kind, id: from.id } } : plain;
}

/** Task 33 «Развилка»: the older link the link `index` of the drawn chain was taken from (its `fork`, fixed when taken); null — not a fork. */
export function forkAnchorOf(world: World, index: number): ChainLink | null {
  const fork = world.chain[index]?.fork;
  return fork ? { kind: fork.kind, id: fork.id } as ChainLink : null;
}

/** The last link still on the arena as an anchor (with its link), or the hero (none). */
function lastAnchor(world: World): ChainAnchor {
  for (let i = world.chain.length - 1; i >= 0; i--) {
    const link = world.chain[i], p = linkPoint(world, link);
    if (p) return { x: p.x, y: p.y, link };
  }
  return { x: world.hero.x, y: world.hero.y };
}

/** The hero is a second anchor: the panel toggle (the sandbox) or the talisman «Якорь у героя» (stage 2, step 3). */
export function heroAnchorOn(world: World): boolean { return world.params.heroAnchor || hasTalisman(world, 'hero-anchor'); }

export function inChain(world: World, enemy: Enemy): number {
  return world.chain.findIndex(l => l.kind === 'enemy' && l.id === enemy.id);
}

/**
 * Why a target cannot be the next link (stage G): the checks of `canLink` / `canLinkObject` in their order, and the
 * text the pointer hint shows. One function decides both, so the hint never disagrees with the chain.
 */
export type Refusal = 'move' | 'colorless' | 'inChain' | 'afterSurvivor' | 'afterObject' | 'pressed' | 'closed' | 'unlit' | 'color' | 'far' | 'sight' | 'guarded' | 'crossed' | 'sealed' | 'lever' | 'shackled' | 'handFull' | 'grate' | 'outOfWindow' | 'sliding' | 'queue' | 'spellbound';
export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  move: 'идёт проход',
  colorless: 'не берётся цепью',
  inChain: 'уже в цепи',
  afterSurvivor: 'после выжившего',
  afterObject: 'цепь закончена',
  pressed: 'кнопка нажата',
  closed: 'дверь закрыта',
  // Stage 3a (М4): a brazier the dash put out burns again after its cooldown.
  unlit: 'жаровня погасла',
  color: 'не тот цвет',
  far: 'далеко',
  sight: 'нет видимости',
  // Stage 2 of the transition: the behaviour refuses the anchor (`canBeLinkedFrom` — the shieldbearer's shield faces it).
  guarded: 'щит',
  // Loop research, step 2: the closing edge crosses the ring; the chain is closed — nothing may join.
  crossed: 'нить пересеклась',
  sealed: 'петля замкнута',
  // Casino stage 1: the goblin's lever during its marker, its cooldown and after the last pull (dark).
  lever: 'рычаг не готов',
  // Task 40 «Ключник»: a prisoner in the keymaster's shackles (tethers.ts `shackled`) — no chain takes it until they are cut.
  shackled: 'в кандалах',
  // Task 41 «Три зелья» (`Params.potionCap`): a healing loot while the hand is full.
  handFull: 'рука полна',
  // Task 43 «Кастелян полный»: the core behind the grate (enemies/garrison.ts `behindGrate`) — a lever's chain raises it.
  grate: 'за решёткой',
  // Task 48 «Тролль»: the Troll's core outside his window (enemies/troll.ts `trollShut`) — his own moves open it.
  outOfWindow: 'вне окна',
  // Task 55а: a thing sliding after a shove, or the one it is about to strike («катится» is the die's word, task 55 §18).
  sliding: 'в движении',
  // Task 54 «Главарь с котелком»: the Chief's core in his window, the queue of the brew's colour before it short (enemies/chief.ts).
  queue: 'в очередь',
  // Task 55, stage Д: the warlock's core while his wardrobe stands (enemies/warlock.ts; `ward` is «Пепельный оберег»'s, task 55 §18).
  spellbound: 'под чарами',
};

/**
 * How far from an anchor a target with drawn radius `edge` may stand to be the next link: R, to its edge with «R до края
 * тела». Phase B: R of the build (build.ts `linkRadiusOf`: «Широкий круг», «Длинная рука»); without a build module —
 * `linkRadius`. П1 (sim/linkDepth.ts) uses it to skip far bodies before `canLink`.
 */
export function reachOf(world: World, edge: number): number {
  return linkRadiusOf(world) + (world.params.linkToEdge ? edge : 0);
}

/**
 * Within R of an anchor and in sight from that same anchor (toggle): the reach rule shared by enemies and objects.
 * With «R до края тела» R reaches the edge of the target (`edge` — its drawn radius), not its center. With «Якорь у
 * героя» any of the two anchors will do. Sight: a thin ray; obstacles shrink by `sightSlack` so a ray grazing a trunk
 * or a wall corner still sees. Null — reachable; `far` — no anchor is close enough; `sight` — close, but blocked.
 */
function reachRefusal(world: World, target: Vec, edge: number): Refusal | null {
  const reach = reachOf(world, edge);
  let near = false;
  for (const anchor of chainAnchors(world)) {
    const refusal = anchorRefusal(world, anchor, target, reach);
    if (!refusal) return null;
    if (refusal === 'sight') near = true;
  }
  return near ? 'sight' : 'far';
}

/** One anchor's say on `target` at `reach`: null — within reach and in sight; `far`; `sight`. */
function anchorRefusal(world: World, anchor: Vec, target: Vec, reach: number): 'far' | 'sight' | null {
  if (dist(anchor, target) > reach) return 'far';
  const p = world.params;
  return !p.lineOfSight || lineOfSight(anchor, target, world.arena, -p.sightSlack) ? null : 'sight';
}

/**
 * Task 29 «Развилка» (the view's rings at each link): the anchors `target` (drawn radius `edge`) is within reach and sight of —
 * the links (`link`) and the hero (no `link`) it may join from, in the order of `chainAnchors`. The refusal reads the same rule.
 */
export function reachingAnchors(world: World, target: Vec, edge: number): ChainAnchor[] {
  const reach = reachOf(world, edge);
  return chainAnchors(world).filter(anchor => !anchorRefusal(world, anchor, target, reach));
}

/** `reachingAnchors` of an enemy (its drawn radius). */
export function enemyAnchors(world: World, enemy: Enemy): ChainAnchor[] { return reachingAnchors(world, enemy, enemyArtRadius(world.params, enemy)); }

/**
 * Why `enemy` cannot be the next link: same color, within R of an anchor (the hero for the first link — so a chain
 * started by dragging from an empty spot also starts only within R of the hero, design answer 36), in sight (toggle),
 * not taken, not after a survivor or an object. Null — it can.
 */
export function enemyRefusal(world: World, enemy: Enemy, plan: ChainPlan = planChain(world, world.chain, NO_PIERCE)): Refusal | null {
  if (world.status !== 'playing' || world.move) return 'move';
  if (enemy.color === NO_COLOR || !kindOf(enemy).chainable) return 'colorless';
  // Task 55а: a thing is a link only with the law of the shove; one sliding (or about to be struck by one) is no link now.
  if (isThing(enemy) && !shoveOn(world)) return 'colorless';
  if (world.shoves && sliding(world, enemy.id)) return 'sliding';
  // Task 40: the keymaster's prisoner (only while a shackle holds it: nothing in worlds without one).
  if (world.tethers && shackled(world, enemy)) return 'shackled';
  // Task 43: the full Castellan's core behind its grate.
  if (behindGrate(world, enemy)) return 'grate';
  // Task 48: the Troll's core outside his window (or its hit spent).
  if (trollShut(world, enemy)) return 'outOfWindow';
  // Task 54: the Chief's core outside his window (or its hit spent).
  if (chiefShut(world, enemy)) return 'outOfWindow';
  // Task 55, stage Д: the warlock's core charmed, or out of his window (or its hit spent) once the charm is gone.
  if (warlockSpellbound(world, enemy)) return 'spellbound';
  if (warlockShut(world, enemy)) return 'outOfWindow';
  if (inChain(world, enemy) >= 0) return 'inChain';
  if (loopClosed(world)) return 'sealed';
  if (plan.endsOnSurvivor) return 'afterSurvivor';
  if (plan.endsOnObject) return 'afterObject';
  // Phase A, T4: «Хамелеон» in its window is taken by a chain of any colour (it takes the chain's colour, `adoptChainColor`);
  // task 29: the colour rule of the forms («Близнецы», «Чужак») — `colorJoin`.
  if (!colorJoin(world, enemy)) return 'color';
  // Task 54: the Chief's core in his window — the queue of the brew's colour before it.
  if (chiefQueueShort(world, enemy)) return 'queue';
  const reach = reachRefusal(world, enemy, enemyArtRadius(world.params, enemy));
  if (reach) return reach;
  // Stage 2 of the transition (design answer 08.10.2026): the kind's say about the direction of the strike — always from
  // the previous link (the hero for the first one); «Якорь у героя» widens the reach only, it does not get round a shield.
  const guard = behaviorOf(enemy).canBeLinkedFrom;
  return guard && !guard(world, enemy, chainAnchor(world)) ? 'guarded' : null;
}

export function canLink(world: World, enemy: Enemy, plan: ChainPlan = planChain(world, world.chain, NO_PIERCE)): boolean {
  return enemyRefusal(world, enemy, plan) === null;
}

/**
 * Why the object cannot be the next link: an unpressed button or the open door (then the last link), or a crystal not
 * yet in the chain (stage C: the chain goes on after it); any color, within R (to the edge of its circle) and in sight.
 */
export function objectRefusal(world: World, object: ArenaObject, plan: ChainPlan = planChain(world, world.chain, NO_PIERCE)): Refusal | null {
  if (world.status !== 'playing' || world.move) return 'move';
  if (linkIndex(world, { kind: 'object', id: object.id }) >= 0) return 'inChain';
  if (loopClosed(world)) return 'sealed';
  if (plan.endsOnSurvivor) return 'afterSurvivor';
  if (plan.endsOnObject) return 'afterObject';
  if (object.kind === 'button' && object.pressed) return 'pressed';
  if (object.kind === 'door' && !doorOpen(world)) return 'closed';
  if (object.kind === 'brazier' && object.out !== undefined) return 'unlit';
  // Casino stage 1 («Однорукий гоблин»): the lever is a target only while it is ready (slot.ts `leverReady`).
  if (object.kind === 'lever' && !leverReady(world, object)) return 'lever';
  // Task 41 «Три зелья»: a healing loot while the hand (with the healing loot already in the chain) is full — the dash would not pick it up.
  if (object.kind === 'loot' && object.loot === 'healing' && potionHandFull(world, world.chain.filter(l => l.kind === 'object' && findObject(world, l.id)?.loot === 'healing').length)) return 'handFull';
  return reachRefusal(world, object, OBJECT_RADIUS);
}

export function canLinkObject(world: World, object: ArenaObject, plan: ChainPlan = planChain(world, world.chain, NO_PIERCE)): boolean {
  return objectRefusal(world, object, plan) === null;
}

/** Valid next links right now (render: outline). */
export function nextCandidates(world: World): Enemy[] {
  const plan = planChain(world, world.chain, NO_PIERCE);
  return world.enemies.filter(e => canLink(world, e, plan));
}

export function nextObjectCandidates(world: World): ArenaObject[] {
  const plan = planChain(world, world.chain, NO_PIERCE);
  return world.objects.filter(o => canLinkObject(world, o, plan));
}

/** Pick radius: the drawn circle with a slack in the player's favour (design answer 27); the boar is drawn larger. */
function pickRadius(world: World, e: Enemy): number { return enemyArtRadius(world.params, e) * world.params.pickSlack; }

/** The link under the pointer — an enemy or an object — among those that pass the checks, nearest to the pointer. */
function pick(world: World, p: Vec, acceptEnemy: (e: Enemy) => boolean, acceptObject: (o: ArenaObject) => boolean): ChainLink | null {
  // Buttons, the door and crystals keep their press circle of before (× 1.3): only the enemy one grew back to 0.59.
  const ro = OBJECT_RADIUS * 1.3;
  let best: ChainLink | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    const d = dist(e, p);
    if (d <= pickRadius(world, e) && d < bestD && acceptEnemy(e)) { best = { kind: 'enemy', id: e.id }; bestD = d; }
  }
  for (const o of world.objects) {
    const d = dist(o, p);
    if (d <= ro && d < bestD && acceptObject(o)) { best = { kind: 'object', id: o.id }; bestD = d; }
  }
  return best;
}

const linkIndex = (world: World, link: ChainLink): number => world.chain.findIndex(l => l.kind === link.kind && l.id === link.id);

/**
 * Stage E (user 07.10.2026): a new link of the chain — an enemy or a crystal — refreshes focus (to the full reserve, or
 * +focusPerLink). Once per link per chain: truncating and adding the same enemy again gives nothing; a button or the
 * door (the end of the chain) gives nothing. The set resets when a new chain begins.
 */
function refreshFocus(world: World, link: ChainLink): void {
  const p = world.params;
  if (!p.linkRefreshesFocus) return;
  if (link.kind === 'object' && !passObject(world, link)) return;
  const key = `${link.kind}:${link.id}`;
  if (world.focusRefreshed.has(key)) return;
  world.focusRefreshed.add(key);
  const max = focusMaxOf(world);
  world.focus = p.focusPerLink > 0 ? Math.min(max, world.focus + p.focusPerLink) : max;
  world.events.push({ type: 'focusRefill' });
}

/** Press: start a chain on an enemy or an object within R of the hero. Returns true when a chain started. */
export function beginChain(world: World, p: Vec): boolean {
  if (world.status !== 'playing' || world.move) return false;
  world.chain = [];
  delete world.chainClosed;
  delete world.forkAnchor;
  const plan = planChain(world, world.chain, NO_PIERCE);
  const target = pick(world, p, e => canLink(world, e, plan), o => canLinkObject(world, o, plan));
  if (!target) return false;
  // Task 56: «Половодье» and «Перекличка» mark the link as it is taken (omens.ts `omenLink`; nothing without them).
  world.chain = [omenLink(world, target, target.kind === 'enemy' ? findEnemy(world, target.id) : undefined)];
  // A chain always starts with the full reserve: its first link refreshes focus too.
  world.focusRefreshed = new Set();
  refreshFocus(world, target);
  return true;
}

/** What a drag point may do: `full` — the pointer event itself (append, truncate, cancel on the hero); `sweep` — a point
 * between two pointer events (append only: a quick swipe through the crowd must not cut the chain by accident — design
 * 07.10.2026; the cut and the cancel happen only where the pointer stopped in the frame); `append` —
 * the held still pointer re-checked every frame (only a new link joins: a link drifting under it does not truncate). */
export type DragMode = 'full' | 'sweep' | 'append';

/** Drag: append a valid link, truncate on a selected one, cancel on the hero. */
export function dragChain(world: World, p: Vec, mode: DragMode = 'full'): void {
  if (world.status !== 'playing' || world.move) return;
  // Task 52, Р2: the pointer event left the link it rested on — its dwell done, it stays the anchor (`ready`); not done — no anchor.
  if (mode === 'full' && world.forkAnchor) leaveForkAnchor(world, p);
  // Loop research, step 2: the loop gesture comes first (only the pointer event itself, never a sweep or the held pointer).
  if (mode === 'full' && loopOn(world) && world.chain.length && loopGesture(world, p)) return;
  // Stage H (user 08.10.2026): the hero is link zero of the step back — with one link the pointer on the hero takes it off
  // (the chain is cancelled); with two or more it does nothing. Its own toggle «отмена наведением на героя» (off) cancels
  // any chain there; the right button and Esc always cancel.
  if (mode === 'full' && world.chain.length && dist(p, world.hero) <= HERO_CANCEL_RADIUS) {
    if (world.params.cancelOnHero || (world.params.chainStepBack && world.chain.length === 1)) { world.chain = []; delete world.chainClosed; }
    return;
  }
  // Task 42: with `holdHeroLink` the hero is a link for every drag point — in its circle the held pointer and the sweep points do
  // nothing, and the pointer event on an empty chain takes nothing (the cancel above stays).
  if (heroHeld(world, p, mode)) return;
  const plan = planChain(world, world.chain, NO_PIERCE), target = pickAt(world, p, mode, plan);
  if (mode !== 'full' && pointerShiftColor(world) !== null) {
    // Task 34 telemetry: the body the path without `shiftAtPointer` would have taken here (the nearest one `canLink` allows).
    const seeLinks = seesLinks(world, mode);
    const old = pick(world, p, e => (seeLinks && inChain(world, e) >= 0) || canLink(world, e, plan), o => (seeLinks && linkIndex(world, { kind: 'object', id: o.id }) >= 0) || canLinkObject(world, o, plan));
    if (old?.kind === 'enemy' && linkIndex(world, old) < 0 && (target?.kind !== 'enemy' || target.id !== old.id)) world.events.push({ type: 'shiftSkip', enemyId: old.id, links: world.chain.length });
  }
  if (!target) return;
  const index = linkIndex(world, target);
  // Task 39: the held pointer nearest to a link of the chain does nothing (it never truncates).
  if (index >= 0 && mode !== 'full') return;
  // Task 52, Р2: the pointer event on an older link (not the last, not the one before it) starts its dwell (`forkAnchorNow`).
  if (index >= 0 && index <= world.chain.length - 3 && forkDwellOn(world) && hasTalisman(world, FORMS.fork) && !forkSpent(world)) {
    if (!world.forkAnchor || world.forkAnchor.kind !== target.kind || world.forkAnchor.id !== target.id) world.forkAnchor = { kind: target.kind, id: target.id, since: world.time };
    return;
  }
  if (index >= 0) {
    // Stage H: one step back only — the second-to-last link takes the last one off; an older link does nothing (after a
    // crystal the pointer often crosses old links). A link taken off and taken again does not refresh focus (stage E).
    if (!world.params.chainStepBack) world.chain.length = index + 1;
    else if (index === world.chain.length - 2) world.chain.length = index + 1;
    if (world.chainClosed && world.chain.length <= index + 1) delete world.chainClosed;
    return;
  }
  // A chain begun by dragging from an empty spot is a new chain: its links refresh focus anew (as `beginChain`).
  if (!world.chain.length) world.focusRefreshed = new Set();
  const color = chainColor(world), need = twinsNextColor(world);
  const joined = target.kind === 'enemy' ? findEnemy(world, target.id) : undefined, join = joined ? colorJoin(world, joined, color) : null;
  world.chain.push(omenLink(world, nextLink(world, target), joined));
  // Task 52, Р2: the fork is taken — the anchor is the last link again.
  delete world.forkAnchor;
  // Phase A, T4: a chameleon taken in its window by a chain of another colour takes the chain's colour (task 33: the pair's next).
  if (joined && join === 'chameleon') adoptChainColor(world, joined, need ?? color);
  refreshFocus(world, target);
}

/**
 * Task 52, Р2: the pointer event at `p` is not on the link the dwell rests on — done (`forkAnchorNow` held it long enough): it stays
 * the anchor until a link joins; not done, or no longer an older link — no anchor.
 */
function leaveForkAnchor(world: World, p: Vec): void {
  const fa = world.forkAnchor!;
  const on = pick(world, p, e => fa.kind === 'enemy' && e.id === fa.id, o => fa.kind === 'object' && o.id === fa.id);
  if (on) return;
  if (!fa.ready && forkAnchorNow(world)) fa.ready = true;
  else if (!fa.ready || !forkAnchorNow(world)) delete world.forkAnchor;
}

/** Task 39 (`Params.holdNearest`): the held still pointer (`append`) sees the chain's links too — the pointer event always does. */
const seesLinks = (world: World, mode: DragMode): boolean => mode === 'full' || (mode === 'append' && !!world.params.holdNearest);

/**
 * Task 42 (`Params.holdHeroLink`, design 16.10.2026): a drag point in the hero's circle (`HERO_CANCEL_RADIUS`) treats the hero as
 * a link of the chain — the held still pointer (`append`) and a sweep point take nothing and cancel nothing; the pointer event
 * (`full`) on an empty chain takes nothing (with one link it still takes it off — the step back to the hero; with two or more,
 * nothing). Without it the pointer event there took the only link off and the next frame's held pointer (or the next pointer
 * event) took the same body again («мерцание у героя», logs 16.10.2026). The press (`begin`) is unchanged; a drag begun in the
 * circle takes once its point leaves it.
 */
const heroHeld = (world: World, p: Vec, mode: DragMode): boolean =>
  !!world.params.holdHeroLink && (mode !== 'full' || !world.chain.length) && dist(p, world.hero) <= HERO_CANCEL_RADIUS;

/**
 * What a drag point in `mode` picks (`dragChain` acts on it): the nearest body in its press circle among the ones it may take and,
 * for the pointer event (`full`) and the held pointer with `holdNearest` (task 39), the chain's own links. A link of the chain —
 * `full` truncates there (the step back), `append` does nothing; null — nothing. Task 34: on a colour free by «Смена цвета» a
 * sweep point and the held pointer take only the chain's colour. Task 42: with `holdHeroLink` a held or sweep point in the hero's
 * circle picks nothing, nor the pointer event there on an empty chain. The view's ring «что возьмётся» reads it (no copy of the rule).
 */
export function pickAt(world: World, p: Vec, mode: DragMode = 'full', plan: ChainPlan = planChain(world, world.chain, NO_PIERCE)): ChainLink | null {
  if (heroHeld(world, p, mode)) return null;
  const seeLinks = seesLinks(world, mode), free = mode === 'full' ? null : pointerShiftColor(world);
  const keepsColor = (e: Enemy): boolean => free === null || colorlessLink(world, e) || sameColor(world, e.color, free);
  return pick(world, p,
    e => (seeLinks && inChain(world, e) >= 0) || (canLink(world, e, plan) && keepsColor(e)),
    o => (seeLinks && linkIndex(world, { kind: 'object', id: o.id }) >= 0) || canLinkObject(world, o, plan));
}

/**
 * Stage G: a fast drag takes every link under the pointer's path from `from` to `to` (toggle «Протяжка по всему пути
 * мыши»): browsers send one pointer event per frame, and a quick swipe used to jump over an enemy between two events.
 * Points in between only append; only the event point `to` may truncate or cancel on the hero.
 */
export function dragChainAlong(world: World, from: Vec, to: Vec): void {
  const d = dist(from, to), step = 0.15;
  const n = world.params.dragSweep ? Math.min(200, Math.max(1, Math.ceil(d / step))) : 1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    dragChain(world, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 'sweep');
  }
  dragChain(world, to, 'full');
}

/**
 * Stage G: why the enemy or object under the pointer cannot be the next link (the hint at the pointer). Null when the
 * pointer would take or truncate something (the same `pick` as the drag), or when nothing is under it. `held` — the
 * button is down: only then the hint says «идёт проход» during a dash (otherwise nothing is shown while the hero runs).
 */
export function hoverRefusal(world: World, p: Vec, held = false): Refusal | null {
  if (world.status !== 'playing') return null;
  if (world.move && !held) return null;
  // Loop research, step 2: on the closing target of an open chain — why it would not close.
  if (!world.chainClosed) { const kind = loopKindAt(world, p); if (kind) return loopRefusal(world, kind); }
  const plan = planChain(world, world.chain, NO_PIERCE);
  if (pick(world, p,
    e => inChain(world, e) >= 0 || canLink(world, e, plan),
    o => linkIndex(world, { kind: 'object', id: o.id }) >= 0 || canLinkObject(world, o, plan))) return null;
  const under = pick(world, p, () => true, () => true);
  if (!under) return null;
  if (under.kind === 'enemy') { const e = findEnemy(world, under.id); return e ? enemyRefusal(world, e, plan) : null; }
  const o = findObject(world, under.id);
  return o ? objectRefusal(world, o, plan) : null;
}

export function cancelChain(world: World): void { world.chain = []; delete world.chainClosed; delete world.forkAnchor; }

/**
 * Iteration 2.1: the damage to the hero a chain hit on `enemy` would do now through its armed reaction (`EnemyBehavior.armed`:
 * the porcupine's quills, +1 for an elite); 0 — none. The release fixes the links with it; the «−N HP» badge shows it.
 */
export function armedDamage(world: World, enemy: Enemy): number { return Math.max(0, behaviorOf(enemy).armed?.(world, enemy) ?? 0); }

/** Release: the hero dashes along the chain. */
export function releaseChain(world: World): boolean {
  // Loop research, step 2: a closed chain fixes its seal now — the ring and who is inside, as the player saw it last.
  const seal = loopClosed(world) && world.status === 'playing' && !world.move ? sealPreview(world, world.chainClosed!) : null;
  // Loop research, step 3 («Прямая»): the pierce the player saw last — its end and its bodies are fixed now (as the seal's).
  // Task 29 (`returnFixed`): the return run the player saw last, fixed now by «Возврат» (`onRelease`).
  const live = world.status === 'playing' && !world.move, backFixed = live && returnFixedOn(world);
  // Task 46: a fusion of the dash's end fixes its bodies now (the wave, the end blast, the paint), as «Возврат» its run.
  const fusionFix = live && fusionEndOn(world);
  // Task 50: the counters' rank II fix the far links and the survivor's neighbour of the highlight.
  const honedFix = live && !!world.kit?.honed && (honedOn(world, COUNTER_TALISMANS.longArm) || honedOn(world, COUNTER_TALISMANS.frostEdge));
  // Task 48: the Troll's window holds its hit for the return run the player saw too (`trollReserve`).
  const full = live && (pierceOn(world) || backFixed || fusionFix || honedFix || ((trollWindowOn(world) || warlockCharmOn(world)) && returnOn(world))) ? planChain(world) : null;
  const honed: HonedRelease | undefined = honedFix && full?.honed ? { ...full.honed.far ? { far: [...full.honed.far] } : {}, ...full.honed.frost ? { frost: { ...full.honed.frost } } : {} } : undefined;
  const fusion: FusionRelease | undefined = fusionFix && full ? { ...full.fire?.paint ? { paint: full.fire.paint } : {}, ...full.blast ? { blast: full.blast } : {}, ...full.wave ? { wave: full.wave } : {} } : undefined;
  const pierce = pierceOn(world) ? full?.pierce : undefined, back = backFixed ? full?.back : undefined;
  // Task 38: the tethers the player saw cut — fixed now, cut when the dash ends (only while the law acts and a tether stands).
  const cuts = live && tethersOn(world) && world.tethers?.length ? (full ?? planChain(world, world.chain, NO_PIERCE)).cuts : undefined;
  // Task 55а: the drawn chain ends on a thing — its shove is fixed by the release (`cuts`' pattern).
  const lastDrawn = world.chain[world.chain.length - 1], lastThing = lastDrawn?.kind === 'enemy' ? findEnemy(world, lastDrawn.id) : undefined;
  const shoveFix = live && lastThing && isThing(lastThing) && shoveOn(world) ? (full ?? planChain(world, world.chain, NO_PIERCE)).shove : undefined;
  const links = world.chain.filter(l => linkPoint(world, l));
  world.chain = [];
  delete world.chainClosed;
  delete world.forkAnchor;
  if (!links.length || world.status !== 'playing' || world.move) return false;
  world.move = { ...newMove('dash', { x: world.hero.x, y: world.hero.y }, null, world.params.dashSpeed), links };
  if (seal) {
    world.move.seal = { kind: seal.kind, links: seal.links, ring: seal.ring, inside: seal.inside, damage: seal.damage, hold: seal.hold, ...seal.ice ? { ice: true as const, ...seal.ice.brittle ? { brittle: true as const } : {} } : {} };
    world.events.push({ type: 'seal', phase: 'release', kind: seal.kind, points: seal.ring.map(q => ({ x: q.x, y: q.y })), inside: [...seal.inside], links: seal.links });
  }
  if (pierce) fixPierce(world, world.move, pierce);
  if (cuts?.length) world.move.cuts = [...cuts];
  // Task 55а: the shove the player saw — fixed now, run when the dash ends if it reached the thing.
  if (shoveFix) world.move.shove = JSON.parse(JSON.stringify(shoveFix)) as ShovePlan;
  // Task 48: a move whose plan strikes the Troll's core holds his window's hit for itself until it is over.
  // Task 54: the queue of a chain that strikes the Chief's core (its hit takes two plates with a long one).
  chiefRelease(world, links);
  if (trollWindowOn(world)) trollReserve(world, [...links.flatMap(l => (l.kind === 'enemy' ? [l.id] : [])), ...pierce?.bodies.map(b => b.id) ?? [], ...full?.back?.hits.map(h => h.id) ?? [], ...seal?.inside ?? []]);
  // Task 55, stage Д: the same for the warlock's window (his charm gone).
  if (warlockCharmOn(world)) warlockReserve(world, [...links.flatMap(l => (l.kind === 'enemy' ? [l.id] : [])), ...pierce?.bodies.map(b => b.id) ?? [], ...full?.back?.hits.map(h => h.id) ?? [], ...seal?.inside ?? []]);
  // «Смена цвета»: the links that free the colour, as drawn (absent while the rule is off or the chain has none).
  const shifts = colorShiftIds(world, links);
  if (shifts.length) world.move.shifts = shifts;
  // Casino «Котёл»: the dash counts its cheque (purse.ts; absent while the cauldron is off).
  if (purseOn(world)) world.move.purse = { embers: 0, links: 0, last: false };
  // П4 «Раздув за дела»: a chain released with the door open counts toward a greed step (absent while the rule is off).
  greedRelease(world, world.move);
  // Casino «Ставка клятвы» (oath.ts): «Цепи 3+» counts the released chain's enemy links (in the release's tick).
  if (world.oath) {
    const end = links[links.length - 1], button = end.kind === 'object' ? findObject(world, end.id) : undefined;
    oathRelease(world, links.filter(l => l.kind === 'enemy').length, button?.kind === 'button' && !button.pressed);
  }
  // Stage 2, step 3: the links struck ×2 by this dash — frozen and brittle now (the ×2 is fixed at the release).
  const brittle = links.flatMap(l => { const e = l.kind === 'enemy' ? findEnemy(world, l.id) : undefined; return e && chainFactor(world, e) > 1 ? [e.id] : []; });
  if (brittle.length) world.move.brittle = brittle;
  // Task 56: the links taken in water and of the colour on the roll call (omens.ts; nothing without them).
  fixOmenLinks(world.move, links);
  // Iteration 2.1: links whose chain-hit reaction is armed now (the porcupine with its quills up) — fixed at the release, as the ×2.
  const armed = links.flatMap(l => { const e = l.kind === 'enemy' ? findEnemy(world, l.id) : undefined; return e && armedDamage(world, e) > 0 ? [e.id] : []; });
  if (armed.length) world.move.armed = armed;
  // Stage 2, step 3 («Точильный камень»): the first chain with an enemy starts with its power; it is spent by that chain.
  if (world.kit?.firstPower && links.some(l => l.kind === 'enemy')) { world.move.power = world.kit.firstPower; world.kit.firstPower = 0; }
  // Phase B: while a build module acts, the layer numbers the chain on the arena and counts its dash (build.ts).
  if (buildActive(world)) {
    const kit = world.kit!, chain = kit.chains = (kit.chains ?? 0) + 1, start = { x: world.hero.x, y: world.hero.y };
    world.move.build = { chain, links: 0, elites: 0, start: { ...start } };
    runHook(world, 'onRelease', m => m.onRelease!(world, { chain, links, start, ...back ? { back } : {}, ...fusion ? { fusion } : {}, ...honed ? { honed } : {} }));
  }
  return true;
}

// ---- Loop research, step 3: «Прямая» (pierce.ts; design decisions 12.10.2026) ----

/**
 * The release fixes the pierce of the plan (rule 3): the end, the bodies in the order the hero passes them, the ×2 of those
 * frozen and brittle now (as `move.brittle`), one firing for their plates. Event `pierce` `release`.
 */
function fixPierce(world: World, move: HeroMove, pierce: PiercePreview): void {
  const brittle = pierce.bodies.flatMap(b => { const e = findEnemy(world, b.id); return e && chainFactor(world, e) > 1 ? [b.id] : []; });
  move.pierce = {
    from: { ...pierce.from }, to: { ...pierce.to }, length: pierce.length, bodies: pierce.bodies.map(b => ({ id: b.id, t: b.t })),
    ...brittle.length ? { brittle } : {}, ...world.params.eliteArmor ? { firing: nextFiring(world) } : {}, hits: 0, kills: 0,
    // Task 44 «Копьё»: the plates a hit takes, fixed with the plan (absent — 1).
    ...pierce.plates ? { plates: pierce.plates } : {},
  };
  // Task 44: «Копьё» struck — its longer pierce runs.
  if (world.kit?.talismans.includes(FUSIONS.spear)) talismanFired(world, FUSIONS.spear);
  world.events.push({ type: 'pierce', phase: 'release', from: { ...pierce.from }, to: { ...pierce.to }, bodies: pierce.bodies.map(b => b.id), power: pierce.power });
}

/** The last link died on the ground (rule 4): the run starts where the hero stands, with the dash's power (0 — no pierce). */
function beginPierce(world: World, move: HeroMove): void {
  const pierce = move.pierce!;
  if (move.power < 1) { cancelPierce(world, move); return; }
  pierce.start = { x: world.hero.x, y: world.hero.y };
}

/** No pierce after all: the last link survived, lost only a plate, fell into a cliff, or the power is 0. Event `cancel`. */
function cancelPierce(world: World, move: HeroMove): void {
  delete move.pierce;
  world.events.push({ type: 'pierce', phase: 'cancel' });
}

/** Where the run passes the body at `t`: its share `t ÷ length` of the way start → end. */
function piercePoint(pierce: NonNullable<HeroMove['pierce']>, t: number): Vec {
  const s = pierce.start!, k = Math.min(1, Math.max(0, t / pierce.length));
  return { x: s.x + (pierce.to.x - s.x) * k, y: s.y + (pierce.to.y - s.y) * k };
}

/**
 * The run passes a body (rules 2, 7, 8): if it is still on the arena, the chain's power hits it — `strike(P, hp, ×2 fixed at
 * the release, 0, plates)`, P not spent; a plate goes by `stripPlates` with the pierce's one firing. Credited, source
 * `pierce` (kills, score per kill, goal, marked, loot, a sapper's blast are the player's); no combo, crystal, chain score,
 * energy, focus or quills. Its embers go into the cheque (no heat). One hit-stop per pierce.
 */
function pierceHit(world: World, move: HeroMove, id: number): void {
  const pierce = move.pierce!, enemy = findEnemy(world, id);
  if (!enemy) return;
  // Task 48: the Troll's core closed or its window's hit spent — the run passes it by.
  if (enemy.kind === TROLL && trollWards(world, enemy, PIERCE_SOURCE)) return;
  // Task 54: the Chief's core under the feast's rule — the pierce never lands on it.
  if (enemy.kind === CHIEF && chiefWards(world, enemy, PIERCE_SOURCE)) return;
  // Task 55, stage Д: the warlock's core charmed, or out of his window — the run passes it by.
  if (enemy.kind === WARLOCK && warlockWards(world, enemy, PIERCE_SOURCE)) return;
  const factor = pierce.brittle?.includes(id) ? Math.max(1, world.params.frostFactor) : 1;
  const outcome = strike(move.power, enemy.hp, factor, 0, platesOf(enemy));
  if (move.purse) move.purse.embers += linkEmbers(enemy, outcome);
  // The ×2 of the cold is spent by the hit (as a link's).
  delete enemy.brittle;
  if (pierce.brittle) { pierce.brittle = pierce.brittle.filter(x => x !== id); if (!pierce.brittle.length) delete pierce.brittle; }
  pierce.hits++;
  const cause = { source: PIERCE_SOURCE, credited: true, ...pierce.firing !== undefined ? { firing: pierce.firing } : {}, ...pierce.plates ? { plates: pierce.plates } : {} };
  if (outcome.plate) stripPlates(world, enemy, cause);
  else { damageEnemy(world, enemy, outcome.damage, cause); if (outcome.killed) pierce.kills++; }
  if (!pierce.stopped && world.params.hitstop) { pierce.stopped = true; world.hitstop = Math.max(world.hitstop, PIERCE_HITSTOP); }
}

/** The run reached the end: the hero stops there (the dash's end). Event `pierce` `end`. */
function endPierce(world: World, move: HeroMove): void {
  const pierce = move.pierce!;
  landAt(move, pierce.to);
  delete move.pierce;
  // Task 29, the rank of the field «Конец»: the pierce ran — the dash's end (this tick) gives the end blast no turn.
  if (endRankOn(world)) move.pierced = true;
  world.events.push({ type: 'pierce', phase: 'end', hits: pierce.hits, kills: pierce.kills, x: pierce.to.x, y: pierce.to.y });
}

/**
 * Phase B (the hammer «Возврат», track Д2): a run of the hero along `route` (points in order; he ends on the last one) after
 * a dash — no links, no chain end, untouchable as in any move (`canBeHurt`); `power` is kept in the move for the module's
 * hits (`onDashStep` with kind `return`), `onMoveEnd` when it ends. Only from rest (no move): call it from `onChainEnd`.
 */
export function startReturnRun(world: World, route: readonly Vec[], power: number, speed = world.params.dashSpeed): boolean {
  if (world.status !== 'playing' || world.move || !route.length) return false;
  const points = route.map(p => ({ x: p.x, y: p.y })), stop = { ...points[points.length - 1] };
  world.move = newMove('return', stop, points.shift()!, Math.max(0.1, speed));
  world.move.power = power;
  if (points.length) world.move.route = points;
  return true;
}

function newMove(kind: HeroMove['kind'], stop: Vec, point: Vec | null, speed: number): HeroMove {
  return { kind, links: [], power: 0, stop, point, speed, kills: 0, hits: 0, dropped: [], broken: 0, crystalScore: 0 };
}

/** The landing point of a jump towards `p`: clamped to the jump radius (wherever it lands). */
function jumpTarget(world: World, p: Vec): Vec {
  const hero = world.hero, r = world.params.jumpRadius, d = dist(p, hero);
  const k = d > r ? r / d : 1;
  return { x: hero.x + (p.x - hero.x) * k, y: hero.y + (p.y - hero.y) * k };
}

/** Landing point of a jump towards `p`: clamped to the jump radius; null when it lands in an obstacle or over a cliff. */
export function jumpLanding(world: World, p: Vec): Vec | null {
  const land = jumpTarget(world, p);
  if (blockedAt(land, heroRadius(world.params), world.arena)) return null;
  // Task 48: a landing in a solid body (the Troll's) — next to it, where the hero will stand (the preview's point too).
  pushOutOfSolids(world, land);
  return land;
}

/**
 * Stage 3a (М2): why a jump towards `p` would not start — `cliff`: it lands over a cliff (the hint at the pointer), `blocked`: in an
 * obstacle; task 43: `energy` — not enough energy for this jump (on the full Castellan's gallery the jump down is free, a jump that
 * stays on the gallery is not).
 */
export type JumpRefusal = 'cliff' | 'blocked' | 'energy';
export const JUMP_REFUSAL_TEXT: Readonly<Record<JumpRefusal, string>> = { cliff: 'обрыв', blocked: 'препятствие', energy: 'мало энергии' };
export function jumpRefusal(world: World, p: Vec): JumpRefusal | null {
  const land = jumpTarget(world, p), r = heroRadius(world.params);
  if (!blockedAt(land, r, world.arena)) return world.energy >= jumpCostAt(world, p) ? null : 'energy';
  return world.arena.terrain && cliffAt(land, r, world.arena) && !blockedAt(land, r, world.arena, false) ? 'cliff' : 'blocked';
}

/**
 * Task 43: the energy a jump towards `p` costs — 0 from the full Castellan's gallery down into the yard (`jumpDownFree`), else
 * `jumpCostOf`.
 */
export function jumpCostAt(world: World, p: Vec): number {
  return jumpDownFree(world, jumpTarget(world, p)) ? 0 : jumpCostOf(world);
}
/** Task 43: the hero stands on the full Castellan's gallery — a jump down costs 0 (the view shows the jump's price 0 then). */
export const jumpDownOpen = (world: World): boolean => onGallery(world);

/** A jump may start now (towards `p`: its own price; without `p`: some jump — the free jump down from the gallery counts). */
export function canJump(world: World, p?: Vec): boolean {
  const cost = p ? jumpCostAt(world, p) : jumpDownOpen(world) ? 0 : jumpCostOf(world);
  return world.status === 'playing' && !world.move && world.chain.length === 0 && world.energy >= cost;
}

export function jump(world: World, p: Vec): boolean {
  if (!canJump(world, p)) return false;
  const land = jumpLanding(world, p);
  if (!land) return false;
  const cost = jumpCostAt(world, p);
  world.energy -= cost;
  const speed = Math.max(dist(land, world.hero) / JUMP_TIME, 1);
  world.move = newMove('jump', land, land, speed);
  world.events.push({ type: 'jump' });
  // Casino «Ставка клятвы»: a jump breaks «Без прыжков» in this tick.
  if (world.oath) oathJump(world);
  runHook(world, 'onJump', m => m.onJump!(world, cost));
  return true;
}

/** A jump landing inside the open door enters it (design answer 5: entry by chain or jump). */
function landsInDoor(world: World, p: Vec): boolean {
  const door = doorOf(world);
  return doorOpen(world) && dist(door, p) <= OBJECT_RADIUS + heroRadius(world.params);
}

/** Moves the hero towards `target`; true on arrival. */
function moveHeroTo(world: World, target: Vec, step: number, reach = 0): boolean {
  const hero = world.hero, d = dist(hero, target);
  if (d <= reach + 1e-6) return true;
  const go = Math.min(step, d - reach);
  hero.x += (target.x - hero.x) / d * go; hero.y += (target.y - hero.y) / d * go;
  return d - go <= reach + 1e-6;
}

/** Crystal clearance: not this close to the rest of the chain's path, the hero, other objects. */
const CRYSTAL_CLEARANCE = 0.6;
const CRYSTAL_TRIES = 60;

function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/**
 * A crystal falls at a random point within `crystalDropRadius` of the kill (0 — anywhere on the arena, as the random
 * cell of the main game; design 07.10.2026: near the same crowd, to carry the combo on): off walls
 * and trees (water is fine), at least CRYSTAL_CLEARANCE from the rest of the chain's path (the
 * polyline hero → links ahead), the hero and other objects. Enemies may stand there: the crystal
 * is not a body. No point found — no crystal (rare).
 */
function dropCrystal(world: World, at: Vec): void {
  const move = world.move!, arena = world.arena, radius = world.params.crystalDropRadius;
  const path: Vec[] = [{ x: world.hero.x, y: world.hero.y }];
  for (const l of move.links) { const pt = linkPoint(world, l); if (pt) path.push(pt); }
  const margin = OBJECT_RADIUS, rng = world.rng.stream('crystal');
  for (let i = 0; i < CRYSTAL_TRIES; i++) {
    let p: Vec;
    if (radius > 0) {
      // Uniform in the disc around the kill, kept inside the arena.
      const r = radius * Math.sqrt(rng.next()), a = rng.next() * Math.PI * 2;
      p = { x: Math.min(arena.width - margin, Math.max(margin, at.x + r * dcos(a))), y: Math.min(arena.height - margin, Math.max(margin, at.y + r * dsin(a))) };
    } else {
      const x = margin + rng.next() * (arena.width - 2 * margin);
      p = { x, y: margin + rng.next() * (arena.height - 2 * margin) };
    }
    if (blockedAt(p, OBJECT_RADIUS * 0.6, arena)) continue;
    if (world.objects.some(o => dist(o, p) < CRYSTAL_CLEARANCE + OBJECT_RADIUS)) continue;
    let near = dist(path[0], p) < CRYSTAL_CLEARANCE;
    for (let k = 1; k < path.length && !near; k++) near = segmentDistance(path[k - 1], path[k], p) < CRYSTAL_CLEARANCE;
    if (near) continue;
    const crystal: ArenaObject = { id: world.nextId++, kind: 'crystal', x: p.x, y: p.y, pressed: false, value: 0, born: world.time };
    world.objects.push(crystal);
    move.dropped.push(crystal.id);
    world.stats.crystals++;
    world.events.push({ type: 'crystal', objectId: crystal.id, x: p.x, y: p.y });
    return;
  }
}

/** Hit-stop after a kill (toggle): 20 ms growing with the chain, up to 40 ms (sliders). */
function hitstopFor(world: World, kills: number): number {
  const p = world.params;
  if (!p.hitstop) return 0;
  return Math.max(0, Math.min(p.hitstopMax, p.hitstopMin + p.hitstopGrowth * (kills - 1)));
}

/** The last enemy hit of a long chain: a short world slow-motion and a flash (toggle; render reacts to the event). */
function maybeFinisher(world: World): void {
  const move = world.move!, p = world.params;
  if (!p.finisher || move.kills < p.finisherLinks || move.links.some(l => l.kind === 'enemy')) return;
  world.slowmo = p.finisherTime;
  world.stats.finishers++;
  world.events.push({ type: 'finisher', kills: move.kills });
}

/**
 * The dash's hit on the link `enemy` as it would be now (pure): phase B — the build layer's link context and the modules'
 * power before the hit (the same `linkPowerOf` the plan adds), the build's gain; `ctx` null without the layer's count.
 */
function dashStrike(world: World, move: HeroMove, enemy: Enemy): { ctx: LinkContext | null; outcome: StrikeOutcome; pre: number; marks: string[] } {
  const b = move.build;
  const ctx: LinkContext | null = b ? { chain: b.chain, index: b.links + 1, enemy, id: enemy.id, elite: !!enemy.elite, elitesBefore: b.elites, power: move.power, plan: false, crystalsBefore: move.broken, ...b.colorless ? { colorlessBefore: b.colorless } : {} } : null;
  // Task 50 («Охотник на элит» II): plates the link loses before its hit (`hitEnemy` strips them) — the strike takes the rest, as the plan.
  const honed = !!ctx && !!world.kit?.honed, pre = honed ? platesBeforeOf(world, ctx!, platesOf(enemy)) : 0;
  // Task 56 «Половодье»: a link taken in water hits +1, as the plan's (`wetHit`; 0 without it).
  const wet = wetHit(world, !!move.wet?.includes(enemy.id));
  const outcome = strike((ctx ? move.power + linkPowerOf(world, ctx) : move.power) + wet, enemy.hp, dashFactor(world, enemy), linkGainOf(world), platesOf(enemy) - pre);
  // Task 54: the Chief's core — the queue fixed at the release (`chiefRelease`) takes two plates when long (the plan's rule).
  return { ctx, pre, marks: honed ? rank2LinksOf(world, ctx!) : [], outcome: enemy.kind === CHIEF ? chiefHitOutcome(world, enemy, outcome, enemy.vars.wq ?? 0) : outcome };
}

/** Phase B: the layer notes an enemy link the dash reached (struck or passed fallen). */
function noteLink(move: HeroMove, link: { id: number; x: number; y: number; elite?: unknown }, killed: boolean, colorless = false): void {
  const b = move.build!;
  b.links++;
  if (link.elite) b.elites++;
  // Task 33: «Призма» does not count a colourless link (`LinkContext.colorlessBefore`).
  if (colorless) b.colorless = (b.colorless ?? 0) + 1;
  b.last = { id: link.id, x: link.x, y: link.y, killed, ...link.elite ? { elite: true as const } : {} };
}

function hitEnemy(world: World, enemy: Enemy): void {
  const move = world.move!, p = world.params;
  // Task 48: the Troll's core closed (never so for a released plan: `trollReserve`) — the dash stops on it, unhurt.
  if (enemy.kind === TROLL && trollWards(world, enemy, 'chain')) { move.links = []; returnToStop(move); return; }
  // Task 54: the Chief's core closed (never so for a released chain: the refusal and the window's timer standing) — the same.
  if (enemy.kind === CHIEF && chiefWards(world, enemy, 'chain')) { move.links = []; returnToStop(move); return; }
  // Task 55, stage Д: the warlock's core closed (never so for a released plan: the refusals and `warlockReserve`) — the same.
  if (enemy.kind === WARLOCK && warlockWards(world, enemy, 'chain')) { move.links = []; returnToStop(move); return; }
  const { ctx, outcome, pre, marks } = dashStrike(world, move, enemy);
  // Stage 2 of the transition: the kind's reaction to the hit (the porcupine's quills); the hero's death comes first.
  behaviorOf(enemy).onChainHit?.(world, enemy, outcome);
  if (world.status !== 'playing') return;
  // Task 50: the counters' rank II on this link — «Охотник на элит» II strips its plates before the hit; each one's flash.
  if (pre > 0) stripPlates(world, enemy, { source: 'chain', plates: pre }, false);
  for (const id of marks) honedFired(world, id);
  // Stage 2, step 3: the ×2 of the cold is spent by this hit (a survivor stays frozen while the cold lasts, its next hit is plain).
  delete enemy.brittle;
  if (move.brittle) { move.brittle = move.brittle.filter(id => id !== enemy.id); if (!move.brittle.length) delete move.brittle; }
  // Casino «Котёл»: the link's embers (the highlight counts the same outcome, `planChain`).
  if (move.purse) tallyLink(move.purse, linkEmbers(enemy, outcome), outcome.killed);
  // Casino «Ставка клятвы»: the dash reached an enemy link — «Цепь 6+ хотя бы раз» counts it (the links П4 counts).
  if (world.oath) oathLink(world);
  move.power = outcome.powerAfter;
  move.hits++;
  // Task 56 «Перекличка»: a link of the colour called when it was taken adds its energy (0 without it).
  world.energy = Math.min(ENERGY_MAX, world.energy + p.energyPerKill + callEnergy(world, move, enemy.id));
  enemy.hurtFlash = Math.max(p.hitFlash, 0.01);
  world.events.push({ type: 'chainHit', enemyId: enemy.id, damage: outcome.damage, killed: outcome.killed, x: enemy.x, y: enemy.y, combo: move.hits, ...outcome.plate ? { plates: outcome.platesAfter } : {} });
  // «Смена цвета» (design answer 12.10.2026): the link that freed the colour — killed or a plate taken; a survivor ends the
  // chain on it, the colour never became free: no shift (the highlight shows no rainbow on a survivor either).
  if (move.shifts && (outcome.killed || outcome.plate)) reachShift(world, move, enemy);
  if (outcome.plate) {
    // The package (4.3, rule 1): the hit takes a plate (at 0 the window opens), the elite is no survivor — the chain goes on
    // through it; the hero does not take its spot (it stands). As the last link: back to the stop, as from a survivor.
    // Task 54: the Chief's long queue takes two plates (or the last plate and 1 HP; `chiefHitOutcome`).
    const plates = platesOf(enemy) - (outcome.platesAfter ?? 0);
    stripPlates(world, enemy, { source: 'chain', ...plates > 1 ? { plates } : {} }, false);
    if (outcome.hpAfter < enemy.hp) enemy.hp = outcome.hpAfter;
    if (ctx) { move.power += afterLinkPowerOf(world, ctx, outcome); noteLink(move, enemy, false, colorlessLink(world, enemy)); runHook(world, 'onLink', m => m.onLink!(world, ctx, outcome)); }
    if (!move.links.length) returnToStop(move);
    maybeFinisher(world);
    return;
  }
  if (outcome.killed) {
    landAt(move, enemy);
    world.enemies.splice(world.enemies.indexOf(enemy), 1);
    world.stats.kills++;
    move.kills++;
    // Task 14 «Котомка у двери» (bag.ts): a chain kill after the goals fills the bag (nothing without one).
    if (world.bag) bagKill(world);
    // К7 «Проклятый сундук»: a kill of the dash counts toward lifting the curse (nothing without it).
    if (world.curse) curseKill(world);
    if (enemy.marked) world.stats.markedKills++;
    world.events.push({ type: 'kill', enemyId: enemy.id, x: enemy.x, y: enemy.y, color: enemy.color, source: 'chain', credited: true });
    // Task 40: a prisoner's shackle goes with it (nothing while no shackle holds it).
    if (world.tethers) dropShackleOf(world, enemy);
    // Stage 2 of the transition: the kind's own reaction to its death (the sapper lights its fuse); an elite's loot (step 3).
    behaviorOf(enemy).onDeath?.(world, enemy, { source: 'chain', credited: true });
    eliteDeath(world, enemy, { source: 'chain', credited: true });
    if (p.focusKillRefill) world.focus = Math.min(focusMaxOf(world), world.focus + p.focusPerKill);
    checkGoals(world);
    // Phase B: the modules' power after the link (the plan adds the same), then their hooks.
    if (ctx) {
      move.power += afterLinkPowerOf(world, ctx, outcome);
      noteLink(move, enemy, true, colorlessLink(world, enemy));
      runHook(world, 'onLink', m => m.onLink!(world, ctx, outcome));
      const kill = { id: enemy.id, x: enemy.x, y: enemy.y, elite: !!enemy.elite, fallen: false, kills: move.kills };
      runHook(world, 'onChainKill', m => m.onChainKill!(world, kill));
      if (world.status !== 'playing') return;
    }
    // A crystal at every N-th kill of this chain (main game: 6th, 12th…), off the rest of its path.
    if (p.crystals && crystalEveryOf(world) > 0 && move.kills % crystalEveryOf(world) === 0) dropCrystal(world, { x: enemy.x, y: enemy.y });
    world.hitstop = Math.max(world.hitstop, hitstopFor(world, move.kills));
    maybeFinisher(world);
    return;
  }
  enemy.hp = outcome.hpAfter;
  if (p.survivorKnockback && p.survivorKnockbackTime > 0) {
    const dx = enemy.x - world.hero.x, dy = enemy.y - world.hero.y, d = dhypot(dx, dy) || 1;
    const speed = p.survivorKnockbackDistance / p.survivorKnockbackTime;
    enemy.knock = p.survivorKnockbackTime; enemy.knockVx = dx / d * speed; enemy.knockVy = dy / d * speed;
  }
  if (ctx) { noteLink(move, enemy, false, colorlessLink(world, enemy)); runHook(world, 'onLink', m => m.onLink!(world, ctx, outcome)); }
  // The chain stops on a survivor: the hero goes back to the last freed spot (over the points flown over a drop, stage 3a).
  move.links = [];
  returnToStop(move);
  maybeFinisher(world);
}

/**
 * The dash reaches a link that died on the way (a blast, an arrow; `killEnemy` kept its last point): +1 power as a weak
 * enemy, the hero takes its spot. Its death was the player's — a kill of this chain (combo, crystal at every N-th, chain
 * score; the kill counter was counted at its death); otherwise power only. No hit: no energy, no quills, no hit-stop.
 */
function passFallen(world: World, fallen: FallenLink): void {
  const move = world.move!, p = world.params, b = move.build;
  // Phase B: the build's gain (1 without a build module) and, while the layer counts, the modules' power around the link.
  const ctx: LinkContext | null = b ? { chain: b.chain, index: b.links + 1, enemy: null, id: fallen.id, elite: !!fallen.elite, elitesBefore: b.elites, power: move.power, plan: false, crystalsBefore: move.broken, ...b.colorless ? { colorlessBefore: b.colorless } : {} } : null;
  // Task 50: the counters' rank II on a fallen link (its power, as the plan's link alive) — the flash.
  if (ctx && world.kit?.honed) for (const id of rank2LinksOf(world, ctx)) honedFired(world, id);
  move.power += ctx ? linkPowerOf(world, ctx) + linkGainOf(world) + afterLinkPowerOf(world, ctx, null) : linkGainOf(world);
  // Stage 3a (М2): a link that fell into a cliff — the hero flies over its point but does not stop there: the point is
  // noted, and if nothing on the ground follows, the hero flies back along the chain (`returnToStop`).
  if (world.arena.terrain && overCliff(fallen, world.arena)) (move.detour ??= []).push({ x: fallen.x, y: fallen.y });
  else landAt(move, fallen);
  if (ctx) { noteLink(move, fallen, true); runHook(world, 'onLink', m => m.onLink!(world, ctx, null)); }
  // Casino «Котёл»: a fallen link counts for the heat (it is dead); a credited one brings its embers (`fallenEmbers`), an enemy
  // ability's kill none.
  if (move.purse) tallyLink(move.purse, fallen.embers ?? 0, true);
  if (world.oath) oathLink(world);
  if (move.shifts) reachShift(world, move, fallen);
  if (!fallen.credited) return;
  move.kills++;
  if (ctx) {
    const kill = { id: fallen.id, x: fallen.x, y: fallen.y, elite: !!fallen.elite, fallen: true, kills: move.kills };
    runHook(world, 'onChainKill', m => m.onChainKill!(world, kill));
  }
  if (p.crystals && crystalEveryOf(world) > 0 && move.kills % crystalEveryOf(world) === 0) dropCrystal(world, { x: fallen.x, y: fallen.y });
  maybeFinisher(world);
}

/**
 * «Смена цвета»: the dash reached `link` — if it freed the chain's colour (`HeroMove.shifts`), event `colorShift`, «Кристалл в
 * цепи» of the oath is met (a shift counts as a crystal broken), the build's `onColorShift` («Призма»: +1 energy).
 */
function reachShift(world: World, move: HeroMove, link: { id: number; x: number; y: number }): void {
  const shifts = move.shifts!, at = shifts.indexOf(link.id);
  if (at < 0) return;
  shifts.splice(at, 1);
  if (!shifts.length) delete move.shifts;
  world.events.push({ type: 'colorShift', enemyId: link.id, x: link.x, y: link.y });
  if (world.oath) oathCrystal(world);
  runHook(world, 'onColorShift', m => m.onColorShift!(world, { id: link.id, x: link.x, y: link.y }));
}

/** Stage 3a (М4): the dash takes a burning brazier: +`brazierPower` to the rest, it goes out for `brazierCooldown` s. */
function takeBrazier(world: World, brazier: ArenaObject): void {
  const move = world.move!;
  landAt(move, brazier);
  if (brazier.out !== undefined) return;
  move.power += brazierPowerOf(world);
  // A cooldown of 0 (the panel): it never goes out — no event either.
  const cooldown = Math.max(0, world.params.brazierCooldown);
  if (cooldown <= 0) return;
  brazier.out = cooldown;
  world.events.push({ type: 'brazier', objectId: brazier.id, x: brazier.x, y: brazier.y, lit: false });
}

/** The dash reaches a crystal: it breaks (score by the chain that dropped it), the hero takes its spot; the chain goes on. */
function breakCrystal(world: World, crystal: ArenaObject): void {
  const move = world.move!, p = world.params;
  const score = Math.round(p.crystalScorePerKill * (crystal.value ?? 0));
  landAt(move, crystal);
  move.broken++;
  move.crystalScore += score;
  world.objects.splice(world.objects.indexOf(crystal), 1);
  world.events.push({ type: 'crystalBreak', objectId: crystal.id, x: crystal.x, y: crystal.y, score, combo: move.hits });
  // Casino «Ставка клятвы»: a crystal broken by the dash meets «Кристалл в цепи».
  if (world.oath) oathCrystal(world);
  runHook(world, 'onCrystal', m => m.onCrystal!(world, { id: crystal.id, x: crystal.x, y: crystal.y }));
}

/** The chain ended on an object: a button is pressed for good; the open door wins the arena. */
function reachObject(world: World, object: ArenaObject): void {
  const move = world.move!;
  landAt(move, object);
  move.links = [];
  if (object.kind === 'button') {
    if (object.pressed) return;
    object.pressed = true;
    // Casino «Ставка клятвы»: a short chain to this button holds «Цепи 3+».
    if (world.oath) oathButton(world);
    world.events.push({ type: 'button', objectId: object.id });
    checkGoals(world);
  } else if (object.kind === 'lever' && object.gate) {
    // Task 43: a lever of the full Castellan's grate — it rises after the dash.
    gateLever(world, object);
  } else if (object.kind === 'lever') {
    // Casino stage 1 («Однорукий гоблин»): the pull — the enemy links this dash really struck (kills and plate hits) count.
    pullLever(world, object, move.hits);
  } else if (doorOpen(world)) {
    win(world, 'chain');
  }
}

/** The hero takes a spot on the ground (the stop of the dash): the points flown over a drop before it are left behind. */
function landAt(move: HeroMove, p: Vec): void {
  move.stop = { x: p.x, y: p.y };
  delete move.detour;
}

/**
 * The way back to the stop (a survivor, or the end of a dash whose last links fell into a cliff — stage 3a, М2): back over
 * the points flown over the drop in reverse, then the stop — along the chain's own path, at the dash speed. Without such
 * points — straight to the stop, as before.
 */
function returnToStop(move: HeroMove): void {
  const route = [...(move.detour ?? [])].reverse();
  delete move.detour;
  route.push({ ...move.stop });
  move.point = route.shift()!;
  if (route.length) move.route = route; else delete move.route;
}

function finishMove(world: World): void {
  const hero = world.hero, move = world.move!;
  hero.x = move.stop.x; hero.y = move.stop.y;
  pushOutOfObstacles(hero, heroRadius(world.params), world.arena);
  // Task 48: out of a solid body (the Troll's) — the plan's end does the same (`planDashEnd`).
  pushOutOfSolids(world, hero);
  world.move = null;
  // Stage 3a (М3, design 09.10.2026): any dash or jump ending in thorns gives the hero a full interval to walk out (also
  // one from thorns into thorns: the timer starts again).
  if (world.arena.terrain && inThorns(hero, world.arena)) hero.thorns = Math.max(0.05, world.params.thornInterval);
  // Phase A, T4 (design answer 6): the same for a fire trail of «Огненный» — a full interval to walk out.
  if (trailAt(world, hero)) hero.flames = Math.max(0.05, world.params.trailInterval);
  // Casino «Ставка клятвы»: a short chain to a button the dash did not press breaks «Цепи 3+».
  if (move.kind === 'dash' && world.oath) oathDashEnd(world);
  // Task 38: the dash cuts the tethers its release fixed (the bodies freed act once no move runs).
  if (move.kind === 'dash' && move.cuts && world.status === 'playing') cutTethers(world, move.cuts);
  // Task 55а: the shove the release fixed — run now if the dash reached the thing, else cancelled (a survivor stopped it before).
  const shove = move.kind === 'dash' && world.status === 'playing' ? move.shove : undefined;
  if (shove && move.shoveHit) startShove(world, shove);
  else if (shove) world.events.push({ type: 'shove', action: 'cancel', thingId: shove.thing, x: shove.from.x, y: shove.from.y });
  // Task 40: the shackles of a keymaster that died during the move fall now (after the dash, after the jump).
  if (world.tethers) settleTethers(world);
  if (move.kind === 'dash') {
    // Crystals of this chain are worth its final length (main game: crystalChain).
    for (const id of move.dropped) { const c = findObject(world, id); if (c) c.value = move.kills; }
    const score = chainScore(world.params, move.kills) + move.crystalScore;
    world.stats.score += score;
    world.stats.bestChain = Math.max(world.stats.bestChain, move.kills);
    // The prologue's goals «N by one chain» and «N by one strike» (only its arenas): the finished dash counts (a kill passed as a
    // fallen link too).
    if (world.arena.goal === 'chain' || world.arena.goal === 'strike') checkGoals(world);
    world.lastChain = { kills: move.kills, hits: move.hits, crystals: move.broken, score, time: world.time };
    world.events.push({ type: 'chainEnd', kills: move.kills, score });
    // Casino «Котёл»: the chain's cheque goes into the cauldron (purse.ts; nothing while it is off).
    settleCheque(world, move);
    // «Длинная цепь кормит гоблина» (slot.ts): a chain that struck 6+ enemy links adds safe pulls (nothing while the rule does
    // not act; a chain into the lever counted before its pull).
    slotFeedEnd(world, move);
    // Stage F (user 07.10.2026): a chain that killed leaves the hero untouchable for a moment to walk out of the crowd;
    // a new one replaces the rest (no stacking); the hurt invulnerability runs on its own, the larger protects.
    // Phase B: its length is the build's (build.ts `chainShieldOf`: «Добивание», «Быстрые ноги»).
    const b = move.build;
    const end: ChainEnd | null = b ? { chain: b.chain, kills: move.kills, hits: move.hits, links: b.links, elites: b.elites, last: b.last ? { ...b.last } : null,
      power: move.power, start: { ...b.start }, end: { x: hero.x, y: hero.y } } : null;
    // Task 29, the rank of the field «Конец» (buildIds.ts `END_RANK`): the seal or the pierce that acted on this chain.
    if (end && endRankOn(world) && (move.seal || move.pierced)) end.endForm = move.seal ? 'seal' : 'pierce';
    // Task 50: the kills it needs are the build's (`chainShieldMinKillsOf`: «Добивание» II fewer; without it the panel's).
    const shield = chainShieldOf(world, end);
    // Task 55а: the shove's planned kills are this chain's (spec 2.5) — they count for the shield in the dash's end.
    const shoveKills = shove && move.shoveHit ? shove.crushed.length + (shove.impact?.killed ? 1 : 0) : 0;
    if (shield > 0 && move.kills + shoveKills >= chainShieldMinKillsOf(world, end)) {
      hero.chainShield = shield;
      // The prologue, task 13 (goal `shield`): a new shield window for the room's lamps (nothing on another arena).
      startShieldWindow(world);
    }
    // Loop research, step 2: the seal strikes at the end of the dash — on those inside at the release still on the arena.
    if (move.seal) strikeSeal(world, move.seal);
    // Phase B: the dash is over — the build modules' end of chain (a wave, the end blast, the return run …).
    if (end) runHook(world, 'onChainEnd', m => { if (world.status === 'playing') m.onChainEnd!(world, end); });
  }
  if (move.kind === 'jump' && landsInDoor(world, hero)) win(world, 'jump');
  if (move.kind === 'return') runHook(world, 'onMoveEnd', m => m.onMoveEnd!(world, move));
}

/**
 * Dash / jump / return progress in real seconds (the dash ignores focus; contact damage is off). Phase B: while a build
 * module has `onDashStep`, the hero's path of this tick (dash or return run) goes to it after the tick's hits, before the
 * move ends.
 */
function stepMove(world: World, realDt: number): void {
  const move = world.move;
  if (!move) return;
  // Task 57а (`Params.snuffShots`, shots.ts): the dash's path puts out the light shots it touches (no path without a shot on the arena).
  const snuff = move.kind !== 'jump' && snuffing(world), hooked = move.kind !== 'jump' && hasHook(world, 'onDashStep');
  const path = hooked || snuff ? [{ x: world.hero.x, y: world.hero.y }] : null;
  const done = advanceMove(world, move, move.speed * realDt, path);
  if (snuff && path && path.length > 1) snuffAlong(world, path);
  if (hooked && path && path.length > 1) runHook(world, 'onDashStep', m => m.onDashStep!(world, { kind: move.kind, path, move }));
  if (done && world.move === move) finishMove(world);
}

/**
 * Moves the hero along the move by `budget` units; true — the move reached its end (`finishMove` follows). `path` (phase B)
 * collects the hero's points when given.
 */
function advanceMove(world: World, move: HeroMove, budget: number, path: Vec[] | null): boolean {
  const moveHero = (target: Vec, step: number, reach = 0): boolean => {
    const arrived = moveHeroTo(world, target, step, reach);
    if (path) { const h = world.hero, last = path[path.length - 1]; if (h.x !== last.x || h.y !== last.y) path.push({ x: h.x, y: h.y }); }
    return arrived;
  };
  for (let guard = 0; guard < 64 && budget > 1e-6 && world.move; guard++) {
    const before = { x: world.hero.x, y: world.hero.y };
    if (move.links.length) {
      const link = move.links[0];
      if (link.kind === 'object') {
        const object = findObject(world, link.id);
        if (!object) { move.links.shift(); continue; }
        const arrived = moveHero(object, budget);
        budget -= dist(before, world.hero);
        if (!arrived) return false;
        if (object.kind === 'crystal') { move.links.shift(); breakCrystal(world, object); continue; }
        // Stage 2, step 3: the loot of an elite — picked up, the hero takes its spot, the chain goes on.
        if (object.kind === 'loot') { move.links.shift(); landAt(move, object); pickLoot(world, object); continue; }
        // К7 «Проклятый сундук»: taken as the loot — the hero takes its spot, the curse starts, the chain goes on.
        if (object.kind === 'chest') { move.links.shift(); landAt(move, object); takeChest(world, object, 'chain'); continue; }
        // Stage 3a (М4): a brazier — +power to the rest of the chain, it goes out; the hero takes its spot, the chain goes on.
        if (object.kind === 'brazier') { move.links.shift(); takeBrazier(world, object); continue; }
        reachObject(world, object);
        continue;
      }
      const enemy = findEnemy(world, link.id);
      if (!enemy) {
        // Died on the way (stage 2 of the transition): the hero still passes its last point and takes its +1.
        const fallen = move.fallen?.find(f => f.id === link.id);
        if (!fallen) { move.links.shift(); continue; }
        const arrived = moveHero(fallen, budget);
        budget -= dist(before, world.hero);
        if (!arrived) return false;
        move.links.shift();
        passFallen(world, fallen);
        // «Прямая»: the last link fell on the ground (not into a cliff) — the run starts.
        if (move.pierce && !move.pierce.start && !move.links.length && !move.detour) beginPierce(world, move);
        continue;
      }
      // Task 55а: a thing — the hero reaches it at the touch distance, strikes nothing and goes back to the stop; its shove waits for the end.
      if (isThing(enemy) && shoveOn(world)) {
        const arrived = moveHero(enemy, budget, touchDistanceOf(world.params, enemy));
        budget -= dist(before, world.hero);
        if (!arrived) return false;
        move.links = [];
        if (move.shove?.thing === enemy.id) move.shoveHit = true;
        returnToStop(move);
        continue;
      }
      // A kill takes the enemy's spot; a survivor is struck from the touch distance.
      const survives = !dashStrike(world, move, enemy).outcome.killed;
      const reach = survives ? touchDistanceOf(world.params, enemy) : 0;
      const arrived = moveHero(enemy, budget, reach);
      budget -= dist(before, world.hero);
      if (!arrived) return false;
      move.links.shift();
      hitEnemy(world, enemy);
      if (world.status !== 'playing') return false;
      // «Прямая»: the last link died by the hit — the run starts (a survivor or a plate taken cancels it below).
      if (move.pierce && !move.pierce.start && !move.links.length && !world.enemies.includes(enemy) && !move.point && !move.detour) beginPierce(world, move);
      // Hit-stop: the rest of this tick's dash waits with the world (the next ticks are frozen while it lasts).
      if (world.hitstop > 0) break;
      continue;
    }
    // Loop research, step 3 («Прямая»): the links are done — the run to the fixed end, the bodies hit as the hero passes them.
    const pierce = move.pierce;
    if (pierce) {
      if (!pierce.start) { cancelPierce(world, move); continue; }
      const next = pierce.bodies[0];
      const arrived = moveHero(next ? piercePoint(pierce, next.t) : pierce.to, budget);
      budget -= dist(before, world.hero);
      if (!arrived) return false;
      if (!next) { endPierce(world, move); continue; }
      pierce.bodies.shift();
      pierceHit(world, move, next.id);
      if (world.status !== 'playing') return false;
      if (world.hitstop > 0) break;
      continue;
    }
    if (move.point) {
      const arrived = moveHero(move.point, budget);
      budget -= dist(before, world.hero);
      if (!arrived) return false;
      move.point = move.route?.shift() ?? null;
      if (move.route && !move.route.length) delete move.route;
      continue;
    }
    // Stage 3a (М2): the last links fell into a cliff — fly back over them to the ground first.
    if (move.detour) { returnToStop(move); continue; }
    return true;
  }
  if (world.move && !move.links.length && !move.point && !move.pierce) { if (move.detour) returnToStop(move); else return true; }
  return false;
}

/**
 * Game seconds per real second of the next tick, from the state before it: focus while a chain is drawn and focus is
 * left (×focusSlow), the finisher slow-motion (×finisherSlow, the smaller wins), otherwise 1. The runner charges a tick
 * `SIM_DT ÷ scale` of real time (simulation.ts) — focus and the slow-motion are fewer ticks per real second, not
 * skipped render frames.
 */
export function tickScale(world: World): number {
  const p: Params = world.params;
  if (world.status !== 'playing') return 1;
  const selecting = world.chain.length > 0 && !world.move;
  let scale = selecting && Math.min(world.focus, focusMaxOf(world)) > 0 ? p.focusSlow : 1;
  if (world.slowmo > 0) scale = Math.min(scale, p.finisherSlow);
  return scale;
}

/**
 * Hero step before `update` on every tick: focus decides the time scale (`tickScale`), then the dash or the jump moves
 * the hero. Focus, the dash, the jump and the slow-motion run on real seconds: `realDt` = `SIM_DT ÷ tickScale`.
 */
export function stepHero(world: World, realDt: number): void {
  const p = world.params, focusMax = focusMaxOf(world);
  world.focus = Math.min(world.focus, focusMax);
  if (world.status !== 'playing') { world.chain = []; delete world.chainClosed; world.focusing = false; world.timeScale = 1; return; }
  const selecting = world.chain.length > 0 && !world.move;
  if (selecting && world.focus > 0) {
    world.focusing = true;
    world.timeScale = p.focusSlow;
    world.focus = Math.max(0, world.focus - realDt);
  } else {
    world.focusing = false;
    world.timeScale = 1;
    // An empty focus leaves the time normal; the chain can still be finished.
    if (!selecting) world.focus = Math.min(focusMax, world.focus + p.focusRegen * realDt);
  }
  // Finisher slow-motion (stage C): the world runs slower for a moment after the last hit of a long chain.
  if (world.slowmo > 0) {
    world.slowmo = Math.max(0, world.slowmo - realDt);
    world.timeScale = Math.min(world.timeScale, p.finisherSlow);
  }
  // Links that left the arena (should not happen in stage 2) drop out of the drawn chain.
  const drawn = world.chain.length;
  if (drawn) world.chain = world.chain.filter(l => linkPoint(world, l));
  // Loop research, step 2: a closed chain stays true to the closing rules (`syncLoop`).
  syncLoop(world, drawn);
  stepMove(world, realDt);
}
