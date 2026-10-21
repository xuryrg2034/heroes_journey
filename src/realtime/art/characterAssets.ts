/**
 * Character illustrations (public/art/characters/*.png, docs/character-art-style.md): loaded once, each optional — a
 * missing image falls back to its drawn counterpart. Moved from the removed turn-based renderer
 * (src/render/characterAssets.ts, tag `turn-based-final`); the list of images is unchanged.
 */
import { Assets, Sprite, type Texture } from 'pixi.js';

export const CHARACTER_ART_IDS = [
  'player', 'melee', 'ranged', 'boss', 'prism', 'sentinel', 'jailer',
  // Task 37 «Очаг»: the camp's NPC (the camp screen shows them as DOM images; the drawn silhouettes stay the fallback).
  'npc-owl', 'npc-herbalist', 'npc-smith',
  // Task 38 «Гарнизон, шаг 1а»: the guard, the dog handler, the hound and the Castellan (the drawn silhouettes stay the fallback).
  'garrison-guard', 'garrison-houndmaster', 'garrison-hound', 'castellan',
  // Task 40 «Гарнизон, шаг 1б»: the keymaster (the drawn silhouette stays the fallback).
  'garrison-keymaster',
  // Task 43 «Гарнизон, шаг 2а»: the crossbowman and the Castellan's crossbow on its stand (the drawn discs stay the fallback).
  'garrison-crossbowman', 'garrison-crossbow',
  // Task 43 «Гарнизон, шаг 2»: the knight (the drawn silhouette stays the fallback).
  'garrison-knight',
  // Task 48 «Тролль»: the boss of the forest awake and asleep («Храп»), his club and the rock (the tail's knot is the same rock, smaller).
  'troll', 'troll-sleep', 'troll-club', 'troll-rock',
  // Task 49 «Второй герой»: Ведунья (the hero's sprite; the drawn toad stays the fallback) and the Jailer's cage (the drawn cage stays the fallback).
  'toad', 'jailer-cage',
  // Task 57а «Лес: стрелки»: the slinger, the hive and the wisp (the drawn silhouettes stay the fallback).
  'forest-slinger', 'forest-hive', 'forest-wisp',
  // Task 55а «Замок, шаг 1а»: the wardrobe, the rook and the barrel (the drawn stand-ins of view/castleView.ts stay the fallback).
  'castle-wardrobe', 'castle-rook', 'castle-barrel',
  // Task 54a: the camp boss, his cauldron, ladle and sack (the drawn stand-ins of view/chiefView.ts stay the fallback).
  'chief', 'chief-cauldron', 'chief-ladle', 'chief-sack',
] as const;

export type CharacterArtId = typeof CHARACTER_ART_IDS[number];
const textures = new Map<CharacterArtId, Texture>();

/** Missing images are optional: each piece falls back to its drawn counterpart. */
export async function loadCharacterArt(): Promise<void> {
  const base = new URL('art/characters/', document.baseURI).href;
  await Promise.all(CHARACTER_ART_IDS.map(async id => {
    if (textures.has(id)) return;
    try {
      const texture = await Assets.load<Texture>(`${base}${id}.png`);
      if (texture.width > 0 && texture.height > 0) {
        texture.source.autoGenerateMipmaps = true;
        texture.source.scaleMode = 'linear';
        textures.set(id, texture);
      }
    } catch {
      // One unavailable asset must not prevent the board from opening.
    }
  }));
}

/** Fit the full silhouette without changing its aspect ratio or chain color. */
/** The art of `id` is loaded (task 38: the drawn silhouettes stand in without it). */
export const hasCharacterArt = (id: CharacterArtId): boolean => textures.has(id);

export function characterSprite(id: CharacterArtId | null, maxWidth: number, maxHeight: number): Sprite | null {
  if(id===null)return null;
  const texture = textures.get(id);
  if (!texture || texture.width <= 0 || texture.height <= 0) return null;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  const scale = Math.min(maxWidth / texture.width, maxHeight / texture.height);
  sprite.scale.set(scale);
  return sprite;
}
