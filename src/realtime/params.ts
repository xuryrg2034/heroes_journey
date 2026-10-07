/**
 * Tunable numbers of the real-time prototype (docs/realtime-prototype.md, section 8 and 9a).
 * Every value is a debug-panel control; the panel stores them in localStorage.
 * Stage marks which prototype stage starts using the value: stage 2 and 3 fields
 * already exist so the panel layout stays stable, but do nothing yet.
 */

export type DimMode = 'darken' | 'alpha' | 'desaturate';
export type EnemyLook = 'circle' | 'sprite';

export interface Params {
  // Hero and damage
  heroHp: number;
  heroRadius: number;
  contactDamage: number;
  enemyCooldown: number;
  invulnerability: number;
  touchFactor: number;
  // Enemies
  enemyRadius: number;
  enemySpeed: number;
  toughShareStart: number;
  toughShareStep: number;
  toughShareInterval: number;
  toughShareMax: number;
  // Spawning
  spawnInterval: number;
  spawnSpeedup: number;
  spawnTierSeconds: number;
  maxEnemies: number;
  markerDelay: number;
  spawnMinDistance: number;
  // Anger
  angerTierSeconds: number;
  angerSpeedStep: number;
  angerCooldownStep: number;
  minCooldown: number;
  // Chain (stage 2)
  linkRadius: number;
  lineOfSight: boolean;
  dashSpeed: number;
  // Focus (stage 2)
  focusSlow: number;
  focusMax: number;
  focusRegen: number;
  focusKillRefill: boolean;
  focusPerKill: number;
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
  boarDamage: number;
  boarKnockback: number;
}

export type ParamKey = keyof Params;

interface BaseDef { key: ParamKey; label: string; group: string; stage: 1 | 2 | 3; hint?: string }
export interface NumberDef extends BaseDef { kind: 'number'; min: number; max: number; step: number; unit?: string }
export interface BoolDef extends BaseDef { kind: 'bool' }
export interface ChoiceDef extends BaseDef { kind: 'choice'; options: readonly { value: string; label: string }[] }
export type ParamDef = NumberDef | BoolDef | ChoiceDef;

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  heroHp: 12,
  heroRadius: 0.4,
  contactDamage: 1,
  enemyCooldown: 1,
  invulnerability: 0.5,
  touchFactor: 0.8,
  enemyRadius: 0.4,
  enemySpeed: 1.2,
  toughShareStart: 0.2,
  toughShareStep: 0.05,
  toughShareInterval: 60,
  toughShareMax: 0.4,
  spawnInterval: 1.5,
  spawnSpeedup: 0.1,
  spawnTierSeconds: 30,
  maxEnemies: 60,
  markerDelay: 1,
  spawnMinDistance: 2,
  angerTierSeconds: 30,
  angerSpeedStep: 0.1,
  angerCooldownStep: 0.1,
  minCooldown: 0.5,
  linkRadius: 1.5,
  lineOfSight: true,
  dashSpeed: 12,
  focusSlow: 0.25,
  focusMax: 3,
  focusRegen: 1,
  focusKillRefill: false,
  focusPerKill: 0.3,
  energyPerKill: 0.5,
  jumpCost: 2,
  jumpRadius: 3,
  dimMode: 'alpha',
  dimStrength: 0.35,
  enemyLook: 'circle',
  showHitboxes: false,
  boarWindup: 1,
  boarDamage: 2,
  boarKnockback: 1.5,
});

const n = (key: ParamKey, group: string, label: string, min: number, max: number, step: number, stage: 1 | 2 | 3 = 1, unit?: string, hint?: string): NumberDef =>
  ({ kind: 'number', key, group, label, min, max, step, stage, unit, hint });

export const PARAM_DEFS: readonly ParamDef[] = [
  n('heroHp', 'Герой и урон', 'HP героя', 1, 40, 1),
  n('heroRadius', 'Герой и урон', 'Радиус героя', 0.2, 0.7, 0.05, 1, 'ед.'),
  n('contactDamage', 'Герой и урон', 'Урон касания', 0, 5, 1),
  n('enemyCooldown', 'Герой и урон', 'Перезарядка удара врага', 0.2, 3, 0.05, 1, 'с'),
  n('invulnerability', 'Герой и урон', 'Неуязвимость после удара', 0, 2, 0.05, 1, 'с'),
  n('touchFactor', 'Герой и урон', 'Касание: доля радиуса врага', 0.3, 1.2, 0.05, 1, '×', 'Враг ранит, только если его круг, уменьшенный до этой доли, касается героя.'),
  n('enemyRadius', 'Враги', 'Радиус врага', 0.2, 0.7, 0.02, 1, 'ед.'),
  n('enemySpeed', 'Враги', 'Скорость врага', 0.2, 4, 0.05, 1, 'ед/с'),
  n('toughShareStart', 'Враги', 'Доля крепких на старте', 0, 1, 0.05),
  n('toughShareStep', 'Враги', 'Рост доли крепких', 0, 0.3, 0.01),
  n('toughShareInterval', 'Враги', 'Рост доли крепких — каждые', 5, 300, 5, 1, 'с'),
  n('toughShareMax', 'Враги', 'Предел доли крепких', 0, 1, 0.05),
  n('spawnInterval', 'Появление', 'Интервал появления', 0.1, 5, 0.05, 1, 'с'),
  n('spawnSpeedup', 'Появление', 'Ускорение появления за ступень', 0, 0.5, 0.01),
  n('spawnTierSeconds', 'Появление', 'Ступень появления', 5, 120, 5, 1, 'с'),
  n('maxEnemies', 'Появление', 'Предел врагов на арене', 1, 150, 1),
  n('markerDelay', 'Появление', 'Задержка метки', 0, 3, 0.1, 1, 'с'),
  n('spawnMinDistance', 'Появление', 'Не ближе к герою', 0, 6, 0.25, 1, 'ед.'),
  n('angerTierSeconds', 'Злость', 'Ступень злости', 5, 120, 5, 1, 'с'),
  n('angerSpeedStep', 'Злость', 'Скорость за ступень', 0, 0.5, 0.01),
  n('angerCooldownStep', 'Злость', 'Сокращение перезарядки за ступень', 0, 0.5, 0.01),
  n('minCooldown', 'Злость', 'Перезарядка не меньше', 0.05, 2, 0.05, 1, 'с'),
  n('linkRadius', 'Цепь', 'Радиус звена R', 0.5, 4, 0.05, 2, 'ед.'),
  { kind: 'bool', key: 'lineOfSight', group: 'Цепь', label: 'Препятствия рвут звено', stage: 2 },
  n('dashSpeed', 'Цепь', 'Скорость прохода', 2, 40, 0.5, 2, 'ед/с'),
  n('focusSlow', 'Фокус', 'Замедление в фокусе', 0.02, 1, 0.01, 2, '×'),
  n('focusMax', 'Фокус', 'Запас фокуса', 0, 10, 0.1, 2, 'с'),
  n('focusRegen', 'Фокус', 'Восстановление', 0, 5, 0.1, 2, 'с/с'),
  { kind: 'bool', key: 'focusKillRefill', group: 'Фокус', label: 'Восстановление за убийства', stage: 2 },
  n('focusPerKill', 'Фокус', 'Фокус за убийство', 0, 2, 0.05, 2, 'с'),
  n('energyPerKill', 'Прыжок', 'Энергия за врага', 0, 3, 0.1, 2),
  n('jumpCost', 'Прыжок', 'Цена прыжка', 0, 10, 0.5, 2),
  n('jumpRadius', 'Прыжок', 'Радиус прыжка', 0.5, 8, 0.25, 2, 'ед.'),
  { kind: 'choice', key: 'dimMode', group: 'Вид', label: 'Приглушение не того цвета', stage: 2,
    options: [{ value: 'darken', label: 'затемнение' }, { value: 'alpha', label: 'полупрозрачность' }, { value: 'desaturate', label: 'обесцвечивание' }] },
  n('dimStrength', 'Вид', 'Сила приглушения', 0, 1, 0.05, 2),
  { kind: 'choice', key: 'enemyLook', group: 'Вид', label: 'Вид врагов', stage: 1,
    options: [{ value: 'circle', label: 'круги со знаком' }, { value: 'sprite', label: 'иллюстрация' }] },
  { kind: 'bool', key: 'showHitboxes', group: 'Вид', label: 'Показать круги касания', stage: 1 },
  n('boarWindup', 'Кабан', 'Объявление рывка', 0.2, 3, 0.1, 3, 'с'),
  n('boarDamage', 'Кабан', 'Урон рывка', 0, 6, 1, 3),
  n('boarKnockback', 'Кабан', 'Отброс героя', 0, 4, 0.25, 3, 'ед.'),
];

const STORAGE_KEY = 'ashen-oath-realtime-params-v1';

function sanitize(raw: unknown): Params {
  const out: Params = { ...DEFAULT_PARAMS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const def of PARAM_DEFS) {
    const v = src[def.key];
    if (def.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) target[def.key] = Math.min(def.max, Math.max(def.min, v));
    else if (def.kind === 'bool' && typeof v === 'boolean') target[def.key] = v;
    else if (def.kind === 'choice' && typeof v === 'string' && def.options.some(o => o.value === v)) target[def.key] = v;
  }
  return out;
}

export function loadParams(): Params {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

export function saveParams(params: Params): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch { /* storage may be unavailable */ }
}

export function setParam(params: Params, key: ParamKey, value: unknown): void {
  const next = sanitize({ ...params, [key]: value });
  (params as unknown as Record<string, unknown>)[key] = (next as unknown as Record<string, unknown>)[key];
}

/** Values that follow from time and the base numbers; the panel shows them live. */
export interface Pressure {
  angerTier: number;
  spawnTier: number;
  spawnInterval: number;
  enemySpeed: number;
  enemyCooldown: number;
  toughShare: number;
}

export function pressureAt(params: Params, time: number): Pressure {
  const angerTier = Math.floor(time / params.angerTierSeconds);
  const spawnTier = Math.floor(time / params.spawnTierSeconds);
  const toughSteps = Math.floor(time / params.toughShareInterval);
  return {
    angerTier,
    spawnTier,
    spawnInterval: params.spawnInterval / Math.pow(1 + params.spawnSpeedup, spawnTier),
    enemySpeed: params.enemySpeed * Math.pow(1 + params.angerSpeedStep, angerTier),
    enemyCooldown: Math.max(params.minCooldown, params.enemyCooldown * Math.pow(1 - params.angerCooldownStep, angerTier)),
    toughShare: Math.min(params.toughShareMax, params.toughShareStart + params.toughShareStep * toughSteps),
  };
}

/** Seconds a hero survives standing in a crowd: each hit is followed by invulnerability. */
export function crowdLifetime(params: Params): number {
  if (params.contactDamage <= 0) return Infinity;
  return Math.ceil(params.heroHp / params.contactDamage) * params.invulnerability;
}
