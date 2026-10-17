import { expect, type Page } from '@playwright/test';

/**
 * The way on from a won run fight's result card (task 50). From run row 2 the card holds «Сноровка» — two cards and «Пропустить» —
 * in place of «К карте»; a route that only wants to go on passes it with «Пропустить» (nothing taken). Where the card has «К карте»
 * (row 1, a fight with a die or a feat, the final, a defeat) the button is clicked as before. Not a spec file: the realtime config's
 * `testMatch` does not pick it up.
 */
export async function leaveResult(page: Page): Promise<void> {
  const map = page.getByTestId('result-map'), skip = page.getByTestId('knack-skip');
  // Both buttons are in the card (one hidden): wait until one is shown.
  await expect.poll(async () => (await skip.isVisible()) || (await map.isVisible())).toBe(true);
  if (await skip.isVisible()) await skip.click(); else await map.click();
}
