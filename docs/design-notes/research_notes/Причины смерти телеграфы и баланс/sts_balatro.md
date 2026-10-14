# Slay the Spire и Balatro: телеграфы угроз, объяснение поражения, баланс сложности

Заметки исследователя, 14.10.2026. Обозначения источников:
- **[код Balatro]** — Lua-исходник из локальной копии `Balatro.exe` (zip внутри exe), версия из `globals.lua`: `VERSION = '1.0.1o'..'-FULL'`. Распакован в scratchpad сессии; игра не запускалась, Steam-папка не менялась. Ссылки вида `файл:строка`.
- **[локальные забеги StS]** — файлы `*.run` пользователя в `C:\Program Files (x86)\Steam\steamapps\common\SlayTheSpire\runs\` (35 забегов, `build_version: "2022-12-18"`). Прочитаны только поля и агрегаты.
- **[wiki]** — числа с slaythespire.wiki.gg; это вики, не код.
- **Важно:** бинарников Slay the Spire на диске нет. В папке `SlayTheSpire` лежат только `preferences/`, `saves/`, `runs/`, `betaPreferences/`, `sendToDevs/` (2,7 МБ); `desktop-1.0.jar` не найден ни там, ни в `D:\SteamLibrary`. Поэтому ссылок на классы StS из кода нет: данные StS — вики, публичные источники и формат локальных файлов забегов.

## 1. Телеграфирование угроз

### Takeaway
StS показывает намерение каждого врага на следующий ход: иконка класса действия и, для атаки, число урона (за удар × число ударов). Неизвестное прячется за отдельной иконкой «Unknown», а не под ложной иконкой. Balatro показывает босса анте и его правило ещё до первого блайнда, цель очков — на каждом блайнде, а «рука не засчитается» — до розыгрыша, при выборе карт.

### Cited Findings
**Slay the Spire — намерения (intents)**
- Намерение «telegraph[s] an enemy's actions on their upcoming turn». Типы: Attack, Defend, Attack+Defend, Debuff, Strong Debuff («Powerful Debuff»), Debuff+Attack, Debuff+Defend, Buff, Buff+Attack, Defend+Buff, Escape, Sleep, Stunned, Unknown — [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent).
- Иконка атаки меняется по силе удара — 7 ступеней: 0–4, 5–9, 10–14, 15–19, 20–24, 25–29, «30 or more». У комбинированных иконок (атака+блок/дебафф/бафф) 6 вариантов оружия по урону — [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent). То есть размер угрозы кодируется дважды: числом и формой иконки.
- Многоударная атака записывается как «урон за удар × число ударов». Пример: Awakened One «Deal 6 x 4 damage»; игроки отмечают, что 9x4 ≠ 4x9 — [Steam-обсуждение](https://steamcommunity.com/app/646570/discussions/0/1692659769948918101), [wiki Awakened One (fandom)](https://slay-the-spire.fandom.com/wiki/Awakened_One).
- «Unknown» используется для действий без урона, которые трудно нарисовать: деление (большие слизни, Slime Boss), взрыв (Shapes), призыв, перерождение Awakened One, ничегонеделание — [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent).
- Где намерение «врёт» или неполно: лечение у Mystic, Time Eater и Darklings показано иконкой Buff; Writhing Mass (Reactive) меняет намерение случайно при каждом получении атакующего урона — [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent).
- Реликвия Runic Dome скрывает все намерения (показывает Unknown) в обмен на +1 энергию за ход — [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent). Скрытие намерений — это цена, которую игрок выбирает сам.
- Скрытая угроза пассивного правила видна как статус на враге: Gremlin Nob первым ходом всегда делает Bellow (иконка Buff) и получает Enrage — «Whenever you play a Skill card, gains X Strength» (X = 2, на A18 — 3) — [wiki: Gremlin Nob](https://slaythespire.wiki.gg/wiki/Gremlin_Nob).
- Паттерны врагов ограничены правилами против неудачных серий: Gremlin Nob не делает Bull Rush 3 раза подряд; Jaw Worm всегда открывает бой Chomp, после двух Thrash подряд вероятности меняются (Bellow 64 %, Chomp 36 %) — [wiki: Gremlin Nob](https://slaythespire.wiki.gg/wiki/Gremlin_Nob), [wiki: Jaw Worm](https://slaythespire.wiki.gg/wiki/Jaw_Worm). В докладе GDC 2019 есть раздел о предсказуемости паттернов атак врагов («predictable enemy attack patterns»); деталей в доступных пересказах нет — [podwise: конспект доклада](https://podwise.ai/episodes/1459444).

**Balatro — блайнды и босс**
- Босс анте выбирается при старте анте: `self.GAME.round_resets.blind_choices.Boss = get_new_boss()` [код Balatro: `game.lua:2177`, `functions/common_events.lua:2333`]. Экран выбора блайнда показывает все три блайнда анте (Small, Big, Boss); у каждого — название, текст правила (`loc_target` из `raw_descriptions`), «Score at least» с целью и награда [код Balatro: `functions/UI_definitions.lua:1442`, `:1544–1552`; строки `ph_blind_score_at_least="Score at least"` в `localization/en-us.lua:3763`]. Игрок знает правило босса за два блайнда до боя и может готовить колоду и магазин под него.
- Босса можно сменить за $10 (кнопка `b_reroll_boss`, ваучер) [код Balatro: `functions/UI_definitions.lua:1428`, `functions/button_callbacks.lua:2800–2820`].
- Цель блайнда: `self.chips = get_blind_amount(ante) * self.mult * G.GAME.starting_params.ante_scaling` [код Balatro: `blind.lua:107`]; цифра цели всегда видна в бою рядом с текущими очками.
- Предупреждение до действия: если выбранная рука запрещена правилом босса (`Blind:debuff_hand(..., true)` при выборе карт), игра поднимает флаг `G.boss_throw_hand` и выводит над столом надпись «Hand will not score» плюс текст правила босса (`get_loc_debuff_text()`), трясёт спрайт босса и проигрывает звук [код Balatro: `cardarea.lua:168–170`, `game.lua:2512–2534`, строка `ph_unscored_hand` в `localization/en-us.lua:3797`]. Сыграть такую руку можно — игру не блокируют, но предупреждают.
- При выборе карт показывается тип руки, уровень, базовые фишки и множитель (`update_hand_text(... level, mult, chips)`) [код Balatro: `cardarea.lua:182`]. Итоговый счёт с джокерами заранее **не** считается. Если среди выбранных есть карта рубашкой вверх (боссы The House/The Mark/The Fish), вместо прогноза — «????» и «?» [код Balatro: `cardarea.lua:173–180`]. Неизвестность показана явно, ложной цифры нет.
- Ретроспективная индикация «хватило»: когда очки за руку достигают требования блайнда, на счётчиках фишек и множителя загорается пламя, его сила `max(0, log5(score) − 2)` [код Balatro: `functions/button_callbacks.lua:2021–2022`, `functions/misc_functions.lua:738–742`].
- Отдельного прогноза «вы проиграете» в коде не найдено. Проигрыш наступает в `end_round()`, если `G.GAME.chips - G.GAME.blind.chips < 0` после последней руки и ни один джокер не вернул `saved` [код Balatro: `functions/state_events.lua:86–117`]. Mr. Bones спасает, если набрано ≥ 25 % цели (`G.GAME.chips/G.GAME.blind.chips >= 0.25`), и пишет «Saved by Mr. Bones» [код Balatro: `card.lua:3048`, `localization/en-us.lua:3779`]. Игрок видит угрозу по трём постоянным числам: цель, текущие очки, оставшиеся руки и сбросы.
- Пороги появления боссов по анте (`boss = {min = …}`): с анте 1 доступны The Hook, Club, Manacle, Psychic, Goad, Window, Head, Pillar; большинство — с анте 2; The Tooth и The Eye — с 3; The Plant — с 4; The Serpent — с 5; The Ox — с 6; «showdown»-боссы (Violet Vessel, Verdant Leaf, Cerulean Bell и др.) — только на анте, кратном `win_ante` = 8 [код Balatro: `game.lua:264–290`, `:1884`; `functions/common_events.lua:2338–2383`]. `get_new_boss` выбирает только из боссов с минимальным числом прошлых появлений, поэтому повторов нет, пока пул не исчерпан [код Balatro: `functions/common_events.lua:2363–2378`].

### Inferences
- (вывод) Оба проекта показывают угрозу **до** того, как игрок принимает решение, и тем же языком, каким потом наносят урон: StS — число на иконке равно удару, Balatro — цель и правило босса на экране выбора. В Ashen Oath аналог — подсветка цепи `planChain`, но угрозы врагов (касания, лучники, сапёры, бюст гоблина) в ней, судя по описанию задачи, не прогнозируются.
- (вывод) Приём «Unknown» вместо ложной иконки и «????» вместо ложного прогноза: если исход нельзя честно посчитать, игра прямо говорит «неизвестно». Это дешевле, чем полный прогноз, и не подрывает доверие к тем телеграфам, которые есть.
- (вывод) В StS сила угрозы кодируется формой иконки (7 ступеней), а не только числом. Для реального времени, где некогда читать числа, аналог — ступени размера или цвета телеграфа по урону.

### Gaps
- Код StS не проверен (jar отсутствует). Не подтверждено по коду: имена значений `AbstractMonster.Intent`, как именно число на намерении учитывает Strength/Weak врага, Vulnerable игрока, стойки Watcher, Intangible. Вики (wiki.gg) это не описывает; поиск дал только непроверенное утверждение модели.
- Нет первоисточника (интервью разработчиков) о том, почему Mega Crit ввели намерения; найденные интервью этого не касаются — [Game Developer: Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-).

## 2. Объяснение поражения

### Takeaway
Balatro на экране «GAME OVER» называет, кто победил («Defeated By» — спрайт и имя блайнда), и даёт статистику забега с seed. StS сохраняет в каждом забеге `killed_by`, урон и число ходов в каждом бою, HP по этажам; это основа экрана истории забегов и метрик разработчиков. Ни одна из игр не объясняет поражение пошагово — она называет источник и даёт данные для самоанализа.

### Cited Findings
**Balatro**
- `create_UIBox_game_over`: заголовок `ph_game_over` = «GAME OVER» (красный), затем строки статистики `hand` (лучшая рука), `poker_hand` (самый частый тип руки), `cards_played`, `cards_discarded`, `cards_purchased`, `times_rerolled`, `new_collection`, `seed` + кнопка «Copy», `furthest_ante`, `furthest_round`, `defeated_by` [код Balatro: `functions/UI_definitions.lua:2871–2893`].
- `defeated_by` рисует анимированный спрайт блайнда с шейдером `dissolve` и его локализованное имя, подпись «Defeated By» [код Balatro: `functions/UI_definitions.lua:2963–2975`, `localization/en-us.lua:3575`].
- Кнопки после поражения: «Next»/«Start new run»/«Main menu» [код Balatro: `functions/UI_definitions.lua:2897–2913`]. Поражение обнуляет серию побед `current_streak` (кроме забегов с seed и испытаний) [код Balatro: `functions/state_events.lua:114–117`].
- Второй путь поражения: колода кончилась при пустой руке → `G.STATES.GAME_OVER` [код Balatro: `functions/state_events.lua:354–358`].

**Slay the Spire**
- Файл забега содержит `killed_by` (имя встречи, например «Gremlin Nob», «3 Sentries», «Awakened One») и `floor_reached`; `damage_taken` — список `{damage, enemies, floor, turns}` по каждому бою; `current_hp_per_floor` и `max_hp_per_floor`; `path_per_floor`, `card_choices` (выбрано/не выбрано), `campfire_choices`, `potions_floor_usage`, `score`, `victory` [локальные забеги StS, `runs/*/*.run`, build 2022-12-18].
- Агрегат по 35 локальным забегам (5 побед): `killed_by` разнообразен — 25 разных встреч, ни одна не встречается больше 2 раз; три забега с `killed_by = null` на этаже 0 (прерванные), один — на 22 этаже. Средний урон за бой по встречам: The Heart 87,5; Awakened One 78; Shield and Spear 56,5; Collector 52,2; Time Eater 50,7; The Guardian 42,9 (10 боёв); Hexaghost 42,0 (10); Gremlin Leader 41,8 (11); Slavers 27,1; Book of Stabbing 25,3 [локальные забеги StS]. Это личные данные одного игрока — иллюстрация формата, не баланс.
- История забегов добавлена в Weekly Patch 11 «A Library of Features»: «You can now view your past runs. Simply select the option from the Main Menu» — [wiki: Weekly Patch 11](https://slaythespire.wiki.gg/wiki/Weekly_Patch_11_-_A_Library_of_Features).
- Счёт в конце забега складывается из явных строк, каждая поощряет поведение: этаж 5 очков; враг 2; элита 10/20/30 по актам; боссы 50, 100, 150…; «Champion» 25 за элиту без урона; «Perfect» 50 за босса без урона; «Beyond Perfect» 200; Ascension +5 % за уровень и др. — [wiki: Score](https://slaythespire.wiki.gg/wiki/Score). Счёт копится и открывает карты и реликвии.
- Позиция Mega Crit: поражение не считали главным риском; ключевым назвали быстро дать игроку начать новый забег и пробовать новые стратегии («key») — [Game Developer: Road to the IGF](https://www.gamedeveloper.com/game-platforms/road-to-the-igf-mega-crit-games-i-slay-the-spire-i-).
- Метрики разработчиков: сервер метрик собирал данные пассивно, «metrics can be misleading if not carefully interpreted», отдельно — искажение от «super playtesters» — [podwise: конспект GDC 2019](https://podwise.ai/episodes/1459444), [GDC: анонс доклада](https://gdconf.com/news/learn-slay-spires-successful-metrics-driven-approach-game-balancing-gdc-2019).

### Inferences
- (вывод) Минимальный набор для «почему я умер?»: (1) имя источника смерти крупно и с его картинкой (Balatro «Defeated By»); (2) урон по боям и HP по узлам похода (StS `damage_taken`, `current_hp_per_floor`). Для Ashen Oath естественный аналог — «Сражён: <вид врага/угроза>» плюс разбивка урона последнего боя по источникам (касание, стрела, сапёр, бюст, броня элиты). Телеметрия проекта уже различает источники урона (73 % — касания), значит данные для такого экрана, вероятно, есть.
- (вывод) Обе игры объясняют поражение одним источником, хотя смерть обычно накапливается. В реальном времени полезнее «последние N ударов» или доли урона по источникам за бой, чем один «убийца».
- (вывод) Строки счёта StS («Champion» — элита без урона) превращают «не получай урона» в явную цель. Для Ashen Oath это мягкий способ научить читать телеграфы без постоянной силы в мете.

### Gaps
- Текст и раскладку экрана смерти StS (DeathScreen) и экрана истории забегов по коду или вики проверить не удалось: страница вики Run History не найдена (404), jar нет. Утверждать, что история показывает «Killed by … on Floor N» и график HP, можно только по полям `.run`, не по UI.
- Конкретные графики смертей по этажам/встречам из доклада GDC 2019 недоступны: видео/слайды за логином GDC Vault, конспекты чисел не содержат.

## 3. Балансировка сложности

### Takeaway
StS строит кривую из пулов встреч (первые 3 боя акта 1 — из лёгкого пула, далее — тяжёлый, без повторов подряд) и 20 уровней Ascension, где каждый уровень меняет одну ось (частоту элит, урон, HP, лечение, слоты зелий, паттерны). Balatro — из таблицы целей по анте ×1/×1,5/×2 для Small/Big/Boss, 8 ставок (stakes), где каждая добавляет одно правило, и порогов появления боссов по анте.

### Cited Findings
**Slay the Spire — встречи**
- Первые встречи каждого акта берутся из «Easy Pool», остальные — из «Hard Pool»: акт 1 — 3 лёгких, акты 2 и 3 — по 2. «3 consecutive monster encounters can never contain 2 identical fights» — [wiki: Monsters](https://slaythespire.wiki.gg/wiki/Monsters).
- Акт 1, лёгкий пул (вес): Cultist 2, Jaw Worm 2, 2 Louse 2, Small Slimes 2. Тяжёлый: Gang of Gremlins 1, Large Slime 2, Swarm of Slimes 1, Blue Slaver 2, Red Slaver 1, 3 Louse 2, 2 Fungi Beasts 2, Exordium Thugs 1,5, Exordium Wildlife 1,5, Looter 2 — [wiki: Monsters](https://slaythespire.wiki.gg/wiki/Monsters).
- Есть запреты на первую тяжёлую встречу после конкретной третьей лёгкой: 3 Louses не после 2 Louses; Swarm of Slimes/Large Slime не после 2 Slimes; Exordium Thugs не после Looter; Red Slaver/Exordium Thugs не после Blue Slaver — [wiki: Monsters](https://slaythespire.wiki.gg/wiki/Monsters). Смысл — не давать почти тот же бой дважды подряд.

**Slay the Spire — числа врагов и Ascension**
- Jaw Worm: HP 40–44 (A7: 42–46); Chomp 11 (A2: 12); Bellow 3 Strength + 6 Block (A2: 4 Str; A17: 5 Str + 9 Block); Thrash 7 + 5 Block — [wiki: Jaw Worm](https://slaythespire.wiki.gg/wiki/Jaw_Worm).
- Gremlin Nob (элита): HP 82–86 (A8: 85–90); Skull Bash 6 + 2 Vulnerable (A3: 8); Bull Rush 14 (A3: 16); Bellow — Enrage 2 (A18: 3); после Bellow 33 % Skull Bash / 67 % Bull Rush; на A18 паттерн фиксирован — [wiki: Gremlin Nob](https://slaythespire.wiki.gg/wiki/Gremlin_Nob). Шаг Ascension по урону — порядка +1…+2 к удару (≈ +9–33 %), по HP — +2…+4 (≈ +4–5 %).
- Ascension (накопительно): A1 элит примерно на 60 % больше; A2/A3/A4 — больше урона у обычных/элит/боссов; A5 — после босса лечение 75 % недостающего HP вместо 100 %; A6 — старт с −10 % HP; A7/A8/A9 — больше HP (иногда блока) у обычных/элит/боссов; A10 — проклятие Ascender's Bane; A11 — на 1 слот зелий меньше; A12 — улучшенные карты вдвое реже в актах 2–3; A13 — боссы дают на 25 % меньше золота; A14 — макс. HP −5 (Ironclad) / −4 (остальные); A15 — события хуже; A16 — магазин +10 %; A17/A18/A19 — сложнее наборы ходов обычных/элит/боссов; A20 — два босса в конце акта 3 — [wiki: Ascension](https://slaythespire.wiki.gg/wiki/Ascension). Порядок уровней повторяет схему «обычные → элиты → боссы» трижды (урон, HP, паттерны).
- Отдых у костра лечит 30 % макс. HP; альтернатива — Smith (улучшить карту) — [wiki: Rest Site](https://slaythespire.wiki.gg/wiki/Rest_Site).
- Слоты зелий: базовое число на вики-странице Ascension не указано, A11 убирает один — [wiki: Ascension](https://slaythespire.wiki.gg/wiki/Ascension).
- Разблокировка: карты и реликвии открываются накопленным счётом за забеги; фан-гайд даёт пороги 300, 750, 1000, 1500, 2000 — [slaythespire.info](https://slaythespire.info/en/how-to-unlock-characters-cards-and-relics-spoiler-warning/) (не вики и не код; точность не подтверждена); начальные открытия Ironclad уровня 1: Heavy Blade, Spot Weakness, Limit Break — [slaythespire.gg](https://slaythespire.gg/characters/Ironclad). Разблокированное расширяет пул выбора, а не силу персонажа.
- Принцип баланса в докладе GDC 2019: «every card should have a place», вторично — избегать слишком «искажающих» эффектов; баланс вели еженедельными патчами и уровнями Ascension — [mechanicsofmagic: критика доклада](https://mechanicsofmagic.com/2022/05/22/critical-play-is-this-game-balanced-10/), [podwise](https://podwise.ai/episodes/1459444).

**Balatro — кривая целей**
- `get_blind_amount(ante)`, базовые фишки по анте 1–8 [код Balatro: `functions/misc_functions.lua:919–953`]:
  - `scaling = 1` (White, Red): 300, 800, 2000, 5000, 11000, 20000, 35000, 50000;
  - `scaling = 2` (Green, Black, Blue): 300, 900, 2600, 8000, 20000, 36000, 60000, 100000;
  - `scaling = 3` (Purple, Orange, Gold): 300, 1000, 3200, 9000, 25000, 60000, 110000, 200000.
  - В коде закомментированы прежние версии таблиц 2 и 3 (например, `300, 900, 2400, 7000, 18000, 32000, 56000, 90000`): кривую ужесточали.
  - Анте 0 и меньше — 100. После 8: `floor(a*(1.6+(0.75*c)^d)^c)`, `a` = значение анте 8, `c = ante−8`, `d = 1+0,2c`, с округлением до 2 значащих цифр. Пересчёт этой формулы (только арифметика) для анте 9–12 на White: 110 000; 560 000; 7 200 000; 300 000 000 — сверхэкспоненциальный «потолок» бесконечного режима.
  - Рост между анте на White: ×2,67; ×2,5; ×2,5; ×2,2; ×1,82; ×1,75; ×1,43 — относительный шаг **убывает** к анте 8 (на Purple: ×3,33 … ×1,82).
- Множители блайндов (`P_BLINDS`): Small ×1 ($3), Big ×1,5 ($4), обычный босс ×2 ($5), The Wall ×4, The Needle ×1 (но одна рука), финальные боссы $8: Violet Vessel ×6, Cerulean Bell, Verdant Leaf, Amber Acorn, Crimson Heart ×2 [код Balatro: `game.lua:264–290`]. Внутри анте шаг 1 → 1,5 → 2.
- Колода Plasma: `ante_scaling = 2` — все цели ×2 [код Balatro: `game.lua:641`].
- Ставки (stakes), каждая включает предыдущие [код Balatro: `game.lua:2050–2059`; тексты `localization/en-us.lua:2551–2602`]:
  1. White — база;
  2. Red — Small Blind без денежной награды;
  3. Green — `scaling = 2` («Required score scales faster for each Ante»);
  4. Black — в магазине Eternal-джокеры (нельзя продать/уничтожить);
  5. Blue — −1 сброс;
  6. Purple — `scaling = 3`;
  7. Orange — Perishable-джокеры (ослабляются через 5 раундов);
  8. Gold — Rental-джокеры ($3 за раунд).
  Открываются по порядку: у всех ставок кроме White `unlocked = false` [код Balatro: `game.lua:252–261`].
- Стартовые параметры: $4, рука 8 карт, 4 руки, 3 сброса, реролл $5, 5 слотов джокеров, 2 слота расходников [код Balatro: `functions/misc_functions.lua:1868–1881`]. Процент за накопления: от $5, `interest_amount * min(floor($/5), cap/5)` [код Balatro: `functions/state_events.lua:1191–1192`].
- Разблокировки: из 135 джокеров 45 закрыты (`unlocked = false`); у разблокируемого контента 37 непустых типов условий (`win_stake`, `win_deck`, `discover_amount`, счётчики действий `c_*`, `chip_score` и др.); колоды Blue и Yellow открываются после 20 и 50 открытий коллекции; Plasma — после победы на 5-й ставке [код Balatro: `game.lua:368–641`, подсчёт `grep`].
- Обучение: пока туториал не пройден до Big Blind, забег идёт на фиксированном seed `"TUTORIAL"` с заданными ваучером, метками и магазином (`forced_voucher`, `forced_tags`, `forced_shop`) [код Balatro: `game.lua:1531`, `:2164–2180`, `functions/UI_definitions.lua:743`].

### Inferences
- (вывод) Обе игры дозируют новизну по позиции в забеге, а не только силу: StS — лёгкий пул на 3 первых боя, Balatro — боссы с `min` по анте (с анте 1 только 8 «простых» правил вроде запрета масти; экономические и «странные» — позже) и финальные showdown-боссы только на анте 8. Для Ashen Oath (проблема «слишком много нового сразу», вывод): ввести у видов врагов и аффиксов «минимальный ряд/узел появления» и запрет повторять одну и ту же арену подряд.
- (вывод) Кривая Balatro: большой относительный шаг в начале (×2,5–2,7) и меньший к концу (×1,4–1,8). Он идёт против роста силы игрока: в начале сила растёт быстро, потом медленнее. Абсолютные числа «потолка» вынесены за финал.
- (вывод) Ascension и stakes меняют по одной оси на уровень и подписаны одной строкой. Для лестницы «Испытание I–V» стоит держать то же правило: один понятный модификатор на ступень, написанный так же коротко, как «−1 сброс».
- (вывод) A5 (лечение после босса 75 %) и отдых 30 % показывают, что ресурс HP между боями — главный регулятор кривой StS. Для похода Ashen Oath из 7–10 боёв доля лечения у костра — тот же рычаг.

### Gaps
- Нет кодовых подтверждений StS: `AbstractDungeon.generateWeakEnemies/StrongEnemies`, коэффициент частоты элит (вики: «около 60 %»), точные проценты урона/HP по Ascension для всех врагов, базовое число слотов зелий (по общему знанию — 3, но источник в этой сессии не найден).
- Точные пороги очков для разблокировок StS по персонажам — только фан-сайт, без кода и вики.
- Числа смертности по встречам у Mega Crit (данные метрик) не найдены в открытом доступе.

## 4. Что может перенять Ashen Oath (всё — выводы)

### Takeaway
Самые дешёвые переносы: (1) экран поражения с «Сражён: <источник>» и разбивкой урона боя; (2) честное «неизвестно» вместо ложного телеграфа; (3) ступени силы угрозы в форме телеграфа; (4) пороги «не раньше ряда N» для новых угроз и лёгкий пул первых боёв; (5) лестница «Испытание» по одной оси на ступень.

### Cited Findings
- Основания — находки разделов 1–3: «Defeated By» и статистика с seed [код Balatro: `functions/UI_definitions.lua:2871–2975`]; `killed_by` и `damage_taken` в забеге StS [локальные забеги StS]; «Unknown» и Runic Dome [wiki: Intent](https://slaythespire.wiki.gg/wiki/Intent); «Hand will not score» до розыгрыша [код Balatro: `game.lua:2512–2534`]; лёгкий пул 3 боя [wiki: Monsters](https://slaythespire.wiki.gg/wiki/Monsters); `boss.min` по анте [код Balatro: `game.lua:264–290`]; Ascension и stakes [wiki: Ascension](https://slaythespire.wiki.gg/wiki/Ascension), [код Balatro: `game.lua:2050–2059`].

### Inferences
- **Экран поражения.** Крупно: «Сражён: Сапёр» (картинка вида, как спрайт блайнда у Balatro). Ниже — доли урона за бой по источникам (касание / стрела / взрыв сапёра / бюст гоблина / удар элиты сквозь броню) и последние 3 удара с временем до смерти. Затем — путь похода с HP по узлам (как `current_hp_per_floor`). Кнопка нового похода — сразу (Mega Crit называли быстрый перезапуск ключевым).
- **Запись в телеметрию.** Аналог `killed_by` + `damage_taken{source, enemies, node, durationSec}` на каждый бой, чтобы раздел отчёта отвечал «от чего умирают на ряду N» (это и метрика Mega Crit). Учитывать предупреждение из доклада: метрики искажаются опытными тестерами.
- **Телеграфы в реальном времени.** Аналог «7 ступеней иконки атаки»: размер/толщина круга бюста, стрелы лучника и фитиля сапёра по урону. Аналог «Hand will not score»: если цепь, выбранная игроком, проведёт героя через зону, которая сработает до конца прохода (фитиль 0,8 с, круг бюста 0,6 с), подсветить это в `planChain` до отпускания. По правилам проекта подсветка обязана совпадать с исполнением, поэтому прогноз возможен только для детерминированных угроз. Для недетерминированных — честное «?» как «????» в Balatro.
- **Касания (73 % урона).** У StS нет урона «вне намерения»: весь урон врага заранее показан. Ближайший перенос — показывать, кто коснётся героя в ближайшие ~0,5 с на пути цепи (контур/метка на враге). Это вывод; нужна проверка плейтестом.
- **Дозирование новизны.** Каждому виду врага, аффиксу элиты и бюсту — «минимальный ряд», как `boss.min`. Первые 2–3 боя похода — из «лёгкого пула» знакомых видов. Запрет: в трёх подряд боях нет двух одинаковых составов.
- **Кривая.** Шаг сложности между рядами — большой в начале и меньше к концу (как ×2,7 → ×1,4 у Balatro), если сила сборки игрока растёт так же. Проверять телеметрией, не ботом.
- **Лестница «Испытание I–V».** Одна ось на ступень, одной строкой, накопительно, открытие по порядку (как stakes и Ascension). Порядок по StS: сначала «больше элит», затем «сильнее удары», затем «меньше лечения», в конце — «два босса»/новые паттерны.
- **Мета без силы.** Обе игры открывают **разнообразие** (карты, джокеры, колоды), а не силу; StS даёт очки за «Champion» (элита без урона). Это совместимо с решением проекта «мета — разнообразие».

### Gaps
- Не проверено, какие данные о источниках урона уже пишет `telemetry/` Ashen Oath; выводы об экране поражения предполагают, что источник урона известен в симуляции.
- Перенос «прогноза касаний» в реальное время не имеет прямого аналога в обеих играх (обе пошаговые по сути) — эффективность только плейтестом.
