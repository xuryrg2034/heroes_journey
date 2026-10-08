/**
 * The porcupine (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 1, walks as everyone. A chain hit on it
 * (a kill or a wound) hurts the hero for 1 — during the dash and through any invulnerability (the quills). The hero
 * falling to the quills falls before the strike lands. The cold takes the quills off (`enemyFrozen`). Numbers — the panel
 * group «Дикобраз».
 *
 * Iteration 2.1 (08.10.2026, docs/realtime-slice.md, section 12): the quills go up and down in a cycle — up 2.5 s, down
 * 2.0 s (sliders), the start phase of each porcupine random (stream `behavior:porcupine`); 0.5 s before they go up they
 * tremble (`quillsWarning`, the render). They hurt only if they were up when the chain was RELEASED: the state is fixed at
 * the release (`HeroMove.armed`, chain.ts), as the ×2 of the cold — the «−1 HP» badge of the drawn chain reads
 * `quillsUp` now, and the release fixes exactly what it shows. A frozen porcupine's step does not run: its cycle waits.
 *
 * State in `enemy.vars`: `up` (1 — the quills are up), `timer` — game seconds left in this state.
 */
import { enemyFrozen, heroDamage, hurtHero, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';

/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** The quills are up now: a porcupine in the up part of its cycle, not frozen, with a positive quill damage. */
export function quillsUp(world: World, e: Enemy): boolean {
  return e.kind === 'porcupine' && e.vars.up === 1 && !enemyFrozen(e) && world.params.porcupineQuills > 0;
}

/** The quills are down and go up within `porcupineWarn` seconds: they tremble (render). */
export function quillsWarning(world: World, e: Enemy): boolean {
  return e.kind === 'porcupine' && e.vars.up !== 1 && !enemyFrozen(e) && world.params.porcupineQuills > 0
    && world.params.porcupineUpTime > 0 && (e.vars.timer ?? 0) <= world.params.porcupineWarn + TIME_EPS;
}

/** Game seconds of the state `up` (1 or 0). */
const stateTime = (world: World, up: number): number => Math.max(0, up === 1 ? world.params.porcupineUpTime : world.params.porcupineDownTime);

registerBehavior({
  id: 'porcupine',
  // A random point of the cycle: up with the share up ÷ (up + down), the time left in that state accordingly.
  onSpawn(world, e) {
    const up = stateTime(world, 1), down = stateTime(world, 0), r = world.rng.stream('behavior:porcupine').next() * (up + down);
    if (down <= 0 || (up > 0 && r < up)) { e.vars.up = 1; e.vars.timer = down <= 0 ? up : up - r; }
    else { e.vars.up = 0; e.vars.timer = up + down - r; }
  },
  // The cycle runs; the porcupine walks as everyone (return false). A state of 0 s is skipped (always up / never up).
  step(world, e, dt) {
    e.vars.timer = (e.vars.timer ?? 0) - dt;
    for (let i = 0; i < 4 && e.vars.timer <= TIME_EPS; i++) {
      const next = e.vars.up === 1 ? 0 : 1, time = stateTime(world, next);
      if (time <= 0 && stateTime(world, 1 - next) > 0) continue;
      e.vars.up = next; e.vars.timer += time;
    }
    if (e.vars.timer <= TIME_EPS) e.vars.timer = 0;
    return false;
  },
  // The badge and the release read the damage the quills would do now (`heroDamage`: the elite +1, as `hurtHero`).
  armed: (world, e) => quillsUp(world, e) ? heroDamage(world, e, world.params.porcupineQuills) : 0,
  onChainHit(world, e) {
    // The quills of the release (chain.ts), not of now: up at the release — they hurt even if they went down on the way.
    if (!world.move?.armed?.includes(e.id) || world.status !== 'playing') return;
    // Not `canBeHurt`: the quills hurt in the dash and through invulnerability (section 4, «Общие правила»).
    hurtHero(world, e, world.params.porcupineQuills, 'quills');
  },
});

registerEnemyKind({
  id: 'porcupine',
  behavior: 'porcupine',
  hp: params => params.porcupineHp,
  speed: world => world.pressure.enemySpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: world => world.params.contactDamage,
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'touch',
});
