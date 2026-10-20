import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Static document checks and PNG export. Does not launch or modify the game.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(new URL('./index.html', import.meta.url).href);
  assert.equal(await page.locator('.nav-item').count(), 22);
  const data = JSON.parse(readFileSync(new URL('./atlas-data.json', import.meta.url), 'utf8'));
  for (const a of data.proposed) {
    await page.locator(`.nav-item[data-id="${a.id}"]`).click();
    await page.locator('#variant').selectOption(a.variant);
    assert.equal(await page.locator('#title').textContent(), a.name);
    assert.equal(await page.locator('#stage svg').count(), 1);
    assert.equal(await page.locator('#stage svg').getAttribute('viewBox'), `-0.7 -0.7 ${a.width+1.4} ${a.height+1.4}`);
    assert.ok(!/NaN|undefined/.test(await page.locator('#stage').innerHTML()), a.id);
  }
  await page.locator('.nav-item[data-id="shaman-circle"]').click();
  await page.locator('#variant').selectOption('practice');
  for (const id of ['routes', 'spawns', 'grid', 'compare']) await page.locator('#'+id).check();
  assert.equal(await page.locator('#stage svg').count(), 2);
  assert.ok((await page.locator('#stage').textContent()).includes('текущий шаблон'));
  await page.locator('#zoom').click();
  assert.equal(await page.locator('#zoom-dialog').evaluate(el=>el.open), true);
  await page.locator('#close-zoom').click();
  await page.locator('#search').fill('shaman');
  assert.equal(await page.locator('.nav-item').count(), 1);
  await page.locator('#search').fill('');
  for (const id of ['spawns', 'grid']) await page.locator('#'+id).uncheck();
  await page.screenshot({ path: fileURLToPath(new URL('./atlas-screen.png', import.meta.url)) });
  await page.reload();
  assert.equal(await page.locator('#variant').inputValue(), 'practice');
  assert.equal(await page.locator('#title').textContent(), data.proposed.find(a=>a.id==='shaman-circle').name);
  assert.deepEqual(errors, []);
  console.log('Checked 22 arena links / 26 variants, layers, comparison, zoom, search, hash restore; no browser errors.');

  for (const name of ['overview', 'preview', 'sheet-1', 'sheet-2', 'sheet-3', 'sheet-4']) {
    const svg = readFileSync(new URL(`./${name}.svg`, import.meta.url), 'utf8');
    const [,w,h] = svg.match(/width="(\d+)" height="(\d+)"/);
    await page.setViewportSize({ width: Number(w), height: Number(h) });
    await page.setContent('<style>body{margin:0}</style>'+svg);
    await page.screenshot({ path: fileURLToPath(new URL(`./${name}.png`, import.meta.url)) });
    console.log(`Exported ${name}.png (${w} × ${h})`);
  }
} finally {
  await browser.close();
}
