import type { AuthoredLesson } from './lessonBuilder';
import { ABILITY_COST, chainNeighbors, cloneBoard, isWalkable, neighbors, prepareIntents, simulateAbility, simulateChain, simulateRest } from './forestSystems';
import { canHeal } from './recovered/combat';
import { uniqueEntities } from './entityFootprint';
import { applyRefillTier, nextRandom, refillTier, runPressureActive } from './mapBattleRules';
import { animationWait, playTurn, type TurnSequence } from './turnRuntime';
import { resolvePlayerTurn, resolveRestTurn, type TurnContext } from './turnSystems';
import { cleanseDamageEffects } from './damageEffects';
import { applyAttackEffect, assignDamageEffects, projectEnemyEffects } from './effectRules';
import { applyDamage, killCreature } from './combatRules';
import { allowedSpawnColors, customGoalsMet, refreshCustomProgress, validateCustomLevel, weightedColor } from './customLevel';
import type { ChainSimulation } from './forestSystems';
import { ITEMS } from './items';
import { chooseGeneratedColors, hasOrdinaryChain } from './boardGeneration';
import type { AbilityKind, CellKind, ChainPreview, EnemyColor, EnemyVariant, EngineEvent, ForestCell, ForestState, FrostPreview, ItemKind, ItemPreview, RotationPreview } from './forestTypes';
import type { RunBattleOutcome, RunBattleSetup } from './run/runBattle';
import { forestBattle } from './run/forestBattles';
import { FOREST_BEAST_HP } from './forestBeasts';
import { cloneState, type World } from './ecs/world';
import { TROLL_HP } from './troll';

const emptyProgress = () => ({ kills: 0, rangedKills: 0, bossKills: 0, turns: 0, armorKills: 0, prisms: 0, bossHits: 0 });
/** Seed of an engine before any battle is loaded; every battle replaces it with its own. */
const IDLE_SEED = 701;
/** Complete replayable position for offline analysis (`levelAnalysis.ts`); not a save format. */
export interface AnalysisSnapshot {
  state: ForestState; rng: number; nextId: number; seed: number;
  entry: { state: ForestState; rng: number; nextId: number } | null;
}
/** Independent copy of an analysis snapshot by the component registry (immutable battle data is shared). */
export function cloneAnalysisSnapshot(snapshot: AnalysisSnapshot): AnalysisSnapshot {
  const { entry } = snapshot;
  return { state: cloneState(snapshot.state), rng: snapshot.rng, nextId: snapshot.nextId, seed: snapshot.seed,
    entry: entry ? { state: cloneState(entry.state), rng: entry.rng, nextId: entry.nextId } : null };
}
interface GeneratedBoard { state: ForestState; generatedIds: Set<number>; spawned: number[]; nextId: number }
/**
 * Battle facade. The only game mode is the forest-map run: a node battle starts with `startRunBattle`; the level
 * editor starts its own authored level with `startCustomLevel`. Both load through `loadCustomLevel`.
 */
export class ForestEngine {
  animationScale = 1;
  /** The battle world: state (entity records and singletons) plus the RNG and ID allocator resources (ecs/world.ts). */
  private world: World;
  private listeners = new Set<(state: ForestState, event: EngineEvent) => void>();
  private generation = 0;
  private seed = IDLE_SEED;
  private entrySnapshot: { state: ForestState; rng: number; nextId: number } | null = null;

  constructor(seed = IDLE_SEED) {
    this.seed = seed;
    this.world = { state: this.initialState(), res: { rng: seed, nextId: 1 } };
    this.state.phase = 'TITLE';
  }
  /** Current battle state; rendering, the editor and tests read it as before. */
  get state(): ForestState { return this.world.state; }
  set state(value: ForestState) { this.world.state = value; }
  private get rng(): number { return this.world.res.rng; }
  private set rng(value: number) { this.world.res.rng = value; }
  private get nextId(): number { return this.world.res.nextId; }
  private set nextId(value: number) { this.world.res.nextId = value; }
  private initialState(): ForestState {
    return { phase: 'PLAYER_INPUT', level: { name: '', subtitle: '', description: '', tutorial: '', seed: this.seed, map: [], objectives: [], turnLimit: 0 },
      cols: 7, rows: 7, board: Array.from({ length: 49 }, () => null), terrain: [], devices: [], pits: [], player: { index: 0, hp: 5, maxHp: 5, energy: 0 },
      chain: [], chosenAbility: null, inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, itemPrepared: false, objective: emptyProgress(), turn: 0, score: 0,
      message: '', bossWarning: [], lastDamage: 0, rotations: [] };
  }
  subscribe(listener: (state: ForestState, event: EngineEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: EngineEvent = { type: 'state' }) { for (const listener of this.listeners) listener(this.state, event); }
  private random() { const draw = nextRandom(this.rng); this.rng = draw.state; return draw.value; }
  private createCell(kind: CellKind, color: EnemyColor | null, index: number): ForestCell {
    const hp = kind === 'boss' ? 20 : kind === 'ranged' ? 7 : kind === 'prism' ? 1 : 0;
    return { id: this.nextId++, kind, color, hp, maxHp: hp, armor: 0, countdown: 2,
      status: { wet: this.state.terrain[index] === 'puddle', frozen: 0, brittle: false },
      behavior: { aggressive: false, restTurns: 0 },
      intent: { cells: [], damage: 1, label: 'Готовится' } };
  }
  /** Start a forest-map node battle with the run's carried resources and opened tools (src/game/run). */
  startRunBattle(setup: RunBattleSetup): boolean {
    const { template } = setup;
    const lesson = template?.kind === 'battle' && typeof template.id === 'string' ? forestBattle(template.id) : undefined;
    if (!lesson) return false;
    return this.loadCustomLevel({ ...lesson.definition, seed: setup.seed, paletteWeights: [...setup.paletteWeights ?? lesson.definition.paletteWeights] }, lesson, setup);
  }
  /** Result of a finished map-node battle for the run model; null outside a node or before WIN/LOSE. */
  runBattleOutcome(): RunBattleOutcome | null {
    const node = this.state.runNode, phase = this.state.phase;
    if (!node || phase !== 'WIN' && phase !== 'LOSE') return null;
    const { hp, maxHp, energy, damageEffects } = this.state.player;
    return { nodeId: node.nodeId, won: phase === 'WIN', inventory: { ...this.state.inventory },
      player: { hp, maxHp, energy, ...(damageEffects ? { damageEffects: { ...damageEffects } } : {}) } };
  }
  private applyRunSetup(setup: RunBattleSetup) {
    const { player } = setup, state = this.state;
    state.player = { index: state.player.index, hp: Math.min(player.hp, player.maxHp), maxHp: player.maxHp, energy: player.energy,
      ...(player.damageEffects ? { damageEffects: { ...player.damageEffects } } : {}) };
    state.inventory = { ...setup.inventory };
    state.runNode = { nodeId: setup.nodeId, label: setup.label, row: setup.row, allowedItems: [...setup.allowedItems], allowedAbilities: [...setup.allowedAbilities] };
    if (state.tutorial) {
      state.tutorial.allowedItems = [...setup.allowedItems]; state.tutorial.allowedAbilities = [...setup.allowedAbilities];
    }
    state.level.subtitle = setup.label;
  }
  /** Tool permissions of a map-node battle; null (an editor level) means every tool is allowed. */
  private toolRules() { return this.state.tutorial ?? this.state.runNode ?? null; }
  /** Replay the battle from its entry snapshot: same layout, RNG and carried resources. */
  restartLevel() {
    if (!this.entrySnapshot) return;
    // A new World: a stale turn generator keeps its own world and can only change that abandoned copy (ECS plan §3.8).
    this.generation++; this.world = { state: cloneState(this.entrySnapshot.state), res: { rng: this.entrySnapshot.rng, nextId: this.entrySnapshot.nextId } };
    this.emit({ type: 'start' });
  }
  startCustomLevel(value: unknown): boolean { return this.loadCustomLevel(value); }
  /**
   * Load an editor level, or an authored node battle with its metadata (marked targets, passivity, hint) and the
   * run's resources and tools. The load is atomic: a rejected level restores the previous battle untouched.
   */
  private loadCustomLevel(value: unknown, lesson?: AuthoredLesson, run?: RunBattleSetup): boolean {
    const validation = validateCustomLevel(value);
    if (!validation.valid || !validation.definition) { this.emit({ type: 'invalid', text: validation.errors.join(' ') }); return false; }
    const definition = validation.definition;
    const previous = { world: this.world, seed: this.seed, generation: this.generation, entrySnapshot: this.entrySnapshot };
    try {
      this.generation++; this.seed = definition.seed;
      this.world = { state: this.initialState(), res: { rng: definition.seed, nextId: 1 } }; this.entrySnapshot = null;
      const state = this.state; state.cols = definition.cols; state.rows = definition.rows;
      state.devices = structuredClone(definition.devices ?? []);
      state.terrain = [...definition.terrain]; state.board = Array.from({ length: state.cols * state.rows }, () => null);
      state.player = { index: definition.heroIndex, hp: definition.playerHp ?? 5, maxHp: definition.playerHp ?? 5, energy: 0,
        ...(definition.playerAttackEffect ? { attackEffect: definition.playerAttackEffect } : {}) };
      state.inventory = { frost: 1, bomb: 1, healing: 1, fire: 1, ...definition.inventory };
      state.customLevel = { definition, goalCompletedTurn: null, paletteWeights: [...definition.paletteWeights] };
      const labels = { kills: 'Противники', rangedKills: 'Стрелки', bossKills: 'Боссы', turns: 'Выдержать ходов' };
      state.level = { name: definition.name, subtitle: 'Авторский уровень', description: 'Выполни заданные цели.',
        tutorial: definition.completion === 'exit' ? 'Выполни все цели, затем ударь выход цепочкой. Дополнительные цвета появятся после цели.' : 'Выполни все цели для победы.',
        seed: definition.seed, map: Array.from({ length: state.rows }, (_, y) => state.terrain.slice(y * state.cols, (y + 1) * state.cols).map(terrain => terrain === 'floor' || terrain === 'puddle' || terrain === 'thorns' ? 'R' : '#').join('')),
        objectives: definition.goals.map(goal => ({ ...goal, label: labels[goal.key] })), turnLimit: definition.turnLimit };
      if (lesson) {
        state.tutorial = { targetIds: [], hintDismissed: false, allowedItems: [], allowedAbilities: [] };
        state.inventory = { frost: 0, bomb: 0, healing: 0, fire: 0, ...definition.inventory };
        state.player = { index: definition.heroIndex, hp: 5, maxHp: 5, energy: 0 };
        state.objective.tutorialTargets = 0;
        state.level.subtitle = lesson.name; state.level.description = lesson.description; state.level.tutorial = lesson.hint;
        if (lesson.targetIndices.length) state.level.objectives = [{ key: 'tutorialTargets', target: lesson.targetIndices.length, label: 'Отмеченные цели' }];
      }
      // The run's row decides passivity and pressure of the enemies created below (mapBattleRules.ts).
      if (run) this.applyRunSetup(run);
      for (const enemy of definition.enemies) {
        const cell = enemy.variant ? this.createVariant(enemy.variant, enemy.index, enemy.color) : this.createCell(enemy.kind, enemy.color, enemy.index);
        cell.hp = cell.maxHp = enemy.hp; cell.behavior.aggressive = enemy.aggressive ?? false;
        if (lesson) {
          // Map rows ≥ 5 drop authored passivity: goblins join the growing anger, beasts follow their own rules.
          cell.behavior.passive = !runPressureActive(state) && !enemy.aggressive && enemy.variant !== 'jailer';
          if (lesson.targetIndices.includes(enemy.index)) state.tutorial!.targetIds.push(cell.id);
        }
        if (enemy.attackEffect) cell.attackEffect = enemy.attackEffect;
        if (enemy.footprint) cell.footprint = [...enemy.footprint];
        const indices = cell.footprint ?? [enemy.index]; cell.status.wet = indices.some(index => state.terrain[index] === 'puddle');
        for (const index of indices) state.board[index] = cell;
      }
      for (const door of definition.doors) {
        const footprint = door.footprint ?? [door.index], cell = this.createCell('door', null, door.index);
        cell.hp = cell.maxHp = 1; cell.door = { label: 'Выход', breached: false, footprint: [...footprint] };
        for (const index of footprint) state.board[index] = cell;
      }
      // An authored battle must have an opening in its layout, before any generated fill.
      if (lesson && !hasOrdinaryChain(state)) throw new Error('В авторском поле нет начальной цепочки.');
      // Author-painted cells are never included in the candidate recolour set.
      const result = this.selectGeneratedBoard(true);
      if (!hasOrdinaryChain(result.state)) throw new Error('Нет начальной цепочки: измени расстановку или палитру.');
      this.state = result.state; this.nextId = result.nextId; this.state.message = this.state.level.tutorial;
      this.entrySnapshot = { state: cloneState(this.state), rng: this.rng, nextId: this.nextId };
    } catch (error) {
      Object.assign(this, previous); this.emit({ type: 'invalid', text: error instanceof Error ? error.message : 'Уровень не удалось создать.' }); return false;
    }
    this.emit({ type: 'start' }); return true;
  }
  private createVariant(variant: EnemyVariant, index: number, color: EnemyColor | null): ForestCell {
    const boss = variant === 'jailer' || variant === 'troll';
    const cell = this.createCell(boss ? 'boss' : 'melee', boss ? null : color, index);
    cell.variant = variant; cell.hp = cell.maxHp = 7;
    if (variant in FOREST_BEAST_HP) cell.hp = cell.maxHp = FOREST_BEAST_HP[variant as keyof typeof FOREST_BEAST_HP];
    if (variant === 'jailer') { cell.shield = { dx: 0, dy: 1 }; cell.hp = cell.maxHp = 8; }
    if (variant === 'troll') cell.hp = cell.maxHp = TROLL_HP;
    cell.behavior.cycle = 0;
    return cell;
  }
  private createRoomMelee(color: EnemyColor, index: number): ForestCell {
    // Map rows ≥ 5: refills are never passive and grow stronger with the turn number (mapBattleRules.ts).
    if (runPressureActive(this.state)) return applyRefillTier(this.createCell('melee', color, index), refillTier(this.state));
    if (this.state.tutorial) { const cell = this.createCell('melee', color, index); cell.behavior.passive = true; return cell; }
    return this.createCell('melee', color, index);
  }
  /** Deep copy of the position, RNG and ID allocator. Reads only: the live game is not advanced. */
  captureAnalysisSnapshot(): AnalysisSnapshot {
    return cloneAnalysisSnapshot({ state: this.state, rng: this.rng, nextId: this.nextId, seed: this.seed, entry: this.entrySnapshot });
  }
  /** Load a copied position into this engine, cancelling any pending turn. No event is emitted. */
  restoreAnalysisSnapshot(snapshot: AnalysisSnapshot) {
    const copy = cloneAnalysisSnapshot(snapshot);
    this.generation++; this.world = { state: copy.state, res: { rng: copy.rng, nextId: copy.nextId } }; this.seed = copy.seed;
    this.entrySnapshot = copy.entry;
  }
  getBoardState() { return cloneBoard(this.state.board); }
  neighbors(index: number) { return neighbors(this.state, index); }
  chainNeighbors(index: number) { return chainNeighbors(this.state, index); }
  validStarts() { return this.chainNeighbors(this.state.player.index).filter(index => this.state.board[index] && simulateChain(this.state, [index], true).preview.valid); }
  setAbility(ability: AbilityKind | null): boolean {
    if (ability !== null && this.abilityLocked(ability)) return false;
    if (this.state.phase !== 'PLAYER_INPUT' || ability !== null && (!Object.hasOwn(ABILITY_COST, ability) || this.state.player.energy < ABILITY_COST[ability])) return false;
    this.state.chain = []; this.state.chosenAbility = this.state.chosenAbility === ability ? null : ability;
    this.emit({ type: 'ability-select', text: this.state.chosenAbility ?? '' }); return true;
  }
  private abilityLocked(ability: AbilityKind) { const rules = this.toolRules(); return !!rules && !rules.allowedAbilities.includes(ability); }
  private itemLocked(item: ItemKind) { const rules = this.toolRules(); return !!rules && !rules.allowedItems.includes(item); }
  previewAbility(ability: AbilityKind, targetIndex?: number) {
    const preview = simulateAbility(this.state, ability, targetIndex).preview;
    return this.abilityLocked(ability) && preview.valid ? { ...preview, valid: false, reason: 'Эта способность ещё не открыта.' } : preview;
  }
  async useAbility(ability: AbilityKind, targetIndex?: number): Promise<boolean> {
    if (this.state.phase !== 'PLAYER_INPUT' || !Object.hasOwn(ABILITY_COST, ability)) return false;
    if (this.abilityLocked(ability)) { this.emit({ type: 'invalid', text: 'Эта способность ещё не открыта.' }); return false; }
    const simulation = simulateAbility(this.state, ability, targetIndex);
    if (!simulation.preview.valid) { this.state.message = simulation.preview.reason; this.emit({ type: 'invalid', text: simulation.preview.reason }); return false; }
    return this.commitSimulation(simulation, ability);
  }
  beginChain(index: number) {
    if (this.state.phase !== 'PLAYER_INPUT' || this.state.chosenAbility === 'jump' || this.state.chosenAbility === 'spin') return false;
    const preview = simulateChain(this.state, [index], true).preview;
    if (!preview.valid) { this.emit({ type: 'invalid', index, text: preview.reason }); return false; }
    this.state.chain = [index]; this.emit({ type: 'chain', index }); return true;
  }
  extendChain(index: number) {
    const path = this.state.chain;
    if (this.state.phase !== 'PLAYER_INPUT' || !path.length) return false;
    if (index === path[path.length - 1]) return true;
    if (path.length > 1 && index === path[path.length - 2]) { path.pop(); this.emit({ type: 'chain', index }); return true; }
    if (!this.state.devices.length && simulateChain(this.state, path, true).preview.completesRoom) { this.emit({ type: 'invalid', index, text: 'Эта цепочка уже завершает бой.' }); return false; }
    const simulation = simulateChain(this.state, [...path, index], true, this.rng);
    if (!simulation.preview.valid) { this.emit({ type: 'invalid', index, text: simulation.preview.reason }); return false; }
    path.push(index); this.emit({ type: 'chain', index }); return true;
  }
  cancelChain() { if (this.state.phase === 'PLAYER_INPUT') { this.state.chain = []; this.state.chosenAbility = null; this.emit({ type: 'chain' }); } }
  /** Pure: crystals falling during the chain are drawn on a copy of the RNG; the live RNG, IDs and state are untouched. */
  preview(path = this.state.chain): ChainPreview { return simulateChain(this.state, path, false, this.rng).preview; }
  /** Forecast of Rest: the enemy phase that `waitTurn` would run now (pure: no state, RNG or ID change). */
  previewRest(): ChainPreview { return simulateRest(this.state); }
  previewRotations(path = this.state.chain) { return this.preview(path).rotations; }
  previewFrost(index: number): FrostPreview {
    const cell = this.state.board[index];
    let reason = '';
    if (this.itemLocked('frost')) reason = 'Этот расходник ещё не открыт.';
    else if (this.state.phase !== 'PLAYER_INPUT') reason = 'Подожди окончания хода.';
    else if (this.state.itemPrepared) reason = 'Один расходник за ход.';
    else if (this.state.inventory.frost < 1) reason = 'Холодный настой закончился.';
    else if (!cell || cell.kind === 'prism' || cell.kind === 'door') reason = 'Выбери противника.';
    // Since 30.09.2026 frost freezes any enemy, wet or dry (bosses included, as before); doors, prisms and crystals never.
    return { valid: !reason, reason, targetIndex: index, freezes: !reason,
      skippedCells: !reason && cell ? [...cell.intent.cells] : [] };
  }
  prepareFrost(index: number) {
    const preview = this.previewFrost(index);
    if (!preview.valid) { this.emit({ type: 'invalid', index, text: preview.reason }); return false; }
    const cell = this.state.board[index]!;
    this.state.inventory.frost--; this.state.itemPrepared = true;
    cell.status.frozen = Math.max(1, cell.status.frozen); cell.status.brittle = true;
    this.state.message = 'Цель замёрзла: пропустит действие, следующий удар ×2.';
    this.emit({ type: 'frost', index, text: 'ЗАМОРОЖЕН · ×2' }); return true;
  }
  useFrost(index: number) { return this.prepareFrost(index); }
  previewItem(item: ItemKind, index = this.state.player.index): ItemPreview {
    let reason = '';
    if (this.itemLocked(item)) reason = 'Этот расходник ещё не открыт.';
    else if (this.state.phase !== 'PLAYER_INPUT') reason = 'Подожди окончания хода.';
    else if (this.state.itemPrepared) reason = 'Один расходник за ход.';
    else if (this.state.inventory[item] < 1) reason = 'Этот расходник закончился.';
    if (item === 'frost') {
      const frost = this.previewFrost(index);
      return { valid: frost.valid && this.state.board[index]?.kind !== 'door', reason: reason || frost.reason || (this.state.board[index]?.kind === 'door' ? 'Настой действует на врагов.' : ''), indices: [index], damage: 0, healing: 0 };
    }
    if (item === 'healing') {
      if (!reason && !this.state.player.damageEffects?.poison && !this.state.player.damageEffects?.bleeding && !canHeal({ subtype: 0, power: this.state.player.hp, max_power: this.state.player.maxHp, colour: 0, properties: {}, attack_power: 0, attack_mode: 0 })) reason = 'Здоровье уже полное.';
      return { valid: !reason, reason, indices: [this.state.player.index], damage: 0, healing: Math.min(3, this.state.player.maxHp - this.state.player.hp) };
    }
    const target = this.state.board[index];
    if (!reason && target?.kind === 'door') reason = 'Авторский выход открывается выполнением всех целей.';
    if (!reason && (!target || target.kind === 'prism')) reason = 'Выбери врага.';
    const indices = [index, ...item === 'fire' ? this.neighbors(index).filter(other => other % this.state.cols === index % this.state.cols || Math.floor(other / this.state.cols) === Math.floor(index / this.state.cols)) : []]
      .filter(other => other !== this.state.player.index && this.state.board[other] && this.state.board[other]?.kind !== 'prism' && this.state.board[other]?.kind !== 'door');
    return { valid: !reason, reason, indices, damage: item === 'bomb' ? 6 : 0, healing: 0 };
  }
  useItem(item: ItemKind, index = this.state.player.index) {
    const preview = this.previewItem(item, index);
    if (!preview.valid) { this.emit({ type: 'invalid', index, text: preview.reason }); return false; }
    if (item === 'frost') return this.prepareFrost(index);
    const generation = this.generation; this.state.inventory[item]--; this.state.itemPrepared = true;
    if (item === 'healing') {
      this.state.player.hp += preview.healing;
      const cleansing = !!(this.state.player.damageEffects?.poison || this.state.player.damageEffects?.bleeding);
      assignDamageEffects(this.state.player, cleanseDamageEffects(this.state.player.damageEffects));
      if (cleansing) { this.emit({ type: 'status', index: this.state.player.index }); if (generation !== this.generation) return false; }
    }
    const damaged = new Set<number>();
    for (const targetIndex of preview.indices) {
      if (item === 'healing') break;
      const cell = this.state.board[targetIndex]; if (!cell || damaged.has(cell.id)) continue; damaged.add(cell.id);
      if (item === 'fire') {
        applyAttackEffect(cell, 'fire', true);
        this.emit({ type: 'status', index: targetIndex, effect: 'fire', amount: 1 });
        if (generation !== this.generation) return false;
        continue;
      }
      const outcome = applyDamage(cell, preview.damage, 'item');
      this.emit({ type: 'hit', index: targetIndex, amount: preview.damage });
      if (generation !== this.generation) return false;
      if (outcome.killed) {
        killCreature(this.state, cell, targetIndex, 'player');
        if (generation !== this.generation) return false;
        this.emit({ type: 'kill', index: targetIndex });
        if (generation !== this.generation) return false;
      }
    }
    this.emit({ type: 'item', index, indices: preview.indices, amount: preview.damage || preview.healing, text: ITEMS[item].label });
    if (generation !== this.generation) return false;
    if (this.state.customLevel?.definition.completion === 'direct' && customGoalsMet(this.state)) { this.finish(true); return true; }
    const spawned = this.generateBoard(false);
    if (spawned.length) { this.emit({ type: 'spawn', indices: spawned }); if (generation !== this.generation) return false; }
    this.emit(); return true;
  }
  async releaseChain(): Promise<boolean> {
    if (this.state.phase !== 'PLAYER_INPUT') return false;
    const path = [...this.state.chain], simulation = simulateChain(this.state, path, false, this.rng);
    if (!simulation.preview.valid) {
      this.state.chain = []; this.state.message = simulation.preview.reason;
      this.emit({ type: 'invalid', text: simulation.preview.reason }); return false;
    }
    return this.commitSimulation(simulation);
  }
  private commitSimulation(simulation: ChainSimulation, ability?: AbilityKind): Promise<boolean> {
    const context = this.turnContext();
    return this.play(resolvePlayerTurn(context, simulation, ability), context);
  }
  private turnContext(): TurnContext {
    // Commands and the systems act on the world of this turn; the facade services check the scene generation.
    const generation = this.generation, world = this.world, state = world.state;
    return {
      world,
      state,
      scratch: {},
      current: () => generation === this.generation,
      drawRandom: () => this.random(),
      cmd: {
        kill: (cell, index, credit) => killCreature(state, cell, index, credit),
        placeCrystal: (index, value) => {
          const crystal = this.createCell('prism', null, index); crystal.crystalChain = value;
          state.board[index] = crystal; return crystal;
        },
      },
      finish: (won, message) => this.finish(won, message),
      planRotationReplacements: rotations => this.planRotationReplacements(rotations),
      generateBoard: () => this.generateBoard(true),
      hint: () => this.hint(),
    };
  }
  private play(sequence: TurnSequence, context: TurnContext): Promise<boolean> {
    return playTurn(sequence, { isCurrent: context.current, emit: event => this.emit(event),
      wait: milliseconds => animationWait(milliseconds, this.animationScale) });
  }
  async waitTurn(): Promise<boolean> {
    if (this.state.phase !== 'PLAYER_INPUT') return false;
    const context = this.turnContext();
    return this.play(resolveRestTurn(context), context);
  }
  private planRotationReplacements(rotations: RotationPreview[]): Map<number, ForestCell> {
    const replacements = new Map<number, ForestCell>();
    const board = cloneBoard(this.state.board);
    for (const plan of rotations.filter(plan => plan.active)) for (const index of [plan.from, plan.to]) if (!board[index]) {
      const cell = this.createRoomMelee(this.refillColor(), index); replacements.set(index, cell); board[index] = cell;
    }
    if (!replacements.size) return replacements;
    const nextId = this.nextId;
    const projected: ForestState = { ...this.state, board: cloneBoard(board), objective: { ...this.state.objective },
      ...(this.state.customLevel ? { customLevel: { ...this.state.customLevel, paletteWeights: [...this.state.customLevel.paletteWeights] } } : {}) };
    for (const plan of rotations.filter(plan => plan.active)) {
      [projected.board[plan.from], projected.board[plan.to]] = [projected.board[plan.to], projected.board[plan.from]];
      for (const index of [plan.from, plan.to]) projected.board[index]!.status.wet = projected.terrain[index] === 'puddle';
    }
    projectEnemyEffects(projected);
    uniqueEntities(projected.board).forEach(({ cell }) => { if (cell.status.frozen > 0) cell.status.frozen--; });
    if (projected.customLevel) { projected.objective.turns++; refreshCustomProgress(projected); }
    const generatedIds = new Set([...replacements.values()].map(cell => cell.id));
    // Early replacements cannot borrow a colour that activates only after this enemy phase.
    const colorLimits = new Map([...generatedIds].map(id => [id, allowedSpawnColors(this.state)]));
    const result = this.selectGeneratedBoard(true, projected, generatedIds, colorLimits);
    for (const cell of result.state.board) if (cell && generatedIds.has(cell.id)) {
      const original = [...replacements.values()].find(target => target.id === cell.id)!; original.color = cell.color;
    }
    // Future refill was only a validation projection. Only the announced pair's IDs become live now.
    this.nextId = nextId; return replacements;
  }
  private generationCandidate(prepare: boolean, baseline: ForestState, initialIds: ReadonlySet<number>): GeneratedBoard {
    const state: ForestState = { ...baseline, board: cloneBoard(baseline.board), chosenAbility: null,
      rotations: baseline.rotations.map(plan => ({ ...plan })), bossWarning: [...baseline.bossWarning] };
    const result: GeneratedBoard = { state, generatedIds: new Set(initialIds), spawned: [], nextId: 0 };
    for (let index = 0; index < state.board.length; index++) {
      if (!isWalkable(state, index) || state.board[index] || index === state.player.index || state.devices.some(device => device.index === index)) continue;
      const cell = this.createRoomMelee(this.refillColor(state), index);
      state.board[index] = cell; result.spawned.push(index); result.generatedIds.add(cell.id);
    }
    if (prepare) prepareIntents(state, (min, max) => min + Math.floor(this.random() * (max - min)));
    result.nextId = this.nextId; return result;
  }
  /**
   * Fill the empty cells: up to 32 random candidates, then a recolour of the new enemies only; the final candidate
   * keeps its position when no recolour opens an ordinary chain (Rest remains an action).
   */
  private selectGeneratedBoard(prepare: boolean, baseline = this.state, initialIds: ReadonlySet<number> = new Set(),
    colorLimits: ReadonlyMap<number, readonly EnemyColor[]> = new Map()): GeneratedBoard {
    const firstId = this.nextId;
    const make = () => { this.nextId = firstId; return this.generationCandidate(prepare, baseline, initialIds); };
    let candidate = make();
    for (let attempt = 0; attempt < 32; attempt++) {
      if (attempt) candidate = make();
      if (hasOrdinaryChain(candidate.state)) return candidate;
    }
    if (chooseGeneratedColors(candidate.state, candidate.generatedIds, colorLimits)) return candidate;
    // One more draw, as before the removal of the old arrival modes: the RNG sequence of every seed is unchanged.
    candidate = make();
    chooseGeneratedColors(candidate.state, candidate.generatedIds, colorLimits);
    return candidate;
  }
  /** Refill the board (and prepare intents between turns); returns the cells that received a new enemy. The caller publishes `spawn`. */
  private generateBoard(prepare: boolean): number[] {
    const result = this.selectGeneratedBoard(prepare), previous = new Map(this.state.board.flatMap(cell => cell ? [[cell.id, cell] as const] : []));
    this.state.board = result.state.board.map(cell => {
      if (!cell) return null;
      const living = previous.get(cell.id); if (!living) return cell;
      if (prepare) { living.intent = cell.intent; living.behavior = cell.behavior; living.countdown = cell.countdown; living.shield = cell.shield; }
      return living;
    });
    if (prepare) { this.state.rotations = result.state.rotations; this.state.bossWarning = result.state.bossWarning; }
    this.nextId = result.nextId;
    return result.spawned;
  }
  /** Refill color: one weighted draw from the battle's palette (map row plus authored colors, or the editor weights). */
  private refillColor(state = this.state): EnemyColor {
    // Every battle is an authored level (a map node or an editor level); only a loaded battle ever refills.
    return weightedColor(state.customLevel!.paletteWeights, this.random());
  }
  availableMoves(maxLength = 16): number[][] {
    maxLength = Math.max(2, Math.min(16, maxLength));
    const best = new Map<string, number[]>();
    for (const start of this.validStarts()) {
      let budget = 1700;
      const walk = (path: number[]) => {
        if (--budget < 0) return;
        const simulation = simulateChain(this.state, path, true), result = simulation.preview;
        if (!result.valid) return;
        if (result.enemies >= 2 || result.opensDoor !== undefined) {
          const targets = path.filter(index => this.state.board[index]?.kind !== 'melee').join(',');
          const key = `${result.endIndex}:${targets}:${Math.min(7, result.enemies)}:${result.power}`;
          if (!best.has(key) || best.get(key)!.length < path.length) best.set(key, [...path]);
        }
        if (path.length >= maxLength || result.endsOnSurvivor || result.completesRoom) return;
        for (const index of this.chainNeighbors(path[path.length - 1])) {
          if ((this.state.board[index] || this.state.devices.some(device => device.index === index)) && !path.includes(index)) walk([...path, index]);
          if (budget < 0) break;
        }
      };
      walk([start]);
    }
    const weight = (path: number[]) => path.length + path.reduce((score, index) => score + (this.state.board[index]?.kind === 'door' ? 250 : this.state.board[index]?.kind === 'boss' ? 200 : this.state.board[index]?.kind === 'ranged' ? 40 : 0), 0);
    return [...best.values()].sort((a, b) => weight(b) - weight(a)).slice(0, 240);
  }
  private hint() {
    if (this.state.tutorial) return this.state.tutorial.hintDismissed ? '' : this.state.level.tutorial;
    if (this.state.customLevel) return this.state.customLevel.goalCompletedTurn === null ? 'Выполни все цели. Новые враги используют веса палитры уровня.' : 'Цели выполнены: ударь выход цепочкой. Новые цвета добавляются только при появлении врагов.';
    return '';
  }
  private finish(won: boolean, message?: string) {
    this.state.phase = won ? 'WIN' : 'LOSE'; this.state.chain = []; this.state.chosenAbility = null;
    this.state.message = message ?? (this.state.runNode ? won ? 'Узел пройден.' : 'Кот отступил. Повтори узел: запас восстановится как на входе.'
      : won ? 'Цели выполнены. Авторский уровень пройден!' : 'Кот отступил. Повтори уровень.');
    if (won) this.state.score += this.state.player.hp * 150 + Math.max(0, 12 - this.state.turn) * 70;
    this.emit({ type: won ? 'win' : 'lose', text: this.state.message });
  }
  winLevel() { this.generation++; this.finish(true); }
  damagePlayer(amount = 1) {
    const damage = Math.max(0, amount); this.state.player.hp = Math.max(0, this.state.player.hp - damage);
    this.emit({ type: 'damage', index: this.state.player.index, amount: damage });
    if (this.state.player.hp === 0) { this.generation++; this.finish(false); }
  }
}
