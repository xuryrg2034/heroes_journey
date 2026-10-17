/**
 * Task 48 «Тролль» (design 16.10.2026, docs/design-notes/task-48-troll.md; the rules — docs/realtime-elite-behaviors.md, «Тролль
 * (задача 48)»): the boss of the forest on the frame of the Jailer (enemies/jailer.ts). Only while `Params.bossFrame` is on (the
 * arena «Берлога тролля», sim/arenasBoss.ts, turns it on for itself); without it the four kinds are plain enemies that walk to the hero.
 *
 * **The body.** The core (`troll`, colourless with `jailerColorless`, HP `trollHp`, `trollPlates` boss plates) sits in the mouth of
 * its den: its body is common (`TROLL_BODY_SCALE` 1; the view draws it large), held at its spot by its own step every tick (no walk, no knockback, mass `PINNED_MASS`).
 * Its parts — the club (`troll-club`, HP 4, a plate), the rock (`troll-rock`, HP 3) and the tail (`troll-tail`, HP 4, a plate) — are
 * enemies of the common body with the colours the seed rolls (three of the fight's palette, not a stream: `partColors`), held at
 * their spots (a club or a rock lies where it struck for a while). A part that dies (any cause) is severed: its move never starts
 * again (one winding up is dropped), the core loses a plate after the hero's move (the frame's rule). The core's death ends the fight
 * (`bossClears`).
 *
 * **The window** (`Params.trollWindow`, design 6). The core is closed outside a window its own moves open: 1.5 s after «Удар
 * дубиной» (`trollWindowClub`), 1.0 s after «Хвост метёт» (`trollWindowTail`), the whole «Храп» (`trollSnore`). Closed — the chain
 * refuses it (chain.ts, `outOfWindow`), and no other source hurts it (`trollWards`: world.ts `damageEnemy`, the dash's strike, the
 * pierce's; event `trollWindow` `block`). One hit per window: the first hit of any source acts as usual, the window closes once the
 * hero's move that struck it is over (its timer never ends while a move runs). The one hit is held for the hero: a drawn chain with
 * the core, and a released move whose plan strikes it (`trollReserve`: the dash's links, the pierce's bodies, the fixed return run,
 * the seal), keep every other source off the core until that move is over. The window ending while the core is in the drawn chain
 * takes the core and the links after it out of the chain (event `trollWindow` `unlink`; chain.ts `planChain(...).trollDrop`).
 * Without the key the core takes every hit; the windows still open and close (the view, «Храп»).
 *
 * **The moves** (the conductor — the group step: the stream `behavior:troll`, one draw only when two or more moves are open; a move
 * used `EVENT_MAX` times in a row is left out, one passed over `MISSED_MAX` times is taken). They rest `MOVE_GAP` s between them, the
 * first comes `FIRST_MOVE_DELAY` s into the fight, the first use of a part's move winds up ×`FIRST_WINDUP_FACTOR`; phase 3 — the
 * club's and the rock's windups ×`PHASE3_WINDUP` (not the tail's: design 16.10.2026, spec 24.4). A strike due while a move of the hero runs waits for its end (the highlight stays what the dash does).
 * - «Удар дубиной» (`club`, the club in hand, the hero within `CLUB_REACH` of the core): a lane `CLUB_LENGTH` × `CLUB_WIDTH` from the
 *   core's edge to the hero (fixed at the windup's start); −`CLUB_DAMAGE` to the hero whose body touches it, −2 to every enemy in it
 *   (not the boss; not the player's). The club lies at the lane's end `CLUB_LIE` s; the window opens.
 * - «Бросок камня» (`rock`, the rock in hand, the hero within `ROCK_RANGE` and in sight): a circle of `ROCK_RADIUS` on the hero's
 *   centre at the windup's start; the windup and the flight `ROCK_FLIGHT`; −2 to the hero and every enemy in it. The rock lies there
 *   `ROCK_LIE` s. No window.
 * - «Хвост метёт» (`tail`, phase 2+, the hero within `TAIL_REACH`): the ring `TAIL_INNER`…`TAIL_OUTER` around the core; −2 to the hero
 *   in it; the enemies in it thrown `TAIL_PUSH` outwards (not the player's). The window opens.
 * - «Рык» (`roar`, phase 2+: at its start, then every `trollRoarPeriod` s): `ROAR_WINDUP` s, then a wolf marker (`ROAR_MARKER` s) at
 *   each gate of the arena (`ArenaTemplate.gates`), while fewer than `ROAR_WOLVES_MAX` wolves stand (the fight has no other wolves);
 *   their colours — the living parts' in turn (club, rock, tail), none left — the palette's.
 * - «Храп» (`snore`, phase 3: at its start, then every `SNORE_PERIOD` s): `trollSnore` s asleep, the window open all along; the parts
 *   do not strike. Left alone — +`trollSnoreRegrow` plates (not above the start's); struck — he wakes, nothing regrows.
 * **Phases** (only forward, after the hero's move): 2 — the first part severed or `PHASE2_TIME` s; 3 — two parts severed, the core at
 * `PHASE3_PLATES` plates or fewer, or `PHASE3_TIME` s («Испытание V»: the times × the kit's `phaseScale`). 1 → 3 passes through 2.
 * The cold: the frozen core's timers wait (the windups, the rest, the window, «Храп»); a frozen part's windup waits. Numbers are
 * hypotheses of the spec: the tests check the rules.
 *
 * State in `vars`. The core: `hx`, `hy` (its spot), `born`, `cd` (rest left), `phase`, `mv` (move winding up: 1 club, 2 rock, 3 tail,
 * 4 roar), `t` / `w` (windup left / whole), `ax`, `ay`, `bx`, `by` (the club's lane, the rock's mark), `c1`…`c3` (the parts' colours),
 * `wo` (the window is open), `wl` (its seconds left), `ws` (its source: 1 club, 2 tail, 3 snore), `wh` (its hit landed), `wr` (the
 * running move holds its hit), `wb` (the tick of the last `block`), `ro` (to the next roar), `sn` (to the next snore), `sever`
 * (parts severed, not settled), `lost` (parts severed), `rc`/`mc`, `rr`/`mr`, `ra`/`ma` (in a row / missed of club, rock, tail),
 * `uc`, `ur`, `ut` (the move was used). A part: `hx`, `hy` (its spot), `lie`, `lx`, `ly` (lying: seconds left, the spot).
 */
import { datan2, dcos, dhypot, dsin } from '../detMath';
import { dropArmorLoot } from '../elites';
import { dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius, type Params } from '../params';
import { Rng, hashString } from '../rng';
import { palette, type SpawnMarker } from '../spawn';
import { canBeHurt, damageEnemy, dropIntoCliffs, enemyFrozen, hurtHero, killEnemy, noteBlock, type Enemy, type World } from '../world';
import { bossClear, bossClearsOn } from './jailer';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

/** The kinds of the Troll: his core and his three parts. */
export const TROLL = 'troll';
export const TROLL_CLUB = 'troll-club';
export const TROLL_ROCK = 'troll-rock';
export const TROLL_TAIL = 'troll-tail';
export type TrollMoveId = 'club' | 'rock' | 'tail' | 'roar' | 'snore';
/** Every move of the Troll (telegraphWindow.spec.ts checks each has a window record). */
export const TROLL_MOVES: readonly TrollMoveId[] = ['club', 'rock', 'tail', 'roar', 'snore'];
/** The hero's damage sources of the Troll's strikes (the touch of his body — `touch`). */
export const TROLL_CLUB_SOURCE = 'troll-club';
export const TROLL_ROCK_SOURCE = 'troll-rock';
export const TROLL_TAIL_SOURCE = 'troll-tail';

// ---- Баланс (гипотезы спеки задачи 48, 16.10.2026; тесты проверяют правила, не числа) ----
/** The defaults of the Troll's keys (journals without them). */
// Design 16.10.2026 (spec 24.11): HP 2, 4 plates (the bot's grid: between the Jailer and the full Castellan); the crowd ×0.3 —
// design 17.10.2026 (spec 24.17, the bot's crowd sweep; ×0.45 before).
export const TROLL_HP = 2;
export const TROLL_PLATES = 4;
export const TROLL_WINDOW_CLUB = 1.5;
export const TROLL_WINDOW_TAIL = 1;
export const TROLL_SNORE = 4;
export const TROLL_SNORE_REGROW = 1;
export const TROLL_ROAR_PERIOD = 20;
/** The crowd's factor the arena «Берлога тролля» puts (`Params.trollCrowd` when the values hold 1). */
export const TROLL_CROWD = 0.3;
/**
 * The core's body and art: × the common size. Design 16.10.2026 (spec 24.2, question В9): ×1 — the body ×2 was shifted up to 0.79 off
 * its spot by the hero's parting; the drawing is large in the view (as the Jailer's), the body of the simulation is common.
 */
export const TROLL_BODY_SCALE = 1;
/** The core and its parts barely yield when bodies push apart (they are held at their spots). */
const PINNED_MASS = 100;
export const CLUB_HP = 4;
export const CLUB_PLATES = 1;
export const ROCK_HP = 3;
export const TAIL_HP = 4;
export const TAIL_PLATES = 1;
export const FIRST_WINDUP_FACTOR = 1.5;
export const MOVE_GAP = 1.5;
export const FIRST_MOVE_DELAY = 2;
export const CLUB_REACH = 5.4;
export const CLUB_LENGTH = 4.5;
export const CLUB_WIDTH = 1.6;
export const CLUB_WINDUP = 1;
export const CLUB_DAMAGE = 2;
export const CLUB_LIE = 1.5;
export const ROCK_RANGE = 9;
export const ROCK_RADIUS = 1.2;
export const ROCK_WINDUP = 0.8;
export const ROCK_FLIGHT = 0.4;
export const ROCK_DAMAGE = 2;
export const ROCK_LIE = 2;
export const TAIL_REACH = 3.6;
export const TAIL_INNER = 1.2;
export const TAIL_OUTER = 3.2;
export const TAIL_WINDUP = 1.2;
export const TAIL_DAMAGE = 2;
export const TAIL_PUSH = 1.5;
/** Damage of the club's lane and the rock's circle to an enemy in it (not the player's kills). */
export const ENEMY_DAMAGE = 2;
export const ROAR_WINDUP = 1.5;
export const ROAR_MARKER = 1;
export const ROAR_WOLVES_MAX = 4;
/** The roar's circle at a gate (the view's sign; the marker stands in it). */
export const ROAR_RADIUS = 1;
export const SNORE_PERIOD = 12;
export const PHASE2_TIME = 30;
export const PHASE3_TIME = 70;
export const PHASE3_PLATES = 2;
export const PHASE3_WINDUP = 0.8;
export const EVENT_MAX = 2;
export const MISSED_MAX = 4;
export const MOVE_WEIGHTS: Readonly<Record<PartMove, number>> = { club: 1, rock: 1, tail: 1 };

/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;
const STREAM = 'behavior:troll';
/** The salt of the parts' colours (a roll of the world's seed, not a stream: no stream state changes). */
const COLOR_SALT = 'troll:colors';
/** The sources of the hero's own moves: they may take the hit a released move holds (`trollReserve`). */
const OWN_SOURCES: readonly string[] = ['chain', 'pierce', 'hammer-return', 'seal'];

type PartMove = 'club' | 'rock' | 'tail';
const POOL: readonly PartMove[] = ['club', 'rock', 'tail'];
const CODE: Readonly<Record<Exclude<TrollMoveId, 'snore'>, number>> = { club: 1, rock: 2, tail: 3, roar: 4 };
const MOVE_OF: readonly (TrollMoveId | null)[] = [null, 'club', 'rock', 'tail', 'roar'];
const PART_OF: Readonly<Record<PartMove, string>> = { club: TROLL_CLUB, rock: TROLL_ROCK, tail: TROLL_TAIL };
const USED: Readonly<Record<PartMove, string>> = { club: 'uc', rock: 'ur', tail: 'ut' };
const ROW: Readonly<Record<PartMove, string>> = { club: 'rc', rock: 'rr', tail: 'ra' };
const MISSED: Readonly<Record<PartMove, string>> = { club: 'mc', rock: 'mr', tail: 'ma' };
/** The colour var of each part on its core. */
const COLOR_VAR: Readonly<Record<string, string>> = { [TROLL_CLUB]: 'c1', [TROLL_ROCK]: 'c2', [TROLL_TAIL]: 'c3' };
/** The window's sources (`vars.ws`). */
export type TrollWindowSource = 'club' | 'tail' | 'snore';
const WINDOW_SOURCES: readonly (TrollWindowSource | null)[] = [null, 'club', 'tail', 'snore'];
const SNORE_CODE = 3;

const frameOn = (world: World): boolean => !!world.params.bossFrame;
const trollHpOf = (params: Params): number => Math.max(1, Math.round(params.trollHp ?? TROLL_HP));
const trollPlatesOf = (params: Params): number => Math.max(0, Math.round(params.trollPlates ?? TROLL_PLATES));
const windowClubOf = (world: World): number => Math.max(0.05, world.params.trollWindowClub ?? TROLL_WINDOW_CLUB);
const windowTailOf = (world: World): number => Math.max(0.05, world.params.trollWindowTail ?? TROLL_WINDOW_TAIL);
const snoreOf = (world: World): number => Math.max(0.05, world.params.trollSnore ?? TROLL_SNORE);
const regrowOf = (world: World): number => Math.max(0, Math.round(world.params.trollSnoreRegrow ?? TROLL_SNORE_REGROW));
const roarPeriodOf = (world: World): number => Math.max(1, world.params.trollRoarPeriod ?? TROLL_ROAR_PERIOD);
const angleTo = (from: Vec, to: Vec): number => datan2(to.y - from.y, to.x - from.x);

/** The Troll's core on the arena (the first). */
export const trollCore = (world: World): Enemy | undefined => world.enemies.find(e => e.kind === TROLL);
/** The part of `kind` of `core` on the arena. */
const partOfKind = (world: World, core: Enemy, kind: string): Enemy | undefined => world.enemies.find(p => p.partOf === core.id && p.kind === kind);
/** The part is in the Troll's hand: on the arena and not lying where it struck. */
const inHand = (part: Enemy | undefined): part is Enemy => !!part && part.vars.lie === undefined;
/** The core sleeps: «Храп» (its window). */
const sleeping = (v: Record<string, number>): boolean => !!v.wo && v.ws === SNORE_CODE;
/** The boss and its parts are not hit by its own moves. */
const ownBody = (core: Enemy, e: Enemy): boolean => e === core || e.partOf === core.id;

/** The distance from `p` to the segment `a → b`. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dhypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ---- The window ----

/** The core's window takes a hit now: open and its hit not spent. */
const windowOpen = (v: Record<string, number>): boolean => !!v.wo && !v.wh;
/** The Troll's window rules this world: the frame and `Params.trollWindow` on. */
export const trollWindowOn = (world: World): boolean => frameOn(world) && !!world.params.trollWindow;
/** `e` is the Troll's core closed now (the refusal `outOfWindow`; the pierce, the return run and the seal pass it by). */
export const trollShut = (world: World, e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === TROLL && trollWindowOn(world) && !windowOpen(e.vars);

/**
 * A hit of `source` on `e` now (world.ts `damageEnemy`, the dash's strike, the pierce's): true — it does not land (the core closed,
 * its window's hit spent, or the hit held for the hero's chain or move; event `trollWindow` `block`, once a tick). A hit that lands
 * in a window spends it (event `hit`). Any other enemy, the frame off — false, nothing changes. Without `trollWindow` every hit lands.
 */
export function trollWards(world: World, e: Enemy, source: string): boolean {
  if (e.kind !== TROLL || !frameOn(world)) return false;
  const v = e.vars, open = windowOpen(v);
  let lands = true;
  if (trollWindowOn(world)) {
    // Held for the hero: a released move whose plan strikes it (until the conductor's first step after it), or the drawn chain.
    const held = !!v.wr || (!world.move && world.chain.some(l => l.kind === 'enemy' && l.id === e.id));
    lands = open && (!held || OWN_SOURCES.includes(source));
  }
  if (lands) {
    if (open) { v.wh = 1; world.events.push({ type: 'trollWindow', action: 'hit', id: e.id, source, x: e.x, y: e.y }); }
    return false;
  }
  if (v.wb !== world.tick) { v.wb = world.tick; world.events.push({ type: 'trollWindow', action: 'block', id: e.id, source, x: e.x, y: e.y }); }
  return true;
}

/** The release of a move whose plan strikes the core (`ids` — the bodies it strikes): the core's hit is held for it until it is over. */
export function trollReserve(world: World, ids: readonly number[]): void {
  if (!trollWindowOn(world)) return;
  const core = trollCore(world);
  if (core && windowOpen(core.vars) && ids.includes(core.id)) core.vars.wr = 1;
}

/** The core's link in the drawn chain while its window is open: its index and the seconds before the window ends (and drops it). */
export function trollLinkDrop(world: World, chain: readonly { kind: string; id: number }[]): { index: number; left: number } | null {
  const core = trollCore(world);
  if (!core || !trollWindowOn(world)) return null;
  const index = chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  return index >= 0 ? { index, left: Math.max(0, core.vars.wl ?? 0) } : null;
}

function openWindow(world: World, core: Enemy, source: TrollWindowSource, seconds: number): void {
  const v = core.vars;
  if (v.wo) { v.wl = Math.max(v.wl ?? 0, seconds); return; }
  v.wo = 1; v.wl = seconds; v.ws = WINDOW_SOURCES.indexOf(source);
  delete v.wh;
  world.events.push({ type: 'trollWindow', action: 'open', id: core.id, source, x: core.x, y: core.y });
}

/** The window ends (no move of the hero runs): «Храп» slept through regrows; the core in the drawn chain drops out of it. */
function closeWindow(world: World, core: Enemy): void {
  const v = core.vars, source = WINDOW_SOURCES[v.ws ?? 0] ?? 'club', hit = !!v.wh;
  delete v.wo; delete v.wl; delete v.ws; delete v.wh;
  world.events.push({ type: 'trollWindow', action: 'close', id: core.id, source, x: core.x, y: core.y });
  if (source === 'snore') {
    v.cd = Math.max(v.cd ?? 0, MOVE_GAP);
    const a = core.armor;
    if (!hit) {
      world.events.push({ type: 'bossMove', id: core.id, move: 'snore', stage: 'hit' });
      const grown = a ? Math.min(a.max, a.plates + regrowOf(world)) : 0;
      if (a && grown > a.plates) { a.plates = grown; world.events.push({ type: 'bossPlate', id: core.id, plates: a.plates }); }
    }
  }
  if (!trollWindowOn(world)) return;
  const index = world.chain.findIndex(l => l.kind === 'enemy' && l.id === core.id);
  if (index < 0) return;
  const dropped = world.chain.slice(index).map(l => l.id);
  world.chain = world.chain.slice(0, index);
  delete world.chainClosed;
  world.events.push({ type: 'trollWindow', action: 'unlink', id: core.id, source, x: core.x, y: core.y, dropped });
}

// ---- The moves ----

/** The radius of the core's body (the club's lane starts at its edge). */
const coreRadius = (world: World, core: Enemy): number => bodyRadiusOf(world.params, core);

/** The conductor's pick among the open moves of the parts (as the Jailer's: `EVENT_MAX`, `MISSED_MAX`, one draw when two or more stay). */
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

/** A move begins its windup (a part's: ×`FIRST_WINDUP_FACTOR` the first time in the fight; the club's and the rock's ×`PHASE3_WINDUP` in phase 3). */
function beginMove(world: World, core: Enemy, move: Exclude<TrollMoveId, 'snore'>): void {
  const v = core.vars, hero = world.hero;
  let windup = ROAR_WINDUP;
  if (move !== 'roar') {
    const first = !v[USED[move]];
    v[USED[move]] = 1;
    // Phase 3 speeds the club and the rock up, never the tail (its ring's worst point — a landing on a severed part — needs the time).
    const k = (first ? FIRST_WINDUP_FACTOR : 1) * (v.phase === 3 && move !== 'tail' ? PHASE3_WINDUP : 1);
    windup = move === 'club' ? CLUB_WINDUP * k : move === 'rock' ? ROCK_WINDUP * k + ROCK_FLIGHT : TAIL_WINDUP * k;
  } else v.ro = roarPeriodOf(world);
  if (move === 'club') {
    const a = angleTo(core, hero), r = coreRadius(world, core), ux = dcos(a), uy = dsin(a);
    v.ax = core.x + ux * r; v.ay = core.y + uy * r; v.bx = v.ax + ux * CLUB_LENGTH; v.by = v.ay + uy * CLUB_LENGTH;
  } else if (move === 'rock') { v.ax = hero.x; v.ay = hero.y; }
  v.mv = CODE[move]; v.t = windup; v.w = windup;
  world.events.push({ type: 'bossMove', id: core.id, move, stage: 'start' });
}

function endMove(v: Record<string, number>): void {
  delete v.mv; delete v.t; delete v.w; delete v.ax; delete v.ay; delete v.bx; delete v.by;
  v.cd = MOVE_GAP;
}

/** The part lies at `at` (off walls, trees and cliffs) for `seconds`. */
function layPart(world: World, part: Enemy, at: Vec, seconds: number): void {
  const p = { x: at.x, y: at.y };
  pushOutOfObstacles(p, bodyRadiusOf(world.params, part), world.arena);
  part.vars.lie = seconds; part.vars.lx = p.x; part.vars.ly = p.y;
  part.x = p.x; part.y = p.y;
}

/** The hero takes a strike of the Troll (or the protection notes its block). */
function strikeHero(world: World, core: Enemy, damage: number, source: string, at: Vec): void {
  if (canBeHurt(world)) hurtHero(world, core, damage, source);
  else noteBlock(world, at.x, at.y, source, core.id);
}

/** «Удар дубиной» strikes: the hero whose body touches the lane, every enemy in it; the club lies at its end; the window opens. */
function clubHit(world: World, core: Enemy, club: Enemy): void {
  const v = core.vars, p = world.params, from = { x: v.ax, y: v.ay }, to = { x: v.bx, y: v.by };
  if (world.status === 'playing' && segmentDistance(from, to, world.hero) <= CLUB_WIDTH / 2 + heroRadius(p)) strikeHero(world, core, CLUB_DAMAGE, TROLL_CLUB_SOURCE, to);
  if (world.status !== 'playing') return;
  for (const e of world.enemies.filter(x => !ownBody(core, x) && !kindOf(x).immune && segmentDistance(from, to, x) <= CLUB_WIDTH / 2 + bodyRadiusOf(p, x))) {
    damageEnemy(world, e, ENEMY_DAMAGE, { source: TROLL_CLUB_SOURCE, credited: false, firing: core.id });
  }
  if (world.enemies.includes(club)) layPart(world, club, to, CLUB_LIE);
  openWindow(world, core, 'club', windowClubOf(world));
}

/** «Бросок камня» lands: the hero and every enemy in the circle; the rock lies there. */
function rockHit(world: World, core: Enemy, rock: Enemy): void {
  const p = world.params, at = { x: core.vars.ax, y: core.vars.ay };
  if (world.status === 'playing' && dist(world.hero, at) <= ROCK_RADIUS + heroRadius(p)) strikeHero(world, core, ROCK_DAMAGE, TROLL_ROCK_SOURCE, at);
  if (world.status !== 'playing') return;
  for (const e of world.enemies.filter(x => !ownBody(core, x) && dist(x, at) <= ROCK_RADIUS + bodyRadiusOf(p, x))) {
    damageEnemy(world, e, ENEMY_DAMAGE, { source: TROLL_ROCK_SOURCE, credited: false, firing: core.id });
  }
  if (world.enemies.includes(rock)) layPart(world, rock, at, ROCK_LIE);
}

/** The point is in the tail's ring around `core`, padded by `pad` (a body's radius). */
export function inTailRing(core: Vec, p: Vec, pad: number): boolean {
  const d = dist(core, p);
  return d <= TAIL_OUTER + pad && d >= TAIL_INNER - pad;
}

/** «Хвост метёт» strikes: the hero in the ring; the enemies in it are thrown outwards (a cliff kills them, not the player's); the window opens. */
function tailHit(world: World, core: Enemy): void {
  const p = world.params;
  if (world.status === 'playing' && inTailRing(core, world.hero, heroRadius(p))) strikeHero(world, core, TAIL_DAMAGE, TROLL_TAIL_SOURCE, world.hero);
  if (world.status !== 'playing') return;
  const struck = world.enemies.filter(e => !ownBody(core, e) && !kindOf(e).immune && inTailRing(core, e, bodyRadiusOf(p, e)));
  for (const e of struck) {
    const dx = e.x - core.x, dy = e.y - core.y, d = dhypot(dx, dy) || 1;
    e.x += dx / d * TAIL_PUSH; e.y += dy / d * TAIL_PUSH;
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena, false);
  }
  if (struck.length) dropIntoCliffs(world, null, { source: TROLL_TAIL_SOURCE, credited: false, fall: true });
  openWindow(world, core, 'tail', windowTailOf(world));
}

/** The colours of the roar's wolves: the living parts' in turn (club, rock, tail); none left — the palette's (the view's roar sign reads it too). */
export function wolfColors(world: World, core: Enemy): readonly number[] {
  const parts = [TROLL_CLUB, TROLL_ROCK, TROLL_TAIL].flatMap(kind => { const part = partOfKind(world, core, kind); return part ? [part.color] : []; });
  return parts.length ? parts : palette(world);
}

/** «Рык» sounds: a wolf marker at each gate while fewer than `ROAR_WOLVES_MAX` wolves stand (or wait in their markers). */
function roarHit(world: World, core: Enemy): void {
  const colors = wolfColors(world, core);
  let wolves = world.enemies.filter(e => e.kind === 'wolf').length + world.markers.filter(m => m.kind === 'wolf').length;
  (world.arena.gates ?? []).forEach((gate, k) => {
    if (wolves >= ROAR_WOLVES_MAX) return;
    const marker: SpawnMarker = { id: world.nextId++, kind: 'wolf', x: gate.x, y: gate.y, color: colors[k % colors.length], hp: 0, timeLeft: ROAR_MARKER, total: ROAR_MARKER, plain: true };
    world.markers.push(marker);
    wolves++;
  });
}

/** After the hero's move: the held hit is free, severed parts take plates off the core, the window ends, the phase. */
function settle(world: World, core: Enemy): void {
  const v = core.vars;
  delete v.wr;
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
  const phase = v.phase ?? 1, lost = v.lost ?? 0, scale = world.kit?.phaseScale ?? 1, time = world.time - (v.born ?? 0);
  const third = phase < 3 && (lost >= 2 || (core.armor?.plates ?? 0) <= PHASE3_PLATES || time >= PHASE3_TIME * scale - TIME_EPS);
  if (phase < 2 && (third || lost >= 1 || time >= PHASE2_TIME * scale - TIME_EPS)) {
    v.phase = 2; v.ro = 0;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 2 });
  }
  if (third) {
    v.phase = 3; v.sn = 0;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 3 });
  }
}

/** The windup of the move running: a severed (or lying) part drops it, a frozen part's waits; the strike waits for the hero's move. */
function windupStep(world: World, core: Enemy, dt: number): void {
  const v = core.vars, move = MOVE_OF[v.mv] ?? null;
  const part = move && move !== 'roar' && move !== 'snore' ? partOfKind(world, core, PART_OF[move]) : undefined;
  if (move !== 'roar' && !inHand(part)) { endMove(v); return; }
  if (part && enemyFrozen(part)) return;
  v.t = Math.max(0, v.t - dt);
  if (v.t > TIME_EPS || world.move) return;
  if (move === 'club') clubHit(world, core, part!);
  else if (move === 'rock') rockHit(world, core, part!);
  else if (move === 'tail') tailHit(world, core);
  else roarHit(world, core);
  world.events.push({ type: 'bossMove', id: core.id, move: move!, stage: 'hit' });
  endMove(v);
}

/** The conductor of the core (the group step, before anyone moves). */
function conduct(world: World, core: Enemy, dt: number): void {
  const v = core.vars;
  if (!world.move) settle(world, core);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.wo) v.wl = Math.max(0, (v.wl ?? 0) - dt);
  if ((v.phase ?? 1) >= 2) v.ro = Math.max(0, (v.ro ?? 0) - dt);
  if ((v.phase ?? 1) >= 3) v.sn = Math.max(0, (v.sn ?? 0) - dt);
  if (v.mv) { windupStep(world, core, dt); return; }
  if (sleeping(v)) return;
  v.cd = Math.max(0, (v.cd ?? 0) - dt);
  if (v.cd > TIME_EPS || world.move) return;
  if ((v.phase ?? 1) >= 2 && v.ro <= TIME_EPS) {
    if (world.arena.gates?.length) { beginMove(world, core, 'roar'); return; }
    v.ro = roarPeriodOf(world);
  }
  if ((v.phase ?? 1) >= 3 && v.sn <= TIME_EPS && !v.wo) {
    v.sn = SNORE_PERIOD;
    openWindow(world, core, 'snore', snoreOf(world));
    world.events.push({ type: 'bossMove', id: core.id, move: 'snore', stage: 'start' });
    return;
  }
  const hero = world.hero, d = dist(core, hero), open: PartMove[] = [];
  const ready = (kind: string): boolean => { const part = partOfKind(world, core, kind); return inHand(part) && !enemyFrozen(part); };
  if (d <= CLUB_REACH && ready(TROLL_CLUB)) open.push('club');
  if (d <= ROCK_RANGE && ready(TROLL_ROCK) && lineOfSight(core, hero, world.arena, 0.05)) open.push('rock');
  if ((v.phase ?? 1) >= 2 && d <= TAIL_REACH && ready(TROLL_TAIL)) open.push('tail');
  if (!open.length) return;
  beginMove(world, core, pickMove(world, v, open));
}

/** Three colours of the fight's palette for the parts (club, rock, tail): a roll of the world's seed with a salt (no stream). */
function partColors(world: World): number[] {
  const colors = [...palette(world)], rng = new Rng((world.rng.seed ^ hashString(COLOR_SALT)) >>> 0);
  for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
  return [0, 1, 2].map(i => colors[i % colors.length]);
}

/** The body holds its spot (`hx`, `hy` — taken on its first step): no walk, no knockback. */
function holdSpot(e: Enemy): void {
  const v = e.vars;
  if (v.hx === undefined) { v.hx = e.x; v.hy = e.y; }
  e.x = v.hx; e.y = v.hy; e.knock = 0;
}

registerBehavior({
  id: TROLL,
  onSpawn(world, e) {
    if (!frameOn(world)) return;
    if (e.kind === TROLL) {
      const plates = trollPlatesOf(world.params);
      e.armor = { plates, max: plates, boss: true };
      const [c1, c2, c3] = partColors(world);
      Object.assign(e.vars, { born: world.time, cd: FIRST_MOVE_DELAY, phase: 1, c1, c2, c3 });
      return;
    }
    // A part joins the last core on the arena (the template stands the core first).
    let core: Enemy | undefined;
    for (let i = world.enemies.length - 1; i >= 0 && !core; i--) if (world.enemies[i].kind === TROLL) core = world.enemies[i];
    if (!core) return;
    e.partOf = core.id;
    const plates = e.kind === TROLL_CLUB ? CLUB_PLATES : e.kind === TROLL_TAIL ? TAIL_PLATES : 0;
    if (plates > 0) e.armor = { plates, max: plates, boss: true };
    e.color = core.vars[COLOR_VAR[e.kind]] ?? e.color;
  },
  step(world, e, dt) {
    if (!frameOn(world)) return false;
    if (e.kind === TROLL) { holdSpot(e); return true; }
    if (e.partOf === undefined) return false;
    const v = e.vars;
    if (v.lie !== undefined && world.enemies.some(c => c.id === e.partOf)) {
      v.lie -= dt;
      if (v.lie > TIME_EPS) { e.x = v.lx; e.y = v.ly; e.knock = 0; return true; }
      delete v.lie; delete v.lx; delete v.ly;
    }
    holdSpot(e);
    return true;
  },
  // Task 48, design 24.10 (`Params.trollSolid`): the core and the parts are solid for the hero — he is put out of them, they never move.
  solid: (world, e) => frameOn(world) && !!world.params.trollSolid && (e.kind === TROLL || e.partOf !== undefined),
  onDeath(world, e, cause) {
    if (!frameOn(world)) return;
    if (e.kind === TROLL) { if (bossClearsOn(world) && !world.bossCleared) bossClear(world); return; }
    if (e.partOf === undefined) return;
    const core = world.enemies.find(c => c.id === e.partOf);
    if (!core) return;
    core.vars.sever = (core.vars.sever ?? 0) + 1;
    world.events.push({ type: 'partSevered', id: e.id, x: e.x, y: e.y });
    if (world.params.bossPartLoot && cause.credited) dropArmorLoot(world, e);
  },
  beforeStep(world, members, dt) {
    if (!frameOn(world)) return;
    for (const e of members) {
      if (!world.enemies.includes(e)) continue;
      if (e.kind === TROLL) { conduct(world, e, dt); continue; }
      // The core is dead: its parts die with it once the move is over (not the player's kill).
      if (e.partOf !== undefined && !world.move && !world.enemies.some(c => c.id === e.partOf)) killEnemy(world, e, { source: TROLL, credited: false });
    }
  },
});

const PART_HP: Readonly<Record<string, number>> = { [TROLL_CLUB]: CLUB_HP, [TROLL_ROCK]: ROCK_HP, [TROLL_TAIL]: TAIL_HP };
for (const id of [TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL]) {
  const core = id === TROLL;
  registerEnemyKind({
    id,
    behavior: TROLL,
    speedClass: 'normal',
    hp: params => (core ? trollHpOf(params) : PART_HP[id]),
    speed: world => world.pressure.enemySpeed,
    bodyScale: core ? TROLL_BODY_SCALE : 1,
    artScale: core ? TROLL_BODY_SCALE : 1,
    touchDamage: world => world.params.contactDamage,
    // Held at their spots by the frame (without it — plain enemies of mass 1).
    mass: world => (frameOn(world) ? PINNED_MASS : 1),
    spread: false,
    chainable: true,
    hitSource: 'touch',
  });
}

// ---- The Troll for the view (read only) ----

/**
 * The move the Troll winds up now (as `jailerMove`): `progress` — the share of the windup gone (0…1; it strikes at 1, a strike that
 * waits for the hero's move stays at 1). `club` — the lane `from` → `to`, `width`; `rock` — the circle `at`, `r`; `tail` — the ring
 * around `at` (the core), `inner`…`r`; `roar` — the circles at `gates`, `r`. Null — no move, the fight is over, or the frame is off.
 */
export function trollMove(world: World): {
  move: Exclude<TrollMoveId, 'snore'>; progress: number; at: Vec; r: number; from?: Vec; to?: Vec; width?: number; inner?: number; gates?: Vec[];
} | null {
  const core = trollCore(world);
  if (!frameOn(world) || world.status !== 'playing' || !core) return null;
  const v = core.vars, move = MOVE_OF[v.mv ?? 0];
  if (!move || move === 'snore') return null;
  const progress = Math.max(0, Math.min(1, 1 - v.t / Math.max(1e-6, v.w)));
  if (move === 'club') return { move, progress, at: { x: core.x, y: core.y }, r: CLUB_LENGTH, from: { x: v.ax, y: v.ay }, to: { x: v.bx, y: v.by }, width: CLUB_WIDTH };
  if (move === 'rock') return { move, progress, at: { x: v.ax, y: v.ay }, r: ROCK_RADIUS };
  if (move === 'tail') return { move, progress, at: { x: core.x, y: core.y }, r: TAIL_OUTER, inner: TAIL_INNER };
  return { move, progress, at: { x: core.x, y: core.y }, r: ROAR_RADIUS, gates: (world.arena.gates ?? []).map(g => ({ x: g.x, y: g.y })) };
}

/**
 * The Troll now: his core (`id`, `x`, `y`), the phase, asleep («Храп»: `snore` — its share gone 0…1), and his window: `open` (a hit
 * lands now), `left` — its seconds left, `source` — what opened it, `hit` — its hit landed (it closes after the hero's move), `rule` —
 * the window rules this world (`trollWindow`). Null — no Troll on the arena or the frame is off.
 */
export function trollState(world: World): {
  id: number; x: number; y: number; phase: number; snore: number | null; rule: boolean;
  window: { open: boolean; left: number; source: TrollWindowSource; hit: boolean } | null;
} | null {
  const core = trollCore(world);
  if (!core || !frameOn(world)) return null;
  const v = core.vars, source = WINDOW_SOURCES[v.ws ?? 0] ?? null;
  return {
    id: core.id, x: core.x, y: core.y, phase: v.phase ?? 1, rule: trollWindowOn(world),
    snore: sleeping(v) ? Math.max(0, Math.min(1, 1 - (v.wl ?? 0) / snoreOf(world))) : null,
    window: v.wo && source ? { open: windowOpen(v), left: Math.max(0, v.wl ?? 0), source, hit: !!v.wh } : null,
  };
}
