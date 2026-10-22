/**
 * Task 57б «Лес: механики», «Головешка» (`firebrand`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 6.4). A punisher:
 * it burns, a lethal hit only puts it out, put out it runs to a burning brazier and lights again there.
 *
 * **Body.** HP 0, the colour of the arena's roll, a link of its colour, touch 1; never an elite. Burning — speed class `normal`; put
 * out — `fast`.
 *
 * **Burning** (`vars.fb` 1). It leaves the fire trail of the affix «Огненный» (`world.trails`, the same points and the hero's rule:
 * `trailStep`, `trailRadius`, `trailLife`, the hero on foot −`trailHeroDamage`; no point in water); its points never hurt an enemy
 * (`TrailPoint.brand`, elites.ts). **The first lethal hit puts it out instead** (Д11): its HP stays, it is a survivor and ends the chain —
 * the chain's `strike` through `brandOutcome` (the highlight and the dash), the pierce, the return run, the shadows of the highlight
 * (`brandShadow`) and every hit outside the chain (world.ts `damageEnemy`: a bomb, «Режущий проход», a blast). Fire (the consumable)
 * does not take it. The cold (frozen) and water put it out with no hit.
 *
 * **Put out** (`vars.fb` 0). No trail. It runs straight to the nearest burning brazier, sliding along walls (as the archer backs off),
 * at most `brandSeek` s; there it stands `BRAND_RELIGHT` s and burns again. A brazier the chain takes goes out — it runs to another
 * burning one, if any, with the time it has left. None reached in time, or none burning — it stays out and walks to the hero. Fire on a
 * put-out one lights it again (Д12; no burning). A put-out firebrand is a plain link of HP 0: the chain kills it.
 *
 * **Highlight = the pass.** It changes itself only when no hero's move runs and it is not a link of the drawn chain or of the dash
 * (shots.ts `linkedNow`): it never lights at the brazier then, and the cold or water put it out only after (its outcome in the
 * highlight stays the dash's).
 *
 * State in `enemy.vars`: `fb` 1 burning / 0 out; out — `fp` 1 runs, 2 stands at the brazier, 3 gave up (walks); `ft` — seconds of the run
 * left; `fs` — seconds at the brazier left; `fo` — the brazier's id; `tx`, `ty` — its last trail point.
 */
import type { StrikeOutcome } from '../chain';
import { dist, hasZone, inWater, pushOutOfCliffs, pushOutOfObstacles } from '../geometry';
import { linkedNow } from '../shots';
import { OBJECT_RADIUS, enemyGroundFactor, enemySpeed, type ArenaObject, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const FIREBRAND = 'firebrand';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the key play these) ----
export const BRAND_SEEK = 4;
/** It stands at the brazier this long (game s), then burns again. */
export const BRAND_RELIGHT = 1;
/** It has reached the brazier: its body this close to the brazier's edge. */
const REACH_SLACK = 0.05;
const TIME_EPS = 1e-9;

const seekOf = (world: World): number => Math.max(0, world.params.brandSeek ?? BRAND_SEEK);

/** The firebrand burns now. */
export const brandLit = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === FIREBRAND && e.vars.fb === 1;

/**
 * A fire's hit — the fire consumable's burning (design 22.10.2026: no burning ground in the forest; a pool of pitch is no fire for the
 * forest's kinds, the trails burn no enemy).
 */
export const fireSource = (source: string): boolean => source === 'fire';

/** It may change itself now: no hero's move, not a link of the drawn chain or of the dash. */
const free = (world: World, e: Enemy): boolean => !world.move && !linkedNow(world, e);

/**
 * The chain's hit `outcome` on `e` with the firebrand's rule (the highlight and the dash read the same): a lethal hit on a burning one
 * puts it out — no kill, its HP kept, the power spent, a survivor (`douse`). Any other hit — as it was.
 */
export function brandOutcome(e: Enemy, outcome: StrikeOutcome): StrikeOutcome {
  return outcome.killed && brandLit(e) ? { ...outcome, killed: false, hpAfter: outcome.hpBefore, powerAfter: 0, douse: true } : outcome;
}

/** A lethal hit on `e` in the highlight's shadow lists: the burning firebrand stays, put out; null — it dies. */
export function brandShadow(e: Enemy): Enemy | null {
  return brandLit(e) ? { ...e, vars: { ...e.vars, fb: 0 } } : null;
}

/** It goes out (event `firebrand` `out`): it runs to a brazier (the step picks it). */
export function douse(world: World, e: Enemy, why: 'hit' | 'cold' | 'water'): void {
  const v = e.vars;
  v.fb = 0; v.fp = 1; v.ft = seekOf(world);
  delete v.fs; delete v.fo; delete v.tx; delete v.ty;
  world.events.push({ type: 'firebrand', action: 'out', id: e.id, x: e.x, y: e.y, why });
}

function relight(world: World, e: Enemy, why: 'brazier' | 'fire'): void {
  const v = e.vars;
  v.fb = 1; v.tx = e.x; v.ty = e.y;
  delete v.fp; delete v.ft; delete v.fs; delete v.fo;
  world.events.push({ type: 'firebrand', action: 'lit', id: e.id, x: e.x, y: e.y, why });
}

/**
 * Fire on `e` (the consumable): true — a firebrand, and fire does not hurt it: a burning one stays as it is, a
 * put-out one lights again (once it may change itself). False — not a firebrand: the fire acts as usual.
 */
export function brandFire(world: World, e: Enemy): boolean {
  if (e.kind !== FIREBRAND) return false;
  if (!brandLit(e) && free(world, e)) relight(world, e, 'fire');
  return true;
}

const burningBrazier = (o: ArenaObject): boolean => o.kind === 'brazier' && o.out === undefined;

/** The nearest burning brazier (the smaller id of equals); undefined — none burns. */
function nearestBrazier(world: World, e: Enemy): ArenaObject | undefined {
  let best: ArenaObject | undefined, bestD = Infinity;
  for (const o of world.objects) {
    if (!burningBrazier(o)) continue;
    const d = dist(e, o);
    if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && best && o.id < best.id)) { best = o; bestD = d; }
  }
  return best;
}

function giveUp(e: Enemy): false {
  const v = e.vars;
  v.fp = 3;
  delete v.ft; delete v.fs; delete v.fo;
  return false;
}

/** Put out: the run to a brazier and the stand at it (own movement); gave up — the common walk to the hero. */
function stepBrand(world: World, e: Enemy, dt: number): boolean {
  const v = e.vars;
  if (brandLit(e) || v.fp === 3) return false;
  // The brazier it goes to burns still — or the nearest burning one (the chain took its own); none — it gives up.
  let target = v.fo !== undefined ? world.objects.find(o => o.id === v.fo && burningBrazier(o)) : undefined;
  if (!target) {
    target = nearestBrazier(world, e);
    if (!target) return giveUp(e);
    v.fo = target.id;
    if (v.fp === 2) { v.fp = 1; delete v.fs; }
  }
  if (v.fp === 2) {
    // At the brazier: its fire takes `BRAND_RELIGHT` s — not while a move runs or it is a link.
    if (!free(world, e)) return true;
    v.fs = (v.fs ?? BRAND_RELIGHT) - dt;
    if (v.fs <= TIME_EPS) relight(world, e, 'brazier');
    return true;
  }
  const r = bodyRadiusOf(world.params, e), reach = OBJECT_RADIUS + r + REACH_SLACK, d = dist(e, target);
  if (d <= reach + 1e-6) { v.fp = 2; v.fs = BRAND_RELIGHT; return true; }
  v.ft = (v.ft ?? 0) - dt;
  if (v.ft <= TIME_EPS) return giveUp(e);
  // Straight at the brazier; walls and trees push it aside (it slides along them).
  const step = Math.min(enemySpeed(world, e) * enemyGroundFactor(world, e) * dt, Math.max(0, d - reach));
  e.x += (target.x - e.x) / d * step; e.y += (target.y - e.y) / d * step;
  pushOutOfObstacles(e, r, world.arena);
  if (hasZone(world.arena, 'cliff')) pushOutOfCliffs(e, r, world.arena);
  return true;
}

/**
 * Once per tick, before anyone moves: a burning firebrand drops its trail points (as «Огненный»: one each `trailStep` of its way, none
 * in water) and goes out in the cold or in water (once it may change itself).
 */
function beforeBrands(world: World, members: readonly Enemy[]): void {
  if (world.status !== 'playing') return;
  const p = world.params, arena = world.arena, gap = Math.max(0.05, p.trailStep);
  for (const e of members) {
    if (!brandLit(e)) continue;
    const v = e.vars;
    if (dist(e, { x: v.tx ?? e.x, y: v.ty ?? e.y }) >= gap - 1e-9) {
      if (!inWater(e, arena)) world.trails.push({ x: e.x, y: e.y, life: Math.max(0.05, p.trailLife), ownerId: e.id, brand: true });
      v.tx = e.x; v.ty = e.y;
    }
    if (!free(world, e)) continue;
    if ((e.chill ?? 0) > 0) douse(world, e, 'cold');
    else if (inWater(e, arena)) douse(world, e, 'water');
  }
}

/**
 * The firebrand now (the view): `burning`; `running` to the brazier `brazier` (`share` — the run's time left, 1…0); `relighting` at it
 * (`share` — its fire, 0…1); `unlit` — gave up, walks. `held` — it may not change itself now (a move, a link). Null — not a firebrand.
 */
export function brandState(world: World, e: Enemy): { phase: 'burning' | 'running' | 'relighting' | 'unlit'; share: number; brazier?: number; held: boolean } | null {
  if (e.kind !== FIREBRAND) return null;
  const v = e.vars, held = !free(world, e);
  if (brandLit(e)) return { phase: 'burning', share: 1, held };
  if (v.fp === 2) return { phase: 'relighting', share: Math.max(0, Math.min(1, 1 - (v.fs ?? BRAND_RELIGHT) / BRAND_RELIGHT)), ...v.fo !== undefined ? { brazier: v.fo } : {}, held };
  if (v.fp === 1) return { phase: 'running', share: Math.max(0, Math.min(1, (v.ft ?? 0) / Math.max(1e-9, seekOf(world)))), ...v.fo !== undefined ? { brazier: v.fo } : {}, held };
  return { phase: 'unlit', share: 0, held };
}

registerBehavior({
  id: FIREBRAND,
  onSpawn(_world, e) { e.vars.fb = 1; e.vars.tx = e.x; e.vars.ty = e.y; },
  beforeStep: beforeBrands,
  step: stepBrand,
  // The chain's lethal hit on a burning one (`brandOutcome`): it goes out, a survivor.
  onChainHit(world, e, outcome) { if (outcome.douse) douse(world, e, 'hit'); },
});

registerEnemyKind({
  id: FIREBRAND, behavior: FIREBRAND, speedClass: 'normal', speedClassOf: e => (brandLit(e) ? 'normal' : 'fast'), hp: () => 0,
  speed: (world, e) => world.pressure.enemySpeed * (brandLit(e) ? 1 : world.params.speedFast),
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: FIREBRAND,
  noElite: true,
});
