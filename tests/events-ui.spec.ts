import { test, expect, type Page } from '@playwright/test';
import { availableNodes, chooseEventOption, chooseFindItem, chooseTalisman, createForestRun, enterNode, eventView, resolveBattle, restHeal, serializeForestRun, shopLeave,
  type ForestRunState, type ForestRunStep } from '../src/game/run/forestRun';
import { BATTLE_MODIFIERS } from '../src/game/talismans';

// Event window and modifier icon (docs/events.md, section 6; docs/desktop-ux.md). The model is tested in
// src/game/eventCatalogue.spec.ts; here the real page is driven by mouse at 1280×720: outcomes with chances, an option
// that cannot be taken with its reason, an escalation (counter, chances, leaving), a reward battle option, and the
// icon of the next battle's modifier on the map and in the battle HUD with its effect line on hover.
test.use({ viewport: { width: 1280, height: 720 } });

const RUN_KEY = 'ashen-oath-forest-run-v1';
const spread = (k: number) => Math.imul(k, 2654435761) >>> 0;
const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const savedRun = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), RUN_KEY);
function ok(step: ForestRunStep): ForestRunState { if (!step.ok) throw new Error(step.reason); return step.run; }

/** Settle whatever is open that is not the target: battles won, finds taken, talismans refused, rests healed, merchants left, events passed. */
function settle(run: ForestRunState): ForestRunState {
  const pending = run.pending!;
  if (pending.kind === 'battle') { const entry = pending.entry; return ok(resolveBattle(run, { nodeId: pending.nodeId, won: true, player: { ...entry.player }, inventory: { ...entry.inventory } })); }
  if (pending.kind === 'find') return ok(chooseFindItem(run, pending.options[0]));
  if (pending.kind === 'talisman') return ok(chooseTalisman(run, null));
  if (pending.kind === 'rest') return ok(restHeal(run));
  if (pending.kind === 'shop') return ok(shopLeave(run));
  if (pending.kind === 'event') return ok(chooseEventOption(run, eventView(run)!.options.find(option => option.available && option.safe)!.id));
  throw new Error(`unexpected ${pending.kind}`);
}
/** A generated run (all events open) standing at the event node holding `eventId`, the event open. */
function reach(eventId: string, accept: (run: ForestRunState) => boolean = () => true): ForestRunState {
  for (let k = 1; k < 600; k++) {
    const seed = spread(k);
    let run = createForestRun(seed, { map: 'generated', skipTrunk: true, unlocks: 5 }), choice = seed;
    for (let guard = 0; guard < 80 && !run.result; guard++) {
      if (run.pending) { run = settle(run); continue; }
      const next = availableNodes(run), target = next.find(entry => entry.content.kind === 'event' && entry.content.eventId === eventId);
      if (target) { const entered = ok(enterNode(run, target.id)); if (accept(entered)) return entered; break; }
      choice = spread(choice + 1);
      const others = next.filter(entry => entry.type !== 'event'), list = others.length ? others : next;
      run = ok(enterNode(run, list[choice % list.length].id));
    }
  }
  throw new Error(`no run reaches ${eventId}`);
}
/** Open the page on a saved run with the event pending (once per tab: a reload keeps whatever the page saved). */
async function open(page: Page, run: ForestRunState) {
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } }, [RUN_KEY, serializeForestRun(run)]);
  await page.goto('/');
  await page.locator('#run-start-button').click();
  await expect(page.locator('#modal .event-choice').first()).toBeVisible();
}
/** The window and the page fit the 1280×720 screen: no scroll, the modal inside the viewport. */
const fits = (page: Page) => page.evaluate(() => {
  const box = document.querySelector('#modal')!.getBoundingClientRect(), modal = document.querySelector<HTMLElement>('#modal')!;
  return { inside: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth, noScroll: (() => { const layer = document.querySelector<HTMLElement>('#modal-layer')!, open = document.documentElement.scrollHeight; layer.hidden = true; const closed = document.documentElement.scrollHeight; layer.hidden = false; return open <= closed + 1; })(), inner: modal.scrollHeight <= modal.clientHeight + 1 };
});
async function expectFits(page: Page) { expect(await fits(page)).toEqual({ inside: true, noScroll: true, inner: true }); }
const failOnDialog = (page: Page) => page.on('dialog', dialog => { throw new Error(`window.${dialog.type()} is not allowed: ${dialog.message()}`); });

test('an event window shows chances of a random option and why an option cannot be taken; the keyboard starts on the first available button', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  // The cub: bandaging needs a herb or a «Лечение» the fresh cat has not (the first option is closed); the cache rolls 50/50.
  await open(page, reach('wounded-cub'));
  const choices = page.locator('#modal .event-choice');
  await expect(page.locator('#modal-title')).toHaveText('Раненый волчонок');
  await expect(choices.nth(0)).toBeDisabled();
  await expect(choices.nth(0).locator('.event-reason')).toContainText('Нужно:');
  await expect(choices.nth(0).locator('.event-tag.cost')).toContainText('Цена:');
  await expect(choices.nth(1)).toBeEnabled();
  await expect(choices.nth(1).locator('.event-outcome')).toContainText('в следующем бою');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-event-option'))).toBe('skin');
  await expectFits(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/events-ui-unavailable.png' });
  await page.reload();
  await page.locator('#run-start-button').click();
  await expect(page.locator('#modal-title')).toHaveText('Раненый волчонок');
  await expect(page.locator('#modal .event-choice').nth(0)).toBeDisabled();

  const cache = await page.context().newPage(); failOnDialog(cache);
  await cache.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [RUN_KEY, serializeForestRun(reach('goblin-cache'))]);
  await cache.goto('/'); await cache.locator('#run-start-button').click();
  const rows = cache.locator('#modal .event-choice').nth(0).locator('.event-outcome');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('i')).toHaveText('50%');
  await expect(rows.nth(1).locator('i')).toHaveText('50%');
  await expect(cache.locator('#modal .event-choice').nth(0)).toContainText('добыча');
  await expect(cache.locator('#modal .event-choice').nth(0)).toContainText('ловушка');
  await expectFits(cache);
  await cache.screenshot({ path: 'artifacts/events-ui-chances.png' });
  await cache.close();
  expect(errors).toEqual([]);
});

test('an escalation shows its attempt counter and the current chance, keeps what was found and can be left at any time', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await open(page, reach('porcupine-nest'));
  const search = () => page.locator('#modal [data-event-option="search"]');
  const chance = (n: number) => search().locator('.event-outcome i').nth(n);
  await expect(page.locator('#modal-title')).toHaveText('Гнездо дикобразов');
  await expect(search().locator('.event-tag.attempt')).toHaveText('Попытка 1 из 3');
  await expect(chance(0)).toHaveText('75%'); await expect(chance(1)).toHaveText('25%');
  await expect(page.locator('#event-attempts')).toHaveCount(0);
  await expectFits(page);
  await search().click();
  // The event stays open: the counter and the chances moved, the first attempt is listed.
  await expect(search().locator('.event-tag.attempt')).toHaveText('Попытка 2 из 3');
  await expect(chance(0)).toHaveText('50%'); await expect(chance(1)).toHaveText('50%');
  await expect(page.locator('#event-attempts li')).toHaveCount(1);
  expect((await savedRun(page)).pending).toMatchObject({ kind: 'event' });
  await search().click();
  await expect(search().locator('.event-tag.attempt')).toHaveText('Попытка 3 из 3');
  await expect(chance(0)).toHaveText('25%'); await expect(chance(1)).toHaveText('75%');
  await expect(page.locator('#event-attempts li')).toHaveCount(2);
  await expectFits(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/events-ui-escalation.png' });
  await search().click();
  // No attempts left: the option is closed with its reason, leaving is still open.
  await expect(search()).toBeDisabled();
  await expect(search().locator('.event-reason')).toContainText('Попыток больше нет (3 из 3)');
  await expect(page.locator('#event-attempts li')).toHaveCount(3);
  await expectFits(page);
  await page.locator('#modal [data-event-option="leave"]').click();
  await expect(page.locator('#event-result')).toContainText('Уйти');
  await expect(page.locator('#event-result-attempts li')).toHaveCount(3);
  await expectFits(page);
  const done = await savedRun(page);
  expect(done.pending).toBeNull();
  expect(done.eventChoices[0]).toMatchObject({ option: 'leave', attempts: expect.any(Array) });
  expect(done.eventChoices[0].attempts).toHaveLength(3);
  expect(done.resources.player.hp).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('an escalation can be left after one attempt', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  await open(page, reach('porcupine-nest'));
  await page.locator('#modal [data-event-option="search"]').click();
  await expect(page.locator('#event-attempts li')).toHaveCount(1);
  await page.locator('#modal [data-event-option="leave"]').click();
  await expect(page.locator('#event-result-attempts li')).toHaveCount(1);
  await page.locator('#modal [data-action="run-map"]').click();
  expect((await savedRun(page)).pending).toBeNull();
  expect(errors).toEqual([]);
});

test('the reward battle option is marked, says what a victory gives; a modifier of the next battle shows as an icon on the map and in the battle', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); failOnDialog(page);
  // A battle must be among the nodes after the event (the modifier waits for it).
  const battleNext = (run: ForestRunState) => availableNodes(ok(chooseEventOption(run, 'bushes'))).some(entry => ['battle', 'hard', 'checkpoint'].includes(entry.type));
  await open(page, reach('ford-ambush', battleNext));
  const fight = page.locator('#modal [data-event-option="fight"]');
  await expect(fight.locator('.event-tag.battle')).toHaveText('Бой');
  await expect(fight).toContainText('победа — обычный талисман на выбор из 2');
  await expect(fight).toContainText('поражение заканчивает поход');
  await expect(page.locator('#modal [data-event-option="around"] .event-tag.cost')).toContainText('энергия');
  await expectFits(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/events-ui-ford.png' });
  // The bushes: no cost, the next battle's wrath.
  await expect(page.locator('#map-hp [data-modifier-badge]')).toHaveCount(0);
  await page.locator('#modal [data-event-option="bushes"]').click();
  await expect(page.locator('#event-result')).toContainText('Обойти по кустам');
  await page.locator('#modal [data-action="run-map"]').click();
  const mapBadge = page.locator('#map-hp [data-modifier-badge="wrath"]');
  await expect(mapBadge).toBeVisible();
  expect((await savedRun(page)).modifiers).toEqual([{ modifier: 'wrath', battles: 1 }]);
  await mapBadge.hover();
  await expect(mapBadge.locator('.talisman-tip')).toBeVisible();
  await expect(mapBadge.locator('.talisman-tip')).toContainText(BATTLE_MODIFIERS.wrath);
  await expect(mapBadge.locator('.talisman-tip')).toContainText('Следующий бой');
  expect(await page.evaluate(() => { const tip = document.querySelector('#map-hp [data-modifier-badge] .talisman-tip')!.getBoundingClientRect(); return tip.bottom <= innerHeight && tip.right <= innerWidth && tip.left >= 0; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/events-ui-modifier-map.png' });
  // The next battle takes it: the icon moves to the HUD, the map no longer waits for it.
  const target = page.locator('.map-node[data-status="available"].type-battle, .map-node[data-status="available"].type-hard, .map-node[data-status="available"].type-checkpoint').first();
  await expect(target).toBeVisible();
  await target.click();
  await expect(page.locator('#board-host canvas')).toBeVisible();
  const hudBadge = page.locator('#talisman-row [data-modifier-badge="wrath"]');
  await expect(hudBadge).toBeVisible();
  await hudBadge.hover();
  await expect(hudBadge.locator('.talisman-tip')).toContainText(BATTLE_MODIFIERS.wrath);
  await expect(hudBadge.locator('.talisman-tip')).toContainText('Этот бой');
  expect(await state(page)).toMatchObject({ runNode: { modifiers: ['wrath'] } });
  expect(await savedRun(page)).not.toHaveProperty('modifiers');
  await page.screenshot({ path: 'artifacts/events-ui-modifier-battle.png' });
  await page.evaluate(() => (window as any).__PUZZLE_GAME.winLevel());
  await page.locator('#modal [data-action="run-map"]').click();
  await expect(page.locator('#map-hp [data-modifier-badge]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
