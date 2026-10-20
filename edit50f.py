def sub(path, old, new, n=1):
    s=open(path,encoding='utf-8').read()
    assert old in s, (path, old[:70])
    open(path,'w',encoding='utf-8').write(s.replace(old,new,n))
sub('tests/realtime-habits.spec.ts',"    // A redraw of the same run does not flash again.\n    await page.evaluate(() => (window as any).__realtime.run.habitInfo?.());\n    expect((await shown(page)).flashes).toBe(1);","    // A redraw of the same screen does not flash again.\n    expect((await shown(page)).flashes).toBe(1);")
k='tests/realtime-knacks.spec.ts'
sub(k,"  expect(hone.line).toMatch(/^Ранг II: /);\n","""  expect(hone.line).toMatch(/^Ранг II: /);
  // Design 20.10.2026 (§18): the line under «Сноровка», and the rank II card shows both rules - «Сейчас: …» and «Ранг II: …».
  await expect(page.getByTestId('knack-hint')).toHaveText('Усиль счётчик, который у тебя есть, или возьми новый');
  await expect(page.getByTestId(`knack-now-${hone.id}`)).toHaveText(/^Сейчас: .+/);
  await expect(page.getByTestId(`knack-line-${hone.id}`)).toHaveText(/^Ранг II: .+/);
  await page.screenshot({ path: `${process.env.SHOT_DIR ?? 'artifacts'}/knack-card-two-lines.png` });
""")
sub(k,"  await expect(page.getByTestId('build-tip')).toContainText('Ранг II:');","  await expect(page.getByTestId('build-tip')).toContainText('Ранг II:');\n  expect((await page.getByTestId('build-tip').innerText()).startsWith('Ранг II:'), 'the tip of a counter on rank II starts with «Ранг II:»').toBe(true);")
