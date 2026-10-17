/**
 * TEMPORARY (task 58б, 17.10.2026): a stand-in for core's chronicle (58а: `run/chronicleCatalog.ts`, `meta.chronicle`, `rtChronicleView`,
 * `chronicleMeet`, `chronicleImport`, `chronicleRead`) until it lands. Core's implementation of `ChronicleSource` replaces this file;
 * nothing else in the view imports it but `main.ts`/`runView.ts` (the one place the source is made) and the tests.
 *
 * It keeps its state in memory only: it NEVER writes the profile or the browser's storage, and it holds no rule of the game — it builds
 * the contract of section 7.4 from a small state, so the window can be drawn, tested and shot. Its catalogue is read from the code
 * (SCHEDULE_KINDS, FOREST_EVENTS, RT_TALISMANS …); the hiding rules of section 4 are mimicked just enough for the fixtures.
 */
import { FOREST_EVENTS } from '../forest/forestEvents';
import { AFFIX_IDS } from '../sim/elites';
import { FUSION_RECIPES } from '../sim/buildIds';
import { SCHEDULE_KINDS } from '../run/schedule';
import { RT_META_PACKS } from '../run/metaCatalog';
import { RT_ASH_MAX } from '../run/rtRun';
import { RT_FORMS, RT_FUSIONS, RT_OPENERS, RT_RELICS, RT_TALISMANS } from '../run/rtTalismans';
import type { ChronicleAdded, ChronicleChapter, ChronicleEntry, ChronicleMemory, ChroniclePage, ChroniclePageId, ChronicleSource, ChronicleView } from './chronicleModel';
import { CASINO_EVENT } from './chronicleView';

const GARRISON_KINDS = ['guard', 'handler', 'hound', 'keymaster', 'crossbow', 'knight'] as const;
/** The items and events a pack opens (view/metaModel.ts `META_PACKS`): locked until the pack is open. */
const PACK_ITEMS = RT_META_PACKS.flatMap(pack => pack.items.filter(item => item.kind !== 'event').map(item => item.id));
const PACK_EVENTS = RT_META_PACKS.flatMap(pack => pack.items.filter(item => item.kind === 'event').map(item => item.id));

/** What the stub knows. Everything is optional; an empty state is a viewer who has seen nothing. */
export interface StubState {
  kinds: string[]; affixes: string[];
  /** A boss: met (+ won, with the run's number; 0 — unknown). */
  bosses: Record<string, { met: boolean; won?: number }>;
  events: string[];
  /** 1 — seen, 2 — taken. */
  items: Record<string, 1 | 2>;
  /** The packs' items and events that are open (the rest are locked). */
  open: string[];
  garrison: boolean; fusionsShown: boolean; elitesShown: boolean;
  toad: number | null; ash: { cat?: number; toad?: number };
  npc: { herb: boolean; smith: boolean };
  unread: string[];
}

export const emptyStubState = (): StubState => ({ kinds: [], affixes: [], bosses: {}, events: [], items: {}, open: [], garrison: false, fusionsShown: false, elitesShown: false, toad: null, ash: {}, npc: { herb: false, smith: false }, unread: [] });

/** The fixtures of the contract: a novice in the first camp, a viewer after the garrison, a half recipe, unread marks. */
export const CHRONICLE_FIXTURES: Readonly<Record<string, () => StubState>> = {
  /** The first camp of a newcomer: two kinds met, the forest's bosses not yet, nothing else. */
  novice: () => ({ ...emptyStubState(), kinds: ['wolf', 'boar'], events: ['brook'], items: { whetstone: 2, 'dew-flask': 1 } }),
  /** After the garrison: the garrison's chapters open, the Castellan won, Ведунья free, fusions made, the Испытание climbed. */
  garrison: () => ({
    ...emptyStubState(), kinds: [...SCHEDULE_KINDS, 'guard', 'handler', 'hound'], affixes: ['fiery', 'swift'],
    bosses: { jailer: { met: true, won: 3 }, troll: { met: true }, castellan: { met: true, won: 14 } },
    events: ['brook', 'goblin-cache', 'owl-hollow', 'warm-den', CASINO_EVENT, 'porcupine-nest'],
    items: { whetstone: 2, 'dew-flask': 2, 'tough-hide': 1, prism: 2, 'frost-edge': 2, 'form-seal': 2, 'fusion-ice-seal': 2, 'relic-swift-feet': 1, 'fire-pass': 2, 'elite-hunter': 1 },
    open: ['prism', 'frost-edge', 'form-twins', 'porcupine-nest', 'elite-hunter', 'finishing-blow', 'return-pass', 'relic-swift-feet'],
    garrison: true, fusionsShown: true, elitesShown: true, toad: 3, ash: { cat: 5, toad: 2 }, npc: { herb: true, smith: true }, unread: [],
  }),
  /** A half recipe: «Иней на клинке» is taken, its fusion's «?» shows «Иней на клинке + ?». */
  fusionHalf: () => ({ ...CHRONICLE_FIXTURES.novice!(), items: { whetstone: 2, 'frost-edge': 2, prism: 1 }, open: ['frost-edge', 'prism'], fusionsShown: true }),
  /** Unread marks on two pages (a kind and an item). */
  unread: () => ({ ...CHRONICLE_FIXTURES.novice!(), kinds: ['wolf', 'boar', 'lynx'], items: { whetstone: 2, prism: 2 }, open: ['prism'], unread: ['kind:lynx', 'item:prism'] }),
};

const PAGE_OF_REF: Readonly<Record<string, ChroniclePageId>> = { kind: 'bestiary', affix: 'bestiary', event: 'events', item: 'items', boss: 'bosses', hero: 'heroes', ash: 'heroes', npc: 'hearth', chapter: 'bestiary' };

const TALISMAN_IDS = [...RT_TALISMANS.filter(t => t.rarity !== 'relic').map(t => t.id), ...RT_OPENERS.map(t => t.id)];

function entries(ids: readonly string[], state: (id: string) => ChronicleEntry['state'] | ChronicleEntry): ChronicleEntry[] {
  return ids.map(id => { const s = state(id); return typeof s === 'string' ? { id, state: s } : s; });
}
const chapter = (id: string, level: number, list: ChronicleEntry[]): ChronicleChapter => ({ id, level, state: 'open', entries: list });
const blank = (level: number): ChronicleChapter => ({ id: `blank-${level}`, level, state: 'blank', entries: [] });

const SEEN = new Set(['seen', 'taken', 'met', 'won']);
function page(id: ChroniclePageId, chapters: ChronicleChapter[], unread: boolean): ChroniclePage {
  const all = chapters.flatMap(c => c.entries);
  return { id, have: all.filter(e => SEEN.has(e.state)).length, known: all.length, unread, chapters };
}

/** The contract of a state (what core's `rtChronicleView` does for the profile). */
export function stubView(s: StubState): ChronicleView {
  const kinds = new Set(s.kinds), affixes = new Set(s.affixes), events = new Set(s.events), open = new Set(s.open);
  const unreadOf = (id: ChroniclePageId): boolean => s.unread.some(ref => PAGE_OF_REF[ref.slice(0, ref.indexOf(':'))] === id);
  const bestiary: ChronicleChapter[] = [chapter('forest', 1, entries(SCHEDULE_KINDS, id => kinds.has(id) ? 'seen' : 'unknown'))];
  if (s.elitesShown || affixes.size) bestiary.push(chapter('affixes', 1, entries(AFFIX_IDS, id => affixes.has(id) ? 'seen' : 'unknown')));
  bestiary.push(s.garrison ? chapter('garrison', 2, entries(GARRISON_KINDS, id => kinds.has(id) ? 'seen' : 'unknown')) : blank(2));
  if (s.garrison) bestiary.push(blank(3));

  const boss = (id: string): ChronicleEntry => { const b = s.bosses[id]; return b?.won !== undefined ? { id, state: 'won', run: b.won } : { id, state: b?.met ? 'met' : 'unknown' }; };
  const bosses: ChronicleChapter[] = [chapter('forest', 1, [boss('jailer'), boss('troll')])];
  bosses.push(s.garrison ? chapter('garrison', 2, [boss('castellan')]) : blank(2));
  if (s.garrison) bosses.push(blank(3));

  const eventIds = [...Object.keys(FOREST_EVENTS), CASINO_EVENT];
  const evs = chapter('forest', 1, entries(eventIds, id => PACK_EVENTS.includes(id) && !open.has(id) && !events.has(id) ? 'locked' : events.has(id) ? 'seen' : 'unknown'));

  const itemState = (id: string): ChronicleEntry => {
    const level = s.items[id];
    if (level) return { id, state: level === 2 ? 'taken' : 'seen' };
    if (PACK_ITEMS.includes(id) && !open.has(id)) return { id, state: 'locked' };
    const recipe = FUSION_RECIPES.find(r => r.fusion === id);
    const half = recipe && [recipe.form, recipe.counter].find(part => s.items[part] === 2);
    return { id, state: 'unknown', ...half ? { half } : {} };
  };
  const items: ChronicleChapter[] = [
    chapter('talismans', 0, TALISMAN_IDS.map(itemState)), chapter('relics', 0, RT_RELICS.map(t => itemState(t.id))), chapter('forms', 0, RT_FORMS.map(t => itemState(t.id))),
  ];
  if (s.fusionsShown) items.push(chapter('fusions', 0, RT_FUSIONS.map(t => itemState(t.id))));

  const heroes: ChronicleChapter[] = [chapter('heroes', 0, [{ id: 'cat', state: 'seen' }, ...s.bosses.jailer?.met ? [s.toad !== null ? { id: 'toad', state: 'met' as const, run: s.toad } : { id: 'toad', state: 'unknown' as const }] : []])];
  for (const hero of ['cat', 'toad'] as const) {
    const best = s.ash[hero];
    if (best !== undefined) heroes.push(chapter(`ash-${hero}`, 0, Array.from({ length: RT_ASH_MAX }, (_, i) => ({ id: `ash:${hero}:${i + 1}`, state: i + 1 <= best ? 'seen' as const : 'unknown' as const }))));
  }
  const hearth = [chapter('hearth', 0, [{ id: 'owl', state: 'met' }, { id: 'herb', state: s.npc.herb ? 'met' : 'unknown' }, { id: 'smith', state: s.npc.smith ? 'met' : 'unknown' }])];

  const pages = [page('bestiary', bestiary, unreadOf('bestiary')), page('bosses', bosses, unreadOf('bosses')), page('events', [evs], unreadOf('events')),
    page('items', items, unreadOf('items')), page('heroes', heroes, unreadOf('heroes')), page('hearth', hearth, unreadOf('hearth'))];
  return { total: [pages.reduce((a, p) => a + p.have, 0), pages.reduce((a, p) => a + p.known, 0)], pages };
}

/** The in-memory source. `load(name)` swaps the state for a fixture (the test hook); nothing here is stored. */
export class ChronicleStub implements ChronicleSource {
  private s: StubState;
  private pending: string[] = [];
  private readonly runs = new Map<string, string[]>();
  private imported = false;
  /** Test counters: calls made and what the last `meet` carried. */
  readonly calls = { view: 0, meet: 0, import: 0, read: 0, lastMeet: { kinds: [] as string[], affixes: [] as string[] } };

  constructor(state: StubState = emptyStubState()) { this.s = state; }

  load(name: string): boolean {
    const make = CHRONICLE_FIXTURES[name];
    if (!make) return false;
    this.s = make(); this.pending = []; this.runs.clear(); this.imported = true;
    return true;
  }

  view(): ChronicleView { this.calls.view++; return stubView(this.s); }

  meet(kinds: readonly string[], affixes: readonly string[]): void {
    this.calls.meet++; this.calls.lastMeet = { kinds: [...kinds], affixes: [...affixes] };
    for (const kind of kinds) if (!this.s.kinds.includes(kind)) { this.s.kinds.push(kind); this.note(`kind:${kind}`); }
    for (const affix of affixes) if (!this.s.affixes.includes(affix)) { this.s.affixes.push(affix); this.s.elitesShown = true; this.note(`affix:${affix}`); }
  }

  import(memory: ChronicleMemory): void {
    this.calls.import++;
    if (this.imported) return;
    this.imported = true;
    // The retro is not «new»: no unread, nothing for a run's line.
    for (const kind of memory.kinds) if (!this.s.kinds.includes(kind)) this.s.kinds.push(kind);
    for (const affix of memory.affixes) if (!this.s.affixes.includes(affix)) { this.s.affixes.push(affix); this.s.elitesShown = true; }
  }

  read(): void { this.calls.read++; this.s.unread = []; }

  added(runKey: string): ChronicleAdded {
    if (!this.runs.has(runKey)) { this.runs.set(runKey, this.pending); this.pending = []; }
    return { refs: [...this.runs.get(runKey)!] };
  }

  private note(ref: string): void { this.s.unread.push(ref); this.pending.push(ref); }
}
