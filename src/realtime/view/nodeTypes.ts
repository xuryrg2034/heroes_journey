/**
 * Icons and labels of the map node types on the real-time run's map (the same as the removed turn-based map screen's,
 * `NODE_TYPE_INFO`, tag `turn-based-final`). The hints are the slice's own (runView.ts).
 */
import type { ForestNodeType } from '../forest/forestMap';

export const RT_NODE_TYPES: Readonly<Record<ForestNodeType, { icon: string; label: string }>> = {
  battle: { icon: '⚔', label: 'Бой' },
  hard: { icon: '☠', label: 'Трудный бой' },
  rest: { icon: '☾', label: 'Привал' },
  find: { icon: '◈', label: 'Находка' },
  event: { icon: '?', label: 'Событие' },
  shop: { icon: '⚖', label: 'Торговец' },
  breakthrough: { icon: '⇥', label: 'Прорыв' },
  checkpoint: { icon: '▣', label: 'Контрольный бой' },
  boss: { icon: '♛', label: 'Босс' },
};
