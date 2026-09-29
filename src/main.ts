import './style.css';
import { ForestEngine } from './game/forestEngine';
import { ITEMS, ROOM_NAMES } from './game/campaignContent';
import { ABILITY_COST, JUMP_RANGE } from './game/forestSystems';
import { uniqueEntities } from './game/entityFootprint';
import { planEnemyPhase } from './game/enemyPhase';
import type { AbilityKind, ItemKind, RoomTheme } from './game/forestTypes';
import { BoardRenderer, enemyReadyToAttack } from './render/BoardRenderer';
import { GameAudio } from './audio';
import { LevelEditor } from './editor/LevelEditor';
import { validateCustomLevel } from './game/customLevel';
import { summarizeDamageEffects } from './game/damageEffects';
import { TUTORIAL_LESSONS } from './game/tutorialLevels';
import { deviceTargets } from './game/devices';
import { shieldIsActive } from './game/combatRules';

const SAVE_KEY = 'ashen-oath-campaign-v1';
const VERIFIED_RUN_SEED = 701;
/** Display fallback only until the forest boss is on the board; see forestEngine createCell. */
const FOREST_BOSS_HP = 20;
const scenarios: RoomTheme[] = ['forest', 'gate', 'banquet', 'barracks', 'chess', 'library', 'wizard'];
type Save = { best: number; sound: boolean };
function readSave(): Save {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Partial<Save>;
    return { best: typeof value.best === 'number' && Number.isFinite(value.best) ? Math.max(0, value.best) : 0, sound: value.sound !== false };
  } catch { return { best: 0, sound: true }; }
}
const save = readSave();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* Storage is optional. */ } };
const engine = new ForestEngine();
const audio = new GameAudio();
audio.enabled = save.sound;
let renderer: BoardRenderer | null = null;
let screen: 'title' | 'game' | 'editor' = 'title';
let paused = false, starting = false, outcomeShown = '', previousChain = 0;
let focusedDoor: number | null = null;
let selectedDestination = '';
const itemKeys: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
const itemNames: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const itemIcons: Record<ItemKind, string> = { frost: '❄', bomb: '✹', healing: '✚', fire: '♨' };
const abilityKeys: AbilityKind[] = ['jump', 'spin'];
const abilityNames: Record<AbilityKind, string> = { jump: 'Прыжок', spin: 'Круговой' };
const abilityIcons: Record<AbilityKind, string> = { jump: '↗', spin: '↻' };
const abilityDescriptions: Record<AbilityKind, string> = {
  jump: `До ${JUMP_RANGE} клеток по прямому расстоянию. Удар 4: приземлиться можно на пустой пол или убитого врага.`,
  spin: 'Сразу ударить всех 8 соседних врагов на 4. Кот остаётся на месте.',
};
const tutorialChapter = (index: number) => index < 3 ? 'ОБУЧЕНИЕ' : index < 6 ? 'ЛЕСНАЯ ТРОПА' : index < 10 ? 'К ОПУШКЕ' : index < 13 ? 'ПОД НОГАМИ' : index === 13 ? 'ТЮРЕМЩИК' : 'ЗА СТЕНАМИ';
const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const directionNames = { left: 'Налево', forward: 'Вперёд', right: 'Направо' };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

el('app').innerHTML = `
<header class="site-header"><button class="brand" data-action="title" aria-label="Главная"><span class="brand-mark">✦</span> ASHEN OATH<span class="edition">ДОРОГА К БАШНЕ</span></button><div class="header-actions"><button class="icon-button" id="sound-button" data-action="sound" aria-label="Звук">♫</button><button class="icon-button" data-action="help" aria-label="Правила игры">?</button></div></header>
<main>
  <section id="title-screen" class="title-screen">
    <div class="title-art" aria-hidden="true"><div class="moon"></div><div class="forest-tree tree-one"></div><div class="forest-tree tree-two"></div><div class="forest-tree tree-three"></div><div class="forest-tree tree-four"></div><div class="camp-glow"></div><div class="tent"></div><i class="ember ember-one"></i><i class="ember ember-two"></i><i class="ember ember-three"></i></div>
    <div class="title-content scenario-title"><p class="eyebrow">КОТ. ТОПОР. ИСПОРЧЕННОЕ УТРО.</p><div class="title-cat"><img src="/art/characters/player.png" width="96" height="96" alt=""></div><h1>ASHEN<span>OATH</span></h1><p class="title-tagline">Кот против колдуна</p><p class="title-description">Начни с цепи и безопасного шага. Затем открой ловушки, холод и прыжок на пути к опушке.</p><section class="tutorial-select" aria-label="Первая глава"><p class="tutorial-select-heading">НАЧАЛО ПУТИ <span>1—${TUTORIAL_LESSONS.length}</span></p>${TUTORIAL_LESSONS.map((lesson, index) => `${index === 3 ? '<p class="tutorial-select-heading progression-heading">ЛЕСНАЯ ТРОПА <span>ЛОВУШКИ И ОГОНЬ</span></p>' : index === 6 ? '<p class="tutorial-select-heading progression-heading">К ОПУШКЕ <span>ХОЛОД · ПРЫЖОК · ЦВЕТ</span></p>' : index === 10 ? '<p class="tutorial-select-heading progression-heading">ПОД НОГАМИ <span>ПРОВАЛЫ И МАРШРУТЫ</span></p>' : index === 13 ? '<p class="tutorial-select-heading progression-heading">ТЮРЕМЩИК <span>БОСС И ВЫБОР ПУТИ</span></p>' : ''}<button class="tutorial-choice" data-action="tutorial" data-tutorial="${index}"${index === 0 ? ' id="tutorial-begin-button"' : ''}><span class="tutorial-choice-number">${index + 1}</span><span><b>${lesson.name}</b><small>${lesson.description}</small></span><span class="scenario-arrow" aria-hidden="true">→</span></button>`).join('')}</section><nav class="scenario-list" aria-label="Выбор уровня"><p class="scenario-heading">ИСПЫТАНИЯ · ВСЕ ДОСТУПНЫ</p>${scenarios.map((scenario, index) => `<button class="scenario-choice" data-action="scenario" data-scenario="${scenario}"${scenario === 'forest' ? ' id="begin-button"' : scenario === 'gate' ? ' id="campaign-button"' : ''}><span class="scenario-number">${index + 1}</span><span>${ROOM_NAMES[scenario]}</span><span class="scenario-arrow" aria-hidden="true">→</span></button>`).join('')}</nav><div class="title-links"><button class="text-button" data-action="help">КАК ИГРАТЬ <span>→</span></button></div><div class="title-features"><span>ЛЕС · ВОРОТА · ЗАМОК</span><i>◆</i><span>МЫШЬ И КАСАНИЕ</span></div><p class="title-best" id="title-best"></p></div>
    <div class="title-bottom"><span>ДЛИННЕЕ ЦЕПЬ — СИЛЬНЕЕ УДАР.</span><span>ВЫБЕРИ ДОРОГУ К КОЛДУНУ</span></div>
  </section>
  <section id="game-screen" class="game-screen" hidden>
    <aside class="chapter-panel"><p class="eyebrow" id="chapter-number">ВОЛНА 1 / 3</p><h1 id="level-name">Незваные<br>к завтраку</h1><div class="ornament"><span></span>✦<span></span></div><p class="level-description" id="level-description">Лес ещё спит. Гоблины — уже нет.<br>И кто-то унёс твой котелок.</p><section class="objective-card"><p class="panel-label" id="wave-label">ОТБЕЙ НАЛЁТ</p><div id="objectives"></div></section><div id="wave-steps" class="wave-steps" aria-label="Этапы боя"><span data-wave="1">1 · Гоблины</span><span data-wave="2">2 · Лучники</span><span data-wave="3">3 · Главарь</span></div><div class="chapter-note"><span>✦</span><p id="tutorial-message"></p></div><button class="text-button chapter-select" data-action="title">← В МЕНЮ</button></aside>
    <div class="board-column"><div class="combat-hud"><div class="vitality"><span class="hud-label">ЗДОРОВЬЕ</span><div id="health" class="hearts"></div><div id="damage-effects-summary" class="damage-effects-summary" aria-live="polite" hidden></div></div><div class="turn-counter"><span class="hud-label">ХОД</span><strong id="turn-number">01</strong></div><div class="score-counter"><span class="hud-label">ОЧКИ</span><strong id="score">0</strong></div><button class="icon-button pause-button" data-action="pause" aria-label="Пауза">Ⅱ</button></div><div class="board-frame"><div class="frame-corner corner-tl"></div><div class="frame-corner corner-tr"></div><div class="frame-corner corner-bl"></div><div class="frame-corner corner-br"></div><div id="board-host" role="application" aria-label="Лесная поляна. Начни рядом с котом и веди цепь через гоблинов одного цвета."></div><div id="phase-banner" class="phase-banner" hidden></div></div><div class="board-status" aria-live="polite"><span class="status-dot"></span><span id="status-message">Начни цепочку рядом с котом.</span></div><div class="item-toolbar"><button class="item-button" data-action="frost" id="frost-button"><span class="frost-icon">❄</span><span id="frost-label">Холод · со второй волны</span></button><button class="text-button cancel-item" data-action="cancel-frost" id="cancel-frost" hidden>Отмена</button><button class="wait-button" data-action="wait" id="wait-button" title="+0,5 энергии, максимум 7. Враги атакуют, события поля выполняются." aria-label="Отдых: плюс 0,5 энергии. Враги и события поля действуют.">Отдых · +0,5 энергии</button></div><p id="item-hint" class="item-hint">Флакон холода появится с лучниками.</p><div class="board-footnote"><span>8 НАПРАВЛЕНИЙ · ОТ 2 ЦЕЛЕЙ</span><span>ШАГ НАЗАД — ОТМЕНА</span></div></div>
    <aside class="guide-panel"><section class="chain-card"><p class="panel-label">ЦЕПОЧКА</p><div class="chain-total"><strong id="chain-number">0</strong><span id="chain-rank">НАЧНИ РЯДОМ С КОТОМ</span></div><div class="chain-meter"><span id="chain-meter-fill"></span></div><p id="chain-reward">Запас силы: <b>+1 за врага · −HP цели</b></p><div id="risk-preview" class="risk-preview">Выбери безопасный последний шаг.</div></section><section class="field-guide"><p class="panel-label">КТО ПРИШЁЛ НА ЗАВТРАК</p><div class="guide-row"><span class="enemy-glyph melee-glyph">◇</span><div><b>Гоблин · слабый, 0 HP</b><p>Бьёт только по сторонам. Злится до попадания, затем ход спокоен.</p></div></div><div class="guide-row"><span class="enemy-glyph ranged-glyph">⌖</span><div><b>Лучник · 7 HP</b><p>Стреляет в отмеченную линию, затем ход отдыхает. На отдыхе может поменяться местами с соседом.</p></div></div><div class="guide-row"><span class="enemy-glyph boss-glyph">♛</span><div><b>Главарь · 20 HP</b><p>Бесцветный: подходит любая цепь. Пока жив, дальше пройти нельзя.</p></div></div></section><div class="sigil-key"><span class="sigil red">▲</span><span class="sigil green">✚</span><span class="sigil blue">□</span><span class="sigil gold">●</span><span class="sigil purple">✕</span><span>ЦВЕТ + ЗНАК</span></div><div class="guide-tip"><b>ПОСЛЕДНЯЯ КЛЕТКА РЕШАЕТ</b><p>Последнего врага можно ранить. Проверь, где закончится цепь и кто сможет ответить.</p></div></aside>
  </section>
</main>
<footer class="site-footer"><span>ASHEN OATH <i>•</i> ДОРОГА К БАШНЕ</span><span>ПОСЛЕДНИЙ ШАГ РЕШАЕТ.</span></footer>
<div id="modal-layer" class="modal-layer" hidden><section id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"></section></div>`;

el('item-hint').insertAdjacentHTML('afterend', '<div class="intent-legend" aria-label="Обозначения намерений"><span class="intent-attack">! Атака</span><span class="intent-move">⇄ Обмен</span><span class="intent-rest">… Отдых</span></div><p id="intent-summary" class="intent-summary" aria-live="polite"></p>');
el('intent-summary').insertAdjacentHTML('afterend', '<p id="shield-summary" class="intent-summary" hidden></p>');
el('intent-summary').insertAdjacentHTML('afterend', '<p id="device-summary" class="device-summary" aria-live="polite" hidden></p>');
el('shield-summary').insertAdjacentHTML('afterend', '<p id="palette-summary" class="intent-summary" hidden></p>');
el('title-screen').insertAdjacentHTML('afterend', '<section id="editor-screen" class="editor-screen" hidden></section>');
document.querySelector('.title-links')!.insertAdjacentHTML('afterbegin', '<button class="text-button" id="editor-button" data-action="editor">СОЗДАТЬ УРОВЕНЬ <span>✎</span></button>');
const titleHero = document.createElement('div');
titleHero.className = 'title-hero';
document.querySelector('.title-content')!.prepend(titleHero);
for (const selector of ['.title-content > .eyebrow', '.title-cat', '.title-content > h1', '.title-tagline', '.title-description']) titleHero.append(document.querySelector(selector)!);
document.querySelector('.title-description')!.textContent = 'Освой цепи и ловушки, победи тюремщика и выбери путь дальше.';
document.querySelectorAll<HTMLButtonElement>('.tutorial-choice').forEach((choice, index) => {
  const lesson = TUTORIAL_LESSONS[index];
  choice.title = lesson.description;
  choice.setAttribute('aria-label', `Бой ${index + 1}. ${lesson.name}. ${lesson.description}`);
});
// Beside «В меню»: the board column keeps its full height for the field at 1280×720.
document.querySelector('.chapter-select')!.insertAdjacentHTML('afterend', '<button class="text-button editor-return" id="return-editor" data-action="editor" hidden>← В РЕДАКТОР · черновик сохранён</button>');
// Keep the battle surface quiet: persistent state stays outside, reference material opens on demand.
const roomDetails = document.createElement('details');
roomDetails.className = 'room-details';
roomDetails.innerHTML = '<summary>О бое и пути <span aria-hidden="true">⌄</span></summary>';
document.querySelector('.chapter-panel')!.insertBefore(roomDetails, document.querySelector('.chapter-select'));
for (const selector of ['.level-description', '#wave-steps', '.chapter-note']) roomDetails.append(document.querySelector(selector)!);
const fieldDetails = document.createElement('details');
fieldDetails.className = 'field-details';
fieldDetails.innerHTML = '<summary>Враги и знаки <span aria-hidden="true">⌄</span></summary>';
document.querySelector('.guide-panel')!.append(fieldDetails);
for (const selector of ['.field-guide', '.sigil-key', '.guide-tip']) fieldDetails.append(document.querySelector(selector)!);
fieldDetails.append(document.querySelector('.intent-legend')!);
const editor = new LevelEditor(el('editor-screen'), async definition => {
  if (starting) return false;
  const checked=validateCustomLevel(definition);
  if(!checked.valid)throw new Error(checked.errors.join(' '));
  let reason='Не удалось подготовить начальное поле.';
  const unsubscribe=engine.subscribe((_state,event)=>{if(event.type==='invalid'&&event.text)reason=event.text;});
  let started=false;
  try{started=engine.startCustomLevel(definition);}finally{unsubscribe();}
  if(!started)throw new Error(reason);
  await openScene(() => {}); return true;
});
el('wave-steps').insertAdjacentHTML('afterend', '<nav id="route-map" class="route-map" aria-label="Путь к колдуну" hidden></nav><section id="door-guide" class="door-guide" hidden><p class="panel-label">ВЫХОДЫ НА ПОЛЕ</p><div id="door-options"></div><p id="door-detail">Наведи на дверь, чтобы увидеть следующий зал.</p></section>');
el('board-host').closest('.board-frame')!.insertAdjacentHTML('beforebegin', '<section id="hazard-card" class="hazard-card" hidden aria-live="polite"><span class="hazard-mark">⌖</span><div><strong id="hazard-title"></strong><p id="hazard-detail"></p></div></section>');
document.querySelector('.combat-hud')!.insertAdjacentHTML('beforebegin', '<div id="compact-room-heading"><b id="compact-room-name"></b><span id="compact-room-goal"></span></div>');
document.querySelector('.combat-hud')!.insertAdjacentHTML('beforeend', '<div id="mobile-chain-readout" hidden aria-live="polite"><span><small>ЦЕПОЧКА</small><b id="mobile-chain-count">0</b></span><span><small>СИЛА</small><b id="mobile-chain-power">0</b></span><span><small id="mobile-chain-status">ОТВЕТ</small><b id="mobile-chain-damage">0 HP</b></span></div>');
el('frost-button').closest('.item-toolbar')!.innerHTML = itemKeys.map(item => `<button class="item-button" data-action="item" data-item="${item}" id="${item}-button" title="${ITEMS[item].description}"><span class="frost-icon">${itemIcons[item]}</span><span id="${item}-label">${itemNames[item]} · 0</span></button>`).join('') + '<button class="text-button cancel-item" data-action="cancel-frost" id="cancel-frost" hidden>Отмена</button><button class="wait-button" data-action="wait" id="wait-button" title="+0,5 энергии, максимум 7. Враги атакуют, события поля выполняются." aria-label="Отдых: плюс 0,5 энергии. Враги и события поля действуют.">Отдых · +0,5 энергии</button>';
const gridLabel = (index: number) => `${String.fromCharCode(65 + index % engine.state.cols)}${Math.floor(index / engine.state.cols) + 1}`;
document.querySelector('.pause-button')!.insertAdjacentHTML('beforebegin', '<div class="energy-hud"><span class="hud-label">ЭНЕРГИЯ</span><strong id="energy-value">0 / 7</strong><div id="energy-meter" class="energy-meter" role="progressbar" aria-label="Энергия" aria-valuemin="0" aria-valuemax="7"><span></span></div></div>');
document.querySelector('.item-toolbar')!.insertAdjacentHTML('beforebegin', `<div class="ability-toolbar" aria-label="Способности">${abilityKeys.map(kind => `<button class="ability-button" id="${kind}-ability" data-action="ability" data-ability="${kind}"><span class="ability-icon">${abilityIcons[kind]}</span><span>${abilityNames[kind]} <b id="${kind}-cost"></b></span></button>`).join('')}</div><p id="ability-hint" class="ability-hint">Обычная цепь: +0,5 энергии за каждого атакованного врага.</p><button id="cancel-ability" class="text-button cancel-ability" data-action="cancel-ability" hidden>Отменить способность</button>`);
const actionDock = document.createElement('div');
actionDock.className = 'action-dock';
document.querySelector('.board-status')!.after(actionDock);
for (const selector of ['.ability-toolbar', '#ability-hint', '#cancel-ability', '.item-toolbar', '#item-hint', '#intent-summary', '#device-summary', '#shield-summary', '#palette-summary']) actionDock.append(document.querySelector(selector)!);
function placeActionDock() {
  if (screen !== 'game') return;
  const desktop = window.matchMedia('(min-width: 981px)').matches;
  const destination = desktop ? document.querySelector('.guide-panel')! : document.querySelector('.board-column')!;
  if (actionDock.parentElement === destination) return;
  if (desktop) document.querySelector('.field-details')!.before(actionDock);
  else document.querySelector('.board-status')!.after(actionDock);
}
window.addEventListener('resize', placeActionDock);

function showScreen(next: typeof screen) {
  screen = next;
  el('title-screen').hidden = next !== 'title';
  el('game-screen').hidden = next !== 'game';
  el('editor-screen').hidden = next !== 'editor';
  if (next === 'editor') editor.show();
  el('app').classList.toggle('playing', next === 'game');
  renderer?.setActive(next === 'game');
  renderer?.setItemTargeting(null);
  if (engine.state.chosenAbility) engine.setAbility(null);
  el('title-best').textContent = save.best ? `Лучший результат: ${save.best.toLocaleString('ru-RU')}` : '';
  hideModal();
}
async function openScene(action: () => unknown | Promise<unknown>) {
  if (starting) return;
  // While starting, updateHUD must not treat the previous fight's WIN/LOSE as a fresh outcome.
  starting = true; audio.unlock(); audio.play('click'); outcomeShown = ''; previousChain = 0; focusedDoor = null; selectedDestination = '';
  let opened = false;
  showScreen('game');
  try {
    await action();
    if (!renderer) {
      // Keep a failed renderer out of `renderer`: the next scene retries instead of opening an empty board.
      const next = new BoardRenderer(el('board-host'), engine);
      next.onItemTargetingChange = () => updateHUD();
      next.onDoorFocus = index => { focusedDoor = index; updateHUD(); };
      try { await next.init(); }
      catch (error) { next.destroy(); el('board-host').replaceChildren(); throw error; }
      renderer = next;
      renderer.setActive(screen === 'game');
    }
    opened = true;
  } catch (error) {
    console.error('Не удалось открыть поляну:', error);
    showModal('<h2 id="modal-title">Не удалось открыть поляну</h2><p class="modal-copy">Браузер не дал нарисовать поле боя. Попробуй открыть бой ещё раз; если не поможет — обнови страницу или включи аппаратное ускорение графики.</p><button class="button primary" data-action="title">НА ГЛАВНУЮ</button>');
  } finally { starting = false; }
  if (opened) updateHUD();
}
const startGame = (scenario: RoomTheme, seed = VERIFIED_RUN_SEED) => openScene(() => engine.startScenario(scenario, seed));
const startTutorial = (index = 0) => openScene(() => engine.startTutorial(index));
const startLevel = (index = 0) => startGame(index === 0 ? 'forest' : index === 1 ? 'gate' : 'banquet');
function uniqueDoors() {
  const seen = new Set<number>();
  return engine.state.board.flatMap((cell, index) => {
    if (!cell?.door || seen.has(cell.id)) return [];
    seen.add(cell.id); return [{ cell, index }];
  });
}
function updateDoorInfo() {
  const state = engine.state;
  if (state.customLevel) {
    el('door-detail').textContent = state.customLevel.goalCompletedTurn === null ? 'Выход откроется после выполнения всех целей.' : 'Выход открыт. Заверши цепь на двери; соседнюю дверь можно выбрать одну.';
    return;
  }
  const selected = [...state.chain].reverse().find(index => state.board[index]?.door);
  const index = selected ?? focusedDoor;
  const cell = index === null || index === undefined ? undefined : state.board[index];
  if (selected !== undefined && cell?.door) selectedDestination = ROOM_NAMES[cell.door.destination];
  if (!cell?.door) {
    el('door-detail').textContent = state.room.key.held ? 'Ключ у кота. Соседнюю дверь можно выбрать одну и отпустить.' : 'Наведи на дверь: увидишь тип следующего зала.';
    return;
  }
  const open = state.room.key.held || cell.door.breached || cell.hp <= 0;
  const condition = open ? 'Проход открыт. Если дверь рядом с котом, выбери её одну и отпусти.' : cell.door.magic ? 'Печать: нужен ключ или бомба. Затем войди цепочкой.' : `Ворота: ${cell.hp}/${cell.maxHp} HP. Ключ откроет их сразу.`;
  el('door-detail').textContent = `${directionNames[cell.door.branch]} · ${ROOM_NAMES[cell.door.destination]}. ${condition}`;
}
let guideTheme = '';
function updateGuide() {
  const state = engine.state;
  const sentinelPresent=state.board.some(cell=>cell?.variant==='sentinel');
  const wardrobePresent=state.board.some(cell=>cell?.variant==='wardrobe');
  const guideKey=`${state.room.theme}/${state.tutorial?.index ?? 'none'}/${!!state.customLevel}/${sentinelPresent}/${wardrobePresent}`;
  if (guideTheme === guideKey) return;
  guideTheme = guideKey;
  const rows: [string, string, string][] = state.tutorial ? [
    ['◇', 'Слабый гоблин · 0 HP', 'Гибнет от удара и не тратит запас силы. Вооружённые гоблины отвечают по отмеченным клеткам.'],
    ['✦', state.tutorial.index === 0 ? 'Цвет цепи' : 'Отмеченная цель', state.tutorial.index === 0 ? 'Проведи цепь через соседей одного цвета.' : 'Золотая метка показывает охранника с HP, которого нужно победить.'],
    ['↗', 'Последний шаг', state.tutorial.index === 2 ? 'Смотри запас силы и прогноз ответа вооружённого врага до отпускания цепи.' : 'Каждый враг даёт +1 к силе; слабый с 0 HP не тратит его.'],
  ] : state.customLevel ? [
    ['✎', 'Авторский бой', 'Карта, цели и начальные враги заданы в редакторе. Повтор возвращает состояние на входе.'],
    ['⇥', 'Выход после цели', 'Закрытая дверь ждёт выполнения целей. Затем дойди до неё цепью.'],
    ['●', 'Палитра пополнения', 'Новые цвета могут вступать после цели. Уже стоящие враги не перекрашиваются.'],
  ] : state.room.kind === 'forest' ? [
    ['◇', 'Гоблин · слабый, 0 HP', 'Гибнет от удара, не тратит запас силы. Бьёт только по сторонам.'],
    ['⌖', 'Лучник · 7 HP', 'После выстрела отдыхает и может обменяться местами с соседом.'],
    ['♛', 'Главарь · 20 HP', 'Бесцветный: подходит любая цепь. Через живого пройти нельзя.'],
  ] : state.room.kind === 'gate' ? [
    ['⚿', 'Ключ командира', 'После 12 боевых убийств прибывает командир. Забери его ключ.'],
    ['▥', 'Ворота · 200 HP', 'Можно открыть ключом или разбить ударами. Для входа нужна цепочка.'],
    ['⌖', 'Залп со стены', 'Каждые три хода. Отмеченные клетки опасны после твоего действия.'],
  ] : state.room.kind === 'wizard' ? [
    ['✦', 'Колдун', 'Сначала печать на 18 HP, затем колдун на 24 HP. Разрушение печати остановит цепь.'],
    ['↗', 'Длинный подход', 'Слабые враги добавляют бюджет без расхода. Последний несмертельный удар сохранит рану.'],
    ['✚', 'Последний запас', 'Расходники сохранялись для этого боя. Лечение тоже занимает подготовку хода.'],
  ] : state.room.theme === 'chess' ? [
    ['♜', 'Ладья', 'Угрожает по прямым линиям. Смотри заранее выбранные клетки.'],
    ['♝', 'Слон', 'Диагональные направления. Стены прерывают линии атаки.'],
    ['♞', 'Конь', 'Геометрия буквой Г. Его угрозу нельзя оценить только по соседству.'],
  ] : [
    ['⚿', 'Хранитель ключа', 'Бесцветный противник носит ключ. Убери его и выбери выход.'],
    sentinelPresent
      ? ['▣', 'Страж-щит · 7 HP', 'Золотая грань закрывает вход цепи спереди. Обойди сбоку или заморозь мокрого стража.']
      : wardrobePresent ? ['▥', 'Живой гардероб · 10 HP', 'Один враг занимает четыре клетки. Здоровье общее; удар засчитывается один раз.']
      : ['♜', 'Ожившая обстановка', 'Мебель и стража действуют по отмеченным клеткам. Проверяй последний шаг.'],
    ['⇥', 'Магическая дверь', 'Ключ или бомба снимают печать. Физический удар без них не откроет проход.'],
  ];
  const lesson = state.tutorial ? TUTORIAL_LESSONS[state.tutorial.index] : undefined;
  if (lesson?.definition.completion === 'exit') rows[1] = ['⇥', 'Путь к выходу', 'После первого хода дверь открывается. Дойди до неё цепью; остальных врагов побеждать не обязательно.'];
  if (state.board.some(cell => cell?.variant === 'jailer')) rows.push(['▣', 'Тюремщик', 'Щит закрывает вход цепи спереди. Тяжёлый удар наносит 2 урона по отмеченным клеткам. Затем один ход передышки со снятым щитом — даже после промаха.']);
  if (state.board.some(cell => cell?.variant === 'beacon')) rows.push(['♧', 'Колокол подкреплений', 'Каждый второй активный ход вызывает до двух вооружённых гоблинов на отмеченные клетки. Уничтожь колокол, чтобы прекратить подкрепления.']);
  if (lesson?.allowedItems?.includes('frost')) rows.push(['❄', 'Холод и вода', 'Выбери холод, затем мокрую цель. Она пропустит действие и получит двойной следующий физический удар. После этого проведи цепь.']);
  if (lesson?.allowedAbilities?.includes('jump')) rows.push(['↗', 'Прыжок · 2 энергии', 'Каждый атакованный враг даёт 0,5 энергии. Прыжок наносит 4 урона и переносит кота на выбранную клетку.']);
  if (state.tutorial && state.tutorial.index >= 8) rows.push(['✦', 'Огонёк меняет цвет', 'Начни с врага. Пройди через огонёк и продолжи любым цветом, сохранив накопленную силу.']);
  if (state.tutorial && state.board.some(cell => cell?.kind === 'ranged')) rows.push(['⌖', 'Стрелок и обмен', 'Лучник стреляет по отмеченной линии, затем отдыхает. Знак ⇄ показывает будущий обмен: учитывай его при выборе позиции.']);
  if (state.devices?.some(device => device.kind === 'arrows')) rows.push(['⌁', 'Рычаг стрел', 'Включи его по пути после врага. После цепи залп ранит всех на отмеченной линии, включая кота. Устройство сохраняет цвет и не добавляет силу.']);
  if (state.devices?.some(device => device.kind === 'pits')) rows.push(['▱', 'Рычаг провалов', 'Люки открываются после цепи: обычные враги падают, для кота падение смертельно. Закончишь на люке — погибнешь. Следующий ход они непроходимы, затем закрываются. Под боссами, дверями и крупными врагами люк заклинивает.']);
  if (state.devices?.some(device => device.kind === 'fire')) rows.push(['♨', 'Жаровня', 'После неё каждый следующий удар этой цепи добавляет 1 горение выжившему врагу. Горение ранит в конце хода. На следующую цепь усиление не переносится.']);
  document.querySelector('.field-guide')!.innerHTML = '<p class="panel-label">ПРАВИЛА ЭТОГО МЕСТА</p>' + rows.map(([icon, title, description]) => `<div class="guide-row"><span class="enemy-glyph">${icon}</span><div><b>${title}</b><p>${description}</p></div></div>`).join('');
}
function updateHUD() {
  const state = engine.state;
  if (!state.level || !state.room) return;
  const targeting = renderer?.itemTargeting ?? null;
  const input = state.phase === 'PLAYER_INPUT';
  const forest = state.room.kind === 'forest';
  const gate = state.room.kind === 'gate';
  const custom = state.customLevel;
  const tutorial = state.tutorial;
  const lesson = tutorial ? TUTORIAL_LESSONS[tutorial.index] : undefined;
  const allowedAbilities = lesson?.allowedAbilities ?? [];
  const allowedItems = lesson?.allowedItems ?? [];
  el('game-screen').classList.toggle('tutorial-room', !!tutorial);
  el('game-screen').classList.toggle('tutorial-abilities', !!tutorial && allowedAbilities.length > 0);
  el('game-screen').classList.toggle('tutorial-items', !!tutorial && allowedItems.length > 0);
  el('game-screen').classList.toggle('tutorial-intents', !!tutorial && tutorial.index >= 9);
  el('return-editor').hidden = !custom || !!tutorial;
  const chosenAbility = state.chosenAbility;
  document.querySelector('.board-footnote > span')!.textContent = gate || state.room.kind === 'castle' ? '8 НАПРАВЛЕНИЙ · ПРОХОД: 1' : '8 НАПРАВЛЕНИЙ · ОТ 2 ЦЕЛЕЙ';
  el('energy-value').textContent = `${energyText(state.player.energy)} / 7`;
  el('energy-meter').setAttribute('aria-valuenow', String(state.player.energy));
  el('energy-meter').setAttribute('aria-valuetext', `${energyText(state.player.energy)} из 7`);
  el('energy-meter').firstElementChild!.setAttribute('style', `width:${state.player.energy / 7 * 100}%`);
  for (const kind of abilityKeys) {
    const cost = ABILITY_COST[kind];
    const button = el<HTMLButtonElement>(`${kind}-ability`);
    el(`${kind}-cost`).textContent = energyText(cost);
    button.hidden = !!tutorial && !allowedAbilities.includes(kind);
    button.disabled = !!tutorial && !allowedAbilities.includes(kind) || !input || state.player.energy < cost;
    button.classList.toggle('selected', chosenAbility === kind);
    button.setAttribute('aria-pressed', String(chosenAbility === kind));
    button.title = `${kind === 'spin' ? 'Круговой удар' : abilityNames[kind]} · ${energyText(cost)} энергии. ${abilityDescriptions[kind]}`;
    button.setAttribute('aria-label', button.title);
  }
  el('ability-hint').textContent = chosenAbility ? `${abilityNames[chosenAbility]}: ${abilityDescriptions[chosenAbility]} Esc — отмена.` : 'Обычная цепь: +0,5 энергии за каждого атакованного врага. Предел — 7.';
  el('ability-hint').hidden = !chosenAbility;
  el('cancel-ability').hidden = !chosenAbility;
  el('app').classList.toggle('campaign-active', !forest);
  el('game-screen').classList.toggle('castle-room', !forest);
  el('game-screen').classList.toggle('tall-room', state.rows > state.cols + 1);
  document.querySelector<HTMLElement>('.board-column')!.style.setProperty('--board-ratio', String(state.cols / state.rows));
  placeActionDock();
  el('board-host').style.aspectRatio = `${state.cols} / ${state.rows}`;
  el('board-host').setAttribute('aria-label', `${state.level.name}. Поле ${state.cols} на ${state.rows}. Начинай цепь рядом с котом.`);
  el('level-name').textContent = state.level.name;
  el('level-description').textContent = state.level.description;
  el('compact-room-name').textContent = state.level.name;
  el('compact-room-goal').textContent = state.room.key.held ? '⚿ Ключ найден' : gate ? `${Math.min(12, state.room.combatKills)}/12 · командир` : state.room.kind === 'wizard' ? 'Финальный бой' : `Зал ${state.room.depth}/3 · найди ключ`;
  el('chapter-number').textContent = forest ? `ВОЛНА ${state.wave} / 3` : gate ? 'ШТУРМ ЗАМКА' : state.room.kind === 'wizard' ? 'БАШНЯ КОЛДУНА' : `ЗАЛ ${state.room.depth} / 3`;
  el('wave-label').textContent = forest ? state.waveLabel : state.room.kind === 'wizard' ? 'ЗАКОНЧИ ПОХОД' : 'ПУТЬ ВПЕРЁД';
  el('wave-steps').hidden = !forest;
  document.querySelectorAll<HTMLElement>('[data-wave]').forEach(step => {
    step.classList.toggle('active', Number(step.dataset.wave) === state.wave);
    step.classList.toggle('complete', Number(step.dataset.wave) < state.wave);
  });
  const depth = forest ? 0 : gate ? 1 : state.room.kind === 'wizard' ? 5 : state.room.depth + 1;
  el('route-map').hidden = forest;
  el('route-map').innerHTML = ['Лес', 'Ворота', 'Зал I', 'Зал II', 'Зал III', 'Башня'].map((name, index) => `<span class="route-node ${index === depth ? 'current' : index < depth ? 'visited' : ''}" ${index === depth ? 'aria-current="step"' : ''}>${index < depth ? '✓' : index + 1}<small>${name}</small></span>`).join('');
  const doors = uniqueDoors();
  el('door-guide').hidden = !doors.length;
  el('door-options').innerHTML = doors.map(({ cell, index }) => `<span class="door-chip"><b>${directionNames[cell.door!.branch]}</b> ${ROOM_NAMES[cell.door!.destination]} <small>${gridLabel(index)}</small></span>`).join('');
  updateDoorInfo(); updateGuide();
  if (custom) {
    el('route-map').hidden=true;el('wave-steps').hidden=true;
    el('chapter-number').textContent='АВТОРСКИЙ УРОВЕНЬ';
    el('wave-label').textContent=custom.goalCompletedTurn===null?'ВЫПОЛНИ ЦЕЛИ':'ЦЕЛЬ ВЫПОЛНЕНА';
    el('compact-room-goal').textContent=custom.goalCompletedTurn===null?'Выполни цели':custom.definition.completion==='exit'?'Выход открыт':'Победа';
    el('door-options').textContent=custom.goalCompletedTurn===null?'⇥ Закрыт до цели':'⇥ Выход открыт';
  }
  if (tutorial && lesson) {
    el('chapter-number').textContent = `${tutorialChapter(tutorial.index)} · БОЙ ${tutorial.index + 1} / ${TUTORIAL_LESSONS.length}`;
    el('wave-label').textContent = lesson.definition.completion === 'exit' ? 'ДОБЕРИСЬ ДО ВЫХОДА' : tutorial.index === 0 ? 'ПРОВЕДИ ЦЕПЬ' : 'ПОБЕДИ ОТМЕЧЕННЫХ';
    el('compact-room-goal').textContent = `Бой ${tutorial.index + 1} / ${TUTORIAL_LESSONS.length}`;
    el('wave-steps').hidden = true;
    el('route-map').hidden = true;
    el('door-guide').hidden = true;
  }
  el('tutorial-message').textContent = forest ? state.wave === 1
    ? state.turn === 0 ? 'Начни рядом с котом. Соедини ещё хотя бы одного врага.' : 'Разозлённый гоблин не успокоится от промаха. Устрани его или держись вне замаха.'
    : state.wave === 2 ? 'Лучники раздавили обычных гоблинов. Ищи их прицелы и обмены местами.' : 'Главарь бесцветный. Разгони удар или рани и вернись.'
    : state.level.tutorial;
  if (tutorial && lesson) el('tutorial-message').textContent = tutorial.hintDismissed ? '' : lesson.hint;
  document.querySelector<HTMLElement>('.chapter-note')!.hidden = !!tutorial?.hintDismissed;
  el('health').innerHTML = state.player.maxHp > 10
    ? `<span class="health-numeric" aria-hidden="true">${state.player.hp} / ${state.player.maxHp} ♥</span>`
    : Array.from({ length: state.player.maxHp }, (_, i) => `<span class="heart ${i < state.player.hp ? 'full' : 'empty'}" aria-hidden="true">♥</span>`).join('');
  el('health').setAttribute('aria-label', `Здоровье: ${state.player.hp} из ${state.player.maxHp}`);
  const activeEffects = summarizeDamageEffects(state.player.damageEffects);
  const effectCounts = [activeEffects.burning ? `Горение ×${activeEffects.burning}` : '', activeEffects.poison ? `Яд ×${activeEffects.poison}` : '', activeEffects.bleeding ? `Кровотечение ×${activeEffects.bleeding}` : ''].filter(Boolean);
  el('damage-effects-summary').hidden = effectCounts.length === 0;
  el('damage-effects-summary').textContent = effectCounts.join(' · ');
  el('turn-number').textContent = String(state.turn + (input ? 1 : 0)).padStart(2, '0');
  if (custom?.definition.turnLimit) el('turn-number').textContent+=` / ${custom.definition.turnLimit}`;
  el('score').textContent = state.score.toLocaleString('ru-RU');
  const boss = state.board.find(cell => cell?.kind === 'boss');
  if (tutorial && lesson) {
    const total = tutorial.index === 0 ? lesson.definition.goals.find(goal => goal.key === 'kills')?.target ?? 7 : tutorial.targetIds.length;
    const progress = Math.min(total, tutorial.index === 0 ? state.objective.kills : state.objective.tutorialTargets ?? 0);
    const label = tutorial.index === 0 ? 'Побеждено гоблинов' : 'Отмеченные охранники';
    const chapterBoss = boss && (boss.variant === 'jailer' || boss.variant === 'beacon') ? boss : undefined;
    el('objectives').innerHTML = lesson.definition.completion === 'exit'
      ? `<p class="key-status">⇥ ${custom?.goalCompletedTurn === null ? 'Откроется после первого хода' : 'Выход открыт'}</p><p class="objective-note">Дойди до двери. Остальные враги могут остаться.</p>`
      : chapterBoss ? `<div class="objective tutorial-objective"><div><span>${chapterBoss.variant === 'jailer' ? 'Тюремщик' : 'Колокол'} · HP</span><strong>${chapterBoss.hp}<small> / ${chapterBoss.maxHp}</small></strong></div><div class="objective-track"><span style="width:${(1 - chapterBoss.hp / chapterBoss.maxHp) * 100}%"></span></div></div>`
      : `<div class="objective tutorial-objective"><div><span>${label}</span><strong>${progress}<small> / ${total}</small></strong></div><div class="objective-track"><span style="width:${total ? progress / total * 100 : 0}%"></span></div></div>`;
  } else if (custom) {
    const labels={kills:'Победить врагов',rangedKills:'Победить стрелков',bossKills:'Победить главарей',turns:'Выдержать ходы'};
    el('objectives').innerHTML=custom.definition.goals.map(goal=>`<div class="objective"><div><span>${labels[goal.key]}</span><strong>${Math.min(goal.target,state.objective[goal.key])}<small> / ${goal.target}</small></strong></div><div class="objective-track"><span style="width:${Math.min(100,state.objective[goal.key]/goal.target*100)}%"></span></div></div>`).join('')+(custom.goalCompletedTurn!==null&&custom.definition.completion==='exit'?'<p class="objective-note">⇥ Выход открыт. Войди цепью.</p>':'');
  } else if (forest) el('objectives').innerHTML = state.level.objectives.map(req => {
    const isBoss = req.key === 'bossKills';
    const progress = Math.min(state.objective[req.key] ?? 0, req.target);
    // Before the boss arrives there is no cell to read; FOREST_BOSS_HP mirrors the engine's spawn value.
    const bossMax = boss?.maxHp ?? FOREST_BOSS_HP;
    const value = isBoss ? boss?.hp ?? (state.phase === 'WIN' ? 0 : bossMax) : progress;
    const maximum = isBoss ? bossMax : req.target;
    const fill = isBoss ? (bossMax - value) / bossMax : progress / req.target;
    return `<div class="objective"><div><span>${isBoss ? 'Главарь · HP' : req.label}</span><strong>${value}<small> / ${maximum}</small></strong></div><div class="objective-track"><span style="width:${fill * 100}%"></span></div></div>`;
  }).join('');
  else {
    const holder = state.board.find(cell => cell?.carriesKey);
    const keyText = state.room.key.held ? '⚿ Ключ у кота' : state.room.key.droppedAt !== null ? `⚿ Ключ на ${gridLabel(state.room.key.droppedAt)}` : holder ? `⚿ Носитель ключа: ${holder.hp} HP` : gate ? `Командир: ${Math.min(12, state.room.combatKills)} / 12 убийств` : 'Найди хранителя ключа';
    el('objectives').innerHTML = state.room.kind === 'wizard'
      ? `<div class="objective"><div><span>${boss?.bossStage === 1 ? 'Печать колдуна' : 'Колдун'} · HP</span><strong>${boss?.hp ?? 0}<small> / ${boss?.maxHp ?? 1}</small></strong></div><div class="objective-track"><span style="width:${boss ? (1 - boss.hp / boss.maxHp) * 100 : 100}%"></span></div></div>`
      : `<p class="key-status ${state.room.key.held ? 'held' : ''}">${keyText}</p><p class="objective-note">${gate ? 'Ключ или 200 урона воротам. Войди цепочкой.' : 'Ключ или бомба. Заверши цепь на выбранной двери.'}</p>`;
  }
  const preview = engine.preview(), count = state.chain.length;
  document.querySelector('.chain-card')!.classList.toggle('active', count > 0);
  const forecastEffects = summarizeDamageEffects(preview.endEffects);
  const pendingEffects = [forecastEffects.burning ? `горение ×${forecastEffects.burning}` : '', forecastEffects.poison ? `яд ×${forecastEffects.poison}` : '', forecastEffects.bleeding ? `кровотечение ×${forecastEffects.bleeding}` : ''].filter(Boolean);
  const lastHit = preview.hits[preview.hits.length - 1];
  el('mobile-chain-readout').hidden = !input || count === 0;
  el('mobile-chain-readout').classList.toggle('danger', preview.damage > 0 || pendingEffects.length > 0);
  el('mobile-chain-count').textContent = String(count);
  el('mobile-chain-power').textContent = preview.opensDoor !== undefined ? 'ВХОД' : preview.completesRoom ? 'ПОБЕДА' : String(lastHit?.remainingPower ?? preview.power);
  el('mobile-chain-status').textContent = !preview.valid ? 'ПРОДОЛЖАЙ' : 'ОТВЕТ';
  el('mobile-chain-damage').textContent = !preview.valid ? 'ЕЩЁ ЦЕЛЬ' : preview.damage ? `−${preview.damage} HP` : pendingEffects.length ? 'ЭФФЕКТ' : '0 HP';
  el('chain-number').textContent = String(count);
  el('chain-number').classList.toggle('powered', preview.power >= 5);
  el('chain-rank').textContent = preview.opensDoor !== undefined ? 'ДВЕРЬ В СЛЕДУЮЩИЙ ЗАЛ' : preview.completesRoom ? 'ПОБЕДНЫЙ УДАР' : count >= 2 ? 'ОТПУСТИ ДЛЯ УДАРА' : count === 1 ? 'ПРОДОЛЖАЙ ЦЕПЬ' : 'НАЧНИ РЯДОМ С КОТОМ';
  el('chain-meter-fill').style.width = `${Math.min(100, preview.power / 7 * 100)}%`;
  const budgetLine = lastHit ? `Запас: <b>${lastHit.availablePower}</b> · потрачено: <b>${lastHit.powerSpent}</b> · осталось: <b>${lastHit.remainingPower}</b>` : 'Каждый враг: <b>+1 к силе</b>. Слабый (0 HP) тратит 0.';
  el('chain-reward').innerHTML = preview.opensDoor !== undefined ? '<b>Вход в выбранную дверь</b><br>Затем выбери одну награду.' : preview.completesRoom ? '<b>Противник будет повержен</b><br>Бой завершится до ответа врагов.' : `${budgetLine}${lastHit ? preview.endsOnSurvivor ? `<br>После удара: ${lastHit.hpAfter} HP` : `<br>Побеждено: ${preview.kills}` : ''}`;
  if (lastHit?.attackEffect === 'fire' && !lastHit.killed) el('chain-reward').innerHTML += '<br>+1 горение · урон в конце хода, после ответа врагов.';
  if (preview.createsPrism) el('chain-reward').innerHTML += '<br><b>+ ОГОНЁК · смена цвета</b>';
  if ((!tutorial || allowedAbilities.length) && preview.valid && preview.energyGain > 0) el('chain-reward').innerHTML += `<br>Энергия: <b>+${energyText(preview.energyGain)}</b>`;
  const activations = preview.deviceActivations ?? [];
  if (activations.length) el('chain-reward').innerHTML += `<br>${activations.map(device => device.kind === 'fire' ? '♨ Огонь: +1 горение после жаровни' : device.kind === 'pits' ? '▱ Провалы после цепи' : '⌁ Залп после цепи').join('<br>')}`;
  if (preview.trapHits?.length) el('chain-reward').innerHTML += `<br>Ловушка: <b>${preview.trapKills ?? 0}</b> повержено · ${preview.trapHits.filter(hit => !hit.killed).length} ранено`;
  const forecastParts = [preview.trapDamage ? `ловушка ${preview.trapDamage}` : '', preview.volleyDamage ? `залп ${preview.volleyDamage}` : '', preview.movementDamage ? `кровотечение при шагах ${preview.movementDamage}` : '', preview.effectDamage ? `горение/яд ${preview.effectDamage}` : ''].filter(Boolean);
  el('risk-preview').textContent = count === 0 ? 'Выбери безопасный последний шаг.' : !preview.valid ? preview.reason : preview.damage > 0 ? `⚠ После цепи: −${preview.damage} HP${forecastParts.length ? ` (${forecastParts.join('; ')})` : ''}${preview.playerDies ? ' · смертельно' : ''}${pendingEffects.length ? `. Останется: ${pendingEffects.join(', ')}` : ''}` : pendingEffects.length ? `⚠ После хода: ${pendingEffects.join(', ')}` : '✓ Конец цепи безопасен';
  el('risk-preview').classList.toggle('danger', count > 0 && (!preview.valid || preview.damage > 0 || pendingEffects.length > 0));
  el('status-message').textContent = targeting ? `${ITEMS[targeting].label}: выбери цель на поле.` : chosenAbility === 'jump' ? `Прыжок: выбери клетку приземления в пределах ${JUMP_RANGE}.` : count > 0 ? preview.valid ? `Целей: ${count} · кот остановится: ${gridLabel(preview.endIndex)}` : preview.reason : focusedDoor !== null ? el('door-detail').textContent ?? '' : state.message || 'Начни цепочку рядом с котом.';
  const actors = uniqueEntities(state.board);
  const ready = actors.filter(({cell, index}) => enemyReadyToAttack(cell, index)).length;
  const resting = planEnemyPhase(state.board, state.player.index).resting.length;
  const frozen = actors.filter(({cell}) => cell.status.frozen > 0).length;
  const swaps = engine.previewRotations().filter(rotation => rotation.active)
    .map(rotation => `${gridLabel(rotation.from)} ↔ ${gridLabel(rotation.to)}`);
  if (preview.pitCells?.length) el('chain-reward').innerHTML += `<br>Откроются: ${preview.pitCells.map(gridLabel).join(', ')}${preview.pitCells.includes(preview.endIndex) ? '<br><b>ПАДЕНИЕ — СМЕРТЬ</b>' : ''}`;
  if (preview.pitImmuneCells?.length) el('chain-reward').innerHTML += `<br>Заклинит: ${preview.pitImmuneCells.map(gridLabel).join(', ')}`;
  const devices = state.devices ?? [];
  el('device-summary').hidden = !devices.length;
  el('device-summary').textContent = devices.map(device => device.kind === 'pits' ? `▱ ${gridLabel(device.index)} · ${device.charges} зар. · люки: ${device.targets.map(gridLabel).join(', ')}${state.pits?.length ? ' · открыты на этот ход' : ''}` : device.kind === 'fire' ? `♨ ${gridLabel(device.index)}: жаровня · зарядов ${device.charges}. +1 горение ударам после неё в этой цепи.` : `⌁ ${gridLabel(device.index)}: рычаг · зарядов ${device.charges}. Залп ${device.damage ?? 4} после цепи: ${deviceTargets(state, device).map(gridLabel).join(', ')}. Уведи кота с линии.`).join(' · ');
  el('intent-summary').textContent = `Готовы атаковать: ${ready} · Отдыхают: ${resting}${frozen ? ` · Во льду: ${frozen}` : ''}${swaps.length ? `. Обмен: ${swaps.join('; ')}.` : ''}`;
  const summonCount = state.board.reduce((sum, cell) => sum + (cell?.variant === 'beacon' ? cell.intent?.summonCells?.length ?? 0 : 0), 0);
  if (summonCount) el('intent-summary').textContent += ` · Подкрепления: ${summonCount}`;
  const shields = state.board.flatMap((cell, index) => (cell?.variant === 'sentinel' || cell?.variant === 'jailer') && cell.shield
    ? [`${gridLabel(index)} ${!shieldIsActive(cell) ? cell.status.frozen ? '❄ щит снят' : 'щит снят · окно для удара' : cell.shield.dx > 0 ? '→' : cell.shield.dx < 0 ? '←' : cell.shield.dy > 0 ? '↓' : '↑'}`] : []);
  el('shield-summary').hidden = shields.length === 0;
  el('shield-summary').textContent = `Щиты: ${shields.join(' · ')}. Цепью заходи сбоку.`;
  const colorNames=['Киноварь ▲','Мох ✚','Лазурь □','Охра ●','Аметист ✕'];
  el('palette-summary').hidden=!custom || !!tutorial && tutorial.index < 8;
  if(custom && (!tutorial || tutorial.index >= 8)){const extra=custom.definition.extraColors.map(entry=>{const remaining=custom.goalCompletedTurn===null?null:Math.max(0,custom.goalCompletedTurn+entry.afterGoalTurns-state.turn);return`${colorNames[entry.color]}: ${remaining===null?`после цели +${entry.afterGoalTurns}`:remaining?`через ${remaining} ход.`:'в пополнении'}`;});el('palette-summary').textContent=`Палитра: ${custom.paletteWeights.map((weight,i)=>weight>0?colorNames[i]:null).filter(Boolean).join(', ')}.${extra.length?' '+extra.join(' · '):''}`;}
  el('hazard-card').hidden = !gate || !!tutorial;
  el('game-screen').classList.toggle('hazard-active', !el('hazard-card').hidden);
  el('hazard-card').classList.toggle('imminent', state.hazard.turnsUntil <= 1);
  el('hazard-title').textContent = state.hazard.turnsUntil <= 1 ? 'ЗАЛП ПОСЛЕ ЭТОГО ХОДА' : `ДО ЗАЛПА: ${state.hazard.turnsUntil} ХОДА`;
  el('hazard-detail').textContent = state.hazard.turnsUntil <= 1 ? `Отмеченные клетки · ${state.hazard.damage} HP урона` : 'Клетки залпа будут показаны за ход до удара.';
  const phases: Record<string, string> = { PLAYER_RESOLVE: 'УДАРЫ ТОПОРА', ENEMY_RESOLVE: 'ПРОТИВНИКИ ОТВЕЧАЮТ', BOARD_UPDATE: 'ПОЛЕ МЕНЯЕТСЯ' };
  el('phase-banner').hidden = !phases[state.phase]; el('phase-banner').textContent = phases[state.phase] ?? '';
  for (const item of itemKeys) {
    const button = el<HTMLButtonElement>(`${item}-button`), quantity = state.inventory[item];
    button.hidden = !!tutorial && !allowedItems.includes(item) || (forest && item !== 'frost' && quantity === 0);
    button.disabled = !!tutorial && !allowedItems.includes(item) || !input || quantity < 1 || state.itemPrepared || (item === 'healing' && !engine.previewItem('healing').valid);
    button.classList.toggle('targeting', targeting === item); button.setAttribute('aria-pressed', String(targeting === item));
    button.setAttribute('aria-label', `${ITEMS[item].label}: ${quantity}. ${ITEMS[item].description}`);
    el(`${item}-label`).textContent = `${itemNames[item]} · ${quantity}`;
  }
  el('cancel-frost').hidden = !targeting;
  const waitButton = el<HTMLButtonElement>('wait-button');
  waitButton.disabled = !input || !!targeting || !!chosenAbility;
  waitButton.textContent = tutorial && !allowedAbilities.length ? 'Пропустить ход' : 'Отдых · +0,5 энергии';
  waitButton.setAttribute('aria-label', tutorial && !allowedAbilities.length ? 'Пропустить ход. Враги действуют.' : 'Отдых: плюс 0,5 энергии. Враги и события поля действуют.');
  el('item-hint').textContent = targeting ? `${ITEMS[targeting].description} Esc — отменить выбор.` : state.itemPrepared ? 'Средство применено. Проведи цепь или отдохни; затем действуют враги.' : tutorial ? state.inventory.frost > 0 ? 'Холод действует на мокрую цель. Один флакон перед цепью; повтор восстановит запас.' : 'Холод: нет флаконов. Продолжай цепью или доступной способностью.' : forest ? state.inventory.frost ? 'Мокрый + холод: пропуск действия и двойной следующий удар.' : 'Флакон холода появится с лучниками.' : 'Один расходник перед цепью. Запасы переходят в следующий зал.';
  el('item-hint').hidden = !targeting && !state.itemPrepared;
  document.querySelectorAll<HTMLButtonElement>('[data-action="title"], [data-action="help"], [data-action="pause"], [data-action="editor"]').forEach(button => { button.disabled = Boolean(phases[state.phase]) && screen === 'game'; });
  if (count > previousChain) audio.play('select', count);
  previousChain = count;
  if (input && outcomeShown) { outcomeShown = ''; hideModal(); }
  if (!starting && ['REWARD', 'WIN', 'LOSE'].includes(state.phase) && outcomeShown !== state.phase && screen === 'game') {
    outcomeShown = state.phase;
    if (state.phase === 'REWARD') showRewards(); else showOutcome(state.phase === 'WIN');
  }
}
function showModal(html: string) {
  el('modal').classList.toggle('branch-outcome', html.includes('data-action="tutorial-choice"'));
  el('modal').innerHTML = html; el('modal-layer').hidden = false;
  document.querySelectorAll<HTMLElement>('.site-header, main, .site-footer').forEach(background => { background.inert = true; });
  requestAnimationFrame(() => el('modal').querySelector<HTMLButtonElement>('button')?.focus());
}
function hideModal() {
  el('modal-layer').hidden = true; paused = false;
  document.querySelectorAll<HTMLElement>('.site-header, main, .site-footer').forEach(background => { background.inert = false; });
}
function showRewards() {
  renderer?.setItemTargeting(null);
  const state = engine.state;
  const chosen = uniqueDoors().find(({ cell }) => cell.door?.branch === state.selectedExit)?.cell.door;
  const destination = chosen ? ROOM_NAMES[chosen.destination] : selectedDestination || 'Следующая комната';
  audio.play('reward');
  showModal(`<p class="eyebrow">КОМНАТА ПРОЙДЕНА</p><h2 id="modal-title">Одна вещь в дорогу</h2><p class="modal-copy">Путь уже выбран: <b>${destination}</b>.<br>Возьми один предмет — и продолжим.</p><div class="reward-options">${state.rewards.map(reward => `<button class="reward-choice" data-reward="${reward.item}"><span class="reward-icon">${itemIcons[reward.item]}</span><span><b>${reward.label} <em>+1</em></b><small>${reward.description}</small></span></button>`).join('')}</div><p class="reward-note">Остальные предметы останутся здесь. Запасы сохранятся.</p>`);
}
function showOutcome(won: boolean) {
  const state = engine.state, forest = state.room.kind === 'forest';
  renderer?.setItemTargeting(null);
  if (state.tutorial) {
    const index = state.tutorial.index;
    const lesson = TUTORIAL_LESSONS[index];
    const choices = lesson.nextLessonIndices ?? (index + 1 < TUTORIAL_LESSONS.length ? [index + 1] : []);
    const fork = choices.length > 1;
    const last = choices.length === 0;
    audio.play(won ? 'reward' : 'damage');
    const copy = !won ? 'Повтор восстановит точную стартовую расстановку и здоровье.'
      : fork ? 'За стенами два пути. Ускользнуть к выходу или остановить подкрепления?'
      : last ? 'Первая глава позади. В лесном испытании тебя ждут три волны врагов.'
      : `Дальше: ${TUTORIAL_LESSONS[choices[0]].name}. ${TUTORIAL_LESSONS[choices[0]].description}`;
    const next = !won ? '' : fork ? `<div class="reward-options">${choices.map(nextIndex => `<button class="reward-choice" data-action="tutorial-choice" data-next-lesson="${nextIndex}"><span class="reward-icon">${nextIndex === choices[0] ? '⇥' : '♧'}</span><span><b>${TUTORIAL_LESSONS[nextIndex].name}</b><small>${TUTORIAL_LESSONS[nextIndex].description}</small></span></button>`).join('')}</div>`
      : `<button class="button primary" data-action="${last ? 'tutorial-forest' : 'next-tutorial'}">${last ? 'К ЛЕСНОМУ ИСПЫТАНИЮ →' : 'СЛЕДУЮЩИЙ БОЙ →'}</button>`;
    showModal(`<p class="eyebrow">${tutorialChapter(index)} · ${index + 1} / ${TUTORIAL_LESSONS.length}</p><div class="outcome-symbol ${won ? '' : 'defeat'}">${won ? '✦' : '✕'}</div><h2 id="modal-title">${won ? fork ? 'Тюремщик повержен' : index < 3 ? 'Приём освоен' : last ? 'За стенами' : 'Путь свободен' : 'Попробуй другой путь'}</h2><p class="modal-copy">${copy}</p><div class="result-stats"><span><b>${state.turn}</b>ХОДЫ</span><span><b>${state.player.hp}/${state.player.maxHp}</b>ЗДОРОВЬЕ</span></div>${next}<button class="button secondary" data-action="retry">ПОВТОРИТЬ БОЙ</button><button class="text-button" data-action="title">К СПИСКУ УРОВНЕЙ</button>`);
    return;
  }
  if (state.customLevel) {
    audio.play(won?'reward':'damage');
    showModal(`<p class="eyebrow">АВТОРСКИЙ УРОВЕНЬ</p><h2 id="modal-title">${won?'Уровень пройден':'Попробуй другой путь'}</h2><p class="modal-copy">${won?'Цель достигнута. Вернись к карте, чтобы изменить бой, или повтори с тем же зерном.':'Повтор восстановит начальное поле, здоровье, предметы и палитру.'}</p><div class="result-stats"><span><b>${state.score}</b>ОЧКИ</span><span><b>${state.turn}</b>ХОДЫ</span></div><button class="button primary" data-action="editor">В РЕДАКТОР</button><button class="button secondary" data-action="retry">ПОВТОРИТЬ УРОВЕНЬ</button><button class="text-button" data-action="title">К СПИСКУ УРОВНЕЙ</button>`);
    return;
  }
  if (won) { save.best = Math.max(save.best, state.score); persist(); }
  audio.play(won ? 'win' : 'lose');
  const title = won ? forest ? 'Завтрак спасён!' : 'Колдун повержен' : 'Коту нужен отдых';
  const copy = won ? forest ? 'Котелок вернулся. Но след налётчиков ведёт к замку. Продолжим?' : 'Заклинания рассыпались. От костра до башни — весь путь позади.' : 'Вернись ко входу в эту комнату с тем же здоровьем и запасом предметов.';
  const stars = state.player.hp >= state.player.maxHp - 1 ? 3 : state.player.hp >= 2 ? 2 : 1;
  showModal(`<p class="eyebrow">${won ? forest ? 'ЛАГЕРЬ СНОВА ТВОЙ' : 'ПОХОД ЗАВЕРШЁН' : 'ПОСЛЕДНИЙ ШАГ БЫЛ ОПАСНЫМ'}</p><div class="outcome-symbol ${won ? '' : 'defeat'}">${won ? '✦' : '✕'}</div><h2 id="modal-title">${title}</h2><p class="modal-copy">${copy}</p>${won ? `<div class="reward-stars" aria-label="Награда: ${stars} из 3">${'✦'.repeat(stars)}<span>${'✦'.repeat(3 - stars)}</span></div>` : ''}<div class="result-stats"><span><b>${state.score.toLocaleString('ru-RU')}</b>ОЧКИ</span><span><b>${state.turn}</b>ХОДЫ</span><span><b>${state.player.hp}/${state.player.maxHp}</b>ЗДОРОВЬЕ</span></div><button class="button primary" data-action="${won ? forest ? 'continue' : 'new-run' : 'retry'}">${won ? forest ? 'К ВОРОТАМ ЗАМКА →' : 'ПРОЙТИ ПОХОД ЗАНОВО' : 'ПОВТОРИТЬ КОМНАТУ'}</button>${won && forest ? '<button class="button secondary" data-action="retry">ЕЩЁ ОДИН ЗАВТРАК</button>' : ''}<button class="text-button" data-action="title">В МЕНЮ</button>`);
}
function showHelp() {
  engine.cancelChain(); renderer?.setItemTargeting(null); paused = true;
  if (screen === 'game' && engine.state.tutorial) {
    const lesson = TUTORIAL_LESSONS[engine.state.tutorial.index];
    showModal(`<p class="eyebrow">БОЙ ${engine.state.tutorial.index + 1} / ${TUTORIAL_LESSONS.length}</p><h2 id="modal-title">${lesson.name}</h2><p class="modal-copy">${lesson.hint} Веди цепь через соседние клетки одного цвета. Отпусти мышь или палец после двух целей. Вернись на предыдущую клетку, чтобы убрать последний шаг.</p><button class="button primary" data-action="resume">ВЕРНУТЬСЯ В БОЙ</button>`);
    return;
  }
  showModal(`<p class="eyebrow">НАСТАВЛЕНИЕ КОТУ-ВАРВАРУ</p><h2 id="modal-title">Один топор. Много дверей.</h2><div class="help-rules"><p><b>Цепочка и последний шаг</b>Начни рядом с котом и проведи через цели одного цвета по горизонтали, вертикали или диагонали. Диагональ закрыта, только если обе боковые клетки непроходимы. Каждый враг добавляет 1 к бюджету удара. Враг с 0 HP слабый: гибнет от удара и ничего не тратит. Остальные тратят своё HP из бюджета; если бюджета не хватило, последний враг выживет с раной. Последнего врага можно ранить, но пройти через живого нельзя. Кот остаётся на последней освобождённой клетке. Бесцветные цели подходят к любому цвету. Вернись на шаг назад, чтобы сократить цепь. В походе и авторских уровнях 8 убийств за цепь оставляют огонёк, если есть место и на поле меньше двух. Через него можно сменить цвет внутри следующей цепи; начать с огонька нельзя.</p><p><b>Красные клетки — будущая атака</b>Разозлённый гоблин бьёт только четырёх соседей по сторонам и остаётся опасным до попадания по коту. Лучник стреляет в отмеченную линию, затем отдыхает. Знак ⇄ связывает две клетки. Гибель врага не отменяет обмен: его место займёт пополнение. Кот на любом конце или живой враг во льду остановят обмен. Во дворе замка каждые три хода приходит залп; отсчёт и опасные клетки показаны заранее.</p><p><b>Ключ, ворота и три направления</b>У ворот 12 убийств вызовут командира с ключом. Можно открыть створки ключом или нанести им 200 урона. Внутри замка ищи хранителя ключа: магические двери не берутся обычным ударом. Бомба снимет печать с одной двери. В доступную соседнюю дверь можно войти одним выбором: выбери её и отпусти. Для боя по-прежнему нужны две цели. Наведи на выход, чтобы увидеть следующий зал; дороги назад нет.</p><p><b>Энергия и способности</b>Обычная цепь даёт +0,5 энергии за каждого атакованного врага, максимум 7. Прыжок стоит 2: дальность ${JUMP_RANGE}, физический удар 4, приземление только на пустой пол или убитого врага. Круговой удар стоит 3 и сразу бьёт всех восьмерых соседей на 4, оставляя кота на месте. Выбор прыжка отменяется повторным нажатием либо Esc. Энергия переносится между комнатами. Отдых даёт +0,5 энергии до предела 7 и запускает обычный ход врагов со всеми событиями поля.</p><p><b>Направленный щит</b>Железный страж закрывает золотой гранью переднюю сторону. Вход цепи с этой стороны запрещён; направление подхода считается от предыдущей цели. Обойди сбоку. Лёд отключает щит мокрого стража. Прыжок, круговой удар и предметы игнорируют направление щита, но сохраняют обычные требования урона и приземления.</p><p><b>Один предмет перед цепью</b>Холод замораживает мокрого врага и даёт хрупкость. Бомба повреждает выбранного врага или снимает печать двери. Огонь накладывает горение на выбранную и соседние клетки без мгновенного урона; горение и яд ранят в конце хода. Кровотечение ранит после каждых трёх обычных шагов, а ветер усиливает уже горящую цель. Лечение возвращает здоровье и снимает яд и кровотечение даже при полном HP, но не тушит огонь. Выбери предмет и цель, затем проведи цепь или выбери отдых. Esc отменит выбор цели. Лёд приостанавливает действия и отдых врага.</p><p><b>Комнаты и награды</b>За дверью выбери одну из трёх наград. Инвентарь переносится дальше; повтор комнаты восстанавливает запас на входе, а не дублирует добычу. В шахматном зале ладья действует по прямой, слон — по диагонали, конь — буквой Г; обмен фигур следует той же геометрии. Живой шкаф может защищать связанного соседа: убей или заморозь шкаф, чтобы снять защиту.</p><p><b>Лесное обучение</b>Сначала 8 гоблинов, затем 2 лучника и главарь. Подкрепление раздавливает случайного обычного гоблина; это не твоё убийство. Мокрую цель для холода можно найти в луже E2. Лимита ходов нет.</p></div><button class="button primary" data-action="resume">${screen === 'game' ? 'ВЕРНУТЬСЯ В БОЙ' : 'ПОНЯТНО'}</button>`);
}
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  if (!el('modal-layer').hidden && !el('modal').contains(target)) return;
  audio.unlock();
  if (target.dataset.reward && itemKeys.includes(target.dataset.reward as ItemKind)) {
    void openScene(() => engine.chooseReward(target.dataset.reward as ItemKind)); return;
  }
  switch (target.dataset.action) {
    case 'scenario': {
      const scenario = target.dataset.scenario as RoomTheme;
      if (scenarios.includes(scenario)) void startGame(scenario);
      break;
    }
    case 'tutorial': {
      const index = Number(target.dataset.tutorial);
      if (Number.isInteger(index) && index >= 0 && index < TUTORIAL_LESSONS.length) void startTutorial(index);
      break;
    }
    case 'tutorial-choice': {
      const index = Number(target.dataset.nextLesson);
      const lesson = engine.state.tutorial ? TUTORIAL_LESSONS[engine.state.tutorial.index] : undefined;
      if (engine.state.phase === 'WIN' && Number.isInteger(index) && lesson?.nextLessonIndices?.includes(index)) void openScene(() => engine.startTutorialChoice(index));
      break;
    }
    case 'next-tutorial': void openScene(() => engine.nextTutorial()); break;
    case 'tutorial-forest': void startGame('forest'); break;
    case 'begin': void startLevel(); break;
    case 'campaign': void startGame('gate'); break;
    case 'random-campaign': {
      const random = new Uint32Array(1);
      do { crypto.getRandomValues(random); } while (random[0] === engine.state.run.seed || random[0] === VERIFIED_RUN_SEED);
      void startGame('gate', random[0]); break;
    }
    case 'continue': void openScene(() => engine.continueCampaign()); break;
    case 'retry': void openScene(() => engine.restartLevel()); break;
    case 'new-run': void openScene(() => engine.restartRun()); break;
    case 'title': engine.cancelChain(); showScreen('title'); break;
    case 'editor': engine.cancelChain(); showScreen('editor'); break;
    case 'resume': hideModal(); break;
    case 'sound': audio.enabled = !audio.enabled; save.sound = audio.enabled; persist(); updateSound(); if (audio.enabled) { audio.unlock(); audio.play('click'); } break;
    case 'help': showHelp(); break;
    case 'ability': {
      const kind = target.dataset.ability as AbilityKind;
      renderer?.setItemTargeting(null);
      if (kind === 'spin') { engine.setAbility(null); void engine.useAbility('spin'); }
      else engine.setAbility(engine.state.chosenAbility === kind ? null : kind);
      updateHUD(); break;
    }
    case 'cancel-ability': engine.setAbility(null); updateHUD(); break;
    case 'frost': case 'item': {
      const item = (target.dataset.item ?? 'frost') as ItemKind;
      engine.setAbility(null);
      engine.cancelChain();
      if (item === 'healing') { renderer?.setItemTargeting(null); engine.useItem(item); }
      else renderer?.setItemTargeting(renderer?.itemTargeting === item ? null : item);
      updateHUD(); break;
    }
    case 'cancel-frost': renderer?.setItemTargeting(null); updateHUD(); break;
    case 'wait': engine.cancelChain(); void engine.waitTurn(); break;
    case 'pause': engine.setAbility(null); engine.cancelChain(); renderer?.setItemTargeting(null); paused = true;
      showModal(`<p class="eyebrow">${engine.state.tutorial ? 'УЧЕБНЫЙ БОЙ' : 'МИНУТКА ПЕРЕД ДВЕРЬЮ'}</p><h2 id="modal-title">Переведи дух</h2><p class="modal-copy">${engine.state.tutorial ? 'Повтор восстановит стартовое поле и 5 HP.' : 'Повтор вернёт здоровье и предметы к состоянию на входе в комнату.'}</p><button class="button primary" data-action="resume">ПРОДОЛЖИТЬ</button><button class="button secondary" data-action="retry">${engine.state.tutorial ? 'ПОВТОРИТЬ БОЙ' : 'ПОВТОРИТЬ КОМНАТУ'}</button>${engine.state.run.active ? '<button class="text-button" data-action="new-run">ПОХОД СНАЧАЛА</button>' : ''}${engine.state.customLevel && !engine.state.tutorial ? '<button class="button secondary" data-action="editor">В РЕДАКТОР</button>' : ''}<button class="text-button" data-action="title">В МЕНЮ</button>`); break;
  }
});
function updateSound() { el('sound-button').textContent = audio.enabled ? '♫' : '♪̸'; el('sound-button').setAttribute('aria-pressed', String(audio.enabled)); el('sound-button').setAttribute('aria-label', audio.enabled ? 'Выключить звук' : 'Включить звук'); }
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (renderer?.itemTargeting) { renderer.setItemTargeting(null); updateHUD(); return; }
  if (engine.state.chosenAbility) { engine.setAbility(null); updateHUD(); return; }
  if (engine.state.chain.length) { engine.cancelChain(); return; }
  if (paused) hideModal();
  else if (screen === 'game' && engine.state.phase === 'PLAYER_INPUT') document.querySelector<HTMLButtonElement>('[data-action="pause"]')?.click();
});
engine.subscribe((_state, event) => {
  if (['hit', 'kill'].includes(event.type) || event.type === 'attack' && engine.state.board[event.index??-1]?.kind !== 'melee') audio.play('hit', event.amount);
  if (event.type === 'damage') { audio.play('damage'); el('game-screen').classList.remove('damage-flash'); void el('game-screen').offsetWidth; el('game-screen').classList.add('damage-flash'); }
  if (event.type === 'frost') audio.play('frost');
  if (event.type === 'door-open' || event.type === 'room-complete') audio.play('door');
  if (event.type === 'item') audio.play('item');
  updateHUD();
  if (event.type === 'invalid' && event.text) {
    el('status-message').textContent = event.text;
    el('risk-preview').textContent = event.text;
    el('risk-preview').classList.add('danger');
  }
});
const debug = {
  engine,
  get animationScale() { return engine.animationScale; }, set animationScale(value: number) { engine.animationScale = Math.max(0, value); },
  get state() { return engine.state; }, get phase() { return engine.state.phase; }, get currentLevel() { return engine.state.levelIndex; }, get wave() { return engine.state.wave; },
  get room() { return engine.state.room; }, get run() { return engine.state.run; }, get seed() { return engine.state.run.seed; },
  get hazard() { return engine.state.hazard; }, get key() { return engine.state.room.key; }, get doors() { return uniqueDoors(); },
  get rotations() { return engine.state.rotations; },
  get inventory() { return engine.state.inventory; }, get rewards() { return engine.state.rewards; },
  get player() { return engine.state.player; }, get board() { return engine.getBoardState(); }, get selectedPath() { return engine.state.chain; },
  get energy() { return engine.state.player.energy; }, get chosenAbility() { return engine.state.chosenAbility; },
  get objective() { return engine.state.objective; }, get turn() { return engine.state.turn; }, get score() { return engine.state.score; },
  get screen() { return screen; }, get frostTargeting() { return renderer?.frostTargeting ?? false; }, get itemTargeting() { return renderer?.itemTargeting ?? null; },
  get endpointLabel() { return renderer?.endpointLabel ?? null; }, get rendererTicking() { return renderer?.ticking ?? false; },
  getBoardState: () => engine.getBoardState(), availableMoves: () => engine.availableMoves(), validStarts: () => engine.validStarts(),
  preview: (path?: number[]) => engine.preview(path), previewFrost: (index: number) => engine.previewFrost(index),
  previewRotations: (path?: number[]) => engine.previewRotations(path),
  useFrost: (index: number) => engine.prepareFrost(index), prepareFrost: (index: number) => engine.prepareFrost(index),
  previewItem: (item: ItemKind, index?: number) => engine.previewItem(item, index), useItem: (item: ItemKind, index?: number) => engine.useItem(item, index),
  setAbility: (kind: AbilityKind | null) => { renderer?.setItemTargeting(null); return engine.setAbility(kind); },
  previewAbility: (kind: AbilityKind, index?: number) => engine.previewAbility(kind, index),
  useAbility: (kind: AbilityKind, index?: number) => { renderer?.setItemTargeting(null); return engine.useAbility(kind, index); },
  startCampaign: (seed?: number) => openScene(() => engine.startCampaign(seed)), startCastle: (seed?: number) => openScene(() => engine.startCastle(seed)),
  continueCampaign: () => openScene(() => engine.continueCampaign()), chooseReward: (item: ItemKind) => openScene(() => engine.chooseReward(item)),
  loadScenario: (name: RoomTheme | 'castle', seed?: number) => startGame(name === 'castle' ? 'banquet' : name, seed),
  loadTutorial: (index = 0) => startTutorial(index), nextTutorial: () => openScene(() => engine.nextTutorial()),
  endTurn: () => engine.waitTurn(), waitTurn: () => engine.waitTurn(), loadLevel: (index = 0) => startLevel(index), restartLevel: () => openScene(() => engine.restartLevel()),
  restartRun: () => openScene(() => engine.restartRun()),
  damagePlayer: (amount = 1) => engine.damagePlayer(amount), winLevel: () => engine.winLevel(),
  beginChain: (index: number) => engine.beginChain(index), extendChain: (index: number) => engine.extendChain(index),
  releaseChain: () => engine.releaseChain(), cancelChain: () => engine.cancelChain(),
  gridToScreen: (x: number, y?: number) => renderer?.gridToScreen(y === undefined ? x % engine.state.cols : x, y === undefined ? Math.floor(x / engine.state.cols) : y),
};
// Test/debug hooks (winLevel, damagePlayer…) exist only in the dev server or a build with VITE_E2E_HOOKS=1.
if (import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === '1') Object.assign(window, { __PUZZLE_GAME: debug });
updateSound(); showScreen('title');
