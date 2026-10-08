/**
 * Tunable numbers of the real-time simulation (docs/realtime-prototype.md, sections 8, 9a and 11).
 * Every value is a debug-panel control; the view stores them in localStorage (view/paramStorage.ts).
 * Stage marks which prototype stage introduced the value (all stages are implemented).
 * No DOM here: the simulation (src/realtime/sim) runs in Node too.
 */
import type { ArenaTemplate } from './arenas';
import type { Rng } from './rng';

export type DimMode = 'darken' | 'alpha' | 'desaturate';
export type EnemyLook = 'circle' | 'sprite';
export type InvulnerabilityMode = 'constant' | 'byDamage';
export type SpawnPlace = 'edges' | 'edgesAndInside';
export type GroupColor = 'mixed' | 'mono';

/**
 * One phase of the arena pressure table (Vampire Survivors style, design answer 23).
 * The table runs only in the greed stage — after the arena goals are done (user decision
 * 07.10.2026); before that the base pace applies. Phases run in order; the last one holds.
 */
export interface Phase {
  /** Seconds of game time. */
  duration: number;
  /** Density floor: with fewer living enemies (plus markers and queue) the gap is queued at once. */
  floor: number;
  /** Seconds between groups: uniform in [intervalMin, intervalMax]. */
  intervalMin: number;
  intervalMax: number;
  /** Share of tough enemies (1–2 HP) among newcomers. */
  toughShare: number;
  /** Share of groups that come as a wolf pack (stage 3; replaces the stage 1 «fast» share). */
  wolfShare: number;
  /** Share of boars among the other newcomers (stage 3; capped by `boarMax` on the arena). */
  boarShare: number;
}

export const PHASE_FIELDS: readonly { key: keyof Phase; label: string; min: number; max: number; step: number; percent?: boolean }[] = [
  { key: 'duration', label: 'с', min: 5, max: 300, step: 5 },
  { key: 'floor', label: 'пол', min: 0, max: 150, step: 1 },
  { key: 'intervalMin', label: 'инт. от', min: 0.2, max: 20, step: 0.1 },
  { key: 'intervalMax', label: 'до', min: 0.2, max: 20, step: 0.1 },
  { key: 'toughShare', label: 'креп. %', min: 0, max: 1, step: 0.05, percent: true },
  { key: 'wolfShare', label: 'стаи %', min: 0, max: 1, step: 0.05, percent: true },
  { key: 'boarShare', label: 'кабан %', min: 0, max: 1, step: 0.01, percent: true },
];

/**
 * Default table: build-up, a breather (phase 3), then the squeeze. Iteration 2, stage B: every floor is at
 * least the floor before the goals (`baseFloor`, 28) — greed never thins the arena; the breather keeps
 * the base floor and only slows the groups (stage 1–3 floors were 6, 12, 4, 20, 30).
 */
export const DEFAULT_PHASES: readonly Phase[] = Object.freeze([
  { duration: 25, floor: 30, intervalMin: 3, intervalMax: 5, toughShare: 0.2, wolfShare: 0.15, boarShare: 0.05 },
  { duration: 25, floor: 34, intervalMin: 2.5, intervalMax: 4, toughShare: 0.25, wolfShare: 0.2, boarShare: 0.06 },
  { duration: 20, floor: 28, intervalMin: 5, intervalMax: 7, toughShare: 0.2, wolfShare: 0.1, boarShare: 0 },
  { duration: 30, floor: 40, intervalMin: 2, intervalMax: 3.5, toughShare: 0.3, wolfShare: 0.25, boarShare: 0.08 },
  { duration: 30, floor: 48, intervalMin: 1.5, intervalMax: 3, toughShare: 0.4, wolfShare: 0.3, boarShare: 0.1 },
].map(p => Object.freeze(p)));

export interface Params {
  // Hero and damage
  heroHp: number;
  heroHitFactor: number;
  contactDamage: number;
  invulnerabilityMode: InvulnerabilityMode;
  /** Stage F (user 07.10.2026): game seconds of invulnerability after a chain that killed (to walk out of the crowd). */
  chainShield: number;
  /** Kills a chain needs to give that invulnerability. */
  chainShieldMinKills: number;
  invulnerability: number;
  touchFactor: number;
  brakeStrength: number;
  brakeRecovery: number;
  // Hero walking (iteration 2, stage A): WASD / arrows, solid against obstacles and (toggle) enemies
  heroSpeed: number;
  heroThroughEnemies: boolean;
  /** Stage D: walking multiplier while the hero's circle overlaps an enemy body (only with `heroThroughEnemies`); stacks with water only. */
  crowdSlow: number;
  // Enemies
  /** Art radius at size 1 (`enemyScale` scales it: `enemyDrawRadius`). */
  enemyRadius: number;
  /** Body radius at size 1 (`enemyScale` scales it: `enemyBodyRadius`); the hero circle is a share of this unscaled value. */
  bodyRadius: number;
  /** Stage D (user 07.10.2026): enemy size — art, body, touch zone and pushing of every kind (basic, wolf, boar, reaper). */
  enemyScale: number;
  enemySpeed: number;
  speedSpread: number;
  /** Iteration 2: the flow field leads enemies around obstacles (off — straight at the hero, as in stages 1–3). */
  pathfinding: boolean;
  /** Flow field rebuilds per game second. */
  flowRate: number;
  /** How fast an enemy turns to the field direction (1/s): smooths the 8-direction grid. */
  flowTurn: number;
  /** Stage B (design answer 39): enemies in a cell make it dearer, so the crowd spreads instead of queueing (off). */
  flowDensity: boolean;
  /** Extra cost of a cell per enemy standing in it. */
  flowDensityCost: number;
  /** Stage B: walking speed multiplier in the pond (hero and enemies walking; not the charge, dash or jump — design answer 41). */
  waterSlow: number;
  // Crystals (stage C): a colour-change crystal for every N kills of one chain, as in the main game
  crystals: boolean;
  crystalEvery: number;
  /** Game seconds a crystal lies on the arena; 0 — until a chain breaks it. */
  crystalLife: number;
  /** Score for breaking a crystal = this × kills of the chain that dropped it (main game: 20). */
  crystalScorePerKill: number;
  /** Radius around the kill where the crystal falls; 0 — anywhere on the arena (design 07.10.2026: keep the combo at the same crowd). */
  crystalDropRadius: number;
  // Chain juice (stage C): every effect is a toggle
  comboCounter: boolean;
  hitstop: boolean;
  hitstopMin: number;
  hitstopMax: number;
  hitstopGrowth: number;
  finisher: boolean;
  finisherLinks: number;
  finisherTime: number;
  finisherSlow: number;
  chainScoreMultiplier: boolean;
  scorePerKill: number;
  scoreLengthBonus: number;
  sound: boolean;
  soundVolume: number;
  // Wolves (stage 3): fast, hit harder next to other wolves, come in packs
  wolfSpeed: number;
  wolfPackMin: number;
  wolfPackMax: number;
  wolfPackRadius: number;
  wolfPackBonus: number;
  wolfPackMono: boolean;
  // Spawning before the goals (base pace, no growth)
  /** Stage B: density floor before the goals — fewer living enemies (with markers and queue) are topped up at once. */
  baseFloor: number;
  baseIntervalMin: number;
  baseIntervalMax: number;
  baseToughShare: number;
  baseWolfShare: number;
  baseBoarShare: number;
  // Greed stage after the goals: pressure table `phases`
  phases: Phase[];
  // Spawning, both stages
  groupMin: number;
  groupMax: number;
  spawnPlace: SpawnPlace;
  groupColor: GroupColor;
  maxEnemies: number;
  markerDelay: number;
  spawnMinDistance: number;
  // Growth over time and the time limit
  angerTierSeconds: number;
  angerSpeedStep: number;
  reaperEnabled: boolean;
  reaperTime: number;
  reaperSpeed: number;
  reaperDamage: number;
  // Arena goals (stage 3)
  killGoal: number;
  markedSpeed: number;
  // Effects
  hitFlash: number;
  shakeOnDamage: boolean;
  shakeAmplitude: number;
  shakeDuration: number;
  deathDuration: number;
  dashShake: number;
  // Chain (stage 2)
  linkRadius: number;
  /** Stage G (user 07.10.2026): R reaches the edge of a target — enemy art circle, object circle — not its center. */
  linkToEdge: boolean;
  /** Stage G: the next link is also taken within R of the hero (second anchor), not only of the last link. */
  heroAnchor: boolean;
  lineOfSight: boolean;
  /** Stage G: obstacles shrink by this much for the link sight ray — a ray grazing a tree or a wall corner still sees (0 — exact). */
  sightSlack: number;
  pickSlack: number;
  /** Stage G: a fast drag takes the links under the whole pointer path, not only under the sampled pointer events. */
  dragSweep: boolean;
  /** Stage G: while the button is held, an enemy that walks (or comes into reach) under a still pointer joins the chain. */
  holdPicks: boolean;
  /** Stage G: a short reason at the pointer why the enemy or object under it cannot be the next link. */
  refusalHint: boolean;
  /** Stage G: after the goals the hero enters the open door by touching it while walking (a chain and a jump still work). */
  doorWalkIn: boolean;
  /** Stage H (user 08.10.2026): the pointer on the second-to-last link takes the last one off; older links do nothing. */
  chainStepBack: boolean;
  /** Stage H: the pointer back on the hero cancels the chain (off: only the right button or Esc cancel). */
  cancelOnHero: boolean;
  dashSpeed: number;
  survivorKnockback: boolean;
  survivorKnockbackTime: number;
  survivorKnockbackDistance: number;
  // Focus (stage 2)
  focusSlow: number;
  focusMax: number;
  focusRegen: number;
  focusKillRefill: boolean;
  focusPerKill: number;
  focusNoDamage: boolean;
  /** Stage E (user 07.10.2026): each new link of a chain (an enemy or a crystal, once per chain) refreshes focus. */
  linkRefreshesFocus: boolean;
  /** Focus a new link gives back: 0 — to the full reserve, otherwise +N s up to the maximum. */
  focusPerLink: number;
  // Jump (stage 2)
  energyPerKill: number;
  jumpCost: number;
  jumpRadius: number;
  // Look
  dimMode: DimMode;
  dimStrength: number;
  enemyLook: EnemyLook;
  showHitboxes: boolean;
  // Boar (stage 3)
  boarWindup: number;
  boarExclaim: boolean;
  boarRange: number;
  boarMass: number;
  boarDamage: number;
  boarKnockback: number;
  boarHp: number;
  boarMax: number;
  boarTrigger: number;
  boarChargeSpeed: number;
  boarRest: number;
  boarCooldown: number;
  // Shieldbearer (stage 2 of the transition, docs/realtime-slice.md, section 4)
  shieldHp: number;
  /** Width of the shield arc in front of it, degrees: a link whose anchor stands in it cannot be taken. */
  shieldArc: number;
  /** How fast the shield turns to the hero, degrees per game second. */
  shieldTurn: number;
  /** Walking speed multiplier of the shieldbearer. */
  shieldSpeed: number;
}

export type ScalarKey = Exclude<keyof Params, 'phases'>;
export type ParamKey = keyof Params;

/** Stage that introduced the value: 1–3 — stages of the first build, 4 — iteration 2, 5 — stage 2 of the transition (the slice). */
interface BaseDef { key: ScalarKey; label: string; group: string; stage: 1 | 2 | 3 | 4 | 5; hint?: string }
export interface NumberDef extends BaseDef { kind: 'number'; min: number; max: number; step: number; unit?: string }
export interface BoolDef extends BaseDef { kind: 'bool' }
export interface ChoiceDef extends BaseDef { kind: 'choice'; options: readonly { value: string; label: string }[] }
export type ParamDef = NumberDef | BoolDef | ChoiceDef;

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  heroHp: 12,
  heroHitFactor: 0.7,
  contactDamage: 1,
  invulnerabilityMode: 'constant',
  chainShield: 0.5,
  chainShieldMinKills: 1,
  invulnerability: 0.5,
  touchFactor: 0.8,
  brakeStrength: 0.8,
  brakeRecovery: 0.8,
  heroSpeed: 4,
  heroThroughEnemies: true,
  crowdSlow: 0.7,
  enemyRadius: 0.45,
  bodyRadius: 0.4,
  enemyScale: 0.8,
  enemySpeed: 1.2,
  speedSpread: 0.2,
  pathfinding: true,
  flowRate: 4,
  flowTurn: 8,
  flowDensity: false,
  flowDensityCost: 2,
  waterSlow: 0.5,
  crystals: true,
  crystalEvery: 6,
  crystalLife: 0,
  crystalScorePerKill: 20,
  crystalDropRadius: 4,
  comboCounter: true,
  hitstop: true,
  hitstopMin: 0.02,
  hitstopMax: 0.04,
  hitstopGrowth: 0.002,
  finisher: true,
  finisherLinks: 10,
  finisherTime: 0.3,
  finisherSlow: 0.2,
  chainScoreMultiplier: true,
  scorePerKill: 10,
  scoreLengthBonus: 0.1,
  sound: true,
  soundVolume: 0.3,
  wolfSpeed: 1.6,
  wolfPackMin: 3,
  wolfPackMax: 4,
  wolfPackRadius: 2,
  wolfPackBonus: 1,
  wolfPackMono: false,
  baseFloor: 28,
  baseIntervalMin: 3,
  baseIntervalMax: 5,
  baseToughShare: 0.2,
  baseWolfShare: 0.15,
  baseBoarShare: 0.05,
  phases: DEFAULT_PHASES.map(p => ({ ...p })),
  groupMin: 2,
  groupMax: 4,
  spawnPlace: 'edges',
  groupColor: 'mixed',
  maxEnemies: 60,
  markerDelay: 1,
  spawnMinDistance: 3,
  angerTierSeconds: 30,
  angerSpeedStep: 0,
  reaperEnabled: false,
  reaperTime: 130,
  reaperSpeed: 2.5,
  reaperDamage: 3,
  killGoal: 30,
  markedSpeed: 0.5,
  hitFlash: 0.1,
  shakeOnDamage: true,
  shakeAmplitude: 5,
  shakeDuration: 0.1,
  deathDuration: 0.5,
  dashShake: 3,
  linkRadius: 1.875,
  linkToEdge: true,
  // Stage 1 of the transition (user 08.10.2026, docs/realtime-transition.md, decision 3): the hero anchor becomes a
  // talisman; the base rule takes the next link only within R of the last link. The panel toggle stays until stage 2.
  heroAnchor: false,
  lineOfSight: true,
  sightSlack: 0.1,
  dragSweep: true,
  holdPicks: true,
  refusalHint: true,
  doorWalkIn: true,
  chainStepBack: true,
  cancelOnHero: false,
  // 0.36 × 1.65 ≈ 0.59: the press circle of the stage before the enemies shrank (design 07.10.2026: no more misses).
  pickSlack: 1.65,
  dashSpeed: 12,
  survivorKnockback: false,
  survivorKnockbackTime: 0.12,
  survivorKnockbackDistance: 0.8,
  focusSlow: 0.25,
  focusMax: 3,
  focusRegen: 1,
  focusKillRefill: false,
  focusPerKill: 0.3,
  focusNoDamage: false,
  linkRefreshesFocus: true,
  focusPerLink: 0,
  energyPerKill: 0.5,
  jumpCost: 2,
  jumpRadius: 3,
  dimMode: 'alpha',
  dimStrength: 0.65,
  enemyLook: 'circle',
  showHitboxes: false,
  boarWindup: 1,
  boarExclaim: true,
  boarRange: 4,
  boarMass: 5,
  boarDamage: 2,
  boarKnockback: 1.5,
  boarHp: 2,
  boarMax: 3,
  boarTrigger: 5,
  boarChargeSpeed: 8,
  boarRest: 0.8,
  boarCooldown: 3,
  shieldHp: 1,
  shieldArc: 120,
  shieldTurn: 90,
  shieldSpeed: 0.8,
});

const n = (key: ScalarKey, group: string, label: string, min: number, max: number, step: number, stage: 1 | 2 | 3 | 4 | 5 = 1, unit?: string, hint?: string): NumberDef =>
  ({ kind: 'number', key, group, label, min, max, step, stage, unit, hint });

export const PARAM_DEFS: readonly ParamDef[] = [
  n('heroHp', 'Герой и урон', 'HP героя', 1, 40, 1),
  n('heroHitFactor', 'Герой и урон', 'Круг героя, доля радиуса тела врага', 0.2, 2, 0.05, 1, '×', 'Хитбокс героя в пользу игрока (≈ 0,7 радиуса врага).'),
  n('contactDamage', 'Герой и урон', 'Урон касания', 0, 5, 1),
  { kind: 'choice', key: 'invulnerabilityMode', group: 'Герой и урон', label: 'Неуязвимость', stage: 1,
    hint: 'По доле HP (Brotato): (урон ÷ макс. HP) ÷ 0,15 × 0,4 с, в пределах 0,2–0,4 с.',
    options: [{ value: 'constant', label: 'постоянная' }, { value: 'byDamage', label: 'по доле HP' }] },
  n('invulnerability', 'Герой и урон', 'Постоянная неуязвимость', 0, 2, 0.05, 1, 'с'),
  n('chainShield', 'Герой и урон', 'Неуязвимость после цепи', 0, 1.5, 0.05, 2, 'с', 'После цепи, убившей врага: шанс выйти из толпы ходьбой. Новая заменяет остаток.'),
  n('chainShieldMinKills', 'Герой и урон', 'Мин. убийств цепи для неуязвимости', 1, 10, 1, 2),
  n('touchFactor', 'Герой и урон', 'Касание: доля радиуса тела врага', 0.3, 1.2, 0.05, 1, '×', 'Враг ранит, когда его тело, уменьшенное до этой доли, касается круга героя. На этом расстоянии враг упирается в героя.'),
  n('brakeStrength', 'Герой и урон', 'Торможение после удара', 0, 1, 0.05, 1, '×', 'Ударивший враг теряет эту долю скорости и разгоняется заново.'),
  n('brakeRecovery', 'Герой и урон', 'Разгон после удара', 0, 3, 0.05, 1, 'с'),
  n('heroSpeed', 'Перемещение', 'Скорость героя (WASD, стрелки)', 0, 10, 0.25, 4, 'ед/с', 'Свободное движение; в фокусе замедлено вместе со временем. На проходе цепи и в прыжке ввод не действует.'),
  { kind: 'bool', key: 'heroThroughEnemies', group: 'Перемещение', label: 'Сквозь врагов', stage: 4,
    hint: 'Включено (по умолчанию с этапа D): герой проходит сквозь толпу, расталкивая тела, и в толпе идёт медленнее; касание ранит. Выключено: враги — препятствие, толпа может зажать героя (выход — цепь или прыжок).' },
  n('crowdSlow', 'Перемещение', 'Замедление в толпе', 0.1, 1, 0.05, 4, '×', 'Пока круг героя перекрывает тело хотя бы одного врага (при «Сквозь врагов»), ходьба медленнее. Складывается только с водой: вода × толпа.'),
  n('enemyScale', 'Враги', 'Размер врага', 0.4, 1.5, 0.05, 4, '×', 'Множитель рисунка и тела всех врагов (кабан, волк, Жнец — тоже); зона касания и расталкивание — вместе с телом. Круг героя не меняется.'),
  n('enemyRadius', 'Враги', 'Радиус рисунка врага (при размере 1)', 0.2, 0.7, 0.01, 1, 'ед.'),
  n('bodyRadius', 'Враги', 'Радиус тела (толкание; при размере 1)', 0.15, 0.7, 0.01, 1, 'ед.'),
  n('enemySpeed', 'Враги', 'Скорость врага', 0.2, 4, 0.05, 1, 'ед/с'),
  n('speedSpread', 'Враги', 'Разброс скорости', 0, 0.6, 0.05, 1, '±'),
  { kind: 'bool', key: 'pathfinding', group: 'Враги', label: 'Поиск пути (поле потока)', stage: 4, hint: 'Враги обходят стены и деревья по полю потока к герою; вода дороже по замедлению. Выключено: по прямой, как в этапах 1–3, — упираются в препятствия.' },
  n('flowRate', 'Враги', 'Пересчёт поля потока', 1, 30, 1, 4, 'раз/с'),
  n('flowTurn', 'Враги', 'Плавность поворота по полю', 1, 30, 1, 4, '1/с', 'Чем больше, тем резче враг поворачивает к направлению поля.'),
  { kind: 'bool', key: 'flowDensity', group: 'Враги', label: 'Штраф за плотность (поле потока)', stage: 4,
    hint: 'Клетка с врагами дороже: толпа растекается по обходным путям, а не стоит очередью в узком месте. Поле пересчитывается и когда герой стоит.' },
  n('flowDensityCost', 'Враги', 'Штраф за врага в клетке', 0, 5, 0.1, 4, '', 'Добавка к стоимости клетки поля за каждого врага в ней (клетка травы стоит 1).'),
  n('waterSlow', 'Местность', 'Скорость в воде', 0.1, 1, 0.05, 4, '×', 'Пруд проходим: ходьба героя и врагов в воде медленнее (рывок кабана, проход цепи и прыжок — нет). Поле потока считает клетку воды дороже во столько же раз.'),
  { kind: 'bool', key: 'crystals', group: 'Кристаллы', label: 'Кристаллы смены цвета', stage: 4,
    hint: 'На каждом N-м убийстве одной цепью падает кристалл в случайной точке вне оставшегося пути цепи. Кристалл — звено любого цвета: меняет цвет цепи, силы не даёт, убийством не считается.' },
  n('crystalEvery', 'Кристаллы', 'Кристалл за каждые … убийств цепи', 2, 20, 1, 4),
  n('crystalLife', 'Кристаллы', 'Срок жизни кристалла', 0, 120, 5, 4, 'с', '0 — лежит, пока цепь его не разобьёт.'),
  n('crystalScorePerKill', 'Кристаллы', 'Очки за кристалл, × убийств породившей цепи', 0, 100, 5, 4),
  n('crystalDropRadius', 'Кристаллы', 'Радиус падения от места убийства', 0, 16, 0.5, 4, 'ед.', '0 — вся арена. Кристалл рядом с кучей продолжает комбо.'),
  { kind: 'bool', key: 'comboCounter', group: 'Сок цепи', label: 'Счётчик комбо у героя', stage: 4 },
  { kind: 'bool', key: 'hitstop', group: 'Сок цепи', label: 'Остановка кадра на убийстве', stage: 4 },
  n('hitstopMin', 'Сок цепи', 'Остановка: первое убийство', 0, 0.1, 0.005, 4, 'с'),
  n('hitstopMax', 'Сок цепи', 'Остановка: не дольше', 0, 0.2, 0.005, 4, 'с'),
  n('hitstopGrowth', 'Сок цепи', 'Остановка: прибавка за убийство', 0, 0.02, 0.001, 4, 'с'),
  { kind: 'bool', key: 'finisher', group: 'Сок цепи', label: 'Добивание: замедление и вспышка', stage: 4 },
  n('finisherLinks', 'Сок цепи', 'Добивание: от … убийств', 2, 40, 1, 4),
  n('finisherTime', 'Сок цепи', 'Добивание: замедление', 0, 2, 0.05, 4, 'с'),
  n('finisherSlow', 'Сок цепи', 'Добивание: скорость мира', 0.02, 1, 0.02, 4, '×'),
  { kind: 'bool', key: 'chainScoreMultiplier', group: 'Сок цепи', label: 'Очки с множителем длины', stage: 4,
    hint: 'Очки цепи = очки за убийство × K × (1 + бонус × K), K — убийства цепи. Выключено: очки за убийство × K.' },
  n('scorePerKill', 'Сок цепи', 'Очки за убийство', 0, 100, 1, 4),
  n('scoreLengthBonus', 'Сок цепи', 'Бонус длины за убийство', 0, 1, 0.01, 4),
  { kind: 'bool', key: 'sound', group: 'Сок цепи', label: 'Звук удара (тон растёт по цепи)', stage: 4 },
  n('soundVolume', 'Сок цепи', 'Громкость', 0, 1, 0.05, 4),
  n('baseFloor', 'До целей', 'Пол плотности', 0, 150, 1, 4, 'живых', 'Если врагов вместе с метками и очередью меньше, недостающие сразу встают в очередь меток (не больше предела арены).'),
  n('baseIntervalMin', 'До целей', 'Интервал групп: от', 0.2, 20, 0.1, 1, 'с'),
  n('baseIntervalMax', 'До целей', 'Интервал групп: до', 0.2, 20, 0.1, 1, 'с'),
  n('baseToughShare', 'До целей', 'Доля крепких', 0, 1, 0.05),
  n('baseWolfShare', 'До целей', 'Доля стай волков (групп)', 0, 1, 0.05, 3, '', 'Доля групп, которые приходят стаей волков.'),
  n('baseBoarShare', 'До целей', 'Доля кабанов', 0, 1, 0.01, 3, '', 'Доля кабанов среди прочих новых врагов (не больше «Кабанов на арене»).'),
  n('groupMin', 'Появление', 'Группа: от', 1, 10, 1),
  n('groupMax', 'Появление', 'Группа: до', 1, 10, 1),
  { kind: 'choice', key: 'spawnPlace', group: 'Появление', label: 'Место', stage: 1,
    options: [{ value: 'edges', label: 'только края' }, { value: 'edgesAndInside', label: 'края + кучки внутри' }] },
  { kind: 'choice', key: 'groupColor', group: 'Появление', label: 'Цвет группы', stage: 1,
    options: [{ value: 'mixed', label: 'смешанный' }, { value: 'mono', label: 'одноцветный' }] },
  n('maxEnemies', 'Появление', 'Предел врагов на арене', 1, 150, 1, 1, '', 'При пределе новые ждут в очереди меток.'),
  n('markerDelay', 'Появление', 'Задержка метки', 0, 3, 0.1, 1, 'с'),
  n('spawnMinDistance', 'Появление', 'Запретный радиус у героя', 0, 6, 0.25, 1, 'ед.'),
  n('angerSpeedStep', 'Время', 'Рост скорости за ступень', 0, 0.5, 0.01, 1, '', 'По умолчанию 0: быстрых даёт состав фаз.'),
  n('angerTierSeconds', 'Время', 'Ступень роста скорости', 5, 120, 5, 1, 'с'),
  { kind: 'bool', key: 'reaperEnabled', group: 'Время', label: 'Жнец (после целей)', stage: 1 },
  n('reaperTime', 'Время', 'Жнец: через … после целей', 10, 600, 5, 1, 'с'),
  n('reaperSpeed', 'Время', 'Скорость Жнеца', 0.5, 6, 0.1, 1, 'ед/с'),
  n('reaperDamage', 'Время', 'Урон касания Жнеца', 0, 12, 1),
  n('killGoal', 'Арены', 'Арена «Убить N»: врагов', 1, 200, 1, 3, '', 'Цель первой арены: после стольких убийств цепью открывается дверь и начинается стадия жадности.'),
  n('markedSpeed', 'Арены', 'Скорость отмеченных', 0, 2, 0.05, 3, '×', 'Отмеченные враги третьей арены идут медленнее толпы и не сразу сбиваются в кучу.'),
  { kind: 'bool', key: 'chainStepBack', group: 'Цепь', label: 'Откат на шаг', stage: 2,
    hint: 'Курсор на предпоследнем звене снимает последнее; более старые звенья ничего не делают. Выкл. — обрезка до любого звена.' },
  { kind: 'bool', key: 'cancelOnHero', group: 'Цепь', label: 'Отмена наведением на героя', stage: 2,
    hint: 'Выкл. — цепь отменяют только правая кнопка и Esc (с якорем у героя курсор часто проходит рядом с ним).' },
  { kind: 'bool', key: 'doorWalkIn', group: 'Арены', label: 'Вход в дверь ходьбой', stage: 4,
    hint: 'После целей касание открытой двери телом героя — победа. Цепью и прыжком — как раньше. Закрытая дверь — не препятствие и ничего не делает.' },
  n('hitFlash', 'Эффекты', 'Вспышка попадания', 0, 0.5, 0.02, 1, 'с'),
  { kind: 'bool', key: 'shakeOnDamage', group: 'Эффекты', label: 'Тряска при уроне', stage: 1 },
  n('shakeAmplitude', 'Эффекты', 'Тряска: сила', 0, 20, 1, 1, 'px'),
  n('shakeDuration', 'Эффекты', 'Тряска: длительность', 0, 0.5, 0.02, 1, 'с'),
  n('deathDuration', 'Эффекты', 'Смерть врага: оборот и сжатие', 0, 2, 0.05, 2, 'с'),
  n('dashShake', 'Эффекты', 'Тряска при проходе цепи', 0, 10, 1, 2, 'px'),
  n('linkRadius', 'Цепь', 'Радиус звена R', 0.5, 4, 0.025, 2, 'ед.', 'Круг R тонко виден вокруг героя всегда; при выделении цепи — ещё вокруг последнего звена.'),
  { kind: 'bool', key: 'linkToEdge', group: 'Цепь', label: 'R до края тела', stage: 4,
    hint: 'Враг берётся, если круг R касается его рисунка (центр не дальше R + радиус рисунка); кнопка, дверь, кристалл — до края их круга. Выключено: до центра.' },
  { kind: 'bool', key: 'heroAnchor', group: 'Цепь', label: 'Якорь у героя', stage: 4,
    hint: 'Следующее звено берётся в R от последнего звена ИЛИ в R от героя. Проход по цепи — по звеньям по порядку.' },
  { kind: 'bool', key: 'lineOfSight', group: 'Цепь', label: 'Препятствия рвут звено', stage: 2 },
  n('sightSlack', 'Цепь', 'Допуск видимости у края препятствия', 0, 0.3, 0.01, 4, 'ед.', 'Для луча звена деревья и стены сужены на столько: луч, задевший край ствола или угол стены, не рвёт звено. 0 — точно.'),
  n('pickSlack', 'Цепь', 'Запас нажатия по врагу', 1, 2.5, 0.05, 2, '× рисунка'),
  { kind: 'bool', key: 'dragSweep', group: 'Цепь', label: 'Протяжка по всему пути мыши', stage: 4,
    hint: 'Быстрое движение мыши берёт звенья вдоль всего пути, а не только в точках событий мыши.' },
  { kind: 'bool', key: 'holdPicks', group: 'Цепь', label: 'Взятие под неподвижной мышью', stage: 4,
    hint: 'Пока кнопка зажата, враг, подошедший под курсор или вошедший в R, добавляется без движения мыши (только добавление, без обрезки).' },
  { kind: 'bool', key: 'refusalHint', group: 'Цепь', label: 'Подсказка: почему не берётся', stage: 4,
    hint: 'У курсора над врагом или объектом, который нельзя взять следующим звеном: «далеко», «не тот цвет», «нет видимости», «после выжившего»…' },
  n('dashSpeed', 'Цепь', 'Скорость прохода', 2, 40, 0.5, 2, 'ед/с'),
  { kind: 'bool', key: 'survivorKnockback', group: 'Цепь', label: 'Отброс выживших после удара', stage: 2 },
  n('survivorKnockbackTime', 'Цепь', 'Отброс выживших: время', 0, 0.5, 0.01, 2, 'с'),
  n('survivorKnockbackDistance', 'Цепь', 'Отброс выживших: расстояние', 0, 3, 0.05, 2, 'ед.'),
  n('focusSlow', 'Фокус', 'Замедление в фокусе', 0.02, 1, 0.01, 2, '×'),
  n('focusMax', 'Фокус', 'Запас фокуса', 0, 10, 0.1, 2, 'с'),
  n('focusRegen', 'Фокус', 'Восстановление', 0, 5, 0.1, 2, 'с/с'),
  { kind: 'bool', key: 'focusKillRefill', group: 'Фокус', label: 'Восстановление за убийства', stage: 2 },
  n('focusPerKill', 'Фокус', 'Фокус за убийство', 0, 2, 0.05, 2, 'с'),
  { kind: 'bool', key: 'linkRefreshesFocus', group: 'Фокус', label: 'Звено обновляет фокус', stage: 2,
    hint: 'Каждое новое звено цепи (враг или кристалл) восстанавливает фокус — один раз за цепь; кнопка и дверь — нет.' },
  n('focusPerLink', 'Фокус', 'Сколько восстанавливает звено', 0, 3, 0.1, 2, 'с', '0 — до полного запаса.'),
  { kind: 'bool', key: 'focusNoDamage', group: 'Фокус', label: 'В фокусе враги не ранят', stage: 2 },
  n('energyPerKill', 'Прыжок', 'Энергия за врага', 0, 3, 0.1, 2),
  n('jumpCost', 'Прыжок', 'Цена прыжка', 0, 10, 0.5, 2),
  n('jumpRadius', 'Прыжок', 'Радиус прыжка', 0.5, 8, 0.25, 2, 'ед.'),
  { kind: 'choice', key: 'dimMode', group: 'Вид', label: 'Приглушение не того цвета', stage: 2,
    options: [{ value: 'darken', label: 'затемнение' }, { value: 'alpha', label: 'полупрозрачность' }, { value: 'desaturate', label: 'обесцвечивание' }] },
  n('dimStrength', 'Вид', 'Сила приглушения', 0, 1, 0.05, 2),
  { kind: 'choice', key: 'enemyLook', group: 'Вид', label: 'Вид врагов', stage: 1,
    options: [{ value: 'circle', label: 'круги со знаком' }, { value: 'sprite', label: 'иллюстрация' }] },
  { kind: 'bool', key: 'showHitboxes', group: 'Вид', label: 'Показать тела и касание', stage: 1 },
  n('boarWindup', 'Кабан', 'Объявление рывка (полоса)', 0.2, 3, 0.1, 3, 'с'),
  { kind: 'bool', key: 'boarExclaim', group: 'Кабан', label: '«!» и мигание перед рывком', stage: 3 },
  n('boarRange', 'Кабан', 'Дальность рывка', 1, 10, 0.25, 3, 'ед.'),
  n('boarMass', 'Кабан', 'Масса на рывке', 1, 20, 0.5, 3, '×'),
  n('boarDamage', 'Кабан', 'Урон рывка', 0, 6, 1, 3),
  n('boarKnockback', 'Кабан', 'Отброс героя', 0, 4, 0.25, 3, 'ед.'),
  n('boarHp', 'Кабан', 'HP кабана', 0, 6, 1, 3),
  n('boarMax', 'Кабан', 'Кабанов на арене', 0, 10, 1, 3),
  n('boarTrigger', 'Кабан', 'Начинает рывок с расстояния', 1, 12, 0.25, 3, 'ед.'),
  n('boarChargeSpeed', 'Кабан', 'Скорость рывка', 2, 20, 0.5, 3, 'ед/с'),
  n('boarRest', 'Кабан', 'Стоит после рывка', 0, 3, 0.1, 3, 'с'),
  n('boarCooldown', 'Кабан', 'Перезарядка рывка', 0, 10, 0.5, 3, 'с'),
  n('wolfSpeed', 'Волк', 'Скорость волка', 0.2, 5, 0.05, 3, 'ед/с'),
  n('wolfPackMin', 'Волк', 'Стая: от', 1, 8, 1, 3),
  n('wolfPackMax', 'Волк', 'Стая: до', 1, 8, 1, 3),
  n('wolfPackRadius', 'Волк', 'Радиус стаи', 0.5, 6, 0.25, 3, 'ед.', 'Волки ближе этого радиуса друг к другу — стая: линии между ними.'),
  n('wolfPackBonus', 'Волк', 'Урон за волка рядом', 0, 3, 1, 3, '', 'Удар волка: урон касания + столько за каждого другого волка в радиусе стаи.'),
  { kind: 'bool', key: 'wolfPackMono', group: 'Волк', label: 'Стая одного цвета', stage: 3, hint: 'Выключено: цвет волков в стае — как у групп (переключатель «Цвет группы»).' },
  n('shieldHp', 'Щитоносец', 'HP щитоносца', 0, 6, 1, 5),
  n('shieldArc', 'Щитоносец', 'Дуга щита', 0, 360, 5, 5, '°', 'Звено нельзя взять, если якорь (предыдущее звено или герой) стоит в этой дуге перед щитоносцем.'),
  n('shieldTurn', 'Щитоносец', 'Поворот щита к герою', 0, 720, 5, 5, '°/с', 'Герой (4 ед/с) обходит щитоносца быстрее, чем поворачивается щит.'),
  n('shieldSpeed', 'Щитоносец', 'Скорость щитоносца', 0.1, 2, 0.05, 5, '×'),
];

const MAX_PHASES = 8;

function sanitizePhases(raw: unknown): Phase[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PHASES.map(p => ({ ...p }));
  return raw.slice(0, MAX_PHASES).map((item, i) => {
    const src = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const base = DEFAULT_PHASES[Math.min(i, DEFAULT_PHASES.length - 1)];
    const out = { ...base };
    for (const f of PHASE_FIELDS) {
      const v = src[f.key];
      if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, v));
    }
    return out;
  });
}

/** Clamps stored or journalled values to the panel ranges; unknown or broken values fall back to the defaults. */
export function sanitizeParams(raw: unknown): Params {
  const out: Params = { ...DEFAULT_PARAMS, phases: DEFAULT_PHASES.map(p => ({ ...p })) };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const def of PARAM_DEFS) {
    const v = src[def.key];
    if (def.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) target[def.key] = Math.min(def.max, Math.max(def.min, v));
    else if (def.kind === 'bool' && typeof v === 'boolean') target[def.key] = v;
    else if (def.kind === 'choice' && typeof v === 'string' && def.options.some(o => o.value === v)) target[def.key] = v;
  }
  out.phases = sanitizePhases(src.phases);
  return out;
}

export function defaultParams(): Params { return sanitizeParams(null); }

/** A deep copy (the journal keeps the values a run started with). */
export function copyParams(params: Params): Params { return { ...params, phases: params.phases.map(p => ({ ...p })) }; }

export function setParam(params: Params, key: ParamKey, value: unknown): void {
  const next = sanitizeParams({ ...params, [key]: value });
  (params as unknown as Record<string, unknown>)[key] = (next as unknown as Record<string, unknown>)[key];
}

export function setPhases(params: Params, phases: unknown): void { params.phases = sanitizePhases(phases); }

/**
 * Hero circle radius: a share of the enemy body at size 1 (hitbox in the player's favour).
 * Not scaled by `enemyScale`: smaller enemies leave the hero as he was (stage D).
 */
export function heroRadius(params: Params): number { return params.bodyRadius * params.heroHitFactor; }

/** Enemy body radius (pushing, obstacles, flow field clearance, touch zone): `bodyRadius × enemyScale` (stage D). */
export function enemyBodyRadius(params: Params): number { return params.bodyRadius * params.enemyScale; }

/** Enemy art radius (drawing, click zone, markers, flashes): `enemyRadius × enemyScale` (stage D). */
export function enemyDrawRadius(params: Params): number { return params.enemyRadius * params.enemyScale; }

/** Values that follow from time and the base numbers; the panel shows them live. */
export interface Pressure {
  /** Index of the current greed phase (holds at the last one); -1 before the goals (base pace). */
  phaseIndex: number;
  phase: Phase;
  /** Seconds left in the current phase (Infinity on the last one). */
  phaseLeft: number;
  angerTier: number;
  enemySpeed: number;
}

/**
 * The base pace before the goals, as a phase without an end: the panel values, or the arena template's own pace
 * (stage 1 of the transition: arenas are data) where it sets a field.
 */
export function basePhase(params: Params, arena?: ArenaTemplate): Phase {
  const own = arena?.pace;
  return {
    duration: Infinity,
    floor: own?.floor ?? params.baseFloor,
    intervalMin: own?.intervalMin ?? params.baseIntervalMin,
    intervalMax: own?.intervalMax ?? params.baseIntervalMax,
    toughShare: own?.toughShare ?? params.baseToughShare,
    wolfShare: own?.wolfShare ?? params.baseWolfShare,
    boarShare: own?.boarShare ?? params.baseBoarShare,
  };
}

/**
 * Pressure at game time `time`. `greedStart` is the time the goals were completed
 * (null before): only then the phase table runs, counted from that moment.
 */
export function pressureAt(params: Params, time: number, greedStart: number | null = null, arena?: ArenaTemplate): Pressure {
  const angerTier = Math.floor(time / params.angerTierSeconds);
  const enemySpeed = params.enemySpeed * Math.pow(1 + params.angerSpeedStep, angerTier);
  if (greedStart === null) return { phaseIndex: -1, phase: basePhase(params, arena), phaseLeft: Infinity, angerTier, enemySpeed };
  const own = arena?.phases;
  const phases = own && own.length ? own : params.phases.length ? params.phases : DEFAULT_PHASES;
  const t = Math.max(0, time - greedStart);
  let start = 0, phaseIndex = phases.length - 1, phaseLeft = Infinity;
  for (let i = 0; i < phases.length - 1; i++) {
    if (t < start + phases[i].duration) { phaseIndex = i; phaseLeft = start + phases[i].duration - t; break; }
    start += phases[i].duration;
  }
  return { phaseIndex, phase: phases[phaseIndex], phaseLeft, angerTier, enemySpeed };
}

/** Rolls the interval to the next group: uniform in the phase's [min, max] (the seeded `spawnRoll` stream). */
export function rollGroupInterval(phase: Phase, rng: Rng): number {
  const lo = Math.min(phase.intervalMin, phase.intervalMax), hi = Math.max(phase.intervalMin, phase.intervalMax);
  return lo + rng.next() * (hi - lo);
}

/** Brotato rule: (damage ÷ max HP) ÷ 0.15 × 0.4 s, clamped to 0.2–0.4 s. */
export function proportionalInvulnerability(damage: number, maxHp: number): number {
  if (maxHp <= 0) return 0.4;
  return Math.min(0.4, Math.max(0.2, damage / maxHp / 0.15 * 0.4));
}

export function invulnerabilityFor(params: Params, mode: InvulnerabilityMode, damage: number, maxHp: number): number {
  return mode === 'constant' ? params.invulnerability : proportionalInvulnerability(damage, maxHp);
}

/** Seconds a hero survives standing in a crowd: every hit is followed by invulnerability. */
export function crowdLifetime(params: Params, mode: InvulnerabilityMode): number {
  if (params.contactDamage <= 0) return Infinity;
  return Math.ceil(params.heroHp / params.contactDamage) * invulnerabilityFor(params, mode, params.contactDamage, params.heroHp);
}
