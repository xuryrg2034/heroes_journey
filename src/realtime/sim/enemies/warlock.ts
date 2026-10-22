/**
 * Task 55, stage Д «Колдун v0» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 6; the rules —
 * docs/realtime-elite-behaviors.md, «Колдун v0»): the final boss of the castle on the frame of the Jailer, the Troll and the Chief
 * (enemies/jailer.ts, troll.ts, chief.ts). Only while `Params.bossFrame` is on (his arena «Зал колдуна», sim/arenasCastle.ts, turns
 * it on for itself); without it the core is a plain enemy that walks to the hero.
 *
 * **The body.** The core (`warlock`, colourless with `jailerColorless`, HP `warlockHp`, `warlockPlates` boss plates) floats at a
 * candle of his arena (`ArenaTemplate.warlock.candles`): a common body held at its spot, solid for the hero with `Params.trollSolid`
 * (task 48, design 24.10), its touch hurts (source `warlock`). His wardrobe — a plain wardrobe of the castle (enemies/castle.ts) — is
 * no part of him (no `partOf`: a shove must move it); the core marks it at his first step (`vars.wl` on the wardrobe — the nearest one).
 * The core's death ends the fight (`bossClears`).
 *
 * **«Под чарами»** (phase 1, `Params.warlockCharm`): while his wardrobe stands, the chain refuses him (chain.ts `spellbound`) and no
 * source but a shove's strike hurts him (`warlockWards`: world.ts `damageEnemy`, the dash's strike, the pierce's; event `warlockCharm`
 * `block` — the view's «звон»). A shove's strike — a thing stopped at him (sim/shove.ts) — always lands: a plate, none — 1 HP; his own
 * wardrobe breaks on him. His wardrobe broken (at a wall, a thing, or on him) — once the hero's move and every slide are over — phase 2
 * (event `warlockCharm` `broken`, `bossPhase` 2) and a «Перенос» at once.
 *
 * **The window** (phase 2): after each arrival — `warlockWindow` s: the chain takes him (a colourless link), one hit (the first of any
 * source lands, the others in the window do not; the hit is held for the hero's chain and released move — `warlockReserve`, as the
 * Troll's). A shove's strike neither waits for a window nor spends it. Outside it the chain refuses him (`outOfWindow`). The window's
 * timer stands while a move of the hero runs (a thing's slide does not hold it: the window is time, design 21.10.2026); it closes once the move that struck him is over, or when its time is out — then the core
 * in the drawn chain drops out of it with the links after it (event `warlockWindow` `unlink`; chain.ts `planChain(...).warlockDrop`).
 * Without the key the core takes every hit; the shifts still come (the view, the bot's comparison).
 *
 * **«Перенос»** (the shift): every `warlockShift` s in phase 1 (the first arrival `FIRST_SHIFT` s into the fight), every
 * `warlockShiftFast` s from the arrival in phase 2 («Испытание V»: × the kit's `phaseScale`). The target candle lights `SHIFT_SIGN` s
 * before (the first `FIRST_SHIFT_SIGN`; event `warlockShift` `mark`): one of the other candles by the stream `behavior:warlock` — not
 * one within `CANDLE_NEAR` of the hero and, in phase 1, not the one nearest the hero; none left — any other. The arrival waits for the
 * hero's move and every slide (event `arrive`); it hurts nobody. The cold: the frozen core's timers wait (the shift, the sign, the
 * window).
 *
 * State in `vars`: `hx`, `hy` (its spot), `born`, `phase`, `ci` (the candle it stands at), `sh` (to the next arrival), `tg` (the target
 * candle + 1 while its sign burns), `sg` (the sign's length), `fs` (the first sign is over: the next are `SHIFT_SIGN`), `wo` (the window is open), `wl` (its seconds left), `wh` (its hit landed),
 * `wr` (the running move holds its hit), `wb` (the tick of the last `block`), `wd` (his wardrobe was marked). The wardrobe: `wl` (the
 * core's id).
 *
 * **Колдун v1** (task 55 §23, the user's decisions 22.10.2026; `Params.warlockV1` — «Зал колдуна» puts it on, values without the key
 * play v0 byte for byte): the mage-shooter and summoner. Every move below runs only with the key; the stream `behavior:warlock` draws
 * the candle (as v0), the volley's colour and the formation's colour.
 * - «Цветные шары» (`orbs`): every `warlockOrbPeriod` s in phases 1–2 (the windup within it), the hero farther than `ORB_NEAR` and in
 *   sight, at most `ORB_MAX` orbs alive with the new ones — a fan of `ORB_FAN` at ±`ORB_SPREAD`° (the middle line through the hero);
 *   phase 3 — a ring of `ORB_RING` (one line through the hero) at each arrival by the hero, the cap aside (the ring is its form). The
 *   lines are fixed at the windup's start (`ORB_WINDUP`, the fight's first ×`ORB_FIRST_FACTOR`); the orbs (`warlock-orb`, one colour a
 *   volley) leave along them at the windup's end.
 * - The orb: HP 0, body ×0.6, a link of its colour, a kill that counts; straight at `ORB_SPEED` for `ORB_LIFE` s; a wall or the edge
 *   puts it out; its touch on the hero −`ORB_DAMAGE` (source `warlock-orb`; a shield takes it) and it goes out with no kill; a dash or
 *   a jump passes through it. A link of the drawn chain or the dash stands, its clock waits, it touches nobody (`linkedNow`, the
 *   wisp's rule); frozen — it stands. Not in the crowd (`noCrowd`); bodies and standing things do not stop it (a sliding thing kills
 *   it, not the player's: shove.ts).
 * - «Ковёр дёргает» (`rug`): every `warlockRugPeriod` s in phase 2 (`RUG_RAGE_PERIOD` in phase 3), due and the hero's centre on a rug
 *   of the arena (`ArenaTemplate.warlock.rugs`) — the windup `RUG_WINDUP` s; then every body on a rug (the hero not in his own move,
 *   the enemies and the orbs; not the things, not the core, not a frozen body; a link of the running dash stands) slides `RUG_PULL`
 *   towards the core's centre over `RUG_SLIDE` s, out of walls and solid bodies. No damage. The drawn chain then keeps the drawing's
 *   reach (chain.ts `dropBeyondReach`: the links beyond it drop, event `warlockRug` `unlink`).
 * - «Перенос к герою» (`blink`): in phase 2 every second «Перенос», in phase 3 each — to the point `BLINK_RADIUS` from the hero behind
 *   his last step (none yet — away from the core), free of walls and things (else the nearest free on that circle, turns of
 *   `BLINK_TURN`; none — a candle as v0), fixed at the sign's start (the rune, `SHIFT_SIGN` s). On arrival «Вспышка посоха» (`flash`):
 *   the windup `FLASH_WINDUP` s, then −`FLASH_DAMAGE` to the hero within `FLASH_RADIUS` of the core (+ his body; source
 *   `warlock-flash`); then the window (`warlockWindow`) opens. A plain «Перенос» — v0's.
 * - «Зов строя» (`summon`): phases 1–2 (the `SUMMON_FIRST`-th s, then every `SUMMON_CHARM_PERIOD` s; phase 2 — `warlockSummonPeriod`),
 *   at most `SUMMON_MAX` of his formations alive (else the call is skipped to the next period) — the staff raised `SUMMON_WINDUP` s,
 *   then `SUMMON_SIZE` basic markers of one colour (`SUMMON_MARK` s) across the way to the hero at the candle farthest from him (not
 *   his own). They join the crowd's limit.
 * - Phase 3 «ярость»: phase 2 and `RAGE_PLATES` plates or fewer, once the hero's move and every slide are over (event `bossPhase` 3);
 *   «Перенос» every `warlockShiftRage` s («Испытание V» ×`phaseScale`).
 * - The staff's moves (orbs, rug, summon) go one at a time, none while a sign burns or the flash winds up, and each begins only if it
 *   ends before the next arrival.
 *
 * v1 state in `vars`: `px`, `py` (the hero last tick), `lx`, `ly` (his last step), `ot` (to the next fan), `ow`/`owt` (the volley's
 * windup left / its length), `ok` (1 — a ring), `oc` (its colour), `of` (the first volley is over), `on`, `gx`, `gy`, `g<i>x`, `g<i>y`,
 * `g<i>l` (its lines), `rt` (to the next rug), `rw` (its windup left), `rs` (its slide left), `rh` (the hero slides), `bk`, `bx`, `by`
 * (the rune's sign and point), `fw` (the flash's windup left), `sn` («Перенос» count of phase 2), `zt` (to the next call), `zw` (its
 * windup left), `zc` (its candle), `f1`, `f2` (his last two formations). A body on a rug sliding: `vars.wp`; an orb: `dx`, `dy`, `ol`.
 */
import { datan2, dcos, dhypot, dsin } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius, type Params } from '../params';
import { linkedNow } from '../shots';
import { palette, spawnEnemy } from '../spawn';
import { dropBeyondReach } from '../chain';
import { canBeHurt, enemyFrozen, heroGuarded, hurtHero, noteBlock, pushOutOfSolids, touchReachOf, type Enemy, type World } from '../world';
import { GUARD_STEP } from './garrison';
import { bossClear, bossClearsOn } from './jailer';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

export const WARLOCK = 'warlock';
/** The wardrobe (enemies/castle.ts; no import: the kinds register after). */
const WARDROBE = 'wardrobe';
/** The hero's damage source of the core's touch. */
export const WARLOCK_SOURCE = 'warlock';

// ---- Баланс (гипотезы спеки задачи 55, 17.10.2026; тесты проверяют правила, не числа) ----
export const WARLOCK_HP = 2;
export const WARLOCK_PLATES = 4;
export const WARLOCK_SHIFT = 10;
export const WARLOCK_SHIFT_FAST = 5;
export const WARLOCK_WINDOW = 1.5;
/**
 * His arena's crowd (design 21.10.2026 by the bot's grid 0.45 / 0.6 / 0.75 / 0.9: the least in the band of 76–85 % deaths with a win
 * ≤ 60 s; provisional until the user's sandbox playtest; until then 0.45 — spec 6.5, the Troll's number).
 */
export const WARLOCK_CROWD = 0.9;
/** The first arrival (game s into the fight) and the signs (the first, the others). */
export const FIRST_SHIFT = 6;
export const FIRST_SHIFT_SIGN = 1.5;
export const SHIFT_SIGN = 1;
/** A candle this near the hero is no target. */
export const CANDLE_NEAR = 1;
/** The core barely yields when bodies push apart (it is held at its spot). */
const PINNED_MASS = 100;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;
const STREAM = 'behavior:warlock';
/** The sources of the hero's own moves: they may take the hit a released move holds (`warlockReserve`). */
const OWN_SOURCES: readonly string[] = ['chain', 'pierce', 'hammer-return', 'seal'];
/** A shove's strike (sim/shove.ts): it hurts him charmed or not, in a window or out of one, and never spends the window. */
const SHOVE_SOURCE = 'shove';

// ---- Колдун v1 (task 55 §23; the spec's hypotheses of 22.10.2026 — the tests check the rules, not the numbers) ----
/** The orb: its kind and the hero's damage sources of the orb and of «Вспышка посоха». */
export const WARLOCK_ORB = 'warlock-orb';
export const ORB_SOURCE = 'warlock-orb';
export const FLASH_SOURCE = 'warlock-flash';
/** The moves of v1 (event `bossMove`). */
export const WARLOCK_MOVES = ['orbs', 'rug', 'blink', 'flash', 'summon'] as const;
export type WarlockMove = typeof WARLOCK_MOVES[number];
export const ORB_PERIOD = 5;
export const ORB_WINDUP = 0.8;
export const ORB_FIRST_FACTOR = 1.5;
export const ORB_SPEED = 6;
export const ORB_LIFE = 3;
export const ORB_DAMAGE = 2;
export const ORB_MAX = 6;
export const ORB_FAN = 3;
export const ORB_SPREAD = 25;
export const ORB_RING = 8;
/** The fan waits while the hero is this near the core (or out of sight). */
export const ORB_NEAR = 3;
export const RUG_PERIOD = 8;
export const RUG_RAGE_PERIOD = 6;
export const RUG_WINDUP = 1;
export const RUG_PULL = 1.5;
export const RUG_SLIDE = 0.3;
export const SHIFT_RAGE = 3;
export const BLINK_RADIUS = 2.6;
export const RUNE_RADIUS = 0.6;
/** The search of a free point on the blink's circle: turns of this many radians either side of «behind the hero». */
export const BLINK_TURN = Math.PI / 36;
export const FLASH_RADIUS = 2;
export const FLASH_WINDUP = 0.6;
export const FLASH_DAMAGE = 2;
export const SUMMON_FIRST = 15;
export const SUMMON_CHARM_PERIOD = 20;
export const SUMMON_PERIOD = 15;
export const SUMMON_WINDUP = 1.2;
export const SUMMON_SIZE = 4;
export const SUMMON_MARK = 1;
export const SUMMON_MAX = 2;
/** Phase 3 comes at this many plates or fewer (of `warlockPlates`). */
export const RAGE_PLATES = 2;
/** A hero step shorter than this in a tick is no step (a push of a thing, a crumb). */
const STEP_MIN = 0.02;
const LINE_STEP = 0.05;

const frameOn = (world: World): boolean => !!world.params.bossFrame;
/** Колдун v1 rules this world: the frame and `Params.warlockV1`. */
export const warlockV1On = (world: World): boolean => frameOn(world) && !!world.params.warlockV1;
const orbPeriodOf = (world: World): number => Math.max(0.5, world.params.warlockOrbPeriod ?? ORB_PERIOD);
const rugPeriodOf = (world: World, phase: number): number => (phase >= 3 ? RUG_RAGE_PERIOD : Math.max(0.5, world.params.warlockRugPeriod ?? RUG_PERIOD));
const shiftRageOf = (world: World): number => Math.max(0.5, world.params.warlockShiftRage ?? SHIFT_RAGE) * (world.kit?.phaseScale ?? 1);
const summonPeriodOf = (world: World): number => Math.max(1, world.params.warlockSummonPeriod ?? SUMMON_PERIOD);
const hpOf = (params: Params): number => Math.max(1, Math.round(params.warlockHp ?? WARLOCK_HP));
const platesOf = (params: Params): number => Math.max(0, Math.round(params.warlockPlates ?? WARLOCK_PLATES));
const shiftOf = (world: World): number => Math.max(0.5, world.params.warlockShift ?? WARLOCK_SHIFT) * (world.kit?.phaseScale ?? 1);
const shiftFastOf = (world: World): number => Math.max(0.5, world.params.warlockShiftFast ?? WARLOCK_SHIFT_FAST) * (world.kit?.phaseScale ?? 1);
const windowOf = (world: World): number => Math.max(0.05, world.params.warlockWindow ?? WARLOCK_WINDOW);

/** The warlock's core on the arena (the first). */
export const warlockCore = (world: World): Enemy | undefined => world.enemies.find(e => e.kind === WARLOCK);
/** The candles of his arena (none — his spot only). */
const candlesOf = (world: World): readonly Vec[] => world.arena.warlock?.candles ?? [];
/** His wardrobe on the arena (the one he marked). */
export const warlockWardrobe = (world: World, core: Pick<Enemy, 'id'>): Enemy | undefined => world.enemies.find(e => e.kind === WARDROBE && e.vars.wl === core.id);

// ---- The charm and the window ----

/** The warlock's charm and windows rule this world: the frame and `Params.warlockCharm` on. */
export const warlockCharmOn = (world: World): boolean => frameOn(world) && !!world.params.warlockCharm;
/** The core's window takes a hit now: open and its hit not spent. */
const windowOpen = (v: Record<string, number>): boolean => !!v.wo && !v.wh;
/** The core is charmed (phase 1 under the rule). */
const charmed = (world: World, v: Record<string, number>): boolean => warlockCharmOn(world) && (v.phase ?? 1) < 2;
/** `e` is the warlock's core under the charm now (the refusal `spellbound`). */
export const warlockSpellbound = (world: World, e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === WARLOCK && charmed(world, e.vars);
/** `e` is the warlock's core out of his window now, his charm gone (the refusal `outOfWindow`). */
export const warlockShut = (world: World, e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === WARLOCK && warlockCharmOn(world) && !charmed(world, e.vars) && !windowOpen(e.vars);
/**
 * `e` is the warlock's core closed now to every source but a shove's strike — charmed, or out of his window (its hit spent): the
 * highlight's pierce, seal, return run and end's shadows pass it by, as the dash does (review 21.10.2026).
 */
export const warlockClosed = (world: World, e: Pick<Enemy, 'kind' | 'vars'>): boolean => warlockSpellbound(world, e) || warlockShut(world, e);

/**
 * A hit of `source` on `e` now (world.ts `damageEnemy`, the dash's strike, the pierce's): true — it does not land. Charmed — only a
 * shove's strike lands (event `warlockCharm` `block`, once a tick: «звон»). His charm gone — a shove's strike lands (the window aside);
 * any other in the window's one hit (held for the hero's chain or released move; event `warlockWindow` `hit`), else not (`block`). Any
 * other enemy, the frame or the rule off — false, nothing changes.
 */
export function warlockWards(world: World, e: Enemy, source: string): boolean {
  if (e.kind !== WARLOCK || !warlockCharmOn(world) || source === SHOVE_SOURCE) return false;
  const v = e.vars;
  if (charmed(world, v)) {
    if (v.wb !== world.tick) { v.wb = world.tick; world.events.push({ type: 'warlockCharm', action: 'block', id: e.id, source, x: e.x, y: e.y }); }
    return true;
  }
  const held = !!v.wr || (!world.move && world.chain.some(l => l.kind === 'enemy' && l.id === e.id));
  if (windowOpen(v) && (!held || OWN_SOURCES.includes(source))) {
    v.wh = 1;
    world.events.push({ type: 'warlockWindow', action: 'hit', id: e.id, source, x: e.x, y: e.y });
    return false;
  }
  if (v.wb !== world.tick) { v.wb = world.tick; world.events.push({ type: 'warlockWindow', action: 'block', id: e.id, source, x: e.x, y: e.y }); }
  return true;
}

/** The release of a move whose plan strikes the core (`ids` — the bodies it strikes): the window's hit is held for it until it is over. */
export function warlockReserve(world: World, ids: readonly number[]): void {
  const core = warlockCore(world);
  if (core && warlockCharmOn(world) && windowOpen(core.vars) && ids.includes(core.id)) core.vars.wr = 1;
}

/** The core's link in the drawn chain while his window is open: its index and the seconds before the window ends (and drops it). */
export function warlockLinkDrop(world: World, chain: readonly { kind: string; id: number }[]): { index: number; left: number } | null {
  const core = warlockCore(world);
  if (!core || !warlockCharmOn(world) || !core.vars.wo) return null;
  const index = chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  return index >= 0 ? { index, left: Math.max(0, core.vars.wl ?? 0) } : null;
}

function openWindow(world: World, core: Enemy): void {
  const v = core.vars;
  v.wo = 1; v.wl = windowOf(world);
  delete v.wh;
  world.events.push({ type: 'warlockWindow', action: 'open', id: core.id, x: core.x, y: core.y });
}

/** The window ends (no move of the hero runs): the core in the drawn chain drops out of it with the links after it. */
function closeWindow(world: World, core: Enemy): void {
  const v = core.vars;
  delete v.wo; delete v.wl; delete v.wh;
  world.events.push({ type: 'warlockWindow', action: 'close', id: core.id, x: core.x, y: core.y });
  const index = world.chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  if (index < 0) return;
  const dropped = world.chain.slice(index).map(l => l.id);
  world.chain = world.chain.slice(0, index);
  delete world.chainClosed;
  world.events.push({ type: 'warlockWindow', action: 'unlink', id: core.id, x: core.x, y: core.y, dropped });
}

// ---- «Перенос» ----

/** The candle nearest `p` (its index; none — -1). */
function nearestCandle(candles: readonly Vec[], p: Vec): number {
  let best = -1, bestD = Infinity;
  candles.forEach((c, i) => { const d = dist(c, p); if (d < bestD - 1e-9) { best = i; bestD = d; } });
  return best;
}

/**
 * The target of a «Перенос» (spec 6.3): one of the candles other than his, by the stream `behavior:warlock` — not within `CANDLE_NEAR`
 * of the hero, in phase 1 not the one nearest the hero; none of them left — any other candle. One draw (none with a single choice).
 */
function pickCandle(world: World, core: Enemy): number {
  const candles = candlesOf(world), here = core.vars.ci ?? -1, hero = world.hero;
  const others = candles.map((_, i) => i).filter(i => i !== here);
  if (!others.length) return here;
  const near = (core.vars.phase ?? 1) < 2 ? nearestCandle(candles, hero) : -1;
  const fit = others.filter(i => i !== near && dist(candles[i], hero) >= CANDLE_NEAR);
  const pool = fit.length ? fit : others;
  return pool.length === 1 ? pool[0] : pool[Math.floor(world.rng.stream(STREAM).next() * pool.length) % pool.length];
}

/** The sign of the next «Перенос» begins: its candle chosen now (v1: in phase 2 every second, in phase 3 each — the rune by the hero). */
function markShift(world: World, core: Enemy): void {
  if (warlockV1On(world) && markBlink(world, core)) return;
  const v = core.vars, target = pickCandle(world, core), c = candlesOf(world)[target];
  v.tg = target + 1;
  world.events.push({ type: 'warlockShift', action: 'mark', id: core.id, candle: target, x: c?.x ?? core.x, y: c?.y ?? core.y });
}

/** He arrives at the marked candle; in phase 2 the window opens. The next shift's timer. */
function arrive(world: World, core: Enemy): void {
  // v1: a volley still winding up where he stood is dropped (its lines were his spot's: the shift of phase 2's start cut it short).
  if (warlockV1On(world)) dropVolley(core);
  if (core.vars.bk) { arriveBlink(world, core); return; }
  const v = core.vars, target = (v.tg ?? 0) - 1, c = candlesOf(world)[target];
  delete v.tg; delete v.sg;
  v.fs = 1;
  if (c) { v.ci = target; v.hx = c.x; v.hy = c.y; core.x = c.x; core.y = c.y; }
  world.events.push({ type: 'warlockShift', action: 'arrive', id: core.id, candle: target, x: core.x, y: core.y });
  const two = (v.phase ?? 1) >= 2;
  v.sh = (v.phase ?? 1) >= 3 ? shiftRageOf(world) : two ? shiftFastOf(world) : shiftOf(world);
  if (two && warlockCharmOn(world)) openWindow(world, core);
}

// ---- The conductor ----

/**
 * After the hero's move: the window closes when its hit landed or its time is out — a thing's slide does not hold it (design 21.10.2026:
 * the window is time, only the hero's move stops its count). After the move and every slide: his wardrobe gone — phase 2.
 */
function settle(world: World, core: Enemy, busy: boolean): void {
  const v = core.vars;
  delete v.wr;
  if (v.wo && (v.wh || (v.wl ?? 0) <= TIME_EPS)) closeWindow(world, core);
  if (busy) return;
  if ((v.phase ?? 1) < 2 && v.wd && !warlockWardrobe(world, core)) {
    v.phase = 2;
    if (warlockCharmOn(world)) world.events.push({ type: 'warlockCharm', action: 'broken', id: core.id, x: core.x, y: core.y });
    world.events.push({ type: 'bossPhase', id: core.id, phase: 2 });
    // A «Перенос» at once: its sign now, of the common length (a sign burning keeps its candle and its time).
    if (!v.tg) { v.sh = SHIFT_SIGN; v.fs = 1; }
    // v1: the rug's count starts; the call keeps its time, at most the period of phase 2.
    if (warlockV1On(world)) { v.rt = rugPeriodOf(world, 2); v.zt = Math.min(v.zt ?? SUMMON_FIRST, summonPeriodOf(world)); }
  }
  // v1: phase 3 «ярость» — phase 2 and `RAGE_PLATES` plates or fewer; the shift and the rug come no later than their rage periods.
  if (warlockV1On(world) && v.phase === 2 && (core.armor?.plates ?? 0) <= RAGE_PLATES) {
    v.phase = 3;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 3 });
    if (!v.tg && !v.bk) v.sh = Math.min(v.sh ?? 0, shiftRageOf(world));
    v.rt = Math.min(v.rt ?? 0, rugPeriodOf(world, 3));
  }
}

/** The core marks his wardrobe: the nearest wardrobe not marked (once; a wardrobe gone before — none). */
function markWardrobe(world: World, core: Enemy): void {
  const v = core.vars;
  v.wd = 1;
  let best: Enemy | undefined;
  for (const e of world.enemies) if (e.kind === WARDROBE && e.vars.wl === undefined && (!best || dist(e, core) < dist(best, core) - 1e-9)) best = e;
  if (best) best.vars.wl = core.id;
}

/** The conductor of the core (the group step, before anyone moves). */
function conduct(world: World, core: Enemy, dt: number): void {
  const v = core.vars, busy = !!world.move || !!world.shoves, one = warlockV1On(world);
  if (!v.wd) markWardrobe(world, core);
  if (!world.move) settle(world, core, busy);
  if (one) noteStep(world, core);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.wo && !world.move) v.wl = Math.max(0, (v.wl ?? 0) - dt);
  if (one && v.fw !== undefined) flashStep(world, core, dt);
  v.sh = Math.max(0, (v.sh ?? FIRST_SHIFT) - dt);
  const sign = v.fs ? SHIFT_SIGN : FIRST_SHIFT_SIGN;
  if (!v.tg && !v.bk && v.sh <= sign + TIME_EPS && candlesOf(world).length > 1) { v.sg = sign; markShift(world, core); }
  if ((v.tg || v.bk) && v.sh <= TIME_EPS && !busy) arrive(world, core);
  if (one) { staffMoves(world, core, dt); v.px = world.hero.x; v.py = world.hero.y; }
}

/** The body holds its spot (`hx`, `hy` — taken on its first step): no walk, no knockback. */
function holdSpot(e: Enemy): void {
  const v = e.vars;
  if (v.hx === undefined) { v.hx = e.x; v.hy = e.y; }
  e.x = v.hx; e.y = v.hy; e.knock = 0;
}

// ---- Колдун v1 (task 55 §23) ----

/** The hero's last step (v1): his move from the last tick, a crumb aside; the rug's pull is never a step (taken after it). */
function noteStep(world: World, core: Enemy): void {
  const v = core.vars, hero = world.hero;
  if (v.px !== undefined) {
    const dx = hero.x - v.px, dy = hero.y - v.py, d = dhypot(dx, dy);
    if (d >= STEP_MIN) { v.lx = dx / d; v.ly = dy / d; }
  }
  v.px = hero.x; v.py = hero.y;
}

/** A point the core may arrive at: no wall, edge or thing under its body. */
function blinkFree(world: World, core: Enemy, q: Vec): boolean {
  const r = bodyRadiusOf(world.params, core);
  if (blockedAt(q, r, world.arena, false)) return false;
  return !world.enemies.some(e => e !== core && kindOf(e).thing && dist(e, q) < r + bodyRadiusOf(world.params, e));
}

/**
 * The point of «Перенос к герою» (spec 23.3): `BLINK_RADIUS` from the hero behind his last step (none yet — away from the core); taken
 * — the nearest free point on that circle (turns of `BLINK_TURN`, the positive side first at a tie). Null — none free. No draw.
 */
export function blinkPoint(world: World, core: Enemy): Vec | null {
  const v = core.vars, hero = world.hero;
  let fx = v.lx, fy = v.ly;
  if (fx === undefined) { const d = dist(core, hero) || 1; fx = (core.x - hero.x) / d; fy = (core.y - hero.y) / d; }
  const back = datan2(-fy, -fx);
  for (let k = 0; k * BLINK_TURN <= Math.PI + 1e-9; k++) {
    for (const side of k ? [1, -1] : [1]) {
      const a = back + side * k * BLINK_TURN, q = { x: hero.x + dcos(a) * BLINK_RADIUS, y: hero.y + dsin(a) * BLINK_RADIUS };
      if (blinkFree(world, core, q)) return q;
    }
  }
  return null;
}

/** v1: the sign of a «Перенос» to the hero, when this one is (phase 3 — each, phase 2 — every second); false — a candle's (v0). */
function markBlink(world: World, core: Enemy): boolean {
  const v = core.vars, phase = v.phase ?? 1;
  if (phase < 2) return false;
  if (phase === 2) { v.sn = (v.sn ?? 0) + 1; if (v.sn % 2) return false; }
  const q = blinkPoint(world, core);
  if (!q) return false;
  v.bk = 1; v.bx = q.x; v.by = q.y;
  world.events.push({ type: 'warlockShift', action: 'mark', id: core.id, candle: -1, x: q.x, y: q.y });
  world.events.push({ type: 'bossMove', id: core.id, move: 'blink', stage: 'start' });
  return true;
}

/** He arrives at the rune: «Вспышка посоха» winds up (the window after it); phase 3 — the ring of orbs too. */
function arriveBlink(world: World, core: Enemy): void {
  const v = core.vars;
  delete v.bk; delete v.sg;
  v.fs = 1; v.ci = -1;
  v.hx = v.bx; v.hy = v.by; core.x = v.bx; core.y = v.by;
  delete v.bx; delete v.by;
  // A hero who walked onto the rune is put out of the solid body at once (its edge; nothing on an arena without solid bodies).
  pushOutOfSolids(world, world.hero);
  world.events.push({ type: 'warlockShift', action: 'arrive', id: core.id, candle: -1, x: core.x, y: core.y });
  world.events.push({ type: 'bossMove', id: core.id, move: 'blink', stage: 'hit' });
  v.sh = (v.phase ?? 1) >= 3 ? shiftRageOf(world) : shiftFastOf(world);
  v.fw = FLASH_WINDUP;
  world.events.push({ type: 'bossMove', id: core.id, move: 'flash', stage: 'start' });
  if ((v.phase ?? 1) >= 3 && v.ow === undefined) beginVolley(world, core, true);
}

/** «Вспышка посоха» winds up; at its end the hero within its ring is hurt (a shield takes it), then the window opens. */
function flashStep(world: World, core: Enemy, dt: number): void {
  const v = core.vars;
  v.fw -= dt;
  if (v.fw > TIME_EPS) return;
  delete v.fw;
  world.events.push({ type: 'bossMove', id: core.id, move: 'flash', stage: 'hit' });
  if (dist(world.hero, core) <= FLASH_RADIUS + heroRadius(world.params)) {
    if (canBeHurt(world)) hurtHero(world, core, FLASH_DAMAGE, FLASH_SOURCE);
    else noteBlock(world, core.x, core.y, FLASH_SOURCE, core.id);
  }
  if (world.status === 'playing' && (v.phase ?? 1) >= 2 && warlockCharmOn(world)) openWindow(world, core);
}

/** A line of a volley from the core's centre along (dx, dy): to the first wall (or the edge), the orb's flight at most. */
function orbLine(world: World, x: number, y: number, dx: number, dy: number): number {
  const most = ORB_SPEED * ORB_LIFE;
  for (let t = LINE_STEP; t < most; t += LINE_STEP) if (blockedAt({ x: x + dx * t, y: y + dy * t }, 0.02, world.arena, false)) return t;
  return most;
}

/** The volley's windup begins: its colour drawn, its lines fixed now (a fan through the hero, or the ring with a line through him). */
function beginVolley(world: World, core: Enemy, ring: boolean): void {
  const v = core.vars, hero = world.hero, colors = palette(world);
  const color = colors[Math.floor(world.rng.stream(STREAM).next() * colors.length) % colors.length];
  const d = dist(core, hero), mx = d > 1e-6 ? (hero.x - core.x) / d : 0, my = d > 1e-6 ? (hero.y - core.y) / d : 1;
  const turns = ring ? Array.from({ length: ORB_RING }, (_, i) => i * 2 * Math.PI / ORB_RING) : [0, ORB_SPREAD * Math.PI / 180, -ORB_SPREAD * Math.PI / 180];
  turns.forEach((turn, i) => {
    const c = dcos(turn), s = dsin(turn), dx = mx * c - my * s, dy = mx * s + my * c;
    v[`g${i}x`] = dx; v[`g${i}y`] = dy; v[`g${i}l`] = orbLine(world, core.x, core.y, dx, dy);
  });
  const windup = ORB_WINDUP * (v.of ? 1 : ORB_FIRST_FACTOR);
  Object.assign(v, { on: turns.length, gx: core.x, gy: core.y, oc: color, ok: ring ? 1 : 0, ow: windup, owt: windup, of: 1 });
  if (!ring) v.ot = orbPeriodOf(world);
  world.events.push({ type: 'bossMove', id: core.id, move: 'orbs', stage: 'start' });
}

/** Where an orb of the volley leaves (the core's edge, along its line) — the lines' and the orbs' start. */
const orbStart = (world: World, core: Enemy): number => bodyRadiusOf(world.params, core) + orbRadius(world) + 0.05;
const orbRadius = (world: World): number => bodyRadiusOf(world.params, { kind: WARLOCK_ORB } as Enemy);

/** The windup ends: the orbs leave along the fixed lines. */
function looseVolley(world: World, core: Enemy): void {
  const v = core.vars, n = v.on ?? 0;
  for (let i = 0; i < n; i++) {
    const dx = v[`g${i}x`], dy = v[`g${i}y`], off = orbStart(world, core);
    if (world.status === 'playing' && off < v[`g${i}l`]) {
      const orb = spawnEnemy(world, { x: v.gx + dx * off, y: v.gy + dy * off }, v.oc, 0, WARLOCK_ORB);
      orb.vars.dx = dx; orb.vars.dy = dy; orb.vars.ol = ORB_LIFE;
    }
  }
  dropVolley(core);
  world.events.push({ type: 'bossMove', id: core.id, move: 'orbs', stage: 'hit' });
}

/** The volley's windup state goes (none — nothing). */
function dropVolley(core: Enemy): void {
  const v = core.vars;
  if (v.ow === undefined) return;
  for (let i = 0; i < (v.on ?? 0); i++) { delete v[`g${i}x`]; delete v[`g${i}y`]; delete v[`g${i}l`]; }
  delete v.ow; delete v.owt; delete v.on; delete v.gx; delete v.gy; delete v.ok; delete v.oc;
}

/** The rugs of the arena (none — no rug). */
const rugsOf = (world: World): readonly { x: number; y: number; w: number; h: number }[] => world.arena.warlock?.rugs ?? [];
/** `p`'s centre stands on a rug. */
export function onRug(world: World, p: Vec): boolean {
  return rugsOf(world).some(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

/** The rug's windup ends: the bodies on a rug now slide (the hero not in his own move; not the things, the core, a frozen body). */
function rugHit(world: World, core: Enemy): void {
  const v = core.vars;
  delete v.rw;
  world.events.push({ type: 'bossMove', id: core.id, move: 'rug', stage: 'hit' });
  if (!world.move && onRug(world, world.hero)) v.rh = 1;
  for (const e of world.enemies) if (e !== core && !kindOf(e).thing && !enemyFrozen(e) && onRug(world, e)) e.vars.wp = 1;
  v.rs = RUG_SLIDE;
}

/** The slide: `RUG_PULL` over `RUG_SLIDE` s towards the core's centre, out of walls and solid bodies; the drawn chain keeps its reach. */
function rugSlide(world: World, core: Enemy, dt: number): void {
  const v = core.vars, step = Math.min(v.rs, dt) * RUG_PULL / RUG_SLIDE;
  const pull = (b: Vec): void => {
    const dx = core.x - b.x, dy = core.y - b.y, d = dhypot(dx, dy), go = Math.min(step, d);
    if (go > 1e-9) { b.x += dx / d * go; b.y += dy / d * go; }
  };
  if (v.rh && !world.move) {
    pull(world.hero);
    pushOutOfObstacles(world.hero, heroRadius(world.params), world.arena);
    pushOutOfSolids(world, world.hero);
  }
  for (const e of world.enemies) {
    if (!e.vars.wp || enemyFrozen(e) || (world.move && linkedNow(world, e))) continue;
    pull(e);
    pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
  }
  const dropped = dropBeyondReach(world);
  if (dropped.length) world.events.push({ type: 'warlockRug', action: 'unlink', id: core.id, x: world.hero.x, y: world.hero.y, dropped, refusal: 'far' });
  v.rs -= dt;
  if (v.rs > TIME_EPS) return;
  delete v.rs; delete v.rh;
  for (const e of world.enemies) delete e.vars.wp;
}

/** His formations alive (standing or at their markers): of `f1`, `f2`. */
function formationsAlive(world: World, core: Enemy): number {
  const v = core.vars;
  return [v.f1, v.f2].filter(f => f !== undefined && (world.enemies.some(e => e.vars.fm === f) || world.markers.some(m => m.formation === f))).length;
}

/** The candle of «Зов строя»: the farthest from the hero, not his own (none — his spot). */
function summonCandle(world: World, core: Enemy): Vec {
  const candles = candlesOf(world), here = core.vars.ci ?? -1;
  let best: Vec | null = null, bestD = -1;
  candles.forEach((c, i) => { const d = dist(c, world.hero); if (i !== here && d > bestD + 1e-9) { best = c; bestD = d; } });
  return best ?? { x: core.x, y: core.y };
}

/** The staff raised ends: `SUMMON_SIZE` markers of one colour across the way to the hero at the farthest candle (`formation` — his). */
function summonHit(world: World, core: Enemy): void {
  const v = core.vars, at = summonCandle(world, core), colors = palette(world);
  delete v.zw;
  const color = colors[Math.floor(world.rng.stream(STREAM).next() * colors.length) % colors.length];
  const dx = world.hero.x - at.x, dy = world.hero.y - at.y, d = dhypot(dx, dy) || 1, px = -dy / d, py = dx / d;
  const formation = world.nextId++;
  for (let k = 0; k < SUMMON_SIZE; k++) {
    const off = (k - (SUMMON_SIZE - 1) / 2) * GUARD_STEP;
    world.markers.push({ id: world.nextId++, kind: 'basic', x: at.x + px * off, y: at.y + py * off, color, hp: 0, timeLeft: SUMMON_MARK, total: SUMMON_MARK, plain: true, formation });
  }
  if (v.f1 !== undefined && v.f2 !== undefined) v.f1 = v.f2;
  if (v.f1 === undefined) v.f1 = formation; else v.f2 = formation;
  world.events.push({ type: 'bossMove', id: core.id, move: 'summon', stage: 'hit' });
}

/** A staff move runs: the volley's windup, the rug's windup or slide, the staff raised, the flash. */
const staffBusy = (v: Record<string, number>): boolean => v.ow !== undefined || v.rw !== undefined || v.rs !== undefined || v.zw !== undefined || v.fw !== undefined;

/** v1: the staff's moves — their windups and timers, then the one due (one at a time, none over a sign or the next arrival). */
function staffMoves(world: World, core: Enemy, dt: number): void {
  const v = core.vars, phase = v.phase ?? 1, hero = world.hero;
  if (v.ow !== undefined) { v.ow -= dt; if (v.ow <= TIME_EPS) looseVolley(world, core); }
  if (v.rw !== undefined) { v.rw -= dt; if (v.rw <= TIME_EPS) rugHit(world, core); }
  if (v.rs !== undefined) rugSlide(world, core, dt);
  if (v.zw !== undefined) { v.zw -= dt; if (v.zw <= TIME_EPS) summonHit(world, core); }
  if (world.status !== 'playing') return;
  if (phase < 3) { v.ot = Math.max(0, (v.ot ?? orbPeriodOf(world)) - dt); v.zt = Math.max(0, (v.zt ?? SUMMON_FIRST) - dt); }
  if (phase >= 2) v.rt = Math.max(0, (v.rt ?? rugPeriodOf(world, phase)) - dt);
  if (staffBusy(v) || v.tg || v.bk) return;
  const before = (t: number): boolean => (v.sh ?? 0) > t + TIME_EPS;
  if (phase < 3 && v.ot <= TIME_EPS && before(ORB_WINDUP * (v.of ? 1 : ORB_FIRST_FACTOR)) && dist(core, hero) > ORB_NEAR
    && lineOfSight(core, hero, world.arena) && world.enemies.filter(e => e.kind === WARLOCK_ORB).length + ORB_FAN <= ORB_MAX) {
    beginVolley(world, core, false);
    return;
  }
  if (phase >= 2 && v.rt <= TIME_EPS && before(RUG_WINDUP + RUG_SLIDE) && onRug(world, hero)) {
    v.rw = RUG_WINDUP; v.rt = rugPeriodOf(world, phase);
    world.events.push({ type: 'bossMove', id: core.id, move: 'rug', stage: 'start' });
    return;
  }
  if (phase < 3 && v.zt <= TIME_EPS && before(SUMMON_WINDUP)) {
    v.zt = phase >= 2 ? summonPeriodOf(world) : SUMMON_CHARM_PERIOD;
    if (formationsAlive(world, core) >= SUMMON_MAX) return;
    v.zw = SUMMON_WINDUP;
    world.events.push({ type: 'bossMove', id: core.id, move: 'summon', stage: 'start' });
  }
}

// ---- The orb (`warlock-orb`) ----

/** It goes out: off the arena with no kill (event `warlockOrb` `out`). */
export function orbOut(world: World, e: Enemy, why: 'life' | 'wall' | 'touch' | 'block' | 'thing'): void {
  const i = world.enemies.indexOf(e);
  if (i < 0) return;
  world.enemies.splice(i, 1);
  world.events.push({ type: 'warlockOrb', action: 'out', id: e.id, x: e.x, y: e.y, why });
}

function stepOrb(world: World, e: Enemy, dt: number): boolean {
  const v = e.vars, hero = world.hero;
  // A link of the drawn chain or of the dash stands: no flight, no clock, no touch (the wisp's rule).
  if (linkedNow(world, e) || world.status !== 'playing') return true;
  v.ol -= dt;
  if (v.ol <= TIME_EPS) { orbOut(world, e, 'life'); return true; }
  e.x += v.dx * ORB_SPEED * dt; e.y += v.dy * ORB_SPEED * dt;
  if (blockedAt(e, bodyRadiusOf(world.params, e), world.arena, false)) { orbOut(world, e, 'wall'); return true; }
  if (dist(e, hero) > touchReachOf(world, e)) return true;
  // The hit first (it stands on the arena at its hit), then it goes out; a dash or a jump passes through it.
  if (canBeHurt(world)) { hurtHero(world, e, ORB_DAMAGE, ORB_SOURCE); orbOut(world, e, 'touch'); }
  else if (heroGuarded(world)) { noteBlock(world, e.x, e.y, ORB_SOURCE, e.id); orbOut(world, e, 'block'); }
  return true;
}

registerBehavior({
  id: WARLOCK_ORB,
  step: stepOrb,
  // Its touch is its own (it goes out with it): the common touch never counts it; the crowd neither pushes it nor is pushed by it.
  touches: () => false,
  crowd: () => 'ghost',
});

registerEnemyKind({
  id: WARLOCK_ORB, behavior: WARLOCK_ORB, hp: () => 0, speed: () => ORB_SPEED,
  bodyScale: 0.6, artScale: 0.7, touchDamage: () => ORB_DAMAGE, mass: () => 1, spread: false, chainable: true, hitSource: ORB_SOURCE,
  noElite: true, noCrowd: true,
});

registerBehavior({
  id: WARLOCK,
  onSpawn(world, e) {
    if (!frameOn(world)) return;
    const plates = platesOf(world.params);
    e.armor = { plates, max: plates, boss: true };
    Object.assign(e.vars, { born: world.time, phase: 1, sh: FIRST_SHIFT, ci: nearestCandle(candlesOf(world), e) });
    // v1: the fan's and the call's first times.
    if (warlockV1On(world)) Object.assign(e.vars, { ot: orbPeriodOf(world), zt: SUMMON_FIRST });
  },
  step(world, e) {
    if (!frameOn(world)) return false;
    holdSpot(e);
    return true;
  },
  // Task 48, design 24.10 (`Params.trollSolid`, the boss's bodies): the core is solid for the hero.
  solid: world => frameOn(world) && !!world.params.trollSolid,
  onDeath(world) {
    if (frameOn(world) && bossClearsOn(world) && !world.bossCleared) bossClear(world);
  },
  beforeStep(world, members, dt) {
    if (!frameOn(world)) return;
    for (const e of members) if (world.enemies.includes(e)) conduct(world, e, dt);
  },
});

registerEnemyKind({
  id: WARLOCK,
  behavior: WARLOCK,
  speedClass: 'normal',
  hp: params => hpOf(params),
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  // Held at his spot by the frame (without it — a plain enemy of mass 1).
  mass: world => (frameOn(world) ? PINNED_MASS : 1),
  spread: false,
  chainable: true,
  hitSource: WARLOCK_SOURCE,
  noElite: true,
});

// ---- The warlock for the view (read only) ----

/**
 * The warlock now: his core (`id`, `x`, `y`), the phase (1 — charmed while his wardrobe stands), his wardrobe (`wardrobe` — its id, the
 * charm's beam), the candles and his (`candle`), the next «Перенос» (`shift`: the target candle and the sign's share 0…1, or null —
 * none burning), his window (`open` — the window's hit lands now, `left` — its seconds, `hit` — it landed), `rule` — the charm and the
 * windows rule this world. Null — no warlock on the arena or the frame is off.
 */
export function warlockState(world: World): {
  id: number; x: number; y: number; phase: number; rule: boolean; spellbound: boolean; wardrobe: number | null; candles: Vec[]; candle: number;
  shift: { candle: number; progress: number } | null; window: { open: boolean; left: number; hit: boolean } | null;
} | null {
  const core = warlockCore(world);
  if (!core || !frameOn(world)) return null;
  const v = core.vars, sign = v.sg ?? SHIFT_SIGN, ward = warlockWardrobe(world, core);
  return {
    id: core.id, x: core.x, y: core.y, phase: v.phase ?? 1, rule: warlockCharmOn(world), spellbound: warlockSpellbound(world, core),
    wardrobe: ward ? ward.id : null, candles: candlesOf(world).map(c => ({ x: c.x, y: c.y })), candle: v.ci ?? -1,
    shift: v.tg ? { candle: v.tg - 1, progress: Math.max(0, Math.min(1, 1 - (v.sh ?? 0) / Math.max(1e-6, sign))) } : null,
    window: v.wo ? { open: windowOpen(v), left: Math.max(0, v.wl ?? 0), hit: !!v.wh } : null,
  };
}


/**
 * Колдун v1 for the view (read only; null — no warlock, the frame off or v1 off): the phase 3 flag (`rage`); the volley winding up
 * (`orbs`: its lines from the core's edge to the wall or the flight's end, its colour, the share 0…1 gone, `ring`); the rugs and
 * their move (`rug`: `windup` — its share 0…1, the edge's wave and the arrows; `sliding`); the rune of «Перенос к герою» (`rune`:
 * the point, its radius and the sign's share); the flash winding up (`flash`: the ring's centre, radius and share); the call
 * (`summon`: the staff raised — its share and the candle its markers will stand at; the markers themselves are `world.markers` with
 * `formation` in `formations`).
 */
export function warlockV1State(world: World): {
  rage: boolean;
  orbs: { lines: { x0: number; y0: number; x1: number; y1: number }[]; color: number; progress: number; ring: boolean } | null;
  rugs: { x: number; y: number; w: number; h: number }[]; rug: { windup: number | null; sliding: boolean; to: Vec };
  rune: { x: number; y: number; r: number; progress: number } | null;
  flash: { x: number; y: number; r: number; progress: number } | null;
  summon: { progress: number; at: Vec } | null; formations: number[];
} | null {
  const core = warlockCore(world);
  if (!core || !warlockV1On(world)) return null;
  const v = core.vars, share = (left: number, total: number): number => Math.max(0, Math.min(1, 1 - left / Math.max(1e-6, total)));
  const lines = v.ow === undefined ? [] : Array.from({ length: v.on ?? 0 }, (_, i) => {
    const dx = v[`g${i}x`], dy = v[`g${i}y`], off = orbStart(world, core), len = v[`g${i}l`];
    return { x0: v.gx + dx * off, y0: v.gy + dy * off, x1: v.gx + dx * len, y1: v.gy + dy * len };
  });
  return {
    rage: (v.phase ?? 1) >= 3,
    orbs: v.ow === undefined ? null : { lines, color: v.oc, progress: share(v.ow, v.owt), ring: !!v.ok },
    rugs: rugsOf(world).map(r => ({ ...r })), rug: { windup: v.rw === undefined ? null : share(v.rw, RUG_WINDUP), sliding: v.rs !== undefined, to: { x: core.x, y: core.y } },
    rune: v.bk ? { x: v.bx, y: v.by, r: RUNE_RADIUS, progress: share(v.sh ?? 0, v.sg ?? SHIFT_SIGN) } : null,
    flash: v.fw === undefined ? null : { x: core.x, y: core.y, r: FLASH_RADIUS, progress: share(v.fw, FLASH_WINDUP) },
    summon: v.zw === undefined ? null : { progress: share(v.zw, SUMMON_WINDUP), at: summonCandle(world, core) },
    formations: [v.f1, v.f2].filter((f): f is number => f !== undefined),
  };
}
