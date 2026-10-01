/**
 * Screen of the forest map run (docs/biomes/forest-map.md): HTML builders only. The run model
 * (src/game/run/forestRun.ts) decides everything; this module reads forestRunView() and draws it.
 * main.ts owns the screen switching, saving and the battle hand-off.
 */
import { ITEMS } from './game/items';
import { summarizeDamageEffects } from './game/damageEffects';
import { RESOURCE_KINDS, RESOURCES } from './game/resources';
import type { AbilityKind, ItemKind } from './game/forestTypes';
import { FOREST_MAP, forestNode, hasVictoryFind, nodeRefillPalette, type ForestMapNode, type ForestNodeType } from './game/run/forestMap';
import { forestRunView, type ForestNodeStatus, type ForestRunEvent, type ForestRunState, type ForestRunView } from './game/run/forestRun';

export const NODE_TYPE_INFO: Record<ForestNodeType, { icon: string; label: string; hint: string }> = {
  battle: { icon: '⚔', label: 'Бой', hint: 'Обычный бой.' },
  hard: { icon: '☠', label: 'Трудный бой', hint: 'Тяжелее обычного боя.' },
  rest: { icon: '☾', label: 'Привал', hint: 'Лечение перед следующим боем.' },
  find: { icon: '◈', label: 'Находка', hint: 'Выбор одного предмета из трёх.' },
  breakthrough: { icon: '⇥', label: 'Прорыв', hint: 'Цель — дойти до выхода, а не победить всех.' },
  checkpoint: { icon: '▣', label: 'Контрольный бой', hint: 'Сюда сходятся обе тропы.' },
  boss: { icon: '♛', label: 'Босс', hint: 'Финал ветки.' },
};
const STATUS_LABEL: Record<ForestNodeStatus, string> = {
  visited: 'Пройден', current: 'Текущий', 'in-progress': 'В бою', available: 'Доступен', locked: 'Закрыт',
};
const ITEM_ICON: Record<ItemKind, string> = { frost: '❄', bomb: '✹', healing: '✚', fire: '♨' };
const ITEM_NAME: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const ABILITY_NAME: Record<AbilityKind, string> = { jump: 'Прыжок', spin: 'Круговой удар' };
const ABILITY_ICON: Record<AbilityKind, string> = { jump: '↗', spin: '↻' };
const ITEM_KEYS: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const MAP_ROWS = Math.max(...FOREST_MAP.map(node => node.row));
const MAP_COLUMNS = 3;

/** Lane captions: first row, last row, map column (0 top, 2 bottom). */
const LANE_TAGS: { text: string; from: number; to: number; column: 0 | 2 }[] = [
  { text: 'Звериная тропа', from: 5, to: 7, column: 0 },
  { text: 'Гоблинская засека', from: 5, to: 7, column: 2 },
  { text: 'Логово зверей → Тролль', from: 10, to: 14, column: 0 },
  { text: 'Лагерь гоблинов → Главарь', from: 10, to: 14, column: 2 },
];

const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const nodeName = (id: string | null) => (id && forestNode(id)?.name) || '';
const pct = (value: number, total: number) => `${(value / total * 100).toFixed(3)}%`;

/** What entering the node opens for the rest of the run (its `grants`), or ''. */
export function grantText(node: ForestMapNode): string {
  const grants = node.grants;
  if (!grants) return '';
  const parts = [
    ...(grants.items ?? []).map(item => ITEM_NAME[item]),
    ...(grants.abilities ?? []).map(ability => ABILITY_NAME[ability]),
  ];
  const stock = Object.entries(grants.inventory ?? {}).filter(([, count]) => (count ?? 0) > 0).map(([item, count]) => `+${count} ${ITEM_NAME[item as ItemKind]}`);
  return [parts.join(', '), stock.join(', ')].filter(Boolean).join(' · ');
}

/** Names of the tools opened by `tools-unlocked` events of one step. */
export function unlockedText(events: ForestRunEvent[]): string {
  return events.flatMap(event => event.type === 'tools-unlocked' ? [...event.items.map(item => ITEM_NAME[item]), ...event.abilities.map(ability => ABILITY_NAME[ability])] : []).join(', ');
}
/** What victory in the node opens (its `rewardGrants`), or ''. */
export function rewardGrantText(node: ForestMapNode): string {
  const grants = node.rewardGrants;
  return grants ? [...(grants.items ?? []).map(item => ITEM_NAME[item]), ...(grants.abilities ?? []).map(ability => ABILITY_NAME[ability])].join(', ') : '';
}

export function nodeStatusLabel(view: ForestRunView, node: ForestMapNode): string {
  if (view.result?.outcome === 'boss-in-development' && view.result.nodeId === node.id) return 'Достигнут · в разработке';
  return STATUS_LABEL[view.nodes.find(entry => entry.node.id === node.id)?.status ?? 'locked'];
}

/** Hover / focus panel of one node: type, field feature, temporary and in-development marks. */
export function nodeDetailHtml(run: ForestRunState, nodeId: string | null): string {
  const view = forestRunView(run), node = nodeId ? forestNode(nodeId) : undefined;
  if (!node) {
    const pending = view.pending;
    const text = view.result ? 'Поход завершён. Наведи на узел, чтобы вспомнить его.'
      : pending?.kind === 'battle' ? `Бой узла «${nodeName(pending.nodeId)}» не завершён. Начни его снова кнопкой выше.`
      : pending?.kind === 'find' ? 'Находка ждёт выбора предмета.'
      : view.available.length ? 'Выбери следующий узел: доступные подсвечены. Наведи на узел, чтобы увидеть тип и особенность поля.' : '';
    return `<p class="map-detail-idle">${text}</p>`;
  }
  const info = NODE_TYPE_INFO[node.type], content = node.content;
  const lines: string[] = [];
  if (node.feature) lines.push(`Особенность поля: <b>${escapeHtml(node.feature)}</b>`);
  lines.push(content.kind === 'rest' ? `Лечит на ${content.heal} HP и снимает эффекты (параметр временный)`
    : content.kind === 'in-development' ? escapeHtml(content.planned)
    : info.hint);
  if (hasVictoryFind(node)) lines.push('После победы — находка: выбор 1 из 3');
  const grants = grantText(node);
  if (grants) lines.push(`Открывает: <b>${grants}</b>`);
  const reward = rewardGrantText(node);
  if (reward) lines.push(`После победы открывает: <b>${reward}</b>`);
  const palette = nodeRefillPalette(node)?.filter(weight => weight > 0).length;
  if (palette) lines.push(`Цветов в пополнении: ${palette}`);
  if (node.placeholder) lines.push(`Пока стоит временный бой. Будет: ${escapeHtml(node.placeholder.planned.toLowerCase())}`);
  const tags = [
    `<span class="map-tag">${info.label}</span>`,
    node.placeholder ? '<span class="map-tag temp">временно</span>' : '',
    content.kind === 'in-development' ? '<span class="map-tag dev">в разработке</span>' : '',
  ].join('');
  return `<p class="map-detail-head"><span class="map-detail-icon" aria-hidden="true">${info.icon}</span><b>${escapeHtml(node.name)}</b>${tags}<span class="map-detail-status">${nodeStatusLabel(view, node)}</span></p><p class="map-detail-lines">${lines.join(' · ')}</p>`;
}

function edgesHtml(view: ForestRunView): string {
  const status = new Map(view.nodes.map(entry => [entry.node.id, entry.status]));
  const at = (node: ForestMapNode) => `${node.row - 0.5},${node.column + 0.5}`;
  const lines = FOREST_MAP.flatMap(from => from.next.map(id => {
    const to = forestNode(id)!;
    const done = ['visited', 'current'].includes(status.get(from.id) ?? '') && ['visited', 'current'].includes(status.get(id) ?? '');
    const open = status.get(from.id) === 'current' && status.get(id) === 'available';
    const [x1, y1] = at(from).split(','), [x2, y2] = at(to).split(',');
    return `<line class="map-edge ${done ? 'done' : open ? 'open' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }));
  return `<svg class="map-edges" viewBox="0 0 ${MAP_ROWS} ${MAP_COLUMNS}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
}

function nodeHtml(view: ForestRunView, node: ForestMapNode, status: ForestNodeStatus): string {
  const info = NODE_TYPE_INFO[node.type];
  const reached = view.result?.outcome === 'boss-in-development' && view.result.nodeId === node.id;
  const label = reached ? 'Достигнут · в разработке' : STATUS_LABEL[status];
  const classes = ['map-node', `status-${status}`, `type-${node.type}`, `lane-${node.lane}`,
    node.placeholder ? 'placeholder' : '', node.content.kind === 'in-development' ? 'in-development' : '', reached ? 'reached' : ''].filter(Boolean).join(' ');
  const clickable = status === 'available';
  return `<button class="${classes}" data-action="map-node" data-node="${node.id}" data-status="${status}" style="left:${pct(node.row - 0.5, MAP_ROWS)};top:${pct(node.column + 0.5, MAP_COLUMNS)}" ${clickable ? '' : 'tabindex="-1"'} aria-disabled="${clickable ? 'false' : 'true'}" aria-label="${escapeHtml(`${node.name}. ${info.label}. ${label}`)}"><span class="map-node-icon" aria-hidden="true">${info.icon}</span><span class="map-node-name">${escapeHtml(node.name)}</span>${node.content.kind === 'in-development' ? '<span class="map-node-dev">в разработке</span>' : ''}</button>`;
}

function resourcesHtml(view: ForestRunView): string {
  const { player, inventory, materials } = view.resources, { tools } = view;
  const hearts = player.maxHp > 10 ? `<span class="health-numeric">${player.hp} / ${player.maxHp} ♥</span>`
    : Array.from({ length: player.maxHp }, (_, i) => `<span class="heart ${i < player.hp ? 'full' : 'empty'}" aria-hidden="true">♥</span>`).join('');
  const effects = summarizeDamageEffects(player.damageEffects);
  const effectText = [effects.burning ? `Горение ×${effects.burning}` : '', effects.poison ? `Яд ×${effects.poison}` : '', effects.bleeding ? `Кровотечение ×${effects.bleeding}` : ''].filter(Boolean).join(' · ');
  const chips = [
    ...ITEM_KEYS.filter(item => inventory[item] > 0 || tools.items.includes(item)).map(item => `<span class="map-chip${inventory[item] ? '' : ' empty'}" title="${escapeHtml(ITEMS[item].description)}">${ITEM_ICON[item]} ${ITEM_NAME[item]} <b>×${inventory[item]}</b></span>`),
    ...tools.abilities.map(ability => `<span class="map-chip ability">${ABILITY_ICON[ability]} ${ABILITY_NAME[ability]}</span>`),
    // Crafting resources from elite loot, kept for the future crafting at a rest (resources.ts).
    ...RESOURCE_KINDS.filter(resource => (materials?.[resource] ?? 0) > 0).map(resource => `<span class="map-chip resource" data-resource="${resource}" title="Ресурс на будущее: из двух — ${escapeHtml(ITEMS[RESOURCES[resource].crafts].label.toLowerCase())} на привале, когда появится крафт">${RESOURCES[resource].label} <b>×${materials![resource]}</b></span>`),
  ];
  return `<div class="map-res" id="map-hp"><span class="hud-label">ЗДОРОВЬЕ</span><div class="map-hearts" aria-label="Здоровье: ${player.hp} из ${player.maxHp}">${hearts}</div>${effectText ? `<small class="map-effects">${effectText}</small>` : ''}</div>`
    + `<div class="map-res" id="map-energy"><span class="hud-label">ЭНЕРГИЯ</span><strong>${energyText(player.energy)} / 7</strong></div>`
    + `<div class="map-res map-res-tools" id="map-tools"><span class="hud-label">ИНВЕНТАРЬ И ИНСТРУМЕНТЫ</span><div class="map-chips">${chips.join('') || '<span class="map-chip empty">пока закрыты</span>'}</div></div>`
    + `<div class="map-res" id="map-battles"><span class="hud-label">ПРОЙДЕНО БОЁВ</span><strong>${view.battlesWon}</strong></div>`;
}

export interface MapHtmlOptions { notice?: string; confirmReset?: boolean }

/** Whole map screen. Node clicks are `data-action="map-node"`, handled in main.ts. */
export function mapScreenHtml(run: ForestRunState, options: MapHtmlOptions = {}): string {
  const view = forestRunView(run);
  const pending = view.pending;
  const banner = pending?.kind === 'battle'
    ? `<div class="map-banner"><span>Бой узла «${escapeHtml(nodeName(pending.nodeId))}» не завершён${pending.defeats ? ` · поражений: ${pending.defeats}` : ''}.</span><button class="button primary" data-action="run-battle">${pending.defeats ? 'ПОВТОРИТЬ УЗЕЛ' : 'К БОЮ'}</button></div>`
    : pending?.kind === 'find'
      ? `<div class="map-banner"><span>Находка ждёт выбора предмета.</span><button class="button primary" data-action="run-find">ВЫБРАТЬ</button></div>`
      : options.notice ? `<div class="map-banner notice" id="map-notice"><span>${escapeHtml(options.notice)}</span></div>` : '';
  const reset = options.confirmReset
    ? `<div class="map-confirm" role="alert"><span>Сбросить поход и начать заново?</span><button class="button secondary" data-action="run-reset-yes">СБРОСИТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset">НОВЫЙ ПОХОД</button>';
  const tags = LANE_TAGS.map(tag => `<span class="map-lane-tag column-${tag.column}" style="left:${pct(tag.from - 1, MAP_ROWS)};width:${pct(tag.to - tag.from + 1, MAP_ROWS)};top:${pct(tag.column, MAP_COLUMNS)}">${tag.text}</span>`).join('');
  const legend = (Object.keys(NODE_TYPE_INFO) as ForestNodeType[]).map(type => `<span><i aria-hidden="true">${NODE_TYPE_INFO[type].icon}</i>${NODE_TYPE_INFO[type].label}</span>`).join('')
    + '<span class="legend-temp"><i aria-hidden="true">┄</i>временный бой</span>';
  return `<div class="map-top"><div class="map-title"><p class="eyebrow">ПОХОД ПО ЛЕСУ</p><h1>Карта леса</h1></div><div class="map-resources" aria-label="Ресурсы похода">${resourcesHtml(view)}</div><div class="map-actions"><button class="text-button" data-action="title">В МЕНЮ</button>${reset}</div></div>`
    + banner
    + `<div class="map-scroll"><div class="map-board" id="map-board" role="group" aria-label="Карта леса">${edgesHtml(view)}${tags}${view.nodes.map(entry => nodeHtml(view, entry.node, entry.status)).join('')}</div></div>`
    + `<div class="map-detail" id="map-detail" aria-live="polite">${nodeDetailHtml(run, null)}</div><div class="map-legend" aria-label="Обозначения">${legend}</div>`;
}

/** Title card: start a new run or continue the saved one; reset asks for confirmation on the page. */
export function runEntryHtml(saved: ForestRunState | null, confirmReset: boolean): string {
  if (!saved) return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>ПОХОД ПО ЛЕСУ</span><small>Карта узлов · 12–13 боёв</small></button>`;
  const view = forestRunView(saved);
  const status = saved.result ? 'Итог похода' : `Пройдено боёв: ${view.battlesWon} · HP ${saved.resources.player.hp}/${saved.resources.player.maxHp}`;
  const reset = confirmReset
    ? `<div class="run-confirm" role="alert"><span>Стереть сохранённый поход?</span><button class="button secondary" data-action="run-reset-yes">СТЕРЕТЬ И НАЧАТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset" id="run-reset-button">НАЧАТЬ ЗАНОВО</button>';
  return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>${saved.result ? 'ИТОГ ПОХОДА' : 'ПРОДОЛЖИТЬ ПОХОД'}</span><small>${status}</small></button>${reset}`;
}

export function restModalHtml(nodeId: string, healed: number, hp: number, maxHp: number, cleared = false): string {
  return `<p class="eyebrow">ПРИВАЛ</p><div class="outcome-symbol">${NODE_TYPE_INFO.rest.icon}</div><h2 id="modal-title">${escapeHtml(nodeName(nodeId))}</h2>`
    + `<p class="modal-copy" id="rest-copy">${healed > 0 ? `Вылечено: <b>${healed} HP</b>.` : 'Здоровье уже полное: лечить нечего.'} Сейчас <b>${hp} / ${maxHp}</b>.${cleared ? ' Эффекты на коте сняты.' : ''}</p><button class="button primary" data-action="resume">ДАЛЬШЕ</button>`;
}

export function findModalHtml(nodeId: string, options: ItemKind[]): string {
  return `<p class="eyebrow">НАХОДКА</p><h2 id="modal-title">Одна вещь в дорогу</h2><p class="modal-copy">Возьми один предмет из трёх. Он откроется для следующих боёв.</p><div class="reward-options">${options.map(item => `<button class="reward-choice" data-find="${item}"><span class="reward-icon">${ITEM_ICON[item]}</span><span><b>${ITEMS[item].label} <em>+1</em></b><small>${ITEMS[item].description}</small></span></button>`).join('')}</div><p class="reward-note">${escapeHtml(nodeName(nodeId))}: остальные предметы останутся в лесу.</p>`;
}

/** Result of a battle in a map node: victory goes back to the map, defeat retries the node. */
export function nodeBattleModalHtml(options: { won: boolean; name: string; turns: number; hp: number; maxHp: number; defeats: number; battlesWon: number; grants: string; find?: boolean; healed?: number }): string {
  const { won, name, turns, hp, maxHp, defeats, battlesWon, grants, find, healed } = options;
  const stats = `<div class="result-stats"><span><b>${turns}</b>ХОДЫ</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${battlesWon}</b>БОЁВ ПРОЙДЕНО</span></div>`;
  return won
    ? `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol">✦</div><h2 id="modal-title">Узел пройден</h2><p class="modal-copy">Здоровье, энергия и предметы уходят с тобой на карту.${grants ? ` Открыто: ${grants}.` : ''}${healed ? ` <b id="hard-heal">+${healed} HP за трудный бой.</b>` : ''}${find ? ' За победу — находка: выбери один предмет из трёх.' : ''}</p>${stats}${find ? '<button class="button primary" data-action="run-find">ВЫБРАТЬ НАХОДКУ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>' : '<button class="button primary" data-action="run-map">К КАРТЕ</button>'}`
    : `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol defeat">✕</div><h2 id="modal-title">Кот отступил</h2><p class="modal-copy">Поход продолжается: узел остаётся текущим, поражений в нём — ${defeats}. Повтор вернёт поле, здоровье и запас как на входе.</p>${stats}<button class="button primary" data-action="retry">ПОВТОРИТЬ УЗЕЛ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>`;
}

/** End of the run. The unfinished Troll branch is reported as such, not as a victory. */
export function runResultHtml(run: ForestRunState): string {
  const view = forestRunView(run), result = run.result;
  if (!result) return '';
  const { hp, maxHp } = run.resources.player;
  const stats = `<div class="result-stats"><span><b>${view.battlesWon}</b>БОЁВ ПРОЙДЕНО</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span></div>`;
  const buttons = '<button class="button primary" data-action="run-new">НОВЫЙ ПОХОД</button><button class="button secondary" data-action="run-map">СМОТРЕТЬ КАРТУ</button><button class="text-button" data-action="title">В МЕНЮ</button>';
  // The boss of the chosen branch decides the ending text.
  const troll = result.outcome === 'victory' && result.nodeId === 'den-troll';
  const [title, copy] = troll ? ['Тролль повержен', 'Логово затихло, дорога к замку открыта.'] : ['Главарь повержен', 'Котелок вернулся, лес позади.'];
  return result.outcome === 'victory'
    ? `<p class="eyebrow">ПОХОД ЗАВЕРШЁН</p><div class="outcome-symbol">✦</div><h2 id="modal-title">${title}</h2><p class="modal-copy">${copy}</p>${stats}${buttons}`
    : `<p class="eyebrow">ВЕТКА ПОКА ОБРЫВАЕТСЯ</p><div class="outcome-symbol pending">…</div><h2 id="modal-title">Тролль — в разработке</h2><p class="modal-copy" id="run-result-copy">Путь через логово дошёл до босса, но боя с Троллём ещё нет. Это не победа: поход не завершён победой. Ветка Главаря уже играбельна в новом походе.</p>${stats}${buttons}`;
}
