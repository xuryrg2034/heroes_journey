/**
 * Task 16 telemetry «Новизна» (design 13.10.2026; docs/realtime-telemetry.md, «Подвиги и новизна»): the viewer's memory of the
 * concepts met for the first time — `elite`, `goblin-bust`, `bag`, `feat`, `second-wind`, `heal-button`, `circle`. The kinds and
 * the elite affixes (`kind:<kind>`, `affix:<affix>`) are `NewSeenStore`'s (view/newSeen.ts). The view decides «first» here and
 * reports it (`RtRecorder.firstMeet`). A view feature only: not a Param, never in the journal, the hash or the run save; the
 * sandbox and the prologue neither read nor write it. Memory starts 14.10.2026: a viewer who met these before counts them once more.
 */
export const FIRST_MEET_KEY = 'ashen-oath-realtime-firsts';
const FIRST_MEET_VERSION = 1;
/** The ids of this store (the kinds and affixes are NewSeenStore's). */
export const FIRST_MEET_IDS = ['elite', 'goblin-bust', 'bag', 'feat', 'second-wind', 'heal-button', 'circle'] as const;
export type FirstMeetId = typeof FIRST_MEET_IDS[number];

/** The part of `Storage` the store uses (a plain object in the Node test). */
export interface FirstMeetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The viewer's memory of first meetings. Storage is optional: without it (or when it throws) nothing is kept past the page. */
export class FirstMeetStore {
  private met = new Set<string>();

  constructor(private readonly storage: FirstMeetStorage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })()) {
    try {
      const raw = this.storage?.getItem(FIRST_MEET_KEY);
      const value = raw ? JSON.parse(raw) as { version?: unknown; met?: unknown } : null;
      if (value && value.version === FIRST_MEET_VERSION && Array.isArray(value.met)) this.met = new Set(value.met.filter((v): v is string => typeof v === 'string'));
    } catch { /* unreadable: nothing met */ }
  }

  has(id: FirstMeetId): boolean { return this.met.has(id); }

  /** The viewer meets `id`: true the first time ever (then it is kept). */
  meet(id: FirstMeetId): boolean {
    if (this.met.has(id)) return false;
    this.met.add(id);
    try { this.storage?.setItem(FIRST_MEET_KEY, JSON.stringify({ version: FIRST_MEET_VERSION, met: [...this.met].sort() })); } catch { /* storage may be unavailable */ }
    return true;
  }
}
