/**
 * Casino stage 1, item 1 — «Котёл» (docs/realtime-casino.md; docs/realtime-casino-research.md, K1, K4, 3.1 v0 and 8.5).
 * The cauldron of the fight: every chain puts its cheque in (embers × heat × crystals), the player's build kills outside the
 * chain put 1 ember each, the door pays crafting resources for it. No randomness in the cheque; the resource kinds at the
 * door come from the fight's own stream `purse:loot` (a new stream: the others do not shift).
 *
 * Off by default (`Params.purse`); journals without the value play as before: no `world.purse`, no `move.purse`, the stream is
 * never touched. A run turns it on (run/rtRun.ts `RT_RUN_FORCED`); the sandbox — the panel toggle.
 *
 * One cheque, two callers: the highlight (`planChain` → `planCheque`) and the dash (`HeroMove.purse` → `dashCheque`) count
 * the same struck outcomes with the same `linkEmbers` and `chequeOf`; the highlight is the dash while the world stays as it
 * was at the release.
 *
 * Plug-in points for the next items of stage 1:
 * - the oath (K8, oath.ts): `purseOath(world)` — the multiplier of the oath the world is under at the door (1, 2 or 0.5);
 * - the die at the door (8.4): the run layer passes it to `doorPayout(door, die)` (run/rtRun.ts `rtDieChoose`; 1 — «Забрать»);
 * - the goblin's arrow rain: its kills come through `world.ts killEnemy` → `purseKill` (source `slot` in `PURSE_KILL_SOURCES`).
 *
 * П4 «Раздув за дела» (casino stage 2, docs/realtime-casino.md, «Раздув за дела»; `Params.greedByDeeds`, needs `purse`): after
 * the goals the cauldron climbs greed steps ×1 → ×1,5 → ×2 → ×3 — one step for every 2 chains of 3+ enemy links released
 * with the door open; a hit on the hero takes one step off and resets the count. The door multiplies the cauldron by its
 * step (`PurseDoor.greed`); the cap of the payout stays the cap of the stakes (oath × die). The cheque and its highlight do
 * not change.
 * Type-only imports from world.ts / chain.ts: world.ts calls this module at run time.
 */
import { BUILD_SOURCES } from './buildIds';
import type { StrikeOutcome } from './chain';
import { RESOURCE_KINDS, type ResourceKind } from './kit';
import type { Enemy, HeroMove, KillCause, World } from './world';
import { oathMark, oathMult, OATH_BROKEN_MULT, OATH_KEPT_MULT } from './oath';

/** The kill source of the goblin's arrows (slot.ts uses this constant). */
export const SLOT_KILL_SOURCE = 'slot';

// ---- Numbers (docs/realtime-casino.md, «Котёл»; research K1 and 3.1). Constants: the run and the sim share one payout. ----

/** Embers of a plate a chain hit took off an armoured elite (K4). */
export const PLATE_EMBERS = 2;
/** Embers on top of the link's own when the chain kills an armoured elite (K4). */
export const ELITE_KILL_EMBERS = 5;
/** Heat +1 at every this-many-th enemy link of the chain (3, 6, 9 …). */
export const HEAT_EVERY = 3;
/** «Добивание»: +1 heat when the last enemy link died and the chain had at least this many enemy links. */
export const FINISH_LINKS = 4;
/** Heat of a chain that closed the seal (the loop, sandbox only); +1 ember for every enemy inside. */
export const SEAL_HEAT = 2;
/** П4 «Раздув за дела»: the greed steps' multipliers of the cauldron at the door (step 0 — ×1, the ceiling — ×3). */
export const GREED_MULTS: readonly number[] = [1, 1.5, 2, 3];
/** П4: counted chains per greed step. */
export const GREED_CHAINS = 2;
/** П4: enemy links a chain needs to count (the dash's cheque `links`: struck, a plate taken, passed fallen). */
export const GREED_LINKS = 3;
/** Crystals in the chain multiply the total: one ×2, two or more ×4 (the cap). */
export const CRYSTAL_MULT_CAP = 4;
/** Embers per crafting resource at the door, the payout cap without stakes and the cap whatever the stakes. */
/**
 * Embers per resource of the payout — the default of `Params.purseRate` (design 11.10.2026: 60, a calibration before the
 * playtest — the greedy bot filled a cauldron of 58–410 in 12–38 s; research 3.1 had 40). The door records the rate it paid at.
 */
export const EMBERS_PER_RESOURCE = 60;
export const PAYOUT_CAP_BASE = 3;
export const PAYOUT_CAP_MAX = 6;
/**
 * Credited kills outside the chain that put 1 ember (no heat; research 3.3, 8.5): the hammers' fire, end blast, cut and
 * return, «Ударная волна», the goblin's arrow rain (source `slot`, casino stage 1). The seal's kills put nothing
 * here: its row of the cheque counts everyone inside.
 */
export const PURSE_KILL_SOURCES: ReadonlySet<string> = new Set<string>([...Object.values(BUILD_SOURCES), SLOT_KILL_SOURCE]);

/** The dash's count of its cheque so far (`HeroMove.purse`; present only while the cauldron is on). */
export interface PurseMove {
  /** Embers of the links struck so far. */
  embers: number;
  /** Enemy links the dash reached so far (struck, a plate taken, passed fallen). */
  links: number;
  /** The last enemy link reached is dead (killed by the hit, or fell before the hero reached it). */
  last: boolean;
  /** П4: the chain was released with the door open and `greedByDeeds` on — 3+ enemy links count toward a greed step (absent otherwise). */
  greed?: true;
}

/** П4: the greed of the fight — the step (0–3: ×1, ×1,5, ×2, ×3) and the counted chains toward the next one. */
export interface PurseGreed { step: number; chains: number }

/** The cauldron of the fight (`World.purse`; present only once the cauldron was on and something was put in or paid). */
export interface PurseWorld {
  cauldron: number;
  /** What the door recorded at the exit (absent until the victory): the cauldron, the oath, the resource kinds in order. */
  door?: PurseDoor;
  /** П4 «Раздув за дела»: absent until the first counted chain (worlds without it hash as before). */
  greed?: PurseGreed;
}

/** The door's record: the run pays `purseResources(cauldron, oath, die, rate, greed)` of `kinds` (taken from the front). */
export interface PurseDoor {
  cauldron: number; oath: number; kinds: ResourceKind[];
  /** Embers per resource at the door (`purseRate`). */
  rate: number;
  /** П4: the greed step's multiplier at the door (1, 1.5, 2, 3); absent — the rule was off (×1). */
  greed?: number;
}

/** A cheque: embers × heat × the crystal multiplier = total. `links` — enemy links counted, `crystals` — crystal links. */
export interface Cheque { embers: number; heat: number; crystals: number; mult: number; total: number; links: number; finish: boolean }

/** The cauldron is on in this world. */
export function purseOn(world: World): boolean { return !!world.params.purse; }

/**
 * Embers of one struck enemy link (K1, K4): a plate taken — 2; otherwise the HP the hit removed, at least 1 (a weak enemy
 * or HP 1 — 1, a tough one killed — its HP before the hit; a survivor — the HP it lost, so a wounded tough is not a farm);
 * an armoured elite killed — +5.
 */
export function linkEmbers(enemy: Pick<Enemy, 'armor'>, outcome: StrikeOutcome): number {
  // Design 11.10.2026: only the elite's own plates pay, once each — a plate that grew back pays 0 (no endless source).
  if (outcome.plate) return enemy.armor && (enemy.armor.stripped ?? 0) < enemy.armor.max ? PLATE_EMBERS : 0;
  const own = Math.max(1, outcome.hpBefore - outcome.hpAfter);
  return own + (outcome.killed && enemy.armor ? ELITE_KILL_EMBERS : 0);
}

/**
 * Embers of a link the player's tool killed before the dash reached it (a fallen link, chain.ts `passFallen`): as if the
 * dash had killed it — its HP before the death (at least 1), +5 for an armoured elite. The chain's cheque counts them (the
 * plan counted the link too), and the kill puts no separate ember (`purseKill` skips the dash's links) — review 11.10.2026:
 * the fire-pass hammer burns links ahead of the hero.
 */
export function fallenEmbers(e: Pick<Enemy, 'hp' | 'armor'>): number {
  return Math.max(1, e.hp) + (e.armor ? ELITE_KILL_EMBERS : 0);
}

/** The crystal multiplier: none ×1, one ×2, two or more ×4. */
export function crystalMult(crystals: number): number { return crystals <= 0 ? 1 : crystals === 1 ? 2 : CRYSTAL_MULT_CAP; }

/**
 * The cheque of a chain: embers of its links (+1 per enemy inside a seal), heat 1 + 1 per every 3rd enemy link + 1 for
 * the «добивание» (the last enemy link died, 4+ enemy links) + 2 for a seal, × the crystals.
 */
export function chequeOf(tally: PurseMove, crystals: number, seal: { inside: number } | null): Cheque {
  const finish = tally.last && tally.links >= FINISH_LINKS;
  const heat = 1 + Math.floor(tally.links / HEAT_EVERY) + (finish ? 1 : 0) + (seal ? SEAL_HEAT : 0);
  const embers = tally.embers + (seal ? seal.inside : 0), mult = crystalMult(crystals);
  return { embers, heat, crystals, mult, total: embers * heat * mult, links: tally.links, finish };
}

/** Counts one struck enemy link into the tally (the plan and the dash alike). */
export function tallyLink(tally: PurseMove, embers: number, dead: boolean): void {
  tally.embers += embers;
  tally.links++;
  tally.last = dead;
}

/**
 * The highlight's cheque (`planChain`): `links` — the plan's enemy links in order with their struck outcomes and their
 * enemies, `crystals` — crystal links of the plan, `sealInside` — enemies inside the closed chain (null — not closed).
 */
export function planCheque(links: readonly { enemy: Pick<Enemy, 'armor'>; outcome: StrikeOutcome }[], crystals: number, sealInside: number | null): Cheque {
  const tally: PurseMove = { embers: 0, links: 0, last: false };
  for (const { enemy, outcome } of links) tallyLink(tally, linkEmbers(enemy, outcome), outcome.killed);
  return chequeOf(tally, crystals, sealInside === null ? null : { inside: sealInside });
}

/**
 * The heat one more enemy link (killed) would give the drawn chain, if it is more than now (the hint «ещё 1 → ×жар»);
 * null — one more link does not raise the heat.
 */
export function nextHeat(cheque: Cheque, sealed: boolean): number | null {
  const next = chequeOf({ embers: 0, links: cheque.links + 1, last: true }, 0, sealed ? { inside: 0 } : null).heat;
  return next > cheque.heat ? next : null;
}

/** The running dash's cheque if it ended now (the caption under the power number). Null — no cheque counted. */
export function dashCheque(move: HeroMove | null): Cheque | null {
  if (!move?.purse) return null;
  return chequeOf(move.purse, move.broken, move.seal ? { inside: move.seal.inside.length } : null);
}

/** The cauldron of the world, made on first use (absent while nothing was put: worlds without it hash as before). */
function cauldronOf(world: World): PurseWorld { return world.purse ??= { cauldron: 0 }; }

/** The dash `move` ends (or enters the door): its cheque goes into the cauldron, once. Event `cheque`. */
export function settleCheque(world: World, move: HeroMove | null = world.move): Cheque | null {
  if (!move || move.kind !== 'dash' || !move.purse) return null;
  const cheque = dashCheque(move)!, greed = !!move.purse.greed;
  delete move.purse;
  if (!cheque.links && !cheque.embers) return cheque;
  const purse = cauldronOf(world);
  purse.cauldron += cheque.total;
  world.events.push({ type: 'cheque', ...cheque, cauldron: purse.cauldron, x: world.hero.x, y: world.hero.y });
  // П4: a chain of 3+ enemy links released with the door open is a deed (a chain into the door counts before the exit).
  if (greed && cheque.links >= GREED_LINKS) greedDeed(world);
  return cheque;
}

// ---- П4 «Раздув за дела» (docs/realtime-casino.md, «Раздув за дела»; research П4, decision 9.1.2) ----

/** The greed rule acts in this world: `greedByDeeds` with the cauldron on (journals without the key: off). */
export function greedOn(world: World): boolean { return purseOn(world) && !!world.params.greedByDeeds; }

/** The greed step now (0–3). */
export function greedStep(world: World): number { return world.purse?.greed?.step ?? 0; }

/** The release (chain.ts `releaseChain`): a chain released with the door open is marked to count toward a step. */
export function greedRelease(world: World, move: HeroMove): void {
  if (move.purse && greedOn(world) && world.stage === 'greed') move.purse.greed = true;
}

/** A counted chain: +1 toward the next step; every `GREED_CHAINS` — a step up, to the ceiling ×3. Event `greed`. */
function greedDeed(world: World): void {
  const purse = cauldronOf(world), g = purse.greed ??= { step: 0, chains: 0 };
  if (g.step >= GREED_MULTS.length - 1) return;
  g.chains++;
  if (g.chains >= GREED_CHAINS) { g.step++; g.chains = 0; }
  world.events.push({ type: 'greed', cause: 'chain', step: g.step, chains: g.chains, mult: GREED_MULTS[g.step] });
}

/**
 * The hero lost HP (world.ts `hurtHero`, damage > 0): one step off and the count toward the next reset. Nothing to take — no
 * change (the world stays as it was). Event `greed`.
 */
export function greedHurt(world: World): void {
  const g = world.purse?.greed;
  if (!greedOn(world) || !g || (g.step === 0 && g.chains === 0)) return;
  g.step = Math.max(0, g.step - 1);
  g.chains = 0;
  world.events.push({ type: 'greed', cause: 'hit', step: g.step, chains: g.chains, mult: GREED_MULTS[g.step] });
}

/**
 * The oath's multiplier if the hero went through the door now (oath.ts): none — 1, holding — ×2, broken or an «at least
 * once» oath not met yet (the door breaks it) — ×0.5.
 */
function doorOathNow(world: World): number {
  const state = oathMark(world);
  return !state ? 1 : state.mark === 'holds' ? OATH_KEPT_MULT : OATH_BROKEN_MULT;
}

/** What the goal line shows after the goals with the rule on. */
export interface GreedView {
  /** The cauldron (the number of the HUD's «котёл N»). */
  cauldron: number;
  /** The step's multiplier now and the next one (null — the ceiling ×3). */
  mult: number; next: number | null;
  /** Counted chains still needed for the next step. */
  chainsLeft: number;
  /** The payout without the die already stands at its cap if the hero went through the door now: the cap; null — below it. */
  cap: number | null;
}
/** The goal line's data (null — the rule is off or the door is closed). */
export function greedView(world: World): GreedView | null {
  if (!greedOn(world) || world.stage !== 'greed') return null;
  const step = greedStep(world), cauldron = world.purse?.cauldron ?? 0, oath = doorOathNow(world);
  const rate = Math.max(1, world.params.purseRate ?? EMBERS_PER_RESOURCE), mult = GREED_MULTS[step], cap = payoutCap(oath);
  const capped = purseResources(cauldron, oath, 1, rate, mult) >= cap;
  return {
    cauldron, mult, next: step < GREED_MULTS.length - 1 ? GREED_MULTS[step + 1] : null,
    chainsLeft: GREED_CHAINS - (world.purse?.greed?.chains ?? 0), cap: capped ? cap : null,
  };
}

/** «1,5» — a multiplier as the HUD writes it. */
export function multText(m: number): string { return String(m).replace('.', ','); }

/**
 * The goal line after the goals (main.ts): «дверь открыта · котёл 84 ×1,5 · ещё 1 цепь 3+ → ×2»; at the ceiling
 * «дверь открыта · котёл 84 ×3»; the payout at its cap — «дверь открыта · котёл 300 ×2 · потолок 3». Null — the rule is off
 * or the door is closed (the line stays as before).
 */
export function greedLine(world: World): string | null {
  const v = greedView(world);
  if (!v) return null;
  const head = `дверь открыта · котёл ${v.cauldron} ×${multText(v.mult)}`;
  if (v.cap !== null) return `${head} · потолок ${v.cap}`;
  if (v.next === null) return head;
  return `${head} · ещё ${v.chainsLeft} ${v.chainsLeft === 1 ? 'цепь' : 'цепи'} ${GREED_LINKS}+ → ×${multText(v.next)}`;
}

/**
 * A credited kill outside the chain (world.ts `killEnemy`): 1 ember into the cauldron when its source is one of
 * `PURSE_KILL_SOURCES`, no heat. Event `purseKill`.
 */
export function purseKill(world: World, cause: KillCause): void {
  if (!purseOn(world) || !cause.credited || !PURSE_KILL_SOURCES.has(cause.source)) return;
  const purse = cauldronOf(world);
  purse.cauldron += 1;
  world.events.push({ type: 'purseKill', source: cause.source, cauldron: purse.cauldron });
}

/**
 * The oath's multiplier at the door (casino stage 1, item 2, oath.ts): 1 — no oath (or the rule off), 2 — kept, 0.5 —
 * broken. `win` settles the oath (`oathDoor`) before the door records it.
 */
export function purseOath(world: World): number { return oathMult(world); }

/**
 * The payout of a cauldron (research 8.5, «Потолок выплаты»): M = oath × die; ⌊cauldron × greed × M ÷ rate⌋ resources
 * (rate — `purseRate`, 60; greed — П4's step multiplier at the door, 1 without the rule), at most min(6, ⌊3 × M⌋) and that
 * cap never below 1 (the greed step does not raise it). Without stakes (M = 1) — at most 3. The sim and the run call this
 * one function.
 */
export function purseResources(cauldron: number, oath = 1, die = 1, rate = EMBERS_PER_RESOURCE, greed = 1): number {
  const m = Math.max(0, oath) * Math.max(0, die), per = Math.max(1, rate);
  return Math.max(0, Math.min(payoutCap(m), Math.floor(Math.max(0, cauldron) * Math.max(1, greed) * m / per)));
}

/** The cap of the payout at the stakes M = oath × die: min(6, ⌊3 × M⌋), never below 1. П4's greed step is not in it. */
export function payoutCap(m: number): number { return Math.max(1, Math.min(PAYOUT_CAP_MAX, Math.floor(PAYOUT_CAP_BASE * Math.max(0, m)))); }

/**
 * The exit into the door (world.ts `win`): the running dash's cheque first (a chain ending on the door), then the door's
 * record — the cauldron, the oath, `PAYOUT_CAP_MAX` resource kinds of the stream `purse:loot` (the run takes as many from
 * the front as the payout says). Event `purseDoor` with the payout without the die.
 */
export function purseDoor(world: World): void {
  if (!purseOn(world)) return;
  settleCheque(world);
  const purse = cauldronOf(world), rng = world.rng.stream('purse:loot'), oath = purseOath(world);
  const kinds: ResourceKind[] = [];
  for (let i = 0; i < PAYOUT_CAP_MAX; i++) kinds.push(RESOURCE_KINDS[Math.floor(rng.next() * RESOURCE_KINDS.length)]);
  const rate = Math.max(1, world.params.purseRate ?? EMBERS_PER_RESOURCE);
  // П4: the greed step at the exit multiplies the cauldron (recorded only with the rule on; old doors have no field).
  const greed = greedOn(world) ? GREED_MULTS[greedStep(world)] : undefined;
  purse.door = { cauldron: purse.cauldron, oath, kinds, rate, ...greed !== undefined ? { greed } : {} };
  world.events.push({ type: 'purseDoor', cauldron: purse.cauldron, oath, resources: purseResources(purse.cauldron, oath, 1, rate, greed),
    ...greed !== undefined ? { greed, step: greedStep(world) } : {} });
}

/** The resources the door's record pays with the die `die` (the run: 1 — «Забрать» or no die, 0.5 / 2 — a roll), as kinds in order. */
export function doorPayout(door: PurseDoor, die = 1): ResourceKind[] {
  return door.kinds.slice(0, purseResources(door.cauldron, door.oath, die, door.rate, door.greed ?? 1));
}
