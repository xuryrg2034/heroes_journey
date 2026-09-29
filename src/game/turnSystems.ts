import { isCellAlive } from './cellLife';
import type { AbilityKind, DoorData, ForestCell, ForestState, RotationPreview } from './forestTypes';
import type { ChainSimulation } from './forestSystems';
import { rotationPreview } from './forestSystems';
import { uniqueEntities } from './entityFootprint';
import { customGoalsMet } from './customLevel';
import { damageCell, damageHero, removeDefeated, defeatsRoomBoss } from './combatRules';
import { archerStrikesCreatures, archerVolley, evaluateEnemyAttack, planEnemyPhase, type EnemyAttack, type PlannedSummon } from './enemyPhase';
import { HERO_MOVE_ID, resolveCharges } from './boarCharge';
import { THORN_DAMAGE } from './terrain';
import { shamanActive, shamanRites } from './forestBeasts';
import { updateBasicAttack, type BasicAttackOps, type EnemyActor } from './recovered/enemies';
import type { EngineEvent } from './forestTypes';
import { stepBleeding, tickDamageEffects } from './damageEffects';
import { applyAttackEffect, assignDamageEffects, canReceiveDamageEffects, hasDamageEffects } from './effectRules';
import { applyDeviceVolley, closeExpiredPits, deviceAt, deviceTargets } from './devices';
import type { TurnSequence } from './turnRuntime';

/** World services used by the synchronous turn systems. No clocks or animation promises. */
export interface TurnContext {
  readonly state: ForestState;
  current(): boolean;
  setPendingPrism(index: number | null): void;
  recordDefeat(cell: ForestCell, index: number, playerCredit: boolean): void;
  completeRoom(door: DoorData, index: number): void;
  finish(won: boolean, message?: string): void;
  refreshCustomProgress(): void;
  planRotationReplacements(rotations: RotationPreview[]): Map<number, ForestCell>;
  advanceWave(): void;
  generateBoard(summons: PlannedSummon[]): boolean;
  prepareHazard(): void;
  hint(): string;
}

export function* resolvePlayerTurn(ctx: TurnContext, simulation: ChainSimulation, ability?: AbilityKind): TurnSequence {
  const startIndex = ctx.state.player.index;
  ctx.state.player.energy = Math.min(7, Math.max(0, ctx.state.player.energy - simulation.preview.energyCost + simulation.preview.energyGain));
  ctx.state.chosenAbility = null;
  if (ctx.state.tutorial) ctx.state.tutorial.hintDismissed = true;
  ctx.setPendingPrism(simulation.preview.prismIndex ?? null);
  ctx.state.phase = 'PLAYER_RESOLVE'; ctx.state.turn++; ctx.state.lastDamage = 0;
  ctx.state.message = 'Каждый враг даёт +1 силы, его HP расходуют запас.'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  if (ability) { yield { event: { type: 'ability', text: ability, from: startIndex, to: simulation.preview.endIndex, indices: simulation.preview.hits.map(hit => hit.index) } }; if (!ctx.current()) return false; }
  const delay = Math.max(35, Math.min(90, 700 / Math.max(1, simulation.preview.hits.length)));
  let pendingDoor: { door: DoorData; index: number } | undefined;
  const steps = simulation.steps ?? simulation.preview.hits.map(hit => ({ kind: 'hit' as const, hit }));
  for (const action of steps) {
    if (!ctx.current()) return false;
    if (action.kind === 'device') {
      const device = deviceAt(ctx.state, action.index)!;
      const from = ctx.state.player.index; ctx.state.player.index = action.index;
      yield { event: { type: 'move', from, to: action.index, index: action.index } };
      if (!ctx.current()) return false;
      if (action.activated) {
        device.charges--;
        yield { event: { type: 'device', index: action.index, text: device.kind, amount: device.charges } };
        if (!ctx.current()) return false;
      }
      if (ctx.state.room.key.droppedAt === action.index) {
        ctx.state.room.key = { held: true, droppedAt: null };
        yield { event: { type: 'key-collect', index: action.index } };
        if (!ctx.current()) return false;
      }
      if (ctx.state.player.damageEffects?.bleeding) {
        yield* resolveMovementBleeding(ctx);
        if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
      }
      yield { delay };
      continue;
    }
    const hit = action.hit;
    if (!ctx.current()) return false;
    const original = ctx.state.board[hit.index]!;
    ctx.state.board.forEach((cell, index) => { if (cell?.id === original.id) ctx.state.board[index] = simulation.board[index]; });
    if (hit.killed) {
      if (ability !== 'spin') {
        const from = ctx.state.player.index; ctx.state.player.index = hit.index;
        yield { event: { type: 'move', from, to: hit.index, index: hit.index } };
        if (!ctx.current()) return false;
      }
      if (original.kind === 'prism') ctx.state.objective.prisms++;
      else ctx.recordDefeat(original, hit.index, true);
      if (!ctx.current()) return false;
    }
    if (hit.keyCollected) {
      ctx.state.room.key = { held: true, droppedAt: null }; yield { event: { type: 'key-collect', index: hit.index } };
      if (!ctx.current()) return false;
    }
    if (original.kind === 'boss') ctx.state.objective.bossHits++;
    if (hit.phaseChanged) { yield { event: { type: 'boss-phase', index: hit.index, text: 'ПЕЧАТЬ РАЗРУШЕНА · 24 HP' } }; if (!ctx.current()) return false; }
    ctx.state.score += hit.killed ? 20 + hit.damage * 2 : hit.damage;
    yield { event: { type: hit.physical ? 'hit' : 'collect', index: hit.index, amount: hit.damage, text: hit.killed ? undefined : `${hit.hpAfter} HP` } };
    if (!ctx.current()) return false;
    if (hit.killed) yield { event: { type: 'kill', index: hit.index } };
    if (!ctx.current()) return false;
    const attackEffect = hit.attackEffect ?? ctx.state.player.attackEffect;
    if (!hit.killed && hit.physical && attackEffect && original.kind !== 'door'
      && (attackEffect !== 'wind' || original.damageEffects?.burning)) {
      yield { event: { type: 'status', index: hit.index, effect: attackEffect, amount: 1 } };
    }
    // Porcupine quills (same amount as simulateChain): at the hit, before any later step or victory.
    if (hit.spikeDamage) {
      if (!ctx.current()) return false;
      const damage = damageHero(ctx.state, hit.spikeDamage);
      yield { event: { type: 'damage', index: ctx.state.player.index, from: hit.index, amount: damage, text: 'quills' } };
      if (!ctx.current()) return false;
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    if (hit.killed && !ability && ctx.state.player.damageEffects?.bleeding) {
      yield* resolveMovementBleeding(ctx);
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    if (hit.doorOpened && original.door) pendingDoor = { door: original.door, index: hit.index };
    yield { delay };
  }
  if (!ctx.current()) return false;
  if (ability === 'jump' && ctx.state.player.index !== simulation.preview.endIndex) {
    ctx.state.player.index = simulation.preview.endIndex;
    yield { event: { type: 'move', from: startIndex, to: simulation.preview.endIndex, index: simulation.preview.endIndex } };
    if (!ctx.current()) return false;
    if (simulation.preview.keyCollected) { ctx.state.room.key = { held: true, droppedAt: null }; yield { event: { type: 'key-collect', index: simulation.preview.endIndex } }; if (!ctx.current()) return false; }
  }
  ctx.state.chain = [];
  // Same rule as simulateChain: an ordinary chain that stops on thorns costs the cat HP before any lever.
  if (!ability && ctx.state.terrain[ctx.state.player.index] === 'thorns') {
    const damage = damageHero(ctx.state, THORN_DAMAGE);
    yield { event: { type: 'damage', index: ctx.state.player.index, amount: damage, text: 'thorns' } };
    if (!ctx.current()) return false;
    if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  }
  for (const device of simulation.queuedDevices ?? []) {
    yield { event: { type: 'trap', index: device.index, text: device.kind, indices: deviceTargets(ctx.state, device), amount: device.kind === 'pits' ? undefined : device.damage ?? 4 } };
    if (!ctx.current()) return false;
    for (const impact of applyDeviceVolley(ctx.state, device)) {
      if (impact.pitOpened) yield { event: { type: 'pit-open', index: impact.index, indices: [impact.index] } };
      else if (impact.pitImmune) yield { event: { type: 'pit-immune', index: impact.index, indices: [impact.index] } };
      else if (impact.heroDamage !== undefined) yield { event: { type: 'damage', index: impact.index, amount: impact.heroDamage } };
      else if (impact.hit) {
        if (impact.hit.phaseChanged) {
          yield { event: { type: 'boss-phase', index: impact.index, text: 'ПЕЧАТЬ РАЗРУШЕНА · 24 HP' } };
          if (!ctx.current()) return false;
        }
        yield { event: { type: 'hit', index: impact.index, amount: impact.hit.damage } };
        if (!ctx.current()) return false;
        if (impact.hit.killed) {
          ctx.recordDefeat(impact.cell!, impact.index, true);
          if (!ctx.current()) return false;
          yield { event: { type: 'kill', index: impact.index } };
        }
      }
      if (!ctx.current()) return false;
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    yield { delay: 160 };
    if (!ctx.current()) return false;
  }
  if (pendingDoor) { ctx.state.objective.turns++; ctx.completeRoom(pendingDoor.door, pendingDoor.index); return true; }
  if (simulation.bossKilled || ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.state.objective.turns++; ctx.finish(true); return true; }
  return yield* resolveEnemyTurn(ctx);
}

/** Preserve the recovered windup → impact → recovery machine without wall-clock waits. */
function* resolveMeleeAttack(ctx: TurnContext, cell: ForestCell, index: number): TurnSequence {
  const target = ctx.state.player.index;
  const actor: EnemyActor = { subtype: 2, power: cell.hp, kind: 1, col: index % ctx.state.cols,
    row: Math.floor(index / ctx.state.cols), face_dir: 1, attack_mode: 1, properties: { 53: 0 } };
  let substate = 0, animationDone = false, completed = false, impacted = false;
  const events: EngineEvent[] = [];
  const ops: BasicAttackOps = {
    setAnim: () => { events.push({ type: 'attack', index, from: index, to: target }); },
    sound: () => {},
    animDone: () => animationDone,
    idle: () => {},
    meleeDamage: () => {
      if (impacted || ctx.state.player.index !== target || !evaluateEnemyAttack(cell, index, target, ctx.state)?.hitsHero) return;
      impacted = true;
      cell.behavior.aggressive = false; cell.behavior.restTurns = 1;
      const damage = damageHero(ctx.state, cell.intent.damage);
      events.push({ type: 'damage', index: target, from: index, amount: damage });
    },
    nextState: (_enemy, state) => {
      if (state !== 77) return;
      completed = true;
      events.push({ type: 'enemy-recovery', index, from: index, to: target });
    },
  };
  const tick = (timer: number) => { [substate] = updateBasicAttack(actor, substate, timer, ops); };
  tick(0);
  for (const event of events.splice(0)) yield { event };
  yield { delay: 60 };
  animationDone = true; tick(1);
  // Reaching substate 1 does not itself apply the impact; run its entry separately.
  animationDone = false; tick(0);
  for (const event of events.splice(0)) yield { event };
  if (impacted && ctx.state.player.hp > 0 && applyAttackEffect(ctx.state.player, cell.attackEffect, false)) {
    yield { event: { type: 'status', index: target, from: index, effect: cell.attackEffect, amount: 1 } };
  }
  yield { delay: 55 };
  animationDone = true; tick(1);
  for (const event of events.splice(0)) yield { event };
  return completed;
}

export function* resolveEnemyAttacks(ctx: TurnContext, actors: Pick<EnemyAttack, 'cell' | 'index'>[]): TurnSequence {
  let bossKilled = false;
  for (const { cell, index } of actors) {
    // Keep actor membership fixed, but honour status/intent edits made by synchronous subscribers.
    const attack = evaluateEnemyAttack(cell, index, ctx.state.player.index, ctx.state);
    if (!attack) continue;
    const { target, hitsHero } = attack;
    if (cell.kind === 'melee') {
      if (!(yield* resolveMeleeAttack(ctx, cell, index))) return false;
    } else {
      if (cell.variant === 'wizard') cell.behavior.cycle = (cell.behavior.cycle ?? 0) + 1;
      if (cell.kind === 'ranged' || cell.variant === 'jailer') cell.behavior.restTurns = 1;
      yield { event: { type: 'attack', index, from: index, to: target,
        ...(['wizard', 'jailer'].includes(cell.variant ?? '') ? { indices: [...cell.intent.cells] } : {}) } };
      if (hitsHero) {
        const damage = damageHero(ctx.state, cell.intent.damage);
        yield { event: { type: 'damage', index: ctx.state.player.index, from: index, amount: damage } };
        if (ctx.state.player.hp > 0 && applyAttackEffect(ctx.state.player, cell.attackEffect, false)) {
          yield { event: { type: 'status', index: ctx.state.player.index, from: index, effect: cell.attackEffect, amount: 1 } };
        }
      }
      // Forest arrows strike every creature on the announced cells; kills are credited to the player.
      if (ctx.state.player.hp > 0 && archerStrikesCreatures(cell)) for (const impact of archerVolley(ctx.state.board, cell)) {
        yield { event: { type: 'hit', index: impact.index, from: index, amount: impact.damage } };
        if (!ctx.current()) return false;
        if (!impact.killed) continue;
        ctx.recordDefeat(impact.cell, impact.index, true);
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index } };
        bossKilled ||= defeatsRoomBoss(ctx.state, impact.cell);
      }
      yield { delay: 115 };
    }
    if (ctx.state.player.hp === 0) return true;
  }
  if (bossKilled) { ctx.state.objective.turns++; ctx.finish(true); }
  return true;
}

/**
 * Boar charges at the start of the enemy phase (shared rule: boarCharge.ts). Pushed entities are added
 * to `displaced`: they skip their action and their announced swaps this phase.
 */
export function* resolveBoarCharges(ctx: TurnContext, displaced: Set<number>): TurnSequence {
  let bossKilled = false, boarIndex = -1;
  for (const impact of resolveCharges(ctx.state, displaced)) {
    if (!ctx.current()) return false;
    if (impact.kind === 'start') {
      boarIndex = impact.index;
      yield { event: { type: 'charge', index: impact.index, from: impact.index, indices: impact.lane, amount: impact.boar.intent.damage } };
    } else if (impact.kind === 'ram' || impact.kind === 'crush') {
      const text = impact.kind === 'ram' ? 'ram' : impact.cause;
      if (impact.heroDamage !== undefined) {
        yield { event: { type: 'damage', index: ctx.state.player.index, from: impact.kind === 'ram' ? boarIndex : undefined, amount: impact.heroDamage, text } };
        if (!ctx.current()) return false;
        if (impact.kind === 'ram' && impact.effect) yield { event: { type: 'status', index: ctx.state.player.index, from: boarIndex, effect: ctx.state.board[boarIndex]?.attackEffect, amount: 1 } };
        if (ctx.state.player.hp === 0) return true;
        continue;
      }
      yield { event: { type: 'hit', index: impact.index, from: boarIndex, amount: impact.damage, text: impact.kind === 'ram' && impact.shielded ? 'ЩИТ' : text } };
      if (!ctx.current()) return false;
      if (impact.killed && impact.cell) {
        ctx.recordDefeat(impact.cell, impact.index, true);
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index, text } };
        bossKilled ||= defeatsRoomBoss(ctx.state, impact.cell);
      }
    } else if (impact.kind === 'shift') {
      boarIndex = impact.to;
      const hero = impact.moves.find(move => move.id === HERO_MOVE_ID);
      yield { event: { type: 'push', index: impact.to, from: impact.from, to: impact.to, indices: impact.moves.map(move => move.to) } };
      if (!ctx.current()) return false;
      if (hero) { yield { event: { type: 'move', from: hero.from, to: hero.to, index: hero.to, text: 'push' } }; if (!ctx.current()) return false; }
      yield { delay: 90 };
    } else if (impact.kind === 'stun') {
      yield { event: { type: 'status', index: impact.index, text: 'ОГЛУШЁН' } };
    } else yield { delay: 60 };
    if (!ctx.current()) return false;
  }
  if (bossKilled && ctx.state.player.hp > 0) { ctx.state.objective.turns++; ctx.finish(true); }
  return true;
}

/** Apply every announced exchange after attacks; replacements never act in this phase. */
export function* resolveRotations(ctx: TurnContext, displaced: ReadonlySet<number> = new Set()): TurnSequence {
  const rotations = rotationPreview(ctx.state, ctx.state.board, ctx.state.player.index, displaced), replacements = ctx.planRotationReplacements(rotations);
  for (const plan of rotations) {
    if (!ctx.current()) return false;
    if (!plan.active) continue;
    const spawned: number[] = [];
    for (const index of [plan.from, plan.to]) if (!ctx.state.board[index]) {
      ctx.state.board[index] = replacements.get(index)!; spawned.push(index);
    }
    if (spawned.length) { yield { event: { type: 'spawn', indices: spawned } }; if (!ctx.current()) return false; }
    const source = ctx.state.board[plan.from]!, target = ctx.state.board[plan.to]!;
    ctx.state.board[plan.from] = target; ctx.state.board[plan.to] = source;
    source.status.wet = ctx.state.terrain[plan.to] === 'puddle'; target.status.wet = ctx.state.terrain[plan.from] === 'puddle';
    ctx.state.rotations = ctx.state.rotations.filter(pending => pending.from !== plan.from || pending.to !== plan.to);
    yield { event: { type: 'enemy-swap', index: plan.to, from: plan.from, to: plan.to, geometry: plan.geometry } };
    if (!ctx.current()) return false;
    yield { delay: 115 }; if (!ctx.current()) return false;
  }
  return true;
}

/** Volley damage is uncredited and keeps its original hit → removal → kill barriers. */
export function* resolveHazard(ctx: TurnContext): TurnSequence {
  if (ctx.state.hazard.turnsUntil === 1 && ctx.state.hazard.cells.length) {
    yield { event: { type: 'arrow-volley', indices: [...ctx.state.hazard.cells], amount: ctx.state.hazard.damage } };
    if (!ctx.current()) return false;
    const volleyHit = new Set<number>();
    for (const index of ctx.state.hazard.cells) {
      if (index === ctx.state.player.index) {
        const damage = damageHero(ctx.state, ctx.state.hazard.damage);
        yield { event: { type: 'damage', index, amount: damage } };
        if (!ctx.current()) return false;
        // Lethal volley damage ends the turn: later arrows neither kill nor credit anything.
        if (ctx.state.player.hp === 0) return true;
      } else {
        const cell = ctx.state.board[index];
        if (cell && cell.kind !== 'door' && cell.kind !== 'prism' && !volleyHit.has(cell.id)) {
          volleyHit.add(cell.id);
          const outcome = damageCell(cell, ctx.state.hazard.damage, 'hazard');
          yield { event: { type: 'hit', index, amount: ctx.state.hazard.damage } };
          if (!ctx.current()) return false;
          if (outcome.killed) {
            removeDefeated(ctx.state.board, cell); ctx.recordDefeat(cell, index, false);
            if (!ctx.current()) return false;
            yield { event: { type: 'kill', index } };
          }
        }
      }
      if (!ctx.current()) return false;
    }
    yield { delay: 160 }; if (!ctx.current()) return false;
  }
  return true;
}

/** One actually reached chain cell is one ordinary step, including diagonal/prism/door moves. */
function* resolveMovementBleeding(ctx: TurnContext): TurnSequence {
  const step = stepBleeding(ctx.state.player.damageEffects);
  assignDamageEffects(ctx.state.player, step.effects);
  yield { event: { type: 'status', index: ctx.state.player.index, effect: 'bleeding' } };
  for (const hit of step.hits) {
    const damage = damageHero(ctx.state, hit.damage);
    yield { event: { type: 'damage', index: ctx.state.player.index, amount: damage, effect: hit.kind } };
    if (ctx.state.player.hp === 0) break;
  }
  return true;
}

/** Hero damage wins simultaneous lethal outcomes; enemy effects then tick once per entity. */
export function* resolveDamageEffects(ctx: TurnContext): TurnSequence {
  if (hasDamageEffects(ctx.state.player)) {
    const tick = tickDamageEffects(ctx.state.player.damageEffects);
    for (const hit of tick.hits) {
      const damage = damageHero(ctx.state, hit.damage);
      yield { event: { type: 'damage', index: ctx.state.player.index, amount: damage, effect: hit.kind } };
      if (ctx.state.player.hp === 0) break;
    }
    assignDamageEffects(ctx.state.player, tick.effects);
    yield { event: { type: 'status', index: ctx.state.player.index } };
    if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  }
  let bossKilled = false;
  for (const { cell, index } of uniqueEntities(ctx.state.board)) {
    if (!canReceiveDamageEffects(cell) || !hasDamageEffects(cell)) continue;
    const tick = tickDamageEffects(cell.damageEffects);
    for (const hit of tick.hits) {
      const outcome = damageCell(cell, hit.damage, 'effect');
      if (outcome.phaseChanged) yield { event: { type: 'boss-phase', index, text: 'ПЕЧАТЬ РАЗРУШЕНА · 24 HP' } };
      yield { event: { type: 'hit', index, amount: hit.damage, effect: hit.kind } };
      if (outcome.killed) {
        removeDefeated(ctx.state.board, cell); ctx.recordDefeat(cell, index, hit.playerCredit);
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index, effect: hit.kind } };
        bossKilled ||= defeatsRoomBoss(ctx.state, cell);
        break;
      }
    }
    if (isCellAlive(cell)) {
      assignDamageEffects(cell, tick.effects);
      yield { event: { type: 'status', index } };
    }
  }
  if (bossKilled) { ctx.state.objective.turns++; ctx.finish(true); }
  return true;
}

/** Status expiry and turn objectives happen after the hazard and before generation. */
function settleTurn(ctx: TurnContext): boolean {
  uniqueEntities(ctx.state.board).forEach(({ cell }) => { if (cell.status.frozen > 0) cell.status.frozen--; });
  ctx.state.objective.turns++; if (!ctx.state.lastDamage) ctx.state.score += 30;
  ctx.refreshCustomProgress();
  if (ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.finish(true); return true; }
  if (ctx.state.customLevel && ctx.state.level.turnLimit > 0 && ctx.state.turn >= ctx.state.level.turnLimit) { ctx.finish(false, 'Лимит ходов исчерпан. Попробуй другой маршрут.'); return true; }
  return false;
}

export function* updateBoard(ctx: TurnContext, summons: PlannedSummon[]): TurnSequence {
  ctx.state.phase = 'BOARD_UPDATE'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  ctx.advanceWave();
  if (!ctx.current()) return false;
  if (!ctx.generateBoard(summons)) return false;
  ctx.prepareHazard(); ctx.state.itemPrepared = false;
  yield { event: { type: 'refill' } }; yield { delay: 180 };
  if (!ctx.current()) return false;
  ctx.state.phase = 'PLAYER_INPUT'; ctx.state.message = ctx.hint(); yield { event: { type: 'state' } }; return true;
}

/** The phase order is explicit; each system can be stepped synchronously without a clock. */
export function* resolveEnemyTurn(ctx: TurnContext): TurnSequence {
  ctx.state.phase = 'ENEMY_RESOLVE';
  yield { event: { type: 'enemy-turn' } };
  yield { delay: 140 };
  // Rest counts down only for entities already resting at the start; a stun earned in this phase is kept.
  // Summon victims are fixed by ID on the board at the start, before any boar push (the beacon's rule).
  const opening = planEnemyPhase(ctx.state.board, ctx.state.player.index), resting = opening.resting, summons = opening.summons;
  const displaced = new Set<number>();
  if (!(yield* resolveBoarCharges(ctx, displaced))) return false;
  if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  if (['WIN', 'LOSE'].includes(ctx.state.phase)) return true;
  // Attackers, the pushed cat's cell and knocked-down entities are read after the charges.
  const plan = planEnemyPhase(ctx.state.board, ctx.state.player.index, displaced);
  if (!(yield* resolveEnemyAttacks(ctx, plan.actors))) return false;
  if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  if (['WIN', 'LOSE'].includes(ctx.state.phase)) return true;
  if (!(yield* resolveShamanRites(ctx, plan.actors))) return false;
  for (const { cell } of plan.actors) if ((cell.variant === 'beacon' || cell.variant === 'shaman') && isCellAlive(cell)
    && !cell.behavior.passive && cell.status.frozen === 0) cell.behavior.cycle = (cell.behavior.cycle ?? 0) + 1;
  ctx.refreshCustomProgress();
  if (!(yield* resolveRotations(ctx, displaced))) return false;
  for (const { cell } of resting) cell.behavior.restTurns--;
  if (!(yield* resolveHazard(ctx))) return false;
  if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  if (!(yield* resolveDamageEffects(ctx))) return false;
  if (['WIN', 'LOSE'].includes(ctx.state.phase)) return true;
  const closed = closeExpiredPits(ctx.state);
  if (closed.length) { yield { event: { type: 'pit-close', indices: closed } }; if (!ctx.current()) return false; }
  if (settleTurn(ctx)) return true;
  return yield* updateBoard(ctx, summons);
}

/**
 * Shaman rites after the attacks (shared rule: forestBeasts.ts). Knocked-down shamans are not actors and skip
 * their rite; the event is published once the goblin already has its new step.
 */
export function* resolveShamanRites(ctx: TurnContext, actors: { cell: ForestCell; index: number }[]): TurnSequence {
  if (!actors.some(({ cell }) => cell.intent.empowerIds?.length && shamanActive(ctx.state.board, cell))) return true;
  for (const rite of shamanRites(ctx.state.board, actors)) {
    yield { event: { type: 'empower', index: rite.index, from: rite.shamanIndex, amount: rite.cell.hp, text: rite.tier } };
    if (!ctx.current()) return false;
    yield { delay: 90 };
    if (!ctx.current()) return false;
  }
  return true;
}
