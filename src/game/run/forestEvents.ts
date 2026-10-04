/**
 * Map events (catalogue of 14, agreed 04.10.2026: docs/events.md; frame: docs/roguelike-runs.md, section 5a): a short
 * scene with a choice of 2–3 options. All event data lives here, declaratively; the run model (forestRun.ts) rolls,
 * charges and applies the outcomes.
 *
 * An event names its branch of the map (trails, den, camp or common), the rows it stands on, the condition of its
 * appearance and its options. Its opening level is the bar of openings' (unlocks.ts, `eventUnlockLevel`).
 *
 * An option has
 * - a cost (`cost`): paid before the roll; one it cannot pay makes the option unavailable with a reason. Alternatives
 *   (a list) are tried in order and the first payable one is paid («1 трава или «Лечение»»);
 * - outcomes with chances in whole percent (sum 100; one of 100 is a sure thing), shown before the choice;
 * - an escalation (`escalation`): the option may be taken again, attempt k rolls the same outcomes with the chances
 *   escalation[k]; the event goes on until another option is taken;
 * - a reward battle (`battle`): a battle of the trails' pool; a victory gives the event's reward, a defeat ends the run.
 *
 * Rules held by validateForestEvents:
 * - an event always has a safe option: no cost, no HP loss, no battle — always available;
 * - an event never lowers HP below 1 (forestRun.ts clamps; a sure HP loss is a cost the cat must be able to pay);
 * - outcomes change only what the run already has: HP, maximum HP, energy, consumables (a given one opens for the
 *   run), crafting resources, a talisman of the run's pool, a modifier of the next map battle, the cat's effects.
 */
import type { ItemKind, ResourceKind } from '../forestTypes';
import { ITEM_KINDS } from '../items';
import { RESOURCE_KINDS, RESOURCES } from '../resources';
import { BATTLE_MODIFIERS, type BattleModifier } from '../talismans';
import { eventUnlockLevel } from './unlocks';

/** Branch of the map an event belongs to: the trails (rows 6–8), a second-half branch (rows 10–11), or both. */
export type EventBranch = 'trails' | 'den' | 'camp' | 'common';
/** Rows each branch allows (docs/events.md, section 3). */
export const EVENT_BRANCH_ROWS: Readonly<Record<EventBranch, readonly [number, number]>> = { trails: [6, 8], den: [10, 11], camp: [10, 11], common: [6, 11] };
/** A modifier of the next map battle an event may set (talismans.ts; the gift's `calm` is not an event's). */
export type EventModifier = Exclude<BattleModifier, 'calm'>;

/** What one outcome changes. */
export interface EventEffect {
  /** HP change: never above the maximum, never below 1. A loss here is a risk; a sure loss is a cost. */
  hp?: number;
  /** Gain of the maximum HP (+1 HP at once, as «Крепкая шкура»). A loss is a cost. */
  maxHp?: number;
  /** Energy gained, up to 7. A loss is a cost. */
  energy?: number;
  /** Consumables gained; a consumable not open in the run opens for its battles (as a find or a craft). */
  items?: Partial<Record<ItemKind, number>>;
  /** Crafting resources gained; their kinds come from the event's roll (shown in advance). */
  resources?: number;
  /** Crafting resources of a named kind gained. */
  materials?: Partial<Record<ResourceKind, number>>;
  /** A random talisman of this rarity from the run's pool without return (talismanOffers.ts: an empty rarity gives way). */
  talisman?: 'common' | 'uncommon';
  /** A modifier of the next map battle (one battle, talismans.ts). */
  modifier?: EventModifier;
  /** Burning, poison and bleeding are removed from the cat (as a rest). */
  clearEffects?: true;
}
/** What an option costs; paid before its roll. */
export interface EventCost {
  energy?: number;
  /** HP paid: the cat must keep at least 1. */
  hp?: number;
  /** Maximum HP paid: at least 1 stays; HP is cut to it. */
  maxHp?: number;
  /** Crafting resources of any kind: the most numerous first, as the merchant (merchant.ts, shopPayment). */
  resources?: number;
  /** Crafting resources of a named kind. */
  materials?: Partial<Record<ResourceKind, number>>;
  /** Consumables given away. */
  items?: Partial<Record<ItemKind, number>>;
}
export interface EventOutcome {
  /** Percent; the outcomes of an option sum to 100. One outcome of 100 is a sure thing. */
  chance: number;
  /** Short name of a random outcome (`ловушка`), shown before its changes. */
  label?: string;
  effect: EventEffect;
}
/** Reward battle of an option: a battle of the node's trail pool; a victory gives a common talisman of `talismanChoice`. */
export interface EventBattle { talismanChoice: number }
export interface EventOption {
  id: string;
  label: string;
  cost?: EventCost | readonly EventCost[];
  outcomes: EventOutcome[];
  /** Escalation: chances of the outcomes for attempt 1, 2, … (the first equals the outcomes' chances); attempts at most its length. */
  escalation?: readonly (readonly number[])[];
  battle?: EventBattle;
}
/** Condition of appearance: an event whose condition does not hold waits in the pool (StS). */
export interface EventRequirement { resources?: number }
export interface ForestEvent {
  id: string;
  title: string;
  scene: string;
  branch: EventBranch;
  /** First and last map row (inclusive). */
  rows: readonly [number, number];
  requires?: EventRequirement;
  options: EventOption[];
}

const sure = (effect: EventEffect): EventOutcome[] => [{ chance: 100, effect }];
const leave = (label = 'Уйти'): EventOption => ({ id: 'leave', label, outcomes: sure({}) });

export const FOREST_EVENTS: Record<string, ForestEvent> = {
  brook: {
    id: 'brook', title: 'Ручей у камней', branch: 'trails', rows: [6, 8],
    scene: 'Между мшистых камней бежит холодная вода. Времени хватит только на одно дело.',
    options: [
      { id: 'drink', label: 'Напиться', outcomes: sure({ hp: 2 }) },
      { id: 'flask', label: 'Наполнить флягу', outcomes: sure({ items: { frost: 1 } }) },
      { id: 'sharpen', label: 'Наточить топор', outcomes: sure({ energy: 1 }) },
    ],
  },
  'goblin-cache': {
    id: 'goblin-cache', title: 'Гоблинский тайник', branch: 'trails', rows: [6, 8],
    scene: 'Под корнями — ящик гоблинов, крышка обмотана бечёвкой. Похоже на ловушку.',
    options: [
      { id: 'break', label: 'Взломать', outcomes: [
        { chance: 50, label: 'добыча', effect: { resources: 2 } },
        { chance: 50, label: 'ловушка', effect: { hp: -2 } },
      ] },
      { id: 'careful', label: 'Разобрать осторожно', cost: { energy: 1 }, outcomes: sure({ resources: 1 }) },
      leave('Пройти мимо'),
    ],
  },
};

export function forestEvent(id: string): ForestEvent | undefined { return Object.hasOwn(FOREST_EVENTS, id) ? FOREST_EVENTS[id] : undefined; }
export function eventOption(event: ForestEvent, optionId: string): EventOption | undefined { return event.options.find(option => option.id === optionId); }
/** The cost alternatives of an option, in the order they are tried (empty — free). */
export const optionCosts = (option: EventOption): readonly EventCost[] => !option.cost ? [] : Array.isArray(option.cost) ? option.cost : [option.cost as EventCost];
/** The escalation option of an event (at most one), or undefined. */
export const escalationOption = (event: ForestEvent): EventOption | undefined => event.options.find(option => option.escalation);
/** The reward-battle option of an event (at most one), or undefined. */
export const battleOption = (event: ForestEvent): EventOption | undefined => event.options.find(option => option.battle);
/** Outcome chances of attempt `attempt` (0-based) of an option: its escalation row, or its own chances. */
export const attemptChances = (option: EventOption, attempt = 0): readonly number[] => option.escalation?.[attempt] ?? option.outcomes.map(outcome => outcome.chance);
/** Attempts an option allows: the escalation's length, else one. */
export const optionAttempts = (option: EventOption): number => option.escalation?.length ?? 1;
/** A safe option: no cost, no HP loss in any outcome, no battle — it can always be taken. */
export const isSafeOption = (option: EventOption): boolean => !optionCosts(option).length && !option.battle && option.outcomes.every(outcome => (outcome.effect.hp ?? 0) >= 0);
/** Every outcome of the option gives a talisman: it needs the pool to hold one. */
export const optionNeedsTalisman = (option: EventOption): boolean => option.outcomes.every(outcome => !!outcome.effect.talisman);
/** Whether the event may stand on a node of `row` and `lane` (the trail columns and the checkpoint are the trails). */
export function eventFits(event: ForestEvent, place: { row: number; lane: string }): boolean {
  if (place.row < event.rows[0] || place.row > event.rows[1]) return false;
  const branchLane = place.lane === 'den' || place.lane === 'camp';
  return event.branch === 'common' || (event.branch === 'trails' ? !branchLane : place.lane === event.branch);
}

export const ITEM_NAME: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огненная склянка' };
const resourceWord = (count: number) => count % 10 === 1 && count % 100 !== 11 ? 'ресурс' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'ресурса' : 'ресурсов';
const RARITY_NAME = { common: 'обычный', uncommon: 'необычный' } as const;

/** Player-facing text of one outcome; `kinds` are the crafting resources it would give (decided by the roll). */
export function describeOutcome(outcome: EventOutcome, kinds: readonly ResourceKind[] = []): string {
  const { hp = 0, maxHp = 0, energy = 0, items = {}, resources = 0, materials = {}, talisman, modifier, clearEffects } = outcome.effect, parts: string[] = [];
  if (clearEffects) parts.push('снять горение, яд и кровотечение');
  if (hp > 0) parts.push(`+${hp} HP (не выше максимума)`);
  if (hp < 0) parts.push(`−${-hp} HP (не ниже 1)`);
  if (maxHp > 0) parts.push(`+${maxHp} к максимуму HP`);
  if (energy > 0) parts.push(`+${energy} энергия (не выше 7)`);
  for (const item of ITEM_KINDS) if (items[item]) parts.push(`+${items[item]} «${ITEM_NAME[item]}»`);
  if (resources > 0) parts.push(`${resources} ${resourceWord(resources)} крафта${kinds.length ? `: ${kinds.map(kind => RESOURCES[kind].label).join(', ')}` : ''}`);
  for (const kind of RESOURCE_KINDS) if (materials[kind]) parts.push(`+${materials[kind]} «${RESOURCES[kind].label}»`);
  if (talisman) parts.push(`случайный ${RARITY_NAME[talisman]} талисман`);
  if (modifier) parts.push(`в следующем бою: ${BATTLE_MODIFIERS[modifier].charAt(0).toLowerCase()}${BATTLE_MODIFIERS[modifier].slice(1)}`);
  const text = parts.join(', ') || 'ничего не меняется';
  return outcome.label ? `${outcome.label}, ${text}` : text;
}
/** Player-facing text of one cost alternative (`−1 энергия`, `2 ресурса крафта`, `1 «Травы»`). */
export function describeCost(cost: EventCost): string {
  const parts: string[] = [];
  if (cost.energy) parts.push(`−${cost.energy} энергия`);
  if (cost.hp) parts.push(`−${cost.hp} HP`);
  if (cost.maxHp) parts.push(`−${cost.maxHp} к максимуму HP`);
  if (cost.resources) parts.push(`${cost.resources} ${resourceWord(cost.resources)} крафта (любых)`);
  for (const kind of RESOURCE_KINDS) if (cost.materials?.[kind]) parts.push(`${cost.materials[kind]} «${RESOURCES[kind].label}»`);
  for (const item of ITEM_KINDS) if (cost.items?.[item]) parts.push(`${cost.items[item]} «${ITEM_NAME[item]}»`);
  return parts.join(', ');
}

const EFFECT_KEYS = ['hp', 'maxHp', 'energy', 'items', 'resources', 'materials', 'talisman', 'modifier', 'clearEffects'];
const COST_KEYS = ['energy', 'hp', 'maxHp', 'resources', 'materials', 'items'];
const positiveCounts = (record: object | undefined, keys: readonly string[]) => Object.entries(record ?? {}).every(([key, count]) => keys.includes(key) && Number.isInteger(count) && (count as number) > 0);
const isModifier = (value: unknown): value is EventModifier => typeof value === 'string' && value !== 'calm' && Object.hasOwn(BATTLE_MODIFIERS, value);

/** Structural checks of the event data; an empty list means valid. */
export function validateForestEvents(events: Record<string, ForestEvent> = FOREST_EVENTS): string[] {
  const errors: string[] = [];
  for (const [key, event] of Object.entries(events)) {
    if (event.id !== key) errors.push(`${key}: id события не совпадает с ключом.`);
    const allowed = EVENT_BRANCH_ROWS[event.branch];
    if (!allowed) errors.push(`${key}: неизвестная ветка ${event.branch}.`);
    else if (!event.rows || !Number.isInteger(event.rows[0]) || !Number.isInteger(event.rows[1]) || event.rows[0] > event.rows[1] || event.rows[0] < allowed[0] || event.rows[1] > allowed[1]) errors.push(`${key}: ряды ${event.rows?.join('–')} вне рядов ветки ${allowed.join('–')}.`);
    if (eventUnlockLevel(key) === null) errors.push(`${key}: нет уровня открытия в полосе (unlocks.ts).`);
    if (event.requires && !positiveCounts(event.requires, ['resources'])) errors.push(`${key}: условие появления — только ресурсов ≥ N.`);
    if (event.options.length < 2 || event.options.length > 3) errors.push(`${key}: нужно 2–3 варианта.`);
    if (new Set(event.options.map(option => option.id)).size !== event.options.length) errors.push(`${key}: повторяющиеся id вариантов.`);
    if (!event.options.some(isSafeOption)) errors.push(`${key}: нет безопасного варианта.`);
    if (event.options.filter(option => option.escalation).length > 1) errors.push(`${key}: больше одной эскалации.`);
    if (event.options.filter(option => option.battle).length > 1) errors.push(`${key}: больше одного боя.`);
    for (const option of event.options) {
      const at = `${key}/${option.id}`, sum = option.outcomes.reduce((total, outcome) => total + outcome.chance, 0);
      if (!option.outcomes.length || sum !== 100 || option.outcomes.some(outcome => !Number.isInteger(outcome.chance) || outcome.chance <= 0)) errors.push(`${at}: шансы — целые проценты с суммой 100.`);
      if (option.outcomes.length > 1 && option.outcomes.some(outcome => !outcome.label)) errors.push(`${at}: у случайного исхода нужна подпись.`);
      for (const cost of optionCosts(option)) {
        if (!Object.keys(cost).length || Object.keys(cost).some(name => !COST_KEYS.includes(name))) errors.push(`${at}: цена — энергия, HP, максимум HP, ресурсы или расходники.`);
        if (['energy', 'hp', 'maxHp', 'resources'].some(name => cost[name as 'hp'] !== undefined && !(Number.isInteger(cost[name as 'hp']) && cost[name as 'hp']! > 0))
          || !positiveCounts(cost.materials, RESOURCE_KINDS) || !positiveCounts(cost.items, ITEM_KINDS)) errors.push(`${at}: цена — целые положительные числа известных видов.`);
      }
      if (option.escalation) {
        const rows = option.escalation;
        if (!rows.length || rows.some(row => row.length !== option.outcomes.length || row.reduce((a, b) => a + b, 0) !== 100 || row.some(chance => !Number.isInteger(chance) || chance < 0))) errors.push(`${at}: шансы каждой попытки — целые проценты исходов с суммой 100.`);
        else if (rows[0].some((chance, n) => chance !== option.outcomes[n].chance)) errors.push(`${at}: первая попытка — шансы исходов.`);
        if (option.cost || option.battle) errors.push(`${at}: эскалация без цены и без боя.`);
      }
      if (option.battle && (!(Number.isInteger(option.battle.talismanChoice) && option.battle.talismanChoice > 0) || option.cost || option.outcomes.length !== 1 || Object.keys(option.outcomes[0].effect).length)) errors.push(`${at}: бой за награду — без цены и других исходов, награда — выбор из N талисманов.`);
      for (const { effect } of option.outcomes) {
        const keys = Object.keys(effect).filter(name => !EFFECT_KEYS.includes(name));
        if (keys.length) errors.push(`${at}: событие меняет только HP, максимум HP, энергию, расходники, ресурсы, талисман, модификатор боя и эффекты кота (${keys.join(', ')}).`);
        if ([effect.hp ?? 0, effect.maxHp ?? 0, effect.energy ?? 0, effect.resources ?? 0].some(value => !Number.isInteger(value))) errors.push(`${at}: изменения — целые числа.`);
        if ((effect.maxHp ?? 0) < 0 || (effect.energy ?? 0) < 0) errors.push(`${at}: потеря энергии или максимума HP — это цена варианта, а не исход.`);
        if ((effect.resources ?? 0) < 0 || !positiveCounts(effect.items, ITEM_KINDS) || !positiveCounts(effect.materials, RESOURCE_KINDS)) errors.push(`${at}: событие не отнимает предметы и ресурсы исходом (это цена).`);
        if (effect.talisman !== undefined && effect.talisman !== 'common' && effect.talisman !== 'uncommon') errors.push(`${at}: талисман — обычный или необычный.`);
        if (effect.modifier !== undefined && !isModifier(effect.modifier)) errors.push(`${at}: неизвестный модификатор боя ${effect.modifier}.`);
        if (effect.clearEffects !== undefined && effect.clearEffects !== true) errors.push(`${at}: clearEffects — только true.`);
      }
    }
  }
  return errors;
}
