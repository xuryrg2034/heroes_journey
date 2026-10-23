/**
 * Task 60а «Замок: гости» (design 17.10.2026, docs/design-notes/task-60-castle-enemies.md, 10.2): the sandbox's arenas of the castle's
 * guests — a probe for each guest (one guest and an ordinary crowd) and «Столовая» (`c-dining`, the spec's layout: the candelabras at the
 * table's ends, the butler in the north). Each plays the law of the shove (`castle`), the arena's shooters' timer of task 57а
 * (`FOREST_VOLLEY_GAP`) and the dash's snuffing of light shots (`snuffShots`) for itself. The run's pools and rows are task 60б. The probes'
 * points are core's (PROVISIONAL, 23.10.2026); level design may tune them by journal commands.
 */
import { registerArena, type ArenaTemplate, type Pace, type StartEnemy } from './arenas';
import { wall } from './geometry';
import { BARREL } from './enemies/castle';
import { BUTLER, CANDELABRA, JESTER, POLTERGEIST, QUEEN } from './enemies/castleGuests';
import { FOREST_VOLLEY_GAP } from './shots';

const NO_PACKS: Partial<Pace> = { wolfShare: 0, boarShare: 0 };
const thing = (kind: string, x: number, y: number): StartEnemy => ({ x, y, color: 0, kind });
const basic = (x: number, y: number, color: number): StartEnemy => ({ x, y, color, hp: 0 });
/** The probes' crowd: eight plain enemies of colours 0–3 in the north half. */
const CROWD: readonly StartEnemy[] = [basic(4, 2, 0), basic(6, 2.6, 1), basic(10, 2.6, 2), basic(12, 2, 3), basic(3.6, 4.4, 1), basic(6.4, 4.6, 2), basic(9.6, 4.6, 3), basic(12.4, 4.4, 0)];
/** The guests' arenas play the castle's laws and the layer of shots for themselves (spec 11). */
const GUEST_RULES = { castle: true, volleyGap: FOREST_VOLLEY_GAP, snuffShots: true, phaseOverride: NO_PACKS } as const;

/** A probe (16 × 10, the door in the north): one guest with its things and the crowd; kill 20 by the chain. */
function probe(id: string, name: string, summary: string, guests: readonly StartEnemy[]): ArenaTemplate {
  return registerArena({
    id, name, summary, goal: 'kills', killGoal: 20, width: 16, height: 10, heroStart: { x: 8, y: 8.6 },
    obstacles: [], buttons: [], door: { x: 8, y: 0.7 }, enemies: [...guests, ...CROWD], ...GUEST_RULES,
  });
}

export const CANDELABRA_PROBE = probe('c-probe-candelabra', 'Подсвечник (проба)',
  'Убей цепью 20 врагов. Подсвечник крутит огненный крест. Кончи цепь на нём — он ляжет огнём.',
  [thing(CANDELABRA, 8, 6), thing(BARREL, 3, 7.4)]);
export const QUEEN_PROBE = probe('c-probe-queen', 'Ферзь (проба)',
  'Убей цепью 20 врагов. Ферзь стреляет во все восемь сторон — встань за бочку или между линиями.',
  [{ x: 8, y: 3.4, color: 1, kind: QUEEN }, thing(BARREL, 5, 6.6), thing(BARREL, 11, 6.6)]);
export const BUTLER_PROBE = probe('c-probe-butler', 'Дворецкий (проба)',
  'Убей цепью 20 врагов. Над тобой люстра — не стой. Убей дворецкого — люстра упадёт.',
  [{ x: 8, y: 1.6, color: 2, kind: BUTLER }]);
export const POLTERGEIST_PROBE = probe('c-probe-poltergeist', 'Полтергейст (проба)',
  'Убей цепью 20 врагов. Полтергейст швыряет бочки — убей его до броска.',
  [{ x: 8, y: 3.2, color: 3, kind: POLTERGEIST }, thing(BARREL, 6.2, 5.6), thing(BARREL, 9.8, 5.6), thing(BARREL, 2.4, 7.6), thing(BARREL, 13.6, 7.6)]);
export const JESTER_PROBE = probe('c-probe-jester', 'Шут (проба)',
  'Убей цепью 20 врагов. Шут кидает мяч — проведи цепь через мяч, он полетит обратно.',
  [{ x: 8, y: 3.4, color: 0, kind: JESTER }, thing(BARREL, 12.4, 6.6)]);

/** «Столовая» (`c-dining`, 18 × 11; spec 10.2): kill 25 by the chain; the table splits the hall, the candelabras at its ends, the butler north. */
export const DINING_ARENA: ArenaTemplate = registerArena({
  id: 'c-dining',
  name: 'Столовая',
  summary: 'Убей цепью 25 врагов. Кончи цепь на подсвечнике — он ляжет огнём. Убей дворецкого — люстра упадёт.',
  goal: 'kills',
  killGoal: 25,
  width: 18,
  height: 11,
  heroStart: { x: 9, y: 9.8 },
  obstacles: [wall(5, 5, 8, 1.2)],
  buttons: [],
  door: { x: 9, y: 0.7 },
  enemies: [
    thing(CANDELABRA, 3.6, 5.6), thing(CANDELABRA, 14.4, 5.6), { x: 9, y: 1.6, color: 1, kind: BUTLER }, thing(BARREL, 2, 9), thing(BARREL, 16, 9),
    basic(4, 2.4, 0), basic(6.5, 3.2, 1), basic(11.5, 3.2, 2), basic(14, 2.4, 3), basic(4.6, 7.8, 2), basic(7, 7.4, 3), basic(11, 7.4, 0), basic(13.4, 7.8, 1),
  ],
  ...GUEST_RULES,
});

/** The guests' arenas (the sandbox's group «Замок · гости»; the view orders the menu). */
export const GUEST_ARENAS: readonly ArenaTemplate[] = [CANDELABRA_PROBE, QUEEN_PROBE, BUTLER_PROBE, POLTERGEIST_PROBE, JESTER_PROBE, DINING_ARENA];
