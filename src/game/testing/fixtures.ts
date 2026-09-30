/**
 * Shared fixtures of the logic specs (src/game/*.spec.ts). Not used by the game.
 *
 * - `FOREST_FIXTURE_MAP` / `forestFixtureLevel`: the 7×7 camp of the removed forest trial as an editor level — trees,
 *   pond, campfire and the puddle on E2 — with 39 ordinary goblins, five colors and no run pressure. It replaces the
 *   trial as the generic board of mechanic tests.
 * - `startNodeBattle`: a registry battle started exactly as a forest-map node (analysis entry: 5/5 HP, 0 energy,
 *   no items, the tools guaranteed on the node, row palette, authored seed) with optional overrides.
 */
import { ForestEngine } from '../forestEngine';
import type { CustomLevelDefinition } from '../customLevel';
import { COLOR_FROM_SYMBOL } from '../enemyPalette';
import type { TerrainKind } from '../forestTypes';
import { nodeAnalysisTargets } from '../run/nodeAnalysis';
import type { RunBattleSetup } from '../run/runBattle';

/** The camp map: `#` tree, `~` pond, `F` campfire, `H` the cat, color letters R G B Y P as in enemyPalette. */
export const FOREST_FIXTURE_MAP = ['#YYPPB#', 'YYPPPBR', 'YGG#BRR', 'GG~FBRG', 'RBBGGBG', '#RRBBBG', '#BRHG##'] as const;
/** Index of the puddle (E2) under an amethyst goblin. */
export const FOREST_FIXTURE_PUDDLE = 11;
/** Two ordinary chains of the camp opening (blue D6→E6→F6→F5, red F4→F3→G3→G2). */
export const FOREST_FIXTURE_OPENING = [[38, 39, 40, 33], [26, 19, 20, 13]] as const;

export function forestFixtureLevel(seed = 701): CustomLevelDefinition {
  const symbols = FOREST_FIXTURE_MAP.join('').split('');
  const terrain = symbols.map((symbol, index): TerrainKind => index === FOREST_FIXTURE_PUDDLE ? 'puddle'
    : symbol === '#' ? 'tree' : symbol === '~' ? 'pond' : symbol === 'F' ? 'campfire' : 'floor');
  const enemies = symbols.flatMap((symbol, index) => symbol in COLOR_FROM_SYMBOL
    ? [{ index, kind: 'melee' as const, color: COLOR_FROM_SYMBOL[symbol as keyof typeof COLOR_FROM_SYMBOL], hp: 0 }] : []);
  return { version: 1, name: 'Лагерь (фикстура)', seed, cols: 7, rows: 7, terrain, heroIndex: symbols.indexOf('H'), enemies, doors: [],
    goals: [{ key: 'kills', target: 100 }], turnLimit: 0, completion: 'direct', paletteWeights: [100, 100, 100, 100, 100], extraColors: [],
    playerHp: 5, inventory: { frost: 1, bomb: 1, healing: 1, fire: 1 } };
}

/** A fresh engine (animations off) on the camp fixture. Throws if the engine rejects it. */
export function startForestFixture(seed = 701, patch: Partial<CustomLevelDefinition> = {}): ForestEngine {
  const engine = new ForestEngine(); engine.animationScale = 0;
  if (!engine.startCustomLevel({ ...forestFixtureLevel(seed), ...patch })) throw new Error('forest fixture rejected');
  return engine;
}

/** Node setup of a registry battle as the analyzer starts it (first node that plays it), with overrides. */
export function nodeBattleSetup(battleId: string, overrides: Partial<RunBattleSetup> = {}): RunBattleSetup {
  const target = nodeAnalysisTargets(battleId)[0];
  return { ...target.setup, ...overrides };
}

/** A fresh engine (animations off) on a registry battle started as its map node. Throws if the engine rejects it. */
export function startNodeBattle(battleId: string, overrides: Partial<RunBattleSetup> = {}): ForestEngine {
  const engine = new ForestEngine(); engine.animationScale = 0;
  if (!engine.startRunBattle(nodeBattleSetup(battleId, overrides))) throw new Error(`battle ${battleId} rejected`);
  return engine;
}
