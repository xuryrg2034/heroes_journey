/**
 * The prologue «Опушка» (task 6, design 12.10.2026; task 9 and task 13, design 13.10.2026; docs/realtime-onboarding.md, «Пролог
 * «Опушка»: правила комнат»): ten rooms outside the run, before its first start. This module is the rooms' data for the view: id,
 * title, arena, the numbers the room plays (`PROLOGUE_FORCED`: existing `Params` keys over the run's `RT_RUN_FORCED` — no new
 * key), the loadout, the action tiles the room shows, and the guides: the hand route of the chain rooms 1–4 and 8 (the ghost
 * hand: the view draws `prologueRoute`; `planChain` of the same links is the highlight the player would see, the tests check the
 * dash by it meets the goal), the jump's spot and aim of room 5 (`prologueJumpAim`), the spin's readiness of room 6
 * (`prologueSpinReady`), the hand's chain of 3+ of one colour of room 9 «Щит» (`prologueShieldChain`).
 *
 * The run's own data (seeds, pools, saves, `RT_RUN_FORCED`) is not touched; nothing here is saved.
 */
import { PROLOGUE_ARENAS, PROLOGUE_CLIFF } from '../sim/arenasPrologue';
import type { ArenaTemplate } from '../sim/arenas';
import { canSpin, spinTargets } from '../sim/abilities';
import { HERO_CANCEL_RADIUS, NO_PIERCE, canJump, canLink, canLinkObject, jumpLanding, linkPoint, planChain, type ChainPlan } from '../sim/chain';
import { enemyArtRadius } from '../sim/enemies/kinds';
import { blockedAt, dist, inWater, type Vec } from '../sim/geometry';
import { goblinOf } from '../sim/slot';
import type { ItemKind, Loadout } from '../sim/kit';
import { defaultParams, heroRadius, runParams, type Params } from '../sim/params';
import { OBJECT_RADIUS, type ChainLink, type World } from '../sim/world';
import { RT_RUN_FORCED, rtElitePlates } from './rtRun';

/** A target of a hand route: a start enemy of the arena by its index in the template, or the goblin's lever. */
export type PrologueTarget = { enemy: number } | { object: 'lever' };

/** An action tile of the HUD's bar: the jump (Space), the spin (Q), a consumable (keys 1–4). */
export type PrologueTile = 'jump' | 'spin' | ItemKind;

export interface PrologueRoom {
  /** 1–10 (`PROLOGUE_ROOM_COUNT`). */
  number: number;
  /**
   * The arena id (`prologue-1` … `prologue-6` for the rooms of task 6, `prologue-jump`, `prologue-spin`, `prologue-potion` of
   * task 9, `prologue-shield` of task 13).
   */
  id: string;
  /** The room's name («Тропа»; the screen shows «1/10 · Тропа» — `prologueTitle`). */
  title: string;
  arena: ArenaTemplate;
  /** Existing `Params` keys over `RT_RUN_FORCED` (`prologueParams`). */
  forced: Readonly<Partial<Params>>;
  /** The ghost hand's preferred chain (rooms 1–4 and 8), in order — `prologueRoute` builds the real one from it; null — no hand. */
  route: readonly PrologueTarget[] | null;
  /**
   * The action tiles the room shows and lets the player use (task 9, design 13.10.2026): `'all'` — the whole bar (room 10); a list —
   * only these (room 5 the jump, room 6 the spin, room 7 the potion); empty — no bar (rooms 1–4, 8 and 9). Data for the view: the
   * simulation does not read it (a command for an action left out still acts).
   */
  tiles: 'all' | readonly PrologueTile[];
}

/** Rooms 5–7 (task 9): the body sizes and the hero's walk at their defaults, whatever the panel says (`PROLOGUE_FORCED`). */
const LESSON_BODIES: Readonly<Partial<Params>> = Object.freeze({ bodyRadius: 0.4, heroHitFactor: 0.7, enemyScale: 0.8, touchFactor: 0.8, heroSpeed: 4 });

/** No inflow: rooms 1–9 hold only their start enemies (`maxEnemies` 0 — no newcomer is queued, before or after the goals). */
const NO_INFLOW: Readonly<Partial<Params>> = Object.freeze({ maxEnemies: 0 });

/**
 * Room 9 «Щит» (task 13, design 13.10.2026): no inflow; every touch 1 (`contactDamage` 1, `toughTouch` off — the enemies have
 * HP 1 anyway); the hero's maximum 15 (`heroHp`); the after-chain shield of the run, whatever the panel says — 0.5 s
 * (`chainShield`, the sandbox default the run plays) after a chain of 3+ kills (`chainShieldMinKills`, the run's 3); the
 * invulnerability after a hit 0.5 s by the constant rule (the defaults: the contrast «a chain of 1–2 → −1» stays visible);
 * «Щит фокуса» from the 3rd link (`focusGuardLinks`, the run's 3: it spares the hero while drawing but lights no lamp); the
 * body sizes, the hero's walk and the enemies' speed at their defaults (`LESSON_BODIES`, `enemySpeed` 1.2 — the touch comes
 * inside the shield's 0.5 s: docs/realtime-onboarding.md, the bot's measure).
 */
const SHIELD_FORCED: Readonly<Partial<Params>> = Object.freeze({
  maxEnemies: 0, ...LESSON_BODIES, contactDamage: 1, toughTouch: false, heroHp: 15, chainShield: 0.5, chainShieldMinKills: 3,
  invulnerability: 0.5, invulnerabilityMode: 'constant', focusGuardLinks: 3, enemySpeed: 1.2,
});

/**
 * Баланс (design 12.10.2026; task 9, 13.10.2026): the numbers of each room over the run's (`RT_RUN_FORCED`). Rooms 1–4 — no
 * inflow (their calm is the arena's `calm`). Rooms 5–7 (task 9; review 13.10.2026: the view builds the prologue from the
 * sandbox panel, `loadParams()`, and the run does not force these keys — a panel value must not make a room impossible) play
 * the defaults of what their lesson rests on: the body sizes (`bodyRadius` 0.4, `heroHitFactor` 0.7 — the hero's circle,
 * `heroRadius`; `enemyScale` 0.8, `touchFactor` 0.8 — the enemies' bodies and the touch) and the hero's walk (`heroSpeed` 4).
 * Room 5 «Пропасть» — no inflow, the jump's price 2 and radius 3 (`jumpCost`, `jumpRadius`: the cliff band is 1.6 wide; a
 * price above the energy cap 7 would leave no jump) and the door entered on foot (`doorWalkIn`). Room 6 «Вихрь» — no inflow,
 * the spin's numbers (`spinCost` 3, `spinDamage` 4, `spinRadius` 1.2: the ring stands inside it, every enemy dies of one hit;
 * the body sizes keep the posts off the hero's body, else a return would wait for him to step off). Room 7 «Зелье» — no inflow,
 * the hero's maximum 15 (`heroHp`; the view gives 15/15 anyway; the heal is the run's `itemHeal`). Room 8 «Гоблин» — no inflow, the touch 1 (`contactDamage`, the run's base), 3 pulls and all of them safe
 * (`slotSafePulls` 3 and no «Длинная цепь кормит гоблина» — with it on the last pull is always risky): no bust is possible.
 * Room 9 «Щит» (task 13) — `SHIELD_FORCED` above.
 * Room 10 «Толпа» (softened by design 13.10.2026: the last room of the lesson must not be a wall, a death there is a bad first
 * impression) — the inflow up to 8 (`maxEnemies`, was 12; its pace and phases are the arena's) and every touch 1: the base
 * touch (`contactDamage` 1) and no raised touch of the tough ones (`toughTouch` off — the run's 2 of an enemy with HP ≥ 2;
 * room 10 has no elites). The invulnerability (0.5 s) and the shields stay the run's: the threat stays, so the shields mean
 * something. The rest as on run row 1.
 */
export const PROLOGUE_FORCED: readonly Readonly<Partial<Params>>[] = Object.freeze([
  NO_INFLOW,
  NO_INFLOW,
  NO_INFLOW,
  NO_INFLOW,
  Object.freeze({ maxEnemies: 0, ...LESSON_BODIES, jumpCost: 2, jumpRadius: 3, doorWalkIn: true }),
  Object.freeze({ maxEnemies: 0, ...LESSON_BODIES, spinCost: 3, spinDamage: 4, spinRadius: 1.2 }),
  Object.freeze({ maxEnemies: 0, ...LESSON_BODIES, heroHp: 15 }),
  // `enemySpeed` 0.72 — the run's 1.2 × 0.6 (design answer 12.10.2026: the goal is the lever, the damage is secondary); the
  // enemies sleep until the first press (the arena's `sleepUntilChain`).
  Object.freeze({ maxEnemies: 0, contactDamage: 1, slotPulls: 3, slotSafePulls: 3, slotSafePerLongChain: 0, enemySpeed: 0.72, invulnerability: 3.4 }),
  SHIELD_FORCED,
  Object.freeze({ maxEnemies: 8, contactDamage: 1, toughTouch: false }),
]);

const TITLES = ['Тропа', 'Два цвета', 'Крепкий', 'Радуга', 'Пропасть', 'Вихрь', 'Зелье', 'Гоблин', 'Щит', 'Толпа'] as const;
const enemies = (n: number): PrologueTarget[] => Array.from({ length: n }, (_, i) => ({ enemy: i }));
const ROUTES: readonly (readonly PrologueTarget[] | null)[] = [
  // 1: the arc; 2: the five blue (the reds are left); 3: the weak ones, the tough one last; 4: six blue, the shift, four green;
  // 5–7: no chain to show; 8: the four blue round the goblin (the reds are another colour), the lever last; 9 «Щит»: no fixed
  // route — its hand's chain is `prologueShieldChain` (any 3+ of one colour from where the hero stands).
  enemies(3), enemies(5), enemies(4), enemies(10), null, null, null, [...enemies(6), { object: 'lever' }], null, null,
];
const TILES: readonly ('all' | readonly PrologueTile[])[] = [[], [], [], [], ['jump'], ['spin'], ['healing'], [], [], 'all'];

/** The ten rooms in order. */
export const PROLOGUE_ROOMS: readonly PrologueRoom[] = Object.freeze(PROLOGUE_ARENAS.map((arena, i) => Object.freeze({
  number: i + 1, id: arena.id, title: TITLES[i], arena, forced: PROLOGUE_FORCED[i], route: ROUTES[i], tiles: TILES[i],
})));

/** How many rooms the prologue has (the last one is «Толпа»). */
export const PROLOGUE_ROOM_COUNT = PROLOGUE_ROOMS.length;

/** The room's name on the screen: «N/10 · Название». */
export function prologueTitle(n: number): string { return `${n}/${PROLOGUE_ROOM_COUNT} · ${prologueRoom(n).title}`; }

/** The room `n` (1–10). */
export function prologueRoom(n: number): PrologueRoom {
  const room = PROLOGUE_ROOMS[n - 1];
  if (!room) throw new Error(`no prologue room ${n}`);
  return room;
}

/**
 * The values room `n` plays with: `base` (the panel's, or the defaults) with the run's rules (`runParams` + `RT_RUN_FORCED`)
 * and the room's own numbers on top (`PROLOGUE_FORCED`).
 */
export function prologueParams(n: number, base: Params = defaultParams()): Params {
  return runParams(base, { ...RT_RUN_FORCED, ...prologueRoom(n).forced });
}

/**
 * What room `n` starts with. Room 10 («Толпа») is a battle of run row 1 (`slot` as a run battle of its row; its goblin stands
 * from the start — the arena's own, so it never rolls another — and its elites' plates are the row's): nothing in hand; its start
 * energy is the arena's (`startEnergy`). Room 7 («Зелье», task 9): exactly one healing potion, nothing else. The other rooms: no
 * loadout (room 8's goblin is the arena's own; the start energy of rooms 5 and 6 is the arena's).
 */
export function prologueLoadout(n: number): Loadout | undefined {
  const id = prologueRoom(n).id;
  if (id === 'prologue-potion') return { items: { healing: 1 }, energy: 0, openItems: [], randomElites: false, talismans: [], ward: false };
  return id === 'prologue-6' ? { items: {}, energy: 0, openItems: [], randomElites: false, elitePlates: rtElitePlates(1), slot: true, talismans: [], ward: false } : undefined;
}

/**
 * The ids of the arena's start enemies now, by their index in the template (`World.restore`: every prologue arena keeps them —
 * rooms 1 and 6 with the mode `none`). Empty for an arena without it.
 */
export function startEnemyIds(world: World): number[] {
  return world.restore ? [...world.restore.ids] : [];
}

/** Steps of the hand's search (a deterministic cap: the rooms have at most 10 targets; the preferred order is found at once). */
const ROUTE_BUDGET = 4000;
/** Slack of the hand's link points against the hero's cancel circle (the enemies move a little while the chain is drawn). */
const CANCEL_SLACK = 0.06;

/** Distance from `p` to the segment `a`–`b`. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/**
 * The ghost hand's chain of room `n` in THIS world (review 12.10.2026): built from the targets still on the arena and where the
 * hero stands now, so the commands the hand shows — the press on the first link, the pointer from link to link (`sweep`), the
 * release — draw exactly these links, and `planChain(world, links)` is what the dash will do.
 *
 * A search over the room's targets (its authored order first — at the start it is the authored chain): each next link must be
 * one the drawn chain would take now (`canLink` / `canLinkObject`: colour, R, sight, after no survivor), not under the hero's
 * cancel circle (the pointer there takes nothing), and the pointer's straight way to it must not cross another target the
 * chain would take (the sweep would add it). What it must give:
 * - room 1 (`kills`): any chain — the most kills found;
 * - rooms 2–4 (`chain`, `marked`): a chain that meets the goal (N kills; the marked one killed) — the most kills found;
 * - room 8 (`pull`): enemies, then the lever — the most enemy links found (never the lever alone: that chain works, the hand
 *   does not show it).
 * None — empty (the view shows no hand). Rooms 5–7, 9 and 10 (no route) — always empty (room 9's hand: `prologueShieldChain`). Reads the world only (no random draw); the drawn chain is put
 * back as it was.
 */
export function prologueRoute(world: World, n: number): ChainLink[] {
  const room = prologueRoom(n), goal = room.arena.goal;
  if (!room.route || world.status !== 'playing' || world.move) return [];
  const ids = startEnemyIds(world), g = goblinOf(world), targets: ChainLink[] = [];
  let lever: ChainLink | null = null;
  for (const target of room.route) {
    if ('enemy' in target) {
      const id = ids[target.enemy];
      if (id !== undefined && world.enemies.some(e => e.id === id)) targets.push({ kind: 'enemy', id });
    } else if (g) lever = { kind: 'object', id: g.id };
  }
  const need = goal === 'chain' ? world.arena.killGoal ?? 1 : 1;
  const marked = new Set(world.enemies.filter(e => e.marked).map(e => e.id));
  /** How good a finished chain is (−1 — it does not do what the room needs). */
  const value = (plan: ChainPlan): number => {
    if (goal === 'marked' && !plan.links.some(l => l.link.kind === 'enemy' && l.outcome?.killed && marked.has(l.link.id))) return -1;
    return plan.kills >= need ? plan.kills : -1;
  };
  return searchHandChain(world, targets, goal === 'pull' ? { lever } : { score: value });
}

/**
 * The hand's search (`prologueRoute`, `prologueShieldChain`): a depth-first walk over `targets` in their order, each next link
 * one the drawn chain would take now (`canLink` / `canLinkObject`: colour, R, sight, after no survivor), not under the hero's
 * cancel circle (the pointer there takes nothing), and the pointer's straight way to it must not cross another target the chain
 * would take (the sweep would add it). `score` — how good a finished chain is by its highlight (−1: not what the room needs; the
 * best found wins, the first of equals); `lever` (room 8) — enemies, then the lever, the most enemy links (never the lever
 * alone). Capped by `ROUTE_BUDGET`. Reads the world only (no random draw); the drawn chain is put back as it was.
 */
function searchHandChain(world: World, targets: readonly ChainLink[], how: { score: (plan: ChainPlan) => number } | { lever: ChainLink | null }): ChainLink[] {
  const pull = 'lever' in how, lever = 'lever' in how ? how.lever : null;
  const saved = world.chain, savedClosed = world.chainClosed;
  /** `next` may follow `path` by the commands the hand shows. */
  const fits = (path: ChainLink[], next: ChainLink): boolean => {
    world.chain = path;
    delete world.chainClosed;
    const plan = planChain(world, path, NO_PIERCE);
    const enemy = next.kind === 'enemy' ? world.enemies.find(e => e.id === next.id) : undefined;
    const object = next.kind === 'object' ? world.objects.find(o => o.id === next.id) : undefined;
    if (enemy ? !canLink(world, enemy, plan) : !object || !canLinkObject(world, object, plan)) return false;
    if (!path.length) return true;
    const to = linkPoint(world, next)!, from = linkPoint(world, path[path.length - 1])!;
    if (dist(to, world.hero) <= HERO_CANCEL_RADIUS + CANCEL_SLACK) return false;
    const same = (l: ChainLink, kind: ChainLink['kind'], id: number): boolean => l.kind === kind && l.id === id;
    for (const e of world.enemies) {
      if (same(next, 'enemy', e.id) || path.some(l => same(l, 'enemy', e.id)) || !canLink(world, e, plan)) continue;
      if (segmentDistance(from, to, e) <= enemyArtRadius(world.params, e) * world.params.pickSlack) return false;
    }
    for (const o of world.objects) {
      if (same(next, 'object', o.id) || path.some(l => same(l, 'object', o.id)) || !canLinkObject(world, o, plan)) continue;
      if (segmentDistance(from, to, o) <= OBJECT_RADIUS * 1.3) return false;
    }
    return true;
  };
  /** The finished chain's value by its highlight. */
  const score = (path: ChainLink[]): number => {
    if ('lever' in how) return -1;
    world.chain = path;
    return how.score(planChain(world, path, NO_PIERCE));
  };
  let best: ChainLink[] = [], bestScore = -1, budget = ROUTE_BUDGET;
  const path: ChainLink[] = [];
  /** Depth-first over the targets in the preferred order; true — stop (every target used, or the budget spent). */
  const visit = (): boolean => {
    if (--budget < 0) return true;
    // Room 8 (design answer 12.10.2026): the hand never shows the lever alone — enemies, then the lever.
    if (path.length && (!pull || (lever && fits(path, lever)))) {
      const value = pull ? path.length : score(path);
      if (value > bestScore) { bestScore = value; best = pull ? [...path, lever!] : [...path]; }
      if (path.length === targets.length) return true;
    }
    for (const next of targets) {
      if (path.some(l => l.id === next.id && l.kind === next.kind) || !fits(path, next)) continue;
      path.push(next);
      if (visit()) return true;
      path.pop();
    }
    return false;
  };
  try { visit(); } finally {
    world.chain = saved;
    if (savedClosed) world.chainClosed = savedClosed; else delete world.chainClosed;
  }
  return best;
}

/** The hand's spot: candidates round a target this far from it (inside R ≈ 2.2, outside the hero's cancel circle). */
const SPOT_RING = 1.4;
/** Eight directions round a target (unit vectors; no trigonometry). */
const SPOT_DIRS: readonly Vec[] = [
  { x: -1, y: 0 }, { x: -0.7071, y: -0.7071 }, { x: 0, y: -1 }, { x: 0.7071, y: -0.7071 },
  { x: 1, y: 0 }, { x: 0.7071, y: 0.7071 }, { x: 0, y: 1 }, { x: -0.7071, y: 0.7071 },
];
/** At most this many candidates are tried (nearest to the hero first). */
const SPOT_TRIES = 20;

/**
 * Where the hero should go when the hand has no chain from where he stands (design answer 12.10.2026: the view shows an arrow
 * and a blinking circle there; once he is there, the hand comes). The nearest to the hero of a few candidates — the room's
 * start, and points `SPOT_RING` round the hand's possible first links (the room's targets still on the arena) — that is free
 * ground on the arena (not in an obstacle or water) and from which `prologueRoute` is not empty. None of the first
 * `SPOT_TRIES` (nearest first) — the room's start if the hand has a chain from there (review 12.10.2026: never a spot without
 * one). Null — a room without a route (5–7, 9, 10), the hand has a chain from here already, or no candidate gives one (no arrow;
 * the view asks again in a moment: the enemies of room 8 move, a return comes). Reads the world only: the hero is put at each candidate for the check and put back exactly (no random draw).
 */
export function prologueHandSpot(world: World, n: number): Vec | null {
  const room = prologueRoom(n);
  if (!room.route || world.status !== 'playing' || world.move || prologueRoute(world, n).length) return null;
  const arena = world.arena, r = heroRadius(world.params), hero = world.hero, home = { x: hero.x, y: hero.y };
  const ids = startEnemyIds(world), g = goblinOf(world), points: Vec[] = [{ x: arena.heroStart.x, y: arena.heroStart.y }];
  for (const target of room.route) {
    const at = 'enemy' in target ? world.enemies.find(e => e.id === ids[target.enemy]) : g;
    if (at) for (const d of SPOT_DIRS) points.push({ x: at.x + d.x * SPOT_RING, y: at.y + d.y * SPOT_RING });
  }
  const free = points.filter(p => !blockedAt(p, r, arena) && !inWater(p, arena));
  free.sort((a, b) => dist(a, home) - dist(b, home));
  const start = { x: arena.heroStart.x, y: arena.heroStart.y };
  try {
    for (const p of [...free.slice(0, SPOT_TRIES), start]) {
      hero.x = p.x; hero.y = p.y;
      if (prologueRoute(world, n).length) return p;
    }
  } finally { hero.x = home.x; hero.y = home.y; }
  return null;
}

/** Units between the body and the cliff's edge at the jump's spot, and between the aim and the jump's reach. */
const JUMP_EDGE_GAP = 0.15;

/**
 * Room 5 «Пропасть» (task 9, design 13.10.2026): where the hand of the jump points. `spot` — where to stand: on the near bank at
 * the cliff's edge, level with the door; `target` — the click of the jump from there: a point on the far bank within the jump's
 * radius of the spot, where `jumpLanding` lands (the view's arrow goes to `spot`, the hand clicks `target` with the jump on).
 * `ready` — a jump towards `target` from where the hero stands now starts and lands on the far bank (the hand may click now);
 * false — walk to `spot` first (or the energy has not come back yet). Null — another room, the fight is over, a move runs, or the
 * hero is on the far bank already (walk into the door). Reads the world only (no random draw).
 */
export function prologueJumpAim(world: World, n: number): { spot: Vec; target: Vec; ready: boolean } | null {
  const room = prologueRoom(n);
  if (room.id !== 'prologue-jump' || world.status !== 'playing' || world.move) return null;
  const hero = world.hero, r = heroRadius(world.params), door = world.arena.door;
  if (hero.x > PROLOGUE_CLIFF.far) return null;
  // The spot: a little short of the edge (the walk stops the body at it); the target: past the far edge, inside the jump's reach.
  const spot = { x: PROLOGUE_CLIFF.near - r - JUMP_EDGE_GAP, y: door.y };
  const target = { x: Math.min(spot.x + world.params.jumpRadius - JUMP_EDGE_GAP, PROLOGUE_CLIFF.far + r + 0.6), y: door.y };
  const landing = jumpLanding(world, target);
  const ready = canJump(world) && !!landing && landing.x - r > PROLOGUE_CLIFF.far;
  return { spot, target, ready };
}

/**
 * Room 6 «Вихрь» (task 9, design 13.10.2026): a spin now would meet the goal — it can be used (energy, no move) and the start
 * enemies in its circle that one hit kills are as many as the goal (all six). The view lights the Q tile and its hint by it.
 * False — not yet (the energy or the return is to come, or the hero walked off the middle). Reads the world only.
 */
export function prologueSpinReady(world: World, n: number): boolean {
  const room = prologueRoom(n);
  if (room.id !== 'prologue-spin' || !canSpin(world)) return false;
  const need = room.arena.killGoal ?? 1, ids = new Set(startEnemyIds(world));
  return spinTargets(world).filter(e => ids.has(e.id) && e.hp <= world.params.spinDamage).length >= need;
}

/** Room 9 «Щит» (task 13): the fewest kills of the hand's chain — the run's `chainShieldMinKills` (3) gives the shield from it. */
const SHIELD_CHAIN_KILLS = 3;

/**
 * Room 9 «Щит» (task 13, design 13.10.2026): the links of a chain the ghost hand may show now — one the commands draw from where
 * the hero stands (the press on the first link, the pointer from link to link, the release: the search of `prologueRoute`)
 * whose highlight (`planChain`, the dash it will do) kills at least `chainShieldMinKills` (at least 3), so the after-chain
 * shield follows it. The most kills found; of equals the first found, the start enemies nearest the hero tried first. Null —
 * another room, the goal met, the fight over, a move runs, or no such chain from here (the crowd moves: ask again). Reads the
 * world only (no random draw); the drawn chain is put back as it was.
 */
export function prologueShieldLinks(world: World): ChainLink[] | null {
  if (world.arena.goal !== 'shield' || world.status !== 'playing' || world.stage !== 'goals' || world.move) return null;
  const hero = world.hero, need = Math.max(SHIELD_CHAIN_KILLS, world.params.chainShieldMinKills);
  const ids = new Set(startEnemyIds(world));
  const targets: ChainLink[] = world.enemies.filter(e => ids.has(e.id))
    .sort((a, b) => dist(a, hero) - dist(b, hero) || a.id - b.id)
    .map(e => ({ kind: 'enemy' as const, id: e.id }));
  const links = searchHandChain(world, targets, { score: plan => plan.kills >= need ? plan.kills : -1 });
  return links.length ? links : null;
}

/**
 * Room 9 «Щит»: the points of the hand's chain (`prologueShieldLinks`: 3+ kills of one colour from the hero, by the commands) —
 * the press on the first, then each next link's point; null — no such chain now. Reads the world only.
 */
export function prologueShieldChain(world: World): Vec[] | null {
  const links = prologueShieldLinks(world);
  return links ? links.map(l => linkPoint(world, l)!) : null;
}
