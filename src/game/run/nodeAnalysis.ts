/**
 * Analyzer setups for forest-map node battles (scripts/analyze-levels.ts `--node`, `--nodes`).
 * A node battle is started exactly as in a run, through ForestEngine.startRunBattle, with the analysis entry:
 * 5/5 HP, 0 energy (the analyzer's --energy overrides it), no items, and the tools every route has opened on entering the node (guaranteedNodeTools);
 * for a battle not yet bound to a node, the tools guaranteed on the whole row given with `--row`.
 * The refill seed is the battle's authored seed; the palette is the row palette plus the authored colors.
 */
import { FOREST_RUN_START_HP, nodeRunTemplate } from './forestRun';
import { authoredRefillPalette, FOREST_MAP, forestNode, guaranteedNodeTools, guaranteedRowTools, nodeBattleTemplate, type ForestMapNode, type GuaranteedTools } from './forestMap';
import { FOREST_NODE_BATTLES, forestBattle } from './forestBattles';
import type { AuthoredLesson } from '../lessonBuilder';
import type { RunBattleSetup, RunBattleTemplate } from './runBattle';

export interface NodeAnalysisTarget { id: string; row: number; tools: GuaranteedTools; setup: RunBattleSetup }

function setupFor(nodeId: string, label: string, template: RunBattleTemplate, authored: AuthoredLesson, row: number, tools: GuaranteedTools): RunBattleSetup {
  return { nodeId, label, seed: authored.definition.seed, template, row,
    player: { hp: FOREST_RUN_START_HP, maxHp: FOREST_RUN_START_HP, energy: 0 }, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
    allowedItems: [...tools.items], allowedAbilities: [...tools.abilities], paletteWeights: authoredRefillPalette(authored, row) };
}

function fromNode(node: ForestMapNode, id = node.id): NodeAnalysisTarget {
  const template = nodeRunTemplate(node), authored = nodeBattleTemplate(node);
  if (!template || !authored) throw new Error(`Узел ${node.id}: нет авторского боя (привал, находка или заглушка).`);
  const tools = guaranteedNodeTools(node.id);
  return { id, row: node.row, tools, setup: setupFor(node.id, node.name, template, authored, node.row, tools) };
}

function fromRow(battleId: string, row: number): NodeAnalysisTarget {
  const authored = forestBattle(battleId)!, tools = guaranteedRowTools(row);
  if (!tools) throw new Error(`На карте нет ряда ${row}.`);
  return { id: `${battleId}@row${row}`, row, tools, setup: setupFor(`analysis:${battleId}`, authored.name, { kind: 'battle', id: battleId }, authored, row, tools) };
}

/**
 * Analysis targets of one id: a registry battle id (checked first) or a map node id.
 * A registry battle is analyzed on every node that plays it, or on row `row` when given;
 * an unbound battle needs `row`.
 */
export function nodeAnalysisTargets(id: string, row?: number): NodeAnalysisTarget[] {
  if (forestBattle(id)) {
    if (row !== undefined) return [fromRow(id, row)];
    const nodes = FOREST_MAP.filter(node => node.content.kind === 'battle' && node.content.battleId === id);
    if (!nodes.length) throw new Error(`Бой ${id} не привязан к узлу карты: укажи ряд флагом --row.`);
    return nodes.map(node => fromNode(node, `${id}@${node.id}`));
  }
  const node = forestNode(id);
  if (!node) throw new Error(`Нет боя или узла карты с id ${id}.`);
  if (row !== undefined && row !== node.row) throw new Error(`Узел ${id} стоит в ряду ${node.row}; --row задаётся только для боя из реестра.`);
  return [fromNode(node)];
}

/** Targets of every registry battle; unbound battles without `row` are listed in `skipped`. */
export function allNodeBattleTargets(row?: number): { targets: NodeAnalysisTarget[]; skipped: string[] } {
  const targets: NodeAnalysisTarget[] = [], skipped: string[] = [];
  for (const id of Object.keys(FOREST_NODE_BATTLES)) {
    const bound = FOREST_MAP.some(node => node.content.kind === 'battle' && node.content.battleId === id);
    if (!bound && row === undefined) { skipped.push(id); continue; }
    targets.push(...nodeAnalysisTargets(id, bound ? undefined : row));
  }
  return { targets, skipped };
}
