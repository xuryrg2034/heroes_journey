/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md, sections 4, 5, 6.2): the window the owl's button opens
 * and the end screen's line. Pure: the contract in (`ChronicleView`), HTML out; the camp (`hearthView.ts`) holds the page and the
 * selected card. The view draws only what the contract holds — a «?» card has no name and no silhouette (a boss's silhouette is the
 * one exception, its name is on the map already), a locked card has no name, the next level's tab is «…».
 * Names, captions and pictures come from the code's catalogues: `KIND_CAPTIONS`, `AFFIX_CAPTIONS`, `BUILD_LABELS`, `rtTalisman`,
 * `forestEvent().title`, the characters' art. No rule of the core is here.
 */
import { FOREST_EVENTS } from '../forest/forestEvents';
import { RT_META_PACKS } from '../run/metaCatalog';
import { rtTalisman, rtTalismanText } from '../run/rtTalismans';
import { BUILD_LABELS, labelOf } from './buildColumn';
import { NPCS, type NpcId } from './metaModel';
import { AFFIX_CAPTIONS, KIND_CAPTIONS } from './newSeen';
import type { ChronicleChapter, ChronicleEntry, ChroniclePage, ChroniclePageId, ChronicleView } from './chronicleModel';

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The pages' tabs, in the book's order. */
export const CHRONICLE_PAGE_TITLES: Readonly<Record<ChroniclePageId, string>> = {
  bestiary: 'Бестиарий', bosses: 'Боссы', events: 'События', items: 'Талисманы и формы', heroes: 'Герои', hearth: 'Очаг',
};
export const CHRONICLE_PAGES: readonly ChroniclePageId[] = ['bestiary', 'bosses', 'events', 'items', 'heroes', 'hearth'];
/** The chapters' titles (a level's chapter is named by its level). */
export const CHRONICLE_CHAPTER_TITLES: Readonly<Record<string, string>> = {
  forest: 'Лес', garrison: 'Гарнизон', castle: 'Замок', affixes: 'Свойства элит',
  talismans: 'Талисманы', relics: 'Реликвии', forms: 'Формы', fusions: 'Сплавы',
  heroes: 'Герои', 'ash-cat': 'Испытание · Кот', 'ash-toad': 'Испытание · Ведунья', hearth: 'Очаг',
};
const BOSS_NAMES: Readonly<Record<string, string>> = { jailer: 'Тюремщик', troll: 'Тролль', chief: 'Главарь', castellan: 'Кастелян', warlock: 'Колдун' };
const BOSS_ART: Readonly<Record<string, string>> = { jailer: 'jailer', troll: 'troll', chief: 'chief', castellan: 'castellan' };
const BRANCH_TEXT: Readonly<Record<string, string>> = { trails: 'после Тюремщика', den: 'ветка Тролля', camp: 'ветка Главаря', common: 'любая ветка' };
const NPC_ART: Readonly<Record<string, string>> = { owl: 'npc-owl', herb: 'npc-herbalist', smith: 'npc-smith', gambler: 'npc-gambler', monk: 'npc-monk' };
const HERO_ART: Readonly<Record<string, string>> = { cat: 'player', toad: 'toad' };
const HERO_NAMES: Readonly<Record<string, string>> = { cat: 'Кот', toad: 'Ведунья' };
const GARRISON_ART: Readonly<Record<string, string>> = { guard: 'garrison-guard', handler: 'garrison-houndmaster', hound: 'garrison-hound', keymaster: 'garrison-keymaster', crossbow: 'garrison-crossbowman', knight: 'garrison-knight' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const CASINO_EVENT = 'casino';
export const CASINO_TITLE = 'Игорный круг гоблинов';

/** The line of a locked card: the pack that opens it (the meta's catalogue, run/metaCatalog.ts; «замок» is a level's word, so «Закрыто»). */
const lockedLine = (id: string): string => {
  const pack = RT_META_PACKS.find(p => p.items.some(item => item.id === id));
  return pack ? `Закрыто: откроется с набором «${pack.title}».` : 'Закрыто: откроется с набором.';
};

/** The name before the first « — » of a caption and the rest (task 43: «Стражник — ходит строем: строй — готовая цепь» keeps its second dash). */
function splitCaption(text: string): { name: string; line: string } {
  const at = text.indexOf(' — ');
  return at < 0 ? { name: text, line: '' } : { name: text.slice(0, at), line: text.slice(at + 3) };
}

/** What the window knows of a card: its name (empty — none to show), its line for the strip under the cards. */
export function entryText(page: ChroniclePageId, chapter: string, entry: ChronicleEntry): { name: string; line: string } {
  const id = entry.id, have = entry.state !== 'unknown' && entry.state !== 'locked';
  if (page === 'bestiary') {
    const caption = chapter === 'affixes' ? AFFIX_CAPTIONS[id as keyof typeof AFFIX_CAPTIONS] : KIND_CAPTIONS[id];
    return have && caption ? splitCaption(caption) : { name: '', line: '' };
  }
  if (page === 'bosses') {
    const name = BOSS_NAMES[id] ?? id;
    // The boss's name is on the map already: a «?» boss keeps its (dark) silhouette and shows no name.
    if (entry.state === 'won') return { name, line: entry.run ? `${name} — побеждён в походе ${entry.run}` : `${name} — побеждён` };
    if (entry.state === 'met') return { name, line: `${name} — встречен, ещё не побеждён` };
    return { name: '', line: '' };
  }
  if (page === 'events') {
    const title = id === CASINO_EVENT ? CASINO_TITLE : FOREST_EVENTS[id]?.title ?? id;
    const branch = id === CASINO_EVENT ? '' : BRANCH_TEXT[FOREST_EVENTS[id]?.branch ?? ''] ?? '';
    if (entry.state === 'locked') return { name: '', line: lockedLine(id) };
    if (have) return { name: title, line: branch ? `${title} — ${branch}` : title };
    return { name: '', line: branch ? `Бывает: ${branch}.` : 'Страница пуста.' };
  }
  if (page === 'items') {
    const def = rtTalisman(id), name = BUILD_LABELS[id] ? labelOf(id).title : def?.name ?? id;
    if (entry.state === 'locked') return { name: '', line: lockedLine(id) };
    if (entry.state === 'unknown') {
      const half = entry.half ? (BUILD_LABELS[entry.half] ? labelOf(entry.half).title : rtTalisman(entry.half)?.name ?? entry.half) : '';
      return { name: '', line: half ? `${half} + ?` : 'Страница пуста.' };
    }
    const rule = def ? rtTalismanText(id) : '';
    return { name, line: entry.state === 'taken' ? `${name} — ${rule}` : `${name} — видел, не взял${rule ? `: ${rule}` : ''}` };
  }
  if (page === 'heroes') {
    const ash = /^ash:(\w+):(\d+)$/.exec(id);
    if (ash) return { name: ROMAN[Number(ash[2])] ?? ash[2], line: entry.state === 'unknown' ? `Испытание, ступень ${ROMAN[Number(ash[2])] ?? ash[2]} — не пройдена.` : `Испытание, ступень ${ROMAN[Number(ash[2])] ?? ash[2]} — пройдена.` };
    if (entry.state === 'unknown') return { name: '', line: id === 'toad' ? 'В клетке Тюремщика.' : '' };
    const name = HERO_NAMES[id] ?? id;
    return { name, line: entry.run ? `${name} — освобождена в походе ${entry.run}` : name };
  }
  // The camp.
  if (entry.state === 'unknown') return { name: '', line: 'Место у костра свободно.' };
  const npc = NPCS[id as NpcId];
  return { name: npc?.name ?? id, line: npc ? `${npc.name} — ${npc.who}` : id };
}

const PNG = (name: string): string => `art/characters/${name}.png`;
const img = (name: string, fallback: string): string => `<img src="${PNG(name)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="rt-chron-fallback" hidden>${fallback}</span>`;
const ink = '#0d141b';
const svg = (body: string): string => `<svg viewBox="0 0 60 60" aria-hidden="true" stroke="${ink}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
const BODY = (fill: string): string => `<ellipse cx="30" cy="38" rx="17" ry="15" fill="${fill}"/>`;
const EYES = '<circle cx="24" cy="34" r="2.4" fill="#0d141b" stroke="none"/><circle cx="36" cy="34" r="2.4" fill="#0d141b" stroke="none"/>';
/** The drawn stand-ins of the forest's kinds (no illustration of their own: the fight draws them in code) and of the affixes. */
const KIND_SVG: Readonly<Record<string, string>> = {
  wolf: svg(`${BODY('#7d8a96')}<path d="M16 28 L18 12 L27 24 Z M44 28 L42 12 L33 24 Z" fill="#7d8a96"/>${EYES}<path d="M26 44 L30 48 L34 44" fill="none"/>`),
  boar: svg(`${BODY('#8a5a3a')}<path d="M14 38 L8 30 M46 38 L52 30" fill="none" stroke-width="4"/>${EYES}<ellipse cx="30" cy="42" rx="6" ry="4" fill="#d9a58a"/>`),
  lynx: svg(`${BODY('#c89a5a')}<path d="M16 28 L16 10 L27 24 Z M44 28 L44 10 L33 24 Z" fill="#c89a5a"/><path d="M16 10 L16 5 M44 10 L44 5" fill="none"/>${EYES}`),
  shield: svg(`${BODY('#9a8a6a')}${EYES}<path d="M8 22 L28 22 L28 50 Q18 54 8 46 Z" fill="#5a7a9a"/>`),
  archer: svg(`${BODY('#5a8a4a')}${EYES}<path d="M48 12 Q58 30 48 50 M48 12 L48 50" fill="none"/>`),
  sapper: svg(`${BODY('#8a6a3e')}${EYES}<circle cx="46" cy="22" r="8" fill="#2a3640"/><path d="M46 14 L50 6" fill="none" stroke="#e0562f"/>`),
  porcupine: svg(`${BODY('#6a5a4a')}<path d="M14 30 L8 18 M22 24 L20 10 M32 22 L32 8 M42 24 L46 10 M48 32 L54 20" fill="none" stroke-width="4"/>${EYES}`),
  shaman: svg(`<path d="M30 8 Q10 16 14 50 L46 50 Q50 16 30 8 Z" fill="#6a4a8a"/><circle cx="30" cy="30" r="9" fill="#e2c7a0"/>${EYES.replace(/cy="34"/g, 'cy="30"')}<path d="M50 8 L50 54" fill="none"/>`),
};
const AFFIX_SVG: Readonly<Record<string, string>> = {
  fiery: svg('<path d="M30 8 Q46 28 42 42 Q38 54 30 54 Q22 54 18 42 Q14 28 30 8 Z" fill="#e0562f"/><path d="M30 30 Q38 40 34 48 Q30 52 26 48 Q22 40 30 30 Z" fill="#ffb347" stroke="none"/>'),
  chameleon: svg('<path d="M10 40 Q20 20 30 40 T50 40" fill="none" stroke="#6fae5a" stroke-width="6"/><circle cx="46" cy="34" r="5" fill="#e8d7ad"/>'),
  swift: svg('<path d="M8 20 L34 20 M8 32 L44 32 M8 44 L34 44" fill="none" stroke="#7db4e8" stroke-width="5"/><path d="M40 22 L54 32 L40 42 Z" fill="#7db4e8"/>'),
  fat: svg('<ellipse cx="30" cy="34" rx="22" ry="20" fill="#c9a07a"/><circle cx="23" cy="30" r="2.4" fill="#0d141b" stroke="none"/><circle cx="37" cy="30" r="2.4" fill="#0d141b" stroke="none"/>'),
};
const LOCK = '<svg viewBox="0 0 40 40" aria-hidden="true" stroke="#0d141b" stroke-width="3" stroke-linejoin="round"><rect x="7" y="18" width="26" height="18" rx="3" fill="#a39c7a"/><path d="M12 18 V12 Q12 4 20 4 Q28 4 28 12 V18" fill="none" stroke="#a39c7a" stroke-width="4"/><circle cx="20" cy="27" r="3" fill="#0d141b" stroke="none"/></svg>';
const SCROLL = '<svg viewBox="0 0 40 40" aria-hidden="true" stroke="#0d141b" stroke-width="3" stroke-linejoin="round"><path d="M8 8 H30 V32 Q30 36 34 36 H12 Q8 36 8 32 Z" fill="#e8d7ad"/><path d="M14 16 H24 M14 22 H24 M14 28 H20" fill="none" stroke-width="2"/></svg>';
const GENERIC = '<svg viewBox="0 0 60 60" aria-hidden="true" stroke="#0d141b" stroke-width="3"><circle cx="30" cy="30" r="18" fill="#4a5662"/><circle cx="23" cy="26" r="3" fill="#0d141b" stroke="none"/><circle cx="37" cy="26" r="3" fill="#0d141b" stroke="none"/></svg>';

/** The picture of a card that is not «?»/locked. */
function artOf(page: ChroniclePageId, chapter: string, entry: ChronicleEntry): string {
  const id = entry.id;
  if (page === 'bestiary') {
    if (chapter === 'affixes') return AFFIX_SVG[id] ?? GENERIC;
    return GARRISON_ART[id] ? img(GARRISON_ART[id], KIND_SVG[id] ?? GENERIC) : KIND_SVG[id] ?? GENERIC;
  }
  if (page === 'bosses') return BOSS_ART[id] ? img(BOSS_ART[id], GENERIC) : GENERIC;
  if (page === 'events') return SCROLL;
  if (page === 'items') {
    const label = labelOf(id);
    return label.svg ? `<span class="rt-chron-icon">${label.svg}</span>` : `<span class="rt-chron-glyph">${esc(label.glyph)}</span>`;
  }
  if (page === 'heroes') {
    const ash = /^ash:(\w+):(\d+)$/.exec(id);
    if (ash) return `<span class="rt-chron-glyph rt-chron-roman">${ROMAN[Number(ash[2])] ?? ash[2]}</span>`;
    return img(HERO_ART[id] ?? 'player', GENERIC);
  }
  return img(NPC_ART[id] ?? 'npc-owl', GENERIC);
}

/** The rarity frame class of an item card (a «?» card keeps it: the rarity is on every choice screen). */
function rarityOf(id: string): string {
  const rarity = rtTalisman(id)?.rarity;
  return rarity ? `rt-rar-${rarity}` : '';
}

function cardHtml(page: ChroniclePageId, chapter: ChronicleChapter, entry: ChronicleEntry, selected: string | null): string {
  const text = entryText(page, chapter.id, entry);
  const state = entry.state, have = state !== 'unknown' && state !== 'locked';
  const classes = ['rt-chron-card', `rt-chron-${state}`, page === 'items' ? rarityOf(entry.id) : '', selected === entry.id ? 'rt-on' : ''].filter(Boolean).join(' ');
  let art: string, name = '', sub = '';
  if (state === 'locked') art = `<span class="rt-chron-lock">${LOCK}</span>`;
  else if (state === 'unknown') {
    // A boss «?» keeps its silhouette (the name is on the map); a fusion «?» shows the half the viewer knows; the rest is empty.
    if (page === 'bosses') art = `<span class="rt-chron-dark">${artOf(page, chapter.id, entry)}</span>`;
    else if (page === 'items' && entry.half) {
      const half = labelOf(entry.half);
      art = `<span class="rt-chron-half"><span class="rt-chron-icon">${half.svg ?? esc(half.glyph)}</span><em>+ ?</em></span>`;
    } else art = '<span class="rt-chron-q">?</span>';
  } else {
    art = artOf(page, chapter.id, entry);
    name = text.name;
    if (page === 'bosses') sub = state === 'won' ? (entry.run ? `побеждён, поход ${entry.run}` : 'побеждён') : 'встречен';
    else if (page === 'events') sub = BRANCH_TEXT[FOREST_EVENTS[entry.id]?.branch ?? ''] ?? '';
    else if (page === 'heroes' && entry.run) sub = `поход ${entry.run}`;
    else if (page === 'heroes' && /^ash:/.test(entry.id)) sub = 'ступень';
  }
  void have;
  return `<button class="${classes}" data-action="chron-card" data-entry="${esc(entry.id)}" data-chapter="${esc(chapter.id)}" data-state="${state}" data-line="${esc(text.line)}" data-testid="chron-card-${esc(entry.id)}">`
    + `<span class="rt-chron-art">${art}</span>${name ? `<b class="rt-chron-name${name.length > 11 ? ' rt-chron-long' : ''}">${esc(name)}</b>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
}

const SEEN_STATES = new Set(['seen', 'taken', 'met', 'won']);
/** How many of a chapter's entries the viewer has (the contract's page number counts the same). */
export const chapterCount = (chapter: ChronicleChapter): [number, number] => [chapter.entries.filter(e => SEEN_STATES.has(e.state)).length, chapter.entries.length];

/** Rows of cards a page needs (10 in a row): over four rows the cards go lower so the page fits the window with no scroll. */
function pageRows(page: ChroniclePage): number {
  return page.chapters.reduce((sum, c) => sum + (c.state === 'open' ? Math.ceil(c.entries.length / 10) : 0), 0);
}

function chapterHtml(page: ChroniclePage, chapter: ChronicleChapter, selected: string | null): string {
  // The next level's tab: no name, no entries, a click opens nothing.
  if (chapter.state === 'blank') return '<div class="rt-chron-blank" data-testid="chron-blank" aria-label="Пустая страница">…</div>';
  const [have, known] = chapterCount(chapter), full = known > 0 && have === known;
  const title = CHRONICLE_CHAPTER_TITLES[chapter.id] ?? chapter.id;
  return `<section class="rt-chron-chapter" data-chapter="${esc(chapter.id)}" data-testid="chron-chapter-${esc(chapter.id)}"><h3>${esc(title)} · <span data-testid="chron-chapter-count-${esc(chapter.id)}">${have} / ${known}</span>`
    + `${full ? '<i class="rt-chron-seal" title="Глава полна" data-testid="chron-full">◉</i>' : ''}</h3>`
    + `<div class="rt-chron-grid">${chapter.entries.map(entry => cardHtml(page.id, chapter, entry, selected)).join('')}</div></section>`;
}

/** The window's state the camp holds. */
/** `marks` — the pages whose «✦» still shows in this visit (the unread when the window opened; a page loses its mark when opened). */
export interface ChronicleUi { page: ChroniclePageId; selected: string | null; marks: readonly ChroniclePageId[] }

/** The whole window (a modal over the camp). */
export function chronicleHtml(view: ChronicleView, ui: ChronicleUi): string {
  const page = view.pages.find(p => p.id === ui.page) ?? view.pages[0];
  const tabs = view.pages.map(p => `<button class="rt-chron-tab${p.id === page?.id ? ' rt-on' : ''}" role="tab" aria-selected="${p.id === page?.id}" data-action="chron-page" data-page="${p.id}" data-testid="chron-tab-${p.id}">`
    + `<span>${esc(CHRONICLE_PAGE_TITLES[p.id])}</span>${ui.marks.includes(p.id) ? '<i class="rt-chron-new" title="Новое" data-testid="chron-new">✦</i>' : ''}<em>${p.have} / ${p.known}</em></button>`).join('');
  const body = page ? page.chapters.map(c => chapterHtml(page, c, ui.selected)).join('') : '';
  const dense = page && pageRows(page) >= 5 ? ' rt-chron-dense' : '';
  const line = page?.chapters.flatMap(c => c.entries.filter(e => e.id === ui.selected).map(e => entryText(page.id, c.id, e).line))[0] ?? '';
  return `<div class="rt-overlay rt-hearth-modal rt-chron-modal" data-action="chron-close" data-testid="chronicle">`
    + `<div class="rt-card rt-chron" role="dialog" aria-label="Летопись">`
    + `<header class="rt-chron-head"><h2>Летопись</h2><span class="rt-chron-total" data-testid="chron-total">Записано ${view.total[0]} / ${view.total[1]}</span><button class="rt-other" data-action="chron-close" data-testid="chron-close">Закрыть</button></header>`
    + `<div class="rt-chron-body"><nav class="rt-chron-tabs" role="tablist">${tabs}</nav><div class="rt-chron-page${dense}" data-testid="chron-page" data-page="${page?.id ?? ''}">${body}</div></div>`
    + `<p class="rt-chron-line" data-testid="chron-line">${esc(line)}</p></div></div>`;
}

/** What the window shows now (tests read it): the page, the counts, the cards by state, the unread marks, the blank chapters. */
export interface ChronicleShown {
  open: boolean; page: ChroniclePageId | null; total: [number, number]; tabs: { id: ChroniclePageId; have: number; known: number; unread: boolean }[];
  cards: number; byState: Record<string, number>; named: number; blank: number; selected: string | null; line: string;
}
export const EMPTY_CHRONICLE_SHOWN: ChronicleShown = { open: false, page: null, total: [0, 0], tabs: [], cards: 0, byState: {}, named: 0, blank: 0, selected: null, line: '' };

export function chronicleShown(view: ChronicleView, ui: ChronicleUi): ChronicleShown {
  const page = view.pages.find(p => p.id === ui.page) ?? view.pages[0];
  const entries = page?.chapters.flatMap(c => c.entries.map(e => ({ c, e }))) ?? [];
  const byState: Record<string, number> = {};
  for (const { e } of entries) byState[e.state] = (byState[e.state] ?? 0) + 1;
  const line = page?.chapters.flatMap(c => c.entries.filter(e => e.id === ui.selected).map(e => entryText(page.id, c.id, e).line))[0] ?? '';
  return {
    open: true, page: page?.id ?? null, total: [...view.total], tabs: view.pages.map(p => ({ id: p.id, have: p.have, known: p.known, unread: ui.marks.includes(p.id) })),
    cards: entries.length, byState, named: entries.filter(({ c, e }) => !!entryText(page!.id, c.id, e).name).length,
    blank: page?.chapters.filter(c => c.state === 'blank').length ?? 0, selected: ui.selected, line,
  };
}

/** A ref of `unread` (`kind:lynx`) as a name for the end screen's line; null — a chapter or an unknown id. */
export function refName(ref: string): string | null {
  const at = ref.indexOf(':'), type = ref.slice(0, at), id = ref.slice(at + 1);
  switch (type) {
    case 'kind': return KIND_CAPTIONS[id] ? splitCaption(KIND_CAPTIONS[id]).name : null;
    case 'affix': { const caption = AFFIX_CAPTIONS[id as keyof typeof AFFIX_CAPTIONS]; return caption ? splitCaption(caption).name : null; }
    case 'event': return id === CASINO_EVENT ? CASINO_TITLE : FOREST_EVENTS[id]?.title ?? null;
    case 'item': return BUILD_LABELS[id] ? labelOf(id).title : rtTalisman(id)?.name ?? null;
    case 'boss': return BOSS_NAMES[id] ?? null;
    case 'hero': return HERO_NAMES[id] ?? null;
    case 'ash': { const m = /^(\w+):(\d+)$/.exec(id); return m ? `Испытание ${ROMAN[Number(m[2])] ?? m[2]}` : null; }
    case 'npc': return NPCS[id as NpcId]?.name ?? null;
    default: return null;
  }
}

const chaptersWord = (n: number): string => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'глава' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'главы' : 'глав'}`;

/**
 * The end screen's lines under the record (section 5.2): «В летописи: +3 · Рысь · Призма · Гнездо дикобразов» (up to three names, then
 * «и ещё N»; nothing new — no line) and, for a new chapter, «+1 глава · Гарнизон». Names only of what the viewer has seen.
 */
export function chronicleEndLines(added: readonly string[]): string[] {
  const names: string[] = [], chapters: string[] = [];
  for (const ref of added) {
    if (ref.startsWith('chapter:')) { const title = CHRONICLE_CHAPTER_TITLES[ref.slice(8)]; if (title) chapters.push(title); continue; }
    const name = refName(ref);
    if (name) names.push(name);
  }
  const lines: string[] = [];
  if (names.length) lines.push(`В летописи: +${names.length} · ${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` · и ещё ${names.length - 3}` : ''}`);
  if (chapters.length) lines.push(`+${chaptersWord(chapters.length)} · ${chapters.join(' · ')}`);
  return lines;
}
