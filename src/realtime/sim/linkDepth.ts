/**
 * П1 «Глубина звена» (docs/realtime-engagement-research.md, П1 and 9.1; design answers 11.10.2026;
 * docs/realtime-prototype.md, «Глубина звена»): for each valid next link of the drawn chain, how many enemy links the
 * chain could still take from it on, the candidate included.
 *
 * View only. The search never writes the world: it works on a shallow copy of the world whose `chain` is its own array
 * (enemies, objects, the arena and the build are shared and only read). Every step asks the game's own rules —
 * `planChain` and `canLink` / `canLinkObject` (power and survivors, plates, the shield's guard, the chameleon's window,
 * R of the build, line of sight, colours and crystals) — so the number never promises a path the dash would refuse.
 *
 * - N — enemy links of the longest path found, the candidate included, at most `LINK_DEPTH_MAX`. A last link that
 *   survives its hit counts (it is a link the dash strikes; nothing may follow it).
 * - A crystal continues the path (the next enemy sets the new colour) but is not counted; a burning brazier and an
 *   elite's loot continue it too (the brazier's power, the new anchor) and are not counted. Buttons, the door and the
 *   lever end a chain and are not counted: the search skips them.
 * - Budget: `LINK_DEPTH_BUDGET` expansions per candidate — an expansion is one chain state whose next links are
 *   checked (every enemy and every passable object of the arena). A search cut by the budget gives the best path found
 *   so far (`cut`); it never gives a path that is not valid.
 */
import { NO_PIERCE, OBJECT_RADIUS, canLink, canLinkObject, chainAnchors, nextCandidates, nextLink, planChain, reachOf } from './chain';
import { enemyArtRadius } from './enemies/kinds';
import { dist } from './geometry';
import type { ChainLink, Enemy, World } from './world';

/** Longest counted depth (enemy links from the candidate on, the candidate included). */
export const LINK_DEPTH_MAX = 6;
/** Chain states expanded per candidate before the search stops with the best path so far. */
export const LINK_DEPTH_BUDGET = 200;
/** The view shows the number only from this depth on. */
export const LINK_DEPTH_SHOWN = 2;

/** Objects the chain goes on after (`passObject` of chain.ts): crystal, loot, a burning brazier, the cursed chest (К7). */
const PASS_KINDS: ReadonlySet<string> = new Set(['crystal', 'loot', 'brazier', 'chest']);

export interface LinkDepth {
  /** The candidate enemy. */
  id: number;
  /** Enemy links of the longest path found from the candidate on, the candidate included (1…`LINK_DEPTH_MAX`). */
  depth: number;
  /** The links that path adds to the drawn chain, the candidate first (crystals, braziers, loot included). */
  path: ChainLink[];
  /** The budget stopped the search before it saw every path: `depth` is the best one found. */
  cut: boolean;
  /** Chain states expanded. */
  expanded: number;
}

export interface LinkDepthOptions { max?: number; budget?: number }

/** The world as the search sees it: the same world, with its own chain (no loop closed). */
function shadowOf(world: World): World {
  const shadow: World = { ...world, chain: [...world.chain] };
  delete shadow.chainClosed;
  return shadow;
}

/**
 * The longest path of the chain from `enemy` taken as the next link now. `enemy` must be a valid next link
 * (`canLink`); otherwise depth 0 and an empty path.
 */
export function linkDepth(world: World, enemy: Enemy, options: LinkDepthOptions = {}): LinkDepth {
  const max = Math.max(1, options.max ?? LINK_DEPTH_MAX), budget = Math.max(1, options.budget ?? LINK_DEPTH_BUDGET);
  const result: LinkDepth = { id: enemy.id, depth: 0, path: [], cut: false, expanded: 0 };
  if (world.chainClosed || !canLink(world, enemy)) return result;
  const shadow = shadowOf(world), base = shadow.chain.length;
  let left = budget;

  const visit = (count: number): void => {
    if (count > result.depth) { result.depth = count; result.path = shadow.chain.slice(base); }
    if (result.depth >= max || count >= max) return;
    // «Прямая» never decides whether a link may join (design 12.10.2026, point 12): the search plans without it.
    const plan = planChain(shadow, shadow.chain, NO_PIERCE);
    if (plan.endsOnSurvivor || plan.endsOnObject) return;
    if (left <= 0) { result.cut = true; return; }
    left--;
    result.expanded++;
    // Only a speed-up: a body farther than R from every anchor is refused as `far` by `canLink` anyway.
    const anchors = chainAnchors(shadow), near = (at: { x: number; y: number }, reach: number): boolean => anchors.some(a => dist(a, at) <= reach);
    for (const e of world.enemies) {
      if (!near(e, reachOf(shadow, enemyArtRadius(world.params, e))) || !canLink(shadow, e, plan)) continue;
      shadow.chain.push(nextLink(shadow, { kind: 'enemy', id: e.id }));
      visit(count + 1);
      shadow.chain.pop();
      if (result.depth >= max) return;
    }
    for (const o of world.objects) {
      if (!PASS_KINDS.has(o.kind) || !near(o, reachOf(shadow, OBJECT_RADIUS)) || !canLinkObject(shadow, o, plan)) continue;
      shadow.chain.push(nextLink(shadow, { kind: 'object', id: o.id }));
      visit(count);
      shadow.chain.pop();
      if (result.depth >= max) return;
    }
  };

  shadow.chain.push(nextLink(shadow, { kind: 'enemy', id: enemy.id }));
  visit(1);
  return result;
}

/** The depth of every valid next enemy link of the drawn chain (`nextCandidates`), in the arena's order. */
export function linkDepths(world: World, options: LinkDepthOptions = {}): LinkDepth[] {
  if (world.chainClosed) return [];
  return nextCandidates(world).map(e => linkDepth(world, e, options));
}
