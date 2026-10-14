# Кривая сложности: темп новых понятий, механик, врагов и систем (обучение, когнитивная нагрузка, новизна)

Заметки исследователя, 14.10.2026. Контекст применения — Ashen Oath (браузерный реалтайм-рогалайт, цепь по одноцветным врагам). Поиск — веб, ~30 запросов/загрузок. Первичные источники отмечены; пересказ вторичных источников и «фольклор» помечены явно.

## 1. Когнитивная нагрузка, пределы рабочей памяти, интерактивность элементов — что известно и что переносится на игры

### Takeaway
Рабочая память держит порядка 4 «кусков» (Cowan), и нагрузку определяет не число понятий, а число понятий, которые надо держать **одновременно и во взаимодействии** (element interactivity, Sweller). Прямых игровых экспериментов по interactivity почти нет; самое близкое игровое доказательство — Andersen и др. (CHI 2012, 45 000+ игроков): обучение помогает только сложной игре и лучше всего работает «в момент нужды».

### Cited Findings
- Cowan (BBS, 2001): обзор данных по вербальным и невербальным материалам, разным модальностям, одиночным и двойным задачам указывает на «single, central capacity limit averaging about four chunks»; «7±2» Миллера Коуэн считает скорее грубой оценкой/риторикой — [Cowan 2001, Cambridge](https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/magical-number-4-in-shortterm-memory-a-reconsideration-of-mental-storage-capacity/44023F1147D4A1D44BDC0AD226838496); [PDF автора](https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf)
- Оценка спорная: часть авторов (Arsalidou et al. 2013; Pascual-Leone & Johnson 2011) держится ближе к 7, Reynolds et al. (2022) предлагают ~5 у взрослых — [Journal of Cognition, обзор дебатов](https://journalofcognition.org/articles/387)
- Element interactivity (Sweller 2010, Educational Psychology Review 22(2):123–138): внутренняя нагрузка задаётся числом элементов, которые учащийся должен обрабатывать одновременно, потому что они взаимодействуют — [пересказ в учебнике по CLT](https://pressbooks.pub/learningenvironmentsdesign/chapter/sweller-cognitive-load-theory-learning-difficulty-and-instructional-design) (вторичный источник; первичную статью не открывал)
- Эффект обращения экспертности (Kalyuga et al. 2003): приёмы, помогающие новичкам (пошаговые примеры, подсказки), вредят опытным — у них схемы уже есть и подсказки становятся избыточными; лекарство — «fading», постепенное снятие подсказок — [Wikipedia: Expertise reversal effect](https://en.wikipedia.org/wiki/Expertise_reversal_effect); [MIT Open Learning: worked and faded examples](https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples)
- Kalyuga et al. (2001): обучение на примерах лучше решения задач для новичков на ранней стадии, но преимущество исчезает по мере роста экспертности — [Wikipedia: Expertise reversal effect](https://en.wikipedia.org/wiki/Expertise_reversal_effect)
- Andersen, O'Rourke, Liu и др., «The Impact of Tutorials on Games of Varying Complexity», CHI 2012: 8 вариантов обучения в 3 играх (Refraction, Hello Worlds, Foldit), >45 000 игроков. В самой сложной и необычной (Foldit) контекстное обучение дало +29% времени игры и +75% пройденных уровней против отсутствия обучения; в двух простых играх эффекта почти нет — [статья, PDF](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf); [страница проекта](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/)
- Там же: подача инструкции «как можно ближе к моменту, когда она нужна» против мануала в начале — +16% времени и +40% прогресса в Foldit, без эффекта в простых играх — [Andersen et al. 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)
- Там же: блокирующее обучение (ограничение свободы, «трафарет» на нужный элемент) не дало доказуемой пользы; кнопка помощи «по запросу» помогла только в Foldit, а в Refraction **снизила** прогресс на 12% и время игры на 15% — [Andersen et al. 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)
- Вывод авторов: «players seem to learn more from exploring than from reading text»; открытый вопрос — «how to break down a complex game into smaller "chunks" that can be learned through exploration» — [Andersen et al. 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)
- Sharek & Wiebe (2014, Simulation & Gaming): в головоломке с условиями «скука/поток/фрустрация» у «скуки» нагрузка ниже, чем у «потока» и «фрустрации» — то есть поток не равен минимальной нагрузке — [IDEAS/RePEc](https://ideas.repec.org/a/sae/simgam/v45y2014i4-5p569-592.html)

### Inferences
- Ashen Oath относится к «сложному и необычному» классу (Foldit-подобному, а не Refraction-подобному): цепь по цвету, сдвиг цвета кристаллами, щит, прыжок, фокус, десяток видов врагов, аффиксы, гоблин, сборка. Значит, данные Andersen говорят: обучение здесь окупается, и подавать его надо в контексте. Это совпадает с решением команды (подписи у места, пролог в игре) и с отказом от текстовых плашек.
- Предел ~4 куска касается **одновременно удерживаемого**. Для реалтайма важна не сумма понятий за поход, а число активных взаимодействующих правил в одном бою: цвет врага × его поведение × аффикс элиты × состояние щита × риск гоблина. Каждое из них — элемент, который надо держать при планировании цепи. Разумный рабочий бюджет: не более ~3–4 одновременно «живых» правил на арене для новичка (эвристика, выведенная из Cowan; прямой игровой проверки нет).
- Понятия, ставшие «схемой» (цвет-цепь после пролога), перестают занимать слот: их можно комбинировать. Новые — занимают слот целиком. Отсюда «одна новинка на ряд» согласуется с теорией, но с оговоркой: новинка добавляется к **уже действующим** взаимодействиям, поэтому её цена растёт с глубиной похода.
- Эффект обращения экспертности: подсказки у места должны гаснуть (fading) для тех, кто уже показал навык; постоянные подписи для опытных — лишняя нагрузка. Кнопка помощи «по запросу» не гарантированно полезна (Refraction: −12%).

### Gaps
- Не найдено прямых экспериментов по element interactivity именно в экшен-играх реального времени; перенос — вывод по аналогии.
- Первичную статью Sweller 2010 и Pollock, Chandler & Sweller 2002 («Assimilating complex information», метод «сначала изолированные элементы, затем взаимодействующие») не удалось открыть; по памяти — идея сначала давать элементы изолированно, потом вместе, но в заметках это не подтверждено источником.

## 2. Обучение через игру: кисётэнкэцу (Hayashida), 1-1 (Miyamoto), Portal/Valve, Mega Man X, GMTK, Celeste, Into the Breach

### Takeaway
Общий паттерн хорошо задокументированных игр: одна механика → безопасное знакомство → усложнение → неожиданный поворот → проверка мастерства, затем механику **выбрасывают** или комбинируют с ранее выученными. Valve прямо фиксирует провал при «слишком многих новых понятиях сразу».

### Cited Findings
- Koichi Hayashida (Super Mario 3D Land), интервью Gamasutra, 13.04.2012: структура уровня по кисётэнкэцу: «First, you have to learn how to use that gameplay mechanic» → «a slightly more complicated scenario» → «something crazy happens that makes you think about it in a way you weren't expecting» → «demonstrate, finally, what sort of mastery you've gained over it»; «you have a clear concept in the beginning, and that's carried through absolutely all the way» — [Game Developer, Christian Nutt, 2012](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design)
- Hayashida: строго применять это начал только с 3D Land; Galaxy 2 — первый шаг; идею в команду принёс Миямото — [сводка интервью](https://www.nintendolife.com/news/2012/04/super_mario_3d_land_director_shares_level_design_inspirations); [Game Developer](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design)
- Mark Brown (GMTK, 2015) о Super Mario 3D World: уровни — «four-part, self-contained showcases for new ideas»; механика «taught, developed, twisted and then thrown away in about five minutes flat» — [MCV, 18.03.2015](https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps) (аналитика, не слова разработчика)
- Miyamoto (Iwata Asks, NSMB Wii, 2009): одинокий Гумба учит, что от врагов уходят прыжком, а топтание учит, что их можно победить; «Players must be guided naturally» — [Iwata Asks](https://iwataasks.nintendo.com/interviews/wii/nsmb/0/3) (страница не открылась из-за сертификата; цитата по [поисковой сводке](https://gonintendo.com/archives/100477-miyamoto-explains-how-the-player-is-taught-that-goombas-are-bad-and-mushrooms-are)). Версия «первым врагом был Купа, но пинок панциря сочли слишком сложным» — непроверенная, вторичная.
- Portal, комментарий разработчиков (первичный источник, слова Valve):
  - «Portal is effectively an extended player training exercise» (Robin Walker) — [Portal developer commentary](https://theportalwiki.com/wiki/Portal_developer_commentary)
  - «this puzzle introduced too many new concepts at once, which ended up frustrating a lot of playtesters» и «we still ended up introducing some concepts too quickly» (Chris Chin, камера 08) — там же
  - «Overwhelmed players tend not to digest new information, so we simplified the puzzle to require only the double fling»; комбинация с новым навыком «proved to be too much for most playtesters» (Kim Swift, камера 15) — там же
  - «Player training doesn't always stick, especially after the introduction of a big, new concept»; «playtesters often forgot about the fling maneuver» (Chris Chin, камера 12) — там же
  - Импульс («fling») — «the hardest concept to convey», поэтому его вводили «slowly, step by step» (Garret Rickey, камера 10) — там же
  - Первый портал поставлен так, чтобы игрок увидел в нём себя: так понимание приходит быстрее (Kim Swift) — там же
- Kim Swift: плейтесты начались через неделю после старта и шли примерно еженедельно; захламлённое окружение мешало замечать ключевые элементы головоломки, отсюда стерильный белый стиль — [Game Developer: Best of GDC, Portal](https://www.gamedeveloper.com/pc/best-of-gdc-the-secrets-of-i-portal-i-s-huge-success); [Game Developer: Thinking with Portals](https://www.gamedeveloper.com/design/thinking-with-portals-creating-valve-s-new-ip)
- Mega Man X (Egoraptor, «Sequelitis», 2011): вступительный уровень учит через игру и тонкую обратную связь, без подсказок на экране; главная новая механика — прыжок от стены. Критика: уровень опирается на опыт игрока в прошлых частях — [TV Tropes: Sequelitis](https://tvtropes.org/pmwiki/pmwiki.php/WebVideo/Sequelitis); [Nintendo Life soapbox](https://nintendolife.com/features/soapbox-mega-man-xs-tutorial-is-the-perfect-intro-to-capcoms-sublime-sub-series); [A Tale of Tutorials](https://codewriteplay.com/2019/12/02/a-tale-of-tutorials/) (всё — вторичный пересказ видео; расшифровку не нашёл)
- Celeste: каждая глава добавляет свою механику (ветер, блоки, платформы, двигающиеся от рывка) поверх простого набора (прыжок, рывок, хват); механики не злоупотребляются — [Wikipedia: Celeste](https://en.wikipedia.org/wiki/Celeste_(video_game)); [Digital Trends review](https://digitaltrends.com/gaming/celeste-review) (рецензии; заявлений Thorson о методе обучения не нашёл)
- Into the Breach: враги объявляют ход заранее, бой становится головоломкой на чтение намерений (Justin Ma, интервью Gamasutra 2018); на GDC 2019 Matthew Davis: дизайн-постмортем, вырезание фич, выбор сложности; команда трижды-четырежды выбрасывала по ~полгода работы — [GDC Vault: Into the Breach Design Postmortem](https://gdcvault.com/play/1025772/-Into-the-Breach-Design); [Kotaku](https://kotaku.com/the-creators-of-into-the-breach-came-very-close-to-givi-1833498295)

### Inferences
- Кисётэнкэцу хорошо ложится на арену Ashen Oath: «ки» — враг нового вида один или с уже знакомыми, без давления; «сё» — два-три таких в простой расстановке; «тэн» — поворот (тот же враг рядом с кристаллом сдвига или с элитой); «кэцу» — проверка. Пролог «Опушка» это делает по комнатам; вопрос — повторяется ли такой ритм для каждого нового вида в самом походе.
- Valve подтверждает, что «две новинки в одной камере» — главная причина фрустрации даже у сильной команды. Совмещение «новый враг + новая система сборки» на одной арене — риск того же рода.
- «Выбросить механику» (3D World) — для рогалайта менее применимо: механики должны жить в поиске сочетаний. Но принцип «одна ясная идея арены» переносится: у арены одна главная тема.
- Into the Breach — образец для реалтайма с планированием: телеграф намерения снимает нагрузку на память (игрок читает, а не держит в голове). Подсветка цепи (`planChain`) и предупреждения врагов — тот же инструмент.

### Gaps
- Расшифровку «Sequelitis» и собственные слова Thorson о методе Celeste не нашёл.
- Не найден первичный источник «teach, test, twist» как формулы Valve; в комментарии Portal есть «layering tools», но не эта триада. Скорее всего это фольклорная формулировка.
- GMTK-видео о туториалах (кроме 3D World) не открывал; прямых чисел у Брауна, кроме «около пяти минут» на уровень, нет.

## 3. Атомы и цепочки навыков (Cook), «Theory of Fun» (Koster), глубина против сложности

### Takeaway
Cook: игра — направленный граф «атомов навыка»; мастерство течёт по цепочке вниз, и сбой раннего атома отрезает всё, что за ним. Koster: веселье — освоение паттернов; освоенный паттерн «сжимается» в кусок и становится скучным. Глубина (разнообразие осмысленных решений) ценнее сложности (объёма правил).

### Cited Findings
- Cook, «The Chemistry of Game Design» (Gamasutra, 2007): атом навыка = действие → симуляция → обратная связь → обновление ментальной модели; цепочка навыков — «a directed graph of atoms»; «The skill from one atom feeds into the actions of another atom further down the chain»; «Mastery flows down the chain» — [Game Developer](https://www.gamedeveloper.com/design/the-chemistry-of-game-design); [Lostgarden 2007](https://lostgarden.com/2007/07/19/the-chemistry-of-game-design/)
- Cook: игроки не видят ценности навыка дальше пары атомов вперёд: «Players are unable to predict the value of a new skill more than a couple atoms down the chain» — [Game Developer](https://www.gamedeveloper.com/design/the-chemistry-of-game-design)
- Cook: ранний «burnout» (игрок не находит интересного применения навыку) может «chop off huge sections» опыта; поздний — навык «атрофируется», если игра перестаёт его вознаграждать; «Don't assume skills that may not be there»; выгорание атома можно измерять логированием («where atoms light up and where they burn out») — [Game Developer](https://www.gamedeveloper.com/design/the-chemistry-of-game-design)
- Модель игрока у Cook: игрок «driven… to learn new skills high in perceived value» — [Lostgarden 2007](https://lostgarden.com/2007/07/19/the-chemistry-of-game-design/)
- Koster о модели Cook: цепочки по сути совпадают с его «game atoms», но у Cook граф почти линейный, а Koster видит атомы вложенными — [Raph Koster: Cooking up Chemistry, 2007](https://www.raphkoster.com/2007/07/23/cooking-up-chemistry/)
- Horn, Cooper, Deterding (CHI PLAY 2017): дизайнеры строят цепочки навыков гипотетически, по замыслу; предложен адаптированный когнитивный анализ задач, чтобы получить эмпирическую цепочку игры — [White Rose eprint](https://eprints.whiterose.ac.uk/120653); [York](https://pure.york.ac.uk/portal/en/publications/adapting-cognitive-task-analysis-to-elicit-the-skill-chain-of-a-g/)
- Koster, «A Theory of Fun» (2005): «chunking» — деление большой информации на удобные группы; «grokking» — понимание на уровне мышечной памяти; «Games are just exceptionally tasty patterns to eat up»; когда паттерн освоен, игра становится скучной, если не подаёт паттерны по-новому — [Game Studies Wiki](https://game-studies.fandom.com/wiki/A_Theory_of_Fun_for_Game_Design?oldid=4071); [Goodreads](https://www.goodreads.com/book/show/18182) (вторичные пересказы книги)
- Глубина против сложности: сложность — объём знаний, нужных для решения; глубина — число эмпирически разных осмысленных возможностей из одного набора правил; «сложное трудно выучить, глубокое трудно освоить» — [Game Developer: Design 101: Complexity vs. Depth](https://www.gamedeveloper.com/design/design-101-complexity-vs-depth); [Game Developer: Thoughts on depth and complexity](https://www.gamedeveloper.com/design/thoughts-on-depth-and-complexity). Различение «complexity понимания» и «complexity отслеживания» (tracking) — там же.

### Inferences
- Для Ashen Oath полезно нарисовать цепочку навыков явно: «цепь по цвету» → «длина цепи / щит 3+» → «сдвиг цвета кристаллом» → «прыжок/фокус» → «чтение врага (лучник/волк/сапёр/шаман/дикобраз)» → «приоритет элит и брони» → «риск гоблина» → «сборка». Если «сдвиг цвета» не освоен, все враги, требующие перекраски, отрезаны (ранний burnout по Cook).
- Cook подсказывает метрику телеметрии: для каждого атома — первый раз использован, доля боёв с использованием, «погас» ли (перестал использоваться). Это прямо ложится на `telemetry/` и раздел «Пролог».
- «Ценность навыка видна на пару атомов вперёд»: дары/талисманы, усиливающие ещё не освоенный навык, новичок не оценит. Предложение сборки стоит связывать с уже освоенными атомами.
- Различие «понимания» и «отслеживания» особенно важно в реалтайме: даже понятое правило (таймер сапёра, щит) занимает внимание, если его надо отслеживать по ходу. Ограничивать стоит в первую очередь «отслеживаемые» элементы на экране.

### Gaps
- Оригинальную колонку Soren Johnson (Designer Notes) о глубине и сложности и тексты Keith Burgun об «элегантности» не нашёл в выдаче; определения выше — из статей Game Developer других авторов.
- Цитаты Koster о скуке — из пересказов; дословно по книге не проверено.

## 4. Темп новизны между походами в рогалайтах: открытия, сюжетные ворота, «новое за поход»

### Takeaway
Открытия по мере игры широко используются как «мягкое обучение» (Hades, Dead Cells, Slay the Spire, Balatro), но **надёжных опубликованных данных** о влиянии такого гейтинга на удержание я не нашёл. Есть только косвенное: обучение окупается в сложных играх (Andersen) и игроки различают «боковые» открытия (разнообразие) и открытия силы.

### Cited Findings
- Hades: сокровища неудачных забегов улучшают характеристики или открывают новое оружие и способности; прогресс встроен в цикл смерти — [Wikipedia: Hades](https://en.wikipedia.org/wiki/Hades_(video_game))
- Supergiant: ранний доступ использовали для настройки «complex game systems» и для решения, какие персонажи и сюжетные линии отзываются у игроков — [Game Maker's Notebook: Hades](https://gamemakersnotebook.libsyn.com/hades-with-supergiant-games-amir-rao-and-greg-kasavin); [GDC 2021: Breathing Life into Greek Myth](https://gdcvault.com/play/1026975/Breathing-Life-into-Greek-Myth)
- Обзор жанра (личный блог): открытия позволяют «fully control the pace of a player throughout the metagame», постепенно поднимая силу или сложность, и служат «soft tutorial» (примеры — Dead Cells); Balatro позволяет отключить метапрогрессию — [Roguelites: A Primer](https://urflow.bearblog.dev/roguelites-a-primer/) (не первичный источник)
- Сообщество: открытия, меняющие стиль игры, а не силу, «usually harder to pickup when first playing» (о Slay the Spire); недовольство метапрогрессией силы, так как она размывает ощущение собственного роста; «боковые» открытия оцениваются лучше — [lemm.ee](https://lemm.ee/comment/11446768); [обсуждение метапрогрессии](https://pie.gravitywell.xyz/post/44370) (мнения игроков, не данные)
- Разработчик Tiny Rogues: во многих рогалайтах приходится вкладываться в улучшения, прежде чем вообще возможно пройти игру; они хотели сделать метапрогрессию меньше про силу — [Steam: Tiny Rogues](https://steamcommunity.com/app/2088570/discussions/2/3361397532265670884)
- Balatro: в интервью TouchArcade отмечено, что есть система открытия контента и опция «unlock all»; ответ LocalThunk в выдержке обрезан — [TouchArcade 2024](https://toucharcade.com/2024/03/18/balatro-interview-mobile-port-localthunk-dlc-plans-updates-new-jokers-demo-feedback/)
- Slay the Spire 2: Giovannetti (через превью) — цель дать больше сложности вернувшимся, не перегружая новичков — [Rogueliker preview](https://rogueliker.com/slay-the-spire-2-preview/) (вторичная передача документального фильма PC Gamer)

### Inferences
- Для Ashen Oath (решение команды: мета — разнообразие и удобство с потолком, без постоянной силы) открытия — естественный инструмент темпа сложности **между походами**: не давать в первый поход все виды врагов, аффиксы, гоблина, крафт и ковку сразу, а открывать системы по мере опыта. Это «боковые» открытия, их сообщество оценивает лучше силовых.
- Hades-подобный приём «система открывается после события» (первая смерть, первое прохождение, знакомство с персонажем) даёт естественную «ки»-точку для новой системы и одновременно повод вернуться. Для «Испытания I–V» это уже так устроено (лестница после прохождения).
- Поскольку данных об удержании нет, решение о гейтинге стоит принимать по своей телеметрии: доля игроков, начавших второй поход, при разных вариантах.

### Gaps
- Не нашёл первичных интервью/постмортемов о логике открытий в Slay the Spire, Dead Cells, Vampire Survivors, Risk of Rain, Balatro и о порядке открытия систем Hades (Зеркало ночи, Договор наказания, памятные вещи). Вики Hades была недоступна (HTTP 402). Утверждения о точных условиях открытия не включаю.
- Нет исследований (CHI PLAY/FDG), которые бы измерили, повышает ли гейтинг сложности удержание в рогалайтах. Это главный пробел.
- Нет чисел о ритме «одно новое за поход» в известных играх.

## 5. Интерференция: две новинки сразу, противоречивые сигналы, «одно имя — одно значение», перегрузка HUD, ввод видов врагов

### Takeaway
Наиболее прямое доказательство вреда двух новинок сразу — комментарий Valve к Portal; наиболее строгое описание правильного порядка — Linehan и др. (CHI PLAY 2014): навыки вводятся по одному в простых задачах, затем комбинируются со старыми. Исследований по «одно имя — одно значение» и перегрузке HUD в реалтайм-играх я не нашёл.

### Cited Findings
- Linehan, Bellord, Kirman, Morford, Roche, «Learning curves: analysing pace and challenge in four successful puzzle games», CHI PLAY 2014 (Portal, Portal 2 co-op, Braid, Lemmings): «1) the main skills learned in each game are introduced separately, 2) through simple puzzles that require only basic performance of that skill, 3) the player has the opportunity to practice and integrate that skill with previously learned skills, and 4) puzzles increase in complexity until the next new skill is introduced» — [CORA UCC](https://cora.ucc.ie/handle/10468/3461); [авторская версия PDF](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content)
- Там же (Portal): минимум действий на головоломку падает в точках ввода нового навыка — «upon the presentation of a novel skill the difficulty of the level is reduced»; кривая — пилообразная: растёт до следующего навыка, затем резко проседает; общий тренд растёт. Lemmings отклоняется от паттерна (авторы: сейчас её бы сделали ближе к остальным) — [Linehan et al. 2014](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content)
- Там же: рекомендация — новый навык, затем практика со всеми ранее выученными, «slowly building up the number of skills that are chained together until players are expected to use all of those in a single puzzle»; авторы признают, что это эмпирическое подтверждение «popular wisdom» дизайнеров (Cook, Schell и др.) — там же
- Portal (Valve): «introduced too many new concepts at once» → фрустрация; новый навык + старый «double fling» → «too much for most playtesters»; энергетический шар с многошаговым перенаправлением вызывал панику — [Portal developer commentary](https://theportalwiki.com/wiki/Portal_developer_commentary)
- Portal: игроки в Narbacular Drop думали, что портал ведёт в другое измерение; решение — визуально уникальная стартовая комната с запоминающимися предметами (снятие противоречивой ментальной модели) — [Best of GDC: Portal](https://www.gamedeveloper.com/pc/best-of-gdc-the-secrets-of-i-portal-i-s-huge-success)
- Portal: визуальный шум (захламлённые уровни) мешал замечать ключевые элементы; плейтестер полчаса пытался толкнуть полку на кнопку, не замечая куб рядом → упрощение окружения — [Game Developer: Thinking With Portals](https://www.gamedeveloper.com/design/thinking-with-portals-creating-valve-s-new-ip)
- Andersen et al. 2012: инструкция в момент нужды лучше, чем заранее (+16% времени, +40% прогресса в сложной игре) — [Andersen et al. 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)
- Miyamoto: первый враг подаётся один, в безопасной обстановке, и сразу показывает два исхода (обойти прыжком, раздавить) — [поисковая сводка Iwata Asks](https://gonintendo.com/archives/100477-miyamoto-explains-how-the-player-is-taught-that-goombas-are-bad-and-mushrooms-are)

### Inferences
- Вводить вид врага: (1) один экземпляр нового вида среди знакомых, без давления по времени и без элит; (2) несколько таких же — практика; (3) сочетание с одним уже знакомым правилом (кристалл, щит); (4) проверка. Кривая сложности арены должна **проседать** в момент новинки (Linehan), а не продолжать расти. Если ряд вводит новый вид и одновременно поднимает плотность/элит, это нарушение паттерна.
- «Одна новинка на ряд» уже есть, но Linehan уточняет: новинка + падение сложности + последующая интеграция. Стоит проверить в данных: падает ли сложность (по боту или телеметрии) на арене первого появления вида.
- Противоречивые сигналы: если один цвет/иконка/слово означает разное (как «вожак/атаман», «Пепел/Испытание» — память проекта), это тот же класс ошибки, что «портал в другое измерение»: игрок строит неверную модель. Правило проекта «одно имя — одно значение» — правильное, но доказательная база найдена лишь косвенная.
- Визуальный шум Portal → для реалтайма: элементы, требующие реакции (телеграфы, щиты, цвета), должны читаться лучше декора. Новая информация в HUD конкурирует с полем боя за те же ~4 слота.

### Gaps
- Не найдено исследований о перегрузке HUD в реалтайм-играх (перцептивная нагрузка Лави и т. п. в поиске не проверялась).
- Не найдено исследований по согласованности терминов в играх; «одно имя — одно значение» — практика UX (эвристика консистентности), здесь не подтверждена источником.
- Не найдено исследований интерференции при одновременном вводе двух механик в экшен-играх (кроме анекдотических данных Valve).

## 6. Конкретные числа: сколько механик на минуту/уровень, первые часы

### Takeaway
Чисел мало. Надёжные: ~5 минут на уровень с одной механикой в 3D World (аналитика Брауна), ~4 куска рабочей памяти (Cowan), эффекты обучения в Andersen (+29%/+75%/+16%/+40%/−12%/−15%), 20 тест-камер Portal как обучающая часть. Подсчёта «понятий за первый час» в известных играх я не нашёл.

### Cited Findings
- Super Mario 3D World: механика вводится, развивается, поворачивается и выбрасывается «in about five minutes flat» — [MCV/GMTK 2015](https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps)
- Portal: обучающая часть — 20 тест-камер (0–19), все навыки игры вводятся в них; затем зоны без чётких камер — [Linehan et al. 2014](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content)
- Portal 2 co-op (вступление + первые три курса): 23 тест-камеры, 45 отдельных головоломок в анализе; каждый курс сфокусирован на одной теме (масса и скорость, световые мосты) — там же
- Andersen 2012: эффекты обучения — +29% времени, +75% уровней (Foldit, обучение против его отсутствия); +16%/+40% (в контексте против мануала); кнопка помощи −12% прогресса и −15% времени в Refraction — [Andersen et al. 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)
- Celeste: 7 глав + эпилог; каждая глава вводит свою механику — [Wikipedia: Celeste](https://en.wikipedia.org/wiki/Celeste_(video_game))
- Рабочая память: ~4 куска (Cowan 2001); альтернативные оценки 5–7 — [Cowan 2001](https://www.cambridge.org/core/journals/behavioral-and-brain-sciences/article/magical-number-4-in-shortterm-memory-a-reconsideration-of-mental-storage-capacity/44023F1147D4A1D44BDC0AD226838496); [Journal of Cognition](https://journalofcognition.org/articles/387)

### Inferences
- Грубая планка для сравнения: в эталонных платформерах одна новая идея на ~5 минут игры, причём уровень посвящён ей целиком. Если поход Ashen Oath длится, например, 20–40 минут и вводит в первом походе цвета, кристаллы, щит, прыжок, фокус, 6–7 видов врагов, элит с аффиксами и бронёй, гоблина, котомку, зелья, крафт, отдых, торговца, талисманы/молоты/реликвии, зарок и подвиги, это порядка 20+ понятий — заметно плотнее эталона. (Оценка длительности — допущение; её стоит заменить данными телеметрии.)
- Пролог из 10 комнат вводит ~10 понятий — это близко к ритму «одна комната — одна идея», но проверить надо, проседает ли сложность в комнате новинки и есть ли комната интеграции.

### Gaps
- Нет подсчёта числа понятий за первый час в Hades, Slay the Spire, Dead Cells, Vampire Survivors, Balatro. Утверждать числа нельзя.
- Нет данных Hayashida о числе механик на мир или на игру в 3D World (кроме аналитики Брауна).
- Полную таблицу навыков Linehan (Appendix, Table 5) не извлекал: в заметках только структура выводов.
