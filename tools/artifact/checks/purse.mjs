import { chromium } from '@playwright/test';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); await p.addInitScript(() => localStorage.setItem('ashen-oath-realtime-prologue-done', '1'));
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8799/local-test.html'); await p.waitForTimeout(1500);
await p.getByTestId('run-new').click(); await p.getByTestId('gift-1').click();
await p.locator('[data-status="available"]').first().click(); await p.getByTestId('run-enter').click();
await p.waitForTimeout(800);
const bt = p.getByTestId('run-battle'); if (await bt.count()) await bt.click();
await p.waitForTimeout(3000);
for (let i = 0; i < 6; i++) { await p.mouse.move(500 + i*40, 300); await p.mouse.down(); await p.mouse.move(620 + i*30, 400, { steps: 8 }); await p.mouse.up(); await p.keyboard.press('KeyQ'); await p.waitForTimeout(700); }
await p.screenshot({ path: process.argv[2] + '/purse-run.png' });
const txt = await p.evaluate(() => document.body.innerText);
console.log(JSON.stringify({ purse: /котёл\s*\d+/i.test(txt), score: /очки\s*\d+/i.test(txt), m: (txt.match(/котёл[^\n]{0,20}/i)||[])[0], errs }));
await b.close();
