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
 * A record id: `S/R/run`, `S/R/<fight>/fight`, `S/R/<fight>/j<i>of<n>`, `S/R/<fight>/n<tick>` (S — session, R — run).
 * The Vite plugin (ТC) checks every POSTed id with it: a valid id is a safe relative path.
 */
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\/(?:run|[A-Za-z0-9_-]{1,64}\/(?:fight|j(?:0|[1-9][0-9]{0,5})of[1-9][0-9]{0,5}|n(?:0|[1-9][0-9]{0,9})))$/;
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
  | { kind: 'fight'; session: string; run: string; fight: string }
  | { kind: 'journal'; session: string; run: string; fight: string; index: number; parts: number }
  | { kind: 'note'; session: string; run: string; fight: string; tick: number };

export function parseRecordId(id: unknown): ParsedRecordId | null {
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) return null;
  const [session, run, fight, last] = id.split('/');
  if (fight === 'run' && last === undefined) return { kind: 'run', session, run };
  if (last === 'fight') return { kind: 'fight', session, run, fight };
  const part = /^j(\d+)of(\d+)$/.exec(last);
  if (part) {
    const index = Number(part[1]), parts = Number(part[2]);
    return index < parts ? { kind: 'journal', session, run, fight, index, parts } : null;
  }
  return { kind: 'note', session, run, fight, tick: Number(last.slice(1)) };
}

// ---- Records ----

export type RtRecordKind = 'run' | 'fight' | 'journal' | 'note';

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
  /** The run key (`runKey`) or `SANDBOX_RUN`. */
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

/** One choice of the run: what was offered, what was taken, what was refused (a gift, talismans, a hammer, a relic, an oath, the shop, the rest). */
export interface RunChoice {
  /** The node of the choice (`start` — the starting gift). */
  nodeId: string;
  /** What is chosen: `gift`, `talisman`, `hammer`, `relic`, `oath`, `shop`, `rest`, `event` … */
  source: string;
  offered: string[];
  taken: string[];
  refused: string[];
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

export type RtRecord = RunRecord | FightRecord | JournalPart | NoteRecord;

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
  damage: { total: number; bySource: Record<string, number>; hits: Record<string, number>; lowHp: { tick: number; hp: number }[] };
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
  };
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
}

/** A summary of nothing (a fight without an observer, the start of a fight). */
export function emptyFightSummary(): FightSummary {
  return {
    damage: { total: 0, bySource: {}, hits: {}, lowHp: [] },
    threats: {},
    chain: { count: 0, lengthMedian: 0, lengthMax: 0, cancels: 0, backsteps: 0, crystals: 0, colorChanges: 0, focusSpent: 0, focusEmpty: 0, survivorEnds: 0 },
    kills: { chain: 0, tools: {}, enemies: 0 },
    build: { fired: {}, active: [] },
    tempo: { toGoals: null, afterGoals: null, toDoor: null, enemies: { avg: 0, max: 0 } },
    movement: { path: 0, idle: 0, water: 0, thorns: 0 },
    abilities: { jumps: 0, spins: 0, items: {} },
  };
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
