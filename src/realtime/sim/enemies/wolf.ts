/**
 * The wolf (prototype stage 3; stage 3a, step 3 — П1 «окружение», docs/realtime-stage3.md, sections 3 and 10).
 *
 * The wolf of the prototype walks straight at the hero and hits harder next to other wolves (`packmates`, the pack bonus
 * of its touch). Stage 3a gives it the ring (the panel toggle `wolfRing`, on by default and always in a run):
 * - **Approach.** Farther than `wolfRingRadius` + `wolfRingSlack` from the hero, or out of his sight, it walks as everyone
 *   (the common walk, the flow field).
 * - **Ring.** Nearer and in sight, it is in the ring: the wolves of the ring spread around the hero at equal angles (the
 *   slots keep their order around him and turn as little as they can), each walks along the circle to its slot and in to
 *   the radius — never away from the hero (design answer 1г: a hero walking up to a wolf can take it).
 * - **Howl.** `wolfRushPack` (3) wolves in the ring, standing at their slots (within `wolfRingSettle`°) — the whole ring
 *   howls together for `wolfHowl` s (a circle round the hero). The pack's howl breaks when fewer than `wolfRushPack` of it
 *   are left howling: a chain killed one, the cold froze one («разорвать круг цепью до броска»). Wolves that waited
 *   `wolfLoneWait` s in the ring without a pack howl by themselves (a lone howl does not break).
 * - **Rush.** At the end of the howl each wolf fixes the line to the hero and runs `wolfRushRange` along it at
 *   `wolfRushSpeed` (water and thorns do not slow it; a wall, a tree or a cliff edge stops it). Its hit is its touch:
 *   the pack strength as before (the wolves arrive together, so the pack bonus counts them).
 * - **Back.** After the rush it walks straight back out to the ring radius, reaching it within `wolfBack` s (faster than
 *   its walk when it must), then rings again.
 * - **Cliffs** (review 09.10.2026). A wolf with a cliff across its straight way to the hero is not in the ring: it walks
 *   the flow field round the drop. A rush that runs into a cliff edge puts the wolf out of the ring for `wolfBack` s
 *   (at least 0.5 s): it walks as everyone meanwhile.
 * The cold puts a frozen wolf out of the ring and drops its howl or rush (it rings again when it thaws). A knockback (the
 * chain's survivor knockback) runs as for everyone and drops its howl or rush too. No randomness. Angles every tick go
 * through `detMath.ts` (the same bits in the browser and in Node: a journal replays across engines).
 *
 * State in `enemy.vars` (only with the ring on; none without it — the prototype wolf hashes as before): `st` — 0 ring,
 * 1 howl, 2 rush, 3 back; `slot` — its angle on the ring (radians; only while it is in the ring); `wait` — seconds in the
 * ring; `t` — seconds of the howl or the back walk left; `pack` — id of the first wolf of a pack's howl; `dx`, `dy` — the
 * rush line; `ran` — distance run; `away` — seconds out of the ring after a rush into a cliff edge.
 */
import { datan2, dcos, dsin } from '../detMath';
import { blockedAt, cliffAt, dist, hasZone, lineOfSight, pushOutOfObstacles, segmentTouchesArea } from '../geometry';
import { CONTACT_SLACK, enemyFrozen, enemyGroundFactor, enemySpeed, touchDistanceOf, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const WOLF_RING = 0, WOLF_HOWL = 1, WOLF_RUSH = 2, WOLF_BACK = 3;
/** Timers reach zero on the tick they are due (sums of 1/60 s leave a rounding crumb). */
const TIME_EPS = 1e-9;

/** Wolves within the pack radius of `wolf` (not counting itself). */
export function packmates(world: World, wolf: Enemy): number {
  let count = 0;
  const r = world.params.wolfPackRadius;
  for (const e of world.enemies) if (e !== wolf && e.kind === 'wolf' && dist(e, wolf) <= r) count++;
  return count;
}

/** Signed difference a − b brought into (−π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

const stateOf = (e: Enemy): number => e.vars.st ?? WOLF_RING;

/** A wolf in the ring stays in it this much past the joining distance, and without sight of the hero (no flicker). */
const RING_KEEP = 0.5;
/** A rush that ran into a cliff edge: the wolf walks as everyone (around the drop) at least this long before it rings again. */
const CLIFF_AWAY_MIN = 0.5;

/**
 * A cliff lies across the straight way from the wolf to the hero (the segment comes within half its body of a cliff).
 * The ring walks and rushes straight, and a cliff does not cut sight: a wolf on the far side of a gorge would ring, howl
 * and rush into the edge forever (review 09.10.2026). Such a wolf stays out of the ring and walks the flow field round
 * the drop, as without the ring. Walls and trees are left to the sight check; water and thorns are passable.
 */
function cliffBetween(world: World, e: Enemy): boolean {
  const arena = world.arena;
  if (!hasZone(arena, 'cliff')) return false;
  const r = bodyRadiusOf(world.params, e) * 0.5;
  return arena.terrain!.some(z => z.kind === 'cliff' && segmentTouchesArea(e, world.hero, z, r));
}

/**
 * In the ring: ringing (not howling, rushing or walking back), not frozen, not knocked; it joins near the hero (within
 * `wolfRingRadius` + `wolfRingSlack`) and seeing him, and stays while it is within `RING_KEEP` more (a tree or a wall
 * corner crossing its sight for a moment does not throw it out and reshuffle the slots). Never with a cliff across the way
 * to the hero (`cliffBetween`), nor while it walks away from a rush that ran into a cliff (`away`).
 */
function inRing(world: World, e: Enemy): boolean {
  const p = world.params;
  if (stateOf(e) !== WOLF_RING || enemyFrozen(e) || e.knock > 0 || (e.vars.away ?? 0) > 0 || cliffBetween(world, e)) return false;
  const d = dist(e, world.hero), join = p.wolfRingRadius + p.wolfRingSlack;
  if (e.vars.slot !== undefined) return d <= join + RING_KEEP;
  return d <= join && lineOfSight(e, world.hero, world.arena, bodyRadiusOf(p, e) * 0.5);
}

/**
 * Slots of the ring: equal angles in the order the wolves stand around the hero, turned so that the wolves move the
 * least (the circular mean of their angles less their slot offsets).
 */
function assignSlots(world: World, ring: Enemy[]): void {
  const h = world.hero, n = ring.length;
  const placed = ring.map(e => ({ e, a: datan2(e.y - h.y, e.x - h.x) })).sort((u, v) => u.a - v.a || u.e.id - v.e.id);
  let sx = 0, sy = 0;
  placed.forEach(({ a }, i) => { const b = a - 2 * Math.PI * i / n; sx += dcos(b); sy += dsin(b); });
  const base = Math.hypot(sx, sy) > 1e-9 ? datan2(sy, sx) : placed[0].a;
  placed.forEach(({ e }, i) => { e.vars.slot = angleDiff(base + 2 * Math.PI * i / n, 0); });
}

/** The wolf stands at its slot: within `wolfRingSettle` degrees of it (it has spread out around the hero). */
function settled(world: World, e: Enemy): boolean {
  const h = world.hero;
  return Math.abs(angleDiff(e.vars.slot ?? 0, datan2(e.y - h.y, e.x - h.x))) <= world.params.wolfRingSettle * Math.PI / 180 + 1e-9;
}

/** The howl of `wolves` — a pack (`pack` true: it breaks when fewer than `wolfRushPack` of it are left howling) or lone ones. */
function startHowl(world: World, wolves: readonly Enemy[], pack: boolean): void {
  const lead = wolves[0].id;
  for (const e of wolves) {
    e.vars.st = WOLF_HOWL; e.vars.t = world.params.wolfHowl; e.vars.wait = 0; delete e.vars.slot;
    if (pack) e.vars.pack = lead; else delete e.vars.pack;
  }
  world.events.push({ type: 'enemySignal', enemyId: lead, signal: 'howl', x: world.hero.x, y: world.hero.y });
}

/** Back to the ring: no howl, no rush, the wait starts over. */
function backToRing(e: Enemy): void {
  e.vars.st = WOLF_RING; e.vars.wait = 0;
  for (const key of ['t', 'pack', 'dx', 'dy', 'ran']) delete e.vars[key];
}

/**
 * The group step of the wolves (once per tick): the cold and knockbacks drop a howl or a rush; a pack's howl breaks when
 * fewer than `wolfRushPack` of it are left howling (a chain killed one, the cold froze one — «разорвать круг до броска»);
 * then who is in the ring, their slots, and the howl — of the pack once `wolfRushPack` wolves stand at their slots, or of
 * the wolves that waited `wolfLoneWait` in the ring.
 */
function ringStep(world: World, wolves: readonly Enemy[], dt: number): void {
  const p = world.params;
  if (!p.wolfRing) {
    // The prototype wolf: no state of the ring (a toggle switched off mid-fight forgets it).
    for (const e of wolves) if (Object.keys(e.vars).length) e.vars = {};
    return;
  }
  if (world.status !== 'playing') return;
  for (const e of wolves) {
    if ((enemyFrozen(e) || e.knock > 0) && (stateOf(e) === WOLF_HOWL || stateOf(e) === WOLF_RUSH)) backToRing(e);
    if (e.vars.away !== undefined && !enemyFrozen(e)) { e.vars.away -= dt; if (e.vars.away <= TIME_EPS) delete e.vars.away; }
  }
  const howling = new Map<number, Enemy[]>();
  for (const e of wolves) if (stateOf(e) === WOLF_HOWL && e.vars.pack !== undefined) howling.set(e.vars.pack, [...howling.get(e.vars.pack) ?? [], e]);
  for (const group of howling.values()) if (group.length < p.wolfRushPack) for (const e of group) backToRing(e);
  const ring: Enemy[] = [];
  for (const e of wolves) {
    if (inRing(world, e)) ring.push(e);
    else if (stateOf(e) === WOLF_RING) { e.vars.wait = 0; delete e.vars.slot; }
  }
  if (!ring.length) return;
  assignSlots(world, ring);
  for (const e of ring) e.vars.wait = (e.vars.wait ?? 0) + dt;
  if (ring.length >= p.wolfRushPack && ring.filter(e => settled(world, e)).length >= p.wolfRushPack) { startHowl(world, ring, true); return; }
  // No pack at its slots (too few, or a wall keeps one off its slot): the wolves that waited long enough in the ring howl
  // and rush by themselves — together, and as a pack when there are enough of them.
  const ready = ring.filter(e => e.vars.wait >= p.wolfLoneWait - TIME_EPS);
  if (ready.length) startHowl(world, ready, ready.length >= p.wolfRushPack);
}

/** Walks a ringing wolf along the circle to its slot and in to the radius (never out: it does not back away). */
function walkRing(world: World, e: Enemy, dt: number): void {
  const p = world.params, h = world.hero;
  const d = Math.max(1e-6, dist(e, h)), phi = datan2(e.y - h.y, e.x - h.x);
  const rx = dcos(phi), ry = dsin(phi), tangent = angleDiff(e.vars.slot, phi) * d, radial = Math.min(0, p.wolfRingRadius - d);
  let vx = rx * radial - ry * tangent, vy = ry * radial + rx * tangent;
  const len = Math.hypot(vx, vy), max = enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;
  if (len < 1e-9) return;
  if (len > max) { vx *= max / len; vy *= max / len; }
  e.x += vx; e.y += vy;
  pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena);
}

/** The wolf's own step: the ring, the howl, the rush and the walk back; false — the common walk (approach, the knockback). */
function stepWolf(world: World, e: Enemy, dt: number): boolean {
  const p = world.params, h = world.hero;
  if (!p.wolfRing || e.knock > 0) return false;
  const st = stateOf(e);
  if (st === WOLF_HOWL) {
    e.vars.t -= dt;
    if (e.vars.t <= TIME_EPS) {
      const d = dist(e, h);
      e.vars.st = WOLF_RUSH; e.vars.ran = 0;
      e.vars.dx = d > 1e-6 ? (h.x - e.x) / d : 1; e.vars.dy = d > 1e-6 ? (h.y - e.y) / d : 0;
    }
    return true;
  }
  if (st === WOLF_RUSH) {
    const r = bodyRadiusOf(p, e), step = Math.min(p.wolfRushSpeed * dt, Math.max(0, p.wolfRushRange - e.vars.ran));
    const next = { x: e.x + e.vars.dx * step, y: e.y + e.vars.dy * step };
    const end = (): boolean => { e.vars.st = WOLF_BACK; e.vars.t = p.wolfBack; for (const key of ['dx', 'dy', 'ran', 'pack']) delete e.vars[key]; return true; };
    // A wall, a tree or a cliff edge stops the rush (the wolf does not fall). At a cliff edge it also leaves the ring: it
    // walks as everyone (round the drop) for a while instead of walking back out to the ring.
    if (blockedAt(next, r * 0.95, world.arena)) {
      if (!cliffAt(next, r * 0.95, world.arena)) return end();
      backToRing(e); delete e.vars.slot;
      e.vars.away = Math.max(CLIFF_AWAY_MIN, p.wolfBack);
      return true;
    }
    e.x = next.x; e.y = next.y; e.vars.ran += step;
    // It reached the hero: it stops there — its touch hits (the common touch, with the pack bonus).
    if (dist(e, h) <= touchDistanceOf(p, e) + CONTACT_SLACK) return end();
    if (e.vars.ran >= p.wolfRushRange - 1e-6) return end();
    return true;
  }
  if (st === WOLF_BACK) {
    e.vars.t -= dt;
    const d = dist(e, h);
    if (e.vars.t <= TIME_EPS || d >= p.wolfRingRadius) { e.vars.st = WOLF_RING; delete e.vars.t; return true; }
    // Back out to the ring by the end of `wolfBack` (faster than its walk when it must be), never past the ring.
    const step = Math.min(Math.max(enemySpeed(world, e) * enemyGroundFactor(world, e) * dt, (p.wolfRingRadius - d) * dt / Math.max(dt, e.vars.t + dt)), p.wolfRingRadius - d);
    if (d > 1e-6) { e.x -= (h.x - e.x) / d * step; e.y -= (h.y - e.y) / d * step; }
    pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena);
    return true;
  }
  if (e.vars.slot === undefined) return false;
  walkRing(world, e, dt);
  return true;
}

/** The ring the wolves howl at now (render): the hero's circle and how far the howl has gone (0…1); null — no howl. */
export function wolfHowl(world: World): { progress: number } | null {
  if (!world.params.wolfRing) return null;
  let left = Infinity;
  for (const e of world.enemies) if (e.kind === 'wolf' && stateOf(e) === WOLF_HOWL && !enemyFrozen(e)) left = Math.min(left, e.vars.t ?? 0);
  if (left === Infinity) return null;
  const total = Math.max(1e-6, world.params.wolfHowl);
  return { progress: Math.max(0, Math.min(1, 1 - left / total)) };
}

/** The wolf's state (render: the rush trail, the waiting lone wolf). */
export function wolfState(e: Enemy): number { return e.kind === 'wolf' ? stateOf(e) : -1; }

registerBehavior({ id: 'wolf', beforeStep: ringStep, step: stepWolf });

registerEnemyKind({
  id: 'wolf',
  behavior: 'wolf',
  hp: () => null,
  speed: world => world.params.wolfSpeed,
  bodyScale: 1,
  artScale: 1,
  touchDamage: (world, e) => world.params.contactDamage + world.params.wolfPackBonus * packmates(world, e),
  mass: () => 1,
  spread: true,
  chainable: true,
  hitSource: 'wolf',
});
