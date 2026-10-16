/**
 * Loop research, step 2 (docs/realtime-loop-research.md, sections 2.3 and 3.1–3.4; user decisions 11.10.2026): the seal of a
 * closed chain («Печать») — the ring, who is inside it, the hit and the hold. The gesture itself lives in chain.ts (it needs
 * the chain's reach and pick); this module is the geometry and the strike.
 *
 * - The ring: the points of the chain's links in order (crystals, braziers and loot are corners too); closed on the hero, he is
 *   its first corner. Who is inside: enemies whose centre is inside the ring by the even-odd rule (`insidePolygon`), not its
 *   own links, never the reaper (`immune`). The body's radius is not counted — the highlight and the hit agree.
 * - The set is fixed at the release (`SealMove`), struck at the end of the dash on those still on the arena: the hit
 *   ⌊(n − 2) ÷ 2⌋, at least 1 (n — enemy links of the ring), credited, source `seal` (as a hammer: kill counter, kill goal,
 *   an elite's loot, a sapper blows up as the player's; not a chain kill — no combo, crystal or chain score), then the hold:
 *   the cold (`chill`) without the ×2 brittleness.
 * - Deterministic: comparisons and `+ − × ÷` only (the crossing test is the sign of cross products).
 */
import { kindOf } from './enemies/kinds';
import { talismanFired } from './build';
import { FUSIONS } from './buildIds';
import { insidePolygon, type Vec } from './geometry';
import type { Params } from './params';
import { damageEnemy, type ChainLink, type Enemy, type LoopKind, type SealMove, type World } from './world';

/** The source of the seal's hit (kill events, telemetry `kills.tools.seal`). */
export const SEAL_SOURCE = 'seal';
/** Hit-stop of the seal's strike (game seconds, as a chain kill's; only with the `hitstop` toggle). */
export const SEAL_HITSTOP = 0.04;

/** The seal's hit for a ring of `n` enemy links: ⌊(n − 2) ÷ 2⌋, at least 1 (4 → 1, 6 → 2, 8 → 3). */
export function sealDamage(n: number): number { return Math.max(1, Math.floor((n - 2) / 2)); }

/** Game seconds a survivor of the seal is held: `sealHold`, `sealHoldLong` from `sealLongLinks` enemy links. */
export function sealHoldOf(params: Params, n: number): number {
  return Math.max(0, n >= params.sealLongLinks ? params.sealHoldLong : params.sealHold);
}

/** Enemy links the loop needs to close (`kind`). */
export function loopMinOf(params: Params, kind: LoopKind): number {
  return Math.max(1, Math.floor(kind === 'hero' ? params.loopHeroMinLinks : params.loopMinLinks));
}

const cross = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Segments a–b and c–d cross at a single inner point (touching ends and collinear overlaps do not count). */
export function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The closing edge (last corner → first corner) crosses an edge of the ring other than its two neighbours. */
export function closingEdgeCrosses(ring: readonly Vec[]): boolean {
  const k = ring.length;
  if (k < 4) return false;
  const a = ring[k - 1], b = ring[0];
  for (let i = 1; i + 1 < k - 1; i++) if (segmentsCross(a, b, ring[i], ring[i + 1])) return true;
  return false;
}

/** Enemies whose centre is inside the ring: not its links, not the reaper; arena order. */
export function enemiesInside(world: World, ring: readonly Vec[], links: readonly ChainLink[]): Enemy[] {
  if (ring.length < 3) return [];
  const own = new Set(links.filter(l => l.kind === 'enemy').map(l => l.id));
  return world.enemies.filter(e => !own.has(e.id) && !kindOf(e).immune && insidePolygon(ring, e));
}

/** The seal's strike at the end of the dash: the hit on those still on the arena, then the hold on the survivors. */
export function strikeSeal(world: World, seal: SealMove): void {
  const struck: number[] = [];
  let froze = false;
  for (const id of seal.inside) {
    if (world.status !== 'playing') return;
    const e = world.enemies.find(x => x.id === id);
    if (!e) continue;
    struck.push(id);
    damageEnemy(world, e, seal.damage, { source: SEAL_SOURCE, credited: true });
    // The hold is the cold without the ×2: a frost-brittle enemy held longer than its cold loses the brittleness (the
    // hold would otherwise stretch it).
    if (seal.ice && seal.brittle && seal.hold > 0 && world.enemies.includes(e)) {
      // Task 44 «Ледяная печать»: the cold of the consumable — the longer of its own and the seal's, brittle.
      e.chill = Math.max(e.chill ?? 0, seal.hold); e.brittle = true; froze = true;
    } else if (seal.hold > 0 && world.enemies.includes(e) && seal.hold > (e.chill ?? 0)) { e.chill = seal.hold; delete e.brittle; froze = true; }
  }
  if (seal.ice && froze) talismanFired(world, FUSIONS.iceSeal);
  world.events.push({ type: 'seal', phase: 'strike', kind: seal.kind, points: seal.ring.map(p => ({ x: p.x, y: p.y })), inside: struck, links: seal.links });
  if (struck.length && world.params.hitstop) world.hitstop = Math.max(world.hitstop, SEAL_HITSTOP);
}
