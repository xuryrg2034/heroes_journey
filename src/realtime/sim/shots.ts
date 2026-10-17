/**
 * Task 57а «Лес: стрелки», the common layer of shots (design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 4;
 * docs/realtime-elite-behaviors.md, «Лес: стрелки»). A shot is a thing of the world, not an enemy: no link, no target of a
 * consumable, no body to push, not in `maxEnemies`, the flow field never sees it.
 *
 * - **The field** `world.shots` is absent until the first shot of the arena flies (older worlds hash as before). A shot: its id
 *   (from `world.nextId`), its kind (`stone` — the slinger's, `wasp` — the hive's), place, velocity, radius, flight left (game s),
 *   the hang left (it is born still and visible, then flies; 0 — flying) and its shooter (`owner`).
 * - **Whom it hits.** Only the hero (the law of the forest: the archer's arrow spares enemies): his body touches it — 1 damage, the
 *   shot is gone. `canBeHurt` decides; a shield (`heroGuarded`: invulnerability, «Щит фокуса», the after-chain shield) takes it —
 *   the shot is gone with a `block`. A dash or a jump: it passes through him (with `snuffShots` the dash puts it out, `snuffAlong`).
 *   A hanging shot hurts as well: its pattern is a wall for a while.
 * - **Terrain.** Walls, trees and the arena's edge put it out (`blockedAt` without cliffs); water, cliffs and thorns do not.
 * - **The end of the fight** — no shot is shown or acts any more (`liveShots`; the world stops with the fight).
 * - **The arena's timer** (`Params.volleyGap`, `world.volley`): a shooter (a slinger, a hive; the archer with `volleyArcher`) that is
 *   ready marks the game time it began to wait (`vars.vw`, `volleyReady`); after the enemies moved the timer runs and, when it is
 *   empty, the one who waits longest (then the smaller id) starts its windup and fills the timer (`updateShots`). No random draw.
 *   Without a timer (0) a ready shooter starts at once. A frozen shooter does not start; its own clocks wait.
 * - **The cap** (`Params.shotCap`): the shots on the arena plus those of the windups running plus the volley stay within it —
 *   else the volley waits and the timer is not spent.
 * - **Snuffing** (`Params.snuffShots`, off by default; the run with `forestShooters` turns it on): the hero's dash path (chain.ts
 *   `stepMove`) and a bomb (a circle of `BOMB_SNUFF_RADIUS` round its target, items.ts) put out the light shots (all of them now:
 *   wasps and stones). The highlight promises nothing about shots — it never differs from the dash.
 *
 * Events (the view; the rules never read them): `shooter` — a windup began (`aim`: the slinger's lines, the hive's points) or the
 * volley left (`loose`); `shot` — a shot ended (`hit` the hero, `block`, `snuff` by the dash or a bomb, `end`: a wall, a tree, the
 * edge or its flight ran out; `by: 'owner'` — a hanging shot whose shooter died, design 17.10.2026).
 */
import { dhypot } from './detMath';
import { blockedAt, type Vec } from './geometry';
import { heroRadius } from './params';
import { canBeHurt, enemyFrozen, heroGuarded, hurtHero, noteBlock, type Enemy, type World } from './world';
// The kinds register in a module of their own (no cycle with the kinds that world.ts loads).
import { shooterOf } from './shooterRegistry';

export type ShotKind = 'stone' | 'wasp';

export interface Shot {
  id: number;
  kind: ShotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Game seconds of flight left (counts only while it flies). */
  life: number;
  /** Game seconds it still hangs where it was born (0 — it flies). The hang waits while its shooter is frozen. */
  hang: number;
  owner: number;
}

/** The hit source of a shot on the hero (the run-end line, the telemetry): the slinger's stone, the hive's wasp. */
export const SHOT_SOURCE: Readonly<Record<ShotKind, string>> = { stone: 'stone', wasp: 'wasp' };
/** Light shots: the dash and a bomb put them out (`snuffShots`). Every shot kind of the forest is light. */
const LIGHT: ReadonlySet<ShotKind> = new Set<ShotKind>(['stone', 'wasp']);
/** Damage of a shot to the hero. */
export const SHOT_DAMAGE = 1;
/** The circle round a bomb's target that puts out light shots (`snuffShots`; the bomb itself has no circle — design question). */
export const BOMB_SNUFF_RADIUS = 1;
/** Shots on the arena at most (journals without `shotCap`). */
export const SHOT_CAP = 24;
/** The shot's centre is put out by walls and trees within this radius (a point of the line, as the archer's line). */
const TERRAIN_R = 0.02;
const TIME_EPS = 1e-9;


/** The arena's timer (game s; 0 — none). */
export const volleyGapOf = (world: World): number => Math.max(0, world.params.volleyGap ?? 0);
const capOf = (world: World): number => world.params.shotCap ?? SHOT_CAP;

/** The shots the player sees and meets now: none once the fight is over. */
export function liveShots(world: World): readonly Shot[] { return world.status === 'playing' ? world.shots ?? [] : []; }

/** Shots a windup now running will bring (its `vars.vq`, set by the kind at the windup's start, cleared at the volley). */
function reserved(world: World): number {
  let n = 0;
  for (const e of world.enemies) n += e.vars.vq ?? 0;
  return n;
}

/** There is room under the cap for `size` more shots (the arena's shots and the windups running counted). */
export function shotRoom(world: World, size: number): boolean {
  return size <= 0 || (world.shots?.length ?? 0) + reserved(world) + size <= capOf(world);
}

/**
 * A shooter is ready to begin its windup (its own period is over, the hero within its reach and in sight). Without the arena's
 * timer: true when the cap has room (the caller begins now). With it: the shooter marks the time it began to wait (`vars.vw`) and
 * the timer decides in `updateShots` (false here). A shooter that is not ready calls `volleyIdle`.
 */
export function volleyReady(world: World, e: Enemy, size: number): boolean {
  if (volleyGapOf(world) <= 0) return shotRoom(world, size);
  if (e.vars.vw === undefined) e.vars.vw = world.time;
  return false;
}

/** The shooter is not ready (any more): it stops waiting for the timer. */
export function volleyIdle(e: Enemy): void { if (e.vars.vw !== undefined) delete e.vars.vw; }

/** A new shot (the field appears with the first one). */
export function addShot(world: World, shot: Omit<Shot, 'id'>): Shot {
  const s: Shot = { id: world.nextId++, ...shot };
  (world.shots ??= []).push(s);
  return s;
}

/**
 * The arena's timer: it runs out; when it is empty, the shooter that waits longest (then the smaller id), not frozen, with room
 * for its volley, starts its windup now and the timer is filled. The field `world.volley` appears with the first start.
 */
function runVolleyTimer(world: World, dt: number): void {
  const gap = volleyGapOf(world);
  if (world.volley !== undefined) world.volley = Math.max(0, world.volley - dt);
  if (gap <= 0 || (world.volley ?? 0) > TIME_EPS) return;
  let best: Enemy | null = null;
  for (const e of world.enemies) {
    const def = shooterOf(e.kind);
    if (!def || e.vars.vw === undefined || enemyFrozen(e) || !shotRoom(world, def.size(world, e))) continue;
    if (!best || e.vars.vw < best.vars.vw || (e.vars.vw === best.vars.vw && e.id < best.id)) best = e;
  }
  if (!best) return;
  delete best.vars.vw;
  world.volley = gap;
  shooterOf(best.kind)!.begin(world, best);
}

/** Puts the shot out with a `shot` event of `action`. */
function endShot(world: World, s: Shot, action: 'hit' | 'block' | 'snuff' | 'end', by?: 'dash' | 'bomb' | 'owner'): void {
  const list = world.shots!, i = list.indexOf(s);
  if (i >= 0) list.splice(i, 1);
  world.events.push({ type: 'shot', action, id: s.id, kind: s.kind, owner: s.owner, x: s.x, y: s.y, ...by ? { by } : {} });
}

/**
 * The shots' step (world.ts `update`, after the enemies moved and parted, before the blasts and the touches): the arena's timer,
 * then each shot hangs or flies, is put out by a wall, a tree or the edge, runs out of flight, or meets the hero.
 */
export function updateShots(world: World, dt: number): void {
  if (world.status !== 'playing') return;
  runVolleyTimer(world, dt);
  const list = world.shots;
  if (!list?.length) return;
  const hero = world.hero, reach = heroRadius(world.params);
  for (const s of [...list]) {
    if (world.status !== 'playing') return;
    if (s.hang > 0) {
      const owner = world.enemies.find(e => e.id === s.owner);
      // Design 17.10.2026 (task 57а, question 3): a hanging shot goes out with its dead shooter — killing it during the sign is the
      // reward (event `shot` `end` by `owner`); the flying ones fly on.
      if (!owner) { endShot(world, s, 'end', 'owner'); continue; }
      // Cold (design Д5): a frozen shooter's hanging pattern hangs on.
      if (!enemyFrozen(owner)) s.hang = Math.max(0, s.hang - dt);
      if (s.hang <= TIME_EPS) s.hang = 0;
    } else {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= TIME_EPS || blockedAt(s, TERRAIN_R, world.arena, false)) { endShot(world, s, 'end'); continue; }
    }
    if (dhypot(s.x - hero.x, s.y - hero.y) > s.r + reach) continue;
    if (canBeHurt(world)) { endShot(world, s, 'hit'); hurtHero(world, { id: s.owner }, SHOT_DAMAGE, SHOT_SOURCE[s.kind]); }
    else if (heroGuarded(world)) { noteBlock(world, s.x, s.y, SHOT_SOURCE[s.kind], s.owner); endShot(world, s, 'block'); }
    // A dash, a jump, a calm arena: it passes through the hero.
  }
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** `snuffShots`: the dash may put out shots now (the key on, some shot on the arena). */
export function snuffing(world: World): boolean { return !!world.params.snuffShots && !!world.shots?.length; }

/**
 * `snuffShots` (chain.ts `stepMove`): the hero's body ran along `path` in this tick of a dash — every light shot it touched is put
 * out (event `shot` `snuff` by `dash`).
 */
export function snuffAlong(world: World, path: readonly Vec[]): void {
  if (!snuffing(world) || path.length < 2) return;
  const reach = heroRadius(world.params);
  for (const s of [...world.shots!]) {
    if (!LIGHT.has(s.kind)) continue;
    for (let i = 1; i < path.length; i++) if (segmentDistance(path[i - 1], path[i], s) <= s.r + reach) { endShot(world, s, 'snuff', 'dash'); break; }
  }
}

/** `snuffShots` (items.ts, the bomb): the light shots within `BOMB_SNUFF_RADIUS` of the bomb's target are put out. */
export function snuffAround(world: World, at: Vec): void {
  if (!snuffing(world)) return;
  for (const s of [...world.shots!]) if (LIGHT.has(s.kind) && dhypot(s.x - at.x, s.y - at.y) <= BOMB_SNUFF_RADIUS + s.r) endShot(world, s, 'snuff', 'bomb');
}

/** The enemy is a link of the drawn chain or of the running dash (its own clocks wait then: the highlight keeps the link). */
export function linkedNow(world: World, e: Enemy): boolean {
  const has = (l: { kind: string; id: number; fork?: { kind: string; id: number } }): boolean => (l.kind === 'enemy' && l.id === e.id) || (l.fork?.kind === 'enemy' && l.fork.id === e.id);
  return world.chain.some(has) || !!world.move?.links.some(has);
}
