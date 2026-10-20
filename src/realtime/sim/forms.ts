/**
 * Task 29 «Формы в песочнице» (docs/realtime-prototype.md, section 9ф): the forms of the field «Звено» as build modules on the
 * pure hooks `anchors` and `color` of build.ts. Ids — buildIds.ts `FORMS`; a module acts while `Kit.talismans` holds its id.
 * The rule (`enemyRefusal`), the highlight (`planChain`, `nextCandidates`) and П1 (linkDepth.ts) read the same hooks through
 * chain.ts `chainAnchors` and `colorJoin`, so the drawing, the hint and the depth never disagree.
 *
 * - **«Развилка»** (`form-fork`): the anchors are every link of the drawn chain (and the hero with «Якорь у героя», design answer
 *   4); before the first link — the hero, as always. The dash runs along the links in the order drawn; the shield still faces
 *   the previous link (chain.ts `enemyRefusal`). With «Развилка» there is no loop (chain.ts `loopOn`).
 * - **«Чужак»** (`form-alien`): once a chain, one link may be an enemy of another colour — any enemy, an elite and a tough one
 *   too (design answer 3). The chain keeps its colour: the next link is of the chain's colour again. The other refusals stay.
 * - **«Близнецы»** (`form-twins`): the palette's colours 1 + 3 and 2 + 4 (indices 0 + 2, 1 + 3; design answer 1) count as one
 *   colour. A row of 2–3 colours has a pair and a single colour, or two singles.
 *
 * Task 33 «Цена „Близнецов“ и „Развилки“» (the sandbox; task 30: a run with the flag `forms` too, run/rtRun.ts `RT_FORMS_PARAMS`): «Близнецы» alternate the pair's
 * colours once the chain took the second one (`Params.twinsAlternate`, chain.ts `colorSegments`) and turn «Смена цвета» off
 * (`Params.twinsNoShift`); «Развилка» takes `Params.forkBranches` links from an older link (`ChainLink.fork`, `forkSpent`).
 *
 * One colour rule acts (buildIds.ts `COLOR_RULE_RANK`: «Близнецы» before «Чужак»). No state, no events, no randomness.
 */
import { registerBuildModule } from './build';
import { FORMS } from './buildIds';
import { hasTalisman } from './kit';
import type { ChainLink, World } from './world';

/** «Близнецы»: the pair of a colour (colour index c and c ± 2 share a key). */
export const twinKey = (color: number): number => (color >= 2 ? color - 2 : color);

/** «Чужак»: enemy links of another colour one chain may take. */
export const ALIEN_LINKS = 1;

/**
 * Task 33 «Развилка» (`Params.forkBranches`): the links taken from an older link (`ChainLink.fork`) reached the limit — the anchors
 * are the plain ones again. 0 — no limit.
 */
export function forkSpent(world: World): boolean {
  const max = world.params.forkBranches ?? 0;
  return max > 0 && world.chain.filter(link => link.fork).length >= max;
}

/**
 * Task 52 «Числа», Р2 (`Params.forkDwell` > 0, the sandbox's gesture; docs/design-notes/task-52-numbers.md, 3.5): «Развилка» takes its
 * fork only from an older link the player chose — the pointer event (`dragChain` `full`) resting on a link of the chain that is not the
 * last nor the one before it (that one stays the step back) for `forkDwell` game seconds. 0, or a journal without the key — the old rule
 * (every link an anchor).
 */
export const forkDwellOn = (world: World): boolean => (world.params.forkDwell ?? 0) > 0;
/** Small slack of the dwell's game time (whole ticks of 1/60 s sum with a rounding). */
const DWELL_EPS = 1e-9;
/**
 * Task 52, Р2: the anchor the dwell chose now (`World.forkAnchor`), or null — the gesture off, «Развилка» not in the kit, the forks
 * spent, the link no longer an older link of the chain (taken off, the last or the one before it), or not held long enough yet (`ready`
 * — the pointer left it after the dwell was done; else the game time since it came there).
 */
export function forkAnchorNow(world: World): ChainLink | null {
  const fa = world.forkAnchor;
  if (!fa || !forkDwellOn(world) || !hasTalisman(world, FORMS.fork) || forkSpent(world)) return null;
  const at = world.chain.findIndex(l => l.kind === fa.kind && l.id === fa.id);
  if (at < 0 || at > world.chain.length - 3) return null;
  return fa.ready || world.time - fa.since >= world.params.forkDwell - DWELL_EPS ? { kind: fa.kind, id: fa.id } as ChainLink : null;
}

registerBuildModule({
  id: FORMS.fork,
  // Every link of the chain, then the hero when «Якорь у героя» made him an anchor (the default list holds him without a link);
  // task 33: the plain anchors once the forks are spent. Task 52, Р2 (`forkDwell`): the plain anchors, or only the link the dwell chose.
  anchors: (world, value, chain) => {
    if (forkSpent(world)) return [...value];
    if (!forkDwellOn(world)) return [...chain, ...value.filter(a => !a.link)];
    const chosen = forkAnchorNow(world);
    return chosen ? chain.filter(a => a.link?.kind === chosen.kind && a.link.id === chosen.id) : [...value];
  },
});

registerBuildModule({ id: FORMS.alien, color: { foreign: ALIEN_LINKS } });

registerBuildModule({ id: FORMS.twins, color: { key: twinKey, alternate: world => !!world.params.twinsAlternate, noShift: world => !!world.params.twinsNoShift } });
