/**
 * Elites of the real-time slice (stage 2 of the transition, step 3; docs/realtime-slice.md, section 7) — the modifier of
 * the turn-based game (src/game/elite.ts) over any enemy kind. Numbers — the panel group «Элиты».
 *
 * - **Modifier** (`makeElite`): HP × `eliteHpFactor` (2; a weak enemy, 0 HP, gets 1), art × `eliteArtScale` (1.25 — the
 *   drawing, the link reach edge and the press circle; the body stays), + `eliteDamageBonus` (1) to every hit on the hero
 *   (world.ts `hurtHero`: touch, arrow, charge, its blast, its quills), a gold rim (render). Its kind's behaviour is
 *   unchanged: an elite shieldbearer keeps its shield.
 * - **Loot** (`eliteDeath`, as the turn-based `rollEliteLoot`): an elite killed by the player (`credited`: the chain, the
 *   spin, a consumable, burning, the blast of the player's sapper) — an elite of the template: with `eliteLootChance`
 *   (50%) a consumable open in the run (none open — a resource), otherwise nothing; a random elite: always a crafting
 *   resource. The chance, the kind and the spot read the arena's `loot` stream. It falls
 *   within `eliteLootRadius` of the kill, off walls and trees, other objects and the rest of the dash (as a crystal), and
 *   lies until picked up: by a chain (a link of any colour anywhere in it, as a crystal — no colour change, no power, not
 *   a kill; chain.ts `passObject`) or by the walking hero's touch (`touchLoot`). An elite killed by an enemy's ability (an
 *   arrow, the blast of a sapper lit by touch) drops nothing.
 * - **Start elites**: `StartEnemy.elite` of an arena template (arenas 9–10 of step 4 stand two), the test command
 *   `place {elite}`.
 * - **Random elites** (`rollRandomElite`): a newcomer stepping out of its marker becomes an elite with `eliteChance` (3%)
 *   before the goals and `eliteChanceAfter` (12%) after them, while fewer than `eliteCap` (2) / `eliteCapAfter` (4) elites
 *   live (start elites counted). On in a run from its row 3 (`Kit.randomElites`) and in the sandbox by the toggle
 *   `eliteSandbox`. One draw of the arena's `elite` stream per newcomer that may roll (none at the cap).
 * - **Affixes** (phase A, T4, docs/realtime-phase-a.md, sections 2–3): an elite made by the arena (start, random, the
 *   event's) gets `affixCountOf` affixes — a run by its row (`Kit.eliteAffixes`: rows 1–4 — 0, 5–8 — 1, 9 — 2), the sandbox
 *   by the slider `eliteAffixes` (0 by default). Drawn from the arena's `affix` stream (only when the count is above 0:
 *   worlds without affixes draw nothing). The test command `place {elite}` puts exactly the affixes it names (none — the
 *   slice's elite). An affix replaces only the HP ×2 of the elite; +1 damage, the art ×1.25, the rim and the loot stay.
 *   - «Огненный» (`fiery`): HP ×2; drops a trail point every `trailStep` of its path (radius `trailRadius`, burns
 *     `trailLife`). The hero on foot in it: −`trailHeroDamage` at once, then every `trailInterval` (as thorns: a dash or a
 *     jump ending in it gives a full interval; no elite bonus). An enemy in it: −`trailEnemyDamage`, then a pause of
 *     `trailEnemyPause`; HP never below 0 — the trail never kills, so it credits nobody. Fiery elites do not burn.
 *   - «Хамелеон» (`chameleon`): HP ×2; its colour turns to the next one (c + 1) every `chameleonPeriod`, no randomness; the
 *     last `chameleonWarn` before a turn is the window — the rim blinks the next colour, and a chain of any colour may take
 *     it: it takes the chain's colour (and its period starts again). The timer stands while it is a link of the drawn
 *     chain or of the dash, and while it is frozen.
 *   - «Стремительный» (`swift`): walks ×`swiftSpeed` over its class, HP ×`swiftHp` (1); never on a fast kind.
 *   - «Толстый» (`fat`): HP ×`fatHp` (3), walks ×`fatSpeed`; never on a slow kind; never with «Стремительный».
 *   A weak enemy (0 HP) becomes an elite of 1 HP; with affixes — half the factor, rounded (1; «Толстый» 2).
 * - **Armour** (package «Урон имеет значение», docs/realtime-damage.md; the toggle `eliteArmor`, off by default, on in a
 *   run): an elite made while it is on keeps its kind's HP (×1; a weak one stays at 0) and gets plates (`Enemy.armor`): the
 *   run's by its row (`Kit.elitePlates`), else the panel's `elitePlates`; «Стремительный» −1, «Толстый» +1 (at least 1; the
 *   affixes change no HP then). A hit with plates left takes plates, never HP (`stripPlates` — every source comes here:
 *   the chain through chain.ts, the rest through world.ts `damageEnemy`): 1 plate, the bomb 2; one firing at most once per
 *   elite. 0 plates — the window `eliteWindow`: it stands, does not hit, its mechanic off (world.ts `enemyFrozen`; no
 *   brittleness); then 1 plate at once and +1 every `elitePlateRegrow` up to the maximum; the cold stops the regrowth
 *   (`updateArmor`). Loot always (`armorLoot`); a kill by the player in the window — +1 energy and the loot ×2. Its death —
 *   the event `eliteDown` and, with `hitstop`, a hit-stop of `ELITE_DOWN_HITSTOP`. Its touch — world.ts `touchDamage`.
 */
import { dcos, dhypot, dsin } from './detMath';
import { enemyKind, kindOf } from './enemies/kinds';
import { blockedAt, dist, inWater, overCliff, pushOutOfCliffs, type Vec } from './geometry';
import { heroRadius } from './params';
import { MAX_AFFIXES, MAX_PLATES, RESOURCE_KINDS, emptyKit, type ItemKind, type ResourceKind } from './kit';
import { nextPaletteColor } from './spawn';
import { OBJECT_RADIUS, canBeHurt, enemyFrozen, hurtHero, type ArenaObject, type Enemy, type KillCause, type World } from './world';

/** A weak elite (0 HP) gets this HP. */
const ELITE_WEAK_HP = 1;
/** Loot clearance: not this close to the rest of the dash, the hero, other objects. */
const LOOT_CLEARANCE = 0.6;
const LOOT_TRIES = 40;

// ---------- Armour (package «Урон имеет значение», docs/realtime-damage.md) ----------

/**
 * The armour of an elite (`Enemy.armor`, hashed): plates now and their maximum; `open` — game seconds left of the window (0
 * plates); `clean` — game seconds left of its first `eliteCleanWindow` (a kill then is a clean break; design answer
 * 11.10.2026, variant 3); `regrow` — game seconds to the next plate (after a window, below the maximum); `hit` — the last
 * firing that took a plate (the tick, the source and its firing id), so one firing never takes two.
 */
export interface EliteArmor { plates: number; max: number; open?: number; clean?: number; regrow?: number; hit?: string }

/** Баланс (4.3): plates a hit of this source takes (any other — 1). */
export const PLATES_BY_SOURCE: Readonly<Record<string, number>> = { bomb: 2 };
/** Баланс (4.3): hit-stop of an armoured elite's death (real seconds; only with the `hitstop` toggle). */
export const ELITE_DOWN_HITSTOP = 0.08;
/** Баланс (4.3, «чистый слом»; design answer 11.10.2026): energy for a kill in the first `eliteCleanWindow` of the window; the loot is dropped this many times. */
export const CLEAN_BREAK_ENERGY = 1;
export const CLEAN_BREAK_LOOT = 2;
/** Баланс (4.3, «Награда»): an armoured elite drops one open consumable, or this many resources when none is open. */
export const ARMOR_RESOURCES = 2;
/**
 * Баланс (4.3, «Редкость»): the guaranteed elite's due time is uniform in 0…this many game seconds (the arena's `elite`
 * stream); the first newcomer stepping out at or after it becomes the elite. With groups every 3–5 s and the marker's 1 s
 * it comes inside the first 10 s (4 + 5 + 1); an arena with a slower pace may bring it later.
 */
export const GUARANTEE_DUE_MAX = 4;
/** Energy cap (chain.ts `ENERGY_MAX`; not imported: chain.ts imports this module). */
const ENERGY_CAP = 7;

/** Plates of `e` now (0 — none: not armoured, or open). */
export const platesOf = (e: Enemy): number => e.armor?.plates ?? 0;

/** The armour for the view (null — not an armoured elite): plates, maximum, the window's seconds left, the regrowth's. */
export function eliteArmorView(e: Enemy): { plates: number; max: number; open: number; clean: number; regrow: number } | null {
  const a = e.armor;
  return a ? { plates: a.plates, max: a.max, open: Math.max(0, a.open ?? 0), clean: Math.max(0, a.clean ?? 0), regrow: Math.max(0, a.regrow ?? 0) } : null;
}

/** Plates an armoured elite of this arena starts with before its affixes: the run's (`Kit.elitePlates`), else the panel's. */
function basePlates(world: World): number {
  const n = world.kit?.elitePlates ?? world.params.elitePlates ?? 3;
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_PLATES, Math.floor(n))) : 3;
}

/**
 * A hit of `cause` on an armoured elite with plates: takes 1 plate (the bomb 2), never HP; at 0 the window opens. `guard`
 * (every source but the chain, whose link is struck once a dash): one firing — the same tick, source and firing id — takes
 * plates once. Returns the plates taken.
 */
export function stripPlates(world: World, e: Enemy, cause: { source: string; firing?: number }, guard = true): number {
  const a = e.armor;
  if (!a || a.plates <= 0) return 0;
  e.hurtFlash = Math.max(world.params.hitFlash, 0.01);
  if (guard) {
    const key = `${world.tick}:${cause.source}:${cause.firing ?? ''}`;
    if (a.hit === key) return 0;
    a.hit = key;
  }
  const removed = Math.min(a.plates, Math.max(1, PLATES_BY_SOURCE[cause.source] ?? 1));
  a.plates -= removed;
  world.events.push({ type: 'elitePlates', enemyId: e.id, action: 'strip', plates: a.plates, removed, source: cause.source, x: e.x, y: e.y });
  if (a.plates <= 0) {
    a.plates = 0;
    delete a.regrow;
    a.open = Math.max(0.05, world.params.eliteWindow);
    const clean = Math.min(a.open, Math.max(0, world.params.eliteCleanWindow ?? 0));
    if (clean > 0) a.clean = clean;
    world.events.push({ type: 'elitePlates', enemyId: e.id, action: 'open', plates: 0, x: e.x, y: e.y });
  }
  return removed;
}

/** The armour's step (once per tick, before the touches): the window runs out (1 plate), the plates regrow (not in the cold). */
export function updateArmor(world: World, dt: number): void {
  for (const e of world.enemies) {
    const a = e.armor;
    if (!a) continue;
    if (a.open !== undefined) {
      a.open -= dt;
      if (a.clean !== undefined) { a.clean -= dt; if (a.clean <= 1e-9) delete a.clean; }
      if (a.open > 1e-9) continue;
      delete a.open;
      delete a.clean;
      a.plates = Math.min(a.max, 1);
      world.events.push({ type: 'elitePlates', enemyId: e.id, action: 'close', plates: a.plates, x: e.x, y: e.y });
      if (a.plates < a.max) a.regrow = Math.max(0.05, world.params.elitePlateRegrow);
      continue;
    }
    if (a.regrow === undefined || (e.chill ?? 0) > 0) continue;
    a.regrow -= dt;
    if (a.regrow > 1e-9) continue;
    a.plates = Math.min(a.max, a.plates + 1);
    world.events.push({ type: 'elitePlates', enemyId: e.id, action: 'regrow', plates: a.plates, x: e.x, y: e.y });
    if (a.plates < a.max) a.regrow += Math.max(0.05, world.params.elitePlateRegrow); else delete a.regrow;
  }
}

// ---------- Affixes (phase A, T4) ----------

export type AffixId = 'fiery' | 'chameleon' | 'swift' | 'fat';
/** Every affix, in the canonical order (an elite's `affixes` keep it; the `affix` stream draws among them in it). */
export const AFFIX_IDS: readonly AffixId[] = ['fiery', 'chameleon', 'swift', 'fat'];
/** Player-facing short names (the label under the body, docs/realtime-phase-a.md, section 2). */
export const AFFIX_TITLES: Readonly<Record<AffixId, string>> = { fiery: 'Огненный', chameleon: 'Хамелеон', swift: 'Стремительный', fat: 'Толстый' };
/** Pairs that never come together (design answer 5). */
const INCOMPATIBLE: readonly (readonly [AffixId, AffixId])[] = [['swift', 'fat']];

/** One point of a fire trail: where, game seconds it still burns, the elite that dropped it (the id in the hit event). */
export interface TrailPoint { x: number; y: number; life: number; ownerId: number }

/** The affix may go on an elite of `kind`: «Стремительный» not on a fast kind, «Толстый» not on a slow one (design answer 5). */
export function affixAllowed(kind: string, id: AffixId): boolean {
  const cls = enemyKind(kind).speedClass ?? 'normal';
  return id === 'swift' ? cls !== 'fast' : id === 'fat' ? cls !== 'slow' : true;
}

const compatible = (id: AffixId, chosen: readonly AffixId[]): boolean =>
  !INCOMPATIBLE.some(([a, b]) => (id === a && chosen.includes(b)) || (id === b && chosen.includes(a)));

/** The named affixes an elite of `kind` may have together: known, each once, allowed for the kind, compatible (earlier wins). */
export function legalAffixes(kind: string, ids: readonly string[]): AffixId[] {
  const out: AffixId[] = [];
  for (const id of AFFIX_IDS) if (ids.includes(id) && affixAllowed(kind, id) && compatible(id, out)) out.push(id);
  return out;
}

/** Affixes each elite made by this arena gets: the run's (`Kit.eliteAffixes`), else the sandbox slider (absent — 0). */
export function affixCountOf(world: World): number {
  const n = world.kit?.eliteAffixes ?? world.params.eliteAffixes ?? 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_AFFIXES, Math.floor(n))) : 0;
}

/** Draws `count` affixes for `e` from the arena's `affix` stream (one draw per affix, among those still possible). */
export function rollAffixes(world: World, e: Enemy, count: number): AffixId[] {
  const chosen: AffixId[] = [];
  for (let i = 0; i < count; i++) {
    const pool = AFFIX_IDS.filter(id => !chosen.includes(id) && affixAllowed(e.kind, id) && compatible(id, chosen));
    if (!pool.length) break;
    chosen.push(pool[Math.floor(world.rng.stream('affix').next() * pool.length)]);
  }
  return AFFIX_IDS.filter(id => chosen.includes(id));
}

/** The affixes of an elite (D3, the label under the body): empty — none (an ordinary enemy or the slice's elite). */
export function eliteAffixes(e: Enemy): readonly AffixId[] { return e.affixes ?? []; }

const hasAffix = (e: Enemy, id: AffixId): boolean => !!e.affixes?.includes(id);

/** Walking multiplier of the affixes: «Стремительный» × `swiftSpeed`, «Толстый» × `fatSpeed`. */
export function affixSpeedFactor(world: World, e: Enemy): number {
  const p = world.params;
  return (hasAffix(e, 'swift') ? p.swiftSpeed : 1) * (hasAffix(e, 'fat') ? p.fatSpeed : 1);
}

/**
 * Puts the elite modifier on an enemy (once): HP × factor (a weak one gets 1). Colourless kinds (the reaper) are not elites.
 * `affixes`: `roll` — the arena's count drawn from the `affix` stream (none when the count is 0); a list — exactly those
 * (the test command `place`; none — the slice's elite). «Стремительный» and «Толстый» put their own HP factor instead of ×2.
 */
export function makeElite(world: World, e: Enemy, random = false, affixes: readonly string[] | 'roll' = 'roll'): void {
  if (e.elite || !kindOf(e).chainable || kindOf(e).immune) return;
  e.elite = random ? 'random' : true;
  const p = world.params;
  const ids = affixes === 'roll' ? rollAffixes(world, e, affixCountOf(world)) : legalAffixes(e.kind, affixes);
  if (p.eliteArmor) {
    // The package: plates instead of the HP factor; the HP is the kind's (×1, a weak one stays at 0), the affixes change the plates.
    const max = Math.max(1, Math.min(MAX_PLATES, basePlates(world) + (ids.includes('fat') ? 1 : 0) - (ids.includes('swift') ? 1 : 0)));
    e.armor = { plates: max, max };
  } else {
    const factor = ids.includes('swift') ? p.swiftHp : ids.includes('fat') ? p.fatHp : p.eliteHpFactor;
    e.hp = e.hp > 0 ? Math.round(e.hp * factor) : ids.length ? Math.max(ELITE_WEAK_HP, Math.round(factor / 2)) : ELITE_WEAK_HP;
  }
  if (!ids.length) return;
  e.affixes = ids;
  if (ids.includes('chameleon')) e.chameleon = Math.max(0.05, p.chameleonPeriod);
  if (ids.includes('fiery')) e.trail = { x: e.x, y: e.y };
}

/** «Хамелеон»: its timer stands — it is a link of the drawn chain or of the dash, or frozen. */
function chameleonHeld(world: World, e: Enemy): boolean {
  if (enemyFrozen(e)) return true;
  const link = (l: { kind: string; id: number }): boolean => l.kind === 'enemy' && l.id === e.id;
  return world.chain.some(link) || (world.move?.kind === 'dash' && world.move.links.some(link));
}

/** «Хамелеон» in its window: the last `chameleonWarn` game seconds before its colour turns (a chain of any colour takes it). */
export function chameleonOpen(world: World, e: Enemy): boolean {
  const warn = world.params.chameleonWarn;
  return hasAffix(e, 'chameleon') && e.chameleon !== undefined && warn > 0 && e.chameleon <= warn + 1e-9;
}

/**
 * D3 (the rim blinking the next colour): the colour «Хамелеон» turns to and the game seconds left, while it is in its
 * window; null — not a chameleon, or not in the window.
 */
export function chameleonWarn(world: World, e: Enemy): { next: number; left: number } | null {
  return chameleonOpen(world, e) ? { next: nextPaletteColor(world, e.color), left: Math.max(0, e.chameleon!) } : null;
}

/**
 * A chain of `color` has just taken `e` (chain.ts): a chameleon of another colour in its window takes the chain's colour and
 * its period starts again. Nothing for others, nor for the first link (`color` null — it sets the colour of the chain).
 */
export function adoptChainColor(world: World, e: Enemy, color: number | null): void {
  if (color === null || e.color === color || !chameleonOpen(world, e)) return;
  e.color = color;
  e.chameleon = Math.max(0.05, world.params.chameleonPeriod);
}

/** The fire trail point a point stands in (its center within a point's radius); undefined — none. */
export function trailAt(world: World, at: Vec): TrailPoint | undefined {
  if (!world.trails.length) return undefined;
  const r = world.params.trailRadius;
  return world.trails.find(t => dist(t, at) <= r);
}

/**
 * The affixes' step (once per tick, after the walk and the pushing, before the touches): the chameleons' colours, the fire
 * trails (age, new points), their burn on the hero on foot (as thorns) and on enemies (never below 0 HP, never a kill).
 */
export function updateAffixes(world: World, dt: number): void {
  if (world.status !== 'playing') return;
  const p = world.params;
  if (world.trails.length) {
    for (const t of world.trails) t.life -= dt;
    world.trails = world.trails.filter(t => t.life > 1e-9);
  }
  for (const e of world.enemies) {
    if (e.singed !== undefined) { e.singed -= dt; if (e.singed <= 1e-9) delete e.singed; }
    if (!e.affixes) continue;
    if (e.chameleon !== undefined && !chameleonHeld(world, e)) {
      e.chameleon -= dt;
      if (e.chameleon <= 1e-9) { e.color = nextPaletteColor(world, e.color); e.chameleon += Math.max(0.05, p.chameleonPeriod); }
    }
    if (e.trail && dist(e, e.trail) >= Math.max(0.05, p.trailStep) - 1e-9) {
      // The fire goes out in water (design 09.10.2026): no point in a river or a pond; the step is counted on.
      if (!inWater(e, world.arena)) world.trails.push({ x: e.x, y: e.y, life: Math.max(0.05, p.trailLife), ownerId: e.id });
      e.trail = { x: e.x, y: e.y };
    }
  }
  burnHero(world, dt);
  if (world.status !== 'playing' || !world.trails.length) return;
  for (const e of world.enemies) {
    // The package: plates keep the trail off an armoured elite (the trail is no hit: it takes no plate either).
    if (e.singed !== undefined || e.hp <= 0 || kindOf(e).immune || hasAffix(e, 'fiery') || platesOf(e) > 0) continue;
    if (!trailAt(world, e)) continue;
    // Never below 0 HP: the trail weakens, it never kills (so it credits nobody, design answer 4).
    const damage = Math.min(e.hp, Math.max(0, p.trailEnemyDamage));
    if (damage <= 0) continue;
    e.hp -= damage;
    e.singed = Math.max(0.05, p.trailEnemyPause);
    e.hurtFlash = Math.max(p.hitFlash, 0.01);
    world.events.push({ type: 'enemyHit', enemyId: e.id, damage, killed: false, x: e.x, y: e.y, source: 'fire-trail' });
  }
}

/**
 * The hero on foot in a fire trail: −`trailHeroDamage` at once, then every `trailInterval` while he stays (as thorns, М3).
 * Not during a dash or a jump (the timer waits; one ending in a trail gives a full interval — chain.ts `finishMove`).
 * Invulnerability skips a burn, the interval runs on. The hit names the elite that dropped the point, without its bonus.
 */
function burnHero(world: World, dt: number): void {
  const hero = world.hero, p = world.params;
  if (world.move) return;
  const point = trailAt(world, hero);
  if (!point) { if (hero.flames !== undefined) delete hero.flames; return; }
  hero.flames = (hero.flames ?? 0) - dt;
  if (hero.flames > 1e-9) return;
  hero.flames += Math.max(0.05, p.trailInterval);
  if (canBeHurt(world)) hurtHero(world, { id: point.ownerId }, p.trailHeroDamage, 'fire-trail');
}

/** Living elites on the arena (start ones counted). */
export const eliteCount = (world: World): number => world.enemies.filter(e => e.elite).length;

/** Random elites are on in this arena: a run from its row 3, or the sandbox toggle. */
export const randomElitesOn = (world: World): boolean => !!world.kit?.randomElites || world.params.eliteSandbox;

/**
 * A newcomer just stepped out of its marker: it may become a random elite (one `elite` draw while under the cap). The
 * package (armour on): the run's guaranteed elite comes first — the due time is drawn once from the `elite` stream at the
 * first newcomer, the first newcomer at or after it is the elite; random elites wait meanwhile (no draws); the caps are
 * `eliteArmorCap` / `eliteArmorCapAfter`.
 */
export function rollRandomElite(world: World, e: Enemy): void {
  if (e.elite || !kindOf(e).chainable || kindOf(e).immune) return;
  const kit = world.kit, p = world.params, guarantee = !!kit?.guaranteedElite && !!p.eliteArmor;
  // The event modifier «бой со случайной элитой» (design answer 3): the first newcomer of the arena is a random elite.
  if (kit?.startElite) {
    kit.startElite = false;
    // The package: the event's elite is the arena's guaranteed one.
    if (guarantee) { delete kit.guaranteedElite; delete kit.eliteDue; }
    makeElite(world, e, true);
    world.events.push({ type: 'elite', enemyId: e.id });
    return;
  }
  if (guarantee) {
    kit!.eliteDue ??= world.rng.stream('elite').next() * GUARANTEE_DUE_MAX;
    if (world.time + 1e-9 < kit!.eliteDue) return;
    delete kit!.guaranteedElite; delete kit!.eliteDue;
    makeElite(world, e, true);
    world.events.push({ type: 'elite', enemyId: e.id });
    return;
  }
  if (!randomElitesOn(world)) return;
  const after = world.stage === 'greed';
  const cap = p.eliteArmor ? (after ? p.eliteArmorCapAfter : p.eliteArmorCap) : (after ? p.eliteCapAfter : p.eliteCap);
  if (eliteCount(world) >= cap) return;
  if (world.rng.stream('elite').next() >= (after ? p.eliteChanceAfter : p.eliteChance)) return;
  makeElite(world, e, true);
  world.events.push({ type: 'elite', enemyId: e.id });
}

function segmentDistance(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return dhypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** The rest of the dash as points (hero → links ahead), or just the hero. */
function restOfDash(world: World): Vec[] {
  const path: Vec[] = [{ x: world.hero.x, y: world.hero.y }];
  for (const link of world.move?.kind === 'dash' ? world.move.links : []) {
    const at = link.kind === 'enemy' ? world.enemies.find(e => e.id === link.id) ?? world.move!.fallen?.find(f => f.id === link.id) : world.objects.find(o => o.id === link.id);
    if (at) path.push({ x: at.x, y: at.y });
  }
  return path;
}

/** A free spot for the loot near `at` (off obstacles, objects, the rest of the dash); the kill point when none is found. */
function lootSpot(world: World, at: Vec): Vec {
  const arena = world.arena, radius = world.params.eliteLootRadius, margin = OBJECT_RADIUS, rng = world.rng.stream('loot'), path = restOfDash(world);
  for (let i = 0; i < LOOT_TRIES && radius > 0; i++) {
    const r = radius * Math.sqrt(rng.next()), a = rng.next() * Math.PI * 2;
    const p = { x: Math.min(arena.width - margin, Math.max(margin, at.x + r * dcos(a))), y: Math.min(arena.height - margin, Math.max(margin, at.y + r * dsin(a))) };
    if (blockedAt(p, OBJECT_RADIUS * 0.6, arena)) continue;
    if (world.objects.some(o => dist(o, p) < LOOT_CLEARANCE + OBJECT_RADIUS)) continue;
    let near = dist(path[0], p) < LOOT_CLEARANCE;
    for (let k = 1; k < path.length && !near; k++) near = segmentDistance(path[k - 1], path[k], p) < LOOT_CLEARANCE;
    if (!near) return p;
  }
  // Stage 3a (М2): an elite that fell into a cliff leaves its loot on the edge, not over the drop.
  const spot = { x: at.x, y: at.y };
  if (arena.terrain && overCliff(spot, arena)) pushOutOfCliffs(spot, OBJECT_RADIUS * 0.6, arena);
  return spot;
}

/**
 * What the loot of one elite is (design answer 6 to step 3: as the turn-based `rollEliteLoot`): an elite of the arena
 * template — with `eliteLootChance` (50%) a consumable open in the run (none open — a resource), otherwise nothing; a
 * random elite — always a resource. Null — nothing drops.
 */
export function rollLoot(world: World, elite: Enemy['elite']): ItemKind | ResourceKind | null {
  const rng = world.rng.stream('loot'), random = elite === 'random';
  if (!random && rng.next() >= world.params.eliteLootChance) return null;
  const open = random ? [] : world.kit?.openItems ?? [], kinds: readonly (ItemKind | ResourceKind)[] = open.length ? open : RESOURCE_KINDS;
  return kinds[Math.floor(rng.next() * kinds.length)];
}

/**
 * The package: what an armoured elite drops (4.3, «Награда»): always — one consumable open in the run, or
 * `ARMOR_RESOURCES` resources when none is open; a clean break — that `CLEAN_BREAK_LOOT` times. No talisman shard.
 */
export function armorLoot(world: World, clean: boolean): (ItemKind | ResourceKind)[] {
  const rng = world.rng.stream('loot'), open = world.kit?.openItems ?? [];
  const kinds: readonly (ItemKind | ResourceKind)[] = open.length ? open : RESOURCE_KINDS, per = open.length ? 1 : ARMOR_RESOURCES;
  const out: (ItemKind | ResourceKind)[] = [];
  for (let i = 0; i < per * (clean ? CLEAN_BREAK_LOOT : 1); i++) out.push(kinds[Math.floor(rng.next() * kinds.length)]);
  return out;
}

function dropLoot(world: World, e: Enemy, loot: ItemKind | ResourceKind): void {
  const spot = lootSpot(world, e);
  const object: ArenaObject = { id: world.nextId++, kind: 'loot', x: spot.x, y: spot.y, pressed: false, loot, born: world.time };
  world.objects.push(object);
  world.events.push({ type: 'loot', objectId: object.id, loot, x: spot.x, y: spot.y, picked: false });
}

/**
 * An enemy has just died: an elite killed by the player may drop its loot on the arena. The package: an armoured elite's
 * death is the event `eliteDown` and a hit-stop (with `hitstop`); killed by the player — its loot always, and in the first
 * `eliteCleanWindow` of its window a clean break: +1 energy, the loot ×2 (later in the window — the plain loot;
 * design answer 11.10.2026, variant 3).
 */
export function eliteDeath(world: World, e: Enemy, cause: KillCause): void {
  if (!e.elite) return;
  const armor = e.armor;
  if (armor) {
    const inWindow = (armor.open ?? 0) > 0, clean = cause.credited && inWindow && (armor.clean ?? 0) > 0;
    world.events.push({ type: 'eliteDown', enemyId: e.id, x: e.x, y: e.y, clean, inWindow, credited: cause.credited });
    if (world.params.hitstop) world.hitstop = Math.max(world.hitstop, ELITE_DOWN_HITSTOP);
    if (!cause.credited) return;
    if (clean) world.energy = Math.min(ENERGY_CAP, world.energy + CLEAN_BREAK_ENERGY);
    for (const loot of armorLoot(world, clean)) dropLoot(world, e, loot);
    return;
  }
  if (!cause.credited) return;
  const loot = rollLoot(world, e.elite);
  if (loot) dropLoot(world, e, loot);
}

const isItemKind = (kind: string): kind is ItemKind => kind === 'frost' || kind === 'bomb' || kind === 'healing' || kind === 'fire';

/** The hero picks the loot up: a consumable goes to his hand, a resource to the arena's take; it leaves the arena. */
export function pickLoot(world: World, object: ArenaObject): void {
  const index = world.objects.indexOf(object);
  if (index < 0 || object.kind !== 'loot' || !object.loot) return;
  world.objects.splice(index, 1);
  const kit = world.kit ??= emptyKit();
  if (isItemKind(object.loot)) kit.items[object.loot]++; else kit.materials[object.loot]++;
  world.events.push({ type: 'loot', objectId: object.id, loot: object.loot, x: object.x, y: object.y, picked: true });
}

/** The walking hero (not in a dash or a jump) picks up every loot his body touches. */
export function touchLoot(world: World): void {
  if (world.move || world.status !== 'playing' || !world.objects.some(o => o.kind === 'loot')) return;
  const reach = OBJECT_RADIUS + heroRadius(world.params);
  for (const o of world.objects.filter(o => o.kind === 'loot' && dist(o, world.hero) <= reach)) pickLoot(world, o);
}
