/**
 * Screen of the forest map run (docs/biomes/forest-map.md): HTML builders only. The run model
 * (src/game/run/forestRun.ts) decides everything; this module reads forestRunView() and draws it.
 * main.ts owns the screen switching, saving and the battle hand-off.
 */
import { ITEMS } from './game/items';
import { summarizeDamageEffects } from './game/damageEffects';
import { CRAFT_COST, RESOURCE_KINDS, RESOURCES } from './game/resources';
import type { AbilityKind, ItemKind } from './game/forestTypes';
import { nodeBattleTemplate, forestRowPalette, victoryChoice, nodeRefillPalette, type ForestMapNode, type ForestNodeType } from './game/run/forestMap';
import { eventView, forestRunMap, forestRunScore, forestRunView, giftView, restHealValue, restView, runNode, shopView, type ForestNodeStatus, type ForestRunEvent, type ForestRunState, type ForestRunView, type ShopGoodView } from './game/run/forestRun';
import { SHOP_HARDEN_STEP, SHOP_HEAL_LIMIT } from './game/run/merchant';
import { LADDER_STEPS } from './game/ladder';
import { forestEvent } from './game/run/forestEvents';
import { barView, CATALOGUE_EVENTS, UNLOCK_LEVELS, UNLOCK_THRESHOLDS } from './game/run/unlocks';
import { forestBattle } from './game/run/forestBattles';
import { battlePoolEntry, laneBranches, MAIN_ENEMY_NAMES, poolCandidates, type PoolBattleType } from './game/run/battlePools';
import { isOath, talisman, type TalismanId } from './game/talismans';
import { BLANK_SCORE, type TalismanOption } from './game/run/talismanOffers';
import type { GiftOption, GiftPrice } from './game/run/runGift';

export const NODE_TYPE_INFO: Record<ForestNodeType, { icon: string; label: string; hint: string }> = {
  battle: { icon: '⚔', label: 'Бой', hint: 'Обычный бой.' },
  hard: { icon: '☠', label: 'Трудный бой', hint: 'Тяжелее обычного боя.' },
  rest: { icon: '☾', label: 'Привал', hint: 'Лечение или крафт перед следующим боем.' },
  find: { icon: '◈', label: 'Находка', hint: 'Выбор одного предмета из трёх.' },
  event: { icon: '?', label: 'Событие', hint: 'Сцена с выбором, без боя: исходы видны заранее.' },
  shop: { icon: '⚖', label: 'Торговец', hint: 'Товары за ресурсы крафта: расходники, талисман, лечение, закалка.' },
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

// ---------- Talismans and oaths (docs/talismans.md): temporary letter badges until the art is drawn ----------

/** Badge letter of each talisman: the first letter of its name (a distinct one where two would clash). */
export const TALISMAN_LETTER: Record<TalismanId, string> = {
  whetstone: 'Т', 'dew-flask': 'Ф', 'ragman-pouch': 'К', 'tough-hide': 'Ш', 'millstone-shard': 'Ж', hourglass: 'Ч', 'nimble-paws': 'Л', 'ash-ward': 'О',
  'oath-hunger': 'Г', 'oath-poverty': 'Б', 'oath-wrath': 'Я',
};
const RARITY_LABEL = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', oath: 'клятва' } as const;
/**
 * A row of talisman badges next to HP (map and battle): a round badge for a talisman, a square one for an oath; hover
 * or keyboard focus shows the name and the effect line. `wardWhole`: the Ash ward has not crumbled yet (a crumbled one
 * stays greyed). Empty without talismans.
 */
export function talismanBadgesHtml(ids: readonly TalismanId[], wardWhole: boolean): string {
  return ids.map(id => {
    const entry = talisman(id), spent = id === 'ash-ward' && !wardWhole;
    const label = `${entry.name}${spent ? ' (рассыпался)' : ''}: ${entry.effect}`;
    return `<span class="talisman-badge${isOath(id) ? ' oath' : ''}${spent ? ' spent' : ''}" tabindex="0" data-talisman-badge="${id}" aria-label="${escapeHtml(label)}"><span aria-hidden="true">${TALISMAN_LETTER[id]}</span>`
      + `<span class="talisman-tip" role="tooltip"><b>${escapeHtml(entry.name)}${spent ? ' · рассыпался' : ''}</b>${escapeHtml(entry.effect)}</span></span>`;
  }).join('');
}

/**
 * The open talisman or oath choice (docs/talismans.md): up to three options (the «пустышка» when the pool is empty) and
 * «Отказаться». Empty without one.
 */
export function talismanModalHtml(run: ForestRunState): string {
  const pending = run.pending;
  if (pending?.kind !== 'talisman') return '';
  const oath = pending.source === 'oath';
  const option = (id: TalismanOption) => {
    if (id === 'blank') return `<button class="reward-choice talisman-choice" data-talisman="blank"><span class="reward-icon talisman-icon" aria-hidden="true">·</span><span><b>Пустышка <em>+${BLANK_SCORE} очков</em></b><small>Пул талисманов пуст: только очки похода.</small></span></button>`;
    const entry = talisman(id);
    return `<button class="reward-choice talisman-choice" data-talisman="${id}"><span class="reward-icon talisman-icon${isOath(id) ? ' oath' : ''}" aria-hidden="true">${TALISMAN_LETTER[id]}</span><span><b>${escapeHtml(entry.name)} <em>${RARITY_LABEL[entry.rarity]}</em></b><small>${escapeHtml(entry.effect)}</small></span></button>`;
  };
  return `<p class="eyebrow">${oath ? 'КЛЯТВА' : 'ТАЛИСМАН'}</p><h2 id="modal-title">${oath ? 'Клятва за силу' : 'Талисман в дорогу'}</h2>`
    + `<p class="modal-copy">${oath ? 'Клятва даёт +1 энергию в начале каждого боя и отключает одну систему похода.' : 'Талисман действует до конца похода.'} Не взятые варианты в этом походе больше не выпадут.</p>`
    + `<div class="reward-options">${pending.options.map(option).join('')}</div><button class="button secondary" data-action="talisman-refuse">ОТКАЗАТЬСЯ</button>`
    + `<p class="reward-note">${escapeHtml(nodeName(run, pending.nodeId))}</p>`;
}

// ---------- The start gift (docs/roguelike-runs.md, 2а; runGift.ts) ----------

const GIFT_PRICE_TEXT: Record<GiftPrice, string> = { hp: '−1 HP сейчас (не ниже 1)', 'max-hp': '−1 к максимуму HP', rest: 'следующий привал не лечит' };
const itemList = (items: readonly ItemKind[]) => items.map(item => `${ITEM_ICON[item]} ${ITEM_NAME[item]}`).join(', ');
/**
 * Title, line and icon of a gift button. Consumables and resources a button gives are named (the run's rule: outcomes
 * are seen in advance); the talisman of the deal and the oath of the gamble stay hidden until taken.
 */
export function giftOptionText(option: GiftOption): { icon: string; title: string; text: string } {
  switch (option.kind) {
    case 'pick-item': return { icon: '◈', title: 'Выбрать 1 из 3 расходников', text: `${itemList(option.items)}. Взятый откроется для боёв похода.` };
    case 'items': return { icon: '◈', title: `${option.items.length} случайных расходника`, text: `${itemList(option.items)}. Откроются для боёв похода.` };
    case 'energy': return { icon: '⚡', title: `+${option.amount} энергии`, text: 'Энергия переносится между боями (не выше 7).' };
    case 'resources': return { icon: '⚒', title: `${option.resources.length} ресурса крафта`, text: `${option.resources.map(kind => RESOURCES[kind].label).join(', ')}. Для крафта на привале и торговца.` };
    case 'max-hp': return { icon: '♥', title: `+${option.amount} к максимуму HP`, text: `И +${option.amount} HP сразу.` };
    case 'calm': return { icon: '☾', title: 'Тихий лес', text: `В первых ${option.battles} боях до целей враги не злятся.` };
    case 'deal': return { icon: '◇', title: 'Талисман за цену',
      text: `${option.reward.kind === 'pick-talisman' ? 'Обычный талисман на выбор из 2' : 'Случайный необычный талисман'}. Цена: ${GIFT_PRICE_TEXT[option.price]}.` };
    case 'oath': return { icon: '▣', title: 'Азарт: случайная клятва', text: 'Клятва без выбора: +1 энергия в начале каждого боя, но одна система похода отключится.' };
  }
}
/**
 * The open start gift: the full gift's four buttons or the mini gift's two with the one-line hint; after a button with a
 * choice of its own — that choice (a consumable of three, a common talisman of two). The gift cannot be refused.
 */
export function giftModalHtml(run: ForestRunState): string {
  const view = giftView(run);
  if (!view) return '';
  if (view.chosen !== null) {
    const option = view.options[view.chosen].option, items = option.kind === 'pick-item';
    const picks = view.picks.map(id => {
      if (items) { const item = id as ItemKind; return `<button class="reward-choice" data-gift-pick="${item}"><span class="reward-icon" aria-hidden="true">${ITEM_ICON[item]}</span><span><b>${ITEMS[item].label} <em>+1</em></b><small>${ITEMS[item].description}</small></span></button>`; }
      const entry = talisman(id as TalismanId);
      return `<button class="reward-choice talisman-choice" data-gift-pick="${entry.id}"><span class="reward-icon talisman-icon" aria-hidden="true">${TALISMAN_LETTER[entry.id]}</span><span><b>${escapeHtml(entry.name)} <em>${RARITY_LABEL[entry.rarity]}</em></b><small>${escapeHtml(entry.effect)}</small></span></button>`;
    }).join('');
    return `<p class="eyebrow">ДАР У КОСТРА</p><h2 id="modal-title">${items ? 'Выбери расходник' : 'Выбери талисман'}</h2>`
      + `<p class="modal-copy">${items ? 'Взятый предмет откроется для боёв похода.' : `Цена уже уплачена: ${GIFT_PRICE_TEXT[(option as Extract<GiftOption, { kind: 'deal' }>).price]}. Не взятый талисман в этом походе больше не выпадет.`}</p>`
      + `<div class="reward-options gift-options" id="gift-picks">${picks}</div>`;
  }
  const buttons = view.options.map(({ index, option, available, reason }) => {
    const { icon, title, text } = giftOptionText(option);
    return `<button class="reward-choice gift-choice" data-gift="${index}" data-gift-kind="${option.kind}"${available ? '' : ' disabled aria-disabled="true"'}><span class="reward-icon" aria-hidden="true">${icon}</span>`
      + `<span><b>${escapeHtml(title)}</b><small>${escapeHtml(text)}</small>${available ? '' : `<em class="event-reason">${escapeHtml(reason)}</em>`}</span></button>`;
  }).join('');
  const hint = view.kind === 'mini' ? '<p class="gift-hint" id="gift-hint">Дойди до Тюремщика — у костра будет больше.</p>' : '';
  return `<p class="eyebrow">ДАР У КОСТРА</p><h2 id="modal-title">Дар в дорогу</h2><p class="modal-copy">Выбери один дар перед тропами. Отказаться нельзя.</p>`
    + `<div class="reward-options gift-options" id="gift-options" data-gift-size="${view.kind}">${buttons}</div>${hint}`;
}

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

/** The changes of «Ступени клятвы» 1…`step` (each step includes the ones below), one line each. */
export function ladderChangesHtml(step: number): string {
  return `<ol class="ladder-changes">${LADDER_STEPS.slice(1, step + 1).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>`;
}
/** Badge of the run's ladder step (map and result); empty on step 0. Hover or focus lists the changes. */
export function ladderBadgeHtml(step: number | undefined, id = 'map-ladder'): string {
  if (!step) return '';
  const changes = LADDER_STEPS.slice(1, step + 1).map((line, n) => `${n + 1}. ${line}`).join('\n');
  return `<span class="ladder-badge" id="${id}" tabindex="0" title="${escapeHtml(changes)}" aria-label="${escapeHtml(`Ступень клятвы ${step}. ${changes}`)}">Ступень ${step}</span>`;
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
      : pending?.kind === 'talisman' ? `${pending.source === 'oath' ? 'Клятва' : 'Талисман'} ждёт выбора.`
      : pending?.kind === 'event' ? 'Событие ждёт выбора.'
      : pending?.kind === 'rest' ? 'Привал ждёт выбора: лечение или крафт.'
      : pending?.kind === 'shop' ? 'Торговец ждёт: купи или уйди.'
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
  lines.push(content.kind === 'rest' ? `Выбор: лечение +${restHealValue(run, node)} HP и снятие эффектов или крафт (${CRAFT_COST} ресурса → предмет)`
    : content.kind === 'in-development' ? escapeHtml(content.planned)
    : info.hint);
  // Authored elites in the node's battle (elite.ts): HP ×2, +1 to their attacks, loot.
  const elites = nodeBattleTemplate(node)?.definition.enemies.filter(enemy => enemy.elite).length ?? 0;
  if (elites) lines.push(`Элита: <b>${elites === 1 ? 'один противник' : elites < 5 ? `${elites} противника` : `${elites} противников`}</b> — HP ×2, удар по коту +1, может оставить добычу`);
  const choice = victoryChoice(node);
  if (choice) lines.push(choice === 'hard' ? 'После победы — талисман: выбор 1 из 3 или отказ' : 'После победы — клятва: выбор 1 из 3 или отказ');
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
    // Crafting resources (elite loot, chests, events; resources.ts), spent on crafting at a rest.
    ...RESOURCE_KINDS.filter(resource => (materials?.[resource] ?? 0) > 0).map(resource => `<span class="map-chip resource" data-resource="${resource}" title="Ресурс крафта: из ${CRAFT_COST} — ${escapeHtml(ITEMS[RESOURCES[resource].crafts].label.toLowerCase())} на привале">${RESOURCES[resource].label} <b>×${materials![resource]}</b></span>`),
  ];
  const badges = talismanBadgesHtml(view.talismans, !view.wardSpent);
  return `<div class="map-res" id="map-hp"><span class="hud-label">ЗДОРОВЬЕ</span><div class="map-hearts" aria-label="Здоровье: ${player.hp} из ${player.maxHp}">${hearts}</div>${effectText ? `<small class="map-effects">${effectText}</small>` : ''}${badges ? `<div class="talisman-row" id="map-talismans" aria-label="Талисманы">${badges}</div>` : ''}</div>`
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
      : pending?.kind === 'talisman'
        ? `<div class="map-banner"><span>${pending.source === 'oath' ? 'Клятва' : 'Талисман'} ждёт выбора.</span><button class="button primary" data-action="run-talisman">ВЫБРАТЬ</button></div>`
      : pending?.kind === 'event'
        ? `<div class="map-banner"><span>Событие «${escapeHtml(nodeName(run, pending.nodeId))}» ждёт выбора.</span><button class="button primary" data-action="run-event">ВЫБРАТЬ</button></div>`
      : pending?.kind === 'rest'
        ? `<div class="map-banner"><span>Привал «${escapeHtml(nodeName(run, pending.nodeId))}» не завершён.</span><button class="button primary" data-action="run-rest">К ПРИВАЛУ</button></div>`
      : pending?.kind === 'shop'
        ? `<div class="map-banner"><span>Торговец ждёт.</span><button class="button primary" data-action="run-shop">К ТОРГОВЦУ</button></div>`
      : pending?.kind === 'gift'
        // A compact line (the gift window is usually open above it): the map keeps its first screen.
        ? `<div class="map-banner notice gift-banner"><span>Дар у костра ждёт выбора.</span><button class="text-button" data-action="run-gift">К КОСТРУ</button></div>`
      : options.notice ? `<div class="map-banner notice" id="map-notice"><span>${escapeHtml(options.notice)}</span></div>` : '';
  const reset = options.confirmReset
    ? `<div class="map-confirm" role="alert"><span>Сбросить поход и начать заново?</span><button class="button secondary" data-action="run-reset-yes">СБРОСИТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset">НОВЫЙ ПОХОД</button>';
  const tags = (generated ? GENERATED_LANE_TAGS : AUTHORED_LANE_TAGS).map(tag => `<span class="map-lane-tag column-${tag.column}" style="left:${pct(tag.from - 1, rows)};width:${pct(tag.to - tag.from + 1, rows)};top:${pct(tag.top, 1)}">${tag.text}</span>`).join('');
  const legend = (Object.keys(NODE_TYPE_INFO) as ForestNodeType[]).map(type => `<span><i aria-hidden="true">${NODE_TYPE_INFO[type].icon}</i>${NODE_TYPE_INFO[type].label}</span>`).join('')
    + '<span class="legend-temp"><i aria-hidden="true">┄</i>временный бой</span>';
  return `<div class="map-top"><div class="map-title"><p class="eyebrow">ПОХОД ПО ЛЕСУ</p><h1>Карта леса</h1>${ladderBadgeHtml(run.ladder)}</div><div class="map-resources" aria-label="Ресурсы похода">${resourcesHtml(view)}</div><div class="map-actions"><button class="text-button" data-action="title">В МЕНЮ</button>${reset}</div></div>`
    + banner
    + `<div class="map-scroll"><div class="map-board${generated ? ' generated' : ''}" id="map-board" data-map="${generated ? 'generated' : 'authored'}" role="group" aria-label="Карта леса">${edgesHtml(view, rows)}${tags}${view.nodes.map(entry => nodeHtml(view, entry.node, entry.status, rows)).join('')}</div></div>`
    + `<div class="map-detail" id="map-detail" aria-live="polite">${nodeDetailHtml(run, null)}</div><div class="map-legend" aria-label="Обозначения">${legend}</div>`;
}

/**
 * The ladder step a new run starts on (profile.ladder > 0 only): «−» and «+» within 0…open, the step, and the list of
 * its changes on request («Правки»). Empty while no step is open.
 */
export function ladderPickHtml(ladder: { open: number; chosen: number } | undefined): string {
  if (!ladder?.open) return '';
  const { open, chosen } = ladder;
  return `<div class="ladder-pick" id="ladder-pick"><span class="hud-label">СТУПЕНЬ КЛЯТВЫ</span><button class="icon-button" data-action="ladder-down" aria-label="Ступень ниже"${chosen <= 0 ? ' disabled' : ''}>−</button>`
    + `<b id="ladder-value">${chosen}</b><small>из ${open}</small><button class="icon-button" data-action="ladder-up" aria-label="Ступень выше"${chosen >= open ? ' disabled' : ''}>+</button>`
    + (chosen ? `<details class="ladder-details"><summary>Правки</summary>${ladderChangesHtml(chosen)}</details>` : '<small class="ladder-none">без правок</small>') + '</div>';
}

/**
 * Title card: start a new run or continue the saved one; reset asks for confirmation on the page. `trunkCleared`: the
 * player profile says a new run starts at the trail fork. `ladder`: the open and chosen step of a new run.
 */
export function runEntryHtml(saved: ForestRunState | null, confirmReset: boolean, trunkCleared = false, ladder?: { open: number; chosen: number }): string {
  const pick = ladderPickHtml(ladder);
  if (!saved) return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>ПОХОД ПО ЛЕСУ</span><small>${trunkCleared ? 'Новая карта · с развилки троп' : 'Новая карта · начало со ствола'}${ladder?.chosen ? ` · ступень ${ladder.chosen}` : ''}</small></button>${pick}`;
  const view = forestRunView(saved);
  const status = saved.result ? 'Итог похода' : `Пройдено боёв: ${view.battlesWon} · HP ${saved.resources.player.hp}/${saved.resources.player.maxHp}`;
  const reset = confirmReset
    ? `<div class="run-confirm" role="alert"><span>Стереть сохранённый поход?</span><button class="button secondary" data-action="run-reset-yes">СТЕРЕТЬ И НАЧАТЬ</button><button class="text-button" data-action="run-reset-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="run-reset" id="run-reset-button">НАЧАТЬ ЗАНОВО</button>';
  return `<button class="button primary run-start" id="run-start-button" data-action="run-start"><span>${saved.result ? 'ИТОГ ПОХОДА' : 'ПРОДОЛЖИТЬ ПОХОД'}</span><small>${status}${saved.ladder ? ` · ступень ${saved.ladder}` : ''}</small></button>${reset}${pick}`;
}

/**
 * The open rest (decision of 04.10.2026): two choices side by side. «Лечение» heals at once; «Крафт» lists the four
 * recipes with the stock of each resource, every press crafts one item while the resource lasts, and the first craft
 * takes the heal away. «К карте» leaves after crafting. Empty without an open rest.
 */
export function restModalHtml(run: ForestRunState): string {
  const view = restView(run);
  if (!view) return '';
  const { hp, maxHp } = run.resources.player, { heal } = view;
  const healText = heal.amount > 0 ? `+${heal.amount} HP` : heal.value > 0 ? 'Здоровье полное' : run.talismans?.includes('oath-hunger') ? 'Не лечит: Клятва голода' : 'Не лечит';
  const healBlock = `<section class="rest-option${heal.available ? '' : ' spent'}" id="rest-heal"><h3><span aria-hidden="true">${NODE_TYPE_INFO.rest.icon}</span> Лечение</h3>`
    + `<p class="rest-line"><b>${healText}</b> · сейчас ${hp} / ${maxHp}${heal.clearsEffects ? ' · снимет эффекты' : ''}</p>`
    + `<button class="button primary" data-action="rest-heal"${heal.available ? '' : ' disabled aria-disabled="true"'}>ЛЕЧИТЬСЯ</button>`
    + (heal.available ? '' : '<em class="event-reason">Выбран крафт</em>') + '</section>';
  const recipes = view.recipes.map(recipe => `<li class="rest-recipe${recipe.available ? '' : ' short'}" data-recipe="${recipe.resource}"><span class="rest-recipe-text">${RESOURCES[recipe.resource].label} <b class="rest-have">${recipe.have}</b>/${recipe.cost} → ${ITEM_ICON[recipe.item]} ${ITEM_NAME[recipe.item]}${recipe.opens ? ' <small class="rest-opens">откроет</small>' : ''}</span>`
    + `<button class="button secondary rest-craft" data-craft="${recipe.resource}"${recipe.available ? '' : ' disabled aria-disabled="true"'}>СОЗДАТЬ</button></li>`).join('');
  const counts = new Map<ItemKind, number>();
  for (const item of view.crafted) counts.set(item, (counts.get(item) ?? 0) + 1);
  const crafted = view.crafted.length ? `<p class="rest-line" id="rest-crafted">Создано: ${[...counts].map(([item, count]) => `${ITEM_ICON[item]} ${ITEM_NAME[item]} ×${count}`).join(', ')}</p>` : '';
  const craftBlock = `<section class="rest-option" id="rest-craft"><h3><span aria-hidden="true">⚒</span> Крафт</h3><ul class="rest-recipes">${recipes}</ul>${crafted}</section>`;
  const finish = view.canFinish ? '<button class="button primary" data-action="rest-finish">К КАРТЕ</button>' : '';
  return `<p class="eyebrow">ПРИВАЛ</p><h2 id="modal-title">${escapeHtml(nodeName(run, view.nodeId))}</h2><div class="rest-options">${healBlock}${craftBlock}</div>${finish}`;
}

/**
 * The open merchant (merchant.ts): the resources held, every good with its price (healing cut to the stock), why one
 * cannot be bought, and «Уйти». Every press buys one good; the stock does not restock. Empty without an open merchant.
 */
export function shopModalHtml(run: ForestRunState): string {
  const view = shopView(run);
  if (!view) return '';
  const describe = (good: ShopGoodView): [string, string, string] => {
    if (good.item) return [ITEM_ICON[good.item], `${escapeHtml(ITEMS[good.item].label)}${good.opens ? ' <small class="rest-opens">откроет</small>' : ''}`, escapeHtml(ITEMS[good.item].description)];
    if (good.talisman) {
      const entry = talisman(good.talisman);
      return [`<span class="talisman-icon${isOath(good.talisman) ? ' oath' : ''}">${TALISMAN_LETTER[good.talisman]}</span>`, `${escapeHtml(entry.name)} <em>${RARITY_LABEL[entry.rarity]}</em>`,
        `${escapeHtml(entry.effect)}. Не купишь — уйдёт из пула до конца похода.`];
    }
    if (good.good === 'heal') return ['✚', `Лечение +1 HP <em>${view.healed} / ${SHOP_HEAL_LIMIT}</em>`, `До ${SHOP_HEAL_LIMIT} HP за визит. Не хватает ресурсов — платишь сколько есть, без ресурсов — даром.`];
    return ['♥', `Закалка <em>за поход: ${view.hardenings}</em>`, `+1 к максимуму HP и +1 HP. Одна за визит; каждая следующая в походе дороже на ${SHOP_HARDEN_STEP}.`];
  };
  const goods = view.goods.map(good => {
    const [icon, title, text] = describe(good);
    const price = good.price === 0 ? 'ДАРОМ' : good.price < good.fullPrice ? `${good.price} <s>${good.fullPrice}</s>` : String(good.price);
    const button = good.sold ? 'КУПЛЕНО' : `КУПИТЬ · ${price}`;
    return `<li class="shop-good${good.available ? '' : ' short'}${good.sold ? ' sold' : ''}" data-good="${good.id}"><span class="reward-icon" aria-hidden="true">${icon}</span>`
      + `<span class="shop-good-text"><b>${title}</b><small>${text}</small>${good.available || good.sold ? '' : `<em class="event-reason">${escapeHtml(good.reason)}</em>`}</span>`
      + `<button class="button secondary shop-buy" data-shop-buy="${good.id}"${good.available ? '' : ' disabled aria-disabled="true"'}>${button}</button></li>`;
  }).join('');
  const kinds = RESOURCE_KINDS.filter(kind => view.materials[kind] > 0).map(kind => `${RESOURCES[kind].label} ${view.materials[kind]}`).join(', ');
  return `<p class="eyebrow">ТОРГОВЕЦ</p><h2 id="modal-title">${escapeHtml(nodeName(run, view.nodeId))}</h2>`
    + `<p class="modal-copy" id="shop-stock">Ресурсы: <b>${view.total}</b>${kinds ? ` (${kinds})` : ''}. Цена — в ресурсах любого вида: сначала уходят самые многочисленные.</p>`
    + `<ul class="shop-goods">${goods}</ul><button class="button primary" data-action="shop-leave">УЙТИ</button>`;
}

/** The rest after «Лечение»: HP healed and effects cleared; «Дальше» goes back to the map. */
export function restResultHtml(run: ForestRunState, nodeId: string, healed: number, cleared = false): string {
  const { hp, maxHp } = run.resources.player;
  return `<p class="eyebrow">ПРИВАЛ</p><div class="outcome-symbol">${NODE_TYPE_INFO.rest.icon}</div><h2 id="modal-title">${escapeHtml(nodeName(run, nodeId))}</h2>`
    + `<p class="modal-copy" id="rest-copy">${healed > 0 ? `Вылечено: <b>${healed} HP</b>.` : 'Здоровье не изменилось.'} Сейчас <b>${hp} / ${maxHp}</b>.${cleared ? ' Эффекты на коте сняты.' : ''}</p><button class="button primary" data-action="resume">ДАЛЬШЕ</button>`;
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
export function nodeBattleModalHtml(options: { won: boolean; name: string; turns: number; hp: number; maxHp: number; battlesWon: number; grants: string; find?: boolean; choice?: 'hard' | 'oath'; healed?: number; wardCrumbled?: boolean; gift?: boolean }): string {
  const { won, name, turns, hp, maxHp, battlesWon, grants, find, choice, healed, wardCrumbled, gift } = options;
  const choiceText = choice === 'oath' ? ' За победу — клятва: выбери одну из трёх или откажись.' : choice === 'hard' ? ' За победу — талисман: выбери один из трёх или откажись.' : '';
  const next = find ? '<button class="button primary" data-action="run-find">ВЫБРАТЬ НАХОДКУ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>'
    : choice ? `<button class="button primary" data-action="run-talisman">${choice === 'oath' ? 'ВЫБРАТЬ КЛЯТВУ' : 'ВЫБРАТЬ ТАЛИСМАН'}</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>`
    // The trunk's last battle: the start gift waits before the trails.
    : gift ? '<button class="button primary" data-action="run-gift">К КОСТРУ: ДАР</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>'
    : '<button class="button primary" data-action="run-map">К КАРТЕ</button>';
  const stats = `<div class="result-stats"><span><b>${turns}</b>ХОДЫ</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${battlesWon}</b>БОЁВ ПРОЙДЕНО</span></div>`;
  return won
    ? `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol">✦</div><h2 id="modal-title">Узел пройден</h2><p class="modal-copy">Здоровье, энергия и предметы уходят с тобой на карту.${grants ? ` Открыто: ${grants}.` : ''}${healed ? ` <b id="hard-heal">+${healed} HP за трудный бой.</b>` : ''}${wardCrumbled ? ' <b id="ward-crumbled">Пепельный оберег спас кота и рассыпался.</b>' : ''}${find ? ' За победу — находка: выбери один предмет из трёх.' : ''}${choiceText}</p>${stats}${next}`
    : `<p class="eyebrow">ПОХОД ПО ЛЕСУ · ${escapeHtml(name).toUpperCase()}</p><div class="outcome-symbol defeat">✕</div><h2 id="modal-title">Кот отступил</h2><p class="modal-copy">Бой открыт вне сохранённого похода. Повтор вернёт поле, здоровье и запас как на входе.</p>${stats}<button class="button primary" data-action="retry">ПОВТОРИТЬ БОЙ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>`;
}

// ---------- Score of the run and the bar of openings (docs/roguelike-runs.md, 7) ----------

/**
 * The score line by line (the step's bonus and the style bonuses apart) and the bar of openings as the profile took the
 * run: «текущее / порог» and the openings left. Without a tally (a save from before) only the score; a run with an
 * entered seed says that it does not move the bar.
 */
export function runScoreHtml(run: ForestRunState): string {
  const score = forestRunScore(run), tally = run.tally;
  const row = (label: string, points: number, kind = '') => `<span class="${kind}">${escapeHtml(label)}</span><b class="${kind}">${points > 0 ? '+' : ''}${points}</b>`;
  const lines = score.lines.map(line => row(line.label, line.points, line.id === 'ladder' ? 'score-ladder' : '')).join('')
    + score.styles.map(line => row(line.label, line.points, 'score-style')).join('');
  const table = `<div class="run-score" id="run-score">${lines || '<span>Очков нет</span><b>0</b>'}</div><p class="run-score-total"><span>Счёт похода</span> <b id="run-score-total">${score.total}</b></p>`;
  if (!tally) return run.seeded && run.result ? `${table}<p class="meta-note" id="meta-bar">Поход с заданным seed не двигает полосу открытий.</p>` : table;
  if (!tally.saved) return `${table}<p class="meta-note" id="meta-bar">Полоса открытий не сохраняется: хранилище браузера недоступно.</p>`;
  const { next, left } = barView(tally.after), from = tally.after.level ? UNLOCK_THRESHOLDS[tally.after.level - 1] : 0;
  const share = next === null ? 100 : Math.max(0, Math.min(100, (tally.after.points - from) / (next - from) * 100));
  return `${table}<div class="meta-bar" id="meta-bar"><div class="meta-track" aria-hidden="true"><i style="width:${share.toFixed(1)}%"></i></div>`
    + `<p>Полоса открытий: <b id="meta-points">${next === null ? tally.after.points : `${tally.after.points} / ${next}`}</b> · осталось открытий: <b id="meta-left">${left}</b></p></div>`;
}
/** The openings of a level of the bar: talismans and oaths with their effect line, events with theirs (one not in the game yet says so). */
export function unlockModalHtml(level: number): string {
  const set = UNLOCK_LEVELS[level - 1];
  if (!set) return '';
  const talismans = set.talismans.map(id => { const entry = talisman(id); return `<li class="unlock-item"><span class="talisman-icon${isOath(id) ? ' oath' : ''}" aria-hidden="true">${TALISMAN_LETTER[id]}</span><span><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.effect)}</small></span></li>`; });
  const events = set.events.map(id => {
    const entry = CATALOGUE_EVENTS[id], ready = !!forestEvent(id);
    return `<li class="unlock-item"><span class="reward-icon" aria-hidden="true">?</span><span><b>Событие «${escapeHtml(entry?.title ?? id)}»</b><small>${escapeHtml(entry?.line ?? '')}${ready ? '' : ' · появится в лесу позже'}</small></span></li>`;
  });
  return `<p class="eyebrow">ПОЛОСА ОТКРЫТИЙ · УРОВЕНЬ ${level}</p><h2 id="modal-title">Открыто</h2><p class="modal-copy">Теперь это может встретиться в походе.</p>`
    + `<ul class="unlock-list" id="unlock-list">${[...talismans, ...events].join('')}</ul><button class="button primary" data-action="run-result">К ИТОГУ</button>`;
}

/**
 * End of the run: victory over a boss, a defeat, or the unfinished Troll branch (reported as such, not as a victory).
 * `openedLadder`: the ladder step this victory opened in the profile (shown once, right after the victory).
 */
export function runResultHtml(run: ForestRunState, options: { openedLadder?: number | null } = {}): string {
  const view = forestRunView(run), result = run.result;
  if (!result) return '';
  const { hp, maxHp } = run.resources.player;
  const ladderStat = run.ladder ? `<span id="run-ladder"><b>${run.ladder}</b>СТУПЕНЬ</span>` : '';
  const opened = options.openedLadder ? `<p class="modal-copy ladder-opened" id="ladder-opened">Открыта ступень клятвы ${options.openedLadder}: ${escapeHtml(LADDER_STEPS[options.openedLadder].charAt(0).toLowerCase() + LADDER_STEPS[options.openedLadder].slice(1))}.</p>` : '';
  // The score and the bar; a new level opened by this run is shown on its own screen.
  const score = runScoreHtml(run), unlocks = run.tally?.opened ? `<button class="button primary" data-action="run-unlocks" id="run-unlocks">ОТКРЫТО: УРОВЕНЬ ${run.tally.opened}</button>` : '';
  if (result.outcome === 'defeat') {
    // A defeat ends the run (decision of 04.10.2026): where it ended, how far it went, no way back into it.
    const lost = runNode(run, result.nodeId);
    const stats = `<div class="result-stats" id="run-defeat-stats"><span><b>${lost?.row ?? '—'}</b>РЯД</span><span><b>${view.battlesWon}</b>БОЁВ ВЫИГРАНО</span><span><b>${run.score}</b>ОЧКИ</span>${ladderStat}</div>`;
    return `<p class="eyebrow">ПОХОД ОКОНЧЕН</p><div class="outcome-symbol defeat">✕</div><h2 id="modal-title">Кот пал</h2><p class="modal-copy" id="run-result-copy">Поражение в узле «${escapeHtml(lost?.name ?? result.nodeId)}». Этот поход не продолжить: новый начнётся заново.</p>${stats}${score}${unlocks}<div class="result-actions"><button class="button ${unlocks ? 'secondary' : 'primary'}" data-action="run-new">НОВЫЙ ПОХОД</button><button class="button secondary" data-action="title">В МЕНЮ</button></div>`;
  }
  const stats = `<div class="result-stats"><span><b>${view.battlesWon}</b>БОЁВ ПРОЙДЕНО</span><span><b>${hp}/${maxHp}</b>ЗДОРОВЬЕ</span><span><b>${run.score}</b>ОЧКИ</span>${ladderStat}</div>`;
  const buttons = `${unlocks}<div class="result-actions"><button class="button ${unlocks ? 'secondary' : 'primary'}" data-action="run-new">НОВЫЙ ПОХОД</button><button class="button secondary" data-action="run-map">СМОТРЕТЬ КАРТУ</button></div><button class="text-button" data-action="title">В МЕНЮ</button>`;
  // The boss of the chosen branch decides the ending text.
  const troll = result.outcome === 'victory' && runNode(run, result.nodeId)?.lane === 'den';
  const [title, copy] = troll ? ['Тролль повержен', 'Логово затихло, дорога к замку открыта.'] : ['Главарь повержен', 'Котелок вернулся, лес позади.'];
  return result.outcome === 'victory'
    ? `<p class="eyebrow">ПОХОД ЗАВЕРШЁН</p><div class="outcome-symbol">✦</div><h2 id="modal-title">${title}</h2><p class="modal-copy">${copy}</p>${opened}${stats}${score}${buttons}`
    : `<p class="eyebrow">ВЕТКА ПОКА ОБРЫВАЕТСЯ</p><div class="outcome-symbol pending">…</div><h2 id="modal-title">Тролль — в разработке</h2><p class="modal-copy" id="run-result-copy">Путь через логово дошёл до босса, но боя с Троллём ещё нет. Это не победа: поход не завершён победой. Ветка Главаря уже играбельна в новом походе.</p>${stats}${score}${buttons}`;
}
