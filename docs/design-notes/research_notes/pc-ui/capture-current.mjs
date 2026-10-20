import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = name => fileURLToPath(new URL(name, import.meta.url));
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/__rt-telemetry', r => r.fulfill({ status: 200, body: '{}' }));
  await page.addInitScript(() => localStorage.setItem('ashen-oath-realtime-prologue-done', '1'));
  page.on('pageerror', e => evidence.push({ error: e.message }));
  const capture = async name => {
    await page.waitForTimeout(200);
    await page.screenshot({ path: out(`current-${name}.png`) });
    evidence.push({ name, text: await page.locator('body').innerText(), buttons: await page.locator('button:visible').evaluateAll(bs => bs.map(b => ({ text: b.innerText, id: b.dataset.testid, title: b.title }))), geometry: await page.locator('.rt-run-hud,.rt-actionbar,.rt-build,.rt-hud,.rt-run-detail,.rt-hearth-art').evaluateAll(xs=>xs.map(x=>({class:x.className,rect:x.getBoundingClientRect().toJSON(),font:getComputedStyle(x).fontSize}))) });
    console.log(name, (await page.locator('body').innerText()).slice(0,220).replaceAll('\n',' / '));
  };
  await page.goto('http://127.0.0.1:5189/');
  await page.waitForFunction(()=>!!window.__realtime?.run);
  await capture('start-1280');
  await page.getByTestId('run-new').click();
  await capture('gift-1280');
  if(await page.getByTestId('habit-none').isVisible())await page.getByTestId('habit-none').click();
  await page.getByTestId('gift-1').click();
  await capture('map-1280');
  await page.locator('[data-status="available"]').first().click();
  await capture('node-1280');
  await page.getByTestId('run-enter').click();
  await page.waitForTimeout(2400);
  await page.keyboard.press('p');
  await capture('combat-1280');
  await page.locator('canvas').first().screenshot({ path: out('current-field.png') });
  console.log('Visible battle buttons', await page.locator('button:visible').evaluateAll(xs=>xs.map(x=>({t:x.innerText,id:x.dataset.testid,title:x.title}))));
  await page.keyboard.press('Escape');
  evidence.push({ name: 'combat-escape', text: (await page.locator('body').innerText()).slice(0,1800) });
  await page.keyboard.press('p');
  await page.evaluate(()=>window.__realtime.run.winArena());
  await page.waitForTimeout(1600);
  await capture('result-1280');
  const map=page.getByTestId('result-map'),skip=page.getByTestId('knack-skip');
  if(await skip.isVisible())await skip.click();else if(await map.isVisible())await map.click();
  await capture('after-result-1280');
  await page.setViewportSize({width:1920,height:1080});
  await capture('map-1920');
  writeFileSync(out('current-evidence.json'),JSON.stringify({date:'2026-10-19',note:'Fresh isolated browser; telemetry upload intercepted. First win uses existing test hook solely to display result UI.',evidence},null,2));
} finally { await browser.close(); }
