/**
 * Enemy behaviours (ECS plan, stage 5: docs/ecs-architecture.md §3.4). One entry per enemy definition: how it
 * announces its intent, whether and how it strikes in the enemy phase, and the source of its damage to the cat.
 * The rule kernels (pack, charge, club, rites, arrows) stay in their mechanic modules; a behaviour wires them
 * together, so the intent pass, the attack check, the live phase and the forecast ask the same entry instead of
 * branching on the variant.
 *
 * Intents are prepared by a dispatcher inside one board-order pass (`prepareIntents`): the place and number of RNG
 * draws (the archer's rest swap) stay as they were. Queues shared between enemies (anger, rites) are filled by the
 * pass and resolved after it.
 */
import { canSwapEnemies, meleeTargets, neighbors } from './boardGeometry';
import { ladderAt } from './ladder';
import { BOAR_CHARGE_LENGTH, BOAR_DAMAGE, chargeDirection, chargeLane } from './boarCharge';
import { isCellAlive } from './cellLife';
import { applyDamage, removeDefeated } from './combatRules';
import { definitionOf, type EnemyId } from './enemyDefinitions';
import { meleeCanAttack } from './enemyLifecycle';
import { SHAMAN_PERIOD, shamanTargets, wolfHasPack, WOLF_DAMAGE, type BeastWorld } from './forestBeasts';
import type { ForcedDeathCause, ForestCell, ForestState, HeroDamageSource } from './forestTypes';
import { canFireArrowHit } from './recovered/combat';
import { updateShieldDir, type EnemyActor } from './recovered/enemies';
import { recoveredMoveTowards } from './recoveredEnemyMovement';
import { walkableTerrain } from './terrain';
import { ELITE_MOVE_EVERY, ELITE_MOVEMENT, ELITE_RETREAT_DISTANCE } from './elite';
import { uniqueEntities } from './entityFootprint';
import { clubImpacts, clubZone, swingClub, TROLL_CLUB_DAMAGE, trollBody } from './troll';

/** Shared data of one intent pass. */
export interface IntentPass {
  readonly state: ForestState;
  readonly rand: (min: number, max: number) => number;
  /** Calm melee enemies that may join the anger queue after the pass (`angerPerTurn`). */
  readonly anger: { index: number; distance: number; id: number }[];
  /** Shamans whose rites are announced after the anger queue (`announceRites`). */
  readonly rites: number[];
  /** Cells already taken by an announced rotation this pass. */
  readonly paired: Set<number>;
}

/** A creature struck besides the cat (arrows, the club). */
export interface StrikeImpact { index: number; cell: ForestCell; damage: number; killed: boolean }
/** What a `strike` attack hits besides its announced target; shared by the live phase and the forecast. */
export interface Strike {
  /** Extra payload of the published attack event: the Jailer's swept cells, the club zone. */
  readonly event?: { indices: number[]; amount?: number; text?: 'club' };
  /** Text of the cat's damage event and of the creature hit and kill events. */
  readonly text?: 'club';
  /** Creatures on the struck cells and the cause recorded for their deaths. `impacts` mutates the board it receives. */
  readonly creatures?: { readonly impacts: (board: (ForestCell | null)[]) => Iterable<StrikeImpact>; readonly cause: ForcedDeathCause };
}
export interface EnemyAttackRule {
  /** `melee`: a swing at the cat beside it (`resolveMeleeAttack`); `strike`: its announced cells are struck. */
  readonly style: 'melee' | 'strike';
  /** Spends its action even when the cat is not on the announced cells. */
  readonly firesOnMiss?: boolean;
  /** Source of the cat's damage (damage breakdown, `applyDamage`). */
  readonly source: HeroDamageSource;
  /** Rests one turn after the strike (live phase). */
  readonly restsAfter?: boolean;
  /** The strike at the moment it happens. It may change the attacker at once (the troll rests, its zone is spent). */
  readonly strike?: (cell: ForestCell) => Strike;
}

export interface EnemyBehavior {
  /**
   * Runs before the passivity check, armed or not: quills are not a weapon, the shield-bearer turns its shield
   * every turn. `true` ends the preparation.
   */
  readonly beforePassive?: (pass: IntentPass, cell: ForestCell, index: number) => boolean;
  /** Intent of an armed enemy, prepared in board order. */
  readonly intent?: (pass: IntentPass, cell: ForestCell, index: number) => void;
  /**
   * Extra strike condition beyond the shared ones (alive, armed, not frozen, not resting). With `world` (the live
   * state or the forecast copy) it may judge the board now; without it only the announcement is judged.
   * The forecast lists an announced strike at the cat that the world now cancels as `packBroken` and the interface
   * shows it as a broken wolf pack: only the wolf judges the world today. A new world-dependent condition needs its
   * own forecast field.
   */
  readonly canStrike?: (cell: ForestCell, index: number, world?: BeastWorld) => boolean;
  /** Absent: never strikes in the attack step (the boar charges, the porcupine and the shaman do not attack). */
  readonly attack?: EnemyAttackRule;
}

const MELEE: EnemyAttackRule = { style: 'melee', source: 'melee' };

/** Ordinary goblin: swings once angry; a calm one may join the anger queue, nearest first. */
function goblinIntent({ state, anger }: IntentPass, cell: ForestCell, index: number) {
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
  anger.push({ index, distance, id: cell.id });
}
/** Announced anger: the same swing a goblin prepares for itself. */
export function angerIntent(state: ForestState, cell: ForestCell, index: number) {
  cell.countdown = 1;
  cell.behavior.aggressive = true;
  cell.intent = { cells: meleeTargets(state, index), damage: 1, label: 'Замах' };
}

/** Archer: shoots along the straight lane toward the cat; a resting archer may announce a swap with a neighbour. */
function archerIntent({ state, rand, paired }: IntentPass, cell: ForestCell, index: number) {
  if (cell.behavior.restTurns > 0) {
    cell.intent.label = 'Отдых';
    // A resting elite archer retreats instead of rotating toward the cat (announceEliteMoves).
    if (paired.has(index) || cell.elite) return;
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
}
/** Arrows strike every creature standing on the announced cells, not only the cat. Doors and prisms are untouched. */
export function* archerVolley(board: (ForestCell | null)[], archer: ForestCell): Generator<StrikeImpact> {
  const struck = new Set<number>();
  for (const index of archer.intent.cells) {
    const cell = board[index];
    if (!cell || cell === archer || cell.kind === 'door' || cell.kind === 'prism' || struck.has(cell.id) || !isCellAlive(cell)) continue;
    struck.add(cell.id);
    const outcome = applyDamage(cell, archer.intent.damage, 'hazard');
    if (outcome.killed) removeDefeated(board, cell);
    yield { index, cell, damage: outcome.damage, killed: outcome.killed };
  }
}

/** A boss sweep: the neighbours on the side facing the cat. */
function sweepIntent(state: ForestState, cell: ForestCell, index: number, damage: number, label: string) {
  const dx = state.player.index % state.cols - index % state.cols, dy = Math.floor(state.player.index / state.cols) - Math.floor(index / state.cols);
  const horizontal = Math.abs(dx) >= Math.abs(dy), sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  cell.intent.cells = neighbors(state, index).filter(target => horizontal ? target % state.cols - index % state.cols === sign : Math.floor(target / state.cols) - Math.floor(index / state.cols) === sign);
  cell.countdown = 1; cell.intent.damage = damage; cell.intent.label = label; state.bossWarning = [...cell.intent.cells];
}

const GOBLIN: EnemyBehavior = { intent: goblinIntent, attack: MELEE };
const ARCHER: EnemyBehavior = {
  intent: archerIntent,
  attack: { style: 'strike', firesOnMiss: true, source: 'ranged', restsAfter: true,
    strike: archer => ({ creatures: { impacts: board => archerVolley(board, archer), cause: 'arrow' } }) },
};
const CHIEF: EnemyBehavior = {
  intent: ({ state }, cell, index) => {
    sweepIntent(state, cell, index, 1, 'Взмах котелком');
    // Ladder step 10: the sweep also reaches every diagonal neighbour (the side toward the cat plus the four corners).
    if (!ladderAt(state, 10)) return;
    const col = index % state.cols, row = Math.floor(index / state.cols);
    const corners = neighbors(state, index).filter(target => target % state.cols !== col && Math.floor(target / state.cols) !== row);
    cell.intent.cells = [...new Set([...cell.intent.cells, ...corners])]; state.bossWarning = [...cell.intent.cells];
  },
  attack: { style: 'strike', source: 'boss' },
};
/** Prism: no intent, no attack. */
const PRISM: EnemyBehavior = {};

/** Shield-bearer: a goblin whose shield turns toward the cat every turn, armed or not (decision of 30.09.2026). */
const SENTINEL: EnemyBehavior = {
  beforePassive({ state }, cell, index) {
    const actor: EnemyActor = { subtype: 4, kind: 1, power: cell.hp, col: index % state.cols, row: Math.floor(index / state.cols), face_dir: 1, attack_mode: 0, properties: {} };
    updateShieldDir(actor, state.player.index % state.cols, Math.floor(state.player.index / state.cols), {
      remove: (enemy, prop) => { delete enemy.properties[prop]; }, set: (enemy, prop, value) => { enemy.properties[prop] = value; }, spriteIndex: () => 0,
    });
    cell.shield = { dx: actor.properties[249] ?? 0, dy: actor.properties[250] ?? 0 };
    return false;
  },
  intent: goblinIntent,
  attack: MELEE,
};

/** Jailer: a heavy sweep; frost or rest lowers its shield (`shieldIsActive`) and skips the turn. */
const JAILER: EnemyBehavior = {
  intent({ state }, cell, index) {
    cell.shield ??= { dx: 0, dy: 1 };
    if (cell.status.frozen > 0 || cell.behavior.restTurns > 0) {
      cell.intent = { cells: [], damage: 0, label: cell.status.frozen > 0 ? 'Заморожен · щит опущен' : 'Отдых · щит опущен' };
      return;
    }
    sweepIntent(state, cell, index, 2, 'Тяжёлый удар');
  },
  attack: { style: 'strike', firesOnMiss: true, source: 'boss', restsAfter: true,
    strike: jailer => ({ event: { indices: [...jailer.intent.cells] } }) },
};

/** Boar: announced now, the charge runs at the start of the next enemy phase (boarCharge.ts). */
const BOAR: EnemyBehavior = {
  intent({ state }, cell, index) {
    if (cell.status.frozen > 0) { cell.intent.label = 'Заморожен'; return; }
    if (cell.behavior.restTurns > 0) { cell.intent.label = 'Оглушён'; return; }
    const direction = chargeDirection(state.cols, index, state.player.index), lane = chargeLane(state, index, direction, BOAR_CHARGE_LENGTH);
    if (!lane.length) { cell.intent.label = 'Упёрся'; return; }
    cell.countdown = 1;
    cell.intent = { cells: lane, damage: BOAR_DAMAGE, label: 'Рывок', charge: { ...direction, length: BOAR_CHARGE_LENGTH } };
  },
};

/** Wolf: a living neighbouring wolf arms it and makes it angry; a lone wolf stays passive (forestBeasts.ts). */
const WOLF: EnemyBehavior = {
  intent({ state }, cell, index) {
    const pack = wolfHasPack(state, index);
    cell.behavior.aggressive = pack;
    if (pack && meleeCanAttack(cell)) {
      cell.countdown = 1;
      cell.intent = { cells: meleeTargets(state, index), damage: WOLF_DAMAGE, label: 'Стая · замах' };
    } else cell.intent.label = !pack ? 'Одинок' : cell.status.frozen > 0 ? 'Заморожен' : 'Стая · отдых';
  },
  // A pack broken before the strike (a chain, an arrow or a charge took the neighbour) disarms the wolf.
  canStrike: (_cell, index, world) => !world || wolfHasPack(world, index),
  attack: MELEE,
};

/** Porcupine: quills only (a chain-hit observer); a lesson porcupine without `armed` still shows them. */
const PORCUPINE: EnemyBehavior = {
  beforePassive(_pass, cell) { cell.intent.label = cell.status.frozen > 0 ? 'Заморожен · без игл' : 'Иглы'; return true; },
};

/** Shaman: never joins the anger queue; its rite is announced after it (`announceRites`). */
const SHAMAN: EnemyBehavior = {
  intent({ rites }, cell, index) { cell.intent = { cells: [], damage: 0, label: 'Готовит камлание' }; rites.push(index); },
};
/**
 * Shaman rites are announced after the anger queue, so the targets' steps are final for this turn. One step per
 * target per phase: a goblin announced by one shaman is not announced by another.
 */
export function announceRites({ state, rites }: IntentPass) {
  const claimed = new Set<number>();
  for (const index of rites) {
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

/**
 * Elite movement (decision of 01.10.2026), after the anger queue and the rites so every intent is final: an elite that
 * does not strike, charge, shoot or perform a rite this turn announces an exchange with a side neighbour (the archer's
 * rotation rules: `canSwapEnemies`, `paired`, `state.rotations`, cardinal geometry) — melee closes in on the cat (to
 * a neighbour strictly nearer, Chebyshev) when the cat is out of its reach, ranged retreats while the cat is closer
 * than 3 cells. Ties are drawn from the battle RNG. Frozen, resting (except a resting
 * archer, who retreats instead of its rotation) and passive elites stay; defensive ones hold (`ELITE_MOVEMENT`).
 * Ordinary enemies never close in. Every `ELITE_MOVE_EVERY` turns; draws of the battle RNG come in board order.
 */
export function announceEliteMoves({ state, rand, paired }: IntentPass) {
  if (ELITE_MOVE_EVERY <= 0 || state.turn % ELITE_MOVE_EVERY !== 0) return;
  const cols = state.cols, hero = state.player.index;
  const distance = (a: number, b: number) => Math.max(Math.abs(a % cols - b % cols), Math.abs(Math.floor(a / cols) - Math.floor(b / cols)));
  const sides = (index: number) => [index - cols, index + 1, index + cols, index - 1].filter(target => target >= 0 && target < cols * state.rows
    && (target % cols === index % cols || Math.floor(target / cols) === Math.floor(index / cols)) && distance(index, target) === 1);
  const swappable = (index: number, target: number) => !paired.has(target) && canSwapEnemies(state, index, target);
  for (const { cell, index } of uniqueEntities(state.board)) {
    const id = definitionOf(cell)?.id;
    if (!cell.elite || !id || !isCellAlive(cell) || cell.status.frozen > 0 || cell.behavior.passive || paired.has(index)) continue;
    const mode = ELITE_MOVEMENT[id];
    let target = index, label = '';
    if (mode === 'close') {
      // The cat in reach (announced strike or a side neighbour, armed or not), a charge or a rest: no closing in.
      if (cell.behavior.restTurns > 0 || cell.intent.charge || cell.intent.cells.includes(hero) || meleeTargets(state, index).includes(hero)) continue;
      // Only a neighbour strictly nearer to the cat; the nearest, a tie by the battle RNG; none — the elite stands.
      const near = distance(index, hero), closer = sides(index).filter(side => swappable(index, side) && distance(side, hero) < near);
      if (!closer.length) continue;
      const nearest = Math.min(...closer.map(side => distance(side, hero))), best = closer.filter(side => distance(side, hero) === nearest);
      target = best.length > 1 ? best[rand(0, best.length)] : best[0]; label = 'Сближение';
    } else if (mode === 'retreat') {
      // An archer retreats in its rest turn (it shoots otherwise); a shaman in a turn without a rite.
      if (id === 'archer' ? cell.behavior.restTurns === 0 : cell.behavior.restTurns > 0 || !!cell.intent.empowerIds?.length) continue;
      const near = distance(index, hero);
      if (near > ELITE_RETREAT_DISTANCE) continue;
      const away = sides(index).filter(side => swappable(index, side) && distance(side, hero) > near);
      if (!away.length) continue;
      const farthest = Math.max(...away.map(side => distance(side, hero)));
      const best = away.filter(side => distance(side, hero) === farthest);
      target = best.length > 1 ? best[rand(0, best.length)] : best[0];
      label = id === 'archer' ? 'Отдых · отступление' : 'Отступление';
    } else continue;
    if (target === index) continue;
    const partner = state.board[target]!;
    cell.countdown = 1;
    cell.intent = { cells: [], damage: 0, label, moveTo: target, swapWithId: partner.id };
    paired.add(index); paired.add(target);
    state.rotations.push({ from: index, to: target, sourceId: cell.id, targetId: partner.id, geometry: 'cardinal' });
  }
}

/**
 * Troll: windup → strike → rest (troll.ts). The zone is chosen toward the cat when the windup is announced and
 * kept until the strike; frost and rest pause the cycle without losing it.
 */
const TROLL: EnemyBehavior = {
  intent({ state }, cell) {
    cell.intent = { cells: [], damage: 0, label: 'Отдых' };
    if (cell.behavior.restTurns > 0) { if (cell.status.frozen > 0) cell.intent.label = 'Заморожен · отдых'; return; }
    if (cell.status.frozen > 0) { cell.intent.label = cell.behavior.club?.raised ? 'Заморожен · удар удержан' : 'Заморожен'; return; }
    if (!cell.behavior.club) cell.behavior.club = { ...clubZone(state, trollBody(state.board, cell), state.player.index), raised: false };
    const club = cell.behavior.club;
    cell.countdown = club.raised ? 1 : 2;
    cell.intent = { cells: [...club.cells], damage: TROLL_CLUB_DAMAGE, label: club.raised ? 'Удар дубиной' : 'Замах дубиной' };
  },
  // It strikes only once its windup phase has passed; the windup itself is not an attack.
  canStrike: cell => !!cell.behavior.club?.raised,
  attack: { style: 'strike', firesOnMiss: true, source: 'troll',
    // The club falls on every creature in its zone, enemies included.
    strike(troll) {
      const club = swingClub(troll);
      return { event: { indices: [...club.zone], amount: club.damage, text: 'club' }, text: 'club',
        creatures: { impacts: board => clubImpacts(board, troll, club.zone, club.damage), cause: 'club' } };
    } },
};

const BEHAVIORS: Record<EnemyId, EnemyBehavior> = {
  goblin: GOBLIN, archer: ARCHER, chief: CHIEF, prism: PRISM,
  sentinel: SENTINEL, jailer: JAILER, boar: BOAR, wolf: WOLF, porcupine: PORCUPINE, shaman: SHAMAN, troll: TROLL,
};

/** Behaviour of a stored enemy; none for doors. */
export function behaviorOf(cell: Pick<ForestCell, 'kind' | 'variant'> | null | undefined): EnemyBehavior | undefined {
  const definition = definitionOf(cell);
  return definition && BEHAVIORS[definition.id];
}
