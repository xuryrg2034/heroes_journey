/**
 * П8 «Новое на карте» (docs/realtime-engagement-research.md, П8; docs/realtime-slice.md, sections 9 and 12): what the viewer
 * has met, the one-time in-fight caption of a kind or an elite affix, and the sign «✦ новое» on the card of an available node.
 * A view feature only: not a Param, never in the journal, the hash or the run save; the simulation and the run do not read it.
 *
 * - **Memory** — the kinds and affixes the viewer has met, in the viewer's `localStorage` (`NEW_SEEN_KEY`). «Met» = an
 *   enemy of the kind (an elite with the affix) first came into view in a RUN fight (`?seed=` runs too). The sandbox neither
 *   reads nor writes it. Memory is written while the toggle «Новое на карте» is off too (turning it on later floods nothing).
 * - **Caption** — a plate like the elite's «Элита · …», 1.5 s at the enemy, once ever per viewer per kind or affix.
 * - **Sign** — the arena line of an AVAILABLE node card: the arena's template or roster has a captioned kind not met yet.
 *   Affixes are unknown before the fight: no sign for them.
 */
import { arenaKinds } from '../run/arenaKinds';
import type { AffixId } from '../sim/elites';

// Task 26: the kinds of an arena moved to run/arenaKinds.ts (the schedule reads them too); the view keeps its names.
export { arenaKinds, templateKinds } from '../run/arenaKinds';

export const NEW_SEEN_KEY = 'ashen-oath-realtime-new-seen';
const NEW_SEEN_VERSION = 1;
/** The sign on the arena line of the node card. */
export const NEW_SIGN = '✦ новое';

/** The final captions of the kinds (design 12.10.2026; the basic enemy has none). */
export const KIND_CAPTIONS: Readonly<Record<string, string>> = {
  wolf: 'Волк — окружает; в стае бьёт сильнее',
  boar: 'Кабан — после «!» бросается по линии',
  archer: 'Лучник — метит точку: уйдите с неё',
  porcupine: 'Дикобраз — иглы подняты: не бейте цепью',
  sapper: 'Сапёр — горит фитиль: отойдите',
  shield: 'Щитоносец — спереди щит не пускает звено',
  lynx: 'Рысь — замирает, потом прыгает по линии',
  shaman: 'Шаман — лучом усиливает слабого',
};
/** The final captions of the elite affixes (a run fight has the elite armour on: «Толстый» is +1 plate, «Стремительный» −1). */
export const AFFIX_CAPTIONS: Readonly<Record<AffixId, string>> = {
  fiery: 'Огненный — оставляет горящий след',
  chameleon: 'Хамелеон — меняет цвет, ловите окно',
  swift: 'Стремительный — быстрее, на пластину меньше',
  fat: 'Толстый — медленный, на пластину больше',
};

/** The part of `Storage` the store uses (a plain object in the Node test). */
export interface NewSeenStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The viewer's memory of kinds and affixes met. Storage is optional: without it (or when it throws) nothing is kept past the page. */
export class NewSeenStore {
  private kinds = new Set<string>();
  private affixes = new Set<string>();

  constructor(private readonly storage: NewSeenStorage | null = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } })()) {
    try {
      const raw = this.storage?.getItem(NEW_SEEN_KEY);
      const value = raw ? JSON.parse(raw) as { version?: unknown; kinds?: unknown; affixes?: unknown } : null;
      if (value && value.version === NEW_SEEN_VERSION) { this.kinds = new Set(ids(value.kinds)); this.affixes = new Set(ids(value.affixes)); }
    } catch { /* unreadable: nothing met */ }
  }

  hasKind(kind: string): boolean { return this.kinds.has(kind); }
  hasAffix(id: string): boolean { return this.affixes.has(id); }

  /** The kind came into view in a run fight. Returns true the first time ever (the caption is due). */
  meetKind(kind: string): boolean { return this.meet(this.kinds, kind); }
  /** The affix came into view on an elite in a run fight. Returns true the first time ever. */
  meetAffix(id: string): boolean { return this.meet(this.affixes, id); }

  private meet(set: Set<string>, id: string): boolean {
    if (set.has(id)) return false;
    set.add(id);
    try { this.storage?.setItem(NEW_SEEN_KEY, JSON.stringify({ version: NEW_SEEN_VERSION, kinds: [...this.kinds].sort(), affixes: [...this.affixes].sort() })); } catch { /* storage may be unavailable */ }
    return true;
  }
}

/**
 * The captioned kinds of an arena (as a run plays it) that `store` has not met yet, in the order of `KIND_CAPTIONS`. `without` — the
 * kinds the fight takes out (`Loadout.withoutKinds`: the schedule, task 26; a gentle final, task 17): never promised (review 15.10.2026).
 */
export function newKindsOfArena(arena: string, roster: string | undefined, store: Pick<NewSeenStore, 'hasKind'>, without: readonly string[] = []): string[] {
  const kinds = arenaKinds(arena, roster);
  return Object.keys(KIND_CAPTIONS).filter(kind => kinds.has(kind) && !without.includes(kind) && !store.hasKind(kind));
}
