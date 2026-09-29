import { isCellAlive } from './cellLife';
import type { AbilityKind, AbilityPreview, ChainHit, ChainPreview, ChargeDamageCause, EnemyPhaseForecast, HeroDamageSource, InteractionDevice, ForestCell, ForestState, RotationPlan, RotationPreview } from './forestTypes';
import { recoveredMoveTowards } from './recoveredEnemyMovement';
import { canMoveTo, randomLaunchCell, updateShieldDir, type EnemyActor } from './recovered/enemies';
import { gemValue, pathColour, WILD } from './recovered/core';
import { canFireArrowHit } from './recovered/combat';
import { footprintPerimeter } from './entityFootprint';
import { archerStrikesCreatures, archerVolley, evaluateEnemyAttack, planEnemyPhase } from './enemyPhase';
import { BOAR_CHARGE_LENGTH, BOAR_DAMAGE, chargeDirection, chargeLane, HERO_MOVE_ID, resolveCharges } from './boarCharge';
import { THORN_DAMAGE, walkableTerrain } from './terrain';
import { chainSpikeDamage, SHAMAN_PERIOD, shamanRites, shamanTargets, wolfHasPack, WOLF_DAMAGE } from './forestBeasts';
import { creditDefeat, damageCell, defeatsRoomBoss, physicalDamage, removeDefeated, shieldBlocksEntry } from './combatRules';
export { physicalDamage, shieldBlocksEntry } from './combatRules';
import { MELEE_AGGRESSION_START_TURN, meleeCanAttack } from './enemyLifecycle';
import { applyDamageEffect, stepBleeding, tickDamageEffects, type DamageEffects } from './damageEffects';
import { assignDamageEffects, applyAttackEffect, hasDamageEffects } from './effectRules';
import { customGoalsMet } from './customLevel';
import { applyDeviceVolley, deviceAt, pitAt } from './devices';

export const ABILITY_COST: Record<AbilityKind, number> = { jump: 2, spin: 3 };
export const emptyDamageBySource = (): Record<HeroDamageSource, number> => ({ quills: 0, bleeding: 0, thorns: 0, trap: 0, charge: 0, melee: 0, ranged: 0, boss: 0, volley: 0, burning: 0, poison: 0 });
/** The only way the forecast adds cat damage: the total and its source stay in step. */
function hurt(preview: ChainPreview, source: HeroDamageSource, amount: number) {
  preview.damage += amount; preview.damageBySource[source] += amount;
}
const tickSource = (kind: 'fire' | 'poison' | 'bleeding'): HeroDamageSource => kind === 'fire' ? 'burning' : kind;
export const JUMP_RANGE = 3;

export const cloneCell = (cell: ForestCell): ForestCell => ({ ...cell, status: { ...cell.status }, behavior: { ...cell.behavior },
  ...(cell.damageEffects ? { damageEffects: { ...cell.damageEffects } } : {}),
  ...(cell.shield ? { shield: { ...cell.shield } } : {}),
  ...(cell.footprint ? { footprint: [...cell.footprint] } : {}),
  ...(cell.door ? { door: { ...cell.door, footprint: [...cell.door.footprint] } } : {}),
  intent: { ...cell.intent, cells: [...cell.intent.cells], ...(cell.intent.summonCells ? { summonCells: [...cell.intent.summonCells] } : {}), ...(cell.intent.summonIds ? { summonIds: [...cell.intent.summonIds] } : {}),
    ...(cell.intent.charge ? { charge: { ...cell.intent.charge } } : {}),
    ...(cell.intent.empowerIds ? { empowerIds: [...cell.intent.empowerIds] } : {}), ...(cell.intent.empowerCells ? { empowerCells: [...cell.intent.empowerCells] } : {}) } });
export function cloneBoard(board: (ForestCell | null)[]): (ForestCell | null)[] {
  const entities = new Map<number, ForestCell>();
  return board.map(cell => { if (!cell) return null; if (!entities.has(cell.id)) entities.set(cell.id, cloneCell(cell)); return entities.get(cell.id)!; });
}
export function isWalkable(state: ForestState, index: number): boolean {
  return index >= 0 && index < state.cols * state.rows && !pitAt(state, index) && walkableTerrain(state.terrain[index]);
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
/**
 * One replacement rule for announced summons and special arrivals: a living,
 * unshielded, keyless single-cell ordinary enemy (no variant or a chair) on
 * open floor, never under the cat or a device. The beacon further limits this
 * to calm weak enemies; execution rechecks the same predicate.
 */
export function canReplaceWithArrival(state: Pick<ForestState, 'cols' | 'rows' | 'terrain' | 'pits' | 'devices' | 'player'>, board: readonly (ForestCell | null)[], index: number): boolean {
  const cell = board[index];
  return !!cell && cell.kind === 'melee' && (!cell.variant || cell.variant === 'chair') && isCellAlive(cell)
    && !cell.shield && !cell.carriesKey && (cell.footprint?.length ?? 1) === 1
    && index !== state.player.index && isWalkable(state as ForestState, index) && !deviceAt(state as ForestState, index);
}
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
/** Announced cells survive occupant death. Empty endpoints will receive fresh ordinary enemies. A boar push cancels pairs it disturbed. */
export function rotationPreview(state: ForestState, board = state.board, playerIndex = state.player.index, displaced: ReadonlySet<number> = new Set()): RotationPreview[] {
  const used = new Set<number>();
  return [...state.rotations].sort((a, b) => a.from - b.from || a.to - b.to).map(plan => {
    let reason = '';
    const source = board[plan.from], target = board[plan.to];
    if (plan.from === playerIndex || plan.to === playerIndex) reason = 'Кот занимает клетку обмена.';
    else if ([plan.sourceId, plan.targetId, source?.id, target?.id].some(id => id !== undefined && displaced.has(id))) reason = 'Кабан сбил участника обмена.';
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
  // Porcupine quills can kill the cat mid-chain as bleeding can; validate the path as if the cat survived.
  const quills = path.reduce((sum, index) => sum + chainSpikeDamage(state.board[index]), 0);
  if (state.player.damageEffects?.bleeding || quills >= state.player.hp) {
    const planned = simulateChain({ ...state, player: { ...state.player, hp: Number.MAX_SAFE_INTEGER, damageEffects: undefined } }, path, allowIncomplete);
    if (!planned.preview.valid) return planned;
    plannedPathValid = !allowIncomplete;
  }
  const movingPlayer = { ...state.player, ...(state.player.damageEffects ? { damageEffects: { ...state.player.damageEffects } } : {}) };
  const board = cloneBoard(state.board);
  const preview: ChainPreview = { valid: true, length: path.length, enemies: 0, power: 0, endIndex: state.player.index,
    damage: 0, damageBySource: emptyDamageBySource(), threats: [], createsPrism: false, reason: '', hits: [], kills: 0, endsOnSurvivor: false, rotations: rotationPreview(state), energyCost: 0, energyGain: 0 };
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
      if (shieldBlocksEntry(state, cell, previous, index)) { reject('Щит закрывает этот подход. Обойди сбоку или сзади либо заморозь стража.'); break; }
      if (cell.color !== null && color !== null && cell.color !== color) { reject('Соединяй один цвет; бесцветная цель связывает любые цвета.'); break; }
      if (state.customLevel && cell.kind === 'door' && !customGoalsMet(state, customProgress)) { reject('Выход закрыт: сначала выполни все цели.'); break; }
      if (cell.kind === 'prism') {
        board[index] = null; color = null; preview.endIndex = index;
        preview.hits.push({ index, damage: 0, hpBefore: cell.hp, hpAfter: 0, killed: true, physical: false, availablePower: chainPower, powerSpent: 0, remainingPower: chainPower });
      } else {
        if (cell.kind !== 'door') { preview.enemies++; chainPower++; }
        const availablePower = chainPower;
        // Read before the hit: a porcupine killed by this very hit still fires its quills.
        const spikeDamage = chainSpikeDamage(cell);
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
        preview.hits.push({ index, damage, hpBefore, hpAfter: killed ? 0 : cell.hp, killed, physical: true, availablePower, powerSpent, remainingPower: chainPower, ...(spikeDamage ? { spikeDamage } : {}),
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
        if (spikeDamage) {
          // Quills wound the cat at the moment of the hit; a lethal hit ends the chain before any victory.
          const taken = Math.min(movingPlayer.hp, spikeDamage);
          movingPlayer.hp -= taken; preview.spikeDamage = (preview.spikeDamage ?? 0) + taken; hurt(preview, 'quills', taken);
          if (movingPlayer.hp === 0) {
            preview.playerDies = true; preview.completesRoom = false; bossKilled = false; delete preview.opensDoor;
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
    if (preview.endIndex === index && key.droppedAt === index) {
      key.droppedAt = null; key.held = true; preview.keyCollected = true; if (preview.hits[preview.hits.length - 1]?.index === index) preview.hits[preview.hits.length - 1].keyCollected = true;
    }
    if (preview.endIndex === index && movingPlayer.damageEffects?.bleeding) {
      const step = stepBleeding(movingPlayer.damageEffects);
      assignDamageEffects(movingPlayer, step.effects);
      const damage = Math.min(movingPlayer.hp, step.damage);
      movingPlayer.hp -= damage;
      preview.movementDamage = (preview.movementDamage ?? 0) + damage;
      hurt(preview, 'bleeding', damage);
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
          bossKilled ||= defeatsRoomBoss(state, impact.cell!);
        }
      }
    }
    if (forecastState.player.hp <= 0) { preview.playerDies = true; break; }
  }
  if (!preview.playerDies && (bossKilled || preview.enemies >= 2 && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress))) preview.completesRoom = true;
  if (preview.playerDies) { preview.completesRoom = false; delete preview.opensDoor; bossKilled = false; }
  const diesInAction = !!preview.playerDies;
  const enemyForecast = forecastEnemyPhase(state, forecastState, preview, movingPlayer.damageEffects);
  if (!state.tutorial && (state.run.active || state.customLevel) && !diesInAction && !preview.completesRoom && gemValue(preview.kills, [8], [0, 1]) > 0 && board.filter(cell => cell?.kind === 'prism').length < 2) {
    // The prism waits for refill: it needs a cell still empty after boar pushes, away from the cat's final cell.
    const heroIndex = preview.enemyPhase?.heroIndex ?? preview.endIndex;
    const starts = new Set(neighbors(state, heroIndex));
    const candidates = preview.hits.filter(hit => hit.physical && hit.killed && isWalkable(forecastState, hit.index) && hit.index !== heroIndex && hit.index !== state.room.key.droppedAt
      && !starts.has(hit.index) && !enemyForecast.activeRotationCells.has(hit.index) && !enemyForecast.occupiedAfterCharges?.has(hit.index));
    candidates.sort((a, b) => {
      const distance = (index: number) => Math.max(Math.abs(index % state.cols - heroIndex % state.cols), Math.abs(Math.floor(index / state.cols) - Math.floor(heroIndex / state.cols)));
      return distance(b.index) - distance(a.index) || a.index - b.index;
    });
    if (candidates.length) { preview.createsPrism = true; preview.prismIndex = candidates[0].index; }
  }
  return { preview, board, bossKilled, steps, queuedDevices };
}
interface EnemyForecastResult { occupiedAfterCharges: ReadonlySet<number> | null; activeRotationCells: ReadonlySet<number> }
/**
 * The enemy phase after an action, run on a copy with the live rules: boar charges (boarCharge.ts),
 * attacks in board order with archer arrows striking creatures (enemyPhase.ts), swaps, volley, effect ticks.
 * `after` is the position once the action and its levers resolved. No RNG, no events.
 */
function forecastEnemyPhase(state: ForestState, after: ForestState, preview: ChainPreview, movementEffects = state.player.damageEffects): EnemyForecastResult {
  const result: EnemyForecastResult = { occupiedAfterCharges: null, activeRotationCells: new Set() };
  if (preview.playerDies) { preview.rotations = []; preview.volleyDamage = 0; return result; }
  const effectAware = hasDamageEffects(state.player) || !!state.player.attackEffect
    || after.board.some(cell => cell && (hasDamageEffects(cell) || cell.attackEffect));
  let hp = state.player.hp - preview.damage;
  let effects: DamageEffects | undefined = movementEffects ? { ...movementEffects } : undefined;
  if (effectAware) { preview.movementDamage ??= 0; preview.effectDamage = 0; }
  preview.volleyDamage = 0;
  if (preview.completesRoom) {
    preview.rotations = [];
    if (effectAware) preview.endEffects = effects;
    preview.playerDies = effectAware ? hp <= 0 : preview.damage >= state.player.hp;
    return result;
  }
  const sim: ForestState = { ...after, board: cloneBoard(after.board), pits: after.pits.map(pit => ({ ...pit })),
    player: { ...after.player, hp, damageEffects: effects ? { ...effects } : undefined }, lastDamage: 0 };
  // Keep the raw threat total for boards without effects; the charge part is always the applied damage.
  const phase: EnemyPhaseForecast = { heroIndex: sim.player.index, charges: [], moves: [], deaths: [], knockedDown: [], packBroken: [], empowered: [] };
  const displaced = new Set<number>(), firstFrom = new Map<number, number>(), lastTo = new Map<number, number>();
  let chargeDamage = 0, chargeFrom = -1, bossDown = false;
  const chargeBreakdown: Record<ChargeDamageCause, number> = { ram: 0, spikes: 0, thorns: 0, pit: 0 };
  for (const impact of resolveCharges(sim, displaced)) {
    if (impact.kind === 'ram' || impact.kind === 'crush') {
      if (impact.heroDamage !== undefined) { chargeDamage += impact.heroDamage; chargeBreakdown[impact.kind === 'ram' ? 'ram' : impact.cause] += impact.heroDamage; }
      if (impact.cell && impact.killed) {
        phase.deaths.push({ id: impact.cell.id, index: impact.index, cause: impact.kind === 'ram' ? 'ram' : impact.cause });
        bossDown ||= defeatsRoomBoss(state, impact.cell);
      }
    }
    if (impact.kind === 'start') chargeFrom = impact.index;
    if (impact.kind === 'ram' && impact.heroDamage !== undefined) preview.threats.push(chargeFrom);
    if (impact.kind === 'shift') for (const move of [...impact.moves, { id: impact.boarId, from: impact.from, to: impact.to }]) {
      if (!firstFrom.has(move.id)) firstFrom.set(move.id, move.from);
      lastTo.set(move.id, move.to);
    }
    if (impact.kind === 'end') phase.charges.push({ boarId: impact.boarId, from: impact.from, to: impact.index, stunned: impact.moved === 0 });
  }
  phase.heroIndex = sim.player.index;
  phase.moves = [...lastTo].map(([id, to]) => ({ id, from: firstFrom.get(id)!, to }));
  phase.knockedDown = [...displaced].filter(id => id !== HERO_MOVE_ID && !phase.charges.some(charge => charge.boarId === id) && sim.board.some(cell => cell?.id === id));
  preview.enemyPhase = phase;
  if (chargeDamage) { preview.chargeDamage = chargeDamage; preview.chargeBreakdown = chargeBreakdown; hurt(preview, 'charge', chargeDamage); }
  hp = sim.player.hp;
  effects = sim.player.damageEffects ? { ...sim.player.damageEffects } : undefined;
  result.occupiedAfterCharges = new Set(sim.board.flatMap((cell, index) => cell ? [index] : []));
  const deactivate = () => { preview.rotations = preview.rotations.map(plan => ({ ...plan, active: false, reason: 'Кот погибнет до обмена.' })); };
  if (hp <= 0) {
    preview.rotations = rotationPreview(sim, sim.board, sim.player.index, displaced); deactivate();
    if (effectAware) preview.endEffects = effects;
    preview.playerDies = true;
    return result;
  }
  // A room boss killed by a forced death wins the battle once the current step (charges, then attacks) ends.
  const winsNow = () => {
    preview.rotations = [];
    if (effectAware) preview.endEffects = effects;
    preview.playerDies = effectAware ? hp <= 0 : preview.damage >= state.player.hp;
    return result;
  };
  if (bossDown) return winsNow();
  const plan = planEnemyPhase(sim.board, sim.player.index, displaced, sim);
  // Same order as execution: every actor once, re-evaluated when its turn comes (an earlier arrow may have
  // killed this attacker or its packmate).
  for (const attack of plan.actors) {
    const { cell, index } = attack;
    // Only strikes that would have hit the cat: the announcement alone (no world) hits, the live pack check fails.
    if (cell.variant === 'wolf' && evaluateEnemyAttack(cell, index, sim.player.index)?.hitsHero && !wolfHasPack(sim, index)) phase.packBroken.push(cell.id);
    const live = evaluateEnemyAttack(cell, index, sim.player.index, sim);
    if (!live) continue;
    if (live.hitsHero) {
      preview.threats.push(attack.index);
      const damage = effectAware ? Math.min(hp, attack.cell.intent.damage) : attack.cell.intent.damage;
      hp -= damage; hurt(preview, attack.cell.kind === 'ranged' ? 'ranged' : attack.cell.kind === 'boss' ? 'boss' : 'melee', damage);
      if (effectAware && hp <= 0) break;
      if (effectAware && attack.cell.attackEffect) effects = applyDamageEffect(effects, attack.cell.attackEffect);
    }
    if (hp > 0 && archerStrikesCreatures(attack.cell)) for (const impact of archerVolley(sim.board, attack.cell)) {
      if (!impact.killed) continue;
      phase.deaths.push({ id: impact.cell.id, index: impact.index, cause: 'arrow' });
      bossDown ||= defeatsRoomBoss(state, impact.cell);
    }
  }
  if (bossDown && hp > 0) return winsNow();
  // Shaman rites resolve after the attacks, as in the live phase (UI data only: they never hurt the cat).
  if (hp > 0) for (const rite of shamanRites(sim.board, plan.actors)) phase.empowered.push({ shamanId: rite.shaman.id, id: rite.cell.id, index: rite.index, tier: rite.tier });
  preview.rotations = rotationPreview(sim, sim.board, sim.player.index, displaced);
  result.activeRotationCells = new Set(preview.rotations.filter(plan => plan.active).flatMap(plan => [plan.from, plan.to]));
  const volleyHitsHero = state.hazard.turnsUntil === 1 && state.hazard.cells.includes(sim.player.index);
  if (!effectAware) {
    if (preview.damage >= state.player.hp) deactivate();
    preview.volleyDamage = volleyHitsHero ? state.hazard.damage : 0;
    hurt(preview, 'volley', preview.volleyDamage);
    preview.playerDies = preview.damage >= state.player.hp;
    return result;
  }
  if (hp <= 0) deactivate();
  if (hp > 0 && volleyHitsHero) {
    const damage = Math.min(hp, state.hazard.damage);
    hp -= damage; preview.volleyDamage = damage; hurt(preview, 'volley', damage);
  }
  if (hp > 0) {
    const tick = tickDamageEffects(effects);
    effects = tick.effects;
    for (const hit of tick.hits) {
      const damage = Math.min(hp, hit.damage);
      hp -= damage; preview.effectDamage! += damage; hurt(preview, tickSource(hit.kind), damage);
      if (hp <= 0) break;
    }
  }
  preview.endEffects = effects;
  preview.playerDies = hp <= 0;
  return result;
}

export function simulateAbility(state: ForestState, ability: AbilityKind, targetIndex?: number): ChainSimulation & { preview: AbilityPreview } {
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
  forecastEnemyPhase(state, { ...state, board, player: { ...state.player, index: preview.endIndex } }, preview);
  return { preview, board, bossKilled };
}

/** Intent preparation runs only between turns. Targets never chase a submitted chain. */
export function prepareIntents(state: ForestState, rand: (min: number, max: number) => number = min => min) {
  state.bossWarning = [];
  state.rotations = [];
  const melee: { index: number; distance: number; id: number }[] = [];
  const shamans: number[] = [];
  const paired = new Set<number>();
  const prepared = new Set<number>();
  state.board.forEach((cell, index) => {
    if (!cell || cell.kind !== 'door' && !isCellAlive(cell) || prepared.has(cell.id)) return; prepared.add(cell.id);
    cell.intent = { cells: [], damage: 1, label: 'Готовится' }; cell.countdown = 2;
    // Quills are not a weapon: a lesson porcupine without `armed` still shows them.
    if (cell.variant === 'porcupine') { cell.intent.label = cell.status.frozen > 0 ? 'Заморожен · без игл' : 'Иглы'; return; }
    if (cell.behavior.passive) { cell.behavior.aggressive = false; cell.intent.label = 'Без оружия'; return; }
    if (cell.variant === 'sentinel') {
      const actor: EnemyActor = { subtype: 4, kind: 1, power: cell.hp, col: index % state.cols, row: Math.floor(index / state.cols), face_dir: 1, attack_mode: 0, properties: {} };
      updateShieldDir(actor, state.player.index % state.cols, Math.floor(state.player.index / state.cols), {
        remove: (enemy, prop) => { delete enemy.properties[prop]; }, set: (enemy, prop, value) => { enemy.properties[prop] = value; }, spriteIndex: () => 0,
      });
      cell.shield = { dx: actor.properties[249] ?? 0, dy: actor.properties[250] ?? 0 };
    }
    if (cell.variant === 'cabinet') {
      // Every square of a large cabinet guards its surroundings, not only the first scanned square.
      const parts = state.board.flatMap((part, partIndex) => part?.id === cell.id ? [partIndex] : []);
      const around = [...new Set(parts.flatMap(part => neighbors(state, part)))].filter(target => !parts.includes(target)).sort((a, b) => a - b);
      cell.supportTargetId = around.map(target => state.board[target]).find(target => target && isCellAlive(target) && target.id !== cell.id && target.kind !== 'door' && target.kind !== 'prism' && target.variant !== 'cabinet')?.id;
    }
    if (cell.kind === 'door') { cell.intent.label = state.customLevel ? customGoalsMet(state) ? 'Выход открыт' : 'Выполни цели' : cell.door?.breached ? 'Проход открыт' : cell.door?.magic ? 'Нужен ключ или бомба' : 'Ключ или 200 урона'; return; }
    // Forest beasts and the shaman never join the one-new-goblin aggression queue (forestBeasts.ts).
    if (cell.variant === 'shaman') { cell.intent = { cells: [], damage: 0, label: 'Готовит камлание' }; shamans.push(index); return; }
    if (cell.variant === 'wolf') {
      // One threshold: a living neighbouring wolf arms it and makes it angry; a lone wolf stays passive.
      const pack = wolfHasPack(state, index);
      cell.behavior.aggressive = pack;
      if (pack && meleeCanAttack(cell)) {
        cell.countdown = 1;
        cell.intent = { cells: meleeTargets(state, index), damage: WOLF_DAMAGE, label: 'Стая · замах' };
      } else cell.intent.label = !pack ? 'Одинок' : cell.status.frozen > 0 ? 'Заморожен' : 'Стая · отдых';
      return;
    }
    if (cell.variant === 'boar') {
      // Announced now, run at the start of the next enemy phase; never retargeted after the chain.
      if (cell.status.frozen > 0) { cell.intent.label = 'Заморожен'; return; }
      if (cell.behavior.restTurns > 0) { cell.intent.label = 'Оглушён'; return; }
      const direction = chargeDirection(state.cols, index, state.player.index), lane = chargeLane(state, index, direction, BOAR_CHARGE_LENGTH);
      if (!lane.length) { cell.intent.label = 'Упёрся'; return; }
      cell.countdown = 1;
      cell.intent = { cells: lane, damage: BOAR_DAMAGE, label: 'Рывок', charge: { ...direction, length: BOAR_CHARGE_LENGTH } };
      return;
    }
    if (cell.kind === 'melee') {
      cell.intent.label = 'Спокоен';
      // A goblin raised by a shaman is permanently armed: angry again once its rest is over.
      if (cell.behavior.tier && cell.behavior.restTurns === 0) cell.behavior.aggressive = true;
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
        if (!walkableTerrain(state.terrain[target])) break;
        cell.intent.cells.push(target);
      }
      cell.countdown = 1; cell.intent.label = 'Выстрел';
    } else if (cell.kind === 'boss') {
      if (cell.variant === 'beacon') {
        cell.intent = { cells: [], damage: 0, label: 'Призыв через 2 хода' };
        if (cell.status.frozen > 0) { cell.intent.label = 'Заморожен'; return; }
        if ((cell.behavior.cycle ?? 0) % 2 === 1) {
          // Calm weak enemies that the arrival step will actually replace.
          const targets = state.board.flatMap((target, targetIndex) => target && canReplaceWithArrival(state, state.board, targetIndex)
            && !target.behavior.aggressive && target.maxHp === 0 ? [{ index: targetIndex, id: target.id }] : []).slice(0, 2);
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
            const targetIndex = y * state.cols + x;
            return !summonCells.includes(targetIndex) && canReplaceWithArrival(state, state.board, targetIndex);
          };
          for (let summon = 0; summon < 2; summon++) {
            // Native cyclic board scan; our eligibility requires an occupied ordinary chair.
            const [x, y] = randomLaunchCell(index % state.cols, Math.floor(index / state.cols), -1, -1, state.cols, state.rows,
              { rand, valid: eligible, marshAt: () => false, cell: () => null });
            if (eligible(x, y)) summonCells.push(y * state.cols + x);
          }
          // IDs are fixed with the cells: a push that moves another chair onto a cell never changes the victim.
          cell.intent = { cells: [], damage: 0, label: 'Призыв мебели', summonCells, summonIds: summonCells.map(target => state.board[target]!.id) };
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
  // Shaman rites are announced after the aggression step, so the targets' steps are final for this turn.
  // One step per target per phase: a goblin announced by one shaman is not announced by another.
  const claimed = new Set<number>();
  for (const index of shamans) {
    const cell = state.board[index]!;
    if (cell.status.frozen > 0) { cell.intent.label = 'Заморожен'; continue; }
    if ((cell.behavior.cycle ?? 0) % SHAMAN_PERIOD !== SHAMAN_PERIOD - 1) continue;
    const targets = shamanTargets(state, index, claimed);
    for (const target of targets) claimed.add(target.id);
    cell.countdown = 1;
    cell.intent = { cells: [], damage: 0, label: targets.length ? 'Камлание' : 'Камлание · нет целей',
      empowerIds: targets.map(target => target.id), empowerCells: targets.map(target => target.index) };
  }
}
