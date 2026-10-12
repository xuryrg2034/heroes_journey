/**
 * Run economy audit (design request 12.10.2026; docs/realtime-casino.md, «Аудит экономики похода»). A heuristic for the design,
 * not a test: whole runs are walked through the run's own functions (rtRun.ts) with a fixed simple policy, and every arena is a
 * real fight of the Simulation with the run's params (`rtRunParams`: cauldron, oath stake, door die, П4, П3, slot, cursed chest)
 * played by a greedy bot through journal commands (chains through `planChain`, walking along a flow field, consumables).
 *
 * Usage: npm run realtime:economy -- [--runs N] [--from K] [--oath smart|never|always|all] [--max-links N] [--exit-at-goals] [--workers W] [--json FILE]
 *   seeds `Math.imul(k, 2654435761) >>> 0`, k = from … from + runs − 1 (default 1 … 300); `--oath all` walks the same seeds
 *   under the three oath policies. Deterministic for a given seed range and policy (workers only split the range).
 *
 * Method and limits (also in the document):
 * - The hero cannot fall in a fight: he starts with run HP + 1000 (`BUFFER`); every hit still lands (П4 loses its step, oaths
 *   break, the curse adds +1). The run's HP after a fight is the real one (HP − damage, at least 1). A fight where the real HP
 *   reached 0 is counted as «would die» — the run goes on (whole runs), the share is reported.
 * - The bot never jumps and never spins (Q). It uses healing at real HP ≤ 4 and a bomb / fire / frost into a crowd.
 * - Fallbacks: goals not met in 150 s — the debug command `goals`; the door not reached 25 s after deciding to leave — a
 *   teleport next to the door. Both are counted.
 * - Map policy: a rest when HP ≤ 50 %, a merchant with 6+ resources, otherwise a node by a hash of the seed and the step.
 * - Oath policies: smart — «Цепи 3+», else «Цепь 6+ хотя бы раз», else none (`SMART_OATHS`; until 12.10.2026 «Без прыжков»
 *   first); never; always — the first offered.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runRow } from '../src/realtime/run/arenaPools';
import {
  createRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtCasinoLeave, rtCasinoPlay, rtCasinoView, rtChooseEventOption, rtChooseFind,
  rtChooseGift, rtChooseGiftPick, rtChooseHammer, rtChooseTalisman, rtDieChoose, rtDieView, rtEnterNode, rtEventView, rtGiftView, rtNode,
  rtOathPreview, rtRerollTalismans, rtRerollView, rtRestCraft, rtRestFinish, rtRestHeal, rtRestView, rtRunParams, rtShopBuy, rtShopLeave, rtShopView,
  type RtArenaOutcome, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { RESOURCE_KINDS } from '../src/realtime/forest/resources';
import { stockTotal } from '../src/realtime/forest/merchant';
import type { ItemKind, ResourceKind } from '../src/realtime/forest/types';
import { chainAnchor, linkPoint, nextCandidates, nextObjectCandidates, planChain } from '../src/realtime/sim/chain';
import { dist, FlowField, type Vec } from '../src/realtime/sim/geometry';
import { oathMark, oathMult, type OathId } from '../src/realtime/sim/oath';
import { defaultParams, heroRadius } from '../src/realtime/sim/params';
import { greedStep, GREED_MULTS, payoutCap, purseResources, type PurseDoor } from '../src/realtime/sim/purse';
import { Simulation } from '../src/realtime/sim/simulation';
import type { ArenaObject, ChainLink, Enemy, World } from '../src/realtime/sim/world';

// ---------- Arguments ----------

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const RUNS = Number(option('--runs') ?? 300), FROM = Number(option('--from') ?? 1);
const OATH_MODE = (option('--oath') ?? 'smart') as OathPolicy | 'all';
const WORKERS = Math.max(1, Number(option('--workers') ?? Math.max(1, Math.min(6, cpus().length - 2))));
const CHILD = args.includes('--child');
const JSON_OUT = option('--json');
/** The «weak» profile: at most this many enemy links in a chain (default — no limit: the greedy bot). */
const MAX_LINKS = Number(option('--max-links') ?? 99);
/** The «hasty» profile: the bot heads for the door as soon as the goals are met (no greed, no errands). */
const EXIT_AT_GOALS = args.includes('--exit-at-goals');
type OathPolicy = 'smart' | 'never' | 'always';

const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const PARAMS = rtRunParams(defaultParams());
const BUFFER = 1000;
const TICK = 1 / 60;
/**
 * The «smart» policy: the first of these the card offers, else no oath. Re-audit 12.10.2026 (after the calibration): «Цепи 3+»
 * (the bot then releases no chain under 3 enemies after the first), else «Цепь 6+ хотя бы раз» (the bot plays as always: its
 * greedy chains often reach 6). «Без прыжков» (taken first in the audit of 11fadfd) is no longer offered by the run.
 */
const SMART_OATHS: readonly OathId[] = ['chains3', 'chain6'];

// ---------- Records ----------

interface FightRecord {
  row: number; arena: string; battle: string; oath: OathId | null; oathKept: boolean | null;
  cauldron: number; greed: number; finale: number; oathMult: number; die: 'none' | 'take' | 'roll'; face: number; dieMult: number;
  base: number; dGreed: number; dOath: number; dDie: number; dFinale: number; paid: number; cap: number; capHit: boolean; overCap: boolean; capHitTake: boolean;
  lootElite: number; lootSlot: number; lootItems: number; slotRight: boolean; slot: boolean; pulls: number; chest: boolean; chestLifted: boolean;
  chains: number; links: number; bestChain: number;
  damage: number; wouldDie: boolean; time: number; fbGoals: boolean; fbDoor: boolean; exitBy: string;
}
interface RunRecord {
  k: number; seed: number; policy: OathPolicy; result: string; lastRow: number;
  gain: Record<string, number>; spend: Record<string, number>; rowStart: Record<number, number>;
  fights: FightRecord[]; circle: boolean; circleGames: number; circleWins: number; firstDeathRow: number | null;
  rerollBy: Record<string, number>; shopBy: Record<string, number>; endTotal: number;
}

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
    const lever = greed && !ctx.leaving && (enemyLinks >= (chains3Holds(w) ? 3 : 2) || leverIdle(w)) ? objs.find(o => o.kind === 'lever') : undefined;
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

const chains3Holds = (w: World): boolean => w.oath?.id === 'chains3' && w.oath.broken === undefined;
/** The lever has been ready for 3 s without a chain of 2+ enemies to it: a bare pull is allowed (not under «Цепи 3+»). */
const leverIdle = (w: World): boolean => !!w.slot?.goblin && !w.slot.goblin.spin && w.time - w.slot.goblin.ready > 3 && !chains3Holds(w);

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

interface FightResult { outcome: RtArenaOutcome; record: Omit<FightRecord, 'row' | 'battle' | 'oath' | 'die' | 'face' | 'dieMult' | 'base' | 'dGreed' | 'dOath' | 'dDie' | 'dFinale' | 'paid' | 'cap' | 'capHit' | 'overCap' | 'capHitTake'>; door: PurseDoor | null }

function playFight(run: RtRunState): FightResult {
  const pending = run.pending;
  if (pending?.kind !== 'battle') throw new Error('no battle');
  const sim = new Simulation({ arena: pending.arena, params: PARAMS, seed: pending.seed, hero: { hp: run.hp + BUFFER, maxHp: run.maxHp + BUFFER }, loadout: rtArenaLoadout(run), ...pending.roster !== undefined ? { roster: pending.roster } : {} });
  const w = sim.world;
  const ctx: FightContext = { goal: w.arena.goal, leaving: false, chainsReleased: 0, lastChain: 0, allowChest: true };
  const hr = heroRadius(w.params);
  const field = new FlowField(w.arena, hr, { waterCost: 2, thornCost: 4 });
  const dir: Vec = { x: 0, y: 0 };
  const eliteLoot = new Set<number>();
  let lootElite = 0, lootSlot = 0, lootItems = 0, slot = false, pulls = 0, chest = false, chestLifted = false, finale = 0, chains = 0, links = 0;
  let minHp = realHp(w), lastItem = -10, leaveAt = 0, fbGoals = false, fbDoor = false, greedStart: number | null = null;
  const oathId = pending.oath ?? null;
  const slotRight = !!sim.world.kit && !!rtArenaLoadout(run).slot, chestPolicy = run.hp >= 8;
  let exitBy = 'none';

  const walkTo = (target: Vec | null, stop: number): void => {
    const hero = w.hero;
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
    if (real <= 4 && (kit?.items.healing ?? 0) > 0) sim.command({ t: 'item', kind: 'healing', x: hero.x, y: hero.y });
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
      const mark = oathMark(w), step = greedStep(w), m = mark?.mark === 'waits' ? 0.5 : oathMult(w);
      const payNow = purseResources(w.purse?.cauldron ?? 0, m, 1, w.params.purseRate ?? 60, GREED_MULTS[step]);
      const capNow = mark?.mark !== 'waits' && payNow >= payoutCap(m);
      const clean = w.oath?.id === 'clean-after-goals' && w.oath.broken === undefined;
      // Errands before the door: loot within 8, the chest, the goblin (wait for its roll, then pull while pulls are left).
      const goblin = w.slot?.goblin, slotDue = slotRight && w.slot === undefined;
      const errands = lootNear.length > 0 || !!box || slotDue || (!!goblin && goblin.pulls < (w.params.slotPulls ?? 3) && real >= 6);
      const want = step >= 3 || capNow || clean;
      if (EXIT_AT_GOALS || (want && !errands) || w.time - greedStart! > 30 || real <= 3) { ctx.leaving = true; leaveAt = w.time; }
    }
    const best = bestChain(sim, ctx);
    if (best) {
      const p = best.plan, threat = w.enemies.some(e => dist(e, hero) < 1.3);
      let accept = p.door || p.button || p.enemyLinks >= 3 || (p.enemyLinks >= 1 && (threat || w.time - ctx.lastChain > 1.5)) || (p.score >= 12 && !ctx.leaving);
      if (ctx.leaving && !p.door && !threat) accept = false;
      // «Цепи 3+»: after the first chain only 3+ enemy links, or a short chain that presses a button.
      if (chains3Holds(w) && ctx.chainsReleased >= 1 && p.enemyLinks < 3 && !p.button) accept = false;
      if (accept) {
        greedyFrom(sim, best.start, ctx);
        if (sim.command({ t: 'release' })) { ctx.chainsReleased++; ctx.lastChain = w.time; return; }
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
    sim.tick();
    for (const ev of w.events) {
      if (ev.type === 'loot') {
        if (!ev.picked) eliteLoot.add(ev.objectId);
        else if (isResource(ev.loot)) { if (eliteLoot.has(ev.objectId)) lootElite++; else lootSlot++; }
        else lootItems++;
      } else if (ev.type === 'slot') { if (ev.action === 'appear') slot = true; if (ev.action === 'pull') pulls++; }
      else if (ev.type === 'chest') chest = true;
      else if (ev.type === 'curseLifted') chestLifted = true;
      else if (ev.type === 'cheque') { chains++; links += ev.links; if (ev.door) finale += ev.total - ev.embers * (ev.heat - 1) * ev.mult; }
      else if (ev.type === 'purseDoor') exitBy = ev.by;
    }
    w.events.length = 0;
    minHp = Math.min(minHp, realHp(w));
  }
  if (w.status !== 'victory') throw new Error(`fight ${pending.arena} seed ${pending.seed}: ${w.status} at ${w.time.toFixed(1)} s`);
  const real = realHp(w);
  const door = w.purse?.door ? structuredClone(w.purse.door) : null;
  const outcome: RtArenaOutcome = {
    nodeId: pending.nodeId, won: true, hp: Math.max(1, Math.min(run.maxHp, real)), kills: w.stats.kills, bestChain: w.stats.bestChain,
    damage: w.stats.damageTaken, time: w.endTime ?? w.time,
    ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed, openItems: [...w.kit.openItems] } : {},
    ...door ? { purse: door } : {}, ...w.params.doorDie ? { doorDie: true } : {}, ...w.curse ? { chest: true } : {},
  };
  return {
    outcome, door,
    record: { arena: pending.arena, oathKept: oathId ? (door ? door.oath === 2 : null) : null, cauldron: door?.cauldron ?? 0, greed: door?.greed ?? 1, finale, oathMult: door?.oath ?? 1,
      lootElite, lootSlot, lootItems, slotRight, slot, pulls, chains, links, bestChain: w.stats.bestChain, chest, chestLifted, damage: w.stats.damageTaken, wouldDie: minHp <= 0, time: w.endTime ?? w.time, fbGoals, fbDoor, exitBy },
  };
}

// ---------- The run walker ----------

function walkRun(k: number, policy: OathPolicy): RunRecord {
  const seed = seedOf(k);
  let run = createRtRun(seed, { gift: 'full' });
  const rec: RunRecord = { k, seed, policy, result: 'none', lastRow: 0, gain: {}, spend: {}, rowStart: {}, fights: [], circle: false, circleGames: 0, circleWins: 0, firstDeathRow: null, rerollBy: {}, shopBy: {}, endTotal: 0 };
  /** Signed per-kind change from `before` to `after`: gains to `gainKey`, losses to `spendKey`. */
  const account = (before: Record<ResourceKind, number>, after: RtRunState, gainKey: string, spendKey: string): void => {
    for (const kind of RESOURCE_KINDS) { const d = after.materials[kind] - before[kind]; if (d > 0) add(rec.gain, gainKey, d); else if (d < 0) add(rec.spend, spendKey, -d); }
  };
  let pendingFight: { fight: FightRecord; door: PurseDoor | null } | null = null;
  let eventAttempts = 0;

  const finishDoor = (fight: FightRecord, door: PurseDoor | null, die: 'none' | 'take' | 'roll', face: number, dieMult: number, paid: number): void => {
    fight.die = die; fight.face = face; fight.dieMult = dieMult; fight.paid = paid;
    if (!door || door.cauldron <= 0) return;
    const g = door.greed ?? 1, rate = door.rate;
    fight.base = purseResources(door.cauldron, 1, 1, rate, 1);
    const withGreed = purseResources(door.cauldron, 1, 1, rate, g), withOath = purseResources(door.cauldron, door.oath, 1, rate, g);
    fight.dGreed = withGreed - fight.base; fight.dOath = withOath - withGreed; fight.dDie = paid - withOath;
    fight.dFinale = paid - purseResources(Math.max(0, door.cauldron - fight.finale), door.oath, dieMult, rate, g);
    fight.cap = payoutCap(door.oath * dieMult);
    fight.capHit = paid >= fight.cap;
    fight.overCap = Math.floor(door.cauldron * g * door.oath * dieMult / rate) > fight.cap;
    fight.capHitTake = withOath >= payoutCap(door.oath);
  };

  for (let step = 0; step < 400 && !run.result; step++) {
    const pending = run.pending;
    if (!pending) {
      const nodes = rtAvailableNodes(run);
      if (!nodes.length) throw new Error(`run ${k}: no node`);
      const rest = nodes.find(n => n.type === 'rest'), shop = nodes.find(n => n.type === 'shop');
      const node = run.hp <= run.maxHp * 0.5 && rest ? rest : total(run) >= 6 && shop ? shop : nodes[hash(seed, step) % nodes.length];
      const row = runRow(node.row);
      if (rec.rowStart[row] === undefined) rec.rowStart[row] = total(run);
      rec.lastRow = Math.max(rec.lastRow, row);
      const offer = rtOathPreview(run, node);
      const oath = !offer || policy === 'never' ? null : policy === 'always' ? offer[0] : (SMART_OATHS.find(id => offer.includes(id)) ?? null);
      const before = materials(run);
      run = ok(rtEnterNode(run, node.id, oath, { goblinCircle: !!PARAMS.goblinCircle }), 'enter');
      account(before, run, 'other', 'other');
      if (run.pending?.kind === 'casino') rec.circle = true;
      eventAttempts = 0;
      continue;
    }
    const before = materials(run);
    switch (pending.kind) {
      case 'gift': {
        const view = rtGiftView(run)!, on = view.options.filter(entry => entry.available);
        if (view.chosen !== null) { run = ok(rtChooseGiftPick(run, view.picks[0]), 'gift pick'); account(before, run, 'gift', 'gift'); break; }
        const pick = on.length ? on[k % on.length].index : null;
        run = ok(rtChooseGift(run, pick), 'gift');
        account(before, run, 'gift', 'gift');
        break;
      }
      case 'battle': {
        const node = rtNode(run, pending.nodeId)!, row = runRow(node.row);
        const fought = playFight(run);
        const fight: FightRecord = { ...fought.record, row, battle: pending.battle, oath: pending.oath ?? null, die: 'none', face: 0, dieMult: 1, base: 0, dGreed: 0, dOath: 0, dDie: 0, dFinale: 0, paid: 0, cap: 0, capHit: false, overCap: false, capHitTake: false };
        if (fight.wouldDie && rec.firstDeathRow === null) rec.firstDeathRow = row;
        rec.fights.push(fight);
        run = ok(resolveArena(run, fought.outcome), 'resolve');
        // Loot picked up on the arena: elite loot and the goblin's 🍲 (resources only), then the door's payout (no die screen).
        add(rec.gain, 'elite-loot', fight.lootElite); add(rec.gain, 'slot', fight.lootSlot);
        const delta = total(run) - stockTotal(before) - fight.lootElite - fight.lootSlot;
        if (run.pending?.kind === 'die') pendingFight = { fight, door: fought.door };
        else { finishDoor(fight, fought.door, 'none', 0, 1, delta); add(rec.gain, 'cauldron', delta); }
        break;
      }
      case 'die': {
        const view = rtDieView(run)!, roll = (view.low + view.high) / 2 > view.take;
        run = ok(rtDieChoose(run, roll), 'die');
        const paid = total(run) - stockTotal(before);
        add(rec.gain, 'cauldron', paid);
        if (pendingFight) finishDoor(pendingFight.fight, pendingFight.door, roll ? 'roll' : 'take', pending.face, roll ? (pending.face <= 3 ? 0.5 : 2) : 1, paid);
        pendingFight = null;
        break;
      }
      case 'talisman': {
        const reroll = rtRerollView(run);
        if (reroll?.available && reroll.rerolls === 0 && reroll.total >= 3) {
          run = ok(rtRerollTalismans(run), 'reroll');
          const spent = stockTotal(before) - total(run);
          add(rec.spend, 'reroll', spent); add(rec.rerollBy, pending.source, spent);
          break;
        }
        const options = (run.pending as Extract<RtRunState['pending'], { kind: 'talisman' }>).options;
        run = ok(rtChooseTalisman(run, options[0] ?? null), 'talisman');
        account(before, run, 'other', 'other');
        break;
      }
      case 'hammer': run = ok(rtChooseHammer(run, pending.options[k % pending.options.length] ?? null), 'hammer'); break;
      case 'find': run = ok(rtChooseFind(run, pending.options[0]), 'find'); break;
      case 'rest': {
        const view = rtRestView(run)!;
        const recipes = view.recipes.filter(entry => entry.available);
        if (run.hp > run.maxHp * 0.7 && recipes.length) {
          for (const recipe of recipes.slice(0, 2)) run = ok(rtRestCraft(run, recipe.resource), 'craft');
          run = ok(rtRestFinish(run), 'rest finish');
          account(before, run, 'other', 'craft');
        } else run = ok(rtRestHeal(run), 'rest');
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
          add(rec.shopBy, good.good, t0 - total(run));
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
          add(rec.spend, 'circle', 1); add(rec.gain, 'circle', game.gain.length);
          rec.circleGames++; if (game.gain.length) rec.circleWins++;
        } else run = ok(rtCasinoLeave(run), 'casino leave');
        break;
      }
      default: throw new Error(`run ${k}: pending ${(pending as { kind: string }).kind}`);
    }
  }
  rec.result = run.result?.outcome ?? 'unfinished';
  rec.endTotal = total(run);
  return rec;
}

// ---------- Workers ----------

async function collect(policy: OathPolicy): Promise<RunRecord[]> {
  if (WORKERS <= 1 || RUNS < 4) return Array.from({ length: RUNS }, (_, i) => walkRun(FROM + i, policy));
  const per = Math.ceil(RUNS / WORKERS), script = fileURLToPath(import.meta.url), jobs: Promise<RunRecord[]>[] = [];
  for (let w = 0; w < WORKERS; w++) {
    const from = FROM + w * per, count = Math.min(per, FROM + RUNS - from);
    if (count <= 0) break;
    jobs.push(new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, script, '--child', '--from', String(from), '--runs', String(count), '--oath', policy, '--max-links', String(MAX_LINKS), ...EXIT_AT_GOALS ? ['--exit-at-goals'] : []], { stdio: ['ignore', 'pipe', 'inherit'] });
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

function report(runs: RunRecord[], title: string): void {
  console.log(`\n### ${title}: ${runs.length} походов (k = ${runs[0]?.k}…${runs[runs.length - 1]?.k})`);
  const fights = runs.flatMap(r => r.fights), won = runs.filter(r => r.result === 'victory').length;
  const died = runs.filter(r => r.firstDeathRow !== null);
  console.log(`Итог: дошли до конца ${won} из ${runs.length}; боёв ${fights.length} (${f1(fights.length / runs.length)} за поход); «погиб бы» хотя бы раз — ${pct(died.length, runs.length)} походов (первый раз: медиана ряда ${f0(q(died.map(r => r.firstDeathRow!), 0.5))}); боёв «погиб бы» ${pct(fights.filter(f => f.wouldDie).length, fights.length)}.`);
  console.log(`Запасные ходы бота: команда целей ${fights.filter(f => f.fbGoals).length}, телепорт к двери ${fights.filter(f => f.fbDoor).length}. Время боя: медиана ${f0(q(fights.map(f => f.time), 0.5))} с, p90 ${f0(q(fights.map(f => f.time), 0.9))} с. Выход: цепью в дверь ${pct(fights.filter(f => f.exitBy === 'chain').length, fights.length)}, ходьбой ${pct(fights.filter(f => f.exitBy === 'walk').length, fights.length)}.`);
  console.log(`Цепи бота: ${f1(mean(fights.map(f => f.chains)))} за бой, вражеских звеньев в цепи в среднем ${f1(fights.reduce((s, f) => s + f.links, 0) / Math.max(1, fights.reduce((s, f) => s + f.chains, 0)))}; самая длинная цепь боя (убийств): медиана ${f0(q(fights.map(f => f.bestChain), 0.5))}, p90 ${f0(q(fights.map(f => f.bestChain), 0.9))}.`);

  const per = (pick: (r: RunRecord) => number): number[] => runs.map(pick);
  const cauldronParts = (r: RunRecord) => r.fights.reduce((s, f) => ({ base: s.base + f.base, g: s.g + f.dGreed, o: s.o + f.dOath, d: s.d + f.dDie, fin: s.fin + f.dFinale }), { base: 0, g: 0, o: 0, d: 0, fin: 0 });
  console.log('\n1. Получено ресурсов за поход, по источникам\n');
  console.log('| Источник | Среднее | Медиана | p10 | p90 |');
  console.log('| --- | --- | --- | --- | --- |');
  const gainKeys = ['cauldron', 'elite-loot', 'slot', 'circle', 'event', 'gift', 'other'];
  const label: Record<string, string> = { cauldron: 'Котёл (дверь), всего', 'elite-loot': 'Добыча элит', slot: 'Гоблин (🍲)', circle: 'Игорный круг (выигрыши)', event: 'События', gift: 'Дар', other: 'Прочее', merchant: 'Торговец', reroll: 'Переброс', craft: 'Крафт' };
  for (const key of gainKeys) console.log(`| ${label[key]} | ${stat(per(r => r.gain[key] ?? 0))} |`);
  console.log(`| — из котла: база (×1, без ставок) | ${stat(per(r => cauldronParts(r).base))} |`);
  console.log(`| — из котла: ступень П4 | ${stat(per(r => cauldronParts(r).g))} |`);
  console.log(`| — из котла: клятва | ${stat(per(r => cauldronParts(r).o))} |`);
  console.log(`| — из котла: кость | ${stat(per(r => cauldronParts(r).d))} |`);
  console.log(`| — из котла: П3 (цепь в дверь, справочно) | ${stat(per(r => cauldronParts(r).fin))} |`);
  console.log(`| Сундук | 0 — ресурсов не даёт (экран талисманов) | | | |`);
  console.log(`| **Всего получено** | ${stat(per(r => Object.values(r.gain).reduce((a, b) => a + b, 0)))} |`);

  console.log('\n2. Потрачено ресурсов за поход\n');
  console.log('| Сток | Среднее | Медиана | p10 | p90 |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const key of ['merchant', 'reroll', 'craft', 'circle', 'event', 'gift', 'other']) console.log(`| ${key === 'circle' ? 'Игорный круг (ставки)' : label[key] ?? key} | ${stat(per(r => r.spend[key] ?? 0))} |`);
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

  console.log('\n4. Выплата двери и потолок (бои с котлом > 0)\n');
  console.log('| Ряды | Боёв | Котёл, медиана | Ступень П4 в двери, медиана | Выплата, среднее | Потолок достигнут | Котёл больше потолка | Потолок уже на «Забрать» |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, lo, hi] of [['все', 1, 10] as [string, number, number], ...BANDS]) {
    const fs = fights.filter(f => f.row >= lo && f.row <= hi && f.cauldron > 0);
    console.log(`| ${name} | ${fs.length} | ${f0(q(fs.map(f => f.cauldron), 0.5))} | ×${f1(q(fs.map(f => f.greed), 0.5))} | ${f1(mean(fs.map(f => f.paid)))} | ${pct(fs.filter(f => f.capHit).length, fs.length)} | ${pct(fs.filter(f => f.overCap).length, fs.length)} | ${pct(fs.filter(f => f.capHitTake).length, fs.length)} |`);
  }
  const dieFs = fights.filter(f => f.die !== 'none');
  console.log(`Кость: экран в ${pct(dieFs.length, fights.filter(f => f.cauldron > 0).length)} боёв с котлом; бросок ${pct(dieFs.filter(f => f.die === 'roll').length, dieFs.length)}; средний вклад кости за бой ${f1(mean(dieFs.map(f => f.dDie)))}.`);
  const greedSteps = [1, 1.5, 2, 3].map(g => pct(fights.filter(f => f.cauldron > 0 && f.greed === g).length, fights.filter(f => f.cauldron > 0).length));
  console.log(`Ступень П4 в двери: ×1 ${greedSteps[0]}, ×1,5 ${greedSteps[1]}, ×2 ${greedSteps[2]}, ×3 ${greedSteps[3]}.`);

  console.log('\n5. Клятва\n');
  const taken = fights.filter(f => f.oath), kept = taken.filter(f => f.oathKept);
  console.log(`Боёв с клятвой: ${taken.length} (${f1(taken.length / runs.length)} за поход); выполнена ${pct(kept.length, taken.length)}. Вклад клятвы в котёл за поход: ${f1(mean(per(r => cauldronParts(r).o)))}.`);
  const byOath = new Map<string, FightRecord[]>();
  for (const f of taken) byOath.set(f.oath!, [...byOath.get(f.oath!) ?? [], f]);
  console.log('| Клятва | Взята | Выполнена |');
  console.log('| --- | --- | --- |');
  for (const [id, fs] of [...byOath].sort()) console.log(`| ${id} | ${fs.length} | ${pct(fs.filter(f => f.oathKept).length, fs.length)} |`);

  console.log('\n6. По полосам рядов: получено за бой (среднее)\n');
  console.log('| Ряды | Боёв | Котёл | из них П4 | клятва | кость | Добыча элит | Гоблин | Гоблин пришёл (из боёв с правом) | Рывков рычага |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, lo, hi] of BANDS) {
    const fs = fights.filter(f => f.row >= lo && f.row <= hi);
    console.log(`| ${name} | ${fs.length} | ${f1(mean(fs.map(f => f.paid)))} | ${f1(mean(fs.map(f => f.dGreed)))} | ${f1(mean(fs.map(f => f.dOath)))} | ${f1(mean(fs.map(f => f.dDie)))} | ${f1(mean(fs.map(f => f.lootElite)))} | ${f1(mean(fs.map(f => f.lootSlot)))} | ${pct(fs.filter(f => f.slot).length, fs.filter(f => f.slotRight).length)} | ${f1(mean(fs.filter(f => f.slot).map(f => f.pulls)))} |`);
  }
  // A counterfactual of the payout (the same fights and the same choices; only the rate changes): what the cauldron would pay.
  console.log('\n8. Справочно: котёл за поход при другом курсе (те же бои и выборы бота, пересчёт формулы)\n');
  console.log('| Углей за ресурс | Котёл за поход, среднее | Медиана | Потолок достигнут |');
  console.log('| --- | --- | --- | --- |');
  for (const rate of [60, 90, 120, 180, 240]) {
    const pay = (f: FightRecord) => f.cauldron > 0 ? purseResources(f.cauldron, f.oathMult, f.dieMult, rate, f.greed) : 0;
    const withC = fights.filter(f => f.cauldron > 0);
    console.log(`| ${rate} | ${f1(mean(per(r => r.fights.reduce((s, f) => s + pay(f), 0))))} | ${f1(q(per(r => r.fights.reduce((s, f) => s + pay(f), 0)), 0.5))} | ${pct(withC.filter(f => pay(f) >= payoutCap(f.oathMult * f.dieMult)).length, withC.length)} |`);
  }
  const lootRuns = runs.filter(r => (r.gain['elite-loot'] ?? 0) >= 10);
  console.log(`\nДобыча элит ресурсами: 10+ за поход в ${pct(lootRuns.length, runs.length)} походов (в них среднее ${f1(mean(lootRuns.map(r => r.gain['elite-loot'] ?? 0)))}); в остальных ${f1(mean(runs.filter(r => (r.gain['elite-loot'] ?? 0) < 10).map(r => r.gain['elite-loot'] ?? 0)))}.`);
  // The calibration's acceptance criteria (design 12.10.2026; bot heuristics): the numbers each criterion reads.
  const withCauldron = fights.filter(f => f.cauldron > 0), row10 = runs.flatMap(r => r.rowStart[10] !== undefined ? [r.rowStart[10]] : []);
  console.log(`\n9. Критерии калибровки (эвристика бота): котёл за поход — среднее ${f1(mean(per(r => r.gain.cauldron ?? 0)))}, медиана ${f1(q(per(r => r.gain.cauldron ?? 0), 0.5))}; бои на потолке выплаты — ${pct(withCauldron.filter(f => f.capHit).length, withCauldron.length)} (с костью, как в разделе 4; на «Забрать» — ${pct(withCauldron.filter(f => f.capHitTake).length, withCauldron.length)}); добыча элит ресурсами за поход — p90 ${f1(q(per(r => r.gain['elite-loot'] ?? 0), 0.9))}; ресурсы в начале ряда 10 — медиана ${f1(q(row10, 0.5))} (${row10.length} походов).`);
  const outposts = fights.filter(f => f.arena === 'outpost' && f.battle === 'hard');
  console.log(`\n7. Сундук: боёв «Заставы» (трудный узел) ${outposts.length}; сундук взят ${pct(outposts.filter(f => f.chest).length, outposts.length)}, проклятие снято ${pct(outposts.filter(f => f.chestLifted).length, outposts.filter(f => f.chest).length)} взятых. Добыча элит предметом (не ресурсом): ${f1(mean(per(r => r.fights.reduce((s, f) => s + f.lootItems, 0))))} за поход.`);
}

async function main(): Promise<void> {
  if (CHILD) { process.stdout.write(JSON.stringify(Array.from({ length: RUNS }, (_, i) => walkRun(FROM + i, OATH_MODE as OathPolicy)))); return; }
  const policies: OathPolicy[] = OATH_MODE === 'all' ? ['smart', 'never', 'always'] : [OATH_MODE];
  const t0 = Date.now(), all: Record<string, RunRecord[]> = {};
  console.log(`Аудит экономики похода (эвристика бота): seed k = ${FROM}…${FROM + RUNS - 1}, политики клятвы: ${policies.join(', ')}, звеньев в цепи не больше ${MAX_LINKS >= 99 ? '— (жадный)' : MAX_LINKS}${EXIT_AT_GOALS ? ', к двери сразу после целей' : ''}, воркеров ${WORKERS}`);
  for (const policy of policies) {
    all[policy] = await collect(policy);
    report(all[policy], `Клятва: ${policy}`);
  }
  if (policies.length > 1) {
    console.log('\n### Сравнение политик клятвы (за поход)\n');
    console.log('| Политика | Котёл всего | из них клятва | Всего получено | Боёв с клятвой | Выполнена | Потолок достигнут |');
    console.log('| --- | --- | --- | --- | --- | --- | --- |');
    for (const policy of policies) {
      const runs = all[policy], fights = runs.flatMap(r => r.fights), taken = fights.filter(f => f.oath), withC = fights.filter(f => f.cauldron > 0);
      console.log(`| ${policy} | ${f1(mean(runs.map(r => r.gain.cauldron ?? 0)))} | ${f1(mean(runs.map(r => r.fights.reduce((s, f) => s + f.dOath, 0))))} | ${f1(mean(runs.map(r => Object.values(r.gain).reduce((a, b) => a + b, 0))))} | ${f1(taken.length / runs.length)} | ${pct(taken.filter(f => f.oathKept).length, taken.length)} | ${pct(withC.filter(f => f.capHit).length, withC.length)} |`);
    }
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(all));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} с`);
}

main().catch(error => { console.error(error); process.exit(1); });
