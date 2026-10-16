/**
 * Phase B, track Д5 (docs/realtime-phase-b.md, sections 8 and 9, «Д5»; design answer 23, variant A): the build column on
 * the left of the arena HUD — the items the hero took, top to bottom: talismans (counter talismans of Т1, the old ones,
 * oaths), then the hammer (Т2) and the relics (Т3) in frames of their own; a relic shows its price. A counter shows its
 * progress (dots up to 5, otherwise «3/15») from the module's pure `progress` hook (sim/build.ts). A `talismanFired`
 * event flashes the item's icon for 0.6 s; the renderer writes a short text at the hero (`FIRE_TEXT`).
 *
 * View only: reads the world (the kit, the build registry), never changes it. Short labels and glyphs are this table, by
 * the ids of sim/buildIds.ts and run/rtTalismans.ts (an id without a row gets its first letters).
 */
import { buildModules, moduleActive, type BuildProgress } from '../sim/build';
import { COUNTER_TALISMANS as T, FORMS as F, FROST_PASS, FUSIONS as U, fusionRecipe, HAMMERS as H, OATH_HUNGER, RELICS as R, RELIC_IDS } from '../sim/buildIds';
import { formIconSvg, fusionIconSvg } from './formIcons';
import type { World } from '../sim/world';
import { rtHammer, rtTalisman } from '../run/rtTalismans';

/** What a row of the column is. */
export type BuildKind = 'talisman' | 'hammer' | 'relic';

interface Label {
  /** 3–4 letters next to the icon. */
  short: string;
  /** One sign in the 24 px icon (plain text signs, no emoji). */
  glyph: string;
  /** Full name (the row's tooltip). */
  title: string;
  /** A relic's price, short («−3 HP»). */
  price?: string;
  /** Task 29: a drawn icon (inline SVG, view/formIcons.ts) in place of the glyph. */
  svg?: string;
}

/** Short labels of the build (view table; names after docs/realtime-phase-b.md, sections 3–5а). */
export const BUILD_LABELS: Readonly<Record<string, Label>> = {
  // Т1 — counter talismans.
  [T.fifthLink]: { short: 'Пят', glyph: '5', title: 'Пятое звено' },
  [T.thirdChain]: { short: 'Трет', glyph: '3', title: 'Третья цепь' },
  [T.shockwave]: { short: 'Волн', glyph: '◎', title: 'Ударная волна' },
  [T.prism]: { short: 'Приз', glyph: '◆', title: 'Призма' },
  [T.finisher]: { short: 'Доб', glyph: '✕', title: 'Добивание' },
  [T.eliteHunter]: { short: 'Охот', glyph: '★', title: 'Охотник на элит' },
  [T.longArm]: { short: 'Рука', glyph: '⇔', title: 'Длинная рука' },
  [T.frostEdge]: { short: 'Иней', glyph: '✱', title: 'Иней на клинке' },
  // Т2 — hammers.
  [H.fire]: { short: 'Огн', glyph: '≈', title: 'Огненный проход' },
  [H.blast]: { short: 'Взрв', glyph: '✺', title: 'Взрыв на конце' },
  [H.cut]: { short: 'Рез', glyph: '⟋', title: 'Режущий проход' },
  [H.return]: { short: 'Возв', glyph: '↺', title: 'Возврат' },
  // Т3 — relics with their price.
  [R.millstone]: { short: 'Жерн', glyph: '◍', title: 'Жернов', price: '−3 HP' },
  [R.heavyBlade]: { short: 'Тяж', glyph: '▼', title: 'Тяжёлый клинок', price: 'фокус ½' },
  [R.swiftFeet]: { short: 'Ноги', glyph: '»', title: 'Быстрые ноги', price: 'без щита' },
  [R.wideCircle]: { short: 'Круг', glyph: '◯', title: 'Широкий круг', price: 'враг +10%' },
  [R.bloodOath]: { short: 'Кров', glyph: '✚', title: 'Кровавая клятва', price: 'леч. ½' },
  // 5а and the talismans before phase B.
  [OATH_HUNGER]: { short: 'Гол', glyph: '✶', title: 'Клятва голода', price: 'без привала' },
  'hero-anchor': { short: 'Якор', glyph: '⊥', title: 'Якорь у героя' },
  whetstone: { short: 'Точ', glyph: '◢', title: 'Точильный камень' },
  'millstone-shard': { short: 'Оск', glyph: '◇', title: 'Осколок жернова' },
  hourglass: { short: 'Часы', glyph: '⧗', title: 'Песочные часы' },
  'nimble-paws': { short: 'Лапы', glyph: '∴', title: 'Ловкие лапы' },
  'ash-ward': { short: 'Обер', glyph: '◈', title: 'Пепельный оберег' },
  'dew-flask': { short: 'Роса', glyph: '◌', title: 'Фляга росы' },
  'tough-hide': { short: 'Шкур', glyph: '▣', title: 'Крепкая шкура' },
  // Task 29 — the forms (sandbox only; drawn icons, view/formIcons.ts).
  [F.seal]: { short: 'Печ', glyph: '◎', title: 'Печать', svg: formIconSvg('seal') },
  [F.pierce]: { short: 'Прям', glyph: '↗', title: 'Прямая', svg: formIconSvg('pierce') },
  [F.fork]: { short: 'Разв', glyph: 'Y', title: 'Развилка', svg: formIconSvg('fork') },
  [F.alien]: { short: 'Чуж', glyph: '◐', title: 'Чужак', svg: formIconSvg('stranger') },
  [F.twins]: { short: 'Близ', glyph: '∞', title: 'Близнецы', svg: formIconSvg('twins') },
  [FROST_PASS]: { short: 'Нал', glyph: '❄', title: 'Наледь', svg: formIconSvg('rime') },
  // Task 44 — the fusions (drawn icons, view/formIcons.ts).
  // Design 16.10.2026: a fusion's word whole, on a line of its own under the icon (`rt-build-fusion`), never cut.
  [U.iceSeal]: { short: 'Лёд. печать', glyph: '◎', title: 'Ледяная печать', svg: fusionIconSvg('iceSeal') },
  [U.spear]: { short: 'Копьё', glyph: '↗', title: 'Копьё', svg: fusionIconSvg('spear') },
  [U.boomerang]: { short: 'Бумеранг', glyph: '↺', title: 'Бумеранг', svg: fusionIconSvg('boomerang') },
  // The view's test module (buildTestModule.ts; sandbox hook only).
  'view-test-counter': { short: 'Тест', glyph: 'T', title: 'Тестовый счётчик (песочница)' },
};

/**
 * The short text at the hero when an item fires (`talismanFired`). An id without a row shows its short label. The rules
 * stay in the modules: the text only names what happened (numbers after docs/realtime-phase-b.md, sections 3, 5, 5а).
 */
export const FIRE_TEXT: Readonly<Record<string, string>> = {
  [T.fifthLink]: '+2 силы',
  [T.thirdChain]: 'прыжок 0 ⚡',
  [T.shockwave]: 'Волна',
  [T.prism]: '+1 ⚡',
  [T.finisher]: 'неуязв. ×2',
  [T.eliteHunter]: '+3 силы',
  [T.longArm]: 'R ×1,5',
  [T.frostEdge]: 'Иней',
  [H.fire]: 'Огонь',
  [H.blast]: 'Взрыв',
  [H.cut]: 'Разрез',
  [H.return]: 'Возврат',
  [R.millstone]: '◆ кристалл',
  [R.heavyBlade]: '+2 силы',
  [R.swiftFeet]: 'быстрее',
  [R.wideCircle]: 'R ×1,25',
  [R.bloodOath]: '+1 ⚡',
  [OATH_HUNGER]: '+1 HP',
  'view-test-counter': 'тест',
  [FROST_PASS]: 'Наледь',
  [U.iceSeal]: 'Лёд',
  [U.spear]: 'Копьё',
  [U.boomerang]: 'Полная сила',
};

/**
 * Task 29: the forms' rules (the hover card; the sandbox, and since task 30 a run with forms). After the report
 * «Талисманы меняющие стиль игры» and the sim's modules (sim/forms.ts, frostPass.ts, chain.ts `loopOn`, pierce.ts `pierceOn`).
 */
const FORM_RULES: Readonly<Record<string, string>> = {
  [F.seal]: 'Замкни цепь в кольцо — удар по всем врагам внутри. С «Развилкой» кольца нет.',
  [F.pierce]: 'Прямой хвост цепи: проход идёт дальше по прямой и бьёт всех на пути.',
  [F.fork]: 'Следующее звено — в досягаемости любого звена цепи, не только последнего.',
  [F.alien]: 'Раз за цепь одно звено может быть чужого цвета; цвет цепи прежний.',
  [F.twins]: 'Цвета разбиты на пары, пара — один цвет: 1 и 3, 2 и 4.',
  [FROST_PASS]: 'Путь прохода 2 с морозит врагов, которые в него входят.',
};

/**
 * Task 29 (`Params.counterWindow`, sandbox only): the counters count within one chain — two of them get new names, every one a
 * new rule (core's contract 15.10.2026). Off — the old names and rules.
 */
const WINDOW_NAMES: Readonly<Record<string, { short: string; title: string }>> = {
  [T.fifthLink]: { short: 'Остр', title: 'Острие' },
  [T.thirdChain]: { short: 'Улов', title: 'Улов' },
};
const WINDOW_RULES: Readonly<Record<string, string>> = {
  [T.fifthLink]: '3-е звено цепи получает +2 силы перед ударом.',
  [T.thirdChain]: 'Цепь, убившая 3+ врагов: следующий прыжок за 5 с бесплатен.',
  [T.prism]: 'Звенья после кристалла или смены цвета в цепи получают +1 силы.',
  [T.shockwave]: 'Цепь из 4+ звеньев посылает ударную волну.',
  [T.finisher]: 'Последнее звено — самое крепкое в цепи и погибло: неуязвимость ×2.',
  [T.eliteHunter]: 'После элиты или крепкого звенья получают +3 силы.',
  [T.longArm]: 'С 3-го звена цепи R ×1,5.',
  [T.frostEdge]: 'Цепь 3+, кончившаяся на выжившем, замораживает его на 2 с.',
};
const WINDOW_FIRE: Readonly<Record<string, string>> = { [T.prism]: '+1 силы' };

/** The row's label; `counterWindow` — the counters' chain window (task 29): «Острие», «Улов». */
export function labelOf(id: string, counterWindow = false): Label {
  const label = BUILD_LABELS[id] ?? { short: id.replace(/^relic-/, '').slice(0, 4), glyph: id.slice(0, 1).toUpperCase(), title: id };
  return counterWindow && WINDOW_NAMES[id] ? { ...label, ...WINDOW_NAMES[id] } : label;
}
export const fireTextOf = (id: string, counterWindow = false): string => (counterWindow ? WINDOW_FIRE[id] : undefined) ?? FIRE_TEXT[id] ?? labelOf(id, counterWindow).title;

/**
 * The hover card of an item (design 10.10.2026, «подробно — по запросу»): its full name, its rule and — a relic or an oath —
 * its price. Texts of the run's catalogue (run/rtTalismans.ts: `name`, `effect`, `price`; hammers — `rtHammer`); an id the
 * catalogue does not know — the view's title. The oath's price is inside its rule in the catalogue; its short price is the
 * view's.
 */
export function itemCard(id: string, kind: BuildKind, counterWindow = false): { name: string; rule: string; price: string | null } {
  const label = labelOf(id, counterWindow);
  if (counterWindow && WINDOW_RULES[id]) return { name: label.title, rule: WINDOW_RULES[id], price: null };
  if (FORM_RULES[id]) return { name: label.title, rule: FORM_RULES[id], price: null };
  const def = kind === 'hammer' ? rtHammer(id) : rtTalisman(id);
  const price = def && 'price' in def && def.price ? def.price : label.price ?? null;
  return { name: def?.name ?? label.title, rule: def?.effect ?? '', price };
}

/**
 * The progress of the item `id` in this world, from its module's pure `progress` hook (sim/build.ts); null — no module,
 * the module does not act here, or nothing to show now. Pure: the hook must not change the world (build.ts, «Хуки»).
 */
export function buildProgressOf(world: World, id: string): BuildProgress | null {
  const module = buildModules().find(m => m.id === id);
  if (!module?.progress || !moduleActive(world, module)) return null;
  const p = module.progress(world);
  return p && Number.isFinite(p.value) && Number.isFinite(p.max) && p.max > 0 ? p : null;
}

/** Dots up to 5 (● done, ○ left), otherwise «3/15». */
export function progressText(p: BuildProgress): string {
  const value = Math.max(0, Math.min(p.max, Math.floor(p.value)));
  return p.max <= 5 ? '●'.repeat(value) + '○'.repeat(p.max - value) : `${value}/${p.max}`;
}

/** A row of the column: what it shows (the item, its kind). */
export interface BuildEntry { id: string; kind: BuildKind }

/**
 * Task 44 «Сплавы»: the parts of the kit's fusions (a kit holding a fusion holds its parts too — sim/kit.ts `kitOf`). The column
 * shows the fusion, one item for two (design 16.10.2026); a part's firing flashes the fusion's row (`fusionOfPart`).
 */
function fusedParts(ids: readonly string[]): Set<string> {
  const parts = new Set<string>();
  for (const id of ids) { const r = fusionRecipe(id); if (r) { parts.add(r.form); parts.add(r.counter); } }
  return parts;
}

/** The items of the world's kit in the column's order: talismans, then the hammer, then the relics. Nothing taken — none. */
export function buildEntries(world: World): BuildEntry[] {
  const kit = world.kit;
  if (!kit) return [];
  const relics = (RELIC_IDS as readonly string[]), fused = fusedParts(kit.talismans);
  return [
    ...kit.talismans.filter(id => !relics.includes(id) && !fused.has(id)).map(id => ({ id, kind: 'talisman' as const })),
    ...kit.hammer && !fused.has(kit.hammer) ? [{ id: kit.hammer, kind: 'hammer' as const }] : [],
    ...kit.talismans.filter(id => relics.includes(id)).map(id => ({ id, kind: 'relic' as const })),
  ];
}

/** Seconds an icon flashes when its item fires (design answer 23). */
export const FLASH_TIME = 0.6;
/**
 * Task 29 (design 15.10.2026): a taken item's icon shows large over the hero (`ARRIVE_HOLD` s), then flies to its row
 * (`ARRIVE_FLY` s) and the row flashes — the eye follows it to the column (no text plate). Real seconds.
 */
export const ARRIVE_HOLD = 0.4;
export const ARRIVE_FLY = 0.6;
const ARRIVE_SIZE = 48;

interface Row { id: string; kind: BuildKind; el: HTMLElement; progress: HTMLElement; flash: number }

const esc = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The DOM column (main.ts puts it over the stage, left of the arena). Rows take the pointer (a hover card); a chain dragged
 * over the column goes on (the window listens to the pointer, not the stage). It never reaches below `bottom` (main.ts: the
 * action bar − 8): too many items — the rows get compact (`rt-build-compact`); still too many — the last ones fold into a
 * «+N» row whose card lists them.
 */
export class BuildColumn {
  readonly el: HTMLElement;
  /** The hover card (outside the column, to its right). */
  readonly tip: HTMLElement;
  private rows: Row[] = [];
  private more: HTMLElement | null = null;
  private key = '';
  /** Task 29: the counters' chain window of the world shown (names and rules of the counters). */
  private counterWindow = false;
  private bottom = Infinity;
  private fitted = '';
  /** Flashes started so far (tests read it). */
  flashes = 0;
  /** Task 29: icon flights started so far, and the ids of those flying now (tests read them). */
  arrivals = 0;
  readonly flying = new Set<string>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'rt-build';
    this.el.setAttribute('data-testid', 'build-column');
    this.el.hidden = true;
    this.tip = document.createElement('div');
    this.tip.className = 'rt-build-tip';
    this.tip.setAttribute('data-testid', 'build-tip');
    this.tip.hidden = true;
  }

  /** Icons in the column now (folded ones count). */
  get count(): number { return this.rows.length; }

  /** Rows folded into «+N». */
  get folded(): number { return this.rows.filter(r => r.el.hidden).length; }

  /** Icons flashing now (tests). */
  get flashing(): string[] { return this.rows.filter(r => r.flash > 0).map(r => r.id); }

  /** The lowest page y the column may reach (main.ts: the top of the action bar − 8). */
  setBottom(bottom: number): void { if (bottom !== this.bottom) { this.bottom = bottom; this.fitted = ''; } }

  /** Rebuilds the rows when the kit changes, refreshes the progress, runs the flashes down (`dt` — real seconds, 0 in pause). */
  update(world: World, dt: number, hidden: boolean): void {
    this.counterWindow = !!world.params.counterWindow;
    const entries = buildEntries(world), key = `${this.counterWindow ? 'w|' : ''}${entries.map(e => `${e.kind}:${e.id}`).join('|')}`;
    if (key !== this.key) this.rebuild(entries, key);
    this.el.hidden = hidden || !this.rows.length;
    if (this.el.hidden) this.tip.hidden = true;
    for (const row of this.rows) {
      const p = buildProgressOf(world, row.id), text = p ? progressText(p) : '';
      if (row.progress.textContent !== text) row.progress.textContent = text;
      row.progress.hidden = !text;
      if (row.flash > 0) {
        row.flash = Math.max(0, row.flash - dt);
        if (row.flash <= 0) { row.el.classList.remove('rt-build-flash'); this.more?.classList.remove('rt-build-flash'); }
      }
    }
    if (!this.el.hidden && this.fitted !== `${this.key}@${this.bottom}`) this.fit();
  }

  /**
   * An item fired: its icon flashes (0.6 s; a folded one — the «+N» row). Returns false when the column has no such item. `fired`
   * false — the flash of an arrived icon (task 29), not counted among the firings (`flashes`).
   */
  flash(id: string, fired = true): boolean {
    // Task 44: a fusion's part is not a row of its own — its firing flashes the fusion's.
    const row = this.rows.find(r => r.id === id) ?? this.rows.find(r => { const f = fusionRecipe(r.id); return !!f && (f.form === id || f.counter === id); });
    if (!row) return false;
    row.flash = FLASH_TIME;
    const el = row.el.hidden && this.more ? this.more : row.el;
    el.classList.remove('rt-build-flash');
    void el.offsetWidth;
    el.classList.add('rt-build-flash');
    if (fired) this.flashes++;
    return true;
  }

  /**
   * Task 29: item `id` was taken — its icon (the row's, enlarged) appears over the page point `from` (the hero on screen), holds
   * `ARRIVE_HOLD`, flies to its row (a folded one — to «+N») in `ARRIVE_FLY` and the row flashes. Returns false when the column
   * has no such row or is hidden.
   */
  arrive(id: string, from: { x: number; y: number }): boolean {
    const row = this.rows.find(r => r.id === id);
    if (!row || this.el.hidden) return false;
    const target = (row.el.hidden && this.more ? this.more : row.el).querySelector('.rt-build-icon') as HTMLElement | null;
    const source = row.el.querySelector('.rt-build-icon') as HTMLElement | null;
    if (!target || !source) return false;
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('rt-build-arrive');
    ghost.setAttribute('data-testid', `build-arrive-${id}`);
    const svg = ghost.querySelector('svg');
    if (svg) { svg.setAttribute('width', String(ARRIVE_SIZE - 8)); svg.setAttribute('height', String(ARRIVE_SIZE - 8)); }
    ghost.style.left = `${Math.round(from.x - ARRIVE_SIZE / 2)}px`;
    ghost.style.top = `${Math.round(from.y - ARRIVE_SIZE / 2)}px`;
    document.body.appendChild(ghost);
    this.arrivals++;
    this.flying.add(id);
    const box = target.getBoundingClientRect(), k = box.width / ARRIVE_SIZE;
    const dx = box.left + box.width / 2 - from.x, dy = box.top + box.height / 2 - from.y, total = (ARRIVE_HOLD + ARRIVE_FLY) * 1000;
    const done = (): void => { ghost.remove(); this.flying.delete(id); this.flash(id, false); };
    if (typeof ghost.animate !== 'function') { done(); return true; }
    const flight = ghost.animate([
      { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.12 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: ARRIVE_HOLD * 1000 / total },
      { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 1 },
    ], { duration: total, easing: 'ease-in-out', fill: 'forwards' });
    flight.onfinish = done;
    flight.oncancel = done;
    return true;
  }

  /** Compact rows, then «+N», until the column ends above `bottom`. */
  private fit(): void {
    this.fitted = `${this.key}@${this.bottom}`;
    const over = (): boolean => this.el.getBoundingClientRect().bottom > this.bottom;
    this.el.classList.remove('rt-build-compact');
    for (const r of this.rows) r.el.hidden = false;
    this.more?.remove();
    this.more = null;
    if (!Number.isFinite(this.bottom) || !over()) return;
    this.el.classList.add('rt-build-compact');
    if (!over()) return;
    const more = document.createElement('div');
    more.className = 'rt-build-item rt-build-more';
    more.setAttribute('data-testid', 'build-more');
    this.el.appendChild(more);
    this.more = more;
    for (let n = this.rows.length - 1; n > 0 && (n === this.rows.length - 1 || over()); n--) {
      this.rows[n].el.hidden = true;
      more.innerHTML = `<i class="rt-build-icon">+${this.rows.length - n}</i><b>ещё</b>`;
    }
    more.addEventListener('pointerenter', event => this.showTip(more, this.rows.filter(r => r.el.hidden), event));
    more.addEventListener('pointerleave', () => { this.tip.hidden = true; });
  }

  /** The card at a row: one item (name, rule, price) or the folded ones (a list). Not while a button is held (a chain). */
  private showTip(anchor: HTMLElement, rows: Row[], event: PointerEvent): void {
    if (event.buttons) return;
    this.tip.innerHTML = rows.map(r => {
      const card = itemCard(r.id, r.kind, this.counterWindow);
      return `<div><b>${esc(card.name)}</b>${card.rule ? `<span>${esc(card.rule)}</span>` : ''}${card.price ? `<em>Цена: ${esc(card.price)}</em>` : ''}</div>`;
    }).join('');
    this.tip.dataset.id = rows.map(r => r.id).join(' ');
    const box = anchor.getBoundingClientRect();
    this.tip.style.left = `${Math.round(box.right + 6)}px`;
    this.tip.style.top = `${Math.round(box.top)}px`;
    this.tip.hidden = false;
    const tipBox = this.tip.getBoundingClientRect();
    if (tipBox.bottom > window.innerHeight - 4) this.tip.style.top = `${Math.max(4, Math.round(window.innerHeight - 4 - tipBox.height))}px`;
  }

  private rebuild(entries: BuildEntry[], key: string): void {
    this.key = key;
    this.fitted = '';
    this.tip.hidden = true;
    this.more = null;
    this.el.replaceChildren();
    this.rows = entries.map(({ id, kind }) => {
      const label = labelOf(id, this.counterWindow), el = document.createElement('div');
      el.className = `rt-build-item rt-build-${kind}${fusionRecipe(id) ? ' rt-build-fusion' : ''}`;
      el.setAttribute('data-testid', `build-${id}`);
      el.dataset.kind = kind;
      const icon = document.createElement('i');
      icon.className = 'rt-build-icon';
      if (label.svg) { icon.innerHTML = label.svg; icon.classList.add('rt-build-icon-svg'); } else icon.textContent = label.glyph;
      const name = document.createElement('b');
      name.textContent = label.short;
      const progress = document.createElement('span');
      progress.className = 'rt-build-progress';
      progress.setAttribute('data-testid', `build-progress-${id}`);
      progress.hidden = true;
      el.append(icon, name, progress);
      if (label.price) {
        const price = document.createElement('small');
        price.className = 'rt-build-price';
        price.textContent = label.price;
        el.appendChild(price);
      }
      this.el.appendChild(el);
      const row: Row = { id, kind, el, progress, flash: 0 };
      el.addEventListener('pointerenter', event => this.showTip(el, [row], event));
      el.addEventListener('pointerleave', () => { this.tip.hidden = true; });
      return row;
    });
  }
}

