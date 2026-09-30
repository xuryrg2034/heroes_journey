import { isCellAlive } from './cellLife';
import type { AbilityKind, ForestCell, ForestState, RotationPreview } from './forestTypes';
import type { ChainSimulation } from './forestSystems';
import { rotationPreview } from './forestSystems';
import { uniqueEntities } from './entityFootprint';
import { customGoalsMet } from './customLevel';
import { damageCell, damageHero, defeatOutright, removeDefeated, type DefeatCredit } from './combatRules';
import { crystalScore } from './mapBattleRules';
import { archerStrikesCreatures, archerVolley, evaluateEnemyAttack, planEnemyPhase, type EnemyAttack } from './enemyPhase';
import { HERO_MOVE_ID, resolveCharges } from './boarCharge';
import { THORN_DAMAGE } from './terrain';
import { shamanActive, shamanRites } from './forestBeasts';
import { clubCanRaise, clubImpacts, isTroll, swingClub, trollRegeneration } from './troll';
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
  /** One draw of the live battle RNG: a crystal falling during the chain consumes exactly what the forecast drew. */
  drawRandom(): number;
  /** A new colour-change crystal entity (fresh ID) holding the chain length `value`; the caller puts it on the board. */
  createCrystal(index: number, value: number): ForestCell;
  recordDefeat(cell: ForestCell, index: number, credit: DefeatCredit): void;
  finish(won: boolean, message?: string): void;
  refreshCustomProgress(): void;
  planRotationReplacements(rotations: RotationPreview[]): Map<number, ForestCell>;
  generateBoard(): boolean;
  hint(): string;
}

export function* resolvePlayerTurn(ctx: TurnContext, simulation: ChainSimulation, ability?: AbilityKind): TurnSequence {
  const startIndex = ctx.state.player.index;
  ctx.state.player.energy = Math.min(7, Math.max(0, ctx.state.player.energy - simulation.preview.energyCost + simulation.preview.energyGain));
  ctx.state.chosenAbility = null;
  if (ctx.state.tutorial) ctx.state.tutorial.hintDismissed = true;
  ctx.state.phase = 'PLAYER_RESOLVE'; ctx.state.turn++; ctx.state.lastDamage = 0;
  ctx.state.message = 'Каждый враг даёт +1 силы, его HP расходуют запас.'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  if (ability) { yield { event: { type: 'ability', text: ability, from: startIndex, to: simulation.preview.endIndex, indices: simulation.preview.hits.map(hit => hit.index) } }; if (!ctx.current()) return false; }
  const delay = Math.max(35, Math.min(90, 700 / Math.max(1, simulation.preview.hits.length)));
  let doorOpened = false;
  const steps = simulation.steps ?? simulation.preview.hits.map(hit => ({ kind: 'hit' as const, hit }));
  for (const action of steps) {
    if (!ctx.current()) return false;
    if (action.kind === 'crystal') {
      // A crystal falls where the forecast drew it (same RNG draw), crushing the enemy there through the common death
      // path without credit; the kill is published once it is gone, the crystal once it stands on the board.
      ctx.drawRandom();
      const victim = ctx.state.board[action.index];
      if (victim && victim.id === action.victimId) {
        defeatOutright(victim);
        if (!(yield* defeatCreature(ctx, victim, action.index, 'none', 'crystal'))) return false;
      }
      const crystal = ctx.createCrystal(action.index, action.value);
      ctx.state.board[action.index] = crystal;
      yield { event: { type: 'crystal', index: action.index, newId: crystal.id, amount: crystalScore(crystal), ...(action.victimId !== undefined ? { oldId: action.victimId } : {}) } };
      if (!ctx.current()) return false;
      yield { delay };
      continue;
    }
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
    // The hit entity's cells take its state after this hit (a crystal may fall on them later in the forecast board).
    ctx.state.board.forEach((cell, index) => { if (cell?.id === original.id) ctx.state.board[index] = hit.killed ? null : simulation.board[index]; });
    if (hit.killed) {
      if (ability !== 'spin') {
        const from = ctx.state.player.index; ctx.state.player.index = hit.index;
        yield { event: { type: 'move', from, to: hit.index, index: hit.index } };
        if (!ctx.current()) return false;
      }
      if (original.kind === 'prism') ctx.state.objective.prisms++;
      else ctx.recordDefeat(original, hit.index, 'player');
      if (!ctx.current()) return false;
    }
    if (original.kind === 'boss') ctx.state.objective.bossHits++;
    // A map-battle crystal scores by the chain that created it (same number as the forecast's hits[].crystalScore).
    ctx.state.score += hit.crystalScore ?? (hit.killed ? 20 + hit.damage * 2 : hit.damage);
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
    if (hit.doorOpened) doorOpened = true;
    yield { delay };
  }
  if (!ctx.current()) return false;
  if (ability === 'jump' && ctx.state.player.index !== simulation.preview.endIndex) {
    ctx.state.player.index = simulation.preview.endIndex;
    yield { event: { type: 'move', from: startIndex, to: simulation.preview.endIndex, index: simulation.preview.endIndex } };
    if (!ctx.current()) return false;
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
        yield { event: { type: 'hit', index: impact.index, amount: impact.hit.damage } };
        if (!ctx.current()) return false;
        if (impact.hit.killed) {
          ctx.recordDefeat(impact.cell!, impact.index, 'player');
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
  // Entering the opened authored exit, or meeting direct goals, ends the battle before any enemy answers.
  if (doorOpened || ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.state.objective.turns++; ctx.finish(true); return true; }
  return yield* resolveEnemyTurn(ctx);
}

/**
 * Common death path of a creature already out of HP: removal of all its cells, defeat record (key drop, goal refresh,
 * credit by `credit`) and the `kill` event once it is gone. Returns false when a subscriber restarted the scene.
 */
function* defeatCreature(ctx: TurnContext, cell: ForestCell, index: number, credit: DefeatCredit, text?: string): TurnSequence {
  removeDefeated(ctx.state.board, cell);
  ctx.recordDefeat(cell, index, credit);
  if (!ctx.current()) return false;
  yield { event: { type: 'kill', index, ...(text ? { text } : {}) } };
  return ctx.current();
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
  for (const { cell, index } of actors) {
    // Keep actor membership fixed, but honour status/intent edits made by synchronous subscribers.
    const attack = evaluateEnemyAttack(cell, index, ctx.state.player.index, ctx.state);
    if (!attack) continue;
    const { target, hitsHero } = attack;
    if (cell.kind === 'melee') {
      if (!(yield* resolveMeleeAttack(ctx, cell, index))) return false;
    } else {
      if (cell.kind === 'ranged' || cell.variant === 'jailer') cell.behavior.restTurns = 1;
      // The troll's club (troll.ts): it rests and its zone is spent before the swing is published.
      const club = isTroll(cell) ? swingClub(cell) : null;
      yield { event: { type: 'attack', index, from: index, to: target,
        ...(cell.variant === 'jailer' ? { indices: [...cell.intent.cells] } : {}),
        ...(club ? { indices: [...club.zone], amount: club.damage, text: 'club' } : {}) } };
      if (hitsHero) {
        const damage = damageHero(ctx.state, cell.intent.damage);
        yield { event: { type: 'damage', index: ctx.state.player.index, from: index, amount: damage, ...(club ? { text: 'club' } : {}) } };
        if (ctx.state.player.hp > 0 && applyAttackEffect(ctx.state.player, cell.attackEffect, false)) {
          yield { event: { type: 'status', index: ctx.state.player.index, from: index, effect: cell.attackEffect, amount: 1 } };
        }
      }
      // Forest arrows strike every creature on the announced cells; an enemy's kill counts only for goal targets.
      if (ctx.state.player.hp > 0 && archerStrikesCreatures(cell)) for (const impact of archerVolley(ctx.state.board, cell)) {
        yield { event: { type: 'hit', index: impact.index, from: index, amount: impact.damage } };
        if (!ctx.current()) return false;
        if (!impact.killed) continue;
        ctx.recordDefeat(impact.cell, impact.index, 'enemy');
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index } };
      }
      // The club falls on every creature in the zone, enemies included; an enemy's kill counts only for goal targets.
      if (ctx.state.player.hp > 0 && club) for (const impact of clubImpacts(ctx.state.board, cell, club.zone, club.damage)) {
        yield { event: { type: 'hit', index: impact.index, from: index, amount: impact.damage, text: 'club' } };
        if (!ctx.current()) return false;
        if (!impact.killed) continue;
        ctx.recordDefeat(impact.cell, impact.index, 'enemy');
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index, text: 'club' } };
      }
      yield { delay: 115 };
    }
    if (ctx.state.player.hp === 0) return true;
  }
  return true;
}

/**
 * Boar charges at the start of the enemy phase (shared rule: boarCharge.ts). Pushed entities are added
 * to `displaced`: they skip their action and their announced swaps this phase.
 */
export function* resolveBoarCharges(ctx: TurnContext, displaced: Set<number>): TurnSequence {
  let boarIndex = -1;
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
        // A boar's ram and push are an enemy ability: the kill counts only for goal targets.
        ctx.recordDefeat(impact.cell, impact.index, 'enemy');
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index, text } };
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
  for (const { cell, index } of uniqueEntities(ctx.state.board)) {
    if (!canReceiveDamageEffects(cell) || !hasDamageEffects(cell)) continue;
    const tick = tickDamageEffects(cell.damageEffects);
    for (const hit of tick.hits) {
      const outcome = damageCell(cell, hit.damage, 'effect');
      yield { event: { type: 'hit', index, amount: hit.damage, effect: hit.kind } };
      if (outcome.killed) {
        removeDefeated(ctx.state.board, cell); ctx.recordDefeat(cell, index, hit.playerCredit ? 'player' : 'environment');
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index, effect: hit.kind } };
        break;
      }
    }
    if (isCellAlive(cell)) {
      assignDamageEffects(cell, tick.effects);
      yield { event: { type: 'status', index } };
    }
  }
  return true;
}

/** Status expiry and turn objectives happen after the effect ticks and before generation. */
function settleTurn(ctx: TurnContext): boolean {
  uniqueEntities(ctx.state.board).forEach(({ cell }) => { if (cell.status.frozen > 0) cell.status.frozen--; });
  ctx.state.objective.turns++; if (!ctx.state.lastDamage) ctx.state.score += 30;
  ctx.refreshCustomProgress();
  if (ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.finish(true); return true; }
  if (ctx.state.customLevel && ctx.state.level.turnLimit > 0 && ctx.state.turn >= ctx.state.level.turnLimit) { ctx.finish(false, 'Лимит ходов исчерпан. Попробуй другой маршрут.'); return true; }
  return false;
}

export function* updateBoard(ctx: TurnContext): TurnSequence {
  ctx.state.phase = 'BOARD_UPDATE'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  if (!ctx.generateBoard()) return false;
  ctx.state.itemPrepared = false;
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
  const resting = planEnemyPhase(ctx.state.board, ctx.state.player.index).resting;
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
  for (const { cell } of plan.actors) if (cell.variant === 'shaman' && isCellAlive(cell)
    && !cell.behavior.passive && cell.status.frozen === 0) cell.behavior.cycle = (cell.behavior.cycle ?? 0) + 1;
  if (!(yield* resolveTrollWindups(ctx, plan.actors))) return false;
  ctx.refreshCustomProgress();
  if (!(yield* resolveRotations(ctx, displaced))) return false;
  for (const { cell } of resting) cell.behavior.restTurns--;
  if (!(yield* resolveDamageEffects(ctx))) return false;
  if (['WIN', 'LOSE'].includes(ctx.state.phase)) return true;
  if (!(yield* resolveTrollRegeneration(ctx))) return false;
  const closed = closeExpiredPits(ctx.state);
  if (closed.length) { yield { event: { type: 'pit-close', indices: closed } }; if (!ctx.current()) return false; }
  if (settleTurn(ctx)) return true;
  return yield* updateBoard(ctx);
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

/**
 * Troll windup (troll.ts): an armed, thawed, rested troll with an announced zone raises its club this phase, so
 * its next enemy phase strikes. Frost and rest pause the cycle. The event is published once the club is raised.
 */
export function* resolveTrollWindups(ctx: TurnContext, actors: { cell: ForestCell; index: number }[]): TurnSequence {
  for (const { cell, index } of actors) {
    if (!clubCanRaise(ctx.state.board, cell)) continue;
    cell.behavior.club = { ...cell.behavior.club!, cells: [...cell.behavior.club!.cells], raised: true };
    yield { event: { type: 'windup', index, from: index, indices: [...cell.behavior.club.cells], text: 'club' } };
    if (!ctx.current()) return false;
    yield { delay: 90 };
    if (!ctx.current()) return false;
  }
  return true;
}

/**
 * Troll regeneration at the end of the enemy phase, after the effect ticks: a living troll that took no damage
 * this turn and carries no burning stacks restores up to TROLL_REGEN HP. The per-turn damage mark is cleared here.
 */
export function* resolveTrollRegeneration(ctx: TurnContext): TurnSequence {
  for (const { cell, index } of uniqueEntities(ctx.state.board)) {
    if (!isTroll(cell)) continue;
    const amount = trollRegeneration(cell);
    delete cell.behavior.hurtThisTurn;
    if (!amount) continue;
    cell.hp += amount;
    yield { event: { type: 'regen', index, amount, text: `${cell.hp} HP` } };
    if (!ctx.current()) return false;
    yield { delay: 90 };
    if (!ctx.current()) return false;
  }
  return true;
}
