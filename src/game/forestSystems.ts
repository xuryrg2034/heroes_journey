import { isCellAlive } from './cellLife';
import type { AbilityKind, AbilityPreview, ChainHit, ChainPreview, InteractionDevice, ForestCell, ForestState, RotationPlan, RotationPreview } from './forestTypes';
import { recoveredMoveTowards } from './recoveredEnemyMovement';
import { canMoveTo, randomLaunchCell, updateShieldDir, type EnemyActor } from './recovered/enemies';
import { gemValue, pathColour, shieldBlocksApproach, WILD } from './recovered/core';
import { canFireArrowHit } from './recovered/combat';
import { footprintPerimeter } from './entityFootprint';
import { planEnemyPhase } from './enemyPhase';
import { creditDefeat, damageCell, defeatsRoomBoss, physicalDamage, removeDefeated, shieldIsActive } from './combatRules';
export { physicalDamage } from './combatRules';
import { MELEE_AGGRESSION_START_TURN, meleeCanAttack } from './enemyLifecycle';
import { applyDamageEffect, stepBleeding, tickDamageEffects, type DamageEffects } from './damageEffects';
import { assignDamageEffects, applyAttackEffect, hasDamageEffects } from './effectRules';
import { customGoalsMet } from './customLevel';
import { applyDeviceVolley, deviceAt, pitAt } from './devices';

export const ABILITY_COST: Record<AbilityKind, number> = { jump: 2, spin: 3 };
export const JUMP_RANGE = 3;

export const cloneCell = (cell: ForestCell): ForestCell => ({ ...cell, status: { ...cell.status }, behavior: { ...cell.behavior },
  ...(cell.damageEffects ? { damageEffects: { ...cell.damageEffects } } : {}),
  ...(cell.shield ? { shield: { ...cell.shield } } : {}),
  ...(cell.footprint ? { footprint: [...cell.footprint] } : {}),
  ...(cell.door ? { door: { ...cell.door, footprint: [...cell.door.footprint] } } : {}),
  intent: { ...cell.intent, cells: [...cell.intent.cells], ...(cell.intent.summonCells ? { summonCells: [...cell.intent.summonCells] } : {}), ...(cell.intent.summonIds ? { summonIds: [...cell.intent.summonIds] } : {}) } });
export function cloneBoard(board: (ForestCell | null)[]): (ForestCell | null)[] {
  const entities = new Map<number, ForestCell>();
  return board.map(cell => { if (!cell) return null; if (!entities.has(cell.id)) entities.set(cell.id, cloneCell(cell)); return entities.get(cell.id)!; });
}
export function isWalkable(state: ForestState, index: number): boolean {
  return index >= 0 && index < state.cols * state.rows && !pitAt(state, index) && (state.terrain[index] === 'floor' || state.terrain[index] === 'puddle');
}
export function adjacent(state: ForestState, from: number, to: number): boolean {
  if (from === to || !isWalkable(state, from) || !isWalkable(state, to)) return false;
  const dx = to % state.cols - from % state.cols, dy = Math.floor(to / state.cols) - Math.floor(from / state.cols);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (dx && dy) {
    const horizontal = from + dx, vertical = from + dy * state.cols;
    if (!isWalkable(state, horizontal) && !isWalkable(state, vertical)) return false;
  }
  return true;
}
export function neighbors(state: ForestState, index: number): number[] {
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = index % state.cols + dx, y = Math.floor(index / state.cols) + dy;
    if (x >= 0 && x < state.cols && y >= 0 && y < state.rows) {
      const target = y * state.cols + x; if (adjacent(state, index, target)) result.push(target);
    }
  }
  return result;
}
export function chainAdjacent(state: ForestState, from: number, to: number): boolean {
  return adjacent(state, from, to);
}
export function chainNeighbors(state: ForestState, index: number): number[] { return neighbors(state, index).filter(target => chainAdjacent(state, index, target)); }
function meleeTargets(state: ForestState, index: number): number[] {
  const footprint = state.board[index]?.footprint;
  if (footprint && footprint.length > 1) return footprintPerimeter(footprint, state.cols, state.rows).filter(target => isWalkable(state, target));
  return neighbors(state, index).filter(target => target % state.cols === index % state.cols || Math.floor(target / state.cols) === Math.floor(index / state.cols));
}
/** Sliding pieces stop at the first occupied square; knights alone may jump over blockers. */
export function chessTargets(state: ForestState, index: number, variant: 'rook' | 'bishop' | 'knight'): number[] {
  const offsets = variant === 'knight' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
    : variant === 'rook' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const result: number[] = [];
  for (const [dx, dy] of offsets) for (let step = 1; step <= (variant === 'knight' ? 1 : Math.max(state.cols, state.rows)); step++) {
    const x = index % state.cols + dx * step, y = Math.floor(index / state.cols) + dy * step;
    if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) break;
    const target = y * state.cols + x;
    if (!isWalkable(state, target) || state.board[target]?.kind === 'door') break;
    result.push(target);
    if (state.board[target] || target === state.player.index) break;
  }
  return result;
}
/** A rotation exchanges two living ordinary enemies; empty cells never qualify. */
export function canSwapEnemies(state: ForestState, from: number, to: number): boolean {
  const source = state.board[from], target = state.board[to];
  const normal = (cell: ForestCell | null | undefined) => {
    if (!cell || !isCellAlive(cell)) return false; // Our rotations require occupied endpoints.
    const properties: Record<number, number> = {};
    if (cell.kind !== 'melee' && cell.kind !== 'ranged' || (cell.footprint?.length ?? 1) > 1) properties[37] = 1;
    if (cell.status.frozen > 0) properties[254] = cell.status.frozen;
    return canMoveTo(0, 0, 0, 0, false, false, { valid: () => true, playableMove: () => true,
      cell: () => ({ subtype: 2, kind: 1, power: cell.hp, col: 0, row: 0, face_dir: 1, attack_mode: 0, properties }) });
  };
  const chess = source?.variant === 'rook' || source?.variant === 'bishop' || source?.variant === 'knight' ? source.variant : null;
  return !!normal(source) && !!normal(target) && (chess ? chessTargets(state, from, chess).includes(to) : adjacent(state, from, to)
    && (from % state.cols === to % state.cols || Math.floor(from / state.cols) === Math.floor(to / state.cols)))
    && from !== state.player.index && to !== state.player.index;
}
/** Announced cells survive occupant death. Empty endpoints will receive fresh ordinary enemies. */
export function rotationPreview(state: ForestState, board = state.board, playerIndex = state.player.index): RotationPreview[] {
  const used = new Set<number>();
  return [...state.rotations].sort((a, b) => a.from - b.from || a.to - b.to).map(plan => {
    let reason = '';
    const source = board[plan.from], target = board[plan.to];
    if (plan.from === playerIndex || plan.to === playerIndex) reason = 'Кот занимает клетку обмена.';
    else if (deviceAt(state, plan.from) || deviceAt(state, plan.to)) reason = 'Устройство занимает клетку обмена.';
    else if (source?.status.frozen || target?.status.frozen) reason = 'Замороженный участник блокирует обмен.';
    else if ([source, target].some(cell => cell && (cell.kind !== 'melee' && cell.kind !== 'ranged' || (cell.footprint?.length ?? 1) > 1))) reason = 'Эта цель не участвует в обмене.';
    else if (!rotationGeometryClear(state, plan, board, playerIndex)) reason = 'Путь обмена закрыт.';
    else if (used.has(plan.from) || used.has(plan.to)) reason = 'Клетка уже участвует в другом обмене.';
    if (!reason) { used.add(plan.from); used.add(plan.to); }
    return { ...plan, active: !reason, ...(reason ? { reason } : {}) };
  });
}
function rotationGeometryClear(state: ForestState, plan: RotationPlan, board: (ForestCell | null)[], playerIndex: number): boolean {
  const { from, to, geometry } = plan;
  if (from === to || !isWalkable(state, from) || !isWalkable(state, to)) return false;
  const dx = to % state.cols - from % state.cols, dy = Math.floor(to / state.cols) - Math.floor(from / state.cols);
  if (geometry === 'cardinal') return Math.abs(dx) + Math.abs(dy) === 1;
  if (geometry === 'knight') return Math.abs(dx) * Math.abs(dy) === 2;
  if (geometry === 'rook' ? dx !== 0 && dy !== 0 : Math.abs(dx) !== Math.abs(dy)) return false;
  for (let step = 1; step < Math.max(Math.abs(dx), Math.abs(dy)); step++) {
    const index = from + Math.sign(dx) * step + Math.sign(dy) * step * state.cols;
    if (!isWalkable(state, index) || board[index] || index === playerIndex) return false;
  }
  return true;
}
export type ChainStep = { kind: 'hit'; hit: ChainHit } | { kind: 'device'; index: number; activated: boolean };
export interface ChainSimulation { steps?: ChainStep[]; queuedDevices?: InteractionDevice[]; preview: ChainPreview; board: (ForestCell | null)[]; bossKilled: boolean }
/** Shared pure combat evaluator: preview and the committed turn consume this exact result. */
export function simulateChain(state: ForestState, path: number[], allowIncomplete = false): ChainSimulation {
  // Validate the submitted path independently from a lethal movement prefix.
  let plannedPathValid = false;
  if (state.player.damageEffects?.bleeding) {
    const planned = simulateChain({ ...state, player: { ...state.player, damageEffects: undefined } }, path, allowIncomplete);
    if (!planned.preview.valid) return planned;
    plannedPathValid = !allowIncomplete;
  }
  const movingPlayer = { ...state.player, ...(state.player.damageEffects ? { damageEffects: { ...state.player.damageEffects } } : {}) };
  const board = cloneBoard(state.board);
  const preview: ChainPreview = { valid: true, length: path.length, enemies: 0, power: 0, endIndex: state.player.index,
    damage: 0, threats: [], createsPrism: false, reason: '', hits: [], kills: 0, endsOnSurvivor: false, rotations: rotationPreview(state), energyCost: 0, energyGain: 0 };
  let bossKilled = false, color: number | null = null, previous = state.player.index;
  let chainPower = 0;
  let temporaryEffect: 'fire' | undefined;
  const steps: ChainStep[] = [], queuedDevices: InteractionDevice[] = [];
  const seenDevices = new Set<number>();
  preview.deviceActivations = []; preview.trapHits = []; preview.trapDamage = 0; preview.trapKills = 0;
  const customProgress = { ...state.objective };
  const key = { ...state.room.key };
  const seen = new Set<number>();
  const reject = (reason: string) => { preview.valid = false; preview.reason = reason; };
  if (!path.length) reject('Начни цепочку рядом с котом.');
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
      if (!step && cell.kind === 'prism') { reject('Начни с противника, а не с огонька.'); break; }
      if (shieldIsActive(cell) && cell.shield) {
        const properties: Record<number, number> = {};
        if (cell.shield.dx) properties[249] = cell.shield.dx; if (cell.shield.dy) properties[250] = cell.shield.dy;
        if (shieldBlocksApproach(previous % state.cols, Math.floor(previous / state.cols), index % state.cols, Math.floor(index / state.cols), properties)) { reject('Щит закрывает этот подход. Обойди сбоку или сзади либо заморозь стража.'); break; }
      }
      if (cell.color !== null && color !== null && cell.color !== color) { reject('Соединяй один цвет; бесцветная цель связывает любые цвета.'); break; }
      if (state.customLevel && cell.kind === 'door' && !customGoalsMet(state, customProgress)) { reject('Выход закрыт: сначала выполни все цели.'); break; }
      if (cell.kind === 'prism') {
        board[index] = null; color = null; preview.endIndex = index;
        preview.hits.push({ index, damage: 0, hpBefore: cell.hp, hpAfter: 0, killed: true, physical: false, availablePower: chainPower, powerSpent: 0, remainingPower: chainPower });
      } else {
        if (cell.kind !== 'door') { preview.enemies++; chainPower++; }
        const availablePower = chainPower;
        const opensByKey = cell.kind === 'door' && (state.customLevel ? customGoalsMet(state, customProgress) : key.held || !!cell.door?.breached);
        const damage = cell.kind === 'door' && (opensByKey || cell.door?.magic) ? 0 : physicalDamage(board, cell, chainPower);
        const outcome = damageCell(cell, damage, 'physical');
        const { hpBefore, phaseChanged } = outcome;
        const killed = opensByKey || outcome.killed;
        // Modifiers affect damage; expenditure never exceeds available power or HP actually removed.
        const powerSpent = Math.min(chainPower, outcome.hpRemoved);
        chainPower -= powerSpent;
        if (!killed && cell.kind !== 'door') applyAttackEffect(cell, temporaryEffect ?? state.player.attackEffect, true);
        const doorOpened = cell.kind === 'door' && killed;
        preview.hits.push({ index, damage, hpBefore, hpAfter: killed ? 0 : cell.hp, killed, physical: true, availablePower, powerSpent, remainingPower: chainPower,
          ...(!killed && (temporaryEffect ?? state.player.attackEffect) ? { attackEffect: temporaryEffect ?? state.player.attackEffect } : {}), ...(doorOpened ? { doorOpened: true } : {}), ...(phaseChanged ? { phaseChanged: true } : {}) });
        preview.power = chainPower;
        if (killed) {
          removeDefeated(board, cell);
          preview.endIndex = index;
          if (cell.kind !== 'door') preview.kills++;
          if (state.customLevel && cell.kind !== 'door') {
            creditDefeat(state, cell, customProgress);
          }
          if (cell.carriesKey) key.droppedAt = index;
          if (defeatsRoomBoss(state, cell)) bossKilled = true;
          if (doorOpened) { key.held = false; preview.opensDoor = index; preview.completesRoom = true; }
        }
        else if (step < path.length - 1) { reject('Этот противник выживет. Закончи на нём или накопи больше силы.'); break; }
        preview.endsOnSurvivor = !killed;
        // Every selected combat cell supplies a colour; our colourless entities deliberately map to WILD.
        const resolved = pathColour([[index % state.cols, Math.floor(index / state.cols)]], () => ({ subtype: 0, power: 1, max_power: 1, colour: cell.color ?? WILD, properties: {}, attack_power: 0, attack_mode: 0 }));
        color = resolved === WILD ? null : resolved;
      }
      steps.push({ kind: 'hit', hit: preview.hits[preview.hits.length - 1] });
      seen.add(cell.id);
    }
    if (preview.endIndex === index && key.droppedAt === index) {
      key.droppedAt = null; key.held = true; preview.keyCollected = true; if (preview.hits[preview.hits.length - 1]?.index === index) preview.hits[preview.hits.length - 1].keyCollected = true;
    }
    if (preview.endIndex === index && movingPlayer.damageEffects?.bleeding) {
      const step = stepBleeding(movingPlayer.damageEffects);
      assignDamageEffects(movingPlayer, step.effects);
      const damage = Math.min(movingPlayer.hp, step.damage);
      movingPlayer.hp -= damage;
      preview.movementDamage = (preview.movementDamage ?? 0) + damage;
      preview.damage += damage;
      if (movingPlayer.hp === 0) {
        preview.playerDies = true; preview.completesRoom = false; bossKilled = false;
        delete preview.opensDoor;
        break;
      }
    }
    previous = index;
    if (!state.devices.length && preview.enemies >= 2 && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress)) preview.completesRoom = true;
    if (bossKilled || preview.completesRoom) break;
  }
  if (preview.valid && !allowIncomplete && preview.enemies < 2 && preview.opensDoor === undefined && !plannedPathValid) reject('Нужны хотя бы два противника в цепочке.');
  if (!preview.valid) { preview.endIndex = state.player.index; return { preview, board, bossKilled: false }; }
  preview.energyGain = Math.min(7 - state.player.energy, preview.hits.filter(hit => { const cell = state.board[hit.index]; return cell && cell.kind !== 'door' && cell.kind !== 'prism'; }).length * 0.5);
  const forecastState: ForestState = { ...state, turn: state.turn + 1, pits: state.pits.map(pit => ({ ...pit })), board: queuedDevices.length ? cloneBoard(board) : board, player: { ...movingPlayer, index: preview.endIndex }, lastDamage: 0 };
  preview.pitCells = []; preview.pitImmuneCells = [];
  if (!preview.playerDies) for (const device of queuedDevices) {
    for (const impact of applyDeviceVolley(forecastState, device)) {
      if (impact.pitOpened && !preview.pitCells.includes(impact.index)) preview.pitCells.push(impact.index);
      if (impact.pitImmune && !preview.pitImmuneCells.includes(impact.index)) preview.pitImmuneCells.push(impact.index);
      if (impact.heroDamage !== undefined) { preview.trapDamage += impact.heroDamage; preview.damage += impact.heroDamage; }
      if (impact.hit) {
        preview.trapHits.push(impact.hit);
        if (impact.hit.killed && impact.cell?.kind !== 'prism') {
          preview.trapKills++; creditDefeat(state, impact.cell!, customProgress);
          bossKilled ||= defeatsRoomBoss(state, impact.cell!);
        }
      }
    }
    if (forecastState.player.hp <= 0) { preview.playerDies = true; break; }
  }
  if (!preview.playerDies && (bossKilled || preview.enemies >= 2 && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress))) preview.completesRoom = true;
  if (preview.playerDies) { preview.completesRoom = false; delete preview.opensDoor; bossKilled = false; }
  preview.rotations = preview.completesRoom ? [] : rotationPreview(forecastState, forecastState.board, preview.endIndex);
  if (!state.tutorial && (state.run.active || state.customLevel) && !preview.playerDies && !preview.completesRoom && gemValue(preview.kills, [8], [0, 1]) > 0 && board.filter(cell => cell?.kind === 'prism').length < 2) {
    const starts = new Set(neighbors(state, preview.endIndex));
    const rotationCells = new Set(preview.rotations.filter(plan => plan.active).flatMap(plan => [plan.from, plan.to]));
    const candidates = preview.hits.filter(hit => hit.physical && hit.killed && isWalkable(forecastState, hit.index) && hit.index !== preview.endIndex && hit.index !== state.room.key.droppedAt && !starts.has(hit.index) && !rotationCells.has(hit.index));
    candidates.sort((a, b) => {
      const distance = (index: number) => Math.max(Math.abs(index % state.cols - preview.endIndex % state.cols), Math.abs(Math.floor(index / state.cols) - Math.floor(preview.endIndex / state.cols)));
      return distance(b.index) - distance(a.index) || a.index - b.index;
    });
    if (candidates.length) { preview.createsPrism = true; preview.prismIndex = candidates[0].index; }
  }
  forecastEnemyPhase(state, forecastState.board, preview, movingPlayer.damageEffects);
  return { preview, board, bossKilled, steps, queuedDevices };
}
function forecastEnemyPhase(state: ForestState, board: (ForestCell | null)[], preview: ChainPreview, movementEffects = state.player.damageEffects) {
  if (preview.playerDies) { preview.rotations = []; preview.volleyDamage = 0; return; }
  const attacks = planEnemyPhase(board, preview.endIndex).attacks;
  const effectAware = hasDamageEffects(state.player) || !!state.player.attackEffect
    || board.some(cell => cell && (hasDamageEffects(cell) || cell.attackEffect));
  // Keep the existing raw threat total for boards without the new effects.
  if (!effectAware) {
    if (!preview.completesRoom) for (const attack of attacks) {
      if (attack.hitsHero) { preview.threats.push(attack.index); preview.damage += attack.cell.intent.damage; }
    }
    if (preview.damage >= state.player.hp) preview.rotations = preview.rotations.map(plan => ({ ...plan, active: false, reason: 'Кот погибнет до обмена.' }));
    preview.volleyDamage = !preview.completesRoom && state.hazard.turnsUntil === 1 && state.hazard.cells.includes(preview.endIndex) ? state.hazard.damage : 0;
    preview.damage += preview.volleyDamage;
    preview.playerDies = preview.damage >= state.player.hp;
    return;
  }
  preview.movementDamage ??= 0;
  let hp = state.player.hp - preview.movementDamage - (preview.trapDamage ?? 0);
  let effects: DamageEffects | undefined = movementEffects ? { ...movementEffects } : undefined;
  preview.effectDamage = 0; preview.volleyDamage = 0;
  if (hp > 0 && !preview.completesRoom) for (const attack of attacks) {
    if (!attack.hitsHero) continue;
    preview.threats.push(attack.index);
    const damage = Math.min(hp, attack.cell.intent.damage);
    hp -= damage; preview.damage += damage;
    if (hp <= 0) break;
    if (attack.cell.attackEffect) effects = applyDamageEffect(effects, attack.cell.attackEffect);
  }
  if (hp <= 0) preview.rotations = preview.rotations.map(plan => ({ ...plan, active: false, reason: 'Кот погибнет до обмена.' }));
  if (hp > 0 && !preview.completesRoom && state.hazard.turnsUntil === 1 && state.hazard.cells.includes(preview.endIndex)) {
    const damage = Math.min(hp, state.hazard.damage);
    hp -= damage; preview.volleyDamage = damage; preview.damage += damage;
  }
  if (hp > 0 && !preview.completesRoom) {
    const tick = tickDamageEffects(effects);
    effects = tick.effects;
    for (const hit of tick.hits) {
      const damage = Math.min(hp, hit.damage);
      hp -= damage; preview.effectDamage += damage; preview.damage += damage;
      if (hp <= 0) break;
    }
  }
  preview.endEffects = effects;
  preview.playerDies = hp <= 0;
}

export function simulateAbility(state: ForestState, ability: AbilityKind, targetIndex?: number): ChainSimulation & { preview: AbilityPreview } {
  const board = cloneBoard(state.board), cost = ABILITY_COST[ability] ?? 0;
  const indices = ability === 'spin' ? neighbors(state, state.player.index).filter(index => board[index] && board[index]!.kind !== 'door' && board[index]!.kind !== 'prism') : targetIndex === undefined ? [] : [targetIndex];
  const preview: AbilityPreview = { ability, cost, indices, targetIndex, valid: true, length: indices.length, enemies: 0, power: 4, endIndex: state.player.index,
    damage: 0, threats: [], createsPrism: false, reason: '', hits: [], kills: 0, endsOnSurvivor: false, rotations: [], energyCost: cost, energyGain: 0 };
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
    else if (cell && (cell.hp > physicalDamage(state.board, cell, 4) || cell.variant === 'wizard' && cell.bossStage === 1)) reject('Цель должна погибнуть от удара при приземлении.');
    else preview.endIndex = index;
  } else if (!indices.length) reject('Рядом нет противников.');
  let bossKilled = false;
  const customProgress = { ...state.objective };
  if (!preview.valid) return { preview, board, bossKilled };
  const seen = new Set<number>();
  for (const index of indices) {
    const cell = board[index]; if (!cell || seen.has(cell.id)) continue; seen.add(cell.id);
    const damage = physicalDamage(state.board, cell, 4);
    const { hpBefore, phaseChanged, killed } = damageCell(cell, damage, 'physical');
    if (!killed) applyAttackEffect(cell, state.player.attackEffect, true);
    preview.enemies++; preview.hits.push({ index, damage, hpBefore, hpAfter: cell.hp, killed, physical: true, ...(phaseChanged ? { phaseChanged: true } : {}) });
    if (killed) {
      preview.kills++; removeDefeated(board, cell);
      if (defeatsRoomBoss(state, cell)) bossKilled = true;
      if (state.customLevel) creditDefeat(state, cell, customProgress);
    }
  }
  if (ability === 'jump' && (state.room.key.droppedAt === preview.endIndex || state.board[preview.endIndex]?.carriesKey)) {
    preview.keyCollected = true; if (preview.hits[0]) preview.hits[0].keyCollected = true;
  }
  preview.completesRoom = bossKilled || state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress);
  preview.rotations = preview.completesRoom ? [] : rotationPreview(state, board, preview.endIndex);
  forecastEnemyPhase(state, board, preview);
  return { preview, board, bossKilled };
}

/** Intent preparation runs only between turns. Targets never chase a submitted chain. */
export function prepareIntents(state: ForestState, rand: (min: number, max: number) => number = min => min) {
  state.bossWarning = [];
  state.rotations = [];
  const melee: { index: number; distance: number; id: number }[] = [];
  const paired = new Set<number>();
  const prepared = new Set<number>();
  state.board.forEach((cell, index) => {
    if (!cell || cell.kind !== 'door' && !isCellAlive(cell) || prepared.has(cell.id)) return; prepared.add(cell.id);
    cell.intent = { cells: [], damage: 1, label: 'Готовится' }; cell.countdown = 2;
    if (cell.behavior.passive) { cell.behavior.aggressive = false; cell.intent.label = 'Без оружия'; return; }
    if (cell.variant === 'sentinel') {
      const actor: EnemyActor = { subtype: 4, kind: 1, power: cell.hp, col: index % state.cols, row: Math.floor(index / state.cols), face_dir: 1, attack_mode: 0, properties: {} };
      updateShieldDir(actor, state.player.index % state.cols, Math.floor(state.player.index / state.cols), {
        remove: (enemy, prop) => { delete enemy.properties[prop]; }, set: (enemy, prop, value) => { enemy.properties[prop] = value; }, spriteIndex: () => 0,
      });
      cell.shield = { dx: actor.properties[249] ?? 0, dy: actor.properties[250] ?? 0 };
    }
    if (cell.variant === 'cabinet') {
      cell.supportTargetId = neighbors(state, index).map(target => state.board[target]).find(target => target && isCellAlive(target) && target.id !== cell.id && target.kind !== 'door' && target.kind !== 'prism' && target.variant !== 'cabinet')?.id;
    }
    if (cell.kind === 'door') { cell.intent.label = state.customLevel ? customGoalsMet(state) ? 'Выход открыт' : 'Выполни цели' : cell.door?.breached ? 'Проход открыт' : cell.door?.magic ? 'Нужен ключ или бомба' : 'Ключ или 200 урона'; return; }
    if (cell.kind === 'melee') {
      cell.intent.label = 'Спокоен';
      if (meleeCanAttack(cell)) {
        cell.countdown = 1;
        cell.intent = { cells: meleeTargets(state, index), damage: 1, label: 'Замах' };
        return;
      }
      if (cell.behavior.restTurns > 0 || cell.status.frozen > 0) return;
      const distance = Math.max(Math.abs(index % state.cols - state.player.index % state.cols), Math.abs(Math.floor(index / state.cols) - Math.floor(state.player.index / state.cols)));
      melee.push({ index, distance, id: cell.id });
    } else if (cell.kind === 'ranged') {
      if (cell.behavior.restTurns > 0) {
        cell.intent.label = 'Отдых';
        if (paired.has(index)) return;
        const chess = cell.variant === 'rook' || cell.variant === 'bishop' || cell.variant === 'knight' ? cell.variant : null;
        let target: number | undefined;
        if (chess) target = chessTargets(state, index, chess).filter(target => canSwapEnemies(state, index, target) && !paired.has(target)).sort((a, b) => a - b)[0];
        else {
          // Keep our cardinal, occupied-pair rules; port only the verified three-pass selection.
          const step = recoveredMoveTowards({ col: index % state.cols, row: Math.floor(index / state.cols),
            destCol: state.player.index % state.cols, destRow: Math.floor(state.player.index / state.cols), minDist: 0 }, {
            rand,
            canMoveTo: (x, y) => x >= 0 && x < state.cols && y >= 0 && y < state.rows
              && !paired.has(y * state.cols + x) && canSwapEnemies(state, index, y * state.cols + x),
          });
          const destination = step.row * state.cols + step.col;
          if (destination !== index) target = destination;
        }
        if (target !== undefined) {
          cell.intent.moveTo = target; cell.intent.swapWithId = state.board[target]!.id;
          cell.intent.label = 'Отдых · ротация'; paired.add(index); paired.add(target);
          state.rotations.push({ from: index, to: target, sourceId: cell.id, targetId: state.board[target]!.id, geometry: chess ?? 'cardinal' });
        }
        return;
      }
      if (cell.variant === 'rook' || cell.variant === 'bishop' || cell.variant === 'knight') {
        cell.intent.cells = chessTargets(state, index, cell.variant); cell.countdown = 1;
        cell.intent.label = cell.variant === 'rook' ? 'Прямой удар' : cell.variant === 'bishop' ? 'Диагональный удар' : 'Удар конём'; return;
      }
      const dx = state.player.index % state.cols - index % state.cols, dy = Math.floor(state.player.index / state.cols) - Math.floor(index / state.cols);
      const horizontal = Math.abs(dx) > Math.abs(dy), stepX = horizontal ? Math.sign(dx) || 1 : 0, stepY = horizontal ? 0 : Math.sign(dy) || 1;
      for (let n = 1; n <= 3; n++) {
        const x = index % state.cols + stepX * n, y = Math.floor(index / state.cols) + stepY * n;
        if (!canFireArrowHit(x, y, state.cols, state.rows)) break;
        const target = y * state.cols + x;
        // Arrows travel above temporary holes; only solid authored terrain stops the ray.
        if (!['floor', 'puddle'].includes(state.terrain[target])) break;
        cell.intent.cells.push(target);
      }
      cell.countdown = 1; cell.intent.label = 'Выстрел';
    } else if (cell.kind === 'boss') {
      if (cell.variant === 'beacon') {
        cell.intent = { cells: [], damage: 0, label: 'Призыв через 2 хода' };
        if (cell.status.frozen > 0) { cell.intent.label = 'Заморожен'; return; }
        if ((cell.behavior.cycle ?? 0) % 2 === 1) {
          const targets = state.board.flatMap((target, targetIndex) => target && isCellAlive(target)
            && target.kind === 'melee' && !target.behavior.aggressive && target.maxHp === 0
            && !target.shield && !target.carriesKey && (target.footprint?.length ?? 1) === 1
            && targetIndex !== state.player.index && isWalkable(state, targetIndex)
            && !deviceAt(state, targetIndex) ? [{ index: targetIndex, id: target.id }] : []).slice(0, 2);
          cell.intent = { cells: [], damage: 0, label: 'Призыв подкреплений',
            summonCells: targets.map(target => target.index), summonIds: targets.map(target => target.id) };
          cell.countdown = 1;
        }
        return;
      }
      if (cell.variant === 'jailer') {
        cell.shield ??= { dx: 0, dy: 1 };
        if (cell.status.frozen > 0 || cell.behavior.restTurns > 0) {
          cell.intent = { cells: [], damage: 0, label: cell.status.frozen > 0 ? 'Заморожен · щит опущен' : 'Отдых · щит опущен' };
          return;
        }
      }
      if (cell.variant === 'wizard') {
        const cycle = cell.behavior.cycle ?? 0;
        if (cycle % 3 === 2) {
          const summonCells: number[] = [];
          const eligible = (x: number, y: number) => {
            if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return false;
            const targetIndex = y * state.cols + x, target = state.board[targetIndex];
            return targetIndex !== state.player.index && isWalkable(state, targetIndex) && !summonCells.includes(targetIndex)
              && !!target && isCellAlive(target) && target.kind === 'melee' && (!target.variant || target.variant === 'chair')
              && !target.shield && !target.carriesKey && (target.footprint?.length ?? 1) === 1;
          };
          for (let summon = 0; summon < 2; summon++) {
            // Native cyclic board scan; our eligibility requires an occupied ordinary chair.
            const [x, y] = randomLaunchCell(index % state.cols, Math.floor(index / state.cols), -1, -1, state.cols, state.rows,
              { rand, valid: eligible, marshAt: () => false, cell: () => null });
            if (eligible(x, y)) summonCells.push(y * state.cols + x);
          }
          cell.intent = { cells: [], damage: 0, label: 'Призыв мебели', summonCells };
        } else {
          const x = state.player.index % state.cols, y = Math.floor(state.player.index / state.cols);
          cell.intent.cells = state.board.flatMap((_target, targetIndex) => isWalkable(state, targetIndex) && (cycle % 3 === 0 ? targetIndex % state.cols === x : Math.floor(targetIndex / state.cols) === y) ? [targetIndex] : []);
          cell.intent.label = cycle % 3 === 0 ? 'Вертикальный разряд' : 'Горизонтальный разряд';
          cell.intent.damage = cell.bossStage === 2 ? 2 : 1;
        }
        cell.countdown = 1; state.bossWarning = [...cell.intent.cells]; return;
      }
      const dx = state.player.index % state.cols - index % state.cols, dy = Math.floor(state.player.index / state.cols) - Math.floor(index / state.cols);
      const horizontal = Math.abs(dx) >= Math.abs(dy), sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
      cell.intent.cells = neighbors(state, index).filter(target => horizontal ? target % state.cols - index % state.cols === sign : Math.floor(target / state.cols) - Math.floor(index / state.cols) === sign);
      cell.countdown = 1; cell.intent.damage = cell.variant === 'jailer' ? 2 : 1; cell.intent.label = cell.variant === 'jailer' ? 'Тяжёлый удар' : cell.variant === 'commander' ? 'Удар командира' : 'Взмах котелком'; state.bossWarning = [...cell.intent.cells];
    }
  });
  // Pressure accumulates: old windups persist, only one calm enemy joins each turn.
  if (state.turn >= MELEE_AGGRESSION_START_TURN) for (const candidate of melee.sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, 1)) {
    const cell = state.board[candidate.index]!; cell.countdown = 1;
    cell.behavior.aggressive = true;
    cell.intent = { cells: meleeTargets(state, candidate.index), damage: 1, label: 'Замах' };
  }
}
