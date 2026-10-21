/**
 * Task 51е «Трофеи на стене лагеря» (docs/design-notes/task-51-camp-l3.md, section 4): the perch at the top of the camp — ten hooks, the
 * trophies hung in the order they came (the contract of core's `profile.trophies()`), an empty hook is a bare peg (no silhouette, no
 * text). Pure: the list in, HTML out; the camp (`hearthView.ts`) holds the drop of the new ones. A trophy gives nothing in a run; the
 * view draws only what the profile holds and keeps no rule of earning (core's `run/trophies.ts`). Names: the spec's table of section 4.
 */
import { RT_TROPHY_HOOKS, type RtTrophy, type RtTrophyId } from '../run/trophies';

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** The trophies' names (spec 4). */
export const TROPHY_NAMES: Readonly<Record<RtTrophyId, string>> = {
  jailer: 'Гиря Тюремщика', severed: 'Обрубок цепи', troll: 'Рог Тролля', chief: 'Котелок Главаря', shackles: 'Сломанные кандалы',
  castellan: 'Знамя Кастеляна', ash: 'Доска Испытания', bestiary: 'Чернильница Неясыти', 'long-chain': 'Длинная цепь',
};
/** The pictures (public/art/camp). */
const TROPHY_ART: Readonly<Record<RtTrophyId, string>> = {
  jailer: 'trophy-jailer', severed: 'trophy-severed', troll: 'trophy-troll', chief: 'trophy-chief', shackles: 'trophy-shackles',
  castellan: 'trophy-castellan', ash: 'trophy-ash', bestiary: 'trophy-bestiary', 'long-chain': 'trophy-chain',
};
/** The stand-in if the picture does not load: the first letter on a round plate. */
const fallback = (id: RtTrophyId): string => `<span class="rt-hearth-trophy-fb" hidden>${esc(TROPHY_NAMES[id].slice(0, 1))}</span>`;

/** What the pointer shows: the name and the run's number («Поход 14»; the retro, run 0, has none); «Доска Испытания» — its steps. */
export function trophyTip(trophy: RtTrophy): { name: string; run: string; marks: string } {
  return { name: TROPHY_NAMES[trophy.id], run: trophy.run > 0 ? `Поход ${trophy.run}` : '', marks: trophy.marks?.length ? `Испытание: ${trophy.marks.map(m => ROMAN[m] ?? String(m)).join(' ')}` : '' };
}

/** The key of what a run earned for the memory of the drop and of the owl's line (`marks`: a new mark of «Доска» is its own). */
export const trophyKey = (earned: { id: string; mark?: number }): string => (earned.mark ? `${earned.id}:${earned.mark}` : earned.id);

/** The perch: `trophies` on the hooks in order; `dropping` — ids that fall on their hook now. */
export function perchHtml(trophies: readonly RtTrophy[], dropping: ReadonlySet<string>, artUrl: (path: string) => string): string {
  const hooks = Array.from({ length: RT_TROPHY_HOOKS }, (_, i) => {
    const trophy = trophies[i];
    if (!trophy) return `<span class="rt-hearth-hook" data-testid="hearth-hook-${i}"></span>`;
    const tip = trophyTip(trophy), drop = dropping.has(trophy.id);
    const lines = `<b>${esc(tip.name)}</b>${tip.run ? `<i>${esc(tip.run)}</i>` : ''}${tip.marks ? `<i>${esc(tip.marks)}</i>` : ''}`;
    return `<span class="rt-hearth-hook rt-hearth-hung${drop ? ' rt-drop' : ''}" tabindex="0" data-testid="hearth-trophy-${trophy.id}" data-trophy="${trophy.id}" data-run="${trophy.run}" aria-label="${esc([tip.name, tip.run].filter(Boolean).join(', '))}">`
      + `<img src="${artUrl(`camp/${TROPHY_ART[trophy.id]}.png`)}" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">${fallback(trophy.id)}`
      + `<span class="rt-hearth-trophy-tip" data-testid="hearth-trophy-tip-${trophy.id}">${lines}</span></span>`;
  }).join('');
  return `<div class="rt-hearth-perch" data-testid="hearth-perch"><div class="rt-hearth-rod"></div><div class="rt-hearth-hooks">${hooks}</div></div>`;
}
