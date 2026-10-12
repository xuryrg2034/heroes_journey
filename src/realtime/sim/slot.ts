/**
 * «Однорукий гоблин» — the slot on the arena (casino stage 1, item 3; docs/realtime-casino.md, section «Однорукий гоблин»;
 * design: docs/realtime-casino-research.md, 8.3 and 8.5). The toggle `slot` (off by default; a run turns it on itself,
 * run/rtRun.ts `RT_RUN_FORCED`, and passes whether the node may have one, `Loadout.slot`). Numbers — the panel group
 * «Однорукий гоблин».
 *
 * - **Appearance.** A battle whose kit allows it (`Kit.slot`: a run node from row 1 — row 3 before 12.10.2026 —, not the Jailer, not a boss) rolls once,
 *   `slotDelay` game seconds after the goals: with `slotChance` the stone idol stands on a free spot the hero sees, `slotNear`
 *   … `slotFar` from him (stream `slot:appear`; spot and roll vary by seed). Its marker lasts `slotMarker` s (the lever is
 *   not a target meanwhile), then it stands until the hero leaves by the door. Not an enemy: no body, no hit, no touch.
 *   The sandbox has no kit roll: the debug command `slot` (the panel button «Гоблин») puts one near the hero at once by the
 *   same place rules.
 * - **The lever** is an arena object (`ArenaObject.kind` `lever`) like a button: any colour, the last link of a chain (a
 *   chain of just the lever is allowed); not a target during the marker, the `slotCooldown` after a pull and after the
 *   `slotPulls`-th pull (chain.ts `objectRefusal` → `lever`).
 * - **Reels.** 3 reels; each has ❤ ⚡ ◆ 🍲 once and `s` skulls (`slotSkulls` at the start): a skull with s ÷ (4 + s). Every
 *   `slotLinksPerSkull` enemy links the dash really struck before the lever (`HeroMove.hits`: kills and plate hits; a link
 *   that died before the dash reached it is not struck) take one skull off for this pull — reels 1, 2, 3, 1 … (a reel at 0
 *   is skipped). The odds the plan shows (`slotOdds`) read the same function with the plan's struck links.
 * - **Outcome** (skulls first): ☠☠☠ — the arrow rain over the arena (enemies and the hero); two ☠ — the volley at the hero;
 *   three same good — ❤ +3 HP, ⚡ full energy, ◆ 3 crystals near the hero, 🍲 the jackpot (the rain on enemies only); a good
 *   pair (0–1 ☠) — ❤ +1 HP, ⚡ +1 energy, ◆ 1 crystal, 🍲 one elite loot; else nothing. Drawn in the tick the dash touches the
 *   lever (stream `slot:reels`, one draw per reel); the effect comes when the 3rd reel stops (`slotSpin` later). The fight
 *   does not stop; leaving by the door during the spin cancels the effect (a won world does not update).
 * - **Greed.** After each pull +1 skull (reels 1, 2, 3 in turn); at most `slotPulls` pulls; `slotCooldown` between them.
 * - **Arrow marks** as the archer's point (enemies/archer.ts): a circle of `archerMarkRadius`, the arrow falls `archerWindup`
 *   later, `slotDamage`. The rain: `slotRainWaves` waves of `slotRainMin`…`slotRainMax` marks on free arena cells (stream
 *   `slot:arrows`), `slotRainStep` apart; it hits the hero and every enemy in the circle. The volley: `slotVolleyMarks`
 *   marks within `slotVolleyRadius` of the hero, the hero only. The hero is spared as from an arrow (`canBeHurt`:
 *   invulnerability, the chain shield, the dash, the jump). Enemies are hit through `damageEnemy` with the cause
 *   `{ source: 'slot', credited: true, firing }` — the player's kills (counted, a sapper blows up as the player's, an elite
 *   drops loot); a wave is one firing: it takes at most one plate off an armoured elite (elites.ts `stripPlates`).
 *   The hero's hits name the source `slot-rain` or `slot-volley`.
 * - **Drops** (◆, 🍲): free spots `SLOT_DROP_MIN`…`SLOT_DROP_MAX` from the hero (stream `slot:drop`; the loot kind too: a
 *   consumable open in the run, none open — a crafting resource).
 *
 * - **«Перебор»** (`slotBust`, design 12.10.2026, playtest v34; off by default, a run turns it on): the first
 *   `slotSafePulls` pulls are safe (all of the above). A later pull is risky: in the tick the dash touches the lever one roll
 *   of the stream `slot:bust` (the stream `slot:reels` is not drawn) — with `slotBustChance` the goblin blows up when the
 *   reels stop (`slotSpin` later, the warning): `slotBustDamage` to the hero wherever he is — invulnerability, the chain
 *   shield, the dash and the jump do not protect (the price of the bet, not a dodge; it may kill; the second wind as usual),
 *   source `slot-bust`; the goblin and its lever are gone. Else the outcome is a sure triple of a good symbol (❤ ⚡ ◆ 🍲,
 *   equally likely, the same stream); skulls do not act on a risky pull. Leaving by the door during the spin cancels it.
 *   The odds the plan and the idol show read `bustOdds` — the pull's own numbers.
 * - **«Длинная цепь кормит гоблина»** (`slotSafePerLongChain` > 0, design 12.10.2026, task 5; a run: 1): every chain of
 *   `slotLongChainLinks` (6) or more enemy links in the fight — struck, a plate taken, passed fallen, as the cheque's `links`,
 *   but without the cauldron — gives +`slotSafePerLongChain` safe pulls. Counted when the dash ends (`slotFeedEnd`; a chain
 *   that ends on the lever pulls first, with the safe pulls as they were — the plan line reads the same), before the goblin
 *   appears or while it stands (`slotFeedOpen`: not in a battle that cannot get one — the Jailer, a boss —, not after an empty
 *   roll or a bust). With the rule on the safe pulls never exceed `slotPulls` − 1: the last pull is always risky
 *   (`slotCharges`). The idol's caption, its dots, the plan line and the pull read `slotCharges` / `safePullsLeft` /
 *   `bustOdds`. Event `slot` `feed` only when the safe pulls grew (the view's «+1 рывок без риска»). State `World.slotChains`.
 *
 * State: `World.slot` — absent until the battle rolls (or the command), so worlds without the slot hash as before.
 */
import { dcos, dsin } from './detMath';
import { blockedAt, dist, inThorns, inWater, lineOfSight, type Vec } from './geometry';
import { RESOURCE_KINDS, type ItemKind, type ResourceKind } from './kit';
import { DEFAULT_PARAMS, heroRadius, type Params } from './params';
import { bodyRadiusOf } from './enemies/kinds';
import { OBJECT_RADIUS, canBeHurt, damageEnemy, hurtHero, type ArenaObject, type HeroMove, type World } from './world';
import { SLOT_KILL_SOURCE } from './purse';

/** A reel symbol: the skull, or one of the four good ones (❤ ⚡ ◆ 🍲). */
export type SlotSymbol = 'skull' | 'heart' | 'bolt' | 'gem' | 'pot';
/** The four good symbols in reel order (each once on every reel). */
export const GOOD_SYMBOLS: readonly SlotSymbol[] = ['heart', 'bolt', 'gem', 'pot'];
/**
 * What a pull gave: `rain` (☠☠☠), `volley` (two ☠), a triple of a good symbol (`heart3`, `bolt3`, `gem3`, `jackpot` — 🍲🍲🍲),
 * a good pair (`heart`, `bolt`, `gem`, `pot`) or `none`.
 */
export type SlotOutcome = 'rain' | 'volley' | 'heart3' | 'bolt3' | 'gem3' | 'jackpot' | 'heart' | 'bolt' | 'gem' | 'pot' | 'none' | 'bust';
export const SLOT_OUTCOMES: readonly SlotOutcome[] = ['rain', 'volley', 'heart3', 'bolt3', 'gem3', 'jackpot', 'heart', 'bolt', 'gem', 'pot', 'none', 'bust'];

/** The pull being shown: the reels and the outcome (fixed at the pull), game seconds to the effect. */
export interface SlotSpin { reels: SlotSymbol[]; outcome: SlotOutcome; left: number; total: number }

/** The goblin on the arena: its lever (object id) and spot, when it appeared, pulls, skulls per reel, the next greed reel. */
export interface Goblin {
  id: number; x: number; y: number;
  born: number;
  pulls: number;
  skulls: number[];
  /** The reel the next greed skull goes on (0–2). */
  next: number;
  /** Game time from which the lever may be pulled (the marker, then the cooldown). */
  ready: number;
  spin?: SlotSpin;
}

/** An arrow mark: where, its circle, game seconds to the fall and the whole wait, whom it hits, the firing (a wave) it is of. */
export interface SlotMark { x: number; y: number; r: number; left: number; total: number; hero: boolean; enemies: boolean; firing: number; kind: 'rain' | 'volley' }

/** A rain wave not dropped yet: game seconds to it; whether its marks hit the hero (the ☠☠☠ rain) or not (the jackpot). */
export interface SlotWave { left: number; hero: boolean }

/**
 * The slot of the arena (`World.slot`, hashed). `{}` — the battle rolled and no goblin came. `goblin` — the idol; `marks` —
 * arrows in the air; `waves` — rain waves still to drop; `firing` — the last wave id (one firing for the plate rule).
 */
export interface SlotState { goblin?: Goblin; marks?: SlotMark[]; waves?: SlotWave[]; firing?: number }

/** Баланс: ◆ and 🍲 drop on a free spot this far from the hero (units). */
export const SLOT_DROP_MIN = 0.9;
export const SLOT_DROP_MAX = 2.2;
/** Spots tried for the idol, a drop, a mark (none found — no idol / no drop / one mark fewer). */
const PLACE_TRIES = 80;
/** The idol keeps this far from other objects' edges (the door, buttons, braziers …). */
const IDOL_CLEARANCE = 0.4;
/** Energy cap (chain.ts `ENERGY_MAX`; not imported: chain.ts imports this module). */
const ENERGY_CAP = 7;
const EPS = 1e-9;

type SlotKey = 'slotChance' | 'slotDelay' | 'slotMarker' | 'slotNear' | 'slotFar' | 'slotPulls' | 'slotCooldown' | 'slotSpin' | 'slotSkulls'
  | 'slotLinksPerSkull' | 'slotRainWaves' | 'slotRainMin' | 'slotRainMax' | 'slotRainStep' | 'slotVolleyMarks' | 'slotVolleyRadius' | 'slotDamage'
  | 'slotSafePulls' | 'slotBustChance' | 'slotBustDamage' | 'slotSafePerLongChain' | 'slotLongChainLinks';
/** A number of the slot (a journal that turned the slot on by a `param` command may lack it: the default). */
const num = (p: Params, key: SlotKey): number => { const v = p[key]; return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_PARAMS[key]; };
const markRadius = (p: Params): number => p.archerMarkRadius ?? DEFAULT_PARAMS.archerMarkRadius;
const markTime = (p: Params): number => Math.max(0.05, p.archerWindup ?? DEFAULT_PARAMS.archerWindup);

/** The goblin on the arena now (null — none). */
export const goblinOf = (world: World): Goblin | null => world.slot?.goblin ?? null;

/** The lever of the goblin as an arena object (null — none). */
export function leverOf(world: World): ArenaObject | null {
  const g = goblinOf(world);
  return g ? world.objects.find(o => o.id === g.id) ?? null : null;
}

/** The lever `o` may be the last link now: its goblin stands, its marker and cooldown are over, pulls are left. */
export function leverReady(world: World, o: ArenaObject): boolean {
  const g = goblinOf(world), p = world.params;
  // Not while the reels spin (a short panel cooldown must not let a pull drop the previous pull's effect).
  return !!p.slot && !!g && g.id === o.id && !g.spin && g.pulls < num(p, 'slotPulls') && world.time + EPS >= g.ready;
}

/** Skulls per reel for a pull after `struck` enemy links: one off per `slotLinksPerSkull`, reels 1, 2, 3, 1 …, a reel at 0 skipped. */
export function skullsFor(world: World, struck: number): number[] {
  const g = goblinOf(world), p = world.params;
  const skulls = g ? [...g.skulls] : [0, 0, 0];
  let off = Math.floor(Math.max(0, struck) / Math.max(1, num(p, 'slotLinksPerSkull'))), reel = 0;
  while (off > 0 && skulls.some(s => s > 0)) {
    if (skulls[reel] > 0) { skulls[reel]--; off--; }
    reel = (reel + 1) % skulls.length;
  }
  return skulls;
}

/** «Длинная цепь кормит гоблина»: safe pulls one long chain gives (0 — the rule is off). */
const feedPer = (p: Params): number => Math.max(0, Math.floor(num(p, 'slotSafePerLongChain')));

/**
 * «Перебор»: the goblin's pulls in all, how many of them are safe (all while `slotBust` is off). «Длинная цепь кормит
 * гоблина» on: + `slotSafePerLongChain` per long chain of the fight, at most `slotPulls` − 1 (the last pull is always risky).
 */
export function slotCharges(world: World): { total: number; safe: number } {
  const p = world.params, total = Math.max(0, Math.floor(num(p, 'slotPulls')));
  if (!p.slotBust) return { total, safe: total };
  const base = Math.min(total, Math.max(0, Math.floor(num(p, 'slotSafePulls')))), per = feedPer(p);
  if (per <= 0) return { total, safe: base };
  return { total, safe: Math.max(0, Math.min(total - 1, base + per * (world.slotChains ?? 0))) };
}

/**
 * «Длинная цепь кормит гоблина» acts now: the rule is on (with the slot and «Перебор»), the fight goes on, and the goblin may
 * still come (the battle has not rolled and its kit allows one) or stands. Not in a battle that cannot get one (the Jailer, a
 * boss; the sandbox before the command «Гоблин»), not after an empty roll or a bust.
 */
export function slotFeedOpen(world: World): boolean {
  const p = world.params;
  if (!p.slot || !p.slotBust || feedPer(p) <= 0 || world.status !== 'playing') return false;
  return world.slot ? !!world.slot.goblin : !!world.kit?.slot;
}

/** The release (chain.ts `releaseChain`): the dash counts its enemy links while the rule acts (absent otherwise). */
export function slotFeedRelease(world: World, move: HeroMove): void {
  if (slotFeedOpen(world)) move.slotLinks = 0;
}

/** The dash reached an enemy link (struck, a plate taken, passed fallen — chain.ts `hitEnemy`, `passFallen`). */
export function slotFeedLink(move: HeroMove): void {
  if (move.slotLinks !== undefined) move.slotLinks++;
}

/**
 * The dash `move` ended (chain.ts `finishMove`): a chain of `slotLongChainLinks`+ enemy links counts as long while the rule
 * still acts; event `slot` `feed` when the safe pulls grew. Returns by how many they grew.
 */
export function slotFeedEnd(world: World, move: HeroMove): number {
  const links = move.slotLinks;
  if (links === undefined) return 0;
  delete move.slotLinks;
  if (links < Math.max(1, Math.floor(num(world.params, 'slotLongChainLinks'))) || !slotFeedOpen(world)) return 0;
  const before = slotCharges(world).safe;
  world.slotChains = (world.slotChains ?? 0) + 1;
  const grew = slotCharges(world).safe - before;
  if (grew > 0) world.events.push({ type: 'slot', action: 'feed', x: world.hero.x, y: world.hero.y, safe: grew, links, chains: world.slotChains });
  return grew;
}

/** «Перебор»: safe pulls left before the risky ones (0 — the next pull is risky; null — no goblin). */
export function safePullsLeft(world: World): number | null {
  const g = goblinOf(world);
  return g ? Math.max(0, slotCharges(world).safe - g.pulls) : null;
}

/**
 * «Перебор»: the odds of the next pull's bust and its damage; null — the next pull is safe, no pull is left (review
 * 12.10.2026), the rule is off or no goblin.
 */
export function bustOdds(world: World): { chance: number; damage: number } | null {
  const p = world.params, g = goblinOf(world);
  if (!p.slotBust || !g || g.pulls >= slotCharges(world).total || safePullsLeft(world) !== 0) return null;
  return { chance: Math.min(1, Math.max(0, num(p, 'slotBustChance'))), damage: Math.max(0, num(p, 'slotBustDamage')) };
}

/** Chances of the rain (☠☠☠) and the volley (exactly two ☠) with these skulls per reel (a skull on a reel: s ÷ (4 + s)). */
export function skullOdds(skulls: readonly number[]): { rain: number; volley: number } {
  const q = skulls.map(s => s / (GOOD_SYMBOLS.length + s));
  const rain = q[0] * q[1] * q[2];
  const volley = q[0] * q[1] * (1 - q[2]) + q[0] * (1 - q[1]) * q[2] + (1 - q[0]) * q[1] * q[2];
  return { rain, volley };
}

/** The odds of a pull after `struck` enemy links now (the plan's line and the pull read this one function). */
export function pullOdds(world: World, struck: number): { rain: number; volley: number; skulls: number[] } {
  const skulls = skullsFor(world, struck);
  return { ...skullOdds(skulls), skulls };
}

/** The outcome of three reels (skulls first, then a triple, then a pair). */
export function outcomeOf(reels: readonly SlotSymbol[]): SlotOutcome {
  const skulls = reels.filter(r => r === 'skull').length;
  if (skulls === 3) return 'rain';
  if (skulls === 2) return 'volley';
  const good = reels.filter(r => r !== 'skull');
  if (good.length === 3 && good[0] === good[1] && good[1] === good[2]) return good[0] === 'pot' ? 'jackpot' : `${good[0]}3` as SlotOutcome;
  for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) if (good[i] === good[j]) return good[i] as SlotOutcome;
  return 'none';
}

/** A free spot for the idol: not blocked, not water or thorns, seen from the hero, `slotNear`…`slotFar` from him, off objects. */
function idolSpot(world: World): Vec | null {
  const p = world.params, rng = world.rng.stream('slot:appear'), hero = world.hero, arena = world.arena;
  const near = Math.max(0, num(p, 'slotNear')), far = Math.max(near, num(p, 'slotFar'));
  for (let i = 0; i < PLACE_TRIES; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(near * near + rng.next() * (far * far - near * near));
    const at = { x: hero.x + d * dcos(a), y: hero.y + d * dsin(a) };
    if (blockedAt(at, OBJECT_RADIUS, arena) || inWater(at, arena) || (arena.terrain && inThorns(at, arena))) continue;
    if (!lineOfSight(hero, at, arena, -p.sightSlack)) continue;
    if (world.objects.some(o => dist(o, at) < 2 * OBJECT_RADIUS + IDOL_CLEARANCE)) continue;
    return at;
  }
  return null;
}

/** Puts the idol on the arena (the marker starts). False — no free spot found. */
function placeGoblin(world: World): boolean {
  const at = idolSpot(world);
  if (!at) return false;
  const p = world.params, id = world.nextId++, s = Math.max(0, Math.floor(num(p, 'slotSkulls')));
  world.objects.push({ id, kind: 'lever', x: at.x, y: at.y, pressed: false });
  (world.slot ??= {}).goblin = { id, x: at.x, y: at.y, born: world.time, pulls: 0, skulls: [s, s, s], next: 0, ready: world.time + Math.max(0, num(p, 'slotMarker')) };
  world.events.push({ type: 'slot', action: 'appear', x: at.x, y: at.y, objectId: id });
  return true;
}

/**
 * The debug command `slot` (the sandbox button «Гоблин»): a goblin near the hero now, by the place rules. A goblin already
 * standing is replaced (its arrows in the air fall on); not while its reels spin. False — the slot is off, the fight is over,
 * a spin is shown or no spot was found.
 */
export function summonGoblin(world: World): boolean {
  if (!world.params.slot || world.status !== 'playing') return false;
  const old = goblinOf(world);
  if (old?.spin) return false;
  if (old) { world.objects = world.objects.filter(o => o.id !== old.id); delete world.slot!.goblin; }
  return placeGoblin(world);
}

/**
 * The dash reached the lever (chain.ts `reachObject`) after striking `struck` enemy links: the reels are drawn now, the
 * outcome is fixed, the effect waits for the 3rd reel; the cooldown starts and greed adds a skull.
 */
export function pullLever(world: World, lever: ArenaObject, struck: number): void {
  if (!leverReady(world, lever)) return;
  const g = goblinOf(world)!, p = world.params, odds = pullOdds(world, struck), risk = bustOdds(world);
  let reels: SlotSymbol[], outcome: SlotOutcome, bust = false;
  if (risk) {
    // «Перебор»: the risky pull — one roll of its own stream; the skulls do not act (the reels stream is not drawn).
    const rng = world.rng.stream('slot:bust');
    bust = rng.next() < risk.chance;
    const good = bust ? null : GOOD_SYMBOLS[Math.floor(rng.next() * GOOD_SYMBOLS.length)];
    reels = good ? [good, good, good] : ['skull', 'skull', 'skull'];
    outcome = good ? outcomeOf(reels) : 'bust';
  } else {
    const rng = world.rng.stream('slot:reels');
    reels = odds.skulls.map(s => {
      const k = Math.floor(rng.next() * (GOOD_SYMBOLS.length + s));
      return k < s ? 'skull' as const : GOOD_SYMBOLS[k - s];
    });
    outcome = outcomeOf(reels);
  }
  const spin = Math.max(0, num(p, 'slotSpin'));
  const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0), removed = sum(g.skulls) - sum(odds.skulls);
  g.pulls++;
  g.ready = world.time + Math.max(0, num(p, 'slotCooldown'));
  g.skulls[g.next]++;
  g.next = (g.next + 1) % g.skulls.length;
  g.spin = { reels, outcome, left: spin, total: spin };
  world.events.push({ type: 'slot', action: 'pull', x: g.x, y: g.y, objectId: g.id, reels: [...reels], outcome, links: struck, removed, skulls: [...odds.skulls],
    rain: risk ? 0 : odds.rain, volley: risk ? 0 : odds.volley, pull: g.pulls, ...p.slotBust ? { risky: !!risk, bust } : {} });
}

/** A free spot near the hero for a drop (◆, 🍲); null — none found. */
function dropSpot(world: World): Vec | null {
  const rng = world.rng.stream('slot:drop'), hero = world.hero, arena = world.arena;
  for (let i = 0; i < PLACE_TRIES; i++) {
    const a = rng.next() * Math.PI * 2, d = SLOT_DROP_MIN + rng.next() * (SLOT_DROP_MAX - SLOT_DROP_MIN);
    const at = { x: hero.x + d * dcos(a), y: hero.y + d * dsin(a) };
    if (blockedAt(at, OBJECT_RADIUS * 0.6, arena)) continue;
    if (world.objects.some(o => dist(o, at) < 2 * OBJECT_RADIUS + 0.15)) continue;
    return at;
  }
  return null;
}

/** ◆: `count` crystals near the hero (worth 0 kills: a colour change, no score). */
function dropCrystals(world: World, count: number): void {
  for (let i = 0; i < count; i++) {
    const at = dropSpot(world);
    if (!at) return;
    world.objects.push({ id: world.nextId++, kind: 'crystal', x: at.x, y: at.y, pressed: false, value: 0, born: world.time });
  }
}

/** 🍲 pair: one elite loot near the hero — a consumable open in the run, none open — a crafting resource. */
function dropLoot(world: World): void {
  const open = world.kit?.openItems ?? [], kinds: readonly (ItemKind | ResourceKind)[] = open.length ? open : RESOURCE_KINDS;
  const loot = kinds[Math.floor(world.rng.stream('slot:drop').next() * kinds.length)];
  const at = dropSpot(world);
  if (at) world.objects.push({ id: world.nextId++, kind: 'loot', x: at.x, y: at.y, pressed: false, loot, born: world.time });
}

/** The volley: marks within `slotVolleyRadius` of the hero (free spots), the hero only. */
function volley(world: World): void {
  const p = world.params, slot = world.slot!, rng = world.rng.stream('slot:arrows'), hero = world.hero, R = Math.max(0, num(p, 'slotVolleyRadius'));
  const firing = slot.firing = (slot.firing ?? 0) + 1, marks = slot.marks ??= [];
  const n = Math.max(0, Math.floor(num(p, 'slotVolleyMarks')));
  for (let i = 0, tries = 0; i < n && tries < PLACE_TRIES; tries++) {
    const a = rng.next() * Math.PI * 2, d = R * Math.sqrt(rng.next());
    const at = { x: hero.x + d * dcos(a), y: hero.y + d * dsin(a) };
    if (blockedAt(at, 0.05, world.arena)) continue;
    marks.push({ x: at.x, y: at.y, r: markRadius(p), left: markTime(p), total: markTime(p), hero: true, enemies: false, firing, kind: 'volley' });
    i++;
  }
}

/** A rain wave drops: `slotRainMin`…`slotRainMax` marks on free arena cells (cell centres, each cell once). */
function dropWave(world: World, wave: SlotWave): void {
  const p = world.params, slot = world.slot!, rng = world.rng.stream('slot:arrows'), arena = world.arena;
  const lo = Math.max(0, Math.floor(num(p, 'slotRainMin'))), hi = Math.max(lo, Math.floor(num(p, 'slotRainMax')));
  const n = rng.int(lo, hi), cols = Math.max(1, Math.floor(arena.width)), rows = Math.max(1, Math.floor(arena.height));
  const firing = slot.firing = (slot.firing ?? 0) + 1, marks = slot.marks ??= [], taken = new Set<number>();
  for (let i = 0, tries = 0; i < n && tries < n * 12; tries++) {
    const cell = Math.floor(rng.next() * cols * rows);
    if (taken.has(cell)) continue;
    const at = { x: (cell % cols) + 0.5, y: Math.floor(cell / cols) + 0.5 };
    if (blockedAt(at, 0.05, arena)) continue;
    taken.add(cell);
    marks.push({ x: at.x, y: at.y, r: markRadius(p), left: markTime(p), total: markTime(p), hero: wave.hero, enemies: true, firing, kind: 'rain' });
    i++;
  }
  world.events.push({ type: 'slot', action: 'wave', x: world.hero.x, y: world.hero.y, firing });
}

/**
 * «Перебор»: the goblin blows up — `slotBustDamage` to the hero wherever he is, past every protection (no `canBeHurt`); the
 * idol and its lever leave the arena. The lever is no link now: it is not a target while the reels spin (`leverReady`).
 */
function bustGoblin(world: World, g: Goblin): void {
  hurtHero(world, { id: 0 }, Math.max(0, num(world.params, 'slotBustDamage')), 'slot-bust');
  world.objects = world.objects.filter(o => o.id !== g.id);
  delete world.slot!.goblin;
}

/** The 3rd reel stopped: the outcome acts. */
function applyEffect(world: World, g: Goblin, outcome: SlotOutcome): void {
  const p = world.params, hero = world.hero;
  world.events.push({ type: 'slot', action: 'effect', x: g.x, y: g.y, objectId: g.id, outcome });
  const rain = (heroToo: boolean): void => {
    const waves = world.slot!.waves ??= [], step = Math.max(0, num(p, 'slotRainStep')), n = Math.max(0, Math.floor(num(p, 'slotRainWaves')));
    for (let k = 0; k < n; k++) waves.push({ left: k * step, hero: heroToo });
  };
  switch (outcome) {
    case 'rain': rain(true); return;
    case 'jackpot': rain(false); return;
    case 'volley': volley(world); return;
    case 'heart3': case 'heart': hero.hp = Math.min(hero.maxHp, hero.hp + (outcome === 'heart3' ? 3 : 1)); return;
    case 'bolt3': world.energy = ENERGY_CAP; return;
    case 'bolt': world.energy = Math.min(ENERGY_CAP, world.energy + 1); return;
    case 'gem3': dropCrystals(world, 3); return;
    case 'gem': dropCrystals(world, 1); return;
    case 'pot': dropLoot(world); return;
    case 'none': return;
    case 'bust': bustGoblin(world, g); return;
  }
}

/** Arrows due now fall in the order they were dropped: the hero first (his death ends it), then the enemies in the circle. */
function landMarks(world: World, due: SlotMark[]): void {
  const p = world.params, hr = heroRadius(p), damage = Math.max(0, num(p, 'slotDamage'));
  for (const m of due) {
    if (world.status !== 'playing') return;
    world.events.push({ type: 'slot', action: 'land', x: m.x, y: m.y, r: m.r, firing: m.firing });
    if (m.hero && canBeHurt(world) && dist(world.hero, m) <= m.r + hr) hurtHero(world, { id: 0 }, damage, m.kind === 'rain' ? 'slot-rain' : 'slot-volley');
    if (world.status !== 'playing' || !m.enemies) continue;
    const struck = world.enemies.filter(e => dist(e, m) <= m.r + bodyRadiusOf(p, e));
    for (const e of struck) damageEnemy(world, e, damage, { source: SLOT_KILL_SOURCE, credited: true, firing: m.firing });
  }
}

/**
 * The slot's step (game time; world.ts `update`, after the blasts): the battle's roll after the goals, the spin to its effect,
 * the rain waves, the arrows in the air. Nothing while the toggle is off or the world has no slot.
 */
export function updateSlot(world: World, dt: number): void {
  const p = world.params;
  if (!p.slot) return;
  if (!world.slot) {
    if (!world.kit?.slot || world.greedStart === null || world.time + EPS < world.greedStart + num(p, 'slotDelay')) return;
    // The battle's one roll (stream `slot:appear`, the spot too).
    world.slot = {};
    if (world.rng.stream('slot:appear').next() < num(p, 'slotChance')) placeGoblin(world);
    return;
  }
  const slot = world.slot, g = slot.goblin;
  // Arrows in the air first: marks dropped later in this tick start their wait on the next one (as the archer's aim).
  if (slot.marks) {
    const due = slot.marks.filter(m => (m.left -= dt) <= EPS);
    if (due.length) { slot.marks = slot.marks.filter(m => !due.includes(m)); landMarks(world, due); }
    if (slot.marks && !slot.marks.length) delete slot.marks;
    if (world.status !== 'playing') return;
  }
  if (g?.spin) {
    g.spin.left -= dt;
    if (g.spin.left <= EPS) { const outcome = g.spin.outcome; delete g.spin; applyEffect(world, g, outcome); }
  }
  if (slot.waves) {
    const due = slot.waves.filter(w => (w.left -= dt) <= EPS);
    if (due.length) { slot.waves = slot.waves.filter(w => !due.includes(w)); for (const w of due) dropWave(world, w); }
    if (!slot.waves.length) delete slot.waves;
  }
}
