import { isCellAlive } from './cellLife';
import { cloneEntity } from './ecs/components';
import { cloneEntities } from './ecs/world';
import type { AbilityKind, AbilityPreview, ChainHit, ChainPreview, ChargeDamageCause, EnemyPhaseForecast, HeroDamageSource, InteractionDevice, ForestCell, ForestState, ObjectiveProgress, RotationPlan, RotationPreview } from './forestTypes';
import { recoveredMoveTowards } from './recoveredEnemyMovement';
import { canMoveTo, updateShieldDir, type EnemyActor } from './recovered/enemies';
import { pathColour, WILD } from './recovered/core';
import { canFireArrowHit } from './recovered/combat';
import { footprintPerimeter, uniqueEntities } from './entityFootprint';
import { archerStrikesCreatures, archerVolley, evaluateEnemyAttack, planEnemyPhase } from './enemyPhase';
import { BOAR_CHARGE_LENGTH, BOAR_DAMAGE, chargeDirection, chargeLane, HERO_MOVE_ID, resolveCharges } from './boarCharge';
import { THORN_DAMAGE, walkableTerrain } from './terrain';
import { chainSpikeDamage, SHAMAN_PERIOD, shamanRites, shamanTargets, wolfHasPack, WOLF_DAMAGE } from './forestBeasts';
import { creditDefeat, damageCell, defeatOutright, physicalDamage, removeDefeated, shieldBlocksEntry } from './combatRules';
export { physicalDamage, shieldBlocksEntry } from './combatRules';
import { MELEE_AGGRESSION_START_TURN, meleeCanAttack } from './enemyLifecycle';
import { applyDamageEffect, stepBleeding, tickDamageEffects, type DamageEffects } from './damageEffects';
import { assignDamageEffects, applyAttackEffect, hasDamageEffects } from './effectRules';
import { customGoalsMet } from './customLevel';
import { applyDeviceVolley, deviceAt, pitAt } from './devices';
import { clubImpacts, clubZone, effectTickHurts, isTroll, swingClub, TROLL_CLUB_DAMAGE, trollBody, trollRegeneration } from './troll';
import { angerPerTurn, CRYSTAL_KILLS, crystalCellAllowed, crystalScore, nextRandom } from './mapBattleRules';

export const ABILITY_COST: Record<AbilityKind, number> = { jump: 2, spin: 3 };
export const emptyDamageBySource = (): Record<HeroDamageSource, number> => ({ quills: 0, bleeding: 0, thorns: 0, trap: 0, charge: 0, melee: 0, ranged: 0, boss: 0, troll: 0, burning: 0, poison: 0 });
/** The only way the forecast adds cat damage: the total and its source stay in step. */
function hurt(preview: ChainPreview, source: HeroDamageSource, amount: number) {
  preview.damage += amount; preview.damageBySource[source] += amount;
}
const tickSource = (kind: 'fire' | 'poison' | 'bleeding'): HeroDamageSource => kind === 'fire' ? 'burning' : kind;
export const JUMP_RANGE = 3;

/** Entity copy by the component registry (ecs/components.ts). */
export const cloneCell = (cell: ForestCell): ForestCell => cloneEntity(cell);
/** Board copy by the registry; a multi-cell entity stays one shared record across its cells. */
export const cloneBoard = (board: (ForestCell | null)[]): (ForestCell | null)[] => cloneEntities(board);
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
function meleeTargets(state: ForestState, index: number): number[] {
  const footprint = state.board[index]?.footprint;
  if (footprint && footprint.length > 1) return footprintPerimeter(footprint, state.cols, state.rows).filter(target => isWalkable(state, target));
  return neighbors(state, index).filter(target => target % state.cols === index % state.cols || Math.floor(target / state.cols) === Math.floor(index / state.cols));
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
  return !!normal(source) && !!normal(target) && adjacent(state, from, to)
    && (from % state.cols === to % state.cols || Math.floor(from / state.cols) === Math.floor(to / state.cols))
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
    else if (!rotationGeometryClear(state, plan)) reason = 'Путь обмена закрыт.';
    else if (used.has(plan.from) || used.has(plan.to)) reason = 'Клетка уже участвует в другом обмене.';
    if (!reason) { used.add(plan.from); used.add(plan.to); }
    return { ...plan, active: !reason, ...(reason ? { reason } : {}) };
  });
}
/** A cardinal swap needs both cells walkable and side by side. */
function rotationGeometryClear(state: ForestState, plan: RotationPlan): boolean {
  const { from, to } = plan;
  if (from === to || !isWalkable(state, from) || !isWalkable(state, to)) return false;
  const dx = to % state.cols - from % state.cols, dy = Math.floor(to / state.cols) - Math.floor(from / state.cols);
  return Math.abs(dx) + Math.abs(dy) === 1;
}
/**
 * `crystal`: a colour-change crystal falls on `index` after the preceding step (one battle-RNG draw), crushing the
 * enemy `victimId` there; `value` is the chain's final kill count. Internal: never part of the public forecast.
 */
export type ChainStep = { kind: 'hit'; hit: ChainHit } | { kind: 'device'; index: number; activated: boolean }
  | { kind: 'crystal'; index: number; victimId?: number; value: number };
export interface ChainSimulation { steps?: ChainStep[]; queuedDevices?: InteractionDevice[]; preview: ChainPreview; board: (ForestCell | null)[] }
/** Stand-in for a fallen crystal on the forecast board (the engine gives the real one its ID at execution). */
function crystalStandIn(state: ForestState, index: number, id: number): ForestCell {
  return { id, kind: 'prism', color: null, hp: 1, maxHp: 1, armor: 0, countdown: 2, crystalChain: 0,
    status: { wet: state.terrain[index] === 'puddle', frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 },
    intent: { cells: [], damage: 1, label: 'Готовится' } };
}
/**
 * Shared pure combat evaluator: preview and the committed turn consume this exact result. `rng` is a copy of the live
 * battle RNG state: with it the crystals falling during the chain are drawn exactly as execution will draw them; without
 * it (validity checks, witness search) no crystal falls.
 */
export function simulateChain(state: ForestState, path: number[], allowIncomplete = false, rng?: number): ChainSimulation {
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
        const outcome = damageCell(cell, damage, 'physical');
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
  forecastEnemyPhase(state, forecastState, preview, movingPlayer.damageEffects, customProgress);
  // Only the number of fallen crystals is public; their cells and the crushed enemies stay in the internal steps.
  if (crystalSteps.length) { preview.crystals = crystalSteps.length; preview.createsPrism = true; }
  return { preview, board, steps, queuedDevices };
}
/**
 * The enemy phase after an action, run on a copy with the live rules: boar charges (boarCharge.ts),
 * attacks in board order with archer arrows striking creatures (enemyPhase.ts), swaps, effect ticks.
 * `after` is the position once the action and its levers resolved. No RNG, no events.
 */
function forecastEnemyPhase(state: ForestState, after: ForestState, preview: ChainPreview, movementEffects = state.player.damageEffects,
  progress: ObjectiveProgress = state.objective): void {
  // Forced deaths are enemy abilities: as in the live phase (recordDefeat 'enemy') only goal targets and bosses count.
  const credited = { ...progress };
  if (preview.playerDies) { preview.rotations = []; return; }
  const effectAware = hasDamageEffects(state.player) || !!state.player.attackEffect
    || after.board.some(cell => cell && (hasDamageEffects(cell) || cell.attackEffect));
  let hp = state.player.hp - preview.damage;
  let effects: DamageEffects | undefined = movementEffects ? { ...movementEffects } : undefined;
  if (effectAware) { preview.movementDamage ??= 0; preview.effectDamage = 0; }
  if (preview.completesRoom) {
    preview.rotations = [];
    if (effectAware) preview.endEffects = effects;
    preview.playerDies = effectAware ? hp <= 0 : preview.damage >= state.player.hp;
    return;
  }
  const sim: ForestState = { ...after, board: cloneBoard(after.board), pits: after.pits.map(pit => ({ ...pit })),
    player: { ...after.player, hp, damageEffects: effects ? { ...effects } : undefined }, lastDamage: 0 };
  // Keep the raw threat total for boards without effects; the charge part is always the applied damage.
  const phase: EnemyPhaseForecast = { heroIndex: sim.player.index, charges: [], rams: [], moves: [], deaths: [], knockedDown: [], packBroken: [], empowered: [], regenerated: [] };
  const displaced = new Set<number>(), firstFrom = new Map<number, number>(), lastTo = new Map<number, number>();
  let chargeDamage = 0, chargeFrom = -1, chargeBoar = -1;
  const chargeBreakdown: Record<ChargeDamageCause, number> = { ram: 0, spikes: 0, thorns: 0, pit: 0 };
  for (const impact of resolveCharges(sim, displaced)) {
    if (impact.kind === 'ram' || impact.kind === 'crush') {
      if (impact.heroDamage !== undefined) { chargeDamage += impact.heroDamage; chargeBreakdown[impact.kind === 'ram' ? 'ram' : impact.cause] += impact.heroDamage; }
      if (impact.cell && impact.killed) {
        phase.deaths.push({ id: impact.cell.id, index: impact.index, cause: impact.kind === 'ram' ? 'ram' : impact.cause });
        creditDefeat(state, impact.cell, credited, 'enemy');
      }
    }
    if (impact.kind === 'start') { chargeFrom = impact.index; chargeBoar = impact.boar.id; }
    if (impact.kind === 'ram') phase.rams.push({ boarId: chargeBoar, id: impact.cell?.id ?? HERO_MOVE_ID, index: impact.index, damage: impact.damage, killed: impact.killed, shielded: impact.shielded });
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
  const deactivate = () => { preview.rotations = preview.rotations.map(plan => ({ ...plan, active: false, reason: 'Кот погибнет до обмена.' })); };
  if (hp <= 0) {
    preview.rotations = rotationPreview(sim, sim.board, sim.player.index, displaced); deactivate();
    if (effectAware) preview.endEffects = effects;
    preview.playerDies = true;
    return;
  }
  // Authored goals are checked in settleTurn, after the cat's own tick, with the turn counted.
  const settles = () => {
    if (!preview.playerDies && state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, { ...credited, turns: credited.turns + 1 })) phase.completesObjective = true;
    return;
  };
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
      hp -= damage; hurt(preview, attack.cell.kind === 'ranged' ? 'ranged' : isTroll(attack.cell) ? 'troll' : attack.cell.kind === 'boss' ? 'boss' : 'melee', damage);
      if (effectAware && hp <= 0) break;
      if (effectAware && attack.cell.attackEffect) effects = applyDamageEffect(effects, attack.cell.attackEffect);
    }
    if (hp > 0 && archerStrikesCreatures(attack.cell)) for (const impact of archerVolley(sim.board, attack.cell)) {
      if (!impact.killed) continue;
      phase.deaths.push({ id: impact.cell.id, index: impact.index, cause: 'arrow' });
      creditDefeat(state, impact.cell, credited, 'enemy');
    }
    // The troll's club falls on every creature in its zone, as in the live phase (troll.ts).
    const club = isTroll(attack.cell) ? swingClub(attack.cell) : null;
    if (hp > 0 && club) for (const impact of clubImpacts(sim.board, attack.cell, club.zone, club.damage)) {
      if (!impact.killed) continue;
      phase.deaths.push({ id: impact.cell.id, index: impact.index, cause: 'club' });
      creditDefeat(state, impact.cell, credited, 'enemy');
    }
  }
  // Shaman rites resolve after the attacks, as in the live phase (UI data only: they never hurt the cat).
  if (hp > 0) for (const rite of shamanRites(sim.board, plan.actors)) phase.empowered.push({ shamanId: rite.shaman.id, id: rite.cell.id, index: rite.index, tier: rite.tier });
  // Troll regeneration at the end of the phase (UI data only). Its own effect tick still to come this phase is
  // projected with the same kernel the live phase uses.
  if (hp > 0) for (const { cell, index } of uniqueEntities(sim.board)) {
    if (!isTroll(cell)) continue;
    const amount = trollRegeneration(cell, effectTickHurts(cell));
    if (amount) phase.regenerated.push({ id: cell.id, index, amount });
  }
  preview.rotations = rotationPreview(sim, sim.board, sim.player.index, displaced);
  if (!effectAware) {
    if (preview.damage >= state.player.hp) deactivate();
    preview.playerDies = preview.damage >= state.player.hp;
    if (preview.playerDies) phase.regenerated = [];
    settles(); return;
  }
  if (hp <= 0) deactivate();
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
  // A cat killed by its own tick ends the turn before the regeneration step.
  if (preview.playerDies) phase.regenerated = [];
  settles();
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
  const after: ForestState = { ...state, turn: state.turn + 1, board: cloneBoard(state.board), pits: state.pits.map(pit => ({ ...pit })),
    player: { ...state.player, ...(state.player.damageEffects ? { damageEffects: { ...state.player.damageEffects } } : {}) }, lastDamage: 0 };
  forecastEnemyPhase(state, after, preview, state.player.damageEffects, { ...state.objective });
  return preview;
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
    else if (cell && cell.hp > physicalDamage(cell, 4)) reject('Цель должна погибнуть от удара при приземлении.');
    else preview.endIndex = index;
  } else if (!indices.length) reject('Рядом нет противников.');
  const customProgress = { ...state.objective };
  if (!preview.valid) return { preview, board };
  const seen = new Set<number>();
  for (const index of indices) {
    const cell = board[index]; if (!cell || seen.has(cell.id)) continue; seen.add(cell.id);
    const damage = physicalDamage(cell, 4);
    const { hpBefore, killed } = damageCell(cell, damage, 'physical');
    if (!killed) applyAttackEffect(cell, state.player.attackEffect, true);
    preview.enemies++; preview.hits.push({ index, damage, hpBefore, hpAfter: cell.hp, killed, physical: true });
    if (killed) {
      preview.kills++; removeDefeated(board, cell);
      creditDefeat(state, cell, customProgress);
    }
  }
  preview.completesRoom = state.customLevel?.definition.completion === 'direct' && customGoalsMet(state, customProgress);
  forecastEnemyPhase(state, { ...state, board, player: { ...state.player, index: preview.endIndex } }, preview, state.player.damageEffects, customProgress);
  return { preview, board };
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
    // The shield-bearer turns its shield toward the cat every turn, armed or not (decision of 30.09.2026).
    if (cell.variant === 'sentinel') {
      const actor: EnemyActor = { subtype: 4, kind: 1, power: cell.hp, col: index % state.cols, row: Math.floor(index / state.cols), face_dir: 1, attack_mode: 0, properties: {} };
      updateShieldDir(actor, state.player.index % state.cols, Math.floor(state.player.index / state.cols), {
        remove: (enemy, prop) => { delete enemy.properties[prop]; }, set: (enemy, prop, value) => { enemy.properties[prop] = value; }, spriteIndex: () => 0,
      });
      cell.shield = { dx: actor.properties[249] ?? 0, dy: actor.properties[250] ?? 0 };
    }
    if (cell.behavior.passive) { cell.behavior.aggressive = false; cell.intent.label = 'Без оружия'; return; }
    if (cell.kind === 'door') { cell.intent.label = customGoalsMet(state) ? 'Выход открыт' : 'Выполни цели'; return; }
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
        // Keep our cardinal, occupied-pair rules; port only the verified three-pass selection.
        const step = recoveredMoveTowards({ col: index % state.cols, row: Math.floor(index / state.cols),
          destCol: state.player.index % state.cols, destRow: Math.floor(state.player.index / state.cols), minDist: 0 }, {
          rand,
          canMoveTo: (x, y) => x >= 0 && x < state.cols && y >= 0 && y < state.rows
            && !paired.has(y * state.cols + x) && canSwapEnemies(state, index, y * state.cols + x),
        });
        const target = step.row * state.cols + step.col;
        if (target !== index) {
          cell.intent.moveTo = target; cell.intent.swapWithId = state.board[target]!.id;
          cell.intent.label = 'Отдых · ротация'; paired.add(index); paired.add(target);
          state.rotations.push({ from: index, to: target, sourceId: cell.id, targetId: state.board[target]!.id, geometry: 'cardinal' });
        }
        return;
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
      if (cell.variant === 'troll') {
        // Windup → strike → rest (troll.ts). The zone is chosen toward the cat when the windup is announced and
        // kept until the strike; frost and rest pause the cycle without losing it.
        cell.intent = { cells: [], damage: 0, label: 'Отдых' };
        if (cell.behavior.restTurns > 0) { if (cell.status.frozen > 0) cell.intent.label = 'Заморожен · отдых'; return; }
        if (cell.status.frozen > 0) { cell.intent.label = cell.behavior.club?.raised ? 'Заморожен · удар удержан' : 'Заморожен'; return; }
        if (!cell.behavior.club) cell.behavior.club = { ...clubZone(state, trollBody(state.board, cell), state.player.index), raised: false };
        const club = cell.behavior.club;
        cell.countdown = club.raised ? 1 : 2;
        cell.intent = { cells: [...club.cells], damage: TROLL_CLUB_DAMAGE, label: club.raised ? 'Удар дубиной' : 'Замах дубиной' };
        return;
      }
      if (cell.variant === 'jailer') {
        cell.shield ??= { dx: 0, dy: 1 };
        if (cell.status.frozen > 0 || cell.behavior.restTurns > 0) {
          cell.intent = { cells: [], damage: 0, label: cell.status.frozen > 0 ? 'Заморожен · щит опущен' : 'Отдых · щит опущен' };
          return;
        }
      }
      const dx = state.player.index % state.cols - index % state.cols, dy = Math.floor(state.player.index / state.cols) - Math.floor(index / state.cols);
      const horizontal = Math.abs(dx) >= Math.abs(dy), sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
      cell.intent.cells = neighbors(state, index).filter(target => horizontal ? target % state.cols - index % state.cols === sign : Math.floor(target / state.cols) - Math.floor(index / state.cols) === sign);
      cell.countdown = 1; cell.intent.damage = cell.variant === 'jailer' ? 2 : 1; cell.intent.label = cell.variant === 'jailer' ? 'Тяжёлый удар' : 'Взмах котелком'; state.bossWarning = [...cell.intent.cells];
    }
  });
  // Pressure accumulates: old windups persist, one calm enemy joins each turn — more as turns pass in map battles
  // on rows ≥ 5 (angerPerTurn, mapBattleRules.ts).
  if (state.turn >= MELEE_AGGRESSION_START_TURN) for (const candidate of melee.sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, angerPerTurn(state))) {
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
