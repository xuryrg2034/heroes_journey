/**
 * Task 56 «Приметы» (spec docs/design-notes/task-56-omens.md, 3.3, 4.3, 6; view 56в): the signs of the omens — the icons of the eleven
 * omens (inline SVG in the art style of `formIcons.ts`, `habitMark.ts`: a navy outline, flat colours, one shade, no text, no emoji; ⚡ is
 * the energy's sign and is not used), the sign in the map's header, the badge at a node's circle, the grey «?» of «Перепутье», the card's
 * line. The names, the plus and the price come from the run's catalogue (`run/omens.ts`); the view keeps no rule of its own. Pure strings,
 * testable in Node (`npm run test:realtime-omens-view`).
 */
import { rtOmen, rtPackOmen, RT_OMENS, type RtFightOmens, type RtOmenDef, type RtOmenId } from '../run/omens';
import type { RtRunState } from '../run/rtRun';
import { rtLevelOmen } from '../run/rtRun';

const NAVY = '#18232d';
const DISC = '#233039';
const PALE = '#dbe9f4';
const LEMON = '#ffe98a';
const GOLD = '#e3b45a';
const BROWN = '#8a5a34';
const MINT = '#6fe0b8';
const ICE = '#9fd8ff';
const WATER = '#4a8fd0';
const CORAL = '#ff6f61';
const STEEL = '#8a98a6';
const CLOUD = '#7d8da0';
const CRYSTAL = '#c78bf0';
const TENT = '#d96b4a';

const stroke = (w = 1.5): string => `stroke="${NAVY}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** The bodies of the icons on a 24 × 24 grid, one per omen. */
const BODIES: Readonly<Record<RtOmenId, string>> = {
  // «Полнолуние»: a full moon with two craters.
  moon: `<circle cx="12" cy="12" r="8.2" fill="${LEMON}" ${stroke(1.7)}/><circle cx="9" cy="10" r="1.7" fill="#d9c46a" ${stroke(0.9)}/><circle cx="14.6" cy="14.6" r="2.2" fill="#d9c46a" ${stroke(0.9)}/>`,
  // «Сорочье гнездо»: a nest of twigs with a diamond in it.
  magpie: `<path d="M3.6 12.4 Q12 22 20.4 12.4 L19 11 L5 11 Z" fill="${BROWN}" ${stroke()}/><path d="M5.4 14 L13 16.4 M8 17.6 L18.6 13.4 M6.6 12.6 L11 18.4" fill="none" stroke="#c99060" stroke-width="1.1" stroke-linecap="round"/>`
    + `<path d="M12 3.2 L16 7.2 L12 12 L8 7.2 Z" fill="${CRYSTAL}" ${stroke()}/><path d="M8 7.2 L16 7.2" fill="none" stroke="${PALE}" stroke-width="0.9"/>`,
  // «Попутный ветер»: a curl of wind with a tail.
  tailwind: `<path d="M3 9 L15 9 Q19.6 9 19.4 5.6 Q19.2 3.6 17.2 3.8" fill="none" stroke="${NAVY}" stroke-width="4.6" stroke-linecap="round"/><path d="M3 9 L15 9 Q19.6 9 19.4 5.6 Q19.2 3.6 17.2 3.8" fill="none" stroke="${MINT}" stroke-width="2.4" stroke-linecap="round"/>`
    + `<path d="M3 15.4 L17 15.4 Q21 15.4 20.8 18.6 Q20.6 20.4 18.6 20.2" fill="none" stroke="${NAVY}" stroke-width="4.6" stroke-linecap="round"/><path d="M3 15.4 L17 15.4 Q21 15.4 20.8 18.6 Q20.6 20.4 18.6 20.2" fill="none" stroke="${PALE}" stroke-width="2.4" stroke-linecap="round"/>`,
  // «Урожай»: a sheaf tied with a band.
  harvest: `<path d="M12 3 L12 19 M12 5 L7 18 M12 5 L17 18 M12 8 L4.8 15 M12 8 L19.2 15" fill="none" stroke="${NAVY}" stroke-width="4" stroke-linecap="round"/><path d="M12 3 L12 19 M12 5 L7 18 M12 5 L17 18 M12 8 L4.8 15 M12 8 L19.2 15" fill="none" stroke="${GOLD}" stroke-width="2" stroke-linecap="round"/>`
    + `<rect x="7.6" y="12.4" width="8.8" height="3.4" rx="1" fill="${CORAL}" ${stroke(1.3)}/>`,
  // «Гроза»: a cloud with a zigzag of lightning.
  storm: `<path d="M6.6 14 Q3 14 3.2 10.6 Q3.4 8 6.2 8 Q6.8 4.6 10.6 4.6 Q14 4.6 14.8 7.4 Q19.4 7 20.2 10.6 Q20.8 14 17 14 Z" fill="${CLOUD}" ${stroke()}/>`
    + `<path d="M12.6 12 L8.8 18 L11.8 18 L10.4 22.4 L16 15.6 L12.8 15.6 L14.4 12 Z" fill="${LEMON}" ${stroke(1.3)}/>`,
  // «Сонный час»: a closed eye with lashes.
  drowse: `<path d="M3 12 Q12 19 21 12 Q12 15.4 3 12 Z" fill="${PALE}" ${stroke(1.6)}/><path d="M5.6 14.4 L4.2 17 M9.4 16 L8.8 19 M14.6 16 L15.2 19 M18.4 14.4 L19.8 17" fill="none" ${stroke(1.5)}/>`
    + `<path d="M15 4.2 L19 4.2 L15 8.6 L19 8.6" fill="none" stroke="${ICE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  // «Скудные краски»: three smears, one thinner than the rest.
  pale: `<path d="M4 7 Q12 4.6 20 7" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linecap="round"/><path d="M4 7 Q12 4.6 20 7" fill="none" stroke="${CORAL}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M5 12.6 Q12 10.6 19 12.6" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linecap="round"/><path d="M5 12.6 Q12 10.6 19 12.6" fill="none" stroke="${MINT}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M6.4 17.8 Q12 16.6 17.6 17.8" fill="none" stroke="${NAVY}" stroke-width="4" stroke-linecap="round"/><path d="M6.4 17.8 Q12 16.6 17.6 17.8" fill="none" stroke="${ICE}" stroke-width="2" stroke-linecap="round"/>`,
  // «Половодье»: a wave with a curl.
  flood: `<path d="M2.4 17 Q2.4 8.4 10.4 7.2 Q16.6 6.6 17.6 11.4 Q15.4 9.8 13.4 10.8 Q11.4 12 12.4 14.4 Q14.4 17 21.6 15.6 L21.6 20 L2.4 20 Z" fill="${WATER}" ${stroke()}/><path d="M5 17.4 Q8 16 11 17.4 Q14 18.8 17 17.4" fill="none" stroke="${PALE}" stroke-width="1.2" stroke-linecap="round"/>`,
  // «Перекличка»: a horn.
  rollcall: `<path d="M3.4 14.4 L9.6 9.2 L19.6 4.4 Q21.6 8.6 19.6 14 L9.6 15.6 Z" fill="${GOLD}" ${stroke()}/><path d="M3.4 14.4 L2.8 18 L7 17.2 L9.6 15.6" fill="${BROWN}" ${stroke(1.3)}/><path d="M12 8.4 L13.4 14.4" fill="none" stroke="${PALE}" stroke-width="1.1" stroke-linecap="round"/>`,
  // «Ярмарочный день»: a striped tent.
  fair: `<path d="M3 19.4 L5 10 L12 3.4 L19 10 L21 19.4 Z" fill="${PALE}" ${stroke()}/><path d="M12 3.4 L8.2 19.4 L3 19.4 L5 10 Z" fill="${TENT}" ${stroke(1.3)}/><path d="M12 3.4 L15.8 19.4 L21 19.4 L19 10 Z" fill="${TENT}" ${stroke(1.3)}/>`
    + `<path d="M9.6 19.4 L12 12.6 L14.4 19.4 Z" fill="${NAVY}"/>`,
  // «Перепутье»: a signpost with two boards.
  crossroads: `<rect x="10.8" y="3" width="2.6" height="18.4" rx="1" fill="${BROWN}" ${stroke(1.3)}/><path d="M4 5.6 L14.6 5.6 L17.2 8 L14.6 10.4 L4 10.4 Z" fill="${GOLD}" ${stroke(1.3)}/><path d="M20 12 L9.4 12 L6.8 14.4 L9.4 16.8 L20 16.8 Z" fill="${STEEL}" ${stroke(1.3)}/>`,
};

/** The SVG markup of an omen's icon on a dark disc, `size` px square. */
export function omenIconSvg(id: RtOmenId, size = 24): string {
  return `<svg class="rt-omen-icon" data-omen="${id}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="11.2" fill="${DISC}" stroke="${NAVY}" stroke-width="1.2"/><g transform="translate(2.4 2.4) scale(0.8)">${BODIES[id]}</g></svg>`;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The omen's rule in one line: the name, the plus, the price (the hover and the card's line). */
export const omenRule = (def: RtOmenDef): string => `«${def.title}» — ${def.plus}; цена: ${def.cost}`;

/** The sign in the header of the map, after the word of the level (empty without an omen of the level). */
export function omenSign(run: Pick<RtRunState, 'omens' | 'garrisonLevel'>): string {
  const id = rtLevelOmen(run), def = id ? rtOmen(id) : undefined;
  if (!id || !def) return '';
  return `<span class="rt-run-omen" data-testid="run-omen" data-omen="${id}" title="${esc(`Примета уровня: ${omenRule(def)}`)}">${omenIconSvg(id, 24)}</span>`;
}

/** The badge of a node on the map (an `<svg>` nested in the map's, at the circle's upper right edge); `title` — the omen's name. */
export function omenBadge(id: RtOmenId): string {
  const def = rtOmen(id);
  return `<svg class="rt-omen-badge" data-testid="map-omen" data-omen="${id}" x="4" y="-27" width="21" height="21" viewBox="0 0 24 24"><title>${esc(def ? omenRule(def) : id)}</title>`
    + `<circle cx="12" cy="12" r="11.2" fill="${DISC}" stroke="${NAVY}" stroke-width="1.6"/><g transform="translate(2.4 2.4) scale(0.8)">${BODIES[id]}</g></svg>`;
}

/**
 * The omens of a fight as the card and the window «Бой» show them (spec 3.3, 4.3, question 14): the node's own — a line with its icon
 * (the rule: name, plus, price); the level's — an icon only, beside it (the hover tells the rule). Empty without either.
 */
export function omenCardHtml(omens: RtFightOmens | undefined): string {
  if (!omens || (!omens.node && !omens.level)) return '';
  const node = omens.node ? rtOmen(omens.node) : undefined, level = omens.level ? rtOmen(omens.level) : undefined;
  const chip = level ? `<span class="rt-omen-level" data-testid="run-danger-omen-level" data-omen="${level.id}" title="${esc(`Примета уровня: ${omenRule(level)}`)}">${omenIconSvg(level.id, 22)}${node ? '' : `<b>Примета уровня:</b> «${esc(level.title)}»`}</span>` : '';
  if (node) return `<li class="rt-omen-line" data-testid="run-danger-omen" data-omen="${node.id}">${omenIconSvg(node.id, 22)}<span class="rt-omen-text"><b>Примета:</b> ${esc(omenRule(node))}</span>${chip}</li>`;
  return `<li class="rt-omen-line" data-testid="run-danger-omen-only">${chip}</li>`;
}

/** Every omen id with its icon — for the meta cards and the tests. */
export const OMEN_ICON_IDS: readonly RtOmenId[] = RT_OMENS.map(def => def.id);

/** A whole SVG document of an omen's icon (24 × 24, the disc and the picture) — the fight's start flash draws it in the world (`Graphics.svg`). */
export const omenSvgDoc = (id: RtOmenId): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11.2" fill="${DISC}" stroke="${NAVY}" stroke-width="1.2"/><g transform="translate(2.4 2.4) scale(0.8)">${BODIES[id]}</g></svg>`;

/**
 * The omens a run's end opened, as the end screen says them (spec 7.2; «Приметы: +N», the pack's omen card): for a viewer the gates are
 * open for (`playedWith` — the run had omens, or `gateOpen` — they open with this run). `before`, `after` — the profile's pool before and
 * after the end (`rtProfileOmenPool`); a run played with omens says the new ones, a run that opens the gates says the whole pool. `card` —
 * the omen the opened pack gives (core `rtPackOmen`), a card after the pack's items.
 */
export function omensEnd(input: { playedWith: boolean; gateOpen: boolean; before: readonly string[]; after: readonly string[]; packId?: string }): { gained: number; card?: { id: RtOmenId; kind: 'omen' } } {
  if (!input.playedWith && !input.gateOpen) return { gained: 0 };
  const gained = input.playedWith ? input.after.filter(id => !input.before.includes(id)).length : input.after.length;
  const card = input.packId ? rtPackOmen(input.packId) : undefined;
  return { gained, ...card ? { card } : {} };
}
