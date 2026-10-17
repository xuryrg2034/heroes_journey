/**
 * Task 37 «Лагерь „Очаг“ v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md): the camp screen, one screen 1280×720.
 * - The fire in the centre: the hero's bar of experience, the next pack (three card silhouettes and its threshold), the depth
 *   record, «В поход» (or «К походу» while a run is open).
 * - The stock at the top with its icon.
 * - Six places round the fire: the NPC who came (v1: Неясыть from the start, Марфа and Ерофей when met) and dark empty places
 *   (no text promises anything).
 * - A click on an NPC: a bubble with the line (by the last run's occasion) and the NPC's upgrades — the price, «куплено», a
 *   lack shown on the disabled button («нужно 8, есть 5»), level 3 locked. Неясыть: the bestiary (free). The NPC's quest.
 * - «В поход»: the one start of a run (runStart.ts) — the choices bought (maps, Марфа's kind), then the run as before (the gift).
 * View only: the profile (core) holds the stock, the levels and the meetings (`MetaSource`); the run's flags come from it.
 */
import { KIND_CAPTIONS } from './newSeen';
import { HEARTH_GATE_LOCK, HEARTH_PLACES, HEARTH_PRICES, NPCS, metaItemCard, xpBar, type HearthState, type MetaHeroId, type MetaSource, type NpcId } from './metaModel';
import { NPC_LINES, pickLine, questLine, type DeathCause } from './npcLines';
import { rowWord } from './metaEnd';
import { toadLine, toadRunKey } from './heroLines';

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2 L17 7 L14.5 17 L5.5 17 L3 7 Z" fill="#e3b45a" stroke="#1a2330" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 7 L10 9 L17 7 M10 9 L10 17" fill="none" stroke="#1a2330" stroke-width="1.2" stroke-linejoin="round"/></svg>';

/**
 * The six places round the fire, px of the 1280×720 screen — the stumps and rugs of the camp's background (design 15.10.2026,
 * public/art/camp/hearth.png): the order of `HEARTH_PLACES` — Неясыть on the back left stump, Марфа on the back right rug,
 * Ерофей on the front left rug (design 15.10.2026: on the right he covered Марфа's name); the empty ones — the left stump, the
 * right stump, the front right rug. No two names overlap in any company. `s` — the figure's scale (farther — smaller).
 */
const PLACE_AT: readonly { x: number; y: number; s: number }[] = [
  { x: 345, y: 352, s: 0.9 }, { x: 935, y: 356, s: 0.9 }, { x: 305, y: 528, s: 0.95 }, { x: 245, y: 422, s: 1 }, { x: 1045, y: 422, s: 1 }, { x: 965, y: 516, s: 1.1 },
];
/** The NPC's art (public/art/characters; design, Codex): a stand-in silhouette shows if the image does not load. */
const NPC_ART: Readonly<Record<NpcId, string>> = { owl: 'npc-owl', herb: 'npc-herbalist', smith: 'npc-smith', gambler: 'npc-gambler' };
const artUrl = (path: string): string => new URL(`art/${path}`, document.baseURI).href;

/**
 * Task 49: the heroes by the fire (feet, px of the 1280x720 screen): the chosen one sits nearer to the fire, the other beside it.
 * The art is public/art/characters (`player` - the cat, `toad` - Ведунья); a stand-in silhouette shows if it does not load.
 */
const HERO_AT = { chosen: { x: 566, y: 524, s: 1 }, other: { x: 724, y: 522, s: 0.82 } } as const;
const HERO_ART: Readonly<Record<MetaHeroId, string>> = { cat: 'player', toad: 'toad' };
const HERO_SVG: Readonly<Record<MetaHeroId, string>> = {
  cat: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M30 20 L44 44 L76 44 L90 20 L96 64 Q98 100 84 126 L36 126 Q22 100 24 64 Z" fill="#c9732e" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><circle cx="48" cy="70" r="6" fill="#0d141b"/><circle cx="72" cy="70" r="6" fill="#0d141b"/><path d="M56 84 L64 84 L60 92 Z" fill="#0d141b"/></svg>',
  toad: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 40 Q96 40 100 80 Q106 126 60 132 Q14 126 20 80 Q24 40 60 40 Z" fill="#6a8a4a" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><circle cx="40" cy="44" r="14" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="80" cy="44" r="14" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="42" cy="46" r="5" fill="#0d141b"/><circle cx="78" cy="46" r="5" fill="#0d141b"/><path d="M38 86 Q60 100 82 86" fill="none" stroke="#0d141b" stroke-width="4" stroke-linecap="round"/></svg>',
};

/** Stand-in of Шиш (task 51в). */
const GAMBLER_SVG = '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 40 Q96 44 98 84 Q100 136 60 142 Q20 136 22 84 Q24 44 60 40 Z" fill="#c8962e" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><path d="M26 56 L4 40 L24 72 Z M94 56 L116 40 L96 72 Z" fill="#6f8f3a" stroke="#0d141b" stroke-width="4" stroke-linejoin="round"/><ellipse cx="60" cy="58" rx="24" ry="20" fill="#7aa045" stroke="#0d141b" stroke-width="4"/><circle cx="50" cy="56" r="4" fill="#0d141b"/><circle cx="70" cy="56" r="4" fill="#0d141b"/><path d="M48 70 Q60 80 72 70" fill="none" stroke="#0d141b" stroke-width="3.5" stroke-linecap="round"/><rect x="40" y="96" width="14" height="18" rx="2" fill="#e8d7ad" stroke="#0d141b" stroke-width="3" transform="rotate(-10 47 105)"/><path d="M34 92 L86 92" stroke="#e0613f" stroke-width="6" stroke-linecap="round"/></svg>';
/** Stand-in silhouettes of the NPC until the art (design, Codex): navy shapes with one colour accent. */
const NPC_SVG: Readonly<Record<NpcId, string>> = {
  owl: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 22 L40 8 L42 34 Q22 52 24 92 Q28 136 60 142 Q92 136 96 92 Q98 52 78 34 L80 8 Z" fill="#2a3640" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><circle cx="46" cy="58" r="13" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="74" cy="58" r="13" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="47" cy="59" r="5" fill="#0d141b"/><circle cx="73" cy="59" r="5" fill="#0d141b"/><path d="M60 70 L54 80 L66 80 Z" fill="#c8962e" stroke="#0d141b" stroke-width="3"/><path d="M38 98 Q60 112 82 98 M40 112 Q60 126 80 112" fill="none" stroke="#5a6a76" stroke-width="4"/><rect x="74" y="104" width="30" height="22" rx="3" fill="#8a6a3e" stroke="#0d141b" stroke-width="4" transform="rotate(-12 89 115)"/></svg>',
  herb: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 14 Q34 16 32 44 Q30 60 40 66 L80 66 Q90 60 88 44 Q86 16 60 14 Z" fill="#7a2e2e" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><ellipse cx="60" cy="50" rx="17" ry="19" fill="#e2c7a0" stroke="#0d141b" stroke-width="4"/><path d="M40 66 Q22 110 26 146 L94 146 Q98 110 80 66 Z" fill="#3b5a3a" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><path d="M44 96 L76 96 L72 132 L48 132 Z" fill="#cfc29a" stroke="#0d141b" stroke-width="3"/><path d="M92 92 Q104 84 100 72 M96 96 Q110 96 112 84" fill="none" stroke="#6fae5a" stroke-width="4" stroke-linecap="round"/><circle cx="53" cy="49" r="2.6" fill="#0d141b"/><circle cx="67" cy="49" r="2.6" fill="#0d141b"/></svg>',
  smith: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M26 70 Q22 140 30 146 L90 146 Q98 140 94 70 Q60 56 26 70 Z" fill="#4a4036" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><ellipse cx="60" cy="44" rx="20" ry="22" fill="#d9b48c" stroke="#0d141b" stroke-width="4"/><path d="M40 52 Q60 84 80 52 Q72 66 60 66 Q48 66 40 52 Z" fill="#8a5a32" stroke="#0d141b" stroke-width="3"/><path d="M42 84 L78 84 L82 146 L38 146 Z" fill="#6a4a2a" stroke="#0d141b" stroke-width="4"/><rect x="88" y="62" width="10" height="56" rx="3" fill="#8a6a3e" stroke="#0d141b" stroke-width="3" transform="rotate(18 93 90)"/><rect x="88" y="52" width="28" height="16" rx="3" fill="#7d8a96" stroke="#0d141b" stroke-width="4" transform="rotate(18 102 60)"/><circle cx="52" cy="42" r="2.6" fill="#0d141b"/><circle cx="68" cy="42" r="2.6" fill="#0d141b"/></svg>',
  gambler: GAMBLER_SVG,
};
const FIRE_SVG = '<svg class="rt-hearth-fire" viewBox="0 0 200 170" aria-hidden="true"><ellipse cx="100" cy="150" rx="86" ry="16" fill="#0a0d09"/><g class="rt-hearth-logs"><rect x="34" y="130" width="132" height="18" rx="9" fill="#5a3b22" stroke="#0d141b" stroke-width="4" transform="rotate(-10 100 139)"/><rect x="34" y="130" width="132" height="18" rx="9" fill="#6b4628" stroke="#0d141b" stroke-width="4" transform="rotate(10 100 139)"/></g><path class="rt-flame rt-flame-a" d="M100 18 Q132 64 128 100 Q126 132 100 138 Q74 132 72 100 Q70 64 100 18 Z" fill="#e0562f" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><path class="rt-flame rt-flame-b" d="M100 58 Q120 88 116 110 Q112 130 100 132 Q88 130 84 110 Q80 88 100 58 Z" fill="#ffb347"/><path class="rt-flame rt-flame-c" d="M100 90 Q110 106 108 118 Q106 128 100 128 Q94 128 92 118 Q90 106 100 90 Z" fill="#fff2c4"/></svg>';
const EMPTY_SVG = '<svg viewBox="0 0 120 60" aria-hidden="true"><ellipse cx="60" cy="40" rx="46" ry="14" fill="#0b100a"/><rect x="22" y="22" width="76" height="22" rx="10" fill="#241c14" stroke="#0d141b" stroke-width="4"/><ellipse cx="94" cy="33" rx="6" ry="10" fill="#3a2c1e" stroke="#0d141b" stroke-width="3"/></svg>';

/** What the camp needs of its host (main.ts / RunView). */
export interface HearthHost {
  meta: MetaSource;
  /** A run is open on the map: the button returns to it instead of starting a new one. */
  runActive(): boolean;
  /** Start a new run with `seed` (null — the default seed) and the chosen start consumable. */
  /** «В поход»: the one start of a new run (the choices bought, then the run). */
  begin(): void;
  /** Telemetry: a click on an NPC; a purchase. */
  click?(npc: NpcId): void;
  bought?(npc: NpcId, level: number, price: number): void;
  /** Back to the open run's map. */
  back(): void;
  sound?(kind: 'buy' | 'open'): void;
  /** The enemy kinds the viewer has met (the bestiary; view/newSeen.ts memory), besides the profile's `seen`. */
  beasts?(): string[];
}

/** What the camp shows now (tests read it). */
export interface HearthShown {
  open: boolean; npcs: NpcId[]; empty: number; bubble: NpcId | null; line: string; bought: number; bestiary: number;
  /** Task 49: the heroes by the fire (the chosen one first), the hero chosen, and the line Ведунья says now (empty - none). */
  heroes: MetaHeroId[]; hero: MetaHeroId; heroLine: string;
}

export class HearthView {
  readonly el: HTMLDivElement;
  private bubble: NpcId | null = null;
  private bestiary = false;
  /** The occasion line was said in this visit (then idle lines). */
  private said = new Set<NpcId>();
  private boughtNow: { npc: NpcId; level: 1 | 2 | 3 } | null = null;
  private lastLine = '';
  /** Task 49: the line Ведунья says now (one at a time; empty - her place is quiet). */
  private heroLine = '';
  readonly shown: HearthShown = { open: false, npcs: [], empty: 0, bubble: null, line: '', bought: 0, bestiary: 0, heroes: [], hero: 'cat', heroLine: '' };

  constructor(private readonly host: HearthHost) {
    this.el = document.createElement('div');
    this.el.className = 'rt-hearth';
    this.el.setAttribute('data-testid', 'hearth');
    this.el.hidden = true;
    this.el.addEventListener('click', event => this.onClick(event));
    // The camp's background (the fire and six places); without it — the drawn fire and dark places (`rt-hearth-noart`).
    this.el.style.backgroundImage = `url("${artUrl('camp/hearth.png')}")`;
    const probe = new Image();
    probe.onerror = () => { this.el.classList.add('rt-hearth-noart'); this.el.style.backgroundImage = ''; };
    probe.src = artUrl('camp/hearth.png');
    window.addEventListener('keydown', event => { if (event.key === 'Escape' && !this.el.hidden && (this.bubble || this.bestiary)) { this.bubble = null; this.bestiary = false; this.draw(); } });
  }

  get isOpen(): boolean { return !this.el.hidden; }

  open(): void {
    this.el.hidden = false; this.bubble = null; this.bestiary = false; this.said.clear();
    // Task 49: the first camp after the rescue - her one line names the deed (`first_camp`, said once).
    this.heroLine = '';
    const camp = this.host.meta.hearth();
    if (this.host.meta.heroes().some(h => h.id === 'toad' && h.open)) {
      // Then, after a run of hers, her line of its record or death (`last.hero`; one line a visit).
      const run = camp.last?.hero === 'toad' ? toadRunKey(camp.last) : null;
      if (!camp.lines['toad:first_camp']) this.sayHero('first_camp'); else if (run) this.sayHero(run);
    }
    this.shown.open = true;
    this.host.sound?.('open');
    this.draw();
  }

  close(): void { this.el.hidden = true; this.shown.open = false; }

  private sayHero(key: Parameters<typeof toadLine>[0]): void {
    const line = toadLine(key, this.host.meta.hearth().lines);
    this.host.meta.markLine(line.id);
    this.heroLine = line.text;
  }

  /** Task 49: the heroes by the fire - the chosen one nearer the fire; a click on the other chooses it. Ведунья's line stands over her. */
  private heroesHtml(): string {
    const heroes = this.host.meta.heroes().filter(h => h.open), ordered = [...heroes.filter(h => h.chosen), ...heroes.filter(h => !h.chosen)];
    this.shown.heroes = ordered.map(h => h.id); this.shown.hero = ordered[0]?.id ?? 'cat';
    return ordered.map((h, i) => {
      const at = i === 0 ? HERO_AT.chosen : HERO_AT.other;
      const say = h.id === 'toad' && this.heroLine ? `<span class="rt-hearth-hero-say" data-testid="hearth-hero-line">${esc(this.heroLine)}</span>` : '';
      const fig = `<img class="rt-hearth-art" src="${artUrl(`characters/${HERO_ART[h.id]}.png`)}" alt="" style="height:${Math.round(150 * at.s)}px" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
        + `<span class="rt-hearth-sil-npc" hidden>${HERO_SVG[h.id]}</span>`;
      return `<button class="rt-hearth-place rt-hearth-hero${h.chosen ? ' rt-chosen' : ''}" style="left:${at.x}px;top:${at.y}px" data-action="hero" data-hero="${h.id}" data-testid="hearth-hero-${h.id}" aria-pressed="${h.chosen}" title="${esc(h.title)}${h.chosen ? '' : ' — взять в поход'}">${say}${fig}<span class="rt-hearth-name">${esc(h.title)}</span></button>`;
    }).join('');
  }

  private npcsHere(h: HearthState): NpcId[] { return (['owl', 'herb', 'smith', 'gambler'] as const).filter(id => id === 'owl' || h.met[id]); }

  draw(): void {
    const h = this.host.meta.hearth(), here = this.npcsHere(h);
    const places = HEARTH_PLACES.map((npc, i) => {
      const at = PLACE_AT[i], live = npc && here.includes(npc) ? npc : null;
      // An empty place: the background's stump or rug as it is (a dark log only without the background).
      if (!live) return `<div class="rt-hearth-place rt-hearth-empty" style="left:${at.x}px;top:${at.y}px" data-testid="hearth-empty-${i}">${EMPTY_SVG}</div>`;
      const fig = `<img class="rt-hearth-art" src="${artUrl(`characters/${NPC_ART[live]}.png`)}" alt="" style="height:${Math.round(150 * at.s)}px" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
        + `<span class="rt-hearth-sil-npc" hidden>${NPC_SVG[live]}</span>`;
      // Task 51в (design 17.10.2026): «✦» over a guest who has come until the first click on them (the meeting line is said - the profile's
      // memory `npc:first` / `npc:first_self` counts it, so the sign does not come back after a reload); «!» stays the quest's.
      const fresh = live !== 'owl' && !h.lines[`${live}:first`] && !h.lines[`${live}:first_self`] ? '<i class="rt-hearth-new-mark" data-testid="hearth-new-' + live + '" title="Новое">✦</i>' : '';
      const quest = fresh + (h.quest?.npc === live ? '<i class="rt-hearth-quest-mark" title="Задание">!</i>' : '');
      return `<button class="rt-hearth-place rt-hearth-npc${this.bubble === live ? ' rt-on' : ''}" style="left:${at.x}px;top:${at.y}px" data-action="npc" data-npc="${live}" data-testid="hearth-npc-${live}" title="${esc(NPCS[live].name)}">${fig}${quest}<span class="rt-hearth-name">${esc(NPCS[live].name)}</span></button>`;
    }).join('');
    this.shown.npcs = here; this.shown.empty = HEARTH_PLACES.length - here.length; this.shown.bubble = this.bubble;
    const bar = xpBar(h.xp, h.thresholds);
    const next = h.nextPack ? `<div class="rt-hearth-next" data-testid="hearth-next" title="Следующий набор: ${esc(h.nextPack.title)}">${Array.from({ length: h.nextPack.size }, () => '<span class="rt-hearth-sil">?</span>').join('')}<small>${h.nextPack.at}</small></div>` : '';
    // Smoke v62: no record yet (row 0) — no line. Task 38: a garrison record — «Гарнизон, ряд N». Task 40: «гарнизон пройден».
    const record = h.record && (h.record.row > 0 || h.record.wonLevel || h.record.level) ? `<p class="rt-hearth-record" data-testid="hearth-record">Рекорд: ${esc(rowWord(h.record.row, h.record.wonLevel ?? 0, h.record.level))}</p>` : '';
    const go = this.host.runActive() ? '<button class="rt-again rt-hearth-go" data-action="back" data-testid="hearth-back">К походу</button>' : '<button class="rt-again rt-hearth-go" data-action="go" data-testid="hearth-go">В поход</button>';
    const center = `<div class="rt-hearth-fire-wrap">${FIRE_SVG}</div><div class="rt-hearth-glow"></div><div class="rt-hearth-center"><div class="rt-hearth-bar" data-testid="hearth-bar" title="Опыт героя"><i style="width:${(bar.k * 100).toFixed(1)}%"></i><em>${h.xp}${bar.to !== null ? ` / ${bar.to}` : ''}</em></div>${next}${record}${go}</div>`;
    const head = `<header class="rt-hearth-head"><b>Очаг</b><span class="rt-hearth-stock" data-testid="hearth-stock" title="Запас лагеря">${ICON}<b>${h.stock}</b></span></header>`;
    this.shown.heroLine = this.heroLine;
    this.el.innerHTML = head + `<div class="rt-hearth-stage">${center}${places}${this.heroesHtml()}${this.bubbleHtml(h)}</div>${this.bestiaryHtml(h)}`;
  }

  private bubbleHtml(h: HearthState): string {
    const npc = this.bubble;
    if (!npc) return '';
    const i = HEARTH_PLACES.indexOf(npc), at = PLACE_AT[i], right = at.x > 640;
    const level = h.levels[npc] ?? 0;
    const rows = NPCS[npc].upgrades.map((name, k) => {
      const lv = k + 1, price = HEARTH_PRICES[k];
      let action: string;
      // Task 51а: level 3 stays under the lock «Закрыто · Дойди до гарнизона» until a hero has entered the garrison.
      const shut = lv === 3 && !h.gate3 && level < lv;
      if (shut) action = `<span class="rt-hearth-lock" data-testid="up-${npc}-${lv}-lock" title="${esc(HEARTH_GATE_LOCK.rule)}">🔒</span>`;
      else if (level >= lv) action = `<span class="rt-hearth-bought" data-testid="up-${npc}-${lv}-bought">✓ куплено</span>`;
      // Level 2 only after level 1: a grey price, no reason text (design 15.10.2026).
      else if (lv > level + 1) action = `<button class="rt-hearth-buy rt-hearth-later" disabled data-testid="up-${npc}-${lv}" data-later="true" title="Сначала — «${esc(NPCS[npc].upgrades[level])}»">${ICON}${price}</button>`;
      else if (h.stock < price) action = `<button class="rt-hearth-buy" disabled data-testid="up-${npc}-${lv}" data-lack="true">нужно ${price}, есть ${h.stock}</button>`;
      else action = `<button class="rt-hearth-buy" data-action="buy" data-npc="${npc}" data-level="${lv}" data-testid="up-${npc}-${lv}">${ICON}${price}</button>`;
      return `<li class="${level >= lv ? 'rt-done' : shut ? 'rt-locked' : ''}" data-testid="up-${npc}-${lv}-row"><div><b>${esc(shut ? HEARTH_GATE_LOCK.name : name)}</b><small>${esc(shut ? HEARTH_GATE_LOCK.rule : NPCS[npc].rules[k])}</small></div>${action}</li>`;
    }).join('');
    const quest = h.quest?.npc === npc ? `<p class="rt-hearth-quest" data-testid="hearth-quest">${esc(questLine(npc, h.quest.id === 'owl-forest', h.lines))} <small>+10 опыта, +3 запаса</small></p>` : '';
    const book = npc === 'owl' ? '<button class="rt-other rt-hearth-book" data-action="bestiary" data-testid="hearth-bestiary">Бестиарий</button>' : '';
    // The bubble stands low at the right edge (over the empty front right rug; no NPC stands there, the fire and the centre stay clear).
    void i; void at; void right;
    return `<div class="rt-hearth-bubble" style="right:16px;bottom:16px" data-testid="hearth-bubble" data-npc="${npc}">`
      + `<p class="rt-hearth-who"><b>${esc(NPCS[npc].name)}</b> · ${esc(NPCS[npc].who)}</p><p class="rt-hearth-line" data-testid="hearth-line">${esc(this.lastLine)}</p>${quest}<ul class="rt-hearth-ups">${rows}</ul>${book}</div>`;
  }

  private bestiaryHtml(h: HearthState): string {
    if (!this.bestiary) return '';
    const met = new Set([...h.seen, ...this.host.beasts?.() ?? []]), kinds = Object.keys(KIND_CAPTIONS).filter(k => met.has(k));
    this.shown.bestiary = kinds.length;
    // The name is before the first « — » (task 43: «Стражник — ходит строем: строй — готовая цепь» keeps its second dash in the line).
    const rows = kinds.map(k => { const text = KIND_CAPTIONS[k], at = text.indexOf(' — '), name = at < 0 ? text : text.slice(0, at), line = at < 0 ? '' : text.slice(at + 3); return `<li data-testid="beast-${k}"><b>${esc(name)}</b><span>${esc(line)}</span></li>`; }).join('');
    return `<div class="rt-overlay rt-hearth-modal" data-action="close" data-testid="hearth-bestiary-panel"><div class="rt-card rt-hearth-book-card"><h2>Бестиарий</h2>${rows ? `<ul class="rt-hearth-beasts">${rows}</ul>` : '<p class="rt-run-note">Пока пусто.</p>'}<button class="rt-other" data-action="close">Закрыть</button></div></div>`;
  }

  private say(npc: NpcId, h: HearthState): void {
    const l = this.said.has(npc) ? undefined : h.last;
    // The quest's result belongs to the NPC who gave it (the camp's quest was that run's).
    const quest = l?.quest !== undefined && h.quest?.npc === npc;
    const bought = this.boughtNow?.npc === npc ? this.boughtNow.level : undefined;
    const line = pickLine(npc, {
      ...h.self?.[npc] ? { self: true } : {}, ...bought ? { bought } : {}, others: this.npcsHere(h),
      ...h.last?.hero ? { hero: h.last.hero } : {},
      ...l ? { last: { won: l.won, ...l.firstWin ? { firstWin: true } : {}, ...l.cause ? { cause: l.cause as DeathCause } : {}, ...l.beaten ? { record: true } : {}, ...l.pack ? { pack: true } : {}, ...l.casino ? { casino: l.casino } : {}, ...quest ? (l.quest ? { questDone: true } : { questFail: true }) : {} } } : {},
    }, h.lines);
    this.said.add(npc);
    this.boughtNow = null;
    this.host.meta.markLine(line.id);
    this.lastLine = line.text; this.shown.line = line.text;
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) { if (this.bubble && !(event.target as HTMLElement).closest('.rt-hearth-bubble')) { this.bubble = null; this.draw(); } return; }
    const action = target.dataset.action, h = this.host.meta.hearth();
    if (action === 'npc') { const npc = target.dataset.npc as NpcId; this.bubble = this.bubble === npc ? null : npc; if (this.bubble) { this.say(npc, h); this.host.click?.(npc); } this.draw(); return; }
    if (action === 'buy') {
      const npc = target.dataset.npc as NpcId, level = Number(target.dataset.level);
      const result = this.host.meta.buy(npc, level);
      // Task 51а: a refusal by the gate or the lock is answered in the NPC's own words (no new plate).
      if (!result.ok && (result.reason === 'gate' || result.reason === 'locked')) { this.lastLine = NPC_LINES[npc].locked3?.[0] ?? HEARTH_GATE_LOCK.rule; this.shown.line = this.lastLine; }
      if (result.ok) { this.shown.bought++; this.boughtNow = { npc, level: level === 3 ? 3 : level === 2 ? 2 : 1 }; this.host.sound?.('buy'); this.host.bought?.(npc, level, HEARTH_PRICES[level - 1]); this.say(npc, this.host.meta.hearth()); }
      this.draw(); return;
    }
    if (action === 'hero') {
      const id = target.dataset.hero as MetaHeroId;
      // Task 49: a click chooses the hero for the next run (the bar, the pack and the record follow); Ведунья answers with one line.
      this.bubble = null;
      if (id === 'toad') { const chosen = h.hero === 'toad'; if (chosen || this.host.meta.chooseHero('toad')) this.sayHero(chosen ? 'about_cat' : 'pick'); }
      else { this.host.meta.chooseHero('cat'); this.heroLine = ''; }
      this.draw(); return;
    }
    if (action === 'bestiary') { this.bestiary = true; this.draw(); return; }
    if (action === 'close') { if (event.target === target || target.tagName === 'BUTTON') { this.bestiary = false; this.draw(); } return; }
    if (action === 'back') { this.close(); this.host.back(); return; }
    // The one start of a run (runStart.ts): the camp's choices bought, then the run — the same way as «Новый поход».
    if (action === 'go') { this.close(); this.host.begin(); return; }
  }
}

/** For the end screen's pack names (re-export so the run screen reads one module). */
export { metaItemCard };
