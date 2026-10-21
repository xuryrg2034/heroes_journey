/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md, sections 3 and 7.3): the chronicle's catalogue — the
 * entries of each page and chapter, the level of a chapter, the branch of an event, the recipes. Built from the catalogues of the code
 * (no entry without its content in this build, section 4.6): the forest's kinds of the schedule and the garrison's kinds (sim/enemies),
 * the elite affixes, the forest's events and the goblins' circle, the run's talismans (without the ones the run never offers), «Близнецы»,
 * the relics, the forms, the fusions, the heroes, the «Испытание» ladder, the camp's NPCs. A leaf: no view import. The Chief (task 54)
 * and the castle with the Warlock (task 55) join here with their tasks, once they are in the run.
 */
import { FOREST_EVENTS, type EventBranch } from '../forest/forestEvents';
import { AFFIX_IDS } from '../sim/elites';
import { FUSION_RECIPES } from '../sim/buildIds';
import { GUARD, HANDLER, HOUND, KEYMASTER, KNIGHT } from '../sim/enemies/garrison';
import { CROSSBOW } from '../sim/enemies/crossbow';
// Task 59б: the kinds of the garrison's step 3.
import { PITCHER } from '../sim/enemies/pitcher';
import { RECRUIT } from '../sim/enemies/recruit';
import { WARDEN } from '../sim/enemies/warden';
import { JAILER_RUN_ARENAS, TROLL_RUN_ARENAS } from '../sim/arenasBoss';
import { SCHEDULE_KINDS } from './schedule';
import { GARRISON_FINAL_ARENA } from './garrison';
import { RT_FORMS, RT_FUSIONS, RT_OPENERS, RT_RELICS, RT_TALISMANS } from './rtTalismans';
import { RT_HERO_IDS, type RtHearthNpc, type RtHeroId } from './metaCatalog';
import { RT_ASH_MAX } from './rtRun';

/** The six pages, in the book's order (the view's tabs). */
export type RtChroniclePageId = 'bestiary' | 'bosses' | 'events' | 'items' | 'heroes' | 'hearth';
export const RT_CHRONICLE_PAGES: readonly RtChroniclePageId[] = ['bestiary', 'bosses', 'events', 'items', 'heroes', 'hearth'];
/** The levels of this build (1 — the forest, 2 — the garrison); task 55 adds the castle (3). A chapter of a level not reached is hidden. */
export const RT_CHRONICLE_LEVELS: readonly number[] = [1, 2];

/** Bestiary: the forest's kinds (the schedule's special kinds; the weak enemy has no caption — no entry) and the garrison's. */
export const RT_CHRONICLE_FOREST_KINDS: readonly string[] = [...SCHEDULE_KINDS];
/** Task 59б (spec 10): the step 3's three join the garrison's chapter — 6 → 9 (the page 18 → 21). */
export const RT_CHRONICLE_GARRISON_KINDS: readonly string[] = [GUARD, HANDLER, HOUND, KEYMASTER, CROSSBOW, KNIGHT, PITCHER, RECRUIT, WARDEN];
/** Every kind with an entry (what `chronicleMeet` keeps). */
export const RT_CHRONICLE_KINDS: readonly string[] = [...RT_CHRONICLE_FOREST_KINDS, ...RT_CHRONICLE_GARRISON_KINDS];
export const RT_CHRONICLE_AFFIXES: readonly string[] = AFFIX_IDS;

/** The bosses of this build: the level of each, the arenas of its fight (a won fight there — «побеждён»). */
export type RtChronicleBoss = 'jailer' | 'troll' | 'castellan';
export const RT_CHRONICLE_BOSSES: readonly { id: RtChronicleBoss; level: number; arenas: readonly string[] }[] = [
  { id: 'jailer', level: 1, arenas: JAILER_RUN_ARENAS },
  { id: 'troll', level: 1, arenas: TROLL_RUN_ARENAS },
  { id: 'castellan', level: 2, arenas: [GARRISON_FINAL_ARENA] },
];
export const isRtChronicleBoss = (id: unknown): id is RtChronicleBoss => RT_CHRONICLE_BOSSES.some(boss => boss.id === id);

/** The goblins' circle (`run.casino`): an entry of the events' page (its id in `chronicle.events`). */
export const RT_CHRONICLE_CASINO = 'casino';
/** The events: the forest's (in the catalogue's order) with their branch, then the circle (any branch: it stands on an event node). */
export const RT_CHRONICLE_EVENTS: readonly { id: string; branch: EventBranch }[] = [
  ...Object.values(FOREST_EVENTS).map(event => ({ id: event.id, branch: event.branch })),
  { id: RT_CHRONICLE_CASINO, branch: 'common' },
];

/** The items' chapters: the talismans (the slice's, the counters, «Близнецы»), the relics, the forms, the fusions. */
export type RtChronicleItemChapter = 'talismans' | 'relics' | 'forms' | 'fusions';
export const RT_CHRONICLE_ITEMS: Readonly<Record<RtChronicleItemChapter, readonly string[]>> = {
  talismans: [...RT_TALISMANS.filter(def => def.rarity !== 'relic').map(def => def.id), ...RT_OPENERS.map(def => def.id)],
  relics: RT_RELICS.map(def => def.id),
  forms: RT_FORMS.map(def => def.id),
  fusions: RT_FUSIONS.map(def => def.id),
};
export const RT_CHRONICLE_ITEM_IDS: readonly string[] = Object.values(RT_CHRONICLE_ITEMS).flat();
export const isRtChronicleItem = (id: unknown): id is string => typeof id === 'string' && RT_CHRONICLE_ITEM_IDS.includes(id);
export const isRtChronicleFusion = (id: unknown): id is string => typeof id === 'string' && RT_CHRONICLE_ITEMS.fusions.includes(id);
/** The two parts of a fusion (`FUSION_RECIPES`). */
export const rtChronicleParts = (fusion: string): readonly string[] => {
  const recipe = FUSION_RECIPES.find(entry => entry.fusion === fusion);
  return recipe ? [recipe.form, recipe.counter] : [];
};

/** Heroes: every hero, and the «Испытание» ladder of each (steps 1 … RT_ASH_MAX). */
export const RT_CHRONICLE_HEROES: readonly RtHeroId[] = RT_HERO_IDS;
export const RT_CHRONICLE_ASH_STEPS = RT_ASH_MAX;
/** The camp's NPCs of the page «Очаг» (Шиш and Евлампий only while their camp is on). */
export const rtChronicleNpcs = (on: { gambler: boolean; monk: boolean }): RtHearthNpc[] =>
  ['owl', 'herb', 'smith', ...on.gambler ? ['gambler' as const] : [], ...on.monk ? ['monk' as const] : []];
