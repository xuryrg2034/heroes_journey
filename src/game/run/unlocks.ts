/**
 * The bar of openings (design agreed 04.10.2026, docs/roguelike-runs.md, section 7): the score of every run, won or
 * lost, fills a bar kept in the player profile; each threshold opens content of the pools — talismans, oaths, events —
 * never strength of the cat. At most one level per run; the surplus carries over cut to «next threshold − 1».
 * Pure data and functions: the profile (playerProfile.ts) keeps the bar, a new run keeps its open level (`unlocks`).
 *
 * Events are named by their ids; most of the catalogue (docs/events.md) is not in the code yet (forestEvents.ts has
 * «Ручей у камней» and «Гоблинский тайник»): opening such an event changes nothing until it appears there.
 */
import { TALISMANS, type TalismanId } from '../talismans';

/** Баланс: the cumulative thresholds of levels 1–5 (StS: 300/750/1000/1500/2000 at a victory of about 775). */
export const UNLOCK_THRESHOLDS: readonly number[] = [100, 300, 450, 700, 900];
export const UNLOCK_MAX_LEVEL = UNLOCK_THRESHOLDS.length;

export interface UnlockSet { talismans: TalismanId[]; events: string[] }
/** Open from the start. */
export const UNLOCK_START: UnlockSet = {
  talismans: ['whetstone', 'dew-flask', 'ragman-pouch', 'tough-hide', 'ash-ward', 'oath-hunger', 'oath-poverty'],
  events: ['brook', 'owl-hollow', 'old-trap', 'porcupine-nest', 'wounded-cub', 'wandering-grinder', 'warm-den', 'drunk-cook', 'traveler-fire'],
};
/** Levels 1–5 (index 0 — level 1): what each opens. */
export const UNLOCK_LEVELS: readonly UnlockSet[] = [
  { talismans: ['millstone-shard', 'hourglass'], events: [] },
  { talismans: ['oath-wrath'], events: ['goblin-cache'] },
  { talismans: ['nimble-paws'], events: [] },
  { talismans: [], events: ['ford-ambush', 'bone-wheel'] },
  { talismans: [], events: ['den-bones', 'shaman-idol'] },
];
/**
 * The events of the catalogue (docs/events.md) by id, with one line for the opening screen. Ids of events already in
 * the code are those of forestEvents.ts; the others name the events the catalogue task will add.
 */
export const CATALOGUE_EVENTS: Readonly<Record<string, { title: string; line: string }>> = {
  brook: { title: 'Ручей у камней', line: 'Выбор из выгод: +2 HP, +1 «Холод» или +1 энергия' },
  'owl-hollow': { title: 'Дупло совы', line: 'Подарок: +1 энергия, ресурс или первая цепь следующего боя с запасом 1' },
  'old-trap': { title: 'Старый капкан', line: 'HP за награду: −1 HP → 2 ресурса, или −1 энергия → «Бомба»' },
  'porcupine-nest': { title: 'Гнездо дикобразов', line: 'До трёх попыток за ресурсом, шанс уколоться растёт' },
  'wounded-cub': { title: 'Раненый волчонок', line: 'Перевязать за траву — +1 к максимуму HP, или шкура за злость в следующем бою' },
  'wandering-grinder': { title: 'Бродячий точильщик', line: 'Услуга за ресурсы: обычный талисман или +2 HP' },
  'warm-den': { title: 'Тёплая берлога', line: 'Логово: +2 HP или +2 травы' },
  'drunk-cook': { title: 'Пьяный повар', line: 'Лагерь: похлёбка за 2 ресурса или котелок за раннее подкрепление' },
  'traveler-fire': { title: 'Костёр путника', line: 'Снять все эффекты и +1 HP, или смола → «Огненная склянка»' },
  'goblin-cache': { title: 'Гоблинский тайник', line: 'Риск: 50% — 2 ресурса, 50% — ловушка −2 HP' },
  'ford-ambush': { title: 'Засада у брода', line: 'Бой за награду: обычный талисман на выбор из 2' },
  'bone-wheel': { title: 'Колесо костей', line: 'Крутить за ресурс: шесть исходов по 1/6' },
  'den-bones': { title: 'Кости у логова', line: 'Логово: 50% — необычный талисман, 50% — элита в следующем бою' },
  'shaman-idol': { title: 'Идол шамана', line: 'Лагерь: +2 энергии за −1 к максимуму HP, или +1 ресурс' },
};

/** Everything opened at `level` (0 — the start set only). */
export function unlockedAt(level: number): UnlockSet {
  const sets = [UNLOCK_START, ...UNLOCK_LEVELS.slice(0, Math.max(0, Math.min(UNLOCK_MAX_LEVEL, level)))];
  return { talismans: sets.flatMap(set => set.talismans), events: sets.flatMap(set => set.events) };
}
/** Talismans and oaths a run of open level `level` may get; `undefined` — a run without the bar (saves before it, tests): all. */
export function openTalismans(level: number | undefined): TalismanId[] | undefined {
  return level === undefined ? undefined : TALISMANS.map(entry => entry.id).filter(id => unlockedAt(level).talismans.includes(id));
}
/** The event may appear in a run of open level `level` (`undefined` — every event). */
export function eventOpen(id: string, level: number | undefined): boolean {
  return level === undefined || unlockedAt(level).events.includes(id);
}
export const isUnlockLevel = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UNLOCK_MAX_LEVEL;

/** The bar of a profile: points gathered and the level opened. */
export interface MetaBar { points: number; level: number }
/**
 * The bar after a run that scored `score`: at most one new level (the next threshold reached); the surplus is cut to
 * «the threshold after it − 1», so the next run must score at least one point to open the following level. Past the
 * last level the points still gather (the bar is hidden until new content).
 */
export function applyRunScore(bar: MetaBar, score: number): MetaBar & { opened: number | null } {
  let points = bar.points + Math.max(0, Math.floor(score)), level = bar.level, opened: number | null = null;
  if (level < UNLOCK_MAX_LEVEL && points >= UNLOCK_THRESHOLDS[level]) {
    level++; opened = level;
    if (level < UNLOCK_MAX_LEVEL) points = Math.min(points, UNLOCK_THRESHOLDS[level] - 1);
  }
  return { points, level, opened };
}
/** The next threshold of a bar (null past the last level) and the openings still to come. */
export function barView(bar: MetaBar): { next: number | null; left: number } {
  return { next: bar.level < UNLOCK_MAX_LEVEL ? UNLOCK_THRESHOLDS[bar.level] : null, left: UNLOCK_MAX_LEVEL - bar.level };
}
