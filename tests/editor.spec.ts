import { test, expect, type Page } from '@playwright/test';

const state=(page:Page)=>page.evaluate(()=>structuredClone((window as any).__PUZZLE_GAME.state));
async function field(page:Page,selector:string,value:string){await page.locator(selector).fill(value);await page.locator(selector).dispatchEvent('change');}
async function ready(page:Page){await expect.poll(async()=>(await state(page)).phase).toBe('PLAYER_INPUT');await expect(page.locator('#board-host canvas')).toBeVisible();}
async function exportDraft(page:Page){await page.locator('[data-editor="export"]').click();return JSON.parse(await page.locator('#editor-json').inputValue());}
async function brush(page:Page,value:string,index:number){await page.locator('#editor-brush').selectOption(value);await page.locator(`[data-cell="${index}"]`).click();}
async function drag(page:Page,path:number[]){await page.locator('#board-host').scrollIntoViewIfNeeded();for(let n=0;n<path.length;n++){const p=await page.evaluate(i=>(window as any).__PUZZLE_GAME.gridToScreen(i),path[n]);await page.mouse.move(p.x,p.y,{steps:n?5:1});if(n===0)await page.mouse.down();}await expect.poll(async()=>(await state(page)).chain).toEqual(path);await page.mouse.up();await expect.poll(async()=>(await state(page)).phase).not.toMatch(/RESOLVE|UPDATE/);}

test('editor paints, undoes, saves, imports safely and plays goals, delayed colors and an exit in the real engine',async({page})=>{
  test.setTimeout(100_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.locator('#editor-button').click();await expect(page.locator('#editor-screen')).toBeVisible();
  await page.locator('#editor-preset').selectOption('rare');await page.locator('[data-editor="preset"]').click();expect((await exportDraft(page)).paletteWeights).toEqual([100,100,20,0,0]);
  await page.locator('#editor-preset').selectOption('late');await page.locator('[data-editor="preset"]').click();expect((await exportDraft(page)).extraColors.map((e:any)=>e.afterGoalTurns)).toEqual([2,4]);
  await field(page,'#editor-cols','4');await field(page,'#editor-rows','4');await field(page,'#editor-name','Бой пяти знамён');await field(page,'#editor-player-hp','10');await field(page,'#editor-goal-target','2');await field(page,'#editor-turn-limit','20');
  for(let i=0;i<5;i++)await field(page,`[data-weight="${i}"]`,i===0?'1':'0');
  await field(page,'[data-extra-delay="3"]','1');await field(page,'[data-extra-weight="3"]','10000');await field(page,'[data-extra-delay="4"]','2');await field(page,'[data-extra-weight="4"]','10000');
  await brush(page,'terrain:tree',1);await expect(page.locator('[data-cell="1"]')).toHaveClass(/terrain-tree/);await page.locator('[data-editor="undo"]').click();await expect(page.locator('[data-cell="1"]')).toHaveClass(/terrain-floor/);await page.locator('[data-editor="redo"]').click();await expect(page.locator('[data-cell="1"]')).toHaveClass(/terrain-tree/);await page.locator('[data-editor="undo"]').click();
  await brush(page,'door',14);await brush(page,'enemy',10);await page.locator('[data-cell="9"]').click();
  // Authored rare colors are intentional even with zero automatic spawn weight.
  await page.locator('#editor-color').selectOption('3');await page.locator('[data-cell="1"]').click();await page.locator('#editor-color').selectOption('4');await page.locator('[data-cell="2"]').click();
  const draft=await exportDraft(page);expect(draft.enemies.find((e:any)=>e.index===1).color).toBe(3);expect(draft.enemies.find((e:any)=>e.index===2).color).toBe(4);expect(draft.heroIndex).toBe(15);
  await page.locator('[data-editor="save"]').click();await expect(page.locator('#editor-notice')).toContainText('Сохранено');await page.screenshot({path:'artifacts/editor-desktop.png',fullPage:true});
  await page.reload();await page.locator('#editor-button').click();expect(await exportDraft(page)).toEqual(draft);
  await page.locator('#editor-json').fill('{"version":1,"enemies":[null]}');await page.locator('[data-editor="import"]').click();await expect(page.locator('#editor-import-error')).toContainText('Черновик сохранён');expect(await exportDraft(page)).toEqual(draft);
  const dangerous={...draft,name:'<img src=x onerror="window.editorUnsafe=1">'};await page.locator('#editor-json').fill(JSON.stringify(dangerous));await page.locator('[data-editor="import"]').click();expect(await page.evaluate(()=>(window as any).editorUnsafe)).toBeUndefined();expect(await page.locator('#editor-name').inputValue()).toBe(dangerous.name);
  const blocked={...draft,name:'Непроходимая охрана',enemies:draft.terrain.flatMap((terrain:string,index:number)=>(terrain==='floor'||terrain==='puddle')&&index!==draft.heroIndex&&!draft.doors.some((door:any)=>door.index===index)?[{index,kind:'melee',color:0,hp:10}]:[])};
  await page.locator('#editor-json').fill(JSON.stringify(blocked));await page.locator('[data-editor="import"]').click();const prior=await state(page);await page.locator('#editor-play').click();await expect(page.locator('#editor-notice')).toContainText('Бой не начат');await expect(page.locator('#editor-notice')).toContainText('цеп');await expect(page.locator('#editor-screen')).toBeVisible();expect(await state(page)).toEqual(prior);expect(await exportDraft(page)).toEqual(blocked);
  await page.locator('#editor-saved').selectOption({label:'Бой пяти знамён'});await page.locator('[data-editor="load"]').click();expect(await exportDraft(page)).toEqual(draft);
  await page.locator('#editor-play').click();await ready(page);let s=await state(page);expect(s.customLevel.definition).toEqual(draft);expect(s.customLevel.paletteWeights).toEqual([1,0,0,0,0]);await expect(page.locator('#level-name')).toHaveText(draft.name);
  const initial=s;await drag(page,[10,9]);await ready(page);s=await state(page);expect(s.objective.kills).toBe(2);expect(s.customLevel.goalCompletedTurn).toBe(1);expect(s.customLevel.paletteWeights[3]).toBe(0);await expect(page.locator('#objectives')).toContainText('Выход открыт');
  await drag(page,[8,4]);await ready(page);s=await state(page);expect(s.customLevel.paletteWeights[3]).toBe(10000);expect(s.customLevel.paletteWeights[4]).toBe(0);expect(s.board.some((c:any)=>c?.color===3&&!initial.board.some((old:any)=>old?.id===c.id))).toBe(true);
  await page.locator('#wait-button').click();await expect(page.locator('#return-editor')).toBeDisabled();await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#return-editor')!.click());await expect(page.locator('#game-screen')).toBeVisible();await ready(page);s=await state(page);expect(s.customLevel.paletteWeights[4]).toBe(10000);await expect(page.locator('#palette-summary')).toContainText('Аметист ✕: в пополнении');
  await drag(page,[5,6]);await ready(page);await page.screenshot({path:'artifacts/editor-five-color-game.png',fullPage:true});
  const beforeExit=await state(page);expect(beforeExit.customLevel.goalCompletedTurn).toBe(1);await drag(page,[3]);await expect.poll(async()=>(await state(page)).phase).toBe('WIN');await expect(page.locator('#modal-title')).toHaveText('Уровень пройден');
  await page.locator('#modal [data-action="editor"]').click();await expect(page.locator('#editor-screen')).toBeVisible();expect(await exportDraft(page)).toEqual(draft);
  await page.locator('#editor-play').click();await ready(page);expect(await state(page)).toEqual(initial);await page.locator('#return-editor').click();expect(await exportDraft(page)).toEqual(draft);expect(errors).toEqual([]);
});

test('editor handles mobile painting, large brushes, multiple goals and corrupted cached drafts',async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.evaluate(()=>localStorage.setItem('ashen-oath-editor-draft-v1',JSON.stringify({version:1,cols:7,rows:7,terrain:Array(49).fill('floor'),enemies:[null],doors:[],goals:[],paletteWeights:[1,0,0,0,0],extraColors:[]})));await page.reload();await page.locator('#editor-button').tap();await expect(page.locator('#editor-notice')).toContainText('не прошёл проверку');
  await field(page,'#editor-cols','4.5');expect(await page.locator('#editor-cols').inputValue()).toBe('4');await field(page,'#editor-cols','7');
  await page.locator('#editor-brush').selectOption('enemy');await page.locator('#editor-enemy-kind').selectOption('troll');await page.locator('[data-cell="22"]').tap();let draft=await exportDraft(page);expect(draft.enemies.find((e:any)=>e.variant==='troll').footprint).toEqual([22,23,29,30]);
  await page.locator('[data-editor="add-goal"]').tap();await expect(page.locator('#editor-errors')).toContainText('не хватает');await page.locator('[data-goal-key="1"]').selectOption('turns');await field(page,'[data-goal-target="1"]','3');await field(page,'#editor-goal-target','4');draft=await exportDraft(page);expect(draft.goals).toHaveLength(2);expect(draft.goals[1]).toEqual({key:'turns',target:3});
  await page.screenshot({path:'artifacts/editor-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const color of [3,4])await page.locator(`[data-extra-enable="${color}"]`).uncheck();for(let color=0;color<5;color++)await field(page,`[data-weight="${color}"]`,'100');
  await page.locator('#editor-play').tap();await ready(page);expect(new Set((await state(page)).board.filter((c:any)=>c&&c.kind!=='door'&&c.color!==null).map((c:any)=>c.color)).size).toBe(5);
  await page.screenshot({path:'artifacts/editor-all-five-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'artifacts/editor-all-five-desktop.png',fullPage:true});expect(errors).toEqual([]);await context.close();
});

test('editor attack effects persist and real turns show poison, cleansing and delayed fire damage', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#editor-button').click();
  const definition = {
    version: 1, name: 'Бой с эффектами', seed: 701, cols: 4, rows: 4,
    terrain: Array(16).fill('floor'), heroIndex: 15,
    enemies: [{ index: 14, kind: 'melee', color: 0, hp: 12, aggressive: true }],
    doors: [], goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [1, 0, 0, 0, 0], extraColors: [], playerHp: 20,
    inventory: { healing: 2, fire: 1 },
  };
  await page.locator('#editor-json').fill(JSON.stringify(definition));
  await page.locator('[data-editor="import"]').click();
  await page.locator('#editor-player-attack-effect').selectOption('bleeding');
  await brush(page, 'inspect', 14);
  await page.locator('#editor-enemy-attack-effect').selectOption('poison');
  await page.locator('[data-cell="14"]').click();
  const draft = await exportDraft(page);
  expect(draft.playerAttackEffect).toBe('bleeding');
  expect(draft.enemies.find((enemy: any) => enemy.index === 14).attackEffect).toBe('poison');
  await page.locator('[data-editor="save"]').click();
  await page.reload();
  await page.locator('#editor-button').click();
  expect(await exportDraft(page)).toEqual(draft);
  await page.locator('#editor-json').fill(JSON.stringify({ ...draft, playerAttackEffect: 'unknown' }));
  await page.locator('[data-editor="import"]').click();
  await expect(page.locator('#editor-import-error')).toContainText('Черновик сохранён');
  expect(await exportDraft(page)).toEqual(draft);
  await page.locator('#editor-play').click();
  await ready(page);
  expect((await state(page)).player.attackEffect).toBe('bleeding');
  expect((await state(page)).board[14].attackEffect).toBe('poison');
  await page.locator('#wait-button').click();
  await ready(page);
  const poisoned = await state(page);
  expect(poisoned.player.hp).toBe(18);
  expect(poisoned.player.damageEffects.poison).toBe(1);
  await expect(page.locator('#damage-effects-summary')).toContainText('Яд');
  await page.screenshot({ path: 'artifacts/damage-effects-desktop.png', fullPage: true });
  // Full-health cleansing is an isolated UI edge: preserve the actual poison from the enemy hit.
  await page.evaluate(() => { const game = (window as any).__PUZZLE_GAME; game.state.player.hp = game.state.player.maxHp; game.cancelChain(); });
  await expect(page.locator('#healing-button')).toBeEnabled();
  await page.locator('#healing-button').click();
  expect((await state(page)).player.hp).toBe(20);
  expect((await state(page)).player.damageEffects?.poison ?? 0).toBe(0);
  await page.locator('#wait-button').click();
  await ready(page);
  const beforeFire = await state(page);
  await page.locator('#fire-button').click();
  const at = await page.evaluate(() => (window as any).__PUZZLE_GAME.gridToScreen(14));
  await page.mouse.click(at.x, at.y);
  const burning = await state(page);
  expect(burning.board[14].hp).toBe(beforeFire.board[14].hp);
  expect(burning.board[14].damageEffects.burning).toBe(1);
  await page.locator('#wait-button').click();
  await ready(page);
  expect((await state(page)).board[14].hp).toBe(beforeFire.board[14].hp - 1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/damage-effects-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('editor authors arrow rays and braziers, persists them and executes a device chain', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#editor-button').click();
  const definition = {
    version: 1, name: 'Рычаг и угли', seed: 701, cols: 4, rows: 4,
    terrain: Array(16).fill('floor'), heroIndex: 13,
    enemies: Array.from({ length: 16 }, (_, index) => index).filter(index => index !== 13)
      .map(index => ({ index, kind: 'melee', color: [12, 6].includes(index) ? 0 : 2, hp: index < 4 ? 6 : 0 })),
    doors: [], goals: [{ key: 'kills', target: 99 }], turnLimit: 0, completion: 'direct',
    paletteWeights: [100, 0, 100, 0, 0], extraColors: [], playerHp: 5,
    inventory: { frost: 0, bomb: 0, healing: 0, fire: 0 },
  };
  await page.locator('#editor-json').fill(JSON.stringify(definition));
  await page.locator('[data-editor="import"]').click();
  await brush(page, 'device:arrows', 9);
  await field(page, '#editor-device-charges', '3');
  await brush(page, 'targets', 9);
  await page.locator('[data-cell="0"]').click();
  await page.locator('[data-cell="3"]').click();
  expect((await exportDraft(page)).devices[0]).toEqual({ index: 9, kind: 'arrows', charges: 3, targets: [0,1,2,3] });
  await brush(page, 'device:fire', 10);
  await field(page, '#editor-device-charges', '1');
  const draft = await exportDraft(page);
  expect(draft.devices).toHaveLength(2);
  await brush(page, 'terrain:wall', 1);
  await expect(page.locator('[data-cell="0"]')).toHaveClass(/device-target/);
  await expect(page.locator('[data-cell="2"]')).not.toHaveClass(/device-target/);
  await page.locator('[data-editor="undo"]').click();
  expect(await exportDraft(page)).toEqual(draft);
  expect(draft.enemies.some((enemy:any) => [9,10].includes(enemy.index))).toBe(false);
  await brush(page, 'terrain:wall', 10);
  expect((await exportDraft(page)).devices).toHaveLength(1);
  await page.locator('[data-editor="undo"]').click();
  expect(await exportDraft(page)).toEqual(draft);
  await page.reload(); await page.locator('#editor-button').click();
  expect(await exportDraft(page)).toEqual(draft);
  await page.setViewportSize({ width:390, height:844 });
  await page.screenshot({ path:'artifacts/editor-devices-mobile.png', fullPage:true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width:1440, height:1000 });
  await page.locator('#editor-play').click(); await ready(page);
  await drag(page, [12,9,6]); await ready(page);
  const played = await state(page);
  expect(played.devices.find((device:any) => device.index === 9).charges).toBe(2);
  expect(played.board[9]).toBeNull();
  for (const index of [0,1,2,3]) expect(played.board[index].hp).toBe(2);
  await page.locator('#return-editor').click();
  expect(await exportDraft(page)).toEqual(draft);
  expect(errors).toEqual([]);
});

test('editor applies typed values when painting right away, keeps keyboard focus and a valid cell detail', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#editor-button').click();
  await page.locator('#editor-brush').selectOption('enemy');
  // pointerdown on a cell suppresses blur/change: the typed value must still reach the brush and the draft.
  await page.locator('#editor-enemy-hp').fill('3'); await page.locator('[data-cell="8"]').click();
  await expect(page.locator('#editor-enemy-hp')).toHaveValue('3');
  await page.locator('#editor-name').fill('Свежее имя'); await page.locator('[data-cell="9"]').click();
  await expect(page.locator('#editor-name')).toHaveValue('Свежее имя');
  await page.locator('#editor-seed').fill('4294967295'); await page.locator('[data-cell="10"]').click();
  await page.locator('#editor-goal-target').fill('5'); await page.locator('[data-cell="11"]').click();
  let draft = await exportDraft(page);
  expect(draft.enemies.find((e: any) => e.index === 8).hp).toBe(3);
  expect(draft.name).toBe('Свежее имя'); expect(draft.seed).toBe(4294967295); expect(draft.goals[0].target).toBe(5);
  // Field limits follow validateCustomLevel.
  await expect(page.locator('#editor-name')).toHaveAttribute('maxlength', '100');
  await expect(page.locator('#editor-seed')).toHaveAttribute('min', '0');
  await expect(page.locator('#editor-seed')).toHaveAttribute('max', '4294967295');
  await field(page, '#editor-seed', '0'); draft = await exportDraft(page); expect(draft.seed).toBe(0);
  await expect(page.locator('#editor-errors')).toBeHidden();
  // Keyboard: painting a cell and committing a field keep focus inside the editor.
  await page.locator('[data-cell="0"]').focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.cell)).toBe('0');
  await page.locator('#editor-name').evaluate((input: HTMLInputElement) => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }); await page.keyboard.type('!'); await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('editor-cols');
  expect((await exportDraft(page)).name).toBe('Свежее имя!');
  // Undo across a resize must not leave a selection outside the smaller field.
  await field(page, '#editor-cols', '12'); await page.locator('[data-cell="80"]').click();
  await page.locator('[data-editor="undo"]').click(); await page.locator('[data-editor="undo"]').click();
  await expect(page.locator('#editor-cols')).toHaveValue('7');
  await expect(page.locator('#editor-cell-detail')).not.toContainText('undefined');
  expect(errors).toEqual([]);
});

test('editor lists every saved level and refuses a new name past the limit instead of losing it', async ({ page }) => {
  await page.goto('/'); await page.locator('#editor-button').click();
  const base = await exportDraft(page);
  const seed = (count: number) => page.evaluate(([base, count]) => localStorage.setItem('ashen-oath-editor-maps-v1',
    JSON.stringify(Array.from({ length: count }, (_, i) => ({ name: `Карта ${i}`, definition: { ...base, name: `Карта ${i}` } })))), [base, count] as const);
  const storedNames = () => page.evaluate(() => JSON.parse(localStorage.getItem('ashen-oath-editor-maps-v1') ?? '[]').map((m: any) => m.name));
  // Older saves beyond the limit stay visible.
  await seed(55); await page.reload(); await page.locator('#editor-button').click();
  await expect(page.locator('#editor-saved option')).toHaveCount(56);
  await seed(50); await page.reload(); await page.locator('#editor-button').click();
  await field(page, '#editor-name', 'Новая карта'); await page.locator('[data-editor="save"]').click();
  await expect(page.locator('#editor-notice')).toContainText('предел');
  await expect(page.locator('#editor-notice')).toContainText('Удалить сохранение');
  expect(await storedNames()).toHaveLength(50); expect(await storedNames()).not.toContain('Новая карта');
  // Overwriting an existing name is still allowed at the limit.
  await field(page, '#editor-name', 'Карта 3'); await page.locator('[data-editor="save"]').click();
  await expect(page.locator('#editor-notice')).toContainText('Сохранено');
  expect(await storedNames()).toHaveLength(50);
  // After deleting one save, the new name fits and appears in the list.
  await page.locator('#editor-saved').selectOption({ label: 'Карта 0' }); await page.locator('[data-editor="delete"]').click();
  await field(page, '#editor-name', 'Новая карта'); await page.locator('[data-editor="save"]').click();
  await expect(page.locator('#editor-notice')).toContainText('Сохранено');
  await expect(page.locator('#editor-saved option', { hasText: 'Новая карта' })).toHaveCount(1);
});
