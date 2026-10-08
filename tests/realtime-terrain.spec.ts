import { test, expect, type Page } from '@playwright/test';

/**
 * Terrain samples of stage 3a, step 1 in the sandbox (docs/realtime-stage3.md): «Река», «Обрыв», «Терновник», «Жаровни»,
 * «Теснина» — keys ⇧1–⇧5 on the menu or `?arena=11…15`; not in the run. Runs through playwright.realtime.config.ts only.
 * The test looks at what the player sees: the arena and its terrain drawn, the horde coming, the reason at the pointer for
 * a jump over the cliff, the brazier going out under a chain, thorns pricking — and no page errors. The rules themselves
 * are checked in Node (`npm run test:realtime-terrain`).
 */
interface Snap {
  arena: string;
  status: string;
  time: number;
  energy: number;
  moving: string | null;
  hero: { x: number; y: number; hp: number; maxHp: number };
  enemies: { id: number }[];
  objects: { id: number; kind: string; x: number; y: number; out?: number }[];
  terrain: { river: number; cliff: number; thorns: number };
  signals: Record<string, number>;
  heroInThorns: boolean;
  heroOverCliff: boolean;
  jumpHint: string | null;
}
const snap = (page: Page): Promise<Snap> => page.evaluate(() => (window as any).__realtime.snapshot());
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([x, y]) => (window as any).__realtime.toScreen(x, y), [x, y]);
async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const at = await screen(page, x, y);
  await page.mouse.move(at.x, at.y);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openSandbox(page: Page): Promise<void> {
  await page.goto('/realtime.html?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#rt-app canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await expect(page.getByTestId('menu')).toBeVisible();
}

/** No newcomers, slow enemies, touches do not hurt: only what the test places acts (journalled param commands). */
async function quiet(page: Page, hero: { x: number; y: number }): Promise<void> {
  await page.evaluate(([x, y]) => {
    const rt = (window as any).__realtime;
    for (const [key, value] of [['enemySpeed', 0.2], ['speedSpread', 0], ['baseIntervalMin', 20], ['baseIntervalMax', 20], ['baseFloor', 0], ['contactDamage', 0], ['boarDamage', 0], ['wolfPackBonus', 0]] as const) rt.setParam(key, value);
    rt.clear(false);
    rt.teleport(x, y);
  }, [hero.x, hero.y] as const);
}

const SAMPLES = [
  { n: 11, key: '1', id: 'river', name: 'Река', terrain: { river: 1, cliff: 0, thorns: 0 }, braziers: 0 },
  { n: 12, key: '2', id: 'cliff', name: 'Обрыв', terrain: { river: 0, cliff: 1, thorns: 0 }, braziers: 0 },
  { n: 13, key: '3', id: 'thicket', name: 'Терновник', terrain: { river: 0, cliff: 0, thorns: 3 }, braziers: 0 },
  { n: 14, key: '4', id: 'braziers', name: 'Жаровни', terrain: { river: 0, cliff: 0, thorns: 0 }, braziers: 3 },
  { n: 15, key: '5', id: 'gorge', name: 'Теснина', terrain: { river: 0, cliff: 0, thorns: 0 }, braziers: 0 },
];

test('terrain samples: the menu lists them under their heading; ⇧1–⇧5 open each with its terrain drawn, the horde comes, no errors', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openSandbox(page);
  await expect(page.locator('[data-testid^="arena-"]')).toHaveCount(17);
  await expect(page.locator('.rt-arenas-head').first()).toContainText('Местность');
  for (const s of SAMPLES) {
    await expect(page.getByTestId(`arena-${s.n}`)).toContainText(s.name);
    await expect(page.getByTestId(`arena-${s.n}`).locator('kbd')).toHaveText(`⇧${s.key}`);
  }
  await page.screenshot({ path: 'artifacts/realtime-terrain-menu.png' });
  for (const s of SAMPLES) {
    if (!(await page.getByTestId('menu').isVisible())) await page.keyboard.press('KeyM');
    await expect(page.getByTestId('menu')).toBeVisible();
    await page.keyboard.press(`Shift+Digit${s.key}`);
    await expect(page.getByTestId('menu')).toBeHidden();
    await expect.poll(async () => (await snap(page)).arena).toBe(s.id);
    const start = await snap(page);
    expect(start.terrain, `${s.id}: terrain drawn`).toEqual(s.terrain);
    expect(start.objects.filter(o => o.kind === 'brazier').length, `${s.id}: braziers`).toBe(s.braziers);
    if (s.braziers) await expect.poll(async () => (await snap(page)).signals.braziersLit).toBe(s.braziers);
    // The horde comes (game time; nothing hurts the standing hero — thorns neither: he stands outside them).
    await page.evaluate(() => { const rt = (window as any).__realtime; for (const key of ['contactDamage', 'wolfPackBonus', 'boarDamage', 'thornDamage']) rt.setParam(key, 0); });
    await expect.poll(async () => (await snap(page)).time, { timeout: 30_000 }).toBeGreaterThan(4);
    const later = await snap(page);
    expect(later.enemies.length, `${s.id}: newcomers`).toBeGreaterThan(0);
    expect(later.status).toBe('playing');
    expect(later.heroOverCliff).toBe(false);
    await page.screenshot({ path: `artifacts/realtime-terrain-${s.id}.png` });
  }
  expect(errors).toEqual([]);
});

/** Stage 3a, step 2: the terrain of the slice arenas 4–10 (one feature each; 9 and 10 two). The gorge is walls only. */
const SLICE = [
  { n: 4, id: 'shields', terrain: { river: 0, cliff: 0, thorns: 0 }, braziers: 2 },
  { n: 5, id: 'archers', terrain: { river: 0, cliff: 0, thorns: 0 }, braziers: 0 },
  { n: 6, id: 'powder', terrain: { river: 0, cliff: 2, thorns: 0 }, braziers: 0 },
  { n: 7, id: 'thorns', terrain: { river: 0, cliff: 0, thorns: 3 }, braziers: 0 },
  { n: 8, id: 'ford', terrain: { river: 1, cliff: 0, thorns: 0 }, braziers: 0 },
  { n: 9, id: 'outpost', terrain: { river: 0, cliff: 1, thorns: 0 }, braziers: 0 },
  { n: 10, id: 'last-stand', terrain: { river: 0, cliff: 0, thorns: 0 }, braziers: 2 },
];

test('arenas 4–10 (stage 3a, step 2): `?arena=4…10` opens each with its terrain drawn and its braziers lit; the horde comes; no errors', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  for (const s of SLICE) {
    await page.goto(`/realtime.html?sandbox=1&arena=${s.n}`);
    await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot().arena)).toBe(s.id);
    await expect(page.getByTestId('menu')).toBeHidden();
    const start = await snap(page);
    expect(start.terrain, `${s.id}: terrain drawn`).toEqual(s.terrain);
    expect(start.objects.filter(o => o.kind === 'brazier').length, `${s.id}: braziers`).toBe(s.braziers);
    if (s.braziers) await expect.poll(async () => (await snap(page)).signals.braziersLit).toBe(s.braziers);
    // Nothing hurts the standing hero: the horde comes and the fight goes on.
    await page.evaluate(() => { const rt = (window as any).__realtime; for (const key of ['contactDamage', 'archerDamage', 'sapperDamage', 'thornDamage', 'eliteDamageBonus', 'porcupineQuills']) rt.setParam(key, 0); });
    await expect.poll(async () => (await snap(page)).time, { timeout: 30_000 }).toBeGreaterThan(3);
    const later = await snap(page);
    expect(later.enemies.length, `${s.id}: enemies`).toBeGreaterThan(0);
    expect(later.status).toBe('playing');
    expect(later.heroOverCliff).toBe(false);
    await page.screenshot({ path: `artifacts/realtime-terrain-arena-${s.n}.png` });
  }
  expect(errors).toEqual([]);
});

test('terrain samples: `?arena=11…15` opens each at once', async ({ page }) => {
  const errors = collectErrors(page);
  for (const s of SAMPLES) {
    await page.goto(`/realtime.html?sandbox=1&arena=${s.n}`);
    await expect.poll(() => page.evaluate(() => (window as any).__realtime?.snapshot().arena)).toBe(s.id);
    await expect(page.getByTestId('menu')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('«Обрыв»: a jump aimed over the drop shows «обрыв» at the pointer and does not start; over it to the far bank — lands', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await snap(page)).arena).toBe('cliff');
  await quiet(page, { x: 6.6, y: 4.4 });
  await page.evaluate(() => (window as any).__realtime.setEnergy(4));
  await page.keyboard.press('Space');
  await pointAt(page, 8, 4.4);
  await expect(page.locator('.rt-hint')).toBeVisible();
  await expect(page.locator('.rt-hint')).toHaveText('обрыв');
  await expect.poll(async () => (await snap(page)).jumpHint).toBe('cliff');
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(150);
  let s = await snap(page);
  expect(s.energy).toBe(4);
  expect(s.heroOverCliff).toBe(false);
  expect(Math.abs(s.hero.x - 6.6)).toBeLessThan(0.3);
  // Over the drop to the far bank: the hint goes, the jump flies over and lands.
  await pointAt(page, 9.6, 4.4);
  await expect.poll(async () => (await snap(page)).jumpHint).toBe(null);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(async () => (await snap(page)).hero.x, { timeout: 5_000 }).toBeGreaterThan(9.2);
  s = await snap(page);
  expect(s.heroOverCliff).toBe(false);
  expect(s.energy).toBe(2);
  expect(errors).toEqual([]);
});

test('«Жаровни»: a chain from a brazier through an enemy — the brazier goes out (drawn grey), then burns again', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await page.keyboard.press('Shift+Digit4');
  await expect.poll(async () => (await snap(page)).arena).toBe('braziers');
  await quiet(page, { x: 5, y: 5.2 });
  await page.evaluate(() => { const rt = (window as any).__realtime; rt.setParam('brazierCooldown', 2); rt.place(5, 2, 0, 2, 'basic'); });
  const from = await screen(page, 5, 3.5), to = await screen(page, 5, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect.poll(async () => (await page.evaluate(() => (window as any).__realtime.snapshot().chain.length))).toBe(2);
  await page.mouse.up();
  // The enemy with 2 HP dies to the chain after the brazier (+2): the brazier is out and drawn grey.
  await expect.poll(async () => (await snap(page)).signals.braziersOut, { timeout: 5_000 }).toBe(1);
  // The pass reaches the brazier before the enemy: the brazier may be out a frame before the enemy dies.
  await expect.poll(async () => (await snap(page)).enemies.length, { timeout: 5_000 }).toBe(0);
  const s = await snap(page);
  expect(s.objects.find(o => o.kind === 'brazier' && o.x === 5)?.out).toBeGreaterThan(0);
  await expect.poll(async () => (await snap(page)).signals.braziersLit, { timeout: 10_000 }).toBe(3);
  expect(errors).toEqual([]);
});

test('«Терновник»: the hero walking into thorns loses HP (the chain through them — in Node, test:realtime-terrain)', async ({ page }) => {
  const errors = collectErrors(page);
  await openSandbox(page);
  await page.keyboard.press('Shift+Digit3');
  await expect.poll(async () => (await snap(page)).arena).toBe('thicket');
  await quiet(page, { x: 4.6, y: 5 });
  const hp0 = (await snap(page)).hero.hp;
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await snap(page)).heroInThorns, { timeout: 5_000 }).toBe(true);
  await page.keyboard.up('KeyD');
  await expect.poll(async () => (await snap(page)).hero.hp, { timeout: 5_000 }).toBeLessThan(hp0);
  expect(errors).toEqual([]);
});
