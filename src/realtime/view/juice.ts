/**
 * Task 35 «Сочность, пакет 1» (design 15.10.2026, docs/design-notes/task-35-juice.md): the pure part of the view's juice — no Pixi,
 * no DOM, nothing of the world changes (no `Params`, the hash and the journal stay). Unit-tested in Node (juice.spec.ts).
 * - С1 «Тряска и вспышки»: the viewer's level 0 / 50 / 100 % — a factor on the camera shake and on the full-screen flash; at 0 no
 *   full-screen flash at all. Whatever the level, at most `FLASH_CAP` full-screen flashes start in any second (WCAG 2.3.1).
 * - С2: the shards of a dead enemy — their count grows with the link's number in the chain.
 * - С3: the count-up of a number in the header.
 */

/** С1: the levels of «Тряска и вспышки», per cent (the gear and the sandbox panel offer these). */
export const FX_LEVELS = [100, 50, 0] as const;
export type FxLevel = typeof FX_LEVELS[number];
export const FX_DEFAULT: FxLevel = 100;

/** С1: a stored value back to a level (junk — the default). */
export function fxLevelOf(raw: unknown): FxLevel {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return (FX_LEVELS as readonly unknown[]).includes(n) ? n as FxLevel : FX_DEFAULT;
}

/** С1: full-screen flashes allowed to start in any window of `FLASH_WINDOW` seconds (WCAG 2.3.1: no more than three a second). */
export const FLASH_CAP = 3;
export const FLASH_WINDOW = 1;

/** С1: the cap on full-screen flashes — a sliding window of the starts (real seconds of the view's clock). */
export class FlashGate {
  private starts: number[] = [];
  /** May a flash start at `now`? Yes — it is counted. */
  allow(now: number): boolean {
    this.starts = this.starts.filter(t => now - t < FLASH_WINDOW);
    if (this.starts.length >= FLASH_CAP) return false;
    this.starts.push(now);
    return true;
  }
  reset(): void { this.starts = []; }
}

/** С2: shards of the first link and from `SHARDS_FULL_LINK` on (a kill outside a chain — as the first link). */
export const SHARDS_MIN = 4, SHARDS_MAX = 8, SHARDS_FULL_LINK = 6;
/** С2: real seconds a shard lives: the first link — the shortest, the full link — the longest. */
export const SHARD_LIFE_MIN = 0.2, SHARD_LIFE_MAX = 0.3;

/** С2: the shards of a kill by its link's number in the dash (1, 2, …; 0 or less — not a chain kill): 4 → 8 by the 6th. */
export function shardCount(link: number): number {
  const k = Math.max(0, Math.min(1, (link - 1) / (SHARDS_FULL_LINK - 1)));
  return Math.round(SHARDS_MIN + (SHARDS_MAX - SHARDS_MIN) * k);
}

/** С2: a shard's life by the link's number, as `shardCount`. */
export function shardLife(link: number): number {
  const k = Math.max(0, Math.min(1, (link - 1) / (SHARDS_FULL_LINK - 1)));
  return SHARD_LIFE_MIN + (SHARD_LIFE_MAX - SHARD_LIFE_MIN) * k;
}

/** С4 «Тяжёлый клинок»: the chain line's width factor and the hit's shift, semitones (design 15.10.2026). */
export const HEAVY_LINE = 1.4, HEAVY_SEMIS = -5;

/**
 * Task 47, С7 (design 16.10.2026): the hero's squash and stretch at the dash's start (stretched up) and end (squashed), `SQUASH_TIME`
 * real seconds, at most `SQUASH_MAX` of his size; the С1 level scales it (0 — none). The drawing only: his body and the input stay.
 */
export const SQUASH_TIME = 0.1, SQUASH_MAX = 0.15;
export type SquashKind = 'start' | 'end';

/** С7: the hero's drawing scale `t` seconds into a squash of `kind` at the level (per cent): x and y factors. */
export function squashScale(kind: SquashKind, t: number, level: number): { x: number; y: number } {
  if (t < 0 || t >= SQUASH_TIME || level <= 0) return { x: 1, y: 1 };
  // Full at once, eased back to 1 (ease-out); stretch — taller and narrower, squash — lower and wider.
  const k = 1 - t / SQUASH_TIME, a = SQUASH_MAX * Math.min(1, level / 100) * k * k, s = kind === 'start' ? 1 : -1;
  return { x: 1 - a * s, y: 1 + a * s };
}

/** Task 47, С4 «Длинная рука»: real seconds the reach ring burns brighter when the counters' window gives R ×1.5. */
export const LONG_ARM_FLASH = 0.2;

/** Task 47, С4 «Быстрые ноги»: the speed lines behind the dashing hero — how many, their spacing across and length (units). */
export const SPEED_LINES = 3, SPEED_LINE_GAP = 0.22, SPEED_LINE_LEN = 0.9;

/** Task 47, С4 «Ударная волна»: the hum's strength 0.3–1 by the bodies the wave struck (full from `WAVE_FULL`). */
export const WAVE_FULL = 6;
export function waveStrength(struck: number): number {
  return 0.3 + 0.7 * Math.max(0, Math.min(1, struck / WAVE_FULL));
}

/** С3: real seconds a header number takes to count up to its new value (0.3 for a step of one, 0.6 from six on). */
export function countUpTime(step: number): number {
  return Math.max(0.3, Math.min(0.6, 0.3 + 0.06 * (Math.abs(step) - 1)));
}

/** С3: the shown value at `t` seconds of a count from `from` to `to` lasting `total` (ease-out; whole numbers). */
export function countUpValue(from: number, to: number, t: number, total: number): number {
  if (total <= 0 || t >= total) return to;
  const k = 1 - Math.pow(1 - Math.max(0, t) / total, 2);
  return Math.round(from + (to - from) * k);
}
