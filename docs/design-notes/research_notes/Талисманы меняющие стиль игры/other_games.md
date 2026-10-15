# Предметы, которые меняют правило главного действия (рогалики, кроме Isaac)

Заметки помощника, 15.10.2026. Isaac разбирает другой помощник.

Сила источника:
- **[сильный]** — файлы игры (копии в `D:\ashen_research\games\`), официальный блог или интервью разработчика.
- **[средний]** — вики сообщества.
- **[слабый]** — гайды, агрегаторы, форумы.

Разбор файлов делали мои скрипты из `D:\ashen_research\scripts\rulebend\` (Python с `-I`). Игры не запускались. Код и дампы игр в репозиторий не попали. Деление предметов на классы («правило», «движок», «счётчик», «число») — моя ручная разметка, а не данные игры. Классы такие:
- **ПРАВИЛО** — меняет, что разрешено, что сохраняется между ходами, что видно или как разрешается действие;
- **ДВИЖОК** — новая связь «событие A → эффект B», из неё вырастает архетип;
- **СЧЁТЧИК** — «каждое N-е», «N раз за ход», «каждые N ходов»;
- **ЦЕНА** — сильный бонус за запрет или штраф;
- **ЧИСЛО** — плоский стат, бонус в начале боя, лечение;
- **МЕТА** — вне боя: экономика, карта, награды, правка колоды.

## 1. Balatro: джокеры, которые гнут правило руки, и джокеры-числа

### Takeaway
Из 150 джокеров около 29 % не числовые («Effect» 37 + «Retrigger» 6). Лишь около десятка из них гнут само правило покерной руки. Почти все такие джокеры — Uncommon. Копировщики (Blueprint, Brainstorm) — Rare. Сами по себе они очков не дают: они открывают руку, а платят за неё джокеры-числа.

### Cited Findings
- 150 джокеров. Редкость: Common 61, Uncommon 64, Rare 20, Legendary 5. Тип по вики: Effect 37, xMult 35, +Mult 33, Chips 19, Economy 18, Retrigger 6, Chips+Mult 2 — [Balatro Wiki: Jokers](https://balatrowiki.org/w/Jokers) [средний].
- Джокеры, которые гнут правило руки (текст и редкость с той же страницы) — [Balatro Wiki](https://balatrowiki.org/w/Jokers) [средний]:
  - Four Fingers (U): «All Flushes and Straights can be made with 4 cards»;
  - Shortcut (U): «Allows Straights to be made with gaps of 1 rank»;
  - Smeared Joker (U): «Hearts and Diamonds count as the same suit, Spades and Clubs count as the same suit»;
  - Pareidolia (U): «All cards are considered face cards»;
  - Splash (C): «Every played card counts in scoring»;
  - Blueprint (R): «Copies ability of Joker to the right»;
  - Brainstorm (R): «Copies the ability of leftmost Joker»;
  - Midas Mask (U): «All played face cards become Gold cards when scored»;
  - Oops! All 6s (U): «Doubles all listed probabilities»;
  - Showman (U): «Joker, Tarot, Planet, and Spectral cards may appear multiple times»;
  - Mime (U): «Retrigger all card held in hand abilities»;
  - Hack (U): «Retrigger each played 2, 3, 4, or 5».
- Vampire (U) вики относит к xMult: «gains X0.1 Mult per scoring Enhanced card played, removes card Enhancement». Это число, которое растёт, но каждый раз ест ресурс колоды — [Balatro Wiki](https://balatrowiki.org/w/Jokers) [средний].
- LocalThunk: сначала джокеров не было. Их ввели как «a kind of 'passive' item», потому что ранней игре не хватало глубины — [Rogueliker, интервью](https://rogueliker.com/balatro-interview/) [сильный].
- LocalThunk о балансе: «Every Joker has gone through some kind of balance change… sometimes effects are scrapped entirely». Плохой джокер — тот, что «just too good and cannibalises all the adjacent strategies around it». И ещё: «almost all balance changes can be made by changing a number» — [Rogueliker](https://rogueliker.com/balatro-interview/) [сильный].
- Пресса отмечает, что часть джокеров «completely break the rules of poker altogether» (флеш и стрит из 4 карт и т. п.). LocalThunk: «I'm very shocked when that happens because I'm not very good at this game» — о рекордных счетах игроков — [PC Gamer через Yahoo](https://uk.news.yahoo.com/dont-play-poker-says-solo-212210290.html) [средний].
- Истоки концепции: игра Big 2 и видео о Luck Be a Landlord — [TouchArcade](https://toucharcade.com/2024/03/18/balatro-interview-mobile-port-localthunk-dlc-plans-updates-new-jokers-demo-feedback/) [сильный, интервью].

### Inferences
- По Balatro напрашивается модель «правило отдельно, плата отдельно». Four Fingers или Smeared сами урона не дают. Они делают частую руку достижимой, а очки ей дают +Mult/xMult. Правило-предмет в Balatro — открыватель архетипа, не источник силы. Поэтому его можно сделать Uncommon и не бояться, что он сломает баланс один.
- Как меняется поведение. Four Fingers и Shortcut: игрок перестаёт копить 5 карт масти и чаще играет флеши и стриты. Smeared: колода из 4 мастей становится колодой из 2, Tarot на смену масти теряют смысл. Pareidolia: все карт-«лица» срабатывают для Scary Face, Smiley и других. Splash: в счёт идут «мусорные» карты, и выгодно играть 5 карт всегда. Blueprint и Brainstorm: важен порядок джокеров, появляется пространственная головоломка на полке.
- Почему игра остаётся собой. Правило гнётся внутри знакомого словаря: масть, ранг, «лицо», рука из 5 карт. Новых действий нет. Меняется то, что считается «той же» картой или «полной» рукой.
- Перенос на Ashen Oath (гипотеза, не решение): «цвет» и «длина цепи» — наш аналог масти и размера руки. Прямые кальки: «два цвета считаются одним» (Smeared), «цепь из N−1 засчитывается как N для порогов» (Four Fingers), «в проход идут и соседи звеньев» (Splash), «копирует талисман справа» (Blueprint).
- Счёт вики (37 Effect) завышает долю «правил». В Effect входят и генераторы карт (8 Ball, Séance, Cartomancer), и экономика. По моей разметке собственно правила руки и подсчёта — около 10 джокеров из 150 (≈7 %), плюс 6 Retrigger.

### Gaps
- Нет прямых слов LocalThunk именно о джокерах, меняющих правила. Подкаст Game Maker's Notebook ([ссылка](https://gamemakersnotebook.libsyn.com/balatro-creator-localthunk-talks-inspirations-and-jokers)) может их содержать — не прослушан.
- Файлов Balatro в `D:\ashen_research` нет. Числа взяты с вики, без сверки с `game.lua`.
- Известные проблемы баланса конкретных джокеров (Blueprint/Brainstorm с xMult) первоисточником не подтверждены.

## 2. Slay the Spire: реликвии, меняющие стиль, и числовые; StS2 (2026)

### Takeaway
По файлам StS 1 (v2.3.4) из 177 реликвий (без тестовых и косметических) ПРАВИЛО — 24 (14 %), ДВИЖОК — 21 (12 %), СЧЁТЧИК — 13 (7 %), ЦЕНА — 11 (6 %), ЧИСЛО — 62 (35 %), МЕТА — 46 (26 %). Правила сосредоточены в Uncommon, Rare, Shop и Boss: среди Common правило ровно одно (Boot). Босс-реликвию выбирают 1 из 3, и треть их — «энергия за запрет».

### Cited Findings
- Разметка по редкостям (тиры из `RelicTier` в декомпилированных классах, тексты из `localization/eng/relics.json`) — [файлы StS: decomp\cardcrawl\relics, relics.json](file:///D:/ashen_research/games/slay_the_spire/) [сильный, разметка моя]:

  | Тир | ПРАВИЛО | ДВИЖОК | СЧЁТЧИК | ЦЕНА | ЧИСЛО | МЕТА | Всего |
  |---|---|---|---|---|---|---|---|
  | Starter | 0 | 0 | 0 | 0 | 4 | 0 | 4 |
  | Common | 1 | 1 | 3 | 0 | 19 | 12 | 36 |
  | Uncommon | 7 | 4 | 6 | 0 | 9 | 11 | 37 |
  | Rare | 7 | 9 | 3 | 0 | 9 | 6 | 34 |
  | Shop | 4 | 4 | 0 | 1 | 6 | 5 | 20 |
  | Boss | 2 | 3 | 1 | 10 | 8 | 6 | 30 |
  | Special (события) | 3 | 0 | 0 | 0 | 7 | 6 | 16 |
  | **Всего** | **24** | **21** | **13** | **11** | **62** | **46** | **177** |

- Обычные реликвии (сундуки, элиты) выпадают по тирам 50/33/17 % (Common/Uncommon/Rare): `commonRelicChance = 50; uncommonRelicChance = 33; rareRelicChance = 17` в `Exordium.java`, `TheCity.java`, `TheBeyond.java`. Босс-сундук кладёт 3 реликвии `RelicTier.BOSS`, игрок берёт одну (`BossChest.java`, цикл `i < 3`) — [файлы StS](file:///D:/ashen_research/games/slay_the_spire/decomp/cardcrawl/) [сильный].
- Реликвии из запроса, текст из игры (числа в квадратных скобках взяты из констант кода: `VelvetChoker` `counter >= 6`, `ChemicalX.BOOST = 2`, `Calipers.BLOCK_LOSS = 15`, `Necronomicon.COST_THRESHOLD = 2`) — [relics.json](file:///D:/ashen_research/games/slay_the_spire/jar_unzipped/localization/eng/relics.json) [сильный]:
  - Snecko Eye (Boss): «At the start of your turn, draw 2 additional cards. Start each combat Confused» (Confused — случайная стоимость карт);
  - Runic Pyramid (Boss): «At the end of your turn, you no longer discard your hand»;
  - Velvet Choker (Boss, энергия): «You cannot play more than [6] cards per turn»;
  - Runic Dome (Boss, энергия): «You can no longer see enemy intents»;
  - Ice Cream (Rare): «Energy is now conserved between turns»;
  - Dead Branch (Rare): «Whenever you Exhaust a card, add a random card into your hand»;
  - Unceasing Top (Rare): «Whenever you have no cards in hand during your turn, draw a card»;
  - Chemical X (Shop): «The effects of your cost X cards are increased by [2]»;
  - Necronomicon (Special, событие): «The first Attack played each turn that costs [2] or more is played twice. Upon pickup, obtain a special Curse»;
  - Kunai и Shuriken (Uncommon): «Every time you play 3 Attacks in a single turn, gain Dexterity / Strength»;
  - Blue Candle (U) и Medical Kit (Shop): неиграбельные Curse/Status становятся играбельными;
  - Calipers (Rare): «lose [15] Block rather than all of your Block»;
  - Pocketwatch (Rare): «Whenever you play 3 or less cards during your turn, draw 3 additional cards»;
  - Art of War (Common): «If you do not play any Attacks during your turn, gain an additional [energy]».
- Босс-реликвии с ценой (10 из 30): Busted Crown, Coffee Dripper, Cursed Key, Ectoplasm, Fusion Hammer, Mark of Pain, Philosopher's Stone, Runic Dome, Sozu, Velvet Choker. Все дают энергию и забирают правило: отдых, ковку, золото, зелья, видимость намерений, число карт за ход — [relics.json](file:///D:/ashen_research/games/slay_the_spire/jar_unzipped/localization/eng/relics.json) [сильный].
- СЧЁТЧИКИ StS (13): Happy Flower, Nunchaku, Pen Nib (Common); Ink Bottle, Kunai, Letter Opener, Ornamental Fan, Shuriken, Sundial (Uncommon); Incense Burner, Pocketwatch, Stone Calendar (Rare); Inserter (Boss) — [файлы StS](file:///D:/ashen_research/games/slay_the_spire/) [сильный, разметка моя].
- Мнения игроков о Snecko Eye расходятся: «the worst boss relic» против «very good given the correct deck» и «very strong with high cost decks» — [Steam, обсуждение](https://steamcommunity.com/app/646570/discussions/0/3490879839966910366) [слабый].
- **StS2.** Ранний доступ с 5 марта 2026 — [OneMoreGame](https://onemoregame.ph/?p=144488) [слабый]. Фан-база StS2 (данные Beta v0.111, обновлено 16.08.2026): 311 реликвий; редкости Common, Uncommon, Rare, Shop, Starter, **Ancient**, Event, Token. Реликвии получают из наград, у торговца, в событиях и у Ancients. В роли Ancient — бывшие босс-реликвии с ценой (Ectoplasm, Sozu, Velvet Choker) и новые: Fiddle — «You may not draw cards during your turn» и +2 карты в начале хода; Precarious Shears — убрать 2 карты, потерять 16 HP — [slaythespire2.gg/relics](https://slaythespire2.gg/relics) [слабый/средний, фан-сайт]. Snecko Eye в StS2 база помечает как Ancient — [brokenbuilds.gg](https://brokenbuilds.gg/slay-the-spire-2/relics/snecko-eye) [слабый].
- В StS2 появилась прочность (Durability): часть реликвий работает ограниченное число раз за бой — [inkl](https://www.inkl.com/news/slay-the-spire-2-relics-tier-list-best-relics-for-each-character-early-access) [слабый]. Патч сделал реликвии в магазине дешевле на 25 золота и убрал оттуда реликвии, дающие золото — [GosuGamers](https://www.gosugamers.net/entertainment/news/78295-slay-the-spire-ii-update-targets-ascension-economy-and-top-builds-in-latest-patch) [слабый].

### Inferences
- Главный урок дозировки. Правило почти никогда не бывает Common. На Common лежат числа, на Uncommon и Rare — правила и движки. Самые сильные правила — Boss: выбор 1 из 3 и часто цена в виде запрета. Цена гнёт другое правило: Velvet Choker даёт энергию, но не больше 6 карт за ход. Цена — тоже смена стиля, а не просто минус.
- Как меняется поведение:
  - Runic Pyramid: рука копится. Игрок держит ответы на будущие ходы, а мусор в руке становится проблемой.
  - Ice Cream: можно пропустить ход ради взрыва на 6–9 энергии. Карты X-стоимости растут в цене (Chemical X).
  - Snecko Eye: колоду строят под дорогие карты, ведь случайная стоимость в среднем выгодна для дорогих.
  - Dead Branch: истощение из платы становится доходом, и выгодны карты, истощающие руку.
  - Unceasing Top: выгодна тонкая колода и карты по 0 энергии. Цель хода — опустошить руку.
  - Velvet Choker: дешёвые карты теряют ценность, ценнее дорогие и мощные.
  - Runic Dome: игра идёт вслепую. Защиту ставят «на всякий случай» или убивают быстрее.
- Почему игра остаётся собой. Не появляется ни одного нового действия. Гнётся одно звено цикла хода: добор, сброс, энергия, видимость, стоимость. Игрок по-прежнему играет карты на врагов за энергию.
- О счётчиках, важно для нас. Kunai и Shuriken тоже счётчики, но окно у них — **один ход** («3 Attacks in a single turn»). Игроку приходится планировать ход вокруг порога, поэтому они меняют стиль. Pen Nib (каждая 10-я атака) копится сам по себе и решений почти не требует. Наши «каждое 5-е звено +2 силы» ближе к Pen Nib. Если перенести порог внутрь одной цепи или одного прохода («в этой цепи ровно 5 звеньев»), счётчик станет требованием к форме цепи, как у Kunai.
- StS2 сохранила модель «сильная реликвия с запретом» и, судя по фан-базе, перенесла её из босс-сундука в Ancients (Fiddle — новый запрет на добор). Это слабое подтверждение того, что модель «цена-запрет» себя оправдала.

### Gaps
- Нет первоисточника Mega Crit (Casey Yano, Anthony Giovannetti) о замысле босс-реликвий или Snecko Eye. Поиск дал только форумы.
- Точные доли редкостей StS2 по официальным данным не получены. Фан-база не даёт разбивки, а файлов StS2 у нас нет (игра не куплена — не проверялось).
- Известные проблемы баланса StS1 (бесконечные циклы Dead Branch + истощение, Runic Pyramid + Retain) по памяти. Источником в этой сессии не подтверждены.

## 3. Hades и Hades II: молоты Дедала и Duo-благословения

### Takeaway
Молот Дедала меняет форму атаки оружия до конца забега. Официальные патчи показывают, что Supergiant следит за взаимоисключениями молотов. Источники по числам (сколько молотов за забег, сколько на оружие) и по словам Kasavin о молотах в этой сессии не найдены: данные слабые.

### Cited Findings
- Молоты — временные улучшения оружия на забег. Могут стоять наградой комнаты, в том числе в первой комнате Тартара — [Destructoid](https://destructoid.com/?p=560923) [слабый, через выдачу поиска].
- Официальный патч Hades: «Flurry Jab (Spear): adjusted auto-attack, improving interaction with Swift Strike (Hermes); fixed a bug where it could be offered if you had Flaring Spin» — [Supergiant, патч Blood Price](https://www.supergiantgames.com/blog/hades-the-blood-price-update-patch-notes-pt-1) [сильный, через выдачу поиска]. Значит, у молотов есть взаимные запреты и их связь с благословениями богов проверяют.
- Breaching Skewer (копьё) наносит 400 % урона броне. Взаимоисключения: если взят Flurry Slash или Cruel Thrust, другой молот не предлагается — [Gfinity](https://www.gfinityesports.com/hades/spear-build) [слабый].
- Hades II: у каждого из 6 оружий свой пул молотов, у Witch's Staff «more than a dozen upgrades». Молоты складываются, «Some upgrades are mutually exclusive», «Hammer offerings cannot be re-rolled». Молот бывает в первой комнате, в награде за комнату или реже у Charon. Сайт ссылается на «patch v1.0» — [RogueRanker](https://rogueranker.com/?p=12468) [слабый].
- В раннем доступе Hades II патч 4 переделал часть молотов (Melting Shedder, Inverted Spark, Rocket Bombard) — [Siliconera](https://www.siliconera.com/hades-2-early-access-patch-4-adjusts-boons-blessings-daedalus-hammer-upgrades/) [средний].
- Keepsake Experimental Hammer (Hades II) даёт случайный молот на 10/15/20/30 встреч в зависимости от ранга — [выдача поиска, Sportskeeda/Prima](https://www.sportskeeda.com/esports/what-daedalus-hammer-hades-2-upgrades-detailed) [слабый].

### Inferences
- Почему игра остаётся собой. Молот меняет форму одной кнопки (атака, особая атака), а не набор кнопок. Удар, рывок, каст остаются. Благословения богов вешаются на те же кнопки, поэтому молот и благословение перемножаются, а не конкурируют.
- Дозировка: молот редкий (комната-награда, не каждая); пул свой у каждого оружия; запреты на несовместимые формы; нет переброса. Это аналог «босс-реликвии» без цены: вес даёт редкость и необратимость.
- Перенос на нас (гипотеза): «молот» уже есть в нашей сборке. Образец Hades — молот меняет форму прохода, а не число урона: проход возвращается по цепи, проход бьёт звено дважды, прыжок завершает цепь ударом. Взаимоисключения пишутся явно.

### Gaps
- Не подтверждено, сколько молотов бывает за забег в Hades 1. По памяти обычно 2, но источник не найден: страницы fandom и wiki.gg отдали 402/401.
- Не найдено интервью Greg Kasavin или другого сотрудника Supergiant о замысле молотов. GDC 2021 Supergiant — о диалогах, не о боевой системе ([GDC](https://gdconf.com/news/dive-dialogue-hades-gdc-2021)).
- Duo-благословения (требуют благословений двух богов) в этой сессии не исследованы, их числа и тексты не сняты. Hades и Hades II не куплены, файлов нет.

## 4. Физика шара: Peglin, Ball x Pit

### Takeaway
Обе игры ближе всего к нашему «главному действию — траектории». В Ball x Pit смена правила встроена в слияние: два мяча максимального уровня дают новый мяч с новым поведением. В Peglin реликвии делятся на Common / Rare / Boss (58 / 74 / 25 страниц вики). Тексты реликвий Peglin в этой сессии не получены.

### Cited Findings
- Peglin: Common — в сундуках, Rare — за минибоссов или редко в сундуках, Boss — отдельный тир. Страниц в категориях: Boss 25, Common 58–59, Rare 73–74 — [peglin.wiki.gg/Relic](https://peglin.wiki.gg/wiki/Relic) [средний].
- Ball x Pit: эволюция — слияние двух базовых мячей в новый (Bleed + Brood Mother → Leech), есть многоступенчатые эволюции (Nosferatu, Satan) — [Nerdschalk](https://nerdschalk.com/ball-x-pit-all-combinations-list/) [слабый]. Оба мяча должны иметь максимальный уровень 3 — [Deltia's Gaming](https://deltiasgaming.com/?p=381498) [слабый].
- Ball x Pit: пассивы тоже эволюционируют. Cornucopia из Baby Rattle + War Horn: «baby ball creation sometimes spawn extra baby balls» — [Commonsense Gamer](https://commonsensegamer.com/ball-x-pit-all-passive-evolutions-combinations/) [слабый]. Лучшими эволюциями гайд считает Holy Laser, Maggot, Mosquito King, The Sun, Black Hole — [PCGamesN](https://www.pcgamesn.com/ball-x-pit/evolutions-tier-list) [слабый].
- Число пассивов в источниках расходится: 8 в одной статье Commonsense Gamer против длинной таблицы Dexerto после обновления Shadow — [Dexerto](https://www.dexerto.com/wikis/ball-x-pit/all-passives/) [слабый].

### Inferences
- Модель Ball x Pit (рецепт A + B → новое поведение) — тот же приём, что эволюции в Vampire Survivors (раздел 5). Правило меняется не находкой, а сборкой двух уже прокачанных частей. Игрок заранее видит цель и ведёт к ней забег.
- Для нас это довод в пользу «рецептов»: два талисмана максимального уровня сливаются в талисман-правило. Так правило приходит поздно и заслуженно, а ранний забег остаётся числовым и понятным.

### Gaps
- Тексты реликвий Peglin, меняющих физику (Matryoshka Shell, Kinetic Meteorite, Gardener's Gloves, Sealed Conviction и др.), не получены. Отдельные страницы не открывались, fandom отдал 402. Официальный девлог [The Relic Update](https://gedig.itch.io/peglin/devlog/150004/the-relic-update) не прочитан.
- Нет слов разработчиков Ball x Pit (Kenny Sun / Devolver) о замысле эволюций.

## 5. Экшен-рогалики: Vampire Survivors, Brotato, Dead Cells, Nova Drift, Noita, Risk of Rain 2

### Takeaway
В экшене смена правила живёт в трёх местах: в позднем рецепте (эволюции VS), в предмете с отдельной ценой или окном выбора (аркана VS, лунные предметы RoR2, легендарные аффиксы Dead Cells), в стартовом выборе персонажа (Brotato). Brotato показательна: предметы там почти все числа, а «стиль» вынесен в персонажей.

### Cited Findings
- **Vampire Survivors (v1.16.107, файлы)** [сильный]:
  - В `WEAPON_DATA.json` 55 записей с `evoInto`, в том числе пассивы, указывающие на эволюцию, и союзы двух оружий. Пример: Whip + Hollow Heart (`evoSynergy: MAXHEALTH`) → Bloody Tear; эволюция выдаётся на 8-м уровне оружия (`addEvolvedWeapon` в последней ступени).
  - Эволюции меняют качество, а не число: Holy Wand и Thousand Edge — «Fires with no delay»; Death Spiral и Hellfire — «Passes through enemies»; Unholy Vespers — «Never ends»; La Borra — «Damaging zones follow you and grow when they move»; Soul Eater — «Steals hearts»; Infinite Corridor — «Halves enemies' health»; Crimson Shroud — «Caps incoming Damage at 10».
  - Источник — [WEAPON_DATA.json](file:///D:/ashen_research/games/vampire_survivors/assetripper/ExportedProject/Assets/TextAsset/WEAPON_DATA.json).
- **Аркана VS (файл `ARCANA_DATA.txt`)**: 22 основные (0–XXI) [сильный]. По моей разметке 15 из 22 меняют правило, 7 — числа или колебания статов. Примеры:
  - Game Killer: «Halts XP gain. Experience Gems turn into exploding projectiles»;
  - III Tragic Princess: «The cooldown of the listed weapons reduces when moving»;
  - VI Sarabande of Healing: «Recovering HP damages nearby enemies»;
  - XX Silent Old Sanctuary: «+20% Might and -8% Cooldown for each active weapon slot left empty»;
  - VII Iron Blue Will: до 3 отскоков и проход сквозь врагов и стены.
  - Есть второй набор из 13 записей того же формата (Stake to your Heart, «I - Sapphire Mist», «VIII - Edge of the Earth»: «Fixes MoveSpeed to 200%. Allows to walk through walls»). Источник — [ARCANA_DATA.txt](file:///D:/ashen_research/games/vampire_survivors/assetripper/ExportedProject/Assets/TextAsset/ARCANA_DATA.txt).
- **Brotato (v1.1.15.4, файлы)** [сильный]:
  - 177 предметов (`items/all/*/…_data.tres`). У 87 (49 %) все эффекты — простые статы (`effect.gd` с ключом `stat_*`). По тирам 1–4 доля чистых статов: 32/54, 21/54, 20/55, 14/33.
  - Среди остальных 90 большинство — стат + мелкий триггер (отбрасывание, сбор). Правила, по моей разметке, около 20: Ricochet (T4, `bounce`), Bandana и Sharp Bullet (`piercing`), Handcuffs (`hp_cap`), Shackles (`speed_cap`), Ball and Chain (`minimum_weapon_cooldowns`), Ghost Outfit (`dodge_cap`), Tardigrade (`hit_protection`), Pile of Books (`structures_can_crit`), Rip and Tear (`explode_on_death`), турели и мины (новый участник боя).
  - Источник — [items/all](file:///D:/ashen_research/games/brotato/recovered/items/all/).
- **Персонажи Brotato** — смена стиля на старте [сильный]:
  - One-Armed: «You can only equip one weapon at a time»;
  - Soldier: «You can’t attack while moving»;
  - Bull: `effect_no_weapons` + `explode_on_hit`;
  - Pacifist: «Gain {0} material and XP for every living enemy at the end of a wave»;
  - Lich: `EFFECT_DEAL_DMG_WHEN_HEAL`.
  - Источник — [items/characters, translations.csv](file:///D:/ashen_research/games/brotato/recovered/).
- **Dead Cells (`data.cdb`)** [сильный; в файле тексты на французском, перевод мой]:
  - 61 запись мутаций (`P_*`): Brutality 14, Tactic 13, Survival 12, бесцветные 22 (в том числе устаревшие и «использованные»).
  - Правила, меняющие кувырок: Porcupine Backpack — «Rolling through enemies attacks them with the melee weapon in backpack»; Tortoise Wheel — «Rolling parries attack and projectiles with the shield in your backpack»; Acrobatic Preparation — выстрел оружием из рюкзака после кувырка.
  - Правила-условия: Tranquilité — +% урона, если рядом нет врагов; Soin d'urgence — зелье лечит меньше, но быстрее и даёт неуязвимость; No Mercy — «Execute mobs under X% health. Effect halved for bosses»; Ygdar Orus Li Ox — спасает от смерти один раз и «Ne peut être retiré».
  - Источник — [data.cdb](file:///D:/ashen_research/games/dead_cells/res_expanded/data.cdb).
- **Легендарные аффиксы Dead Cells**: у предмета в `legendAffixes` список возможных. Частые: DoubleStack («Applies 2 stacks of damage over time instead of 1») у 10 предметов, SuperPierce («Les tirs transpercent tous les ennemis») у 9, DoubleBullets у 6, MegaCrit у 7. Редкие правила: Combined («Fusionne les deux armes»), LastCycleSpam («Ne joue que le dernier combo de l'arme»), Echo («Explode again»), WhiteWalker (лёд не истекает) — [data.cdb](file:///D:/ashen_research/games/dead_cells/res_expanded/data.cdb) [сильный].
- **Risk of Rain 2** (не куплена, только вики):
  - Ukulele (Uncommon): 25 % шанс ударить молнией до 3 врагов в 20 м на 80 % урона; стак +2 цели и +2 м — [RoR2 wiki.gg](https://riskofrain.wiki.gg/wiki/Ukulele_(Risk_of_Rain_2)) [средний].
  - Brilliant Behemoth: почти все атаки взрываются на 60 % урона в радиусе 4 м, стак +1,5 м; взрывы применяются и к эффектам других предметов. Редкость в источниках расходится (Rare/Legendary) — [RoR wiki](https://riskofrain.fandom.com/wiki/Brilliant_Behemoth_(Risk_of_Rain_2)) [средний].
  - Shaped Glass (Lunar): удваивает урон и вдвое режет максимум HP; лунные предметы — с недостатком — [выдача поиска, гайд](https://rogueranker.com/risk-of-rain-2-items/) [слабый].
- **Noita**: палочка работает как колода. Заклинания проходят колоду, руку и сброс; палочка без перемешивания стреляет слева направо, с перемешиванием — случайно; Trigger-заклинание выпускает следующее при попадании; модификаторы меняют только текущий выстрел; каждое заклинание стоит маны — [Noita wiki.gg: Draw](https://noita.wiki.gg/wiki/Expert_Guide:_Draw), [Wand Mechanics](https://noita.wiki.gg/wiki/Guide:_Wand_Mechanics) [средний].
- **Nova Drift**: Blade — оружие-«конструкт», Swords (обновление VORPAL) — «Advanced Constructs», их можно модом прикрыть щитами; Super Mods открываются условием (Overseer) — [девлоги Pixeljam](https://pixeljam.itch.io/nova-drift/devlog/611652/vorpal-update-is-live), [0.21.10](https://pixeljam.itch.io/nova-drift/devlog/86243/-version-02110-is-live-) [сильный, девлоги, но без текста модов].

### Inferences
- Как меняется поведение:
  - Tragic Princess (VS): игрок перестаёт стоять, ведь откат идёт только в движении.
  - Silent Old Sanctuary (VS): выгодно брать меньше оружия.
  - Soldier (Brotato): игрок чередует бег и стрельбу.
  - One-Armed (Brotato): всё вкладывается в одно оружие.
  - Porcupine Backpack (Dead Cells): кувырок становится атакой, и в толпу ныряют, а не уходят из неё.
  - Brilliant Behemoth (RoR2): одиночные атаки превращаются в атаки по площади.
  - Shaped Glass (RoR2): «стекло», уклонение важнее брони.
- Почему игры остаются собой. Действие то же (двигаться, стрелять, кувыркаться). Меняется его смысл или условие: когда оно выгодно, что оно ещё делает.
- Дозировка в экшене: рецепт и время (эволюция VS — поздняя, по уровню 8 и паре предметов); отдельный выбор с малым числом опций (аркана); цена в виде HP (лунные RoR2, Handcuffs/Shackles в Brotato — «потолок» стата); стартовый выбор (персонаж Brotato).
- Для Ashen Oath (гипотеза): вариант Brotato — правила-«ограничения» как стартовая клятва или талисман с потолком («цепь не длиннее 4, но каждое звено ×2»). Образ Dead Cells — «прыжок проводит проход по ближайшему звену». Он меняет главное действие и оставляет цепь собой.

### Gaps
- Условие эволюции VS (сундук после 10-й минуты) по памяти. В JSON видны только пара и уровень. Код IL2CPP не разбирался.
- Что за второй набор из 13 арканоподобных записей VS (вероятно, «Darkana») — не проверено.
- Тексты модов Nova Drift и их доля «превращающих оружие» не получены (fandom).
- Для RoR2 нет доли лунных предметов и слов Hopoo Games; игра не куплена.
- Слов Nolla Games (Petri Purho) о замысле палочек не найдено.

## 6. Карточные и настольные: Inscryption, Luck be a Landlord, Backpack Hero, Cobalt Core

### Takeaway
В Inscryption почти каждый сигил — исключение из правила боя, а не число. Сила дозируется полем `powerLevel` от 0 до 5. По LBaL, Backpack Hero и Cobalt Core в этой сессии надёжного материала почти нет.

### Cited Findings
- Inscryption (V1.10, `data/abilities/part1`, 34 сигила): почти все меняют правило — [файлы Inscryption](file:///D:/ashen_research/games/inscryption/assetripper/ExportedProject/Assets/Resources/data/abilities/part1/) [сильный]. Числовых всего два: Leader (соседям +1 сила) и Stinky (противнику −1 сила). Остальные по `powerLevel`:
  - 0 — Airborne: «will strike an opponent directly, even if there is a creature opposing it»;
  - 1 — Burrower, Guardian (перемещаются под удар), Waterborne (ныряет, удары идут во владельца);
  - 2 — Worthy Sacrifice («counted as 3 Blood rather than 1»), Unkillable, Sharp Quills;
  - 3 — Fecundity, Corpse Eater, Amorphous;
  - 4 — Bifurcated Strike, Many Lives («When sacrificed it does not perish»), Touch of Death, Hoarder;
  - 5 — Trifurcated Strike, Omni Strike, Steel Trap.
- Luck be a Landlord: на странице магазина — 150+ символов и 220 предметов — [страница Godot showcase/магазин, через выдачу поиска](https://godotengine.org/showcase/luck-be-a-landlord/) [средний]. Эссенции появляются на высоких этажах и «much more volatile in nature» — [Indie Game Reviewer](https://indiegamereviewer.com/luck-be-a-landlord-review-just-one-more-spin/) [слабый].
- Cobalt Core: на высшей сложности часть боёв даёт только 1 выбор артефакта, игроки жалуются на отсутствие решения — [Steam, обсуждение](https://steamcommunity.com/app/2179850/discussions/0/3960413699063486711) [слабый].

### Inferences
- Урок Inscryption: если главное действие простое (карта бьёт то, что напротив), каждое исключение («бьёт в обход», «бьёт троих», «ныряет») сразу меняет расстановку на поле. Число силы при этом остаётся маленьким и читаемым. Сила правила измерена одной шкалой (`powerLevel`) — удобная «цена» для генератора и баланса.
- Для нас (гипотеза): «сигилы» на врагах и на талисманах одной природы — исключения из правила цепи («это звено считается двумя», «проход перепрыгивает это звено»). Нужна единая шкала силы правила для дозировки.
- Жалоба по Cobalt Core: правило-предмет без выбора (1 опция) не воспринимается как решение. Окно выбора важно не меньше редкости.

### Gaps
- Как именно игра использует `powerLevel` (генерация, перенос сигилов) — код `AbilityInfo` не читался.
- Предметы LBaL, Backpack Hero и артефакты Cobalt Core, меняющие правило, не разобраны: тексты не найдены, игр в `D:\ashen_research` нет.

## 7. Матч-3 и цепные игры: Puzzle & Dragons, Puzzle Quest, Dungeon Raid, Tetris-рогалики

### Takeaway
Ближайший к нам образец — Dungeon Raid: цепь по соседним одинаковым плиткам в любом направлении, рост через навыки, и в одном забеге не больше 4 навыков из десятков. В Puzzle & Dragons правило матча гнёт лидер-навык: поле 7×6, требования к форме матча. По Puzzle Quest и Tetris-рогаликам материала мало.

### Cited Findings
- Dungeon Raid (Fireflame Games, 2010): ведёшь пальцем по соседним одинаковым плиткам и строишь цепь, «including diagonally»; акцент на сборе ресурсов, а не на поиске свопа — [PocketGamer, обзор](https://www.pocketgamer.com/dungeon-raid/review/) [слабый/средний]. «Dozens of skills, only four of which you can gain in one game» — [Cult of the New](https://cultofthenew.com/2012/11/24/10000000-and-dungeonraid-dungeon-crawling-puzzle-games-for-the-iphone/) [слабый]. Разработчик — Fireflame Games, не Firemint — [VideoGameGeek](https://videogamegeek.com/videogame/95665/dungeon-raid) [средний].
- Puzzle & Dragons: лидер-навык пассивно действует на всю команду весь данж — [Tampere PlayLab](https://www.tuni.fi/playlab/puzzle-dragons-is-more-than-your-basic-match-three-game) [слабый]. Есть лидеры с условием на форму матча (ряды цвета, 7 комбо, крест) — там же [слабый].
- Есть класс лидеров «【7×6マス】» (поле становится 7×6) с бонусами под условие. Пример: огненный лидер, у которого HP огня ×2, а соединение 5 огненных сфер даёт ×20 атаки и −50 % урона — [Altema, список 7×6-лидеров](https://altema.jp/pazudora/leaderbunrui/2) [средний]. Поле 7×6 бывает и активным навыком на 2 хода — [JoJo wiki, Weather Report](https://jojowiki.com/Puzzle_%26_Dragons/Weather_Report) [слабый].
- Эффект «No Skyfall Combos» существует в данных игры как отдельный тип навыка (`no_skyfall`) — [PADDashFormation, данные](https://ide-kyxt.pcl.ac.cn/mapaler/PADDashFormation/src/tag/v32.3/script-json_data.js) [средний].
- Tetrogue (Steam): блоковый рогалик, 50+ реликвий, которые «stack and chain effects», камни встроены в установку фигур — [Steam](https://store.steampowered.com/app/4871260/Tetrogue/) [средний, страница магазина]. Loot River (2022): Tetris-подобное смещение платформ в souls-рогалике — [Gaming Nexus](https://gamingnexus.com/News/48895/Souls-meets-Tetris-roguelike-Loot-River-coming-in-May) [слабый].

### Inferences
- P&D показывает, как гнуть правило матча, не ломая игру. Правило задаёт **геометрию поля** (7×6) или **форму цепи**, которую награждают (5 в ряд, крест, N комбо). Само действие «двигай сферу и собирай» не меняется. Лидер выбирают один на данж — это аналог «одной клятвы на забег».
- Dungeon Raid — прямой предок нашей петли. Его дозировка «4 навыка из десятков за забег» — образец малого числа сильных правил.
- Для нас (гипотеза): правило может требовать форму цепи («цепь без поворотов», «цепь замкнута в кольцо», «цепь строго чередует два цвета») и щедро за неё платить. Это меняет стиль без новой кнопки — как лидеры P&D.

### Gaps
- Puzzle Quest (Infinite Interactive) не разобран: тексты навыков и предметов не получены.
- Не найден список P&D-лидеров с «No Skyfall» и с требованием «соединить 4+». Японские базы (Kamigame, Altema) открывались частично.
- Тексты навыков Dungeon Raid не получены, как и доля «правило / число».
- Реликвии Tetrogue и других Tetris-рогаликов, меняющие правило фигуры, не разобраны.

## 8. Общие выводы: доля «правил» и «чисел», дозировка, показ игроку

### Takeaway
В успешных играх предметов-правил мало: около 7–15 % каталога, если считать строго. Ещё 10–15 % — «движки», которые связывают два действия. Остальное — числа и экономика. Правила почти никогда не лежат на Common. Их дозируют редкостью, выбором из 1–3, ценой-запретом, рецептом из двух прокачанных частей или стартовым выбором.

### Cited Findings
- Доли по разобранным каталогам (разметка моя, кроме Balatro):
  - StS 1 — ПРАВИЛО 14 %, ДВИЖОК 12 %, СЧЁТЧИК 7 %, ЦЕНА 6 % (из 177); на Common правило 1 из 36 — [файлы StS](file:///D:/ashen_research/games/slay_the_spire/) [сильный];
  - Balatro — Effect 25 %, Retrigger 4 % по вики; собственно правила руки ≈7 % — [Balatro Wiki](https://balatrowiki.org/w/Jokers) [средний];
  - Brotato — чистые статы 49 %, правила ≈11 % (около 20 из 177) — [файлы Brotato](file:///D:/ashen_research/games/brotato/recovered/items/all/) [сильный];
  - аркана VS — 15 из 22 правила (это отдельный редкий выбор, а не основной поток) — [ARCANA_DATA.txt](file:///D:/ashen_research/games/vampire_survivors/assetripper/ExportedProject/Assets/TextAsset/ARCANA_DATA.txt) [сильный];
  - сигилы Inscryption — 32 из 34 правила — [файлы Inscryption](file:///D:/ashen_research/games/inscryption/assetripper/ExportedProject/Assets/Resources/data/abilities/part1/) [сильный].
- Способы дозировки с подтверждением:
  - выбор 1 из 3 для босс-реликвий StS (`BossChest.java`) [сильный];
  - реликвия с запретом за энергию: 10 из 30 босс-реликвий StS [сильный]; та же модель в Ancients StS2 ([slaythespire2.gg](https://slaythespire2.gg/relics)) [слабый];
  - рецепт: эволюции VS на 8-м уровне + пара ([WEAPON_DATA.json](file:///D:/ashen_research/games/vampire_survivors/assetripper/ExportedProject/Assets/TextAsset/WEAPON_DATA.json)) [сильный]; слияния Ball x Pit на макс. уровне 3 ([Deltia's](https://deltiasgaming.com/?p=381498)) [слабый];
  - стартовый выбор: персонажи Brotato [сильный]; лидер P&D на весь данж ([Tampere PlayLab](https://www.tuni.fi/playlab/puzzle-dragons-is-more-than-your-basic-match-three-game)) [слабый];
  - потолок навыков за забег: Dungeon Raid — 4 из десятков ([Cult of the New](https://cultofthenew.com/2012/11/24/10000000-and-dungeonraid-dungeon-crawling-puzzle-games-for-the-iphone/)) [слабый];
  - взаимоисключения: молоты Hades ([Supergiant](https://www.supergiantgames.com/blog/hades-the-blood-price-update-patch-notes-pt-1), [RogueRanker](https://rogueranker.com/?p=12468)) [сильный/слабый];
  - единая шкала силы: `powerLevel` 0–5 у сигилов Inscryption [сильный].
- Цитата о риске: предмет, который «cannibalises all the adjacent strategies around it», — главный провал баланса; при этом «almost all balance changes can be made by changing a number» — [LocalThunk, Rogueliker](https://rogueliker.com/balatro-interview/) [сильный].

### Inferences
- **Отвечаем пользователю: «счётчики скучноваты».** Данные StS показывают, что счётчик сам по себе не скучен: Kunai и Shuriken меняют стиль. Скучен счётчик с **накопительным окном** (Pen Nib «каждая 10-я», наше «каждое 5-е звено»), потому что он срабатывает сам. Счётчик с **окном в одно действие** (за ход, в одной цепи) требует строить действие под порог — и это уже правило формы.
- Почему игры остаются собой — общий признак. Ни один образец не добавляет новую кнопку. Гнётся одно из пяти: (1) что считается «тем же» — масть, цвет; (2) что считается «полным» — длина, размер руки; (3) что сохраняется между циклами — рука, энергия, блок; (4) что видно — намерения, порядок колоды; (5) что ещё делает действие — кувырок атакует, атака взрывается. Для цепи Ashen Oath это: цвет, длина, перенос между цепями (фокус, кристаллы), видимость и побочный эффект прохода или прыжка.
- **Модель дозировки для нас (гипотеза).**
  - Common — числа и короткие окна;
  - Uncommon — открыватели архетипа без своей силы (как Four Fingers);
  - Rare — движки «событие → эффект»;
  - редкий выбор 1 из 3 (как босс) — правило с ценой-запретом.
  - Рецепт «два талисмана → правило» — запасной путь в поздний забег.
- **Показ игроку.** Описания правил в разобранных играх — одна фраза в словаре самой игры: «can be made with 4 cards», «no longer discard your hand», «You can’t attack while moving». Для нас это значит: правило-талисман формулируется словами цепи, а подсветка цепи (`planChain`) должна показывать его действие ещё до прохода.
- **Риски баланса** (по образцам, гипотеза): правило, снимающее ограничение (Runic Pyramid, Ice Cream), рождает бесконечные циклы с движками. Копировщики (Blueprint) удваивают самое сильное. Правило без выбора (Cobalt Core, 1 опция) не ощущается решением. Против этого работают взаимоисключения, потолок числа правил за забег и цена-запрет.

### Gaps
- Нет единой методики «правило / число»: разметка ручная и спорная на границах (Boot, Paper Frog, Bottled-реликвии в StS; Vampire в Balatro). Числа выше — оценка, не данные.
- Как игры показывают правило в интерфейсе (счётчик на иконке реликвии StS, порядок джокеров, книга правил Inscryption) — по памяти, источником не подтверждено. В коде StS у реликвий есть поле `counter` (например, `VelvetChoker.java`), но вывод его на экран в коде не проверялся.
- Hades/Hades II, RoR2, Peglin, Ball x Pit, LBaL, Backpack Hero, Cobalt Core, Puzzle Quest, P&D — без файлов. Доли «правило / число» для них не посчитаны.
