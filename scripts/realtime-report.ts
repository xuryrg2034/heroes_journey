/**
 * The playtest report of the real-time game (docs/realtime-telemetry.md, sections 5 and 8, «ТB»):
 *
 *   npm run realtime:report -- <folder or JSON> […] [--out <folder>] [--at <fight> <tick>]
 *
 * Reads the records (the dev-server plugin's files `playtest-logs/<session>/<run>/*.json`, «Экспорт» files
 * `{format: 'ashen-oath-rt-telemetry', …}`, folders recursively), drops duplicates by id, replays every fight and checks
 * its hash, writes `playtest-logs/report/<date-time>/report.md` (or `--out`). The logic is src/realtime/telemetry/report.ts.
 *
 * `--at <fight> <tick>` (the fight key `f03-n5a-a1`, or `<session>/<run>/<fight>` when the key repeats): the world after
 * that many ticks — `at/<fight>-<tick>.json` (`worldState`, sim/hash.ts) — and a screenshot of the field
 * `at/<fight>-<tick>.png`: Vite on a free port, Chromium, `/realtime.html#sandbox`, the page's hook
 * `window.__realtime.replayTo(journal, tick)`. Without the hook only the snapshot is written (the error says so).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Journal } from '../src/realtime/sim/simulation';
import { analyzeRecords, collectRecords, findFight, reportMarkdown, snapshotAt, type ReportInput } from '../src/realtime/telemetry/report';

const ROOT = resolve(import.meta.dirname, '..');

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('npm run realtime:report -- <папка или JSON> […] [--out <папка>] [--at <бой> <такт>]');
  process.exit(2);
}

function parseArgs(argv: string[]): { sources: string[]; out: string | null; at: { fight: string; tick: number } | null } {
  const sources: string[] = [];
  let out: string | null = null, at: { fight: string; tick: number } | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out = argv[++i] ?? usage('--out: нужна папка'); continue; }
    if (a === '--at') {
      const fight = argv[++i], tick = Number(argv[++i]);
      if (!fight || !Number.isInteger(tick) || tick < 0) usage('--at: нужны бой и такт (целое ≥ 0)');
      at = { fight, tick };
      continue;
    }
    if (a.startsWith('--')) usage(`неизвестный флаг ${a}`);
    sources.push(a);
  }
  if (!sources.length) usage('нужна папка с логами или файл JSON');
  return { sources, out, at };
}

/** Every *.json under the sources (folders recursively; the reports' own folder is skipped). */
function readInputs(sources: readonly string[]): ReportInput[] {
  const inputs: ReportInput[] = [], reports = resolve(ROOT, 'playtest-logs', 'report');
  const visit = (path: string): void => {
    const st = statSync(path);
    if (st.isDirectory()) {
      if (path === reports || path.startsWith(reports + sep)) return;
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (path.endsWith('.json')) inputs.push({ name: relative(ROOT, path) || path, text: readFileSync(path, 'utf8') });
  };
  for (const s of sources) visit(resolve(s));
  return inputs;
}

const stamp = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, '').replace('T', '_').replace(/:/g, '-');

/** Flags of the Chromium of the real-time Playwright suite (playwright.realtime.config.ts). */
const CHROMIUM_ARGS = process.env.RT_GPU ? ['--enable-webgl', '--ignore-gpu-blocklist'] : ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** A screenshot of the field after `tick` ticks of the journal (the page's `__realtime.replayTo` hook, track ТA). */
async function screenshotAt(journal: Journal, tick: number, png: string): Promise<void> {
  const { createServer } = await import('vite');
  const { chromium } = await import('@playwright/test');
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 4669, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  try {
    const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4669/';
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(new URL('realtime.html#sandbox', base).href);
    await page.waitForFunction(() => !!(window as unknown as { __realtime?: unknown }).__realtime, null, { timeout: 30_000 });
    const hook = await page.evaluate(() => typeof (window as unknown as { __realtime?: { replayTo?: unknown } }).__realtime?.replayTo === 'function');
    if (!hook) throw new Error('на странице нет хука window.__realtime.replayTo (дорожка ТA): скриншот не сделан, записан только снимок мира');
    await page.evaluate(([j, t]) => (window as unknown as { __realtime: { replayTo(journal: unknown, tick: number): Promise<void> } }).__realtime.replayTo(j, t as number), [journal, tick] as const);
    await page.waitForTimeout(300);
    await page.screenshot({ path: png });
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const outDir = resolve(args.out ?? join(ROOT, 'playtest-logs', 'report', stamp(now)));
  const set = collectRecords(readInputs(args.sources));
  const analysis = await analyzeRecords(set);
  mkdirSync(outDir, { recursive: true });
  const source = args.sources.join(' ');
  writeFileSync(join(outDir, 'report.md'), reportMarkdown(set, analysis, { now, source }));
  const fights = analysis.fights;
  const bad = fights.filter(f => f.hashOk === false).length, broken = fights.filter(f => f.error).length;
  console.log(`записей ${set.records.length} (дублей ${set.duplicates}), боёв ${fights.length}; хэш не совпал: ${bad}; не собрано или не повторено: ${broken}`);
  console.log(`отчёт: ${relative(process.cwd(), join(outDir, 'report.md'))}`);
  if (!args.at) return;
  const entry = findFight(fights, args.at.fight);
  if (!entry.journal) throw new Error(`журнал боя ${args.at.fight} не собран: ${entry.error}`);
  const tick = Math.min(args.at.tick, entry.journal.ticks), name = `${entry.record.fight}-${tick}`, atDir = join(outDir, 'at');
  mkdirSync(atDir, { recursive: true });
  writeFileSync(join(atDir, `${name}.json`), JSON.stringify({ fight: entry.record.id, arena: entry.record.arena, ...snapshotAt(entry.journal, tick) as object }, null, 1));
  console.log(`снимок мира: ${relative(process.cwd(), join(atDir, `${name}.json`))}`);
  try {
    await screenshotAt(entry.journal, tick, join(atDir, `${name}.png`));
    console.log(`скриншот: ${relative(process.cwd(), join(atDir, `${name}.png`))}`);
  } catch (e) {
    console.error(`скриншот: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
