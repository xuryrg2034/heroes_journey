/**
 * Art the real-time view takes from the removed turn-based renderer (src/render/art.ts, tag `turn-based-final`): the chain
 * colours, the pale ink, the hero (the cat barbarian; the PNG when loaded, else the drawn one) and the terrain tiles. Moved
 * without change.
 */
import { Container, Graphics } from 'pixi.js';
import { characterSprite } from './characterAssets';

/** Terrain tiles the drawing knows (the arena view draws walls and trees). */
export type TerrainKind = 'floor' | 'tree' | 'pond' | 'campfire' | 'puddle' | 'wall' | 'thorns' | 'pillar' | 'crate' | 'barrel';
/** Enemy colours 0–4: red, green, blue, ochre, amethyst. */
export const COLORS = [0xca7970, 0x9fba7c, 0x79b0c4, 0xd8b66a, 0xb69ad2];
export const PALE = 0xf2dfb4;
/** The heroes the view draws: the cat barbarian (the loadout without `hero`) and Ведунья (task 49, `Loadout.hero` `toad`). */
export type HeroArtId = 'cat' | 'toad';
/**
 * Task 49: Ведунья, the second hero — the sprite `toad.png`; without it a drawn toad of ANOTHER silhouette than the cat (a squat wide
 * body and a huge pointed hat, no ears, no upright tail; the colours slate and deep navy with a turquoise ring, never the chain's five).
 */
export function makeToad(size=1,outline=false):Container{
  const sprite=characterSprite('toad',84*size,78*size);
  if(sprite){
    const c=new Container();
    // Task 49 (design): the hero's own thin pale outline (1.5 px, 60 %) keeps her slate and navy off the dark floor: tinted copies round her.
    if(outline)for(let k=0;k<8;k++){const a=characterSprite('toad',84*size,78*size);if(!a)break;const t=k/8*Math.PI*2;a.tint=0xe8efe0;a.alpha=0.6;a.position.set(Math.cos(t)*1.5,-2*size+Math.sin(t)*1.5);c.addChild(a);}
    sprite.position.set(0,-2*size);c.addChild(sprite);return c;
  }
  const c=new Container(),g=new Graphics();c.addChild(g);c.scale.set(size);
  g.ellipse(0,27,30,7).fill({color:0x0b1512,alpha:0.6});
  // The squat body and the webbed feet.
  g.ellipse(0,14,27,16).fill(0x5c6677).stroke({color:0x24251c,width:2.5});
  g.ellipse(0,18,17,10).fill(0xe3cd8a);
  g.ellipse(-20,25,10,4.5).fill(0x5c6677).stroke({color:0x24251c,width:2}).ellipse(20,25,10,4.5).fill(0x5c6677).stroke({color:0x24251c,width:2});
  // The shawl and the staff with its ember.
  g.poly([-22,6,-8,2,0,10,8,2,22,6,16,20,-16,20]).fill(0x3a2f6a).stroke({color:0x24251c,width:2});
  g.moveTo(25,24).lineTo(28,-22).stroke({color:0x6b4a2c,width:4,cap:'round'});g.circle(28,-25,4.5).fill(0xf08a3c).stroke({color:0x24251c,width:1.5});
  // The head is wide and flat, under the hat's wide brim.
  g.ellipse(0,-3,25,13).fill(0x6a7586).stroke({color:0x24251c,width:2.5});
  g.moveTo(-17,0).quadraticCurveTo(0,8,17,0).stroke({color:0x24251c,width:2});
  g.ellipse(-14,1,5,3.5).fill(0xe0856a).ellipse(14,1,5,3.5).fill(0xe0856a);
  g.ellipse(-9,-7,4.5,3).fill(0xe8d27a).stroke({color:0x24251c,width:1.5}).ellipse(9,-7,4.5,3).fill(0xe8d27a).stroke({color:0x24251c,width:1.5});
  g.rect(-13,-9.5,8,2.5).fill(0x24251c).rect(5,-9.5,8,2.5).fill(0x24251c);
  // The pointed hat: a wide brim and a bent tip.
  g.ellipse(0,-14,34,8).fill(0x2b2358).stroke({color:0x14213d,width:2.5});
  g.poly([-19,-15,-4,-52,10,-49,2,-42,19,-15]).fill(0x3b2f78).stroke({color:0x14213d,width:2.5});
  g.rect(-18,-21,36,4).fill(0x4d63b8);
  // The turquoise ring she draws.
  g.circle(-30,-4,9).stroke({color:0x3fd6c8,width:3,alpha:0.9});
  return c;
}
export function makePlayer(hero:HeroArtId='cat'):Container{
  if(hero==='toad')return makeToad(1,true);
  const sprite=characterSprite('player',72,70);
  if(sprite){const c=new Container();c.addChild(sprite);return c;}
  const c=new Container(),g=new Graphics();c.addChild(g);
  g.ellipse(0,27,25,7).fill({color:0x0b1512,alpha:0.6});
  // Upright tail, tufted ears, whiskers and an oversized axe: a cat barbarian.
  g.moveTo(-13,20).bezierCurveTo(-39,31,-35,1,-24,4).stroke({color:0xc8995c,width:7,cap:'round'});
  g.poly([-15,24,-16,5,16,5,18,24,6,25,0,20,-7,26]).fill(0x9f714a).stroke({color:0x24251c,width:2});
  g.poly([-21,-2,-22,-28,-9,-18,0,-22,10,-18,24,-29,21,-1,13,10,-11,10]).fill(0xe5bf7a).stroke({color:0x24251c,width:2.5});
  g.poly([-18,-21,-11,-15,-18,-9]).fill(0xac6951).poly([19,-22,12,-16,19,-10]).fill(0xac6951);
  g.poly([-14,-7,-3,-4,-5,1,-12,0]).fill(0x26342a).poly([14,-7,3,-4,5,1,12,0]).fill(0x26342a);
  g.rect(-9,-4,2,4).fill(PALE).rect(7,-4,2,4).fill(PALE);g.poly([-3,3,3,3,0,6]).fill(0x614237);
  g.moveTo(-7,8).lineTo(0,9).lineTo(7,7).moveTo(-11,3).lineTo(-24,0).moveTo(-11,7).lineTo(-25,7).moveTo(11,3).lineTo(25,0).moveTo(11,7).lineTo(24,8).stroke({color:0xeee0b7,width:1});
  g.poly([-17,9,-9,5,-5,12,0,9,7,12,11,6,18,10,15,17,-15,17]).fill(0x615f4b).stroke({color:0xbcb394,width:1});
  g.rect(-15,19,29,4).fill(0x48352c).rect(-3,18,7,6).fill(0xcbb078);
  g.moveTo(24,-8).lineTo(20,28).stroke({color:0x554232,width:5});
  g.poly([23,-19,36,-20,37,-7,27,-6,20,-10,12,-6,11,-18]).fill(0xc0c8b6).stroke({color:0x334139,width:2});
  g.moveTo(35,-18).lineTo(35,-9).stroke({color:0xf0ead0,width:2});return c;
}
/** Spikes along the tile rim, pointing inward. Also drawn above an occupant so the thorns stay visible without hiding its color. */
export function drawThornRim(g:Graphics,x:number,y:number,alpha:number){
  const half=34,len=8;
  for(let n=0;n<5;n++){
    const t=-27+n*13.5;
    g.poly([x+t-4,y-half,x+t+4,y-half,x+t,y-half+len]).fill({color:0xd6bb7a,alpha}).stroke({color:0x2a2415,width:1,alpha});
    g.poly([x+t-4,y+half,x+t+4,y+half,x+t,y+half-len]).fill({color:0xd6bb7a,alpha}).stroke({color:0x2a2415,width:1,alpha});
    g.poly([x-half,y+t-4,x-half,y+t+4,x-half+len,y+t]).fill({color:0xd6bb7a,alpha}).stroke({color:0x2a2415,width:1,alpha});
    g.poly([x+half,y+t-4,x+half,y+t+4,x+half-len,y+t]).fill({color:0xd6bb7a,alpha}).stroke({color:0x2a2415,width:1,alpha});
  }
}
export function drawTerrain(g:Graphics,kind:TerrainKind,x:number,y:number) {
  if(kind==='wall'){
    g.roundRect(x-36,y-35,72,70,4).fill(0x515b61).stroke({color:0x252f35,width:2});
    for(const py of [-22,0,22]){g.moveTo(x-34,y+py).lineTo(x+34,y+py).stroke({color:0x252e34,width:3});g.moveTo(x+(py===0?-14:12),y+py-20).lineTo(x+(py===0?-14:12),y+py).stroke({color:0x303a40,width:3});}
    g.moveTo(x-32,y-31).lineTo(x+31,y-31).stroke({color:0x929e9f,width:2,alpha:.5});
    g.poly([x-30,y+27,x-17,y+21,x-6,y+29,x-25,y+32]).fill({color:0x738170,alpha:.6});
  } else if(kind==='tree') {
    g.ellipse(x,y+24,31,11).fill({color:0x101c15,alpha:0.6});g.rect(x-6,y-13,13,41).fill(0x725938);
    g.poly([x-31,y+8,x-17,y-13,x-26,y-12,x,y-38,x+26,y-12,x+18,y-12,x+33,y+9,x+8,y+15,x,y+10,x-11,y+17]).fill(0x344d32).stroke({color:0x1a3023,width:2});
    g.poly([x-22,y-11,x,y-34,x+4,y-15,x+20,y-10,x+4,y-6,x+2,y+6,x-19,y+8,x-7,y-5]).fill({color:0x78935b,alpha:0.35});
    g.moveTo(x-3,y+19).lineTo(x-3,y+28).stroke({color:0x9b8050,width:2});
  } else if(kind==='pillar') {
    // Task 38: the garrison's stone pillar in a tree's place — a square base, a shaft of blocks, a capital.
    g.ellipse(x,y+24,30,10).fill({color:0x0b0e11,alpha:0.6});
    g.roundRect(x-22,y+10,44,16,3).fill(0x59636b).stroke({color:0x1c2228,width:2});
    g.roundRect(x-15,y-26,30,38,3).fill(0x6c7780).stroke({color:0x1c2228,width:2});
    for(const py of [-14,-2])g.moveTo(x-14,y+py).lineTo(x+14,y+py).stroke({color:0x3f4850,width:2});
    g.roundRect(x-21,y-36,42,12,3).fill(0x7f8a92).stroke({color:0x1c2228,width:2});
    g.moveTo(x-12,y-24).lineTo(x-12,y+8).stroke({color:0xa9b4bb,width:2,alpha:.45});
  } else if(kind==='crate') {
    // Task 38: a stack of supply crates — two boards, iron corners.
    g.ellipse(x,y+24,30,9).fill({color:0x0b0e11,alpha:0.55});
    for(const [ox,oy,s] of [[-12,8,24],[12,10,22],[0,-12,24]] as const){
      g.rect(x+ox-s/2,y+oy-s/2,s,s).fill(0x7a5a36).stroke({color:0x2a1d10,width:2});
      g.moveTo(x+ox-s/2,y+oy-s/2).lineTo(x+ox+s/2,y+oy+s/2).moveTo(x+ox+s/2,y+oy-s/2).lineTo(x+ox-s/2,y+oy+s/2).stroke({color:0x4d3820,width:2});
      for(const [cx,cy] of [[-1,-1],[1,-1],[-1,1],[1,1]] as const)g.rect(x+ox+cx*s/2-(cx>0?4:0),y+oy+cy*s/2-(cy>0?4:0),4,4).fill(0x8f9aa2);
    }
  } else if(kind==='barrel') {
    // Task 38: two barrels with iron hoops.
    g.ellipse(x,y+24,30,9).fill({color:0x0b0e11,alpha:0.55});
    for(const ox of [-11,11]){
      g.roundRect(x+ox-12,y-22,24,44,9).fill(0x6e4a2a).stroke({color:0x2a1d10,width:2});
      for(const py of [-13,0,13])g.moveTo(x+ox-12,y+py).lineTo(x+ox+12,y+py).stroke({color:0x8f9aa2,width:3});
      g.ellipse(x+ox,y-21,11,4).fill(0x8b6440).stroke({color:0x2a1d10,width:1.5});
    }
  } else if(kind==='pond'||kind==='puddle') {
    const deep=kind==='pond';g.ellipse(x,y+6,deep?32:31,deep?27:17).fill(deep?0x243c3d:0x344d45).stroke({color:0x73918a,width:deep?3:1,alpha:0.6});
    g.ellipse(x+3,y+4,deep?24:23,deep?18:10).fill({color:0x548b88,alpha:0.3});
    g.moveTo(x-19,y+3).quadraticCurveTo(x-8,y-1,x+3,y+3).moveTo(x-6,y+12).quadraticCurveTo(x+4,y+9,x+17,y+12).stroke({color:0x91b7ac,width:1,alpha:0.6});
    if(deep) for(let n=0;n<4;n++)g.ellipse(x-29+n*18,y+26-(n%2)*3,7,4).fill(0x78806b);
  } else if(kind==='thorns') {
    // Bramble ground: a dark bed, a vine along the rim and spikes; the middle stays quiet for an occupant.
    g.roundRect(x-34,y-34,68,68,6).fill({color:0x2a2415,alpha:.55});
    g.moveTo(x-33,y-20).quadraticCurveTo(x-20,y-38,x-4,y-31).quadraticCurveTo(x+16,y-25,x+33,y-33).moveTo(x-33,y+22).quadraticCurveTo(x-14,y+38,x+6,y+31).quadraticCurveTo(x+24,y+26,x+33,y+34).stroke({color:0x4f3d22,width:3});
    drawThornRim(g,x,y,1);
    for(const [ox,oy] of [[-9,-4],[8,-8],[3,9]])g.poly([x+ox-4,y+oy+4,x+ox,y+oy-7,x+ox+4,y+oy+4]).fill({color:0xc9ad6e,alpha:.7}).stroke({color:0x2a2415,width:1});
  } else if(kind==='campfire') {
    g.ellipse(x,y+17,31,13).fill(0x2a2f21);
    for(let n=0;n<7;n++) {const a=n/7*Math.PI*2;g.ellipse(x+Math.cos(a)*25,y+17+Math.sin(a)*9,7,5).fill(0x777764);}
    g.moveTo(x-16,y+21).lineTo(x+16,y+11).moveTo(x-14,y+10).lineTo(x+17,y+22).stroke({color:0x806146,width:5});
    g.circle(x,y,30).fill({color:0xe8ad4a,alpha:0.06});
    g.poly([x-16,y+11,x-11,y-6,x-5,y+2,x+1,y-29,x+12,y-11,x+9,y-1,x+17,y+7,x+8,y+18,x-8,y+18]).fill(0xc97f41);
    g.poly([x-7,y+12,x-4,y+1,x+2,y-13,x+9,y+11,x+1,y+18]).fill(0xf4d581);
  }
}
