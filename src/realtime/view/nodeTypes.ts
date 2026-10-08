/**
 * Icons and labels of the map node types on the real-time run's map — the same as the turn-based map screen's
 * (`NODE_TYPE_INFO` of src/forestMapScreen.ts; rtRun.spec.ts checks that they match). A table of its own, so the
 * real-time page does not load the turn-based map screen. The hints are the slice's own (runView.ts).
 */
import type { ForestNodeType } from '../../game/run/forestMap';

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
