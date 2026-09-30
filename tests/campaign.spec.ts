import { test, expect, type Page } from '@playwright/test';

test('level list opens seven distinct scenarios, retries the selected room, and works on mobile',async({page,browser})=>{
  test.setTimeout(60_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const scenarios=['forest','gate','banquet','barracks','chess','library','wizard'];
  await page.goto('/');await expect(page.locator('#title-screen [data-scenario]')).toHaveCount(7);
  await page.screenshot({path:'artifacts/level-list-desktop.png',fullPage:true});
  for(const scenario of scenarios){
    await page.locator(`#title-screen [data-scenario="${scenario}"]`).click();await settled(page);await expect(page.locator('#board-host canvas')).toBeVisible();
    const entry=await state(page);expect(entry.room.theme).toBe(scenario);expect(entry.phase).toBe('PLAYER_INPUT');expect(entry.board.some(Boolean)).toBe(true);
    if(scenario==='chess'){
      const path=await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;return g.availableMoves().filter((p:number[])=>{const v=g.preview(p);return !v.completesRoom&&v.damage<g.state.player.hp;}).sort((a:number[],b:number[])=>a.length-b.length)[0];});expect(path).toBeTruthy();
      await drag(page,path);expect((await state(page)).turn).toBe(entry.turn+1);
      await page.locator('[data-action="pause"]').click();await page.locator('#modal [data-action="retry"]').click();await settled(page);
      const restarted=await state(page);expect(restarted.room).toEqual(entry.room);expect(restarted.player).toEqual(entry.player);expect(restarted.turn).toBe(entry.turn);expect(restarted.board).toEqual(entry.board);expect(restarted.inventory).toEqual(entry.inventory);
    }
    await page.locator('.brand[data-action="title"]').click();await expect(page.locator('#title-screen')).toBeVisible();
  }
  const context=await browser.newContext({baseURL:`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`,viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));mobile.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await mobile.goto('/');const entries=mobile.locator('#title-screen [data-scenario]');await expect(entries).toHaveCount(7);
  expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const entry of await entries.all()){await expect(entry).toBeVisible();const box=await entry.boundingBox();expect(box!.width).toBeGreaterThan(200);expect(box!.height).toBeGreaterThanOrEqual(40);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);}
  await mobile.screenshot({path:'artifacts/level-list-mobile.png',fullPage:true});await mobile.locator('[data-scenario="library"]').tap();await settled(mobile);expect((await state(mobile)).room.theme).toBe('library');expect(errors).toEqual([]);await context.close();
});

const state=(page:Page)=>page.evaluate(()=>structuredClone((window as any).__PUZZLE_GAME.state));
const center=async(page:Page,index:number)=>{await page.locator('#board-host').scrollIntoViewIfNeeded();return page.evaluate(i=>(window as any).__PUZZLE_GAME.gridToScreen(i),index);};
async function settled(page:Page){await expect.poll(async()=>(await state(page)).phase,{timeout:15_000}).not.toMatch(/TITLE|RESOLVE|UPDATE/);}
async function drag(page:Page,path:number[],release=true){
  const first=await center(page,path[0]);await page.mouse.move(first.x,first.y);await page.mouse.down();
  for(const index of path.slice(1)){const at=await center(page,index);await page.mouse.move(at.x,at.y,{steps:4});}
  await expect.poll(async()=>(await state(page)).chain).toEqual(path);
  if(release){await page.mouse.up();await settled(page);}
}
async function start(page:Page){await page.goto('/');await page.locator('#campaign-button').click();await settled(page);await expect(page.locator('#board-host canvas')).toBeVisible();}
async function selectMove(page:Page){return page.evaluate(()=>{
  const g=(window as any).__PUZZLE_GAME,s=g.state;
  const doors=s.board.flatMap((c:any,i:number)=>c?.kind==='door'?[i]:[]);
  const bosses=s.board.flatMap((c:any,i:number)=>c?.kind==='boss'?[i]:[]);
  const targets=s.room.key.held?doors:s.room.key.droppedAt!==null?[s.room.key.droppedAt]:bosses.length?bosses:[];
  return g.availableMoves().map((path:number[])=>{
    const p=g.preview(path),distance=targets.length?Math.min(...targets.map((i:number)=>Math.max(Math.abs(i%s.cols-p.endIndex%s.cols),Math.abs(Math.floor(i/s.cols)-Math.floor(p.endIndex/s.cols))))):0;
    const damage=p.hits.reduce((v:number,h:any)=>v+h.damage*(s.board[h.index]?.carriesKey||s.board[h.index]?.variant==='wizard'?25:0),0);
    return {path,score:(p.completesRoom?10000:0)+(p.keyCollected?500:0)+damage+p.kills*3-p.damage*120-distance*4-(p.damage>=s.player.hp?100000:0)};
  }).sort((a:any,b:any)=>b.score-a.score)[0]?.path;
});}
async function selectAction(page:Page,force=false){return page.evaluate(forceGate=>{
  const g=(window as any).__PUZZLE_GAME,e=g.engine,s=g.state;
  const doors=s.board.flatMap((c:any,i:number)=>c?.kind==='door'?[i]:[]),bosses=s.board.flatMap((c:any,i:number)=>c?.carriesKey||c?.variant==='wizard'?[i]:[]);
  const targets=forceGate||s.room.key.held?doors:s.room.key.droppedAt!==null?[s.room.key.droppedAt]:bosses;
  const actions:any[]=g.availableMoves().map((path:number[])=>({ability:null,path,p:g.preview(path)}));
  for(let index=0;index<s.board.length;index++){const p=e.previewAbility('jump',index);if(p.valid)actions.push({ability:'jump',target:index,p});}
  const spin=e.previewAbility('spin');if(spin.valid)actions.push({ability:'spin',p:spin});
  return actions.filter(a=>!forceGate||!a.p.keyCollected&&!a.p.hits.some((h:any)=>h.killed&&s.board[h.index]?.carriesKey)).map(a=>{
    const p=a.p,distance=targets.length?Math.min(...targets.map((i:number)=>Math.abs(i%s.cols-p.endIndex%s.cols)+Math.abs(Math.floor(i/s.cols)-Math.floor(p.endIndex/s.cols)))):0;
    const damage=p.hits.reduce((v:number,h:any)=>v+h.damage*(forceGate?(s.board[h.index]?.kind==='door'?20:0):(s.board[h.index]?.carriesKey||s.board[h.index]?.variant==='wizard'?25:0)),0);
    return{...a,score:(p.completesRoom?100000:0)+(p.keyCollected&&!forceGate?500:0)+damage+p.kills*(forceGate?1:3)-p.damage*(forceGate?90:120)-distance*(forceGate?5:4)-p.energyCost*.5-(p.damage>=s.player.hp?100000:0)};
  }).sort((a,b)=>b.score-a.score)[0];
},force);}
async function act(page:Page,action:any){
  if(action.ability==='jump'){await page.locator('#jump-ability').click();const at=await center(page,action.target);await page.mouse.click(at.x,at.y);await settled(page);}
  else if(action.ability==='spin'){await page.locator('#spin-ability').click();await settled(page);}
  else await drag(page,action.path);
}

test('natural campaign: key and door contact, rewards and exact damage across real play',async({page})=>{
  test.setTimeout(240_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;g.animationScale=.3;(window as any).__campaignEvents=[];g.engine.subscribe((_s:any,e:any)=>{if(['key-collect','door-open','arrow-volley','reward','room-complete'].includes(e.type))(window as any).__campaignEvents.push(structuredClone(e));});});
  expect((await state(page)).cols).toBe(6);expect((await state(page)).rows).toBe(10);
  const gate=(await state(page)).board.filter((c:any)=>c?.kind==='door');expect(gate).toHaveLength(2);expect(gate[0].id).toBe(gate[1].id);expect(gate[0].hp).toBe(200);
  await page.screenshot({path:'artifacts/campaign-gate.png',fullPage:true});
  let sawWizardStageTwo=false;const rooms=new Set<string>();
  for(let turn=0;turn<100;turn++){
    let before=await state(page);if(before.phase==='WIN'||before.phase==='LOSE')break;
    if(before.phase==='REWARD'){
            const reward=before.inventory.healing<1?'healing':'bomb';
      await page.screenshot({path:`artifacts/campaign-reward-${before.room.depth}.png`,fullPage:true});
      await page.locator(`[data-reward="${reward}"]`).click();await settled(page);continue;
    }
    const roomId=`${before.room.depth}-${before.room.theme}`;
    if(!rooms.has(roomId)){rooms.add(roomId);await page.screenshot({path:`artifacts/campaign-room-${roomId}.png`,fullPage:true});}
    if(!sawWizardStageTwo&&before.board.some((c:any)=>c?.variant==='wizard'&&c.bossStage===2)){sawWizardStageTwo=true;await page.screenshot({path:'artifacts/campaign-wizard-stage-two.png',fullPage:true});}
    if(before.player.hp<=2&&before.inventory.healing>0&&!before.itemPrepared){await page.locator('#healing-button').click();before=await state(page);}
    let action=await selectAction(page);
    if(!action&&before.inventory.bomb&&!before.itemPrepared){
      const target=await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME,s=g.state;return g.engine.chainNeighbors(s.player.index).find((i:number)=>s.board[i]?.kind==='melee'&&s.board[i].hp<=6);});
      if(target!==undefined){await page.locator('#bomb-button').click();const at=await center(page,target);await page.mouse.click(at.x,at.y);await settled(page);before=await state(page);action=await selectAction(page);}
    }
    if(!action){await page.locator('#wait-button').click();await settled(page);continue;}
    const preview=action.p;expect(preview.valid).toBe(true);
    if(before.room.kind==='gate'&&before.hazard.turnsUntil===1)await page.screenshot({path:'artifacts/campaign-volley-preview.png',fullPage:true});
    await act(page,action);const after=await state(page);
    expect(after.player.hp).toBe(Math.max(0,before.player.hp-preview.damage));
    if(after.phase==='PLAYER_INPUT'){expect(after.board[after.player.index]).toBeNull();expect(after.chain).toEqual([]);}
  }
  // Whether the heuristic bot wins is balance, not a rule: only per-turn invariants above are asserted.
  await page.screenshot({path:'artifacts/campaign-final.png',fullPage:true});expect(errors).toEqual([]);
});

test('gate mobile touch uses the full dynamic board with no horizontal overflow',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}/`);await page.locator('#campaign-button').tap();await settled(page);await page.locator('#board-host').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const path=await selectMove(page);expect(path.length).toBeGreaterThan(1);const points=[];for(const index of path)points.push(await center(page,index));
  const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});
  for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
  await expect.poll(async()=>(await state(page)).chain).toEqual(path);await page.screenshot({path:'artifacts/campaign-gate-mobile.png',fullPage:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settled(page);expect((await state(page)).turn).toBe(1);expect(errors).toEqual([]);await context.close();
});

test('a natural six-kill chain earns a crystal, then touch crosses it into another color',async({browser})=>{
  test.setTimeout(60_000);
  const context=await browser.newContext({baseURL:`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 4173}`,viewport:{width:1440,height:1000},hasTouch:true,deviceScaleFactor:1}),page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));await start(page);
  // Find an ordinary chain of six or more kills using public moves; no injected energy or board edits.
  for(let turn=0;turn<12&&!(await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;return g.availableMoves().some((p:number[])=>g.preview(p).createsPrism);}));turn++){
    const charge=await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;return g.availableMoves().map((path:number[])=>({path,p:g.preview(path)})).filter((a:any)=>!a.p.completesRoom).sort((a:any,b:any)=>(b.p.kills-b.p.damage*80)-(a.p.kills-a.p.damage*80))[0]?.path;});
    expect(charge).toBeTruthy();await drag(page,charge);
  }
  const beforeReward=await state(page);
  const rewardPath=await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;return g.availableMoves().map((path:number[])=>({path,p:g.preview(path)})).filter((v:any)=>v.p.createsPrism).sort((a:any,b:any)=>a.p.damage-b.p.damage||a.path.length-b.path.length)[0]?.path;});expect(rewardPath).toBeTruthy();
  await drag(page,rewardPath,false);const preview=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(preview.kills).toBeGreaterThanOrEqual(6);expect(preview.crystals).toBe(Math.floor(preview.kills/6));expect(preview.createsPrism).toBe(true);
  await page.screenshot({path:'artifacts/campaign-prism-reward-preview.png',fullPage:true});await page.mouse.up();await settled(page);
  // Crystals land on seeded random cells: find the ones this chain created (earlier chains may have left crystals too).
  const earned=await state(page),oldPrisms=new Set(beforeReward.board.filter((c:any)=>c?.kind==='prism').map((c:any)=>c.id)),fresh=earned.board.map((c:any,i:number)=>c?.kind==='prism'&&!oldPrisms.has(c.id)?i:-1).filter((i:number)=>i>=0);expect(fresh).toHaveLength(preview.crystals);const prism=fresh[0];
  const prismId=earned.board[prism].id;expect(earned.player.energy).toBe(Math.min(7,beforeReward.player.energy+preview.energyGain));await page.screenshot({path:'artifacts/campaign-prism-created.png',fullPage:true});
  const target=await center(page,prism);await page.mouse.click(target.x,target.y);expect((await state(page)).chain).toEqual([]);expect((await state(page)).turn).toBe(earned.turn);
  const bridge=await page.evaluate(index=>{
    const g=(window as any).__PUZZLE_GAME,s=g.state;
    return g.availableMoves().filter((path:number[])=>{const at=path.indexOf(index);return at>0&&at<path.length-1&&typeof s.board[path[at-1]].color==='number'&&typeof s.board[path[at+1]].color==='number'&&s.board[path[at-1]].color!==s.board[path[at+1]].color;}).sort((a:number[],b:number[])=>a.length-b.length)[0];
  },prism);expect(bridge).toBeTruthy();
  await page.setViewportSize({width:390,height:844});await page.locator('#board-host').scrollIntoViewIfNeeded();const points=[];for(const index of bridge)points.push(await center(page,index));
  const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
  await expect.poll(async()=>(await state(page)).chain).toEqual(bridge);
  const mixed=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview()),ordinal=mixed.hits.findIndex((h:any)=>h.index===prism);
  expect(mixed.hits[ordinal]).toMatchObject({damage:0,physical:false});expect(mixed.hits[ordinal].remainingPower).toBe(mixed.hits[ordinal-1].remainingPower);expect(mixed.hits[ordinal+1].availablePower).toBe(mixed.hits[ordinal].remainingPower+1);expect(mixed.enemies).toBe(bridge.length-1);
  await page.screenshot({path:'artifacts/campaign-prism-touch-bridge.png',fullPage:true});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settled(page);
  const after=await state(page);expect(after.player.energy).toBe(Math.min(7,earned.player.energy+mixed.energyGain));expect(mixed.energyCost).toBe(0);expect(after.objective.prisms).toBe(1);expect(after.board.some((c:any)=>c?.id===prismId)).toBe(false);expect(after.board.filter((c:any)=>c?.kind==='prism').length).toBeLessThanOrEqual(2);expect(errors).toEqual([]);await context.close();
});

// Small, explicit fixtures isolate rare door and item edges. The natural campaign
// above never mutates gameplay state and checks per-turn invariants.
test('bomb breaches a magical door without entering; physical damage and item previews resolve exactly',async({page})=>{
  test.setTimeout(60_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.startCastle(701));await settled(page);
  const arrange=async(magic:boolean)=>page.evaluate(isMagic=>{
    const g=(window as any).__PUZZLE_GAME,e=g.engine,s=g.state;
    const doorIndex=s.board.findIndex((c:any)=>c?.kind==='door'),door=s.board[doorIndex];
    const helper=e.chainNeighbors(doorIndex).find((i:number)=>s.board[i]?.kind==='melee');
    const hero=e.chainNeighbors(helper).find((i:number)=>i!==doorIndex&&!door.door.footprint.includes(i)&&s.board[i]?.kind==='melee');
    s.board[s.player.index]=s.board[hero];s.board[hero]=null;s.player.index=hero;
    s.player.hp=5;s.room.key={held:false,droppedAt:null};s.chain=[];
    door.door.magic=isMagic;door.door.breached=false;door.hp=1;door.maxHp=isMagic?1:200;
    s.board[helper].hp=0;s.board[helper].maxHp=0;s.board[helper].color=0;
    for(const c of s.board)if(c){c.intent={cells:[],damage:1,label:'Спокоен'};c.behavior.aggressive=false;}
    e.cancelChain();return {doorIndex,helper,hero,doorId:door.id};
  },magic);
  const setup=await arrange(true),before=await state(page);await page.locator('#bomb-button').click();
  const at=await center(page,setup.doorIndex);await page.mouse.move(at.x,at.y);await page.screenshot({path:'artifacts/campaign-bomb-target.png',fullPage:true});await page.mouse.click(at.x,at.y);
  const breached=await state(page);expect(breached.board[setup.doorIndex].door.breached).toBe(true);expect(breached.phase).toBe('PLAYER_INPUT');expect(breached.turn).toBe(before.turn);expect(breached.player.index).toBe(setup.hero);expect(breached.inventory.bomb).toBe(before.inventory.bomb-1);
  await drag(page,[setup.helper,setup.doorIndex]);expect((await state(page)).phase).toBe('REWARD');
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.startCastle(701));await settled(page);const force=await arrange(false);
  await drag(page,[force.helper,force.doorIndex],false);const hit=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview().hits.at(-1));expect(hit.damage).toBe(1);expect(hit.powerSpent).toBe(1);expect(hit.doorOpened).toBe(true);await page.mouse.up();await settled(page);expect((await state(page)).phase).toBe('REWARD');
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.startCampaign(701));await settled(page);
  const initial=await state(page);await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME,s=g.state;s.player.hp=2;s.inventory.fire=1;g.engine.cancelChain();});
  await page.locator('#healing-button').click();expect((await state(page)).player.hp).toBe(5);expect((await state(page)).inventory.healing).toBe(initial.inventory.healing-1);
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await settled(page);expect((await state(page)).player.hp).toBe(initial.player.hp);expect((await state(page)).inventory).toEqual(initial.inventory);
  await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;g.state.inventory.fire=1;g.engine.cancelChain();});
  const target=await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;return g.state.board.findIndex((c:any,i:number)=>c?.kind==='melee'&&g.previewItem('fire',i).valid);});
  const fire=await page.evaluate(i=>(window as any).__PUZZLE_GAME.previewItem('fire',i),target),snapshot=await state(page);
  expect(fire.damage).toBe(0);expect(fire.indices.length).toBeLessThanOrEqual(5);await page.locator('#fire-button').click();const fireAt=await center(page,target);await page.mouse.click(fireAt.x,fireAt.y);
  const burnt=await state(page);expect(burnt.player.hp).toBe(snapshot.player.hp);for(const index of fire.indices){const old=snapshot.board[index];if(old&&old.kind!=='door'){expect(burnt.board[index].id).toBe(old.id);expect(burnt.board[index].hp).toBe(old.hp);expect(burnt.board[index].damageEffects.burning).toBe((old.damageEffects?.burning??0)+1);}}
  expect(errors).toEqual([]);
});

test('a single adjacent door click enters with a key or broken seal, while closed doors and lone enemies spend no turn',async({page})=>{
  test.setTimeout(45_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  for(const mode of ['closed','ordinary','key','breached'] as const){
    await page.evaluate(()=>(window as any).__PUZZLE_GAME.startCastle(701));await settled(page);
    const fixture=await page.evaluate(kind=>{
      const g=(window as any).__PUZZLE_GAME,e=g.engine,s=g.state;
      const door=s.board.findIndex((c:any)=>c?.kind==='door'),hero=e.chainNeighbors(door).find((i:number)=>s.board[i]?.kind==='melee');
      s.board[s.player.index]=s.board[hero];s.board[hero]=null;s.player.index=hero;s.room.key={held:kind==='key',droppedAt:null};
      const enemy=e.chainNeighbors(hero).find((i:number)=>s.board[i]?.kind==='melee');
      (window as any).__doorUnsubscribe?.();(window as any).__doorEvents=[];
      (window as any).__doorUnsubscribe=e.subscribe((_state:any,event:any)=>{if(['room-complete','enemy-turn'].includes(event.type))(window as any).__doorEvents.push(structuredClone(event));});
      e.cancelChain();return {door,hero,enemy};
    },mode);
    if(mode==='breached'){
      const beforeBomb=await state(page);await page.locator('#bomb-button').click();const bombAt=await center(page,fixture.door);await page.mouse.click(bombAt.x,bombAt.y);
      const afterBomb=await state(page);expect(afterBomb.board[fixture.door].door.breached).toBe(true);expect(afterBomb.phase).toBe('PLAYER_INPUT');expect(afterBomb.turn).toBe(beforeBomb.turn);expect(afterBomb.player.index).toBe(fixture.hero);
    }
    const target=mode==='ordinary'?fixture.enemy:fixture.door,opens=mode==='key'||mode==='breached',before=await state(page);
    const preview=await page.evaluate(i=>(window as any).__PUZZLE_GAME.preview([i]),target);
    expect(preview.valid).toBe(opens);
    const available=await page.evaluate(i=>(window as any).__PUZZLE_GAME.availableMoves().some((path:number[])=>path.length===1&&path[0]===i),target);expect(available).toBe(opens);
    const at=await center(page,target);if(mode==='key'){await page.mouse.move(at.x,at.y);await page.screenshot({path:'artifacts/campaign-single-key-door.png',fullPage:true});}
    // No drag or synthetic engine selection: the real pointer down/up pipeline.
    await page.mouse.click(at.x,at.y,{delay:60});await settled(page);
    const after=await state(page),events=await page.evaluate(()=>(window as any).__doorEvents);
    expect(after.player.hp).toBe(before.player.hp);expect(events.filter((e:any)=>e.type==='enemy-turn')).toHaveLength(0);
    if(opens){expect(after.phase).toBe('REWARD');expect(after.turn).toBe(before.turn+1);expect(events.filter((e:any)=>e.type==='room-complete')).toHaveLength(1);}
    else {expect(after.phase).toBe('PLAYER_INPUT');expect(after.turn).toBe(before.turn);expect(after.player.index).toBe(before.player.index);expect(after.board).toEqual(before.board);expect(after.chain).toEqual([]);expect(events).toEqual([]);}
  }
  expect(errors).toEqual([]);
});

