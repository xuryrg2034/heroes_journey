/**
 * The sapper (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 0. When it dies, its fuse burns 0.8 s,
 * then it blows up: damage 2 to everyone within radius 1.5 — the hero too (his invulnerability protects him) and every
 * enemy (`damageEnemy`: a weak one dies). Touching the hero, it lights the fuse itself (1.2 s) and stands; its touch does
 * not hurt — the blast does (assumption of step 2). The blast of a sapper the player killed is the player's: its kills
 * count; the blast of a sapper lit by touch is not. A lit sapper killed by the player before it blows: its fuse burns
 * on (at most 0.8 s more) and the blast is the player's. The cold stops a burning fuse on a living sapper
 * (`enemyFrozen`: its step does not run). Numbers — the panel group «Сапёр».
 *
 * State in `enemy.vars`: `lit` (1 — the fuse burns on the living sapper), `fuse` (seconds left), `exploded` (1 — its
 * blast is lit; set on death so a death in its own blast lights nothing more). The fuse of a dead sapper is a blast of
 * the world (`addBlast`).
 */
import { dist } from '../geometry';
import { CONTACT_SLACK, addBlast, touchDistanceOf, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';

/** The sapper's own fuse: lit by touching the hero, it stands and burns; at the end it blows up (and dies in it). */
function stepSapper(world: World, e: Enemy, dt: number): boolean {
  const p = world.params;
  if (e.vars.lit === 1) {
    e.vars.fuse -= dt;
    if (e.vars.fuse <= 1e-9 && e.vars.exploded !== 1) {
      e.vars.exploded = 1;
      addBlast(world, e, { radius: p.sapperRadius, damage: p.sapperDamage, delay: 0, credited: false, source: 'blast', ownerId: e.id, elite: !!e.elite });
    }
    return true;
  }
  // The touch lights it (not while the hero dashes or jumps through: then there is no touch at all).
  if (world.status === 'playing' && !world.move && dist(e, world.hero) <= touchDistanceOf(p, e) + CONTACT_SLACK) {
    e.vars.lit = 1; e.vars.fuse = p.sapperTouchFuse;
    return true;
  }
  return false;
}

/** The fuse burning on the sapper now: seconds left and the whole fuse (render); null — not lit. */
export function sapperFuse(world: World, e: Enemy): { left: number; total: number } | null {
  if (e.kind !== 'sapper' || e.vars.lit !== 1 || e.vars.exploded === 1) return null;
  return { left: Math.max(0, e.vars.fuse), total: Math.max(1e-6, world.params.sapperTouchFuse) };
}

registerBehavior({
  id: 'sapper',
  step: stepSapper,
  // Its hit is the blast: the touch only lights the fuse.
  touches: () => false,
  onDeath(world, e, cause) {
    if (e.vars.exploded === 1) return;
    e.vars.exploded = 1;
    // Stage 3a (design answer 09.10.2026, «пропасть глотает»): a sapper that fell into a cliff does not blow up — neither
    // the fuse of its death nor one already lit by a touch.
    if (cause.fall) return;
    const p = world.params, burning = e.vars.lit === 1 ? Math.max(0, e.vars.fuse) : Infinity;
    addBlast(world, e, { radius: p.sapperRadius, damage: p.sapperDamage, delay: Math.min(burning, p.sapperFuse), credited: cause.credited, source: 'blast', ownerId: e.id, elite: !!e.elite });
  },
});

registerEnemyKind({
  id: 'sapper',
  behavior: 'sapper',
  speedClass: 'normal',
  hp: params => params.sapperHp,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
