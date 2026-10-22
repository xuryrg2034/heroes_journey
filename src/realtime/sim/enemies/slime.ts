/**
 * Task 57б «Лес: механики», «Слизень» (`slime`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 6.2). A presser: two
 * small slimes of one colour that touch long enough merge into a big one — cut them while they are small.
 *
 * **Body.** Small: HP 0, speed class `slow`, body ×0.85, touch 1, its own colour. Big (`vars.big` 1): HP `slimeBigHp` (2), body ×1.35, art
 * ×1.4, its walk ×`SLIME_BIG_SPEED` (its personal factor), touch 2 (the tough one's: `toughTouchDamage`, or raised to it by the package's
 * `toughTouch`). Never an elite.
 *
 * **Merge.** Two small slimes of one colour whose bodies touch (centres ≤ the sum of their body radii + `SLIME_TOUCH_SLACK`) for
 * `slimeMerge` s in a row (1) merge at the midpoint: the one with the smaller id stays and grows big, the other leaves the arena — no
 * kill, no credit (event `slime` `merge`). Once per tick, in the order of ids, each free small slime pairs with the nearest free small
 * slime of its colour it touches (no draw); a pair holds while both are small, of one colour and touching, else it breaks and its clock
 * starts again. Never: two colours; a big one; a marked one (its goal would lose a target). The pair's clock waits while one of them is
 * frozen or a link of the drawn chain or the dash (shots.ts `linkedNow`), and while the hero's move runs (highlight = the pass); no
 * pull between slimes (Д9).
 *
 * State in `enemy.vars`: `big` 1 — big; `pr` — the partner's id; `pt` — game seconds the pair has touched.
 */
import { dist, pushOutOfObstacles } from '../geometry';
import { linkedNow } from '../shots';
import { enemyFrozen, touchRaised, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const SLIME = 'slime';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the keys play these) ----
export const SLIME_MERGE = 1;
export const SLIME_BIG_HP = 2;
/** The big one walks this much slower (× its personal factor at the merge). */
export const SLIME_BIG_SPEED = 0.8;
/** Bodies touch: centres no farther than the sum of the body radii plus this. */
export const SLIME_TOUCH_SLACK = 0.05;
/** The big one's touch without the package's raise (the tough one's). */
export const SLIME_BIG_TOUCH = 2;
const SMALL_BODY = 0.85, BIG_BODY = 1.35, SMALL_ART = 0.85, BIG_ART = 1.4;
const TIME_EPS = 1e-9;

const mergeOf = (world: World): number => Math.max(0, world.params.slimeMerge ?? SLIME_MERGE);
const bigHpOf = (world: World): number => Math.max(0, Math.round(world.params.slimeBigHp ?? SLIME_BIG_HP));

/** A big slime (merged). */
export const slimeBig = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === SLIME && e.vars.big === 1;

/** The pair's clock runs for it now: not frozen, not a link of the drawn chain or the dash. */
const ticking = (world: World, e: Enemy): boolean => !enemyFrozen(e) && !linkedNow(world, e);

function touching(world: World, a: Enemy, b: Enemy): boolean {
  return a.color === b.color && dist(a, b) <= bodyRadiusOf(world.params, a) + bodyRadiusOf(world.params, b) + SLIME_TOUCH_SLACK + 1e-9;
}

function unpair(e: Enemy): void { delete e.vars.pr; delete e.vars.pt; }

/** `a` (the smaller id) and `b` merge: `a` grows big at the midpoint, `b` leaves the arena (no kill). */
function merge(world: World, a: Enemy, b: Enemy): void {
  unpair(a); unpair(b);
  a.x = (a.x + b.x) / 2; a.y = (a.y + b.y) / 2;
  a.vars.big = 1;
  a.hp = bigHpOf(world);
  a.speedFactor *= SLIME_BIG_SPEED;
  world.enemies.splice(world.enemies.indexOf(b), 1);
  pushOutOfObstacles(a, bodyRadiusOf(world.params, a), world.arena);
  world.events.push({ type: 'slime', action: 'merge', id: a.id, goneId: b.id, x: a.x, y: a.y });
}

/** The pairs and their clocks, once per tick before anyone moves (nothing while the hero's move runs: the clocks wait). */
function beforeSlimes(world: World, members: readonly Enemy[], dt: number): void {
  if (world.status !== 'playing' || world.move) return;
  const small = members.filter(e => !slimeBig(e) && !e.marked).sort((a, b) => a.id - b.id);
  const byId = new Map(small.map(e => [e.id, e] as const));
  // A pair holds while both are small, of one colour and touching.
  for (const e of small) {
    if (e.vars.pr === undefined) continue;
    const o = byId.get(e.vars.pr);
    if (!o || o.vars.pr !== e.id || !touching(world, e, o)) unpair(e);
  }
  // New pairs: in the order of ids each free one takes the nearest free one of its colour it touches (the first of equals).
  for (const e of small) {
    if (e.vars.pr !== undefined || !ticking(world, e)) continue;
    let best: Enemy | null = null, bestD = Infinity;
    for (const o of small) {
      if (o === e || o.vars.pr !== undefined || !ticking(world, o) || !touching(world, e, o)) continue;
      const d = dist(e, o);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) { e.vars.pr = best.id; best.vars.pr = e.id; e.vars.pt = 0; best.vars.pt = 0; }
  }
  // The clocks (each pair once, from its smaller id); a full clock merges.
  const limit = mergeOf(world);
  for (const e of small) {
    const o = e.vars.pr !== undefined ? byId.get(e.vars.pr) : undefined;
    if (!o || o.id < e.id || !ticking(world, e) || !ticking(world, o)) continue;
    const t = (e.vars.pt ?? 0) + dt;
    e.vars.pt = t; o.vars.pt = t;
    if (t + TIME_EPS >= limit) merge(world, e, o);
  }
}

/** The pairs now (the view): the two ids (`a` the smaller) and the share of the merge's clock 0…1. */
export function slimePairs(world: World): { a: number; b: number; share: number }[] {
  const limit = Math.max(1e-9, mergeOf(world)), out: { a: number; b: number; share: number }[] = [];
  for (const e of world.enemies) {
    if (e.kind !== SLIME || e.vars.pr === undefined || e.vars.pr < e.id) continue;
    out.push({ a: e.id, b: e.vars.pr, share: Math.max(0, Math.min(1, (e.vars.pt ?? 0) / limit)) });
  }
  return out;
}

registerBehavior({ id: SLIME, beforeStep: beforeSlimes });

registerEnemyKind({
  id: SLIME, behavior: SLIME, speedClass: 'slow', hp: () => 0, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: SMALL_BODY, artScale: SMALL_ART, bodyScaleOf: e => (slimeBig(e) ? BIG_BODY : SMALL_BODY), artScaleOf: e => (slimeBig(e) ? BIG_ART : SMALL_ART),
  // The big one's touch is the tough one's: 2 (raised to it by `toughTouch` while its HP ≥ 2 — the base then stays the small's).
  touchDamage: (world, e) => (slimeBig(e) && !touchRaised(world, e) ? world.params.toughTouchDamage ?? SLIME_BIG_TOUCH : world.params.contactDamage),
  mass: () => 1, spread: true, chainable: true, hitSource: SLIME, noElite: true,
});
