/**
 * The score of a run (design agreed 04.10.2026, docs/roguelike-runs.md, section 7): shown line by line on the result
 * screen, won or lost, and added to the bar of openings (unlocks.ts). Pure: it reads the finished run (forestRun.ts).
 *
 * Lines: 5 × the last completed row, 2 per ordinary battle won (battles and breakthroughs, the trunk included), 15 per
 * hard battle, 30 for the Jailer, 100 for a boss, 1 per 100 battle points of kills and crystals (rounded down; the
 * engine's turn and win bonuses are not counted — HP and speed are the style bonuses; decision of 04.10.2026); the ladder step adds 5% of these
 * lines per step (rounded down). Style bonuses are not multiplied by the step. A bonus that needs the battle log or the
 * play time is not given to a run that has none (a save from before 04.10.2026).
 */
import type { ForestMapNode } from './forestMap';

// Баланс (docs/roguelike-runs.md, 7).
export const SCORE_PER_ROW = 5, SCORE_BATTLE = 2, SCORE_HARD = 15, SCORE_JAILER = 30, SCORE_BOSS = 100, SCORE_POINTS_PER = 100, SCORE_LADDER_PERCENT = 5;
export const STYLE_CLEAN_HARD = 25, STYLE_CLEAN_BOSS = 50, STYLE_NO_ITEMS = 50, STYLE_FAST = 25, STYLE_GREEDY = 25, STYLE_COLLECTOR = 25, STYLE_ASCETIC = 50;
/** «Быстрый поход»: the run's play time at most this long. */
export const STYLE_FAST_MS = 25 * 60_000;
/** «Жадина»: at least this many chests fell, every one opened. «Коллекционер»: at least this many talismans (oaths count). */
export const STYLE_GREEDY_CHESTS = 3, STYLE_COLLECTOR_TALISMANS = 3;

/** A resolved battle of the run: cat damage taken, consumables used, the exit chest (fell, opened). */
export interface RunBattleRecord {
  nodeId: string; damage: number; items: number; chest?: 'dropped' | 'opened';
  /** Battle points of kills and crystals (absent in records before the decision of 04.10.2026: 0). */
  points?: number;
}
/** What the score reads of a run. */
export interface ScoredRun {
  /** Completed nodes in order and the last one (null before the first). */
  visited: readonly ForestMapNode[];
  current: ForestMapNode | null;
  victory: boolean;
  /** Battle points of the run (`ForestRunState.score`): the «очки боёв» line only for a run without a battle log. */
  points: number;
  ladder: number;
  talismans: number;
  /** Absent in saves before 04.10.2026: no style bonus that needs it. */
  battles?: readonly RunBattleRecord[];
  playMs?: number;
}
export type ScoreLineId = 'row' | 'battles' | 'hard' | 'jailer' | 'boss' | 'points' | 'ladder';
export type StyleId = 'clean-hard' | 'clean-boss' | 'no-items' | 'fast' | 'greedy' | 'collector' | 'ascetic';
export interface ScoreLine<Id extends string> { id: Id; label: string; points: number }
export interface RunScore { lines: ScoreLine<ScoreLineId>[]; styles: ScoreLine<StyleId>[]; total: number }

const ORDINARY = new Set(['battle', 'breakthrough']);

export function runScore(run: ScoredRun): RunScore {
  const won = (test: (node: ForestMapNode) => boolean) => run.visited.filter(test);
  const ordinary = won(node => ORDINARY.has(node.type)).length, hard = won(node => node.type === 'hard'), jailer = won(node => node.type === 'checkpoint').length;
  const boss = won(node => node.type === 'boss');
  const lines: ScoreLine<ScoreLineId>[] = [];
  const add = (id: ScoreLineId, label: string, points: number) => { if (points) lines.push({ id, label, points }); };
  add('row', `Ряд ${run.current?.row ?? 0}`, SCORE_PER_ROW * (run.current?.row ?? 0));
  add('battles', `Обычные бои ×${ordinary}`, SCORE_BATTLE * ordinary);
  add('hard', `Трудные бои ×${hard.length}`, SCORE_HARD * hard.length);
  add('jailer', 'Тюремщик', SCORE_JAILER * jailer);
  add('boss', 'Босс', SCORE_BOSS * boss.length);
  const points = run.battles ? run.battles.reduce((sum, entry) => sum + (entry.points ?? 0), 0) : run.points;
  add('points', `Очки боёв ${points}`, Math.floor(points / SCORE_POINTS_PER));
  const base = lines.reduce((sum, line) => sum + line.points, 0);
  add('ladder', `Ступень клятвы ${run.ladder}: +${SCORE_LADDER_PERCENT * run.ladder}%`, Math.floor(base * SCORE_LADDER_PERCENT * run.ladder / 100));
  const styles: ScoreLine<StyleId>[] = [], battles = run.battles;
  const style = (id: StyleId, label: string, points: number, when: boolean) => { if (when && points) styles.push({ id, label, points }); };
  const record = (node: ForestMapNode) => battles?.find(entry => entry.nodeId === node.id);
  const cleanHard = battles ? hard.filter(node => record(node)?.damage === 0).length : 0;
  style('clean-hard', `Чистый трудный бой ×${cleanHard}`, STYLE_CLEAN_HARD * cleanHard, true);
  style('clean-boss', 'Чистый босс', STYLE_CLEAN_BOSS, run.victory && !!battles && boss.some(node => record(node)?.damage === 0));
  style('no-items', 'Без предметов', STYLE_NO_ITEMS, run.victory && !!battles && battles.every(entry => entry.items === 0));
  style('fast', 'Быстрый поход', STYLE_FAST, run.victory && run.playMs !== undefined && run.playMs <= STYLE_FAST_MS);
  const chests = battles?.filter(entry => entry.chest) ?? [];
  style('greedy', 'Жадина', STYLE_GREEDY, chests.length >= STYLE_GREEDY_CHESTS && chests.every(entry => entry.chest === 'opened'));
  style('collector', 'Коллекционер', STYLE_COLLECTOR, run.talismans >= STYLE_COLLECTOR_TALISMANS);
  style('ascetic', 'Аскет', STYLE_ASCETIC, run.victory && run.talismans === 0);
  const total = lines.reduce((sum, line) => sum + line.points, 0) + styles.reduce((sum, line) => sum + line.points, 0);
  return { lines, styles, total };
}
