import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = name => fileURLToPath(new URL(name, import.meta.url));
const url = new URL('index.html', import.meta.url).href;
const scenes = ['combat', 'map', 'reward', 'inventory', 'result', 'shop', 'camp', 'settings'];
const browser = await chromium.launch({headless:true});
const evidence = {date:'2026-10-19', scope:'Standalone UI concept only; no game tests or human playtest.', layouts:[], interactions:[], errors:[]};
try {
  const page = await browser.newPage();
  page.on('pageerror', e => evidence.errors.push(e.message));
  for (const size of [{width:1280,height:720},{width:1920,height:1080}]) {
    await page.setViewportSize(size);
    for (const scene of scenes) {
      for (const presentation of [false,true]) {
      await page.goto(`${url}${presentation?'?present=1':''}#${scene}`);
      for (const font of [100,120]) {
        await page.evaluate(font=>{state.font=font;render()},font);
        const layout = await page.evaluate(()=>({
          horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
          brokenImages:[...document.images].filter(x=>!x.complete||x.naturalWidth===0).map(x=>x.src),
          outside:[...document.querySelectorAll('.primary,.reward-footer button,.combat-menu button')].filter(b=>{const r=b.getBoundingClientRect();return r.top<0||r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1}).map(b=>b.textContent)
        }));
        evidence.layouts.push({scene,...size,font,presentation,...layout});
        assert.equal(layout.horizontalOverflow,false,`${scene} horizontal overflow`);
        assert.deepEqual(layout.brokenImages,[],`${scene} missing images`);
        assert.deepEqual(layout.outside,[],`${scene} action outside viewport at ${size.width}/${font}%`);
        if(font===100&&presentation)await page.screenshot({path:out(`proposed-${scene}-${size.width}.png`)});
      }
      }
    }
  }
  await page.setViewportSize({width:1280,height:720});
  await page.goto(`${url}#combat`);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.aim-hint').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pause-panel').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pause-panel').count(),1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'exit');
  await page.keyboard.press('i');
  await page.locator('#item-search').fill('Рука');
  assert.equal(await page.locator('.item-row').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pause-panel').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pause-panel').count(),0);
  evidence.interactions.push('Space aim → Escape cancels only → Escape pauses; modal focus wraps; I opens collection; search; Escape restores previous pause.');
  await page.selectOption('#scene','reward');
  await page.locator('[data-action=offer][data-id=cold]').click();
  assert.equal(await page.evaluate(()=>state.path),'return');
  await page.locator('[data-action=take-reward]').click();
  assert.equal(await page.evaluate(()=>state.path),'cold');
  evidence.interactions.push('Reward selection previews without replacing; explicit confirmation replaces.');
  await page.locator('[data-action=map-heal]').click();
  assert.deepEqual(await page.evaluate(()=>[state.hp,state.resources,state.healBought]),[14,7,1]);
  assert.match(await page.locator('[data-action=map-heal]').innerText(),/3 ◇/);
  await page.selectOption('#scene','shop');
  await page.locator('[data-action=shop-item][data-id=healing]').click();
  await page.locator('[data-action=buy]').click();
  assert.deepEqual(await page.evaluate(()=>[state.resources,state.heals]),[4,3]);
  assert.equal(await page.locator('[data-action=buy]').isDisabled(),true);
  evidence.interactions.push('Map heal increases next price; shop purchase changes resources and potion count; duplicate purchase disabled.');
  await page.selectOption('#scene','camp');
  await page.locator('[data-action=hero][data-id=toad]').click();
  assert.equal(await page.locator('h1').innerText(),'Ведунья');
  assert.match(await page.locator('.topbar').innerText(),/запас лагеря/);
  assert.doesNotMatch(await page.locator('.topbar').innerText(),/HP/);
  await page.locator('[data-action=npc][data-id=owl]').click();
  assert.equal(await page.locator('.npc-card').count(),1);
  await page.locator('#compare').click();
  assert.equal(await page.locator('.before').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.before').count(),0);
  evidence.interactions.push('Hero selection, NPC details, current/proposed comparison, Escape back.');
  await page.selectOption('#scene','settings');
  await page.selectOption('#font-size','120');
  await page.locator('#contrast').check();
  await page.locator('#motion').uncheck();
  assert.equal(await page.evaluate(()=>document.body.classList.contains('high-contrast')&&document.body.classList.contains('no-motion')),true);
  evidence.interactions.push('Text scale, contrast and reduced motion controls change presentation.');
  assert.deepEqual(evidence.errors,[]);
  evidence.result='PASS';
  console.log(`${evidence.layouts.length} layouts; ${evidence.interactions.length} interaction scenarios; no browser errors.`);
} finally {
  writeFileSync(out('prototype-evidence.json'),JSON.stringify(evidence,null,2));
  await browser.close();
}
