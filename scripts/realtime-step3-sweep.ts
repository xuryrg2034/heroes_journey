/**
 * Task 59б (design 21.10.2026; spec docs/design-notes/task-59-garrison-step3.md, 13; the lead's scheme): the sweep of the step-3 inflow
 * shares — «Смолокурня» `PITCHER_SHARE`, «Казарма» `RECRUIT_SHARE`, «Барбакан» `BARBICAN_PAIR_SHARE` — by the bot of the measures
 * (scripts/garrisonBot.ts with its three step-3 skills, scripts/step3Bot.ts). A heuristic for the design, not a test (no assertion of a
 * victory or a defeat); the numbers go to the docs with the date. Node only. Two steps, each its own process (memguard, one at a time):
 *
 * 1. `npx tsx scripts/realtime-step3-sweep.ts --collect FILE [--runs 300] [--limit 240]` — the entries: the curve's pass «гарнизон»
 *    (scripts/realtime-garrison-curve.ts: the forest walked, the garrison's fights real from «Предместье») with the run's flag `step3`
 *    and the planner bot; at each battle on a step-3 arena or a reference arena («Ристалище», «Бойницы», «Ров») the run as it stands
 *    (HP, loadout, row) is saved to FILE.
 * 2. `npx tsx scripts/realtime-step3-sweep.ts --entries FILE --arena ID [--fights 300] [--limit 240] [--save OUT]` — the arena's fights: `--fights`
 *    seeds per variant of the share (0 / the hypothesis / ×2; a reference arena — as it is), the entries taken in a cycle, the same
 *    entry and seed `Math.imul(i, 2654435761) >>> 0` for every variant (a paired comparison). «Барбакан» — each variant twice: the
 *    «careless» bot and the «planner». «Смолокурня» and «Бойницы» also play the hero who stands 6 s (criterion 4). `--save OUT` keeps each
 *    variant's fights (row, death) for step 3.
 * 3. `npx tsx scripts/realtime-step3-sweep.ts --compare A B` — criterion 1 (design 21.10.2026: «Казарма» within ±5 p. p. of «Ристалище»,
 *    by the same entry rows, weighted): each variant of A against the first variant of B, row by row, weighted by A's rows —
 *    Σ w·(pA − pB) ± √Σ w²(seA² + seB²); a row B never played is left out (its weight named).
 *
 * The share is put on by the SCRIPT into the registered template it plays (the game keeps its numbers; such a fight does not replay from
 * a journal of the real template), and set back after. Every rate with its standard error; the difference of a variant from the
 * hypothesis — the paired one (the mean of the per-fight differences and its standard error). «Цвет A среди пришедших» counts the
 * newcomers that came while a pair stood, as the player sees them; it is below the draw's share (`pairShare` + (1 − share) / colours):
 * the start's queue is drawn before the pair has its colours, and a pair broken early ends the count.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { arenaTemplate } from '../src/realtime/sim/arenas';
import '../src/realtime/sim/arenasBoss';
import { BARBICAN_ARENA, BARBICAN_PAIR_SHARE, BARRACKS_ARENA, PITCHER_SHARE, RECRUIT_SHARE, TARWORKS_ARENA } from '../src/realtime/sim/arenasStep3';
import { PITCHER } from '../src/realtime/sim/enemies/pitcher';
import { RECRUIT, recruitGroup, recruitNumber } from '../src/realtime/sim/enemies/recruit';
import { WARDEN } from '../src/realtime/sim/enemies/warden';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { inPitch } from '../src/realtime/sim/pitch';
import { Simulation, SIM_DT } from '../src/realtime/sim/simulation';
import type { Loadout } from '../src/realtime/sim/kit';
import type { World } from '../src/realtime/sim/world';
import { runRow } from '../src/realtime/run/arenaPools';
import { rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import { parseRtRun, rtArenaLoadout, rtArenaParams, rtNode, rtRunParams, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { botFight } from './garrisonBot';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const LIMIT = Number(option('--limit', '240'));
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const head = (): string => { try { return String(execSync('git rev-parse --short HEAD')).trim(); } catch { return '?'; } };
const today = (): string => new Date().toISOString().slice(0, 10);

/** The step-3 arenas and the references the criteria compare them with (design 21.10.2026: «Ристалище», «Бойницы», «Ров»). */
const STEP3 = [TARWORKS_ARENA.id, BARRACKS_ARENA.id, BARBICAN_ARENA.id];
const REFERENCES = ['g-armory', 'g-loopholes', 'g-moat'];

/** A saved entry: the run at its battle on the arena, its row. */
interface Entry { arena: string; row: number; run: string }

// ---- Step 1: the entries ----

function collect(file: string, runs: number): void {
  const started = Date.now(), entries: Entry[] = [];
  for (let k = 1; k <= runs; k++) {
    walkRun({ k, create: { gift: k % 2 ? 'full' : 'mini', garrison: true, step3: true }, fight: run => {
      if (!run.garrisonLevel) return null;
      const pending = run.pending;
      if (pending?.kind !== 'battle') throw new Error('no battle');
      if ([...STEP3, ...REFERENCES].includes(pending.arena) && rtGarrisonNodeId(pending.nodeId)) entries.push({ arena: pending.arena, row: runRow(rtNode(run, pending.nodeId)!.row), run: serializeRtRun(run) });
      const played = botFight(run, { params: rtArenaParams(run, rtRunParams(defaultParams())), loadout: rtArenaLoadout(run), limit: LIMIT, pairs: 'planner' });
      return outcomeOf(run, played.sim.world);
    } });
  }
  writeFileSync(file, JSON.stringify({ date: today(), head: head(), runs, limit: LIMIT, entries }));
  const by = new Map<string, number>();
  for (const e of entries) by.set(e.arena, (by.get(e.arena) ?? 0) + 1);
  console.log(`Входы шага 3: ${runs} походов «гарнизон» со step3 (бот-планировщик), ${today()}, HEAD ${head()}, ${Math.round((Date.now() - started) / 1000)} с. По аренам: ${[...by].map(([a, n]) => `${a} ${n}`).join(', ')}. Файл ${file}.`);
}

// ---- Step 2: the fights ----

/** One fight's numbers. */
interface Fight {
  death: number; timeout: number; time: number; damage: number; sources: Record<string, number>;
  pitchers: number; pitcherTime: number; pots: number; potHits: number; pitchSeconds: number;
  formations: number; drills: number; pairs: number; pairsClean: number; pairsAnger: number; pairsLeft: number; angers: number; angerDamage: number;
  newcomers: number; newcomersA: number; stand?: number; row: number;
}

/** A variant of the arena's share: what the script puts on the template. */
interface Variant { title: string; share: number | null; planner: boolean }

/** The share the script sets: «Смолокурня» — the pitchers' newcomer share, «Казарма» — the recruits', «Барбакан» — `pairShare`. */
function setShare(arena: string, share: number): () => void {
  const t = arenaTemplate(arena) as { newcomers?: { kind: string; share: number }[]; pairShare?: number };
  if (arena === BARBICAN_ARENA.id) { const old = t.pairShare; t.pairShare = share; return () => { t.pairShare = old; }; }
  const kind = arena === TARWORKS_ARENA.id ? PITCHER : RECRUIT, entry = t.newcomers?.find(n => n.kind === kind);
  if (!entry) throw new Error(`${arena}: no newcomer ${kind}`);
  const old = entry.share; entry.share = share;
  return () => { entry.share = old; };
}

function variants(arena: string): Variant[] {
  const of = (hypothesis: number): number[] => [0, hypothesis, hypothesis * 2 > 1 ? 1 : hypothesis * 2];
  if (arena === TARWORKS_ARENA.id) return of(PITCHER_SHARE).map(share => ({ title: `доля смолокуров ${share}`, share, planner: true }));
  if (arena === BARRACKS_ARENA.id) return of(RECRUIT_SHARE).map(share => ({ title: `доля строёв ${share}`, share, planner: true }));
  if (arena === BARBICAN_ARENA.id) return of(BARBICAN_PAIR_SHARE).flatMap(share => [false, true].map(planner => ({ title: `pairShare ${share}, ${planner ? 'планировщик' : 'небрежный'}`, share, planner })));
  return [{ title: 'как в игре', share: null, planner: true }];
}

/** The entry's run with the fight's seed. */
function entryRun(entry: Entry, seed: number): RtRunState {
  const run = parseRtRun(entry.run);
  if (!run || run.pending?.kind !== 'battle') throw new Error('a bad entry');
  return { ...run, pending: { ...run.pending, seed } };
}

/** The hero who stands `seconds` (no command at all): the damage he takes (criterion 4). */
function stand(run: RtRunState, params: Params, loadout: Loadout, seconds: number): number {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const sim = new Simulation({ arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, params, seed: pending.seed, hero: { hp: run.hp, maxHp: run.maxHp }, loadout });
  for (let i = 0; i < Math.round(seconds / SIM_DT) && sim.world.status === 'playing'; i++) sim.tick();
  return sim.world.stats.damageTaken;
}

function play(entry: Entry, seed: number, planner: boolean, standToo: boolean): Fight {
  const run = entryRun(entry, seed), params = rtArenaParams(run, rtRunParams(defaultParams())), loadout = rtArenaLoadout(run);
  const f: Fight = { death: 0, timeout: 0, time: 0, damage: 0, sources: {}, pitchers: 0, pitcherTime: 0, pots: 0, potHits: 0, pitchSeconds: 0, formations: 0, drills: 0, pairs: 0, pairsClean: 0, pairsAnger: 0, pairsLeft: 0, angers: 0, angerDamage: 0, newcomers: 0, newcomersA: 0, row: entry.row };
  const seenIds = new Set<number>(), pitcherIds = new Set<number>(), groups = new Set<number>(), pairs = new Map<number, [number, number]>(), angry = new Set<number>();
  let first = true, last = 0;
  const watch = (w: World): void => {
    // The pair's colour A now (the lower id of a standing pair), for the newcomers' share.
    const lead = w.enemies.filter(e => e.kind === WARDEN && e.vars.wp !== undefined && e.id < e.vars.wp).sort((a, b) => a.id - b.id)[0];
    for (const e of w.enemies) {
      if (!seenIds.has(e.id)) {
        seenIds.add(e.id);
        if (!first && e.kind !== WARDEN) { f.newcomers++; if (lead && e.color === lead.color) f.newcomersA++; }
      }
      if (e.kind === PITCHER) pitcherIds.add(e.id);
      if (e.kind === RECRUIT && recruitNumber(e) > 0) groups.add(recruitGroup(e));
      if (e.kind === WARDEN && e.vars.wp !== undefined) { const key = Math.min(e.id, e.vars.wp); if (!pairs.has(key)) pairs.set(key, [key, Math.max(e.id, e.vars.wp)]); }
    }
    first = false;
    // Game time (a hitstop tick adds none).
    const dt = w.time - last;
    last = w.time;
    if (w.enemies.some(e => e.kind === PITCHER)) f.pitcherTime += dt;
    if (inPitch(w, w.hero)) f.pitchSeconds += dt;
    for (const ev of w.events) {
      if (ev.type === 'hit') {
        f.sources[ev.source] = (f.sources[ev.source] ?? 0) + ev.damage;
        if (ev.source === 'warden-swing' || (ev.source === 'touch' && angry.has(ev.enemyId) && w.enemies.some(e => e.id === ev.enemyId && (e.vars.wa ?? 0) > 0))) f.angerDamage += ev.damage;
      }
      if (ev.type === 'pot' && ev.action === 'throw') f.pots++;
      if (ev.type === 'pot' && ev.action === 'land' && ev.hit === 'hero') f.potHits++;
      if (ev.type === 'recruit' && ev.action === 'drill') f.drills++;
      if (ev.type === 'warden' && ev.action === 'anger' && ev.stage === 'start') { f.angers++; angry.add(ev.id); }
    }
  };
  const played = botFight(run, { params, loadout, limit: LIMIT, seen: watch, ...planner ? { pairs: 'planner' as const } : {} });
  const w = played.sim.world;
  f.death = w.status === 'victory' ? 0 : 1; f.timeout = played.timeout ? 1 : 0; f.time = w.time; f.damage = w.stats.damageTaken;
  f.pitchers = pitcherIds.size; f.formations = groups.size; f.pairs = pairs.size;
  const alive = new Set(w.enemies.map(e => e.id));
  // Each pair ends one way: both fell with no anger; an anger (one fell first); or it stands at the end, calm.
  for (const [a, b] of pairs.values()) {
    if (angry.has(a) || angry.has(b)) f.pairsAnger++;
    else if (!alive.has(a) && !alive.has(b)) f.pairsClean++;
    else f.pairsLeft++;
  }
  if (standToo) f.stand = stand(run, params, loadout, 6);
  return f;
}

// ---- The numbers ----

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const se = (xs: readonly number[]): number => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const f1 = (x: number): string => x.toFixed(1).replace('.', ',');
const f2 = (x: number): string => x.toFixed(2).replace('.', ',');
const pct = (xs: readonly number[]): string => `${f1(100 * mean(xs))} ± ${f1(100 * se(xs))} %`;
/** The paired difference of `xs` from `base` (fight by fight), in p. p. ± its standard error. */
const pairedPct = (xs: readonly number[], base: readonly number[]): string => { const d = xs.map((x, i) => x - base[i]); return `${mean(d) >= 0 ? '+' : ''}${f1(100 * mean(d))} ± ${f1(100 * se(d))}`; };
const avg = (xs: readonly number[]): string => `${f2(mean(xs))} ± ${f2(se(xs))}`;

function sweep(file: string, arena: string, fights: number, save: string): void {
  const started = Date.now(), data = JSON.parse(readFileSync(file, 'utf8')) as { date: string; head: string; runs: number; entries: Entry[] };
  const entries = data.entries.filter(e => e.arena === arena);
  if (!entries.length) throw new Error(`no entries of ${arena} in ${file}`);
  const vs = variants(arena), standToo = arena === TARWORKS_ARENA.id || arena === 'g-loopholes';
  const results: Fight[][] = vs.map(v => {
    const restore = v.share === null ? () => {} : setShare(arena, v.share);
    try { return Array.from({ length: fights }, (_, i) => play(entries[i % entries.length], seedOf(i + 1), v.planner, standToo)); } finally { restore(); }
  });
  const rows = new Map<number, number>();
  for (let i = 0; i < fights; i++) rows.set(entries[i % entries.length].row, (rows.get(entries[i % entries.length].row) ?? 0) + 1);
  console.log(`### ${arenaTemplate(arena).name} (\`${arena}\`): ${fights} боёв на вариант\n`);
  console.log(`${today()}, HEAD ${head()}; входы — ${entries.length} из ${data.runs} походов (файл ${data.date}, HEAD ${data.head}), по кругу; ряды входов: ${[...rows].sort((a, b) => a[0] - b[0]).map(([r, n]) => `г${r} ${n}`).join(', ')}; HP на входе, мед. ${f1(median(entries.map(e => parseRtRun(e.run)!.hp)))}; предел боя ${LIMIT} с; ${Math.round((Date.now() - started) / 1000)} с. Эвристика.\n`);
  // The paired base: the hypothesis (the careless and the planner each against their own).
  const baseOf = (i: number): number => (arena === BARBICAN_ARENA.id ? 2 + (i % 2) : vs.length > 1 ? 1 : 0);
  console.log('| Вариант | Смертей | Δ к гипотезе, п. п. | За пределом | Длина боя, мед. с | Урон, мед. | Урон, сред. |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  vs.forEach((v, i) => {
    const r = results[i], base = results[baseOf(i)];
    console.log(`| ${v.title} | ${pct(r.map(x => x.death))} | ${i === baseOf(i) ? '—' : pairedPct(r.map(x => x.death), base.map(x => x.death))} | ${r.reduce((a, x) => a + x.timeout, 0)} | ${f1(median(r.map(x => x.time)))} | ${f1(median(r.map(x => x.damage)))} | ${avg(r.map(x => x.damage))} |`);
  });
  console.log('');
  if (arena === TARWORKS_ARENA.id) {
    console.log('| Вариант | Смолокуров за бой | Время с живым смолокуром, доля | Горшков | Попаданий горшком | Урон горшком, доля | Секунд в смоле | Простой герой 6 с: урон |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
    vs.forEach((v, i) => {
      const r = results[i], total = r.reduce((a, x) => a + x.damage, 0), pot = r.reduce((a, x) => a + (x.sources.pot ?? 0), 0);
      console.log(`| ${v.title} | ${avg(r.map(x => x.pitchers))} | ${f2(mean(r.map(x => x.pitcherTime / Math.max(x.time, 1e-9))))} | ${avg(r.map(x => x.pots))} | ${avg(r.map(x => x.potHits))} | ${total ? f2(pot / total) : '—'} | ${avg(r.map(x => x.pitchSeconds))} | ${avg(r.map(x => x.stand ?? 0))} |`);
    });
  } else if (arena === BARRACKS_ARENA.id) {
    console.log('| Вариант | Строёв за бой | Строй одним проходом, на строй | Строёв одним проходом за бой |');
    console.log('| --- | --- | --- | --- |');
    vs.forEach((v, i) => {
      const r = results[i], formations = r.reduce((a, x) => a + x.formations, 0), drills = r.reduce((a, x) => a + x.drills, 0);
      console.log(`| ${v.title} | ${avg(r.map(x => x.formations))} | ${formations ? f2(drills / formations) : '—'} | ${avg(r.map(x => x.drills))} |`);
    });
  } else if (arena === BARBICAN_ARENA.id) {
    console.log('| Вариант | Цвет A среди пришедших при живой паре | Пар | Обе пали без гнева | Гнев | Стоят к концу боя | Гневов за бой | Урон в гневе, сред. |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
    vs.forEach((v, i) => {
      const r = results[i], nc = r.reduce((a, x) => a + x.newcomers, 0), na = r.reduce((a, x) => a + x.newcomersA, 0), pairs = r.reduce((a, x) => a + x.pairs, 0);
      const share = (key: 'pairsClean' | 'pairsAnger' | 'pairsLeft'): string => { const xs = r.filter(x => x.pairs).map(x => x[key] / x.pairs); return xs.length ? `${f2(mean(xs))} ± ${f2(se(xs))}` : '—'; };
      console.log(`| ${v.title} | ${nc ? `${f2(na / nc)} (${na} из ${nc})` : '—'} | ${pairs} | ${share('pairsClean')} | ${share('pairsAnger')} | ${share('pairsLeft')} | ${avg(r.map(x => x.angers))} | ${avg(r.map(x => x.angerDamage))} |`);
    });
  } else if (standToo) {
    console.log(`Простой герой 6 с: урон ${avg(results[0].map(x => x.stand ?? 0))}.`);
  }
  if (save) writeFileSync(save, JSON.stringify({ arena, date: today(), head: head(), variants: vs.map((v, i) => ({ title: v.title, fights: results[i].map(x => ({ row: x.row, death: x.death })) })) }));
  // Deaths by the entry's row (criterion 1: «Казарма» on its rows 3–4 against «Ристалище»; an own arena may come later by «не позже»).
  console.log('');
  const entryRows = [...rows.keys()].sort((a, b) => a - b);
  console.log(`| Вариант | ${entryRows.map(r => `Смертей г${r}`).join(' | ')} |`);
  console.log(`| --- | ${entryRows.map(() => '---').join(' | ')} |`);
  vs.forEach((v, i) => console.log(`| ${v.title} | ${entryRows.map(row => pct(results[i].filter(x => x.row === row).map(x => x.death))).join(' | ')} |`));
  // Damage by source, each variant.
  console.log('');
  vs.forEach((v, i) => {
    const all: Record<string, number> = {};
    for (const x of results[i]) for (const [s, n] of Object.entries(x.sources)) all[s] = (all[s] ?? 0) + n;
    const total = Object.values(all).reduce((a, b) => a + b, 0);
    console.log(`Урон по источникам (${v.title}): ${Object.entries(all).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n} (${total ? Math.round(100 * n / total) : 0}%)`).join(', ') || '—'}.`);
  });
  console.log('');
}

/** A saved arena run (`--save`). */
interface Saved { arena: string; date: string; head: string; variants: { title: string; fights: { row: number; death: number }[] }[] }

/** Criterion 1: A's variants against B's first, by the entry rows, weighted by A's (see the file's comment). */
function compare(fileA: string, fileB: string): void {
  const a = JSON.parse(readFileSync(fileA, 'utf8')) as Saved, b = JSON.parse(readFileSync(fileB, 'utf8')) as Saved;
  const ref = b.variants[0].fights, byRow = (xs: { row: number; death: number }[], row: number): number[] => xs.filter(x => x.row === row).map(x => x.death);
  console.log(`### ${arenaTemplate(a.arena).name} против «${arenaTemplate(b.arena).name}» (${b.variants[0].title}) по рядам входа, веса — ряды «${arenaTemplate(a.arena).name}»\n`);
  console.log(`${today()}; файлы ${a.date} HEAD ${a.head} и ${b.date} HEAD ${b.head}. Эвристика.\n`);
  console.log('| Вариант | Δ смертей, п. п. (взвешенно) | Ряды: вес, A − B |');
  console.log('| --- | --- | --- |');
  for (const v of a.variants) {
    const rows = [...new Set(v.fights.map(x => x.row))].sort((x, y) => x - y), total = v.fights.length;
    let d = 0, var2 = 0, left = 0;
    const parts: string[] = [];
    for (const row of rows) {
      const xa = byRow(v.fights, row), xb = byRow(ref, row), w = xa.length / total;
      if (!xb.length) { left += w; parts.push(`г${row}: ${f2(w)}, у B нет боёв`); continue; }
      d += w * (mean(xa) - mean(xb)); var2 += w * w * (se(xa) ** 2 + se(xb) ** 2);
      parts.push(`г${row}: ${f2(w)}, ${f1(100 * mean(xa))} − ${f1(100 * mean(xb))}`);
    }
    // Over the rows both played: the weights renormalised.
    const k = 1 / Math.max(1e-9, 1 - left);
    console.log(`| ${v.title} | ${d * k >= 0 ? '+' : ''}${f1(100 * d * k)} ± ${f1(100 * Math.sqrt(var2) * k)}${left ? ` (без рядов весом ${f2(left)})` : ''} | ${parts.join('; ')} |`);
  }
  console.log('');
}

const collectFile = option('--collect', ''), entriesFile = option('--entries', ''), arena = option('--arena', ''), compareAt = args.indexOf('--compare');
if (collectFile) collect(collectFile, Number(option('--runs', '300')));
else if (entriesFile && arena) sweep(entriesFile, arena, Number(option('--fights', '300')), option('--save', ''));
else if (compareAt >= 0 && args[compareAt + 2]) compare(args[compareAt + 1], args[compareAt + 2]);
else { console.log('usage: --collect FILE [--runs N] | --entries FILE --arena ID [--fights N] [--save OUT] | --compare A B'); process.exit(1); }
