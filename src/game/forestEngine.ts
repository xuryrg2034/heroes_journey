import type { PlannedSummon } from './enemyPhase';
import { isCellAlive } from './cellLife';
import { TUTORIAL_LESSONS, type AuthoredLesson } from './tutorialLevels';
import { COLOR_FROM_SYMBOL, FOREST_LEVEL, WAVE_LABELS, WAVE_OBJECTIVES } from './forestLevel';
import { ABILITY_COST, canReplaceWithArrival, chainNeighbors, cloneBoard, isWalkable, neighbors, prepareIntents, simulateAbility, simulateChain, simulateRest } from './forestSystems';
import { canHeal } from './recovered/combat';
import { canPlaceFootprint, uniqueEntities } from './entityFootprint';
import { applyRefillTier, nextRandom, refillTier, runPressureActive } from './mapBattleRules';
import { animationWait, playTurn, type TurnSequence } from './turnRuntime';
import { resolveEnemyTurn, resolvePlayerTurn, type TurnContext } from './turnSystems';
import { cleanseDamageEffects } from './damageEffects';
import { applyAttackEffect, assignDamageEffects, projectEnemyEffects } from './effectRules';
import { creditDefeat, damageCell, defeatsRoomBoss, removeDefeated, type DefeatCredit } from './combatRules';
import { allowedSpawnColors, customGoalsMet, validateCustomLevel, weightedColor } from './customLevel';
import type { ChainSimulation } from './forestSystems';
import { campaignBlueprint, ITEMS, mixSeed, rewardChoices } from './campaignContent';
import { chooseGeneratedColors, hasOrdinaryChain } from './boardGeneration';
import { ENEMY_COLORS } from './enemyPalette';
import type { AbilityKind, CellKind, ChainPreview, DoorData, EnemyColor, EnemyVariant, EngineEvent, ForestCell, ForestState, FrostPreview, ItemKind, ItemPreview, RoomTheme, RotationPreview, TerrainKind } from './forestTypes';
import type { RunBattleOutcome, RunBattleSetup } from './run/runBattle';
import { forestBattle } from './run/forestBattles';
import { FOREST_BEAST_HP } from './forestBeasts';
import { TROLL_HP } from './troll';

const emptyProgress = () => ({ kills: 0, rangedKills: 0, bossKills: 0, turns: 0, armorKills: 0, prisms: 0, bossHits: 0 });
/** Complete replayable position for offline analysis (`levelAnalysis.ts`); not a save format. */
export interface AnalysisSnapshot {
  state: ForestState; rng: number; nextId: number; seed: number;
  pendingRoom: { theme: RoomTheme; depth: number } | null; entry: { state: ForestState; rng: number; nextId: number } | null;
}
interface ArrivalRequest { kind: 'ranged' | 'boss'; key?: 'archers' | 'boss'; commander?: boolean; hp?: number }
interface GeneratedBoard { state: ForestState; generatedIds: Set<number>; spawned: number[]; events: EngineEvent[]; nextId: number }
export class ForestEngine {
  state: ForestState;
  animationScale = 1;
  private listeners = new Set<(state: ForestState, event: EngineEvent) => void>();
  private generation = 0;
  private nextId = 1;
  private rng = FOREST_LEVEL.seed;
  private seed = FOREST_LEVEL.seed;
  private entrySnapshot: { state: ForestState; rng: number; nextId: number } | null = null;
  private pendingRoom: { theme: RoomTheme; depth: number } | null = null;

  constructor(seed = FOREST_LEVEL.seed) {
    this.seed = seed;
    this.state = this.initialState();
    this.state.phase = 'TITLE';
  }
  private initialState(): ForestState {
    return { phase: 'PLAYER_INPUT', levelIndex: 0, level: { ...FOREST_LEVEL, objectives: WAVE_OBJECTIVES[1] }, cols: 7, rows: 7,
      board: Array.from({ length: 49 }, () => null), terrain: [], devices: [], pits: [], player: { index: 45, hp: 5, maxHp: 5, energy: 0 }, chain: [], chosenAbility: null, wave: 1,
      waveLabel: WAVE_LABELS[1], inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, itemPrepared: false, objective: emptyProgress(), turn: 0, score: 0,
      message: FOREST_LEVEL.tutorial, bossWarning: [], lastDamage: 0, spawnCounts: { archers: 0, boss: 0 },
      room: { kind: 'forest', theme: 'forest', depth: 0, combatKills: 0, key: { held: false, droppedAt: null }, commanderSpawned: false },
      run: { active: false, seed: this.seed, path: [], completedRooms: 0 }, hazard: { cells: [], turnsUntil: 0, damage: 2 }, rewards: [], selectedExit: null, rotations: [] };
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
  startLevel(_index = 0, seed = this.seed) {
    if (_index > 0) { this.startCampaign(seed); return; }
    this.beginForestTrial(seed);
  }
  private beginForestTrial(seed: number, run?: RunBattleSetup) {
    this.generation++; this.seed = seed; this.rng = seed; this.nextId = 1; this.state = this.initialState();
    this.entrySnapshot = null; this.pendingRoom = null;
    const symbols = FOREST_LEVEL.map.join('').split('');
    this.state.terrain = symbols.map((symbol, index): TerrainKind => index === 11 ? 'puddle' : symbol === '#' ? 'tree' : symbol === '~' ? 'pond' : symbol === 'F' ? 'campfire' : 'floor');
    this.state.board = symbols.map((symbol, index) => symbol in COLOR_FROM_SYMBOL ? this.createCell('melee', COLOR_FROM_SYMBOL[symbol as keyof typeof COLOR_FROM_SYMBOL], index) : null);
    if (run) this.applyRunSetup(run);
    this.prepareInitialBoard();
    if (run) this.entrySnapshot = { state: structuredClone(this.state), rng: this.rng, nextId: this.nextId };
    this.emit({ type: 'start' });
  }
  /** Start a forest-map node battle with the run's carried resources and opened tools (src/game/run). */
  startRunBattle(setup: RunBattleSetup): boolean {
    const { template } = setup;
    if (template.kind === 'forest-trial') { this.beginForestTrial(setup.seed, setup); return true; }
    // A registry battle is not an opening lesson: its tutorial index is -1 (see loadCustomLevel).
    const authored = template.kind === 'battle'
      ? typeof template.id === 'string' ? { lesson: forestBattle(template.id), index: -1 } : null
      : Number.isInteger(template.index) ? { lesson: TUTORIAL_LESSONS[template.index], index: template.index } : null;
    const lesson = authored?.lesson;
    if (!authored || !lesson) return false;
    return this.loadCustomLevel({ ...lesson.definition, seed: setup.seed, paletteWeights: [...setup.paletteWeights ?? lesson.definition.paletteWeights] }, { lesson, index: authored.index }, setup);
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
      state.waveLabel = setup.label;
    }
  }
  /** Tool permissions of an authored lesson or a map-node battle; null means every tool is allowed. */
  private toolRules() { return this.state.tutorial ?? this.state.runNode ?? null; }
  loadLevel(index = 0) { this.startLevel(index); }
  restartLevel() {
    if ((this.state.customLevel || this.state.runNode) && this.entrySnapshot) {
      this.generation++; this.state = structuredClone(this.entrySnapshot.state); this.rng = this.entrySnapshot.rng; this.nextId = this.entrySnapshot.nextId;
      this.pendingRoom = null; this.emit({ type: 'start' }); return;
    }
    if (!this.state.run.active || !this.entrySnapshot) { this.startLevel(); return; }
    this.generation++; this.state = structuredClone(this.entrySnapshot.state); this.rng = this.entrySnapshot.rng;
    this.nextId = this.entrySnapshot.nextId; this.pendingRoom = null; this.emit({ type: 'start' });
  }
  restartRun() { if (this.state.customLevel || this.state.runNode) this.restartLevel(); else if (this.state.run.active) this.startCampaign(this.state.run.seed); else this.startLevel(); }
  startTutorial(index = 0): boolean {
    const lesson = TUTORIAL_LESSONS[index];
    if (!Number.isInteger(index) || !lesson) return false;
    return this.loadCustomLevel(lesson.definition, { lesson, index });
  }
  nextTutorial(): boolean {
    if (!this.state.tutorial || this.state.tutorial.index < 0 || this.state.runNode || this.state.phase !== 'WIN') return false;
    const choices = TUTORIAL_LESSONS[this.state.tutorial.index].nextLessonIndices;
    if (choices) return choices.length === 1 ? this.startTutorialChoice(choices[0]) : false;
    return this.startTutorial(this.state.tutorial.index + 1);
  }
  startTutorialChoice(index: number): boolean {
    if (!this.state.tutorial || this.state.tutorial.index < 0 || this.state.runNode || this.state.phase !== 'WIN' || !Number.isInteger(index)) return false;
    const lesson = TUTORIAL_LESSONS[this.state.tutorial.index];
    const choices = lesson.nextLessonIndices ?? [this.state.tutorial.index + 1];
    return choices.includes(index) && this.startTutorial(index);
  }
  startCustomLevel(value: unknown): boolean { return this.loadCustomLevel(value); }
  /**
   * Load an editor level, or an authored battle with its lesson metadata (marked targets, passivity, permissions,
   * hint). `authored.index` is the lesson's index in TUTORIAL_LESSONS, or -1 for a forest-map registry battle.
   */
  private loadCustomLevel(value: unknown, authored?: { lesson: AuthoredLesson; index: number }, run?: RunBattleSetup): boolean {
    const validation = validateCustomLevel(value);
    if (!validation.valid || !validation.definition) { this.emit({ type: 'invalid', text: validation.errors.join(' ') }); return false; }
    const definition = validation.definition;
    const lesson = authored?.lesson, tutorialIndex = authored?.index ?? -1;
    const previous = { state: this.state, seed: this.seed, rng: this.rng, nextId: this.nextId, generation: this.generation,
      entrySnapshot: this.entrySnapshot, pendingRoom: this.pendingRoom };
    try {
      this.generation++; this.seed = definition.seed; this.rng = definition.seed; this.nextId = 1;
      this.state = this.initialState(); this.pendingRoom = null; this.entrySnapshot = null;
      const state = this.state; state.cols = definition.cols; state.rows = definition.rows;
      state.devices = structuredClone(definition.devices ?? []);
      state.terrain = [...definition.terrain]; state.board = Array.from({ length: state.cols * state.rows }, () => null);
      state.player = { index: definition.heroIndex, hp: definition.playerHp ?? 5, maxHp: definition.playerHp ?? 5, energy: 0,
        ...(definition.playerAttackEffect ? { attackEffect: definition.playerAttackEffect } : {}) };
      state.inventory = { frost: 1, bomb: 1, healing: 1, fire: 1, ...definition.inventory };
      state.room = { ...state.room, kind: 'custom', commanderSpawned: true }; state.waveLabel = 'Авторский уровень';
      state.customLevel = { definition, goalCompletedTurn: null, paletteWeights: [...definition.paletteWeights] };
      if (lesson) {
        state.tutorial = { index: tutorialIndex, targetIds: [], hintDismissed: false,
          allowedItems: [...(lesson.allowedItems ?? [])], allowedAbilities: [...(lesson.allowedAbilities ?? [])] };
        state.inventory = { frost: 0, bomb: 0, healing: 0, fire: 0, ...definition.inventory };
        state.player = { index: definition.heroIndex, hp: 5, maxHp: 5, energy: lesson.initialEnergy ?? 0 };
        state.objective.tutorialTargets = 0;
        state.waveLabel = tutorialIndex >= 0 ? `Урок ${tutorialIndex + 1} / ${TUTORIAL_LESSONS.length}` : lesson.name;
      }
      if (run) this.applyRunSetup(run);
      const labels = { kills: 'Противники', rangedKills: 'Стрелки', bossKills: 'Боссы', turns: 'Выдержать ходов' };
      state.level = { name: definition.name, subtitle: 'Авторский уровень', description: 'Выполни заданные цели.',
        tutorial: definition.completion === 'exit' ? 'Выполни все цели, затем ударь выход цепочкой. Дополнительные цвета появятся после цели.' : 'Выполни все цели для победы.',
        seed: definition.seed, map: Array.from({ length: state.rows }, (_, y) => state.terrain.slice(y * state.cols, (y + 1) * state.cols).map(terrain => terrain === 'floor' || terrain === 'puddle' || terrain === 'thorns' ? 'R' : '#').join('')),
        objectives: definition.goals.map(goal => ({ ...goal, label: labels[goal.key] })), turnLimit: definition.turnLimit };
      if (lesson) {
        state.level.subtitle = state.waveLabel; state.level.description = lesson.description; state.level.tutorial = lesson.hint;
        if (lesson.targetIndices.length) state.level.objectives = [{ key: 'tutorialTargets', target: lesson.targetIndices.length, label: 'Отмеченные цели' }];
      }
      for (const enemy of definition.enemies) {
        const cell = enemy.variant ? this.createVariant(enemy.variant, enemy.index, enemy.color) : this.createCell(enemy.kind, enemy.color, enemy.index);
        cell.hp = cell.maxHp = enemy.hp; cell.behavior.aggressive = enemy.aggressive ?? false;
        if (lesson) {
          // Map rows ≥ 5 drop lesson passivity: goblins join the growing anger, beasts follow their own rules.
          cell.behavior.passive = !runPressureActive(state) && !enemy.aggressive && enemy.variant !== 'jailer' && enemy.variant !== 'beacon';
          if (lesson.targetIndices.includes(enemy.index)) state.tutorial!.targetIds.push(cell.id);
        }
        if (enemy.attackEffect) cell.attackEffect = enemy.attackEffect;
        if (enemy.footprint) cell.footprint = [...enemy.footprint];
        const indices = cell.footprint ?? [enemy.index]; cell.status.wet = indices.some(index => state.terrain[index] === 'puddle');
        for (const index of indices) state.board[index] = cell;
      }
      for (const door of definition.doors) {
        const footprint = door.footprint ?? [door.index], cell = this.createCell('door', null, door.index);
        cell.hp = cell.maxHp = 1; cell.door = { branch: 'forward', label: 'Выход', destination: 'forest', magic: true, breached: false, footprint: [...footprint] };
        for (const index of footprint) state.board[index] = cell;
      }
      // Tutorials must have an opening in their authored layout, before any generated fill.
      if (lesson && !hasOrdinaryChain(state)) throw new Error('В учебном поле нет начальной цепочки.');
      // Author-painted cells are never included in the candidate recolour set.
      const result = this.selectGeneratedBoard(true);
      if (!hasOrdinaryChain(result.state)) throw new Error('Нет начальной цепочки: измени расстановку или палитру.');
      this.state = result.state; this.nextId = result.nextId; this.state.message = this.state.level.tutorial;
      this.entrySnapshot = { state: structuredClone(this.state), rng: this.rng, nextId: this.nextId };
    } catch (error) {
      Object.assign(this, previous); this.emit({ type: 'invalid', text: error instanceof Error ? error.message : 'Уровень не удалось создать.' }); return false;
    }
    this.emit({ type: 'start' }); return true;
  }
  startCampaign(seed = this.seed) {
    this.beginCampaign(seed, 0);
  }
  private beginCampaign(seed: number, energy: number) {
    this.seed = seed; this.state = this.initialState();
    this.state.player.energy = energy;
    this.state.run = { active: true, seed, path: [], completedRooms: 0 };
    this.state.inventory = { frost: 1, bomb: 0, healing: 1, fire: 0 };
    this.enterCampaignRoom('gate', 0);
  }
  startCastle(seed = this.seed) {
    this.startScenario('banquet', seed);
  }
  startScenario(theme: RoomTheme, seed = this.seed) {
    if (theme === 'forest') { this.startLevel(0, seed); return; }
    if (theme === 'gate') { this.startCampaign(seed); return; }
    this.seed = seed; this.state = this.initialState();
    this.state.run = { active: true, seed, path: [], completedRooms: 0 };
    this.state.inventory = { frost: 1, bomb: 1, healing: 1, fire: 0 };
    this.enterCampaignRoom(theme, theme === 'wizard' ? 4 : 1);
  }
  continueCampaign() {
    if (this.state.phase !== 'WIN' || this.state.room.kind !== 'forest' || this.state.runNode) return false;
    this.beginCampaign(this.seed, this.state.player.energy); return true;
  }
  chooseReward(item: ItemKind) {
    if (this.state.phase !== 'REWARD' || !this.pendingRoom || !this.state.rewards.some(reward => reward.item === item)) return false;
    const generation = this.generation, next = this.pendingRoom; this.pendingRoom = null; this.state.inventory[item]++;
    this.emit({ type: 'reward', text: ITEMS[item].label });
    if (generation !== this.generation) return false;
    this.enterCampaignRoom(next.theme, next.depth); return true;
  }
  private enterCampaignRoom(theme: RoomTheme, depth: number) {
    this.generation++;
    const run = structuredClone(this.state.run), inventory = { ...this.state.inventory }, player = { ...this.state.player,
      ...(this.state.player.damageEffects ? { damageEffects: { ...this.state.player.damageEffects } } : {}) }, score = this.state.score;
    const roomSeed = mixSeed(run.seed, depth * 13 + run.path.reduce((sum, step) => sum * 3 + ['left', 'forward', 'right'].indexOf(step) + 1, 0));
    const blueprint = campaignBlueprint(theme, depth, roomSeed); this.rng = roomSeed; this.nextId = 1;
    this.state = this.initialState(); this.state.run = run; this.state.inventory = inventory; this.state.score = score;
    if (depth === 1) this.state.inventory.bomb = Math.max(1, this.state.inventory.bomb);
    this.state.room = { kind: theme === 'gate' ? 'gate' : theme === 'wizard' ? 'wizard' : 'castle', theme, depth,
      combatKills: 0, key: { held: false, droppedAt: null }, commanderSpawned: false };
    this.state.level = blueprint.level; this.state.levelIndex = depth + 1; this.state.cols = blueprint.cols; this.state.rows = blueprint.rows;
    this.state.waveLabel = blueprint.level.subtitle; this.state.player = { ...player, index: blueprint.heroIndex };
    this.state.spawnCounts = { archers: 2, boss: 1 };
    const symbols = blueprint.level.map.join('').split('');
    this.state.terrain = symbols.map(symbol => symbol === '#' ? 'wall' : symbol === '~' ? 'puddle' : 'floor');
    const wetIndex = theme === 'gate' ? 38 : 31;
    if (this.state.terrain[wetIndex] === 'floor') this.state.terrain[wetIndex] = 'puddle';
    this.state.board = symbols.map((symbol, index) => !isWalkable(this.state, index) || index === blueprint.heroIndex ? null
      : this.createRoomMelee(symbol in COLOR_FROM_SYMBOL ? COLOR_FROM_SYMBOL[symbol as keyof typeof COLOR_FROM_SYMBOL] : ENEMY_COLORS[index % ENEMY_COLORS.length], index));
    for (const actor of blueprint.actors) {
      const cell = this.createVariant(actor.variant, actor.index, this.state.board[actor.index]?.color ?? 0);
      if (actor.footprint) {
        if (!canPlaceFootprint(this.state, actor.footprint, { replaceOrdinary: true })) throw new Error('Invalid authored enemy footprint.');
        cell.footprint = [...actor.footprint]; cell.status.wet = actor.footprint.some(index => this.state.terrain[index] === 'puddle');
        for (const index of actor.footprint) this.state.board[index] = cell;
      } else this.state.board[actor.index] = cell;
    }
    for (const door of blueprint.doors) {
      const target = this.createCell('door', null, door.footprint[0]); target.hp = target.maxHp = door.magic ? 1 : 200;
      target.door = { ...door, footprint: [...door.footprint] };
      for (const index of door.footprint) this.state.board[index] = target;
    }
    this.prepareInitialBoard(this.state.room.kind === 'castle' ? [{ kind: 'boss', commander: true, hp: 16 }] : []);
    this.prepareHazard(); this.state.message = blueprint.level.tutorial;
    this.entrySnapshot = { state: structuredClone(this.state), rng: this.rng, nextId: this.nextId }; this.pendingRoom = null;
    this.emit({ type: 'start' });
  }
  private createVariant(variant: EnemyVariant, index: number, color: EnemyColor | null): ForestCell {
    const boss = ['commander', 'wizard', 'jailer', 'beacon', 'troll'].includes(variant), chess = ['rook', 'bishop', 'knight'].includes(variant);
    const cell = this.createCell(boss ? 'boss' : chess ? 'ranged' : 'melee', boss ? null : color, index);
    cell.variant = variant; cell.hp = cell.maxHp = variant === 'chair' ? 0 : variant === 'stool' ? 2 : variant === 'cabinet' ? 4 : variant === 'elite' || variant === 'wardrobe' ? 10 : variant === 'commander' ? 28 : variant === 'wizard' ? 18 : 7;
    if (variant in FOREST_BEAST_HP) cell.hp = cell.maxHp = FOREST_BEAST_HP[variant as keyof typeof FOREST_BEAST_HP];
    if (variant === 'wizard') cell.bossStage = 1;
    if (variant === 'jailer') cell.shield = { dx: 0, dy: 1 };
    if (variant === 'jailer' || variant === 'beacon') cell.hp = cell.maxHp = 8;
    if (variant === 'troll') cell.hp = cell.maxHp = TROLL_HP;
    cell.behavior.aggressive = ['stool', 'elite'].includes(variant); cell.behavior.cycle = 0;
    cell.carriesKey = variant === 'commander'; return cell;
  }
  private normalArrivalCells(board = this.state.board) {
    return board.flatMap((_cell, index) => canReplaceWithArrival(this.state, board, index) ? [index] : []);
  }
  private createRoomMelee(color: EnemyColor, index: number): ForestCell {
    // Map rows ≥ 5: refills are never passive and grow stronger with the turn number (mapBattleRules.ts).
    if (runPressureActive(this.state)) return applyRefillTier(this.createCell('melee', color, index), refillTier(this.state));
    if (this.state.tutorial) { const cell = this.createCell('melee', color, index); cell.behavior.passive = true; return cell; }
    return this.state.room.kind === 'castle' || this.state.room.kind === 'wizard' ? this.createVariant('chair', index, color) : this.createCell('melee', color, index);
  }
  private prepareHazard() {
    if (this.state.room.kind !== 'gate') { this.state.hazard = { cells: [], turnsUntil: 0, damage: 2 }; return; }
    const turnsUntil = 3 - this.state.turn % 3;
    const cells: number[] = [];
    if (turnsUntil === 1) {
      cells.push(this.state.player.index);
      const pool = this.state.board.flatMap((cell, index) => isWalkable(this.state, index) && cell?.kind !== 'door' && index !== this.state.player.index ? [index] : []);
      while (cells.length < 5 && pool.length) cells.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
    }
    this.state.hazard = { cells, turnsUntil, damage: 2 };
  }
  /** Deep copy of the position, RNG and ID allocator. Reads only: the live game is not advanced. */
  captureAnalysisSnapshot(): AnalysisSnapshot {
    return structuredClone({ state: this.state, rng: this.rng, nextId: this.nextId, seed: this.seed,
      pendingRoom: this.pendingRoom, entry: this.entrySnapshot });
  }
  /** Load a copied position into this engine, cancelling any pending turn. No event is emitted. */
  restoreAnalysisSnapshot(snapshot: AnalysisSnapshot) {
    const copy = structuredClone(snapshot);
    this.generation++; this.state = copy.state; this.rng = copy.rng; this.nextId = copy.nextId; this.seed = copy.seed;
    this.pendingRoom = copy.pendingRoom; this.entrySnapshot = copy.entry;
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
    // Lessons are rejected inside simulateAbility; a forest-trial map node carries its rules only in runNode.
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
      return { valid: frost.valid && this.state.board[index]?.kind !== 'door', reason: reason || frost.reason || (this.state.board[index]?.kind === 'door' ? 'Настой действует на врагов.' : ''), indices: [index], damage: 0, healing: 0, breachesDoor: false };
    }
    if (item === 'healing') {
      if (!reason && !this.state.player.damageEffects?.poison && !this.state.player.damageEffects?.bleeding && !canHeal({ subtype: 0, power: this.state.player.hp, max_power: this.state.player.maxHp, colour: 0, properties: {}, attack_power: 0, attack_mode: 0 })) reason = 'Здоровье уже полное.';
      return { valid: !reason, reason, indices: [this.state.player.index], damage: 0, healing: Math.min(3, this.state.player.maxHp - this.state.player.hp), breachesDoor: false };
    }
    const target = this.state.board[index];
    if (!reason && this.state.customLevel && target?.kind === 'door') reason = 'Авторский выход открывается выполнением всех целей.';
    if (!reason && (!target || target.kind === 'prism')) reason = 'Выбери врага или дверь.';
    if (!reason && target?.kind === 'door' && item !== 'bomb') reason = 'Магическую дверь вскрывает бомба.';
    const indices = [index, ...item === 'fire' ? this.neighbors(index).filter(other => other % this.state.cols === index % this.state.cols || Math.floor(other / this.state.cols) === Math.floor(index / this.state.cols)) : []]
      .filter(other => other !== this.state.player.index && this.state.board[other] && this.state.board[other]?.kind !== 'prism' && (this.state.board[other]?.kind !== 'door' || other === index));
    return { valid: !reason, reason, indices, damage: item === 'bomb' ? 6 : 0, healing: 0,
      breachesDoor: target?.kind === 'door' && item === 'bomb' && (!!target.door?.magic || target.hp <= 6) };
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
    const damaged = new Set<number>(); let bossKilled = false;
    for (const targetIndex of preview.indices) {
      if (item === 'healing') break;
      const cell = this.state.board[targetIndex]; if (!cell || damaged.has(cell.id)) continue; damaged.add(cell.id);
      if (cell.kind === 'door') {
        if (cell.door?.magic) cell.door.breached = true;
        else { const outcome = damageCell(cell, preview.damage, 'item'); if (outcome.killed && cell.door) cell.door.breached = true; }
        continue;
      }
      if (item === 'fire') {
        applyAttackEffect(cell, 'fire', true);
        this.emit({ type: 'status', index: targetIndex, effect: 'fire', amount: 1 });
        if (generation !== this.generation) return false;
        continue;
      }
      const outcome = damageCell(cell, preview.damage, 'item');
      if (outcome.phaseChanged) {
        this.emit({ type: 'boss-phase', index: targetIndex, text: 'ПЕЧАТЬ РАЗРУШЕНА · 24 HP' });
        if (generation !== this.generation) return false;
      }
      this.emit({ type: 'hit', index: targetIndex, amount: preview.damage });
      if (generation !== this.generation) return false;
      if (outcome.killed) {
        removeDefeated(this.state.board, cell); this.recordDefeat(cell, targetIndex, 'player');
        if (generation !== this.generation) return false;
        this.emit({ type: 'kill', index: targetIndex });
        if (generation !== this.generation) return false;
        bossKilled ||= defeatsRoomBoss(this.state, cell);
      }
    }
    this.emit({ type: 'item', index, indices: preview.indices, amount: preview.damage || preview.healing, text: ITEMS[item].label });
    if (generation !== this.generation) return false;
    if (bossKilled || this.state.customLevel?.definition.completion === 'direct' && customGoalsMet(this.state)) { this.finish(true); return true; }
    if (!this.generateAndPublish(generation, false)) return false;
    if (generation !== this.generation) return false;
    this.emit(); return true;
  }
  private recordDefeat(cell: ForestCell, index: number, credit: DefeatCredit) {
    if (cell.kind === 'door' || cell.kind === 'prism') return;
    // An enemy's ability killing its own side, or a crystal crushing it, is not the player's kill (combatRules.DefeatCredit).
    if (credit === 'player' || credit === 'environment') this.state.room.combatKills++;
    creditDefeat(this.state, cell, this.state.objective, credit);
    this.refreshCustomProgress();
    if (cell.carriesKey) { this.state.room.key.droppedAt = index; this.emit({ type: 'key-drop', index }); }
  }
  private refreshCustomProgress(state = this.state) {
    const runtime = state.customLevel; if (!runtime) return;
    if (runtime.goalCompletedTurn === null && customGoalsMet(state)) runtime.goalCompletedTurn = state.turn;
    if (runtime.goalCompletedTurn === null) return;
    runtime.paletteWeights = [...runtime.definition.paletteWeights];
    for (const extra of runtime.definition.extraColors) if (state.turn - runtime.goalCompletedTurn >= extra.afterGoalTurns) runtime.paletteWeights[extra.color] = extra.weight;
    for (const { cell } of uniqueEntities(state.board)) if (cell.kind === 'door' && cell.door) cell.door.breached = true;
  }
  private completeRoom(door: DoorData, index: number) {
    if (this.state.customLevel) { this.finish(true); return; }
    const generation = this.generation;
    this.state.room.key.held = false; this.state.selectedExit = door.branch; this.state.run.path.push(door.branch);
    this.state.run.completedRooms++; this.state.chain = []; this.state.phase = 'REWARD';
    this.pendingRoom = { theme: door.destination, depth: this.state.room.depth + 1 };
    this.state.rewards = rewardChoices(this.state.run.seed, this.state.room.depth);
    this.state.message = 'Проход открыт. Выбери один расходник перед следующим залом.';
    this.emit({ type: 'door-open', index, text: door.label });
    if (generation !== this.generation) return;
    this.emit({ type: 'room-complete', index, text: door.label });
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
    const generation = this.generation;
    return {
      state: this.state,
      current: () => generation === this.generation,
      drawRandom: () => this.random(),
      createCrystal: (index, value) => { const crystal = this.createCell('prism', null, index); crystal.crystalChain = value; return crystal; },
      recordDefeat: (cell, index, credit) => this.recordDefeat(cell, index, credit),
      completeRoom: (door, index) => this.completeRoom(door, index),
      finish: (won, message) => this.finish(won, message),
      refreshCustomProgress: () => this.refreshCustomProgress(),
      planRotationReplacements: rotations => this.planRotationReplacements(rotations),
      advanceWave: () => this.advanceWave(),
      generateBoard: summons => this.generateAndPublish(generation, true, this.pendingArrivals(), summons),
      prepareHazard: () => this.prepareHazard(),
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
    this.state.chain = []; this.state.chosenAbility = null; this.state.turn++; this.state.lastDamage = 0;
    this.state.player.energy = Math.min(7, this.state.player.energy + 0.5);
    this.state.message = 'Кот отдыхает: +0,5 энергии. Противники действуют.';
    return this.play(resolveEnemyTurn(context), context);
  }
  private advanceWave() {
    if (this.state.room.kind !== 'forest') return;
    const wave = this.state.wave;
    // A map-run boss keeps carried frost; the standalone trial starts empty, so it always had exactly 1 here.
    if (wave === 1 && this.state.objective.kills >= 8) { this.state.wave = 2; this.state.inventory.frost = this.state.runNode ? Math.max(1, this.state.inventory.frost) : 1; }
    else if (wave === 2 && this.state.objective.rangedKills >= 2) this.state.wave = 3;
    if (this.state.wave !== wave) {
      this.state.waveLabel = WAVE_LABELS[this.state.wave]; this.state.level = { ...this.state.level, objectives: WAVE_OBJECTIVES[this.state.wave] };
      this.emit({ type: 'wave', amount: this.state.wave, text: this.state.waveLabel });
    }
  }
  private pendingArrivals(): ArrivalRequest[] {
    if (this.state.customLevel) return [];
    if (this.state.room.kind !== 'forest') {
      const room = this.state.room;
      return !room.commanderSpawned && (room.kind === 'castle' || room.kind === 'gate' && room.combatKills >= 12)
        ? [{ kind: 'boss', commander: true, ...(room.kind === 'castle' ? { hp: 16 } : {}) }] : [];
    }
    const requests: ArrivalRequest[] = [];
    for (let n = this.state.spawnCounts.archers; n < (this.state.wave >= 2 ? 2 : 0); n++) requests.push({ kind: 'ranged', key: 'archers' });
    if (this.state.wave === 3 && !this.state.spawnCounts.boss) requests.push({ kind: 'boss', key: 'boss' });
    return requests.slice(0, 2);
  }
  private planRotationReplacements(rotations: RotationPreview[]): Map<number, ForestCell> {
    const replacements = new Map<number, ForestCell>();
    const board = cloneBoard(this.state.board);
    for (const plan of rotations.filter(plan => plan.active)) for (const index of [plan.from, plan.to]) if (!board[index]) {
      const cell = this.createRoomMelee(this.refillColor(index, board), index); replacements.set(index, cell); board[index] = cell;
    }
    if (!replacements.size) return replacements;
    const nextId = this.nextId;
    const projected: ForestState = { ...this.state, board: cloneBoard(board), objective: { ...this.state.objective },
      room: { ...this.state.room, key: { ...this.state.room.key } },
      ...(this.state.customLevel ? { customLevel: structuredClone(this.state.customLevel) } : {}) };
    for (const plan of rotations.filter(plan => plan.active)) {
      [projected.board[plan.from], projected.board[plan.to]] = [projected.board[plan.to], projected.board[plan.from]];
      for (const index of [plan.from, plan.to]) projected.board[index]!.status.wet = projected.terrain[index] === 'puddle';
    }
    const entities = new Set<number>();
    if (projected.hazard.turnsUntil === 1) for (const index of projected.hazard.cells) {
      const cell = projected.board[index]; if (!cell || cell.kind === 'door' || cell.kind === 'prism' || entities.has(cell.id)) continue;
      entities.add(cell.id); const outcome = damageCell(cell, projected.hazard.damage, 'hazard');
      if (outcome.killed) removeDefeated(projected.board, cell);
    }
    projectEnemyEffects(projected);
    uniqueEntities(projected.board).forEach(({ cell }) => { if (cell.status.frozen > 0) cell.status.frozen--; });
    if (projected.customLevel) { projected.objective.turns++; this.refreshCustomProgress(projected); }
    const generatedIds = new Set([...replacements.values()].map(cell => cell.id));
    // Early replacements cannot borrow a colour that activates only after this enemy phase.
    const colorLimits = new Map([...generatedIds].map(id => [id, allowedSpawnColors(this.state)]));
    const result = this.selectGeneratedBoard(true, [], [], projected, generatedIds, colorLimits);
    for (const cell of result.state.board) if (cell && generatedIds.has(cell.id)) {
      const original = [...replacements.values()].find(target => target.id === cell.id)!; original.color = cell.color;
    }
    // Future refill was only a validation projection. Only the announced pair's IDs become live now.
    this.nextId = nextId; return replacements;
  }
  private arrivalPool(state: ForestState): number[] {
    return this.normalArrivalCells(state.board);
  }
  private generationCandidate(prepare: boolean, requests: ArrivalRequest[], forced: number[] | undefined,
    summons: PlannedSummon[], baseline: ForestState, initialIds: ReadonlySet<number>): GeneratedBoard {
    const state: ForestState = { ...baseline, board: cloneBoard(baseline.board), chosenAbility: null,
      spawnCounts: { ...baseline.spawnCounts }, room: { ...baseline.room, key: { ...baseline.room.key } },
      rotations: baseline.rotations.map(plan => ({ ...plan })), bossWarning: [...baseline.bossWarning] };
    const result: GeneratedBoard = { state, generatedIds: new Set(initialIds), spawned: [], events: [], nextId: 0 };
    for (let index = 0; index < state.board.length; index++) {
      if (!isWalkable(state, index) || state.board[index] || index === state.player.index || state.devices.some(device => device.index === index)) continue;
      const cell = this.createRoomMelee(this.refillColor(index, state.board, state), index);
      state.board[index] = cell; result.spawned.push(index); result.generatedIds.add(cell.id);
    }
    for (const summon of summons) {
      if (summon.sourceId !== undefined && !state.board.some(cell => cell && cell.id === summon.sourceId && isCellAlive(cell)
        && cell.status.frozen === 0)) continue;
      const victim = state.board[summon.index];
      if (!isWalkable(state, summon.index) || summon.index === state.player.index || state.devices.some(device => device.index === summon.index)
        || !victim || victim.id !== summon.id || !this.normalArrivalCells(state.board).includes(summon.index)) continue;
      const minion = summon.reinforcement ? this.createCell('melee', victim.color, summon.index) : this.createVariant('stool', summon.index, victim.color);
      if (summon.reinforcement) { minion.behavior.aggressive = true; minion.behavior.passive = false; }
      state.board[summon.index] = minion;
      if (result.generatedIds.has(victim.id)) result.generatedIds.add(minion.id);
      result.events.push({ type: 'special-arrival', index: summon.index, oldId: victim.id, newId: minion.id, text: 'ПРИЗЫВ' });
    }
    for (let n = 0; n < requests.length; n++) {
      const request = requests[n], pool = this.arrivalPool(state); if (!pool.length) break;
      const index = forced?.[n] ?? pool[Math.floor(this.random() * pool.length)];
      if (!pool.includes(index)) break;
      const victim = state.board[index]!;
      const special = request.commander ? this.createVariant('commander', index, null) : this.createCell(request.kind, request.kind === 'boss' ? null : victim.color, index);
      if (request.hp !== undefined) special.hp = special.maxHp = request.hp;
      state.board[index] = special; if (result.generatedIds.has(victim.id)) result.generatedIds.add(special.id);
      if (request.key) state.spawnCounts[request.key]++;
      if (request.commander) state.room.commanderSpawned = true;
      result.events.push({ type: 'special-arrival', index, oldId: victim.id, newId: special.id,
        text: request.commander ? 'КОМАНДИР · КЛЮЧ' : request.kind === 'boss' ? 'ГЛАВАРЬ' : 'СТРЕЛОК' });
    }
    if (prepare) prepareIntents(state, (min, max) => min + Math.floor(this.random() * (max - min)));
    result.nextId = this.nextId; return result;
  }
  private selectGeneratedBoard(prepare: boolean, requests: ArrivalRequest[] = [], summons: PlannedSummon[] = [],
    baseline = this.state, initialIds: ReadonlySet<number> = new Set(), colorLimits: ReadonlyMap<number, readonly EnemyColor[]> = new Map()): GeneratedBoard {
    const firstId = this.nextId;
    const make = (selected: ArrivalRequest[], forced?: number[]) => {
      this.nextId = firstId;
      return this.generationCandidate(prepare, selected, forced, summons, baseline, initialIds);
    };
    let candidate = make(requests);
    for (let attempt = 0; attempt < 32; attempt++) {
      if (attempt) candidate = make(requests);
      if (hasOrdinaryChain(candidate.state)) return candidate;
    }
    if (chooseGeneratedColors(candidate.state, candidate.generatedIds, colorLimits)) return candidate;
    // At most two pending arrivals: enumerate the finite victim assignments only after random attempts fail.
    // A failed full quota can be deferred partially; rejected candidates have no live IDs, events or counters.
    for (let count = requests.length; count > 0; count--) {
      const selected = requests.slice(0, count), base = make([]), pool = this.arrivalPool(base.state);
      for (const first of pool) for (const second of count > 1 ? pool : [-1]) {
        if (first === second) continue;
        candidate = make(selected, count > 1 ? [first, second] : [first]);
        if (chooseGeneratedColors(candidate.state, candidate.generatedIds, colorLimits)) return candidate;
      }
    }
    candidate = make([]);
    chooseGeneratedColors(candidate.state, candidate.generatedIds, colorLimits);
    // No candidate-only color assignment opens this fixed position. Preserve it; Rest remains an action.
    return candidate;
  }
  private prepareInitialBoard(requests: ArrivalRequest[] = []) {
    const generatedIds = new Set(this.state.board.flatMap(cell => cell?.kind === 'melee' && (!cell.variant || cell.variant === 'chair') ? [cell.id] : []));
    const result = this.selectGeneratedBoard(true, requests, [], this.state, generatedIds);
    if (!hasOrdinaryChain(result.state)) throw new Error('Authored scene has no ordinary opening.');
    this.state.board = result.state.board; this.state.room = result.state.room; this.state.rotations = result.state.rotations;
    this.state.bossWarning = result.state.bossWarning; this.nextId = result.nextId;
  }
  private generateAndPublish(generation: number, prepare: boolean, requests: ArrivalRequest[] = [], summons: PlannedSummon[] = []): boolean {
    const result = this.selectGeneratedBoard(prepare, requests, summons), previous = new Map(this.state.board.flatMap(cell => cell ? [[cell.id, cell] as const] : []));
    this.state.board = result.state.board.map(cell => {
      if (!cell) return null;
      const living = previous.get(cell.id); if (!living) return cell;
      if (prepare) { living.intent = cell.intent; living.behavior = cell.behavior; living.countdown = cell.countdown; living.supportTargetId = cell.supportTargetId; living.shield = cell.shield; }
      return living;
    });
    this.state.spawnCounts = result.state.spawnCounts; this.state.room.commanderSpawned = result.state.room.commanderSpawned;
    if (prepare) { this.state.rotations = result.state.rotations; this.state.bossWarning = result.state.bossWarning; }
    this.nextId = result.nextId;
    if (result.spawned.length) { this.emit({ type: 'spawn', indices: result.spawned }); if (generation !== this.generation) return false; }
    for (const event of result.events) { this.emit(event); if (generation !== this.generation) return false; }
    return true;
  }
  private refillColor(index: number, board = this.state.board, state = this.state): EnemyColor {
    if (state.customLevel) return weightedColor(state.customLevel.paletteWeights, this.random());
    const neighbors = this.neighbors(index).filter(other => other % this.state.cols === index % this.state.cols || Math.floor(other / this.state.cols) === Math.floor(index / this.state.cols))
      .flatMap(other => { const cell = board[other]; return cell && isCellAlive(cell) && cell.color !== null ? [cell.color] : []; });
    // Castle HP and the physical gate need longer local groups with five colors.
    const group = this.random() < (state.room.kind === 'forest' ? 0.25 : 0.5);
    const roll = this.random();
    const colors = allowedSpawnColors(state);
    return group && neighbors.length ? neighbors[Math.floor(roll * neighbors.length)] : colors[Math.floor(roll * colors.length)];
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
    if (this.state.room.kind === 'gate') return this.state.room.key.held ? 'Ключ у кота. Ударь ворота цепочкой.' : this.state.room.key.droppedAt !== null ? 'Ключ остался на земле. Войди на отмеченную клетку после убийства.' : `Боевых убийств ${Math.min(12, this.state.room.combatKills)}/12. Ворота: ключ командира или 200 урона.`;
    if (this.state.room.kind === 'castle') return this.state.room.key.held ? 'Выбери дверь положением цепочки. Ключ откроет только выбранный проход.' : 'Хранитель несёт ключ. Магическую дверь также можно взломать бомбой.';
    if (this.state.room.kind === 'wizard') return 'Колдун чередует заклинания и призыв. Намеченные клетки не меняются после твоего хода.';
    if (this.state.wave === 1) return this.state.turn === 1 ? 'Каждый враг даёт +1 силы. Слабые цели копят запас, HP крепких врагов расходуют его.' : 'Начинай рядом с котом. Красные клетки — уже намеченные удары.';
    if (this.state.wave === 2) return 'У стрелков 7 HP: накопи силу на слабых целях. Холод замораживает любого врага.';
    return 'Главарь бесцветный. Разгони удар на слабых; живую цель нельзя пройти насквозь.';
  }
  private finish(won: boolean, message?: string) {
    this.state.phase = won ? 'WIN' : 'LOSE'; this.state.chain = []; this.state.chosenAbility = null;
    this.state.message = message ?? (this.state.runNode ? won ? 'Узел пройден.' : 'Кот отступил. Повтори узел: запас восстановится как на входе.' : this.state.tutorial ? won ? 'Урок пройден!' : 'Попробуй ещё раз: та же расстановка, 5 HP.' : won ? this.state.customLevel ? 'Цели выполнены. Авторский уровень пройден!' : this.state.room.kind === 'wizard' ? 'Колдун повержен. Замок свободен!' : 'Котелок спасён. Завтрак ещё тёплый!' : 'Кот отступил. Повтори комнату с теми же расходниками на входе.');
    if (won && this.state.room.kind === 'wizard') this.state.run.completedRooms++;
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
