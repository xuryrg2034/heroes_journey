import type { Graphics } from 'pixi.js';
import { BOAR_AMBER } from './boarArt';

/** Drawing helpers for the forest telegraphs and the push forecast. Geometry only: no rules live here. */
type Point = { x: number; y: number };
const INK = 0x172024;
export const PUSH_COLOR = 0xd6efff;
export const DEATH_COLOR = 0xff6a5c;
export const CAUSE_LABEL: Record<string, string> = { ram: 'УДАР', spikes: 'ШИПЫ', thorns: 'КОЛЮЧКИ', pit: 'ПРОВАЛ', arrow: 'СТРЕЛА', quills: 'ИГЛЫ' };

/** Solid chevron (arrow head) centred on a point and pointing along (dx, dy). */
export function drawChevron(g: Graphics, at: Point, dx: number, dy: number, color: number, size = 11) {
  const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const tip = { x: at.x + ux * size, y: at.y + uy * size }, back = { x: at.x - ux * size * 0.7, y: at.y - uy * size * 0.7 };
  g.poly([tip.x, tip.y, back.x + nx * size * 0.95, back.y + ny * size * 0.95, at.x - ux * size * 0.15, at.y - uy * size * 0.15, back.x - nx * size * 0.95, back.y - ny * size * 0.95])
    .fill(color).stroke({ color: INK, width: 2, join: 'round' });
}

/** Boar lane: an amber corridor along the announced cells with chevrons on its rails and a heavy head at the far end. */
export function drawBoarLane(g: Graphics, from: Point, cells: Point[], dx: number, dy: number, alpha = 1) {
  if (!cells.length) return;
  const last = cells[cells.length - 1], half = 36;
  const minX = Math.min(...cells.map(c => c.x)) - half, maxX = Math.max(...cells.map(c => c.x)) + half;
  const minY = Math.min(...cells.map(c => c.y)) - half, maxY = Math.max(...cells.map(c => c.y)) + half;
  g.roundRect(minX, minY, maxX - minX, maxY - minY, 6).fill({ color: BOAR_AMBER, alpha: 0.13 * alpha }).stroke({ color: INK, width: 6, alpha: 0.75 * alpha });
  g.roundRect(minX, minY, maxX - minX, maxY - minY, 6).stroke({ color: BOAR_AMBER, width: 3.5, alpha: 0.95 * alpha });
  // Rail chevrons sit on the cell borders, so the color and sigil in the middle of every tile stay clear.
  const nx = -dy, ny = dx;
  const path = [from, ...cells];
  for (let n = 0; n < path.length - 1; n++) {
    const mid = { x: (path[n].x + path[n + 1].x) / 2, y: (path[n].y + path[n + 1].y) / 2 };
    for (const side of [-1, 1]) drawChevron(g, { x: mid.x + nx * side * 30, y: mid.y + ny * side * 30 }, dx, dy, BOAR_AMBER, 8);
  }
  // Heavy arrow head across the far edge of the last cell.
  const tip = { x: last.x + dx * 40, y: last.y + dy * 40 };
  g.poly([tip.x, tip.y, tip.x - dx * 20 + nx * 22, tip.y - dy * 20 + ny * 22, tip.x - dx * 20 - nx * 22, tip.y - dy * 20 - ny * 22])
    .fill(BOAR_AMBER).stroke({ color: INK, width: 3, join: 'round' });
}

/** Red cross for an entity that dies in the enemy phase. */
export function drawDeathCross(g: Graphics, at: Point, size = 19) {
  for (const [w, color] of [[10, INK], [6, DEATH_COLOR]] as const) {
    g.moveTo(at.x - size, at.y - size).lineTo(at.x + size, at.y + size).moveTo(at.x + size, at.y - size).lineTo(at.x - size, at.y + size).stroke({ color, width: w, cap: 'round' });
  }
}

/** Dashed rounded square: where an entity will stand after the push. */
export function drawDashedTile(g: Graphics, at: Point, color: number, half = 34) {
  const seg = 9, gap = 6, corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4], length = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < length; t += seg + gap) {
      const t2 = Math.min(length, t + seg);
      g.moveTo(at.x + ax + (bx - ax) * t / length, at.y + ay + (by - ay) * t / length).lineTo(at.x + ax + (bx - ax) * t2 / length, at.y + ay + (by - ay) * t2 / length);
    }
  }
  g.stroke({ color: INK, width: 5, alpha: 0.7 });
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4], length = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < length; t += seg + gap) {
      const t2 = Math.min(length, t + seg);
      g.moveTo(at.x + ax + (bx - ax) * t / length, at.y + ay + (by - ay) * t / length).lineTo(at.x + ax + (bx - ax) * t2 / length, at.y + ay + (by - ay) * t2 / length);
    }
  }
  g.stroke({ color, width: 3, alpha: 1 });
}

/** Small crosshair badge on a creature the archer's arrow will also strike. */
export function drawArrowMark(g: Graphics, at: Point) {
  g.circle(at.x, at.y, 8).fill({ color: 0x5b1f1a, alpha: 0.95 }).stroke({ color: 0xffa48c, width: 1.5 });
  g.moveTo(at.x - 5, at.y).lineTo(at.x + 5, at.y).moveTo(at.x, at.y - 5).lineTo(at.x, at.y + 5).stroke({ color: 0xffd2c4, width: 1.6 });
}

/** Solid spike teeth along one side of the board, pointing inward, on an iron rail. */
export function drawSpikedEdge(g: Graphics, side: 'top' | 'right' | 'bottom' | 'left', width: number, height: number, tile: number) {
  const horizontal = side === 'top' || side === 'bottom', length = horizontal ? width : height, per = 4, count = (length / tile) * per, span = length / count;
  const inward = side === 'top' || side === 'left' ? 1 : -1, depth = 9, rail = 4;
  const edge = side === 'top' || side === 'left' ? 0 : horizontal ? height : width;
  const point = (along: number, across: number) => horizontal ? [along, edge + inward * across] : [edge + inward * across, along];
  const railPts = [...point(0, 0), ...point(length, 0), ...point(length, rail), ...point(0, rail)];
  g.poly(railPts).fill(0x2b3034).stroke({ color: 0x0f1416, width: 1 });
  for (let n = 0; n < count; n++) {
    const a = n * span + 1, c = (n + 1) * span - 1, b = (a + c) / 2;
    g.poly([...point(a, rail - 1), ...point(b, rail + depth), ...point(c, rail - 1)]).fill(0xd8d2c0).stroke({ color: 0x1b1f22, width: 1.2, join: 'round' });
    g.poly([...point(b, rail + depth - 4), ...point(b, rail + depth), ...point(b + (c - a) * 0.12, rail + depth - 4)]).fill(0xd6503f);
  }
}
