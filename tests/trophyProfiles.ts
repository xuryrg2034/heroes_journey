import { seedOf, walkRun } from '../src/realtime/run/metaWalk.testkit';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from '../src/realtime/run/rtRunStorage';
import { RT_TROPHY_LONG_CHAIN } from '../src/realtime/run/trophies';
import { RT_CHRONICLE_FOREST_KINDS } from '../src/realtime/run/chronicleCatalog';
import { rtReachedJailer, rtRunWon, type RtArenaOutcome, type RtRunState } from '../src/realtime/run/rtRun';
import { RT_HERO_ID } from '../src/realtime/run/metaCatalog';
import { garrisonArenaKinds, garrisonStep2Mode, rtGarrisonNodeId } from '../src/realtime/run/garrison';

/**
 * Task 51е (tests only, not a spec file): stored profiles made by REAL runs of core's rules — whole meta runs walked by the run's own
 * commands (the walk of `metaWalk.testkit.ts`, the fight's outcome fed back as the view builds it), ended through the profile store, the
 * way core's `trophies.spec.ts` does. The browser tests put the stored JSON in `localStorage` and open the camp.
 */
export { RT_PROFILE_STORAGE_KEY };
export interface TrophyProfile { json: string; earned: { id: string; mark?: number }[]; held: string[]; runs: number }

function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

const keymaster = (run: RtRunState, nodeId: string, arena: string): boolean =>
  !!rtGarrisonNodeId(nodeId) && garrisonArenaKinds(arena, run.step2 ? garrisonStep2Mode(nodeId) : !!run.moat).includes('keymaster');
const fed = (run: RtRunState, extra: Partial<RtArenaOutcome>): RtArenaOutcome => ({ nodeId: run.pending!.kind === 'battle' ? run.pending!.nodeId : '', won: true, hp: run.maxHp, kills: 20, damage: 0, time: 60, ...extra });

/**
 * The profile after meta runs of seeds 1…`count` (as core's check walks them); `stopAtFirst` — stop after the first run that earned a
 * trophy (its end is the profile's `applied`, the camp drops what it earned).
 */
export function trophyProfile(count: number, stopAtFirst = false): TrophyProfile {
  const storage = memoryStorage(), s = createRtProfileStore(storage, { trophies: true, chronicle: true });
  let earned: { id: string; mark?: number }[] = [];
  for (let k = 1; k <= count; k++) {
    const ash = k % 4 === 0 ? 2 : k % 4 === 1 ? 5 : 0;
    let cut = false, longest = false;
    const den = k % 3 === 0 ? { pickNode: (_run: RtRunState, ids: readonly string[]) => ids.find(id => id.includes('den')) ?? null } : {};
    s.startRun();
    const walk = walkRun({ k, create: { gift: 'full', garrison: k % 3 === 0, chronicle: true, ...ash ? { ash } : {}, locked: s.locked(), hearth: s.hearthStart(seedOf(k)).flags }, ...den, fight: run => {
      const pending = run.pending!.kind === 'battle' ? run.pending! : undefined;
      if (pending && !cut && keymaster(run, pending.nodeId, pending.arena)) { cut = true; return fed(run, { cuts: 1 }); }
      if (pending && !longest && run.battles.length === 2 && k % 2 === 0) { longest = true; return fed(run, { bestChain: RT_TROPHY_LONG_CHAIN }); }
      return null;
    } });
    // The build's forest chapter (task 57а, 11 kinds with the shooters since 22.10.2026): «Чернильница» needs them all.
    if (k <= 3) s.chronicleMeet(walk.run, { kinds: RT_CHRONICLE_FOREST_KINDS.filter((_, i) => i % 3 === k - 1), affixes: [] });
    // As the view ends a run: the profile's own record (`won`, the Jailer reached) first, then the meta's end.
    s.endRun({ reachedJailer: rtReachedJailer(walk.run), seeded: !!walk.run.seeded, won: rtRunWon(walk.run), hero: walk.run.heroId ?? RT_HERO_ID });
    const end = s.endRunMeta(walk.run)!;
    earned = [...end.trophies ?? []];
    if (stopAtFirst && earned.length) break;
  }
  return { json: storage.data.get(RT_PROFILE_STORAGE_KEY)!, earned, held: s.trophies().map(t => t.id), runs: s.load().runs ?? 0 };
}
