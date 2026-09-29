/**
 * Boar charge: one shared synchronous rule for the chain forecast and the live enemy phase.
 * The generator mutates the state it receives (a forecast copy or the live world) and yields
 * every observable impact; the live runner turns impacts into events and cancellation barriers.
 */
import { isCellAlive } from './cellLife';
import { damageCell, damageHero, removeDefeated, shieldBlocksEntry } from './combatRules';
import type { EdgeSide } from './customLevel';
import { deviceAt, pitAt } from './devices';
import { applyAttackEffect } from './effectRules';
import { uniqueEntities } from './entityFootprint';
import type { ForestCell, ForestState } from './forestTypes';
import { THORN_DAMAGE, walkableTerrain } from './terrain';

/** Balance defaults of the prototype; the level decides the boar's HP. */
export const BOAR_CHARGE_LENGTH = 3;
export const BOAR_DAMAGE = 2;
export const SPIKE_HERO_DAMAGE = 1;

type Grid = Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'devices'>;
export const spikedEdges = (state: Pick<ForestState, 'customLevel'>): readonly EdgeSide[] => state.customLevel?.definition.spikedEdges ?? [];
const exitSide = (dx: number, dy: number): EdgeSide => dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'bottom' : 'top';
function stepFrom(state: Pick<ForestState, 'cols' | 'rows'>, index: number, dx: number, dy: number): number | null {
  const x = index % state.cols + dx, y = Math.floor(index / state.cols) + dy;
  return x < 0 || x >= state.cols || y < 0 || y >= state.rows ? null : y * state.cols + x;
}

/** Orthogonal only: the dominant axis toward the cat, vertical on a tie (the archer's rule). */
export function chargeDirection(cols: number, from: number, target: number): { dx: number; dy: number } {
  const dx = target % cols - from % cols, dy = Math.floor(target / cols) - Math.floor(from / cols);
  return Math.abs(dx) > Math.abs(dy) ? { dx: Math.sign(dx) || 1, dy: 0 } : { dx: 0, dy: Math.sign(dy) || 1 };
}
/** Announced lane: up to `length` cells, cut by the edge, impassable authored terrain and device squares. */
export function chargeLane(state: Grid, index: number, dir: { dx: number; dy: number }, length: number): number[] {
  const lane: number[] = [];
  for (let at = index, n = 0; n < length; n++) {
    const next = stepFrom(state, at, dir.dx, dir.dy);
    if (next === null || !walkableTerrain(state.terrain[next]) || state.devices.some(device => device.index === next)) break;
    lane.push(next); at = next;
  }
  return lane;
}

export interface ChargeMove { id: number; from: number; to: number }
/** Cat moves use id 0; entity IDs start at 1. */
export const HERO_MOVE_ID = 0;
export type ChargeImpact =
  | { kind: 'start'; boar: ForestCell; index: number; lane: number[] }
  | { kind: 'ram'; index: number; cell?: ForestCell; heroDamage?: number; damage: number; killed: boolean; shielded: boolean; effect?: boolean }
  | { kind: 'shift'; boarId: number; from: number; to: number; moves: ChargeMove[] }
  | { kind: 'crush'; index: number; cause: 'spikes' | 'thorns' | 'pit'; cell?: ForestCell; heroDamage?: number; damage: number; killed: boolean }
  | { kind: 'stun'; index: number }
  | { kind: 'end'; boarId: number; from: number; index: number; moved: number };

interface Body { index: number; cell: ForestCell | null; pinned: boolean }
type RowEnd = { kind: 'void' | 'block' | 'pit'; index: number } | { kind: 'edge'; side: EdgeSide };
/** Contiguous bodies in front of `from`, and what lies right after the last one. */
function scanRow(state: ForestState, from: number, dx: number, dy: number): { bodies: Body[]; end: RowEnd } {
  const bodies: Body[] = [];
  for (let at = from; ;) {
    const next = stepFrom(state, at, dx, dy);
    if (next === null) return { bodies, end: { kind: 'edge', side: exitSide(dx, dy) } };
    const device = !!deviceAt(state, next);
    // The cat may stand on a device it visited; it is struck there but never slides off it.
    if (next === state.player.index) { bodies.push({ index: next, cell: null, pinned: device }); at = next; continue; }
    if (device || !walkableTerrain(state.terrain[next])) return { bodies, end: { kind: 'block', index: next } };
    if (pitAt(state, next)) return { bodies, end: { kind: 'pit', index: next } };
    const cell = state.board[next];
    if (!cell) return { bodies, end: { kind: 'void', index: next } };
    bodies.push({ index: next, cell, pinned: false }); at = next;
  }
}
/** Rows stop at doors, prisms, bosses, large figures, frozen creatures and a shield facing the push. */
function holdsRow(state: ForestState, body: Body, pushedFrom: number): boolean {
  const cell = body.cell;
  if (!cell) return body.pinned;
  return cell.kind === 'door' || cell.kind === 'prism' || cell.kind === 'boss' || (cell.footprint?.length ?? 1) > 1
    || cell.status.frozen > 0 || shieldBlocksEntry(state, cell, pushedFrom, body.index);
}
/** Move each body one cell forward (front first), then the boar into the first vacated cell. */
function shiftRow(state: ForestState, boar: ForestCell, at: number, bodies: Body[], dest: number, displaced: Set<number>) {
  const boarTo = bodies[0]?.index ?? dest, moves: ChargeMove[] = [];
  for (let n = bodies.length - 1; n >= 0; n--) {
    const body = bodies[n], to = n + 1 < bodies.length ? bodies[n + 1].index : dest;
    if (!body.cell) { state.player.index = to; moves.unshift({ id: HERO_MOVE_ID, from: body.index, to }); continue; }
    state.board[body.index] = null; state.board[to] = body.cell;
    body.cell.status.wet = state.terrain[to] === 'puddle'; displaced.add(body.cell.id);
    moves.unshift({ id: body.cell.id, from: body.index, to });
  }
  state.board[at] = null; state.board[boarTo] = boar; boar.status.wet = state.terrain[boarTo] === 'puddle'; displaced.add(boar.id);
  return { boarId: boar.id, from: at, to: boarTo, moves };
}

/** Ready to run this phase: announced, alive, armed, not frozen, not stunned and not knocked down earlier. */
export function chargeReady(cell: ForestCell, displaced: ReadonlySet<number>): boolean {
  return cell.variant === 'boar' && !!cell.intent.charge && isCellAlive(cell) && !cell.behavior.passive
    && cell.status.frozen === 0 && cell.behavior.restTurns === 0 && !displaced.has(cell.id);
}

export function* resolveBoarCharge(state: ForestState, boar: ForestCell, start: number, displaced: Set<number>): Generator<ChargeImpact> {
  const { dx, dy, length } = boar.intent.charge!;
  yield { kind: 'start', boar, index: start, lane: [...boar.intent.cells] };
  let at = start, moved = 0, rammed = false;
  while (moved < length) {
    let { bodies, end } = scanRow(state, at, dx, dy);
    // The first body the boar crashes into takes its damage once per charge.
    if (bodies.length && !rammed) {
      rammed = true;
      const first = bodies[0];
      if (!first.cell) {
        const heroDamage = damageHero(state, boar.intent.damage);
        const effect = state.player.hp > 0 && applyAttackEffect(state.player, boar.attackEffect, false);
        yield { kind: 'ram', index: first.index, heroDamage, damage: heroDamage, killed: state.player.hp === 0, shielded: false, effect };
        if (state.player.hp === 0) return;
      } else {
        const cell = first.cell;
        const shielded = cell.kind === 'door' || cell.kind === 'prism' || shieldBlocksEntry(state, cell, at, first.index);
        const outcome = shielded ? null : damageCell(cell, boar.intent.damage, 'hazard');
        if (outcome?.killed) removeDefeated(state.board, cell);
        yield { kind: 'ram', index: first.index, cell, damage: outcome?.damage ?? 0, killed: !!outcome?.killed, shielded };
        // A weak victim leaves a gap: the boar advances into it on this step.
        if (outcome?.killed) ({ bodies, end } = scanRow(state, at, dx, dy));
      }
    }
    let dest: number, moving = bodies;
    if (!bodies.length) {
      if (end.kind !== 'void') break;
      dest = end.index;
    } else {
      if (bodies.some((body, n) => holdsRow(state, body, n ? bodies[n - 1].index : at))) break;
      const front = bodies[bodies.length - 1];
      if (end.kind === 'void') dest = end.index;
      else if (end.kind === 'pit' || end.kind === 'edge' && spikedEdges(state).includes(end.side)) {
        const cause = end.kind === 'pit' ? 'pit' : 'spikes';
        if (!front.cell) {
          // Spikes hurt the cat, which then holds the row; an open pit is fatal as always.
          const heroDamage = damageHero(state, cause === 'pit' ? state.player.hp : SPIKE_HERO_DAMAGE);
          yield { kind: 'crush', index: front.index, cause, heroDamage, damage: heroDamage, killed: state.player.hp === 0 };
          if (state.player.hp === 0) return;
          break;
        }
        const cell = front.cell, hpBefore = cell.hp;
        cell.hp = 0; cell.defeated = true; removeDefeated(state.board, cell);
        yield { kind: 'crush', index: front.index, cause, cell, damage: Math.max(1, hpBefore), killed: true };
        dest = front.index; moving = bodies.slice(0, -1);
      } else break;
    }
    const shift = shiftRow(state, boar, at, moving, dest, displaced);
    at = shift.to; moved++;
    yield { kind: 'shift', ...shift };
    for (const move of shift.moves) {
      if (state.terrain[move.to] !== 'thorns') continue;
      if (move.id === HERO_MOVE_ID) {
        const heroDamage = damageHero(state, THORN_DAMAGE);
        yield { kind: 'crush', index: move.to, cause: 'thorns', heroDamage, damage: heroDamage, killed: state.player.hp === 0 };
        if (state.player.hp === 0) return;
        continue;
      }
      const cell = state.board[move.to];
      if (!cell || !isCellAlive(cell)) continue;
      const outcome = damageCell(cell, THORN_DAMAGE, 'hazard');
      if (outcome.killed) removeDefeated(state.board, cell);
      yield { kind: 'crush', index: move.to, cause: 'thorns', cell, damage: outcome.damage, killed: outcome.killed };
    }
  }
  // A boar that could not move at all is stunned: it rests and the next physical hit is doubled.
  if (!moved) { boar.behavior.restTurns = 1; boar.status.brittle = true; yield { kind: 'stun', index: at }; }
  yield { kind: 'end', boarId: boar.id, from: start, index: at, moved };
}

/** Every ready boar in board order at the start of the phase; a lethal impact on the cat ends the phase. */
export function* resolveCharges(state: ForestState, displaced: Set<number>): Generator<ChargeImpact> {
  for (const { cell, index } of uniqueEntities(state.board)) {
    if (state.board[index] !== cell || !chargeReady(cell, displaced)) continue;
    yield* resolveBoarCharge(state, cell, index, displaced);
    if (state.player.hp <= 0) return;
  }
}
