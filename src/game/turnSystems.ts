import { isCellAlive } from './cellLife';
import type { AbilityKind, ChainHit, EnemyPhaseForecast, ForcedDeathCause, ForestCell, ForestState, HeroDamageSource, ItemKind, ItemPreview, LootKind, RotationPreview } from './forestTypes';
import { ITEMS } from './items';
import { cleanseDamageEffects } from './damageEffects';
import type { ChainSimulation } from './forestSystems';
import { rotationPreview } from './rotations';
import { uniqueEntities } from './entityFootprint';
import { customGoalsMet, refreshCustomProgress } from './customLevel';
import { applyDamage, heroTarget, defeatOutright, type DefeatCredit } from './combatRules';
import { crystalScore } from './mapBattleRules';
import { evaluateEnemyAttack, planEnemyPhase, type EnemyAttack } from './enemyPhase';
import { behaviorOf } from './enemyBehaviors';
import { heroStrikeDamage, rollEliteLoot } from './elite';
import { emptyMaterials, isResource } from './resources';
import { HERO_MOVE_ID, resolveCharges, type ChargeImpact } from './boarCharge';
import { THORN_DAMAGE } from './terrain';
import { shamanActive, shamanRites } from './forestBeasts';
import { clubCanRaise, isTroll, trollRegeneration } from './troll';
import { updateBasicAttack, type BasicAttackOps, type EnemyActor } from './recovered/enemies';
import type { EngineEvent } from './forestTypes';
import { stepBleeding, tickDamageEffects } from './damageEffects';
import { applyAttackEffect, assignDamageEffects, canReceiveDamageEffects, hasDamageEffects } from './effectRules';
import { applyDeviceVolley, closeExpiredPits, deviceAt, deviceTargets } from './devices';
import type { TurnSequence } from './turnRuntime';
/** Cat damage cause of a periodic effect hit, as in the forecast breakdown. */
const heroTickCause = (kind: 'fire' | 'poison' | 'bleeding'): HeroDamageSource => kind === 'fire' ? 'burning' : kind;
import type { World } from './ecs/world';
import { instant, runSchedule, type ScheduleVerdict, type SystemSet, type TurnSystem } from './ecs/schedule';

/**
 * Per-turn data handed between the systems of one schedule (ECS plan §3.4): the action being resolved and the
 * snapshots of the enemy phase. Created empty for every turn.
 */
export interface TurnScratch {
  action?: { simulation: ChainSimulation; ability?: AbilityKind; startIndex: number; doorOpened: boolean };
  /** The consumable being used (ItemAction): kind, target cell and its validated preview. */
  item?: { kind: ItemKind; index: number; preview: ItemPreview };
  enemyPhase?: { resting: { cell: ForestCell; index: number }[]; displaced: Set<number>; actors: { cell: ForestCell; index: number }[] };
  /** What the turn's systems did, in order; the forecast projects its preview from it (forecast.ts). */
  report?: TurnReport;
  /** Elites the player killed outside a planned chain step; their loot rolls when the killing action is over. */
  lootQueue?: ForestCell[];
}

/**
 * Facts the systems record while they resolve a turn (live or on the forecast's copy): the forecast reads its
 * preview from them instead of resolving the rules a second time. Cheap; the live turn ignores it.
 */
export interface TurnReport {
  /** Every boar charge impact, in resolution order (boarCharge.ts). */
  chargeImpacts: ChargeImpact[];
  /** Cells of the enemies that hurt the cat: a ramming boar (its starting cell), then attackers in board order. */
  threats: number[];
  /** Wolves whose announced strike at the cat the board cancels when their turn comes. */
  packBroken: number[];
  /** Creatures killed by enemy abilities (charges, arrows, the club) in this enemy phase. */
  deaths: { id: number; index: number; cause: ForcedDeathCause }[];
  empowered: EnemyPhaseForecast['empowered'];
  regenerated: EnemyPhaseForecast['regenerated'];
  /** The announced rotations as the rotation step judged them (absent until it runs). */
  rotations?: RotationPreview[];
  /** Lever volleys after the chain: creatures struck, kills (prisms excluded), pits opened and pits that held a figure. */
  trapHits: ChainHit[];
  trapKills: number;
  pitCells: number[];
  pitImmuneCells: number[];
}
export function turnReport(ctx: { scratch: TurnScratch }): TurnReport {
  return ctx.scratch.report ??= { chargeImpacts: [], threats: [], packBroken: [], deaths: [], empowered: [], regenerated: [], trapHits: [], trapKills: 0, pitCells: [], pitImmuneCells: [] };
}

/** The world and its services used by the synchronous turn systems. No clocks or animation promises. */
export interface TurnContext {
  /** The battle world (state and resources); `state` is `world.state`. */
  readonly world: World;
  readonly state: ForestState;
  readonly scratch: TurnScratch;
  current(): boolean;
  /** One draw of the live battle RNG: a crystal falling during the chain consumes exactly what the forecast drew. */
  drawRandom(): number;
  /** Structural changes of the world (ECS plan §3.6). */
  readonly cmd: Commands;
  finish(won: boolean, message?: string): void;
  planRotationReplacements(rotations: RotationPreview[]): Map<number, ForestCell>;
  /** Refill (with fresh intents unless `prepare` is false); returns the cells that received a new enemy. */
  generateBoard(prepare?: boolean): number[];
  hint(): string;
}

/** Commands of the turn systems: the one path of structural changes that notify observers. */
export interface Commands {
  /** Common death path (combatRules.killCreature): removal, then death observers with `credit`. */
  kill(cell: ForestCell, index: number, credit: DefeatCredit): void;
  /** A new colour-change crystal (fresh ID) holding the chain length `value`, placed on `index`. */
  placeCrystal(index: number, value: number): ForestCell;
  /** A consumable or resource dropped by an elite (fresh ID): a `prism` record carrying `loot`, placed on `index`. */
  placeLoot(index: number, item: LootKind): ForestCell;
}

/**
 * Turn observers with events (ECS plan §3.5): they run inside the chain system at a fixed point and yield their
 * events there. Registration order is call order.
 * - chain hit: after a chain hit is published (porcupine quills);
 * - hero step: after an ordinary step of the cat (bleeding).
 * Each returns false when a restart cancelled it; the chain system then stops a dead cat's turn.
 */
export interface ChainHitObserver { readonly name: string; run(ctx: TurnContext, hit: ChainHit): TurnSequence }
export interface HeroStepObserver { readonly name: string; run(ctx: TurnContext): TurnSequence }
/** Porcupine quills (same amount as simulateChain): at the hit, before any later step or victory. */
const Quills: ChainHitObserver = { name: 'quills', *run(ctx, hit) {
  if (!hit.spikeDamage) return true;
  if (!ctx.current()) return false;
  const damage = applyDamage(heroTarget(ctx.state), hit.spikeDamage, 'quills').damage;
  yield { event: { type: 'damage', index: ctx.state.player.index, from: hit.index, amount: damage, text: 'quills' } };
  return ctx.current();
} };
/** Bleeding: one ordinary step of the cat advances its step counter and may hurt. */
const BleedingStep: HeroStepObserver = { name: 'bleeding-step', *run(ctx) {
  if (!ctx.state.player.damageEffects?.bleeding) return true;
  return yield* resolveMovementBleeding(ctx);
} };
export const CHAIN_HIT_OBSERVERS: readonly ChainHitObserver[] = [Quills];
export const HERO_STEP_OBSERVERS: readonly HeroStepObserver[] = [BleedingStep];

/** PlayerAction: the chain or ability hits, moves, crystals, devices on the path, quills and bleeding steps. */
const ChainResolve: TurnSystem<TurnContext> = { name: 'ChainResolve', *run(ctx) {
  const turn = ctx.scratch.action!, { simulation, ability } = turn;
  const startIndex = turn.startIndex;
  ctx.state.player.energy = Math.min(7, Math.max(0, ctx.state.player.energy - simulation.preview.energyCost + simulation.preview.energyGain));
  ctx.state.chosenAbility = null;
  if (ctx.state.tutorial) ctx.state.tutorial.hintDismissed = true;
  ctx.state.phase = 'PLAYER_RESOLVE'; ctx.state.turn++; ctx.state.lastDamage = 0;
  ctx.state.message = 'Каждый враг даёт +1 силы, его HP расходуют запас.'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  if (ability) { yield { event: { type: 'ability', text: ability, from: startIndex, to: simulation.preview.endIndex, indices: simulation.preview.hits.map(hit => hit.index) } }; if (!ctx.current()) return false; }
  const delay = Math.max(35, Math.min(90, 700 / Math.max(1, simulation.preview.hits.length)));
  const steps = simulation.steps ?? simulation.preview.hits.map(hit => ({ kind: 'hit' as const, hit }));
  for (const action of steps) {
    if (!ctx.current()) return false;
    if (action.kind === 'loot') {
      // An elite's loot rolled by the plan (same draws): it falls where the plan put it, crushing the enemy there.
      for (let n = 0; n < action.draws; n++) ctx.drawRandom();
      if (action.index === undefined) continue;
      if (!(yield* placeLoot(ctx, action.index, action.item!, action.victimId))) return false;
      yield { delay };
      continue;
    }
    if (action.kind === 'crystal') {
      // A crystal falls where the forecast drew it (same RNG draw), crushing the enemy there through the common death
      // path without credit; the kill is published once it is gone, the crystal once it stands on the board.
      ctx.drawRandom();
      const victim = ctx.state.board[action.index];
      if (victim && victim.id === action.victimId) {
        defeatOutright(victim);
        if (!(yield* defeatCreature(ctx, victim, action.index, 'none', 'crystal'))) return false;
      }
      const crystal = ctx.cmd.placeCrystal(action.index, action.value);
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
      for (const observer of HERO_STEP_OBSERVERS) {
        if (!(yield* observer.run(ctx))) return false;
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
      // A dropped consumable joins the inventory, a resource the battle's materials; neither is a prism objective.
      const loot = original.kind === 'prism' ? original.loot : undefined;
      if (loot && isResource(loot)) (ctx.state.materials ??= emptyMaterials())[loot]++;
      else if (loot) ctx.state.inventory[loot]++;
      else if (original.kind === 'prism') ctx.state.objective.prisms++;
      else {
        ctx.cmd.kill(original, hit.index, 'player');
        // An ability's elite kill rolls its loot once the ability is over (an ordinary chain plans it).
        if (ability && original.elite) (ctx.scratch.lootQueue ??= []).push(original);
      }
      if (!ctx.current()) return false;
    }
    if (original.kind === 'boss') ctx.state.objective.bossHits++;
    // A map-battle crystal scores by the chain that created it (same number as the forecast's hits[].crystalScore).
    // Picked-up loot scores nothing (elite.ts); a crystal scores by its chain.
    ctx.state.score += hit.loot ? 0 : hit.crystalScore ?? (hit.killed ? 20 + hit.damage * 2 : hit.damage);
    yield { event: { type: hit.physical ? 'hit' : 'collect', index: hit.index, amount: hit.damage, text: hit.killed ? undefined : `${hit.hpAfter} HP` } };
    if (!ctx.current()) return false;
    if (hit.killed) yield { event: { type: 'kill', index: hit.index } };
    if (hit.loot) { yield { event: { type: 'loot-pickup', index: hit.index, text: hit.loot } }; if (!ctx.current()) return false; }
    if (!ctx.current()) return false;
    const attackEffect = hit.attackEffect ?? ctx.state.player.attackEffect;
    if (!hit.killed && hit.physical && attackEffect && original.kind !== 'door'
      && (attackEffect !== 'wind' || original.damageEffects?.burning)) {
      yield { event: { type: 'status', index: hit.index, effect: attackEffect, amount: 1 } };
    }
    for (const observer of CHAIN_HIT_OBSERVERS) {
      if (!(yield* observer.run(ctx, hit))) return false;
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    if (hit.killed && !ability) for (const observer of HERO_STEP_OBSERVERS) {
      if (!(yield* observer.run(ctx))) return false;
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    if (hit.doorOpened) turn.doorOpened = true;
    yield { delay };
  }
  if (!ctx.current()) return false;
  if (ability === 'jump' && ctx.state.player.index !== simulation.preview.endIndex) {
    ctx.state.player.index = simulation.preview.endIndex;
    yield { event: { type: 'move', from: startIndex, to: simulation.preview.endIndex, index: simulation.preview.endIndex } };
    if (!ctx.current()) return false;
  }
  ctx.state.chain = [];
  return yield* dropQueuedLoot(ctx);
} };
/** PlayerAction: an ordinary chain that stops on thorns costs the cat HP before any lever (as simulateChain). */
const ChainEndTerrain: TurnSystem<TurnContext> = { name: 'ChainEndTerrain', *run(ctx) {
  const { ability } = ctx.scratch.action!;
  if (!ability && ctx.state.terrain[ctx.state.player.index] === 'thorns') {
    const damage = applyDamage(heroTarget(ctx.state), THORN_DAMAGE, 'thorns').damage;
    yield { event: { type: 'damage', index: ctx.state.player.index, amount: damage, text: 'thorns' } };
    if (!ctx.current()) return false;
    if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
  }
  return true;
} };
/** PlayerAction: levers visited by the chain fire after it, in the visiting order. */
const DeviceVolleys: TurnSystem<TurnContext> = { name: 'DeviceVolleys', *run(ctx) {
  const { simulation } = ctx.scratch.action!;
  for (const device of simulation.queuedDevices ?? []) {
    yield { event: { type: 'trap', index: device.index, text: device.kind, indices: deviceTargets(ctx.state, device), amount: device.kind === 'pits' ? undefined : device.damage ?? 4 } };
    if (!ctx.current()) return false;
    const report = turnReport(ctx);
    for (const impact of applyDeviceVolley(ctx.state, device)) {
      if (impact.pitOpened && !report.pitCells.includes(impact.index)) report.pitCells.push(impact.index);
      if (impact.pitImmune && !report.pitImmuneCells.includes(impact.index)) report.pitImmuneCells.push(impact.index);
      if (impact.hit) { report.trapHits.push(impact.hit); if (impact.hit.killed && impact.cell?.kind !== 'prism') report.trapKills++; }
      if (impact.pitOpened) yield { event: { type: 'pit-open', index: impact.index, indices: [impact.index] } };
      else if (impact.pitImmune) yield { event: { type: 'pit-immune', index: impact.index, indices: [impact.index] } };
      else if (impact.heroDamage !== undefined) yield { event: { type: 'damage', index: impact.index, amount: impact.heroDamage } };
      else if (impact.hit) {
        yield { event: { type: 'hit', index: impact.index, amount: impact.hit.damage } };
        if (!ctx.current()) return false;
        if (impact.hit.killed) {
          ctx.cmd.kill(impact.cell!, impact.index, 'player');
          if (impact.cell!.elite) (ctx.scratch.lootQueue ??= []).push(impact.cell!);
          if (!ctx.current()) return false;
          yield { event: { type: 'kill', index: impact.index } };
        }
      }
      if (!ctx.current()) return false;
      if (ctx.state.player.hp === 0) { ctx.finish(false); return true; }
    }
    yield { delay: 160 };
    if (!ctx.current()) return false;
    // Loot of the elites this lever killed falls once its volley is over.
    if (!(yield* dropQueuedLoot(ctx))) return false;
  }
  return true;
} };
/** PlayerAction: entering the opened authored exit, or meeting direct goals, ends the battle before any enemy answers. */
const PlayerVictory = instant<TurnContext>('PlayerVictory', ctx => {
  if (ctx.scratch.action!.doorOpened || ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.state.objective.turns++; ctx.finish(true); }
});

/**
 * Common death path of a creature already out of HP: removal of all its cells, defeat record (key drop, goal refresh,
 * credit by `credit`) and the `kill` event once it is gone. Returns false when a subscriber restarted the scene.
 */
function* defeatCreature(ctx: TurnContext, cell: ForestCell, index: number, credit: DefeatCredit, text?: string): TurnSequence {
  ctx.cmd.kill(cell, index, credit);
  if (!ctx.current()) return false;
  yield { event: { type: 'kill', index, ...(text ? { text } : {}) } };
  return ctx.current();
}

/**
 * An elite's loot lands on `index` (elite.ts): the enemy there (`victimId`) is crushed through the common death path
 * without credit, then the consumable appears. Returns false when a restart cancelled it.
 */
function* placeLoot(ctx: TurnContext, index: number, item: LootKind, victimId?: number): TurnSequence {
  const victim = ctx.state.board[index];
  if (victim && victim.id === victimId) {
    defeatOutright(victim);
    if (!(yield* defeatCreature(ctx, victim, index, 'none', 'loot'))) return false;
  }
  const loot = ctx.cmd.placeLoot(index, item);
  yield { event: { type: 'loot', index, newId: loot.id, text: item } };
  return ctx.current();
}
/** Roll and drop the loot of the queued elites, in kill order, from the live battle RNG (the forecast copy: its own). */
function* dropQueuedLoot(ctx: TurnContext): TurnSequence {
  const queue = ctx.scratch.lootQueue ?? [];
  ctx.scratch.lootQueue = [];
  for (const _elite of queue) {
    const roll = rollEliteLoot(ctx.state, ctx.state.board, new Set(), () => ctx.drawRandom());
    if (roll.index !== undefined && !(yield* placeLoot(ctx, roll.index, roll.item!, roll.victim?.id))) return false;
  }
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
      const damage = applyDamage(heroTarget(ctx.state, cell), cell.intent.damage, behaviorOf(cell)?.attack?.source ?? 'melee').damage;
      turnReport(ctx).threats.push(index);
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
    // An announced strike at the cat that the board now cancels (a wolf whose pack was broken).
    if (!attack && evaluateEnemyAttack(cell, index, ctx.state.player.index)?.hitsHero) turnReport(ctx).packBroken.push(cell.id);
    if (!attack) continue;
    const { target, hitsHero } = attack;
    // evaluateEnemyAttack returned an attack, so the behaviour has an attack rule (enemyBehaviors.ts).
    const rule = behaviorOf(cell)!.attack!;
    if (rule.style === 'melee') {
      if (!(yield* resolveMeleeAttack(ctx, cell, index))) return false;
    } else {
      if (rule.restsAfter) cell.behavior.restTurns = 1;
      // The strike may change the attacker before it is published (the troll rests and its zone is spent).
      const strike = rule.strike?.(cell) ?? {};
      const text = strike.text ? { text: strike.text } : {};
      yield { event: { type: 'attack', index, from: index, to: target, ...strike.event } };
      if (hitsHero) {
        const damage = applyDamage(heroTarget(ctx.state, cell), cell.intent.damage, rule.source).damage;
        turnReport(ctx).threats.push(index);
        yield { event: { type: 'damage', index: ctx.state.player.index, from: index, amount: damage, ...text } };
        if (ctx.state.player.hp > 0 && applyAttackEffect(ctx.state.player, cell.attackEffect, false)) {
          yield { event: { type: 'status', index: ctx.state.player.index, from: index, effect: cell.attackEffect, amount: 1 } };
        }
      }
      // Arrows and the club strike every creature on their cells, enemies included; an enemy's kill counts only for goal targets.
      if (ctx.state.player.hp > 0 && strike.creatures) for (const impact of strike.creatures.impacts(ctx.state.board)) {
        yield { event: { type: 'hit', index: impact.index, from: index, amount: impact.damage, ...text } };
        if (!ctx.current()) return false;
        if (!impact.killed) continue;
        turnReport(ctx).deaths.push({ id: impact.cell.id, index: impact.index, cause: strike.creatures.cause });
        ctx.cmd.kill(impact.cell, impact.index, 'enemy');
        if (!ctx.current()) return false;
        yield { event: { type: 'kill', index: impact.index, ...text } };
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
  let boarIndex = -1, chargeFrom = -1;
  const report = turnReport(ctx);
  for (const impact of resolveCharges(ctx.state, displaced)) {
    if (!ctx.current()) return false;
    report.chargeImpacts.push(impact);
    if (impact.kind === 'start') {
      boarIndex = chargeFrom = impact.index;
      yield { event: { type: 'charge', index: impact.index, from: impact.index, indices: impact.lane, amount: heroStrikeDamage(impact.boar) } };
    } else if (impact.kind === 'ram' || impact.kind === 'crush') {
      const text = impact.kind === 'ram' ? 'ram' : impact.cause;
      if (impact.kind === 'ram' && impact.heroDamage !== undefined) report.threats.push(chargeFrom);
      if (impact.heroDamage === undefined && impact.killed && impact.cell) report.deaths.push({ id: impact.cell.id, index: impact.index, cause: text });
      if (impact.heroDamage !== undefined) {
        yield { event: { type: 'damage', index: ctx.state.player.index, from: impact.kind === 'ram' ? boarIndex : undefined, amount: impact.heroDamage, text } };
        if (!ctx.current()) return false;
        if (impact.kind === 'ram' && impact.effect) yield { event: { type: 'status', index: ctx.state.player.index, from: boarIndex, effect: ctx.state.board[boarIndex]?.attackEffect, amount: 1 } };
        if (ctx.state.player.hp === 0) return true;
        continue;
      }
      // A crystal or loot rammed by the boar is only pushed: no hit to show.
      if (impact.kind === 'ram' && impact.cell?.kind === 'prism') continue;
      yield { event: { type: 'hit', index: impact.index, from: boarIndex, amount: impact.damage, text: impact.kind === 'ram' && impact.shielded ? 'ЩИТ' : text } };
      if (!ctx.current()) return false;
      if (impact.killed && impact.cell) {
        // A boar's ram and push are an enemy ability: the kill counts only for goal targets.
        ctx.cmd.kill(impact.cell, impact.index, 'enemy');
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
  turnReport(ctx).rotations = rotations;
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
    const damage = applyDamage(heroTarget(ctx.state), hit.damage, heroTickCause(hit.kind)).damage;
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
      const damage = applyDamage(heroTarget(ctx.state), hit.damage, heroTickCause(hit.kind)).damage;
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
      const outcome = applyDamage(cell, hit.damage, 'effect');
      yield { event: { type: 'hit', index, amount: hit.damage, effect: hit.kind } };
      if (outcome.killed) {
        ctx.cmd.kill(cell, index, hit.playerCredit ? 'player' : 'environment');
        if (hit.playerCredit && cell.elite) (ctx.scratch.lootQueue ??= []).push(cell);
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
  // Loot of elites the player's burning or poison killed falls after every tick of the phase.
  return yield* dropQueuedLoot(ctx);
}

/** RestAction: the cat skips its hits, gains 0.5 energy and the enemy phase follows. */
const RestStart = instant<TurnContext>('RestStart', ctx => {
  ctx.state.chain = []; ctx.state.chosenAbility = null; ctx.state.turn++; ctx.state.lastDamage = 0;
  ctx.state.player.energy = Math.min(7, ctx.state.player.energy + 0.5);
  ctx.state.message = 'Кот отдыхает: +0,5 энергии. Противники действуют.';
});

const EnemyPhaseStart: TurnSystem<TurnContext> = { name: 'EnemyPhaseStart', *run(ctx) {
  ctx.state.phase = 'ENEMY_RESOLVE';
  yield { event: { type: 'enemy-turn' } };
  yield { delay: 140 };
  return true;
} };
/** Rest counts down only for entities already resting at the start; a stun earned in this phase is kept. */
const PhaseSnapshot = instant<TurnContext>('PhaseSnapshot', ctx => {
  ctx.scratch.enemyPhase = { resting: planEnemyPhase(ctx.state.board, ctx.state.player.index).resting, displaced: new Set(), actors: [] };
});
const BoarCharges: TurnSystem<TurnContext> = { name: 'BoarCharges', run: ctx => resolveBoarCharges(ctx, ctx.scratch.enemyPhase!.displaced) };
/** Attackers, the pushed cat's cell and knocked-down entities are read after the charges. */
const EnemyAttacks: TurnSystem<TurnContext> = { name: 'EnemyAttacks', run(ctx) {
  const phase = ctx.scratch.enemyPhase!;
  phase.actors = planEnemyPhase(ctx.state.board, ctx.state.player.index, phase.displaced).actors;
  return resolveEnemyAttacks(ctx, phase.actors);
} };
const ShamanRites: TurnSystem<TurnContext> = { name: 'ShamanRites', run: ctx => resolveShamanRites(ctx, ctx.scratch.enemyPhase!.actors) };
const CycleCounters = instant<TurnContext>('CycleCounters', ctx => {
  for (const { cell } of ctx.scratch.enemyPhase!.actors) if (cell.variant === 'shaman' && isCellAlive(cell)
    && !cell.behavior.passive && cell.status.frozen === 0) cell.behavior.cycle = (cell.behavior.cycle ?? 0) + 1;
});
const TrollWindups: TurnSystem<TurnContext> = { name: 'TrollWindups', run: ctx => resolveTrollWindups(ctx, ctx.scratch.enemyPhase!.actors) };
const GoalRefresh = instant<TurnContext>('GoalRefresh', ctx => refreshCustomProgress(ctx.state));
const Rotations: TurnSystem<TurnContext> = { name: 'Rotations', run: ctx => resolveRotations(ctx, ctx.scratch.enemyPhase!.displaced) };
const RestCountdown = instant<TurnContext>('RestCountdown', ctx => { for (const { cell } of ctx.scratch.enemyPhase!.resting) cell.behavior.restTurns--; });
const DamageEffectTicks: TurnSystem<TurnContext> = { name: 'DamageEffectTicks', run: resolveDamageEffects };
const TrollRegen: TurnSystem<TurnContext> = { name: 'TrollRegen', run: resolveTrollRegeneration };
const ClosePits: TurnSystem<TurnContext> = { name: 'ClosePits', *run(ctx) {
  const closed = closeExpiredPits(ctx.state);
  if (closed.length) { yield { event: { type: 'pit-close', indices: closed } }; if (!ctx.current()) return false; }
  return true;
} };

/**
 * ItemAction: one consumable, used in place (no enemy answer, the turn does not advance). Frost freezes and makes
 * brittle; healing restores HP and cleanses poison and bleeding; a bomb strikes, fire sets burning stacks.
 */
const ItemResolve: TurnSystem<TurnContext> = { name: 'ItemResolve', *run(ctx) {
  const { kind, index, preview } = ctx.scratch.item!, state = ctx.state;
  state.inventory[kind]--; state.itemPrepared = true;
  if (kind === 'frost') {
    const cell = state.board[index]!;
    cell.status.frozen = Math.max(1, cell.status.frozen); cell.status.brittle = true;
    state.message = 'Цель замёрзла: пропустит действие, следующий удар ×2.';
    yield { event: { type: 'frost', index, text: 'ЗАМОРОЖЕН · ×2' } };
    return true;
  }
  if (kind === 'healing') {
    state.player.hp += preview.healing;
    const cleansing = !!(state.player.damageEffects?.poison || state.player.damageEffects?.bleeding);
    assignDamageEffects(state.player, cleanseDamageEffects(state.player.damageEffects));
    if (cleansing) { yield { event: { type: 'status', index: state.player.index } }; if (!ctx.current()) return false; }
  }
  const damaged = new Set<number>();
  if (kind !== 'healing') for (const targetIndex of preview.indices) {
    const cell = state.board[targetIndex]; if (!cell || damaged.has(cell.id)) continue; damaged.add(cell.id);
    if (kind === 'fire') {
      applyAttackEffect(cell, 'fire', true);
      yield { event: { type: 'status', index: targetIndex, effect: 'fire', amount: 1 } };
      if (!ctx.current()) return false;
      continue;
    }
    const outcome = applyDamage(cell, preview.damage, 'item');
    yield { event: { type: 'hit', index: targetIndex, amount: preview.damage } };
    if (!ctx.current()) return false;
    if (outcome.killed) {
      if (!(yield* defeatCreature(ctx, cell, targetIndex, 'player'))) return false;
      if (cell.elite) (ctx.scratch.lootQueue ??= []).push(cell);
    }
  }
  yield { event: { type: 'item', index, indices: preview.indices, amount: preview.damage || preview.healing, text: ITEMS[kind].label } };
  if (!ctx.current()) return false;
  // Loot of the elites the item killed falls once the item is resolved.
  return yield* dropQueuedLoot(ctx);
} };
/** ItemAction: direct goals met by the item end the battle (frost never ends it). */
const ItemVictory = instant<TurnContext>('ItemVictory', ctx => {
  if (ctx.scratch.item!.kind !== 'frost' && ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) ctx.finish(true);
});
/** ItemAction: emptied cells refill at once, without fresh intents (frost leaves the board as it is). */
const ItemRefill: TurnSystem<TurnContext> = { name: 'ItemRefill', *run(ctx) {
  if (ctx.scratch.item!.kind === 'frost') return true;
  const spawned = ctx.generateBoard(false);
  if (spawned.length) { yield { event: { type: 'spawn', indices: spawned } }; if (!ctx.current()) return false; }
  yield { event: { type: 'state' } };
  return true;
} };

/** Status expiry and turn objectives happen after the effect ticks and before generation. */
const SettleTurn = instant<TurnContext>('SettleTurn', ctx => {
  uniqueEntities(ctx.state.board).forEach(({ cell }) => { if (cell.status.frozen > 0) cell.status.frozen--; });
  ctx.state.objective.turns++; if (!ctx.state.lastDamage) ctx.state.score += 30;
  refreshCustomProgress(ctx.state);
  if (ctx.state.customLevel?.definition.completion === 'direct' && customGoalsMet(ctx.state)) { ctx.finish(true); return; }
  if (ctx.state.customLevel && ctx.state.level.turnLimit > 0 && ctx.state.turn >= ctx.state.level.turnLimit) ctx.finish(false, 'Лимит ходов исчерпан. Попробуй другой маршрут.');
});

/** Refill (with the chain witness), fresh intents and the return to player input. */
const Generation: TurnSystem<TurnContext> = { name: 'Generation', *run(ctx) {
  ctx.state.phase = 'BOARD_UPDATE'; yield { event: { type: 'state' } };
  if (!ctx.current()) return false;
  // The refill is published through the sequence (the command path), not by the facade.
  const spawned = ctx.generateBoard();
  if (spawned.length) { yield { event: { type: 'spawn', indices: spawned } }; if (!ctx.current()) return false; }
  ctx.state.itemPrepared = false;
  yield { event: { type: 'refill' } }; yield { delay: 180 };
  return ctx.current();
} };
const ReturnToInput: TurnSystem<TurnContext> = { name: 'ReturnToInput', *run(ctx) {
  ctx.state.phase = 'PLAYER_INPUT'; ctx.state.message = ctx.hint(); yield { event: { type: 'state' } }; return true;
} };

// ---------------------------------------------------------------- schedule (ECS plan §3.4)

export const ITEM_ACTION: SystemSet<TurnContext> = { name: 'ItemAction', systems: [ItemResolve, ItemVictory, ItemRefill] };
export const PLAYER_ACTION: SystemSet<TurnContext> = { name: 'PlayerAction', systems: [ChainResolve, ChainEndTerrain, DeviceVolleys, PlayerVictory] };
export const REST_ACTION: SystemSet<TurnContext> = { name: 'RestAction', systems: [RestStart] };
export const ENEMY_PHASE: SystemSet<TurnContext> = { name: 'EnemyPhase', systems: [EnemyPhaseStart, PhaseSnapshot, BoarCharges, EnemyAttacks,
  ShamanRites, CycleCounters, TrollWindups, GoalRefresh, Rotations, RestCountdown, DamageEffectTicks, TrollRegen, ClosePits] };
export const END_OF_TURN: SystemSet<TurnContext> = { name: 'EndOfTurn', systems: [SettleTurn] };
export const BOARD_UPDATE: SystemSet<TurnContext> = { name: 'BoardUpdate', systems: [Generation, ReturnToInput] };
/** Everything after the player's own action. */
export const ENEMY_TURN: readonly SystemSet<TurnContext>[] = [ENEMY_PHASE, END_OF_TURN, BOARD_UPDATE];

/**
 * After every system: a restarted scene cancels the turn; a cat at 0 HP loses (if its system did not already
 * finish the battle); a finished battle stops the schedule before any later system.
 */
export function turnVerdict(ctx: TurnContext): ScheduleVerdict {
  if (!ctx.current()) return 'cancelled';
  if (ctx.state.player.hp === 0 && ctx.state.phase !== 'WIN' && ctx.state.phase !== 'LOSE') ctx.finish(false);
  return ctx.state.phase === 'WIN' || ctx.state.phase === 'LOSE' ? 'finished' : 'continue';
}

/**
 * The end of a battle (the facade's `finish` and the forecast's copy alike): phase, cleared selection, the result
 * message and the victory bonus. Publishing `win`/`lose` is the caller's.
 */
export function concludeBattle(state: ForestState, won: boolean, message?: string): void {
  state.phase = won ? 'WIN' : 'LOSE'; state.chain = []; state.chosenAbility = null;
  state.message = message ?? (state.runNode ? won ? 'Узел пройден.' : 'Кот отступил. Повтори узел: запас восстановится как на входе.'
    : won ? 'Цели выполнены. Авторский уровень пройден!' : 'Кот отступил. Повтори уровень.');
  if (won) state.score += state.player.hp * 150 + Math.max(0, 12 - state.turn) * 70;
}

/** A chain or an ability: PlayerAction, then the enemy phase, the end of the turn and the board update. */
export function resolvePlayerTurn(ctx: TurnContext, simulation: ChainSimulation, ability?: AbilityKind): TurnSequence {
  ctx.scratch.action = { simulation, ability, startIndex: ctx.state.player.index, doorOpened: false };
  return runSchedule(ctx, [PLAYER_ACTION, ...ENEMY_TURN], turnVerdict);
}
/** A consumable (validated by the caller): ItemAction alone — no enemy answer. */
export function resolveItemTurn(ctx: TurnContext, kind: ItemKind, index: number, preview: ItemPreview): TurnSequence {
  ctx.scratch.item = { kind, index, preview };
  return runSchedule(ctx, [ITEM_ACTION], turnVerdict);
}
/** Rest: RestAction, then the same enemy phase, end of turn and board update. */
export function resolveRestTurn(ctx: TurnContext): TurnSequence {
  return runSchedule(ctx, [REST_ACTION, ...ENEMY_TURN], turnVerdict);
}

/**
 * Shaman rites after the attacks (shared rule: forestBeasts.ts). Knocked-down shamans are not actors and skip
 * their rite; the event is published once the goblin already has its new step.
 */
export function* resolveShamanRites(ctx: TurnContext, actors: { cell: ForestCell; index: number }[]): TurnSequence {
  if (!actors.some(({ cell }) => cell.intent.empowerIds?.length && shamanActive(ctx.state.board, cell))) return true;
  for (const rite of shamanRites(ctx.state.board, actors)) {
    turnReport(ctx).empowered.push({ shamanId: rite.shaman.id, id: rite.cell.id, index: rite.index, tier: rite.tier });
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
    turnReport(ctx).regenerated.push({ id: cell.id, index, amount });
    cell.hp += amount;
    yield { event: { type: 'regen', index, amount, text: `${cell.hp} HP` } };
    if (!ctx.current()) return false;
    yield { delay: 90 };
    if (!ctx.current()) return false;
  }
  return true;
}
