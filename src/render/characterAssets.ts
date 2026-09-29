import { Assets, Sprite, type Texture } from 'pixi.js';
import type { ForestCell } from '../game/forestTypes';

export const CHARACTER_ART_IDS = [
  'player', 'melee', 'ranged', 'boss', 'prism',
  'chair', 'stool', 'cabinet', 'wardrobe', 'sentinel', 'elite',
  'rook', 'bishop', 'knight', 'commander', 'wizard', 'jailer', 'beacon',
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

export function characterArtId(cell: ForestCell): CharacterArtId | null {
  // Variants without an illustration (boar, forest beasts) use the procedural fallback.
  if(cell.kind==='door')return null;
  const id = cell.variant ?? cell.kind;
  return (CHARACTER_ART_IDS as readonly string[]).includes(id) ? id as CharacterArtId : null;
}

/** Fit the full silhouette without changing its aspect ratio or chain color. */
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
