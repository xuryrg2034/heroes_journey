import { Container, Graphics } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';
import { addDamageEffectBadges } from './damageEffectBadges';
import { BONE, INK, label } from './boarArt';

/**
 * Procedural forest troll (no illustration yet): a hunched, colourless boss scaled to its body (one cell or 2×2).
 * The club is raised once the engine marks the windup (`behavior.club.raised`). Marks only mirror engine state;
 * the zone itself is drawn by the board renderer from `intent.cells`. Minimal placeholder for a later polish pass.
 */
export const TROLL_SKIN = 0x6f8a63, TROLL_DARK = 0x3f5139, TROLL_ZONE = 0xd9744a;

export function makeTroll(cell: ForestCell, width: number, height: number): Container {
  const c = new Container(), plate = new Graphics(), body = new Graphics(), marks = new Graphics();
  const halfW = width / 2, halfH = height / 2, k = Math.min(width, height) / 80;
  const raised = !!cell.behavior.club?.raised && !cell.status.frozen && cell.behavior.restTurns === 0;
  const winding = !!cell.behavior.club && !raised && !cell.status.frozen && cell.behavior.restTurns === 0;
  const resting = cell.behavior.restTurns > 0 && !cell.status.frozen;
  if (raised || winding) {
    const aura = new Graphics(); aura.label = 'attack-aura';
    aura.roundRect(-halfW + 1, -halfH + 1, width - 2, height - 2, 12).fill({ color: TROLL_ZONE, alpha: raised ? 0.16 : 0.07 })
      .stroke({ color: TROLL_ZONE, width: raised ? 3 : 2, alpha: raised ? 0.95 : 0.6 });
    c.addChild(aura);
  }
  plate.roundRect(-halfW + 5, -halfH + 5, width - 10, height - 10, 10).fill({ color: 0x8f929b, alpha: 0.35 }).stroke({ color: 0xa7a99f, width: 3, alpha: 0.9 });
  plate.ellipse(0, halfH - 10, halfW * 0.7, 6 * k).fill({ color: 0x101a1f, alpha: 0.55 });
  c.addChild(plate, body, marks);
  // The figure spans about x −38…56, y −80…46 (club raised); fit that box inside the body and centre it.
  body.scale.set(k * 0.62); body.position.set(-9 * k * 0.62, 17 * k * 0.62);
  const skin = resting ? 0x5f7856 : TROLL_SKIN, moss = 0x8fb86a, wood = 0x7a5b3a, woodDark = 0x4d3823, leather = 0x6b4a33;
  // Legs and loincloth.
  body.poly([-20, 16, -10, 16, -9, 34, -22, 34]).fill(TROLL_DARK).stroke({ color: INK, width: 3 });
  body.poly([10, 16, 20, 16, 22, 34, 9, 34]).fill(TROLL_DARK).stroke({ color: INK, width: 3 });
  body.rect(-24, 32, 15, 5).fill(INK).rect(9, 32, 15, 5).fill(INK);
  // Hunched barrel torso with a heavy belly, moss patches and a leather belt.
  body.poly([-26, 20, -32, -2, -22, -18, -6, -25, 12, -24, 26, -14, 32, 4, 26, 22, 0, 26]).fill(skin).stroke({ color: INK, width: 3.5 });
  body.poly([-14, 6, -4, 14, 12, 14, 22, 4, 8, 0, -6, 0]).fill({ color: 0xa9c28a, alpha: 0.55 });
  body.circle(-19, -7, 5).fill(moss).circle(21, -3, 4).fill(moss).circle(-6, -18, 3.5).fill(moss);
  body.poly([-26, 16, 26, 16, 28, 24, 0, 30, -28, 24]).fill(leather).stroke({ color: INK, width: 2.5 });
  body.poly([-9, 22, 9, 22, 6, 36, -6, 36]).fill(0x8a6a48).stroke({ color: INK, width: 2 });
  // Head: heavy brow, underbite tusks, small eyes; it sinks when the troll rests.
  const hy = resting ? 5 : 0;
  body.poly([-14, -20 + hy, -11, -36 + hy, 0, -40 + hy, 11, -36 + hy, 14, -20 + hy, 6, -15 + hy, -6, -15 + hy]).fill(skin).stroke({ color: INK, width: 3 });
  body.poly([-13, -30 + hy, 13, -30 + hy, 11, -26 + hy, -11, -26 + hy]).fill(TROLL_DARK);
  if (resting) body.moveTo(-8, -24 + hy).lineTo(-3, -24 + hy).moveTo(3, -24 + hy).lineTo(8, -24 + hy).stroke({ color: INK, width: 2 });
  else body.circle(-6, -24, 2.2).fill(raised ? 0xffb86b : BONE).circle(6, -24, 2.2).fill(raised ? 0xffb86b : BONE);
  body.poly([-8, -17 + hy, -5, -9 + hy, -2, -17 + hy]).fill(BONE).stroke({ color: INK, width: 1.5 });
  body.poly([2, -17 + hy, 5, -9 + hy, 8, -17 + hy]).fill(BONE).stroke({ color: INK, width: 1.5 });
  body.poly([-11, -34 + hy, -19, -40 + hy, -13, -28 + hy]).fill(skin).stroke({ color: INK, width: 2 });
  body.poly([11, -34 + hy, 19, -40 + hy, 13, -28 + hy]).fill(skin).stroke({ color: INK, width: 2 });
  // Free arm hangs; the club arm raises the studded club overhead at the windup.
  body.poly([-30, -4, -38, 14, -32, 24, -25, 12]).fill(skin).stroke({ color: INK, width: 3 });
  body.circle(-34, 24, 6).fill(skin).stroke({ color: INK, width: 2.5 });
  if (raised) {
    body.poly([24, -8, 34, -30, 28, -36, 20, -14]).fill(skin).stroke({ color: INK, width: 3 });
    body.poly([27, -34, 24, -60, 42, -64, 40, -32]).fill(wood).stroke({ color: INK, width: 3 });
    body.poly([20, -58, 32, -78, 48, -70, 44, -56]).fill(woodDark).stroke({ color: INK, width: 3 });
    for (const [x, y] of [[26, -64], [36, -74], [43, -60]]) body.poly([x, y - 5, x + 4, y, x, y + 4, x - 4, y]).fill(BONE).stroke({ color: INK, width: 1.5 });
  } else {
    body.poly([26, 0, 36, 14, 30, 24, 22, 10]).fill(skin).stroke({ color: INK, width: 3 });
    body.poly([30, 12, 46, 30, 38, 38, 24, 22]).fill(wood).stroke({ color: INK, width: 3 });
    body.poly([40, 26, 56, 40, 50, 46, 34, 34]).fill(woodDark).stroke({ color: INK, width: 3 });
    for (const [x, y] of [[46, 34], [52, 40]]) body.poly([x, y - 4, x + 3, y, x, y + 3, x - 3, y]).fill(BONE).stroke({ color: INK, width: 1.2 });
  }
  if (cell.hp > 0) {
    marks.roundRect(halfW - 44, -halfH + 6, 38, 18, 4).fill(0x233039).stroke({ color: 0xb5b79c, width: 1 });
    label(c, `${cell.hp}♥`, halfW - 25, -halfH + 15, 11);
  }
  if (cell.status.frozen || raised || winding || resting) {
    marks.roundRect(-halfW + 6, -halfH + 6, 19, 18, 4).fill(raised ? 0x85433a : 0x253438).stroke({ color: raised ? 0xe9a879 : 0x88a8a9, width: 1 });
    label(c, cell.status.frozen ? '❄' : raised ? '!' : winding ? '↑' : 'Ⅱ', -halfW + 15.5, -halfH + 15, 12);
  }
  if (cell.status.wet) marks.poly([-halfW + 10, halfH - 22, -halfW + 15, halfH - 13, -halfW + 10, halfH - 8, -halfW + 5, halfH - 13]).fill(0x8fd9de);
  if (cell.status.frozen) marks.roundRect(-halfW + 6, -halfH + 6, width - 12, height - 12, 8).fill({ color: 0xabf0eb, alpha: 0.13 }).stroke({ color: 0xb0edee, width: 2, alpha: 0.9 });
  if (cell.status.brittle) { marks.circle(halfW - 15, halfH - 16, 10).fill(0x38585c); label(c, '×2', halfW - 15, halfH - 16, 11, 0xd7ffff); }
  addDamageEffectBadges(c, cell.damageEffects, halfH - 6);
  return c;
}
