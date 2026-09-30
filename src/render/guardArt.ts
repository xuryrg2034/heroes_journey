import { Container, Graphics, Text } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';
import { meleeCanAttack } from '../game/enemyLifecycle';
import { shieldIsActive } from '../game/combatRules';
import { addDamageEffectBadges } from './damageEffectBadges';

/** Procedural fallbacks for the shield guard (`sentinel`), the Jailer and the authored exit door. */
const INK=0x172024, BONE=0xeadbb9, COLORS=[0xca7970,0x9fba7c,0x79b0c4,0xd8b66a,0xb69ad2];
function text(c:Container,value:string,x:number,y:number,size=11,color=BONE){const t=new Text({text:value,style:{fontFamily:'Georgia, serif',fontSize:size,fontWeight:'bold',fill:color}});t.anchor.set(.5);t.position.set(x,y);c.addChild(t);return t;}

function sigil(g:Graphics,color:number|null,x:number,y:number){
  if(color===0)g.poly([x,y-5,x+5,y+4,x-5,y+4]).fill(BONE);
  else if(color===1)g.moveTo(x,y-5).lineTo(x,y+5).moveTo(x-5,y).lineTo(x+5,y).stroke({color:BONE,width:2});
  else if(color===2)g.rect(x-4,y-4,8,8).stroke({color:BONE,width:2});
  else if(color===3)g.circle(x,y,4).stroke({color:BONE,width:2});
  else if(color===4)g.moveTo(x-4,y-4).lineTo(x+4,y+4).moveTo(x+4,y-4).lineTo(x-4,y+4).stroke({color:BONE,width:2});
}
function status(c:Container,g:Graphics,cell:ForestCell){
  const ready=cell.intent.cells.length>0&&(cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  if(cell.status.frozen||ready||cell.behavior.restTurns){
    g.roundRect(-35,-35,18,18,3).fill(ready?0x85433a:0x243032).stroke({color:ready?0xe9a879:0x61767a,width:1});
    text(c,cell.status.frozen?'❄':ready?'!':'Ⅱ',-26,-26,12);
  }
  if(cell.hp>0){g.roundRect(6,-35,31,18,3).fill(0x253238).stroke({color:0xb5b79c,width:1});text(c,`${cell.hp}♥`,22,-26,12);}
  if(cell.status.wet)g.poly([-28,13,-23,22,-27,26,-32,22]).fill(0x8fd9de);
  if(cell.status.frozen)g.poly([-32,-15,-19,-29,20,-29,33,-11,26,29,-23,29]).fill({color:0xabf0eb,alpha:.17}).stroke({color:0xb0edee,width:2});
  if(cell.status.brittle){g.circle(27,22,10).fill(0x38585c);text(c,'×2',27,22,11,0xd7ffff);}
}

/** Authored exit (`completion: 'exit'`): closed until every goal is met, then open for the chain. */
export function makeDoor(cell:ForestCell,width:number,height:number):Container{
  const c=new Container(),g=new Graphics();c.addChild(g);const door=cell.door!;
  const w=width-10,h=height-10,x=-w/2,y=-h/2,open=door.breached;
  g.roundRect(x-2,y+3,w+4,h,7).fill(0x111b20);
  g.roundRect(x,y,w,h,7).fill(0x536064).stroke({color:0x899086,width:2});
  g.roundRect(x+6,y+7,w-12,h-13,Math.min(18,w/3)).fill(open?0x0b1720:0x4c3b2c).stroke({color:0x927b53,width:2});
  for(let n=1;n<5;n++){const px=x+7+(w-14)*n/5;g.moveTo(px,y+12).lineTo(px,y+h-10).stroke({color:open?0x16363c:0x786047,width:2,alpha:.7});}
  if(!open){
    for(const py of [y+h*.32,y+h*.7]){g.rect(x+7,py,w-14,7).fill(0x58636a);for(const px of [x+12,x+w/2,x+w-13])g.circle(px,py+3.5,1.7).fill(0xa7ad9f);}
    g.roundRect(-9,-12,18,23,4).fill(0x9c7b43).stroke({color:0xe8c780,width:1});g.circle(0,-5,3).fill(INK);g.poly([-1,-3,1,-3,3,4,-3,4]).fill(INK);
  }
  if(open){g.ellipse(0,9,Math.min(w*.3,29),Math.min(h*.32,27)).fill({color:0xc9b976,alpha:.15});text(c,'↥',0,-4,31,0xe5dba6);}
  text(c,'ВЫХОД',0,h/2-9,width>85?11:9,open?0xc6ecce:BONE);
  g.roundRect(-Math.min(w-8,120)/2,y+3,Math.min(w-8,120),17,3).fill(0x1b242a);text(c,open?'ОТКРЫТО':'ЦЕЛЬ',0,y+11,width>85?11:8.5,0xebd5a5);
  return c;
}

/** Shield guard and Jailer drawn without illustrations; the active shield edge is a separate plate. */
export function makeGuardEnemy(cell:ForestCell):Container{
  const c=new Container(),g=new Graphics(),col=cell.color===null?0xbbbec0:COLORS[cell.color];
  const ready=cell.intent.cells.length>0&&(cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  if(ready){const aura=new Graphics();aura.label='attack-aura';aura.roundRect(-36,-36,72,72,12).fill({color:0xe8a365,alpha:.13}).stroke({color:0xf1ae76,width:2.5,alpha:.95});c.addChild(aura);}
  c.addChild(g);g.ellipse(0,27,27,7).fill({color:0x071217,alpha:.6});
  if(cell.variant==='jailer'){
    // A squat warder with an oversized iron shield; the active edge is drawn separately.
    g.poly([-21,11,-26,28,-13,29,-9,14,10,14,15,29,27,27,20,8]).fill(0x384b58).stroke({color:INK,width:3});
    g.poly([-26,1,-18,-25,13,-25,24,3,15,24,-18,24]).fill(0x5e7480).stroke({color:INK,width:3});
    g.poly([-23,-19,-16,-31,16,-31,23,-19]).fill(0x8f9da1).stroke({color:INK,width:2});
    g.rect(-13,-14,26,7).fill(0x1a2932);g.rect(-10,-12,6,3).fill(BONE).rect(4,-12,6,3).fill(BONE);
    g.poly([-13,6,0,11,13,6,10,22,-11,22]).fill(0x9f715a);
    g.moveTo(27,ready?-27:-8).lineTo(26,25).stroke({color:0xc8c6b1,width:5});
    g.poly([17,ready?-31:-13,36,ready?-33:-15,36,ready?-23:-5,17,ready?-21:-3]).fill(0xa9aa9e).stroke({color:INK,width:2});
    if(cell.behavior.restTurns>0)g.poly([20,7,31,11,26,26]).fill(0x667b83);
  }else{
    // Shield guard: broad square body, riveted bands and four feet; the weapon rises with an announced strike.
    g.poly([-24,12,-27,28,-18,30,-13,14,13,14,18,30,27,28,24,12]).fill(0x59666b).stroke({color:INK,width:2});
    g.roundRect(-23,-26,46,46,5).fill(0x514b43).stroke({color:0xadb5ab,width:3});
    g.poly([-18,-22,18,-22,17,14,-17,14]).fill(col);
    g.rect(-23,-18,46,7).fill(0x56686e).rect(-23,6,46,7).fill(0x56686e);
    for(const x of [-19,19])for(const y of [-15,9])g.circle(x,y,2).fill(0xe6d4a9);
    g.poly([-13,-5,-3,-2,-5,3,-12,1]).fill(INK).poly([13,-5,3,-2,5,3,12,1]).fill(INK);
    g.rect(-10,-2,5,2).fill(ready?0xffc17d:BONE).rect(5,-2,5,2).fill(ready?0xffc17d:BONE);
    g.roundRect(-28,15,56,8,3).fill(0x8b9390).stroke({color:INK,width:2});sigil(g,cell.color,0,18);
    const weaponTop=ready?-26:-3;
    g.moveTo(-29,23).lineTo(-29,weaponTop).stroke({color:0x80694e,width:4});
    g.roundRect(-36,weaponTop-2,15,9,2).fill(0xaab9b5).stroke({color:INK,width:2});
  }
  if(cell.shield&&shieldIsActive(cell)){
    // The bright plate marks the actual protected edge, not a second attack zone.
    const plate=new Graphics();plate.label='directional-shield';plate.rotation=Math.atan2(cell.shield.dy,cell.shield.dx);
    plate.moveTo(35,-26).lineTo(38,-21).lineTo(38,21).lineTo(35,26).stroke({color:0xe4c786,width:4.5,cap:'round'});
    plate.poly([29,-12,38,-8,38,7,32,13,27,7,27,-7]).fill(0x6b828b).stroke({color:0xf2deaa,width:2});
    plate.moveTo(32,-7).lineTo(32,7).stroke({color:0xd6e1d9,width:2});
    c.addChildAt(plate,c.children.indexOf(g));
  }
  status(c,g,cell);addDamageEffectBadges(c,cell.damageEffects);return c;
}
