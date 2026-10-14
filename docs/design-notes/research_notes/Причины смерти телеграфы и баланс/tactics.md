# Тактические игры: телеграф намерений, прогноз последствий, объяснение поражений, баланс сложности

Дата сбора: 14.10.2026. Локальные данные взяты из копий в scratchpad (`games/tactics/<игра>`). Установленные папки Steam не изменялись, игры не запускались. Открытый код клонирован shallow, не собирался.

Состояние источников:
- **Gloomhaven** (Unity, IL2CPP, без `Managed`). Правила лежат в `Rulebase/*.ruleset`; это ZIP с YAML. Скопированы и распакованы `Global`, `Shared`, `Campaign`, `Guildmaster`. Строки взяты из `LanguageExport.csv`.
- **Library of Ruina** (Unity/Mono). Из `resources.assets` извлечено 1113 встроенных XML (StageXmlRoot, FloorLevelXmlRoot и др.). `Assembly-CSharp.dll` декомпилирован ilspycmd (копия, 5123 файла).
- **Divinity: Original Sin 2 DE.** Скопированы только хвосты `.pak` (LSPK v13, оглавление в конце, LZ4). Из них извлечены `Data.txt`, `Potion.txt`, AI-архетипы и один charScript.
- **Inscryption** в `C:\Program Files (x86)\Steam\steamapps\common\Inscryption` **не установлен**: там только `SaveFile.gwsave` и `steam_autocloud.vdf`. Локальный разбор невозможен; использованы публичные источники.
- **OpenXcom** (`github.com/OpenXcom/OpenXcom`, master, shallow) и **Wesnoth** (`github.com/wesnoth/wesnoth`, master, sparse: `src/gui/dialogs`, `src/actions`, `data/core/macros`, `data/campaigns/Heir_To_The_Throne`).
- **Только публичные источники:** Into the Breach, XCOM 2, Fire Emblem, Darkest Dungeon, Monster Train, Wildfrost. Доклад GDC 2019 «Into the Breach Design Postmortem» (Matthew Davis) за логином GDC Vault. Ни одна открытая статья его содержание не пересказывает (см. Gaps).

---

## 1. Телеграф намерений и прогноз последствий до действия игрока

### Takeaway
Эталон — Into the Breach: в начале хода игрок видит весь план врага и тратит ход на то, чтобы сорвать его. Случайность сведена к одному числу (Grid Defense, база 15 %). Цель дизайна — «каждая смерть — твоя вина». Другие игры показывают прогноз шагами: от «шанс попасть» (XCOM, Fire Emblem; XCOM и FE при этом скрыто искажают показанное число) до полного распределения HP (Wesnoth: вероятность каждого исхода HP, шанс остаться невредимым). Полуреальное время переносит это так: Wildfrost — счётчики до атаки, Library of Ruina — стрелки целей кубиков скорости, Transistor — планирование в паузе с показом урона, Frozen Synapse — симуляция плана до подтверждения.

### Cited Findings

**Into the Breach (Subset Games)**
- Разработчики хотели меньше случайности, чем в FTL, и чтобы «every death felt like your own fault». Поэтому телеграф атак врага стал основной механикой («This lead us to use of telegraphed enemy attacks as a core mechanic»). Без случайных атак бой «starts to feel like a puzzle» — [Game Developer, Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- Justin Ma: в начале каждого хода игрок точно знает, что сделает враг, и ход уходит на реакцию на этот план. Ma ценит, когда «everything so clean as to fit on a single screen» (по выдаче поиска; страница не открывалась) — [Shacknews preview](https://www.shacknews.com/article/99108/into-the-breach-preview-ftls-creators-pit-mechs-against-aliens-in-post-apocalyptic-warfare)
- Поле 8×8 собрано вручную; Davis: «much cheaper to hand-design 100 maps than to design a procedural system». Раскладки, где у игрока нет ответа, запрещены: два здания по диагонали или буквой L — «big no-no», враг в такой нише почти неуязвим. Davis: «You need to always be able to manipulate them» — [Wiltshire, Game Developer, 28.02.2018](https://www.gamedeveloper.com/design/reimagining-failure-in-strategy-game-design-in-i-into-the-breach-i-)
- Общее HP — Power Grid: не больше 7 очков, каждое разрушенное здание снимает 1, при 0 игра кончается. Подлинная цена ошибки — Grid, а не мехи: мехи после боя чинятся полностью, и их HP можно тратить как ресурс. Пробовали удлинять шкалу Grid, но Davis: «Once your power bar becomes twice as long, it doesn't have as much value as killing the monster». Поэтому шкалу оставили короткой — [Wiltshire](https://www.gamedeveloper.com/design/reimagining-failure-in-strategy-game-design-in-i-into-the-breach-i-)
- Единственная заметная случайность — Grid Defense: шанс, что здание не потеряет Grid при ударе. База 15 %, можно поднять выше 30 % (по выдаче поиска; гайды не открывались) — [Game Informer, 23 tips](https://www.gameinformer.com/b/features/archive/2018/02/27/23-tips-to-help-you-dominate-into-the-breach.aspx?amp), [KosGames](https://kosgames.com/into-the-breach-beginners-guide-advice-2021-5557/)
- Вырезано около 60 % задуманной игры: строительство города, несколько отрядов, деревья исследований, события в стиле FTL. Карту островов и мета-слой переделывали 5 раз. Оставили только работающий бой — [Kotaku, GDC 2019](https://kotaku.com/the-creators-of-into-the-breach-came-very-close-to-givi-1833498295)
- Доклад GDC 2019 «'Into the Breach' Design Postmortem» (Matthew Davis) по анонсу охватывает: что вырезать, сколько RNG оставить, как выбрать сложность, как пришли к интерфейсу. Содержание в открытых пересказах не найдено — [GDC Vault](https://gdcvault.com/play/1025772/-Into-the-Breach-Design), [Game Developer video](https://gamedeveloper.com/design/video-how-subset-games-designed-i-into-the-breach-i-)

**Wesnoth: окно прогноза боя** (`src/gui/dialogs/attack_predictions.cpp`, `src/attack_prediction.hpp`, master)
- Окно показывает для обеих сторон: базовый урон и модификаторы (сопротивление и уязвимость с подписью «Defender resistance vs …», замедление «/ 2»), шанс попасть с цветом `red_to_green(chance_to_hit)`, «chance_unscathed» (вероятность не получить урона) и график распределения HP — [attack_predictions.cpp](https://github.com/wesnoth/wesnoth/blob/master/src/gui/dialogs/attack_predictions.cpp)
- График строится из `combatant_.hp_dist`. Берутся только `graph_max_rows` самых вероятных значений HP, затем они сортируются по убыванию HP. Вероятность выше 0,9995 печатается как «100%», остальные — с одним знаком после запятой (`get_probability_string`) — [attack_predictions.cpp](https://github.com/wesnoth/wesnoth/blob/master/src/gui/dialogs/attack_predictions.cpp)
- Структура `combatant` хранит `hp_dist`, `untouched`, `poisoned`, `slowed`; это вероятности исходов, а не одно число — [attack_prediction.hpp](https://github.com/wesnoth/wesnoth/blob/master/src/attack_prediction.hpp)

**Fire Emblem: прогноз боя и «true hit»**
- Прогноз (combat forecast) показывает урон, удвоение атаки (в поздних частях), шанс попасть и крита; в ранних частях — атаку, защиту, точность обеих сторон — [Fire Emblem Wiki, Combat forecast](https://www.fireemblemwiki.org/wiki/Combat_forecast)
- С The Binding Blade попадание считается по 2RN: среднее двух случайных чисел сравнивается с показанным шансом. Показанные шансы выше 50 % срабатывают чаще, ниже 50 % — реже. Это сознательное расхождение «показанного» и «настоящего» в пользу игрока. В Fates и Shadows of Valentia — гибрид, в Three Houses 2RN вернулся — [Fire Emblem Wiki, True hit](https://fireemblemwiki.org/wiki/True_hit)

**XCOM 2: процент попадания и скрытая помощь**
- В `DefaultGameCore.ini` (по цитате пользователя Steam) есть `ReasonableShotMinimumToEnableAimAssist=50` и `MaxAimAssistScore=95`. `MissStreakChanceAdjustment` равен 10 на Rookie и Veteran, 15 на Commander и 0 на Legend. Помощь действует только на выстрелы ≥ 50 % и не действует на Legend — [Steam discussion](https://steamcommunity.com/app/268500/discussions/0/2944746708998250511)
- UFOpaedia: скрытая помощь прицелу — «significant» на Rookie, «some» на Veteran, «minor» на Commander, нет на Legend — [UFOpaedia, Difficulty (XCOM2)](https://ufopaedia.org/Difficulty_(XCOM2))

**Library of Ruina** (локально, декомпиляция копии `Assembly-CSharp.dll`)
- Цели врагов показаны стрелками от кубика скорости к целевому кубику до подтверждения хода. `BattleUnitTargetArrowData` хранит `Dice`, `TargetDice`, `SubTargetDices` (несколько целей, массовые атаки) и флаг `isPairing`. Флаг различает столкновение (clash), когда атаки идут навстречу, и одностороннюю атаку по неприкрытой цели. `BattleUnitTargetArrowManagerUI` строит списки стрелок отдельно для пар и одиночных атак (строки 156, 183, 286, 431) — копия `games/tactics/ruina/src/BattleUnitTargetArrowData.cs`, `BattleUnitTargetArrowManagerUI.cs` (оригинал: `D:\SteamLibrary\steamapps\common\Library Of Ruina\LibraryOfRuina_Data\Managed\Assembly-CSharp.dll`)
- Есть отдельные классы предпросмотра: `BattleCardPreviewSlider`, `PreviewDataUI`, `PreviewSetterUI` — там же

**Gloomhaven (цифровой)** (локально, `LanguageExport.csv`)
- Намерение монстра определяет правило фокуса, описанное в справочнике игры (`COMPENDIUM_MonsterFocus`). Монстр выбирает врага, до которого дойдёт атакой за наименьшее движение; при равенстве — того, кто раньше по инициативе. Призванные идут раньше призвавшего. Ход монстра задаёт открытая карта способностей. Игрок выбирает карты до того, как открыта карта монстра, поэтому здесь телеграф не полный, а вычислимый по правилам — копия `games/tactics/gloomhaven/LanguageExport.csv` (оригинал `D:\SteamLibrary\steamapps\common\Gloomhaven\LanguageExport.csv`)

**Полуреальное время и реальное время**
- Wildfrost: у каждой карты есть счётчик. Он уменьшается каждый ход, при 0 карта атакует и счётчик сбрасывается. Враги ходят первыми. По счётчикам игрок планирует следующий ход. Snow замораживает счётчик — [Wildfrost Wiki, Counter](https://wildfrostwiki.com/Counter). Разработчики: «each action counts as a turn», у игрока и врага атаки по таймеру — [MCV/UK, When We Made… Wildfrost](https://mcvuk.com/?p=224506)
- Inscryption: поле 3×4 (в акте III — 3×5). Противник заранее выкладывает карты в верхний ряд, на следующем ходу они сдвигаются в средний и атакуют. Урон копится зубами на весах, побеждает разница в 5 — [Wikipedia, Inscryption](https://en.wikipedia.org/wiki/Inscryption)
- Transistor: Turn() останавливает врагов. Игрок ставит атаки в план с пулом 100 очков планирования и видит стоимость и урон каждого действия; можно отменять и пробовать. После исполнения шкала Turn восстанавливается, меч в это время недоступен — [GamesRadar](https://gamesradar.com/transistor-combat-guide/2), [Transistor Wiki, Turn()](https://transistor.fandom.com/wiki/Turn()), [Transistor Wiki, Combat](https://transistor.gamepedia.com/Combat)
- Frozen Synapse: до подтверждения («prime») игрок прогоняет симуляцию хода. Она исходит из того, что враги продолжат текущие приказы; врагам можно задать гипотетические приказы. Отзывы: прогноз «rarely accurate», потому что противник действует одновременно — [Wikipedia, Frozen Synapse](https://en.wikipedia.org/wiki/Frozen_Synapse), [GameGrin, FS2](https://www.gamegrin.com/reviews/frozen-synapse-2-review/)

**Darkest Dungeon: явное состояние «на пороге смерти»**
- При 0 HP герой попадает на Death's Door. Каждый следующий удар — проверка сопротивления смертельному удару: база 67 % (Флагеллант 73 %), предел 87 %, то есть 33 % умереть от любого удара. Штрафы на пороге: −10 ACC, −25 % DMG, −5 SPD, +33 % стресса. После лечения до конца похода действует Death's Door Recovery: −2 ACC, −5 % DMG, −1 SPD, +10 % стресса. При 200 стресса — сердечный приступ: герой сразу на пороге, а если уже был на пороге — гибнет — [Darkest Dungeon Wiki, Death's Door](https://darkestdungeon.wiki.gg/wiki/Death%27s_Door)

### Inferences
- Шкала прогноза у разных игр: «намерение» (ITB, Wildfrost, Inscryption, LoR) → «число» (XCOM, FE) → «распределение» (Wesnoth) → «симуляция» (Frozen Synapse, Transistor). Где случайности нет (ITB, Transistor), прогноз точен, и игра может требовать «каждая смерть — твоя вина». Ashen Oath детерминирован, поэтому ему доступна точная форма прогноза.
- В ITB читаемость держат четыре вещи. Маленькое поле на одном экране. Мало врагов (одна лишняя единица превращает «вызов» в «невозможно», см. раздел 3). Запрет раскладок без ответа. Единое общее HP (Grid), видимое всегда. Перенос в реальное время — это прежде всего ограничение одновременных угроз, а не новые значки.
- FE и XCOM показывают число, а исполняют его мягче (2RN, aim assist). Это помощь новичку ценой честности. Для Ashen Oath это противоречит правилу проекта «подсветка = исполнение», поэтому скрытая помощь допустима только вне прогноза: например, неуязвимость после удара, но не тайная правка показанного урона.
- Стрелки LoR с флагом пары или односторонней атаки близки к задаче Ashen Oath «кто сейчас меня коснётся». Это не значок над врагом, а линия от источника к цели, разная для угрозы, на которую ты отвечаешь, и угрозы, которую ты пропускаешь.

### Gaps
- Содержание доклада Davis (GDC 2019) не найдено: что именно убрали ради читаемости, как пришли к UI. GDC Vault требует логина, видео на YouTube текстом не пересказано. «Perfect information» как формулировка Subset в источниках не подтверждена; подтверждено «telegraphed enemy attacks» и «every death felt like your own fault».
- Точная механика сброса хода (Reset Turn) в ITB и предел Grid = 7 сверх статьи Wiltshire не проверены по вики: fandom отдаёт 402.
- Inscryption не установлен; данные о ряде очереди — только из Wikipedia.
- Monster Train: как показаны намерения врагов, не найдено.

---

## 2. Объяснение поражений: отчёты, повторы, ответ на «почему»

### Takeaway
Сильнейший приём не экран после смерти, а правила, где причина видна до удара (ITB: «it's very clear how or why you failed»). Где причина сложна (MOBA), помогает разбор: источники урона, типы, длительность боя и потерянный контроль. Тактические игры добавляют предупреждающие состояния до финала (Death's Door, отсчёт Avatar в XCOM 2, весы Inscryption), чтобы поражение не приходило внезапно.

### Cited Findings
- ITB: разработчики хотят, чтобы «it's very clear how or why you failed so that you can feel like you can improve» — [Game Developer, Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- ITB: игрок должен «отучиться» от правила, что главное — не потерять юнитов. Потеря меха не конец: пилот гибнет, мех возвращается с ИИ-пилотом без опыта. Поражение — только Grid — [Wiltshire](https://www.gamedeveloper.com/design/reimagining-failure-in-strategy-game-design-in-i-into-the-breach-i-)
- League of Legends, Death Recap (переделка 2019, патч 9.14). Старый экран ругали за урон от неуронных умений и нейтральных монстров. Новый в свёрнутом виде показывает круговую диаграмму физического и магического урона, длительность боя и время потери контроля; в развёрнутом — конкретные способности — [PCGamesN](https://www.pcgamesn.com/league-of-legends/death-recap). По вики: урон по подтипам, сгруппирован по врагам, засчитанный убийца выделен, источники отсортированы по убыванию — [LoL Wiki, Death recap](https://wiki.leagueoflegends.com/en-us/Death_recap). Патч 5.13: «a pretty significant pass… at least a little more consistent» — [Leaguepedia, Patch 5.13](https://lol.fandom.com/wiki/Patch_5.13)
- XCOM 2, Avatar Project: шкала из 12 блоков. Когда она заполнена, начинается отсчёт; на нуле игра проиграна. Отсчёт около 20 дней; его можно остановить любым снижением прогресса — [UFOpaedia, Avatar Project](https://ufopaedia.org/Avatar_Project_(XCOM2)), [PC Gamer](https://www.pcgamer.com/xcom-2-guide)
- OpenXcom, месячный отчёт: порог оценки сдвигается со сложностью, `difficulty_threshold = defeatScore + 100 * DifficultyCoefficient`, при этом `defeatScore: -900` (xcom1). Градации от «STR_RATING_TERRIBLE» вверх с шагом 300 — [MonthlyReportState.cpp:136](https://github.com/OpenXcom/OpenXcom/blob/master/src/Geoscape/MonthlyReportState.cpp), [difficulty.rul](https://github.com/OpenXcom/OpenXcom/blob/master/bin/standard/xcom1/difficulty.rul)
- Inscryption, акт I: два поражения на карте (или одно на боссе) завершают забег; героя «фотографируют» в карту смерти (deathcard), и она может встретиться в следующих забегах. В акте II поражение без штрафа, в акте III откат к контрольной точке — [Wikipedia, Inscryption](https://en.wikipedia.org/wiki/Inscryption)
- Darkest Dungeon: смерть почти всегда идёт через видимое промежуточное состояние (Death's Door, 33 % на удар), а не внезапно с полного HP. Стресс 200 даёт сердечный приступ — [Darkest Dungeon Wiki](https://darkestdungeon.wiki.gg/wiki/Death%27s_Door)
- Frozen Synapse: после хода можно сравнить исход с прогнозом и пересмотреть все прошлые ходы — [Wikipedia](https://en.wikipedia.org/wiki/Frozen_Synapse), [GameGrin](https://www.gamegrin.com/reviews/frozen-synapse-2-review/)

### Inferences
- Для Ashen Oath с 73 % урона от касаний подход LoL (кто, чем, сколько, за какое время) ближе всего к жалобе «почему я умер». Подход ITB/DD (причина видна до удара) убирает саму жалобу. Нужны оба: экран-разбор после смерти и состояние «на краю» (как Death's Door) перед ней.
- Отсчёт Avatar и весы Inscryption показывают «сколько ещё ошибок до конца» как отдельную короткую шкалу. В Ashen Oath это HP героя. Урок ITB о короткой шкале (Grid ≤ 7, удлинение обесценивает убийство) говорит: каждый удар должен быть заметной долей HP. Похоже, «касание 2» в пакете «Урон имеет значение» это уже делает.
- Карта смерти Inscryption — способ сделать поражение материалом, а не только наказанием. Это мета-слой; в Ashen Oath нет постоянной силы, но допустимо разнообразие.

### Gaps
- Как устроен экран конца забега в ITB, XCOM 2 и Monster Train (что показывают о причине) — не проверено по источникам.
- Повтор боя (killcam, replay) в тактических играх не найден, кроме обзора ходов Frozen Synapse.

---

## 3. Баланс сложности: уровни и что они меняют, ввод врагов по ходу кампании

### Takeaway
Сложность меняют четырьмя рычагами: **число врагов** (ITB, OpenXcom, Wesnoth «1x–4x enemies», XCOM 2 лимит активных врагов 4/6/6/∞), **числа врагов** (Gloomhaven: уровень сценария ±1…+3; OpenXcom: рост статов и множитель точности и брони 0,5 на Beginner; XCOM 2: HP), **поведение ИИ** (DOS2 Tactician: множитель добивания 2,5 → 3,0; OpenXcom: агрессия гранат от коэффициента) и **ресурсы игрока** (Wesnoth: меньше сценариев → меньше XP; Gloomhaven: Blessed, Healthy +50 % HP, Peaceful −25 % врагов). Новое вводят главами с потолком силы: LoR ограничивает эмоциональный уровень врагов номером главы (≤ 5), число единиц в волне растёт с 2,3 до 4,1.

### Cited Findings

**Gloomhaven (локально: `Rulebase/Global.ruleset → Difficulty/Difficulties.yml`, `Campaign.ruleset → Headquarters/Headquarters.yml`, `Enemy/BanditGuard.yml`, `Guildmaster.ruleset → MonsterData/Monsters.yml`, `LanguageExport.csv`)**
- Уровни кампании меняют один скаляр: `CampaignEasy: ScenarioLevelModifier: -1`, `CampaignHard: +1`, `CampaignInsane: +2`, `CampaignDeadly: +3`. Подпись: «Monsters, Traps and Gold will be N levels higher». Отдельные «положительные» переключатели: `Blessed: BlessCards: 3`, `Healthy: HeroHealth: 1.5` («Heroes have 50% more health»), в Guildmaster ещё `Peaceful: Threat: 0.75` («25% less enemies»). Есть усложнение `Cursed` («+2 Curses»). Каждый переключатель помечен `PositiveEffect: True/False` — копия `games/tactics/gloomhaven/x_Global/Difficulty/Difficulties.yml` (оригинал `D:\SteamLibrary\steamapps\common\Gloomhaven\Rulebase\Global.ruleset`)
- Базовая формула (настольные правила v1.1): уровень сценария = средний уровень персонажей / 2, округлить вверх; −1 для лёгкой игры, +1 для трудной, +2 для очень трудной. Соло: +1 к уровню монстров и урону ловушек без роста золота и опыта — [Gloomhaven Rulebook v1.1](https://www.orderofgamers.com/downloads/Gloomhaven_v1.1.pdf)
- Таблица по уровню сценария 0–7 (Campaign): `GoldConversion [2,2,3,3,4,4,5,6]`, `TrapDamage [2,3,4,5,6,7,8,9]`, `BonusXP [4,6,8,10,12,14,16,18]` (в Guildmaster `[3..10]`), `HazardousTerrainDamage [1,1,2,2,3,3,4,4]`. Опыт до уровня: `CharacterXPTable [0,45,95,150,210,275,345,420,500]` — копия `x_Campaign/Headquarters/Headquarters.yml:152–166`
- Шаг уровня у обычного Bandit Guard (HP / Move / Attack): L0 5/2/2, L1 6/3/2, L2 6/3/3, L3 9/3/3, L4 10/4/3, L5 11/4/4, L6 14/4/4, L7 16/5/4. Уровень +1 — это не пропорциональный рост: на одних шагах растёт HP, на других атака или ход — копия `x_Campaign/Enemy/BanditGuard.yml`
- Guildmaster задаёт бюджет угрозы на комнату (`Room1: Threat: 125`, `Room2: Threat: 150`, сценарий FellHounds). Цена монстра — `[обычный, элита]`: Bandit Guard `[25,50]`, Vermling Scout `[13,25]`, Cave Bear и Stone Golem `[50,100]`, демоны `[38,75]`. Элита стоит вдвое дороже — копия `x_Guildmaster/Scenario/Scenario_Job_FellHounds.yml:39–48`, `x_Guildmaster/MonsterData/Monsters.yml:3–37`

**OpenXcom (код и правила, master)**
- `enum GameDifficulty { DIFF_BEGINNER = 0, DIFF_EXPERIENCED, DIFF_VETERAN, DIFF_GENIUS, DIFF_SUPERHUMAN }`; `getDifficultyCoefficient()` возвращает `DIFFICULTY_COEFFICIENT[min(diff,4)]` — [SavedGame.h:59](https://github.com/OpenXcom/OpenXcom/blob/master/src/Savegame/SavedGame.h), [SavedGame.cpp:754](https://github.com/OpenXcom/OpenXcom/blob/master/src/Savegame/SavedGame.cpp)
- `difficulty.rul` (xcom1): `difficultyCoefficient: [0, 1, 2, 3, 4]`, `aimAndArmorMultipliers: [0.5, 1.0, 1.0, 1.0, 1.0]`. `statGrowthMultipliers`: tu 4, stamina 4, health 0, reactions 6, firing 6, strength 2, psi 4/4, melee 4. Комментарий: «statGrowthMultipliers are the increments / difficultyCoefficients are MultiplierA / aimAndArmorMultipliers are MultiplierB». Ещё `turnAIUseGrenade: 3`, `turnAIUseBlaster: 3` — [difficulty.rul](https://github.com/OpenXcom/OpenXcom/blob/master/bin/standard/xcom1/difficulty.rul)
- Применение к пришельцам: `stat += statGrowth.stat * growthMultiplier * stat / 100`; затем `firing *= aimAndArmorMultiplier`, броня по 4 сторонам `*= aimAndArmorMultiplier`. На Beginner пришельцы стреляют вдвое хуже и имеют вдвое меньше брони; со Superhuman, например, реакция растёт на 6×4 = 24 % — [BattleUnit.cpp:2896–2912](https://github.com/OpenXcom/OpenXcom/blob/master/src/Savegame/BattleUnit.cpp)
- Число врагов по развёртыванию: Beginner и Experienced — `lowQty + rand(0,dQty)`; Veteran и Genius — `lowQty + (highQty-lowQty)/2 + rand(0,dQty)`; Superhuman — `highQty + rand(0,dQty)` — [BattlescapeGenerator.cpp:1082–1088](https://github.com/OpenXcom/OpenXcom/blob/master/src/Battlescape/BattlescapeGenerator.cpp)
- Поведение: пришелец в пределах 20 клеток от корабля смотрит на него с шансом `20 * coefficient` % (0–80 %) — [BattlescapeGenerator.cpp:1197–1206](https://github.com/OpenXcom/OpenXcom/blob/master/src/Battlescape/BattlescapeGenerator.cpp). Решение о взрывчатке `explosiveEfficacy(..., diff)` и путь ракеты `maxWaypoints = 6 + diff * 2`; гранаты и бластеры — не раньше хода 3 — [AIModule.cpp:142, 1526, 1542, 1716](https://github.com/OpenXcom/OpenXcom/blob/master/src/Battlescape/AIModule.cpp)
- Геоскейп: перезарядка оружия НЛО `max(1, reload - 2*coef)`; шанс ответного удара по базе `100 - 4*(24 - coef)` — [DogfightState.cpp:1060, 1232](https://github.com/OpenXcom/OpenXcom/blob/master/src/Geoscape/DogfightState.cpp)

**Battle for Wesnoth, «Heir to the Throne» (master)**
- Четыре уровня с честной подписью: Easy «1x enemies, 15 scenarios», Normal «2x enemies, 14 scenarios» (по умолчанию), Hard «3x enemies, 13 scenarios», Deadly «4x enemies, 12 scenarios». Комментарий: «on higher difficulties, the player gets fewer scenarios to play with / this both restricts XP and reduces the available rewards» — [HttT _main.cfg:73–80](https://github.com/wesnoth/wesnoth/blob/master/data/campaigns/Heir_To_The_Throne/_main.cfg)
- Числа в сценарии задаёт макрос `ON_DIFFICULTY4`. Сценарий 01: лимит ходов `18 17 16 15`; золото противника `35 75 115 150`, доход `0 3 6 8` («high gold (so they pose an immediate threat) but low income»). Лимит найма союзников растёт с уровнем: копейщики `1 1 2 2`. Автор: «I usually don't vary time limit by difficulty, but I've been having a hard time balancing this one» — [01_The_Elves_Besieged.cfg](https://github.com/wesnoth/wesnoth/blob/master/data/campaigns/Heir_To_The_Throne/scenarios/01_The_Elves_Besieged.cfg)
- Общий механизм — препроцессор: `#define QUANTITY NAME EASY_VALUE NORMAL_VALUE HARD_VALUE` и `ON_DIFFICULTY` через `#ifdef EASY/NORMAL/HARD` — [data/core/macros/utils.cfg](https://github.com/wesnoth/wesnoth/blob/master/data/core/macros/utils.cfg)

**Divinity: Original Sin 2 DE (локально, извлечено из копий хвостов `.pak`)**
- AI-архетип `Public/Shared/AI/Archetypes/TACTICIAN/base.txt` («Tactitian specific base mods») переопределяет общий `base.txt` (Patch5):
  - `MULTIPLIER_KILL_ENEMY` 2.50 → **3.00** («More interested in dealing the killing blow»);
  - `MULTIPLIER_TARGET_HOSTILE_COUNT_ONE` 0.50 → 0.75 и `..._TWO_OR_MORE` 0.25 → 0.50 («Less prone to disregard targets that are already attacked»), то есть больше фокусного огня;
  - `MULTIPLIER_CONTROL_ENEMY_POS/NEG` 1.0 → 1.5;
  - `MULTIPLIER_COMBO_SCORE_POSITIONING` 0.00 → 0.50;
  - `ENABLE_ACTIVE_DEFENSE_OFFENSIVE_USE` 0 → 1;
  - `MULTIPLIER_SHIELD_BLOCK` 1.0 → 1.5;
  - `MULTIPLIER_REFLECT_DAMAGE` 0.1 → 0.25.
  
  Архетип CLASSIC почти пуст (29 байт) — копии `games/tactics/dos2/ai_tactician.txt`, `ai_base.txt` (оригинал `D:\SteamLibrary\steamapps\common\Divinity Original Sin 2\DefEd\Data\Shared.pak`, `Patch5.pak`)
- `Data.txt` (Patch1): цены торговцев по сложности `PriceModCasualDifficulty 2.1`, `PriceModClassicDifficulty 2.5`, `PriceModHardcoreDifficulty 2.7` — копия `games/tactics/dos2/Data_patch1.txt:431–435`
- Скрипт `GLO_SetStatusOnHardcoreCombat.charScript`: на «Hardcore» (`IsHardcore()`, внутреннее имя Tactician) при входе в бой персонаж получает статус (по умолчанию `APOTHEOSIS`) и может получать его снова — копия `games/tactics/dos2/hardcore.charScript`

**XCOM 2**
- Лимит одновременно вступивших в бой врагов: Rookie 4, Veteran 6, Commander 6, Legend без лимита. HP новобранца 6/5/4/4; ADVENT Trooper 3/3/4/4; Muton 8/8/9/11. Стоимость связи с регионом (Intel) 30/30/40/80. На Legend Сектоподы приходят позже (октябрь против августа), исследования дольше, постройки дороже — [UFOpaedia, Difficulty (XCOM2)](https://ufopaedia.org/Difficulty_(XCOM2))

**Into the Breach**
- Разработчики: баланс — «a numbers game»; «A single additional enemy turns a battle from 'a fun challenge' to 'completely impossible'»; цель — «a good spread of difficulty options» — [Game Developer, Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- По старой ревизии фан-вики: Easy снижает частоту появления врагов, на зданиях случайные щиты, счёт −50 %. Hard повышает частоту появления, добавляет больше Alpha Vek, счёт +50 % — [Into the Breach Wiki, Missions (oldid 4602)](https://intothebreach.fandom.com/wiki/Missions?oldid=4602). Обзор GodIsAGeek говорит иначе: враги «smarter… stronger» — [GodIsAGeek](https://godisageek.com/reviews/into-the-breach-review/). Источники расходятся; форумная оценка «разница в основном в числе врагов» ближе к вики — [Qt3 forum](https://forum.quartertothree.com/t/into-the-breach-turn-based-strategy/128428?page=7)

**Library of Ruina (локально: извлечённые XML и декомпиляция)**
- Потолок эмоционального уровня (внутрибоевой рост силы: каждый уровень восстанавливает свет и даёт эмоциональную карту). У врага `_maximumEmotionLevel = Mathf.Min(chapter, 5)`, у игрока — `Min(floor.Level, 5)`; на этажах Binah и Hokma сразу 5. Монет эмоций на уровень (`GetNeedEmotionCoin`): 3, 3, 3, 5, 7, 9 — копия `games/tactics/ruina/src/BattleUnitEmotionDetail.cs:95–121, 1251–1263`
- Приёмы по главам (`StageXmlRoot`, id 1–… и 100001–…; подсчёт скриптом `scripts/ruina_stages.py`):

| Глава | Приёмов | Среднее волн | Макс. волн | Среднее по приёмам: единиц в самой большой волне | Макс. единиц |
|---|---|---|---|---|---|
| 1 | 6 | 1,33 | 2 | 2,33 | 3 |
| 2 | 6 | 1,17 | 2 | 2,83 | 3 |
| 3 | 10 | 1,50 | 2 | 3,00 | 3 |
| 4 | 11 | 1,36 | 2 | 3,27 | 4 |
| 5 | 10 | 1,80 | 3 | 4,10 | 5 |
| 6 | 20 | 1,70 | 4 | 3,95 | 5 |
| 7 | 18 | 1,17 | 3 | 2,56 | 5 |

  Глава 7 — финальные боссы с малым числом сильных единиц и `FloorNum` до 10 (все этажи). Копии `games/tactics/ruina/xml/0115_StageXmlRoot.xml`, `0666_StageXmlRoot.xml`.
- Аномалии этажей: `FloorLevelXmlRoot` — по 5 уровней на каждую Sephirah (Keter 210001–210005, Malkuth 201001–201005 …). Это фиксированная лестница, открываемая прогрессом — копия `xml/1111_FloorLevelXmlRoot.xml`

**Ввод нового по ходу кампании**
- Inscryption: правила карточного боя одни во всех трёх актах; меняется обёртка: акт I — рогалик против Leshy, акт II — пиксельный мир без штрафа за поражение, акт III — фабрика P03 с контрольными точками; поле 3×4 → 3×5 в акте III — [Wikipedia](https://en.wikipedia.org/wiki/Inscryption)
- Monster Train: 25 уровней Covenant с растущими модификаторами (больше HP врагов, штрафы отряду и т. п.) — [Seasoned Gaming review](https://seasonedgaming.com/2021/03/30/review-monster-train-can-you-keep-hell-from-freezing-over/). Covenant 10 переделывали: было ослепление на этаже под пиром, стало Emberdrain первому юниту на верхнем этаже (форум) — [Steam discussion](https://steamcommunity.com/app/1102190/discussions/0/2527030866856060084)
- OpenXcom: ИИ не применяет гранаты и бластеры до хода 3 (`turnAIUseGrenade: 3`). Это ввод угрозы по времени внутри боя — [difficulty.rul](https://github.com/OpenXcom/OpenXcom/blob/master/bin/standard/xcom1/difficulty.rul)

### Inferences
- Лучшие реализации называют рычаг словами игрока. Wesnoth пишет «2x enemies, 14 scenarios», Gloomhaven — «Monsters, Traps and Gold will be 1 level higher» и «Heroes have 50% more health». Игрок знает, что изменится. В Ashen Oath для «Испытания I–V» стоит так же писать конкретику, а не «сложнее».
- Gloomhaven и Wesnoth разделяют рычаги, понижающие угрозу (Peaceful −25 % врагов, Easy −1 уровень), и рычаги, дающие игроку запас (Healthy +50 % HP, Blessed). У Gloomhaven это флаг `PositiveEffect`. Для новичка «больше запаса» не меняет поведение врагов и читаемость боя; «меньше врагов» делает бой ещё и понятнее (довод ITB: одна лишняя единица — «невозможно»).
- Скорость роста угроз у LoR: средний размер волны от 2,3 до 4,1 за 5 глав и потолок силы врага = номер главы. Новые угрозы прибавляются медленно, сила врагов ограничена прогрессом. Похоже на нужную Ashen Oath «кривую новизны».
- DOS2 Tactician усиливает ИИ, в том числе в сторону «добить слабого» и фокуса огня. Это повышает «непонятные смерти»: игрок умирает от координации, а не от одного видимого удара. Для лестницы «Испытание» безопаснее числа и состав, чем скрытое поведение, если поведение не телеграфируется.
- XCOM 2 лимит активных врагов (4 на Rookie) и OpenXcom «не раньше хода 3» — это ограничение одновременных угроз и задержка опасного инструмента. В реальном времени это прямо переносится: лимит одновременно целящихся лучников и сапёров с горящим фитилём; задержка первых телеграфируемых атак после начала боя.

### Gaps
- Into the Breach: точные числа Easy/Normal/Hard (частоты, число Alpha) из файлов игры не получены; источники расходятся. Порядок островов и ввод видов Vek по островам не найдены в надёжном источнике.
- DOS2: числовые бонусы врагам на Tactician (форумные «+50 % Vitality, +50 % Damage, +10 % к попаданию») в извлечённых `Data.txt` и `Potion.txt` не найдены. Вероятно, они в движке или в других файлах статов; не подтверждено.
- XCOM 2: длина отсчёта Avatar по уровням (форум: 20 дней Veteran, 15 Commander) не подтверждена официально.
- Monster Train: полный список Covenant 1–25 с числами не получен (вики закрыта 401).
- Gloomhaven: формула уровня сценария в цифровой версии в коде не проверена (IL2CPP); взята из правил настольной игры.

---

## 4. Что Ashen Oath может взять в реальном времени (всё ниже — **вывод**, не факт из источников)

Контекст из запроса и `docs/realtime-prototype.md`. `planChain` уже подсвечивает «погибнет» (крест) и «ранен» (кольцо с «!»), число силы цепи над героем краснеет, если последний выживет. «Точного прогноза поля нет» (`docs/realtime-prototype.md:548`). Телеметрия уже пишет причину смерти, источники урона и `ThreatTally` (предупреждён / попал / увернулся / защищён) (`docs/realtime-telemetry.md:20, 148`).

### Takeaway
Ashen Oath детерминирован, и подсветка обязана совпадать с исполнением. Поэтому он может дать прогноз уровня ITB и Transistor, а не уровня XCOM. Это прогноз урона, который герой получит за время прохода цепи; показ угроз, которые сработают на пути; явное «этот проход тебя убьёт». Плюс экран «почему» после смерти по образцу LoL Death Recap с привязкой к телеграфу, который был показан.

### Cited Findings
- Прогноз в духе Transistor (стоимость и урон каждого действия до подтверждения) и Frozen Synapse (симуляция при неизменных приказах врагов) — [GamesRadar](https://gamesradar.com/transistor-combat-guide/2), [Wikipedia, Frozen Synapse](https://en.wikipedia.org/wiki/Frozen_Synapse)
- Шкала «до конца» короткая и всегда на виду (Grid ≤ 7); её удлинение обесценивает ответные действия — [Wiltshire](https://www.gamedeveloper.com/design/reimagining-failure-in-strategy-game-design-in-i-into-the-breach-i-)
- Разбор смерти: тип урона, источник, длительность, потеря контроля, сортировка по вкладу — [PCGamesN](https://www.pcgamesn.com/league-of-legends/death-recap), [LoL Wiki](https://wiki.leagueoflegends.com/en-us/Death_recap)
- Счётчики до атаки, видимые на каждом враге (Wildfrost) — [Wildfrost Wiki](https://wildfrostwiki.com/Counter)

### Inferences (предложения; каждое — вывод)
1. **Прогноз урона прохода — «−N» над героем при ведении цепи.** Пока игрок держит цепь, симуляция на копии мира прогоняет проход до конца при текущих командах (как Frozen Synapse при неизменных приказах врагов). Над героем показывается сумма касаний и попаданий за проход. В отличие от Frozen Synapse, у Ashen Oath нет одновременно действующего противника. Если в проходе нет ввода игрока, прогноз точен, и его можно подчинить правилу «подсветка = исполнение» (новый параметр `Params`, расхождение — дефект). Риск — стоимость симуляции каждый кадр; нужен замер.
2. **Угрозы на пути цепи.** Показывать на маршруте прохода только те телеграфы, что сработают по герою во время прохода: стрела лучника (1 с), фитиль сапёра (0,8 с), бюст гоблина (0,6 с), окно брони элиты. Это стрелки «источник → цель», как в LoR (`BattleUnitTargetArrowData`: одиночная или парная цель). Красный — ударит до конца прохода; серый — сработает позже. Касания (73 % урона) отмечать контуром врага, который коснётся героя на пути.
3. **«Этот проход тебя убьёт».** Если прогноз даёт HP ≤ 0, над героем череп и красная подсветка, как «последний выживет» сейчас. Проход не запрещать: ITB не запрещает ходы, а показывает исход. Аналог Wesnoth «chance_unscathed»: если прогноз 0 урона, явная зелёная метка «чисто».
4. **Единый язык телеграфов с отсчётом.** Сейчас у угроз разные окна (1 / 0,8 / 0,6 с). Wildfrost показывает число до атаки на каждом источнике. В реальном времени — сходящееся кольцо одного стиля на любой атаке с окном, чтобы игрок учил один знак, а не три.
5. **Death Recap с привязкой к телеграфу.** На экране поражения — последние 3–5 с урона:
   - источник (вид врага, способность, аффикс элиты);
   - доля урона;
   - был ли телеграф и сколько длился («Стрела лучника — предупреждение 1,0 с, герой вёл цепь»);
   - сколько урона пришло во время ведения цепи (известная проблема: 27–29 % урона за ведение, `docs/realtime-prototype.md:358`).
   
   Данные уже есть в `FightSummary` и `ThreatTally`. Повтор последних секунд можно получить детерминированным повтором журнала (хук `__realtime.replayTo` из `docs/realtime-telemetry.md`). Это дешёвый killcam без записи видео.
6. **Состояние «на краю» перед смертью.** По образцу Death's Door: при HP ≤ порога — заметный, но не текстовый сигнал (пульс рамки, звук). Смерть тогда не внезапна с «полного». Числовые правила DD (шанс выжить) не переносить: это случайность, противоречит ITB-подходу.
7. **Сложность для новичков — число одновременных угроз, а не скрытая помощь.** Опора: XCOM 2 лимит активных 4/6/6/∞, ITB «одна лишняя единица — невозможно», OpenXcom «гранаты не раньше хода 3». В ранних боях и на «Испытании I» ограничить число одновременно активных телеграфов (например, не больше одного целящегося лучника) и отложить первые опасные способности на несколько секунд. Скрытая помощь вроде XCOM aim assist или FE 2RN несовместима с «подсветка = исполнение».
8. **Лестница «Испытание I–V» — с конкретными подписями.** Как Wesnoth («2x enemies, 14 scenarios») и Gloomhaven («Monsters, Traps and Gold will be 1 level higher»): каждая ступень называет рычаг («+1 элита в ряду», «сапёры с короче фитилём»). Gloomhaven-модель «уровень +1» не пропорциональна (Bandit Guard: на одних шагах растёт HP, на других атака или ход). Значит, ступени можно собирать из разных рычагов, но подпись обязана перечислять их.
9. **Ввод новинок — потолок по главе.** По образцу LoR: средний размер волны рос 2,3 → 4,1 за 5 глав, эмоциональный уровень врага ≤ номера главы. Для Ashen Oath: в каждом ряду похода не больше одной новой угрозы с телеграфом, и пока игрок не встретил её в одиночку, она не появляется в паре с другой новой. Этот вывод сверить с соседними заметками «Кривые сложности и новизны».

### Gaps
- Нет данных, что прогноз урона за проход в реальном времени где-то сделан. Ближайшие аналоги — пошаговые или в паузе (Transistor, Frozen Synapse, LoR). Цену симуляции на кадр в Ashen Oath нужно замерить.
- Не проверено, показывает ли Ashen Oath игроку причину смерти сейчас: телеметрия её пишет, но про экран поражения в найденных документах данных нет.
