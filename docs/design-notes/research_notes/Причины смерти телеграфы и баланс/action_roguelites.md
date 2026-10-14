# Телеграфы атак, объяснение смерти и баланс сложности в action-рогаликах (Isaac, Cult of the Lamb, Hollow Knight, Mewgenics, Hades, Dead Cells)

Дата: 14.10.2026. Источники трёх видов:
- **код/данные** — локальные установки Steam, файлы скопированы в scratchpad и разобраны там (Steam-папки не менялись, игры не запускались);
- **вики** — fandom/wiki.gg/fextralife, помечено «вики»;
- **пресса/форумы** — помечено отдельно.

Что удалось и не удалось прочитать локально:
- **Isaac: Rebirth (Repentance, changelog v1.7.9b от 07.12.2022).** XML (`entities2.xml`, stages, bosses) лежит только внутри упакованных `resources/packed/*.a`. Распакованного XML в установке нет. `resources/packed/readme.txt` прямо просит не публиковать способ вскрытия архивов, поэтому архивы пропущены. Прочитаны `resources/scripts/enums.lua` (API-перечисления с комментариями разработчика) и `changelog.txt`.
- **Cult of the Lamb (Application.version 1.5.26.1058 по `globalgamemanagers`).** `Assembly-CSharp.dll` декомпилирован ilspycmd 11.1. Значения `DifficultyData` (ScriptableObject) прочитаны из копии `resources.assets` скриптом по порядку полей класса.
- **Hollow Knight.** В `C:\Program Files (x86)\Steam\steamapps\common\Hollow Knight\hollow_knight_Data` лежит только `Config.ini` (350 байт). Игра фактически не установлена, `Managed/Assembly-CSharp.dll` нет, локальный разбор невозможен.
- **Mewgenics.** `resources.gpak` — простой архив: u32 число файлов, затем записи (u16 длина имени, имя, u32 размер), затем данные подряд. Всего 19 979 файлов. Извлечены только текстовые `.gon/.csv/.txt/.json`. Mewgenics — пошаговая тактика, поэтому для телеграфов real-time она применима ограниченно.

---

## 1. Телеграфы в плотном real-time бою: длительность замаха, сигналы, единообразие, неуязвимость после удара, контактный урон

### Takeaway
Самые ясные игры используют **одну общую грамматику замаха для всех рядовых врагов** и **показывают зону поражения на земле точно по форме и времени удара**:
- Cult of the Lamb: анимация «signpost» + звук `warningSfx` + белая заливка спрайта, которая нарастает от 0 до 1 за время замаха. Типовой замах 0.5 с, у быстрых собак 0.2 с.
- Dead Cells: «!» над головой и рык.
- Mewgenics: `DisplayDangerAOE` — опасная зона, нарисованная заранее.

Каждая игра даёт после попадания длинное окно неуязвимости: CotL — 1 с × множитель сложности (0.75–2.5), Hollow Knight — 1.7 с с амулетом. Контактный урон Isaac сделан простым и фиксированным: ½ сердца на главах 1–3, целое сердце с главы 4.

### Cited Findings

**Cult of the Lamb (код, v1.5.26)**
- Единый паттерн замаха у рядовых врагов. Пример из `EnemySpider.cs` (стр. 305–328):
  1. включается `SignPostAttackAnimation`;
  2. состояние становится `StateMachine.State.SignPostAttack`;
  3. играет `AudioManager.PlayOneShot(warningSfx)`;
  4. в цикле вызывается `SimpleSpineFlash.FlashWhite(Progress / Duration)` — белая заливка растёт к моменту удара;
  5. после удара — `FlashWhite(false)` и `attackSfx`.

  При получении урона враг вспыхивает красным (`FlashFillRed`), а не белым. Цвет белый = «скоро ударит», красный = «получил урон». — локально: `scratchpad/games/cotl/src/EnemySpider.cs`, `SimpleSpineFlash.cs`
- Длительности замаха (поле `SignPostAttackDuration`, значения по умолчанию в коде; в префабах могут быть переопределены):
  - 0.5 с — `EnemySpider`, `EnemySpiker`, `EnemyTriDash`, `EnemyScuttleSwiper`, `EnemyLavaSnail(Big)`, `EnemyJellyFish`, `EnemyDogMage`, `TrapCharger`;
  - 0.2 с — `EnemyDog`, `EnemyDogPack` (быстрые стайные).

  У основного мечника `EnemySwordsman.cs` стр. 982: `float SignPostDelay = 0.5f` (0, если `signpost == false`). У него анимации `grunt-attack-charge` / `grunt-attack-charge2` (вторая — для последнего удара серии `DoubleAttack`). Там же есть окно парирования: `signPostParryWindow = 0.2f`, `attackParryWindow = 0.15f`. — локально: `EnemySwordsman.cs` стр. 106–108, 977–1016
- Урон у рядового мечника наносит отдельный коллайдер `damageColliderEvents`. Он включается на время удара: `state.Timer < 0.2f` и враг не парирован. Тело врага в остальное время не наносит урона. *Вывод из кода*: контактного урона «за касание» у мечника нет, урон только от удара. — `EnemySwordsman.cs` стр. 1024–1037
- Неуязвимость игрока после попадания — `PlayerController.HitEffects` (стр. 448–475):
  - `HitDuration = 1f`, `health.untouchable = true`, `untouchableTimer = 1f * DifficultyManager.GetInvincibleTimeMultiplier()`;
  - сначала 0.1 с без движения по unscaled-времени, затем отбрасывание (`speed = 10f`, затухание 0.9/кадр-дельта);
  - таймер неуязвимости взводится заново по окончании отбрасывания;
  - при блоке/отбрасывании вызываются `HitStop()`, тряска камеры `shakeCamera(0.5f, …)` и аудиофильтр `SoundParams.HitFilter` на 0.2 с.

  — `PlayerController.cs` стр. 378–392, 448–486

**Isaac (данные API, v1.7.9b)**
- Контактный урон и масштаб по этажам. В `enums.lua` (`DamageFlag.DAMAGE_NO_MODIFIERS`) есть комментарий разработчика: «ignore damage modifiers (such as doubled damage from the Womb and later floors or reduced damage from the Wafer)». Удвоение урона по этажам — встроенный модификатор, а не свойство каждого врага. — локально: `scratchpad/games/isaac/enums.lua` стр. 1076
- Вики: в главах 1–3 большинство источников наносят ½ сердца; с главы 4 (Womb/Utero/Scarred Womb/Corpse) все такие удары наносят целое сердце, если нет снижения урона вроде The Wafer. — [Isaac wiki.gg: Health](https://bindingofisaacrebirth.wiki.gg/wiki/Health)
- Чемпионы обозначаются цветом. Каждый цвет — одно правило и одна награда, это прямо записано в `enums.lua` `ChampionColor`:
  - RED — «33% more life, full heart»;
  - YELLOW — «33% faster, lil battery»;
  - GREEN — «trail of green creep, pill»;
  - BLUE — «half speed, 3 blue flies»;
  - BLACK — «explodes on death, bomb»;
  - WHITE — «must be killed last, half eternal heart»;
  - TRANSPARENT — «spectral, locked chest»;
  - FLICKER — «partly invisible, red chest»;
  - PINK — «random shots, no drop»;
  - PURPLE — «pull player/tears, trinket».

  Комментарии ранние: множители в вики другие, см. ниже. — `enums.lua` стр. 4499–4511
- Вики о чемпионах:
  - цветовой оттенок плюс размер: большинство на ~15 % крупнее, Small на 50 % меньше, Large на 50 % больше;
  - множители HP: Red ×2.6, Yellow ×1.5, Gray/Small ×0.66, Large/Rainbow ×3, Crown ×6.

  — [Isaac wiki.gg: Champions](https://bindingofisaacrebirth.wiki.gg/wiki/Champions)
- Неуязвимость после удара (Isaac):
  - базовая длительность в доступных источниках не найдена;
  - флаг `FLAG_NO_DAMAGE_BLINK`: «Player was given a short period of invulnerability by something other than damage, don't blink». Значит, неуязвимость после удара по умолчанию показывается миганием. — `enums.lua` стр. 1023
  - changelog v1.7.5 (10.11.2021): «Increased invincibility frames from Holy Mantle to 1 second (from 0.5)»; «Tainted Jacob now gets more invincibility frames after being hit by Dark Esau». — `changelog.txt` стр. 599, 578
  - вики: Blind Rage «Doubles the invincibility frames Isaac gets after getting hit». — [Isaac wiki.gg: Blind Rage](https://bindingofisaacrebirth.wiki.gg/wiki/Blind_Rage)
- Isaac отдельно правит **неизбежный урон** как дефект. Changelog v1.7.5: «Champion bosses that spawn with a copy of themselves now spawn with a fixed offset (this should prevent unavoidable damage upon entering a room)». Ещё: Brimstone+Ipecac взрывается только через 1 с после входа в комнату, «this could cause unavoidable damage»; исправлено появление игрока не в том месте, «resulting in unavoidable damage». — `changelog.txt` стр. 641, 989, 1004

**Mewgenics (данные .gon)**
- Опасная зона рисуется заранее пассивкой `DisplayDangerAOE <способность>`:
  - бочка-граната `DaddyShark`: `DeathRattle GrenadeExplode` + `DisplayDangerAOE GrenadeExplode` + `BasicAIDangerZone 2`;
  - форма врага `Explody` у газового врага получает `DisplayDangerAOE attack`;
  - боссы: `DisplayDangerAOE MoonHead_Blow`, `TheChild_Wrath`.

  Для мгновенно убивающих врагов есть флаг интерфейса `show_infinity_damage_warning true`. — локально: `scratchpad/games/mewgenics/files/data/characters/enemies.gon` стр. 1079, 7423; `inanimate_objects.gon` стр. 2295–2300; `bosses.gon` стр. 2371
- Элитные «баффы» Mewgenics: **один бафф — один видимый маркер**:
  - `Spiky` — `EliteParticle SpikeBuff`, `Thorns 2`, серый тинт;
  - `Reactive` — искры, `KineticSpikes 1`;
  - `Damaging` — красный тинт, `DamageUp 2`;
  - `Tough` — тёмно-серый тинт, `Brace 2`;
  - у каждого свой `icon_frame` (500–504…) для иконки.

  — `data/elite_buffs.gon`

**Hollow Knight (вики/пресса; локально не установлен)**
- Амулет Stalwart Shell: «The Knight gains invincibility for 1.7 seconds after getting hit and reduces the recoil of being hit to 0.8 seconds». — [fextralife: Stalwart Shell](https://hollowknight.wiki.fextralife.com/Stalwart+Shell). Базовое значение на странице не указано.
- Desolate Dive: неуязвимость на время пикирования, 0.75 с в момент удара о землю и ещё 0.4 с после возврата управления (вики, по выдаче поиска). — [hollowknight.wiki: Desolate Dive (diff)](https://hollowknight.wiki/w/Special:MobileDiff/195426)

**Dead Cells (гайды, не первоисточник)**
- Рядовые враги: «!» над головой. По одному описанию жёлтый, по другому — красная аура и «!». Плюс звук (рык, визг) перед атакой. — [PlayStation LifeStyle: Dead Cells tips](https://www.playstationlifestyle.net/2018/08/06/dead-cells-tips/); [GodisaGeek: 10 tips](https://godisageek.com/2018/08/10-tips-to-die-with-style-in-dead-cells/)
- Боссы: красная линия траектории (Conjunctivius), «!» на земле в местах удара (Mama Tick). У невидимой элиты подсказки атак видны, хотя сам враг скрыт. — [deadcells.wiki.gg: Conjunctivius](https://deadcells.wiki.gg/wiki/Conjunctivius); [Kotaku: Mama Tick](https://kotaku.com/how-to-make-short-work-of-mama-tick-in-the-new-dead-cel-1841608986)

**Hades / Hades II (пресса, блог)**
- Рецензия Hades: атаки «generally well telegraphed, with the occasional exception of smaller foes». — [GamingTrend review](https://gamingtrend.com/reviews/one-does-not-simply-walk-out-of-hades-hades-review/)
- Разбор читаемости Hades II (блог игрока, не разработчика). Урон нечитаем, когда:
  - наземный индикатор не совпадает с формой или временем удара (ударная волна Цербера достаёт за спину);
  - круг приземления Полифема скрыт пылью примерно на 1 с;
  - тусклая полукруглая волна;
  - у одного Полифема есть урон касанием в прыжке, у остальных — нет («mixed contact damage»);
  - «unblockable» удары не имеют визуального признака, игрок узнаёт о них уже после пропуска.

  Предложенные правила: похожие действия дают похожие эффекты; телеграф точно показывает форму, направление и время; сигналы не перекрываются эффектами; урон только от атак; особые свойства показаны до удара. — [nex-3: Hades II Has a Legibility Problem](https://nex-3.com/blog/hades-ii-has-a-legibility-problem/)

### Inferences
- Сильнейший общий приём — **один и тот же признак замаха у всех рядовых врагов**: CotL (белая заливка + звук), Dead Cells («!» + звук). При 28–60 врагах на экране игрок не учит 10 разных телеграфов, он ищет одно: «кто сейчас белеет».
- Белая заливка в CotL **нарастает пропорционально оставшемуся времени** (`Progress / Duration`). Это одновременно сигнал «он ударит» и таймер «когда». Для Ashen Oath (лучник 1 с, сапёр 0.8 с, гоблин 0.6 с) это прямо применимо как общая шкала (вывод).
- Разные цвета для «скоро ударит» (белый) и «получил урон» (красный) в CotL снимают путаницу между нашими и чужими событиями (вывод).
- Длина неуязвимости — главный рычаг сложности. CotL держит его в таблице сложности (×0.75…×2.5 от 1 с), а не в коде врагов (вывод на основе таблицы ниже).
- Isaac считает «неизбежный урон при входе в комнату» дефектом и исправляет его патчами. Для арен с плотным спавном нужна гарантия: нет урона в первые N секунд, нет появления врага вплотную к герою (вывод).

### Gaps
- Базовая неуязвимость Isaac после удара и у Рыцаря Hollow Knight не подтверждена первоисточником: fandom закрыт (HTTP 402), hollowknight.wiki и fextralife отдают 403 или не указывают значение. Часто упоминаемые 1.3 с для HK не проверены.
- Окна замаха Isaac (кадры атак `entities2.xml`, `.anm2`) недоступны: архивы `.a` не вскрывались по просьбе разработчиков.
- Точные длительности замаха в Hades/Hades II и Dead Cells в первоисточниках не найдены. Разработческих докладов (GDC) о телеграфах Supergiant поиск не дал.
- CotL: значения `SignPostAttackDuration` в префабах могут отличаться от значений по умолчанию в коде. Префабы не разбирались.

---

## 2. Объяснение смерти: экраны смерти, сводки похода, «Death Defiance»

### Takeaway
Isaac — эталон «кто убил»: записка «I WAS KILLED BY THIS THING →» с картинкой убийцы, место (тип главы) и все предметы. Cult of the Lamb показывает итог похода (заголовок по исходу, день, длительность, убийства, маршрут по узлам, потерю добычи в %), но не убийцу. Hades и Dead Cells выносят «killed by» в журнал статистики. Hades смягчает саму смерть: Death Defiance — до 3 «лишних жизней» с 50 % HP.

### Cited Findings
- **Isaac — «Isaac's Last Will»** (вики):
  - «DEAR DIARY, TODAY I DIED.» и случайный рисунок;
  - «I WAS KILLED BY THIS THING →» — изображение того, кто нанёс последний удар;
  - «IN SOME ____» — короткое описание главы («basement», «cave», «cold place»…);
  - «I LEAVE ALL THAT I OWN to MY CAT GUPPY» — иконки всех предметов;
  - «XOXO <персонаж>».

  Исключения: смерть от таймера показывает таймер; самоповреждение без другого источника показывает лицо Исаака. — [Isaac wiki.gg: Isaac's last will](https://bindingofisaacrebirth.wiki.gg/wiki/Isaac%27s_last_will)
- **Cult of the Lamb** (код `Lamb.UI.DeathScreen/UIDeathScreenOverlayController.cs`):
  - исходы `Results { Killed, Completed, Escaped, BeatenBoss, GameOver, BeatenBossNoDamage, … }`, у каждого свой заголовок и подзаголовок (`UI_DeathScreen_Killed.Title/Subtitle` и т. п.);
  - `_timeText` — номер дня (`DayNumber`) и длительность похода (`Time.time - dungeonRunDuration`);
  - `_killsText` = `PlayerKillsOnRun`;
  - отдельный элемент `UIDeathScreenLevelNode` — пройденные узлы подземелья;
  - анимированный «штраф» (`ShowPenaltyRoutine`): часть добычи вычёркивается, текст `UI_DeathScreen_Killed.Penalty` с процентом из таблицы сложности. Смерть: 15/25/30 % на Easy/Medium/Hard. Побег: 10/15/20 %;
  - бой без урона даёт отдельные строки (`UI_DeathScreen_NoDamage…`).

  Поля «кто убил» в контроллере нет. — локально: `scratchpad/games/cotl/src/Lamb.UI.DeathScreen/UIDeathScreenOverlayController.cs` стр. 22–31, 584–617, 1045–1071, 1131–1231
- **Cult of the Lamb, скрытая «пощада».** `Health.cs` стр. 1302–1309: при `HP == 1` урон с вероятностью `GetChanceOfNegatingDeath()` (+0.2, если `PlayerWeapon.FirstTimeUsingWeapon`) просто отменяется. Значения: Easy 0.4, Medium 0, Medium-Easy 0.2, Hard 0. — локально `Health.cs`; таблица — раздел 3
- **Hades — Death Defiance / Stubborn Defiance** (гайды):
  - Death Defiance: 3 ранга по 30/500/1000 Darkness; 1–3 лишние жизни, восстанавливает 50 % HP, даёт краткую неуязвимость.
  - Stubborn Defiance (взаимоисключающая альтернатива): 600 Darkness, 30 % HP, «once per chamber». Есть спор на форуме, что лимит — на поход.

  — [Kotaku: beginner guide](https://kotaku.com/everything-you-need-to-know-to-beat-hades-for-the-firs-1845142723); [Prima Games: Mirror of Night](https://primagames.com/gaming/hades-guide-mirror-of-night-upgrades-fated-list-of-prophecies)
- **Hades — статистика.**
  - Успешный поход показывает общее время, число побед другим оружием и лучшие времена.
  - В журнале есть счётчики смертей по типу врага; по словам игрока, кроме «killed by» других сведений о враге нет.

  — [videlais.com: Game Log: Hades](https://videlais.com/tag/hades/); форумная цитата пересказана поисковой выдачей, первичная страница недоступна (требует входа) — [what.thedailywtf.com](https://what.thedailywtf.com/post/1817189)
- **Dead Cells.** Экран статистики после смерти показывает причину, например «Death by curse» (форум, 2019). — [Steam: Death by curse when I wasn't cursed?](https://steamcommunity.com/app/588650/discussions/0/1742229167227855401). В той же теме игроки путаются, откуда проклятие. «Killed by» без объяснения механики не снимает вопрос «почему» (вывод).
- **Mewgenics.** Смерть или поражение оставляет травмы (`injuries.gon`): например, `str` → `INJURY_NAME_BROKENPAW`, `stats { str -1 }`, шрамы и особые анимации (`brokenPawIdle`, `brokenPawWalk`). Последствие видно на самом персонаже. — локально `scratchpad/games/mewgenics/files/data/injuries.gon`

### Inferences
- Для вопроса «почему я умер?» нужно минимум три поля:
  1. **кто** нанёс последний удар — портрет, как в Isaac;
  2. **каким типом урона** — касание / стрела / взрыв / бюст, как «Death by curse» в Dead Cells;
  3. **где** — арена и ряд.

  У CotL есть итог похода, но нет «кто убил». У Isaac есть «кто», но нет «чем». Сочетание обоих — разумная цель (вывод).
- CotL показывает штраф на экране смерти как анимацию вычёркивания добычи. Последствие видно сразу, а не в меню (вывод).
- Скрытая отмена смертельного удара в CotL — тихий механизм «прощения» новичку. В детерминированной игре его надо делать явным и через параметр, иначе он ломает предсказуемость (вывод).

### Gaps
- Внешний вид экрана смерти Hades и Dead Cells (поля, порядок) первоисточниками не подтверждён. Вики fandom/wiki.gg закрыты (402/401), страница Death Defiance на fextralife отдала 404.
- Не проверено, показывает ли Isaac на записке убийцу «составных» смертей (взрыв своей бомбы, урон от шипов).

---

## 3. Баланс сложности: давление по этажам, шансы чемпионов/элит, рост урона, лечение, режимы, открытие контента

### Takeaway
Все шесть игр усложняют **несколькими независимыми ручками**, а не только HP/уроном:
- Isaac: урон ×2 с главы 4; Hard — чемпионы 20 % вместо 5 %, меньше сердец;
- Cult of the Lamb: таблица `DifficultyData` с ~20 множителями и **скрытая динамическая подстройка** по отношению «нанесённый урон / полученный урон»;
- Hades Heat: 15 условий, каждое — одна понятная ручка;
- Dead Cells Boss Cells: в первую очередь режут лечение;
- Mewgenics: бюджет элит/чемпионов по сложности и **щедрее награды на высокой сложности**.

### Cited Findings

**Isaac**
- Урон ½ → 1 сердце с главы 4. — [wiki.gg: Health](https://bindingofisaacrebirth.wiki.gg/wiki/Health); код-комментарий `DAMAGE_NO_MODIFIERS` про «doubled damage from the Womb and later floors» — `enums.lua` стр. 1076
- Шанс чемпиона:
  - Normal/Repentance 5 %, Hard 20 %, The Void 75 %;
  - Champion Belt +15 %;
  - Purple Heart ×2, каждая копия +2 к множителю.

  Цвета появляются постепенно: в Hard жёлтые с Caves; «богатые» чемпионы (Eternal Heart, Locked/Red Chest, Crown, Skull, Rainbow…) — с Depths. — [wiki.gg: Champions](https://bindingofisaacrebirth.wiki.gg/wiki/Champions)
- Hard Mode (вики):
  - +2–3 комнаты на этаж;
  - комнаты сложности «1» реже, «15» разрешены со второго этажа глав 1–4;
  - больше проклятий;
  - чемпион роняет награду в 33 % случаев вместо 100 %;
  - в Repentance удаляется 34 % сердец за зачистку (до Repentance 66 %);
  - Double Heart 2 % вместо 5 %;
  - у части врагов выше скорость движения и выстрелов.

  — [wiki.gg: Hard Mode](https://bindingofisaacrebirth.wiki.gg/wiki/Hard_Mode)
- Перечисление режимов: `Difficulty = { DIFFICULTY_NORMAL=0, DIFFICULTY_HARD=1, DIFFICULTY_GREED=2, DIFFICULTY_GREEDIER=3 }`. В v1.7.8 «Toned down the amount of enemies spawned on the first floor of Greed/Greedier mode» — первый этаж облегчали отдельно. — `enums.lua` стр. 2687–2692; `changelog.txt` стр. 312 (v1.7.8, 21.03.2022)

**Cult of the Lamb (код + ассеты, v1.5.26)**
- `DifficultyManager.Difficulty { Easy=0, Medium=50, Hard=100, ExtraHard=101 }`. Данные грузятся `Resources.LoadAll<DifficultyData>("Data/Difficulty Data")`.
- Выбор по паре (основная сложность, вторичная). **Вторичная сложность определяется скрыто** (`DetermineCurrentDifficulty`, флаг `AssistModeEnabled => true`):
  - навык = `PlayerDamageDealt / max(PlayerDamageReceived, 0.1)`, сумма = `Dealt + Received`;
  - Easy, если навык < 10 и сумма > 100;
  - Hard, если навык > 50 и сумма > 500;
  - иначе Medium.

  Каждая смерть добавляет `PlayerDamageReceived += 50` (`PlayerController.cs` стр. 556). Пересчёт идёт при загрузке игры и смене кооператива (`GameManager.cs` стр. 260, `CoopManager.cs`). — локально `DifficultyManager.cs` стр. 80–98, `PlayerSkillManager.cs`, `Health.cs` стр. 1504–1510
- Значения `DifficultyData` (разбор `resources.assets`; формат «основная_вторичная»):

| Ассет | Лечение (дроп) | Отмена смерти при HP=1 | Урон игрока | Неуязвимость (×1 с) | HP врагов | Смещение очков волны | Удача | Комнат | Штраф смерти/побега, % |
|---|---|---|---|---|---|---|---|---|---|
| Easy_Difficulty_Easy | 2.0 | 0.4 | 1.5 | 2.5 | 0.5 | −3 | 4 | 0.75 | 15/10 |
| Easy_Difficulty (Easy/Medium) | 1.5 | 0.4 | 1.25 | 2.0 | 0.5 | −2 | 3 | 1.0 | 15/10 |
| Easy_Difficulty_Hard | 1.25 | 0.2 | 1.25 | 1.5 | 0.5 | −1 | 2 | 1.0 | 15/10 |
| Medium_Difficulty_Easy | 1.2 | 0.2 | 1.0 | 1.25 | 1.0 | −1 | 2 | 1.0 | 25/15 |
| Medium_Difficulty | 1.0 | 0 | 1.0 | 1.0 | 1.0 | 0 | 1.5 | 1.0 | 25/15 |
| Medium_Difficulty_Hard | 0.9 | 0 | 1.0 | 1.0 | 1.0 | 0 | 1.3 | 1.0 | 25/15 |
| Hard_Difficulty (Hard/Medium) | 1.0 | 0 | 1.0 | 0.75 | 1.25 | 0 | 1.0 | 1.1 | 30/20 |
| Medium_Difficulty_COOP | 0.667 | 0 | 1.0 | 0.667 | 2.0 | 0 | 1.5 | 1.1 | 25/15 |

  — локально: скрипт `scratchpad/tools/scripts/cotl_diff.py` по копии `resources.assets`. Порядок полей взят из `DifficultyData.cs`. Ассеты `Hard_Difficulty_Easy/Hard` и ExtraHard этим разбором не прочитались, см. Gaps.
- «Смещение очков волны» применяется в `EnemyRoundsRandom.cs` стр. 255: `TargetScore + GetEnemyRoundsScoreOffset()`, ограничено снизу 2. Сложность волны задаётся **бюджетом очков врагов**, а лёгкий режим отнимает 1–3 очка из бюджета.
- Кроме выбора сложности есть отдельный флаг перманентной смерти (`DataManager.PermadeDeathActive`, строки `UI/Settings/Difficulty/Permadeath`, предупреждение `FinalWarning`) и режим выживания (`SurvivalModeActive`, голод/сон). — `UIDifficultySelectorOverlayController.cs` стр. 52–67; `DataManager.cs` стр. 393

**Hades**
- Pact of Punishment (Heat):

| Условие | Ранги | Heat за ранг | Эффект |
|---|---|---|---|
| Hard Labor | 5 | 1 | +20 % урона врагов за ранг (до +100 %) |
| Lasting Consequences | 4 | 1 | −25 % лечения за ранг |
| Convenience Fee | 2 | 1 | +40 % цен |
| Jury Summons | 3 | 1 | +20 % врагов |
| Extreme Measures | 3 | 1/2/2 | новые приёмы боссов |
| Calisthenics Program | 2 | 1 | +15 % HP врагов |
| Benefits Package | 2 | 2/3 | +1 перк бронированным |
| Middle Management | 2 | 2 | +1 элита у мини-боссов |
| Underworld Customs | 2 | 2 | −1 дар за регион |
| Forced Overtime | 2 | 3 | +20 % скорости врагов |
| Heightened Security | 1 | 1 | ловушки +400 % урона |
| Routine Inspection | 4 | 2 | −3 таланта зеркала |
| Damage Control | 2 | 1 | +1 щит врагам |
| Approval Process | 2 | 2/3 | −1 вариант выбора |
| Tight Deadline | 2 | 2/3 | −2:00 из 9:00 таймера |

  Награды привязаны к уровню Heat для каждого оружия. Если сразу перепрыгнуть на высокий Heat, награды низших уровней теряются. — [RPG Site: Pact of Punishment](https://www.rpgsite.net/feature/10287-hades-pact-of-punishment-heat-modifiers-and-how-to-maximize-your-rewards); [TrueAchievements walkthrough](https://www.trueachievements.com/game/Hades/walkthrough/7)
- God Mode (Hades и Hades II): 20 % сопротивления урону сразу, +2 % за каждую смерть, потолок 80 %. Скорость убийства врагов не меняется. Kasavin: игроку рогалика нужно умирать, чтобы увидеть разнообразие; «If you're playing for five hours before restarting, then you're not experiencing the cool part»; решение «not a one size fits all». — [Can I Play That: Hades God Mode explained](https://caniplaythat.com/2021/08/11/hades-god-mode-explained-by-supergiant-games); [Dexerto: Hades 2 God Mode](https://www.dexerto.com/gaming/how-to-make-hades-2-easier-god-mode-explained-2695050/)

**Dead Cells**
- Boss Stem Cells. Главная ручка — **лечение между биомами**:
  - 1 BSC: фонтаны HP только в каждом втором переходе, в остальных — заряд фляги;
  - 2 BSC: фонтанов нет, 1 заряд фляги на переход;
  - 3 BSC: всего 3 заряда фляги за поход;
  - 4–5 BSC: зарядов нет;
  - 4+ BSC: враги видят дальше и телепортируются к игроку;
  - 5 BSC: Malaise;
  - на каждом уровне меняются ранние фазы боссов;
  - взамен растут награды: клетки ×2/×3, уровень предметов +1/+3.

  — [deadcells.wiki.gg: Boss Stem Cells](https://deadcells.wiki.gg/wiki/Boss_Stem_Cells)
- Assist Mode:
  - continues 0/1/3/7/∞;
  - автоудар;
  - облегчённое парирование;
  - медленные ловушки;
  - урон ловушек шагом 20 % (минимум 20 %);
  - HP и урон врагов шагом 2.5 % (минимум 20 %).

  Достижения не отключаются; скрывается только результат в Daily. Сделан с участием AbleGamers. — [deadcells.wiki.gg: Assist Mode](https://deadcells.wiki.gg/wiki/Assist_Mode)

**Mewgenics (данные, `data/difficulties.gon`)**
- Уровни 0…+7 (+4 и выше — только через «limit break» квестовым предметом). Для каждого уровня заданы:
  - `boss_health_multiplier`: 1 / 1.2 / 1.4 / 1.6 / 2 / 3 / 4 / 5;
  - `boss_elite_buffs`: 0 / 1 / 2 / 3 / 5 / 7 / 9 / 15;
  - награды растут вместе с риском: `coins_multiplier` и `food_multiplier` 1 / 1.25 / 1.5 / 2 / 5 / 7 / 9…, `bonus_itemroll_luck` 0 / 8 / 16 / 24 / 200 / 400 / 600;
  - отдельные блоки `easy {}` и `hard {}` (лёгкий и трудный путь в главе).

  Бюджеты элит:
  - уровень 0: easy — `elite_budget 0`, `champ_budget 0`; hard — `champ_budget 2`, `champ_chance_mini .25` («chance for maggots, fleas, etc to become champs»);
  - +1: hard — `elite_budget 1`, `champ_budget 2`;
  - +3: hard — `elite_budget 3`;
  - +5: бюджеты 999 и шанс 1.

  — локально `scratchpad/games/mewgenics/files/data/difficulties.gon`
- В каждой главе есть пулы уровней `easy / hard / rare / boss / miniboss / special`. Узел `hard_initial` закрыт до флага `HardPathUnlocked` (`maps/alley.gon`).
- Открытие контента идёт по главам: класс Medic — после `complete_chapter alley`, Thief — после sewers, Necromancer — после boneyard… По умолчанию открыты только `Colorless Fighter Hunter Mage Tank` («classes are a whitelist instead of a blacklist»). — `adventure_progression_unlocks.gon`, `locked_content.gon`

### Inferences
- Повторяющийся приём — **награда растёт вместе с риском**: Mewgenics (монеты/еда ×1.25…×9), Dead Cells (клетки ×2/×3, уровень предметов), Hades (награды за Heat). Ставка «Испытание I–V» в Ashen Oath естественно ложится на эту схему (вывод).
- Dead Cells и Hades (Lasting Consequences) прежде всего режут **лечение**, а не поднимают урон. Это сохраняет читаемость: удары те же, ошибок можно сделать меньше. Повышение урона врагов (Hard Labor, Isaac глава 4) — вторая по частоте ручка (вывод).
- Isaac и Mewgenics вводят «опасные» варианты (жёлтые чемпионы, богатые чемпионы, элиты у мелочи) **не с первого этажа**. Новизна дозируется по этажам (вывод).
- Скрытая подстройка CotL (навык = нанесённый / полученный урон) — образец мягкой адаптивной сложности для новичков. Для детерминированной игры с журналом её можно применять только между боями и только как явный параметр похода, иначе поломается воспроизводимость (вывод).

### Gaps
- Ассеты CotL `Hard_Difficulty_Easy`, `Hard_Difficulty_Hard`, ExtraHard: имена в файле найдены, но проверка длины-префикса не прошла (вероятно, другие суффиксы, например `…d`). Значения не прочитаны.
- Механика CotL «Penitence Mode» не сопоставлена с внутренними флагами (`PermadeDeathActive`, `SurvivalModeActive`) по первоисточнику.
- Isaac: частоты чемпионов по главам в Normal и вес «опасных» комнат по этажам (`stages.xml`) не извлечены из `.a`.
- Hades: число врагов и рост давления по биомам без Heat в первоисточниках не найдены.

---

## 4. Что может перенять Ashen Oath (все пункты — вывод)

### Takeaway
Самые дешёвые и сильные шаги для проблемы «почему я умер?»:
1. единый «белеющий» замах с таймером-заливкой для всех источников урона;
2. экран смерти с портретом убийцы и типом урона;
3. запрет неизбежного урона при старте арены.

Для кривой новичка: регулировать лечение и неуязвимость (по таблице, через `Params`) и вводить новые угрозы не раньше определённого ряда.

### Cited Findings
- Основание — находки разделов 1–3:
  - CotL: `SignPost` + `FlashWhite(Progress/Duration)` + `warningSfx`; i-frames 1 с × множитель; таблица `DifficultyData`; экран смерти без убийцы;
  - Isaac: «I WAS KILLED BY THIS THING», правки «unavoidable damage», чемпион = цвет + одно правило;
  - Mewgenics: `DisplayDangerAOE`, «одна элита-бафф — один маркер», награда растёт со сложностью;
  - Hades: Heat-ручки, God Mode +2 %/смерть;
  - Dead Cells: Boss Cells режут лечение, Assist Mode.

  Ссылки — в соответствующих разделах выше.

### Inferences
1. **Единая грамматика замаха.** Лучник (1 с), сапёр (0.8 с), бюст гоблина (0.6 с) и окно брони элиты показывают **одним и тем же видом**: белая (или иная одна) заливка спрайта растёт от 0 до 1 к моменту урона, плюс короткий звук начала. Сейчас у источников разные формы (круг, фитиль). Достаточно добавить общий слой, не меняя правил. Задача вида (`view/`); симуляция уже знает таймеры.
2. **Зона поражения = форма и время удара**, как правило из разбора Hades II. Круг бюста должен совпадать с хитбоксом, не перекрываться эффектами смерти врагов и не тускнеть при 60 врагах. Проверка — Playwright-скриншот в момент ½ таймера на плотной арене.
3. **Касание (73 % урона) сделать читаемым**, как в CotL, где урон наносит только явный удар. Варианты:
   - (а) короткий видимый «рывок/укус» перед контактным уроном;
   - (б) оставить касание, но подсвечивать врагов, которые сейчас способны ударить при касании.

   Любой из них — новое правило через `Params` со значением по умолчанию, сохраняющим прежнее поведение.
4. **Экран смерти:**
   - портрет того, кто нанёс последний удар (Isaac);
   - тип урона (касание / стрела / взрыв / бюст / броня) — «Death by curse» в Dead Cells;
   - арена и ряд;
   - **последние 3–5 источников урона с отметкой времени** — данных уже достаточно в телеметрии;
   - сводка похода по образцу CotL: узлы, длительность, убийства.

   Это закрывает «why did I die?» без новых правил боя.
5. **Нет неизбежного урона на старте** (Isaac v1.7.5): первые ~0.5–1 с арены враги не наносят контактного урона и не появляются в радиусе R от героя. Это правило через `Params` и проверка журналом в Node.
6. **Кривая для новичков через неуязвимость и лечение, а не через HP врагов.** В CotL Easy даёт i-frames ×2–2.5, лечение ×1.5–2, HP врагов ×0.5 и −2…−3 очка бюджета волны. Для Ashen Oath можно ввести «бюджет волны» по рядам и длину неуязвимости как параметр ряда. Без постоянной силы это совместимо с метой проекта.
7. **Мягкая помощь после смертей** (Hades God Mode +2 %/смерть до 80 %; скрытая подстройка CotL по отношению урона). В рамках «без постоянной силы» её нужно делать **явной, отключаемой и вне ставки** («Испытание» выключает), чтобы не размывать ладдер. Скрытую подстройку CotL копировать не стоит: она противоречит детерминизму журнала и честности ладдера.
8. **Новизна по рядам** (Isaac: жёлтые чемпионы с Caves в Hard, богатые с Depths; Mewgenics: элиты у мелочи только с hard/+1). Каждая новая угроза — с определённого ряда, не больше одной новой на ряд. Это отвечает проблеме «слишком много нового сразу».
9. **«Испытание I–V» как Heat:** каждая ступень — одна понятная ручка (урон касания, меньше лечения, +враги, быстрее фитиль, элиты с доп. аффиксом). Плюс **рост награды вместе с риском** (Mewgenics, Dead Cells). Ступень видна на экране смерти, чтобы игрок связывал смерть с выбранной ручкой.
10. **Элиты: один аффикс — один видимый маркер** (тинт + частица + иконка, Mewgenics `elite_buffs.gon`; цвет чемпиона Isaac = одно правило). Проверить по `eliteBehaviors`, что у каждого аффикса свой и только свой признак.

### Gaps
- Нет данных, какой из вариантов п. 3 (замах перед касанием или подсветка «опасных» врагов) лучше работает при 60 врагах. Нужен плейтест или телеметрия.
- Конкретные пороги (длина неуязвимости, радиус безопасного старта) из чужих игр переносить напрямую нельзя: темп Ashen Oath другой. Значения подбираются замером и плейтестом.
