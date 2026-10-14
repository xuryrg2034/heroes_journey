import { chromium } from '@playwright/test';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); await p.addInitScript(() => localStorage.setItem('ashen-oath-realtime-prologue-done', '1'));
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8799/local-test.html'); await p.waitForTimeout(1500);
await p.getByTestId('run-new').click(); console.log(await p.getByTestId('gift-1').innerText()); await p.getByTestId('gift-1').click();
await p.locator('[data-status="available"]').first().click(); await p.getByTestId('run-enter').click();
await p.waitForTimeout(800);
const bt = p.getByTestId('run-battle'); if (await bt.count()) await bt.click();
await p.waitForTimeout(3000);
for (let i = 0; i < 6; i++) { await p.mouse.move(500 + i*40, 300); await p.mouse.down(); await p.mouse.move(620 + i*30, 400, { steps: 8 }); await p.mouse.up(); await p.keyboard.press('KeyQ'); await p.waitForTimeout(700); }
const col = await p.evaluate(() => { const c = document.querySelector('[data-testid=build-column]'); if (!c) return null; const r = c.getBoundingClientRect(); return { n: c.children.length, text: c.innerText.slice(0,200), r: [r.x, r.y, r.width, r.height], disp: getComputedStyle(c).display }; }); console.log(JSON.stringify(col)); 
const snap = await p.evaluate(() => { const s = window.__realtime?.snapshot?.(); return s && { status: s.status, enemies: s.enemies?.length, time: Math.round(s.time*10)/10, hp: s.hero?.hp, kills: s.kills }; });
console.log(JSON.stringify({ snap, errs }));
await b.close();
