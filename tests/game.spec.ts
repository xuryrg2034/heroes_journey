import { test, expect, type Page } from '@playwright/test';

const game=(page:Page)=>page.evaluate(()=>structuredClone((window as any).__PUZZLE_GAME.state));
/**
 * A dense 7×7 forest clearing in the editor format: trees, a pond, a campfire, a puddle at B2 (index 11) and 39 weak
 * goblins of five colors, the cat at D7 (45). It replaces the removed forest trial as a controlled field for input,
 * forecast and enemy-phase checks; `goals` and the extra enemies are set per test.
 */
const CLEARING=['#YYPPB#','YYPPPBR','YGG#BRR','GG~FBRG','RBBGGBG','#RRBBBG','#BRHG##'];
const COLOR:Record<string,number>={R:0,G:1,B:2,Y:3,P:4};
function clearing(goals:{key:string;target:number}[]=[{key:'kills',target:999}],overrides:Record<number,Record<string,unknown>>={},playerHp=5){
  const symbols=CLEARING.join('').split('');
  return {version:1,name:'Поляна',seed:701,cols:7,rows:7,
    terrain:symbols.map((symbol,index)=>index===11?'puddle':symbol==='#'?'tree':symbol==='~'?'pond':symbol==='F'?'campfire':'floor'),
    heroIndex:45,enemies:symbols.flatMap((symbol,index)=>symbol in COLOR?[{index,kind:'melee',color:COLOR[symbol],hp:0,...overrides[index]}]:[]),
    doors:[],goals,turnLimit:0,completion:'direct',paletteWeights:[100,100,100,100,100],extraColors:[],playerHp,inventory:{frost:1,bomb:0,healing:0,fire:0}};
}
/** The first chain of the clearing: D6-E6-F6-F5 (blue), as the removed forest trial's demonstration opening. */
const OPENING=[38,39,40,33];

test('chain budget grows through zero-HP enemies and spends five on a durable target',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  const path=[38,39,40,33,26,19,12];
  await page.evaluate(route=>{
    const g=(window as any).__PUZZLE_GAME;
    const definition={version:1,name:'Запас удара',seed:701,cols:7,rows:7,terrain:Array(49).fill('floor'),heroIndex:45,
      enemies:Array.from({length:49},(_,index)=>({index,kind:'melee',color:route.includes(index)?0:2,hp:index===19?5:0})).filter(c=>c.index!==45),
      doors:[],goals:[{key:'kills',target:99}],turnLimit:0,completion:'direct',paletteWeights:[100,0,100,0,0],extraColors:[],
      playerHp:5,inventory:{frost:0,bomb:0,healing:0,fire:0}};
    if(!g.engine.startCustomLevel(definition))throw new Error('Budget fixture did not start');
  },path);
  await ready(page);const before=await game(page);
  expect(before.board[38]).toMatchObject({hp:0,maxHp:0});
  await draw(page,path,false);
  const preview=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());
  expect(preview.hits.map((h:any)=>h.availablePower)).toEqual([1,2,3,4,5,6,2]);
  expect(preview.hits.map((h:any)=>h.remainingPower)).toEqual([1,2,3,4,5,1,2]);
  expect(preview.hits[5]).toMatchObject({index:19,powerSpent:5,hpAfter:0,killed:true});
  expect(preview.power).toBe(2);expect(preview.kills).toBe(7);
  await page.screenshot({path:'artifacts/chain-budget-desktop.png',fullPage:true});
  await page.mouse.up();await ready(page);
  const after=await game(page);expect(after.player.index).toBe(12);expect(after.objective.kills).toBe(7);
  for(const index of path)expect(after.board.some((c:any)=>c?.id===before.board[index].id)).toBe(false);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('ordinary diagonal starts and links work with mouse and touch and earn energy without an ability',async({browser})=>{
  test.setTimeout(45_000);const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1000},hasTouch:true}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  const initial=await game(page),path=[39,33,40];expect(initial.player.index).toBe(45);expect(initial.player.energy).toBe(0);
  await expect(page.locator('.ability-button')).toHaveCount(2);await expect(page.locator('#rage-ability')).toHaveCount(0);await expect(page.locator('.board-footnote')).toContainText('8 НАПРАВЛЕНИЙ');
  await draw(page,path,false);const back=await center(page,33);await page.mouse.move(back.x,back.y,{steps:5});await expect.poll(async()=>(await game(page)).chain).toEqual([39,33]);const next=await center(page,40);await page.mouse.move(next.x,next.y,{steps:5});
  await expect.poll(async()=>(await game(page)).chain).toEqual(path);const p=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(p).toMatchObject({valid:true,energyCost:0,energyGain:1.5});
  await page.screenshot({path:'artifacts/diagonal-mouse-chain.png',fullPage:true});await page.mouse.up();await ready(page);expect((await game(page)).player).toMatchObject({index:40,energy:1.5,hp:initial.player.hp-p.damage});
  await page.locator('[data-action="pause"]').click();await page.locator('[data-action="retry"]').click();await ready(page);expect(await game(page)).toEqual(initial);
  await page.setViewportSize({width:390,height:844});await page.locator('#board-host').scrollIntoViewIfNeeded();const points=[];for(const index of path)points.push(await center(page,index));const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});for(const point of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});
  await expect.poll(async()=>(await game(page)).chain).toEqual(path);expect(await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview().energyCost)).toBe(0);
  await page.screenshot({path:'artifacts/diagonal-touch-chain.png',fullPage:true});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await ready(page);expect((await game(page)).player).toMatchObject({index:40,energy:1.5});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await context.close();
});

test('ordinary melee keeps anger after a miss, strikes cardinally, recovers after impact and pauses under frost',async({page})=>{
  test.setTimeout(45_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);const initial=await game(page);
  // Controlled positions isolate one ordinary enemy; real chains, frost and Rest resolve every phase.
  await page.evaluate(()=>{
    const g=(window as any).__PUZZLE_GAME,e=g.engine,s=g.state;
    const template=structuredClone(s.board.find((c:any)=>c?.kind==='melee'));
    s.board[s.player.index]=s.board[38];s.board[38]=null;s.player.index=38;s.rotations=[];
    for(const c of s.board)if(c){c.behavior={aggressive:false,restTurns:0};c.intent={cells:[],damage:1,label:'Спокоен'};c.status.frozen=50;}
    for(const index of [25,39,40,33,26,19,18]){s.terrain[index]=index===25?'puddle':'floor';s.board[index]={...structuredClone(template),id:10000+index,hp:0,maxHp:0,color:0,status:{wet:index===25,frozen:index===25?0:50,brittle:false},behavior:{aggressive:index===25,restTurns:0},intent:{cells:index===25?[18,24,26,32]:[],damage:1,label:index===25?'Замах':'Спокоен'}};}
    s.inventory.frost=1;s.itemPrepared=false;e.cancelChain();(window as any).__meleeCycle=[];
    e.subscribe((state:any,event:any)=>{if(event.index===25||event.from===25)(window as any).__meleeCycle.push({event:structuredClone(event),hp:state.player.hp,cell:structuredClone(state.board[25]),phase:state.phase});});
  });
  const first=await game(page);await draw(page,[39,40,33],false);const miss=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(miss.valid).toBe(true);expect(miss.damage).toBe(0);await page.mouse.up();await ready(page);
  let s=await game(page);expect(s.player.hp).toBe(first.player.hp);expect(s.player.index).toBe(33);expect(s.board[25].behavior).toMatchObject({aggressive:true,restTurns:0});expect(s.board[25].intent.cells).not.toContain(33);
  expect(s.board[25].intent.cells.every((i:number)=>Math.abs(i%7-25%7)+Math.abs(Math.floor(i/7)-Math.floor(25/7))===1)).toBe(true);
  await page.screenshot({path:'artifacts/melee-prepared-after-miss.png',fullPage:true});
  const beforeHit=s.player.hp;await draw(page,[26,19,18],false);const hit=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(hit.damage).toBe(1);await page.mouse.up();await ready(page);
  s=await game(page);expect(s.player.hp).toBe(beforeHit-hit.damage);expect(s.board[25].behavior).toMatchObject({aggressive:false,restTurns:1});expect(s.board[25].intent.cells).toEqual([]);
  const timeline=await page.evaluate(()=>(window as any).__meleeCycle),windup=timeline.find((r:any)=>r.event.type==='attack'),impact=timeline.find((r:any)=>r.event.type==='damage'),recovery=timeline.find((r:any)=>r.event.type==='enemy-recovery');
  expect(windup).toBeTruthy();expect(windup.hp).toBe(beforeHit);expect(windup.cell.behavior.aggressive).toBe(true);expect(impact.hp).toBe(beforeHit-1);expect(recovery).toBeTruthy();expect(recovery.cell.behavior).toMatchObject({aggressive:false,restTurns:1});
  expect(timeline.indexOf(windup)).toBeLessThan(timeline.indexOf(impact));expect(timeline.indexOf(impact)).toBeLessThan(timeline.indexOf(recovery));
  await page.screenshot({path:'artifacts/melee-recovering.png',fullPage:true});
  await page.locator('#frost-button').click();const target=await center(page,25);await page.mouse.click(target.x,target.y);await expect.poll(async()=>(await game(page)).board[25].status.frozen).toBeGreaterThan(0);
  const frozen=(await game(page)).board[25].status.frozen,damageEvents=timeline.filter((r:any)=>r.event.type==='damage').length;
  for(let turn=0;turn<frozen;turn++){await page.locator('#wait-button').click();await ready(page);expect((await game(page)).board[25].behavior.restTurns).toBe(1);}
  await page.screenshot({path:'artifacts/melee-thawed-rest-preserved.png',fullPage:true});
  await page.locator('#wait-button').click();await ready(page);expect((await game(page)).board[25].behavior.restTurns).toBe(0);
  expect((await page.evaluate(()=>(window as any).__meleeCycle)).filter((r:any)=>r.event.type==='damage')).toHaveLength(damageEvents);
  await page.locator('[data-action="pause"]').click();await page.locator('[data-action="retry"]').click();await ready(page);expect(await game(page)).toEqual(initial);expect(errors).toEqual([]);
});

test('directional sentinel rejects frontal chains, allows a flank, and loses its shield while frozen',async({page})=>{
  test.setTimeout(45_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);
  // Isolated geometry fixture: front, flank and ice share identical HP, color and facing.
  const setup=async()=>page.evaluate(definition=>{
    const g=(window as any).__PUZZLE_GAME,e=g.engine;if(!e.startCustomLevel(definition))throw new Error('Clearing did not start');const s=e.state;
    const template=structuredClone(s.board.find((c:any)=>c?.kind==='melee'&&!c.variant));
    for(const c of s.board)if(c){c.intent={cells:[],damage:1,label:'Спокоен'};c.behavior={aggressive:false,restTurns:0};}
    if(s.player.index!==38)s.board[s.player.index]={...structuredClone(template),id:8000};
    s.player.index=38;s.board[38]=null;s.terrain[38]='floor';s.rotations=[];
    for(const index of [24,31,37,30,23]){s.terrain[index]=index===24?'puddle':'floor';s.board[index]={...structuredClone(template),id:8100+index,kind:'melee',variant:index===24?'sentinel':undefined,color:0,hp:index===24?4:0,maxHp:index===24?4:0,status:{wet:index===24,frozen:0,brittle:false},intent:{cells:[],damage:1,label:'Спокоен'},behavior:{aggressive:false,restTurns:0}};}
    s.board[24].shield={dx:0,dy:1};s.inventory.frost=1;s.itemPrepared=false;e.cancelChain();
  },clearing());
  await setup();await expect(page.locator('#shield-summary')).toContainText('D4 ↓');
  const baseline=await game(page);await draw(page,[31],false);const front=await center(page,24);await page.mouse.move(front.x,front.y,{steps:5});
  await expect.poll(async()=>(await game(page)).chain).toEqual([31]);await expect(page.locator('#status-message')).toContainText('Щит');
  // Since 04.10.2026 [31] alone is a hit: cancel the chain instead of releasing it.
  await page.screenshot({path:'artifacts/sentinel-front-rejected.png',fullPage:true});await page.keyboard.press('Escape');await page.mouse.up();await ready(page);
  expect((await game(page)).turn).toBe(baseline.turn);expect((await game(page)).board[24].hp).toBe(4);expect((await game(page)).player.energy).toBe(baseline.player.energy);
  await draw(page,[37,30,23,24],false);const flank=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(flank.valid).toBe(true);expect(flank.hits.at(-1)).toMatchObject({index:24,killed:true});
  await page.screenshot({path:'artifacts/sentinel-flank.png',fullPage:true});await page.mouse.up();await ready(page);expect((await game(page)).player.index).toBe(24);
  await setup();await page.locator('#frost-button').click();const wet=await center(page,24);await page.mouse.click(wet.x,wet.y);
  await expect.poll(async()=>(await game(page)).board[24].status.frozen).toBeGreaterThan(0);await expect(page.locator('#shield-summary')).toContainText('D4 ❄ щит снят');
  await draw(page,[31,24],false);expect((await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview())).valid).toBe(true);
  await page.screenshot({path:'artifacts/sentinel-frozen.png',fullPage:true});await page.mouse.up();await ready(page);expect((await game(page)).player.index).toBe(24);
  await setup();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/sentinel-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('rest earns half energy, resolves enemy attacks, unlocks jump, and respects the energy cap',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  const initial=await game(page);expect(initial.player.energy).toBe(0);await expect(page.locator('#wait-button')).toContainText('Отдых');
  await page.locator('#wait-button').click();await expect(page.locator('#wait-button')).toBeDisabled();
  // Even a programmatic click during the actual enemy phase cannot queue a second rest.
  await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#wait-button')!.click());await ready(page);
  const rested=await game(page);expect(rested.turn).toBe(initial.turn+1);expect(rested.player.energy).toBe(.5);expect(rested.player.hp).toBe(initial.player.hp);

  // Explicit fixture isolates one declared strike and the half-energy threshold.
  await page.evaluate(()=>{
    const g=(window as any).__PUZZLE_GAME,s=g.state;s.player.energy=1.5;s.rotations=[];
    for(const c of s.board)if(c){c.intent={cells:[],damage:1,label:'Спокоен'};c.behavior={aggressive:false,restTurns:0};}
    const enemy=g.engine.chainNeighbors(s.player.index).find((i:number)=>s.board[i]?.kind==='melee');s.board[enemy].intent={cells:[s.player.index],damage:1,label:'Замах'};s.board[enemy].behavior.aggressive=true;g.engine.cancelChain();
  });
  const beforeHit=await game(page);await expect(page.locator('#jump-ability')).toBeDisabled();await page.locator('#wait-button').click();await ready(page);
  const hit=await game(page);expect(hit.turn).toBe(beforeHit.turn+1);expect(hit.player.hp).toBe(beforeHit.player.hp-1);expect(hit.player.energy).toBe(2);await expect(page.locator('#jump-ability')).toBeEnabled();
  await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME,s=g.state;s.player.energy=7;s.rotations=[];for(const c of s.board)if(c)c.intent={cells:[],damage:1,label:'Спокоен'};g.engine.cancelChain();});
  const capped=await game(page);await page.locator('#wait-button').click();await ready(page);expect((await game(page)).player.energy).toBe(7);expect((await game(page)).turn).toBe(capped.turn+1);expect(errors).toEqual([]);
});

const center=async(page:Page,index:number)=>{await page.locator('#board-host').scrollIntoViewIfNeeded();return page.evaluate(i=>(window as any).__PUZZLE_GAME.gridToScreen(i),index);};
async function ready(page:Page) {
  await expect.poll(async()=>(await game(page)).phase).toBe('PLAYER_INPUT');
  await expect(page.locator('#board-host canvas')).toBeVisible();
}
function dense(state:any) {
  expect(state.board.filter(Boolean)).toHaveLength(39);
  const holes=state.terrain.flatMap((t:string,i:number)=>(t==='floor'||t==='puddle')&&i!==state.player.index&&!state.board[i]?[i]:[]);
  expect(holes).toEqual([]);expect(state.board[state.player.index]).toBeNull();
}
async function draw(page:Page,path:number[],release=true) {
  const first=await center(page,path[0]);await page.mouse.move(first.x,first.y);await page.mouse.down();
  for(const index of path.slice(1)){const p=await center(page,index);await page.mouse.move(p.x,p.y,{steps:5});}
  await expect.poll(async()=>(await game(page)).chain).toEqual(path);if(release)await page.mouse.up();
}
async function start(page:Page,definition:unknown=clearing()){await page.goto('/');await page.evaluate(d=>(window as any).__PUZZLE_GAME.startCustomLevel(d),definition);await ready(page);}
async function opening(page:Page){await draw(page,OPENING);await ready(page);dense(await game(page));}
async function chooseMove(page:Page){return page.evaluate(()=>{
  const g=(window as any).__PUZZLE_GAME,s=g.state;
  const targets=s.board.flatMap((c:any,i:number)=>c&&(c.kind==='ranged'||c.kind==='boss')?[i]:[]);
  return g.availableMoves().map((path:number[])=>{
    const p=g.preview(path),distance=targets.length?Math.min(...targets.map((i:number)=>Math.max(Math.abs(i%7-p.endIndex%7),Math.abs(Math.floor(i/7)-Math.floor(p.endIndex/7))))):0;
    const special=p.hits.reduce((v:number,h:any)=>v+h.damage*(s.board[h.index]?.kind==='boss'?12:s.board[h.index]?.kind==='ranged'?8:0),0);
    return {path,score:special+p.kills-p.damage*50-distance*2-(p.damage>=s.player.hp?10000:0)};
  }).sort((a:any,b:any)=>b.score-a.score)[0]?.path;
});}

test('input remains adjacent, reversible and safe across navigation, pause and restart',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  // Leaving for the menu while the battle is still opening must not leave input behind.
  await page.evaluate(definition=>{void (window as any).__PUZZLE_GAME.startCustomLevel(definition);document.querySelector<HTMLButtonElement>('[data-action="title"]')!.click();},clearing());
  await expect(page.locator('#title-screen')).toBeVisible();await expect(page.locator('#board-host canvas')).toBeAttached();await page.evaluate(d=>(window as any).__PUZZLE_GAME.startCustomLevel(d),clearing());await ready(page);
  await page.locator('[data-action="pause"]').click();await expect(page.locator('main')).toHaveAttribute('inert','');
  await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#wait-button')!.click());await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');expect((await game(page)).turn).toBe(0);
  if(await page.locator('#modal-layer').isVisible())await page.locator('#modal [data-action="resume"]').click();
  if(await page.locator('#title-screen').isVisible())await page.evaluate(d=>(window as any).__PUZZLE_GAME.startCustomLevel(d),clearing());await ready(page);
  const far=await center(page,1);await page.mouse.click(far.x,far.y);expect((await game(page)).chain).toEqual([]);
  // Since 04.10.2026 a single enemy is a hit: a selected one cancelled with Escape spends nothing.
  await draw(page,[44],false);await page.keyboard.press('Escape');await page.mouse.up();expect((await game(page)).turn).toBe(0);
  await draw(page,[44,37,36],false);const back=await center(page,37);await page.mouse.move(back.x,back.y,{steps:4});expect((await game(page)).chain).toEqual([44,37]);
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await page.mouse.up();await ready(page);
  await draw(page,[44,37],false);const wrong=await center(page,38);await page.mouse.move(wrong.x,wrong.y,{steps:4});expect((await game(page)).chain).toEqual([44,37]);
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.cancelChain());await page.mouse.up();
  await draw(page,OPENING,false);const end=await center(page,OPENING.at(-1)!),bounds=await page.locator('#board-host').boundingBox();await page.mouse.move(bounds!.x-12,end.y);await page.mouse.up();await ready(page);dense(await game(page));
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.damagePlayer(5));await expect.poll(async()=>(await game(page)).phase).toBe('LOSE');
  await page.locator('#modal [data-action="retry"]').first().click();await ready(page);expect((await game(page)).player).toMatchObject({index:45,hp:5});dense(await game(page));expect(errors).toEqual([]);
});

test('frost works on the observed wet enemy rather than a fixed archer spawn',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);await opening(page);
  const wetIndex=(await game(page)).board.findIndex((c:any)=>c?.status.wet);expect(wetIndex).toBeGreaterThanOrEqual(0);
  // The cardinal opening ends away from the puddle. Spend earned energy to
  // reach its neighbor before freezing; do not assume the old diagonal route.
  const landing=await page.evaluate(wet=>{const g=(window as any).__PUZZLE_GAME,e=g.engine,s=g.state;return e.chainNeighbors(wet).find((i:number)=>s.board[i]?.color!==s.board[wet].color&&e.previewAbility('jump',i).valid);},wetIndex);expect(landing).toBeDefined();
  await page.locator('#jump-ability').click();const jumpAt=await center(page,landing);await page.mouse.click(jumpAt.x,jumpAt.y);await ready(page);
  const wetId=(await game(page)).board[wetIndex].id;await page.locator('#frost-button').click();await page.keyboard.press('Escape');expect((await game(page)).inventory.frost).toBe(1);
  await page.locator('#frost-button').click();const wet=await center(page,wetIndex);await page.mouse.click(wet.x,wet.y);
  expect((await game(page)).board[wetIndex].status).toMatchObject({frozen:1,brittle:true});
  const path=await page.evaluate(i=>(window as any).__PUZZLE_GAME.availableMoves().filter((p:number[])=>p.includes(i)).sort((a:number[],b:number[])=>a.length-b.length)[0],wetIndex);expect(path).toBeTruthy();
  await draw(page,path,false);const preview=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());
  const ordinal=preview.hits.findIndex((h:any)=>h.index===wetIndex);expect(preview.hits[ordinal].damage).toBe(preview.hits[ordinal].availablePower*2);
  await page.screenshot({path:'artifacts/forest-frost.png',fullPage:true});await page.mouse.up();await ready(page);expect((await game(page)).board[wetIndex]?.id).not.toBe(wetId);dense(await game(page));expect(errors).toEqual([]);
});

// Isolated combat fixtures test partial boss hits and swap cancellation independently of seeded refill positions.
async function fixture(page:Page,kind:'boss'|'swap') {
  await page.evaluate(mode=>{
    const g=(window as any).__PUZZLE_GAME,e=g.engine,s=e.state,hero=11;
    s.board[s.player.index]=s.board[hero];s.board[hero]=null;s.player.index=hero;s.player.hp=5;s.turn=0;
    for(const cell of s.board)if(cell){cell.behavior={aggressive:false,restTurns:0};cell.intent={cells:[],damage:1,label:'Спокоен'};}
    if(mode==='boss'){const boss=s.board[10];Object.assign(boss,{kind:'boss',color:null,hp:6,maxHp:6});for(const index of [2,3,4,9])s.board[index].color=1;}
    else {const archer=s.board[20];Object.assign(archer,{kind:'ranged',hp:7,maxHp:7,color:0});archer.behavior.restTurns=1;for(const index of [12,13,18,19,27]){s.board[index].color=0;s.board[index].hp=0;s.board[index].maxHp=0;}archer.intent={cells:[],damage:1,label:'Обмен',moveTo:19,swapWithId:s.board[19].id};s.rotations=[{from:20,to:19,sourceId:archer.id,targetId:s.board[19].id,geometry:'cardinal'}];}
    e.cancelChain();
  },kind);dense(await game(page));
}
test('living chief blocks traversal and keeps damage between chains',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page,clearing([{key:'bossKills',target:1}],{10:{kind:'boss',color:null,hp:6}}));await fixture(page,'boss');
  await draw(page,[4,3,10],false);const beyond=await center(page,9);await page.mouse.move(beyond.x,beyond.y,{steps:5});expect((await game(page)).chain).toEqual([4,3,10]);
  const preview=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(preview.endsOnSurvivor).toBe(true);expect(preview.endIndex).toBe(3);expect(preview.hits.at(-1).hpAfter).toBe(3);
  await page.mouse.up();await ready(page);expect((await game(page)).board[10].hp).toBe(3);dense(await game(page));
  await draw(page,[2,9,10]);await expect.poll(async()=>(await game(page)).phase).toBe('WIN');expect(errors).toEqual([]);
});

test('resting archer exchanges two occupied identities and canceled exchange never creates an empty-cell step',async({page})=>{
  test.setTimeout(60_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Two archers on the clearing; a sturdy cat rests until one of them announces an exchange after its shot.
  const archers=clearing(undefined,{16:{kind:'ranged',hp:7},20:{kind:'ranged',hp:7}},20);
  await start(page,archers);await opening(page);
  await page.screenshot({path:'artifacts/forest-angry.png',fullPage:true});
  const swapping=async()=>(await game(page)).board.findIndex((c:any)=>c?.kind==='ranged'&&c.intent.swapWithId!==undefined);
  let rests=0;
  do{await page.locator('#wait-button').click();await ready(page);rests++;}while(rests<8&&await swapping()<0);
  const before=await game(page),source=before.board.findIndex((c:any)=>c?.kind==='ranged'&&c.intent.swapWithId!==undefined);expect(source).toBeGreaterThanOrEqual(0);
  const a=before.board[source],target=a.intent.moveTo,b=before.board[target];expect(b.id).toBe(a.intent.swapWithId);
  const coordinate=(index:number)=>`${String.fromCharCode(65+index%before.cols)}${Math.floor(index/before.cols)+1}`;
  await expect(page.locator('#intent-summary')).toContainText(`${coordinate(source)} ↔ ${coordinate(target)}`);
  await page.screenshot({path:'artifacts/forest-swap-preview.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/forest-swap-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.locator('#wait-button').click();await ready(page);const after=await game(page);expect(after.board[target].id).toBe(a.id);expect(after.board[source].id).toBe(b.id);expect(after.board[target].hp).toBe(a.hp);expect(after.board[source].hp).toBe(b.hp);dense(after);
  // Repeating public actions after restart must reproduce seeded intent choices.
  // Extra preview requests must not advance the selector's RNG or alter state.
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await ready(page);await opening(page);
  expect(await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME,before=JSON.stringify(g.state);for(let n=0;n<24;n++){const path=g.availableMoves()[0];g.preview(path);g.engine.previewRotations(path);}return JSON.stringify(g.state)===before;})).toBe(true);
  for(let n=0;n<rests;n++){await page.locator('#wait-button').click();await ready(page);}const replayed=await game(page);expect(replayed.board).toEqual(before.board);expect(replayed.rotations).toEqual(before.rotations);
  await page.locator('#wait-button').click();await ready(page);expect((await game(page)).board).toEqual(after.board);
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await ready(page);await fixture(page,'swap');
  const arranged=await game(page),archerId=arranged.board[20].id,partnerId=arranged.board[19].id;
  await draw(page,[12,19],false);await expect(page.locator('#intent-summary')).not.toContainText('G3');await page.screenshot({path:'artifacts/forest-swap-canceled.png',fullPage:true});await page.mouse.up();await ready(page);
  const canceled=await game(page);expect(canceled.player.index).toBe(19);expect(canceled.board[20].id).toBe(archerId);expect(canceled.board.some((c:any)=>c?.id===partnerId)).toBe(false);dense(canceled);expect(errors).toEqual([]);
});

test('an announced rotation survives its partner dying, is dropped when its source dies (04.10.2026) and cancels when the cat ends in the pair',async({page})=>{
  test.setTimeout(45_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  for(const mode of ['partner','source','hero'] as const){
    await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await ready(page);await fixture(page,'swap');
    await page.evaluate(()=>{
      const g=(window as any).__PUZZLE_GAME,e=g.engine,s=e.state;
      for(const index of [12,13,18,19,20,27]){s.board[index].color=0;s.board[index].hp=index===20?3:0;s.board[index].maxHp=s.board[index].hp;}
      (window as any).__swapUnsubscribe?.();
      (window as any).__swapEvents=[];
      (window as any).__swapUnsubscribe=e.subscribe((state:any,event:any)=>{if(event.type==='enemy-swap')(window as any).__swapEvents.push({event,from:structuredClone(state.board[event.from]),to:structuredClone(state.board[event.to]),hp:state.player.hp});});
      e.cancelChain();
    });
    const before=await game(page),source=before.board[20],partner=before.board[19];
    const path=mode==='partner'?[12,19,18]:mode==='source'?[12,13,20,27]:[12,19];
    await draw(page,path,false);
    const plans=await page.evaluate(()=>(window as any).__PUZZLE_GAME.engine.previewRotations());expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({from:20,to:19,active:mode==='partner'});
    if(mode==='source')expect(plans[0].reason).toBe('Объявивший обмен враг погиб.');
    if(mode!=='partner')await expect(page.locator('#intent-summary')).not.toContainText('Обмен:');
    else await expect(page.locator('#intent-summary')).toContainText('G3 ↔ F3');
    await page.screenshot({path:`artifacts/forest-rotation-${mode}-preview.png`,fullPage:true});
    await page.mouse.up();await ready(page);const after=await game(page),events=await page.evaluate(()=>(window as any).__swapEvents);
    if(mode==='hero'){
      expect(events).toHaveLength(0);expect(after.player.index).toBe(19);expect(after.board[19]).toBeNull();expect(after.board[20].id).toBe(source.id);
    }else if(mode==='source'){
      // A dead source does not act: no swap; the partner stays on F3, the source is gone.
      expect(events).toHaveLength(0);expect(after.board[19].id).toBe(partner.id);expect(after.board.some((c:any)=>c?.id===source.id)).toBe(false);
    }else{
      expect(events).toHaveLength(1);const swap=events[0];expect(swap.event).toMatchObject({from:20,to:19});expect(swap.hp).toBe(before.player.hp);
      if(mode==='partner'){
        expect(swap.to.id).toBe(source.id);expect(swap.to.hp).toBe(source.hp);expect(swap.from.id).not.toBe(partner.id);expect(swap.from).toMatchObject({kind:'melee',hp:0});
        expect(after.board[19].id).toBe(source.id);expect(after.board[20].id).toBe(swap.from.id);expect(after.board.some((c:any)=>c?.id===partner.id)).toBe(false);
      }else{
        expect(swap.from.id).toBe(partner.id);expect(swap.from.hp).toBe(partner.hp);expect(swap.to.id).not.toBe(source.id);expect(swap.to).toMatchObject({kind:'melee',hp:0});
        expect(after.board[20].id).toBe(partner.id);expect(after.board[19].id).toBe(swap.to.id);expect(after.board.some((c:any)=>c?.id===source.id)).toBe(false);
      }
    }
    dense(after);
  }
  expect(errors).toEqual([]);
});

test('mobile touch chaining starts on a completely filled board',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/');await page.evaluate(d=>(window as any).__PUZZLE_GAME.startCustomLevel(d),clearing());await ready(page);dense(await game(page));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.locator('#board-host').scrollIntoViewIfNeeded();const points=await Promise.all(OPENING.map(i=>center(page,i))),cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...points[0],id:1}]});for(const p of points.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});
  await expect.poll(async()=>(await game(page)).chain).toEqual(OPENING);await page.screenshot({path:'artifacts/forest-mobile.png',fullPage:true});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await ready(page);dense(await game(page));expect(errors).toEqual([]);await context.close();
});

test('ordinary chains earn energy while jump and spin spend energy without earning it',async({page})=>{
  test.setTimeout(60_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  expect((await game(page)).player.energy).toBe(0);for(const kind of ['jump','spin'])await expect(page.locator(`#${kind}-ability`)).toBeDisabled();
  await expect(page.locator('#rage-ability')).toHaveCount(0);
  await draw(page,OPENING);await ready(page);expect((await game(page)).player.energy).toBe(2);
  const afterOpening=await game(page),angry=afterOpening.board.flatMap((c:any,i:number)=>c?.kind==='melee'&&c.behavior.aggressive&&c.intent.cells.length?[{cell:c,index:i}]:[]);expect(angry.length).toBeGreaterThan(0);
  for(const {cell,index} of angry){for(const target of cell.intent.cells)expect(Math.abs(target%7-index%7)+Math.abs(Math.floor(target/7)-Math.floor(index/7))).toBe(1);}
  await page.locator('#jump-ability').click();const tree=await center(page,17);await page.mouse.click(tree.x,tree.y);expect((await game(page)).player.energy).toBe(2);expect((await game(page)).chosenAbility).toBe('jump');
  // The former range-five landing is rejected; the exact radius-three edge is valid.
  const distant=await center(page,9);await page.mouse.click(distant.x,distant.y);
  expect(await page.evaluate(()=>(window as any).__PUZZLE_GAME.engine.previewAbility('jump',9).valid)).toBe(false);
  expect((await game(page)).player).toMatchObject({index:33,energy:2});expect((await game(page)).turn).toBe(1);expect((await game(page)).chosenAbility).toBe('jump');
  const jump=await page.evaluate(()=>(window as any).__PUZZLE_GAME.engine.previewAbility('jump',12));expect(jump.valid).toBe(true);
  let landing=await center(page,12);await page.mouse.move(landing.x,landing.y,{steps:4});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await page.screenshot({path:'artifacts/abilities-jump-target.png',fullPage:true});
  await page.mouse.down();const bounds=await page.locator('#board-host').boundingBox();await page.mouse.move(bounds!.x+bounds!.width+20,landing.y);await page.mouse.up();expect((await game(page)).turn).toBe(1);expect((await game(page)).player.energy).toBe(2);
  await page.keyboard.press('Escape');expect((await game(page)).chosenAbility).toBeNull();await expect(page.locator('#modal-layer')).toBeHidden();
  await page.locator('#jump-ability').click();landing=await center(page,12);const hp=(await game(page)).player.hp;await page.mouse.click(landing.x,landing.y);await ready(page);
  expect((await game(page)).player).toMatchObject({index:12,energy:0,hp:hp-jump.damage});

  // Explicit local fixtures isolate the remaining ability costs and eight-cell geometry.
  await page.evaluate(()=>(window as any).__PUZZLE_GAME.restartLevel());await ready(page);
  await page.evaluate(()=>{
    const g=(window as any).__PUZZLE_GAME,s=g.state;s.board[s.player.index]=s.board[19];s.board[19]=null;s.player.index=19;s.player.energy=7;s.inventory.frost=1;s.rotations=[];
    for(const c of s.board)if(c){c.intent={cells:[],damage:1,label:'Спокоен'};c.behavior={aggressive:false,restTurns:0};}
    for(const i of [11,5,18]){s.board[i].color=0;s.board[i].hp=4;}g.engine.cancelChain();
  });
  await page.locator('#jump-ability').click();await page.locator('#frost-button').click();expect((await game(page)).chosenAbility).toBeNull();expect(await page.evaluate(()=>(window as any).__PUZZLE_GAME.itemTargeting)).toBe('frost');await page.keyboard.press('Escape');
  await draw(page,[18],false);await page.keyboard.press('Escape');await page.mouse.up();expect((await game(page)).turn).toBe(0);expect((await game(page)).player.energy).toBe(7);
  const spinFixture=await page.evaluate(()=>{
    const g=(window as any).__PUZZLE_GAME,s=g.state;s.board[s.player.index]=s.board[19];s.board[19]=null;s.player.index=19;s.objective.kills=0;s.rotations=[];
    for(const c of s.board)if(c){c.intent={cells:[],damage:1,label:'Спокоен'};c.behavior={aggressive:false,restTurns:0};}
    for(const i of g.engine.neighbors(19)){s.board[i].hp=i===11?6:4;s.board[i].maxHp=s.board[i].hp;}g.engine.cancelChain();return {survivor:s.board[11].id,preview:g.engine.previewAbility('spin')};
  });
  expect(spinFixture.preview.hits).toHaveLength(8);expect(spinFixture.preview.energyGain).toBe(0);for(const h of spinFixture.preview.hits)expect(h.damage).toBe(4);
  // Two steps (council item 21): the first press only shows the forecast, the second confirms.
  await page.locator('#spin-ability').click();expect((await game(page)).chosenAbility).toBe('spin');expect((await game(page)).player.energy).toBe(7);await page.locator('#spin-ability').click();await ready(page);const spun=await game(page);expect(spun.player.energy).toBe(4);expect(spun.player.index).toBe(19);expect(spun.board[11]).toMatchObject({id:spinFixture.survivor,hp:2});dense(spun);
  await page.evaluate(()=>{const g=(window as any).__PUZZLE_GAME;g.state.player.energy=6.5;g.engine.cancelChain();});
  const capPath=await chooseMove(page);await draw(page,capPath);await ready(page);expect((await game(page)).player.energy).toBe(7);expect(errors).toEqual([]);
});

test('forecast damage equals the executed damage across real mouse turns on a dense field',async({page})=>{
  test.setTimeout(60_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page,clearing(undefined,{16:{kind:'ranged',hp:7},20:{kind:'ranged',hp:7}},20));dense(await game(page));
  for(let turn=0;turn<10;turn++){
    const before=await game(page);if(before.phase!=='PLAYER_INPUT')break;
    const path=turn===0?OPENING:await chooseMove(page);expect(path).toBeTruthy();
    await draw(page,path,false);const preview=await page.evaluate(()=>(window as any).__PUZZLE_GAME.preview());expect(preview.valid).toBe(true);
    await page.mouse.up();await expect.poll(async()=>(await game(page)).phase).not.toMatch(/RESOLVE|UPDATE/);
    const after=await game(page);expect(after.player.hp).toBe(Math.max(0,before.player.hp-preview.damage));
    if(after.phase==='PLAYER_INPUT')dense(after);
  }
  expect(errors).toEqual([]);
});
