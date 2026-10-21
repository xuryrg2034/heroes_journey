/**
 * Talismans of the real-time run (stage 2 of the transition, step 3; docs/realtime-slice.md, section 8). The talismans of
 * the turn-based game (src/realtime/forest/talismans.ts) carried over «by number» where real time has their rule, plus «Якорь у
 * героя» (decision 3 of the transition: the hero anchor of the prototype as a rare talisman). Where a turn-based talisman
 * has no analogue in real time it is not offered at all (`RT_TALISMANS_OFF`): nothing is invented — a question to design.
 *
 * Offers follow the turn-based rules (talismanOffers.ts, merchant.ts): a hard battle offers three by the rarity roll
 * 50/33/17%, an empty rarity gives way to the next one (nothing left — fewer options, no «пустышка»); the merchant one
 * talisman by the rarity roll. All of them run here over the slice's list (same algorithm, own salts).
 *
 * Phase B (docs/realtime-phase-b.md, sections 3–5 and 8, track Д4): the catalogue holds the counter talismans (Т1) and the
 * relics (Т3, rarity `relic`); the hammers (Т2) are a catalogue of their own. Sources (design answers 1–5): one place of a
 * hard-battle offer is always rare; the Jailer's row offers a hammer 3 of 4 (`rtHammerOffer`, by the node's roll) and then
 * an oath or a relic 1 of 3; the gift and events draw by their own real-time draws (`rtTalismanDraw`) whose chain stops at
 * the uncommon ones — rare talismans come only from a hard battle and the merchant. One value of the run's stream per
 * source, as before: the streams do not move.
 */
import { mixSeed } from '../forest/items';
import { COUNTER_TALISMANS as CT, FORM_FIELD, FORMS as FM, FROST_PASS, FUSIONS as FU, FUSION_RECIPES, HAMMERS as HM, HAMMER_IDS as HAMMER_LIST, RELICS as RL, type FormField, type HammerId as Hammer } from '../sim/buildIds';
import { rarityOfRoll, type TalismanPool } from '../forest/talismanOffers';
import { isTalismanId, TALISMANS, type TalismanId, type TalismanRarity } from '../forest/talismans';
import { rtHp } from './hpScale';

/** A talisman of the real-time run: one of the turn-based ids in the slice, or «Якорь у героя». */
export type RtTalismanId = string;
/**
 * Rarity of a real-time talisman: the turn-based ones and (phase B, Т3) `relic` — a relic with a price, offered with the
 * oaths by the Jailer's row; not an oath (`isRtOath`: no +2 energy at the start of an arena).
 */
export type RtRarity = TalismanRarity | 'relic' | 'form' | 'fusion';
/** `effect` — the rule (a relic: its plus); `price` — the price of a relic, shown as plainly as the plus (section 5). */
export interface RtTalismanDef {
  id: RtTalismanId; name: string; rarity: RtRarity; effect: string; price?: string; excludes?: readonly string[];
  /** Task 30: the field a form bends (sim/buildIds.ts `FORM_FIELD`); absent — not a form. */
  field?: FormField;
  /** Task 30: a simple form — the only ones a first run offers (design decision 6). */
  simple?: true;
  /**
   * Task 50 «Повадка» (design 4.5): the run archetypes this item belongs to — with the run's `habit` among them it weighs
   * `RT_HABIT_WEIGHT` in the draws (`rtWeightedIndex`). Absent — no tag (survival, the jump's economy).
   */
  tags?: readonly RtHabitId[];
}

// ---------- Task 50 «Повадка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, section 4) ----------

/** The run's archetype: chosen on the gift `full` (`RtRunState.habit`), the same to the run's end. */
export type RtHabitId = 'cold' | 'flame' | 'shift' | 'daring';
export interface RtHabitDef { id: RtHabitId; name: string; line: string }
/** The four archetypes in the order of the gift's row (names checked against the catalogue and the documents, 16.10.2026). */
export const RT_HABITS: readonly RtHabitDef[] = [
  { id: 'cold', name: 'Стужа', line: 'Холод и удержание: «Наледь», «Печать», «Иней»' },
  { id: 'flame', name: 'Пламя', line: 'Огонь и волны по толпе' },
  { id: 'shift', name: 'Перелив', line: 'Смена цвета, дальний шаг, длинные цепи' },
  { id: 'daring', name: 'Удаль', line: 'Сила звена, элиты, добивание' },
];
export const isRtHabit = (value: unknown): value is RtHabitId => RT_HABITS.some(def => def.id === value);
export const rtHabit = (id: RtHabitId): RtHabitDef => RT_HABITS.find(def => def.id === id)!;
/** Баланс (design 4.3): an item with the run's tag weighs this much in a draw, one without — 1. */
export const RT_HABIT_WEIGHT = 3;
/**
 * Phase B ids (docs/realtime-phase-b.md; sim/buildIds.ts — one place for the simulation and the run): counter talismans
 * (Т1), hammers (Т2, `Loadout.hammer`), relics (Т3, rarity `relic`). Their definitions and offers come with track Д4.
 */
export { COUNTER_TALISMANS, HAMMERS, HAMMER_IDS, OATH_HUNGER, RELICS, RELIC_IDS, isHammerId, type CounterTalismanId, type HammerId, type RelicId } from '../sim/buildIds';

/** Баланс: the turn-based HP numbers of the talismans (DEW_FLASK_HEAL, TOUGH_HIDE_HP: +1) in real-time HP. */
export const RT_TOUGH_HIDE_HP = rtHp(1);
export const RT_DEW_FLASK_HEAL = rtHp(1);

/** A turn-based talisman as a slice definition: its id, name, rarity and exclusions; the effect text is the slice's. */
const turn = (id: TalismanId, effect: string, tags?: readonly RtHabitId[]): RtTalismanDef => {
  const entry = TALISMANS.find(other => other.id === id)!;
  return { id, name: entry.name, rarity: entry.rarity, effect, ...entry.excludes ? { excludes: entry.excludes } : {}, ...tags ? { tags } : {} };
};
/** Texts in real-time numbers; rarity and exclusions — the turn-based ones. The talismans of the slice before phase B. */
const RT_SLICE_TALISMANS: readonly RtTalismanDef[] = [
  turn('whetstone', 'Первая цепь каждой арены начинается с силой 1', ['daring']),
  turn('dew-flask', `Лечение на привале на ${RT_DEW_FLASK_HEAL} HP больше`),
  turn('tough-hide', `+${RT_TOUGH_HIDE_HP} к максимуму HP (и +${RT_TOUGH_HIDE_HP} HP сразу)`),
  // «Смена цвета» (design 12.10.2026): same id, the run's new action (sim/build.ts `colorShiftOf`); the sandbox with crystals — the crystal step.
  turn('millstone-shard', 'Смена цвета на 1 звено раньше: после 5 звеньев одного цвета вместо 6', ['shift']),
  turn('hourglass', 'Фазы после целей начинаются на 10 с позже', ['cold']),
  turn('nimble-paws', 'Прыжок стоит 1 энергию вместо 2'),
  // Task 50 (design §16, answer 3): the tag «Стужа» — the bot's share of tagged items for «Стужа» was below half the others' mean.
  turn('ash-ward', 'Один раз за поход: удар, который убил бы героя, оставляет его с 1 HP; оберег рассыпается', ['cold']),
  { id: 'hero-anchor', name: 'Якорь у героя', rarity: 'rare', effect: 'Следующее звено берётся и в радиусе R от героя (обойти щит им нельзя)', tags: ['shift'] },
  // Phase B, 5а (decision 10.10.2026): the new «Клятва голода» (sim/relics.ts `HUNGER_KILLS`, `HUNGER_HEAL`; relics.spec.ts checks the numbers).
  // Codex review 20.10.2026: «засчитанных цепи» — the counter is `onChainKill` (struck dead by the dash or a fallen credited link).
  turn('oath-hunger', '+1 HP за 15 убийств, засчитанных цепи; привал не лечит (крафт остаётся)'),
];
/**
 * Turn-based talismans without an analogue in real time (not offered; questions to design): «Кисет старьёвщика» and the
 * price of «Клятва бедности» are about chests, the price of «Клятва ярости» about the anger of enemies before the goals —
 * the slice has neither.
 */
export const RT_TALISMANS_OFF: readonly { id: TalismanId; reason: string }[] = [
  { id: 'ragman-pouch', reason: 'сундуков в реальном времени нет' },
  { id: 'oath-poverty', reason: 'цена «сундуки пусты» — сундуков нет' },
  { id: 'oath-wrath', reason: 'цена «злится на 1 врага больше» — злости нет' },
];
/** The turn-based ids in the slice (the `open` list of the pool the turn-based draws read). */
export const RT_TURN_TALISMANS: readonly TalismanId[] = RT_SLICE_TALISMANS.map(entry => entry.id).filter(isTalismanId);

/** Т1. Counter talismans (section 3): a condition and a trigger; «Добивание» never with «Быстрые ноги» (design answer 14). */
export const RT_COUNTER_TALISMANS: readonly RtTalismanDef[] = [
  { id: CT.fifthLink, name: 'Пятое звено', rarity: 'common', effect: 'Каждое 5-е звено цепи (5, 10, 15…) получает +2 силы перед ударом', tags: ['daring'] },
  { id: CT.thirdChain, name: 'Третья цепь', rarity: 'common', effect: 'Каждая 3-я цепь арены, убившая хотя бы одного: следующий прыжок за 5 с бесплатен' },
  { id: CT.prism, name: 'Призма', rarity: 'common', effect: '+1 энергия за каждую смену цвета цепи и за каждый кристалл, разбитый проходом', tags: ['shift'] },
  { id: CT.shockwave, name: 'Ударная волна', rarity: 'uncommon', effect: 'Цепь из 8+ звеньев: в конце прохода волна радиусом 2 вокруг героя бьёт на 1 всех врагов', tags: ['flame'] },
  { id: CT.finisher, name: 'Добивание', rarity: 'uncommon', effect: 'Последнее звено цепи погибло: неуязвимость после цепи 1 с вместо 0,5 с', excludes: [RL.swiftFeet], tags: ['daring'] },
  { id: CT.eliteHunter, name: 'Охотник на элит', rarity: 'uncommon', effect: 'Элита в цепи: звенья после неё получают +3 силы (один раз)', tags: ['daring'] },
  { id: CT.longArm, name: 'Длинная рука', rarity: 'rare', effect: 'Каждая 4-я цепь арены: радиус звена R +50% на всю эту цепь', tags: ['shift', 'daring'] },
  { id: CT.frostEdge, name: 'Иней на клинке', rarity: 'rare', effect: 'Каждая 4-я цепь арены: выжившее последнее звено замерзает на 2 с', tags: ['cold'] },
];
/** Т3. Relics (section 5): a strong plus and a price; offered with the oaths by the Jailer's row, never sold. */
export const RT_RELICS: readonly RtTalismanDef[] = [
  { id: RL.millstone, name: 'Жернов', rarity: 'relic', effect: 'Смена цвета на 2 звена раньше: после 4 звеньев одного цвета вместо 6', price: 'максимум HP −3', tags: ['shift'] },
  { id: RL.heavyBlade, name: 'Тяжёлый клинок', rarity: 'relic', effect: 'Каждое звено даёт +2 силы вместо +1', price: 'запас фокуса вдвое меньше', tags: ['daring'] },
  { id: RL.swiftFeet, name: 'Быстрые ноги', rarity: 'relic', effect: 'Скорость героя +25%', price: 'нет неуязвимости после цепи', excludes: [CT.finisher] },
  { id: RL.wideCircle, name: 'Широкий круг', rarity: 'relic', effect: 'Радиус звена R +25%', price: 'враги ходят на 10% быстрее', tags: ['shift'] },
  { id: RL.bloodOath, name: 'Кровавая клятва', rarity: 'relic', effect: '+1 энергия за каждые 6 убийств, засчитанных цепи, на арене', price: 'лечение расходником вдвое слабее (9 → 5)', tags: ['flame'] },
];
/** Every talisman of the real-time run: the slice's, the counter talismans (Т1), the relics (Т3). */
export const RT_TALISMANS: readonly RtTalismanDef[] = [...RT_SLICE_TALISMANS, ...RT_COUNTER_TALISMANS, ...RT_RELICS];

/**
 * Task 30 «Формы в походе» (docs/realtime-slice.md, section 8, «Формы в походе»): the run's forms of the fields «Путь» and
 * «Конец» (rarity `form`) — the four hammers, «Наледь», «Прямая» and «Печать». A run with the flag `forms` offers them on the
 * Jailer's screen (by the node's roll, `rtFormOffer`) and in the rare place of «Застава» (a form of the other field); the
 * rarity draws never take them. `simple` — the forms of a first run (design decision 6). «Возврат» never with «Взрыв на конце»
 * (`excludes`): the return run's shadow does not see the end blast (sim/build.ts `endShadow` — only «Ударная волна»), and the
 * sandbox never had two hammers at once (one hammer slot).
 */
const form = (id: string, name: string, effect: string, extra: Partial<RtTalismanDef> = {}): RtTalismanDef =>
  ({ id, name, rarity: 'form', effect, field: FORM_FIELD[id], ...extra });
export const RT_FORMS: readonly RtTalismanDef[] = [
  form(HM.fire, 'Огненный проход', 'Цепь из 3+ звеньев: путь прохода горит 2 с, огонь бьёт врагов на 1 при входе', { tags: ['flame'] }),
  form(HM.cut, 'Режущий проход', 'Проход бьёт на 1 врагов любого цвета в 0,5 от пути (кроме звеньев)', { tags: ['flame'] }),
  form(HM.return, 'Возврат', 'После прохода герой бежит к началу цепи вторым проходом с половиной силы; неуязвим на бегу', { excludes: [HM.blast], tags: ['daring'] }),
  form(FROST_PASS, 'Наледь', 'Путь прохода 2 с морозит врагов, которые в него входят; замёрзшие хрупки (следующий удар цепи ×2)', { simple: true, tags: ['cold'] }),
  form(HM.blast, 'Взрыв на конце', 'Цепь из 3+ звеньев: в конце прохода — взрыв радиусом 1,5 вокруг последнего звена, удар 1 по всем врагам', { simple: true, excludes: [HM.return], tags: ['flame'] }),
  form(FM.pierce, 'Прямая', 'Прямой хвост цепи: проход идёт дальше по прямой и бьёт всех на пути', { simple: true, tags: ['daring'] }),
  form(FM.seal, 'Печать', 'Замкни цепь в кольцо — удар по всем врагам внутри', { tags: ['cold', 'shift'] }),
];
/**
 * Task 30 (design decision 5; user 15.10.2026): the openers in the run's common pool — only «Близнецы» (rarity uncommon, field
 * «Звено»), with their price (`Params.twinsAlternate`, `twinsNoShift` in a run with the flag). «Чужак» and «Развилка» are not
 * in the pool. Drawn only by a run with the flag `forms` (`rtTalismanCatalog`).
 */
export const RT_OPENERS: readonly RtTalismanDef[] = [
  { id: FM.twins, name: 'Близнецы', rarity: 'uncommon', field: FORM_FIELD[FM.twins], tags: ['shift'],
    effect: 'Цвета разбиты на пары, пара — один цвет: 1 и 3, 2 и 4. Взяв второй цвет пары, цепь чередует цвета пары; «Смена цвета» не действует' },
];
/** A form of the run (`RT_FORMS`, rarity `form`). */
export const isRtForm = (id: RtTalismanId): boolean => RT_FORMS.some(entry => entry.id === id);
/**
 * Task 30: the field of a run item in the sense «одна форма на поле» (sim/buildIds.ts `FORM_FIELD`: the forms, «Близнецы» and
 * «Якорь у героя» of the field «Звено»); null — not a form.
 */
export const rtFormField = (id: RtTalismanId): FormField | null => FORM_FIELD[id] ?? null;

/**
 * Task 30: the counters' chain window (`Params.counterWindow`, on in a run with the flag `forms`): two new names and every rule
 * new (task 29; the arena column shows the same rules, view/buildColumn.ts). A run without the flag — the catalogue's own.
 */
export const RT_COUNTER_WINDOW: Readonly<Record<string, { name?: string; effect: string }>> = {
  [CT.fifthLink]: { name: 'Острие', effect: '3-е звено цепи получает +2 силы перед ударом' },
  [CT.thirdChain]: { name: 'Улов', effect: 'Цепь, убившая 3+ врагов: следующий прыжок за 5 с бесплатен' },
  [CT.prism]: { effect: 'Звенья после кристалла или смены цвета в цепи получают +1 силы' },
  [CT.shockwave]: { effect: 'Цепь из 4+ звеньев: в конце прохода волна радиусом 2 вокруг героя бьёт на 1 всех врагов' },
  [CT.finisher]: { effect: 'Последнее звено — самое крепкое в цепи и погибло: неуязвимость после цепи вдвое дольше' },
  [CT.eliteHunter]: { effect: 'После элиты или крепкого звенья цепи получают +3 силы' },
  [CT.longArm]: { effect: 'С 3-го звена цепи радиус звена R ×1,5' },
  [CT.frostEdge]: { effect: 'Цепь из 3+ звеньев кончилась на выжившем: он замерзает на 2 с' },
};

/**
 * Task 44 «Сплавы» (docs/realtime-slice.md, section 8, «Сплавы»): the fusions of a run with the flag `fusions` — made at a rest from
 * their two parts (sim/buildIds.ts `FUSION_RECIPES`), never drawn (rarity `fusion`). The field is the form part's (`FORM_FIELD`); the
 * text tells the fusion's rule and the parts' rules it keeps (the counters' chain window of a run with forms). «Бумеранг» keeps the
 * exclusions of its parts («Возврат» — «Взрыв на конце», «Добивание» — «Быстрые ноги»).
 */
export const RT_FUSIONS: readonly RtTalismanDef[] = [
  { id: FU.iceSeal, name: 'Ледяная печать', rarity: 'fusion', field: FORM_FIELD[FU.iceSeal],
    effect: 'Замкни цепь в кольцо — удар по всем врагам внутри; выжившие замерзают на 3 с и хрупки (следующий удар цепи ×2). Цепь из 3+ звеньев кончилась на выжившем — он замерзает на 2 с' },
  { id: FU.spear, name: 'Копьё', rarity: 'fusion', field: FORM_FIELD[FU.spear],
    effect: 'Прямой хвост цепи: проход идёт дальше по прямой вдвое дальше и бьёт всех на пути, с элиты снимает 2 пластины. С 3-го звена цепи радиус звена R ×1,5' },
  { id: FU.boomerang, name: 'Бумеранг', rarity: 'fusion', field: FORM_FIELD[FU.boomerang], excludes: [HM.blast, RL.swiftFeet, FU.hunterBlast],
    effect: 'После прохода герой бежит к началу цепи вторым проходом: последнее звено погибло — с полной силой, иначе с половиной; неуязвим на бегу. Последнее звено — самое крепкое в цепи и погибло: неуязвимость после цепи вдвое дольше' },
  // Task 46 (design 16.10.2026, sections 3, 5 and 9; the texts tell the fusion's rule and the parts' rules it keeps).
  { id: FU.brand, name: 'Клеймо', rarity: 'fusion', field: FORM_FIELD[FU.brand],
    effect: 'Цепь из 3+ звеньев: путь горит 2 с, огонь бьёт на 1. Враги рядом с путём принимают цвет цепи. Звенья после смены цвета получают +1 силы' },
  { id: FU.hunterBlast, name: 'Подрыв', rarity: 'fusion', field: FORM_FIELD[FU.hunterBlast], excludes: [HM.return, FU.boomerang],
    effect: 'Цепь из 3+ звеньев: взрыв радиусом 1,5 вокруг последнего звена, удар 1. Последнее звено — элита или крепкий: взрыв 2,25, удар 4, с элиты 2 пластины. После элиты или крепкого звенья получают +3 силы' },
  { id: FU.frostWave, name: 'Ледяная волна', rarity: 'fusion', field: FORM_FIELD[FU.frostWave],
    effect: 'Путь прохода 2 с морозит врагов. Цепь из 4+ звеньев: волна радиусом 2 бьёт на 1; выжившие замерзают на 3 с и хрупки (следующий удар цепи ×2)' },
];
/** A fusion of the run (`RT_FUSIONS`). */
export const isRtFusion = (id: RtTalismanId): boolean => RT_FUSIONS.some(entry => entry.id === id);
export { FUSION_RECIPES };

const BY_ID = new Map([...RT_TALISMANS, ...RT_FORMS, ...RT_OPENERS, ...RT_FUSIONS].map(entry => [entry.id, entry]));
export const rtTalisman = (id: RtTalismanId): RtTalismanDef | undefined => BY_ID.get(id);
export const isRtTalisman = (value: unknown): value is RtTalismanId => typeof value === 'string' && BY_ID.has(value);
export const isRtOath = (id: RtTalismanId): boolean => rtTalisman(id)?.rarity === 'oath';
export const isRtRelic = (id: RtTalismanId): boolean => rtTalisman(id)?.rarity === 'relic';
/** The rule of a talisman in one line; a relic — its plus and its price («цена: …»). */
export const rtTalismanText = (id: RtTalismanId, window = false): string => { const def = rtTalismanShown(id, window); return def ? `${def.effect}${def.price ? `; цена: ${def.price}` : ''}` : ''; };
/** Names of the rarities (offer cards). */
export const RT_RARITY_NAME: Readonly<Record<RtRarity, string>> = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', oath: 'клятва', relic: 'реликвия', form: 'форма', fusion: 'сплав' };
/**
 * Task 30: a talisman as a run shows it — with the counters' chain window (`window`: a run with the flag `forms`) a counter has
 * its new name and rule (`RT_COUNTER_WINDOW`); otherwise the catalogue's definition.
 */
export function rtTalismanShown(id: RtTalismanId, window: boolean): RtTalismanDef | undefined {
  const def = rtTalisman(id), own = window ? RT_COUNTER_WINDOW[id] : undefined;
  return def && own ? { ...def, name: own.name ?? def.name, effect: own.effect } : def;
}

/** Т2. Hammers (section 4): one per run (`Loadout.hammer`); the Jailer's row offers 3 of 4. */
export interface RtHammerDef { id: Hammer; name: string; effect: string }
export const RT_HAMMERS: readonly RtHammerDef[] = [
  { id: 'fire-pass', name: 'Огненный проход', effect: 'Цепь из 3+ звеньев: путь прохода горит 2 с, огонь бьёт врагов на 1 при входе' },
  { id: 'end-blast', name: 'Взрыв на конце', effect: 'Цепь из 3+ звеньев: в конце прохода — взрыв радиусом 1,5 вокруг последнего звена, удар 1 по всем врагам' },
  { id: 'cutting-pass', name: 'Режущий проход', effect: 'Проход бьёт на 1 врагов любого цвета в 0,5 от пути (кроме звеньев)' },
  { id: 'return-pass', name: 'Возврат', effect: 'После прохода герой бежит к началу цепи вторым проходом с половиной силы; неуязвим на бегу' },
];
const HAMMER_BY_ID = new Map<string, RtHammerDef>(RT_HAMMERS.map(entry => [entry.id, entry]));
export const rtHammer = (id: string): RtHammerDef | undefined => HAMMER_BY_ID.get(id);
/** Баланс: hammers in the Jailer's offer. */
export const RT_HAMMER_OFFER_SIZE = 3;
/** The salt of a node's hammer roll (design answer 1: `mixSeed(arenaSeed, «rt-hammer»)`, no stream spent). */
export const HAMMER_SALT = [...'rt-hammer'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/** The hammer offer of the Jailer's row: RT_HAMMER_OFFER_SIZE different hammers of 4 by the node's roll (mixSeed(arenaSeed, HAMMER_SALT)). */
export function rtHammerOffer(roll: number): Hammer[] {
  const left = [...HAMMER_LIST], options: Hammer[] = [];
  for (let n = 0; n < RT_HAMMER_OFFER_SIZE && left.length; n++) options.push(left.splice(mixSeed(roll >>> 0, n) % left.length, 1)[0]);
  return options;
}
/** Task 30: the salt of a node's form roll (`mixSeed(arenaSeed, «rt-form»)`, no stream spent; not the hammer's salt). */
export const FORM_SALT = [...'rt-form'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);
/**
 * Task 30: `count` different forms of `candidates` (in their order) by a node's roll (`mixSeed(arenaSeed, FORM_SALT)`), as the
 * hammers are drawn: the first `n` of a longer offer are the offer of `n`.
 */
export function rtFormOffer(roll: number, candidates: readonly RtTalismanId[], count: number, habit?: RtHabitId): RtTalismanId[] {
  // Task 50: `habit` — the draw weighs the run's tagged forms (the rare place of «Застава»; never the Jailer's screen).
  const left = [...candidates], options: RtTalismanId[] = [];
  for (let n = 0; n < count && left.length; n++) options.push(left.splice(rtWeightedIndex(mixSeed(roll >>> 0, n), left, habit), 1)[0]);
  return options;
}
/** An offer option: a talisman (design answer 10 to step 3: no «пустышка» in the slice — an empty pool offers nothing). */
export type RtTalismanOption = RtTalismanId;

/** What the run took and what left the pool (shown and refused). */
export interface RtTalismanPool {
  taken: readonly RtTalismanId[]; gone: readonly RtTalismanId[];
  /** Task 30: a run with the flag `forms` — its catalogue holds the openers (`rtTalismanCatalog`). Absent — the old catalogue. */
  forms?: boolean;
  /** Task 50 «Повадка»: the run's archetype — the draws weigh its tagged items (`rtWeightedIndex`). Absent — every weight 1. */
  habit?: RtHabitId;
}

/** Task 50: the weight of `id` in a draw of a run with `habit` (`RT_HABIT_WEIGHT` with the tag, else 1); no habit — 1. */
export const rtHabitWeight = (id: RtTalismanId, habit?: RtHabitId): number => (habit && rtTalisman(id)?.tags?.includes(habit) ? RT_HABIT_WEIGHT : 1);
/**
 * Task 50 (design 4.3): the index a draw `value` picks among `candidates` (in their order) — `value mod Σw`, then the accumulated weights.
 * Without a habit every weight is 1: `value mod n`, the index of before, byte for byte. The rarity roll is not weighed (it came first).
 */
export function rtWeightedIndex(value: number, candidates: readonly RtTalismanId[], habit?: RtHabitId, plain: readonly RtTalismanId[] = []): number {
  // `plain` — candidates that weigh 1 whatever their tag (task 50: «Иней на клинке» new on the knack screen of «Стужа»).
  if (!habit) return value % candidates.length;
  const weights = candidates.map(id => (plain.includes(id) ? 1 : rtHabitWeight(id, habit)));
  let r = value % weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < weights.length; i++) { if (r < weights[i]) return i; r -= weights[i]; }
  return candidates.length - 1;
}
/** `rtWeightedIndex`'s pick. */
export const rtWeightedPick = (value: number, candidates: readonly RtTalismanId[], habit?: RtHabitId, plain: readonly RtTalismanId[] = []): RtTalismanId => candidates[rtWeightedIndex(value, candidates, habit, plain)];
/**
 * The talismans the rarity draws of a run pick from — one place for every draw (`rtTalismanOffer`, `rtShopTalisman`,
 * `rtTalismanDraw`, `rtTalismanLeft`): the run's catalogue `RT_TALISMANS`; task 30 — with the flag `forms` the openers too
 * (`RT_OPENERS`, after the catalogue).
 */
export function rtTalismanCatalog(pool: RtTalismanPool): readonly RtTalismanDef[] {
  return pool.forms ? [...RT_TALISMANS, ...RT_OPENERS] : RT_TALISMANS;
}
/**
 * The pool for the turn-based rolls the run still calls (the gift's buttons `rollGift`, the merchant's stock `shopStock`;
 * their talismans are drawn again by the real-time draws, phase B): the turn-based ids only, both abilities open
 * (the jump and the spin are open from the start of a real-time run), only the slice's talismans `open`.
 */
export function turnPool(pool: RtTalismanPool): TalismanPool {
  return { taken: pool.taken.filter(isTalismanId), gone: pool.gone.filter(isTalismanId), abilities: ['jump', 'spin'], open: RT_TURN_TALISMANS };
}

const clash = (a: RtTalismanId, b: RtTalismanId) => !!rtTalisman(a)?.excludes?.includes(b) || !!rtTalisman(b)?.excludes?.includes(a);
/** `id` may be offered now: not taken, not gone, not in this offer, no clash with a taken one or another option. */
export function rtTalismanEligible(id: RtTalismanId, pool: RtTalismanPool, offered: readonly RtTalismanOption[] = []): boolean {
  if (pool.taken.includes(id) || pool.gone.includes(id) || offered.includes(id)) return false;
  const others = [...pool.taken, ...offered];
  return !others.some(other => clash(id, other));
}

const RARITIES = ['common', 'uncommon', 'rare'] as const;
const OFFER_SALT = 0x51ab_7c03, RARITY_SALT = 0x2c9e_4f11, PICK_SALT = 0x6e07_d2a9, SHOP_SALT = 0x3f5b_91c7;
const unit = (value: number) => value / 0x100000000;
const eligibleOf = (rarity: RtRarity, pool: RtTalismanPool, offered: readonly RtTalismanOption[]) =>
  rtTalismanCatalog(pool).filter(entry => entry.rarity === rarity && rtTalismanEligible(entry.id, pool, offered)).map(entry => entry.id);

/** Баланс (design answer 4): the place of a hard-battle offer that is always rare (the first one). */
export const RT_RARE_SLOT = 0;
/**
 * The talisman offer of a won hard battle (`hard`) or of the Jailer's row (`oath`) — talismanOffer of the turn-based run
 * over the slice's list: up to three different options; a talisman option rolls its rarity, an empty rarity gives way to
 * the next one, all empty — no option (design answer 10: no «пустышка»; only the refusal stays). Phase B: the place
 * RT_RARE_SLOT of a hard battle is always rare (design answer 4; no rare left — it gives way as any other); the Jailer's
 * offer draws among the oaths and the relics (design answer 2). `base` is one draw of the run's `talismans` stream.
 */
export function rtTalismanOffer(base: number, source: 'hard' | 'oath', pool: RtTalismanPool, slots = 3): RtTalismanOption[] {
  // Task 28 «Тюремщик в походе»: the Jailer's screen after a severed weight has 4 slots — the first three are those of 3 (rtRun.ts `rtOathSlots`).
  const seed = mixSeed(base >>> 0, OFFER_SALT), options: RtTalismanOption[] = [];
  for (let slot = 0; slot < slots; slot++) {
    let candidates: RtTalismanId[] = [];
    if (source === 'oath') candidates = [...eligibleOf('oath', pool, options), ...eligibleOf('relic', pool, options)];
    else {
      const rolled = slot === RT_RARE_SLOT ? RARITIES.indexOf('rare') : RARITIES.indexOf(rarityOfRoll(unit(mixSeed(mixSeed(seed, slot), RARITY_SALT))));
      for (let step = 0; step < RARITIES.length && !candidates.length; step++) candidates = eligibleOf(RARITIES[(rolled + step) % RARITIES.length], pool, options);
    }
    if (candidates.length) options.push(rtWeightedPick(mixSeed(mixSeed(seed, slot), PICK_SALT), candidates, pool.habit));
  }
  return options;
}

/** The merchant's talisman (merchant.ts): the rarity roll, an empty rarity gives way to the next one, all empty — none. */
export function rtShopTalisman(base: number, pool: RtTalismanPool): RtTalismanId | null {
  const seed = mixSeed(base >>> 0, SHOP_SALT), rolled = RARITIES.indexOf(rarityOfRoll(unit(mixSeed(seed, RARITY_SALT))) as typeof RARITIES[number]);
  for (let step = 0; step < RARITIES.length; step++) {
    const candidates = eligibleOf(RARITIES[(rolled + step) % RARITIES.length], pool, []);
    if (candidates.length) return rtWeightedPick(mixSeed(seed, PICK_SALT), candidates, pool.habit);
  }
  return null;
}

/** The rarities the gift and events draw (design answer 5): the chain stops at the uncommon ones. */
const DRAW_RARITIES = ['common', 'uncommon'] as const;
const DRAW_SALT = 0x4d1f_86b5;
/**
 * Phase B (design answer 5): the real-time draw of the gift and of events — `count` different talismans of `rarity` from
 * the run's pool. An empty rarity gives way to the next one, and the chain stops at the uncommon ones: common → uncommon,
 * uncommon → none (rare ones come only from a hard battle and the merchant); an empty chain leaves the slot empty. An oath
 * draws among the oaths only (the relics come from the Jailer's row). `exclude` are not drawn either. `base` is one value
 * of the caller's stream — the same value the turn-based draw took: the streams do not move.
 */
export function rtTalismanDraw(base: number, rarity: 'common' | 'uncommon' | 'oath', count: number, pool: RtTalismanPool, exclude: readonly RtTalismanId[] = []): RtTalismanId[] {
  const drawn: RtTalismanId[] = [];
  for (let slot = 0; slot < count; slot++) {
    const eligible = (of: RtRarity) => eligibleOf(of, pool, drawn).filter(id => !exclude.includes(id));
    let candidates: RtTalismanId[] = [];
    if (rarity === 'oath') candidates = eligible('oath');
    else for (const of of DRAW_RARITIES.slice(DRAW_RARITIES.indexOf(rarity))) { candidates = eligible(of); if (candidates.length) break; }
    if (candidates.length) drawn.push(rtWeightedPick(mixSeed(mixSeed(base >>> 0, slot), DRAW_SALT), candidates, pool.habit));
  }
  return drawn;
}
/** The reward of an event's battle: `count` different common talismans to choose from (an empty rarity gives way to uncommon). */
export const rtEventTalismanOffer = (base: number, count: number, pool: RtTalismanPool): RtTalismanOption[] => rtTalismanDraw(base, 'common', count, pool);
/** Some talisman an event may give is still in the pool (common or uncommon): an event's sure talisman needs one. */
export const rtTalismanLeft = (pool: RtTalismanPool): boolean => DRAW_RARITIES.some(rarity => eligibleOf(rarity, pool, []).length > 0);
