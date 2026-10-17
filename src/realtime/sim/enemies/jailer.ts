/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md; the rules —
 * docs/realtime-elite-behaviors.md, «Каркас босса и Тюремщик»). Only while `Params.bossFrame` is on (the sandbox arena
 * «Тюремщик», sim/arenasBoss.ts, turns it on for itself); without it both kinds are plain enemies that walk to the hero.
 *
 * **The frame.** A boss is a core and its parts — enemies of the common body, each with its own colour, HP and plates (boss
 * plates, `EliteArmor.boss`: no window at 0, no regrowth). A part (`Enemy.partOf` — its core's id) is fixed to the core by its own
 * `step` every tick. The conductor is the group step (`beforeStep`): it picks the moves — the weights `MOVE_WEIGHTS`, a move
 * used `EVENT_MAX` times in a row is left out, one passed over `MISSED_MAX` times is taken (the stream `behavior:jailer`; one
 * draw only when two or more moves stay open). The first use of each move in a fight winds up ×`FIRST_WINDUP_FACTOR`. A part
 * that dies (any cause) is severed: the core loses one plate — after the dash. The boss's state (the core's plates from severed
 * parts, the phase, the despair) changes only while no move of the hero runs (`world.move`), so the highlight of a drawn chain
 * stays what the dash does. The phase: 2 when the core has `PHASE2_PLATES` plates or fewer, or `PHASE2_TIME` game seconds have
 * passed. The core's death kills its parts after the dash (not the player's kill). The goal of the arena — the core marked.
 *
 * **The Jailer.** The weight (`jailer-weight`, HP 3, 1 plate) holds «Кистень» and «Бросок гири»; the core (`jailer`, HP
 * `Params.jailerHp` — 2, the boss arenas 5; 3 plates, a shield in front as the shieldbearer's: `shieldArc` turned to the hero at
 * `shieldTurn`) holds «Свисток». Task 32 (`Params.jailerColorless`): the core is colourless — a chain of any colour takes it and
 * it does not touch the chain's colour (`colorlessCore`; chain.ts `colorlessLink`); the weight keeps its colour.
 * - «Кистень» (`flail`): the hero within `FLAIL_REACH` of the core; a half disc of `FLAIL_RADIUS` in front (towards the hero at
 *   the windup's start). The hit: −`FLAIL_DAMAGE` to the hero whose body touches it; enemies in it (not the boss) are thrown
 *   `FLAIL_PUSH` away from the core — a cliff kills them, not the player's kill. Then the weight lies at the arc's end for
 *   `FLAIL_LIE` s.
 * - «Бросок гири» (`throw`): the hero within `THROW_RANGE` and in sight; a circle of `THROW_RADIUS` on the hero's centre at the
 *   windup's start, fixed (as the archer's mark). The hit: −`THROW_DAMAGE` to the hero and to every enemy in it (not the boss; not
 *   the player's kills). The weight lies there `THROW_LIE` s.
 * - «Свисток» (`whistle`, phase 2): every `WHISTLE_PERIOD` s (the first as phase 2 comes); a circle at the arena's gate farthest
 *   from the hero (`ArenaTemplate.gates`); the hit puts `WHISTLE_ADDS` markers of plain enemies of the weight's colour there.
 * - The weight severed: its moves never start again (one winding up is dropped); after the dash the core loses one plate and
 *   runs at the hero ×`DESPAIR_SPEED`, shield first.
 * The moves rest `MOVE_GAP` s between them, the first comes `FIRST_MOVE_DELAY` s into the fight; while winding up the core stands.
 * The cold stops the core's timers (as the archer's). Numbers are hypotheses of the boss report: the tests check the rules.
 *
 * State in `vars`. The core: `facing` (shield, radians), `born`, `cd` (rest left), `phase`, `mv` (move winding up: 1 flail,
 * 2 throw, 3 whistle), `t` / `w` (windup left / whole), `dir` (flail), `ax`, `ay` (the throw's mark, the whistle's gate), `wt`
 * (to the next whistle), `sever` (parts severed, not settled yet), `despair`, `wc` (the weight's colour; set once it is
 * attached), `rf`/`mf`, `rt`/`mt` (in a row / missed of the flail and the throw), `uf`, `ut`, `uw` (the move was used). The weight:
 * `lie`, `lx`, `ly` (lying: seconds left, the spot).
 */
import { datan2, dcos, dhypot, dsin } from '../detMath';
import { dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius, type Params } from '../params';
import type { SpawnMarker } from '../spawn';
import { dropArmorLoot } from '../elites';
import { canBeHurt, completeGoals, damageEnemy, dropIntoCliffs, enemyFrozen, hurtHero, killEnemy, noteBlock, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** The kinds of the Jailer: its core and its part. */
export const JAILER = 'jailer';
export const JAILER_WEIGHT = 'jailer-weight';
/**
 * Task 38 «Гарнизон»: the boss cores of the frame — the Jailer and the Castellan (enemies/garrison.ts, the same frame): both are
 * colourless with `jailerColorless` and both end the fight with `bossClears`. Task 48: the Troll's core too (enemies/troll.ts).
 */
export const BOSS_CORES: readonly string[] = [JAILER, 'castellan', 'troll', 'chief'];
export type JailerMoveId = 'flail' | 'throw' | 'whistle';
/** Every move of the Jailer (telegraphWindow.spec.ts checks each has a window record). */
export const JAILER_MOVES: readonly JailerMoveId[] = ['flail', 'throw', 'whistle'];

// ---- Баланс (гипотезы отчёта о боссах, 15.10.2026; тесты проверяют правила, не числа) ----
/** HP of the old core (the default of `Params.jailerHp`); task 32: the boss arenas put `JAILER_ARENA_HP`. */
export const JAILER_HP = 2;
export const JAILER_ARENA_HP = 5;
export const JAILER_PLATES = 3;
export const WEIGHT_HP = 3;
export const WEIGHT_PLATES = 1;
/** Windup of every move, game seconds; the first use of a move in a fight — ×`FIRST_WINDUP_FACTOR`. */
export const JAILER_WINDUP = 1;
export const FIRST_WINDUP_FACTOR = 1.5;
export const FLAIL_RADIUS = 2.5;
/** The flail's arc: 180°. */
export const FLAIL_ARC = Math.PI;
export const FLAIL_DAMAGE = 2;
export const FLAIL_PUSH = 1.5;
export const FLAIL_LIE = 1.5;
/** The flail may be chosen while the hero's centre is this close to the core. */
export const FLAIL_REACH = 3;
export const THROW_RADIUS = 1;
export const THROW_DAMAGE = 2;
export const THROW_LIE = 2;
export const THROW_RANGE = 7;
export const WHISTLE_PERIOD = 12;
export const WHISTLE_ADDS = 4;
/** The whistle's circle at the gate (the view's sign; the markers stand inside it). */
export const WHISTLE_RADIUS = 1;
export const PHASE2_PLATES = 1;
export const PHASE2_TIME = 30;
export const DESPAIR_SPEED = 1.3;
export const EVENT_MAX = 2;
export const MISSED_MAX = 4;
export const MOVE_WEIGHTS: Readonly<Record<'flail' | 'throw', number>> = { flail: 1, throw: 1 };
export const MOVE_GAP = 1.5;
export const FIRST_MOVE_DELAY = 2;
/** The weight in hand: this far from the core's centre, at its right (the shield's facing + 90°). */
export const WEIGHT_HOLD = 0.9;
const HOLD_ANGLE = Math.PI / 2;

const DEG = Math.PI / 180;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;
const STREAM = 'behavior:jailer';
/** The markers of the whistle at the gate: a square of four. */
const ADD_OFFSETS: readonly Vec[] = [{ x: -0.35, y: -0.35 }, { x: 0.35, y: -0.35 }, { x: -0.35, y: 0.35 }, { x: 0.35, y: 0.35 }];

type PoolMove = 'flail' | 'throw';
const POOL: readonly PoolMove[] = ['flail', 'throw'];
const CODE: Readonly<Record<JailerMoveId, number>> = { flail: 1, throw: 2, whistle: 3 };
const MOVE_OF: readonly (JailerMoveId | null)[] = [null, 'flail', 'throw', 'whistle'];
const USED: Readonly<Record<JailerMoveId, string>> = { flail: 'uf', throw: 'ut', whistle: 'uw' };
const ROW: Readonly<Record<PoolMove, string>> = { flail: 'rf', throw: 'rt' };
const MISSED: Readonly<Record<PoolMove, string>> = { flail: 'mf', throw: 'mt' };

const frameOn = (world: World): boolean => !!world.params.bossFrame;
const angleTo = (from: Vec, to: Vec): number => datan2(to.y - from.y, to.x - from.x);

/** Signed difference a − b brought into (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The core of `e`: itself for a core, its core for a part on the arena; undefined otherwise. */
export function jailerCore(world: World, e: Enemy): Enemy | undefined {
  if (e.kind === JAILER) return e;
  return e.partOf !== undefined ? world.enemies.find(c => c.id === e.partOf) : undefined;
}

/** The weight of `core` on the arena. */
const weightOf = (world: World, core: Enemy): Enemy | undefined => world.enemies.find(p => p.partOf === core.id && p.kind === JAILER_WEIGHT);
/** The weight is in the core's hand (on the arena, not lying). */
const inHand = (weight: Enemy | undefined): weight is Enemy => !!weight && weight.vars.lie === undefined;

/** The core's shield is up: the frame on, a core, not frozen, the arc wider than nothing. */
export function jailerShieldUp(world: World, e: Enemy): boolean {
  // Task 28: a core that stands without its shield (`StartEnemy.shieldless`: the run's viewer has not met the shieldbearer).
  return frameOn(world) && e.kind === JAILER && !e.vars.bare && !enemyFrozen(e) && world.params.shieldArc > 0;
}

// ---- Task 32 «Бесцветный Тюремщик, больше HP» ----

/** HP of the core at its spawn: `Params.jailerHp` (a journal without the key — `JAILER_HP`), at least 1. */
export const jailerHpOf = (params: Params): number => Math.max(1, Math.round(params.jailerHp ?? JAILER_HP));
/**
 * Task 32: `e` is a colourless core in this world (the frame and `Params.jailerColorless` on). Its parts keep their colours. Task 54:
 * the Chief's core in his open window (`Params.chiefFeast`; `vars.wo` and its hit not spent) is a link of the brew's colour.
 */
export const colorlessCore = (world: World, e: Pick<Enemy, 'kind'> & { vars?: Record<string, number> }): boolean => BOSS_CORES.includes(e.kind) && frameOn(world) && !!world.params.jailerColorless
  && !(e.kind === 'chief' && !!world.params.chiefFeast && !!e.vars?.wo && !e.vars.wh);

// ---- Task 28 «Тюремщик в походе»: the boss's death ends the fight (`Params.bossClears`) ----

/** The source of the crowd's deaths when the boss dies (`kill` events; not the player's, not an enemy ability's). */
export const BOSS_CLEAR = 'boss-clear';
/** Task 28: the boss's death ends the fight in this world (the frame and `bossClears` on). */
export const bossClearsOn = (world: World): boolean => frameOn(world) && !!world.params.bossClears;
/** Task 28: `e` is a boss core whose death ends the fight (the highlight stops the chain after it, chain.ts `planChain`). */
export const endsFight = (world: World, e: Pick<Enemy, 'kind'>): boolean => BOSS_CORES.includes(e.kind) && bossClearsOn(world);

/**
 * Task 28: the core `core` has just died (it is off the arena) — the fight ends: a dash running is over on the core (its links
 * after it are dropped, a pierce not started yet is cancelled), the markers and the queue are dropped, every enemy left dies
 * (`kill` of the source `boss-clear`, not credited), nothing spawns any more (`World.bossCleared`), the door opens.
 */
export function bossClear(world: World): void {
  world.bossCleared = true;
  const move = world.move;
  if (move?.kind === 'dash') {
    move.links = [];
    if (move.pierce && !move.pierce.start) { delete move.pierce; world.events.push({ type: 'pierce', phase: 'cancel' }); }
  }
  world.markers.length = 0;
  world.queue.length = 0;
  for (const e of [...world.enemies]) killEnemy(world, e, { source: BOSS_CLEAR, credited: false });
  if (world.status === 'playing' && world.stage === 'goals') completeGoals(world);
}

/** The point stands in the core's shield arc (within half of `shieldArc` of its facing), as the shieldbearer's. */
export function inJailerShield(world: World, e: Enemy, p: Vec): boolean {
  if (!jailerShieldUp(world, e) || dhypot(p.x - e.x, p.y - e.y) < 1e-6) return false;
  return Math.abs(angleDiff(angleTo(e, p), e.vars.facing ?? 0)) <= world.params.shieldArc * DEG / 2 + 1e-9;
}

/** The point is in the flail's half disc of `core` towards `dir`, padded by `pad` (a body's radius). */
export function inFlail(core: Vec, dir: number, p: Vec, pad: number): boolean {
  const dx = p.x - core.x, dy = p.y - core.y;
  return dhypot(dx, dy) <= FLAIL_RADIUS + pad && dx * dcos(dir) + dy * dsin(dir) >= -pad;
}

/** Where the weight hangs in the core's hand now (off walls, trees and cliffs). */
function holdPoint(world: World, core: Enemy, weight: Enemy): Vec {
  const a = (core.vars.facing ?? 0) + HOLD_ANGLE;
  const p = { x: core.x + WEIGHT_HOLD * dcos(a), y: core.y + WEIGHT_HOLD * dsin(a) };
  pushOutOfObstacles(p, bodyRadiusOf(world.params, weight), world.arena);
  return p;
}

/** The weight lies at `at` (off walls, trees and cliffs) for `seconds`. */
function layWeight(world: World, weight: Enemy, at: Vec, seconds: number): void {
  const p = { x: at.x, y: at.y };
  pushOutOfObstacles(p, bodyRadiusOf(world.params, weight), world.arena);
  weight.vars.lie = seconds; weight.vars.lx = p.x; weight.vars.ly = p.y;
  weight.x = p.x; weight.y = p.y;
}

/**
 * The move the Jailer winds up now, for the view (read only; as the archer's `archerMark`): `e` — the core or its part. `at` —
 * the core (the flail's centre), the throw's mark or the whistle's gate; `r` — the radius; the flail's direction `dir` and width
 * `arc` (radians); `progress` — the share of the windup gone (0…1; it strikes at 1). Null — no move, the fight is over, or the
 * frame is off.
 */
export function jailerMove(world: World, e: Enemy): { move: JailerMoveId; progress: number; at: Vec; r: number; dir?: number; arc?: number } | null {
  if (!frameOn(world) || world.status !== 'playing') return null;
  const core = jailerCore(world, e);
  const move = core?.kind === JAILER ? MOVE_OF[core.vars.mv ?? 0] ?? null : null;
  if (!core || !move) return null;
  const v = core.vars, progress = Math.max(0, Math.min(1, 1 - v.t / Math.max(1e-6, v.w)));
  if (move === 'flail') return { move, progress, at: { x: core.x, y: core.y }, r: FLAIL_RADIUS, dir: v.dir, arc: FLAIL_ARC };
  return { move, progress, at: { x: v.ax, y: v.ay }, r: move === 'throw' ? THROW_RADIUS : WHISTLE_RADIUS };
}

/** The gate of the arena farthest from the hero (the first of equals); null — the arena has none. Task 54: the Chief's «Свисток» too. */
export function farGate(world: World): Vec | null {
  let best: Vec | null = null, bestD = -1;
  for (const g of world.arena.gates ?? []) { const d = dist(g, world.hero); if (d > bestD) { best = g; bestD = d; } }
  return best;
}

/**
 * The conductor's pick among the open moves of the weight: a move used `EVENT_MAX` times in a row is left out (unless nothing
 * else is open), one passed over `MISSED_MAX` times is taken; else by `MOVE_WEIGHTS` — one draw of `behavior:jailer` only when
 * two or more stay. The counters of both moves follow the pick.
 */
function pickMove(world: World, v: Record<string, number>, open: readonly PoolMove[]): PoolMove {
  let cands = open.filter(m => (v[ROW[m]] ?? 0) < EVENT_MAX);
  if (!cands.length) cands = [...open];
  const forced = cands.find(m => (v[MISSED[m]] ?? 0) >= MISSED_MAX);
  let chosen: PoolMove = forced ?? cands[0];
  if (!forced && cands.length > 1) {
    const total = cands.reduce((s, m) => s + MOVE_WEIGHTS[m], 0);
    let r = world.rng.stream(STREAM).next() * total;
    for (const m of cands) { chosen = m; r -= MOVE_WEIGHTS[m]; if (r < 0) break; }
  }
  for (const m of POOL) {
    if (m === chosen) { v[ROW[m]] = (v[ROW[m]] ?? 0) + 1; v[MISSED[m]] = 0; }
    else { v[ROW[m]] = 0; v[MISSED[m]] = (v[MISSED[m]] ?? 0) + 1; }
  }
  return chosen;
}

/** A move begins its windup (×`FIRST_WINDUP_FACTOR` the first time in the fight); `at` — the throw's mark or the gate. */
function beginMove(world: World, core: Enemy, move: JailerMoveId, at: Vec | null): void {
  const v = core.vars, first = !v[USED[move]];
  v[USED[move]] = 1;
  const windup = JAILER_WINDUP * (first ? FIRST_WINDUP_FACTOR : 1);
  v.mv = CODE[move]; v.t = windup; v.w = windup;
  if (move === 'flail') v.dir = angleTo(core, world.hero);
  else if (at) { v.ax = at.x; v.ay = at.y; }
  world.events.push({ type: 'bossMove', id: core.id, move, stage: 'start' });
}

function endMove(v: Record<string, number>): void {
  delete v.mv; delete v.t; delete v.w; delete v.dir; delete v.ax; delete v.ay;
  v.cd = MOVE_GAP;
}

/** The boss and its parts are not hit by its own moves. */
const ownBody = (core: Enemy, e: Enemy): boolean => e === core || e.partOf === core.id;

/** «Кистень» strikes: the hero, the enemies thrown off (a cliff kills them, not the player's), the weight lies at the arc's end. */
function flailHit(world: World, core: Enemy, weight: Enemy): void {
  const p = world.params, dir = core.vars.dir ?? 0, hero = world.hero;
  if (world.status === 'playing' && inFlail(core, dir, hero, heroRadius(p))) {
    if (canBeHurt(world)) hurtHero(world, core, FLAIL_DAMAGE, 'flail');
    else noteBlock(world, core.x, core.y, 'flail', core.id);
  }
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => !ownBody(core, e) && inFlail(core, dir, e, bodyRadiusOf(p, e)));
  for (const e of struck) {
    const dx = e.x - core.x, dy = e.y - core.y, d = dhypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : dcos(dir), uy = d > 1e-6 ? dy / d : dsin(dir);
    e.x += ux * FLAIL_PUSH; e.y += uy * FLAIL_PUSH;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena, false);
  }
  if (struck.length) dropIntoCliffs(world, null, { source: 'flail', credited: false, fall: true });
  const end = dir - FLAIL_ARC / 2;
  layWeight(world, weight, { x: core.x + FLAIL_RADIUS * dcos(end), y: core.y + FLAIL_RADIUS * dsin(end) }, FLAIL_LIE);
}

/** «Бросок гири» lands: the hero and every enemy in the circle (not the boss; not the player's kills); the weight lies there. */
function throwHit(world: World, core: Enemy, weight: Enemy): void {
  const p = world.params, at = { x: core.vars.ax, y: core.vars.ay }, hero = world.hero;
  if (world.status === 'playing' && dist(hero, at) <= THROW_RADIUS + heroRadius(p)) {
    if (canBeHurt(world)) hurtHero(world, core, THROW_DAMAGE, 'throw');
    else noteBlock(world, at.x, at.y, 'throw', core.id);
  }
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => !ownBody(core, e) && dist(e, at) <= THROW_RADIUS + bodyRadiusOf(p, e));
  for (const e of struck) damageEnemy(world, e, THROW_DAMAGE, { source: 'throw', credited: false, firing: core.id });
  if (world.enemies.includes(weight)) layWeight(world, weight, at, THROW_LIE);
}

/** «Свисток» sounds: markers of plain enemies of the weight's colour at the gate (never elites; outside the arena limit). */
function whistleHit(world: World, core: Enemy): void {
  const v = core.vars, delay = world.params.markerDelay, color = v.wc ?? core.color;
  for (const o of ADD_OFFSETS.slice(0, WHISTLE_ADDS)) {
    const marker: SpawnMarker = { id: world.nextId++, kind: 'basic', x: v.ax + o.x, y: v.ay + o.y, color, hp: 0, timeLeft: delay, total: delay, plain: true };
    world.markers.push(marker);
  }
  v.wt = WHISTLE_PERIOD;
}

/** After the dash (no move of the hero runs): severed parts take plates off the core, the despair, the phase. */
function settle(world: World, core: Enemy): void {
  const v = core.vars;
  if (v.sever) {
    const n = v.sever, a = core.armor;
    delete v.sever;
    if (a && a.plates > 0) {
      a.plates = Math.max(0, a.plates - n);
      world.events.push({ type: 'bossPlate', id: core.id, plates: a.plates });
    }
  }
  // The weight is gone (severed): the Jailer drops the chain and runs at the hero, shield first.
  if (!v.despair && v.wc !== undefined && !weightOf(world, core)) { v.despair = 1; core.speedFactor *= DESPAIR_SPEED; }
  if (v.phase !== 2 && ((core.armor?.plates ?? 0) <= PHASE2_PLATES || world.time - (v.born ?? 0) >= PHASE2_TIME - TIME_EPS)) {
    v.phase = 2;
    v.wt = 0;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 2 });
  }
}

/** The conductor of one core (the group step, before anyone moves). */
function conduct(world: World, core: Enemy, dt: number): void {
  const v = core.vars;
  if (!world.move) settle(world, core);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.phase === 2 && (v.wt ?? 0) > 0) v.wt = Math.max(0, v.wt - dt);
  const weight = weightOf(world, core);
  if (v.mv) {
    const move = MOVE_OF[v.mv];
    // The weight was severed: its move winding up is dropped (nothing to swing or throw).
    if (move !== 'whistle' && !inHand(weight)) { endMove(v); return; }
    v.t -= dt;
    if (v.t > TIME_EPS) return;
    if (move === 'flail') flailHit(world, core, weight!);
    else if (move === 'throw') throwHit(world, core, weight!);
    else whistleHit(world, core);
    world.events.push({ type: 'bossMove', id: core.id, move: move!, stage: 'hit' });
    endMove(v);
    return;
  }
  v.cd = Math.max(0, (v.cd ?? 0) - dt);
  if (v.cd > TIME_EPS) return;
  if (v.phase === 2 && (v.wt ?? 0) <= TIME_EPS) {
    const gate = farGate(world);
    if (gate) { beginMove(world, core, 'whistle', gate); return; }
    v.wt = WHISTLE_PERIOD;
  }
  if (!inHand(weight)) return;
  const hero = world.hero, d = dist(core, hero), open: PoolMove[] = [];
  if (d <= FLAIL_REACH) open.push('flail');
  if (d <= THROW_RANGE && lineOfSight(core, hero, world.arena, 0.05)) open.push('throw');
  if (!open.length) return;
  const move = pickMove(world, v, open);
  beginMove(world, core, move, move === 'throw' ? { x: hero.x, y: hero.y } : null);
}

/** The core's shield turns to the hero at `shieldTurn` (game time; the cold stops it — the step does not run). */
function turnToHero(world: World, e: Enemy, dt: number): void {
  const want = angleTo(e, world.hero), facing = e.vars.facing ?? want;
  const d = angleDiff(want, facing), turn = world.params.shieldTurn * DEG * dt;
  e.vars.facing = Math.abs(d) <= turn ? want : angleDiff(facing + Math.sign(d) * turn, 0);
}

registerBehavior({
  id: 'jailer',
  onSpawn(world, e) {
    if (!frameOn(world)) return;
    if (e.kind === JAILER) {
      e.armor = { plates: JAILER_PLATES, max: JAILER_PLATES, boss: true };
      e.vars.facing = angleTo(e, world.hero); e.vars.born = world.time; e.vars.cd = FIRST_MOVE_DELAY; e.vars.phase = 1;
      return;
    }
    // A part joins the last core on the arena that has none yet (the template stands the core first).
    let core: Enemy | undefined;
    for (let i = world.enemies.length - 1; i >= 0 && !core; i--) {
      const c = world.enemies[i];
      if (c !== e && c.kind === JAILER && c.vars.wc === undefined) core = c;
    }
    if (!core) return;
    e.partOf = core.id;
    e.armor = { plates: WEIGHT_PLATES, max: WEIGHT_PLATES, boss: true };
    core.vars.wc = e.color;
    const at = holdPoint(world, core, e);
    e.x = at.x; e.y = at.y;
  },
  step(world, e, dt) {
    if (!frameOn(world)) return false;
    if (e.kind === JAILER) { turnToHero(world, e, dt); return !!e.vars.mv; }
    if (e.partOf === undefined) return false;
    const core = world.enemies.find(c => c.id === e.partOf);
    // Its core died: the part stands until the dash is over (then it dies with it).
    if (!core) return true;
    const v = e.vars;
    if (v.lie !== undefined) {
      v.lie -= dt;
      if (v.lie > TIME_EPS) { e.x = v.lx; e.y = v.ly; return true; }
      delete v.lie; delete v.lx; delete v.ly;
    }
    const at = holdPoint(world, core, e);
    e.x = at.x; e.y = at.y;
    return true;
  },
  canBeLinkedFrom: (world, e, anchor) => !inJailerShield(world, e, anchor),
  onDeath(world, e, cause) {
    if (!frameOn(world)) return;
    // Task 28: the core's death ends the fight (`Params.bossClears`; without it the crowd lives on, as before).
    if (e.kind === JAILER) { if (bossClearsOn(world) && !world.bossCleared) bossClear(world); return; }
    if (e.partOf === undefined) return;
    const core = world.enemies.find(c => c.id === e.partOf);
    if (!core) return;
    core.vars.sever = (core.vars.sever ?? 0) + 1;
    world.events.push({ type: 'partSevered', id: e.id, x: e.x, y: e.y });
    // Task 28 (`Params.bossPartLoot`, the run): a part the player severed drops its loot as an armoured elite does.
    if (world.params.bossPartLoot && cause.credited) dropArmorLoot(world, e);
  },
  beforeStep(world, members, dt) {
    if (!frameOn(world)) return;
    for (const e of members) {
      if (!world.enemies.includes(e)) continue;
      if (e.kind === JAILER) { conduct(world, e, dt); continue; }
      // The core is dead: its parts die with it once the dash is over (not the player's kill).
      if (e.partOf !== undefined && !world.move && !world.enemies.some(c => c.id === e.partOf)) killEnemy(world, e, { source: JAILER, credited: false });
    }
  },
});

registerEnemyKind({
  id: JAILER,
  behavior: 'jailer',
  speedClass: 'normal',
  hp: jailerHpOf,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: false,
  chainable: true,
  hitSource: 'touch',
});

registerEnemyKind({
  id: JAILER_WEIGHT,
  behavior: 'jailer',
  speedClass: 'normal',
  hp: () => WEIGHT_HP,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: false,
  chainable: true,
  hitSource: 'touch',
});
