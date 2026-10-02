import { Container, Graphics, Text } from 'pixi.js';
import type { ForestCell, LootKind, ResourceKind, TerrainKind } from '../game/forestTypes';
import { lootLabel } from '../game/resources';
import { makeDoor, makeGuardEnemy } from './guardArt';
import { occupiedIndices, footprintBounds } from '../game/entityFootprint';
import { meleeCanAttack } from '../game/enemyLifecycle';
import { shieldIsActive } from '../game/combatRules';
import { addDamageEffectBadges } from './damageEffectBadges';
import { makeBoar } from './boarArt';
import { crystalScore } from '../game/mapBattleRules';
import { makePorcupine, makeShaman, makeWolf } from './beastArt';
import { makeTroll } from './trollArt';
import { characterArtId, characterSprite } from './characterAssets';
export const COLORS = [0xca7970, 0x9fba7c, 0x79b0c4, 0xd8b66a, 0xb69ad2];
export const PALE = 0xf2dfb4;
function label(c:Container,text:string,x:number,y:number,size=12,color=PALE) {
  const t=new Text({text,style:{fontFamily:'Georgia, serif',fontSize:size,fontWeight:'bold',fill:color}});
  t.anchor.set(0.5);t.position.set(x,y);c.addChild(t);
}
function drawChainSigil(g: Graphics, color: number | null, y: number): void {
  if (color===0) g.poly([0,y-6,6,y+5,-6,y+5]).fill(PALE);
  else if (color===1) g.moveTo(0,y-6).lineTo(0,y+6).moveTo(-6,y).lineTo(6,y).stroke({color:PALE,width:2});
  else if (color===2) g.rect(-5,y-5,10,10).stroke({color:PALE,width:2});
  else if (color===3) g.circle(0,y,5).stroke({color:PALE,width:2});
  else if (color===4) g.moveTo(-5,y-5).lineTo(5,y+5).moveTo(5,y-5).lineTo(-5,y+5).stroke({color:PALE,width:2});
  else g.poly([0,y-6,6,y,0,y+6,-6,y]).stroke({color:PALE,width:2});
}

/** Illustration and gameplay marks have separate layers; art never receives a chain tint. */
function makeIllustratedEnemy(cell: ForestCell, width: number, height: number, tutorialTarget: boolean): Container | null {
  const sprite=characterSprite(characterArtId(cell),width-10,height-10);
  if(!sprite)return null;
  const c=new Container(),base=new Graphics(),marks=new Graphics(),outerMarks:Graphics[]=[];
  const wide=width>80||height>80, halfW=width/2,halfH=height/2;
  const ready=cell.intent.cells.length>0&&(cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  const resting=cell.behavior.restTurns>0&&!cell.status.frozen;
  const color=cell.color===null?0x8f929b:COLORS[cell.color];
  if(ready){
    const aura=new Graphics();aura.label='attack-aura';
    aura.roundRect(-halfW+1,-halfH+1,width-2,height-2,10).stroke({color:0xf2aa72,width:3,alpha:.95});
    outerMarks.push(aura);
  }
  if(cell.kind==='prism'){
    const glow=new Graphics();glow.label='prism-aura';glow.circle(0,0,Math.min(width,height)*.39).fill({color:0xd1dfac,alpha:.12}).stroke({color:0xe9eac0,width:2,alpha:.4});c.addChild(glow);
  }
  if(tutorialTarget){
    const marker=new Graphics();marker.label='tutorial-target';
    marker.roundRect(-halfW-2,-halfH-2,width+4,height+4,10).stroke({color:0xf1d17d,width:3,alpha:.98});
    marker.poly([0,-halfH-9,7,-halfH-2,0,-halfH+5,-7,-halfH-2]).fill(0xf1d17d);
    outerMarks.push(marker);
  }
  const hasDamageEffect=!!(cell.damageEffects?.burning||cell.damageEffects?.poison||cell.damageEffects?.bleeding);
  const sigilY=halfH-(hasDamageEffect?25:11);
  base.roundRect(-halfW+5,-halfH+5,width-10,height-10,8).fill({color,alpha:.42}).stroke({color,width:4,alpha:.95});
  base.ellipse(0,halfH-9,Math.min(halfW-10,35),5).fill({color:0x101a1f,alpha:.5});
  c.addChild(base,sprite,...outerMarks,marks);
  // A solid base plaque remains legible even when the illustration has many colors.
  marks.roundRect(-11,sigilY-9,22,18,5).fill(color).stroke({color:0x18232d,width:2});
  drawChainSigil(marks,cell.color,sigilY);
  if(cell.hp>0){
    marks.roundRect(halfW-37,-halfH+5,32,18,4).fill(0x233039).stroke({color:0xb5b79c,width:1});
    label(c,`${cell.hp}♥`,halfW-21,-halfH+14,11);
  }
  if(cell.status.frozen||ready||resting){
    marks.roundRect(-halfW+5,-halfH+5,19,18,4).fill(ready?0x85433a:0x253438).stroke({color:ready?0xe9a879:0x88a8a9,width:1});
    label(c,cell.status.frozen?'❄':ready?'!':'Ⅱ',-halfW+14.5,-halfH+14,12);
  }
  if(cell.status.wet)marks.poly([-halfW+9,halfH-22,-halfW+14,halfH-13,-halfW+9,halfH-8,-halfW+4,halfH-13]).fill(0x8fd9de);
  if(cell.status.frozen)marks.roundRect(-halfW+5,-halfH+5,width-10,height-10,8).fill({color:0xabf0eb,alpha:.13}).stroke({color:0xb0edee,width:2,alpha:.9});
  if(cell.status.brittle){marks.circle(halfW-14,halfH-15,10).fill(0x38585c);label(c,'×2',halfW-14,halfH-15,11,0xd7ffff);}
  if((cell.variant==='sentinel'||cell.variant==='jailer')&&cell.shield&&shieldIsActive(cell)){
    const plate=new Graphics();plate.label='directional-shield';plate.rotation=Math.atan2(cell.shield.dy,cell.shield.dx);
    plate.moveTo(halfW-5,-halfH+13).lineTo(halfW-5,halfH-13).stroke({color:0xf2deaa,width:5});c.addChild(plate);
  }
  addDamageEffectBadges(c,cell.damageEffects,wide?halfH-5:34);
  return c;
}
/** Consumables and crafting resources (elite loot): colour, glyph and short name. */
export const ITEM_COLORS: Record<LootKind, number> = { frost: 0x8fd9de, bomb: 0xe0a26c, healing: 0x9fd78a, fire: 0xf0a065,
  dew: 0xa6e6f2, powder: 0xbfae94, resin: 0xd9a441, herbs: 0x86c96f };
export const ITEM_GLYPHS: Record<LootKind, string> = { frost: '❄', bomb: '✹', healing: '✚', fire: '♨', dew: '◍', powder: '⁂', resin: '◆', herbs: '♣' };
const ITEM_SHORT: Record<LootKind, string> = { frost: 'Холод', bomb: 'Бомба', healing: 'Лечение', fire: 'Огонь', dew: 'Роса', powder: 'Порох', resin: 'Смола', herbs: 'Травы' };
/** A consumable dropped by an elite: a colourless link that carries an item badge (same glyphs as the item toolbar). */
function makeLootPiece(item: LootKind): Container {
  const c=new Container(),glow=new Graphics(),g=new Graphics(),color=ITEM_COLORS[item];
  glow.label='prism-aura';glow.circle(0,-2,28).fill({color:0xd1dfac,alpha:.12}).stroke({color:0xe9eac0,width:1,alpha:.35});
  g.ellipse(0,26,24,6).fill({color:0x101a15,alpha:.7});
  g.circle(0,-3,21).fill(0x1d2c36).stroke({color:0x18232d,width:5}).circle(0,-3,21).stroke({color:color,width:2.5});
  g.circle(0,-3,16).fill({color,alpha:.28});
  g.moveTo(-29,-3).lineTo(-24,-3).moveTo(24,-3).lineTo(29,-3).stroke({color:PALE,width:2});
  c.addChild(glow,g);
  label(c,ITEM_GLYPHS[item],0,-3,22,0xfff4d0);
  g.roundRect(-24,17,48,14,5).fill(0x233039).stroke({color:0xf3d98a,width:1.5});
  label(c,ITEM_SHORT[item],0,24,9,0xffeaa8);
  return c;
}
/** Contents of the exit's chest for the player: «Роса ×2» or «Роса, Порох». */
export function chestLabel(chest: readonly ResourceKind[]): string {
  const counts = new Map<ResourceKind, number>();
  for (const kind of chest) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => n > 1 ? `${lootLabel(kind)} ×${n}` : lootLabel(kind)).join(', ');
}
/**
 * The exit's chest (exitRules.ts): a stout banded wooden chest with a gold lock, not a crystal. Colourless link stubs
 * on both sides keep it readable as a chain link; two dots on the plaque show the resources inside.
 */
function makeChestPiece(chest: readonly ResourceKind[]): Container {
  const c=new Container(),glow=new Graphics(),g=new Graphics(),INKC=0x18232d,GOLD=0xe0b24a;
  glow.label='prism-aura';glow.roundRect(-33,-30,66,60,10).fill({color:0xf3d98a,alpha:.1}).stroke({color:0xf3d98a,width:1.5,alpha:.4});
  g.ellipse(0,27,27,6).fill({color:0x101a15,alpha:.7});
  g.moveTo(-34,-2).lineTo(-28,-2).moveTo(28,-2).lineTo(34,-2).stroke({color:PALE,width:2});
  // Body, then the domed lid with its iron bands.
  g.poly([-24,-2,24,-2,26,24,-26,24]).fill(0x8a5a30).stroke({color:INKC,width:4});
  g.poly([-24,-2,24,-2,25,5,-25,5]).fill(0x6b4423);
  g.poly([-26,-4,-22,-19,-12,-26,12,-26,22,-19,26,-4]).fill(0xa9743d).stroke({color:INKC,width:4});
  g.poly([-20,-20,-11,-24,-2,-24,-8,-18,-18,-15]).fill({color:0xd29a5d,alpha:.9});
  for(const x of [-16,16]){g.rect(x-3,-25,6,49).fill(0x46586a).stroke({color:INKC,width:1.5});g.circle(x,-17,1.4).fill(0xc7d1d4).circle(x,16,1.4).fill(0xc7d1d4);}
  // Lock plate.
  g.roundRect(-7,-8,14,15,3).fill(GOLD).stroke({color:INKC,width:2.5});
  g.circle(0,-2,2.2).fill(INKC).poly([-1,-1,1,-1,2,4,-2,4]).fill(INKC);
  // Plaque with the contents.
  g.roundRect(-20,17,40,12,5).fill(0x233039).stroke({color:0xf3d98a,width:1.5});
  chest.slice(0,4).forEach((kind,n,all)=>g.circle((n-(all.length-1)/2)*11,23,3.6).fill(ITEM_COLORS[kind]).stroke({color:INKC,width:1}));
  c.addChild(glow,g);
  return c;
}
/** Elite mark (elite.ts): a gold frame and a crown, drawn on top of any enemy art and readable at 80 px. */
function addEliteMark(c: Container): void {
  const frame=new Graphics();frame.label='elite-mark';
  frame.roundRect(-35,-35,70,70,9).stroke({color:0x18232d,width:5,alpha:.9}).roundRect(-35,-35,70,70,9).stroke({color:0xffc83a,width:2.5});
  // Crown on the top edge, between the status plate (left) and the HP plate (right).
  frame.poly([-11,-30,-12,-42,-6,-37,0,-45,6,-37,12,-42,11,-30]).fill(0xffc83a).stroke({color:0x18232d,width:2});
  frame.circle(0,-35,2.2).fill(0xc2432f);
  c.addChild(frame);
}
export function makeEnemy(cell: ForestCell,index=0,cols=7,tutorialTarget=false): Container {
  if(cell.kind==='prism'&&cell.chest)return makeChestPiece(cell.chest);
  if(cell.kind==='prism'&&cell.loot)return makeLootPiece(cell.loot);
  const view=makeEnemyBase(cell,index,cols,tutorialTarget);
  if(cell.elite)addEliteMark(view);
  return view;
}
function makeEnemyBase(cell: ForestCell,index=0,cols=7,tutorialTarget=false): Container {
  if(cell.kind==='door'&&cell.door){
    const bounds=footprintBounds(occupiedIndices(cell,index),cols);
    return makeDoor(cell,(bounds?.width??1)*80,(bounds?.height??1)*80);
  }
  const bounds=footprintBounds(occupiedIndices(cell,index),cols);
  const illustrated=makeIllustratedEnemy(cell,(bounds?.width??1)*80,(bounds?.height??1)*80,tutorialTarget);
  if(illustrated)return illustrated;
  if(cell.variant==='boar')return makeBoar(cell,tutorialTarget);
  if(cell.variant==='wolf')return makeWolf(cell,index,cols,tutorialTarget);
  if(cell.variant==='porcupine')return makePorcupine(cell,tutorialTarget);
  if(cell.variant==='shaman')return makeShaman(cell,tutorialTarget);
  if(cell.variant==='troll')return makeTroll(cell,(bounds?.width??1)*80,(bounds?.height??1)*80);
  if(cell.variant==='sentinel'||cell.variant==='jailer')return makeGuardEnemy(cell);
  const c=new Container(),g=new Graphics();
  const passive=cell.behavior.passive===true;
  const ready=cell.intent.cells.length>0 && (cell.kind==='melee'?meleeCanAttack(cell):!cell.status.frozen&&cell.behavior.restTurns===0);
  const resting=cell.kind==='ranged' && cell.behavior.restTurns>0 && !cell.status.frozen;
  if(ready) {
    const halo=new Graphics();halo.label='attack-aura';
    halo.roundRect(-36,-37,72,72,13).fill({color:0xee804c,alpha:0.16}).stroke({color:0xf18a50,width:3,alpha:0.92});
    halo.moveTo(-34,-22).lineTo(-38,-30).moveTo(34,-22).lineTo(38,-30).moveTo(-35,20).lineTo(-39,25).moveTo(35,20).lineTo(39,25).stroke({color:0xffbd73,width:2,alpha:0.95});
    c.addChild(halo);
  }
  c.addChild(g);
  if(tutorialTarget){
    const marker=new Graphics();marker.label='tutorial-target';
    marker.circle(0,0,34).stroke({color:0xf1d17d,width:3,alpha:.95});
    marker.poly([0,-42,6,-35,0,-28,-6,-35]).fill(0xf1d17d).stroke({color:0x61471e,width:1});
    c.addChildAt(marker,0);
  }
  const boss=cell.kind==='boss',col=cell.color===null?0xbab5a6:COLORS[cell.color];
  g.ellipse(0,26,26,7).fill({color:0x101a15,alpha:0.7});
  if(cell.kind==='prism') {
    const glow=new Graphics();glow.label='prism-aura';glow.circle(0,-2,28).fill({color:0xd1dfac,alpha:.12}).stroke({color:0xe9eac0,width:1,alpha:.3});c.addChildAt(glow,0);
    g.poly([0,-25,18,-2,0,23,-18,-2]).fill(0xc8e8d9).stroke({color:PALE,width:2});
    g.poly([0,-25,0,-2,-18,-2]).fill(COLORS[0]);g.poly([0,-25,18,-2,0,-2]).fill(COLORS[1]);g.poly([-18,-2,0,-2,0,23]).fill(COLORS[2]);
    g.poly([0,-8,5,-2,0,4,-5,-2]).fill(0xfff8d7);g.moveTo(-29,-4).lineTo(-23,-4).moveTo(23,-4).lineTo(29,-4).stroke({color:PALE,width:2});
    // A map-battle crystal carries its value (breaking it with a chain scores that many points).
    if(cell.crystalChain){
      const value=crystalScore(cell);
      glow.roundRect(-34,-34,68,68,8).stroke({color:0xf3d98a,width:3,alpha:.9});
      g.roundRect(-19,14,38,15,5).fill(0x3b3220).stroke({color:0xf3d98a,width:1.5});
      label(c,`+${value}`,0,21.5,11,0xffeaa8);
    }
    return c;
  }
  // Long ears and tusks identify goblins; cloth sigils identify matching chains.
  g.poly([-20,22,-17,3,-28,-3,-34,-18,-13,-11,-9,-23,11,-23,17,-11,34,-18,29,-2,18,4,22,22]).fill(0x213027).stroke({color:0x101b18,width:3});
  g.poly([-17,5,-28,-5,-30,-13,-13,-7,-8,-19,10,-19,17,-7,30,-13,26,-4,16,5,14,18,-14,18]).fill(boss?0xa5aa98:0x819672);
  g.poly([-15,8,-7,13,8,13,15,8,20,24,1,29,-20,23]).fill(col);
  if(ready) {
    // Raised shoulders and spread arms make the wind-up a different silhouette.
    g.poly([-16,9,-29,2,-30,-11,-24,-14,-20,0,-10,5]).fill(0x9bac80).stroke({color:0x283427,width:2});
    g.poly([16,9,29,2,30,-11,24,-14,20,0,10,5]).fill(0x9bac80).stroke({color:0x283427,width:2});
  }
  g.poly([-16,-10,-10,-23,10,-22,17,-9,7,-13,-5,-12]).fill(col);
  g.poly([-13,-3,-3,0,-5,5,-12,3]).fill(0x1b2422).poly([13,-3,3,0,5,5,12,3]).fill(0x1b2422);
  g.rect(-10,0,4,ready?3:2).fill(ready?0xffc272:PALE).rect(6,0,4,ready?3:2).fill(ready?0xffc272:PALE);
  if(ready) {
    g.moveTo(-15,-7).lineTo(-3,-2).moveTo(15,-7).lineTo(3,-2).stroke({color:0x263024,width:3});
    g.poly([-9,10,9,10,6,16,-6,16]).fill(0x343127);
    g.moveTo(-5,11).lineTo(-5,14).moveTo(0,11).lineTo(0,14).moveTo(5,11).lineTo(5,14).stroke({color:PALE,width:2});
  }
  g.poly([-2,3,3,3,5,9,-5,9]).fill(0x586a51);
  g.moveTo(-9,13).lineTo(9,13).stroke({color:0x29382b,width:2});
  g.poly([-10,10,-6,17,-5,11]).fill(PALE).poly([10,10,6,17,5,11]).fill(PALE);
  if(cell.color===0) g.poly([0,16,4,23,-4,23]).fill(PALE);
  if(cell.color===1) g.moveTo(0,16).lineTo(0,25).moveTo(-4,20).lineTo(4,20).stroke({color:PALE,width:2});
  if(cell.color===2) g.rect(-4,17,8,7).stroke({color:PALE,width:2});
  if(cell.color===3) g.circle(0,20,4).stroke({color:PALE,width:2});
  if(cell.color===4) g.moveTo(-4,16).lineTo(4,24).moveTo(4,16).lineTo(-4,24).stroke({color:PALE,width:2});
  if(cell.kind==='ranged') {
    if(ready) {
      const bow=new Graphics();
      const target=cell.intent.cells[0];
      const dx=target%cols-index%cols,dy=Math.floor(target/cols)-Math.floor(index/cols);
      bow.rotation=Math.atan2(dy,dx);
      bow.moveTo(25,-20).quadraticCurveTo(41,0,25,20).stroke({color:0xe9c682,width:4});
      // V-shaped string is visibly drawn; the arrow aims down the fixed intent.
      bow.moveTo(25,-20).lineTo(12,0).lineTo(25,20).moveTo(9,0).lineTo(39,0).stroke({color:0xffebbc,width:2});
      bow.poly([39,0,31,-5,31,5]).fill(0xffd993);c.addChild(bow);
    } else {
      g.moveTo(23,5).quadraticCurveTo(35,16,25,29).stroke({color:0x9e8d60,width:3});
      g.moveTo(23,5).lineTo(25,29).stroke({color:0xb6ad89,width:1});
      if(resting) {
        // Relaxed eyelids and a lowered, unstrung-looking bow signal recovery.
        g.moveTo(-13,-1).lineTo(-3,1).moveTo(3,1).lineTo(13,-1).stroke({color:0x445641,width:3});
      }
    }
  } else if(boss) {
    g.poly([-20,-15,-21,-31,-10,-26,0,-34,11,-25,23,-30,20,-15]).fill(0x5b605a).stroke({color:0xe0d5b9,width:1.5});
    // Stolen breakfast kettle; the chief wears no chain color.
    const kettleY=ready?-16:17;
    g.ellipse(1,kettleY,18,14).fill(0x393f3c).stroke({color:ready?0xdfc495:0x898d7e,width:2});
    g.ellipse(1,kettleY-8,17,5).fill(0x141e1b).stroke({color:0x9f9d89,width:1});
    g.moveTo(-14,kettleY-10).quadraticCurveTo(0,kettleY-26,16,kettleY-10).stroke({color:0xc4b58d,width:2});
    if(ready) {g.moveTo(-17,5).lineTo(-20,-15).moveTo(17,5).lineTo(20,-15).stroke({color:0xa5aa98,width:6});}
  } else if(ready) {
    g.moveTo(27,8).lineTo(29,-23).stroke({color:0x866442,width:5});
    g.poly([23,-24,37,-21,37,-7,28,-10,22,-14]).fill(0xe1c38e).stroke({color:0x485243,width:2});
    g.moveTo(35,-19).lineTo(35,-9).stroke({color:0xffead0,width:2});
    g.moveTo(-33,-14).lineTo(-29,-20).moveTo(37,7).lineTo(39,12).stroke({color:0xffbd79,width:2});
  } else if(passive) {
    // Open hands and an empty belt make the permanent no-attack rule visible.
    g.moveTo(-18,10).lineTo(-28,15).moveTo(18,10).lineTo(28,15).stroke({color:0x8eac7b,width:5,cap:'round'});
    g.circle(-29,15,4).fill(0x9ab687).circle(29,15,4).fill(0x9ab687);
  } else {g.moveTo(24,2).lineTo(23,24).stroke({color:0x705e3b,width:4});g.poly([19,0,25,-4,28,8,20,10]).fill(0xa0a28a);}
  if(cell.status.frozen||ready||resting){g.roundRect(-35,-34,18,18,4).fill(ready?0x853e37:0x1c2b24).stroke({color:ready?0xe7a67e:0x6f8169,width:1});
    label(c,cell.status.frozen?'❄':ready?'!':'Ⅱ',-26,-25,12,ready?0xffe2b6:0xaebca5);}
  if(cell.hp>0){g.roundRect(7,-34,30,18,4).fill(boss?0x514c40:0x203029).stroke({color:boss?0xdbcfb1:0x9aab85,width:1});label(c,`${cell.hp}♥`,22,-26,12);}
  if(cell.status.wet) g.poly([-27,12,-22,20,-22,23,-27,26,-32,23,-32,20]).fill(0x8dd8e0);
  if(cell.status.frozen) {
    g.poly([-30,-15,-20,-28,16,-29,32,-13,29,24,8,34,-25,28]).fill({color:0x9ae6e8,alpha:0.16}).stroke({color:0xb9f0ed,width:2,alpha:0.85});
    g.moveTo(-22,-14).lineTo(-10,-2).lineTo(-18,10).moveTo(23,-8).lineTo(12,1).lineTo(18,18).stroke({color:0xceffff,alpha:0.65,width:1});
  }
  if(cell.status.brittle) {g.circle(27,23,10).fill(0x355a5c).stroke({color:0xbcf1e8,width:1});label(c,'×2',27,22,11,0xd9ffff);}
  addDamageEffectBadges(c, cell.damageEffects);
  return c;
}
export function makePlayer(): Container {
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
