import { chainNeighbors, simulateChain } from './forestSystems';
import type { EnemyColor, ForestState } from './forestTypes';
import { deviceAt } from './devices';
import { allowedSpawnColors } from './customLevel';

/** Only a two-enemy witness is needed; prisms may connect its two physical targets. */
export function hasOrdinaryChain(state: ForestState): boolean {
  return chooseGeneratedColors(state, new Set());
}

/** Candidate-only fallback. Never edits an entity outside the supplied generated IDs. */
export function chooseGeneratedColors(state: ForestState, generatedIds: ReadonlySet<number>, colorLimits: ReadonlyMap<number, readonly EnemyColor[]> = new Map()): boolean {
  const ordinary = { ...state, chosenAbility: null };
  const visit = (path: number[]): boolean => {
    const cell = ordinary.board[path[path.length - 1]];
    if (!cell) {
      const preview = simulateChain(ordinary, path, true).preview;
      // A lever may threaten this intermediate endpoint, while continuing the
      // same chain moves the cat clear before its deferred volley resolves.
      if (!preview.valid) return false;
      for (const next of chainNeighbors(ordinary, path[path.length - 1])) {
        if (!path.includes(next) && (ordinary.board[next] || deviceAt(ordinary, next)) && visit([...path, next])) return true;
      }
      return false;
    }
    const original = cell.color;
    const allowed: EnemyColor[] = allowedSpawnColors(state).filter(color => !colorLimits.has(cell.id) || colorLimits.get(cell.id)!.includes(color));
    const colors = generatedIds.has(cell.id) && original !== null ? [...allowed.includes(original) ? [original] : [], ...allowed.filter(color => color !== original)] : [original];
    for (const color of colors) {
      cell.color = color;
      const preview = simulateChain(ordinary, path, true).preview;
      if (!preview.valid) continue;
      if (preview.enemies >= 2 || preview.opensDoor !== undefined) return true;
      if (preview.endsOnSurvivor || preview.completesRoom || path.length >= 4) continue;
      for (const next of chainNeighbors(ordinary, path[path.length - 1])) {
        const target = ordinary.board[next];
        if (!path.includes(next) && (target && !path.some(index => ordinary.board[index]?.id === target.id) || deviceAt(ordinary, next)) && visit([...path, next])) return true;
      }
    }
    cell.color = original; return false;
  };
  for (const start of chainNeighbors(ordinary, ordinary.player.index)) {
    const cell = ordinary.board[start];
    if (cell && cell.kind !== 'prism' && visit([start])) return true;
  }
  return false;
}
