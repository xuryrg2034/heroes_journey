/**
 * Task 59а «Гарнизон, шаг 3», В — «Привратники» and the anger (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 5).
 * Docs: docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3».
 *
 * **The kind** (`warden`): HP `wardenHp` (2: the first link of a chain does not kill it), the slow class (in the anger — fast), body 1,
 * art 1.1, its own touch (`contactDamage`; in the anger `wardenAngerTouch`), a link of its colour, never an elite; «Клеймо» never
 * repaints it (fusions.ts `brandPaintable`).
 *
 * **The pair** (`Params.wardens`; off — two plain slow enemies): two wardens of one formation (`vars.fm`: the arena's start formation or
 * a newcomer's group of 2). When the pair stands whole its colours are drawn once from the stream `behavior:warden`: A from the palette, B
 * another colour that is not A's twin (0 + 2, 1 + 3: «Близнецы» do not answer the pair) — `vars.wp` names the partner. The pair keeps
 * together: the second walks beside the first (`PAIR_GAP` across the way to the hero), the first walks to the hero.
 *
 * **The anger**: one of the pair dead and the other alive after the hero's move (a dash and its run) — the survivor is angry
 * `wardenAnger` s (a death outside a move — at once): the fast class, the touch `wardenAngerTouch`, «Размах» by the knight's law and
 * keys (enemies/garrison.ts `swingStrike`; the first `ANGER_FIRST_SWING` s after the anger began, then a pause `knightPause`; its strike
 * waits for the hero's move). Then it calms down (no pair any more). Both by one pass — no anger. The highlight shows who will be angry
 * (chain.ts `planChain(...).anger`).
 *
 * State in `enemy.vars`: `fm` the formation, `wp` the partner's id (while the pair stands), `wd` 1 — the pair was drawn, `wa` the anger's
 * seconds left, `ws` 1 — a «Размах» winds up, `wt` its windup left, `wc` the pause left, `wf` 1 after the first swing of the fight.
 */
import { dhypot } from '../detMath';
import { dist, pushOutOfObstacles } from '../geometry';
import { enemyGroundFactor, enemySpeed, type Enemy, type World } from '../world';
import { FIRST_WINDUP_FACTOR, knightPauseOf, swingStrike, swingWindupOf } from './garrison';
import { bodyRadiusOf, registerBehavior, registerEnemyKind } from './kinds';
import { palette } from '../spawn';

export const WARDEN = 'warden';
export const WARDEN_SWING_SOURCE = 'warden-swing';
// ---- Баланс (гипотезы спеки задачи 59, 17.10.2026; journals without the keys play these) ----
export const WARDEN_HP = 2;
export const WARDEN_ANGER = 8;
export const WARDEN_ANGER_TOUCH = 2;
/** The pair keeps this far apart across the way (≤ the link's reach: from A one steps to B). */
export const PAIR_GAP = 1.2;
/** The first «Размах» of an anger comes this long after it began (the window to finish the survivor). */
export const ANGER_FIRST_SWING = 2;
/** The palette's twins (0 + 2, 1 + 3); the fifth colour has none. */
const twinOf = (c: number): number => (c < 4 ? (c + 2) % 4 : -1);
const STREAM = 'behavior:warden';
const TIME_EPS = 1e-9;

export const wardensOn = (world: World): boolean => !!world.params.wardens;
export const wardenAngerOf = (world: World): number => Math.max(0, world.params.wardenAnger ?? WARDEN_ANGER);
/** The warden is angry now (seconds left > 0). */
export const wardenAngry = (e: Pick<Enemy, 'kind' | 'vars'>): boolean => e.kind === WARDEN && (e.vars.wa ?? 0) > 0;
/** The warden's partner while the pair stands (undefined — none). */
export function wardenPartner(world: World, e: Enemy): Enemy | undefined {
  return e.kind === WARDEN && e.vars.wp !== undefined ? world.enemies.find(o => o.id === e.vars.wp) : undefined;
}

/** The colours of a pair: A from the palette, B another that is not A's twin (one draw each of `behavior:warden`). */
function pairColors(world: World, palette: readonly number[]): [number, number] {
  const rng = world.rng.stream(STREAM), a = palette[Math.floor(rng.next() * palette.length)];
  const others = palette.filter(c => c !== a && c !== twinOf(a));
  const b = others.length ? others[Math.floor(rng.next() * others.length)] : palette.find(c => c !== a) ?? a;
  return [a, b];
}

/** The pairs that stand whole and have no colours yet: drawn once (the first by id gets A). */
function drawPairs(world: World, members: readonly Enemy[], palette: readonly number[]): void {
  const pairs = new Map<number, Enemy[]>();
  for (const e of members) {
    if (e.vars.wd || e.vars.fm === undefined) continue;
    const list = pairs.get(e.vars.fm);
    if (list) list.push(e); else pairs.set(e.vars.fm, [e]);
  }
  for (const pair of [...pairs.values()].sort((x, y) => x[0].id - y[0].id)) {
    if (pair.length !== 2) continue;
    const [a, b] = [...pair].sort((x, y) => x.id - y.id), [ca, cb] = pairColors(world, palette);
    a.color = ca; b.color = cb;
    a.vars.wp = b.id; b.vars.wp = a.id; a.vars.wd = 1; b.vars.wd = 1;
  }
}

/** The anger begins (event `warden` `anger` `start`); the pair is over. */
function startAnger(world: World, e: Enemy): void {
  delete e.vars.wp;
  e.vars.wa = wardenAngerOf(world); e.vars.wc = ANGER_FIRST_SWING; delete e.vars.ws;
  world.events.push({ type: 'warden', action: 'anger', stage: 'start', id: e.id, x: e.x, y: e.y });
}

/** The angry warden's «Размах»: a pause, a windup (the first of a fight ×1.5), the strike after the hero's move. */
function angerStep(world: World, e: Enemy, dt: number): boolean {
  const v = e.vars;
  if (v.ws === 1) {
    e.knock = 0;
    v.wt = Math.max(0, v.wt - dt);
    if (v.wt > TIME_EPS || world.move) return true;
    world.events.push({ type: 'warden', action: 'swing', stage: 'hit', id: e.id, x: e.x, y: e.y });
    swingStrike(world, e, WARDEN_SWING_SOURCE);
    delete v.ws; v.wc = knightPauseOf(world);
    return true;
  }
  v.wc = Math.max(0, (v.wc ?? 0) - dt);
  if (v.wc > TIME_EPS || world.status !== 'playing') return false;
  v.ws = 1; v.wt = swingWindupOf(world) * (v.wf === 1 ? 1 : FIRST_WINDUP_FACTOR); v.wf = 1;
  world.events.push({ type: 'warden', action: 'swing', stage: 'start', id: e.id, x: e.x, y: e.y });
  return true;
}

/** The second of a pair: its place beside its partner. False — the common walk. */
function followStep(world: World, e: Enemy, dt: number): boolean {
  const lead = wardenPartner(world, e);
  if (!lead || lead.id > e.id || e.knock > 0) return false;
  const hero = world.hero, dx = hero.x - lead.x, dy = hero.y - lead.y, d = dhypot(dx, dy) || 1;
  // The side of the way it stands on now keeps.
  const side = ((e.x - lead.x) * -dy + (e.y - lead.y) * dx) >= 0 ? 1 : -1;
  const to = { x: lead.x - dy / d * PAIR_GAP * side, y: lead.y + dx / d * PAIR_GAP * side }, gap = dist(e, to);
  if (gap < 0.05) return true;
  const step = Math.min(gap, enemySpeed(world, e) * enemyGroundFactor(world, e) * dt * 1.2);
  e.x += (to.x - e.x) / gap * step; e.y += (to.y - e.y) / gap * step;
  pushOutOfObstacles(e, bodyRadiusOf(world.params, e), world.arena);
  return true;
}

registerBehavior({
  id: WARDEN,
  beforeStep(world, members) {
    if (!wardensOn(world)) return;
    drawPairs(world, members, palette(world));
    for (const e of members) {
      // A partner gone: the anger after the hero's move (the highlight's promise), at once otherwise.
      if (e.vars.wp !== undefined && !world.enemies.some(o => o.id === e.vars.wp) && !world.move) startAnger(world, e);
    }
  },
  step(world, e, dt) {
    const v = e.vars;
    if ((v.wa ?? 0) > 0) {
      v.wa = Math.max(0, v.wa - dt);
      if (v.wa <= TIME_EPS) {
        delete v.wa; delete v.ws; delete v.wt; delete v.wc;
        world.events.push({ type: 'warden', action: 'anger', stage: 'end', id: e.id, x: e.x, y: e.y });
        return false;
      }
      return angerStep(world, e, dt);
    }
    return followStep(world, e, dt);
  },
});

registerEnemyKind({
  id: WARDEN, behavior: WARDEN, speedClass: 'slow', speedClassOf: e => (wardenAngry(e) ? 'fast' : 'slow'), ownTouch: true, noElite: true,
  hp: params => Math.max(0, Math.floor(params.wardenHp ?? WARDEN_HP)),
  speed: (world, e) => world.pressure.enemySpeed * (wardenAngry(e) ? world.params.speedFast : world.params.speedSlow),
  bodyScale: 1, artScale: 1.1, touchDamage: (world, e) => (wardenAngry(e) ? Math.max(0, world.params.wardenAngerTouch ?? WARDEN_ANGER_TOUCH) : world.params.contactDamage),
  mass: () => 1, spread: true, chainable: true, hitSource: WARDEN,
});
