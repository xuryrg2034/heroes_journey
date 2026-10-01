import { chainNeighbors, planChain, shieldBlocksEntry } from './forestSystems';
import type { EnemyColor, ForestState } from './forestTypes';
import { deviceAt } from './devices';
import { allowedSpawnColors } from './customLevel';
import { isCellAlive } from './cellLife';

/**
 * Safety net for pathological authored boards (many devices and prisms). Real
 * scenes finish in a few dozen chain evaluations; the reachability pruning below
 * keeps the depth-first search linear whenever it is exact.
 */
export const GENERATION_SEARCH_BUDGET = 4000;

/** Only a two-enemy witness is needed; prisms may connect its two physical targets. */
export function hasOrdinaryChain(state: ForestState): boolean {
  return chooseGeneratedColors(state, new Set());
}

/** Candidate-only fallback. Never edits an entity outside the supplied generated IDs. */
export function chooseGeneratedColors(state: ForestState, generatedIds: ReadonlySet<number>, colorLimits: ReadonlyMap<number, readonly EnemyColor[]> = new Map()): boolean {
  const ordinary = { ...state, chosenAbility: null };
  const palette = allowedSpawnColors(state);
  const allowedFor = (id: number): EnemyColor[] => palette.filter(color => !colorLimits.has(id) || colorLimits.get(id)!.includes(color));
  let budget = GENERATION_SEARCH_BUDGET;
  const evaluate = (path: number[]) => { budget--; return planChain(ordinary, path, true).preview; };
  /**
   * Sound pruning for a path that already holds its first enemy. The only cells
   * a chain may pass before its second enemy are unvisited devices and prisms, so
   * a plain breadth-first search over them decides whether any second enemy or
   * door can still be entered (adjacency, shield side and colour are the same
   * checks the chain evaluator applies). It over-approximates only doors, bleeding
   * and the requirement that a colour-resetting prism precede the second enemy.
   */
  const canReachSecondTarget = (path: number[]): boolean => {
    const inPath = new Set(path), ids = new Set<number>();
    let color: EnemyColor | null | undefined, prismReachable = false, mismatched = false;
    for (const index of path) {
      const cell = ordinary.board[index]; if (!cell) continue;
      ids.add(cell.id);
      if (cell.kind === 'prism' || cell.color === null) color = null;
      else if (color === undefined) color = cell.color;
    }
    const wild = color === null || color === undefined;
    const queue = [path[path.length - 1]], queued = new Set(queue);
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head];
      for (const next of chainNeighbors(ordinary, from)) {
        if (inPath.has(next) || queued.has(next)) continue;
        const cell = ordinary.board[next];
        if (!cell) { if (deviceAt(ordinary, next)) { queued.add(next); queue.push(next); } continue; }
        if (ids.has(cell.id) || cell.kind !== 'door' && !isCellAlive(cell)) continue;
        if (cell.kind === 'prism') { prismReachable = true; queued.add(next); queue.push(next); continue; }
        // Terminal candidates stay unqueued: another approach side may pass a shield.
        if (shieldBlocksEntry(ordinary, cell, from, next)) continue;
        const recolorable = generatedIds.has(cell.id) && cell.color !== null;
        if (wild || cell.color === null || cell.color === color || recolorable && allowedFor(cell.id).includes(color as EnemyColor)) return true;
        mismatched = true;
      }
    }
    return prismReachable && mismatched;
  };
  const visit = (path: number[]): boolean => {
    if (budget <= 0) return false;
    const cell = ordinary.board[path[path.length - 1]];
    if (!cell) {
      const preview = evaluate(path);
      // A lever may threaten this intermediate endpoint, while continuing the
      // same chain moves the cat clear before its deferred volley resolves.
      if (!preview.valid || !canReachSecondTarget(path)) return false;
      for (const next of chainNeighbors(ordinary, path[path.length - 1])) {
        if (!path.includes(next) && (ordinary.board[next] || deviceAt(ordinary, next)) && visit([...path, next])) return true;
      }
      return false;
    }
    const original = cell.color;
    const allowed = allowedFor(cell.id);
    const colors = generatedIds.has(cell.id) && original !== null ? [...allowed.includes(original) ? [original] : [], ...allowed.filter(color => color !== original)] : [original];
    for (const color of colors) {
      if (budget <= 0) break;
      cell.color = color;
      const preview = evaluate(path);
      if (!preview.valid) continue;
      if (preview.enemies >= 2 || preview.opensDoor !== undefined) return true;
      // Any number of prisms may link the two enemies, exactly as in a played chain.
      if (preview.endsOnSurvivor || preview.completesRoom || !canReachSecondTarget(path)) continue;
      for (const next of chainNeighbors(ordinary, path[path.length - 1])) {
        const target = ordinary.board[next];
        if (!path.includes(next) && (target && !path.some(index => ordinary.board[index]?.id === target.id) || deviceAt(ordinary, next)) && visit([...path, next])) return true;
      }
    }
    cell.color = original; return false;
  };
  for (const start of chainNeighbors(ordinary, ordinary.player.index)) {
    const cell = ordinary.board[start];
    // A chain may start on a crystal or authored prism (30.09.2026); its colour comes from the first coloured target.
    if (cell && visit([start])) return true;
  }
  return false;
}
