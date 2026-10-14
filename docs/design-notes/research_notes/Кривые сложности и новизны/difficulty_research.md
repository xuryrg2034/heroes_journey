# Кривые сложности (темп вызова) в играх, с упором на экшен-рогалайты

Заметки собраны 14.10.2026. Приложение к Ashen Oath — в подразделах «Выводы» и помечено как вывод, а не факт. Где первичный источник не удалось открыть, это сказано прямо.

## 1. Поток и баланс вызова и навыка; «сладкая точка» доли неудач; фрустрация и отток

### Takeaway
Модель потока (Csikszentmihalyi → Chen → GameFlow) говорит: вызов должен совпадать с навыком и расти вместе с ним. Но крупные эксперименты показывают: когда сложность назначена игре, а не выбрана игроком, дольше всего играют на самом лёгком уровне. Умеренная сложность мотивирует, только если игрок выбрал её сам. Неудача полезна, когда игрок считает её своей ошибкой и затем всё же побеждает.

### Cited Findings
- GameFlow (Sweetser & Wyeth, ACM Computers in Entertainment, 2005): 8 элементов — concentration, challenge, player skills, control, clear goals, feedback, immersion, social interaction. В таблице соответствия потоку: «Perceived skills should match challenges and both must exceed a certain threshold». — [Sweetser & Wyeth 2005, PDF](https://ntnu.no/wiki/download/attachments/112986425/GameFlow.pdf?api=v2)
- Критерии элемента Challenge в GameFlow (дословно): «challenges in games must match the players' skill levels»; «games should provide different levels of challenge for different players»; «the level of challenge should increase as the player progresses through the game and increases their skill level»; «games should provide new challenges at an appropriate pace». — [GameFlow PDF](https://ntnu.no/wiki/download/attachments/112986425/GameFlow.pdf?api=v2)
- GameFlow со ссылкой на Johnson & Wiles 2003: вызов выше навыка → тревога, ниже → апатия; «An appropriate pace in games applies pressure but does not frustrate the player»; утомление снижают чередованием активностей и темпа (Desurvire et al. 2004). — [GameFlow PDF](https://ntnu.no/wiki/download/attachments/112986425/GameFlow.pdf?api=v2)
- Jenova Chen, «Flow in Games», магистерская работа USC, 2006: предложил DDA, ориентированную на игрока (игрок сам выбирает сложность действиями внутри игры), чтобы держать игроков разного уровня в их «зоне потока»; основа игры flOw. Полный текст в этой сессии не открыт, сведения из вторичных источников. — [Wikipedia: Flow (video game)](https://en.wikipedia.org/wiki/Flow_(video_game)); [немецкий обзор, магистерская Grenzemann](https://uko.opus.hbz-nrw.de/files/1011/Masterarbeit_Scarlett_Grenzemann.pdf); критика: [videlais.com «The garden and the gate»](https://videlais.com/tag/flow/)
- Lomas et al., «Is Difficulty Overrated? The Effects of Choice, Novelty and Suspense on Intrinsic Motivation in Educational Games», CHI 2017 (Honorable Mention): три эксперимента, более 20 000 игровых сессий. Умеренно трудные уровни мотивировали больше всего, когда игрок выбирал их сам; при слепом назначении сложности самые лёгкие игры мотивировали больше всего. Новизна оптимальна умеренная; напряжение (suspense) в «близких» партиях полезно. Совет авторов: «not too hard, not too boring». — [CMU HCII preview](https://hcii.cmu.edu/news/chi-preview-researchers-hcii-believe-difficulty-can-be-overrated-games); [DOI 10.1145/3025453.3025638](https://api.crossref.org/works/10.1145%2F3025453.3025638)
- Lomas, Patel, Forlizzi, Koedinger, «Optimizing Challenge in an Educational Game Using Large-Scale Design Experiments», CHI 2013: онлайн-эксперименты на математической игре (Battleship Numberline) проверяли гипотезу перевёрнутой U; вызов = вероятность успеха, вовлечённость = добровольное время игры. Итог в этой сессии напрямую не прочитан; работа Roohi et al. 2020 пересказывает линию Lomas так: наибольшая вовлечённость — при наименьшей сложности. — [PDF (403 при загрузке)](https://www.stat.cmu.edu/~brian/463-663/project-part-one/Optimizing%20Challenge.pdf); пересказ: [Roohi et al. 2020, arXiv](https://arxiv.org/pdf/2008.12937)
- Juul, «Fear of Failing? The Many Meanings of Difficulty in Video Games» (2009): прототип Pac-Man+Snake, онлайн-тест на 85 игроках. Выше всех оценили игру те, кто ошибался и затем прошёл; прошедшие без потери жизни оценили ниже (p = 0,06, на грани значимости). Кто винил игру («слишком сложно»), оценил ниже тех, кто винил свою ошибку (p < 0,016). «Players clearly prefer feeling responsible for failing in a game»; «failure adds content». На вопрос «как понять, что игра слишком лёгкая»: нет вызова 36%, не нужно пересматривать стратегию 27%, никогда не проигрываешь 6%. В офлайн-тесте вариант «одна ошибка — минус жизнь» убрали, потому что оценки зависели от результата. — [Juul 2009](https://www.jesperjuul.net/text/fearoffailing/)
- Allart, Levieux, Pierfitte, Guilloux, Natkin, «Difficulty Influence on Motivation over Time in Video Games using Survival Analysis», FDG 2017 (DOI 10.1145/3102071.3102085): данные Ubisoft (Rayman Legends, The Division), сложность во времени связана с удержанием. Результаты поддерживают теорию потока и самоэффективности; в первые часы игры две игры расходятся, авторы объясняют это атрибуцией: в Rayman неудачу приписывают своему навыку, в The Division силу аватара можно быстро поднять. Размер выборки и коэффициенты в этой сессии не проверены. — [CNAM, страница статьи (сейчас 404)](https://cedric.cnam.fr/index2.php/publis/article/ALP17); [список работ Levieux](https://cedric.cnam.fr/lab/author/levieux). Предшественник метода: Allart et al., «Design influence on player retention: A method based on time varying survival analysis», CIG 2016. Продолжение: Rao Fernandes & Levieux, «Difficulty Pacing Impact on Player Motivation», ICEC 2022 — [dblp Levieux](https://dblp.dagstuhl.de/pid/49/3565.html)
- Roohi, Relas, Takatalo, Heiskanen, Hämäläinen et al., «Predicting Game Difficulty and Churn Without Players», CHI PLAY 2020 (Angry Birds Dream Blast): модель популяции игроков (навык, упорство, скука) поверх агентов DRL значимо улучшает прогноз оттока по уровням. Менее упорные и менее умелые игроки сильнее реагируют на высокую сложность и уходят рано. — [arXiv 2008.12937](https://arxiv.org/abs/2008.12937)
- Мнения без данных (фольклор): «сложность ради сложности даёт самый высокий отток»; «игрок не должен чувствовать, что застрял» — Josh Bycer, блог на Game Developer, 10.08.2021. — [Game Developer](https://www.gamedeveloper.com/design/how-difficulty-impacts-motivation-in-game-design)

### Inferences
- «Сладкая точка» без выбора игрока, по данным Lomas, смещена в лёгкую сторону. Значит, обязательный путь новичка (пролог и первые ряды похода) лучше делать проще, чем «умеренно», а умеренную и высокую сложность отдавать выбору: рискованная фаза после целей арены, «Испытание I–V».
- По Juul и Allart, важно, чему игрок приписывает поражение. Для Ashen Oath: смерть от урона, который игрок не видел или не мог прочитать (одновременные угрозы, плохо видимое касание, броня элит без подсказки), будет приписана игре. Это худший вид неудачи для удержания. Смерть от собственной плохой цепи — приемлемый вид.
- Roohi: самые уязвимые к скачку сложности — неумелые и неупорные игроки, именно новички. «Обрыв» после пролога бьёт по самой чувствительной группе.

### Gaps
- Числовая оптимальная доля успеха из Lomas 2013 (кривая вовлечённости по вероятности успеха) не прочитана: PDF закрыт (403).
- Полный текст Chen 2006 и числовые результаты Allart 2017 (размер выборки, коэффициенты риска) не открыты.
- Не нашёл первичных данных о целевой доле поражений именно для экшен-рогалайтов (например, «X% смертей на ряд»).

## 2. Формы темпа: пила, подъём и разрядка, пики и провалы (AI Director), ритм боссов и чекпоинтов, пики сложности

### Takeaway
Первичный источник по пикам и провалам — слайды Майка Бута о Left 4 Dead (GDC 2009). Режиссёр меняет темп, а не амплитуду: «Amplitude (difficulty) is not changed, frequency (pacing) is». Исследование головоломок (Linehan et al. 2014) даёт вторую опору: вводить навыки по одному, сначала простой пример, затем совмещение со старыми навыками, затем рост сложности до следующего навыка. Форма «пилы» в литературе распространена, но первичного эмпирического источника для неё я не нашёл.

### Cited Findings
- Booth, «The AI Systems of Left 4 Dead» (Valve, 2009): цель — «dramatic game pacing», вдохновлено Counter-Strike: «Constant, unchanging combat is fatiguing», «Long periods of inactivity are boring», «Unpredictable peaks and valleys of intensity create a powerfully compelling and replayable experience». — [слайды Valve, PDF](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf) (текст извлечён из PDF 14.10.2026)
- Там же, оценка «Survivor Intensity»: растёт при уроне (пропорционально урону), при выводе из строя, при сбрасывании с уступа, при гибели заражённых рядом (обратно пропорционально расстоянию); затухает к нулю со временем, но не затухает, пока заражённые активно атакуют. Берётся максимум по 4 игрокам. — [Booth 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Там же, фазы: Build Up — полная популяция угроз, пока интенсивность не пересечёт пик; Sustain Peak — полная популяция ещё 3–5 с после пика; Peak Fade — минимальная популяция, пока интенсивность не выйдет из пикового диапазона, причём отдых начинается только при естественной паузе в бою; Relax — минимальная популяция 30–45 с (или пока игроки не продвинутся достаточно), затем снова Build Up. Волны орды — со случайным интервалом 90–180 с. — [Booth 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Там же, боссы: события Tank, Witch и «ничего» тасуются и раздаются через каждые N единиц пути ± случайно; одинаковые подряд запрещены (Tank, затем снова Tank). Оценка интенсивности «crude, yet the resulting pacing works». — [Booth 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Ben Serviss (Game Developer, 07.02.2013): Режиссёр — это «procedural narrative» (Гейб Ньюэлл), а не мелкая подстройка чисел, как в Max Payne; ценность — «выталкивание из зоны комфорта», при условии, что у игрока остаются жизнеспособные варианты. Мнение. — [Game Developer](https://www.gamedeveloper.com/design/the-discomfort-zone-the-hidden-potential-of-valve-s-ai-director)
- Linehan, Bellord, Kirman, Morford, Roche, «Learning curves: analysing pace and challenge in four successful puzzle games», CHI PLAY 2014 (Portal, Portal 2 coop, Braid, Lemmings): каждая игра вводит ключевые навыки по одному; каждый навык начинается с простых задач; затем даёт практику нового навыка вместе со старыми; сложность растёт до прихода следующего навыка. Метаданные репозитория UCC расходятся в том, рецензирована ли работа. — [UCC CORA](https://cora.ucc.ie/handle/10468/3461); [research.ucc.ie](https://research.ucc.ie/en/publications/learning-curves-analysing-pace-and-challenge-in-four-successful-p/)
- GameFlow: «games should provide new challenges at an appropriate pace»; утомление снижать чередованием активности и темпа. — [Sweetser & Wyeth 2005](https://ntnu.no/wiki/download/attachments/112986425/GameFlow.pdf?api=v2)
- Фразы «Relax–Build Up–Peak–Relax» и «emotional intensity curves» в популярных пересказах часто даются без ссылок; поисковый агрегатор отметил это как непроверенное. Первичные названия фаз — в слайдах Booth выше. Утверждения вроде «30+ переменных Режиссёра» в фанатских гайдах не подтверждены. — [поиск, modl.ai и гайды, см. выдачу](https://modl.ai/?p=1984)

### Inferences
- Для Ashen Oath (ряды похода): «ряд, где сразу приходит несколько новых давлений» — прямое нарушение схемы Linehan. Правило-кандидат: на ряд не более одного нового давления (новый вид, аффикс, броня, касание 2); прежние давления можно совмещать. Это проверяемое правило для генератора составов.
- Модель Booth переносится на поход как макропетля: бой (Build Up/Peak) → отдых/торговец/событие (Relax). Важно не менять амплитуду в ответ на игрока (см. раздел 3), а менять плотность и порядок. Детерминированный аналог: «тасовать без повторов» — как Tank/Witch/Nothing: элиты и тяжёлые арены раздаются из колоды без двух тяжёлых подряд.
- Внутри арены аналог Sustain Peak + Peak Fade: после пика (выполнены цели) — короткая пауза до двери; рискованная фаза — добровольный второй пик. Это совпадает с уже существующей структурой «цели → дверь → необязательная фаза».
- Обнаружение пиков: по телеметрии считать для каждого ряда долю смертей и падение HP относительно соседних рядов; ряд, где показатель выше обоих соседей и выше линейного тренда, — пик. Это вывод, а не метод из источника.

### Gaps
- Первичного эмпирического исследования, что «пила» лучше монотонного роста, не нашёл; форма «пила» — практика дизайнеров (фольклор), не измеренный факт.
- Не нашёл опубликованных метрик Supergiant, Motion Twin или Mega Crit о доле смертей по биомам/актам.
- Запись доклада Booth в GDC Vault не открывалась; использованы только слайды.

## 3. Динамическая подстройка сложности (DDA): скрытая и видимая, доверие игрока, когда она вредна для рогалайта

### Takeaway
DDA исследована давно (Hunicke 2004–2005), есть данные, что она улучшает опыт, в том числе через завышенную уверенность игрока (Constant & Levieux 2019). Коммерческие примеры (RE4) — скрытые, и их детали известны в основном из фанатского реверс-инжиниринга. Рогалайты с лестницами (Hades, StS) выбирают видимые и добровольные механизмы: God Mode, Heat. Скрытая DDA противоречит сравнимости забегов и честности поражения.

### Cited Findings
- Hunicke & Chapman, «AI for Dynamic Difficulty Adjustment in Games», AAAI-04 Challenges in Game AI Workshop: система Hamlet на движке Half-Life; методы теории запасов (Inventory Theory) и исследования операций; анализирует и меняет «спрос и предложение» инвентаря (здоровье, боеприпасы), чтобы управлять сложностью. — [Hamlet.pdf](https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf); [список работ Hunicke](https://users.cs.northwestern.edu/~hunicke/vitae.html)
- Hunicke, «The Case for Dynamic Difficulty Adjustment in Games», ACM SIGCHI ACE 2005. Содержание в этой сессии не открыто. — [вита Hunicke](https://users.cs.northwestern.edu/~hunicke/vitae.html)
- Constant & Levieux, «Dynamic Difficulty Adjustment Impact on Players' Confidence», CHI 2019 (DOI 10.1145/3290605.3300693): уверенность измеряли ставками игрока на свой успех; три игры (логическая, моторная, сенсорная сложность); случайная сложность против DDA. DDA может вызывать высокую самоуверенность (overconfidence); авторы предполагают, что это частично объясняет, почему DDA улучшает опыт. — [CNAM, CL19](https://cedric.cnam.fr/index2.php/publis/article/CL19)
- Resident Evil 4 (2005): скрытый «ранг» 1–10 (внутреннее значение 1000–10999, по умолчанию 5500) меняет получаемый и наносимый урон, шанс крита в голову, хитбоксы; некоторые враги появляются только при высоком ранге; после повторных смертей у одного чекпоинта игра смягчается. Источники — пресса и фанатский разбор, не Capcom; источники расходятся в деталях. — [Engadget 2015](https://www.engadget.com/2015-06-03-resident-evil-4-difficulty.html); [speedrun.com guide](https://www.speedrun.com/re4console/guide/3sahj); [TASVideos](https://tasvideos.org/Forum/Posts/531852)
- Left 4 Dead — пример DDA, которая меняет темп, но не силу врагов: «Algorithm adjusts pacing, not difficulty». — [Booth 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Hades God Mode (Supergiant): открытый, добровольный, включается в любой момент; сопротивление урону 20%, +2% за каждую смерть, потолок 80%; не неуязвимость. Касавин: смерть в Hades двигает сюжет, поэтому обычный «лёгкий режим» не подходил; цель — смягчить боль неудачи; «the way to approach difficulty settings may need to be proprietary to the game. It's not a one size fits all solution». — [Inverse, интервью](https://www.inverse.com/gaming/hades-god-mode-interview); [Can I Play That, 11.08.2021](https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games)
- Видео GameSpot «How Dead Cells Secretly Stops You From Dying» указывает на скрытые послабления в Dead Cells; содержание в этой сессии не проверено. — [GameSpot](https://Gamespot.com/videos/how-dead-cells-secretly-stops-you-from-dying/2300-6449363/)
- Crash Bandicoot: упомянутый в задаче пример скрытой DDA в этой сессии не проверен (источников не открывал).

### Inferences
- Для Ashen Oath скрытая DDA по результатам игрока плохо сочетается с проектом: (а) лестница «Испытание I–V» теряет смысл, если игра тайно подстраивается; (б) детерминизм по seed и журналу допускает DDA только как функцию журнала, но тогда два игрока с одним seed получают разные бои, и сравнение «тот же seed» ломается; (в) по Juul игрок ценит ответственность за поражение, а скрытая помощь её размывает.
- Модель Hades God Mode совместима с проектом: видимая, добровольная, растёт от числа смертей (мета-счётчик), не даёт постоянной силы в обычном режиме. Её можно оформить как режим похода с параметром `Params`. Это вывод; решение — за пользователем и дизайном.
- Безопасная форма «DDA» для рогалайта — подстройка темпа без амплитуды (Booth): например, гарантированный отдых после двух тяжёлых боёв, если HP низкий. Если такое правило зависит от состояния забега, оно детерминировано и видно на карте; это не скрытая подкрутка урона.
- Constant & Levieux: DDA повышает уверенность. Для новичка после пролога может быть полезна не скрытая DDA, а явно лёгкий первый ряд похода — тот же эффект уверенности без потери честности.

### Gaps
- Нет опубликованных данных по доле игроков, включающих God Mode.
- Механика скрытой помощи в Crash Bandicoot и Dead Cells не проверена по первоисточникам.
- Не нашёл исследований о реакции игроков на раскрытие скрытой DDA (доверие), кроме общего мнения прессы.

## 4. Сложность по выбору игрока: лестницы Ascension/Heat, Boss Cells, Assist Mode; кто ими пользуется

### Takeaway
Успешные рогалайты дают добровольную надбавку сложности после первой победы (Heat, Ascension, Boss Cells) и иногда добровольное облегчение (God Mode, Assist Mode в Celeste). По Lomas, самовыбор сложности меняет и её оптимальный уровень: выбранная умеренная сложность мотивирует, назначенная — нет. Доля побед даже у массовой аудитории StS невелика.

### Cited Findings
- Hades, Pact of Punishment: открывается после первого побега; модификаторы добавляют «Heat» (лёгкие +1, тяжёлые +2); 15 модификаторов (в Bastion и Transistor было по 10, у Transistor — Limiters); Heat учитывается по каждому оружию отдельно; выше Heat — лучше награды (Titan Blood, Diamonds, Ambrosia). Обоснование разработчиков в найденных источниках нет. — [Kotaku](https://kotaku.com/everything-you-need-to-know-about-hades-endgame-1845239105); [Fextralife](https://hades.wiki.fextralife.com/New+Game+Plus)
- Hades God Mode — см. раздел 3. — [Inverse](https://www.inverse.com/gaming/hades-god-mode-interview)
- Celeste Assist Mode: игрок меняет скорость игры, выносливость, число рывков, даже возможность умереть; игра советует первое прохождение без него; Торсон: клубника, b-сайды и Assist Mode помогают игроку найти свой уровень вызова. Данных о доле пользователей не нашёл. — [Vice](https://www.vice.com/en/article/d3w887/celeste-difficulty-assist-mode); [Wikipedia: Celeste](https://en.wikipedia.org/wiki/Celeste_(video_game))
- Slay the Spire 2 (бета), отчёт Mega Crit «Neow Dispatch», май 2026 — в пересказе вторичных сайтов: 240 млн завершённых забегов, общая доля побед 25%; по персонажам Ironclad 24%, Silent 22%, Defect 19%, The Heir 18%, Necrobinder 17%. Один блог приводит: Ascension 0 — 16% (в первой StS — 9%), Ascension 10 — ~17%, A20 в первой StS — 3%. Оригинальный пост Mega Crit не открыт; цифры по Ascension — из одного источника, сверить. — [GameGeeker](https://gamegeeker.com/fr/news/slay-the-spire-2-may-neows-news-update?market=FR); [twoaveragegamers](https://www.twoaveragegamers.com/slay-the-spire-2-beginner-guide/)
- Dead Cells (Motion Twin), Sébastien Bénard, 2018: сложность ради сложности бессмысленна, вызов должен быть «трудным, но не непреодолимым»; вызов — в освоении имеющихся способностей, а не в получении новых. Конкретики по Boss Cells в найденных интервью нет. — [CNC](https://www.cnc.fr/jeu-video/actualites/sebastien-benard-dead-cells---la-plus-grosse-difficulte-etait-de-ne-pas-lasser-le-joueur_905050); [MCV «When We Made… Dead Cells»](https://mcvuk.com/development-news/when-we-made-dead-cells/)
- Lomas et al. 2017: умеренная сложность мотивирует при самовыборе, лёгкая — при назначении. — [CMU HCII](https://hcii.cmu.edu/news/chi-preview-researchers-hcii-believe-difficulty-can-be-overrated-games)
- Juul 2009: одиночные игроки сами редко ищут дополнительный вызов. — [Juul 2009](https://www.jesperjuul.net/text/fearoffailing/)

### Inferences
- Если цифры StS верны, даже в зрелом жанре на базовом уровне побеждают лишь 9–16% забегов (усреднение по всем игрокам и забегам, включая брошенные). Для Ashen Oath это ориентир для средней доли побед по всем забегам, но не для первого забега новичка. Цель для первых забегов надо брать из плейтеста и телеметрии.
- «Испытание I–V» уже соответствует схеме Heat/Ascension. Пробел проекта — нижняя ступень: нет добровольного облегчения в духе God Mode/Assist. По Lomas, это ступень для тех, кто не выбирает сложность сам.
- Боль «опытный игрок побеждает с минимумом 3 HP» говорит, что базовый поход уже около верхней границы для опытного игрока. По Lomas и Roohi, база для новичков должна быть ниже, а верх — в «Испытании» и рискованных фазах.

### Gaps
- Не нашёл первичных данных о доле игроков, использующих Assist Mode, God Mode, Boss Cells, или о распределении игроков по ступеням Heat/Ascension.
- Обоснование Supergiant для Heat в найденных источниках нет.
- Достоверных «целевых долей побед первого забега» от разработчиков не нашёл.

## 5. Смерть и неудача в рогалайтах: сколько неудачи мотивирует; «fail forward»; длина забега и сложность

### Takeaway
Лучше всего оценивают опыт «ошибся, понял, победил» (Juul). Неудача, приписанная себе, сохраняет мотивацию; приписанная игре — снижает. Рогалайты смягчают неудачу продвижением сюжета или открытий (Hades: смерть двигает историю). Прямых исследований оптимальной длины забега я не нашёл.

### Cited Findings
- Juul 2009: «failure adds content» — неудача заставляет пересмотреть стратегию и создаёт ощущение глубины; выше всех оценили игру прошедшие после ошибок; самоатрибуция ошибки — выше оценки. — [Juul 2009](https://www.jesperjuul.net/text/fearoffailing/)
- Allart et al. 2017: в первые часы удержание по-разному зависит от сложности в игре, где неудача приписывается навыку (Rayman Legends), и в игре, где её компенсирует рост силы аватара (The Division). — [CNAM](https://cedric.cnam.fr/index2.php/publis/article/ALP17)
- Hades: «Dying is how you advance much of the story» — поэтому обычный лёгкий режим не подходил; God Mode дает «make a few more mistakes» и изучать встречи. — [Inverse](https://www.inverse.com/gaming/hades-god-mode-interview)
- Bénard (Dead Cells): вызов из освоения имеющегося, а не из новых способностей. — [CNC](https://www.cnc.fr/jeu-video/actualites/sebastien-benard-dead-cells---la-plus-grosse-difficulte-etait-de-ne-pas-lasser-le-joueur_905050)
- GMTK «Roguelikes, Persistency and Progression»: рогалайты без постоянных улучшений вознаграждают почти исключительно навык игрока. — [субтитры видео](https://amara.org/subtitles/7doGHxwrhRpX/en/1/download/Roguelikes%20Persistency%20and%20Progression%20%20Game%20Makers%20Toolkit.en.srt)
- Анекдотические постмортемы (Wayline, 2025): у одного рогалайта в раннем доступе аналитика показала резкое падение игрового времени около 5–7 часов; игроки «проходили несколько забегов и уходили». Это не исследование. — [Wayline](https://www.wayline.io/blog/roguelike-early-access-retention-postmortem)

### Inferences
- У Ashen Oath нет постоянной силы, значит, как в Rayman (Allart), неудача будет приписываться навыку. Это хорошо для честности, но поднимает ставку на читаемость: каждая смерть должна быть понятна, иначе игрок перенесёт вину на игру. Предложение: экран смерти с причиной (кто нанёс последний урон, сколько угроз было одновременно). Это вывод; HUD меняется только по решению дизайна.
- «Fail forward» без силы: мета дает разнообразие. Её можно связывать со смертью (открытие нового талисмана/события после N смертей), как Hades связывает сюжет со смертью.
- Длина забега 7–10 боёв: проигрыш на 8-м бою дороже проигрыша на 2-м. По Juul, ранняя неудача дешевле и учит; поздняя должна быть редкой и понятной. Значит, обрыв в начале похода, сразу после пролога, хуже, чем обрыв на боссе.

### Gaps
- Нет найденных исследований оптимальной длины забега в связи со сложностью.
- Нет данных по доле смертей на биом в Hades, Dead Cells, Enter the Gungeon от разработчиков.

## 6. Разложение сложности: урон, исполнение, нагрузка решений, информация; бюджет времени реакции; сколько угроз можно отслеживать

### Takeaway
Классическая оценка внимания — около 4 одновременно отслеживаемых движущихся объектов (Pylyshyn & Storm 1988). Это не жёсткий предел: он растёт при медленном движении и большом расстоянии между объектами и падает при быстром движении и тесноте. Первичных источников с числами длительности замаха врагов в играх я не нашёл; есть только практические рекомендации и студенческие пересказы данных о времени реакции.

### Cited Findings
- Multiple object tracking: Pylyshyn & Storm (1988) — около четырёх объектов (FINST); «магическое число 4» в ряде ранних работ (Intriligator & Cavanagh 2001; Yantis 1992). Alvarez & Franconeri 2007: при изменении условий — до 8–9 объектов; ёмкость падает с ростом скорости и при сближении объектов. Спор: фиксированное число «указателей» против гибкого ресурса. — [Wikipedia: Multiple object tracking](https://en.wikipedia.org/wiki/Multiple_object_tracking); [Alvarez & Franconeri 2007, PDF](https://visualcognition.psych.northwestern.edu/publications/AlvarezTracking2007.pdf); [Franconeri et al. 2010, PDF](https://visualcognition.psych.northwestern.edu/publications/FranconeriPsychSci2010.pdf)
- GameFlow: «games should have a high workload, while still being appropriate for the players' perceptual, cognitive, and memory limits»; «players should not be distracted from tasks that they want or need to concentrate on». — [Sweetser & Wyeth 2005](https://ntnu.no/wiki/download/attachments/112986425/GameFlow.pdf?api=v2)
- Constant & Levieux 2019 разделяют логическую, моторную и сенсорную сложность как разные типы задач. — [CNAM CL19](https://cedric.cnam.fr/index2.php/publis/article/CL19)
- Время реакции: студенческая презентация (Staffordshire, 2025) со ссылкой на обзор Kosinski: зрительная простая реакция 180–200 мс, слуховая 140–160 мс. Слабый источник, первоисточник не проверен; реакция с выбором и действием длиннее простой. — [презентация](https://gradex.staffs.ac.uk/wp-content/uploads/2025/05/5480_Artificact-Development-Presentation-Joey.pdf)
- Телеграфы: в блоге на Game Developer — окно реакции делает телеграф честным, иначе попадание вызывает фрустрацию; гайд 2026 — каждый тип сигнала должен соответствовать постоянному окну реакции, иначе «difficulty feels random even when the system is deterministic» (пример несогласованных замахов 700 мс и 250 мс). Это практические мнения, не исследования. — [Game Developer: Enemy attacks and telegraphing](https://gamedeveloper.com/design/enemy-attacks-and-telegraphing); [gamineai, 2026](https://gamineai.com/blog/enemy-telegraph-shape-language-top-down-boss-fights-fast-visual-consistency-audit-2026)
- Linehan et al. 2014: вводить навыки по одному; это разделение нагрузки на обучение. — [UCC CORA](https://cora.ucc.ie/handle/10468/3461)

### Inferences
- Для Ashen Oath полезно разложить каждую арену по осям: (1) входящий урон (касание, касание 2, снаряды); (2) исполнение (точность протягивания цепи, тайминг прохода); (3) решения (выбор цвета, порядок целей, когда входить в рискованную фазу); (4) информация (сколько активных угроз нужно держать в поле внимания, видны ли телеграфы). Сложность ряда = сумма по осям; новое давление повышает одну ось за раз.
- Предел внимания: держать число одновременно активных угроз, требующих слежения (атакующие, снаряды, элиты с поведением), около 4 в первых рядах. Больше — только для медленных, хорошо разнесённых угроз. Это вывод из MOT, не игровое исследование.
- Ведение цепи занимает внимание и руку игрока: во время протягивания он хуже отслеживает угрозы. Телеграфы атак, которые бьют во время цепи, должны иметь запас по времени больше простой реакции (~0,2 с) плюс время на прерывание действия. Конкретное число (например, 0,5–0,7 с) — гипотеза для плейтеста, а не данные.
- Согласованность: одинаковый вид сигнала — одинаковое окно реакции на всех врагах. В детерминированной симуляции это можно проверять тестом над таблицей врагов.

### Gaps
- Не нашёл первичных (академических или от разработчиков) чисел длительности замаха для экшен-игр.
- Не нашёл исследований о числе одновременно отслеживаемых угроз именно в играх (только лабораторный MOT).
- Не нашёл работ, которые измеряют вклад осей «урон / исполнение / решения / информация» в воспринимаемую сложность.

## 7. Конкретные числа: доли побед первых забегов, смерти по уровням, длительности телеграфов

### Takeaway
Твёрдых опубликованных целевых чисел почти нет. Надёжны числа темпа Left 4 Dead (пик 3–5 с, отдых 30–45 с, орда каждые 90–180 с) и механики God Mode (20% + 2% за смерть, до 80%). Доли побед StS доступны только во вторичном пересказе.

### Cited Findings
- Left 4 Dead: Sustain Peak 3–5 с; Relax 30–45 с; случайный интервал волн 90–180 с; боссы тасуются без повторов. — [Booth 2009](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf)
- Hades God Mode: 20% сопротивления, +2% за смерть, потолок 80%. — [Inverse](https://www.inverse.com/gaming/hades-god-mode-interview)
- Hades Heat: 15 модификаторов, +1/+2 Heat. — [Kotaku](https://kotaku.com/everything-you-need-to-know-about-hades-endgame-1845239105)
- StS 2 (бета, май 2026, вторично): общая доля побед 25%; A0 16% против 9% в StS 1; A20 StS 1 — 3%. — [GameGeeker](https://gamegeeker.com/fr/news/slay-the-spire-2-may-neows-news-update?market=FR)
- Juul 2009: 85 игроков; 36% называют признаком «слишком лёгкой» игры отсутствие вызова, 6% — то, что никогда не проигрываешь. — [Juul 2009](https://www.jesperjuul.net/text/fearoffailing/)
- Lomas et al. 2017: более 20 000 сессий; назначенная лёгкая сложность — максимум мотивации. — [CMU HCII](https://hcii.cmu.edu/news/chi-preview-researchers-hcii-believe-difficulty-can-be-overrated-games)
- Простая зрительная реакция 180–200 мс (слабый источник). — [презентация](https://gradex.staffs.ac.uk/wp-content/uploads/2025/05/5480_Artificact-Development-Presentation-Joey.pdf)

### Inferences
- Для Ashen Oath пороги стоит задавать по собственной телеметрии: (а) доля смертей на ряд и HP на выходе из ряда для первого, второго и пятого похода игрока; (б) пик = ряд, где доля смертей заметно выше соседних. Пролог → первый ряд похода: падение доли успеха между ними — прямая мера «обрыва».
- «Опытный игрок побеждает с минимумом 3 HP» — это один игрок, а не распределение; по правилам проекта такая метрика эвристична. Нужны распределения по нескольким людям.

### Gaps
- Нет найденных первичных целевых долей побед первого забега от студий.
- Нет найденных опубликованных долей смертей по уровням или биомам для экшен-рогалайтов (Hades, Dead Cells, Gungeon, Risk of Rain).
- Нет первичных чисел длительности телеграфов; оригинальный пост Mega Crit не открыт; итоговые числа Lomas 2013 не прочитаны.
