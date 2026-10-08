import { test, expect, type Page } from '@playwright/test';
import { replay, type Journal } from '../src/realtime/sim/simulation';

/**
 * Enemy behaviour of stage 3a, steps 3–4 in the sandbox (docs/realtime-stage3.md, section 9): the wolves' howl circle,
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
  await page.goto(`/realtime.html?sandbox=1${query}`);
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
 * Engines differ in the last bits of `Math.sin`/`Math.cos`/`Math.atan2`: behaviour that turns angles every tick (the
 * wolves' ring) once drifted between Chromium and Node, and a recorded fight no longer replayed. Behaviour code uses
 * `sim/detMath.ts`; this records fights with the new enemies in the browser and replays them in Node (the wolves — the
 * journal test of realtime.spec.ts on arena 1).
 */
test('fights on «Рысье логово» and «Круг шамана» recorded in the browser replay in Node to the same world hash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  for (const n of [16, 17]) {
    await page.goto(`/realtime.html?sandbox=1&seed=777&arena=${n}`);
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
