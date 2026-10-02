import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ForestEngine } from '../game/forestEngine';
import { JUMP_RANGE } from '../game/forestSystems';
import { occupiedIndices, footprintBounds } from '../game/entityFootprint';
import { meleeCanAttack } from '../game/enemyLifecycle';
import { archerStrikesCreatures, evaluateEnemyAttack } from '../game/enemyPhase';
import { chargeReady } from '../game/boarCharge';
import { enemyDefeatCountsForGoal, shieldBlocksEntry, shieldIsActive } from '../game/combatRules';
import { isCellAlive } from '../game/cellLife';
import type { LootKind, EngineEvent as ForestEvent, ForestState, ForestCell, ItemKind, AbilityKind } from '../game/forestTypes';
import { COLORS, PALE, ITEM_COLORS, makeEnemy, makePlayer, drawTerrain } from './art';
import { ITEMS } from '../game/items';
import { heroStrikeDamage } from '../game/elite';
import { loadCharacterArt } from './characterAssets';
import { deviceTargets } from '../game/devices';
import { drawStunStars } from './boarArt';
import { CAUSE_LABEL, DEATH_COLOR, PUSH_COLOR, drawArrowMark, drawBoarLane, drawChevron, drawClubZone, drawDashedTile, drawDeathCross, drawSpikedEdge } from './forecastArt';
import { drawThornRim } from './art';
import { SHAMAN_PERIOD, goblinTier, wolfHasPack, type BeastWorld } from '../game/forestBeasts';
import { QUILL, RITE } from './beastArt';
import { isResource, lootLabel, RESOURCES } from '../game/resources';

const TILE = 80;
const INK_RING = 0x172024;
export const ELITE_TIP='Элита: HP ×2, удар по коту +1; ближняя сближается с котом, дальняя отступает; оставляет добычу.';
/** Hover text of dropped loot: a consumable joins the inventory, a resource is kept by the run for crafting. */
const lootTip=(kind:LootKind)=>isResource(kind)?`${RESOURCES[kind].label}: ресурс на будущее (из двух — ${ITEMS[RESOURCES[kind].crafts].label.toLowerCase()} на привале, когда появится крафт). Пройди по нему цепью — он уйдёт в запас похода.`
  :`${ITEMS[kind].label}: ${ITEMS[kind].description} Пройди по нему цепью — предмет попадёт в запас.`;
interface Piece {
  view: Container; signature: string; index: number; born: number;
  motion?: { x:number; y:number; started:number; duration:number; curve?:number };
  strike?: { started:number; dx:number; dy:number };
  /** A crystal falling from above onto its cell in the middle of a chain; `crushed` when an enemy stood there. */
  drop?: { started:number; duration:number; crushed:boolean };
}
interface Particle { view: Graphics; vx: number; vy: number; life: number; max: number; stationary?: boolean; angular?:number }
interface Popup { view: Text; life: number }
interface Dying { view:Container; life:number; max:number; kind:string; dx:number; dy:number; bx:number; by:number; wait?:number }
interface ArrowProjectile { view:Graphics; startX:number; startY:number; targetX:number; targetY:number; life:number; max:number }

const NO_DISPLACED: ReadonlySet<number> = new Set();
/** An announced attack (or a boar charge) the engine would carry out against a hero standing on one of its cells. */
export function enemyReadyToAttack(cell: ForestCell | null | undefined, index: number, world?: BeastWorld): boolean {
  return !!cell && (chargeReady(cell, NO_DISPLACED) || cell.intent.cells.some(target => evaluateEnemyAttack(cell, index, target, world) !== null));
}

/** Pixi is presentation only; all selections and turn rules stay in ForestEngine. */
export class BoardRenderer {
  readonly app = new Application();
  private world = new Container();
  private ground = new Graphics();
  private deviceTargets = new Graphics();
  private deviceViews = new Container();
  private danger = new Graphics();
  private movement = new Graphics();
  private path = new Graphics();
  private pieces = new Container();
  private effects = new Container();
  private player = new Container();
  private endpoint = new Container();
  private hitLabels = new Container();
  private heroRing = new Graphics();
  private thornFrames = new Graphics();
  private edgeSpikes = new Graphics();
  private telegraph = new Graphics();
  private forecast = new Graphics();
  private endpointBack = new Graphics();
  private endpointText = new Text({text:'',style:{fontFamily:'Georgia, serif',fontSize:13,fontWeight:'bold',fill:PALE}});
  private views = new Map<number, Piece>();
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private arrowProjectiles:ArrowProjectile[]=[];
  private dying:Dying[]=[];
  private unsubscribe?: () => void;
  private resizeObserver?: ResizeObserver;
  private dragging = false;
  private activePointer: number | null = null;
  private jumpPress:number|null=null;
  private lastAbility:AbilityKind|null=null;
  private lastPointer: { x: number; y: number } | null = null;
  private invalidIndex = -1;
  private invalidUntil = 0;
  private elapsed = 0;
  private shake = 0;
  private playerTarget = { x: 0, y: 0 };
  private jumpMotion?:{from:{x:number;y:number};to:{x:number;y:number};started:number;duration:number};
  private spinUntil=0;
  private lastTurn = -1;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private viewportKey = '';
  private disposed = false;
  private initialized = false;
  private targetingItem:ItemKind|null = null;
  private targetHover = -1;
  /** Dropped consumables on the field by cell (kept until picked up: the engine clears the cell before its `collect` event). */
  private lootCells = new Map<number, LootKind>();
  /** Cells where an elite's loot just crushed an enemy (the landing shows the crush). */
  private lootCrushed = new Set<number>();
  private doorFocus:number|null=null;
  private terrainSignature = '';
  private active = true;
  onFrostTargetingChange?: (active: boolean) => void;
  onItemTargetingChange?: (item:ItemKind|null)=>void;
  onDoorFocus?: (index:number|null)=>void;
  get frostTargeting() { return this.targetingItem==='frost'; }
  get itemTargeting(){return this.targetingItem;}
  get focusedDoor(){return this.doorFocus;}
  /** Read-only snapshot of the chain-end label for tests (canvas text is not in the DOM). */
  get endpointLabel(){return{visible:this.endpoint.visible,text:this.endpointText.text,textWidth:this.endpointText.width,plateWidth:this.endpointBack.width};}
  /** Read-only snapshot of what the push forecast drew last time (canvas content is not in the DOM). */
  get forecastMarks(){return{...this.forecastDrawn,labels:[...this.forecastDrawn.labels]};}
  /** Captions drawn on the board by the last overlay pass (plates and labels); canvas text is not in the DOM. */
  get telegraphMarks(){return[...this.captions];}
  /** Cells whose enemy view carries the elite mark, and cells holding a dropped-item badge (tests and debugging). */
  get eliteMarks(){return[...this.views.values()].filter(piece=>piece.view.getChildByLabel('elite-mark')).map(piece=>piece.index).sort((a,b)=>a-b);}
  get lootMarks(){return[...this.lootCells.keys()].sort((a,b)=>a-b);}
  private captions:string[]=[];
  private forecastDrawn:{ghosts:number;chevrons:number;crosses:number;heroGhost:boolean;labels:string[]}={ghosts:0,chevrons:0,crosses:0,heroGhost:false,labels:[]};
  get ticking(){return this.initialized&&this.app.ticker.started;}
  private get boardWidth() { return this.engine.state.cols*TILE; }
  private get boardHeight() { return this.engine.state.rows*TILE; }

  setFrostTargeting(active:boolean) {
    this.setItemTargeting(active?'frost':null);
  }
  /** Show the engine's forecast of resting on the field while the pointer is over «Отдых». */
  setRestPreview(active:boolean){if(this.restPreviewOn!==active){this.restPreviewOn=active;if(this.initialized)this.drawOverlays(this.engine.state);}}
  private restPreviewOn=false;
  private scoreSeen=0;
  setItemTargeting(item:ItemKind|null){
    this.pointerCancel();
    if(item&&this.engine.state.chosenAbility)this.engine.setAbility(null);
    this.targetingItem=item && this.engine.state.phase==='PLAYER_INPUT' && this.engine.state.inventory[item]>0 && !this.engine.state.itemPrepared?item:null;
    this.targetHover=-1;this.focusDoor(null);
    this.onFrostTargetingChange?.(this.targetingItem==='frost');this.onItemTargetingChange?.(this.targetingItem);
    if(!this.initialized) return;
    this.drawOverlays(this.engine.state);
    this.app.canvas.style.cursor=this.targetingItem?'cell':this.engine.state.phase==='PLAYER_INPUT'?'crosshair':'default';
  }
  private focusDoor(index:number|null){
    const next=index!==null&&this.engine.state.board[index]?.kind==='door'?index:null;
    if(next!==this.doorFocus){this.doorFocus=next;this.onDoorFocus?.(next);}
  }

  constructor(private mount: HTMLElement, private engine: ForestEngine) {}

  async init(): Promise<void> {
    await this.app.init({ width: this.boardWidth, height: this.boardHeight, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
    await loadCharacterArt();
    this.player=makePlayer();
    this.initialized=true;
    this.app.canvas.setAttribute('aria-label', 'Поле боя. Начните цепочку с врага рядом с котом; двери соединяются с цепью.');
    this.app.canvas.setAttribute('role', 'img');
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.userSelect = 'none';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.ground, this.deviceTargets, this.danger, this.movement, this.path, this.deviceViews, this.heroRing, this.pieces, this.thornFrames, this.edgeSpikes, this.telegraph, this.player, this.forecast, this.hitLabels, this.effects, this.endpoint);
    this.endpoint.addChild(this.endpointBack,this.endpointText);
    this.endpointText.anchor.set(0.5);
    this.drawGround();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount); this.resize();
    this.app.canvas.addEventListener('pointerdown', this.pointerDown);
    this.app.canvas.addEventListener('pointermove', this.pointerMove);
    this.app.canvas.addEventListener('pointerup', this.pointerUp);
    this.app.canvas.addEventListener('pointercancel', this.pointerCancel);
    this.app.canvas.addEventListener('pointerleave', this.pointerLeave);
    this.app.canvas.addEventListener('lostpointercapture', this.pointerCancel);
    window.addEventListener('blur', this.pointerCancel);
    window.addEventListener('keydown', this.keyDown);
    this.unsubscribe = this.engine.subscribe((state,event) => this.sync(state,event));
    this.sync(this.engine.state,{type:'state'});
    this.app.ticker.add(ticker => this.tick(ticker.deltaMS));
    this.setActive(this.active);
  }

  /** Stop drawing while the board is hidden (title, editor); state still syncs from engine events. */
  setActive(active: boolean) {
    this.active = active;
    if (!this.initialized || this.disposed) return;
    if (active) this.app.start(); else this.app.stop();
  }

  gridToScreen(x: number, y: number): { x: number; y: number } {
    this.resize();
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: rect.left + this.offset.x + (x + 0.5) * TILE * this.scale, y: rect.top + this.offset.y + (y + 0.5) * TILE * this.scale };
  }

  private resize() {
    if (this.disposed) return;
    const width = this.mount.clientWidth || this.boardWidth;
    const height = this.mount.clientHeight || width * this.engine.state.rows / this.engine.state.cols;
    const key=`${width}/${height}/${this.boardWidth}/${this.boardHeight}`;
    if(key===this.viewportKey) return;
    this.viewportKey=key;
    this.app.renderer.resize(width,height);
    this.scale = Math.min(width / this.boardWidth,height / this.boardHeight);
    this.offset = { x: (width-this.boardWidth*this.scale)/2, y: (height-this.boardHeight*this.scale)/2 };
    this.world.scale.set(this.scale); this.world.position.set(this.offset.x,this.offset.y);
  }

  /** Presentation timing follows the engine's animation scale (never below a short beat), and is never awaited. */
  private dur(milliseconds:number){return milliseconds*Math.max(.25,this.engine.animationScale);}
  private center(index: number) { return {x:(index%this.engine.state.cols+0.5)*TILE,y:(Math.floor(index/this.engine.state.cols)+0.5)*TILE}; }
  private entityCenter(cell:ForestCell|null|undefined,index:number){
    if(!cell)return this.center(index);
    const bounds=footprintBounds(occupiedIndices(cell,index),this.engine.state.cols);
    return bounds?{x:bounds.centerCol*TILE,y:bounds.centerRow*TILE}:this.center(index);
  }

  private drawGround() {
    const g = this.ground.clear(),state=this.engine.state;
    g.roundRect(0,0,this.boardWidth,this.boardHeight,8).fill(0x203025);
    for(let y=0;y<state.rows;y++) for(let x=0;x<state.cols;x++) {
      const px=x*TILE,py=y*TILE;
      const shade=(x+y)%2===0?0x394234:0x333d30;
      g.roundRect(px+3,py+4,74,74,5).fill(0x17251d);
      g.poly([px+5,py+5,px+73,py+5,px+76,py+10,px+75,py+69,px+69,py+75,px+5,py+74]).fill(shade);
      g.moveTo(px+7,py+73).lineTo(px+6,py+7).lineTo(px+71,py+7).stroke({color:0x647070,alpha:0.17,width:1});
      g.moveTo(px+73,py+13).lineTo(px+73,py+70).lineTo(px+14,py+72).stroke({color:0x101719,alpha:0.45,width:2});
      // Deterministic chips and stone grain, built once.
      for(let n=0;n<8;n++) {
        const sx=px+10+((x*37+y*19+n*23)%59),sy=py+12+((y*31+x*11+n*37)%55);
        g.rect(sx,sy,1+(n%3),1).fill({color:n%2?0x9ca8a1:0x11191b,alpha:0.15});
      }
      if((x*3+y)%5===0) g.moveTo(px+5,py+48).lineTo(px+13,py+43).lineTo(px+12,py+34).stroke({color:0x111819,alpha:0.5,width:1});
      drawTerrain(g,state.terrain[x+y*state.cols]??'floor',px+TILE/2,py+TILE/2);
    }
    g.roundRect(1,1,this.boardWidth-2,this.boardHeight-2,7).stroke({color:0xb9a270,alpha:0.4,width:2});
    // Spiked board sides are drawn above the pieces so an occupied edge cell still shows them.
    const teeth=this.edgeSpikes.clear();
    for(const side of state.customLevel?.definition.spikedEdges??[])drawSpikedEdge(teeth,side,this.boardWidth,this.boardHeight,TILE);
  }

  private sync(state: ForestState,event: ForestEvent) {
    if(this.disposed) return;
    if(state.chosenAbility!==this.lastAbility){this.lastAbility=state.chosenAbility;this.pointerCancel();this.targetHover=-1;}
    const now=performance.now();
    const terrainKey=`${state.cols}/${state.rows}/${state.terrain.join(',')}/${state.customLevel?.definition.spikedEdges?.join(',')??''}`;
    if(terrainKey!==this.terrainSignature) {this.terrainSignature=terrainKey;this.drawGround();this.resize();}
    const alive=new Set<number>();
    state.board.forEach((cell,index) => {
      if(!cell || alive.has(cell.id)) return;
      alive.add(cell.id);
      const tutorialTarget=state.tutorial?.targetIds.includes(cell.id) ?? false;
      const signature=`${index}/${cell.kind}/${cell.variant}/${cell.footprint}/${JSON.stringify(cell.shield)}/${JSON.stringify(cell.door)}/${cell.color}/${cell.hp}/${cell.maxHp}/${cell.defeated}/${cell.countdown}/${cell.intent.cells.join('.')}/${cell.intent.moveTo}/${cell.intent.swapWithId}/${cell.behavior.aggressive}/${cell.behavior.passive}/${cell.behavior.restTurns}/${tutorialTarget}/${cell.status.wet}/${cell.status.frozen}/${cell.status.brittle}/${cell.attackEffect}/${cell.elite}/${cell.loot}/${JSON.stringify(cell.damageEffects)}/${cell.variant==='wolf'||cell.variant==='shaman'||cell.variant==='porcupine'||cell.variant==='troll'?`${cell.intent.label}/${cell.intent.empowerCells?.join('.')}`:''}`;
      let piece=this.views.get(cell.id);
      const oldMotion=piece?.motion,oldIndex=piece?.index;
      const oldBorn=piece?.born;
      if(piece && piece.signature!==signature) { piece.view.destroy({children:true}); this.views.delete(cell.id); piece=undefined; }
      if(!piece) {
        const view=makeEnemy(cell,index,state.cols,tutorialTarget); this.pieces.addChild(view);
        piece={view,signature,index,born:oldBorn??now,motion:oldMotion}; this.views.set(cell.id,piece);
      }
      piece.index=index;
      // Pushed loot moves: forget its previous cell.
      if(cell.kind==='prism'){if(oldIndex!==undefined&&oldIndex!==index)this.lootCells.delete(oldIndex);if(cell.loot)this.lootCells.set(index,cell.loot);else this.lootCells.delete(index);}
      if((event.type==='crystal'||event.type==='loot')&&event.newId===cell.id&&!piece.drop){const pos=this.entityCenter(cell,index);piece.view.position.set(pos.x,pos.y-240);piece.drop={started:now,duration:this.dur(240),crushed:event.oldId!==undefined||this.lootCrushed.delete(index)};}
      // A boar shift moves whole rows one cell: each pushed body slides from its previous cell.
      if(event.type==='push'&&oldIndex!==undefined&&oldIndex!==index&&!cell.footprint){
        const from=this.center(oldIndex);piece.motion={x:from.x,y:from.y,started:now,duration:this.dur(85)};piece.view.position.set(from.x,from.y);
      }
      if(event.type==='enemy-swap' && event.from!==undefined && event.to!==undefined && (event.to===index || event.from===index)) {
        // Both identities have already exchanged grid positions atomically.
        // Animate reciprocal arcs together, keeping each enemy's original art/HP.
        const from=this.center(index===event.to?event.from:event.to);
        piece.motion={x:from.x,y:from.y,started:now,duration:280,curve:16};
        piece.view.position.set(from.x,from.y);
      } else if(!piece.motion) {const pos=this.entityCenter(cell,index);piece.view.position.set(pos.x,pos.y);}
    });
    for(const [id,piece] of this.views) if(!alive.has(id)) {
      const cause=this.deathCause(event,state);
      // Boar rams, spikes, thorns, pits and arrows show the victim's last moments instead of a silent removal.
      if(cause&&event.index===piece.index)this.startDying(piece,cause,event,state);else piece.view.destroy({children:true});
      this.views.delete(id);
    }
    const target=this.center(state.player.index); this.playerTarget=target;
    if((state.turn===0 && this.lastTurn>0) || event.type==='start' || event.type==='restart') {
      this.lootCells.clear();this.lootCrushed.clear();
      this.player.position.set(target.x,target.y);
      this.jumpMotion=undefined;this.spinUntil=0;this.player.scale.set(1);
      const pointer=this.activePointer;
      this.dragging=false;this.activePointer=null;this.lastPointer=null;
      if(pointer!==null && this.app.canvas.hasPointerCapture(pointer)) this.app.canvas.releasePointerCapture(pointer);
      this.targetingItem=null;this.targetHover=-1;this.onFrostTargetingChange?.(false);this.onItemTargetingChange?.(null);this.focusDoor(null);
      for(const victim of this.dying)victim.view.destroy({children:true});this.dying=[];
    }
    this.lastTurn=state.turn;
    if((state.phase!=='PLAYER_INPUT'||state.chosenAbility) && this.targetingItem) {this.targetingItem=null;this.targetHover=-1;this.onFrostTargetingChange?.(false);this.onItemTargetingChange?.(null);}
    this.player.visible=state.phase!=='TITLE';
    this.drawDevices(state);
    this.drawOverlays(state);
    this.app.canvas.style.cursor=this.targetingItem||state.chosenAbility==='jump'?'cell':state.chosenAbility==='spin'?'pointer':state.phase==='PLAYER_INPUT'?'crosshair':'default';
    this.react(event,state);
  }

  private deathCause(event:ForestEvent,state:ForestState):string|null{
    if(event.type!=='hit'&&event.type!=='kill')return null;
    if(event.type==='kill'&&(event.text==='crystal'||event.text==='loot'))return 'crystal';
    if(event.text&&['ram','spikes','thorns','pit'].includes(event.text))return event.text;
    const source=event.from!==undefined?state.board[event.from]:null;
    return event.type==='hit'&&source&&archerStrikesCreatures(source)?'arrow':null;
  }
  private startDying(piece:Piece,kind:string,event:ForestEvent,state:ForestState){
    let dx=0,dy=0;const index=piece.index,cols=state.cols,x=index%cols,y=Math.floor(index/cols);
    if(kind==='spikes'){
      const sides=state.customLevel?.definition.spikedEdges??[];
      if(y===0&&sides.includes('top'))dy=-1;else if(y===state.rows-1&&sides.includes('bottom'))dy=1;else if(x===0&&sides.includes('left'))dx=-1;else if(x===cols-1&&sides.includes('right'))dx=1;else dy=1;
    }else if(kind==='ram'&&event.from!==undefined){
      const a=this.center(event.from),b=this.center(index),len=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));dx=(b.x-a.x)/len;dy=(b.y-a.y)/len;
    }
    const view=piece.view,max=this.dur(kind==='pit'?380:kind==='crystal'?200:340);
    this.effects.addChild(view);
    // The crystal is still falling when the engine publishes the kill: the victim stands until it lands.
    this.dying.push({view,life:max,max,kind,dx,dy,bx:view.x,by:view.y,...(kind==='crystal'?{wait:this.dur(240)}:{})});
    if(kind==='spikes'){this.burst(index,0xd6503f,10);this.burst(index,0xd8d2c0,6);}
    if(kind==='arrow')this.burst(index,0xe8c888,10);
  }

  private drawDevices(state: ForestState) {
    const targets=this.deviceTargets.clear();
    this.deviceViews.removeChildren().forEach(child=>child.destroy({children:true}));
    for(const device of state.devices??[]) {
      const at=this.center(device.index),active=device.charges>0;
      const tint=device.kind==='pits'?0xb9a6e3:device.kind==='arrows'?0xe9c37c:0xf39b60;
      if(device.kind==='pits') for(const index of device.targets) {
        if(state.pits?.some(pit=>pit.index===index))continue;
        const end=this.center(index), queued=active&&state.chain.includes(device.index);
        targets.roundRect(end.x-36,end.y-36,72,72,5).fill({color:0x302a48,alpha:queued?.3:.08}).stroke({color:queued?0xffaa91:tint,width:queued?3:2,alpha:active?.95:.25});
        for(const side of [-1,1])targets.moveTo(end.x+side*33,end.y-28).lineTo(end.x+side*23,end.y-18).moveTo(end.x+side*33,end.y+28).lineTo(end.x+side*23,end.y+18);
        targets.stroke({color:queued?0xffaa91:tint,width:3,alpha:active?.95:.25});
      }
      if(device.kind==='arrows') for(const index of deviceTargets(state, device)) {
        const end=this.center(index);
        targets.moveTo(at.x,at.y).lineTo(end.x,end.y).stroke({color:tint,width:1.5,alpha:active?.4:.15});
        const dangerTint=0xef947e;
        targets.roundRect(end.x-35,end.y-35,70,70,5).fill({color:dangerTint,alpha:active?.08:.025}).stroke({color:dangerTint,width:2,alpha:active?.8:.3});
        targets.moveTo(end.x-11,end.y).lineTo(end.x-4,end.y).moveTo(end.x+4,end.y).lineTo(end.x+11,end.y)
          .moveTo(end.x,end.y-11).lineTo(end.x,end.y-4).moveTo(end.x,end.y+4).lineTo(end.x,end.y+11)
          .stroke({color:dangerTint,width:2,alpha:active?.9:.35});
      }
      if(state.pits?.some(pit=>pit.index===device.index))continue;
      const fixture=new Container();fixture.position.set(at.x,at.y);
      const base=new Graphics().roundRect(-28,-28,56,56,9).fill(0x262c2a).stroke({color:tint,width:2,alpha:active?1:.4});
      if(device.kind==='arrows'||device.kind==='pits') {
        if(device.kind==='pits')base.poly([-17,18,0,10,17,18,0,26]).fill(0x101222).stroke({color:tint,width:2});
        base.moveTo(-18,18).lineTo(16,-15).stroke({color:tint,width:5,alpha:active?1:.4});
        base.circle(17,-17,6).fill(tint);
        base.moveTo(-19,-18).lineTo(-19,12).lineTo(-12,18).stroke({color:0x9caa9b,width:3});
      } else {
        base.moveTo(-18,10).lineTo(-12,20).lineTo(12,20).lineTo(18,10).stroke({color:0xc4a17b,width:4});
        base.poly([-12,4,-4,-17,1,-6,9,-19,13,3,5,12]).fill({color:tint,alpha:active?1:.35});
      }
      const charge=new Text({text:String(device.charges),style:{fontFamily:'Arial, sans-serif',fontSize:13,fontWeight:'bold',fill:active?0xffedc2:0xadb0a5,stroke:{color:0x171d19,width:3}}});
      charge.anchor.set(1,1);charge.position.set(31,32);fixture.addChild(base,charge);this.deviceViews.addChild(fixture);
    }
    for(const pit of state.pits??[]) {
      const at=this.center(pit.index);
      targets.roundRect(at.x-36,at.y-36,72,72,6).fill(0x090e1b).stroke({color:0xa491cc,width:3});
      targets.poly([at.x-33,at.y-32,at.x+33,at.y-32,at.x+24,at.y-20,at.x-23,at.y-20]).fill(0x443e61);
      targets.poly([at.x-33,at.y-32,at.x-23,at.y-20,at.x-23,at.y+24,at.x-33,at.y+32]).fill(0x2c2944);
      targets.moveTo(at.x-8,at.y-7).lineTo(at.x,at.y+3).lineTo(at.x+8,at.y-7).stroke({color:0xb9a6e3,width:3});
      const timer=new Text({text:'1 ход',style:{fontFamily:'Arial, sans-serif',fontSize:10,fill:0xc9bfdf}});
      timer.anchor.set(.5);timer.position.set(at.x,at.y+23);this.deviceViews.addChild(timer);
    }
  }

  private drawOverlays(state: ForestState) {
    const d=this.danger.clear(),m=this.movement.clear(),p=this.path.clear(),tg=this.telegraph.clear(),fc=this.forecast.clear();
    this.forecastDrawn={ghosts:0,chevrons:0,crosses:0,heroGhost:false,labels:[]};
    this.heroRing.clear();
    // Thorns under an occupant stay visible as a rim above it: the shape marks the ground, the fill color stays the enemy's.
    const rim=this.thornFrames.clear();
    state.terrain.forEach((kind,index)=>{if(kind==='thorns'&&(state.board[index]||index===state.player.index)){const at=this.center(index);drawThornRim(rim,at.x,at.y,.95);}});
    this.hitLabels.removeChildren().forEach(child=>child.destroy());
    this.captions=[];
    const chain=state.chain;
    const preview=this.engine.preview();
    const killed=new Set([...preview.hits, ...(preview.trapHits ?? [])].filter(hit=>hit.killed).map(hit=>hit.index));
    // The engine already folds a winning blow into completesRoom and lethal damage into playerDies.
    const endsEncounter=preview.valid && (preview.completesRoom || !!preview.playerDies);
    // These are engine-authored fixed intent cells, never a guessed new target.
    let restForecast:ReturnType<ForestEngine['previewRest']>|undefined;
    const telegraphed=new Set<number>();
    state.board.forEach((cell,i)=>{
      if(!cell || telegraphed.has(cell.id) || cell.status.frozen || occupiedIndices(cell,i).some(part=>killed.has(part)) || endsEncounter) return;
      telegraphed.add(cell.id);
      const origin=this.entityCenter(cell,i);
      if(cell.variant==='shaman'&&cell.intent.empowerIds?.length){
        // Announced rite: the goblins it will raise one step. IDs were fixed at the announcement; a target the chain kills is dropped.
        for(const id of cell.intent.empowerIds){
          const target=state.board.findIndex(other=>other?.id===id);
          if(target<0||killed.has(target))continue;
          const at=this.center(target),tier=goblinTier(state.board[target]);
          tg.moveTo(origin.x,origin.y).lineTo(at.x,at.y).stroke({color:RITE,width:2.5,alpha:.6});
          tg.roundRect(at.x-35,at.y-35,70,70,8).stroke({color:INK_RING,width:6,alpha:.6});
          tg.roundRect(at.x-35,at.y-35,70,70,8).stroke({color:RITE,width:3});
          tg.poly([at.x+26,at.y-18,at.x+33,at.y-8,at.x+29,at.y-8,at.x+29,at.y-1,at.x+23,at.y-1,at.x+23,at.y-8,at.x+19,at.y-8]).fill(0xe6d0ff).stroke({color:0x2c1d45,width:1.5});
          if(!chain.length)this.label(at.x,at.y-25,tier==='weak'?'↑ СТАНЕТ\nВООРУЖЁН':'↑ СТАНЕТ\nКРЕПКИМ',0xe6d0ff,9);
        }
        return;
      }
      if(cell.variant==='troll'){
        // Club zone from the engine's intent: windup is a contour a turn ahead, the raised club fills the zone.
        if(cell.intent.cells.length&&cell.behavior.restTurns===0){
          const raised=!!cell.behavior.club?.raised,zone=cell.intent.cells.map(target=>this.center(target));
          drawClubZone(tg,zone,raised);
          const mid={x:(Math.min(...zone.map(z=>z.x))+Math.max(...zone.map(z=>z.x)))/2,y:(Math.min(...zone.map(z=>z.y))+Math.max(...zone.map(z=>z.y)))/2};
          this.label(mid.x,mid.y,raised?`УДАР ${cell.intent.damage}`:'ЗАМАХ',raised?0xffe2c4:0xf0c9a4,raised?13:11);
        }
        return;
      }
      if(cell.variant==='boar'){
        // Charge lane: a heavy amber corridor above the pieces. The archer's line is a thin arrow with corner brackets.
        if(cell.intent.charge&&chargeReady(cell,NO_DISPLACED)){
          const {dx,dy}=cell.intent.charge;
          drawBoarLane(tg,origin,cell.intent.cells.map(target=>this.center(target)),dx,dy);
          // Two different things in one ram, from the engine's forecast of doing nothing (previewRest): the body the boar
          // actually rams takes «УДАР», the bodies it pushes get «ТОЛЧОК».
          if(!chain.length){
            const phase=(restForecast??=this.engine.previewRest()).enemyPhase,ram=phase?.rams.find(entry=>entry.boarId===cell.id);
            if(ram){const head=this.center(ram.index);this.plate(head.x,head.y-27,ram.shielded?'ЩИТ ДЕРЖИТ':`УДАР ${ram.damage||heroStrikeDamage(cell)}`,ram.shielded?0x27435f:0x742e30,ram.shielded?0x9cc3ec:0xf0a082,10);}
            for(const move of phase?.moves??[]){
              if(move.id===0||move.id===cell.id||move.id===ram?.id)continue;
              const spot=this.center(move.from);this.plate(spot.x,spot.y-27,'ТОЛЧОК',0x2b4a5a,0xa9d4e8,9);
            }
          }
        }
        return;
      }
      for(const target of cell.intent.cells) {
        if(cell.kind==='melee'&&!meleeCanAttack(cell))continue;
        const at=this.center(target),heavy=cell.kind==='boss';
        d.roundRect(at.x-36,at.y-36,72,72,4).fill({color:heavy?0xcd6b44:0xc36b48,alpha:heavy?0.2:0.12});
        d.moveTo(at.x-33,at.y-22).lineTo(at.x-33,at.y-33).lineTo(at.x-22,at.y-33).moveTo(at.x+33,at.y+22).lineTo(at.x+33,at.y+33).lineTo(at.x+22,at.y+33).stroke({color:0xf1aa73,width:2,alpha:0.85});
        if(archerStrikesCreatures(cell)&&!cell.behavior.restTurns){
          // The arrow strikes every creature on the announced cells, not only the cat.
          const occupant=state.board[target];
          if(occupant&&occupant!==cell&&occupant.kind!=='door'&&occupant.kind!=='prism'&&isCellAlive(occupant)&&!killed.has(target))drawArrowMark(tg,{x:at.x+29,y:at.y});
        }
        if(cell.kind==='ranged') this.arrow(d,origin,at,0xe7a36a,0.75,2);
        if(heavy) d.moveTo(at.x-22,at.y-22).lineTo(at.x+22,at.y+22).moveTo(at.x+22,at.y-22).lineTo(at.x-22,at.y+22).stroke({color:0xecaa87,width:1,alpha:0.2});
        if(cell.variant==='jailer')this.label(at.x,at.y,`УДАР ${cell.intent.damage}`,0xffe2c4,11);
      }
    });
    // Wolf pack: a link between neighbouring wolves that arm each other. The engine's own wolfHasPack decides on a board with just the pair.
    if(!endsEncounter){
      const wolves=state.board.flatMap((cell,index)=>cell?.variant==='wolf'&&isCellAlive(cell)&&!cell.behavior.passive&&!killed.has(index)?[{cell,index}]:[]);
      for(let a=0;a<wolves.length;a++)for(let b=a+1;b<wolves.length;b++){
        const first=wolves[a],second=wolves[b];
        if(Math.abs(first.index%state.cols-second.index%state.cols)>1||Math.abs(Math.floor(first.index/state.cols)-Math.floor(second.index/state.cols))>1)continue;
        const board=state.board.map(()=>null) as (ForestCell|null)[];board[first.index]=first.cell;board[second.index]=second.cell;
        const world:BeastWorld={cols:state.cols,rows:state.rows,terrain:state.terrain,pits:state.pits,board};
        if(!wolfHasPack(world,first.index))continue;
        const from=this.center(first.index),to=this.center(second.index),mid={x:(from.x+to.x)/2,y:(from.y+to.y)/2};
        tg.moveTo(from.x,from.y).lineTo(to.x,to.y).stroke({color:INK_RING,width:8,alpha:.7,cap:'round'});
        tg.moveTo(from.x,from.y).lineTo(to.x,to.y).stroke({color:0xf0b56a,width:4,cap:'round'});
        tg.poly([mid.x,mid.y-7,mid.x+7,mid.y,mid.x,mid.y+7,mid.x-7,mid.y]).fill(0xf0b56a).stroke({color:INK_RING,width:2});
      }
    }
    // Jailer and shaman timers in words: which entry is shut, when the blow or the rite comes, when to strike.
    if(!endsEncounter){
      const shown=new Set<number>();
      state.board.forEach((cell,index)=>{
        if(!cell||shown.has(cell.id)||killed.has(index)||!isCellAlive(cell))return;
        if(cell.variant==='jailer'&&cell.shield){
          shown.add(cell.id);
          const at=this.entityCenter(cell,index);
          if(shieldIsActive(cell)){
            const {dx,dy}=cell.shield;
            // Entries the engine rejects (shieldBlocksEntry) are hatched; the shield itself is a heavy bar on the jailer's edge.
            for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
              const fx=index%state.cols+x,fy=Math.floor(index/state.cols)+y;
              if((!x&&!y)||fx<0||fx>=state.cols||fy<0||fy>=state.rows)continue;
              const from=fy*state.cols+fx;
              if(!shieldBlocksEntry(state,cell,from,index))continue;
              const spot=this.center(from);
              tg.roundRect(spot.x-34,spot.y-34,68,68,6).fill({color:0x6f9fd0,alpha:.16}).stroke({color:0x9cc3ec,width:2,alpha:.85});
              for(let n=-1;n<=1;n++)tg.moveTo(spot.x-28+n*20,spot.y+28).lineTo(spot.x+8+n*20,spot.y-28).stroke({color:0xc7defa,width:2,alpha:.4});
              this.label(spot.x,spot.y+27,'ВХОД ЗАКРЫТ',0xcfe4fb,8);
            }
            const bx=at.x+dx*36,by=at.y+dy*36,px=dy?18:0,py=dx?18:0;
            tg.moveTo(bx-px*1.8,by-py*1.8).lineTo(bx+px*1.8,by+py*1.8).stroke({color:INK_RING,width:11,cap:'round',alpha:.8});
            tg.moveTo(bx-px*1.8,by-py*1.8).lineTo(bx+px*1.8,by+py*1.8).stroke({color:0x9cc3ec,width:6,cap:'round'});
            this.plate(at.x,at.y-42,`ЩИТ ${dy>0?'СНИЗУ':dy<0?'СВЕРХУ':dx>0?'СПРАВА':'СЛЕВА'} · ${cell.intent.cells.length?'УДАР ПОСЛЕ ХОДА':'ЖДЁТ'}`,0x27435f,0x9cc3ec,9);
          }else{
            this.plate(at.x,at.y-42,cell.status.frozen?'ЗАМОРОЖЕН · ЩИТ ОПУЩЕН':`ЩИТ ОПУЩЕН · БЕЙ СЕЙЧАС${cell.behavior.restTurns>1?` (ещё ${cell.behavior.restTurns})`:''}`,0x2e5a3a,0xb6e5a0,9,0xe4ffd8);
          }
        }
        if(cell.variant==='shaman'&&!chain.length){
          shown.add(cell.id);
          const at=this.center(index),announced=cell.intent.empowerIds?.length??0;
          this.plate(at.x,at.y+30,cell.status.frozen?'КАМЛАНИЯ НЕТ · ЛЁД':announced?'КАМЛАНИЕ ПОСЛЕ ХОДА':`КАМЛАНИЕ ЧЕРЕЗ ${SHAMAN_PERIOD-(cell.behavior.cycle??0)%SHAMAN_PERIOD} ХОД.`,0x3d2c5a,RITE,8,0xeadfff);
        }
      });
    }
    // The engine forecasts declared cell pairs, including replacement residents.
    // A killed initiator or partner therefore keeps its announced exchange.
    for(const rotation of preview.rotations) {
      if(rotation.active) {
        const origin=this.center(rotation.from),destination=this.center(rotation.to),teal=0x85d7ce;
        for(const end of [origin,destination]) {
          m.roundRect(end.x-36,end.y-36,72,72,7).fill({color:teal,alpha:0.07});
          for(let offset=-28;offset<=21;offset+=14) {
            m.moveTo(end.x+offset,end.y-35).lineTo(end.x+offset+8,end.y-35);
            m.moveTo(end.x+offset,end.y+35).lineTo(end.x+offset+8,end.y+35);
            m.moveTo(end.x-35,end.y+offset).lineTo(end.x-35,end.y+offset+8);
            m.moveTo(end.x+35,end.y+offset).lineTo(end.x+35,end.y+offset+8);
          }
          m.stroke({color:teal,width:1.5,alpha:0.8});
        }
        this.swapArrow(m,origin,destination,teal);this.swapArrow(m,destination,origin,teal);
        const labelX=(origin.x+destination.x)/2,labelY=(origin.y+destination.y)/2+(origin.y===destination.y?31:0);
        const badge=new Graphics().roundRect(labelX-27,labelY-8,54,16,3).fill(0x203c36).stroke({color:teal,width:1});
        const text=new Text({text:'ОБМЕН',style:{fontFamily:'Arial, sans-serif',fontSize:10,fontWeight:'bold',fill:teal}});
        text.anchor.set(0.5);text.position.set(labelX,labelY);this.hitLabels.addChild(badge,text);
      }
    }
    const hero=this.center(state.player.index);
    this.heroRing.circle(hero.x,hero.y,33).stroke({color:0xf1d99b,width:2,alpha:0.8});
    this.heroRing.circle(hero.x,hero.y,29).fill({color:0xf1d99b,alpha:0.045});
    if(state.phase==='PLAYER_INPUT'&&state.chosenAbility==='jump'){
      const tint=0x9cded2;
      p.circle(hero.x,hero.y,TILE*JUMP_RANGE).stroke({color:tint,width:2,alpha:.28});
      for(let index=0;index<state.board.length;index++){
        const landing=this.engine.previewAbility('jump',index);if(!landing.valid)continue;
        const at=this.center(index);p.roundRect(at.x-34,at.y-34,68,68,6).fill({color:tint,alpha:.055}).stroke({color:tint,width:1.5,alpha:.62});
        p.poly([at.x-4,at.y+29,at.x,at.y+25,at.x+4,at.y+29]).stroke({color:tint,width:1.5});
      }
      this.endpoint.visible=this.targetHover>=0;
      if(this.targetHover>=0){
        const at=this.center(this.targetHover),landing=this.engine.previewAbility('jump',this.targetHover);
        const color=landing.valid?tint:0xe99580;
        p.roundRect(at.x-35,at.y-35,70,70,6).fill({color,alpha:.15}).stroke({color,width:3});
        if(landing.valid){
          p.moveTo(hero.x,hero.y).quadraticCurveTo((hero.x+at.x)/2,(hero.y+at.y)/2-60,at.x,at.y).stroke({color:tint,width:3,alpha:.9});
          for(const source of landing.threats){const from=this.center(source);this.arrow(d,from,at,0xf09b82,.85,2);}
          for(const hit of landing.hits)this.label(this.center(hit.index).x,this.center(hit.index).y+26,`−${hit.damage} → ${hit.hpAfter}♥`,PALE,11);
        }
        this.endpoint.position.set(Math.max(81,Math.min(this.boardWidth-81,at.x)),Math.max(12,at.y-35));
        this.endpointBack.clear().roundRect(-78,-11,156,22,4).fill(landing.valid?landing.damage?0x673b36:0x294540:0x4c3330).stroke({color,width:1});
        this.endpointText.text=!landing.valid?'НЕЛЬЗЯ ПРИЗЕМЛИТЬСЯ':landing.damage?`ПРЫЖОК · −${landing.damage} HP`:'ПРЫЖОК · БЕЗОПАСНО';
      }
      return;
    }
    if(state.phase==='PLAYER_INPUT'&&state.chosenAbility==='spin'){
      // Two-step spin: the zone (8 neighbours), the damage to every target, who dies and the enemy answer; the cat confirms.
      const tint=0xf2c46f,spin=this.engine.previewAbility('spin'),zone=this.engine.neighbors(state.player.index);
      p.circle(hero.x,hero.y,TILE*1.42).stroke({color:tint,width:3,alpha:.75});
      for(const index of zone){const at=this.center(index);p.roundRect(at.x-34,at.y-34,68,68,6).fill({color:tint,alpha:.07}).stroke({color:tint,width:1.5,alpha:.55});}
      for(const hit of spin.hits){
        const at=this.center(hit.index);
        p.roundRect(at.x-35,at.y-35,70,70,6).fill({color:hit.killed?0xe9a06f:tint,alpha:.2}).stroke({color:hit.killed?0xf0b08a:tint,width:3});
        this.plate(at.x,at.y+26,hit.killed?`−${hit.damage} · ПОВЕРЖЕН`:`−${hit.damage} → ${hit.hpAfter}♥`,hit.killed?0x283d2b:0x663e31,hit.killed?0xbac799:0xe8b38b,9);
      }
      if(spin.valid&&spin.enemyPhase)this.drawPushForecast(state,spin,fc);
      this.endpoint.visible=true;
      this.endpointText.text=!spin.valid?'КРУГОВОЙ · НЕЛЬЗЯ':spin.damage?`КРУГОВОЙ · −${spin.damage} HP КОТУ · ЕЩЁ РАЗ`:'КРУГОВОЙ · БЕЗОПАСНО · ЕЩЁ РАЗ';
      const half=Math.ceil(this.endpointText.width/2)+10;
      this.endpoint.position.set(Math.min(this.boardWidth-half-4,Math.max(half+4,hero.x)),Math.max(12,hero.y-40));
      this.endpointBack.clear().roundRect(-half,-10,half*2,20,4).fill(!spin.valid?0x3c3530:spin.damage?0x742e30:0x263b31).stroke({color:!spin.valid?0xc4a775:spin.damage?0xe49681:tint,width:1});
      return;
    }
    if(state.phase==='PLAYER_INPUT' && !chain.length && !this.targetingItem) {
      for(const index of this.engine.validStarts()) {
        const at=this.center(index);
        p.roundRect(at.x-36,at.y-36,72,72,7).stroke({color:0xd5d699,width:1.5,alpha:0.8});
        p.circle(at.x,at.y+31,3).fill(0xe6dcac);
      }
      if(state.turn===0) {
        const hint=new Text({text:'НАЧНИ РЯДОМ',style:{fontFamily:'Arial, sans-serif',fontSize:10,fontWeight:'bold',fill:PALE,stroke:{color:0x253026,width:3}}});
        hint.anchor.set(0.5);hint.position.set(hero.x,Math.min(this.boardHeight-8,hero.y+32));this.hitLabels.addChild(hint);
      }
    }
    if(this.targetingItem) {
      const item=this.targetingItem,tint=item==='frost'?0x9de5ee:item==='bomb'?0xf2ca7c:item==='fire'?0xf4a270:0xb0dea0;
      state.board.forEach((cell,index)=>{
        if(!cell || !this.engine.previewItem(item,index).valid) return;
        const at=this.center(index),hovered=index===this.targetHover;
        p.roundRect(at.x-35,at.y-35,70,70,6).fill({color:tint,alpha:hovered?0.22:0.08}).stroke({color:tint,alpha:hovered?1:0.55,width:hovered?3:1});
      });
      this.endpoint.visible=this.targetHover>=0;
      if(this.targetHover>=0) {
        const at=this.center(this.targetHover),target=this.engine.previewItem(item,this.targetHover);
        const affected=new Set(target.indices.map(index=>state.board[index]?.id).filter(id=>id!==undefined)).size;
        for(const index of target.indices){const pos=this.center(index);p.roundRect(pos.x-34,pos.y-34,68,68,5).fill({color:tint,alpha:.17}).stroke({color:tint,width:2});}
        this.endpoint.position.set(Math.min(this.boardWidth-80,Math.max(80,at.x)),Math.min(this.boardHeight-12,at.y+31));
        this.endpointBack.clear().roundRect(-78,-10,156,20,4).fill(0x293b3f).stroke({color:tint,width:1});
        this.endpointText.text=!target.valid?'НЕТ ЦЕЛИ':item==='frost'?'МОКРЫЙ → ЛЁД':item==='healing'?(target.healing?`+${target.healing} HP · ОЧИСТИТЬ`:'СНЯТЬ ЯД/КРОВЬ'):item==='fire'?`+1 ГОРЕНИЕ · ${affected} ЦЕЛ.`:`−${target.damage} HP · ${target.indices.length} КЛ.`;
      }
      return;
    }
    if(chain.length) {
      const points=[hero.x,hero.y,...chain.flatMap(i=>{const c=this.center(i);return[c.x,c.y];})];
      if(chain.length>0) {
        p.poly(points,false).stroke({color:0xf4d799,width:14,alpha:0.08,cap:'round',join:'round'});
        p.poly(points,false).stroke({color:0xe3b66a,width:7,alpha:0.5,cap:'round',join:'round'});
        p.poly(points,false).stroke({color:0xffedc0,width:3,alpha:0.95,cap:'round',join:'round'});
      }
      chain.forEach((i,n)=>{for(const part of occupiedIndices(state.board[i],i)){const c=this.center(part);p.roundRect(c.x-35,c.y-35,70,70,8).fill({color:0xe8c786,alpha:0.07}).stroke({color:PALE,alpha:n===chain.length-1?1:0.6,width:n===chain.length-1?2.5:1.5});}});
      if(state.phase==='PLAYER_INPUT') for(const activation of preview.deviceActivations??[]) {
        const at=this.center(activation.index),arrow=activation.kind==='arrows';
        const badge=new Graphics().roundRect(at.x-39,at.y+15,78,20,3).fill(arrow?0x51422d:0x63372d).stroke({color:arrow?0xe9c37c:0xf39b60,width:1});
        const text=new Text({text:`${activation.kind==='pits'?'ПРОВАЛЫ':arrow?'СТРЕЛЫ':'ОГОНЬ'} · ${activation.chargesAfter}`,style:{fontFamily:'Arial, sans-serif',fontSize:9,fontWeight:'bold',fill:PALE}});
        text.anchor.set(.5);text.position.set(at.x,at.y+25);this.hitLabels.addChild(badge,text);
      }
      const quillLabels:string[]=[];
      if(state.phase==='PLAYER_INPUT') for(const hit of preview.hits) {
        const at=this.center(hit.index);
        const struck=state.board[hit.index];
        if(struck?.variant==='porcupine'){
          const text=hit.spikeDamage?`−${hit.spikeDamage} ИГЛЫ`:struck.status.frozen>0?'БЕЗ ИГЛ':'';
          if(text){this.label(at.x,at.y-4,text,hit.spikeDamage?0xffb3a6:0xd7ffff,11);quillLabels.push(text);}
        }
        const bridge=state.board[hit.index]?.kind==='prism';
        const special=(bridge&&!hit.crystalScore)||hit.doorOpened;
        const badge=new Graphics().roundRect(at.x-39,at.y+(special?17:11),78,special?18:29,3).fill(hit.killed?0x283d2b:0x663e31).stroke({color:hit.killed?0xbac799:0xe8b38b,width:1});
        const weak=state.board[hit.index]?.maxHp===0;
        const text=new Text({text:bridge?(hit.loot?`ПОДБЕРЁТ\n${lootLabel(hit.loot)}`:hit.crystalScore?`СМЕНА ЦВЕТА\n+${hit.crystalScore} ОЧКОВ`:'СМЕНА ЦВЕТА'):hit.doorOpened?'ВХОД ОТКРЫТ':`${hit.availablePower} − ${hit.powerSpent} = ${hit.remainingPower}\n${weak?'СЛАБ · ':''}${hit.killed?'ПОВЕРЖЕН':`${hit.hpAfter} HP${hit.attackEffect === 'fire' ? ' · +ОГОНЬ' : ''}`}`,style:{fontFamily:'Arial, sans-serif',fontSize:bridge?9:weak?8:9,fontWeight:'bold',fill:PALE,align:'center'}});
        text.anchor.set(0.5);text.position.set(at.x,at.y+26);this.hitLabels.addChild(badge,text);
      }
      if(state.phase==='PLAYER_INPUT') {
        const finalTrapHits = new Map((preview.trapHits ?? []).map(hit => [hit.index, hit]));
        for(const hit of finalTrapHits.values()) {
          const at=this.center(hit.index);
          const badge=new Graphics().roundRect(at.x-38,at.y+17,76,19,3).fill(0x49362d).stroke({color:0xef947e,width:1});
          const text=new Text({text:preview.pitCells?.includes(hit.index)&&hit.killed?'ПАДЕНИЕ':hit.killed?'ЛОВУШКА: ПОВЕРЖЕН':`ЛОВУШКА: ${hit.hpAfter} HP`,style:{fontFamily:'Arial, sans-serif',fontSize:8,fontWeight:'bold',fill:PALE}});
          text.anchor.set(.5);text.position.set(at.x,at.y+26);this.hitLabels.addChild(badge,text);
        }
      }
      if(state.phase==='PLAYER_INPUT'&&preview.valid&&preview.enemyPhase)this.drawPushForecast(state,preview,fc);
      this.forecastDrawn.labels.push(...quillLabels);
      const end=this.center(preview.valid?preview.endIndex:chain[chain.length-1]);
      for(const i of preview.threats) {
        const from=this.center(i);
        d.moveTo(from.x,from.y).lineTo(end.x,end.y).stroke({color:0xfa7e72,width:2,alpha:0.55});
        d.roundRect(from.x-35,from.y-35,70,70,6).stroke({color:0xf58a78,width:2,alpha:0.8});
      }
      this.endpoint.visible=state.phase==='PLAYER_INPUT';
      // Same wording as the chain panel.
      this.endpointText.text=!preview.valid?'ПРОДОЛЖАЙ':preview.opensDoor!==undefined?'ВЫХОД · ПОБЕДА':preview.completesRoom?'ПОБЕДНЫЙ УДАР':preview.enemyPhase?.completesObjective?'ПОБЕДА ПОСЛЕ ОТВЕТА ВРАГОВ':preview.damage?`−${preview.damage} HP КОТУ`:'БЕЗОПАСНО';
      const half=Math.ceil(this.endpointText.width/2)+10;
      this.endpoint.position.set(Math.min(this.boardWidth-half-4,Math.max(half+4,end.x)),Math.max(12,end.y-35));
      this.endpointBack.clear().roundRect(-half,-10,half*2,20,4).fill(!preview.valid?0x3c3530:preview.damage?0x742e30:0x263b31).stroke({color:!preview.valid?0xc4a775:preview.damage?0xe49681:0x9aa982,width:1});
    } else {
      const door=this.doorFocus===null?null:state.board[this.doorFocus];
      this.endpoint.visible=Boolean(door?.door)&&state.phase==='PLAYER_INPUT';
      if(this.restPreviewOn&&!door?.door&&state.phase==='PLAYER_INPUT'&&!this.targetingItem){
        // Hover over «Отдых»: the engine's forecast of resting, drawn like the forecast of a chain.
        const rest=restForecast??this.engine.previewRest();
        if(rest.valid&&rest.enemyPhase){
          this.drawPushForecast(state,rest,fc);
          const at=this.center(rest.enemyPhase.heroIndex);
          this.endpointText.text=rest.damage?`ОТДЫХ: −${rest.damage} HP КОТУ`:'ОТДЫХ: БЕЗОПАСНО';
          const half=Math.ceil(this.endpointText.width/2)+10;
          this.endpoint.visible=true;this.endpoint.position.set(Math.min(this.boardWidth-half-4,Math.max(half+4,at.x)),Math.max(12,at.y-35));
          this.endpointBack.clear().roundRect(-half,-10,half*2,20,4).fill(rest.damage?0x742e30:0x263b31).stroke({color:rest.damage?0xe49681:0x9aa982,width:1});
        }
      }
      if(door?.door){const at=this.entityCenter(door,this.doorFocus!);this.endpoint.position.set(Math.max(87,Math.min(this.boardWidth-87,at.x)),Math.max(12,at.y-37));this.endpointBack.clear().roundRect(-85,-11,170,22,4).fill(0x26313b).stroke({color:0xe8c77c,width:1});this.endpointText.text=door.door.label;}
    }
  }

  /** Enemy-phase forecast from the engine: pushes, forced deaths and the cat's final cell. Shown only while a chain is being built. */
  private drawPushForecast(state:ForestState,preview:ReturnType<ForestEngine['preview']>,g:Graphics){
    const phase=preview.enemyPhase;if(!phase)return;
    const drawn:BoardRenderer['forecastDrawn']=this.forecastDrawn={ghosts:0,chevrons:0,crosses:0,heroGhost:false,labels:[]};
    const cellOf=(id:number)=>state.board.find(cell=>cell?.id===id)??null;
    for(const move of phase.moves){
      const from=this.center(move.from),to=this.center(move.to),dx=to.x-from.x,dy=to.y-from.y,steps=Math.max(1,Math.round(Math.hypot(dx,dy)/TILE));
      // One chevron per crossed cell border: the middle of each tile keeps its color and sigil readable.
      for(let n=0;n<steps;n++,drawn.chevrons++)drawChevron(g,{x:from.x+dx*(n+.5)/steps,y:from.y+dy*(n+.5)/steps},dx,dy,PUSH_COLOR,10);
      if(move.id===0)continue;
      const cell=cellOf(move.id);drawn.ghosts++;
      drawDashedTile(g,to,cell?.variant==='boar'?0xe8963a:cell?.color!==null&&cell?.color!==undefined?COLORS[cell.color]:PALE);
    }
    if(phase.heroIndex!==preview.endIndex){
      const at=this.center(phase.heroIndex);
      g.circle(at.x,at.y,31).stroke({color:0x172024,width:6,alpha:.7});
      g.circle(at.x,at.y,31).stroke({color:0xf1d99b,width:3});
      this.label(at.x,at.y-27,'КОТ ЗДЕСЬ',0xf9e7b3,10);drawn.heroGhost=true;drawn.labels.push('КОТ ЗДЕСЬ');
    }
    for(const death of phase.deaths){
      const at=this.center(death.index);
      drawDeathCross(g,at);drawn.crosses++;drawn.labels.push(CAUSE_LABEL[death.cause]??'');
      this.label(at.x,at.y-29,CAUSE_LABEL[death.cause]??'',0xffb3a6,9);
      // Enemy abilities do not score for the player; only goal targets and bosses count toward the task (combatRules).
      const victim=cellOf(death.id),counts=enemyDefeatCountsForGoal(state,victim),note=counts?'В ЗАДАНИЕ':'НЕ ЗАСЧИТАНО';
      this.label(at.x,at.y+9,note,counts?0xc4f0ae:0xf0d9a0,7);drawn.labels.push(note);
    }
    // Who each boar really rams: the body that takes the damage (the cat has id 0); the ones it pushes are marked at their new cell.
    for(const ram of phase.rams){
      const at=this.center(ram.index);
      this.plate(at.x,at.y-27,ram.shielded?'ЩИТ ДЕРЖИТ':`УДАР ${ram.damage}`,ram.shielded?0x27435f:0x742e30,ram.shielded?0x9cc3ec:0xf0a082,10);
    }
    for(const move of phase.moves){
      if(move.id===0||phase.rams.some(ram=>ram.id===move.id||ram.boarId===move.id))continue;
      const at=this.center(move.to);this.plate(at.x,at.y+27,'ТОЛЧОК',0x2b4a5a,0xa9d4e8,8);
    }
    const seat=(id:number)=>{const now=state.board.findIndex(cell=>cell?.id===id),move=phase.moves.find(entry=>entry.id===id);return now<0?-1:move?move.to:now;};
    for(const id of phase.packBroken){
      const index=seat(id);if(index<0)continue;const at=this.center(index);
      drawDashedTile(g,at,DEATH_COLOR);this.label(at.x,at.y-4,'СТАЯ РАЗБИТА',0xffb3a6,9);drawn.labels.push('СТАЯ РАЗБИТА');
    }
    for(const regen of phase.regenerated){
      const cell=cellOf(regen.id);if(!cell)continue;
      const now=state.board.findIndex(other=>other?.id===regen.id),at=this.entityCenter(cell,now);
      g.circle(at.x,at.y,34).stroke({color:INK_RING,width:6,alpha:.6});g.circle(at.x,at.y,34).stroke({color:0x9fd78a,width:3});
      this.label(at.x,at.y+30,`+${regen.amount} HP`,0xc4f0ae,11);drawn.labels.push(`+${regen.amount} HP`);
    }
    // Announced rites: raised at the end of the phase, or cancelled (shaman or target gone, or the shaman is frozen).
    state.board.forEach(shaman=>{
      if(shaman?.variant!=='shaman'||!shaman.intent.empowerIds?.length)return;
      for(const id of shaman.intent.empowerIds){
        const index=seat(id);if(index<0)continue;
        const at=this.center(index),done=phase.empowered.find(rite=>rite.id===id&&rite.shamanId===shaman.id);
        if(done){const text=done.tier==='sturdy'?'↑ КРЕПКИЙ':'↑ ВООРУЖЁН';this.label(at.x,at.y-29,text,0xe6d0ff,9);drawn.labels.push(text);}
        else{
          for(const [w,color] of [[7,0x2c1d45],[3.5,0xb7a6d0]] as const)g.moveTo(at.x-12,at.y-12).lineTo(at.x+12,at.y+12).moveTo(at.x+12,at.y-12).lineTo(at.x-12,at.y+12).stroke({color,width:w,cap:'round'});
          this.label(at.x,at.y-29,'КАМЛАНИЕ ОТМЕНЕНО',0xcdbfe6,8);drawn.labels.push('КАМЛАНИЕ ОТМЕНЕНО');
        }
      }
    });
    for(const charge of phase.charges)if(charge.stunned){this.label(this.center(charge.to).x,this.center(charge.to).y-29,'ОГЛУШИТСЯ',0xffe08a,9);drawn.labels.push('ОГЛУШИТСЯ');}
    for(const id of phase.knockedDown){
      // Only a knocked-down attacker matters to the plan; other pushed bodies would only add noise.
      const now=state.board.findIndex(cell=>cell?.id===id),move=phase.moves.find(entry=>entry.id===id),index=move?move.to:now;
      if(index>=0&&now>=0&&enemyReadyToAttack(state.board[now],now,state)){this.label(this.center(index).x,this.center(index).y-29,'СБИТ · ПРОПУСК',0xd6efff,8);drawn.labels.push('СБИТ');}
    }
  }

  /** Caption on a dark plate, kept inside the board. */
  private plate(x:number,y:number,text:string,fill:number,stroke:number,size=10,color=PALE){
    const label=new Text({text,style:{fontFamily:'Arial, sans-serif',fontSize:size,fontWeight:'bold',fill:color,align:'center'}});
    label.anchor.set(.5);this.captions.push(text);
    const w=Math.ceil(label.width)+12,h=Math.ceil(label.height)+6;
    const cx=Math.min(this.boardWidth-w/2-2,Math.max(w/2+2,x)),cy=Math.min(this.boardHeight-h/2-2,Math.max(h/2+2,y));
    label.position.set(cx,cy);
    this.hitLabels.addChild(new Graphics().roundRect(cx-w/2,cy-h/2,w,h,4).fill({color:fill,alpha:.95}).stroke({color:stroke,width:1.5}),label);
  }
  private label(x:number,y:number,text:string,color:number,size=11){
    const view=new Text({text,style:{fontFamily:'Arial, sans-serif',fontSize:size,fontWeight:'bold',fill:color,stroke:{color:0x1a2228,width:3}}});
    view.anchor.set(.5);view.position.set(x,y);this.hitLabels.addChild(view);this.captions.push(text);
  }

  private arrow(g:Graphics,from:{x:number;y:number},to:{x:number;y:number},color:number,alpha:number,width:number) {
    const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
    if(length<1) return;
    const ux=dx/length,uy=dy/length,start={x:from.x+ux*29,y:from.y+uy*29},end={x:to.x-ux*12,y:to.y-uy*12};
    g.moveTo(start.x,start.y).lineTo(end.x,end.y).stroke({color,width,alpha});
    g.poly([end.x,end.y,end.x-ux*11-uy*5,end.y-uy*11+ux*5,end.x-ux*11+uy*5,end.y-uy*11-ux*5]).fill({color,alpha});
  }

  private swapArrow(g:Graphics,from:{x:number;y:number},to:{x:number;y:number},color:number) {
    const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
    if(length<1) return;
    const ux=dx/length,uy=dy/length,nx=-uy,ny=ux;
    const clamp=(p:{x:number;y:number})=>({x:Math.max(8,Math.min(this.boardWidth-8,p.x)),y:Math.max(8,Math.min(this.boardHeight-8,p.y))});
    const start=clamp({x:from.x+nx*29+ux*12,y:from.y+ny*29+uy*12});
    const end=clamp({x:to.x+nx*29-ux*12,y:to.y+ny*29-uy*12});
    const control=clamp({x:(from.x+to.x)/2+nx*41,y:(from.y+to.y)/2+ny*41});
    g.moveTo(start.x,start.y).quadraticCurveTo(control.x,control.y,end.x,end.y).stroke({color,width:3,alpha:0.98});
    const tx=end.x-control.x,ty=end.y-control.y,tl=Math.max(1,Math.hypot(tx,ty)),vx=tx/tl,vy=ty/tl;
    g.poly([end.x,end.y,end.x-vx*10-vy*4,end.y-vy*10+vx*4,end.x-vx*10+vy*4,end.y-vy*10-vx*4]).fill(color);
  }

  private react(event: ForestEvent,state: ForestState) {
    const i=event.index??event.to;
    if(event.type==='ability'){
      if(event.text==='jump'&&event.from!==undefined&&event.to!==undefined){
        this.jumpMotion={from:this.center(event.from),to:this.center(event.to),started:performance.now(),duration:260*Math.max(.25,this.engine.animationScale)};
        this.burst(event.from,0xb7e5cf,10);this.burst(event.to,0xb7e5cf,14);this.popup(event.to,'ПРЫЖОК',0xc5edda);
      }else if(event.text==='spin'){
        const at=this.center(event.from??state.player.index),ring=new Graphics();
        for(let n=0;n<3;n++)ring.arc(0,0,105,n*Math.PI*2/3,n*Math.PI*2/3+1.45).stroke({color:0xf6d494,width:6,alpha:.85});
        ring.position.set(at.x,at.y);this.effects.addChild(ring);this.particles.push({view:ring,vx:0,vy:0,life:340,max:340,stationary:true,angular:.018});
        this.spinUntil=performance.now()+340;this.popup(state.player.index,'КРУГОВОЙ УДАР',0xffdda1);
      }
    }
    if(event.type==='move' && event.to!==undefined) this.playerTarget=this.center(event.to);
    if((event.type==='kill'||event.type==='hit') && i!==undefined) {
      this.burst(i,event.type==='kill'?COLORS[state.board[i]?.color??1]:PALE,event.type==='kill'?13:7);
      this.shake=Math.max(this.shake,2);
      if(event.type==='hit') this.popup(i,event.amount?`−${event.amount}${event.text&&CAUSE_LABEL[event.text]?` ${CAUSE_LABEL[event.text]}`:''}`:event.text??'УДАР',PALE);
    }
    if(event.type==='crystal'&&i!==undefined){
      // The fall itself (and the crush) plays from the piece's drop animation; here only the score label.
      this.popupAt(this.center(i).x,this.center(i).y-40,`КРИСТАЛЛ · ${event.amount??0}`,0xffeaa8);
    }
    if(event.type==='windup'&&event.text==='club'&&i!==undefined){
      const cell=state.board[i],piece=cell?this.views.get(cell.id):undefined,at=this.entityCenter(cell,i);
      if(piece)piece.strike={started:performance.now(),dx:0,dy:-9};
      this.burst(i,0xd9744a,10);this.popupAt(at.x,at.y-58,'ЗАМАХ',0xf0c9a4);
      for(const target of event.indices??[]){const zone=this.center(target),flash=new Graphics().roundRect(zone.x-35,zone.y-35,70,70,4).stroke({color:0xd9744a,width:4,alpha:.9});this.effects.addChild(flash);this.particles.push({view:flash,vx:0,vy:0,life:420,max:420,stationary:true});}
    }
    if(event.type==='attack'&&event.text==='club'&&i!==undefined){
      const cell=state.board[i],piece=cell?this.views.get(cell.id):undefined,zone=event.indices??[];
      const at=this.entityCenter(cell,i),mid=zone.length?this.center(zone[Math.floor(zone.length/2)]):at;
      const distance=Math.max(1,Math.hypot(mid.x-at.x,mid.y-at.y));
      if(piece)piece.strike={started:performance.now(),dx:(mid.x-at.x)/distance*14,dy:(mid.y-at.y)/distance*14};
      for(const target of zone){const spot=this.center(target),slam=new Graphics().roundRect(spot.x-35,spot.y-35,70,70,4).fill({color:0xffb27a,alpha:.55}).stroke({color:0xffe2c4,width:4});this.effects.addChild(slam);this.particles.push({view:slam,vx:0,vy:0,life:360,max:360,stationary:true});this.burst(target,0xe3a06f,7);}
      this.shake=Math.max(this.shake,11);this.popupAt(mid.x,mid.y,`УДАР ${event.amount??''}`.trim(),0xffe2c4);
    }
    if(event.type==='regen'&&i!==undefined){
      const cell=state.board[i],at=this.entityCenter(cell,i);
      this.burst(i,0x9fd78a,16);this.popupAt(at.x,at.y-44,`+${event.amount??''} HP`,0xc4f0ae);
    }
    if(event.type==='empower'&&i!==undefined){
      this.burst(i,RITE,24);if(event.from!==undefined)this.burst(event.from,RITE,10);
      this.popup(i,event.text==='sturdy'?'↑ КРЕПКИЙ':'↑ ВООРУЖЁН',0xe6d0ff);
    }
    if(event.type==='prism' && i!==undefined) { this.burst(i,0xf7d990,26);this.popup(i,'КРИСТАЛЛ',PALE); }
    if(event.type==='spawn')for(const index of event.indices??[])if(state.board[index]?.kind==='prism'){this.burst(index,0xc8eacb,22);this.popup(index,'+ КРИСТАЛЛ',PALE);}
    if(event.type==='attack' && i!==undefined && state.board[i]?.kind==='melee'){
      const cell=state.board[i]!,piece=this.views.get(cell.id),at=this.entityCenter(cell,i),to=this.center(event.to??state.player.index);
      const distance=Math.max(1,Math.hypot(to.x-at.x,to.y-at.y));
      if(piece)piece.strike={started:performance.now(),dx:-(to.x-at.x)/distance*5,dy:-(to.y-at.y)/distance*5};
      const ring=new Graphics().arc(at.x,at.y,30,Math.PI*1.05,Math.PI*1.95).stroke({color:0xf2c483,width:3,alpha:.8});
      this.effects.addChild(ring);this.particles.push({view:ring,vx:0,vy:0,life:100,max:100,stationary:true});
    }
    // The troll's club has its own zone slam above; the generic strike line would point at the cat only.
    const impactIndex=event.text==='club'?undefined:event.type==='damage'&&event.from!==undefined&&state.board[event.from]?.kind==='melee'?event.from
      :event.type==='attack'&&i!==undefined&&state.board[i]?.kind!=='melee'?i:undefined;
    if(impactIndex!==undefined) {
      const cell=state.board[impactIndex],piece=cell?this.views.get(cell.id):undefined;
      this.burst(impactIndex,0xe99a78,cell?.kind==='boss'?20:12);
      const from=this.entityCenter(cell,impactIndex),to=this.center(event.type==='damage'?state.player.index:event.to??state.player.index);
      const distance=Math.max(1,Math.hypot(to.x-from.x,to.y-from.y));
      if(piece) piece.strike={started:performance.now(),dx:(to.x-from.x)/distance*8,dy:(to.y-from.y)/distance*8};
      const view=new Graphics().moveTo(from.x,from.y).lineTo(to.x,to.y).stroke({color:0xf0a082,width:5,alpha:0.8});
      view.circle(from.x,from.y,34).stroke({color:0xf6b870,width:3,alpha:0.85});
      this.effects.addChild(view);this.particles.push({view,vx:0,vy:0,life:210,max:210,stationary:true});
    }
    if(event.type==='kill'&&i!==undefined&&event.text==='loot')this.lootCrushed.add(i);
    if(event.type==='loot'&&i!==undefined){
      const item=event.text as LootKind|undefined;
      if(item)this.popupAt(this.center(i).x,this.center(i).y-40,`ВЫПАЛО · ${lootLabel(item)}`,ITEM_COLORS[item]);
    }
    if(event.type==='loot-pickup'&&i!==undefined){
      const item=event.text as LootKind|undefined;
      this.lootCells.delete(i);
      if(item){this.burst(i,ITEM_COLORS[item],26);this.popup(i,`+ ${lootLabel(item)}`,ITEM_COLORS[item]);}
    }
    if(event.type==='collect' && i!==undefined && this.lootCells.has(i)) {
      // A dropped consumable, not a colour crystal: the pickup flash above comes with the next event.
      this.burst(i,ITEM_COLORS[this.lootCells.get(i)!],12);
    } else if(event.type==='collect' && i!==undefined) {
      this.burst(i,PALE,24);this.popup(i,'СМЕНА ЦВЕТА',PALE);
      const gained=state.score-this.scoreSeen;if(gained>0)this.popupAt(this.center(i).x,this.center(i).y+12,`+${gained}`,0xffeaa8);
    }
    this.scoreSeen=state.score;
    if(event.type==='damage') {
      if(event.text==='quills'&&event.from!==undefined)this.burst(event.from,QUILL,14);
      this.shake=8;this.burst(state.player.index,0xdf695d,20);this.popup(state.player.index,`−${event.amount??1} HP${event.text&&CAUSE_LABEL[event.text]?` · ${CAUSE_LABEL[event.text]}`:''}`,0xffad98);
      this.mount.classList.remove('board-damaged');void this.mount.offsetWidth;this.mount.classList.add('board-damaged');
    }
    if(event.type==='status' && i!==undefined && (event.text || event.effect && event.amount!==undefined)) {
      const label=event.text??(event.effect==='fire'?'ГОРЕНИЕ':event.effect==='poison'?'ЯД':event.effect==='bleeding'?'КРОВОТЕЧЕНИЕ':event.effect==='wind'?'ВЕТЕР':'ЭФФЕКТ');
      const color=event.effect==='fire'?0xf0a46b:event.effect==='poison'?0xc7df90:event.effect==='bleeding'?0xf0a5a7:0xb5d8dc;
      this.burst(i,color,8);this.popup(i,label,color);
    }
    if(event.type==='invalid') {if(i!==undefined&&event.text?.toLowerCase().includes('щит')&&(this.invalidIndex!==i||performance.now()>this.invalidUntil))this.popup(i,'ЩИТ · ОБОЙДИ',0xf3d695);this.invalidIndex=i??state.chain[state.chain.length-1]??-1;this.invalidUntil=performance.now()+230;}
    if(event.type==='frost' && i!==undefined) {this.burst(i,0xb5eeee,24);this.popup(i,'ХОЛОД',0xd4ffff);}
    if(event.type==='item'&&i!==undefined){this.burst(i,event.text?.includes('ог')?0xf0a065:0xebd09c,20);this.popup(i,event.text??'ПРЕДМЕТ',PALE);}
    if(event.type==='device'&&i!==undefined){const fire=event.text==='fire';this.burst(i,fire?0xf3a25f:0xe9c37c,fire?19:13);this.popup(i,fire?'ЖАРОВНЯ':'РЫЧАГ',fire?0xffbc7d:0xf9dfa0);}
    if(event.type==='pit-open'&&i!==undefined){this.burst(i,0xb9a6e3,8);this.shake=Math.max(this.shake,3);}
    if(event.type==='pit-immune'&&i!==undefined)this.popup(i,'ЗАКЛИНИЛО',0xc9bfdf);
    if(event.type==='pit-close')for(const index of event.indices??[])this.burst(index,0xa6a8bf,6);
    if(event.type==='trap'&&event.text!=='pits'){
      const origin=this.center(event.index??state.player.index);
      for(const [n,index] of (event.indices??[]).entries()){
        const at=this.center(index),view=new Graphics();
        view.moveTo(0,-13).lineTo(0,12).stroke({color:0xe9c37c,width:3});
        view.poly([-5,4,0,14,5,4]).fill(0xf5ead4);
        const angle=Math.atan2(at.y-origin.y,at.x-origin.x)+Math.PI/2;
        view.rotation=angle;view.position.set(origin.x,origin.y);this.effects.addChild(view);
        this.arrowProjectiles.push({view,startX:origin.x,startY:origin.y,targetX:at.x,targetY:at.y,life:240+n*25,max:240+n*25});
      }
    }
    if(event.type==='charge'&&event.index!==undefined){
      // Wind-up: the boar rears back, the announced lane flashes.
      const boar=state.board[event.index],piece=boar?this.views.get(boar.id):undefined,lane=(event.indices??[]).map(index=>this.center(index));
      if(lane.length){
        const a=this.center(event.index),dx=Math.sign(lane[0].x-a.x),dy=Math.sign(lane[0].y-a.y);
        if(piece)piece.strike={started:performance.now(),dx:-dx*7,dy:-dy*7};
        const flash=new Graphics(),minX=Math.min(...lane.map(c=>c.x))-36,maxX=Math.max(...lane.map(c=>c.x))+36,minY=Math.min(...lane.map(c=>c.y))-36,maxY=Math.max(...lane.map(c=>c.y))+36;
        flash.roundRect(minX,minY,maxX-minX,maxY-minY,6).fill({color:0xe8963a,alpha:.3}).stroke({color:0xffc173,width:4});
        this.effects.addChild(flash);const life=this.dur(420);this.particles.push({view:flash,vx:0,vy:0,life,max:life,stationary:true});
      }
      this.burst(event.index,0xc8b08a,7);
    }
    if((event.type==='hit'||event.type==='damage')&&event.text==='ram'&&event.from!==undefined&&i!==undefined){
      const boar=state.board[event.from],piece=boar?this.views.get(boar.id):undefined,a=this.center(event.from),b=this.center(i),len=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
      if(piece)piece.strike={started:performance.now(),dx:(b.x-a.x)/len*12,dy:(b.y-a.y)/len*12};
      const ring=new Graphics().circle(b.x,b.y,34).stroke({color:0xffc173,width:4,alpha:.9});
      this.effects.addChild(ring);const life=this.dur(220);this.particles.push({view:ring,vx:0,vy:0,life,max:life,stationary:true});
      this.burst(i,0xe8963a,10);this.shake=Math.max(this.shake,4);
    }
    if(event.type==='hit'&&event.from!==undefined&&i!==undefined&&state.board[event.from]&&archerStrikesCreatures(state.board[event.from]!)){
      // An arrow that hits a creature other than the cat.
      const origin=this.center(event.from),at=this.center(i),view=new Graphics();
      view.moveTo(0,-13).lineTo(0,12).stroke({color:0xe9c37c,width:3});view.poly([-5,4,0,14,5,4]).fill(0xf5ead4);
      view.rotation=Math.atan2(at.y-origin.y,at.x-origin.x)+Math.PI/2;view.position.set(origin.x,origin.y);this.effects.addChild(view);
      const life=this.dur(200);this.arrowProjectiles.push({view,startX:origin.x,startY:origin.y,targetX:at.x,targetY:at.y,life,max:life});
    }
    if(event.type==='push'&&event.from!==undefined){this.burst(event.from,0xc8b08a,5);this.shake=Math.max(this.shake,2);}
    if(event.type==='move'&&event.text==='push'&&event.to!==undefined)this.burst(event.to,0xf1d99b,6);
    if(event.type==='status'&&event.text==='ОГЛУШЁН'&&i!==undefined){
      const at=this.center(i),stars=new Graphics();drawStunStars(stars,22);stars.position.set(at.x,at.y-30);
      this.effects.addChild(stars);const life=this.dur(900);this.particles.push({view:stars,vx:0,vy:0,life,max:life,stationary:true,angular:.004});
      this.shake=Math.max(this.shake,4);this.burst(i,0xffe08a,10);
    }
    if(event.type==='reshuffle') this.popup(state.player.index,'НОВЫЙ ПУТЬ',PALE);
  }

  /** A crystal has landed: dust, a ring and a small shake; heavier when it crushed an enemy. */
  private crystalImpact(index:number,crushed:boolean){
    const at=this.center(index),ring=new Graphics().circle(at.x,at.y,26).stroke({color:0xf3d98a,width:4,alpha:.95});
    this.effects.addChild(ring);this.particles.push({view:ring,vx:0,vy:0,life:280,max:280,stationary:true,angular:0});
    this.burst(index,0xf3d98a,crushed?18:12);
    if(crushed){this.burst(index,0xdf695d,10);this.popupAt(at.x,at.y+14,'РАЗДАВЛЕН · не засчитано',0xf0d9a0);}
    this.shake=Math.max(this.shake,crushed?6:3);
  }
  private burst(index: number,color: number,count: number) {
    const c=this.center(index);
    for(let i=0;i<count;i++) {
      const view=new Graphics().poly([0,-3,2,0,0,4,-2,0]).fill(i%4===0?PALE:color);
      view.position.set(c.x,c.y);this.effects.addChild(view);
      const angle=Math.random()*Math.PI*2,speed=50+Math.random()*160,life=230+Math.random()*330;
      this.particles.push({view,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life,max:life});
    }
  }

  private popup(index: number,text: string,color: number) {
    const c=this.center(index);this.popupAt(c.x,c.y-22,text,color);
  }
  private popupAt(x: number,y: number,text: string,color: number) {
    const view=new Text({text,style:{fontFamily:'Georgia, serif',fontSize:15,fontWeight:'bold',fill:color,stroke:{color:0x141919,width:4}}});
    view.anchor.set(0.5);view.position.set(x,y);this.effects.addChild(view);this.popups.push({view,life:850});
  }

  private tick(delta: number) {
    const dt=Math.min(delta,40);this.elapsed+=dt;
    const state=this.engine.state,now=performance.now();
    for(const piece of this.views.values()) {
      const cell=state.board[piece.index],selected=occupiedIndices(cell,piece.index).some(i=>state.chain.includes(i)),pos=this.entityCenter(cell,piece.index);
      const ready=enemyReadyToAttack(cell,piece.index,this.engine.state);
      const birth=Math.min(1,(now-piece.born)/170);
      const bounce=selected?1.055+Math.sin(this.elapsed*0.011+piece.index)*0.025:1;
      const size=(0.84+birth*0.16)*bounce;
      piece.view.scale.set(size*(ready?1.025:1),size*(ready?0.985:1));piece.view.alpha=0.4+birth*0.6;
      let x=pos.x,y=pos.y;
      if(piece.motion) {
        const progress=Math.min(1,(now-piece.motion.started)/piece.motion.duration),eased=1-Math.pow(1-progress,3);
        const dx=pos.x-piece.motion.x,dy=pos.y-piece.motion.y,length=Math.max(1,Math.hypot(dx,dy)),arc=Math.sin(progress*Math.PI)*(piece.motion.curve??0);
        x=piece.motion.x+dx*eased-dy/length*arc;y=piece.motion.y+dy*eased+dx/length*arc;
        if(progress===1)piece.motion=undefined;
      }
      if(piece.drop){
        const t=Math.min(1,(now-piece.drop.started)/piece.drop.duration);
        y-=(1-t*t)*240;
        if(t===1){const crushed=piece.drop.crushed;piece.drop=undefined;this.crystalImpact(piece.index,crushed);}
      }
      if(piece.strike) {
        const progress=Math.min(1,(now-piece.strike.started)/220),lunge=Math.sin(progress*Math.PI);
        x+=piece.strike.dx*lunge;y+=piece.strike.dy*lunge;if(progress===1)piece.strike=undefined;
      }
      piece.view.y=y+(selected?-3:Math.sin(this.elapsed*(ready?0.009:0.0018)+piece.index)*(ready?1.3:0.8));
      piece.view.x=x+(piece.index===this.invalidIndex&&now<this.invalidUntil?Math.sin(now*0.075)*4:0);
      piece.view.rotation=selected?Math.sin(this.elapsed*0.007+piece.index)*0.025:ready?Math.sin(this.elapsed*0.005+piece.index)*0.013:0;
      const aura=piece.view.getChildByLabel('attack-aura');
      if(aura) aura.alpha=0.55+0.35*(0.5+0.5*Math.sin(this.elapsed*0.006+piece.index));
      const stars=piece.view.getChildByLabel('stun-stars');if(stars)stars.rotation=Math.sin(this.elapsed*.006)*.4;
      const glow=piece.view.getChildByLabel('prism-aura');if(glow){glow.alpha=.6+.35*Math.sin(this.elapsed*.004+piece.index);glow.scale.set(1+.07*Math.sin(this.elapsed*.004));}
    }
    const smoothing=1-Math.exp(-dt/28);
    if(this.jumpMotion){
      const jump=this.jumpMotion,t=Math.min(1,(now-jump.started)/jump.duration);
      this.player.position.set(jump.from.x+(jump.to.x-jump.from.x)*t,jump.from.y+(jump.to.y-jump.from.y)*t-Math.sin(t*Math.PI)*66);
      this.player.scale.set(1+Math.sin(t*Math.PI)*.12);if(t===1){this.jumpMotion=undefined;this.player.scale.set(1);}
    }else{this.player.x+=(this.playerTarget.x-this.player.x)*smoothing;this.player.y+=(this.playerTarget.y-this.player.y)*smoothing;}
    this.player.rotation=now<this.spinUntil?(1-(this.spinUntil-now)/340)*Math.PI*2:Math.sin(this.elapsed*0.003)*0.018;
    for(let i=this.particles.length-1;i>=0;i--) {
      const p=this.particles[i];p.life-=dt;
      if(!p.stationary) {p.view.x+=p.vx*dt/1000;p.view.y+=p.vy*dt/1000;p.vy+=180*dt/1000;p.view.rotation+=dt*0.006;}
      if(p.angular)p.view.rotation+=p.angular*dt;
      p.view.alpha=Math.max(0,p.life/p.max);
      if(p.life<=0) {p.view.destroy();this.particles.splice(i,1);}
    }
    for(let i=this.popups.length-1;i>=0;i--) {const p=this.popups[i];p.life-=dt;p.view.y-=dt*0.032;p.view.alpha=Math.min(1,Math.max(0,p.life/300));if(p.life<=0){p.view.destroy();this.popups.splice(i,1);}}
    for(let i=this.dying.length-1;i>=0;i--){
      const d=this.dying[i];
      if(d.wait!==undefined&&d.wait>0){d.wait-=dt;continue;}
      d.life-=dt;const t=Math.min(1,1-d.life/d.max),ease=1-Math.pow(1-t,2);
      d.view.tint=d.kind==='arrow'?0xffffff:0xff9a88;
      if(d.kind==='crystal'){d.view.position.set(d.bx,d.by+22*ease);d.view.scale.set(1+.35*t,Math.max(.06,1-.94*ease));d.view.alpha=1-t*t;}
      else if(d.kind==='spikes'){d.view.position.set(d.bx+d.dx*34*ease,d.by+d.dy*34*ease);d.view.scale.set(1-.35*t);d.view.alpha=1-t*t;}
      else if(d.kind==='pit'){d.view.position.set(d.bx,d.by+16*ease);d.view.scale.set(Math.max(.05,1-t));d.view.rotation=t*.9;d.view.alpha=1-t*.6;}
      else if(d.kind==='ram'){d.view.position.set(d.bx+d.dx*30*ease,d.by+d.dy*30*ease);d.view.rotation=t*1.6*(d.dx>=0?1:-1);d.view.scale.set(1-.3*t);d.view.alpha=1-t*t;}
      else if(d.kind==='thorns'){d.view.position.set(d.bx+Math.sin(t*40)*3*(1-t),d.by);d.view.alpha=1-t*t;d.view.scale.set(1-.2*t);}
      else{d.view.position.set(d.bx,d.by-8*ease);d.view.scale.set(1+.12*Math.sin(t*Math.PI));d.view.alpha=1-t;}
      if(d.life<=0){d.view.destroy({children:true});this.dying.splice(i,1);}
    }
    for(let i=this.arrowProjectiles.length-1;i>=0;i--){
      const arrow=this.arrowProjectiles[i];arrow.life-=dt;const t=Math.min(1,1-arrow.life/arrow.max);
      arrow.view.position.set(arrow.startX+(arrow.targetX-arrow.startX)*t,arrow.startY+(arrow.targetY-arrow.startY)*t*t);
      if(arrow.life<=0){const index=this.indexAt({x:arrow.targetX,y:arrow.targetY});if(index>=0)this.burst(index,0xe8c888,7);arrow.view.destroy();this.arrowProjectiles.splice(i,1);}
    }
    this.shake*=Math.exp(-dt/65);
    this.world.position.set(this.offset.x+(Math.random()-0.5)*this.shake,this.offset.y+(Math.random()-0.5)*this.shake);
  }

  private eventPoint(event: PointerEvent) {
    this.resize();
    const rect=this.app.canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left-this.offset.x)/this.scale,y:(event.clientY-rect.top-this.offset.y)/this.scale};
  }

  private indexAt(point: {x:number;y:number}): number {
    if(point.x<0||point.x>=this.boardWidth||point.y<0||point.y>=this.boardHeight) return -1;
    return Math.floor(point.x/TILE)+Math.floor(point.y/TILE)*this.engine.state.cols;
  }

  private pointerDown = (event: PointerEvent) => {
    if(this.activePointer!==null||this.engine.state.phase!=='PLAYER_INPUT'||event.button!==0) return;
    event.preventDefault();
    const point=this.eventPoint(event),index=this.indexAt(point);
    if(this.engine.state.chosenAbility==='spin'){
      // Confirm the spin by clicking the cat; any other cell only flashes.
      if(index===this.engine.state.player.index)void this.engine.useAbility('spin');
      else {this.invalidIndex=index;this.invalidUntil=performance.now()+230;}
      return;
    }
    if(this.engine.state.chosenAbility==='jump'){
      this.targetHover=index;
      if(index>=0&&this.engine.previewAbility('jump',index).valid){this.jumpPress=index;this.activePointer=event.pointerId;this.app.canvas.setPointerCapture(event.pointerId);}
      else {this.invalidIndex=index;this.invalidUntil=performance.now()+230;}
      this.drawOverlays(this.engine.state);return;
    }
    if(this.targetingItem) {
      if(index>=0 && this.engine.useItem(this.targetingItem,index)) this.setItemTargeting(null);
      else {this.invalidIndex=index;this.invalidUntil=performance.now()+230;}
      return;
    }
    if(index<0||!this.engine.beginChain(index)) return;
    this.dragging=true;this.activePointer=event.pointerId;this.lastPointer=point;
    this.app.canvas.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    const hoveredCell=this.engine.state.board[this.indexAt(this.eventPoint(event))];
    this.app.canvas.title=hoveredCell?.elite?ELITE_TIP:hoveredCell?.kind==='prism'&&hoveredCell.loot?lootTip(hoveredCell.loot):'';
    if(this.targetingItem||this.engine.state.chosenAbility==='jump') {const next=this.indexAt(this.eventPoint(event));if(next!==this.targetHover){this.targetHover=next;this.drawOverlays(this.engine.state);}return;}
    const hovered=this.indexAt(this.eventPoint(event));
    const lastFocus=this.doorFocus;this.focusDoor(hovered>=0?hovered:null);
    if(this.doorFocus!==lastFocus)this.drawOverlays(this.engine.state);
    if(!this.dragging||event.pointerId!==this.activePointer) return;
    event.preventDefault();
    const point=this.eventPoint(event),last=this.lastPointer??point;
    const steps=Math.max(1,Math.ceil(Math.hypot(point.x-last.x,point.y-last.y)/16));
    let visited=-1;
    for(let step=1;step<=steps;step++) {
      const sample={x:last.x+(point.x-last.x)*step/steps,y:last.y+(point.y-last.y)*step/steps};
      const index=this.indexAt(sample);
      if(index<0||index===visited||index===this.engine.state.chain[this.engine.state.chain.length-1]) continue;
      // Ignore tile corners so diagonal movement cannot accidentally undo a link
      // by grazing its neighbor after client-coordinate rounding.
      const middle=this.center(index);
      if(Math.abs(sample.x-middle.x)>TILE*0.39||Math.abs(sample.y-middle.y)>TILE*0.39) continue;
      visited=index;
      if(!this.engine.extendChain(index)) {this.invalidIndex=index;this.invalidUntil=performance.now()+200;}
    }
    this.lastPointer=point;
  };

  private pointerUp = (event: PointerEvent) => {
    if(event.pointerId!==this.activePointer) return;
    const jump=this.jumpPress;this.jumpPress=null;
    this.dragging=false;this.activePointer=null;this.lastPointer=null;
    if(this.app.canvas.hasPointerCapture(event.pointerId)) this.app.canvas.releasePointerCapture(event.pointerId);
    if(jump!==null){if(this.engine.state.chosenAbility==='jump'&&this.indexAt(this.eventPoint(event))===jump)void this.engine.useAbility('jump',jump);else this.drawOverlays(this.engine.state);return;}
    void this.engine.releaseChain();
  };

  private pointerCancel = () => {
    const wasDragging=this.dragging,pointer=this.activePointer;
    this.dragging=false;this.activePointer=null;this.lastPointer=null;this.jumpPress=null;
    if(pointer!==null && this.app.canvas.hasPointerCapture(pointer)) this.app.canvas.releasePointerCapture(pointer);
    if(wasDragging) this.engine.cancelChain();
  };

  private pointerLeave = () => {if(this.targetHover!==-1){this.targetHover=-1;this.drawOverlays(this.engine.state);}this.focusDoor(null);};
  private keyDown = (event: KeyboardEvent) => { if(event.key==='Escape') {if(this.targetingItem)this.setItemTargeting(null);else if(this.engine.state.chosenAbility){this.pointerCancel();this.engine.setAbility(null);}else this.pointerCancel();} };

  /** Safe after a failed init(): Pixi may have no renderer or canvas yet. */
  destroy() {
    this.disposed=true;this.unsubscribe?.();this.resizeObserver?.disconnect();
    window.removeEventListener('blur',this.pointerCancel);window.removeEventListener('keydown',this.keyDown);
    if(this.initialized){this.app.canvas.removeEventListener('pointerdown',this.pointerDown);this.app.canvas.removeEventListener('pointermove',this.pointerMove);this.app.canvas.removeEventListener('pointerup',this.pointerUp);this.app.canvas.removeEventListener('pointercancel',this.pointerCancel);this.app.canvas.removeEventListener('pointerleave',this.pointerLeave);this.app.canvas.removeEventListener('lostpointercapture',this.pointerCancel);}
    try{this.app.destroy(true,{children:true});}catch{/* init failed before Pixi built its renderer */}
  }
}
