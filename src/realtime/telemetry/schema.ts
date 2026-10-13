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
 * `S/P/prologue` — one playthrough of the prologue «Опушка» (P — its key `prologueKey`; from 13.10.2026).
 * The Vite plugin (ТC) checks every POSTed id with it: a valid id is a safe relative path.
 */
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/(?:run|prologue|[A-Za-z0-9_-]{1,64}\/(?:fight|j(?:0|[1-9][0-9]{0,5})of[1-9][0-9]{0,5}|n(?:0|[1-9][0-9]{0,9})))$/;
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
  | { kind: 'fight'; session: string; run: string; fight: string }
  | { kind: 'journal'; session: string; run: string; fight: string; index: number; parts: number }
  | { kind: 'note'; session: string; run: string; fight: string; tick: number };

export function parseRecordId(id: unknown): ParsedRecordId | null {
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) return null;
  const [session, run, fight, last] = id.split('/');
  if (fight === 'run' && last === undefined) return { kind: 'run', session, run };
  if (fight === 'prologue' && last === undefined) return { kind: 'prologue', session, run };
  if (last === 'fight') return { kind: 'fight', session, run, fight };
  const part = /^j(\d+)of(\d+)$/.exec(last);
  if (part) {
    const index = Number(part[1]), parts = Number(part[2]);
    return index < parts ? { kind: 'journal', session, run, fight, index, parts } : null;
  }
  return { kind: 'note', session, run, fight, tick: Number(last.slice(1)) };
}

// ---- Records ----

export type RtRecordKind = 'run' | 'fight' | 'journal' | 'note' | 'prologue';

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
}

/** Casino «Ставка клятвы»: the source of the node card's oath choice in `RunRecord.choices` (not the Jailer's `oath`). */
export const OATH_STAKE_SOURCE = 'oath-stake';

/** B6 К7 «Проклятый сундук»: the source of the chest's talisman choice in `RunRecord.choices` (not the «Застава» `talisman`). */
export const CHEST_SOURCE = 'chest';

/** Casino «Кость у двери»: the source of the die screen's choice in `RunRecord.choices` (offered `roll` and `take`). */
export const DIE_SOURCE = 'door-die';

/** Task 16 «Подвиги»: the source of the feat's talisman choice in `RunRecord.choices` (not the «Застава» `talisman` or the chest's). */
export const FEAT_SOURCE = 'feat';

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
export interface RunItems { gained: Record<string, number>; used: Record<string, number>; left: Record<string, number> }

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
  /** Task 16 (from 14.10.2026): the run had feats (`RtRunState.feats`); absent — no (a first run, older records). */
  featsOn?: true;
  /** Task 16: the feats of the run's fights, in order; absent — none (older records too). */
  feats?: RunFeat[];
  /** Task 16 telemetry: the viewer's run number (1, 2, 3…; the profile's count); absent — not known (older records too). */
  viewerRun?: number;
  /** Task 16 telemetry: the viewer's first meetings in this run, in order; absent — none reported (older records too). */
  firsts?: RunFirst[];
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

export type RtRecord = RunRecord | FightRecord | JournalPart | NoteRecord | PrologueRecord;

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
      // Task 15 (14.10.2026): optional — the map heals bought.
      if (r.mapHeals !== undefined && !(Array.isArray(r.mapHeals) && r.mapHeals.every(h => {
        const o = h as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && ['row', 'price', 'hpBefore', 'hpAfter'].every(k => Number.isInteger(o[k])) && (o.price as number) >= 1 && (o.hpAfter as number) > (o.hpBefore as number);
      }))) return 'run mapHeals';
      // Task 16 (14.10.2026): optional — the feats flag and list, the viewer's run number, the first meetings, the choice times.
      if (r.featsOn !== undefined && r.featsOn !== true) return 'run featsOn';
      if (r.feats !== undefined && !(Array.isArray(r.feats) && r.feats.every(f => {
        const o = f as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && typeof o.nodeId === 'string' && typeof o.kind === 'string' && Number.isInteger(o.row) && Number.isInteger(o.n)
          && ['resources', 'talisman'].includes(o.reward as string) && typeof o.done === 'boolean' && typeof o.won === 'boolean'
          && (o.paid === null || ['resources', 'talisman', 'fallback'].includes(o.paid as string)) && (o.fight === null || typeof o.fight === 'string');
      }))) return 'run feats';
      if (r.viewerRun !== undefined && !(Number.isInteger(r.viewerRun) && (r.viewerRun as number) >= 1)) return 'run viewerRun';
      if (r.firsts !== undefined && !(Array.isArray(r.firsts) && r.firsts.every(f => {
        const o = f as Record<string, unknown> | null;
        return !!o && typeof o === 'object' && typeof o.id === 'string' && o.id.length > 0 && (o.fight === null || typeof o.fight === 'string') && Number.isInteger(o.row);
      }))) return 'run firsts';
      if (!(r.choices as unknown[]).every(c => { const t = (c as Record<string, unknown> | null)?.realSeconds; return t === undefined || (typeof t === 'number' && Number.isFinite(t) && t >= 0); })) return 'run choice realSeconds';
      return null;
    case 'fight': {
      if (r.fight !== parsed.fight || typeof r.arena !== 'string' || !num('seed') || !num('ticks') || !num('time') || !num('hpIn') || !num('hpOut') || typeof r.endHash !== 'string' || !r.summary) return 'fight fields';
      if (!['victory', 'defeat', 'restart', 'menu', 'unload'].includes(r.outcome as string)) return `fight outcome ${String(r.outcome)}`;
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
      }
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
  };
  /** Fires of each talisman, hammer, relic, oath (`talismanFired`, `hammer`); `active` — constant modifiers without fires. */
  build: { fired: Record<string, number>; active: string[] };
  /** Game seconds to the goals, after the goals, to the door (null — not reached); enemies on the arena and in view. */
  tempo: { toGoals: number | null; afterGoals: number | null; toDoor: number | null; enemies: AvgMax; inView?: AvgMax };
  /** Path in arena units; seconds standing, in water, in thorns. */
  movement: { path: number; idle: number; water: number; thorns: number };
  abilities: { jumps: number; spins: number; items: Record<string, number> };
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
   * Task 16 telemetry (from 14.10.2026): the viewer's first meetings during the fight (`RtRecorder.firstMeet`), counted by the view —
   * a replay cannot see them (not compared by `summaryDiff`). Absent — not counted (the sandbox, older records).
   */
  novelty?: number;
}

/**
 * Task 16 «Подвиги» of one fight (sim/feat.ts `featResult`, read from the world at the end): its kind and N, done, the game second
 * it was done (null — not done), the progress at the end (`value`: points or seconds) and what was missing (`n − value`, 0 when
 * done), how the fight ended for it (`victory` — through the door, else the fight's end).
 */
export interface FeatSummary { kind: string; n: number; done: boolean; at: number | null; value: number; missing: number; won: boolean }

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
}

/** A summary of nothing (a fight without an observer, the start of a fight). */
export function emptyFightSummary(): FightSummary {
  return {
    damage: { total: 0, bySource: {}, hits: {}, lowHp: [], raisedTouches: { hits: 0, damage: 0 } },
    threats: {},
    chain: {
      count: 0, lengthMedian: 0, lengthMax: 0, cancels: 0, backsteps: 0, crystals: 0, colorChanges: 0, focusSpent: 0, focusEmpty: 0, survivorEnds: 0,
      closeAttempts: 0, seals: 0, sealsEmpty: 0, sealInside: [], unseals: 0, loopBreaks: {}, backstepReadds: 0, toughNotFirst: 0, drawTime: [],
      pierces: 0, pierceHits: [], colorShifts: 0,
    },
    elites: {
      count: 0, lifetime: [], chainsPer: [], aliveAtEnd: 0, beforeGoals: 0, downs: 0, cleanKills: 0, lateWindowKills: 0, windows: 0, windowsClosed: 0,
      platesBySource: {}, loot: { dropped: 0, picked: 0 },
    },
    slot: { appeared: 0, appearAfterGoals: null, pulls: 0, links: [], outcomes: {}, effects: 0, cancelled: 0, damage: { volley: 0, rain: 0 }, kills: 0, risky: 0, busts: 0, bustDamage: 0, bustDeaths: 0, safeFromChains: 0, appearTime: null, bustBlasts: 0, bustInside: 0, bustSpared: 0, bustKills: 0, safe: [], triples: 0 },
    kills: { chain: 0, tools: {}, enemies: 0 },
    build: { fired: {}, active: [] },
    tempo: { toGoals: null, afterGoals: null, toDoor: null, enemies: { avg: 0, max: 0 } },
    movement: { path: 0, idle: 0, water: 0, thorns: 0 },
    abilities: { jumps: 0, spins: 0, items: {} },
    purse: { on: false, cauldron: 0, embers: [], heat: [], totals: [], crystals: 0, killEmbers: {}, resources: null, exitStep: null, exitBy: null },
    oath: { id: null, kept: null, brokenTick: null, metTick: null, mult: null },
    secondWind: null,
    chest: { taken: null, liftedAt: null, cursedDamage: {} },
    bag: { appeared: false, steps: 0, killsAfterGoals: 0, resets: 0, payout: null, kinds: {} },
    feat: null,
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
