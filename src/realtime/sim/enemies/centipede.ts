/**
 * Task 57б «Лес: механики», «Сороконожка» (`centipede`; design 17.10.2026, docs/design-notes/task-57-forest-enemies.md, 6.3). A diver:
 * a body of parts of one colour — a ready chain; start it from an end, the middle cuts it in two.
 *
 * **Body.** `centiParts` (5) enemies of the kind `centipede`, one colour: the head HP 1 and the parts HP 0; each a normal body (×0.9),
 * touch 1, a link of its colour; never an elite. The head comes as any newcomer (a marker, a template, a roster; `capped`: at most
 * `CENTI_START_MAX` heads on the arena, at markers and in the queue); its parts appear with it (`onSpawn`: new ids, no spawn event, not
 * counted as spawned), `CENTI_STEP` apart on the line from the hero through the head. A part knows the one ahead (`vars.ca`); the head
 * has none. **The trail** (`centiTrail`, design 22.10.2026): the body's trail (`world.centiTrails`, its id the head's; `vars.tb` on each
 * member) is the head's path — a point every `TRAIL_SPACING` with its odometer, the head's live place its front. A part stands on it at its
 * odometer (`vars.co`) and keeps `CENTI_STEP` (0.8) of trail to the one ahead: it walks the trail at the walk's speed while the trail gap is
 * at most `CENTI_CATCH_GAP` (1.2), at up to `CENTI_CATCH_SPEED` (8 u/s) beyond — never straight through a wall. At a division the new head
 * takes the old trail behind it as its own (its tail walks on). **The rope** (no key — the journals before): a part keeps 0.8 to the one
 * ahead straight, as fast as above; walls slide it. The crowd never moves the body and its parts never push each other (`crowd`
 * `anchored`); the body pushes the crowd. Head class `normal`.
 *
 * **«Рывок».** The head walks to the hero. Its pause over (`CENTI_FIRST_LUNGE` 2 s after it appeared, `CENTI_PAUSE` 3 s after a lunge),
 * the hero within `CENTI_TRIGGER` (4) and in sight — it winds up `centiLungeWindup` s (1.0) on a lane fixed at the windup's start:
 * `CENTI_LANE_LEN` × `CENTI_LANE_WIDTH` (3.0 × 0.6) from the head toward the hero (the boar's sign, `centipedeLane` in `boarLane`'s
 * shape). Then it runs the lane at `CENTI_RUN` (8 u/s), the parts after it; the head's body reaching the hero (the lane's half width +
 * his body) hurts him `CENTI_LUNGE_DAMAGE` (1, source `centipede-lunge`) and ends the run (a shield blocks it; during the hero's move the
 * run passes him by). A wall ends it. The running head's touch is its run (`touches`).
 *
 * **Division.** A killed part (by anything) leaves a break: the part behind it closes on the part ahead of the break and waits (`vars.cx`
 * — the killed part nearest to it, `bx`/`by` — its place). The breaks settle once no hero's move runs, at the end of the world's step
 * (world.ts `update`: after the dash's end, its seal and blast, the fire hammer's first burn — the highlight's whole pass):
 * - a break with a living part ahead — **division**: the piece behind gets a new head, the part nearest the break (it keeps its id; HP
 *   `max(HP, 1)`, stunned `CENTI_STUN` s: no walk, no lunge; its first lunge `CENTI_FIRST_LUNGE` s later) — event `centipede` `split`;
 *   past `CENTI_BODIES_MAX` heads on the arena (in id order) it does not split: the piece closes up to the part ahead (`join`);
 * - none ahead (the head died) — the part nearest it is the new head the same way (event `head`; no cap: the body count stays).
 * A chain from end to end kills the whole body: no break. The highlight (chain.ts `ChainPlan.splits`) resolves the pass's kills by the same
 * function (`resolveBreaks`): highlight = the pass.
 *
 * State in `enemy.vars`: `ca` — the part ahead; `cx`, `bx`, `by` — a break waiting; `cs` — stun left (game s); `cg` — game s a part has been
 * farther than `CENTI_CATCH_GAP` behind (stuck past `CENTI_STUCK`); `cn` 1 — a head that came while a move ran or a break waited
 * (the cap does not count it until the settle); `tb` — the trail it walks, `co` — a part's odometer on it; `cm` 1 — the run passed
 * the hero during his move. The head's lunge in the boar's fields: `boar` `walk` / `windup` / `charge`, `boarTimer` (the pause, the
 * windup), `dirX`/`dirY` (the lane), `charged` (run so far).
 */
import { dhypot } from '../detMath';
import { blockedAt, dist, hasZone, lineOfSight, pushOutOfCliffs, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { canBeHurt, enemyGroundFactor, enemySpeed, hurtHero, noteBlock, type Enemy, type World } from '../world';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';

export const CENTIPEDE = 'centipede';
/** The hit source of «Рывок» (the hit event, «кто убил», the telemetry's threat `centipede-lunge`). */
export const CENTI_LUNGE_SOURCE = 'centipede-lunge';
// ---- Баланс (гипотезы спеки задачи 57, 17.10.2026; journals without the keys play these) ----
export const CENTI_PARTS = 5;
export const CENTI_LUNGE_WINDUP = 1;
/** The head's HP; a promoted part gets at least this. */
export const CENTI_HEAD_HP = 1;
/** The gap a part keeps to the one ahead (less than the link radius R: the body is a ready chain). */
export const CENTI_STEP = 0.8;
/** A part farther than this behind the one ahead catches up at `CENTI_CATCH_SPEED`. */
export const CENTI_CATCH_GAP = 1.2;
export const CENTI_CATCH_SPEED = 8;
/** «Рывок»: the hero this close and in sight; the lane; its run's speed; its damage. */
export const CENTI_TRIGGER = 4;
export const CENTI_LANE_LEN = 3;
export const CENTI_LANE_WIDTH = 0.6;
export const CENTI_RUN = 8;
export const CENTI_LUNGE_DAMAGE = 1;
/** Game seconds: the first lunge after the head appeared (or a part became one), the pause after a lunge, a new head's stun. */
export const CENTI_FIRST_LUNGE = 2;
export const CENTI_PAUSE = 3;
export const CENTI_STUN = 1;
/** Heads on the arena at the start of their coming (`capped`), and at most after divisions. */
export const CENTI_START_MAX = 2;
export const CENTI_BODIES_MAX = 4;
/** A part farther than `CENTI_CATCH_GAP` behind the one ahead this long (game s) is stuck (the measure, `centipedeStuck`). */
export const CENTI_STUCK = 2;
const BODY_SCALE = 0.9;
const TIME_EPS = 1e-9;
/** The trail: a point every this much of the head's way; at most this many points a body. */
export const TRAIL_SPACING = 0.2;
const TRAIL_MAX_POINTS = 64;

/**
 * A body's stored trail (`centiTrail`): `id` — its head's (when it was made); `pts` — x, y, odometer of each point, the oldest first. The
 * head's place is its front (its odometer — the newest point's + the distance to it).
 */
export interface CentiTrail { id: number; pts: number[] }

const trailOn = (world: World): boolean => world.params.centiTrail === true;
const trailOf = (world: World, id: number | undefined): CentiTrail | undefined => (id === undefined ? undefined : world.centiTrails?.find(t => t.id === id));

/** The trail's front: its head's place (alive and still its head), else its newest point. */
function trailFront(world: World, t: CentiTrail): Vec {
  const head = findSegment(world, t.id), n = t.pts.length;
  return head && head.vars.ca === undefined && head.vars.cx === undefined ? head : { x: t.pts[n - 3], y: t.pts[n - 2] };
}

/** The odometer of the trail's front. */
function frontOdo(world: World, t: CentiTrail): number {
  const n = t.pts.length, f = trailFront(world, t);
  return t.pts[n - 1] + dhypot(f.x - t.pts[n - 3], f.y - t.pts[n - 2]);
}

/** The place at odometer `o` on the trail (before its oldest point — that point; past the front — the front). */
function trailPoint(world: World, t: CentiTrail, o: number): Vec {
  const p = t.pts, n = p.length;
  if (o >= p[n - 1]) {
    const f = trailFront(world, t), len = dhypot(f.x - p[n - 3], f.y - p[n - 2]), k = len > 1e-9 ? Math.min(1, (o - p[n - 1]) / len) : 1;
    return { x: p[n - 3] + (f.x - p[n - 3]) * k, y: p[n - 2] + (f.y - p[n - 2]) * k };
  }
  if (o <= p[2]) return { x: p[0], y: p[1] };
  for (let i = n / 3 - 2; i >= 0; i--) {
    const a = i * 3, oa = p[a + 2];
    if (oa > o) continue;
    const ob = p[a + 5], k = ob - oa > 1e-9 ? (o - oa) / (ob - oa) : 1;
    return { x: p[a] + (p[a + 3] - p[a]) * k, y: p[a + 1] + (p[a + 4] - p[a + 1]) * k };
  }
  return { x: p[0], y: p[1] };
}

/** The odometer of `e` on its trail: the trail's head — the front; a part — its own. */
const odoOf = (world: World, t: CentiTrail, e: Enemy): number => (e.id === t.id ? frontOdo(world, t) : e.vars.co ?? 0);

/** The trails' step, once a tick before anyone moves: each head adds its point; the points no member needs go; a trail with no member goes. */
function beforeTrails(world: World, members: readonly Enemy[]): void {
  if (!world.centiTrails) return;
  for (const t of world.centiTrails) {
    const head = members.find(e => e.id === t.id && e.vars.ca === undefined && e.vars.cx === undefined), n = t.pts.length;
    if (head) {
      const d = dhypot(head.x - t.pts[n - 3], head.y - t.pts[n - 2]);
      if (d >= TRAIL_SPACING - 1e-9) t.pts.push(head.x, head.y, t.pts[n - 1] + d);
    }
    let lo = Infinity;
    for (const e of members) if (e.vars.tb === t.id && e.id !== t.id) lo = Math.min(lo, e.vars.co ?? 0);
    // Keep one point at or behind the hindmost part; never more than `TRAIL_MAX_POINTS`.
    let drop = 0;
    while (drop + 6 <= t.pts.length - 3 && t.pts[drop + 5] <= lo) drop += 3;
    drop = Math.max(drop, t.pts.length - TRAIL_MAX_POINTS * 3);
    if (drop > 0) t.pts.splice(0, drop);
  }
  const kept = world.centiTrails.filter(t => members.some(e => e.vars.tb === t.id));
  if (kept.length) world.centiTrails = kept; else delete world.centiTrails;
}

const partsOf = (world: World): number => Math.max(1, Math.round(world.params.centiParts ?? CENTI_PARTS));
const windupOf = (world: World): number => Math.max(0, world.params.centiLungeWindup ?? CENTI_LUNGE_WINDUP);

/** A head of a body: no part ahead, no break waiting. */
export const centipedeHead = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === CENTIPEDE && e.vars.ca === undefined && e.vars.cx === undefined;

/** The head is stunned now (a new head: no walk, no lunge). */
export const centipedeStunned = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === CENTIPEDE && (e.vars.cs ?? 0) > TIME_EPS;

const findSegment = (world: World, id: number): Enemy | undefined => world.enemies.find(e => e.id === id && e.kind === CENTIPEDE);

/** The front of `e`'s body: up the parts ahead (`vars.ca`) to the one with none. */
function bodyFront(world: World, e: Enemy): number {
  let at = e, guard = world.enemies.length;
  for (let next = at.vars.ca !== undefined ? findSegment(world, at.vars.ca) : undefined; next && guard-- > 0; next = at.vars.ca !== undefined ? findSegment(world, at.vars.ca) : undefined) at = next;
  return at.id;
}

/**
 * The body of `headId` (the view): its parts' ids from the head to the tail, by the parts' links ahead (`vars.ca`). A part waiting on a
 * break ahead counts with the piece it closed on until the break settles. Empty — no such head.
 */
export function centipedeBody(world: World, headId: number): number[] {
  const head = findSegment(world, headId);
  if (!head || head.vars.ca !== undefined) return [];
  const behind = new Map<number, Enemy>();
  for (const e of world.enemies) if (e.kind === CENTIPEDE && e.vars.ca !== undefined && !behind.has(e.vars.ca)) behind.set(e.vars.ca, e);
  const out = [head.id];
  for (let e = behind.get(head.id); e && out.length <= world.enemies.length; e = behind.get(e.id)) out.push(e.id);
  return out;
}

/** The bodies now (the view): each head's id and its parts in order (`centipedeBody`), by the head's id. */
export function centipedeBodies(world: World): { head: number; parts: number[] }[] {
  return world.enemies.filter(e => e.kind === CENTIPEDE && e.vars.ca === undefined && e.vars.cx === undefined).sort((a, b) => a.id - b.id).map(e => ({ head: e.id, parts: centipedeBody(world, e.id) }));
}

/**
 * The lane of a head winding up or running «Рывок» (the view; the shape of the boar's `boarLane`): direction, length left, how far the
 * windup has gone (0…1), running or not; `second` always false. Null — it walks, is stunned, or is no head.
 */
export function centipedeLane(world: World, e: Enemy): { dx: number; dy: number; len: number; progress: number; charging: boolean; second: boolean } | null {
  if (e.kind !== CENTIPEDE || (e.boar !== 'windup' && e.boar !== 'charge')) return null;
  if (e.boar === 'charge') return { dx: e.dirX, dy: e.dirY, len: Math.max(0, CENTI_LANE_LEN - e.charged), progress: 1, charging: true, second: false };
  const total = windupOf(world);
  return { dx: e.dirX, dy: e.dirY, len: CENTI_LANE_LEN, progress: total > 0 ? Math.max(0, Math.min(1, 1 - Math.max(0, e.boarTimer) / total)) : 1, charging: false, second: false };
}

/**
 * The parts stuck now (the measure of the rope; design 22.10.2026, checked on «Бурелом»): farther than `CENTI_CATCH_GAP` from the part
 * ahead for at least `CENTI_STUCK` game seconds (`vars.cg`). Read only.
 */
export function centipedeStuck(world: World): number[] {
  return world.enemies.filter(e => e.kind === CENTIPEDE && (e.vars.cg ?? 0) >= CENTI_STUCK - TIME_EPS).map(e => e.id);
}

/** One break of a pass (`resolveBreaks`): the part that becomes a head or closes up, the killed part nearest it and its place. */
interface Break { id: number; ahead: number | undefined; cut: number; x: number; y: number }

/** A division or a new head of the highlight and of the settle: the new head, the head of the piece ahead (absent — none), the break. */
export interface CentipedeSplit { newHead: number; front?: number; cut: number; x: number; y: number }

/**
 * The breaks after the pass that kills `killed` (the highlight: the pass's kills; the settle: none — the dead are gone, their followers
 * closed on the parts ahead and keep the break): which parts become heads (`promote`, in id order: the pieces without a head first,
 * then the divisions while the heads stay within `CENTI_BODIES_MAX`) and which close up (`join`). Pure.
 */
function resolveBreaks(world: World, killed: ReadonlySet<number>): { promote: CentipedeSplit[]; join: { id: number; ahead: number }[] } {
  const segments = world.enemies.filter(e => e.kind === CENTIPEDE).sort((a, b) => a.id - b.id);
  const byId = new Map(segments.map(e => [e.id, e] as const));
  const alive = (id: number): boolean => byId.has(id) && !killed.has(id);
  let heads = 0;
  const breaks: Break[] = [];
  for (const e of segments) {
    if (killed.has(e.id)) continue;
    let ahead: number | undefined = e.vars.ca, cut: number | undefined = e.vars.cx, x = e.vars.bx ?? e.x, y = e.vars.by ?? e.y;
    // Past the killed parts ahead (the highlight's pass): the nearest one is the break's place.
    while (ahead !== undefined && !alive(ahead)) {
      const dead = byId.get(ahead);
      if (cut === undefined) { cut = ahead; x = dead?.x ?? e.x; y = dead?.y ?? e.y; }
      ahead = dead?.vars.ca;
    }
    // A head that came while a move ran or a break waited (`vars.cn`) is not counted: the highlight could not see it (design review).
    if (cut === undefined) { if (ahead === undefined && e.vars.cn === undefined) heads++; continue; }
    breaks.push({ id: e.id, ahead, cut, x, y });
  }
  const promote: CentipedeSplit[] = [], join: { id: number; ahead: number }[] = [];
  const aheadAfter = new Map<number, number | undefined>();
  for (const e of segments) if (alive(e.id)) {
    let a: number | undefined = e.vars.ca;
    while (a !== undefined && !alive(a)) a = byId.get(a)?.vars.ca;
    aheadAfter.set(e.id, a);
  }
  // The pieces whose head died: the part nearest the break leads them (the body count stays).
  for (const b of breaks) if (b.ahead === undefined) { promote.push({ newHead: b.id, cut: b.cut, x: b.x, y: b.y }); heads++; }
  for (const b of breaks) {
    if (b.ahead === undefined) continue;
    if (heads < CENTI_BODIES_MAX) { promote.push({ newHead: b.id, cut: b.cut, x: b.x, y: b.y }); aheadAfter.set(b.id, undefined); heads++; }
    else join.push({ id: b.id, ahead: b.ahead });
  }
  // The head of the piece ahead of each division (after every promotion of this pass).
  for (const s of promote) {
    const b = breaks.find(x => x.id === s.newHead)!;
    let a = b.ahead, guard = segments.length;
    while (a !== undefined && aheadAfter.get(a) !== undefined && guard-- > 0) a = aheadAfter.get(a);
    if (a !== undefined) s.front = a;
  }
  return { promote, join };
}

/** The highlight (chain.ts `planChain`): the divisions and new heads after the pass that kills `killed`. Pure. */
export function planSplits(world: World, killed: ReadonlySet<number>): CentipedeSplit[] {
  return resolveBreaks(world, killed).promote;
}

/** Any break waiting on the arena (a part whose part ahead died, or is gone). */
export function breaksWaiting(world: World): boolean {
  for (const e of world.enemies) {
    if (e.kind !== CENTIPEDE) continue;
    if (e.vars.cx !== undefined) return true;
    if (e.vars.ca !== undefined && !findSegment(world, e.vars.ca)) return true;
  }
  return false;
}

/**
 * The breaks settle (world.ts `update`, at the end of the world's step, no hero's move running): divisions, new heads, closed pieces —
 * the highlight's `resolveBreaks` on the world as it is.
 */
export function settleCentipedes(world: World): void {
  if (world.status !== 'playing' || world.move) return;
  if (breaksWaiting(world)) settleBreaks(world);
  // The heads that came during the pass count from now on.
  for (const e of world.enemies) if (e.kind === CENTIPEDE && e.vars.cn !== undefined) delete e.vars.cn;
  // The trails of bodies all gone (the group step runs only with members).
  if (world.centiTrails && !world.enemies.some(e => e.kind === CENTIPEDE)) delete world.centiTrails;
}

function settleBreaks(world: World): void {
  const { promote, join } = resolveBreaks(world, new Set());
  // The trail (`centiTrail`): each new head takes the old trail behind it as its own, made before any member moves to it.
  const made = promote.flatMap(s => { const e = findSegment(world, s.newHead)!, t = trailOf(world, e.vars.tb); return t ? [{ head: e, t: takeTrail(world, t, e) }] : []; });
  for (const s of promote) {
    const e = findSegment(world, s.newHead)!, v = e.vars;
    delete v.ca; delete v.cx; delete v.bx; delete v.by; delete v.cm; delete v.cg;
    e.hp = Math.max(e.hp, CENTI_HEAD_HP);
    v.cs = CENTI_STUN;
    e.boar = 'walk'; e.boarTimer = CENTI_FIRST_LUNGE; e.charged = 0;
    world.events.push({ type: 'centipede', action: s.front !== undefined ? 'split' : 'head', id: e.id, ...s.front !== undefined ? { front: s.front } : {}, cut: s.cut, x: s.x, y: s.y, stun: CENTI_STUN });
  }
  for (const j of join) {
    const e = findSegment(world, j.id)!, v = e.vars;
    v.ca = j.ahead; delete v.cx; delete v.bx; delete v.by;
    world.events.push({ type: 'centipede', action: 'join', id: e.id, front: j.ahead, x: e.x, y: e.y });
  }
  if (!made.length) return;
  const behind = new Map<number, Enemy>();
  for (const e of world.enemies) if (e.kind === CENTIPEDE && e.vars.ca !== undefined) behind.set(e.vars.ca, e);
  for (const { head, t } of made) {
    world.centiTrails!.push(t);
    head.vars.tb = t.id; delete head.vars.co;
    for (let e = behind.get(head.id); e; e = behind.get(e.id)) e.vars.tb = t.id;
  }
  world.centiTrails!.sort((a, b) => a.id - b.id);
}

/** A new head's own trail: the old trail's points behind it and its place (its odometer kept — its tail's stay true). */
function takeTrail(world: World, t: CentiTrail, e: Enemy): CentiTrail {
  const o = e.vars.co ?? 0, pts: number[] = [];
  for (let i = 0; i < t.pts.length; i += 3) if (t.pts[i + 2] < o - 1e-9) pts.push(t.pts[i], t.pts[i + 1], t.pts[i + 2]);
  const at = trailPoint(world, t, o);
  pts.push(at.x, at.y, o);
  return { id: e.id, pts };
}

/** A part died: the part behind it closes on the part ahead (none — the head died) and keeps the break until it settles. */
function partDied(world: World, dead: Enemy): void {
  for (const e of world.enemies) {
    if (e.kind !== CENTIPEDE || e.vars.ca !== dead.id) continue;
    const v = e.vars;
    if (dead.vars.ca !== undefined) v.ca = dead.vars.ca; else delete v.ca;
    if (v.cx === undefined) { v.cx = dead.id; v.bx = dead.x; v.by = dead.y; }
  }
}

/** The head's lunge ended (its run, a wall, the hero reached): the pause starts. */
function endLunge(world: World, e: Enemy, met?: 'hit' | 'block'): void {
  const passed = e.vars.cm === 1;
  delete e.vars.cm;
  e.boar = 'walk'; e.boarTimer = CENTI_PAUSE; e.charged = 0;
  world.events.push({ type: 'centipede', action: 'lunge', stage: 'end', id: e.id, x: e.x, y: e.y, ...met ? { met } : passed ? { met: 'pass' as const } : {} });
}

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dhypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}

function stepHead(world: World, e: Enemy, dt: number): boolean {
  const { hero, params, arena } = world, v = e.vars;
  if (v.cs !== undefined) {
    v.cs -= dt;
    if (v.cs > TIME_EPS) { e.boarTimer = Math.max(0, e.boarTimer - dt); return true; }
    delete v.cs;
  }
  if (e.boar === 'walk' || e.boar === 'rest') {
    e.boarTimer = Math.max(0, e.boarTimer - dt);
    const d = dist(e, hero);
    if (e.boarTimer > 0 || d > CENTI_TRIGGER || d < 1e-6 || world.status !== 'playing') return false;
    if (!lineOfSight(e, hero, arena, bodyRadiusOf(params, e) * 0.5)) return false;
    e.boar = 'windup'; e.boarTimer = windupOf(world);
    e.dirX = (hero.x - e.x) / d; e.dirY = (hero.y - e.y) / d;
    world.events.push({ type: 'centipede', action: 'lunge', stage: 'start', id: e.id, x: e.x, y: e.y, dx: e.dirX, dy: e.dirY });
    return true;
  }
  if (e.boar === 'windup') {
    e.boarTimer -= dt;
    if (e.boarTimer <= 0) { e.boar = 'charge'; e.charged = 0; }
    return true;
  }
  // The run: straight along the lane; walls and trees end it. The head's body reaching the hero hurts him once and ends it.
  const step = Math.min(CENTI_RUN * dt, Math.max(0, CENTI_LANE_LEN - e.charged));
  const from = { x: e.x, y: e.y }, next = { x: e.x + e.dirX * step, y: e.y + e.dirY * step };
  if (blockedAt(next, bodyRadiusOf(params, e) * 0.95, arena)) { endLunge(world, e); return true; }
  e.x = next.x; e.y = next.y; e.charged += step;
  if (segmentDistance(from, next, hero) <= CENTI_LANE_WIDTH / 2 + heroRadius(params)) {
    // During the hero's dash or jump the run passes him by.
    if (world.move) v.cm = 1;
    else if (canBeHurt(world)) { hurtHero(world, e, CENTI_LUNGE_DAMAGE, CENTI_LUNGE_SOURCE); e.strikeFlash = 0.18; endLunge(world, e, 'hit'); return true; }
    else { noteBlock(world, e.x, e.y, CENTI_LUNGE_SOURCE, e.id); endLunge(world, e, 'block'); return true; }
  }
  if (e.charged >= CENTI_LANE_LEN - 1e-6) endLunge(world, e);
  return true;
}

/** Stuck (the measure, design 22.10.2026): game seconds a part has been farther than `CENTI_CATCH_GAP` from the one ahead; past `CENTI_STUCK` once — event `centipede` `stuck`. */
function noteStuck(world: World, e: Enemy, d: number, dt: number): void {
  const v = e.vars;
  if (d > CENTI_CATCH_GAP + 1e-9) {
    const was = v.cg ?? 0;
    v.cg = was + dt;
    if (was < CENTI_STUCK - TIME_EPS && v.cg >= CENTI_STUCK - TIME_EPS) world.events.push({ type: 'centipede', action: 'stuck', id: e.id, x: e.x, y: e.y });
  } else delete v.cg;
}

/** A part walks its body's trail «след в след», keeping `CENTI_STEP` of it to the one ahead (`centiTrail`). */
function stepOnTrail(world: World, e: Enemy, ahead: Enemy, t: CentiTrail, dt: number): boolean {
  const v = e.vars, oa = odoOf(world, t, ahead), co = v.co ?? 0, target = oa - CENTI_STEP;
  if (co < target - 1e-9) {
    const speed = oa - co > CENTI_CATCH_GAP + 1e-9 ? CENTI_CATCH_SPEED : enemySpeed(world, e) * enemyGroundFactor(world, e);
    v.co = Math.min(target, co + speed * dt);
  }
  const at = trailPoint(world, t, v.co ?? 0);
  e.x = at.x; e.y = at.y;
  noteStuck(world, e, dist(e, ahead), dt);
  return true;
}

/** A part: on its trail (`centiTrail`), else toward the part ahead (the rope), keeping `CENTI_STEP`; a part waiting on a break stands. */
function stepPart(world: World, e: Enemy, dt: number): boolean {
  const v = e.vars;
  if (v.cx !== undefined) { delete v.cg; return true; }
  const ahead = v.ca !== undefined ? findSegment(world, v.ca) : undefined;
  if (!ahead) { delete v.cg; return true; }
  const t = trailOn(world) ? trailOf(world, v.tb) : undefined;
  if (t) return stepOnTrail(world, e, ahead, t, dt);
  const d = dist(e, ahead);
  noteStuck(world, e, d, dt);
  if (d <= CENTI_STEP + 1e-9) return true;
  const speed = d > CENTI_CATCH_GAP ? CENTI_CATCH_SPEED : enemySpeed(world, e) * enemyGroundFactor(world, e);
  const step = Math.min(speed * dt, d - CENTI_STEP);
  e.x += (ahead.x - e.x) / d * step; e.y += (ahead.y - e.y) / d * step;
  const r = bodyRadiusOf(world.params, e);
  pushOutOfObstacles(e, r, world.arena);
  if (hasZone(world.arena, 'cliff')) pushOutOfCliffs(e, r, world.arena);
  return true;
}

/** The turns `layParts` tries, as (cos, sin): 0°, ±45°, ±90°, ±135°, 180°. */
const H = Math.SQRT1_2;
const LAY_TURNS: readonly (readonly [number, number])[] = [[1, 0], [H, H], [H, -H], [0, 1], [0, -1], [-H, H], [-H, -H], [-1, 0]];

/**
 * Its parts appear with the head: `centiParts` − 1 of them, `CENTI_STEP` apart, each from the part ahead on the line from the hero through
 * the head — where that way is clear (no wall, tree, cliff or edge on it or at the spot); else turned toward the free side; none — on the
 * part ahead (design review 22.10.2026: no part across a wall).
 */
function layParts(world: World, head: Enemy): void {
  const n = partsOf(world) - 1;
  head.boar = 'walk'; head.boarTimer = CENTI_FIRST_LUNGE;
  if (n <= 0) return;
  const dx = head.x - world.hero.x, dy = head.y - world.hero.y, d = dhypot(dx, dy);
  let ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0;
  const r = bodyRadiusOf(world.params, head);
  // It came while a move ran or a break waited: the cap does not count it until the breaks settle (`resolveBreaks`).
  if (world.move || breaksWaiting(world)) head.vars.cn = 1;
  let ahead = head;
  for (let i = 1; i <= n; i++) {
    // The first clear way from the part ahead: straight on, then turned 45°, 90°, 135° to either side, then back; none — on it.
    let at: Vec = { x: ahead.x, y: ahead.y };
    for (const [c, s] of LAY_TURNS) {
      const vx = ux * c - uy * s, vy = ux * s + uy * c, p = { x: ahead.x + vx * CENTI_STEP, y: ahead.y + vy * CENTI_STEP };
      if (blockedAt(p, r, world.arena) || !lineOfSight(ahead, p, world.arena, r)) continue;
      at = p; ux = vx; uy = vy;
      break;
    }
    const e: Enemy = {
      id: world.nextId++, kind: CENTIPEDE, x: at.x, y: at.y, color: head.color, hp: 0, marked: false,
      speedFactor: head.speedFactor, brake: 0, age: 0, strikeFlash: 0, hurtFlash: 0, knock: 0, knockVx: 0, knockVy: 0,
      boar: 'walk', boarTimer: 0, dirX: 0, dirY: 0, charged: 0, headX: 0, headY: 0, vars: { ca: ahead.id },
    };
    pushOutOfObstacles(e, r, world.arena);
    world.enemies.push(e);
    ahead = e;
  }
  // Design 22.10.2026: «Врагов пришло» counts the parts (5 credited kills a body: kills / spawned stays true); one `spawn` event a body.
  world.stats.spawned += n;
  if (trailOn(world)) layTrail(world, head);
}

/** The new body's trail (`centiTrail`): through its laid parts from the tail to the head — each part at its odometer on it. */
function layTrail(world: World, head: Enemy): void {
  const body = centipedeBody(world, head.id).map(id => findSegment(world, id)!).reverse(), pts: number[] = [];
  let o = 0;
  body.forEach((e, i) => {
    if (i > 0) o += dist(e, body[i - 1]);
    pts.push(e.x, e.y, o);
    e.vars.tb = head.id;
    if (e !== head) e.vars.co = o;
  });
  (world.centiTrails ??= []).push({ id: head.id, pts });
  world.centiTrails.sort((a, b) => a.id - b.id);
}

/** Heads on the arena, at markers and in the queue. */
function headsNow(world: World): number {
  let n = 0;
  for (const e of world.enemies) if (e.kind === CENTIPEDE && e.vars.ca === undefined) n++;
  for (const m of world.markers) if (m.kind === CENTIPEDE) n++;
  for (const q of world.queue) if (q.kind === CENTIPEDE) n++;
  return n;
}

registerBehavior({
  id: CENTIPEDE,
  // A part made by `layParts` is pushed straight to the list: `onSpawn` runs for the head only.
  onSpawn: layParts,
  // The trails (`centiTrail`): the heads' points, once a tick before anyone moves.
  beforeStep: (world, members) => { if (trailOn(world)) beforeTrails(world, members); },
  step: (world, e, dt) => (e.vars.ca === undefined && e.vars.cx === undefined ? stepHead(world, e, dt) : stepPart(world, e, dt)),
  // The running head's touch is its run.
  touches: (_world, e) => e.boar !== 'charge',
  onDeath: partDied,
  // The crowd never moves the body; its own parts never push each other, two bodies part as ordinary ones (design review 22.10.2026).
  crowd: () => 'anchored',
  pairWith: (world, a, b) => (bodyFront(world, a) === bodyFront(world, b) ? 'kin' : 'apart'),
});

registerEnemyKind({
  id: CENTIPEDE, behavior: CENTIPEDE, speedClass: 'normal', hp: () => CENTI_HEAD_HP, speed: world => world.pressure.enemySpeed,
  bodyScale: BODY_SCALE, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: CENTIPEDE,
  noElite: true,
  capped: world => headsNow(world) >= (world.arena.kindCaps?.[CENTIPEDE] ?? CENTI_START_MAX),
  // Design 22.10.2026: a queued or marked centipede counts as its parts in the floor and the limit (spawn.ts), as a landed one.
  bodies: partsOf,
});
