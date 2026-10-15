# Предметы The Binding of Isaac: Repentance: смена стиля игры при сохранении идентичности (15.10.2026)

Источники и их сила:
- **[сильный] Файлы игры.** Repentance v1.7.9b. Это вывод официального ResourceExtractor в `D:\ashen_research\games\isaac\extracted\`: `resources-dlc3\items.xml`, `items_metadata.xml` (поле `quality`, теги), `itempools.xml`, `costumes2.xml`, `resources\playerforms.xml`, `resources\stringtable.sta` (английские строки). Отдельно — `copy\changelog.txt` (официальный журнал правок v1.7.4–v1.7.9b).
- **Скрипты разбора** (только чтение): `D:\ashen_research\scripts\isaac_items.py` → `isaac_items.json`; `isaac_attack.py`, `isaac_extra.py`. Сырые файлы в репозиторий не копировались. Ниже только числа и короткие цитаты.
- **[средний] Вики** `bindingofisaacrebirth.wiki.gg`. Это официальная вики сообщества. Fandom-зеркало ответило HTTP 402 и не читалось. Описания механик взяты с вики, числа по возможности сверены с файлами.
- **[средний/слабый] Разработчики.** Постмортем McMillen (Game Developer, 2012) прочитан. Остальные слова разработчиков найдены только через сводки поиска и помечены как непроверенные.
- Платформа platinumgod.co.uk и GDC-доклады в этой сессии не прочитаны (см. «Пробелы»).

Классы предметов атаки. Это моя разметка по описаниям, **[вывод]**:
- **R — носитель.** Заменяет слезу другим носителем урона: лучом, ножом, бомбой, мечом, кольцом, управляемой слезой, плодом.
- **C — управление и форма выстрела.** Заряд, удержание, прицел, мультивыстрел, направление.
- **A — второй носитель.** Добавляется к слезам: второй лазер, огонь, молния.
- **T — траектория или поведение слезы.** Самонаведение, отскок, орбита, разделение.
- **act — активный предмет.** Разовая смена атаки по кнопке.

## 1. Какие предметы меняют форму атаки, а не числа; доля, качество, пулы, частота за забег

### Takeaway
В Repentance 16 предметов заменяют носителя атаки (класс R). Это 2,2% от 721 предмета, но 9 из 40 предметов качества 4. Ни одного из них нет в пуле босса. В пуле сокровищницы их суммарный вес — 2,4%, поэтому за забег игроку предлагают в среднем меньше одного такого предмета. Общее у всех: кнопка и направление стрельбы те же, урон по-прежнему считается от характеристики «Damage». Меняется носитель (луч, нож, бомба) и ритм нажатия (заряд, удержание).

### Cited Findings
- **Всего предметов.** В `items.xml` 721 коллекционный предмет: 425 пассивных, 170 активных, 126 спутников. Качество из `items_metadata.xml`: q0 — 51, q1 — 197, q2 — 249, q3 — 184, q4 — 40 — [файлы игры, isaac_items.py](D:\ashen_research\scripts\isaac_items.py)
- **Класс R** (качество; пулы и вес; строка подбора):
  - Brimstone (q4; devil 1, ultraSecret 1; «Blood laser barrage»);
  - Mom's Knife (q4; devil 1, treasure **0.2**; «Stab stab stab»);
  - Dr. Fetus (q4; treasure 1; «???»);
  - Epic Fetus (q4; secret 1, treasure **0.1**; «On-demand air strike»);
  - Technology (q3; treasure; «Laser tears»);
  - Tech X (q4; treasure; «Laser ring tears»);
  - The Ludovico Technique (q2; treasure; «Controlled tears»);
  - Spirit Sword (q3; angel; «Divine blade»);
  - C Section (q4; treasure, ultraSecret; «Fetus shots»);
  - Ipecac (q4; treasure; «Explosive shots»);
  - Haemolacria (q4; treasure, ultraSecret);
  - Trisagion (q3; angel; «Smite thy enemy»);
  - Neptunus (q3; planetarium);
  - Revelation (q4; angel);
  - Monstro's Lung (q2; treasure; «Charged burst attack»);
  - Technology 2 (q2; treasure; «Extra laser»).

  Источник: [файлы игры, isaac_attack.py](D:\ashen_research\scripts\isaac_attack.py)
- **Классы C, A, T, act** — [файлы игры](D:\ashen_research\scripts\isaac_attack.py):
  - **C, 17 предметов:** Chocolate Milk q3, Cursed Eye q0, Marked q1, Soy Milk q2, Almond Milk q1, Anti-Gravity q2, Eye of the Occult q3, Tractor Beam q3, Lead Pencil q3, The Wiz q0, Loki's Horns q1, Mom's Eye q1, Kidney Stone q2, Polyphemus q4, The Inner Eye q2, Mutant Spider q3, 20/20 q4;
  - **A, 11 предметов:** Tech.5, Jacob's Ladder, Ghost Pepper, Bird's Eye, Godhead q4, Holy Light, Eye of Belial, Technology Zero, Evil Eye, Brimstone Bombs, Azazel's Rage;
  - **T, 17 предметов:** Tiny Planet q0, Strange Attractor q0, Rubber Cement, Flat Stone, Continuum, My Reflection, Spoon Bender, Sacred Heart q4, Lachryphagy, Tooth and Nail, Mysterious Liquid, The Parasite, Cricket's Body, Proptosis, Dead Eye, Glitter Bombs и др.;
  - **act, 7 предметов:** Tammy's Head («Reusable tear burst»), Berserk! («Rip and tear»), Larynx, Bob's Rotten Head, Glass Cannon, Mom's Bracelet, Sharp Straw.
- **Качество класса R:** 9 предметов q4, 4 — q3, 3 — q2. Носители составляют 9 из 40 предметов q4 (22,5%). Если добавить Polyphemus, 20/20, Sacred Heart и Godhead, предметы формы атаки дают 13 из 40 q4 — [файлы игры](D:\ashen_research\scripts\isaac_extra.py)
- **Доля веса класса R в пулах.** Вес выбора в пуле равен `Weight` / сумма весов:
  - treasure — 2,4% (11 предметов; всего в пуле 407 предметов, сумма весов 392,3);
  - devil — 2,3% (Brimstone, Mom's Knife);
  - angel — 4,7% (Spirit Sword, Trisagion, Revelation);
  - secret — 1,6% (Epic Fetus);
  - planetarium — 9,1% (Neptunus, 1 из 11 предметов);
  - ultraSecret — 3,2%;
  - **boss — 0%.**

  Доля класса C в treasure — 4,1%, класса T — 4,1%, класса A — 1,6% — [файлы игры](D:\ashen_research\scripts\isaac_attack.py)
- **Пул босса:** только пассивные предметы, по качеству q1 — 26, q2 — 14, q3 — 17, q0 — 2. Ни одного предмета класса R или C — [файлы игры](D:\ashen_research\scripts\isaac_extra.py)
- **Среднее взвешенное качество по пулам:** treasure 1,78; boss 1,78; shop 1,86; devil 2,19; secret 2,30; planetarium 2,45; angel 2,53. Доля веса q≥3: treasure 23,6%, devil 41,1%, angel 57,1% — [файлы игры](D:\ashen_research\scripts\isaac_attack.py)
- **Механика пула.** Шанс предмета равен весу, делённому на сумму весов пула. Почти у всех предметов вес 1. Показанный предмет убирается из пула сокровищницы полностью: срабатывает уже показ, а не подбор. Взятый предмет «remove[d] from all item pools». Пустой пул берёт предмет из treasure. Пустой treasure даёт только Breakfast — [wiki.gg: Item Pool](https://bindingofisaacrebirth.wiki.gg/wiki/Item_Pool)
- **Правки пулов в журнале.** v1.7.9 (04.11.2022): «Added Epic Fetus to the treasure pool (at very low weight)» и «Added C Section to the Ultra Secret room pool» — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt)
- **Особые предметы.** До Repentance 13 предметов считались «special». Если игрок видел другие особые предметы, они выпадали реже. Repentance убрал эту механику и заменил её весами и качеством — [wiki.gg: Items](https://bindingofisaacrebirth.wiki.gg/wiki/Items). Brimstone в Repentance «stopped being a "special item"» — [wiki.gg: Brimstone](https://bindingofisaacrebirth.wiki.gg/wiki/Brimstone)
- **Где игра читает качество** (по вики): Sacred Orb перебрасывает q0 и q1 и с шансом 33% q2; Tainted Lost с шансом 20% перебрасывает q≤2; Poker Chip поднимает качество предмета из сундука на 1; ещё Bag of Crafting и Birthright Tainted Bethany (q≥3). Общего правила качества для сокровищницы вики не указывает — [wiki.gg: Quality](https://bindingofisaacrebirth.wiki.gg/wiki/Quality)
- **Носитель меняется, кнопка и формула остаются.**
  - Brimstone: заряд зависит от скорострельности; урон тика `6 × Damage / (Tear Delay + 1)`; в Repentance луч бьёт 9 тиков за ~0,63 с;
  - Mom's Knife: нож «replaces Isaac's tears», бьёт 20 раз в секунду при контакте; в Repentance урон 2× от Damage при удержании и 6× примерно на трети заряда.

  Источники: [wiki.gg: Brimstone](https://bindingofisaacrebirth.wiki.gg/wiki/Brimstone), [wiki.gg: Mom's Knife](https://bindingofisaacrebirth.wiki.gg/wiki/Mom%27s_Knife)
- **Кэш `weapon`** в `items.xml` есть только у 5 предметов: Technology 2, Trinity Shield, Haemolacria, Spirit Sword, C Section. Кэш `tearflag` (флаги поведения слезы) — у 53. Значит, в данных «оружие» не выделено отдельной сущностью: большинство носителей — это флаги и код, а не поле XML — [файлы игры](D:\ashen_research\scripts\isaac_attack.py)

### Inferences
- **[вывод] Носитель — редкое событие.** Модель: за забег показывают 8 предметов treasure, 4 devil, 2 angel, 1 secret и по 0,3 planetarium и ultraSecret. Рероллы, магазины и нищие не учтены. Тогда игрок в среднем видит 0,43 предмета R, и P(≥1) ≈ 0,35. Для R+C: в среднем 0,82, P(≥1) ≈ 0,57. Расчёт — `isaac_extra.py`. Носитель — событие примерно одного забега из трёх, а не каждого. Поэтому он и запоминается.
- **[вывод] Носители спрятаны за риском.** Пул босса — гарантированная награда этажа — носителей не содержит. Носители лежат там, где платят риском: devil (сердца), angel (отказ от devil), secret и ultraSecret (поиск), planetarium (отказ от сокровищниц). Самые ломающие носители получили особо низкий вес в treasure: Mom's Knife 0,2, Epic Fetus 0,1.
- **[вывод] Качество — ручка частоты, а не силы.** Носителей держат на q4, а предметы с недостатками — на q0 (Cursed Eye, The Wiz, Tiny Planet, Strange Attractor). Механики, читающие качество (Sacred Orb, Tainted Lost), отсекают q0 и q1. Так игра отделяет «меняет игру» от «мешает».

### Gaps
- Нет надёжных данных о реальном числе предметов за забег. Поиск дал только форумы, без датасета. Модель выше — оценка.
- Не проверено, применяет ли Repentance скрытое правило качества к сокровищнице на поздних этажах. Вики-страница Quality его не упоминает.
- Список 13 «special items» до Repentance не получен (страница Special_Items на wiki.gg — 404).

## 2. Синергии: как два меняющих предмета сочетаются и как игра решает конфликты

### Takeaway
Политика менялась с выпусками. В Rebirth один носитель **перекрывал** другой. В Afterbirth и Afterbirth † оба часто **стреляли параллельно**. В Repentance их всё чаще **сплавляют** в новое поведение: нож плюс Brimstone даёт веер ножей, Brimstone плюс Tech X — кольцо-луч, Ludovico делает из любого носителя управляемый. Порядок приоритета есть, но у «победителя» обычно появляется черта проигравшего. Цена — длинный хвост ошибок: петли, вылеты, урон по себе. Журнал правок Repentance чинит их почти в каждой версии.

### Cited Findings
- **Brimstone в парах:**
  - Mom's Knife «has priority»; после главного ножа летит веер ножей;
  - Brimstone перекрывает Dr. Fetus (в Afterbirth и † бомбы стреляли во время заряда);
  - в Rebirth Epic Fetus перекрывал Brimstone, позже ракеты получили взрыв-луч;
  - в Rebirth Brimstone перекрывал Technology, позже лазер «coils around the beam» с множителем 1,5×;
  - Tech X «has priority» и стреляет кольцом Brimstone;
  - у Ludovico приоритет: получается управляемое кольцо без заряда;
  - Brimstone перекрывает Spirit Sword;
  - с C Section луч выпускает 4 плода;
  - Ludovico полностью отключает C Section.

  Источник: [wiki.gg: Brimstone](https://bindingofisaacrebirth.wiki.gg/wiki/Brimstone)
- **Mom's Knife в парах:**
  - Dr. Fetus: нож перекрывает бомбы, кроме Afterbirth и †, где «both the knife and the bombs fire normally»;
  - Technology: перекрыт в Rebirth и Afterbirth; в † оба стреляют; в Repentance между героем и ножом идёт лазер;
  - Tech X: в Repentance нож летит с кольцом;
  - Ludovico: нож парит, им управляют;
  - Spirit Sword: меч можно бросать;
  - C Section: плоды несут ножи.

  Отдельно на вики есть списки предметов, которые нож перекрывает (Cursed Eye, Evil Eye, Kidney Stone, Trisagion…), и тех, у кого остаются только характеристики (Anti-Gravity, Cricket's Body, Eye of Belial, Marked…) — [wiki.gg: Mom's Knife](https://bindingofisaacrebirth.wiki.gg/wiki/Mom%27s_Knife)
- **Сплавление в журнале.** v1.7.5 (10.11.2021): «Mom's Knife now synergizes with Technology and Tech X»; «Techstone (Tech+Brimstone) lasers now have a large and giant variant». У сочетания есть своё имя — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt)
- **Цена комбинаторики** — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt):
  - **бесконечные петли и вылеты:** «infinite loop caused by Haemolacria + Sad Bombs + Dr. Fetus»; «rare freeze caused by Trisagion + Continuum»; «C Section synergies with melee weapons creating more fetuses (causing loops/crashes)»; «crash … Mom's Knife + Tiny Planet»;
  - **предел размножения:** v1.7.7, C Section + Technology копируют себя лишь с шансом от удачи, «to prevent infinite loops»;
  - **урон по себе и неизбежный урон:** v1.7.4, «Brimstone/Technology+Ipecac+Ludovico now only starts exploding 1 second after entering a room … (this could cause unavoidable damage)»; v1.7.7, «Ipecac + Hemoptysis no longer deals damage to players»;
  - **тройные сочетания:** v1.7.8, «Fixed Brimstone+Anti Gravity+Soy Milk not working as intended»; «Fixed Dr. Fetus + Marked + Eye of the Occult not moving fired bombs towards the crosshair».
- **McMillen об устройстве предметов (2011):** «70 percent of the items in Isaac stack, and all the item abilities will affect Isaac in some way» — [Game Developer: Postmortem](https://gamedeveloper.com/business/postmortem-mcmillen-and-himsl-s-i-the-binding-of-isaac-i-)

### Inferences
- **[вывод] Три политики конфликта:** перекрытие (просто, но второй предмет становится мёртвым), параллельная стрельба (просто, но шумно и без новой формы) и сплав (дорого, но даёт открытия). Isaac пришёл к сплаву, когда предметов стало больше 500. Перекрытие осталось там, где сплав не придуман.
- **[вывод] Идентичность держится инвариантами:** одна кнопка стрельбы в 4 направлениях; урон от одной характеристики Damage; скорострельность задаёт заряд или частоту. Поэтому любой носитель «понимает» любой модификатор слезы (яд, самонаведение, разделение), и сплав можно описать по формуле, а не вручную.
- **[вывод] Для детерминированной симуляции сплав опаснее, чем для Isaac.** Петли размножения (C Section, Haemolacria) нужно ограничивать бюджетом на событие сразу, а не чинить потом.

### Gaps
- Прямых слов McMillen или Nicalis о том, *почему* выбран приоритет или сплав, не найдено. Поиск интервью 2014 года о синергиях вернул только анонсы контента.
- GDC-доклады McMillen об Isaac в этой сессии не найдены и не прочитаны.

## 3. Трансформации: набор из 3 предметов одной темы меняет героя

### Takeaway
Трансформация — это 3 разных предмета с одним тегом. Она даёт облик (костюм) и одно правило: полёт, мух на попадание, стоячий нож, сердца. Наборы тем широкие (от 4 до 31 предмета), поэтому трансформация вознаграждает выбор «брать по теме», а не охоту за конкретным предметом. Атаку меняют лишь немногие: Guppy, Yes Mother?, Conjoined, Bookworm.

### Cited Findings
- **Устройство в данных.** `playerforms.xml`: 14 форм, у каждой есть `costume` и `tags`, у части — `cache` (у Guppy — «flying tearflag»). Число предметов с тегом в `items_metadata.xml`: guppy 7, fly 24, mushroom 10, angel 17, bob 4, syringe 8, mom 21, baby 31, devil 11, poop 10, book 15, spider 16. У Adult и Stompy тега нет, они идут от пилюль — [файлы игры](D:\ashen_research\scripts\isaac_items.py)
- **Правила.** Нужно минимум 3 разных предмета набора. Предмет достаточно «acquired once». В Repentance трансформация теряется, если предметы «rerolled or otherwise lost». Активные предметы считаются, даже если их потом сменили. В Repentance дубликаты считаются. Несколько трансформаций складываются — [wiki.gg: Transformations](https://bindingofisaacrebirth.wiki.gg/wiki/Transformations)
- **Эффекты:**
  - Guppy — полёт и синяя муха при попадании слезой;
  - Beelzebub — полёт, мухи становятся синими;
  - Seraphim — полёт и 3 сердца души;
  - Yes Mother? — нож, стоящий за героем, «synergizes like Mom's Knife»;
  - Conjoined — две диагональные опухоли, −0,3 урона и −0,3 скорострельности;
  - Bookworm — ~25% шанс лишней слезы;
  - Spun — +2 урона и скорость;
  - Fun Guy и Adult — +1 контейнер;
  - Leviathan — полёт и 2 чёрных сердца.

  Источник: [wiki.gg: Transformations](https://bindingofisaacrebirth.wiki.gg/wiki/Transformations)
- **Правки.** До v1.7.5 Brimstone не входил в Leviathan, вики называет это «ironic» — [wiki.gg: Brimstone](https://bindingofisaacrebirth.wiki.gg/wiki/Brimstone)

### Inferences
- **[вывод] Слабый предмет темы получает вторую ценность** как «шаг к форме». Трансформация — счётчик, но заметный: виден облик, а награда — новое правило, а не +%.
- **[вывод] Награда трансформации в основном защитная или передвижения** (полёт, сердца). Атаку она меняет мягко, добавкой. Носитель остаётся работой отдельных предметов, и формы не спорят с ним за приоритет.

### Gaps
- Не проверено, сколько игроков реально собирают трансформации и как часто. Телеметрии Isaac в открытом доступе не найдено.

## 4. Как игрок понимает новый предмет без текста

### Takeaway
У каждого предмета есть имя и строка подбора в среднем из 3 слов. У 71% пассивных предметов есть костюм, видимый на герое. У носителей новая атака видна с первого выстрела. Описаний правил в игре нет: это решение автора ради «тайны». Сообщество спорит о нём, а игроки пользуются вики.

### Cited Findings
- **Строка подбора.** Все 721 предмет имеют её (`description` → `stringtable.sta`): медиана 3 слова, среднее 2,9, максимум 13. Примеры: «Blood laser barrage», «Stab stab stab», «???» у Dr. Fetus — [файлы игры](D:\ashen_research\scripts\isaac_extra.py)
- **Костюмы.** У 45% всех предметов и у 71% пассивных есть файл костюма с номером предмета в `costumes2.xml`. У носителей — 12 из 16. Без такого файла остались Mom's Knife, Spirit Sword, Neptunus и Revelation, но нож и меч видны как само оружие. Сопоставление шло по префиксу имени `.anm2`, поэтому это нижняя оценка — [файлы игры](D:\ashen_research\scripts\isaac_items.py)
- **Подход McMillen.** Он ссылается на Zelda: «You weren't sure what things did until you experimented with them». Предметы сделаны так, чтобы у героя была «some kind of physical growth» — [Game Developer: Postmortem](https://gamedeveloper.com/business/postmortem-mcmillen-and-himsl-s-i-the-binding-of-isaac-i-)
- **[слабый, не проверен]** По сводке поиска, McMillen провёл в Twitter опрос о внутриигровых описаниях: 35% против («take away from the game»), 35% за, 20% всё равно, 10% «really hurting the game». Он же говорил о игроках, которые «just want to know how to break the game». Сводка ссылалась на Vice. Прочитанная статья Vice к 10-летию этих цитат **не содержит**, вторая статья ([Vice: exit stage left](https://vice.com/en/article/exit-stage-left-trying-to-escape-the-shadow-of-the-binding-of-isaac)) не открывалась.

### Inferences
- **[вывод] Доля предметов, чей эффект виден сразу.** Носители (R, 16) и большинство форм выстрела (C) видны с первого нажатия. Модификаторы T видны после первого попадания. Пассивы-характеристики не видны вовсе. По моей разметке примерно 45 из 721 предмета (около 6%) меняют вид атаки так, что это понятно без текста, — это оценка, а не замер.
- **[вывод] Три канала, ни один не объясняет правило:** имя и строка — тон и намёк; костюм — «я изменился»; новая атака — «как теперь играть». Нам подходит то же: имя, строка в одну фразу, видимая смена носителя. Подробности — по запросу. Это совпадает с правилом интерфейса проекта.

### Gaps
- Нет данных о том, как быстро новички понимают носителей (плейтестов Nicalis в открытом доступе нет).

## 5. Плохие примеры: предметы, которые ломают игру или делают её скучной, и что чинили патчами

### Takeaway
Есть два вида «плохих» предметов. Первый — **ловушки**: смена атаки ухудшает игру. Их метят q0, чтобы фильтры качества их отсекали (Cursed Eye, The Wiz, Tiny Planet, Strange Attractor). Второй — **сломанные сочетания**, где носители умножают друг друга. Nicalis чинит такие сочетания численными правками, пределами частоты и разрывом петель, а не удалением предметов.

### Cited Findings
- **Предметы q0** среди пассивных: Tiny Planet, Strange Attractor, Cursed Eye, The Wiz, Missing No., TMTRAINER, IBS и др. (всего 23 пассивных q0) — [файлы игры](D:\ashen_research\scripts\isaac_extra.py)
- **Soy Milk:**
  - до Repentance задержка слезы `(delay / 4) − 2`, урон ×0,2;
  - в Repentance скорострельность ×5,5, урон ×0,2, отдача слёз «drastically» снижена;
  - с Brimstone в Repentance это уже синергия: луч непрерывный, его можно поворачивать;
  - с Mom's Knife «no special synergy».

  Источник: [wiki.gg: Soy Milk](https://bindingofisaacrebirth.wiki.gg/wiki/Soy_Milk). Сама вики не называет Soy Milk «ломающим» — это частое мнение игроков, источника я не нашёл.
- **Правки силы в журнале** — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt):
  - v1.7.9: «C Section fetuses now only deal 75% damage every 10 frames (from 100% damage every 8 frames)». Это −40% урона в секунду, мой расчёт;
  - v1.7.9: «20/20 now only decreases damage by -20% (from -25%)»;
  - v1.7.5: «Capped the proc rate of Ghost Pepper and Bird's Eye to 50% (holding both removes the cap)»;
  - почти в каждой версии: «Updated various item qualities» / «Rebalanced the quality value of several items».
- **Предмет без действия заменили.** В v1.7.9 переделаны «мёртвые» предметы с реакцией на урон: Athame, Betrayal, My Shadow. My Reflection получил +урон и −удачу, Ouija Board — +скорострельность — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt)
- **Mom's Knife в Repentance:** урон переделан (6× примерно на трети заряда, дальше заряд растит только дальность), убрана кадровая диагональная стрельба — [wiki.gg: Mom's Knife](https://bindingofisaacrebirth.wiki.gg/wiki/Mom%27s_Knife)

### Inferences
- **[вывод] Скучно — когда носитель делает «нажал и всё умерло» на весь экран** (Soy Milk с Ipecac и Technology вики называет «extremely safe method of clearing most rooms») либо когда носитель отключает второй предмет без замены (перекрытие).
- **[вывод] Ловушку оставляют в игре, но метят:** q0 — сигнал для фильтров и для опытных игроков. У нас такая метка значила бы, что предмет не ставится в награду с выбором из двух.

### Gaps
- Не найдены патчноты Rebirth, Afterbirth и Afterbirth+ (до v1.7.4) с конкретными нерфами Brimstone, Mom's Knife и Soy Milk. Локальный `changelog.txt` начинается с v1.7.4.

## 6. Сколько меняющих предметов игрок держит за забег; как пулы и качество их дозируют

### Takeaway
По данным пулов носитель — редкость: за забег он встречается с вероятностью около 1/3. Носитель или форма выстрела — около 1/2. Дозирование идёт в три слоя: низкий вес в treasure, отсутствие в пуле босса, размещение в пулах с ценой (devil, angel, secret, planetarium). Так игрок обычно держит 0–1 носителя и пару модификаторов, а сплав двух носителей — заметное событие.

### Cited Findings
- **Числа пулов и вероятностей** — разделы выше; [файлы игры](D:\ashen_research\scripts\isaac_extra.py)
- **Показ убирает предмет:** показанный предмет полностью удаляется из пула treasure, а в Repentance и из пула магазина. Повтор одного носителя за забег невозможен без особых эффектов — [wiki.gg: Item Pool](https://bindingofisaacrebirth.wiki.gg/wiki/Item_Pool)
- **Правки ассортимента devil:** «Increased the average amount of items available for purchase in devil rooms» (v1.7.9), «Devil rooms are now more likely to have items for sale» (v1.7.5) — [changelog.txt игры](D:\ashen_research\games\isaac\copy\changelog.txt)

### Inferences
- **[вывод] Повторить для нас:** носитель — не базовая награда ряда, а награда за риск или за отказ от другого. Один носитель за поход — норма, два — праздник. Каталог носителей может быть маленьким (у Isaac всего 16), если каждый меняет игру кардинально.

### Gaps
- Нет открытой статистики, сколько носителей реально держат игроки.

## 7. Перенос на цепь: идеи «носителя атаки» для Ashen Oath

### Takeaway
Инвариант Isaac — «одна кнопка, один стат урона, меняется носитель». Наш аналог: **игрок выбирает цвет и ведёт цепь по звеньям, это главное действие; носитель меняет то, чем и когда бьются звенья**. Все идеи ниже — **[вывод]**. Каждая — будущий параметр `Params` со значением по умолчанию «прежний проход». Подсветка цепи (`planChain`) должна показывать то, что сделает носитель.

### Cited Findings
- Основа Ashen Oath: цепь — атака и основное перемещение; прыжок — для свободного перемещения — [docs/realtime-prototype.md](../../../realtime-prototype.md)

### Inferences
1. **[вывод] Луч (по Brimstone).** Герой не бежит по цепи. После заряда по построенной цепи проходит луч от героя через все звенья по порядку. Герой стоит, луч бьёт всё, что пересекает, включая чужой цвет. Цена: стоять во время заряда. Меняет игру с «прорыва сквозь орду» на «позицию и линию».
2. **[вывод] Брошенный клинок (по Mom's Knife).** Проход делает клинок: он летит по звеньям и возвращается к герою. Длина цепи ограничена «дальностью броска», которая растёт с зарядом. Удар по звену на обратном пути — слабее. Герой свободен, но без перемещения цепью.
3. **[вывод] Звенья-бомбы (по Dr. Fetus и Ipecac).** Проход метит звенья, через короткую задержку они взрываются. Взрыв с радиусом задевает соседей другого цвета. Цепь становится инструментом контроля толпы, урон отложен. Герой не должен стоять рядом.
4. **[вывод] Удар с неба (по Epic Fetus).** Цепь рисуется прицелом, а не героем. Звенья поражаются падающими ударами по очереди после метки. Герой не двигается цепью, поэтому прыжок становится главным перемещением.
5. **[вывод] Ведомый дух (по Ludovico).** Цепь ведёт дух-шар, которым управляет игрок, а герой стоит в укрытии. Шар бьёт звенья постоянно, без «прохода». Риск переходит с героя на позицию шара. Хорошо сплавляется с другими носителями: шар-луч, шар-клинок.
6. **[вывод] Кольцо (по Tech X).** Проход катит кольцо по цепи. Ширина кольца растёт с длиной цепи и задевает соседей любого цвета. Меняет ценность длинной цепи: длина равна площади.
7. **[вывод] Клинок вблизи (по Spirit Sword).** Цепь короткая (2–3 звена), зато каждое звено получает два удара. На полном заряде — бросок волны. Ближний бой, частые цепи.
8. **[вывод] Порождения (по C Section).** Каждое разбитое звено выпускает самонаводящегося духа. Дух ищет ближайшего врага *того же цвета* вне цепи. Цепь «дочищает» цвет сама. Нужен бюджет на событие против петель (урок v1.7.7).
9. **[вывод] Заряд (по Chocolate Milk и Cursed Eye).** Удержание перед проходом умножает урон по звеньям; отпуск рано — слабый проход. Вариант Cursed Eye с ловушкой: только полный заряд даёт N проходов подряд, а урон во время заряда отбрасывает героя.
10. **[вывод] Отложенная цепь (по Anti-Gravity).** Звенья копятся и висят, пока игрок не отпустит кнопку. Тогда все удары происходят разом. Можно собрать две цепи разных цветов и отпустить вместе. Ломает правило «один цвет», поэтому нужен отдельный инвариант.
11. **[вывод] Осколки (по Haemolacria).** Разбитое звено разлетается осколками в стороны, осколки бьют чужие цвета. Цепь одного цвета расчищает смешанную толпу вокруг.
12. **[вывод] Залп (по Tammy's Head, активный предмет).** Разовая кнопка с перезарядкой: все враги выбранного цвета в радиусе получают удар как звенья, без прохода. Аварийный выход, а не новый стиль.

**[вывод] Политика сочетаний для нас.** По умолчанию — сплав по формуле: носитель задаёт «как доставлен удар», модификаторы задают «что делает удар» (яд, осколки, порождения). Перекрытие допустимо только между двумя носителями, и с явным приоритетом в данных. Подсветка цепи обязана показывать результат сплава. Петли размножения ограничиваются бюджетом на один проход.

**[вывод] Дозирование.** Носители редки (≈1 за поход), их нет в гарантированной награде ряда, они стоят риска или отказа. Ловушки помечаются и не попадают в выбор из двух.

### Gaps
- Нет плейтеста: какие носители сохраняют «чувство цепи», а какие превращают игру в другую. Решение за пользователем и плейтестом.
- Не проверено, как носители 1, 4 и 5 (герой не двигается цепью) сочетаются с текущими целями арен (кнопки «на конце цепи», дверь). Возможно, нужна оговорка «конец цепи — точка носителя».
