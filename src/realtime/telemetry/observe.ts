/**
 * Track ТB of the real-time telemetry (docs/realtime-telemetry.md, sections 3, 7 and 8): the fight observer — the
 * `FightObserver` of the contract Т0 that fills `FightSummary`. The browser (track ТA) calls it after every command and
 * every tick; the Node report (scripts/realtime-report.ts) calls it the same way while it replays a journal, so both get
 * the same summary (except `tempo.inView`, which only the browser measures, and `threats`, which the report fills from
 * threats.ts).
 *
 * Pure: no DOM, no clock, it only reads the world (the fight hash stays the same). Cheap: a few numbers per tick and a pass
 * over the new events (≈ 1 µs per tick on «Большая поляна», measured by `npm run test:realtime-report`).
 *
 * Definitions (the report reads them; docs/realtime-telemetry.md, section 8, «ТB»):
 * - damage: every `hit` event, by `hit.source`; a `wolf` hit from a wolf that was rushing on the tick before is
 *   `wolf-rush` (the throw of decision 14; a plain wolf touch stays `wolf`). `lowHp` — every tick or command with a hit
 *   that left the hero at 3 HP or lower (`tick` — ticks run, `world.tick`).
 * - chain: a chain is a dash that started (`world.move` of kind `dash` appeared). Length — enemy links at the release;
 *   colour changes — changes of colour between consecutive enemy links of the released chain (through a crystal);
 *   crystals — crystals dropped (`crystal` events); colour shifts — `colorShift` events (the dash reached the link that freed
 *   the colour, «Смена цвета»); cancels — a drawn chain emptied by a command without a dash (cancel,
 *   the step back off the last link, a release with no link left); steps back — a command that shortened the drawn chain
 *   and left it non-empty; focus spent — real seconds of focus burnt while focusing; empty focus — ticks a chain was drawn
 *   with no focus left; chains with a survivor — dashes that struck a link that survived (the chain stopped there; a hit
 *   that took a plate off an armoured elite, `chainHit.plates`, is not a survivor: the chain goes on through it); tough not
 *   first — released chains with an enemy of HP ≥ 2 at the release among the enemy links after the first; draw time (П1) —
 *   real seconds (the observer's clock) from the first link of a released chain to its release, one per released chain.
 * - the loop (loop research, step 2; docs/realtime-loop-research.md, 3.3): close attempts — closing gestures (`loop` events
 *   `close` and `refused`; a run of identical refusals — the same closing and reason — with no change of the drawn chain in
 *   between counts once: the pointer moving inside the target circle sends one per point); unseals — `open` gestures (no reason); loop breaks — `open` by the rules, by the reason;
 *   seals — released closed chains (`seal` events of the phase `release`), empty ones — nobody inside, `sealInside` — how
 *   many were inside, one number per seal in order (at the release, as the player saw it). Seal kills land in
 *   `kills.tools.seal` by the kill rule below (credited, source `seal`).
 * - «Прямая» (loop research, step 3): pierces — `pierce` events `release` (fixed at the release); `pierceHits` — the bodies a
 *   run struck, one number per `pierce` `end` (0 — empty; a cancelled pierce has none). Pierce kills — `kills.tools.pierce`.
 * - step-back re-adds: a link a step back took off and a later command took again into the same chain within
 *   `BACKSTEP_READD_WINDOW` real seconds (an accidental step back). Real time: each tick costs `SIM_DT ÷ tickScale` (the
 *   hit-stop tick — `SIM_DT`), the price `Simulation.nextTickCost` charges, read from the world before the tick; commands
 *   between two ticks happen at the same real moment.
 * - kills: `kill` events: source `chain` — the chain (a survivor knocked over a cliff by the chain too); another credited
 *   source — a tool of the player (`bomb`, `spin`, `blast` of a sapper the player killed, `wave`, `hammer-*` …); not
 *   credited — enemy abilities; source `boss-clear` (task 28, `Params.bossClears`) — the crowd that died with the boss: `kills.bossClear`
 *   only (neither the chain, the tools nor the abilities).
 * - build: `talismanFired` by id; a `hammer` event counts for the run's hammer; the `ward` event for «Пепельный оберег»
 *   (`ash-ward`). `active` — talismans and relics of the kit that have no trigger of their own (constant modifiers:
 *   «Жернов», «Тяжёлый клинок», «Быстрые ноги», «Широкий круг», «Точильный камень», «Песочные часы» …).
 * - tempo: game seconds from the start to the goals, from the goals to the end, from the start to the door (a victory);
 *   enemies on the arena per tick (average, maximum).
 * - movement: path of the hero in arena units (walk, dash, jump, knockback; a `teleport` command is not a path);
 *   game seconds standing (the hero did not move in the tick), in water (his centre), in thorns.
 * - abilities: `jump` and `spin` events, `item` events by kind; task 41: healing loot refused with a full hand (`lootRefused`) and
 *   still on the floor at the end (`capLeft`).
 * - raised touches (package «Урон имеет значение»): a `hit` whose source is the striker kind's touch (`hitSource`) while the
 *   sim says its touch is raised (`touchRaised`, read after the tick: the touch is the last step of a tick).
 * - elites: an enemy with `elite` is seen from the start or from the first look at it as an elite (a newcomer becoming one);
 *   its lifetime — game seconds to its `kill` event; chains per elite — dashes with a `chainHit` on it (plate hits too);
 *   before the goals — its kill came before the `goals` event; `elitePlates` (strip by source, open, close), `eliteDown`
 *   (credited — downs; `clean` — clean kills; `inWindow` without `clean` — late window kills), `loot` (dropped, picked).
 * - the slot (casino stage 1, «Однорукий гоблин»): `slot` events — `appear` (and the game seconds after the goals of the
 *   first), `pull` (enemy links struck before the lever, the outcome), `effect`; a spin left at the end of the fight is
 *   cancelled; `hit` of the source `slot-volley` / `slot-rain` — the arrows' damage; `kill` of the source `slot` — arrow kills;
 *   `feed` — the safe pulls the long chains added («Длинная цепь кормит гоблина»); the fight time of the first `appear`
 *   («Гоблин раньше»); `blast` — the bust's blast with the hero inside or not, spared or hurt, `kill` of the source
 *   `slot-bust` — its kills («Взрыв по площади»). Task 20 «Выход из круга» (`bustExits`, one per `lit`): the hero's distance to
 *   the idol at the light and his body in the circle (world.ts `bustHero`'s rule: radius + `heroRadius`); every tick and command
 *   after it his body is checked against the circle — the last exit before the blast counts (game seconds after the light;
 *   how: the tick's `world.move`, or the move the tick ended — none `walk`, `jump`, else `dash`); the `blast` event settles it
 *   (in the circle then — `stayed-hurt` / `stayed-safe` by its `hurt`), its `slot-bust` hit is the damage.
 * - the cauldron (casino «Котёл», sim/purse.ts): `cheque` events — embers, heat and total per cheque in order, crystals of
 *   the cheques; `purseKill` — the build's kill embers by source; `purseDoor` — the resources the door pays without the die
 *   and how the hero went in (`exitBy`: chain, jump, walk); with П4 «Раздув за дела» on, the greed step at the door
 *   (`exitStep`); the cauldron at the end — `world.purse`.
 * - the oath stake (casino «Ставка клятвы», sim/oath.ts): the oath of the fight and its met / broken ticks — `world.oath` at
 *   the end; the door's `oath` event — kept or not and the cauldron's multiplier.
 * - the cursed chest (К7, sim/chest.ts): the `chest` event — `chest.taken`, the tick of `world.curse`; `curseLifted` — `chest.liftedAt`;
 *   `hit` events between the two (the events stand in the order they happened) — `chest.cursedDamage`, by source as `damage.bySource`.
 * - the second wind (П9, sandbox; sim/world.ts): the `secondWind` event — the tick of the lethal hit, the HP before it, its
 *   source (named as in `damage.bySource`) and the striker's kind if it stood on the arena at the hit (the event names it).
 * - the feat (task 16 «Подвиги», sim/feat.ts): read from the world at the end (`featResult`) — `feat` (null without one);
 * - the bag (task 14 «Котомка у двери», sim/bag.ts): `bag` events — `appear` (`bag.appeared`), `reset` (`bag.resets`); credited
 *   `kill` events after `appear` and before the end of the fight — `bag.killsAfterGoals`; the steps filled and the door's
 *   payout — `world.bag` at the end.
 * - the death (task 25 «От чего умирают»): the lethal hit — the last `hit` before `defeat`, its striker named as the run names it
 *   (run/rtRunEnd.ts `rtDeathOf`; a dead striker — the sapper's blast — from the enemies seen at earlier looks); the series —
 *   hits in the last `DEATH_SERIES_WINDOW` game seconds up to it, by source; the protections at the hit — the after-chain
 *   shield after the tick (it only runs down before the hits of a tick), «Щит фокуса» and invulnerability at the look before
 *   the tick (invulnerability run down by the tick's `SIM_DT`, as `update` does before the hits); the protections in the
 *   window — game seconds at the end of each tick (the lethal tick — as at the hit); the landing — ticks from the look where
 *   `world.move` ended (became null or another move) to the lethal hit.
 * - the boss (task 28 «Тюремщик в походе»): a fight whose start has a Jailer (`jailer`) with the boss frame on — `boss`; `bossMove`
 *   `start` events by move; the first `partSevered` — `severedAt`; the core's `kill` — `diedAt` (game seconds of the fight).
 */
import { COUNTER_TALISMANS, HAMMERS, OATH_HUNGER, RELICS } from '../sim/buildIds';
import { tickScale } from '../sim/chain';
import { featResult } from '../sim/feat';
import type { Command } from '../sim/commands';
import { WOLF_RUSH } from '../sim/enemies/wolf';
import { BOSS_CLEAR, JAILER } from '../sim/enemies/jailer';
import { CASTELLAN, KNIGHT, houndFrenzied, prisonerRioting } from '../sim/enemies/garrison';
import { WISP } from '../sim/enemies/wisp';
// Task 59б: the garrison's step 3 (the recruits' formations, the wardens' pairs and anger, the pools of pitch).
import { RECRUIT, recruitGroup } from '../sim/enemies/recruit';
import { WARDEN, wardenAngry } from '../sim/enemies/warden';
import { inPitch, PITCH_FIRE_SOURCE, POT_SOURCE } from '../sim/pitch';
import type { GarrisonStep3Summary } from './schema';
import { TROLL, TROLL_CHARGE_SOURCE, TROLL_CLUB, TROLL_CLUB_SOURCE, TROLL_ROCK, TROLL_ROCK_SOURCE, TROLL_TAIL, TROLL_TAIL_SOURCE } from '../sim/enemies/troll';
import { WARLOCK } from '../sim/enemies/warlock';
import { kindOf } from '../sim/enemies/kinds';
import { dist, inThorns, inWater } from '../sim/geometry';
import { heroRadius } from '../sim/params';
import { SIM_DT } from '../sim/simulation';
import { focusGuarded, touchRaised, type ChainLink, type Enemy, type HeroMove, type World, type WorldEvent } from '../sim/world';
// Task 49: Ведунья's law (the shield only after a ring) — the price the summary counts (`damage.unshielded`).
import { sealOnlyShield } from '../sim/kit';
import { chainShieldMinKillsOf, chainShieldOf } from '../sim/build';
import { rtDeathOf } from '../run/rtRunEnd';
import {
  emptyFightSummary, type DeathGuard, type DeathSeriesSource, type FightObserver, type FightObserverFactory, type FightSummary, type SlotBustExit, type SlotBustExitBy, type TrollDamage,
} from './schema';

/** Task 48 (design 17.10.2026): the group of a hit on the hero in the Troll's fight — his moves by source, his core's and parts' touch by the striker. */
const TROLL_MOVE_SOURCES: readonly string[] = [TROLL_CLUB_SOURCE, TROLL_ROCK_SOURCE, TROLL_TAIL_SOURCE, TROLL_CHARGE_SOURCE], TROLL_PART_KINDS: readonly string[] = [TROLL_CLUB, TROLL_ROCK, TROLL_TAIL];
function trollGroup(source: string, striker: string | undefined): keyof TrollDamage {
  if (TROLL_MOVE_SOURCES.includes(source)) return 'moves';
  if (striker === TROLL) return 'core';
  return striker !== undefined && TROLL_PART_KINDS.includes(striker) ? 'parts' : 'crowd';
}

/** HP at or below this is a «low HP» moment (section 3: «Моменты HP ≤ 3»). */
export const LOW_HP = 3;

/** The source of a wolf's throw (a `wolf` hit from a wolf that was rushing). */
export const WOLF_RUSH_SOURCE = 'wolf-rush';

/** Task 25 «От чего умирают»: game seconds before the lethal hit whose hits and protections make the series. */
export const DEATH_SERIES_WINDOW = 5;
/** Slack of the window against sums of 1/60 s. */
const WINDOW_EPS = 1e-9;

/** A link taken off by a step back and taken again within this many real seconds is a step-back re-add (research 3.3). */
export const BACKSTEP_READD_WINDOW = 0.3;

/**
 * Real seconds the next tick of this world costs: `SIM_DT ÷ tickScale` (focus and the finisher slow the game), a frozen
 * hit-stop tick — `SIM_DT`. The same price as `Simulation.nextTickCost` (sim/simulation.ts), from the world alone: the
 * observer has no simulation. The test checks the two agree.
 */
export function tickRealCost(world: World): number {
  return world.hitstop > 0 ? SIM_DT : SIM_DT / tickScale(world);
}

/** A link as one number (enemy and object ids are separate counters). */
const linkKey = (link: ChainLink): number => (link.kind === 'enemy' ? link.id * 2 : link.id * 2 + 1);

/** Build ids that fire events of their own; every other talisman or relic of the kit is a constant modifier («действует»). */
const FIRING: ReadonlySet<string> = new Set<string>([...Object.values(COUNTER_TALISMANS), RELICS.bloodOath, OATH_HUNGER, 'ash-ward']);

/**
 * Reads `world.events` incrementally: the view clears the list once per frame (several ticks and commands), the Node replay
 * may clear it after each tick or never. The cursor remembers the last event it read (by identity): if that event still
 * stands at its place, only the events after it are new; otherwise the list was cleared and everything in it is new.
 */
export class EventCursor {
  private seen = 0;
  private last: WorldEvent | null = null;

  /** Calls `visit` for every event that came since the last call. */
  read(world: World, visit: (event: WorldEvent) => void): void {
    const events = world.events;
    let from = this.seen > 0 && events[this.seen - 1] === this.last ? this.seen : 0;
    for (; from < events.length; from++) visit(events[from]);
    this.seen = events.length;
    this.last = events.length ? events[events.length - 1] : null;
  }
}

/** Task 34: one `shiftSkip` per body and drawn chain length (the observer counts it once; the view journals the held pointer's first). */
export const skipKey = (enemyId: number, links: number): string => `${enemyId}:${links}`;

/** Median of a list of numbers (0 for an empty one). */
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const bump = (map: Record<string, number>, key: string, by = 1): void => { map[key] = (map[key] ?? 0) + by; };
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Task 20: how the hero moved in the tick he left the lit circle (the move of that tick, or the one it ended). */
const exitBy = (m: HeroMove | null): SlotBustExitBy => (!m ? 'walk' : m.kind === 'jump' ? 'jump' : 'dash');

/** Task 20: a lit bust watched until its blast — its circle (centre, radius plus the hero's body), the light's game second. */
interface BustWatch {
  x: number; y: number; edge: number; at: number; entry: SlotBustExit;
  /** The blast is still due. */
  open: boolean;
  /** The hero's body in the circle at the last look. */
  inNow: boolean;
  /** The last exit (game seconds after the light, how) — cleared when he came back in. */
  exitAt: number | null;
  exitHow: SlotBustExitBy | null;
}

/** The observer of one fight. Created with the world at the start (before the first command or tick). */
export function createFightObserver(start: World): FightObserver {
  const s = emptyFightSummary();
  const cursor = new EventCursor();
  let world = start;
  // Chains.
  const lengths: number[] = [];
  let chainLen = start.chain.length, move = start.move, survivorDash: unknown = null, focus = start.focus;
  // Wolves rushing at the end of the last tick (a `wolf` hit from one of them is a throw).
  let rushing = new Set<number>(), nextRushing = new Set<number>();
  // Tempo and movement.
  let ticks = 0, enemySum = 0, heroX = start.hero.x, heroY = start.hero.y, time = start.time;
  // The loop and the step-back re-adds: the drawn chain as link keys, its version (bumped on every change), the real clock,
  // links a step back took off (with the real moment), the last refusal counted (a repeat with the same chain is one).
  let keys: number[] = start.chain.map(linkKey), version = 0, clock = 0, nextCost = tickRealCost(start);
  // П1: the real moment the drawn chain got its first link (null — no chain drawn).
  let drawStart: number | null = start.chain.length ? 0 : null;
  let takenOff: { key: number; at: number }[] = [];
  let lastRefusal: { kind: string; refusal: string; version: number } | null = null;
  // Task 34: the `shiftSkip` keys counted in the drawn chain (an emptied chain forgets them).
  const skips = new Set<string>();
  // Elites alive: when seen, the chains that hit them and the last of those (dashes are numbered by `s.chain.count`).
  const elites = new Map<number, { born: number; chains: number; lastDash: number }>();
  // Task 43: the last dash (`s.chain.count`) that struck each knight.
  const knightDash = new Map<number, number>();
  // Task 59б: the summary of step 3 (made at its first number), the formations seen, the wardens' pairs (open — not yet gone), the angry
  // (`angered`: ever; `raging`: the anger runs now — design 22.10.2026, how each anger ends).
  const step3 = (): GarrisonStep3Summary => (s.garrison.step3 ??= { pots: 0, potHits: 0, pitchSeconds: 0, ignites: { path: 0, burning: 0 }, pitchKills: 0,
    formations: 0, orderRefusals: 0, orderBlocks: 0, drills: 0, unlinks: 0, backsteps: 0, recruitBacksteps: 0, pairs: 0, pairsCleared: 0, angers: 0, angerDamage: 0,
    angerKilled: 0, angerCalm: 0, angerAtEnd: 0 });
  const formations = new Set<number>(), pairs = new Map<string, [number, number]>(), angered = new Set<number>(), raging = new Set<number>();
  let goalsDone = start.greedStart !== null;
  // К7: the curse is on now (a world that starts cursed — a test — counts from its own ticks).
  if (start.curse) { s.chest.taken = start.curse.tick; s.chest.liftedAt = start.curse.lifted ?? null; }
  let cursedNow = !!start.curse && start.curse.lifted === undefined;
  /** Task 14: the bag is out and the fight goes on (credited kills count toward `bag.killsAfterGoals`). */
  let bagOpen = !!start.bag && start.status === 'playing';
  if (start.bag) s.bag.appeared = true;
  /** «Перебор»: the source of the last hit on the hero (a lost fight names its killing blow). */
  let lastHitSource: string | null = null;
  /** Task 56 «Приметы»: what the omens' rules did in the fight (`FightSummary.omenFired`; empty — none acted). */
  const omenFired: Record<string, number> = {};
  // Task 41: the healing loot the hero touched with a full hand (`lootRefused`), once each.
  const capRefused = new Set<number>();
  /** Task 20: the lit busts in order (one per `slot.bustExits` entry), the move before this look, the entry the blast's hit counts for. */
  const busts: BustWatch[] = [];
  let prevMove: HeroMove | null = start.move, bustHurt: SlotBustExit | null = null;
  // Task 25 «От чего умирают»: every enemy seen (a dead striker is named), the hits of the last window, the protections at the
  // end of each tick of it (only ticks with one), the protections at the last look, the end of the last move, the lethal hit.
  const seen = new Map<number, Enemy>();
  let seenId = -Infinity;
  const recentHits: { time: number; source: string; damage: number; enemyId: number }[] = [];
  const guards: { time: number; dt: number; chain: boolean; focus: boolean; invuln: boolean }[] = [];
  let guardFocus = focusGuarded(start), guardInvuln = start.hero.invulnerable, guardTime = start.time;
  let moveRef: HeroMove | null = start.move, moveEnd: number | null = null;
  let lethal: { source: string; damage: number; enemyId: number } | null = null;
  // Task 28: the boss's core at the start (a fight with the boss frame on); its summary.
  // Task 43: the full Castellan's core too (only on his arena: the Castellan v0 keeps no boss summary, as before).
  const fullCastellan = !!start.arena.castellanFull && start.params.bossFrame;
  // Task 48: the Troll's core (his own summary `boss.troll`).
  // Task 55, stage Д: the warlock's core (his own summary `boss.warlock`).
  const bossCore = start.params.bossFrame ? start.enemies.find(e => e.kind === JAILER || e.kind === TROLL || e.kind === WARLOCK || (fullCastellan && e.kind === CASTELLAN)) : undefined;
  const troll = bossCore?.kind === TROLL, warlock = bossCore?.kind === WARLOCK;
  // Task 49: Ведунья's fight — `bare` the game time until which an open chain left her where the cat would stand shielded.
  const toad = sealOnlyShield(start);
  if (toad) s.damage.unshielded = { hits: 0, damage: 0 };
  let sealDash = false, bare = -1;
  if (bossCore) s.boss = { diedAt: null, severedAt: null, moves: {}, ...fullCastellan ? { castellan: { raises: 0, openSeconds: 0, windowsHit: 0, windowsMissed: 0, parts: [], bolts: { shots: 0, hero: 0, enemies: 0 }, phase: 1 } } : {},
    ...troll ? { troll: { windows: {}, blocks: {}, snores: { slept: 0, woken: 0 }, wolves: 0, parts: [], phase: 1, unlinks: 0, damage: { crowd: 0, core: 0, parts: 0, moves: 0 } } } : {},
    ...warlock ? { warlock: { charmBrokenAt: null, wardrobeBy: null, hits: {}, barrels: 0, windows: { opened: 0, hit: 0 }, shifts: 0, blocks: {}, unlinks: 0, phase: 1 } } : {} };
  /** Task 55, stage Д: the warlock's window open now (its hit landed). */
  let warlockWindow: { hit: boolean } | null = null;
  /** Task 48: the Troll's window open now (what opened it, its hit landed). */
  let trollWindow: { source: string; hit: boolean } | null = null;
  /** Task 43: the grate's open since (game s; null — down) and the lever's window now (its core hit or not). */
  let grateSince: number | null = null, leverWindow: { hit: boolean } | null = null, leverPulled = false;
  /** Task 43: the full Castellan's parts at the start (his hounds, his crossbow on the stand) by id. */
  const partKinds = new Map<number, string>(fullCastellan ? start.enemies.filter(e => e.kind === 'hound' || e.kind === 'castellan-crossbow').map(e => [e.id, e.kind] as [number, string])
    : troll ? start.enemies.filter(e => e.partOf === bossCore!.id).map(e => [e.id, e.kind] as [number, string]) : []);
  /** Task 20: the hero's body in a lit circle now (world.ts `bustHero`'s rule). */
  const inCircle = (b: Pick<BustWatch, 'x' | 'y' | 'edge'>): boolean => dist(world.hero, b) <= b.edge;
  /** Task 20: the hero's body against the open circles after a tick or a command — an exit (the last one counts) or a return. */
  const watchBusts = (): void => {
    for (const b of busts) {
      if (!b.open || !b.entry.inside) continue;
      const now = inCircle(b);
      if (b.inNow && !now) { b.exitAt = round2(world.time - b.at); b.exitHow = exitBy(world.move ?? prevMove); }
      else if (!b.inNow && now) { b.exitAt = null; b.exitHow = null; }
      b.inNow = now;
    }
  };

  /** Elites not seen before (placed, spawned, a newcomer turned elite). */
  const noteElites = (w: World): void => {
    // Task 25: enemies new since the last look (ids only grow in a world) are remembered for the cause of death.
    let top = seenId;
    for (const e of w.enemies) {
      if (e.id > seenId) { seen.set(e.id, e); if (e.id > top) top = e.id; if (e.kind === KNIGHT) s.garrison.knights++; if (e.kind === 'wolf' && s.boss?.troll) s.boss.troll.wolves++; if (e.kind === WISP) s.forest.wisps.appeared++; }
      // Task 59б: a formation of recruits seen.
      if (e.kind === RECRUIT && !formations.has(recruitGroup(e))) { formations.add(recruitGroup(e)); step3().formations = formations.size; }
      if (e.elite && !elites.has(e.id)) { elites.set(e.id, { born: w.time, chains: 0, lastDash: -1 }); s.elites.count++; }
    }
    seenId = top;
  };
  noteElites(start);

  /** Reads the events that came since the last call. */
  const readEvents = (): void => {
    let hit = false;
    cursor.read(world, ev => {
      switch (ev.type) {
        case 'hit': {
          const source = ev.source === 'wolf' && rushing.has(ev.enemyId) ? WOLF_RUSH_SOURCE : ev.source;
          // Casino stage 1: the goblin's arrows.
          if (ev.source === 'slot-volley') s.slot.damage.volley += ev.damage;
          else if (ev.source === 'slot-rain') s.slot.damage.rain += ev.damage;
          else if (ev.source === 'slot-bust') {
            s.slot.bustDamage += ev.damage;
            // Task 20: the blast's hit on the hero follows its `blast` event.
            if (bustHurt) { bustHurt.damage = (bustHurt.damage ?? 0) + ev.damage; bustHurt = null; }
          }
          lastHitSource = ev.source;
          // Task 25: the hits of the last window (the series before a death).
          recentHits.push({ time: world.time, source, damage: ev.damage, enemyId: ev.enemyId });
          while (recentHits.length && world.time - recentHits[0].time > DEATH_SERIES_WINDOW + WINDOW_EPS) recentHits.shift();
          s.damage.total += ev.damage;
          bump(s.damage.bySource, source, ev.damage);
          // Task 48 (design 17.10.2026): the Troll's fight — the hit's group by its striker (a touch) or its source (a move).
          if (s.boss?.troll?.damage) s.boss.troll.damage[trollGroup(ev.source, (world.enemies.find(e => e.id === ev.enemyId) ?? seen.get(ev.enemyId))?.kind)] += ev.damage;
          bump(s.damage.hits, source);
          if (s.damage.unshielded && world.time <= bare + WINDOW_EPS) { s.damage.unshielded.hits++; s.damage.unshielded.damage += ev.damage; }
          // К7: the events stand in the order they happened, so a hit after `chest` and before `curseLifted` was cursed.
          if (cursedNow) bump(s.chest.cursedDamage, source, ev.damage);
          hit = true;
          const striker = world.enemies.find(e => e.id === ev.enemyId);
          if (striker && ev.source === kindOf(striker).hitSource && touchRaised(world, striker)) { s.damage.raisedTouches.hits++; s.damage.raisedTouches.damage += ev.damage; }
          // Task 40: a frenzied hound's touch (the striker in its frenzy after the tick: the touch is the tick's last step).
          if (ev.source === 'hound' && striker && houndFrenzied(striker)) { s.garrison.frenzyHits++; s.garrison.frenzyDamage += ev.damage; }
          // Task 41: a rioting prisoner's touch on the hero (any kind but the hound: its touch is the hound's field above).
          if (striker && prisonerRioting(striker)) s.garrison.riotDamage += ev.damage;
          // Task 59б: the pot on the hero; the angry warden's touch and «Размах».
          if (ev.source === POT_SOURCE) step3().potHits++;
          if (ev.source === 'warden-swing' || (ev.source === WARDEN && striker && wardenAngry(striker))) step3().angerDamage += ev.damage;
          // Task 56: «Гроза» hit the hero; a touch of the colour on «Перекличка» (raised by it).
          if (ev.source === 'storm') bump(omenFired, 'storm:hero');
          if (striker && world.rollcall?.color === striker.color && ev.source === kindOf(striker).hitSource) bump(omenFired, 'rollcall:touch');
          return;
        }
        case 'kill': {
          // Task 56: a kill of «Гроза».
          if (ev.source === 'storm') bump(omenFired, 'storm:kill');
          const elite = elites.get(ev.enemyId);
          if (elite) {
            elites.delete(ev.enemyId);
            s.elites.lifetime.push(world.time - elite.born);
            s.elites.chainsPer.push(elite.chains);
            if (!goalsDone) s.elites.beforeGoals++;
          }
          if (ev.source === 'slot') s.slot.kills++;
          // Task 38: a kill of a loosed hound's frenzy (not the player's).
          // Task 41: a rioting prisoner's kill (`riot`) counts with the hounds' frenzy, and apart.
          if (ev.source === 'hound' || ev.source === 'riot') s.chain.frenzyKills++;
          if (ev.source === 'riot') s.garrison.riotKills++;
          // Task 57а: a wisp the chain killed.
          if (ev.source === 'chain' && seen.get(ev.enemyId)?.kind === WISP) s.forest.wisps.chainKills++;
          // Task 59б: a kill of the burning pitch.
          if (ev.source === PITCH_FIRE_SOURCE) step3().pitchKills++;
          // Task 43: a knight killed (by any source).
          if (seen.get(ev.enemyId)?.kind === KNIGHT) s.garrison.knightKills++;
          else if (ev.source === 'slot-bust') s.slot.bustKills++;
          // Task 14 «Котомка у двери»: the player's kills after the bag appeared.
          if (bagOpen && ev.credited) s.bag.killsAfterGoals++;
          // Task 28: the boss's core died; the crowd died with it (not the player's, not an ability's).
          if (s.boss && bossCore && ev.enemyId === bossCore.id && s.boss.diedAt === null) s.boss.diedAt = round2(world.time);
          if (ev.source === BOSS_CLEAR) s.kills.bossClear++;
          else if (ev.source === 'chain') s.kills.chain++;
          else if (ev.credited) bump(s.kills.tools, ev.source ?? 'other');
          else s.kills.enemies++;
          return;
        }
        case 'chainHit': {
          if (!ev.killed && ev.plates === undefined && world.move && survivorDash !== world.move) { survivorDash = world.move; s.chain.survivorEnds++; }
          const elite = elites.get(ev.enemyId);
          if (elite && elite.lastDash !== s.chain.count) { elite.lastDash = s.chain.count; elite.chains++; }
          // Task 43: a chain hit on the full Castellan's core in a lever's window.
          if (leverWindow && bossCore && ev.enemyId === bossCore.id) leverWindow.hit = true;
          // Task 43: a chain on a knight (once per dash and knight).
          if (seen.get(ev.enemyId)?.kind === KNIGHT && knightDash.get(ev.enemyId) !== s.chain.count) { knightDash.set(ev.enemyId, s.chain.count); s.garrison.knightChains++; }
          return;
        }
        case 'goals': goalsDone = true; return;
        // Task 28: the boss's moves begun, its weight severed.
        case 'bossMove': if (s.boss && ev.stage === 'start') bump(s.boss.moves, ev.move); return;
        case 'partSevered': {
          if (s.boss && s.boss.severedAt === null) s.boss.severedAt = round2(world.time);
          // Task 43: the full Castellan's parts in the order lost.
          const part = s.boss?.castellan || s.boss?.troll ? partKinds.get(ev.id) : undefined;
          if (part) (s.boss!.castellan ?? s.boss!.troll)!.parts.push({ kind: part, at: round2(world.time) });
          return;
        }
        // Task 43: the full Castellan's moves (lunge, guard), the grate and its windows, «Болт».
        case 'castellanMove': if (s.boss?.castellan && ev.stage === 'start') bump(s.boss.moves, ev.move); else if (s.boss?.castellan && ev.move === 'guard') bump(s.boss.moves, 'guard'); return;
        case 'bossPhase': {
          const b = s.boss?.castellan ?? s.boss?.troll ?? s.boss?.warlock;
          if (b) b.phase = Math.max(b.phase, ev.phase);
          return;
        }
        // Task 48: the Troll's window — opened, its hit, the hits blocked, its end (a «Храп» slept through or woken), the core's drop-out.
        case 'trollWindow': {
          const t = s.boss?.troll;
          if (!t) return;
          if (ev.action === 'open') trollWindow = { source: ev.source, hit: false };
          else if (ev.action === 'hit') { if (trollWindow) trollWindow.hit = true; }
          else if (ev.action === 'block') bump(t.blocks, ev.source);
          else if (ev.action === 'unlink') t.unlinks++;
          else if (ev.action === 'close' && trollWindow) {
            const w = t.windows[trollWindow.source] ??= { opened: 0, hit: 0 };
            w.opened++;
            if (trollWindow.hit) w.hit++;
            if (trollWindow.source === 'snore') { if (trollWindow.hit) t.snores.woken++; else t.snores.slept++; }
            trollWindow = null;
          }
          return;
        }
        // Task 55, stage Д: the warlock — his charm («звон», its fall), his windows, «Перенос», the shoves' strikes at him, his wardrobe broken.
        case 'warlockCharm': {
          const t = s.boss?.warlock;
          if (!t) return;
          if (ev.action === 'block') bump(t.blocks, ev.source ?? 'other');
          else if (t.charmBrokenAt === null) t.charmBrokenAt = round2(world.time);
          return;
        }
        case 'warlockWindow': {
          const t = s.boss?.warlock;
          if (!t) return;
          if (ev.action === 'open') { warlockWindow = { hit: false }; t.windows.opened++; }
          else if (ev.action === 'hit') { bump(t.hits, ev.source ?? 'other'); if (warlockWindow && !warlockWindow.hit) { warlockWindow.hit = true; t.windows.hit++; } }
          else if (ev.action === 'block') bump(t.blocks, ev.source ?? 'other');
          else if (ev.action === 'unlink') t.unlinks++;
          else if (ev.action === 'close') warlockWindow = null;
          return;
        }
        case 'warlockShift': if (s.boss?.warlock && ev.action === 'arrive') s.boss.warlock.shifts++; return;
        case 'shove': {
          const t = s.boss?.warlock;
          if (!t || ev.action !== 'impact' || !bossCore || ev.target !== bossCore.id) return;
          bump(t.hits, 'shove');
          if ((world.enemies.find(e => e.id === ev.thingId) ?? seen.get(ev.thingId))?.kind === 'barrel') t.barrels++;
          return;
        }
        case 'thing': {
          const t = s.boss?.warlock, thing = world.enemies.find(e => e.id === ev.id) ?? seen.get(ev.id);
          if (t && bossCore && t.wardrobeBy === null && thing?.vars.wl === bossCore.id) t.wardrobeBy = ev.by;
          return;
        }
        case 'grate': {
          const c = s.boss?.castellan;
          if (!c) return;
          if (ev.action === 'lever') leverPulled = true;
          // The grate fell while the core was in the drawn chain: the core and the links after it dropped out.
          else if (ev.action === 'unlink') { c.unlinks = (c.unlinks ?? 0) + 1; c.unlinked = (c.unlinked ?? 0) + (ev.dropped?.length ?? 0); }
          else if (ev.action === 'up') {
            grateSince = world.time;
            if (leverPulled) { c.raises++; leverWindow = { hit: false }; leverPulled = false; }
          } else if (ev.action === 'down') {
            if (grateSince !== null) c.openSeconds = round2(c.openSeconds + world.time - grateSince);
            grateSince = null;
            if (leverWindow) { if (leverWindow.hit) c.windowsHit++; else c.windowsMissed++; leverWindow = null; }
          }
          return;
        }
        case 'bolt': {
          const c = s.boss?.castellan;
          if (!c || !partKinds.has(ev.id)) return;
          if (ev.action === 'aim') bump(s.boss!.moves, 'bolt');
          else { c.bolts.shots++; if (ev.hit === 'hero') c.bolts.hero++; else if (ev.hit === 'enemy') c.bolts.enemies++; }
          return;
        }
        // К7 «Проклятый сундук» (sim/chest.ts): the chest taken (the curse starts), the curse lifted by the dash's kills.
        case 'chest': if (s.chest.taken === null) { s.chest.taken = world.curse?.tick ?? world.tick; cursedNow = true; } return;
        case 'curseLifted': s.chest.liftedAt = world.curse?.lifted ?? world.tick; cursedNow = false; return;
        case 'elitePlates':
          if (ev.action === 'strip') bump(s.elites.platesBySource, ev.source ?? 'other', ev.removed ?? 0);
          else if (ev.action === 'open') s.elites.windows++;
          else if (ev.action === 'close') s.elites.windowsClosed++;
          return;
        case 'eliteDown':
          if (!ev.credited) return;
          s.elites.downs++;
          if (ev.clean) s.elites.cleanKills++;
          else if (ev.inWindow) s.elites.lateWindowKills++;
          return;
        case 'loot': if (ev.picked) s.elites.loot.picked++; else s.elites.loot.dropped++; return;
        case 'lootRefused': capRefused.add(ev.objectId); return;
        case 'crystal': s.chain.crystals++; return;
        // «Смена цвета»: the dash reached the link that freed the colour (a shift by length, not through a crystal).
        case 'colorShift': s.chain.colorShifts++; return;
        // Task 38: a tether the dash cut at its end.
        // Task 41: a prisoner's riot began (a cut shackle set it loose).
        case 'frenzy': if (ev.action === 'start' && ev.riot) s.garrison.riots++; return;
        // Task 43: a knight shed its armour (the offensive began).
        case 'knightShed': s.garrison.knightSheds++; return;
        // Task 59б: the pitcher's pots and the pools lit; the recruits' law; the wardens' anger.
        case 'pot':
          if (ev.action === 'throw') step3().pots++;
          else if (ev.action === 'ignite') step3().ignites[ev.cause === 'burning' ? 'burning' : 'path']++;
          return;
        case 'recruit':
          if (ev.action === 'refused') step3().orderBlocks++;
          else if (ev.action === 'drill') step3().drills++;
          else if (ev.action === 'unlink') step3().unlinks++;
          else if (ev.action === 'order') { const key = `order:${skipKey(ev.id, ev.links ?? 0)}`; if (!skips.has(key)) { skips.add(key); step3().orderRefusals++; } }
          return;
        case 'warden':
          if (ev.action === 'anger' && ev.stage === 'start') { step3().angers++; angered.add(ev.id); raging.add(ev.id); }
          // Its clock is over: calm again.
          else if (ev.action === 'anger' && ev.stage === 'end' && raging.delete(ev.id)) step3().angerCalm = (step3().angerCalm ?? 0) + 1;
          return;
        // Task 57а «Лес: стрелки»: windups, the shots' ends, the wisps going out.
        case 'shooter': if (ev.action === 'aim') bump(s.forest.volleys, ev.kind); return;
        case 'shot':
          if (ev.action === 'hit') bump(s.forest.shots.hit, ev.kind);
          else if (ev.action === 'block') bump(s.forest.shots.block, ev.kind);
          else if (ev.action === 'snuff') { if (ev.by === 'bomb') s.forest.shots.snuffBomb++; else s.forest.shots.snuffDash++; }
          return;
        case 'wisp':
          if (ev.action !== 'out') return;
          if (ev.why === 'touch') s.forest.wisps.touched++; else if (ev.why === 'block') s.forest.wisps.blocked++; else s.forest.wisps.faded++;
          return;
        case 'tether':
          if (ev.action === 'cut') s.chain.cuts++;
          // Task 40: the keymaster's shackles — put on, cut (the game second of the first cut).
          if (ev.action === 'shackle') s.garrison.shackles++;
          if (ev.action === 'cut' && ev.kind === 'shackle') { s.garrison.shackleCuts++; s.garrison.firstShackleCut ??= Math.round(world.time * 100) / 100; }
          return;
        // Task 34: a body of another colour passed by on a free chain — once per body and chain length within the drawn chain (the
        // held pointer repeats it every frame; the view journals only the first, `skipKey`).
        case 'shiftSkip': { const key = skipKey(ev.enemyId, ev.links); if (!skips.has(key)) { skips.add(key); s.chain.shiftSkips++; } return; }
        case 'loop':
          // The pointer on the last link opens (no reason); the rules open with one (sim `syncLoop`).
          if (ev.action === 'open') { if (ev.refusal) bump(s.chain.loopBreaks, ev.refusal); else s.chain.unseals++; lastRefusal = null; return; }
          if (ev.action === 'close') { s.chain.closeAttempts++; lastRefusal = null; return; }
          {
            const refusal = ev.refusal ?? '';
            if (lastRefusal && lastRefusal.kind === ev.kind && lastRefusal.refusal === refusal && lastRefusal.version === version) return;
            lastRefusal = { kind: ev.kind, refusal, version };
            s.chain.closeAttempts++;
          }
          return;
        // Task 49: Ведунья's dash ended open with the kills the cat's shield needs — the cat's shield length is her bare window.
        case 'chainEnd':
          if (toad) {
            if (!sealDash && ev.kills >= chainShieldMinKillsOf(world)) { const length = chainShieldOf(world); if (length > 0) bare = world.time + length; }
            sealDash = false;
          }
          return;
        case 'seal':
          if (ev.phase !== 'release') return;
          sealDash = true;
          s.chain.seals++;
          if (!ev.inside.length) s.chain.sealsEmpty++;
          s.chain.sealInside.push(ev.inside.length);
          return;
        // Loop research, step 3 («Прямая», sandbox): pierces fixed at the release; bodies struck by each run that ended.
        case 'pierce':
          if (ev.phase === 'release') s.chain.pierces++;
          else if (ev.phase === 'end') s.chain.pierceHits.push(ev.hits);
          return;
        case 'talismanFired':
          // Task 50: the rank II of a counter acted — its own key `<id>:2`.
          bump(s.build.fired, ev.rank === 2 ? `${ev.id}:2` : ev.id);
          // Task 46: the bodies a fusion of the dash's end acted on.
          if (ev.bodies !== undefined) { const fb = s.build.fusionBodies ??= {}; fb[ev.id] = (fb[ev.id] ?? 0) + ev.bodies; }
          return;
        // Task 30: a run with forms may hold «Взрыв на конце» beside a hammer of «Путь» (from the kit's talismans): the blast is its own.
        case 'hammer': bump(s.build.fired, ev.kind === 'blast' && world.kit?.hammer !== HAMMERS.blast && world.kit?.talismans.includes(HAMMERS.blast) ? HAMMERS.blast : world.kit?.hammer ?? 'hammer'); return;
        case 'ward': bump(s.build.fired, 'ash-ward'); return;
        // П9 «Второе дыхание» (sandbox): the lethal hit the hero stood up from — the tick, his HP before it, its source.
        case 'secondWind':
          s.secondWind = {
            tick: world.secondWind?.tick ?? world.tick, hpBefore: ev.hp,
            source: ev.source === 'wolf' && rushing.has(ev.enemyId) ? WOLF_RUSH_SOURCE : ev.source,
            ...ev.enemy ? { enemy: ev.enemy } : {}, ...ev.elite ? { elite: true } : {},
          };
          return;
        case 'slot':
          // Casino stage 1 («Однорукий гоблин»): appearances, pulls (links before the lever, outcomes), effects.
          if (ev.action === 'appear') {
            s.slot.appeared++;
            if (s.slot.appearAfterGoals === null && world.greedStart !== null) s.slot.appearAfterGoals = world.time - world.greedStart;
            s.slot.appearTime ??= world.time;
            // «Гоблин-сюрприз»: the safe pulls the goblin rolled (read off the world, not the event: the view must not see it).
            const g = world.slot?.goblin;
            if (g && g.id === ev.objectId && typeof g.safe === 'number') s.slot.safe.push(g.safe);
          }
          else if (ev.action === 'pull') { s.slot.pulls++; s.slot.links.push(ev.links ?? 0); bump(s.slot.outcomes, ev.outcome ?? 'none'); if (ev.risky) s.slot.risky++; if (ev.triple) s.slot.triples++; }
          else if (ev.action === 'effect') { s.slot.effects++; if (ev.outcome === 'bust') s.slot.busts++; }
          // «Длинная цепь кормит гоблина»: the safe pulls a long chain added.
          else if (ev.action === 'feed') s.slot.safeFromChains += ev.safe ?? 0;
          // «Взрыв по площади»: the bust's blast — the hero inside its circle or not, spared or hurt.
          else if (ev.action === 'blast') {
            s.slot.bustBlasts++; if (ev.inside) { s.slot.bustInside++; if (!ev.hurt) s.slot.bustSpared++; }
            // Task 20: the blast settles its lit circle (the first open one at its spot): stayed, or the last exit before it.
            const b = busts.find(x => x.open && x.x === ev.x && x.y === ev.y) ?? busts.find(x => x.open);
            if (b) {
              b.open = false;
              const e = b.entry;
              e.damage = 0; bustHurt = ev.hurt ? e : null;
              if (e.inside) {
                if (ev.inside) { e.outAfter = null; e.by = ev.hurt ? 'stayed-hurt' : 'stayed-safe'; }
                else {
                  // Out at the blast while the last look had him in: he left in this very tick.
                  if (b.inNow) { b.exitAt = round2(world.time - b.at); b.exitHow = exitBy(world.move ?? prevMove); }
                  e.outAfter = b.exitAt; e.by = b.exitHow;
                }
              }
            }
          }
          // Task 20 «Выход из круга»: the idol lit — the hero's distance to it and whether his body is in its circle.
          else if (ev.action === 'lit') {
            const at = { x: ev.x, y: ev.y }, d = dist(world.hero, at), edge = (ev.r ?? 0) + heroRadius(world.params), inside = d <= edge;
            const entry: SlotBustExit = { dist: round2(d), inside, outAfter: null, by: inside ? null : 'outside', damage: null };
            s.slot.bustExits.push(entry);
            busts.push({ ...at, edge, at: world.time, entry, open: true, inNow: inside, exitAt: null, exitHow: null });
          }
          return;
        case 'jump': s.abilities.jumps++; return;
        case 'spin': s.abilities.spins++; return;
        case 'item': bump(s.abilities.items, ev.kind); return;
        // Casino «Котёл» (sim/purse.ts): cheques, the build's kill embers, the door's payout without the die.
        case 'cheque': s.purse.embers.push(ev.embers); s.purse.heat.push(ev.heat); s.purse.totals.push(ev.total); s.purse.crystals += ev.crystals; return;
        case 'purseKill': bump(s.purse.killEmbers, ev.source); return;
        case 'purseDoor': s.purse.resources = ev.resources; s.purse.exitBy = ev.by; if (ev.step !== undefined) s.purse.exitStep = ev.step; return;
        // Task 14 «Котомка у двери» (sim/bag.ts): the bag appeared, a hit sent its unfilled step back; the fight's end stops the count.
        case 'bag':
          if (ev.action === 'appear') { s.bag.appeared = true; bagOpen = true; } else if (ev.action === 'reset') s.bag.resets++;
          // Task 56 «Урожай»: a hit took every step (`bagResetAll`).
          if (ev.action === 'reset' && world.params.bagResetAll) bump(omenFired, 'harvest:resetAll');
          return;
        // Task 56 «Приметы»: the storm's strikes; the game second the sleepers woke.
        case 'omen':
          if (ev.omen === 'storm' && ev.action === 'strike') bump(omenFired, 'storm:strike');
          else if (ev.omen === 'drowse') omenFired['drowse:woke'] = round2(world.time);
          return;
        case 'victory': bagOpen = false; return;
        // Task 25: `hurtHero` pushes the lethal hit, then `defeat` — the last hit read is the killing blow.
        case 'defeat': {
          bagOpen = false;
          const last = recentHits[recentHits.length - 1];
          if (last && !s.death && !lethal) lethal = { source: last.source, damage: last.damage, enemyId: last.enemyId };
          return;
        }
        // Casino «Ставка клятвы» (sim/oath.ts): the door settled the oath.
        case 'oath': if (ev.action === 'door') { s.oath.kept = ev.kept ?? null; s.oath.mult = ev.mult ?? null; } return;
        default: return;
      }
    });
    if (hit && world.hero.hp <= LOW_HP) s.damage.lowHp.push({ tick: world.tick, hp: world.hero.hp });
  };

  /** A dash that started since the last call: its length and colour changes at the release. */
  const noteMove = (): void => {
    const m = world.move;
    if (m === move) return;
    move = m;
    if (!m || m.kind !== 'dash') return;
    s.chain.count++;
    // Task 56: the released links taken in water («Половодье») and of the colour on the roll call («Перекличка»).
    if (m.wet) bump(omenFired, 'flood:wet', m.wet.length);
    if (m.call) bump(omenFired, 'rollcall:link', m.call.length);
    let enemies = 0, color: number | null = null, toughLater = false;
    for (const link of m.links) {
      if (link.kind !== 'enemy') continue;
      enemies++;
      const e = world.enemies.find(x => x.id === link.id);
      if (!e) continue;
      if (enemies > 1 && e.hp >= 2) toughLater = true;
      if (color !== null && e.color !== color) s.chain.colorChanges++;
      color = e.color;
    }
    lengths.push(enemies);
    if (toughLater) s.chain.toughNotFirst++;
  };

  /**
   * The drawn chain against the last look: a change bumps its version; links a step back took off are kept with the real
   * moment; links taken again soon after are re-adds. An emptied chain forgets them (a new chain is another chain).
   */
  const noteChain = (w: World, stepBack: boolean): void => {
    const chain = w.chain, n = chain.length;
    if (!n && !keys.length) return;
    if (n && !keys.length) drawStart = clock;
    if (!n) drawStart = null;
    let same = 0;
    while (same < n && same < keys.length && linkKey(chain[same]) === keys[same]) same++;
    if (same === n && same === keys.length) return;
    version++;
    if (!n) { takenOff = []; keys = []; skips.clear(); return; }
    if (stepBack) for (let i = same; i < keys.length; i++) takenOff.push({ key: keys[i], at: clock });
    if (takenOff.length) {
      takenOff = takenOff.filter(t => clock - t.at <= BACKSTEP_READD_WINDOW);
      for (let i = same; i < n && takenOff.length; i++) {
        const key = linkKey(chain[i]), at = takenOff.findIndex(t => t.key === key);
        if (at >= 0) { s.chain.backstepReadds++; takenOff.splice(at, 1); }
      }
    }
    keys = chain.map(linkKey);
  };

  /** Task 25: a move ended since the last look (`world.move` became null or another move) — the landing counts from here. */
  const noteMoveEnd = (): void => {
    if (world.move === moveRef) return;
    if (moveRef) moveEnd = world.tick;
    moveRef = world.move;
  };

  /**
   * Task 25: the death of this look (its `defeat` was read) — the lethal hit, the series, the protections, the landing; then the
   * protections at the end of a tick the hero lived through and those of this look (the next tick's «before»).
   */
  const noteDeath = (tick: boolean): void => {
    const w = world, dt = w.time - guardTime;
    if (lethal && !s.death) {
      const hit = lethal, t = w.time;
      lethal = null;
      const at: DeathGuard[] = [];
      if (w.hero.chainShield > 0) at.push('chain');
      if (guardFocus) at.push('focus');
      if ((tick ? Math.max(0, guardInvuln - SIM_DT) : guardInvuln) > 0) at.push('invuln');
      const inWindow: Record<DeathGuard, number> = { chain: 0, focus: 0, invuln: 0 };
      const add = (g: { chain: boolean; focus: boolean; invuln: boolean }, d: number): void => {
        if (g.chain) inWindow.chain += d;
        if (g.focus) inWindow.focus += d;
        if (g.invuln) inWindow.invuln += d;
      };
      for (const g of guards) if (t - g.time < DEATH_SERIES_WINDOW - WINDOW_EPS) add(g, g.dt);
      add({ chain: at.includes('chain'), focus: at.includes('focus'), invuln: at.includes('invuln') }, dt);
      const by = new Map<string, DeathSeriesSource & { last: number }>();
      for (const h of recentHits) {
        if (t - h.time > DEATH_SERIES_WINDOW + WINDOW_EPS) continue;
        const x = by.get(h.source);
        if (x) { x.hits++; x.damage += h.damage; x.last = h.time; }
        else by.set(h.source, { source: h.source, hits: 1, damage: h.damage, span: round2(t - h.time), last: h.time });
      }
      const series = [...by.values()]
        .sort((a, b) => b.damage - a.damage || b.hits - a.hits || b.last - a.last || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
        .map(({ source, hits, damage, span }) => ({ source, hits, damage, span }));
      const striker = hit.enemyId > 0 ? w.enemies.find(e => e.id === hit.enemyId) ?? seen.get(hit.enemyId) : undefined;
      const killer = rtDeathOf(hit.source, striker);
      s.death = {
        tick: w.tick, source: hit.source, damage: hit.damage,
        ...killer.enemy ? { enemy: killer.enemy } : {}, ...killer.elite ? { elite: true as const } : {}, ...killer.armor ? { armor: true as const } : {},
        ...killer.affixes?.length ? { affixes: [...killer.affixes] } : {},
        series, guardAtHit: at,
        guardInWindow: { chain: round2(inWindow.chain), focus: round2(inWindow.focus), invuln: round2(inWindow.invuln) },
        landing: w.move ? null : moveEnd !== null ? w.tick - moveEnd : null,
        ...w.move ? { moving: w.move.kind } : {},
      };
    }
    if (s.death) return;
    if (tick) {
      const g = { time: w.time, dt, chain: w.hero.chainShield > 0, focus: focusGuarded(w), invuln: w.hero.invulnerable > 0 };
      if (g.chain || g.focus || g.invuln) guards.push(g);
      while (guards.length && w.time - guards[0].time >= DEATH_SERIES_WINDOW) guards.shift();
      guardTime = w.time;
      guardFocus = g.focus; guardInvuln = w.hero.invulnerable;
    } else { guardFocus = focusGuarded(w); guardInvuln = w.hero.invulnerable; }
  };

  return {
    command(cmd: Command, w: World): void {
      world = w;
      prevMove = move;
      noteElites(w);
      readEvents();
      watchBusts();
      const before = chainLen, started = w.move !== move && w.move?.kind === 'dash';
      noteMove();
      const now = w.chain.length;
      const stepBack = now > 0 && now < before;
      // П1: a released chain — real seconds from its first link to the release (a cancelled one is not counted).
      if (before > 0 && now === 0 && started && drawStart !== null) s.chain.drawTime.push(Math.round((clock - drawStart) * 100) / 100);
      if (before > 0 && now === 0 && !started) s.chain.cancels++;
      else if (stepBack) {
        s.chain.backsteps++;
        // Task 59б (design 21.10.2026): the step-backs of a fight with recruits, and those whose last link taken off was a recruit (`keys` —
        // the chain before this command; an enemy link's key is its id × 2).
        if (formations.size) {
          const last = keys[keys.length - 1];
          step3().backsteps++;
          if (last !== undefined && last % 2 === 0 && seen.get(last / 2)?.kind === RECRUIT) step3().recruitBacksteps++;
        }
      }
      chainLen = now;
      noteMoveEnd();
      noteDeath(false);
      noteChain(w, stepBack);
      nextCost = tickRealCost(w);
      focus = w.focus;
      // A test teleport is not a path.
      if (cmd.t === 'teleport') { heroX = w.hero.x; heroY = w.hero.y; }
    },

    tick(w: World): void {
      world = w;
      // The tick that ran cost what the world before it said.
      clock += nextCost;
      prevMove = move;
      noteElites(w);
      readEvents();
      watchBusts();
      noteMove();
      noteMoveEnd();
      noteDeath(true);
      chainLen = w.chain.length;
      noteChain(w, false);
      nextCost = tickRealCost(w);
      if (w.focusing) s.chain.focusSpent += Math.max(0, focus - w.focus);
      else if (chainLen > 0 && !w.move && w.focus <= 0) s.chain.focusEmpty++;
      focus = w.focus;
      // Enemies and the rushing wolves (one pass).
      const enemies = w.enemies;
      ticks++;
      enemySum += enemies.length;
      if (enemies.length > s.tempo.enemies.max) s.tempo.enemies.max = enemies.length;
      nextRushing.clear();
      for (const e of enemies) if (e.kind === 'wolf' && e.vars.st === WOLF_RUSH) nextRushing.add(e.id);
      [rushing, nextRushing] = [nextRushing, rushing];
      // Movement on game time.
      const hero = w.hero, dt = w.time - time, dx = hero.x - heroX, dy = hero.y - heroY;
      time = w.time;
      if (dx !== 0 || dy !== 0) { s.movement.path += Math.sqrt(dx * dx + dy * dy); heroX = hero.x; heroY = hero.y; }
      else s.movement.idle += dt;
      if (dt > 0) {
        if (inWater(hero, w.arena)) s.movement.water += dt;
        if (w.arena.terrain && inThorns(hero, w.arena)) s.movement.thorns += dt;
        // Task 59б: the hero's centre in pitch.
        if (w.pitch?.pools.length && inPitch(w, hero)) step3().pitchSeconds += dt;
      }
      // Task 59б: the wardens' pairs — seen once both are drawn; gone (both dead) without an anger — cleared.
      for (const e of enemies) {
        if (e.kind !== WARDEN || e.vars.wp === undefined) continue;
        const a = Math.min(e.id, e.vars.wp), b = Math.max(e.id, e.vars.wp), key = `${a}:${b}`;
        if (!pairs.has(key)) { pairs.set(key, [a, b]); step3().pairs++; }
      }
      // An angry warden gone from the arena while angry (any source) — killed in its anger.
      for (const id of raging) if (!enemies.some(e => e.id === id)) { raging.delete(id); step3().angerKilled = (step3().angerKilled ?? 0) + 1; }
      for (const [key, [a, b]] of pairs) {
        if (enemies.some(e => e.id === a || e.id === b)) continue;
        pairs.delete(key);
        if (!angered.has(a) && !angered.has(b)) step3().pairsCleared++;
      }
    },

    summary(): FightSummary {
      const out: FightSummary = JSON.parse(JSON.stringify(s)) as FightSummary;
      out.chain.lengthMedian = median(lengths);
      out.chain.lengthMax = lengths.reduce((a, b) => Math.max(a, b), 0);
      out.tempo.enemies.avg = ticks ? enemySum / ticks : 0;
      const w = world, end = w.endTime ?? w.time;
      out.tempo.toGoals = w.greedStart;
      out.tempo.afterGoals = w.greedStart !== null ? end - w.greedStart : null;
      out.tempo.toDoor = w.status === 'victory' ? end : null;
      out.build.active = (w.kit?.talismans ?? []).filter(id => !FIRING.has(id));
      out.elites.aliveAtEnd = w.enemies.filter(e => elites.has(e.id)).length;
      // Task 59б: the angers still running when the fight ended.
      if (out.garrison.step3) out.garrison.step3.angerAtEnd = raging.size;
      // Task 41: the refused healing loot still lying (picked up later with room in the hand — gone from the arena).
      out.abilities.capLeft = [...capRefused].filter(id => w.objects.some(o => o.id === id)).length;
      // Casino stage 1: a spin still shown when the fight ended (the door, a defeat) never acts.
      out.slot.cancelled = w.status !== 'playing' && w.slot?.goblin?.spin ? 1 : 0;
      // «Перебор»: the bust's blow was the last hit of a lost fight (the second wind or the ward kept him up otherwise).
      out.slot.bustDeaths = w.status === 'defeat' && lastHitSource === 'slot-bust' ? 1 : 0;
      // Task 20: a circle whose blast never came (the fight ended in the fuse) — the exit he made before the end, if he was out.
      busts.forEach((b, i) => { if (b.open && b.entry.inside && !b.inNow && b.exitAt !== null) Object.assign(out.slot.bustExits[i], { outAfter: b.exitAt, by: b.exitHow }); });
      // Casino «Котёл»: on, and the cauldron at the end.
      out.purse.on = !!w.params.purse;
      out.purse.cauldron = w.purse?.cauldron ?? 0;
      // Task 14 «Котомка у двери»: the steps filled and what the door paid.
      if (w.bag) {
        out.bag.steps = w.bag.step;
        const paid = w.status === 'victory' ? w.bag.paid : undefined;
        out.bag.payout = paid ? Object.values(paid).reduce((a, b) => a + (b ?? 0), 0) : null;
        out.bag.kinds = paid ? { ...paid } as Record<string, number> : {};
      }
      // Task 16 «Подвиги»: the feat of the fight at its end (done, when, how far it got).
      const feat = featResult(w);
      if (feat) out.feat = { kind: feat.kind, n: feat.n, done: feat.done, at: feat.at ?? null, value: feat.value, missing: feat.done ? 0 : Math.max(0, feat.n - feat.value), won: w.status === 'victory' };
      // Casino «Ставка клятвы»: the oath of the fight (the rule on), its met and broken ticks.
      if (w.oath && w.params.oathStake) Object.assign(out.oath, { id: w.oath.id, brokenTick: w.oath.broken ?? null, metTick: w.oath.met ?? null });
      // Task 56 «Приметы»: the omens' counters (absent — no omen rule acted: summaries as before).
      if (Object.keys(omenFired).length) out.omenFired = { ...omenFired };
      return out;
    },
  };
}

/** The factory the view and the report use (`FightObserverFactory` of Т0). */
export const fightObserver: FightObserverFactory = createFightObserver;
