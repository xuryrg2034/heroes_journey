def sub(path, old, new, n=1):
    s=open(path,encoding='utf-8').read()
    assert old in s, (path, old[:70])
    open(path,'w',encoding='utf-8').write(s.replace(old,new,n))
t='tests/realtime-habits.spec.ts'
sub(t,"marks: number; marked: string[] }>","marks: number; marked: string[]; flashes: number; flashing: number; items: Record<string, string[]>; hint: string }>")
sub(t,"  await expect(page.getByTestId('habit-none')).toHaveText('Без повадки');\n","""  await expect(page.getByTestId('habit-none')).toHaveText('Без повадки');
  // Design 20.10.2026 (§18): the line under the title says what the choice does; each card shows 2-3 opened items of its tag beside the words.
  await expect(page.getByTestId('gift-habits-hint')).toHaveText('Предметы с этим знаком будут попадаться чаще');
  const items = (await shown(page)).items;
  for (const def of RT_HABITS) {
    expect(items[def.id].length, `${def.id}: 2-3 item icons`).toBeGreaterThanOrEqual(2);
    expect(items[def.id].length).toBeLessThanOrEqual(3);
    for (const id of items[def.id]) expect(rtTalisman(id)?.tags, `${id} carries ${def.id}`).toContain(def.id);
    await expect(page.getByTestId(`habit-items-${def.id}`).locator('.rt-habit-item')).toHaveCount(items[def.id].length);
  }
""")
sub(t,"  expect(await shown(page)).toMatchObject({ row: true, chosen: true, habit: 'cold' });\n","  expect(await shown(page)).toMatchObject({ row: true, chosen: true, habit: 'cold' });\n  await expect(page.getByTestId('gift-habits-hint'), 'the line goes once the habit is chosen').toHaveCount(0);\n")
sub(t,"    if (def.id === 'cold') await shot(page, 'habit-mark-talisman');","""    // Design 20.10.2026 (§18): a hover on the mark gives a readable bubble, not a bare title; the first screen with marks flashes them once a run.
    const tip = `Повадка «${def.name}»: такие предметы попадаются чаще`;
    await expect(page.getByTestId(`habit-mark-${want[0]}`)).toHaveAttribute('data-tip', tip);
    expect(info.flashes, `${def.id}: the first screen with marks flashed once`).toBe(1);
    expect(info.flashing).toBe(info.marks);
    await page.getByTestId(`habit-mark-${want[0]}`).hover();
    expect(await page.getByTestId(`habit-mark-${want[0]}`).evaluate(el => getComputedStyle(el, '::after').content)).toBe(`"${tip}"`);
    if (def.id === 'cold') await shot(page, 'habit-mark-talisman');
    await page.mouse.move(0, 0);
    // A redraw of the same run does not flash again.
    await page.evaluate(() => (window as any).__realtime.run.habitInfo?.());
    expect((await shown(page)).flashes).toBe(1);""")
