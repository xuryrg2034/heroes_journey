/**
 * Task 61а–б «Возвращение» and «после первой победы» (spec docs/design-notes/task-61-return-and-beyond.md, А.3, А.5, Б.3): the camp's
 * scenes, the scorches on the hearth's stones and the turquoise fire. Pure: HTML out of the scene's kind and core's counts
 * (`RtReturnView`, run/rtMeta.ts); the camp (hearthView.ts) plays it. No rule is here: whether a scene is due, how many scorches, the
 * fire's colour, who speaks — core's. The times are CSS animations whose delays count from `--rt-scene-t` (the scene's start, negative),
 * so a redraw in the middle of a scene keeps its frame.
 */
import { RT_SCORCH_STONES } from '../run/rtMeta';

/** The camp's scenes: the full return (2,5 с), the short one (1,0 с), the first win over the castle (4,5 с). */
export type CampScene = 'full' | 'short' | 'win';
export const SCENE_LENGTH: Readonly<Record<CampScene, number>> = { full: 2.5, short: 1.0, win: 4.5 };
/** The scene's sounds (s from its start): the fire flares, the ash rustles, the cat sneezes (Ведунья shakes the ash off: the rustle). */
export type SceneSound = 'flare' | 'ash' | 'sneeze';
export const SCENE_SOUNDS: Readonly<Record<CampScene, readonly { t: number; sound: SceneSound }[]>> = {
  full: [{ t: 0.3, sound: 'flare' }, { t: 0.7, sound: 'ash' }, { t: 1.5, sound: 'sneeze' }],
  short: [{ t: 0, sound: 'flare' }, { t: 0.3, sound: 'ash' }],
  win: [{ t: 0.5, sound: 'flare' }],
};
/** Spec Б.3: the first win's lines — Неясыть at 1,5 с, Евлампий at 3,0 с. */
export const WIN_SAYS: readonly { npc: 'owl' | 'monk'; t: number }[] = [{ npc: 'owl', t: 1.5 }, { npc: 'monk', t: 3.0 }];

/**
 * Spec А.5: the ten places on the stones of the hearth's ring (px of the 1280×720 background `camp/hearth.png`; the top faces), in the
 * order they fill — the stones the chosen hero does not stand before first (the front middle, the right side, the back), the left ones
 * behind the hero last (the second hero stands before the right front ones).
 */
export const SCORCH_AT: readonly { x: number; y: number; r: number }[] = [
  { x: 660, y: 468, r: -4 }, { x: 765, y: 432, r: 12 }, { x: 750, y: 404, r: 8 }, { x: 712, y: 389, r: 4 }, { x: 728, y: 452, r: 6 },
  { x: 622, y: 470, r: 2 }, { x: 574, y: 389, r: -4 }, { x: 538, y: 409, r: -8 }, { x: 522, y: 436, r: -14 }, { x: 572, y: 456, r: -6 },
];

/** The scorch the scene lights (its index among the 20 marks: 0–9 the first, 10–19 the dark ones over them); null — none (past 20). */
export const freshScorch = (returns: number): number | null => (returns >= 1 && returns <= 2 * RT_SCORCH_STONES ? returns - 1 : null);

/** The scorches on the stones: `light` first marks, `dark` second ones over them; `fresh` lights up in the scene (`at` — its time, s). */
export function scorchesHtml(scorches: { light: number; dark: number }, fresh: number | null, at: number): string {
  const one = (i: number, dark: boolean): string => {
    const p = SCORCH_AT[i % RT_SCORCH_STONES], index = dark ? i + RT_SCORCH_STONES : i, isNew = index === fresh;
    return `<i class="rt-scorch${dark ? ' rt-dark' : ''}${isNew ? ' rt-new' : ''}" style="left:${p.x}px;top:${p.y}px;--r:${p.r}deg${isNew ? `;--at:${at}s` : ''}" data-testid="hearth-scorch${dark ? '-dark' : ''}"></i>`;
  };
  return Array.from({ length: scorches.light }, (_, i) => one(i, false)).join('') + Array.from({ length: scorches.dark }, (_, i) => one(i, true)).join('');
}

/** The scorch's time in the scene (spec А.3: 1,8 с in the full one; the short — its last 0,2 с). */
export const SCORCH_TIME: Readonly<Record<'full' | 'short', number>> = { full: 1.8, short: 0.8 };

/** The turquoise over the fire (spec Б.3, П5): a hue over the background's flames and a fainter one over the lit ground. */
export const TINT_HTML = '<div class="rt-hearth-tint" data-testid="hearth-tint"></div><div class="rt-hearth-tint rt-hearth-tint-ground"></div>';

/**
 * The scene's layers: `back` behind the heroes — the night, the fire's flare and sparks, in a return the ash the hero rises from; `front`
 * over them — the cat's sneeze or the ash Ведунья shakes off her hat. `at` — the hero's feet (px of the scene).
 */
export function sceneHtml(kind: CampScene, hero: 'cat' | 'toad', at: { x: number; y: number; s: number }): { back: string; front: string } {
  const sparks = [-46, -22, -6, 10, 28, 44].map((dx, i) => `<i class="rt-camp-spark" style="--dx:${dx}px;--d:${(i * 0.05).toFixed(2)}s"></i>`).join('');
  const base = `<div class="rt-camp-night"></div><div class="rt-camp-flare"></div><div class="rt-camp-sparks">${sparks}</div>`;
  if (kind === 'win') return { back: base, front: '' };
  // The cat's nose; Ведунья's hat brim.
  const head = hero === 'cat' ? { x: at.x + 24 * at.s, y: at.y - 100 * at.s } : { x: at.x, y: at.y - 112 * at.s };
  const shake = hero === 'cat'
    ? `<div class="rt-camp-puff" style="left:${head.x}px;top:${head.y}px" data-testid="camp-sneeze"><i></i><i></i><i></i></div>`
    : `<div class="rt-camp-drops" style="left:${head.x}px;top:${head.y - 14 * at.s}px" data-testid="camp-drops"><i></i><i></i><i></i><i></i><i></i></div>`;
  return { back: base + `<div class="rt-camp-ash" style="left:${at.x}px;top:${at.y}px" data-testid="camp-ash"></div>`, front: kind === 'full' ? shake : '' };
}
