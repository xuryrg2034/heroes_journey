import { test, expect, type Page } from '@playwright/test';

/**
 * Casino stage 1, item 2 — «Ставка клятвы» (src/realtime/sim/oath.ts, src/realtime/run/rtRun.ts, docs/realtime-casino.md):
 * the run with real clicks. A run row 1 battle has no oaths («Идти»); the row 2 battle's card shows two oaths and
 * «Без клятвы»; a reload shows the same two; the oath taken shows one line under the goal: «Цепь 6+ хотя бы раз» waits —
 * «Клятва: цепь 6+», no ✓; the hero goes through the door without such a chain — the door breaks it, records ×0.5, the line
 * dims with «×0,5» (П11: a broken oath is no win).
 *
 * Seed 10 (a seeded run gets the full gift): the gift button 1 takes no second pick; `r5c0` is a battle of run row 1, `r6c1`
 * a battle of run row 2 whose card offers «Не больше 2 урона» and «Цепь 6+ хотя бы раз» (the run's oath stream with the node
 * id, draw 0; before the calibration of 12.10.2026 the same draw offered «Без прыжков» in its place).
 */

const SEED = 10;

async function openRun(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}
const snapshot = (page: Page): Promise<{ status: string; hero: { x: number; y: number }; moving: string | null; oath: { id: string; broken?: number; mark: string; line: string | null; dim: boolean } | null; purse: { door: { oath: number } | null } }> =>
  page.evaluate(() => (window as any).__realtime.snapshot());

async function winArena(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
}

test('the oath stake: the card of a row 2 battle offers two oaths and «Без клятвы», a reload keeps them; the HUD line waits; the door breaks an unmet «Цепь 6+» — «×0,5», dimmed', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();

  // Run row 1: no oaths — the card keeps «Идти»; the arena has no oath line.
  await page.getByTestId('node-r5c0').click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await expect(page.getByTestId('run-enter')).toHaveText('Идти');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await expect(page.getByTestId('oath-line')).toBeHidden();
  expect((await snapshot(page)).oath).toBeNull();
  await winArena(page);
  await page.getByTestId('result-map').click();
  await expect(page.getByTestId('run')).toBeVisible();

  // Run row 2: two oaths and «Без клятвы».
  await page.getByTestId('node-r6c1').click();
  await expect(page.getByTestId('run-oaths')).toBeVisible();
  await expect(page.getByTestId('run-oaths').locator('[data-action="enter-oath"]')).toHaveCount(2);
  await expect(page.getByTestId('oath-chain6')).toContainText('Клятва: Цепь 6+ хотя бы раз');
  await expect(page.getByTestId('oath-chain6')).toContainText('Хотя бы раз рывок цепи бьёт 6+ врагов.');
  await expect(page.getByTestId('oath-no-jump')).toHaveCount(0);
  await expect(page.getByTestId('oath-damage2')).toContainText('Клятва: Не больше 2 урона');
  await expect(page.getByTestId('run-enter')).toHaveText('Без клятвы');
  await expect(page.getByTestId('run-oaths')).toContainText('×2');
  await expect(page.getByTestId('run-oaths')).toContainText('×0,5');
  await page.screenshot({ path: 'artifacts/realtime-oath-card.png' });

  // A reload re-rolls nothing.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('node-r6c1').click();
  await expect(page.getByTestId('oath-chain6')).toBeVisible();
  await expect(page.getByTestId('oath-damage2')).toBeVisible();

  // Swear «Цепь 6+ хотя бы раз»: the arena opens under it, one line under the goal — it waits, no ✓.
  await page.getByTestId('oath-chain6').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const state = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(state.pending.oath).toBe('chain6');
  expect(state.pending.oathOffer).toEqual(['damage2', 'chain6']);
  await expect(page.getByTestId('oath-line')).toHaveText('Клятва: цепь 6+');
  await expect(page.getByTestId('oath-line')).not.toHaveClass(/rt-oath-broken/);
  expect((await snapshot(page)).oath?.mark).toBe('waits');
  await page.screenshot({ path: 'artifacts/realtime-oath-hud.png' });

  // Through the door without a chain of 6: the door breaks it and records ×0.5.
  await winArena(page);
  const broken = await snapshot(page);
  expect(broken.oath?.broken).toEqual(expect.any(Number));
  expect(broken.purse.door?.oath).toBe(0.5);
  // П11 (LDW guard): the door does not turn a broken oath into a win — the line dims with «×0,5», no ✓.
  await expect(page.getByTestId('oath-line')).toHaveText('Клятва: цепь 6+ ×0,5');
  await expect(page.getByTestId('oath-line')).toHaveClass(/rt-oath-broken/);
  await page.screenshot({ path: 'artifacts/realtime-oath-broken.png' });
  expect(errors).toEqual([]);
});

test('the sandbox: the panel\'s oath choice puts the fight under it (journalled) and shows the line', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  await expect(page.getByTestId('oath-line')).toBeHidden();
  await page.getByTestId('open-panel').click();
  await page.getByTestId('oath-choice').selectOption('damage2');
  await expect(page.getByTestId('oath-line')).toHaveText('Клятва: не больше 2 урона ✓');
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as { commands: { cmd: { t: string; id?: string; key?: string } }[] };
  expect(journal.commands.some(c => c.cmd.t === 'param' && c.cmd.key === 'oathStake')).toBe(true);
  expect(journal.commands.some(c => c.cmd.t === 'oath' && c.cmd.id === 'damage2')).toBe(true);
  // R restarts the arena: the panel's oath goes into the next arena too.
  await page.getByTestId('oath-choice').blur();
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('oath-line')).toHaveText('Клятва: не больше 2 урона ✓');
  // «Цепь 6+ хотя бы раз» (12.10.2026) is in the panel's list too: it waits, no ✓.
  await page.getByTestId('oath-choice').selectOption('chain6');
  await expect(page.getByTestId('oath-line')).toHaveText('Клятва: цепь 6+');
  await page.getByTestId('oath-choice').selectOption('');
  await expect(page.getByTestId('oath-line')).toBeHidden();
  expect(errors).toEqual([]);
});
