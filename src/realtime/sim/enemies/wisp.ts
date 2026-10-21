/**
 * Task 57а «Лес: стрелки», «Светляк» (`wisp`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 5.3; the user's name
 * 17.10.2026 — not «Огонёк»: the family «огонь» is taken). A living shot: an enemy (a body, a colour, a link, a kill that counts),
 * not a shot of the layer — the arena's timer does not hold it, `shotCap` does not count it.
 *
 * **Body.** HP 0, body ×0.6, art ×0.7, the colour of the arena's roll, a link of its colour; never an elite. It flies: water, cliffs,
 * thorns, trees and walls do not hold it (the arena's edge does); the crowd never pushes it and it pushes nobody (`crowd` `ghost`).
 * Its own speed (`wispSpeed`), not the pace's; it turns `wispTurn` degrees per game second at most.
 *
 * **Cycle.** It comes by a marker as everyone (1 s, not nearer than 3 to the hero); it lights `WISP_LIGHT` s where it stands, then
 * flies at the hero, homing, for `wispLife` s (the view fades it the last `WISP_FADE` s), and goes out without a kill (event `wisp`
 * `out`, `life`). Its touch: the hero's body meets its body — `canBeHurt`: 1 damage (source `wisp`) and it goes out (`touch`); a
 * shield: a `block`, it goes out (`block`); a dash or a jump: it passes through and flies on.
 *
 * **Chain.** A link of its colour, HP 0: the chain kills it (credited). While it is a link of the drawn chain or of the running dash
 * it stands still, its flight waits and it touches nobody — the highlight never loses the link to its own clocks (shots.ts
 * `linkedNow`); taken out of the chain it flies on. Frozen: it stands (as everyone).
 *
 * State in `enemy.vars`: `wl` 1 — lit, flying; `wt` — game seconds of the lighting left, or of the flight; `hd` — its heading (radians).
 */
import { datan2, dcos, dsin } from '../detMath';
import { dist } from '../geometry';
import { linkedNow } from '../shots';
import { canBeHurt, heroGuarded, hurtHero, noteBlock, touchReachOf, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const WISP = 'wisp';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the keys play these) ----
export const WISP_SPEED = 2;
export const WISP_TURN = 90;
export const WISP_LIFE = 6;
/** It lights this long where its marker opened (game s), then flies. */
export const WISP_LIGHT = 0.6;
/** The view fades it the last this many seconds of its flight. */
export const WISP_FADE = 1;
/** Wisps on the arena at most (alive, at markers, in the queue). */
export const WISP_MAX = 2;
/** Its touch on the hero. */
export const WISP_DAMAGE = 1;
const TIME_EPS = 1e-9;

const speedOf = (world: World): number => Math.max(0, world.params.wispSpeed ?? WISP_SPEED);
const turnOf = (world: World): number => Math.max(0, world.params.wispTurn ?? WISP_TURN) * Math.PI / 180;
export const wispLifeOf = (world: World): number => Math.max(0.1, world.params.wispLife ?? WISP_LIFE);

/**
 * The wisp now (the view): `lighting` (its share 0…1) or `flying` (seconds left, `fading` in its last `WISP_FADE`), `held` — a link of
 * the drawn chain or the dash (it stands, its clocks wait). Null — not a wisp.
 */
export function wispState(world: World, e: Enemy): { phase: 'lighting' | 'flying'; progress: number; left: number; fading: boolean; held: boolean; heading: number } | null {
  if (e.kind !== WISP) return null;
  const v = e.vars, flying = v.wl === 1;
  return {
    phase: flying ? 'flying' : 'lighting', progress: flying ? 1 : Math.max(0, Math.min(1, 1 - v.wt / WISP_LIGHT)), left: flying ? v.wt : wispLifeOf(world),
    fading: flying && v.wt <= WISP_FADE, held: linkedNow(world, e), heading: v.hd ?? 0,
  };
}

/** It goes out: off the arena with no kill (no score, no goal, no loot; event `wisp` `out`). */
function goOut(world: World, e: Enemy, why: 'life' | 'touch' | 'block'): void {
  const i = world.enemies.indexOf(e);
  if (i < 0) return;
  world.enemies.splice(i, 1);
  world.events.push({ type: 'wisp', action: 'out', id: e.id, x: e.x, y: e.y, why });
}

/** The smallest signed turn from `a` to `b` (radians, −π…π). */
function turnTo(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function stepWisp(world: World, e: Enemy, dt: number): boolean {
  const v = e.vars, hero = world.hero;
  // A link of the drawn chain or of the dash stands: no flight, no clock, no touch.
  if (linkedNow(world, e) || world.status !== 'playing') return true;
  if (v.wl !== 1) {
    v.wt -= dt;
    if (v.wt <= TIME_EPS) {
      v.wl = 1; v.wt = wispLifeOf(world); v.hd = datan2(hero.y - e.y, hero.x - e.x);
      world.events.push({ type: 'wisp', action: 'lit', id: e.id, x: e.x, y: e.y });
    }
    return true;
  }
  v.wt -= dt;
  if (v.wt <= TIME_EPS) { goOut(world, e, 'life'); return true; }
  // Homing: towards the hero, turning `wispTurn` at most; the arena's edge holds it.
  const want = datan2(hero.y - e.y, hero.x - e.x), turn = turnTo(v.hd, want), most = turnOf(world) * dt;
  v.hd += Math.max(-most, Math.min(most, turn));
  const step = speedOf(world) * dt, r = bodyRadiusOf(world.params, e), arena = world.arena;
  e.x = Math.max(r, Math.min(arena.width - r, e.x + dcos(v.hd) * step));
  e.y = Math.max(r, Math.min(arena.height - r, e.y + dsin(v.hd) * step));
  if (dist(e, hero) > touchReachOf(world, e)) return true;
  // The hit first (it stands on the arena at its hit, as every striker), then it goes out.
  if (canBeHurt(world)) { hurtHero(world, e, WISP_DAMAGE, WISP); goOut(world, e, 'touch'); }
  else if (heroGuarded(world)) { noteBlock(world, e.x, e.y, WISP, e.id); goOut(world, e, 'block'); }
  return true;
}

registerBehavior({
  id: WISP,
  onSpawn(world, e) { e.vars.wl = 0; e.vars.wt = WISP_LIGHT; e.vars.hd = datan2(world.hero.y - e.y, world.hero.x - e.x); },
  step: stepWisp,
  // Its touch is its own (it goes out with it): the common touch never counts it.
  touches: () => false,
  crowd: () => 'ghost',
});

registerEnemyKind({
  id: WISP, behavior: WISP, hp: () => 0, speed: world => speedOf(world),
  bodyScale: 0.6, artScale: 0.7, touchDamage: () => WISP_DAMAGE, mass: () => 1, spread: false, chainable: true, hitSource: WISP,
  noElite: true,
  capped: (world, count) => count([WISP]) >= (world.arena.kindCaps?.[WISP] ?? WISP_MAX),
});
