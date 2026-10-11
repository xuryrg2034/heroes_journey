/**
 * П10 «Личный рекорд» (docs/realtime-engagement-research.md, П10; docs/realtime-slice.md, section 9): the fight result
 * screen of a run says «Лучшая цепь боя 6 · похода 7 · рекорд 9». The unit is kills in one chain (`stats.bestChain`, the
 * HUD's «цепь N»). A view feature only: not a Param, never in the journal or the hash; the simulation does not read it.
 *
 * - **Fight** — this fight's longest chain.
 * - **Run** — the longest over the run's recorded fights (`RtBattleRecord.bestChain` in the run save, rtRun.ts
 *   `rtRunBestChain`), this one included. Lost fights and `?seed=` runs count.
 * - **Record** — the viewer's all-time longest run chain, kept in the viewer's `localStorage` (`CHAIN_RECORD_KEY`). The
 *   sandbox never writes it.
 * - **Flash** — a short flash of the line on the result screen (never in the fight) when the fight beats a value that
 *   existed before it: the stored record (`record`), else the run's best of its earlier fights (`run`). The first fight of a
 *   run and the viewer's first fight ever beat nothing yet — no flash.
 */

export const CHAIN_RECORD_KEY = 'ashen-oath-realtime-chain-record';
const CHAIN_RECORD_VERSION = 1;

/** The part of `Storage` the store uses (a plain object in the Node test). */
export interface ChainRecordStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The viewer's all-time chain record. Storage is optional: without it (or when it throws) nothing is kept. */
export class ChainRecordStore {
  constructor(private readonly storage: ChainRecordStorage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })()) {}

  /** The stored record; null — none yet (or unreadable). */
  best(): number | null {
    try {
      const raw = this.storage?.getItem(CHAIN_RECORD_KEY);
      const value = raw ? JSON.parse(raw) as { version?: unknown; best?: unknown } : null;
      return value && value.version === CHAIN_RECORD_VERSION && isCount(value.best) ? value.best : null;
    } catch { return null; }
  }

  /** A run fight ended with `chain` as its longest chain: the record becomes the larger of the two. */
  submit(chain: number): void {
    if (!isCount(chain)) return;
    const before = this.best();
    if (before !== null && before >= chain) return;
    try { this.storage?.setItem(CHAIN_RECORD_KEY, JSON.stringify({ version: CHAIN_RECORD_VERSION, best: chain })); } catch { /* storage may be unavailable */ }
  }
}

/** What the result screen shows: the three numbers, the flash (null — none) and the line's text. */
export interface ChainLine { fight: number; run: number; record: number; flash: 'record' | 'run' | null; text: string }

/**
 * The line of a run fight whose longest chain is `fight`: `runBefore` — the run's best of its earlier fights (null — none
 * recorded), `recordBefore` — the stored record before this fight (null — none).
 */
export function chainLine(fight: number, runBefore: number | null, recordBefore: number | null): ChainLine {
  const run = Math.max(runBefore ?? 0, fight), record = Math.max(recordBefore ?? 0, fight);
  const flash = recordBefore !== null && fight > recordBefore ? 'record' : runBefore !== null && fight > runBefore ? 'run' : null;
  return { fight, run, record, flash, text: `Лучшая цепь боя ${fight} · похода ${run} · рекорд ${record}` };
}
