# Ashen Oath

Браузерная игра реального времени на TypeScript, Vite и PixiJS. Кот-варвар с топором идёт по карте леса: бои на аренах, привалы, находки, события, торговец. Бой — цепь по цвету. Игрок выделяет цепь одноцветных врагов, пока время замедлено, и герой проходит по ней ударами. Поход заканчивается победой над боссом или поражением на любой арене.

Пошаговая версия игры удалена 11.10.2026 по решению пользователя. Её код и документы хранит тег `turn-based-final`. Посмотреть: `git show turn-based-final:README.md`.

Художественный стандарт новых персонажей — [Character Art Style Guide](docs/character-art-style.md).

## Запуск

```sh
npm install
npm run dev
```

Откройте адрес Vite, обычно http://localhost:5173/.

| Адрес | Что открывает |
| --- | --- |
| `/` | Игра: «Новый поход» или карта сохранённого похода |
| `/?seed=N` | Поход с заданным seed (всегда полный стартовый дар, профиль не меняется) |
| `/?sandbox=1` или `/#sandbox` | Песочница: меню арен (клавиши 1–9, 0, Shift+1…), панель отладки, хуки `window.__realtime` |
| `/?sandbox=1&arena=N` | Песочница, сразу арена N |
| `?telemetry=0` | Любой адрес без записи логов |
| `realtime.html` | Перенаправление на корень (адрес запроса и якорь сохраняются) |

Сборка и просмотр:

```sh
npm run build     # tsc --noEmit и vite build
npm run preview
```

## Управление

- **Цепь.** Нажмите на врага в круге вокруг героя и ведите мышь по врагам того же цвета. Следующее звено должно быть в радиусе от предыдущего и на прямой видимости. Пока цепь выделена, мир замедлен. Отпустите кнопку: герой проходит по цепи и бьёт. Esc или правая кнопка отменяет цепь.
- **Глубина звена.** Число у кольца следующего звена — сколько звеньев цепь ещё может взять от него (от 2). Выключается шестерёнкой на карте похода или флажком «Глубина звена» панели отладки.
- **Часы сессии.** Экран конца похода пишет «В игре 47 мин · походов 2». После 90 минут игры без перерыва в 10+ минут на карте (не в бою) появляется одна тихая строка «Хорошее место остановиться — поход сохранён», не чаще раза в 90 минут. Окон и блокировок нет. Выключается шестерёнкой на карте похода («Часы сессии»). Данные — в `localStorage` зрителя, не в журнале.
- **Ходьба:** WASD или стрелки.
- **Прыжок:** Пробел, затем клик в точку (стоит энергию). **Круговой удар:** Q.
- **Расходники:** клавиши 1–4 (холод, бомба, лечение, огонь), прицел мышью.
- **P** — пауза. **N** — отметка «здесь что-то не так» (попадает в лог плейтеста). **Enter** — продолжить после арены.
- В песочнице: **M** — меню арен, **R** — перезапуск арены, **`** или F1 — панель отладки.

Правила цепи, силы, фокуса, прохода, прыжка и кристаллов — [docs/realtime-prototype.md](docs/realtime-prototype.md).

## Структура

| Путь | Что там |
| --- | --- |
| `index.html` | Страница игры |
| `src/realtime/sim/` | Детерминированная симуляция: такт 1/60 с, журнал команд, хэш мира (`hash.ts`), потоки случайности, враги (`enemies/`), арены, составы, сборка |
| `src/realtime/view/` | PixiJS и DOM: рендер, HUD, ввод, камера, экраны похода, панель отладки, панель «Логи» |
| `src/realtime/run/` | Поход: модель (`rtRun.ts`), пулы арен по рядам, составы, талисманы реального времени, сохранения |
| `src/realtime/forest/` | Слой похода: генератор карты, события, торговец, дар, потоки случайности, каталог талисманов, предметы и ресурсы |
| `src/realtime/art/` | Арт героя и местности |
| `src/realtime/telemetry/` | Записи боёв и походов, наблюдатель, отчёт |
| `scripts/` | Замеры ботов и отчёт по логам (`realtime:*`) |
| `vite/` | Приёмник логов на dev-сервере |
| `tests/` | Playwright-тесты и фикстуры журналов (`tests/fixtures/`) |
| `docs/` | Дизайн и история решений |
| `.claude/` | Помощники и скиллы для Claude Code |

Сохранения в `localStorage`: поход `ashen-oath-rt-run-v7` (сохранение `-v6` читается и переводится в `-v7`; поход, начатый до смешения составов 11.10.2026, доигрывается по прежним пулам и составам), профиль `ashen-oath-rt-profile-v1`, параметры панели — `ashen-oath-realtime-params-v17` (версия ключа может расти). Середина арены не сохраняется.

## Проверки

Node-тесты (`tsx`), все без браузера:

| Команда | Что проверяет |
| --- | --- |
| `npm run test:realtime-sim` | Ядро: детерминизм, журналы из браузера и `tests/fixtures/` |
| `npm run test:realtime-detmath` | В симуляции нет `Math.random` и трансцендентных `Math.*` |
| `npm run test:realtime-run` | Поход целиком: карта, арены, дар, привал, торговец, события, сохранение |
| `npm run test:realtime-forest` | Генератор карты и каталог событий |
| `npm run test:realtime-rosters` | Составы арен |
| `npm run test:realtime-enemies`, `-kit`, `-arenas`, `-terrain`, `-slice-terrain`, `-behavior`, `-big-arenas`, `-affixes` | Враги, способности и расходники, арены, местность, поведение, большие арены, аффиксы элит |
| `npm run test:realtime-build`, `-talismans`, `-hammers`, `-relics` | Сборка: талисманы-счётчики, молоты, реликвии |
| `npm run test:realtime-loop`, `-loop-access` | Петля «Печать» (только песочница) и доступ к ней |
| `npm run test:realtime-link-depth` | «Глубина звена»: число у кандидата — путь, который проход проходит; перебор не находит длиннее; хэш не меняется |
| `npm run test:realtime-session` | «Часы сессии»: что такое сессия (перерыв 10 мин, перезагрузка), строка конца похода, строка после 90 минут раз в 90 минут |
| `npm run test:realtime-elite-behaviors`, `-elite-armor` | Поведение и броня элит |
| `npm run test:realtime-slot` | «Однорукий гоблин»: появление, рычаг, барабаны, шансы, стрелы |
| `npm run test:realtime-purse` | Котёл: чек цепи, выплата в двери |
| `npm run test:realtime-greed` | «Раздув за дела»: ступени котла за цепи 3+ после целей, удар снимает ступень, выплата и кость со ступенью, потолок прежний |
| `npm run test:realtime-oath` | Ставка клятвы: каталог, нарушение и выполнение, ×2 / ×0,5 в двери, предложения на узлах, сохранение v7 |
| `npm run test:realtime-die` | Кость у двери: экран после победы с котлом, «Забрать» и бросок ×0,5 / ×2, потолки выплаты, грань по потоку похода без переброса, сохранение v7 |
| `npm run test:realtime-camera` | Камера |
| `npm run test:realtime-telemetry`, `-telemetry-recorder`, `-telemetry-plugin`, `-report` | Схема и запись логов, приёмник dev-сервера, отчёт |

Браузерные тесты (Playwright Chromium, `npx playwright install chromium`):

```sh
npm test                                   # то же, что npx playwright test
npx playwright test tests/realtime-run.spec.ts
```

Набор: песочница, враги, поход, расходники и талисманы, арены, местность, поведение, камера, петля, элиты, «Однорукий гоблин», ставка клятвы, кость у двери, глубина звена и запись логов (`tests/realtime*.spec.ts`). Сервер Vite поднимается сам на порту 4620 (`PLAYWRIGHT_PORT` меняет порт). `RT_GPU=1` оставляет аппаратный GPU; по умолчанию программный рендер. Часть тестов нестабильна под нагрузкой: перед приёмкой прогон повторяют ×3 (`--repeat-each 3`).

Полная проверка: `.claude/skills/verify-all/scripts/verify.sh [--browser]` (typecheck, все `test:*`, сборка, с `--browser` и Playwright). Перед приёмкой её запускают в чистой копии. Даты и результаты прогонов записывают в документ изменения. В старых записях встречаются проверки, которых больше нет (`test:golden` и другие проверки пошаговой игры): это история.

Детерминизм: одинаковые seed и журнал дают одинаковый хэш. Проверка — `npx tsx .claude/skills/determinism-check/scripts/determinism.ts`.

## Замеры и отчёты

| Команда | Что делает |
| --- | --- |
| `npm run realtime:pockets` | Ищет карманы (недоступные места) на аренах |
| `npm run realtime:big-arenas` | Замеры бота на больших аренах |
| `npm run realtime:measure-loops` | Замеры петли «Печать» |
| `npm run realtime:report -- <папка или JSON>` | Отчёт по логам: повтор боёв по журналу, угрозы, урон, цепи |
| `npm run realtime:log-fixtures` | Пересоздаёт фикстуры логов в `tests/fixtures/realtime-logs/` |

Метрики ботов — эвристика, не утверждение о сложности для людей.

## Плейтест и логи

Игра пишет логи боёв и походов в браузер (кольцевой буфер в `localStorage`). Панель «Логи» (кнопка на экране похода) показывает записи; в ней кнопка «Копировать» кладёт JSON в буфер обмена. На dev-сервере запись идёт ещё и в `playtest-logs/` (папка в `.gitignore`). Формат и отчёт — [docs/realtime-telemetry.md](docs/realtime-telemetry.md), порядок сессий — [docs/realtime-playtest.md](docs/realtime-playtest.md).

## Документы

| Документ | О чём |
| --- | --- |
| [realtime-prototype.md](docs/realtime-prototype.md) | Правила боя: цепь, фокус, проход, прыжок, кристаллы, петля; история прототипа |
| [realtime-slice.md](docs/realtime-slice.md) | Поход с аренами: враги, способности, расходники, элиты, арены |
| [roguelike-runs.md](docs/roguelike-runs.md) | Слой похода: генератор карты, потоки, дар, торговец, привал |
| [events.md](docs/events.md), [talismans.md](docs/talismans.md) | Каталог событий; талисманы, клятвы, реликвии |
| [realtime-phase-a.md](docs/realtime-phase-a.md), [realtime-phase-b.md](docs/realtime-phase-b.md) | Фаза A (скорости, составы, лучник) и фаза B (сборка) |
| [realtime-damage.md](docs/realtime-damage.md), [realtime-elite-behaviors.md](docs/realtime-elite-behaviors.md) | Пакет «Урон имеет значение»; поведение элит |
| [realtime-casino.md](docs/realtime-casino.md) | Казино, этап 1: котёл (чек цепи → ресурсы похода), ставка клятвы, «Однорукий гоблин», кость у двери; этап 2: «Раздув за дела» |
| [realtime-stage3.md](docs/realtime-stage3.md) | Этап 3: местность, поведение, камера, большие арены |
| [realtime-telemetry.md](docs/realtime-telemetry.md), [realtime-playtest.md](docs/realtime-playtest.md) | Логи и метрики; протокол плейтеста |
| [realtime-transition.md](docs/realtime-transition.md) | План перехода на реальное время |
| [realtime-design-research.md](docs/realtime-design-research.md), [realtime-loop-research.md](docs/realtime-loop-research.md), [realtime-casino-research.md](docs/realtime-casino-research.md), [realtime-growth-research.md](docs/realtime-growth-research.md) | Исследования и очередь работ |
| [biomes/garrison-roster.md](docs/biomes/garrison-roster.md) | Черновик уровня 2: гарнизон |
| [character-art-style.md](docs/character-art-style.md) | Стиль арта персонажей |
| [design-references.md](docs/design-references.md), [game-teardowns.md](docs/game-teardowns.md), [realtime-references.md](docs/realtime-references.md), [research-meta-progression.md](docs/research-meta-progression.md), [research-run-depth.md](docs/research-run-depth.md) | Источники и разборы других игр |

Память проекта и правила для агентов — [AGENTS.md](AGENTS.md). Перенос на другую машину — [TRANSFER-RU.md](TRANSFER-RU.md).

## Инструменты разработки

Помощники Claude Code лежат в `.claude/agents/`, повторяемые процедуры — в `.claude/skills/`:

- `verify-all` — полная проверка (`verify.sh`);
- `determinism-check` — повтор журналов и свежих боёв, одинаковый хэш;
- `add-mechanic` — новое правило боя (параметр `Params`, хэш, журнал, документы);
- `author-level` — новая арена или состав;
- `docs-sync` — сверка документов с кодом (`doc-refs.sh`);
- `character-art`, `codex-delegate` — арт и делегирование Codex.
