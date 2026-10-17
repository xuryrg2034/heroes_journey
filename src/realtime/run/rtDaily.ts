/**
 * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, section 6; docs/realtime-slice.md, «Поход дня») — the core: the preset and the
 * run of a date, the journal of the run's steps, the proof file and its check by replay (in the browser and in Node:
 * `npm run realtime:daily-check <file>`), the local log of the attempts, the screen's model. The view (the button at the fire, the screen,
 * «Сохранить», «Проверить файл») is the ui session's, by the contract at the end of this comment.
 *
 * - **The run of a date.** `createRtDailyRun(date)`: the seed `rtDailySeed(date)` (run/rtRun.ts), the flags `RT_DAILY_PRESET` — every item
 *   open (no `locked`), no camp, «Испытание» 0, the full gift, feats on, the schedule with an empty history; the rest — the build's
 *   defaults. It is `seeded`: the meta does not change (no XP, carry, trophies, `RtProfile.won`). Its field `daily` is the date.
 * - **The journal of steps.** Every step of the run API, by name and arguments (`RtStepCall`), applied by `rtStep` — a pure dispatcher over
 *   the same functions the view calls. `rtEnterNode` takes the run page's own options (`RT_DAILY_ENTER`), not the call's.
 * - **The proof** (`RtDailyProof`): the date, the build, the hash of the run's `Params`, the preset, the steps, the fights' journals (packed,
 *   in the order of the `resolveArena` steps) and the claimed outcome (`rtDailyClaim`: the level passed, the level, the row, the fights'
 *   time). **The check** (`checkDailyProof`): another build — marked, not checked; else the run is made again from the date and the
 *   preset and every step applied (a refused step fails); at every `resolveArena` the next journal must be of that fight — its arena, seed,
 *   roster, loadout, hero and `Params` those the run gives, only player commands — and replay to an end whose outcome (run/fightOutcome.ts)
 *   is the step's argument; at the end the claim must be the run's.
 * - **The log** (`RtDailyStore`, its own `localStorage` keys — not the profile): per date the attempts, the first and the best outcome and
 *   the build (the last 30 dates); the proof of the best attempt of the last 7 dates.
 *
 * The view's contract (ui): the button «Поход дня» at the fire under «В поход», `rtDailyView` decides it (open after the first win over the
 * forest, off while an ordinary run is open: «Сначала закончи поход»); «Начать» — `RtDailyStore.begin` and `createRtDailyRun`; every step of
 * that run through `rtStep` (its call appended to the run's journal of steps); every fight's journal kept in order; the run's end —
 * `RtDailyStore.finish` with `rtDailyProof`; «Сохранить» — the proof as `daily-ГГГГ-ММ-ДД.json`; «Проверить» / «Проверить файл» —
 * `checkDailyProof` («Проверено», «Другая версия игры», or the reason). The end screen shows no XP block.
 */
import type { OathId } from '../sim/oath';
import { defaultParams } from '../sim/params';
import { replay, Simulation, type Journal } from '../sim/simulation';
import { canonicalJson, gunzipBase64, gzipBase64, paramsHash } from '../telemetry/codec';
import type { KeyValueStore } from '../telemetry/buffer';
import { RtFightWatch, rtFightOutcome } from './fightOutcome';
import { rtDepthBeyond, rtRunDepth, rtRunLevel, rtRunWonLevel } from './rtMeta';
import {
  createRtRun, healOnMap, isRtDailyDate, resolveArena, rtArenaLoadout, rtArenaParams, rtCasinoLeave, rtCasinoPlay, rtChooseEventOption, rtChooseFind, rtChooseGift,
  rtChooseGiftPick, rtChooseHabit, rtChooseHammer, rtChooseKnack, rtChooseTalisman, rtDailySeed, rtDieChoose, rtEnterGarrison, rtEnterNode, rtItemHintDue, rtOathStakeOn,
  rtRerollHammers, rtRerollTalismans, rtRestCraft, rtRestFinish, rtRestFuse, rtRestHeal, rtRunParams, rtShopBuy, rtShopLeave, RT_RUN_FORCED,
  type RtArenaOutcome, type RtCasinoTable, type RtHealWhere, type RtKnackOption, type RtRunState, type RtRunStep,
} from './rtRun';
import type { RtHabitId } from './rtTalismans';
import type { FusionId } from '../sim/buildIds';
import type { ItemKind, ResourceKind } from '../forest/types';

/** Task 51з (design 6.2): the flags of the run of the day — a constant, never the profile's. */
export const RT_DAILY_PRESET = Object.freeze({ gift: 'full' as const, seeded: true as const, feats: true as const, ash: 0 as const, schedule: Object.freeze([] as string[]) });
/** The local date `ГГГГ-ММ-ДД` of `now` (a new day — the local midnight). */
export function rtDailyDate(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
/** The run of the day `date` (see the file's comment). */
export function createRtDailyRun(date: string): RtRunState {
  if (!isRtDailyDate(date)) throw new Error(`not a date: ${date}`);
  return createRtRun(rtDailySeed(date), { ...RT_DAILY_PRESET, schedule: [], daily: date });
}
/** The `Params` the fights of the run of the day play (the run page's: `rtRunParams` of the defaults; `rtArenaParams` adds the run's own). */
export const rtDailyParams = () => rtRunParams(defaultParams());

// ---------- The journal of steps ----------

/** The options of `rtEnterNode` the run page passes (`RT_RUN_FORCED`: the goblins' circle on, the oath stake off). */
export const RT_DAILY_ENTER = Object.freeze({ goblinCircle: RT_RUN_FORCED.goblinCircle === true, oathStake: rtOathStakeOn() });
/** One step of the run: the function's name and its arguments after the run (JSON values). */
export interface RtStepCall { fn: RtStepFn; args: unknown[] }
const STEPS = {
  rtEnterNode: (run: RtRunState, [nodeId, oath]: readonly unknown[]) => rtEnterNode(run, String(nodeId), (oath ?? null) as OathId | null, RT_DAILY_ENTER),
  resolveArena: (run: RtRunState, [outcome]: readonly unknown[]) => resolveArena(run, outcome as RtArenaOutcome),
  rtRerollTalismans: (run: RtRunState) => rtRerollTalismans(run),
  rtChooseTalisman: (run: RtRunState, [id]: readonly unknown[]) => rtChooseTalisman(run, (id ?? null) as string | null),
  rtChooseKnack: (run: RtRunState, [option]: readonly unknown[]) => rtChooseKnack(run, (option ?? null) as RtKnackOption | null),
  rtChooseHammer: (run: RtRunState, [id]: readonly unknown[]) => rtChooseHammer(run, (id ?? null) as Parameters<typeof rtChooseHammer>[1]),
  rtRerollHammers: (run: RtRunState) => rtRerollHammers(run),
  rtDieChoose: (run: RtRunState, [roll]: readonly unknown[]) => rtDieChoose(run, roll === true),
  rtCasinoPlay: (run: RtRunState, [table]: readonly unknown[]) => rtCasinoPlay(run, table as RtCasinoTable),
  rtCasinoLeave: (run: RtRunState) => rtCasinoLeave(run),
  rtRestFuse: (run: RtRunState, [fusion]: readonly unknown[]) => rtRestFuse(run, fusion as FusionId),
  rtRestHeal: (run: RtRunState) => rtRestHeal(run),
  rtRestCraft: (run: RtRunState, [resource]: readonly unknown[]) => rtRestCraft(run, resource as ResourceKind),
  rtRestFinish: (run: RtRunState) => rtRestFinish(run),
  rtChooseFind: (run: RtRunState, [item]: readonly unknown[]) => rtChooseFind(run, item as ItemKind),
  rtShopBuy: (run: RtRunState, [id]: readonly unknown[]) => rtShopBuy(run, String(id)),
  rtShopLeave: (run: RtRunState) => rtShopLeave(run),
  healOnMap: (run: RtRunState, [where]: readonly unknown[]) => healOnMap(run, (where ?? {}) as RtHealWhere),
  rtChooseEventOption: (run: RtRunState, [id]: readonly unknown[]) => rtChooseEventOption(run, String(id)),
  rtChooseHabit: (run: RtRunState, [id]: readonly unknown[]) => rtChooseHabit(run, (id ?? null) as RtHabitId | null),
  rtChooseGift: (run: RtRunState, [index]: readonly unknown[]) => rtChooseGift(run, (index ?? null) as number | null),
  rtChooseGiftPick: (run: RtRunState, [pick]: readonly unknown[]) => rtChooseGiftPick(run, String(pick)),
  rtEnterGarrison: (run: RtRunState, [deposit]: readonly unknown[]) => rtEnterGarrison(run, deposit as number | undefined),
} as const;
export type RtStepFn = keyof typeof STEPS;
export const RT_STEP_FNS = Object.keys(STEPS) as RtStepFn[];
/** Apply one step of the journal (a malformed call — refused, never thrown). */
export function rtStep(run: RtRunState, call: RtStepCall): RtRunStep {
  if (!call || typeof call !== 'object' || !Object.prototype.hasOwnProperty.call(STEPS, call.fn) || !Array.isArray(call.args)) return { ok: false, reason: 'Неизвестный шаг.' };
  try { return STEPS[call.fn](run, call.args); } catch { return { ok: false, reason: 'Неверные аргументы шага.' }; }
}

// ---------- The outcome of an attempt ----------

/**
 * The outcome of an attempt (design 6.2): how deep — the level passed (`wonLevel`), the level and the row (`rtDepthBeyond`), whether the
 * run is over (`done`), and the fights' time (the sum of `battles[].time`, game seconds; at an equal depth the shorter is better).
 */
export interface RtDailyClaim { level: 1 | 2; row: number; wonLevel: 0 | 1 | 2; time: number; done: boolean }
export function rtDailyClaim(run: RtRunState): RtDailyClaim {
  return { level: rtRunLevel(run), row: rtRunDepth(run), wonLevel: rtRunWonLevel(run), time: run.battles.reduce((sum, b) => sum + b.time, 0), done: !!run.result };
}
/** `a` is a better attempt than `b`: deeper, or as deep and shorter. */
export function rtDailyBetter(a: RtDailyClaim, b: RtDailyClaim): boolean {
  if (rtDepthBeyond(a, b)) return true;
  return !rtDepthBeyond(b, a) && a.time < b.time;
}
/** The claim in words (the screen): «Гарнизон пройден», «Лес пройден», «Гарнизон, ряд N», «Лес, ряд N»; and the fights' time. */
export function rtDailyClaimText(claim: RtDailyClaim): string {
  const depth = claim.wonLevel === 2 ? 'Гарнизон пройден' : claim.level === 2 ? `Гарнизон, ряд ${claim.row}` : claim.wonLevel === 1 ? 'Лес пройден' : `Лес, ряд ${claim.row}`;
  return `${depth} · ${Math.round(claim.time)} с боёв`;
}

// ---------- The proof ----------

export const RT_DAILY_PROOF_KIND = 'ashen-oath-daily';
export const RT_DAILY_PROOF_VERSION = 1;
export interface RtDailyProof {
  kind: typeof RT_DAILY_PROOF_KIND; version: typeof RT_DAILY_PROOF_VERSION; date: string; build: string; paramsHash: string;
  preset: typeof RT_DAILY_PRESET; steps: RtStepCall[];
  /** The fights' journals (`gzipBase64` of the journal's JSON), in the order of the `resolveArena` steps. */
  fights: string[];
  claim: RtDailyClaim;
}
/** The proof of an attempt: its steps, its fights' journals, the claim of the run as it stands (`run` — the state after the steps). */
export async function rtDailyProof(date: string, build: string, steps: readonly RtStepCall[], journals: readonly Journal[], run: RtRunState): Promise<RtDailyProof> {
  return {
    kind: RT_DAILY_PROOF_KIND, version: RT_DAILY_PROOF_VERSION, date, build, paramsHash: paramsHash(rtDailyParams()), preset: RT_DAILY_PRESET,
    steps: structuredClone([...steps]), fights: await Promise.all(journals.map(j => gzipBase64(JSON.stringify(j)))), claim: rtDailyClaim(run),
  };
}
export type RtDailyCheck = { ok: true; claim: RtDailyClaim; fights: number } | { ok: false; reason: string; otherBuild?: true };
/** The commands a player gives in a fight (the debug ones — places, params, teleports — make no proof). */
const PLAYER_COMMANDS: readonly string[] = ['walk', 'begin', 'drag', 'sweep', 'release', 'cancel', 'jump', 'spin', 'item'];
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** The fight of the open battle of `run`: the journal is of it and replays to `outcome` (null — fine; else the reason). */
function checkFight(run: RtRunState, journal: Journal, outcome: unknown): string | null {
  const pending = run.pending;
  if (pending?.kind !== 'battle') return 'бой без открытого боя';
  // The fight the run page would start (runView.ts `startArena`, main.ts): its journal's head — a boss arena keeps its own copy of the Params.
  const params = rtArenaParams(run, rtDailyParams());
  const head = new Simulation({ arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, params, seed: pending.seed, hero: { hp: run.hp, maxHp: run.maxHp },
    loadout: rtArenaLoadout(run, { colorsByRow: params.colorsByRow }), record: true }).exportJournal()!;
  if (!journal || journal.version !== head.version || journal.arena !== head.arena || journal.seed !== head.seed || (journal.roster ?? undefined) !== head.roster) return `бой ${pending.nodeId}: не та арена или seed`;
  if (!same(journal.hero, head.hero)) return `бой ${pending.nodeId}: не то HP героя`;
  if (!same(journal.loadout, head.loadout)) return `бой ${pending.nodeId}: не то снаряжение`;
  if (!same(journal.params, head.params)) return `бой ${pending.nodeId}: не те Params`;
  if (!Array.isArray(journal.commands)) return `бой ${pending.nodeId}: журнал повреждён`;
  if (!journal.commands.every(entry => PLAYER_COMMANDS.includes(entry.cmd.t))) return `бой ${pending.nodeId}: команда не игрока`;
  const watch = new RtFightWatch();
  let sim;
  try { sim = replay(journal, s => { watch.read(s.world, s.world.events); s.world.events.length = 0; }, w => watch.seen(w)); } catch { return `бой ${pending.nodeId}: журнал не повторяется`; }
  if (sim.world.status === 'playing') return `бой ${pending.nodeId}: журнал не доходит до конца боя`;
  const derived = rtFightOutcome(sim.world, watch, rtItemHintDue(run));
  const claimed = outcome && typeof outcome === 'object' ? { ...outcome as Record<string, unknown> } : null;
  if (!claimed || claimed.nodeId !== pending.nodeId) return `бой ${pending.nodeId}: итог не этого узла`;
  delete claimed.nodeId;
  return same(derived, claimed) ? null : `бой ${pending.nodeId}: итог повтора не равен итогу похода`;
}

/** The check of a proof by replay (see the file's comment); `build` — this game's build. */
export async function checkDailyProof(value: unknown, build: string): Promise<RtDailyCheck> {
  const proof = value as Partial<RtDailyProof> | null;
  if (!proof || typeof proof !== 'object' || proof.kind !== RT_DAILY_PROOF_KIND || proof.version !== RT_DAILY_PROOF_VERSION) return { ok: false, reason: 'Это не файл «Похода дня».' };
  if (proof.build !== build) return { ok: false, reason: 'Другая версия игры', otherBuild: true };
  if (!isRtDailyDate(proof.date) || !same(proof.preset, RT_DAILY_PRESET) || proof.paramsHash !== paramsHash(rtDailyParams())) return { ok: false, reason: 'Дата, набор флагов или Params не те.' };
  if (!Array.isArray(proof.steps) || !Array.isArray(proof.fights) || !proof.claim) return { ok: false, reason: 'Файл повреждён.' };
  let run = createRtDailyRun(proof.date), fight = 0;
  for (const [n, call] of proof.steps.entries()) {
    if (call?.fn === 'resolveArena') {
      if (fight >= proof.fights.length) return { ok: false, reason: `Шаг ${n + 1}: нет журнала боя.` };
      let journal: Journal;
      try { journal = JSON.parse(await gunzipBase64(proof.fights[fight++])) as Journal; } catch { return { ok: false, reason: `Шаг ${n + 1}: журнал боя повреждён.` }; }
      const reason = checkFight(run, journal, call.args?.[0]);
      if (reason) return { ok: false, reason: `Шаг ${n + 1}: ${reason}.` };
    }
    const step = rtStep(run, call);
    if (!step.ok) return { ok: false, reason: `Шаг ${n + 1} (${String(call?.fn)}): ${step.reason}` };
    run = step.run;
  }
  if (fight !== proof.fights.length) return { ok: false, reason: 'Лишние журналы боёв.' };
  const claim = rtDailyClaim(run);
  return same(claim, proof.claim) ? { ok: true, claim, fights: fight } : { ok: false, reason: 'Заявленный итог не равен итогу повтора.' };
}

// ---------- The log of attempts (its own keys; not the profile) ----------

export const RT_DAILY_LOG_KEY = 'ashen-oath-rt-daily-log-v1';
export const RT_DAILY_PROOF_KEY = 'ashen-oath-rt-daily-v1';
/** Баланс (design 8.1, 6.3): the dates the log keeps, the dates whose best proof is kept. */
export const RT_DAILY_LOG_DATES = 30;
export const RT_DAILY_PROOF_DATES = 7;
/** One date of the log: the attempts begun, the first finished attempt, the best one, the build of the best. */
export interface RtDailyEntry { tries: number; first?: RtDailyClaim; best?: RtDailyClaim; build?: string }
/** The local log of the run of the day (`store` — the page's `localStorage`; null — nothing kept). */
export class RtDailyStore {
  constructor(private readonly store: KeyValueStore | null) {}
  private read<T>(key: string): Record<string, T> {
    try { const value = JSON.parse(this.store?.getItem(key) ?? '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, T> : {}; } catch { return {}; }
  }
  private write(key: string, value: Record<string, unknown>, keep: number): void {
    const dates = Object.keys(value).filter(isRtDailyDate).sort().slice(-keep);
    try { this.store?.setItem(key, JSON.stringify(Object.fromEntries(dates.map(d => [d, value[d]])))); } catch { /* full or blocked: the log is a convenience */ }
  }
  entry(date: string): RtDailyEntry { return this.read<RtDailyEntry>(RT_DAILY_LOG_KEY)[date] ?? { tries: 0 }; }
  /** «Начать»: one more attempt of `date`; its number (1 — the first of the day). */
  begin(date: string): number {
    const log = this.read<RtDailyEntry>(RT_DAILY_LOG_KEY), entry = log[date] ?? { tries: 0 };
    log[date] = { ...entry, tries: entry.tries + 1 };
    this.write(RT_DAILY_LOG_KEY, log, RT_DAILY_LOG_DATES);
    return entry.tries + 1;
  }
  /** The attempt `attempt` of `date` ended with `proof`: the first one is kept as the day's first, the best as the best (with its proof). */
  finish(date: string, attempt: number, proof: RtDailyProof): { first: boolean; best: boolean } {
    const log = this.read<RtDailyEntry>(RT_DAILY_LOG_KEY), entry = log[date] ?? { tries: Math.max(1, attempt) };
    const first = attempt === 1 && !entry.first, best = !entry.best || rtDailyBetter(proof.claim, entry.best);
    log[date] = { ...entry, ...first ? { first: proof.claim } : {}, ...best ? { best: proof.claim, build: proof.build } : {} };
    this.write(RT_DAILY_LOG_KEY, log, RT_DAILY_LOG_DATES);
    if (best) { const proofs = this.read<RtDailyProof>(RT_DAILY_PROOF_KEY); proofs[date] = proof; this.write(RT_DAILY_PROOF_KEY, proofs, RT_DAILY_PROOF_DATES); }
    return { first, best };
  }
  /** The kept proof of the best attempt of `date` (null — none). */
  proof(date: string): RtDailyProof | null { return this.read<RtDailyProof>(RT_DAILY_PROOF_KEY)[date] ?? null; }
}

/** The screen of the run of the day (and the button at the fire). */
export interface RtDailyView {
  date: string; seed: number;
  /** The button stands (after the first win over the forest, design answer 5). */
  unlocked: boolean;
  /** «Начать» is on; else `reason` («Сначала закончи поход» while an ordinary run is open). */
  canStart: boolean; reason: string;
  tries: number; first: RtDailyClaim | null; best: RtDailyClaim | null;
  /** The best attempt's proof is kept («Сохранить», «Проверить»). */
  proof: boolean;
}
export function rtDailyView(store: RtDailyStore, date: string, profile: { won: boolean; runOpen: boolean }): RtDailyView {
  const entry = store.entry(date), reason = !profile.won ? 'Откроется после первой победы в лесу' : profile.runOpen ? 'Сначала закончи поход' : '';
  return { date, seed: rtDailySeed(date), unlocked: profile.won, canStart: !reason, reason, tries: entry.tries, first: entry.first ?? null, best: entry.best ?? null, proof: !!store.proof(date) };
}
