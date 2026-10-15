/**
 * Task 27 «Каркас босса и Тюремщик в песочнице» (design 15.10.2026, docs/design-notes/tasks-26-28.md; the rules —
 * docs/realtime-elite-behaviors.md, «Каркас босса и Тюремщик»): the boss arena of the sandbox. Not in the run's pools.
 */
import { OUTPOST_ARENA, registerArena, type ArenaTemplate } from './arenas';
import { JAILER, JAILER_WEIGHT } from './enemies/jailer';

/**
 * «Тюремщик» — the layout of «Застава» (20×14: the yard on the brink, gates of 2 units north and south, the door on top), its
 * enemies replaced by the Jailer: the core (colour 1, marked — the goal) in the west of the yard, the cliff behind it, and its
 * weight (colour 0) in its hand. The newcomers: the panel's pace, basic enemies only (no wolf packs, no boars, no new kinds),
 * no chest. The whistle calls its adds at the gate farther from the hero. The arena turns `Params.bossFrame` on for itself.
 */
export const JAILER_ARENA: ArenaTemplate = registerArena({
  id: 'jailer',
  name: 'Тюремщик',
  summary: 'Босс (песочница): Тюремщик с кистенём во дворе заставы. Гиря — часть босса: отруби её цепью, и Тюремщик потеряет пластину и кистень. Убей Тюремщика — откроется дверь сверху.',
  goal: 'marked',
  width: OUTPOST_ARENA.width,
  height: OUTPOST_ARENA.height,
  heroStart: { ...OUTPOST_ARENA.heroStart },
  obstacles: OUTPOST_ARENA.obstacles,
  ...OUTPOST_ARENA.terrain ? { terrain: OUTPOST_ARENA.terrain } : {},
  buttons: [],
  door: { ...OUTPOST_ARENA.door },
  enemies: [
    { x: 7.5, y: 6.5, color: 1, kind: JAILER, marked: true },
    { x: 6.7, y: 6.9, color: 0, kind: JAILER_WEIGHT },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 },
  bossFrame: true,
  gates: [{ x: 10, y: 3.6 }, { x: 10, y: 9.5 }],
});

/** The boss arenas of the sandbox menu (the view adds them after the camera samples). */
export const BOSS_ARENAS: readonly ArenaTemplate[] = [JAILER_ARENA];
