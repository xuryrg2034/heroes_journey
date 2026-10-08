/**
 * Chain, focus, the hero's dash and the jump of the real-time prototype (stage 2,
 * docs/realtime-prototype.md, sections 5–6 and design answers 3, 4, 9, 14, 24, 26, 27).
 *
 * Chain power follows the main game (docs/chain-budget.md): it starts at 0, every enemy
 * adds 1 before its hit, HP removed spend it. A weak enemy (0 HP) dies from any hit.
 * When the power is short, the enemy is wounded and survives; the chain cannot pass a
 * survivor, so such a link can only be the last one. The highlight while drawing and
 * the dash use the same `strike`.
 *
 * Stage 3 (design answer 5): a button or the open door is a link of any color within R of the
 * previous link or the hero; it is always the last link. A button is pressed when the chain
 * ends on it; the chain ending on the open door (or a jump landing on it) wins the arena.
 *
 * Iteration 2, stage C (docs/realtime-prototype.md, section 9г, items 4 and 6): a colour-change
 * crystal falls at every 6th, 12th… kill of one chain (as `mapBattleRules.ts` of the main game);
 * chain juice — combo counter, hit-stop, the finisher slow-motion, chain score with a length
 * multiplier, a rising hit tone (render / audio react to the events here).
 *
 * Stage 1 of the transition: no DOM — the view turns pointer input into journalled commands (simulation.ts) that call
 * `beginChain`, `dragChain`, `dragChainAlong`, `releaseChain`, `cancelChain`, `jump`. The crystal drop point reads the
 * seeded `crystal` stream; `stepHero` takes the real seconds of the tick (`SIM_DT ÷ timeScale`).
 */
import { artRadiusOf, kindOf } from './enemies/kinds';
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from './geometry';
import { heroRadius, type Params } from './params';
import { NO_COLOR, OBJECT_RADIUS, checkGoals, doorOf, doorOpen, findObject, touchDistanceOf, win, type ArenaObject, type ChainLink, type Enemy, type HeroMove, type World } from './world';

export { OBJECT_RADIUS };

/** Energy cap, as in the main game. */
export const ENERGY_MAX = 7;
/** Pointer this close to the hero cancels the drawn chain (units). */
const HERO_CANCEL_RADIUS = 0.42;
/** Jump flight time in real seconds (contact damage is off in flight). */
const JUMP_TIME = 0.18;

export interface StrikeOutcome {
  /** Power before the hit, already +1 for this enemy. */
  available: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
  killed: boolean;
  /** Power carried to the next link. */
  powerAfter: number;
}

/** One chain hit on an enemy with `hp`, carrying `power` from the previous links. */
export function strike(power: number, hp: number): StrikeOutcome {
  const available = power + 1;
  const killed = available >= hp;
  const spent = Math.min(available, hp);
  return { available, damage: available, hpBefore: hp, hpAfter: killed ? 0 : hp - available, killed, powerAfter: available - spent };
}

export interface LinkPlan { link: ChainLink; outcome: StrikeOutcome | null }

export interface ChainPlan {
  links: LinkPlan[];
  /** The last link survives: nothing may follow it. */
  endsOnSurvivor: boolean;
  /** The last link is a button or the door: nothing may follow it. */
  endsOnObject: boolean;
  power: number;
  kills: number;
}

export function findEnemy(world: World, id: number): Enemy | undefined {
  return world.enemies.find(e => e.id === id);
}

/** Position of a link now (enemies keep moving while the chain is drawn; objects stand). */
export function linkPoint(world: World, link: ChainLink): Vec | null {
  if (link.kind === 'enemy') { const e = findEnemy(world, link.id); return e ? { x: e.x, y: e.y } : null; }
  const o = findObject(world, link.id);
  return o ? { x: o.x, y: o.y } : null;
}

/** Highlight of the drawn chain: who dies, who is wounded. Same `strike` as the dash. */
export function planChain(world: World, links: readonly ChainLink[] = world.chain): ChainPlan {
  let power = 0, kills = 0, endsOnSurvivor = false;
  const out: LinkPlan[] = [];
  for (const link of links) {
    const enemy = link.kind === 'enemy' ? findEnemy(world, link.id) : undefined;
    if (!enemy) { out.push({ link, outcome: null }); continue; }
    const outcome = strike(power, enemy.hp);
    power = outcome.powerAfter;
    if (outcome.killed) kills++;
    else endsOnSurvivor = true;
    out.push({ link, outcome });
  }
  const last = links[links.length - 1];
  const endsOnObject = !!last && last.kind === 'object' && !isCrystal(world, last);
  return { links: out, endsOnSurvivor, endsOnObject, power, kills };
}

/** A crystal link (stage C): any color, anywhere in the chain; the chain goes on after it. */
export function isCrystal(world: World, link: ChainLink): boolean {
  return link.kind === 'object' && findObject(world, link.id)?.kind === 'crystal';
}

/**
 * Color of the drawn chain: the first enemy link after the last crystal (a crystal changes the color:
 * the next enemy sets the new one). Null — any color (no enemy yet, or a crystal is the last link).
 */
export function chainColor(world: World): number | null {
  let color: number | null = null;
  for (const link of world.chain) {
    if (isCrystal(world, link)) { color = null; continue; }
    if (link.kind !== 'enemy' || color !== null) continue;
    const e = findEnemy(world, link.id);
    if (e) color = e.color;
  }
  return color;
}

/** Score of a finished chain with `kills` kills: per kill × K × (1 + bonus × K), or flat per kill with the toggle off. */
export function chainScore(params: World['params'], kills: number): number {
  if (kills <= 0) return 0;
  const k = params.chainScoreMultiplier ? 1 + params.scoreLengthBonus * kills : 1;
  return Math.round(params.scorePerKill * kills * k);
}

/** Where the next link is measured from: the last link, or the hero. */
export function chainAnchor(world: World): Vec {
  for (let i = world.chain.length - 1; i >= 0; i--) {
    const p = linkPoint(world, world.chain[i]);
    if (p) return p;
  }
  return { x: world.hero.x, y: world.hero.y };
}

/**
 * Stage G (user 07.10.2026): every point the next link may be taken from. The first link — the hero; then the last
 * link, and with «Якорь у героя» also the hero (second anchor). The dash still runs along the links in order.
 */
export function chainAnchors(world: World): Vec[] {
  const hero = { x: world.hero.x, y: world.hero.y };
  if (!world.chain.length) return [hero];
  const last = chainAnchor(world);
  return world.params.heroAnchor ? [last, hero] : [last];
}

export function inChain(world: World, enemy: Enemy): number {
  return world.chain.findIndex(l => l.kind === 'enemy' && l.id === enemy.id);
}

/**
 * Why a target cannot be the next link (stage G): the checks of `canLink` / `canLinkObject` in their order, and the
 * text the pointer hint shows. One function decides both, so the hint never disagrees with the chain.
 */
export type Refusal = 'move' | 'colorless' | 'inChain' | 'afterSurvivor' | 'afterObject' | 'pressed' | 'closed' | 'color' | 'far' | 'sight';
export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  move: 'идёт проход',
  colorless: 'не берётся цепью',
  inChain: 'уже в цепи',
  afterSurvivor: 'после выжившего',
  afterObject: 'цепь закончена',
  pressed: 'кнопка нажата',
  closed: 'дверь закрыта',
  color: 'не тот цвет',
  far: 'далеко',
  sight: 'нет видимости',
};

/**
 * Within R of an anchor and in sight from that same anchor (toggle): the reach rule shared by enemies and objects.
 * With «R до края тела» R reaches the edge of the target (`edge` — its drawn radius), not its center. With «Якорь у
 * героя» any of the two anchors will do. Sight: a thin ray; obstacles shrink by `sightSlack` so a ray grazing a trunk
 * or a wall corner still sees. Null — reachable; `far` — no anchor is close enough; `sight` — close, but blocked.
 */
function reachRefusal(world: World, target: Vec, edge: number): Refusal | null {
  const p = world.params, reach = p.linkRadius + (p.linkToEdge ? edge : 0);
  let near = false;
  for (const anchor of chainAnchors(world)) {
    if (dist(anchor, target) > reach) continue;
    near = true;
    if (!p.lineOfSight || lineOfSight(anchor, target, world.arena, -p.sightSlack)) return null;
  }
  return near ? 'sight' : 'far';
}

/**
 * Why `enemy` cannot be the next link: same color, within R of an anchor (the hero for the first link — so a chain
 * started by dragging from an empty spot also starts only within R of the hero, design answer 36), in sight (toggle),
 * not taken, not after a survivor or an object. Null — it can.
 */
export function enemyRefusal(world: World, enemy: Enemy, plan: ChainPlan = planChain(world)): Refusal | null {
  if (world.status !== 'playing' || world.move) return 'move';
  if (enemy.color === NO_COLOR || !kindOf(enemy).chainable) return 'colorless';
  if (inChain(world, enemy) >= 0) return 'inChain';
  if (plan.endsOnSurvivor) return 'afterSurvivor';
  if (plan.endsOnObject) return 'afterObject';
  const color = chainColor(world);
  if (color !== null && enemy.color !== color) return 'color';
  return reachRefusal(world, enemy, artRadiusOf(world.params, enemy.kind));
}

export function canLink(world: World, enemy: Enemy, plan: ChainPlan = planChain(world)): boolean {
  return enemyRefusal(world, enemy, plan) === null;
}

/**
 * Why the object cannot be the next link: an unpressed button or the open door (then the last link), or a crystal not
 * yet in the chain (stage C: the chain goes on after it); any color, within R (to the edge of its circle) and in sight.
 */
export function objectRefusal(world: World, object: ArenaObject, plan: ChainPlan = planChain(world)): Refusal | null {
  if (world.status !== 'playing' || world.move) return 'move';
  if (linkIndex(world, { kind: 'object', id: object.id }) >= 0) return 'inChain';
  if (plan.endsOnSurvivor) return 'afterSurvivor';
  if (plan.endsOnObject) return 'afterObject';
  if (object.kind === 'button' && object.pressed) return 'pressed';
  if (object.kind === 'door' && !doorOpen(world)) return 'closed';
  return reachRefusal(world, object, OBJECT_RADIUS);
}

export function canLinkObject(world: World, object: ArenaObject, plan: ChainPlan = planChain(world)): boolean {
  return objectRefusal(world, object, plan) === null;
}

/** Valid next links right now (render: outline). */
export function nextCandidates(world: World): Enemy[] {
  const plan = planChain(world);
  return world.enemies.filter(e => canLink(world, e, plan));
}

export function nextObjectCandidates(world: World): ArenaObject[] {
  const plan = planChain(world);
  return world.objects.filter(o => canLinkObject(world, o, plan));
}

/** Pick radius: the drawn circle with a slack in the player's favour (design answer 27); the boar is drawn larger. */
function pickRadius(world: World, e: Enemy): number { return artRadiusOf(world.params, e.kind) * world.params.pickSlack; }

/** The link under the pointer — an enemy or an object — among those that pass the checks, nearest to the pointer. */
function pick(world: World, p: Vec, acceptEnemy: (e: Enemy) => boolean, acceptObject: (o: ArenaObject) => boolean): ChainLink | null {
  // Buttons, the door and crystals keep their press circle of before (× 1.3): only the enemy one grew back to 0.59.
  const ro = OBJECT_RADIUS * 1.3;
  let best: ChainLink | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    const d = dist(e, p);
    if (d <= pickRadius(world, e) && d < bestD && acceptEnemy(e)) { best = { kind: 'enemy', id: e.id }; bestD = d; }
  }
  for (const o of world.objects) {
    const d = dist(o, p);
    if (d <= ro && d < bestD && acceptObject(o)) { best = { kind: 'object', id: o.id }; bestD = d; }
  }
  return best;
}

const linkIndex = (world: World, link: ChainLink): number => world.chain.findIndex(l => l.kind === link.kind && l.id === link.id);

/**
 * Stage E (user 07.10.2026): a new link of the chain — an enemy or a crystal — refreshes focus (to the full reserve, or
 * +focusPerLink). Once per link per chain: truncating and adding the same enemy again gives nothing; a button or the
 * door (the end of the chain) gives nothing. The set resets when a new chain begins.
 */
function refreshFocus(world: World, link: ChainLink): void {
  const p = world.params;
  if (!p.linkRefreshesFocus) return;
  if (link.kind === 'object' && world.objects.find(o => o.id === link.id)?.kind !== 'crystal') return;
  const key = `${link.kind}:${link.id}`;
  if (world.focusRefreshed.has(key)) return;
  world.focusRefreshed.add(key);
  world.focus = p.focusPerLink > 0 ? Math.min(p.focusMax, world.focus + p.focusPerLink) : p.focusMax;
  world.events.push({ type: 'focusRefill' });
}

/** Press: start a chain on an enemy or an object within R of the hero. Returns true when a chain started. */
export function beginChain(world: World, p: Vec): boolean {
  if (world.status !== 'playing' || world.move) return false;
  world.chain = [];
  const plan = planChain(world);
  const target = pick(world, p, e => canLink(world, e, plan), o => canLinkObject(world, o, plan));
  if (!target) return false;
  world.chain = [target];
  // A chain always starts with the full reserve: its first link refreshes focus too.
  world.focusRefreshed = new Set();
  refreshFocus(world, target);
  return true;
}

/** What a drag point may do: `full` — the pointer event itself (append, truncate, cancel on the hero); `sweep` — a point
 * between two pointer events (append only: a quick swipe through the crowd must not cut the chain by accident — design
 * 07.10.2026; the cut and the cancel happen only where the pointer stopped in the frame); `append` —
 * the held still pointer re-checked every frame (only a new link joins: a link drifting under it does not truncate). */
export type DragMode = 'full' | 'sweep' | 'append';

/** Drag: append a valid link, truncate on a selected one, cancel on the hero. */
export function dragChain(world: World, p: Vec, mode: DragMode = 'full'): void {
  if (world.status !== 'playing' || world.move) return;
  // Stage H (user 08.10.2026): the hero is link zero of the step back — with one link the pointer on the hero takes it off
  // (the chain is cancelled); with two or more it does nothing. Its own toggle «отмена наведением на героя» (off) cancels
  // any chain there; the right button and Esc always cancel.
  if (mode === 'full' && world.chain.length && dist(p, world.hero) <= HERO_CANCEL_RADIUS) {
    if (world.params.cancelOnHero || (world.params.chainStepBack && world.chain.length === 1)) world.chain = [];
    return;
  }
  const plan = planChain(world), truncate = mode === 'full';
  const target = pick(world, p,
    e => (truncate && inChain(world, e) >= 0) || canLink(world, e, plan),
    o => (truncate && linkIndex(world, { kind: 'object', id: o.id }) >= 0) || canLinkObject(world, o, plan));
  if (!target) return;
  const index = linkIndex(world, target);
  if (index >= 0) {
    // Stage H: one step back only — the second-to-last link takes the last one off; an older link does nothing (after a
    // crystal the pointer often crosses old links). A link taken off and taken again does not refresh focus (stage E).
    if (!world.params.chainStepBack) world.chain.length = index + 1;
    else if (index === world.chain.length - 2) world.chain.length = index + 1;
    return;
  }
  // A chain begun by dragging from an empty spot is a new chain: its links refresh focus anew (as `beginChain`).
  if (!world.chain.length) world.focusRefreshed = new Set();
  world.chain.push(target);
  refreshFocus(world, target);
}

/**
 * Stage G: a fast drag takes every link under the pointer's path from `from` to `to` (toggle «Протяжка по всему пути
 * мыши»): browsers send one pointer event per frame, and a quick swipe used to jump over an enemy between two events.
 * Points in between only append; only the event point `to` may truncate or cancel on the hero.
 */
export function dragChainAlong(world: World, from: Vec, to: Vec): void {
  const d = dist(from, to), step = 0.15;
  const n = world.params.dragSweep ? Math.min(200, Math.max(1, Math.ceil(d / step))) : 1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    dragChain(world, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 'sweep');
  }
  dragChain(world, to, 'full');
}

/**
 * Stage G: why the enemy or object under the pointer cannot be the next link (the hint at the pointer). Null when the
 * pointer would take or truncate something (the same `pick` as the drag), or when nothing is under it. `held` — the
 * button is down: only then the hint says «идёт проход» during a dash (otherwise nothing is shown while the hero runs).
 */
export function hoverRefusal(world: World, p: Vec, held = false): Refusal | null {
  if (world.status !== 'playing') return null;
  if (world.move && !held) return null;
  const plan = planChain(world);
  if (pick(world, p,
    e => inChain(world, e) >= 0 || canLink(world, e, plan),
    o => linkIndex(world, { kind: 'object', id: o.id }) >= 0 || canLinkObject(world, o, plan))) return null;
  const under = pick(world, p, () => true, () => true);
  if (!under) return null;
  if (under.kind === 'enemy') { const e = findEnemy(world, under.id); return e ? enemyRefusal(world, e, plan) : null; }
  const o = findObject(world, under.id);
  return o ? objectRefusal(world, o, plan) : null;
}

export function cancelChain(world: World): void { world.chain = []; }

/** Release: the hero dashes along the chain. */
export function releaseChain(world: World): boolean {
  const links = world.chain.filter(l => linkPoint(world, l));
  world.chain = [];
  if (!links.length || world.status !== 'playing' || world.move) return false;
  world.move = { ...newMove('dash', { x: world.hero.x, y: world.hero.y }, null, world.params.dashSpeed), links };
  return true;
}

function newMove(kind: HeroMove['kind'], stop: Vec, point: Vec | null, speed: number): HeroMove {
  return { kind, links: [], power: 0, stop, point, speed, kills: 0, hits: 0, dropped: [], broken: 0, crystalScore: 0 };
}

/** Landing point of a jump towards `p`: clamped to the jump radius; null when it lands in an obstacle. */
export function jumpLanding(world: World, p: Vec): Vec | null {
  const hero = world.hero, r = world.params.jumpRadius, d = dist(p, hero);
  const k = d > r ? r / d : 1;
  const land = { x: hero.x + (p.x - hero.x) * k, y: hero.y + (p.y - hero.y) * k };
  return blockedAt(land, heroRadius(world.params), world.arena) ? null : land;
}

export function canJump(world: World): boolean {
  return world.status === 'playing' && !world.move && world.chain.length === 0 && world.energy >= world.params.jumpCost;
}

export function jump(world: World, p: Vec): boolean {
  if (!canJump(world)) return false;
  const land = jumpLanding(world, p);
  if (!land) return false;
  world.energy -= world.params.jumpCost;
  const speed = Math.max(dist(land, world.hero) / JUMP_TIME, 1);
  world.move = newMove('jump', land, land, speed);
  world.events.push({ type: 'jump' });
  return true;
}

/** A jump landing inside the open door enters it (design answer 5: entry by chain or jump). */
function landsInDoor(world: World, p: Vec): boolean {
  const door = doorOf(world);
  return doorOpen(world) && dist(door, p) <= OBJECT_RADIUS + heroRadius(world.params);
}

/** Moves the hero towards `target`; true on arrival. */
function moveHero(world: World, target: Vec, step: number, reach = 0): boolean {
  const hero = world.hero, d = dist(hero, target);
  if (d <= reach + 1e-6) return true;
  const go = Math.min(step, d - reach);
  hero.x += (target.x - hero.x) / d * go; hero.y += (target.y - hero.y) / d * go;
  return d - go <= reach + 1e-6;
}

/** Crystal clearance: not this close to the rest of the chain's path, the hero, other objects. */
const CRYSTAL_CLEARANCE = 0.6;
const CRYSTAL_TRIES = 60;

function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/**
 * A crystal falls at a random point within `crystalDropRadius` of the kill (0 — anywhere on the arena, as the random
 * cell of the main game; design 07.10.2026: near the same crowd, to carry the combo on): off walls
 * and trees (water is fine), at least CRYSTAL_CLEARANCE from the rest of the chain's path (the
 * polyline hero → links ahead), the hero and other objects. Enemies may stand there: the crystal
 * is not a body. No point found — no crystal (rare).
 */
function dropCrystal(world: World, at: Vec): void {
  const move = world.move!, arena = world.arena, radius = world.params.crystalDropRadius;
  const path: Vec[] = [{ x: world.hero.x, y: world.hero.y }];
  for (const l of move.links) { const pt = linkPoint(world, l); if (pt) path.push(pt); }
  const margin = OBJECT_RADIUS, rng = world.rng.stream('crystal');
  for (let i = 0; i < CRYSTAL_TRIES; i++) {
    let p: Vec;
    if (radius > 0) {
      // Uniform in the disc around the kill, kept inside the arena.
      const r = radius * Math.sqrt(rng.next()), a = rng.next() * Math.PI * 2;
      p = { x: Math.min(arena.width - margin, Math.max(margin, at.x + r * Math.cos(a))), y: Math.min(arena.height - margin, Math.max(margin, at.y + r * Math.sin(a))) };
    } else {
      const x = margin + rng.next() * (arena.width - 2 * margin);
      p = { x, y: margin + rng.next() * (arena.height - 2 * margin) };
    }
    if (blockedAt(p, OBJECT_RADIUS * 0.6, arena)) continue;
    if (world.objects.some(o => dist(o, p) < CRYSTAL_CLEARANCE + OBJECT_RADIUS)) continue;
    let near = dist(path[0], p) < CRYSTAL_CLEARANCE;
    for (let k = 1; k < path.length && !near; k++) near = segmentDistance(path[k - 1], path[k], p) < CRYSTAL_CLEARANCE;
    if (near) continue;
    const crystal: ArenaObject = { id: world.nextId++, kind: 'crystal', x: p.x, y: p.y, pressed: false, value: 0, born: world.time };
    world.objects.push(crystal);
    move.dropped.push(crystal.id);
    world.stats.crystals++;
    world.events.push({ type: 'crystal', objectId: crystal.id, x: p.x, y: p.y });
    return;
  }
}

/** Hit-stop after a kill (toggle): 20 ms growing with the chain, up to 40 ms (sliders). */
function hitstopFor(world: World, kills: number): number {
  const p = world.params;
  if (!p.hitstop) return 0;
  return Math.max(0, Math.min(p.hitstopMax, p.hitstopMin + p.hitstopGrowth * (kills - 1)));
}

/** The last enemy hit of a long chain: a short world slow-motion and a flash (toggle; render reacts to the event). */
function maybeFinisher(world: World): void {
  const move = world.move!, p = world.params;
  if (!p.finisher || move.kills < p.finisherLinks || move.links.some(l => l.kind === 'enemy')) return;
  world.slowmo = p.finisherTime;
  world.stats.finishers++;
  world.events.push({ type: 'finisher', kills: move.kills });
}

function hitEnemy(world: World, enemy: Enemy): void {
  const move = world.move!, p = world.params;
  const outcome = strike(move.power, enemy.hp);
  move.power = outcome.powerAfter;
  move.hits++;
  world.energy = Math.min(ENERGY_MAX, world.energy + p.energyPerKill);
  enemy.hurtFlash = Math.max(p.hitFlash, 0.01);
  world.events.push({ type: 'chainHit', enemyId: enemy.id, damage: outcome.damage, killed: outcome.killed, x: enemy.x, y: enemy.y, combo: move.hits });
  if (outcome.killed) {
    move.stop = { x: enemy.x, y: enemy.y };
    world.enemies.splice(world.enemies.indexOf(enemy), 1);
    world.stats.kills++;
    move.kills++;
    if (enemy.marked) world.stats.markedKills++;
    world.events.push({ type: 'kill', enemyId: enemy.id, x: enemy.x, y: enemy.y, color: enemy.color });
    if (p.focusKillRefill) world.focus = Math.min(p.focusMax, world.focus + p.focusPerKill);
    checkGoals(world);
    // A crystal at every N-th kill of this chain (main game: 6th, 12th…), off the rest of its path.
    if (p.crystals && p.crystalEvery > 0 && move.kills % p.crystalEvery === 0) dropCrystal(world, { x: enemy.x, y: enemy.y });
    world.hitstop = Math.max(world.hitstop, hitstopFor(world, move.kills));
    maybeFinisher(world);
    return;
  }
  enemy.hp = outcome.hpAfter;
  if (p.survivorKnockback && p.survivorKnockbackTime > 0) {
    const dx = enemy.x - world.hero.x, dy = enemy.y - world.hero.y, d = Math.hypot(dx, dy) || 1;
    const speed = p.survivorKnockbackDistance / p.survivorKnockbackTime;
    enemy.knock = p.survivorKnockbackTime; enemy.knockVx = dx / d * speed; enemy.knockVy = dy / d * speed;
  }
  // The chain stops on a survivor: the hero goes back to the last freed spot.
  move.links = [];
  move.point = { ...move.stop };
  maybeFinisher(world);
}

/** The dash reaches a crystal: it breaks (score by the chain that dropped it), the hero takes its spot; the chain goes on. */
function breakCrystal(world: World, crystal: ArenaObject): void {
  const move = world.move!, p = world.params;
  const score = Math.round(p.crystalScorePerKill * (crystal.value ?? 0));
  move.stop = { x: crystal.x, y: crystal.y };
  move.broken++;
  move.crystalScore += score;
  world.objects.splice(world.objects.indexOf(crystal), 1);
  world.events.push({ type: 'crystalBreak', objectId: crystal.id, x: crystal.x, y: crystal.y, score, combo: move.hits });
}

/** The chain ended on an object: a button is pressed for good; the open door wins the arena. */
function reachObject(world: World, object: ArenaObject): void {
  const move = world.move!;
  move.stop = { x: object.x, y: object.y };
  move.links = [];
  if (object.kind === 'button') {
    if (object.pressed) return;
    object.pressed = true;
    world.events.push({ type: 'button', objectId: object.id });
    checkGoals(world);
  } else if (doorOpen(world)) {
    win(world);
  }
}

function finishMove(world: World): void {
  const hero = world.hero, move = world.move!;
  hero.x = move.stop.x; hero.y = move.stop.y;
  pushOutOfObstacles(hero, heroRadius(world.params), world.arena);
  world.move = null;
  if (move.kind === 'dash') {
    // Crystals of this chain are worth its final length (main game: crystalChain).
    for (const id of move.dropped) { const c = findObject(world, id); if (c) c.value = move.kills; }
    const score = chainScore(world.params, move.kills) + move.crystalScore;
    world.stats.score += score;
    world.stats.bestChain = Math.max(world.stats.bestChain, move.kills);
    world.lastChain = { kills: move.kills, hits: move.hits, crystals: move.broken, score, time: world.time };
    world.events.push({ type: 'chainEnd', kills: move.kills, score });
    // Stage F (user 07.10.2026): a chain that killed leaves the hero untouchable for a moment to walk out of the crowd;
    // a new one replaces the rest (no stacking); the hurt invulnerability runs on its own, the larger protects.
    const p = world.params;
    if (p.chainShield > 0 && move.kills >= Math.max(1, p.chainShieldMinKills)) hero.chainShield = p.chainShield;
  }
  if (move.kind === 'jump' && landsInDoor(world, hero)) win(world);
}

/** Dash / jump progress in real seconds (the dash ignores focus; contact damage is off). */
function stepMove(world: World, realDt: number): void {
  const move = world.move;
  if (!move) return;
  let budget = move.speed * realDt;
  for (let guard = 0; guard < 64 && budget > 1e-6 && world.move; guard++) {
    const before = { x: world.hero.x, y: world.hero.y };
    if (move.links.length) {
      const link = move.links[0];
      if (link.kind === 'object') {
        const object = findObject(world, link.id);
        if (!object) { move.links.shift(); continue; }
        const arrived = moveHero(world, object, budget);
        budget -= dist(before, world.hero);
        if (!arrived) return;
        if (object.kind === 'crystal') { move.links.shift(); breakCrystal(world, object); continue; }
        reachObject(world, object);
        continue;
      }
      const enemy = findEnemy(world, link.id);
      if (!enemy) { move.links.shift(); continue; }
      // A kill takes the enemy's spot; a survivor is struck from the touch distance.
      const survives = !strike(move.power, enemy.hp).killed;
      const reach = survives ? touchDistanceOf(world.params, enemy) : 0;
      const arrived = moveHero(world, enemy, budget, reach);
      budget -= dist(before, world.hero);
      if (!arrived) return;
      move.links.shift();
      hitEnemy(world, enemy);
      // Hit-stop: the rest of this tick's dash waits with the world (the next ticks are frozen while it lasts).
      if (world.hitstop > 0) break;
      continue;
    }
    if (move.point) {
      const arrived = moveHero(world, move.point, budget);
      budget -= dist(before, world.hero);
      if (!arrived) return;
      move.point = null;
      continue;
    }
    finishMove(world);
  }
  if (world.move && !move.links.length && !move.point) finishMove(world);
}

/**
 * Game seconds per real second of the next tick, from the state before it: focus while a chain is drawn and focus is
 * left (×focusSlow), the finisher slow-motion (×finisherSlow, the smaller wins), otherwise 1. The runner charges a tick
 * `SIM_DT ÷ scale` of real time (simulation.ts) — focus and the slow-motion are fewer ticks per real second, not
 * skipped render frames.
 */
export function tickScale(world: World): number {
  const p: Params = world.params;
  if (world.status !== 'playing') return 1;
  const selecting = world.chain.length > 0 && !world.move;
  let scale = selecting && Math.min(world.focus, p.focusMax) > 0 ? p.focusSlow : 1;
  if (world.slowmo > 0) scale = Math.min(scale, p.finisherSlow);
  return scale;
}

/**
 * Hero step before `update` on every tick: focus decides the time scale (`tickScale`), then the dash or the jump moves
 * the hero. Focus, the dash, the jump and the slow-motion run on real seconds: `realDt` = `SIM_DT ÷ tickScale`.
 */
export function stepHero(world: World, realDt: number): void {
  const p = world.params;
  world.focus = Math.min(world.focus, p.focusMax);
  if (world.status !== 'playing') { world.chain = []; world.focusing = false; world.timeScale = 1; return; }
  const selecting = world.chain.length > 0 && !world.move;
  if (selecting && world.focus > 0) {
    world.focusing = true;
    world.timeScale = p.focusSlow;
    world.focus = Math.max(0, world.focus - realDt);
  } else {
    world.focusing = false;
    world.timeScale = 1;
    // An empty focus leaves the time normal; the chain can still be finished.
    if (!selecting) world.focus = Math.min(p.focusMax, world.focus + p.focusRegen * realDt);
  }
  // Finisher slow-motion (stage C): the world runs slower for a moment after the last hit of a long chain.
  if (world.slowmo > 0) {
    world.slowmo = Math.max(0, world.slowmo - realDt);
    world.timeScale = Math.min(world.timeScale, p.finisherSlow);
  }
  // Links that left the arena (should not happen in stage 2) drop out of the drawn chain.
  if (world.chain.length) world.chain = world.chain.filter(l => linkPoint(world, l));
  stepMove(world, realDt);
}
