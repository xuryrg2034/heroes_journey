# Исследование: дизайн, метрики и проверка боёв

Срез от 29 сентября 2026 года. Здесь собраны выводы из первоисточников, на которых построены [руководство по дизайну боёв](level-design-guide.md), [метрики анализатора](level-metrics.md) и [протокол плейтеста](playtest-protocol.md).

Пометки:
- **[И]** — прямо сказано в источнике;
- **[Т]** — наша интерпретация для Ashen Oath.

Источники из [design-references.md](design-references.md) (ITB 2019, Slay the Spire 2019, Ubisoft 2023) здесь не повторяются.

## 1. Дизайн боёв и обучение

| Источник | Выводы |
| --- | --- |
| A. Garst, [Designing Grindstone's… board-clearing gameplay](https://www.gamedeveloper.com/design/designing-i-grindstone-i-s-super-satisfying-board-clearing-gameplay), 2019 | [И] Сначала все враги атаковали в 8 направлениях, это было «so difficult». Диагонали оставили только особым врагам. [И] Число цветов и доли существ урезали под уровень. [И] Награду за любое действие заменили наградой за длинную цепь. |
| [TheXboxHub: Dan Vader](https://www.thexboxhub.com/exclusive_interview_capybara_games_grindstone/), 2023; [Console Creatures](https://www.consolecreatures.com/canadian-developer-series-interview-with-dan-vader-of-capy-games/), 2019 | [И] После цели уровень не заканчивается сам: игрок идёт к двери. Жадность стала ключевой «краской» игры. |
| Subset Games, [ITB Design Postmortem](https://media.gdcvault.com/gdc2019/presentations/Into%20the%20Breach%20Postmortem%20Final.pdf), стр. 9, 21, 22, 35, 47 | [И] Hoplite среди ориентиров. [И] «Killing enemies isn't as fun as manipulating them». [И] Лимит ходов делает бои короткими и интересными. [И] Враг одного вида ведёт себя одинаково. [И] «Too hard threshold is a cliff». |
| A. Wiltshire, [Reimagining failure… Into the Breach](https://www.gamedeveloper.com/design/reimagining-failure-in-strategy-game-design-in-i-into-the-breach-i-), 2018 | [И] 100 карт сделаны вручную. Главный враг — позиция без вариантов. [И] Здания не ставят парами по диагонали и буквой Г, иначе враг в «кармане» недосягаем. |
| [Crafting Candy Crush's difficulty](https://www.pocketgamer.biz/crafting-candy-crushs-difficulty-blockers-level-design-ai-and-the-complexity-staircase/), 2026 | [И] «Лестница сложности» для блокеров. [И] Сложность — в выборе, что делать первым. [И] Сложные уровни чередуются с лёгкими. |
| [How King defines a "good" level](https://mobilegamer.biz/how-king-defines-a-good-candy-crush-saga-level-and-why-it-constantly-prunes-the-bad-ones/), 2024 | [И] Чем длиннее уровень, тем реже он приятен. [И] «Crazy hard levels never pay off». Худшие уровни регулярно переделывают. |
| [Playrix: levels and elements](https://gameworldobserver.com/2019/09/27/playrix-levels-elements-match-3), 2019 | [И] На уровне 3–4 элемента. [И] Ведётся таблица совместимости элементов. [И] У каждого уровня своя идея. [И] Несколько сложных уровней подряд деморализуют. |
| Room 8, [Tile Puzzle Level Design](https://room8studio.com/news/smart-casual-the-state-of-tile-puzzle-games-level-design-part-1/), 2019 | [И] Типы уровней по эмоции: урок, «вау», раздражение, отдых, навык. [И] Число попыток — лучший индикатор сложности. |
| M. Brough, [imbroglio notes 3](http://mightyvision.blogspot.com/2016/06/imbroglio-notes-3-monsters.html); [Freedom through constraints](https://www.gamedeveloper.com/design/freedom-through-constraints-the-design-of-michael-brough-s-i-imbroglio-i-), 2016 | [И] Поле 5×5 оказалось слишком большим, выбрали 4×4. [И] Правило против скоплений одинаковых появлений. [И] Наказание допустимо, неизбежный урон — нет. |
| Hoplite: [страница автора](http://www.magmafortress.com/p/hoplite.html); [разбор](https://the-art-of-x.writeas.com/game-breakdown-hoplite), 2021 | [И] Зоны угроз врагов дополняют друг друга, между ними остаются безопасные «карманы». |
| [The Level Design Book — Enemy design](https://book.leveldesignbook.com/process/combat/enemy) | [И] Роли: рядовой, отряд, лидер, танк, рой, снайпер. [И] «Ranged enemies make level design matter». |
| [The secret to Mario level design](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design) (Hayashida), 2012 | [И] Четыре шага: научить, усложнить, повернуть, проверить мастерство. Одна идея на уровень. |
| [Inside Jonathan Blow's Puzzle Design Process](https://www.gamedeveloper.com/design/indiecade-inside-jonathan-blow-s-puzzle-design-process), 2011 | [И] Механику проверять со всеми объектами. [И] Головоломки находят исследованием, а не выдумывают сверху. |
| [Arvi Teikari on puzzle design](https://www.indiegamewebsite.com/2019/07/19/baba-is-you-developer-arvi-teikari-talks-indie-innovation-influences-and-puzzle-design/), 2019 | [И] Уровень строят назад от интересного взаимодействия. Ложных следов ради сложности нет. |
| [Q&A: A Good Snowman](https://www.gamedeveloper.com/design/q-a-a-good-snowman-is-hard-to-build), 2014; [Stephen's Sausage Roll](https://www.gamedeveloper.com/business/simple-but-incredibly-filling-devs-weigh-in-on-i-stephen-s-sausage-roll-i-), 2016 | [И] Быстрое прототипирование, чтобы проверить, дают ли механики интересные задачи. [И] Возможности расширяются без новых механик. |
| D. Cook, [The Chemistry of Game Design](https://lostgarden.com/2007/07/19/the-chemistry-of-game-design/), 2007 | [И] Атомы навыка образуют цепочки зависимостей. Если игрок не освоил базовый атом, зависящие от него не работают. |
| Linehan и др., [Learning Curves… Four Puzzle Games](https://pure.york.ac.uk/portal/en/publications/learning-curves-analysing-pace-and-challenge-in-four-successful-p/), CHI PLAY 2014 (аннотация) | [И] Portal, Braid, Lemmings: навыки вводятся по одному. Сначала простое применение, потом практика и сочетания, затем рост сложности до следующего навыка. |
| S. Bénard, [Level Design of Dead Cells](https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/), 2020 | [И] Каркас авторский, комнаты — шаблоны. Генератор обязан соблюдать граф-схему. |
| [Puzzle Trimming](https://www.desktopdungeons.net/puzzle-trimming/), Desktop Dungeons, 2012 | [И] Правка головоломки — убрать избыточные варианты. Автор плохо оценивает сложность своей задачи. |
| [ITB: UI clarity](https://www.gamedeveloper.com/design/-i-into-the-breach-i-dev-on-ui-design-sacrifice-cool-ideas-for-the-sake-of-clarity-every-time-), 2018 | [И] Механики, которые не удавалось понятно показать, вырезали. Анимация эффективнее текста. |

## 2. Метрики сложности по солверу

| Источник | Выводы |
| --- | --- |
| Chen, White, Sturtevant, [Entropy as a Measure of Puzzle Difficulty](https://webdocs.cs.ualberta.ca/~nathanst/papers/chen2023entropy.pdf), AIIDE 2023 | [И] Сложность — информация (в битах), которую оракул должен сообщить игроку. На 104 головоломках Witness корреляция с рейтингом сложности: ReMUSE r=0,57, длина решения 0,47, число решений 0,32. [Т] Число решений — слабая метрика, важнее «цена выбора» на ключевых ходах. |
| Shen, Sturtevant, [Generalized Entropy and Solution Information](https://ojs.aaai.org/index.php/AIIDE/article/view/31872), AIIDE 2024 | [И] TSI = −log₂ P(победа модельного игрока). Большая разница TSI с правилом и без него выявляет задачи, которые учат правилу. [Т] Это обоснование урезанных агентов. |
| Sturtevant, [Large-Scale BFS… Fling!](https://cs.du.edu/~sturtevant/papers/BFS-design.pdf), 2013 | [И] Солвер показывает ходы, ведущие к цели, и клетки, изменение которых меняет разрешимость. Несколько решений допустимы в ранних уровнях, одно — в поздних. |
| Sturtevant и др., [Anhinga (Snakebird)](https://ojs.aaai.org/index.php/AIIDE/article/view/7451), AIIDE 2020 | [И] Редактор предлагает правку одной клетки, сильнее всего меняющую длину решения. |
| Anderson, Togelius и др., [Deceptive Games](https://arxiv.org/abs/1802.00048), 2018 | [И] Типы ловушек для агентов: жадная, гладкости, общности. [Т] Обманчивость — разрыв между жадным агентом и поиском. |
| Pelánek, [Difficulty Rating of Sudoku](https://arxiv.org/abs/1403.7373), 2014 | [И] Сложность складывается из сложности шагов и зависимостей между ними. |
| Isaksen, Wallace, Finkelstein, Nealen, [Simulating Strategy and Dexterity](http://www.nealen.net/papers/isaksen-cig17.pdf), CIG 2017 | [И] Ошибку игрока моделируют шумом в оценке ходов. [И] Равнозначные ходы объединяют. [И] Агент с прямой моделью подглядывает будущие результаты ГПСЧ. [Т] Для нас это критично из-за случайного пополнения: оракул с настоящим seed нельзя выдавать за игрока. |

## 3. Агенты и предсказание сложности

| Источник | Выводы |
| --- | --- |
| Poromaa, [Crushing Candy Crush](https://kth.diva-portal.org/smash/get/diva2:1093469/FULLTEXT01.pdf), KTH/King 2017 | [И] MCTS-бот предсказал успех людей со средней ошибкой −1,3 % (SD 10 %). Внутренние плейтестеры ошиблись на +6,6 % (SD 16,6 %). [И] Корректная ошибка: z = (p̂ − p)/√(p(1−p)). [И] Непрерывный сигнал из playout лучше бинарного. |
| Gudmundsson и др., [Human-Like Playtesting with Deep Learning](https://gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf), 2018 | [И] Успех бота переводят в успех людей регрессией на выпущенных уровнях. [И] На стратегических уровнях бот недооценивает людей. |
| Roohi и др., [Predicting Difficulty and Churn Without Players](https://arxiv.org/abs/2008.12937), 2020; [Engagement and Difficulty Using AI Players](https://arxiv.org/abs/2107.12061), 2021 | [И] Поздние уровни проходят отобранные, более настойчивые игроки. [И] Лучшие прогоны агента коррелируют с людьми сильнее среднего. |
| Kristensen, Burelli, [Difficulty Modelling in Mobile Puzzle Games](https://arxiv.org/abs/2401.17436), 2024; Kristensen и др., [Statistical Modelling of Level Difficulty](https://arxiv.org/abs/2107.03305), 2021 | [И] Сложность — среднее число попыток до прохождения. [И] Для нового контента признаки агента критичны, динамические важнее статических. [И] Сильного агента нужно калибровать. |
| Holmgård и др., [Procedural Personas](https://arxiv.org/abs/1802.06881), 2019; Mugrai и др., [Automated Playtesting of Matching Tile Games](https://arxiv.org/abs/1907.06570), 2019 | [И] Персоны — агенты с разными целями. Максимизатор и минимизатор ограничивают разброс людей сверху и снизу. Порядок полей по сложности у агентов совпал с людьми. |
| Green и др., [Generating Levels That Teach Mechanics](https://arxiv.org/abs/1807.06734), 2018 | [И] Урезанный агент без механики должен проваливать уровень, который ей учит. |
| Aponte, Levieux, Natkin, [Measuring the Level of Difficulty](http://guillaumelevieux.com/siteperso/contents/papers/papers/ec2010_final.pdf), 2011 | [И] Сложность — P(проигрыш \| пройденные испытания). [Т] Проверяемая гипотеза: урок снижает вероятность проигрыша в следующем бою с той же механикой. |
| Sarkar, Cooper, [Inferring Difficulty Curves](https://pmc.ncbi.nlm.nih.gov/articles/PMC8336693/), 2019 | [И] Рейтинги игроков и уровней. Кривая может быть пилообразной, а не логистической. |

## 4. Телеметрия и плейтест

| Источник | Выводы |
| --- | --- |
| [GameAnalytics: funnels](https://www.gameanalytics.com/blog/exploring-gaming-funnels), 2025; [SayGames: difficulty](https://www.pocketgamer.biz/how-saygames-uses-game-analytics-to-balance-difficulty-in-hybrid-puzzle-games/), 2026 | [И] События start / complete / fail. [И] 50 % провалов ≈ 2 попытки на уровень, 80 % ≈ 5. Хвост распределения попыток важнее среднего. Универсальных порогов нет. |
| Wilson и др., [The Eighty Five Percent Rule](https://www.nature.com/articles/s41467-019-12552-4), 2019 | [И] Для обучения оптимальна точность около 85 %. [Т] Это ориентир, а не закон для игр. |
| Nielsen, [Test with 5 Users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/), 2000 | [И] 5 участников находят около 85 % проблем. Три раунда по 5 лучше одного на 15. Для количественных метрик нужно около 20 человек. |
| Ambinder, [Valve's Approach to Playtesting](https://cdn.cloudflare.steamstatic.com/apps/valve/2009/GDC2009_ValvesApproachToPlaytesting.pdf), GDC 2009 | [И] Дизайн — гипотеза, плейтест — эксперимент. Важно, что игроки делают, а не что говорят. Групповые обсуждения искажают ответы. |
| T. Francis, [15 Years of Indie Dev](https://www.pentadact.com/2026-01-08-15-years-of-indie-dev-in-4-bits-of-advice/), 2026 | [И] Масштабный тест показывает, где проблема, наблюдение — как её решить. Нужно минимум 2 раунда. |
| Law и др., [GEQ](https://dl.acm.org/doi/10.1145/3242671.3242683), 2018; Haider и др., [miniPXI](https://dl.acm.org/doi/10.1145/3549507), 2022 | [И] Факторная структура GEQ не подтверждена. miniPXI — 11 пунктов, валидность подтверждена для 9. [Т] На 5–10 людях опросник годится только как повод для разговора. |

## Что не удалось открыть

- Статья Capy «Grindstone: Creeps, Jerks, Slobs» — ошибка 403.
- Доклад Capy на GDC 2020 — нашёлся только анонс.
- Видео GMTK и доклад по Invisible Inc — не смотрели.
- Полные тексты Linehan 2014 и Hunicke 2005 — прочитаны только аннотации.
- Первоисточник о формальной проверке разрешимости карт в Into the Breach и Invisible Inc не найден.
