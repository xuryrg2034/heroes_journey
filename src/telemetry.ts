import type { ForestEngine } from './game/forestEngine';
import type { AbilityKind, ItemKind } from './game/forestTypes';
import { forestNode } from './game/run/forestMap';

/**
 * Local playtest telemetry. Nothing leaves the browser: attempts are kept in localStorage only.
 * The module observes the engine (events plus thin wrappers around player commands) and never
 * influences rules, RNG or event order. Every storage access is guarded; without storage the
 * journal lives in memory for the current tab.
 */
export const TELEMETRY_KEY = 'ashen-oath-playtest-v1';
export const MAX_ATTEMPTS = 500;

export type Outcome = 'win' | 'lose' | 'restart' | 'quit';
export type BattleMode = 'custom' | 'run';

export interface AttemptRecord {
  /**
   * Stable aggregation key: `run:<nodeId>` (a forest-map node) or `custom:<name>` (an editor level). Journals written
   * before the old modes were removed may still hold other keys; they are shown under their raw key.
   */
  key: string;
  mode: BattleMode;
  /** Forest-map node id or the editor level name. */
  id: string;
  seed: number;
  /** Start time, ms since the Unix epoch. */
  startedAt: number;
  durationMs: number;
  outcome: Outcome;
  /** Player left for the menu, editor or closed the tab at the end of this attempt (or right after its defeat). */
  left: boolean;
  /** Consecutive visit of one battle (until win or leaving) and this attempt's number inside it. */
  visit: number;
  attemptInVisit: number;
  /** Committed turns: chains, abilities and rests. */
  turns: number;
  hpEnd: number;
  maxHp: number;
  damageTaken: number;
  chains: number;
  chainAvg: number;
  chainMax: number;
  /** Chains of 2+ cells dropped by Escape, pointer cancel or an invalid release: hesitation. A single-cell click is not counted. */
  cancelledChains: number;
  abilities: Partial<Record<AbilityKind, number>>;
  items: Partial<Record<ItemKind, number>>;
  /** Time from the start to the first committed turn (reading the field); null if none. */
  firstMoveMs: number | null;
}

interface Journal { version: 1; enabled: boolean; attempts: AttemptRecord[] }

export interface BattleAggregate {
  key: string; label: string; attempts: number; visits: number; wins: number; loses: number;
  winRate: number; loseRate: number;
  /** Median number of attempts up to and including the first win, over visits that reached a win. */
  attemptsToWin: number | null;
  medianWinMs: number | null; medianQuitMs: number | null; medianFirstMoveMs: number | null;
  /** Share of visits that ended by leaving without a win. */
  abandonRate: number;
  avgCancelled: number; avgChainLength: number | null;
}

const emptyJournal = (): Journal => ({ version: 1, enabled: true, attempts: [] });
let memory: Journal = emptyJournal();

function sanitize(value: unknown): Journal {
  const journal = emptyJournal();
  if (!value || typeof value !== 'object') return journal;
  const raw = value as Partial<Journal>;
  journal.enabled = raw.enabled !== false;
  if (Array.isArray(raw.attempts)) {
    journal.attempts = raw.attempts.filter(item => item && typeof item === 'object' && typeof item.key === 'string' && typeof item.outcome === 'string').slice(-MAX_ATTEMPTS);
  }
  return journal;
}
function load(): Journal {
  try {
    const text = localStorage.getItem(TELEMETRY_KEY);
    if (text) memory = sanitize(JSON.parse(text));
  } catch { /* Storage is optional: keep the in-memory copy. */ }
  return memory;
}
function store(journal: Journal) {
  memory = journal;
  try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(journal)); } catch { /* Storage is optional. */ }
}

export const telemetryEnabled = () => load().enabled;
export function setTelemetryEnabled(enabled: boolean) { const journal = load(); journal.enabled = enabled; store(journal); }
export function clearTelemetry() { const journal = load(); journal.attempts = []; store(journal); }
export const readAttempts = () => load().attempts.slice();

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

export function battleLabel(record: Pick<AttemptRecord, 'mode' | 'id' | 'key'>): string {
  switch (record.mode) {
    case 'run': return `Карта леса · ${forestNode(record.id)?.name ?? record.id}`;
    case 'custom': return `Свой · ${record.id}`;
    // A record of a removed mode from an older journal.
    default: return `Старый режим · ${record.key}`;
  }
}

export function aggregate(attempts: AttemptRecord[]): BattleAggregate[] {
  const groups = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) groups.set(attempt.key, [...(groups.get(attempt.key) ?? []), attempt]);
  const rows: BattleAggregate[] = [];
  for (const [key, list] of groups) {
    const visits = new Map<number, AttemptRecord[]>();
    for (const attempt of list) visits.set(attempt.visit, [...(visits.get(attempt.visit) ?? []), attempt]);
    const attemptsToWin: number[] = [];
    let abandoned = 0;
    for (const visit of visits.values()) {
      const ordered = [...visit].sort((a, b) => a.attemptInVisit - b.attemptInVisit);
      const winIndex = ordered.findIndex(item => item.outcome === 'win');
      if (winIndex >= 0) attemptsToWin.push(winIndex + 1);
      else if (ordered[ordered.length - 1].left) abandoned++;
    }
    const wins = list.filter(item => item.outcome === 'win'), loses = list.filter(item => item.outcome === 'lose');
    const chained = list.filter(item => item.chains > 0);
    const chainSum = chained.reduce((sum, item) => sum + item.chainAvg * item.chains, 0);
    const chainCount = chained.reduce((sum, item) => sum + item.chains, 0);
    const firstMoves = list.map(item => item.firstMoveMs).filter((value): value is number => typeof value === 'number');
    rows.push({
      key, label: battleLabel(list[list.length - 1]), attempts: list.length, visits: visits.size, wins: wins.length, loses: loses.length,
      winRate: round(wins.length / list.length), loseRate: round(loses.length / list.length),
      attemptsToWin: median(attemptsToWin),
      medianWinMs: median(wins.map(item => item.durationMs)),
      medianQuitMs: median(list.filter(item => item.outcome === 'quit').map(item => item.durationMs)),
      medianFirstMoveMs: median(firstMoves),
      abandonRate: round(abandoned / visits.size),
      avgCancelled: round(list.reduce((sum, item) => sum + item.cancelledChains, 0) / list.length),
      avgChainLength: chainCount ? round(chainSum / chainCount) : null,
    });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
}

export function exportPayload() {
  const journal = load();
  return { format: 'ashen-oath-playtest', version: 1, exportedAt: new Date().toISOString(), enabled: journal.enabled,
    attempts: journal.attempts, aggregates: aggregate(journal.attempts) };
}
export const exportJson = () => JSON.stringify(exportPayload(), null, 2);

// ---------- Live tracking ----------

interface Open {
  key: string; mode: BattleMode; id: string; seed: number;
  startedAt: number; t0: number; visit: number; attemptInVisit: number;
  turns: number; hp: number; maxHp: number; damage: number; chainLengths: number[]; cancelled: number;
  abilities: Partial<Record<AbilityKind, number>>; items: Partial<Record<ItemKind, number>>; firstMoveMs: number | null;
}

export interface TelemetryController {
  /** Run an engine call that may cancel the current chain without counting it as hesitation (menu, pause, item choice). */
  quiet<T>(action: () => T): T;
  /** The player left the battle (menu, editor). */
  leave(): void;
}

function describe(engine: ForestEngine): Pick<Open, 'key' | 'mode' | 'id' | 'seed'> {
  const state = engine.state;
  // Every battle is a custom-level definition: a map node (its seed derives from the run seed) or an editor level.
  const seed = state.customLevel?.definition.seed ?? 0;
  if (state.runNode) return { key: `run:${state.runNode.nodeId}`, mode: 'run', id: state.runNode.nodeId, seed };
  const name = state.customLevel?.definition.name || 'без названия';
  return { key: `custom:${name}`, mode: 'custom', id: name, seed };
}

export function installTelemetry(engine: ForestEngine): TelemetryController {
  let open: Open | null = null;
  let visitCounter = load().attempts.reduce((max, item) => Math.max(max, item.visit || 0), 0);
  let lastKey = '', visitClosed = true, attemptCounter = 0, quietDepth = 0;

  const finish = (outcome: Outcome, left: boolean) => {
    const current = open; open = null;
    if (!current) return;
    if (!load().enabled) return;
    const lengths = current.chainLengths;
    const record: AttemptRecord = {
      key: current.key, mode: current.mode, id: current.id, seed: current.seed,
      startedAt: current.startedAt, durationMs: Math.round(performance.now() - current.t0), outcome, left,
      visit: current.visit, attemptInVisit: current.attemptInVisit, turns: current.turns,
      hpEnd: current.hp, maxHp: current.maxHp, damageTaken: current.damage,
      chains: lengths.length, chainAvg: lengths.length ? round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      chainMax: lengths.length ? Math.max(...lengths) : 0, cancelledChains: current.cancelled,
      abilities: current.abilities, items: current.items, firstMoveMs: current.firstMoveMs,
    };
    const journal = load();
    journal.attempts = [...journal.attempts, record].slice(-MAX_ATTEMPTS);
    store(journal);
    if (outcome === 'win' || left) visitClosed = true;
  };
  const begin = () => {
    if (!load().enabled) { open = null; return; }
    const info = describe(engine);
    if (info.key !== lastKey || visitClosed) { visitCounter++; attemptCounter = 0; visitClosed = false; }
    lastKey = info.key; attemptCounter++;
    open = { ...info, startedAt: Date.now(), t0: performance.now(), visit: visitCounter, attemptInVisit: attemptCounter,
      turns: 0, hp: engine.state.player.hp, maxHp: engine.state.player.maxHp, damage: 0, chainLengths: [], cancelled: 0, abilities: {}, items: {}, firstMoveMs: null };
  };
  const committed = () => {
    if (!open) return;
    open.turns++;
    if (open.firstMoveMs === null) open.firstMoveMs = Math.round(performance.now() - open.t0);
  };
  /** After a defeat the attempt is already stored; leaving marks that record as the end of the visit. */
  const markLeftAfterDefeat = () => {
    if (visitClosed) return;
    const journal = load(), last = journal.attempts[journal.attempts.length - 1];
    if (last && last.key === lastKey && last.visit === visitCounter && last.outcome === 'lose') { last.left = true; store(journal); }
    visitClosed = true;
  };
  const sync = () => { if (open) { open.hp = engine.state.player.hp; open.maxHp = engine.state.player.maxHp; } };
  const leave = () => { sync(); if (open) finish('quit', true); else markLeftAfterDefeat(); };

  engine.subscribe((_state, event) => {
    if (event.type !== 'start') sync();
    switch (event.type) {
      case 'start': if (open) finish(open.key === describe(engine).key ? 'restart' : 'quit', open.key !== describe(engine).key); begin(); break;
      case 'win': if (open) finish('win', false); break;
      case 'lose': if (open) finish('lose', false); break;
      case 'damage': if (open && event.index === engine.state.player.index) open.damage += event.amount ?? 0; break;
    }
  });

  // Thin observers around player commands. Each records only when the engine will accept the command,
  // decided by the engine's own pure previews, and always before the call so a winning move is counted.
  const state = () => engine.state;
  /** Observation must never change a call's semantics: a throwing preview counts as "not valid". */
  const safe = (check: () => boolean) => { try { return check(); } catch { return false; } };
  const chainRelease = engine.releaseChain.bind(engine);
  engine.releaseChain = () => {
    const s = state();
    if (open && s.phase === 'PLAYER_INPUT' && s.chain.length) {
      if (safe(() => engine.preview().valid)) { open.chainLengths.push(s.chain.length); committed(); }
      else if (s.chain.length > 1) open.cancelled++; // a single-cell click is inspection, not hesitation
    }
    return chainRelease();
  };
  const chainCancel = engine.cancelChain.bind(engine);
  engine.cancelChain = () => {
    const s = state();
    if (open && !quietDepth && s.phase === 'PLAYER_INPUT' && s.chain.length > 1) open.cancelled++;
    chainCancel();
  };
  const abilityUse = engine.useAbility.bind(engine);
  engine.useAbility = (ability, targetIndex) => {
    if (open && state().phase === 'PLAYER_INPUT' && safe(() => engine.previewAbility(ability, targetIndex).valid)) {
      open.abilities[ability] = (open.abilities[ability] ?? 0) + 1; committed();
    }
    return abilityUse(ability, targetIndex);
  };
  const itemUse = engine.useItem.bind(engine);
  engine.useItem = (item, index) => {
    if (open && state().phase === 'PLAYER_INPUT' && safe(() => engine.previewItem(item, index ?? state().player.index).valid)) open.items[item] = (open.items[item] ?? 0) + 1;
    return itemUse(item, index);
  };
  const wait = engine.waitTurn.bind(engine);
  engine.waitTurn = () => { if (open && state().phase === 'PLAYER_INPUT') committed(); return wait(); };

  window.addEventListener('pagehide', leave);
  return { leave, quiet: action => { quietDepth++; try { return action(); } finally { quietDepth--; } } };
}

// ---------- Playtest screen ----------

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
const percent = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (ms: number | null) => ms === null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} с` : `${Math.floor(ms / 60_000)}:${String(Math.round(ms % 60_000 / 1000)).padStart(2, '0')}`;
const number = (value: number | null) => value === null ? '—' : String(round(value, 1)).replace('.', ',');

/** HTML of the «Плейтест» modal. `confirmClear` swaps the clear button for an in-page confirmation. */
export function playtestHtml(options: { confirmClear?: boolean; notice?: string } = {}): string {
  const journal = load(), rows = aggregate(journal.attempts);
  const table = rows.length
    ? `<div class="playtest-scroll"><table class="playtest-table"><thead><tr><th>Бой</th><th title="Всего попыток">Попыт.</th><th title="Доля побед среди попыток">Побед</th><th title="Медиана числа попыток до первой победы">До победы</th><th title="Медианное время победы">Время</th><th title="Медианное время попытки, закончившейся выходом">До выхода</th><th title="Доля визитов, где игрок ушёл без победы">Отказ</th></tr></thead><tbody>${rows.map(row =>
      `<tr><th scope="row" title="${escapeHtml(row.key)}">${escapeHtml(row.label)}</th><td>${row.attempts}</td><td>${percent(row.winRate)}</td><td>${number(row.attemptsToWin)}</td><td>${seconds(row.medianWinMs)}</td><td>${seconds(row.medianQuitMs)}</td><td>${percent(row.abandonRate)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="modal-copy">Пока нет записей. Сыграйте бой: журнал появится после победы, поражения, повтора или выхода.</p>';
  const clear = options.confirmClear
    ? `<div class="playtest-confirm" role="alert"><span>Удалить ${journal.attempts.length} записей?</span><button class="button secondary" data-action="playtest-clear-yes">УДАЛИТЬ</button><button class="text-button" data-action="playtest-clear-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="playtest-clear">ОЧИСТИТЬ</button>';
  return `<p class="eyebrow">ЛОКАЛЬНЫЙ ЖУРНАЛ · ${journal.attempts.length} / ${MAX_ATTEMPTS} ПОПЫТОК</p><h2 id="modal-title">Плейтест</h2>${table}
<div class="playtest-actions"><button class="button secondary" data-action="playtest-download">СКАЧАТЬ JSON</button><button class="button secondary" data-action="playtest-copy">СКОПИРОВАТЬ JSON</button>${clear}</div>
<p class="playtest-note" aria-live="polite">${escapeHtml(options.notice ?? 'Данные хранятся только в этом браузере и никуда не отправляются.')}</p>
<button class="text-button playtest-toggle" data-action="playtest-toggle">${journal.enabled ? 'ЖУРНАЛ ВКЛЮЧЁН · ВЫКЛЮЧИТЬ' : 'ЖУРНАЛ ВЫКЛЮЧЕН · ВКЛЮЧИТЬ'}</button>
<button class="text-button" data-action="playtest-close">← НАЗАД</button>`;
}

/** Apply `?telemetry=0|1` from the address once at startup and persist it as a setting. */
export function applyTelemetryQuery(search = location.search) {
  const value = new URLSearchParams(search).get('telemetry');
  if (value === '0') setTelemetryEnabled(false); else if (value === '1') setTelemetryEnabled(true);
}
