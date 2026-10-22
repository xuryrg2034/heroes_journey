/**
 * Track Т0 of the real-time telemetry (docs/realtime-telemetry.md, sections 3, 7 and 8): the contract the other tracks
 * build on — record types, record ids and their check, the export file, the fight summary and the observer that fills it,
 * the `replayTo` hook. The journal codec lives in codec.ts and is re-exported here: one import point.
 *
 * No DOM and no clock: the browser (track ТA), Node (the report, ТB) and the Vite plugin (ТC) use the same code. The
 * telemetry never writes into the simulation: the observer only reads the world (the fight hash stays the same).
 */
import type { Command } from '../sim/commands';
import type { Params } from '../sim/params';
import type { Journal } from '../sim/simulation';
import type { World } from '../sim/world';
import type { JournalEncoding, JournalMeta } from './codec';

export * from './codec';

/** Version of the record schema (the header's `schema`). */
export const RT_TELEMETRY_SCHEMA = 1;

// ---- Ids ----

/** One segment of a record id: letters, digits, `_` and `-`, 1–64 characters (no dots, no slashes). */
export const ID_SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * A record id: `S/R/run`, `S/R/<fight>/fight`, `S/R/<fight>/j<i>of<n>`, `S/R/<fight>/n<tick>` (S — session, R — run);
 * `S/P/prologue` — one playthrough of the prologue «Опушка» (P — its key `prologueKey`; from 13.10.2026); `S/W/warmup` — one attempt
 * of the camp's warmup (W — its key `warmupKey`; task 51ж, 17.10.2026).
 * The Vite plugin (ТC) checks every POSTed id with it: a valid id is a safe relative path.
 */
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/(?:run|prologue|warmup|[A-Za-z0-9_-]{1,64}\/(?:fight|j(?:0|[1-9][0-9]{0,5})of[1-9][0-9]{0,5}|n(?:0|[1-9][0-9]{0,9})))$/;
/** The run key of the sandbox fights (decision 8). */
export const SANDBOX_RUN = 'sandbox';

export const isIdSegment = (s: unknown): s is string => typeof s === 'string' && ID_SEGMENT_RE.test(s);
/** True for a well-formed record id (the plugin's path check): the pattern and a journal part index below the count. */
export const isRecordId = (id: unknown): id is string => parseRecordId(id) !== null;

const segment = (s: string, what: string): string => {
  if (!isIdSegment(s)) throw new Error(`telemetry id: ${what} ${JSON.stringify(s)} is not a segment [A-Za-z0-9_-]{1,64}`);
  return s;
};
const count = (n: number, what: string): number => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`telemetry id: ${what} ${n} is not a whole number ≥ 0`);
  return n;
};

/** A session key: `s<time base36>-<salt hex>` (the browser draws the salt once per session). */
export function sessionKey(timeMs: number, salt: number): string { return `s${count(Math.floor(timeMs), 'time').toString(36)}-${(salt >>> 0).toString(16)}`; }
/** A run key: `r<start time base36>-<seed hex>`; sandbox fights use `SANDBOX_RUN`. */
export function runKey(timeMs: number, seed: number): string { return `r${count(Math.floor(timeMs), 'time').toString(36)}-${(seed >>> 0).toString(16)}`; }

/** A prologue key: `p<start time base36>-<salt hex>` (one playthrough of the prologue «Опушка»; the header's `run`). */
export function prologueKey(timeMs: number, salt: number): string { return `p${count(Math.floor(timeMs), 'time').toString(36)}-${(salt >>> 0).toString(16)}`; }
/** A warmup key: `w<start time base36>-<salt hex>` (one attempt of the camp's warmup; the header's `run`). */
export function warmupKey(timeMs: number, salt: number): string { return `w${count(Math.floor(timeMs), 'time').toString(36)}-${(salt >>> 0).toString(16)}`; }

/**
 * A fight key: `f<index, 2 digits>-<node>-a<attempt>` (`f03-n5a-a1`). `index` — the fight's number in the run (or the
 * sandbox session), `attempt` — the try of this arena (restarts). Characters of the node outside `[A-Za-z0-9_-]` become
 * `_`; a long node is cut so the key fits 64. No node (the sandbox) — `x`.
 */
export function fightKey(index: number, nodeId: string | null | undefined, attempt: number): string {
  const head = `f${String(count(index, 'index')).padStart(2, '0')}-`, tail = `-a${count(attempt, 'attempt')}`;
  const node = (nodeId ? nodeId.replace(/[^A-Za-z0-9_-]/g, '_') : 'x').slice(0, Math.max(1, 64 - head.length - tail.length));
  return segment(head + node + tail, 'fight key');
}

export const runRecordId = (session: string, run: string): string => `${segment(session, 'session')}/${segment(run, 'run')}/run`;
export const prologueRecordId = (session: string, key: string): string => `${segment(session, 'session')}/${segment(key, 'prologue key')}/prologue`;
export const warmupRecordId = (session: string, key: string): string => `${segment(session, 'session')}/${segment(key, 'warmup key')}/warmup`;
export const fightRecordId = (session: string, run: string, fight: string): string => `${segment(session, 'session')}/${segment(run, 'run')}/${segment(fight, 'fight')}/fight`;
export function journalPartId(session: string, run: string, fight: string, index: number, parts: number): string {
  if (count(index, 'part') >= count(parts, 'parts')) throw new Error(`telemetry id: part ${index} of ${parts}`);
  return `${segment(session, 'session')}/${segment(run, 'run')}/${segment(fight, 'fight')}/j${index}of${parts}`;
}
export const noteRecordId = (session: string, run: string, fight: string, tick: number): string =>
  `${segment(session, 'session')}/${segment(run, 'run')}/${segment(fight, 'fight')}/n${count(tick, 'tick')}`;

/** A record id taken apart; null for a malformed one. */
export type ParsedRecordId =
  | { kind: 'run'; session: string; run: string }
  | { kind: 'prologue'; session: string; run: string }
  | { kind: 'warmup'; session: string; run: string }
  | { kind: 'fight'; session: string; run: string; fight: string }
  | { kind: 'journal'; session: string; run: string; fight: string; index: number; parts: number }
  | { kind: 'note'; session: string; run: string; fight: string; tick: number };

export function parseRecordId(id: unknown): ParsedRecordId | null {
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) return null;
  const [session, run, fight, last] = id.split('/');
  if (fight === 'run' && last === undefined) return { kind: 'run', session, run };
  if (fight === 'prologue' && last === undefined) return { kind: 'prologue', session, run };
  if (fight === 'warmup' && last === undefined) return { kind: 'warmup', session, run };
  if (last === 'fight') return { kind: 'fight', session, run, fight };
  const part = /^j(\d+)of(\d+)$/.exec(last);
  if (part) {
    const index = Number(part[1]), parts = Number(part[2]);
    return index < parts ? { kind: 'journal', session, run, fight, index, parts } : null;
  }
  return { kind: 'note', session, run, fight, tick: Number(last.slice(1)) };
}

// ---- Records ----

export type RtRecordKind = 'run' | 'fight' | 'journal' | 'note' | 'prologue' | 'warmup';

/** The common header of every record. */
export interface RtHeader {
  schema: typeof RT_TELEMETRY_SCHEMA;
  /** The record id (see «Ids»); a record sent again keeps its id. */
  id: string;
  kind: RtRecordKind;
  /** The build: the commit, `+dirty` with local changes. */
  build: string;
  /** The Params version: the storage key of the panel values and the hash of the Params played (`paramsHash`). */
  params: { storage: string; hash: string };
  /** The browser session key. */
  session: string;
  /** The run key (`runKey`) or `SANDBOX_RUN`; a prologue record — its prologue key (`prologueKey`). */
  run: string;
  /** When the record was made (ISO). */
  at: string;
  /** The tester's name, if given in the «Логи» panel (decision 5). */
  tester?: string;
}

export type RunOutcome = 'victory' | 'defeat' | 'abandoned' | 'open';

/** The hit that killed the hero: the striker's kind, the hit source (`hit.source`), the elite's affixes. */
export interface RunDeath {
  /** The striker's enemy kind (absent for a hit without an enemy, e.g. thorns). */
  enemy?: string;
  /** `hit.source`: touch, arrow, boar, wolf, lynx, blast, needles, elite fire, thorns … (a wolf's rush is classified by Node). */
  source: string;
  elite?: boolean;
  affixes?: string[];
  /** The fight key and the tick of the hit. */
  fight?: string;
  tick?: number;
}

/** A node of the run the hero went through. */
export interface RunNodeVisit {
  nodeId: string;
  row: number;
  /** The node type: battle, hard, final, event, shop, rest, find … */
  type: string;
  hpIn: number;
  hpOut: number;
  maxHp: number;
  /** A fight node: the arena, its roster and the fight key (the last attempt). */
  arena?: string;
  roster?: string;
  fight?: string;
  /** An event node: the event, the option taken and its outcome. */
  event?: { id: string; option?: string; outcome?: number };
  /**
   * Task 26 «Расписание леса» (from 15.10.2026; a run with a schedule): the fight's arc — the new living element it brings
   * (run/schedule.ts), `practice` — a practice fight. Absent — not a scheduled fight (older records too).
   */
  arc?: string;
  /** Task 26: the living elements new to the viewer in this fight (its record's `seen` less those met before), sorted; absent — not fed back. */
  fresh?: string[];
}

/** Casino «Ставка клятвы»: the source of the node card's oath choice in `RunRecord.choices` (not the Jailer's `oath`). */
export const OATH_STAKE_SOURCE = 'oath-stake';

/** B6 К7 «Проклятый сундук»: the source of the chest's talisman choice in `RunRecord.choices` (not the «Застава» `talisman`). */
export const CHEST_SOURCE = 'chest';

/** Casino «Кость у двери»: the source of the die screen's choice in `RunRecord.choices` (offered `roll` and `take`). */
export const DIE_SOURCE = 'door-die';

/** Task 16 «Подвиги»: the source of the feat's talisman choice in `RunRecord.choices` (not the «Застава» `talisman` or the chest's). */
export const FEAT_SOURCE = 'feat';
/** Task 50 «Сноровка»: the knack screen's choice (`RunChoice.source`; a rank II card offered as `<id>:2`). */
export const KNACK_SOURCE = 'knack';

/** B7 К9 «Игорный круг гоблинов»: the source of the circle's choices in `RunRecord.choices` (offered `dice`, `wheel`, `leave`; one entry a visit). */
export const CASINO_SOURCE = 'casino';

/**
 * Casino stage 1, item 4: one die screen of the run (`RunRecord.dice`). `face` — the outcome fixed when the screen showed;
 * `rolled` — «Бросить» (false — «Забрать», null — not chosen yet); `mult` — the die's multiplier paid with (1 for «Забрать»);
 * `resources` — paid; `base` — what «Забрать» pays.
 */
export interface RunDie {
  nodeId: string;
  cauldron: number;
  oath: number;
  face: number;
  rolled: boolean | null;
  mult: number | null;
  resources: number | null;
  base: number | null;
}

/** One choice of the run: what was offered, what was taken, what was refused (a gift, talismans, a hammer, a relic, an oath, the shop, the rest). */
export interface RunChoice {
  /** The node of the choice (`start` — the starting gift). */
  nodeId: string;
  /** What is chosen: `gift`, `talisman`, `hammer`, `relic`, `oath`, `shop`, `rest`, `event` … */
  source: string;
  offered: string[];
  taken: string[];
  refused: string[];
  /**
   * Task 16 telemetry (from 14.10.2026): real seconds the choice's screen was open (summed over the steps of one node and source:
   * a rest, a shop); the view measures them (`RtRecorder.runStep`'s `realSeconds`). Absent — not measured (older records too).
   */
  realSeconds?: number;
}

/** The build of the hero at the end of the run. */
export interface RunBuild {
  hp: number;
  maxHp: number;
  energy?: number;
  talismans: string[];
  hammer?: string | null;
  relics?: string[];
  oath?: string | null;
  items?: Record<string, number>;
  resources?: Record<string, number>;
}

/**
 * П8 «Новое на карте» (from 12.10.2026): a node chosen on the map while the sign «✦ новое» stood on at least one available
 * node card. `signed` — the available nodes that wore it, `nodeId` — the chosen one, `chosenSigned` — it wore it too.
 * Recorded only when a sign was shown (the toggle on).
 */
export interface RunMapSign { nodeId: string; signed: string[]; chosenSigned: boolean }

/**
 * Consumables of a run by kind (`frost`, `bomb`, `healing`, `fire`; from 12.10.2026, the report «Расходники по походам»):
 * `gained` — came into the hand (the gift, a find, a purchase, an event, a pickup in a fight), `used` — went out of it (used
 * in a fight, paid for an event), `left` — in the hand now (at the end for an ended run; for a lost one, at the end of the
 * lost fight). A kind that did not move is absent from `gained` and `used`.
 */
export interface RunItems {
  gained: Record<string, number>; used: Record<string, number>; left: Record<string, number>;
  /**
   * Task 41 «Три зелья» (from 16.10.2026; absent — none, or an older record): healing potions the run did not take because the hand
   * was full — the healing choices a screen showed refused when it closed (`rtHandFullOffers`) and a reward's healing beyond the cap
   * (`items-capped`).
   */
  capRefused?: number;
  /** Task 41: healing loot left on the floor of the run's fights for a full hand (`FightSummary.abilities.capLeft`). */
  floorLeft?: number;
}

/**
 * Task 17 «Пологий вход» (from 13.10.2026): the run's second wind (`RtRunState.secondWindSpent`) — the node, its run row and
 * the fight key where it stood the hero up (null — the fight was not recorded).
 */
export interface RunSecondWind { nodeId: string; row: number; fight: string | null }

/**
 * Task 15 «Лечение на карте» (from 14.10.2026): one map heal bought (`healOnMap`) — the run row of the last completed node (0 —
 * none yet), the price in resources, HP before and after.
 */
export interface RunMapHeal { row: number; price: number; hpBefore: number; hpAfter: number }
/**
 * Task 35, С1 «Тряска и вспышки» (from 15.10.2026): the viewer's level of the camera shake and the full-screen flash in this run,
 * per cent (100 / 50 / 0; view/juice.ts, localStorage `ashen-oath-realtime-fx`) — at the run's start, at its last write, and how
 * many times it was changed during the run (the gear of the map).
 */
export interface RunFx { start: number; end: number; changes: number }
/** С1: the levels a record may hold. */
export const RUN_FX_LEVELS: readonly number[] = [100, 50, 0];

/**
 * Task 16 «Подвиги» (from 14.10.2026): the feat of one run fight (`RunRecord.feats`). `reward` — as offered (`resources` with
 * `resources` its count, or `talisman`); `done` — the fight did it; `won` — the fight was won (the reward is paid only then);
 * `paid` — what the run gave: `resources` at the door, `talisman` — its choice opened, `fallback` — resources by the row instead
 * of a talisman (the pool was short), null — nothing (not done, or lost). `at` — game seconds of the fight when it was done,
 * `missing` — how much was missing at the end (points or seconds; 0 when done); both null when the fight's own summary was not
 * seen. `fight` — the fight key (null — not recorded).
 */
export interface RunFeat {
  nodeId: string; row: number; kind: string; n: number; reward: 'resources' | 'talisman'; resources?: number;
  done: boolean; won: boolean; paid: 'resources' | 'talisman' | 'fallback' | null; at: number | null; missing: number | null; fight: string | null;
}

/**
 * Task 16 telemetry (from 14.10.2026): the viewer's first meeting with a concept in this run (`RunRecord.firsts`), as the view
 * reports it (`RtRecorder.firstMeet`): `id` — `kind:<enemy kind>`, `affix:<affix>`, `goblin-bust`, `elite`, `bag`, `feat`,
 * `second-wind`, `heal-button`, `circle`; `fight` — the fight key when it came in a fight (null — on the map); `row` — the run
 * row of the node then (0 — before the first node).
 */
export interface RunFirst { id: string; fight: string | null; row: number }

/**
 * Task 20 «Телеметрия: ресурсы» (from 14.10.2026): where the run's crafting resources came from and where they went
 * (`RunRecord.resources`). The recorder reads every run step: the change of `materials` by kind is attributed to the step's
 * own source or sink — explicitly from the step's events and the fight it feeds back (`feat-paid`, `map-healed`,
 * `talisman-rerolled`, `casino-played`, the bag's payout and the elite loot of a won fight), the rest by the screen the step
 * acted on (recorder.ts `RESOURCE_CONTEXT`); what fits none is `other`. So for every kind start + Σ gained − Σ spent = end.
 */
export const RUN_RESOURCE_SOURCES = ['gift', 'event', 'casino', 'loot', 'bag', 'feat', 'merchant', 'other'] as const;
// Task 40: `cart` — what «Повозка» took at «Предместье» (it leaves the run's stock for the camp).
export const RUN_RESOURCE_SINKS = ['craft', 'healMap', 'merchant', 'event', 'casino', 'reroll', 'cart', 'other'] as const;
export type RunResourceSource = typeof RUN_RESOURCE_SOURCES[number];
export type RunResourceSink = typeof RUN_RESOURCE_SINKS[number];
export interface RunResources {
  /** Resources by kind when the run was created (all four kinds). */
  start: Record<string, number>;
  /** Gained by source, then by kind (only above 0; a source without any is absent). */
  gained: Partial<Record<RunResourceSource, Record<string, number>>>;
  /** Spent by sink, then by kind (only above 0). */
  spent: Partial<Record<RunResourceSink, Record<string, number>>>;
  /** Resources by kind now (the run's `materials` after the last step; all four kinds). */
  end: Record<string, number>;
  /** The count began after the start (a run created before the recorder knew the field): `start` is the hand then. */
  late?: true;
}

/** Tasks 36–37 (from 15.10.2026): the hero's XP of the run (`RunRecord.xp`) — gained, the total before and after (clipped), the parts. */
export interface RunXp { gained: number; before: number; after: number; parts: { id: string; xp: number; n?: number }[] }
/** Task 37: the resources carried to the camp (`RunRecord.carry`): carried, the share (1 or 0.5), the cap, the run's resources at the end. */
export interface RunCarry { n: number; share: number; cap: number; resources: number; /** Task 40: what «Повозка» sent (inside `n`); absent — no cart. */ cart?: number }
/** Task 37: an upgrade bought in the camp after the run (`RunRecord.hearthBuys`). */
export interface RunHearthBuy { npc: string; level: number; price: number }
/** Task 37: what the camp gave the run at its start (`RunRecord.hearth`): maps offered and the index chosen, the start consumable, Ерофей's flags. */
export interface RunHearth {
  maps?: number; map?: number; startItems?: string[]; jailerRerolls?: number; hammerAll?: true;
  /**
   * Task 51б (level 3 of the camp, from 17.10.2026): «Путь в гарнизон» offered (`garrisonMaps` 2) and the garrison map chosen (0/1);
   * «Склянка в гарнизон» — the kinds offered and the one taken; «Правка в гарнизоне» — the garrison's free rerolls given. Absent — none.
   */
  garrisonMaps?: number; garrisonMap?: number; gateItems?: string[]; gateItem?: string; garrisonRerolls?: number;
  /** Task 51в (Шиш, from 17.10.2026): «Шишова лавка» (1; with «Лавка в гарнизоне» 2) and «Размен» given. */
  shopRerolls?: number; swap?: true;
  /** Task 51г (Евлампий, from 17.10.2026): the vows taken. */
  vows?: string[];
  /** Task 51д (from 17.10.2026): the NPC away for this run. */
  away?: string;
}
/** Task 44: the fusions of a run (`RunRecord.fusions`). Rows are run rows (1…). */
export interface RunFusions {
  halves: { id: string; row: number }[];
  paired: { fusion: string; row: number }[];
  made: { fusion: string; row: number; nodeId: string }[];
  declined: { fusions: string[]; row: number; nodeId: string }[];
}
/** Task 37: the run's quest and (once the run ended) whether it was done. */
export interface RunQuest { npc: string; id: string; done?: boolean }
/**
 * Task 56 «Приметы»: a choice of the route where an omen stood among the nodes open (`RunRecord.omenRoutes`) — the level and the run row
 * of the node taken, the nodes open with their omens as the map showed them, the node taken.
 */
export interface RunOmenRoute { level: number; row: number; offered: { nodeId: string; omen?: string }[]; chosen: string }
/** Task 50: a card of the knack screen (`RunKnack`): a counter to rank II (`hone`) or a new one. */
export interface RunKnackCard { id: string; hone?: true }
/** Task 50 «Сноровка»: one knack screen of a run (`RunRecord.knacks`) — its node and run row, the cards, the one taken (null — «Пропустить»), real seconds open. */
export interface RunKnack { nodeId: string; row: number; offered: RunKnackCard[]; taken: RunKnackCard | null; realSeconds?: number }

/** The run record (`S/R/run`): written at every node and sent again under the same id (the last copy wins). */
export interface RunRecord extends RtHeader {
  kind: 'run';
  seed: number;
  outcome: RunOutcome;
  /** The farthest row reached. */
  farRow: number;
  death: RunDeath | null;
  nodes: RunNodeVisit[];
  choices: RunChoice[];
  /** The hero's build at the end (or now, for an open run). Named `kit` because `build` is the header's commit. */
  kit: RunBuild;
  /** The fight keys of the run, in order. */
  fights: string[];
  /** Casino «Кость у двери» (from 11.10.2026): the die screens of the run in order; absent — none. */
  dice?: RunDie[];
  /**
   * П6 «Незакрытое дело» (from 12.10.2026): when the run ended (ISO, the moment its last fight was recorded — a victory on the
   * final arena or a lost fight); absent — open, abandoned, or a record before it. The next run's start is its first fight's
   * `at`: «a new run within 2 minutes of the end» is read from the two.
   */
  endedAt?: string;
  /** П8 «Новое на карте» (from 12.10.2026): the map choices made with a sign shown, in order; absent — none (older records too). */
  mapSigns?: RunMapSign[];
  /** «Обучение» (from 12.10.2026): the ids of the hints shown in this run, in the order shown — from task 6 the world labels `b6`, `b8`, `b9` (marked at first sight; the v1 box's `b1`…`b5`, `b7` in older records); absent — none shown (older records too, the toggle off, the sandbox, a viewer who had done them all). */
  hints?: string[];
  /** Consumables gained / used / left (from 12.10.2026; absent in older records — the report reads «нет данных»). */
  items?: RunItems;
  /** Task 17 (from 13.10.2026): the run plays the gentle entry (`RtRunState.gentleEntry`); absent — no, or an older record. */
  gentle?: true;
  /** Task 17: the run's own flags of the start potion (`RtRunState.startPotion`) and the second wind (`RtRunState.secondWind`). */
  startPotion?: true;
  /** Task 41 «Три зелья» (from 16.10.2026): the run's cap of healing potions (`RtRunState.potionCap`); absent — no cap, or an older record. */
  potionCap?: number;
  secondWindOn?: true;
  /**
   * Task 17 (from 13.10.2026): consumables in hand when the run was created, by kind (only those above 0) — the start potion
   * of a gentle run (`healing: 1`); absent — none, a run started before the recorder, or an older record.
   */
  startItems?: Record<string, number>;
  /**
   * Task 17 (from 13.10.2026): the run's second wind stood the hero up (rows 1–4, once a run); absent — not spent (or an older
   * record). Not the flag: the flag is `secondWindOn` (names kept for the record format).
   */
  secondWind?: RunSecondWind;
  /** Task 15 (from 14.10.2026): the map heals bought, in order; absent — none (older records too). */
  mapHeals?: RunMapHeal[];
  /** Task 18 «Испытание I–V» (from 14.10.2026): the run's level, 1–5 (task 45, from 16.10.2026: 1–8; `RtRunState.ash`); absent — 0 (older records too). */
  ash?: number;
  /** Task 16 (from 14.10.2026): the run had feats (`RtRunState.feats`); absent — no (a first run, older records). */
  featsOn?: true;
  /** Task 16: the feats of the run's fights, in order; absent — none (older records too). */
  feats?: RunFeat[];
  /** Task 16 telemetry: the viewer's run number (1, 2, 3…; the profile's count); absent — not known (older records too). */
  viewerRun?: number;
  /**
   * Task 16 telemetry (review 14.10.2026): the viewer's run number is a lower bound — its count began on a profile that showed
   * earlier play (it started at 2). The report counts such a run as a repeat. Absent — exact (or not known).
   */
  viewerRunApprox?: true;
  /** Task 26 «Расписание леса» (from 15.10.2026): the run had a schedule — `start`, the living elements of the viewer's snapshot. Absent — none (older records too). */
  schedule?: { start: number };
  /** Task 16 telemetry: the viewer's first meetings in this run, in order; absent — none reported (older records too). */
  firsts?: RunFirst[];
  /** Task 20 (from 14.10.2026): the run's resources — start, gained by source, spent by sink, end; absent — older records. */
  resources?: RunResources;
  /** Task 35, С1 (from 15.10.2026): the level of «Тряска и вспышки» in the run; absent — older records (or not reported). */
  fx?: RunFx;
  /** Task 36 (from 15.10.2026): the run's XP (`RtMetaEnd.xp`); absent — not applied yet, a seeded run, older records. */
  xp?: RunXp;
  /** Task 36: the pack the run opened (its id); absent — none. */
  pack?: string;
  /**
   * Task 36: the depth record after the run (run rows) and whether this run beat it. Task 40 (from 16.10.2026): `level` 2 — the
   * record is the garrison's; `wonLevel` — the level it passed (1 the forest, 2 the garrison); absent — the forest, none.
   */
  record?: { row: number; won: boolean; beaten: boolean; level?: 2; wonLevel?: 1 | 2 };
  /**
   * Task 40 «Гарнизон, шаг 1б» (from 16.10.2026): the level the run ended on (2 — the garrison; absent — the forest, older records)
   * and the highest level it passed (`levelCleared`: 1 — the forest's final won, 2 — the Castellan; absent — none).
   */
  level?: 2;
  levelCleared?: 1 | 2;
  /** Task 40 «Повозка»: what the cart sent at «Предместье» (`n`) and the stock it was taken from (`before`); absent — no cart. */
  cart?: { n: number; before: number };
  /** Task 59б (from 21.10.2026): the trails' drill of a run of step 3 (`RtRunState.step3.drill`); absent — no step 3, older records. */
  drill?: 'armory' | 'barracks';
  /** Task 36: items locked in the run (the snapshot's count; 0 — a meta run with every pack open); absent — not a meta run. */
  locked?: number;
  /** Task 37: the carry to the camp and the stock before and after it (the quest's stock included). */
  carry?: RunCarry;
  stock?: { before: number; after: number };
  /** Task 37: upgrades bought in the camp after this run, in order; NPC clicks there by NPC. */
  hearthBuys?: RunHearthBuy[];
  npcClicks?: Record<string, number>;
  /** Task 37: what the camp gave this run at its start; the run's quest. */
  hearth?: RunHearth;
  quest?: RunQuest;
  /** Task 51в (from 17.10.2026): the NPCs who came to the camp after this run — `path` the deed or the fallback, the viewer's run number. */
  arrive?: { npc: string; path: 'deed' | 'self'; viewerRun?: number }[];
  /** Task 51г (from 17.10.2026): the run's vows, each kept or not (counted runs only: the Jailer's row reached). */
  vows?: { id: string; kept: boolean }[];
  /** Task 51д (from 17.10.2026): the NPC away of this run — met at a rest of its zone (its node, the deal) or not («не дождался»). */
  npcMeet?: { npc: string; met: boolean; nodeId?: string; deal?: string };
  /**
   * Task 58 «Летопись» (from 20.10.2026): the entries the run added (refs `kind:lynx`, `item:prism` …), the pages' counts after it
   * (`[have, known]`, the visible chapters) and the items seen and not taken; absent — the chronicle off (or a run with a given seed).
   */
  chronicle?: { added: string[]; pages: Record<string, [number, number]>; seenItems?: number };
  /** Task 58: the window «Летопись» opened in the camp after this run, each time — the pages looked at, the seconds open, «✦» on it. */
  chronicleOpen?: { pages: string[]; seconds: number; unread: boolean }[];
  /** Task 58: the owl's hint shown in the camp after this run (`rtChronicleHint`: the line's key, the target's ref). */
  hint?: { key: string; target: string };
  /** Task 51е «Трофеи» (from 21.10.2026): the trophies the run earned — ids, a new mark of «Доска Испытания» as `ash:<step>`; absent — none. */
  trophies?: string[];
  /**
   * Task 44 «Сплавы» (from 16.10.2026): the run has fusions (`RtRunState.fusions`) and what happened to them — the halves taken (their
   * row), the pairs collected, the fusions made at a rest and the rests closed by the heal or the craft with a pair ready. Absent — a
   * run without the flag (older records too).
   */
  fusions?: RunFusions;
  /**
   * Task 50 «Сноровка» (from 16.10.2026): the run has the knack screen (`RtRunState.knacks`), its screens, and the counters it put on rank
   * II in order (with the run row). Absent — a run without the flag (older records too); `knacks`/`honed` absent — none yet.
   */
  knacksOn?: true;
  knacks?: RunKnack[];
  honed?: { id: string; row: number }[];
  /**
   * Task 50 «Повадка» (from 16.10.2026): the run offered the archetype row on the gift (`RtRunState.habits`) and the archetype chosen
   * (absent — «Без повадки», or not chosen yet). `heroId` of the meta stands beside it (task 49 compares them).
   */
  habitsOn?: true;
  /**
   * Task 51з «Поход дня» (from 17.10.2026): the run of the day — its date, the attempt's number on the date (1 — the first), whether it
   * is the first, and `verified` — its proof passed the check by replay («Проверить»). Absent — an ordinary run (older records too).
   */
  daily?: { date: string; attempt: number; first: boolean; verified?: true };
  habit?: string;
  /** Task 49 «Второй герой» (from 16.10.2026): the run's hero other than the cat (`RtRunState.heroId`); absent — the cat (older records too). */
  hero?: 'toad';
  /**
   * Task 49: this run freed a hero — the first win over the Jailer in a meta run (`RtProfileStore.freeHero`): the hero and the run row.
   * Absent — none.
   */
  freed?: { hero: 'toad'; row: number };
  /**
   * Task 56 «Приметы» (from 17.10.2026): the run had the omens (`RtRunState.omens`) — its pool, the levels' omens (as each level began),
   * the route choices where an omen stood among the nodes open (`omenRoutes`: written only then), the steps off the map's links under
   * «Перепутье». Absent — a run without them (older records too).
   */
  omensOn?: true;
  omenPool?: string[];
  levelOmens?: { level: number; id: string }[];
  omenRoutes?: RunOmenRoute[];
  crossroadsSteps?: number;
  /** Task 56 «Ярмарочный день»: the omen's free rerolls spent (merchants). Absent — none. */
  fairRerolls?: number;
  /** The Params of the run, once per run (decision 3): the journals name them by `params.hash`. Named `runParams` because `params` is the header's `{storage, hash}`. */
  runParams: Params;
}

export type FightOutcome = 'victory' | 'defeat' | 'restart' | 'menu' | 'unload';

/** The fight record (`S/R/<fight>/fight`). */
export interface FightRecord extends RtHeader {
  kind: 'fight';
  /** The fight key (`fightKey`). */
  fight: string;
  /** The node of the run (absent in the sandbox). */
  nodeId?: string;
  arena: string;
  roster?: string;
  row?: number;
  /** Task 38 (from 16.10.2026): 2 — a fight of the garrison (`row` is the garrison's); absent — the forest, the sandbox (older records too). */
  level?: 2;
  /** Task 26 (from 15.10.2026): the scheduled fight's arc (`RunNode.arc`; `practice`); absent — not a scheduled fight (older records too). */
  arc?: string;
  /** Task 56 «Приметы» (from 17.10.2026): the fight's omens — its node's and its level's (the run's battle card); absent — none (older records too). */
  omens?: { id: string; scope: 'node' | 'level' }[];
  seed: number;
  outcome: FightOutcome;
  /** Ticks run and game seconds (`world.time`). */
  ticks: number;
  time: number;
  hpIn: number;
  hpOut: number;
  /** The world hash at the end; a replay of the journal must give it. */
  endHash: string;
  /** The journal: parts, length and digest of the assembled text, its encoding. */
  journal: JournalMeta;
  /** The size of the view in arena units at the end (Node approximates «in view» with it, decision 13). */
  view?: { w: number; h: number };
  summary: FightSummary;
}

/** A part of a fight journal (`S/R/<fight>/j<i>of<n>`). */
export interface JournalPart extends RtHeader {
  kind: 'journal';
  fight: string;
  index: number;
  count: number;
  /** The digest and the encoding of the whole assembled text (the same in every part of one journal). */
  digest: string;
  encoding: JournalEncoding;
  data: string;
}

/** A mark of the N key (`S/R/<fight>/n<tick>`): «something is wrong here». */
export interface NoteRecord extends RtHeader {
  kind: 'note';
  fight: string;
  tick: number;
  arena: string;
  hero: { x: number; y: number };
}

/** Where a prologue playthrough was started: the first launch of a viewer without the key «пролог пройден», or the gear's «Обучение». */
export type PrologueFrom = 'first' | 'gear';
/** How a prologue playthrough ended: the last room won (`done`), «Пропустить обучение» (`skip`), or not yet / the page closed (`open`). */
export type PrologueOutcome = 'done' | 'skip' | 'open';

/**
 * One room of a prologue playthrough (all its attempts together). Times sum over the attempts: game seconds (`world.time` while
 * the room plays) and real seconds (frames while the room plays, not paused); the fade between rooms and the beat after a death
 * are left out.
 */
export interface PrologueRoomTally {
  /** 1 … the record's `roomCount` (10; 9 — the rooms of task 9; a record without it — 1…6, the rooms of task 6). */
  room: number;
  /** Starts of the room (1 + the replays after a death). */
  attempts: number;
  /** Deaths (rooms 8–10 — «Гоблин», «Щит», «Толпа»: a death plays the room again). */
  deaths: number;
  /**
   * Returns of the start enemies (event `restore`; rooms 2–4, 6, 8 and 9). A late batch under the hero is the same return; the
   * energy coming back alone in room 5 sends no event.
   */
  restores: number;
  gameSeconds: number;
  realSeconds: number;
  /** Times the ghost hand came / the arrow with the circle came (0 — never shown). */
  hands: number;
  arrows: number;
  /** `win` — passed; `skip` — skipped in it; `open` — left unfinished (the page closed, or the room plays now). */
  outcome: 'win' | 'skip' | 'open';
  /**
   * Task 24 «Урок перебора» (15.10.2026; room 8 «Гоблин»): the show busts of the room, one per lit idol in the order they came (all
   * attempts). Absent — none seen (other rooms, records before it).
   */
  busts?: PrologueBust[];
}

/** Task 24: one show bust of prologue room 8 (`PrologueBustWatch`, telemetry/prologue.ts; the view reads it every frame). */
export interface PrologueBust {
  /** The hero's body touched the circle when the idol lit. */
  inside: boolean;
  /**
   * Game seconds from the light to the frame his body was out of the circle for good (0.01; frame-precise); null — out of it at
   * the light, in it at the blast, or the room ended in the fuse.
   */
  outAfter: number | null;
  /** HP the blast took from him (0 — none); null — the room ended before it went off. */
  damage: number | null;
}

/**
 * The prologue record (`S/P/prologue`, from 13.10.2026): one playthrough of the prologue «Опушка» — light, without fight
 * journals (the rooms' determinism is checked by the Node tests). Written at each room's start and end and at the end, sent again
 * under the same id (the last copy wins). Older logs have no such records; the report's section «Пролог» reads «нет данных».
 */
export interface PrologueRecord extends RtHeader {
  kind: 'prologue';
  from: PrologueFrom;
  outcome: PrologueOutcome;
  /** The room in which «Пропустить обучение» was pressed (null — not skipped). */
  skipRoom: number | null;
  /** The rooms reached, in order. */
  rooms: PrologueRoomTally[];
  /**
   * How many rooms the prologue had when the record was written (task 13, 13.10.2026: 10; task 9: 9 — its room 9 «Толпа» is room
   * 10 now). Absent — a record of the six rooms of
   * task 6, whose rooms 5 and 6 are «Гоблин» and «Толпа» (now 8 and 10; the report reads them so — report.ts `prologueRoomNow`).
   */
  roomCount?: number;
  /** When the playthrough ended (ISO; absent — open). */
  endedAt?: string;
}

/** Rooms of a prologue record without `roomCount` (task 6, before 13.10.2026 task 9). */
export const PROLOGUE_ROOMS_V1 = 6;

/** How a warmup attempt ended: its time limit, a clear field, the hero's death, or «Выход» (the view's own end; no score). */
export type WarmupEndKind = 'limit' | 'clear' | 'death' | 'exit';

/**
 * The warmup record (`S/W/warmup`, task 51ж, 17.10.2026; telemetry/warmup.ts): one attempt of a camp's warmup layout (run/warmup.ts)
 * — light, without its journal (the layouts' determinism is checked by the Node tests). Older logs have none; the report's section
 * «Разминка» reads «нет данных».
 */
export interface WarmupRecord extends RtHeader {
  kind: 'warmup';
  /** The layout (`warmup-line`, `warmup-mix`, `warmup-gap`). */
  layout: string;
  end: WarmupEndKind;
  /** The attempt's score (`warmupScore`); null — none (a death, an exit, «Пестрота» not cleared, nothing done). */
  score: number | null;
  /** The layout's best before the attempt (null — none). */
  before: number | null;
  /** The attempt set a new best (the view's line `warmup_record`). */
  record: boolean;
  /** Game seconds of the attempt (`world.time`) and real ones (frames without pause), to 0.01. */
  gameSeconds: number;
  realSeconds: number;
}

export type RtRecord = RunRecord | FightRecord | JournalPart | NoteRecord | PrologueRecord | WarmupRecord;

/** A receiver of records (the artifact's `window.__rtTelemetrySink`, the dev-server channel …). A failed write keeps the record in the browser buffer. */
export interface RtTelemetrySink {
  name?: string;
  write(record: RtRecord): Promise<void>;
}

/** The page hook of the «Экспорт» button (decision 4): the artifact page saves the file itself. */
export type RtTelemetryExportHook = (filename: string, text: string) => Promise<void>;

/** What the telemetry looks for on `window` (the view declares nothing global; it reads these lazily). */
export interface RtTelemetryWindow {
  __rtTelemetrySink?: RtTelemetrySink;
  __rtTelemetryExport?: RtTelemetryExportHook;
}

/**
 * Task 20: `RunRecord.resources` is well formed — `start` and `end` map kinds to whole numbers ≥ 0, `gained` and `spent` map a
 * source (sink) to kinds with whole numbers ≥ 1; `late` is `true` or absent. The balance itself is not checked here (the
 * report shows it): a record that does not add up is still read.
 */
function runResourcesOk(value: unknown): boolean {
  const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const counts = (x: unknown, min: number): boolean => plain(x) && Object.values(x).every(n => Number.isInteger(n) && (n as number) >= min);
  const book = (x: unknown): boolean => plain(x) && Object.values(x).every(kinds => counts(kinds, 1));
  return plain(value) && counts(value.start, 0) && counts(value.end, 0) && book(value.gained) && book(value.spent) && (value.late === undefined || value.late === true);
}

/** Tasks 36–37: the optional meta fields of a run record are well formed (each absent, or of its shape). */
function runMetaOk(r: Record<string, unknown>): boolean {
  const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const whole = (x: unknown, min = 0): boolean => Number.isInteger(x) && (x as number) >= min;
  const xp = r.xp, record = r.record, carry = r.carry, stock = r.stock, hearth = r.hearth, quest = r.quest;
  if (xp !== undefined && !(plain(xp) && whole(xp.gained) && whole(xp.before) && whole(xp.after) && Array.isArray(xp.parts)
    && xp.parts.every(p => plain(p) && typeof p.id === 'string' && whole(p.xp) && (p.n === undefined || whole(p.n))))) return false;
  if (r.pack !== undefined && !(typeof r.pack === 'string' && r.pack.length > 0)) return false;
  if (record !== undefined && !(plain(record) && whole(record.row) && typeof record.won === 'boolean' && typeof record.beaten === 'boolean'
    && (record.level === undefined || record.level === 2) && (record.wonLevel === undefined || record.wonLevel === 1 || record.wonLevel === 2))) return false;
  if (r.locked !== undefined && !whole(r.locked)) return false;
  if (carry !== undefined && !(plain(carry) && whole(carry.n) && (carry.share === 1 || carry.share === 0.5) && whole(carry.cap) && whole(carry.resources) && (carry.cart === undefined || whole(carry.cart)))) return false;
  // Task 40 (16.10.2026): the run's level (2), the level it passed (1 or 2), the cart (`n` of `before`).
  if (r.level !== undefined && r.level !== 2) return false;
  if (r.levelCleared !== undefined && r.levelCleared !== 1 && r.levelCleared !== 2) return false;
  if (r.cart !== undefined && !(plain(r.cart) && whole(r.cart.n) && whole(r.cart.before) && (r.cart.n as number) <= (r.cart.before as number))) return false;
  // Task 59б: the trails' drill of step 3.
  if (r.drill !== undefined && r.drill !== 'armory' && r.drill !== 'barracks') return false;
  if (stock !== undefined && !(plain(stock) && whole(stock.before) && whole(stock.after))) return false;
  if (r.hearthBuys !== undefined && !(Array.isArray(r.hearthBuys) && r.hearthBuys.every(b => plain(b) && typeof b.npc === 'string' && whole(b.level, 1) && whole(b.price, 1)))) return false;
  if (r.npcClicks !== undefined && !(plain(r.npcClicks) && Object.values(r.npcClicks).every(n => whole(n, 1)))) return false;
  if (hearth !== undefined && !(plain(hearth) && (hearth.maps === undefined || whole(hearth.maps, 2)) && (hearth.map === undefined || whole(hearth.map))
    && (hearth.startItems === undefined || (Array.isArray(hearth.startItems) && hearth.startItems.every(id => typeof id === 'string')))
    && (hearth.jailerRerolls === undefined || whole(hearth.jailerRerolls, 1)) && (hearth.hammerAll === undefined || hearth.hammerAll === true)
    // Task 51б: level 3 of the camp.
    && (hearth.garrisonMaps === undefined || whole(hearth.garrisonMaps, 2)) && (hearth.garrisonMap === undefined || whole(hearth.garrisonMap))
    && (hearth.gateItems === undefined || (Array.isArray(hearth.gateItems) && hearth.gateItems.every(id => typeof id === 'string'))) && (hearth.gateItem === undefined || typeof hearth.gateItem === 'string')
    && (hearth.garrisonRerolls === undefined || whole(hearth.garrisonRerolls, 1))
    && (hearth.shopRerolls === undefined || whole(hearth.shopRerolls, 1)) && (hearth.swap === undefined || hearth.swap === true)
    && (hearth.vows === undefined || (Array.isArray(hearth.vows) && hearth.vows.every(id => typeof id === 'string'))) && (hearth.away === undefined || typeof hearth.away === 'string'))) return false;
  // Task 58: the chronicle's counts, openings and hint.
  const chronicle = r.chronicle as Record<string, unknown> | undefined;
  if (chronicle !== undefined && !(plain(chronicle) && Array.isArray(chronicle.added) && chronicle.added.every(id => typeof id === 'string') && plain(chronicle.pages)
    && Object.values(chronicle.pages).every(p => Array.isArray(p) && p.length === 2 && whole(p[0]) && whole(p[1]) && (p[0] as number) <= (p[1] as number)) && (chronicle.seenItems === undefined || whole(chronicle.seenItems)))) return false;
  if (r.chronicleOpen !== undefined && !(Array.isArray(r.chronicleOpen) && r.chronicleOpen.every(o => plain(o) && Array.isArray(o.pages) && o.pages.every(p => typeof p === 'string') && typeof o.seconds === 'number' && o.seconds >= 0 && typeof o.unread === 'boolean'))) return false;
  if (r.hint !== undefined && !(plain(r.hint) && typeof r.hint.key === 'string' && typeof r.hint.target === 'string')) return false;
  // Task 51е: the trophies earned.
  if (r.trophies !== undefined && !(Array.isArray(r.trophies) && r.trophies.length && r.trophies.every(id => typeof id === 'string' && id.length > 0))) return false;
  if (r.npcMeet !== undefined && !(plain(r.npcMeet) && typeof r.npcMeet.npc === 'string' && typeof r.npcMeet.met === 'boolean' && (r.npcMeet.nodeId === undefined || typeof r.npcMeet.nodeId === 'string') && (r.npcMeet.deal === undefined || typeof r.npcMeet.deal === 'string'))) return false;
  if (r.vows !== undefined && !(Array.isArray(r.vows) && r.vows.every(v => plain(v) && typeof v.id === 'string' && typeof v.kept === 'boolean'))) return false;
  if (r.arrive !== undefined && !(Array.isArray(r.arrive) && r.arrive.every(a => plain(a) && typeof a.npc === 'string' && (a.path === 'deed' || a.path === 'self') && (a.viewerRun === undefined || whole(a.viewerRun, 1))))) return false;
  if (quest !== undefined && !(plain(quest) && typeof quest.npc === 'string' && typeof quest.id === 'string' && (quest.done === undefined || typeof quest.done === 'boolean'))) return false;
  return true;
}

/**
 * A shallow check of a record before it is stored or written to a file: the header, the id agreeing with the kind, the
 * fields each kind needs. Returns the first problem or null.
 */
export function checkRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not an object';
  const r = value as Record<string, unknown>;
  if (r.schema !== RT_TELEMETRY_SCHEMA) return `schema ${String(r.schema)}`;
  const parsed = parseRecordId(r.id);
  if (!parsed) return `bad id ${JSON.stringify(r.id)}`;
  if (r.kind !== parsed.kind) return `kind ${String(r.kind)}, the id says ${parsed.kind}`;
  if (r.session !== parsed.session || r.run !== parsed.run) return 'session or run differ from the id';
  if (typeof r.build !== 'string' || typeof r.at !== 'string') return 'build or at';
  const p = r.params as Record<string, unknown> | undefined;
  if (!p || typeof p.storage !== 'string' || typeof p.hash !== 'string') return 'params {storage, hash}';
  if (r.tester !== undefined && typeof r.tester !== 'string') return 'tester';
  const num = (k: string): boolean => typeof r[k] === 'number' && Number.isFinite(r[k]);
  switch (parsed.kind) {
    case 'run':
      if (!num('seed') || !num('farRow') || !Array.isArray(r.nodes) || !Array.isArray(r.choices) || !Array.isArray(r.fights) || !r.runParams || !r.kit) return 'run fields';
      if (!['victory', 'defeat', 'abandoned', 'open'].includes(r.outcome as string)) return `run outcome ${String(r.outcome)}`;
      // Task 17 (13.10.2026): optional fields — the flag, the start consumables, the second wind.
      if (r.gentle !== undefined && r.gentle !== true) return 'run gentle';
      if (r.startPotion !== undefined && r.startPotion !== true) return 'run startPotion';
      if (r.secondWindOn !== undefined && r.secondWindOn !== true) return 'run secondWindOn';
      if (r.startItems !== undefined && !(r.startItems && typeof r.startItems === 'object' && !Array.isArray(r.startItems)
        && Object.values(r.startItems).every(n => Number.isInteger(n) && (n as number) > 0))) return 'run startItems';
      if (r.secondWind !== undefined) {
        const w = r.secondWind as Record<string, unknown> | null;
        if (!w || typeof w !== 'object' || typeof w.nodeId !== 'string' || !Number.isInteger(w.row) || !(w.fight === null || typeof w.fight === 'string')) return 'run secondWind';
      }
      // Task 18 (14.10.2026): optional — the level of «Испытание», 1–5; task 45 (16.10.2026): 1–8.
      if (r.ash !== undefined && !(Number.isInteger(r.ash) && (r.ash as number) >= 1 && (r.ash as number) <= 8)) return 'run ash';
      // Task 41 (16.10.2026): optional — the cap of healing potions, a whole number from 1.
      if (r.potionCap !== undefined && !(Number.isInteger(r.potionCap) && (r.potionCap as number) >= 1)) return 'run potionCap';
      // Task 44 (16.10.2026): optional — the fusions: four lists of objects with a row (and an id, a fusion, a node).
      if (r.fusions !== undefined) {
        const f = r.fusions as Record<string, unknown> | null, list = (v: unknown, keys: readonly string[]): boolean => Array.isArray(v) && v.every(x => {
          const o = x as Record<string, unknown> | null;
          return !!o && typeof o === 'object' && Number.isInteger(o.row) && keys.every(k => typeof o[k] === 'string' || (k === 'fusions' && Array.isArray(o[k])));
        });
        if (!f || typeof f !== 'object' || !list(f.halves, ['id']) || !list(f.paired, ['fusion']) || !list(f.made, ['fusion', 'nodeId']) || !list(f.declined, ['fusions', 'nodeId'])) return 'run fusions';
      }
      // Task 50 (16.10.2026): optional — the knack screens (cards with an id, a node, a row), the counters on rank II, the archetype.
      if (r.knacksOn !== undefined && r.knacksOn !== true) return 'run knacksOn';
      if (r.habitsOn !== undefined && r.habitsOn !== true) return 'run habitsOn';
      // Task 51з (17.10.2026): optional — the run of the day.
      if (r.daily !== undefined) {
        const d = r.daily as Record<string, unknown> | null;
        if (!d || typeof d !== 'object' || typeof d.date !== 'string' || !Number.isInteger(d.attempt) || (d.attempt as number) < 1 || typeof d.first !== 'boolean' || (d.verified !== undefined && d.verified !== true)) return 'run daily';
      }
      if (r.habit !== undefined && !(typeof r.habit === 'string' && r.habitsOn === true)) return 'run habit';
      // Task 49 (16.10.2026): optional — the run's hero (`toad`), the hero this run freed and the row.
      if (r.hero !== undefined && r.hero !== 'toad') return 'run hero';
      if (r.freed !== undefined && !(r.freed && typeof r.freed === 'object' && (r.freed as Record<string, unknown>).hero === 'toad' && Number.isInteger((r.freed as Record<string, unknown>).row))) return 'run freed';
      const card = (c: unknown): boolean => { const o = c as Record<string, unknown> | null; return !!o && typeof o === 'object' && typeof o.id === 'string' && (o.hone === undefined || o.hone === true); };
      if (r.knacks !== undefined && !(r.knacksOn === true && Array.isArray(r.knacks) && r.knacks.every(k => {
        const o = k as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && typeof o.nodeId === 'string' && Number.isInteger(o.row) && Array.isArray(o.offered) && o.offered.every(card)
          && (o.taken === null || card(o.taken)) && (o.realSeconds === undefined || (typeof o.realSeconds === 'number' && o.realSeconds >= 0));
      }))) return 'run knacks';
      if (r.honed !== undefined && !(r.knacksOn === true && Array.isArray(r.honed) && r.honed.every(h => { const o = h as Record<string, unknown> | null; return !!o && typeof o.id === 'string' && Number.isInteger(o.row); }))) return 'run honed';
      // Task 15 (14.10.2026): optional — the map heals bought.
      if (r.mapHeals !== undefined && !(Array.isArray(r.mapHeals) && r.mapHeals.every(h => {
        const o = h as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && ['row', 'price', 'hpBefore', 'hpAfter'].every(k => Number.isInteger(o[k])) && (o.price as number) >= 1 && (o.hpAfter as number) > (o.hpBefore as number);
      }))) return 'run mapHeals';
      // Task 35, С1 (15.10.2026): optional — the level of «Тряска и вспышки».
      if (r.fx !== undefined) {
        const o = r.fx as Record<string, unknown> | null;
        if (!o || typeof o !== 'object' || !RUN_FX_LEVELS.includes(o.start as number) || !RUN_FX_LEVELS.includes(o.end as number) || !(Number.isInteger(o.changes) && (o.changes as number) >= 0)) return 'run fx';
      }
      // Task 16 (14.10.2026): optional — the feats flag and list, the viewer's run number, the first meetings, the choice times.
      if (r.featsOn !== undefined && r.featsOn !== true) return 'run featsOn';
      if (r.feats !== undefined && !(Array.isArray(r.feats) && r.feats.every(f => {
        const o = f as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && typeof o.nodeId === 'string' && typeof o.kind === 'string' && Number.isInteger(o.row) && Number.isInteger(o.n)
          && ['resources', 'talisman'].includes(o.reward as string) && typeof o.done === 'boolean' && typeof o.won === 'boolean'
          && (o.paid === null || ['resources', 'talisman', 'fallback'].includes(o.paid as string)) && (o.fight === null || typeof o.fight === 'string');
      }))) return 'run feats';
      if (r.viewerRun !== undefined && !(Number.isInteger(r.viewerRun) && (r.viewerRun as number) >= 1)) return 'run viewerRun';
      if (r.viewerRunApprox !== undefined && !(r.viewerRunApprox === true && r.viewerRun !== undefined)) return 'run viewerRunApprox';
      // Task 26 (15.10.2026): optional — the schedule's start and the nodes' arcs and new elements.
      if (r.schedule !== undefined && !(!!r.schedule && typeof r.schedule === 'object' && Number.isInteger((r.schedule as Record<string, unknown>).start) && ((r.schedule as Record<string, unknown>).start as number) >= 0)) return 'run schedule';
      if (!(r.nodes as unknown[]).every(n => { const o = n as Record<string, unknown> | null; return !!o && (o.arc === undefined || (typeof o.arc === 'string' && o.arc.length > 0)) && (o.fresh === undefined || (Array.isArray(o.fresh) && o.fresh.every(id => typeof id === 'string'))); })) return 'run node arc';
      if (r.firsts !== undefined && !(Array.isArray(r.firsts) && r.firsts.every(f => {
        const o = f as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && typeof o.id === 'string' && o.id.length > 0 && (o.fight === null || typeof o.fight === 'string') && Number.isInteger(o.row);
      }))) return 'run firsts';
      if (!(r.choices as unknown[]).every(c => { const t = (c as Record<string, unknown> | null)?.realSeconds; return t === undefined || (typeof t === 'number' && Number.isFinite(t) && t >= 0); })) return 'run choice realSeconds';
      // Task 20 (14.10.2026): optional — the run's resources.
      if (r.resources !== undefined && !runResourcesOk(r.resources)) return 'run resources';
      // Tasks 36–37 (15.10.2026): optional — the meta of the run and the camp.
      if (!runMetaOk(r)) return 'run meta';
      // Task 56 (17.10.2026): optional — the omens of the run.
      if (!runOmensOk(r)) return 'run omens';
      return null;
    case 'fight': {
      if (r.fight !== parsed.fight || typeof r.arena !== 'string' || !num('seed') || !num('ticks') || !num('time') || !num('hpIn') || !num('hpOut') || typeof r.endHash !== 'string' || !r.summary) return 'fight fields';
      if (!['victory', 'defeat', 'restart', 'menu', 'unload'].includes(r.outcome as string)) return `fight outcome ${String(r.outcome)}`;
      if (r.arc !== undefined && !(typeof r.arc === 'string' && r.arc.length > 0)) return 'fight arc';
      // Task 38: the garrison's fights only (a node of the garrison).
      if (r.level !== undefined && !(r.level === 2 && typeof r.nodeId === 'string' && r.nodeId.startsWith('g:'))) return 'fight level';
      // Task 56: the fight's omens (a run's fight), the counters of the summary.
      if (r.omens !== undefined && !(typeof r.nodeId === 'string' && Array.isArray(r.omens) && r.omens.length && r.omens.every(o => { const x = o as Record<string, unknown> | null; return !!x && typeof x.id === 'string' && (x.scope === 'node' || x.scope === 'level'); }))) return 'fight omens';
      const fired = (r.summary as Record<string, unknown>).omenFired;
      if (fired !== undefined && !(!!fired && typeof fired === 'object' && Object.values(fired).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0))) return 'fight omenFired';
      // Task 59б: the step 3's block of the summary (the anger's ends from 22.10.2026).
      if (!step3SummaryOk(((r.summary as Record<string, unknown>).garrison as Record<string, unknown> | undefined)?.step3)) return 'fight step3';
      const j = r.journal as Record<string, unknown> | undefined;
      if (!j || typeof j.parts !== 'number' || typeof j.chars !== 'number' || typeof j.digest !== 'string' || typeof j.encoding !== 'string') return 'fight journal meta';
      return null;
    }
    case 'journal':
      if (r.fight !== parsed.fight || r.index !== parsed.index || r.count !== parsed.parts || typeof r.data !== 'string' || typeof r.digest !== 'string' || typeof r.encoding !== 'string') return 'journal part fields';
      return null;
    case 'note': {
      const hero = r.hero as Record<string, unknown> | undefined;
      if (r.fight !== parsed.fight || r.tick !== parsed.tick || typeof r.arena !== 'string' || !hero || typeof hero.x !== 'number' || typeof hero.y !== 'number') return 'note fields';
      return null;
    }
    case 'prologue': {
      if (!['first', 'gear'].includes(r.from as string) || !['done', 'skip', 'open'].includes(r.outcome as string)) return 'prologue from or outcome';
      // The room numbers: 1 … `roomCount` (absent — the six rooms of task 6).
      if (r.roomCount !== undefined && !(Number.isInteger(r.roomCount) && (r.roomCount as number) >= 1)) return 'prologue roomCount';
      const rooms = (r.roomCount as number | undefined) ?? PROLOGUE_ROOMS_V1, roomNo = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= rooms;
      if (r.skipRoom !== null && !(num('skipRoom') && roomNo(r.skipRoom))) return 'prologue skipRoom';
      if (!Array.isArray(r.rooms)) return 'prologue rooms';
      for (const room of r.rooms as unknown[]) {
        const o = room as Record<string, unknown> | null;
        if (!o || typeof o !== 'object' || !['room', 'attempts', 'deaths', 'restores', 'gameSeconds', 'realSeconds', 'hands', 'arrows'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k]))
          || !['win', 'skip', 'open'].includes(o.outcome as string)) return 'prologue room fields';
        if (!roomNo(o.room)) return 'prologue room number';
        const nullNum = (x: unknown): boolean => x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
        if (o.busts !== undefined && !(Array.isArray(o.busts) && (o.busts as unknown[]).every(b => {
          const x = b as Record<string, unknown> | null;
          return !!x && typeof x === 'object' && typeof x.inside === 'boolean' && nullNum(x.outAfter) && nullNum(x.damage);
        }))) return 'prologue room busts';
      }
      return null;
    }
    case 'warmup': {
      if (typeof r.layout !== 'string' || !['limit', 'clear', 'death', 'exit'].includes(r.end as string)) return 'warmup layout or end';
      const score = (x: unknown): boolean => x === null || (typeof x === 'number' && Number.isFinite(x) && x > 0);
      if (!score(r.score) || !score(r.before) || typeof r.record !== 'boolean') return 'warmup score, before or record';
      if (r.record && r.score === null) return 'warmup record without a score';
      if (!['gameSeconds', 'realSeconds'].every(k => num(k) && (r[k] as number) >= 0)) return 'warmup seconds';
      return null;
    }
  }
}

/**
 * The parts of one journal in order, from part records in any order: the parts must be `0 … count−1` of the fight, all
 * with the same digest. The text is then checked by `assembleParts` against the fight record.
 */
export function orderedParts(records: readonly JournalPart[], fight: string, digest: string): string[] {
  const own = records.filter(r => r.fight === fight && r.digest === digest);
  if (!own.length) throw new Error(`journal of ${fight}: no parts`);
  const n = own[0].count, out: string[] = new Array<string>(n);
  for (const r of own) {
    if (r.count !== n || r.index < 0 || r.index >= n) throw new Error(`journal of ${fight}: part ${r.index} of ${r.count}, expected of ${n}`);
    out[r.index] = r.data;
  }
  for (let i = 0; i < n; i++) if (out[i] === undefined) throw new Error(`journal of ${fight}: part ${i} of ${n} is missing`);
  return out;
}

// ---- Export ----

export const RT_TELEMETRY_FORMAT = 'ashen-oath-rt-telemetry';

/** The «Экспорт» file. */
export interface RtTelemetryExport {
  format: typeof RT_TELEMETRY_FORMAT;
  version: 1;
  exportedAt: string;
  session: string;
  records: RtRecord[];
}

export function makeExport(session: string, records: readonly RtRecord[], exportedAt: string): RtTelemetryExport {
  return { format: RT_TELEMETRY_FORMAT, version: 1, exportedAt, session, records: [...records] };
}

/** An export file read back; the format and every record are checked. */
export function parseExport(text: string): RtTelemetryExport {
  const raw = JSON.parse(text) as Partial<RtTelemetryExport>;
  if (raw.format !== RT_TELEMETRY_FORMAT || raw.version !== 1 || !Array.isArray(raw.records)) throw new Error('not an ashen-oath-rt-telemetry export of version 1');
  raw.records.forEach((r, i) => {
    const problem = checkRecord(r);
    if (problem) throw new Error(`record ${i}: ${problem}`);
  });
  return raw as RtTelemetryExport;
}

// ---- The fight summary (filled by the observer of track ТB) ----

/** An average and a maximum over the ticks of the fight. */
export interface AvgMax { avg: number; max: number }

/** How one warning (an archer's mark, a boar's lane, a wolf pack's rush, a lynx's leap, a sapper's circle) ended for the hero. */
export interface ThreatTally {
  /** Warnings with the hero in the zone when it appeared. */
  warned: number;
  hit: number;
  dodged: number;
  /** Body in the zone on the strike tick but untouchable (invulnerability, chain shield, the dash, a jump): decision 12. */
  shielded: number;
  /** The enemy died, was knocked back, or the fight ended. */
  interrupted: number;
  /** Ticks from the zone fixed to the first tick out of it (dodges). */
  exitTicks: number[];
}

export interface FightSummary {
  /** Damage to the hero by `hit.source` and the moments the HP fell to 3 or lower. */
  damage: {
    total: number; bySource: Record<string, number>; hits: Record<string, number>; lowHp: { tick: number; hp: number }[];
    /**
     * Package «Урон имеет значение» (from 11.10.2026): touches whose damage the sim raised (`touchRaised`: an armoured elite,
     * or with `toughTouch` an elite or an enemy with HP ≥ 2) — hits and HP. A subset of `bySource` (`touch`, `wolf-rush` …).
     */
    raisedTouches: { hits: number; damage: number };
    /**
     * Task 49 «Второй герой» (from 16.10.2026): Ведунья's fight (the law `hero-toad` in the kit) — hits on her within the after-chain
     * shield's length after an open chain that killed enough for the cat's shield (the price of her law: where the cat stands shielded).
     * Absent — the cat's fight (older records too).
     */
    unshielded?: { hits: number; damage: number };
  };
  /** Readability of threats by warning kind (`archer`, `boar`, `wolf`, `lynx`, `sapper` …). */
  threats: Record<string, ThreatTally>;
  chain: {
    count: number;
    lengthMedian: number;
    lengthMax: number;
    cancels: number;
    /** Steps back along the drawn chain. */
    backsteps: number;
    crystals: number;
    colorChanges: number;
    focusSpent: number;
    /** Ticks the focus was empty while focusing. */
    focusEmpty: number;
    /** Chains that ended on a survivor. */
    survivorEnds: number;
    /**
     * Loop research, step 2 (from 11.10.2026; absent in older records — read them through `withSummaryDefaults`).
     * Closing gestures: closings and refusals (a repeated identical refusal with the same drawn chain counts once).
     */
    closeAttempts: number;
    /** Closed chains released (seals); of them with nobody inside; how many were inside, one number per seal in order. */
    seals: number;
    sealsEmpty: number;
    sealInside: number[];
    /** Closed chains opened again by the pointer on the last link. */
    unseals: number;
    /**
     * Closed chains the rules opened (sim `syncLoop`: a link died, the closing edge stopped holding as a link — the hero walked
     * away, a wall, a crossing — or the loop was turned off): `loop` events `open` with a `refusal`, by the reason.
     */
    loopBreaks: Record<string, number>;
    /** Links a step back took off and the chain took again within 0.3 real seconds (an accidental step back). */
    backstepReadds: number;
    /** Package «Урон имеет значение» (from 11.10.2026): released chains with a tough enemy (HP ≥ 2 at the release) not as the first enemy link. */
    toughNotFirst: number;
    /**
     * П1 (from 11.10.2026; absent in older records — `withSummaryDefaults`): real seconds from the first link to the release,
     * one number per released chain in order (0.01 s); cancelled chains are not counted.
     */
    drawTime: number[];
    /**
     * Loop research, step 3 «Прямая» (from 12.10.2026, sandbox only; absent in older records — `withSummaryDefaults`): pierces
     * fixed at the release (`pierce` events `release`); bodies the run struck, one number per pierce that ran to its end, in
     * order (0 — an empty pierce). Pierce kills land in `kills.tools.pierce`.
     */
    pierces: number;
    pierceHits: number[];
    /**
     * «Смена цвета» (from 12.10.2026; absent in older records — `withSummaryDefaults`): shifts by length the dashes reached
     * (`colorShift` events: the link that freed the chain's colour). 0 while the rule is off.
     */
    colorShifts: number;
    /**
     * Task 34 (from 15.10.2026, `Params.shiftAtPointer`; absent in older records — `withSummaryDefaults`): bodies of another colour
     * a sweep point or the held still pointer passed by on a free chain (`shiftSkip` events; one per body and chain length within
     * a drawn chain) — the accidental colour changes the rule took off. 0 while the rule is off.
     */
    shiftSkips: number;
    /**
     * Task 38 «Гарнизон» (from 16.10.2026, `Params.tethers`; absent in older records — `withSummaryDefaults`): tethers the dashes cut
     * (`tether` events `cut`) and enemies the loosed hounds' frenzy killed (`kill` of the source `hound`; not the player's). 0 while
     * the law is off.
     */
    cuts: number;
    frenzyKills: number;
  };
  /** Package «Урон имеет значение» (from 11.10.2026): the elites of the fight (`elite` set; armoured or not). */
  elites: EliteSummary;
  /** Casino stage 1 (from 11.10.2026; absent in older records — `withSummaryDefaults`): «Однорукий гоблин» of the fight. */
  slot: SlotSummary;
  kills: {
    chain: number;
    /** Kills by the player's tools: hammer, wave, bomb, a sapper's blast set off by the chain … */
    tools: Record<string, number>;
    /** Kills by enemy abilities (not credited to the player). */
    enemies: number;
    /**
     * Task 28 «Тюремщик в походе» (from 15.10.2026; absent in older records — `withSummaryDefaults` reads 0): the crowd that died with
     * the boss (`kill` of the source `boss-clear`, `Params.bossClears`) — neither the chain's, the tools' nor the enemies' abilities'.
     */
    bossClear: number;
  };
  /** Fires of each talisman, hammer, relic, oath (`talismanFired`, `hammer`); `active` — constant modifiers without fires. */
  build: {
    fired: Record<string, number>; active: string[];
    /**
     * Task 46 (from 16.10.2026; absent in older records — `withSummaryDefaults` gives `{}`): the bodies the fusions of the dash's end
     * acted on, by fusion id — painted («Клеймо»), struck by a detonation («Подрыв»), frozen («Ледяная волна»).
     */
    fusionBodies?: Record<string, number>;
  };
  /** Game seconds to the goals, after the goals, to the door (null — not reached); enemies on the arena and in view. */
  tempo: { toGoals: number | null; afterGoals: number | null; toDoor: number | null; enemies: AvgMax; inView?: AvgMax };
  /** Path in arena units; seconds standing, in water, in thorns. */
  movement: { path: number; idle: number; water: number; thorns: number };
  /**
   * `capLeft` — task 41 «Три зелья» (from 16.10.2026; absent in older records — `withSummaryDefaults` reads 0): healing loot the hero
   * touched with a full hand (`lootRefused`, `Params.potionCap`) still on the floor at the end of the fight.
   */
  abilities: { jumps: number; spins: number; items: Record<string, number>; capLeft: number };
  /** Casino «Котёл» (from 11.10.2026; absent in older records — read them through `withSummaryDefaults`). */
  purse: PurseSummary;
  /** Casino «Ставка клятвы» (from 11.10.2026; absent in older records — `withSummaryDefaults`): the oath of the fight. */
  oath: OathSummary;
  /**
   * П9 «Второе дыхание» (from 12.10.2026; sandbox only — the run keeps the rule off; absent in older records —
   * `withSummaryDefaults` reads null): the lethal hit the hero stood up from; null — no second wind in the fight.
   */
  secondWind: SecondWindSummary | null;
  /** К7 «Проклятый сундук» (from 12.10.2026; absent in older records — `withSummaryDefaults`): the chest and the curse of the fight. */
  chest: ChestSummary;
  /** Task 14 «Котомка у двери» (from 13.10.2026; absent in older records — `withSummaryDefaults`): the bag of the fight. */
  bag: BagSummary;
  /** Task 16 «Подвиги» (from 14.10.2026; absent in older records — null): the feat of the fight; null — none. */
  feat: FeatSummary | null;
  /**
   * Task 25 «От чего умирают» (from 15.10.2026; absent in older records — `withSummaryDefaults` reads null, the report shows «—»;
   * a replay of the journal counts it again): the hero's death in this fight; null — he did not die.
   */
  death: FightDeath | null;
  /**
   * Task 28 «Тюремщик в походе» (from 15.10.2026; absent in older records — `withSummaryDefaults` reads null): the boss of the fight
   * (a fight with the boss frame on and a Jailer on the arena at the start); null — no boss. The damage of its moves is in
   * `damage.bySource` (`flail`, `throw`), a death by one in `death`.
   */
  boss: BossSummary | null;
  /**
   * Task 40 «Гарнизон, шаг 1б» (from 16.10.2026; absent in older records — `withSummaryDefaults` reads 0 and null): the keymaster's
   * shackles of the fight — put on (`tether` events `shackle`), cut by the dashes (`tether` `cut` of a shackle), the game second of the
   * first cut (null — none); the frenzied hounds' touches on the hero — hits and HP (their `hit` events of the source `hound` while
   * the striker is in its frenzy after the tick; inside `damage.bySource.hound`, which keeps the touch of every hound).
   */
  garrison: GarrisonSummary;
  /**
   * Task 57а «Лес: стрелки» (from 17.10.2026; absent in older records — `withSummaryDefaults` reads 0 and empty maps): the new forest
   * shooters' numbers of the fight (`ForestSummary`).
   */
  forest: ForestSummary;
  /**
   * Task 16 telemetry (from 14.10.2026): the viewer's first meetings during the fight (`RtRecorder.firstMeet`), counted by the view —
   * a replay cannot see them (not compared by `summaryDiff`). Absent — not counted (the sandbox, older records).
   */
  novelty?: number;
  /**
   * Task 56 «Приметы» (from 17.10.2026; absent — no omen rule acted, older records too): the omens' counters from the world — `storm:strike`,
   * `storm:kill`, `storm:hero` (hits), `drowse:woke` (the game second), `rollcall:touch`, `harvest:resetAll`; the released links taken in
   * water (`flood:wet`) and of the colour on the roll call (`rollcall:link`).
   */
  omenFired?: Record<string, number>;
}

/**
 * Task 57а (observe.ts): the forest shooters of a fight — windups begun by the shooter's kind (`shooter` `aim`: `slinger`, `hive`); shots
 * that hit the hero and those a shield took, by the shot's kind (`stone`, `wasp`; `shot` `hit` / `block`); shots put out by the dash and
 * by a bomb (`shot` `snuff`, `snuffShots`); wisps («Светляк») — seen on the arena, killed by the chain, gone out on the hero (`touch` —
 * hurt, `blocked` — a shield took it), gone out by their flight's end (`faded`).
 * Task 57б «Лес: механики» (from 22.10.2026; absent in older records — 0 and empty maps): rootlings laid as stumps, stumps risen, groups
 * crumbled, stumps burnt (`stump` `lie` / `rise` / `crumble` / `burn`); slimes merged (`slime` `merge`); firebrands put out by the
 * cause (`firebrand` `out`: `hit`, `cold`, `water`) and lit again (`lit`: `brazier`, `fire`).
 * Task 57б-2 «Сороконожка» (from 22.10.2026; absent in older records — 0): its lunges begun (`centipede` `lunge` `start`), divisions
 * (`split`), new heads (`split` and `head` — a piece whose head died), divisions past the bodies' cap closed up (`join`), parts stuck — farther than 1.2 behind for 2 s (`stuck`; the measure of the rope).
 */
export interface ForestSummary {
  volleys: Record<string, number>;
  shots: { hit: Record<string, number>; block: Record<string, number>; snuffDash: number; snuffBomb: number };
  wisps: { appeared: number; chainKills: number; touched: number; blocked: number; faded: number };
  rootlings: { lie: number; rise: number; crumble: number; burn: number };
  merges: number;
  brands: { out: Record<string, number>; lit: Record<string, number> };
  centipedes: { lunges: number; splits: number; heads: number; joins: number; stuck: number };
}

/** Task 40: the garrison's numbers of a fight (`FightSummary.garrison`). */
export interface GarrisonSummary {
  shackles: number; shackleCuts: number; firstShackleCut: number | null; frenzyHits: number; frenzyDamage: number;
  /** Task 41 (from 16.10.2026; older records — 0): prisoners' riots (`frenzy` `start` with `riot`) and their kills (source `riot`, also in `chain.frenzyKills`). */
  riots: number; riotKills: number;
  /** Task 41: HP the hero lost to the touches of rioting prisoners (the striker in its riot after the tick; older records — 0). */
  riotDamage: number;
  /**
   * Task 43 «Рыцарь» (from 16.10.2026; older records — 0): knights seen on the arena, their armour shed (`knightShed`), knights killed
   * (any source: `kill` of a knight), chains on a knight (a dash that struck a knight counts once per knight).
   */
  knights: number; knightSheds: number; knightKills: number; knightChains: number;
  /** Task 59б (from 21.10.2026; absent — no kind of step 3 in the fight, older records too): `GarrisonStep3Summary`. */
  step3?: GarrisonStep3Summary;
}

/**
 * Task 59б «Гарнизон, шаг 3» (observe.ts; spec 12): the pitcher — pots thrown (`pot` `throw`), the hero hit by them (`hit` of `pot`), game
 * seconds the hero's centre stood in pitch, pools lit by the dash's path and by a burning enemy (`pot` `ignite`), kills of the burning pitch
 * (`pitch-fire`); the recruits — formations seen, presses on a recruit out of order (`recruit` `order`, once per body and drawn chain
 * length), hits out of order put out (`recruit` `refused`), formations by one pass (`drill`), links dropped out of order (`unlink`), the
 * step-backs (`backsteps`, `recruitBacksteps`); the
 * wardens — pairs seen (both of a pair drawn), pairs gone without an anger, angers (`warden` `anger` `start`), the HP the angry ones took
 * (their touch in the anger and «Размах», `warden-swing`).
 */
export interface GarrisonStep3Summary {
  pots: number; potHits: number; pitchSeconds: number; ignites: { path: number; burning: number }; pitchKills: number;
  formations: number; orderRefusals: number; orderBlocks: number; drills: number; unlinks: number;
  /**
   * Design 21.10.2026: the chain's step-backs in a fight with recruits (`chain.backsteps` of that fight) and those whose last link taken
   * off was a recruit (a sweep across a formation whose numbers are not in line order meets the link before the last).
   */
  backsteps: number; recruitBacksteps: number;
  pairs: number; pairsCleared: number; angers: number; angerDamage: number;
  /**
   * Design 22.10.2026 (§12): how each anger ended — the angry warden gone from the arena while angry (`angerKilled`), its clock over
   * (`warden` `anger` `end`: `angerCalm`), the fight over while it was angry (`angerAtEnd`); the three add up to `angers`. From
   * 22.10.2026; absent — an older record (the report shows «—»).
   */
  angerKilled?: number; angerCalm?: number; angerAtEnd?: number;
}

/** The keys of `GarrisonStep3Summary` (`checkRecord`: a record's step 3 has no other key). */
export const GARRISON_STEP3_KEYS: readonly string[] = ['pots', 'potHits', 'pitchSeconds', 'ignites', 'pitchKills', 'formations', 'orderRefusals', 'orderBlocks', 'drills', 'unlinks',
  'backsteps', 'recruitBacksteps', 'pairs', 'pairsCleared', 'angers', 'angerDamage', 'angerKilled', 'angerCalm', 'angerAtEnd'];

/** A record's `summary.garrison.step3` (absent — fine): known keys only; the anger's ends all three or none, whole, adding up to `angers`. */
export function step3SummaryOk(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  if (Object.keys(t).some(k => !GARRISON_STEP3_KEYS.includes(k))) return false;
  const ends = [t.angerKilled, t.angerCalm, t.angerAtEnd];
  if (ends.every(v => v === undefined)) return true;
  return ends.every(v => Number.isInteger(v) && (v as number) >= 0) && ends.reduce((a: number, v) => a + (v as number), 0) === t.angers;
}

/**
 * Task 16 «Подвиги» of one fight (sim/feat.ts `featResult`, read from the world at the end): its kind and N, done, the game second
 * it was done (null — not done), the progress at the end (`value`: points or seconds) and what was missing (`n − value`, 0 when
 * done), how the fight ended for it (`victory` — through the door, else the fight's end).
 */
export interface FeatSummary { kind: string; n: number; done: boolean; at: number | null; value: number; missing: number; won: boolean }

/**
 * Task 28 «Тюремщик в походе» (observe.ts): the boss of a fight — `diedAt` the game second its core died (null — alive at the end),
 * `severedAt` the game second its weight was severed (null — not severed), `moves` the moves it began by id (`bossMove` `start`:
 * `flail`, `throw`, `whistle`).
 */
export interface BossSummary {
  diedAt: number | null; severedAt: number | null; moves: Record<string, number>;
  /** Task 43 (from 16.10.2026): the full Castellan's fight only (`castellan` — absent for the Jailer and older records). */
  castellan?: CastellanBossSummary;
  /** Task 48 (from 16.10.2026): the Troll's fight only (`troll` — absent for the other bosses and older records). */
  troll?: TrollBossSummary;
  /** Task 55, stage Д (from 21.10.2026): the warlock's fight only (`warlock` — absent for the other bosses and older records). */
  warlock?: WarlockBossSummary;
}
/**
 * Task 55, stage Д «Колдун v0» (observe.ts; spec task-55 §10): the game second his charm fell (null — it stood to the end) and what broke
 * his wardrobe (`thing` `break` `by`: `core` — shoved into him, `wall`, `thing`, `body`, `end`; null — whole); the hits that landed on
 * him by source (`shove` — a thing's strike, `chain`, `pierce`, …) and the barrels stopped at him; his windows after «Перенос» (opened,
 * with a hit); the arrivals of «Перенос»; the hits that did not land by source (the charm's «звон» and the closed window); the drop-outs
 * of the drawn chain; the phase reached.
 */
export interface WarlockBossSummary {
  charmBrokenAt: number | null; wardrobeBy: string | null;
  hits: Record<string, number>; barrels: number;
  windows: { opened: number; hit: number }; shifts: number;
  blocks: Record<string, number>; unlinks: number; phase: number;
}
/**
 * Task 48 «Тролль» (observe.ts): his windows by what opened them (`club`, `tail`, `snore`: opened, with the window's hit), the hits on
 * his core that did not land (`trollWindow` `block`) by their source, «Храп» slept through (a plate regrown) and woken, the wolves of
 * «Рык» (every wolf of his fight), his parts in the order severed with the game second (`kind`: `troll-club`, `troll-rock`,
 * `troll-tail`), the phase reached, the core's drop-outs of the drawn chain (`unlinks`); the hero's damage by group (`damage`).
 */
export interface TrollBossSummary {
  windows: Record<string, { opened: number; hit: number }>;
  blocks: Record<string, number>;
  snores: { slept: number; woken: number };
  wolves: number;
  parts: { kind: string; at: number }[];
  phase: number;
  unlinks: number;
  /**
   * The hero's damage in the fight by group (design 17.10.2026, spec 24.17): `crowd` — the touches of his crowd, the wolves of «Рык» and
   * the rest (the fire's trail …), `core` — the core's touch, `parts` — the touches of his parts, `moves` — «Удар дубиной», «Бросок
   * камня», «Хвост метёт». Their sum is `damage.total`. Absent in records before 17.10.2026.
   */
  damage?: TrollDamage;
  /**
   * Task 48, section 25 (design 22.10.2026): the charges of the walking Troll that stuck, by what they stuck in (`wall`, `tree`,
   * `edge`, `cliff`; event `trollStuck`). Absent while none stuck (every fight before it, every fight of the sitting Troll).
   */
  stuck?: Record<string, number>;
}
export interface TrollDamage { crowd: number; core: number; parts: number; moves: number }
/**
 * Task 43 «Кастелян полный» (observe.ts): the grate — raised by a lever (`raises`), seconds it stood open (any cause), the lever's
 * windows with a hit on the core (a chain hit or a kill of it) and without; his parts in the order they were lost with the game
 * second (`kind`: `hound`, `castellan-crossbow`); «Болт» — shots, hits on the hero, enemies struck; the phase reached; the chain drop-outs (`unlinks` — times, `unlinked` — links in all; from 16.10.2026, absent in older records).
 */
export interface CastellanBossSummary {
  raises: number; openSeconds: number; windowsHit: number; windowsMissed: number;
  /** The grate fell while the core was in the drawn chain (event `grate` `unlink`): times, and the links dropped in all (absent — 0). */
  unlinks?: number; unlinked?: number;
  parts: { kind: string; at: number }[];
  bolts: { shots: number; hero: number; enemies: number };
  phase: number;
}

/** Task 25: a protection of the hero — the after-chain shield (`chainShield`), «Щит фокуса» (`focusGuarded`), invulnerability. */
export type DeathGuard = 'chain' | 'focus' | 'invuln';

/** Task 25: hits of one source in the series before the death (the lethal hit included). */
export interface DeathSeriesSource {
  /** Named as `damage.bySource` (a wolf's rush — `wolf-rush`). */
  source: string;
  hits: number;
  damage: number;
  /** Game seconds from the first hit of this source in the window to the lethal hit (0.01). */
  span: number;
}

/**
 * Task 25 «От чего умирают» (observe.ts; docs/realtime-telemetry.md, section 8): the hero's death in a fight — the lethal hit
 * (the last `hit` before `defeat`), the series of hits before it, his protections and the landing after the last move.
 */
export interface FightDeath {
  /** The tick of the lethal hit (`world.tick` after it). */
  tick: number;
  /** The lethal hit: its source (named as `damage.bySource`), HP it took; the striker as `RtDeath` (run/rtRunEnd.ts `rtDeathOf`). */
  source: string;
  damage: number;
  enemy?: string;
  elite?: true;
  armor?: true;
  affixes?: string[];
  /** Hits in the last `DEATH_SERIES_WINDOW` game seconds up to the lethal one, by source: the most HP first (the main source). */
  series: DeathSeriesSource[];
  /** Protections up when the lethal hit came (only a piercing hit gets through them: the quills, the goblin's blast). */
  guardAtHit: DeathGuard[];
  /** Game seconds each protection was up in the series window (at the end of each tick; the lethal tick as `guardAtHit`, 0.01). */
  guardInWindow: Record<DeathGuard, number>;
  /**
   * Ticks from the end of the last dash or jump (`world.move` became null) to the lethal hit; null — none ended before it, or
   * the hero was in a move at the hit (`moving`).
   */
  landing: number | null;
  /** The hero was in a move at the lethal hit (the quills strike in the dash): its kind. */
  moving?: 'dash' | 'jump' | 'return';
}

/**
 * Task 14 «Котомка у двери» of one fight (docs/realtime-telemetry.md, section 8, «Котомка у двери»; sim/bag.ts). Read from the
 * `bag` events, the credited `kill` events after its `appear` and `world.bag` at the end.
 */
export interface BagSummary {
  /** The bag appeared (the goals with `doorBag` on, not the Jailer's or the final fight). */
  appeared: boolean;
  /** Steps filled by the end of the fight (0–3). */
  steps: number;
  /** The player's credited kills after the bag appeared (all of them: a reset does not take them off). */
  killsAfterGoals: number;
  /** Hits that sent the unfilled step back to its start (`bag` `reset`). */
  resets: number;
  /** Resources the door paid for the bag (`world.bag.paid`); null — no payout (no door, no step filled, a defeat). */
  payout: number | null;
  /** The paid resources by kind (empty without a payout). */
  kinds: Record<string, number>;
}

/**
 * К7 «Проклятый сундук» of one fight (docs/realtime-telemetry.md, section 8, «Проклятый сундук»; sim/chest.ts). Read from the
 * `chest` and `curseLifted` events and the `hit` events between them (the events stand in the order they happened).
 */
export interface ChestSummary {
  /** The tick the chest was taken (`world.curse.tick`); null — not taken (or the rule is off, or the arena has no chest). */
  taken: number | null;
  /** The tick the curse was lifted (the 12th kill of the dash, `world.curse.lifted`); null — not lifted (or not taken). */
  liftedAt: number | null;
  /** Damage to the hero while the curse was on (from taking the chest to its lifting or the end of the fight), by `damage.bySource` names. */
  cursedDamage: Record<string, number>;
}

/** П9 «Второе дыхание» of one fight (docs/realtime-telemetry.md, section 8, «Второе дыхание»; sim/world.ts `secondWind`). */
export interface SecondWindSummary {
  /** The tick of the lethal hit (`world.secondWind.tick`: ticks run before it, as `lowHp`'s tick minus one). */
  tick: number;
  /** The hero's HP before the lethal hit. */
  hpBefore: number;
  /** The source of the lethal hit as `damage.bySource` names it (`hit.source`; a rushing wolf's `wolf` — `wolf-rush`). */
  source: string;
  /** The striker's enemy kind, if it stood on the arena at the hit (absent for a hit without an enemy: thorns, a dead sapper's blast). */
  enemy?: string;
  elite?: boolean;
}

/**
 * Casino stage 1, item 2: «Ставка клятвы» of one fight (docs/realtime-telemetry.md, section 8, «Ставка клятвы»; sim/oath.ts).
 * All null — the fight had no oath (or the rule was off).
 */
export interface OathSummary {
  /** The oath of the fight (`world.oath.id`). */
  id: string | null;
  /** The door settled it: kept (true) or broken (false); null — no exit through the door (a defeat, a restart). */
  kept: boolean | null;
  /** The tick the oath broke (an «at least once» oath not met — the door's tick); null — not broken. */
  brokenTick: number | null;
  /** The tick an «at least once» oath was met; null — not met (or a «never» oath). */
  metTick: number | null;
  /** The cauldron's multiplier the door recorded (2 or 0.5); null — no door. */
  mult: number | null;
}

/** Casino «Котёл» of one fight (docs/realtime-telemetry.md, section 8, «Котёл»; sim/purse.ts). */
export interface PurseSummary {
  /** The cauldron was on (`params.purse`) at the end of the fight. */
  on: boolean;
  /** The cauldron at the end of the fight (after the last cheque). */
  cauldron: number;
  /** Cheques put in (`cheque` events), one number per cheque in order: embers, heat, total. */
  embers: number[];
  heat: number[];
  totals: number[];
  /** Crystals the chains took (crystal links of the cheques). */
  crystals: number;
  /** Embers of the build's kills outside the chain (`purseKill`), by source. */
  killEmbers: Record<string, number>;
  /** Resources the door paid without the die (`purseDoor`); null — no exit through the door with the cauldron on. */
  resources: number | null;
  /**
   * П4 «Раздув за дела» (from 11.10.2026; absent in older records — `withSummaryDefaults` reads null): the greed step at the
   * door (`purseDoor.step`: 0–3 — ×1, ×1,5, ×2, ×3); null — no exit through the door with the rule on.
   */
  exitStep: number | null;
  /**
   * П3 «Финальная цепь» (from 12.10.2026; absent in older records — `withSummaryDefaults` reads null): how the hero went
   * through the door (`purseDoor.by`) — the chain ending on it, a jump, walking in; null — no exit with the cauldron on.
   */
  exitBy: 'chain' | 'jump' | 'walk' | null;
}

/** The elites of one fight (docs/realtime-telemetry.md, section 8, «Элиты»). */
export interface EliteSummary {
  /** Elites seen on the arena (from the start, or from the moment a newcomer became one). */
  count: number;
  /** Game seconds from the appearance to the death, one number per elite that died, in the order of deaths. */
  lifetime: number[];
  /** Chains (dashes) that hit the elite, plate hits included; one number per elite that died, the order of `lifetime`. */
  chainsPer: number[];
  /** Elites still on the arena at the end of the fight (not in `lifetime`). */
  aliveAtEnd: number;
  /** Elites that died before the goals were done. */
  beforeGoals: number;
  /** Armoured elites the player killed (`eliteDown` credited). */
  downs: number;
  /** Of them in the first `eliteCleanWindow` of the window — the clean break (+1 energy, loot ×2). */
  cleanKills: number;
  /** Of them later in the window (`inWindow` without `clean`): the plain loot. */
  lateWindowKills: number;
  /** Windows opened (0 plates) and windows that closed with the elite alive (a plate grew back). */
  windows: number;
  windowsClosed: number;
  /** Plates taken off, by the source of the strip (`chain`, `bomb`, `spin`, `fire`, `blast`, `seal`, hammers …). */
  platesBySource: Record<string, number>;
  /** Elite loot that dropped, and loot the hero picked up. */
  loot: { dropped: number; picked: number };
}

/**
 * Casino stage 1: «Однорукий гоблин» (sim/slot.ts) in one fight — read from the `slot` events, the `hit` events of the arrows
 * (`slot-volley`, `slot-rain`) and the `kill` events of the source `slot`.
 */
export interface SlotSummary {
  /** Goblins that appeared (the battle's roll or the sandbox button). */
  appeared: number;
  /** Game seconds from the goals to the first appearance (null — none, or before the goals: the sandbox button). */
  appearAfterGoals: number | null;
  /** Pulls of the lever; enemy links the dash struck before the lever, one number per pull. */
  pulls: number;
  links: number[];
  /** Outcomes of the pulls by kind (`rain`, `volley`, `heart3` … `none`; sim/slot.ts `SlotOutcome`). */
  outcomes: Record<string, number>;
  /** Effects that came (the 3rd reel stopped); spins cut by the end of the fight (the door, a defeat). */
  effects: number;
  cancelled: number;
  /** HP the hero lost to the volley and to the rain. */
  damage: { volley: number; rain: number };
  /** Enemies the arrows killed (the player's; also in `kills.tools.slot`). */
  kills: number;
  /**
   * «Перебор» (`slotBust`, design 12.10.2026): risky pulls (after the safe ones), busts that came (the effect `bust`; a bust
   * cut by the door does not count), HP the busts took (source `slot-bust`), 1 — the fight was lost to the bust's blow.
   */
  risky: number;
  busts: number;
  bustDamage: number;
  bustDeaths: number;
  /**
   * «Длинная цепь кормит гоблина» (`slotSafePerLongChain`, from 12.10.2026; absent in older records — `withSummaryDefaults`):
   * safe pulls the long chains of the fight added (the `slot` events `feed`, their `safe`).
   */
  safeFromChains: number;
  /**
   * «Гоблин раньше» (`slotAppearAt`, from 13.10.2026; absent in older records — null): game seconds of the fight at the first
   * appearance (before the goals too, unlike `appearAfterGoals`).
   */
  appearTime: number | null;
  /**
   * «Взрыв по площади» (`slotBustArea`, from 13.10.2026; absent in older records — 0): bust blasts that went off (the `slot`
   * event `blast`), of them with the hero's body inside the circle, of those spared (invulnerability, the dash, the jump), and
   * enemies the blasts killed (source `slot-bust`; the player's — also in `kills.tools['slot-bust']`). The hero's damage from
   * the blast is `bustDamage`.
   */
  bustBlasts: number;
  bustInside: number;
  bustSpared: number;
  bustKills: number;
  /**
   * «Гоблин-сюрприз» (`slotSafeRandom`, from 13.10.2026; absent in older records — empty): the safe pulls each goblin of the
   * fight rolled when it appeared (sim/slot.ts `Goblin.safe`, 0 … `slotSafePulls`), in the order they appeared. Empty
   * without the rule. The goblin's pulls and busts are `pulls`, `risky`, `busts` (a run fight has one goblin).
   */
  safe: number[];
  /** «Безопасный рывок — тройка» (`slotSafeTriple`, from 13.10.2026; absent in older records — 0): safe pulls that were a sure triple (`pull` with `triple`). */
  triples: number;
  /**
   * Task 20 «Выход из круга» (from 14.10.2026; absent in older records — empty): one entry per lit bust of «Взрыв по площади»
   * (the `slot` event `lit`), in order — how the hero left the idol's circle before its blast.
   */
  bustExits: SlotBustExit[];
}

/**
 * How the hero left the lit idol's circle (task 20). `walk` — he left it walking or standing (no `world.move`; a knockback too),
 * `dash` — on a chain's dash (or the hammer's return run), `jump` — in a jump; `stayed-safe` — in the circle at the blast but
 * spared (invulnerability, the dash, the jump), `stayed-hurt` — in it and hurt; `outside` — out of it already when it lit.
 */
export type SlotBustExitBy = 'walk' | 'dash' | 'jump' | 'stayed-safe' | 'stayed-hurt' | 'outside';

/**
 * One lit bust (task 20). In the circle means as world.ts `bustHero` counts it: the hero's centre within the radius plus his
 * body (`heroRadius`).
 */
export interface SlotBustExit {
  /** The hero's centre to the idol's centre when it lit (arena units, 0.01). */
  dist: number;
  /** His body touched the circle when it lit. */
  inside: boolean;
  /**
   * Game seconds from the light to the tick his body left the circle for good (0.01); null — out of it at the light, in it at
   * the blast, or the fight ended in the fuse with him in it.
   */
  outAfter: number | null;
  /** How he left (see `SlotBustExitBy`); null — the fight ended in the fuse with him in the circle. */
  by: SlotBustExitBy | null;
  /** HP the blast took from him (0 — none); null — the blast never went off (the fight ended in the fuse). */
  damage: number | null;
}

/** A summary of nothing (a fight without an observer, the start of a fight). */
export function emptyFightSummary(): FightSummary {
  return {
    damage: { total: 0, bySource: {}, hits: {}, lowHp: [], raisedTouches: { hits: 0, damage: 0 } },
    threats: {},
    chain: {
      count: 0, lengthMedian: 0, lengthMax: 0, cancels: 0, backsteps: 0, crystals: 0, colorChanges: 0, focusSpent: 0, focusEmpty: 0, survivorEnds: 0,
      closeAttempts: 0, seals: 0, sealsEmpty: 0, sealInside: [], unseals: 0, loopBreaks: {}, backstepReadds: 0, toughNotFirst: 0, drawTime: [],
      pierces: 0, pierceHits: [], colorShifts: 0, shiftSkips: 0, cuts: 0, frenzyKills: 0,
    },
    elites: {
      count: 0, lifetime: [], chainsPer: [], aliveAtEnd: 0, beforeGoals: 0, downs: 0, cleanKills: 0, lateWindowKills: 0, windows: 0, windowsClosed: 0,
      platesBySource: {}, loot: { dropped: 0, picked: 0 },
    },
    slot: { appeared: 0, appearAfterGoals: null, pulls: 0, links: [], outcomes: {}, effects: 0, cancelled: 0, damage: { volley: 0, rain: 0 }, kills: 0, risky: 0, busts: 0, bustDamage: 0, bustDeaths: 0, safeFromChains: 0, appearTime: null, bustBlasts: 0, bustInside: 0, bustSpared: 0, bustKills: 0, safe: [], triples: 0, bustExits: [] },
    kills: { chain: 0, tools: {}, enemies: 0, bossClear: 0 },
    build: { fired: {}, active: [], fusionBodies: {} },
    tempo: { toGoals: null, afterGoals: null, toDoor: null, enemies: { avg: 0, max: 0 } },
    movement: { path: 0, idle: 0, water: 0, thorns: 0 },
    abilities: { jumps: 0, spins: 0, items: {}, capLeft: 0 },
    purse: { on: false, cauldron: 0, embers: [], heat: [], totals: [], crystals: 0, killEmbers: {}, resources: null, exitStep: null, exitBy: null },
    oath: { id: null, kept: null, brokenTick: null, metTick: null, mult: null },
    secondWind: null,
    chest: { taken: null, liftedAt: null, cursedDamage: {} },
    bag: { appeared: false, steps: 0, killsAfterGoals: 0, resets: 0, payout: null, kinds: {} },
    feat: null,
    death: null,
    boss: null,
    garrison: { shackles: 0, shackleCuts: 0, firstShackleCut: null, frenzyHits: 0, frenzyDamage: 0, riots: 0, riotKills: 0, riotDamage: 0, knights: 0, knightSheds: 0, knightKills: 0, knightChains: 0 },
    forest: {
      volleys: {}, shots: { hit: {}, block: {}, snuffDash: 0, snuffBomb: 0 }, wisps: { appeared: 0, chainKills: 0, touched: 0, blocked: 0, faded: 0 },
      rootlings: { lie: 0, rise: 0, crumble: 0, burn: 0 }, merges: 0, brands: { out: {}, lit: {} },
      centipedes: { lunges: 0, splits: 0, heads: 0, joins: 0, stuck: 0 },
    },
  };
}

/**
 * A summary read from a record, with the fields added after it was written filled from `emptyFightSummary` (0, an empty
 * list). The rule of the summary (schema 1): new fields are only added, never renamed or retyped, so a record of an older
 * build reads as «that did not happen» (the loop fields of 11.10.2026 in a record of 10.10.2026). Fields the record has are
 * kept as they are (keys the empty summary does not know too); the input is not changed.
 */
export function withSummaryDefaults(summary: unknown): FightSummary {
  const fill = (base: unknown, value: unknown): unknown => {
    if (value === undefined || value === null) return JSON.parse(JSON.stringify(base)) as unknown;
    const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
    if (!plain(base) || !plain(value)) return value;
    const out: Record<string, unknown> = { ...value };
    for (const [k, v] of Object.entries(base)) out[k] = fill(v, value[k]);
    return out;
  };
  return fill(emptyFightSummary(), JSON.parse(JSON.stringify(summary ?? {})) as unknown) as FightSummary;
}

/**
 * Watches a fight and builds its summary (track ТB, telemetry/observe.ts). Only reads: it never changes the world.
 * `command` — after a command was applied (the world as it left it); `tick` — after each tick, before the view clears
 * `world.events`. The browser and the Node replay call it the same way, so the summary of a replay matches the browser's
 * (except `tempo.inView`, which only the browser measures).
 */
export interface FightObserver {
  command(cmd: Command, world: World): void;
  tick(world: World): void;
  summary(): FightSummary;
}

/** Makes an observer for a fight starting with this world. */
export type FightObserverFactory = (world: World) => FightObserver;

/** An observer that sees nothing (until ТB lands, and where no summary is needed). */
export const nullObserver: FightObserverFactory = () => ({ command() { /* nothing */ }, tick() { /* nothing */ }, summary: emptyFightSummary });

/**
 * The view hook `__realtime.replayTo(journal, tick)` (track ТA implements, ТB uses it for a screenshot at a note): the
 * view replays the journal up to `tick` and shows that world, paused.
 */
export type ReplayTo = (journal: Journal, tick: number) => Promise<void>;

/** Task 56 «Приметы»: the omen fields of a run record — only with `omensOn`; the pool and the ids strings; the routes and the count whole. */
function runOmensOk(r: Record<string, unknown>): boolean {
  const on = r.omensOn === true, strings = (x: unknown): boolean => Array.isArray(x) && x.every(id => typeof id === 'string');
  if (r.omensOn !== undefined && !on) return false;
  if (r.omenPool !== undefined && !(on && strings(r.omenPool))) return false;
  if (r.levelOmens !== undefined && !(on && Array.isArray(r.levelOmens) && r.levelOmens.every(l => { const o = l as Record<string, unknown> | null; return !!o && Number.isInteger(o.level) && typeof o.id === 'string'; }))) return false;
  if (r.omenRoutes !== undefined && !(on && Array.isArray(r.omenRoutes) && r.omenRoutes.every(route => {
    const o = route as Record<string, unknown> | null;
    return !!o && Number.isInteger(o.level) && Number.isInteger(o.row) && typeof o.chosen === 'string' && Array.isArray(o.offered)
      && o.offered.every(n => { const x = n as Record<string, unknown> | null; return !!x && typeof x.nodeId === 'string' && (x.omen === undefined || typeof x.omen === 'string'); });
  }))) return false;
  if (r.crossroadsSteps !== undefined && !(on && Number.isInteger(r.crossroadsSteps) && (r.crossroadsSteps as number) >= 1)) return false;
  if (r.fairRerolls !== undefined && !(on && Number.isInteger(r.fairRerolls) && (r.fairRerolls as number) >= 1)) return false;
  return true;
}
