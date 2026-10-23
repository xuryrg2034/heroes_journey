/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md, sections 7.1, 7.2 and 8): the profile's record of what
 * the viewer found — `meta.chronicle`. Who writes it: the end of a meta run (`rtApplyMeta`: the events entered, the items seen and
 * taken, the fusions made, the bosses met and won; the hero freed, the «Испытание» climbed, the NPCs come, the garrison's chapter open);
 * the view, by the profile's store, for the kinds and affixes that came into view in a fight of a meta run (variant A, `chronicleMeet`);
 * the retro of an old profile once (`chronicleImport`). It only grows; «Обучение» (`resetSchedule`) does not touch it. Every field is
 * absent while empty, no field — no `chronicle`: a profile without it reads and writes as before, byte for byte.
 */
import type { RtMeta } from './rtMeta';
import { rtInnate, type RtRunState } from './rtRun';
import { RT_HEARTH_NPCS, RT_HERO_IDS, isRtHeroId } from './metaCatalog';
import {
  RT_CHRONICLE_AFFIXES, RT_CHRONICLE_ASH_STEPS, RT_CHRONICLE_BOSSES, RT_CHRONICLE_CASINO, RT_CHRONICLE_EVENTS, RT_CHRONICLE_ITEMS, RT_CHRONICLE_KINDS, RT_CHRONICLE_PAGES,
  isRtChronicleBoss, isRtChronicleFusion, isRtChronicleItem, rtChronicleParts, type RtChronicleBoss,
} from './chronicleCatalog';
import { isRtForm, rtFormField } from './rtTalismans';
import { isScheduleElement } from './schedule';

export interface RtChronicle {
  /** The kinds met in a fight of a meta run (and the retro), sorted. */
  kinds?: string[];
  /** The elite affixes met, sorted. */
  affixes?: string[];
  /**
   * An elite met (the chapter «Свойства элит» shows; design 21.10.2026, spec 3.1): the retro takes it from `profile.seen` once, then
   * the chronicle keeps it — «Обучение» (`resetSchedule`) empties `seen`, the book stays. Absent — none met yet (or one with an affix:
   * `affixes` shows the chapter too).
   */
  elites?: true;
  /** The bosses: the viewer's run (`RtProfile.runs`; 0 — unknown, the retro) of the first meeting and of the first win. */
  bosses?: Partial<Record<RtChronicleBoss, { met: number; won?: number }>>;
  /** The events entered (the forest's ids and `casino`), sorted. */
  events?: string[];
  /** The items: 1 — seen on a choice screen and not taken (a fusion: both parts held in a run, not made), 2 — taken (made). */
  items?: Record<string, 1 | 2>;
  /** The fusions made, sorted. */
  fusions?: string[];
  /** The entries new since the chronicle was last opened (refs: `kind:lynx`, `item:prism`, `ash:cat:5`, `chapter:garrison` …). */
  unread?: string[];
  /** The entries the run in progress added so far (its fights' kinds, a hero freed on the way): the run's end takes them into its list. */
  fresh?: string[];
  /** The viewer's runs when the retro was imported (the retro covers them); absent — not imported yet. */
  since?: number;
  /** The retro brought what the chronicle did not have (the owl's `chronicle_retro` line); absent — nothing. */
  retro?: true;
}

/** A ref of `unread` / `added`. */
const REF_KINDS = ['kind', 'affix', 'event', 'item', 'boss', 'hero', 'ash', 'npc', 'chapter'] as const;
export const RT_CHRONICLE_CHAPTER_REFS: readonly string[] = ['garrison', 'castle'];
export function isRtChronicleRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const [kind, id, step, ...rest] = value.split(':');
  if (rest.length || !(REF_KINDS as readonly string[]).includes(kind)) return false;
  if (kind === 'ash') return isRtHeroId(id) && /^[1-9]\d*$/.test(step ?? '') && Number(step) <= RT_CHRONICLE_ASH_STEPS;
  if (step !== undefined) return false;
  switch (kind) {
    case 'kind': return RT_CHRONICLE_KINDS.includes(id);
    case 'affix': return RT_CHRONICLE_AFFIXES.includes(id);
    case 'event': return RT_CHRONICLE_EVENTS.some(event => event.id === id);
    case 'item': return isRtChronicleItem(id);
    case 'boss': return isRtChronicleBoss(id);
    case 'hero': return isRtHeroId(id);
    case 'npc': return (RT_HEARTH_NPCS as readonly string[]).includes(id);
    default: return RT_CHRONICLE_CHAPTER_REFS.includes(id);
  }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sortedOf = (value: unknown, known: (id: string) => boolean): string[] | undefined => {
  const list = Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && known(id)))].sort() : [];
  return list.length ? list : undefined;
};
const refsOf = (value: unknown): string[] | undefined => {
  const list = Array.isArray(value) ? [...new Set(value.filter(isRtChronicleRef))] : [];
  return list.length ? list : undefined;
};

/** A stored chronicle: unknown ids dropped, counts whole from 0; empty — absent. */
export function parseRtChronicle(value: unknown): RtChronicle | undefined {
  if (!isPlain(value)) return undefined;
  const kinds = sortedOf(value.kinds, id => RT_CHRONICLE_KINDS.includes(id)), affixes = sortedOf(value.affixes, id => RT_CHRONICLE_AFFIXES.includes(id));
  const bosses = Object.fromEntries(RT_CHRONICLE_BOSSES.flatMap(({ id }) => {
    const b = isPlain(value.bosses) ? value.bosses[id] : undefined;
    return isPlain(b) && isCount(b.met) ? [[id, { met: b.met, ...isCount(b.won) ? { won: b.won } : {} }]] : [];
  })) as RtChronicle['bosses'];
  const events = sortedOf(value.events, id => RT_CHRONICLE_EVENTS.some(event => event.id === id));
  const items = isPlain(value.items) ? Object.fromEntries(Object.entries(value.items).filter(([id, v]) => isRtChronicleItem(id) && (v === 1 || v === 2))) as Record<string, 1 | 2> : {};
  const fusions = sortedOf(value.fusions, isRtChronicleFusion), unread = refsOf(value.unread), fresh = refsOf(value.fresh);
  const out: RtChronicle = {
    ...kinds ? { kinds } : {}, ...affixes ? { affixes } : {}, ...value.elites === true ? { elites: true as const } : {}, ...Object.keys(bosses ?? {}).length ? { bosses } : {}, ...events ? { events } : {},
    ...Object.keys(items).length ? { items } : {}, ...fusions ? { fusions } : {}, ...unread ? { unread } : {}, ...fresh ? { fresh } : {},
    ...isCount(value.since) ? { since: value.since } : {}, ...value.retro === true ? { retro: true as const } : {},
  };
  return Object.keys(out).length ? out : undefined;
}

/** A schedule element of an elite met (`elite`, `affix`, `affix:<id>`). */
const isEliteElement = (id: string): boolean => id === 'elite' || id === 'affix' || id.startsWith('affix:');
/** The refs `refs` join `unread` and `fresh` (each once). */
function note(c: RtChronicle, refs: readonly string[]): void {
  if (!refs.length) return;
  c.unread = [...new Set([...c.unread ?? [], ...refs])];
  c.fresh = [...new Set([...c.fresh ?? [], ...refs])];
}
const addSorted = (list: string[] | undefined, ids: readonly string[]): { list: string[] | undefined; added: string[] } => {
  const added = [...new Set(ids)].filter(id => !list?.includes(id));
  return { list: added.length ? [...list ?? [], ...added].sort() : list, added };
};

/** What a fight of a meta run brought into view: the kinds, the elite affixes, an elite (with or without an affix). */
export interface RtChronicleMet { kinds: readonly string[]; affixes: readonly string[]; elite?: boolean }
/**
 * The view saw kinds, affixes, an elite come into view in a fight of a meta run (variant A; the caller checked: not the sandbox, not the
 * prologue; a run with a given seed is the store's to refuse): the new ones join the chronicle and its unread. `changed` false — nothing
 * new (no write).
 */
export function rtChronicleMeet(previous: RtChronicle | undefined, met: RtChronicleMet): { chronicle: RtChronicle | undefined; changed: boolean } {
  const c: RtChronicle = structuredClone(previous ?? {});
  const k = addSorted(c.kinds, met.kinds.filter(id => RT_CHRONICLE_KINDS.includes(id))), a = addSorted(c.affixes, met.affixes.filter(id => RT_CHRONICLE_AFFIXES.includes(id)));
  const elite = (met.elite === true || a.added.length > 0) && !c.elites;
  if (!k.added.length && !a.added.length && !elite) return { chronicle: previous, changed: false };
  c.kinds = k.list; c.affixes = a.list;
  if (elite) c.elites = true;
  note(c, [...k.added.map(id => `kind:${id}`), ...a.added.map(id => `affix:${id}`)]);
  return { chronicle: c, changed: true };
}

/**
 * What the meta's change from `before` to `after` adds (refs): Ведунья freed, a hero's best «Испытание» climbed (one ref per new step),
 * an NPC come, the garrison's chapter open (the first level-2 record of any hero).
 */
export function rtChronicleMetaRefs(before: RtMeta | undefined, after: RtMeta): string[] {
  const refs: string[] = [];
  if (after.freed?.toad && !before?.freed?.toad) refs.push('hero:toad');
  for (const hero of RT_HERO_IDS) {
    const was = before?.heroes[hero]?.ashBest ?? 0, now = after.heroes[hero]?.ashBest ?? 0;
    for (let step = was + 1; step <= now; step++) refs.push(`ash:${hero}:${step}`);
  }
  for (const npc of RT_HEARTH_NPCS) if (npc !== 'owl' && after.hearth?.met[npc] && !before?.hearth?.met[npc]) refs.push(`npc:${npc}`);
  if (rtChronicleGarrisonOpen(after) && !rtChronicleGarrisonOpen(before)) refs.push('chapter:garrison');
  // Task 55в: the castle's chapter open (the first level-3 record of any hero).
  if (rtChronicleCastleOpen(after) && !rtChronicleCastleOpen(before)) refs.push('chapter:castle');
  return refs;
}
/** The garrison's chapters are open: a hero's record reached the garrison (`level` 2, or passed it). */
export const rtChronicleGarrisonOpen = (meta: RtMeta | undefined): boolean =>
  !!meta && RT_HERO_IDS.some(id => { const r = meta.heroes[id]?.record; return !!r && ((r.level ?? 1) >= 2 || (r.wonLevel ?? 0) >= 2); });

/**
 * Task 55в (task 58 spec 4, rule 1): the castle's chapters are open — a hero's record reached the castle (`level` 3: a castle node entered,
 * or `wonLevel` 3). The view shows them only in a build with the castle (`chronicleLevels`).
 */
export const rtChronicleCastleOpen = (meta: RtMeta | undefined): boolean =>
  !!meta && RT_HERO_IDS.some(id => { const r = meta.heroes[id]?.record; return !!r && (r.level === 3 || r.wonLevel === 3); });

/** The meta changed (`rtChronicleMetaRefs`) outside a run's end (the store's `freeHero`): its refs join the chronicle. */
export function rtChronicleNote(previous: RtChronicle | undefined, refs: readonly string[]): RtChronicle | undefined {
  if (!refs.length) return previous;
  const c: RtChronicle = structuredClone(previous ?? {});
  note(c, refs);
  return c;
}

/**
 * The items a run took: its talismans; a form or a fusion it held and lost (a form of the same field replaced it; a fusion took its
 * parts) — every form and fusion in `talismansGone` was taken, never left on a screen (`rtChooseTalisman` and the merchant keep the
 * forms out of it); task 58в: in a run with `chronicle`, an item of a field («Близнецы», «Якорь у героя») in `talismansGone` and not
 * in `shown` — replaced, so taken; the parts of every fusion made; the hammer. The hero's innate items (Ведунья's «Печать») are not taken.
 */
export function rtChronicleTaken(run: Pick<RtRunState, 'talismans' | 'talismansGone' | 'hammer' | 'heroId' | 'chronicle' | 'shown'>): string[] {
  const innate = rtInnate(run);
  const replaced = (id: string): boolean => !!run.chronicle && rtFormField(id) !== null && !run.shown?.includes(id);
  const held = [...run.talismans, ...run.talismansGone.filter(id => isRtForm(id) || isRtChronicleFusion(id) || replaced(id)), ...run.hammer ? [run.hammer] : []];
  const parts = held.filter(isRtChronicleFusion).flatMap(rtChronicleParts);
  return [...new Set([...held, ...parts])].filter(id => isRtChronicleItem(id) && !innate.includes(id));
}

/**
 * The end of a meta run (`rtApplyMeta`): the events it entered (and the circle), the items seen (in `talismansGone`, not taken) and taken,
 * the fusions made (and the ones whose both parts it held — «seen»), the bosses fought (the first meeting and the first win, the viewer's
 * run `viewerRun`; 0 — not counted). `metaRefs` — the meta's own changes (`rtChronicleMetaRefs`). `added` — every ref this run added: its
 * fights' (`fresh`) and these; `fresh` is emptied.
 */
export function rtChronicleRun(previous: RtChronicle | undefined, run: RtRunState, viewerRun: number, metaRefs: readonly string[]): { chronicle: RtChronicle | undefined; added: string[] } {
  const c: RtChronicle = structuredClone(previous ?? {}), refs: string[] = [...metaRefs];
  // Events: the nodes entered with an event; the circle.
  const entered = [...run.picks.flatMap(pick => pick.eventId && RT_CHRONICLE_EVENTS.some(e => e.id === pick.eventId) ? [pick.eventId] : []), ...run.casino ? [RT_CHRONICLE_CASINO] : []];
  const ev = addSorted(c.events, entered);
  c.events = ev.list; refs.push(...ev.added.map(id => `event:${id}`));
  // Items: taken (2) over seen (1).
  const taken = rtChronicleTaken(run), items = { ...c.items };
  // Task 58в: `shown` — the forms, the field's items, the hammers, the rerolled and the knack's refused cards a screen showed.
  for (const id of [...run.talismansGone, ...run.shown ?? []]) if (isRtChronicleItem(id) && !taken.includes(id) && !items[id]) items[id] = 1;
  // A fusion «seen» (spec 3.4, question 11): both parts taken in this run (a form replaced before its end too; Ведунья's innate part).
  for (const recipe of RT_CHRONICLE_ITEMS.fusions) {
    const parts = rtChronicleParts(recipe), innate = rtInnate(run);
    if (!taken.includes(recipe) && !items[recipe] && parts.every(part => taken.includes(part) || innate.includes(part))) items[recipe] = 1;
  }
  for (const id of taken) if (items[id] !== 2) { items[id] = 2; refs.push(`item:${id}`); }
  if (Object.keys(items).length) c.items = items;
  c.fusions = addSorted(c.fusions, taken.filter(isRtChronicleFusion)).list;
  // An elite met in a fight of the run (the schedule's elements of its fights: `elite`, `affix`, `affix:<id>`).
  if (!c.elites && run.battles.some(entry => entry.seen?.some(isEliteElement))) c.elites = true;
  // Bosses: the first meeting, the first win.
  for (const boss of RT_CHRONICLE_BOSSES) {
    const fights = run.battles.filter(entry => boss.arenas.includes(entry.arena));
    if (!fights.length) continue;
    const was = c.bosses?.[boss.id], won = fights.some(entry => entry.won);
    const now = { met: was?.met ?? viewerRun, ...was?.won !== undefined ? { won: was.won } : won ? { won: viewerRun } : {} };
    if (!was || (now.won !== undefined && was.won === undefined)) { c.bosses = { ...c.bosses, [boss.id]: now }; refs.push(`boss:${boss.id}`); }
  }
  const added = [...new Set([...c.fresh ?? [], ...refs])];
  if (refs.length) c.unread = [...new Set([...c.unread ?? [], ...refs])];
  delete c.fresh;
  for (const key of Object.keys(c) as (keyof RtChronicle)[]) if (c[key] === undefined) delete c[key];
  return { chronicle: Object.keys(c).length ? c : undefined, added };
}

/** The view's memory of the kinds and affixes met before the chronicle (П8, `view/newSeen.ts`). */
export interface RtChronicleMemory { kinds: readonly string[]; affixes: readonly string[] }
/**
 * The retro (section 8), once a profile (`since` set): the kinds and affixes of the П8 memory and of the schedule's history (`seen`:
 * the kinds, `affix:<id>`), the Jailer won (Ведунья freed: her run), the Castellan won (a record that passed the garrison: run 0). Not
 * new: nothing joins `unread`. `retro` — it brought something. `runs` — the viewer's runs now (`since`).
 */
export function rtChronicleImport(previous: RtChronicle | undefined, memory: RtChronicleMemory, profile: { seen?: readonly string[]; meta?: RtMeta; runs?: number }): { chronicle: RtChronicle; changed: boolean } {
  if (previous?.since !== undefined) return { chronicle: previous, changed: false };
  const c: RtChronicle = structuredClone(previous ?? {}), seen = (profile.seen ?? []).filter(isScheduleElement);
  const k = addSorted(c.kinds, [...memory.kinds, ...seen].filter(id => RT_CHRONICLE_KINDS.includes(id)));
  const a = addSorted(c.affixes, [...memory.affixes, ...seen.flatMap(id => id.startsWith('affix:') ? [id.slice(6)] : [])].filter(id => RT_CHRONICLE_AFFIXES.includes(id)));
  c.kinds = k.list; c.affixes = a.list;
  // The elite met: the history's `elite` / `affix…` or an affix of the memory — the only read of `profile.seen` (design 21.10.2026).
  const elite = !c.elites && (seen.some(isEliteElement) || a.list !== undefined);
  if (elite) c.elites = true;
  let bosses = 0;
  const freed = profile.meta?.freed?.toad;
  if (freed && c.bosses?.jailer?.won === undefined) { c.bosses = { ...c.bosses, jailer: { met: c.bosses?.jailer?.met ?? freed.run ?? 0, won: freed.run ?? 0 } }; bosses++; }
  // Task 55в: a record that passed the castle has passed the garrison too.
  const castellan = RT_HERO_IDS.some(id => (profile.meta?.heroes[id]?.record?.wonLevel ?? 0) >= 2);
  if (castellan && c.bosses?.castellan?.won === undefined) { c.bosses = { ...c.bosses, castellan: { met: c.bosses?.castellan?.met ?? 0, won: 0 } }; bosses++; }
  c.since = profile.runs ?? 0;
  if (k.added.length || a.added.length || elite || bosses) c.retro = true;
  for (const key of Object.keys(c) as (keyof RtChronicle)[]) if (c[key] === undefined) delete c[key];
  return { chronicle: c, changed: true };
}

/** The chronicle was opened: its unread are read. */
export function rtChronicleRead(previous: RtChronicle | undefined): { chronicle: RtChronicle | undefined; changed: boolean } {
  if (!previous?.unread) return { chronicle: previous, changed: false };
  const c = structuredClone(previous);
  delete c.unread;
  return { chronicle: Object.keys(c).length ? c : undefined, changed: true };
}

/** The page of a ref (the view's «✦» on a tab). */
export function rtChronicleRefPage(ref: string): (typeof RT_CHRONICLE_PAGES)[number] {
  const kind = ref.slice(0, ref.indexOf(':'));
  return kind === 'kind' || kind === 'affix' || kind === 'chapter' ? 'bestiary' : kind === 'boss' ? 'bosses' : kind === 'event' ? 'events' : kind === 'item' ? 'items' : kind === 'npc' ? 'hearth' : 'heroes';
}
