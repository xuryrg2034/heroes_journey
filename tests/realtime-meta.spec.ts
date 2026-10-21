import { type Page } from '@playwright/test';
import { test, expect, skipHabit } from './realtimeTest';
import { leaveResult } from './realtimeResult';

/**
 * Tasks 36–37 «Мета v1» (design 15.10.2026, docs/design-notes/tasks-36-37-meta.md): the run-end screen — the experience, the
 * hero's bar, the pack's cards turning over, the record, «В лагерь: +N»; the camp «Очаг» — the fire, the stock, the NPC, a line, a
 * purchase, «Два пути» and the choice of maps. Real clicks through a real run (no given seed: the meta counts only such runs).
 * The meta is core's profile (`ashen-oath-rt-profile-v1`, field `meta`; run/rtMeta.ts): a test may start from a profile with one.
 */
const PROFILE = 'ashen-oath-rt-profile-v1';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openRun(page: Page, meta?: object): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, m]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); if (m) localStorage.setItem(key as string, JSON.stringify({ version: 1, giftFull: false, runs: 3, meta: m })); }, [PROFILE, meta ?? null] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run')).toBeVisible();
}

async function newRun(page: Page): Promise<void> {
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
}

const BATTLE = ['battle', 'hard', 'checkpoint', 'breakthrough', 'boss'];

/** A screen over the map (a reward, a rest, a find, an event, a shop): its first choice, until the map shows its nodes. */
async function passScreens(page: Page): Promise<'map' | 'battle'> {
  for (let k = 0; k < 8; k++) {
    if (await page.getByTestId('run').isHidden()) return 'battle';
    if (await page.locator('[data-status="available"]').first().isVisible().catch(() => false)) return 'map';
    const choice = page.locator('.rt-run-modal button.rt-run-choice:not([disabled]), .rt-run-modal .rt-again, .rt-run-modal .rt-other:not([disabled])').first();
    if (await choice.isVisible().catch(() => false)) await choice.click();
    else await page.waitForTimeout(300);
  }
  throw new Error('a run screen without a way on');
}

/** Walks the map until a battle starts: battle nodes first; any other node's screen is passed by its first choice. */
async function toBattle(page: Page): Promise<void> {
  for (let step = 0; step < 8; step++) {
    // An event may start a fight (its battle option): the arena is open.
    if (await passScreens(page) === 'battle') return;
    const nodes = page.locator('[data-status="available"]');
    await expect(nodes.first()).toBeVisible();
    const types = await nodes.evaluateAll(els => els.map(e => e.getAttribute('data-type')));
    const pick = types.findIndex(t => BATTLE.includes(t ?? ''));
    await nodes.nth(pick >= 0 ? pick : 0).click();
    await page.getByTestId('run-enter').click();
    if (pick >= 0) {
      // An oath node asks first («Без зарока» is the card's «run-enter» too).
      await expect(page.getByTestId('run')).toBeHidden(); return;
    }
  }
  throw new Error('no battle reached');
}

/** The hero stands in a ring of tough enemies: the fight is lost. */
async function lose(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rt = (window as any).__realtime, hero = rt.snapshot().hero;
    for (let k = 0; k < 8; k++) rt.place(hero.x + Math.cos(k * Math.PI / 4) * 0.6, hero.y + Math.sin(k * Math.PI / 4) * 0.6, k % 4, 2, 'basic');
  });
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'defeat', { timeout: 45_000 });
  await leaveResult(page);
}

/** A run: the first battle won, then death in the next battle. */
async function winThenDie(page: Page): Promise<void> {
  await newRun(page);
  await toBattle(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await leaveResult(page);
  await expect(page.getByTestId('run')).toBeVisible();
  await toBattle(page);
  await lose(page);
  await expect(page.getByTestId('run-result-defeat')).toBeVisible();
}

test('tasks 36–37: the first run ends — the experience counts up, the bar and the record show, the carry flies; «В лагерь» opens the camp with Неясыть and dark places; her line and her upgrade short of stock', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await openRun(page);
  await expect(page.getByTestId('run-hearth')).toHaveCount(0);
  await winThenDie(page);
  const block = page.getByTestId('meta-end');
  await expect(block).toBeVisible();
  await expect(page.getByTestId('meta-xp-gain')).toHaveText('+5 опыта', { timeout: 5_000 });
  await expect(page.getByTestId('meta-part-battles')).toContainText('+5');
  await expect(page.getByTestId('meta-record')).toHaveAttribute('data-beaten', 'true');
  await expect(page.getByTestId('meta-xp-now')).toHaveText('5 / 60');
  await expect(page.getByTestId('meta-pack')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/realtime-meta-end.png' });
  // The camp: Неясыть by the fire, five dark places, the stock carried.
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth')).toBeVisible();
  await expect(page.getByTestId('hearth-npc-owl')).toBeVisible();
  // Марфа or Ерофей come too when the walk took their event's choice («Перевязать», «Заточка»): the places add up to six.
  const npcs = await page.locator('.rt-hearth-npc').count();
  await expect(page.locator('.rt-hearth-empty')).toHaveCount(6 - npcs);
  await page.screenshot({ path: 'artifacts/realtime-hearth-first.png' });
  await page.getByTestId('hearth-npc-owl').click();
  await expect(page.getByTestId('hearth-line')).toHaveText('Ещё один кот с топором. Садись, запишу тебя — пока есть что записывать.');
  const stock = Number(await page.getByTestId('hearth-stock').locator('b').textContent());
  if (stock < 4) await expect(page.getByTestId('up-owl-1')).toHaveText(`нужно 4, есть ${stock}`);
  await expect(page.getByTestId('up-owl-3-lock')).toBeVisible();
  await page.screenshot({ path: 'artifacts/realtime-hearth-bubble.png' });
  // Task 58: the owl's book «Летопись» is free (its first page is the bestiary).
  await page.getByTestId('hearth-chronicle').click();
  await expect(page.getByTestId('chronicle')).toBeVisible();
  await expect(page.getByTestId('chron-page')).toHaveAttribute('data-page', 'bestiary');
  await page.getByTestId('chronicle').getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByTestId('chronicle')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('tasks 36–37: a run that crosses 60 opens «Охотник» — three cards turn over; the camp sells «Два пути» and the next run starts from a choice of 2 maps', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  // The profile as after a few runs: 58 experience, 9 in stock, Марфа and Ерофей came.
  await openRun(page, { heroes: { cat: { xp: 58, packs: [], record: { row: 6, won: false, xp: 40 } } }, hearth: { stock: 9, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: true, smith: true }, lines: { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2 }, quiet: 0 } });
  await expect(page.getByTestId('run-hearth')).toBeVisible();
  await winThenDie(page);
  await expect(page.getByTestId('meta-pack')).toHaveAttribute('data-pack', 'hunter');
  await expect(page.getByTestId('pack-card-0')).toHaveClass(/rt-flipped/, { timeout: 6_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/realtime-meta-pack.png' });
  await expect(page.getByTestId('pack-card-2')).toHaveClass(/rt-flipped/, { timeout: 6_000 });
  await expect(page.getByTestId('pack-card-0')).toContainText('Охотник на элит');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/realtime-meta-pack-done.png' });
  // The camp with three NPC; «Два пути» bought.
  await page.getByTestId('run-to-hearth').click();
  await expect(page.locator('.rt-hearth-npc')).toHaveCount(3);
  // No two names (nor a name and another NPC's figure) overlap (design 15.10.2026).
  const boxes = await page.locator('.rt-hearth-npc').evaluateAll(els => els.map(e => { const n = e.querySelector('.rt-hearth-name')!.getBoundingClientRect(), f = e.querySelector('.rt-hearth-art')!.getBoundingClientRect(); return { n: [n.left, n.top, n.right, n.bottom], f: [f.left, f.top, f.right, f.bottom] }; }));
  const cross = (a: number[], b: number[]): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) if (i !== j) {
    expect(cross(boxes[i].n, boxes[j].n), `names ${i}/${j}`).toBe(false);
    expect(cross(boxes[i].n, boxes[j].f), `name ${i} under figure ${j}`).toBe(false);
  }
  await page.screenshot({ path: 'artifacts/realtime-hearth-three.png' });
  await page.getByTestId('hearth-npc-owl').click();
  // Level 2 only after level 1: grey and disabled while level 1 is not bought.
  await expect(page.getByTestId('up-owl-2')).toBeDisabled();
  await expect(page.getByTestId('up-owl-2')).toHaveAttribute('data-later', 'true');
  await page.getByTestId('up-owl-1').click();
  await expect(page.getByTestId('up-owl-1-bought')).toBeVisible();
  await expect(page.getByTestId('hearth-line')).toHaveText('Два пути. Я видела лес сверху — выбирай, пока я добрая.');
  await page.screenshot({ path: 'artifacts/realtime-hearth-bought.png' });
  await page.getByTestId('hearth-npc-herb').click();
  await expect(page.getByTestId('hearth-bubble')).toHaveAttribute('data-npc', 'herb');
  await page.getByTestId('hearth-go').click();
  await expect(page.getByTestId('hearth-maps')).toBeVisible();
  await expect(page.locator('.rt-hearth-map')).toHaveCount(2);
  await expect(page.locator('.rt-hearth-map').first().locator('.rt-node')).not.toHaveCount(0);
  await expect(page.locator('.rt-hearth-map').first().locator('.rt-mp-counts span')).toHaveCount(6);
  await page.screenshot({ path: 'artifacts/realtime-hearth-maps.png' });
  await page.getByTestId('hearth-map-1').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  // The run from the camp carries core's flags: the 2 maps offered, the quest; the locked list without «Охотник» (opened).
  const run = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(run.hearth?.maps).toBe(2);
  expect(run.locked).toBeDefined();
  expect(run.locked).not.toContain('elite-hunter');
  expect(run.locked).toContain('return-pass');
  // The same start from «Новый поход» on the map (design 16.10.2026): the choice of maps over the run screen, no camp screen.
  await skipHabit(page);
  await page.getByTestId('gift-1').click();
  await expect(page.getByTestId('run-gift')).toBeHidden();
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  // Smoke v62: the abandoned run's end screen first; its «Новый поход» is the one start.
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('hearth-maps')).toBeVisible();
  await expect(page.getByTestId('hearth')).toBeHidden();
  await page.getByTestId('hearth-map-0').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect((await page.evaluate(() => (window as any).__realtime.run.state())).hearth?.maps).toBe(2);
  expect(errors).toEqual([]);
});

test('tasks 36–37 (design smoke v62): an abandoned run is settled before the new one is planned — «Новый поход» → «Да, новый» carries the quest its end picked', async ({ page }) => {
  const errors = collectErrors(page);
  await openRun(page);
  await newRun(page);
  // The first run is abandoned: «Новый поход» in the header, «Да, новый».
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  // Smoke v62 (view): the abandoned run's end screen first; «Новый поход» there is the one start.
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  const quest = await page.evaluate(() => JSON.parse(localStorage.getItem('ashen-oath-rt-profile-v1')!).meta?.hearth?.quest ?? null);
  expect(quest, 'the abandoned run picked a quest').not.toBeNull();
  const run = await page.evaluate(() => (window as any).__realtime.run.state());
  expect(run.hearth?.quest).toEqual(quest);
  expect(errors).toEqual([]);
});

test('smoke v62: «Новый поход» over an open run — «Поход брошен» with its experience and carry, then «Новый поход» starts a run; the record line hides at row 0', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await openRun(page);
  await newRun(page);
  await toBattle(page);
  expect(await page.evaluate(() => (window as any).__realtime.run.winArena())).toBe(true);
  await expect(page.getByTestId('result')).toHaveAttribute('data-outcome', 'victory');
  await leaveResult(page);
  await expect(page.getByTestId('run')).toBeVisible();
  await passScreens(page);
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  await expect(page.getByTestId('run-result-abandoned')).toContainText('Поход брошен');
  await expect(page.getByTestId('meta-xp-gain')).toHaveText('+5 опыта', { timeout: 5_000 });
  await expect(page.getByTestId('meta-carry')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/realtime-meta-abandoned.png' });
  // The abandoned run is out of the save: a reload shows the start, not the old map.
  expect(await page.evaluate(() => (window as any).__realtime.run.state())).toBeNull();
  await page.getByTestId('run-new').click();
  await expect(page.getByTestId('run-gift')).toBeVisible();
  expect(errors).toEqual([]);
});
