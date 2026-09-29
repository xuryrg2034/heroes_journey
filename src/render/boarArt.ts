import { Container, Graphics, Text } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';
import { chargeReady } from '../game/boarCharge';
import { addDamageEffectBadges } from './damageEffectBadges';

/** Procedural boar: a side-view silhouette on a chain-colored plate; the plate color and sigil stay readable. */
export const INK = 0x172024, BONE = 0xeadbb9, COLORS = [0xca7970, 0x9fba7c, 0x79b0c4, 0xd8b66a, 0xb69ad2];
export const BOAR_AMBER = 0xe8963a;

export function label(c: Container, value: string, x: number, y: number, size = 11, color = BONE) {
  const t = new Text({ text: value, style: { fontFamily: 'Georgia, serif', fontSize: size, fontWeight: 'bold', fill: color } });
  t.anchor.set(0.5); t.position.set(x, y); c.addChild(t); return t;
}
export function sigil(g: Graphics, color: number | null, y: number) {
  if (color === 0) g.poly([0, y - 6, 6, y + 5, -6, y + 5]).fill(BONE);
  else if (color === 1) g.moveTo(0, y - 6).lineTo(0, y + 6).moveTo(-6, y).lineTo(6, y).stroke({ color: BONE, width: 2 });
  else if (color === 2) g.rect(-5, y - 5, 10, 10).stroke({ color: BONE, width: 2 });
  else if (color === 3) g.circle(0, y, 5).stroke({ color: BONE, width: 2 });
  else if (color === 4) g.moveTo(-5, y - 5).lineTo(5, y + 5).moveTo(5, y - 5).lineTo(-5, y + 5).stroke({ color: BONE, width: 2 });
}

/** Four small stars on a ring; the renderer spins the `stun-stars` child. */
export function drawStunStars(g: Graphics, radius: number, color = 0xffe08a) {
  for (let n = 0; n < 4; n++) {
    const a = n * Math.PI / 2, x = Math.cos(a) * radius, y = Math.sin(a) * radius * 0.45;
    g.poly([x, y - 5, x + 2, y - 1.5, x + 5.5, y, x + 2, y + 1.5, x, y + 5, x - 2, y + 1.5, x - 5.5, y, x - 2, y - 1.5]).fill(color).stroke({ color: 0x5b4218, width: 1 });
  }
}

export function makeBoar(cell: ForestCell, tutorialTarget = false): Container {
  const c = new Container(), plate = new Graphics(), body = new Graphics(), marks = new Graphics();
  const color = cell.color === null ? 0x8f929b : COLORS[cell.color];
  const facing = cell.intent.charge && cell.intent.charge.dx < 0 ? -1 : 1;
  const stunned = cell.behavior.restTurns > 0 && !cell.status.frozen;
  const ready = chargeReady(cell, new Set());
  plate.roundRect(-35, -35, 70, 70, 8).fill({ color, alpha: 0.42 }).stroke({ color, width: 4, alpha: 0.95 });
  plate.ellipse(0, 27, 30, 5).fill({ color: 0x101a1f, alpha: 0.5 });
  if (ready) {
    const aura = new Graphics(); aura.label = 'attack-aura';
    aura.roundRect(-36, -36, 72, 72, 10).stroke({ color: BOAR_AMBER, width: 3, alpha: 0.95 });
    c.addChild(aura);
  }
  c.addChild(plate);
  if (tutorialTarget) {
    const marker = new Graphics(); marker.label = 'tutorial-target';
    marker.roundRect(-38, -38, 76, 76, 10).stroke({ color: 0xf1d17d, width: 3, alpha: 0.98 });
    c.addChild(marker);
  }
  // The figure is drawn facing right and mirrored for a leftward charge.
  body.scale.x = facing;
  const fur = stunned ? 0x6c6058 : 0x7a5c44, dark = 0x4a3629, light = 0xa5825e;
  // Legs.
  for (const [x, back] of [[-17, true], [-8, false], [11, false], [20, true]] as const) {
    body.poly([x - 4, 8, x + 4, 8, x + 3, 24, x - 3, 24]).fill(back ? dark : fur).stroke({ color: INK, width: 2 });
    body.rect(x - 4, 22, 8, 4).fill(0x2a2a26);
  }
  // Barrel body with a bristle mane along the back.
  body.poly([-27, 4, -25, -12, -12, -21, 8, -21, 21, -13, 28, -1, 24, 12, 6, 14, -14, 14]).fill(fur).stroke({ color: INK, width: 3 });
  for (let n = 0; n < 6; n++) { const x = -22 + n * 8; body.poly([x, -14 - (n % 2) * 2, x + 4, -27 - (n % 3), x + 8, -16]).fill(dark).stroke({ color: INK, width: 1.5 }); }
  body.poly([-20, 3, -8, 10, 6, 10, 15, 2, 4, 5, -10, 4]).fill({ color: light, alpha: 0.55 });
  // Head with snout, tusks and eye.
  body.poly([16, -14, 28, -13, 36, -3, 34, 8, 22, 12, 15, 4]).fill(fur).stroke({ color: INK, width: 3 });
  body.poly([30, -4, 37, -2, 37, 6, 30, 6]).fill(0xc79a86).stroke({ color: INK, width: 2 });
  body.circle(34, 0, 1.3).fill(INK); body.circle(34, 4, 1.3).fill(INK);
  body.poly([20, -17, 24, -25, 28, -15]).fill(dark).stroke({ color: INK, width: 2 });
  body.poly([27, 5, 34, 6, 38, -6, 33, -1]).fill(BONE).stroke({ color: INK, width: 1.5 });
  body.poly([21, 6, 26, 8, 22, -1]).fill(BONE).stroke({ color: INK, width: 1.5 });
  body.circle(25, -5, 2.4).fill(stunned ? BONE : ready ? 0xffd398 : BONE).stroke({ color: INK, width: 1 });
  body.circle(25.6, -5, 1).fill(INK);
  if (stunned) body.moveTo(22, -9).lineTo(28, -7).stroke({ color: INK, width: 2 });
  c.addChild(body);
  // Base plaque: solid chain color and sigil.
  marks.roundRect(-11, 22, 22, 15, 5).fill(color).stroke({ color: INK, width: 2 });
  sigil(marks, cell.color, 30);
  c.addChild(marks);
  if (cell.hp > 0) {
    marks.roundRect(3, -34, 32, 18, 4).fill(0x233039).stroke({ color: 0xb5b79c, width: 1 });
    label(c, `${cell.hp}♥`, 19, -25, 11);
  }
  // Charge direction on the tile edge (ready boar only); the lane itself is drawn on the board.
  if (ready && cell.intent.charge) {
    const { dx, dy } = cell.intent.charge, mark = new Graphics(), a = Math.atan2(dy, dx);
    mark.poly([0, -6, 12, 0, 0, 6, 3, 0]).fill(BOAR_AMBER).stroke({ color: INK, width: 1.5 });
    mark.rotation = a; mark.position.set(dx * 33, dy * 33);
    c.addChild(mark);
  }
  if (cell.status.frozen || ready || stunned) {
    marks.roundRect(-34, -34, 19, 18, 4).fill(ready ? 0x85433a : 0x253438).stroke({ color: ready ? 0xe9a879 : 0x88a8a9, width: 1 });
    label(c, cell.status.frozen ? '❄' : ready ? '!' : 'Ⅱ', -24.5, -25, 12);
  }
  if (stunned) {
    const stars = new Graphics(); stars.label = 'stun-stars'; drawStunStars(stars, 15);
    stars.position.set(facing * 20, -14); c.addChild(stars);
    marks.roundRect(-26, 6, 52, 13, 3).fill({ color: 0x3d3220, alpha: 0.92 }).stroke({ color: 0xffe08a, width: 1 });
    label(c, 'ОГЛУШЁН', 0, 12.5, 9, 0xffe08a);
  }
  if (cell.status.wet) marks.poly([-30, 14, -25, 23, -30, 28, -35, 23]).fill(0x8fd9de);
  if (cell.status.frozen) marks.roundRect(-34, -34, 68, 68, 8).fill({ color: 0xabf0eb, alpha: 0.16 }).stroke({ color: 0xb0edee, width: 2, alpha: 0.9 });
  if (cell.status.brittle) { marks.circle(27, 14, 10).fill(0x38585c); label(c, '×2', 27, 14, 11, 0xd7ffff); }
  addDamageEffectBadges(c, cell.damageEffects, 34);
  return c;
}
