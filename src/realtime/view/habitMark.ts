/**
 * Task 50 «Повадка» (design 16.10.2026, docs/design-notes/task-50-levels-archetype.md, 4.6, ui): the icons of the four run archetypes
 * and the mark an item card carries when it has the run's tag — inline SVG in the art style (docs/character-art-style.md: a navy
 * outline, flat colours, one shade, no text), each on a dark disc so that it is not taken for an item's icon («Наледь»'s shards, the
 * fire of the consumables). The view reads the catalogue's tags (`rtTalisman(id).tags`) and the run's `habit`; it keeps no table of its own.
 */
import { RT_HABITS, rtHabit, rtTalisman, type RtHabitId } from '../run/rtTalismans';
import type { RtRunState } from '../run/rtRun';

const NAVY = '#18232d';
const LEMON = '#ffff66';
const PALE = '#dbe9f4';
const ICE = '#9fd8ff';
const EMBER = '#ff8a3a';
const FLAME = '#ffd36b';
const CORAL = '#ff6f61';
const MINT = '#6fe0b8';
const STEEL = '#8a98a6';
const DISC = '#233039';

/**
 * A cluster of icicles under a frosted ledge: three of uneven length, ice with a pale glint. Not a snowflake — the snowflake is the
 * consumable «Холод» (design 17.10.2026, task 50 §17).
 */
const icicles = (): string => {
  const one = (d: string, glint: string): string => `<path d="${d}" fill="${ICE}" stroke="${NAVY}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path d="${glint}" stroke="${PALE}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`;
  return one('M2.4 6.4 L9 6.4 L5.4 17.6 Z', 'M4.6 8 L5.2 12')
    + one('M8 6.4 L16 6.4 L12 23.2 Z', 'M10.4 8.2 L11.2 15.6')
    + one('M15 6.4 L21.6 6.4 L18.6 15 Z', 'M17 8 L17.5 11')
    + `<path d="M1.2 4.4 Q12 0.6 22.8 4.4 L22.4 8 Q12 5.8 1.6 8 Z" fill="${PALE}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/>`;
};

const BODIES: Readonly<Record<RtHabitId, string>> = {
  // «Стужа»: a cluster of icicles.
  cold: icicles(),
  // «Пламя»: a tongue of flame with a bright heart.
  flame: `<path d="M12 2.6 C14 6.4 18.6 9 18.2 14.4 C17.9 18.6 15.2 21.4 12 21.4 C8.8 21.4 6.1 18.6 5.8 14.4 C5.6 11.6 7.4 10 8.6 8.2 C9.2 10 10.2 10.8 11 10.8 C10.6 7.6 11.2 5 12 2.6 Z" fill="${EMBER}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<path d="M12 12.4 C13.4 14.2 15 15.2 14.8 17.4 C14.6 19 13.5 19.8 12 19.8 C10.5 19.8 9.4 19 9.2 17.4 C9 15.4 11 14.6 12 12.4 Z" fill="${FLAME}" stroke="${NAVY}" stroke-width="1.2" stroke-linejoin="round"/>`,
  // «Перелив»: a ring of two colours, turning (two arrows chase each other).
  shift: `<path d="M12 4 A8 8 0 0 1 20 12" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linecap="round"/><path d="M12 20 A8 8 0 0 1 4 12" fill="none" stroke="${NAVY}" stroke-width="5" stroke-linecap="round"/>`
    + `<path d="M12 4 A8 8 0 0 1 20 12" fill="none" stroke="${CORAL}" stroke-width="3" stroke-linecap="round"/><path d="M12 20 A8 8 0 0 1 4 12" fill="none" stroke="${MINT}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M17.2 8.6 L21.4 13 L22.6 7.4 Z" fill="${CORAL}" stroke="${NAVY}" stroke-width="1.2" stroke-linejoin="round" transform="translate(-2.4 -0.6)"/>`
    + `<path d="M6.8 15.4 L2.6 11 L1.4 16.6 Z" fill="${MINT}" stroke="${NAVY}" stroke-width="1.2" stroke-linejoin="round" transform="translate(2.4 0.6)"/>`,
  // «Удаль»: a blade pointing up with a bold guard.
  daring: `<path d="M12 2.4 L15 6.4 L14 15 L10 15 L9 6.4 Z" fill="${STEEL}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 4.6 L12 13.6" stroke="${PALE}" stroke-width="1.2" stroke-linecap="round"/>`
    + `<path d="M5 15 L19 15 L17.6 18 L6.4 18 Z" fill="${LEMON}" stroke="${NAVY}" stroke-width="1.6" stroke-linejoin="round"/><rect x="10.4" y="18" width="3.2" height="3.6" rx="1" fill="${CORAL}" stroke="${NAVY}" stroke-width="1.4"/>`,
};

/** The SVG markup of an archetype's icon, `size` px square. */
export function habitIconSvg(habit: RtHabitId, size = 24): string {
  return `<svg class="rt-habit-icon" data-habit="${habit}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="11.2" fill="${DISC}" stroke="${NAVY}" stroke-width="1.2"/><g transform="translate(2.4 2.4) scale(0.8)">${BODIES[habit]}</g></svg>`;
}

/**
 * Task 51г (design 17.10.2026): the sign of the vows taken - a knot on a rope (a vow is tied, not starred: the star is «Охотник на элит»).
 * The same make as the archetypes' icons: a dark disc, a navy outline, flat colours, no text.
 */
const ROPE = '#d9b878', ROPE_SHADE = '#a8844a';
export function vowIconSvg(size = 24): string {
  return `<svg class="rt-vow-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="11.2" fill="${DISC}" stroke="${NAVY}" stroke-width="1.2"/>`
    + `<path d="M4 19.4 C8 18.6 10.4 15.6 12 12.6 C14 8.8 19 9.4 18.6 13 C18.2 16.6 12.6 16 11.6 12 C10.8 8.6 14 5.4 20 5" fill="none" stroke="${NAVY}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M4 19.4 C8 18.6 10.4 15.6 12 12.6 C14 8.8 19 9.4 18.6 13 C18.2 16.6 12.6 16 11.6 12 C10.8 8.6 14 5.4 20 5" fill="none" stroke="${ROPE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<ellipse cx="12" cy="12.4" rx="3.4" ry="2.7" transform="rotate(-35 12 12.4)" fill="${ROPE}" stroke="${NAVY}" stroke-width="1.5"/>`
    + `<path d="M10.2 13.4 C11 11.2 13 10.8 14 11.6" fill="none" stroke="${ROPE_SHADE}" stroke-width="1.2" stroke-linecap="round"/>`
    + `<path d="M3.2 20.6 L2.2 22.2 M5.6 20.8 L5.4 22.6" fill="none" stroke="${NAVY}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

/** The archetypes in the order of the row (`RT_HABITS`). */
export const HABIT_IDS: readonly RtHabitId[] = RT_HABITS.map(def => def.id);

/**
 * The mark of an item card: the icon of the run's archetype in the card's corner, no caption — only when `id` carries the run's tag
 * (`rtTalisman(id).tags`). Empty for a run without an archetype and for an untagged item. Put it inside the card's button
 * (`.rt-run-choice` is positioned). Task 50 step 3 («Сноровка») calls it the same way.
 */
export function habitMark(run: Pick<RtRunState, 'habit'> | null | undefined, id: string): string {
  const habit = run?.habit;
  if (!habit || !rtTalisman(id)?.tags?.includes(habit)) return '';
  return `<i class="rt-habit-mark" data-habit="${habit}" data-for="${id}" data-testid="habit-mark-${id}" title="${rtHabit(habit).name}">${habitIconSvg(habit, 26)}</i>`;
}

/** The sign of the chosen archetype in the map's header (empty without one). */
export function habitSign(run: Pick<RtRunState, 'habit'>): string {
  const habit = run.habit;
  if (!habit) return '';
  return `<span class="rt-run-habit" data-testid="run-habit" data-habit="${habit}" title="Повадка: ${rtHabit(habit).name}">${habitIconSvg(habit, 24)}</span>`;
}
