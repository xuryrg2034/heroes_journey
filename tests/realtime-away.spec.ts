import { type Page } from '@playwright/test';
import { test, expect } from './realtimeTest';
import { rtMeetView, rtNode, serializeRtRun, type RtRunState } from '../src/realtime/run/rtRun';
import { walkRun } from '../src/realtime/run/metaWalk.testkit';
import { RT_RUN_STORAGE_KEY } from '../src/realtime/run/rtRunStorage';

/**
 * Task 51 «Лагерь, этап 3», step 51д, the view of «Уход по делам» and «Встреча на привале» (docs/design-notes/task-51-camp-l3.md, 3.4, 11.1, 11.2;
 * docs/design-notes/npc-lines-v2.md): the trace on the place of an NPC away (basket, wheel, mug), his goodbye over it, the owl's line of a click;
 * the next run carries the flag; at the first rest of his zone the button of the meeting with his portrait, the deal window with the NPC's
 * lines (Марфа — a consumable for 2 resources, Ерофей — a talisman for 2, Шиш — «Скупка»), «Уйти» without a step; the NPC's line when he is back.
 * Real mouse; the runs are walked in Node to the rest. The rules: core's (run/hearthAway.spec.ts).
 */
const shot = (name: string): string => `${process.env.SHOT_DIR ?? 'artifacts'}/${name}.png`;
const snap = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.state());
const meetShown = (page: Page): Promise<any> => page.evaluate(() => (window as any).__realtime.run.meetShown());

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

const everyone = { herb: true, smith: true, gambler: true };
const LINES = { 'owl:first': 2, 'herb:first': 2, 'smith:first': 2, 'gambler:first': 1 };
const profile = (hearth: object) => ({ heroes: { cat: { xp: 40, packs: [], record: { row: 6, won: false, xp: 40 } } }, hearth: { stock: 9, levels: { owl: 0, herb: 0, smith: 0, gambler: 0 }, met: everyone, lines: LINES, quiet: 0, ...hearth } });

async function open(page: Page, meta: object, run?: RtRunState): Promise<void> {
  await page.goto('/');
  await page.evaluate(([m, key, value]) => {
    localStorage.clear(); localStorage.setItem('ashen-oath-realtime-prologue-done', '1');
    localStorage.setItem('ashen-oath-rt-profile-v1', JSON.stringify({ version: 1, giftFull: false, runs: 3, won: true, meta: m }));
    if (value) localStorage.setItem(key as string, value as string);
  }, [meta, RT_RUN_STORAGE_KEY, run ? serializeRtRun(run) : null] as const);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!(window as any).__realtime?.run)).toBe(true);
}

type Leaver = 'herb' | 'smith' | 'gambler';
const NAME: Record<Leaver, string> = { herb: 'Марфа', smith: 'Ерофей', gambler: 'Шиш' };
const LEAVE: Record<Leaver, string> = {
  herb: 'Ухожу за корнем, по дороге к Троллю. Встретишь на привале — не шуми.',
  smith: 'Пойду, колесо поправлю. Ищи на первых привалах леса.',
  gambler: 'Пойду к столу, отыграться. Ищи меня на привале по дороге к Главарю.',
};
const TRACE: Record<Leaver, string> = {
  herb: 'Марфа ушла за корнем, в сторону Тролля. Записала: вернётся после похода.',
  smith: 'Ерофей ушёл точить в ближний лес. Ищи его на ранних привалах.',
  gambler: 'Шиш ушёл к столу. Кружку оставил, кости тоже, долги — само собой.',
};

test('task 51д view: the trace stands on the place of the NPC away (no figure), his goodbye over it once, the owl\'s line of a click; the next run carries the flag', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  for (const npc of ['herb', 'smith', 'gambler'] as Leaver[]) {
    await open(page, profile({ away: { npc }, done: { [npc]: 1 } }));
    await page.getByTestId('run-hearth').click();
    await expect(page.getByTestId('hearth')).toBeVisible();
    await expect(page.getByTestId(`hearth-trace-${npc}`)).toBeVisible();
    await expect(page.getByTestId(`hearth-npc-${npc}`)).toHaveCount(0);
    await expect(page.getByTestId('hearth-trace-line')).toHaveText(LEAVE[npc]);
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(`away-trace-${npc}`) });
    await page.getByTestId(`hearth-trace-${npc}`).click();
    await expect(page.getByTestId('hearth-trace-line')).toHaveText(TRACE[npc]);
    // The goodbye was said once for this departure: the next visit of the camp is quiet until a click.
    await page.reload();
    await page.getByTestId('run-hearth').click();
    await expect(page.getByTestId(`hearth-trace-${npc}`)).toBeVisible();
    await expect(page.getByTestId('hearth-trace-line')).toHaveCount(0);
    // The run that starts from this camp carries the flag.
    await page.getByTestId('hearth-go').click();
    await expect(page.getByTestId('run-gift')).toBeVisible();
    expect((await snap(page)).hearth.away).toBe(npc);
  }
  expect(errors).toEqual([]);
});

test('task 51д view: back from the road — the NPC says back_met (met on a rest) or back_missed, the trace is gone', async ({ page }) => {
  const last = (npc: Leaver, met: boolean) => ({ won: false, row: 6, beaten: false, away: { npc, met } });
  await open(page, profile({ last: last('herb', true), met2: { herb: 1 } }));
  await page.getByTestId('run-hearth').click();
  await expect(page.locator('[data-testid^="hearth-trace-"]')).toHaveCount(0);
  await page.getByTestId('hearth-npc-herb').click();
  await expect(page.getByTestId('hearth-line')).toHaveText('Встретились на привале — и склянку не разбил. Растёшь.');
  await open(page, profile({ last: last('smith', false) }));
  await page.getByTestId('run-hearth').click();
  await page.getByTestId('hearth-npc-smith').click();
  await expect(page.getByTestId('hearth-line')).toHaveText('Не дождался. Колесо зря крутил.');
});

/** A walk of a run with `npc` away to the first rest of his zone (the walk steered to the rests): the state with the meeting open. */
function meetRun(npc: Leaver): RtRunState | null {
  for (let k = 1; k <= 40; k++) {
    let at: RtRunState | null = null;
    walkRun({ k, create: { gift: 'full', garrison: false, locked: [], hearth: { away: npc } } as never,
      pickNode: (r, ids) => ids.find(id => rtNode(r, id)?.type === 'rest') ?? null,
      each: r => { if (!at && rtMeetView(r)) at = structuredClone(r); } });
    if (at && rtMeetView(at)!.deals.some(d => d.available)) return at;
  }
  return null;
}
const PROFILE = profile({});

const DEAL_LINE: Record<Leaver, RegExp> = { herb: /^Ох, дошёл-таки/, smith: /^Малый\. Садись/, gambler: /^Партнёр! Тише/ };

for (const npc of ['herb', 'smith', 'gambler'] as Leaver[]) {
  test(`task 51д view: the rest of the meeting — the button with ${NAME[npc]}'s portrait and hello line, the deal window, one deal by a click, the rest's own choice stays`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    const at = meetRun(npc);
    expect(at, `a rest with ${NAME[npc]}`).not.toBeNull();
    await open(page, PROFILE, at!);
    await expect(page.getByTestId('meet-open')).toBeVisible();
    await expect(page.getByTestId('meet-open')).toContainText(`${NAME[npc]} ждёт на привале`);
    await expect(page.getByTestId('meet-hello')).toHaveText(DEAL_LINE[npc]);
    await expect(page.getByTestId('rest-heal')).toBeVisible();
    await page.screenshot({ path: shot(`away-rest-${npc}`) });
    expect((await meetShown(page)).npc).toBe(npc);
    // «Уйти» takes nothing: the window closes, the NPC answers, the button stays for a later try.
    await page.getByTestId('meet-open').click();
    await expect(page.getByTestId('run-meet')).toBeVisible();
    await expect(page.getByTestId('meet-line')).not.toHaveText('');
    await page.screenshot({ path: shot(`away-deal-${npc}`) });
    await page.getByTestId('meet-leave').click();
    await expect(page.getByTestId('run-meet')).toHaveCount(0);
    await expect(page.getByTestId('meet-hello')).not.toHaveText(DEAL_LINE[npc]);
    expect((await snap(page)).npcMeet.deal).toBeUndefined();
    // The deal.
    await page.getByTestId('meet-open').click();
    const before = await snap(page), offers = (await meetShown(page)).deals as { id: string; available: boolean }[];
    const deal = offers.find(d => d.available)!;
    await page.getByTestId(`meet-${deal.id}`).click();
    await expect(page.getByTestId('run-meet')).toHaveCount(0);
    await expect(page.getByTestId('meet-open')).toBeDisabled();
    await expect(page.getByTestId('meet-hello')).toHaveText('Сделка сделана');
    const after = await snap(page), total = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
    expect(after.npcMeet.deal).toBe(deal.id);
    const kind = deal.id.split(':')[1];
    if (npc === 'herb') { expect(after.items[kind]).toBe(before.items[kind] + 1); expect(total(after.materials)).toBe(total(before.materials) - 2); }
    if (npc === 'smith') { expect(after.talismans).toContain(kind); expect(total(after.materials)).toBe(total(before.materials) - 2); }
    if (npc === 'gambler') { expect(after.items[kind]).toBe(before.items[kind] - 1); expect(total(after.materials)).toBe(total(before.materials) + 2); }
    // The rest's own choice stays (the heal is still there).
    await expect(page.getByTestId('rest-heal')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('task 51д view: a healing consumable with a full hand is grey with «Рука полна» in Марфа\'s deal and is not bought', async ({ page }) => {
  test.setTimeout(120_000);
  let at: RtRunState | null = null;
  for (let k = 1; k <= 40 && !at; k++) {
    walkRun({ k, create: { gift: 'full', garrison: false, locked: [], potionCap: 1, hearth: { away: 'herb' } } as never,
      pickNode: (r, ids) => ids.find(id => rtNode(r, id)?.type === 'rest') ?? null,
      each: r => { const v = rtMeetView(r); if (!at && v && v.deals.some(d => !d.available && d.item === 'healing') && v.deals.some(d => d.available)) at = structuredClone(r); } });
  }
  expect(at, 'a meeting with a full hand and a healing offer').not.toBeNull();
  await open(page, PROFILE, at!);
  await page.getByTestId('meet-open').click();
  await expect(page.getByTestId('meet-item:healing')).toBeDisabled();
  await expect(page.getByTestId('hand-full-meet-item:healing')).toBeVisible();
  await page.getByTestId('meet-item:healing').click({ force: true });
  expect((await snap(page)).npcMeet.deal).toBeUndefined();
});
