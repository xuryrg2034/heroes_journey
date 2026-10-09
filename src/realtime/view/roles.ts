/**
 * Roles of enemy kinds for the badge strip under a body (phase A, Т3; docs/realtime-phase-a.md, section 5). View only: the
 * table of roles of the run's rosters lives in the simulation (track Д2, `sim/rosters.ts`); this copy is what the badges
 * show, to be joined with it when the tracks merge. The presser (basic, boar) and the reaper get no badge.
 *
 * Glyphs do not repeat the chain sigils (triangle, cross, square, circle) nor the threat cross:
 * - shooter — an arrow;
 * - blocker — a heater shield;
 * - punisher — a zigzag of spikes («touch me and it hurts»);
 * - master — a crescent (magic on others);
 * - diver — a double chevron (it leaps / rushes in).
 */
import type { Graphics } from 'pixi.js';

export type EnemyRole = 'shooter' | 'blocker' | 'punisher' | 'master' | 'diver';

export const ENEMY_ROLES: Readonly<Record<string, EnemyRole>> = {
  archer: 'shooter',
  shield: 'blocker',
  porcupine: 'punisher',
  sapper: 'punisher',
  shaman: 'master',
  wolf: 'diver',
  lynx: 'diver',
};

export const ROLE_TITLE: Readonly<Record<EnemyRole, string>> = { shooter: 'стрелок', blocker: 'блокер', punisher: 'наказатель', master: 'мастер', diver: 'ныряльщик' };

/** Role of a kind; null — no badge (presser, reaper, unknown kinds). */
export function roleOf(kind: string): EnemyRole | null { return ENEMY_ROLES[kind] ?? null; }

/**
 * Draws the glyph of `role` centred at (x, y), `s` — half its size (pixels of the layer), in `ink`. Strokes and fills only;
 * the plaque under it is the caller's.
 */
export function drawRoleGlyph(g: Graphics, role: EnemyRole, x: number, y: number, s: number, ink: number, alpha: number): void {
  const w = Math.max(1.2, s * 0.32);
  if (role === 'shooter') {
    // A diagonal arrow across the whole glyph: the shaft and an open head (no fletching: at 12 px it read as a double arrow).
    const k = s * 0.85, head = s * 0.7;
    g.moveTo(x - k, y + k).lineTo(x + k, y - k)
      .moveTo(x + k - head, y - k).lineTo(x + k, y - k).lineTo(x + k, y - k + head)
      .stroke({ color: ink, width: w, alpha, cap: 'round', join: 'round' });
    return;
  }
  if (role === 'blocker') {
    // A heater shield: flat top, round shoulders, pointed bottom.
    g.moveTo(x - s * 0.72, y - s * 0.75).lineTo(x + s * 0.72, y - s * 0.75).lineTo(x + s * 0.72, y - s * 0.05)
      .quadraticCurveTo(x + s * 0.6, y + s * 0.6, x, y + s * 0.9).quadraticCurveTo(x - s * 0.6, y + s * 0.6, x - s * 0.72, y - s * 0.05)
      .closePath().fill({ color: ink, alpha });
    return;
  }
  if (role === 'punisher') {
    // Three spikes as one zigzag line.
    g.moveTo(x - s * 0.9, y + s * 0.55).lineTo(x - s * 0.6, y - s * 0.6).lineTo(x - s * 0.3, y + s * 0.55).lineTo(x, y - s * 0.6)
      .lineTo(x + s * 0.3, y + s * 0.55).lineTo(x + s * 0.6, y - s * 0.6).lineTo(x + s * 0.9, y + s * 0.55)
      .stroke({ color: ink, width: w, alpha, cap: 'round', join: 'miter' });
    return;
  }
  if (role === 'master') {
    // A crescent opening to the right: the outer arc and an inner arc offset to the right.
    // The inner arc passes through the tips of the outer one, bulging the same way (a thick-backed crescent).
    const R = s * 0.85, tip = 1.1, off = R * 0.55, tx = R * Math.cos(tip) - off, ty = R * Math.sin(tip);
    const r2 = Math.hypot(tx, ty), a2 = Math.atan2(ty, tx);
    g.moveTo(x + R * Math.cos(-tip), y + R * Math.sin(-tip)).arc(x, y, R, -tip, tip, true)
      .arc(x + off, y, r2, a2, -a2, false).closePath().fill({ color: ink, alpha });
    return;
  }
  // Diver: a double chevron pointing right.
  for (const dx of [-s * 0.45, s * 0.25]) g.moveTo(x + dx - s * 0.3, y - s * 0.7).lineTo(x + dx + s * 0.3, y).lineTo(x + dx - s * 0.3, y + s * 0.7);
  g.stroke({ color: ink, width: w, alpha, cap: 'round', join: 'round' });
}
