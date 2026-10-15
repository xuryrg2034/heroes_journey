/**
 * Т2. Hammers of the dash (docs/realtime-phase-b.md, sections 4 and 8, decisions 15–18; section 9, «Д2»). Ids — buildIds.ts
 * `HAMMERS`; the rules register here through `registerBuildModule` (build.ts); hits — buildHits.ts; the return run —
 * chain.ts `startReturnRun`. A module acts only while `Kit.hammer` is its id (one hammer a run).
 *
 * Common to the four: every hit is the player's (`credited`, its own `source` of buildIds.ts `BUILD_SOURCES`: the kill
 * counter, the flat score per kill, the kill goal, an elite's loot) but not a kill of the chain (no combo, no crystal, no
 * chain score) — except a link ahead of the dash: it becomes a fallen link the dash passes (chain.ts `passFallen`). Not the
 * reaper; no ×2 on a frozen brittle enemy (it keeps its brittleness for the chain); no quills, no shield (only the chain
 * meets them). Numbers are constants of this file, not `Params` — except the end blast's chain threshold
 * (`Params.endBlastMinLinks`, `endBlastMinLinks` below).
 *
 * - **«Огненный проход»** (`fire-pass`): the hero's path of the dash leaves fire points every `FIRE_STEP` (radius
 *   `FIRE_RADIUS`, `FIRE_LIFE` game seconds); none in water (as the trail of a fiery elite) and none over a cliff (no
 *   ground). An enemy whose centre stands in a point (as the elite's trail and thorns): −`FIRE_DAMAGE`, then a pause of
 *   `FIRE_PAUSE` (its own, not the elite trail's `Enemy.singed`); it kills. Fiery elites do not burn; the hero never.
 *   The burn runs in the world step (`onUpdate`: after burning, before thorns).
 * - **«Взрыв на конце»** (`end-blast`): at the end of the dash a blast of `BLAST_RADIUS` around the last enemy link — the
 *   point where it died, or the survivor where it stands now — hits every enemy whose body touches it for `BLAST_DAMAGE`.
 *   No push (no fall into a cliff), the hero is not hurt (not `addBlast`, which hurts him). A chain without an enemy link — no blast;
 *   a chain of fewer than `endBlastMinLinks` enemy links reached (3 by default) — no blast.
 * - **«Режущий проход»** (`cutting-pass`): the dash hits for `CUT_DAMAGE` every enemy of any colour whose body comes within
 *   `CUT_RADIUS` of the hero's path, once a dash; the links of the chain are not cut.
 * - **«Возврат»** (`return-pass`): after the dash the hero runs back along its path to the start of the chain (a move
 *   `return`: untouchable). Power ⌊power left at the end of the dash / 2⌋, at least 1; every enemy whose body comes within
 *   `RETURN_RADIUS` of the way back is hit once, in the order the run reaches them: the hit is the power now, it kills when
 *   not less than the HP, and spends the HP removed (a weak one — nothing); a survivor takes the rest and the power is 0
 *   (no more hits). No +1 per enemy: those are not links. The highlight shows the way back and the hits before the release
 *   (chain.ts `planChain(...).back`, the same functions: returnRun.ts, `returnStrike`; with `Params.returnShadowEnd` the plan
 *   sees the end of the same dash first — «Ударная волна» kills and wounds before the run). With `Params.returnFixed` (task 29;
 *   the sandbox, not a run until task 30) the release fixes the planned route and bodies, as the pierce's: the run goes from
 *   where the dash ended along the fixed route and strikes each fixed body when it passes the body's point, if it is still on
 *   the arena. Without the key the bodies are those near the path the hero really runs (moving enemies may differ from the
 *   highlight: a known defect of a run until task 30).
 *
 * A dash that ends in the door (victory) has no end: no blast, no return (build.ts: `onChainEnd` is not called).
 */
import { buildStateOf, chainEnemyLinks, registerBuildModule, setBuildState } from './build';
import { BUILD_SOURCES, HAMMERS } from './buildIds';
import { buildHit, buildHitAll, enemiesInCircle, enemiesNearPath } from './buildHits';
import { returnFixedOn, returnStrike, startReturnRun } from './chain';
import { eliteAffixes } from './elites';
import { kindOf } from './enemies/kinds';
import { dist, inWater, overCliff, type Vec } from './geometry';
import type { Params } from './params';
import { RETURN_RADIUS, returnPowerOf, returnRoute, returnTargets, returnWaypoints, traceTo, type ReturnFixed } from './returnRun';
import type { Enemy, HeroMove, World } from './world';

export { RETURN_RADIUS };

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

/**
 * `World.build['return-pass']`. Old path: the dash's path (corners, from the start) during the dash; the enemies hit during the
 * return run. `returnFixed`: the plan fixed at the release during the dash (`fixed`); the run's route, waypoint count and the
 * bodies still to strike with their waypoints during the run (`run`).
 */
interface ReturnState { trace?: Vec[]; hit?: number[]; fixed?: ReturnFixed; run?: ReturnRunState }
interface ReturnRunState { route: Vec[]; total: number; bodies: { id: number; wp: number }[] }

/**
 * `returnFixed` (the view, «бег по зафиксированному маршруту»): the fixed way back and the bodies it will strike — during the
 * dash the planned route (the dash's planned end first), during the run the route from where the dash ended and the bodies not
 * struck yet. Null — no fixed return now (the old path: the highlight `planChain(...).back` shows it before the release).
 */
export function returnRunOf(world: World): { route: readonly Vec[]; bodies: number[] } | null {
  const state = buildStateOf<ReturnState>(world, HAMMERS.return);
  if (state?.run) return { route: state.run.route, bodies: state.run.bodies.map(b => b.id) };
  if (state?.fixed) return { route: state.fixed.route, bodies: state.fixed.bodies.map(b => b.id) };
  return null;
}

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

/**
 * Баланс (decision of the user 11.10.2026, playtest v17: the blast went off on chains of one link — 79 hammer kills to 89
 * chain kills in 4 fights): the end blast needs a chain of at least this many enemy links — reached by the dash: struck,
 * passed fallen (as «Пятое звено»), the survivor at the end; crystals, braziers, buttons, the door and loot do not count.
 * The panel key `endBlastMinLinks` (12.10.2026; default 3, a run forces 3). A journal without the key — recorded before
 * the key — plays the old path: `END_BLAST_LEGACY_MIN_LINKS` 1, the blast on any chain with a last enemy link (a last link
 * means at least one link reached).
 */
export const END_BLAST_LEGACY_MIN_LINKS = 1;
export function endBlastMinLinks(params: Params): number { return params.endBlastMinLinks ?? END_BLAST_LEGACY_MIN_LINKS; }

registerBuildModule({
  id: HAMMERS.blast,
  onChainEnd: (world, end) => {
    const last = end.last;
    if (!last || end.links < endBlastMinLinks(world.params)) return;
    // Task 29, the rank of the field «Конец»: a chain whose seal struck or whose pierce ran (forms in the kit) has no blast.
    if (end.endForm) return;
    // Decision 17: a surviving last link — around the survivor where it stands now.
    const survivor = last.killed ? undefined : world.enemies.find(e => e.id === last.id);
    const at = survivor ? { x: survivor.x, y: survivor.y } : { x: last.x, y: last.y };
    world.events.push({ type: 'hammer', kind: 'blast', x: at.x, y: at.y, r: BLAST_RADIUS });
    buildHitAll(world, enemiesInCircle(world, at, BLAST_RADIUS), BLAST_DAMAGE, BUILD_SOURCES.hammerBlast);
  },
  // The column shows the links of the drawn chain (or of the dash) up to the threshold, as «Ударная волна» does.
  progress: world => {
    const links = chainEnemyLinks(world), max = endBlastMinLinks(world.params);
    return links === null ? null : { value: Math.min(links, max), max };
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
 * One hit of the return run (decision 15, «как strike»): chain.ts `returnStrike` — the power now; kills at HP ≤ power, spends
 * the HP removed; an armoured elite with plates takes a plate and 1 power (the package «Урон имеет значение»).
 */
function returnHit(world: World, move: HeroMove, e: Enemy): void {
  const power = move.power;
  move.power = returnStrike(power, e).powerAfter;
  buildHit(world, e, power, BUILD_SOURCES.hammerReturn);
}

/** `returnFixed`: strikes the fixed bodies whose waypoint the run has passed (`passed` waypoints reached), in order. */
function strikeFixed(world: World, move: HeroMove, run: ReturnRunState, passed: number): void {
  while (run.bodies.length && run.bodies[0].wp < passed) {
    if (world.status !== 'playing' || move.power <= 0) return;
    const e = world.enemies.find(x => x.id === run.bodies[0].id);
    run.bodies.shift();
    if (e) returnHit(world, move, e);
  }
}

registerBuildModule({
  id: HAMMERS.return,
  onRelease: (world, release) => {
    if (!returnFixedOn(world)) { setBuildState(world, HAMMERS.return, { trace: [{ x: release.start.x, y: release.start.y }] } satisfies ReturnState); return; }
    // `returnFixed`: the highlight's way back and bodies, fixed now (none in the plan — no run).
    const back = release.back;
    setBuildState(world, HAMMERS.return, back ? { fixed: { route: back.route.map(p => ({ x: p.x, y: p.y })), bodies: back.hits.map(h => ({ id: h.id, at: h.at })) } } satisfies ReturnState : undefined);
  },
  onDashStep: (world, step) => {
    const state = buildStateOf<ReturnState>(world, HAMMERS.return);
    if (!state) return;
    if (step.kind === 'dash') {
      if (state.trace) for (const p of step.path) traceTo(state.trace, p);
      return;
    }
    if (step.kind !== 'return') return;
    const move = step.move;
    if (state.run) {
      strikeFixed(world, move, state.run, state.run.total - (move.point ? 1 : 0) - (move.route?.length ?? 0));
      return;
    }
    if (!state.hit) return;
    const hit = state.hit;
    for (const { e } of returnTargets(world, step.path, hit)) {
      if (world.status !== 'playing' || move.power <= 0) return;
      if (!world.enemies.includes(e)) continue;
      hit.push(e.id);
      returnHit(world, move, e);
    }
  },
  onChainEnd: (world, end) => {
    const state = buildStateOf<ReturnState>(world, HAMMERS.return), trace = state?.trace, hero = world.hero;
    setBuildState(world, HAMMERS.return, undefined);
    if (state?.fixed) {
      // `returnFixed`: from where the hero stands along the fixed route; the fixed bodies at their waypoints.
      const { points, bodies } = returnWaypoints(state.fixed, hero);
      const route = [{ x: hero.x, y: hero.y }, ...state.fixed.route.slice(1).map(p => ({ x: p.x, y: p.y }))];
      if (!startReturnRun(world, points, returnPowerOf(end.power))) return;
      setBuildState(world, HAMMERS.return, { run: { route, total: points.length, bodies } } satisfies ReturnState);
      world.events.push({ type: 'hammer', kind: 'return', x: hero.x, y: hero.y, r: RETURN_RADIUS });
      return;
    }
    if (!trace) return;
    // The way back: the dash's corners in reverse, from where the hero stands to the start of the chain.
    const route = returnRoute(trace, hero);
    if (!route.length) return;
    if (!startReturnRun(world, route, returnPowerOf(end.power))) return;
    setBuildState(world, HAMMERS.return, { hit: [] } satisfies ReturnState);
    world.events.push({ type: 'hammer', kind: 'return', x: hero.x, y: hero.y, r: RETURN_RADIUS });
  },
  onMoveEnd: (world, move) => {
    if (move.kind !== 'return') return;
    // `returnFixed`: bodies at the last waypoints (a run that never moved this tick) are struck as it ends.
    const run = buildStateOf<ReturnState>(world, HAMMERS.return)?.run;
    if (run) strikeFixed(world, move, run, Infinity);
    setBuildState(world, HAMMERS.return, undefined);
  },
});
