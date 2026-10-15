# Манифест игр для разбора (15.10.2026)

Подготовка данных к исследованию «Комплексити как ручка баланса». Здесь нет выводов, только что установлено, где лежит и как читать.

Правила работы:
- Установки только в `D:\SteamLibrary`. Игры не запускались.
- Файлы установок не менялись. Всё извлечено из копий в `D:\ashen_research\games\<игра>\`.
- В репозиторий ничего из игр не копировалось. Данные и декомпиляции лежат только на D:.

Владение проверено через `steam://install/<appid>` на аккаунте `xuryrg2033`:
- купленная игра открывает диалог установки;
- некупленная показывает «Сбой: Нет лицензий».

Профиль Steam закрыт, поэтому список игр через веб получить нельзя. Локальный `librarycache` дал тот же ответ, но как доказательство владения он слабее.

## Игры

| Игра (appid) | Владеет | Установлено | Движок / код | Версия | Копия и извлечённое | Главные файлы | Подводные камни |
|---|---|---|---|---|---|---|---|
| **Hades II** (1145350) | **нет** («Нет лицензий») | нет | — | — | — | — | Главный приоритет недоступен. Нужна покупка (решает пользователь) |
| **Hades** (1145360) | **нет** («Нет лицензий») | нет | — | — | — | — | Есть Epic Games Launcher; владение в Epic не проверялось |
| **Slay the Spire** (646570) | да | `D:\SteamLibrary\steamapps\common\SlayTheSpire` (517 МБ) | Java, libGDX | `[V2.3.4] (12-18-2022)`, build 10180494 | `slay_the_spire\copy\desktop-1.0.jar`; `jar_unzipped\` (весь jar); `decomp\cardcrawl\` — Vineflower по `com.megacrit`: 2008 классов, без ошибок | `decomp\cardcrawl\dungeons\{Exordium,TheCity,TheBeyond,TheEnding,AbstractDungeon}.java` — пулы слабых/сильных/элит/боссов по актам (`MonsterInfo` с весами), правила восхождения; `helpers\MonsterHelper.java` — встреча → группа; `monsters\{exordium,city,beyond,ending}\*.java` — ходы и намерения (`getMove`), рост по восхождению, фазы боссов; `unlock\UnlockTracker.java` и `unlock\*` — разблокировки; `jar_unzipped\localization\eng\monsters.json` | Внутренние классы слиты в файлы верхнего уровня. Восхождение размазано: ищите `ascensionLevel` |
| **Hollow Knight** (367520) | да | `D:\SteamLibrary\steamapps\common\Hollow Knight` (4,9 ГБ) | Unity 2020.2.2f1, Mono; PlayMaker | `GAME_VERSION = "1.5.12620"`, build 22529139 | `hollow_knight\copy\`; `decomp\Assembly-CSharp\` (ilspycmd, 2819 .cs), `decomp\PlayMaker\`; `assetripper\ExportedProject\` — 501 сцена `.unity` (YAML) с FSM | Сцены боссов: `assetripper\ExportedProject\Assets\Scenes\Gods_Glory\Bosses\GG_*.unity` (Пантеоны и Зал богов), оригиналы — по зонам (`Fungus\Fungus1_04_boss.unity`, `Deepnest\Deepnest_East_Hornet_boss.unity` и т. п.). FSM `Control` содержит состояния атак (у Hornet: `G Dash`, `Sphere Antic G`, `Throw Antic`…), переходы `toState` и `actionNames`. Код: `HealthManager.cs`, `BossSceneController.cs`, `BossSequence*.cs`, `BossStatue*.cs` | Параметры действий PlayMaker хранятся позиционно (`byteData`, `paramDataType`, `stringParams`…). Числа (скорости, задержки) нужно сопоставлять с порядком полей действия. Удобнее FSMViewAvalonia (сообщество), он не ставился. Старый каталог `C:\...\common\Hollow Knight\hollow_knight_Data` (только `Config.ini`) не тронут |
| **Dead Cells** (588650) | да | `D:\SteamLibrary\steamapps\common\Dead Cells` (2,0 ГБ) | Haxe/Heaps, HashLink, скомпилирован в C (`deadcells.exe`) | build 23762174; в exe строка `2023-10-01` рядом с `BUILD_DATE` (не проверено, что это версия) | `dead_cells\copy\` (`res.pak` и официальные `ModTools`); `res_expanded\` — pak развёрнут официальным PAKTool v1.7.0; `res_expanded\data.cdb` (CastleDB JSON, 2,4 МБ); `cdb_expanded\` — листы, развёрнутые CDBTool v1.7.0 | `data.cdb`, листы: `level` (`mobs` — веса появления, `mobTiers`, `diffSettings`, `mobDensity`, `eliteRoomChance`, `worldDepth`, `nextLevels`); `mob` (135 врагов, `skill[]`); `difficulty` (6 строк Normal…Hell = 0–5 Boss Cells: `extraMobDensity`, `approxUpMobTierRatio`, `eliteExtraLife`, `bossExtraLife`, `extraElitesPerLevel`, `aggressiveMobs`, `levelSettings`, `forgeCaps`); `bossRush`; `biome`; `room` (2191); `infectionRule` | Код боссов нативный (HL/C в exe). Без Ghidra из него можно взять только числа CDB, поведение боссов не читается. `hlboot.dat` на Windows нет. Заметка knowledge: `universal-modder\knowledge\games\dead-cells\libgdx-rebuild-from-res-pak.md` |
| **Enter the Gungeon** (311690) | **нет** | нет | — | — | — | — | — |
| **Risk of Rain 2** (632360) | **нет** | нет | — | — | — | — | — |
| **Vampire Survivors** (1794680) | да | `D:\SteamLibrary\steamapps\common\Vampire Survivors` (1,2 ГБ) | Unity 6000.0.62f1, **IL2CPP** | `bundleVersion 1.16.107`, build 25016043 | `vampire_survivors\copy\`; `assetripper\ExportedProject\` (5,2 ГБ) | `assetripper\ExportedProject\Assets\TextAsset\STAGE_DATA.json` — по этапам и минутам: `enemies`, `bosses`, `minimum`, `frequency`, `treasure`, события; `ENEMY_DATA.json`, `CHARACTER_DATA.json`, `WEAPON_DATA.json`, `POWERUP_DATA.json`, `ACHIEVEMENT_DATA.json` (разблокировки), `ARCANA_DATA.txt`, `LIMITBREAK_DATA.json`, `Adventure*.json`; DLC: `Assets\BundledAssets\dlc\<dlc>\persistent\data\json\*.json` (8 DLC) | IL2CPP: тела методов не декомпилированы, есть только данные. Владение DLC не проверялось, но их бандлы лежат в установке |
| **Brotato** (1942280) | да | `D:\SteamLibrary\steamapps\common\Brotato` (290 МБ) | Godot 3.x, GDScript (байткод 13) | `1.1.15.4` (`progress_data.gd`), build 23429717 | `brotato\copy\`; `recovered\` — GDRE Tools: полный проект, `.gd` декомпилированы; `recovered_dlc_abyssal\` — pck DLC Abyssal Terrors | `recovered\zones\zone_N\NNN\wave_N.tres` (волны по зонам), `zones\zone_N\zone_N_data.tres`, `zones\wave_manager.gd`, `wave_data.gd`, `wave_group_data.gd`, `wave_unit_data.gd`, `zone_data.gd`; враги `entities\units\enemies\*`, боссы `enemies\boss\`, элиты `enemies\elites\`; DLC `recovered_dlc_abyssal\dlcs\dlc_1\{zones,bosses,elites,enemies}` | GDRE не определил ревизию байткода (3.5.0 или 3.2.0), но декомпиляция прошла. Исходные `.gdc` лежат в `.autoconverted\`. Владение DLC не проверялось |
| **Halls of Torment** (2218750) | **нет** | нет | — | — | — | — | — |
| **Inscryption** (1092790) | да | `D:\SteamLibrary\steamapps\common\Inscryption` (3,3 ГБ) | Unity 2019.4.24f1, Mono | `V1.10` (`VersionInfo.asset`), build 8988081 | `inscryption\copy\`; `decomp\Assembly-CSharp\` (ilspycmd, 2098 .cs); `assetripper\ExportedProject\` (4,2 ГБ) | `assetripper\...\Assets\Resources\data\encounterblueprints\{part1,part3,ascension,finale}\*.asset` (72: `minDifficulty`/`maxDifficulty`, `randomReplacementCards`, `dominantTribes`); `data\map\RegionProgression.asset`, `map\regions\`; `data\ascension\`; код `decomp\...\DiskCardGame\EncounterBuilder.cs`, `EncounterBlueprintData.cs`, `*BossOpponent.cs`, `AscensionChallenge*.cs` | Ходы врагов (`turns`) сериализованы Odin в `SerializedBytes` (hex, имена полей в UTF-16). Их надо декодировать отдельно или читать через код `EncounterBlueprintData` |
| **The Binding of Isaac: Rebirth** (250900) | да | уже был: `C:\Program Files (x86)\Steam\steamapps\common\The Binding of Isaac Rebirth` | собственный C++, данные в XML | Repentance, `changelog v1.7.9b (07.12.2022)` | `isaac\copy\` (resources/packed, scripts, официальный `tools\ResourceExtractor`); `isaac\extracted\` — вывод ResourceExtractor (1,1 ГБ); `isaac\rooms_json\` — комнаты `.stb` → JSON (мой скрипт, 79 файлов, каждый разобран ровно до конца файла) | `extracted\resources\` (база) и `extracted\resources-dlc3\` (Repentance поверх): `stages.xml`, `bosspools.xml`, `bossportraits.xml`, `entities2.xml` (id → имя, HP, флаги боссов), `ambush.xml` (волны испытаний), `minibosses.xml`, `itempools.xml`, `achievements.xml`; комнаты: `rooms_json\resources-dlc3\rooms\NN.<этаж>.json` — `difficulty` (1/5/10/15), `weight`, `spawns[].stack[]` (type/variant/subtype); `copy\resources\scripts\enums.lua` | `packed\readme.txt` Nicalis просит не публиковать распакованное и способ вскрытия. Поэтому данные только на D:, в документы — выводы, без дампов. Распаковка сделана официальным ResourceExtractor из `tools\` игры. Запускать из его каталога: `filelist.txt` берётся из текущего каталога, иначе имена файлов теряются. 1846 записей без имени (в основном не данные) |

Ранее разобранные и не тронутые сейчас:
- Balatro;
- Cult of the Lamb;
- Mewgenics;
- Library of Ruina;
- Gloomhaven;
- Divinity: Original Sin 2;
- Barony.

Как их читали: `..\Причины смерти телеграфы и баланс\` (`action_roguelites.md`, `sts_balatro.md`, `tactics.md`). Их копии лежали в scratchpad прошлых сессий. В `D:\ashen_research` их нет.

Monster Hunter Wilds не ставился по заданию.

## Инструменты (`D:\ashen_research\tools\`)

Каждый инструмент скачан с официального GitHub-релиза. SHA-256 сверен с `digest` из GitHub API, все совпали.

| Инструмент | Версия | Где | Для чего |
|---|---|---|---|
| Vineflower | 1.12.0 (`vineflower-1.12.0.jar`, sha256 `1dfcfe97…548b9d`) | `tools\vineflower-1.12.0\` | Java (StS) |
| AssetRipper | 2.0.0 (`AssetRipper_win_x64.zip`, sha256 `9a7ef0e7…01baf7`) | `tools\assetripper-2.0.0\bin\` | Unity: экспорт сцен, MonoBehaviour и TextAsset (HK, Inscryption, VS). Запуск: `--headless --port 39123` (слушает 127.0.0.1), затем HTTP `POST /LoadFolder`, `POST /Export/UnityProject` (поле `Path`). Настройки: `ScriptExportMode=DllExportWithoutRenaming`, `AudioExportFormat=Native`. Процесс остановлен |
| GDRE Tools (gdsdecomp) | v2.7.4, стабильный (`GDRE_tools-v2.7.4-windows.zip`, sha256 `af24c563…bfa0ad`) | `tools\gdre-2.7.4\bin\` | Godot (Brotato): `gdre_tools.exe --headless --recover=<pck> --output=<dir>` |
| ilspycmd | 10.1.0.8386 (уже стоял глобально, `dotnet tool`) | `%USERPROFILE%\.dotnet\tools` | .NET (HK, Inscryption) |
| Официальные инструменты игр | Dead Cells ModTools: PAKTool v1.7.0, CDBTool v1.7.0. Isaac: ResourceExtractor из `tools\` | в копиях игр | — |
| `stb2json.py` (свой) | — | scratchpad сессии (вне репозитория) | Isaac `.stb` → JSON. Формат: `STB1`, u32 число комнат; комната: `<IIIBH` type/variant/subtype/difficulty/длина имени, имя, `<fBBBBH` weight/w/h/shape/двери/спавны; дверь `<hhB`; спавн `<hhB` и стек `<HHHf` |

В `D:\GameResearch\Tools` есть старые инструменты неизвестного происхождения (AssetRipper, Cpp2IL, Ghidra 11.0.3). Они не использовались.

## Объёмы

Новые установки на D: — около 12,2 ГБ при лимите 80 ГБ:
- Hollow Knight — 4,9 ГБ;
- Inscryption — 3,3 ГБ;
- Dead Cells — 2,0 ГБ;
- Vampire Survivors — 1,2 ГБ;
- Slay the Spire — 0,5 ГБ;
- Brotato — 0,3 ГБ.

`D:\ashen_research\games` занимает около 32 ГБ:

| Игра | Объём |
|---|---|
| hollow_knight | 11 ГБ |
| inscryption | 7,5 ГБ |
| vampire_survivors | 6,4 ГБ |
| dead_cells | 4,0 ГБ |
| isaac | 2,2 ГБ |
| slay_the_spire | 0,8 ГБ |
| brotato | 0,7 ГБ |

Steam не перезапускался. Во время работы игры не были запущены.

## Что не удалось и почему

- **Hades, Hades II, Enter the Gungeon, Risk of Rain 2, Halls of Torment** не куплены на этом аккаунте. Steam ответил «Нет лицензий», ничего не покупалось. Для них остаются вики и публичные источники. По Hades можно проверить Epic, если пользователь там владеет.
- **Dead Cells.** Поведение боссов и мобов зашито в нативный exe. Доступны данные CDB, ИИ нет.
- **Vampire Survivors.** Код IL2CPP не декомпилирован. Ghidra и Cpp2IL не запускались: для вопросов о волнах и разблокировках хватает JSON.
- **Hollow Knight.** Параметры действий FSM не декодированы в читаемые значения. Видны состояния, переходы, имена действий и событий.
- **Inscryption.** Odin-сериализованные поля (ходы встреч) не декодированы.
