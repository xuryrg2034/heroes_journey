/**
 * Task 46 «Сплавы v2» (docs/design-notes/task-46-fusions-v2.md, sections 3, 7, 8, 14): the build modules of the three fusions of the
 * dash's end. The rules are pure functions of sim/fusions.ts; the highlight (chain.ts `planChain`: `fire.paint`, `blast`, `wave`)
 * and the dash read them. Here the release fixes what the highlight showed, and the end of the dash plays it:
 *
 * - «Ледяная волна» (`fusion-frost-wave`): the wave's bodies (`World.build['fusion-frost-wave']` `{ fixed }`); the wave strikes and
 *   freezes them in «Ударная волна»'s own end (talismansRt.ts), those still on the arena wherever they stand.
 * - «Подрыв» (`fusion-hunter-blast`): the end blast's bodies and whether it detonates (`World.build['fusion-hunter-blast']`); the
 *   blast is the hammer's own end (hammers.ts `hunterBlast`).
 * - «Клеймо» (`fusion-brand`): the colour and the bodies along the lit path (`World.build['fusion-brand']`); at the end of the dash,
 *   after the wave and the blast, the bodies still on the arena take the colour — only when the path lit (the dash reached the fire's
 *   threshold, `fireMinLinks`). A «Хамелеон» takes the colour and its period starts again (as elites.ts `adoptChainColor`).
 *
 * Each state is set at the release (or removed when the highlight showed nothing) and removed at the end of the dash: a world
 * without the fusion has none of them. No random draws, no transcendental `Math.*`.
 */
import { buildStateOf, registerBuildModule, setBuildState, talismanFired } from './build';
import { FUSIONS } from './buildIds';
import { fireMinLinks } from './chain';
import { eliteAffixes } from './elites';
import { BOSS_CORES } from './enemies/jailer';
import { kindOf } from './enemies/kinds';
import { brandPaintable } from './fusions';
import type { World } from './world';

/** `World.build['fusion-brand']`: the colour and the bodies the release fixed. */
export interface BrandState { color: number; ids: number[] }

registerBuildModule({
  id: FUSIONS.frostWave,
  onRelease: (world, release) => {
    const wave = release.fusion?.wave;
    setBuildState(world, FUSIONS.frostWave, wave ? { fixed: wave.bodies.map(b => b.id) } : undefined);
  },
});

registerBuildModule({
  id: FUSIONS.hunterBlast,
  onRelease: (world, release) => {
    const blast = release.fusion?.blast;
    setBuildState(world, FUSIONS.hunterBlast, blast ? { ids: blast.bodies.map(b => b.id), detonate: blast.detonate } : undefined);
  },
});

/** «Клеймо»: the fixed bodies still on the arena take the colour (a body of that colour already, or no longer paintable — not). */
function paint(world: World, state: BrandState): void {
  const painted: number[] = [];
  for (const id of state.ids) {
    const e = world.enemies.find(x => x.id === id);
    if (!e || e.color === state.color || !brandPaintable(e, !!kindOf(e).immune, BOSS_CORES)) continue;
    e.color = state.color;
    if (eliteAffixes(e).includes('chameleon')) e.chameleon = Math.max(0.05, world.params.chameleonPeriod);
    painted.push(id);
  }
  if (!painted.length) return;
  world.events.push({ type: 'paint', ids: painted, color: state.color });
  talismanFired(world, FUSIONS.brand, painted.length);
}

registerBuildModule({
  id: FUSIONS.brand,
  onRelease: (world, release) => {
    const p = release.fusion?.paint;
    setBuildState(world, FUSIONS.brand, p && p.ids.length ? { color: p.color, ids: [...p.ids] } satisfies BrandState : undefined);
  },
  onChainEnd: (world, end) => {
    const state = buildStateOf<BrandState>(world, FUSIONS.brand);
    if (!state) return;
    setBuildState(world, FUSIONS.brand, undefined);
    // The path lit (hammers.ts `igniteFire`: the same count, `ChainEnd.links`).
    if (end.links >= fireMinLinks(world.params)) paint(world, state);
  },
});
