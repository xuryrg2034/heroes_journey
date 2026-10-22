/**
 * Task 58б «Летопись», the view (view/chronicleView.ts, view/chronicleModel.ts): the window is drawn from the CONTRACT of section 7.4 and
 * from nothing else — a hidden entry is not drawn, a «?» card has no name, a locked card has no name, the next level's tab is «…» with no
 * name, a fusion «?» shows the half the viewer knows, the counts are the contract's. The contract is core's (`rtChronicleView` over the
 * stored profiles of chronicleFixtures.testkit.ts, read back by `parseRtProfile` as the game does), the checks are of what the viewer
 * sees. Also the end screen's line (nothing new — no line; more than three names — «и ещё N») and the source over the profile store. Node
 * only: `npm run test:realtime-chronicle-view`. The end-to-end view is tests/realtime-chronicle.spec.ts.
 */
import './nodeNavigator.testkit';
import { FOREST_EVENTS } from '../forest/forestEvents';
import { CHRONICLE_FIXTURES, chronicleViewOf } from './chronicleFixtures.testkit';
import { rtChronicleView } from '../run/chroniclePages';
import { parseRtProfile, createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from '../run/rtRunStorage';
import { profileChronicle } from './chronicleModel';
import { npcLine } from './npcLines';
import { chapterCount, chronicleEndLines, chronicleHtml, chronicleShown, entryText, refName } from './chronicleView';
import type { ChroniclePageId, ChronicleView } from './chronicleModel';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

const view = (name: string): ChronicleView => chronicleViewOf(name);
const html = (v: ChronicleView, page: ChroniclePageId, selected: string | null = null): string => chronicleHtml(v, { page, selected, marks: [] });
const card = (h: string, id: string): string => {
  const at = h.indexOf(`data-testid="chron-card-${id}"`);
  assert(at >= 0, `card ${id} is drawn`);
  return h.slice(h.lastIndexOf('<button', at), h.indexOf('</button>', at));
};
const has = (h: string, id: string): boolean => h.includes(`data-testid="chron-card-${id}"`);

check('the first camp: the header counts the contract, six tabs with «есть / всего»', () => {
  const v = view('novice'), h = html(v, 'bestiary');
  assert(h.includes(`Записано ${v.total[0]} / ${v.total[1]}`), 'total from the contract');
  for (const p of v.pages) assert(h.includes(`data-testid="chron-tab-${p.id}"`) && h.includes(`${p.have} / ${p.known}`), `tab ${p.id}`);
  assert(v.pages.length === 6, 'six pages');
  const sum = v.pages.reduce((a, p) => a + p.known, 0);
  assert(v.total[1] === sum && v.total[0] === v.pages.reduce((a, p) => a + p.have, 0), 'the total is the sum of the pages');
});

check('a kind not met is a «?» with no name and no picture; a met one has the name and its line', () => {
  const v = view('novice'), h = html(v, 'bestiary');
  const unknown = card(h, 'lynx'), seen = card(h, 'wolf');
  assert(unknown.includes('data-state="unknown"') && unknown.includes('rt-chron-q') && !unknown.includes('Рысь') && !unknown.includes('<svg') && !unknown.includes('<img'), `lynx stays «?»: ${unknown}`);
  assert(seen.includes('Волк') && seen.includes('окружает') && seen.includes('<svg'), 'wolf has a name, a line and a picture');
  assert(!unknown.includes('data-line="Рысь'), 'the strip gives nothing away for «?»');
});

check('the kinds of the forest are drawn by their pictures (the shield and the archer too), the drawn SVG stays as the stand-in; a «?» has neither', () => {
  const h = html(view('garrison'), 'bestiary');
  for (const [id, file] of [['wolf', 'forest-wolf'], ['boar', 'forest-boar'], ['lynx', 'forest-lynx'], ['porcupine', 'forest-porcupine'], ['sapper', 'forest-sapper'], ['shaman', 'forest-shaman'], ['shield', 'forest-shield'], ['archer', 'ranged']] as const) {
    const c = card(h, id);
    assert(c.includes(`art/characters/${file}.png`) && c.includes('<svg') && c.includes('onerror'), `${id}: picture ${file} with the SVG as the stand-in`);
  }
  assert(!card(html(view('novice'), 'bestiary'), 'lynx').includes('<img'), 'a «?» kind has no picture');
});

check('the next level is one blank «…» tab with no name and no cards; the garrison kinds are not drawn at all (before the garrison)', () => {
  const v = view('novice'), h = html(v, 'bestiary');
  assert(h.includes('data-testid="chron-blank"') && h.split('data-testid="chron-blank"').length === 2, 'exactly one blank tab');
  for (const kind of ['guard', 'handler', 'hound', 'keymaster', 'crossbow', 'knight']) assert(!has(h, kind) && !h.includes(`data-entry="${kind}"`), `${kind} is hidden`);
  assert(!h.includes('Гарнизон') && !h.includes('Замок'), 'the next level has no name');
  assert(chronicleShown(v, { page: 'bestiary', selected: null, marks: [] }).blank === 1, 'the snapshot counts the blank tab');
  const bosses = html(v, 'bosses');
  assert(!has(bosses, 'castellan') && bosses.includes('chron-blank'), 'the Castellan is hidden before the garrison');
});

check('the elite chapter appears only after a first elite', () => {
  const novice = html(view('novice'), 'bestiary'), later = html(view('garrison'), 'bestiary');
  assert(!novice.includes('Свойства элит') && !has(novice, 'fiery'), 'no chapter yet');
  assert(later.includes('Свойства элит') && has(later, 'fiery') && has(later, 'fat'), 'chapter after the elites');
});

check('after the garrison: its chapter is open, no blank tab is left (the last level of this build), the Castellan is won in run 14', () => {
  const v = view('garrison'), h = html(v, 'bestiary');
  assert(has(h, 'guard') && card(h, 'guard').includes('Стражник') && !card(h, 'knight').includes('Рыцарь'), 'garrison kinds follow the contract');
  assert(h.includes('Гарнизон ·') && !h.includes('chron-blank') && !h.includes('Замок'), 'no blank tab: the last level of this build is open');
  const bosses = html(v, 'bosses');
  assert(card(bosses, 'castellan').includes('побеждён, поход 14') && card(bosses, 'jailer').includes('побеждён, поход 3') && card(bosses, 'troll').includes('встречен'), 'boss states');
});

check('a boss «?» keeps its silhouette and no name', () => {
  const unknown = card(html(view('novice'), 'bosses'), 'jailer');
  assert(unknown.includes('rt-chron-dark') && !unknown.includes('Тюремщик') && !unknown.includes('rt-chron-name'), unknown);
});

check('events: locked has no name; «?» shows the branch only in the strip; a seen one has its name', () => {
  const v = view('novice'), h = html(v, 'events');
  const locked = card(h, 'old-trap'), unknown = card(h, 'warm-den'), seen = card(h, 'brook');
  assert(locked.includes('rt-chron-lock') && !locked.includes(FOREST_EVENTS['old-trap']!.title) && locked.includes('data-state="locked"'), 'locked');
  assert(unknown.includes('data-state="unknown"') && !unknown.includes(FOREST_EVENTS['warm-den']!.title) && unknown.includes('Бывает: ветка Тролля.'), `«?» gives the place: ${unknown}`);
  assert(seen.includes(FOREST_EVENTS.brook!.title), 'seen');
  assert(has(h, 'casino'), 'the casino has a card');
  assert(!card(h, 'casino').includes('Игорный'), 'and no name until seen');
});

check('items: the «?» keeps the rarity frame and no name; seen is grey with its name; taken is coloured; locked has no name', () => {
  const v = view('fusionHalf'), h = html(v, 'items');
  const q = card(h, 'hourglass'), seen = card(h, 'prism'), taken = card(h, 'frost-edge'), locked = card(h, 'long-arm');
  assert(q.includes('rt-rar-uncommon') && q.includes('rt-chron-q') && !q.includes('Часы'), `«?» ${q}`);
  assert(seen.includes('data-state="seen"') && seen.includes('Призма'), 'seen shows the name');
  assert(taken.includes('data-state="taken"') && taken.includes('Иней на клинке'), 'taken');
  assert(locked.includes('data-state="locked"') && !locked.includes('Длинная'), 'locked has no name');
  assert(entryText('items', 'talismans', { id: 'long-arm', state: 'locked' }).line === 'Закрыто: откроется с набором «Длинные цепи».' && entryText('events', 'forest', { id: 'old-trap', state: 'locked' }).line === 'Закрыто: откроется с набором «Близнецы».', 'a locked card names its pack');
  assert(locked.includes('data-line="Закрыто: откроется с набором «Длинные цепи».'), 'the strip of a locked card');
  assert(entryText('items', 'talismans', { id: 'prism', state: 'seen' }).line.includes('видел, не взял'), 'the strip says seen-not-taken');
});

check('a fusion «?» shows the half of the recipe the viewer has: «Иней на клинке + ?»; with no part taken it stays plain', () => {
  const v = view('fusionHalf'), h = html(v, 'items');
  const half = card(h, 'fusion-ice-seal'), other = card(h, 'fusion-spear');
  assert(half.includes('+ ?') && half.includes('data-line="Иней на клинке + ?"') && !half.includes('Ледяная печать'), half);
  assert(other.includes('rt-chron-q') && !other.includes('+ ?'), 'no half known - a plain «?»');
  assert(!html(view('novice'), 'items').includes('chron-chapter-fusions'), 'the fusions chapter is hidden until the first pair');
});

check('the longest page fits the window: 36 cards, the rows go dense with five rows; four rows keep the full cards', () => {
  const v = view('garrison'), h = html(v, 'items');
  assert(h.includes('rt-chron-dense'), 'five rows go dense');
  const shown = chronicleShown(v, { page: 'items', selected: null, marks: [] });
  assert(shown.cards === 36, `the items page has 36 cards (${shown.cards})`);
  assert(!html(view('novice'), 'items').includes('rt-chron-dense'), 'four rows keep the full cards');
});

check('a full chapter wears its seal; the counts of a chapter come from its entries', () => {
  const v = view('garrison');
  const forest = v.pages[0]!.chapters[0]!;
  // Task 57а: the build's forest chapter — 11 kinds with the shooters' flag (on since 22.10.2026); the fixture met them all.
  assert(chapterCount(forest)[0] === 11 && chapterCount(forest)[1] === 11, 'forest 11/11');
  assert(html(v, 'bestiary').includes('data-testid="chron-full"') && html(v, 'bestiary').includes('Лес · <span data-testid="chron-chapter-count-forest">11 / 11</span>'), 'seal and count');
  assert(!html(view('novice'), 'bestiary').includes('chron-full'), 'no seal on the novice');
});

check('heroes: the cat only, then Ведунья «?» after the Jailer, then freed; the Испытание ladder up to the best step', () => {
  const none = html(view('novice'), 'heroes');
  assert(has(none, 'cat') && !has(none, 'toad') && !none.includes('Испытание'), 'a newcomer: the cat only');
  const raw = CHRONICLE_FIXTURES.novice!() as { meta: { chronicle: Record<string, unknown> } };
  raw.meta.chronicle.bosses = { jailer: { met: 1 } };
  const caged = html(rtChronicleView(parseRtProfile(JSON.stringify(raw)), 'cat', { gambler: true, monk: true }), 'heroes');
  assert(has(caged, 'toad') && card(caged, 'toad').includes('data-state="unknown"') && !card(caged, 'toad').includes('Ведунья'), 'Ведунья «?» once the Jailer is met');
  const v = view('garrison'), h = html(v, 'heroes');
  assert(card(h, 'toad').includes('Ведунья') && card(h, 'toad').includes('поход 3') && card(h, 'cat').includes('data-state="met"'), 'freed in run 3; the cat is met');
  assert(h.includes('Испытание · Кот') && card(h, 'ash:cat:5').includes('data-state="seen"') && card(h, 'ash:cat:6').includes('data-state="unknown"'), 'ladder to V');
  assert(chronicleShown(v, { page: 'heroes', selected: null, marks: [] }).cards === 2 + 16, '18 on the page: 2 heroes + 16 steps');
});

check('a step of the Испытание: the big numeral and the caption «ступень» only (no second numeral)', () => {
  const c = card(html(view('garrison'), 'heroes'), 'ash:cat:5');
  assert(c.includes('rt-chron-roman') && c.includes('<small>ступень</small>') && !c.includes('rt-chron-name'), c);
});

check('the camp page: the owl met; the others «?» until they come (Шиш and Евлампий have places while their camp is on)', () => {
  const h = html(view('novice'), 'hearth');
  assert(has(h, 'gambler') && has(h, 'monk') && card(h, 'gambler').includes('data-state="unknown"') && !card(h, 'gambler').includes('Шиш'), 'the goblin and the monk wait unnamed');
  assert(card(h, 'owl').includes('Неясыть') && card(h, 'herb').includes('data-state="unknown"') && !card(h, 'herb').includes('Марфа'), 'Марфа unnamed');
  assert(card(html(view('garrison'), 'hearth'), 'smith').includes('Ерофей'), 'Ерофей named once met');
});

check('the strip: the chosen card gives its line (a «?» gives nothing); unread marks follow `marks`', () => {
  const v = view('novice');
  assert(html(v, 'bestiary', 'wolf').includes('data-testid="chron-line">Волк — окружает') === false && html(v, 'bestiary', 'wolf').includes('data-testid="chron-line">окружает; в стае бьёт сильнее</p>'), 'the line of the wolf');
  assert(html(v, 'bestiary', 'lynx').includes('data-testid="chron-line"></p>'), 'a «?» card selected shows nothing');
  const marked = chronicleHtml(view('unread'), { page: 'bestiary', selected: null, marks: ['items'] });
  assert(marked.split('data-testid="chron-new"').length === 2, 'one ✦ on the tab of the page with the new');
  assert(!chronicleHtml(view('unread'), { page: 'bestiary', selected: null, marks: [] }).includes('chron-new'), 'none once read');
});

check('the source over the profile store: meet adds a kind once with the unread mark; import is the retro (no unread); read clears; the run keeps its list', () => {
  const data = new Map<string, string>();
  const storage: RunStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, giftFull: false, runs: 3, meta: { heroes: { cat: { xp: 20, packs: [], record: { row: 3, won: false, xp: 20 } } } } }));
  const source = profileChronicle(createRtProfileStore(storage, { chronicle: true }));
  source.import({ kinds: ['wolf'], affixes: [] });
  assert(!source.view().pages[0]!.unread && source.view().pages[0]!.have === 1 && source.view().unread === 0, 'the retro is read');
  source.import({ kinds: ['boar'], affixes: [] });
  assert(source.view().pages[0]!.have === 1, 'a repeat of the import is ignored');
  const run = { seeded: undefined }; source.meet(run, { kinds: ["lynx"], affixes: ["fiery"] }); source.meet(run, { kinds: ["lynx"], affixes: [] });
  const v = source.view();
  assert(v.pages[0]!.unread && v.pages[0]!.have === 3 && v.unread === 2, 'lynx and the fiery affix are new, once');
  source.read();
  assert(!source.view().pages[0]!.unread && source.view().unread === 0, 'read clears');
  assert(source.added('no-such-run').length === 0, 'a run that did not end has no list');
  const before = JSON.stringify(source.view());
  source.meet({ seeded: true }, { kinds: ['boar', 'wolf', 'archer'], affixes: ['swift'], elite: true });
  assert(JSON.stringify(source.view()) === before, 'a seeded run (the day also) writes nothing');
  source.meet(run, { kinds: [], affixes: [], elite: true });
  assert(source.view().pages[0]!.chapters.some(c => c.id === 'affixes'), 'an elite in view opens the chapter of the properties of the elites');
});

check('the retro line: the owl has the words of the spec; the profile remembers it was said (a reload does not bring it back)', () => {
  const data = new Map<string, string>();
  const storage: RunStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
  data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(CHRONICLE_FIXTURES.retro!()));
  const store = createRtProfileStore(storage, { chronicle: true });
  assert(profileChronicle(store).view().retro, 'the book says retro');
  const line = npcLine('owl', 'chronicle_retro', undefined, store.load().meta!.hearth!.lines);
  assert(line?.text === 'Старые страницы размыло дождём. Что помню — вписала, остальное пиши заново.', 'the words of the spec');
  assert(!store.load().meta!.hearth!.lines[line.id], 'not said yet');
  store.markLine(line.id);
  const again = createRtProfileStore(storage, { chronicle: true });
  assert(again.load().meta!.hearth!.lines['owl:chronicle_retro'] === 1 && profileChronicle(again).view().retro, 'said once, remembered by the profile, the book still says retro');
});

check('the end screen lines: nothing new - none; up to three names; more - «и ещё N»; a chapter on its own line', () => {
  assert(chronicleEndLines([]).length === 0, 'no line for nothing');
  const three = chronicleEndLines(['kind:lynx', 'item:prism', 'event:porcupine-nest']);
  assert(three.join('|') === 'В летописи: +3 · Рысь · Призма · Гнездо дикобразов', three.join('|'));
  assert(chronicleEndLines(['kind:lynx', 'kind:wolf', 'kind:boar', 'kind:shaman', 'kind:archer'])[0] === 'В летописи: +5 · Рысь · Волк · Кабан · и ещё 2', 'more than three');
  assert(chronicleEndLines(['kind:guard', 'chapter:garrison']).join('|') === 'В летописи: +1 · Стражник|+1 глава · Гарнизон', 'a new chapter');
  assert(chronicleEndLines(['chapter:garrison']).join('|') === '+1 глава · Гарнизон', 'only the chapter');
  assert(chronicleEndLines(['kind:no-such-kind', 'chapter:no-such']).length === 0, 'an id the code does not know is not shown');
  assert(refName('boss:troll') === 'Тролль' && refName('ash:cat:5') === 'Испытание V' && refName('npc:herb') === 'Марфа' && refName('hero:toad') === 'Ведунья', 'names of the other refs');
});

console.log('chronicle view: all checks passed');
