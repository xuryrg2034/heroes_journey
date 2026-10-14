import { chromium } from '@playwright/test';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); await p.addInitScript(() => localStorage.setItem('ashen-oath-realtime-prologue-done', '1'));
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8799/local-test.html?arena=5#sandbox'); await p.waitForTimeout(2000);


const hp0 = await p.evaluate(() => window.__realtime.snapshot().hp);
let shot = false;
for (let i = 0; i < 40; i++) { await p.waitForTimeout(150); if (!shot && i === 26) { await p.screenshot({ path: process.argv[2] + '/archer.png' }); shot = true; } }
const s = await p.evaluate(() => { const w = window.__realtime.snapshot(); return { status: w.status, hp: w.hp, arena: w.arena?.name ?? w.arenaName }; });
console.log(JSON.stringify({ hp0, s, errs }));
await b.close();
