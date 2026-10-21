/**
 * Run economy audit (design request 12.10.2026; docs/realtime-casino.md, «Аудит экономики похода»). A heuristic for the design,
 * not a test: whole runs are walked through the run's own functions (rtRun.ts) with a fixed simple policy, and every arena is a
 * real fight of the Simulation with the run's params (`rtRunParams`: slot, cursed chest, the bag, feats) played by a greedy bot
 * through journal commands (chains through `planChain`, walking along a flow field, consumables).
 *
 * Usage: npm run realtime:economy -- [--runs N] [--from K] [--garrison on|off] [--bot garrison|economy] [--mortal] [--max-links N] [--exit-at-goals] [--gentle on|off] [--feats on|off] [--schedule off|new] [--hero toad] [--workers W] [--json FILE]
 *   seeds `Math.imul(k, 2654435761) >>> 0`, k = from … from + runs − 1 (default 1 … 300). Deterministic for a given seed range
 *   (workers only split the range).
 *
 * Method and limits (also in the document):
 * - The hero cannot fall in a fight: he starts with run HP + 1000 (`BUFFER`); every hit still lands (the curse adds +1). The run's HP after a fight is the real one (HP − damage, at least 1). A fight where the real HP
 *   reached 0 is counted as «would die» — the run goes on (whole runs), the share is reported.
 * - The bot never jumps and never spins (Q). It uses healing at real HP ≤ 4 and a bomb / fire / frost into a crowd.
 * - Fallbacks: goals not met in 150 s — the debug command `goals`; the door not reached 25 s after deciding to leave — a
 *   teleport next to the door. Both are counted.
 * - Map policy: a rest when HP ≤ 50 %, a merchant with 6+ resources, otherwise a node by a hash of the seed and the step.
 * - Task 17 «Пологий вход» (13.10.2026): `--gentle on` (default — a new run's own) walks runs with the flag `gentleEntry`,
 *   `--gentle off` — runs without it (the tables before the task). Every fight plays the run's params of its row
 *   (`rtArenaParams`). Section 6 — damage, «would die», HP at the fight and healing by run row. The hero cannot fall, so the
 *   run's second wind never fires here.
 * - Update 15.10.2026 (design: the audit was out of date — 0.7 resources a run, 0 chains a fight): the run plays no cauldron, no
 *   die and no oath stake since task 5 (12.10.2026), so section 1's cauldron rows read 0. Counted now as the run pays them:
 *   «Котомка у двери» (task 14, `bagPayout`), «Подвиги» (task 16, `featOutcome`: resources at the door, a talisman choice on its
 *   screen), «Лечение на карте» (task 15, `healOnMap`), the Jailer's severed weight (task 28). `--feats on` (default) walks runs
 *   that carry feats (a player who reached the Jailer before), `--feats off` — a first run. Chains and links are the bot's own
 *   releases (they were read from the cauldron's `cheque` events). Bot policy after the goals: it stays while the bag is not full
 *   or the feat not done (real HP ≥ 4, at most 45 s after the goals; «на арене» — to its N), then leaves; on a battle card it buys the map heal while
 *   HP ≤ 50 % and the price is in hand. Section 7 — the bag, the feats and the map heals.
 * - Update 16.10.2026: runs are made with `garrison: false` — the audit measures the forest (task 38's garrison, on by default
 *   in the game, would go on after the forest final). Runs have no meta (no `locked`, no hearth), as a run with a given seed.
 * - Update 16.10.2026 (design: drop the dead sections): the run plays no cauldron, no die and no oath stake (`RT_RUN_FORCED`:
 *   `purse`, `doorDie`, `oathStake` off), so their sections (the payout and its cap, the oath, the rate, the calibration
 *   criteria), the cauldron rows and the oath policies (`--oath`) are gone; a fight with any of them on stops the script.
 * - Update 16.10.2026 (design, task 40: the audit with the garrison, the camp and the cart): `--garrison on` (default) — a run of
 *   the meta as the camp makes it (`locked: []` — every pack open, so the pools are a given seed's; the camp's flags `hearth`:
 *   «Два пути» `maps: 2` with the first map, Марфа's start consumable `rtHearthItems(seed, 1)`), the forest and on into the
 *   garrison («Ров», the keymaster; «Повозка» on «Предместье» with its default «оставить 6»). Every fight is a real fight of the
 *   bot of the garrison measures (scripts/garrisonBot.ts, as `npm run realtime:garrison-curve`) with the boss-aim policy on a fight
 *   with a boss core (the Jailer, the Castellan; design 16.10.2026, the measure of a boss fight) and the greedy chain elsewhere (the
 *   forest's final «Последний рубеж» has no core: «убей 40»); after the goals it stays for the bag and the feat as the economy bot
 *   (HP ≥ 4, at most 45 s). As the economy bot, the hero cannot fall (`BUFFER`; «погиб бы» counted, the run's HP after a fight at
 *   least 1; a fight over 240 s — the run is left out as stuck). `--mortal` — the hero's real HP: a defeat (or a fight over 240 s)
 *   ends the run, as the curve; the garrison's tables are then of the runs that got there alive. `--bot economy` — the economy
 *   bot above through both levels instead (no boss-aim; the hero cannot fall): the strong end of the two bots. The tables
 *   are printed for each level (the forest — every run; the garrison — the runs that entered it), then «Повозка и вынос» (section 8:
 *   the stock at «Предместье», the cart, the carry `rtCarry` and its cap) and HP (section 9). `--garrison off` — the forest only
 *   with the economy bot above (the audit of 16.10.2026, its numbers).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { arenaNewKinds, runRow } from '../src/realtime/run/arenaPools';
import { GARRISON_FINAL_ARENA, rtGarrisonNodeId } from '../src/realtime/run/garrison';
import { rtCarry, rtHearthItems } from '../src/realtime/run/rtMeta';
import { outcomeOf } from '../src/realtime/run/runFight.testkit';
import {
  createRtRun, RT_TASK17_OFF, resolveArena, rtArenaLoadout, rtAvailableNodes, rtCasinoLeave, rtCasinoPlay, rtCasinoView, rtChooseEventOption, rtChooseFind, rtItemRefusal,
  rtChooseGift, rtChooseGiftPick, rtChooseHabit, rtChooseHammer, rtChooseTalisman, rtEnterNode, rtEventView, rtGiftView, rtNode,
  rtRerollTalismans, rtRerollView, rtRestCraft, rtRestFinish, rtRestHeal, rtRestView, rtArenaParams, rtRunParams, rtShopBuy, rtShopLeave, rtShopView, healOffer, healOnMap,
  rtEnterGarrison, RT_CART_KEEP, RT_CART_MAX,
  type RtArenaOutcome, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { RESOURCE_KINDS } from '../src/realtime/forest/resources';
import { stockTotal } from '../src/realtime/forest/merchant';
import type { ItemKind, ResourceKind } from '../src/realtime/forest/types';
import { BAG_STEPS, bagPayout } from '../src/realtime/sim/bag';
import { chainAnchor, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { JAILER } from '../src/realtime/sim/enemies/jailer';
import { featOutcome, featProgress, type FeatKind } from '../src/realtime/sim/feat';
import { dist, FlowField, type Vec } from '../src/realtime/sim/geometry';
import { defaultParams, heroRadius } from '../src/realtime/sim/params';
import { Simulation } from '../src/realtime/sim/simulation';
import type { ArenaObject, ChainLink, Enemy, World } from '../src/realtime/sim/world';
import { botFight } from './garrisonBot';
import { shotDodge } from './shotDodge';

// ---------- Arguments ----------

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const RUNS = Number(option('--runs') ?? 300), FROM = Number(option('--from') ?? 1);
const WORKERS = Math.max(1, Number(option('--workers') ?? Math.max(1, Math.min(6, cpus().length - 2))));
const CHILD = args.includes('--child');
const JSON_OUT = option('--json');
/** The «weak» profile: at most this many enemy links in a chain (default — no limit: the greedy bot). */
const MAX_LINKS = Number(option('--max-links') ?? 99);
/** The «hasty» profile: the bot heads for the door as soon as the goals are met (no greed, no errands). */
const EXIT_AT_GOALS = args.includes('--exit-at-goals');
/** Task 17: walk runs with the gentle entry (default) or without it. */
const GENTLE = (option('--gentle') ?? 'on') !== 'off';
/** Task 26 «Расписание леса»: `--schedule new` — every run is a new viewer's first (an empty history); `off` (default) — no schedule. */
const SCHEDULE = (option('--schedule') ?? 'off') === 'new';
/** Update 15.10.2026: `--feats on` (default) — runs carry feats (the profile reached the Jailer); `off` — a first run. */
const FEATS = (option('--feats') ?? 'on') !== 'off';
/** Game seconds the bot stays after the goals at most (the bag, the feat, errands). */
const STAY_AFTER_GOALS = 45;
/** Update 16.10.2026 (task 40): `--garrison on` (default) — the meta run through the forest and the garrison; `off` — the forest only. */
const GARRISON = (option('--garrison') ?? 'on') !== 'off';
/** The garrison bot's fight limit in game seconds (scripts/realtime-garrison-curve.ts `--limit`). */
const LIMIT = 240;
/** The boss cores the garrison bot aims at (the boss-aim policy). */
const BOSS_CORES: readonly string[] = [JAILER, 'castellan'];
/** `--garrison on`: `--bot garrison` (default) — the garrison bot; `economy` — the economy bot of the forest's audit through both levels. */
const GARRISON_BOT = GARRISON && (option('--bot') ?? 'garrison') !== 'economy';
/** `--garrison on --mortal` (the garrison bot): the hero's real HP — a defeat ends the run (default: the hero cannot fall). */
const MORTAL = GARRISON_BOT && args.includes('--mortal');
/**
 * Task 49 «Второй герой»: `--hero toad` — every run is Ведунья's (`createRtRun(seed, { hero })`: «Печать» innate, the after-chain shield
 * only after a ring, no «Печать» in the pools). The greedy bot draws no rings, so this measures the price only (a lower bound).
 */
const HERO = option('--hero') === 'toad' ? 'toad' as const : undefined;
/** «погиб бы» — the hero cannot fall; with `--mortal` the deaths are real. */
const DIE = MORTAL ? 'погиб' : 'погиб бы';

const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const PARAMS = rtRunParams(defaultParams());
const BUFFER = 1000;

// ---------- Records ----------

interface FightRecord {
  row: number; arena: string; battle: string;
  lootElite: number; lootSlot: number; lootItems: number; slotRight: boolean; slot: boolean; pulls: number; chest: boolean; chestLifted: boolean;
  chains: number; links: number; bestChain: number;
  damage: number; wouldDie: boolean; time: number; fbGoals: boolean; fbDoor: boolean; exitBy: string;
  /** Task 17: the run's HP at the fight's start, healing potions drunk, healing loot picked up. */
  hpIn: number; heals: number; healLoot: number;
  /** Update 15.10.2026: the bag's filled steps at the end (null — no bag in the fight) and what the door paid for it. */
  bagStep: number | null; bagPaid: number;
  /** The fight's feat (null — none), done, its reward kind, the resources it paid at the door. */
  featKind: FeatKind | null; featDone: boolean; featReward: 'resources' | 'talisman' | null; featPaid: number;
  /** The Jailer's weight severed in the fight. */
  severed: boolean;
  /** `--garrison on`: the fight went over the limit (lost). */
  timeout?: boolean;
}
/** One level's part of a run (the forest; with `--garrison on` the garrison too). */
interface LevelRecord {
  lastRow: number;
  gain: Record<string, number>; spend: Record<string, number>; rowStart: Record<number, number>;
  fights: FightRecord[]; circle: boolean; circleGames: number; circleWins: number; firstDeathRow: number | null;
  /** Task 17: the run row of the first fight whose arena brings the porcupine (null — never met). */
  porcupineRow: number | null;
  rerollBy: Record<string, number>; shopBy: Record<string, number>; endTotal: number;
  /** Update 15.10.2026: map heals bought (task 15) and the HP they gave. */
  mapHeals: number; mapHealHp: number;
  /** Update 16.10.2026: HP the rests' «Отдых» gave. */
  restHp: number;
}
interface RunRecord extends LevelRecord {
  k: number; seed: number; result: string;
  /** `--garrison on`: the garrison's part (absent — the run did not enter it) and the run's end. */
  garrison?: LevelRecord;
  end?: RunEnd;
}
/** `--garrison on`: the run's end — the level and node of the death, HP at the levels' ends, the cart and the carry (`rtCarry`). */
interface RunEnd {
  deathAt: string | null; maxHp: number;
  /** HP after the forest's final (before «Предместье» heals it to full) and at the Castellan's fight (after a map heal on its card). */
  hpForestEnd: number | null; hpCastellan: number | null;
  /** The stock at «Предместье» and what the cart took (null — not reached). */
  cartStock: number | null; cart: number | null;
  /** The carry: resources carried, the cap, the stock at the end, the carry before the cap. */
  carry: number; carryCap: number; resources: number; carryUncapped: number;
}
const newLevel = (): LevelRecord => ({ lastRow: 0, gain: {}, spend: {}, rowStart: {}, fights: [], circle: false, circleGames: 0, circleWins: 0, firstDeathRow: null, porcupineRow: null, rerollBy: {}, shopBy: {}, endTotal: 0, mapHeals: 0, mapHealHp: 0, restHp: 0 });

const add = (into: Record<string, number>, key: string, n: number): void => { if (n) into[key] = (into[key] ?? 0) + n; };
const total = (run: RtRunState): number => stockTotal(run.materials);
const materials = (run: RtRunState): Record<ResourceKind, number> => ({ ...run.materials });
function ok(step: RtRunStep, what: string): RtRunState { if (!step.ok) throw new Error(`${what}: ${step.reason}`); return step.run; }
/** A small deterministic hash for the bot's own choices (no run stream is touched). */
const hash = (a: number, b: number): number => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return (h ^ (h >>> 13)) >>> 0; };

// ---------- The fight bot ----------

interface ChainTry { start: number; links: ChainLink[]; score: number; enemyLinks: number; button: boolean; door: boolean; lever: boolean }
interface FightContext { goal: string; leaving: boolean; chainsReleased: number; lastChain: number; allowChest: boolean }

const isResource = (loot: unknown): loot is ResourceKind => RESOURCE_KINDS.includes(loot as ResourceKind);
const realHp = (w: World): number => w.hero.hp - BUFFER;
const objectAt = (w: World, link: ChainLink): ArenaObject | undefined => link.kind === 'object' ? w.objects.find(o => o.id === link.id) : undefined;
const enemyAt = (w: World, link: ChainLink): Enemy | undefined => link.kind === 'enemy' ? w.enemies.find(e => e.id === link.id) : undefined;

/** Builds a chain greedily from the start candidate `start` (index into the candidate list) and scores it; leaves it drawn. */
function greedyFrom(sim: Simulation, startPoint: Vec, ctx: FightContext): ChainTry | null {
  const w = sim.world;
  sim.command({ t: 'cancel' });
  sim.command({ t: 'begin', x: startPoint.x, y: startPoint.y });
  if (!w.chain.length) return null;
  const greed = w.stage === 'greed';
  const passable = (o: ArenaObject): boolean => o.kind === 'crystal' || o.kind === 'loot' || (o.kind === 'brazier') || (o.kind === 'chest' && ctx.allowChest);
  for (let k = 0; k < 14; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    if (w.chain.filter(link => link.kind === 'enemy').length >= MAX_LINKS) break;
    const from = chainAnchor(w);
    const options: { p: Vec; cost: number }[] = [];
    for (const e of nextCandidates(w)) options.push({ p: e, cost: dist(e, from) - (e.marked && ctx.goal === 'marked' ? 1.5 : 0) });
    for (const o of nextObjectCandidates(w)) if (passable(o)) options.push({ p: o, cost: dist(o, from) - (o.kind === 'crystal' ? 0.8 : o.kind === 'loot' ? 1 : o.kind === 'chest' ? 1 : 0) });
    options.sort((a, b) => a.cost - b.cost);
    let grown = false;
    for (const next of options.slice(0, 3)) {
      const before = w.chain.length;
      sim.command({ t: 'drag', x: next.p.x, y: next.p.y, mode: 'append' });
      if (w.chain.length > before) { grown = true; break; }
    }
    if (!grown) break;
  }
  // The terminal link: an unpressed button before the goals, the door when leaving, the lever after the goals.
  let plan = planChain(w);
  if (!plan.endsOnSurvivor && !plan.endsOnObject) {
    const enemyLinks = w.chain.filter(link => link.kind === 'enemy').length;
    const objs = nextObjectCandidates(w);
    const button = !greed && ctx.goal === 'buttons' ? objs.find(o => o.kind === 'button' && !o.pressed) : undefined;
    const door = ctx.leaving ? objs.find(o => o.kind === 'door') : undefined;
    const lever = greed && !ctx.leaving && (enemyLinks >= 2 || leverIdle(w)) ? objs.find(o => o.kind === 'lever') : undefined;
    const end = button ?? door ?? lever;
    if (end) sim.command({ t: 'drag', x: end.x, y: end.y, mode: 'append' });
    plan = planChain(w);
  }
  const links = [...w.chain];
  const enemyLinks = links.filter(link => link.kind === 'enemy').length;
  const last = objectAt(w, links[links.length - 1]);
  let marked = 0, loot = 0, chest = 0;
  for (const lp of plan.links) {
    const e = enemyAt(w, lp.link);
    if (e?.marked && lp.outcome?.killed) marked++;
    const o = objectAt(w, lp.link);
    if (o?.kind === 'loot') loot++;
    if (o?.kind === 'chest') chest++;
  }
  const button = last?.kind === 'button', door = last?.kind === 'door', lever = last?.kind === 'lever';
  const score = (plan.cheque?.total ?? 0) + 2 * plan.kills + (button ? 60 : 0) + 30 * marked + 8 * loot + 12 * chest + (door ? 1000 : 0) + (lever ? 6 : 0);
  return { start: 0, links, score, enemyLinks, button, door, lever };
}

/** The lever has been ready for 3 s without a chain of 2+ enemies to it: a bare pull is allowed. */
const leverIdle = (w: World): boolean => !!w.slot?.goblin && !w.slot.goblin.spin && w.time - w.slot.goblin.ready > 3;

/** The best greedy chain from up to 6 nearest starts; the world's chain is left empty. */
function bestChain(sim: Simulation, ctx: FightContext): { start: Vec; plan: ChainTry } | null {
  const w = sim.world, hero = w.hero;
  const starts: Vec[] = [
    ...nextCandidates(w),
    ...nextObjectCandidates(w).filter(o => o.kind === 'crystal' || o.kind === 'loot' || (o.kind === 'chest' && ctx.allowChest)
      || (o.kind === 'button' && !o.pressed && w.stage !== 'greed') || (o.kind === 'door' && ctx.leaving) || (o.kind === 'lever' && !ctx.leaving && leverIdle(w))),
  ].sort((a, b) => dist(a, hero) - dist(b, hero)).slice(0, 6).map(p => ({ x: p.x, y: p.y }));
  let best: { start: Vec; plan: ChainTry } | null = null;
  for (const start of starts) {
    const tried = greedyFrom(sim, start, ctx);
    if (tried && (!best || tried.score > best.plan.score)) best = { start, plan: tried };
  }
  sim.command({ t: 'cancel' });
  return best;
}

interface FightResult { outcome: RtArenaOutcome; record: Omit<FightRecord, 'row' | 'battle'> }

/** The bot did not finish a fight in its time: the run is left out (`result: 'stuck'`). */
class StuckFight extends Error {}

function playFight(run: RtRunState): FightResult {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const sim = new Simulation({ arena: pending.arena, params: rtArenaParams(run, PARAMS), seed: pending.seed, hero: { hp: run.hp + BUFFER, maxHp: run.maxHp + BUFFER }, loadout: rtArenaLoadout(run), ...pending.roster !== undefined ? { roster: pending.roster } : {} });
  const w = sim.world;
  // Update 16.10.2026: the run plays no cauldron, no die and no oath stake (`RT_RUN_FORCED`); the audit has no sections for them.
  if (w.params.purse || w.params.doorDie || w.oath) throw new Error(`fight ${pending.arena}: the cauldron, the die or an oath is on`);
  const ctx: FightContext = { goal: w.arena.goal, leaving: false, chainsReleased: 0, lastChain: 0, allowChest: true };
  const hr = heroRadius(w.params);
  const field = new FlowField(w.arena, hr, { waterCost: 2, thornCost: 4 });
  const dir: Vec = { x: 0, y: 0 };
  const eliteLoot = new Set<number>();
  let lootElite = 0, lootSlot = 0, lootItems = 0, slot = false, pulls = 0, chest = false, chestLifted = false, chains = 0, links = 0;
  let heals = 0, healLoot = 0, severed = false, lastMove: string | null = null;
  // Task 17: the kinds that stood on the arena (the run keeps them as met, as the view's `RtDeathWatch.kinds`).
  const kinds = new Set<string>(w.enemies.map(e => e.kind));
  // Task 26: an elite and the affix types that stood on the arena (the view's `RtDeathWatch.elite` / `affixes`; the schedule reads them).
  let eliteSeen = false;
  const affixSeen = new Set<string>();
  const seeElites = (): void => { for (const e of w.enemies) if (e.elite) { eliteSeen = true; for (const a of e.affixes ?? []) affixSeen.add(a); } };
  seeElites();
  let minHp = realHp(w), lastItem = -10, leaveAt = 0, fbGoals = false, fbDoor = false, greedStart: number | null = null;
  const slotRight = !!sim.world.kit && !!rtArenaLoadout(run).slot, chestPolicy = run.hp >= 8;
  let exitBy = 'none';

  const walkTo = (target: Vec | null, stop: number): void => {
    const hero = w.hero;
    // Task 57а: a shot about to touch the hero — a step aside first (nothing while no shot flies).
    const aside = shotDodge(w);
    if (aside) { sim.command({ t: 'walk', x: aside.x, y: aside.y }); return; }
    if (!target) { sim.command({ t: 'walk', x: 0, y: 0 }); return; }
    if (dist(target, hero) <= stop) { sim.command({ t: 'walk', x: 0, y: 0 }); return; }
    field.setTarget(target);
    let dx = target.x - hero.x, dy = target.y - hero.y;
    if (field.direction(hero, dir)) { dx = dir.x; dy = dir.y; }
    // Step aside from an enemy right ahead when not going for the door.
    if (!ctx.leaving) {
      for (const e of w.enemies) {
        const d = dist(e, hero);
        if (d < 0.9 && d > 1e-6) { dx += (hero.x - e.x) / d * 0.8; dy += (hero.y - e.y) / d * 0.8; }
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    sim.command({ t: 'walk', x: dx / len, y: dy / len });
  };

  const decide = (): void => {
    const hero = w.hero, real = realHp(w), kit = w.kit;
    // Consumables: healing when low; a bomb, fire or frost into a crowd.
    if (real <= 4 && (kit?.items.healing ?? 0) > 0 && sim.command({ t: 'item', kind: 'healing', x: hero.x, y: hero.y })) heals++;
    const crowd = w.enemies.filter(e => dist(e, hero) < 2.5);
    if (crowd.length >= 5 && w.time - lastItem > 3 && kit) {
      const kind = (['fire', 'frost', 'bomb'] as ItemKind[]).find(item => (kit.items[item] ?? 0) > 0);
      if (kind) {
        const target = crowd.reduce((a, b) => crowd.filter(e => dist(e, b) < 1.5).length > crowd.filter(e => dist(e, a) < 1.5).length ? b : a);
        if (sim.command({ t: 'item', kind, x: target.x, y: target.y })) lastItem = w.time;
      }
    }
    const greed = w.stage === 'greed';
    if (greed && greedStart === null) greedStart = w.time;
    // The chest: taken when the fight started with real HP ≥ 8 and the hero still has 6+ (policy).
    ctx.allowChest = chestPolicy && real >= 6;
    const box = ctx.allowChest ? w.objects.find(o => o.kind === 'chest') : undefined;
    const lootNear = w.objects.filter(o => o.kind === 'loot' && dist(o, hero) < 8);
    if (greed && !ctx.leaving) {
      // Errands before the door: loot within 8, the chest, the goblin (wait for its roll, then pull while pulls are left).
      const goblin = w.slot?.goblin, slotDue = slotRight && w.slot === undefined;
      const errands = lootNear.length > 0 || !!box || slotDue || (!!goblin && goblin.pulls < (w.params.slotPulls ?? 3) && real >= 6);
      // Update 15.10.2026: the bag and the feat keep the bot after the goals (the cauldron is off in the run).
      const bagDue = !!w.bag && w.bag.step < BAG_STEPS && real >= 4, feat = featProgress(w), featDue = !!feat && !feat.done && real >= 4;
      const want = !bagDue && !featDue;
      // «Продержись N с на арене»: the bot stays to N (the fight's game time) when that is past the usual stay.
      const stay = featDue && feat!.kind === 'arena' ? Math.max(STAY_AFTER_GOALS, feat!.target - greedStart! + 1) : STAY_AFTER_GOALS;
      if (EXIT_AT_GOALS || (want && !errands) || w.time - greedStart! > stay || real <= 3) { ctx.leaving = true; leaveAt = w.time; }
    }
    const best = bestChain(sim, ctx);
    if (best) {
      const p = best.plan, threat = w.enemies.some(e => dist(e, hero) < 1.3);
      let accept = p.door || p.button || p.enemyLinks >= 3 || (p.enemyLinks >= 1 && (threat || w.time - ctx.lastChain > 1.5)) || (p.score >= 12 && !ctx.leaving);
      if (ctx.leaving && !p.door && !threat) accept = false;
      if (accept) {
        greedyFrom(sim, best.start, ctx);
        const drawn = w.chain.filter(link => link.kind === 'enemy').length;
        if (sim.command({ t: 'release' })) { ctx.chainsReleased++; ctx.lastChain = w.time; if (drawn > 0) { chains++; links += drawn; } return; }
        sim.command({ t: 'cancel' });
      }
    }
    // Walking.
    if (ctx.leaving) {
      const door = w.objects.find(o => o.kind === 'door')!;
      if (w.time - leaveAt > 25 && !fbDoor) {
        fbDoor = true;
        const cx = w.arena.width / 2 - door.x, cy = w.arena.height / 2 - door.y, len = Math.hypot(cx, cy) || 1;
        sim.command({ t: 'teleport', x: door.x + cx / len * 1.2, y: door.y + cy / len * 1.2 });
        sim.command({ t: 'walk', x: -cx / len, y: -cy / len });
        return;
      }
      walkTo(door, 0); return;
    }
    const near = (list: Vec[]): Vec | null => list.length ? list.reduce((a, b) => dist(a, hero) <= dist(b, hero) ? a : b) : null;
    if (box) { walkTo(box, 0); return; }
    if (!greed) {
      if (ctx.goal === 'buttons') { const b = near(w.objects.filter(o => o.kind === 'button' && !o.pressed)); if (b) { walkTo(b, 1.2); return; } }
      if (ctx.goal === 'marked') { const m = near(w.enemies.filter(e => e.marked)); if (m) { walkTo(m, 1.4); return; } }
    } else {
      const loot = near(lootNear);
      if (loot) { walkTo(loot, 0); return; }
      const lever = w.objects.find(o => o.kind === 'lever');
      if (lever && w.slot?.goblin && w.slot.goblin.pulls < (w.params.slotPulls ?? 3)) { walkTo(lever, 1.2); return; }
    }
    const loot = near(w.objects.filter(o => o.kind === 'loot' && dist(o, hero) < 3));
    if (loot) { walkTo(loot, 0); return; }
    const enemy = near(w.enemies.filter(e => e.color >= 0));
    walkTo(enemy ?? { x: w.arena.width / 2, y: w.arena.height / 2 }, 1.4);
  };

  const MAX = 60 * 360;
  for (let tick = 0; tick < MAX && w.status === 'playing'; tick++) {
    if (!w.move && !w.chain.length && tick % 6 === 0) decide();
    if (w.stage !== 'greed' && w.time > 150 && !fbGoals) { fbGoals = true; sim.command({ t: 'goals' }); }
    if (tick === MAX - 600) { const door = w.objects.find(o => o.kind === 'door')!; sim.command({ t: 'teleport', x: door.x, y: door.y + (door.y < w.arena.height / 2 ? 1.2 : -1.2) }); sim.command({ t: 'walk', x: 0, y: door.y < w.arena.height / 2 ? -1 : 1 }); fbDoor = true; }
    const moving = w.move?.kind ?? null;
    sim.tick();
    // The way the hero went through the door: a dash or a walk.
    if (w.status === 'victory' && exitBy === 'none') exitBy = moving === 'dash' ? 'chain' : moving ? moving : 'walk';
    lastMove = moving;
    for (const ev of w.events) {
      if (ev.type === 'loot') {
        if (!ev.picked) eliteLoot.add(ev.objectId);
        else if (isResource(ev.loot)) { if (eliteLoot.has(ev.objectId)) lootElite++; else lootSlot++; }
        else { lootItems++; if (ev.loot === 'healing') healLoot++; }
      } else if (ev.type === 'slot') { if (ev.action === 'appear') slot = true; if (ev.action === 'pull') pulls++; }
      else if (ev.type === 'chest') chest = true;
      else if (ev.type === 'curseLifted') chestLifted = true;
      else if (ev.type === 'partSevered') severed = true;
    }
    w.events.length = 0;
    for (const e of w.enemies) kinds.add(e.kind);
    seeElites();
    minHp = Math.min(minHp, realHp(w));
  }
  // The bot is stuck (the fight runs out of time): the run is left out of the tables and counted (task 26, 15.10.2026; the proposal
  // left such runs out too).
  if (w.status === 'playing') throw new StuckFight(`fight ${pending.arena} seed ${pending.seed}: playing at ${w.time.toFixed(1)} s`);
  if (w.status !== 'victory') throw new Error(`fight ${pending.arena} seed ${pending.seed}: ${w.status} at ${w.time.toFixed(1)} s`);
  const real = realHp(w);
  const outcome: RtArenaOutcome = {
    nodeId: pending.nodeId, won: true, hp: Math.max(1, Math.min(run.maxHp, real)), kills: w.stats.kills, bestChain: w.stats.bestChain,
    damage: w.stats.damageTaken, time: w.endTime ?? w.time,
    ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed, openItems: [...w.kit.openItems] } : {},
    ...w.curse ? { chest: true } : {},
    kinds: [...kinds].sort(), ...eliteSeen ? { elite: true } : {}, ...affixSeen.size ? { affixes: [...affixSeen].sort() } : {},
    // Update 15.10.2026: as main.ts `recordRunArena` feeds them back — the bag's payout, the feat, the severed weight, the second wind.
    ...bagPayout(w) ? { bag: bagPayout(w)! } : {}, ...featOutcome(w), ...severed ? { severed: true } : {}, ...w.secondWind ? { secondWind: true } : {},
  };
  const bagPaid = Object.values(bagPayout(w) ?? {}).reduce((a, b) => a + (b ?? 0), 0), featNow = featProgress(w);
  void lastMove;
  return {
    outcome,
    record: { arena: pending.arena,
      lootElite, lootSlot, lootItems, slotRight, slot, pulls, chains, links, bestChain: w.stats.bestChain, chest, chestLifted, damage: w.stats.damageTaken, wouldDie: minHp <= 0, time: w.endTime ?? w.time, fbGoals, fbDoor, exitBy, hpIn: run.hp, heals, healLoot,
      bagStep: w.bag ? w.bag.step : null, bagPaid, featKind: featNow?.kind ?? null, featDone: !!featNow?.done, featReward: pending.feat ? ('talisman' in pending.feat.reward ? 'talisman' : 'resources') : null, featPaid: 0, severed },
  };
}

/**
 * `--garrison on`: the open battle played by the garrison bot (scripts/garrisonBot.ts) with the run's HP (no buffer: a death is
 * real); the outcome as main.ts reads a finished fight (`outcomeOf`) with the arena's kinds, elite, affixes and the severed weight.
 */
function playGarrisonFight(run: RtRunState): FightResult {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const params = rtArenaParams(run, PARAMS), loadout = rtArenaLoadout(run);
  if (params.purse || params.doorDie) throw new Error(`fight ${pending.arena}: the cauldron or the die is on`);
  const eliteLoot = new Set<number>(), kinds = new Set<string>(), affixSeen = new Set<string>();
  let lootElite = 0, lootSlot = 0, lootItems = 0, slot = false, pulls = 0, chest = false, chestLifted = false, chains = 0, links = 0;
  let heals = 0, healLoot = 0, severed = false, eliteSeen = false;
  const seen = (w: World): void => {
    for (const e of w.enemies) { kinds.add(e.kind); if (e.elite) { eliteSeen = true; for (const a of e.affixes ?? []) affixSeen.add(a); } }
    for (const ev of w.events) {
      if (ev.type === 'loot') {
        if (!ev.picked) eliteLoot.add(ev.objectId);
        else if (isResource(ev.loot)) { if (eliteLoot.has(ev.objectId)) lootElite++; else lootSlot++; }
        else { lootItems++; if (ev.loot === 'healing') healLoot++; }
      } else if (ev.type === 'slot') { if (ev.action === 'appear') slot = true; if (ev.action === 'pull') pulls++; }
      else if (ev.type === 'chest') chest = true;
      else if (ev.type === 'curseLifted') chestLifted = true;
      else if (ev.type === 'partSevered') severed = true;
      else if (ev.type === 'chainEnd' && ev.kills > 0) { chains++; links += ev.kills; }
      else if (ev.type === 'item' && ev.kind === 'healing') heals++;
    }
  };
  // The economy bot's stay after the goals: while the bag is not full or the feat not done, HP ≥ 4, at most 45 s («на арене» — to its N).
  const stay = (w: World): boolean => {
    const feat = featProgress(w), since = w.time - (w.greedStart ?? w.time);
    const bagDue = !!w.bag && w.bag.step < BAG_STEPS, featDue = !!feat && !feat.done;
    const limit = featDue && feat!.kind === 'arena' ? Math.max(STAY_AFTER_GOALS, feat!.target - (w.greedStart ?? 0) + 1) : STAY_AFTER_GOALS;
    return !EXIT_AT_GOALS && (bagDue || featDue) && w.hero.hp - buffer >= 4 && since <= limit;
  };
  const buffer = MORTAL ? 0 : BUFFER;
  let minHp = run.hp;
  const watch = (w: World): void => { seen(w); minHp = Math.min(minHp, w.hero.hp - buffer); };
  const played = botFight(run, { params, loadout, limit: LIMIT, aim: BOSS_CORES, stay, seen: watch, buffer }), w = played.sim.world;
  if (w.oath) throw new Error(`fight ${pending.arena}: an oath is on`);
  if (!MORTAL && played.timeout) throw new StuckFight(`fight ${pending.arena} seed ${pending.seed}: over ${LIMIT} s`);
  if (!MORTAL && w.status !== 'victory') throw new Error(`fight ${pending.arena} seed ${pending.seed}: ${w.status} at ${w.time.toFixed(1)} s`);
  const outcome: RtArenaOutcome = {
    ...outcomeOf(run, w), ...MORTAL ? {} : { hp: Math.max(1, Math.min(run.maxHp, w.hero.hp - buffer)) }, kinds: [...kinds].sort(), ...eliteSeen ? { elite: true } : {}, ...affixSeen.size ? { affixes: [...affixSeen].sort() } : {}, ...severed ? { severed: true } : {},
  };
  const bagPaid = Object.values(bagPayout(w) ?? {}).reduce((a, b) => a + (b ?? 0), 0), featNow = featProgress(w);
  return {
    outcome,
    record: { arena: pending.arena,
      lootElite, lootSlot, lootItems, slotRight: !!w.kit && !!loadout.slot, slot, pulls, chains, links, bestChain: w.stats.bestChain, chest, chestLifted, damage: w.stats.damageTaken, wouldDie: MORTAL ? w.status !== 'victory' : minHp <= 0, time: w.endTime ?? w.time, fbGoals: false, fbDoor: false, exitBy: 'none', hpIn: run.hp, heals, healLoot,
      bagStep: w.bag ? w.bag.step : null, bagPaid: w.status === 'victory' ? bagPaid : 0, featKind: featNow?.kind ?? null, featDone: !!featNow?.done, featReward: pending.feat ? ('talisman' in pending.feat.reward ? 'talisman' : 'resources') : null, featPaid: 0, severed, ...played.timeout ? { timeout: true } : {} },
  };
}

// ---------- The run walker ----------

function walkRun(k: number): RunRecord {
  const seed = seedOf(k);
  // Update 16.10.2026: `--garrison off` — the forest only (the garrison after the forest final is not measured); `on` — the meta
  // run with the camp's flags (the cart on «Предместье») through the forest and the garrison.
  const meta = GARRISON ? { garrison: true, locked: [], hearth: { maps: 2 as const, startItems: rtHearthItems(seed, 1) } } : { garrison: false };
  let run = createRtRun(seed, { gift: 'full', feats: FEATS, ...meta, ...GENTLE ? {} : RT_TASK17_OFF, ...SCHEDULE ? { schedule: [] } : {}, ...HERO ? { hero: HERO } : {} });
  const rec: RunRecord = { k, seed, result: 'none', ...newLevel() };
  /** The level the walk accounts to: the forest, then (`--garrison on`, after «Предместье») the garrison. */
  let cur: LevelRecord = rec;
  let hpForestEnd: number | null = null, hpCastellan: number | null = null, cartStock: number | null = null, cart: number | null = null;
  /** Signed per-kind change from `before` to `after`: gains to `gainKey`, losses to `spendKey`. */
  const account = (before: Record<ResourceKind, number>, after: RtRunState, gainKey: string, spendKey: string): void => {
    for (const kind of RESOURCE_KINDS) { const d = after.materials[kind] - before[kind]; if (d > 0) add(cur.gain, gainKey, d); else if (d < 0) add(cur.spend, spendKey, -d); }
  };
  let eventAttempts = 0;

  for (let step = 0; step < 400 && !run.result; step++) {
    const pending = run.pending;
    if (!pending) {
      const nodes = rtAvailableNodes(run);
      if (!nodes.length) throw new Error(`run ${k}: no node`);
      const rest = nodes.find(n => n.type === 'rest'), shop = nodes.find(n => n.type === 'shop');
      const node = run.hp <= run.maxHp * 0.5 && rest ? rest : total(run) >= 6 && shop ? shop : nodes[hash(seed, step) % nodes.length];
      const row = runRow(node.row);
      if (cur.rowStart[row] === undefined) cur.rowStart[row] = total(run);
      cur.lastRow = Math.max(cur.lastRow, row);
      const before = materials(run);
      run = ok(rtEnterNode(run, node.id, null, { goblinCircle: !!PARAMS.goblinCircle }), 'enter');
      account(before, run, 'other', 'other');
      if (run.pending?.kind === 'casino') cur.circle = true;
      eventAttempts = 0;
      continue;
    }
    const before = materials(run);
    switch (pending.kind) {
      case 'gift': {
        // Task 50: the archetype row of the gift `full` — «Без повадки», the measure of before.
        if (rtGiftView(run)?.habit && !rtGiftView(run)!.habit!.chosen) run = ok(rtChooseHabit(run, null), 'habit');
        const view = rtGiftView(run)!, on = view.options.filter(entry => entry.available);
        if (view.chosen !== null) { run = ok(rtChooseGiftPick(run, view.picks[0]), 'gift pick'); account(before, run, 'gift', 'gift'); break; }
        const pick = on.length ? on[k % on.length].index : null;
        run = ok(rtChooseGift(run, pick), 'gift');
        account(before, run, 'gift', 'gift');
        break;
      }
      case 'battle': {
        // Task 15 «Лечение на карте»: on the battle card, while HP ≤ 50 % and the price is in hand.
        while (run.hp <= run.maxHp * 0.5 && healOffer(run).ok) {
          const hp0 = run.hp, t0 = total(run);
          run = ok(healOnMap(run), 'heal on map');
          cur.mapHeals++; cur.mapHealHp += run.hp - hp0; add(cur.spend, 'heal-map', t0 - total(run));
        }
        const healed = materials(run);
        for (const kind of RESOURCE_KINDS) before[kind] = healed[kind];
        const node = rtNode(run, pending.nodeId)!, row = runRow(node.row);
        let fought: FightResult;
        if (GARRISON && pending.arena === GARRISON_FINAL_ARENA) hpCastellan = run.hp;
        try { fought = GARRISON_BOT ? playGarrisonFight(run) : playFight(run); } catch (error) { if (error instanceof StuckFight) { rec.result = 'stuck'; return rec; } throw error; }
        const fight: FightRecord = { ...fought.record, row, battle: pending.battle };
        if (fight.wouldDie && cur.firstDeathRow === null) cur.firstDeathRow = row;
        cur.fights.push(fight);
        // The porcupine is met where the arena brings it — not where the run takes it out (task 17: a gentle run's final, `withoutKinds`).
        if (cur.porcupineRow === null && arenaNewKinds(pending.arena).includes('porcupine') && !(rtArenaLoadout(run).withoutKinds ?? []).includes('porcupine')) cur.porcupineRow = row;
        run = ok(resolveArena(run, fought.outcome), 'resolve');
        if (node.type === 'boss' && !rtGarrisonNodeId(node.id) && fought.outcome.won) hpForestEnd = run.hp;
        // Loot picked up on the arena: elite loot and the goblin's 🍲 (resources only), then the door: the bag and a done feat's
        // resources (update 15.10.2026); anything else the door paid is «Прочее». A defeat (`--garrison on`) brings nothing back.
        if (!fought.outcome.won) break;
        add(cur.gain, 'elite-loot', fight.lootElite); add(cur.gain, 'slot', fight.lootSlot);
        const delta = total(run) - stockTotal(before) - fight.lootElite - fight.lootSlot;
        fight.featPaid = pending.feat && fight.featDone && 'resources' in pending.feat.reward ? pending.feat.reward.resources : 0;
        add(cur.gain, 'bag', fight.bagPaid); add(cur.gain, 'feat', fight.featPaid);
        add(cur.gain, 'other', delta - fight.bagPaid - fight.featPaid);
        break;
      }
      case 'talisman': {
        const reroll = rtRerollView(run);
        if (reroll?.available && reroll.rerolls === 0 && reroll.total >= 3) {
          run = ok(rtRerollTalismans(run), 'reroll');
          const spent = stockTotal(before) - total(run);
          add(cur.spend, 'reroll', spent); add(cur.rerollBy, pending.source, spent);
          break;
        }
        const options = (run.pending as Extract<RtRunState['pending'], { kind: 'talisman' }>).options;
        run = ok(rtChooseTalisman(run, options[0] ?? null), 'talisman');
        account(before, run, 'other', 'other');
        break;
      }
      case 'hammer': run = ok(rtChooseHammer(run, pending.options[k % pending.options.length] ?? null), 'hammer'); break;
      case 'find': run = ok(rtChooseFind(run, pending.options.find(item => !rtItemRefusal(run, item)) ?? pending.options[0]), 'find'); break;
      case 'rest': {
        const view = rtRestView(run)!;
        const recipes = view.recipes.filter(entry => entry.available);
        if (run.hp > run.maxHp * 0.7 && recipes.length) {
          for (const recipe of recipes.slice(0, 2)) run = ok(rtRestCraft(run, recipe.resource), 'craft');
          run = ok(rtRestFinish(run), 'rest finish');
          account(before, run, 'other', 'craft');
        } else { const hp0 = run.hp; run = ok(rtRestHeal(run), 'rest'); cur.restHp += run.hp - hp0; }
        break;
      }
      case 'shop': {
        for (let n = 0; n < 6; n++) {
          const view = rtShopView(run)!;
          const heal = view.goods.find(g => g.good === 'heal' && g.available && run.hp <= run.maxHp - 3);
          const good = heal ?? view.goods.find(g => g.good === 'talisman' && g.available) ?? view.goods.find(g => g.good === 'harden' && g.available && view.total - g.price >= 2);
          if (!good) break;
          const t0 = total(run);
          run = ok(rtShopBuy(run, good.id), 'buy');
          add(cur.shopBy, good.good, t0 - total(run));
        }
        run = ok(rtShopLeave(run), 'shop leave');
        account(before, run, 'other', 'merchant');
        break;
      }
      case 'event': {
        const view = rtEventView(run)!;
        const open = view.options.filter(entry => entry.available && !entry.off);
        const risky = open.filter(entry => !entry.safe && !(entry.attempts && eventAttempts >= 1));
        const pick = risky[0] ?? open.find(entry => entry.safe) ?? open[0];
        run = ok(rtChooseEventOption(run, pick.id), 'event');
        if (pick.attempts) eventAttempts++;
        account(before, run, 'event', 'event');
        break;
      }
      case 'casino': {
        const view = rtCasinoView(run)!, dice = view.tables.find(t => t.table === 'dice')!;
        if (dice.available) {
          run = ok(rtCasinoPlay(run, 'dice'), 'dice');
          const game = run.casino!.games[run.casino!.games.length - 1];
          add(cur.spend, 'circle', 1); add(cur.gain, 'circle', game.gain.length);
          cur.circleGames++; if (game.gain.length) cur.circleWins++;
        } else run = ok(rtCasinoLeave(run), 'casino leave');
        break;
      }
      // Task 40: «Предместье» — «В гарнизон» with the cart's default («оставить 6»); the forest's part ends with the stock here.
      case 'outskirts': {
        cur.endTotal = cartStock = total(run);
        run = ok(rtEnterGarrison(run), 'garrison');
        cart = run.cart?.n ?? 0;
        cur = rec.garrison = newLevel();
        break;
      }
      default: throw new Error(`run ${k}: pending ${(pending as { kind: string }).kind}`);
    }
  }
  rec.result = run.result?.outcome ?? 'unfinished';
  cur.endTotal = total(run);
  if (GARRISON) {
    const carry = rtCarry(run), resources = carry.resources, sent = carry.cart ?? 0;
    const uncapped = carry.share === 1 ? sent + resources : sent + Math.max(Math.floor(resources * 0.5), Math.min(resources, 6));
    const node = run.result?.outcome === 'defeat' ? rtNode(run, run.result.nodeId) : undefined;
    rec.end = {
      deathAt: node ? `${rtGarrisonNodeId(node.id) ? 'г' : 'л'} ${runRow(node.row)}` : null, maxHp: run.maxHp, hpForestEnd, hpCastellan, cartStock, cart,
      carry: carry.n, carryCap: carry.cap, resources, carryUncapped: uncapped,
    };
  }
  return rec;
}

// ---------- Workers ----------

async function collect(): Promise<RunRecord[]> {
  if (WORKERS <= 1 || RUNS < 4) return Array.from({ length: RUNS }, (_, i) => walkRun(FROM + i));
  const per = Math.ceil(RUNS / WORKERS), script = fileURLToPath(import.meta.url), jobs: Promise<RunRecord[]>[] = [];
  for (let w = 0; w < WORKERS; w++) {
    const from = FROM + w * per, count = Math.min(per, FROM + RUNS - from);
    if (count <= 0) break;
    jobs.push(new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, script, '--child', '--from', String(from), '--runs', String(count), '--garrison', GARRISON ? 'on' : 'off', ...MORTAL ? ['--mortal'] : [], '--bot', GARRISON_BOT ? 'garrison' : 'economy', '--max-links', String(MAX_LINKS), '--gentle', GENTLE ? 'on' : 'off', '--feats', FEATS ? 'on' : 'off', '--schedule', SCHEDULE ? 'new' : 'off', ...EXIT_AT_GOALS ? ['--exit-at-goals'] : [], ...HERO ? ['--hero', HERO] : []], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('close', code => code === 0 ? resolve(JSON.parse(out) as RunRecord[]) : reject(new Error(`worker ${w} exited ${code}`)));
    }));
  }
  return (await Promise.all(jobs)).flat().sort((a, b) => a.k - b.k);
}

// ---------- Tables ----------

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const q = (xs: number[], p: number): number => { const s = sorted(xs); if (!s.length) return NaN; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const mean = (xs: number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const f1 = (x: number): string => Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—';
const f0 = (x: number): string => Number.isFinite(x) ? String(Math.round(x)) : '—';
const pct = (a: number, b: number): string => b ? `${Math.round(100 * a / b)} %` : '—';
const stat = (xs: number[]): string => `${f1(mean(xs))} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.1))} | ${f1(q(xs, 0.9))}`;
const BANDS: [string, number, number][] = [['1–3', 1, 3], ['4–6', 4, 6], ['7–10', 7, 10]];

/** A level's part of the runs with the run's index and result (the forest's — «victory» once the run reached «Предместье»). */
type LevelView = LevelRecord & { k: number; result: string };

function report(runs: LevelView[], title: string): void {
  console.log(`\n### ${title}: ${runs.length} походов (k = ${runs[0]?.k}…${runs[runs.length - 1]?.k})`);
  const fights = runs.flatMap(r => r.fights), won = runs.filter(r => r.result === 'victory').length;
  const died = runs.filter(r => r.firstDeathRow !== null);
  console.log(`Итог: дошли до конца ${won} из ${runs.length}; боёв ${fights.length} (${f1(fights.length / runs.length)} за поход); «${DIE}» хотя бы раз — ${pct(died.length, runs.length)} походов (первый раз: медиана ряда ${f0(q(died.map(r => r.firstDeathRow!), 0.5))}); боёв «${DIE}» ${pct(fights.filter(f => f.wouldDie).length, fights.length)}.`);
  if (GARRISON_BOT) console.log(`Бой бота гарнизона за пределом ${LIMIT} с${MORTAL ? ' (поражение)' : ''}: ${fights.filter(f => f.timeout).length}. Время боя: медиана ${f0(q(fights.map(f => f.time), 0.5))} с, p90 ${f0(q(fights.map(f => f.time), 0.9))} с.`);
  else console.log(`Запасные ходы бота: команда целей ${fights.filter(f => f.fbGoals).length}, телепорт к двери ${fights.filter(f => f.fbDoor).length}. Время боя: медиана ${f0(q(fights.map(f => f.time), 0.5))} с, p90 ${f0(q(fights.map(f => f.time), 0.9))} с. Выход: цепью в дверь ${pct(fights.filter(f => f.exitBy === 'chain').length, fights.length)}, ходьбой ${pct(fights.filter(f => f.exitBy === 'walk').length, fights.length)}.`);
  console.log(`Цепи бота: ${f1(mean(fights.map(f => f.chains)))} за бой, вражеских звеньев в цепи в среднем ${f1(fights.reduce((s, f) => s + f.links, 0) / Math.max(1, fights.reduce((s, f) => s + f.chains, 0)))}; самая длинная цепь боя (убийств): медиана ${f0(q(fights.map(f => f.bestChain), 0.5))}, p90 ${f0(q(fights.map(f => f.bestChain), 0.9))}.`);

  const per = (pick: (r: LevelView) => number): number[] => runs.map(pick);
  console.log('\n1. Получено ресурсов за поход, по источникам\n');
  console.log('| Источник | Среднее | Медиана | p10 | p90 |');
  console.log('| --- | --- | --- | --- | --- |');
  const gainKeys = ['bag', 'feat', 'elite-loot', 'slot', 'circle', 'event', 'gift', 'other'];
  const label: Record<string, string> = { bag: 'Котомка у двери', feat: 'Подвиги (ресурсами)', 'heal-map': 'Лечение на карте', 'elite-loot': 'Добыча элит', slot: 'Гоблин (🍲)', circle: 'Игорный круг (выигрыши)', event: 'События', gift: 'Дар', other: 'Прочее', merchant: 'Торговец', reroll: 'Переброс', craft: 'Крафт' };
  for (const key of gainKeys) console.log(`| ${label[key]} | ${stat(per(r => r.gain[key] ?? 0))} |`);
  console.log(`| Сундук | 0 — ресурсов не даёт (экран талисманов) | | | |`);
  console.log(`| **Всего получено** | ${stat(per(r => Object.values(r.gain).reduce((a, b) => a + b, 0)))} |`);

  console.log('\n2. Потрачено ресурсов за поход\n');
  console.log('| Сток | Среднее | Медиана | p10 | p90 |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const key of ['heal-map', 'merchant', 'reroll', 'craft', 'circle', 'event', 'gift', 'other']) console.log(`| ${key === 'circle' ? 'Игорный круг (ставки)' : label[key] ?? key} | ${stat(per(r => r.spend[key] ?? 0))} |`);
  console.log(`| **Всего потрачено** | ${stat(per(r => Object.values(r.spend).reduce((a, b) => a + b, 0)))} |`);
  console.log(`| Осталось в конце похода | ${stat(per(r => r.endTotal))} |`);
  const shop = (good: string) => mean(per(r => r.shopBy[good] ?? 0));
  console.log(`\nТорговец по товарам (среднее за поход): лечение ${f1(shop('heal'))}, талисман ${f1(shop('talisman'))}, закалка ${f1(shop('harden'))}. Переброс по экранам: «Застава» ${f1(mean(per(r => r.rerollBy.hard ?? 0)))}, событие ${f1(mean(per(r => r.rerollBy.event ?? 0)))}, сундук ${f1(mean(per(r => r.rerollBy.chest ?? 0)))}.`);
  const circles = runs.filter(r => r.circle);
  console.log(`Игорный круг встал в ${pct(circles.length, runs.length)} походов; игр ${circles.reduce((s, r) => s + r.circleGames, 0)}, выигрышей ${pct(circles.reduce((s, r) => s + r.circleWins, 0), circles.reduce((s, r) => s + r.circleGames, 0))}; чистый итог круга за поход с кругом: ${f1(mean(circles.map(r => (r.gain.circle ?? 0) - (r.spend.circle ?? 0))))}.`);

  console.log('\n3. Ресурсы на руках в начале ряда\n');
  console.log('| Ряд | Походов | Медиана | p25 | p75 | Среднее |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (let row = 1; row <= 10; row++) {
    const xs = runs.flatMap(r => r.rowStart[row] !== undefined ? [r.rowStart[row]] : []);
    if (xs.length) console.log(`| ${row} | ${xs.length} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.25))} | ${f1(q(xs, 0.75))} | ${f1(mean(xs))} |`);
  }

  console.log('\n4. По полосам рядов: получено за бой (среднее)\n');
  console.log('| Ряды | Боёв | Добыча элит | Гоблин | Гоблин пришёл (из боёв с правом) | Рывков рычага |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [name, lo, hi] of BANDS) {
    const fs = fights.filter(f => f.row >= lo && f.row <= hi);
    console.log(`| ${name} | ${fs.length} | ${f1(mean(fs.map(f => f.lootElite)))} | ${f1(mean(fs.map(f => f.lootSlot)))} | ${pct(fs.filter(f => f.slot).length, fs.filter(f => f.slotRight).length)} | ${f1(mean(fs.filter(f => f.slot).map(f => f.pulls)))} |`);
  }
  const lootRuns = runs.filter(r => (r.gain['elite-loot'] ?? 0) >= 10);
  console.log(`\nДобыча элит ресурсами: 10+ за поход в ${pct(lootRuns.length, runs.length)} походов (в них среднее ${f1(mean(lootRuns.map(r => r.gain['elite-loot'] ?? 0)))}); в остальных ${f1(mean(runs.filter(r => (r.gain['elite-loot'] ?? 0) < 10).map(r => r.gain['elite-loot'] ?? 0)))}.`);
  const outposts = fights.filter(f => f.arena === 'outpost' && f.battle === 'hard');
  console.log(`\n5. Сундук: боёв «Заставы» (трудный узел) ${outposts.length}; сундук взят ${pct(outposts.filter(f => f.chest).length, outposts.length)}, проклятие снято ${pct(outposts.filter(f => f.chestLifted).length, outposts.filter(f => f.chest).length)} взятых. Добыча элит предметом (не ресурсом): ${f1(mean(per(r => r.fights.reduce((s, f) => s + f.lootItems, 0))))} за поход.`);
  // Task 17: the row of the first fight with the porcupine (its own arena or a mixed one).
  const porc = new Map<string, number>();
  for (const r of runs) porc.set(String(r.porcupineRow ?? '—'), (porc.get(String(r.porcupineRow ?? '—')) ?? 0) + 1);
  console.log(`\nДикобраз впервые (ряд первого боя на арене с ним; «—» — не встречен): ${[...porc].sort().map(([row, n]) => `${row}: ${n}`).join(', ')} из ${runs.length}.`);
  // Task 17 «Пологий вход» (13.10.2026): the curve by run row.
  console.log(`\n6. По рядам (задача 17; вход ${GENTLE ? 'пологий' : 'прежний'}; урон — HP за бой, «${DIE}» — бой, где ${MORTAL ? 'герой пал или вышло время' : 'настоящее HP дошло до 0'})\n`);
  console.log(`| Ряд | Боёв | Урон: среднее | медиана | p90 | «${MORTAL ? 'Погиб' : 'Погиб бы'}» | HP в начале боя, медиана | Лечений выпито за бой | Лечения из добычи за бой |`);
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (let row = 1; row <= 10; row++) {
    const fs = fights.filter(f => f.row === row);
    if (!fs.length) continue;
    const ds = fs.map(f => f.damage);
    console.log(`| ${row} | ${fs.length} | ${f1(mean(ds))} | ${f1(q(ds, 0.5))} | ${f1(q(ds, 0.9))} | ${pct(fs.filter(f => f.wouldDie).length, fs.length)} | ${f1(q(fs.map(f => f.hpIn), 0.5))} | ${f1(mean(fs.map(f => f.heals)))} | ${f1(mean(fs.map(f => f.healLoot)))} |`);
  }
  // Update 15.10.2026: the run's sources now — the bag, the feats — and the map heal, by row band.
  console.log(`\n7. Котомка, подвиги, лечение на карте (подвиги ${FEATS ? 'есть — игрок дошёл до Тюремщика раньше' : 'нет — первый поход'}; бот после целей остаётся, пока котомка не полна или подвиг не сделан, не дольше ${STAY_AFTER_GOALS} с; подвиг «на арене» — до своего N)\n`);
  console.log('| Ряды | Боёв | С котомкой | Ступеней котомки: 0 / 1 / 2 / 3 | Котомка, ресурсов за бой с ней | Боёв с подвигом | Подвиг сделан | Подвиг: ресурсов за бой с ним |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, lo, hi] of [['все', 1, 10] as [string, number, number], ...BANDS]) {
    const fs = fights.filter(f => f.row >= lo && f.row <= hi), bag = fs.filter(f => f.bagStep !== null), feat = fs.filter(f => f.featKind);
    const steps = [0, 1, 2, 3].map(s => pct(bag.filter(f => f.bagStep === s).length, bag.length)).join(' / ');
    console.log(`| ${name} | ${fs.length} | ${bag.length} | ${steps} | ${f1(mean(bag.map(f => f.bagPaid)))} | ${feat.length} | ${pct(feat.filter(f => f.featDone).length, feat.length)} | ${f1(mean(feat.map(f => f.featPaid)))} |`);
  }
  const featFs = fights.filter(f => f.featKind);
  const byKind = (['score', 'afterGoals', 'arena'] as FeatKind[]).map(kind => { const fs = featFs.filter(f => f.featKind === kind); return `${kind} ${pct(fs.filter(f => f.featDone).length, fs.length)} из ${fs.length}`; }).join(', ');
  const talismanFeats = featFs.filter(f => f.featReward === 'talisman');
  console.log(`Подвиг сделан по видам: ${byKind}. Награда — выбор талисмана: ${talismanFeats.length} боёв, сделано ${pct(talismanFeats.filter(f => f.featDone).length, talismanFeats.length)}.`);
  console.log(`Лечение на карте: ${f1(mean(per(r => r.mapHeals)))} покупок за поход (походов с покупкой ${pct(runs.filter(r => r.mapHeals > 0).length, runs.length)}), HP за поход ${f1(mean(per(r => r.mapHealHp)))}, ресурсов ${f1(mean(per(r => r.spend['heal-map'] ?? 0)))}. Тюремщик: гиря отрублена в ${pct(fights.filter(f => f.severed).length, fights.filter(f => f.arena.startsWith('jailer')).length)} боёв с ним.`);
}

/** `--garrison on`: where the runs ended, each level's tables, the cart and the carry (section 8), HP (section 9). */
function garrisonReport(runs: RunRecord[]): void {
  const ends = runs.map(r => r.end!), inG = runs.filter(r => r.garrison);
  const deaths = new Map<string, number>();
  for (const e of ends) if (e.deathAt) deaths.set(e.deathAt, (deaths.get(e.deathAt) ?? 0) + 1);
  const order = (key: string): number => (key.startsWith('г') ? 100 : 0) + Number(key.slice(2));
  console.log(`\nИтог: ${runs.length} походов; побед (Кастелян) ${runs.filter(r => r.result === 'victory').length}, поражений ${runs.filter(r => r.result === 'defeat').length}, не закончено ${runs.filter(r => r.result !== 'victory' && r.result !== 'defeat').length}; дошли до «Предместья» ${inG.length}.`);
  console.log(`Смерти по рядам (л — лес, г — гарнизон): ${[...deaths].sort((a, b) => order(a[0]) - order(b[0])).map(([key, n]) => `${key}: ${n}`).join(', ') || '—'}.`);
  report(runs.map(r => ({ ...r, result: r.garrison ? 'victory' : r.result })), 'Лес (все походы; «до конца» — до «Предместья»)');
  if (inG.length) report(inG.map(r => ({ ...r.garrison!, k: r.k, result: r.result })), 'Гарнизон (походы, дошедшие до «Предместья»; «до конца» — Кастелян побеждён)');
  const per = (list: RunRecord[], pick: (e: RunEnd) => number): number[] => list.map(r => pick(r.end!));
  const gained = (l: LevelRecord): number => Object.values(l.gain).reduce((a, b) => a + b, 0), spent = (l: LevelRecord): number => Object.values(l.spend).reduce((a, b) => a + b, 0);
  console.log('\n8. Повозка и вынос (за поход)\n');
  console.log('| Величина | Походов | Среднее | Медиана | p10 | p90 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const row = (name: string, xs: number[]): void => console.log(`| ${name} | ${xs.length} | ${stat(xs)} |`);
  row('Лес: получено', runs.map(r => gained(r)));
  row('Лес: потрачено', runs.map(r => spent(r)));
  row('На руках у «Предместья»', per(inG, e => e.cartStock!));
  row('Повозка взяла', per(inG, e => e.cart!));
  row('Гарнизон: на руках при входе (после Повозки)', per(inG, e => e.cartStock! - e.cart!));
  row('Гарнизон: получено', inG.map(r => gained(r.garrison!)));
  row('Гарнизон: потрачено', inG.map(r => spent(r.garrison!)));
  row('На руках в конце похода (дошедшие до гарнизона)', per(inG, e => e.resources));
  row('Вынос, дошедшие до гарнизона (потолок 40)', per(inG, e => e.carry));
  row('Вынос без потолка, дошедшие до гарнизона', per(inG, e => e.carryUncapped));
  const forestOnly = runs.filter(r => !r.garrison);
  row('Вынос, павшие в лесу (потолок 20)', per(forestOnly, e => e.carry));
  const capHit = (list: RunRecord[]): string => `${pct(list.filter(r => r.end!.carryUncapped >= r.end!.carryCap).length, list.length)} (выше потолка ${pct(list.filter(r => r.end!.carryUncapped > r.end!.carryCap).length, list.length)})`;
  const won = inG.filter(r => r.result === 'victory'), lost = inG.filter(r => r.result !== 'victory');
  console.log(`\nПотолок выноса достигнут: павшие в лесу — ${capHit(forestOnly)} из ${forestOnly.length}; дошедшие до гарнизона — ${capHit(inG)} из ${inG.length} (победа над Кастеляном — ${capHit(won)} из ${won.length}, павшие в гарнизоне — ${capHit(lost)} из ${lost.length}).`);
  const full = inG.filter(r => r.end!.cart === RT_CART_MAX), none = inG.filter(r => r.end!.cart === 0);
  console.log(`Повозка: взяла ${RT_CART_MAX} (её наибольшее) в ${pct(full.length, inG.length)} походов, 0 — в ${pct(none.length, inG.length)}; на руках у «Предместья» больше ${RT_CART_MAX + RT_CART_KEEP} (остаток сверх «оставить ${RT_CART_KEEP}» не влез) — ${pct(inG.filter(r => r.end!.cartStock! > RT_CART_MAX + RT_CART_KEEP).length, inG.length)}. Доля Повозки в выносе дошедших до гарнизона: ${pct(inG.reduce((a, r) => a + r.end!.cart!, 0), inG.reduce((a, r) => a + r.end!.carry, 0))}.`);
  console.log('\n9. HP (из максимума; лечение добычей за бой — в разделах 6 обоих уровней)\n');
  console.log('| Точка | Походов | Медиана | p10 | p90 | Максимум HP, медиана |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const hp = (name: string, list: RunRecord[], pick: (e: RunEnd) => number | null): void => {
    const xs = list.flatMap(r => { const v = pick(r.end!); return v === null ? [] : [v]; });
    console.log(`| ${name} | ${xs.length} | ${f1(q(xs, 0.5))} | ${f1(q(xs, 0.1))} | ${f1(q(xs, 0.9))} | ${f1(q(list.map(r => r.end!.maxHp), 0.5))} |`);
  };
  hp('После финала леса (до «Предместья», оно лечит до полного)', inG, e => e.hpForestEnd);
  hp('Вход в бой с Кастеляном (после лечения на карте)', runs.filter(r => r.end!.hpCastellan !== null), e => e.hpCastellan);
  const fightsG = inG.flatMap(r => r.garrison!.fights), fightsF = runs.flatMap(r => r.fights);
  console.log(`\nЛечение добычей за бой: лес ${f1(mean(fightsF.map(f => f.healLoot)))}, гарнизон ${f1(mean(fightsG.map(f => f.healLoot)))}; выпито за бой: лес ${f1(mean(fightsF.map(f => f.heals)))}, гарнизон ${f1(mean(fightsG.map(f => f.heals)))}. Лечение HP за поход (лес / гарнизон): на карте ${f1(mean(runs.map(r => r.mapHealHp)))} / ${f1(mean(inG.map(r => r.garrison!.mapHealHp)))}, привал ${f1(mean(runs.map(r => r.restHp)))} / ${f1(mean(inG.map(r => r.garrison!.restHp)))}.`);
}

async function main(): Promise<void> {
  if (CHILD) { process.stdout.write(JSON.stringify(Array.from({ length: RUNS }, (_, i) => walkRun(FROM + i)))); return; }
  const t0 = Date.now();
  console.log(`Аудит экономики похода (эвристика бота): seed k = ${FROM}…${FROM + RUNS - 1}, ${GARRISON ? `лес и гарнизон (мета: лагерь, Повозка «оставить ${RT_CART_KEEP}»), ${GARRISON_BOT ? `бот гарнизона (в ядро у босса, после целей — котомка и подвиг), бой до ${LIMIT} с, ${MORTAL ? 'герой смертен' : 'герой не падает (+1000 HP)'}` : 'бот аудита экономики, герой не падает (+1000 HP)'}` : 'только лес'}, звеньев в цепи не больше ${MAX_LINKS >= 99 ? '— (жадный)' : MAX_LINKS}${EXIT_AT_GOALS ? ', к двери сразу после целей' : ''}, вход ${GENTLE ? 'пологий (задача 17)' : 'прежний'}, подвиги ${FEATS ? 'есть' : 'нет'}${SCHEDULE ? ', расписание леса: новый зритель (задача 26)' : ''}, воркеров ${WORKERS}`);
  const collected = await collect(), stuck = collected.filter(r => r.result === 'stuck');
  if (stuck.length) console.log(`\nБот застрял в бою (время вышло) в ${stuck.length} походах — они не в таблицах: k = ${stuck.map(r => r.k).join(', ')}`);
  const runs = collected.filter(r => r.result !== 'stuck');
  if (!GARRISON) report(runs, 'Походы');
  else garrisonReport(runs);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(runs));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} с`);
}

main().catch(error => { console.error(error); process.exit(1); });
