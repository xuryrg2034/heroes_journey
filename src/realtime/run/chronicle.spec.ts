/**
 * Task 58 «Летопись», core 58а (docs/design-notes/task-58-discovery.md, sections 4, 6.1, 7, 8, 10 and 11). Node only:
 * `npm run test:realtime-chronicle`. Whole runs walked by the run's own commands (metaWalk.testkit.ts), the profile as the view keeps it
 * (`createRtProfileStore` with the chronicle on):
 * - 58в: every item a screen showed is written at least as seen; a field's item replaced reads as taken; the note `shown` changes no
 *   draw (state for state), is absent without the flag and reads strictly; it holds only what a screen displayed (a real reroll notes the
 *   options on the screen) and never an item locked by the packs;
 * - «Свойства элит» from the chronicle's own fact (the history read once by the retro; «Обучение» never shrinks the book); a stored
 *   chronicle reads strictly (garbage dropped, an empty field absent); a seeded run's fights write nothing;
 * - «видел» never lowers «взял» (an item taken, then seen in a later run, stays taken);
 * - a meta run's end writes what it did: the events entered (the circle), the items taken and seen, the fusions made, the bosses met and
 *   won with the viewer's run, the hero freed, the garrison's chapter; the run's list (`chronicleAdded`) holds its fights' kinds too;
 * - a run with a given seed writes nothing; an abandoned run writes; a second end of the same run writes nothing twice; «Обучение»
 *   keeps the chronicle; with the chronicle off (and before its first write) a profile reads and writes byte for byte as before;
 * - the retro on fixtures (the П8 memory, the history, Ведунья freed, the garrison passed, the best «Испытание»), once;
 * - nothing hidden leaks into the contract (the garrison before it is reached, Ведунья before the Jailer, the locked items' state);
 * - the owl's hint: different targets on different profiles, always obtainable, the same input — the same hint, a target seen — gone;
 * - the telemetry's fields, `checkRecord`, the report's section «Летопись».
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { offeredNow, ok, seedOf, walkRun, type Walk } from './metaWalk.testkit';
import { createRtProfileStore, parseRtProfile, RT_PROFILE_STORAGE_KEY, type RtProfileStore, type RunStorage } from './rtRunStorage';
import { parseRtMeta, rtMetaLocked, rtRunKey } from './rtMeta';
import { RT_DAILY_PRESET } from './rtDaily';
import {
  createRtRun, parseRtRun, rtChooseHammer, rtChooseTalisman, rtHammerRerollView, rtInnate, rtRerollHammers, rtRerollTalismans, rtRerollView, rtShopLeave, rtShopReroll, rtShopRerollView,
  serializeRtRun, type RtRunState,
} from './rtRun';
import { isRtForm, rtFormField } from './rtTalismans';
import { FUSION_RECIPES } from '../sim/buildIds';
import { chronicleForestKinds, chronicleGarrisonKinds, rtChronicleParts, RT_CHRONICLE_BOSSES, RT_CHRONICLE_FOREST_KINDS, RT_CHRONICLE_GARRISON_KINDS, isRtChronicleFusion, isRtChronicleItem } from './chronicleCatalog';
import { CHRONICLE_FIXTURES, chronicleProfile } from '../view/chronicleFixtures.testkit';
import { RT_FOREST_SHOOTERS_ON } from './rtRun';
import { RT_GARRISON_STEP3_ON } from './garrison';
import { rtChronicleHint, rtChronicleView, type RtChronicleView } from './chroniclePages';
import { rtChronicleMeet, type RtChronicle } from './chronicle';
import { PITCHER } from '../sim/enemies/pitcher';
import { RECRUIT } from '../sim/enemies/recruit';
import { WARDEN } from '../sim/enemies/warden';
import { TROLL_RUN_ARENAS } from '../sim/arenasBoss';
import { RtRecorder } from '../telemetry/recorder';
import { memoryJournalStore, type KeyValueStore } from '../telemetry/buffer';
import { checkRecord, type RunRecord } from '../telemetry/schema';
import { chronicleSection } from '../telemetry/report';
import { defaultParams } from '../sim/params';

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> { await run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const NPCS = { gambler: true, monk: true };
const profileText = (storage: { data: Map<string, string> }): string => storage.data.get(RT_PROFILE_STORAGE_KEY) ?? '';
const chronicleOf = (store: RtProfileStore): RtChronicle => store.load().meta?.chronicle ?? {};
/** A meta run of the store: started (the viewer's run number), walked with the camp's flags, its fights' kinds met on the way. */
function metaRun(store: RtProfileStore, k: number, create: Record<string, unknown> = {}, extra: Partial<Parameters<typeof walkRun>[0]> = {}): { walk: Walk; viewerRun: number } {
  const viewerRun = store.startRun().run;
  const walk = walkRun({ k, create: { gift: 'full', garrison: false, forms: true, fusions: true, chronicle: true, locked: store.locked(), hearth: store.hearthStart(seedOf(k)).flags, ...create }, ...extra });
  return { walk, viewerRun };
}
const entry = (view: RtChronicleView, page: string, chapter: string, id: string) =>
  view.pages.find(p => p.id === page)?.chapters.find(c => c.id === chapter)?.entries.find(e => e.id === id);

await check('a meta run\'s end writes what the run did (events, items taken and seen, fusions, bosses with the viewer\'s run), its list holds them', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
  let events = 0, seen = 0, fusions = 0, troll = 0, casino = 0;
  for (let k = 1; k <= 12; k++) {
    const loseTroll = k % 3 === 0;
    const { walk, viewerRun } = metaRun(store, k, { garrison: k % 4 === 0 }, { fuse: true, circle: true, ...loseTroll ? { loseAt: (r: RtRunState, type: string) => type === 'boss' && r.pending?.kind === 'battle' && TROLL_RUN_ARENAS.includes(r.pending.arena) } : {} });
    const before = chronicleOf(store), run = walk.run;
    const end = store.endRunMeta(run)!, after = chronicleOf(store);
    assert(end.chronicle && same(store.chronicleAdded(rtRunKey(run)), end.chronicle.added), `seed ${k}: the run's list`);
    // Events: every event node entered; the circle.
    for (const pick of run.picks) if (pick.eventId) { assert(after.events?.includes(pick.eventId), `seed ${k}: event ${pick.eventId}`); events++; }
    if (run.casino) { assert(after.events?.includes('casino'), `seed ${k}: the circle`); casino++; }
    // Items: every talisman held at the end — taken (but the hero's innate); a talisman left on a screen — seen at least.
    for (const id of run.talismans) if (isRtChronicleItem(id) && !rtInnate(run).includes(id)) assert(after.items?.[id] === 2, `seed ${k}: ${id} taken`);
    for (const id of run.talismansGone) if (isRtChronicleItem(id) && !isRtForm(id) && !isRtChronicleFusion(id)) { assert((after.items?.[id] ?? 0) >= 1, `seed ${k}: ${id} seen`); if (after.items?.[id] === 1) seen++; }
    // Fusions: made at a rest — both parts taken.
    for (const id of run.talismans.filter(isRtChronicleFusion)) { assert(after.fusions?.includes(id) && rtChronicleParts(id).every(part => after.items?.[part] === 2), `seed ${k}: fusion ${id}`); fusions++; }
    // Bosses: the first meeting, the first win — with the viewer's run.
    for (const boss of RT_CHRONICLE_BOSSES) {
      const fights = run.battles.filter(b => boss.arenas.includes(b.arena));
      if (!fights.length) continue;
      const b = after.bosses?.[boss.id]!;
      assert(b && b.met === (before.bosses?.[boss.id]?.met ?? viewerRun), `seed ${k}: ${boss.id} met`);
      if (fights.some(f => f.won)) assert(b.won === (before.bosses?.[boss.id]?.won ?? viewerRun), `seed ${k}: ${boss.id} won`);
      else assert(b.won === before.bosses?.[boss.id]?.won, `seed ${k}: ${boss.id} lost — no win`);
      if (boss.id === 'troll' && !fights.some(f => f.won)) troll++;
    }
    // The list: new refs only, all unread.
    for (const ref of end.chronicle!.added) assert(after.unread?.includes(ref) && !before.unread?.includes(ref) || ref.startsWith('kind:'), `seed ${k}: ${ref} new`);
  }
  assert(events >= 5 && seen >= 3 && fusions >= 1 && troll >= 1 && casino >= 1, `covered: events ${events}, seen ${seen}, fusions ${fusions}, troll lost ${troll}, circle ${casino}`);
  const c = chronicleOf(store);
  assert(c.bosses?.jailer?.won !== undefined && c.bosses?.castellan?.won !== undefined, `the Jailer and the Castellan won: ${JSON.stringify(c.bosses)}`);
  assert(c.unread?.includes('hero:toad') && c.unread.includes('chapter:garrison'), 'Ведунья freed, the garrison\'s chapter');
});

await check('«видел» never lowers «взял»: an item taken in one run and only seen in a later one stays taken', () => {
  const store = createRtProfileStore(memoryStorage(), { chronicle: true });
  let kept = 0;
  for (let k = 1; k <= 16; k++) {
    const { walk } = metaRun(store, k, { garrison: false }, { circle: true });
    const before = chronicleOf(store).items ?? {};
    store.endRunMeta(walk.run);
    const after = chronicleOf(store).items ?? {};
    for (const [id, state] of Object.entries(before)) assert((after[id] ?? 0) >= state, `seed ${k}: ${id} ${state} → ${after[id]}`);
    // The case asked: taken before, shown and not taken in this run.
    for (const id of walk.run.talismansGone) if (before[id] === 2 && !walk.run.talismans.includes(id) && !isRtForm(id)) { assert(after[id] === 2, `seed ${k}: ${id} stays taken`); kept++; }
  }
  assert(kept >= 2, `covered: ${kept} items taken earlier and seen later`);
});

await check('58в «видел»: every item a screen showed (forms, hammers, the merchant, the knack, the rerolled) is written at least as seen; a field\'s item replaced reads as taken', () => {
  let forms = 0, hammers = 0, knacks = 0, replaced = 0;
  // Seeds 7 and 23 (garrison runs) meet «Якорь у героя» after «Близнецы» (found by a search over 500 seeds, 21.10.2026).
  const seeds = [...Array.from({ length: 12 }, (_, i) => ({ k: i + 1, garrison: (i + 1) % 3 === 0 })), { k: 7, garrison: true }, { k: 23, garrison: true }];
  for (const { k, garrison } of seeds) {
    // A new profile a run: what this run wrote, nothing of an earlier one.
    const store = createRtProfileStore(memoryStorage(), { chronicle: true });
    const shownNow = new Set<string>();
    // The walk takes «Близнецы» when offered, «Якорь у героя» whenever offered (the same field «Звено» — one replaces the other).
    const pick = (run: RtRunState, options: readonly string[]): string | null =>
      options.includes('form-twins') && !run.talismans.includes('hero-anchor') ? 'form-twins' : options.includes('hero-anchor') ? 'hero-anchor' : null;
    const { walk } = metaRun(store, k, { knacks: true, garrison, locked: [], ...k % 4 === 0 ? { forms: false, fusions: false } : {} }, { circle: true, jailerReroll: k % 2 ? 'form' : 'hammer', talisman: pick, each: state => {
      if (state.pending?.kind === 'gift') return;
      for (const id of offeredNow(state)) if (!id.endsWith(':2')) shownNow.add(id);
      if (state.pending?.kind === 'hammer') hammers++;
      if (state.pending?.kind === 'knack') knacks++;
    } });
    store.endRunMeta(walk.run);
    const items = chronicleOf(store).items ?? {};
    for (const id of shownNow) if (isRtChronicleItem(id)) { assert((items[id] ?? 0) >= 1, `seed ${k}: ${id} shown — written (${walk.run.shown})`); if (isRtForm(id)) forms++; }
    for (const id of ['form-twins', 'hero-anchor']) if (walk.run.talismansGone.includes(id) && !walk.run.shown?.includes(id)) { assert(items[id] === 2, `seed ${k}: ${id} replaced — taken`); replaced++; }
    for (const id of walk.run.shown ?? []) if (isRtChronicleItem(id) && !walk.run.talismans.includes(id)) assert(items[id] !== undefined, `seed ${k}: ${id} noted`);
  }
  assert(forms >= 5 && hammers >= 1 && knacks >= 3 && replaced >= 1, `covered: forms ${forms}, hammer screens ${hammers}, knack screens ${knacks}, «Близнецы» replaced ${replaced}`);
});

await check('58в: `shown` holds only what a screen displayed (a reroll notes the options on the screen before it, nothing drawn and dropped unseen); never an item locked by the packs', () => {
  let lockedRuns = 0, talismanRerolls = 0, hammerRerolls = 0, shopRerolls = 0;
  for (let k = 1; k <= 12; k++) {
    // A new profile: its packs lock their items (`store.locked()`; the hammer runs — odd seeds — none: a locked hammer leaves nothing to
    // reroll to); the camp gives free rerolls of the Jailer's screens and the merchant's.
    const store = createRtProfileStore(memoryStorage(), { chronicle: true });
    const displayed = new Set<string>(), screens: RtRunState[] = [];
    const { walk } = metaRun(store, k, { knacks: true, garrison: k % 3 === 0, hearth: { jailerRerolls: 1, shopRerolls: 1 }, ...k % 2 ? { forms: false, fusions: false, locked: [] } : {} }, { circle: true, each: state => {
      for (const id of offeredNow(state)) displayed.add(id.replace(/:2$/, ''));
      for (const id of state.shown ?? []) assert(displayed.has(id), `seed ${k}: ${id} in shown, never on a screen`);
      assert(!(state.shown ?? []).some(id => state.locked?.includes(id)), `seed ${k}: a locked item in shown`);
      if (!screens.some(s => s.pending?.kind === state.pending?.kind) && (rtRerollView(state)?.available || rtHammerRerollView(state)?.available || rtShopRerollView(state)?.available)) screens.push(state);
    } });
    if (walk.run.locked?.length && walk.run.shown?.length) lockedRuns++;
    // The rerolls made for real: the notes of the screen closed after are only the options of the screen before and after the reroll.
    for (const before of screens) {
      const kind = before.pending!.kind;
      const rerolled = ok(kind === 'talisman' ? rtRerollTalismans(before) : kind === 'hammer' ? rtRerollHammers(before) : rtShopReroll(before), `seed ${k}: ${kind} reroll`);
      const onScreen = (s: RtRunState): string[] => s.pending?.kind === 'shop' ? (s.pending.stock.talisman ? [s.pending.stock.talisman] : []) : (s.pending as { options: string[] }).options;
      // The reroll notes at most the screen's options before it (the merchant's talisman at once: its stock has no list of the rerolled).
      assert((rerolled.shown ?? []).filter(id => !before.shown?.includes(id)).every(id => onScreen(before).includes(id)), `seed ${k}: a reroll notes only the screen before it`);
      const closed = ok(kind === 'talisman' ? rtChooseTalisman(rerolled, null) : kind === 'hammer' ? rtChooseHammer(rerolled, null) : rtShopLeave(rerolled), `seed ${k}: ${kind} closed`);
      const fresh = (closed.shown ?? []).filter(id => !before.shown?.includes(id)), seen = [...onScreen(before), ...onScreen(rerolled)];
      assert(fresh.length && fresh.every(id => seen.includes(id)), `seed ${k}: ${kind} notes ${fresh} of the screens ${seen}`);
      assert(!fresh.some(id => closed.locked?.includes(id)), `seed ${k}: no locked item noted`);
      if (kind === 'talisman') talismanRerolls++; else if (kind === 'hammer') hammerRerolls++; else shopRerolls++;
    }
  }
  assert(lockedRuns >= 4 && talismanRerolls >= 2 && hammerRerolls >= 2 && shopRerolls >= 2, `covered: runs with locks ${lockedRuns}, rerolls: screens ${talismanRerolls}, hammers ${hammerRerolls}, merchant ${shopRerolls}`);
});

await check('58в: the note `shown` changes no draw (a run with it walks the run without it, state for state); without the flag no field; a save of it reads strictly', () => {
  for (let k = 1; k <= 8; k++) {
    const strip = (run: RtRunState): string => { const copy = structuredClone(run) as Partial<RtRunState>; delete copy.chronicle; delete copy.shown; return JSON.stringify(copy); };
    const a: string[] = [], b: string[] = [];
    let noted = false;
    walkRun({ k, create: { gift: 'full', garrison: k % 2 === 0, knacks: true, chronicle: true }, jailerReroll: 'form', each: state => { a.push(strip(state)); if (state.shown) noted = true; assert(serializeRtRun(parseRtRun(serializeRtRun(state))!) === serializeRtRun(state), `seed ${k}: reads back`); } });
    walkRun({ k, create: { gift: 'full', garrison: k % 2 === 0, knacks: true, chronicle: false }, jailerReroll: 'form', each: state => { b.push(JSON.stringify(state)); assert(!('shown' in state) && !('chronicle' in state), `seed ${k}: no field without the flag`); } });
    assert(same(a, b), `seed ${k}: the same walk`);
    assert(noted, `seed ${k}: something noted`);
  }
  const run = walkRun({ k: 3, create: { gift: 'full', garrison: false, chronicle: true } }).run, base = JSON.parse(serializeRtRun(run));
  assert(base.shown?.length, 'a noted run');
  const read = (patch: Record<string, unknown>) => parseRtRun(JSON.stringify({ ...base, ...patch }));
  assert(read({}) !== null && read({ chronicle: undefined }) === null && read({ shown: [] }) === null && read({ shown: ['no-such-item'] }) === null
    && read({ shown: [base.shown[0], base.shown[0]] }) === null && read({ shown: [...base.shown, base.talismans[0]] }) === null && read({ chronicle: 1 }) === null, 'malformed notes refused');
  // A save edited by hand: an item a pack locks, or the hero's innate «Печать» (Ведунья's), in `shown` — no run (no leak of the locked).
  const locked = walkRun({ k: 3, create: { gift: 'full', garrison: false, chronicle: true, locked: rtMetaLocked(undefined) } }).run, lockedBase = JSON.parse(serializeRtRun(locked));
  const lockedId = lockedBase.locked.find((id: string) => !lockedBase.shown?.includes(id))!;
  assert(lockedBase.shown?.length && parseRtRun(JSON.stringify(lockedBase)) !== null && parseRtRun(JSON.stringify({ ...lockedBase, shown: [...lockedBase.shown, lockedId] })) === null, `a locked item in shown refused (${lockedId})`);
  const toad = walkRun({ k: 5, create: { gift: 'full', garrison: false, chronicle: true, hero: 'toad' } }).run, toadBase = JSON.parse(serializeRtRun(toad));
  assert(toadBase.shown?.length && parseRtRun(JSON.stringify(toadBase)) !== null && parseRtRun(JSON.stringify({ ...toadBase, shown: [...toadBase.shown, 'form-seal'] })) === null, 'the innate «Печать» in shown refused');
});

await check('«Свойства элит» from the chronicle itself: the retro reads the history once; «Обучение» and later runs never shrink the book', () => {
  const storage = memoryStorage();
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, giftFull: true, runs: 4, seen: ['wolf', 'elite'], meta: { heroes: { cat: { xp: 40, packs: [] } } } }));
  const store = createRtProfileStore(storage, { chronicle: true });
  const chapters = (): string[] => store.chronicle().pages.find(p => p.id === 'bestiary')!.chapters.map(ch => ch.id);
  assert(!chapters().includes('affixes'), 'before the retro: no chapter');
  store.chronicleImport({ kinds: [], affixes: [] });
  const imported = store.chronicle();
  assert(chapters().includes('affixes') && chronicleOf(store).elites === true && !chronicleOf(store).affixes, `the retro: an elite without an affix — the chapter (${JSON.stringify(chronicleOf(store))})`);
  store.resetSchedule(seedOf(8));
  assert((store.load().seen ?? []).length === 0 && chapters().includes('affixes') && same(store.chronicle().total, imported.total), '«Обучение»: the history empty, the book the same');
  const { walk } = metaRun(store, 8);
  store.endRunMeta(walk.run);
  assert(chapters().includes('affixes') && store.chronicle().total[1] >= imported.total[1], 'a new run: the chapter stays, the book only grows');
  // The history is never read again: an elite of the history after the retro adds nothing; a fight's elite (no affix) does.
  const fresh = createRtProfileStore(memoryStorage(), { chronicle: true });
  fresh.chronicleImport({ kinds: [], affixes: [] });
  fresh.meetSchedule(['elite', 'affix:fiery'], seedOf(9));
  assert(!fresh.chronicle().pages.find(p => p.id === 'bestiary')!.chapters.some(ch => ch.id === 'affixes'), 'the history after the retro: not read');
  const run = metaRun(fresh, 9).walk.run;
  assert(fresh.chronicleMeet(run, { kinds: [], affixes: [], elite: true }) && fresh.chronicle().pages.find(p => p.id === 'bestiary')!.chapters.some(ch => ch.id === 'affixes'), 'a fight\'s elite: the chapter');
});

await check('a stored chronicle reads strictly: unknown ids, `__proto__`, negative counts, `ash:cat:9`, a non-object dropped; an empty field absent', () => {
  const meta = (chronicle: unknown) => parseRtMeta({ heroes: {}, chronicle });
  const c = meta(JSON.parse(JSON.stringify({ kinds: ['wolf', 'no-kind', 5, 'wolf'], affixes: ['fiery', 'x'], elites: 1,
    bosses: { jailer: { met: -1 }, troll: { met: 2, won: -3 }, castellan: 'x', warlock: { met: 1 } }, events: ['brook', 'nope'],
    items: { prism: 2, whetstone: 1, 'no-item': 2, 'fire-pass': 3 }, fusions: ['fusion-spear', 'prism'],
    unread: ['ash:cat:9', 'ash:cat:8', 'kind:wolf', 'kind:no', 'chapter:castle', 'bad', 'kind:wolf'], fresh: 7, since: -1, retro: 'yes' }).replace('"items":{', '"items":{"__proto__":2,')))!.chronicle!;
  assert(same(c, { kinds: ['wolf'], affixes: ['fiery'], bosses: { troll: { met: 2 } }, events: ['brook'], items: { prism: 2, whetstone: 1 }, fusions: ['fusion-spear'], unread: ['ash:cat:8', 'kind:wolf'] }), `the garbage dropped: ${JSON.stringify(c)}`);
  assert(Object.getPrototypeOf(c.items) === Object.prototype && !Object.prototype.hasOwnProperty.call(c.items, '__proto__'), '`__proto__` not kept');
  for (const empty of [{}, { kinds: [], items: {}, bosses: {}, unread: [] }, 'chronicle', 5, null, ['wolf']]) assert(meta(empty)!.chronicle === undefined && !('chronicle' in meta(empty)!), `empty or not an object: no field (${JSON.stringify(empty)})`);
});

await check('a fusion «seen»: both parts taken in one run, the form part replaced before the counter came (never held together)', () => {
  // Seeds 55 and 98 (garrison runs; a search over 200 seeds, 21.10.2026): the walk takes a recipe's form, replaces it by a form of the
  // same field, then takes the recipe's counter.
  let cases = 0;
  for (const k of [55, 98]) {
    const store = createRtProfileStore(memoryStorage(), { chronicle: true });
    const { walk } = metaRun(store, k, { garrison: true, locked: [] }, { talisman: (run, options) => {
      const gone = FUSION_RECIPES.find(r => run.talismansGone.includes(r.form) && !run.talismans.includes(r.form));
      if (gone && options.includes(gone.counter)) return gone.counter;
      const held = FUSION_RECIPES.find(r => run.talismans.includes(r.form));
      if (held && !gone) return options.find(id => id !== held.form && rtFormField(id) === rtFormField(held.form)) ?? null;
      return !held && !gone ? options.find(id => FUSION_RECIPES.some(r => r.form === id)) ?? null : null;
    } });
    store.endRunMeta(walk.run);
    const items = chronicleOf(store).items ?? {};
    for (const r of FUSION_RECIPES) if (walk.run.talismansGone.includes(r.form) && walk.run.talismans.includes(r.counter) && !walk.run.talismans.includes(r.fusion)) {
      assert(items[r.form] === 2 && items[r.counter] === 2 && items[r.fusion] === 1, `seed ${k}: ${r.fusion} seen (${items[r.form]}, ${items[r.counter]}, ${items[r.fusion]})`);
      assert(store.chronicle().pages.find(p => p.id === 'items')!.chapters.some(ch => ch.id === 'fusions'), `seed ${k}: the fusions' chapter`);
      cases++;
    }
  }
  assert(cases >= 2, `covered: ${cases}`);
});

await check('the fights\' kinds (`chronicleMeet`) join the run\'s list; repeats and unknown ids write nothing; the list stays the run\'s after a reload', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
  const { walk } = metaRun(store, 1, {}, {});
  assert(store.chronicleMeet(walk.run, { kinds: ['wolf', 'boar', 'no-such-kind'], affixes: ['fiery'] }), 'new kinds written');
  const text = profileText(storage);
  assert(!store.chronicleMeet(walk.run, { kinds: ['boar', 'wolf'], affixes: ['fiery'], elite: true }) && !store.chronicleMeet(walk.run, { kinds: ['no-such-kind'], affixes: ['no-affix'] }) && profileText(storage) === text, 'repeats and unknown ids: no write');
  const end = store.endRunMeta(walk.run)!;
  assert(['kind:wolf', 'kind:boar', 'affix:fiery'].every(ref => end.chronicle!.added.includes(ref)) && !end.chronicle!.added.includes('kind:no-such-kind'), `the run's list ${end.chronicle!.added}`);
  const again = createRtProfileStore(storage, { chronicle: true });
  assert(same(again.chronicleAdded(rtRunKey(walk.run)), end.chronicle!.added) && same(again.chronicleAdded('another'), []), 'the list after a reload; another key — none');
  // The next run's list starts empty: the kinds met before its end are its own.
  const next = metaRun(again, 2);
  again.chronicleMeet(next.walk.run, { kinds: ['lynx'], affixes: [] });
  const nextEnd = again.endRunMeta(next.walk.run)!;
  assert(nextEnd.chronicle!.added.includes('kind:lynx') && !nextEnd.chronicle!.added.includes('kind:wolf'), `the next run's list ${nextEnd.chronicle!.added}`);
});

await check('a run with a given seed writes nothing; an abandoned run writes; the same end twice writes once; «Обучение» keeps the chronicle', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
  store.chronicleMeet(metaRun(store, 2).walk.run, { kinds: ['wolf'], affixes: [] });
  const text = profileText(storage), seeded = walkRun({ k: 3, create: { gift: 'full', garrison: false, seeded: true } });
  // A seeded run (`?seed=`) and «Поход дня» (seeded too): its fights' kinds and its end write nothing.
  const daily = createRtRun(seedOf(4), { ...RT_DAILY_PRESET, schedule: [], garrison: false });
  assert(daily.seeded && !store.chronicleMeet(seeded.run, { kinds: ['lynx', 'guard'], affixes: ['swift'], elite: true }) && !store.chronicleMeet(daily, { kinds: ['lynx'], affixes: [] }), 'a seeded run\'s kinds: nothing');
  assert(store.endRunMeta(seeded.run) === null && profileText(storage) === text, 'a seeded run: nothing');
  // Abandoned on its way (no result): the events entered so far are written.
  let mid: RtRunState | undefined;
  metaRun(store, 5, {}, { each: state => { if (!mid && state.picks.some(p => p.eventId) && state.pending === null) mid = state; } });
  assert(mid && !mid.result, 'a state with an event entered');
  const end = store.endRunMeta(mid)!, written = profileText(storage);
  assert(mid.picks.filter(p => p.eventId).every(p => chronicleOf(store).events?.includes(p.eventId!)) && end.chronicle!.added.some(ref => ref.startsWith('event:')), 'the abandoned run wrote its events');
  assert(same(store.endRunMeta(mid), end) && profileText(storage) === written, 'the same end again: the same result, no write');
  const kept = JSON.stringify(chronicleOf(store));
  store.resetSchedule(seedOf(5));
  assert(JSON.stringify(chronicleOf(store)) === kept && (store.load().seen ?? []).length === 0, '«Обучение» empties the history, keeps the chronicle');
});

await check('the chronicle off: no field ever; a profile before the first write reads and writes byte for byte', () => {
  const off = memoryStorage(), on = memoryStorage();
  const a = createRtProfileStore(off, { chronicle: false });
  for (let k = 1; k <= 4; k++) { const { walk } = metaRun(a, k, { garrison: k === 2, chronicle: false }); a.endRunMeta(walk.run); a.freeHero(walk.run); }
  assert(!a.chronicleMeet({}, { kinds: ['wolf'], affixes: [] }) && !a.chronicleImport({ kinds: ['wolf'], affixes: [] }) && !a.chronicleRead() && !profileText(off).includes('chronicle'), 'off: nothing written');
  // A profile of before (no field) under a store with the chronicle on: what writes no chronicle keeps it byte for byte.
  on.data.set(RT_PROFILE_STORAGE_KEY, profileText(off));
  const c = createRtProfileStore(on, { chronicle: true });
  for (const s of [a, c]) { s.startRun(); s.markLine('owl:first'); s.buyHearth('owl', 1); s.hearthStart(seedOf(9)); s.chooseHero('cat'); }
  assert(profileText(on) === profileText(off) && parseRtProfile(profileText(on)).meta?.chronicle === undefined, 'byte for byte before the first write');
});

await check('the retro: the П8 memory, the history, Ведунья freed, the garrison passed, the best «Испытание» — once, nothing unread', () => {
  const base = { version: 1, giftFull: true, jailer: true, runs: 14, won: true, seen: ['wolf', 'shaman', 'elite', 'affix', 'affix:fiery', 'cliff'],
    meta: { heroes: { cat: { xp: 400, packs: ['hunter'], record: { row: 4, won: true, xp: 90, level: 2, wonLevel: 2 }, ashBest: 5 } }, freed: { toad: { row: 5, run: 3 } } } };
  const storage = memoryStorage();
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(base));
  const store = createRtProfileStore(storage, { chronicle: true });
  assert(store.chronicleImport({ kinds: ['lynx', 'guard', 'not-a-kind'], affixes: ['swift'] }), 'imported');
  const c = chronicleOf(store);
  assert(same(c.kinds, ['guard', 'lynx', 'shaman', 'wolf']) && same(c.affixes, ['fiery', 'swift']), `kinds and affixes ${JSON.stringify(c)}`);
  assert(same(c.bosses, { jailer: { met: 3, won: 3 }, castellan: { met: 0, won: 0 } }) && c.since === 14 && c.retro === true && !c.unread, `bosses, since, retro ${JSON.stringify(c)}`);
  const text = profileText(storage);
  assert(!store.chronicleImport({ kinds: ['boar'], affixes: [] }) && profileText(storage) === text, 'once: the second import does nothing');
  const view = store.chronicle('cat');
  assert(entry(view, 'heroes', 'ash-cat', 'ash:cat:5')?.state === 'seen' && entry(view, 'heroes', 'ash-cat', 'ash:cat:6')?.state === 'unknown', 'the ladder to V');
  assert(entry(view, 'bosses', 'forest', 'troll')?.state === 'unknown' && entry(view, 'bosses', 'garrison', 'castellan')?.state === 'won', 'the Troll «?» (no branch known), the Castellan won');
  assert(entry(view, 'heroes', 'heroes', 'toad')?.state === 'met' && entry(view, 'heroes', 'heroes', 'toad')?.run === 3 && view.unread === 0 && view.retro, 'Ведунья freed in run 3; nothing unread; the retro line');
  // A forest win without `ashBest` (before task 49): the ladder at 0; the forest passed without its branch: the Troll «?».
  const old = memoryStorage();
  old.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, giftFull: true, runs: 5, won: true, meta: { heroes: { cat: { xp: 90, packs: [], record: { row: 10, won: true, xp: 60 } } } } }));
  const s2 = createRtProfileStore(old, { chronicle: true });
  s2.chronicleImport({ kinds: [], affixes: [] });
  const v2 = s2.chronicle();
  assert(v2.pages.find(p => p.id === 'heroes')!.chapters.find(ch => ch.id === 'ash-cat')!.entries.every(e => e.state === 'unknown') && entry(v2, 'bosses', 'forest', 'troll')?.state === 'unknown' && !v2.retro, 'no ashBest: the ladder at 0; nothing brought — no retro line');
});

await check('nothing hidden leaks: the garrison before it is reached (one blank chapter), Ведунья before the Jailer, the locked items without a state of their own', () => {
  const store = createRtProfileStore(memoryStorage(), { chronicle: true });
  const fresh = store.chronicle();
  const ids = (v: RtChronicleView, page: string) => v.pages.find(p => p.id === page)!.chapters;
  for (const page of ['bestiary', 'bosses']) {
    const chapters = ids(fresh, page), blank = chapters.find(ch => ch.state === 'blank');
    assert(!chapters.some(ch => ch.id === 'garrison') && blank?.level === 2 && blank.entries.length === 0 && chapters.filter(ch => ch.state === 'blank').length === 1, `${page}: the garrison hidden, one blank chapter`);
  }
  assert(!JSON.stringify(fresh).includes('castellan') && !RT_CHRONICLE_GARRISON_KINDS.some(id => JSON.stringify(fresh).includes(`"${id}"`)), 'no garrison id in the contract');
  assert(!ids(fresh, 'heroes').flatMap(ch => ch.entries).some(e => e.id === 'toad') && !ids(fresh, 'heroes').some(ch => ch.id.startsWith('ash-')), 'Ведунья and the ladders hidden');
  const locked = ids(fresh, 'items').flatMap(ch => ch.entries).filter(e => e.state === 'locked');
  assert(locked.length >= 8 && locked.every(e => store.locked().includes(e.id)) && ids(fresh, 'events')[0].entries.filter(e => e.state === 'locked').length === 3, `the packs' items and events locked (${locked.length})`);
  assert(fresh.total[1] === fresh.pages.reduce((n, p) => n + p.known, 0) && fresh.total[0] === 1 + 1, `the counts: only the visible (${fresh.total})`);
  // After the garrison: its chapters open on both pages, no blank one (no further level in this build).
  const { walk } = metaRun(store, 2, { garrison: true });
  store.endRunMeta(walk.run);
  const after = store.chronicle();
  for (const page of ['bestiary', 'bosses']) assert(ids(after, page).some(ch => ch.id === 'garrison' && ch.state === 'open') && !ids(after, page).some(ch => ch.state === 'blank'), `${page}: the garrison open`);
  assert(after.total[1] > fresh.total[1], 'the book grew');
});

await check('the owl\'s hint: different targets on different profiles, always obtainable, the same input — the same hint, a target seen — gone', () => {
  const targets = new Set<string>();
  for (let k = 1; k <= 6; k++) {
    const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
    for (let r = 0; r < k; r++) { const { walk } = metaRun(store, k * 10 + r, { garrison: r % 2 === 1 }); store.endRunMeta(walk.run); }
    const profile = store.load(), view = store.chronicle();
    const hint = rtChronicleHint(profile, 'cat', NPCS);
    assert(hint && same(hint, rtChronicleHint(profile, 'cat', NPCS)) && same(view.hint, hint), `seed ${k}: a hint, the same twice`);
    targets.add(hint.target);
    // Obtainable: its entry is visible and empty (not locked, a level reached); a fusion names a part taken.
    for (let runs = 0; runs < 40; runs++) {
      const h = rtChronicleHint({ ...profile, runs }, 'cat', NPCS)!;
      const [kind, id] = h.target.split(':');
      const all = view.pages.flatMap(p => p.chapters.flatMap(ch => ch.entries));
      const target = all.find(e => e.id === (kind === 'ash' ? h.target : id));
      assert(target?.state === 'unknown', `seed ${k}: target ${h.target} visible and empty (${target?.state})`);
      if (kind === 'item') assert(h.part && profile.meta?.chronicle?.items?.[h.part] === 2, `seed ${k}: the fusion's part ${h.part}`);
    }
  }
  assert(targets.size >= 3, `different targets: ${[...targets]}`);
  // A target seen is never hinted again: every event target written into the profile.
  const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
  const { walk } = metaRun(store, 7);
  store.endRunMeta(walk.run);
  const profile = store.load(), before = new Set<string>();
  for (let runs = 0; runs < 60; runs++) before.add(rtChronicleHint({ ...profile, runs }, 'cat', NPCS)!.target);
  const events = [...before].filter(t => t.startsWith('event:')).map(t => t.slice(6));
  assert(events.length >= 3, 'event targets');
  const seen = { ...profile, meta: { ...profile.meta!, chronicle: { ...profile.meta!.chronicle, events: [...profile.meta!.chronicle?.events ?? [], ...events].sort() } } };
  for (let runs = 0; runs < 60; runs++) assert(!rtChronicleHint({ ...seen, runs }, 'cat', NPCS)!.target.startsWith('event:') || !events.includes(rtChronicleHint({ ...seen, runs }, 'cat', NPCS)!.target.slice(6)), 'a seen event is not hinted');
  // Ведунья: no fusion with her innate «Печать» is hinted.
  for (let runs = 0; runs < 60; runs++) assert(rtChronicleHint({ ...profile, runs }, 'toad', NPCS)?.target !== 'item:fusion-ice-seal', 'no «Ледяная печать» hint for Ведунья');
});

await check('read: the unread are read (the pages\' «✦», the count), once', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { chronicle: true });
  const { walk } = metaRun(store, 1);
  store.chronicleMeet(walk.run, { kinds: ['wolf'], affixes: [] });
  store.endRunMeta(walk.run);
  const before = store.chronicle();
  assert(before.unread > 0 && before.pages.find(p => p.id === 'bestiary')!.unread, 'unread before');
  assert(store.chronicleRead() && !store.chronicleRead(), 'read once');
  const after = store.chronicle();
  assert(after.unread === 0 && after.pages.every(p => !p.unread) && same(after.total, before.total), 'read: no «✦», the same counts');
});

await check('telemetry: the run record\'s `chronicle` (its list and the pages), `chronicleOpen`, `hint`; `checkRecord`; the report\'s section', async () => {
  const local: KeyValueStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as unknown as KeyValueStore; })();
  const rec = new RtRecorder({ sandbox: false, paramsStorage: 'p', params: defaultParams(), local, sessionStore: { getItem: () => null, setItem: () => undefined }, channel: null, sinkPollMs: 0, buffer: { storage: local, journals: memoryJournalStore() } });
  const store = createRtProfileStore(memoryStorage(), { chronicle: true });
  const { walk } = metaRun(store, 2);
  rec.runStarted(null, createRtRun(walk.run.seed, { garrison: false, gift: 'full' }));
  store.chronicleMeet(walk.run, { kinds: ['wolf', 'boar'], affixes: [] });
  const end = store.endRunMeta(walk.run)!, view = store.chronicle();
  rec.runMetaEnd(walk.run, end);
  rec.chronicleOpened(walk.run, { pages: ['bestiary', 'items'], seconds: 12.34, unread: true });
  rec.chronicleHint(walk.run, view.hint!); rec.chronicleHint(walk.run, { key: 'other', target: 'other' });
  await new Promise(resolve => setTimeout(resolve, 20));
  const record = (await rec.buffer.all()).filter((r): r is RunRecord => r.kind === 'run').pop()!;
  assert(record.chronicle && same(record.chronicle.added, end.chronicle!.added) && same(record.chronicle.pages, Object.fromEntries(view.pages.map(p => [p.id, [p.have, p.known]]))), `the record's chronicle ${JSON.stringify(record.chronicle)}`);
  assert(same(record.chronicleOpen, [{ pages: ['bestiary', 'items'], seconds: 12.3, unread: true }]) && same(record.hint, { key: view.hint!.key, target: view.hint!.target }), 'the window and the first hint');
  assert(checkRecord(record) === null, `checkRecord ${checkRecord(record)}`);
  for (const bad of [{ chronicle: { added: 'x', pages: {} } }, { chronicle: { added: [], pages: { items: [5, 2] } } }, { chronicleOpen: [{ pages: [], seconds: -1, unread: true }] }, { hint: { key: 1, target: 'x' } }])
    assert(checkRecord({ ...record, ...bad } as unknown as RunRecord) !== null, `malformed ${JSON.stringify(bad)} refused`);
  const section = chronicleSection([record, { ...record, viewerRun: 12, at: '2099-01-01T00:00:00.000Z' }]);
  assert(['Бестиарий', 'Талисманы и формы', 'Первые находки', 'Подсказка Неясыти', '1–3', '11–20'].every(word => section.includes(word)), section);
  assert(chronicleSection([]).includes('нет'), 'no runs — a line');
  rec.dispose();
});

await check('task 59б (spec 10; review 21.10.2026): the chapter «Гарнизон» by the flag of step 3 — 9 with it on (the build since 22.10.2026), 6 with it off (the pitcher, the recruit, the warden unknown, then «seen»); the owl’s hint takes them only with the flag; a kind met before stays in the profile with the flag off', () => {
  const novel = [PITCHER, RECRUIT, WARDEN];
  assert(RT_GARRISON_STEP3_ON && RT_CHRONICLE_GARRISON_KINDS.join() === chronicleGarrisonKinds(true).join() && chronicleGarrisonKinds(false).length === 6, `the build (flag on since 22.10.2026): ${RT_CHRONICLE_GARRISON_KINDS}`);
  assert(chronicleGarrisonKinds(true).length === 9 && novel.every(id => chronicleGarrisonKinds(true).includes(id)), `flag on: ${chronicleGarrisonKinds(true)}`);
  const profile = parseRtProfile(JSON.stringify(CHRONICLE_FIXTURES.garrison()));
  const chapter = (view: RtChronicleView) => view.pages.find(p => p.id === 'bestiary')!.chapters.find(c => c.id === 'garrison')!;
  const view = (pr: typeof profile, step3?: boolean) => rtChronicleView(pr, 'cat', { gambler: true, monk: true, ...step3 === undefined ? {} : { step3 } });
  assert(chapter(view(profile)).entries.length === 9 && chapter(view(profile, false)).entries.length === 6, 'nine by the build\'s flag, six without it');
  const before = view(profile, true);
  assert(chapter(before).entries.length === 9 && novel.every(id => chapter(before).entries.find(e => e.id === id)?.state === 'unknown'), 'nine with the flag, unknown before');
  const met = rtChronicleMeet(profile.meta!.chronicle, { kinds: novel, affixes: [] });
  assert(met.changed && novel.every(id => met.chronicle?.kinds?.includes(id)), 'the meeting writes — with the flag off too (the profile keeps them)');
  const after = { ...profile, meta: { ...profile.meta!, chronicle: met.chronicle } };
  assert(novel.every(id => chapter(view(after, true)).entries.find(e => e.id === id)?.state === 'seen'), 'seen after, with the flag');
  assert(chapter(view(after, false)).entries.length === 6 && !novel.some(id => chapter(view(after, false)).entries.some(e => e.id === id)), 'the flag off: the chapter shows none of them');
  const reread = parseRtProfile(JSON.stringify({ ...profile, meta: { ...profile.meta!, chronicle: met.chronicle } }));
  assert(novel.every(id => reread.meta?.chronicle?.kinds?.includes(id)), 'a kind met before stays in the profile with the flag off');
  // The owl's hint: over every candidate of a profile that met no garrison kind — the step 3's only with the flag.
  const hints = (step3?: boolean): Set<string> => {
    const raw = JSON.parse(JSON.stringify(CHRONICLE_FIXTURES.garrison())) as Record<string, any>;
    raw.meta.chronicle = { ...raw.meta.chronicle, kinds: (raw.meta.chronicle.kinds as string[]).filter(id => !['guard', 'handler', 'hound'].includes(id)) };
    const out = new Set<string>();
    for (let runs = 1; runs <= 200; runs++) {
      const pr = parseRtProfile(JSON.stringify({ ...raw, runs }));
      const h = rtChronicleHint(pr, 'cat', { gambler: true, monk: true, ...step3 === undefined ? {} : { step3 } });
      if (h?.key === 'hint_garrison') out.add(h.target);
    }
    return out;
  };
  const off = hints(false), on = hints(true);
  assert(off.size > 0 && !novel.some(id => off.has(`kind:${id}`)), `the hint without the flag: ${[...off].join(', ')}`);
  assert(novel.some(id => on.has(`kind:${id}`)), `the hint with the flag takes them: ${[...on].join(', ')}`);
});

await check('task 57а (design 21.10.2026): the chapter «Лес» comes from the kinds of the schedule under the flag — 8 entries with `forestShooters` off (the build now), 11 with it on (the slinger, the hive, the wisp unknown, the met kinds kept); a shooter met before stays in the profile whatever the flag', () => {
  assert(!RT_FOREST_SHOOTERS_ON && RT_CHRONICLE_FOREST_KINDS.join() === chronicleForestKinds(false).join() && chronicleForestKinds(false).length === 8, `flag off: ${RT_CHRONICLE_FOREST_KINDS}`);
  assert(chronicleForestKinds(true).length === 11 && ['slinger', 'hive', 'wisp'].every(kind => chronicleForestKinds(true).includes(kind)), `flag on: ${chronicleForestKinds(true)}`);
  const raw = JSON.parse(JSON.stringify(chronicleProfile('unread'))) as Record<string, any>;
  raw.meta.chronicle = { ...raw.meta.chronicle, kinds: [...new Set([...(raw.meta.chronicle?.kinds ?? []), 'wisp'])].sort() };
  const profile = parseRtProfile(JSON.stringify(raw));
  assert(profile.meta?.chronicle?.kinds?.includes('wisp'), 'a wisp met before stays in the profile with the flag off');
  const forest = (on: boolean | undefined) => rtChronicleView(profile, 'cat', { gambler: true, monk: true, ...on === undefined ? {} : { shooters: on } }).pages.find(page => page.id === 'bestiary')!.chapters.find(chapter => chapter.id === 'forest')!;
  const off = forest(undefined), offExplicit = forest(false), on = forest(true);
  assert(off.entries.length === 8 && offExplicit.entries.length === 8 && on.entries.length === 11, `entries ${off.entries.length} / ${offExplicit.entries.length} / ${on.entries.length}`);
  const state = (chapter: typeof on, id: string) => chapter.entries.find(entry => entry.id === id)?.state;
  assert(['boar', 'lynx', 'wolf'].every(id => state(off, id) === 'seen' && state(on, id) === 'seen'), 'the met kinds stay seen');
  assert(state(on, 'wisp') === 'seen' && state(on, 'slinger') === 'unknown' && state(on, 'hive') === 'unknown' && state(off, 'wisp') === undefined, 'the shooters with the flag on');
});

console.log(`realtime-chronicle: ${checks} checks passed`);
