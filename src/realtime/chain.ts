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
 */
import { blockedAt, dist, lineOfSight, pushOutOfObstacles, type Vec } from './arena';
import { heroRadius } from './params';
import { NO_COLOR, checkGoals, doorOf, doorOpen, findObject, touchDistance, win, type ArenaObject, type ChainLink, type Enemy, type World } from './world';

/** Energy cap, as in the main game. */
export const ENERGY_MAX = 7;
/** Pointer this close to the hero cancels the drawn chain (units). */
const HERO_CANCEL_RADIUS = 0.42;
/** Radius of a button or the door (units): the pick circle and the jump entry into the door. */
export const OBJECT_RADIUS = 0.45;
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
  return { links: out, endsOnSurvivor, endsOnObject: links.length > 0 && links[links.length - 1].kind === 'object', power, kills };
}

/** Color of the drawn chain: the first enemy link (objects take any color). */
export function chainColor(world: World): number | null {
  for (const link of world.chain) {
    if (link.kind !== 'enemy') continue;
    const e = findEnemy(world, link.id);
    if (e) return e.color;
  }
  return null;
}

/** Where the next link is measured from: the last link, or the hero. */
export function chainAnchor(world: World): Vec {
  for (let i = world.chain.length - 1; i >= 0; i--) {
    const p = linkPoint(world, world.chain[i]);
    if (p) return p;
  }
  return { x: world.hero.x, y: world.hero.y };
}

export function inChain(world: World, enemy: Enemy): number {
  return world.chain.findIndex(l => l.kind === 'enemy' && l.id === enemy.id);
}

/** Within R of the anchor and in sight (toggle): the reach rule shared by enemies and objects. */
function inReach(world: World, target: Vec): boolean {
  const anchor = chainAnchor(world), p = world.params;
  if (dist(anchor, target) > p.linkRadius) return false;
  return !p.lineOfSight || lineOfSight(anchor, target, world.arena, 0);
}

/**
 * Can `enemy` be the next link: same color, within R of the anchor (the hero for the first
 * link — so a chain started by dragging from an empty spot also starts only within R of the
 * hero, design answer 36), in sight (toggle), not taken, not after a survivor or an object.
 */
export function canLink(world: World, enemy: Enemy, plan: ChainPlan = planChain(world)): boolean {
  if (world.status !== 'playing' || world.move) return false;
  if (enemy.color === NO_COLOR || enemy.kind === 'reaper') return false;
  if (inChain(world, enemy) >= 0 || plan.endsOnSurvivor || plan.endsOnObject) return false;
  const color = chainColor(world);
  if (color !== null && enemy.color !== color) return false;
  return inReach(world, enemy);
}

/** Can the object be the next (last) link: an unpressed button or the open door, any color, within R. */
export function canLinkObject(world: World, object: ArenaObject, plan: ChainPlan = planChain(world)): boolean {
  if (world.status !== 'playing' || world.move) return false;
  if (plan.endsOnSurvivor || plan.endsOnObject) return false;
  if (object.kind === 'button' && object.pressed) return false;
  if (object.kind === 'door' && !doorOpen(world)) return false;
  return inReach(world, object);
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

/** Pick radius: the drawn circle with a slack in the player's favour (design answer 27). */
function pickRadius(world: World): number { return world.params.enemyRadius * world.params.pickSlack; }

/** The link under the pointer — an enemy or an object — among those that pass the checks, nearest to the pointer. */
function pick(world: World, p: Vec, acceptEnemy: (e: Enemy) => boolean, acceptObject: (o: ArenaObject) => boolean): ChainLink | null {
  const r = pickRadius(world), ro = OBJECT_RADIUS * world.params.pickSlack;
  let best: ChainLink | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    const d = dist(e, p);
    if (d <= r && d < bestD && acceptEnemy(e)) { best = { kind: 'enemy', id: e.id }; bestD = d; }
  }
  for (const o of world.objects) {
    const d = dist(o, p);
    if (d <= ro && d < bestD && acceptObject(o)) { best = { kind: 'object', id: o.id }; bestD = d; }
  }
  return best;
}

const linkIndex = (world: World, link: ChainLink): number => world.chain.findIndex(l => l.kind === link.kind && l.id === link.id);

/** Press: start a chain on an enemy or an object within R of the hero. Returns true when a chain started. */
export function beginChain(world: World, p: Vec): boolean {
  if (world.status !== 'playing' || world.move) return false;
  world.chain = [];
  const plan = planChain(world);
  const target = pick(world, p, e => canLink(world, e, plan), o => canLinkObject(world, o, plan));
  if (!target) return false;
  world.chain = [target];
  return true;
}

/** Drag: append a valid link, truncate on a selected one, cancel on the hero. */
export function dragChain(world: World, p: Vec): void {
  if (world.status !== 'playing' || world.move) return;
  if (world.chain.length && dist(p, world.hero) <= HERO_CANCEL_RADIUS) { world.chain = []; return; }
  const plan = planChain(world);
  const target = pick(world, p,
    e => inChain(world, e) >= 0 || canLink(world, e, plan),
    o => linkIndex(world, { kind: 'object', id: o.id }) >= 0 || canLinkObject(world, o, plan));
  if (!target) return;
  const index = linkIndex(world, target);
  if (index >= 0) { world.chain.length = index + 1; return; }
  world.chain.push(target);
}

export function cancelChain(world: World): void { world.chain = []; }

/** Release: the hero dashes along the chain. */
export function releaseChain(world: World): boolean {
  const links = world.chain.filter(l => linkPoint(world, l));
  world.chain = [];
  if (!links.length || world.status !== 'playing' || world.move) return false;
  world.move = { kind: 'dash', links, power: 0, stop: { x: world.hero.x, y: world.hero.y }, point: null, speed: world.params.dashSpeed };
  return true;
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
  world.move = { kind: 'jump', links: [], power: 0, stop: land, point: land, speed };
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

function hitEnemy(world: World, enemy: Enemy): void {
  const move = world.move!, p = world.params;
  const outcome = strike(move.power, enemy.hp);
  move.power = outcome.powerAfter;
  world.energy = Math.min(ENERGY_MAX, world.energy + p.energyPerKill);
  enemy.hurtFlash = Math.max(p.hitFlash, 0.01);
  world.events.push({ type: 'chainHit', enemyId: enemy.id, damage: outcome.damage, killed: outcome.killed, x: enemy.x, y: enemy.y });
  if (outcome.killed) {
    move.stop = { x: enemy.x, y: enemy.y };
    world.enemies.splice(world.enemies.indexOf(enemy), 1);
    world.stats.kills++;
    if (enemy.marked) world.stats.markedKills++;
    world.events.push({ type: 'kill', enemyId: enemy.id, x: enemy.x, y: enemy.y, color: enemy.color });
    if (p.focusKillRefill) world.focus = Math.min(p.focusMax, world.focus + p.focusPerKill);
    checkGoals(world);
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
        reachObject(world, object);
        continue;
      }
      const enemy = findEnemy(world, link.id);
      if (!enemy) { move.links.shift(); continue; }
      // A kill takes the enemy's spot; a survivor is struck from the touch distance.
      const survives = !strike(move.power, enemy.hp).killed;
      const reach = survives ? touchDistance(world.params) : 0;
      const arrived = moveHero(world, enemy, budget, reach);
      budget -= dist(before, world.hero);
      if (!arrived) return;
      move.links.shift();
      hitEnemy(world, enemy);
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
 * Hero step before `update` on every substep: focus decides the time scale,
 * then the dash or the jump moves the hero. Focus runs on real seconds.
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
  // Links that left the arena (should not happen in stage 2) drop out of the drawn chain.
  if (world.chain.length) world.chain = world.chain.filter(l => linkPoint(world, l));
  stepMove(world, realDt);
}
