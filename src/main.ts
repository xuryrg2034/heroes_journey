import './style.css';
import { ForestEngine } from './game/forestEngine';
import { ITEMS } from './game/items';
import { heroStrikeDamage } from './game/elite';
import { abilityCost, JUMP_RANGE } from './game/forestSystems';
import { uniqueEntities } from './game/entityFootprint';
import { archerStrikesCreatures, planEnemyPhase } from './game/enemyPhase';
import type { LootKind, AbilityKind, ItemKind, ResourceKind } from './game/forestTypes';
import type { RunBattleSetup } from './game/run/runBattle';
import { BoardRenderer, enemyReadyToAttack } from './render/BoardRenderer';
import { GameAudio } from './audio';
import { LevelEditor } from './editor/LevelEditor';
import { validateCustomLevel } from './game/customLevel';
import { summarizeDamageEffects } from './game/damageEffects';
import { deviceTargets } from './game/devices';
import { enemyDefeatCountsForGoal, shieldIsActive } from './game/combatRules';
import { isCellAlive } from './game/cellLife';
import { SHAMAN_PERIOD } from './game/forestBeasts';
import { chargeReady } from './game/boarCharge';
import { crystalKills, crystalsActive, runPressureInfo } from './game/mapBattleRules';
import { addPlayTime, forestRunScore, recordTally, createForestRun, enterNode, battleSetup, resolveBattle, chooseFindItem, chooseGift, chooseGiftPick, chooseTalisman, chooseEventOption, eventView, nodeBattleId, forestRunView, restCraft, restFinish, restHeal, runNode, runReachedJailer, shopBuy, shopLeave, type ForestRunEvent, type ForestRunState, type ForestRunStep } from './game/run/forestRun';
import { forestEvent } from './game/run/forestEvents';
import { createForestRunStore } from './game/run/forestRunStorage';
import { clearsTrunk, createPlayerProfileStore, winsRun } from './game/run/playerProfile';
import { mapScreenHtml, nodeDetailHtml, runEntryHtml, restModalHtml, restResultHtml, findModalHtml, eventModalHtml, eventResultHtml, nodeBattleModalHtml, runResultHtml, grantText, unlockedText, talismanBadgesHtml, modifierBadgesHtml, talismanModalHtml, shopModalHtml, giftModalHtml, giftOptionText, unlockModalHtml } from './forestMapScreen';
import { applyTelemetryQuery, installTelemetry, playtestHtml, exportJson, clearTelemetry, telemetryEnabled, setTelemetryEnabled, recordRunEvent, recordRunRest, recordRunTalisman, recordRunShop, recordRunGift } from './telemetry';
import { isResource, lootLabel } from './game/resources';
import { barView } from './game/run/unlocks';
import { nextReinforcementTurn, REINFORCEMENT_COUNT } from './game/exitRules';
import { chestLabel } from './render/art';
import { talisman, type TalismanId } from './game/talismans';
import type { TalismanOption } from './game/run/talismanOffers';
import type { ChainPreview } from './game/forestTypes';

const SAVE_KEY = 'ashen-oath-campaign-v1';
type Save = { sound: boolean };
function readSave(): Save {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Partial<Save>;
    return { sound: value.sound !== false };
  } catch { return { sound: true }; }
}
const save = readSave();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* Storage is optional. */ } };
const engine = new ForestEngine();
applyTelemetryQuery();
const telemetry = installTelemetry(engine);
const quietCancel = () => telemetry.quiet(() => engine.cancelChain());
const audio = new GameAudio();
audio.enabled = save.sound;
let renderer: BoardRenderer | null = null;
let screen: 'title' | 'game' | 'editor' | 'map' = 'title';
let hintTurn: number | null = 0, restHover = false;
let paused = false, starting = false, outcomeShown = '', previousChain = 0;
let focusedDoor: number | null = null;
const itemKeys: ItemKind[] = ['frost', 'bomb', 'healing', 'fire'];
/** The lethal mark of a forecast: death, or a lethal hit the whole Ash ward will take (talismans.ts, combatRules.heroLoss). */
const lethalNote = (preview: ChainPreview) => preview.playerDies ? ' · смертельно' : preview.wardSaves ? ' · смертельно — оберег спасёт' : '';
const itemNames: Record<ItemKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь' };
const itemIcons: Record<ItemKind, string> = { frost: '❄', bomb: '✹', healing: '✚', fire: '♨' };
const abilityKeys: AbilityKind[] = ['jump', 'spin'];
const abilityNames: Record<AbilityKind, string> = { jump: 'Прыжок', spin: 'Круговой' };
const abilityIcons: Record<AbilityKind, string> = { jump: '↗', spin: '↻' };
const abilityDescriptions: Record<AbilityKind, string> = {
  jump: `До ${JUMP_RANGE} клеток по прямому расстоянию. Удар 4: приземлиться можно на пустой пол или убитого врага.`,
  spin: 'Ударить всех 8 соседних врагов на 4, кот остаётся на месте. Первое нажатие показывает зону, урон и ответ врагов, второе (кнопка, клик по коту, Enter) ударяет.',
};
const energyText = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

el('app').innerHTML = `
<header class="site-header"><button class="brand" data-action="title" aria-label="Главная"><span class="brand-mark">✦</span> ASHEN OATH<span class="edition">ПОХОД ПО ЛЕСУ</span></button><div class="header-actions"><button class="icon-button" id="sound-button" data-action="sound" aria-label="Звук">♫</button><button class="icon-button" data-action="help" aria-label="Правила игры">?</button></div></header>
<main>
  <section id="title-screen" class="title-screen">
    <div class="title-art" aria-hidden="true"><div class="moon"></div><div class="forest-tree tree-one"></div><div class="forest-tree tree-two"></div><div class="forest-tree tree-three"></div><div class="forest-tree tree-four"></div><div class="camp-glow"></div><div class="tent"></div><i class="ember ember-one"></i><i class="ember ember-two"></i><i class="ember ember-three"></i></div>
    <div class="title-content scenario-title"><div class="title-hero"><div id="run-entry" class="run-entry"></div><p class="eyebrow">КОТ. ТОПОР. ИСПОРЧЕННОЕ УТРО.</p><div class="title-cat"><img src="/art/characters/player.png" width="96" height="96" alt=""></div><h1>ASHEN<span>OATH</span></h1><p class="title-tagline">Кот против лесных налётчиков</p><p class="title-description">Пройди лесную карту: бои, привалы и находки до Главаря или Тролля.</p></div><div class="title-links"><button class="text-button" id="editor-button" data-action="editor">СОЗДАТЬ УРОВЕНЬ <span>✎</span></button><button class="text-button" data-action="help">КАК ИГРАТЬ <span>→</span></button></div></div>
  </section>
  <section id="editor-screen" class="editor-screen" hidden></section><section id="map-screen" class="map-screen" hidden></section>
  <section id="game-screen" class="game-screen" hidden>
    <aside class="chapter-panel"><p class="eyebrow" id="chapter-number"></p><h1 id="level-name"></h1><div class="ornament"><span></span>✦<span></span></div><section class="objective-card"><p class="panel-label" id="objective-label">ВЫПОЛНИ ЦЕЛИ</p><div id="objectives"></div></section><div id="pressure-chip" class="pressure-chip" hidden aria-live="polite"><span class="hud-label">ДАВЛЕНИЕ</span><b id="pressure-anger"></b><span id="pressure-refill"></span></div><div id="reinforcement-chip" class="pressure-chip reinforcement-chip" hidden aria-live="polite" title="После выполнения целей в бою приходят подкрепления: отмеченные на поле обычные гоблины заменяются злыми."><span class="hud-label">ПОДКРЕПЛЕНИЕ</span><b id="reinforcement-count"></b><span id="reinforcement-note"></span></div><details class="room-details"><summary>О бое <span aria-hidden="true">⌄</span></summary><p class="level-description" id="level-description"></p><section id="door-guide" class="door-guide" hidden><p class="panel-label">ВЫХОД НА ПОЛЕ</p><div id="door-options"></div><p id="door-detail"></p></section><div class="chapter-note"><span>✦</span><p id="tutorial-message"></p></div></details><button class="text-button chapter-select" data-action="title">← В МЕНЮ</button><button class="text-button editor-return" id="return-editor" data-action="editor" hidden>← В РЕДАКТОР · черновик сохранён</button></aside>
    <div class="board-column"><div id="compact-room-heading"><b id="compact-room-name"></b><span id="compact-room-goal"></span></div><div class="combat-hud"><div class="vitality"><span class="hud-label">ЗДОРОВЬЕ</span><div id="health" class="hearts"></div><div id="damage-effects-summary" class="damage-effects-summary" aria-live="polite" hidden></div><div id="talisman-row" class="talisman-row" aria-label="Талисманы" hidden></div></div><div id="battle-toasts" class="battle-toasts" aria-live="polite"></div><div class="turn-counter"><span class="hud-label">ХОД</span><strong id="turn-number">01</strong></div><div class="score-counter"><span class="hud-label">ОЧКИ</span><strong id="score">0</strong></div><div class="energy-hud"><span class="hud-label">ЭНЕРГИЯ</span><strong id="energy-value">0 / 7</strong><div id="energy-meter" class="energy-meter" role="progressbar" aria-label="Энергия" aria-valuemin="0" aria-valuemax="7"><span></span></div></div><button class="icon-button pause-button" data-action="pause" aria-label="Пауза">Ⅱ</button><div id="mobile-chain-readout" hidden aria-live="polite"><span><small>ЦЕПОЧКА</small><b id="mobile-chain-count">0</b></span><span><small>СИЛА</small><b id="mobile-chain-power">0</b></span><span><small id="mobile-chain-status">ОТВЕТ</small><b id="mobile-chain-damage">0 HP</b></span></div></div><button id="battle-hint" class="battle-hint" data-action="hint-close" hidden aria-label="Скрыть подсказку боя"><span class="hint-goal" id="hint-goal"></span><span class="hint-rule" id="hint-rule"></span><span class="hint-close" aria-hidden="true">✕</span></button><div class="board-frame"><div class="frame-corner corner-tl"></div><div class="frame-corner corner-tr"></div><div class="frame-corner corner-bl"></div><div class="frame-corner corner-br"></div><div id="board-host" role="application" aria-label="Лесная поляна. Начни рядом с котом и веди цепь через врагов одного цвета."></div><div id="phase-banner" class="phase-banner" hidden></div></div><div class="board-status" aria-live="polite"><span class="status-dot"></span><span id="status-message">Начни цепочку рядом с котом.</span></div><div class="action-dock"></div><div class="board-footnote"><span>8 НАПРАВЛЕНИЙ · ОТ 1 ЦЕЛИ</span><span>ШАГ НАЗАД — ОТМЕНА</span></div></div>
    <aside class="guide-panel"><section class="chain-card"><p class="panel-label">ЦЕПОЧКА</p><div class="chain-total"><strong id="chain-number">0</strong><span id="chain-rank">НАЧНИ РЯДОМ С КОТОМ</span></div><div class="chain-meter"><span id="chain-meter-fill"></span></div><p id="chain-reward">Запас силы: <b>+1 за врага · −HP цели</b></p><div id="risk-preview" class="risk-preview">Выбери безопасный последний шаг.</div></section><details class="field-details"><summary>Враги и знаки <span aria-hidden="true">⌄</span></summary><section class="field-guide"></section><div class="sigil-key"><span class="sigil red">▲</span><span class="sigil green">✚</span><span class="sigil blue">□</span><span class="sigil gold">●</span><span class="sigil purple">✕</span><span>ЦВЕТ + ЗНАК</span></div><div class="guide-tip"><b>ПОСЛЕДНЯЯ КЛЕТКА РЕШАЕТ</b><p>Последнего врага можно ранить. Проверь, где закончится цепь и кто сможет ответить.</p></div><div class="intent-legend" aria-label="Обозначения намерений"><span class="intent-attack">! Атака</span><span class="intent-move">⇄ Обмен</span><span class="intent-rest">… Отдых</span></div></details></aside>
  </section>
</main>
<footer class="site-footer"><span>ASHEN OATH <i>•</i> ПОХОД ПО ЛЕСУ</span><span>ПОСЛЕДНИЙ ШАГ РЕШАЕТ.</span><button class="text-button playtest-link" data-action="playtest">ПЛЕЙТЕСТ</button></footer>
<div id="modal-layer" class="modal-layer" hidden><section id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"></section></div>`;

// Actions under the field: abilities, items, rest and the short summaries. On desktop they move to the right panel.
const actionDock = document.querySelector<HTMLElement>('.action-dock')!;
actionDock.innerHTML = `<div class="ability-toolbar" aria-label="Способности">${abilityKeys.map(kind => `<button class="ability-button" id="${kind}-ability" data-action="ability" data-ability="${kind}"><span class="ability-icon">${abilityIcons[kind]}</span><span>${abilityNames[kind]} <b id="${kind}-cost"></b></span></button>`).join('')}</div><p id="ability-hint" class="ability-hint">Обычная цепь: +0,5 энергии за каждого атакованного врага.</p><button id="cancel-ability" class="text-button cancel-ability" data-action="cancel-ability" hidden>Отменить способность</button>`
  + `<div class="item-toolbar">${itemKeys.map(item => `<button class="item-button" data-action="item" data-item="${item}" id="${item}-button" title="${ITEMS[item].description}"><span class="frost-icon">${itemIcons[item]}</span><span id="${item}-label">${itemNames[item]} · 0</span></button>`).join('')}<button class="text-button cancel-item" data-action="cancel-frost" id="cancel-frost" hidden>Отмена</button><button class="wait-button" data-action="wait" id="wait-button" title="+0,5 энергии, максимум 7. Враги атакуют, события поля выполняются." aria-label="Отдых: плюс 0,5 энергии. Враги и события поля действуют.">Отдых · +0,5 энергии</button></div>`
  + '<p id="item-hint" class="item-hint"></p><p id="intent-summary" class="intent-summary" aria-live="polite"></p><p id="device-summary" class="device-summary" aria-live="polite" hidden></p><p id="shield-summary" class="intent-summary" hidden></p><p id="palette-summary" class="intent-summary" hidden></p>';
const gridLabel = (index: number) => `${String.fromCharCode(65 + index % engine.state.cols)}${Math.floor(index / engine.state.cols) + 1}`;
function placeActionDock() {
  if (screen !== 'game') return;
  const desktop = window.matchMedia('(min-width: 981px)').matches;
  const destination = desktop ? document.querySelector('.guide-panel')! : document.querySelector('.board-column')!;
  if (actionDock.parentElement === destination) return;
  if (desktop) document.querySelector('.field-details')!.before(actionDock);
  else document.querySelector('.board-status')!.after(actionDock);
}
window.addEventListener('resize', placeActionDock);

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
function showScreen(next: typeof screen) {
  if (screen === 'game' && next !== 'game') telemetry.leave();
  runClock(next);
  screen = next;
  el('title-screen').hidden = next !== 'title';
  el('game-screen').hidden = next !== 'game';
  el('editor-screen').hidden = next !== 'editor';
  el('map-screen').hidden = next !== 'map';
  if (next === 'title') renderRunEntry();
  if (next === 'map') renderMap();
  if (next === 'editor') editor.show();
  el('app').classList.toggle('playing', next === 'game');
  renderer?.setActive(next === 'game');
  renderer?.setItemTargeting(null);
  if (engine.state.chosenAbility) engine.setAbility(null);
  hideModal();
}
async function openScene(action: () => unknown | Promise<unknown>) {
  if (starting) return;
  // While starting, updateHUD must not treat the previous fight's WIN/LOSE as a fresh outcome.
  starting = true; audio.unlock(); audio.play('click'); hintTurn = 0; outcomeShown = ''; previousChain = 0; focusedDoor = null;
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
// Forest map run (src/game/run): the model owns the rules; here we only switch screens, hand battles to the engine and save.
const runStore = createForestRunStore();
// Player profile outside the run: the trunk is played until it is cleared once (decision of 04.10.2026).
const profileStore = createPlayerProfileStore();
let forestRun: ForestRunState | null = runStore.load();
let mapConfirmReset = false, mapNotice = '';
/**
 * The ladder step the player picked for the next new run (null — the highest open, the default). «Ступени клятвы»: a
 * victory on step N opens N+1 in the profile (playerProfile.ts).
 */
let chosenLadder: number | null = null;
const ladderChoice = () => { const open = profileStore.load().ladder; return { open, chosen: Math.max(0, Math.min(open, chosenLadder ?? open)) }; };
const renderRunEntry = () => { el('run-entry').innerHTML = runEntryHtml(forestRun, mapConfirmReset, profileStore.load().trunkCleared, ladderChoice()); };
function renderMap() { if (forestRun) el('map-screen').innerHTML = mapScreenHtml(forestRun, { notice: mapNotice, confirmReset: mapConfirmReset }); }
const refreshRunViews = () => { renderRunEntry(); renderMap(); };
/**
 * Play time of the run (the score's «Быстрый поход», runScore.ts): counted while the map or the run's battle is on screen
 * and the tab is visible. A screen change or a hidden tab adds what passed to the run in memory; the next step saves it
 * (nothing is written while the page unloads), so a reload loses only the time since the last step.
 */
let clockFrom: number | null = null;
function runClock(next: typeof screen = screen) {
  const now = performance.now();
  if (clockFrom !== null && forestRun) forestRun = addPlayTime(forestRun, now - clockFrom);
  const counting = (next === 'map' || next === 'game' && forestRun?.pending?.kind === 'battle') && document.visibilityState === 'visible';
  clockFrom = counting && forestRun && !forestRun.result ? now : null;
}
document.addEventListener('visibilitychange', () => runClock());
/** The ladder step the last victory opened (shown on its result, also after the openings screen). */
let openedLadderShown: number | null = null;
function commitRun(step: ForestRunStep): ForestRunStep {
  if (step.ok) {
    let run = step.run;
    if (clockFrom !== null) { const now = performance.now(); run = addPlayTime(run, now - clockFrom); clockFrom = now; }
    // The run has just ended (victory or defeat). The profile remembers whether it reached the Jailer, for the next run's
    // gift (an entered seed changes nothing), and adds the run's score to the bar of openings (not a seeded run); the run keeps the tally
    // for its result screen. Once per run: a reloaded result is not a new end.
    if (run.result && !forestRun?.result) {
      profileStore.endRun({ reachedJailer: runReachedJailer(run), seeded: !!run.seeded });
      const tally = profileStore.addRunScore(forestRunScore(run).total, !!run.seeded), tallied = tally && recordTally(run, tally);
      if (tallied?.ok) run = tallied.run;
      clockFrom = null; openedLadderShown = null;
    }
    step = { ...step, run };
    forestRun = run; runStore.save(run);
  }
  return step;
}
function newRun(seed?: number, ladder = ladderChoice().chosen) {
  const random = new Uint32Array(1); crypto.getRandomValues(random);
  // Every new run walks a map generated by its seed (mapGenerator.ts) on the chosen ladder step; the authored graph stays for old saves and tests.
  // The start gift (runGift.ts): full after a run that reached the Jailer, or with an entered seed; else the mini gift.
  // Only what the bar of openings has opened comes in the run (unlocks.ts).
  const seeded = seed !== undefined, profile = profileStore.load();
  forestRun = createForestRun(seed ?? random[0], { skipTrunk: profile.trunkCleared, map: 'generated', ladder, gift: profileStore.giftKind(seeded), seeded, unlocks: profile.meta.level });
  runStore.save(forestRun); clockFrom = null;
  mapConfirmReset = false; mapNotice = ''; audio.unlock(); audio.play('click'); showScreen('map');
  // A run past the trunk opens with the start gift.
  showGift();
}
async function playRunBattle() {
  const setup = forestRun && battleSetup(forestRun);
  if (!setup) { mapNotice = 'Бой этого узла не удалось подготовить.'; showScreen('map'); return; }
  await openScene(() => { if (!engine.startRunBattle(setup)) throw new Error('Бой узла не запустился.'); });
}
function showFind() {
  const pending = forestRun?.pending;
  if (forestRun && pending?.kind === 'find') showModal(findModalHtml(forestRun, pending.nodeId, pending.options));
}
/** The open talisman or oath choice (also after a reload: the saved run keeps it pending with its options). */
function showTalisman() { if (forestRun?.pending?.kind === 'talisman') showModal(talismanModalHtml(forestRun)); }
/** Take an offered talisman or oath (`null` — refuse); the choice goes to the playtest journal. */
function chooseTalismanOption(option: TalismanOption | null) {
  const pending = forestRun?.pending;
  if (!forestRun || pending?.kind !== 'talisman') return;
  const step = commitRun(chooseTalisman(forestRun, option));
  if (!step.ok) return;
  recordRunTalisman({ nodeId: pending.nodeId, source: pending.source, offered: [...pending.options], chosen: option, seed: step.run.seed });
  mapNotice = option === null ? `${pending.source === 'oath' ? 'Клятвы' : 'Талисманы'} отвергнуты: в этом походе они больше не выпадут.`
    : option === 'blank' ? 'Пустышка: +5 очков похода.' : `Взято: ${talisman(option).name} — ${talisman(option).effect.charAt(0).toLowerCase()}${talisman(option).effect.slice(1)}.`;
  audio.play(option ? 'reward' : 'click'); showScreen('map');
}
/** The open start gift (also after a reload: the saved run keeps it pending with its rolled buttons). */
function showGift() { if (forestRun?.pending?.kind === 'gift') showModal(giftModalHtml(forestRun)); }
/** A gift taken (the button and its own choice) goes to the playtest journal; the map opens the row-5 nodes. */
function finishGift(run: ForestRunState) {
  const gift = run.gift;
  if (!gift || gift.chosen === undefined) return;
  recordRunGift({ kind: gift.kind, options: structuredClone(gift.options), chosen: gift.chosen, ...gift.pick ? { pick: gift.pick } : {}, seed: run.seed, ...run.seeded ? { seeded: true } : {} });
  const { title } = giftOptionText(gift.options[gift.chosen]);
  const taken = gift.pick ? (itemKeys.includes(gift.pick as ItemKind) ? itemNames[gift.pick as ItemKind] : talisman(gift.pick as TalismanId).name)
    : run.talismans.length ? talisman(run.talismans[0]).name : '';
  mapNotice = `Дар у костра: ${title}${taken ? ` — ${taken}` : ''}.`;
  audio.play('reward'); showScreen('map');
}
function chooseGiftButton(index: number) {
  if (!forestRun || forestRun.pending?.kind !== 'gift') return;
  const step = commitRun(chooseGift(forestRun, index));
  if (!step.ok) return;
  if (step.run.pending?.kind === 'gift') { audio.play('click'); showGift(); return; }
  finishGift(step.run);
}
function pickGift(pick: string) {
  if (!forestRun || forestRun.pending?.kind !== 'gift') return;
  const step = commitRun(chooseGiftPick(forestRun, pick));
  if (step.ok) finishGift(step.run);
}
/** The open map event (also after a reload: the saved run keeps it pending). */
function showEvent() { if (forestRun?.pending?.kind === 'event') showModal(eventModalHtml(forestRun)); }
function chooseEvent(optionId: string) {
  if (!forestRun || forestRun.pending?.kind !== 'event') return;
  // The escalation's attempts before this choice go to the playtest journal with it.
  const before = eventView(forestRun);
  const step = commitRun(chooseEventOption(forestRun, optionId));
  if (!step.ok) return;
  // An escalation's attempt keeps the event open; an accepted reward battle starts its battle.
  const attempt = step.events.find(event => event.type === 'event-attempt');
  if (attempt?.type === 'event-attempt') {
    mapNotice = `${runNode(step.run, attempt.nodeId)?.name ?? ''}: попытка ${attempt.attempt} — ${attempt.text}.`;
    audio.play('click'); showScreen('map'); showEvent(); return;
  }
  if (step.run.pending?.kind === 'battle') { audio.play('click'); routeRun(); return; }
  const resolved = step.events.find(event => event.type === 'event-resolved');
  if (resolved?.type === 'event-resolved') {
    recordRunEvent({ nodeId: resolved.nodeId, option: resolved.option, outcome: resolved.outcome, text: resolved.text, seed: step.run.seed,
      ...before ? { eventId: before.event.id } : {}, ...before?.attempts.length ? { attempts: before.attempts } : {} });
    mapNotice = `${runNode(step.run, resolved.nodeId)?.name ?? ''}: ${resolved.text}.`;
  }
  audio.play('reward'); showScreen('map'); showModal(eventResultHtml(step.run, step.events, before?.attempts.map(entry => entry.text) ?? []));
}
/** The open rest (also after a reload: the saved run keeps it pending with its crafts). */
function showRest() { if (forestRun?.pending?.kind === 'rest') showModal(restModalHtml(forestRun)); }
/** A completed rest goes to the playtest journal: the choice, HP healed and the items crafted. */
function recordRest(run: ForestRunState, events: ForestRunEvent[]) {
  const done = events.find(event => event.type === 'rest-completed');
  if (done?.type === 'rest-completed') recordRunRest({ nodeId: done.nodeId, choice: done.choice, healed: done.healed, crafted: [...done.crafted], seed: run.seed });
}
function healAtRest() {
  if (!forestRun || forestRun.pending?.kind !== 'rest') return;
  const step = commitRun(restHeal(forestRun));
  if (!step.ok) return;
  recordRest(step.run, step.events);
  const healed = step.events.find(event => event.type === 'healed'), amount = healed?.type === 'healed' ? healed.amount : 0, nodeId = healed?.nodeId ?? '';
  mapNotice = `${runNode(step.run, nodeId)?.name ?? 'Привал'}: ${amount ? `+${amount} HP` : 'здоровье не изменилось'}.`;
  audio.play('item'); showScreen('map'); showModal(restResultHtml(step.run, nodeId, amount, step.events.some(event => event.type === 'effects-cleared')));
}
function craftAtRest(resource: ResourceKind) {
  if (!forestRun || forestRun.pending?.kind !== 'rest') return;
  const step = commitRun(restCraft(forestRun, resource));
  if (!step.ok) return;
  audio.play('item'); renderMap(); showModal(restModalHtml(step.run));
  // Keep the focus on the pressed recipe while it can be crafted again, else on «К карте».
  requestAnimationFrame(() => (el('modal').querySelector<HTMLButtonElement>(`[data-craft="${resource}"]:not(:disabled)`) ?? el('modal').querySelector<HTMLButtonElement>('[data-action="rest-finish"]'))?.focus());
}
function finishRest() {
  if (!forestRun || forestRun.pending?.kind !== 'rest') return;
  const step = commitRun(restFinish(forestRun));
  if (!step.ok) return;
  recordRest(step.run, step.events);
  const done = step.events.find(event => event.type === 'rest-completed');
  const crafted = done?.type === 'rest-completed' ? done.crafted : [];
  mapNotice = `${runNode(step.run, done?.nodeId ?? '')?.name ?? 'Привал'}: создано — ${crafted.map(item => itemNames[item]).join(', ')}.`;
  audio.play('reward'); showScreen('map');
}
/** The open merchant (also after a reload: the saved run keeps the stock and the purchases). */
function showShop() { if (forestRun?.pending?.kind === 'shop') showModal(shopModalHtml(forestRun)); }
function buyAtShop(id: string) {
  if (!forestRun || forestRun.pending?.kind !== 'shop') return;
  const step = commitRun(shopBuy(forestRun, id));
  if (!step.ok) return;
  audio.play('item'); renderMap(); showModal(shopModalHtml(step.run));
  // Keep the focus on the pressed good while it can be bought again, else on «Уйти».
  requestAnimationFrame(() => (el('modal').querySelector<HTMLButtonElement>(`[data-shop-buy="${id}"]:not(:disabled)`) ?? el('modal').querySelector<HTMLButtonElement>('[data-action="shop-leave"]'))?.focus());
}
/** Leave the merchant; the visit (stock and purchases) goes to the playtest journal. */
function leaveShop() {
  if (!forestRun || forestRun.pending?.kind !== 'shop') return;
  const step = commitRun(shopLeave(forestRun));
  if (!step.ok) return;
  const left = step.events.find(event => event.type === 'shop-left');
  if (left?.type === 'shop-left') {
    recordRunShop({ nodeId: left.nodeId, stock: left.stock, bought: left.bought, seed: step.run.seed, ...step.run.ladder ? { ladder: step.run.ladder } : {} });
    mapNotice = `${runNode(step.run, left.nodeId)?.name ?? 'Торговец'}: ${left.bought.length ? `покупок — ${left.bought.length}` : 'ничего не куплено'}.`;
  }
  audio.play('click'); showScreen('map');
}
/** Where the player goes after any run step: map, result, battle, find, event, rest or merchant. */
function routeRun() {
  if (!forestRun) return;
  if (forestRun.pending?.kind === 'battle') { void playRunBattle(); return; }
  showScreen('map');
  if (forestRun.result) showModal(runResultHtml(forestRun));
  else if (forestRun.pending?.kind === 'event') showEvent();
  else if (forestRun.pending?.kind === 'rest') showRest();
  else if (forestRun.pending?.kind === 'shop') showShop();
  else if (forestRun.pending?.kind === 'talisman') showTalisman();
  else if (forestRun.pending?.kind === 'gift') showGift();
  else showFind();
}
function resumeRun() { if (forestRun) { mapNotice = ''; audio.unlock(); audio.play('click'); routeRun(); } else newRun(); }
function enterMapNode(id: string) {
  if (!forestRun) return;
  const step = commitRun(enterNode(forestRun, id));
  if (!step.ok) { mapNotice = step.reason; renderMap(); return; }
  if (clearsTrunk(step.events)) profileStore.markTrunkCleared();
  mapNotice = ''; audio.unlock(); audio.play('click');
  routeRun();
}
function chooseFind(item: ItemKind) {
  const pending = forestRun?.pending;
  if (!forestRun || pending?.kind !== 'find') return;
  const step = commitRun(chooseFindItem(forestRun, item));
  if (!step.ok) return;
  const opened = runNode(step.run, pending.nodeId), grants = [opened ? grantText(opened) : '', unlockedText(step.events)].filter(Boolean).join('; ');
  mapNotice = `Взято: ${itemNames[item]} +1. ${itemNames[item]} открыт для следующих боёв.${grants ? ` Также открыто: ${grants}.` : ''}`;
  audio.play('reward'); showScreen('map');
}
/** The battle on screen is the saved run's open node battle (not a debug battle opened outside the run). */
const ownsRunBattle = () => !!engine.state.runNode && forestRun?.pending?.kind === 'battle' && forestRun.pending.nodeId === engine.state.runNode.nodeId;
/**
 * A finished node battle goes to the model exactly once. Victory offers the map (or the hard-battle find); a defeat
 * ends the run and shows its result (decision of 04.10.2026): the node is not replayed.
 */
function showRunOutcome(won: boolean) {
  const outcome = engine.runBattleOutcome(), node = engine.state.runNode;
  audio.play(won ? 'win' : 'lose');
  if (!forestRun || !outcome || !node) {
    showModal('<h2 id="modal-title">Бой узла завершён</h2><button class="button primary" data-action="run-map">К КАРТЕ</button>'); return;
  }
  const step = ownsRunBattle() ? commitRun(resolveBattle(forestRun, outcome)) : null;
  const run = forestRun, pending = run.pending, opened = runNode(run, node.nodeId);
  // The reward battle of an event (docs/events.md): its outcome goes to the playtest journal with the event.
  const battleId = opened && step?.ok ? nodeBattleId(run, opened) : null;
  if (step?.ok && opened?.content.kind === 'event' && battleId) {
    const option = forestEvent(opened.content.eventId)?.options.find(entry => entry.battle);
    recordRunEvent({ nodeId: opened.id, eventId: opened.content.eventId, option: option?.id ?? 'fight', outcome: 0, text: won ? 'победа' : 'поражение', seed: run.seed, battle: { battleId, won } });
  }
  if (step?.ok && run.result?.outcome === 'defeat') { showModal(runResultHtml(run)); return; }
  // A won run opens the next ladder step in the profile (once; shown on the result).
  const openedLadder = step?.ok && winsRun(step.events) ? profileStore.winLadder(run.ladder ?? 0) : null;
  if (openedLadder) openedLadderShown = openedLadder;
  const healedEvent = step?.ok ? step.events.find(event => event.type === 'healed') : undefined;
  const healed = healedEvent?.type === 'healed' ? healedEvent.amount : 0;
  const grants = won ? [opened ? grantText(opened) : '', step?.ok ? unlockedText(step.events) : ''].filter(Boolean).join('; ') : '';
  const wardCrumbled = !!step?.ok && step.events.some(event => event.type === 'ward-crumbled');
  if (won) mapNotice = `Узел «${node.label}» пройден.${grants ? ` Открыто: ${grants}.` : ''}${healed ? ` +${healed} HP за трудный бой.` : ''}${wardCrumbled ? ' Пепельный оберег рассыпался.' : ''}`;
  if (won && run.result) { showModal(runResultHtml(run, { openedLadder })); return; }
  showModal(nodeBattleModalHtml({ won, name: node.label, turns: engine.state.turn, hp: won ? run.resources.player.hp : outcome.player.hp, maxHp: won ? run.resources.player.maxHp : outcome.player.maxHp,
    battlesWon: forestRunView(run).battlesWon, grants, find: won && pending?.kind === 'find', choice: won && pending?.kind === 'talisman' ? pending.source : undefined, gift: won && pending?.kind === 'gift',
    healed: won ? healed : 0, wardCrumbled }));
}
/**
 * Pause of a map-node battle or of an editor level. The run's battle has no retry (a defeat ends the run); a node
 * battle opened outside the run (debug hook) and an editor level keep it.
 */
function pauseHtml(): string {
  const { runNode } = engine.state;
  const playtest = '<details class="playtest-details"><summary>Плейтест</summary><button class="text-button" data-action="playtest">ОТКРЫТЬ ЖУРНАЛ ПОПЫТОК</button></details>';
  if (runNode && ownsRunBattle()) return `<p class="eyebrow">БОЙ УЗЛА</p><h2 id="modal-title">Переведи дух</h2><p class="modal-copy">Прогресс похода сохранён. Поражение в этом бою закончит поход.</p><button class="button primary" data-action="resume">ПРОДОЛЖИТЬ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>${playtest}<button class="text-button" data-action="title">В МЕНЮ</button>`;
  return runNode
    ? `<p class="eyebrow">БОЙ ВНЕ ПОХОДА</p><h2 id="modal-title">Переведи дух</h2><p class="modal-copy">Повтор вернёт поле, здоровье и запас как на входе.</p><button class="button primary" data-action="resume">ПРОДОЛЖИТЬ</button><button class="button secondary" data-action="retry">ПОВТОРИТЬ БОЙ</button><button class="button secondary" data-action="run-map">К КАРТЕ</button>${playtest}<button class="text-button" data-action="title">В МЕНЮ</button>`
    : `<p class="eyebrow">АВТОРСКИЙ УРОВЕНЬ</p><h2 id="modal-title">Переведи дух</h2><p class="modal-copy">Повтор восстановит начальное поле, здоровье, предметы и палитру.</p><button class="button primary" data-action="resume">ПРОДОЛЖИТЬ</button><button class="button secondary" data-action="retry">ПОВТОРИТЬ УРОВЕНЬ</button><button class="button secondary" data-action="editor">В РЕДАКТОР</button>${playtest}<button class="text-button" data-action="title">В МЕНЮ</button>`;
}
function uniqueDoors() {
  const seen = new Set<number>();
  return engine.state.board.flatMap((cell, index) => {
    if (!cell?.door || seen.has(cell.id)) return [];
    seen.add(cell.id); return [{ cell, index }];
  });
}
/** Exit of an authored battle (`completion: 'exit'`): closed until the goals are met. */
function updateDoorInfo() {
  const custom = engine.state.customLevel;
  el('door-detail').textContent = !custom ? '' : custom.goalCompletedTurn === null ? 'Выход откроется после выполнения всех целей.' : 'Выход открыт. Заверши цепь на двери; соседнюю дверь можно выбрать одну.';
}
let guideTheme = '';
function updateGuide() {
  const state = engine.state;
  const sentinelPresent = state.board.some(cell => cell?.variant === 'sentinel');
  const boarPresent = state.board.some(cell => cell?.variant === 'boar');
  const trollPresent = state.board.some(cell => cell?.variant === 'troll'), wolfPresent = state.board.some(cell => cell?.variant === 'wolf'), porcupinePresent = state.board.some(cell => cell?.variant === 'porcupine'), shamanPresent = state.board.some(cell => cell?.variant === 'shaman');
  const elitePresent = state.board.some(cell => cell?.elite);
  const spikedSides = state.customLevel?.definition.spikedEdges ?? [];
  const thornsPresent = state.terrain.includes('thorns');
  const guideKey=`${state.runNode?.nodeId ?? ''}:${toolRules(state).items.join(',')}:${toolRules(state).abilities.join(',')}/${!!state.tutorial}/${!!state.customLevel}/${sentinelPresent}/${boarPresent}/${trollPresent}/${wolfPresent}/${porcupinePresent}/${shamanPresent}/${elitePresent}/${spikedSides.join(',')}/${thornsPresent}`;
  if (guideTheme === guideKey) return;
  guideTheme = guideKey;
  // A map-node battle (authored layout with marked targets) or an editor level.
  const rows: [string, string, string][] = state.tutorial ? [
    ['◇', 'Слабый гоблин · 0 HP', 'Гибнет от удара и не тратит запас силы. Вооружённые гоблины отвечают по отмеченным клеткам.'],
    ['✦', 'Отмеченная цель', 'Золотая метка показывает охранника с HP, которого нужно победить.'],
    ['↗', 'Последний шаг', 'Каждый враг даёт +1 к силе; слабый с 0 HP не тратит его.'],
  ] : [
    ['✎', 'Авторский бой', 'Карта, цели и начальные враги заданы в редакторе. Повтор возвращает состояние на входе.'],
    ['⇥', 'Выход после цели', 'Закрытая дверь ждёт выполнения целей. Затем дойди до неё цепью.'],
    ['●', 'Палитра пополнения', 'Новые цвета могут вступать после цели. Уже стоящие враги не перекрашиваются.'],
  ];
  const tools = toolRules(state);
  if (state.tutorial && state.customLevel?.definition.completion === 'exit') rows[1] = ['⇥', 'Путь к выходу', 'Выход откроется после цели. Дойди до него цепью; остальных врагов побеждать не обязательно.'];
  if (sentinelPresent) rows.push(['▣', 'Щитоносец', 'Золотая грань закрывает вход цепи спереди. Обойди сбоку или заморозь его.']);
  if (state.board.some(cell => cell?.variant === 'jailer')) rows.push(['▣', 'Тюремщик', 'Щит закрывает вход цепи спереди. Тяжёлый удар наносит 2 урона по отмеченным клеткам. Затем один ход передышки со снятым щитом — даже после промаха.']);
  if (state.tutorial && tools.items.includes('frost')) rows.push(['❄', 'Холод', 'Выбери холод, затем любого врага. Он пропустит действие и получит двойной следующий физический удар. После этого проведи цепь.']);
  if (state.tutorial && tools.abilities.includes('jump')) rows.push(['↗', 'Прыжок · 2 энергии', 'Каждый атакованный враг даёт 0,5 энергии. Прыжок наносит 4 урона и переносит кота на выбранную клетку.']);
  if (state.tutorial && state.board.some(cell => cell?.kind === 'prism')) rows.push(['✦', 'Кристалл меняет цвет', `Цепь можно начать с кристалла или пройти через него: цвет меняется, накопленная сила сохраняется, самой силы он не даёт. Число на нём — очки за разрушение. Новый падает прямо по ходу цепи за каждые ${crystalKills(state)} убийств, куда — неизвестно заранее.`]);
  if (state.tutorial && state.board.some(cell => cell?.kind === 'ranged')) rows.push(['⌖', 'Стрелок и обмен', 'Лучник стреляет по отмеченной линии и задевает всех на ней, врагов тоже, затем отдыхает. Знак ⇄ показывает будущий обмен: учитывай его при выборе позиции.']);
  if (elitePresent) rows.push(['♛', 'Элита', 'Золотая рамка и корона. HP ×2, удар по коту на 1 сильнее. Ближняя, когда кот не рядом, сближается обменом с соседом; дальняя отступает от близкого кота. Побеждённая игроком оставляет добычу: авторская — с шансом 50% расходник (нет открытых — ресурс), появившаяся сама (с ряда 5) — всегда ресурс. Пройди по добыче цепью — она попадёт в запас.']);
  if (boarPresent) rows.push(['⇶', 'Кабан', 'Янтарный коридор — рывок до 3 клеток по прямой. Кабан бьёт первого и толкает ряд; клетки, освобождённые цепью, решают, кто уцелеет. Упёрся — оглушён, следующий удар по нему двойной.']);
  if (trollPresent) rows.push(['♞', 'Тролль · дубина', 'Замах объявлен на ход раньше: пунктирная зона. Затем удар бьёт всех в залитой зоне, врагов тоже, «УДАР 2», и тролль отдыхает. Регенерация: без урона и горения за ход он лечится. Ранение или горение её останавливают.']);
  if (wolfPresent) rows.push(['≽', 'Волк · стая', 'Волк с соседом-волком вооружён и бьёт по сторонам; линия связывает пару. Одинокий волк пассивен. Убери соседа цепью, стрелой или рывком — удар отменится («СТАЯ РАЗБИТА»).']);
  if (porcupinePresent) rows.push(['✳', 'Дикобраз · иглы', 'Каждый удар обычной цепи по нему ранит кота на 1 HP, даже добивающий. Метка «−1 ИГЛЫ» видна при выборе цепи. Прыжок, круговой удар, предметы и стрелы игл не вызывают; холод их выключает.']);
  if (shamanPresent) rows.push(['☥', 'Шаман · камлание', 'Каждый второй ход поднимает до двух соседних гоблинов: слабый → вооружённый → крепкий (2 HP). Цели отмечены ↑. Убей шамана или цель, заморозь шамана — камлание отменится. Сам он не бьёт.']);
  if (spikedSides.length) rows.push(['▲', 'Шипы по краю', 'Врага, вытолкнутого на шипы, ждёт гибель. Кота — 1 урон, и он упирает ряд. Прогноз при выборе цепи показывает крестики.']);
  if (thornsPresent) rows.push(['⁂', 'Колючки', 'Проходимы. Ранят 1 HP того, кого вдавили на них, и кота, закончившего цепь на такой клетке.']);
  if (state.devices?.some(device => device.kind === 'arrows')) rows.push(['⌁', 'Рычаг стрел', 'Включи его по пути после врага. После цепи залп ранит всех на отмеченной линии, включая кота. Устройство сохраняет цвет и не добавляет силу.']);
  if (state.devices?.some(device => device.kind === 'pits')) rows.push(['▱', 'Рычаг провалов', 'Люки открываются после цепи: обычные враги падают, для кота падение смертельно. Закончишь на люке — погибнешь. Следующий ход они непроходимы, затем закрываются. Под боссами, дверями и крупными врагами люк заклинивает.']);
  if (state.devices?.some(device => device.kind === 'fire')) rows.push(['♨', 'Жаровня', 'После неё каждый следующий удар этой цепи добавляет 1 горение выжившему врагу. Горение ранит в конце хода. На следующую цепь усиление не переносится.']);
  document.querySelector('.field-guide')!.innerHTML = '<p class="panel-label">ПРАВИЛА ЭТОГО МЕСТА</p>' + rows.map(([icon, title, description]) => `<div class="guide-row"><span class="enemy-glyph">${icon}</span><div><b>${title}</b><p>${description}</p></div></div>`).join('');
}
/** Tool permissions in force: the run's opened tools inside a map node; empty in an editor level (where every tool is allowed). */
function toolRules(state: typeof engine.state) {
  const rules = state.runNode ?? state.tutorial;
  return { items: rules?.allowedItems ?? [], abilities: rules?.allowedAbilities ?? [] };
}
/** Main hint of the battle, big above the field: the goal and one sentence of the rule. Gone after the first turn or a click; «?» brings it back. */
function updateBattleHint(state: typeof engine.state, custom: typeof engine.state.customLevel) {
  if (hintTurn !== null && state.turn > hintTurn) hintTurn = null;
  const visible = hintTurn !== null && screen === 'game' && state.phase === 'PLAYER_INPUT';
  const labels = { kills: 'Победи врагов', rangedKills: 'Победи стрелков', bossKills: 'Победи главаря', turns: 'Продержись ходов' } as const;
  const goal = !custom ? '' : custom.definition.goals.map(entry => `${labels[entry.key]}: ${entry.target}`).join(' · ')
    + (custom.definition.completion === 'exit' ? ' · затем к выходу' : '');
  const rule = el('tutorial-message').textContent || '';
  el('battle-hint').hidden = !visible || !goal;
  el('game-screen').classList.toggle('hint-active', !el('battle-hint').hidden);
  // One phrase only: the rest of the battle text stays in «О бое» and in the right panel.
  const phrase = rule.split(/(?<=[.!?])\s+/)[0] ?? rule;
  el('hint-goal').textContent = goal; el('hint-rule').textContent = phrase;
}
const sideName = (dx: number, dy: number) => dx > 0 ? 'справа' : dx < 0 ? 'слева' : dy > 0 ? 'снизу' : 'сверху';
/** Short plain-language notes about the telegraphs on the field (shown under it while no chain is held): jailer, shaman, boar. */
function telegraphNotes(state: typeof engine.state): string[] {
  const notes: string[] = [], seen = new Set<number>();
  for (const cell of state.board) {
    if (!cell || seen.has(cell.id)) continue; seen.add(cell.id);
    if (cell.variant === 'jailer' && cell.shield) {
      notes.push(shieldIsActive(cell)
        ? `Тюремщик: щит ${sideName(cell.shield.dx, cell.shield.dy)} — вход цепи с этой стороны закрыт${cell.intent.cells.length ? `; после хода удар ${cell.intent.damage} по отмеченным клеткам, затем отдых` : ''}.`
        : cell.status.frozen ? 'Тюремщик заморожен: щит опущен, бей сейчас.' : 'Тюремщик отдыхает: щит опущен — бей сейчас!');
    } else if (cell.variant === 'shaman' && isCellAlive(cell)) {
      const ids = cell.intent.empowerIds ?? [];
      notes.push(cell.status.frozen ? 'Шаман заморожен: камлания не будет.'
        : ids.length ? `Шаман: после этого хода ${ids.length === 1 ? 'гоблин с ↑ станет' : `гоблины с ↑ (${ids.length}) станут`} опаснее (вооружён → крепкий). Убей шамана или цель — камлание сорвётся.`
        : `Шаман: камлание через ${SHAMAN_PERIOD - (cell.behavior.cycle ?? 0) % SHAMAN_PERIOD} ход. Цели получат ↑; убей шамана или цель — не сработает.`);
    } else if (cell.variant === 'boar' && cell.intent.charge && chargeReady(cell, new Set())) {
      notes.push(`Кабан: «УДАР ${heroStrikeDamage(cell)}» — только первому в ряду. Остальных он «ТОЛКАЕТ» (без урона); вытолкнутый на шипы или в провал гибнет.`);
    }
  }
  return notes.slice(0, 2);
}
/** Pressure of a map battle in one compact HUD chip (numbers from runPressureInfo, no rule here). */
function updatePressureChip(state: typeof engine.state) {
  const chip = el('pressure-chip'), info = runPressureInfo(state);
  chip.hidden = !info.active || !state.runNode;
  if (chip.hidden) return;
  // Grindstone-style (04.10.2026): only the anger grows — by one each turn after the goals, up to the cap of angry ones.
  el('pressure-anger').textContent = `Разозлится: ${info.nextAnger} после хода${info.afterGoals ? ' · растёт' : ''}`;
  el('pressure-refill').textContent = `Злых: ${info.angry} из ${info.cap}`;
}
/** «N злых гоблинов» with the Russian plural. */
const angryGoblins = (count: number) => { const tens = count % 100, ones = count % 10;
  return `${count} ${tens >= 11 && tens <= 14 || ones === 0 || ones >= 5 ? 'злых гоблинов' : ones === 1 ? 'злой гоблин' : 'злых гоблина'}`; };
/** Counter to the next reinforcement of an exit battle after the goals (nextReinforcementTurn; nothing is computed here). */
function updateReinforcementChip(state: typeof engine.state) {
  const chip = el('reinforcement-chip'), next = nextReinforcementTurn(state);
  chip.hidden = next === null || state.phase === 'WIN' || state.phase === 'LOSE';
  if (chip.hidden || next === null) return;
  // During input `next − turn` actions remain; while a turn resolves the turn number already counts it.
  const left = next - state.turn, announced = state.customLevel?.reinforcement;
  chip.classList.toggle('imminent', left <= 1);
  el('reinforcement-count').textContent = left <= 1 ? 'После этого действия' : `Через ${left} ${left < 5 ? 'действия' : 'действий'}`;
  el('reinforcement-note').textContent = announced ? `Отмечено на поле · ${angryGoblins(announced.cells.length)}` : `Придут ${angryGoblins(REINFORCEMENT_COUNT)}`;
}
function updateHUD() {
  const state = engine.state;
  if (!state.level) return;
  const targeting = renderer?.itemTargeting ?? null;
  const input = state.phase === 'PLAYER_INPUT';
  const custom = state.customLevel;
  const tutorial = state.tutorial;
  const exit = custom?.definition.completion === 'exit';
  const { items: allowedItems, abilities: allowedAbilities } = toolRules(state);
  // Marked-target counter: a node battle that marks targets; otherwise the authored goals list is shown.
  const markedGoals = !!tutorial && tutorial.targetIds.length > 0;
  el('game-screen').classList.toggle('tutorial-room', !!tutorial);
  el('game-screen').classList.toggle('tutorial-abilities', !!tutorial && allowedAbilities.length > 0);
  el('game-screen').classList.toggle('tutorial-items', !!tutorial && allowedItems.length > 0);
  el('game-screen').classList.toggle('tutorial-intents', !!tutorial);
  el('return-editor').hidden = !custom || !!state.runNode;
  const chosenAbility = state.chosenAbility;
  el('energy-value').textContent = `${energyText(state.player.energy)} / 7`;
  el('energy-meter').setAttribute('aria-valuenow', String(state.player.energy));
  el('energy-meter').setAttribute('aria-valuetext', `${energyText(state.player.energy)} из 7`);
  el('energy-meter').firstElementChild!.setAttribute('style', `width:${state.player.energy / 7 * 100}%`);
  for (const kind of abilityKeys) {
    const cost = abilityCost(state, kind);
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
  el('game-screen').classList.toggle('tall-room', state.rows > state.cols + 1);
  document.querySelector<HTMLElement>('.board-column')!.style.setProperty('--board-ratio', String(state.cols / state.rows));
  placeActionDock();
  el('board-host').style.aspectRatio = `${state.cols} / ${state.rows}`;
  el('board-host').setAttribute('aria-label', `${state.level.name}. Поле ${state.cols} на ${state.rows}. Начинай цепь рядом с котом.`);
  el('level-name').textContent = state.level.name;
  el('level-description').textContent = state.level.description;
  el('compact-room-name').textContent = state.level.name;
  const goalDone = !!custom && custom.goalCompletedTurn !== null;
  el('chapter-number').textContent = state.runNode ? `ПОХОД · ${state.runNode.label.toUpperCase()}` : 'АВТОРСКИЙ УРОВЕНЬ';
  el('objective-label').textContent = markedGoals ? exit && goalDone ? 'ДОБЕРИСЬ ДО ВЫХОДА' : 'ПОБЕДИ ОТМЕЧЕННЫХ' : !goalDone ? 'ВЫПОЛНИ ЦЕЛИ' : exit ? 'ДОБЕРИСЬ ДО ВЫХОДА' : 'ЦЕЛЬ ВЫПОЛНЕНА';
  el('compact-room-goal').textContent = state.runNode ? state.runNode.label : !goalDone ? 'Выполни цели' : exit ? 'Выход открыт' : 'Победа';
  const doors = uniqueDoors();
  el('door-guide').hidden = !doors.length || markedGoals;
  el('door-options').textContent = !goalDone ? '⇥ Закрыт до цели' : '⇥ Выход открыт';
  updateDoorInfo(); updateGuide(); updateReinforcementChip(state);
  const back = document.querySelector<HTMLButtonElement>('.chapter-select')!;
  back.dataset.action = state.runNode ? 'run-map' : 'title'; back.textContent = state.runNode ? '← К КАРТЕ' : '← В МЕНЮ';
  el('tutorial-message').textContent = tutorial?.hintDismissed ? '' : state.level.tutorial;
  document.querySelector<HTMLElement>('.chapter-note')!.hidden = !!tutorial?.hintDismissed;
  el('health').innerHTML = state.player.maxHp > 10
    ? `<span class="health-numeric" aria-hidden="true">${state.player.hp} / ${state.player.maxHp} ♥</span>`
    : Array.from({ length: state.player.maxHp }, (_, i) => `<span class="heart ${i < state.player.hp ? 'full' : 'empty'}" aria-hidden="true">♥</span>`).join('');
  el('health').setAttribute('aria-label', `Здоровье: ${state.player.hp} из ${state.player.maxHp}`);
  // The run's talismans beside HP (docs/talismans.md); the Ash ward greys out once it has saved the cat.
  const talismanRow = talismanBadgesHtml(state.runNode?.talismans ?? [], !!state.player.ward) + modifierBadgesHtml((state.runNode?.modifiers ?? []).map(modifier => ({ modifier })), 'now');
  if (el('talisman-row').innerHTML !== talismanRow) el('talisman-row').innerHTML = talismanRow;
  el('talisman-row').hidden = !talismanRow;
  const activeEffects = summarizeDamageEffects(state.player.damageEffects);
  const effectCounts = [activeEffects.burning ? `Горение ×${activeEffects.burning}` : '', activeEffects.poison ? `Яд ×${activeEffects.poison}` : '', activeEffects.bleeding ? `Кровотечение ×${activeEffects.bleeding}` : ''].filter(Boolean);
  el('damage-effects-summary').hidden = effectCounts.length === 0;
  el('damage-effects-summary').textContent = effectCounts.join(' · ');
  el('turn-number').textContent = String(state.turn + (input ? 1 : 0)).padStart(2, '0');
  if (custom?.definition.turnLimit) el('turn-number').textContent+=` / ${custom.definition.turnLimit}`;
  el('score').textContent = state.score.toLocaleString('ru-RU');
  const boss = state.board.find(cell => cell?.kind === 'boss');
  if (tutorial && markedGoals) {
    const total = tutorial.targetIds.length;
    const progress = Math.min(total, state.objective.tutorialTargets ?? 0);
    const jailer = boss?.variant === 'jailer' ? boss : undefined;
    // Every map battle has an exit door (02.10.2026): the goal progress stays visible, the door state goes below it.
    el('objectives').innerHTML = (jailer ? `<div class="objective tutorial-objective"><div><span>Тюремщик · HP</span><strong>${jailer.hp}<small> / ${jailer.maxHp}</small></strong></div><div class="objective-track"><span style="width:${(1 - jailer.hp / jailer.maxHp) * 100}%"></span></div></div>`
      : `<div class="objective tutorial-objective"><div><span>Отмеченные охранники</span><strong>${progress}<small> / ${total}</small></strong></div><div class="objective-track"><span style="width:${total ? progress / total * 100 : 0}%"></span></div></div>`)
      + (exit ? `<p class="key-status">⇥ ${!goalDone ? 'Выход откроется после целей' : 'Выход открыт · войди цепью'}</p>` : '');
  } else if (custom) {
    const labels={kills:'Победить врагов',rangedKills:'Победить стрелков',bossKills:'Победить главарей',turns:'Выдержать ходы'};
    el('objectives').innerHTML=custom.definition.goals.map(goal=>`<div class="objective"><div><span>${labels[goal.key]}</span><strong>${Math.min(goal.target,state.objective[goal.key])}<small> / ${goal.target}</small></strong></div><div class="objective-track"><span style="width:${Math.min(100,state.objective[goal.key]/goal.target*100)}%"></span></div></div>`).join('')+(exit?`<p class="key-status">⇥ ${!goalDone ? 'Выход откроется после целей' : 'Выход открыт · войди цепью'}</p>`:'');
  } else el('objectives').innerHTML = '';
  const count = state.chain.length;
  // Hovering «Отдых» shows what resting would do, in the same forecast format (engine.previewRest).
  // Two side forecasts share one display rule: the spin selected (two-step, like the jump) and the pointer over «Отдых».
  const spinMode = chosenAbility === 'spin' && count === 0 && input && !targeting;
  const restMode = spinMode || restHover && count === 0 && input;
  const preview = spinMode ? engine.previewAbility('spin') : restMode ? engine.previewRest() : engine.preview();
  document.querySelector('.chain-card')!.classList.toggle('active', count > 0);
  const forecastEffects = summarizeDamageEffects(preview.endEffects);
  const pendingEffects = [forecastEffects.burning ? `горение ×${forecastEffects.burning}` : '', forecastEffects.poison ? `яд ×${forecastEffects.poison}` : '', forecastEffects.bleeding ? `кровотечение ×${forecastEffects.bleeding}` : ''].filter(Boolean);
  const lastHit = preview.hits[preview.hits.length - 1];
  // The Whetstone (talismans.ts) gives this first ordinary chain of the battle a power of 1.
  const whetstoneLine = !restMode && count > 0 && preview.whetstone ? '<br><b id="whetstone-line">Точильный камень: +1 к запасу</b>' : '';
  el('mobile-chain-readout').hidden = !input || count === 0;
  el('mobile-chain-readout').classList.toggle('danger', preview.damage > 0 || pendingEffects.length > 0);
  el('mobile-chain-count').textContent = String(count);
  el('mobile-chain-power').textContent = preview.opensDoor !== undefined ? 'ВЫХОД' : preview.completesRoom ? 'ПОБЕДА' : String(lastHit?.remainingPower ?? preview.power);
  el('mobile-chain-status').textContent = !preview.valid ? 'ПРОДОЛЖАЙ' : 'ОТВЕТ';
  el('mobile-chain-damage').textContent = !preview.valid ? 'ЕЩЁ ЦЕЛЬ' : preview.damage ? `−${preview.damage} HP` : pendingEffects.length ? 'ЭФФЕКТ' : '0 HP';
  el('chain-number').textContent = String(count);
  el('chain-number').classList.toggle('powered', preview.power >= 5);
  el('chain-rank').textContent = preview.valid && preview.exitNext !== undefined ? `ПРОДОЛЖИ В ВЫХОД${preview.damage ? ` · −${preview.damage} HP` : ''}` : preview.opensDoor !== undefined ? 'ВЫХОД · ПОБЕДА' : preview.completesRoom ? 'ПОБЕДНЫЙ УДАР' : preview.valid && preview.enemyPhase?.completesObjective ? 'ПОБЕДА ПОСЛЕ ОТВЕТА ВРАГОВ' : preview.valid && (preview.unlocksExit || preview.enemyPhase?.unlocksExit) ? `ВЫХОД ОТКРОЕТСЯ${preview.unlocksExit ? '' : ' ПОСЛЕ ОТВЕТА ВРАГОВ'}${preview.damage ? ` · −${preview.damage} HP` : ''}` : count >= 1 && preview.valid ? 'ОТПУСТИ ДЛЯ УДАРА' : count >= 1 ? 'ПРОДОЛЖАЙ ЦЕПЬ' : 'НАЧНИ РЯДОМ С КОТОМ';
  el('chain-meter-fill').style.width = `${Math.min(100, preview.power / 7 * 100)}%`;
  const budgetLine = spinMode ? 'Круговой удар: <b>8 соседей</b>, каждому 4 урона. Кот остаётся на месте.' : restMode ? 'Отдых: <b>+0,5 энергии</b>. Враги и события поля действуют.' : lastHit ? `Запас: <b>${lastHit.availablePower}</b> · потрачено: <b>${lastHit.powerSpent}</b> · осталось: <b>${lastHit.remainingPower}</b>` : 'Каждый враг: <b>+1 к силе</b>. Слабый (0 HP) тратит 0.';
  el('chain-reward').innerHTML = preview.opensDoor !== undefined ? '<b>Выход через дверь</b><br>Бой завершится до ответа врагов.' : preview.completesRoom ? '<b>Противник будет повержен</b><br>Бой завершится до ответа врагов.' : `${budgetLine}${lastHit ? preview.endsOnSurvivor ? `<br>После удара: ${lastHit.hpAfter} HP` : `<br>Побеждено: ${preview.kills}` : ''}`;
  if (lastHit?.attackEffect === 'fire' && !lastHit.killed) el('chain-reward').innerHTML += '<br>+1 горение · урон в конце хода, после ответа врагов.';
  if (whetstoneLine) el('chain-reward').innerHTML += whetstoneLine;
  if (preview.crystals) el('chain-reward').innerHTML += `<br><b>+${preview.crystals} ${preview.crystals === 1 ? 'кристалл упадёт' : 'кристалла упадут'} по ходу цепи</b> · место — сюрприз, смена цвета, очки за разрушение`;
  if (crystalsActive(state) && !restMode && count > 0 && preview.valid) el('chain-reward').innerHTML += `<br>До кристалла: <b>${preview.kills % crystalKills(state)} / ${crystalKills(state)}</b> убийств цепью`;
  const lootHits = preview.hits.filter(hit => hit.loot);
  if (lootHits.length) el('chain-reward').innerHTML += `<br>Подберёт: <b>${lootHits.map(hit => lootLabel(hit.loot!)).join(', ')}</b>`;
  const chestHits = preview.hits.filter(hit => hit.chest);
  if (chestHits.length) el('chain-reward').innerHTML += `<br>Откроет сундук: <b>${chestLabel(chestHits.flatMap(hit => hit.chest!))}</b>`;
  if (preview.exitNext !== undefined) el('chain-reward').innerHTML += '<br><b>Дверь рядом</b> · продолжи цепь в выход: победа до ответа врагов';
  if (preview.unlocksExit) el('chain-reward').innerHTML += '<br><b>Цели будут выполнены</b> · выход откроется, упадёт сундук, если найдётся место (место — сюрприз)';
  if (preview.crystalScore) el('chain-reward').innerHTML += `<br>Кристаллы разрушены: <b>+${preview.crystalScore} очков</b>`;
  if ((!tutorial || allowedAbilities.length) && preview.valid && preview.energyGain > 0) el('chain-reward').innerHTML += `<br>Энергия: <b>+${energyText(preview.energyGain)}</b>`;
  const activations = preview.deviceActivations ?? [];
  if (activations.length) el('chain-reward').innerHTML += `<br>${activations.map(device => device.kind === 'fire' ? '♨ Огонь: +1 горение после жаровни' : device.kind === 'pits' ? '▱ Провалы после цепи' : '⌁ Залп после цепи').join('<br>')}`;
  if (preview.trapHits?.length) el('chain-reward').innerHTML += `<br>Ловушка: <b>${preview.trapKills ?? 0}</b> повержено · ${preview.trapHits.filter(hit => !hit.killed).length} ранено`;
  // Every source of cat damage comes from the engine's forecast (`damageBySource`, `chargeBreakdown`); nothing is derived by subtraction.
  const bySource = preview.damageBySource, charge = preview.chargeBreakdown;
  const chargeText = charge ? ([['удар', charge.ram], ['шипы', charge.spikes], ['колючки', charge.thorns], ['провал', charge.pit]] as const).filter(([, amount]) => amount > 0).map(([name, amount]) => `${name} ${amount}`).join(', ') : '';
  const forecastParts = [bySource.quills ? `иглы ${bySource.quills}` : '', bySource.charge ? `кабан: ${chargeText || bySource.charge}` : '', bySource.thorns ? `колючки в конце цепи ${bySource.thorns}` : '',
    bySource.melee ? `враги ${bySource.melee}` : '', bySource.ranged ? `лучник ${bySource.ranged}` : '', bySource.boss ? `босс ${bySource.boss}` : '', bySource.troll ? `дубина тролля ${bySource.troll}` : '', bySource.trap ? `ловушка ${bySource.trap}` : '',
    bySource.bleeding ? `кровотечение при шагах ${bySource.bleeding}` : '', bySource.burning ? `горение ${bySource.burning}` : '', bySource.poison ? `яд ${bySource.poison}` : ''].filter(Boolean);
  const quillHits = preview.hits.filter(hit => state.board[hit.index]?.variant === 'porcupine');
  if (quillHits.some(hit => hit.spikeDamage)) el('chain-reward').innerHTML += `<br>Иглы дикобраза: <b>−${bySource.quills} HP</b> · ударов по дикобразам: ${quillHits.filter(hit => hit.spikeDamage).length}`;
  if (quillHits.some(hit => !hit.spikeDamage && state.board[hit.index]?.status.frozen)) el('chain-reward').innerHTML += '<br>Дикобраз заморожен: <b>без игл</b>';
  const phaseForecast = preview.enemyPhase;
  if (phaseForecast && preview.valid) {
    const causeNames: Record<string, string> = { ram: 'удар кабана', spikes: 'шипы', thorns: 'колючки', pit: 'провал', arrow: 'стрела', club: 'дубина тролля' };
    const byCause = new Map<string, number>();
    for (const death of phaseForecast.deaths) byCause.set(death.cause, (byCause.get(death.cause) ?? 0) + 1);
    if (byCause.size) {
      const goalDeaths = phaseForecast.deaths.filter(death => enemyDefeatCountsForGoal(state, state.board.find(cell => cell?.id === death.id))).length;
      el('chain-reward').innerHTML += `<br>После цепи погибнут: ${[...byCause].map(([cause, n]) => `${causeNames[cause] ?? cause} ×${n}`).join(', ')} · <b>не засчитано игроку</b>: ${phaseForecast.deaths.length - goalDeaths}${goalDeaths ? `, в задание: ${goalDeaths}` : ''}`;
    }
    if (phaseForecast.heroIndex !== preview.endIndex) el('chain-reward').innerHTML += `<br>Кота сдвинут: ${gridLabel(phaseForecast.heroIndex)}`;
    if (phaseForecast.completesObjective) el('chain-reward').innerHTML += '<br><b>Победа после ответа врагов</b> · если кот переживёт ответ';
    if (phaseForecast.unlocksExit) el('chain-reward').innerHTML += '<br><b>Выход откроется после ответа врагов</b> · цели выполнятся в конце хода, если кот переживёт ответ';
    if (phaseForecast.charges.some(charge => charge.stunned)) el('chain-reward').innerHTML += '<br>Кабан упрётся и оглушится';
    if (phaseForecast.packBroken.length) el('chain-reward').innerHTML += `<br><b>Стая разбита</b>: удар ${phaseForecast.packBroken.length === 1 ? 'волка отменится' : `${phaseForecast.packBroken.length} волков отменится`}`;
    if (phaseForecast.regenerated.length) el('chain-reward').innerHTML += `<br><b>Тролль восстановит ${phaseForecast.regenerated.reduce((sum, regen) => sum + regen.amount, 0)} HP</b> · урон или горение это остановят`;
    const announced = state.board.reduce((sum, cell) => sum + (cell?.variant === 'shaman' ? cell.intent.empowerIds?.length ?? 0 : 0), 0);
    if (phaseForecast.empowered.length) el('chain-reward').innerHTML += `<br>Камлание: станут опаснее — ${phaseForecast.empowered.length} (${phaseForecast.empowered.map(rite => rite.tier === 'sturdy' ? '↑ крепкий' : '↑ вооружён').join(', ')})`;
    if (announced > phaseForecast.empowered.length) el('chain-reward').innerHTML += `<br>Камлание отменено: ${announced - phaseForecast.empowered.length}`;
  }
  // The panel must not change height while the pointer rests on the button (it would move away): the details go under the field.
  let restText = '';
  // A lethal hit the Ash ward takes may leave the cat at the same HP (damage 0 at 1 HP): it is still shown as a risk.
  const hurts = preview.damage > 0 || !!preview.wardSaves, wardShort = preview.wardSaves && !preview.playerDies ? ' · оберег спасёт' : '';
  /** HP lost, or «смертельно» for a ward-saved hit that leaves the cat at its 1 HP. */
  const loss = (parts = true) => preview.damage > 0 ? `−${preview.damage} HP${parts && forecastParts.length ? ` (${forecastParts.join('; ')})` : ''}${parts ? lethalNote(preview) : wardShort}` : 'смертельно — оберег спасёт';
  if (restMode) {
    const extras = el('chain-reward').innerHTML.split('<br>').slice(1).map(part => part.replace(/<[^>]+>/g, '')).filter(part => part && !part.startsWith('Энергия'));
    const spinHead = `Круговой удар: целей ${preview.hits.length}, погибнет ${preview.hits.filter(hit => hit.killed).length}; кот ${hurts ? loss() : 'без урона'}`;
    restText = spinMode ? `${spinHead}${extras.length ? ` · ${extras.join(' · ')}` : ''}. Ещё раз (кнопка, кот, Enter) — ударить, Esc — отмена.` : `Отдых: ${hurts ? loss() : 'безопасно'}${extras.length ? ` · ${extras.join(' · ')}` : ''}.`;
    el('chain-reward').innerHTML = 'Каждый враг: <b>+1 к силе</b>. Слабый (0 HP) тратит 0.';
  }
  el('risk-preview').textContent = restMode ? (spinMode ? (hurts ? `⚠ Круговой: ${loss(false)}` : '✓ Круговой безопасен') : hurts ? `⚠ Отдых: ${loss(false)}` : '✓ Отдых безопасен') : count === 0 ? 'Выбери безопасный последний шаг.' : !preview.valid ? preview.reason : hurts ? `⚠ После цепи: ${loss()}${pendingEffects.length ? `. Останется: ${pendingEffects.join(', ')}` : ''}` : pendingEffects.length ? `⚠ После хода: ${pendingEffects.join(', ')}` : '✓ Конец цепи безопасен';
  el('risk-preview').classList.toggle('danger', (count > 0 || restMode) && (!preview.valid || hurts || pendingEffects.length > 0));
  el('status-message').textContent = targeting ? `${ITEMS[targeting].label}: выбери цель на поле.` : chosenAbility === 'jump' ? `Прыжок: выбери клетку приземления в пределах ${JUMP_RANGE}.` : count > 0 ? preview.valid ? `Целей: ${count} · кот остановится: ${gridLabel(preview.endIndex)}` : preview.reason : focusedDoor !== null ? el('door-detail').textContent ?? '' : restMode ? restText : telegraphNotes(state).join(' ') || state.message || 'Начни цепочку рядом с котом.';
  el('status-message').classList.toggle('telegraph', !targeting && !chosenAbility && count === 0 && focusedDoor === null && telegraphNotes(state).length > 0);
  const actors = uniqueEntities(state.board);
  const ready = actors.filter(({cell, index}) => enemyReadyToAttack(cell, index, state)).length;
  const resting = planEnemyPhase(state.board, state.player.index).resting.length;
  const frozen = actors.filter(({cell}) => cell.status.frozen > 0).length;
  const swaps = engine.previewRotations().filter(rotation => rotation.active)
    .map(rotation => `${gridLabel(rotation.from)} ↔ ${gridLabel(rotation.to)}`);
  if (preview.pitCells?.length) el('chain-reward').innerHTML += `<br>Откроются: ${preview.pitCells.map(gridLabel).join(', ')}${preview.pitCells.includes(preview.endIndex) ? preview.wardSaves && !preview.playerDies ? '<br><b>ПАДЕНИЕ — ОБЕРЕГ СПАСЁТ</b>' : '<br><b>ПАДЕНИЕ — СМЕРТЬ</b>' : ''}`;
  if (preview.pitImmuneCells?.length) el('chain-reward').innerHTML += `<br>Заклинит: ${preview.pitImmuneCells.map(gridLabel).join(', ')}`;
  const devices = state.devices ?? [];
  el('device-summary').hidden = !devices.length;
  el('device-summary').textContent = devices.map(device => device.kind === 'pits' ? `▱ ${gridLabel(device.index)} · ${device.charges} зар. · люки: ${device.targets.map(gridLabel).join(', ')}${state.pits?.length ? ' · открыты на этот ход' : ''}` : device.kind === 'fire' ? `♨ ${gridLabel(device.index)}: жаровня · зарядов ${device.charges}. +1 горение ударам после неё в этой цепи.` : `⌁ ${gridLabel(device.index)}: рычаг · зарядов ${device.charges}. Залп ${device.damage ?? 4} после цепи: ${deviceTargets(state, device).map(gridLabel).join(', ')}. Уведи кота с линии.`).join(' · ');
  const riteTargets = actors.reduce((sum, { cell }) => sum + (cell.variant === 'shaman' && cell.status.frozen === 0 ? cell.intent.empowerIds?.length ?? 0 : 0), 0);
  const loneWolves = actors.filter(({ cell }) => cell.variant === 'wolf' && cell.intent.label === 'Одинок').length;
  el('intent-summary').textContent = `Готовы атаковать: ${ready} · Отдыхают: ${resting}${frozen ? ` · Во льду: ${frozen}` : ''}${riteTargets ? ` · Камлание: ${riteTargets}` : ''}${loneWolves ? ` · Одиноких волков: ${loneWolves}` : ''}${swaps.length ? `. Обмен: ${swaps.join('; ')}.` : ''}`;
  const shields = state.board.flatMap((cell, index) => (cell?.variant === 'sentinel' || cell?.variant === 'jailer') && cell.shield
    ? [`${gridLabel(index)} ${!shieldIsActive(cell) ? cell.status.frozen ? '❄ щит снят' : 'щит снят · окно для удара' : cell.shield.dx > 0 ? '→' : cell.shield.dx < 0 ? '←' : cell.shield.dy > 0 ? '↓' : '↑'}`] : []);
  el('shield-summary').hidden = shields.length === 0;
  el('shield-summary').textContent = `Щиты: ${shields.join(' · ')}. Цепью заходи сбоку.`;
  const colorNames=['Киноварь ▲','Мох ✚','Лазурь □','Охра ●','Аметист ✕'];
  // The refill palette is listed for an editor level; a map node keeps the field quiet.
  el('palette-summary').hidden=!custom || !!tutorial;
  if(custom && !tutorial){const extra=custom.definition.extraColors.map(entry=>{const remaining=custom.goalCompletedTurn===null?null:Math.max(0,custom.goalCompletedTurn+entry.afterGoalTurns-state.turn);return`${colorNames[entry.color]}: ${remaining===null?`после цели +${entry.afterGoalTurns}`:remaining?`через ${remaining} ход.`:'в пополнении'}`;});el('palette-summary').textContent=`Палитра: ${custom.paletteWeights.map((weight,i)=>weight>0?colorNames[i]:null).filter(Boolean).join(', ')}.${extra.length?' '+extra.join(' · '):''}`;}
  const phases: Record<string, string> = { PLAYER_RESOLVE: 'УДАРЫ ТОПОРА', ENEMY_RESOLVE: 'ПРОТИВНИКИ ОТВЕЧАЮТ', BOARD_UPDATE: 'ПОЛЕ МЕНЯЕТСЯ' };
  el('phase-banner').hidden = !phases[state.phase]; el('phase-banner').textContent = phases[state.phase] ?? '';
  for (const item of itemKeys) {
    const button = el<HTMLButtonElement>(`${item}-button`), quantity = state.inventory[item];
    button.hidden = !!tutorial && !allowedItems.includes(item);
    button.disabled = !!tutorial && !allowedItems.includes(item) || !input || quantity < 1 || state.itemPrepared || (item === 'healing' && !engine.previewItem('healing').valid);
    button.classList.toggle('targeting', targeting === item); button.setAttribute('aria-pressed', String(targeting === item));
    button.setAttribute('aria-label', `${ITEMS[item].label}: ${quantity}. ${ITEMS[item].description}`);
    el(`${item}-label`).textContent = `${itemNames[item]} · ${quantity}`;
  }
  el('cancel-frost').hidden = !targeting;
  const waitButton = el<HTMLButtonElement>('wait-button');
  waitButton.disabled = !input || !!targeting || !!chosenAbility;
  renderer?.setRestPreview(restHover && !waitButton.disabled && count === 0);
  waitButton.textContent = tutorial && !allowedAbilities.length ? 'Пропустить ход' : 'Отдых · +0,5 энергии';
  waitButton.setAttribute('aria-label', tutorial && !allowedAbilities.length ? 'Пропустить ход. Враги действуют.' : 'Отдых: плюс 0,5 энергии. Враги и события поля действуют.');
  el('item-hint').textContent = targeting ? `${ITEMS[targeting].description} Esc — отменить выбор.` : state.itemPrepared ? 'Средство применено. Проведи цепь или отдохни; затем действуют враги.' : tutorial ? state.inventory.frost > 0 ? 'Холод замораживает любого врага. Один флакон перед цепью; повтор восстановит запас.' : 'Холод: нет флаконов. Продолжай цепью или доступной способностью.' : 'Один расходник перед цепью. Повтор восстановит запас на входе.';
  el('item-hint').hidden = !targeting && !state.itemPrepared;
  document.querySelectorAll<HTMLButtonElement>('[data-action="title"], [data-action="run-map"], [data-action="help"], [data-action="pause"], [data-action="editor"]').forEach(button => { button.disabled = Boolean(phases[state.phase]) && screen === 'game'; });
  if (count > previousChain) audio.play('select', count);
  previousChain = count;
  updateBattleHint(state, custom);
  updatePressureChip(state);
  if (input && outcomeShown) { outcomeShown = ''; hideModal(); }
  if (!starting && (state.phase === 'WIN' || state.phase === 'LOSE') && outcomeShown !== state.phase && screen === 'game') {
    outcomeShown = state.phase;
    showOutcome(state.phase === 'WIN');
  }
}
function showModal(html: string) {
  el('modal').classList.remove('playtest-modal');
  el('modal').innerHTML = html; el('modal-layer').hidden = false;
  document.querySelectorAll<HTMLElement>('.site-header, main, .site-footer').forEach(background => { background.inert = true; });
  requestAnimationFrame(() => el('modal').querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
}
// Playtest screen: opened from the title link or the pause dialog; the game itself never depends on it.
let playtestFrom: 'title' | 'pause' | null = null;
function renderPlaytest(options: { confirmClear?: boolean; notice?: string } = {}) {
  const profile = profileStore.load();
  showModal(playtestHtml({ ...options, trunkCleared: profile.trunkCleared, meta: { ...profile.meta, next: barView(profile.meta).next, giftFull: profile.giftFull } }));
  el('modal').classList.add('playtest-modal');
}
function openPlaytest() { playtestFrom = paused ? 'pause' : 'title'; renderPlaytest(); }
function closePlaytest() {
  const from = playtestFrom; playtestFrom = null; hideModal();
  if (from === 'pause') document.querySelector<HTMLButtonElement>('[data-action="pause"]')?.click();
}
function downloadPlaytest() {
  try {
    const url = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `ashen-oath-playtest-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    renderPlaytest({ notice: 'Файл сохранён.' });
  } catch { renderPlaytest({ notice: 'Не удалось скачать файл.' }); }
}
async function copyPlaytest() {
  try { await navigator.clipboard.writeText(exportJson()); renderPlaytest({ notice: 'JSON скопирован в буфер обмена.' }); }
  catch { renderPlaytest({ notice: 'Буфер обмена недоступен: используйте «Скачать JSON».' }); }
}
function hideModal() {
  el('modal-layer').hidden = true; paused = false; playtestFrom = null;
  document.querySelectorAll<HTMLElement>('.site-header, main, .site-footer').forEach(background => { background.inert = false; });
}
function showOutcome(won: boolean) {
  const state = engine.state;
  renderer?.setItemTargeting(null);
  if (state.runNode) { showRunOutcome(won); return; }
  audio.play(won?'reward':'damage');
  showModal(`<p class="eyebrow">АВТОРСКИЙ УРОВЕНЬ</p><h2 id="modal-title">${won?'Уровень пройден':'Попробуй другой путь'}</h2><p class="modal-copy">${won?'Цель достигнута. Вернись к карте, чтобы изменить бой, или повтори с тем же зерном.':'Повтор восстановит начальное поле, здоровье, предметы и палитру.'}</p><div class="result-stats"><span><b>${state.score}</b>ОЧКИ</span><span><b>${state.turn}</b>ХОДЫ</span></div><button class="button primary" data-action="editor">В РЕДАКТОР</button><button class="button secondary" data-action="retry">ПОВТОРИТЬ УРОВЕНЬ</button><button class="text-button" data-action="title">В МЕНЮ</button>`);
}
function showHelp() {
  quietCancel(); renderer?.setItemTargeting(null); paused = true;
  if (screen === 'game' && engine.state.runNode) {
    const { runNode, level } = engine.state;
    showModal(`<p class="eyebrow">ПОХОД · ${runNode.label.toUpperCase()}</p><h2 id="modal-title">${level.name}</h2><p class="modal-copy">${level.tutorial} Веди цепь через соседние клетки одного цвета. Отпусти мышь или палец — удар даже по одной цели. Вернись на предыдущую клетку, чтобы убрать последний шаг.</p><button class="button primary" data-action="resume">ВЕРНУТЬСЯ В БОЙ</button>`);
    return;
  }
  showModal(`<p class="eyebrow">НАСТАВЛЕНИЕ КОТУ-ВАРВАРУ</p><h2 id="modal-title">Один топор. Целый лес.</h2><div class="help-rules"><p><b>Поход по лесу</b>Выбирай следующий узел на карте: бои, привалы и находки. Здоровье, энергия и предметы переходят между узлами. Поражение в бою заканчивает поход: следующий начинается заново.</p><p><b>Цепочка и последний шаг</b>Начни рядом с котом и проведи через цели одного цвета по горизонтали, вертикали или диагонали. Диагональ закрыта, только если обе боковые клетки непроходимы. Каждый враг добавляет 1 к бюджету удара. Враг с 0 HP слабый: гибнет от удара и ничего не тратит. Остальные тратят своё HP из бюджета; если бюджета не хватило, последний враг выживет с раной. Последнего врага можно ранить, но пройти через живого нельзя. Кот остаётся на последней освобождённой клетке. Бесцветные цели подходят к любому цвету. Вернись на шаг назад, чтобы сократить цепь. Каждые 6 убийств одной цепью оставляют кристалл на случайной клетке: он даёт очки, когда цепь его разрушит. Цепь можно начать с кристалла или пройти через него по пути: цвет меняется, силы он не даёт.</p><p><b>Красные клетки — будущая атака</b>Разозлённый гоблин бьёт только четырёх соседей по сторонам и остаётся опасным до попадания по коту. Лучник стреляет в отмеченную линию, затем отдыхает. Знак ⇄ связывает две клетки. Гибель врага не отменяет обмен: его место займёт пополнение. Кот на любом конце или живой враг во льду остановят обмен.</p><p><b>Выход</b>В бою с выходом дверь открывается после выполнения целей. Дойди до неё цепью; соседнюю открытую дверь можно выбрать одну и отпустить.</p><p><b>Энергия и способности</b>Обычная цепь даёт +0,5 энергии за каждого атакованного врага, максимум 7. Прыжок стоит 2: дальность ${JUMP_RANGE}, физический удар 4, приземление только на пустой пол или убитого врага. Круговой удар стоит 3 и сразу бьёт всех восьмерых соседей на 4, оставляя кота на месте. Выбор прыжка отменяется повторным нажатием либо Esc. Энергия переносится между боями похода. Отдых даёт +0,5 энергии до предела 7 и запускает обычный ход врагов со всеми событиями поля.</p><p><b>Направленный щит</b>Щитоносец и Тюремщик закрывают золотой гранью переднюю сторону. Вход цепи с этой стороны запрещён; направление подхода считается от предыдущей цели. Обойди сбоку. Лёд отключает щит. Прыжок, круговой удар и предметы игнорируют направление щита, но сохраняют обычные требования урона и приземления.</p><p><b>Один предмет перед цепью</b>Холод замораживает любого врага и даёт хрупкость. Бомба повреждает выбранного врага. Огонь накладывает горение на выбранную и соседние клетки без мгновенного урона; горение и яд ранят в конце хода. Кровотечение ранит после каждых трёх обычных шагов, а ветер усиливает уже горящую цель. Лечение возвращает здоровье и снимает яд и кровотечение даже при полном HP, но не тушит огонь. Выбери предмет и цель, затем проведи цепь или выбери отдых. Esc отменит выбор цели. Лёд приостанавливает действия и отдых врага.</p></div><button class="button primary" data-action="resume">${screen === 'game' ? 'ВЕРНУТЬСЯ В БОЙ' : 'ПОНЯТНО'}</button>`);
}
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  if (!el('modal-layer').hidden && !el('modal').contains(target)) return;
  audio.unlock();
  if (target.dataset.find && itemKeys.includes(target.dataset.find as ItemKind)) { chooseFind(target.dataset.find as ItemKind); return; }
  if (target.dataset.eventOption) { chooseEvent(target.dataset.eventOption); return; }
  if (target.dataset.talisman) { chooseTalismanOption(target.dataset.talisman as TalismanOption); return; }
  if (target.dataset.craft && isResource(target.dataset.craft)) { craftAtRest(target.dataset.craft); return; }
  if (target.dataset.shopBuy) { buyAtShop(target.dataset.shopBuy); return; }
  if (target.dataset.gift) { chooseGiftButton(Number(target.dataset.gift)); return; }
  if (target.dataset.giftPick) { pickGift(target.dataset.giftPick); return; }
  switch (target.dataset.action) {
    // The run's own battle is never replayed (a defeat ends the run); retry is for editor levels and debug battles.
    case 'retry': if (!ownsRunBattle()) void openScene(() => engine.restartLevel()); break;
    case 'title': quietCancel(); showScreen('title'); break;
    case 'editor': quietCancel(); showScreen('editor'); break;
    case 'resume': hideModal(); break;
    case 'sound': audio.enabled = !audio.enabled; save.sound = audio.enabled; persist(); updateSound(); if (audio.enabled) { audio.unlock(); audio.play('click'); } break;
    case 'help':
      // In a battle the first «?» calls the big hint back; with the hint on screen it opens the full rules.
      if (screen === 'game' && hintTurn === null && engine.state.phase === 'PLAYER_INPUT') { hintTurn = engine.state.turn; updateHUD(); break; }
      showHelp(); break;
    case 'hint-close': hintTurn = null; updateHUD(); break;
    case 'ability': {
      const kind = target.dataset.ability as AbilityKind;
      renderer?.setItemTargeting(null);
      // The spin is chosen in two steps like the jump: the first press shows the zone, the second confirms (Esc cancels).
      if (kind === 'spin') { if (engine.state.chosenAbility === 'spin') void engine.useAbility('spin'); else engine.setAbility('spin'); }
      else engine.setAbility(engine.state.chosenAbility === kind ? null : kind);
      updateHUD(); break;
    }
    case 'cancel-ability': engine.setAbility(null); updateHUD(); break;
    case 'frost': case 'item': {
      const item = (target.dataset.item ?? 'frost') as ItemKind;
      engine.setAbility(null);
      quietCancel();
      if (item === 'healing') { renderer?.setItemTargeting(null); engine.useItem(item); }
      else renderer?.setItemTargeting(renderer?.itemTargeting === item ? null : item);
      updateHUD(); break;
    }
    case 'cancel-frost': renderer?.setItemTargeting(null); updateHUD(); break;
    case 'wait': quietCancel(); void engine.waitTurn(); break;
    case 'pause': engine.setAbility(null); quietCancel(); renderer?.setItemTargeting(null); paused = true; showModal(pauseHtml()); break;
    case 'run-start': resumeRun(); break;
    case 'run-new': case 'run-reset-yes': newRun(); break;
    case 'run-reset': mapConfirmReset = true; refreshRunViews(); break;
    case 'run-reset-no': mapConfirmReset = false; refreshRunViews(); break;
    case 'ladder-down': case 'ladder-up': {
      const { open, chosen } = ladderChoice();
      chosenLadder = Math.max(0, Math.min(open, chosen + (target.dataset.action === 'ladder-up' ? 1 : -1)));
      renderRunEntry(); document.querySelector<HTMLButtonElement>(`[data-action="${target.dataset.action}"]:not(:disabled)`)?.focus(); break;
    }
    case 'map-node': if (target.getAttribute('aria-disabled') !== 'true' && target.dataset.node) enterMapNode(target.dataset.node); break;
    case 'run-battle': void playRunBattle(); break;
    case 'run-find': showFind(); break;
    case 'run-talisman': showTalisman(); break;
    case 'talisman-refuse': chooseTalismanOption(null); break;
    case 'run-event': showEvent(); break;
    case 'run-rest': showRest(); break;
    case 'rest-heal': healAtRest(); break;
    case 'rest-finish': finishRest(); break;
    case 'run-shop': showShop(); break;
    case 'run-gift': if (screen !== 'map') { quietCancel(); showScreen('map'); } showGift(); break;
    case 'run-unlocks': if (forestRun?.tally?.opened) showModal(unlockModalHtml(forestRun.tally.opened)); break;
    case 'run-result': if (forestRun?.result) showModal(runResultHtml(forestRun, { openedLadder: openedLadderShown })); break;
    case 'shop-leave': leaveShop(); break;
    case 'run-map': quietCancel(); showScreen('map'); break;
    case 'playtest': openPlaytest(); break;
    case 'playtest-close': closePlaytest(); break;
    case 'playtest-clear': renderPlaytest({ confirmClear: true }); break;
    case 'playtest-clear-no': renderPlaytest(); break;
    case 'playtest-clear-yes': clearTelemetry(); renderPlaytest({ notice: 'Журнал очищен.' }); break;
    case 'playtest-toggle': setTelemetryEnabled(!telemetryEnabled()); renderPlaytest({ notice: telemetryEnabled() ? 'Журнал включён.' : 'Журнал выключен: новые попытки не записываются.' }); break;
    case 'playtest-download': downloadPlaytest(); break;
    case 'profile-reset-meta': profileStore.resetMeta(); renderRunEntry(); renderPlaytest({ notice: 'Полоса открытий и отметка дара сброшены: следующий поход — с мини-даром и стартовым набором.' }); break;
    case 'profile-reset-trunk': profileStore.resetTrunk(); renderRunEntry(); renderPlaytest({ notice: 'Отметка ствола сброшена: следующий новый поход начнётся со ствола.' }); break;
    case 'playtest-copy': void copyPlaytest(); break;
  }
});
const restTarget = (event: Event) => (event.target as HTMLElement | null)?.closest?.('#wait-button');
for (const [type, on] of [['mouseover', true], ['mouseout', false], ['focusin', true], ['focusout', false]] as const) {
  document.addEventListener(type, event => { if (restTarget(event) && restHover !== on) { restHover = on; updateHUD(); } });
}
const mapDetail = (id: string | null) => { const detail = document.getElementById('map-detail'); if (detail && forestRun) detail.innerHTML = nodeDetailHtml(forestRun, id); };
const mapNodeId = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>('.map-node')?.dataset.node ?? null;
el('map-screen').addEventListener('mouseover', event => { const id = mapNodeId(event); if (id) mapDetail(id); });
el('map-screen').addEventListener('focusin', event => { const id = mapNodeId(event); if (id) mapDetail(id); });
el('map-screen').addEventListener('mouseout', event => { if (mapNodeId(event)) mapDetail(null); });
el('map-screen').addEventListener('focusout', event => { if (mapNodeId(event)) mapDetail(null); });
function updateSound() { el('sound-button').textContent = audio.enabled ? '♫' : '♪̸'; el('sound-button').setAttribute('aria-pressed', String(audio.enabled)); el('sound-button').setAttribute('aria-label', audio.enabled ? 'Выключить звук' : 'Включить звук'); }
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && screen === 'game' && el('modal-layer').hidden && engine.state.chosenAbility === 'spin' && engine.state.phase === 'PLAYER_INPUT' && !(event.target as HTMLElement | null)?.closest?.('button')) {
    event.preventDefault(); void engine.useAbility('spin'); return;
  }
  if (event.key !== 'Escape') return;
  if (playtestFrom && !el('modal-layer').hidden) { closePlaytest(); return; }
  if (renderer?.itemTargeting) { renderer.setItemTargeting(null); updateHUD(); return; }
  if (engine.state.chosenAbility) { engine.setAbility(null); updateHUD(); return; }
  if (engine.state.chain.length) { engine.cancelChain(); return; }
  if (paused) hideModal();
  else if (screen === 'game' && engine.state.phase === 'PLAYER_INPUT') document.querySelector<HTMLButtonElement>('[data-action="pause"]')?.click();
});
/**
 * Short notes by the field about what enemies just did (one line, ~2 s, at most 3, merged when repeated, never modal).
 * They come straight from engine events; nothing here decides a rule.
 */
const toastTimers = new Map<string, { element: HTMLElement; count: number; timer: number }>();
let arrowHit = -1;
function toast(key: string, text: string) {
  const host = document.getElementById('battle-toasts'); if (!host || screen !== 'game') return;
  const life = 1900 * Math.max(0.5, engine.animationScale);
  const known = toastTimers.get(key);
  if (known) { known.count++; known.element.textContent = `${text} ×${known.count}`; clearTimeout(known.timer); known.timer = window.setTimeout(() => remove(key), life); return; }
  const element = document.createElement('div'); element.className = 'battle-toast'; element.textContent = text; host.append(element);
  toastTimers.set(key, { element, count: 1, timer: window.setTimeout(() => remove(key), life) });
  while (host.children.length > 3) { const oldest = [...toastTimers.entries()].find(([, entry]) => entry.element === host.firstElementChild); if (!oldest) break; remove(oldest[0]); }
  function remove(id: string) { const entry = toastTimers.get(id); if (!entry) return; clearTimeout(entry.timer); entry.element.remove(); toastTimers.delete(id); }
}
function clearToasts() { for (const entry of toastTimers.values()) { clearTimeout(entry.timer); entry.element.remove(); } toastTimers.clear(); arrowHit = -1; }
let goalsToasted = false;
function notifyEnemyEffect(state: typeof engine.state, event: { type: string; index?: number; from?: number; amount?: number; text?: string; indices?: number[] }) {
  const at = event.index;
  if (event.type === 'start' || event.type === 'restart') { goalsToasted = false; }
  if (event.type === 'start') { clearToasts(); return; }
  // The goals of an exit battle are met (once per battle): the door is open.
  const custom = state.customLevel;
  if (!goalsToasted && custom?.definition.completion === 'exit' && custom.goalCompletedTurn !== null && state.phase !== 'WIN' && state.phase !== 'LOSE') { goalsToasted = true; toast('goals', 'Цели выполнены — выход открыт'); }
  if (event.type === 'chest-open' && event.text) toast('chest-open', `Сундук открыт: ${chestLabel(event.text.split(',') as ResourceKind[])}`);
  else if (event.type === 'chest') toast('chest', 'Упал сундук — пройди по нему цепью');
  else if (event.type === 'reinforcement-announce' && event.indices?.length) toast('reinforcement-announce', 'Подкрепление: клетки отмечены на поле');
  else if (event.type === 'reinforcement' && event.indices?.length) toast('reinforcement', `Подкрепление: ${angryGoblins(event.indices.length)}`);
  if (event.type === 'empower') toast('empower', `Шаман усилил гоблина: ${event.text === 'sturdy' ? 'крепкий' : 'вооружён'}`);
  else if (event.type === 'push') toast('push', 'Кабан толкнул ряд');
  else if (event.type === 'status' && event.text === 'ОГЛУШЁН') toast('stun', 'Кабан упёрся и оглушён');
  else if (event.type === 'loot' && event.text) toast('loot-drop', `Элита оставила: ${lootLabel(event.text as LootKind)}`);
  else if (event.type === 'loot-pickup' && event.text) toast(`loot-${event.text}`, `+ ${lootLabel(event.text as LootKind)}`);
  else if (event.type === 'regen') toast('regen', `Тролль восстановил ${event.amount ?? ''} HP`.replace('  ', ' '));
  else if (event.type === 'hit') { const source = event.from !== undefined ? state.board[event.from] : null; arrowHit = source && archerStrikesCreatures(source) && at !== undefined ? at : -1; }
  else if (event.type === 'kill' && at !== undefined) {
    const byText: Record<string, string> = { ram: 'Кабан убил врага', spikes: 'Кабан вытолкнул врага на шипы', thorns: 'Колючки убили врага', pit: 'Враг упал в провал', club: 'Дубина убила врага (не засчитано)' };
    if (event.text && byText[event.text]) toast(`kill-${event.text}`, byText[event.text]);
    else if (arrowHit === at) toast('arrow', 'Стрела лучника убила врага');
    arrowHit = -1;
  }
}
engine.subscribe((_state, event) => {
  if (event.type === 'start') hintTurn = 0;
  notifyEnemyEffect(_state, event);
  if (['hit', 'kill'].includes(event.type) || event.type === 'attack' && engine.state.board[event.index??-1]?.kind !== 'melee') audio.play('hit', event.amount);
  if (event.type === 'damage') { audio.play('damage'); el('game-screen').classList.remove('damage-flash'); void el('game-screen').offsetWidth; el('game-screen').classList.add('damage-flash'); }
  if (event.type === 'frost') audio.play('frost');
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
  get state() { return engine.state; }, get phase() { return engine.state.phase; }, get doors() { return uniqueDoors(); },
  get rotations() { return engine.state.rotations; }, get inventory() { return engine.state.inventory; },
  get player() { return engine.state.player; }, get board() { return engine.getBoardState(); }, get selectedPath() { return engine.state.chain; },
  get energy() { return engine.state.player.energy; }, get chosenAbility() { return engine.state.chosenAbility; },
  get objective() { return engine.state.objective; }, get turn() { return engine.state.turn; }, get score() { return engine.state.score; },
  get forestRun() { return forestRun; }, startForestRun: (seed?: number, ladder?: number) => newRun(seed, ladder), openMap: () => showScreen('map'), forestRunStore: runStore, profileStore,
  get screen() { return screen; }, get frostTargeting() { return renderer?.frostTargeting ?? false; }, get itemTargeting() { return renderer?.itemTargeting ?? null; },
  get endpointLabel() { return renderer?.endpointLabel ?? null; }, get telegraphMarks() { return renderer?.telegraphMarks ?? []; }, get eliteMarks() { return renderer?.eliteMarks ?? []; }, get lootMarks() { return renderer?.lootMarks ?? []; }, get chestMarks() { return renderer?.chestMarks ?? []; }, get reinforcementMarks() { return renderer?.reinforcementMarks ?? []; }, get forecastMarks() { return renderer?.forecastMarks ?? null; }, get rendererTicking() { return renderer?.ticking ?? false; },
  getBoardState: () => engine.getBoardState(), availableMoves: () => engine.availableMoves(), validStarts: () => engine.validStarts(),
  preview: (path?: number[]) => engine.preview(path), previewFrost: (index: number) => engine.previewFrost(index),
  previewRotations: (path?: number[]) => engine.previewRotations(path),
  useFrost: (index: number) => engine.prepareFrost(index), prepareFrost: (index: number) => engine.prepareFrost(index),
  previewItem: (item: ItemKind, index?: number) => engine.previewItem(item, index), useItem: (item: ItemKind, index?: number) => engine.useItem(item, index),
  setAbility: (kind: AbilityKind | null) => { renderer?.setItemTargeting(null); return engine.setAbility(kind); },
  previewAbility: (kind: AbilityKind, index?: number) => engine.previewAbility(kind, index),
  useAbility: (kind: AbilityKind, index?: number) => { renderer?.setItemTargeting(null); return engine.useAbility(kind, index); },
  /** Open a registered node battle on the battle screen, outside the saved run (tests and debugging). */
  startNodeBattle: (battleId: string, setup: Partial<RunBattleSetup> = {}) => openScene(() => {
    if (!engine.startRunBattle({ nodeId: 'debug', label: 'Проба', row: 1, seed: 4242, player: { hp: 5, maxHp: 5, energy: 0 },
      inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 }, allowedItems: [], allowedAbilities: [], ...setup, template: { kind: 'battle', id: battleId } })) throw new Error(`Бой «${battleId}» не запустился.`);
  }),
  /** Open an editor-format level definition on the battle screen. */
  startCustomLevel: (definition: unknown) => openScene(() => { if (!engine.startCustomLevel(definition)) throw new Error('Уровень не запустился.'); }),
  endTurn: () => engine.waitTurn(), waitTurn: () => engine.waitTurn(), restartLevel: () => openScene(() => engine.restartLevel()),
  damagePlayer: (amount = 1) => engine.damagePlayer(amount), winLevel: () => engine.winLevel(),
  beginChain: (index: number) => engine.beginChain(index), extendChain: (index: number) => engine.extendChain(index),
  releaseChain: () => engine.releaseChain(), cancelChain: () => engine.cancelChain(),
  gridToScreen: (x: number, y?: number) => renderer?.gridToScreen(y === undefined ? x % engine.state.cols : x, y === undefined ? Math.floor(x / engine.state.cols) : y),
};
// Test/debug hooks (winLevel, damagePlayer…) exist only in the dev server or a build with VITE_E2E_HOOKS=1.
if (import.meta.env.DEV || import.meta.env.VITE_E2E_HOOKS === '1') Object.assign(window, { __PUZZLE_GAME: debug });
updateSound(); showScreen('title');
