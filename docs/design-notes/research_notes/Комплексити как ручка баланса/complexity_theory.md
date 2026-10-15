# Комплексити как параметр: определения, счёт, бюджет, темп, рекомбинация

Заметки исследователя, 15.10.2026. Запрос пользователя: «самое ценное сейчас — это комплексити параметр. Как его балансировать, что вводить, можно ли её выстроить из того, что у нас есть».

База: прежние работы не повторяются, а продолжаются — [research-complexity.md](../../research-complexity.md) (шкала весов 0–3, инвентарь ≈ 80 понятий), [decisions-complexity.md](../../decisions-complexity.md) (правило-бюджет 1–9), [complexity_research.md](<../Кривые сложности и новизны/complexity_research.md>) (Cowan, Andersen, Linehan, Portal, Cook, Koster, кисётэнкэцу) и отчёт [Кривые сложности и новизны.md](<../../reports/Кривые сложности и новизны.md>) (провал давления при новинке, «живые правила», предел слежения ~4). Здесь — то, чего там нет: **чем именно считать** комплексити, как разные школы её делят, как отличать навязанную сложность от выбранной, как её копить без нового контента и что из измерения работает для детерминированной игры с журналами.

Пометки силы: **[сильно]** — первичный источник (слова разработчика на сайте студии, рецензируемая статья, код); **[слабо]** — вики, вторичный пересказ, фанатский разбор, мнение; **[вывод]** — мой вывод. Факты о нашем коде — путь к файлу, ветка `main`, HEAD `039a40d`. Числа бюджетов в последнем разделе — эвристика с датой, их проверяет плейтест.

## 1. Определения и счёт: чем отличаются комплексити, сложность и глубина; какие школы дают счётную единицу

### Takeaway
Почти все школы делят комплексити на **понимание** (сколько надо знать), **взаимодействие/отслеживание** (сколько надо держать в голове одновременно) и **стратегию** (сколько решений рождается) — и ограничивают первые два, а третье растят. Настоящую счётную единицу дают немногие: MTG (строки текста, «красные флаги» на карту, доля флагов в наборе, число уникальных слов правил), Riot (три оси по шкале Н/С/В на чемпиона), Koster («объём игры = число атомов»), Linehan (минимум действий на головоломку + точки нового навыка), CLT (число взаимодействующих элементов, зависящее от знаний игрока).

### Cited Findings
**Magic: the Gathering (Rosewater, Wizards of the Coast)**
- Три вида комплексити: понимание («understanding what a card does»), поле («how the cards interact with one another once they are on the battlefield»), стратегия («how the cards are maximized through proper play») — [Rosewater, Lenticular Design, Making Magic, 2014](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31) **[сильно]**. Цель New World Order — минимизировать первые два на common, не трогая третий — [пересказ в поиске; оригинал NWO не открылся](http://writeradept.blogspot.com/2014/06/common-design-part-1-new-world-order.html) **[слабо]**.
- Причина NWO: «we decided to cap the level of complexity at common», потому что новички покупают меньше бустеров и видят в основном common — [Rosewater, Lenticular Design](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31) **[сильно]**.
- Lenticular design: карта проста для новичка и глубже для опытного; «some complexity is hidden, because it requires certain knowledge to even be aware of it». Пример: Black Cat — для новичка «сюрприз при смерти», для опытного «the card is all about the death trigger» — [там же](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31) **[сильно]**.
- Критерии «красного флага» common (пересказ статьи Rosewater): «more than 4 lines of rules text»; «Does the card affect other cards in play?»; «Does the card create a 2-for-1 on the board?»; «Does the card force you to track information that normally is irrelevant?»; «approximately 20% of the Commons violate New World Order» в наборе — [Writer Adept, 2014, со ссылкой на archive.wizards.com mm/172](http://writeradept.blogspot.com/2014/06/common-design-part-1-new-world-order.html) **[слабо]**: первичную статью открыть не удалось (архив Wizards перенаправляет на главную). Карта с двумя и более флагами — почти всегда в uncommon — [пересказ из сводки поиска, MTG Salvation primer](https://www.mtgsalvation.com/forums/magic-fundamentals/custom-card-creation/578926-primer-nwo-redflagging) **[слабо]**.
- Счёт по словарю, а не по длине: Wizards считает «the uniqueness of words (how many total unique words appear in rules text)», а не число слов; механика в 4 строки (Blitz) по числу новых слов сопоставима с прошлыми наборами — [Wargamer, 10.05.2022, пересказ Rosewater «Odds & Ends: Streets of New Capenna»](https://www.wargamer.com/magic-the-gathering/mark-rosewater-complicated) **[слабо]** (вторичный пересказ слов дизайнера).
- State of Design 2025: отдельные механики делали проще, но «there's a trend in the last year of us making the sets complex in mechanical interaction»; «Some of this is in the volume of mechanics we include and some of this is about the choice of mechanics»; нужна синергия, но нельзя делать «an interconnected web» который «prevents the average player from being able to track what's happening». Bloomburrow: «Ten different factions… caused a complex web that was too hard to decipher… We should have just had five». Duskmourn: «I'm pretty sure I'd take at least one thing out. Maybe two.» — [Rosewater, State of Design 2025, 11.08.2025](https://magic.wizards.com/en/news/making-magic/state-of-design-2025) **[сильно]**.
- Ротация — главный регулятор общего объёма: команда «very conscious about rotating things, so only so much exists at any one time in Standard and Limited» — [Rosewater, через пересказ](https://mtgrocks.com/mtgs-complexity-creep-woes-may-be-over/) **[слабо]**.
- Главная угроза игре по Rosewater — «We stop getting new players» — [Magic Lessons, 22.06.2009, цитата по Draftsim](https://draftsim.com/mtg-complexity-creep/) **[слабо]** (вторичная цитата).

**League of Legends (Riot)**
- Три оси комплексити чемпиона, каждая Н/С/В: **механическая** (низкая — «spells just work», высокая — «High APM and punishing combos»), **знаний** (низкая — «Skills learned from other champs teach you how to play this one», высокая — нужен гайд), **игры с/против** (низкая — другим не надо менять игру, высокая — заставляет других думать иначе на стратегическом уровне). Цели: распределение чемпионов по колоколу; «Players shouldn't have to complete a PHD thesis to understand how to play with or against a champion»; играть **за** сложного чемпиона — выбор по желанию, поэтому там больше изучения допустимо — [Riot Scruffy, Quick Gameplay Thoughts, 30.10.2020](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-october-30) **[сильно]**. Там же таблица оценок: Sett С/Н/С, Fiddlesticks Н/С/В, Yone В/С/С и т. д.

**Teamfight Tactics (Riot)**
- Механика набора Shadow items усложнила самую трудную систему игры: «Champion itemization is already the most difficult part of TFT», и Shadow items «took the complexity of this system even further»; «the added complexity of this system was not widely satisfying»; ошибка выбора — чемпион мог самоуничтожиться. Hextech Augments — «quite a large system», но «unlike Shadow items, Augments don't make the core experience of the game more complex». Вывод студии: механики набора должны добавлять слой веселья, не «overburdening players with complexity» и не «losing the spirit of existing core mechanics» — [Riot_Mort, Reckoning Learnings, 08.10.2021](https://teamfighttactics.leagueoflegends.com/en-us/news/dev/dev-teamfight-tactics-reckoning-learnings/) **[сильно]**.

**Hearthstone (Ben Brode)**
- «Complexity is different than Strategic Depth»; лучшие карты — с наибольшим отношением глубины к комплексити; простые Whirlwind, Acolyte of Pain, Frothing Berserker вместе дали одну из самых трудных колод в истории игры. «Design space» считается перебором: все «ванильные» существа (без текста) — конечный список; следующий слой — существа только с ключевыми словами, тоже конечный и исчерпаемый без новых слов — [Hearthstone Top Decks, пересказ поста Brode, 27.01.2017](https://www.hearthstonetopdecks.com/ben-brode-defining-complexity-depth-design-space/) **[слабо]** (пост воспроизведён фан-сайтом, первичную ссылку не нашёл).
- Ключевые слова облегчают чтение при повторной встрече; команда держит ограниченный, ротируемый набор слов плюс ядро «вечных» боевых (Poisonous, Lifesteal) — [Inven Global, интервью Brode о Witchwood](https://www.invenglobal.com/hearthstone/articles/4797/ben-brode-on-the-witchwoods-most-dangerous-card-its-shudderwock) **[слабо]** (по сводке поиска; страницу не открывал).

**Koster, Cook, Harvey Smith, Linehan**
- Koster: «what we refer to as "scope of a game" is really measure of how many atoms it has»; атомы вкладываются друг в друга и собираются в «молекулы», и молекула должна отвечать тем же критериям веселья, что атом. Автор сам пишет, что эссе (2004, опубликовано 2012) «no longer represents my current understanding» — [Koster, An atomic theory of fun game design](https://www.raphkoster.com/?p=4090) **[сильно]** (первичный, но автор от него частично отошёл). Доклад GDC 2005 «A Grammar of Gameplay» — попытка нотации («Ludemography?»); формального метрического аппарата он не даёт — [слайды](https://www.raphkoster.com/gaming/atof/grammarofgameplay.pdf) **[слабо]** (по сводке поиска).
- Cook: атом = действие → симуляция → обратная связь → модель; цепочка — направленный граф. Уже разобран в [complexity_research.md](<../Кривые сложности и новизны/complexity_research.md>), раздел 3. Новое: Sarkar и Cooper формализуют цепочку для подбора уровней: «‘skills’ refers to the discrete mechanics of a game», уровни размечаются нужными навыками, и «the skillset required to solve easier levels is a subset of that required to solve harder ones»; добавление цепочки навыков к рейтинговой системе (Glicko) улучшило подбор сложности в двух играх (Iowa James, Paradox) — [Sarkar & Cooper, AAAI AIIDE 2020, «Evaluating and Comparing Skill Chains and Rating Systems for DDA»](https://par.nsf.gov/servlets/purl/10203585) **[сильно]**.
- Orthogonal Unit Differentiation — доклад Harvey Smith (2003): дать юнитам разные, независимые по функции способности — дешёвый способ получить глубину — [Uppsala/Utrecht speldesign blog](https://babel.speldesign.uu.se/?p=1977807); [каталог паттернов VU Amsterdam](https://math.vu.nl/~eliens/demo/pattern-orthogonalunitdifferentiation.html) **[слабо]** (текст доклада не нашёл). Приписывание этого термина Sirlin в запросе **не подтвердилось** — источник у Smith.
- Linehan и др. считают сложность головоломки как **минимальное число действий игрока** для решения, а новизну — как точки первого появления навыка; итог — «an objective picture of puzzle complexity… based on the puzzle design itself, rather than a subjective measure of player performance» — [Linehan et al., CHI PLAY 2014](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content) **[сильно]**. В Braid серия однотипных движений считалась одним действием, иначе данные «massive» — там же.

### Inferences
- **[вывод]** Счётных единиц три типа: (1) **на объект** — MTG-флаги, строки текста, Riot Н/С/В; (2) **на состояние** — CLT-элементы, взаимодействия «поля» MTG, «живые правила» нашего отчёта; (3) **на решение** — минимум действий Linehan, Iida (раздел 6). Для реалтайма с аренами нужны (1) для инвентаря и (2) для бюджета арены; (3) годится как проверка, не как бюджет.
- **[вывод]** MTG и Riot сходятся в главном: потолок ставят не на сумму комплексити игры, а на **то, что видит новичок** (common; играть против чемпиона), и на **взаимодействие** (флаг «влияет на другие карты», «интерконнект»). Rosewater 2025 прямо говорит: упростив отдельные механики, они всё равно перегрузили наборы **числом** механик и их **связями**. Это ровно риск нашей шкалы весов: она считает новые понятия по одному.
- **[вывод]** Урок TFT: комплексити, наложенная на самую трудную систему ядра, стоит дороже, чем большая, но отдельная система. У нас самая трудная система — цепь (цвет, сила, выживший, смена цвета). Механики, меняющие правила цепи (Хамелеон, щитоносец, жаровня, шаман-«крепкость»), — аналог Shadow items; механики рядом с цепью (гоблин как конец цепи, расходники, карта) — аналог Augments.
- **[вывод]** Ось Riot «знаний» совпадает с CLT-укрупнением: «навык с другого чемпиона учит этого» = элемент уже есть в долговременной памяти и стоит ноль. Это даёт правило: новый враг, чья реакция выводится из старых (рысь — «прыгает по линии» как кабан), дешевле врага с новым классом реакции (дикобраз — «не бей цепью»).

### Gaps
- Оригинальную колонку New World Order (2011) и точное правило «≈ 20 % флагов» из первичного источника проверить не удалось; цифра — из вторичного пересказа.
- Внутреннего «complexity budget» Riot или Hearthstone как числа не нашёл: публичны только качественные оси и примеры. Фраза «complexity budget» у Mortdog/TFT в поиске не подтвердилась.
- Текст доклада Harvey Smith 2003 не найден.

## 2. Когнитивные пределы: что ставит потолок

### Takeaway
Потолок задаёт число элементов, которые надо держать **одновременно и во взаимодействии**, а это число **зависит от игрока**: укрупнение (chunking) превращает знакомое сочетание в один элемент, но только если сочетание **структурное**, а не случайное. Навыки без практики гаснут, и сильнее гаснут навыки на точность и «искусственные» правила, чем моторные. Поэтому комплексити — это не свойство арены, а пара «арена × история игрока».

### Cited Findings
- Element interactivity определяется одновременно структурой материала и знаниями в долговременной памяти; структуру «can easily be quantified by counting the number of interacting information elements», а знания игрока «can only be estimated using teacher judgment or knowledge tests» — [Chen, Paas & Sweller 2023, Educational Psychology Review, «A Cognitive Load Theory Approach to Defining and Measuring Task Complexity Through Element Interactivity»](https://link.springer.com/article/10.1007/s10648-023-09782-w) **[сильно]** (цитата по аннотации в сводке поиска; полный текст закрыт).
- Что считается одним элементом, зависит от экспертности: то, что для эксперта — низкая интерактивность, для новичка — высокая — [там же; пересказ в учебнике CLT](https://pressbooks.pub/learningenvironmentsdesign/chapter/sweller-cognitive-load-theory-learning-difficulty-and-instructional-design) **[слабо]**.
- Isolated-interacting elements: сначала дать элементы по отдельности (без взаимодействия), затем полную задачу — для части учащихся это дало лучшее обучение, чем полная задача в обеих фазах; авторы ожидали начальный провал понимания, затем выигрыш — [Pollock, Chandler & Sweller 2002, Learning and Instruction 12(1):61–86, аннотация](https://ro.uow.edu.au/edupapers/145) **[сильно]** (аннотация; полный текст не читал). Эффект зависит от экспертности — [Blayney, Kalyuga & Sweller 2010](https://unsworks.unsw.edu.au/entities/publication/f86a113a-28a6-448b-85d6-8ae0ee23bd8a/full) **[слабо]** (по сводке).
- Предел слежения: Pylyshyn & Storm (1988) — 4–5 движущихся объектов среди одинаковых отвлекающих; позже показано, что предел зависит от скорости и расстояния (до 8–9 при медленном и редком) и падает постепенно, а не обрывом — [Wikipedia: Multiple object tracking](https://en.wikipedia.org/wiki/Multiple_object_tracking); [Franconeri et al., обзор](https://visualcognition.psych.northwestern.edu/publications/Franconeri_etal_MOT_PBR.pdf) **[сильно]** (обзор; цифра 4–5 — по цитированию).
- Укрупнение в шахматах: мастера восстанавливают позицию из партии после 5 с показа, но на **случайных** позициях игроки всех уровней вспоминают в среднем около 3–4 фигур; паузы ≈ 2 с между «кусками» при восстановлении — граница куска. Позже Gobet & Simon (1996) нашли небольшое преимущество экспертов и на случайных позициях — [Chase & Simon 1973, Perception in chess (PDF)](https://www.Gwern.net/doc/psychology/chess/1973-simon.pdf); [Gobet & Simon 1996](https://www.Gwern.net/doc/psychology/chess/1996-gobet.pdf) **[сильно]** (цифры — по сводке поиска).
- Угасание навыка: мета-анализ 53 статей (189 точек): потеря от d = −0,01 сразу после обучения до d = −1,4 после > 365 дней без практики; физические, «естественные» и скоростные задачи гаснут меньше, чем когнитивные, «искусственные» и точностные; при сходных условиях вспоминания потеря меньше — [Arthur, Bennett, Stanush & McNelly 1998, Human Performance 11(1):57–101](https://Www.Gwern.net/doc/psychology/spaced-repetition/1998-arthur.pdf) **[сильно]**. Новый мета-анализ (1344 эффекта, 457 работ) — [Psychological Bulletin 2025](https://pubmed.ncbi.nlm.nih.gov/40455501/) **[сильно]**, числа не извлекал; в диссертации Tatel рост эффекта потери ≈ 0,08 SD в месяц для точностных мер и 0,06 для скоростных — [Georgia Tech](https://repository.gatech.edu/entities/publication/5d7d666f-2ae7-4e3c-9ec9-729ffad16cda) **[слабо]** (по сводке).
- Интервальное повторение: 839 оценок в 317 экспериментах; оптимальный промежуток между занятиями растёт с ростом срока, на который нужно помнить — [Cepeda et al. 2006, Psychological Bulletin 132:354–380](https://pubmed.ncbi.nlm.nih.gov/16719566/) **[сильно]**. Правило «≈ 10–20 % от срока удержания» — из последующей работы, в сводке вторично — [mindomax](https://www.mindomax.com/study-schedules-that-maximize-retention) **[слабо]**.
- Предел рабочей памяти ~4 куска (Cowan), эффект обращения экспертности и Andersen — уже в [complexity_research.md](<../Кривые сложности и новизны/complexity_research.md>), раздел 1.

### Inferences
- **[вывод]** Отсюда **формула единицы**: элемент арены стоит «1», если игрок его ещё не укрупнил, и почти «0», если укрупнил. Значит, бюджет надо считать по **истории зрителя** (у нас есть `newSeen`, `viewerRun`, `firsts`), а не по номеру ряда. Номер ряда — только приближение для первого похода.
- **[вывод]** Chase & Simon дают тонкое, но важное правило для генерации: укрупняются **повторяющиеся структуры**, а не элементы. Случайная смесь из пула (любой вид с любым аффиксом в любом месте) не укрупняется так же хорошо, как узнаваемые «составы» (`sim/rosters.ts`: «Натиск», «Волки»). Повторяемые именованные сочетания — путь к тому, чтобы сложность росла без роста нагрузки.
- **[вывод]** Предел слежения падает постепенно и зависит от скорости и плотности. Для нас это значит: «4 угрозы» — не стена, а ориентир, и его цена растёт с темпом (рывок кабана, бросок волка, запал перебора 0,6 с). Быстрые угрозы стоит считать с весом выше медленных.
- **[вывод]** Угасание: правила цепи (цвет, сила, выживший) — «искусственные, точностные» по классификации Arthur и должны гаснуть **быстрее**, чем движение и прыжок. После перерыва (например, неделя и больше) подписи `newSeen` и подписи у места, уже погашенные по памяти зрителя, имеет смысл показать снова один раз. Это не обучение заново, а «повторение через интервал».

### Gaps
- Прямых экспериментов по element interactivity в экшен-играх реального времени не нашёл; вся теория — перенос.
- Нет игровых данных об угасании навыков между сессиями в рогалайтах (частоты возвращения после перерыва, ошибки после паузы).

## 3. Темп: ввести → развить → повернуть → завершить; когда прекращать новые атомы

### Takeaway
Измеренный образец — пила Linehan: новый навык — в провале сложности, затем рост до следующего навыка. Дальше дизайнеры не дают числа «атомов в час», но дают **признак остановки**: когда добавочные механики начинают связываться в сеть, которую средний игрок не может отслеживать (Rosewater 2025), — надо убрать одну-две, а не добавить. Новинка дальше — это новое **сочетание**, а не новый атом.

### Cited Findings
- Portal: 20 камер (0–19) учат все навыки; новые навыки стоят на провалах кривой «минимум действий»; исключение — камера 11 (орудие выдаётся после головоломки и ещё четыре действия). Portal 2 co-op: вступление + три курса = 23 камеры и 45 головоломок, у каждого курса своя тема; в вступлении несколько навыков подряд в простых головоломках (вероятно, «догоняющий» блок). Braid: каждый мир — набор механик, внутри мира число действий растёт, в поздних мирах выше — [Linehan et al. 2014](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content) **[сильно]**.
- Hayashida (3D Land): «you have a clear concept in the beginning, and that's carried through absolutely all the way» — [Game Developer, 2012](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design) **[сильно]**; 3D World: механика проходит четыре шага и выбрасывается «in about five minutes flat» — [MCV/GMTK 2015](https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps) **[слабо]** (аналитика). Подробности — в [complexity_research.md](<../Кривые сложности и новизны/complexity_research.md>), раздел 2.
- Признак перегрузки в наборе: «volume of mechanics» + «interconnected web»; Bloomburrow — 10 фракций, «should have just had five»; Duskmourn — убрать «one thing… Maybe two» — [Rosewater, State of Design 2025](https://magic.wizards.com/en/news/making-magic/state-of-design-2025) **[сильно]**. За год Wizards ввели около 15 новых механик в нескольких наборах — там же.
- Riot распределяет комплексити чемпионов «колоколом»: немного очень простых и очень сложных, большинство в середине; в каждом классе и позиции — и простой, и сложный вариант — [Riot, 30.10.2020](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-october-30) **[сильно]**.
- Cook (Loops and Arcs): петли дают ценность «through the act of being exercised», дуги потребляются один раз («An arc is a broken loop you exit immediately»); цепочка дуг удлиняет удержание, но создаёт зависимость от постоянного нового контента — [Lostgarden, 30.04.2012](https://lostgarden.com/2012/04/30/loops-and-arcs/) **[сильно]**.

### Inferences
- **[вывод]** «Teach-test-twist» как формула Valve первичного источника не имеет (это отмечено в прошлых заметках); измеренный факт — пила Linehan и четыре шага Hayashida. Для Ashen Oath в терминах этих источников: «ки» — первая встреча вида в провале; «сё» — тот же вид в 1–2 боях с уже знакомыми; «тэн» — пара с другим знакомым правилом; «кэцу» — проверка.
- **[вывод]** Признак «пора остановить новые атомы» у нас уже близко: ≈ 80 понятий инвентаря ([research-complexity.md](../../research-complexity.md), 2.8), 9 видов врагов (файлы `src/realtime/sim/enemies/`: archer, basic, boar, lynx, porcupine, sapper, shaman, shield, wolf) плюс крепкие, 4 аффикса (`AFFIX_IDS` в `sim/elites.ts`), 3 поведения элит. По логике Rosewater дальше рост лучше брать из **сочетаний и контекста** (раздел 7), а новые атомы вводить только в новом биоме (гарнизон), где их «ротация» оправдана сменой места.
- **[вывод]** Дуга против петли (Cook): новый вид врага — это дуга (потребляется при первой встрече), а сочетание видов, аффиксов и местности — петля. Рогалайту выгоднее петли: их повторение даёт ценность. Значит, бюджет новизны на поход тратится на дуги в первом походе и на петли — во всех следующих.

### Gaps
- Не нашёл опубликованных чисел «новых механик в час» для Hades, Celeste, Dead Cells, Slay the Spire; опорные числа остаются у Linehan (камеры, головоломки) и Брауна («около пяти минут»).
- Нет опубликованного правила, сколько уровней практики нужно между двумя новыми навыками; у Linehan это видно на графиках, но в текстовой части числа нет.

## 4. Две комплексити рогалайта: навязанная (враги, арена, правила) и выбранная (сборка)

### Takeaway
Самый ясный первичный принцип — Riot: комплексити, которую игрок **выбрал** («играть за»), может быть высокой, а комплексити, которую ему **навязали** («играть против»), должна быть низкой. Рогалайты повторяют это устройством: выбранная сложность растёт со сборкой, но её режут слоты и размер (Hades — один дар на слот, Balatro — 5 шутов). У нас навязанная сложность растёт по рядам, а выбранная (талисманы) — без явного потолка.

### Cited Findings
- Riot: против чемпиона не должно требоваться «a PHD thesis»; играть за сложного — «opt-in», там больше изучения допустимо — [Riot, 30.10.2020](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-october-30) **[сильно]**.
- MTG: потолок комплексити — на common (то, что новичок получит в любом случае), сложное — на редких картах, которые игрок ищет сам — [Rosewater, Lenticular Design](https://magic.wizards.com/en/news/making-magic/lenticular-design-2014-03-31) **[сильно]**.
- TFT: Shadow items (выбор игрока, но с суровой ценой ошибки и на самой трудной системе) не понравились; Augments — большая система выбора, не усложняющая ядро — [Riot_Mort, 08.10.2021](https://teamfighttactics.leagueoflegends.com/en-us/news/dev/dev-teamfight-tactics-reckoning-learnings/) **[сильно]**.
- Hades: пять категорий даров (Attack, Special, Cast, Dash, Call), один дар на категорию — [Prima Games guide](https://primagames.com/gaming/hades-guide-olympian-god-boons-skills/2) **[слабо]** (гайд). Hades II — пять слотов, один дар на слот — [Rogue Ranker](https://rogueranker.com/hades-2-boons/) **[слабо]**.
- Balatro: шутов не больше пяти без особых улучшений; редкое предложение и ограниченные слоты заставляют выбирать — [Error & Exp. substack](https://errorandexp.substack.com/p/unpacking-balatros-addicting-game); [Globe and Mail](https://theglobeandmail.com/arts/article-inside-the-stunning-success-of-balatro-the-video-game-sensation-made) **[слабо]**. Причины ограничения от LocalThunk не нашёл.
- Hearthstone: глубина простых карт рождается из сочетаний с другими картами; «simple blocks that players can combine» — путь к высокому отношению глубины к комплексити — [Brode 2017, пересказ](https://www.hearthstonetopdecks.com/ben-brode-defining-complexity-depth-design-space/) **[слабо]**.
- Наш код: явного потолка числа талисманов не нашёл (поиск по `talismans.length`, `max…talisman` в `src/realtime`); талисманов-счётчиков с условием в бою (Пятое звено, Третья цепь, Ударная волна, Иней и т. д.) — несколько, они описаны в [realtime-phase-b.md](../../../realtime-phase-b.md) **[сильно, код и документ]**; колонка сборки слева — `view/buildColumn.ts`.

### Inferences
- **[вывод]** Механизм «самопейсинга» выбранной сложности: игрок берёт то, что понимает (Cook: ценность навыка видна лишь на пару атомов вперёд), поэтому сборка сама растёт со скоростью освоения. Но это работает, только если **можно отказаться** (пропуск карты в StS; у нас — выбор из 2 и переброс) и если **пассивные** предметы не требуют внимания в бою (lenticular). Талисман-счётчик, который надо отслеживать в бою («каждая 3-я цепь», «8 звеньев»), — это **навязанная себе** комплексити отслеживания; она складывается с навязанной ареной в те же ~4 слота.
- **[вывод]** Предложение для баланса двух источников: держать **сумму отслеживаемого** постоянной. Чем глубже ряд (больше навязанного), тем меньше должно быть отслеживаемых счётчиков сборки — или тем лучше их надо показывать (счётчик у героя, а не в колонке). Слоты Hades и Balatro — это потолок выбранной комплексити, который одновременно делает выбор осмысленным.
- **[вывод]** Урок TFT для сборки: талисман, меняющий правило цепи (самая трудная система), дороже по комплексити, чем талисман на гоблина, расходник или прыжок. В «весах» стоит различать «меняет ядро» и «рядом с ядром».

### Gaps
- Нет первичных слов Mega Crit, Supergiant или LocalThunk о пределе слотов и размере колоды как о регуляторе комплексити; связь «слот = потолок комплексити» — вывод.
- Не проверял, есть ли у нас косвенный потолок числа талисманов через частоту предложений (число узлов с талисманом за поход). Это вопрос к коду `run/` и телеметрии.

## 5. Комплексити между походами: открытия, «первый поход — обучение», лестница с новыми ходами

### Takeaway
Между походами комплексити регулируют двумя механизмами: **ротацией/открытием пула** (сколько всего существует сейчас) и **лестницей**, где высокие ступени меняют **поведение знакомого**, а не вводят новое. Второе — дешёвая сложность: элемент уже укрупнён, игрок получает «поворот» (тэн) без нового атома.

### Cited Findings
- Hades, Extreme Measures: каждая ступень меняет одного босса — 1: все три Фурии; 2: Гидра в меньшей арене; 3: усиленный Минотавр, Тесей бросает бомбы с колесницы; 4 (после настоящей концовки): у Аида третья фаза — [TrueAchievements, обзор Pact of Punishment](https://www.trueachievements.com/game/Hades/walkthrough/7); [PCInvasion](https://www.pcinvasion.com/?p=221639) **[слабо]** (гайды; число ступеней в ранних версиях расходится: Prima — 3).
- StS A17–A19 — «сложнее ходы» уже знакомых врагов, ранние ступени — числа ([StS wiki: Ascension](https://slaythespire.wiki.gg/wiki/Ascension), разобрано в отчёте «Кривые…») **[слабо]**.
- MTG: ротация ограничивает, сколько механик существует одновременно в Standard и Limited — [пересказ Rosewater](https://mtgrocks.com/mtgs-complexity-creep-woes-may-be-over/) **[слабо]**; в Commander (вечный формат) «complexity creep comes with the territory» — [Rosewater, tumblr, через Draftsim](https://draftsim.com/mtg-complexity-creep/) **[слабо]**.
- Riot: переработки чемпионов должны примерно сохранять их уровень комплексити — [Riot, 30.10.2020](https://www.leagueoflegends.com/en-us/news/dev/quick-gameplay-thoughts-october-30) **[сильно]**.

### Inferences
- **[вывод]** Для «Испытания I–V»: высокие ступени (IV–V) — правильное место для «поворотов» знакомых врагов (как Extreme Measures): новый ход у кабана или волка, а не новый вид. Это комплексити «понимания» веса 1–2 при нулевой новизне вида. Сейчас IV — аффиксы, V — плотность и темп ([realtime-slice.md](../../../realtime-slice.md), «Испытание»).
- **[вывод]** Ротация MTG переносится как «одновременный пул»: в одном походе не обязательно присутствие всех 10 видов. Если в будущем (гарнизон) видов станет 15–20, поход может брать подмножество (как набор MTG берёт 5 механик, а не все). Это способ растить разнообразие без роста нагрузки в одном походе. Выводы `forest/` для seed не трогаются: подмножество — свойство пулов арен (`run/arenaPools.ts`) под флагом сохранения.
- **[вывод]** Ось «знаний» Riot для открытия между походами: новое в N-м походе лучше выводить из уже известного (вариант знакомого врага), чем приносить новый класс реакции.

### Gaps
- Нет исследований влияния открытий на удержание (тот же пробел, что в прошлой работе).
- Первичных слов Supergiant о логике Extreme Measures не нашёл.

## 6. Измерение: формулы и прокси, применимые к детерминированной игре с журналами

### Takeaway
Опубликованные «формулы комплексити» (game refinement Iida, сложность поиска D·ln B, эстетические меры Ludi) построены для дискретных игр и держатся на непроверенных допущениях — для нашей игры они не нужны. Работающий подход — из науки об обучении: **кривые обучения по компонентам знаний** (ошибка на попытку), плюс разметка уровней нужными навыками (Sarkar & Cooper) и минимум действий (Linehan). Наш журнал команд даёт это без новых правил.

### Cited Findings
- Game refinement: GR = √G / T (G — «успешные броски», T — попытки); «зона» 0,07–0,08; значения: футбол 0,073 (2,64 из 22), баскетбол 0,073, UNO 0,078, бадминтон 0,086, DotA 0,078. Обоснование авторов: «it is likely that the acceleration of information progress is subject to the forces and laws of physics». Там же мера сложности поиска C = D·ln B (шахматы B 35, D 80, C ≈ 284; го B 250, D 208, C ≈ 1148) — [Iida-group, «First Results from Using Game Refinement Measure and Learning Coefficient in Scrabble», arXiv 1711.03580](https://arxiv.org/pdf/1711.03580) **[сильно]** (первичный текст; сами допущения — слабые). Для настольных игр в литературе — GR = √B / D (B — ветвление, D — длина), в этой статье не проверено **[слабо]**.
- Критика: теория не объясняет связь популярности игры со значением GR («sophistication-population paradox»), авторы добавляют понятие «attractiveness» — [Xiong, Tiwary & Iida 2016, IFIP ICEC](https://dl.ifip.org/IFIP-LNCS-9926/hal-01640279) **[слабо]** (по сводке); почти все работы по теме — той же группы; независимой проверки на данных вовлечённости не нашёл.
- Ludi (Browne & Maire 2010): 57 эстетических критериев из самоигры; 16 из них предсказывали оценки игроков; Yavalath из эволюционного поиска вошёл в верхние 2,5 % абстрактных игр — [SIGEVOlution 2012](https://gpbib.cs.ucl.ac.uk/gp-html/Browne_2012_sigevolution.html); [Academia.edu](https://www.academia.edu/80415661/Evolutionary_Game_Design) **[слабо]** (вторично; полный текст не читал).
- «Decision density»: частота интересных решений во времени — [Game Developer, «Criteria for strategy game design»](https://www.gamedeveloper.com/design/criteria-for-strategy-game-design) **[слабо]** (мнение); каждое решение имеет заметное влияние — [MiniDungeons 2, Liapis](https://www.antoniosliapis.com/papers/minidungeons_2.pdf) **[слабо]**. Стандартной метрики «решений в минуту» нет.
- Кривые обучения (DataShop, Koedinger): ось X — **попытки** (opportunity: каждый шаг, где нужен компонент знаний), ось Y — **доля ошибок** (ошибка или подсказка с первой попытки); модель — Additive Factors Model (логистическая регрессия); плоские или неровные кривые означают, что модель компонентов неверна, и её дробят — в геометрии так нашли лучшую модель — [DataShop: case study Koedinger](https://pslcdatashop.web.cmu.edu/about/case-studies/koedinger-geometry-script-for-web.htm); [DataShop help](https://pslcdatashop.web.cmu.edu/help?page=terms) **[сильно]**. Порог «нет обучения» по наклону AFM 0,001 — в отдельной работе — [EDM 2024](https://educationaldatamining.org/edm2024/proceedings/2024.EDM-long-papers.17/index.html) **[слабо]**.
- Разметка уровней нужными навыками и подбор по цепочке навыков + рейтинг — [Sarkar & Cooper 2020](https://par.nsf.gov/servlets/purl/10203585) **[сильно]**. Минимум действий как объективная сложность головоломки — [Linehan et al. 2014](https://cora.ucc.ie/server/api/core/bitstreams/764eb125-34e4-4e9d-a2d4-0fbc89bb2cb9/content) **[сильно]**.
- Cook: логировать, где атомы «light up» и «burn out» — [Game Developer](https://www.gamedeveloper.com/design/the-chemistry-of-game-design) **[сильно]** (уже в прошлой работе; здесь — как основа метода).

### Inferences
- **[вывод]** GR и C = D·ln B не подходят: реалтайм не имеет дискретного ветвления; «зона 0,07–0,08» держится на физической аналогии без эмпирики вовлечённости. Не тратить на них время.
- **[вывод]** Кривые обучения DataShop — **прямой ответ на «как считать, что элемент укрупнён»**. У нас компонент знаний = атом (цвет цепи, выживший, рывок кабана, иглы дикобраза, пластина, перебор гоблина…). Попытка = бой (или эпизод), где атом был «нужен» (враг вида на поле, игрок рядом). Ошибка = событие из журнала: урон от источника этого атома, отказ цепи «не тот цвет», цепь через поднятые иглы, удар по пластине вне окна, нахождение в круге перебора. Если доля ошибок падает с попытками — атом укрупняется; если кривая плоская — атом надо дробить (или он не учится игрой). Это работает на 5–6 новичках как наблюдение и на сотнях — как оценка.
- **[вывод]** Детерминизм даёт то, чего нет у обычной телеметрии: **повтор журнала** с инструментами без изменения хэша. Атомы и ошибки можно пересчитать из старых записей задним числом, когда модель атомов поменяется (как дробление KC в DataShop).
- **[вывод]** Минимум действий Linehan переносится как «минимум цепей до целей арены» при знании правил — его может посчитать бот. Это мера «стратегической» части, а не нагрузки; пригодна как проверка пилы (провал на арене первой встречи).

### Gaps
- Применения кривых обучения (AFM) именно к экшен-играм реального времени не нашёл; искомая статья Harpstead & Aleven о кривых обучения в игре в поиске не подтвердилась.
- Нет проверенной связи «decision density» с удовольствием.

## 7. Рекомбинация: новая трудность из старых атомов

### Takeaway
Источники согласны в механизме, но не дают числа: глубина — из **сочетаний простых блоков** (Brode, Koster «молекулы», Harvey Smith — ортогональные юниты), ценность — в **повторяемых петлях**, а не одноразовых дугах (Cook). Шаблоны рекомбинации: контекст (местность), ограничение (меньше места, меньше лечения), пара угроз с разными приоритетами (Doom), изменение поведения знакомого на высокой ступени (Hades). Опубликованного правила «сколько сочетаний на новый атом» **не нашёл**.

### Cited Findings
- Brode: «design space» конечен — его можно перечислить (ванильные существа, затем существа с ключевыми словами), и без новых ключевых слов он исчерпается — [Brode 2017, пересказ](https://www.hearthstonetopdecks.com/ben-brode-defining-complexity-depth-design-space/) **[слабо]**.
- Koster: атомы собираются в молекулы, молекула должна быть «весёлой» по тем же критериям — [Koster](https://www.raphkoster.com/?p=4090) **[сильно]**.
- Doom Eternal: «If you're not prioritizing anything on the battlefield and just killing whatever's in front of you, that sucks»; «You know you've got an encounter dialed in right when the player is running by certain enemies to kill another one» (Hugo Martin); враги — «chess pieces» с элементами риска и награды — [Shacknews, Hell Razer: The Making of Doom Eternal, стр. 4](https://www.shacknews.com/article/116635/hell-razer-the-making-of-doom-eternal?page=4) **[сильно]** (цитаты разработчика в репортаже).
- Hades Extreme Measures — новые ходы знакомых боссов и меньшая арена (контекст) — раздел 5 **[слабо]**.
- Rosewater 2025: синергия нужна, но не «interconnected web» — [State of Design 2025](https://magic.wizards.com/en/news/making-magic/state-of-design-2025) **[сильно]**.
- Into the Breach: мало систем, глубина — из взаимодействий; враги показывают атаку заранее — [Giant Bomb, пользовательский обзор](https://giantbomb.com/user-reviews/uid/8831/into-the-breach-a-gem-of-constrained-design) **[слабо]**; цель Davis — «more deterministic in the moment-to-moment gameplay» — [PC Gamer preview](https://pcgamer.com/into-the-breach-preview) **[слабо]** (по сводке).
- Укрупняются структурные позиции, не случайные — Chase & Simon, раздел 2 **[сильно]**.

### Inferences
- **[вывод]** Наше пространство сочетаний уже велико и перечислимо (подход Brode): 9 видов (+ крепкие) × 4 аффикса × 3 поведения элит × типы целей (убей N, одной цепью, кнопки, отмеченные, атаман/орда) × местность (обрыв, река, терновник, жаровня, кристаллы, сундук) × риск гоблина × ступени «Испытания». Даже **пары** из 9 видов дают 36 сочетаний. Новизна похода может идти из **первой встречи пары**, а не вида: это дешевле (оба атома укрупнены, новое — только взаимодействие).
- **[вывод]** По Doom хорошая пара угроз — это пара с **разным приоритетом** (кого бить первым): лучник + щитоносец (дальний сигнал + заход сбоку), сапёр + волки (взрыв + окружение), шаман + крепкие. Пара с одинаковой реакцией (два «уйди с линии») — почти ноль глубины.
- **[вывод]** Правило «сколько сочетаний на атом» придётся вывести самим. Предлагаемая эвристика (раздел ниже): после ввода атома — не меньше двух боёв, где он стоит с **одним** знакомым партнёром, прежде чем он войдёт в тройку. Это перенос «isolate-then-combine» (Pollock) и пилы Linehan, не измерение.
- **[вывод]** Против «сети» Rosewater: элементы, которые **изменяют друг друга** (шаман делает слабого крепким → меняет силу цепи; Хамелеон меняет цвет → меняет цепь), — «флаги поля» в терминах MTG. Таких пар на арене должно быть мало, особенно на ранних рядах.

### Gaps
- Нет опубликованного правила числа комбинаций на новый атом ни у Nintendo, ни у Valve, ни у MTG.
- Подробности Hades о рекомбинации обычных врагов (броня Элизия, «Exalted») из первичных источников не проверял.

## Что это значит для Ashen Oath

Всё ниже — **[вывод]**, эвристика на 15.10.2026. Числа не калиброваны людьми. Правила — кандидаты для решения дизайна. Реализация любой части, меняющей бой, — ключ `Params` или поле снаряжения ряда / флаг сохранения похода; по умолчанию — прежнее поведение; выводы `forest/` не меняются; без текстовых табличек; HUD 1280×720 не растёт.

### А. Счётная единица: «живой элемент» (ЖЭ) и три счёта на арену

Опора: три вида комплексити MTG (понимание / поле / стратегия), счёт элементов CLT с поправкой на знания игрока (Chen, Paas & Sweller 2023), предел слежения (Pylyshyn & Storm; Franconeri), кривые обучения DataShop.

**Живой элемент** — правило, которое игроку надо знать **и** учитывать в этом бою, чтобы не ошибиться. Кандидаты: каждый вид врага с особым поведением на поле (обычный — 0), поведение элиты, каждый аффикс, пластины и окно элиты, особая местность (обрыв, река, терновник, жаровня, кристаллы, проклятый сундук), тип цели, если он не «убей N», риск гоблина (перебор), каждый талисман-счётчик, который срабатывает в бою по условию. Пассивные эффекты (числа, мягкое касание, второе дыхание) — не ЖЭ (lenticular: работают без понимания).

Три счёта на арену (на конкретного зрителя):
1. **Новые (понимание)** — ЖЭ, которых зритель ещё не встречал. Вес — по прежней шкале 0–3 ([research-complexity.md](../../research-complexity.md), 2.1). Это то, что уже считает правило-бюджет 1.
2. **Неукрупнённые (отслеживание)** — ЖЭ, по которым у зрителя кривая ошибок ещё не упала. Предварительно, до данных: элемент укрупнён после K боёв, где он был, без ошибки в последнем (K = 3 — ориентир). Каждый такой ЖЭ — 1, быстрые угрозы (окно реакции < 1 с: сапёр 0,8 с, запал перебора 0,6 с) — 1,5.
3. **Флаги поля (взаимодействие)** — пары ЖЭ на арене, где один меняет правило другого: шаман × слабые, Хамелеон × цепь, щитоносец × жаровня, гоблин × толпа (взрыв в толпе), талисман-счётчик × цепь. Счёт — число таких пар (аналог флага MTG «affects other cards in play» и «интерконнект» Rosewater 2025).

Почему так, а не одна сумма: Rosewater 2025 показывает, что упрощение отдельных механик не спасает, если растёт их число и связи; Riot разделяет механику, знания и «игру против»; CLT говорит, что тот же элемент дешевеет с опытом. Одна сумма весов (13.10) ловит только первое.

Где взять данные: `newSeen` и `firsts` дают счёт 1; журнал команд и записи боя дают попытки и ошибки для счёта 2 (повтор журнала с инструментами, хэш не меняется); состав арены (`sim/rosters.ts`, `sim/arenas*.ts`, снаряжение ряда) — для счёта 3, это можно посчитать статически в Node по 300 seed.

### Б. Правило-бюджет на бой и на ряд (кандидат)

На бой (дополняет правила 1–3 и 10–11 из отчёта «Кривые…»):
- **Б-1. Новые:** вес ≤ 3, не больше одного тяжёлого (как сейчас). Опора: Portal, Linehan, Pollock.
- **Б-2. Неукрупнённые:** ≤ 4 для рядов 1–4 первого похода; бой с новым ЖЭ — ≤ 3 (место для новинки). Опора: Cowan ~4, Pylyshyn & Storm 4–5 и падение предела с темпом. Позже предел сам растёт, потому что элементы укрупняются, — отдельного «ряд 7 → 6 элементов» не нужно.
- **Б-3. Флаги поля:** ряды 1–3 — 0; ряды 4–6 — ≤ 1; дальше — ≤ 2; новый флаг (первая встреча пары) — не в одном бою с новым ЖЭ. Опора: MTG «влияет на другие карты» как красный флаг common; State of Design 2025; урок TFT (ядро цепи — самая трудная система).
- **Б-4. Сборка в счёте:** талисманы-счётчики идут в счёт 2 так же, как враги. Если бой выходит за Б-2 из-за сборки — это выбор игрока, его не режут, но **навязанное** на этом ряду не должно рассчитывать на свободный слот. Опора: Riot — «за» может быть сложным, «против» — нет.

На ряд (на пул арен ряда, первый поход):
- **Р-1. Объём пула:** число разных ЖЭ, которые ряд может показать, — не больше прошлого ряда + 1–2. Опора: ротация MTG «only so much exists at any one time»; Bloomburrow 10 → 5.
- **Р-2. Одна дуга на ряд:** не больше одного нового атома (дуга Cook) на ряд; остальная новизна ряда — новые пары (петли). Это уже близко к «одна новинка на ряд», но явно разрешает новизну сочетаний, когда атомов нет.
- **Р-3. Провал при дуге:** бой первой встречи атома — в провале давления (Linehan; уже в отчёте). Добавление: ряд после дуги — только практика с **одним** знакомым партнёром (isolate-then-combine), тройки — через ряд.

### В. Темп

- **Т-1. Пила по атомам, лестница по парам.** Первый поход: дуги (новые атомы) по одной на ряд, в провале. Второй и следующие: новые пары и повороты, атомов нет — пока не придёт новый биом. Опора: Linehan; Cook loops/arcs; Hayashida.
- **Т-2. Колокол для сборки.** Пул талисманов — по колоколу Riot: несколько «работают сами» (вес 0), большинство — с одним понятным условием, несколько — сложных счётчиков. Сложные — не в первых предложениях похода (как «полный дар» со второго похода). Опора: Riot 2020, MTG (сложное — на редких).
- **Т-3. Повороты на ступенях «Испытания».** IV–V — новые ходы знакомых врагов (одна правка на ступень), а не новые виды. Опора: Hades Extreme Measures, StS A17–A19 (оба — гайды/вики, **[слабо]**).
- **Т-4. Повтор после перерыва.** Если зритель не играл ≥ 7 дней (ориентир), подписи первой встречи (`newSeen`) и подписи у места один раз показываются снова; счёт 2 сбрасывает укрупнение «точностных» атомов цепи раньше моторных. Опора: Arthur 1998 (когнитивные и точностные навыки гаснут быстрее), Cepeda 2006. Это только вид; правила боя не меняются.
- **Т-5. Структуры для укрупнения.** Новизну сочетаний подавать **узнаваемыми составами** (именованные `rosters`), а не случайной смесью: структурное укрупняется, случайное — нет. Опора: Chase & Simon 1973.

### Г. Можно ли выстроить комплексити из того, что есть

Да, и это дешевле, чем новые атомы. Пространство пар уже ≥ 36 (пары видов) плюс аффиксы, поведения элит, местность, цели и гоблин. Порядок:
1. Посчитать в Node по 300 seed для пологого похода три счёта (А) по рядам: где Б-2 и Б-3 нарушены, сколько новых пар даёт каждый ряд. Только чтение, без правил.
2. По Doom выбрать «хорошие пары» — с разным приоритетом угроз — и поставить их в пулы рядов 6–10 как именованные составы; «плохие» (одинаковая реакция, или взаимное изменение правил на ранних рядах) — убрать с рядов 1–5.
3. Включить кривые обучения по атомам (А, счёт 2) в отчёт телеметрии: попытки, ошибки, наклон. Это же даёт «гашение» Cook (А3 из отчёта «Кривые…»).
4. Только после этого решать, нужен ли гарнизону новый атом или хватит поворотов.

### Д. Чего не делать

- Не вводить game refinement (GR) и «decisions per minute» как цели: допущения не проверены (раздел 6).
- Не считать одну сумму «веса нового»: она пропускает объём и связи (Rosewater 2025).
- Не закреплять в тестах числа бюджета как приёмку поведения бота: это эвристика с датой (AGENTS.md).

### Открытые вопросы пользователю

1. Принять единицу «живой элемент» и три счёта (новые / неукрупнённые / флаги поля) вместо одной суммы весов?
2. Считать ли талисманы-счётчики в бюджете арены (Б-4) — и нужен ли потолок числа таких талисманов в сборке (сейчас явного потолка не нашёл)?
3. Повороты врагов на ступенях IV–V «Испытания» вместо плотности — направление для следующих ступеней?
4. Повтор подписей после перерыва (Т-4) — допустим ли с учётом решения «не перегружать экран»?
