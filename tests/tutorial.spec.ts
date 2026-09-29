import { test, expect, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => structuredClone((window as any).__PUZZLE_GAME.state));
const center = async (page: Page, index: number) => {
  await page.locator('#board-host').scrollIntoViewIfNeeded();
  return page.evaluate(i => (window as any).__PUZZLE_GAME.gridToScreen(i), index);
};
async function settled(page: Page) {
  await expect.poll(async () => (await state(page)).phase, { timeout: 15_000 }).not.toMatch(/TITLE|RESOLVE|UPDATE/);
  // Engine input can be ready before the first asynchronous texture load mounts the canvas.
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
async function draw(page: Page, path: number[], beforeRelease?: () => Promise<void>) {
  const first = await center(page, path[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const index of path.slice(1)) {
    const point = await center(page, index);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await expect.poll(async () => (await state(page)).chain).toEqual(path);
  if ((await state(page)).tutorial.index < 7) await expect(page.locator('#chain-reward')).not.toContainText('Энергия');
  if (beforeRelease) await beforeRelease();
  await page.mouse.up(); await settled(page);
}

// These routes are authored checks of the actual pointer path through each
// mixed-color opening, rather than direct calls to the engine's release API.
test('three tutorial battles progress by mouse, retain marked targets, and retry exactly', async ({ page }) => {
  test.setTimeout(75_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.tutorial-select [data-tutorial]')).toHaveCount(16);
  await expect(page.locator('#title-screen [data-scenario]')).toHaveCount(7);
  await page.screenshot({ path: 'artifacts/tutorial-title-desktop.png', fullPage: true });
  await page.locator('#tutorial-begin-button').click(); await settled(page);
  let entry = await state(page);
  expect(entry.tutorial.index).toBe(0); expect(entry.player.hp).toBe(5);
  expect(new Set(entry.board.filter(Boolean).map((cell: any) => cell.color))).toEqual(new Set([0, 2]));
  await page.screenshot({ path: 'artifacts/tutorial-lesson1-desktop.png', fullPage: true });
  await expect(page.locator('#chapter-number')).toContainText('ОБУЧЕНИЕ · БОЙ 1 / 16');
  await expect(page.locator('.tutorial-room .energy-hud')).toBeHidden();
  await expect(page.locator('.tutorial-room .ability-toolbar')).toBeHidden();
  await expect(page.locator('#frost-button')).toBeHidden();
  await expect(page.locator('#return-editor')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.engine.setAbility('jump'))).toBe(false);
  expect(await page.evaluate(() => (window as any).__PUZZLE_GAME.engine.useItem('healing'))).toBe(false);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  expect((await state(page)).board).toEqual(entry.board);
  await draw(page, [16, 17, 12]);
  expect((await state(page)).objective.kills).toBe(3);
  await draw(page, [13, 9]);
  await draw(page, [3, 4]);
  expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toBeVisible();
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  entry = await state(page);
  expect(entry.tutorial.index).toBe(1); expect(entry.tutorial.targetIds).toHaveLength(2);
  await expect(page.locator('#objectives')).toContainText('0 / 2');
  await draw(page, [16, 17, 12]);
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  await expect(page.locator('#objectives')).toContainText('1 / 2');
  await draw(page, [18, 19, 14, 9]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  entry = await state(page);
  expect(entry.tutorial.index).toBe(2); expect(entry.tutorial.targetIds).toHaveLength(2);
  await page.screenshot({ path: 'artifacts/tutorial-lesson3-desktop.png', fullPage: true });
  const armed = entry.board.filter((cell: any) => cell?.behavior.aggressive);
  expect(armed).toHaveLength(2);
  await draw(page, [19, 20]);
  await draw(page, [13, 14, 15]);
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  await draw(page, [16, 17, 10]);
  expect((await state(page)).phase).toBe('WIN');
  await expect(page.locator('#modal [data-action="next-tutorial"]')).toBeVisible();
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(3);
  expect((await state(page)).devices[0].kind).toBe('arrows');
  expect(errors).toEqual([]);
});

test('first lesson accepts a touch chain on mobile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/tutorial-title-mobile.png', fullPage: true });
  await page.locator('#tutorial-begin-button').tap(); await settled(page);
  await page.screenshot({ path: 'artifacts/tutorial-lesson1-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const points = await Promise.all([16, 17, 12].map(index => center(page, index)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  await expect.poll(async () => (await state(page)).chain).toEqual([16, 17, 12]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settled(page);
  expect((await state(page)).objective.kills).toBe(3);
  await page.locator('.brand[data-action="title"]').tap();
  await page.locator('[data-tutorial="2"]').tap(); await settled(page);
  await page.screenshot({ path: 'artifacts/tutorial-lesson3-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});


test('forest trail uses arrows, temporary fire and a combined encounter through real mouse chains', async ({ page }) => {
  test.setTimeout(100_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-tutorial="3"]').click(); await settled(page);
  await expect(page.locator('#device-summary')).toContainText('рычаг');
  await page.screenshot({ path: 'artifacts/trail-arrows.png', fullPage: true });
  await draw(page, [19, 20, 21]);
  expect((await state(page)).board[10].hp).toBe(4);
  expect((await state(page)).devices[0].charges).toBe(1);
  await draw(page, [22, 23, 17, 10]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(4);
  await draw(page, [19, 20, 15], async () => {
    await expect(page.locator('#chain-reward')).toContainText('После удара: 1 HP');
    await expect(page.locator('#chain-reward')).toContainText('+1 горение');
    await page.screenshot({ path: 'artifacts/trail-fire-preview.png', fullPage: true });
  });
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  expect((await state(page)).player.attackEffect).toBeUndefined();
  await draw(page, [21, 22]);
  await draw(page, [21, 14, 20, 15, 10]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(5);
  const entry = await state(page);
  await draw(page, [29, 30, 31]);
  await page.locator('[data-action="pause"]').click();
  await page.locator('#modal [data-action="retry"]').click(); await settled(page);
  expect((await state(page)).devices).toEqual(entry.devices);
  expect((await state(page)).board).toEqual(entry.board);
  await draw(page, [29, 30, 31]);
  await draw(page, [32, 33, 25, 19]);
  await page.screenshot({ path: 'artifacts/trail-combined.png', fullPage: true });
  await draw(page, [24, 17, 16, 10]);
  expect((await state(page)).phase).toBe('WIN');
  expect((await state(page)).player.hp).toBe(5);
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(6);
  await expect(page.locator('#frost-button')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile touch crosses a lever and shows its charges and danger line', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{ width:390,height:844 }, isMobile:true,hasTouch:true });
  const page = await context.newPage();
  const errors:string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/'); await page.locator('[data-tutorial="3"]').tap(); await settled(page);
  await expect(page.locator('#device-summary')).toContainText('зарядов 2');
  const points = await Promise.all([19,20,21].map(index=>center(page,index)));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});
  for(const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
  await expect.poll(async()=>(await state(page)).chain).toEqual([19,20,21]);
  await page.screenshot({path:'artifacts/trail-mobile-preview.png',fullPage:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await settled(page);
  expect((await state(page)).devices[0].charges).toBe(1);
  expect((await state(page)).board[10].hp).toBe(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]); await context.close();
});

test('cold and jump encounters unlock only their tools and advance through authored routes', async ({ page }) => {
  test.setTimeout(70_000);
  const errors:string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/'); await page.locator('[data-tutorial="6"]').click(); await settled(page);
  await expect(page.locator('#frost-button')).toBeVisible();
  await expect(page.locator('.energy-hud')).toBeHidden();
  await expect(page.locator('#bomb-button')).toBeHidden();
  await page.locator('#frost-button').click();
  let at=await center(page,16); await page.mouse.click(at.x,at.y);
  expect((await state(page)).inventory.frost).toBe(1);
  at=await center(page,12); await page.mouse.click(at.x,at.y);
  expect((await state(page)).inventory.frost).toBe(0);
  expect((await state(page)).board[12].status.brittle).toBe(true);
  await draw(page,[16,17,12],async()=>{
    expect(await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview().hits.at(-1).damage)).toBe(6);
    await page.screenshot({path:'artifacts/arc-cold.png',fullPage:true});
  });
  await draw(page,[18,19,14,9]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(7);
  await expect(page.locator('.energy-hud')).toBeVisible();
  await expect(page.locator('#jump-ability')).toBeVisible();
  await expect(page.locator('#jump-ability')).toBeDisabled();
  await expect(page.locator('#spin-ability')).toBeHidden();
  await draw(page,[18,12,13,19]);
  expect((await state(page)).player.energy).toBe(2);
  await expect(page.locator('#jump-ability')).toBeEnabled();
  await page.screenshot({path:'artifacts/arc-jump.png',fullPage:true});
  await page.locator('#jump-ability').click(); at=await center(page,22); await page.mouse.click(at.x,at.y); await settled(page);
  expect((await state(page)).phase).toBe('WIN');
  expect((await state(page)).player.energy).toBe(0);
  expect((await state(page)).player.hp).toBe(5);
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(8);
  expect(errors).toEqual([]);
});

test('three colors retain prism power and the archer exchanges before the final encounter ends', async ({ page }) => {
  test.setTimeout(90_000);
  const errors:string[]=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/'); await page.locator('[data-tutorial="8"]').click(); await settled(page);
  const opening=await state(page);
  expect(new Set(opening.board.filter((cell:any)=>cell&&cell.color!==null).map((cell:any)=>cell.color))).toEqual(new Set([0,1,2]));
  await expect(page.locator('#palette-summary')).toBeVisible();
  await draw(page,[19,20,14,13,7,8,15,9,10],async()=>{
    const p=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());
    const bridge=p.hits.find((hit:any)=>hit.index===15);
    expect(bridge.remainingPower).toBe(6);
    expect(p.hits.at(-1).availablePower).toBe(8);
    await page.screenshot({path:'artifacts/arc-prism.png',fullPage:true});
  });
  await draw(page,[11,17,22,28,34]);
  expect((await state(page)).phase).toBe('WIN');
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(9);
  const archerId=(await state(page)).board[10].id;
  await draw(page,[19,20,14]);
  let s=await state(page);
  expect(s.board[10].behavior.restTurns).toBe(1);
  expect(s.rotations.some((rotation:any)=>rotation.from===10&&rotation.to===9)).toBe(true);
  await page.screenshot({path:'artifacts/arc-exchange.png',fullPage:true});
  await draw(page,[13,7,8]);
  s=await state(page); expect(s.board[9].id).toBe(archerId);
  await draw(page,[15,16,10,9]);
  expect((await state(page)).objective.tutorialTargets).toBe(1);
  await draw(page,[4,11,17,23,28,34]);
  expect((await state(page)).phase).toBe('WIN');
  expect((await state(page)).player.hp).toBe(5);
  await page.locator('#modal [data-action="next-tutorial"]').click(); await settled(page);
  expect((await state(page)).tutorial.index).toBe(10);
  expect(errors).toEqual([]);
});

test('mobile jump lesson shows energy and accepts a touch chain then targeted jump', async ({ browser, baseURL }) => {
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(); const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/'); await page.locator('[data-tutorial="7"]').tap(); await settled(page);
  await expect(page.locator('.energy-hud')).toBeVisible();
  await expect(page.locator('#jump-ability')).toBeDisabled();
  const points=await Promise.all([18,12,13,19].map(index=>center(page,index)));
  const boardBefore=await page.locator('#board-host').boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});
  const path=[18,12,13,19];
  await expect.poll(async()=>(await state(page)).chain).toEqual(path.slice(0,1));
  expect(await page.locator('#board-host').boundingBox()).toEqual(boardBefore);
  for(let step=1;step<points.length;step++){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...points[step],id:1}]});
    await expect.poll(async()=>(await state(page)).chain).toEqual(path.slice(0,step+1));
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await settled(page);
  expect((await state(page)).player.energy).toBe(2);
  await page.screenshot({path:'artifacts/arc-jump-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#jump-ability').tap(); const at=await center(page,22); await page.touchscreen.tap(at.x,at.y); await settled(page);
  expect((await state(page)).phase).toBe('WIN');
  expect(errors).toEqual([]); await context.close();
});
