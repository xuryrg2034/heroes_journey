/**
 * Map events (decision of 04.10.2026, docs/roguelike-runs.md, section 5a): a short scene with a choice of 2–3 options,
 * no battle. All event data lives here, declaratively; the run model (forestRun.ts) rolls and applies outcomes.
 *
 * Rules held by validateForestEvents:
 * - every option shows its outcomes in advance; a random option lists each outcome with its chance (percent, sum 100);
 * - an event always has a safe option (no outcome lowers anything);
 * - outcomes change only what the run already has: HP, energy, consumables (only opened ones) and crafting resources;
 * - an event never lowers HP below 1 (forestRun.ts clamps), and an energy loss is a cost the option must be able to pay.
 */
import type { ItemKind, ResourceKind } from '../forestTypes';
import { ITEM_KINDS } from '../items';
import { RESOURCES } from '../resources';

/** What one outcome changes. */
export interface EventEffect {
  /** HP change: never above the maximum, never below 1. */
  hp?: number;
  /** Energy change, 0–7. A loss is a cost: the option needs that much energy. */
  energy?: number;
  /** Consumables gained. Only opened ones: an option giving a closed item is unavailable. */
  items?: Partial<Record<ItemKind, number>>;
  /** Crafting resources gained; their kinds come from the run seed and the node id (shown in advance). */
  resources?: number;
}
export interface EventOutcome {
  /** Percent; the outcomes of an option sum to 100. One outcome of 100 is a sure thing. */
  chance: number;
  /** Short name of a random outcome (`ловушка`), shown before its changes. */
  label?: string;
  effect: EventEffect;
}
export interface EventOption { id: string; label: string; outcomes: EventOutcome[] }
export interface ForestEvent { id: string; title: string; scene: string; options: EventOption[] }

export const FOREST_EVENTS: Record<string, ForestEvent> = {
  brook: {
    id: 'brook', title: 'Ручей у камней',
    scene: 'Между мшистых камней бежит холодная вода. Времени хватит только на одно дело.',
    options: [
      { id: 'drink', label: 'Напиться', outcomes: [{ chance: 100, effect: { hp: 2 } }] },
      { id: 'flask', label: 'Наполнить флягу', outcomes: [{ chance: 100, effect: { items: { frost: 1 } } }] },
      { id: 'sharpen', label: 'Наточить топор', outcomes: [{ chance: 100, effect: { energy: 1 } }] },
    ],
  },
  'goblin-cache': {
    id: 'goblin-cache', title: 'Гоблинский тайник',
    scene: 'Под корнями — ящик гоблинов, крышка обмотана бечёвкой. Похоже на ловушку.',
    options: [
      { id: 'break', label: 'Взломать', outcomes: [
        { chance: 50, label: 'добыча', effect: { resources: 2 } },
        { chance: 50, label: 'ловушка', effect: { hp: -2 } },
      ] },
      { id: 'careful', label: 'Разобрать осторожно', outcomes: [{ chance: 100, effect: { energy: -1, resources: 1 } }] },
      { id: 'leave', label: 'Пройти мимо', outcomes: [{ chance: 100, effect: {} }] },
    ],
  },
};

export function forestEvent(id: string): ForestEvent | undefined { return FOREST_EVENTS[id]; }
export function eventOption(event: ForestEvent, optionId: string): EventOption | undefined { return event.options.find(option => option.id === optionId); }

/** Energy the option needs: its largest energy loss over the outcomes (0 — free). */
export const optionEnergyCost = (option: EventOption): number => Math.max(0, ...option.outcomes.map(outcome => -(outcome.effect.energy ?? 0)));
/** HP an option surely takes (every outcome loses HP): it needs the cat above 1 HP. A random loss is a risk, not a cost. */
export const optionHpCost = (option: EventOption): number => Math.min(...option.outcomes.map(outcome => Math.max(0, -(outcome.effect.hp ?? 0))));
const lowers = (effect: EventEffect) => (effect.hp ?? 0) < 0 || (effect.energy ?? 0) < 0;
/** A safe option: no outcome lowers anything. */
export const isSafeOption = (option: EventOption): boolean => option.outcomes.every(outcome => !lowers(outcome.effect));

const ITEM_NAME: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const resourceWord = (count: number) => count % 10 === 1 && count % 100 !== 11 ? 'ресурс' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'ресурса' : 'ресурсов';

/** Player-facing text of one outcome; `kinds` are the crafting resources it would give (decided by the seed). */
export function describeOutcome(outcome: EventOutcome, kinds: readonly ResourceKind[] = []): string {
  const { hp = 0, energy = 0, items = {}, resources = 0 } = outcome.effect, parts: string[] = [];
  if (hp > 0) parts.push(`+${hp} HP (не выше максимума)`);
  if (hp < 0) parts.push(`−${-hp} HP (не ниже 1)`);
  if (energy > 0) parts.push(`+${energy} энергия (не выше 7)`);
  if (energy < 0) parts.push(`−${-energy} энергия`);
  for (const item of ITEM_KINDS) if (items[item]) parts.push(`+${items[item]} «${ITEM_NAME[item]}»`);
  if (resources > 0) parts.push(`${resources} ${resourceWord(resources)} крафта${kinds.length ? `: ${kinds.map(kind => RESOURCES[kind].label).join(', ')}` : ''}`);
  const text = parts.join(', ') || 'ничего не меняется';
  return outcome.label ? `${outcome.label}, ${text}` : text;
}

/** Structural checks of the event data; an empty list means valid. */
export function validateForestEvents(events: Record<string, ForestEvent> = FOREST_EVENTS): string[] {
  const errors: string[] = [];
  for (const [key, event] of Object.entries(events)) {
    if (event.id !== key) errors.push(`${key}: id события не совпадает с ключом.`);
    if (event.options.length < 2 || event.options.length > 3) errors.push(`${key}: нужно 2–3 варианта.`);
    if (new Set(event.options.map(option => option.id)).size !== event.options.length) errors.push(`${key}: повторяющиеся id вариантов.`);
    if (!event.options.some(isSafeOption)) errors.push(`${key}: нет безопасного варианта.`);
    for (const option of event.options) {
      const sum = option.outcomes.reduce((total, outcome) => total + outcome.chance, 0);
      if (!option.outcomes.length || sum !== 100 || option.outcomes.some(outcome => !Number.isInteger(outcome.chance) || outcome.chance <= 0)) errors.push(`${key}/${option.id}: шансы — целые проценты с суммой 100.`);
      if (option.outcomes.length > 1 && option.outcomes.some(outcome => !outcome.label)) errors.push(`${key}/${option.id}: у случайного исхода нужна подпись.`);
      for (const { effect } of option.outcomes) {
        const keys = Object.keys(effect).filter(name => !['hp', 'energy', 'items', 'resources'].includes(name));
        if (keys.length) errors.push(`${key}/${option.id}: событие меняет только HP, энергию, расходники и ресурсы (${keys.join(', ')}).`);
        const numbers = [effect.hp ?? 0, effect.energy ?? 0, effect.resources ?? 0, ...Object.values(effect.items ?? {}).map(count => count ?? 0)];
        if (numbers.some(value => !Number.isInteger(value))) errors.push(`${key}/${option.id}: изменения — целые числа.`);
        if ((effect.resources ?? 0) < 0 || Object.values(effect.items ?? {}).some(count => (count ?? 0) < 0)) errors.push(`${key}/${option.id}: событие не отнимает предметы и ресурсы.`);
        if (Object.keys(effect.items ?? {}).some(item => !ITEM_KINDS.includes(item as ItemKind))) errors.push(`${key}/${option.id}: неизвестный расходник.`);
      }
    }
  }
  return errors;
}
