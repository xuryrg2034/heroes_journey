import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { serializeRtRun, rtLevel, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';
import { rtRunDepth } from '../src/realtime/run/rtMeta';

/**
 * Task 55в «Замок в походе», the view (spec docs/design-notes/task-55-castle-step1a.md, 4 and 16; docs/realtime-slice.md, «Замок в походе»):
 * a run with the castle's flag (created in Node with `castle: true` — `RT_CASTLE_ON` is off until design turns it on) walked by its own
 * commands (metaWalk.testkit.ts) and loaded into the page. Real clicks at 1280×720: the Castellan's relic taken — «Подножие» fills the HP bar,
 * «В замок» opens the castle's map (the header «Замок», «Бальный зал» on row 5, «Колдун» on row 10, the castle's class), a node's card names
 * a castle arena; a run won at the Warlock ends with «Замок» and «Замок, ряд 10 · Колдун пройден». Screenshots go to $SHOT_DIR when it is set.
 */
const shot = async (page: Page, name: string): Promise<void> => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/castle-${name}.png` }); };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

/** The page with `state` as the saved run (the prologue passed). */
async function loadRun(page: Page, state: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem(key, value); }, [RT_RUN_STORAGE_KEY, serializeRtRun(state)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

test('task 55в view: the Castellan\'s relic taken — «Подножие» fills the HP bar, «В замок» opens the castle\'s map: «Замок», «Бальный зал», «Колдун»; a node\'s card names a castle arena (screenshots)', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  // A run with the castle walked in Node to the relic screen after the Castellan (the garrison's level, the source `level`).
  let relic: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', seeded: true, garrison: true, castle: true }, each: state => { if (!relic && rtLevel(state) === 2 && state.pending?.kind === 'talisman' && state.pending.source === 'level') relic = structuredClone(state); } });
  expect(relic, 'the walk reached the Castellan\'s relic').not.toBeNull();
  // A hurt hero (the walk wins unhurt): «Подножие» has something to heal.
  await loadRun(page, { ...relic!, hp: 4 });
  await expect(page.getByTestId('run-title')).toHaveText('Гарнизон');
  await page.locator('[data-testid="run-talisman"] button[data-action="talisman"][data-option]:not([data-option=""])').first().click();
  await expect(page.getByTestId('run-foothill')).toBeVisible();
  const state = await page.evaluate(() => (window as any).__realtime.run.state()) as RtRunState;
  expect(state.pending?.kind).toBe('foothill');
  expect(state.hp).toBe(state.maxHp);
  await expect(page.getByTestId('foothill-hp')).toHaveText(`HP ${state.maxHp} / ${state.maxHp}`);
  await expect(page.locator('[data-testid="foothill-bar"] i')).toHaveAttribute('style', /width: ?100(\.0)?%/, { timeout: 3_000 });
  await page.waitForTimeout(1200);
  await shot(page, 'foothill');
  await page.getByTestId('run-castle').click();
  await expect(page.getByTestId('run-foothill')).toBeHidden();
  await expect(page.getByTestId('run-title')).toHaveText('Замок');
  await expect(page.getByTestId('run-title')).toHaveAttribute('data-level', '3');
  await expect(page.getByTestId('run-map')).toHaveAttribute('data-level', '3');
  await expect(page.getByTestId('run-map')).toHaveClass(/rt-map-castle/);
  await expect(page.getByTestId('map-cap-checkpoint')).toHaveText('Бальный зал');
  await expect(page.getByTestId('map-cap-boss').first()).toHaveText('Колдун');
  await shot(page, 'map');
  // A node of the first row: its card names a castle arena (not the arena's id).
  await page.locator('[data-status="available"]').first().click();
  await expect(page.locator('.rt-run-arena b')).toContainText(/Арена «(Прихожая|Анфилада|Бальный зал)»/);
  await shot(page, 'card');
  expect(errors).toEqual([]);
});

test('task 55в view: a run won at the Warlock — the end says «Поход пройден», the level word «Замок» and «Замок, ряд 10 · Колдун пройден»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const walk = walkRun({ k: 3, create: { gift: 'full', seeded: true, garrison: true, castle: true } });
  const end = walk.run;
  expect(end.result?.outcome, 'the walk won the run').toBe('victory');
  expect(rtLevel(end), 'it ended in the castle').toBe(3);
  await loadRun(page, end);
  await expect(page.getByTestId('run-end-level')).toHaveText('Замок');
  await expect(page.getByTestId('run-end-facts')).toContainText('Замок, ряд 10 · Колдун пройден');
  await shot(page, 'end');
  expect(errors).toEqual([]);
});

test('task 55в view: the depth record names the castle — a meta run walked to the castle\'s row 2+ and abandoned shows «Замок, ряд N — новый рекорд» over «прежний: гарнизон пройден»; the camp says «Рекорд: Замок, ряд N»', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/');
  // The profile of a viewer who passed the garrison before (record: the garrison won) and has the camp.
  const meta = { heroes: { cat: { xp: 400, packs: [], record: { row: 10, won: true, xp: 400, level: 2, wonLevel: 2 } } }, hearth: { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: { herb: false, smith: false }, lines: { 'owl:first': 2 }, quiet: 0 } };
  await page.evaluate(m => { localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1'); localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 5, won: true, meta: m })); }, meta);
  // A meta run (no given seed) with the castle walked in Node by its own commands: on the castle's map past its row 2.
  let open: RtRunState | null = null;
  walkRun({ k: 3, create: { gift: 'full', garrison: true, castle: true }, each: state => { if (!open && !state.result && !state.pending && rtLevel(state) === 3 && rtRunDepth(state) >= 2) open = structuredClone(state); } });
  expect(open, 'the walk reached the castle\'s row 2').not.toBeNull();
  const row = rtRunDepth(open!);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [RT_RUN_STORAGE_KEY, serializeRtRun(open!)] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
  await expect(page.getByTestId('run-title')).toHaveText('Замок');
  await page.getByTestId('run-reset').click();
  await page.getByTestId('run-reset-confirm').click();
  await expect(page.getByTestId('run-result-abandoned')).toBeVisible();
  const record = page.getByTestId('meta-record');
  await expect(record).toHaveAttribute('data-beaten', 'true');
  await expect(record).toContainText(`Замок, ряд ${row} — новый рекорд`);
  await expect(record).toContainText('прежний: гарнизон пройден');
  await page.waitForTimeout(1200);
  await shot(page, 'record');
  await page.getByTestId('run-to-hearth').click();
  await expect(page.getByTestId('hearth-record')).toHaveText(`Рекорд: Замок, ряд ${row}`);
  expect(errors).toEqual([]);
});
