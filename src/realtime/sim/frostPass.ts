/**
 * Task 29 («Формы в песочнице», design 15.10.2026; the report «Талисманы меняющие стиль игры», concept 4): «Наледь»
 * (`frost-pass`, buildIds.ts `FROST_PASS`) — a form of the field «Путь», a sandbox talisman (`Kit.talismans`), not in the
 * run's catalogue. A copy of the hammer «Огненный проход» (sim/hammers.ts) with cold instead of a hit:
 *
 * - the hero's path of the dash leaves frost points every `FROST_PASS_STEP` (radius `FROST_PASS_RADIUS`, `FROST_PASS_LIFE`
 *   game seconds); none in water and none over a cliff (as the fire);
 * - an enemy whose centre stands in a point and that is not frozen now freezes: the cold of the consumable (items.ts) —
 *   `Params.frostTime` game seconds, brittle (the next chain hit ×`frostFactor`); not the reaper (`immune`). No damage, no
 *   kill: a link ahead of the dash stays a link (frozen, it stands);
 * - it stacks with any hammer (design answer 2, «сплав»): both modules act on the same dash — fire and frost lie on one path.
 *
 * The highlight: `frostPassPreview` — the points the drawn chain's dash would lay (the same sampling along the path the dash
 * runs: the links the plan kills, the touch point of a survivor or a plated elite and the way back to the stop, the pierce of
 * «Прямая»); `frostPassPoints` — the points on the arena now. Both only read the world.
 *
 * State: `World.build['frost-pass']` (hashed; absent until the first release with the talisman). No random draws, no
 * transcendental `Math.*`. Numbers are constants of this file (start values; the sandbox sets them).
 */
import { buildStateOf, registerBuildModule, setBuildState, talismanFired } from './build';
import { FROST_PASS } from './buildIds';
import { findEnemy, passObject, planChain } from './chain';
import { kindOf } from './enemies/kinds';
import { dist, inWater, overCliff, type Vec } from './geometry';
import { findObject, touchDistanceOf, type World } from './world';

/** Game seconds a frost point lies. */
export const FROST_PASS_LIFE = 2;
/** Radius of a frost point: an enemy whose centre is this close freezes (the view draws the same circle). */
export const FROST_PASS_RADIUS = 0.4;
/** A frost point every this many units of the hero's path (as the fire's `FIRE_STEP`). */
export const FROST_PASS_STEP = 0.4;

const EPS = 1e-9;

/** One frost point: where, game seconds it still lies. */
export interface FrostPoint { x: number; y: number; life: number }

/** `World.build['frost-pass']`: the points (the view draws them), the path left to the next point (only during a dash). */
export interface FrostState { points: FrostPoint[]; next?: number }

/** The frost points on the arena now (the view: circles of `FROST_PASS_RADIUS`, fading by `life / FROST_PASS_LIFE`). */
export function frostPassPoints(world: World): readonly FrostPoint[] {
  return buildStateOf<FrostState>(world, FROST_PASS)?.points ?? [];
}

/** A point may lie at `p`: not in water, not over a cliff (no ground). */
const frostAt = (world: World, p: Vec): boolean => !inWater(p, world.arena) && !(world.arena.terrain && overCliff(p, world.arena));

/**
 * Lays points along `path` into `out`: `next` — units left to the next point (0 — a point at the start); returns the units
 * left after the path. The dash (per tick) and the preview (the whole path at once) share it.
 */
function frostAlong(world: World, path: readonly Vec[], next: number, out: FrostPoint[]): number {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = dist(a, b);
    if (len <= EPS) continue;
    let at = 0;
    while (len - at >= next - EPS) {
      at += next;
      const k = Math.min(1, at / len), p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      if (frostAt(world, p)) out.push({ x: p.x, y: p.y, life: FROST_PASS_LIFE });
      next = FROST_PASS_STEP;
    }
    next -= len - at;
  }
  return next;
}

/**
 * The path the dash of the drawn chain would run now (as chain.ts `advanceMove`): from the hero to every link the plan reaches
 * — the spot of a link it kills or of an object the chain goes on after; the touch point of a survivor or of an elite whose
 * plate it takes (the chain goes on from there); a survivor, or a plate taken on the last link, sends the hero back to the
 * last spot he took; a button, a lever or the door ends it; then the pierce of «Прямая» to its end. Empty — no chain, or a
 * dash runs. Pure.
 */
export function frostPassPath(world: World): Vec[] {
  if (!world.chain.length || world.move) return [];
  const plan = planChain(world), hero = { x: world.hero.x, y: world.hero.y }, path: Vec[] = [hero];
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

/** The highlight: the frost points the drawn chain's dash would lay now (`frostPassPath`, the dash's sampling). Pure. */
export function frostPassPreview(world: World): FrostPoint[] {
  const out: FrostPoint[] = [];
  // A dash that never moves lays nothing (the dash's step hook gets no path).
  const path = frostPassPath(world);
  if (path.length > 1) frostAlong(world, path, 0, out);
  return out;
}

function storeFrost(world: World, state: FrostState): void {
  setBuildState(world, FROST_PASS, !state.points.length && state.next === undefined ? undefined : state);
}

/** The world step: the points age; an enemy in a point that is not frozen now freezes (the consumable's cold). */
function freezeOnPath(world: World, dt: number): void {
  const state = buildStateOf<FrostState>(world, FROST_PASS);
  if (!state) return;
  for (const p of state.points) p.life -= dt;
  state.points = state.points.filter(p => p.life > EPS);
  let froze = false;
  if (state.points.length) {
    for (const e of world.enemies) {
      if (kindOf(e).immune || (e.chill ?? 0) > 0 || !state.points.some(p => dist(e, p) <= FROST_PASS_RADIUS)) continue;
      e.chill = world.params.frostTime;
      e.brittle = true;
      froze = true;
    }
  }
  if (froze) talismanFired(world, FROST_PASS);
  storeFrost(world, state);
}

registerBuildModule({
  id: FROST_PASS,
  onRelease: world => {
    const state = buildStateOf<FrostState>(world, FROST_PASS) ?? { points: [] };
    // The first point falls at the start of the dash.
    state.next = 0;
    setBuildState(world, FROST_PASS, state);
  },
  onDashStep: (world, step) => {
    if (step.kind !== 'dash') return;
    const state = buildStateOf<FrostState>(world, FROST_PASS);
    if (!state || state.next === undefined) return;
    state.next = frostAlong(world, step.path, state.next, state.points);
    storeFrost(world, state);
  },
  onChainEnd: world => {
    const state = buildStateOf<FrostState>(world, FROST_PASS);
    if (!state) return;
    delete state.next;
    storeFrost(world, state);
  },
  onUpdate: freezeOnPath,
});
