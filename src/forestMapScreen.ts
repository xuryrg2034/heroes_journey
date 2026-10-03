/**
 * Screen of the forest map run (docs/biomes/forest-map.md): HTML builders only. The run model
 * (src/game/run/forestRun.ts) decides everything; this module reads forestRunView() and draws it.
 * main.ts owns the screen switching, saving and the battle hand-off.
 */
import { ITEMS } from './game/items';
import { summarizeDamageEffects } from './game/damageEffects';
import { RESOURCE_KINDS, RESOURCES } from './game/resources';
import type { AbilityKind, ItemKind } from './game/forestTypes';
import { nodeBattleTemplate, forestRowPalette, hasVictoryFind, nodeRefillPalette, type ForestMapNode, type ForestNodeType } from './game/run/forestMap';
import { eventView, forestRunMap, forestRunView, runNode, type ForestNodeStatus, type ForestRunEvent, type ForestRunState, type ForestRunView } from './game/run/forestRun';
import { forestEvent } from './game/run/forestEvents';
import { forestBattle } from './game/run/forestBattles';
import { battlePoolEntry, laneBranches, MAIN_ENEMY_NAMES, poolCandidates, type PoolBattleType } from './game/run/battlePools';

export const NODE_TYPE_INFO: Record<ForestNodeType, { icon: string; label: string; hint: string }> = {
  battle: { icon: '⚔', label: 'Бой', hint: 'Обычный бой.' },
  hard: { icon: '☠', label: 'Трудный бой', hint: 'Тяжелее обычного боя.' },
  rest: { icon: '☾', label: 'Привал', hint: 'Лечение перед следующим боем.' },
  find: { icon: '◈', label: 'Находка', hint: 'Выбор одного предмета из трёх.' },
  event: { icon: '?', label: 'Событие', hint: 'Сцена с выбором, без боя: исходы видны заранее.' },
  breakthrough: { icon: '⇥', label: 'Прорыв', hint: 'Цель — дойти до выхода, а не победить всех.' },
  checkpoint: { icon: '▣', label: 'Контрольный бой', hint: 'Сюда сходятся обе тропы.' },
  boss: { icon: '♛', label: 'Босс', hint: 'Финал ветки.' },
};
const STATUS_LABEL: Record<ForestNodeStatus, string> = {
  visited: 'Пройден', current: 'Текущий', 'in-progress': 'В бою', available: 'Доступен', locked: 'Закрыт', lost: 'Поражение', skipped: 'Пройден раньше',
};
const ITEM_ICON: Record<ItemKind, string> = { frost: '❄', bomb: '✹', healing: '✚', fire: '♨' };
const ITEM_NAME: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const ABILITY_NAME: Record<AbilityKind, string> = { jump: 'Прыжок', spin: 'Круговой удар' };
const ABILITY_ICON: Record<AbilityKind, string> = { jump: '↗', spin: '↻' };
const ITEM_KEYS: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const MAP_COLUMNS = 3;

/** Lane captions: first row, last row, top of the caption (0–1) and its colour (0 beasts and den, 2 goblins and camp). */
type LaneTag = { text: string; from: number; to: number; top: number; column: 0 | 2 };
const AUTHORED_LANE_TAGS: LaneTag[] = [
  { text: 'Звериная тропа', from: 5, to: 7, top: 0, column: 0 },
  { text: 'Гоблинская засека', from: 5, to: 7, top: 2 / 3, column: 2 },
  { text: 'Логово зверей → Тролль', from: 10, to: 14, top: 0, column: 0 },
  { text: 'Лагерь гоблинов → Главарь', from: 10, to: 14, top: 2 / 3, column: 2 },
];
/** The generated map: trails in the middle three quarters, the den above and the camp below the middle line. */
const GENERATED_LANE_TAGS: LaneTag[] = [
  { text: 'Звериная тропа', from: 5, to: 8, top: 0.08, column: 0 },
  { text: 'Гоблинская засека', from: 5, to: 8, top: 0.86, column: 2 },
  { text: 'Логово зверей → Тролль', from: 10, to: 14, top: 0, column: 0 },
  { text: 'Лагерь гоблинов → Главарь', from: 10, to: 14, top: 0.5, column: 2 },
];
/** Vertical place of a node, 0–1: the generated map sets `slot`, the authored graph uses three lanes. */
const nodeY = (node: ForestMapNode) => node.slot ?? (node.column + 0.5) / MAP_COLUMNS;

const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const nodeName = (run: ForestRunState, id: string | null) => (id && runNode(run, id)?.name) || '';
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
  const view = forestRunView(run), node = nodeId ? view.nodes.find(entry => entry.node.id === nodeId)?.node : undefined;
  if (!node) {
    const pending = view.pending;
    const text = view.result?.outcome === 'defeat' ? 'Поход окончен поражением. Наведи на узел, чтобы вспомнить путь.'
      : view.result ? 'Поход завершён. Наведи на узел, чтобы вспомнить его.'
      : pending?.kind === 'battle' ? `Бой узла «${nodeName(run, pending.nodeId)}» не завершён. Начни его снова кнопкой выше.`
      : pending?.kind === 'find' ? 'Находка ждёт выбора предмета.'
      : pending?.kind === 'event' ? 'Событие ждёт выбора.'
      : view.available.length ? 'Выбери следующий узел: доступные подсвечены. Наведи на узел, чтобы увидеть тип и особенность поля.' : '';
    return `<p class="map-detail-idle">${text}</p>`;
  }
  const info = NODE_TYPE_INFO[node.type], content = node.content;
  const lines: string[] = [];
  if (node.feature) lines.push(`Особенность поля: <b>${escapeHtml(node.feature)}</b>`);
  const event = content.kind === 'event' ? forestEvent(content.eventId) : undefined;
  if (event) lines.push(`Событие «${escapeHtml(event.title)}»: ${event.options.map(option => escapeHtml(option.label)).join(', ')}`);
  // A generated node whose battle or event is not known yet: what its pool holds (the pick comes when it becomes available).
  if (content.kind === 'pool') lines.push(poolText(node));
  const main = content.kind === 'battle' ? battlePoolEntry(content.battleId)?.main : undefined;
  if (main && forestRunMap(run).kind === 'generated') lines.push(`Главный враг: ${MAIN_ENEMY_NAMES[main]}`);
  lines.push(content.kind === 'rest' ? `Лечит на ${content.heal} HP и снимает эффекты (параметр временный)`
    : content.kind === 'in-development' ? escapeHtml(content.planned)
    : info.hint);
  // Authored elites in the node's battle (elite.ts): HP ×2, +1 to their attacks, loot.
  const elites = nodeBattleTemplate(node)?.definition.enemies.filter(enemy => enemy.elite).length ?? 0;
  if (elites) lines.push(`Элита: <b>${elites === 1 ? 'один противник' : elites < 5 ? `${elites} противника` : `${elites} противников`}</b> — HP ×2, удар по коту +1, может оставить добычу`);
  if (hasVictoryFind(node)) lines.push('После победы — находка: выбор 1 из 3');
  const grants = grantText(node);
  if (grants) lines.push(`Открывает: <b>${grants}</b>`);
  const reward = rewardGrantText(node);
  if (reward) lines.push(`После победы открывает: <b>${reward}</b>`);
  const palette = nodeRefillPalette(node)?.filter(weight => weight > 0).length;
  if (palette) lines.push(`Цветов в пополнении: ${palette}`);
  else if (content.kind === 'pool' && node.type !== 'event') lines.push(`Цветов в пополнении: не меньше ${forestRowPalette(node.row).length}`);
  if (node.placeholder) lines.push(`Пока стоит временный бой. Будет: ${escapeHtml(node.placeholder.planned.toLowerCase())}`);
  const tags = [
    `<span class="map-tag">${info.label}</span>`,
    node.placeholder ? '<span class="map-tag temp">временно</span>' : '',
    content.kind === 'in-development' ? '<span class="map-tag dev">в разработке</span>' : '',
  ].join('');
  return `<p class="map-detail-head"><span class="map-detail-icon" aria-hidden="true">${info.icon}</span><b>${escapeHtml(node.name)}</b>${tags}<span class="map-detail-status">${nodeStatusLabel(view, node)}</span></p><p class="map-detail-lines">${lines.join(' · ')}</p>`;
}

/** What the pool of a generated node holds before its battle or event is known. */
function poolText(node: ForestMapNode): string {
  if (node.type === 'event') return 'Событие из ещё не встреченных в этом походе';
  const ids = poolCandidates({ row: node.row, type: node.type as PoolBattleType, lane: node.lane });
  const where = laneBranches({ row: node.row, type: node.type as PoolBattleType, lane: node.lane });
  const label = where.length > 1 ? 'тропы' : { beasts: 'звери', goblins: 'гоблины', shared: 'общие', den: 'логово', camp: 'лагерь' }[where[0]] ?? '';
  return `Бой из пула (${label}): ${ids.length === 1 ? `«${escapeHtml(forestBattle(ids[0])?.name ?? ids[0])}»` : `${ids.length} на выбор, станет известен, когда узел откроется`}`;
}

function edgesHtml(view: ForestRunView, rows: number): string {
  const status = new Map(view.nodes.map(entry => [entry.node.id, entry.status]));
  const byId = new Map(view.nodes.map(entry => [entry.node.id, entry.node]));
  const at = (node: ForestMapNode) => `${node.row - 0.5},${nodeY(node) * MAP_COLUMNS}`;
  const lines = view.nodes.map(entry => entry.node).flatMap(from => from.next.map(id => {
    const to = byId.get(id)!;
    // A trunk cleared in an earlier run is drawn as walked; its exit leads to the first choice of this run.
    const done = ['visited', 'current', 'skipped'].includes(status.get(from.id) ?? '') && ['visited', 'current', 'skipped'].includes(status.get(id) ?? '');
    const open = ['current', 'skipped'].includes(status.get(from.id) ?? '') && status.get(id) === 'available';
    const [x1, y1] = at(from).split(','), [x2, y2] = at(to).split(',');
    return `<line class="map-edge ${done ? 'done' : open ? 'open' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }));
  return `<svg class="map-edges" viewBox="0 0 ${rows} ${MAP_COLUMNS}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
}

function nodeHtml(view: ForestRunView, node: ForestMapNode, status: ForestNodeStatus, rows: number): string {
  const info = NODE_TYPE_INFO[node.type];
  const reached = view.result?.outcome === 'boss-in-development' && view.result.nodeId === node.id;
  const label = reached ? 'Достигнут · в разработке' : STATUS_LABEL[status];
  const classes = ['map-node', `status-${status}`, `type-${node.type}`, `lane-${node.lane}`,
    node.placeholder ? 'placeholder' : '', node.content.kind === 'in-development' ? 'in-development' : '', reached ? 'reached' : ''].filter(Boolean).join(' ');
  const clickable = status === 'available';
  return `<button class="${classes}" data-action="map-node" data-node="${node.id}" data-status="${status}" style="left:${pct(node.row - 0.5, rows)};top:${pct(nodeY(node), 1)}" ${clickable ? '' : 'tabindex="-1"'} aria-disabled="${clickable ? 'false' : 'true'}" aria-label="${escapeHtml(`${node.name}. ${info.label}. ${label}`)}"><span class="map-node-icon" aria-hidden="true">${info.icon}</span><span class="map-node-name">${escapeHtml(node.name)}</span>${node.content.kind === 'in-development' ? '<span class="map-node-dev">в разработке</span>' : ''}</button>`;
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
  const view = forestRunView(run), generated = forestRunMap(run).kind === 'generated';
  const rows = Math.max(...view.nodes.map(entry => entry.node.row));
  const pending = view.pending;
  const banner = pending?.kind === 'battle'
    ? `<div class="map-banner"><span>Бой узла «${escapeHtml(nodeName(run, pending.nodeId))}» не завершён.</span><button class="button primary" data-action="run-battle">К БОЮ</button></div>`
    : pending?.kind === 'find'
      ? `<div class="map-banner"><span>Находка ждёт выбора предмета.</span><button class="button primary" data-action="run-find">ВЫБРАТЬ</button></div>`
      : pending?.kind === 'event'
        ? `<div class="map-banner"><span>Событие «${escapeHtml(nodeName(run, pending.nodeId))}» ждёт выбора.</span><button class="button primary" data-action="run-event">ВЫБРАТЬ</button></div>`
      : options.notice ? `<div class="map-banner notice" id="map-notice"><span>${escapeHtml(options.notice)}</span></div>` : '';
  const reset = options.confirmReset
    ? `<div class="map-confirm" role="alert"><span>Сбросить поход и начать заново?</span><button class="button secondary" data-action="run-reset-yes">СБРОСИТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset">НОВЫЙ ПОХОД</button>';
  const tags = (generated ? GENERATED_LANE_TAGS : AUTHORED_LANE_TAGS).map(tag => `<span class="map-lane-tag column-${tag.column}" style="left:${pct(tag.from - 1, rows)};width:${pct(tag.to - tag.from + 1, rows)};top:${pct(tag.top, 1)}">${tag.text}</span>`).join('');
  const legend = (Object.keys(NODE_TYPE_INFO) as ForestNodeType[]).map(type => `<span><i aria-hidden="true">${NODE_TYPE_INFO[type].icon}</i>${NODE_TYPE_INFO[type].label}</span>`).join('')
    + '<span class="legend-temp"><i aria-hidden="true">┄</i>временный бой</span>';
  return `<div class="map-top"><div class="map-title"><p class="eyebrow">ПОХОД ПО ЛЕСУ</p><h1>Карта леса</h1></div><div class="map-resources" aria-label="Ресурсы похода">${resourcesHtml(view)}</div><div class="map-actions"><button class="text-button" data-action="title">В МЕНЮ</button>${reset}</div></div>`
    + banner
    + `<div class="map-scroll"><div class="map-board${generated ? ' generated' : ''}" id="map-board" data-map="${generated ? 'generated' : 'authored'}" role="group" aria-label="Карта леса">${edgesHtml(view, rows)}${tags}${view.nodes.map(entry => nodeHtml(view, entry.node, entry.status, rows)).join('')}</div></div>`
    + `<div class="map-detail" id="map-detail" aria-live="polite">${nodeDetailHtml(run, null)}</div><div class="map-legend" aria-label="Обозначения">${legend}</div>`;
}

/**
 * Title card: start a new run or continue the saved one; reset asks for confirmation on the page. `trunkCleared`: the
 * player profile says a new run starts at the trail fork.
 */
export function runEntryHtml(saved: ForestRunState | null, confirmReset: boolean, trunkCleared = false): string {
  if (!saved) return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>ПОХОД ПО ЛЕСУ</span><small>${trunkCleared ? 'Новая карта · с развилки троп' : 'Новая карта · начало со ствола'}</small></button>`;
  const view = forestRunView(saved);
  const status = saved.result ? 'Итог похода' : `Пройдено боёв: ${view.battlesWon} · HP ${saved.resources.player.hp}/${saved.resources.player.maxHp}`;
  const reset = confirmReset
    ? `<div class="run-confirm" role="alert"><span>Стереть сохранённый поход?</span><button class="button secondary" data-action="run-reset-yes">СТЕРЕТЬ И НАЧАТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset" id="run-reset-button">НАЧАТЬ ЗАНОВО</button>';
  return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>${saved.result ? 'ИТОГ ПОХОДА' : 'ПРОДОЛЖИТЬ ПОХОД'}</span><small>${status}</small></button>${reset}`;
}

export function restModalHtml(run: ForestRunState, nodeId: string, healed: number, hp: number, maxHp: number, cleared = false): string {
  return `<p class="eyebrow">ПРИВАЛ</p><div class="outcome-symbol">${NODE_TYPE_INFO.rest.icon}</div><h2 id="modal-title">${escapeHtml(nodeName(run, nodeId))}</h2>`
    + `<p class="modal-copy" id="rest-copy">${healed > 0 ? `Вылечено: <b>${healed} HP</b>.` : 'Здоровье уже полное: лечить нечего.'} Сейчас <b>${hp} / ${maxHp}</b>.${cleared ? ' Эффекты на коте сняты.' : ''}</p><button class="button primary" data-action="resume">ДАЛЬШЕ</button>`;
}

export function findModalHtml(run: ForestRunState, nodeId: string, options: ItemKind[]): string {
  return `<p class="eyebrow">НАХОДКА</p><h2 id="modal-title">Одна вещь в дорогу</h2><p class="modal-copy">Возьми один предмет из трёх. Он откроется для следующих боёв.</p><div class="reward-options">${options.map(item => `<button class="reward-choice" data-find="${item}"><span class="reward-icon">${ITEM_ICON[item]}</span><span><b>${ITEMS[item].label} <em>+1</em></b><small>${ITEMS[item].description}</small></span></button>`).join('')}</div><p class="reward-note">${escapeHtml(nodeName(run, nodeId))}: остальные предметы останутся в лесу.</p>`;
}

/**
 * The open event (forestEvents.ts): title, a line of scene, one button per option with its outcomes (chance and both
 * results for a random one). An option that cannot be taken is disabled and says why.
 */
export function eventModalHtml(run: ForestRunState): string {
  const view = eventView(run);
  if (!view) return '';
  const options = view.options.map(option => {
    const outcomes = option.outcomes.length === 1 ? option.outcomes[0].text : option.outcomes.map(outcome => `${outcome.chance}%: ${outcome.text}`).join(' · ');
    return `<button class="event-choice" data-event-option="${option.id}"${option.available ? '' : ' disabled aria-disabled="true"'}><b>${escapeHtml(option.label)}</b><small>${escapeHtml(outcomes)}</small>${option.available ? '' : `<em class="event-reason">${escapeHtml(option.reason)}</em>`}</button>`;
  }).join('');
  return `<p class="eyebrow">СОБЫТИЕ</p><h2 id="modal-title">${escapeHtml(view.event.title)}</h2><p class="modal-copy event-scene">${escapeHtml(view.event.scene)}</p><div class="event-options">${options}</div>`;
}

/** What the chosen event option did; the next step is the map. */
export function eventResultHtml(run: ForestRunState, events: ForestRunEvent[]): string {
  const resolved = events.find(event => event.type === 'event-resolved');
  if (resolved?.type !== 'event-resolved') return '';
  const node = runNode(run, resolved.nodeId), event = node?.content.kind === 'event' ? forestEvent(node.content.eventId) : undefined;
  const option = event?.options.find(entry => entry.id === resolved.option);
  const { hp, maxHp, energy } = run.resources.player;
  return `<p class="eyebrow">СОБЫТИЕ</p><h2 id="modal-title">${escapeHtml(event?.title ?? nodeName(run, resolved.nodeId))}</h2><p class="modal-copy" id="event-result"><b>${escapeHtml(option?.label ?? resolved.option)}</b>: ${escapeHtml(resolved.text)}.</p><div class="result-stats"><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${energyText(energy)}</b>ЭНЕРГИЯ</span></div><button class="button primary" data-action="run-map">К КАРТЕ</button>`;
}

/**
 * Result of a won map-node battle: back to the map (or to the hard-battle find). A defeat in the run's battle ends the
 * run and shows runResultHtml instead; the defeat branch here is only for a node battle opened outside the saved run
 * (the debug hook `startNodeBattle`), which has no run to end.
 */
export function nodeBattleModalHtml(options: { won: boolean; name: string; turns: number; hp: number; maxHp: number; battlesWon: number; grants: string; find?: boolean; healed?: number }): string {
  const { won, name, turns, hp, maxHp, battlesWon, grants, find, healed } = options;
  const stats = `<div class="result-stats"><span><b>${turns}</b>ХОДЫ</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${battlesWon}</b>БОЁВ ПРОЙДЕНО</span></div>`;
  return won
    ? `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol">✦</div><h2 id="modal-title">Узел пройден</h2><p class="modal-copy">Здоровье, энергия и предметы уходят с тобой на карту.${grants ? ` Открыто: ${grants}.` : ''}${healed ? ` <b id="hard-heal">+${healed} HP за трудный бой.</b>` : ''}${find ? ' За победу — находка: выбери один предмет из трёх.' : ''}</p>${stats}${find ? '<button class="button primary" data-action="run-find">ВЫБРАТЬ НАХОДКУ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>' : '<button class="button primary" data-action="run-map">К КАРТЕ</button>'}`
    : `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol defeat">✕</div><h2 id="modal-title">Кот отступил</h2><p class="modal-copy">Бой открыт вне сохранённого похода. Повтор вернёт поле, здоровье и запас как на входе.</p>${stats}<button class="button primary" data-action="retry">ПОВТОРИТЬ БОЙ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>`;
}

/** End of the run: victory over a boss, a defeat, or the unfinished Troll branch (reported as such, not as a victory). */
export function runResultHtml(run: ForestRunState): string {
  const view = forestRunView(run), result = run.result;
  if (!result) return '';
  const { hp, maxHp } = run.resources.player;
  if (result.outcome === 'defeat') {
    // A defeat ends the run (decision of 04.10.2026): where it ended, how far it went, no way back into it.
    const lost = runNode(run, result.nodeId);
    const stats = `<div class="result-stats" id="run-defeat-stats"><span><b>${lost?.row ?? '—'}</b>РЯД</span><span><b>${view.battlesWon}</b>БОЁВ ВЫИГРАНО</span><span><b>${run.score}</b>ОЧКИ</span></div>`;
    return `<p class="eyebrow">ПОХОД ОКОНЧЕН</p><div class="outcome-symbol defeat">✕</div><h2 id="modal-title">Кот пал</h2><p class="modal-copy" id="run-result-copy">Поражение в узле «${escapeHtml(lost?.name ?? result.nodeId)}». Этот поход не продолжить: новый начнётся заново.</p>${stats}<button class="button primary" data-action="run-new">НОВЫЙ ПОХОД</button><button class="button secondary" data-action="title">В МЕНЮ</button>`;
  }
  const stats = `<div class="result-stats"><span><b>${view.battlesWon}</b>БОЁВ ПРОЙДЕНО</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${run.score}</b>ОЧКИ</span></div>`;
  const buttons = '<button class="button primary" data-action="run-new">НОВЫЙ ПОХОД</button><button class="button secondary" data-action="run-map">СМОТРЕТЬ КАРТУ</button><button class="text-button" data-action="title">В МЕНЮ</button>';
  // The boss of the chosen branch decides the ending text.
  const troll = result.outcome === 'victory' && runNode(run, result.nodeId)?.lane === 'den';
  const [title, copy] = troll ? ['Тролль повержен', 'Логово затихло, дорога к замку открыта.'] : ['Главарь повержен', 'Котелок вернулся, лес позади.'];
  return result.outcome === 'victory'
    ? `<p class="eyebrow">ПОХОД ЗАВЕРШЁН</p><div class="outcome-symbol">✦</div><h2 id="modal-title">${title}</h2><p class="modal-copy">${copy}</p>${stats}${buttons}`
    : `<p class="eyebrow">ВЕТКА ПОКА ОБРЫВАЕТСЯ</p><div class="outcome-symbol pending">…</div><h2 id="modal-title">Тролль — в разработке</h2><p class="modal-copy" id="run-result-copy">Путь через логово дошёл до босса, но боя с Троллём ещё нет. Это не победа: поход не завершён победой. Ветка Главаря уже играбельна в новом походе.</p>${stats}${buttons}`;
}
