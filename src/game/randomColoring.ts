/**
 * Prototype A: random coloring of ordinary enemies (decision of 04.10.2026, docs/random-coloring.md).
 *
 * A pooled battle flagged `coloring: 'random'` (battlePools.ts) keeps its authored scenario — terrain, special
 * enemies, marked targets (place and HP), doors, devices, the cat — and draws the colors of its ordinary enemies on
 * entering, by a seed of its own derived from the battle seed (the run seed and the node id): no run stream and no
 * battle RNG draw is spent, so every other roll of the run and of the battle stays where it was.
 *
 * Pure part: which enemies are recolored, the palette, the candidate generator, the color-group metrics and the cheap
 * checks of the layout. The checks that play the battle (an ordinary chain of two enemies from the cat, no first chain
 * meets the goals) are run by the engine on a private copy (ForestEngine.startRunBattle), and a failed attempt draws
 * the next candidate from the same seed; after RANDOM_COLORING_ATTEMPTS failures the battle keeps its authored colors.
 */
import type { CustomLevelDefinition } from './customLevel';
import type { AuthoredLesson } from './lessonBuilder';
import type { EnemyColor, ForestState } from './forestTypes';
import { chainAdjacent } from './boardGeometry';
import { uniqueEntities } from './entityFootprint';
import { isCellAlive } from './cellLife';
import { mixSeed } from './items';
import type { ForestEngine } from './forestEngine';

/** How a battle colors its opening layout: the authored colors, or prototype A's random coloring. */
export type BattleColoring = 'authored' | 'random';

/**
 * Баланс: attempts of the random coloring before the battle falls back to its authored colors. Measured on 04.10.2026
 * (docs/random-coloring.md, «Замеры»): on 200 battle seeds of each of the four battles the first candidate passed in
 * 793 of 800 entries and the second in the other 7 (boar-garden: 5 without a chain of two, 2 with too large a group),
 * i.e. at most 3.5% of candidates fail. With 8 attempts the fallback is practically never taken here (0.035^8 ≈ 2e-12)
 * and stays below 0.4% even for a battle that rejects half its candidates; an attempt costs 4–35 ms (a load and the
 * forecast of the first chains on a private engine), so the worst case on entering stays about a quarter of a second.
 */
export const RANDOM_COLORING_ATTEMPTS = 8;
/** Баланс: the largest same-color group holds at most this share of the colored enemies (check 3, `largestComponentShare`). */
export const COLORING_MAX_COMPONENT_SHARE = 0.45;
/** Баланс: at least this share of touching colored pairs differ in color (check 3, `colorInterleave`). */
export const COLORING_MIN_INTERLEAVE = 0.3;

/** Salt of the coloring seed: the battle seed mixed with it, so the coloring never shares a draw with the battle RNG. */
const COLORING_SALT = 0x5a17c0de;

type AuthoredEnemy = CustomLevelDefinition['enemies'][number];

/**
 * An ordinary enemy of the layout, the one whose color is drawn: a plain goblin (no variant, not an elite) that is weak
 * (0 HP) or a marked target. Armed weak goblins are ordinary too (they keep their place and weapon, only the color is
 * drawn). Special enemies (boar, archer, shield bearer, shaman, wolf, porcupine, elites, the Jailer, bosses) keep their
 * authored color: it is part of the scenario. A sturdy goblin that is not a target keeps its color as well.
 */
export function isOrdinaryEnemy(enemy: AuthoredEnemy, targetIndices: readonly number[]): boolean {
  return enemy.kind === 'melee' && !enemy.variant && !enemy.elite && enemy.color !== null && (enemy.hp === 0 || targetIndices.includes(enemy.index));
}

/** Check 1: the row palette plus the colors of the battle's special enemies, in the row palette's order. */
export function coloringPalette(lesson: AuthoredLesson, rowPalette: readonly EnemyColor[]): EnemyColor[] {
  const special = lesson.definition.enemies.filter(enemy => enemy.color !== null && !isOrdinaryEnemy(enemy, lesson.targetIndices)).map(enemy => enemy.color as EnemyColor);
  return [...new Set<EnemyColor>([...rowPalette, ...special])];
}

/** Seed of the coloring of a battle: derived from its battle seed (forestNodeSeed in a run). */
export const coloringSeed = (battleSeed: number): number => mixSeed(battleSeed >>> 0, COLORING_SALT);

/** Deterministic uniform draws in [0, 1) from a 32-bit seed (mulberry32). */
export function coloringRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6d2b79f5 >>> 0; let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * One candidate coloring: the lesson with the colors of its ordinary enemies drawn uniformly from `palette`. Ordinary
 * targets are drawn first, each from the colors no other target has yet (check 2 by construction where the palette
 * allows it); the other ordinary enemies follow in layout order. Everything else is the authored lesson unchanged.
 */
export function colorCandidate(lesson: AuthoredLesson, palette: readonly EnemyColor[], random: () => number): AuthoredLesson {
  const { definition, targetIndices } = lesson;
  const pick = (from: readonly EnemyColor[]) => from[Math.min(from.length - 1, Math.floor(random() * from.length))];
  const colors = new Map<number, EnemyColor>();
  const targetColor = (enemy: AuthoredEnemy) => colors.get(enemy.index) ?? enemy.color;
  const targets = definition.enemies.filter(enemy => targetIndices.includes(enemy.index));
  for (const enemy of targets) {
    if (!isOrdinaryEnemy(enemy, targetIndices)) continue;
    const taken = new Set(targets.filter(other => other !== enemy && (!isOrdinaryEnemy(other, targetIndices) || colors.has(other.index))).map(targetColor));
    const free = palette.filter(color => !taken.has(color));
    colors.set(enemy.index, pick(free.length ? free : palette));
  }
  for (const enemy of definition.enemies) if (isOrdinaryEnemy(enemy, targetIndices) && !colors.has(enemy.index)) colors.set(enemy.index, pick(palette));
  return { ...lesson, definition: { ...definition, enemies: definition.enemies.map(enemy => colors.has(enemy.index) ? { ...enemy, color: colors.get(enemy.index)! } : { ...enemy }) } };
}

/**
 * Same-color groups of the living colored enemies, by the chain's own adjacency (8 directions, blocked diagonal
 * corners): the share of the largest group and the share of touching pairs of different colors. The analyzer's
 * `static.largestComponentShare` and `static.colorInterleave` (levelAnalysis.ts) are these numbers.
 */
export function colorGroupMetrics(state: ForestState): { componentSizes: number[]; largestComponentShare: number; colorInterleave: number; colored: number } {
  const entities = uniqueEntities(state.board).filter(({ cell }) => cell.kind !== 'door' && cell.kind !== 'prism' && isCellAlive(cell));
  const colored = entities.filter(({ cell }) => cell.color !== null);
  const touching = (a: number[], b: number[]) => a.some(from => b.some(to => chainAdjacent(state, from, to)));
  const parent = colored.map((_, n) => n);
  const find = (n: number): number => parent[n] === n ? n : (parent[n] = find(parent[n]));
  let pairs = 0, mixed = 0;
  for (let i = 0; i < colored.length; i++) for (let j = i + 1; j < colored.length; j++) {
    if (!touching(colored[i].indices, colored[j].indices)) continue;
    pairs++;
    if (colored[i].cell.color !== colored[j].cell.color) mixed++;
    else parent[find(i)] = find(j);
  }
  const sizes = new Map<number, number>();
  colored.forEach((_, n) => sizes.set(find(n), (sizes.get(find(n)) ?? 0) + 1));
  const componentSizes = [...sizes.values()].sort((a, b) => b - a);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { componentSizes, colored: colored.length,
    largestComponentShare: colored.length ? round(componentSizes[0] / colored.length) : 0, colorInterleave: pairs ? round(mixed / pairs) : 0 };
}

/**
 * Checks 1–3 of a loaded opening (docs/random-coloring.md, section 3): the colors of the ordinary enemies are in the
 * palette, the marked targets have different colors, the largest group and the interleave are within bounds.
 * Null when they pass, else the first failed check.
 */
export function staticColoringProblem(state: ForestState, palette: readonly EnemyColor[], ordinaryIds: ReadonlySet<number>): string | null {
  for (const { cell } of uniqueEntities(state.board)) if (ordinaryIds.has(cell.id) && (cell.color === null || !palette.includes(cell.color))) return 'palette';
  const targets = state.tutorial?.targetIds ?? [];
  const targetColors = targets.map(id => uniqueEntities(state.board).find(({ cell }) => cell.id === id)?.cell.color ?? null);
  if (new Set(targetColors).size !== targetColors.length) return 'targets';
  const groups = colorGroupMetrics(state);
  if (groups.largestComponentShare > COLORING_MAX_COMPONENT_SHARE) return 'group';
  if (groups.colorInterleave < COLORING_MIN_INTERLEAVE) return 'interleave';
  return null;
}

/** Result of the random coloring of one battle entry: the lesson to play and how it was chosen. */
export interface ColoringChoice {
  lesson: AuthoredLesson;
  /** 1-based attempt that passed every check; null — every attempt failed and the authored coloring is kept. */
  attempt: number | null;
}

/**
 * Draw candidates from the battle's coloring seed until `accept` passes one, at most `attempts` of them (the engine's
 * checks 1–5; a test or the analyzer may add the scenario check of section 4 on top). Without a passing candidate the
 * authored lesson is returned. The same seed and `accept` always give the same choice.
 */
export function pickRandomColoring(lesson: AuthoredLesson, palette: readonly EnemyColor[], battleSeed: number,
  accept: (candidate: AuthoredLesson) => boolean, attempts = RANDOM_COLORING_ATTEMPTS): ColoringChoice {
  const random = coloringRandom(coloringSeed(battleSeed));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const candidate = colorCandidate(lesson, palette, random);
    if (accept(candidate)) return { lesson: candidate, attempt };
  }
  return { lesson, attempt: null };
}

/**
 * Optional extra check of every candidate after checks 1–5 (null by default — the game runs none): the scenario
 * checks of section 4 (point 7) or a test's probe plug in here. It gets the battle id and a private engine that has
 * just loaded the candidate; false rejects the candidate like a failed check. Like setEliteMoveEvery (elite.ts) it is a
 * process-wide setting for analysis and tests: reset it to null afterwards.
 */
export type ColoringScenarioCheck = (battleId: string, engine: ForestEngine) => boolean;
let scenarioCheck: ColoringScenarioCheck | null = null;
export function setColoringScenarioCheck(check: ColoringScenarioCheck | null): void { scenarioCheck = check; }
export function coloringScenarioCheck(): ColoringScenarioCheck | null { return scenarioCheck; }
