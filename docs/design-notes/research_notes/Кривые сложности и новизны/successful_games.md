# Кривые сложности и новизны в успешных roguelite и action/puzzle играх

Заметки собраны 14.10.2026. Проценты достижений Steam сняты в этот день со страниц `steamcommunity.com/stats/<appid>/achievements`. Это доля среди владельцев игры, точный знаменатель Steam не раскрывает. Все проценты — срез на дату, не историческая величина. Числа с вики помечены «вики». Утверждения по памяти без источника вынесены в «Пробелы».

## 1. Первый поход: каков опыт и доля побед в первом забеге

### Вывод
Единственная найденная цифра доли побед в первом походе — Slay the Spire, около 9–10 % (данные Mega Crit, 2020). По достижениям Steam хорошо видна «лестница отсева»: акт 1 проходят 80–90 % игроков, финал первого цикла — 40–70 %, в зависимости от игры.

### Найденные факты
- **Slay the Spire, первый поход.** Анализ открытого набора данных Mega Crit (18,2 млн походов, сборки 2020-01-27 и 2020-07-30; первый поход определён по `player_experience = 0`): автор пишет «около 9,6 %». Его же таблица (10 426 побед / 109 066 поражений) даёт 8,7 %. По сборкам: 6,0 % и 9,8 %. Разница значима, причина не выяснена. Для сравнения: все персонажи на A0 — 9,3 %, Ironclad на A0 — 10,7 %. Первый поход идёт за Ironclad, у него меньше карт, события боссов заскриптованы. — [foxrow.com, Slay the Spire First Run Winrate](https://foxrow.com/slay-the-spire-first-run-winrate)
- **Slay the Spire, достижения Steam.** Боссы акта 1: The Guardian 85,0 %, The Ghost (Hexaghost) 81,5 %, The Boss (Slime Boss) 78,2 %. Боссы, которых я отношу к акту 2 (см. «Пробелы»): The Champion 70,8 %, The Automaton 65,8 %, The Collector 64,1 %. Боссы акта 3: The Shapes 55,5 %, The Crow 54,8 %, The Time Eater 49,4 %. «Ascend 0» («Открыть Ascension», то есть победить босса акта 3) — 66,4 %. Победа за каждого персонажа: Ruby (Ironclad) 56,1 %, Emerald 50,4 %, Sapphire 44,1 %, Amethyst 26,0 %. Финал за Сердцем «The End?» — 13,1 %. — [Steam, Slay the Spire achievements](https://steamcommunity.com/stats/646570/achievements); состав боссов акта 1 — [вики, Exordium](https://slaythespire.wiki.gg/wiki/Exordium)
- **Hades, достижения Steam.** Escaped Tartarus 81,8 % → Escaped Asphodel 72,2 % → Escaped Elysium 58,8 % → «Is There No Escape?» (первый полный побег) 46,7 %. Полный сюжет («The Family Secret») — 23,3 %, эпилог — 8,4 %. — [Steam, Hades achievements](https://steamcommunity.com/stats/1145360/achievements)
- **Dead Cells, достижения Steam.** Дошли до первого биома после тюрьмы (Promenade) 92,0 %. Ramparts — 81,6 %. Победили The Concierge 72,3 %. Clock Tower — 61,2 %. Победили Time Keeper 55,7 %. Тронный зал — 47,9 %. Победили Hand of the King (первое прохождение) — 40,3 %. — [Steam, Dead Cells achievements](https://steamcommunity.com/stats/588650/achievements)
- **Balatro, достижения Steam.** Ante 4 — 89,8 %, Ante 8 — 74,5 %, первая победа — 71,6 %. Очень пологий вход по сравнению с другими играми. — [Steam, Balatro achievements](https://steamcommunity.com/stats/2379780/achievements)
- **Dead Cells, время до первой победы.** Это только впечатление одного игрока: в 2017 году около 50 часов на 0BC, в последние годы «многие» укладываются в 10 часов. — [Steam, обсуждение](https://steamcommunity.com/app/588650/discussions/0/3196992424206434855) (анекдот, не измерение)
- **Slay the Spire 2, сторонний трекер.** Доживают до конца акта 1 58,1 % из 57 700 походов. Самые смертоносные бои акта 1 — боссы (21 % и 19,3 % смертей). Это сторонний сайт, не данные Mega Crit, и выборка смещена к увлечённым игрокам. — [STS Tracker](https://ststracker.app/)

### Выводы аналитика
- Достижения дают кривую «доля дошедших» по актам. Каждый следующий акт срезает примерно 10–15 п. п. от тех, кто его начал: StS 85 → ~70 → ~55, Hades 82 → 72 → 59 → 47, Dead Cells 92 → 72 → 56 → 40. Этот отсев равномерный, без одного обрыва. Это похоже на намеренную кривую: каждый акт — отдельная ступень.
- Победа в первом походе — редкость (StS ~9 %). Но до первой победы доходит большинство игроков: 56–72 % в StS, Hades и Balatro. Значит, первую победу проектируют на 5–20 походов, а не на первый.
- Для Ashen Oath: телеметрия похода может строить такую же кривую «доля дошедших до ряда N» и сравнивать её с этими ступенями.

### Пробелы
- Акты боссов 2 и 3 Slay the Spire приведены по памяти. В эту сессию проверен только акт 1 (вики Exordium).
- Доля побед в первом походе у Hades, Dead Cells, Balatro, Vampire Survivors не найдена. Публичных данных разработчиков нет.
- Проценты Steam смешивают всех владельцев, в том числе бросивших игру после 10 минут. Их нельзя прямо приравнять к доле побед среди активных игроков.
- В Hades «Is There No Escape?» включает побеги в God Mode. Доля побегов без него неизвестна.

## 2. Как вводят новых врагов и механики по этажам и актам

### Вывод
Повторяющийся шаблон: акт или биом — свой набор врагов и один босс из небольшого пула. Внутри акта первые бои берут из «лёгкого» пула. Новые угрозы привязаны к геометрии биома (Hades) или к порогу номера уровня (Balatro).

### Найденные факты
- **Slay the Spire, акт 1 (Exordium).** Первые три боя берут из лёгкого пула: Cultist, Jaw Worm, 2 Louse, малые слизни. Дальше — тяжёлый пул из 10 групп (Gremlin Gang, Large Slime, Slavers, 3 Louse, Fungi Beasts, комбинации «Thugs» и «Wildlife» и др.). 3 элиты (Gremlin Nob, Lagavulin, 3 Sentries), 3 босса (Slime Boss, Hexaghost, The Guardian). — [вики, Exordium](https://slaythespire.wiki.gg/wiki/Exordium)
- **Slay the Spire, GDC 2019.** По конспекту доклада Giovannetti «Metrics Driven Design and Balance»: атаки врагов в ходе раннего доступа сделали предсказуемее. Самую крупную вырезанную механику убрали по данным из базы. — [Podwise, конспект доклада](https://podwise.ai/episodes/1459444); [GDC Vault](https://www.gdcvault.com/play/1025731) (конспект вторичный, полного текста нет)
- **Hades, биомы.** Ed Gorinstein (дизайнер уровней), 01.10.2020: в Tartarus — средние, почти всегда закрытые стенами комнаты, чтобы игрок учился Cast и получал урон о стену. В начале биома чаще малые комнаты, к концу — крупные. В Asphodel комнаты — острова в лаве, у каждого врага свой способ пересечь лаву, поэтому враги Asphodel подвижнее. — [Kotaku, 02.10.2020](https://kotaku.com/hades-level-design-is-less-random-than-it-seems-1845254545)
- **Hades, длина биомов.** По фан-вики, в Tartarus 15 комнат (с ответвлением через Chaos Gate в 12-й), в Elysium всегда 11. Другие гайды пишут «около дюжины». Числа расходятся между версиями. — [Gamepressure, Underworld structure](https://www.gamepressure.com/hades/underworld-structure-1/z4d9c4); [breezewiki, Tartarus](https://breezewiki.discard.no/hades/wiki/Tartarus) (вики)
- **Hades, элиты в биоме.** По фан-вики, обычные враги Tartarus могут выходить «элитными»: с бронёй и усиленными атаками. Это та же модель, новых видов нет. — [breezewiki, Tartarus](https://breezewiki.discard.no/hades/wiki/Tartarus) (вики)
- **Balatro, боссы по анте.** На анте 1 — только 8 боссов из пула. С анте 2 добавляются ещё 10 (The Wall ×4 к требованию, The Needle и др.). С анте 3 — The Eye, The Tooth; с 4 — The Plant; с 5 — The Serpent; с 6 — The Ox. На анте 8 — отдельный пул «Showdown». Босс не повторяется, пока не выпадут все остальные. — [Balatro Wiki, Blinds and Antes](https://balatrowiki.org/w/Blinds_and_Antes) (вики)
- **Into the Breach.** Атаки врагов показываются заранее (telegraphed). Цель — чтобы каждая смерть ощущалась как ошибка самого игрока. — [Game Developer, Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-). На Hard больше спавнов и больше Alpha Vek, на Easy — меньше спавнов. — [Into the Breach Wiki, Islands](https://intothebreach.fandom.com/wiki/Islands) (вики)
- **Dead Cells.** Выше уровни Boss Cell поднимают тир врагов, плотность и разнообразие. Часть врагов есть только на высоких уровнях. — [Dead Cells Wiki, Boss Stem Cell](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell) (вики)

### Выводы аналитика
- В Hades новизна биома состоит из трёх частей: новые враги, новая геометрия и способ передвижения, который геометрия требует. Для Ashen Oath это поддерживает план «лес → гарнизон → замок»: в каждом акте не только новый состав врагов, но и новое правило поля.
- Balatro привязывает «новые правила» к минимальному анте. Это дешёвый способ: пул растёт с глубиной, а старые угрозы остаются. Его можно перенести на пулы арен по рядам.
- «Лёгкий пул на первые 3 боя» в StS — явная мягкая ступень в начале каждого похода, не только первого.

### Пробелы
- Порядок появления видов Vek по островам Into the Breach не найден. Страница Missions на вики — заготовка. По памяти: острова проходят в любом порядке, сложность растёт с числом пройденных островов. Это не проверено.
- Доклад Subset Games на GDC 2019 «Into the Breach Design Postmortem» есть только видео (вопрос «как выбрать правильную сложность» стоит в описании). Расшифровку не нашёл. — [GDC Vault](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design)
- Порядок ввода врагов в актах 2–3 StS и в Dead Cells по биомам не собран.

## 3. Как растёт давление внутри похода (HP, урон, плотность, время)

### Вывод
Есть три модели. 1) Ступени по актам с фиксированными составами (StS, Hades). 2) Непрерывная функция от времени и номера уровня (Risk of Rain 2, Brotato, Vampire Survivors, Tetris). 3) Экспоненциальная цель счёта (Balatro). Непрерывные модели публикуют точные формулы, и в них виден «таймер» как источник давления.

### Найденные факты
- **Risk of Rain 2, формула.** `coeff = (playerFactor + minutes × timeFactor) × stageFactor`. `timeFactor = 0,0506 × difficultyValue × players^0,2`. `stageFactor = 1,15^stagesCompleted`. Drizzle = 1 (+70 брони, реген ×1,5), Rainstorm = 2, Monsoon = 3 (реген ×0,6). Уровень врага = `1 + (coeff − playerFactor)/0,33`. Каждый уровень даёт +30 % HP и +20 % урона. — [Risk of Rain 2 Wiki, Difficulty](https://riskofrain2.wiki.gg/wiki/Difficulty) (вики)
- **Balatro, требования по анте (база).** 300 / 800 / 2 000 / 5 000 / 11 000 / 20 000 / 35 000 / 50 000. С Green Stake: 300 / 900 / 2 600 / 8 000 / 20 000 / 36 000 / 60 000 / 100 000. С Purple Stake: до 200 000 на анте 8. Малый блайнд ×1, большой ×1,5, босс ×2 (The Wall ×4, Violet Vessel ×6). — [Balatro Wiki, Blinds and Antes](https://balatrowiki.org/w/Blinds_and_Antes) (вики)
- **Brotato.** Враг начинает с базового HP и получает фиксированную прибавку +HP за каждую волну после первой (пример: Tree — 10 HP на волне 1, +5 за волну). Боссы в патче 1.0.0.3: было 28 000 + 100/волну, стало 15 000 + 750/волну. Волны идут по 20–90 секунд. — [Brotato Wiki, Enemies](https://brotato.wiki.spellsandguns.com/Enemies) (вики); [Godot showcase](https://godotengine.org/showcase/brotato/)
- **Vampire Survivors.** На 30-й минуте приходит Reaper. Каждую следующую минуту добавляется ещё один. Curse увеличивает скорость, HP, частоту и число спавнов без верхней границы. — [Vampire Survivors Wiki, The Reaper](https://vampire-survivors.fandom.com/wiki/The_Reaper); [vampire.survivors.wiki, Curse](https://vampire.survivors.wiki/w/Curse) (вики)
- **Tetris (Guideline Marathon).** Время падения на одну строку = `(0,8 − (L−1)×0,007)^(L−1)` секунд. Уровень 1 — 0,01667G, уровень 10 — 0,2598G, уровень 20 — 36,6G. После 19-го уровня единого правила нет; часть игр держит 20G и сокращает задержку фиксации. — [Tetris Wiki, Marathon](https://tetris.wiki/Marathon) (вики)

### Выводы аналитика
- Кривая Tetris экспоненциальна: на уровнях 1–10 скорость растёт плавно, на 15–20 — резко. Это пример «стены» в конце, которую принимают как финал.
- RoR2 смешивает время (давит на медлительных) и номер уровня (×1,15 за уровень). Сочетание наказывает за затяжку и делает ход «вперёд» единственной защитой.
- Для Ashen Oath с фиксированными аренами ближе модель StS/Hades: ступени по рядам. Модели «от времени» могут подойти для необязательной рискованной фазы после целей: давление растёт, пока игрок остаётся.

### Пробелы
- Конкретные множители HP и урона врагов между актами StS и биомами Hades не собраны.
- Формулу спавна Vampire Survivors по минутам на вики не получил (страница Curse упоминает её, но поиск её не вернул).
- Halls of Torment, Puzzle & Dragons, Tetris 99 (давление от атак соперников) не исследованы.

## 4. Элиты и боссы как пики сложности

### Вывод
Во всех найденных играх босс — главный пик акта и главная точка смерти. Элиты — необязательный или полуобязательный пик с повышенной наградой. Лестницы сложности почти всегда начинают с усиления элит и боссов.

### Найденные факты
- **Slay the Spire 2, сторонний трекер.** Самые смертоносные бои акта 1 — два босса (21 % и 19,3 % смертей). — [STS Tracker](https://ststracker.app/) (не данные Mega Crit)
- **Slay the Spire, Ascension.** A1 — элит на ~60 % больше. A3 — элиты сильнее бьют. A4 — боссы сильнее бьют. A8–A9 — у элит и боссов больше HP. A18–A19 — у них сложнее наборы ходов. A20 — два босса в конце акта 3. — [вики, Ascension](https://slaythespire.wiki.gg/wiki/Ascension) (вики)
- **Hades.** Условие Pact «Extreme Measures» сильно меняет каждый бой с боссом. — [Game Rant, интервью Kasavin](https://gamerant.com/hades-interview-early-access-release-dlc-covid/) (по выдаче поиска)
- **Dead Cells.** Уровни Boss Cell 1 и 2 меняют ранние фазы боссов. — [Dead Cells Wiki, Boss Stem Cell](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell) (вики)
- **Balatro.** Босс-блайнд — ×2 от базы, отдельные боссы до ×4–×6. Каждая третья ставка в анте — пик с особым правилом. — [Balatro Wiki](https://balatrowiki.org/w/Blinds_and_Antes) (вики)
- **Hades II, ранний доступ.** Patch 2 (около месяца после старта раннего доступа, 2024) ослабил Chronos, чтобы бой реже был «patently unfair». Большинство правок патча предложили игроки. — [Dexerto](https://www.dexerto.com/gaming/hades-2-early-access-patch-2-notes-massive-daedelus-hammer-changes-bug-fixes-more-2760049/); [Shacknews](https://shacknews.com/article/140086/hades-2-patch-2-notes-early-access)
- **Candy Crush, уровень 65.** Задумывался как последний и был слишком сложен. Стал уровнем с самой высокой конверсией и выручкой, но и с наибольшим оттоком. A/B-тест: рост сложности поднял конверсию в краткосрочном периоде, а облегчение удержало игроков дольше. — [mobilegamer.biz, GDC 2024](https://mobilegamer.biz/how-king-defines-a-good-candy-crush-saga-level-and-why-it-constantly-prunes-the-bad-ones/)

### Выводы аналитика
- Пик «босс акта» оправдан, если игрок его видит заранее и может к нему готовиться. В StS босс акта известен на карте, в Balatro босс-блайнд виден до начала анте. Для Ashen Oath это аргумент показывать босса и элиты на карте заранее.
- Лестница StS меняет элит и боссов раньше, чем обычных врагов (A1, A3, A4). Значит, пики — первое, что «закручивают», а не фон.
- Опыт King: чрезмерно жёсткий одиночный пик повышает отток. Для игры без монетизации важен только этот вред.

### Пробелы
- Доля смертей на боссах и элитах в оригинальном StS по данным Mega Crit не найдена.
- Соотношение смертей «элита / обычный бой / босс» в Hades и Dead Cells не найдено.

## 5. Лечение и отдых как клапан сложности

### Вывод
Лечение — главный рычаг тонкой настройки. Во всех найденных лестницах урезание лечения появляется рано и до того, как враги меняют поведение. Dead Cells настраивал кривую в основном числом зарядов фляги.

### Найденные факты
- **Slay the Spire.** Без Ascension после босса лечится 100 % недостающего HP; A5 — 75 %. A6 — поход начинается с −10 % HP. A11 — на один слот зелий меньше. A14 — меньше макс. HP. — [вики, Ascension](https://slaythespire.wiki.gg/wiki/Ascension) (вики)
- **Dead Cells, Boss Cell.** 1BC — фонтаны HP только в каждом втором переходе (в остальных заряд фляги). 2BC — фонтанов нет, но заряд фляги в каждом переходе. 3BC — всего 3 заряда за поход (после первого босса, перед вторым, после Lighthouse). 4BC — зарядов нет. 5BC — зарядов нет, плюс Malaise. — [Dead Cells Wiki, Boss Stem Cell](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell) (вики)
- **Dead Cells, патч 2.3 (вики) / Update of Plenty (июль 2020).** Кривую сгладили именно лечением: 2BC вернули заряд в каждом переходе, 3BC дали три заряда, с 4BC сняли Malaise. Цель — убрать скачки между уровнями: разница между 2BC и 3BC стала меньше. — [Dead Cells Wiki, Boss Stem Cell (история)](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell); [GamingOnLinux, 07.2020](https://gamingonlinux.com/2020/07/the-update-of-plenty-has-arrived-for-dead-cells-revamping-lots); [Gematsu, 07.2020](https://gematsu.com/2020/07/dead-cells-sales-top-three-million-update-of-plenty-now-available-for-pc)
- **Risk of Rain 2.** Drizzle: реген ×1,5 и +70 брони. Monsoon: реген ×0,6. Eclipse 5: лечение союзников −50 %. Eclipse 8: урон снижает максимум HP до конца уровня. — [RoR2 Wiki, Difficulty](https://riskofrain2.wiki.gg/wiki/Difficulty); [RoR2 Wiki, Eclipse](https://riskofrain2.wiki.gg/wiki/Eclipse) (вики)
- **Hades, God Mode.** Сразу −20 % получаемого урона, +2 % за каждую смерть, потолок 80 %. Придуман в 2019 году, во время раннего доступа. Kasavin: обычный лёгкий режим этой игре не подходил; подход к сложности «не универсален». — [Can I Play That?, 11.08.2021](https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games); [Inverse](https://www.inverse.com/gaming/hades-god-mode-interview)

### Выводы аналитика
- God Mode — клапан «от смертей», а не от выбора уровня. Он сохраняет петлю roguelite и помогает застрявшим. Это близко к «мягким улучшениям удобства с потолком» из меты Ashen Oath, но God Mode — отдельный режим, а не постоянная сила по умолчанию.
- История Dead Cells показывает: сначала резали лечение ступенями (0 → все → половина → нет), потом пришлось сглаживать. Для Ashen Oath это довод менять лечение (привалы, зелья) маленькими шагами между ступенями «Испытание I–V».

### Пробелы
- Размер лечения на привале StS (по памяти 30 % макс. HP) и правило «элиты и привалы не раньше 6-го этажа» в эту сессию по источнику не проверены: страница вики Map вернула 404.
- Экономика лечения в Hades (Fountain, Centaur Heart) и в Balatro (нет HP) не собрана.

## 6. Лестница после первой победы

### Вывод
Шаблон «лестница открывается первой победой, следующий уровень — победой на текущем, модификаторы накапливаются» повторяется почти дословно в StS, Balatro, RoR2, Peglin, Dead Cells. Hades прямо называет StS источником. Глубину лестницы проходит меньшинство: 7–15 % по достижениям.

### Найденные факты
- **Slay the Spire, Ascension.** 20 уровней, модификаторы копятся. Ascension открывает победа над боссом акта 3 этим персонажем. Каждый следующий уровень — победа над боссом акта 3 на текущем. Прогресс отдельный для каждого персонажа. Сердце (акт 4) не нужно. — [вики, Ascension](https://slaythespire.wiki.gg/wiki/Ascension). Steam: Ascend 0 — 66,4 %, Ascend 10 — 14,8 %, Ascend 20 — 7,3 %. — [Steam](https://steamcommunity.com/stats/646570/achievements)
- **Slay the Spire, GDC 2019.** Уровни Ascension использовали, чтобы настроить сложность под разные группы игроков. — [Podwise, конспект](https://podwise.ai/episodes/1459444) (вторично)
- **Balatro, Stakes.** 8 ставок: White (база) → Red (малый блайнд без денег) → Green (быстрее растёт требование) → Black (Eternal-джокеры) → Blue (−1 сброс) → Purple (ещё быстрее растёт требование) → Orange (Perishable) → Gold (Rental). Ставки открываются отдельно для каждой колоды победой на текущей. Победы на некоторых ставках открывают новые колоды. — [Balatro Wiki, Stakes](https://balatrowiki.org/w/Stakes) (вики). Steam: Red и выше — 43,7 %, Black — 30,3 %, Gold — 12,2 %, Gold на всех колодах — 1,6 %. — [Steam](https://steamcommunity.com/stats/2379780/achievements)
- **Hades, Pact of Punishment.** Открывается после первого побега (то есть победы над Аидом). Условия складываются в Heat. В режиме Hell Mode Pact доступен сразу. — [Prima Games](https://primagames.com/tips/what-hell-mode-hades); [TrueAchievements](https://www.trueachievements.com/game/Hades/walkthrough/7). Kasavin: на Pact повлияла система Ascension из StS. — [Tom's Guide](https://www.tomsguide.com/features/hades-exclusive-interview-supergiant) (по выдаче поиска; страницу прочитать не удалось). При первом вводе Pact не давал наград; в Superstar Update его переделали и привязали к Bounties. — [Hades Wiki, Pact of Punishment](https://hades.fandom.com/wiki/Pact_of_Punishment) (вики, по выдаче поиска)
- **Risk of Rain 2, Eclipse.** 8 уровней на каждого героя, повышение только за пройденный поход, модификаторы копятся: E1 HP при появлении −50 %, E2 зона телепорта −50 %, E3 смертельный урон от падения, E4 скорость врагов +40 %, E5 лечение −50 %, E6 золото с врагов −20 %, E7 перезарядки врагов −50 %, E8 постоянный урон до конца уровня. Наград за Eclipse нет. — [RoR2 Wiki, Eclipse](https://riskofrain2.wiki.gg/wiki/Eclipse) (вики)
- **Dead Cells, Boss Cells.** Первую получают за победу над Hand of the King (или Queen) на 0BC, пятую — над Giant на 4BC. Каждый уровень открывает новые двери и биомы, повышает уровень предметов и множитель клеток. — [Dead Cells Wiki](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell) (вики)
- **Peglin, Cruciball.** Открывается после прохождения игры. Каждый уровень добавляет отрицательный эффект, следующий открывается победой, всего 20. — [Wikipedia, Peglin](https://en.wikipedia.org/wiki/Peglin). Пополевые эффекты уровней в источниках не подтверждены.
- **Brotato, Danger 0–5.** Каждый уровень наследует предыдущие. Danger 2 вводит элит и орды, Danger 4 делает их чаще, на Danger 5 враги получают +40 %. Победа на каждом уровне Danger открывает персонажа. — [Brotato Wiki, Dangers](https://brotato.wiki.spellsandguns.com/Dangers) (вики)

### Выводы аналитика
- У лестниц две разные награды. Dead Cells и Balatro дают контент (биомы, колоды), RoR2 и StS — только статус. Dead Cells и Brotato открывают элиты или новые биомы вместе со сложностью: сложность сама становится новизной.
- Первые ступени почти везде — «больше элит», «меньше денег», «меньше лечения». Изменения поведения врагов идут в конце (StS A17–A19). Порядок «сначала числа, потом поведение» повторяется.
- Для «Испытание I–V» (5 ступеней) ближе Dead Cells (5BC) и Brotato (Danger 5), чем StS с 20 уровнями. Падение доли с 66 % до 15 % на A10 в StS показывает: длинная лестница нужна меньшинству.

### Пробелы
- Распределение игроков по Heat в Hades не найдено: в Steam нет достижений Heat.
- Доли игроков Dead Cells по уровням Boss Cell не найдены. У части достижений Steam описание скрыто; какие из них за Boss Cell, установить не удалось.
- Полный список условий Pact с Heat за ранг не получен (вики недоступны: 401/402).

## 7. Открытия как способ дозировать сложность правил

### Вывод
Сложность правил дозируют открытиями: первый поход идёт с урезанным набором (StS — один персонаж и меньше карт), затем открываются персонажи, предметы, колоды. Прямых высказываний разработчиков «почему так» почти не нашёл. Пример Isaac показывает обратную сторону: без меры объём превышает то, что держит в голове даже автор.

### Найденные факты
- **Slay the Spire.** В первом походе — только Ironclad, меньше карт в пуле, события боссов заскриптованы. — [foxrow.com](https://foxrow.com/slay-the-spire-first-run-winrate). На старте три персонажа с отдельными наборами карт и «множество открытий». — [Mega Crit, press](https://www.megacrit.com/press/)
- **Balatro.** Колоды открываются победами на определённых ставках: Red → Zodiac, Green → Painted, Black → Anaglyph, Blue → Plasma, Orange → Erratic. — [Balatro Wiki, Stakes](https://balatrowiki.org/w/Stakes) (вики)
- **Brotato.** Персонажей открывают за суммарные убийства (например, 300 и 20 000), материалы, испытания и победу на каждом уровне Danger. Пороги в источниках расходятся. — [Commonsensegamer](https://commonsensegamer.com/brotato-how-to-unlock-all-characters/) (гайд)
- **Binding of Isaac.** В 2011 году 196 предметов, затем 341, 436, позже 504, плюс 118 брелоков. Большинство нужно открывать победами или испытаниями. Игра почти ничего не объясняет: предмет можно понять, только взяв его. — [Kill Screen, postmortem](https://www.killscreen.com/binding-issac-postmortem/). McMillen: «I can't even remember it all», к Afterbirth+ ему приходилось сверяться с фан-вики. — [Vice](https://vice.com/en/article/10-years-after-release-edmund-mcmillen-cant-stop-working-on-binding-of-isaac)
- **Vampire Survivors.** Бонусные этапы открываются через Hyper Mode и Inverse Mode; первое прохождение этапа открывает его секрет. — [Giant Bomb](https://www.giantbomb.com/wd/3030-84714). Galante (poncle): механики основной игры добавляют в обновлениях, ключевые функции не закрывают платными DLC. — [80.lv](https://80.lv/articles/vampire-survivors-dev-says-the-sequel-to-the-game-is-unlikely/). Мнение игрока-разработчика (не официальное): закрывать функции открытиями обычно плохо, но здесь работает, потому что игра проста для понимания. — [Steam, обсуждение](https://steamcommunity.com/app/1794680/discussions/0/595141473937133142)
- **Hades.** Pact закрыт до первого побега. Hell Mode снимает этот замок. — [Prima Games](https://primagames.com/tips/what-hell-mode-hades)

### Выводы аналитика
- Шаблон «первые 5–10 походов вводят сложность правил» подтверждается косвенно: StS режет набор только в первом походе, Balatro и Brotato открывают контент по ступеням лестницы. Прямой цифры «за N походов» в источниках нет.
- Для Ashen Oath, где мета — только разнообразие: открытие новых талисманов, молотов, реликвий после первых побед или ступеней «Испытания» повторяет Balatro (контент за ступень), не давая постоянной силы.

### Пробелы
- Высказываний Mega Crit о причине урезанного первого похода не нашёл.
- Подробной схемы открытий Enter the Gungeon, Spelunky 2, Halls of Torment, Luck be a Landlord не собрал.

## 8. Что сработало и что нет: высказывания разработчиков и контрпримеры

### Вывод
Типичный провал — резкий скачок в одном месте: стартовая зона (Spelunky 2), разрыв между ступенями (Dead Cells 2BC → 3BC), «нечестный» босс (Hades II, Chronos). Типичное лечение — точечная правка спавнов, лечения или босса, а не общее снижение сложности. Общая позиция разработчиков: смерть должна быть понятной и «своей».

### Найденные факты
- **Dead Cells, Update of Plenty (июль 2020).** 0BC сделали **сложнее**, чтобы новички учили движения и успели собрать снаряжение и руны до перехода дальше. Кривую 0–5BC выровняли, чтобы убрать скачки; разница 2BC и 3BC стала меньше. — [GamingOnLinux](https://gamingonlinux.com/2020/07/the-update-of-plenty-has-arrived-for-dead-cells-revamping-lots); [Gematsu](https://gematsu.com/2020/07/dead-cells-sales-top-three-million-update-of-plenty-now-available-for-pc); [GameSpot](https://gamespot.com/articles/dead-cells-update-of-plenty-patch-reworks-crossbow/1100-6479225/)
- **Dead Cells, Sébastien Bénard (Motion Twin).** «Difficult, but not unfair»; игрок должен понимать, почему погиб. В раннем доступе ждали 80 % идей от команды и 20 % от игроков, вышло 50/50. — [Game Informer, 30.12.2018](https://gameinformer.com/interview/2018/12/30/dead-cells-designer-discusses-scrapped-ideas-roguelikes-and-the-potential-for)
- **Spelunky 2, Dwelling.** Критика: первая зона Spelunky 2 тяжелее, чем должна быть, а Spelunky 1 хвалили за мягкий вход. Derek Yu проверял правки частоты врагов и ловушек, особенно на 1-1 и 1-2. Он предупреждал, что в Spelunky намеренно есть «острые углы», и вместе с раздражением можно убрать удовольствие. — [GamingBolt](https://gamingbolt.com/spelunky-2-creator-looking-into-tweaking-first-areas-difficulty). Yu хотел, чтобы новички в Spelunky 2 играли лучше: многие бросили Spelunky 1. — [PCGamesN](https://www.pcgamesn.com/spelunky-2/gameplay). Сложность — средство, а не цель («как острая еда»). — [PC Gamer](https://www.pcgamer.com/uk/playing-difficult-games-is-like-eating-spicy-food-says-spelunky-creator/)
- **Hades.** God Mode как ответ на запрос доступности, без традиционного лёгкого режима. — [Can I Play That?](https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games). Pact сначала был без наград, позже его привязали к Bounties. — [Hades Wiki](https://hades.fandom.com/wiki/Pact_of_Punishment) (вики, по выдаче поиска)
- **Hades II.** Patch 2 раннего доступа (2024) ослабил Chronos из-за «patently unfair»; большинство изменений предложили игроки. — [Dexerto](https://www.dexerto.com/gaming/hades-2-early-access-patch-2-notes-massive-daedelus-hammer-changes-bug-fixes-more-2760049/)
- **Slay the Spire, GDC 2019.** Метрики могут вводить в заблуждение. Есть риск смещения из-за «супер-тестеров». Внутренний Slack и сервер метрик, еженедельные обновления, Discord, стримеры. — [Podwise, конспект](https://podwise.ai/episodes/1459444) (вторично); [GDC](https://gdconf.com/news/learn-slay-spires-successful-metrics-driven-approach-game-balancing-gdc-2019)
- **Into the Breach.** Атаки врагов показываются заранее, чтобы каждая смерть была ошибкой игрока. — [Game Developer](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-)
- **Candy Crush (King, GDC 2024, Jan Wedekind и Xavier Guardiola).** Сложность и удовольствие разделяют. Удовольствие меряют составной метрикой из «времени до отказа» и «времени до прохождения». Чем сложнее уровень, тем короче он должен быть. Навык игрока оценивают за недели или месяцы по победам, поражениям и попыткам. «Пазловые» уровни, требующие навыка, вовлекают меньше всего. Регулярно находят и правят 100 «наименее весёлых» уровней, это дало «очень значимый» рост вовлечённости. Цитаты: «crazy hard levels never pay off, at least in the long term», «designing for averages is not a good idea», «retention always wins». — [mobilegamer.biz](https://mobilegamer.biz/how-king-defines-a-good-candy-crush-saga-level-and-why-it-constantly-prunes-the-bad-ones/)
- **Candy Crush, другие доклады.** «Ритм» как отдельное понятие наряду со сложностью, течением и крючками (GDC Europe 2016, Jeremy Kang); доклад GDC Summer о «блокерах» как источнике сложности. — [PocketGamer.biz](https://www.pocketgamer.biz/king-on-finding-the-fun-in-candy-crush); [GDC, анонс](https://gdconf.com/news/come-gdc-summer-and-learn-kings-new-method-balancing-match-3-game-difficulty)

### Выводы аналитика
- Dead Cells сделал первую ступень сложнее, а не легче. Цель — чтобы игрок научился до перехода на следующую ступень. Это противоречит интуиции «первое — легче всего» и стоит проверить на прологе и первых рядах Ashen Oath.
- Правило King «чем сложнее, тем короче» прямо применимо к аренам: пиковые арены и рискованная фаза после целей должны быть короткими.
- Метрика «время до отказа / время до прохождения» переносится на телеметрию Ashen Oath: время на арене против выхода из похода на этой арене.

### Пробелы
- Термин «пила» (sawtooth) для Candy Crush в публикациях King не найден. Чередование трудных и лёгких уровней не подтверждено источником King.
- Контрпримеры с перегрузкой правил в начале (front-loaded complexity) и их исправление найдены слабо. Есть только Isaac (объём без меры) и Spelunky 2 (сложный вход).
- Enter the Gungeon, Halls of Torment, Luck be a Landlord, Puzzle & Dragons, Tetris 99 в эту сессию не исследованы.

## 9. Какие шаблоны повторяются в нескольких успешных играх

### Вывод
Шесть шаблонов подтверждены как минимум двумя играми из найденных источников. Шаблон «пила внутри акта» подтверждён только косвенно.

### Найденные факты
- **Акт = свой набор врагов + босс из небольшого пула.** StS (3 босса на акт, лёгкий и тяжёлый пулы) — [вики, Exordium](https://slaythespire.wiki.gg/wiki/Exordium); Hades (биом — свои враги и своя геометрия) — [Kotaku](https://kotaku.com/hades-level-design-is-less-random-than-it-seems-1845254545); Dead Cells (биомы и боссы) — [Steam](https://steamcommunity.com/stats/588650/achievements).
- **Мягкий вход внутри акта.** StS: первые 3 боя — лёгкий пул — [вики](https://slaythespire.wiki.gg/wiki/Exordium). Hades: малые комнаты в начале биома, крупные к концу — [Kotaku](https://kotaku.com/hades-level-design-is-less-random-than-it-seems-1845254545). Balatro: малый ×1 → большой ×1,5 → босс ×2 в каждом анте — [Balatro Wiki](https://balatrowiki.org/w/Blinds_and_Antes).
- **Лестница после первой победы, накапливаемые модификаторы, открытие следующего уровня победой на текущем.** StS, Balatro, RoR2, Peglin, Dead Cells, Brotato, Hades — источники в разделе 6.
- **Ранние ступени лестницы — числа (элиты, деньги, лечение), поздние — поведение.** StS A1–A16 против A17–A19 — [вики](https://slaythespire.wiki.gg/wiki/Ascension); RoR2 E1–E8 — [вики](https://riskofrain2.wiki.gg/wiki/Eclipse).
- **Лечение — главный рычаг настройки ступеней.** StS A5 — [вики](https://slaythespire.wiki.gg/wiki/Ascension); Dead Cells 1–5BC и патч 2.3 — [вики](https://deadcells.wiki.gg/wiki/Boss_Stem_Cell); RoR2 Drizzle/Monsoon/E5 — [вики](https://riskofrain2.wiki.gg/wiki/Difficulty).
- **Ровный отсев по актам, а не один обрыв.** Достижения StS, Hades, Dead Cells (раздел 1).

### Выводы аналитика
- «Пила»: в каждом акте StS давление падает после босса (полное лечение) и снова растёт. В Balatro цель после босса падает к ×1 следующего анте, но абсолютная планка растёт. Это пила по устройству, но прямого подтверждения разработчика в найденных источниках нет.
- Шаблон «сложность правил открывается за первые 5–10 походов» подтверждён частично: StS (урезанный первый поход), Balatro (колоды за ставки), Isaac (предметы за победы). Число походов источники не называют.
- Для Ashen Oath из этого следует: кривая по рядам — ступени с лёгким пулом в начале акта, явный видимый пик (элита, босс), лечение как главный рычаг «Испытания I–V», а модификаторы поведения — только на поздних ступенях.

### Пробелы
- Нет публичной цифры «сколько походов до первой победы» ни для одной игры, кроме анекдотов о Dead Cells.
- Нет данных Supergiant и Motion Twin о доле игроков на лестнице сложности.
