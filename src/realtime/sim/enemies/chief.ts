/**
 * Task 54 «Главарь с котелком» (design 17.10.2026, docs/design-notes/task-54-chief.md; the rules — docs/realtime-elite-behaviors.md,
 * «Главарь (задача 54)»): the boss of the camp's branch on the frame of the Jailer and the Troll (enemies/jailer.ts, troll.ts). Only
 * while `Params.bossFrame` is on (the arena «Стан Главаря», sim/arenasBoss.ts, turns it on for itself); without it the three kinds
 * are plain enemies that walk to the hero.
 *
 * **The body.** The core (`chief`, colourless with `jailerColorless` outside his window, HP `chiefHp`, `chiefPlates` boss plates)
 * stands by his cauldron (`ArenaTemplate.chief.cauldron`): a common body held at its spot (the view draws it large). His parts — the
 * ladle (`chief-ladle`, HP 3, a plate) and the sack (`chief-sack`, HP 3) — are enemies of the common body with two colours the seed
 * rolls (not a stream), held at their spots. A part that dies (any cause) is severed: its move never starts again (one winding up is
 * dropped), the core loses a plate after the hero's move (the frame's rule). The bodies are solid for the hero with
 * `Params.trollSolid` (task 48, design 24.10: the boss's bodies). The core's death ends the fight (`bossClears`).
 *
 * **The brew** — a colour of the fight's palette (the stream `chief:brew`: the first at the core's spawn, then each «Приправа» — a
 * colour other than the last). The core's `color` is the brew all along.
 *
 * **«Обед!»** (`feast`, the core's, by its timer: the first windup `FIRST_FEAST_DELAY` s into the fight, then `chiefFeastGap` s after
 * each window, `FEAST_GAP_P3` in phase 3): `FEAST_WINDUP` s (the first ×`FIRST_WINDUP_FACTOR`); the strike waits for the hero's move.
 * Then every enemy within `FEAST_RADIUS` of the cauldron — not the boss's own, not an elite, not a link of the drawn chain — takes the
 * brew's colour for good (event `enemySignal` `recolor`); `FEAST_EATERS` plain enemies of the brew (HP 0, no elites) appear on the
 * eaters' seats (`ArenaTemplate.chief.seats`; a seat too near the hero or taken — the nearest free one, none — skipped; at most
 * `FEAST_EATERS_MAX` eaters alive) and sit `chiefFeastTime` s (`vars.sit`: no walk; world.ts `moveEnemies`), then walk as any; the
 * window opens for `chiefFeastTime` s.
 *
 * **The window** (`Params.chiefFeast`, design 7). Outside it the core is closed: the chain refuses it (chain.ts `outOfWindow`) and
 * nothing else hurts it (`chiefWards`: world.ts `damageEnemy`, the dash's strike, the pierce's; event `chiefFeast` `block`). In the
 * window the core is a link of the brew's colour, taken only with `chiefFeastLinks` enemy links of the brew's colour before it in the
 * chain («в очередь», chain.ts `queue`); one hit per window — the chain's only (every other source never lands on the core:
 * the pierce, the seal, the return run, the end's shadows pass it by, chain.ts); with `chiefFeastBig` (0 — off) links of the queue or
 * more the hit takes two plates (one plate left — the plate and 1 HP, never the last HP). The window's timer stands while a move of
 * the hero runs; it closes once the move that struck the core is over, or when its time is out — then the core in the drawn chain
 * drops out of it with the links after it (event `chiefFeast` `unlink`; chain.ts `planChain(...).chiefDrop`); a drawn chain whose
 * queue lost a link (it died) drops the core the same way. Without the key the core takes every hit; the feast still recolours and
 * seats its eaters, the window still opens and closes (the view).
 *
 * **The moves** (the conductor — the group step; the parts' moves: the stream `behavior:chief`, one draw only when both are open, a
 * move used `EVENT_MAX` times in a row is left out, one passed over `MISSED_MAX` times is taken). One windup at a time: «Обед!»,
 * «Приправа» and «Свисток» come first when due (they wait for a windup running), the parts' moves rest `MOVE_GAP` s between them, the
 * first comes `FIRST_MOVE_DELAY` s into the fight, the first use of a move winds up ×`FIRST_WINDUP_FACTOR`.
 * - «Взмах половником» (`swing`, the ladle, the hero within `SWING_REACH` of the core): the half-disc of `SWING_RADIUS` towards the hero
 *   (fixed at the windup's start); −`SWING_DAMAGE` to the hero whose body touches it. No enemy is hit (the eaters stay).
 * - «Горсть перца» (`pepper`, the sack, the hero within `PEPPER_RANGE` and in sight): three circles of `PEPPER_RADIUS` on the line
 *   core → hero — on his centre and ±`PEPPER_STEP` along it (fixed at the windup's start); −`PEPPER_DAMAGE` once to the hero whose
 *   body touches one. Phase 3: the windup ×`PHASE3_WINDUP`.
 * - «Приправа» (`season`, the sack: after each window while it lives): `SEASON_WINDUP` s, then a new brew (event `chiefBrew`).
 * - «Свисток» (`whistle`, phase 2+: at its start, then every `WHISTLE_PERIOD` s): `WHISTLE_WINDUP` s (the first ×1.5), then
 *   `WHISTLE_ADDS` markers of plain enemies at the gate farthest from the hero — the living parts' colours in turn, none — the brew's.
 * **Phases** (only forward, after the hero's move): 2 — the first part severed or `PHASE2_TIME` s; 3 — the core at `PHASE3_PLATES`
 * plates or fewer, or `PHASE3_TIME` s («Испытание V»: the times × the kit's `phaseScale`). 1 → 3 passes through 2.
 * The cold: the frozen core's timers wait (the windups, the rest, the window, the feast's gap, the whistle); a frozen part's windup
 * waits; an eater's sitting goes on. Numbers are hypotheses of the spec: the tests check the rules.
 *
 * State in `vars`. The core: `hx`, `hy` (its spot), `born`, `cd` (rest left), `phase`, `mv` (move winding up: 1 swing, 2 pepper,
 * 3 feast, 4 season, 5 whistle), `t` / `w` (windup left / whole), `dir` (the swing's direction), `ax`, `ay` (the pepper's centre, the
 * whistle's gate), `c1`, `c2` (the parts' colours), `br` (the brew), `fg` (to the next feast), `wo` (the window is open), `wl` (its
 * seconds left), `wh` (its hit landed), `wq` (the queue of the released chain that strikes the core), `wb` (the tick of the last
 * `block`), `sea` (a «Приправа» is due), `wt` (to the next whistle), `sever` (parts severed, not settled), `lost` (parts severed),
 * `rs`/`ms`, `rp`/`mp` (in a row / missed of swing, pepper), `us`, `up`, `uf`, `uw` (the move was used). A part: `hx`, `hy`. An
 * eater: `eat` (the chief's eater), `sit` (seconds left sitting).
 */
import { datan2, dcos, dhypot, dsin } from '../detMath';
import { dropArmorLoot } from '../elites';
import { dist, lineOfSight, type Vec } from '../geometry';
import { heroRadius, type Params } from '../params';
import { Rng, hashString } from '../rng';
import { palette, spawnEnemy, type SpawnMarker } from '../spawn';
import { canBeHurt, enemyFrozen, hurtHero, killEnemy, noteBlock, type ChainLink, type Enemy, type World } from '../world';
import { bossClear, bossClearsOn, farGate } from './jailer';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

/** The kinds of the Chief: his core and his two parts. */
export const CHIEF = 'chief';
export const CHIEF_LADLE = 'chief-ladle';
export const CHIEF_SACK = 'chief-sack';
export type ChiefMoveId = 'swing' | 'pepper' | 'feast' | 'season' | 'whistle';
/** Every move of the Chief (telegraphWindow.spec.ts checks each harmful one has a window record). */
export const CHIEF_MOVES: readonly ChiefMoveId[] = ['swing', 'pepper', 'feast', 'season', 'whistle'];
/** The hero's damage sources of the Chief's strikes (the touch of his body — `touch`). */
export const CHIEF_LADLE_SOURCE = 'chief-ladle';
export const CHIEF_PEPPER_SOURCE = 'chief-pepper';

// ---- Баланс (гипотезы спеки задачи 54, 17.10.2026; тесты проверяют правила, не числа) ----
/** The defaults of the Chief's keys (read on his arena only — a journal of another arena never reads them). */
export const CHIEF_HP = 2;
export const CHIEF_PLATES = 4;
export const FEAST_LINKS = 3;
export const FEAST_TIME = 4;
export const FEAST_GAP = 6;
export const FEAST_BIG = 6;
export const CHIEF_CROWD = 0.45;
export const FEAST_GAP_P3 = 4;
export const LADLE_HP = 3;
export const LADLE_PLATES = 1;
export const SACK_HP = 3;
export const FIRST_WINDUP_FACTOR = 1.5;
export const MOVE_GAP = 1.5;
export const FIRST_MOVE_DELAY = 2;
export const FIRST_FEAST_DELAY = 4;
export const SWING_REACH = 3.6;
export const SWING_RADIUS = 2.8;
export const SWING_WINDUP = 1;
export const SWING_DAMAGE = 2;
export const PEPPER_RANGE = 8;
export const PEPPER_RADIUS = 0.9;
export const PEPPER_STEP = 1.5;
export const PEPPER_WINDUP = 1;
export const PEPPER_DAMAGE = 2;
export const PHASE3_WINDUP = 0.8;
export const FEAST_WINDUP = 1.5;
export const FEAST_RADIUS = 4;
export const FEAST_EATERS = 4;
export const FEAST_EATERS_MAX = 8;
/** An eater never opens on the hero: a seat this much beyond the bodies' touch is taken. */
export const SEAT_HERO_GAP = 0.3;
export const SEASON_WINDUP = 0.6;
export const WHISTLE_WINDUP = 1;
export const WHISTLE_PERIOD = 15;
export const WHISTLE_ADDS = 4;
/** The whistle's circle at the gate (the view's sign; the markers stand inside it). */
export const WHISTLE_RADIUS = 1;
export const PHASE2_TIME = 30;
export const PHASE3_TIME = 70;
export const PHASE3_PLATES = 2;
export const EVENT_MAX = 2;
export const MISSED_MAX = 4;
export const MOVE_WEIGHTS: Readonly<Record<PartMove, number>> = { swing: 1, pepper: 1 };

/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;
const STREAM = 'behavior:chief';
const BREW_STREAM = 'chief:brew';
/** The salt of the parts' colours (a roll of the world's seed, not a stream: no stream state changes). */
const COLOR_SALT = 'chief:colors';
/** The core and its parts barely yield when bodies push apart (they are held at their spots). */
const PINNED_MASS = 100;
/** The markers of the whistle at the gate: a square of four. */
const ADD_OFFSETS: readonly Vec[] = [{ x: -0.35, y: -0.35 }, { x: 0.35, y: -0.35 }, { x: -0.35, y: 0.35 }, { x: 0.35, y: 0.35 }];

type PartMove = 'swing' | 'pepper';
const POOL: readonly PartMove[] = ['swing', 'pepper'];
const CODE: Readonly<Record<ChiefMoveId, number>> = { swing: 1, pepper: 2, feast: 3, season: 4, whistle: 5 };
const MOVE_OF: readonly (ChiefMoveId | null)[] = [null, 'swing', 'pepper', 'feast', 'season', 'whistle'];
const PART_OF: Readonly<Record<'swing' | 'pepper' | 'season', string>> = { swing: CHIEF_LADLE, pepper: CHIEF_SACK, season: CHIEF_SACK };
const USED: Readonly<Record<ChiefMoveId, string>> = { swing: 'us', pepper: 'up', feast: 'uf', season: 'ue', whistle: 'uw' };
const ROW: Readonly<Record<PartMove, string>> = { swing: 'rs', pepper: 'rp' };
const MISSED: Readonly<Record<PartMove, string>> = { swing: 'ms', pepper: 'mp' };
/** The colour var of each part on its core. */
const COLOR_VAR: Readonly<Record<string, string>> = { [CHIEF_LADLE]: 'c1', [CHIEF_SACK]: 'c2' };

const frameOn = (world: World): boolean => !!world.params.bossFrame;
const chiefHpOf = (params: Params): number => Math.max(1, Math.round(params.chiefHp ?? CHIEF_HP));
const chiefPlatesOf = (params: Params): number => Math.max(0, Math.round(params.chiefPlates ?? CHIEF_PLATES));
/** Enemy links of the brew's colour the core needs before it in the chain («в очередь»). */
export const feastLinksOf = (params: Params): number => Math.max(0, Math.round(params.chiefFeastLinks ?? FEAST_LINKS));
/** The window's and the eaters' seconds. */
export const feastTimeOf = (params: Params): number => Math.max(0.05, params.chiefFeastTime ?? FEAST_TIME);
const feastGapOf = (params: Params): number => Math.max(0, params.chiefFeastGap ?? FEAST_GAP);
/** The queue from which the hit takes two (0 — never). */
export const feastBigOf = (params: Params): number => Math.max(0, Math.round(params.chiefFeastBig ?? FEAST_BIG));
const angleTo = (from: Vec, to: Vec): number => datan2(to.y - from.y, to.x - from.x);

/** The Chief's core on the arena (the first). */
export const chiefCore = (world: World): Enemy | undefined => world.enemies.find(e => e.kind === CHIEF);
/** The part of `kind` of `core` on the arena. */
const partOfKind = (world: World, core: Enemy, kind: string): Enemy | undefined => world.enemies.find(p => p.partOf === core.id && p.kind === kind);
/** The part is there and not frozen (its move may start). */
const ready = (part: Enemy | undefined): part is Enemy => !!part && !enemyFrozen(part);
/** The cauldron's centre on the arena (the core's spot without the arena's data). */
const cauldronOf = (world: World, core: Vec): Vec => world.arena.chief?.cauldron ?? core;

// ---- The window ----

/** The core's window takes the chain's hit now: open and its hit not spent. */
const windowOpen = (v: Record<string, number>): boolean => !!v.wo && !v.wh;
/** The Chief's feast rules this world: the frame and `Params.chiefFeast` on. */
export const chiefFeastOn = (world: World): boolean => frameOn(world) && !!world.params.chiefFeast;
/** `e` is the Chief's core closed now (the refusal `outOfWindow`). */
export const chiefShut = (world: World, e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === CHIEF && chiefFeastOn(world) && !windowOpen(e.vars);
/** `e` is the Chief's core under the feast's rule: nothing but the chain lands on it (the pierce, the seal, the return run, the end's shadows pass it by). */
export const chiefGuarded = (world: World, e: Pick<Enemy, 'kind'>): boolean => e.kind === CHIEF && chiefFeastOn(world);

/** The queue of `links` before the index `upTo`: its enemy links of the brew's colour (`core` — the Chief's core). */
export function chiefQueue(world: World, core: Pick<Enemy, 'vars'>, links: readonly ChainLink[], upTo = links.length): number {
  const brew = core.vars.br;
  let n = 0;
  for (let i = 0; i < upTo && i < links.length; i++) {
    const l = links[i];
    if (l.kind !== 'enemy') continue;
    const e = world.enemies.find(x => x.id === l.id);
    if (e && e.kind !== CHIEF && e.color === brew) n++;
  }
  return n;
}
/** The core may not join the drawn chain now: its queue is short (the refusal `queue`; only under the feast's rule). */
export const chiefQueueShort = (world: World, e: Enemy): boolean => e.kind === CHIEF && chiefFeastOn(world) && chiefQueue(world, e, world.chain) < feastLinksOf(world.params);
/** The hit of a queue of `queue` links takes two (`chiefFeastBig`). */
export const chiefBig = (world: World, queue: number): boolean => { const big = feastBigOf(world.params); return big > 0 && queue >= big; };

/**
 * The strike's outcome on the core (the plan's and the dash's, the same `strike`): a plate hit of a big queue takes two plates — one
 * left: the plate and 1 HP (never the last). Any other strike, any other enemy, the rule off — as it is.
 */
export function chiefHitOutcome<T extends { plate?: boolean; platesAfter?: number; hpAfter: number; hpBefore: number }>(world: World, e: Pick<Enemy, 'kind'>, outcome: T, queue: number): T {
  if (e.kind !== CHIEF || !chiefFeastOn(world) || !outcome.plate || !chiefBig(world, queue)) return outcome;
  const before = (outcome.platesAfter ?? 0) + 1;
  if (before >= 2) return { ...outcome, platesAfter: before - 2 };
  return outcome.hpBefore > 1 ? { ...outcome, platesAfter: 0, hpAfter: outcome.hpBefore - 1 } : outcome;
}

/**
 * A hit of `source` on `e` now (world.ts `damageEnemy`, the dash's strike, the pierce's): true — it does not land (the core closed,
 * its window's hit spent, or not the chain's; event `chiefFeast` `block`, once a tick). The chain's hit in the window spends it
 * (event `hit` with the queue). Any other enemy, the frame or the rule off — false, nothing changes.
 */
export function chiefWards(world: World, e: Enemy, source: string): boolean {
  if (e.kind !== CHIEF || !chiefFeastOn(world)) return false;
  const v = e.vars;
  if (source === 'chain' && windowOpen(v)) {
    v.wh = 1;
    const links = v.wq ?? 0;
    world.events.push({ type: 'chiefFeast', action: chiefBig(world, links) ? 'big' : 'hit', id: e.id, colour: v.br ?? e.color, links, x: e.x, y: e.y });
    return false;
  }
  if (v.wb !== world.tick) { v.wb = world.tick; world.events.push({ type: 'chiefFeast', action: 'block', id: e.id, colour: v.br ?? e.color, source, x: e.x, y: e.y }); }
  return true;
}

/** The release of a chain with the core: its queue (the hit's two plates read it). */
export function chiefRelease(world: World, links: readonly ChainLink[]): void {
  const core = chiefCore(world);
  if (!core || !chiefFeastOn(world)) return;
  const index = links.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  if (index >= 0) core.vars.wq = chiefQueue(world, core, links, index);
}

/** The core's link in the drawn chain while its window is open: its index and the seconds before the window ends (and drops it). */
export function chiefLinkDrop(world: World, chain: readonly { kind: string; id: number }[]): { index: number; left: number } | null {
  const core = chiefCore(world);
  if (!core || !chiefFeastOn(world)) return null;
  const index = chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  return index >= 0 ? { index, left: Math.max(0, core.vars.wl ?? 0) } : null;
}

/** The core and the links after it leave the drawn chain (event `chiefFeast` `unlink`). */
function unlinkCore(world: World, core: Enemy): void {
  const index = world.chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  if (index < 0) return;
  const dropped = world.chain.slice(index).map(l => l.id);
  world.chain = world.chain.slice(0, index);
  delete world.chainClosed;
  world.events.push({ type: 'chiefFeast', action: 'unlink', id: core.id, colour: core.vars.br ?? core.color, x: core.x, y: core.y, dropped });
}

function openWindow(world: World, core: Enemy): void {
  const v = core.vars;
  v.wo = 1; v.wl = feastTimeOf(world.params);
  delete v.wh; delete v.wq;
  world.events.push({ type: 'chiefFeast', action: 'open', id: core.id, colour: v.br ?? core.color, x: core.x, y: core.y });
}

/** The window ends (no move of the hero runs): the core in the drawn chain drops out; the next feast's gap; «Приправа» while the sack lives. */
function closeWindow(world: World, core: Enemy): void {
  const v = core.vars;
  delete v.wo; delete v.wl; delete v.wh; delete v.wq;
  world.events.push({ type: 'chiefFeast', action: 'close', id: core.id, colour: v.br ?? core.color, x: core.x, y: core.y });
  v.fg = (v.phase ?? 1) >= 3 ? FEAST_GAP_P3 : feastGapOf(world.params);
  if (partOfKind(world, core, CHIEF_SACK)) v.sea = 1;
  if (chiefFeastOn(world)) unlinkCore(world, core);
}

// ---- The brew ----

/** A colour of the fight's palette other than `not` (the stream `chief:brew`; the palette of one colour — that one). */
function rollBrew(world: World, not: number | undefined): number {
  const colors = palette(world).filter(c => c !== not), pool = colors.length ? colors : palette(world);
  return pool[Math.floor(world.rng.stream(BREW_STREAM).next() * pool.length) % pool.length];
}

function setBrew(world: World, core: Enemy, colour: number): void {
  core.vars.br = colour; core.color = colour;
  world.events.push({ type: 'chiefBrew', id: core.id, colour });
}

// ---- The moves ----

/** The conductor's pick among the open moves of the parts (as the Jailer's: `EVENT_MAX`, `MISSED_MAX`, one draw when both stay). */
function pickMove(world: World, v: Record<string, number>, open: readonly PartMove[]): PartMove {
  let cands = open.filter(m => (v[ROW[m]] ?? 0) < EVENT_MAX);
  if (!cands.length) cands = [...open];
  const forced = cands.find(m => (v[MISSED[m]] ?? 0) >= MISSED_MAX);
  let chosen: PartMove = forced ?? cands[0];
  if (!forced && cands.length > 1) {
    const total = cands.reduce((s, m) => s + MOVE_WEIGHTS[m], 0);
    let r = world.rng.stream(STREAM).next() * total;
    for (const m of cands) { chosen = m; r -= MOVE_WEIGHTS[m]; if (r < 0) break; }
  }
  for (const m of POOL) {
    if (m === chosen) { v[ROW[m]] = (v[ROW[m]] ?? 0) + 1; v[MISSED[m]] = 0; }
    else if (open.includes(m)) { v[ROW[m]] = 0; v[MISSED[m]] = (v[MISSED[m]] ?? 0) + 1; }
  }
  return chosen;
}

/** A move begins its windup (×`FIRST_WINDUP_FACTOR` the first time in the fight, not «Приправа»; the pepper ×`PHASE3_WINDUP` in phase 3). */
function beginMove(world: World, core: Enemy, move: ChiefMoveId, gate?: Vec): void {
  const v = core.vars, hero = world.hero, first = !v[USED[move]];
  v[USED[move]] = 1;
  const k = move === 'season' ? 1 : (first ? FIRST_WINDUP_FACTOR : 1) * (move === 'pepper' && v.phase === 3 ? PHASE3_WINDUP : 1);
  const base = move === 'swing' ? SWING_WINDUP : move === 'pepper' ? PEPPER_WINDUP : move === 'feast' ? FEAST_WINDUP : move === 'season' ? SEASON_WINDUP : WHISTLE_WINDUP;
  if (move === 'swing') v.dir = angleTo(core, hero);
  else if (move === 'pepper') { v.ax = hero.x; v.ay = hero.y; }
  else if (move === 'whistle' && gate) { v.ax = gate.x; v.ay = gate.y; v.wt = WHISTLE_PERIOD; }
  if (move === 'season') delete v.sea;
  v.mv = CODE[move]; v.t = base * k; v.w = base * k;
  world.events.push({ type: 'bossMove', id: core.id, move, stage: 'start' });
}

function endMove(v: Record<string, number>, rest: boolean): void {
  delete v.mv; delete v.t; delete v.w; delete v.ax; delete v.ay; delete v.dir;
  if (rest) v.cd = MOVE_GAP;
}

/** The hero takes a strike of the Chief (or the protection notes its block). */
function strikeHero(world: World, core: Enemy, damage: number, source: string, at: Vec): void {
  if (canBeHurt(world)) hurtHero(world, core, damage, source);
  else noteBlock(world, at.x, at.y, source, core.id);
}

/** The distance from `p` to the half-disc of `r` around `c` facing the angle `dir` (0 — inside). */
export function halfDiscDistance(c: Vec, dir: number, r: number, p: Vec): number {
  const ux = dcos(dir), uy = dsin(dir), dx = p.x - c.x, dy = p.y - c.y;
  const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
  if (along >= 0) return Math.max(0, dhypot(dx, dy) - r);
  const clamped = Math.max(-r, Math.min(r, across));
  return dhypot(along, across - clamped);
}

/** The three circles of «Горсть перца»: on `at` (the hero's centre at the windup's start) and ±`PEPPER_STEP` along core → `at`. */
export function pepperCircles(core: Vec, at: Vec): Vec[] {
  const d = dist(core, at), ux = d > 1e-9 ? (at.x - core.x) / d : 1, uy = d > 1e-9 ? (at.y - core.y) / d : 0;
  return [{ x: at.x - ux * PEPPER_STEP, y: at.y - uy * PEPPER_STEP }, { x: at.x, y: at.y }, { x: at.x + ux * PEPPER_STEP, y: at.y + uy * PEPPER_STEP }];
}

function swingHit(world: World, core: Enemy): void {
  const p = world.params;
  if (world.status === 'playing' && halfDiscDistance(core, core.vars.dir ?? 0, SWING_RADIUS, world.hero) <= heroRadius(p)) strikeHero(world, core, SWING_DAMAGE, CHIEF_LADLE_SOURCE, world.hero);
}

function pepperHit(world: World, core: Enemy): void {
  const p = world.params, circles = pepperCircles(core, { x: core.vars.ax, y: core.vars.ay });
  const hit = circles.find(c => dist(world.hero, c) <= PEPPER_RADIUS + heroRadius(p));
  if (world.status === 'playing' && hit) strikeHero(world, core, PEPPER_DAMAGE, CHIEF_PEPPER_SOURCE, hit);
}

/**
 * A seat of an eater is free: no body on it — the hero's (with the touch's reach: an eater never opens on him) or an enemy's. The
 * markers' ring (`spawnMinDistance`) is not asked: the seats stand 1.6 from the core, the hero drawing the queue stands near them.
 */
function seatFree(world: World, at: Vec): boolean {
  const r = bodyRadiusOf(world.params, { kind: 'basic' } as Enemy);
  if (dist(at, world.hero) < heroRadius(world.params) + r + SEAT_HERO_GAP) return false;
  return !world.enemies.some(e => dist(e, at) < bodyRadiusOf(world.params, e) + r);
}

/** «Обед!» strikes: the brew's colour on the enemies round the cauldron, the eaters on their seats, the window. */
function feastHit(world: World, core: Enemy): void {
  const v = core.vars, brew = v.br ?? core.color, pot = cauldronOf(world, core), sit = feastTimeOf(world.params);
  const drawn = new Set(world.chain.flatMap(l => (l.kind === 'enemy' ? [l.id] : [])));
  for (const e of world.enemies) {
    if (e === core || e.partOf === core.id || e.elite || drawn.has(e.id) || e.color === brew || e.color < 0) continue;
    if (dist(e, pot) > FEAST_RADIUS) continue;
    e.color = brew;
    world.events.push({ type: 'enemySignal', enemyId: e.id, signal: 'recolor', x: e.x, y: e.y });
  }
  const seats = world.arena.chief?.seats ?? [];
  const used = new Set<number>();
  let eaters = world.enemies.filter(e => e.vars.eat).length;
  for (let i = 0; i < Math.min(FEAST_EATERS, seats.length) && eaters < FEAST_EATERS_MAX; i++) {
    let pick = -1;
    if (!used.has(i) && seatFree(world, seats[i])) pick = i;
    else {
      let best = Infinity;
      seats.forEach((s, j) => { const d = dist(s, seats[i]); if (!used.has(j) && j !== i && d < best && seatFree(world, s)) { best = d; pick = j; } });
    }
    if (pick < 0) continue;
    used.add(pick);
    const e = spawnEnemy(world, seats[pick], brew, 0, 'basic');
    e.vars.eat = 1; e.vars.sit = sit;
    eaters++;
  }
  openWindow(world, core);
}

/** «Приправа»: a new brew (not the last). */
function seasonHit(world: World, core: Enemy): void { setBrew(world, core, rollBrew(world, core.vars.br)); }

/** The colours of the whistle's adds: the living parts' in turn (ladle, sack); none left — the brew's. */
export function whistleColors(world: World, core: Enemy): readonly number[] {
  const parts = [CHIEF_LADLE, CHIEF_SACK].flatMap(kind => { const part = partOfKind(world, core, kind); return part ? [part.color] : []; });
  return parts.length ? parts : [core.vars.br ?? core.color];
}

/** «Свисток» sounds: markers of plain enemies at the gate (never elites; outside the arena limit). */
function whistleHit(world: World, core: Enemy): void {
  const v = core.vars, delay = world.params.markerDelay, colors = whistleColors(world, core);
  ADD_OFFSETS.slice(0, WHISTLE_ADDS).forEach((o, k) => {
    const marker: SpawnMarker = { id: world.nextId++, kind: 'basic', x: v.ax + o.x, y: v.ay + o.y, color: colors[k % colors.length], hp: 0, timeLeft: delay, total: delay, plain: true };
    world.markers.push(marker);
  });
}

/** After the hero's move: severed parts take plates off the core, the window ends, a drawn chain's short queue drops the core, the phase. */
function settle(world: World, core: Enemy): void {
  const v = core.vars;
  if (v.sever) {
    const n = v.sever, a = core.armor;
    delete v.sever;
    v.lost = (v.lost ?? 0) + n;
    if (a && a.plates > 0) {
      a.plates = Math.max(0, a.plates - n);
      world.events.push({ type: 'bossPlate', id: core.id, plates: a.plates });
    }
  }
  if (v.wo && (v.wh || (v.wl ?? 0) <= TIME_EPS)) closeWindow(world, core);
  else if (chiefFeastOn(world)) {
    // A link of the queue died while the chain is drawn: the core may not stay in it (the refusal's rule).
    const index = world.chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
    if (index >= 0 && chiefQueue(world, core, world.chain, index) < feastLinksOf(world.params)) unlinkCore(world, core);
  }
  const phase = v.phase ?? 1, lost = v.lost ?? 0, scale = world.kit?.phaseScale ?? 1, time = world.time - (v.born ?? 0);
  const third = phase < 3 && ((core.armor?.plates ?? 0) <= PHASE3_PLATES || time >= PHASE3_TIME * scale - TIME_EPS);
  if (phase < 2 && (third || lost >= 1 || time >= PHASE2_TIME * scale - TIME_EPS)) {
    v.phase = 2; v.wt = 0;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 2 });
  }
  if (third) {
    v.phase = 3;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 3 });
  }
}

/** The windup of the move running: a severed part drops it, a frozen part's waits; the strike waits for the hero's move. */
function windupStep(world: World, core: Enemy, dt: number): void {
  const v = core.vars, move = MOVE_OF[v.mv] ?? null;
  if (!move) { endMove(v, false); return; }
  const part = move === 'swing' || move === 'pepper' || move === 'season' ? partOfKind(world, core, PART_OF[move]) : undefined;
  if ((move === 'swing' || move === 'pepper' || move === 'season') && !part) { endMove(v, move !== 'season'); return; }
  if (part && enemyFrozen(part)) return;
  v.t = Math.max(0, v.t - dt);
  if (v.t > TIME_EPS || world.move) return;
  if (move === 'swing') swingHit(world, core);
  else if (move === 'pepper') pepperHit(world, core);
  else if (move === 'feast') feastHit(world, core);
  else if (move === 'season') seasonHit(world, core);
  else whistleHit(world, core);
  world.events.push({ type: 'bossMove', id: core.id, move, stage: 'hit' });
  endMove(v, move === 'swing' || move === 'pepper');
}

/** The eaters sit their time (game time, the cold or the core's state aside). */
function eatersStep(world: World, dt: number): void {
  for (const e of world.enemies) {
    if (!e.vars.eat || e.vars.sit === undefined) continue;
    e.vars.sit -= dt;
    if (e.vars.sit <= TIME_EPS) delete e.vars.sit;
  }
}

/** The conductor of the core (the group step, before anyone moves). */
function conduct(world: World, core: Enemy, dt: number): void {
  const v = core.vars;
  if (!world.move) settle(world, core);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.wo && !world.move) v.wl = Math.max(0, (v.wl ?? 0) - dt);
  if (!v.wo) v.fg = Math.max(0, (v.fg ?? 0) - dt);
  if ((v.phase ?? 1) >= 2) v.wt = Math.max(0, (v.wt ?? 0) - dt);
  if (v.mv) { windupStep(world, core, dt); return; }
  v.cd = Math.max(0, (v.cd ?? 0) - dt);
  if (v.sea && ready(partOfKind(world, core, CHIEF_SACK))) { beginMove(world, core, 'season'); return; }
  if (!v.wo && v.fg <= TIME_EPS) { beginMove(world, core, 'feast'); return; }
  if ((v.phase ?? 1) >= 2 && v.wt <= TIME_EPS) {
    const gate = farGate(world);
    if (gate) { beginMove(world, core, 'whistle', gate); return; }
    v.wt = WHISTLE_PERIOD;
  }
  if (v.cd > TIME_EPS || world.move) return;
  const hero = world.hero, d = dist(core, hero), open: PartMove[] = [];
  if (d <= SWING_REACH && ready(partOfKind(world, core, CHIEF_LADLE))) open.push('swing');
  if (d <= PEPPER_RANGE && ready(partOfKind(world, core, CHIEF_SACK)) && lineOfSight(core, hero, world.arena, 0.05)) open.push('pepper');
  if (!open.length) return;
  beginMove(world, core, pickMove(world, v, open));
}

/** Two colours of the fight's palette for the parts (ladle, sack): a roll of the world's seed with a salt (no stream). */
function partColors(world: World): number[] {
  const colors = [...palette(world)], rng = new Rng((world.rng.seed ^ hashString(COLOR_SALT)) >>> 0);
  for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
  return [0, 1].map(i => colors[i % colors.length]);
}

/** The body holds its spot (`hx`, `hy` — taken on its first step): no walk, no knockback. */
function holdSpot(e: Enemy): void {
  const v = e.vars;
  if (v.hx === undefined) { v.hx = e.x; v.hy = e.y; }
  e.x = v.hx; e.y = v.hy; e.knock = 0;
}

/** The eater sits now (world.ts `moveEnemies` holds it: no walk; a knockback still slides it). */
export const seatedEater = (e: Pick<Enemy, 'vars'>): boolean => (e.vars.sit ?? 0) > 0;

registerBehavior({
  id: CHIEF,
  onSpawn(world, e) {
    if (!frameOn(world)) return;
    if (e.kind === CHIEF) {
      const plates = chiefPlatesOf(world.params);
      e.armor = { plates, max: plates, boss: true };
      const [c1, c2] = partColors(world);
      Object.assign(e.vars, { born: world.time, cd: FIRST_MOVE_DELAY, fg: FIRST_FEAST_DELAY, phase: 1, c1, c2 });
      e.vars.br = rollBrew(world, undefined); e.color = e.vars.br;
      return;
    }
    // A part joins the last core on the arena (the template stands the core first).
    let core: Enemy | undefined;
    for (let i = world.enemies.length - 1; i >= 0 && !core; i--) if (world.enemies[i].kind === CHIEF) core = world.enemies[i];
    if (!core) return;
    e.partOf = core.id;
    if (e.kind === CHIEF_LADLE) e.armor = { plates: LADLE_PLATES, max: LADLE_PLATES, boss: true };
    e.color = core.vars[COLOR_VAR[e.kind]] ?? e.color;
  },
  step(world, e) {
    if (!frameOn(world)) return false;
    if (e.kind === CHIEF || e.partOf !== undefined) { holdSpot(e); return true; }
    return false;
  },
  // Task 48, design 24.10 (`Params.trollSolid`, the boss's bodies): the core and the parts are solid for the hero.
  solid: (world, e) => frameOn(world) && !!world.params.trollSolid && (e.kind === CHIEF || e.partOf !== undefined),
  onDeath(world, e, cause) {
    if (!frameOn(world)) return;
    if (e.kind === CHIEF) { if (bossClearsOn(world) && !world.bossCleared) bossClear(world); return; }
    if (e.partOf === undefined) return;
    const core = world.enemies.find(c => c.id === e.partOf);
    if (!core) return;
    core.vars.sever = (core.vars.sever ?? 0) + 1;
    world.events.push({ type: 'partSevered', id: e.id, x: e.x, y: e.y });
    if (world.params.bossPartLoot && cause.credited) dropArmorLoot(world, e);
  },
  beforeStep(world, members, dt) {
    if (!frameOn(world)) return;
    eatersStep(world, dt);
    for (const e of members) {
      if (!world.enemies.includes(e)) continue;
      if (e.kind === CHIEF) { conduct(world, e, dt); continue; }
      // The core is dead: its parts die with it once the move is over (not the player's kill).
      if (e.partOf !== undefined && !world.move && !world.enemies.some(c => c.id === e.partOf)) killEnemy(world, e, { source: CHIEF, credited: false });
    }
  },
});

const PART_HP: Readonly<Record<string, number>> = { [CHIEF_LADLE]: LADLE_HP, [CHIEF_SACK]: SACK_HP };
for (const id of [CHIEF, CHIEF_LADLE, CHIEF_SACK]) {
  const core = id === CHIEF;
  registerEnemyKind({
    id,
    behavior: CHIEF,
    speedClass: 'normal',
    hp: params => (core ? chiefHpOf(params) : PART_HP[id]),
    speed: world => world.pressure.enemySpeed,
    bodyScale: 1,
    artScale: 1,
    touchDamage: world => world.params.contactDamage,
    // Held at their spots by the frame (without it — plain enemies of mass 1).
    mass: world => (frameOn(world) ? PINNED_MASS : 1),
    spread: false,
    chainable: true,
    hitSource: 'touch',
  });
}

// ---- The Chief for the view (read only) ----

/**
 * The move the Chief winds up now: `progress` — the share of the windup gone (0…1; it strikes at 1, a strike that waits for the
 * hero's move stays at 1). `swing` — the half-disc round `at` (the core) of `r` facing `dir`; `pepper` — the three `circles` of `r`;
 * `feast` — the circle of `r` round the cauldron `at` and the `seats`; `season` — the cauldron `at`; `whistle` — the circle at the gate
 * `at`, `r`. Null — no move, the fight is over, or the frame is off.
 */
export function chiefMove(world: World): {
  move: ChiefMoveId; progress: number; at: Vec; r: number; dir?: number; circles?: Vec[]; seats?: Vec[];
} | null {
  const core = chiefCore(world);
  if (!frameOn(world) || world.status !== 'playing' || !core) return null;
  const v = core.vars, move = MOVE_OF[v.mv ?? 0];
  if (!move) return null;
  const progress = Math.max(0, Math.min(1, 1 - v.t / Math.max(1e-6, v.w))), pot = cauldronOf(world, core);
  if (move === 'swing') return { move, progress, at: { x: core.x, y: core.y }, r: SWING_RADIUS, dir: v.dir };
  if (move === 'pepper') return { move, progress, at: { x: v.ax, y: v.ay }, r: PEPPER_RADIUS, circles: pepperCircles(core, { x: v.ax, y: v.ay }) };
  if (move === 'feast') return { move, progress, at: { x: pot.x, y: pot.y }, r: FEAST_RADIUS, seats: (world.arena.chief?.seats ?? []).map(s => ({ x: s.x, y: s.y })) };
  if (move === 'season') return { move, progress, at: { x: pot.x, y: pot.y }, r: 0 };
  return { move, progress, at: { x: v.ax, y: v.ay }, r: WHISTLE_RADIUS };
}

/**
 * The Chief now: his core (`id`, `x`, `y`), the phase, the brew's colour, the cauldron, the queue he needs (`need`) and from which a
 * hit takes two (`big`, 0 — never), the queue of the drawn chain before him (`queue`), and his window: `open` (the chain's hit lands
 * now), `left` — its seconds left, `hit` — its hit landed (it closes after the hero's move); `rule` — the feast rules this world
 * (`chiefFeast`). Null — no Chief on the arena or the frame is off.
 */
export function chiefState(world: World): {
  id: number; x: number; y: number; phase: number; brew: number; cauldron: Vec; rule: boolean; need: number; big: number; queue: number;
  window: { open: boolean; left: number; hit: boolean } | null;
} | null {
  const core = chiefCore(world);
  if (!core || !frameOn(world)) return null;
  const v = core.vars, index = world.chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  return {
    id: core.id, x: core.x, y: core.y, phase: v.phase ?? 1, brew: v.br ?? core.color, cauldron: { ...cauldronOf(world, core) }, rule: chiefFeastOn(world),
    need: feastLinksOf(world.params), big: feastBigOf(world.params), queue: chiefQueue(world, core, world.chain, index >= 0 ? index : world.chain.length),
    window: v.wo ? { open: windowOpen(v), left: Math.max(0, v.wl ?? 0), hit: !!v.wh } : null,
  };
}
