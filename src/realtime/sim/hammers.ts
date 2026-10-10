/**
 * Т2. Hammers of the dash (docs/realtime-phase-b.md, sections 4 and 8, decisions 15–18; section 9, «Д2»). Ids — buildIds.ts
 * `HAMMERS`; the rules register here through `registerBuildModule` (build.ts); hits — buildHits.ts; the return run —
 * chain.ts `startReturnRun`. A module acts only while `Kit.hammer` is its id (one hammer a run).
 *
 * Common to the four: every hit is the player's (`credited`, its own `source` of buildIds.ts `BUILD_SOURCES`: the kill
 * counter, the flat score per kill, the kill goal, an elite's loot) but not a kill of the chain (no combo, no crystal, no
 * chain score) — except a link ahead of the dash: it becomes a fallen link the dash passes (chain.ts `passFallen`). Not the
 * reaper; no ×2 on a frozen brittle enemy (it keeps its brittleness for the chain); no quills, no shield (only the chain
 * meets them). Numbers are constants of this file, not `Params`.
 *
 * - **«Огненный проход»** (`fire-pass`): the hero's path of the dash leaves fire points every `FIRE_STEP` (radius
 *   `FIRE_RADIUS`, `FIRE_LIFE` game seconds); none in water (as the trail of a fiery elite) and none over a cliff (no
 *   ground). An enemy whose centre stands in a point (as the elite's trail and thorns): −`FIRE_DAMAGE`, then a pause of
 *   `FIRE_PAUSE` (its own, not the elite trail's `Enemy.singed`); it kills. Fiery elites do not burn; the hero never.
 *   The burn runs in the world step (`onUpdate`: after burning, before thorns).
 * - **«Взрыв на конце»** (`end-blast`): at the end of the dash a blast of `BLAST_RADIUS` around the last enemy link — the
 *   point where it died, or the survivor where it stands now — hits every enemy whose body touches it for `BLAST_DAMAGE`.
 *   No push (no fall into a cliff), the hero is not hurt (not `addBlast`, which hurts him). A chain without an enemy link — no blast.
 * - **«Режущий проход»** (`cutting-pass`): the dash hits for `CUT_DAMAGE` every enemy of any colour whose body comes within
 *   `CUT_RADIUS` of the hero's path, once a dash; the links of the chain are not cut.
 * - **«Возврат»** (`return-pass`): after the dash the hero runs back along its path to the start of the chain (a move
 *   `return`: untouchable). Power ⌊power left at the end of the dash / 2⌋, at least 1; every enemy whose body comes within
 *   `RETURN_RADIUS` of the way back is hit once, in the order the run reaches them: the hit is the power now, it kills when
 *   not less than the HP, and spends the HP removed (a weak one — nothing); a survivor takes the rest and the power is 0
 *   (no more hits). No +1 per enemy: those are not links.
 *
 * A dash that ends in the door (victory) has no end: no blast, no return (build.ts: `onChainEnd` is not called).
 */
import { buildStateOf, registerBuildModule, setBuildState } from './build';
import { BUILD_SOURCES, HAMMERS } from './buildIds';
import { buildHit, buildHitAll, enemiesInCircle, enemiesNearPath, segmentDistance } from './buildHits';
import { startReturnRun } from './chain';
import { dhypot } from './detMath';
import { eliteAffixes } from './elites';
import { bodyRadiusOf, kindOf } from './enemies/kinds';
import { dist, inWater, overCliff, type Vec } from './geometry';
import type { Enemy, HeroMove, World } from './world';

// ---- Numbers (design 10.10.2026; start values, balance after the playtest) ----

/** «Огненный проход»: game seconds a fire point burns. */
export const FIRE_LIFE = 2;
/** Radius of a fire point: an enemy whose centre is this close burns (the view draws the same circle). */
export const FIRE_RADIUS = 0.4;
/** A fire point every this many units of the hero's path (as the elite trail's `trailStep`). */
export const FIRE_STEP = 0.4;
/** Damage of the fire on entry, and again after each pause while the enemy stays in it. */
export const FIRE_DAMAGE = 1;
/** Game seconds before the fire may hurt the same enemy again. */
export const FIRE_PAUSE = 1;
/** «Взрыв на конце»: radius and damage. */
export const BLAST_RADIUS = 1.5;
export const BLAST_DAMAGE = 1;
/** «Режущий проход»: reach from the path line (plus the body radius) and damage. */
export const CUT_RADIUS = 0.5;
export const CUT_DAMAGE = 1;
/** «Возврат»: reach from the way back (plus the body radius). */
export const RETURN_RADIUS = 0.5;

const EPS = 1e-9;

// ---- State on the arena (`World.build[hammer id]`, hashed; absent while empty) ----

/** One fire point of «Огненный проход»: where, game seconds it still burns. */
export interface FirePoint { x: number; y: number; life: number }

/** `World.build['fire-pass']`: the fire points (the view draws them), the enemies' pauses, the path left to the next point. */
export interface FireState {
  points: FirePoint[];
  /** [enemy id, game seconds of its pause] — absent when none. */
  singed?: [number, number][];
  /** Units of the dash's path left to the next point — present only during a dash. */
  next?: number;
}

/** `World.build['cutting-pass']` during a dash: the chain's enemy links (never cut) and the enemies cut already. */
interface CutState { links: number[]; cut: number[] }

/** `World.build['return-pass']`: the dash's path (corners, from the start) during the dash; the enemies hit during the return run. */
interface ReturnState { trace?: Vec[]; hit?: number[] }

/** The fire points on the arena now (the view: circles of `FIRE_RADIUS`, fading by `life / FIRE_LIFE`). */
export function hammerFirePoints(world: World): readonly FirePoint[] {
  return buildStateOf<FireState>(world, HAMMERS.fire)?.points ?? [];
}

// ---- «Огненный проход» ----

function layFire(world: World, state: FireState, p: Vec): void {
  if (inWater(p, world.arena)) return;
  if (world.arena.terrain && overCliff(p, world.arena)) return;
  state.points.push({ x: p.x, y: p.y, life: FIRE_LIFE });
}

/** Lays the points along this tick's path: the first one at the start of the dash, then every `FIRE_STEP`. */
function fireAlong(world: World, state: FireState, path: readonly Vec[]): void {
  let next = state.next ?? FIRE_STEP;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = dist(a, b);
    if (len <= EPS) continue;
    let at = 0;
    while (len - at >= next - EPS) {
      at += next;
      const k = Math.min(1, at / len);
      layFire(world, state, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      next = FIRE_STEP;
    }
    next -= len - at;
  }
  state.next = next;
}

const fiery = (e: Enemy): boolean => eliteAffixes(e).includes('fiery');

function storeFire(world: World, state: FireState): void {
  if (state.singed && !state.singed.length) delete state.singed;
  const empty = !state.points.length && !state.singed && state.next === undefined;
  setBuildState(world, HAMMERS.fire, empty ? undefined : state);
}

/** The world step: the points and the pauses age; an enemy in a point, out of its pause, burns. */
function burnFire(world: World, dt: number): void {
  const state = buildStateOf<FireState>(world, HAMMERS.fire);
  if (!state) return;
  for (const p of state.points) p.life -= dt;
  state.points = state.points.filter(p => p.life > EPS);
  if (state.singed) {
    for (const s of state.singed) s[1] -= dt;
    state.singed = state.singed.filter(s => s[1] > EPS);
  }
  if (state.points.length) {
    const paused = new Set((state.singed ?? []).map(s => s[0]));
    const targets = world.enemies.filter(e => !kindOf(e).immune && !fiery(e) && !paused.has(e.id) && state.points.some(p => dist(e, p) <= FIRE_RADIUS));
    for (const e of targets) {
      if (world.status !== 'playing') break;
      if (!world.enemies.includes(e)) continue;
      (state.singed ??= []).push([e.id, FIRE_PAUSE]);
      buildHit(world, e, FIRE_DAMAGE, BUILD_SOURCES.hammerFire);
    }
  }
  storeFire(world, state);
}

registerBuildModule({
  id: HAMMERS.fire,
  onRelease: (world, release) => {
    const state = buildStateOf<FireState>(world, HAMMERS.fire) ?? { points: [] };
    // The first point falls at the start of the dash.
    state.next = 0;
    setBuildState(world, HAMMERS.fire, state);
    world.events.push({ type: 'hammer', kind: 'fire', x: release.start.x, y: release.start.y, r: FIRE_RADIUS });
  },
  onDashStep: (world, step) => {
    if (step.kind !== 'dash') return;
    const state = buildStateOf<FireState>(world, HAMMERS.fire);
    if (!state || state.next === undefined) return;
    fireAlong(world, state, step.path);
    storeFire(world, state);
  },
  onChainEnd: world => {
    const state = buildStateOf<FireState>(world, HAMMERS.fire);
    if (!state) return;
    delete state.next;
    storeFire(world, state);
  },
  onUpdate: burnFire,
});

// ---- «Взрыв на конце» ----

registerBuildModule({
  id: HAMMERS.blast,
  onChainEnd: (world, end) => {
    const last = end.last;
    if (!last) return;
    // Decision 17: a surviving last link — around the survivor where it stands now.
    const survivor = last.killed ? undefined : world.enemies.find(e => e.id === last.id);
    const at = survivor ? { x: survivor.x, y: survivor.y } : { x: last.x, y: last.y };
    world.events.push({ type: 'hammer', kind: 'blast', x: at.x, y: at.y, r: BLAST_RADIUS });
    buildHitAll(world, enemiesInCircle(world, at, BLAST_RADIUS), BLAST_DAMAGE, BUILD_SOURCES.hammerBlast);
  },
});

// ---- «Режущий проход» ----

registerBuildModule({
  id: HAMMERS.cut,
  onRelease: (world, release) => {
    const links = release.links.flatMap(l => (l.kind === 'enemy' ? [l.id] : []));
    setBuildState(world, HAMMERS.cut, { links, cut: [] } satisfies CutState);
  },
  onDashStep: (world, step) => {
    if (step.kind !== 'dash') return;
    const state = buildStateOf<CutState>(world, HAMMERS.cut);
    if (!state) return;
    const targets = enemiesNearPath(world, step.path, CUT_RADIUS).filter(e => !state.links.includes(e.id) && !state.cut.includes(e.id));
    for (const e of targets) {
      if (world.status !== 'playing') return;
      if (!world.enemies.includes(e)) continue;
      state.cut.push(e.id);
      world.events.push({ type: 'hammer', kind: 'cut', x: e.x, y: e.y });
      buildHit(world, e, CUT_DAMAGE, BUILD_SOURCES.hammerCut);
    }
  },
  onChainEnd: world => setBuildState(world, HAMMERS.cut, undefined),
});

// ---- «Возврат» ----

/**
 * Adds a point of the dash's path to the trace, keeping corners only: a point on the line of the last segment moves its end
 * (on, or back along it — the way back from a survivor folds the spike away).
 */
function traceTo(trace: Vec[], p: Vec): void {
  const last = trace[trace.length - 1];
  if (dist(last, p) <= EPS) return;
  if (trace.length >= 2) {
    const a = trace[trace.length - 2];
    const ux = last.x - a.x, uy = last.y - a.y, vx = p.x - last.x, vy = p.y - last.y;
    if (Math.abs(ux * vy - uy * vx) <= 1e-9 * dhypot(ux, uy) * dhypot(vx, vy)) {
      trace[trace.length - 1] = { x: p.x, y: p.y };
      if (dist(a, p) <= EPS) trace.pop();
      return;
    }
  }
  trace.push({ x: p.x, y: p.y });
}

/** Where along the path (segment index + share of it) the body of `e` first comes within `reach` + its radius. */
function firstTouch(world: World, path: readonly Vec[], e: Enemy, reach: number): number {
  const r = reach + bodyRadiusOf(world.params, e);
  if (path.length === 1) return dist(e, path[0]) <= r ? 0 : Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (segmentDistance(a, b, e) > r) continue;
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((e.x - a.x) * vx + (e.y - a.y) * vy) / len2));
    return i - 1 + t;
  }
  return Infinity;
}

/** One hit of the return run (decision 15, «как strike»): the power now; kills at HP ≤ power, spends the HP removed. */
function returnHit(world: World, move: HeroMove, e: Enemy): void {
  const power = move.power, hp = e.hp;
  move.power = power >= hp ? power - hp : 0;
  buildHit(world, e, power, BUILD_SOURCES.hammerReturn);
}

registerBuildModule({
  id: HAMMERS.return,
  onRelease: (world, release) => setBuildState(world, HAMMERS.return, { trace: [{ x: release.start.x, y: release.start.y }] } satisfies ReturnState),
  onDashStep: (world, step) => {
    const state = buildStateOf<ReturnState>(world, HAMMERS.return);
    if (!state) return;
    if (step.kind === 'dash') {
      if (state.trace) for (const p of step.path) traceTo(state.trace, p);
      return;
    }
    if (step.kind !== 'return' || !state.hit) return;
    const hit = state.hit, move = step.move;
    const targets = enemiesNearPath(world, step.path, RETURN_RADIUS)
      .filter(e => !hit.includes(e.id))
      .map(e => ({ e, at: firstTouch(world, step.path, e, RETURN_RADIUS) }))
      .sort((a, b) => a.at - b.at);
    for (const { e } of targets) {
      if (world.status !== 'playing' || move.power <= 0) return;
      if (!world.enemies.includes(e)) continue;
      hit.push(e.id);
      returnHit(world, move, e);
    }
  },
  onChainEnd: (world, end) => {
    const trace = buildStateOf<ReturnState>(world, HAMMERS.return)?.trace;
    setBuildState(world, HAMMERS.return, undefined);
    if (!trace) return;
    // The way back: the dash's corners in reverse, from where the hero stands to the start of the chain.
    const hero = world.hero, route = [...trace].reverse();
    while (route.length && dist(route[0], hero) <= EPS) route.shift();
    if (!route.length) return;
    if (!startReturnRun(world, route, Math.max(1, Math.floor(end.power / 2)))) return;
    setBuildState(world, HAMMERS.return, { hit: [] } satisfies ReturnState);
    world.events.push({ type: 'hammer', kind: 'return', x: hero.x, y: hero.y, r: RETURN_RADIUS });
  },
  onMoveEnd: (world, move) => { if (move.kind === 'return') setBuildState(world, HAMMERS.return, undefined); },
});
