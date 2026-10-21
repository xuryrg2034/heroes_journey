/**
 * Task 59а «Гарнизон, шаг 3», Б — «Новобранцы» and the law of order (design 17.10.2026, docs/design-notes/task-59-garrison-step3.md, 4;
 * user's decision: the refusal «не по порядку»). Docs: docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3».
 *
 * **The kind** (`recruit`): HP 0 (always weak), the slow class, body 1, art 0.9, touches as a plain enemy, a link of its colour, never an
 * elite. It walks in the guards' line (`guardFormation`, enemies/garrison.ts `formLines`) — a formation of 4 of one colour (the arena's
 * start formation, or a newcomer's group).
 *
 * **Numbers** (`vars.rn` 1…n, the group's size `vars.rs`): drawn once the formation stands whole (or its first member is `NUMBER_WAIT` s
 * old) from the stream `behavior:recruit`, by the places in the line (across the way to the hero, as the line stands): neighbouring numbers
 * stand at most `NEIGHBOUR_PLACES` places apart (the chain 1 → 2 → 3 → 4 is always within the reach) and never in line order (1-2-3-4 or
 * 4-3-2-1: the formation asks for a route, not the nearest body).
 *
 * **The law of order** (`Params.recruits`; off — plain slow enemies of the line):
 * - the group's current number is the smallest number of its living members; the chain takes only the current one — another is refused
 *   «не по порядку» (chain.ts, refusal `order`); in the drawn chain a recruit link counts as dying (HP 0), so the next one is current then;
 * - out of order nothing hurts it (`damageEnemy`: the hit reaches it and goes out — event `recruit` `refused`): the bomb, fire, the bolt,
 *   a bite, «Размах», a blast. A hit on many at once takes a group's members by their numbers (`orderRecruits`: the targets' order, then
 *   `damageEnemy` one by one — the queue moves after each kill); the previews read the same (`recruitGate`);
 * - the whole formation by one pass (the dash, its pierce, wave and end blast; its return run) — `recruitBonus` energy after the pass
 *   (event `recruit` `drill`). A formation begun earlier gives none; one whose member another source finished during the move
 *   (a bolt, a burn, a bomb, the hammer's fire; `PASS_SOURCES`) gives none (design 21.10.2026).
 *
 * State in `enemy.vars`: `fm` the formation (enemies/garrison.ts), `rn` the number, `rs` the group's size, `rd` 1 — the numbers were drawn.
 */
import { dhypot } from '../detMath';
import { enemyFrozen, type Enemy, type World } from '../world';
import { registerBehavior, registerEnemyKind } from './kinds';
import { formLines, lineStep } from './garrison';

export const RECRUIT = 'recruit';
/** The formation's size (the arenas' `NewcomerShare.group`, the start formations). */
export const RECRUIT_FORMATION = 4;
/** Neighbouring numbers stand at most this many places apart in the line. */
export const NEIGHBOUR_PLACES = 2;
/** A formation not whole by then (a member died or never came) gets its numbers anyway. */
export const NUMBER_WAIT = 1;
export const RECRUIT_BONUS = 2;
const STREAM = 'behavior:recruit';
/**
 * The pass's own hits (design 21.10.2026, spec 4.2): the instant hits along its path and at its end — the chain, «Прямая», «Печать»,
 * «Возврат», «Режущий проход», the wave and the end blast. A recruit finished by another source during the move — a bolt, a bomb, a burn,
 * the fire of «Огненный проход» and «Клеймо» (a fire point is ground that burns in the world's step, as pitch; design 21.10.2026,
 * variant б) — its formation gives no bonus for this pass. (The seal, the wave and the end blast strike once the move is over —
 * `finishMove` — so they never spoil it; they are listed for the rule's sake.)
 */
const PASS_SOURCES: ReadonlySet<string> = new Set(['chain', 'pierce', 'seal', 'hammer-return', 'hammer-cut', 'wave', 'hammer-blast']);

/** The law of order is on (`Params.recruits`). */
export const recruitsOn = (world: World): boolean => !!world.params.recruits;
/** A recruit's number (0 — not drawn yet, or not a recruit). */
export const recruitNumber = (e: Pick<Enemy, 'kind' | 'vars'>): number => (e.kind === RECRUIT ? e.vars.rn ?? 0 : 0);
/** A recruit's group: its formation, or itself alone. */
export const recruitGroup = (e: Pick<Enemy, 'id' | 'vars'>): number => e.vars.fm ?? e.id;

/** The group's current number among `enemies` (the world's, or a shadow list): the smallest number alive, not in `gone`; 0 — none. */
export function recruitCurrent(enemies: readonly Enemy[], group: number, gone?: ReadonlySet<number>): number {
  let current = 0;
  for (const e of enemies) {
    if (e.kind !== RECRUIT || recruitGroup(e) !== group || gone?.has(e.id)) continue;
    const n = e.vars.rn ?? 0;
    if (n > 0 && (current === 0 || n < current)) current = n;
  }
  return current;
}

/**
 * `e` may be hit now by the law of order: not a recruit, the law off, its number not drawn yet, or the current one of its group (`gone` —
 * the members a hit of the same action kills before it).
 */
export function recruitInOrder(world: World, e: Enemy, enemies: readonly Enemy[] = world.enemies, gone?: ReadonlySet<number>): boolean {
  if (e.kind !== RECRUIT || !recruitsOn(world) || !e.vars.rn) return true;
  return recruitCurrent(enemies, recruitGroup(e), gone) === e.vars.rn;
}

/**
 * A hit on many at once (task 59а, decision 17.10.2026): the targets with each group's recruits in the order of their numbers (put where
 * the group's first one stood; the others keep their order). No recruit — the same list.
 */
export function orderRecruits<T extends Enemy>(targets: readonly T[]): T[] {
  if (!targets.some(e => e.kind === RECRUIT)) return [...targets];
  const out: T[] = [], placed = new Set<number>();
  for (const e of targets) {
    if (e.kind !== RECRUIT) { out.push(e); continue; }
    const g = recruitGroup(e);
    if (placed.has(g)) continue;
    placed.add(g);
    out.push(...targets.filter(o => o.kind === RECRUIT && recruitGroup(o) === g).sort((a, b) => (a.vars.rn ?? 0) - (b.vars.rn ?? 0) || a.id - b.id));
  }
  return out;
}

/**
 * The recruits of `ordered` (hit one by one in this order) the law refuses: out of order when their hit comes — each one in order dies
 * (HP 0), so the queue moves on. The preview's rule of `damageEnemy` (one function for both: the order of the list decides). `gone` — the
 * members dead before this hit (the chain's kills of the same action). The law off or no recruit — none.
 */
export function recruitGate(world: World, enemies: readonly Enemy[], ordered: readonly Enemy[], gone?: ReadonlySet<number>): Set<number> {
  return recruitsOn(world) ? recruitGateList(enemies, ordered, gone) : new Set<number>();
}

/** `recruitGate` of a shadow list (buildHits.ts `shadowHitAll`): numbers are drawn only with the law on, so a number is the law here. */
export function recruitGateList(enemies: readonly Enemy[], ordered: readonly Enemy[], gone?: ReadonlySet<number>): Set<number> {
  const refused = new Set<number>();
  if (!ordered.some(e => e.kind === RECRUIT && e.vars.rn)) return refused;
  const dead = new Set(gone ?? []);
  for (const e of ordered) {
    if (e.kind !== RECRUIT || !e.vars.rn) continue;
    if (recruitCurrent(enemies, recruitGroup(e), dead) === e.vars.rn) dead.add(e.id); else refused.add(e.id);
  }
  return refused;
}

/** The permutations of 1…n by places 0…n−1 the law allows: neighbouring numbers ≤ `NEIGHBOUR_PLACES` places apart, never in line order. */
function allowedOrders(n: number): number[][] {
  const out: number[][] = [];
  const rec = (rest: number[], placeOf: number[]): void => {
    if (!rest.length) {
      const asc = placeOf.every((p, i) => p === i), desc = placeOf.every((p, i) => p === n - 1 - i);
      if (n < 3 || (!asc && !desc)) out.push([...placeOf]);
      return;
    }
    for (const p of rest) {
      const prev = placeOf[placeOf.length - 1];
      if (prev !== undefined && Math.abs(p - prev) > NEIGHBOUR_PLACES) continue;
      rec(rest.filter(x => x !== p), [...placeOf, p]);
    }
  };
  rec(Array.from({ length: n }, (_, i) => i), []);
  return out;
}

/** The places of a line across the way to the hero (as `formLines` orders them; ties by id). */
function byPlace(world: World, line: readonly Enemy[]): Enemy[] {
  let cx = 0, cy = 0;
  for (const e of line) { cx += e.x; cy += e.y; }
  cx /= line.length; cy /= line.length;
  const dx = world.hero.x - cx, dy = world.hero.y - cy, d = dhypot(dx, dy) || 1, px = -dy / d, py = dx / d;
  return [...line].sort((a, b) => ((a.x - cx) * px + (a.y - cy) * py) - ((b.x - cx) * px + (b.y - cy) * py) || a.id - b.id);
}

/** The numbers of each formation that has none yet: whole (or waited `NUMBER_WAIT`) — one draw of `behavior:recruit`. */
function drawNumbers(world: World, members: readonly Enemy[]): void {
  const groups = new Map<number, Enemy[]>();
  for (const e of members) {
    if (e.vars.rd) continue;
    const g = recruitGroup(e), list = groups.get(g);
    if (list) list.push(e); else groups.set(g, [e]);
  }
  for (const line of [...groups.values()].sort((a, b) => a[0].id - b[0].id)) {
    if (line.length < RECRUIT_FORMATION && !line.some(e => e.age >= NUMBER_WAIT)) continue;
    const places = byPlace(world, line), orders = allowedOrders(places.length);
    const placeOf = orders[Math.floor(world.rng.stream(STREAM).next() * orders.length)] ?? places.map((_, i) => i);
    placeOf.forEach((place, i) => { const e = places[place]; e.vars.rn = i + 1; e.vars.rs = places.length; e.vars.rd = 1; });
  }
}

/**
 * Spec 4.2, variant А (design 21.10.2026): the drawn chain read from its start keeps a recruit link only while its number is the current
 * one of its group (counting the recruit links kept before it: they die in the pass); any other drops alone (event `recruit` `unlink`,
 * not a hit). Groups count apart; the other links stay. The numbers drawn while a chain was drawn are what puts a link out of order.
 */
function dropOutOfOrder(world: World): void {
  const kept = new Set<number>(), dropped: Enemy[] = [];
  world.chain = world.chain.filter(l => {
    const e = l.kind === 'enemy' ? world.enemies.find(x => x.id === l.id) : undefined;
    if (!e || e.kind !== RECRUIT) return true;
    if (!recruitInOrder(world, e, world.enemies, kept)) { dropped.push(e); return false; }
    kept.add(e.id);
    return true;
  });
  if (!dropped.length) return;
  delete world.chainClosed;
  for (const e of dropped) world.events.push({ type: 'recruit', action: 'unlink', id: e.id, x: e.x, y: e.y });
}

registerBehavior({
  id: RECRUIT,
  beforeStep(world, members) {
    if (recruitsOn(world)) {
      // No numbers during the hero's move (design 21.10.2026) or while a shoved thing slides (its crushed list was fixed by the release):
      // the pass keeps the order its release saw.
      if (!world.move && !world.shoves?.length) drawNumbers(world, members);
      if (world.chain.length) dropOutOfOrder(world);
    }
    // No guard on the arena (their group step did not run): the recruits of a formation keep a line of their own.
    if (world.params.guardFormation && !world.enemies.some(g => g.kind === 'guard')) {
      const line = members.filter(e => e.vars.fm !== undefined && !enemyFrozen(e));
      if (line.length) formLines(world, line);
    }
  },
  step: lineStep,
  onDeath(world, e, cause) {
    // Design 21.10.2026: a member finished by a source that is not the pass's own spoils its formation's bonus for this move.
    const move = world.move;
    if (move?.drill && !PASS_SOURCES.has(cause.source)) {
      const group = recruitGroup(e), left = move.drill.filter(g => g !== group);
      if (left.length !== move.drill.length) { if (left.length) move.drill = left; else delete move.drill; }
    }
  },
});

registerEnemyKind({
  id: RECRUIT, behavior: RECRUIT, speedClass: 'slow', hp: () => 0, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 0.9, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: RECRUIT,
  noElite: true,
});

/** The event of a hit the law of order refused: it reached the recruit and went out (the view's spark). */
export function noteRefused(world: World, e: Enemy, source: string): void {
  world.events.push({ type: 'recruit', action: 'refused', id: e.id, x: e.x, y: e.y, source });
}

/** The formations whole now (every member of the drawn numbers alive): the release notes them for the bonus of the pass. */
export function wholeFormations(world: World): number[] {
  if (!recruitsOn(world)) return [];
  const count = new Map<number, { alive: number; size: number }>();
  for (const e of world.enemies) {
    if (e.kind !== RECRUIT || !e.vars.rs) continue;
    const g = recruitGroup(e), c = count.get(g) ?? { alive: 0, size: e.vars.rs };
    c.alive++; count.set(g, c);
  }
  return [...count].filter(([, c]) => c.alive === c.size).map(([g]) => g).sort((a, b) => a - b);
}

/**
 * The pass is over: each formation whole at its release with no member left gives `recruitBonus` energy (event `recruit` `drill`); the
 * groups that still stand are returned (a return run of the same pass may finish them).
 */
export function drillEnd(world: World, groups: readonly number[], energyMax: number): number[] {
  const left: number[] = [];
  for (const g of groups) {
    if (world.enemies.some(e => e.kind === RECRUIT && recruitGroup(e) === g)) { left.push(g); continue; }
    const bonus = Math.max(0, world.params.recruitBonus ?? RECRUIT_BONUS);
    world.energy = Math.min(energyMax, world.energy + bonus);
    world.events.push({ type: 'recruit', action: 'drill', id: g, x: world.hero.x, y: world.hero.y, energy: bonus });
  }
  return left;
}

/** The group's current recruit now (the view): its number and members; null — no such group. */
export function recruitQueue(world: World, group: number): { current: number; members: { id: number; n: number }[] } | null {
  const members = world.enemies.filter(e => e.kind === RECRUIT && recruitGroup(e) === group).map(e => ({ id: e.id, n: e.vars.rn ?? 0 }));
  return members.length ? { current: recruitCurrent(world.enemies, group), members } : null;
}
