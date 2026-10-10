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
  checkRecord, emptyFightSummary, orderedParts, unpackJournal, RT_TELEMETRY_FORMAT, SANDBOX_RUN,
  type FightRecord, type FightSummary, type JournalPart, type NoteRecord, type RtRecord, type RunRecord, type ThreatTally,
} from './schema';
import { THREAT_KINDS, ThreatTracker, type ThreatWarning } from './threats';

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

/** Paths where two summaries differ (the browser's against the replay's); `inView` and `threats` are left out. */
function summaryDiff(browser: FightSummary, replayed: FightSummary): string[] {
  if (JSON.stringify(browser) === JSON.stringify(emptyFightSummary())) return [];
  const a = JSON.parse(JSON.stringify(browser)) as FightSummary, b = JSON.parse(JSON.stringify(replayed)) as FightSummary;
  a.threats = {}; b.threats = {};
  delete a.tempo.inView; delete b.tempo.inView;
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string): void => {
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x))) out.push(`${path}: ${x} ≠ ${y}`); return; }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  };
  walk(a, b, '');
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
  for (const record of fights) {
    const run = runs.get(runPath(record)) ?? null;
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

const KIND_TITLES: Record<string, string> = {
  basic: 'обычный', wolf: 'волк', boar: 'кабан', reaper: 'жнец', shield: 'щитоносец', archer: 'лучник', sapper: 'сапёр', porcupine: 'дикобраз', lynx: 'рысь', shaman: 'шаман',
};
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

function fightRows(entries: readonly FightEntry[]): (string | number)[][] {
  return entries.map(e => {
    const r = e.record, a = e.analysis, s = a?.summary;
    return [
      `\`${r.fight}\``, r.nodeId ?? '—', r.row ?? '—', arenaTitle(r.arena), r.roster ?? '—', OUTCOME_TITLES[r.outcome] ?? r.outcome, n1(r.time),
      `${r.hpIn} → ${r.hpOut}`, s ? s.damage.total : '—', s ? s.chain.count : '—', s ? `${n1(s.chain.lengthMedian)} / ${s.chain.lengthMax}` : '—', s ? s.kills.chain : '—',
      e.error ? `ошибка: ${e.error}` : e.hashOk ? 'совпал' : 'НЕ совпал',
    ];
  });
}
const FIGHT_HEAD = ['Бой', 'Узел', 'Ряд', 'Арена', 'Состав', 'Итог', 'Время, с', 'HP', 'Урон', 'Цепей', 'Длина мед. / макс.', 'Убито цепью', 'Хэш'];

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
  const low: string[] = [];
  for (const e of entries) {
    const s = e.analysis?.summary;
    if (!s) continue;
    kills.chain += s.kills.chain; kills.enemies += s.kills.enemies;
    for (const [k, v] of Object.entries(s.kills.tools)) bump(kills.tools, k, v);
    if (s.damage.lowHp.length) low.push(`\`${e.record.fight}\` (${e.record.run}): ${s.damage.lowHp.map(m => `такт ${m.tick} — ${m.hp} HP`).join(', ')}`);
  }
  const tools = Object.entries(kills.tools).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет';
  return [
    '### Урон по видам врагов', '', '«(элита)» — удары элиты. Удары без врага (терновник) — по источнику.', '',
    table(['Вид', 'Ударов', 'Урон', 'Доля урона', 'Источники'], kinds), '',
    '### Урон по источникам', '', table(['Источник', 'Ударов', 'Урон', 'Доля'], sources), '',
    '### Убийства', '', `Цепью: ${kills.chain}. Инструментами игрока: ${tools}. Способностями врагов (без зачёта): ${kills.enemies}.`, '',
    '### Моменты HP ≤ 3', '', low.length ? low.map(l => `- ${l}`).join('\n') : '_нет_',
  ].join('\n');
}

function itemsSection(runs: readonly RunRecord[], entries: readonly FightEntry[]): string {
  const rows = new Map<string, { kinds: Set<string>; offered: number; taken: number; refused: number; fired: number; fights: number; active: number }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { kinds: new Set(), offered: 0, taken: 0, refused: 0, fired: 0, fights: 0, active: 0 }).get(id)!;
  for (const run of runs) for (const c of run.choices) {
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
    const fights = entries.filter(e => e.record.session === r.session && e.record.run === r.run).length;
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
    ];
  });
  return table(['Арена', 'Боёв', 'Побед', 'Поражений', 'Время ср., с', 'Урон ср.', 'Цепей ср.', 'Убито цепью ср.', 'До целей ср., с', 'Врагов ср. / макс.', 'Путь ср.', 'На месте ср., с'], rows);
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
  const runs = set.records.filter((r): r is RunRecord => r.kind === 'run').sort((a, b) => a.id.localeCompare(b.id));
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
    '## Арены', '', 'Бои походов и песочницы вместе.', '', arenasSection(fights), '',
    '## Враги', '', damageSections(fights), '',
    '## Угрозы', '',
    'Предупреждения с героем в зоне при появлении. «Попал» — удар этого врага этим источником; «защищён» — тело в зоне в такт удара, но неуязвимость, щит цепи, проход, прыжок или пощада фокуса; «увернулся» — в такт удара тело вне зоны («укрытие» — рывок кабана или волка остановила стена или дерево, «стена», или край обрыва, «обрыв»); «прервано» — враг умер, отброшен, сбросил атаку или бой кончился. Выход — от появления зоны (у стаи волков — от начала воя) до первого такта вне неё (только увороты).', '',
    table(THREAT_HEAD, threatRows(fights)), '',
    '## Предметы', '', itemsSection(runs, fights), '',
    '## Отметки N', '', notesSection(analysis, options.source), '',
    '## Песочница', '', sandbox.length ? [table(FIGHT_HEAD, fightRows(sandbox)), '', '### Угрозы в песочнице', '', table(THREAT_HEAD, threatRows(sandbox))].join('\n') : '_боёв песочницы нет_', '');
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
