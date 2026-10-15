import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { replay, type Journal } from '../src/realtime/sim/simulation';
import { gameWait, untilFrame } from './realtimeFrames';

/**
 * Enemy behaviour of stage 3a, steps 3–4 in the sandbox (docs/realtime-stage3.md, section 10): the wolves' howl circle,
 * the lynx's leap line and stun, the shaman's beam; the arenas «Рысье логово» and «Круг шамана» (⇧6, ⇧7, `?arena=16…17`);
 * the whole sandbox menu at 1280×720. Runs through playwright.realtime.config.ts only. The test looks at what the player
 * sees — the signals on screen and the menu — and that the page has no errors; the rules are checked in Node
 * (`npm run test:realtime-behavior`).
 */
interface Snap {
  arena: string;
  status: string;
  time: number;
  hero: { x: number; y: number; hp: number };
  enemies: { id: number; kind: string; marked: boolean; hp: number }[];
  objects: { kind: string }[];
  signals: Record<string, number>;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page, query = ''): Promise<void> {
  await page.goto(`/?sandbox=1${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
}

/** Only what the test places acts: no newcomers, basic enemies stand, nothing hurts the hero (journalled param commands). */
async function quiet(page: Page, hero: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0], ['speedSpread', 0], ['baseIntervalMin', 1000], ['baseIntervalMax', 1000], ['baseFloor', 0], ['contactDamage', 0], ['wolfPackBonus', 0], ['lynxDamage', 0]] as const) rt.setParam(key, value);
    // De-flake 12.10.2026: the group timer rolled at the start still fires once after the interval changes, and its
    // newcomers stepped into the scene (a wolf of it walked into the ring: four rush lanes, not three). An arena limit of 0
    // keeps the queue empty — a direct write, since the journalled `setParam` clamps the limit to the panel's 1 (the replay
    // test of this file does not use this helper).
    rt.params.maxEnemies = 0;
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y] as const);
}
const place = (page: Page, x: number, y: number, color: number, hp: number, kind: string): Promise<number> =>
  page.evaluate(([x, y, color, hp, kind]) => (window as any).__realtime.place(x, y, color, hp, kind), [x, y, color, hp, kind] as const);

test('the sandbox menu at 1280×720: all 17 arenas are reachable (two columns, the list scrolls inside the card), ⇧6 and ⇧7 are the new enemies\' arenas', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await expect(page.getByTestId('menu')).toBeVisible();
  const buttons = page.locator('[data-testid^="arena-"]');
  await expect(buttons).toHaveCount(17);
  await expect(page.locator('.rt-arenas-head').nth(1)).toContainText('рысь и шаман');
  await expect(page.getByTestId('arena-16')).toContainText('Рысье логово');
  await expect(page.getByTestId('arena-16').locator('kbd')).toHaveText('⇧6');
  await expect(page.getByTestId('arena-17')).toContainText('Круг шамана');
  await expect(page.getByTestId('arena-17').locator('kbd')).toHaveText('⇧7');
  // The card stays inside the window; every arena button can be brought into view inside it.
  const card = await page.locator('.rt-menu-card').boundingBox();
  expect(card && card.y >= 0 && card.y + card.height <= 720 && card.x >= 0 && card.x + card.width <= 1280, `card ${JSON.stringify(card)}`).toBe(true);
  for (let i = 1; i <= 17; i++) {
    const b = page.getByTestId(`arena-${i}`);
    await b.scrollIntoViewIfNeeded();
    const box = await b.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 720 && box.x >= 0 && box.x + box.width <= 1280, `arena ${i}: ${JSON.stringify(box)}`).toBe(true);
  }
  await page.screenshot({ path: 'artifacts/realtime-behavior-menu.png' });
  await page.keyboard.press('Shift+Digit6');
  await expect.poll(async () => (await snap(page)).arena).toBe('lynx-den');
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Shift+Digit7');
  await expect.poll(async () => (await snap(page)).arena).toBe('shaman-circle');
  expect(errors).toEqual([]);
});

test('`?arena=16…17` opens «Рысье логово» and «Круг шамана»: lynxes, marked shamans and braziers on the field, the horde comes', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  for (const [n, id] of [[16, 'lynx-den'], [17, 'shaman-circle']] as const) {
    await openSandbox(page, `&arena=${n}`);
    await expect(page.getByTestId('menu')).toBeHidden();
    await expect.poll(async () => (await snap(page)).arena).toBe(id);
    const start = await snap(page);
    if (id === 'lynx-den') expect(start.enemies.filter(e => e.kind === 'lynx').length).toBe(2);
    else {
      expect(start.enemies.filter(e => e.kind === 'shaman' && e.marked).length).toBe(3);
      expect(start.objects.filter(o => o.kind === 'brazier').length).toBe(3);
    }
    await page.evaluate(() => { const rt = (window as any).__realtime; for (const key of ['contactDamage', 'lynxDamage']) rt.setParam(key, 0); });
    await expect.poll(async () => (await snap(page)).time, { timeout: 30_000 }).toBeGreaterThan(4);
    const later = await snap(page);
    expect(later.status).toBe('playing');
    expect(later.enemies.length).toBeGreaterThan(start.enemies.length);
    await page.screenshot({ path: `artifacts/realtime-behavior-${id}.png` });
  }
  expect(errors).toEqual([]);
});

/**
 * The signals last a fraction of a second at the default numbers (the howl 0.6 s, the windup 0.6 s, the stun 1 s) and come
 * in a steady rhythm: a poll every second may keep missing them. The test lengthens them through journalled panel values
 * (it checks that the signal is drawn, not its timing — that is Node's) and polls often.
 */
const SIGNAL_POLL = { timeout: 20_000, intervals: [50] };

test('signals on screen: the wolves\' howl circle, the lynx\'s leap line and stun stars, the shaman\'s beam', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const lengthen = (): Promise<void> => page.evaluate(() => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['wolfHowl', 2.5], ['lynxWindup', 2], ['lynxStun', 3], ['shamanBeam', 3]] as const) rt.setParam(key, value);
  });
  // Wolves: three round the hero on an open patch of arena 1 — they spread and howl.
  await openSandbox(page, '&arena=1');
  await quiet(page, { x: 8, y: 5 });
  await lengthen();
  for (const deg of [-150, -90, -30]) await place(page, 8 + Math.cos(deg * Math.PI / 180) * 3, 5 + Math.sin(deg * Math.PI / 180) * 3, 0, 0, 'wolf');
  await expect.poll(async () => (await snap(page)).signals.howls, SIGNAL_POLL).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-behavior-howl.png' });
  // The lynx: 3.2 from the hero — its line, then the stars of its stun.
  await openSandbox(page, '&arena=16');
  await quiet(page, { x: 7.8, y: 5 });
  await lengthen();
  await place(page, 7.8, 1.8, 1, 0, 'lynx');
  await expect.poll(async () => (await snap(page)).signals.leapLines, SIGNAL_POLL).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-behavior-leap.png' });
  await expect.poll(async () => (await snap(page)).signals.stunned, SIGNAL_POLL).toBeGreaterThan(0);
  // The shaman: a weak enemy next to it — the beam, then it is tough.
  await openSandbox(page, '&arena=17');
  await quiet(page, { x: 8, y: 8.3 });
  await lengthen();
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('shamanFirstMin', 0.5); rt.setParam('shamanFirstMax', 0.5); });
  await place(page, 8, 2.6, 2, 1, 'shaman');
  const target = await place(page, 9.4, 2.6, 0, 0, 'basic');
  await expect.poll(async () => (await snap(page)).signals.beams, SIGNAL_POLL).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/realtime-behavior-beam.png' });
  await expect.poll(async () => (await snap(page)).enemies.find(e => e.id === target)?.hp, SIGNAL_POLL).toBe(2);
  expect(errors).toEqual([]);
});

/**
 * Phase A (Т3, design answer 11 of docs/realtime-phase-a.md): each howling wolf draws its rush lane (from the wolf to the
 * end of its rush) — the lanes on screen match the wolves howling or rushing; the howl circle stays.
 */
test('phase A: the rush lane of every howling wolf is on screen, as many as the wolves howling', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=1');
  await quiet(page, { x: 8, y: 5 });
  await page.evaluate(() => (window as any).__realtime.setParam('wolfHowl', 2.5));
  for (const deg of [-150, -90, -30]) await place(page, 8 + Math.cos(deg * Math.PI / 180) * 3, 5 + Math.sin(deg * Math.PI / 180) * 3, 0, 0, 'wolf');
  // The lanes of the last frame against the wolves howling (st 1) or rushing (st 2) now, read together.
  const read = (): Promise<{ lanes: number; howling: number; circle: number }> => page.evaluate(() => {
    const s = (window as any).__realtime.snapshot();
    return { lanes: s.rushLanes, howling: s.enemies.filter((e: any) => e.kind === 'wolf' && (e.vars.st === 1 || e.vars.st === 2)).length, circle: s.signals.howls };
  });
  await expect.poll(async () => { const r = await read(); return r.howling === 3 && r.lanes === 3 && r.circle === 1; }, SIGNAL_POLL).toBe(true);
  expect((await snap(page)).signals.rushLanes).toBe(3);
  await page.screenshot({ path: 'artifacts/realtime-phaseA-howl-lanes.png' });
  // Before the howl and after the rush there is no lane.
  await page.evaluate(() => (window as any).__realtime.clear(false));
  await expect.poll(async () => (await read()).lanes, SIGNAL_POLL).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Phase A (Т6, docs/realtime-phase-a.md, section 7): the archer's mark is a hatched threat circle at the marked point while
 * it aims (the point is the default), the arrow falls with a short flash there. Next to the wolves' howl (a thin circle
 * without fill) both read: the screenshot is the design check of the second pass.
 */
test('phase A: the archer\'s mark circle is drawn while it aims and flashes when the arrow falls; next to the howl', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=1');
  await quiet(page, { x: 8, y: 5 });
  // Default windup first: the mark appears, fills and the arrow falls with a flash.
  // De-flake 12.10.2026: the signals are read frame by frame inside the page and the waits bounded by game time (20 s of
  // wall time could pass before a loaded page played the archer's cycle).
  const archer = await place(page, 11.5, 6.0, 3, 1, 'archer');
  const marked = await untilFrame(page, (s, _: null, late) => s.archerMarks === 1 || late ? { marks: s.archerMarks, flashes: s.arrowFlashes } : undefined, null, 10);
  expect(marked.marks).toBe(1);
  expect(await untilFrame(page, (s, before: number, late) => s.arrowFlashes > before || late ? s.arrowFlashes : undefined, marked.flashes, 10)).toBeGreaterThan(marked.flashes);
  // Lengthened howl and windup: the mark and the howl together on screen.
  await page.evaluate(([id]) => { const rt = (window as any).__realtime; rt.setParam('wolfHowl', 6); rt.setParam('archerWindup', 6); }, [archer] as const);
  for (const deg of [-150, -90, -30]) await place(page, 8 + Math.cos(deg * Math.PI / 180) * 3, 5 + Math.sin(deg * Math.PI / 180) * 3, 0, 0, 'wolf');
  const together = await untilFrame(page, (s, _: null, late) => {
    const v = { howls: s.signals.howls, archerMarks: s.archerMarks, rushLanes: s.rushLanes };
    return v.howls === 1 && v.archerMarks === 1 && v.rushLanes === 3 || late ? v : undefined;
  }, null, 20);
  expect(together).toEqual({ howls: 1, archerMarks: 1, rushLanes: 3 });
  await page.screenshot({ path: 'artifacts/realtime-phaseA-archer-mark-howl.png' });
  expect(errors).toEqual([]);
});

/**
 * Phase A (Т4, docs/realtime-phase-a.md, sections 3 and 5): elite affixes on screen — a short label in the badge strip of
 * an elite with an affix (none for a plain elite; the role toggle does not hide it), the fire trail of «Огненный» drawn as
 * warm ground, «Хамелеон» blinking its next colour in its window. Placed through the journalled `place {elite, affixes}`.
 */
test('phase A: affix labels under elites with affixes only, the fire trail is drawn, the chameleon blinks in its window', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=1');
  await quiet(page, { x: 8, y: 5 });
  // The chameleon's window lengthened (a journalled panel value) so that a poll meets it; the fiery elite walks to lay its trail.
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('chameleonWarn', 2); rt.setParam('enemySpeed', 1.2); });
  const placeElite = (x: number, y: number, color: number, kind: string, affixes: string[]): Promise<number> =>
    page.evaluate(([x, y, color, kind, affixes]) => (window as any).__realtime.place(x, y, color, 1, kind, true, affixes), [x, y, color, kind, affixes] as const);
  await placeElite(2.5, 8.5, 1, 'basic', ['fiery']);
  await placeElite(11.5, 6.0, 2, 'shield', ['chameleon']);
  await placeElite(4.5, 2.0, 3, 'basic', []);
  for (let i = 0; i < 6; i++) await place(page, 5 + i * 0.7, 7.2 + (i % 2) * 0.6, i % 4, 0, 'basic');
  // One label each under the fiery and the chameleon elite; none under the plain elite (one frame later).
  await expect.poll(async () => (await snap(page) as any).affixLabels).toBe(2);
  await expect.poll(async () => (await snap(page) as any).trailPoints, SIGNAL_POLL).toBeGreaterThan(2);
  await expect.poll(async () => (await snap(page) as any).chameleonWarns, SIGNAL_POLL).toBe(1);
  await page.screenshot({ path: 'artifacts/realtime-phaseA-affixes.png' });
  // The role toggle hides role badges, not the affix labels.
  await page.keyboard.press('F1');
  await page.getByTestId('role-badges').uncheck();
  await expect.poll(async () => (await snap(page) as any).signals.roleBadges).toBe(0);
  expect((await snap(page) as any).affixLabels).toBe(2);
  expect(errors).toEqual([]);
});

/**
 * Phase A (Т3): the role badge under each body by its kind — shooter (archer), blocker (shield), punisher (porcupine,
 * sapper), master (shaman), diver (wolf, lynx); the presser (basic, boar) has none. The toggle on the debug panel is a view
 * setting: it hides them, keeps its own storage key across a reload and never reaches the journal.
 */
test('phase A: role badges by kind; the panel toggle hides them, survives a reload and stays out of the journal', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const setup = async (): Promise<void> => {
    await quiet(page, { x: 8, y: 7.5 });
    const kinds = ['basic', 'boar', 'archer', 'shield', 'porcupine', 'sapper', 'shaman', 'wolf', 'lynx'];
    for (let i = 0; i < kinds.length; i++) await place(page, 1.6 + i * 1.6, 3.2, i % 4, 1, kinds[i]);
  };
  await openSandbox(page, '&arena=1');
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('wolfRing', false); rt.setParam('lynxFirstDelay', 99); });
  await setup();
  const expected = { shooter: 1, blocker: 1, punisher: 2, master: 1, diver: 2 };
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().badgeRoles))).toEqual(expected);
  expect((await snap(page)).signals.roleBadges).toBe(7);
  await page.screenshot({ path: 'artifacts/realtime-phaseA-role-badges.png' });
  const commands = (): Promise<number> => page.evaluate(() => (window as any).__realtime.journal().commands.length);
  const before = await commands();
  await page.keyboard.press('F1');
  const toggle = page.getByTestId('role-badges');
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(async () => (await snap(page)).signals.roleBadges).toBe(0);
  expect(await commands()).toBe(before);
  // A reload keeps the setting (its own key; the test's openSandbox would clear the storage, so reload by hand).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.evaluate(() => (window as any).__realtime.selectArena(1));
  await setup();
  await page.waitForTimeout(300);
  expect((await snap(page)).signals.roleBadges).toBe(0);
  await expect(page.getByTestId('role-badges')).not.toBeChecked();
  await page.getByTestId('role-badges').check();
  await expect.poll(async () => (await snap(page)).signals.roleBadges).toBe(7);
  expect(errors).toEqual([]);
});

/**
 * Engines differ in the last bits of `Math.sin`/`Math.cos`/`Math.atan2`: behaviour that turns angles every tick (the
 * wolves' ring) once drifted between Chromium and Node, and a recorded fight no longer replayed. Behaviour code uses
 * `sim/detMath.ts`; this records fights with the new enemies in the browser and replays them in Node (the wolves — the
 * journal test of realtime.spec.ts on arena 1).
 */
test('fights on «Рысье логово» and «Круг шамана» recorded in the browser replay in Node to the same world hash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  for (const n of [16, 17]) {
    await page.goto(`/?sandbox=1&seed=777&arena=${n}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
    await page.evaluate(() => (window as any).__realtime.setParam('heroHp', 40));
    for (const key of ['KeyD', 'KeyS', 'KeyA', 'KeyW', 'KeyD']) {
      const t0 = (await snap(page)).time;
      await page.keyboard.down(key);
      await expect.poll(async () => (await snap(page)).time, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(t0 + 1.4);
      await page.keyboard.up(key);
    }
    const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
    expect(recorded.journal.ticks).toBeGreaterThan(300);
    expect(replay(recorded.journal).hash(), `arena ${n}`).toBe(recorded.hash);
  }
  expect(errors).toEqual([]);
});

/**
 * Task 38 «Гарнизон» (docs/realtime-elite-behaviors.md, «Гарнизон»): the sandbox «Псарня» (`?arena=21`). A real chain drawn with the
 * mouse across a leash: while it is drawn the leash is red (the highlight's cut, the placeholder line of the view), after the dash it
 * is gone and the hound runs mad at the bodies around it; the browser fight replays in Node to the same hash.
 */
test('task 38: «Псарня» — a chain drawn with the mouse across a leash: red while drawn, cut after the dash, the hound runs mad at the crowd; the fight replays in Node', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page, '&arena=21');
  await expect.poll(async () => (await snap(page)).arena).toBe('g-kennel');
  await quiet(page, { x: 4, y: 8.5 });
  const handler = await place(page, 8.5, 8.5, 1, 1, 'handler');
  // The handler gets its hounds; they run at the hero to the end of their leashes, then everybody stands.
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 1.5));
  await gameWait(page, 2.5);
  await page.evaluate(() => (window as any).__realtime.setParam('enemySpeed', 0));
  await gameWait(page, 0.1);
  type Body = { id: number; kind: string; x: number; y: number; vars: Record<string, number> };
  type TetherSnap = { list: { holder: number; held: number }[]; lines: number; cut: number };
  const read = async (): Promise<{ enemies: Body[]; tethers: TetherSnap; chain: number[] }> => page.evaluate(() => (window as any).__realtime.snapshot());
  let s = await read();
  expect(s.tethers.list.length).toBe(2);
  expect(s.tethers.lines).toBe(2);
  const h = s.enemies.find(e => e.id === handler)!, hound = s.enemies.find(e => e.id === s.tethers.list[0].held)!;
  const mx = (h.x + hound.x) / 2, my = (h.y + hound.y) / 2, d = Math.hypot(hound.x - h.x, hound.y - h.y), px = -(hound.y - h.y) / d, py = (hound.x - h.x) / d;
  const a = await place(page, mx + px * 0.9, my + py * 0.9, 0, 0, 'basic'), b = await place(page, mx - px * 0.9, my - py * 0.9, 0, 0, 'basic');
  await page.evaluate(([x, y]) => (window as any).__realtime.teleport(x, y), [mx + px * 1.9, my + py * 1.9] as const);
  // The chain with the mouse: press on a, drag to b — the leash between them turns red while the chain is held.
  const at = async (id: number): Promise<{ x: number; y: number }> => { const e = (await read()).enemies.find(x => x.id === id)!; return page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [e.x, e.y] as const); };
  const pa = await at(a);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  const pb = await at(b);
  await page.mouse.move(pb.x, pb.y, { steps: 6 });
  await expect.poll(async () => (await read()).chain).toEqual([a, b]);
  await expect.poll(async () => (await read()).tethers.cut).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/realtime-garrison-leash-cut.png' });
  await page.mouse.up();
  await expect.poll(async () => (await read()).tethers.list.some(t => t.held === hound.id), { timeout: 5_000 }).toBe(false);
  s = await read();
  expect((s.enemies.find(e => e.id === hound.id)?.vars.fz ?? 0) > 0 || !s.enemies.some(e => e.id === hound.id), 'the hound runs mad').toBe(true);
  // The crowd by the mad hound (held by the cold): its bites take them — not the player's kills.
  const crowd = await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime, ids = [rt.place(x + 1.1, y, 2, 0, 'basic'), rt.place(x + 1.1, y + 0.8, 2, 0, 'basic'), rt.place(x + 1.1, y - 0.8, 2, 0, 'basic')];
    for (const id of ids) rt.chill(id, 30);
    rt.teleport(15, 2);
    rt.setParam('enemySpeed', 1.5);
    return ids as number[];
  }, [hound.x, hound.y] as const);
  const kills = (await page.evaluate(() => (window as any).__realtime.snapshot().stats.kills)) as number;
  await expect.poll(async () => { const now = await read(); return crowd.filter(id => now.enemies.some(e => e.id === id)).length; }, { timeout: 8_000 }).toBeLessThan(3);
  await page.screenshot({ path: 'artifacts/realtime-garrison-frenzy.png' });
  expect(await page.evaluate(() => (window as any).__realtime.snapshot().stats.kills)).toBe(kills);
  const recorded = await page.evaluate(() => { const rt = (window as any).__realtime; return { journal: rt.journal(), hash: rt.hash() }; }) as { journal: Journal; hash: string };
  expect(replay(recorded.journal).hash()).toBe(recorded.hash);
  expect(errors).toEqual([]);
});
