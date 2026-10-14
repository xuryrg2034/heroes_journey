/**
 * Task 23 «Щит виден» (design 15.10.2026, docs/design-notes/tasks-21-25.md): «щит не держит». The after-chain shield and «Щит
 * фокуса» spare the hero touches and hits, but not the goblin's bust blast (`bustCanHurt` does not read them) and not the
 * porcupine's quills (they hurt through every shield, enemies/porcupine.ts). The view cracks the shield's glow while
 * `shieldFails` holds; it calls these functions and does not copy their conditions. Read-only: no state, no random draw.
 */
import { armedDamage, findEnemy } from './chain';
import { bustHurts, focusGuarded, type World } from './world';

/** A lit bust circle would take HP from the hero if it went off now (`bustHurts`: the same test the blast hurts by). */
export function bustThreat(world: World): boolean {
  return world.blasts.some(b => bustHurts(world, b));
}

/**
 * The porcupine's quills will hurt the hero: the drawn chain takes a porcupine whose quills are up now (its release arms them,
 * chain.ts `armedDamage` — what the chain's quill badge reads), or the dash runs with armed quills (`HeroMove.armed`).
 */
export function quillThreat(world: World): boolean {
  if (world.status !== 'playing') return false;
  if (world.move) return !!world.move.armed?.length;
  for (const link of world.chain) {
    if (link.kind !== 'enemy') continue;
    const e = findEnemy(world, link.id);
    if (e && armedDamage(world, e) > 0) return true;
  }
  return false;
}

/**
 * The shield is up — the after-chain shield (`Hero.chainShield`) or «Щит фокуса» (`focusGuarded`) — and a threat it does not
 * stop is on the hero: the bust (`bustThreat`) or the quills (`quillThreat`).
 */
export function shieldFails(world: World): boolean {
  if (!(world.hero.chainShield > 0) && !focusGuarded(world)) return false;
  return bustThreat(world) || quillThreat(world);
}
