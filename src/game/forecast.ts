/**
 * Forecast = the live turn on a copy (ECS plan, stage 6: docs/ecs-architecture.md §3.7). The action plan (`planChain`,
 * `planAbility` in forestSystems.ts) decides what the player's action does — the hits, the crystals, the levers — and
 * execution replays that plan. Everything after it is not resolved a second time: the same turn systems
 * (turnSystems.ts) run on a copy of the world, synchronously, and the preview is projected from what they did — the
 * cat's damage by source (`traceHeroDamage`), the turn report the systems keep (charges, threats, broken packs,
 * forced deaths, rites, regeneration, rotations) and the final position (death, effects, victory).
 *
 * The copy has its own RNG resource (a copy of the live one) and stand-in IDs; the live world, RNG and ID allocator
 * are never touched. The board update (refill, fresh intents) is not forecast.
 */
import { HERO_MOVE_ID } from './boarCharge';
import { killCreature, traceHeroDamage } from './combatRules';
import { cloneEntities, cloneWorld, type World } from './ecs/world';
import { runSchedule } from './ecs/schedule';
import { hasDamageEffects } from './effectRules';
import type { DamageEffects } from './damageEffects';
import type { AbilityKind, ChainPreview, ChargeDamageCause, EnemyPhaseForecast, ForestCell, ForestState, HeroDamageSource } from './forestTypes';
import type { ChainSimulation } from './forestSystems';
import { nextRandom } from './mapBattleRules';
import { rotationPreview } from './rotations';
import { drainSync } from './turnRuntime';
import { concludeBattle, END_OF_TURN, ENEMY_PHASE, PLAYER_ACTION, REST_ACTION, turnReport, turnVerdict, type TurnContext } from './turnSystems';

/** The only way a forecast adds cat damage: the total and its source stay in step. */
export function hurt(preview: ChainPreview, source: HeroDamageSource, amount: number) {
  preview.damage += amount; preview.damageBySource[source] += amount;
}
const TICK_SOURCES: readonly HeroDamageSource[] = ['burning', 'poison', 'bleeding'];

/** A record standing in for an entity the live turn would create (a crystal, a rotation replacement). */
export function standInCell(state: Pick<ForestState, 'terrain'>, index: number, id: number, kind: 'prism' | 'melee'): ForestCell {
  const hp = kind === 'prism' ? 1 : 0;
  return { id, kind, color: kind === 'prism' ? null : 0, hp, maxHp: hp, armor: 0, countdown: 2, ...(kind === 'prism' ? { crystalChain: 0 } : {}),
    status: { wet: state.terrain[index] === 'puddle', frozen: 0, brittle: false }, behavior: { aggressive: false, restTurns: 0 },
    intent: { cells: [], damage: 1, label: 'Готовится' } };
}

/**
 * Services of the turn systems on a forecast copy: the copy's RNG resource, stand-in IDs for created entities,
 * the shared end-of-battle rule. Rotation replacements are stand-ins: the forecast never shows them, and the live
 * turn draws their colours from the battle RNG it does not touch here.
 */
function forecastContext(world: World): TurnContext {
  const state = world.state;
  // Crystals take the plan's stand-in IDs (-1, -2, … in falling order); rotation replacements their own range.
  let nextCrystal = -1, nextStandIn = -1_000_000;
  return {
    world, state, scratch: {},
    current: () => true,
    drawRandom: () => { const draw = nextRandom(world.res.rng); world.res.rng = draw.state; return draw.value; },
    cmd: {
      kill: (cell, index, credit) => killCreature(state, cell, index, credit),
      placeCrystal: (index, value) => {
        const crystal = standInCell(state, index, nextCrystal--, 'prism'); crystal.crystalChain = value;
        state.board[index] = crystal; return crystal;
      },
      // Loot shares the crystals' stand-in IDs, in falling order, as the plan does.
      placeLoot: (index, item) => {
        const loot = standInCell(state, index, nextCrystal--, 'prism'); loot.loot = item;
        state.board[index] = loot; return loot;
      },
    },
    finish: (won, message) => concludeBattle(state, won, message),
    planRotationReplacements: rotations => {
      const replacements = new Map<number, ForestCell>();
      for (const plan of rotations.filter(plan => plan.active)) for (const index of [plan.from, plan.to]) {
        if (!state.board[index] && !replacements.has(index)) replacements.set(index, standInCell(state, index, nextStandIn--, 'melee'));
      }
      return replacements;
    },
    generateBoard: () => [],
    hint: () => '',
  };
}

/** What the forecast resolves: a planned chain or ability, or Rest. */
export type ForecastAction = { simulation: ChainSimulation; ability?: AbilityKind } | { rest: true };

/**
 * Fill the consequences of a valid planned action into its preview: run the action, the enemy phase and the end of
 * the turn on a copy of `state`. `rng` is a copy of the live battle RNG (crystals falling during the chain draw
 * from it as execution will); `movementEffects` are the cat's effects after the planned steps.
 */
export function forecastConsequences(state: ForestState, preview: ChainPreview, action: ForecastAction, rng: number | undefined,
  movementEffects: DamageEffects | undefined): void {
  // Exact damage (decision Г, 01.10.2026): capped by the cat's HP, nothing counted after its death.
  const effectAwareOn = (board: readonly (ForestCell | null)[]) => hasDamageEffects(state.player) || !!state.player.attackEffect
    || board.some(cell => cell && (hasDamageEffects(cell) || cell.attackEffect));
  if (preview.playerDies) { preview.rotations = []; return; }
  // The copy's own resources: a copy of the live RNG; IDs are stand-ins, never allocated.
  const world = cloneWorld({ state, res: { rng: rng ?? 0, nextId: 0 } });
  const sim = world.state, trace = traceHeroDamage(sim), ctx = forecastContext(world);
  if ('simulation' in action) {
    // The copy replays the plan; its board is copied so the plan stays as execution will receive it.
    const simulation = { ...action.simulation, board: cloneEntities(action.simulation.board) };
    ctx.scratch.action = { simulation, ability: action.ability, startIndex: sim.player.index, doorOpened: false };
  }
  drainSync(runSchedule(ctx, ['simulation' in action ? PLAYER_ACTION : REST_ACTION], turnVerdict));
  // Lever volleys as the copy resolved them: an elite's loot falling after one volley may change the next (the plan
  // resolves the volleys without loot).
  if ('simulation' in action && action.simulation.queuedDevices?.length && preview.trapHits) {
    const report = turnReport(ctx);
    preview.trapHits = report.trapHits; preview.trapKills = report.trapKills; preview.pitCells = report.pitCells; preview.pitImmuneCells = report.pitImmuneCells;
  }
  // The copy is the turn as it will run: where it ends the battle with the action itself, so does the preview (an
  // incomplete one-enemy path that already meets the goals, which the plan does not mark as a victory).
  if (sim.phase === 'LOSE') { preview.playerDies = true; preview.completesRoom = false; delete preview.opensDoor; preview.rotations = []; return; }
  if (sim.phase === 'WIN') preview.completesRoom = true;
  else if (preview.completesRoom) preview.completesRoom = false;
  if (preview.completesRoom) {
    // The battle ends with the player's action: no enemy answer.
    preview.rotations = [];
    if (effectAwareOn(sim.board)) { preview.movementDamage ??= 0; preview.effectDamage = 0; preview.endEffects = movementEffects; }
    preview.playerDies = preview.damage >= state.player.hp;
    return;
  }
  const effectAware = effectAwareOn(sim.board);
  if (effectAware) { preview.movementDamage ??= 0; preview.effectDamage = 0; }
  // Damage of the action itself is already in the plan's preview; the enemy answer starts here.
  const answeredFrom = trace.length;
  const phase: EnemyPhaseForecast = { heroIndex: sim.player.index, charges: [], rams: [], moves: [], deaths: [], knockedDown: [], packBroken: [], empowered: [], regenerated: [] };
  let afterCharges = new Set<number>();
  drainSync(runSchedule(ctx, [ENEMY_PHASE, END_OF_TURN], turnVerdict, system => {
    if (system.name !== 'BoarCharges') return;
    phase.heroIndex = sim.player.index;
    afterCharges = new Set(sim.board.flatMap(cell => cell ? [cell.id] : []));
  }));
  const report = turnReport(ctx), displaced = ctx.scratch.enemyPhase?.displaced ?? new Set<number>();
  // Charges: the impacts as the live charge resolved them.
  const firstFrom = new Map<number, number>(), lastTo = new Map<number, number>();
  const chargeBreakdown: Record<ChargeDamageCause, number> = { ram: 0, spikes: 0, thorns: 0, pit: 0 };
  let chargeDamage = 0, chargeBoar = -1;
  for (const impact of report.chargeImpacts) {
    if ((impact.kind === 'ram' || impact.kind === 'crush') && impact.heroDamage !== undefined) {
      chargeDamage += impact.heroDamage; chargeBreakdown[impact.kind === 'ram' ? 'ram' : impact.cause] += impact.heroDamage;
    }
    if (impact.kind === 'start') chargeBoar = impact.boar.id;
    if (impact.kind === 'ram') phase.rams.push({ boarId: chargeBoar, id: impact.cell?.id ?? HERO_MOVE_ID, index: impact.index, damage: impact.damage, killed: impact.killed, shielded: impact.shielded });
    if (impact.kind === 'shift') for (const move of [...impact.moves, { id: impact.boarId, from: impact.from, to: impact.to }]) {
      if (!firstFrom.has(move.id)) firstFrom.set(move.id, move.from);
      lastTo.set(move.id, move.to);
    }
    if (impact.kind === 'end') phase.charges.push({ boarId: impact.boarId, from: impact.from, to: impact.index, stunned: impact.moved === 0 });
  }
  phase.moves = [...lastTo].map(([id, to]) => ({ id, from: firstFrom.get(id)!, to }));
  phase.knockedDown = [...displaced].filter(id => id !== HERO_MOVE_ID && !phase.charges.some(charge => charge.boarId === id) && afterCharges.has(id));
  preview.enemyPhase = phase;
  if (chargeDamage) { preview.chargeDamage = chargeDamage; preview.chargeBreakdown = chargeBreakdown; hurt(preview, 'charge', chargeDamage); }
  // Attacks and end-of-turn ticks, by source, as the copy applied them.
  for (const entry of trace.slice(answeredFrom)) {
    if (entry.cause === 'charge') continue;
    hurt(preview, entry.cause, entry.damage);
    if (effectAware && TICK_SOURCES.includes(entry.cause)) preview.effectDamage! += entry.damage;
  }
  preview.threats.push(...report.threats);
  phase.deaths = report.deaths; phase.packBroken = report.packBroken; phase.empowered = report.empowered; phase.regenerated = report.regenerated;
  const dies = sim.player.hp === 0;
  // Rotations as the rotation step judged them; a cat that dies before that step stops them all.
  preview.rotations = report.rotations ?? rotationPreview(sim, sim.board, sim.player.index, displaced);
  if (dies && !report.rotations) preview.rotations = preview.rotations.map(plan => ({ ...plan, active: false, reason: 'Кот погибнет до обмена.' }));
  if (effectAware) preview.endEffects = sim.player.damageEffects ? { ...sim.player.damageEffects } : undefined;
  preview.playerDies = dies;
  // Authored goals met at the end of the turn (forced deaths credited, the turn counted) while the cat lives.
  if ((sim.phase as ForestState['phase']) === 'WIN') phase.completesObjective = true;
}
