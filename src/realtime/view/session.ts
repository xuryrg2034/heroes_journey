/**
 * П7 «Часы сессии» (docs/realtime-engagement-research.md, docs/realtime-slice.md): the viewer's play session — a view
 * setting only. Not a Param, never in the journal or the hash; the run and the simulation do not read it.
 *
 * Definition. A session is a stretch of play with no gap of 10 minutes or more between two signs of life (a start, a click on
 * the run screen, a heartbeat every 30 s while the tab is visible). «В игре» is the wall time from the session's start to its
 * last sign of life, so a pause under 10 minutes counts as play. A gap of 10+ minutes (the tab hidden or closed, the
 * computer asleep) is a break: the next sign of life starts a new session (time 0, runs 0, no nudge given). The record
 * survives reloads in the viewer's `localStorage`. «Походов» is the number of runs started in the session.
 *
 * The nudge: after 90 minutes of one session, one quiet line on the run map; again no sooner than 90 minutes after it.
 */

/** A pause of this length ends the session. */
export const SESSION_BREAK_MS = 10 * 60_000;
/** The nudge comes after this much play, and again no sooner than this after the last one. */
export const SESSION_NUDGE_MS = 90 * 60_000;
export const SESSION_NUDGE_TEXT = 'Хорошее место остановиться — поход сохранён';
export const SESSION_STORAGE_KEY = 'ashen-oath-realtime-session';

interface Record_ { start: number; last: number; runs: number; nudged: number | null }

/** The part of `Storage` the clock uses (a plain object in the Node test). */
export interface SessionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class SessionClock {
  private rec: Record_ | null = null;
  /** The test hook moves the clock forward by this much (never stored). */
  private skew = 0;

  constructor(private readonly storage: SessionStorage | null = typeof localStorage !== 'undefined' ? localStorage : null,
    private readonly wall: () => number = () => Date.now()) {}

  now(): number { return this.wall() + this.skew; }
  /** Test hook: pretend `ms` more wall time has passed (Playwright cannot wait 90 minutes). */
  advance(ms: number): void { this.skew += ms; }

  private load(): Record_ | null {
    try {
      const raw = this.storage?.getItem(SESSION_STORAGE_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && Number.isFinite(v.start) && Number.isFinite(v.last) && Number.isFinite(v.runs)) {
        return { start: v.start, last: v.last, runs: Math.max(0, v.runs | 0), nudged: Number.isFinite(v.nudged) ? v.nudged : null };
      }
    } catch { /* unreadable: a new session */ }
    return null;
  }
  private save(): void {
    try { if (this.rec) this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.rec)); } catch { /* storage may be unavailable */ }
  }

  /** A sign of life: continues the session, or starts a new one after a break. Returns the record. */
  touch(): { start: number; last: number; runs: number; nudged: number | null } {
    const now = this.now();
    const rec = this.rec ?? this.load();
    if (!rec || now - rec.last >= SESSION_BREAK_MS) this.rec = { start: now, last: now, runs: 0, nudged: null };
    else { this.rec = rec; rec.last = Math.max(rec.last, now); }
    this.save();
    return this.rec;
  }

  /** A run starts in this session. */
  runStarted(): void { this.touch(); this.rec!.runs += 1; this.save(); }

  /** «В игре 47 мин · походов 2» for the end screen (the current run counts at least as one). */
  endLine(): string {
    const rec = this.touch();
    return `В игре ${formatMinutes(rec.last - rec.start)} · походов ${Math.max(1, rec.runs)}`;
  }

  /** The nudge text when it is due (and records it as given); else null. Call when the map is shown. */
  takeNudge(): string | null {
    const rec = this.touch();
    const due = rec.nudged === null ? rec.last - rec.start >= SESSION_NUDGE_MS : rec.last - rec.nudged >= SESSION_NUDGE_MS;
    if (!due) return null;
    rec.nudged = rec.last;
    this.save();
    return SESSION_NUDGE_TEXT;
  }

  /** For the test hook. */
  info(): { minutes: number; runs: number; nudged: boolean } {
    const rec = this.touch();
    return { minutes: Math.floor((rec.last - rec.start) / 60_000), runs: rec.runs, nudged: rec.nudged !== null };
  }
}

/** «меньше минуты», «47 мин», «1 ч 17 мин», «2 ч». */
export function formatMinutes(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 60_000);
  if (total < 1) return 'меньше минуты';
  if (total < 60) return `${total} мин`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
