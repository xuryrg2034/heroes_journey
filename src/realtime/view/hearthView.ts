/**
 * Task 37 «Лагерь „Очаг“ v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md): the camp screen, one screen 1280×720.
 * - The fire in the centre: the hero's bar of experience, the next pack (three card silhouettes and its threshold), the depth
 *   record, «В поход» (or «К походу» while a run is open).
 * - The stock at the top with its icon.
 * - Six places round the fire: the NPC who came (v1: Неясыть from the start, Марфа and Ерофей when met) and dark empty places
 *   (no text promises anything).
 * - A click on an NPC: a bubble with the line (by the last run's occasion) and the NPC's upgrades — the price, «куплено», a
 *   lack shown on the disabled button («нужно 8, есть 5»), level 3 locked. Неясыть: the bestiary (free). The NPC's quest.
 * - «В поход»: with «Две/Три тропы» — a choice of 2/3 forest maps; with «Выбор травницы» — the consumable's kind from 2; then the
 *   run starts as before (the gift).
 * View only: the profile (core) holds the stock, the levels and the meetings (`MetaSource`); the run's flags come from it.
 */
import { createRtRun, rtMapNodes } from '../run/rtRun';
import { ITEM_TITLES, type ItemKind } from '../sim/kit';
import { KIND_CAPTIONS } from './newSeen';
import { RT_NODE_TYPES } from './nodeTypes';
import { HEARTH_LEVEL_LOCKED, HEARTH_PLACES, HEARTH_PRICES, NPCS, metaItemCard, xpBar, type HearthStart, type HearthState, type MetaSource, type NpcId } from './metaModel';
import { NPC_LINES, pickLine, questLine, type DeathCause } from './npcLines';
import { rowWord } from './metaEnd';

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
const NPC_ART: Readonly<Record<NpcId, string>> = { owl: 'npc-owl', herb: 'npc-herbalist', smith: 'npc-smith' };
const artUrl = (path: string): string => new URL(`art/${path}`, document.baseURI).href;

/** Stand-in silhouettes of the NPC until the art (design, Codex): navy shapes with one colour accent. */
const NPC_SVG: Readonly<Record<NpcId, string>> = {
  owl: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 22 L40 8 L42 34 Q22 52 24 92 Q28 136 60 142 Q92 136 96 92 Q98 52 78 34 L80 8 Z" fill="#2a3640" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><circle cx="46" cy="58" r="13" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="74" cy="58" r="13" fill="#e8d7ad" stroke="#0d141b" stroke-width="4"/><circle cx="47" cy="59" r="5" fill="#0d141b"/><circle cx="73" cy="59" r="5" fill="#0d141b"/><path d="M60 70 L54 80 L66 80 Z" fill="#c8962e" stroke="#0d141b" stroke-width="3"/><path d="M38 98 Q60 112 82 98 M40 112 Q60 126 80 112" fill="none" stroke="#5a6a76" stroke-width="4"/><rect x="74" y="104" width="30" height="22" rx="3" fill="#8a6a3e" stroke="#0d141b" stroke-width="4" transform="rotate(-12 89 115)"/></svg>',
  herb: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M60 14 Q34 16 32 44 Q30 60 40 66 L80 66 Q90 60 88 44 Q86 16 60 14 Z" fill="#7a2e2e" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><ellipse cx="60" cy="50" rx="17" ry="19" fill="#e2c7a0" stroke="#0d141b" stroke-width="4"/><path d="M40 66 Q22 110 26 146 L94 146 Q98 110 80 66 Z" fill="#3b5a3a" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><path d="M44 96 L76 96 L72 132 L48 132 Z" fill="#cfc29a" stroke="#0d141b" stroke-width="3"/><path d="M92 92 Q104 84 100 72 M96 96 Q110 96 112 84" fill="none" stroke="#6fae5a" stroke-width="4" stroke-linecap="round"/><circle cx="53" cy="49" r="2.6" fill="#0d141b"/><circle cx="67" cy="49" r="2.6" fill="#0d141b"/></svg>',
  smith: '<svg viewBox="0 0 120 150" aria-hidden="true"><path d="M26 70 Q22 140 30 146 L90 146 Q98 140 94 70 Q60 56 26 70 Z" fill="#4a4036" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><ellipse cx="60" cy="44" rx="20" ry="22" fill="#d9b48c" stroke="#0d141b" stroke-width="4"/><path d="M40 52 Q60 84 80 52 Q72 66 60 66 Q48 66 40 52 Z" fill="#8a5a32" stroke="#0d141b" stroke-width="3"/><path d="M42 84 L78 84 L82 146 L38 146 Z" fill="#6a4a2a" stroke="#0d141b" stroke-width="4"/><rect x="88" y="62" width="10" height="56" rx="3" fill="#8a6a3e" stroke="#0d141b" stroke-width="3" transform="rotate(18 93 90)"/><rect x="88" y="52" width="28" height="16" rx="3" fill="#7d8a96" stroke="#0d141b" stroke-width="4" transform="rotate(18 102 60)"/><circle cx="52" cy="42" r="2.6" fill="#0d141b"/><circle cx="68" cy="42" r="2.6" fill="#0d141b"/></svg>',
};
const FIRE_SVG = '<svg class="rt-hearth-fire" viewBox="0 0 200 170" aria-hidden="true"><ellipse cx="100" cy="150" rx="86" ry="16" fill="#0a0d09"/><g class="rt-hearth-logs"><rect x="34" y="130" width="132" height="18" rx="9" fill="#5a3b22" stroke="#0d141b" stroke-width="4" transform="rotate(-10 100 139)"/><rect x="34" y="130" width="132" height="18" rx="9" fill="#6b4628" stroke="#0d141b" stroke-width="4" transform="rotate(10 100 139)"/></g><path class="rt-flame rt-flame-a" d="M100 18 Q132 64 128 100 Q126 132 100 138 Q74 132 72 100 Q70 64 100 18 Z" fill="#e0562f" stroke="#0d141b" stroke-width="5" stroke-linejoin="round"/><path class="rt-flame rt-flame-b" d="M100 58 Q120 88 116 110 Q112 130 100 132 Q88 130 84 110 Q80 88 100 58 Z" fill="#ffb347"/><path class="rt-flame rt-flame-c" d="M100 90 Q110 106 108 118 Q106 128 100 128 Q94 128 92 118 Q90 106 100 90 Z" fill="#fff2c4"/></svg>';
const EMPTY_SVG = '<svg viewBox="0 0 120 60" aria-hidden="true"><ellipse cx="60" cy="40" rx="46" ry="14" fill="#0b100a"/><rect x="22" y="22" width="76" height="22" rx="10" fill="#241c14" stroke="#0d141b" stroke-width="4"/><ellipse cx="94" cy="33" rx="6" ry="10" fill="#3a2c1e" stroke="#0d141b" stroke-width="3"/></svg>';

/** What the camp needs of its host (main.ts / RunView). */
export interface HearthHost {
  meta: MetaSource;
  /** A run is open on the map: the button returns to it instead of starting a new one. */
  runActive(): boolean;
  /** Start a new run with `seed` (null — the default seed) and the chosen start consumable. */
  start(seed: number, item: ItemKind | null, plan: HearthStart, map: number | null): void;
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
export interface HearthShown { open: boolean; npcs: NpcId[]; empty: number; bubble: NpcId | null; line: string; bought: number; bestiary: number; step: 'camp' | 'maps' | 'items'; maps: number }

export class HearthView {
  readonly el: HTMLDivElement;
  private bubble: NpcId | null = null;
  private bestiary = false;
  private step: 'camp' | 'maps' | 'items' = 'camp';
  /** The start being chosen: the core's plan for the base seed, the map chosen (its index) and its seed. */
  private start: { plan: HearthStart; base: number; seed: number; map: number | null } | null = null;
  /** The occasion line was said in this visit (then idle lines). */
  private said = new Set<NpcId>();
  private boughtNow: { npc: NpcId; level: 1 | 2 } | null = null;
  private lastLine = '';
  readonly shown: HearthShown = { open: false, npcs: [], empty: 0, bubble: null, line: '', bought: 0, bestiary: 0, step: 'camp', maps: 0 };

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
    this.el.hidden = false; this.bubble = null; this.bestiary = false; this.step = 'camp'; this.start = null; this.said.clear();
    this.shown.open = true;
    this.host.sound?.('open');
    this.draw();
  }

  close(): void { this.el.hidden = true; this.shown.open = false; }

  private npcsHere(h: HearthState): NpcId[] { return (['owl', 'herb', 'smith'] as const).filter(id => id === 'owl' || h.met[id]); }

  draw(): void {
    const h = this.host.meta.hearth(), here = this.npcsHere(h);
    const places = HEARTH_PLACES.map((npc, i) => {
      const at = PLACE_AT[i], live = npc && here.includes(npc) ? npc : null;
      // An empty place: the background's stump or rug as it is (a dark log only without the background).
      if (!live) return `<div class="rt-hearth-place rt-hearth-empty" style="left:${at.x}px;top:${at.y}px" data-testid="hearth-empty-${i}">${EMPTY_SVG}</div>`;
      const fig = `<img class="rt-hearth-art" src="${artUrl(`characters/${NPC_ART[live]}.png`)}" alt="" style="height:${Math.round(150 * at.s)}px" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
        + `<span class="rt-hearth-sil-npc" hidden>${NPC_SVG[live]}</span>`;
      const quest = h.quest?.npc === live ? '<i class="rt-hearth-quest-mark" title="Задание">!</i>' : '';
      return `<button class="rt-hearth-place rt-hearth-npc${this.bubble === live ? ' rt-on' : ''}" style="left:${at.x}px;top:${at.y}px" data-action="npc" data-npc="${live}" data-testid="hearth-npc-${live}" title="${esc(NPCS[live].name)}">${fig}${quest}<span class="rt-hearth-name">${esc(NPCS[live].name)}</span></button>`;
    }).join('');
    this.shown.npcs = here; this.shown.empty = HEARTH_PLACES.length - here.length; this.shown.bubble = this.bubble; this.shown.step = this.step;
    const bar = xpBar(h.xp, h.thresholds);
    const next = h.nextPack ? `<div class="rt-hearth-next" data-testid="hearth-next" title="Следующий набор: ${esc(h.nextPack.title)}">${Array.from({ length: h.nextPack.size }, () => '<span class="rt-hearth-sil">?</span>').join('')}<small>${h.nextPack.at}</small></div>` : '';
    const record = h.record ? `<p class="rt-hearth-record" data-testid="hearth-record">Рекорд: ${esc(rowWord(h.record.row, h.record.won))}</p>` : '';
    const go = this.host.runActive() ? '<button class="rt-again rt-hearth-go" data-action="back" data-testid="hearth-back">К походу</button>' : '<button class="rt-again rt-hearth-go" data-action="go" data-testid="hearth-go">В поход</button>';
    const center = `<div class="rt-hearth-fire-wrap">${FIRE_SVG}</div><div class="rt-hearth-glow"></div><div class="rt-hearth-center"><div class="rt-hearth-bar" data-testid="hearth-bar" title="Опыт героя"><i style="width:${(bar.k * 100).toFixed(1)}%"></i><em>${h.xp}${bar.to !== null ? ` / ${bar.to}` : ''}</em></div>${next}${record}${go}</div>`;
    const head = `<header class="rt-hearth-head"><b>Очаг</b><span class="rt-hearth-stock" data-testid="hearth-stock" title="Запас лагеря">${ICON}<b>${h.stock}</b></span></header>`;
    this.el.innerHTML = head + `<div class="rt-hearth-stage">${center}${places}${this.bubbleHtml(h)}</div>${this.bestiaryHtml(h)}${this.startHtml()}`;
  }

  private bubbleHtml(h: HearthState): string {
    const npc = this.bubble;
    if (!npc) return '';
    const i = HEARTH_PLACES.indexOf(npc), at = PLACE_AT[i], right = at.x > 640;
    const level = h.levels[npc] ?? 0;
    const rows = NPCS[npc].upgrades.map((name, k) => {
      const lv = k + 1, price = HEARTH_PRICES[k];
      let action: string;
      if (lv >= HEARTH_LEVEL_LOCKED) action = `<span class="rt-hearth-lock" data-testid="up-${npc}-${lv}-lock" title="${esc(NPC_LINES[npc].locked3?.[0] ?? 'После гарнизона')}">🔒</span>`;
      else if (level >= lv) action = `<span class="rt-hearth-bought" data-testid="up-${npc}-${lv}-bought">✓ куплено</span>`;
      // Level 2 only after level 1: a grey price, no reason text (design 15.10.2026).
      else if (lv > level + 1) action = `<button class="rt-hearth-buy rt-hearth-later" disabled data-testid="up-${npc}-${lv}" data-later="true" title="Сначала — «${esc(NPCS[npc].upgrades[level])}»">${ICON}${price}</button>`;
      else if (h.stock < price) action = `<button class="rt-hearth-buy" disabled data-testid="up-${npc}-${lv}" data-lack="true">нужно ${price}, есть ${h.stock}</button>`;
      else action = `<button class="rt-hearth-buy" data-action="buy" data-npc="${npc}" data-level="${lv}" data-testid="up-${npc}-${lv}">${ICON}${price}</button>`;
      return `<li class="${level >= lv ? 'rt-done' : lv >= HEARTH_LEVEL_LOCKED ? 'rt-locked' : ''}"><div><b>${esc(name)}</b><small>${esc(NPCS[npc].rules[k])}</small></div>${action}</li>`;
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
    const rows = kinds.map(k => { const [name, line] = KIND_CAPTIONS[k].split(' — '); return `<li data-testid="beast-${k}"><b>${esc(name)}</b><span>${esc(line ?? '')}</span></li>`; }).join('');
    return `<div class="rt-overlay rt-hearth-modal" data-action="close" data-testid="hearth-bestiary-panel"><div class="rt-card rt-hearth-book-card"><h2>Бестиарий</h2>${rows ? `<ul class="rt-hearth-beasts">${rows}</ul>` : '<p class="rt-run-note">Пока пусто.</p>'}<button class="rt-other" data-action="close">Закрыть</button></div></div>`;
  }

  /** The start of a run: the maps to choose from, then the consumable's kind. */
  private startHtml(): string {
    const s = this.start?.plan;
    if (!s) return '';
    if (this.step === 'maps' && s.maps) {
      this.shown.maps = s.maps.length;
      // Each map as the run map draws it (its node icons), and its nodes counted by kind — a count that differs from another map lit.
      const counts = s.maps.map(mapCounts);
      const cards = s.maps.map((seed, i) => {
        const line = MAP_KINDS.map(k => { const n = counts[i][k.id] ?? 0, differs = counts.some((c, j) => j !== i && (c[k.id] ?? 0) !== n);
          return `<span class="${differs ? 'rt-mp-diff' : ''}" title="${esc(k.label)}">${k.icon} ${n}</span>`; }).join('');
        return `<button class="rt-hearth-map" data-action="map" data-seed="${seed}" data-index="${i}" data-testid="hearth-map-${i}">${mapPreview(seed)}<span class="rt-mp-counts">${line}</span><b>Путь ${i + 1}</b></button>`;
      }).join('');
      return `<div class="rt-overlay rt-hearth-modal" data-testid="hearth-maps"><div class="rt-card"><h2>${s.maps.length === 3 ? 'Три пути' : 'Два пути'}</h2><div class="rt-hearth-maps">${cards}</div></div></div>`;
    }
    if (this.step === 'items' && s.items) {
      const cards = s.items.map(kind => `<button class="rt-run-choice" data-action="item" data-item="${kind}" data-testid="hearth-item-${kind}"><b>${esc(ITEM_TITLES[kind])}</b></button>`).join('');
      return `<div class="rt-overlay rt-hearth-modal" data-testid="hearth-items"><div class="rt-card"><h2>Склянка в дорогу</h2><div class="rt-run-choices">${cards}</div></div></div>`;
    }
    return '';
  }

  private say(npc: NpcId, h: HearthState): void {
    const l = this.said.has(npc) ? undefined : h.last;
    // The quest's result belongs to the NPC who gave it (the camp's quest was that run's).
    const quest = l?.quest !== undefined && h.quest?.npc === npc;
    const bought = this.boughtNow?.npc === npc ? this.boughtNow.level : undefined;
    const line = pickLine(npc, {
      ...h.self?.[npc] ? { self: true } : {}, ...bought ? { bought } : {}, others: this.npcsHere(h),
      ...l ? { last: { won: l.won, ...l.firstWin ? { firstWin: true } : {}, ...l.cause ? { cause: l.cause as DeathCause } : {}, ...l.beaten ? { record: true } : {}, ...l.pack ? { pack: true } : {}, ...quest ? (l.quest ? { questDone: true } : { questFail: true }) : {} } } : {},
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
      if (result.ok) { this.shown.bought++; this.boughtNow = { npc, level: level === 2 ? 2 : 1 }; this.host.sound?.('buy'); this.host.bought?.(npc, level, HEARTH_PRICES[level - 1]); this.say(npc, this.host.meta.hearth()); }
      this.draw(); return;
    }
    if (action === 'bestiary') { this.bestiary = true; this.draw(); return; }
    if (action === 'close') { if (event.target === target || target.tagName === 'BUTTON') { this.bestiary = false; this.draw(); } return; }
    if (action === 'back') { this.close(); this.host.back(); return; }
    if (action === 'go') {
      // The base seed of the new run (as «Новый поход» draws it); core's plan for it — the maps (the base first), Марфа's kinds, the flags.
      const base = Math.floor(Math.random() * 0x100000000) >>> 0, plan = this.host.meta.start(base);
      this.start = { plan, base, seed: base, map: null };
      if (plan.maps && plan.maps.length > 1) { this.step = 'maps'; this.draw(); return; }
      if (plan.items && plan.items.length > 1) { this.step = 'items'; this.draw(); return; }
      this.go(plan.items?.[0] ?? null); return;
    }
    if (action === 'map' && this.start) {
      this.start.seed = Number(target.dataset.seed) >>> 0; this.start.map = Number(target.dataset.index);
      if (this.start.plan.items && this.start.plan.items.length > 1) { this.step = 'items'; this.draw(); return; }
      this.go(this.start.plan.items?.[0] ?? null); return;
    }
    if (action === 'item' && this.start) { this.go(target.dataset.item as ItemKind); return; }
  }

  private go(item: ItemKind | null): void {
    const s = this.start!;
    this.close();
    this.host.start(s.seed, item, s.plan, s.map);
  }
}

/** The kinds of nodes the map choice counts (the run map's icons, view/nodeTypes.ts); «Застава» is the checkpoint. */
const MAP_KINDS: readonly { id: string; icon: string; label: string }[] = [
  { id: 'battle', icon: RT_NODE_TYPES.battle.icon, label: 'Бои' }, { id: 'hard', icon: RT_NODE_TYPES.hard.icon, label: 'Трудные бои' },
  { id: 'event', icon: RT_NODE_TYPES.event.icon, label: 'События' }, { id: 'rest', icon: RT_NODE_TYPES.rest.icon, label: 'Привалы' },
  { id: 'shop', icon: RT_NODE_TYPES.shop.icon, label: 'Торговцы' }, { id: 'checkpoint', icon: RT_NODE_TYPES.checkpoint.icon, label: 'Заставы' },
];

/** A map's nodes counted by kind (a find counts as an event, as the map shows it). */
function mapCounts(seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of rtMapNodes(createRtRun(seed))) { const k = n.type === 'find' ? 'event' : n.type; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** A forest map by its seed as the run map draws it: the edges, the node circles with their icons (no stream is drawn for it). */
export function mapPreview(seed: number): string {
  const run = createRtRun(seed), nodes = rtMapNodes(run);
  const W = 1000, H = 520, pad = 40, x = (row: number) => pad + (row - 5) * (W - 2 * pad) / 9, y = (slot: number) => pad + slot * (H - 2 * pad);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = nodes.flatMap(n => n.next.map(id => { const m = byId.get(id); return m ? `<line x1="${x(n.row)}" y1="${y(n.slot ?? 0.5)}" x2="${x(m.row)}" y2="${y(m.slot ?? 0.5)}" class="rt-edge"/>` : ''; })).join('');
  const dots = nodes.map(n => `<g class="rt-node rt-mp-node${n.row === 5 ? ' rt-available' : ''}" transform="translate(${x(n.row)},${y(n.slot ?? 0.5)})"><circle r="27"/><text dy="10">${RT_NODE_TYPES[n.type].icon}</text></g>`).join('');
  return `<svg class="rt-run-map rt-hearth-mapsvg" viewBox="0 0 ${W} ${H}" aria-hidden="true">${edges}${dots}</svg>`;
}

/** For the end screen's pack names (re-export so the run screen reads one module). */
export { metaItemCard };
