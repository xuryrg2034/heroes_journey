/**
 * The porcupine (stage 2 of the transition, docs/realtime-slice.md, section 4): HP 1, walks as everyone. Every chain hit
 * on it (a kill or a wound) hurts the hero for 1 — during the dash and through any invulnerability (the quills). The
 * hero falling to the quills falls before the strike lands. The cold takes the quills off (`enemyFrozen`). Numbers — the
 * panel group «Дикобраз». No own state.
 */
import { enemyFrozen, hurtHero, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';

/** The quills are up: a porcupine, not frozen, with a positive quill damage (render: the «−1 HP» badge on its link). */
export function quillsUp(world: World, e: Enemy): boolean {
  return e.kind === 'porcupine' && !enemyFrozen(e) && world.params.porcupineQuills > 0;
}

registerBehavior({
  id: 'porcupine',
  onChainHit(world, e) {
    if (!quillsUp(world, e) || world.status !== 'playing') return;
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
