import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import {
  checkRecord, orderedParts, parseExport, unpackJournal,
  type FightRecord, type FightSummary, type JournalPart, type NoteRecord, type RtRecord, type RunRecord,
} from '../src/realtime/telemetry/schema';
import { FightTap } from '../src/realtime/telemetry/recorder';
import { fightKey } from '../src/realtime/telemetry/schema';
import { createFightObserver } from '../src/realtime/telemetry/observe';
import { analyzeJournal, collectRecords } from '../src/realtime/telemetry/report';

/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, section 8): the browser records fights, runs and N
 * notes into its buffer and the sinks. Runs through playwright.realtime.config.ts only.
 */

interface Snap {
  arena: string; status: string; tick: number; time: number; paused: boolean; seed: number;
  hero: { x: number; y: number; hp: number }; moving: string | null; menuOpen: boolean;
  objects: { kind: string; x: number; y: number }[];
  telemetry: { records: number; chars: number; undelivered: number; notes: number; bufferFull: boolean } | null;
  noteFlash: boolean; logsOpen: boolean;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const records = (page: Page): Promise<RtRecord[]> => page.evaluate(() => (window as any).__realtime.telemetry.records());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y] as const);
const place = (page: Page, x: number, y: number, color: number, hp = 0): Promise<number> =>
  page.evaluate(([x, y, color, hp]) => (window as any).__realtime.place(x, y, color, hp), [x, y, color, hp] as const);

/** Opens the sandbox with clean storage (localStorage, sessionStorage and the journal IndexedDB). */
async function openSandbox(page: Page, errors: string[], query = '', menu = true): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`/realtime.html?sandbox=1${query}`);
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    await new Promise<void>(resolve => { const r = indexedDB.deleteDatabase('ashen-oath-rt-tlm-v1'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  if (menu) await expect(page.getByTestId('menu')).toBeVisible();
}

async function hold(page: Page, code: string, seconds: number): Promise<void> {
  const t0 = (await snap(page)).time;
  await page.keyboard.down(code);
  await expect.poll(async () => (await snap(page)).time, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(t0 + seconds);
  await page.keyboard.up(code);
}

/** Real actions: walking keys and a chain drawn with the mouse over three enemies of one colour placed by the hero. */
async function playSome(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__realtime.setParam('heroHp', 40));
  await hold(page, 'KeyD', 0.5);
  const { x: hx, y: hy } = (await snap(page)).hero;
  const points = [1, 2.2, 3.4].map(dx => ({ x: Math.min(15, hx + dx), y: hy }));
  for (const p of points) await place(page, p.x, p.y, 3);
  const screens = [];
  for (const p of points) screens.push(await screen(page, p.x, p.y));
  await page.mouse.move(screens[0].x, screens[0].y);
  await page.mouse.down();
  for (const s of screens.slice(1)) await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).moving, { timeout: 5_000 }).toBeNull();
  await hold(page, 'KeyS', 0.4);
}

/** Wins the sandbox arena: the goals done, the hero put on the open door (journalled commands); the next tick walks him in. */
async function winSandbox(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime;
    rt.completeGoals();
    const door = rt.snapshot().objects.find((o: { kind: string }) => o.kind === 'door');
    rt.teleport(door.x, door.y);
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
}

/** The journal of a fight record, assembled from the buffer's parts and decoded in Node. */
async function journalOf(all: RtRecord[], fight: FightRecord): Promise<Journal> {
  const parts = all.filter((r): r is JournalPart => r.kind === 'journal' && r.fight === fight.fight);
  const run = all.find((r): r is RunRecord => r.kind === 'run' && r.run === fight.run);
  return unpackJournal(orderedParts(parts, fight.fight, fight.journal.digest), fight.journal, run?.runParams);
}

test('a sandbox fight with real actions is recorded: the fight and its journal; the journal replays in Node to the recorded hash, also with the tap', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors, '&seed=4242');
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  const hpIn = (await snap(page)).hero.hp;
  await playSome(page);
  await winSandbox(page);
  const all = await records(page);
  for (const r of all) expect(checkRecord(r)).toBeNull();
  const fights = all.filter((r): r is FightRecord => r.kind === 'fight');
  expect(fights).toHaveLength(1);
  const fight = fights[0];
  expect(fight).toMatchObject({ run: 'sandbox', arena: (await snap(page)).arena, seed: 4242, outcome: 'victory', hpIn });
  expect(fight.journal.encoding).toBe('compact+gzip+b64');
  expect(fight.journal.parts).toBe(1);
  expect(fight.view!.w).toBeGreaterThan(5);
  expect(fight.summary.tempo.inView!.max).toBeGreaterThan(0);
  expect(fight.build).toMatch(/^[0-9a-f]{4,}(\+dirty)?$|^unknown$/);
  const journal = await journalOf(all, fight);
  expect(journal.ticks).toBe(fight.ticks);
  expect(journal.commands.some(c => c.cmd.t === 'sweep' || c.cmd.t === 'drag')).toBe(true);
  expect(journal.commands.some(c => c.cmd.t === 'walk')).toBe(true);
  // The record does not change the world: a replay without the recorder gives the hash the browser recorded.
  expect(replay(journal).hash()).toBe(fight.endHash);
  // The browser's summary (the observer of track ТB fed by the tap in frames) is the report's replay summary, except
  // `inView` (the browser only) and `threats` (the report only).
  const report = analyzeJournal(journal);
  expect(report.hash).toBe(fight.endHash);
  const strip = (x: FightSummary) => { const c = JSON.parse(JSON.stringify(x)) as FightSummary; delete c.tempo.inView; c.threats = {}; return c; };
  expect(strip(fight.summary)).toEqual(strip(report.summary));
  expect(fight.summary.chain.count).toBeGreaterThanOrEqual(1);
  expect(fight.summary.kills.chain).toBeGreaterThanOrEqual(3);
  // A replay fed through the tap with an observer that reads every tick and command gives the same hash too.
  let ticks = 0, commands = 0;
  const reading = { tick: (w: { events: unknown[]; enemies: unknown[] }) => { ticks++; void w.events.length; void w.enemies.length; }, command: () => { commands++; }, summary: () => ({}) as FightSummary };
  let tap: FightTap | null = null;
  const tapped = replay(journal, s => { tap ??= new FightTap(reading as never, s.world); tap.flush(s.world); s.world.events.length = 0; });
  expect(tapped.hash()).toBe(fight.endHash);
  expect(ticks).toBeGreaterThan(fight.ticks - 2);
  // The page's live journal (the result screen keeps ticking) still starts as the recorded one.
  const live = await page.evaluate(() => (window as any).__realtime.journal()) as Journal;
  expect(live.commands.slice(0, journal.commands.length)).toEqual(journal.commands);
  expect(errors).toEqual([]);
});

test('recording off (?telemetry=0): nothing is recorded and the journal replays to the page hash; a restart is recorded as left', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors, '&seed=777&telemetry=0');
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  await playSome(page);
  const off = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash(), snap: rt.snapshot(), hooks: rt.telemetry }; }) as { journal: Journal; hash: string; snap: Snap; hooks: unknown };
  expect(off.snap.telemetry).toBeNull();
  expect(off.hooks).toBeNull();
  expect(replay(off.journal).hash()).toBe(off.hash);
  await expect(page.locator('.rt-help')).not.toContainText('отметка');

  // With the recorder: the same kind of fight, left by R — a «restart» record whose journal replays to its hash.
  await openSandbox(page, errors, '&seed=777');
  await page.keyboard.press('1');
  await playSome(page);
  await page.keyboard.press('KeyR');
  const all = await records(page);
  const fight = all.find((r): r is FightRecord => r.kind === 'fight')!;
  expect(fight.outcome).toBe('restart');
  expect(replay(await journalOf(all, fight)).hash()).toBe(fight.endHash);
  expect(errors).toEqual([]);
});

test('N on an open arena writes a note (tick, arena, hero) and flashes «отмечено» for a second; it sends no command', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  // The menu is open: N notes nothing.
  await page.keyboard.press('KeyN');
  expect((await snap(page)).telemetry!.notes).toBe(0);
  await page.keyboard.press('2');
  await expect(page.getByTestId('menu')).toBeHidden();
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.5);
  const before = await page.evaluate(() => (window as any).__realtime.journal().commands.length) as number;
  await page.keyboard.press('KeyN');
  await expect(page.getByTestId('note-flash')).toBeVisible();
  await expect(page.getByTestId('note-flash')).toHaveText('отмечено');
  const after = await page.evaluate(() => (window as any).__realtime.journal().commands.length) as number;
  expect(after).toBe(before);
  await expect(page.locator('.rt-help')).toContainText('N отметка');
  await expect(page.getByTestId('note-flash')).toBeHidden({ timeout: 2_000 });
  const notes = (await records(page)).filter((r): r is NoteRecord => r.kind === 'note');
  expect(notes).toHaveLength(1);
  expect(notes[0].arena).toBe((await snap(page)).arena);
  expect(notes[0].tick).toBeGreaterThan(20);
  expect(typeof notes[0].hero.x).toBe('number');
  expect(checkRecord(notes[0])).toBeNull();
  expect((await snap(page)).telemetry!.notes).toBe(1);
  expect(errors).toEqual([]);
});

test('the artifact sink gets the records; while it fails they stay undelivered in the buffer and go later', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    const w = window as any;
    w.__got = [];
    w.__fail = true;
    w.__rtTelemetrySink = { name: 'test', write: async (r: { id: string }) => { if (w.__fail) throw new Error('sink down'); w.__got.push(r.id); } };
  });
  await openSandbox(page, errors);
  await page.keyboard.press('1');
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.3);
  await page.keyboard.press('KeyN');
  await winSandbox(page);
  await page.evaluate(() => (window as any).__realtime.telemetry.settle());
  const down = (await snap(page)).telemetry!;
  expect(down.records).toBeGreaterThanOrEqual(3);
  expect(down.undelivered).toBe(down.records);
  expect(await page.evaluate(() => (window as any).__got.length)).toBe(0);
  // The game goes on: the menu, another arena.
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('menu')).toBeVisible();
  // The sink comes back: the retry (1 s, then 2 s …) delivers everything.
  await page.evaluate(() => { (window as any).__fail = false; });
  await expect.poll(async () => (await snap(page)).telemetry!.undelivered, { timeout: 15_000 }).toBe(0);
  const got = await page.evaluate(() => (window as any).__got) as string[];
  expect(got.some(id => id.endsWith('/fight'))).toBe(true);
  expect(got.some(id => /\/j0of1$/.test(id))).toBe(true);
  expect(got.some(id => /\/n\d+$/.test(id))).toBe(true);
  expect(errors).toEqual([]);
});

/** Opens the panel after one finished sandbox fight (two records: fight and journal). */
async function fightThenLogs(page: Page, errors: string[]): Promise<void> {
  await openSandbox(page, errors);
  await page.getByTestId('logs-open').click();
  await page.getByTestId('logs-tester').fill('Аня');
  await page.getByTestId('logs-close').click();
  await page.keyboard.press('1');
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.3);
  await winSandbox(page);
  await page.keyboard.press('KeyM');
  await page.evaluate(() => (window as any).__realtime.telemetry.settle());
  await page.getByTestId('logs-open').click();
  await expect(page.getByTestId('logs-stats')).toContainText('Записей 2');
}

test('«Копировать» puts the export JSON into the clipboard: parseExport and the report accept it, the status shows N and КиБ', async ({ page, context }) => {
  const errors: string[] = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fightThenLogs(page, errors);
  await expect(page.getByTestId('logs-export')).toHaveText('Копировать');
  await page.getByTestId('logs-export').click();
  await expect(page.getByTestId('logs-status')).toHaveText(/^Скопировано: 2 записи, \d+,\d КиБ\. Вставьте в сообщение\.$/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const file = parseExport(text);
  expect(file.records.map(r => r.kind).sort()).toEqual(['fight', 'journal']);
  expect(file.records.every(r => r.tester === 'Аня')).toBe(true);
  expect(collectRecords([{ name: 'clipboard', text }]).problems).toEqual([]);
  const kib = Number((await page.getByTestId('logs-status').textContent())!.match(/(\d+),(\d) КиБ/)!.slice(1).join('.'));
  expect(kib).toBeCloseTo(Buffer.byteLength(text) / 1024, 0);
  await page.screenshot({ path: 'artifacts/realtime-telemetry-copy.png' });
  expect(errors).toEqual([]);
});

test('no clipboard: «Копировать» falls back to the page hook, and without the hook to a download', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const w = window as any;
    w.__exported = null;
    w.__rtTelemetryExport = async (filename: string, text: string) => { w.__exported = { filename, text }; };
  });
  await fightThenLogs(page, errors);
  await page.getByTestId('logs-export').click();
  await expect(page.getByTestId('logs-status')).toHaveText('Буфер недоступен — сохранён файл');
  const exported = await page.evaluate(() => (window as any).__exported) as { filename: string; text: string };
  expect(exported.filename).toMatch(/^ashen-oath-rt-telemetry-.+\.json$/);
  expect(parseExport(exported.text).records).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('no clipboard and no hook: «Копировать» downloads the file', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
  await fightThenLogs(page, errors);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('logs-export').click()]);
  expect(download.suggestedFilename()).toMatch(/^ashen-oath-rt-telemetry-.+\.json$/);
  await expect(page.getByTestId('logs-status')).toHaveText('Буфер недоступен — сохранён файл');
  expect(errors).toEqual([]);
});

// A test of its own page (a context made by hand does not take the project's baseURL and viewport: it failed in the
// main suite, verify 11.10.2026).
test('a rejecting clipboard write falls back to writeText', async ({ page: page2 }) => {
  await page2.addInitScript(() => {
    const w = window as any;
    w.__text = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: () => Promise.reject(new Error('denied')),
      writeText: async (t: string) => { w.__text = t; },
    } });
  });
  const errors2: string[] = [];
  await fightThenLogs(page2, errors2);
  await page2.getByTestId('logs-export').click();
  await expect(page2.getByTestId('logs-status')).toContainText('Скопировано: 2 записи');
  expect(parseExport(await page2.evaluate(() => (window as any).__text)).records).toHaveLength(2);
  expect(errors2).toEqual([]);
});

test('the «Логи» panel: from the sandbox menu, the tester name goes into records, «Копировать» copies, «Очистить» asks first', async ({ page, context }) => {
  const errors: string[] = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSandbox(page, errors);
  await page.getByTestId('logs-open').click();
  await expect(page.getByTestId('logs')).toBeVisible();
  await expect(page.getByTestId('logs-stats')).toContainText('Записей 0');
  await page.getByTestId('logs-tester').fill('Аня');
  await page.getByTestId('logs-close').click();
  await expect(page.getByTestId('logs')).toBeHidden();
  await page.keyboard.press('1');
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.3);
  await winSandbox(page);
  await page.keyboard.press('KeyM');
  await page.evaluate(() => (window as any).__realtime.telemetry.settle());
  await page.getByTestId('logs-open').click();
  await expect(page.getByTestId('logs-stats')).toContainText('Записей 2');
  // Keys behind the panel do nothing (2 would start an arena).
  await page.keyboard.press('2');
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('logs-export').click();
  await expect(page.getByTestId('logs-status')).toContainText('Скопировано: 2 записи');
  const file = parseExport(await page.evaluate(() => navigator.clipboard.readText()));
  expect(file.records.map(r => r.kind).sort()).toEqual(['fight', 'journal']);
  expect(file.records.every(r => r.tester === 'Аня')).toBe(true);
  // «Очистить» asks in the panel; «Нет» keeps the records.
  await page.getByTestId('logs-clear').click();
  await page.getByTestId('logs-clear-no').click();
  expect((await snap(page)).telemetry!.records).toBe(2);
  await page.getByTestId('logs-clear').click();
  await page.getByTestId('logs-clear-yes').click();
  await expect(page.getByTestId('logs-stats')).toContainText('Записей 0');
  await page.screenshot({ path: 'artifacts/realtime-telemetry-logs.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('logs')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the run is recorded: nodes, the gift choice, the fight of a node; a reload in a fight leaves an «unload» fight; a new run abandons the old', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    await new Promise<void>(resolve => { const r = indexedDB.deleteDatabase('ashen-oath-rt-tlm-v1'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  });
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('logs-open')).toBeVisible();
  const node = page.locator('[data-status="available"]').first();
  const nodeId = (await node.getAttribute('data-node'))!;
  await node.click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.5);
  // A reload in the fight: the stash is packed on the next load into an «unload» fight.
  await page.reload();
  await expect(page.getByTestId('run-battle-modal')).toBeVisible();
  await page.getByTestId('run-battle').click();
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.3);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await page.getByTestId('result-map').click();
  let all = await records(page);
  for (const r of all) expect(checkRecord(r)).toBeNull();
  const fights = all.filter((r): r is FightRecord => r.kind === 'fight');
  expect(fights.map(f => f.outcome).sort()).toEqual(['unload', 'victory']);
  const unload = fights.find(f => f.outcome === 'unload')!, won = fights.find(f => f.outcome === 'victory')!;
  expect(unload.fight).toBe(fightKey(1, nodeId, 1));
  expect(won.fight).toBe(fightKey(2, nodeId, 2));
  // Both journals name the run's Params by hash and replay with the run record's Params to their hashes.
  for (const f of [unload, won]) expect(replay(await journalOf(all, f)).hash()).toBe(f.endHash);
  const runs = all.filter((r): r is RunRecord => r.kind === 'run');
  expect(runs).toHaveLength(1);
  const run = runs[0];
  expect(run.outcome).toBe('open');
  expect(run.choices.find(c => c.source === 'gift')!.taken).toHaveLength(1);
  expect(run.nodes.map(n => n.nodeId)).toEqual([nodeId]);
  expect(run.nodes[0]).toMatchObject({ fight: won.fight, hpOut: won.hpOut });
  expect(run.fights).toEqual([unload.fight, won.fight]);
  expect(run.runParams).toBeTruthy();
  // A new run: the old one is recorded as abandoned (the same id, the last copy wins), the new one opens.
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  all = await records(page);
  const after = all.filter((r): r is RunRecord => r.kind === 'run');
  expect(after).toHaveLength(2);
  expect(after.find(r => r.id === run.id)!.outcome).toBe('abandoned');
  expect(after.find(r => r.id !== run.id)!.outcome).toBe('open');
  expect(errors).toEqual([]);
});

test('replayTo puts the world at the tick of a recorded journal, paused', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors, '&seed=99');
  await page.keyboard.press('1');
  await playSome(page);
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as Journal;
  const at = Math.floor(journal.ticks * 0.6);
  await page.evaluate(([j, t]) => (window as any).__realtime.replayTo(j, t), [journal, at] as const);
  const s = await snap(page);
  expect(s.tick).toBe(at);
  expect(s.paused).toBe(true);
  const hash = await page.evaluate(() => (window as any).__realtime.hash()) as string;
  expect(replay({ ...journal, ticks: at, commands: journal.commands.filter(c => c.tick < at) }).hash()).toBe(hash);
  // The same world as the report's snapshot `--at` (the commands of that tick not applied).
  expect(analyzeJournal(journal, at).hash).toBe(hash);
  // Paused: the world stays at that tick.
  await page.waitForTimeout(300);
  expect((await snap(page)).tick).toBe(at);
  // The replayed world is not recorded as a new fight, also when it runs on (the fight left is `menu`).
  await page.keyboard.press('KeyP');
  await expect.poll(async () => (await snap(page)).tick).toBeGreaterThan(at + 10);
  const fights = (await records(page)).filter((r): r is FightRecord => r.kind === 'fight');
  expect(fights.map(f => f.outcome)).toEqual(['menu']);
  expect(errors).toEqual([]);
});

test('replayTo in a run is refused and changes nothing: the run save, the run state and the records stay; the fight goes on', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/realtime.html');
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    await new Promise<void>(resolve => { const r = indexedDB.deleteDatabase('ashen-oath-rt-tlm-v1'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  });
  await page.reload();
  await expect(page.getByTestId('run')).toBeVisible();
  await page.getByTestId('run-new').click();
  await page.getByTestId('gift-1').click();
  await page.locator('[data-status="available"]').first().click();
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.5);
  // A journal of this very fight: it would end as the run's arena if the hook took it.
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as Journal;
  const state = () => page.evaluate(async () => {
    const rt = (window as any).__realtime;
    const all = await rt.telemetry.records() as { id: string; outcome?: string }[];
    return { save: localStorage.getItem('ashen-oath-rt-run-v6'), run: JSON.stringify(rt.run.state()), arenaOpen: rt.run.arenaOpen() as boolean, records: all.map(r => `${r.id}:${r.outcome ?? ''}`).sort() };
  });
  const before = await state();
  expect(before.save).toBeTruthy();
  expect(before.arenaOpen).toBe(true);
  const tick = (await snap(page)).tick;
  const refused = await page.evaluate(async j => {
    try { await (window as any).__realtime.replayTo(j, j.ticks); return null; } catch (e) { return (e as Error).message; }
  }, journal);
  expect(refused).toMatch(/только в песочнице/);
  expect(await state()).toEqual(before);
  const s = await snap(page);
  expect(s.paused).toBe(false);
  await expect.poll(async () => (await snap(page)).tick).toBeGreaterThan(Math.max(tick, s.tick) + 10);
  expect(errors).toEqual([]);
});

test('the buffer stays within its limit: journals go first, notes and summaries stay', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors);
  const result = await page.evaluate(async () => {
    const t = (window as any).__realtime.telemetry, session = t.session as string, limit = t.limit() as number;
    const head = (id: string, kind: string) => ({ schema: 1, id, kind, build: 'x', params: { storage: 's', hash: 'h' }, session, run: 'sandbox', at: new Date().toISOString() });
    const big = 'x'.repeat(Math.floor(limit / 6));
    for (let i = 0; i < 4; i++) await t.put({ ...head(`${session}/sandbox/f${i}/n1`, 'note'), fight: `f${i}`, tick: 1, arena: 'a', hero: { x: 0, y: 0 } });
    for (let i = 0; i < 12; i++) await t.put({ ...head(`${session}/sandbox/f${i}/j0of1`, 'journal'), fight: `f${i}`, index: 0, count: 1, digest: 'd', encoding: 'compact+gzip+b64', data: big });
    const all = await t.records() as { id: string; kind: string }[];
    return { limit, snap: (window as any).__realtime.snapshot().telemetry, kinds: all.map(r => r.kind), ids: all.map(r => r.id) };
  });
  expect(result.snap.chars).toBeLessThanOrEqual(result.limit);
  expect(result.snap.bufferFull).toBe(false);
  expect(result.kinds.filter(k => k === 'note')).toHaveLength(4);
  const journals = result.ids.filter(id => id.endsWith('/j0of1'));
  expect(journals.length).toBeLessThan(12);
  expect(journals.length).toBeGreaterThanOrEqual(4);
  // The oldest journals went first: the last one written is kept.
  expect(journals).toContain(result.ids.find(id => id.includes('/f11/'))!);
  expect(journals.some(id => id.includes('/f0/'))).toBe(false);
  expect(errors).toEqual([]);
});

test('the dev-server sink writes the records into playtest-logs (only with ?telemetry=dev under tests)', async ({ page }) => {
  const errors: string[] = [];
  await openSandbox(page, errors, '&telemetry=dev');
  const session = await page.evaluate(() => (window as any).__realtime.telemetry.session) as string;
  const dir = join(process.cwd(), 'playtest-logs', session);
  try {
    await page.keyboard.press('1');
    await expect.poll(async () => (await snap(page)).time).toBeGreaterThan(0.3);
    await winSandbox(page);
    await expect.poll(() => (existsSync(join(dir, 'sandbox')) ? readdirSync(join(dir, 'sandbox')).sort() : []), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(/-fight\.json$/), expect.stringMatching(/-j0of1\.json$/)]));
    const fightFile = readdirSync(join(dir, 'sandbox')).find(f => f.endsWith('-fight.json'))!;
    const record = JSON.parse(readFileSync(join(dir, 'sandbox', fightFile), 'utf8')) as FightRecord;
    expect(record.outcome).toBe('victory');
    await expect.poll(async () => (await snap(page)).telemetry!.undelivered).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(errors).toEqual([]);
});

test('the cost of recording on «Большая поляна» (?arena=18) is below 0.1 ms per tick', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  await openSandbox(page, errors, '&arena=18&seed=5', false);
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('heroHp', 400); rt.burst(30); rt.telemetry.resetCost(); });
  await expect.poll(async () => (await snap(page)).time, { timeout: 60_000 }).toBeGreaterThan(1);
  // Walking and a chain held for a while: the crowd, commands and events every tick.
  await page.keyboard.down('KeyD');
  const { x, y } = (await snap(page)).hero;
  const s = await screen(page, x + 1, y);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(s.x + i * 6, s.y + (i % 2) * 8);
  await page.mouse.up();
  await expect.poll(async () => (await snap(page)).time, { timeout: 60_000 }).toBeGreaterThan(6);
  await page.keyboard.up('KeyD');
  const cost = await page.evaluate(() => (window as any).__realtime.telemetry.cost()) as { ms: number; ticks: number };
  const enemies = await page.evaluate(() => (window as any).__realtime.snapshot().enemies.length) as number;
  const perTick = cost.ms / cost.ticks;
  console.log(`telemetry cost: ${(perTick * 1000).toFixed(2)} µs per tick over ${cost.ticks} ticks, ${enemies} enemies`);
  test.info().annotations.push({ type: 'cost', description: `${(perTick * 1000).toFixed(2)} µs/tick, ${cost.ticks} ticks, ${enemies} enemies` });
  expect(cost.ticks).toBeGreaterThan(200);
  expect(perTick).toBeLessThan(0.1);
  // The same fight replayed in Node with and without the tap (a finer clock than the page's): the tap's share per tick.
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as Journal;
  const time = (withTap: boolean): number => {
    let tap: FightTap | null = null;
    const t0 = performance.now();
    replay(journal, sim => { if (withTap) { tap ??= new FightTap(createFightObserver(sim.world), sim.world); tap.flush(sim.world); tap.sampleView(sim.world.enemies.length, 1); } sim.world.events.length = 0; });
    return performance.now() - t0;
  };
  time(false); time(true);
  const plain = Math.min(time(false), time(false), time(false)), tapped = Math.min(time(true), time(true), time(true));
  const nodePerTick = Math.max(0, tapped - plain) / journal.ticks;
  console.log(`node replay: ${(plain / journal.ticks * 1000).toFixed(1)} µs/tick plain, tap +${(nodePerTick * 1000).toFixed(2)} µs/tick`);
  test.info().annotations.push({ type: 'node', description: `${(plain / journal.ticks * 1000).toFixed(1)} µs/tick plain, tap +${(nodePerTick * 1000).toFixed(2)} µs/tick` });
  expect(nodePerTick).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});
