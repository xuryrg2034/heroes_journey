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
 */
import { dist, type Vec } from '../geometry';
import { type Params } from '../params';
import { enemyFrozen, type Enemy, type World } from '../world';
import { bossClear, bossClearsOn } from './jailer';
import { registerBehavior, registerEnemyKind } from './kinds';

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
/** His arena's crowd (spec 6.5: the Troll's number after his grid, a hypothesis). */
export const WARLOCK_CROWD = 0.45;
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

const frameOn = (world: World): boolean => !!world.params.bossFrame;
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

/** The sign of the next «Перенос» begins: its candle chosen now. */
function markShift(world: World, core: Enemy): void {
  const v = core.vars, target = pickCandle(world, core), c = candlesOf(world)[target];
  v.tg = target + 1;
  world.events.push({ type: 'warlockShift', action: 'mark', id: core.id, candle: target, x: c?.x ?? core.x, y: c?.y ?? core.y });
}

/** He arrives at the marked candle; in phase 2 the window opens. The next shift's timer. */
function arrive(world: World, core: Enemy): void {
  const v = core.vars, target = (v.tg ?? 0) - 1, c = candlesOf(world)[target];
  delete v.tg; delete v.sg;
  v.fs = 1;
  if (c) { v.ci = target; v.hx = c.x; v.hy = c.y; core.x = c.x; core.y = c.y; }
  world.events.push({ type: 'warlockShift', action: 'arrive', id: core.id, candle: target, x: core.x, y: core.y });
  const two = (v.phase ?? 1) >= 2;
  v.sh = two ? shiftFastOf(world) : shiftOf(world);
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
  const v = core.vars, busy = !!world.move || !!world.shoves;
  if (!v.wd) markWardrobe(world, core);
  if (!world.move) settle(world, core, busy);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.wo && !world.move) v.wl = Math.max(0, (v.wl ?? 0) - dt);
  v.sh = Math.max(0, (v.sh ?? FIRST_SHIFT) - dt);
  const sign = v.fs ? SHIFT_SIGN : FIRST_SHIFT_SIGN;
  if (!v.tg && v.sh <= sign + TIME_EPS && candlesOf(world).length > 1) { v.sg = sign; markShift(world, core); }
  if (v.tg && v.sh <= TIME_EPS && !busy) arrive(world, core);
}

/** The body holds its spot (`hx`, `hy` — taken on its first step): no walk, no knockback. */
function holdSpot(e: Enemy): void {
  const v = e.vars;
  if (v.hx === undefined) { v.hx = e.x; v.hy = e.y; }
  e.x = v.hx; e.y = v.hy; e.knock = 0;
}

registerBehavior({
  id: WARLOCK,
  onSpawn(world, e) {
    if (!frameOn(world)) return;
    const plates = platesOf(world.params);
    e.armor = { plates, max: plates, boss: true };
    Object.assign(e.vars, { born: world.time, phase: 1, sh: FIRST_SHIFT, ci: nearestCandle(candlesOf(world), e) });
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
