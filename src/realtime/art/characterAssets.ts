/**
 * Character illustrations (public/art/characters/*.png, docs/character-art-style.md): loaded once, each optional — a
 * missing image falls back to its drawn counterpart. Moved from the removed turn-based renderer
 * (src/render/characterAssets.ts, tag `turn-based-final`); the list of images is unchanged.
 */
import { Assets, Sprite, type Texture } from 'pixi.js';

export const CHARACTER_ART_IDS = [
  'player', 'melee', 'ranged', 'boss', 'prism', 'sentinel', 'jailer',
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
