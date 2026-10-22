/**
 * Task 58б (tests only): stored profiles for the window of the chronicle — a newcomer in the first camp, a viewer after the garrison, a half
 * recipe, unread marks. They are PROFILES, not contracts: the contract is core's `rtChronicleView` over `parseRtProfile` of these, so the
 * Node checks and the browser tests (which store the same JSON under `RT_PROFILE_STORAGE_KEY`) see what the game would build.
 */
import { RT_CHRONICLE_FOREST_KINDS } from '../run/chronicleCatalog';
import { parseRtProfile, RT_PROFILE_STORAGE_KEY, type RtProfile } from '../run/rtRunStorage';
import { rtChronicleView, type RtChronicleView } from '../run/chroniclePages';
import type { RtChronicle } from '../run/chronicle';
import type { RtHeroId } from '../run/metaCatalog';

export { RT_PROFILE_STORAGE_KEY };
const HEARTH = { stock: 3, levels: { owl: 0, herb: 0, smith: 0 }, met: {}, lines: { 'owl:first': 2 }, quiet: 0 };
const cat = { xp: 20, packs: [], record: { row: 3, won: false, xp: 20 } };

type Raw = Record<string, unknown>;
const profile = (chronicle: RtChronicle, rest: Raw = {}, meta: Raw = {}): Raw => ({
  version: 1, giftFull: false, runs: 3, ...rest, meta: { heroes: { cat }, hearth: HEARTH, ...meta, chronicle: { since: 3, ...chronicle } },
});

/** The stored profiles by name. */
export const CHRONICLE_FIXTURES: Readonly<Record<string, () => Raw>> = {
  /** The first camp of a newcomer: two kinds met, the forest's bosses not yet, nothing else. */
  novice: () => profile({ kinds: ['boar', 'wolf'], events: ['brook'], items: { whetstone: 2, 'dew-flask': 1 } }),
  /** After the garrison: its chapters open (every forest kind of the build met — with the shooters' flag, on since 22.10.2026, eleven), the Castellan won, Ведунья free, fusions made, the Испытание climbed. */
  garrison: () => profile({
    kinds: [...RT_CHRONICLE_FOREST_KINDS, 'guard', 'handler', 'hound'], affixes: ['fiery', 'swift'],
    bosses: { jailer: { met: 3, won: 3 }, troll: { met: 2 }, castellan: { met: 14, won: 14 } },
    events: ['brook', 'goblin-cache', 'owl-hollow', 'warm-den', 'casino', 'porcupine-nest'],
    items: { whetstone: 2, 'dew-flask': 2, 'tough-hide': 1, prism: 2, 'frost-edge': 2, 'form-seal': 2, 'fusion-ice-seal': 2, 'relic-swift-feet': 1, 'fire-pass': 2, 'elite-hunter': 1 },
    fusions: ['fusion-ice-seal'],
  }, { won: true, heroAsh: { toad: { won: true, ash: 2 } } }, {
    heroes: { cat: { ...cat, record: { row: 5, won: true, xp: 900, level: 2, wonLevel: 2 }, ashBest: 5 }, toad: { xp: 0, packs: [], ashBest: 2 } },
    freed: { toad: { row: 5, run: 3 } },
    hearth: { ...HEARTH, met: { herb: true, smith: true } },
  }),
  /** A half recipe: «Иней на клинке» is taken, its fusion's «?» shows «Иней на клинке + ?» (a pair of another fusion was held: the chapter shows). */
  fusionHalf: () => profile({ kinds: ['boar', 'wolf'], events: ['brook'], items: { whetstone: 2, 'frost-edge': 2, prism: 1, 'fusion-boomerang': 1 } }),
  /** The retro brought old pages (`retro`, `since` set): the owl says `chronicle_retro` once; the memory of the line is the profile's. */
  retro: () => profile({ kinds: ['boar', 'wolf'], retro: true }),
  /** Unread marks on two pages (a kind and an item). */
  unread: () => profile({ kinds: ['boar', 'lynx', 'wolf'], items: { whetstone: 2, prism: 2 }, unread: ['kind:lynx', 'item:prism'] }),
};

/** The profile as the game reads it back from storage. */
export const chronicleProfile = (name: string): RtProfile => parseRtProfile(JSON.stringify(CHRONICLE_FIXTURES[name]!()));

/** The book of a fixture for `hero` (the camp's NPCs on). */
export const chronicleViewOf = (name: string, hero: RtHeroId = 'cat', on = { gambler: true, monk: true }): RtChronicleView => rtChronicleView(chronicleProfile(name), hero, on);
