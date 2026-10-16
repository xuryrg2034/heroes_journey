/**
 * Task 38 «Гарнизон, шаг 1» (design 15.10.2026, docs/design-notes/task-38-garrison-step1.md, 2.2 and 2.4; the rules —
 * docs/realtime-elite-behaviors.md, «Гарнизон»): the enemies of the garrison — the guard, the dog handler and its hound — and the
 * Castellan v0, the garrison's boss on the Jailer's frame. The tethers are the law of tethers.ts (`Params.tethers`).
 *
 * **Стражник** (`guard`): slow; touches as a plain enemy; its HP is the tough roll. With `Params.guardFormation` the guards of one
 * formation (`vars.fm`: 3 of one colour — `NewcomerShare.group`, `StartEnemy.formation`) walk in a line across their way to the
 * hero, `GUARD_STEP` apart: the group step finds the formation's centre and its way to the hero and gives each guard its place on
 * the line (by its side of the way); a guard walks to its place moved ahead. A formation of one, a guard without sight of its place,
 * or a formation within `FORMATION_BREAK` of the hero — the common walk. Without the key — a plain slow enemy.
 *
 * **Псарь** (`handler`): slow, HP 1; keeps `HANDLER_NEAR`…`HANDLER_FAR` from the hero (backs off when closer, walks up when farther).
 * The group step gives it its hounds once (`vars.pk`): `HANDLER_HOUNDS` (an elite — `ELITE_HANDLER_HOUNDS`) at its side, their
 * colours from the palette by the stream `behavior:hound`, each on a leash (`addTether`, only with the law on). Its death frees them.
 *
 * **Пёс** (`hound`): fast, HP 0. On a leash it runs at the hero within `leashLength` of its holder and bites by its touch. Loose (the
 * leash cut, the holder dead: tethers.ts `vars.loose`) — once no dash runs, `houndFrenzy` s of frenzy (`vars.fz`): it runs at the
 * nearest body (an enemy, or the hero) and bites an enemy it touches for `houndFrenzyDamage` (`damageEnemy`: an armoured elite loses a
 * plate) once each `HOUND_BITE_GAP` s — not the player's kills (no score, kills, bag, chain shield); the hero — by its touch. The
 * frenzy does not bite while a dash runs (the highlight stays what the dash does). Then a plain hound: it walks at the hero.
 *
 * **Кастелян v0** (`castellan`, only with `Params.bossFrame`: the arena «Двор кастеляна» turns it on, as «Тюремщик»): the core stands
 * in place, colourless (`jailerColorless`), HP `CASTELLAN_HP`, `CASTELLAN_PLATES` boss plates; its death ends the fight
 * (`bossClears`). The group step gives it the hounds of the arena (its parts, on its leashes) once. Its moves:
 * - «Спустить пса» (`lunge`): a leashed hound winds up `LUNGE_WINDUP` s (the first in the fight ×`FIRST_WINDUP_FACTOR`) for a lane of
 *   `LUNGE_LENGTH` × `LUNGE_WIDTH` from it to the hero (fixed at the start); the hit — −`LUNGE_DAMAGE` to the hero whose body touches
 *   the lane; the hound lands at the lane's end and its leash brings it back. The hounds take turns.
 * - «Караул!» (`guard`, phase 2: the first part lost — a hound killed or its leash cut — or `CASTELLAN_PHASE2_TIME` s): every
 *   `GUARD_CALL_PERIOD` s three guard markers of one colour, a formation, at the gate farthest from the hero.
 * A leash cut by the dash and a hound killed — each takes a plate off the core after the dash (the frame's rule of a severed part).
 *
 * **Ключник** (`keymaster`, task 40 «Гарнизон, шаг 1б», design 16.10.2026, docs/design-notes/task-40-garrison-step1b.md, 2): slow,
 * HP 1, touches as a plain enemy; keeps `KEYMASTER_NEAR`…`KEYMASTER_FAR` from the hero. With `Params.shackles` (and the law of
 * tethers) it shackles the nearest enemy within `shackleRange` every `shacklePeriod` s — the first `SHACKLE_FIRST` s after it
 * appears, at most `shackleMax` prisoners at once; not while a dash runs (the state changes after the dash). A target: a plain
 * enemy, a guard, a dog handler — not an elite, a boss's part, a hound, another keymaster, a body held already, a link of the drawn
 * chain. A cut of its shackle by the dash — its next shackle `shacklePeriod` s later. Its death drops its shackles after the move
 * (tethers.ts `dropTethers`, `settleTethers`).
 * Numbers are hypotheses of the design; the tests check the rules.
 */
import { dhypot } from '../detMath';
import { dropArmorLoot } from '../elites';
import { dist, lineOfSight, pushOutOfCliffs, pushOutOfObstacles, type Vec } from '../geometry';
import { heroRadius } from '../params';
import { palette, spawnEnemy } from '../spawn';
import { addTether, dropTethers, tetherOf, tethersHeldBy, tethersOn } from '../tethers';
import { canBeHurt, damageEnemy, enemyFrozen, enemyGroundFactor, enemySpeed, hurtHero, noteBlock, touchDistanceOf, type Enemy, type World } from '../world';
import { bossClear, bossClearsOn } from './jailer';
import { bodyRadiusOf, kindOf, registerBehavior, registerEnemyKind } from './kinds';

export const GUARD = 'guard';
export const HANDLER = 'handler';
export const HOUND = 'hound';
export const CASTELLAN = 'castellan';
export const KEYMASTER = 'keymaster';

// ---- Баланс (гипотезы спеки задачи 38, 15.10.2026; тесты проверяют правила, не числа) ----
/** The guards' line: their places this far apart (units). */
export const GUARD_STEP = 0.9;
/** A guard goes for a point this far ahead of its place on the line. */
const GUARD_AHEAD = 1;
/** A guard ahead of its line by `a` walks ×(1 − `GUARD_WAIT` · a), at least ×`GUARD_WAIT_MIN`: the line levels out. */
const GUARD_WAIT = 1.5, GUARD_WAIT_MIN = 0.2;
/** A formation whose centre is this close to the hero breaks up: the common walk. */
export const FORMATION_BREAK = 2;
/** The size of a guards' formation (the arenas' `NewcomerShare.group`, the Castellan's «Караул!»). */
export const GUARD_FORMATION = 3;
export const HANDLER_HP = 1;
/** The handler keeps this far from the hero (backs off closer than NEAR, walks up farther than FAR). */
export const HANDLER_NEAR = 3;
export const HANDLER_FAR = 4;
export const HANDLER_HOUNDS = 2;
export const ELITE_HANDLER_HOUNDS = 3;
/** Where the hounds stand at the handler when it gets them (units from its centre). */
const PACK_RADIUS = 0.8;
/** A frenzied hound bites an enemy at most once each this many game seconds. */
export const HOUND_BITE_GAP = 0.5;
/** The defaults of the hound's numbers (journals without the keys). */
export const LEASH_LENGTH = 3;
export const HOUND_FRENZY = 6;
export const HOUND_FRENZY_DAMAGE = 1;
export const CASTELLAN_HP = 4;
export const CASTELLAN_PLATES = 4;
export const LUNGE_LENGTH = 4;
export const LUNGE_WIDTH = 0.8;
export const LUNGE_WINDUP = 0.8;
export const FIRST_WINDUP_FACTOR = 1.5;
export const LUNGE_DAMAGE = 1;
/** The lunge may begin while the hero's centre is within the lane's length of the hound (and its body's radius). */
const LUNGE_REACH = LUNGE_LENGTH;
export const CASTELLAN_PHASE2_TIME = 35;
export const GUARD_CALL_PERIOD = 20;
export const CASTELLAN_MOVE_GAP = 1.5;
export const CASTELLAN_FIRST_MOVE = 2;

const TIME_EPS = 1e-9;
const HOUND_STREAM = 'behavior:hound';

const leashOf = (world: World): number => Math.max(0.5, world.params.leashLength ?? LEASH_LENGTH);
const frenzyOf = (world: World): number => Math.max(0, world.params.houndFrenzy ?? HOUND_FRENZY);
const biteOf = (world: World): number => Math.max(0, world.params.houndFrenzyDamage ?? HOUND_FRENZY_DAMAGE);
const frameOn = (world: World): boolean => !!world.params.bossFrame;
const enemyById = (world: World, id: number): Enemy | undefined => world.enemies.find(e => e.id === id);

/**
 * Moves `e` towards `to` by at most `step` (stopping `stop` short of it), off walls, trees and cliffs. The walk's ground factor
 * (water) applies to `step` given by the caller.
 */
function walkTo(world: World, e: Enemy, to: Vec, step: number, stop = 0): void {
  const dx = to.x - e.x, dy = to.y - e.y, d = dhypot(dx, dy), go = Math.min(step, Math.max(0, d - stop));
  if (go <= 1e-9 || d < 1e-9) return;
  e.x += dx / d * go; e.y += dy / d * go;
  const r = bodyRadiusOf(world.params, e);
  pushOutOfObstacles(e, r, world.arena);
  if (world.arena.terrain) pushOutOfCliffs(e, r, world.arena);
}
/** The walk of `e` this step: its speed × the ground × `dt`. */
const walkStep = (world: World, e: Enemy, dt: number): number => enemySpeed(world, e) * enemyGroundFactor(world, e) * dt;

// ---------- Стражник ----------

/** The group step of the guards: each formation of 2+ gives its members their places on the line across the way to the hero. */
function formLines(world: World, members: readonly Enemy[]): void {
  const lines = new Map<number, Enemy[]>();
  for (const e of members) {
    delete e.vars.ox; delete e.vars.oy; delete e.vars.oa;
    if (e.vars.fm === undefined || enemyFrozen(e)) continue;
    const line = lines.get(e.vars.fm);
    if (line) line.push(e); else lines.set(e.vars.fm, [e]);
  }
  const hero = world.hero;
  for (const line of lines.values()) {
    if (line.length < 2) continue;
    let cx = 0, cy = 0;
    for (const e of line) { cx += e.x; cy += e.y; }
    cx /= line.length; cy /= line.length;
    const dx = hero.x - cx, dy = hero.y - cy, d = dhypot(dx, dy);
    if (d <= FORMATION_BREAK) continue;
    const ux = dx / d, uy = dy / d, px = -uy, py = ux;
    // Places by the side of the way each stands on now (ties — by id): the line keeps its order.
    const order = [...line].sort((a, b) => ((a.x - cx) * px + (a.y - cy) * py) - ((b.x - cx) * px + (b.y - cy) * py) || a.id - b.id);
    order.forEach((e, k) => {
      const off = (k - (order.length - 1) / 2) * GUARD_STEP;
      e.vars.ox = cx + px * off + ux * GUARD_AHEAD; e.vars.oy = cy + py * off + uy * GUARD_AHEAD;
      // A guard ahead of the line waits for it (its walk slows by how far ahead it is); one behind walks at its pace.
      e.vars.oa = (e.x - cx) * ux + (e.y - cy) * uy;
    });
  }
}

registerBehavior({
  id: GUARD,
  beforeStep(world, members) {
    if (world.params.guardFormation) formLines(world, members);
  },
  step(world, e, dt) {
    if (!world.params.guardFormation || e.vars.ox === undefined || e.knock > 0) return false;
    const to = { x: e.vars.ox, y: e.vars.oy };
    if (!lineOfSight(e, to, world.arena, bodyRadiusOf(world.params, e) * 0.9, true)) return false;
    if (dist(e, world.hero) <= touchDistanceOf(world.params, e) + 0.01) return true;
    const pace = Math.max(GUARD_WAIT_MIN, Math.min(1, 1 - (e.vars.oa ?? 0) * GUARD_WAIT));
    walkTo(world, e, to, walkStep(world, e, dt) * pace);
    return true;
  },
});

registerEnemyKind({
  id: GUARD, behavior: GUARD, speedClass: 'slow', hp: () => null, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: GUARD,
});

// ---------- Псарь и пёс ----------

/** The hounds of `holder` (`count` of them) appear at its side; each on its leash (with the law on). */
function makePack(world: World, holder: Enemy, count: number, hp = 0): Enemy[] {
  const colors = palette(world), rng = world.rng.stream(HOUND_STREAM), pack: Enemy[] = [];
  for (let k = 0; k < count; k++) {
    // The hounds stand behind the holder, fanned out away from the hero.
    const away = { x: holder.x - world.hero.x, y: holder.y - world.hero.y }, d = dhypot(away.x, away.y) || 1;
    const ux = away.x / d, uy = away.y / d, side = (k - (count - 1) / 2) * PACK_RADIUS;
    const at = { x: holder.x + ux * PACK_RADIUS * 0.5 - uy * side, y: holder.y + uy * PACK_RADIUS * 0.5 + ux * side };
    const hound = spawnEnemy(world, at, colors[Math.floor(rng.next() * colors.length)], hp, HOUND);
    pushOutOfObstacles(hound, bodyRadiusOf(world.params, hound), world.arena);
    hound.vars.ow = holder.id;
    addTether(world, holder, hound);
    pack.push(hound);
  }
  return pack;
}

registerBehavior({
  id: HANDLER,
  beforeStep(world, members) {
    for (const e of members) {
      if (e.vars.pk || !world.enemies.includes(e)) continue;
      e.vars.pk = 1;
      makePack(world, e, e.elite ? ELITE_HANDLER_HOUNDS : HANDLER_HOUNDS);
    }
  },
  step(world, e, dt) {
    if (e.knock > 0) return false;
    const hero = world.hero, d = dist(e, hero);
    if (d > HANDLER_FAR) return false;
    if (d >= HANDLER_NEAR) return true;
    // Too close: it backs off from the hero (off walls, trees and cliffs).
    const away = { x: e.x + (e.x - hero.x) / Math.max(d, 1e-6), y: e.y + (e.y - hero.y) / Math.max(d, 1e-6) };
    walkTo(world, e, away, walkStep(world, e, dt));
    return true;
  },
  onDeath(world, e) { dropTethers(world, e); },
});

registerEnemyKind({
  id: HANDLER, behavior: HANDLER, speedClass: 'slow', hp: () => HANDLER_HP, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: HANDLER,
});

/** The hound is in its frenzy now. */
export const houndFrenzied = (e: Enemy): boolean => e.kind === HOUND && (e.vars.fz ?? 0) > 0;

/** A body the frenzied hound `e` goes for: not itself, not an immune kind (the reaper), not its own boss's body. */
function preyOf(e: Enemy, other: Enemy): boolean {
  if (other === e || kindOf(other).immune) return false;
  if (e.partOf !== undefined && (other.id === e.partOf || other.partOf === e.partOf)) return false;
  return true;
}

/** The nearest body for the frenzied hound: an enemy it may bite, or the hero (the first of equals: the hero). */
function nearestPrey(world: World, e: Enemy): { enemy: Enemy | null; at: Vec; d: number } {
  let best: Enemy | null = null, bestD = dist(e, world.hero);
  for (const other of world.enemies) {
    if (!preyOf(e, other)) continue;
    const d = dist(e, other);
    if (d < bestD) { best = other; bestD = d; }
  }
  return { enemy: best, at: best ?? world.hero, d: bestD };
}

/** The bodies of `e` and `other` touch (their body circles meet). */
const bodiesTouch = (world: World, e: Enemy, other: Enemy): boolean =>
  dist(e, other) <= bodyRadiusOf(world.params, e) + bodyRadiusOf(world.params, other) + 0.05;

/** The frenzied hound bites one enemy it touches (the nearest), if its bite is ready; not while a dash runs. */
function frenzyBite(world: World, e: Enemy, dt: number): void {
  e.vars.bt = Math.max(0, (e.vars.bt ?? 0) - dt);
  if (world.move || e.vars.bt > TIME_EPS || biteOf(world) <= 0) return;
  let target: Enemy | null = null, bestD = Infinity;
  for (const other of world.enemies) {
    if (!preyOf(e, other) || !bodiesTouch(world, e, other)) continue;
    const d = dist(e, other);
    if (d < bestD) { target = other; bestD = d; }
  }
  if (!target) return;
  e.vars.bt = HOUND_BITE_GAP;
  world.events.push({ type: 'frenzy', action: 'bite', id: e.id, target: target.id, x: target.x, y: target.y });
  damageEnemy(world, target, biteOf(world), { source: 'hound', credited: false });
}

registerBehavior({
  id: HOUND,
  beforeStep(world, members, dt) {
    for (const e of members) {
      if (!world.enemies.includes(e) || enemyFrozen(e)) continue;
      // Loose (tethers.ts): the frenzy starts once no move of the hero runs (the state changes after the dash).
      if (e.vars.loose && !world.move && !tetherOf(world, e.id)) {
        delete e.vars.loose; delete e.vars.mv;
        const frenzy = frenzyOf(world);
        if (frenzy > 0) {
          e.vars.fz = frenzy; e.vars.bt = 0;
          world.events.push({ type: 'frenzy', action: 'start', id: e.id, x: e.x, y: e.y });
        }
      }
      if ((e.vars.fz ?? 0) <= 0) continue;
      frenzyBite(world, e, dt);
      if (!world.enemies.includes(e)) continue;
      e.vars.fz -= dt;
      if (e.vars.fz <= TIME_EPS) {
        delete e.vars.fz; delete e.vars.bt;
        world.events.push({ type: 'frenzy', action: 'end', id: e.id, x: e.x, y: e.y });
      }
    }
  },
  step(world, e, dt) {
    if (e.knock > 0) return false;
    // The Castellan's lunge winds up: the hound stands.
    if (e.vars.mv) return true;
    const p = world.params, hero = world.hero;
    if ((e.vars.fz ?? 0) > 0) {
      const prey = nearestPrey(world, e), stop = prey.enemy ? bodyRadiusOf(p, e) + bodyRadiusOf(p, prey.enemy) : touchDistanceOf(p, e);
      walkTo(world, e, prey.at, walkStep(world, e, dt), stop);
      return true;
    }
    const tether = tethersOn(world) ? tetherOf(world, e.id) : undefined, holder = tether ? enemyById(world, tether.holder) : undefined;
    if (!holder) return false;
    // On the leash: at the hero, but within the leash of its holder (the point of the circle nearest the hero).
    const leash = leashOf(world), hx = hero.x - holder.x, hy = hero.y - holder.y, hd = dhypot(hx, hy);
    const to = hd <= leash ? { x: hero.x, y: hero.y } : { x: holder.x + hx / hd * leash, y: holder.y + hy / hd * leash };
    walkTo(world, e, to, walkStep(world, e, dt), hd <= leash ? touchDistanceOf(p, e) : 0);
    return true;
  },
  onDeath(world, e, cause) {
    dropTethers(world, e);
    // A part of the Castellan (one of his hounds): the core loses a plate after the dash (the frame's rule of a severed part).
    if (e.partOf === undefined || !frameOn(world)) return;
    const core = enemyById(world, e.partOf);
    if (!core) return;
    core.vars.sever = (core.vars.sever ?? 0) + 1;
    world.events.push({ type: 'partSevered', id: e.id, x: e.x, y: e.y });
    if (world.params.bossPartLoot && cause.credited) dropArmorLoot(world, e);
  },
});

registerEnemyKind({
  id: HOUND, behavior: HOUND, speedClass: 'fast', hp: () => 0, speed: world => world.pressure.enemySpeed * world.params.speedFast,
  bodyScale: 0.85, artScale: 0.85, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: HOUND,
});

// ---------- Кастелян v0 ----------

/** The core's hounds (its parts) on the arena. */
const houndsOf = (world: World, core: Enemy): Enemy[] => world.enemies.filter(e => e.partOf === core.id && e.kind === HOUND);

/** The gate of the arena farthest from the hero (the first of equals); null — none. */
function farGate(world: World): Vec | null {
  let best: Vec | null = null, bestD = -1;
  for (const g of world.arena.gates ?? []) { const d = dist(g, world.hero); if (d > bestD) { best = g; bestD = d; } }
  return best;
}

/** The lane of a lunge: from the hound's spot to the point `LUNGE_LENGTH` towards the hero (fixed at the windup's start). */
export function castellanLane(core: Enemy): { from: Vec; to: Vec; width: number } | null {
  const v = core.vars;
  if (!v.mv) return null;
  return { from: { x: v.ax, y: v.ay }, to: { x: v.bx, y: v.by }, width: LUNGE_WIDTH };
}

/** The distance from `p` to the segment `a → b`. */
function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dhypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** After the dash: lost parts and cut leashes take plates off the core; the phase. */
function settle(world: World, core: Enemy): void {
  const v = core.vars;
  if (v.sever) {
    const n = v.sever, a = core.armor;
    delete v.sever;
    v.lost = (v.lost ?? 0) + n;
    if (a && a.plates > 0) {
      a.plates = Math.max(0, a.plates - n);
      world.events.push({ type: 'bossPlate', id: core.id, plates: a.plates });
    }
  }
  if (v.phase !== 2 && ((v.lost ?? 0) > 0 || world.time - (v.born ?? 0) >= CASTELLAN_PHASE2_TIME - TIME_EPS)) {
    v.phase = 2;
    v.wt = 0;
    world.events.push({ type: 'bossPhase', id: core.id, phase: 2 });
  }
}

/** «Караул!»: three guard markers of one colour, a formation, at the gate farthest from the hero, across the way to him. */
function callGuards(world: World, core: Enemy, gate: Vec): void {
  const delay = world.params.markerDelay, colors = palette(world);
  const color = colors[Math.floor(world.rng.stream('behavior:castellan').next() * colors.length)];
  const dx = world.hero.x - gate.x, dy = world.hero.y - gate.y, d = dhypot(dx, dy) || 1, px = -dy / d, py = dx / d;
  const formation = world.nextId++;
  for (let k = 0; k < GUARD_FORMATION; k++) {
    const off = (k - (GUARD_FORMATION - 1) / 2) * GUARD_STEP;
    world.markers.push({ id: world.nextId++, kind: GUARD, x: gate.x + px * off, y: gate.y + py * off, color, hp: 0, timeLeft: delay, total: delay, plain: true, formation });
  }
  core.vars.wt = GUARD_CALL_PERIOD;
  world.events.push({ type: 'castellanMove', id: core.id, move: 'guard', stage: 'hit' });
}

/** The hound of the lunge in windup (on the arena and still on the leash), or undefined. */
function lungeHound(world: World, core: Enemy): Enemy | undefined {
  const hound = core.vars.mh !== undefined ? enemyById(world, core.vars.mh) : undefined;
  return hound && tetherOf(world, hound.id)?.holder === core.id ? hound : undefined;
}

function endLunge(world: World, core: Enemy): void {
  const v = core.vars, hound = v.mh !== undefined ? enemyById(world, v.mh) : undefined;
  if (hound) delete hound.vars.mv;
  delete v.mv; delete v.mh; delete v.t; delete v.w; delete v.ax; delete v.ay; delete v.bx; delete v.by;
  v.cd = CASTELLAN_MOVE_GAP;
}

/** «Спустить пса» strikes: the hero whose body touches the lane; the hound lands at its end (the leash brings it back). */
function lungeHit(world: World, core: Enemy, hound: Enemy): void {
  const v = core.vars, from = { x: v.ax, y: v.ay }, to = { x: v.bx, y: v.by };
  if (world.status === 'playing' && segmentDistance(from, to, world.hero) <= LUNGE_WIDTH / 2 + heroRadius(world.params)) {
    if (canBeHurt(world)) hurtHero(world, hound, LUNGE_DAMAGE, 'lunge');
    else noteBlock(world, hound.x, hound.y, 'lunge', hound.id);
  }
  hound.x = to.x; hound.y = to.y;
  pushOutOfObstacles(hound, bodyRadiusOf(world.params, hound), world.arena);
  world.events.push({ type: 'castellanMove', id: core.id, move: 'lunge', stage: 'hit' });
}

/** The conductor of the core (the group step, before anyone moves). */
function conduct(world: World, core: Enemy, dt: number): void {
  const v = core.vars;
  // Once: the core takes the arena's hounds (its parts, on its leashes) and its plates.
  if (!v.pk) {
    v.pk = 1;
    core.armor = { plates: CASTELLAN_PLATES, max: CASTELLAN_PLATES, boss: true };
    v.born = world.time; v.cd = CASTELLAN_FIRST_MOVE; v.phase = 1;
    for (const hound of world.enemies.filter(e => e.kind === HOUND && e.partOf === undefined && !tetherOf(world, e.id))) {
      hound.partOf = core.id; hound.vars.ow = core.id;
      addTether(world, core, hound);
    }
  }
  if (!world.move) settle(world, core);
  if (world.status !== 'playing' || enemyFrozen(core)) return;
  if (v.phase === 2 && (v.wt ?? 0) > 0) v.wt = Math.max(0, v.wt - dt);
  if (v.mv) {
    const hound = lungeHound(world, core);
    // The hound died or its leash was cut: the lunge winding up is dropped.
    if (!hound) { endLunge(world, core); return; }
    v.t -= dt;
    if (v.t > TIME_EPS) return;
    lungeHit(world, core, hound);
    endLunge(world, core);
    return;
  }
  v.cd = Math.max(0, (v.cd ?? 0) - dt);
  if (v.cd > TIME_EPS) return;
  if (v.phase === 2 && (v.wt ?? 0) <= TIME_EPS) {
    const gate = farGate(world);
    if (gate) { callGuards(world, core, gate); v.cd = CASTELLAN_MOVE_GAP; return; }
    v.wt = GUARD_CALL_PERIOD;
  }
  // The hounds on its leashes take turns (`vars.nh` — the turn); one within reach of the hero starts the lunge.
  const leashed = houndsOf(world, core).filter(h => tetherOf(world, h.id)?.holder === core.id && !enemyFrozen(h));
  if (!leashed.length) return;
  const turn = v.nh ?? 0, hero = world.hero;
  for (let k = 0; k < leashed.length; k++) {
    const hound = leashed[(turn + k) % leashed.length];
    const d = dist(hound, hero);
    if (d > LUNGE_REACH + heroRadius(world.params) || d < 1e-6) continue;
    const first = !v.ul;
    v.ul = 1; v.nh = (turn + k + 1) % leashed.length;
    const windup = LUNGE_WINDUP * (first ? FIRST_WINDUP_FACTOR : 1);
    v.mv = 1; v.mh = hound.id; v.t = windup; v.w = windup;
    v.ax = hound.x; v.ay = hound.y;
    v.bx = hound.x + (hero.x - hound.x) / d * LUNGE_LENGTH; v.by = hound.y + (hero.y - hound.y) / d * LUNGE_LENGTH;
    hound.vars.mv = 1;
    world.events.push({ type: 'castellanMove', id: core.id, move: 'lunge', stage: 'start' });
    return;
  }
}

/**
 * The lunge the Castellan winds up now, for the view (read only): the lane, its width and the share of the windup gone (0…1;
 * it strikes at 1). Null — none, the fight is over, or the frame is off.
 */
export function castellanMove(world: World, core: Enemy): { from: Vec; to: Vec; width: number; progress: number; hound: number } | null {
  if (!frameOn(world) || world.status !== 'playing' || core.kind !== CASTELLAN || !core.vars.mv) return null;
  const v = core.vars;
  return { from: { x: v.ax, y: v.ay }, to: { x: v.bx, y: v.by }, width: LUNGE_WIDTH, progress: Math.max(0, Math.min(1, 1 - v.t / Math.max(1e-6, v.w))), hound: v.mh };
}

registerBehavior({
  id: CASTELLAN,
  step(world, e) {
    // The core stands in its gallery (no walk, no knockback).
    if (!frameOn(world)) return false;
    e.knock = 0;
    return true;
  },
  onTetherCut(world, holder) {
    // A leash cut by the dash: a plate off the core after the dash.
    if (frameOn(world)) holder.vars.sever = (holder.vars.sever ?? 0) + 1;
  },
  onDeath(world, e) {
    dropTethers(world, e);
    if (frameOn(world) && bossClearsOn(world) && !world.bossCleared) bossClear(world);
  },
  beforeStep(world, members, dt) {
    if (!frameOn(world)) return;
    for (const e of members) if (world.enemies.includes(e)) conduct(world, e, dt);
  },
});

registerEnemyKind({
  id: CASTELLAN, behavior: CASTELLAN, speedClass: 'slow', hp: () => CASTELLAN_HP, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: false, chainable: true, hitSource: CASTELLAN,
});

// ---------- Ключник (task 40) ----------

// Баланс (гипотезы спеки задачи 40, 16.10.2026; тесты проверяют правила, не числа).
export const KEYMASTER_HP = 1;
/** The keymaster keeps this far from the hero (backs off closer than NEAR, walks up farther than FAR). */
export const KEYMASTER_NEAR = 4;
export const KEYMASTER_FAR = 5;
/** The first shackle: this many game seconds after the keymaster appears (the player sees it before its first prisoner). */
export const SHACKLE_FIRST = 3;
/** The defaults of the shackles' numbers (journals without the keys). */
export const SHACKLE_PERIOD = 6;
export const SHACKLE_RANGE = 4;
export const SHACKLE_MAX = 2;
/** The kinds a keymaster shackles (design 2: a plain enemy, the guard, the dog handler). */
export const SHACKLE_KINDS: readonly string[] = ['basic', GUARD, HANDLER];

const shacklesOn = (world: World): boolean => !!world.params.shackles && tethersOn(world);
const shacklePeriodOf = (world: World): number => Math.max(0.5, world.params.shacklePeriod ?? SHACKLE_PERIOD);
const shackleRangeOf = (world: World): number => Math.max(0, world.params.shackleRange ?? SHACKLE_RANGE);
const shackleMaxOf = (world: World): number => Math.max(0, Math.floor(world.params.shackleMax ?? SHACKLE_MAX));

/** `e` may be shackled by `keeper` now: its kind, not an elite, not a boss's part, not held, not a link of the drawn chain. */
function shackleable(world: World, keeper: Enemy, e: Enemy): boolean {
  return e !== keeper && SHACKLE_KINDS.includes(e.kind) && !e.elite && e.partOf === undefined && !tetherOf(world, e.id)
    && !world.chain.some(link => link.kind === 'enemy' && link.id === e.id);
}

/** The nearest enemy the keymaster may shackle within its range (the first of equals in the arena's order); null — none. */
function shackleTarget(world: World, keeper: Enemy): Enemy | null {
  const range = shackleRangeOf(world);
  let best: Enemy | null = null, bestD = Infinity;
  for (const e of world.enemies) {
    if (!shackleable(world, keeper, e)) continue;
    const d = dist(keeper, e);
    if (d <= range + TIME_EPS && d < bestD) { best = e; bestD = d; }
  }
  return best;
}

/** The prisoners the keymaster `keeper` holds now. */
export const prisonersOf = (world: World, keeper: Enemy): number => tethersHeldBy(world, keeper.id).filter(t => t.kind === 'shackle').length;

registerBehavior({
  id: KEYMASTER,
  beforeStep(world, members, dt) {
    if (!shacklesOn(world)) return;
    for (const e of members) {
      if (!world.enemies.includes(e) || enemyFrozen(e)) continue;
      // The first group step after it appears: the first shackle in `SHACKLE_FIRST` s.
      e.vars.sc = Math.max(0, (e.vars.sc ?? SHACKLE_FIRST) - dt);
      if (e.vars.sc > TIME_EPS || world.move || world.status !== 'playing' || prisonersOf(world, e) >= shackleMaxOf(world)) continue;
      const target = shackleTarget(world, e);
      if (!target || !addTether(world, e, target, 'shackle')) continue;
      e.vars.sc = shacklePeriodOf(world);
      world.events.push({ type: 'tether', action: 'shackle', holder: e.id, held: target.id, x: target.x, y: target.y, kind: 'shackle' });
    }
  },
  step(world, e, dt) {
    if (e.knock > 0) return false;
    const hero = world.hero, d = dist(e, hero), bank = world.arena.keymasterBank;
    if (d > KEYMASTER_FAR) {
      if (bank === undefined) return false;
      // «Ров»: its own walk straight at the hero, held at its bank (never through a walkway).
      walkTo(world, e, hero, walkStep(world, e, dt), KEYMASTER_FAR);
      e.y = Math.min(e.y, bank);
      return true;
    }
    if (d >= KEYMASTER_NEAR) return true;
    // Too close: it backs off from the hero (off walls, trees and cliffs).
    const away = { x: e.x + (e.x - hero.x) / Math.max(d, 1e-6), y: e.y + (e.y - hero.y) / Math.max(d, 1e-6) };
    walkTo(world, e, away, walkStep(world, e, dt));
    if (bank !== undefined) e.y = Math.min(e.y, bank);
    return true;
  },
  onTetherCut(world, holder) {
    // A shackle cut by the dash: the next one `shacklePeriod` s later.
    if (shacklesOn(world)) holder.vars.sc = Math.max(holder.vars.sc ?? 0, shacklePeriodOf(world));
  },
  onDeath(world, e) { dropTethers(world, e); },
});

registerEnemyKind({
  id: KEYMASTER, behavior: KEYMASTER, speedClass: 'slow', hp: () => KEYMASTER_HP, speed: world => world.pressure.enemySpeed * world.params.speedSlow,
  bodyScale: 1, artScale: 1, touchDamage: world => world.params.contactDamage, mass: () => 1, spread: true, chainable: true, hitSource: KEYMASTER,
});
