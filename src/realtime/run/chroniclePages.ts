/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md, sections 3, 4, 6.1 and 7.4): the book as the view
 * draws it (`rtChronicleView`) and the owl's honest hint (`rtChronicleHint`). Pure functions of the profile and the hero.
 *
 * The rules of hiding (section 4): a chapter of a level the heroes have not reached is not in the contract; the next level only shows as
 * one blank chapter (`blank`, no entries); the counts are of the visible chapters; an entry a pack keeps locked is `locked` (no name: the
 * view draws a lock) and counts in `known`. Hidden entries and chapters are never in the contract.
 */
import type { RtProfile } from './rtRunStorage';
import { rtLockedAfter, type RtHeroId } from './metaCatalog';
import { isRtForm } from './rtTalismans';
import { rtInnate } from './rtRun';
import { rtChronicleCastleOpen, rtChronicleGarrisonOpen, rtChronicleRefPage, type RtChronicle } from './chronicle';
import {
  RT_CHRONICLE_AFFIXES, RT_CHRONICLE_ASH_STEPS, RT_CHRONICLE_BOSSES, RT_CHRONICLE_EVENTS, RT_CHRONICLE_FOREST_KINDS, chronicleForestKinds, RT_CHRONICLE_GARRISON_KINDS, chronicleGarrisonKinds, RT_CHRONICLE_HEROES,
  RT_CHRONICLE_ITEMS, RT_CHRONICLE_PAGES, rtChronicleNpcs, rtChronicleParts, type RtChroniclePageId,
  // Task 55в: the castle's level and kinds.
  chronicleLevels, RT_CHRONICLE_CASTLE_KINDS,
} from './chronicleCatalog';
import { RT_CASTLE_ON } from './castle';

export type RtChronicleEntryState = 'locked' | 'unknown' | 'seen' | 'taken' | 'met' | 'won';
/** An entry: its catalogue id, its state; `run` — the viewer's run of a boss met / won, of Ведунья freed (0 — unknown); `half` — a fusion's part taken. */
export interface RtChronicleEntry { id: string; state: RtChronicleEntryState; run?: number; half?: string }
/** A chapter: `open` — its entries; `blank` — the next level's empty tab (no name, no entries). */
export interface RtChronicleChapter { id: string; level: number; state: 'open' | 'blank'; entries: RtChronicleEntry[] }
export interface RtChroniclePage { id: RtChroniclePageId; have: number; known: number; unread: boolean; chapters: RtChronicleChapter[] }
/** The owl's hint: `key` — the line's place (`hint_event_den`, `hint_fusion_jailer` …), `target` — the entry's ref; `part` — a fusion's part taken. */
export interface RtChronicleHint { key: string; target: string; part?: string }
export interface RtChronicleView {
  total: [have: number, known: number];
  pages: RtChroniclePage[];
  /** The unread entries (the owl's «✦» and «Летопись ✦ N»). */
  unread: number;
  /** The retro brought old pages (the owl's `chronicle_retro` line, once). */
  retro: boolean;
  hint?: RtChronicleHint;
}
/** What the book reads of the profile. */
export type RtChronicleProfile = Pick<RtProfile, 'meta' | 'runs' | 'won' | 'heroAsh'>;
/** The camp's NPCs on (Шиш, Евлампий). */
/**
 * The build's content the book shows: the camp's new NPCs; task 57а — the forest's new shooters (absent — `RT_FOREST_SHOOTERS_ON`); task 59б —
 * the garrison's kinds of step 3 (absent — `RT_GARRISON_STEP3_ON`).
 */
export interface RtChronicleOn {
  gambler: boolean; monk: boolean; shooters?: boolean; step3?: boolean;
  /** Task 55в: the castle in the run — the book has its level 3 (absent — `RT_CASTLE_ON`). */
  castle?: boolean;
}
/** Task 59б: the garrison's kinds the book shows by `on` (absent — the build's flag). */
const garrisonKindsOf = (on: RtChronicleOn): readonly string[] => (on.step3 === undefined ? RT_CHRONICLE_GARRISON_KINDS : chronicleGarrisonKinds(on.step3));

/** What counts as written: a kind or an event seen, an item or a fusion taken, a boss met or won, a hero or an NPC met, a step climbed. */
const written = (page: RtChroniclePageId, state: RtChronicleEntryState): boolean =>
  page === 'items' ? state === 'taken' : state === 'seen' || state === 'met' || state === 'won' || state === 'taken';

/** The facts the pages read: the chronicle, the levels reached, the locks of the hero's packs, the ladders open. */
function factsOf(profile: RtChronicleProfile, hero: RtHeroId, on: RtChronicleOn) {
  const meta = profile.meta, c: RtChronicle = meta?.chronicle ?? {}, build = chronicleLevels(on.castle ?? RT_CASTLE_ON);
  // Task 55в: the castle once a hero reached it (a level is open only after the one before it).
  const levels = build.filter(level => level === 1 || (level === 2 && rtChronicleGarrisonOpen(meta)) || (level === 3 && rtChronicleGarrisonOpen(meta) && rtChronicleCastleOpen(meta)));
  const next = build.find(level => !levels.includes(level));
  const locked = new Set(rtLockedAfter(meta?.heroes[hero]?.packs ?? []));
  const ladder = (id: RtHeroId): boolean => (id === 'toad' ? profile.heroAsh?.toad?.won === true : profile.won === true);
  const jailerMet = !!c.bosses?.jailer || !!meta?.freed?.toad;
  // The fusions' chapter: once a run held a pair (or made one).
  const fusionsShown = RT_CHRONICLE_ITEMS.fusions.some(id => c.items?.[id] !== undefined);
  return { meta, c, levels, next, locked, ladder, jailerMet, fusionsShown };
}

/** The book for `hero` (the locks are of its packs; the hint is for it). `on` — the camp's NPCs of task 51 on. */
export function rtChronicleView(profile: RtChronicleProfile, hero: RtHeroId, on: RtChronicleOn): RtChronicleView {
  const f = factsOf(profile, hero, on), c = f.c, kinds = new Set(c.kinds ?? []), affixes = new Set(c.affixes ?? []);
  const blank = (level: number): RtChronicleChapter => ({ id: `blank-${level}`, level, state: 'blank', entries: [] });
  const open = (id: string, level: number, entries: RtChronicleEntry[]): RtChronicleChapter => ({ id, level, state: 'open', entries });
  const levelled = (chapters: { level: number; chapter: () => RtChronicleChapter }[]): RtChronicleChapter[] =>
    [...chapters.filter(entry => f.levels.includes(entry.level)).map(entry => entry.chapter()), ...f.next !== undefined && chapters.some(entry => entry.level === f.next) ? [blank(f.next)] : []];
  const kind = (id: string): RtChronicleEntry => ({ id, state: kinds.has(id) ? 'seen' : 'unknown' });

  // Бестиарий: the forest; the elites' affixes after the first elite (the chronicle's own fact — never `profile.seen`, which
  // «Обучение» empties); the garrison's kinds once a hero reached it.
  const elites = c.elites === true || affixes.size > 0;
  const bestiary = levelled([
    { level: 1, chapter: () => open('forest', 1, (on.shooters === undefined ? RT_CHRONICLE_FOREST_KINDS : chronicleForestKinds(on.shooters)).map(kind)) },
    ...elites ? [{ level: 1, chapter: () => open('affixes', 1, RT_CHRONICLE_AFFIXES.map(id => ({ id, state: affixes.has(id) ? 'seen' as const : 'unknown' as const }))) }] : [],
    { level: 2, chapter: () => open('garrison', 2, garrisonKindsOf(on).map(kind)) },
    // Task 55в: the castle's kinds (a build with the castle, once a hero reached it).
    { level: 3, chapter: () => open('castle', 3, RT_CHRONICLE_CASTLE_KINDS.map(kind)) },
  ]);
  // Боссы: by level.
  const boss = (id: (typeof RT_CHRONICLE_BOSSES)[number]['id']): RtChronicleEntry => {
    const b = c.bosses?.[id];
    return b?.won !== undefined ? { id, state: 'won', run: b.won } : b ? { id, state: 'met', run: b.met } : { id, state: 'unknown' };
  };
  const bosses = levelled([
    { level: 1, chapter: () => open('forest', 1, RT_CHRONICLE_BOSSES.filter(b => b.level === 1).map(b => boss(b.id))) },
    { level: 2, chapter: () => open('garrison', 2, RT_CHRONICLE_BOSSES.filter(b => b.level === 2).map(b => boss(b.id))) },
    { level: 3, chapter: () => open('castle', 3, RT_CHRONICLE_BOSSES.filter(b => b.level === 3).map(b => boss(b.id))) },
  ]);
  // События: the forest's and the circle; an event a pack keeps locked — `locked`.
  const events = [open('forest', 1, RT_CHRONICLE_EVENTS.map(({ id }) => ({ id, state: c.events?.includes(id) ? 'seen' as const : f.locked.has(id) ? 'locked' as const : 'unknown' as const })))];
  // Талисманы и формы: taken / seen / locked / «?» (a fusion's «?» names the part taken); the fusions once a pair was held or one made.
  const item = (id: string): RtChronicleEntry => {
    const state = c.items?.[id];
    if (state === 2) return { id, state: 'taken' };
    if (state === 1) return { id, state: 'seen' };
    if (f.locked.has(id)) return { id, state: 'locked' };
    const half = rtChronicleParts(id).find(part => c.items?.[part] === 2);
    return { id, state: 'unknown', ...half ? { half } : {} };
  };
  const items = [open('talismans', 0, RT_CHRONICLE_ITEMS.talismans.map(item)), open('relics', 0, RT_CHRONICLE_ITEMS.relics.map(item)), open('forms', 0, RT_CHRONICLE_ITEMS.forms.map(item)),
    ...f.fusionsShown ? [open('fusions', 0, RT_CHRONICLE_ITEMS.fusions.map(item))] : []];
  // Герои: the cat; Ведунья once the Jailer was met («?» in the cage, then freed with her run); the ladders once open (the best step).
  const toad = f.meta?.freed?.toad;
  const heroes = [open('heroes', 0, RT_CHRONICLE_HEROES.flatMap((id): RtChronicleEntry[] => id === 'toad' ? (f.jailerMet ? [toad ? { id, state: 'met', run: toad.run ?? 0 } : { id, state: 'unknown' }] : []) : [{ id, state: 'met' }])),
    ...RT_CHRONICLE_HEROES.filter(f.ladder).map(id => {
      const best = f.meta?.heroes[id]?.ashBest ?? 0;
      return open(`ash-${id}`, 0, Array.from({ length: RT_CHRONICLE_ASH_STEPS }, (_, i) => ({ id: `ash:${id}:${i + 1}`, state: i + 1 <= best ? 'seen' as const : 'unknown' as const })));
    })];
  // Очаг: the owl always; the others once come.
  const hearth = [open('hearth', 0, rtChronicleNpcs(on).map(npc => ({ id: npc, state: npc === 'owl' || f.meta?.hearth?.met[npc as 'herb'] ? 'met' as const : 'unknown' as const })))];

  const chapters: Record<RtChroniclePageId, RtChronicleChapter[]> = { bestiary, bosses, events, items, heroes, hearth };
  const unread = c.unread ?? [];
  const pages = RT_CHRONICLE_PAGES.map((id): RtChroniclePage => {
    const all = chapters[id].flatMap(chapter => chapter.entries);
    return { id, have: all.filter(entry => written(id, entry.state)).length, known: all.length, unread: unread.some(ref => rtChronicleRefPage(ref) === id), chapters: chapters[id] };
  });
  const hint = rtChronicleHint(profile, hero, on);
  return { total: [pages.reduce((n, p) => n + p.have, 0), pages.reduce((n, p) => n + p.known, 0)], pages, unread: unread.length, retro: c.retro === true, ...hint ? { hint } : {} };
}

/** The pages' counts (the run record's `chronicle.pages`). */
export const rtChronicleCounts = (view: RtChronicleView): Record<RtChroniclePageId, [number, number]> =>
  Object.fromEntries(view.pages.map(page => [page.id, [page.have, page.known]])) as Record<RtChroniclePageId, [number, number]>;

/**
 * The owl's hint (section 6.1): the candidates — an empty entry this hero can get in this build now, in the catalogue's order: an event
 * not seen and not locked (its branch), a boss of a level reached not met, a garrison kind not met (the garrison reached), a fusion with
 * one part taken and the other offered to the hero (the fusions' chapter shown: a hidden chapter is no candidate) (the other part's place: the Jailer's screen for a form, «Застава» for a counter), the
 * next step of the hero's ladder (open), an NPC not come. One of them by the viewer's run number (`RtProfile.runs`) — no randomness;
 * none — no hint. A target seen leaves the candidates.
 */
export function rtChronicleHint(profile: RtChronicleProfile, hero: RtHeroId, on: RtChronicleOn): RtChronicleHint | undefined {
  const f = factsOf(profile, hero, on), c = f.c, out: RtChronicleHint[] = [];
  for (const { id, branch } of RT_CHRONICLE_EVENTS) if (!c.events?.includes(id) && !f.locked.has(id)) out.push({ key: `hint_event_${branch}`, target: `event:${id}` });
  for (const boss of RT_CHRONICLE_BOSSES) if (f.levels.includes(boss.level) && !c.bosses?.[boss.id]) out.push({ key: `hint_boss_${boss.id}`, target: `boss:${boss.id}` });
  // Task 59б: only the kinds this build gives (a kind of step 3 with its flag off is no obtainable target).
  if (f.levels.includes(2)) for (const id of garrisonKindsOf(on)) if (!c.kinds?.includes(id)) out.push({ key: 'hint_garrison', target: `kind:${id}` });
  // Task 55в: a castle kind not met (the castle reached; the line `hint_castle` — design's).
  if (f.levels.includes(3)) for (const id of RT_CHRONICLE_CASTLE_KINDS) if (!c.kinds?.includes(id)) out.push({ key: 'hint_castle', target: `kind:${id}` });
  const innate = rtInnate({ heroId: hero });
  for (const fusion of f.fusionsShown ? RT_CHRONICLE_ITEMS.fusions : []) {
    const parts = rtChronicleParts(fusion);
    if (c.items?.[fusion] === 2 || parts.some(part => innate.includes(part))) continue;
    const taken = parts.filter(part => c.items?.[part] === 2), missing = parts.filter(part => c.items?.[part] !== 2);
    if (taken.length === 1 && missing.length === 1 && !f.locked.has(missing[0])) out.push({ key: isRtForm(missing[0]) ? 'hint_fusion_jailer' : 'hint_fusion_outpost', target: `item:${fusion}`, part: taken[0] });
  }
  const best = profile.meta?.heroes[hero]?.ashBest ?? 0;
  if (f.ladder(hero) && best < RT_CHRONICLE_ASH_STEPS) out.push({ key: 'hint_ash', target: `ash:${hero}:${best + 1}` });
  for (const npc of rtChronicleNpcs(on)) if (npc !== 'owl' && !profile.meta?.hearth?.met[npc]) out.push({ key: `hint_npc_${npc}`, target: `npc:${npc}` });
  return out.length ? out[(profile.runs ?? 0) % out.length] : undefined;
}
