/**
 * Track ТB of the real-time telemetry (docs/realtime-telemetry.md, sections 5 and 8): the playtest report. Takes the
 * records (files of the dev-server plugin `playtest-logs/<session>/<run>/*.json` and «Экспорт» files), drops duplicates by
 * id, assembles every journal, replays each fight in Node with the observer (observe.ts) and the threat tracker
 * (threats.ts), checks the replay hash against the fight's `endHash` and writes a markdown report.
 *
 * No file system here (the CLI `scripts/realtime-report.ts` reads and writes the files): the module is typed with the rest
 * of `src/` and the test (`npm run test:realtime-report`) calls it directly.
 */
import { arenaTemplate } from '../sim/arenas';
import { hashWorld, worldState } from '../sim/hash';
import { copyParams, defaultParams, type Params } from '../sim/params';
import { Simulation, type Journal } from '../sim/simulation';
import { ITEM_TITLES, SLOT_ITEMS, type Loadout } from '../sim/kit';
import { RESOURCE_KINDS, RESOURCES } from '../forest/resources';
import type { World } from '../sim/world';
import { createFightObserver, median, DEATH_SERIES_WINDOW, WOLF_RUSH_SOURCE } from './observe';
import {
  checkRecord, emptyFightSummary, orderedParts, unpackJournal, withSummaryDefaults, OATH_STAKE_SOURCE, DIE_SOURCE, CASINO_SOURCE, RT_TELEMETRY_FORMAT, SANDBOX_RUN,
  type DeathGuard, type FightDeath, type FightRecord, type FightSummary, type JournalPart, type NoteRecord, type PrologueFrom, type PrologueRecord, type RtRecord, type WarmupRecord, type RunRecord, type ThreatTally,
  type GarrisonStep3Summary, type RunNodeVisit, type TrollBossSummary, type WarlockBossSummary,
} from './schema';
// Task 55в: the castle's arenas (the section «Замок»).
import { CASTLE_ARENAS } from '../sim/arenasCastle';
import { THREAT_KINDS, ThreatTracker, type ThreatWarning } from './threats';
import { RT_DEATH_ABILITY, RT_KIND_TITLES } from '../run/rtRunEnd';
import { HINT_IDS, HINT_TITLES } from '../view/hints';
import { PROLOGUE_ROOMS } from '../run/prologue';
import { isWarmupId, warmupLayout, WARMUP_LAYOUTS } from '../run/warmup';
import { RT_HABITS, rtTalisman } from '../run/rtTalismans';
import { RT_OMENS } from '../run/omens';

// ---- Replay with the observers ----

/** Damage to the hero by the striker's kind (`thorns` and other hits without an enemy — by source). */
export interface KindDamage { hits: number; damage: number; bySource: Record<string, number> }

export interface FightAnalysis {
  /** Ticks replayed and the world hash after them. */
  ticks: number;
  hash: string;
  status: World['status'];
  summary: FightSummary;
  warnings: ThreatWarning[];
  byKind: Record<string, KindDamage>;
  /** The hit that ended the fight in a defeat: the striker's kind and the source. */
  death: { kind: string; source: string; tick: number } | null;
  world: World;
}

const bump = (map: Record<string, number>, key: string, by = 1): void => { map[key] = (map[key] ?? 0) + by; };

/**
 * Replays a journal with the observer and the threat tracker (the same loop as `replay` of sim/simulation.ts: the commands
 * stamped with a tick are applied before it; those after the last tick at the end). `untilTick` — stop after that many
 * ticks (the commands of that tick are not applied: the world as it was shown before them).
 */
export function analyzeJournal(journal: Journal, untilTick?: number): FightAnalysis {
  const sim = new Simulation({ arena: journal.arena, params: copyParams(journal.params), seed: journal.seed, ...journal.hero ? { hero: { ...journal.hero } } : {}, ...journal.loadout ? { loadout: JSON.parse(JSON.stringify(journal.loadout)) as Loadout } : {}, ...journal.roster !== undefined ? { roster: journal.roster } : {} });
  const w = sim.world, observer = createFightObserver(w), threats = new ThreatTracker(w);
  const kinds = new Map<number, string>(), byKind: Record<string, KindDamage> = {};
  let death: FightAnalysis['death'] = null, wasRushing = new Set<number>();
  const noteKinds = (): void => { for (const e of w.enemies) if (!kinds.has(e.id)) kinds.set(e.id, e.elite ? `${e.kind}*` : e.kind); };
  const commands = journal.commands, stop = Math.max(0, Math.min(untilTick ?? journal.ticks, journal.ticks));
  let next = 0;
  const applyUpTo = (tick: number): void => {
    while (next < commands.length && commands[next].tick <= tick) {
      const cmd = commands[next++].cmd;
      sim.command(cmd);
      observer.command(cmd, w);
    }
    noteKinds();
  };
  noteKinds();
  for (let tick = 0; tick < stop; tick++) {
    applyUpTo(tick);
    const cost = sim.nextTickCost();
    sim.tick();
    observer.tick(w);
    threats.tick(w, cost);
    for (const ev of w.events) {
      if (ev.type !== 'hit') continue;
      const kind = kinds.get(ev.enemyId) ?? ev.source, source = ev.source === 'wolf' && wasRushing.has(ev.enemyId) ? WOLF_RUSH_SOURCE : ev.source;
      const k = byKind[kind] ??= { hits: 0, damage: 0, bySource: {} };
      k.hits++; k.damage += ev.damage; bump(k.bySource, source, ev.damage);
      if (w.status === 'defeat' && w.hero.hp <= 0) death = { kind, source, tick: w.tick };
    }
    wasRushing = new Set(w.enemies.filter(e => e.kind === 'wolf' && e.vars.st === 2).map(e => e.id));
    noteKinds();
    w.events.length = 0;
  }
  if (untilTick === undefined || untilTick >= journal.ticks) applyUpTo(journal.ticks);
  threats.finish(w);
  const summary = observer.summary();
  summary.threats = threats.tally();
  return { ticks: w.tick, hash: sim.hash(), status: w.status, summary, warnings: threats.warnings, byKind, death, world: w };
}

/** The world after `tick` ticks of the journal, as `worldState` (sim/hash.ts) — the snapshot of `--at`. */
export function snapshotAt(journal: Journal, tick: number): unknown {
  const a = analyzeJournal(journal, tick);
  return { tick: a.ticks, hash: a.hash, state: worldState(a.world) };
}

// ---- Records ----

export interface ReportInput { name: string; text: string }

export interface RecordSet {
  records: RtRecord[];
  duplicates: number;
  problems: string[];
}

/** Reads record files and export files; drops duplicates by id (the latest `at` wins, then the later input). */
export function collectRecords(inputs: readonly ReportInput[]): RecordSet {
  const byId = new Map<string, RtRecord>(), problems: string[] = [];
  let duplicates = 0;
  const take = (value: unknown, where: string): void => {
    const problem = checkRecord(value);
    if (problem) { problems.push(`${where}: ${problem}`); return; }
    const r = value as RtRecord, old = byId.get(r.id);
    if (old) { duplicates++; if (old.at > r.at) return; }
    byId.set(r.id, r);
  };
  for (const input of inputs) {
    let value: unknown;
    try { value = JSON.parse(input.text); } catch (e) { problems.push(`${input.name}: не JSON (${(e as Error).message})`); continue; }
    const v = value as { format?: unknown; records?: unknown };
    if (v && typeof v === 'object' && v.format === RT_TELEMETRY_FORMAT && Array.isArray(v.records)) v.records.forEach((r, i) => take(r, `${input.name}#${i}`));
    else if (Array.isArray(value)) value.forEach((r, i) => take(r, `${input.name}#${i}`));
    else take(value, input.name);
  }
  return { records: [...byId.values()], duplicates, problems };
}

/** One fight with everything the report knows about it. */
export interface FightEntry {
  record: FightRecord;
  run: RunRecord | null;
  notes: NoteRecord[];
  journal: Journal | null;
  /** Why the journal could not be assembled or replayed. */
  error: string | null;
  analysis: FightAnalysis | null;
  /** The replay hash equals `endHash`. */
  hashOk: boolean | null;
  /** Fields of the browser's summary that differ from the replay's (empty — they agree, or the browser had none). */
  summaryDiff: string[];
  /**
   * A sandbox «restart» whose `endHash` is the replayed world with the panel's default values: «Сбросить по умолчанию» in the
   * fight before the fix of 15.10.2026 (the record hashed the reset values; docs/realtime-telemetry.md). Not a determinism defect.
   */
  panelReset?: boolean;
}

const fightPath = (r: { session: string; run: string; fight: string }): string => `${r.session}/${r.run}/${r.fight}`;
const runPath = (r: { session: string; run: string }): string => `${r.session}/${r.run}`;

/**
 * The latest record of each run key: a run continued in another browser session writes `S2/R/run` beside `S1/R/run`
 * (the run key R is unique — the start time and the seed); the latest `at` is the run's state.
 */
export function latestRuns(records: readonly RtRecord[]): RunRecord[] {
  const byRun = new Map<string, RunRecord>();
  for (const r of records) if (r.kind === 'run') { const old = byRun.get(r.run); if (!old || old.at <= r.at) byRun.set(r.run, r); }
  return [...byRun.values()];
}

/**
 * Paths where two summaries differ (the browser's against the replay's); `inView` and `threats` are left out. A browser
 * summary of an older build lacks the fields added later: they are not compared (the browser did not count them; the
 * replay of today's observer may — the elites of a fight recorded before 11.10.2026).
 */
export function summaryDiff(browser: FightSummary, replayed: FightSummary): string[] {
  if (JSON.stringify(withSummaryDefaults(browser)) === JSON.stringify(emptyFightSummary())) return [];
  const a = JSON.parse(JSON.stringify(browser)) as FightSummary, b = JSON.parse(JSON.stringify(replayed)) as FightSummary;
  a.threats = {}; b.threats = {};
  if (a.tempo) delete a.tempo.inView;
  delete b.tempo.inView;
  // Task 16 telemetry: the first meetings are the view's count — a replay cannot see them.
  delete a.novelty; delete b.novelty;
  // Task 48: the Troll's damage by group (from 17.10.2026) — a browser of before did not count it.
  if (a.boss?.troll && !a.boss.troll.damage) delete b.boss?.troll?.damage;
  // Task 55в: the shoves (from 23.10.2026) — a browser of before did not count them.
  if (!a.shove) delete b.shove;
  const out: string[] = [];
  const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  // `base` — the same place in the empty summary: a field of the schema the browser record lacks is skipped; a key of a map
  // (`bySource` …) or an element of a list the browser lacks is a difference.
  const walk = (x: unknown, y: unknown, path: string, base: unknown): void => {
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x))) out.push(`${path}: ${x} ≠ ${y}`); return; }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const xv = (x as Record<string, unknown>)[k], field = plain(base) && Object.hasOwn(base, k);
        if (xv === undefined && field) continue;
        walk(xv, (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k, field ? (base as Record<string, unknown>)[k] : undefined);
      }
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  };
  walk(a, b, '', emptyFightSummary());
  return out;
}

/** What the report knows: the fights, and notes of fights without a fight record (the page closed before the fight ended). */
export interface Analysis { fights: FightEntry[]; orphanNotes: NoteRecord[] }

/** Assembles and replays every fight of the records. */
export async function analyzeRecords(set: RecordSet): Promise<Analysis> {
  const runs = new Map<string, RunRecord>(), parts = new Map<string, JournalPart[]>(), notes = new Map<string, NoteRecord[]>();
  for (const r of set.records) {
    if (r.kind === 'run') runs.set(runPath(r), r);
    else if (r.kind === 'journal') (parts.get(fightPath(r)) ?? parts.set(fightPath(r), []).get(fightPath(r))!).push(r);
    else if (r.kind === 'note') (notes.get(fightPath(r)) ?? notes.set(fightPath(r), []).get(fightPath(r))!).push(r);
  }
  const fights = set.records.filter((r): r is FightRecord => r.kind === 'fight').sort((a, b) => fightPath(a).localeCompare(fightPath(b)));
  const out: FightEntry[] = [];
  const latest = new Map(latestRuns(set.records).map(r => [r.run, r]));
  for (const record of fights) {
    const run = runs.get(runPath(record)) ?? latest.get(record.run) ?? null;
    const entry: FightEntry = { record, run, notes: (notes.get(fightPath(record)) ?? []).sort((a, b) => a.tick - b.tick), journal: null, error: null, analysis: null, hashOk: null, summaryDiff: [] };
    out.push(entry);
    try {
      const own = parts.get(fightPath(record)) ?? [];
      entry.journal = await unpackJournal(orderedParts(own, record.fight, record.journal.digest), record.journal, run?.runParams as Params | undefined);
    } catch (e) { entry.error = `журнал не собран: ${(e as Error).message}`; continue; }
    try {
      entry.analysis = analyzeJournal(entry.journal);
      entry.hashOk = entry.analysis.hash === record.endHash;
      if (!entry.hashOk && record.run === SANDBOX_RUN && record.outcome === 'restart' && panelResetHash(entry.analysis.world) === record.endHash) entry.panelReset = true;
      entry.summaryDiff = summaryDiff(record.summary, entry.analysis.summary);
    } catch (e) { entry.error = `повтор не удался: ${(e as Error).message}`; }
  }
  const orphanNotes = [...notes.entries()].filter(([path]) => !fights.some(f => fightPath(f) === path)).flatMap(([, list]) => list);
  return { fights: out, orphanNotes };
}

/** The hash of `world` with every value its journal holds put back to the panel's default (the world is left as it was). */
function panelResetHash(world: World): string {
  const saved = world.params, defaults = defaultParams() as unknown as Record<string, unknown>;
  world.params = Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, key in defaults ? defaults[key] : value])) as unknown as Params;
  try { return hashWorld(world); } finally { world.params = saved; }
}

/** Finds a fight by its key (`f03-n5a-a1`), its path (`S/R/f03-n5a-a1`) or its record id. */
export function findFight(entries: readonly FightEntry[], name: string): FightEntry {
  const key = name.replace(/\/fight$/, '');
  const found = entries.filter(e => (fightPath(e.record) === key || e.record.fight === key || e.record.id === name));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`бой «${name}» не найден`);
  throw new Error(`бой «${name}» неоднозначен: ${found.map(e => fightPath(e.record)).join(', ')}`);
}

// ---- Markdown ----

// The kinds' names are shared with the run-end screen (П6, run/rtRunEnd.ts).
const KIND_TITLES = RT_KIND_TITLES;
const SOURCE_TITLES: Record<string, string> = {
  touch: 'касание', arrow: 'стрела', boar: 'рывок кабана', wolf: 'касание волка', [WOLF_RUSH_SOURCE]: 'бросок волка', lynx: 'прыжок рыси', blast: 'взрыв сапёра',
  quills: 'иглы', 'fire-trail': 'огонь элиты', thorns: 'терновник', reaper: 'жнец', 'castellan-bolt': 'болт Кастеляна',
  // Task 28: the Jailer's moves.
  flail: 'кистень', throw: 'бросок гири',
  // Task 38–40: the garrison's touches and the Castellan's move (the frenzied hound's touch — `garrison.frenzyHits`, section «Гарнизон»).
  bolt: 'болт арбалетчика', crossbow: 'касание арбалетчика',
  hound: 'касание пса', guard: 'касание стражника', handler: 'касание псаря', keymaster: 'касание ключника', castellan: 'касание Кастеляна', lunge: '«Спустить пса»',
  // Task 43: the knight's touch and moves.
  knight: 'касание рыцаря', 'knight-charge': 'рывок рыцаря', 'knight-swing': 'размах рыцаря',
  // Task 48: the Troll's moves.
  'troll-club': '«Удар дубиной»', 'troll-rock': '«Бросок камня»', 'troll-tail': '«Хвост метёт»', 'troll-charge': '«Рывок» Тролля',
  // Task 57а «Лес: стрелки».
  stone: 'камень пращника', wasp: 'оса улья', wisp: 'светляк', slinger: 'касание пращника',
  // Task 57б «Лес: механики» (the firebrand's trail is `fire-trail`, the affix's source).
  rootling: 'касание корневика', slime: 'касание слизня', firebrand: 'касание головешки',
  // Design 22.10.2026: the Warlock's touch and the Castellan's crossbow's (the Chief's parts touch as `touch`).
  warlock: 'касание Колдуна', 'castellan-crossbow': 'касание арбалета Кастеляна',
  // Task 54: the Chief's moves (his and his parts' touches come as `touch` — «касание»); task 56: the omen «Гроза».
  'chief-ladle': '«Взмах половником»', 'chief-pepper': '«Горсть перца»', storm: 'удар грозы',
  // Task 57б-2: the centipede's «Рывок» and its touch.
  'centipede-lunge': 'рывок сороконожки', centipede: 'касание сороконожки',
  // Task 55а: the castle's moves and the rook's touch; the shove's kills (the player's).
  'wardrobe-topple': '«Падение шкафа»', 'rook-strike': '«Удар ладьи»', rook: 'касание ладьи', shove: 'толчок',
  // Task 55 §23 «Колдун v1».
  'warlock-orb': '«Цветные шары»', 'warlock-flash': '«Вспышка посоха»',
};
const THREAT_TITLES: Record<string, string> = {
  // Task 57а «Лес: стрелки».
  sling: 'веер пращника', hive: 'кольцо улья', wisp: 'светляк',
  // Task 57б-2.
  'centipede-lunge': 'рывок сороконожки',
  archer: 'метка лучника', boar: 'полоса кабана', wolf: 'бросок стаи волков', lynx: 'прыжок рыси', sapper: 'фитиль и взрыв сапёра', 'sapper-instant': 'взрыв сапёра без предупреждения',
  flail: 'кистень Тюремщика', throw: 'бросок гири Тюремщика',
  // Task 43: the law of the crossbow (the crossbowman, the Castellan's crossbow).
  bolt: 'болт арбалета',
  'knight-charge': 'рывок рыцаря', 'knight-swing': 'размах рыцаря',
};
const OUTCOME_TITLES: Record<string, string> = { victory: 'победа', defeat: 'поражение', abandoned: 'брошен', open: 'не закончен', restart: 'заново', menu: 'выход в меню', unload: 'страница закрыта' };

const kindTitle = (k: string): string => { const elite = k.endsWith('*'), base = elite ? k.slice(0, -1) : k; return `${KIND_TITLES[base] ?? SOURCE_TITLES[base] ?? base}${elite ? ' (элита)' : ''}`; };
const sourceTitle = (s: string): string => SOURCE_TITLES[s] ?? s;
/** The killing blow as the runs table names it: the striker's kind (— without one), the source, the elite, the affixes. */
const killerTitle = (d: { enemy?: string; source: string; elite?: boolean; affixes?: readonly string[] }): string =>
  `${d.enemy ? kindTitle(d.enemy) : '—'}, ${sourceTitle(d.source)}${d.elite ? ', элита' : ''}${d.affixes?.length ? ` (${d.affixes.join(', ')})` : ''}`;
const arenaTitle = (id: string): string => { try { return `${arenaTemplate(id).name} (${id})`; } catch { return id; } };
const n1 = (x: number): string => (Math.round(x * 10) / 10).toLocaleString('ru-RU');
const n2 = (x: number): string => (Math.round(x * 100) / 100).toLocaleString('ru-RU');
const pct = (part: number, all: number): string => (all ? `${Math.round(100 * part / all)}%` : '—');
const cell = (s: string | number): string => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: (string | number)[][]): string =>
  rows.length ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n') : '_нет данных_';

/**
 * Loop research, step 2: the loop and the step backs of some fights (one fight's row or an arena's). Seals — all (empty,
 * their share), close attempts, unseals; inside — median per seal and the total; step backs — all and those taken again
 * within 0.3 real s. A summary of an older build has none of these fields: they count as 0 (`—` without seals or attempts).
 */
function loopCells(list: readonly FightSummary[]): string[] {
  if (!list.length) return ['—', '—', '—'];
  let seals = 0, empty = 0, attempts = 0, unseals = 0, breaks = 0, backsteps = 0, readds = 0;
  const inside: number[] = [];
  for (const s of list) {
    const c = s.chain;
    seals += c.seals ?? 0; empty += c.sealsEmpty ?? 0; attempts += c.closeAttempts ?? 0; unseals += c.unseals ?? 0; breaks += Object.values(c.loopBreaks ?? {}).reduce((a, b) => a + b, 0);
    backsteps += c.backsteps; readds += c.backstepReadds ?? 0;
    inside.push(...c.sealInside ?? []);
  }
  return [
    seals || attempts || unseals || breaks ? `${seals} (пустых ${empty}, ${pct(empty, seals)}) / ${attempts}${unseals ? `; разомкн. ${unseals}` : ''}${breaks ? `; сорвано ${breaks}` : ''}` : '—',
    inside.length ? `${n1(median(inside))} / ${inside.reduce((a, b) => a + b, 0)}` : '—',
    `${backsteps} (${readds}${backsteps ? `, ${pct(readds, backsteps)}` : ''})`,
  ];
}
const LOOP_LEGEND = 'Петля (песочница, `loopEnabled`): печати — отпущенные замкнутые цепи, «пустых» — никого внутри; попыток — жестов замыкания (замкнул или отказ; повтор того же отказа без смены цепи — один); «разомкн.» — петля разомкнута указателем на последнем звене; «внутри» — тел внутри при отпускании (медиана на печать, всего). Шаги назад: в скобках — звено снято и снова взято за ≤ 0,3 с реального времени.';
const LOOP_HEAD = ['Печати (пустых) / попыток', 'Внутри мед. / всего', 'Шагов назад (повтор ≤ 0,3 с)'];

/**
 * Package «Урон имеет значение»: chains with a tough enemy (HP ≥ 2 at the release) not first, chains that ended on a
 * survivor — counts and shares of the chains of some fights.
 */
function chainShareCells(list: readonly FightSummary[]): string[] {
  if (!list.length) return ['—', '—', '—', '—'];
  let count = 0, tough = 0, survivor = 0, shifts = 0, skips = 0;
  const draw: number[] = [];
  for (const s of list) { count += s.chain.count; tough += s.chain.toughNotFirst ?? 0; survivor += s.chain.survivorEnds; draw.push(...s.chain.drawTime ?? []); shifts += s.chain.colorShifts ?? 0; skips += s.chain.shiftSkips ?? 0; }
  // П1: real seconds from the first link to the release, median per released chain (a record of an older build has none: «—»).
  // Task 34: «Смена цвета» shifts the dashes reached / bodies of another colour a swipe or the held pointer passed by on a free chain.
  return [`${tough} (${pct(tough, count)})`, `${survivor} (${pct(survivor, count)})`, draw.length ? n2(median(draw)) : '—', `${shifts} / ${skips}`];
}
const CHAIN_SHARE_HEAD = ['Крепкий не первым', 'На выжившем', 'Рисование мед., с', 'Смен цвета / пропусков'];

function fightRows(entries: readonly FightEntry[]): (string | number)[][] {
  return entries.map(e => {
    const r = e.record, a = e.analysis, s = a?.summary;
    return [
      `\`${r.fight}\``, r.nodeId ?? '—', r.row ?? '—', arenaTitle(r.arena), r.roster ?? '—', OUTCOME_TITLES[r.outcome] ?? r.outcome, n1(r.time),
      `${r.hpIn} → ${r.hpOut}`, s ? s.damage.total : '—', s ? s.chain.count : '—', s ? `${n1(s.chain.lengthMedian)} / ${s.chain.lengthMax}` : '—', s ? s.kills.chain : '—',
      ...chainShareCells(s ? [s] : []), ...loopCells(s ? [s] : []),
      e.error ? `ошибка: ${e.error}` : e.hashOk ? 'совпал' : e.panelReset ? 'сброс панели' : 'НЕ совпал',
    ];
  });
}
const FIGHT_HEAD = ['Бой', 'Узел', 'Ряд', 'Арена', 'Состав', 'Итог', 'Время, с', 'HP', 'Урон', 'Цепей', 'Длина мед. / макс.', 'Убито цепью', ...CHAIN_SHARE_HEAD, ...LOOP_HEAD, 'Хэш'];

function threatRows(entries: readonly FightEntry[]): (string | number)[][] {
  const all = entries.flatMap(e => e.analysis?.warnings ?? []).filter(w => w.outcome);
  return THREAT_KINDS.flatMap(kind => {
    const list = all.filter(w => w.kind === kind);
    if (!list.length) return [];
    const count = (o: string): number => list.filter(w => w.outcome === o).length;
    const dodged = list.filter(w => w.outcome === 'dodged' && w.exitTicks !== null);
    const cover = list.filter(w => w.reason === 'cover'), walls = cover.filter(w => w.coverKind !== 'cliff').length, cliffs = cover.length - walls;
    return [[
      THREAT_TITLES[kind] ?? kind, list.length, `${count('hit')} (${pct(count('hit'), list.length)})`, `${count('shielded')} (${pct(count('shielded'), list.length)})`,
      `${count('dodged')} (${pct(count('dodged'), list.length)})${cover.length ? `; укрытие: стена ${walls}, обрыв ${cliffs}` : ''}`, `${count('interrupted')} (${pct(count('interrupted'), list.length)})`,
      dodged.length ? n1(median(dodged.map(w => w.exitTicks!))) : '—',
      dodged.length ? `${n2(median(dodged.map(w => w.exitReal!)))} / ${n2(median(dodged.map(w => w.exitGame!)))}` : '—',
    ]];
  });
}
const THREAT_HEAD = ['Предупреждение', 'Всего', 'Попал', 'Защищён', 'Увернулся', 'Прервано', 'Выход мед., такты', 'Выход мед., с (реальн. / игр.)'];

function damageSections(entries: readonly FightEntry[]): string {
  const byKind: Record<string, KindDamage> = {}, bySource: Record<string, { hits: number; damage: number }> = {};
  let total = 0;
  for (const e of entries) {
    const a = e.analysis;
    if (!a) continue;
    for (const [k, d] of Object.entries(a.byKind)) {
      const t = byKind[k] ??= { hits: 0, damage: 0, bySource: {} };
      t.hits += d.hits; t.damage += d.damage;
      for (const [s, v] of Object.entries(d.bySource)) bump(t.bySource, s, v);
    }
    for (const [s, v] of Object.entries(a.summary.damage.bySource)) { const t = bySource[s] ??= { hits: 0, damage: 0 }; t.damage += v; t.hits += a.summary.damage.hits[s] ?? 0; total += v; }
  }
  const kinds = Object.entries(byKind).sort((a, b) => b[1].damage - a[1].damage)
    .map(([k, d]) => [kindTitle(k), d.hits, d.damage, pct(d.damage, total), Object.entries(d.bySource).map(([s, v]) => `${sourceTitle(s)} ${v}`).join(', ')]);
  const sources = Object.entries(bySource).sort((a, b) => b[1].damage - a[1].damage).map(([s, d]) => [sourceTitle(s), d.hits, d.damage, pct(d.damage, total)]);
  const kills = { chain: 0, enemies: 0, tools: {} as Record<string, number> };
  const raised = { hits: 0, damage: 0 };
  const low: string[] = [];
  for (const e of entries) {
    const s = e.analysis?.summary;
    if (!s) continue;
    kills.chain += s.kills.chain; kills.enemies += s.kills.enemies;
    raised.hits += s.damage.raisedTouches.hits; raised.damage += s.damage.raisedTouches.damage;
    for (const [k, v] of Object.entries(s.kills.tools)) bump(kills.tools, k, v);
    if (s.damage.lowHp.length) low.push(`\`${e.record.fight}\` (${e.record.run}): ${s.damage.lowHp.map(m => `такт ${m.tick} — ${m.hp} HP`).join(', ')}`);
  }
  const tools = Object.entries(kills.tools).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет';
  return [
    '### Урон по видам врагов', '', '«(элита)» — удары элиты. Удары без врага (терновник) — по источнику.', '',
    table(['Вид', 'Ударов', 'Урон', 'Доля урона', 'Источники'], kinds), '',
    '### Урон по источникам', '', table(['Источник', 'Ударов', 'Урон', 'Доля'], sources), '',
    `Усиленные касания (крепкий с HP ≥ 2 или элита, \`touchRaised\`; входят в строки выше): ${raised.hits} ударов, ${raised.damage} HP (${pct(raised.damage, total)} урона).`, '',
    '### Убийства', '', `Цепью: ${kills.chain}. Инструментами игрока: ${tools}. Способностями врагов (без зачёта): ${kills.enemies}.`, '',
    '### Моменты HP ≤ 3', '', low.length ? low.map(l => `- ${l}`).join('\n') : '_нет_',
  ].join('\n');
}

/** Package «Урон имеет значение»: the elites of some fights as one row (`label` — the group). */
function eliteRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const list = entries.map(e => e.analysis?.summary.elites).filter((x): x is FightSummary['elites'] => !!x && x.count > 0);
  if (!list.length) return null;
  const sum = (f: (x: FightSummary['elites']) => number): number => list.reduce((a, x) => a + f(x), 0);
  const lifetime = list.flatMap(x => x.lifetime), chains = list.flatMap(x => x.chainsPer), plates: Record<string, number> = {};
  for (const x of list) for (const [k, v] of Object.entries(x.platesBySource)) bump(plates, k, v);
  const downs = sum(x => x.downs), clean = sum(x => x.cleanKills), late = sum(x => x.lateWindowKills);
  return [
    label, list.length, sum(x => x.count), `${lifetime.length} (${sum(x => x.beforeGoals)})`, sum(x => x.aliveAtEnd),
    lifetime.length ? n1(median(lifetime)) : '—', chains.length ? n1(median(chains)) : '—',
    downs, `${clean} (${pct(clean, downs)})`, `${late} (${pct(late, downs)})`, `${sum(x => x.windows)} / ${sum(x => x.windowsClosed)}`,
    Object.entries(plates).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—',
    `${sum(x => x.loot.dropped)} / ${sum(x => x.loot.picked)}`,
  ];
}
/** Rows of the elites table: the runs, the sandbox and, when both have elites, all together. */
function eliteRows(runFights: readonly FightEntry[], sandbox: readonly FightEntry[]): (string | number)[][] {
  const runs = eliteRow('походы', runFights), box = eliteRow('песочница', sandbox);
  return [runs, box, runs && box ? eliteRow('всего', [...runFights, ...sandbox]) : null].filter((r): r is (string | number)[] => !!r);
}
/** Casino stage 1: «Однорукий гоблин» of some fights as one row (`label` — the group); null — no goblin there. */
function slotRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const list = entries.filter(e => (e.analysis?.summary.slot?.appeared ?? 0) > 0), slots = list.map(e => e.analysis!.summary.slot);
  if (!slots.length) return null;
  const sum = (f: (x: FightSummary['slot']) => number): number => slots.reduce((a, x) => a + f(x), 0);
  const outcomes: Record<string, number> = {};
  for (const x of slots) for (const [k, v] of Object.entries(x.outcomes)) bump(outcomes, k, v);
  const pulled = slots.filter(x => x.pulls > 0).length, links = slots.flatMap(x => x.links);
  const after = list.map(e => e.analysis!.summary.tempo.afterGoals).filter((x): x is number => x !== null);
  const appearAt = slots.map(x => x.appearAfterGoals).filter((x): x is number => x !== null);
  const appearTime = slots.map(x => x.appearTime).filter((x): x is number => typeof x === 'number');
  const deaths = list.filter(e => e.record.outcome === 'defeat' && e.analysis!.summary.tempo.afterGoals !== null).length;
  return [
    label, `${list.length} из ${entries.length}`, `${pulled} (${pct(pulled, list.length)})`, n1(median(slots.map(x => x.pulls))),
    links.length ? n1(median(links)) : '—', Object.entries(outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—',
    `${sum(x => x.effects)} / ${sum(x => x.cancelled)}`, `${sum(x => x.damage.volley)} / ${sum(x => x.damage.rain)}`, sum(x => x.kills), deaths,
    appearAt.length ? n1(median(appearAt)) : '—', after.length ? n1(median(after)) : '—',
    // «Перебор» (12.10.2026): fights without the rule show 0 risky pulls.
    sum(x => x.risky ?? 0), sum(x => x.busts ?? 0), sum(x => x.bustDamage ?? 0), sum(x => x.bustDeaths ?? 0),
    // «Длинная цепь кормит гоблина» (12.10.2026): fights without the rule show 0.
    sum(x => x.safeFromChains ?? 0),
    // Task 7 (13.10.2026): the fight second of the appearance («Гоблин раньше»); the area blast («Взрыв по площади») — blasts,
    // the hero inside / spared of them, its kills. Older records: «—» and 0.
    appearTime.length ? n1(median(appearTime)) : '—',
    `${sum(x => x.bustBlasts ?? 0)} / ${sum(x => x.bustInside ?? 0)} / ${sum(x => x.bustSpared ?? 0)}`, sum(x => x.bustKills ?? 0),
    // Task 11 (13.10.2026): the safe pulls the goblins rolled («Гоблин-сюрприз»: count by value) and the sure triples. Older
    // records: «—» and 0.
    safeRolls(slots.flatMap(x => x.safe ?? [])), sum(x => x.triples ?? 0),
  ];
}
/** Task 20 «Выход из круга»: the lit busts of some fights (`slot.bustExits`) — one row; null — none lit. */
export interface BustExitStat { lit: number; inside: number; left: number; outAfter: number[]; by: Record<string, number>; damage: number; blasts: number }
export function bustExitStats(entries: readonly FightEntry[]): BustExitStat | null {
  const exits = entries.flatMap(e => e.analysis?.summary.slot.bustExits ?? []);
  if (!exits.length) return null;
  const by: Record<string, number> = {};
  for (const x of exits) bump(by, x.by ?? 'open');
  const left = exits.filter(x => x.inside && x.outAfter !== null);
  return {
    lit: exits.length, inside: exits.filter(x => x.inside).length, left: left.length, outAfter: left.map(x => x.outAfter!), by,
    damage: exits.reduce((a, x) => a + (x.damage ?? 0), 0), blasts: exits.filter(x => x.damage !== null).length,
  };
}
const BUST_EXIT_TITLES: Record<string, string> = { walk: 'ходьба', dash: 'проход цепи', jump: 'прыжок', 'stayed-safe': 'остался, цел', 'stayed-hurt': 'остался, ранен', outside: 'вне круга', open: 'бой кончился' };
function bustExitRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const st = bustExitStats(entries);
  if (!st) return null;
  const order = ['walk', 'dash', 'jump', 'stayed-safe', 'stayed-hurt', 'outside', 'open'];
  return [
    label, st.lit, `${st.inside} (${pct(st.inside, st.lit)})`, `${st.left} (${pct(st.left, st.inside)})`, st.outAfter.length ? n2(median(st.outAfter)) : '—',
    order.filter(k => st.by[k]).map(k => `${BUST_EXIT_TITLES[k]} ${st.by[k]}`).join(', '), `${st.damage} (взрывов ${st.blasts})`,
  ];
}
/** The runs and the sandbox; no lit bust anywhere — «—». */
function bustExitTable(runFights: readonly FightEntry[], sandbox: readonly FightEntry[]): string {
  const rows = [bustExitRow('походы', runFights), bustExitRow('песочница', sandbox)].filter((r): r is (string | number)[] => !!r);
  return rows.length ? table(BUST_EXIT_HEAD, rows) : '—';
}
const BUST_EXIT_HEAD = ['Бои', 'Переборов с кругом', 'В круге при поджоге', 'Вышли до взрыва', 'Выход мед., с', 'Способы', 'Урон герою'];
const BUST_EXIT_LEGEND = 'Выход из круга (задача 20, с 14.10.2026; `slot.bustExits` повтора): на каждый перебор с «Взрывом по площади» — поджог идола (`lit`). «В круге» — тело героя касалось круга (радиус + тело героя, как считает взрыв). «Вышли» — были в круге при поджоге и вне его при взрыве; время — игровые секунды от поджога до последнего выхода. Способ — как вышел (ходьба, стоял и отброс кабана — ходьба; проход цепи; прыжок), «остался, цел» — в круге при взрыве, но неуязвим, в прыжке или на проходе, «остался, ранен» — в круге и получил урон, «вне круга» — вне его уже при поджоге, «бой кончился» — дверь или поражение до взрыва. Урон — HP героя от взрывов. Нет поджогов — «—» (записи до задачи 7 и до задачи 20 повтор считает заново).';

/** «Гоблин-сюрприз»: the rolled safe pulls as «0: a · 1: b …» (values that came, in order); «—» — none. */
function safeRolls(values: readonly number[]): string {
  if (!values.length) return '—';
  const by: Record<number, number> = {};
  for (const v of values) by[v] = (by[v] ?? 0) + 1;
  return Object.keys(by).map(Number).sort((a, b) => a - b).map(v => `${v}: ${by[v]}`).join(' · ');
}
const SLOT_HEAD = ['Бои', 'С гоблином', 'С рывком', 'Рывков мед.', 'Звеньев на рычаг мед.', 'Исходы', 'Эффектов / отменено', 'Урон залп / дождь', 'Убито стрелами', 'Смертей после целей', 'Появился после целей мед., с', 'После целей мед., с', 'Рискованных рывков', 'Взрывов', 'Урон взрывов', 'Смертей от взрыва', 'Безопасных от длинных цепей', 'Появился на секунде боя мед.', 'Взрывов по площади / герой в круге / уцелел в круге', 'Убито взрывом', 'Безопасных выпало (гоблинов)', 'Верных троек'];
const SLOT_LEGEND = 'Бои с гоблином и их доля среди всех боёв группы. «С рывком» — бои, где рычаг дёрнули хоть раз. Звенья — вражеские звенья, по которым рывок ударил до рычага. Исходы — `rain` (☠☠☠), `volley` (два ☠), тройки `heart3`, `bolt3`, `gem3`, `jackpot`, пары `heart`, `bolt`, `gem`, `pot`, `none`. «Отменено» — бой кончился, пока крутились барабаны. «После целей» — игровые секунды от целей до конца боя (цель дизайна: медиана 15–30 с). «Перебор» (`slotBust`; в походе с 12.10.2026): рискованные рывки — после безопасных (в походе с 4-го), взрывы — пришедшие эффекты `bust` (отменённые дверью не в счёт; в «Исходах» `bust` считается при рывке, как все исходы, — с отменёнными), урон взрывов — источник `slot-bust`, смерть от взрыва — бой проигран его ударом. Исход рискованного рывка — `bust` или тройка; до 12.10.2026 — 0. «Безопасных от длинных цепей» (`slotSafePerLongChain`; в походе с 12.10.2026) — безопасные рывки, которые добавили цепи из 6+ врагов (события `feed`); без правила — 0. «Появился на секунде боя» — игровые секунды от начала боя до первого появления (с 13.10.2026; в походе гоблин приходит на 5-й секунде боя или через 3 с после целей — что раньше; старые записи — «—»). «Взрыв по площади» (`slotBustArea`; в походе с 13.10.2026): взрывы, что сработали после фитиля; «герой в круге» — его тело касалось круга; «уцелел в круге» — в круге, но неуязвим, в прыжке или на проходе; «Убито взрывом» — враги, убитые взрывом (источник `slot-bust`); урон героя от взрыва — в «Урон взрывов». Без правила — 0. «Безопасных выпало» (`slotSafeRandom`; в походе с 13.10.2026) — сколько безопасных рывков бросил гоблин при появлении: значение и число гоблинов с ним (в походе 0–3, игроку не показано); без правила и в старых записях — «—». «Верных троек» (`slotSafeTriple`; в походе с 13.10.2026) — безопасные рывки, давшие верную тройку (черепов нет); без правила — 0. «Безопасных от длинных цепей» в походе с 13.10.2026 — 0 (правило выключено).';

const ELITE_HEAD = ['Бои', 'Боёв с элитами', 'Элит', 'Убито (до целей)', 'Живы в конце', 'Жизнь мед., с', 'Цепей на элиту мед.', 'Убито игроком с бронёй', 'Чистый слом', 'Поздно в окне', 'Окон / закрылось', 'Пластины по источникам', 'Добыча выпала / подобрана'];
const ELITE_LEGEND = 'Жизнь — игровые секунды от появления элиты (или превращения новичка в элиту) до смерти, только убитые; «живы в конце» — не вошли в медиану. Цепей на элиту — рывки, ударившие убитую элиту (удары по пластинам тоже). «Убито игроком с бронёй» — `eliteDown` с зачётом; из них «чистый слом» — в первую `eliteCleanWindow` окна (+1 энергия, добыча ×2), «поздно в окне» — позже в окне (обычная добыча); остальные — не в окне. Окон — снятий последней пластины; «закрылось» — окно кончилось, элита жива. Пластины — снято по источнику удара.';

// ---- Casino «Котёл» (sim/purse.ts, docs/realtime-casino.md): the cauldron of the fights with it on ----
/** The cauldron of some fights as one row (`label` — the group); null — no fight had the cauldron on. */
function purseRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const list = entries.map(e => e.analysis?.summary.purse).filter((x): x is FightSummary['purse'] => !!x && x.on);
  if (!list.length) return null;
  const dist = (values: readonly number[]): string => (values.length ? `${n1(median(values))} / ${Math.max(...values)}` : '—');
  const embers = list.flatMap(x => x.embers), heat = list.flatMap(x => x.heat), totals = list.flatMap(x => x.totals), kills: Record<string, number> = {};
  for (const x of list) for (const [k, v] of Object.entries(x.killEmbers)) bump(kills, k, v);
  const paid = list.map(x => x.resources).filter((x): x is number => x !== null);
  // П4 «Раздув за дела»: the greed step at the door, doors by step (older records and fights without the rule: none).
  const steps = list.map(x => x.exitStep).filter((x): x is number => typeof x === 'number');
  const stepCell = steps.length ? GREED_STEP_NAMES.map((name, i) => `${name} ${steps.filter(x => x === i).length}`).join(', ') : '—';
  // П3 «Финальная цепь»: how the hero went through the door (older records: none).
  const exits = list.map(x => x.exitBy).filter((x): x is NonNullable<typeof x> => !!x);
  const exitCell = exits.length ? EXIT_NAMES.map(([by, name]) => `${name} ${exits.filter(x => x === by).length}`).join(', ') : '—';
  return [
    label, list.length, dist(list.map(x => x.cauldron)), totals.length, dist(embers), dist(heat), dist(totals),
    list.reduce((a, x) => a + x.crystals, 0),
    Object.entries(kills).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—',
    paid.length ? `${paid.reduce((a, x) => a + x, 0)} (${paid.length} дверей, мед. ${n1(median(paid))})` : '—',
    stepCell, exitCell,
  ];
}
/** П3: the exits through the door as the report names them. */
const EXIT_NAMES: readonly (readonly [NonNullable<FightSummary['purse']['exitBy']>, string])[] = [['chain', 'цепью'], ['jump', 'прыжком'], ['walk', 'ходьбой']];
/** П4: the greed steps as the HUD names them (step 0–3). */
const GREED_STEP_NAMES = ['×1', '×1,5', '×2', '×3'];
/** Rows of the cauldron table: the runs, the sandbox and, when both had it, all together. */
function purseRows(runFights: readonly FightEntry[], sandbox: readonly FightEntry[]): (string | number)[][] {
  const runs = purseRow('походы', runFights), box = purseRow('песочница', sandbox);
  return [runs, box, runs && box ? purseRow('всего', [...runFights, ...sandbox]) : null].filter((r): r is (string | number)[] => !!r);
}
const PURSE_HEAD = ['Бои', 'Боёв с котлом', 'Котёл за бой мед. / макс.', 'Чеков', 'Угли на чек мед. / макс.', 'Жар мед. / макс.', 'Чек мед. / макс.', 'Кристаллов в цепях', 'Угли убийств сборки', 'Ресурсов в двери (без кости)', 'Ступень раздува в двери', 'Выход в дверь'];
const PURSE_LEGEND = 'Котёл (`purse`; в походе включён): чек цепи — угли × жар × кристаллы (`cheque`), один на рывок с вражеским звеном. Угли убийств сборки — 1 за убитого молотом, волной или стрелой гоблина (`purseKill`), по источнику. Ресурсы — ⌊котёл × клятва ÷ курс⌋ (`purseRate`: в походе 120 с 12.10.2026, до того 60; песочница 60; курс записан в двери; клятва ×2 / ×0,5, без неё ×1), не больше 3 без клятвы, 6 с выполненной, 1 с нарушенной (`purseDoor`). Это выплата без кости: кость похода — раздел «Кость у двери». Ступень раздува (П4 «Раздув за дела», `greedByDeeds`; в походе включён с 11.10.2026) — `purse.exitStep`, двери по ступеням ×1 / ×1,5 / ×2 / ×3; котёл в двери умножается на ступень, потолок выплаты прежний. «—» — нет дверей с правилом (и все записи до него). Выход в дверь (`purse.exitBy`, с 12.10.2026) — цепью, прыжком или ходьбой; цепь в дверь с П3 «Финальная цепь» (`doorFinale`; в походе включён с 12.10.2026) получает +1 жар. «—» — записи до 12.10.2026.';
// ---- end «Котёл» ----

// ---- Casino «Ставка клятвы» (sim/oath.ts, docs/realtime-casino.md): offers of the runs, outcomes of the fights ----
/**
 * One row per oath: offered and taken on the node cards of the runs (`RunRecord.choices`, source `oath-stake`), fights under
 * it (run fights and sandbox), kept and broken at the door, the median tick of the violation; a last row — «без клятвы»: cards
 * left without an oath.
 */
function oathRows(runs: readonly RunRecord[], entries: readonly FightEntry[]): (string | number)[][] {
  const rows = new Map<string, { offered: number; taken: number; fights: number; kept: number; broken: number; ticks: number[] }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { offered: 0, taken: 0, fights: 0, kept: 0, broken: 0, ticks: [] }).get(id)!;
  let cards = 0, none = 0;
  for (const run of runs) for (const c of run.choices) {
    if (c.source !== OATH_STAKE_SOURCE) continue;
    cards++;
    if (!c.taken.length) none++;
    for (const id of c.offered) row(id).offered++;
    for (const id of c.taken) row(id).taken++;
  }
  for (const e of entries) {
    const o = e.analysis?.summary.oath;
    if (!o?.id) continue;
    const r = row(o.id);
    r.fights++;
    if (o.kept === true) r.kept++;
    if (o.kept === false) r.broken++;
    if (o.brokenTick !== null) r.ticks.push(o.brokenTick);
  }
  if (!rows.size) return [];
  const list = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, r]) => [
    `\`${id}\``, r.offered, r.taken, r.fights, r.kept, r.broken, r.ticks.length ? n1(median(r.ticks)) : '—',
  ]);
  return [...list, ['без клятвы', cards, none, '—', '—', '—', '—']];
}
const OATH_HEAD = ['Клятва', 'Предложена', 'Взята', 'Боёв с ней', 'Выполнена', 'Нарушена', 'Такт нарушения мед.'];
const OATH_LEGEND = 'Ставка клятвы (`oathStake`; в походе включена): предложена и взята — карточки узлов походов (выбор `oath-stake`), строка «без клятвы» — карточек всего и сколько ушло без клятвы. Бои — походы и песочница. Выполнена / нарушена — итог в двери (котёл ×2 / ×0,5); бой без двери не попадает ни туда, ни туда. Такт нарушения — такт события (у клятвы «хотя бы раз» — такт двери).';
// ---- end «Ставка клятвы» ----

// ---- П9 «Второе дыхание» (sim/world.ts, docs/realtime-prototype.md, 9н; sandbox only): one line under the sandbox ----
/** The second winds of the sandbox fights as one line; null — none (older records read as none). */
function secondWindLine(sandbox: readonly FightEntry[]): string | null {
  const list = sandbox.filter(e => e.analysis?.summary.secondWind), winds = list.map(e => e.analysis!.summary.secondWind!);
  if (!winds.length) return null;
  const sources: Record<string, number> = {};
  for (const w of winds) bump(sources, w.source);
  const won = list.filter(e => e.record.outcome === 'victory').length, lost = list.filter(e => e.record.outcome === 'defeat').length;
  return `Второе дыхание (П9, \`secondWind\`): боёв с ним ${winds.length} из ${sandbox.length}; HP до смертельного удара мед. ${n1(median(winds.map(w => w.hpBefore)))}; `
    + `источник удара: ${Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}; потом победа ${won}, поражение ${lost}.`;
}
// ---- end «Второе дыхание» ----

// ---- К7 «Проклятый сундук» (sim/chest.ts, docs/realtime-casino.md): the chest of «Застава» and its curse ----
/** The chest stood in the fight: the rule was on in the journal's params and the arena has a chest point. */
function chestStood(e: FightEntry): boolean {
  if (!e.analysis?.world.params.cursedChest) return false;
  try { return !!arenaTemplate(e.record.arena).chest; } catch { return false; }
}
/** The chest of some fights as one row (`label` — the group); null — the chest stood in none of them. */
function chestRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const list = entries.filter(chestStood);
  if (!list.length) return null;
  const chests = list.map(e => e.analysis!.summary.chest), took = list.filter(e => e.analysis!.summary.chest.taken !== null);
  const lifted = chests.filter(x => x.liftedAt !== null).length, bySource: Record<string, number> = {};
  for (const x of chests) for (const [k, v] of Object.entries(x.cursedDamage)) bump(bySource, k, v);
  const total = Object.values(bySource).reduce((a, b) => a + b, 0), won = (l: readonly FightEntry[]): number => l.filter(e => e.record.outcome === 'victory').length;
  const rest = list.filter(e => e.analysis!.summary.chest.taken === null);
  return [
    label, list.length, `${took.length} (${pct(took.length, list.length)})`, took.length ? `${lifted} (${pct(lifted, took.length)})` : '—',
    took.length ? `${total} (ср. ${n1(total / took.length)})` : '—',
    Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${sourceTitle(k)} ${v}`).join(', ') || '—',
    `${won(took)} из ${took.length} / ${won(rest)} из ${rest.length}`,
  ];
}
/** Rows of the chest table: the runs, the sandbox and, when both had it, all together. */
function chestRows(runFights: readonly FightEntry[], sandbox: readonly FightEntry[]): (string | number)[][] {
  const runs = chestRow('походы', runFights), box = chestRow('песочница', sandbox);
  return [runs, box, runs && box ? chestRow('всего', [...runFights, ...sandbox]) : null].filter((r): r is (string | number)[] => !!r);
}
const CHEST_HEAD = ['Бои', 'Боёв с сундуком на арене', 'Сундук взят', 'Проклятие снято', 'Урон под проклятием (HP)', 'Урон по источникам', 'Побед: сундук взят / не взят'];
const CHEST_LEGEND = 'Проклятый сундук (`cursedChest`; в походе включён с 12.10.2026; стоит только на «Заставе»): учтены бои, где правило было включено и на арене есть сундук. «Сундук взят» — доля таких боёв, где герой его взял (цепью или касанием); цель исследования К7 — 40–70 % боёв «Заставы». «Проклятие снято» — доля взятых, где рывок убил 12 врагов. Урон под проклятием — HP, потерянные от взятия сундука до снятия проклятия или конца боя (`chest.cursedDamage`), по источникам как в «Врагах». Победы — бои, закончившиеся победой, среди взятых и не взятых (эвристика, не оценка баланса).';
// ---- end «Проклятый сундук» ----

// ---- Task 14 «Котомка у двери» (sim/bag.ts, docs/realtime-slice.md): the bag after the goals ----
/** The bag of some fights as one row (`label` — the group); null — no fight had a bag. */
function bagRow(label: string, entries: readonly FightEntry[]): (string | number)[] | null {
  const list = entries.filter(e => e.analysis?.summary.bag?.appeared);
  if (!list.length) return null;
  const bags = list.map(e => e.analysis!.summary.bag), steps = [0, 0, 0, 0];
  for (const b of bags) steps[Math.max(0, Math.min(3, b.steps))]++;
  const paid = bags.filter(b => b.payout !== null), resources = paid.reduce((a, b) => a + (b.payout ?? 0), 0);
  const resets = bags.reduce((a, b) => a + b.resets, 0);
  return [
    label, list.length, steps.join(' / '), n1(median(bags.map(b => b.killsAfterGoals))), `${resets} (ср. ${n1(resets / list.length)})`,
    `${paid.length} (${pct(paid.length, list.length)})`, `${resources} (ср. ${n1(resources / list.length)})`,
  ];
}
/** Rows of the bag table: the runs, the sandbox and, when both had it, all together. */
function bagRows(runFights: readonly FightEntry[], sandbox: readonly FightEntry[]): (string | number)[][] {
  const runs = bagRow('походы', runFights), box = bagRow('песочница', sandbox);
  return [runs, box, runs && box ? bagRow('всего', [...runFights, ...sandbox]) : null].filter((r): r is (string | number)[] => !!r);
}
const BAG_HEAD = ['Бои', 'Боёв с котомкой', 'Ступеней 0 / 1 / 2 / 3', 'Убийств после целей (мед.)', 'Сбросов', 'Выплат', 'Ресурсов'];
const BAG_LEGEND = 'Котомка у двери (`doorBag`; в походе включена с 13.10.2026 — с ряда 2, кроме Тюремщика и финала): учтены бои, где котомка появилась (цели выполнены). Ступени — заполненные к концу боя (10 / 20 / 35 убийств после целей — 1 / 2 / 3 ресурса). Убийства после целей — зачтённые игроку (`bag.killsAfterGoals`), сброс их не снимает. Сбросы — удары с потерей HP, откатившие незаполненную ступень (`bag.resets`). Выплаты — бои, где дверь заплатила за котомку; поражение не платит. Эвристика, не оценка баланса.';
// ---- end «Котомка у двери» ----

// ---- Casino «Кость у двери» (run/rtRun.ts, docs/realtime-casino.md): the die screens of the runs ----
/**
 * One row of the runs' die screens (`RunRecord.dice`): shown, rolled, taken, open; of the rolls — 1–3 and 4–6; resources
 * paid, and what «Забрать» would have paid on the same screens. Null — no die screen.
 */
function dieRow(runs: readonly RunRecord[]): (string | number)[] | null {
  const dice = runs.flatMap(r => r.dice ?? []);
  if (!dice.length) return null;
  const rolled = dice.filter(d => d.rolled === true), taken = dice.filter(d => d.rolled === false), done = dice.filter(d => d.rolled !== null);
  const sum = (list: readonly (number | null)[]): number => list.reduce<number>((a, x) => a + (x ?? 0), 0);
  return [
    dice.length, rolled.length, taken.length, dice.length - done.length,
    rolled.filter(d => d.mult !== null && d.mult < 1).length, rolled.filter(d => d.mult !== null && d.mult > 1).length,
    sum(done.map(d => d.resources)), sum(done.map(d => d.base)),
  ];
}
const DIE_HEAD = ['Экранов', 'Бросить', 'Забрать', 'Не выбрано', 'Выпало 1–3 (×0,5)', 'Выпало 4–6 (×2)', 'Ресурсов выплачено', 'Забрать дал бы'];
const DIE_LEGEND = 'Кость у двери (`doorDie`; в походе включена): экран после победы на арене с котлом больше 0 (`RunRecord.dice`, выбор `door-die`). Исход фиксируется при показе. «Бросить» платит котёл ×0,5 (1–3) или ×2 (4–6), «Забрать» — ×1; формула и потолок — как у котла. «Забрать дал бы» — выплата ×1 на тех же экранах.';
// ---- end «Кость у двери» ----

// ---- П6 «Незакрытое дело»: a new run soon after the end (RunRecord.endedAt); П8 «Новое на карте»: the sign on the map (RunRecord.mapSigns) ----
/** П6 metric: a new run is «soon» when its first fight is recorded within this many ms after the end. */
export const NEW_RUN_WINDOW_MS = 2 * 60 * 1000;

/** One group of runs of the П6 metric. `ended` — runs with a known end, `noData` — ended runs of records before `endedAt`. */
export interface NewRunGroup { group: string; ended: number; noData: number; within: number; noNext: number; pauses: number[] }

/**
 * П6 metric over the runs (the latest record of each, `latestRuns`): among the runs that ended (`victory` or `defeat`) with
 * `endedAt`, the share whose next run's first fight is recorded within 2 minutes, and the pauses (ended → the next run's first
 * fight, `at` of both). Groups: the tester's name, else the browser session (the run table's columns). The next run is the
 * group's run with the earliest first fight after the end. An ended run without `endedAt` (a record before 12.10.2026) is
 * skipped and counted in `noData`; open and abandoned runs have no end. Rows: the groups by name, then «всего».
 */
export function newRunGroups(records: readonly RtRecord[]): NewRunGroup[] {
  const firstFight = new Map<string, number>();
  for (const r of records) {
    if (r.kind !== 'fight') continue;
    const at = Date.parse(r.at);
    if (Number.isFinite(at) && at < (firstFight.get(r.run) ?? Infinity)) firstFight.set(r.run, at);
  }
  const runs = latestRuns(records), groupOf = (r: RunRecord): string => r.tester ?? r.session;
  const groups = new Map<string, NewRunGroup>();
  for (const run of runs.filter(r => r.outcome === 'victory' || r.outcome === 'defeat')) {
    const g = groups.get(groupOf(run)) ?? groups.set(groupOf(run), { group: groupOf(run), ended: 0, noData: 0, within: 0, noNext: 0, pauses: [] }).get(groupOf(run))!;
    const end = run.endedAt === undefined ? NaN : Date.parse(run.endedAt);
    if (!Number.isFinite(end)) { g.noData++; continue; }
    g.ended++;
    const starts = runs.filter(r => r.run !== run.run && groupOf(r) === groupOf(run)).map(r => firstFight.get(r.run)).filter((at): at is number => at !== undefined && at > end);
    if (!starts.length) { g.noNext++; continue; }
    const pause = Math.min(...starts) - end;
    g.pauses.push(pause);
    if (pause <= NEW_RUN_WINDOW_MS) g.within++;
  }
  const list = [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
  if (!list.length) return [];
  const all: NewRunGroup = { group: 'всего', ended: 0, noData: 0, within: 0, noNext: 0, pauses: [] };
  for (const g of list) { all.ended += g.ended; all.noData += g.noData; all.within += g.within; all.noNext += g.noNext; all.pauses.push(...g.pauses); }
  return [...list, all];
}
const NEW_RUN_HEAD = ['Группа', 'Концов с отметкой', 'Нет данных', 'Новый поход ≤ 2 мин', 'Нового похода нет', 'Пауза мед.'];
const NEW_RUN_LEGEND = 'П6 «Незакрытое дело». Конец похода — победа или поражение; отметка конца — `RunRecord.endedAt` (с 12.10.2026). Новый поход — первый бой другого похода той же группы (имя тестера, а без него — сессия) после конца; время — `at` записей. «Нет данных» — концы в записях без `endedAt`: в долю они не входят. Доля — от концов с отметкой (без нового похода — в знаменателе, не в числителе). Пауза — от конца до первого боя следующего похода, медиана по тем, у кого он был (не только по уложившимся в 2 минуты). Цель исследования 40–60 % (эвристика; если 90 %+ при жалобах на усталость — пересмотреть).';
function newRunRows(records: readonly RtRecord[]): (string | number)[][] {
  return newRunGroups(records).map(g => [
    g.group === 'всего' ? 'всего' : `\`${g.group}\``, g.ended, g.noData, `${g.within} (${pct(g.within, g.ended)})`, g.noNext,
    g.pauses.length ? `${Math.round(median(g.pauses) / 1000)} с` : '—',
  ]);
}

/** П8 metric: the map choices made with a sign shown. `chosenSigned` — the chosen node wore the sign. */
export interface MapSignStats { runs: number; choices: number; chosenSigned: number }
export function mapSignStats(runs: readonly RunRecord[]): MapSignStats {
  const signs = runs.flatMap(r => r.mapSigns ?? []);
  return { runs: runs.filter(r => r.mapSigns?.length).length, choices: signs.length, chosenSigned: signs.filter(s => s.chosenSigned).length };
}
const MAP_SIGN_HEAD = ['Походов со знаком', 'Выборов со знаком', 'Выбран узел со знаком', 'Выбран узел без знака'];
const MAP_SIGN_LEGEND = 'П8 «Новое на карте». Выбор узла на карте, при котором хоть на одной доступной карточке стоял знак «✦ новое» (`RunRecord.mapSigns`; выключатель выключен — не пишется, записи до 12.10.2026 поля не имеют). Доля — выборов, где выбранный узел был со знаком, от всех таких выборов. Цель исследования 55–75 % «при равной альтернативе» (эвристика); отчёт не отделяет выборы с равной альтернативой, поэтому доля грубая.';
function mapSignRows(runs: readonly RunRecord[]): (string | number)[][] {
  const s = mapSignStats(runs);
  return s.choices ? [[s.runs, s.choices, `${s.chosenSigned} (${pct(s.chosenSigned, s.choices)})`, s.choices - s.chosenSigned]] : [];
}
// ---- «Обучение»: the hints / world labels shown per run (RunRecord.hints) ----

/** The share of runs in which each fight hint was shown (the order of the design, Б1–Б9). */
export interface HintStat { id: string; title: string; runs: number }
export function hintStats(runs: readonly RunRecord[]): HintStat[] {
  return HINT_IDS.map(id => ({ id, title: HINT_TITLES[id], runs: runs.filter(r => r.hints?.includes(id)).length }));
}
const HINT_HEAD = ['Подсказка', 'Походов с показом', 'Доля походов'];
const HINT_LEGEND = '«Обучение» (12.10.2026). Походы, где зритель увидел подпись у предмета (`RunRecord.hints`; с задачи 6 живы только Б6 «Элита», Б8 «Сундук», Б9 «Гоблин», у старых записей — Б1–Б9 коробки v1); доля — от всех походов набора. Подпись держится до действия и после него не возвращается этому зрителю (память браузера), поэтому у возвращающегося тестера доли ниже, а у новых зрителей — около доли походов, где предмет встретился. Выключатель «Подсказки» выключен и песочница — поле не пишется; записи до 12.10.2026 поля не имеют.';
function hintRows(runs: readonly RunRecord[]): (string | number)[][] {
  const stats = hintStats(runs);
  return stats.some(s => s.runs) ? stats.map(s => [s.title, s.runs, pct(s.runs, runs.length)]) : [];
}
// ---- end «Обучение v1» ----

// ---- end П6 / П8 ----

// ---- Task 35, С1 «Тряска и вспышки» (RunRecord.fx) ----

/** С1: runs with the level recorded; by the level at the end (100 / 50 / 0), changed during the run, started below 100. */
export interface FxStats { runs: number; end: Record<'100' | '50' | '0', number>; changed: number; startedLow: number }
export function fxStats(runs: readonly RunRecord[]): FxStats {
  const withFx = runs.filter(r => r.fx);
  return {
    runs: withFx.length, end: { 100: withFx.filter(r => r.fx!.end === 100).length, 50: withFx.filter(r => r.fx!.end === 50).length, 0: withFx.filter(r => r.fx!.end === 0).length },
    changed: withFx.filter(r => r.fx!.changes > 0).length, startedLow: withFx.filter(r => r.fx!.start < 100).length,
  };
}
const FX_HEAD = ['Походов с данными', 'В конце 100 %', 'В конце 50 %', 'В конце 0 % (выключили)', 'Меняли в походе', 'Начали ниже 100 %'];
const FX_LEGEND = 'Задача 35, С1 (с 15.10.2026): уровень «Тряска и вспышки» зрителя в походе (`RunRecord.fx`: в начале похода, в последней записи, сколько раз меняли на шестерёнке карты; настройка вида, не Params). Доли — от походов с данными; «выключили» — уровень 0 % в конце. Записи до 15.10.2026 поля не имеют.';
function fxRows(runs: readonly RunRecord[]): (string | number)[][] {
  const s = fxStats(runs), cell = (n: number) => `${n} (${pct(n, s.runs)})`;
  return s.runs ? [[s.runs, cell(s.end[100]), cell(s.end[50]), cell(s.end[0]), cell(s.changed), cell(s.startedLow)]] : [];
}

// ---- The camp's warmup (WarmupRecord, task 51ж, 17.10.2026) ----

/** One warmup layout over the set's attempts. */
export interface WarmupLayoutStat {
  layout: string;
  title: string;
  /** Attempts; sessions with one; repeats — the attempts after a session's first of the layout. */
  attempts: number; sessions: number; repeats: number;
  /** Ends by kind. */
  limit: number; clear: number; death: number; exit: number;
  /** New bests; the best score seen (null — none); median real seconds of an attempt. */
  records: number; best: number | null; realMedian: number;
}
/** The warmup over the set: sessions with a warmup among all sessions of the set, and each layout. */
export interface WarmupStats { sessions: number; withWarmup: number; layouts: WarmupLayoutStat[] }

/** The warmup records of the set (the latest copy of each id is already chosen by `collectRecords`). */
export function warmupStats(records: readonly RtRecord[]): WarmupStats {
  const all = records.filter((r): r is WarmupRecord => r.kind === 'warmup');
  const ids = [...WARMUP_LAYOUTS.map(l => l.id as string), ...[...new Set(all.map(r => r.layout))].filter(id => !isWarmupId(id))];
  const layouts = ids.flatMap((id): WarmupLayoutStat[] => {
    const list = all.filter(r => r.layout === id);
    if (!list.length) return [];
    const sessions = new Set(list.map(r => r.session)).size, scores = list.flatMap(r => (r.score === null ? [] : [r.score]));
    const lower = isWarmupId(id) && warmupLayout(id).metric === 'clearTime';
    return [{
      layout: id, title: isWarmupId(id) ? warmupLayout(id).title : id, attempts: list.length, sessions, repeats: list.length - sessions,
      limit: list.filter(r => r.end === 'limit').length, clear: list.filter(r => r.end === 'clear').length, death: list.filter(r => r.end === 'death').length, exit: list.filter(r => r.end === 'exit').length,
      records: list.filter(r => r.record).length, best: scores.length ? (lower ? Math.min(...scores) : Math.max(...scores)) : null, realMedian: median(list.map(r => r.realSeconds)),
    }];
  });
  return { sessions: new Set(records.map(r => r.session)).size, withWarmup: new Set(all.map(r => r.session)).size, layouts };
}
const WARMUP_HEAD = ['Раскладка', 'Попыток', 'Сессий', 'Повторов', 'Лимит / чисто / смерть / выход', 'Новых рекордов', 'Лучший итог', 'Время мед., реально'];
const WARMUP_LEGEND = 'Разминка у «Чурбаков» в лагере (`WarmupRecord`, задача 51ж, с 17.10.2026; run/warmup.ts): запись на каждую попытку, без журнала боя. Повторы — попытки раскладки после первой в той же сессии (риск спеки: «разминку повторяют 0 раз почти все — петля лишняя»). Лучший итог: «Строй» — звеньев одной цепью, «Пестрота» — секунд до чистого поля (меньше — лучше), «Через пропасть» — убийств. Выход — попытка брошена кнопкой, итога нет. Время — реальные секунды попытки (кадры без паузы). Доля сессий — от всех сессий набора. Записей до 17.10.2026 нет — «_нет данных_».';
function warmupSection(records: readonly RtRecord[]): string {
  const stats = warmupStats(records);
  if (!stats.layouts.length) return `${WARMUP_LEGEND}\n\n_нет данных_`;
  const share = `Сессий с разминкой: ${stats.withWarmup} из ${stats.sessions} (${pct(stats.withWarmup, stats.sessions)}).`;
  return [WARMUP_LEGEND, '', share, '', table(WARMUP_HEAD, stats.layouts.map(l => [
    l.title, l.attempts, l.sessions, `${l.repeats} (${pct(l.repeats, l.attempts)})`, `${l.limit} / ${l.clear} / ${l.death} / ${l.exit}`, l.records, l.best === null ? '—' : n1(l.best), `${n1(l.realMedian)} с`,
  ]))].join('\n');
}

// ---- The prologue «Опушка» (PrologueRecord, from 13.10.2026) ----

/** One room of the prologue over some playthroughs. Times — medians over the playthroughs that passed the room. */
export interface PrologueRoomStat {
  room: number;
  title: string;
  /** Playthroughs that reached the room / passed it / were skipped in it. */
  reached: number; passed: number; skipped: number;
  /** Median game and real seconds to pass (all attempts together); null — nobody passed. */
  gameMedian: number | null; realMedian: number | null;
  /** Playthroughs in which the ghost hand / the arrow came at least once in the room. */
  withHand: number; withArrow: number;
  /** Median attempts (starts of the room) over those who reached it; deaths in all; median returns of the enemies. */
  attemptsMedian: number; deaths: number; restoresMedian: number;
}
/** The prologue by where it was started. `players` — distinct testers (by name, else session). */
export interface PrologueOriginStat { from: PrologueFrom; playthroughs: number; players: number; done: number; skipped: number; open: number; rooms: PrologueRoomStat[] }

/**
 * A room of a prologue record by today's numbers (task 13, 13.10.2026: ten rooms). A record without `roomCount` was written for
 * the six rooms of task 6: its rooms 1–4 are the same, 5 «Гоблин» is room 8 now, 6 «Толпа» is room 10 (it never saw rooms 5–7
 * and 9). A record of the nine rooms of task 9 (`roomCount` 9): rooms 1–8 the same, 9 «Толпа» is room 10 (it never saw room 9
 * «Щит»). A record of ten rooms — as it is.
 */
export function prologueRoomNow(record: Pick<PrologueRecord, 'roomCount'>, room: number): number {
  if (record.roomCount === undefined) return room === 5 ? 8 : room === 6 ? 10 : room;
  if (record.roomCount === 9) return room === 9 ? 10 : room;
  return room;
}

/** The prologue records of the set (the latest copy of each id is already chosen by `collectRecords`), grouped by origin. */
export function prologueStats(records: readonly RtRecord[]): PrologueOriginStat[] {
  const all = records.filter((r): r is PrologueRecord => r.kind === 'prologue');
  const out: PrologueOriginStat[] = [];
  for (const from of ['first', 'gear'] as const) {
    const list = all.filter(r => r.from === from);
    if (!list.length) continue;
    const rooms = PROLOGUE_ROOMS.map((room): PrologueRoomStat => {
      const here = list.flatMap(r => r.rooms.filter(x => prologueRoomNow(r, x.room) === room.number)), passed = here.filter(x => x.outcome === 'win');
      return {
        room: room.number, title: room.title, reached: here.length, passed: passed.length,
        skipped: list.filter(r => r.skipRoom !== null && prologueRoomNow(r, r.skipRoom) === room.number).length,
        gameMedian: passed.length ? median(passed.map(x => x.gameSeconds)) : null, realMedian: passed.length ? median(passed.map(x => x.realSeconds)) : null,
        withHand: here.filter(x => x.hands > 0).length, withArrow: here.filter(x => x.arrows > 0).length,
        attemptsMedian: median(here.map(x => x.attempts)), deaths: here.reduce((a, x) => a + x.deaths, 0), restoresMedian: median(here.map(x => x.restores)),
      };
    });
    out.push({
      from, playthroughs: list.length, players: new Set(list.map(r => r.tester ?? r.session)).size,
      done: list.filter(r => r.outcome === 'done').length, skipped: list.filter(r => r.outcome === 'skip').length, open: list.filter(r => r.outcome === 'open').length, rooms,
    });
  }
  return out;
}
const PROLOGUE_FROM_TITLES: Record<PrologueFrom, string> = { first: 'первый запуск', gear: 'шестерёнка «Обучение»' };
const PROLOGUE_HEAD = ['Откуда', 'Прохождений', 'Игроков', 'Пройден', 'Пропущен', 'Не закончен'];
const PROLOGUE_ROOM_HEAD = ['Комната', 'Дошли', 'Прошли', 'Время мед., игра / реально', 'Рука показана', 'Стрелка показана', 'Попыток мед.', 'Смертей', 'Возвратов мед.', 'Пропущено здесь'];
const PROLOGUE_LEGEND = 'Пролог «Опушка» (`PrologueRecord`, с 13.10.2026; docs/realtime-onboarding.md): запись на каждое прохождение, без журналов боя. «Первый запуск» — новый зритель без отметки «пролог пройден», «шестерёнка» — кнопка «Обучение». Игроки — имя тестера, а без него — сессия. Доли — от прохождений, дошедших до комнаты. Время — медиана по прошедшим комнату, все попытки вместе: игровые секунды (`world.time`) и реальные (кадры без паузы); затемнение между комнатами не входит. Попытки — запуски комнаты (смерть в 8–10 запускает её снова); возвраты — враги вернулись на места (комнаты 2–4, 6, 8, 9). «Рука показана» — призрачная рука пришла хоть раз; «стрелка» — стрелка с кругом. Комнат десять с 13.10.2026 (задача 9: 5 «Пропасть», 6 «Вихрь», 7 «Зелье»; задача 13: 9 «Щит»); старые записи читаются по нынешним номерам: у записей шести комнат (без `roomCount`) 5 «Гоблин» — комната 8, 6 «Толпа» — 10, до комнат 5–7 и 9 они не доходили; у записей девяти комнат (`roomCount` 9) 9 «Толпа» — комната 10, до комнаты 9 «Щит» они не доходили. Записей до 13.10.2026 нет — «_нет данных_».';
function prologueSection(records: readonly RtRecord[]): string {
  const stats = prologueStats(records);
  if (!stats.length) return `${PROLOGUE_LEGEND}\n\n_нет данных_`;
  const head = table(PROLOGUE_HEAD, stats.map(s => [PROLOGUE_FROM_TITLES[s.from], s.playthroughs, s.players, `${s.done} (${pct(s.done, s.playthroughs)})`, `${s.skipped} (${pct(s.skipped, s.playthroughs)})`, s.open]));
  const sec = (x: number | null): string => (x === null ? '—' : n1(x));
  const rooms = (s: PrologueOriginStat): string => table(PROLOGUE_ROOM_HEAD, s.rooms.map(r => [
    `${r.room} · ${r.title}`, r.reached, `${r.passed} (${pct(r.passed, r.reached)})`, `${sec(r.gameMedian)} / ${sec(r.realMedian)} с`,
    `${r.withHand} (${pct(r.withHand, r.reached)})`, `${r.withArrow} (${pct(r.withArrow, r.reached)})`, n1(r.attemptsMedian), r.deaths, n1(r.restoresMedian), r.skipped,
  ]));
  return [PROLOGUE_LEGEND, '', head, ...stats.flatMap(s => ['', `### Комнаты: ${PROLOGUE_FROM_TITLES[s.from]}`, '', rooms(s)]), '', '### Урок перебора (комната 8)', '', prologueBustSection(records)].join('\n');
}

/** Task 24: the show busts of room 8 by origin (`PrologueRoomTally.busts`). */
export interface PrologueBustStat { from: PrologueFrom; busts: number; insideAtLit: number; left: number; outMedian: number | null; hurt: number; outside: number; unfinished: number }
export function prologueBustStats(records: readonly RtRecord[]): PrologueBustStat[] {
  const all = records.filter((r): r is PrologueRecord => r.kind === 'prologue');
  const out: PrologueBustStat[] = [];
  for (const from of ['first', 'gear'] as const) {
    const busts = all.filter(r => r.from === from).flatMap(r => r.rooms.filter(x => prologueRoomNow(r, x.room) === 8).flatMap(x => x.busts ?? []));
    if (!busts.length) continue;
    const left = busts.filter(b => b.inside && b.outAfter !== null && b.damage === 0);
    out.push({
      from, busts: busts.length, insideAtLit: busts.filter(b => b.inside).length, left: left.length,
      outMedian: left.length ? median(left.map(b => b.outAfter!)) : null, hurt: busts.filter(b => (b.damage ?? 0) > 0).length,
      outside: busts.filter(b => !b.inside).length, unfinished: busts.filter(b => b.damage === null).length,
    });
  }
  return out;
}
const PROLOGUE_BUST_HEAD = ['Откуда', 'Переборов', 'В круге при «lit»', 'Вышли до взрыва', 'Выход, мед.', 'Ранены', 'Вне круга при «lit»', 'Комната кончилась в фитиле'];
const PROLOGUE_BUST_LEGEND = 'Урок перебора (задача 24, с 15.10.2026; `PrologueRoomTally.busts` комнаты 8): каждый показательный перебор — горящий идол второго рывка, все попытки. «В круге при «lit»» — тело героя касалось круга, когда идол загорелся; «вышли до взрыва» — были в круге при «lit», вне его при взрыве и без урона; «выход» — игровые секунды от «lit» до кадра последнего выхода (точность — кадр вида); «ранены» — взрыв снял HP. Записи до 15.10.2026 — «—».';
function prologueBustSection(records: readonly RtRecord[]): string {
  const stats = prologueBustStats(records);
  if (!stats.length) return `${PROLOGUE_BUST_LEGEND}\n\n—`;
  return [PROLOGUE_BUST_LEGEND, '', table(PROLOGUE_BUST_HEAD, stats.map(s => [
    PROLOGUE_FROM_TITLES[s.from], s.busts, `${s.insideAtLit} (${pct(s.insideAtLit, s.busts)})`, `${s.left} (${pct(s.left, s.insideAtLit)})`,
    s.outMedian === null ? '—' : `${n1(s.outMedian)} с`, `${s.hurt} (${pct(s.hurt, s.busts)})`, s.outside, s.unfinished,
  ]))].join('\n');
}
// ---- end the prologue ----

// ---- Consumables per run (12.10.2026) ----

/** Gained / used / left of one run in one cell group: a kind, or all kinds together (`kind` absent). */
export interface ItemTriple { gained: number; used: number; left: number }
export interface RunItemStats {
  /** The runs with `RunRecord.items`, in the order given, each with its triple per kind and in all. */
  rows: { run: RunRecord; byKind: Record<string, ItemTriple>; all: ItemTriple }[];
  /** Runs whose record has no `items` (records before 12.10.2026): left out of the totals and medians. */
  noData: number;
  total: { byKind: Record<string, ItemTriple>; all: ItemTriple };
  /** The median over the runs with data, each number on its own (the three medians need not add up). */
  median: { byKind: Record<string, ItemTriple>; all: ItemTriple };
}
export function runItemStats(runs: readonly RunRecord[]): RunItemStats {
  const sum = (t: readonly ItemTriple[]): ItemTriple => ({ gained: t.reduce((a, x) => a + x.gained, 0), used: t.reduce((a, x) => a + x.used, 0), left: t.reduce((a, x) => a + x.left, 0) });
  const mid = (t: readonly ItemTriple[]): ItemTriple => t.length ? ({ gained: median(t.map(x => x.gained)), used: median(t.map(x => x.used)), left: median(t.map(x => x.left)) }) : { gained: 0, used: 0, left: 0 };
  const rows = runs.filter(r => r.items).map(run => {
    const it = run.items!, byKind: Record<string, ItemTriple> = {};
    for (const k of SLOT_ITEMS) byKind[k] = { gained: it.gained[k] ?? 0, used: it.used[k] ?? 0, left: it.left[k] ?? 0 };
    return { run, byKind, all: sum(Object.values(byKind)) };
  });
  const per = (f: (t: readonly ItemTriple[]) => ItemTriple): RunItemStats['total'] => ({
    byKind: Object.fromEntries(SLOT_ITEMS.map(k => [k, f(rows.map(r => r.byKind[k]))])), all: f(rows.map(r => r.all)),
  });
  return { rows, noData: runs.length - rows.length, total: per(sum), median: per(mid) };
}
const ITEM_RUN_HEAD = ['Поход', 'Итог', ...SLOT_ITEMS.map(k => ITEM_TITLES[k]), 'Всего'];
const ITEM_RUN_LEGEND = 'Расходники по походам (`RunRecord.items`, с 12.10.2026): в каждой ячейке «получено / использовано / осталось». Получено — попало в руку (дар, находка, покупка, событие, подобрано в бою); использовано — ушло из руки (в бою, цена события); осталось — в руке в конце (у проигравшего похода — в конце проигранного боя; у открытого — сейчас). Медиана — по походам с данными, каждое из трёх чисел отдельно. Цель — увидеть, копят ли лечение: много «осталось» у лечения в конце похода значит, что его не тратят (эвристика, не оценка баланса).';
function itemRunTable(runs: readonly RunRecord[]): string {
  const st = runItemStats(runs), cell3 = (t: ItemTriple): string => `${n1(t.gained)} / ${n1(t.used)} / ${n1(t.left)}`;
  const row = (label: string, outcome: string, p: { byKind: Record<string, ItemTriple>; all: ItemTriple }) => [label, outcome, ...SLOT_ITEMS.map(k => cell3(p.byKind[k])), cell3(p.all)];
  const rows = st.rows.length ? [
    ...st.rows.map(r => row(`\`${r.run.run}\``, OUTCOME_TITLES[r.run.outcome] ?? r.run.outcome, r)),
    row('**всего**', `походов: ${st.rows.length}`, st.total), row('**медиана**', '', st.median),
  ] : [];
  return [
    ITEM_RUN_LEGEND, '', table(ITEM_RUN_HEAD, rows),
    ...st.noData ? ['', `Нет данных (записи до 12.10.2026), походов: ${st.noData}; в «всего» и в медиану они не входят.`] : [],
  ].join('\n');
}
// ---- end consumables per run ----

function itemsSection(runs: readonly RunRecord[], entries: readonly FightEntry[]): string {
  const rows = new Map<string, { kinds: Set<string>; offered: number; taken: number; refused: number; fired: number; fights: number; active: number }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { kinds: new Set(), offered: 0, taken: 0, refused: 0, fired: 0, fights: 0, active: 0 }).get(id)!;
  for (const run of runs) for (const c of run.choices) {
    // Casino «Ставка клятвы»: the node card's oaths have a section of their own.
    if (c.source === OATH_STAKE_SOURCE || c.source === DIE_SOURCE || c.source === CASINO_SOURCE) continue;
    for (const id of c.offered) { const r = row(id); r.offered++; r.kinds.add(c.source); }
    for (const id of c.taken) { const r = row(id); r.taken++; r.kinds.add(c.source); }
    for (const id of c.refused) { const r = row(id); r.refused++; r.kinds.add(c.source); }
  }
  const used: Record<string, number> = {};
  for (const e of entries) {
    const s = e.analysis?.summary;
    if (!s) continue;
    for (const [id, n] of Object.entries(s.build.fired)) { const r = row(id); r.fired += n; r.fights++; }
    for (const id of s.build.active) row(id).active++;
    for (const [k, n] of Object.entries(s.abilities.items)) bump(used, k, n);
  }
  const list = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, r]) => [
    `\`${id}\``, [...r.kinds].join(', ') || '—', r.offered, r.taken, r.refused,
    r.fired ? `${r.fired} (в ${r.fights} боях)` : r.active ? `действует (${r.active} боёв)` : '—',
  ]);
  const usedRows = Object.entries(used).map(([k, n]) => [k, n]);
  return [
    'Предложен / взят / отказ — из выборов походов; «сработал» — события сборки в повторе боёв (`talismanFired`, молот, оберег);',
    '«действует» — постоянный модификатор без срабатываний (число боёв, где он был в сборке).', '',
    table(['Предмет', 'Выбор', 'Предложен', 'Взят', 'Отказ', 'Сработал'], list), '',
    '### Расходники в боях', '', table(['Расходник', 'Использован'], usedRows), '',
    '### Расходники по походам', '', itemRunTable(runs),
    '', '### Рука полна (задача 41)', '', handFullLines(runs),
  ].join('\n');
}

/**
 * Task 41 «Три зелья»: the runs with the cap of healing potions (`RunRecord.potionCap`) — the healing refused for a full hand
 * (`items.capRefused`: refused choices and a reward's excess) and the healing loot left on the floor of their fights (`items.floorLeft`).
 */
export function handFullLines(runs: readonly RunRecord[]): string {
  const capped = runs.filter(r => r.potionCap);
  if (!capped.length) return 'Походов с пределом зелий нет (`RunRecord.potionCap`, с 16.10.2026).';
  const refused = capped.map(r => r.items?.capRefused ?? 0), floor = capped.map(r => r.items?.floorLeft ?? 0);
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  return [
    `Походов с пределом зелий: ${capped.length} (предел ${[...new Set(capped.map(r => r.potionCap))].join(', ')}).`,
    `Отказов «Рука полна» (выбор лечения, показанный недоступным, и лишнее зелье награды): ${sum(refused)}, в ${refused.filter(n => n > 0).length} походах.`,
    `Зелий не подобрано в бою (рука полна, лежали до конца боя): ${sum(floor)}, в ${floor.filter(n => n > 0).length} походах.`,
  ].join('\n');
}

/**
 * Task 44 «Сплавы» (`RunRecord.fusions`, from 16.10.2026): of the runs with the flag — those with a pair collected, with a fusion made,
 * the rows of the fusions, the rests closed with a pair ready, and the victories with a fusion and without.
 */
export function fusionsSection(runs: readonly RunRecord[], entries: readonly FightEntry[] = []): string {
  const on = runs.filter(r => r.fusions);
  if (!on.length) return 'Походов со сплавами нет (`RunRecord.fusions`, с 16.10.2026).';
  const share = (n: number): string => `${n} из ${on.length} (${Math.round(n / on.length * 100)} %)`;
  const paired = on.filter(r => r.fusions!.paired.length), made = on.filter(r => r.fusions!.made.length);
  const rows = made.flatMap(r => r.fusions!.made.map(m => `${m.fusion} — ряд ${m.row}`));
  const won = (list: readonly RunRecord[]): string => `${list.filter(r => r.outcome === 'victory').length} из ${list.length}`;
  const declined = on.reduce((n, r) => n + r.fusions!.declined.length, 0);
  const firsts = on.filter(r => r.viewerRun === 1);
  const bodies = ['fusion-brand', 'fusion-hunter-blast', 'fusion-frost-wave'].flatMap(id => {
    const fights = entries.flatMap(e => (e.analysis?.summary && e.analysis.summary.build.active.includes(id) ? [e.analysis.summary] : []));
    if (!fights.length) return [];
    const n = fights.reduce((sum, s) => sum + (s.build.fusionBodies?.[id] ?? 0), 0);
    return [`${id} — ${(n / fights.length).toFixed(1)} (${fights.length} боёв)`];
  });
  return [
    `Походов со сплавами: ${on.length}. Взята половина рецепта: ${share(on.filter(r => r.fusions!.halves.length).length)}.`,
    `Пара собрана: ${share(paired.length)}. Сплав сделан: ${share(made.length)}.`,
    `Сплавы: ${rows.length ? rows.join('; ') : 'нет'}. Привалов с готовой парой, закрытых лечением или крафтом: ${declined}.`,
    `Победы: со сплавом ${won(made)}, без сплава ${won(on.filter(r => !r.fusions!.made.length))}.`,
    // Task 46: the newcomer's recipe — «Ледяная волна» made in the viewer's first runs.
    `Первые походы зрителя (viewerRun 1): ${firsts.length}, из них с «Ледяной волной» — ${firsts.filter(r => r.fusions!.made.some(m => m.fusion === 'fusion-frost-wave')).length}.`,
    `Тела на бой по сплаву (FightSummary.build.fusionBodies; бои, где сплав в сборке): ${bodies.length ? bodies.join('; ') : 'нет данных'}.`,
  ].join('\n');
}

// ---- Task 50 «Сноровка», «Повадка», «Выборы» (RunRecord.knacks, .habit, .choices; from 16.10.2026) ----

/** The sources of a build choice (`RunChoice.source`): the talisman screens, the Jailer's, the chest, the feat, the knack screen. */
const BUILD_CHOICE_SOURCES: readonly string[] = ['talisman', 'oath', 'form', 'hammer', 'chest', 'feat', 'knack'];

/**
 * Task 50 «Сноровка» (`RunRecord.knacks`): of the runs with the flag — the screens a run, the share of «Ранг II», «Новый» and
 * «Пропустить», the median of the screen's real seconds (design's aim: at most 5 s).
 */
export function knacksSection(runs: readonly RunRecord[]): string {
  const on = runs.filter(r => r.knacksOn);
  if (!on.length) return 'Походов со «Сноровкой» нет (`RunRecord.knacksOn`, с 16.10.2026).';
  const screens = on.flatMap(r => r.knacks ?? []), per = on.map(r => r.knacks?.length ?? 0);
  const hone = screens.filter(s => s.taken?.hone).length, fresh = screens.filter(s => s.taken && !s.taken.hone).length, skip = screens.filter(s => !s.taken).length;
  const seconds = screens.flatMap(s => (s.realSeconds !== undefined ? [s.realSeconds] : []));
  return [
    `Походов со «Сноровкой»: ${on.length}. Экранов: ${screens.length}; за поход — среднее ${n1(per.reduce((a, b) => a + b, 0) / on.length)}, медиана ${n1(median(per))}.`,
    `Выбор: «Ранг II» ${hone} (${pct(hone, screens.length)}), «Новый» ${fresh} (${pct(fresh, screens.length)}), «Пропустить» ${skip} (${pct(skip, screens.length)}).`,
    `Секунды экрана: ${seconds.length ? `медиана ${n1(median(seconds))} (${seconds.length} замеров; цель — не больше 5)` : 'нет замеров'}. Рангов II за поход: ${n1(on.reduce((n, r) => n + (r.honed?.length ?? 0), 0) / on.length)}.`,
  ].join('\n');
}

/**
 * Task 50 «Повадка» (`RunRecord.habit`): of the runs with the archetype row — the share of each archetype and «Без повадки», the share of
 * the items taken with the archetype's tag, the fusions made, the victories and the farthest row by archetype.
 */
export function habitsSection(runs: readonly RunRecord[]): string {
  const on = runs.filter(r => r.habitsOn);
  if (!on.length) return 'Походов с «Повадкой» нет (`RunRecord.habitsOn`, с 16.10.2026).';
  const rows = [...RT_HABITS.map(h => ({ id: h.id as string | undefined, name: h.name })), { id: undefined, name: 'Без повадки' }].map(({ id, name }) => {
    const list = on.filter(r => r.habit === id);
    const taken = list.flatMap(r => r.choices.filter(c => BUILD_CHOICE_SOURCES.includes(c.source)).flatMap(c => c.taken.map(t => t.replace(/:2$/, ''))));
    const tagged = id ? taken.filter(t => rtTalisman(t)?.tags?.includes(id as never)).length : 0;
    const made = list.reduce((n, r) => n + (r.fusions?.made.length ?? 0), 0);
    return [name, `${list.length} (${pct(list.length, on.length)})`, id ? `${tagged} из ${taken.length} (${pct(tagged, taken.length)})` : '—', made,
      `${list.filter(r => r.outcome === 'victory').length} из ${list.length}`, list.length ? n1(median(list.map(r => r.farRow))) : '—'];
  });
  return ['Доля — среди походов с рядом «Повадка»; «с тегом» — взятые предметы выборов сборки (талисманы, Тюремщик, сундук, подвиг, «Сноровка») с тегом повадки.', '',
    table(['Повадка', 'Походов', 'Взято с тегом', 'Сплавов', 'Победы', 'Дальний ряд (медиана)'], rows)].join('\n');
}

// ---- Task 56 «Приметы» (RunRecord.omensOn, .levelOmens, .omenRoutes; FightRecord.omens; FightSummary.omenFired; from 17.10.2026) ----

/**
 * Task 56 «Приметы» (spec 10.1): by omen — the run fights that played it (of the node, of the level), victories, the medians of the
 * damage, the time to the goals and the chain, its counters (`omenFired`; «Сорочье гнездо» — the crystals the chains took); the route —
 * how often a node with the omen was taken where one was open, against its share among the nodes open; the level's omen — runs,
 * victories and the farthest row by it.
 */
export function omensSection(runs: readonly RunRecord[], entries: readonly FightEntry[]): string {
  const on = runs.filter(r => r.omensOn);
  if (!on.length) return 'Походов с приметами нет (`RunRecord.omensOn`, с 17.10.2026).';
  const fightRows = RT_OMENS.map(def => {
    const list = entries.filter(e => e.record.omens?.some(o => o.id === def.id)), done = list.filter(e => e.record.outcome === 'victory' || e.record.outcome === 'defeat');
    const nodeN = list.filter(e => e.record.omens!.some(o => o.id === def.id && o.scope === 'node')).length;
    const sums: Record<string, number> = {};
    for (const e of list) for (const [k, v] of Object.entries(e.record.summary.omenFired ?? {})) if (k.startsWith(`${def.id}:`) && k !== 'drowse:woke') sums[k] = (sums[k] ?? 0) + v;
    if (def.id === 'magpie') sums['magpie:crystal'] = list.reduce((n, e) => n + e.record.summary.chain.crystals, 0);
    const woke = list.flatMap(e => (e.record.summary.omenFired?.['drowse:woke'] !== undefined ? [e.record.summary.omenFired['drowse:woke']] : []));
    if (woke.length) sums['drowse:woke (медиана, с)'] = Number(n1(median(woke)));
    const goals = done.flatMap(e => (e.record.summary.tempo.toGoals !== null ? [e.record.summary.tempo.toGoals] : []));
    return [def.title, `${list.length} (узла ${nodeN})`, `${done.filter(e => e.record.outcome === 'victory').length} из ${done.length}`,
      done.length ? n1(median(done.map(e => e.record.summary.damage.total))) : '—', goals.length ? n1(median(goals)) : '—',
      done.length ? n1(median(done.map(e => e.record.summary.chain.lengthMedian))) : '—', Object.entries(sums).map(([k, v]) => `${k} ${v}`).join(', ') || '—'];
  });
  const routes = on.flatMap(r => r.omenRoutes ?? []);
  const routeRows = RT_OMENS.filter(def => def.where === 'fight').map(def => {
    const with_ = routes.filter(route => route.offered.some(o => o.omen === def.id));
    const chosen = with_.filter(route => route.offered.find(o => o.nodeId === route.chosen)?.omen === def.id).length;
    const share = with_.reduce((n, route) => n + route.offered.filter(o => o.omen === def.id).length / route.offered.length, 0);
    return [def.title, with_.length, with_.length ? `${chosen} (${pct(chosen, with_.length)})` : '—', with_.length ? `${Math.round(100 * share / with_.length)}%` : '—'];
  }).filter(row => row[1] !== 0);
  const levelRows = RT_OMENS.map(def => {
    const list = on.filter(r => r.levelOmens?.some(l => l.id === def.id));
    return [def.title, list.length, `${list.filter(r => r.outcome === 'victory').length} из ${list.length}`, list.length ? n1(median(list.map(r => r.farRow))) : '—'];
  }).filter(row => row[1] !== 0);
  const crossroads = on.reduce((n, r) => n + (r.crossroadsSteps ?? 0), 0), fair = on.reduce((n, r) => n + (r.fairRerolls ?? 0), 0);
  return ['Бои походов с приметой (узла или уровня). «Счётчики» — `summary.omenFired`; «Сорочье гнездо» — кристаллы, взятые цепями. Эвристика, не оценка баланса.', '',
    table(['Примета', 'Боёв', 'Победы', 'Урон (медиана)', 'До целей, с (медиана)', 'Цепь (медиана)', 'Счётчики'], fightRows), '',
    'Маршрут: выборы пути, где среди открытых узлов была примета (`omenRoutes`); «взят» — узел с этой приметой; «доля среди открытых» — средняя доля таких узлов. Взят чаще доли — игрок идёт к примете, реже — обходит.', '',
    routeRows.length ? table(['Примета', 'Выборов с ней', 'Взят узел с ней', 'Доля среди открытых'], routeRows) : '_выборов с приметой нет_', '',
    levelRows.length ? table(['Примета уровня', 'Походов', 'Победы', 'Дальний ряд (медиана)'], levelRows) : '_приметы уровня нет_', '',
    `Шагов вне связей «Перепутья»: ${crossroads}. Бесплатных перебросов «Ярмарочного дня»: ${fair}.`].join('\n');
}

// ---- Task 49 «Второй герой» (RunRecord.hero, .freed; FightSummary.damage.unshielded; from 16.10.2026) ----

/**
 * Task 49 «Герои» (spec 12.1): by hero (the cat — runs without `hero`) — runs, victories, the farthest row, the median chain length of
 * its run fights, seals a fight, the share of empty seals, the share of kills by the seal, Ведунья's `damage.unshielded` (hits a fight
 * where the cat would stand shielded); the share of runs with Ведунья after the first run that freed her (records in time order).
 */
export function heroesSection(runs: readonly RunRecord[], entries: readonly FightEntry[] = []): string {
  if (!runs.length) return '_походов нет_';
  const heroes: { id: 'cat' | 'toad'; name: string }[] = [{ id: 'cat', name: 'Кот' }, { id: 'toad', name: 'Ведунья' }];
  const rows = heroes.map(({ id, name }) => {
    const list = runs.filter(r => (r.hero ?? 'cat') === id), keys = new Set(list.map(r => r.run));
    const fights = entries.flatMap(e => (e.analysis?.summary && keys.has(e.record.run) ? [e.analysis.summary] : []));
    const seals = fights.reduce((n, f) => n + f.chain.seals, 0), empty = fights.reduce((n, f) => n + f.chain.sealsEmpty, 0);
    const sealKills = fights.reduce((n, f) => n + (f.kills.tools.seal ?? 0), 0), kills = fights.reduce((n, f) => n + f.kills.chain + Object.values(f.kills.tools).reduce((a, b) => a + b, 0), 0);
    const bare = fights.filter(f => f.damage.unshielded), bareHits = bare.reduce((n, f) => n + f.damage.unshielded!.hits, 0);
    return [name, list.length, `${list.filter(r => r.outcome === 'victory').length} из ${list.length}`, list.length ? Math.max(...list.map(r => r.farRow)) : '—',
      fights.length ? n1(median(fights.map(f => f.chain.lengthMedian))) : '—', fights.length ? n1(seals / fights.length) : '—', seals ? pct(empty, seals) : '—',
      kills ? pct(sealKills, kills) : '—', bare.length ? n1(bareHits / bare.length) : '—'];
  });
  const ordered = [...runs].sort((a, b) => a.at.localeCompare(b.at)), first = ordered.findIndex(r => r.freed);
  const after = first < 0 ? [] : ordered.slice(first + 1), chose = after.filter(r => r.hero === 'toad').length;
  return ['Бои — бои походов этого героя с повтором журнала. «Без щита» — удары по Ведунье за длину щита цепи после открытой цепи с нужными убийствами (`damage.unshielded`), за бой.', '',
    table(['Герой', 'Походов', 'Победы', 'Дальний ряд', 'Длина цепи (медиана)', 'Печатей за бой', 'Пустых печатей', 'Убийств печатью', 'Без щита за бой'], rows), '',
    first < 0 ? 'Спасения Ведуньи в записях нет (`RunRecord.freed`).' : `После спасения (поход ${ordered[first].run}): походов ${after.length}, из них Ведуньей ${chose} (${pct(chose, after.length)}).`].join('\n');
}

/** Task 58 «Летопись»: the pages' titles of the report. */
const CHRONICLE_PAGE_TITLES: Readonly<Record<string, string>> = { bestiary: 'Бестиарий', bosses: 'Боссы', events: 'События', items: 'Талисманы и формы', heroes: 'Герои', hearth: 'Очаг' };
const CHRONICLE_BUCKETS: readonly { title: string; from: number; to: number }[] = [{ title: '1–3', from: 1, to: 3 }, { title: '4–10', from: 4, to: 10 }, { title: '11–20', from: 11, to: 20 }, { title: '21+', from: 21, to: Infinity }];
/** The first finds the section follows: the ref's predicate. */
const CHRONICLE_FIRSTS: readonly { title: string; is: (ref: string) => boolean }[] = [
  { title: 'глава «Гарнизон»', is: ref => ref === 'chapter:garrison' },
  { title: 'первый сплав', is: ref => ref.startsWith('item:fusion-') },
  { title: 'Тролль', is: ref => ref === 'boss:troll' },
  { title: 'Кастелян', is: ref => ref === 'boss:castellan' },
];
/**
 * Task 58 «Летопись» (`RunRecord.chronicle`, `chronicleOpen`, `hint`; docs/design-notes/task-58-discovery.md, section 10): the share of
 * each page written by the viewer's run, the viewer's run of the first finds, the window opened after a run, the hint followed by the next
 * run of the session (heuristic: the session stands for the viewer), the items seen and not taken.
 */
export function chronicleSection(runs: readonly RunRecord[]): string {
  const list = runs.filter(r => r.chronicle);
  if (!list.length) return '_походов с Летописью нет_';
  const pages = Object.keys(CHRONICLE_PAGE_TITLES);
  const rows = CHRONICLE_BUCKETS.map(b => {
    const inside = list.filter(r => r.viewerRun !== undefined && r.viewerRun >= b.from && r.viewerRun <= b.to);
    return [b.title, inside.length, ...pages.map(id => {
      const shares = inside.flatMap(r => { const p = r.chronicle!.pages[id]; return p && p[1] ? [p[0] / p[1]] : []; });
      return shares.length ? `${Math.round(100 * median(shares))}%` : '—';
    })];
  });
  const firsts = CHRONICLE_FIRSTS.map(f => {
    const at = list.filter(r => r.viewerRun !== undefined && r.chronicle!.added.some(f.is)).map(r => r.viewerRun!);
    return `${f.title} — ${at.length ? `медиана ${n1(median(at))} (записей ${at.length})` : 'нет'}`;
  });
  const opened = list.filter(r => r.chronicleOpen?.length), withNew = list.filter(r => r.chronicle!.added.length);
  const bySession = new Map<string, RunRecord[]>();
  for (const r of [...list].sort((a, b) => a.at.localeCompare(b.at))) bySession.set(r.session, [...bySession.get(r.session) ?? [], r]);
  let hinted = 0, followed = 0;
  for (const own of bySession.values()) own.forEach((r, i) => { if (!r.hint || i + 1 >= own.length) return; hinted++; if (own[i + 1].chronicle!.added.includes(r.hint.target)) followed++; });
  const latest = [...bySession.values()].map(own => own[own.length - 1].chronicle!).filter(c => c.seenItems !== undefined && c.pages.items);
  const seenShare = latest.map(c => { const all = c.seenItems! + c.pages.items![0]; return all ? c.seenItems! / all : 0; });
  return ['Доля записанного — медиана `have / known` страницы (видимые главы) у походов с этим номером похода зрителя. Эвристика до плейтеста: Летопись открывают < 15 % визитов — её не видно или она скучна; подсказке следуют < 10 % — тексты пустые, > 70 % — подсказка ведёт маршрут.', '',
    table(['Походы зрителя', 'Походов', ...pages.map(id => CHRONICLE_PAGE_TITLES[id])], rows), '',
    `Первые находки (номер похода зрителя): ${firsts.join('; ')}.`, '',
    `Окно «Летопись» после похода: открыто ${pct(opened.length, list.length)} визитов (${opened.length} из ${list.length}); после похода с новыми записями («✦») — ${pct(withNew.filter(r => r.chronicleOpen?.length).length, withNew.length)}.`, '',
    `Подсказка Неясыти: показана после ${list.filter(r => r.hint).length} походов; следующий поход той же сессии записал её цель — ${pct(followed, hinted)} (${followed} из ${hinted}).`, '',
    `Предметы «видел, не взял» (последний поход сессии): ${seenShare.length ? `медиана ${pct(Math.round(100 * median(seenShare)), 100)} от видевших и взятых` : 'нет данных'}.`].join('\n');
}

/** Task 51е «Трофеи»: the trophies' titles of the report (the perch's order). */
const TROPHY_TITLES: readonly [string, string][] = [['jailer', 'Гиря Тюремщика'], ['severed', 'Обрубок цепи'], ['troll', 'Рог Тролля'], ['chief', 'Котелок Главаря'], ['shackles', 'Сломанные кандалы'],
  ['castellan', 'Знамя Кастеляна'], ['ash', 'Доска Испытания'], ['bestiary', 'Чернильница Неясыти'], ['long-chain', 'Длинная цепь']];
/**
 * Task 51е «Трофеи» (`RunRecord.trophies`; docs/design-notes/task-51-camp-l3.md, section 10): each trophy — the runs that earned it and
 * the viewer's run number (median, the earliest); «Доска Испытания» — its marks by step. The retro (run 0) is not a run: not counted.
 */
export function trophiesSection(runs: readonly RunRecord[]): string {
  const list = runs.filter(r => r.trophies?.length);
  if (!list.length) return '_походов с трофеями нет_';
  const rows = TROPHY_TITLES.map(([id, title]) => {
    const got = list.filter(r => r.trophies!.some(t => t === id || (id === 'ash' && t.startsWith('ash:'))));
    const at = got.flatMap(r => (r.viewerRun !== undefined ? [r.viewerRun] : []));
    return [title, got.length, at.length ? n1(median(at)) : '—', at.length ? Math.min(...at) : '—'];
  });
  const marks = list.flatMap(r => r.trophies!.filter(t => t.startsWith('ash:')).map(t => t.slice(4)));
  return ['Трофей — сколько походов его заработали и номер похода зрителя (медиана, самый ранний). Ретро (поход 0) — не поход, здесь не считается.', '',
    table(['Трофей', 'Походов', 'Поход зрителя (медиана)', 'Самый ранний'], rows), '',
    `Засечки «Доски Испытания» по ступеням: ${marks.length ? [...new Set(marks)].sort((a, b) => Number(a) - Number(b)).map(m => `${m} — ${marks.filter(x => x === m).length}`).join('; ') : 'нет'}.`].join('\n');
}

/** Task 50 «Выборы»: build choices a run (`RunRecord.choices` of `BUILD_CHOICE_SOURCES`), all of them and the knack screen's apart. */
export function choicesSection(runs: readonly RunRecord[]): string {
  if (!runs.length) return '_походов нет_';
  const all = runs.map(r => r.choices.filter(c => BUILD_CHOICE_SOURCES.includes(c.source) && c.offered.length).length);
  const knack = runs.map(r => r.choices.filter(c => c.source === 'knack' && c.offered.length).length);
  return `Выборов сборки за поход: среднее ${n1(all.reduce((a, b) => a + b, 0) / runs.length)}, медиана ${n1(median(all))}; из них «Сноровка» — среднее ${n1(knack.reduce((a, b) => a + b, 0) / runs.length)} (походов: ${runs.length}).`;
}

// ---- Task 51з «Поход дня» (RunRecord.daily, from 17.10.2026) ----

/** Task 51з: the runs of the day by date — attempts, the first attempt's farthest row against the best one's, the share verified. */
export function dailySection(runs: readonly RunRecord[]): string {
  const days = new Map<string, RunRecord[]>();
  for (const r of runs) if (r.daily) days.set(r.daily.date, [...days.get(r.daily.date) ?? [], r]);
  if (!days.size) return 'Походов дня нет (`RunRecord.daily`, с 17.10.2026).';
  const rows = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => {
    const first = list.find(r => r.daily!.first), best = Math.max(...list.map(r => r.farRow));
    return [date, Math.max(...list.map(r => r.daily!.attempt)), first ? first.farRow : '—', best, `${list.filter(r => r.daily!.verified).length} из ${list.length}`];
  });
  return ['Попытки — наибольший номер попытки даты среди записей; ряд — дальний ряд похода (`farRow`); проверено — доказательство прошло повтор.', '',
    table(['Дата', 'Попыток', 'Первая: ряд', 'Лучшая: ряд', 'Проверено'], rows)].join('\n');
}

// ---- Task 20 «Ресурсы похода» (RunRecord.resources, from 14.10.2026) ----
const RESOURCE_SOURCE_TITLES: Record<string, string> = { gift: 'дар', event: 'события', casino: 'игорный круг', loot: 'добыча элит', bag: 'котомка', feat: 'подвиги', merchant: 'торговец', other: 'прочее' };
const RESOURCE_SINK_TITLES: Record<string, string> = { craft: 'крафт', healMap: 'лечение на карте', merchant: 'торговец', event: 'события', casino: 'игорный круг', reroll: 'переброс', cart: 'Повозка', other: 'прочее' };
/** Start, gained, spent, end of one kind (or of all kinds together). */
export interface ResourceTally { start: number; gained: number; spent: number; end: number }
/** One run with `resources`: by source and sink (all kinds together), by kind, and whether every kind adds up. */
export interface RunResourceRow { run: RunRecord; all: ResourceTally; bySource: Record<string, number>; bySink: Record<string, number>; byKind: Record<string, ResourceTally>; balanced: boolean; late: boolean }
export interface RunResourceStats { rows: RunResourceRow[]; noData: RunRecord[]; total: Omit<RunResourceRow, 'run' | 'late'> }
const sumValues = (m: Record<string, number> | undefined): number => Object.values(m ?? {}).reduce((a, b) => a + b, 0);
export function runResourceStats(runs: readonly RunRecord[]): RunResourceStats {
  const kinds = [...RESOURCE_KINDS] as string[];
  const rows = runs.filter(r => r.resources).map((run): RunResourceRow => {
    const res = run.resources!, bySource: Record<string, number> = {}, bySink: Record<string, number> = {}, byKind: Record<string, ResourceTally> = {};
    for (const [k, m] of Object.entries(res.gained)) bySource[k] = sumValues(m);
    for (const [k, m] of Object.entries(res.spent)) bySink[k] = sumValues(m);
    for (const kind of new Set([...kinds, ...Object.keys(res.start), ...Object.keys(res.end)])) {
      byKind[kind] = { start: res.start[kind] ?? 0, end: res.end[kind] ?? 0, gained: Object.values(res.gained).reduce((a, m) => a + (m?.[kind] ?? 0), 0), spent: Object.values(res.spent).reduce((a, m) => a + (m?.[kind] ?? 0), 0) };
    }
    const all = Object.values(byKind).reduce<ResourceTally>((a, t) => ({ start: a.start + t.start, gained: a.gained + t.gained, spent: a.spent + t.spent, end: a.end + t.end }), { start: 0, gained: 0, spent: 0, end: 0 });
    return { run, all, bySource, bySink, byKind, balanced: Object.values(byKind).every(t => t.start + t.gained - t.spent === t.end), late: !!res.late };
  });
  const add = (a: Record<string, number>, b: Record<string, number>): void => { for (const [k, n] of Object.entries(b)) bump(a, k, n); };
  const total: RunResourceStats['total'] = { all: { start: 0, gained: 0, spent: 0, end: 0 }, bySource: {}, bySink: {}, byKind: {}, balanced: rows.every(r => r.balanced) };
  for (const r of rows) {
    for (const key of ['start', 'gained', 'spent', 'end'] as const) total.all[key] += r.all[key];
    add(total.bySource, r.bySource); add(total.bySink, r.bySink);
    for (const [kind, t] of Object.entries(r.byKind)) { const o = total.byKind[kind] ??= { start: 0, gained: 0, spent: 0, end: 0 }; for (const key of ['start', 'gained', 'spent', 'end'] as const) o[key] += t[key]; }
  }
  return { rows, noData: runs.filter(r => !r.resources), total };
}
const flowCell = (total: number, by: Record<string, number>, titles: Record<string, string>): string => {
  const parts = [...Object.keys(titles).filter(k => by[k]), ...Object.keys(by).filter(k => by[k] && !(k in titles))].map(k => `${titles[k] ?? k} ${by[k]}`);
  return parts.length ? `${total}: ${parts.join(', ')}` : String(total);
};
const RESOURCE_LEGEND = 'Ресурсы крафта похода (задача 20, с 14.10.2026; `RunRecord.resources`): на старте, получено по источникам, потрачено по стокам, осталось. Источники: дар на старте, события, игорный круг, добыча элит (подобрано в бою), котомка у двери, подвиги, торговец, прочее; стоки: крафт на привале, лечение на карте, торговец, события, игорный круг, переброс талисманов, прочее. Каждый шаг похода разносит изменение ресурсов по видам: что называют события шага и выигранный бой (подвиг, лечение, переброс, выигрыш круга, добыча, котомка), а остаток — на экран шага (событие, круг, торговец, привал, дар); остальное — «прочее». У событий и торговца это нетто за шаг, не валовый счёт: цена и награда одного шага взаимно гасятся. «Сходится» — старт + получено − потрачено = остаток по каждому виду. «С середины» — счёт начат не со старта (поход начат до записи поля). Записи до 14.10.2026 — «—». Сундук «Заставы» платит талисманами, а не ресурсами: отдельного источника нет.';
function resourcesSection(runs: readonly RunRecord[]): string {
  if (!runs.length) return '_походов нет_';
  const st = runResourceStats(runs), dash = '—';
  const row = (label: string, outcome: string, r: Omit<RunResourceRow, 'run' | 'late'>, late = false) => [
    label, outcome, `${r.all.start}${late ? ' (с середины)' : ''}`, flowCell(r.all.gained, r.bySource, RESOURCE_SOURCE_TITLES), flowCell(r.all.spent, r.bySink, RESOURCE_SINK_TITLES), r.all.end, r.balanced ? 'да' : 'НЕТ',
  ];
  const rows = [
    ...runs.map(run => { const r = st.rows.find(x => x.run === run); return r ? row(`\`${run.run}\``, OUTCOME_TITLES[run.outcome] ?? run.outcome, r, r.late) : [`\`${run.run}\``, OUTCOME_TITLES[run.outcome] ?? run.outcome, dash, dash, dash, dash, dash]; }),
    ...st.rows.length ? [row('**всего**', `походов: ${st.rows.length}`, st.total)] : [],
  ];
  const kinds = st.rows.length ? table(['Вид', 'Старт', 'Получено', 'Потрачено', 'Остаток'], Object.entries(st.total.byKind).map(([kind, t]) => [RESOURCES[kind as keyof typeof RESOURCES]?.label ?? kind, t.start, t.gained, t.spent, t.end])) : dash;
  return [RESOURCE_LEGEND, '', table(['Поход', 'Итог', 'Старт', 'Получено', 'Потрачено', 'Остаток', 'Сходится'], rows), '', '### Ресурсы по видам (все походы с данными)', '', kinds].join('\n');
}
// ---- end «Ресурсы похода» ----

function notesSection(analysis: Analysis, source: string): string {
  const notes = [...analysis.fights.flatMap(e => e.notes.map(n => ({ n, fight: true }))), ...analysis.orphanNotes.map(n => ({ n, fight: false }))];
  if (!notes.length) return '_отметок нет_';
  return table(['Бой', 'Поход', 'Арена', 'Такт', 'Герой', 'Разбор'], notes.map(({ n, fight }) => [
    `\`${n.fight}\``, n.run, arenaTitle(n.arena), n.tick, `(${n1(n.hero.x)}; ${n1(n.hero.y)})`,
    fight ? `\`npm run realtime:report -- ${source} --at ${n.session}/${n.run}/${n.fight} ${n.tick}\`` : 'нет записи боя (журнала нет)',
  ]));
}

function runsSection(runs: readonly RunRecord[], entries: readonly FightEntry[]): string {
  if (!runs.length) return '_походов нет_';
  const rows = runs.map(r => {
    const d = r.death;
    const death = d ? `${killerTitle(d)}${d.fight ? ` — \`${d.fight}\`${d.tick !== undefined ? `, такт ${d.tick}` : ''}` : ''}` : '—';
    const fights = entries.filter(e => e.record.run === r.run).length;
    return [`\`${r.run}\``, r.session, r.tester ?? '—', r.seed, OUTCOME_TITLES[r.outcome] ?? r.outcome, r.farRow, death, fights, r.nodes.map(n => `${n.nodeId} ${n.hpIn}→${n.hpOut}`).join(', ') || '—'];
  });
  const choices = runs.flatMap(r => r.choices.map(c => [`\`${r.run}\``, c.nodeId, c.source, c.offered.join(', ') || '—', c.taken.join(', ') || '—', c.refused.join(', ') || '—']));
  const kits = runs.map(r => `- \`${r.run}\`: HP ${r.kit.hp}/${r.kit.maxHp}; талисманы ${r.kit.talismans.join(', ') || 'нет'}; молот ${r.kit.hammer ?? 'нет'}`);
  return [
    table(['Поход', 'Сессия', 'Тестер', 'Seed', 'Итог', 'Дальний ряд', 'Причина смерти', 'Боёв в логах', 'HP по узлам'], rows), '',
    '### Выборы', '', table(['Поход', 'Узел', 'Что', 'Предложено', 'Взято', 'Отказ'], choices), '',
    '### Сборка в конце', '', kits.join('\n'), '',
    '### Лечение на карте', '', mapHealLines(runs),
  ].join('\n');
}

/** Task 15 «Лечение на карте» (from 14.10.2026): the map heals bought (`RunRecord.mapHeals`) — the total line and one line a run. */
function mapHealLines(runs: readonly RunRecord[]): string {
  const own = runs.filter(r => r.mapHeals?.length), heals = own.flatMap(r => r.mapHeals!);
  const legend = 'Задача 15 (с 14.10.2026): +2 HP на карте между боями за ресурсы (2, 3, 4…). Ряд — последнего пройденного узла (0 — до первого).';
  if (!heals.length) return `${legend}\n\n_покупок нет_`;
  const head = `Покупок ${heals.length} в ${own.length} из ${runs.length} походов; цена мед. ${n1(median(heals.map(h => h.price)))}; HP до мед. ${n1(median(heals.map(h => h.hpBefore)))}.`;
  const lines = own.map(r => `- \`${r.run}\`: ${r.mapHeals!.map(h => `ряд ${h.row}, ${h.price} рес., HP ${h.hpBefore}→${h.hpAfter}`).join('; ')}`);
  return [legend, '', head, '', ...lines].join('\n');
}

function arenasSection(entries: readonly FightEntry[]): string {
  const by = new Map<string, FightEntry[]>();
  for (const e of entries) (by.get(e.record.arena) ?? by.set(e.record.arena, []).get(e.record.arena)!).push(e);
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([arena, list]) => {
    const done = list.filter(e => e.analysis), avg = (f: (e: FightEntry) => number): string => (done.length ? n1(done.reduce((s, e) => s + f(e), 0) / done.length) : '—');
    const goals = done.map(e => e.analysis!.summary.tempo.toGoals).filter((x): x is number => x !== null);
    return [
      arenaTitle(arena), list.length, list.filter(e => e.record.outcome === 'victory').length, list.filter(e => e.record.outcome === 'defeat').length,
      avg(e => e.record.time), avg(e => e.analysis!.summary.damage.total), avg(e => e.analysis!.summary.chain.count), avg(e => e.analysis!.summary.kills.chain),
      goals.length ? n1(goals.reduce((s, x) => s + x, 0) / goals.length) : '—', done.length ? `${avg(e => e.analysis!.summary.tempo.enemies.avg)} / ${Math.max(...done.map(e => e.analysis!.summary.tempo.enemies.max))}` : '—',
      avg(e => e.analysis!.summary.movement.path), avg(e => e.analysis!.summary.movement.idle),
      ...chainShareCells(done.map(e => e.analysis!.summary)), ...loopCells(done.map(e => e.analysis!.summary)),
    ];
  });
  return table(['Арена', 'Боёв', 'Побед', 'Поражений', 'Время ср., с', 'Урон ср.', 'Цепей ср.', 'Убито цепью ср.', 'До целей ср., с', 'Врагов ср. / макс.', 'Путь ср.', 'На месте ср., с', ...CHAIN_SHARE_HEAD, ...LOOP_HEAD], rows);
}

export interface ReportOptions {
  /** When the report is made (the header; the CLI passes now). */
  now: Date;
  /** The sources as given on the command line (the header and the `--at` hints). */
  source: string;
}

/** The whole report. */
export function reportMarkdown(set: RecordSet, analysis: Analysis, options: ReportOptions): string {
  const fights = analysis.fights;
  const runs = latestRuns(set.records).sort((a, b) => a.id.localeCompare(b.id));
  const runFights = fights.filter(e => e.record.run !== SANDBOX_RUN), sandbox = fights.filter(e => e.record.run === SANDBOX_RUN);
  const notes = fights.reduce((s, e) => s + e.notes.length, 0) + analysis.orphanNotes.length;
  const bad = fights.filter(e => e.hashOk === false && !e.panelReset), reset = fights.filter(e => e.panelReset), broken = fights.filter(e => e.error), partial = fights.filter(e => e.record.outcome === 'unload');
  const diffs = fights.filter(e => e.summaryDiff.length);
  const out: string[] = [
    '# Отчёт плейтеста реального времени', '',
    `Собран ${options.now.toISOString()}. Источник: \`${options.source}\`. Записей: ${set.records.length} (дублей убрано: ${set.duplicates}). Походов: ${runs.length}, боёв: ${fights.length} (песочница: ${sandbox.length}), отметок: ${notes}.`,
    'Метрики посчитаны повтором журналов в Node (`src/realtime/telemetry/observe.ts`, `threats.ts`); определения — docs/realtime-telemetry.md, разделы 3, 7 и 8 («ТB»).', '',
    '## Ошибки детерминизма', '',
  ];
  if (!bad.length && !broken.length) out.push(`Нет: все ${fights.length - reset.length} журналов повторились с тем же хэшем${reset.length ? `; ещё ${reset.length} — сброс панели (ниже)` : ''}.`);
  else {
    if (bad.length) out.push('Повтор журнала дал другой хэш, чем записан в бою, — найденная ошибка детерминизма (или журнал испорчен).', '',
      table(['Бой', 'Поход', 'Арена', 'Тактов', 'endHash', 'Хэш повтора'], bad.map(e => [`\`${e.record.fight}\``, e.record.run, arenaTitle(e.record.arena), e.analysis!.ticks, `\`${e.record.endHash}\``, `\`${e.analysis!.hash}\``])), '');
    if (broken.length) out.push('Журналы, которые не удалось собрать или повторить:', '', ...broken.map(e => `- \`${fightPath(e.record)}\`: ${e.error}`), '');
  }
  if (reset.length) out.push('', '### Сброс панели (не ошибка детерминизма)', '', 'Бой песочницы оставлен кнопкой «Сбросить по умолчанию» до правки 15.10.2026 (v56): `endHash` снят со значениями после сброса. Повтор журнала со значениями по умолчанию даёт записанный хэш.', '',
    ...reset.map(e => `- \`${fightPath(e.record)}\`: ${arenaTitle(e.record.arena)}, ${e.record.ticks} тактов, сборка ${e.record.build}`));
  if (set.problems.length) out.push('', '### Записи, которые не прочитаны', '', ...set.problems.map(p => `- ${p}`));
  if (partial.length) out.push('', '### Неполные журналы', '', 'Страница закрылась посреди боя (`outcome: unload`): журнал повторён до своих тактов, метрики — за это время.', '',
    ...partial.map(e => `- \`${fightPath(e.record)}\`: ${e.record.ticks} тактов, ${arenaTitle(e.record.arena)}`));
  if (diffs.length) out.push('', '### Сводка браузера расходится с повтором', '', ...diffs.map(e => `- \`${fightPath(e.record)}\`: ${e.summaryDiff.slice(0, 8).join('; ')}${e.summaryDiff.length > 8 ? ' …' : ''}`));
  out.push('', '## Походы', '', runsSection(runs, fights), '',
    // Task 20: the run's resources.
    '## Ресурсы похода', '', resourcesSection(runs), '',
    // Task 17 «Пологий вход»: the run by its rows.
    '## По рядам', '', ROW_LEGEND, '', rowStats(runs, runFights).length ? table(ROW_HEAD, rowRows(runs, runFights)) : '_боёв походов нет_', '',
    // Task 18 «Испытание I–V»: the runs by level.
    '## Испытание', '', ASH_LEGEND, '', ashStats(runs, runFights).length ? table(ASH_HEAD, ashRows(runs, runFights)) : '_походов нет_', '',
    // Task 26 «Расписание леса»: new living elements a fight by the viewer's run number.
    '## Расписание', '', SCHEDULE_LEGEND, '', table(SCHEDULE_HEAD, scheduleRows(runs)), '',
    // Task 35, С1: the level of «Тряска и вспышки».
    '## Тряска и вспышки', '', FX_LEGEND, '', table(FX_HEAD, fxRows(runs)), '',
    '## Бои походов', '', table(FIGHT_HEAD, fightRows(runFights)), '',
    '## Арены', '', 'Бои походов и песочницы вместе. ' + LOOP_LEGEND, '', arenasSection(fights), '',
    '## Враги', '', damageSections(fights), '',
    // Task 25 «От чего умирают».
    '## От чего умирают', '', deathSection(fights), '',
    // Task 28 «Тюремщик в походе».
    '## Босс', '', bossSection(fights), '',
    // Task 40 «Гарнизон, шаг 1б»: the survival through both levels, the garrison's fights and the cart.
    '## Гарнизон', '', garrisonSection(runs, runFights), '',
    // Task 55в «Замок»: the shoves, the things, the castle's deaths.
    '## Замок', '', castleSection(fights), '',
    // Task 57а «Лес: стрелки».
    '## Лес: новые виды', '', forestShootersSection(fights), '',
    '## Сплавы', '', fusionsSection(runs, fights), '',
    // Task 49 «Второй герой».
    '## Герои', '', heroesSection(runs, runFights), '',
    '## Сноровка', '', knacksSection(runs), '',
    '## Повадка', '', habitsSection(runs), '',
    // Task 56 «Приметы».
    '## Приметы', '', omensSection(runs, runFights), '',
    '## Выборы', '', choicesSection(runs), '',
    '## Поход дня', '', dailySection(runs), '',
    // Task 58 «Летопись».
    '## Летопись', '', chronicleSection(runs), '',
    // Task 51е «Трофеи».
    '## Трофеи', '', trophiesSection(runs), '',
    '## Элиты', '', ELITE_LEGEND, '', table(ELITE_HEAD, eliteRows(runFights, sandbox)), '',
    '## Однорукий гоблин', '', SLOT_LEGEND, '', table(SLOT_HEAD, [slotRow('походы', runFights), slotRow('песочница', sandbox)].filter((r): r is (string | number)[] => !!r)), '',
    // Task 20: how the hero left the lit idol's circle.
    '### Выход из круга', '', BUST_EXIT_LEGEND, '', bustExitTable(runFights, sandbox), '',
    // Casino «Котёл».
    '## Котёл', '', PURSE_LEGEND, '', table(PURSE_HEAD, purseRows(runFights, sandbox)), '',
    // Casino «Ставка клятвы».
    '## Ставка клятвы', '', OATH_LEGEND, '', table(OATH_HEAD, oathRows(runs, fights)), '',
    // К7 «Проклятый сундук».
    '## Проклятый сундук', '', CHEST_LEGEND, '', table(CHEST_HEAD, chestRows(runFights, sandbox)), '',
    // Task 14 «Котомка у двери».
    '## Котомка у двери', '', BAG_LEGEND, '', table(BAG_HEAD, bagRows(runFights, sandbox)), '',
    // Task 16 «Подвиги», the package telemetry: the first meetings and the viewer's run number.
    '## Подвиги', '', FEAT_LEGEND, '', featStats(runFights).length ? table(FEAT_HEAD, featRows(runFights)) : '_боёв с подвигом нет_', '', featRewardLine(runs), '',
    '### Подвиги по рядам', '', featStats(runFights).length ? table([FEAT_HEAD[0], 'Ряд', ...FEAT_HEAD.slice(1)], featRows(runFights, true)) : '_боёв с подвигом нет_', '',
    '## Новизна', '', noveltySection(runs, runFights), '',
    // Casino «Кость у двери».
    '## Кость у двери', '', DIE_LEGEND, '', table(DIE_HEAD, [dieRow(runs)].filter((r): r is (string | number)[] => !!r)), '',
    // П6 «Незакрытое дело»: a new run after the end. П8 «Новое на карте»: the sign on the map.
    '## Новый поход после конца', '', NEW_RUN_LEGEND, '', table(NEW_RUN_HEAD, newRunRows(set.records)), '',
    '## Новое на карте', '', MAP_SIGN_LEGEND, '', table(MAP_SIGN_HEAD, mapSignRows(runs)), '',
    '## Подсказки', '', HINT_LEGEND, '', table(HINT_HEAD, hintRows(runs)), '',
    '## Пролог', '', prologueSection(set.records), '',
    '## Разминка', '', warmupSection(set.records), '',
    '## Угрозы', '',
    'Предупреждения с героем в зоне при появлении. «Попал» — удар этого врага этим источником; «защищён» — тело в зоне в такт удара, но неуязвимость, щит цепи, проход, прыжок или пощада фокуса; «увернулся» — в такт удара тело вне зоны («укрытие» — рывок кабана или волка остановила стена или дерево, «стена», или край обрыва, «обрыв»); «прервано» — враг умер, отброшен, сбросил атаку или бой кончился. Выход — от появления зоны (у стаи волков — от начала воя) до первого такта вне неё (только увороты).', '',
    table(THREAT_HEAD, threatRows(fights)), '',
    '## Предметы', '', itemsSection(runs, fights), '',
    '## Отметки N', '', notesSection(analysis, options.source), '',
    '## Песочница', '', sandbox.length ? [table(FIGHT_HEAD, fightRows(sandbox)), '', ...secondWindLine(sandbox) ? [secondWindLine(sandbox)!, ''] : [], '### Угрозы в песочнице', '', table(THREAT_HEAD, threatRows(sandbox))].join('\n') : '_боёв песочницы нет_', '');
  return out.join('\n');
}

// ---- Task 25 «От чего умирают» (observe.ts `death`; docs/realtime-telemetry.md, section 8) ----

/** One death of the report: its fight, the run row (null — the sandbox), the death (null — no data: an older record without a replay). */
export interface DeathEntry { entry: FightEntry; row: number | null; death: FightDeath | null }

/**
 * The fights the hero died in: lost (`outcome` defeat) or with a death in the summary — the replay's, else (no replay) the
 * browser's field; an older browser record without the field has no data (null).
 */
export function deathEntries(fights: readonly FightEntry[]): DeathEntry[] {
  return fights.flatMap(e => {
    const death = e.analysis ? e.analysis.summary.death ?? null : (e.record.summary as Partial<FightSummary>).death ?? null;
    if (!death && e.record.outcome !== 'defeat') return [];
    return [{ entry: e, row: e.record.run === SANDBOX_RUN ? null : e.record.row ?? null, death }];
  });
}

const GUARD_TITLES: Record<DeathGuard, string> = { chain: 'щит цепи', focus: 'Щит фокуса', invuln: 'неуязвимость' };
const MOVE_TITLES: Record<string, string> = { dash: 'на проходе', jump: 'в прыжке', return: 'на возврате молота' };
/** A hit source in this section: the report's name, else the run's (the goblin's arrows and blast), else the id. */
const deathSourceTitle = (s: string): string => SOURCE_TITLES[s] ?? RT_DEATH_ABILITY[s] ?? s;
/** The killing blow in one short key: the source and the striker (the summaries group by it). */
const killerKey = (d: FightDeath | null): string => (d ? `${deathSourceTitle(d.source)}${d.enemy ? ` — ${kindTitle(d.elite ? `${d.enemy}*` : d.enemy)}` : ''}` : 'нет данных');
/** «касание ×6 за 4 с»: hits of a source and the game seconds from its first hit in the window to the death. */
const seriesPart = (x: FightDeath['series'][number]): string => `${deathSourceTitle(x.source)} ×${x.hits}${x.span >= 0.05 ? ` за ${n1(x.span)} с` : ''}`;
const counts = (keys: readonly string[]): string => {
  const by: Record<string, number> = {};
  for (const k of keys) bump(by, k);
  return Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
};

function deathRow(d: DeathEntry): (string | number)[] {
  const r = d.entry.record, x = d.death;
  const head = [`\`${r.fight}\`${x ? `, такт ${x.tick}` : ''}`, r.run === SANDBOX_RUN ? 'песочница' : `\`${r.run}\``, d.row ?? '—', arenaTitle(r.arena)];
  if (!x) return [...head, '—', '—', '—', '—', '—', '—', '—'];
  const total = x.series.reduce((a, s) => a + s.damage, 0), main = x.series[0];
  const window = (Object.keys(GUARD_TITLES) as DeathGuard[]).filter(g => x.guardInWindow[g] > 0).map(g => `${GUARD_TITLES[g]} ${n2(x.guardInWindow[g])}`);
  return [
    ...head, `${killerTitle(x)}${x.armor ? ', броня' : ''}`, x.damage, x.series.map(seriesPart).join(', ') || '—',
    main ? `${deathSourceTitle(main.source)} (${main.damage} из ${total} HP)` : '—',
    x.guardAtHit.length ? x.guardAtHit.map(g => GUARD_TITLES[g]).join(', ') : 'нет', window.join('; ') || 'нет',
    x.moving ? MOVE_TITLES[x.moving] ?? x.moving : x.landing === null ? '—' : `${x.landing} (${n2(x.landing / 60)} с)`,
  ];
}
const DEATH_HEAD = ['Бой', 'Поход', 'Ряд', 'Арена', 'Сразил', 'Удар, HP', `Серия за ${DEATH_SERIES_WINDOW} с`, 'Главный источник', 'Защита при ударе', 'Защита в окне, с', 'Посадка, тактов'];
const DEATH_LEGEND = `Задача 25 (с 15.10.2026; поле сводки \`death\`, повтор журнала считает его заново): каждая смерть героя в бою — бои походов и песочницы. Ряд — ряд похода (в песочнице «—»); бой гарнизона (задача 38) — «г N», ряд гарнизона, после рядов леса; бой замка (задача 55в) — «з N», после рядов гарнизона. «Сразил» — смертельный удар (последний \`hit\` перед \`defeat\`): вид врага, источник, элита, аффиксы, как в «Причине смерти» похода (\`RtDeath\`). Серия — удары по герою за последние ${DEATH_SERIES_WINDOW} с игрового времени до смерти, включая смертельный, по источнику: «касание ×6 за 4 с» — шесть касаний, первое за 4 с до смерти; главный источник — снявший больше HP в серии. Защита при ударе — щит цепи (\`chainShield\` после такта), «Щит фокуса» и неуязвимость (на взгляде перед тактом; неуязвимость — за вычетом такта): сквозь них бьют только иглы дикобраза и взрыв гоблина. Защита в окне — игровые секунды каждой защиты в окне серии (на конец каждого такта); неуязвимость даёт и каждый удар серии. Посадка — тактов (1/60 с игрового времени) от конца последнего прохода, прыжка или возврата молота (\`world.move\` кончился) до смертельного удара; «—» — движения в бою до удара не было; «на проходе» — удар пришёл в проходе (иглы). Старые записи без поля и без повтора — «—». Наблюдение на малом числе смертей, не оценка баланса.`;

/** Task 38: the level of a fight record — 2 the garrison (`FightRecord.level`, or a node of the garrison, `g:…`), else 1. Task 55в: 3 — the castle (`c:…`). */
export const fightLevel = (record: { level?: number; nodeId?: string }): 1 | 2 | 3 => (record.level === 3 || record.nodeId?.startsWith('c:') ? 3 : record.level === 2 || record.nodeId?.startsWith('g:') ? 2 : 1);
/** The section «От чего умирают»: each death, then the deaths by run row (task 38: and level) and by arena with the killing blow. */
export function deathSection(fights: readonly FightEntry[]): string {
  const deaths = deathEntries(fights);
  if (!deaths.length) return `${DEATH_LEGEND}\n\nСмертей нет: боёв ${fights.length}, поражений 0.`;
  const main = (d: DeathEntry): string => (d.death?.series[0] ? deathSourceTitle(d.death.series[0].source) : 'нет данных');
  // Task 38: a garrison fight's row is «г N» (the level first, then the row: the forest's rows, then the garrison's).
  // Task 55в: a castle fight's — «з N», after the garrison's.
  const rowKey = (d: DeathEntry): string => (d.row === null ? '—' : fightLevel(d.entry.record) === 3 ? `з ${d.row}` : fightLevel(d.entry.record) === 2 ? `г ${d.row}` : String(d.row));
  const rowRank = (k: string): number => (k === '—' ? 1e6 : k.startsWith('з ') ? 2000 + Number(k.slice(2)) : k.startsWith('г ') ? 1000 + Number(k.slice(2)) : Number(k));
  const rowKeys = [...new Set(deaths.map(rowKey))].sort((a, b) => rowRank(a) - rowRank(b));
  const byRow = rowKeys.map(k => {
    const list = deaths.filter(d => rowKey(d) === k);
    return [k, list.length, counts(list.map(d => killerKey(d.death))), counts(list.map(main))];
  });
  const arenas = [...new Set(deaths.map(d => d.entry.record.arena))].sort();
  const byArena = arenas.map(a => {
    const list = deaths.filter(d => d.entry.record.arena === a);
    return [arenaTitle(a), list.length, counts(list.map(rowKey)), counts(list.map(d => killerKey(d.death))), counts(list.map(main))];
  });
  return [
    DEATH_LEGEND, '', table(DEATH_HEAD, deaths.map(deathRow)), '',
    '### Смерти по рядам', '', table(['Ряд', 'Смертей', 'Сразил', 'Главный источник серии'], byRow), '',
    '### Смерти по аренам', '', table(['Арена', 'Смертей', 'Ряды', 'Сразил', 'Главный источник серии'], byArena),
  ].join('\n');
}
// ---- end «От чего умирают» ----

// ---- Task 28 «Тюремщик в походе» (observe.ts `boss`; docs/realtime-telemetry.md, section 8) ----

/** The Jailer's moves in the order of the report (`bossMove`), their names. */
const BOSS_MOVES: readonly [string, string][] = [['flail', 'кистень'], ['throw', 'бросок гири'], ['whistle', 'свисток'],
  // Task 43: the full Castellan's moves.
  ['lunge', 'спустить пса'], ['bolt', 'болт'], ['guard', 'караул'],
  // Task 48: the Troll's moves.
  ['club', 'удар дубиной'], ['rock', 'бросок камня'], ['tail', 'хвост метёт'], ['roar', 'рык'], ['snore', 'храп'], ['charge', 'рывок']];
/** The damage sources of the boss's moves (`hit.source`). */
const BOSS_HIT_SOURCES: readonly string[] = ['flail', 'throw', 'lunge', 'castellan-bolt'];
/** Task 48: the damage sources of the Troll's moves (his rows list these). */
const TROLL_HIT_SOURCES: readonly string[] = ['troll-club', 'troll-rock', 'troll-tail', 'troll-charge'];

/** One boss fight of the report: its entry and the boss summary (the replay's, else the browser's). */
export interface BossEntry { entry: FightEntry; summary: FightSummary; row: number | null }
/** The fights with a boss (the summary's `boss`; an older record without the field and without a replay — not one). */
export function bossEntries(fights: readonly FightEntry[]): BossEntry[] {
  return fights.flatMap(e => {
    const summary = e.analysis ? e.analysis.summary : withSummaryDefaults(e.record.summary);
    if (!summary.boss) return [];
    return [{ entry: e, summary, row: e.record.run === SANDBOX_RUN ? null : e.record.row ?? null }];
  });
}

/** The fights with a boss and the deaths in them by the killing blow's source — the numbers of the section. */
export interface BossStats { fights: number; won: number; killed: number; severed: number; deathsBySource: Record<string, number> }
export function bossStats(fights: readonly FightEntry[]): BossStats {
  const list = bossEntries(fights), deathsBySource: Record<string, number> = {};
  for (const b of list) { const d = b.summary.death; if (d) bump(deathsBySource, d.source); else if (b.entry.record.outcome === 'defeat') bump(deathsBySource, '—'); }
  return {
    fights: list.length, won: list.filter(b => b.entry.record.outcome === 'victory').length,
    killed: list.filter(b => b.summary.boss!.diedAt !== null).length, severed: list.filter(b => b.summary.boss!.severedAt !== null).length, deathsBySource,
  };
}

function bossRow(b: BossEntry): (string | number)[] {
  const r = b.entry.record, boss = b.summary.boss!, s = b.summary;
  const moves = BOSS_MOVES.filter(([id]) => boss.moves[id]).map(([id, title]) => `${title} ×${boss.moves[id]}`).join(', ') || '—';
  const sources = boss.troll ? TROLL_HIT_SOURCES : BOSS_HIT_SOURCES;
  const byMove = sources.map(src => `${sourceTitle(src)} ${s.damage.bySource[src] ?? 0}`).join(', ');
  const other = s.damage.total - sources.reduce((sum, src) => sum + (s.damage.bySource[src] ?? 0), 0);
  return [
    `\`${r.fight}\``, r.run === SANDBOX_RUN ? 'песочница' : `\`${r.run}\``, b.row ?? '—', arenaTitle(r.arena), OUTCOME_TITLES[r.outcome] ?? r.outcome, n1(r.time),
    boss.severedAt === null ? 'нет' : `да, ${n1(boss.severedAt)} с`, boss.diedAt === null ? 'нет' : `${n1(boss.diedAt)} с`, moves,
    `${byMove}; прочее ${other}`, s.death ? deathSourceTitle(s.death.source) : '—', s.kills.bossClear ?? 0,
  ];
}
const BOSS_HEAD = ['Бой', 'Поход', 'Ряд', 'Арена', 'Итог', 'Время боя, с', 'Гиря отрублена', 'Босс убит', 'Приёмы (начато)', 'Урон герою по приёмам, HP', 'Смерть от', 'Толпа с боссом'];
const BOSS_LEGEND = 'Задача 28 (с 15.10.2026; поле сводки `boss`, повтор журнала считает его заново): бои с боссом — Тюремщик в походе (узел ряда 5) и на арене «Тюремщик» песочницы. Время боя — игровые секунды боя; гиря отрублена — на какой секунде боя (`partSevered`); босс убит — секунда смерти ядра. Приёмы — начатые замахи (`bossMove`). Урон герою по приёмам — HP от кистеня и броска гири (`damage.bySource`), прочее — остальной урон боя (касания, толпа). Смерть от — источник смертельного удара (`death`). Толпа с боссом — враги, погибшие со смертью ядра (`Params.bossClears`, источник `boss-clear`; не в зачёт игроку). Старые записи без поля и без повтора — не в таблице. Задача 43 (с 16.10.2026): полный Кастелян (узел ряда 10 гарнизона, арена «Двор кастеляна (полный)») — тоже бой с боссом; «гиря отрублена» у него — первая потерянная часть (пёс или арбалет), приёмы — «Спустить пса», «Болт», «Караул!», урон по приёмам — рывок пса и болт Кастеляна; его строка под таблицей — решётка, окна рычага, части по порядку. Эвристика на малом числе боёв, не оценка баланса.';

/** The section «Босс»: each boss fight, then the share killed, severed and the deaths by move. */
function bossSection(fights: readonly FightEntry[]): string {
  const list = bossEntries(fights);
  if (!list.length) return `${BOSS_LEGEND}\n\n_боёв с боссом нет_`;
  const st = bossStats(fights);
  const deaths = Object.entries(st.deathsBySource).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([src, n]) => `${src === '—' ? 'нет данных' : deathSourceTitle(src)}: ${n}`).join(', ') || 'нет';
  return [
    BOSS_LEGEND, '', table(BOSS_HEAD, list.map(bossRow)), '',
    `Боёв с боссом: ${st.fights}; побед: ${st.won} (${pct(st.won, st.fights)}); босс убит: ${st.killed} (${pct(st.killed, st.fights)}); гиря отрублена: ${st.severed} (${pct(st.severed, st.fights)}). Смерти по приёму: ${deaths}.`,
    ...castellanLines(list),
    ...trollLines(list),
    ...warlockLines(list),
  ].join('\n');
}
/** Task 55в: what broke the warlock's wardrobe (`boss.warlock.wardrobeBy`; null — whole), and a thing broken (`shove.broken`). */
const THING_BREAK_TITLES: Readonly<Record<string, string>> = { core: 'о ядро', wall: 'о стену', thing: 'о вещь', body: 'о тело', end: 'в конце пути', cliff: 'в обрыв', fall: 'упала в обрыв' };
/** Task 55в: the warlock's own moves (the hero's damage by them; the rest — the crowd's and his touch). */
const WARLOCK_MOVE_SOURCES: readonly string[] = ['wardrobe-topple', 'warlock-orb', 'warlock-flash'];
/**
 * Task 55в (spec task-55 §10, the section «Босс»): the warlock's fights (`boss.warlock`) — the fight's length, the share won (a run meets
 * him once: the first try), his charm broken and its second, the hits on his core by source (the shove's share), the windows after
 * «Перенос» with a hit, «Перенос», the barrels into the core a fight, what broke his wardrobe, the «звон», the deaths, the hero's damage
 * by his moves against the rest.
 */
export function warlockLines(list: readonly BossEntry[]): string[] {
  const own = list.filter(b => b.summary.boss?.warlock);
  if (!own.length) return [];
  const t = (b: BossEntry): WarlockBossSummary => b.summary.boss!.warlock!;
  const won = own.filter(b => b.entry.record.outcome === 'victory').length, times = own.map(b => b.entry.record.time);
  const broken = own.flatMap(b => (t(b).charmBrokenAt === null ? [] : [t(b).charmBrokenAt!]));
  const hits: Record<string, number> = {}, blocks: Record<string, number> = {}, deaths: Record<string, number> = {}, wardrobe: Record<string, number> = {};
  for (const b of own) {
    for (const [src, n] of Object.entries(t(b).hits)) bump(hits, src, n);
    for (const [src, n] of Object.entries(t(b).blocks)) bump(blocks, src, n);
    if (b.summary.death) bump(deaths, b.summary.death.source);
    bump(wardrobe, t(b).wardrobeBy ?? 'whole');
  }
  const allHits = Object.values(hits).reduce((a, n) => a + n, 0), sum = (f: (x: WarlockBossSummary) => number): number => own.reduce((a, b) => a + f(t(b)), 0);
  const list2 = (r: Record<string, number>, title: (k: string) => string): string => Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${title(k)} ${n}`).join(', ') || 'нет';
  const moves = own.reduce((a, b) => a + WARLOCK_MOVE_SOURCES.reduce((x, src) => x + (b.summary.damage.bySource[src] ?? 0), 0), 0), total = own.reduce((a, b) => a + b.summary.damage.total, 0);
  return ['', `Колдун (задача 55): боёв ${own.length}, побед с первой попытки ${won} (${pct(won, own.length)}); длина боя мед. ${n1(median(times))} с; чары сняты в ${broken.length} боях (${pct(broken.length, own.length)}), мед. ${broken.length ? `${n1(median(broken))} с` : '—'}; попадания по ядру: ${list2(hits, sourceTitle)} (толчком ${pct(hits.shove ?? 0, allHits)}); окна после «Переноса» (открыто / с попаданием): ${sum(x => x.windows.opened)} / ${sum(x => x.windows.hit)}; «Переносов» ${sum(x => x.shifts)}; бочек в ядро на бой ${n2(sum(x => x.barrels) / own.length)}; Шкаф Колдуна: ${list2(wardrobe, k => (k === 'whole' ? 'цел' : THING_BREAK_TITLES[k] ?? k))}; «звон»: ${list2(blocks, sourceTitle)}; смерти: ${list2(deaths, deathSourceTitle)}; урон герою — приёмы Колдуна ${moves} (${pct(moves, total)}), прочее ${total - moves}.`];
}
/**
 * Task 43: the full Castellan's fights (`boss.castellan`) — the fight's length, the share won (a run meets him once: the first try),
 * the grate (raised by a lever, seconds open, windows with and without a core hit), the parts in the order lost, «Болт».
 */
function castellanLines(list: readonly BossEntry[]): string[] {
  const own = list.filter(b => b.summary.boss?.castellan);
  if (!own.length) return [];
  const won = own.filter(b => b.entry.record.outcome === 'victory').length, times = own.map(b => b.entry.record.time);
  const sum = (f: (c: NonNullable<FightSummary['boss']>['castellan'] & object) => number): number => own.reduce((a, b) => a + f(b.summary.boss!.castellan!), 0);
  const order = own.map(b => b.summary.boss!.castellan!.parts.map(p => `${p.kind === 'hound' ? 'пёс' : 'арбалет'} ${n1(p.at)} с`).join(' → ') || '—');
  return ['', `Кастелян полный (задача 43): боёв ${own.length}, побед с первой попытки ${won} (${pct(won, own.length)}); длина боя мед. ${n1(median(times))} с; решётка поднята рычагом ${sum(c => c.raises)} раз, открыта ${n1(sum(c => c.openSeconds))} с; окна с ударом по ядру ${sum(c => c.windowsHit)}, без удара ${sum(c => c.windowsMissed)}; решётка выбила звенья из цепи ${sum(c => c.unlinks ?? 0)} раз (звеньев ${sum(c => c.unlinked ?? 0)}); «Болт» — выстрелов ${sum(c => c.bolts.shots)}, в героя ${sum(c => c.bolts.hero)}, во врагов ${sum(c => c.bolts.enemies)}. Части по порядку: ${order.join('; ')}.`];
}
/**
 * Task 48: the Troll's fights (`boss.troll`) — the fight's length, the share won, the deaths by his moves, the parts (all three — the
 * share), the windows with a hit by what opened them, the hits blocked outside a window, «Храп», the wolves of «Рык».
 */
function trollLines(list: readonly BossEntry[]): string[] {
  const own = list.filter(b => b.summary.boss?.troll);
  if (!own.length) return [];
  const won = own.filter(b => b.entry.record.outcome === 'victory').length, times = own.map(b => b.entry.record.time);
  const t = (b: BossEntry): TrollBossSummary => b.summary.boss!.troll!;
  const deaths: Record<string, number> = {};
  for (const b of own) if (b.summary.death) bump(deaths, b.summary.death.source);
  const windows: Record<string, { opened: number; hit: number }> = {}, blocks: Record<string, number> = {};
  for (const b of own) {
    for (const [src, w] of Object.entries(t(b).windows)) { const c = windows[src] ??= { opened: 0, hit: 0 }; c.opened += w.opened; c.hit += w.hit; }
    for (const [src, n] of Object.entries(t(b).blocks)) bump(blocks, src, n);
  }
  const all = own.filter(b => t(b).parts.length >= 3).length, sum = (f: (x: TrollBossSummary) => number): number => own.reduce((a, b) => a + f(t(b)), 0);
  const list2 = (r: Record<string, number>): string => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${sourceTitle(s)} ${n}`).join(', ') || 'нет';
  return ['', `Тролль (задача 48): боёв ${own.length}, побед с первой попытки ${won} (${pct(won, own.length)}); длина боя мед. ${n1(median(times))} с; смерти: ${list2(deaths)}; все три части отрублены — ${all} (${pct(all, own.length)}); окна (открыто / с попаданием): ${Object.entries(windows).map(([s, w]) => `${s} ${w.opened} / ${w.hit}`).join(', ') || 'нет'}; «звон» вне окна: ${list2(blocks)}; «Храп» — выспался ${sum(x => x.snores.slept)}, прерван ${sum(x => x.snores.woken)}; волков «Рыка» ${sum(x => x.wolves)}; ядро выпало из цепи ${sum(x => x.unlinks)} раз${stuckLine(own.map(t))}.`,
    ...trollDamageLine(own.map(t))];
}
/** Task 48, section 25: «; рывок застрял: стена N, дерево M, край K» — the fights whose summary has `stuck` (the walking Troll); none — nothing. */
function stuckLine(list: readonly TrollBossSummary[]): string {
  const all: Record<string, number> = {};
  for (const x of list) for (const [on, n] of Object.entries(x.stuck ?? {})) all[on] = (all[on] ?? 0) + n;
  const names: Record<string, string> = { wall: 'стена или скала', tree: 'дерево', edge: 'край арены', cliff: 'обрыв' };
  const parts = Object.entries(all).sort((a, b) => b[1] - a[1]).map(([on, n]) => `${names[on] ?? on} ${n}`);
  return parts.length ? `; рывок застрял: ${parts.join(', ')}` : '';
}
/** Task 48 (design 17.10.2026): the hero's damage in the Troll's fights by group — the fights whose summary has it (from 17.10.2026). */
function trollDamageLine(own: readonly TrollBossSummary[]): string[] {
  const with_ = own.filter(t => t.damage);
  if (!with_.length) return [];
  const groups = [['crowd', 'толпа'], ['core', 'касания ядра'], ['parts', 'касания частей'], ['moves', 'приёмы']] as const;
  const sums = groups.map(([g]) => with_.reduce((a, t) => a + t.damage![g], 0)), all = sums.reduce((a, b) => a + b, 0);
  return [`Тролль — урон герою по группам (боёв ${with_.length}): ${groups.map(([, title], i) => `${title} ${sums[i]} (${pct(sums[i], all)})`).join(', ')}.`];
}
// ---- end «Босс» ----

// ---- Task 55в «Замок» (observe.ts `shove`; docs/realtime-telemetry.md, «Замок») ----

const CASTLE_ARENA_IDS: readonly string[] = CASTLE_ARENAS.map(a => a.id);
/** Where the shoves stopped (`shove.stops`), in the report's order and names. */
const SHOVE_STOPS: readonly [string, string][] = [['tough', 'крепкий'], ['elite', 'элита'], ['rook', 'Ладья'], ['thing', 'вещь'], ['core', 'ядро'], ['wall', 'стена'], ['cliff', 'обрыв'], ['end', 'конец пути']];
/** The numbers of one castle arena (the tests read them). */
export interface CastleArenaStats {
  fights: number; deaths: number; topple: number; rook: number;
  /** The fights whose summary has the shoves (`summary.shove`; older records — not counted below). */
  counted: number; withShove: number; shoves: number; crushed: number; cancels: number; length: number; firstAt: number[]; barrels: number; barrelsUsed: number;
}
export interface CastleStats { arenas: Record<string, CastleArenaStats>; stops: Record<string, number>; broken: Record<string, number> }
/** The castle's fights (runs and the sandbox) by arena; the shoves' stops and the things broken over all of them. */
export function castleStats(fights: readonly FightEntry[]): CastleStats {
  const arenas: Record<string, CastleArenaStats> = {}, stops: Record<string, number> = {}, broken: Record<string, number> = {};
  for (const e of fights) {
    if (!CASTLE_ARENA_IDS.includes(e.record.arena)) continue;
    const summary = e.analysis ? e.analysis.summary : withSummaryDefaults(e.record.summary);
    const a = arenas[e.record.arena] ??= { fights: 0, deaths: 0, topple: 0, rook: 0, counted: 0, withShove: 0, shoves: 0, crushed: 0, cancels: 0, length: 0, firstAt: [], barrels: 0, barrelsUsed: 0 };
    a.fights++;
    if (e.record.outcome === 'defeat') { a.deaths++; if (summary.death?.source === 'wardrobe-topple') a.topple++; if (summary.death?.source === 'rook-strike') a.rook++; }
    const sh = summary.shove;
    if (!sh) continue;
    a.counted++; a.shoves += sh.shoves; a.crushed += sh.crushed; a.cancels += sh.cancels; a.length += sh.length; a.barrels += sh.barrels.start; a.barrelsUsed += sh.barrels.used;
    if (sh.shoves > 0) a.withShove++;
    if (sh.firstAt !== null) a.firstAt.push(sh.firstAt);
    for (const [k, n] of Object.entries(sh.stops)) bump(stops, k, n);
    for (const [k, n] of Object.entries(sh.broken)) bump(broken, k, n);
  }
  return { arenas, stops, broken };
}
const CASTLE_HEAD = ['Арена', 'Боёв', 'Со сводкой толчков', 'С толчком', 'Толчков на бой', 'Раздавлено на толчок', 'Первый толчок, с мед.', 'Длина толчка, ед. ср.', 'Бочек сдвинуто / стояло', 'Отменено', 'Смертей', 'От «Падения шкафа»', 'От «Удара ладьи»'];
const CASTLE_LEGEND = 'Задача 55в (с 23.10.2026; поле сводки `shove`, повтор журнала считает его заново; эвристика, не оценка баланса): бои на аренах замка — «Прихожая», «Анфилада», «Бальный зал», «Зал колдуна» (походы и песочница). Толчок — начатый (`shove` `start`); раздавлено — тела, убитые толчком (`crush`, в зачёт игроку); отменено — вещь пропала до конца прохода (`cancel`); первый толчок — игровая секунда боя; длина — путь вещи, ед.; бочки — стояли в начале боя и сдвинуты хоть раз. Остановки — где толчок кончился (`stop`: крепкий, элита, Ладья, вещь, ядро, стена, обрыв, конец пути); сломанные вещи — по причине (`thing` `break`). Смерти — проигранные бои, из них от «Падения шкафа» (`wardrobe-topple`) и «Удара ладьи» (`rook-strike`). Записи без поля `shove` (до 23.10.2026) и без повтора — в «Боёв» и смертях, не в числах толчков. Тревожно: в «Прихожей» меньше одного толчка на бой — закон не прочитан (смотреть подсветку, не числа).';
/** The section «Замок» (spec task-55 §10): the castle's fights by arena, the shoves' stops, the things broken; the alarm of «Прихожая». */
export function castleSection(fights: readonly FightEntry[]): string {
  const st = castleStats(fights), ids = CASTLE_ARENA_IDS.filter(id => st.arenas[id]);
  if (!ids.length) return `${CASTLE_LEGEND}\n\n_боёв на аренах замка нет_`;
  const rows = ids.map(id => {
    const a = st.arenas[id], c = a.counted;
    return [arenaTitle(id), a.fights, c, c ? `${a.withShove} (${pct(a.withShove, c)})` : '—', c ? n2(a.shoves / c) : '—', a.shoves ? n2(a.crushed / a.shoves) : '—',
      a.firstAt.length ? n1(median(a.firstAt)) : '—', a.shoves ? n1(a.length / a.shoves) : '—', c ? `${a.barrelsUsed} / ${a.barrels}` : '—', c ? a.cancels : '—', a.deaths, a.topple, a.rook];
  });
  const stops = SHOVE_STOPS.filter(([k]) => st.stops[k]).map(([k, title]) => `${title} ${st.stops[k]}`).join(', ') || 'нет';
  const broken = Object.entries(st.broken).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${THING_BREAK_TITLES[k] ?? k} ${n}`).join(', ') || 'нет';
  const hall = st.arenas['c-hall'];
  const alarm = hall && hall.counted && hall.shoves / hall.counted < 1 ? [`Тревожно: в «Прихожей» ${n2(hall.shoves / hall.counted)} толчка на бой (меньше одного) — закон, похоже, не прочитан.`] : [];
  return [CASTLE_LEGEND, '', table(CASTLE_HEAD, rows), '', `Остановки толчков: ${stops}. Сломанные вещи: ${broken}.`, ...alarm].join('\n');
}
// ---- end «Замок» ----

// ---- Task 16 «Подвиги» (sim/feat.ts, run/rtRun.ts; docs/realtime-slice.md, «Подвиги») ----

const FEAT_TITLES: Record<string, string> = { score: 'Набери N очков', afterGoals: 'Продержись N с после целей', arena: 'Продержись N с на арене' };
/** One kind of feat over the run fights (`summary.feat`, the replay's, else the browser's). */
export interface FeatStat { kind: string; row?: number; fights: number; done: number; won: number; doneWon: number; at: number[]; exitsUndone: number; missing: number[] }
/** By kind; `byRow` — by kind and run row (review 14.10.2026: the done share by kind and row decides the N of design). */
export function featStats(runFights: readonly FightEntry[], byRow = false): FeatStat[] {
  const out = new Map<string, FeatStat>();
  for (const e of runFights) {
    const f = (e.analysis?.summary ?? withSummaryDefaults(e.record.summary)).feat;
    if (!f || (e.record.outcome !== 'victory' && e.record.outcome !== 'defeat')) continue;
    const row = byRow ? e.record.row ?? 0 : undefined, key = byRow ? `${f.kind}/${String(row).padStart(2, '0')}` : f.kind;
    const st = out.get(key) ?? { kind: f.kind, ...row !== undefined ? { row } : {}, fights: 0, done: 0, won: 0, doneWon: 0, at: [], exitsUndone: 0, missing: [] };
    st.fights++;
    if (f.done) { st.done++; if (f.at !== null) st.at.push(f.at); }
    if (e.record.outcome === 'victory') { st.won++; if (f.done) st.doneWon++; else { st.exitsUndone++; st.missing.push(f.missing); } }
    out.set(key, st);
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind) || (a.row ?? 0) - (b.row ?? 0));
}
const FEAT_HEAD = ['Подвиг', 'Боёв с ним', 'Выполнен', 'Выполнен и дверь', 'Секунда выполнения мед.', 'Дверь без подвига', 'Не хватило мед.'];
const FEAT_LEGEND = 'Задача 16 «Подвиги» (с 14.10.2026; со второго похода — после первого Тюремщика): бои походов с подвигом (`summary.feat`), законченные победой или поражением. «Выполнен» — доля боёв, где условие выполнено (смерть потом всё равно ничего не платит); «Выполнен и дверь» — выполнен и бой выигран, награда выдана. Секунда — игровая секунда боя, когда подвиг выполнен. «Дверь без подвига» — выход в дверь с невыполненным подвигом; «не хватило» — очков или секунд до N в конце боя (медиана). Награды — по `RunRecord.feats`: ресурсы у двери, выбор талисмана, ресурсы вместо талисмана (пул мал). «По рядам» — те же числа по виду и ряду похода (решение дизайна 14.10.2026: N поднять, если у людей «очки» выполнены в ≥ 85 % боёв, а «после целей» — в ≤ 50 %; docs/realtime-loop-research.md, раздел 8). Эвристика, не оценка баланса.';
function featRows(runFights: readonly FightEntry[], byRow = false): (string | number)[][] {
  return featStats(runFights, byRow).map(s => [FEAT_TITLES[s.kind] ?? s.kind, ...byRow ? [s.row || '—'] : [], s.fights, `${s.done} (${pct(s.done, s.fights)})`, `${s.doneWon} (${pct(s.doneWon, s.fights)})`,
    s.at.length ? n1(median(s.at)) : '—', `${s.exitsUndone} (${pct(s.exitsUndone, s.won)} побед)`, s.missing.length ? n1(median(s.missing)) : '—']);
}
function featRewardLine(runs: readonly RunRecord[]): string {
  const feats = runs.flatMap(r => r.feats ?? []);
  if (!feats.length) return '_подвигов в записях нет_';
  const paid = (what: string) => feats.filter(f => f.paid === what).length;
  return `Подвигов в походах: ${feats.length} (походов с подвигами: ${runs.filter(r => r.featsOn).length}). Награда предложена: ресурсы ${feats.filter(f => f.reward === 'resources').length}, талисман ${feats.filter(f => f.reward === 'talisman').length}. Выдано: ресурсы ${paid('resources')}, выбор талисмана ${paid('talisman')}, ресурсы вместо талисмана ${paid('fallback')}; не выдано ${feats.filter(f => f.paid === null).length}.`;
}

// ---- Task 16 telemetry: the first meetings (`summary.novelty`, `RunRecord.firsts`) and the viewer's run number ----

/** Run fights by the first meetings in them (the view's count; fights without it are «нет данных»). */
export interface NoveltyStat { group: string; fights: number; damage: number[]; deaths: number }
export function noveltyStats(runFights: readonly FightEntry[]): NoveltyStat[] {
  const groups: NoveltyStat[] = ['0', '1', '2+', 'нет данных'].map(group => ({ group, fights: 0, damage: [], deaths: 0 }));
  for (const e of runFights) {
    if (e.record.outcome !== 'victory' && e.record.outcome !== 'defeat') continue;
    const n = e.record.summary.novelty, g = groups[n === undefined ? 3 : n >= 2 ? 2 : n];
    g.fights++; g.damage.push((e.analysis?.summary ?? e.record.summary).damage.total);
    if (e.record.outcome === 'defeat') g.deaths++;
  }
  return groups.filter(g => g.fights);
}
const NOVELTY_HEAD = ['Первых встреч в бою', 'Боёв', 'Урон за бой мед.', 'Смертей'];
/** Runs by the viewer's run number: the first run, repeats, unknown. */
export interface ViewerRunStat { group: string; runs: number; farRow: number[]; won: number; lost: number; damage: number[] }
export function viewerRunStats(runs: readonly RunRecord[], runFights: readonly FightEntry[]): ViewerRunStat[] {
  const groups: ViewerRunStat[] = ['первый', 'повторный', 'нет данных'].map(group => ({ group, runs: 0, farRow: [], won: 0, lost: 0, damage: [] }));
  for (const r of runs) {
    // Review 14.10.2026: an approximate number (a profile older than the count) is a repeat.
    const g = groups[r.viewerRun === undefined ? 2 : r.viewerRun === 1 && !r.viewerRunApprox ? 0 : 1];
    g.runs++; g.farRow.push(r.farRow);
    if (r.outcome === 'victory') g.won++; else if (r.outcome === 'defeat') g.lost++;
    for (const e of runFights) if (e.run?.id === r.id && (e.record.outcome === 'victory' || e.record.outcome === 'defeat')) g.damage.push((e.analysis?.summary ?? e.record.summary).damage.total);
  }
  return groups.filter(g => g.runs);
}
const VIEWER_RUN_HEAD = ['Поход зрителя', 'Походов', 'Дальний ряд мед.', 'Побед', 'Поражений', 'Урон за бой мед.'];
const NOVELTY_LEGEND = 'Новизна (с 14.10.2026): «первые встречи» — понятия, которые зритель увидел впервые (виды и аффиксы врагов, взрыв гоблина, элита, котомка, подвиг, второе дыхание, кнопка лечения, игорный круг; `RunRecord.firsts`), их отмечает вид; в бою — `summary.novelty` (повтор журнала их не видит). Бои походов, законченные победой или поражением; «нет данных» — записи без счёта. Поход зрителя — его номер у зрителя (`RunRecord.viewerRun`, счёт профиля браузера): первый и повторные; номер с `viewerRunApprox` (профиль старше счёта, счёт начат с 2) — повторный. Эвристика, не оценка баланса.';
function firstsLine(runs: readonly RunRecord[]): string {
  const counts: Record<string, number> = {};
  for (const r of runs) for (const f of r.firsts ?? []) counts[f.id] = (counts[f.id] ?? 0) + 1;
  const list = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return list.length ? `Первые встречи по понятиям (походов): ${list.map(([id, n]) => `\`${id}\` ${n}`).join(', ')}.` : '_первых встреч в записях нет_';
}
function noveltySection(runs: readonly RunRecord[], runFights: readonly FightEntry[]): string {
  const nov = noveltyStats(runFights), vr = viewerRunStats(runs, runFights);
  return [NOVELTY_LEGEND, '',
    nov.length ? table(NOVELTY_HEAD, nov.map(g => [g.group, g.fights, g.damage.length ? n1(median(g.damage)) : '—', `${g.deaths} (${pct(g.deaths, g.fights)})`])) : '_боёв походов нет_', '',
    vr.length ? table(VIEWER_RUN_HEAD, vr.map(g => [g.group, g.runs, g.farRow.length ? n1(median(g.farRow)) : '—', g.won, g.lost, g.damage.length ? n1(median(g.damage)) : '—'])) : '_походов нет_', '',
    firstsLine(runs)].join('\n');
}

// ---- Task 17 «Пологий вход»: the run by its rows ----

/** One run row of a group of runs (`rowStats`). */
export interface RowStat {
  /**
   * `gentle` — runs that play the gentle entry's row tables (`RunRecord.gentle` below «Испытание II»), `old` — the tables before
   * task 17 (no flag, older runs, or «Испытание» II–V).
   */
  group: 'gentle' | 'old';
  /** Task 18: the runs' level of «Испытание» (`RunRecord.ash`; absent — 0). */
  ash: number;
  row: number;
  /** Run fights of the row that ended (a victory or a defeat). */
  fights: number;
  /** Damage to the hero per fight (the replay's summary, else the browser's). */
  damage: number[];
  /** HP when the run left the row: the last node of the row each run went through (`hpOut`); a run that died there — 0. */
  hpOut: number[];
  deaths: number;
  /** Healing potions used in the row's fights. */
  potions: number;
  /** Runs whose second wind stood the hero up on this row (`RunRecord.secondWind`). */
  winds: number;
}

/** Task 18: the level of a run record (absent — 0). */
export const recordAsh = (r: RunRecord | null | undefined): number => r?.ash ?? 0;
/** The run plays the gentle row tables: the flag below «Испытание II» (task 18 turns the tables off from II). */
export const gentleTables = (r: RunRecord | null | undefined): boolean => !!r?.gentle && recordAsh(r) < 2;
/**
 * Run fights and runs by run row (rows 1–10), in groups by the row tables (gentle or old) and the level of «Испытание» (task 18:
 * a level II+ run plays the old tables — its own group, not the gentle one). Empty rows and groups are left out.
 */
export function rowStats(runs: readonly RunRecord[], runFights: readonly FightEntry[]): RowStat[] {
  const out: RowStat[] = [];
  const levels = [...new Set([0, ...runs.map(recordAsh), ...runFights.map(e => recordAsh(e.run))])].sort((a, b) => a - b);
  for (const [group, ash] of (['gentle', 'old'] as const).flatMap(g => levels.map(level => [g, level] as const))) {
    const own = (r: RunRecord | null | undefined): boolean => (group === 'gentle') === gentleTables(r) && recordAsh(r) === ash;
    const groupRuns = runs.filter(own), fights = runFights.filter(e => own(e.run) && (e.record.outcome === 'victory' || e.record.outcome === 'defeat'));
    for (let row = 1; row <= 10; row++) {
      const rowFights = fights.filter(e => e.record.row === row), summary = (e: FightEntry): FightSummary => e.analysis?.summary ?? e.record.summary;
      const hpOut = groupRuns.flatMap(r => {
        const visits = r.nodes.filter(v => v.row === row);
        return visits.length ? [visits[visits.length - 1].hpOut] : [];
      });
      const stat: RowStat = {
        group, ash, row, fights: rowFights.length, damage: rowFights.map(e => summary(e).damage.total), hpOut,
        deaths: rowFights.filter(e => e.record.outcome === 'defeat').length,
        potions: rowFights.reduce((sum, e) => sum + (summary(e).abilities?.items?.healing ?? 0), 0),
        winds: groupRuns.filter(r => r.secondWind?.row === row).length,
      };
      if (stat.fights || stat.hpOut.length) out.push(stat);
    }
  }
  return out;
}
const ROW_HEAD = ['Вход', 'Ряд', 'Боёв', 'Урон за бой мед. / сред.', 'HP на выходе из ряда мед. (походов)', 'Смертей', 'Лечений выпито', 'Второе дыхание'];
const ROW_LEGEND = 'Задача 17 «Пологий вход» (с 13.10.2026): бои походов по рядам. «Пологий» — походы с флагом `gentleEntry` (`RunRecord.gentle`), «прежний» — без него (и записи до 13.10.2026). Задача 18 (с 14.10.2026): к входу добавлена ступень «Испытание» (`RunRecord.ash`); с «Испытания II» поход играет прежние таблицы рядов — он в группе «прежний · Исп. N», не в пологой. Бои — законченные победой или поражением. Урон — HP героя за бой (повтор журнала, иначе сводка браузера). HP на выходе — `hpOut` последнего узла ряда в каждом походе, медиана (в скобках — походов). Лечения — выпитые в боях ряда (`abilities.items.healing`). Второе дыхание — походы, где оно подняло героя на этом ряду (`RunRecord.secondWind`; только пологий вход, ряды 1–4). Эвристика для кривой сложности, не оценка баланса.';
function rowRows(runs: readonly RunRecord[], runFights: readonly FightEntry[]): (string | number)[][] {
  const mean = (xs: readonly number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  return rowStats(runs, runFights).map(s => [`${s.group === 'gentle' ? 'пологий' : 'прежний'}${s.ash ? ` · Исп. ${ASH_MARKS[s.ash] ?? s.ash}` : ''}`, s.row, s.fights, s.damage.length ? `${n1(median(s.damage))} / ${n1(mean(s.damage))}` : '—',
    s.hpOut.length ? `${n1(median(s.hpOut))} (${s.hpOut.length})` : '—', s.deaths, s.potions, s.winds]);
}

// ---- Task 18 «Испытание I–V»: the runs by level ----

const ASH_MARKS = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
/** Runs of one level of «Испытание» (`ashStats`). */
export interface AshStat {
  ash: number;
  runs: number;
  won: number;
  lost: number;
  /** The farthest run row of each run. */
  farRow: number[];
  /** Damage to the hero per ended fight of these runs. */
  damage: number[];
  /** Damage to the hero in the final fights (`last-stand`) of these runs, and how many of them were won. */
  finalDamage: number[];
  finalWon: number;
  /** Task 48: the same for the den branch's final — the Troll's fights (`troll`), apart from «Последний рубеж». */
  trollDamage: number[];
  trollWon: number;
  /** Task 45: the median chain length of each ended fight with chains (`summary.chain.lengthMedian`). */
  chainMedian: number[];
}
/** Runs and their fights by the level of «Испытание» (`RunRecord.ash`; absent — 0). Levels without runs are left out. */
export function ashStats(runs: readonly RunRecord[], runFights: readonly FightEntry[]): AshStat[] {
  const levels = [...new Set(runs.map(recordAsh))].sort((a, b) => a - b);
  const summary = (e: FightEntry): FightSummary => e.analysis?.summary ?? e.record.summary;
  return levels.map(ash => {
    const own = runs.filter(r => recordAsh(r) === ash);
    const fights = runFights.filter(e => e.run && recordAsh(e.run) === ash && (e.record.outcome === 'victory' || e.record.outcome === 'defeat'));
    const finals = fights.filter(e => e.record.arena === 'last-stand'), trolls = fights.filter(e => e.record.arena === 'troll');
    return {
      ash, runs: own.length, won: own.filter(r => r.outcome === 'victory').length, lost: own.filter(r => r.outcome === 'defeat').length,
      farRow: own.map(r => r.farRow), damage: fights.map(e => summary(e).damage.total),
      finalDamage: finals.map(e => summary(e).damage.total), finalWon: finals.filter(e => e.record.outcome === 'victory').length,
      trollDamage: trolls.map(e => summary(e).damage.total), trollWon: trolls.filter(e => e.record.outcome === 'victory').length,
      chainMedian: fights.filter(e => summary(e).chain.count > 0).map(e => summary(e).chain.lengthMedian),
    };
  });
}
const ASH_HEAD = ['Испытание', 'Походов', 'Побед', 'Поражений', 'Дальний ряд мед.', 'Урон за бой мед.', 'Финалов (побед)', 'Урон в финале мед.', 'Тролль (побед)', 'Урон у Тролля мед.', 'Цепь мед. (боёв)'];
const ASH_LEGEND = 'Задача 18 «Испытание I–V» (с 14.10.2026): походы по ступени (`RunRecord.ash`; нет поля — 0, и записи до 14.10.2026). Ступень выбирают на «Новом походе» после первой победы. Бои — законченные победой или поражением; финал — «Последний рубеж» (с задачи 48 — финал ветки лагеря; бои Тролля, финала ветки логова, — в своих столбцах «Тролль»). Задача 45 (с 16.10.2026): ступени VI–VIII; «Цепь мед.» — медиана по боям медианной длины цепи боя (`chain.lengthMedian`; в скобках — боёв с цепями): на VIII ожидается ниже. Эвристика, не оценка баланса.';
function ashRows(runs: readonly RunRecord[], runFights: readonly FightEntry[]): (string | number)[][] {
  return ashStats(runs, runFights).map(s => [ASH_MARKS[s.ash] ?? String(s.ash), s.runs, s.won, s.lost, s.farRow.length ? n1(median(s.farRow)) : '—',
    s.damage.length ? n1(median(s.damage)) : '—', `${s.finalDamage.length} (${s.finalWon})`, s.finalDamage.length ? n1(median(s.finalDamage)) : '—',
    `${s.trollDamage.length} (${s.trollWon})`, s.trollDamage.length ? n1(median(s.trollDamage)) : '—',
    s.chainMedian.length ? `${n1(median(s.chainMedian))} (${s.chainMedian.length})` : '—']);
}

/** Task 26 «Расписание леса»: the scheduled runs of one group (the viewer's run number) and what their fights brought. */
export interface ScheduleStat {
  group: string;
  runs: number;
  /** New living elements (the bag left out: outside the budget, variant E) of each fed-back fight. */
  fresh: number[];
  /** The most new elements in one fight, per run. */
  peak: number[];
  /** Fights with an arc and practice fights. */
  arcs: number;
  practice: number;
  /** Living elements met by the end of each run (the snapshot and the run's new ones). */
  metEnd: number[];
}
const SCHEDULE_GROUPS: readonly [string, (r: RunRecord) => boolean][] = [
  ['поход 1', r => r.viewerRun === 1], ['поход 2', r => r.viewerRun === 2], ['поход 3', r => r.viewerRun === 3],
  ['поход 4+', r => (r.viewerRun ?? 0) >= 4], ['номер не известен', r => r.viewerRun === undefined],
];
/** Task 26: the scheduled runs (`RunRecord.schedule`) by the viewer's run number; groups without runs are left out. */
export function scheduleStats(runs: readonly RunRecord[]): ScheduleStat[] {
  const own = runs.filter(r => r.schedule);
  return SCHEDULE_GROUPS.map(([group, take]) => {
    const list = own.filter(take), fights = list.flatMap(r => r.nodes.filter(n => n.fresh !== undefined));
    const count = (n: RunNodeVisit): number => (n.fresh ?? []).filter(id => id !== 'bag' && !id.startsWith('affix:')).length;
    return {
      group, runs: list.length, fresh: fights.map(count), peak: list.map(r => Math.max(0, ...r.nodes.filter(n => n.fresh !== undefined).map(count))),
      arcs: list.flatMap(r => r.nodes).filter(n => n.arc !== undefined && n.arc !== 'practice').length, practice: list.flatMap(r => r.nodes).filter(n => n.arc === 'practice').length,
      metEnd: list.map(r => r.schedule!.start + new Set(r.nodes.flatMap(n => n.fresh ?? []).filter(id => !id.startsWith('affix:'))).size),
    };
  }).filter(s => s.runs > 0);
}
const SCHEDULE_HEAD = ['Группа', 'Походов', 'Боёв', 'Новых ЖЭ на бой', 'Боёв с ≥ 2 новыми', 'Пик за поход, среднее', 'Дуг / практики', 'Встречено к концу, среднее'];
const SCHEDULE_LEGEND = 'Задача 26 «Расписание леса» (с 15.10.2026): походы с расписанием (`RunRecord.schedule`) по номеру похода зрителя (`viewerRun`). Новые ЖЭ — живые элементы, которых зритель не встречал до боя (`RunNodeVisit.fresh`; котомка не считается — вне бюджета; тип свойства элиты — не отдельный ЖЭ). Встречено — снимок истории и новые за поход (всего ЖЭ 20, типы свойств элит — отдельно). Походы без расписания и записи до 15.10.2026 — «—». Эвристика, не оценка баланса.';
function scheduleRows(runs: readonly RunRecord[]): (string | number)[][] {
  const mean = (list: readonly number[]): string => (list.length ? n1(list.reduce((a, b) => a + b, 0) / list.length) : '—');
  const rows: (string | number)[][] = scheduleStats(runs).map(s => [s.group, s.runs, s.fresh.length, mean(s.fresh), pct(s.fresh.filter(n => n >= 2).length, s.fresh.length), mean(s.peak), `${s.arcs} / ${s.practice}`, mean(s.metEnd)]);
  const without = runs.filter(r => !r.schedule).length;
  if (without) rows.push(['без расписания', without, '—', '—', '—', '—', '—', '—']);
  return rows.length ? rows : [['_походов нет_', '', '', '', '', '', '', '']];
}

/** Totals of the threats of a list of fights by kind (the test reads them). */
export function threatTotals(entries: readonly FightEntry[]): Record<string, ThreatTally> {
  const out: Record<string, ThreatTally> = {};
  for (const e of entries) for (const [k, t] of Object.entries(e.analysis?.summary.threats ?? {})) {
    const o = out[k] ??= { warned: 0, hit: 0, dodged: 0, shielded: 0, interrupted: 0, exitTicks: [] };
    o.warned += t.warned; o.hit += t.hit; o.dodged += t.dodged; o.shielded += t.shielded; o.interrupted += t.interrupted; o.exitTicks.push(...t.exitTicks);
  }
  return out;
}

// ---- Task 40 «Гарнизон» (docs/realtime-telemetry.md, «Гарнизон»; docs/realtime-slice.md, «Гарнизон») ----

/** A run row of a level as the report names it: «л N» — the forest, «г N» — the garrison, «з N» — the castle (task 55в). */
export const levelRowKey = (level: 1 | 2 | 3, row: number): string => `${level === 3 ? 'з' : level === 2 ? 'г' : 'л'} ${row}`;
/** The farthest run row a run reached on each level (from its node visits: a garrison node's id begins with `g:`, a castle one's with `c:`). */
export function runLevelRows(run: Pick<RunRecord, 'nodes'>): { forest: number; garrison: number; castle: number } {
  let forest = 0, garrison = 0, castle = 0;
  for (const n of run.nodes) { if (n.nodeId.startsWith('c:')) castle = Math.max(castle, n.row); else if (n.nodeId.startsWith('g:')) garrison = Math.max(garrison, n.row); else forest = Math.max(forest, n.row); }
  return { forest, garrison, castle };
}
/** The row a lost run died on («л N» / «г N» / «з N», its last node visit); null — not lost, or no visit. */
function deathRowKey(run: Pick<RunRecord, 'nodes' | 'outcome'>): string | null {
  const last = run.nodes[run.nodes.length - 1];
  return run.outcome === 'defeat' && last ? levelRowKey(last.nodeId.startsWith('c:') ? 3 : last.nodeId.startsWith('g:') ? 2 : 1, last.row) : null;
}
/** The numbers of the section (the tests read them). */
export interface GarrisonStats {
  runs: number;
  /** Runs that reached each row (keys «л 1» … «л 10», «г 1» … «г 10»), and the lost runs by the row they died on. */
  reached: Record<string, number>;
  deaths: Record<string, number>;
  /** Fights of the garrison (`FightRecord.level` 2 or a `g:` node): count, cuts per fight, frenzy kills, shackles. */
  fights: number; cuts: number[]; frenzyKills: number; shackles: number; shackleCuts: number; firstShackleCut: number[];
  /** Task 41: prisoners' riots and their kills (inside `frenzyKills`). */
  riots: number; riotKills: number;
  /** Task 41: HP the hero lost to rioting prisoners' touches. */
  riotDamage: number;
  /** Task 43: the hero's deaths in the garrison's fights by a bolt (the crossbowman's, the Castellan's). */
  boltDeaths: number;
  /** Task 43: knights seen, their armour shed, knights killed, chains on a knight (`garrison.knights` …). */
  knights: { seen: number; sheds: number; kills: number; chains: number };
  /** HP the garrison's fights took by source; the frenzied hounds' touches apart (`garrison.frenzyDamage`). */
  damage: Record<string, number>;
  /** Runs with the cart: what it took and the stock it was taken from. */
  carts: { n: number; before: number }[];
  /**
   * Task 59б (`garrison.step3`, `RunRecord.drill`): the fights on the step 3's own arenas — fights and deaths by arena; the formations
   * by one pass of those seen, the pairs cleared of those seen, the hero's seconds in pitch per fight with pitch, the pools lit per fight
   * with pitch and the fire of «Огненный проход»; the runs by drill.
   */
  step3: {
    arenas: Record<string, { fights: number; deaths: number }>;
    formations: number; drills: number; pairs: number; pairsCleared: number; angers: number;
    /** Design 22.10.2026: how the angers ended, over the records that have the counters (null — none has: older records). */
    angerEnds: { angers: number; killed: number; calm: number; atEnd: number } | null;
    pitchFights: number; pitchSeconds: number; fireFights: number; ignites: number; drill: Record<string, number>;
  };
}
/** Task 59б: the step 3's own arenas (spec 7.1; level design's — the report names them by id until they exist). */
const STEP3_ARENAS: readonly string[] = ['g-tarworks', 'g-barracks', 'g-barbican'];
const GARRISON_ROWS = 10;
export function garrisonStats(runs: readonly RunRecord[], runFights: readonly FightEntry[]): GarrisonStats {
  const reached: Record<string, number> = {}, deaths: Record<string, number> = {}, damage: Record<string, number> = {};
  for (const r of runs) {
    const far = runLevelRows(r);
    for (let row = 1; row <= GARRISON_ROWS; row++) {
      if (far.forest >= row || far.garrison > 0 || far.castle > 0) bump(reached, levelRowKey(1, row));
      if (far.garrison >= row || far.castle > 0) bump(reached, levelRowKey(2, row));
      // Task 55в: the castle's rows (shown only when a run reached one).
      if (far.castle >= row) bump(reached, levelRowKey(3, row));
    }
    const key = deathRowKey(r);
    if (key) bump(deaths, key);
  }
  const own = runFights.filter(e => fightLevel(e.record) === 2), sums = own.map(e => (e.analysis ? e.analysis.summary : withSummaryDefaults(e.record.summary)));
  for (const s of sums) {
    for (const [source, hp] of Object.entries(s.damage.bySource)) bump(damage, source, hp);
    if (s.garrison.frenzyDamage) { bump(damage, 'hound-frenzy', s.garrison.frenzyDamage); bump(damage, 'hound', -s.garrison.frenzyDamage); }
  }
  return {
    runs: runs.length, reached, deaths, fights: own.length, cuts: sums.map(s => s.chain.cuts), frenzyKills: sums.reduce((a, s) => a + s.chain.frenzyKills, 0),
    shackles: sums.reduce((a, s) => a + s.garrison.shackles, 0), shackleCuts: sums.reduce((a, s) => a + s.garrison.shackleCuts, 0),
    riots: sums.reduce((a, s) => a + s.garrison.riots, 0), riotKills: sums.reduce((a, s) => a + s.garrison.riotKills, 0), riotDamage: sums.reduce((a, s) => a + s.garrison.riotDamage, 0), boltDeaths: sums.filter(s => s.death?.source === 'bolt' || s.death?.source === 'castellan-bolt').length,
    firstShackleCut: sums.flatMap(s => (s.garrison.firstShackleCut === null ? [] : [s.garrison.firstShackleCut])), damage,
    knights: { seen: sums.reduce((a, s) => a + s.garrison.knights, 0), sheds: sums.reduce((a, s) => a + s.garrison.knightSheds, 0), kills: sums.reduce((a, s) => a + s.garrison.knightKills, 0), chains: sums.reduce((a, s) => a + s.garrison.knightChains, 0) },
    carts: runs.flatMap(r => (r.cart ? [{ n: r.cart.n, before: r.cart.before }] : [])),
    step3: step3Stats(runs, own, sums),
  };
}

/** Task 59б: the step 3's numbers of the garrison's fights (`garrisonStats`). */
function step3Stats(runs: readonly RunRecord[], own: readonly FightEntry[], sums: readonly FightSummary[]): GarrisonStats['step3'] {
  const arenas: GarrisonStats['step3']['arenas'] = {}, drill: Record<string, number> = {};
  own.forEach((e, i) => {
    if (!STEP3_ARENAS.includes(e.record.arena)) return;
    const a = arenas[e.record.arena] ??= { fights: 0, deaths: 0 };
    a.fights++;
    if (sums[i].death) a.deaths++;
  });
  for (const r of runs) if (r.drill) bump(drill, r.drill);
  const all = sums.flatMap(s => (s.garrison.step3 ? [{ s, t: s.garrison.step3 }] : []));
  const pitch = all.filter(x => x.t.pots > 0), fire = pitch.filter(x => (x.s.build.fired['fire-pass'] ?? 0) > 0);
  const ended = all.filter(x => x.t.angerKilled !== undefined), sum = (f: (t: GarrisonStep3Summary) => number): number => ended.reduce((a, x) => a + f(x.t), 0);
  return {
    arenas, drill,
    formations: all.reduce((a, x) => a + x.t.formations, 0), drills: all.reduce((a, x) => a + x.t.drills, 0),
    pairs: all.reduce((a, x) => a + x.t.pairs, 0), pairsCleared: all.reduce((a, x) => a + x.t.pairsCleared, 0), angers: all.reduce((a, x) => a + x.t.angers, 0),
    angerEnds: ended.length ? { angers: sum(t => t.angers), killed: sum(t => t.angerKilled ?? 0), calm: sum(t => t.angerCalm ?? 0), atEnd: sum(t => t.angerAtEnd ?? 0) } : null,
    pitchFights: pitch.length, pitchSeconds: pitch.reduce((a, x) => a + x.t.pitchSeconds, 0),
    fireFights: fire.length, ignites: fire.reduce((a, x) => a + x.t.ignites.path + x.t.ignites.burning, 0),
  };
}
const GARRISON_SOURCES: readonly [string, string][] = [
  ['hound', 'пёс (на поводке или после ярости)'], ['hound-frenzy', 'пёс в ярости'], ['guard', 'стражник'], ['handler', 'псарь'], ['keymaster', 'ключник'],
  ['lunge', '«Спустить пса»'], ['castellan', 'Кастелян'], ['bolt', 'болт арбалетчика'], ['castellan-bolt', 'болт Кастеляна'], ['knight', 'рыцарь (касание)'], ['knight-charge', 'рывок рыцаря'], ['knight-swing', 'размах рыцаря'],
  // Task 59б: the step 3's kinds.
  ['pot', 'горшок смолокура'], ['pitcher', 'смолокур (касание)'], ['recruit', 'новобранец'], ['warden', 'привратник (касание)'], ['warden-swing', 'размах привратника'], ['touch', 'обычные враги'],
];
const GARRISON_LEGEND = 'Задача 40 (с 16.10.2026; эвристика, не оценка баланса): походы через оба уровня — лес («л N») и гарнизон («г N»), ряд по посещённым узлам (`RunRecord.nodes`: узел гарнизона — `g:…`); задача 55в — ряды замка («з N», узел `c:…`) видны, когда поход до них дошёл. Дошли — походы, вошедшие в узел этого ряда (поход в гарнизоне прошёл все ряды леса); доля — от всех походов отчёта. Смерти — проигранные походы по ряду последнего узла. Бои гарнизона — `FightRecord.level` 2 (или узел `g:`): рубки за бой (`chain.cuts`: поводки и кандалы), убийства яростью пса и узника (`chain.frenzyKills`, не в зачёт игроку), кандалы надеты и разрублены, срывы узников, их убийства и урон герою от их касаний (`garrison.riots`, `riotKills`, `riotDamage`, задача 41), секунда первой рубки кандалов (`garrison`), урон герою по источникам (`damage.bySource`; касания пса в ярости — `garrison.frenzyDamage` — отдельно). Рыцари (задача 43): встречено, латы сняты, убито (любым источником), цепей на рыцаря (`garrison.knights`, `knightSheds`, `knightKills`, `knightChains`). Повозка — сдача у «Предместья» (`RunRecord.cart`). Шаг 3 (задача 59б, `garrison.step3`): бои и смерти на «Смолокурне», «Казарме», «Барбакане»; строёв новобранцев одним проходом из встреченных (`drills` / `formations`); пар привратников без гнева из встреченных (`pairsCleared` / `pairs`) и гневов; секунд героя в смоле на бой со смолой (бой, где бросали горшки); поджогов на бой со смолой и «Огненным проходом»; походы по набору троп (`RunRecord.drill`). Цель плейтеста — отсев 10–15 п. п. на уровень и нет ряда, где смертей больше, чем у обоих соседей.';
export function garrisonSection(runs: readonly RunRecord[], runFights: readonly FightEntry[]): string {
  const st = garrisonStats(runs, runFights);
  if (!st.runs && !st.fights) return `${GARRISON_LEGEND}\n\n_походов и боёв гарнизона нет_`;
  const keys = [...Array.from({ length: GARRISON_ROWS }, (_, i) => levelRowKey(1, i + 1)), ...Array.from({ length: GARRISON_ROWS }, (_, i) => levelRowKey(2, i + 1)), ...Array.from({ length: GARRISON_ROWS }, (_, i) => levelRowKey(3, i + 1))];
  const shown = keys.filter((k, i) => i < GARRISON_ROWS || (st.reached[k] ?? 0) > 0 || (st.deaths[k] ?? 0) > 0);
  const curve = shown.map(k => [k, st.reached[k] ?? 0, pct(st.reached[k] ?? 0, st.runs), st.deaths[k] ?? 0]);
  const mean = (list: readonly number[]): string => (list.length ? n1(list.reduce((a, b) => a + b, 0) / list.length) : '—');
  const fights = st.fights ? table(['Боёв', 'Рубок за бой, среднее', 'Боёв с рубкой', 'Убийств яростью (пёс и узник)', 'Кандалы надеты', 'Кандалы разрублены', 'Первая рубка кандалов, с мед.', 'Срывов узников', 'Убийств узниками', 'Урон герою от узников, HP', 'Смертей от болта'],
    [[st.fights, mean(st.cuts), st.cuts.filter(n => n > 0).length, st.frenzyKills, st.shackles, st.shackleCuts, st.firstShackleCut.length ? n1(median(st.firstShackleCut)) : '—', st.riots, st.riotKills, st.riotDamage, st.boltDeaths]]) : '_боёв гарнизона нет_';
  const total = Object.values(st.damage).reduce((a, b) => a + b, 0);
  const damage = GARRISON_SOURCES.filter(([id]) => (st.damage[id] ?? 0) > 0).map(([id, title]) => [title, st.damage[id], pct(st.damage[id], total)]);
  const other = total - GARRISON_SOURCES.reduce((a, [id]) => a + Math.max(0, st.damage[id] ?? 0), 0);
  if (other > 0) damage.push(['прочее', other, pct(other, total)]);
  // Task 43: the knights of the garrison's fights.
  const k = st.knights;
  const knights = k.seen ? `Рыцари: встречено ${k.seen}, латы сняты ${k.sheds}, убито ${k.kills}, цепей на рыцаря ${k.chains} (на одного ${n1(k.chains / k.seen)}).` : 'Рыцарей в боях гарнизона нет.';
  const carts = st.carts.length ? `Повозка: походов ${st.carts.length}, сдано мед. ${n1(median(st.carts.map(c => c.n)))}, запас до сдачи мед. ${n1(median(st.carts.map(c => c.before)))}.` : 'Повозка: сдач нет.';
  // Task 59б: the step 3.
  const t = st.step3, ratio = (a: number, b: number): string => (b ? `${a} из ${b} (${pct(a, b)})` : '—');
  const step3Arenas = STEP3_ARENAS.filter(id => t.arenas[id]).map(id => [arenaTitle(id), t.arenas[id].fights, t.arenas[id].deaths, pct(t.arenas[id].deaths, t.arenas[id].fights)]);
  const step3 = [step3Arenas.length ? table(['Арена шага 3', 'Боёв', 'Смертей', 'Доля'], step3Arenas) : '_боёв на аренах шага 3 нет_', '',
    `Шаг 3: строёв одним проходом ${ratio(t.drills, t.formations)}; пар без гнева ${ratio(t.pairsCleared, t.pairs)}, гневов ${t.angers}, конец гнева: ${t.angerEnds ? `убит в гневе ${t.angerEnds.killed}, остыл ${t.angerEnds.calm}, бой кончился ${t.angerEnds.atEnd}${t.angerEnds.angers < t.angers ? ` (из ${t.angerEnds.angers} гневов со счётчиком)` : ''}` : '—'}; в смоле ${t.pitchFights ? n1(t.pitchSeconds / t.pitchFights) : '—'} с на бой со смолой (${t.pitchFights}); поджогов ${t.fireFights ? n1(t.ignites / t.fireFights) : '—'} на бой со смолой и огнём (${t.fireFights}). Набор троп: ${Object.keys(t.drill).length ? Object.entries(t.drill).map(([d, n]) => `${d === 'barracks' ? '«Казарма»' : '«Ристалище»'} ${n}`).join(', ') : '—'}.`].join('\n');
  return [GARRISON_LEGEND, '', table(['Ряд', 'Дошли', 'Доля', 'Смертей'], curve), '', fights, '',
    damage.length ? table(['Урон герою в гарнизоне', 'HP', 'Доля'], damage) : '_урона в боях гарнизона нет_', '', knights, '', carts, '', step3].join('\n');
}

/**
 * Task 57а «Лес: стрелки» (heuristic, not a balance verdict): the fights where a new shooter acted (a windup of a slinger or a hive, a
 * wisp seen) — by arena: fights, deaths and their sources, the hero's damage from the shots and the wisps and its share of all his
 * damage there, the fight's length; the volleys, the shots' ends and the wisps in all.
 */
const FOREST_SOURCES: readonly string[] = ['stone', 'wasp', 'wisp'];
const FOREST_LEGEND = 'Задача 57а (с 17.10.2026; эвристика, не оценка баланса): бои, где действовал новый стрелок леса — замах пращника или улья (`forest.volleys`) или светляк на арене (`forest.wisps.appeared`), по аренам: боёв, смертей и их источники, урон герою от камней, ос и светляков (`damage.bySource`: `stone`, `wasp`, `wisp`) и его доля во всём уроне этих боёв, длина боя (игровые секунды, медиана). Ниже — замахи по виду, концы снарядов (попали, щит, погашено проходом и бомбой — `snuffShots`) и светляки (появилось, убито цепью, коснулось героя, щит, погасло само).';
export function forestShootersSection(fights: readonly FightEntry[]): string {
  const own = fights.map(e => ({ e, s: e.analysis ? e.analysis.summary : withSummaryDefaults(e.record.summary) }))
    .filter(({ s }) => Object.keys(s.forest.volleys).length > 0 || s.forest.wisps.appeared > 0);
  if (!own.length) return `${FOREST_LEGEND}\n\n_боёв с новыми стрелками нет_`;
  const arenas = [...new Set(own.map(x => x.e.record.arena))].sort();
  const rows = arenas.map(arena => {
    const list = own.filter(x => x.e.record.arena === arena), deaths = list.filter(x => x.s.death);
    const from = list.reduce((a, x) => a + FOREST_SOURCES.reduce((b, id) => b + (x.s.damage.bySource[id] ?? 0), 0), 0), total = list.reduce((a, x) => a + x.s.damage.total, 0);
    const bySource = FOREST_SOURCES.map(id => `${sourceTitle(id)} ${deaths.filter(x => x.s.death?.source === id).length}`).join(', ');
    return [arenaTitle(arena), list.length, deaths.length, bySource, from, pct(from, total), n1(median(list.map(x => x.e.record.time)))];
  });
  const sum = (f: (s: FightSummary['forest']) => number): number => own.reduce((a, x) => a + f(x.s.forest), 0);
  const kinds = (pick: (s: FightSummary['forest']) => Record<string, number>, title: (k: string) => string = sourceTitle): string => {
    const all: Record<string, number> = {};
    for (const x of own) for (const [k, n] of Object.entries(pick(x.s.forest))) all[k] = (all[k] ?? 0) + n;
    return Object.keys(all).length ? Object.entries(all).map(([k, n]) => `${title(k)} ${n}`).join(', ') : '—';
  };
  const volleys = kinds(s => s.volleys, kindTitle);
  return [FOREST_LEGEND, '', table(['Арена', 'Боёв', 'Смертей', 'Смертей по источнику', 'Урон от снарядов и светляков, HP', 'Доля урона', 'Длина боя, с мед.'], rows), '',
    `Замахи: ${volleys}. Снаряды: попали ${kinds(s => s.shots.hit)}; щит ${kinds(s => s.shots.block)}; погашено проходом ${sum(s => s.shots.snuffDash)}, бомбой ${sum(s => s.shots.snuffBomb)}.`,
    `Светляки: появилось ${sum(s => s.wisps.appeared)}, убито цепью ${sum(s => s.wisps.chainKills)}, коснулось героя ${sum(s => s.wisps.touched)}, щит ${sum(s => s.wisps.blocked)}, погасло само ${sum(s => s.wisps.faded)}.`].join('\n');
}
