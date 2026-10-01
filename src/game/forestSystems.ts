import { isCellAlive } from './cellLife';
import { cloneEntity } from './ecs/components';
import { cloneEntities } from './ecs/world';
import type { AbilityKind, AbilityPreview, ChainHit, ChainPreview, HeroDamageSource, InteractionDevice, ForestCell, ForestState } from './forestTypes';
import { pathColour, WILD } from './recovered/core';
import { forecastConsequences, hurt } from './forecast';
import { angerIntent, announceRites, behaviorOf, type IntentPass } from './enemyBehaviors';
import { chainAdjacent, isWalkable, neighbors } from './boardGeometry';
import { THORN_DAMAGE } from './terrain';
import { chainSpikeDamage } from './forestBeasts';
import { creditDefeat, applyDamage, defeatOutright, physicalDamage, removeDefeated, shieldBlocksEntry } from './combatRules';
export { physicalDamage, shieldBlocksEntry } from './combatRules';
import { MELEE_AGGRESSION_START_TURN } from './enemyLifecycle';
import { stepBleeding, type DamageEffects } from './damageEffects';
import { assignDamageEffects, applyAttackEffect } from './effectRules';
import { customGoalsMet } from './customLevel';
import { applyDeviceVolley, deviceAt } from './devices';
import { angerPerTurn, CRYSTAL_KILLS, crystalCellAllowed, crystalScore, nextRandom } from './mapBattleRules';

export const ABILITY_COST: Record<AbilityKind, number> = { jump: 2, spin: 3 };
export const emptyDamageBySource = (): Record<HeroDamageSource, number> => ({ quills: 0, bleeding: 0, thorns: 0, trap: 0, charge: 0, melee: 0, ranged: 0, boss: 0, troll: 0, burning: 0, poison: 0 });
export const JUMP_RANGE = 3;

/** Entity copy by the component registry (ecs/components.ts). */
export const cloneCell = (cell: ForestCell): ForestCell => cloneEntity(cell);
/** Board copy by the registry; a multi-cell entity stays one shared record across its cells. */
export const cloneBoard = (board: (ForestCell | null)[]): (ForestCell | null)[] => cloneEntities(board);
export { adjacent, canSwapEnemies, chainAdjacent, chainNeighbors, isWalkable, neighbors } from './boardGeometry';
import { rotationPreview } from './rotations';
export { rotationPreview };
/**
 * `crystal`: a colour-change crystal falls on `index` after the preceding step (one battle-RNG draw), crushing the
 * enemy `victimId` there; `value` is the chain's final kill count. Internal: never part of the public forecast.
 */
export type ChainStep = { kind: 'hit'; hit: ChainHit } | { kind: 'device'; index: number; activated: boolean }
  | { kind: 'crystal'; index: number; victimId?: number; value: number };
export interface ChainSimulation {
  steps?: ChainStep[]; queuedDevices?: InteractionDevice[]; preview: ChainPreview; board: (ForestCell | null)[];
  /** The cat's damage effects after the planned steps (bleeding advances per step). */
  movementEffects?: DamageEffects;
}
/** Stand-in for a fallen crystal on the forecast board (the engine gives the real one its ID at execution). */
function crystalStandIn(state: ForestState, index: number, id: number): ForestCell {
  return { id, kind: 'prism', color: null, hp: 1, maxHp: 1, armor: 0, countdown: 2, crystalChain: 0,
    status: { wet: state.terrain[index] === 'puddle', frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 },
    intent: { cells: [], damage: 1, label: 'Готовится' } };
}
/**
 * Chain with its forecast: the plan (`planChain`), then its consequences — the levers' aftermath, the enemy phase and
 * the end of the turn — from the live systems on a copy (forecast.ts). Pure: the live state, RNG and IDs are untouched.
 */
export function simulateChain(state: ForestState, path: number[], allowIncomplete = false, rng?: number): ChainSimulation {
  const simulation = planChain(state, path, allowIncomplete, rng);
  if (simulation.preview.valid) forecastConsequences(state, simulation.preview, { simulation }, rng, simulation.movementEffects);
  return simulation;
}
/**
 * The action plan of a chain, shared by the preview and the committed turn (execution replays it): validity, hits,
 * the cat's steps with quills and bleeding, crystals, levers and thorns at the end. No enemy answer. `rng` is a copy
 * of the live battle RNG state: with it the crystals falling during the chain are drawn exactly as execution will draw
 * them; without it (validity checks, witness search) no crystal falls.
 */
export function planChain(state: ForestState, path: number[], allowIncomplete = false, rng?: number): ChainSimulation {
  // Validate the submitted path independently from a lethal movement prefix.
  let plannedPathValid = false;
  // Porcupine quills can kill the cat mid-chain as bleeding can; validate the path as if the cat survived.
  const quills = path.reduce((sum, index) => sum + chainSpikeDamage(state.board[index]), 0);
  if (state.player.damageEffects?.bleeding || quills >= state.player.hp) {
    // Validity only: the plan, never the forecast.
    const planned = planChain({ ...state, player: { ...state.player, hp: Number.MAX_SAFE_INTEGER, damageEffects: undefined } }, path, allowIncomplete);
    if (!planned.preview.valid) return planned;
    plannedPathValid = !allowIncomplete;
  }
  const movingPlayer = { ...state.player, ...(state.player.damageEffects ? { damageEffects: { ...state.player.damageEffects } } : {}) };
  const board = cloneBoard(state.board);
  const preview: ChainPreview = { valid: true, length: path.length, enemies: 0, power: 0, endIndex: state.player.index,
    damage: 0, damageBySource: emptyDamageBySource(), threats: [], createsPrism: false, reason: '', hits: [], kills: 0, endsOnSurvivor: false, rotations: rotationPreview(state), energyCost: 0, energyGain: 0 };
  let color: number | null = null, previous = state.player.index;
  let chainPower = 0;
  let temporaryEffect: 'fire' | undefined;
  const steps: ChainStep[] = [], queuedDevices: InteractionDevice[] = [];
  const seenDevices = new Set<number>();
  preview.deviceActivations = []; preview.trapHits = []; preview.trapDamage = 0; preview.trapKills = 0;
  const customProgress = { ...state.objective };
  const seen = new Set<number>();
  const reject = (reason: string) => { preview.valid = false; preview.reason = reason; };
  if (!path.length) reject('Начни цепочку рядом с котом.');
  // Crystals fall during the chain (mapBattleRules.ts): one per CRYSTAL_KILLS chain-hit kills, on a cell drawn from the
  // RNG copy among the allowed ones that the rest of this path does not use. Without a cell it waits for a later step.
  let pendingCrystals = 0, rngState = rng;
  const crystalSteps: Extract<ChainStep, { kind: 'crystal' }>[] = [], standIns: ForestCell[] = [];
  const dropCrystals = () => {
    while (pendingCrystals > 0 && rngState !== undefined) {
      const view = { ...state, player: { ...state.player, index: preview.endIndex } };
      // Never on a path cell still occupied: the targets ahead of the cat and the last, wounded one. Freed cells behind are allowed.
      const pool = board.flatMap((_cell, index) => !(board[index] && path.includes(index)) && crystalCellAllowed(view, board, index) ? [index] : []);
      if (!pool.length) return;
      const draw = nextRandom(rngState); rngState = draw.state;
      const index = pool[Math.floor(draw.value * pool.length)], victim = board[index];
      if (victim) { defeatOutright(victim); removeDefeated(board, victim); }
      const standIn = crystalStandIn(state, index, -1 - standIns.length); standIns.push(standIn); board[index] = standIn;
      const step = { kind: 'crystal' as const, index, value: 0, ...(victim ? { victimId: victim.id } : {}) };
      crystalSteps.push(step); steps.push(step); pendingCrystals--;
    }
  };
  for (let step = 0; preview.valid && step < path.length; step++) {
    const index = path[step], cell = board[index];
    const device = deviceAt(state, index);
    if (device) {
      if (!preview.enemies || seenDevices.has(index) || !chainAdjacent(state, previous, index)) { reject('Устройство доступно после врага и только один раз за цепь.'); break; }
      seenDevices.add(index); preview.endIndex = index; preview.endsOnSurvivor = false;
      steps.push({ kind: 'device', index, activated: device.charges > 0 });
      if (device.charges > 0) {
        preview.deviceActivations.push({ index, kind: device.kind, chargesBefore: device.charges, chargesAfter: device.charges - 1 });
        if (device.kind === 'fire') temporaryEffect = 'fire';
        else queuedDevices.push({ ...device, targets: [...device.targets] });
      }
    } else {
      if (!cell || cell.kind !== 'door' && !isCellAlive(cell) || !chainAdjacent(state, previous, index) || seen.has(cell.id)) { reject('Выбирай соседние цели, включая диагонали. Одну сущность нельзя ударить дважды.'); break; }
      if (shieldBlocksEntry(state, cell, previous, index)) { reject('Щит закрывает этот подход. Обойди сбоку или сзади либо заморозь стража.'); break; }
      if (cell.color !== null && color !== null && cell.color !== color) { reject('Соединяй один цвет; бесцветная цель связывает любые цвета.'); break; }
      if (state.customLevel && cell.kind === 'door' && !customGoalsMet(state, customProgress)) { reject('Выход закрыт: сначала выполни все цели.'); break; }
      if (cell.kind === 'prism') {
        board[index] = null; color = null; preview.endIndex = index;
        // A map-battle crystal scores by the chain that created it; like any prism it gives no power or energy.
        const score = crystalScore(cell);
        if (score) preview.crystalScore = (preview.crystalScore ?? 0) + score;
        preview.hits.push({ index, damage: 0, hpBefore: cell.hp, hpAfter: 0, killed: true, physical: false, availablePower: chainPower, powerSpent: 0, remainingPower: chainPower, ...(score ? { crystalScore: score } : {}) });
      } else {
        if (cell.kind !== 'door') { preview.enemies++; chainPower++; }
        const availablePower = chainPower;
        // Read before the hit: a porcupine killed by this very hit still fires its quills.
        const spikeDamage = chainSpikeDamage(cell);
        // An authored exit opens once every goal is met; the chain never damages it.
        const opensDoor = cell.kind === 'door' && customGoalsMet(state, customProgress);
        const damage = cell.kind === 'door' ? 0 : physicalDamage(cell, chainPower);
        const outcome = applyDamage(cell, damage, 'physical');
        const { hpBefore } = outcome;
        const killed = opensDoor || outcome.killed;
        // Modifiers affect damage; expenditure never exceeds available power or HP actually removed.
        const powerSpent = Math.min(chainPower, outcome.hpRemoved);
        chainPower -= powerSpent;
        if (!killed && cell.kind !== 'door') applyAttackEffect(cell, temporaryEffect ?? state.player.attackEffect, true);
        const doorOpened = cell.kind === 'door' && killed;
        preview.hits.push({ index, damage, hpBefore, hpAfter: killed ? 0 : cell.hp, killed, physical: true, availablePower, powerSpent, remainingPower: chainPower, ...(spikeDamage ? { spikeDamage } : {}),
          ...(!killed && (temporaryEffect ?? state.player.attackEffect) ? { attackEffect: temporaryEffect ?? state.player.attackEffect } : {}), ...(doorOpened ? { doorOpened: true } : {}) });
        preview.power = chainPower;
        if (killed) {
          removeDefeated(board, cell);
          preview.endIndex = index;
          if (cell.kind !== 'door') { preview.kills++; if (preview.kills % CRYSTAL_KILLS === 0) pendingCrystals++; }
          if (cell.kind !== 'door') creditDefeat(state, cell, customProgress);
          if (doorOpened) { preview.opensDoor = index; preview.completesRoom = true; }
        }
        else if (step < path.length - 1) { reject('Этот противник выживет. Закончи на нём или накопи больше силы.'); break; }
        preview.endsOnSurvivor = !killed;
        if (spikeDamage) {
          // Quills wound the cat at the moment of the hit; a lethal hit ends the chain before any victory.
          const taken = Math.min(movingPlayer.hp, spikeDamage);
          movingPlayer.hp -= taken; preview.spikeDamage = (preview.spikeDamage ?? 0) + taken; hurt(preview, 'quills', taken);
          if (movingPlayer.hp === 0) {
            preview.playerDies = true; preview.completesRoom = false; delete preview.opensDoor;
            steps.push({ kind: 'hit', hit: preview.hits[preview.hits.length - 1] }); seen.add(cell.id);
            break;
          }
        }
        // Every selected combat cell supplies a colour; our colourless entities deliberately map to WILD.
        const resolved = pathColour([[index % state.cols, Math.floor(index / state.cols)]], () => ({ subtype: 0, power: 1, max_power: 1, colour: cell.color ?? WILD, properties: {}, attack_power: 0, attack_mode: 0 }));
        color = resolved === WILD ? null : resolved;
      }
      steps.push({ kind: 'hit', hit: preview.hits[preview.hits.length - 1] });
      seen.add(cell.id);
    }
    if (preview.endIndex === index && movingPlayer.damageEffects?.bleeding) {
      const step = stepBleeding(movingPlayer.damageEffects);
      assignDamageEffects(movingPlayer, step.effects);
      const damage = Math.min(movingPlayer.hp, step.damage);
      movingPlayer.hp -= damage;
      preview.movementDamage = (preview.movementDamage ?? 0) + damage;
      hurt(preview, 'bleeding', damage);
      if (movingPlayer.hp === 0) {
        preview.playerDies = true; preview.completesRoom = false;
        delete preview.opensDoor;
        break;
      }
    }
    previous = index;
    if (!state.devices.length && preview.enemies >= 2 && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress)) preview.completesRoom = true;
    if (preview.completesRoom) break;
    // After this step the crystal falls (never on the path still ahead); a victory step ends the battle first.
    if (pendingCrystals) dropCrystals();
  }
  // A crystal that found no cell during the chain tries once more at its end; still none — it is not created.
  if (preview.valid && !preview.playerDies && !preview.completesRoom) dropCrystals();
  pendingCrystals = 0;
  // Its value is the chain's final length (kills), fixed once the chain is over.
  for (const crystal of crystalSteps) crystal.value = preview.kills;
  for (const standIn of standIns) standIn.crystalChain = preview.kills;
  if (preview.valid && !allowIncomplete && preview.enemies < 2 && preview.opensDoor === undefined && !plannedPathValid) reject('Нужны хотя бы два противника в цепочке.');
  if (!preview.valid) { preview.endIndex = state.player.index; return { preview, board }; }
  preview.energyGain = Math.min(7 - state.player.energy, preview.hits.filter(hit => { const cell = state.board[hit.index]; return cell && cell.kind !== 'door' && cell.kind !== 'prism'; }).length * 0.5);
  // An ordinary chain that stops on thorns hurts the cat before any lever resolves.
  if (!preview.playerDies && state.terrain[preview.endIndex] === 'thorns') {
    const damage = Math.min(movingPlayer.hp, THORN_DAMAGE);
    movingPlayer.hp -= damage; preview.thornDamage = damage; hurt(preview, 'thorns', damage);
    if (movingPlayer.hp === 0) preview.playerDies = true;
  }
  const forecastState: ForestState = { ...state, turn: state.turn + 1, pits: state.pits.map(pit => ({ ...pit })), board: queuedDevices.length ? cloneBoard(board) : board, player: { ...movingPlayer, index: preview.endIndex }, lastDamage: 0 };
  preview.pitCells = []; preview.pitImmuneCells = [];
  if (!preview.playerDies) for (const device of queuedDevices) {
    for (const impact of applyDeviceVolley(forecastState, device)) {
      if (impact.pitOpened && !preview.pitCells.includes(impact.index)) preview.pitCells.push(impact.index);
      if (impact.pitImmune && !preview.pitImmuneCells.includes(impact.index)) preview.pitImmuneCells.push(impact.index);
      if (impact.heroDamage !== undefined) { preview.trapDamage += impact.heroDamage; hurt(preview, 'trap', impact.heroDamage); }
      if (impact.hit) {
        preview.trapHits.push(impact.hit);
        if (impact.hit.killed && impact.cell?.kind !== 'prism') {
          preview.trapKills++; creditDefeat(state, impact.cell!, customProgress);
        }
      }
    }
    if (forecastState.player.hp <= 0) { preview.playerDies = true; break; }
  }
  if (!preview.playerDies && preview.enemies >= 2 && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress)) preview.completesRoom = true;
  if (preview.playerDies) { preview.completesRoom = false; delete preview.opensDoor; }
  // Only the number of fallen crystals is public; their cells and the crushed enemies stay in the internal steps.
  if (crystalSteps.length) { preview.crystals = crystalSteps.length; preview.createsPrism = true; }
  return { preview, board, steps, queuedDevices, movementEffects: movingPlayer.damageEffects };
}
/**
 * Forecast of Rest (`ForestEngine.waitTurn`): no player action, +0,5 energy, then the same enemy phase on a copy —
 * boar charges, attacks, archer arrows, the club, swaps and effect ticks. No RNG, no events.
 */
export function simulateRest(state: ForestState): ChainPreview {
  const preview: ChainPreview = { valid: state.phase === 'PLAYER_INPUT', length: 0, enemies: 0, power: 0, endIndex: state.player.index, damage: 0,
    damageBySource: emptyDamageBySource(), threats: [], createsPrism: false, reason: state.phase === 'PLAYER_INPUT' ? '' : 'Дождись своего хода.',
    hits: [], kills: 0, endsOnSurvivor: false, rotations: rotationPreview(state), energyCost: 0, energyGain: Math.min(0.5, 7 - state.player.energy) };
  if (!preview.valid) return preview;
  forecastConsequences(state, preview, { rest: true }, undefined, state.player.damageEffects);
  return preview;
}

/** Ability with its forecast: the plan (`planAbility`), then the enemy answer from the live systems on a copy. */
export function simulateAbility(state: ForestState, ability: AbilityKind, targetIndex?: number): ChainSimulation & { preview: AbilityPreview } {
  const simulation = planAbility(state, ability, targetIndex);
  if (simulation.preview.valid) forecastConsequences(state, simulation.preview, { simulation, ability }, undefined, state.player.damageEffects);
  return simulation;
}
/** The action plan of an ability (jump or spin): validity and hits, replayed by execution. No enemy answer. */
export function planAbility(state: ForestState, ability: AbilityKind, targetIndex?: number): ChainSimulation & { preview: AbilityPreview } {
  const board = cloneBoard(state.board), cost = ABILITY_COST[ability] ?? 0;
  const indices = ability === 'spin' ? neighbors(state, state.player.index).filter(index => board[index] && board[index]!.kind !== 'door' && board[index]!.kind !== 'prism') : targetIndex === undefined ? [] : [targetIndex];
  const preview: AbilityPreview = { ability, cost, indices, targetIndex, valid: true, length: indices.length, enemies: 0, power: 4, endIndex: state.player.index,
    damage: 0, damageBySource: emptyDamageBySource(), threats: [], createsPrism: false, reason: '', hits: [], kills: 0, endsOnSurvivor: false, rotations: [], energyCost: cost, energyGain: 0 };
  const reject = (reason: string) => { preview.valid = false; preview.reason = reason; };
  if (state.tutorial && !state.tutorial.allowedAbilities.includes(ability)) reject('Эта способность ещё не открыта.');
  else if (!Object.hasOwn(ABILITY_COST, ability)) reject('Эта способность недоступна.');
  else if (state.phase !== 'PLAYER_INPUT') reject('Дождись своего хода.');
  else if (state.player.energy < cost) reject('Недостаточно энергии.');
  else if (ability === 'jump') {
    const index = targetIndex ?? -1, dx = index % state.cols - state.player.index % state.cols, dy = Math.floor(index / state.cols) - Math.floor(state.player.index / state.cols);
    const cell = board[index];
    if (!isWalkable(state, index) || index === state.player.index || dx * dx + dy * dy > JUMP_RANGE * JUMP_RANGE) reject(`Прыжок: свободная для приземления клетка в радиусе ${JUMP_RANGE}.`);
    else if (cell?.kind === 'door' || cell?.kind === 'prism') reject('На дверь или огонёк нельзя приземлиться.');
    else if (cell && cell.hp > physicalDamage(cell, 4)) reject('Цель должна погибнуть от удара при приземлении.');
    else preview.endIndex = index;
  } else if (!indices.length) reject('Рядом нет противников.');
  const customProgress = { ...state.objective };
  if (!preview.valid) return { preview, board };
  const seen = new Set<number>();
  for (const index of indices) {
    const cell = board[index]; if (!cell || seen.has(cell.id)) continue; seen.add(cell.id);
    const damage = physicalDamage(cell, 4);
    const { hpBefore, killed } = applyDamage(cell, damage, 'physical');
    if (!killed) applyAttackEffect(cell, state.player.attackEffect, true);
    preview.enemies++; preview.hits.push({ index, damage, hpBefore, hpAfter: cell.hp, killed, physical: true });
    if (killed) {
      preview.kills++; removeDefeated(board, cell);
      creditDefeat(state, cell, customProgress);
    }
  }
  preview.completesRoom = state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress);
  return { preview, board };
}

/**
 * Intent preparation runs only between turns. Targets never chase a submitted chain. One board-order pass; each
 * enemy's behaviour (enemyBehaviors.ts) prepares its intent and fills the shared queues, then the anger queue and
 * the shaman rites are resolved.
 */
export function prepareIntents(state: ForestState, rand: (min: number, max: number) => number = min => min) {
  state.bossWarning = [];
  state.rotations = [];
  const pass: IntentPass = { state, rand, anger: [], rites: [], paired: new Set() };
  const prepared = new Set<number>();
  state.board.forEach((cell, index) => {
    if (!cell || cell.kind !== 'door' && !isCellAlive(cell) || prepared.has(cell.id)) return; prepared.add(cell.id);
    cell.intent = { cells: [], damage: 1, label: 'Готовится' }; cell.countdown = 2;
    const behavior = behaviorOf(cell);
    if (behavior?.beforePassive?.(pass, cell, index)) return;
    if (cell.behavior.passive) { cell.behavior.aggressive = false; cell.intent.label = 'Без оружия'; return; }
    if (cell.kind === 'door') { cell.intent.label = customGoalsMet(state) ? 'Выход открыт' : 'Выполни цели'; return; }
    behavior?.intent?.(pass, cell, index);
  });
  // Pressure accumulates: old windups persist, one calm enemy joins each turn — more as turns pass in map battles
  // on rows ≥ 5 (angerPerTurn, mapBattleRules.ts).
  if (state.turn >= MELEE_AGGRESSION_START_TURN) for (const candidate of pass.anger.sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, angerPerTurn(state))) {
    angerIntent(state, state.board[candidate.index]!, candidate.index);
  }
  announceRites(pass);
}
