/**
 * Storage of the real-time game's run and profile (stage 2 of the transition). Keys of its own: the saves of the removed
 * turn-based game (`ashen-oath-forest-run-v1`, `ashen-oath-profile-v1`) are neither read nor written. Storage is optional:
 * without it (or when it throws) the run lives in memory for this tab and the profile reads as a first-time player's.
 */

/** The part of the Web Storage API the stores use (tests pass a plain object). */
export interface RunStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
import { isRtAshLevel, parseRtRun, RT_ASH_OPEN, serializeRtRun, type RtAshLevel, type RtRunState } from './rtRun';
import { isScheduleElement } from './schedule';
// Tasks 36–37 «Мета» and «Очаг»: the meta the profile keeps (rtMeta.ts computes it; this store reads and writes it).
import { parseRtMeta, rtApplyMeta, rtHearthBuy, rtHearthStartOf, rtHearthView, rtMetaLocked, rtMetaNewOffer, rtRunKey, type RtHearthBuy, type RtHearthStart, type RtHearthView, type RtMeta, type RtMetaEnd } from './rtMeta';
// Task 49 «Второй герой»: the heroes open and chosen, Ведунья freed by the Jailer, «✦ новое» by hero.
import { rtChooseHero, rtFreeByJailer, rtHeroChoice, rtHeroesOpen, rtHeroViews, rtMetaMarkOffered, type RtHeroView } from './rtMeta';
import { isRtHeroId, RT_CHRONICLE_ON, RT_HEARTH_GAMBLER_ON, RT_HEARTH_MONK_ON, RT_HERO_ID, type RtHearthNpc, type RtHeroId } from './metaCatalog';
import { rtChronicleImport, rtChronicleMeet, rtChronicleMetaRefs, rtChronicleNote, rtChronicleRead, type RtChronicleMemory } from './chronicle';
import { rtChronicleCounts, rtChronicleView, type RtChronicleView } from './chroniclePages';

/**
 * Casino stage 1, item 2: `-v7` (save version 7, the oath stake: the oath stream's counter, the open battle's offer and oath).
 * `-v6` (phase B, track Д4: the Jailer's hammer, the real-time draws of the gift and events) is still read when there is no
 * `-v7` save and migrated (rtRun.ts `migrateRun`); the next save goes under `-v7`. `-v5` (phase A, rosters of the arenas),
 * `-v4` (stage 3a, the lynx's and the shaman's arenas in the pools), `-v3` (iteration 2.1, the run HP 15), `-v2` (step 3)
 * and `-v1` (steps 1–2) are not read.
 */
export const RT_RUN_STORAGE_KEY = 'ashen-oath-rt-run-v7';
/** The phase B key: read (and migrated) only while there is no `-v7` save; removed with it by `clear`. */
export const RT_RUN_STORAGE_KEY_V6 = 'ashen-oath-rt-run-v6';
export const RT_PROFILE_STORAGE_KEY = 'ashen-oath-rt-profile-v1';
export const RT_PROFILE_VERSION = 1;

function browserStorage(): RunStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export interface RtRunStore {
  /** The saved run, or null when nothing valid is stored. */
  load(): RtRunState | null;
  /** True when the run reached persistent storage; false — kept in memory only. */
  save(run: RtRunState): boolean;
  clear(): void;
}

export function createRtRunStore(storage: RunStorage | null = browserStorage()): RtRunStore {
  let memory: string | null = null;
  return {
    load() {
      let text = memory;
      try { text ??= storage?.getItem(RT_RUN_STORAGE_KEY) ?? storage?.getItem(RT_RUN_STORAGE_KEY_V6) ?? null; } catch { /* Fall back to memory. */ }
      return parseRtRun(text);
    },
    save(run) {
      memory = serializeRtRun(run);
      try { if (!storage) return false; storage.setItem(RT_RUN_STORAGE_KEY, memory); return true; } catch { return false; }
    },
    clear() {
      memory = null;
      try { storage?.removeItem(RT_RUN_STORAGE_KEY); storage?.removeItem(RT_RUN_STORAGE_KEY_V6); } catch { /* Storage is optional. */ }
    },
  };
}

/**
 * The real-time player's profile: the gift mark of step 1 — the previous finished run reached the Jailer's row
 * (GIFT_FULL_ROW), so the next run gets the full start gift (the rule of the turn-based run). A run with a given seed
 * always gets the full gift and does not change the mark. The trunk, the ladder and the bar of openings are not in the slice.
 *
 * Task 16 «Подвиги» (design 13.10.2026, complexity budget; the same version 1, optional fields):
 * - `jailer` — the viewer ever fought the Jailer in a run without a given seed (review 14.10.2026: set when the Jailer's fight is
 *   fed back, won or lost — `markJailer`, rtRun.ts `rtFoughtJailer` — so a run abandoned after it counts too; a finished run
 *   that reached the Jailer's row sets it as well, `endRun`). Unlike `giftFull` it stays once set. A run created after it
 *   carries feats (`featsOn`). A profile saved before it with `giftFull` reads as `jailer` (that run reached the Jailer).
 * - `runs` — runs this viewer started (telemetry `RunRecord.viewerRun`: 1, 2, 3…); absent — none counted yet. `runsApprox` — the
 *   count started on a profile that already showed play before it (a stored profile without `runs`: a run had ended): it began
 *   at 2, so it is a lower bound (`RunRecord.viewerRunApprox`).
 * Task 18 «Испытание I–V» (design 13–14.10.2026; the same version 1, optional fields):
 * - `won` — the viewer won a run without a given seed (`endRun` with `won`); it stays once set and opens the choice of
 *   «Испытание» on «Новый поход» (`ashOpen`).
 * - `ash` — the level chosen last (1–5; task 45: up to `RT_ASH_OPEN`; absent — 0), the choice's default (`ashChoice`, `chooseAsh`).
 * Task 26 «Расписание леса» (design 15.10.2026; the same version 1, an optional field):
 * - `seen` — the living elements the viewer has met (run/schedule.ts), sorted; a new run takes a snapshot (`createRtRun(seed,
 *   { schedule })`). Absent — the schedule never ran here: the first read takes the view's older memory (`scheduleHistory(seed)`).
 *   The gear's «Обучение» empties it (`resetSchedule`): the next new run goes the newcomer's path. `seenMute` — the seed of the run
 *   open at that moment: its later fights do not feed the history (spec (8): that run goes on, the next new run is a first one);
 *   a new run's snapshot removes it.
 * Tasks 36–37 «Мета» and «Очаг» (design 15.10.2026; the same version 1, an optional field):
 * - `meta` — the hero's XP, opened packs and depth record (`heroes.cat`), the camp (`hearth`: stock, levels, NPCs met, lines shown,
 *   the next quest, the last run), the opened items already offered (`offered`) and the last run applied (`applied`: its key and
 *   result — the end screen reloaded shows the same). rtMeta.ts. Absent — the meta starts from zero.
 * Task 49 «Второй герой» (design 16.10.2026; the same version 1, an optional field): «Испытание» is the hero's own — `won` and `ash` are
 * the cat's (a profile before it: every win was his, so nothing he opened is taken away); `heroAsh.toad` — Ведунья's (`won`: her first
 * won run without a given seed opens all her levels, v1; `ash`: her level chosen last). The hero chosen, the heroes freed and each
 * hero's XP and packs are in `meta` (`RtMeta.hero`, `freed`, `heroes`).
 * All are absent until set: a profile without them reads and saves as before.
 */
export interface RtHeroAsh { won?: true; ash?: Exclude<RtAshLevel, 0> }
export interface RtProfile { version: typeof RT_PROFILE_VERSION; giftFull: boolean; jailer?: true; runs?: number; runsApprox?: true; won?: true; ash?: Exclude<RtAshLevel, 0>; seen?: string[]; seenMute?: number; meta?: RtMeta; heroAsh?: { toad?: RtHeroAsh } }
export const emptyRtProfile = (): RtProfile => ({ version: RT_PROFILE_VERSION, giftFull: false });

export function parseRtProfile(text: string | null): RtProfile {
  if (text === null) return emptyRtProfile();
  try {
    const value = JSON.parse(text) as Partial<RtProfile> | null;
    if (!value || typeof value !== 'object' || value.version !== RT_PROFILE_VERSION) return emptyRtProfile();
    const runs = typeof value.runs === 'number' && Number.isInteger(value.runs) && value.runs >= 1 ? value.runs : undefined;
    const ash = isRtAshLevel(value.ash) && value.ash >= 1 ? value.ash as Exclude<RtAshLevel, 0> : undefined;
    const seen = Array.isArray(value.seen) ? [...new Set(value.seen.filter(isScheduleElement))].sort() : undefined;
    const mute = seen !== undefined && typeof value.seenMute === 'number' && Number.isInteger(value.seenMute) && value.seenMute >= 0 ? value.seenMute : undefined;
    const meta = parseRtMeta(value.meta);
    // Task 49: Ведунья's «Испытание» (anything malformed — none).
    const toad = typeof value.heroAsh === 'object' && value.heroAsh && typeof value.heroAsh.toad === 'object' && value.heroAsh.toad ? value.heroAsh.toad as Partial<RtHeroAsh> : undefined;
    const toadAsh = toad && isRtAshLevel(toad.ash) && toad.ash >= 1 && toad.won === true ? toad.ash as Exclude<RtAshLevel, 0> : undefined;
    const heroAsh = toad?.won === true ? { toad: { won: true as const, ...toadAsh !== undefined ? { ash: toadAsh } : {} } } : undefined;
    return { version: RT_PROFILE_VERSION, giftFull: value.giftFull === true, ...value.jailer === true || value.giftFull === true ? { jailer: true as const } : {}, ...runs !== undefined ? { runs } : {}, ...runs !== undefined && value.runsApprox === true ? { runsApprox: true as const } : {}, ...value.won === true ? { won: true as const } : {}, ...ash !== undefined ? { ash } : {}, ...seen !== undefined ? { seen } : {}, ...mute !== undefined ? { seenMute: mute } : {}, ...meta ? { meta } : {}, ...heroAsh ? { heroAsh } : {} };
  } catch { return emptyRtProfile(); }
}

export interface RtProfileStore {
  load(): RtProfile;
  /** The gift a new run gets: a given seed — always the full one. */
  giftKind(seeded: boolean): 'full' | 'mini';
  /**
   * A run ended: remember whether it reached the Jailer's row and (task 18) whether it was won — `won` opens «Испытание» for good
   * (not for a seeded run). False when not stored. Task 49: `hero` — the run's hero (absent — the chosen one, `heroChoice`): a win
   * opens that hero's «Испытание» (the cat's `won`, Ведунья's `heroAsh.toad.won`).
   */
  endRun(run: { reachedJailer: boolean; seeded: boolean; won?: boolean; hero?: RtHeroId }): boolean;
  /** Task 18: the choice of «Испытание» is open — the viewer won a run without a given seed (`won`). Task 49: of `hero` (absent — the chosen one). */
  ashOpen(hero?: RtHeroId): boolean;
  /** Task 18: the level a new run takes by default — the last chosen; 0 while the choice is closed. Task 49: of `hero` (absent — the chosen one). */
  ashChoice(hero?: RtHeroId): RtAshLevel;
  /**
   * Task 18: remember the level chosen on «Новый поход» (0 removes the field). False when not stored or the choice is closed. Task 49:
   * of `hero` (absent — the chosen one).
   */
  chooseAsh(level: RtAshLevel, hero?: RtHeroId): boolean;
  /**
   * Task 16 «Подвиги»: a new run carries feats — the player reached the Jailer in an earlier finished run (`jailer`). A seeded run
   * follows the profile too (core answer 14.10.2026). Pass it to `createRtRun(seed, { feats })`.
   */
  featsOn(): boolean;
  /**
   * Task 16: the viewer fought the Jailer (a run without a given seed fed the Jailer's fight back, rtRun.ts `rtFoughtJailer`) —
   * `jailer` is set and stays. False when not stored.
   */
  markJailer(): boolean;
  /**
   * Task 16 telemetry: a run starts — the viewer's run number (1, 2, 3…; `RunRecord.viewerRun`), counted in the profile.
   * `approx` — the count began on a profile that showed earlier play (it starts at 2; `RunRecord.viewerRunApprox`).
   */
  startRun(): { run: number; approx?: true };
  /**
   * Task 26: the viewer's history for a new run's schedule. A profile without it starts from `seed()` (the view's older memory:
   * schedule.ts `scheduleSeedHistory`) and keeps that; the result is what a new run snapshots.
   */
  scheduleHistory(seed: () => readonly string[]): string[];
  /**
   * Task 26: a scheduled fight of the run of seed `seed` was fed back — its elements join the viewer's history; not for the run
   * that was open when «Обучение» emptied it (`seenMute`). False when not stored.
   */
  meetSchedule(ids: readonly string[], seed: number): boolean;
  /**
   * Task 26: «Обучение» on the gear — the history is emptied (kept as empty: the older memory is not read again); `seed` — the run
   * open now: it goes on, its fights do not feed the history.
   */
  resetSchedule(seed?: number): boolean;
  /**
   * Task 36 (+ the carry of task 37): the run ended (or is abandoned: no result — «Новый поход» over it) — its XP, pack, record,
   * carry and quest join the meta once; a second call for the same run returns the same result. Null — a run with a given seed.
   */
  endRunMeta(run: RtRunState): RtMetaEnd | null;
  /** Task 37: the camp as the screen shows it. Task 49: the owl's quest by `hero`'s record (absent — the chosen hero). */
  hearth(hero?: RtHeroId): RtHearthView;
  /** Task 37: buy an NPC's next level (1 or 2; prices `RT_HEARTH_PRICES`); refused with the price and the stock. */
  buyHearth(npc: RtHearthNpc, level: number): RtHearthBuy;
  /** Task 37: a line `npc:key` was shown — its count +1 (the view cycles a key's lines by it). */
  markLine(id: string): boolean;
  /** Task 37: what the camp gives the next run of `seed` (the view shows the choices; `rtHearthFlagsWith` makes the run's flags). */
  hearthStart(seed: number, hero?: RtHeroId): RtHearthStart;
  /** Task 36: the items a new meta run keeps locked (`createRtRun(seed, { locked })`). Task 49: of `hero` (absent — the chosen one). */
  locked(hero?: RtHeroId): string[];
  /** Task 36: «✦ новое» — the item was opened by a pack and not offered yet. Task 49: to `hero` (absent — the chosen one). */
  isNewOffer(id: string, hero?: RtHeroId): boolean;
  /** Task 36: these opened items were offered (the sign shows no more). Task 49: to `hero` (absent — the chosen one). */
  markOffered(ids: string | readonly string[], hero?: RtHeroId): boolean;
  /** Task 49: the heroes as the camp and «Новый поход» show them (`RtHeroView`: open, chosen, XP, packs, record, the best «Испытание»). */
  heroes(): RtHeroView[];
  /** Task 49: the hero the next run takes (`createRtRun(seed, { hero })`) — the chosen one while open; the cat otherwise. */
  heroChoice(): RtHeroId;
  /** Task 49: choose the hero of the next run (the camp, «Новый поход»). False — not open (not freed), or not stored. */
  chooseHero(id: RtHeroId): boolean;
  /**
   * Task 49 (spec 6.1): the Jailer's fight was fed back — the first win over him in a run without a given seed frees Ведунья (`freed.toad`
   * with the row and the viewer's run number). Returns the hero freed now (the view plays the cage scene after the Jailer's reward
   * screens), or null: a seeded run, no win over the Jailer, freed already. The outcome, rewards and streams of the run are not touched;
   * `endRunMeta` frees her too if this was not called.
   */
  freeHero(run: RtRunState): RtHeroId | null;
  /**
   * Task 58 «Летопись» (docs/design-notes/task-58-discovery.md, section 7.4): the book as the window draws it — the pages, chapters and
   * entries visible, the counts, the unread, the owl's hint — for `hero` (absent — the chosen one).
   */
  chronicle(hero?: RtHeroId): RtChronicleView;
  /**
   * Task 58 (variant A): kinds and affixes came into view in a fight of a meta run (the caller checked: not `?seed=`, not the sandbox,
   * not the prologue) — the new ones join the chronicle (repeats ignored). False — nothing new, the chronicle off, or not stored.
   */
  chronicleMeet(kinds: readonly string[], affixes: readonly string[]): boolean;
  /** Task 58: the retro from the view's П8 memory, once a profile (later calls do nothing). False — done before, off, or not stored. */
  chronicleImport(memory: RtChronicleMemory): boolean;
  /** Task 58: the window opened — the unread are read. False — nothing unread, off, or not stored. */
  chronicleRead(): boolean;
  /** Task 58: the entries the run of `runKey` (`rtRunKey`) added — its end's list (after a reload too); another key — none. */
  chronicleAdded(runKey: string): string[];
}

/** Task 37: the camp's start for a loaded profile (`rtHearthStartOf` over its meta). */
export const rtHearthStart = (profile: RtProfile, seed: number, hero?: RtHeroId): RtHearthStart => rtHearthStartOf(profile.meta, seed, heroOf(profile, hero));
/** Task 36: «✦ новое» for a loaded profile. Task 49: to `hero` (absent — the chosen one). */
export const rtIsNewOffer = (profile: RtProfile, id: string, hero?: RtHeroId): boolean => rtMetaNewOffer(profile.meta, id, heroOf(profile, hero));

/** Task 51в: `gambler` — Шиш's camp on for this store (default `RT_HEARTH_GAMBLER_ON`; tests turn it on); task 51г: `monk` — Евлампий's. */
export function createRtProfileStore(storage: RunStorage | null = browserStorage(), options: { gambler?: boolean; monk?: boolean; away?: boolean; chronicle?: boolean } = {}): RtProfileStore {
  // Task 58: the chronicle written only while on (`RT_CHRONICLE_ON`, or the option); the camp's NPCs of its page «Очаг».
  const chronicleOn = options.chronicle ?? RT_CHRONICLE_ON, npcs = { gambler: options.gambler ?? RT_HEARTH_GAMBLER_ON, monk: options.monk ?? RT_HEARTH_MONK_ON };
  const read = (): RtProfile => { try { return parseRtProfile(storage?.getItem(RT_PROFILE_STORAGE_KEY) ?? null); } catch { return emptyRtProfile(); } };
  const write = (profile: RtProfile): boolean => { try { if (!storage) return false; storage.setItem(RT_PROFILE_STORAGE_KEY, JSON.stringify(profile)); return true; } catch { return false; } };
  return {
    load: read,
    giftKind: seeded => seeded || read().giftFull ? 'full' : 'mini',
    // Task 16: `jailer` stays once a run reached the Jailer (`giftFull` is the last run's only).
    // Task 18: `won` stays once an unseeded run was won.
    // Task 49: a win opens the run's hero's «Испытание» (the cat's `won`, Ведунья's `heroAsh.toad`).
    endRun: ({ reachedJailer, seeded, won, hero }) => {
      if (seeded) return false;
      const profile = read(), who = heroOf(profile, hero);
      const wonNow = won && who !== RT_HERO_ID ? { heroAsh: { ...profile.heroAsh, toad: { ...profile.heroAsh?.toad, won: true as const } } } : {};
      return write({ ...profile, giftFull: reachedJailer, ...reachedJailer ? { jailer: true as const } : {}, ...won && who === RT_HERO_ID ? { won: true as const } : {}, ...wonNow });
    },
    ashOpen: hero => ashOf(read(), hero).won,
    // Task 45: a level above the choice's (`RT_ASH_OPEN`) is not offered — the highest offered one.
    ashChoice: hero => { const own = ashOf(read(), hero); return own.won ? Math.min(own.ash, RT_ASH_OPEN) as RtAshLevel : 0; },
    chooseAsh: (level, hero) => {
      const profile = read(), who = heroOf(profile, hero);
      if (!ashOf(profile, who).won || !isRtAshLevel(level) || level > RT_ASH_OPEN) return false;
      if (who !== RT_HERO_ID) {
        const { ash: _own, ...toad } = profile.heroAsh?.toad ?? {};
        return write({ ...profile, heroAsh: { ...profile.heroAsh, toad: { ...toad, ...level > 0 ? { ash: level as Exclude<RtAshLevel, 0> } : {} } } });
      }
      const { ash: _old, ...rest } = profile;
      return write(level > 0 ? { ...rest, ash: level as Exclude<RtAshLevel, 0> } : rest);
    },
    featsOn: () => read().jailer === true,
    markJailer: () => { const profile = read(); return profile.jailer === true || write({ ...profile, jailer: true }); },
    startRun: () => {
      // A stored profile without the count: a run had ended before (only `endRun` wrote profiles then) — the count starts at 2.
      const stored = (() => { try { return storage?.getItem(RT_PROFILE_STORAGE_KEY) != null; } catch { return false; } })();
      const profile = read(), first = profile.runs === undefined, approx = first ? stored : profile.runsApprox === true;
      const runs = first ? (stored ? 2 : 1) : profile.runs! + 1;
      write({ ...profile, runs, ...approx ? { runsApprox: true as const } : {} });
      return { run: runs, ...approx ? { approx: true as const } : {} };
    },
    scheduleHistory: seed => {
      const { seenMute: _mute, ...profile } = read();
      // A new run takes its snapshot now: the run muted by «Обучение» is left behind.
      if (profile.seen) { if (_mute !== undefined) write(profile); return [...profile.seen]; }
      const seen = [...new Set(seed().filter(isScheduleElement))].sort();
      write({ ...profile, seen });
      return seen;
    },
    meetSchedule: (ids, runSeed) => {
      const profile = read();
      if (profile.seenMute === runSeed) return false;
      const seen = [...new Set([...profile.seen ?? [], ...ids.filter(isScheduleElement)])].sort();
      return JSON.stringify(seen) === JSON.stringify(profile.seen) || write({ ...profile, seen });
    },
    resetSchedule: runSeed => { const { seenMute: _mute, ...profile } = read(); return write({ ...profile, seen: [], ...runSeed !== undefined ? { seenMute: runSeed >>> 0 } : {} }); },
    endRunMeta: run => {
      if (run.seeded) return null;
      const profile = read();
      if (profile.meta?.applied?.key === rtRunKey(run)) return structuredClone(profile.meta.applied.end);
      const { meta, end } = rtApplyMeta(profile.meta, run, { ...profile.runs !== undefined ? { viewerRun: profile.runs } : {}, ...options.gambler !== undefined ? { gambler: options.gambler } : {}, ...options.monk !== undefined ? { monk: options.monk } : {}, ...options.away !== undefined ? { away: options.away } : {}, chronicle: chronicleOn });
      // Task 58: the pages' counts after the run (its record's telemetry).
      if (end.chronicle) {
        end.chronicle.pages = rtChronicleCounts(rtChronicleView({ ...profile, meta }, run.heroId ?? RT_HERO_ID, npcs));
        end.chronicle.seenItems = Object.values(meta.chronicle?.items ?? {}).filter(state => state === 1).length;
      }
      write({ ...profile, meta });
      return end;
    },
    hearth: hero => { const profile = read(); return rtHearthView(profile.meta, profile.seen, heroOf(profile, hero)); },
    buyHearth: (npc, level) => {
      const profile = read(), { result, meta } = rtHearthBuy(profile.meta, npc, level);
      if (meta) write({ ...profile, meta });
      return result;
    },
    markLine: id => {
      if (typeof id !== 'string' || !id) return false;
      const profile = read(), meta: RtMeta = profile.meta ?? { heroes: {} };
      if (!meta.hearth) return false;
      return write({ ...profile, meta: { ...meta, hearth: { ...meta.hearth, lines: { ...meta.hearth.lines, [id]: (meta.hearth.lines[id] ?? 0) + 1 } } } });
    },
    hearthStart: (seed, hero) => { const profile = read(); return rtHearthStartOf(profile.meta, seed, heroOf(profile, hero)); },
    locked: hero => { const profile = read(); return rtMetaLocked(profile.meta, heroOf(profile, hero)); },
    isNewOffer: (id, hero) => { const profile = read(); return rtMetaNewOffer(profile.meta, id, heroOf(profile, hero)); },
    markOffered: (ids, hero) => {
      const profile = read(), meta = rtMetaMarkOffered(profile.meta, typeof ids === 'string' ? [ids] : [...ids], heroOf(profile, hero));
      return !!meta && write({ ...profile, meta });
    },
    heroes: () => rtHeroViews(read().meta),
    heroChoice: () => rtHeroChoice(read().meta),
    chooseHero: id => {
      const profile = read(), meta = rtChooseHero(profile.meta, id);
      return !!meta && write({ ...profile, meta });
    },
    freeHero: run => {
      const profile = read(), freed = rtFreeByJailer(profile.meta, run, profile.runs);
      if (!freed) return null;
      // Task 58: Ведунья freed joins the chronicle now (the run's end lists it).
      const chronicle = chronicleOn ? rtChronicleNote(freed.meta.chronicle, rtChronicleMetaRefs(profile.meta, freed.meta)) : undefined;
      write({ ...profile, meta: chronicle ? withChronicle(freed.meta, chronicle) : freed.meta });
      return freed.hero;
    },
    chronicle: hero => { const profile = read(); return rtChronicleView(profile, heroOf(profile, hero), npcs); },
    chronicleMeet: (kinds, affixes) => {
      if (!chronicleOn) return false;
      const profile = read(), met = rtChronicleMeet(profile.meta?.chronicle, kinds, affixes);
      return met.changed && write({ ...profile, meta: withChronicle(profile.meta, met.chronicle) });
    },
    chronicleImport: memory => {
      if (!chronicleOn) return false;
      const profile = read(), retro = rtChronicleImport(profile.meta?.chronicle, memory, profile);
      return retro.changed && write({ ...profile, meta: withChronicle(profile.meta, retro.chronicle) });
    },
    chronicleRead: () => {
      if (!chronicleOn) return false;
      const profile = read(), done = rtChronicleRead(profile.meta?.chronicle);
      return done.changed && write({ ...profile, meta: withChronicle(profile.meta, done.chronicle) });
    },
    chronicleAdded: runKey => { const applied = read().meta?.applied; return applied?.key === runKey ? [...applied.end.chronicle?.added ?? []] : []; },
  };
}

/** Task 58: the meta with `chronicle` (absent — removed), before `applied` (the order a stored profile reads back in). */
function withChronicle(meta: RtMeta | undefined, chronicle: RtMeta['chronicle']): RtMeta {
  const { applied, chronicle: _old, ...rest } = meta ?? { heroes: {} };
  return { ...rest, ...chronicle ? { chronicle } : {}, ...applied ? { applied } : {} };
}
/** Task 49: the hero a profile call means — the one given (an open one or not: a run's hero), else the chosen one. */
const heroOf = (profile: RtProfile, hero?: RtHeroId): RtHeroId => (isRtHeroId(hero) ? hero : rtHeroChoice(profile.meta));
/** Task 49: the hero's «Испытание»: open (won) and the level chosen last (0 — none). */
function ashOf(profile: RtProfile, hero?: RtHeroId): { won: boolean; ash: number } {
  const who = heroOf(profile, hero);
  if (who === RT_HERO_ID) return { won: profile.won === true, ash: profile.ash ?? 0 };
  const own = profile.heroAsh?.toad;
  return { won: own?.won === true, ash: own?.ash ?? 0 };
}
/** Task 49: the heroes open to a loaded profile (the cat, and those freed). */
export const rtProfileHeroes = (profile: RtProfile): RtHeroId[] => rtHeroesOpen(profile.meta);
