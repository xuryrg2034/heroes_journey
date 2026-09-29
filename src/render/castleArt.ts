import { Container, Graphics, Text } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';
import { meleeCanAttack } from '../game/enemyLifecycle';
import { shieldIsActive } from '../game/combatRules';
import { addDamageEffectBadges } from './damageEffectBadges';

const INK=0x172024, BONE=0xeadbb9, COLORS=[0xca7970,0x9fba7c,0x79b0c4,0xd8b66a,0xb69ad2];
function text(c:Container,value:string,x:number,y:number,size=11,color=BONE){const t=new Text({text:value,style:{fontFamily:'Georgia, serif',fontSize:size,fontWeight:'bold',fill:color}});t.anchor.set(.5);t.position.set(x,y);c.addChild(t);return t;}

export function drawKey(g:Graphics,x:number,y:number,scale=1){
  g.circle(x-5*scale,y,4*scale).stroke({color:0xffd480,width:2.3*scale});
  g.moveTo(x-1*scale,y).lineTo(x+10*scale,y).lineTo(x+10*scale,y+4*scale).moveTo(x+6*scale,y).lineTo(x+6*scale,y+3*scale).stroke({color:0xffd480,width:2.3*scale});
}
function sigil(g:Graphics,color:number|null,x:number,y:number){
  if(color===0)g.poly([x,y-5,x+5,y+4,x-5,y+4]).fill(BONE);
  else if(color===1)g.moveTo(x,y-5).lineTo(x,y+5).moveTo(x-5,y).lineTo(x+5,y).stroke({color:BONE,width:2});
  else if(color===2)g.rect(x-4,y-4,8,8).stroke({color:BONE,width:2});
  else if(color===3)g.circle(x,y,4).stroke({color:BONE,width:2});
  else if(color===4)g.moveTo(x-4,y-4).lineTo(x+4,y+4).moveTo(x+4,y-4).lineTo(x-4,y+4).stroke({color:BONE,width:2});
}
function status(c:Container,g:Graphics,cell:ForestCell){
  const ready=cell.intent.cells.length>0&&(cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  const summoning=cell.variant==='beacon'&&!!cell.intent.summonCells?.length&&!cell.status.frozen&&cell.behavior.restTurns===0;
  if(cell.status.frozen||ready||summoning||cell.behavior.restTurns){
    g.roundRect(-35,-35,18,18,3).fill(ready?0x85433a:summoning?0x285b60:0x243032).stroke({color:ready?0xe9a879:summoning?0x9de3d3:0x61767a,width:1});
    text(c,cell.status.frozen?'❄':ready?'!':summoning?'✦':'Ⅱ',-26,-26,12);
  }
  if(cell.hp>0){g.roundRect(6,-35,31,18,3).fill(0x253238).stroke({color:0xb5b79c,width:1});text(c,`${cell.hp}♥`,22,-26,12);}
  if(cell.status.wet)g.poly([-28,13,-23,22,-27,26,-32,22]).fill(0x8fd9de);
  if(cell.status.frozen)g.poly([-32,-15,-19,-29,20,-29,33,-11,26,29,-23,29]).fill({color:0xabf0eb,alpha:.17}).stroke({color:0xb0edee,width:2});
  if(cell.status.brittle){g.circle(27,22,10).fill(0x38585c);text(c,'×2',27,22,11,0xd7ffff);}
  if(cell.carriesKey){g.roundRect(-16,-40,32,12,4).fill(0x5a492c).stroke({color:0xf5d08a,width:1});drawKey(g,0,-34,.7);}
}

export function makeDoor(cell:ForestCell,width:number,height:number,customExit=false):Container{
  const c=new Container(),g=new Graphics();c.addChild(g);const door=cell.door!;
  const w=width-10,h=height-10,x=-w/2,y=-h/2,magic=door.magic,open=door.breached;
  g.roundRect(x-2,y+3,w+4,h,7).fill(0x111b20);
  g.roundRect(x,y,w,h,7).fill(0x536064).stroke({color:0x899086,width:2});
  g.roundRect(x+6,y+7,w-12,h-13,Math.min(18,w/3)).fill(open?0x0b1720:magic?0x303144:0x4c3b2c).stroke({color:magic?0x9991bf:0x927b53,width:2});
  for(let n=1;n<5;n++){const px=x+7+(w-14)*n/5;g.moveTo(px,y+12).lineTo(px,y+h-10).stroke({color:open?0x16363c:magic?0x555775:0x786047,width:2,alpha:.7});}
  if(!open&&!magic){
    for(const py of [y+h*.32,y+h*.7]){g.rect(x+7,py,w-14,7).fill(0x58636a);for(const px of [x+12,x+w/2,x+w-13])g.circle(px,py+3.5,1.7).fill(0xa7ad9f);}
    g.roundRect(-9,-12,18,23,4).fill(0x9c7b43).stroke({color:0xe8c780,width:1});g.circle(0,-5,3).fill(INK);g.poly([-1,-3,1,-3,3,4,-3,4]).fill(INK);
  }
  if(magic){
    const rune=new Graphics();rune.label='magic-door';
    rune.circle(0,-2,Math.min(w*.3,25)).stroke({color:open?0x9be1d1:0xaf9fec,width:2,alpha:.85});
    rune.poly([0,-24,22,13,-22,13]).stroke({color:open?0x7cdec4:0x9f89db,width:1.5,alpha:.9});
    if(!open)rune.moveTo(-21,-19).lineTo(21,20).moveTo(21,-19).lineTo(-21,20).stroke({color:0xd9caff,width:3});
    c.addChild(rune);
  }
  if(open){g.ellipse(0,9,Math.min(w*.3,29),Math.min(h*.32,27)).fill({color:magic?0x83d9d4:0xc9b976,alpha:.15});text(c,'↥',0,-4,31,0xe5dba6);}
  const arrow=door.branch==='left'?'←':door.branch==='right'?'→':'↑';
  const shortNames={forest:'ЛЕС',gate:'ВОРОТА',banquet:'ПИР',barracks:'СТРАЖА',chess:'ШАХМАТЫ',library:'КНИГИ',wizard:'БАШНЯ'};
  text(c,`${arrow} ${customExit?'ВЫХОД':width>85?door.label:shortNames[door.destination]}`,0,h/2-9,width>85?11:9,open?0xc6ecce:BONE);
  const top=customExit?(open?'ОТКРЫТО':'ЦЕЛЬ'):magic?(open?'ПЕЧАТЬ СНЯТА':'ПЕЧАТЬ'):open?'ОТКРЫТО':`${cell.hp} HP · КЛЮЧ`;
  g.roundRect(-Math.min(w-8,120)/2,y+3,Math.min(w-8,120),17,3).fill(0x1b242a);text(c,top,0,y+11,width>85?11:8.5,magic?0xcabbed:0xebd5a5);
  if(!magic&&!open){g.rect(x+8,y+h-3,w-16,3).fill(0x272827);g.rect(x+8,y+h-3,(w-16)*Math.max(0,cell.hp/cell.maxHp),3).fill(0xc59465);}
  return c;
}

export function makeCastleEnemy(cell:ForestCell):Container{
  const c=new Container(),g=new Graphics(),col=cell.color===null?0xbbbec0:COLORS[cell.color];
  const ready=cell.intent.cells.length>0&&(cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  const summoning=cell.variant==='beacon'&&!!cell.intent.summonCells?.length&&!cell.status.frozen&&cell.behavior.restTurns===0;
  if(ready||summoning){const aura=new Graphics();aura.label=summoning?'summon-aura':'attack-aura';aura.roundRect(-36,-36,72,72,12).fill({color:summoning?0x63c5bb:cell.variant==='wizard'?0xb893df:0xe8a365,alpha:.13}).stroke({color:summoning?0x9de3d3:cell.variant==='wizard'?0xd8b8ff:0xf1ae76,width:2.5,alpha:.95});c.addChild(aura);}
  c.addChild(g);g.ellipse(0,27,27,7).fill({color:0x071217,alpha:.6});
  switch(cell.variant){
    case 'jailer': {
      // A squat warder with an oversized iron shield; the active edge is drawn separately.
      g.poly([-21,11,-26,28,-13,29,-9,14,10,14,15,29,27,27,20,8]).fill(0x384b58).stroke({color:INK,width:3});
      g.poly([-26,1,-18,-25,13,-25,24,3,15,24,-18,24]).fill(0x5e7480).stroke({color:INK,width:3});
      g.poly([-23,-19,-16,-31,16,-31,23,-19]).fill(0x8f9da1).stroke({color:INK,width:2});
      g.rect(-13,-14,26,7).fill(0x1a2932);g.rect(-10,-12,6,3).fill(BONE).rect(4,-12,6,3).fill(BONE);
      g.poly([-13,6,0,11,13,6,10,22,-11,22]).fill(0x9f715a);
      g.moveTo(27,ready?-27:-8).lineTo(26,25).stroke({color:0xc8c6b1,width:5});
      g.poly([17,ready?-31:-13,36,ready?-33:-15,36,ready?-23:-5,17,ready?-21:-3]).fill(0xa9aa9e).stroke({color:INK,width:2});
      if(cell.behavior.restTurns>0)g.poly([20,7,31,11,26,26]).fill(0x667b83);
      break;
    }
    case 'beacon': {
      // A caged signal crystal reads as a source rather than a combatant.
      g.poly([-22,24,-16,16,15,16,22,24,18,30,-18,30]).fill(0x56616c).stroke({color:INK,width:3});
      g.poly([-18,19,-17,-14,-8,-25,8,-25,17,-14,18,19]).fill(0x66717a).stroke({color:INK,width:3});
      g.poly([0,-35,15,-12,10,13,0,23,-11,12,-15,-12]).fill(summoning?0xa4e7d7:0x74b8b5).stroke({color:0xd3eee0,width:2});
      g.poly([0,-35,0,23,-11,12,-15,-12]).fill({color:0x254e63,alpha:.65});
      g.moveTo(-22,-18).lineTo(22,18).moveTo(22,-18).lineTo(-22,18).stroke({color:0x9ca59f,width:3,alpha:.75});
      g.circle(0,2,4).fill(0xf8deaa);
      break;
    }
    case 'sentinel': {
      // A walking iron-bound seat: broad square back, riveted bands and four feet.
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
      break;
    }
    case 'chair': case 'stool': {
      const chair=cell.variant==='chair',backTop=chair?-26:-12;
      g.poly([-23,10,-26,28,-19,29,-14,10,13,10,20,28,26,27,22,7]).fill(0x806449).stroke({color:INK,width:2});
      g.roundRect(-21,backTop,42,10-backTop,3).fill(0x624c38).stroke({color:0xac8d60,width:3});
      g.rect(-14,backTop+4,28,7-backTop).fill(col);g.roundRect(-27,7,54,9,3).fill(0x997345).stroke({color:INK,width:2});
      const eyes=chair?-12:-6;
      g.poly([-11,eyes,-2,eyes+3,-5,eyes+8,-11,eyes+6]).fill(INK).poly([11,eyes,2,eyes+3,5,eyes+8,11,eyes+6]).fill(INK);
      g.rect(-9,eyes+3,4,2).fill(0xffd393).rect(5,eyes+3,4,2).fill(0xffd393);sigil(g,cell.color,0,chair?1:20);
      if(chair){g.circle(-19,-23,2).fill(BONE).circle(19,-23,2).fill(BONE);}
      if(ready)g.moveTo(-23,7).lineTo(-33,-5).lineTo(-31,-18).moveTo(23,7).lineTo(33,-5).lineTo(31,-18).stroke({color:0xc0965e,width:5});
      break;
    }
    case 'cabinet': {
      g.roundRect(-27,-23,54,48,4).fill(0x654a3a).stroke({color:0xa38965,width:3});
      g.poly([-27,-20,-16,-29,18,-29,27,-20]).fill(col).stroke({color:INK,width:2});
      g.rect(-23,-12,46,12).fill(col);g.rect(-23,5,46,14).fill(0x493b32);
      g.circle(-12,-6,3).fill(0xffcd8c).circle(12,-6,3).fill(0xffcd8c);
      g.poly([-19,7,-12,13,-7,7,0,13,7,7,13,13,19,7]).fill(BONE);sigil(g,cell.color,0,-19);
      g.rect(-24,25,8,5).fill(0x867054).rect(16,25,8,5).fill(0x867054);
      if(ready)g.poly([-25,18,-35,10,-33,-5,-26,-2,26,-2,33,-5,35,10,25,18]).stroke({color:0xc3a16b,width:3});
      break;
    }
    case 'rook': case 'bishop': case 'knight': {
      g.poly([-27,27,-24,18,-17,14,-11,-10,11,-10,17,14,24,18,27,27]).fill(col).stroke({color:INK,width:3});
      g.ellipse(0,20,24,7).fill(0x62777a).stroke({color:0xb7c7c0,width:1});g.rect(-17,23,34,5).fill(col);
      if(cell.variant==='rook'){
        g.poly([-20,-8,-21,-29,-12,-29,-12,-21,-5,-21,-5,-30,5,-30,5,-21,12,-21,12,-29,21,-29,20,-8]).fill(col).stroke({color:INK,width:2});
        g.rect(-15,-14,30,8).fill(0x506875);g.rect(-9,-12,5,3).fill(BONE).rect(4,-12,5,3).fill(BONE);
      }else if(cell.variant==='bishop'){
        g.poly([0,-35,16,-20,12,-9,5,-4,-5,-4,-12,-9,-16,-20]).fill(col).stroke({color:INK,width:2});
        g.moveTo(5,-28).lineTo(-3,-15).stroke({color:0x344653,width:4});g.circle(0,-35,3).fill(BONE);
      }else{
        g.poly([-17,7,-14,-7,-23,-12,-16,-26,-7,-33,-1,-23,13,-22,22,-11,16,-4,8,-9,4,6]).fill(col).stroke({color:INK,width:2});
        g.poly([-16,-23,-24,-16,-21,-9,-12,-6,-17,6,-6,7,-3,-13]).fill(0x485762);g.circle(8,-15,2.5).fill(BONE);
      }
      sigil(g,cell.color,0,14);if(ready)g.moveTo(-29,15).lineTo(-33,8).moveTo(29,15).lineTo(33,8).stroke({color:0xe8bc7a,width:2});
      break;
    }
    case 'wizard': {
      const sealed=cell.bossStage===1;
      const runes=new Graphics();runes.label='wizard-runes';runes.circle(0,0,31).stroke({color:0xa3a6e9,width:1.3,alpha:.8}).poly([0,-33,29,17,-29,17]).stroke({color:0xc3a0e1,width:1,alpha:.65});c.addChildAt(runes,0);
      g.poly([-23,28,-16,0,-12,-13,10,-13,17,2,24,28,0,22]).fill(0x726c9f).stroke({color:INK,width:2});
      g.poly([-18,-13,-8,-34,0,-39,9,-15,24,-11,-27,-11]).fill(0x817caa).stroke({color:0xbcb3df,width:1});
      g.poly([-11,-9,11,-9,7,5,0,12,-7,5]).fill(0xc7b6a1);g.rect(-8,-5,5,2).fill(0xcafff3).rect(3,-5,5,2).fill(0xcafff3);
      g.poly([-7,4,7,4,1,18]).fill(BONE);g.moveTo(26,-27).lineTo(23,29).stroke({color:0xafa08b,width:4});
      g.poly([27,-35,34,-25,26,-16,19,-25]).fill(ready?0xc4fff1:0x86b5cb).stroke({color:0xe0e1c7,width:1});
      if(ready)g.moveTo(-14,3).lineTo(-30,-12).lineTo(-32,-23).stroke({color:0xb6a5dd,width:5});
      if(sealed){g.ellipse(0,-1,32,35).fill({color:0x8ed9ed,alpha:.15}).stroke({color:0xc5f3f0,width:2.5,alpha:.95});g.poly([0,-23,21,12,-21,12]).stroke({color:0xcaf2f2,width:1.5,alpha:.8});}
      text(c,sealed?'ПЕЧАТЬ I':'КОЛДУН II',0,31,8.5,sealed?0xc8f3f2:0xe2c1f1);break;
    }
    default: {
      const chief=cell.variant==='commander';
      g.poly([-25,25,-20,-1,-12,-19,12,-19,22,-1,26,25]).fill(0x67747b).stroke({color:INK,width:3});
      g.poly([-13,-8,-12,-27,0,-34,14,-24,14,-8,0,4]).fill(0xa0adb0).stroke({color:0x34454d,width:2});
      g.rect(-11,-17,23,6).fill(0x21333a);g.rect(-8,-15,6,2).fill(ready?0xffc893:BONE).rect(4,-15,6,2).fill(ready?0xffc893:BONE);
      g.poly([-13,2,0,8,15,2,18,23,-18,23]).fill(col);sigil(g,cell.color,0,17);
      g.poly([-26,-1,-11,2,-12,24,-22,31,-32,21,-33,4]).fill(chief?0x8a744e:0x536e79).stroke({color:BONE,width:1});
      g.moveTo(28,ready?-32:-7).lineTo(25,26).stroke({color:0xcdd5c9,width:3});g.moveTo(19,8).lineTo(33,8).stroke({color:0xc9ad72,width:3});
      if(chief)g.poly([-8,-29,-13,-37,0,-34,10,-39,14,-28]).fill(0xc19d63);
      break;
    }
  }
  if((cell.variant==='sentinel'||cell.variant==='jailer')&&cell.shield&&shieldIsActive(cell)){
    // The bright plate marks the actual protected edge, not a second attack zone.
    const plate=new Graphics();plate.label='directional-shield';plate.rotation=Math.atan2(cell.shield.dy,cell.shield.dx);
    plate.moveTo(35,-26).lineTo(38,-21).lineTo(38,21).lineTo(35,26).stroke({color:0xe4c786,width:4.5,cap:'round'});
    plate.poly([29,-12,38,-8,38,7,32,13,27,7,27,-7]).fill(0x6b828b).stroke({color:0xf2deaa,width:2});
    plate.moveTo(32,-7).lineTo(32,7).stroke({color:0xd6e1d9,width:2});
    c.addChildAt(plate,c.children.indexOf(g));
  }
  status(c,g,cell);addDamageEffectBadges(c,cell.damageEffects);return c;
}

/** One original creature spans the whole rectangle; health belongs to its identity. */
export function makeWardrobe(cell:ForestCell,width:number,height:number):Container{
  const c=new Container(),g=new Graphics(),col=cell.color===null?0xbbbec0:COLORS[cell.color];c.addChild(g);
  const w=width-15,h=height-18,x=-w/2,y=-h/2,ready=cell.intent.cells.length>0&&meleeCanAttack(cell);
  g.ellipse(0,h/2-2,w*.47,10).fill({color:0x081015,alpha:.7});
  if(ready){const aura=new Graphics();aura.label='attack-aura';aura.roundRect(x-4,y-3,w+8,h+6,12).fill({color:0xf0a969,alpha:.1}).stroke({color:0xf1ae76,width:3});c.addChildAt(aura,0);}
  g.poly([x+7,y+h-16,x+3,y+h+3,x+23,y+h+4,x+30,y+h-13,-x-30,y+h-13,-x-23,y+h+4,-x-3,y+h+3,-x-7,y+h-16]).fill(0x5a6566).stroke({color:INK,width:3});
  g.roundRect(x,y,w,h-6,8).fill(0x544839).stroke({color:0x9b9680,width:3});
  g.poly([x-3,y+10,x+12,y-5,-x-12,y-5,-x+3,y+10]).fill(0x7b7561).stroke({color:INK,width:2});
  for(const side of [-1,1]){const left=side<0?x+10:5;g.roundRect(left,y+18,w/2-15,h-42,4).fill(col).stroke({color:0x394647,width:4});
    g.rect(left+5,y+25,w/2-25,h-57).stroke({color:0xbac6a0,width:1,alpha:.5});
    g.circle(side*10,7,4).fill(0xefcf83);g.moveTo(side*10,7).lineTo(side*10,16).stroke({color:0xcfa96b,width:3});}
  g.poly([-33,-18,-7,ready?-11:-15,-12,-7,-31,-10,7,ready?-11:-15,33,-18,31,-10,12,-7]).fill(ready?0xffd398:0xe3dbbb);
  g.poly([-26,29,26,29,19,41,-19,41]).fill(0x172024);for(const px of [-17,-6,6,17])g.poly([px-3,29,px+3,29,px,35]).fill(BONE);
  sigil(g,cell.color,0,-35);
  if(cell.hp>0){g.roundRect(x+7,y+4,45,20,4).fill(0x222e33).stroke({color:0xc5c2a4,width:1});text(c,`${cell.hp}♥`,x+29,y+14,14);}
  if(cell.status.frozen||ready){g.circle(-x-17,y+15,10).fill(ready?0x85433a:0x253438);text(c,cell.status.frozen?'❄':'!',-x-17,y+15,14);}
  if(cell.status.wet)g.poly([x+11,h/2-29,x+16,h/2-19,x+10,h/2-14,x+5,h/2-19]).fill(0x8fd9de);
  if(cell.status.frozen)g.roundRect(x+3,y+3,w-6,h-12,7).fill({color:0xabf0eb,alpha:.16}).stroke({color:0xb0edee,width:2});
  addDamageEffectBadges(c,cell.damageEffects,h/2-35);
  return c;
}
