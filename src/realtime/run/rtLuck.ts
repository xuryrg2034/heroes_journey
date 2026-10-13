/**
 * П5 «Журнал удачи» (docs/realtime-engagement-research.md, П5; docs/realtime-slice.md, section 9): the run's tally of chance —
 * what came against what the shown odds expected. The run-end screen shows it in a block «Удача похода», collapsed by
 * default. The tally is part of the run save (`RtRunState.luck`, version 7, optional): it survives reloads and does not
 * depend on the telemetry buffer. The simulation never reads it; the run's outputs for its seed do not depend on it.
 *
 * One entry per source (`RtLuckKey`), each a count of the same shape (`RtLuckCount`): tries, hits (the outcome counted
 * came), expected hits (the sum of the chances the player saw for it). Sources:
 * - `slot-rain`, `slot-volley` — «Однорукий гоблин»: every safe pull («Перебор»'s risky pulls draw no skulls and are not
 *   counted; their bust chance is not tallied — 12.10.2026; nor the safe pulls of a sure triple, `slotSafeTriple`, the run's
 *   since 13.10.2026 — so a run of today tallies no goblin) (the sim's `slot` event `pull`, which carries the odds the
 *   lever showed — the same `pullOdds`); a hit — the rain (☠☠☠) or the volley (two ☠). Written by the fight
 *   (`RtArenaOutcome.luck`, main.ts reads the events every frame).
 * - `elite-loot` — an armoured elite killed by the player (the sim's `eliteDown`, `credited`); a hit — its loot fell (the
 *   `loot` events after it); expected 1 each: armour always leaves loot (sim/elites.ts `armorLoot`). Elites without armour
 *   (never in a run: the run turns `eliteArmor` on) send no `eliteDown` and are not counted. Written by the fight.
 * - `die` — «Кость у двери»: every roll («Забрать» is no roll); a hit — faces 4–6; expected ½ each. Written by the run
 *   (`rtDieChoose`).
 * - `casino-dice` — «Кости» of the goblins' circle (B7 К9): every game; a hit — two dice summing 8 or more; expected 15/36
 *   each. Written by the run (`rtCasinoPlay`). The circle's wheel spins are listed as event outcomes (rtRun.ts `rtCasinoLuck`).
 * Event outcomes with odds are not stored here: the save already keeps every choice and its outcome (`eventChoices`), so
 * their lines are read from it (rtRun.ts `rtEventLuck`), also for a save written before the tally.
 *
 * A new source (the queue's B5–B7): add its key to `RtLuckKey` and `RT_LUCK_KEYS` (and to `RT_FIGHT_LUCK_KEYS` if a fight
 * writes it), add its counts where it happens (`addLuck`), and give it a line in `LUCK_LINES`. The save check
 * (`validLuckTally`) follows the keys. «Азарт» of the start gift is not a source.
 */
import type { WorldEvent } from '../sim/world';
import { slotOddsText } from '../sim/slotPlan';

export type RtLuckKey = 'slot-rain' | 'slot-volley' | 'elite-loot' | 'die' | 'casino-dice';
export const RT_LUCK_KEYS: readonly RtLuckKey[] = ['slot-rain', 'slot-volley', 'elite-loot', 'die', 'casino-dice'];
/** The keys a fight writes (`RtArenaOutcome.luck`); the others the run writes itself. */
export const RT_FIGHT_LUCK_KEYS: readonly RtLuckKey[] = ['slot-rain', 'slot-volley', 'elite-loot'];

/** One source's count: tries, hits that came, hits expected by the shown chances (0 ≤ hits ≤ tries, 0 ≤ expected ≤ tries). */
export interface RtLuckCount { tries: number; hits: number; expected: number }
export type RtLuckTally = Partial<Record<RtLuckKey, RtLuckCount>>;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
/** Sums of chances may land a hair over a whole number of tries. */
const EPS = 1e-9;

export function validLuckCount(value: unknown): value is RtLuckCount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !['tries', 'hits', 'expected'].includes(key))) return false;
  return isCount(v.tries) && v.tries >= 1 && isCount(v.hits) && v.hits <= v.tries
    && typeof v.expected === 'number' && Number.isFinite(v.expected) && v.expected >= 0 && v.expected <= v.tries + EPS;
}
/** A saved tally: known keys of `keys`, at least one, each a valid count. */
export function validLuckTally(value: unknown, keys: readonly RtLuckKey[] = RT_LUCK_KEYS): value is RtLuckTally {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([key, count]) => (keys as readonly string[]).includes(key) && validLuckCount(count));
}

/** `into` plus the valid counts of `from` under `keys` (a new tally; malformed entries are skipped). Undefined — nothing. */
export function addLuck(into: RtLuckTally | undefined, from: unknown, keys: readonly RtLuckKey[] = RT_LUCK_KEYS): RtLuckTally | undefined {
  if (!from || typeof from !== 'object') return into;
  const out: RtLuckTally = { ...into };
  for (const key of keys) {
    const add = (from as Record<string, unknown>)[key];
    if (!validLuckCount(add)) continue;
    const was = out[key];
    out[key] = was ? { tries: was.tries + add.tries, hits: was.hits + add.hits, expected: was.expected + add.expected } : { ...add };
  }
  return Object.keys(out).length ? out : undefined;
}
/** One try of `key` (its hit, its chance) added to `tally` in place. */
export function countLuck(tally: RtLuckTally, key: RtLuckKey, hit: boolean, chance: number): void {
  const was = tally[key] ?? { tries: 0, hits: 0, expected: 0 };
  tally[key] = { tries: was.tries + 1, hits: was.hits + (hit ? 1 : 0), expected: was.expected + Math.max(0, Math.min(1, chance)) };
}

/**
 * The fight's sources in one frame's (or tick's) events, added to `tally` in place: the goblin's pulls with the odds they
 * showed, the player's kills of armoured elites and whether their loot fell.
 */
export function observeFightLuck(tally: RtLuckTally, events: readonly WorldEvent[]): void {
  events.forEach((ev, i) => {
    // «Перебор»: a risky pull draws no skulls (no rain or volley to be lucky or unlucky with).
    // «Безопасный рывок — тройка» (task 11): a safe pull of a sure triple draws no skulls either.
    if (ev.type === 'slot' && ev.action === 'pull' && !ev.risky && !ev.triple) {
      countLuck(tally, 'slot-rain', ev.outcome === 'rain', ev.rain ?? 0);
      countLuck(tally, 'slot-volley', ev.outcome === 'volley', ev.volley ?? 0);
    } else if (ev.type === 'eliteDown' && ev.credited) {
      // The loot of this death follows it in the same buffer (sim/elites.ts `eliteDeath`).
      const next = events[i + 1];
      countLuck(tally, 'elite-loot', next?.type === 'loot' && !next.picked, 1);
    }
  });
}

/** One line of the block: what source, the text. */
export interface RtLuckLine { id: string; label: string; text: string }
/** An event outcome with odds as the event screen showed it (rtRun.ts `rtEventLuck`). */
export interface RtEventLuck { title: string; option: string; outcome: string; odds: string }

/** «0,4»; whole numbers without a fraction («2»). */
export function luckNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace('.', ',');
}
const word = (n: number, one: string, few: string, many: string): string => {
  const tens = n % 100, ones = n % 10;
  return `${n} ${tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many}`;
};
const vs = (count: RtLuckCount): string => `${count.hits} (ожидание ${luckNumber(count.expected)})`;

/** The lines of the stored sources, in the block's order; a source with no try has none. */
const LUCK_LINES: readonly ((tally: RtLuckTally) => RtLuckLine | null)[] = [
  tally => {
    const rain = tally['slot-rain'], volley = tally['slot-volley'];
    if (!rain || !volley) return null;
    const odds = slotOddsText({ rain: rain.expected / rain.tries, volley: volley.expected / volley.tries });
    return { id: 'slot', label: 'Гоблин', text: `${word(rain.tries, 'рывок', 'рывка', 'рывков')} · на рычаге в среднем ${odds} · выпало: дождь ${vs(rain)}, залп ${vs(volley)}` };
  },
  tally => {
    const die = tally.die;
    return die ? { id: 'die', label: 'Кость у двери', text: `${word(die.tries, 'бросок', 'броска', 'бросков')} · 4–6 выпало ${vs(die)}` } : null;
  },
  tally => {
    // B7 К9: «Кости» of the goblins' circle — the winning sum (8+, 15 из 36) against its expectation.
    const dice = tally['casino-dice'];
    return dice ? { id: 'casino-dice', label: 'Кости (игорный круг)', text: `${word(dice.tries, 'игра', 'игры', 'игр')} · 8+ выпало ${vs(dice)}` } : null;
  },
  tally => {
    // Design 12.10.2026: no line while the loot has no chance (armour always leaves it — every run); it comes back with a chance.
    const loot = tally['elite-loot'];
    if (!loot || Math.abs(loot.expected - loot.tries) < EPS) return null;
    return { id: 'elite-loot', label: 'Добыча элит', text: `${loot.hits} из ${loot.tries} (ожидание ${luckNumber(loot.expected)})` };
  },
];

/** The block's lines: the stored sources, then each event outcome with odds. Empty — no chance in the run. */
export function rtLuckLines(tally: RtLuckTally | undefined, events: readonly RtEventLuck[] = []): RtLuckLine[] {
  const lines = LUCK_LINES.map(line => line(tally ?? {})).filter((line): line is RtLuckLine => !!line);
  events.forEach((ev, i) => lines.push({ id: `event-${i}`, label: `«${ev.title}»`, text: `${ev.option}: ${ev.outcome} — шанс ${ev.odds}` }));
  return lines;
}
