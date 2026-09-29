/**
 * Level analyzer: automatic, heuristic metrics for authored battles.
 *
 * Every action is resolved by a private `ForestEngine` through its public commands
 * (`availableMoves`, `preview`, `previewAbility`, `previewItem`, `releaseChain`,
 * `useAbility`, `waitTurn`, `useItem`), so the analyzer uses the same rules,
 * forecast and seeded refill as the game. The analyzed engine is only read through
 * `captureAnalysisSnapshot()`; its state, RNG and ID allocator are never advanced.
 *
 * The numbers are estimates bounded by depth, beam and node budget; see
 * docs/level-metrics.md for definitions and limits.
 */
import { ForestEngine, type AnalysisSnapshot } from './forestEngine';
import { TUTORIAL_LESSONS } from './tutorialLevels';
import { chainAdjacent, isWalkable, JUMP_RANGE } from './forestSystems';
import { uniqueEntities } from './entityFootprint';
import { isCellAlive } from './cellLife';
import { planEnemyPhase } from './enemyPhase';
import { applyDamageEffect, tickDamageEffects } from './damageEffects';
import type { ChainPreview, ForestCell, ForestState, ItemKind } from './forestTypes';
import type { CustomLevelDefinition } from './customLevel';

export type AnalysisAction =
  | { kind: 'chain'; path: number[] }
  | { kind: 'jump'; target: number }
  | { kind: 'spin' }
  | { kind: 'rest' }
  | { kind: 'item'; item: ItemKind; target: number };

/** `true` means the tool is available to the solver (subject to the engine's own permissions). */
export interface ToolAccess { abilities: boolean; items: boolean; devices: boolean; prisms: boolean }
export const ALL_TOOLS: ToolAccess = { abilities: true, items: true, devices: true, prisms: true };

export interface SearchOptions {
  /** Turn horizon of the tree search. */
  depth: number;
  /** Children kept per internal node below the root (the root is always full width). */
  beam: number;
  /** Item actions kept per node, including the root. */
  itemBeam: number;
  /** Maximum number of new action-list computations (`availableMoves`) per search. */
  nodeBudget: number;
  /** `availableMoves(maxLength)` limit. */
  chainLength: number;
}
export interface AnalysisOptions extends SearchOptions {
  seeds: number;
  agentRuns: number;
  agentTurnLimit: number;
  search: boolean;
  restricted: boolean;
  agents: boolean;
  /** Honest planner S: resampled refill seeds per candidate first action. 0 disables S. */
  plannerResamples: number;
  /** Honest planner S: first actions it compares (best forecast score first, immediate wins always). */
  plannerCandidates: number;
  /** Recolor every starting enemy and measure the greedy agent (slow, off by default). */
  fragile: boolean;
}
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  depth: 3, beam: 3, itemBeam: 3, nodeBudget: 400, chainLength: 16,
  seeds: 3, agentRuns: 10, agentTurnLimit: 12, search: true, restricted: true, agents: true,
  plannerResamples: 8, plannerCandidates: 6, fragile: false,
};

export interface StaticMetrics {
  cols: number; rows: number; walkableCells: number; enemies: number; coloredEnemies: number; colors: number;
  components: number; componentSizes: number[]; largestComponentShare: number; colorInterleave: number;
  firstActions: { total: number; chains: number; jumps: number; spin: number; rest: number; items: number };
  armedEnemies: number; attackedCellShare: number; safeFirstChainShare: number;
}
export interface FirstActionOutcome {
  action: string; winTurns: number | null; hp: number | null; dies: boolean; resolvedDepth: number;
  /** true: dies or no win within the horizon (fully searched); null: the budget left it unresolved. */
  trap: boolean | null;
  /** Other inputs with the identical resulting position (merged into this first action). */
  aliases?: string[];
}
export interface SearchStats {
  expansions: number; executions: number; memoHits: number; beamCuts: number; itemCuts: number;
  movesCapHits: number; budgetExhausted: boolean; previewMismatches: number;
  /** Horizon-leaf actions executed because a win may come in the enemy phase (damage-over-time ticks). */
  lateWinChecks: number;
}
export interface SearchResult {
  seed: number; depth: number; exhaustive: boolean;
  winnable: boolean; minTurns: number | null; bestHp: number | null; bestHpAtMin: number | null;
  firstActions: number; solutionsAtMin: number; firstMoveWinShare: number; trapShare: number; unresolvedFirstActions: number;
  criticality: number | null; criticalityComplete: boolean; solutionLine: string[];
  /** w_t along the solution line: share of distinct actions that keep the optimum at step t. */
  lineShares: number[];
  /** Fling-style key moves: steps of the solution line with w_t <= 0.1. */
  keyMoves: number;
  stats: SearchStats; outcomes?: FirstActionOutcome[];
}
export interface RestrictedResult {
  applicable: boolean; winnable?: boolean; minTurns?: number | null; bestHp?: number | null; exhaustive?: boolean;
  requires: boolean; benefitTurns: number | null; benefitHp: number | null;
  /** Agents with the tool disabled; `need*` = I(without) - I(with) in bits. */
  agents?: { random: AgentSummary; greedy: AgentSummary; needRandom: BitsDelta; needGreedy: BitsDelta };
}
/** A bits value; when a win rate is 0, `bits` is null (infinite) and `atLeast` uses the Wilson upper bound. */
export interface Bits { bits: number | null; atLeast: number }
export interface BitsDelta { bits: number | null; atLeast: number | null }
export interface AgentSummary {
  runs: number; wins: number; winRate: number; winRateCi95: [number, number]; losses: number;
  /** TSI-style information I = -log2 P(win). */
  info: Bits;
  avgHp: number; avgTurns: number; avgWinTurns: number | null; winHpMedian: number | null; winHpP10: number | null;
}
export interface PlannerResult {
  resamples: number; candidates: { action: string; robustness: number }[]; choice: string | null;
  /** Evaluated candidates that win within depth under >= 80% of resampled refills. */
  robustFirstMoves: number;
  pOracle: number; pHonest: number; fortuneGap: number; budgetExhausted: boolean;
}
export interface DeceptionResult {
  reference: 'honest' | 'oracle'; pReference: number; pGreedy: number; deception: number | null;
  greedyFirstMove: string | null; greedyTrap: boolean | null; greedyTrapSeedShare: number | null;
}
export interface FragileCell { cell: string; from: number; to: number; pGreedy: number; delta: number }
export interface SeedSensitivity { seeds: number[]; minTurns: (number | null)[]; bestHp: (number | null)[]; minTurnsSpread: number | null; bestHpSpread: number | null; winnableShare: number }
export interface LevelAnalysis {
  level: { id: string; name: string; source: string };
  options: AnalysisOptions;
  static: StaticMetrics;
  search: SearchResult[] | null;
  planner: PlannerResult | null;
  restricted: Record<'abilities' | 'items' | 'devices' | 'prisms', RestrictedResult> | null;
  agents: { random: AgentSummary; greedy: AgentSummary } | null;
  deception: DeceptionResult | null;
  seedSensitivity: SeedSensitivity | null;
  fragileCells: { baselineGreedy: number; cells: FragileCell[] } | null;
  notes: string[];
}

// ---------------------------------------------------------------- helpers

export function cellLabel(state: Pick<ForestState, 'cols'>, index: number): string {
  return `${String.fromCharCode(65 + index % state.cols)}${Math.floor(index / state.cols) + 1}`;
}
export function actionLabel(state: Pick<ForestState, 'cols'>, action: AnalysisAction): string {
  switch (action.kind) {
    case 'chain': return `chain ${action.path.map(index => cellLabel(state, index)).join('-')}`;
    case 'jump': return `jump ${cellLabel(state, action.target)}`;
    case 'spin': return 'spin';
    case 'rest': return 'rest';
    case 'item': return `${action.item} ${cellLabel(state, action.target)}`;
  }
}
const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** 64-bit (two 32-bit lanes) string hash; collisions are negligible at analysis scale. */
function hashString(text: string): string {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761); b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ a >>> 16, 2246822507) ^ Math.imul(b ^ b >>> 13, 3266489909);
  b = Math.imul(b ^ b >>> 16, 2246822507) ^ Math.imul(a ^ a >>> 13, 3266489909);
  return (a >>> 0).toString(36) + ':' + (b >>> 0).toString(36);
}
// Presentation text and static authored data never change what can happen next.
const IGNORED_KEYS = new Set(['message', 'score', 'lastDamage', 'chain', 'chosenAbility', 'level', 'waveLabel', 'hintDismissed', 'definition']);
function stateText(state: ForestState): string {
  return JSON.stringify(state, (key, value) => IGNORED_KEYS.has(key) ? undefined : value);
}
/** Deterministic PRNG for the random agent (independent of the game's RNG). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = a + 0x6d2b79f5 >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** Alternate refill seeds keep the authored starting position and only change the RNG stream. */
export function variantSeed(base: number, k: number): number {
  if (k === 0) return base >>> 0;
  let h = (base ^ Math.imul(k, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return (h ^ h >>> 16) >>> 0;
}

function goalWeight(state: ForestState, cell: ForestCell | null | undefined): number {
  if (!cell || cell.kind === 'prism') return 0;
  const definition = state.customLevel?.definition;
  if (cell.kind === 'door') return definition?.completion === 'exit' || !definition ? 1 : 0;
  if (state.tutorial?.targetIds.length) return state.tutorial.targetIds.includes(cell.id) ? 1 : 0;
  const keys = definition ? definition.goals.map(goal => goal.key) : ['kills', 'rangedKills', 'bossKills'];
  if (keys.includes('bossKills') && cell.kind === 'boss') return 1;
  if (keys.includes('rangedKills') && cell.kind === 'ranged') return 1;
  return keys.includes('kills') ? 0.3 : 0;
}

// ---------------------------------------------------------------- nodes and actions

interface AnalysisNode { snap: AnalysisSnapshot; hash: string; movesKey: string; phase: ForestState['phase']; hp: number; maxHp: number; turn: number }
interface ActionInfo {
  action: AnalysisAction; label: string; main: boolean;
  /** The engine forecast says the action ends the battle with a win. */
  win: boolean;
  /**
   * No forecast win, but burning/poison may still defeat a target during the enemy phase
   * (`turnSystems` ticks and `settleTurn` goals), which no chain forecast reports.
   */
  lateWin: boolean;
  dies: boolean; incoming: number; kills: number; dealt: number; goal: number; score: number;
  usesDevice: boolean; usesPrism: boolean;
}

function makeNode(snap: AnalysisSnapshot): AnalysisNode {
  snap.entry = null;
  const text = stateText(snap.state);
  return { snap, hash: hashString(`${text}|${snap.rng}|${snap.nextId}|${snap.pendingPrism}`), movesKey: hashString(text),
    phase: snap.state.phase, hp: snap.state.player.hp, maxHp: snap.state.player.maxHp, turn: snap.state.turn };
}

function describePreview(state: ForestState, preview: ChainPreview) {
  let goal = 0, dealt = 0;
  for (const hit of [...preview.hits, ...preview.trapHits ?? []]) {
    const weight = goalWeight(state, state.board[hit.index]);
    const removed = Math.max(0, hit.hpBefore - hit.hpAfter);
    dealt += removed;
    goal += weight * (removed + (hit.killed ? 50 : 0));
  }
  const kills = preview.kills + (preview.trapKills ?? 0);
  return { goal, dealt, kills };
}

/**
 * Could the next end-of-turn burning/poison tick defeat a goal entity? Uses the engine's own
 * tick rule on the forecast HP and stacks (existing stacks plus the stack this action applies).
 * Conservative: it only decides which horizon-leaf actions are executed, never the result.
 */
function tickMayWin(state: ForestState, preview: ChainPreview | null): boolean {
  const hits = new Map<number, ChainPreview['hits'][number]>();
  for (const hit of preview ? [...preview.hits, ...preview.trapHits ?? []] : []) { const cell = state.board[hit.index]; if (cell) hits.set(cell.id, hit); }
  for (const { cell } of uniqueEntities(state.board)) {
    if (cell.kind === 'door' || cell.kind === 'prism' || !isCellAlive(cell) || !goalWeight(state, cell)) continue;
    const hit = hits.get(cell.id);
    if (hit?.killed) continue;
    const effect = hit ? hit.attackEffect ?? (hit.physical ? state.player.attackEffect : undefined) : undefined;
    const effects = effect ? applyDamageEffect(cell.damageEffects, effect) : cell.damageEffects;
    const damage = tickDamageEffects(effects).hits.reduce((sum, tick) => sum + tick.damage, 0);
    if (damage > 0 && (hit ? hit.hpAfter : cell.hp) <= damage) return true;
  }
  return false;
}

/** Shared worker engine plus the per-level action cache (actions depend on the position, not on the RNG). */
class Analyzer {
  readonly worker = new ForestEngine();
  private readonly actionCache = new Map<string, ActionInfo[]>();
  constructor(readonly options: AnalysisOptions) { this.worker.animationScale = 0; }

  load(node: AnalysisNode) { this.worker.restoreAnalysisSnapshot(node.snap); }

  cached(node: AnalysisNode) { return this.actionCache.get(node.movesKey); }

  /** Enumerate the player's options through engine previews. Caller accounts for the budget. */
  computeActions(node: AnalysisNode): ActionInfo[] {
    const known = this.actionCache.get(node.movesKey); if (known) return known;
    this.load(node);
    const g = this.worker, state = g.state, infos: ActionInfo[] = [];
    if (state.phase !== 'PLAYER_INPUT') { this.actionCache.set(node.movesKey, infos); return infos; }
    const deviceCells = new Set(state.devices.map(device => device.index));
    const push = (action: AnalysisAction, preview: ChainPreview | null, extra: Partial<ActionInfo> = {}) => {
      const described = preview ? describePreview(state, preview) : { goal: 0, dealt: 0, kills: 0 };
      const win = !!preview?.completesRoom, dies = !!preview?.playerDies, incoming = preview?.damage ?? 0;
      const lateWin = !win && !dies && !!preview && tickMayWin(state, preview);
      const score = win ? 1e6 + 100 * (state.player.hp - incoming) : dies ? -1e6
        : 10 * described.goal + 2 * described.kills + described.dealt + (preview?.energyGain ?? 0) - 40 * incoming;
      infos.push({ action, label: actionLabel(state, action), main: action.kind !== 'item', win, lateWin, dies, incoming, ...described, score,
        usesDevice: action.kind === 'chain' && action.path.some(index => deviceCells.has(index)),
        usesPrism: action.kind === 'chain' && action.path.some(index => state.board[index]?.kind === 'prism'), ...extra });
    };
    for (const path of g.availableMoves(this.options.chainLength)) push({ kind: 'chain', path }, g.preview(path));
    for (let target = 0; target < state.board.length; target++) {
      const dx = target % state.cols - state.player.index % state.cols, dy = Math.floor(target / state.cols) - Math.floor(state.player.index / state.cols);
      if (target === state.player.index || dx * dx + dy * dy > JUMP_RANGE * JUMP_RANGE) continue;
      const preview = g.previewAbility('jump', target);
      if (preview.valid) push({ kind: 'jump', target }, preview);
    }
    const spin = g.previewAbility('spin');
    if (spin.valid) push({ kind: 'spin' }, spin);
    // Rest has no chain forecast; the announced attacks on the current square are its visible cost.
    const incoming = planEnemyPhase(state.board, state.player.index, undefined, state).attacks.filter(attack => attack.hitsHero).reduce((sum, attack) => sum + attack.cell.intent.damage, 0);
    infos.push({ action: { kind: 'rest' }, label: 'rest', main: true, win: false, lateWin: incoming < state.player.hp && tickMayWin(state, null), dies: incoming >= state.player.hp, incoming, kills: 0, dealt: 0, goal: 0,
      score: -5 - 40 * incoming, usesDevice: false, usesPrism: false });
    if (!state.itemPrepared) for (const item of ['frost', 'bomb', 'fire', 'healing'] as ItemKind[]) {
      if (state.inventory[item] < 1 || state.tutorial && !state.tutorial.allowedItems.includes(item)) continue;
      const targets = item === 'healing' ? [state.player.index] : uniqueEntities(state.board).map(entity => entity.index);
      for (const target of targets) {
        const preview = g.previewItem(item, target);
        if (!preview.valid) continue;
        const cells = preview.indices.map(index => state.board[index]).filter((cell): cell is ForestCell => !!cell && cell.kind !== 'door');
        // Bombing a zero-HP filler only trades one weak enemy for a refill; it is pruned as noise.
        if (item === 'bomb' && state.board[target]?.kind !== 'door' && (state.board[target]?.hp ?? 0) <= 0 && !goalWeight(state, state.board[target])) continue;
        const goal = cells.reduce((sum, cell) => sum + goalWeight(state, cell) * (item === 'bomb' ? Math.min(cell.hp, preview.damage) + (cell.hp <= preview.damage ? 50 : 0) : item === 'fire' ? 3 : 5), 0);
        const score = item === 'healing' ? 20 * preview.healing : item === 'frost' ? 5 * (g.previewFrost(target).skippedCells.length ? 1 : 0) + 10 * goal : 10 * goal + cells.length;
        infos.push({ action: { kind: 'item', item, target }, label: actionLabel(state, { kind: 'item', item, target }), main: false, win: false, lateWin: false, dies: false,
          incoming: 0, kills: 0, dealt: preview.damage, goal, score, usesDevice: false, usesPrism: false });
      }
    }
    this.actionCache.set(node.movesKey, infos);
    return infos;
  }

  /** Resolve one action on the worker. Returns null when the engine rejects it. */
  async execute(node: AnalysisNode, action: AnalysisAction): Promise<AnalysisNode | null> {
    this.load(node);
    const g = this.worker, before = g.state.turn;
    switch (action.kind) {
      case 'chain': g.state.chain = [...action.path]; await g.releaseChain(); break;
      case 'jump': await g.useAbility('jump', action.target); break;
      case 'spin': await g.useAbility('spin'); break;
      case 'rest': await g.waitTurn(); break;
      case 'item': if (!g.useItem(action.item, action.target)) return null; break;
    }
    if (action.kind !== 'item' && g.state.phase === 'PLAYER_INPUT' && g.state.turn === before) return null;
    return makeNode(g.captureAnalysisSnapshot());
  }
}

function allowed(info: ActionInfo, tools: ToolAccess): boolean {
  if (!tools.abilities && (info.action.kind === 'jump' || info.action.kind === 'spin')) return false;
  if (!tools.items && info.action.kind === 'item') return false;
  if (!tools.devices && info.usesDevice) return false;
  if (!tools.prisms && info.usesPrism) return false;
  return true;
}
const byScore = (a: ActionInfo, b: ActionInfo) => b.score - a.score;

// ---------------------------------------------------------------- tree search

/** `complete` is false only when the node budget cut the subtree. */
interface Value { winTurns: number; hpAtMin: number; maxHp: number; complete: boolean }
const NONE: Value = { winTurns: Infinity, hpAtMin: -1, maxHp: -1, complete: true };
const INCOMPLETE: Value = { ...NONE, complete: false };
function merge(best: Value, value: Value, turns: number): Value {
  const winTurns = value.winTurns + turns;
  return {
    winTurns: Math.min(best.winTurns, winTurns),
    hpAtMin: winTurns < best.winTurns ? value.hpAtMin : winTurns === best.winTurns ? Math.max(best.hpAtMin, value.hpAtMin) : best.hpAtMin,
    maxHp: Math.max(best.maxHp, value.maxHp),
    complete: best.complete && value.complete,
  };
}

class TreeSearch {
  readonly stats: SearchStats = { expansions: 0, executions: 0, memoHits: 0, beamCuts: 0, itemCuts: 0, movesCapHits: 0, budgetExhausted: false, previewMismatches: 0, lateWinChecks: 0 };
  private readonly memo = new Map<string, Value>();
  private readonly executeAll: boolean;
  constructor(private readonly analyzer: Analyzer, private readonly tools: ToolAccess, private readonly options: SearchOptions, root: AnalysisNode) {
    const definition = root.snap.state.customLevel?.definition;
    // A direct "survive N turns" goal is checked after the enemy phase, which no chain forecast reports.
    this.executeAll = !!definition && definition.completion === 'direct' && definition.goals.some(goal => goal.key === 'turns');
  }

  actions(node: AnalysisNode): ActionInfo[] | null {
    let infos = this.analyzer.cached(node);
    if (!infos) {
      if (this.stats.expansions >= this.options.nodeBudget) { this.stats.budgetExhausted = true; return null; }
      this.stats.expansions++;
      infos = this.analyzer.computeActions(node);
      if (infos.filter(info => info.action.kind === 'chain').length >= 240) this.stats.movesCapHits++;
    }
    return infos.filter(info => allowed(info, this.tools));
  }

  /** Main actions plus the best-scored items, in deterministic order. */
  candidates(infos: ActionInfo[], root: boolean, leaf: boolean): ActionInfo[] {
    const items = infos.filter(info => !info.main).sort(byScore);
    if (items.length > this.options.itemBeam) this.stats.itemCuts++;
    const keptItems = items.slice(0, this.options.itemBeam);
    const main = infos.filter(info => info.main);
    if (leaf && !this.executeAll) {
      const late = main.filter(info => info.lateWin);
      this.stats.lateWinChecks += late.length;
      return [...main.filter(info => info.win), ...late, ...keptItems];
    }
    if (root) return [...main, ...keptItems];
    const ordered = [...main].sort(byScore);
    const wins = ordered.filter(info => info.win), rest = ordered.filter(info => !info.win && !info.dies);
    if (rest.length > this.options.beam) this.stats.beamCuts++;
    return [...wins, ...rest.slice(0, this.options.beam), ...keptItems];
  }

  async child(node: AnalysisNode, info: ActionInfo): Promise<AnalysisNode | null> {
    this.stats.executions++;
    const child = await this.analyzer.execute(node, info.action);
    if (child && info.win && child.phase !== 'WIN') this.stats.previewMismatches++;
    return child;
  }

  async evaluate(node: AnalysisNode, remaining: number): Promise<Value> {
    if (node.phase === 'WIN') return { winTurns: 0, hpAtMin: node.hp, maxHp: node.hp, complete: true };
    if (node.phase !== 'PLAYER_INPUT' || remaining <= 0) return NONE;
    const key = `${node.hash}|${remaining}`, known = this.memo.get(key);
    if (known) { this.stats.memoHits++; return known; }
    const infos = this.actions(node);
    if (!infos) return INCOMPLETE;
    let value: Value = { ...NONE };
    for (const info of this.candidates(infos, false, remaining === 1)) {
      const child = await this.child(node, info);
      if (!child) continue;
      const turns = child.turn - node.turn;
      value = merge(value, await this.evaluate(child, remaining - turns), turns);
    }
    // Only a budget cut is stored as incomplete; beam and item pruning are reported through stats.
    if (value.complete) this.memo.set(key, value);
    return value;
  }

  async run(root: AnalysisNode, seed: number, withOutcomes: boolean): Promise<SearchResult> {
    const depth = this.options.depth, infos = this.actions(root) ?? [];
    const children: { info: ActionInfo; node: AnalysisNode; value: Value; resolved: number; aliases: string[] }[] = [];
    const seen = new Map<string, typeof children[number]>();
    for (const info of this.candidates(infos, true, false)) {
      const node = await this.child(root, info);
      if (!node) continue;
      // Different inputs with an identical resulting position are one distinguishable first action.
      const known = seen.get(node.hash);
      if (known) { known.aliases.push(info.label); continue; }
      const entry = { info, node, value: node.phase === 'WIN' ? { winTurns: 0, hpAtMin: node.hp, maxHp: node.hp, complete: true } : NONE, resolved: 0, aliases: [] as string[] };
      seen.set(node.hash, entry); children.push(entry);
    }
    const order = [...children].sort((a, b) => byScore(a.info, b.info));
    for (let pass = 1; pass <= depth && !this.stats.budgetExhausted; pass++) {
      for (const entry of order) {
        const turns = entry.node.turn - root.turn, remaining = pass - turns;
        if (entry.resolved >= pass || remaining < 0) continue;
        // A win at full HP cannot be improved by looking deeper.
        if (entry.value.winTurns < Infinity && entry.value.maxHp >= entry.node.maxHp) { entry.resolved = depth; continue; }
        const value = await this.evaluate(entry.node, remaining);
        if (this.stats.budgetExhausted && !value.complete && value.winTurns === Infinity) break;
        entry.value = value; entry.resolved = pass;
      }
    }
    const turnsOf = (entry: typeof children[number]) => entry.value.winTurns + entry.node.turn - root.turn;
    const winners = children.filter(entry => entry.value.winTurns < Infinity);
    const minTurns = winners.length ? Math.min(...winners.map(turnsOf)) : null;
    const atMin = winners.filter(entry => turnsOf(entry) === minTurns);
    const traps = children.filter(entry => entry.node.phase === 'LOSE' || entry.value.winTurns === Infinity && entry.resolved >= depth && entry.value.complete);
    const unresolved = children.filter(entry => entry.value.winTurns === Infinity && !traps.includes(entry));
    const best = [...atMin].sort((a, b) => b.value.hpAtMin - a.value.hpAtMin || byScore(a.info, b.info))[0];
    const line = best ? await this.optimalLine(root, best.info, best.node, minTurns!, atMin.length / children.length) : { labels: [], shares: [], criticality: null, complete: true };
    const exhaustive = !this.stats.budgetExhausted && this.stats.beamCuts === 0 && this.stats.itemCuts === 0 && this.stats.movesCapHits === 0
      && children.every(entry => entry.value.complete || entry.value.winTurns < Infinity);
    const result: SearchResult = {
      seed, depth, exhaustive,
      winnable: winners.length > 0, minTurns,
      bestHp: winners.length ? Math.max(...winners.map(entry => entry.value.maxHp)) : null,
      bestHpAtMin: atMin.length ? Math.max(...atMin.map(entry => entry.value.hpAtMin)) : null,
      firstActions: children.length, solutionsAtMin: atMin.length,
      firstMoveWinShare: children.length ? round(winners.length / children.length) : 0,
      trapShare: children.length ? round(traps.length / children.length) : 0,
      unresolvedFirstActions: unresolved.length,
      criticality: line.criticality === null ? null : round(line.criticality), criticalityComplete: line.complete,
      solutionLine: line.labels, lineShares: line.shares.map(share => round(share)), keyMoves: line.shares.filter(share => share <= 0.1).length,
      stats: { ...this.stats },
    };
    if (withOutcomes) result.outcomes = children.map(entry => ({ action: entry.info.label,
      winTurns: entry.value.winTurns < Infinity ? turnsOf(entry) : null, hp: entry.value.winTurns < Infinity ? entry.value.hpAtMin : null,
      dies: entry.node.phase === 'LOSE', resolvedDepth: Math.min(entry.resolved, depth),
      trap: traps.includes(entry) ? true : entry.value.winTurns < Infinity ? false : null,
      ...(entry.aliases.length ? { aliases: entry.aliases } : {}) }));
    return result;
  }

  /**
   * Follow one optimal line. At each position the share of distinct actions that still
   * reach the win in the optimal number of turns is recorded; the mean is `criticality`.
   * The root share equals solutionsAtMin / firstActions. Deeper positions are evaluated at full width.
   */
  private async optimalLine(root: AnalysisNode, firstInfo: ActionInfo, firstNode: AnalysisNode, minTurns: number, rootShare: number) {
    const labels = [firstInfo.label], shares = [rootShare];
    let complete = true;
    let node = firstNode, left = minTurns - (firstNode.turn - root.turn);
    while (node.phase === 'PLAYER_INPUT' && left > 0) {
      const options = await this.distinctChildren(node);
      if (!options) { complete = false; break; }
      let preserved = 0, next: { info: ActionInfo; node: AnalysisNode; hp: number } | null = null;
      for (const option of options) {
        const turns = option.node.turn - node.turn, value = await this.evaluate(option.node, left - turns);
        complete &&= value.complete || value.winTurns < Infinity;
        if (value.winTurns + turns !== left) continue;
        preserved++;
        if (!next || value.hpAtMin > next.hp) next = { info: option.info, node: option.node, hp: value.hpAtMin };
      }
      if (!options.length) break;
      shares.push(preserved / options.length);
      if (!next) { complete = false; break; }
      labels.push(next.info.label); left -= next.node.turn - node.turn; node = next.node;
    }
    return { labels, shares, criticality: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null, complete };
  }

  private async distinctChildren(node: AnalysisNode) {
    const infos = this.actions(node);
    if (!infos) return null;
    const seen = new Set<string>(), result: { info: ActionInfo; node: AnalysisNode }[] = [];
    for (const info of this.candidates(infos, true, false)) {
      const child = await this.child(node, info);
      if (!child || seen.has(child.hash)) continue;
      seen.add(child.hash); result.push({ info, node: child });
    }
    return result;
  }
}

// ---------------------------------------------------------------- static metrics

export function staticMetrics(state: ForestState, rootActions: ActionInfo[]): StaticMetrics {
  const walkable = state.board.map((_, index) => isWalkable(state, index));
  const entities = uniqueEntities(state.board).filter(({ cell }) => cell.kind !== 'door' && cell.kind !== 'prism' && isCellAlive(cell));
  const colored = entities.filter(({ cell }) => cell.color !== null);
  const touching = (a: number[], b: number[]) => a.some(from => b.some(to => chainAdjacent(state, from, to)));
  // Same-color components use the chain's own adjacency (8 directions, blocked diagonal corners).
  const parent = colored.map((_, n) => n);
  const find = (n: number): number => parent[n] === n ? n : (parent[n] = find(parent[n]));
  let pairs = 0, mixed = 0;
  for (let i = 0; i < colored.length; i++) for (let j = i + 1; j < colored.length; j++) {
    if (!touching(colored[i].indices, colored[j].indices)) continue;
    pairs++;
    if (colored[i].cell.color !== colored[j].cell.color) mixed++;
    else parent[find(i)] = find(j);
  }
  const sizes = new Map<number, number>();
  colored.forEach((_, n) => sizes.set(find(n), (sizes.get(find(n)) ?? 0) + 1));
  const componentSizes = [...sizes.values()].sort((a, b) => b - a);
  const armed = entities.filter(({ cell }) => !cell.behavior.passive && cell.variant !== 'beacon' && cell.variant !== 'porcupine' && cell.variant !== 'shaman');
  const attacked = new Set<number>();
  for (const { cell } of armed) if (cell.intent.damage > 0) for (const index of cell.intent.cells) if (walkable[index]) attacked.add(index);
  if (state.hazard.turnsUntil === 1) for (const index of state.hazard.cells) attacked.add(index);
  const chains = rootActions.filter(info => info.action.kind === 'chain');
  const count = (kind: AnalysisAction['kind']) => rootActions.filter(info => info.action.kind === kind).length;
  return {
    cols: state.cols, rows: state.rows, walkableCells: walkable.filter(Boolean).length,
    enemies: entities.length, coloredEnemies: colored.length, colors: new Set(colored.map(({ cell }) => cell.color)).size,
    components: componentSizes.length, componentSizes,
    largestComponentShare: colored.length ? round(componentSizes[0] / colored.length) : 0,
    colorInterleave: pairs ? round(mixed / pairs) : 0,
    firstActions: { total: rootActions.length, chains: chains.length, jumps: count('jump'), spin: count('spin'), rest: count('rest'), items: count('item') },
    armedEnemies: armed.length,
    attackedCellShare: round(attacked.size / Math.max(1, walkable.filter(Boolean).length)),
    safeFirstChainShare: chains.length ? round(chains.filter(info => !info.dies && info.incoming === 0).length / chains.length) : 0,
  };
}

// ---------------------------------------------------------------- agents

/** First-action outcome by its label, including inputs merged into it by identical result. */
function outcomeOf(result: SearchResult | undefined, label: string | undefined) {
  return label === undefined ? undefined : result?.outcomes?.find(entry => entry.action === label || entry.aliases?.includes(label));
}
/** Greedy by immediate result: win now > survive > kills > damage dealt > safe end > less incoming damage. */
function greedyChoice(infos: ActionInfo[]): ActionInfo | undefined {
  return infos.filter(info => info.main).sort((a, b) => Number(b.win) - Number(a.win) || Number(a.dies) - Number(b.dies) || b.kills - a.kills
    || b.dealt - a.dealt || Number(a.incoming > 0) - Number(b.incoming > 0) || a.incoming - b.incoming)[0];
}
interface AgentRun { won: boolean; hp: number; turns: number; lost: boolean }
async function runAgent(analyzer: Analyzer, root: AnalysisNode, kind: 'random' | 'greedy', agentSeed: number, turnLimit: number, tools: ToolAccess = ALL_TOOLS): Promise<AgentRun> {
  const random = mulberry32(agentSeed);
  let node = root;
  while (node.phase === 'PLAYER_INPUT' && node.turn - root.turn < turnLimit) {
    const infos = analyzer.computeActions(node).filter(info => allowed(info, tools));
    const choice = kind === 'random' ? infos[Math.floor(random() * infos.length)] : greedyChoice(infos);
    if (!choice) break;
    const next = await analyzer.execute(node, choice.action);
    if (!next) break;
    node = next;
  }
  return { won: node.phase === 'WIN', hp: node.phase === 'LOSE' ? 0 : node.hp, turns: node.turn - root.turn, lost: node.phase === 'LOSE' };
}
/** Wilson score interval, 95%. */
export function wilson(wins: number, runs: number): [number, number] {
  if (!runs) return [0, 1];
  const z = 1.96, p = wins / runs, denominator = 1 + z * z / runs;
  const centre = (p + z * z / (2 * runs)) / denominator, half = z * Math.sqrt(p * (1 - p) / runs + z * z / (4 * runs * runs)) / denominator;
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}
/** I = -log2 P; with no wins the point value is infinite and the Wilson upper bound gives a lower bound. */
export function informationBits(wins: number, runs: number): Bits {
  const [, upper] = wilson(wins, runs);
  return { bits: wins > 0 ? round(-Math.log2(wins / runs)) : null, atLeast: round(upper > 0 ? -Math.log2(upper) : Infinity) };
}
function bitsDelta(without: Bits, withTool: Bits): BitsDelta {
  if (without.bits !== null && withTool.bits !== null) return { bits: round(without.bits - withTool.bits), atLeast: null };
  if (without.bits === null && withTool.bits !== null) return { bits: null, atLeast: round(without.atLeast - withTool.bits) };
  return { bits: null, atLeast: null };
}
function quantile(sorted: number[], q: number) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null; }
function summarize(results: AgentRun[]): AgentSummary {
  const wins = results.filter(result => result.won);
  const mean = (values: number[]) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : 0;
  const winHp = wins.map(result => result.hp).sort((a, b) => a - b);
  return { runs: results.length, wins: wins.length, winRate: results.length ? round(wins.length / results.length) : 0, winRateCi95: wilson(wins.length, results.length),
    losses: results.filter(result => result.lost).length, info: informationBits(wins.length, results.length),
    avgHp: mean(results.map(result => result.hp)), avgTurns: mean(results.map(result => result.turns)),
    avgWinTurns: wins.length ? mean(wins.map(result => result.turns)) : null, winHpMedian: quantile(winHp, 0.5), winHpP10: quantile(winHp, 0.1) };
}
async function runAgents(analyzer: Analyzer, roots: AnalysisNode[], options: AnalysisOptions, tools: ToolAccess = ALL_TOOLS) {
  const random: AgentRun[] = [], greedy: AgentRun[] = [];
  for (const root of roots) {
    // The greedy agent is deterministic, so one run per refill seed covers it.
    greedy.push(await runAgent(analyzer, root, 'greedy', 0, options.agentTurnLimit, tools));
    for (let run = 0; run < options.agentRuns; run++) random.push(await runAgent(analyzer, root, 'random', variantSeed(root.snap.rng, run + 1), options.agentTurnLimit, tools));
  }
  return { random: summarize(random), greedy: summarize(greedy) };
}

/**
 * Honest planner S (Isaksen et al. 2017): the oracle search knows the real refill seed.
 * S instead scores each candidate first action by the share of resampled refill seeds under
 * which the oracle can still win within the horizon, commits to the best one without knowing
 * the real seed, and is then scored on the evaluation seeds. Only the first refill is hidden.
 */
async function honestPlanner(analyzer: Analyzer, base: AnalysisSnapshot, rootFor: (seed: number) => AnalysisNode, seeds: number[], search: SearchResult[], options: AnalysisOptions): Promise<PlannerResult> {
  const root = rootFor(seeds[0]);
  const planner = new TreeSearch(analyzer, ALL_TOOLS, options, root);
  const infos = analyzer.computeActions(root).filter(info => info.main);
  const ordered = [...infos].sort(byScore);
  const candidates = [...ordered.filter(info => info.win), ...ordered.filter(info => !info.win && !info.dies).slice(0, options.plannerCandidates)];
  const resamples = Array.from({ length: options.plannerResamples }, (_, j) => variantSeed(base.rng ^ 0x5bd1e995, j + 1));
  const winsAfter = async (info: ActionInfo, seed: number) => {
    const child = await analyzer.execute(rootFor(seed), info.action);
    if (!child) return false;
    return (await planner.evaluate(child, options.depth - (child.turn - root.turn))).winTurns < Infinity;
  };
  const scored: { info: ActionInfo; robustness: number }[] = [];
  for (const info of candidates) {
    let wins = 0;
    // An immediate win happens before any refill, so no resampling can change it.
    if (info.win) wins = resamples.length;
    else for (const seed of resamples) if (await winsAfter(info, seed)) wins++;
    scored.push({ info, robustness: resamples.length ? wins / resamples.length : 0 });
  }
  const choice = [...scored].sort((a, b) => b.robustness - a.robustness || byScore(a.info, b.info))[0];
  let honestWins = 0;
  if (choice) for (let k = 0; k < seeds.length; k++) {
    const outcome = outcomeOf(search[k], choice.info.label);
    if (outcome && outcome.trap !== null ? outcome.winTurns !== null : await winsAfter(choice.info, seeds[k])) honestWins++;
  }
  const pOracle = search.filter(result => result.winnable).length / search.length, pHonest = honestWins / seeds.length;
  return { resamples: resamples.length, candidates: scored.map(entry => ({ action: entry.info.label, robustness: round(entry.robustness) })),
    choice: choice?.info.label ?? null, robustFirstMoves: scored.filter(entry => entry.robustness >= 0.8).length,
    pOracle: round(pOracle), pHonest: round(pHonest), fortuneGap: round(pOracle - pHonest), budgetExhausted: planner.stats.budgetExhausted };
}

/** Recolor each starting colored enemy to every other palette color and replay the greedy agent. */
async function fragileCells(analyzer: Analyzer, base: AnalysisSnapshot, seeds: number[], options: AnalysisOptions, baseline: number) {
  const state = base.state;
  const palette = state.customLevel ? state.customLevel.paletteWeights.flatMap((weight, color) => weight > 0 ? [color] : []) : [0, 1, 2, 3, 4];
  const colors = [...new Set([...palette, ...state.board.flatMap(cell => cell && cell.color !== null ? [cell.color] : [])])].sort();
  const cells: FragileCell[] = [];
  for (const { cell, index } of uniqueEntities(state.board)) {
    if (cell.color === null || cell.kind === 'door' || cell.kind === 'prism') continue;
    for (const color of colors) {
      if (color === cell.color) continue;
      let wins = 0;
      for (const seed of seeds) {
        const snap = structuredClone(base); snap.rng = seed;
        const target = snap.state.board[index]!; target.color = color as typeof target.color;
        if ((await runAgent(analyzer, makeNode(snap), 'greedy', 0, options.agentTurnLimit)).won) wins++;
      }
      const pGreedy = wins / seeds.length;
      if (Math.abs(pGreedy - baseline) > 0.2) cells.push({ cell: cellLabel(state, index), from: cell.color, to: color, pGreedy: round(pGreedy), delta: round(pGreedy - baseline) });
    }
  }
  return cells;
}

// ---------------------------------------------------------------- entry points

export type LevelSource =
  | { kind: 'lesson'; index: number }
  | { kind: 'custom'; definition: CustomLevelDefinition | unknown; id?: string }
  | { kind: 'forest'; seed?: number };

/** Start a level on a fresh engine; returns null if the engine rejects it. */
export function startLevelEngine(source: LevelSource): ForestEngine | null {
  const engine = new ForestEngine(); engine.animationScale = 0;
  if (source.kind === 'lesson') return engine.startTutorial(source.index) ? engine : null;
  if (source.kind === 'custom') return engine.startCustomLevel(source.definition) ? engine : null;
  engine.startLevel(0, source.seed ?? 701);
  return engine;
}

export function sourceInfo(source: LevelSource, engine: ForestEngine) {
  if (source.kind === 'lesson') return { id: `lesson-${source.index + 1}`, name: engine.state.level.name, source: `tutorial ${source.index + 1} (${TUTORIAL_LESSONS[source.index].id})` };
  if (source.kind === 'custom') return { id: source.id ?? 'custom', name: engine.state.level.name, source: 'custom JSON' };
  return { id: 'forest', name: engine.state.level.name, source: 'forest trial' };
}

/**
 * Analyze the current position of `engine` (normally a freshly started battle).
 * The engine is only read via `captureAnalysisSnapshot()`.
 */
export async function analyzeEngine(engine: ForestEngine, partial: Partial<AnalysisOptions> = {}, info = { id: 'position', name: engine.state.level.name, source: 'engine' }): Promise<LevelAnalysis> {
  const options: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...partial };
  const analyzer = new Analyzer(options);
  const base = engine.captureAnalysisSnapshot();
  const root = makeNode(structuredClone(base));
  const notes: string[] = [];
  const state = root.snap.state;
  const rootActions = analyzer.computeActions(root);
  const metrics = staticMetrics(state, rootActions);
  const seeds = Array.from({ length: Math.max(1, options.seeds) }, (_, k) => variantSeed(base.rng, k));
  const rootFor = (seed: number) => { const snap = structuredClone(base); snap.rng = seed; return makeNode(snap); };
  if (state.phase !== 'PLAYER_INPUT') notes.push(`Position is not awaiting input (${state.phase}).`);

  let search: SearchResult[] | null = null, restricted: LevelAnalysis['restricted'] = null, sensitivity: SeedSensitivity | null = null;
  let planner: PlannerResult | null = null, agents: LevelAnalysis['agents'] = null, deception: DeceptionResult | null = null;
  const active = state.phase === 'PLAYER_INPUT';
  const tutorial = state.tutorial;
  const applicable = {
    abilities: !tutorial || tutorial.allowedAbilities.length > 0,
    items: Object.entries(state.inventory).some(([item, amount]) => amount > 0 && (!tutorial || tutorial.allowedItems.includes(item as ItemKind))),
    devices: state.devices.length > 0,
    prisms: state.board.some(cell => cell?.kind === 'prism') || !!state.customLevel && !tutorial,
  };
  const tools = ['abilities', 'items', 'devices', 'prisms'] as const;
  if (options.search && active) {
    search = [];
    for (let k = 0; k < seeds.length; k++) search.push(await new TreeSearch(analyzer, ALL_TOOLS, options, rootFor(seeds[k])).run(rootFor(seeds[k]), seeds[k], true));
    const minTurns = search.map(result => result.minTurns), bestHp = search.map(result => result.bestHp);
    const spread = (values: (number | null)[]) => { const known = values.filter((value): value is number => value !== null); return known.length ? Math.max(...known) - Math.min(...known) : null; };
    sensitivity = { seeds, minTurns, bestHp, minTurnsSpread: spread(minTurns), bestHpSpread: spread(bestHp), winnableShare: round(search.filter(result => result.winnable).length / search.length) };
    if (options.plannerResamples > 0) planner = await honestPlanner(analyzer, base, rootFor, seeds, search, options);
    if (options.restricted) {
      const baseResult = search[0];
      restricted = {} as NonNullable<LevelAnalysis['restricted']>;
      for (const tool of tools) {
        if (!applicable[tool]) { restricted[tool] = { applicable: false, requires: false, benefitTurns: null, benefitHp: null }; continue; }
        const result = await new TreeSearch(analyzer, { ...ALL_TOOLS, [tool]: false }, options, rootFor(seeds[0])).run(rootFor(seeds[0]), seeds[0], false);
        restricted[tool] = { applicable: true, winnable: result.winnable, minTurns: result.minTurns, bestHp: result.bestHp, exhaustive: result.exhaustive,
          requires: baseResult.winnable && !result.winnable,
          benefitTurns: baseResult.minTurns !== null && result.minTurns !== null ? result.minTurns - baseResult.minTurns : null,
          benefitHp: baseResult.bestHp !== null && result.bestHp !== null ? baseResult.bestHp - result.bestHp : null };
      }
    }
  }
  const roots = seeds.map(rootFor);
  if (options.agents && active) {
    agents = await runAgents(analyzer, roots, options);
    if (options.restricted) {
      restricted ??= Object.fromEntries(tools.map(tool => [tool, { applicable: applicable[tool], requires: false, benefitTurns: null, benefitHp: null }])) as NonNullable<LevelAnalysis['restricted']>;
      for (const tool of tools) {
        if (!applicable[tool]) continue;
        const without = await runAgents(analyzer, roots, options, { ...ALL_TOOLS, [tool]: false });
        restricted[tool].agents = { ...without, needRandom: bitsDelta(without.random.info, agents.random.info), needGreedy: bitsDelta(without.greedy.info, agents.greedy.info) };
      }
    }
    const reference = planner ? 'honest' as const : 'oracle' as const;
    const pReference = planner ? planner.pHonest : sensitivity ? sensitivity.winnableShare : null;
    if (pReference !== null) {
      const first = greedyChoice(rootActions);
      // Unknown (budget-cut or missing) outcomes stay null instead of counting as traps.
      const trapBySeed = search?.map(result => outcomeOf(result, first?.label)?.trap ?? null) ?? [];
      const known = trapBySeed.filter((value): value is boolean => value !== null);
      deception = { reference, pReference: round(pReference), pGreedy: agents.greedy.winRate,
        deception: pReference > 0 ? round(1 - agents.greedy.winRate / pReference) : null,
        greedyFirstMove: first?.label ?? null, greedyTrap: trapBySeed[0] ?? null,
        greedyTrapSeedShare: known.length ? round(known.filter(Boolean).length / known.length) : null };
    }
  }
  let fragile: LevelAnalysis['fragileCells'] = null;
  if (options.fragile && active) {
    const baseline = agents ? agents.greedy.winRate : (await runAgents(analyzer, roots, { ...options, agentRuns: 0 })).greedy.winRate;
    fragile = { baselineGreedy: baseline, cells: await fragileCells(analyzer, base, seeds, options, baseline) };
  }
  // Per-action outcomes are kept for the real seed only.
  search?.forEach((result, k) => { if (k > 0) delete result.outcomes; });
  return { level: info, options, static: metrics, search, planner, restricted, agents, deception, seedSensitivity: sensitivity, fragileCells: fragile, notes };
}

/** Start `source` on a private engine and analyze its opening position. */
export async function analyzeLevel(source: LevelSource, partial: Partial<AnalysisOptions> = {}): Promise<LevelAnalysis> {
  const engine = startLevelEngine(source);
  if (!engine) throw new Error('The engine rejected the level.');
  const options = { ...partial };
  const notes: string[] = [];
  if (source.kind === 'forest') {
    // Three waves and a 20 HP boss are far beyond any affordable search horizon.
    options.search = false;
    notes.push('Forest: tree search and restricted solvers are skipped (victory needs three waves); static metrics and agents only.');
  }
  const result = await analyzeEngine(engine, options, sourceInfo(source, engine));
  result.notes.push(...notes);
  return result;
}
