/**
 * Task 29 (design 15.10.2026, docs/design-notes/tasks-29-30.md, «ЗАДАЧА 29», ui): the icons of the forms in the build column —
 * inline SVG drawn by the view in the art style (docs/character-art-style.md: a navy outline, flat colours, one shade, no text).
 * No generated art (user decision: the look on the hero is costly in art). One icon per form; the field of each form
 * (design 15.10.2026, from the report): «Конец» — Печать, Прямая; «Звено» — Развилка, Чужак, Близнецы; «Путь» — Наледь.
 */

/** The fields of the forms: one rule per field (sim, task 29 (6)). */
export type FormField = 'end' | 'link' | 'path';

/** The forms the view draws. */
export type FormIcon = 'seal' | 'pierce' | 'fork' | 'stranger' | 'twins' | 'rime';

export const FORM_FIELD: Readonly<Record<FormIcon, FormField>> = {
  seal: 'end', pierce: 'end', fork: 'link', stranger: 'link', twins: 'link', rime: 'path',
};

/** The field captions of the sandbox menu («Форма · конец» …). */
export const FIELD_TITLE: Readonly<Record<FormField, string>> = { end: 'конец', link: 'звено', path: 'путь' };

const NAVY = '#18232d';
const LEMON = '#ffff66';
const PALE = '#dbe9f4';
/** The cold of the consumable (render.ts `ICE`): «Наледь» takes no new shade (design 15.10.2026). */
const ICE = '#9fd8ff';
const CORAL = '#ff6f61';
const MINT = '#6fe0b8';
const STEEL = '#8a98a6';

/** A link: a filled dot with the navy outline. */
const dot = (x: number, y: number, r: number, fill: string): string =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${NAVY}" stroke-width="1.6"/>`;
/** A chain segment: a navy under-stroke and a coloured line. */
const seg = (pts: string, color: string): string =>
  `<polyline points="${pts}" fill="none" stroke="${NAVY}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

const BODIES: Readonly<Record<FormIcon, string>> = {
  // «Печать»: a closed ring of links with a seal in the middle.
  seal: `<circle cx="12" cy="12" r="7.5" fill="none" stroke="${NAVY}" stroke-width="4"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="${LEMON}" stroke-width="2"/>` +
    dot(12, 4.5, 2.2, PALE) + dot(18.5, 15.8, 2.2, PALE) + dot(5.5, 15.8, 2.2, PALE) +
    `<path d="M12 8.6 L15 12 L12 15.4 L9 12 Z" fill="${LEMON}" stroke="${NAVY}" stroke-width="1.4"/>`,
  // «Прямая»: a spear through three links.
  pierce: `<path d="M3 21 L18.5 5.5" stroke="${NAVY}" stroke-width="3.6" stroke-linecap="round"/><path d="M3 21 L18.5 5.5" stroke="${STEEL}" stroke-width="1.6" stroke-linecap="round"/>` +
    dot(6.5, 17.5, 2.6, PALE) + dot(11.5, 12.5, 2.6, PALE) +
    `<path d="M22 2 L20.6 9 L15 3.4 Z" fill="${LEMON}" stroke="${NAVY}" stroke-width="1.4" stroke-linejoin="round"/>`,
  // «Развилка»: the chain splits like a Y at a link that is not the last.
  fork: seg('12,21 12,12 5,5', PALE) + seg('12,12 19,5', LEMON) + dot(12, 21, 2.2, PALE) + dot(12, 12, 2.6, PALE) + dot(5, 5, 2.2, PALE) + dot(19, 5, 2.2, LEMON),
  // «Чужак»: a chain of one colour with one link of another.
  stranger: seg('3,18 9,12 15,14 21,7', MINT) + dot(3, 18, 2.2, MINT) + dot(9, 12, 2.2, MINT) + dot(15, 14, 3, CORAL) + dot(21, 7, 2.2, MINT),
  // «Близнецы»: two links of two colours tied by one arc (a pair counts as one colour).
  twins: `<path d="M6 15 Q12 4 18 15" fill="none" stroke="${NAVY}" stroke-width="4" stroke-linecap="round"/><path d="M6 15 Q12 4 18 15" fill="none" stroke="${LEMON}" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.5 2"/>` +
    dot(6, 16, 3.6, CORAL) + dot(18, 16, 3.6, MINT),
  // «Наледь»: a trail of three ice shards.
  rime: [[5, 18.5, 3.6], [11.5, 12.5, 4.4], [18.5, 6, 5.2]].map(([x, y, r]) =>
    `<path d="M${x} ${y - r} L${x + r * 0.8} ${y} L${x} ${y + r} L${x - r * 0.8} ${y} Z" fill="${ICE}" stroke="${NAVY}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M${x - r * 0.25} ${y - r * 0.45} L${x + r * 0.15} ${y - r * 0.1}" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>`).join(''),
};

/** The SVG markup of a form's icon, `size` px square. */
export function formIconSvg(form: FormIcon, size = 24): string {
  return `<svg class="rt-form-icon" data-form="${form}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${BODIES[form]}</svg>`;
}

/** Task 44 «Сплавы»: the fusions the view draws. */
export type FusionIcon = 'iceSeal' | 'spear' | 'boomerang';
const WOOD = '#c88a3a';
/**
 * Task 44 (design 16.10.2026, docs/design-notes/task-44-fusions.md, 4): the fusions' icons in the same style — each grows from its
 * form part's icon: «Ледяная печать» — the seal's ring turned to ice with an ice shard in the middle; «Копьё» — «Прямая»'s spear
 * longer, through three links, with a broad head; «Бумеранг» — a wooden boomerang with the way back's arrow.
 */
const FUSION_BODIES: Readonly<Record<FusionIcon, string>> = {
  iceSeal: `<circle cx="12" cy="12" r="7.5" fill="none" stroke="${NAVY}" stroke-width="4"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="${ICE}" stroke-width="2"/>` +
    dot(12, 4.5, 2.2, ICE) + dot(18.5, 15.8, 2.2, ICE) + dot(5.5, 15.8, 2.2, ICE) +
    `<path d="M12 7.4 L15.2 12 L12 16.6 L8.8 12 Z" fill="${ICE}" stroke="${NAVY}" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M11.2 9.6 L12.4 11" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round"/>`,
  // Design 16.10.2026: not «Прямая»'s diagonal with a small tip — a long shaft, a broad leaf head and two plates knocked off at the tip.
  spear: `<path d="M1.5 22.5 L13 11" stroke="${NAVY}" stroke-width="3.8" stroke-linecap="round"/><path d="M1.5 22.5 L13 11" stroke="${WOOD}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M11 13 L13.8 10.2" stroke="${NAVY}" stroke-width="4.4" stroke-linecap="round"/>` +
    `<path d="M23 1 Q22 10.5 13 12.2 Q12.4 4 23 1 Z" fill="${LEMON}" stroke="${NAVY}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M21.6 2.4 L14.4 11" stroke="${NAVY}" stroke-width="0.9" stroke-linecap="round"/>` +
    `<rect x="16" y="15.5" width="4" height="3" rx="0.6" transform="rotate(25 18 17)" fill="${STEEL}" stroke="${NAVY}" stroke-width="1.2"/>` +
    `<rect x="19.2" y="11.6" width="4" height="3" rx="0.6" transform="rotate(-20 21.2 13.1)" fill="${STEEL}" stroke="${NAVY}" stroke-width="1.2"/>`,
  boomerang: `<path d="M3.5 9 Q12 1.5 20.5 9 L18 12 Q12 7 6 12 Z" fill="${WOOD}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M18.5 16.5 Q12 22.5 5.5 16.5" fill="none" stroke="${NAVY}" stroke-width="4" stroke-linecap="round"/><path d="M18.5 16.5 Q12 22.5 5.5 16.5" fill="none" stroke="${LEMON}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M3 15.5 L7.6 14.2 L6.4 19 Z" fill="${LEMON}" stroke="${NAVY}" stroke-width="1.3" stroke-linejoin="round"/>`,
};

/** The SVG markup of a fusion's icon, `size` px square. */
export function fusionIconSvg(fusion: FusionIcon, size = 24): string {
  return `<svg class="rt-form-icon rt-fusion-icon" data-fusion="${fusion}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${FUSION_BODIES[fusion]}</svg>`;
}
