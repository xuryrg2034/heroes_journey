/**
 * Task 60а «Замок: гости» (design 17.10.2026, docs/design-notes/task-60-castle-enemies.md; docs/realtime-elite-behaviors.md, «Замок:
 * гости»): five kinds of the castle that come only by an arena's template (the sandbox's group «Замок · гости»; the run is task 60б).
 * They take the castle's laws as they are (task 55: the thing — a colourless last link, the shove; the first body of the rook's line)
 * and the layer of shots of task 57а (sim/shots.ts: the arena's timer, the hang, the dash's snuffing; where the spec differs, 57 wins).
 *
 * - **Подсвечник** (`candelabra`, a thing, durability 1): «Вертушка» (`candelabra-spin`) — its rest (`candelabraPeriod`; the first
 *   `CANDELABRA_FIRST` s after it appears) over, the hero within `CANDELABRA_REACH` and in sight, the arena's timer free: the lighting
 *   (`candelabraLight`; the cross of `CROSS_RAYS` rays of `CROSS_FIRES` fires `FIRE_STEP` apart, at 45° to the line to the hero, does not
 *   hurt), then the spin (`candelabraSpin` s at `candelabraTurn` °/s, the way flips every cycle). A fire touching the hero — `candelabraDamage`
 *   (only the hero: through bodies and things, design В4; the pass does not put the fires out, В5; no cold stops it, В11). A shove topples
 *   it (sim/shove.ts `toppleOf`).
 * - **Ферзь** (`queen`, HP `QUEEN_HP`, mass 3, no walk): «Ход ферзя» — after its rest one of the 8 ways (45° apart) whose end is nearest
 *   the band `QUEEN_NEAR`…`QUEEN_FAR` from the hero (equal — the smaller index; no random draw): the sign `QUEEN_SIGN` s, then it slides
 *   `queenMove` at `QUEEN_SLIDE`, stopping before a wall or a body (the move never hurts). Then «Звезда ферзя» (`queen-star`) once the
 *   hero is within `QUEEN_REACH` and in sight and the timer is free: the windup (`queenWindup`; the first of a fight ×1.5) with the 8
 *   lines to the first wall fixed at its start; at its end 8 light shots (`star`) hang `STAR_HANG` s at the queen and fly at
 *   `queenShotSpeed`. A star hits the first body (shots.ts): the hero −`queenDamage`, an enemy −1 (not the player's, design В8), a thing
 *   shelters. The rest `queenPeriod` counts from the volley.
 * - **Дворецкий** (`butler`, HP `BUTLER_HP`): keeps `butlerNear`…`butlerFar`; `HANG_DELAY` s after it appears, while no chandelier hangs,
 *   it bows (`BOW_TIME`) and the **chandelier** hangs over the hero (`world.chandelier`, not a body: no link, no shove, no shot meets
 *   it). It floats to the hero at `chandelierSpeed`; every `chandelierDrop` s «Капля воска» (`wax-drop`): a mark `chandelierDropRadius`
 *   under it, fixed, falls in `chandelierDropTime` — the hero in it −`chandelierDropDamage` (only the hero; a jump spares him). The
 *   butler dies (any cause) — «Падение люстры» (`chandelier-fall`): the sign `chandelierFallTime`, the circle `chandelierFallRadius`: the
 *   hero −`chandelierFallDamage`, every enemy −1 (the weak die, the tough lose 1, an elite a plate; things are untouched) — credited as
 *   the butler's death (design В7); the chandelier is gone (В6). Frozen butler — the chandelier stands, its drops wait.
 * - **Полтергейст** (`poltergeist`, HP 0): keeps `POLTERGEIST_NEAR`…`POLTERGEIST_FAR`; its rest (`poltergeistPeriod`) over, it lifts up
 *   to `poltergeistCarry` light things (`LIGHT_THINGS`: the barrel; design В13) within `poltergeistReach` (not sliding, not linked) for
 *   `poltergeistLift` s — a lifted thing is no body (`thingLifted`: the refusal «в движении», a shove passes under it, no cover). Then
 *   «Метание» (`poltergeist-throw`): each thing at the hero's point of its throw (`THROW_GAP` apart; the mark `poltergeistMark`, walls
 *   push it out by `MARK_PUSH`), flying `poltergeistFlight` s over bodies: the hero in the mark −`poltergeistDamage`, enemies −1 (not the
 *   player's); the thing stands there with its durability (В14). Its death while things are held — they drop where they stood, the weak
 *   under them die (credited as its death).
 * - **Шут** (`jester`, HP `JESTER_HP`): keeps `JESTER_NEAR`…`JESTER_FAR`, stands while its ball flies. «Мяч шута» (`jester-ball`): its rest
 *   (`jesterPeriod`) over, the hero not nearer than `jesterNear` and in sight, no ball of its own out, the timer free — the windup
 *   (`jesterWindup`; after a catch `SHORT_WINDUP`), then one ball (`ball`, r `BALL_RADIUS`) at the hero's point at `jesterBall` +
 *   `jesterBallStep` × the catches: through enemies, out at a wall or a thing, −`jesterDamage` to the hero. A pass whose path crosses the
 *   ball reflects it (the drawn chain's plan `reflects`, fixed and done at the release: `reflectBall`): it flies back at `jesterReturn`.
 *   The jester catches `jesterCatches` in a row (a frozen or stunned one never does); the next one strikes it −1 (the player's,
 *   `reflect`) and stuns it (`jesterStun`: it stands, throws nothing) — the count starts again and the rest is full. The count also
 *   starts again `RESET_TIME` s after the last reflection (design В2: a counter, no chance).
 *
 * No random draw anywhere. State: `enemy.vars` (hashed) and `world.chandelier` (absent while none hangs or falls). Events (the view;
 * the rules never read them): `candelabra`, `queen`, `chandelier`, `poltergeist`, `jester` (see `WorldEvent`); the stars and the ball —
 * the layer's `shot`.
 */
import { datan2, dcos, dhypot, dsin } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { addShot, linkedNow, volleyIdle, volleyReady, type Shot } from '../shots';
import { registerShooter } from '../shooterRegistry';
import { isThing, sliding, thingLifted } from '../shove';
import { platesOf } from '../elites';
import { canBeHurt, damageEnemy, enemyFrozen, enemyGroundFactor, enemySpeed, heroGuarded, hurtHero, killEnemy, noteBlock, pushOutOfSolids, type Enemy, type KillCause, type World } from '../world';
import { THING_MASS } from './castle';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

export const CANDELABRA = 'candelabra';
export const QUEEN = 'queen';
export const BUTLER = 'butler';
export const POLTERGEIST = 'poltergeist';
export const JESTER = 'jester';
/** The guests of the castle (spec 1). */
export const CASTLE_GUESTS: readonly string[] = [CANDELABRA, QUEEN, BUTLER, POLTERGEIST, JESTER];
/** Hit sources on the hero (the killer line, the telemetry); the kinds' touches are their ids. */
export const CANDELABRA_SOURCE = 'candelabra-spin';
export const QUEEN_SOURCE = 'queen-star';
export const WAX_SOURCE = 'wax-drop';
export const FALL_SOURCE = 'chandelier-fall';
export const THROW_SOURCE = 'poltergeist-throw';
export const BALL_SOURCE = 'jester-ball';
/** Kills: the weak under the things a dead poltergeist drops; the jester struck by its own reflected ball (the player's). */
export const DROP_SOURCE = 'poltergeist-drop';
export const REFLECT_SOURCE = 'reflect';
// ---- Баланс (гипотезы спеки задачи 60, 17.10.2026; journals without the keys play these) ----
export const CANDELABRA_DURABILITY = 1;
export const CANDELABRA_PERIOD = 5;
export const CANDELABRA_LIGHT = 1;
export const CANDELABRA_SPIN = 4;
export const CANDELABRA_TURN = 60;
export const CANDELABRA_DAMAGE = 1;
/** Its first lighting may begin this long after it appears (game s); the hero within this and in sight. */
export const CANDELABRA_FIRST = 2;
export const CANDELABRA_REACH = 6;
/** The cross: rays, fires a ray, the fires' spacing from the centre and their radius. */
export const CROSS_RAYS = 4;
export const CROSS_FIRES = 4;
export const FIRE_STEP = 0.5;
export const FIRE_RADIUS = 0.15;
export const QUEEN_HP = 2;
export const QUEEN_MASS = 3;
export const QUEEN_MOVE = 4;
export const QUEEN_WINDUP = 1;
export const QUEEN_PERIOD = 4.5;
export const QUEEN_SHOT_SPEED = 6;
export const QUEEN_DAMAGE = 1;
/** The first windup of a fight is this much longer; the first move may begin this long after it appears. */
export const QUEEN_FIRST_FACTOR = 1.5;
export const QUEEN_FIRST = 1.5;
/** «Ход ферзя»: its sign (game s), its speed (units / s), the band from the hero it aims at; the volley with the hero this near. */
export const QUEEN_SIGN = 0.6;
export const QUEEN_SLIDE = 8;
export const QUEEN_NEAR = 4;
export const QUEEN_FAR = 6;
export const QUEEN_REACH = 8;
/** The stars: their radius, their hang before the flight (task 57's pattern), how many. */
export const STAR_RADIUS = 0.15;
export const STAR_HANG = 0.25;
export const QUEEN_STARS = 8;
export const BUTLER_HP = 1;
export const BUTLER_NEAR = 5;
export const BUTLER_FAR = 7;
/** The butler hangs its chandelier this long after it appears (and again whenever none hangs), bowing this long first. */
export const HANG_DELAY = 2;
export const BOW_TIME = 1;
export const CHANDELIER_SPEED = 3;
export const CHANDELIER_DROP = 3;
export const CHANDELIER_DROP_TIME = 0.8;
export const CHANDELIER_DROP_RADIUS = 0.6;
export const CHANDELIER_DROP_DAMAGE = 1;
export const CHANDELIER_FALL_TIME = 0.8;
export const CHANDELIER_FALL_RADIUS = 1;
export const CHANDELIER_FALL_DAMAGE = 2;
export const POLTERGEIST_NEAR = 4;
export const POLTERGEIST_FAR = 6;
export const POLTERGEIST_PERIOD = 6;
export const POLTERGEIST_LIFT = 1;
export const POLTERGEIST_FLIGHT = 0.8;
export const POLTERGEIST_REACH = 4;
export const POLTERGEIST_CARRY = 2;
export const POLTERGEIST_MARK = 0.7;
export const POLTERGEIST_DAMAGE = 2;
/** The things it lifts (design В13: light ones; the armchair of step 2 joins when it exists). */
export const LIGHT_THINGS: readonly string[] = ['barrel', 'armchair'];
/** Its throws are this far apart (game s); walls push a mark out to this radius (spec Р5). */
export const THROW_GAP = 0.3;
export const MARK_PUSH = 0.6;
export const JESTER_HP = 2;
export const JESTER_NEAR = 4;
export const JESTER_FAR = 7;
export const JESTER_PERIOD = 4;
export const JESTER_WINDUP = 0.6;
export const JESTER_BALL = 3;
export const JESTER_BALL_STEP = 1;
export const JESTER_RETURN = 6;
export const JESTER_CATCHES = 2;
export const JESTER_STUN = 2;
export const JESTER_DAMAGE = 1;
export const JESTER_NEAR_THROW = 2;
/** The windup after a catch; the ball's radius; the catches start again this long after the last reflection. */
export const SHORT_WINDUP = 0.3;
/** Its first throw may begin this long after it appears (game s). */
export const JESTER_FIRST = 2;
export const BALL_RADIUS = 0.2;
export const RESET_TIME = 4;
/** A shot flies at most this far (a wall ends it first). */
const SHOT_RANGE = 60;
const LINE_STEP = 0.05;
const TIME_EPS = 1e-9;
/** The 8 ways of the queen (45° apart from the east, clockwise on the screen: y grows down). */
const S = Math.SQRT1_2;
export const QUEEN_WAYS: readonly Vec[] = [{ x: 1, y: 0 }, { x: S, y: S }, { x: 0, y: 1 }, { x: -S, y: S }, { x: -1, y: 0 }, { x: -S, y: -S }, { x: 0, y: -1 }, { x: S, y: -S }];

const num = (world: World, key: keyof World['params'], fallback: number, min = 0): number => Math.max(min, (world.params[key] as number | undefined) ?? fallback);

/** Keeps `near`…`far` from the hero (backs off nearer at its walk, walks up farther): true — it stands or stepped by itself. */
function keep(world: World, e: Enemy, near: number, far: number, dt: number): boolean {
  const hero = world.hero, d = dist(e, hero);
  if (d < near && d > 1e-6) {
    const step = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
    e.x -= (hero.x - e.x) / d * step; e.y -= (hero.y - e.y) / d * step;
    pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
    return true;
  }
  return d <= far;
}

/** Length of a ray from (x, y) along (dx, dy) to the first wall or tree (water and cliffs do not cut it). */
function rayLength(world: World, x: number, y: number, dx: number, dy: number): number {
  for (let t = LINE_STEP; t < SHOT_RANGE; t += LINE_STEP) if (blockedAt({ x: x + dx * t, y: y + dy * t }, 0.02, world.arena, false)) return t;
  return SHOT_RANGE;
}

/** A body the hero's or a shot's way meets now: an enemy that is no lifted thing (the thing stands). */
const bodyNow = (e: Enemy): boolean => !thingLifted(e);

// ---- Подсвечник ----

/** The cross's 16 fires now: per ray, from the centre out. */
function crossFires(e: Enemy): Vec[] {
  const out: Vec[] = [];
  for (let k = 0; k < CROSS_RAYS; k++) {
    const a = e.vars.ca + k * Math.PI / 2, c = dcos(a), s = dsin(a);
    for (let j = 1; j <= CROSS_FIRES; j++) out.push({ x: e.x + c * FIRE_STEP * j, y: e.y + s * FIRE_STEP * j });
  }
  return out;
}

/**
 * The candelabra's cross now (the view): the lighting or the spin, the angle of its first ray (radians), the way (+1 — the angle grows),
 * the share of the phase gone, the fires lit per ray (the lighting: one by one from the centre) and the fires' points. Null — it rests.
 */
export function candelabraCross(world: World, e: Enemy): { phase: 'light' | 'spin'; angle: number; dir: number; progress: number; lit: number; fires: Vec[]; radius: number } | null {
  const v = e.vars;
  if (e.kind !== CANDELABRA || !v.cp || world.status !== 'playing') return null;
  const total = v.cp === 1 ? num(world, 'candelabraLight', CANDELABRA_LIGHT, 0.05) : num(world, 'candelabraSpin', CANDELABRA_SPIN, 0.05);
  const progress = Math.max(0, Math.min(1, 1 - v.ct / total));
  return { phase: v.cp === 1 ? 'light' : 'spin', angle: v.ca, dir: v.cs, progress, lit: v.cp === 1 ? Math.min(CROSS_FIRES, Math.floor(progress * CROSS_FIRES) + 1) : CROSS_FIRES, fires: crossFires(e), radius: FIRE_RADIUS };
}

function beginLight(world: World, e: Enemy): void {
  const v = e.vars, hero = world.hero;
  v.cp = 1; v.ct = num(world, 'candelabraLight', CANDELABRA_LIGHT, 0.05);
  // The rays at 45° to the line to the hero: he stands in the middle of a gap.
  v.ca = datan2(hero.y - e.y, hero.x - e.x) + Math.PI / 4;
  world.events.push({ type: 'candelabra', action: 'light', id: e.id, x: e.x, y: e.y, angle: v.ca, dir: v.cs });
}

/** The spinning fires touch the hero: the hit (a shield takes it — one block a touch, not one a tick). */
function burnHero(world: World, e: Enemy): void {
  const hero = world.hero, reach = FIRE_RADIUS + heroRadius(world.params);
  const fire = crossFires(e).find(f => dhypot(f.x - hero.x, f.y - hero.y) <= reach);
  if (!fire) { delete e.vars.cb; return; }
  if (canBeHurt(world)) { delete e.vars.cb; hurtHero(world, e, num(world, 'candelabraDamage', CANDELABRA_DAMAGE), CANDELABRA_SOURCE); }
  else if (heroGuarded(world) && !e.vars.cb) { e.vars.cb = 1; noteBlock(world, fire.x, fire.y, CANDELABRA_SOURCE, e.id); }
}

function stepCandelabra(world: World, e: Enemy, dt: number): void {
  const v = e.vars;
  if (world.status !== 'playing') return;
  if (v.cp === 1) {
    v.ct -= dt;
    if (v.ct > TIME_EPS) return;
    v.cp = 2; v.ct = num(world, 'candelabraSpin', CANDELABRA_SPIN, 0.05);
    world.events.push({ type: 'candelabra', action: 'spin', id: e.id, x: e.x, y: e.y, angle: v.ca, dir: v.cs });
    return;
  }
  if (v.cp === 2) {
    v.ca += v.cs * num(world, 'candelabraTurn', CANDELABRA_TURN) * Math.PI / 180 * dt;
    if (v.ca > Math.PI * 2) v.ca -= Math.PI * 2; else if (v.ca < 0) v.ca += Math.PI * 2;
    v.ct -= dt;
    burnHero(world, e);
    if (world.status !== 'playing' || v.ct > TIME_EPS) return;
    putOut(world, e);
    return;
  }
  v.ct = Math.max(0, (v.ct ?? 0) - dt);
  const ready = v.ct <= TIME_EPS && dist(e, world.hero) <= CANDELABRA_REACH && lineOfSight(e, world.hero, world.arena, 0.05);
  if (!ready) volleyIdle(e);
  else if (volleyReady(world, e, 0)) beginLight(world, e);
}

/** The fires go out: a full rest, the next cycle spins the other way. */
function putOut(world: World, e: Enemy): void {
  const v = e.vars;
  if (!v.cp) return;
  v.cp = 0; v.ct = num(world, 'candelabraPeriod', CANDELABRA_PERIOD); v.cs = -v.cs; delete v.cb;
  world.events.push({ type: 'candelabra', action: 'out', id: e.id, x: e.x, y: e.y });
}

registerBehavior({
  id: CANDELABRA,
  onSpawn(_world, e) { e.vars.du = CANDELABRA_DURABILITY; e.vars.cp = 0; e.vars.ct = CANDELABRA_FIRST; e.vars.ca = 0; e.vars.cs = 1; },
  step(world, e, dt) { e.knock = 0; stepCandelabra(world, e, dt); return true; },
  touches: () => false,
  solid: world => !!world.params.shove,
  // A shove topples it (shove.ts): the fires go out at once.
  onShoved: (world, thing) => putOut(world, thing),
});
registerShooter(CANDELABRA, { size: () => 0, begin: beginLight });
registerEnemyKind({
  id: CANDELABRA, behavior: CANDELABRA, thing: true, immune: true, noElite: true, hp: () => 0, speed: () => 0,
  bodyScale: 1, artScale: 1.3, touchDamage: () => 0, mass: () => THING_MASS, spread: false, chainable: true, hitSource: CANDELABRA,
});

// ---- Ферзь ----

/** How far the queen slides along `way` now: to the first wall or body before it touches them, `queenMove` at most. */
function moveLength(world: World, e: Enemy, way: Vec): number {
  const p = world.params, r = bodyRadiusOf(p, e), most = num(world, 'queenMove', QUEEN_MOVE), hr = heroRadius(p);
  let len = 0;
  for (let t = LINE_STEP; t <= most + 1e-9; t += LINE_STEP) {
    const q = { x: e.x + way.x * t, y: e.y + way.y * t };
    if (blockedAt(q, r, world.arena) || dist(q, world.hero) < r + hr || world.enemies.some(o => o !== e && bodyNow(o) && dist(q, o) < r + bodyRadiusOf(p, o))) break;
    len = t;
  }
  return len;
}

/** «Ход ферзя»: the way whose end is nearest the band from the hero (equal — the smaller index); none movable — null. */
function chooseMove(world: World, e: Enemy): { way: number; length: number } | null {
  let best: { way: number; length: number; off: number } | null = null;
  QUEEN_WAYS.forEach((way, i) => {
    const length = moveLength(world, e, way);
    if (length < LINE_STEP) return;
    const d = dist({ x: e.x + way.x * length, y: e.y + way.y * length }, world.hero), off = d < QUEEN_NEAR ? QUEEN_NEAR - d : d > QUEEN_FAR ? d - QUEEN_FAR : 0;
    if (!best || off < best.off - 1e-9) best = { way: i, length, off };
  });
  return best;
}

/** The queen's move now (the view): its line and the sign's share (`sliding` — it slides). Null — it does not move. */
export function queenMove(world: World, e: Enemy): { x0: number; y0: number; x1: number; y1: number; progress: number; sliding: boolean } | null {
  const v = e.vars;
  if (e.kind !== QUEEN || (v.qs !== 1 && v.qs !== 2) || world.status !== 'playing') return null;
  const way = QUEEN_WAYS[v.mw];
  return { x0: v.mx, y0: v.my, x1: v.mx + way.x * v.ml, y1: v.my + way.y * v.ml, progress: v.qs === 1 ? Math.max(0, Math.min(1, 1 - v.qt / QUEEN_SIGN)) : 1, sliding: v.qs === 2 };
}

/** «Звезда ферзя» now (the view): the 8 lines fixed at the windup's start and its share. Null — no windup. */
export function queenLines(world: World, e: Enemy): { lines: { x0: number; y0: number; x1: number; y1: number }[]; progress: number } | null {
  const v = e.vars;
  if (e.kind !== QUEEN || v.qs !== 4 || world.status !== 'playing') return null;
  return { lines: QUEEN_WAYS.map((way, i) => ({ x0: v.ox, y0: v.oy, x1: v.ox + way.x * v[`l${i}`], y1: v.oy + way.y * v[`l${i}`] })), progress: Math.max(0, Math.min(1, 1 - v.qt / Math.max(1e-6, v.qw))) };
}

function beginStar(world: World, e: Enemy): void {
  const v = e.vars, windup = num(world, 'queenWindup', QUEEN_WINDUP, 0.05) * (v.qf === 1 ? 1 : QUEEN_FIRST_FACTOR);
  v.qs = 4; v.qt = windup; v.qw = windup; v.ox = e.x; v.oy = e.y; v.vq = QUEEN_STARS;
  QUEEN_WAYS.forEach((way, i) => { v[`l${i}`] = rayLength(world, e.x, e.y, way.x, way.y); });
  world.events.push({ type: 'queen', action: 'aim', id: e.id, x: e.x, y: e.y, lines: queenLines(world, e)!.lines });
}

/** The windup's end: 8 stars hang at the queen, then fly along the lines. */
function looseStars(world: World, e: Enemy): void {
  const v = e.vars, speed = num(world, 'queenShotSpeed', QUEEN_SHOT_SPEED, 0.1), at = bodyRadiusOf(world.params, e) + STAR_RADIUS + 0.02;
  for (const way of QUEEN_WAYS) addShot(world, { kind: 'star', x: v.ox + way.x * at, y: v.oy + way.y * at, vx: way.x * speed, vy: way.y * speed, r: STAR_RADIUS, life: SHOT_RANGE / speed, hang: STAR_HANG, owner: e.id });
  world.events.push({ type: 'queen', action: 'shot', id: e.id, x: e.x, y: e.y });
}

function stepQueen(world: World, e: Enemy, dt: number): boolean {
  // It stands at its post between its moves: a knockback is dropped, the walk skipped.
  e.knock = 0;
  const v = e.vars, hero = world.hero;
  if (world.status !== 'playing') return true;
  if (v.qs === 4) {
    v.qt -= dt;
    if (v.qt > TIME_EPS) return true;
    delete v.vq; v.qs = 0; v.qf = 1; v.qt = num(world, 'queenPeriod', QUEEN_PERIOD);
    looseStars(world, e);
    return true;
  }
  if (v.qs === 1) {
    v.qt -= dt;
    if (v.qt <= TIME_EPS) { v.qs = 2; v.mr = 0; }
    return true;
  }
  if (v.qs === 2) {
    const way = QUEEN_WAYS[v.mw], p = world.params, r = bodyRadiusOf(p, e), step = Math.min(QUEEN_SLIDE * dt, v.ml - v.mr);
    const q = { x: e.x + way.x * step, y: e.y + way.y * step };
    const stop = step <= 1e-9 || blockedAt(q, r, world.arena) || dist(q, hero) < r + heroRadius(p) || world.enemies.some(o => o !== e && bodyNow(o) && dist(q, o) < r + bodyRadiusOf(p, o));
    if (!stop) { e.x = q.x; e.y = q.y; v.mr += step; }
    if (stop || v.mr >= v.ml - 1e-9) v.qs = 3;
    return true;
  }
  if (v.qs === 3) {
    const ready = dist(e, hero) <= QUEEN_REACH && lineOfSight(e, hero, world.arena, 0.05);
    if (!ready) volleyIdle(e);
    else if (volleyReady(world, e, QUEEN_STARS)) beginStar(world, e);
    return true;
  }
  v.qt = Math.max(0, (v.qt ?? 0) - dt);
  if (v.qt > TIME_EPS) return true;
  const move = chooseMove(world, e);
  if (!move) { v.qs = 3; return true; }
  v.qs = 1; v.qt = QUEEN_SIGN; v.mw = move.way; v.ml = move.length; v.mx = e.x; v.my = e.y;
  const way = QUEEN_WAYS[move.way];
  world.events.push({ type: 'queen', action: 'move', id: e.id, x: e.x, y: e.y, x1: e.x + way.x * move.length, y1: e.y + way.y * move.length });
  return true;
}

registerBehavior({ id: QUEEN, onSpawn(_world, e) { e.vars.qs = 0; e.vars.qt = QUEEN_FIRST; }, step: stepQueen });
registerShooter(QUEEN, { size: () => QUEEN_STARS, begin: beginStar });
registerEnemyKind({
  id: QUEEN, behavior: QUEEN, speedClass: 'normal', hp: () => QUEEN_HP, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1.25, touchDamage: world => world.params.contactDamage, mass: () => QUEEN_MASS, spread: true, chainable: true, hitSource: QUEEN,
  noElite: true,
});

// ---- Дворецкий и Люстра ----

/** Task 60а: the chandelier (`world.chandelier`): its butler, where it hangs, the next drop, the drop falling, its own fall. */
export interface Chandelier {
  owner: number;
  x: number;
  y: number;
  /** Game seconds to the next «Капля воска». */
  next: number;
  /** The drop's mark (fixed where it hung) and the seconds before it lands. */
  drop?: { x: number; y: number; left: number };
  /** «Падение люстры»: seconds before it lands, and whether it is the player's (the butler's death was). */
  fall?: { left: number; credited: boolean };
}

/** The chandelier the player sees now (the fight over — none: it is gone without a fall). */
export function liveChandelier(world: World): Chandelier | null { return world.status === 'playing' && !world.bossCleared ? world.chandelier ?? null : null; }

/** The butler bows now (the view): the share of its bow, or null. */
export function butlerBow(e: Enemy): number | null { return e.kind === BUTLER && e.vars.bb !== undefined ? Math.max(0, Math.min(1, 1 - e.vars.bb / BOW_TIME)) : null; }

function stepButler(world: World, e: Enemy, dt: number): boolean {
  if (e.knock > 0) return false;
  const v = e.vars;
  if (v.bb !== undefined) {
    v.bb -= dt;
    if (v.bb > TIME_EPS) return true;
    delete v.bb;
    if (!world.chandelier && world.status === 'playing') {
      const hero = world.hero;
      world.chandelier = { owner: e.id, x: hero.x, y: hero.y, next: num(world, 'chandelierDrop', CHANDELIER_DROP, 0.1) };
      world.events.push({ type: 'chandelier', action: 'hang', owner: e.id, x: hero.x, y: hero.y });
    }
    return true;
  }
  v.bt = Math.max(0, (v.bt ?? 0) - dt);
  if (v.bt <= TIME_EPS && !world.chandelier && world.status === 'playing') {
    v.bb = BOW_TIME;
    world.events.push({ type: 'chandelier', action: 'bow', owner: e.id, x: world.hero.x, y: world.hero.y });
    return true;
  }
  return keep(world, e, num(world, 'butlerNear', BUTLER_NEAR), num(world, 'butlerFar', BUTLER_FAR), dt);
}

/** The butler died: its chandelier falls where it hangs — the player's if the death was (design В7). */
function butlerDied(world: World, e: Enemy, cause: KillCause): void {
  const c = world.chandelier;
  if (c && c.owner === e.id && !c.fall) startFall(world, c, cause.credited);
}

function startFall(world: World, c: Chandelier, credited: boolean): void {
  c.fall = { left: num(world, 'chandelierFallTime', CHANDELIER_FALL_TIME), credited };
  delete c.drop;
  world.events.push({ type: 'chandelier', action: 'fall', owner: c.owner, x: c.x, y: c.y, radius: num(world, 'chandelierFallRadius', CHANDELIER_FALL_RADIUS) });
}

/** «Падение люстры» lands: the hero, then every enemy in the circle (things untouched); the chandelier is gone. */
function crash(world: World, c: Chandelier): void {
  const p = world.params, radius = num(world, 'chandelierFallRadius', CHANDELIER_FALL_RADIUS), hero = world.hero, credited = !!c.fall?.credited;
  delete world.chandelier;
  world.events.push({ type: 'chandelier', action: 'crash', owner: c.owner, x: c.x, y: c.y, radius });
  if (dhypot(hero.x - c.x, hero.y - c.y) <= radius + heroRadius(p)) {
    if (canBeHurt(world)) hurtHero(world, { id: c.owner }, num(world, 'chandelierFallDamage', CHANDELIER_FALL_DAMAGE), FALL_SOURCE);
    else noteBlock(world, hero.x, hero.y, FALL_SOURCE, c.owner);
  }
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => !isThing(e) && dhypot(e.x - c.x, e.y - c.y) <= radius + bodyRadiusOf(p, e));
  for (const e of struck) { damageEnemy(world, e, 1, { source: FALL_SOURCE, credited, plates: 1 }); if (world.status !== 'playing') return; }
}

/** The chandelier's step: it floats to the hero, drops its wax, or falls (nothing while none hangs). */
function updateChandelier(world: World, dt: number): void {
  const c = world.chandelier;
  if (!c) return;
  // The boss died, the fight is over: it is gone without a fall.
  if (world.bossCleared) { delete world.chandelier; world.events.push({ type: 'chandelier', action: 'gone', owner: c.owner, x: c.x, y: c.y }); return; }
  if (c.fall) {
    c.fall.left -= dt;
    if (c.fall.left <= TIME_EPS) crash(world, c);
    return;
  }
  const owner = world.enemies.find(e => e.id === c.owner);
  // Its butler left the arena some other way (no death hook ran): it falls, not the player's.
  if (!owner) { startFall(world, c, false); return; }
  // Cold on the butler: the chandelier stands, its drops wait.
  if (enemyFrozen(owner)) return;
  const hero = world.hero, dx = hero.x - c.x, dy = hero.y - c.y, d = dhypot(dx, dy), step = num(world, 'chandelierSpeed', CHANDELIER_SPEED) * dt;
  if (d <= step) { c.x = hero.x; c.y = hero.y; } else { c.x += dx / d * step; c.y += dy / d * step; }
  if (c.drop) {
    c.drop.left -= dt;
    if (c.drop.left <= TIME_EPS) {
      const mark = c.drop;
      delete c.drop;
      const radius = num(world, 'chandelierDropRadius', CHANDELIER_DROP_RADIUS);
      world.events.push({ type: 'chandelier', action: 'drop', stage: 'land', owner: c.owner, x: mark.x, y: mark.y, radius });
      if (dhypot(hero.x - mark.x, hero.y - mark.y) <= radius + heroRadius(world.params)) {
        if (canBeHurt(world)) hurtHero(world, { id: c.owner }, num(world, 'chandelierDropDamage', CHANDELIER_DROP_DAMAGE), WAX_SOURCE);
        else noteBlock(world, hero.x, hero.y, WAX_SOURCE, c.owner);
      }
      if (world.status !== 'playing') return;
    }
  }
  c.next -= dt;
  if (c.next <= TIME_EPS && !c.drop) {
    c.next += num(world, 'chandelierDrop', CHANDELIER_DROP, 0.1);
    c.drop = { x: c.x, y: c.y, left: num(world, 'chandelierDropTime', CHANDELIER_DROP_TIME, 0.05) };
    world.events.push({ type: 'chandelier', action: 'drop', stage: 'mark', owner: c.owner, x: c.x, y: c.y, radius: num(world, 'chandelierDropRadius', CHANDELIER_DROP_RADIUS) });
  }
}

registerBehavior({ id: BUTLER, onSpawn(_world, e) { e.vars.bt = HANG_DELAY; }, step: stepButler, onDeath: butlerDied });
registerEnemyKind({
  id: BUTLER, behavior: BUTLER, speedClass: 'normal', hp: () => BUTLER_HP, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1.1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: BUTLER,
  noElite: true,
});

// ---- Полтергейст ----

/** The things a poltergeist holds now (lifted, not yet thrown), in its order. */
function held(world: World, e: Enemy): Enemy[] {
  const out: Enemy[] = [];
  for (let i = 0; i < (e.vars.pn ?? 0); i++) {
    const t = world.enemies.find(x => x.id === e.vars[`p${i}`]);
    if (t && t.vars.lf === e.id && t.vars.pfl === undefined) out.push(t);
  }
  return out;
}

/** The poltergeist now (the view): the lift's share (null — not lifting) and the things it holds up (not yet thrown). */
export function poltergeistState(world: World, e: Enemy): { lifting: number | null; held: number[] } | null {
  if (e.kind !== POLTERGEIST || world.status !== 'playing') return null;
  const v = e.vars, lift = num(world, 'poltergeistLift', POLTERGEIST_LIFT, 0.05);
  return { lifting: v.ps === 1 ? Math.max(0, Math.min(1, 1 - v.pt / lift)) : null, held: held(world, e).map(t => t.id) };
}

/** A thing in the poltergeist's flight now (the view): from, to (the mark), the mark's radius, the flight's share; null — not flying. */
export function thingFlight(world: World, t: Enemy): { from: Vec; to: Vec; radius: number; progress: number; by: number } | null {
  const v = t.vars;
  if (v.pfl === undefined || world.status !== 'playing') return null;
  return { from: { x: v.pfx, y: v.pfy }, to: { x: v.ptx, y: v.pty }, radius: num(world, 'poltergeistMark', POLTERGEIST_MARK), progress: Math.max(0, Math.min(1, 1 - v.pfl / Math.max(1e-6, v.pft))), by: v.lf };
}

/** The light things it may lift now: within its reach, not sliding, not linked, not held — the nearest first (then the smaller id). */
function liftable(world: World, e: Enemy): Enemy[] {
  const reach = num(world, 'poltergeistReach', POLTERGEIST_REACH), carry = Math.floor(num(world, 'poltergeistCarry', POLTERGEIST_CARRY));
  return world.enemies
    .filter(t => LIGHT_THINGS.includes(t.kind) && !thingLifted(t) && t.vars.wl === undefined && dist(e, t) <= reach && !sliding(world, t.id) && !linkedNow(world, t))
    .sort((a, b) => dist(e, a) - dist(e, b) || a.id - b.id)
    .slice(0, carry);
}

function lift(world: World, e: Enemy, things: readonly Enemy[]): void {
  const v = e.vars;
  things.forEach((t, i) => { t.vars.lf = e.id; v[`p${i}`] = t.id; });
  v.ps = 1; v.pt = num(world, 'poltergeistLift', POLTERGEIST_LIFT, 0.05); v.pn = things.length;
  world.events.push({ type: 'poltergeist', action: 'lift', id: e.id, x: e.x, y: e.y, things: things.map(t => t.id) });
}

/** Forgets the things it held (a throw done, or its death). */
function letGo(e: Enemy): void {
  const v = e.vars;
  for (let i = 0; i < (v.pn ?? 0); i++) delete v[`p${i}`];
  delete v.pn;
}

/** The next held thing flies at the hero's point now (the mark fixed); the last one thrown — a full rest. */
function throwNext(world: World, e: Enemy): void {
  const v = e.vars, next = held(world, e)[0];
  if (next) {
    const hero = world.hero, mark = { x: hero.x, y: hero.y }, flight = num(world, 'poltergeistFlight', POLTERGEIST_FLIGHT, 0.05);
    pushOutOfObstacles(mark, MARK_PUSH, world.arena);
    const t = next.vars;
    t.pfx = next.x; t.pfy = next.y; t.ptx = mark.x; t.pty = mark.y; t.pfl = flight; t.pft = flight;
    world.events.push({ type: 'poltergeist', action: 'throw', id: e.id, x: next.x, y: next.y, x1: mark.x, y1: mark.y, things: [next.id], radius: num(world, 'poltergeistMark', POLTERGEIST_MARK) });
  }
  if (!held(world, e).length) { v.ps = 0; v.pt = num(world, 'poltergeistPeriod', POLTERGEIST_PERIOD); letGo(e); }
  else { v.ps = 2; v.pt = THROW_GAP; }
}

function stepPoltergeist(world: World, e: Enemy, dt: number): boolean {
  if (e.knock > 0) return false;
  const v = e.vars;
  if (v.ps === 1 || v.ps === 2) {
    v.pt -= dt;
    if (v.pt <= TIME_EPS && world.status === 'playing') throwNext(world, e);
    return true;
  }
  v.pt = Math.max(0, (v.pt ?? 0) - dt);
  if (v.pt <= TIME_EPS && world.status === 'playing') {
    const things = liftable(world, e);
    if (things.length) { lift(world, e, things); return true; }
  }
  return keep(world, e, POLTERGEIST_NEAR, POLTERGEIST_FAR, dt);
}

/** A thing lands: the hero and the enemies in its mark are hit; it stands there with its durability (design В14). */
function land(world: World, t: Enemy): void {
  const v = t.vars, p = world.params, by = v.lf, radius = num(world, 'poltergeistMark', POLTERGEIST_MARK), hero = world.hero;
  t.x = v.ptx; t.y = v.pty;
  for (const k of ['lf', 'pfl', 'pft', 'pfx', 'pfy', 'ptx', 'pty']) delete v[k];
  pushOutOfObstacles(t, bodyRadiusOf(p, t), world.arena);
  world.events.push({ type: 'poltergeist', action: 'land', id: by, x: t.x, y: t.y, things: [t.id], radius });
  if (dhypot(hero.x - t.x, hero.y - t.y) <= radius + heroRadius(p)) {
    if (canBeHurt(world)) hurtHero(world, { id: by }, num(world, 'poltergeistDamage', POLTERGEIST_DAMAGE), THROW_SOURCE);
    else noteBlock(world, hero.x, hero.y, THROW_SOURCE, by);
  }
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => e !== t && !isThing(e) && dhypot(e.x - t.x, e.y - t.y) <= radius + bodyRadiusOf(p, e));
  for (const e of struck) { damageEnemy(world, e, 1, { source: THROW_SOURCE, credited: false, plates: 1, firing: t.id }); if (world.status !== 'playing') return; }
  pushOutOfSolids(world, hero);
}

/** The poltergeist died: the things it holds drop where they stood; the weak under them die (credited as its death, design В7). */
function poltergeistDied(world: World, e: Enemy, cause: KillCause): void {
  const dropped = held(world, e), p = world.params;
  letGo(e);
  if (!dropped.length) return;
  for (const t of dropped) delete t.vars.lf;
  world.events.push({ type: 'poltergeist', action: 'drop', id: e.id, x: e.x, y: e.y, things: dropped.map(t => t.id) });
  for (const t of dropped) {
    const under = world.enemies.filter(o => !isThing(o) && o.hp < 1 && platesOf(o) === 0 && !kindOf(o).immune && dist(o, t) < bodyRadiusOf(p, t) + bodyRadiusOf(p, o));
    for (const o of under) { killEnemy(world, o, { source: DROP_SOURCE, credited: cause.credited }); if (world.status !== 'playing') return; }
  }
  pushOutOfSolids(world, world.hero);
}

registerBehavior({ id: POLTERGEIST, onSpawn(world, e) { e.vars.ps = 0; e.vars.pt = num(world, 'poltergeistPeriod', POLTERGEIST_PERIOD); }, step: stepPoltergeist, onDeath: poltergeistDied });
registerEnemyKind({
  id: POLTERGEIST, behavior: POLTERGEIST, speedClass: 'normal', hp: () => 0, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: POLTERGEIST,
  noElite: true,
});

// ---- Шут ----

/** The jester's ball on the arena (its own, reflected or not), or undefined. */
const ballOf = (world: World, e: Enemy): Shot | undefined => world.shots?.find(s => s.kind === 'ball' && s.owner === e.id);

/** The catches that count now (they start again `RESET_TIME` s after the last reflection). */
export function jesterCatches(world: World, e: Enemy): number {
  const v = e.vars;
  return v.jl !== undefined && world.time - v.jl >= RESET_TIME - TIME_EPS ? 0 : v.jc ?? 0;
}

/** The jester now (the view): its bells (lit: the catches left before the miss), its windup's share, stunned (seconds left). */
export function jesterState(world: World, e: Enemy): { bells: number; lit: number; windup: number | null; stunned: number | null } | null {
  if (e.kind !== JESTER || world.status !== 'playing') return null;
  const v = e.vars, bells = Math.floor(num(world, 'jesterCatches', JESTER_CATCHES)) + 1;
  return { bells, lit: Math.max(0, bells - jesterCatches(world, e)), windup: v.js === 1 ? Math.max(0, Math.min(1, 1 - v.jt / Math.max(1e-6, v.jw))) : null, stunned: v.js === 3 ? Math.max(0, v.jt) : null };
}

/** The jester stands stunned (the view: the stars, as the lynx's). */
export const jesterStunned = (e: Enemy): boolean => e.kind === JESTER && e.vars.js === 3;

function beginToss(world: World, e: Enemy): void {
  const v = e.vars, windup = v.jq === 1 ? SHORT_WINDUP : num(world, 'jesterWindup', JESTER_WINDUP, 0.05);
  v.js = 1; v.jt = windup; v.jw = windup; v.vq = 1;
  world.events.push({ type: 'jester', action: 'aim', id: e.id, x: e.x, y: e.y });
}

function toss(world: World, e: Enemy): void {
  const v = e.vars, hero = world.hero, d = dist(e, hero) || 1, dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d;
  const speed = Math.max(0.1, num(world, 'jesterBall', JESTER_BALL) + num(world, 'jesterBallStep', JESTER_BALL_STEP) * jesterCatches(world, e)), at = bodyRadiusOf(world.params, e) + BALL_RADIUS + 0.02;
  delete v.vq; delete v.jq; v.js = 2;
  const s = addShot(world, { kind: 'ball', x: e.x + dx * at, y: e.y + dy * at, vx: dx * speed, vy: dy * speed, r: BALL_RADIUS, life: SHOT_RANGE / speed, hang: 0, owner: e.id });
  world.events.push({ type: 'jester', action: 'throw', id: e.id, x: s.x, y: s.y, ball: s.id, speed });
}

function stepJester(world: World, e: Enemy, dt: number): boolean {
  if (e.knock > 0) return false;
  const v = e.vars, hero = world.hero;
  if (v.jl !== undefined && world.time - v.jl >= RESET_TIME - TIME_EPS) { v.jc = 0; delete v.jl; }
  if (v.js === 3) {
    v.jt -= dt;
    if (v.jt > TIME_EPS) return true;
    v.js = 0; v.jt = num(world, 'jesterPeriod', JESTER_PERIOD); v.jc = 0;
    return true;
  }
  if (v.js === 1) {
    v.jt -= dt;
    if (v.jt <= TIME_EPS && world.status === 'playing') toss(world, e);
    return true;
  }
  if (v.js === 2) {
    if (ballOf(world, e)) return true;
    // Its ball is out (a wall, a thing, the hero, a snuff): a full rest.
    v.js = 0; v.jt = num(world, 'jesterPeriod', JESTER_PERIOD);
    return true;
  }
  v.jt = Math.max(0, (v.jt ?? 0) - dt);
  const d = dist(e, hero);
  const ready = v.jt <= TIME_EPS && world.status === 'playing' && d >= num(world, 'jesterNear', JESTER_NEAR_THROW) && !ballOf(world, e) && lineOfSight(e, hero, world.arena, 0.05);
  if (!ready) volleyIdle(e);
  else if (volleyReady(world, e, 1)) { beginToss(world, e); return true; }
  return keep(world, e, JESTER_NEAR, JESTER_FAR, dt);
}

/**
 * The reflected ball reached its jester (shots.ts): a catch while the count allows it and the jester is free (not frozen, not stunned) —
 * the next throw comes at once with the short windup; else the miss — −1 HP to it (the player's, `reflect`) and the stun.
 */
function caught(world: World, e: Enemy): void {
  const v = e.vars;
  if (jesterCatches(world, e) < Math.floor(num(world, 'jesterCatches', JESTER_CATCHES)) && !enemyFrozen(e) && v.js !== 3) {
    v.jc = jesterCatches(world, e) + 1; v.js = 0; v.jt = 0; v.jq = 1;
    world.events.push({ type: 'jester', action: 'catch', id: e.id, x: e.x, y: e.y, catches: v.jc });
    return;
  }
  world.events.push({ type: 'jester', action: 'miss', id: e.id, x: e.x, y: e.y });
  damageEnemy(world, e, 1, { source: REFLECT_SOURCE, credited: true, plates: 1 });
  if (!world.enemies.includes(e) || world.status !== 'playing') return;
  v.js = 3; v.jt = num(world, 'jesterStun', JESTER_STUN, 0.05); v.jc = 0; delete v.jl; delete v.jq; delete v.vq; volleyIdle(e);
  world.events.push({ type: 'jester', action: 'stun', id: e.id, x: e.x, y: e.y });
}

/** A ball the pass reflects (chain.ts `planChain`'s `reflects`): which, whose, whether its jester misses it, the line back. */
export interface BallReflect { ball: number; jester: number; miss: boolean; x0: number; y0: number; x1: number; y1: number }

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** A ball flying at the hero (not reflected yet): the pass may reflect it. */
export const freeBall = (s: Shot): boolean => s.kind === 'ball' && !s.back && s.hang <= 0;

/**
 * The balls the dash's `path` (the hero, then the reached links' points now) reflects: its body touches the ball on a segment (as the
 * snuffing's reach). Reads the world only — the highlight and the release read the same.
 */
export function planReflects(world: World, path: readonly Vec[]): BallReflect[] {
  const out: BallReflect[] = [], reach = heroRadius(world.params), catches = Math.floor(num(world, 'jesterCatches', JESTER_CATCHES));
  for (const s of world.shots ?? []) {
    if (!freeBall(s)) continue;
    let crossed = false;
    for (let i = 1; i < path.length && !crossed; i++) crossed = segmentDistance(path[i - 1], path[i], s) <= s.r + reach;
    const owner = crossed ? world.enemies.find(e => e.id === s.owner) : undefined;
    if (!owner) continue;
    out.push({ ball: s.id, jester: owner.id, miss: jesterCatches(world, owner) >= catches || enemyFrozen(owner) || owner.vars.js === 3, x0: s.x, y0: s.y, x1: owner.x, y1: owner.y });
  }
  return out;
}

/** The release reflects a ball of its plan: it turns to its jester at `jesterReturn` (it no longer hurts the hero). */
export function reflectBall(world: World, id: number): void {
  const s = world.shots?.find(x => x.id === id), owner = s && world.enemies.find(e => e.id === s.owner);
  if (!s || !owner || !freeBall(s)) return;
  const speed = num(world, 'jesterReturn', JESTER_RETURN, 0.1), d = dhypot(owner.x - s.x, owner.y - s.y) || 1;
  s.back = 1; s.vx = (owner.x - s.x) / d * speed; s.vy = (owner.y - s.y) / d * speed; s.life = SHOT_RANGE / speed;
  owner.vars.jl = world.time;
  world.events.push({ type: 'jester', action: 'reflect', id: owner.id, x: s.x, y: s.y, ball: s.id });
}

registerBehavior({ id: JESTER, onSpawn(_world, e) { e.vars.js = 0; e.vars.jt = JESTER_FIRST; e.vars.jc = 0; }, step: stepJester });
registerShooter(JESTER, { size: () => 1, begin: beginToss, caught });
registerEnemyKind({
  id: JESTER, behavior: JESTER, speedClass: 'normal', hp: () => JESTER_HP, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1.1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: JESTER,
  noElite: true,
});

// ---- The world's step ----

/**
 * The guests' world step (world.ts `update`, after the shots): the chandelier floats, drops and falls; the poltergeist's things fly and
 * land. Nothing without a chandelier or a thing in flight (older worlds play as before).
 */
export function updateGuests(world: World, dt: number): void {
  if (world.status !== 'playing') return;
  if (world.chandelier) updateChandelier(world, dt);
  for (const t of [...world.enemies]) {
    if (world.status !== 'playing') return;
    const v = t.vars;
    // Only a thing the poltergeist threw (its own vars: no other kind's numbers are read).
    if (v.lf === undefined || v.pfl === undefined || !isThing(t) || !world.enemies.includes(t)) continue;
    v.pfl -= dt;
    const k = Math.max(0, Math.min(1, 1 - v.pfl / Math.max(1e-6, v.pft)));
    t.x = v.pfx + (v.ptx - v.pfx) * k; t.y = v.pfy + (v.pty - v.pfy) * k;
    if (v.pfl <= TIME_EPS) land(world, t);
  }
}

/** «Падение люстры» the drawn chain would cause: the butler of the chandelier dies by its pass (`kills`) — the circle where it hangs. */
export function chandelierFallPlan(world: World, kills: ReadonlySet<number>): { x: number; y: number; radius: number } | null {
  const c = world.chandelier;
  if (!c || c.fall || !kills.has(c.owner)) return null;
  return { x: c.x, y: c.y, radius: num(world, 'chandelierFallRadius', CHANDELIER_FALL_RADIUS) };
}
