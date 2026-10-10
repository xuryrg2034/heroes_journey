/**
 * Screen of the real-time run (stage 2 of the transition, step 1; docs/realtime-slice.md): the map, the node screens
 * (rest, find, event, merchant, gift) and the end of the run. The run model is src/realtime/run/rtRun.ts; this module
 * only draws it, turns clicks into its commands, saves every step under the real-time keys and hands battle nodes to
 * the arena (main.ts, `RunHost.startArena`).
 *
 * The turn-based map screen (src/forestMapScreen.ts) builds its HTML from the turn-based run state and its CSS lives in
 * the turn-based stylesheet, so the real-time game has its own small copy here. The node icons and labels are its own
 * table (nodeTypes.ts) equal to the turn-based ones (checked by rtRun.spec.ts), so this page does not load that screen.
 */
import { FOREST_HARD_HEAL, FOREST_REST_HEAL, type ForestMapNode } from '../../game/run/forestMap';
import { ITEM_KINDS } from '../../game/items';
import { RESOURCE_KINDS, RESOURCES } from '../../game/resources';
import type { ResourceKind } from '../../game/forestTypes';
import type { GiftOption } from '../../game/run/runGift';
import { arenaTemplate } from '../sim/arenas';
import { arenaTitle, runRow } from '../run/arenaPools';
import { rosterTitle } from '../sim/rosters';
import { rtHp } from '../run/hpScale';
import {
  arenaPreview, createRtRun, isArenaNode, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtEnterNode,
  rtChooseTalisman, rtEventView, rtGiftView, rtMapNodes, rtNode, rtNodeStatus, rtNodeTitle, rtReachedJailer, rtRestCraft, rtRestFinish, rtRestHeal, rtRestView, rtShopBuy, rtShopLeave, rtShopView, rtItemHintDue,
  type RtArenaOutcome, type RtRunEvent, type RtRunState, type RtRunStep,
} from '../run/rtRun';
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind, type Loadout } from '../sim/kit';
import { GIFT_HP_PRICE, GIFT_MAX_HP_PRICE } from '../../game/run/runGift';
import { RT_RARITY_NAME, rtHammer, rtTalisman, rtTalismanText } from '../run/rtTalismans';
import { createRtProfileStore, createRtRunStore } from '../run/rtRunStorage';
import type { HeroStart } from '../sim/world';
import { RT_NODE_TYPES } from './nodeTypes';

/** What the run asks of the arena view. */
export interface RunHost {
  /**
   * Start the arena of the entered battle node (the run's HP, the node's seed, the run's consumables and energy; phase A —
   * its roster, absent for the template's own composition) and show it.
   */
  startArena(arena: string, seed: number, hero: HeroStart, label: string, loadout: Loadout, notice: ArenaItemNotice, roster?: string): void;
  /** The run screen covers the arena (true) or the arena is on screen (false). */
  onScreenChange(open: boolean): void;
  /**
   * Telemetry (docs/realtime-telemetry.md, track ТA): every step of the run that went through, with the state before it
   * (choices, nodes, the end); called before an arena it readies starts.
   */
  runStep?(before: RtRunState | null, step: Extract<RtRunStep, { ok: true }>): void;
  /** Telemetry: a new run starts; `previous` without a result is abandoned. */
  runStarted?(previous: RtRunState | null, run: RtRunState): void;
  /** Telemetry: the «Логи» panel (absent — no button). */
  openLogs?(): void;
}

/**
 * Iteration 2.1 (interface, docs/realtime-slice.md, section 12): what the arena's item panel shows at the start — the slots
 * of consumables gained since the last arena blink 1 s; the hint «Предметы: клавиши 1–4…» for 4 s (`rtItemHintDue`).
 */
export interface ArenaItemNotice { blink: ItemKind[]; hint: boolean }

/** «Холод (клавиша 1 в бою)»: a consumable with the key it is used with on the arena. */
export const itemWithKey = (item: ItemKind): string => `${ITEM_TITLES[item]} (клавиша ${SLOT_ITEMS.indexOf(item) + 1} в бою)`;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const STATUS_LABEL = { visited: 'Пройден', current: 'Текущий', open: 'Открыт', available: 'Доступен', locked: 'Закрыт', lost: 'Поражение' } as const;
/** Hints where the node works differently from the turn-based run. */
const STEP1_HINT: Partial<Record<ForestMapNode['type'], string>> = {
  find: 'Находка: один из трёх расходников.',
  rest: `Лечение +${rtHp(FOREST_REST_HEAL)} HP или крафт: 2 ресурса одного вида — расходник.`,
  shop: `Расходники, лечение и «Закалка» за ресурсы крафта.`,
  hard: `Трудный бой: арена «Застава». Победа: +${rtHp(FOREST_HARD_HEAL)} HP и талисман на выбор из трёх (один всегда редкий).`,
  checkpoint: 'Тюремщика-босса в срезе нет: обычная арена своего ряда. Победа: молот на выбор (первый ряд Тюремщика), затем клятва или реликвия.',
  breakthrough: 'Прорыв: обычная арена своего ряда.',
  battle: 'Обычный бой: арена пула своего ряда.',
  boss: 'Босса в срезе нет: финальная арена «Последний рубеж». Победа завершает поход.',
};

/**
 * Arena line of a battle node: its name and goal; phase A (Т2, design answer 13) — the roster in one line with its name
 * («Состав: Стая»), no list of kinds; none for an arena of its own composition.
 */
function arenaLine(arena: string, roster?: string): string {
  let summary = '';
  try { summary = arenaTemplate(arena).summary; } catch { /* unknown arena: name only */ }
  const line = roster !== undefined ? `<br><span class="rt-run-roster" data-testid="run-roster">Состав: ${escapeHtml(rosterTitle(arena, roster))}</span>` : '';
  return `<b>Арена «${escapeHtml(arenaTitle(arena))}»</b>${line}<br><small>${escapeHtml(summary)}</small>`;
}
const talismanName = (id: string): string => rtTalisman(id)?.name ?? id;
/**
 * Phase B: the lines of a talisman's card — a relic its plus and its price, each on a line of its own and as plain
 * (section 5: «цена видна так же явно, как плюс»); a talisman of a rarity — the rarity and the rule.
 */
function talismanCardLines(id: string): string {
  const def = rtTalisman(id);
  if (!def) return '';
  if (def.price) return `<small>Плюс: ${escapeHtml(def.effect)}</small><small class="rt-run-reason rt-run-price" data-testid="price-${id}">Цена: ${escapeHtml(def.price)}</small>`;
  const rarity = def.rarity === 'common' || def.rarity === 'uncommon' || def.rarity === 'rare' ? `${RT_RARITY_NAME[def.rarity]} · ` : '';
  return `<small>${escapeHtml(rarity + def.effect)}</small>`;
}

function giftText(option: GiftOption): string {
  switch (option.kind) {
    case 'resources': return `${option.resources.length} ресурса крафта: ${option.resources.map(kind => RESOURCES[kind].label).join(', ')}`;
    case 'max-hp': return `+${rtHp(option.amount)} к максимуму HP и +${rtHp(option.amount)} HP`;
    case 'pick-item': return `Выбрать 1 из 3 расходников: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'items': return `${option.items.length} расходника: ${option.items.map(item => ITEM_TITLES[item]).join(', ')}`;
    case 'energy': return `+${option.amount} энергии к началу первой арены`;
    case 'calm': return `Тихий лес: ${option.battles} боя без злости до целей`;
    case 'deal': {
      const price = option.price === 'hp' ? `−${rtHp(GIFT_HP_PRICE)} HP сейчас` : option.price === 'max-hp' ? `−${rtHp(GIFT_MAX_HP_PRICE)} к максимуму HP` : 'следующий привал не лечит';
      const reward = option.reward.kind === 'pick-talisman' ? `талисман на выбор: ${option.reward.talismans.map(talismanName).join(' или ')}` : `талисман «${option.reward.talisman ? talismanName(option.reward.talisman) : '—'}»`;
      return `${reward}; цена: ${price}`;
    }
    case 'oath': return `Клятва: «${option.oath ? talismanName(option.oath) : '—'}» — ${option.oath ? rtTalisman(option.oath)?.effect ?? '' : 'клятв не осталось'}`;
  }
}

export class RunView {
  readonly el: HTMLDivElement;
  private run: RtRunState | null;
  private readonly store = createRtRunStore();
  private readonly profile = createRtProfileStore();
  private selected: string | null = null;
  private notice = '';
  private confirmReset = false;
  /** The arena of the open battle node is on screen. */
  private inArena = false;

  constructor(private readonly host: RunHost, private readonly fixedSeed: number | null) {
    this.el = document.createElement('div');
    this.el.className = 'rt-run';
    this.el.setAttribute('data-testid', 'run');
    this.el.addEventListener('click', event => this.onClick(event));
    this.run = this.store.load();
  }

  get state(): RtRunState | null { return this.run; }
  get arenaOpen(): boolean { return this.inArena; }

  /** Shows the run screen: the map of the saved run, or the start of a new one. */
  open(): void {
    this.inArena = false;
    this.el.hidden = false;
    this.host.onScreenChange(true);
    this.draw();
  }

  /** A new run (a given seed — `?seed=` — makes it a seeded run). */
  newRun(seed?: number): RtRunState {
    const seeded = seed !== undefined || this.fixedSeed !== null;
    const value = (seed ?? this.fixedSeed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
    const previous = this.run;
    this.run = createRtRun(value, { gift: this.profile.giftKind(seeded), seeded });
    this.store.save(this.run);
    this.host.runStarted?.(previous, this.run);
    this.selected = null; this.notice = ''; this.confirmReset = false;
    this.open();
    return this.run;
  }

  /** Apply a run step: save it, note what happened, start an arena if one is ready, redraw. Returns the reason of a refusal. */
  apply(step: RtRunStep): string {
    if (!step.ok) { this.notice = step.reason; this.draw(); return step.reason; }
    const before = this.run;
    this.run = step.run;
    this.store.save(this.run);
    this.notice = this.describe(step.events);
    if (this.run.result && !before?.result) this.profile.endRun({ reachedJailer: rtReachedJailer(this.run), seeded: !!this.run.seeded });
    this.host.runStep?.(before, step);
    if (step.events.some(event => event.type === 'battle-ready')) this.enterArena();
    else this.draw();
    return '';
  }

  enter(nodeId: string): string { return this.run ? this.apply(rtEnterNode(this.run, nodeId)) : 'Нет похода.'; }

  /**
   * The arena of the open battle node is over: its outcome goes into the run and is saved at once (the frame the arena
   * ended in, main.ts) — a reload on the arena's result screen keeps the victory or the end of the run. The screen stays
   * on the arena until `leaveArena`.
   */
  recordArena(outcome: Omit<RtArenaOutcome, 'nodeId'>): string {
    const pending = this.run?.pending;
    if (!this.run || pending?.kind !== 'battle') return 'Нет открытого боя.';
    return this.apply(resolveArena(this.run, { ...outcome, nodeId: pending.nodeId }));
  }
  /** From the arena's result screen to the run screen: the map, or the end of the run. */
  leaveArena(): void { if (this.inArena) this.open(); }
  /** The run has ended (a lost arena, or the won final arena): the arena's result button leads to the end of the run. */
  get runOver(): boolean { return !!this.run?.result; }

  /** Start (or start again after a reload) the arena of the open battle node. */
  enterArena(): void {
    const pending = this.run?.pending;
    if (!this.run || pending?.kind !== 'battle') return;
    const node = rtNode(this.run, pending.nodeId)!;
    this.inArena = true;
    this.el.hidden = true;
    this.host.onScreenChange(false);
    const label = `${rtNodeTitle(this.run, node)} · ${arenaTitle(pending.arena)}`;
    this.host.startArena(pending.arena, pending.seed, { hp: this.run.hp, maxHp: this.run.maxHp }, label, rtArenaLoadout(this.run), { blink: [...this.run.itemsNew ?? []], hint: rtItemHintDue(this.run) }, pending.roster);
  }

  private describe(events: RtRunEvent[]): string {
    const parts: string[] = [];
    for (const event of events) {
      if (event.type === 'healed' && event.amount > 0) parts.push(`+${event.amount} HP`);
      if (event.type === 'event-resolved' || event.type === 'event-attempt') parts.push(event.text);
      if (event.type === 'shop-bought' && event.purchase.good === 'heal') parts.push(`Лечение +${rtHp(1)} HP`);
      if (event.type === 'shop-bought' && event.purchase.good === 'harden') parts.push(`Закалка: +${rtHp(1)} к максимуму HP`);
      if (event.type === 'talisman-taken') parts.push(`${rtTalisman(event.id)?.rarity === 'relic' ? 'Реликвия' : rtTalisman(event.id)?.rarity === 'oath' ? 'Клятва' : 'Талисман'} «${talismanName(event.id)}»`);
      if (event.type === 'hammer-taken') parts.push(`Молот «${rtHammer(event.id)?.name ?? event.id}»`);
      if (event.type === 'ward-crumbled') parts.push('Пепельный оберег рассыпался');
      if (event.type === 'items-gained') parts.push(`+ ${event.items.map(itemWithKey).join(', ')}${event.opened.length ? ` (открыт: ${event.opened.map(item => ITEM_TITLES[item]).join(', ')})` : ''}`);
    }
    return parts.join(' · ');
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-node]');
    if (!target) return;
    const run = this.run;
    if (target.dataset.node) { this.selected = target.dataset.node; this.notice = ''; this.draw(); return; }
    const action = target.dataset.action!;
    if (action === 'new-run') {
      if (run && !run.result && !this.confirmReset) { this.confirmReset = true; this.draw(); return; }
      this.newRun(); return;
    }
    if (action === 'cancel-reset') { this.confirmReset = false; this.draw(); return; }
    if (action === 'logs') { this.host.openLogs?.(); return; }
    if (!run) return;
    if (action === 'enter' && this.selected) { this.enter(this.selected); return; }
    if (action === 'battle') { this.enterArena(); return; }
    if (action === 'rest-heal') { this.apply(rtRestHeal(run)); return; }
    if (action === 'rest-craft') { this.apply(rtRestCraft(run, target.dataset.resource as ResourceKind)); return; }
    if (action === 'rest-finish') { this.apply(rtRestFinish(run)); return; }
    if (action === 'find') { this.apply(rtChooseFind(run, target.dataset.item as ItemKind)); return; }
    if (action === 'gift-pick') { this.apply(rtChooseGiftPick(run, target.dataset.pick!)); return; }
    if (action === 'talisman') { this.apply(rtChooseTalisman(run, target.dataset.option || null)); return; }
    if (action === 'hammer') { this.apply(rtChooseHammer(run, (target.dataset.option || null) as Parameters<typeof rtChooseHammer>[1])); return; }
    if (action === 'shop-leave') { this.apply(rtShopLeave(run)); return; }
    if (action === 'shop-buy') { this.apply(rtShopBuy(run, target.dataset.good!)); return; }
    if (action === 'event-option') { this.apply(rtChooseEventOption(run, target.dataset.option!)); return; }
    if (action === 'gift') { this.apply(rtChooseGift(run, target.dataset.index === 'skip' ? null : Number(target.dataset.index))); return; }
  }

  // ---------- Drawing ----------

  draw(): void {
    const run = this.run;
    if (!run) { this.el.innerHTML = this.startHtml(); return; }
    this.el.innerHTML = `${this.headerHtml(run)}<div class="rt-run-body">${this.mapHtml(run)}${this.detailHtml(run)}</div>${this.modalHtml(run)}`;
  }

  private startHtml(): string {
    return `<div class="rt-run-start rt-card"><h2>Поход</h2><p>Карта леса, арены в реальном времени, привалы, события и торговец. Поражение на арене заканчивает поход.</p>`
      + `<button class="rt-again" data-action="new-run" data-testid="run-new">Новый поход</button>`
      + `<p class="rt-run-note">Песочница арен прототипа с панелью отладки — <a href="#sandbox">realtime.html#sandbox</a>.</p></div>`;
  }

  private headerHtml(run: RtRunState): string {
    const resources = RESOURCE_KINDS.map(kind => `${RESOURCES[kind].label} ${run.materials[kind]}`).join(' · ');
    // Step 3: consumables carried between arenas and the energy banked for the next one.
    const items = ITEM_KINDS.map(kind => `${ITEM_TITLES[kind]} ${run.items[kind]}`).join(' · ');
    // Phase B: the hammer first (⚒), then the talismans; a relic is marked ◆ — the rule and the price in the tooltip (the
    // header is narrow: names only).
    const hammer = run.hammer ? rtHammer(run.hammer) : undefined;
    const talismans = [
      ...hammer ? [`<span data-testid="run-hammer-slot" title="Молот: ${escapeHtml(hammer.effect)}">⚒ ${escapeHtml(hammer.name)}</span>`] : [],
      ...run.talismans.map(id => `<span title="${escapeHtml(rtTalismanText(id))}"${rtTalisman(id)?.rarity === 'relic' ? ` data-testid="run-relic-${id}"` : ''}>${rtTalisman(id)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(id))}${id === 'ash-ward' && run.wardSpent ? ' (рассыпался)' : ''}</span>`),
    ].join(', ');
    const reset = this.confirmReset
      ? `<span class="rt-run-confirm">Бросить поход? <button data-action="new-run" data-testid="run-reset-confirm">Да, новый</button><button data-action="cancel-reset">Нет</button></span>`
      : `<button data-action="new-run" data-testid="run-reset">Новый поход</button>`;
    return `<header class="rt-run-head"><b>Поход</b><span class="rt-run-hp" data-testid="run-hp">HP ${run.hp} / ${run.maxHp}</span>`
      + `<span class="rt-run-items" data-testid="run-items">${items}</span>${talismans ? `<span class="rt-run-talismans" data-testid="run-talismans">${talismans}</span>` : ''}`
      + `${run.energy > 0 ? `<span class="rt-run-energy" data-testid="run-energy">⚡ ${run.energy} к арене</span>` : ''}`
      + `<span class="rt-run-res">${resources}</span><span class="rt-run-seed">seed ${run.seed}</span>${reset}${this.logsButton()}<a class="rt-run-sandbox" href="#sandbox">Песочница</a></header>`
      + (this.notice ? `<p class="rt-run-notice" data-testid="run-notice">${escapeHtml(this.notice)}</p>` : '');
  }

  /** Telemetry: the «Логи» button (the map's header, the end of the run); none without the panel. */
  private logsButton(testId = 'logs-open'): string {
    return this.host.openLogs ? `<button class="rt-logs-open" data-action="logs" data-testid="${testId}">Логи</button>` : '';
  }

  private mapHtml(run: RtRunState): string {
    const nodes = rtMapNodes(run), available = rtAvailableNodes(run);
    const W = 1000, H = 520, pad = 40, x = (node: ForestMapNode) => pad + (node.row - 5) * (W - 2 * pad) / 9, y = (node: ForestMapNode) => pad + (node.slot ?? 0.5) * (H - 2 * pad);
    const edges = nodes.flatMap(node => node.next.map(id => {
      const next = rtNode(run, id)!, walked = run.visited.includes(node.id) && (run.visited.includes(id) || rtNodeStatus(run, next, available) === 'open');
      return `<line x1="${x(node)}" y1="${y(node)}" x2="${x(next)}" y2="${y(next)}" class="${walked ? 'rt-edge rt-walked' : 'rt-edge'}"/>`;
    })).join('');
    const circles = nodes.map(node => {
      const status = rtNodeStatus(run, node, available), info = RT_NODE_TYPES[node.type], shown = node.type === 'event' && rtNodeTitle(run, node) === 'Находка' ? RT_NODE_TYPES.find : info;
      return `<g class="rt-node rt-${status}${this.selected === node.id ? ' rt-selected' : ''}" data-node="${node.id}" data-testid="node-${node.id}" data-status="${status}" data-type="${node.type}" transform="translate(${x(node)},${y(node)})">`
        + `<circle r="17"/><text dy="6">${shown.icon}</text><title>${escapeHtml(rtNodeTitle(run, node))}</title></g>`;
    }).join('');
    return `<svg class="rt-run-map" viewBox="0 0 ${W} ${H}" data-testid="run-map">${edges}${circles}</svg>`;
  }

  private detailHtml(run: RtRunState): string {
    const node = this.selected ? rtNode(run, this.selected) : undefined;
    const available = rtAvailableNodes(run);
    const hint = run.result ? '' : available.length ? 'Выбери узел на карте (подсвечены доступные).' : '';
    if (!node) return `<aside class="rt-run-detail"><p>${hint}</p></aside>`;
    const status = rtNodeStatus(run, node, available), info = RT_NODE_TYPES[node.type];
    const arena = isArenaNode(node) ? arenaPreview(run, node) : null;
    return `<aside class="rt-run-detail" data-testid="run-detail"><h3>${info.icon} ${escapeHtml(rtNodeTitle(run, node))}</h3>`
      + `<p class="rt-run-meta">${info.label} · ряд похода ${runRow(node.row)} · ${STATUS_LABEL[status]}</p>`
      + (arena ? `<p>${arenaLine(arena.arena, arena.roster)}</p>` : isArenaNode(node) && status === 'locked' ? '<p class="rt-run-note">Арена станет известна, когда узел откроется.</p>' : '')
      + (STEP1_HINT[node.type] ? `<p class="rt-run-hint">${escapeHtml(STEP1_HINT[node.type]!)}</p>` : '')
      + (status === 'available' ? `<button class="rt-again" data-action="enter" data-testid="run-enter">Идти</button>` : '')
      + `</aside>`;
  }

  private modalHtml(run: RtRunState): string {
    const card = (body: string, testId: string) => `<div class="rt-overlay rt-run-modal" data-testid="${testId}"><div class="rt-card">${body}</div></div>`;
    if (run.result) {
      const won = run.result.outcome === 'victory', kills = run.battles.reduce((sum, b) => sum + b.kills, 0), damage = run.battles.reduce((sum, b) => sum + b.damage, 0);
      return card(`<h2>${won ? 'Поход пройден' : 'Поход окончен'}</h2><dl class="rt-result-stats"><dt>Арен пройдено</dt><dd>${run.battles.filter(b => b.won).length}</dd>`
        + `<dt>Узлов</dt><dd>${run.visited.length}</dd><dt>Убито</dt><dd>${kills}</dd><dt>Получено урона</dt><dd>${damage}</dd><dt>Ряд похода</dt><dd>${runRow(rtNode(run, run.result.nodeId)!.row)}</dd></dl>`
        + `<button class="rt-again" data-action="new-run" data-testid="run-new">Новый поход</button>${this.logsButton('logs-open-result')}`, `run-result-${run.result.outcome}`);
    }
    const pending = run.pending;
    if (!pending) return '';
    if (pending.kind === 'battle') {
      if (this.inArena) return '';
      return card(`<h2>Бой</h2><p>${arenaLine(pending.arena, pending.roster)}</p><p class="rt-run-note">Начатая арена не сохраняется: после перезагрузки она начинается заново.</p>`
        + `<button class="rt-again" data-action="battle" data-testid="run-battle">В бой</button>`, 'run-battle-modal');
    }
    if (pending.kind === 'gift') {
      const view = rtGiftView(run)!;
      if (view.chosen !== null) {
        // The taken button has a choice of its own: a consumable of three.
        const picks = view.picks.map(pick => `<button class="rt-run-choice" data-action="gift-pick" data-pick="${pick}" data-testid="gift-pick-${pick}"><b>${escapeHtml(ITEM_TITLES[pick as ItemKind] ?? talismanName(pick))}</b>`
          + `${rtTalisman(pick) ? `<small>${escapeHtml(rtTalisman(pick)!.effect)}</small>` : ''}</button>`).join('');
        return card(`<h2>Дар в дорогу</h2><p>${escapeHtml(giftText(view.options[view.chosen].option))}: выбери один.</p><div class="rt-run-choices">${picks}</div>`, 'run-gift');
      }
      const buttons = view.options.map(entry => `<button class="rt-run-choice" data-action="gift" data-index="${entry.index}" data-testid="gift-${entry.index}" ${entry.available ? '' : 'disabled'}>`
        + `<b>${escapeHtml(giftText(entry.option))}</b>${entry.reason ? `<small>${escapeHtml(entry.reason)}</small>` : ''}</button>`).join('');
      return card(`<h2>Дар в дорогу</h2><p>${view.kind === 'full' ? 'Полный дар' : 'Малый дар'}: выбери одно. Кнопки без аналога в срезе выключены.</p><div class="rt-run-choices">${buttons}</div>`
        + (view.canSkip ? `<button class="rt-other" data-action="gift" data-index="skip" data-testid="gift-skip">Дальше без дара</button>` : ''), 'run-gift');
    }
    if (pending.kind === 'rest') {
      const view = rtRestView(run)!;
      const recipes = view.recipes.map(recipe => `<button class="rt-run-choice" data-action="rest-craft" data-resource="${recipe.resource}" data-testid="craft-${recipe.resource}" ${recipe.available ? '' : 'disabled'}>`
        + `<b>Крафт: ${escapeHtml(ITEM_TITLES[recipe.item])}</b><small>${recipe.cost} «${escapeHtml(RESOURCES[recipe.resource].label)}» (есть ${recipe.have})${recipe.opens ? ' · откроется в походе' : ''}</small></button>`).join('');
      return card(`<h2>Привал</h2><p>Лечение или крафт: первый рецепт отменяет лечение этого привала.${view.crafted.length ? ` Сделано: ${view.crafted.map(item => ITEM_TITLES[item]).join(', ')}.` : ''}</p>`
        + `<div class="rt-run-choices"><button class="rt-run-choice" data-action="rest-heal" data-testid="rest-heal" ${view.heal.available ? '' : 'disabled'}><b>Лечение +${view.heal.amount} HP</b>`
        + `<small>${!view.heal.available ? 'выбран крафт' : view.heal.amount < view.heal.value ? `не выше максимума (лечит до ${view.heal.value})` : `лечит до ${view.heal.value} HP`}</small></button>${recipes}</div>`
        + (view.canFinish ? `<button class="rt-other" data-action="rest-finish" data-testid="rest-finish">К карте</button>` : ''), 'run-rest');
    }
    if (pending.kind === 'hammer') {
      // Phase B (Т2): the Jailer's first screen — a hammer 3 of 4; one hammer a run, it acts on every later arena.
      const options = pending.options.map(id => `<button class="rt-run-choice" data-action="hammer" data-option="${id}" data-testid="hammer-${id}"><b>⚒ ${escapeHtml(rtHammer(id)?.name ?? id)}</b>`
        + `<small>${escapeHtml(rtHammer(id)?.effect ?? '')}</small></button>`).join('');
      return card(`<h2>Молот на выбор</h2><p>Молот меняет проход героя по цепи на всех следующих аренах. Один молот за поход. Затем — клятва или реликвия.</p>`
        + `<div class="rt-run-choices">${options}</div><button class="rt-other" data-action="hammer" data-option="" data-testid="hammer-refuse">Отказаться</button>`, 'run-hammer');
    }
    if (pending.kind === 'talisman') {
      const title = pending.source === 'oath' ? 'Клятва или реликвия' : 'Талисман';
      const options = pending.options.map(option => `<button class="rt-run-choice" data-action="talisman" data-option="${option}" data-testid="talisman-${option}"><b>${rtTalisman(option)?.rarity === 'relic' ? '◆ ' : ''}${escapeHtml(talismanName(option))}</b>${talismanCardLines(option)}</button>`).join('');
      const note = pending.source === 'oath' ? 'У клятвы и реликвии есть цена. Не взятые уходят из пула до конца похода.' : 'Не взятые уходят из пула до конца похода.';
      return card(`<h2>${title} на выбор</h2><p>${pending.options.length ? note : 'Талисманов не осталось.'}</p><div class="rt-run-choices">${options}</div>`
        + `<button class="rt-other" data-action="talisman" data-option="" data-testid="talisman-refuse">Отказаться</button>`, 'run-talisman');
    }
    if (pending.kind === 'find') {
      const options = pending.options.map(item => `<button class="rt-run-choice" data-action="find" data-item="${item}" data-testid="find-${item}"><b>${escapeHtml(ITEM_TITLES[item])}</b>`
        + `<small>${run.openItems.includes(item) ? `в запасе ${run.items[item]}` : 'откроется в походе'}</small></button>`).join('');
      return card(`<h2>Находка</h2><p>Возьми один расходник.</p><div class="rt-run-choices">${options}</div>`, 'run-find');
    }
    if (pending.kind === 'shop') {
      const view = rtShopView(run)!;
      const goods = view.goods.map(good => `<button class="rt-run-choice" data-action="shop-buy" data-good="${good.id}" data-testid="shop-${good.id}" ${good.available ? '' : 'disabled'}>`
        + `<b>${good.label} — ${good.price === 0 ? 'даром' : `${good.price} рес.`}</b><small>${escapeHtml(good.text)}${good.reason ? ` · ${escapeHtml(good.reason)}` : ''}</small></button>`).join('');
      return card(`<h2>Торговец</h2><p>Ресурсов: ${view.total}.</p><div class="rt-run-choices">${goods}</div>`
        + `<button class="rt-other" data-action="shop-leave" data-testid="shop-leave">Уйти</button>`, 'run-shop');
    }
    const view = rtEventView(run);
    if (!view) return '';
    const options = view.options.map(option => `<button class="rt-run-choice${option.off ? ' rt-off' : ''}" data-action="event-option" data-option="${option.id}" data-testid="event-${option.id}" ${option.available ? '' : 'disabled'}>`
      + `<b>${escapeHtml(option.label)}${option.cost ? ` <em>(${escapeHtml(option.cost)})</em>` : ''}${option.attempts ? ` <em>попытка ${Math.min(option.attempts.done + 1, option.attempts.max)} из ${option.attempts.max}</em>` : ''}</b>`
      + option.outcomes.map(outcome => `<small>${escapeHtml(outcome.odds)}: ${escapeHtml(outcome.text)}</small>`).join('')
      + (option.reason ? `<small class="rt-run-reason">${escapeHtml(option.reason)}</small>` : '') + `</button>`).join('');
    const attempts = view.attempts.length ? `<p class="rt-run-note">Попытки: ${view.attempts.map(escapeHtml).join('; ')}</p>` : '';
    return card(`<h2>${escapeHtml(view.event.title)}</h2><p>${escapeHtml(view.event.scene)}</p>${attempts}<div class="rt-run-choices">${options}</div>`, 'run-event');
  }
}
