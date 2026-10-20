/**
 * Task 51ж «Разминка», the view side (design 16.10.2026, docs/design-notes/task-51-camp-l3.md, section 5; rules — run/warmup.ts). The
 * pure part, testable in Node (`npm run test:realtime-warmup-view`): the texts of the choice screen, the label at the hero, the result.
 *
 * A view feature only: it reads the world and `run/warmup.ts`, sends no command, is no Param, in no journal, no hash. The score of
 * an attempt is core's (`warmupScore`); the label here only SHOWS the numbers the score is made of.
 */
import type { World } from '../sim/world';
import { WARMUP_LAYOUTS, WARMUP_TICKS_PER_SECOND, warmupLayout, type WarmupEnd, type WarmupId, type WarmupMerge, type WarmupRecords } from '../run/warmup';
import type { LabelSpec } from './worldLabels';

/** The speaker of `warmup_record`: Ерофей while he is at the fire, else Неясыть (spec 5). */
export const warmupSpeaker = (smithHere: boolean): 'smith' | 'owl' => (smithHere ? 'smith' : 'owl');

/** «1 звено», «2 звена», «5 звеньев»; the same for any triple of forms. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tail = Math.abs(n) % 100, last = tail % 10;
  if (tail >= 11 && tail <= 14) return many;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

/** Seconds with a decimal comma: `12,3`. */
const seconds = (value: number): string => value.toFixed(1).replace('.', ',');

/** A score in the layout's unit: «7 звеньев», «12,3 с», «14 убийств». */
export function scoreText(id: WarmupId, score: number): string {
  const metric = warmupLayout(id).metric;
  if (metric === 'clearTime') return `${seconds(score)} с`;
  return metric === 'chain' ? `${score} ${plural(score, 'звено', 'звена', 'звеньев')}` : `${score} ${plural(score, 'убийство', 'убийства', 'убийств')}`;
}

/** What the layout asks, on its row of the choice screen (one short line). */
export const WARMUP_GOALS: Readonly<Record<WarmupId, string>> = {
  'warmup-line': 'Самая длинная цепь за 20 с',
  'warmup-mix': 'Чистое поле как можно быстрее',
  'warmup-gap': 'Убийств за 30 с, с прыжком и вихрем',
};

/** A row of the choice screen: the layout, what it asks, the record («—» — none yet). */
export interface WarmupRow { id: WarmupId; title: string; goal: string; record: string; best: number | null }

export function warmupRows(records: WarmupRecords | undefined): WarmupRow[] {
  return WARMUP_LAYOUTS.map(layout => {
    const best = records?.[layout.id]?.best ?? null;
    return { id: layout.id, title: layout.title, goal: WARMUP_GOALS[layout.id], record: best === null ? '—' : scoreText(layout.id, best), best };
  });
}

/** Whole seconds left of the attempt's limit (rounded up), never below 0. */
export const secondsLeft = (world: World, id: WarmupId): number => Math.max(0, Math.ceil((warmupLayout(id).limitTicks - world.tick) / WARMUP_TICKS_PER_SECOND));

/** The links of the longest chain so far: the finished ones and the dash going now (as core's score reads it). */
export const chainSoFar = (world: World): number => Math.max(world.stats.bestChain, world.move?.kind === 'dash' ? world.move.kills : 0);

/**
 * The label at the hero while an attempt plays (a world label, not a HUD item): the timer, and the number the record is made of —
 * «Строй»: `20 с · цепь 5`; «Пестрота»: the game time `12,3 с`; «Через пропасть»: `24 с · убито 7`.
 */
export function warmupLabelText(id: WarmupId, world: World): string {
  const metric = warmupLayout(id).metric;
  if (metric === 'clearTime') return `${seconds(world.time)} с`;
  const left = `${secondsLeft(world, id)} с`;
  return metric === 'chain' ? `${left} · цепь ${chainSoFar(world)}` : `${left} · убито ${world.stats.kills}`;
}

/** The label's spec: over the hero (`place: 'above'`), nothing else. */
export function warmupLabel(id: WarmupId, world: World): LabelSpec {
  return { id: 'warmup', text: warmupLabelText(id, world), at: { x: world.hero.x, y: world.hero.y }, place: 'above', lift: 1.25 };
}

/** What the result panel says. */
export interface WarmupResultText {
  /** The headline: the layout's name, or the death. */
  title: string;
  /** What the attempt gave: the score, or why there is none. */
  line: string;
  /** The record: «Новый рекорд!», «Рекорд: …»; '' — none to speak of. */
  record: string;
  /** The attempt set a new best (the NPC's line follows). */
  isRecord: boolean;
}

export function warmupResultText(id: WarmupId, end: WarmupEnd, score: number | null, merge: Pick<WarmupMerge, 'before' | 'record'>): WarmupResultText {
  const title = warmupLayout(id).title;
  const best = merge.record ? score : merge.before;
  const record = merge.record ? 'Новый рекорд!' : best !== null ? `Рекорд: ${scoreText(id, best)}` : '';
  if (end === 'death') return { title, line: 'Погиб — без итога', record, isRecord: false };
  if (score === null) return { title, line: end === 'limit' && warmupLayout(id).metric === 'clearTime' ? 'Поле не очищено — без итога' : 'Без итога', record, isRecord: false };
  return { title, line: scoreText(id, score), record, isRecord: merge.record };
}
