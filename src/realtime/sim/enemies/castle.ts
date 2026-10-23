/**
 * Task 55а «Замок: толчок» (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 2–3; docs/realtime-elite-behaviors.md,
 * «Замок: толчок»): the things of the castle — the barrel (`barrel`) and the wardrobe (`wardrobe`) — and the rook (`rook`).
 *
 * **A thing** (`EnemyKindDef.thing`): a colourless body, an enemy of the code only. It stands and never walks; the crowd never moves it
 * (solid: `EnemyBehavior.solid` with `Params.shove` — the hero is put out of it, task 48); its touch does not hurt; no consumable,
 * blast, fire, cold, spin or enemy's move hurts it (`immune`). It loses durability (`vars.du`: the barrel 1, the wardrobe 2) only by a
 * shove (sim/shove.ts). Never an elite, never marked, not in the crowd's density (spawn.ts). Its place in the chain — the last link,
 * the shove at the dash's end — is chain.ts's (task 55а, its last step).
 *
 * **«Падение шкафа»** (`wardrobe-topple`): its rest (`wardrobePeriod`, from rising) over, the hero within `TOPPLE_REACH` of its centre and
 * in sight — the windup (`wardrobeWindup`; the first of a fight ×`FIRST_FACTOR`): a lane `TOPPLE_LENGTH` × `TOPPLE_WIDTH` from its body's
 * edge towards the hero, fixed now. Then the hit: the hero in the lane — `wardrobeDamage` (source `wardrobe-topple`; a shield blocks);
 * the enemies in the lane — 1 (`damageEnemy`: the weak die, the tough lose 1 HP, an elite a plate) — not the player's; things are
 * untouched. The wardrobe then lies on the lane (its centre `TOPPLE_SHIFT` along it, walls push it out) for `LIE_TIME` s and stands up.
 * While it is a link of the drawn chain or the hero moves (a dash, a jump), the hit waits (the windup runs) — the highlight stays true.
 * A shove drops its windup, stands it up and starts a full rest.
 *
 * **«Удар ладьи»** (`rook-strike`): the rook stands at its post (no walk; a knockback does not move it; mass 3), HP `ROOK_HP`, a link of
 * its colour, never an elite, touches as a tough enemy (source `rook`). Its rest (`rookPeriod`) over, the hero within `AXIS_REACH` of one
 * of its two axes (the row or the column through it; the nearer) — the windup (`rookWindup`; the first of a fight `ROOK_FIRST_WINDUP`):
 * the axis both ways to the first wall, its direction and width fixed now. Its sign: each half up to the first thing on it NOW
 * (`rookCover`, design 17.10.2026: a thing shoved onto the axis or off it moves the sign's end; bodies do not end it). The strike: on each
 * half the FIRST body before that cover (its circle touches the lane, `ROOK_HALF` each side): the hero — `rookDamage` (a shield blocks);
 * an enemy dies (an elite loses a plate) — not the player's; none and a thing at the cover — it shelters (the thing is whole). Frozen — it waits; its death drops the strike.
 *
 * State in `enemy.vars`: things — `du` durability; the wardrobe — `tr` rest left, `tw` 1 winding up, `tc` windup left, `tt` its length,
 * `tf` 1 after its first windup, `lx`/`ly` the lane's start, `dx`/`dy` its direction, `lie` lying left; the rook — `rr` rest left, `rw` 1
 * winding up, `rc` windup left, `rt` its length, `rf` 1 after its first windup, `ra` the axis (0 the row, 1 the column), `ox`/`oy` the
 * origin, `lp`/`ln` the half lengths (+ and − along the axis).
 */
import { dhypot } from '../detMath';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { canBeHurt, damageEnemy, hurtHero, noteBlock, pushOutOfSolids, type Enemy, type World } from '../world';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

export const BARREL = 'barrel';
export const WARDROBE = 'wardrobe';
export const ROOK = 'rook';
/** Hit sources: the wardrobe's topple, the rook's strike (its touch — `rook`). */
export const TOPPLE_SOURCE = 'wardrobe-topple';
export const ROOK_SOURCE = 'rook-strike';
// ---- Баланс (гипотезы спеки задачи 55, 17.10.2026; journals without the keys play these) ----
export const BARREL_DURABILITY = 1;
export const WARDROBE_DURABILITY = 2;
/** A thing's mass for the crowd (it is solid with the law on; the mass holds it without). */
export const THING_MASS = 1000;
export const WARDROBE_PERIOD = 5;
export const WARDROBE_WINDUP = 1.2;
export const WARDROBE_DAMAGE = 2;
/** The topple: the hero within this of its centre; its lane (from the body's edge) and the lane's width; how far it falls; how long it lies. */
export const TOPPLE_REACH = 3.6;
export const TOPPLE_LENGTH = 3;
export const TOPPLE_WIDTH = 1.2;
export const TOPPLE_SHIFT = 1.5;
export const LIE_TIME = 2;
/** The first windup of a fight is this much longer (the wardrobe). */
export const FIRST_FACTOR = 1.5;
export const ROOK_HP = 2;
export const ROOK_MASS = 3;
export const ROOK_PERIOD = 3.5;
export const ROOK_WINDUP = 1;
export const ROOK_FIRST_WINDUP = 1.5;
export const ROOK_DAMAGE = 2;
/** The rook aims with the hero this near one of its axes; its lane is `ROOK_HALF` each side (0.5 wide, as the crossbow's bolt). */
export const AXIS_REACH = 2.5;
export const ROOK_HALF = 0.25;
const MAX_LINE = 60;
const LINE_STEP = 0.05;
const TIME_EPS = 1e-9;

const wardrobePeriodOf = (world: World): number => Math.max(0, world.params.wardrobePeriod ?? WARDROBE_PERIOD);
export const wardrobeWindupOf = (world: World): number => Math.max(0.05, world.params.wardrobeWindup ?? WARDROBE_WINDUP);
const wardrobeDamageOf = (world: World): number => Math.max(0, world.params.wardrobeDamage ?? WARDROBE_DAMAGE);
const rookPeriodOf = (world: World): number => Math.max(0, world.params.rookPeriod ?? ROOK_PERIOD);
export const rookWindupOf = (world: World): number => Math.max(0.05, world.params.rookWindup ?? ROOK_WINDUP);
const rookDamageOf = (world: World): number => Math.max(0, world.params.rookDamage ?? ROOK_DAMAGE);

/** Distance from `p` to the segment a–b. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** The enemy is a link of the drawn chain or of the running dash. */
function linked(world: World, e: Enemy): boolean {
  const has = (l: { kind: string; id: number; fork?: { kind: string; id: number } }): boolean => (l.kind === 'enemy' && l.id === e.id) || (l.fork?.kind === 'enemy' && l.fork.id === e.id);
  return world.chain.some(has) || !!world.move?.links.some(has);
}

// ---- Things ----

/**
 * A thing's body: solid for the hero with the law on (he is put out of it); never walks. Task 60а: a thing the poltergeist holds up or
 * throws (`vars.lf`) is no body — not solid, no part of the parting (nothing changes without a poltergeist).
 */
const thingBehavior = (id: string, step?: (world: World, e: Enemy, dt: number) => void, onShoved?: (world: World, thing: Enemy) => void) => registerBehavior({
  id,
  onSpawn(_world, e) { e.vars.du = e.kind === BARREL ? BARREL_DURABILITY : WARDROBE_DURABILITY; if (e.kind === WARDROBE) { e.vars.tr = 0; e.vars.tw = 0; } },
  step(world, e, dt) { e.knock = 0; step?.(world, e, dt); return true; },
  touches: () => false,
  solid: (world, e) => !!world.params.shove && e.vars.lf === undefined,
  crowd: (_world, e) => (e.vars.lf !== undefined ? 'ghost' : undefined),
  ...onShoved ? { onShoved } : {},
});

const thingKind = (id: string, artScale: number) => registerEnemyKind({
  id, behavior: id, thing: true, immune: true, noElite: true, hp: () => 0, speed: () => 0,
  bodyScale: 1, artScale, touchDamage: () => 0, mass: () => THING_MASS, spread: false,
  // Task 55а: the chain takes a thing as its last link with the law on (chain.ts; the law off — the refusal `colorless`).
  chainable: true, hitSource: id,
});

/** The wardrobe's topple now (the view): its lane and the windup's share, or null. */
export function wardrobeTopple(world: World, e: Enemy): { from: Vec; to: Vec; half: number; progress: number } | null {
  const v = e.vars;
  if (e.kind !== WARDROBE || v.tw !== 1 || world.status !== 'playing') return null;
  return { from: { x: v.lx, y: v.ly }, to: { x: v.lx + v.dx * TOPPLE_LENGTH, y: v.ly + v.dy * TOPPLE_LENGTH }, half: TOPPLE_WIDTH / 2, progress: Math.max(0, Math.min(1, 1 - v.tc / Math.max(1e-6, v.tt))) };
}
/** The wardrobe lies (seconds left), or 0. */
export const wardrobeLying = (e: Enemy): number => (e.kind === WARDROBE ? e.vars.lie ?? 0 : 0);

function beginTopple(world: World, e: Enemy): void {
  const v = e.vars, hero = world.hero, d = dist(e, hero) || 1, dx = (hero.x - e.x) / d, dy = (hero.y - e.y) / d, r = bodyRadiusOf(world.params, e);
  const windup = wardrobeWindupOf(world) * (v.tf === 1 ? 1 : FIRST_FACTOR);
  v.tw = 1; v.tf = 1; v.tc = windup; v.tt = windup; v.dx = dx; v.dy = dy; v.lx = e.x + dx * r; v.ly = e.y + dy * r;
  world.events.push({ type: 'wardrobe', action: 'windup', id: e.id, x: e.x, y: e.y });
}

function topple(world: World, e: Enemy): void {
  const v = e.vars, p = world.params, from = { x: v.lx, y: v.ly }, to = { x: v.lx + v.dx * TOPPLE_LENGTH, y: v.ly + v.dy * TOPPLE_LENGTH }, half = TOPPLE_WIDTH / 2;
  world.events.push({ type: 'wardrobe', action: 'hit', id: e.id, x: e.x, y: e.y });
  if (segmentDistance(from, to, world.hero) <= half + heroRadius(p)) {
    if (canBeHurt(world)) hurtHero(world, e, wardrobeDamageOf(world), TOPPLE_SOURCE);
    else noteBlock(world, world.hero.x, world.hero.y, TOPPLE_SOURCE, e.id);
  }
  if (world.status !== 'playing') return;
  // The enemies in the lane (collected first: a kill changes the list); things are untouched.
  const struck = world.enemies.filter(o => o !== e && !kindOf(o).thing && segmentDistance(from, to, o) <= half + bodyRadiusOf(p, o));
  for (const o of struck) damageEnemy(world, o, 1, { source: TOPPLE_SOURCE, credited: false, plates: 1, firing: e.id });
  // It lies on the lane.
  e.x += v.dx * TOPPLE_SHIFT; e.y += v.dy * TOPPLE_SHIFT;
  pushOutOfObstacles(e, bodyRadiusOf(p, e), world.arena);
  pushOutOfSolids(world, world.hero);
  v.tw = 0; v.lie = LIE_TIME;
}

function stepWardrobe(world: World, e: Enemy, dt: number): void {
  const v = e.vars;
  if (world.shoves?.some(s => s.thing === e.id)) return;
  if (v.lie !== undefined) {
    v.lie -= dt;
    if (v.lie > TIME_EPS) return;
    delete v.lie; v.tr = wardrobePeriodOf(world);
    world.events.push({ type: 'wardrobe', action: 'rise', id: e.id, x: e.x, y: e.y });
    return;
  }
  if (v.tw === 1) {
    v.tc = Math.max(0, v.tc - dt);
    // In the drawn chain or while the hero moves the hit waits (the windup runs out and holds).
    if (v.tc > TIME_EPS || linked(world, e) || world.move || world.status !== 'playing') return;
    topple(world, e);
    return;
  }
  v.tr = Math.max(0, (v.tr ?? 0) - dt);
  if (v.tr > TIME_EPS || world.status !== 'playing' || dist(e, world.hero) > TOPPLE_REACH || !lineOfSight(e, world.hero, world.arena, 0.05)) return;
  beginTopple(world, e);
}

/** A shove drops the wardrobe's windup, stands it up and starts a full rest. */
function shovedWardrobe(world: World, thing: Enemy): void {
  const v = thing.vars;
  if (v.tw === 1 || v.lie !== undefined) world.events.push({ type: 'wardrobe', action: 'rise', id: thing.id, x: thing.x, y: thing.y });
  v.tw = 0; delete v.lie; v.tr = wardrobePeriodOf(world);
}

thingBehavior(BARREL);
thingBehavior(WARDROBE, stepWardrobe, shovedWardrobe);
thingKind(BARREL, 1);
thingKind(WARDROBE, 1.2);


// ---- The rook ----

/** Length of a ray from (x, y) along (dx, dy): the first wall or tree cuts it (water and cliffs do not). */
function rayLength(world: World, x: number, y: number, dx: number, dy: number): number {
  for (let t = LINE_STEP; t < MAX_LINE; t += LINE_STEP) if (blockedAt({ x: x + dx * t, y: y + dy * t }, 0.02, world.arena, false)) return t;
  return MAX_LINE;
}

/** Where a body is along the half of the axis from the rook's post along (dx, dy) — its centre's distance — if its circle touches the lane. */
function alongAxis(e: Enemy, dx: number, dy: number, len: number, b: Vec, r: number): number | null {
  const rx = b.x - e.vars.ox, ry = b.y - e.vars.oy, t = rx * dx + ry * dy;
  if (t <= 0 || t > len) return null;
  return Math.abs(rx * dy - ry * dx) <= ROOK_HALF + r ? t : null;
}

/**
 * The cover of a half of the axis (design 17.10.2026, task-55 §22): the first thing on it now (the barrel, the wardrobe; walls and
 * columns already end the half at the windup's start) — its centre's distance along the half; none — the half's length to the wall.
 * One rule for the sign (`rookLine`, read live: a thing shoved onto the axis or off it moves the sign's end) and for the strike.
 */
function rookCover(world: World, e: Enemy, dx: number, dy: number, len: number): number {
  let cover = len;
  for (const other of world.enemies) {
    // Task 60а: a lifted thing (the poltergeist's) is no cover.
    if (other === e || !kindOf(other).thing || other.vars.lf !== undefined) continue;
    const t = alongAxis(e, dx, dy, len, other, bodyRadiusOf(world.params, other));
    if (t !== null && t < cover) cover = t;
  }
  return cover;
}

/**
 * The rook's sign now (the view): the axis both ways from its post — its direction and width fixed at the windup's start, each half up to
 * its first thing-cover now (bodies do not end it: they walk) — and the windup's share, or null.
 */
export function rookLine(world: World, e: Enemy): { x0: number; y0: number; x1: number; y1: number; axis: 'row' | 'column'; half: number; progress: number } | null {
  const v = e.vars;
  if (e.kind !== ROOK || v.rw !== 1 || world.status !== 'playing') return null;
  const dx = v.ra === 0 ? 1 : 0, dy = v.ra === 0 ? 0 : 1, plus = rookCover(world, e, dx, dy, v.lp), minus = rookCover(world, e, -dx, -dy, v.ln);
  return { x0: v.ox - dx * minus, y0: v.oy - dy * minus, x1: v.ox + dx * plus, y1: v.oy + dy * plus, axis: v.ra === 0 ? 'row' : 'column', half: ROOK_HALF, progress: Math.max(0, Math.min(1, 1 - v.rc / Math.max(1e-6, v.rt))) };
}

function beginRook(world: World, e: Enemy, axis: 0 | 1): void {
  const v = e.vars, dx = axis === 0 ? 1 : 0, dy = axis === 0 ? 0 : 1, windup = rookWindupOf(world) * (v.rf === 1 ? 1 : ROOK_FIRST_WINDUP / ROOK_WINDUP);
  v.rw = 1; v.rf = 1; v.rc = windup; v.rt = windup; v.ra = axis; v.ox = e.x; v.oy = e.y;
  v.lp = rayLength(world, e.x, e.y, dx, dy); v.ln = rayLength(world, e.x, e.y, -dx, -dy);
  const line = rookLine(world, e)!;
  world.events.push({ type: 'rook', action: 'aim', id: e.id, axis: line.axis, x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 });
}

/**
 * One half of the strike: the first body along (dx, dy) before the half's cover (`rookCover`, the sign's end) — the hero or an enemy;
 * none before it and a thing at it — the thing shelters (`thing`); nothing — null.
 */
function strikeHalf(world: World, e: Enemy, dx: number, dy: number, len: number): 'hero' | 'enemy' | 'thing' | null {
  const p = world.params, cover = rookCover(world, e, dx, dy, len);
  let best: Enemy | null = null, bestT = alongAxis(e, dx, dy, cover, world.hero, heroRadius(p)), hero = bestT !== null;
  for (const other of world.enemies) {
    if (other === e || kindOf(other).thing) continue;
    const t = alongAxis(e, dx, dy, cover, other, bodyRadiusOf(p, other));
    if (t !== null && (bestT === null || t < bestT)) { best = other; bestT = t; hero = false; }
  }
  if (hero) {
    if (canBeHurt(world)) hurtHero(world, e, rookDamageOf(world), ROOK_SOURCE);
    else noteBlock(world, world.hero.x, world.hero.y, ROOK_SOURCE, e.id);
    return 'hero';
  }
  if (best) {
    damageEnemy(world, best, Math.max(1, best.hp + 1), { source: ROOK_SOURCE, credited: false, firing: e.id });
    return 'enemy';
  }
  return cover < len ? 'thing' : null;
}

function stepRook(world: World, e: Enemy, dt: number): boolean {
  // It stands at its post: a knockback is dropped, the walk skipped.
  e.knock = 0;
  const v = e.vars, hero = world.hero;
  if (v.rw === 1) {
    v.rc -= dt;
    if (v.rc > TIME_EPS) return true;
    v.rw = 0; v.rr = rookPeriodOf(world);
    if (world.status !== 'playing') return true;
    const dx = v.ra === 0 ? 1 : 0, dy = v.ra === 0 ? 0 : 1;
    // The sign's ends at the strike (each half to its cover now), then the two halves.
    const plusEnd = rookCover(world, e, dx, dy, v.lp), minusEnd = rookCover(world, e, -dx, -dy, v.ln);
    const plus = strikeHalf(world, e, dx, dy, v.lp);
    const minus = world.status === 'playing' ? strikeHalf(world, e, -dx, -dy, v.ln) : null;
    world.events.push({ type: 'rook', action: 'shot', id: e.id, axis: v.ra === 0 ? 'row' : 'column', x0: v.ox - dx * minusEnd, y0: v.oy - dy * minusEnd, x1: v.ox + dx * plusEnd, y1: v.oy + dy * plusEnd, ...plus ? { plus } : {}, ...minus ? { minus } : {} });
    return true;
  }
  v.rr = Math.max(0, (v.rr ?? 0) - dt);
  if (v.rr > TIME_EPS || world.status !== 'playing') return true;
  const row = Math.abs(hero.y - e.y), column = Math.abs(hero.x - e.x);
  if (Math.min(row, column) > AXIS_REACH) return true;
  beginRook(world, e, row <= column ? 0 : 1);
  return true;
}

registerBehavior({ id: ROOK, onSpawn(_world, e) { e.vars.rr = 0; e.vars.rw = 0; }, step: stepRook });
registerEnemyKind({
  id: ROOK, behavior: ROOK, speedClass: 'normal', hp: () => ROOK_HP, speed: world => world.pressure.enemySpeed,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => ROOK_MASS, spread: true, chainable: true, hitSource: ROOK,
  noElite: true,
});
