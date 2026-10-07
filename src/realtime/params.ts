/**
 * Tunable numbers of the real-time prototype (docs/realtime-prototype.md, sections 8, 9a and 11).
 * Every value is a debug-panel control; the panel stores them in localStorage.
 * Stage marks which prototype stage introduced the value (all stages are implemented).
 */

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

/** Default table: build-up, a breather (phase 3), then the squeeze. Mean pace ≈ the draft's 1 enemy per 1.5 s at the start. */
export const DEFAULT_PHASES: readonly Phase[] = Object.freeze([
  { duration: 25, floor: 6, intervalMin: 3, intervalMax: 5, toughShare: 0.2, wolfShare: 0.15, boarShare: 0.05 },
  { duration: 25, floor: 12, intervalMin: 2.5, intervalMax: 4, toughShare: 0.25, wolfShare: 0.2, boarShare: 0.06 },
  { duration: 20, floor: 4, intervalMin: 5, intervalMax: 7, toughShare: 0.2, wolfShare: 0.1, boarShare: 0 },
  { duration: 30, floor: 20, intervalMin: 2, intervalMax: 3.5, toughShare: 0.3, wolfShare: 0.25, boarShare: 0.08 },
  { duration: 30, floor: 30, intervalMin: 1.5, intervalMax: 3, toughShare: 0.4, wolfShare: 0.3, boarShare: 0.1 },
].map(p => Object.freeze(p)));

export interface Params {
  // Hero and damage
  heroHp: number;
  heroHitFactor: number;
  contactDamage: number;
  invulnerabilityMode: InvulnerabilityMode;
  invulnerability: number;
  touchFactor: number;
  brakeStrength: number;
  brakeRecovery: number;
  // Enemies
  enemyRadius: number;
  bodyRadius: number;
  enemySpeed: number;
  speedSpread: number;
  pathfinding: boolean;
  // Wolves (stage 3): fast, hit harder next to other wolves, come in packs
  wolfSpeed: number;
  wolfPackMin: number;
  wolfPackMax: number;
  wolfPackRadius: number;
  wolfPackBonus: number;
  wolfPackMono: boolean;
  // Spawning before the goals (base pace, no growth)
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
  lineOfSight: boolean;
  pickSlack: number;
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
}

export type ScalarKey = Exclude<keyof Params, 'phases'>;
export type ParamKey = keyof Params;

interface BaseDef { key: ScalarKey; label: string; group: string; stage: 1 | 2 | 3; hint?: string }
export interface NumberDef extends BaseDef { kind: 'number'; min: number; max: number; step: number; unit?: string }
export interface BoolDef extends BaseDef { kind: 'bool' }
export interface ChoiceDef extends BaseDef { kind: 'choice'; options: readonly { value: string; label: string }[] }
export type ParamDef = NumberDef | BoolDef | ChoiceDef;

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  heroHp: 12,
  heroHitFactor: 0.7,
  contactDamage: 1,
  invulnerabilityMode: 'constant',
  invulnerability: 0.5,
  touchFactor: 0.8,
  brakeStrength: 0.8,
  brakeRecovery: 0.8,
  enemyRadius: 0.45,
  bodyRadius: 0.4,
  enemySpeed: 1.2,
  speedSpread: 0.2,
  pathfinding: false,
  wolfSpeed: 1.6,
  wolfPackMin: 3,
  wolfPackMax: 4,
  wolfPackRadius: 2,
  wolfPackBonus: 1,
  wolfPackMono: false,
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
  linkRadius: 1.5,
  lineOfSight: true,
  pickSlack: 1.3,
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
});

const n = (key: ScalarKey, group: string, label: string, min: number, max: number, step: number, stage: 1 | 2 | 3 = 1, unit?: string, hint?: string): NumberDef =>
  ({ kind: 'number', key, group, label, min, max, step, stage, unit, hint });

export const PARAM_DEFS: readonly ParamDef[] = [
  n('heroHp', 'Герой и урон', 'HP героя', 1, 40, 1),
  n('heroHitFactor', 'Герой и урон', 'Круг героя, доля радиуса тела врага', 0.2, 2, 0.05, 1, '×', 'Хитбокс героя в пользу игрока (≈ 0,7 радиуса врага).'),
  n('contactDamage', 'Герой и урон', 'Урон касания', 0, 5, 1),
  { kind: 'choice', key: 'invulnerabilityMode', group: 'Герой и урон', label: 'Неуязвимость', stage: 1,
    hint: 'По доле HP (Brotato): (урон ÷ макс. HP) ÷ 0,15 × 0,4 с, в пределах 0,2–0,4 с.',
    options: [{ value: 'constant', label: 'постоянная' }, { value: 'byDamage', label: 'по доле HP' }] },
  n('invulnerability', 'Герой и урон', 'Постоянная неуязвимость', 0, 2, 0.05, 1, 'с'),
  n('touchFactor', 'Герой и урон', 'Касание: доля радиуса тела врага', 0.3, 1.2, 0.05, 1, '×', 'Враг ранит, когда его тело, уменьшенное до этой доли, касается круга героя. На этом расстоянии враг упирается в героя.'),
  n('brakeStrength', 'Герой и урон', 'Торможение после удара', 0, 1, 0.05, 1, '×', 'Ударивший враг теряет эту долю скорости и разгоняется заново.'),
  n('brakeRecovery', 'Герой и урон', 'Разгон после удара', 0, 3, 0.05, 1, 'с'),
  n('enemyRadius', 'Враги', 'Радиус рисунка врага', 0.2, 0.7, 0.01, 1, 'ед.'),
  n('bodyRadius', 'Враги', 'Радиус тела (толкание)', 0.15, 0.7, 0.01, 1, 'ед.'),
  n('enemySpeed', 'Враги', 'Скорость врага', 0.2, 4, 0.05, 1, 'ед/с'),
  n('speedSpread', 'Враги', 'Разброс скорости', 0, 0.6, 0.05, 1, '±'),
  { kind: 'bool', key: 'pathfinding', group: 'Враги', label: 'Обход препятствий', stage: 1, hint: 'Выключено: враг идёт к герою по прямой и упирается в препятствие.' },
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
  n('hitFlash', 'Эффекты', 'Вспышка попадания', 0, 0.5, 0.02, 1, 'с'),
  { kind: 'bool', key: 'shakeOnDamage', group: 'Эффекты', label: 'Тряска при уроне', stage: 1 },
  n('shakeAmplitude', 'Эффекты', 'Тряска: сила', 0, 20, 1, 1, 'px'),
  n('shakeDuration', 'Эффекты', 'Тряска: длительность', 0, 0.5, 0.02, 1, 'с'),
  n('deathDuration', 'Эффекты', 'Смерть врага: оборот и сжатие', 0, 2, 0.05, 2, 'с'),
  n('dashShake', 'Эффекты', 'Тряска при проходе цепи', 0, 10, 1, 2, 'px'),
  n('linkRadius', 'Цепь', 'Радиус звена R', 0.5, 4, 0.05, 2, 'ед.'),
  { kind: 'bool', key: 'lineOfSight', group: 'Цепь', label: 'Препятствия рвут звено', stage: 2 },
  n('pickSlack', 'Цепь', 'Запас нажатия по врагу', 1, 2.5, 0.05, 2, '× рисунка'),
  n('dashSpeed', 'Цепь', 'Скорость прохода', 2, 40, 0.5, 2, 'ед/с'),
  { kind: 'bool', key: 'survivorKnockback', group: 'Цепь', label: 'Отброс выживших после удара', stage: 2 },
  n('survivorKnockbackTime', 'Цепь', 'Отброс выживших: время', 0, 0.5, 0.01, 2, 'с'),
  n('survivorKnockbackDistance', 'Цепь', 'Отброс выживших: расстояние', 0, 3, 0.05, 2, 'ед.'),
  n('focusSlow', 'Фокус', 'Замедление в фокусе', 0.02, 1, 0.01, 2, '×'),
  n('focusMax', 'Фокус', 'Запас фокуса', 0, 10, 0.1, 2, 'с'),
  n('focusRegen', 'Фокус', 'Восстановление', 0, 5, 0.1, 2, 'с/с'),
  { kind: 'bool', key: 'focusKillRefill', group: 'Фокус', label: 'Восстановление за убийства', stage: 2 },
  n('focusPerKill', 'Фокус', 'Фокус за убийство', 0, 2, 0.05, 2, 'с'),
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
];

/**
 * v3 (07.10.2026, stage 3): dimming default 0.65 (design answer 31), wolves replace «fast», boar fields;
 * v1/v2 values are dropped.
 */
const STORAGE_KEY = 'ashen-oath-realtime-params-v4';
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

function sanitize(raw: unknown): Params {
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

export function defaultParams(): Params { return sanitize(null); }

export function loadParams(): Params {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return defaultParams();
  }
}

export function saveParams(params: Params): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* storage may be unavailable */ }
}

export function setParam(params: Params, key: ParamKey, value: unknown): void {
  const next = sanitize({ ...params, [key]: value });
  (params as unknown as Record<string, unknown>)[key] = (next as unknown as Record<string, unknown>)[key];
}

export function setPhases(params: Params, phases: unknown): void { params.phases = sanitizePhases(phases); }

/** Hero circle radius: a share of the enemy body (hitbox in the player's favour). */
export function heroRadius(params: Params): number { return params.bodyRadius * params.heroHitFactor; }

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

/** The base pace before the goals, as a phase without a floor or an end. */
export function basePhase(params: Params): Phase {
  return { duration: Infinity, floor: 0, intervalMin: params.baseIntervalMin, intervalMax: params.baseIntervalMax, toughShare: params.baseToughShare, wolfShare: params.baseWolfShare, boarShare: params.baseBoarShare };
}

/**
 * Pressure at game time `time`. `greedStart` is the time the goals were completed
 * (null before): only then the phase table runs, counted from that moment.
 */
export function pressureAt(params: Params, time: number, greedStart: number | null = null): Pressure {
  const angerTier = Math.floor(time / params.angerTierSeconds);
  const enemySpeed = params.enemySpeed * Math.pow(1 + params.angerSpeedStep, angerTier);
  if (greedStart === null) return { phaseIndex: -1, phase: basePhase(params), phaseLeft: Infinity, angerTier, enemySpeed };
  const phases = params.phases.length ? params.phases : DEFAULT_PHASES;
  const t = Math.max(0, time - greedStart);
  let start = 0, phaseIndex = phases.length - 1, phaseLeft = Infinity;
  for (let i = 0; i < phases.length - 1; i++) {
    if (t < start + phases[i].duration) { phaseIndex = i; phaseLeft = start + phases[i].duration - t; break; }
    start += phases[i].duration;
  }
  return { phaseIndex, phase: phases[phaseIndex], phaseLeft, angerTier, enemySpeed };
}

/** Rolls the interval to the next group: uniform in the phase's [min, max]. */
export function rollGroupInterval(phase: Phase): number {
  const lo = Math.min(phase.intervalMin, phase.intervalMax), hi = Math.max(phase.intervalMin, phase.intervalMax);
  return lo + Math.random() * (hi - lo);
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
