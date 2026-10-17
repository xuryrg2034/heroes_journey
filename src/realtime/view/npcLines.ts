/**
 * Task 37 «Очаг»: the camp NPC's lines — data of the view, the texts of docs/design-notes/npc-lines-v1.md (design 15.10.2026).
 * The rule (spec of task 37): the most concrete occasion of the last run, else the idle ones in turn; `first` once per profile.
 * Lines of one key go in the order of showing: the first one first, then round and round («опять» only from the second).
 */
import type { NpcId } from './metaModel';
import { TOAD_LINES_BY_NPC } from './npcToadLines';

/** Causes of death the lines know (the run's killing blow; design notes: jailer — any blow in the Jailer's fight). */
export type DeathCause = 'crowd' | 'archer' | 'sapper' | 'jailer' | 'final' | 'fire' | 'other' | 'guardroom' | 'castellan' | 'troll';
export type LineKey = 'first' | 'first_self' | 'win_first' | 'win' | `death_${DeathCause}` | 'record' | 'buy_1' | 'buy_2'
  | 'quest_give' | 'quest_give_final' | 'quest_done' | 'quest_fail' | 'idle' | 'about_owl' | 'about_herb' | 'about_smith' | 'locked3' | 'pack'
  | 'win_garrison_first' | 'meet_hello' | 'back_met';

export const NPC_LINES: Readonly<Record<NpcId, Partial<Record<LineKey, readonly string[]>>>> = {
  owl: {
    first: ['Ещё один кот с топором. Садись, запишу тебя — пока есть что записывать.', 'Я Неясыть, летописица леса. Твоя первая страница вышла короткой.'],
    win_first: ['Лес пройден! Придётся вклеить лист: такой концовки я не заготовила.'],
    win: ['Победа. Записала крупно, чтобы ты прочёл без очков.', 'Опять дошёл до конца. Скучно, но аккуратно — это я ценю.', 'Последний рубеж пройден. Чернила на такие главы уходят быстрее.'],
    death_crowd: ['Тебя задавили числом. Запишу: «утонул в толпе», без подробностей.', 'Толпа. Их было много, ты один — арифметика, не судьба.'],
    death_archer: ['Стрела лучника. Он же метил точку заранее, кот.', 'Лучник опять попал. В книге так и пишу: «стоял на метке».'],
    death_sapper: ['Фитиль сапёра горел, а ты стоял рядом. Отметила с отвращением.', 'Опять взрыв сапёра. Шерсть дымилась ещё две страницы.'],
    death_jailer: ['Тюремщик и его гиря. Запишу на отдельной странице, он заслужил.', 'Опять Тюремщик. Я завела под него целый раздел.'],
    death_final: ['Последний рубеж. Глава оборвалась на последней строке — обиднее не бывает.', 'Опять у самого рубежа. Я уже держала перо над словом «победа».'],
    death_fire: ['Наступил в огненный след — нарочно? Спрашиваю для книги.', 'Опять сгорел. Палёной шерстью пахнет даже от страницы.'],
    death_other: ['Записала, что тебя сразило. Не горжусь ни одним словом.', 'Глупо. Нет, не спорь — я видела, я записывала.'],
    record: ['Дальше, чем прежде! Пришлось перенести закладку — не зазнавайся.', 'Новый рекорд. Я передвинула ленточку, она давно скучала.'],
    buy_1: ['Два пути. Я видела лес сверху — выбирай, пока я добрая.'],
    buy_2: ['Три пути. Больше не дам: летопись любит, когда герой сомневается.'],
    quest_give: ['Дойди дальше прежнего. Мне нужна новая страница, а не копия старой.'],
    quest_give_final: ['Пройди лес. Последняя глава пустует, и это неприлично.'],
    quest_done: ['Задание выполнено. Новая страница, новые кляксы — прекрасно.', 'Выполнено. Запишу без единой колкости — почти.'],
    quest_fail: ['Не дальше прежнего. Страница вышла копией, кот.', 'Задание не выполнено. Перепишу старую главу, раз новой нет.'],
    idle: ['Я записываю всё. Даже как ты чешешься.', 'Чернила из бузины. Пахнут лесом, пачкают когти.', 'Найдёшь в лесу моё дупло — бери одно и не шуми.', 'Тише, кот. Летопись не терпит болтовни, а я — тем более.'],
    about_herb: ['Марфа лечит всех подряд. Я бы сначала спросила, за что.', 'Травница опять сушит корни на моих страницах.'],
    about_smith: ['Ерофей не умеет читать. Зато помнит каждое лезвие — завидно.', 'Точильщик говорит три слова в день. Я записываю все три.'],
    locked3: ['Эту страницу открою после гарнизона. Раньше — не по чину.'],
    pack: ['В лесу появилось новое. Я внесла в опись три строки.'],
  },
  herb: {
    first: ['Ты волчонка перевязал? Криво, зато от сердца — садись, котище.', 'Я Марфа, травница. Шла за волчонком, а вышла к твоему костру.'],
    first_self: ['Слыхала про тебя: кот, топор, вечно в синяках. Пришла сама, раз не зовёшь.'],
    win_first: ['Лес прошёл и вернулся целым? Дай лапы пересчитаю, не верю.'],
    win: ['Победил — и всё равно весь в колючках. Сиди смирно.', 'Вернулся на своих ногах. Вот так бы всегда, горе моё.', 'Победа, говорят. А чай кто пить будет — я одна?'],
    death_crowd: ['Толпой затоптали. Ты хоть иногда отступай, котище.', 'Опять толпа тебя по клочку разобрала. Собрала обратно, не благодари.'],
    death_archer: ['Стрелу вытащила. Лучник метит, а ты стоишь — зачем?', 'Опять дырка от стрелы. Скоро зашивать будет некуда.'],
    death_sapper: ['Усы опалены, брови тоже. Где фитиль сапёра — там не стой.', 'Опять порохом пахнешь. Сапёра, значит, обнимал.'],
    death_jailer: ['Тюремщик тебя гирей приложил. Шишку мажу, не дёргайся.', 'Опять Тюремщик? У меня на его гирю примочек не напасёшься.'],
    death_final: ['У самого рубежа упал. Обидно — ты почти дошёл, котище.', 'Последний рубеж опять. Отоспись, а там поглядим.'],
    death_fire: ['Ожоги. Огненный след — не тропинка, сколько раз говорить.', 'Опять шерсть палёная. Мазь от ожогов кончается быстрее трав.'],
    death_other: ['Ну и вид. Лечить буду молча, а то наговорю лишнего.', 'Лежи. Кто бы тебя ни уложил — до свадьбы заживёт.'],
    record: ['Дальше прежнего зашёл. Сова довольна, а мне потом латать.', 'Новый рекорд, говорят. Мне бы новый бинт, да где его взять.'],
    buy_1: ['На-ка склянку в дорогу. Не разбей до первого боя.'],
    buy_2: ['Теперь выбирай сам, что взять. Только не выбирай глупо.'],
    quest_give: ['Вернись с двумя склянками. Не выпивай всё сразу, как всегда.', 'Две склянки домой принеси. Хочу видеть, что ты умеешь беречь.'],
    quest_done: ['Две склянки целы — умеешь, когда хочешь. Сова, запиши.', 'Вернул склянки. Значит, не так уж ты и безнадёжен.'],
    quest_fail: ['Склянки где — опять всё выпил? Горе луковое.', 'Сумка пустая, склянок нет. Ладно, сварю ещё.'],
    idle: ['Подорожник к лапе, крапиву к языку. Последнее — для совы.', 'Травы сохнут, кот хромает. Обычный вечер у Очага.', 'Сядь ближе к огню. Нет, не так близко — шерсть же.', 'Ты ешь хоть что-нибудь, кроме подвигов? Худой, как жердь.'],
    about_owl: ['Сова всё пишет да пишет. Лучше бы бинты резала.', 'Неясыть ворчит, что я сушу травы на её книге. Сушу.'],
    about_smith: ['Ерофей мою мазь продаёт втридорога. Я молчу — он мне ножи точит.', 'Точильщик добрый, только сам не знает. Не говори ему.'],
    locked3: ['Этот отвар — после гарнизона. Там травы другие, злые.'],
    pack: ['В лесу новое завелось. Принюхайся, прежде чем хватать.'],
  },
  smith: {
    first: ['Ты у меня заточку брал. Помню топор — зазубрина на зазубрине.', 'Ерофей я. Точу, не торгуюсь — давай топор.'],
    first_self: ['Слыхал про тебя: топор, говорят, тупой. Пришёл глянуть.'],
    win_first: ['Лес прошёл, лезвие держит. Добрая работа — и моя тоже.'],
    win: ['Победа. Топор не жалел — видно по кромке.', 'Дошёл. Давай топор, выправлю к утру.', 'Добро. Без спешки бил, это я уважаю.'],
    death_crowd: ['Толпа задавила. Махал быстро, а бил тупо.', 'Опять толпа? Значит, цепь коротка была.'],
    death_archer: ['Лучник. От стрелы топором не отмашешься — шагай с метки.', 'Опять стрела. Наконечник дрянной, кстати, — я глянул.'],
    death_sapper: ['Сапёр рванул. Видишь фитиль — отходи, не геройствуй.', 'Опять сапёр. Топорище обуглено, переделывать буду.'],
    death_jailer: ['Тюремщик. Гиря у него знатная — мне бы такую.', 'Опять Тюремщик. Голову под кистень не подставляй, малый.'],
    death_final: ['У рубежа лёг, а лезвие было в порядке. Дело в руке.', 'Опять Последний рубеж. Близко было — ближе, чем спешка позволяет.'],
    death_fire: ['В огонь наступил. Закалка — для стали, малый, не для лап.', 'Опять огненный след. Рукоять оплавилась, а ты всё туда же.'],
    death_other: ['Не вышло — бывает. Садись, точить будем.', 'Лезвие цело, шкура нет. Шкуру — к Марфе.'],
    record: ['Дальше прежнего прошёл. Кромка стёрлась — значит, работал.', 'Новый рекорд? Сове скажи, мне топор покажи.'],
    buy_1: ['Правка готова. Худой выбор у Тюремщика — разок перебросишь.'],
    buy_2: ['Полный верстак. У Тюремщика увидишь все молоты разом.'],
    quest_give: ['Отруби гирю Тюремщику. Наковальне моей нужна.', 'Гирю Тюремщика принеси. Из неё наковальня выйдет добрая.'],
    quest_done: ['Гирю отрубил — вот это работа. Наковальня будет.', 'Отрубил? Добро — Тюремщик теперь кривой ходит.'],
    quest_fail: ['Гиря при нём осталась. Ничего, наковальня подождёт.', 'Не отрубил. Гиря — тоже звено, малый, руби её цепью.'],
    idle: ['Точу. Не стой над душой, малый.', 'Каждое лезвие помнит, кого рубило. Твоё — всех подряд.', 'Колесо скрипит — значит, живое. Смажу к зиме.', 'Спешка лезвие губит. И котов тоже.'],
    about_owl: ['Сова пишет, я точу — каждый своё тупит.', 'Неясыть меня в книгу записала: «молчун». Верно записала.'],
    about_herb: ['Марфа ругается, а мазь у неё лучшая. Не говори ей.', 'Марфину мазь продаю дорого. За хорошее не грех.'],
    locked3: ['Третья правка — после гарнизона. Там сталь другая.'],
    pack: ['Новое железо в лесу. Бери, да проверь кромку.'],
  },
};

/**
 * Task 49 (design 16–17.10.2026, docs/design-notes/npc-lines-v2.md, «v2.1»): the lines that name the cat (кот, шерсть, топор) or put a verb
 * about the hero in the masculine carry the mark `cat` — the places (1-based, as the tables of the design list them) in the key's list.
 * After a run of Ведунья (`LineContext.hero` 'toad') they are skipped: the occasion takes the next line without the mark, else the next
 * occasion, at last `idle`. After the cat's run, or with no run, every line is said.
 */
export const CAT_MARKED: Readonly<Record<NpcId, Partial<Record<LineKey, readonly number[]>>>> = {
  owl: { first: [1], win: [1, 2], death_crowd: [1, 2], death_archer: [1, 2], death_sapper: [1, 2], death_fire: [1, 2], quest_fail: [1], idle: [4] },
  herb: { first: [1], first_self: [1], win_first: [1], win: [1, 2], death_crowd: [1], death_sapper: [1, 2], death_final: [1], death_fire: [2], record: [1], buy_2: [1], quest_done: [2], quest_fail: [1], idle: [2, 3, 4] },
  smith: { first: [1, 2], first_self: [1], win_first: [1], win: [1, 2, 3], death_crowd: [1], death_archer: [1], death_sapper: [2], death_jailer: [2], death_final: [1], death_fire: [1, 2], death_other: [2], record: [1, 2], quest_done: [1, 2], quest_fail: [2], idle: [1, 2, 4] },
};

/** The occasion of a line now. */
export interface LineContext {
  /** Task 49: the hero of the last run — 'toad' (Ведунья); absent — the cat's (or no run yet). */
  hero?: 'toad';
  /** The NPC came by itself (the fallback way) — its meeting line is `first_self`. */
  self?: boolean;
  /** The occasions of the last run (said once per camp visit). */
  last?: { won: boolean; firstWin?: boolean; cause?: DeathCause; record?: boolean; questDone?: boolean; questFail?: boolean; pack?: boolean };
  /** Just bought this level. */
  bought?: 1 | 2;
  /** The other NPC in the camp (for `about_*`). */
  others: NpcId[];
}

/** The profile's memory: how many times each key was said (the line's index in its list). */
export type LineMemory = Readonly<Record<string, number>>;

/**
 * The line an NPC says now: its key and text, and the memory key to count it by (`npc:key`). The meeting (`first`, or
 * `first_self` for one who came by itself) while its lines last; then a purchase; then the last run's most concrete occasion
 * (quest done or failed, a first victory, a record, a pack, a victory, the death's cause); else idle lines in turn, every fourth
 * one about another NPC present.
 */
export function pickLine(npc: NpcId, ctx: LineContext, memory: LineMemory): { key: LineKey; text: string; id: string } {
  // After her run (`hero` 'toad'): her variants first, then the lines without the mark `cat`, counted apart (`npc:key:toad`).
  const toad = ctx.hero === 'toad', tail = toad ? ':toad' : '';
  const L = NPC_LINES[npc], count = (key: LineKey): number => memory[`${npc}:${key}${tail}`] ?? 0;
  const line = (key: LineKey, once = false): { key: LineKey; text: string; id: string } | null => {
    const marked = toad ? CAT_MARKED[npc][key] ?? [] : [];
    const list = [...toad ? TOAD_LINES_BY_NPC[npc][key] ?? [] : [], ...(L[key] ?? []).filter((_, i) => !marked.includes(i + 1))];
    if (!list.length) return null;
    const n = count(key);
    if (once && n >= list.length) return null;
    return { key, text: list[n % list.length], id: `${npc}:${key}${tail}` };
  };
  const meet = ctx.self ? line('first_self', true) : null;
  const first = meet ?? (count('first_self') ? null : line('first', true));
  if (first) return first;
  // A purchase line the mark skips (after her run) gives way to the next occasion.
  const buy = ctx.bought ? line(ctx.bought === 1 ? 'buy_1' : 'buy_2') : null;
  if (buy) return buy;
  const last = ctx.last;
  if (last) {
    const occasion = (last.questDone && line('quest_done')) || (last.questFail && line('quest_fail')) || (last.firstWin && line('win_first', true))
      || (last.record && line('record')) || (last.pack && line('pack')) || (last.won && line('win')) || (last.cause && (line(`death_${last.cause}`) ?? line('death_other')));
    if (occasion) return occasion;
  }
  const idle = count('idle'), about = ctx.others.filter(o => o !== npc).map(o => `about_${o}` as LineKey).filter(k => L[k]);
  if (about.length && idle % 4 === 3) return { ...line(about[(idle >> 2) % about.length])!, id: `${npc}:idle${tail}` };
  return line('idle')!;
}

/** The words of the NPC's quest as it gives it (Неясыть at a record of 10: «Пройди лес»). */
export function questLine(npc: NpcId, final: boolean, memory: LineMemory): string {
  const list = NPC_LINES[npc][npc === 'owl' && final ? 'quest_give_final' : 'quest_give'] ?? [];
  return list.length ? list[(memory[`${npc}:quest_give`] ?? 0) % list.length] : '';
}
