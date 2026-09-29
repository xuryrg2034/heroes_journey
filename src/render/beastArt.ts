import { Container, Graphics } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';
import { meleeCanAttack } from '../game/enemyLifecycle';
import { addDamageEffectBadges } from './damageEffectBadges';
import { BONE, COLORS, INK, label, sigil } from './boarArt';

/**
 * Procedural forest beasts (no illustrations): wolf, porcupine and shaman. Each is a silhouette on a chain-colored
 * plate; the plate color and the sigil on the base plaque carry the chain color. Marks only mirror engine state
 * (`intent`, `behavior`, `status`); no rule lives here.
 */
/** Figures are drawn in a ±35 box and enlarged to fill the plate like the illustrated goblins. */
const FIG = 1, FIG_Y = -3, TALL = 1.22;
export const WOLF_GREY = 0x7d8791, QUILL = 0xd8d2c0, RITE = 0xb98cf0;

interface Frame { c: Container; marks: Graphics; color: number }
/** Plate, chain-color sigil plaque, HP badge and the shared status marks. `aura` draws a halo of that color behind the plate. */
function frame(cell: ForestCell, tutorialTarget: boolean, aura: number | null): Frame {
  const c = new Container(), plate = new Graphics(), marks = new Graphics();
  const color = cell.color === null ? 0x8f929b : COLORS[cell.color];
  if (aura !== null) {
    const halo = new Graphics(); halo.label = 'attack-aura';
    halo.roundRect(-36, -36, 72, 72, 10).fill({ color: aura, alpha: 0.13 }).stroke({ color: aura, width: 3, alpha: 0.95 });
    c.addChild(halo);
  }
  plate.roundRect(-35, -35, 70, 70, 8).fill({ color, alpha: 0.42 }).stroke({ color, width: 4, alpha: 0.95 });
  plate.ellipse(0, 27, 30, 5).fill({ color: 0x101a1f, alpha: 0.5 });
  c.addChild(plate);
  if (tutorialTarget) {
    const marker = new Graphics(); marker.label = 'tutorial-target';
    marker.roundRect(-38, -38, 76, 76, 10).stroke({ color: 0xf1d17d, width: 3, alpha: 0.98 });
    c.addChild(marker);
  }
  return { c, marks, color };
}
function finish(f: Frame, cell: ForestCell, badge: string | null, badgeColor: number) {
  const { c, marks, color } = f;
  marks.roundRect(-11, 22, 22, 15, 5).fill(color).stroke({ color: INK, width: 2 });
  sigil(marks, cell.color, 30);
  if (cell.hp > 0) { marks.roundRect(3, -34, 32, 18, 4).fill(0x233039).stroke({ color: 0xb5b79c, width: 1 }); }
  c.addChild(marks);
  if (cell.hp > 0) label(c, `${cell.hp}♥`, 19, -25, 11);
  const glyph = cell.status.frozen ? '❄' : badge;
  if (glyph) {
    const m = new Graphics(); m.roundRect(-34, -34, 19, 18, 4).fill(cell.status.frozen ? 0x253438 : badgeColor).stroke({ color: cell.status.frozen ? 0x88a8a9 : 0xe9c9a0, width: 1 });
    c.addChild(m); label(c, glyph, -24.5, -25, 12);
  }
  if (cell.status.wet) marks.poly([-30, 14, -25, 23, -30, 28, -35, 23]).fill(0x8fd9de);
  if (cell.status.frozen) marks.roundRect(-34, -34, 68, 68, 8).fill({ color: 0xabf0eb, alpha: 0.16 }).stroke({ color: 0xb0edee, width: 2, alpha: 0.9 });
  if (cell.status.brittle) { marks.circle(27, 14, 10).fill(0x38585c); label(c, '×2', 27, 14, 11, 0xd7ffff); }
  addDamageEffectBadges(c, cell.damageEffects, 34);
  return c;
}
/** A caption pill across the figure's belly (state words such as ОДИНОК or БЕЗ ИГЛ). */
function pill(c: Container, marks: Graphics, text: string, color: number, fill: number) {
  marks.roundRect(-28, 5, 56, 13, 3).fill({ color: fill, alpha: 0.92 }).stroke({ color, width: 1 });
  label(c, text, 0, 11.5, 9, color);
}

export function makeWolf(cell: ForestCell, index = 0, cols = 7, tutorialTarget = false): Container {
  const frozen = cell.status.frozen > 0;
  const armed = cell.intent.cells.length > 0 && meleeCanAttack(cell) && !cell.behavior.passive;
  const lone = !armed && !frozen && (cell.intent.label === 'Одинок' || cell.behavior.passive === true);
  const target = cell.intent.cells[0];
  const facing = armed && target !== undefined && target % cols < index % cols ? -1 : 1;
  const f = frame(cell, tutorialTarget, armed ? 0xee804c : null);
  const g = new Graphics(); g.scale.set(facing * FIG, FIG); g.position.y = FIG_Y;
  const fur = lone ? 0x8a929a : armed ? 0x59616b : 0x6b737d, dark = 0x3d444d, light = 0xb8c0c6, drop = 0;
  // Tail (bushy, raised when armed), legs, torso, mane.
  g.poly(armed ? [-24, -1, -34, -14, -30, -24, -21, -9] : [-24, 1, -35, 4, -33, 13, -22, 8]).fill(dark).stroke({ color: INK, width: 2.5 });
  for (const [x, back] of [[-17, true], [-9, false], [8, false], [16, true]] as const) {
    g.poly([x - 3.5, 6, x + 3.5, 6, x + 3, 22, x - 3, 22]).fill(back ? dark : fur).stroke({ color: INK, width: 2 });
    g.rect(x - 4, 20, 8, 3.5).fill(INK);
  }
  g.poly([-25, 3 + drop, -21, -8 + drop, -6, -13 + drop, 10, -12 + drop, 19, -5 + drop, 17, 7, 4, 11, -15, 11]).fill(fur).stroke({ color: INK, width: 3 });
  if (armed) for (let n = 0; n < 5; n++) { const x = -18 + n * 8; g.poly([x, -10, x + 4, -18 - (n % 2) * 2, x + 8, -11]).fill(dark).stroke({ color: INK, width: 1.5 }); }
  g.poly([-16, 6, -4, 10, 8, 9, 14, 2, 0, 4, -10, 3]).fill({ color: light, alpha: 0.5 });
  // Head: long snout, pointed ears; lowered and calm when alone, jaws open when armed.
  const hy = drop;
  g.poly([14, -14 + hy, 24, -14 + hy, 35, -3 + hy, 27, 0 + hy, 31, 5 + hy, 17, 7 + hy, 12, -2 + hy]).fill(fur).stroke({ color: INK, width: 3 });
  g.poly([15, -14, 17, -26, 23, -14]).fill(dark).stroke({ color: INK, width: 2 });
  g.poly([22, -14, 27, -24, 29, -11]).fill(dark).stroke({ color: INK, width: 2 });
  g.circle(35, -3 + hy, 1.8).fill(INK);
  if (armed) { g.poly([27, 1, 31, 5, 35, 1, 32, 8, 28, 8]).fill(BONE).stroke({ color: INK, width: 1 }); g.poly([29, 4, 33, 12, 25, 8]).fill(0x7a2f2c).stroke({ color: INK, width: 1.5 }); }
  g.circle(24, -6 + hy, 2.4).fill(armed ? 0xffc272 : BONE).stroke({ color: INK, width: 1 });
  g.circle(24.6, -6 + hy, 1).fill(INK);
  if (lone) g.moveTo(21, -9 + hy).lineTo(27, -7 + hy).stroke({ color: INK, width: 2 });
  f.c.addChild(g);
  if (lone) pill(f.c, f.marks, 'ОДИНОК', BONE, 0x2b3439);
  return finish(f, cell, armed ? '!' : cell.behavior.restTurns > 0 && !frozen ? 'Ⅱ' : null, armed ? 0x85433a : 0x253438);
}

export function makePorcupine(cell: ForestCell, tutorialTarget = false): Container {
  const frozen = cell.status.frozen > 0;
  const f = frame(cell, tutorialTarget, null);
  const g = new Graphics(); g.scale.set(FIG); g.position.y = FIG_Y;
  const fur = frozen ? 0x6f7f83 : 0x7a5c44, dark = 0x4a3629, quill = frozen ? 0x9fb4b8 : QUILL;
  // Feet and belly.
  for (const x of [-14, -3, 12, 20]) g.poly([x - 4, 10, x + 4, 10, x + 3, 22, x - 3, 22]).fill(dark).stroke({ color: INK, width: 2 });
  // Fan of quills: long triangles radiating from the back, with dark roots.
  for (let n = 0; n < 9; n++) {
    const a = Math.PI * (1.08 + n * 0.105), cx = -2 + Math.cos(a) * 20, cy = 4 + Math.sin(a) * 15;
    const tx = -2 + Math.cos(a) * 40, ty = 4 + Math.sin(a) * 35, nx = -Math.sin(a) * 3.2, ny = Math.cos(a) * 3.2;
    g.poly([cx + nx, cy + ny, tx, ty, cx - nx, cy - ny]).fill(quill).stroke({ color: INK, width: 1.6, join: 'round' });
    g.poly([cx + nx, cy + ny, cx + Math.cos(a) * 6 + nx * .7, cy + Math.sin(a) * 6 + ny * .7, cx + Math.cos(a) * 6 - nx * .7, cy + Math.sin(a) * 6 - ny * .7, cx - nx, cy - ny]).fill(dark);
  }
  g.poly([-24, 12, -25, -2, -14, -12, 4, -15, 18, -9, 27, 0, 30, 8, 24, 14, 4, 15, -14, 15]).fill(fur).stroke({ color: INK, width: 3 });
  g.poly([-16, 8, -2, 12, 14, 10, 22, 6, 6, 4, -8, 4]).fill({ color: 0xa5825e, alpha: 0.5 });
  // Head with snout, nose and a wary eye.
  g.poly([20, -8, 30, -6, 38, 3, 34, 11, 22, 13, 17, 4]).fill(fur).stroke({ color: INK, width: 3 });
  g.circle(38, 4, 3).fill(INK);
  g.circle(27, -1, 2.3).fill(BONE).stroke({ color: INK, width: 1 }); g.circle(27.6, -1, 1).fill(INK);
  g.poly([21, -9, 25, -15, 28, -8]).fill(dark).stroke({ color: INK, width: 1.5 });
  f.c.addChild(g);
  // Quill emblem: a small starburst, shown while the quills work.
  let quillStar: Graphics | null = null;
  if (!frozen) {
    const star = new Graphics();
    for (let n = 0; n < 8; n++) { const a = n * Math.PI / 4; star.moveTo(Math.cos(a) * 2, Math.sin(a) * 2).lineTo(Math.cos(a) * 7, Math.sin(a) * 7); }
    star.stroke({ color: 0xffe6b0, width: 1.8, cap: 'round' }); star.position.set(-24.5, -25); star.label = 'quill-mark';
    f.marks.roundRect(-34, -34, 19, 18, 4).fill(0x5a3b2a).stroke({ color: 0xe9c9a0, width: 1 });
    quillStar = star;
  }
  if (frozen) pill(f.c, f.marks, 'БЕЗ ИГЛ', 0xd7ffff, 0x253438);
  const view = finish(f, cell, null, 0);
  if (quillStar) view.addChild(quillStar);
  return view;
}

export function makeShaman(cell: ForestCell, tutorialTarget = false): Container {
  const frozen = cell.status.frozen > 0;
  const rite = !frozen && (cell.intent.empowerCells?.length ?? 0) > 0;
  const f = frame(cell, tutorialTarget, rite ? RITE : null);
  const g = new Graphics(); g.scale.set(TALL); g.position.y = -2;
  const robe = 0x4b3a63, robeLight = 0x6d5590, wood = 0x6b4a2c;
  // Staff with an orb: it glows when a rite is announced.
  g.moveTo(22, 22).lineTo(22, rite ? -14 : -8).stroke({ color: INK, width: 5, cap: 'round' });
  g.moveTo(22, 22).lineTo(22, rite ? -14 : -8).stroke({ color: wood, width: 2.6, cap: 'round' });
  g.circle(22, rite ? -18 : -12, rite ? 7 : 5.5).fill(rite ? 0xe6d0ff : 0x8f7ab3).stroke({ color: INK, width: 2 });
  if (rite) g.circle(22, -18, 11).stroke({ color: RITE, width: 2, alpha: 0.85 });
  for (const dx of [-3, 3]) g.poly([22 + dx, -6, 22 + dx * 2, 2, 22 + dx, 0]).fill(0xd8b66a).stroke({ color: INK, width: 1 });
  // Robe, sleeve raised in the rite, hood and mask.
  g.poly([-19, 24, -13, -6, 0, -14, 13, -6, 18, 24, 0, 28]).fill(robe).stroke({ color: INK, width: 3 });
  g.poly([-6, 24, -2, 4, 8, 4, 12, 24]).fill({ color: robeLight, alpha: 0.6 });
  g.poly(rite ? [10, -4, 22, -12, 24, -5, 14, 5] : [10, -2, 21, 4, 19, 10, 10, 6]).fill(robeLight).stroke({ color: INK, width: 2 });
  g.poly([-13, -8, -9, -21, 0, -27, 9, -21, 13, -8, 6, -12, -6, -12]).fill(robe).stroke({ color: INK, width: 3 });
  g.poly([-8, -10, -6, -19, 0, -21, 6, -19, 8, -10, 4, -5, 0, -3, -4, -5]).fill(BONE).stroke({ color: INK, width: 2 });
  g.poly([-6, -14, -1, -12, -3, -9]).fill(INK); g.poly([6, -14, 1, -12, 3, -9]).fill(INK);
  g.circle(-3.5, -12, 1.2).fill(rite ? 0xe6d0ff : 0xffc272); g.circle(3.5, -12, 1.2).fill(rite ? 0xe6d0ff : 0xffc272);
  g.moveTo(-3, -6).lineTo(3, -6).stroke({ color: INK, width: 1.5 });
  g.poly([-10, -22, -14, -32, -6, -25]).fill(0xd8b66a).stroke({ color: INK, width: 1.2 });
  f.c.addChild(g);
  return finish(f, cell, rite ? '✦' : null, 0x5b4478);
}
