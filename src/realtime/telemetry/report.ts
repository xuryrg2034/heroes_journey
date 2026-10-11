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
import { worldState } from '../sim/hash';
import { copyParams, type Params } from '../sim/params';
import { Simulation, type Journal } from '../sim/simulation';
import type { Loadout } from '../sim/kit';
import type { World } from '../sim/world';
import { createFightObserver, median, WOLF_RUSH_SOURCE } from './observe';
import {
  checkRecord, emptyFightSummary, orderedParts, unpackJournal, withSummaryDefaults, OATH_STAKE_SOURCE, DIE_SOURCE, CASINO_SOURCE, RT_TELEMETRY_FORMAT, SANDBOX_RUN,
  type FightRecord, type FightSummary, type JournalPart, type NoteRecord, type RtRecord, type RunRecord, type ThreatTally,
} from './schema';
import { THREAT_KINDS, ThreatTracker, type ThreatWarning } from './threats';
import { RT_KIND_TITLES } from '../run/rtRunEnd';

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
      entry.summaryDiff = summaryDiff(record.summary, entry.analysis.summary);
    } catch (e) { entry.error = `повтор не удался: ${(e as Error).message}`; }
  }
  const orphanNotes = [...notes.entries()].filter(([path]) => !fights.some(f => fightPath(f) === path)).flatMap(([, list]) => list);
  return { fights: out, orphanNotes };
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
  quills: 'иглы', 'fire-trail': 'огонь элиты', thorns: 'терновник', reaper: 'жнец',
};
const THREAT_TITLES: Record<string, string> = {
  archer: 'метка лучника', boar: 'полоса кабана', wolf: 'бросок стаи волков', lynx: 'прыжок рыси', sapper: 'фитиль и взрыв сапёра', 'sapper-instant': 'взрыв сапёра без предупреждения',
};
const OUTCOME_TITLES: Record<string, string> = { victory: 'победа', defeat: 'поражение', abandoned: 'брошен', open: 'не закончен', restart: 'заново', menu: 'выход в меню', unload: 'страница закрыта' };

const kindTitle = (k: string): string => { const elite = k.endsWith('*'), base = elite ? k.slice(0, -1) : k; return `${KIND_TITLES[base] ?? SOURCE_TITLES[base] ?? base}${elite ? ' (элита)' : ''}`; };
const sourceTitle = (s: string): string => SOURCE_TITLES[s] ?? s;
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
  if (!list.length) return ['—', '—', '—'];
  let count = 0, tough = 0, survivor = 0;
  const draw: number[] = [];
  for (const s of list) { count += s.chain.count; tough += s.chain.toughNotFirst ?? 0; survivor += s.chain.survivorEnds; draw.push(...s.chain.drawTime ?? []); }
  // П1: real seconds from the first link to the release, median per released chain (a record of an older build has none: «—»).
  return [`${tough} (${pct(tough, count)})`, `${survivor} (${pct(survivor, count)})`, draw.length ? n2(median(draw)) : '—'];
}
const CHAIN_SHARE_HEAD = ['Крепкий не первым', 'На выжившем', 'Рисование мед., с'];

function fightRows(entries: readonly FightEntry[]): (string | number)[][] {
  return entries.map(e => {
    const r = e.record, a = e.analysis, s = a?.summary;
    return [
      `\`${r.fight}\``, r.nodeId ?? '—', r.row ?? '—', arenaTitle(r.arena), r.roster ?? '—', OUTCOME_TITLES[r.outcome] ?? r.outcome, n1(r.time),
      `${r.hpIn} → ${r.hpOut}`, s ? s.damage.total : '—', s ? s.chain.count : '—', s ? `${n1(s.chain.lengthMedian)} / ${s.chain.lengthMax}` : '—', s ? s.kills.chain : '—',
      ...chainShareCells(s ? [s] : []), ...loopCells(s ? [s] : []),
      e.error ? `ошибка: ${e.error}` : e.hashOk ? 'совпал' : 'НЕ совпал',
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
  const deaths = list.filter(e => e.record.outcome === 'defeat' && e.analysis!.summary.tempo.afterGoals !== null).length;
  return [
    label, `${list.length} из ${entries.length}`, `${pulled} (${pct(pulled, list.length)})`, n1(median(slots.map(x => x.pulls))),
    links.length ? n1(median(links)) : '—', Object.entries(outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—',
    `${sum(x => x.effects)} / ${sum(x => x.cancelled)}`, `${sum(x => x.damage.volley)} / ${sum(x => x.damage.rain)}`, sum(x => x.kills), deaths,
    appearAt.length ? n1(median(appearAt)) : '—', after.length ? n1(median(after)) : '—',
  ];
}
const SLOT_HEAD = ['Бои', 'С гоблином', 'С рывком', 'Рывков мед.', 'Звеньев на рычаг мед.', 'Исходы', 'Эффектов / отменено', 'Урон залп / дождь', 'Убито стрелами', 'Смертей после целей', 'Появился после целей мед., с', 'После целей мед., с'];
const SLOT_LEGEND = 'Бои с гоблином и их доля среди всех боёв группы. «С рывком» — бои, где рычаг дёрнули хоть раз. Звенья — вражеские звенья, по которым рывок ударил до рычага. Исходы — `rain` (☠☠☠), `volley` (два ☠), тройки `heart3`, `bolt3`, `gem3`, `jackpot`, пары `heart`, `bolt`, `gem`, `pot`, `none`. «Отменено» — бой кончился, пока крутились барабаны. «После целей» — игровые секунды от целей до конца боя (цель дизайна: медиана 15–30 с).';

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
const PURSE_LEGEND = 'Котёл (`purse`; в походе включён): чек цепи — угли × жар × кристаллы (`cheque`), один на рывок с вражеским звеном. Угли убийств сборки — 1 за убитого молотом, волной или стрелой гоблина (`purseKill`), по источнику. Ресурсы — ⌊котёл × клятва ÷ 60⌋ (`purseRate`; клятва ×2 / ×0,5, без неё ×1), не больше 3 без клятвы, 6 с выполненной, 1 с нарушенной (`purseDoor`). Это выплата без кости: кость похода — раздел «Кость у двери». Ступень раздува (П4 «Раздув за дела», `greedByDeeds`; в походе включён с 11.10.2026) — `purse.exitStep`, двери по ступеням ×1 / ×1,5 / ×2 / ×3; котёл в двери умножается на ступень, потолок выплаты прежний. «—» — нет дверей с правилом (и все записи до него). Выход в дверь (`purse.exitBy`, с 12.10.2026) — цепью, прыжком или ходьбой; цепь в дверь с П3 «Финальная цепь» (`doorFinale`; в походе включён с 12.10.2026) получает +1 жар. «—» — записи до 12.10.2026.';
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
    '### Расходники в боях', '', table(['Расходник', 'Использован'], usedRows),
  ].join('\n');
}

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
    const death = d ? `${d.enemy ? kindTitle(d.enemy) : '—'}, ${sourceTitle(d.source)}${d.elite ? ', элита' : ''}${d.affixes?.length ? ` (${d.affixes.join(', ')})` : ''}${d.fight ? ` — \`${d.fight}\`${d.tick !== undefined ? `, такт ${d.tick}` : ''}` : ''}` : '—';
    const fights = entries.filter(e => e.record.run === r.run).length;
    return [`\`${r.run}\``, r.session, r.tester ?? '—', r.seed, OUTCOME_TITLES[r.outcome] ?? r.outcome, r.farRow, death, fights, r.nodes.map(n => `${n.nodeId} ${n.hpIn}→${n.hpOut}`).join(', ') || '—'];
  });
  const choices = runs.flatMap(r => r.choices.map(c => [`\`${r.run}\``, c.nodeId, c.source, c.offered.join(', ') || '—', c.taken.join(', ') || '—', c.refused.join(', ') || '—']));
  const kits = runs.map(r => `- \`${r.run}\`: HP ${r.kit.hp}/${r.kit.maxHp}; талисманы ${r.kit.talismans.join(', ') || 'нет'}; молот ${r.kit.hammer ?? 'нет'}`);
  return [
    table(['Поход', 'Сессия', 'Тестер', 'Seed', 'Итог', 'Дальний ряд', 'Причина смерти', 'Боёв в логах', 'HP по узлам'], rows), '',
    '### Выборы', '', table(['Поход', 'Узел', 'Что', 'Предложено', 'Взято', 'Отказ'], choices), '',
    '### Сборка в конце', '', kits.join('\n'),
  ].join('\n');
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
  const bad = fights.filter(e => e.hashOk === false), broken = fights.filter(e => e.error), partial = fights.filter(e => e.record.outcome === 'unload');
  const diffs = fights.filter(e => e.summaryDiff.length);
  const out: string[] = [
    '# Отчёт плейтеста реального времени', '',
    `Собран ${options.now.toISOString()}. Источник: \`${options.source}\`. Записей: ${set.records.length} (дублей убрано: ${set.duplicates}). Походов: ${runs.length}, боёв: ${fights.length} (песочница: ${sandbox.length}), отметок: ${notes}.`,
    'Метрики посчитаны повтором журналов в Node (`src/realtime/telemetry/observe.ts`, `threats.ts`); определения — docs/realtime-telemetry.md, разделы 3, 7 и 8 («ТB»).', '',
    '## Ошибки детерминизма', '',
  ];
  if (!bad.length && !broken.length) out.push(`Нет: все ${fights.length} журналов повторились с тем же хэшем.`);
  else {
    if (bad.length) out.push('Повтор журнала дал другой хэш, чем записан в бою, — найденная ошибка детерминизма (или журнал испорчен).', '',
      table(['Бой', 'Поход', 'Арена', 'Тактов', 'endHash', 'Хэш повтора'], bad.map(e => [`\`${e.record.fight}\``, e.record.run, arenaTitle(e.record.arena), e.analysis!.ticks, `\`${e.record.endHash}\``, `\`${e.analysis!.hash}\``])), '');
    if (broken.length) out.push('Журналы, которые не удалось собрать или повторить:', '', ...broken.map(e => `- \`${fightPath(e.record)}\`: ${e.error}`), '');
  }
  if (set.problems.length) out.push('', '### Записи, которые не прочитаны', '', ...set.problems.map(p => `- ${p}`));
  if (partial.length) out.push('', '### Неполные журналы', '', 'Страница закрылась посреди боя (`outcome: unload`): журнал повторён до своих тактов, метрики — за это время.', '',
    ...partial.map(e => `- \`${fightPath(e.record)}\`: ${e.record.ticks} тактов, ${arenaTitle(e.record.arena)}`));
  if (diffs.length) out.push('', '### Сводка браузера расходится с повтором', '', ...diffs.map(e => `- \`${fightPath(e.record)}\`: ${e.summaryDiff.slice(0, 8).join('; ')}${e.summaryDiff.length > 8 ? ' …' : ''}`));
  out.push('', '## Походы', '', runsSection(runs, fights), '',
    '## Бои походов', '', table(FIGHT_HEAD, fightRows(runFights)), '',
    '## Арены', '', 'Бои походов и песочницы вместе. ' + LOOP_LEGEND, '', arenasSection(fights), '',
    '## Враги', '', damageSections(fights), '',
    '## Элиты', '', ELITE_LEGEND, '', table(ELITE_HEAD, eliteRows(runFights, sandbox)), '',
    '## Однорукий гоблин', '', SLOT_LEGEND, '', table(SLOT_HEAD, [slotRow('походы', runFights), slotRow('песочница', sandbox)].filter((r): r is (string | number)[] => !!r)), '',
    // Casino «Котёл».
    '## Котёл', '', PURSE_LEGEND, '', table(PURSE_HEAD, purseRows(runFights, sandbox)), '',
    // Casino «Ставка клятвы».
    '## Ставка клятвы', '', OATH_LEGEND, '', table(OATH_HEAD, oathRows(runs, fights)), '',
    // К7 «Проклятый сундук».
    '## Проклятый сундук', '', CHEST_LEGEND, '', table(CHEST_HEAD, chestRows(runFights, sandbox)), '',
    // Casino «Кость у двери».
    '## Кость у двери', '', DIE_LEGEND, '', table(DIE_HEAD, [dieRow(runs)].filter((r): r is (string | number)[] => !!r)), '',
    '## Угрозы', '',
    'Предупреждения с героем в зоне при появлении. «Попал» — удар этого врага этим источником; «защищён» — тело в зоне в такт удара, но неуязвимость, щит цепи, проход, прыжок или пощада фокуса; «увернулся» — в такт удара тело вне зоны («укрытие» — рывок кабана или волка остановила стена или дерево, «стена», или край обрыва, «обрыв»); «прервано» — враг умер, отброшен, сбросил атаку или бой кончился. Выход — от появления зоны (у стаи волков — от начала воя) до первого такта вне неё (только увороты).', '',
    table(THREAT_HEAD, threatRows(fights)), '',
    '## Предметы', '', itemsSection(runs, fights), '',
    '## Отметки N', '', notesSection(analysis, options.source), '',
    '## Песочница', '', sandbox.length ? [table(FIGHT_HEAD, fightRows(sandbox)), '', ...secondWindLine(sandbox) ? [secondWindLine(sandbox)!, ''] : [], '### Угрозы в песочнице', '', table(THREAT_HEAD, threatRows(sandbox))].join('\n') : '_боёв песочницы нет_', '');
  return out.join('\n');
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
