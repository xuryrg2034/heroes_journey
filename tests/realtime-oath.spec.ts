import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * Casino stage 1, item 2 — «Ставка клятвы» (src/realtime/sim/oath.ts, src/realtime/run/rtRun.ts, docs/realtime-casino.md).
 * Task 5 (12.10.2026, «Срез казино-слоя в походе»): the run offers no oaths — the cards of row 1 and row 2 battles say «В бой» (task 8c; «Идти» before)
 * (a reload too), no stake line, no oath line in the battle. Seed 10 (a seeded run gets the full gift): the gift button 1
 * takes no second pick; `r5c0` is a battle of run row 1, `r6c1` a battle of run row 2 whose card offered «Не больше 2 урона»
 * and «Цепь 6+ хотя бы раз» before task 5. The run's oath card with its choices has no end-to-end test since task 5 (the run
 * layer's code is checked in Node with the stake on: src/realtime/sim/oath.spec.ts).
 *
 * The sandbox: the panel's oath choice puts the fight under it (journalled) and shows the line; an unmet «Цепь 6+» breaks at
 * the door — the line dims with «×0,5», no ✓ (П11: a broken oath is no win).
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

test('task 5: the run offers no «Зарок» — row 1 and row 2 cards say «В бой» (a reload too), no stake line; the battle has no oath line', async ({ page }) => {
  const errors: string[] = [];
  await openRun(page, errors);
  await page.evaluate(seed => (window as any).__realtime.run.newRun(seed), SEED);
  await page.getByTestId('gift-1').click();
  await page.getByTestId('node-r5c0').click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await expect(page.getByTestId('run-enter')).toHaveText('В бой');
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  await winArena(page);
  await leaveResult(page);
  await expect(page.getByTestId('run')).toBeVisible();

  // Run row 2: the card offered two oaths before task 5; now «В бой» only (task 8c; «Идти» before).
  await page.getByTestId('node-r6c1').click();
  await expect(page.getByTestId('run-detail')).toBeVisible();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await expect(page.getByTestId('run-stake-line')).toHaveCount(0);
  await expect(page.locator('[data-action="enter-oath"]')).toHaveCount(0);
  await expect(page.getByTestId('run-detail')).not.toContainText('Зарок');
  await expect(page.getByTestId('run-enter')).toHaveText('В бой');
  await page.screenshot({ path: 'artifacts/realtime-oath-card.png' });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await page.getByTestId('node-r6c1').click();
  await expect(page.getByTestId('run-oaths')).toHaveCount(0);
  await page.getByTestId('run-enter').click();
  await expect(page.getByTestId('run')).toBeHidden();
  const state = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(state.pending.oathOffer).toBeUndefined();
  expect(state.pending.oath).toBeUndefined();
  // The run's oath counter still moves one per oath node (the save's check), though nothing was offered.
  expect(state.oathDraws).toBe(1);
  await expect(page.getByTestId('oath-line')).toBeHidden();
  expect((await snapshot(page)).oath).toBeNull();
  expect(errors).toEqual([]);
});

test('the sandbox (П11): an unmet «Цепь 6+» breaks at the door — the line dims with «×0,5», no ✓', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?sandbox=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime)).toBe(true);
  await page.keyboard.press('1');
  await expect(page.getByTestId('menu')).toBeHidden();
  await page.getByTestId('open-panel').click();
  await page.getByTestId('oath-choice').selectOption('chain6');
  await expect(page.getByTestId('oath-line')).toHaveText('Зарок: цепь 6+');
  await expect(page.getByTestId('oath-line')).not.toHaveClass(/rt-oath-broken/);
  await page.getByTestId('oath-choice').blur();
  // Through the door without a chain of 6 (the goals done, the hero put on the door by journalled commands).
  await page.evaluate(async () => {
    const rt = (window as any).__realtime;
    rt.clear(false);
    rt.completeGoals();
    const door = rt.snapshot().objects.find((o: { kind: string }) => o.kind === 'door');
    rt.teleport(door.x + (door.x > 8 ? -2 : 2), door.y);
    for (let i = 0; i < 10; i++) await new Promise(r => requestAnimationFrame(r));
    rt.teleport(door.x, door.y);
  });
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 10_000 }).toBe('victory');
  expect((await snapshot(page)).oath?.broken).toEqual(expect.any(Number));
  await expect(page.getByTestId('oath-line')).toHaveText('Зарок: цепь 6+ ×0,5');
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
  await expect(page.getByTestId('oath-line')).toHaveText('Зарок: не больше 2 урона ✓');
  const journal = await page.evaluate(() => (window as any).__realtime.journal()) as { commands: { cmd: { t: string; id?: string; key?: string } }[] };
  expect(journal.commands.some(c => c.cmd.t === 'param' && c.cmd.key === 'oathStake')).toBe(true);
  expect(journal.commands.some(c => c.cmd.t === 'oath' && c.cmd.id === 'damage2')).toBe(true);
  // R restarts the arena: the panel's oath goes into the next arena too.
  await page.getByTestId('oath-choice').blur();
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('oath-line')).toHaveText('Зарок: не больше 2 урона ✓');
  // «Цепь 6+ хотя бы раз» (12.10.2026) is in the panel's list too: it waits, no ✓.
  await page.getByTestId('oath-choice').selectOption('chain6');
  await expect(page.getByTestId('oath-line')).toHaveText('Зарок: цепь 6+');
  await page.getByTestId('oath-choice').selectOption('');
  await expect(page.getByTestId('oath-line')).toBeHidden();
  expect(errors).toEqual([]);
});
