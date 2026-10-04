import type { ForestEngine } from './game/forestEngine';
import type { AbilityKind, ItemKind, ResourceKind } from './game/forestTypes';
import { isResource } from './game/resources';
import { forestNode } from './game/run/forestMap';
import { talisman, type TalismanId } from './game/talismans';
import type { TalismanOption, TalismanSource } from './game/run/talismanOffers';

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
  // Exit door (02.10.2026). Journals written before have none of the fields below: readers treat a missing field as unknown.
  /** Engine turn (1-based number of the action) that met the battle's goals (`customLevel.goalCompletedTurn`); null — not met. */
  goalTurn?: number | null;
  /** Turn of the winning door entry in a battle that ends through the exit; null — no such win. */
  exitTurn?: number | null;
  /** `exitTurn − goalTurn`: turns spent after the goals before leaving (0 — the chain that met them entered the door). */
  exitDelay?: number | null;
  /** Cat HP when the goals were met; null — not met. */
  hpAtGoal?: number | null;
  /** Cat damage taken after the goals were met; null — not met. */
  damageAfterGoal?: number | null;
  /** Crafting resources in the battle's materials at the end (`state.materials`: elite loot, the chest). The run keeps them on a win only. */
  materials?: Partial<Record<ResourceKind, number>>;
  /** Consumables picked up from elite loot (`loot-pickup` events). */
  lootItems?: Partial<Record<ItemKind, number>>;
  /** The exit's chest fell (`chest` event) / was opened by a chain (`chest-open` event). */
  chestDropped?: boolean;
  chestOpened?: boolean;
  /**
   * A lost map-node battle (`mode: 'run'`, `outcome: 'lose'`) ends the run (decision of 04.10.2026): true on such a
   * record. The visit closes with it; leaving afterwards is not an abandonment. Absent in older journals and on other records.
   */
  runEnded?: boolean;
  /** Talismans and oaths the run held in this battle (docs/talismans.md); absent — none, or a journal before them. */
  talismans?: TalismanId[];
  /** The Ash ward saved the cat in this attempt (and crumbled). */
  wardSaved?: boolean;
  /** The Whetstone gave the first ordinary chain of this attempt its power of 1. */
  whetstoneUsed?: boolean;
}

/**
 * A choice at a map event (04.10.2026): the node, the option, the rolled outcome (index and text) and the run seed.
 * Kept beside the battle attempts; journals written before have none.
 */
export interface RunEventRecord { nodeId: string; option: string; outcome: number; text: string; seed: number; at: number }
/**
 * A completed rest (04.10.2026): the node, the choice (heal or craft), HP healed and the items crafted (in order), the
 * run seed. Kept beside the battle attempts; journals written before have none.
 */
export interface RunRestRecord { nodeId: string; choice: 'heal' | 'craft'; healed: number; crafted: ItemKind[]; seed: number; at: number }
/**
 * A talisman or oath choice (docs/talismans.md): the node, the source, the options shown and the one taken (null —
 * refused), the run seed. Kept beside the battle attempts; journals written before have none.
 */
export interface RunTalismanRecord { nodeId: string; source: TalismanSource; offered: TalismanOption[]; chosen: TalismanOption | null; seed: number; at: number }
/** Per talisman over the journal: shown, taken, refused (shown and not taken); plus the battles where it fired. */
export interface TalismanAggregate { id: TalismanOption; label: string; shown: number; taken: number; refused: number }
/** Rests over the journal: how many healed, how many crafted, HP healed and items crafted in total. */
export interface RestAggregate { rests: number; heals: number; crafts: number; healed: number; crafted: Partial<Record<ItemKind, number>> }
/** Choices per event node and option, with how often each outcome came. */
export interface EventAggregate { nodeId: string; label: string; option: string; count: number; outcomes: Record<string, number> }

interface Journal { version: 1; enabled: boolean; attempts: AttemptRecord[]; runEvents: RunEventRecord[]; runRests: RunRestRecord[]; runTalismans: RunTalismanRecord[] }

export interface BattleAggregate {
  key: string; label: string; attempts: number; visits: number; wins: number; loses: number;
  winRate: number; loseRate: number;
  /** Median number of attempts up to and including the first win, over visits that reached a win. */
  attemptsToWin: number | null;
  medianWinMs: number | null; medianQuitMs: number | null; medianFirstMoveMs: number | null;
  /** Share of visits that ended by leaving without a win. */
  abandonRate: number;
  avgCancelled: number; avgChainLength: number | null;
  /** Medians over attempts that met the goals / won through the door (null — none): goal turn, exit turn, turns between them, damage after the goals. */
  medianGoalTurn: number | null; medianExitTurn: number | null; medianExitDelay: number | null; medianDamageAfterGoal: number | null;
  /** Share of attempts that opened the chest among those where it fell; null — it never fell. */
  chestOpenRate: number | null;
}

const emptyJournal = (): Journal => ({ version: 1, enabled: true, attempts: [], runEvents: [], runRests: [], runTalismans: [] });
let memory: Journal = emptyJournal();

function sanitize(value: unknown): Journal {
  const journal = emptyJournal();
  if (!value || typeof value !== 'object') return journal;
  const raw = value as Partial<Journal>;
  journal.enabled = raw.enabled !== false;
  if (Array.isArray(raw.attempts)) {
    journal.attempts = raw.attempts.filter(item => item && typeof item === 'object' && typeof item.key === 'string' && typeof item.outcome === 'string').slice(-MAX_ATTEMPTS);
  }
  if (Array.isArray(raw.runEvents)) {
    journal.runEvents = raw.runEvents.filter(item => item && typeof item === 'object' && typeof item.nodeId === 'string' && typeof item.option === 'string').slice(-MAX_ATTEMPTS);
  }
  if (Array.isArray(raw.runRests)) {
    journal.runRests = raw.runRests.filter(item => item && typeof item === 'object' && typeof item.nodeId === 'string' && (item.choice === 'heal' || item.choice === 'craft') && Array.isArray(item.crafted)).slice(-MAX_ATTEMPTS);
  }
  if (Array.isArray(raw.runTalismans)) {
    journal.runTalismans = raw.runTalismans.filter(item => item && typeof item === 'object' && typeof item.nodeId === 'string' && Array.isArray(item.offered)).slice(-MAX_ATTEMPTS);
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
export function clearTelemetry() { const journal = load(); journal.attempts = []; journal.runEvents = []; journal.runRests = []; journal.runTalismans = []; store(journal); }

/** Record a choice at a map event (called by the map screen after the run model resolved it). Respects `enabled`. */
export function recordRunEvent(record: Omit<RunEventRecord, 'at'>) {
  const journal = load();
  if (!journal.enabled) return;
  journal.runEvents = [...journal.runEvents, { ...record, at: Date.now() }].slice(-MAX_ATTEMPTS);
  store(journal);
}

/** Record a completed rest (called by the map screen after the run model completed it). Respects `enabled`. */
export function recordRunRest(record: Omit<RunRestRecord, 'at'>) {
  const journal = load();
  if (!journal.enabled) return;
  journal.runRests = [...journal.runRests, { ...record, crafted: [...record.crafted], at: Date.now() }].slice(-MAX_ATTEMPTS);
  store(journal);
}

/** Record a talisman or oath choice (called by the map screen after the run model made it). Respects `enabled`. */
export function recordRunTalisman(record: Omit<RunTalismanRecord, 'at'>) {
  const journal = load();
  if (!journal.enabled) return;
  journal.runTalismans = [...journal.runTalismans, { ...record, offered: [...record.offered], at: Date.now() }].slice(-MAX_ATTEMPTS);
  store(journal);
}

/** Shown, taken and refused per talisman (and the «пустышка»), most shown first. */
export function aggregateTalismans(records: RunTalismanRecord[]): TalismanAggregate[] {
  const rows = new Map<TalismanOption, TalismanAggregate>();
  for (const record of records) for (const id of new Set(record.offered)) {
    const row = rows.get(id) ?? { id, label: id === 'blank' ? 'Пустышка' : talismanName(id), shown: 0, taken: 0, refused: 0 };
    row.shown++;
    if (record.chosen === id) row.taken++; else row.refused++;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.shown - a.shown || a.label.localeCompare(b.label, 'ru'));
}
const talismanName = (id: string) => { try { return talisman(id as TalismanId)?.name ?? id; } catch { return id; } };

export function aggregateRests(records: RunRestRecord[]): RestAggregate {
  const total: RestAggregate = { rests: records.length, heals: 0, crafts: 0, healed: 0, crafted: {} };
  for (const record of records) {
    if (record.choice === 'heal') { total.heals++; total.healed += typeof record.healed === 'number' ? record.healed : 0; } else total.crafts++;
    for (const item of record.crafted) total.crafted[item] = (total.crafted[item] ?? 0) + 1;
  }
  return total;
}

export function aggregateEvents(records: RunEventRecord[]): EventAggregate[] {
  const rows = new Map<string, EventAggregate>();
  for (const record of records) {
    const key = `${record.nodeId}/${record.option}`;
    const row = rows.get(key) ?? { nodeId: record.nodeId, label: forestNode(record.nodeId)?.name ?? record.nodeId, option: record.option, count: 0, outcomes: {} };
    row.count++; row.outcomes[record.text] = (row.outcomes[record.text] ?? 0) + 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => `${a.nodeId}/${a.option}`.localeCompare(`${b.nodeId}/${b.option}`));
}

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
    // Old records lack the exit fields: only numbers count.
    const numbers = (pick: (item: AttemptRecord) => unknown) => list.map(pick).filter((value): value is number => typeof value === 'number');
    const chests = list.filter(item => item.chestDropped === true);
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
      medianGoalTurn: median(numbers(item => item.goalTurn)), medianExitTurn: median(numbers(item => item.exitTurn)),
      medianExitDelay: median(numbers(item => item.exitDelay)), medianDamageAfterGoal: median(numbers(item => item.damageAfterGoal)),
      chestOpenRate: chests.length ? round(chests.filter(item => item.chestOpened).length / chests.length) : null,
    });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
}

export function exportPayload() {
  const journal = load();
  return { format: 'ashen-oath-playtest', version: 1, exportedAt: new Date().toISOString(), enabled: journal.enabled,
    attempts: journal.attempts, aggregates: aggregate(journal.attempts), runEvents: journal.runEvents, eventAggregates: aggregateEvents(journal.runEvents),
    runRests: journal.runRests, restAggregate: aggregateRests(journal.runRests),
    runTalismans: journal.runTalismans, talismanAggregates: aggregateTalismans(journal.runTalismans),
    talismanTriggers: { wardSaved: journal.attempts.filter(item => item.wardSaved).length, whetstoneUsed: journal.attempts.filter(item => item.whetstoneUsed).length } };
}
export const exportJson = () => JSON.stringify(exportPayload(), null, 2);

// ---------- Live tracking ----------

interface Open {
  key: string; mode: BattleMode; id: string; seed: number;
  startedAt: number; t0: number; visit: number; attemptInVisit: number;
  turns: number; hp: number; maxHp: number; damage: number; chainLengths: number[]; cancelled: number;
  abilities: Partial<Record<AbilityKind, number>>; items: Partial<Record<ItemKind, number>>; firstMoveMs: number | null;
  goalTurn: number | null; hpAtGoal: number | null; damageAfterGoal: number; exitTurn: number | null;
  /** Kept in step with the engine like `hp`: on a restart the engine already holds the new battle when `start` arrives. */
  materials: Partial<Record<ResourceKind, number>>;
  lootItems: Partial<Record<ItemKind, number>>; chestDropped: boolean; chestOpened: boolean;
  /** Talismans held, whether the ward was whole at the start (to notice it crumble) and the triggers seen. */
  talismans: TalismanId[]; wardWhole: boolean; wardSaved: boolean; whetstoneUsed: boolean;
}

export interface TelemetryController {
  /** Run an engine call that may cancel the current chain without counting it as hesitation (menu, pause, item choice). */
  quiet<T>(action: () => T): T;
  /** The player left the battle (menu, editor). */
  leave(): void;
}

/** Non-zero resources of the battle's materials (absent until the first pickup). */
function materialsOf(engine: ForestEngine): Partial<Record<ResourceKind, number>> {
  return Object.fromEntries(Object.entries(engine.state.materials ?? {}).filter(([, amount]) => amount > 0));
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
      goalTurn: current.goalTurn, exitTurn: current.exitTurn,
      exitDelay: current.exitTurn !== null && current.goalTurn !== null ? current.exitTurn - current.goalTurn : null,
      hpAtGoal: current.hpAtGoal, damageAfterGoal: current.goalTurn === null ? null : current.damageAfterGoal,
      materials: current.materials, lootItems: current.lootItems, chestDropped: current.chestDropped, chestOpened: current.chestOpened,
      ...(current.mode === 'run' && outcome === 'lose' ? { runEnded: true } : {}),
      ...(current.talismans.length ? { talismans: current.talismans, wardSaved: current.wardSaved, whetstoneUsed: current.whetstoneUsed } : {}),
    };
    const journal = load();
    journal.attempts = [...journal.attempts, record].slice(-MAX_ATTEMPTS);
    store(journal);
    // A run defeat ends the run: there is no retry, so the visit is over (leaving afterwards is not an abandonment).
    if (outcome === 'win' || left || record.runEnded) visitClosed = true;
  };
  const begin = () => {
    if (!load().enabled) { open = null; return; }
    const info = describe(engine);
    if (info.key !== lastKey || visitClosed) { visitCounter++; attemptCounter = 0; visitClosed = false; }
    lastKey = info.key; attemptCounter++;
    open = { ...info, startedAt: Date.now(), t0: performance.now(), visit: visitCounter, attemptInVisit: attemptCounter,
      turns: 0, hp: engine.state.player.hp, maxHp: engine.state.player.maxHp, damage: 0, chainLengths: [], cancelled: 0, abilities: {}, items: {}, firstMoveMs: null,
      goalTurn: null, hpAtGoal: null, damageAfterGoal: 0, exitTurn: null, materials: {}, lootItems: {}, chestDropped: false, chestOpened: false,
      talismans: [...engine.state.runNode?.talismans ?? []], wardWhole: !!engine.state.player.ward, wardSaved: false, whetstoneUsed: false };
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
  const sync = () => {
    if (!open) return;
    open.hp = engine.state.player.hp; open.maxHp = engine.state.player.maxHp; open.materials = materialsOf(engine);
    // The Ash ward crumbles only when it saves the cat (combatRules.heroLoss).
    if (open.wardWhole && !engine.state.player.ward) { open.wardSaved = true; open.wardWhole = false; }
  };
  const leave = () => { sync(); if (open) finish('quit', true); else markLeftAfterDefeat(); };

  /**
   * The goals were met by now (read from the engine, never changed): the turn and the cat's HP at the first event that
   * sees them. Damage published before that event counts as before the goals.
   */
  const watchGoals = () => {
    const turn = engine.state.customLevel?.goalCompletedTurn;
    if (!open || open.goalTurn !== null || typeof turn !== 'number') return;
    open.goalTurn = turn; open.hpAtGoal = engine.state.player.hp;
  };
  engine.subscribe((_state, event) => {
    if (event.type !== 'start') sync();
    switch (event.type) {
      case 'start': if (open) finish(open.key === describe(engine).key ? 'restart' : 'quit', open.key !== describe(engine).key); begin(); break;
      case 'win':
        if (open) {
          watchGoals();
          // A battle with an authored exit is won only by entering the door: that turn is the exit turn.
          if (engine.state.customLevel?.definition.completion === 'exit') open.exitTurn = engine.state.turn;
          finish('win', false);
        }
        break;
      case 'lose': if (open) { watchGoals(); finish('lose', false); } break;
      case 'damage':
        if (open && event.index === engine.state.player.index) {
          open.damage += event.amount ?? 0;
          if (open.goalTurn !== null) open.damageAfterGoal += event.amount ?? 0;
        }
        break;
      case 'loot-pickup': if (open && event.text && !isResource(event.text)) { const item = event.text as ItemKind; open.lootItems[item] = (open.lootItems[item] ?? 0) + 1; } break;
      case 'chest': if (open) open.chestDropped = true; break;
      case 'chest-open': if (open) open.chestOpened = true; break;
    }
    if (event.type !== 'start') watchGoals();
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
      let whetstone = false;
      if (safe(() => { const preview = engine.preview(); whetstone = !!preview.whetstone; return preview.valid; })) {
        open.chainLengths.push(s.chain.length); committed(); if (whetstone) open.whetstoneUsed = true;
      }
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

/**
 * HTML of the «Плейтест» modal. `confirmClear` swaps the clear button for an in-page confirmation. `trunkCleared`: the
 * player profile's trunk mark (playerProfile.ts); while it is set the modal offers to reset it.
 */
export function playtestHtml(options: { confirmClear?: boolean; notice?: string; trunkCleared?: boolean } = {}): string {
  const journal = load(), rows = aggregate(journal.attempts);
  const table = rows.length
    ? `<div class="playtest-scroll"><table class="playtest-table"><thead><tr><th>Бой</th><th title="Всего попыток">Попыт.</th><th title="Доля побед среди попыток">Побед</th><th title="Медиана числа попыток до первой победы">До победы</th><th title="Медианное время победы">Время</th><th title="Медианное время попытки, закончившейся уходом из боя">До ухода</th><th title="Медиана хода, на котором выполнены цели (попытки, где выполнены)">Цели</th><th title="Медиана хода входа в дверь (победы через выход)">Выход</th><th title="Медиана ходов от целей до выхода (0 — та же цепь вошла в дверь)">Задерж.</th><th title="Доля попыток, открывших сундук, среди тех, где он упал">Сундук</th><th title="Доля визитов, где игрок ушёл без победы">Отказ</th></tr></thead><tbody>${rows.map(row =>
      `<tr><th scope="row" title="${escapeHtml(row.key)}">${escapeHtml(row.label)}</th><td>${row.attempts}</td><td>${percent(row.winRate)}</td><td>${number(row.attemptsToWin)}</td><td>${seconds(row.medianWinMs)}</td><td>${seconds(row.medianQuitMs)}</td><td>${number(row.medianGoalTurn)}</td><td>${number(row.medianExitTurn)}</td><td>${number(row.medianExitDelay)}</td><td>${row.chestOpenRate === null ? '—' : percent(row.chestOpenRate)}</td><td>${percent(row.abandonRate)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="modal-copy">Пока нет записей. Сыграйте бой: журнал появится после победы, поражения, повтора или выхода.</p>';
  const events = aggregateEvents(journal.runEvents);
  const eventTable = events.length
    ? `<div class="playtest-scroll"><table class="playtest-table playtest-events"><thead><tr><th>Событие</th><th>Выбор</th><th>Раз</th><th>Исходы</th></tr></thead><tbody>${events.map(row =>
      `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.option)}</td><td>${row.count}</td><td>${Object.entries(row.outcomes).map(([text, count]) => `${escapeHtml(text)} ×${count}`).join('; ')}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const rests = aggregateRests(journal.runRests), itemName: Record<ItemKind, string> = { frost: 'холод', bomb: 'бомба', healing: 'лечение', fire: 'огонь' };
  const restLine = rests.rests
    ? `<p class="playtest-rests" id="playtest-rests">Привалы: ${rests.rests} · лечение ${rests.heals} (+${rests.healed} HP) · крафт ${rests.crafts}${Object.keys(rests.crafted).length ? ` (${Object.entries(rests.crafted).map(([item, count]) => `${itemName[item as ItemKind] ?? item} ×${count}`).join(', ')})` : ''}</p>`
    : '';
  // Talismans (docs/talismans.md): which are shown, taken and refused; how often the ward and the whetstone fired.
  const talismans = aggregateTalismans(journal.runTalismans);
  const talismanTable = talismans.length
    ? `<div class="playtest-scroll"><table class="playtest-table playtest-talismans" id="playtest-talismans"><thead><tr><th>Талисман</th><th>Показан</th><th>Взят</th><th>Отвергнут</th></tr></thead><tbody>${talismans.map(row =>
      `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${row.shown}</td><td>${row.taken}</td><td>${row.refused}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  const wardSaves = journal.attempts.filter(item => item.wardSaved).length, whetstones = journal.attempts.filter(item => item.whetstoneUsed).length;
  const triggerLine = wardSaves || whetstones ? `<p class="playtest-rests" id="playtest-triggers">Срабатывания талисманов: оберег спас ${wardSaves} · точильный камень в ${whetstones} боях</p>` : '';
  const clear = options.confirmClear
    ? `<div class="playtest-confirm" role="alert"><span>Удалить ${journal.attempts.length} записей?</span><button class="button secondary" data-action="playtest-clear-yes">УДАЛИТЬ</button><button class="text-button" data-action="playtest-clear-no">ОТМЕНА</button></div>`
    : '<button class="text-button" data-action="playtest-clear">ОЧИСТИТЬ</button>';
  return `<p class="eyebrow">ЛОКАЛЬНЫЙ ЖУРНАЛ · ${journal.attempts.length} / ${MAX_ATTEMPTS} ПОПЫТОК</p><h2 id="modal-title">Плейтест</h2>${table}${eventTable}${restLine}${talismanTable}${triggerLine}
<div class="playtest-actions"><button class="button secondary" data-action="playtest-download">СКАЧАТЬ JSON</button><button class="button secondary" data-action="playtest-copy">СКОПИРОВАТЬ JSON</button>${clear}</div>
<p class="playtest-note" aria-live="polite">${escapeHtml(options.notice ?? 'Данные хранятся только в этом браузере и никуда не отправляются.')}</p>
<p class="playtest-profile" id="playtest-profile">${options.trunkCleared ? 'Профиль: ствол пройден — новый поход начнётся с развилки троп. <button class="text-button" data-action="profile-reset-trunk">СБРОСИТЬ ОТМЕТКУ СТВОЛА</button>' : 'Профиль: ствол не пройден — новый поход начнётся со ствола.'}</p>
<button class="text-button playtest-toggle" data-action="playtest-toggle">${journal.enabled ? 'ЖУРНАЛ ВКЛЮЧЁН · ВЫКЛЮЧИТЬ' : 'ЖУРНАЛ ВЫКЛЮЧЕН · ВКЛЮЧИТЬ'}</button>
<button class="text-button" data-action="playtest-close">← НАЗАД</button>`;
}

/** Apply `?telemetry=0|1` from the address once at startup and persist it as a setting. */
export function applyTelemetryQuery(search = location.search) {
  const value = new URLSearchParams(search).get('telemetry');
  if (value === '0') setTelemetryEnabled(false); else if (value === '1') setTelemetryEnabled(true);
}
