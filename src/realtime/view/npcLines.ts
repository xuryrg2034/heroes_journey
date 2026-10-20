/**
 * Task 37 «Очаг»: the camp NPC's lines — data of the view, the texts of docs/design-notes/npc-lines-v1.md (design 15.10.2026).
 * The rule (spec of task 37): the most concrete occasion of the last run, else the idle ones in turn; `first` once per profile.
 * Lines of one key go in the order of showing: the first one first, then round and round («опять» only from the second).
 */
import type { NpcId } from './metaModel';
import { TOAD_LINES_BY_NPC } from './npcToadLines';

/** Causes of death the lines know (the run's killing blow; design notes: jailer — any blow in the Jailer's fight). */
export type DeathCause = 'crowd' | 'archer' | 'sapper' | 'jailer' | 'final' | 'fire' | 'other' | 'guardroom' | 'castellan' | 'troll';
export type LineKey = 'first' | 'first_self' | 'win_first' | 'win' | `death_${DeathCause}` | 'record' | 'buy_1' | 'buy_2' | 'buy_3'
  | 'quest_give' | 'quest_give_final' | 'quest_done' | 'quest_fail' | 'idle' | 'about_owl' | 'about_herb' | 'about_smith' | 'about_gambler' | 'about_monk' | 'locked3' | 'pack'
  | 'win_garrison_first' | 'meet_hello' | 'back_met' | 'first_won' | 'first_lost' | 'casino_won' | 'casino_lost'
  | 'habit_first' | 'knack_first' | 'vow_kept' | 'vow_broken' | 'memory_cuts' | 'memory_castellan'
  | 'leave' | 'back_missed' | 'meet_deal' | 'meet_no' | 'trace_herb' | 'trace_smith' | 'trace_gambler';

export const NPC_LINES: Readonly<Record<NpcId, Partial<Record<LineKey, readonly string[]>>>> = {
  owl: {
    first: ['Ещё один кот с топором. Садись, запишу тебя — пока есть что записывать.', 'Я Неясыть, летописица леса. Твоя первая страница вышла короткой.'],
    win_first: ['Лес пройден! Придётся вклеить лист: такой концовки я не заготовила.'],
    win: ['Победа. Записала крупно, чтобы ты прочёл без очков.', 'Опять дошёл до конца. Скучно, но аккуратно — это я ценю.', 'Ещё одна глава дописана. Чернила на такие главы уходят быстрее.'],
    death_crowd: ['Тебя задавили числом. Запишу: «утонул в толпе», без подробностей.', 'Толпа. Их было много, ты один — арифметика, не судьба.'],
    death_archer: ['Стрела лучника. Он же метил точку заранее, кот.', 'Лучник опять попал. В книге так и пишу: «стоял на метке».'],
    death_sapper: ['Фитиль сапёра горел, а ты стоял рядом. Отметила с отвращением.', 'Опять взрыв сапёра. Шерсть дымилась ещё две страницы.'],
    death_jailer: ['Тюремщик и его гиря. Запишу на отдельной странице, он заслужил.', 'Опять Тюремщик. Я завела под него целый раздел.'],
    death_final: ['Последний рубеж. Глава оборвалась на последней строке — обиднее не бывает.', 'Опять у самого рубежа. Я уже держала перо над словом «победа».'],
    // Task 48 (npc-lines-v1.md, «Задача 48»): the garrison's guardroom and Castellan, the Troll of the den branch.
    death_guardroom: ['Караульня. Строй стоял, ты лез — запишу как «спор со стеной».', 'Опять караульня. Стражники хоть строй держат, а ты — нет.'],
    death_castellan: ['Кастелян за рвом и решёткой. Запишу: «рычаг был, терпения не было».', 'Опять Кастелян. Решётку открывают, кот, а не бодают.'],
    death_troll: ['Тролль и его дубина. Глава оборвалась на последней строке — обиднее не бывает.', 'Опять Тролль. Ты отдыхал, он храпел и отращивал шкуру — записала обоих.'],
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
    about_monk: ['Евлампий требует записать «каялся». Я пишу «ныл» — летопись не исповедь.'],
    about_gambler: ['Шиш боится моих чернил. Правильно: его долги я записала в столбик.'],
    buy_3: ['«Путь в гарнизон». В Предместье покажу две карты — я и над стенами летала.'],
    win_garrison_first: ['Гарнизон пройден. Открываю новый том — старый кончился на Кастеляне.'],
    trace_herb: ['Марфа ушла за корнем, в сторону Тролля. Записала: вернётся после похода.'],
    trace_smith: ['Ерофей ушёл точить в ближний лес. Ищи его на ранних привалах.'],
    trace_gambler: ['Шиш ушёл к столу. Кружку оставил, кости тоже, долги — само собой.'],
    locked3: ['Эту страницу открою, когда дойдёшь до гарнизона. Раньше — не по чину.'],
    pack: ['В лесу появилось новое. Я внесла в опись три строки.'],
    // Task 50 §18 (design 20.10.2026): once a profile, after the first run that offered the archetype (`LineContext.last.habitOffered`).
    habit_first: ['Повадку я записала. Теперь такие вещи тебе будут чаще попадаться на глаза'],
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
    death_guardroom: ['В караульне помяли. Стражники строем на одного — где их совесть?', 'Опять караульня. Синяки ровные, строем били.'],
    death_castellan: ['Болт самострела вынула. Нечего топтаться у решётки, котище.', 'Опять Кастелян? Сиди смирно, от тебя рвом пахнет.'],
    death_troll: ['Тролль дубиной приложил. Шишка с кулак — мажу, не дёргайся.', 'Опять Тролль. Не давай ему храпеть — он от сна крепчает.'],
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
    about_monk: ['Евлампий молится, я лечу. Он хоть не мешает, и на том спасибо.'],
    about_gambler: ['Шиш меня тётушкой зовёт. Лечу бесплатно — с него всё равно нечего взять.'],
    buy_3: ['На-ка склянку к воротам. Одну из двух — выбирай, не жадничай.'],
    win_garrison_first: ['Гарнизон прошёл и вернулся? Сядь, дай отдышаться — мне, не тебе.'],
    leave: ['Ухожу за корнем, по дороге к Троллю. Встретишь на привале — не шуми.'],
    back_met: ['Встретились на привале — и склянку не разбил. Растёшь.'],
    back_missed: ['Не дождалась тебя на привале. Ладно, корень и без тебя нашла.'],
    meet_hello: ['Ох, дошёл-таки. Садись, у меня травы на привале сохнут.'],
    meet_deal: ['Два ресурса — и склянка твоя. Из двух выбирай, рука-то не резиновая.'],
    meet_no: ['Не надо — и не надо. Иди, только не хромай.'],
    locked3: ['Этот отвар — как дойдёшь до гарнизона. Там травы другие, злые.'],
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
    death_guardroom: ['Караульня. Строй рубят в шов, а не в лоб.', 'Опять караульня. Латы у них дрянь, а ты всё равно лёг.'],
    death_castellan: ['Кастелян. Сперва рычаг, потом ядро. Порядок, малый.', 'Опять решётка. Железо доброе — сам бы такое ковал.'],
    death_troll: ['Тролль. Дубина сучковатая, а бьёт как молот.', 'Опять Тролль. Бей, пока не уснул, — потом поздно.'],
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
    about_monk: ['С Евлампием сидим, молчим. Добрый собеседник.'],
    about_gambler: ['Шиш должен мне. «Вот-вот отдам» — третий год слышу.'],
    buy_3: ['«Правка в гарнизоне». Худая награда в караульне — разок перебросишь.'],
    win_garrison_first: ['Гарнизон прошёл. Сталь там добрая была — а ты острее.'],
    leave: ['Пойду, колесо поправлю. Ищи на первых привалах леса.'],
    back_met: ['Встретились на привале. Добро — колесо по тебе скучало.'],
    back_missed: ['Не дождался. Колесо зря крутил.'],
    meet_hello: ['Малый. Садись, пока точу.'],
    meet_deal: ['Два ресурса — и выбирай талисман из двух. Наточил сам.'],
    meet_no: ['Не надо — не бери. Торговаться не стану.'],
    locked3: ['Третья правка — как дойдёшь до гарнизона. Там сталь другая.'],
    pack: ['Новое железо в лесу. Бери, да проверь кромку.'],
    // Task 50 §18: once a profile, after the first run that offered the knack (`LineContext.last.knackOffered`).
    knack_first: ['Сноровка — это точить то, что уже в руке. Новое бери, когда старое тупится'],
  },
  // Task 51в: Шиш (docs/design-notes/npc-lines-v2.md, «Шиш, гоблин-шулер»; `leave`, `back_*`, `meet_*` wait for 51д).
  gambler: {
    first_won: ['Ты обчистил меня в «Костях», партнёр. Свои выгнали — теперь греюсь у твоего костра.'],
    first_lost: ['Продул ты в круге, партнёр. Я тебе подмигивал — за то меня и выгнали.'],
    first_self: ['Не звал, а я пришёл. Из круга меня выгнали, а костёр у тебя тёплый.'],
    win: [
      'Победил! Я на тебя ставил, партнёр, — мысленно, зато всё.',
      'Опять дошёл. Шёл бы ты так за столом — мы бы озолотились.',
    ],
    win_garrison_first: ['Кастеляна прошёл! Скажу всем, что это мой партнёр, — с поверивших по медяку.'],
    death_crowd: ['Толпа навалилась. Когда их больше, я встаю из-за стола, партнёр.'],
    death_archer: ['Лучник метку ставит заранее, партнёр. В круге за такую подсказку платят!'],
    death_sapper: ['Сапёр с фитилём, а ты рядом. Я от фитилей бегу первым — и живой.'],
    death_jailer: ['Тюремщик и гиря. Я, прости, ставил на гирю — у неё шансы лучше.'],
    death_final: ['Последний рубеж! До банка шаг оставался — обиднее только мой долг.'],
    death_fire: ['В огненный след наступил? Я бы на такое и медяка не поставил.'],
    death_other: ['Не знаю, что тебя уложило, партнёр. Но я на него не ставил — честно.'],
    death_guardroom: ['Караульня! Строй в лоб не берут, партнёр, — я бы в окно и бежать.'],
    death_castellan: ['Кастелян за решёткой сидит, как банкир. Без рычага к нему не подсядешь.'],
    death_troll: ['Тролль храпел, а ты ждал? Спящего обыгрывают, партнёр, — пока не проснулся.'],
    record: [
      'Дальше прежнего, партнёр! Ставлю, что в следующий раз будет ещё дальше.',
      'Опять рекорд. Скоро на тебя ставок никто не примет — скучно выигрывать.',
    ],
    buy_1: ['«Шишова лавка» открыта! Не глянулся товар у торговца — перетасую разок.'],
    buy_2: ['«Размен», партнёр: три смолы — две росы. Это не грабёж, а комиссия.'],
    buy_3: ['У торговцев гарнизона тоже перетасую. Свой человек везде найдётся.'],
    quest_give: ['Вернись с десятью ресурсами, партнёр. Что в Повозку сдал — тоже считаю.'],
    quest_done: [
      'Десять ресурсов! Вот это хватка — я аж прослезился.',
      'Опять с полными карманами. Учишься, партнёр, — скоро меня обставишь.',
    ],
    quest_fail: [
      'Меньше десяти принёс. Спустил всё, как я в лучшие годы.',
      'Опять пустые карманы. Запас любит счёт, партнёр, а ты его — нет.',
    ],
    casino_won: ['Выиграл в круге? Мои бывшие теперь плюются, а я горжусь.'],
    casino_lost: ['Продул в круге? Восьмёрка не пришла — бывает, со мной всю жизнь.'],
    about_owl: ['Сова мои долги чернилами пишет. Карандашом бы — я бы договорился.'],
    about_herb: ['Тётушка Марфа лечит меня бесплатно. Единственная сделка, где я в плюсе.'],
    about_smith: ['Ерофею я должен, вот-вот отдам. Он точит нож и смотрит — ждёт.'],
    about_monk: ['Евлампий — сглаз ходячий. Сядет рядом — и кость сразу на единицу.'],
    idle: [
      'Сыграем на интерес, партнёр? На твой интерес — твоими ресурсами.',
      'Эта кость не кривая, у неё характер. Не трогай.',
      'Коплю на место за столом круга. Пока скопил на табурет.',
      'Карта в рукаве — для тепла. Ночи у Очага холодные.',
    ],
    leave: ['Пойду к столу, отыграться. Ищи меня на привале по дороге к Главарю.'],
    back_met: ['Встретились на привале — я тебя сразу узнал. По кошельку.'],
    back_missed: ['Ждал тебя на привале, пока не проигрался. Недолго ждал.'],
    meet_hello: ['Партнёр! Тише, я тут не за столом — я тут скупаю.'],
    meet_deal: ['Одну склянку — за два ресурса. «Скупка» честная, я сам считал.'],
    meet_no: ['Не хочешь — и ладно. Я тебя тут не видел, партнёр.'],
    locked3: ['«Лавка в гарнизоне» — как дойдёшь до гарнизона. Раньше там меня не знают.'],
  },
  // Task 51г: Евлампий (docs/design-notes/npc-lines-v2.md, «Евлампий, расстрига»).
  monk: {
    first: [
      'Ты разрубил кандалы Ключника. Звон я узнал: сам такие благословлял.',
      'Я Евлампий, расстрига. Служил колдуну, теперь сижу у твоего костра — и молчу об этом.',
    ],
    first_self: ['Кандалов ты не рубил, а я всё равно пришёл. В замке колдуна стало тесно.'],
    win: [
      'Победа. Я бы помолился в благодарность, но отвык — и кому?',
      'Опять победа. Не зазнавайся, чадо: гордыню я знаю изнутри.',
    ],
    win_garrison_first: ['Кастелян пал. Колдун теперь знает, где ты, — а значит, и где я.'],
    death_crowd: ['Толпа задавила. Колдун так и проповедовал: «один — ничто, сто — воля».'],
    death_archer: ['Лучник метил заранее, чадо. Метка — та же исповедь: всё сказано наперёд.'],
    death_sapper: ['Сапёр и фитиль. Я бы благословил тебя на бегство — жаль, сан сняли.'],
    death_jailer: ['Тюремщик. Я за него когда-то молился — видно, молитва дошла.'],
    death_final: ['Последний рубеж, последняя строка. Не моя вина — впервые за долгое время.'],
    death_fire: ['Огненный след. Колдун любит огонь, чадо, — не корми его собой.'],
    death_other: ['Чем тебя уложило, не скажу. Неясыть запишет, а я отмолчусь.'],
    death_guardroom: [
      'Караульня. Этих стражников я когда-то наставлял: строй держать до смерти.',
      'Опять караульня. Строй стоит, как моя совесть, — и не пускает.',
    ],
    death_castellan: [
      'Кастелян за решёткой, за рвом. Колдун его ценил: тот умеет ждать.',
      'Опять Кастелян. Рычаг, чадо, рычаг — даже я это понял.',
    ],
    death_troll: ['Тролль. Лесная тварь, колдуну не служит — хоть тут я ни при чём.'],
    record: [
      'Дальше прежнего. Записать бы это в мой послужной список — да его сожгли.',
      'Опять дальше. Ещё немного — и я в тебя поверю, не торопи.',
    ],
    buy_1: ['Обет, чадо. Возьми один — и держи, как я не умел.'],
    buy_2: ['Два обета разом. Сам бы не взял — я и одного не держу.'],
    locked3: ['Остальное скажу после замка колдуна. Туда я пока даже не смотрю.'],
    vow_kept: [
      'Обет сдержан. Хоть кто-то у этого костра держит слово.',
      'Опять сдержал. Ты меня позоришь, чадо, — продолжай.',
    ],
    vow_broken: [
      'Обет нарушен. Не стыдись — я свои ломал по три за утро.',
      'Опять нарушил. Ничего, чадо: обеты для того и дают, чтобы каяться.',
    ],
    quest_give: ['Разруби кандалы дважды. Пусть Ключник поймёт, что ковать впустую — тоже грех.'],
    quest_done: ['Двое кандалов разрублено. Звон слышал отсюда — лучшая служба на моей памяти.'],
    quest_fail: ['Кандалы целы. Я тоже когда-то не решился рубить, чадо.'],
    memory_cuts: ['Ты рубил кандалы, и узник кусал своих. Колдун такого не прощает.'],
    memory_castellan: ['Кастеляна одолел. Я смотрел и впервые не знал, за кого молиться.'],
    about_owl: [
      'Неясыть записала, что я «ныл». Я каялся — пусть так и пишет.',
      'Опять спорили с совой. Она пишет правду, я — то, что можно вынести.',
    ],
    about_herb: ['Марфа лечит, а я только молился. Её работа честнее моей.'],
    about_smith: ['С Ерофеем мы молчим вместе. Лучшая беседа в лагере.'],
    about_gambler: ['Шиш зовёт меня сглазом, а медяк берёт. Мой медяк он проиграет первым.'],
    idle: [
      'Я не прячусь. Я сижу спиной к замку колдуна — это разное.',
      'Дал обет молчать до утра. Уже нарушил, как видишь.',
      'Знак колдуна я с рясы содрал, а дыра осталась — сквозит.',
      'Книгу мою не открывай. Там мои проповеди, и они до сих пор светятся.',
    ],
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
  herb: { win_garrison_first: [1], back_met: [1], meet_hello: [1], first: [1], first_self: [1], win_first: [1], win: [1, 2], death_crowd: [1], death_sapper: [1, 2], death_final: [1], death_fire: [2], record: [1], buy_2: [1], quest_done: [2], quest_fail: [1], idle: [2, 3, 4] },
  smith: { win_garrison_first: [1], meet_hello: [1], first: [1, 2], first_self: [1], win_first: [1], win: [1, 2, 3], death_crowd: [1], death_archer: [1], death_sapper: [2], death_jailer: [2], death_final: [1], death_fire: [1, 2], death_other: [2], record: [1, 2], quest_done: [1, 2], quest_fail: [2], idle: [1, 2, 4] },
  // Task 51в, design table «Метка `cat`» (Шиш, v2): the lines that put a verb about the hero in the masculine.
  gambler: { first_won: [1], first_lost: [1], first_self: [1], win: [1, 2], win_garrison_first: [1], death_fire: [1], death_troll: [1], quest_fail: [1], casino_won: [1], casino_lost: [1] },
  // Task 51г, design table «Метка `cat`» (Евлампий, v2).
  monk: { first: [1], first_self: [1], vow_kept: [2], vow_broken: [2], memory_cuts: [1], memory_castellan: [1] },
};

/** The occasion of a line now. */
export interface LineContext {
  /** Task 49: the hero of the last run — 'toad' (Ведунья); absent — the cat's (or no run yet). */
  hero?: 'toad';
  /** The NPC came by itself (the fallback way) — its meeting line is `first_self`. */
  self?: boolean;
  /** The occasions of the last run (said once per camp visit). */
  last?: { won: boolean; habitOffered?: true; knackOffered?: true; firstWin?: boolean; cause?: DeathCause; record?: boolean; questDone?: boolean; questFail?: boolean; pack?: boolean; casino?: 'won' | 'lost'; cuts?: number; vows?: 'kept' | 'broken'; castellan?: boolean; garrisonWon?: boolean; away?: 'met' | 'missed' };
  /** Just bought this level. */
  bought?: 1 | 2 | 3;
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
  // After her run (`hero` 'toad'): her variants first, then the lines without the mark `cat`, counted apart (`npc:key:toad`). Design
  // 17.10.2026: the meeting keys (`first`, `first_self`) - one count for the profile, the NPC is met once whoever the hero; the first-win keys
  // (`win_first`, `win_garrison_first`) - by hero: her first win is her news, her variant or, with none, the ordinary `win`.
  const toad = ctx.hero === 'toad', tail = toad ? ':toad' : '';
  const L = NPC_LINES[npc];
  // Task 51в: Шиш's first meeting is `first_won` / `first_lost` (by the last game of the goblins' circle) - one count `npc:first` with `first`.
  // Task 50 §18: `habit_first` / `knack_first` are said once a profile, whoever the hero (one count, like the meeting).
  const meeting = (key: LineKey): boolean => key === 'first' || key === 'first_self' || key === 'first_won' || key === 'first_lost' || key === 'habit_first' || key === 'knack_first';
  const memoryKey = (key: LineKey): LineKey => (key === 'first_won' || key === 'first_lost' ? 'first' : key);
  const firstWin = (key: LineKey): boolean => key === 'win_first' || key === 'win_garrison_first';
  const mark = (key: LineKey): string => (meeting(key) ? '' : tail);
  const count = (key: LineKey): number => memory[`${npc}:${memoryKey(key)}${mark(key)}`] ?? 0;
  const line = (key: LineKey, once = false): { key: LineKey; text: string; id: string } | null => {
    const marked = toad ? CAT_MARKED[npc][key] ?? [] : [], own = toad ? TOAD_LINES_BY_NPC[npc][key] ?? [] : [];
    const list = [...own, ...toad && firstWin(key) ? [] : (L[key] ?? []).filter((_, i) => !marked.includes(i + 1))];
    if (!list.length) return null;
    const n = count(key);
    // The meeting ends with the lines the key has for the cat (the same for both heroes).
    if (once && n >= (meeting(key) ? Math.max(L[key]?.length ?? 0, 1) : list.length)) return null;
    return { key, text: list[n % list.length], id: `${npc}:${memoryKey(key)}${mark(key)}` };
  };
  const meet = ctx.self ? line('first_self', true) : null;
  const first = meet ?? (count('first_self') ? null : line(npc === 'gambler' ? (ctx.last?.casino === 'won' ? 'first_won' : 'first_lost') : 'first', true));
  if (first) return first;
  // A purchase line the mark skips (after her run) gives way to the next occasion.
  const buy = ctx.bought ? line(`buy_${ctx.bought}` as LineKey) : null;
  if (buy) return buy;
  const last = ctx.last;
  if (last) {
    // Task 51д: the NPC came back from the road — `back_met` (met on a rest) or `back_missed`.
    const occasion = (last.away && line(last.away === 'met' ? 'back_met' : 'back_missed')) || (last.questDone && line('quest_done')) || (last.questFail && line('quest_fail')) || (npc === 'owl' && last.habitOffered && line('habit_first', true)) || (npc === 'smith' && last.knackOffered && line('knack_first', true)) || (last.firstWin && line('win_first', true))
      // Task 51: the garrison passed - the first time for the hero is `win_garrison_first` (the three of v1, said once by hero like `win_first`), then the ordinary occasion.
      || (last.garrisonWon && (npc === 'owl' || npc === 'herb' || npc === 'smith') && line('win_garrison_first', true))
      || (last.record && line('record')) || (last.pack && line('pack')) || (last.casino && line(last.casino === 'won' ? 'casino_won' : 'casino_lost'))
      // Task 51г (Евлампий): the vows' result, the garrison passed, the shackles cut in the last run.
      || (last.vows && line(last.vows === 'kept' ? 'vow_kept' : 'vow_broken')) || (last.castellan && line('memory_castellan')) || (last.cuts && line('memory_cuts')) || (last.won && line('win')) || (last.cause && (line(`death_${last.cause}`) ?? line('death_other')));
    if (occasion) return occasion;
  }
  const idle = count('idle'), about = ctx.others.filter(o => o !== npc).map(o => `about_${o}` as LineKey).filter(k => L[k]);
  if (about.length && idle % 4 === 3) return { ...line(about[(idle >> 2) % about.length])!, id: `${npc}:idle${tail}` };
  return line('idle')!;
}

/**
 * Task 51д: one line of a key outside the camp's turn-taking (`leave`, `trace_*`, `meet_*`): the key's lines in turn by the memory `npc:key`
 * (`:toad` after her run: her variants first, then the lines without the mark `cat`). Null — the key has no line for this hero.
 */
export function npcLine(npc: NpcId, key: LineKey, hero: 'toad' | undefined, memory: LineMemory): { text: string; id: string } | null {
  const tail = hero === 'toad' ? ':toad' : '', marked = hero === 'toad' ? CAT_MARKED[npc][key] ?? [] : [];
  const list = [...hero === 'toad' ? TOAD_LINES_BY_NPC[npc][key] ?? [] : [], ...(NPC_LINES[npc][key] ?? []).filter((_, i) => !marked.includes(i + 1))];
  if (!list.length) return null;
  return { text: list[(memory[`${npc}:${key}${tail}`] ?? 0) % list.length], id: `${npc}:${key}${tail}` };
}

/** The words of the NPC's quest as it gives it (Неясыть at a record of 10: «Пройди лес»). */
export function questLine(npc: NpcId, final: boolean, memory: LineMemory): string {
  const list = NPC_LINES[npc][npc === 'owl' && final ? 'quest_give_final' : 'quest_give'] ?? [];
  return list.length ? list[(memory[`${npc}:quest_give`] ?? 0) % list.length] : '';
}
