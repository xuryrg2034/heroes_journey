/**
 * Task 43 «Гарнизон, шаг 2», part Г (design 16.10.2026; the ui's node card, line «Враги:»): who stands in a garrison node's fight at
 * its start — read from the very world the fight would start with, not from a copy of the rules. The node's battle is opened on a
 * copy of the run (the arena by its preview, the node's seed and battle kind, as `rtEnterNode` opens it); the loadout and the values
 * are the fight's own (`rtArenaLoadout`, `rtArenaParams` over `rtRunParams`), the world is the simulation's (`Simulation`: the roster,
 * the kinds taken out, `createWorld` with the deep enemies, the crossbowmen and the knights of the loadout). Task 48: the den branch's
 * boss of a run with `troll` too (the Troll and his parts, the crowd's kinds). Other forest nodes — null: their card keeps its own line
 * (view/nodeCard.ts `nodeDangers`).
 */
import type { ForestMapNode } from '../forest/forestMap';
import { Simulation } from '../sim/simulation';
import { defaultParams } from '../sim/params';
import { rtGarrisonNodeId } from './garrison';
import { arenaPreview, arenaSeed, battleKindOf, rtArenaLoadout, rtArenaParams, rtRunParams, rtTrollNode, type RtRunState } from './rtRun';

/** The enemies of a garrison node's fight at its start (`rtNodeEnemies`). */
export interface RtNodeEnemies {
  /** The arena the node plays (its pick, or the preview of an available node). */
  arena: string;
  /** The enemies standing when the fight starts (after its first tick: the hounds on their leashes), by kind, in the order the world holds them (parts of a boss included). */
  start: { kind: string; count: number }[];
  /** The kinds of the arena's newcomer mix, in its order (basic enemies come besides them on every arena, never listed). */
  newcomers: string[];
  /** The node's loadout additions (the same values the fight gets): knights in start lines, its crossbowmen, its deep enemies. */
  knights: number;
  bolts: boolean;
  deep: boolean;
}

/**
 * The start of the fight of the garrison node `node` (an entered node — its battle as it is; an available one — the battle its entry
 * would open now; task 48: also the Troll's node of the den branch). Null — another forest node, a node without a known arena (not
 * available yet), or a node that is no battle.
 */
export function rtNodeEnemies(run: RtRunState, node: ForestMapNode): RtNodeEnemies | null {
  if (!rtGarrisonNodeId(node.id) && !rtTrollNode(run, node)) return null;
  const pending = run.pending;
  const open = pending?.kind === 'battle' && pending.nodeId === node.id ? pending : null;
  const pick = open ? { arena: open.arena, roster: open.roster } : arenaPreview(run, node);
  if (!pick) return null;
  const battle = open ?? { kind: 'battle' as const, nodeId: node.id, arena: pick.arena, seed: arenaSeed(run, node.id), battle: battleKindOf(node), ...pick.roster !== undefined ? { roster: pick.roster } : {} };
  const state: RtRunState = { ...run, pending: battle };
  const loadout = rtArenaLoadout(state);
  const sim = new Simulation({ arena: battle.arena, ...battle.roster !== undefined ? { roster: battle.roster } : {}, params: rtArenaParams(state, rtRunParams(defaultParams())), seed: battle.seed, loadout, hero: { hp: run.hp, maxHp: run.maxHp } });
  // The first tick: a dog handler's hounds take their leashes then (enemies/garrison.ts); the newcomers are still markers.
  sim.tick();
  const start: { kind: string; count: number }[] = [];
  for (const e of sim.world.enemies) {
    const entry = start.find(item => item.kind === e.kind);
    if (entry) entry.count++; else start.push({ kind: e.kind, count: 1 });
  }
  return {
    arena: battle.arena, start, newcomers: [...new Set((sim.world.arena.newcomers ?? []).filter(entry => entry.share > 0).map(entry => entry.kind))],
    knights: loadout.knights ?? 0, bolts: loadout.bolts === true, deep: loadout.deep === true,
  };
}
