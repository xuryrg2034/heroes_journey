/**
 * Task 59а «Гарнизон, шаг 3», А — the law of pitch on the arena (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 3.2–3.5).
 * Docs: docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3». The pitcher's own cycle (windup, the common pause) — enemies/pitcher.ts.
 *
 * **The pot** (`world.pots`): thrown at the hero's centre at the end of the windup (the point is fixed), it flies `pitchFlight` s
 * (the fight's first ×1.5) and lands: the hero whose centre is nearer than `pitchRadius` + his radius takes `pitchDamage` (source
 * `pot`; the dash, the jump, the shields and the invulnerability block it — event `block`); enemies are not hurt. Where it lands a pool
 * lies — not in water, not over a cliff (as the fire points, firePath.ts `fireLaysAt`).
 *
 * **The pool** (`world.pitch.pools`): radius `pitchPoolRadius`, it dries after `pitchLife` s; at most `PITCH_MAX` — a new one dries the
 * oldest. A centre in a pool walks slower: the hero ×`pitchHeroSlow` (world.ts `stepHeroWalk`), the enemies ×`pitchEnemySlow` (world.ts
 * `enemyGroundFactor`: walks only — no dash, charge or knockback); in water — the water's slowdown only. Two pools do not stack.
 *
 * **The fire** — only the hero's: the fire points of «Огненный проход» (and «Клеймо»: the same path) that touch a pool — the
 * highlight lists them (chain.ts `planChain(...).fire.pitch`, `pitchOnFire`), the release fixes the list (`HeroMove.pitch`), a listed
 * pool does not dry during the move and lights once the move is over (chain.ts `finishMove` → `pitchMoveEnd`); a burning enemy (the
 * fire consumable, `Enemy.burn`) whose centre stands in a pool lights it (not during a move). Not the fiery elite's trail, not a
 * brazier, not a blast. A lit pool burns `pitchBurn` s and is gone: an enemy whose centre is in it takes `FIRE_DAMAGE` on entry, then a
 * pause `FIRE_PAUSE` (the hammer's numbers: the same fire), credited (source `pitch-fire`: the kill counter, the goal, the bag; not a kill
 * of the chain); the fiery elites do not burn; the hero never.
 *
 * State: `world.pots` and `world.pitch` are absent until the first throw (worlds without a pitcher hash as before). Events `pot`.
 */
import { eliteAffixes } from './elites';
import { kindOf } from './enemies/kinds';
import { orderRecruits } from './enemies/recruit';
import { FIRE_DAMAGE, FIRE_PAUSE, FIRE_RADIUS, fireLaysAt } from './firePath';
import { dist, inWater, type Vec } from './geometry';
import { heroRadius } from './params';
import { canBeHurt, damageEnemy, hurtHero, noteBlock, type Enemy, type World } from './world';

/** The pot's hit on the hero (the run-end line «горшок смолокура»). */
export const POT_SOURCE = 'pot';
/** The burning pitch's hit on an enemy (credited). */
export const PITCH_FIRE_SOURCE = 'pitch-fire';
/** At most this many pools on an arena (spec 3.3): a new one dries the oldest. */
export const PITCH_MAX = 4;
// ---- Баланс (гипотезы спеки задачи 59, 17.10.2026; journals without the keys play these) ----
export const PITCH_RADIUS = 0.7;
export const PITCH_DAMAGE = 1;
export const PITCH_POOL_RADIUS = 1;
export const PITCH_LIFE = 4;
export const PITCH_HERO_SLOW = 0.6;
export const PITCH_ENEMY_SLOW = 0.4;
export const PITCH_GAP = 2.5;
export const PITCH_BURN = 2;
const EPS = 1e-9;

/** A pot in flight: the thrower `by`, from (`x0`, `y0`) to its mark (`x`, `y`), game seconds `left` of its `flight`. */
export interface Pot { id: number; by: number; x0: number; y0: number; x: number; y: number; left: number; flight: number }
/** A pool of pitch: game seconds of `life` left; `burn` — seconds of burning left (present only once lit). */
export interface PitchPool { id: number; x: number; y: number; life: number; burn?: number }
/** `world.pitch`: the ids' counter, the common pause left (`gap`), the pools (the oldest first), the burnt enemies' pauses. */
export interface PitchState { next: number; gap: number; pools: PitchPool[]; singed?: [number, number][] }

export const pitchOn = (world: World): boolean => !!world.params.pitch;
const radiusOf = (world: World): number => Math.max(0, world.params.pitchRadius ?? PITCH_RADIUS);
const damageOf = (world: World): number => Math.max(0, world.params.pitchDamage ?? PITCH_DAMAGE);
export const pitchPoolRadiusOf = (world: World): number => Math.max(0, world.params.pitchPoolRadius ?? PITCH_POOL_RADIUS);
const lifeOf = (world: World): number => Math.max(0, world.params.pitchLife ?? PITCH_LIFE);
const gapOf = (world: World): number => Math.max(0, world.params.pitchGap ?? PITCH_GAP);
const burnOf = (world: World): number => Math.max(0, world.params.pitchBurn ?? PITCH_BURN);

/** The pots in flight (the view: the pot on its arc, the mark of `pitchRadius` at its point). */
export function potsInFlight(world: World): readonly Pot[] { return world.pots ?? []; }
/** The pools of pitch on the arena now, the burning ones too (the oldest first). */
export function pitchPools(world: World): readonly PitchPool[] { return world.pitch?.pools ?? []; }
/** The circle of the pot's hit (the view's mark, `pitchRadius`). */
export const pitchMarkRadius = radiusOf;

/** `p` stands in a pool (its centre within `pitchPoolRadius` of one). */
export function inPitch(world: World, p: Vec): boolean {
  const pools = world.pitch?.pools;
  if (!pools?.length) return false;
  const r = pitchPoolRadiusOf(world);
  return pools.some(q => dist(q, p) <= r);
}

/** The hero's walk in pitch: ×`pitchHeroSlow` while his centre is in a pool (not in water: there the water's), else 1. */
export function heroPitchFactor(world: World): number {
  return world.pitch?.pools.length && !inWater(world.hero, world.arena) && inPitch(world, world.hero) ? Math.max(0, world.params.pitchHeroSlow ?? PITCH_HERO_SLOW) : 1;
}
/** An enemy's walk at `p`: ×`pitchEnemySlow` in a pool (not in water: there the water's), else 1. */
export function enemyPitchFactor(world: World, p: Vec): number {
  return world.pitch?.pools.length && !inWater(p, world.arena) && inPitch(world, p) ? Math.max(0, world.params.pitchEnemySlow ?? PITCH_ENEMY_SLOW) : 1;
}

/** The pitchers' common clock lets a windup begin: no pot in the air, the pause `pitchGap` since the last throw is over. */
export function potGapOpen(world: World): boolean {
  return !world.pots?.length && !((world.pitch?.gap ?? 0) > EPS);
}

/** The pitcher `by` throws: the mark is the hero's centre now, the flight `flight` s (event `pot` `throw`); the common pause starts. */
export function throwPot(world: World, by: Enemy, flight: number): void {
  const state = world.pitch ??= { next: 1, gap: 0, pools: [] }, pots = world.pots ??= [];
  const hero = world.hero, pot: Pot = { id: state.next++, by: by.id, x0: by.x, y0: by.y, x: hero.x, y: hero.y, left: flight, flight };
  pots.push(pot);
  state.gap = gapOf(world);
  world.events.push({ type: 'pot', action: 'throw', id: pot.id, by: by.id, x: pot.x, y: pot.y, x0: pot.x0, y0: pot.y0, flight });
}

/**
 * The pools the fire points `points` touch (a point's circle `FIRE_RADIUS` meets the pool's), not burning ones — the highlight's
 * `fire.pitch` and the release's `HeroMove.pitch`. Pure.
 */
export function pitchOnFire(world: World, points: readonly Vec[]): number[] {
  const pools = world.pitch?.pools;
  if (!pools?.length || !points.length) return [];
  const reach = pitchPoolRadiusOf(world) + FIRE_RADIUS;
  return pools.filter(q => q.burn === undefined && points.some(p => dist(p, q) <= reach)).map(q => q.id);
}

function ignite(world: World, pool: PitchPool, cause: 'path' | 'burning'): void {
  pool.burn = burnOf(world);
  world.events.push({ type: 'pot', action: 'ignite', id: pool.id, x: pool.x, y: pool.y, cause });
}

/** The hero's move with a fixed list is over: the listed pools still lying light (event `pot` `ignite` `path`). */
export function pitchMoveEnd(world: World, ids: readonly number[]): void {
  for (const id of ids) {
    const pool = world.pitch?.pools.find(q => q.id === id);
    if (pool && pool.burn === undefined) ignite(world, pool, 'path');
  }
}

/** A pool where the pot landed: the fifth dries the oldest not held by a move's list (all held — no new pool: the list's promise). */
function addPool(world: World, state: PitchState, at: Vec): void {
  if (state.pools.length >= PITCH_MAX) {
    const held = world.move?.pitch ?? [];
    const old = state.pools.find(q => !held.includes(q.id));
    if (!old) return;
    state.pools = state.pools.filter(q => q !== old);
    world.events.push({ type: 'pot', action: 'dry', id: old.id, x: old.x, y: old.y });
  }
  const pool: PitchPool = { id: state.next++, x: at.x, y: at.y, life: lifeOf(world) };
  state.pools.push(pool);
  world.events.push({ type: 'pot', action: 'pool', id: pool.id, x: pool.x, y: pool.y, life: pool.life });
}

function land(world: World, state: PitchState, pot: Pot): void {
  const hero = world.hero, hit = world.status === 'playing' && dist(hero, pot) < radiusOf(world) + heroRadius(world.params);
  world.events.push({ type: 'pot', action: 'land', id: pot.id, by: pot.by, x: pot.x, y: pot.y, ...hit ? { hit: 'hero' as const } : {} });
  if (hit) {
    if (canBeHurt(world)) hurtHero(world, { id: pot.by }, damageOf(world), POT_SOURCE);
    else noteBlock(world, hero.x, hero.y, POT_SOURCE, pot.by);
  }
  if (world.status === 'playing' && fireLaysAt(world, pot)) addPool(world, state, pot);
}

const fiery = (e: Enemy): boolean => eliteAffixes(e).includes('fiery');

/**
 * The world step (world.ts `update`, after the burning enemies): the common pause runs, the pots fly and land, the pools dry (a pool
 * of the running move's list waits) and burn out, a burning enemy lights the pool it stands in (no move running), the burning pools
 * burn the enemies in them. Nothing before the first throw.
 */
export function updatePitch(world: World, dt: number): void {
  const state = world.pitch;
  if (!state) return;
  state.gap = Math.max(0, state.gap - dt);
  const pots = world.pots ?? [];
  if (pots.length) {
    for (const pot of pots) pot.left -= dt;
    const due = pots.filter(pot => pot.left <= EPS);
    if (due.length) {
      world.pots = pots.filter(pot => pot.left > EPS);
      for (const pot of due) land(world, state, pot);
      if (world.status !== 'playing') return;
    }
  }
  const held = world.move?.pitch ?? [];
  const gone: PitchPool[] = [];
  for (const q of state.pools) {
    if (q.burn !== undefined) { q.burn -= dt; if (q.burn <= EPS) gone.push(q); }
    else if (!held.includes(q.id)) { q.life -= dt; if (q.life <= EPS) gone.push(q); }
  }
  if (gone.length) {
    state.pools = state.pools.filter(q => !gone.includes(q));
    for (const q of gone) world.events.push({ type: 'pot', action: 'dry', id: q.id, x: q.x, y: q.y, ...q.burn !== undefined ? { burnt: true as const } : {} });
  }
  if (state.singed) {
    for (const s of state.singed) s[1] -= dt;
    state.singed = state.singed.filter(s => s[1] > EPS);
    if (!state.singed.length) delete state.singed;
  }
  const r = pitchPoolRadiusOf(world);
  // A burning enemy lights the pool it stands in — after the hero's move (the garrison's rule: the state changes after the pass).
  if (!world.move) for (const q of state.pools) if (q.burn === undefined && world.enemies.some(e => e.burn && dist(e, q) <= r)) ignite(world, q, 'burning');
  const burning = state.pools.filter(q => q.burn !== undefined);
  if (!burning.length) return;
  const paused = new Set((state.singed ?? []).map(s => s[0]));
  // A formation's recruits by their numbers (the law of order takes them in turn).
  const targets = orderRecruits(world.enemies.filter(e => !kindOf(e).immune && !fiery(e) && !paused.has(e.id) && burning.some(q => dist(e, q) <= r)));
  for (const e of targets) {
    if (world.status !== 'playing') break;
    if (!world.enemies.includes(e)) continue;
    (state.singed ??= []).push([e.id, FIRE_PAUSE]);
    damageEnemy(world, e, FIRE_DAMAGE, { source: PITCH_FIRE_SOURCE, credited: true });
  }
}
