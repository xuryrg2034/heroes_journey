/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, sections 3, 7 and 8): what the browser records.
 *
 * - `FightTap` — feeds the fight observer (`FightObserver`, track ТB, observe.ts) as the Node replay does: `tick` once
 *   after every tick, `command` after every journalled command. The view calls it before anything changes the world
 *   (`beforeTick`, before a command, before it clears `world.events` at the end of a frame), so a tick is seen as it
 *   ended and its events are still there (the observer reads new events with a cursor). It also keeps the last hit on the hero (the cause of death)
 *   and the enemies in view (only the browser knows the camera).
 * - `RtRecorder` — the records: the header (session, run key, build, Params, time, tester), a fight at its end (the
 *   journal packed in the same frame as the hash), a fight left without a result (restart, menu; `unload` — a stash in
 *   `localStorage`, packed on the next load), the run with its nodes and choices, the N notes, the buffer and the sinks.
 *
 * Only reads the world: the fight hash is the same with and without the recorder. Every entry point swallows its own
 * errors — telemetry never breaks the game.
 */
import { hashText } from '../sim/hash';
import type { Command } from '../sim/commands';
import type { Params } from '../sim/params';
import type { Journal, Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { rtTalisman } from '../run/rtTalismans';
import { runRow } from '../run/arenaPools';
import { rtEventView, rtGiftView, rtNode, rtRestView, rtShopView, type RtRunState, type RtRunStep } from '../run/rtRun';
import type { GiftOption } from '../../game/run/runGift';
import { TelemetryBuffer, telemetryKeys, TLM_PREFIX, TLM_RUN_META_KEY, TLM_SESSION_KEY, TLM_TESTER_KEY, type BufferOptions, type BufferStats, type KeyValueStore } from './buffer';
import { EventCursor } from './observe';
import { artifactSource, DeliveryQueue, type SinkSource } from './sinks';
import {
  encodeJournal, fightKey, fightRecordId, gzipBase64, isIdSegment, journalPartId, makeExport, noteRecordId, nullObserver, packJournal, paramsHash, runKey, runRecordId, SANDBOX_RUN,
  sessionKey, splitParts, RT_TELEMETRY_SCHEMA,
  type FightObserver, type FightObserverFactory, type FightOutcome, type FightRecord, type FightSummary, type JournalMeta, type JournalPart, type NoteRecord, type RtHeader, type RtRecord,
  type RtRecordKind, type RtTelemetryWindow, type RunChoice, type RunDeath, type RunNodeVisit, type RunOutcome, type RunRecord,
} from './schema';

export { TLM_RUN_META_KEY, TLM_SESSION_KEY, TLM_TESTER_KEY } from './buffer';
/**
 * A fight cut by `pagehide`: its compact journal and record, packed into the buffer on the next load. One key per fight
 * (`unload:<session>/<run>/<fight>`): a page restored from the back-forward cache removes only its own stash. The bare
 * key is the stash of pages before review 10.10.2026 (still packed).
 */
export const TLM_UNLOAD_KEY = `${TLM_PREFIX}unload`;
export const unloadKey = (session: string, run: string, fight: string): string => `${TLM_UNLOAD_KEY}:${session}/${run}/${fight}`;
/** The channel the tabs of one browser ask on «who else has session X» (a duplicated tab copies `sessionStorage`). */
export const TLM_CHANNEL = 'ashen-oath-rt-tlm-v1';
/** Sandbox fight numbering, per browser session (ids never repeat after a reload). */
export const TLM_SANDBOX_COUNT_KEY = `${TLM_PREFIX}sandbox-fights`;
/** The longest stash `pagehide` writes (characters of the compact journal). */
const UNLOAD_MAX_CHARS = 1_500_000;

const safe = <T>(fallback: T, run: () => T): T => { try { return run(); } catch { return fallback; } };

// ---- The fight tap ----

/** The hit that killed the hero (a run's `death`), kept from the hits of the fight. */
export interface LastHit { enemy?: string; source: string; elite?: boolean; affixes?: string[]; tick: number }

export class FightTap {
  /** The last tick shown to the observer. */
  private observed: number;
  /** New events since the last look (the hits of the cause of death); the same cursor rule as the observer's. */
  private readonly cursor = new EventCursor();
  lastHit: LastHit | null = null;
  private viewSum = 0;
  private viewTicks = 0;
  private viewMax = 0;

  constructor(private readonly observer: FightObserver, world: World) { this.observed = world.tick; }

  private readHits(world: World): void {
    this.cursor.read(world, ev => {
      if (ev.type !== 'hit') return;
      const e = world.enemies.find(o => o.id === ev.enemyId);
      this.lastHit = { ...e ? { enemy: e.kind } : {}, source: ev.source, ...e?.elite ? { elite: true } : {}, ...e?.affixes?.length ? { affixes: [...e.affixes] } : {}, tick: world.tick };
    });
  }

  /** Shows the observer the tick that ended, if it has not seen it (call before anything changes the world). */
  flush(world: World): void {
    if (world.tick <= this.observed) return;
    this.observed = world.tick;
    this.readHits(world);
    this.observer.tick(world);
  }

  beforeCommand(world: World): void { this.flush(world); }
  afterCommand(cmd: Command, world: World): void { this.readHits(world); this.observer.command(cmd, world); }

  /** The view is about to clear `world.events`: the tick that ended is shown first (its events are read before they go). */
  beforeClear(world: World): void { this.flush(world); }

  /** Enemies in view this frame, weighted by the ticks it ran. */
  sampleView(count: number, ticks: number): void {
    if (ticks <= 0) return;
    this.viewSum += count * ticks; this.viewTicks += ticks;
    if (count > this.viewMax) this.viewMax = count;
  }

  summary(world: World): FightSummary {
    this.flush(world);
    const s = this.observer.summary();
    if (this.viewTicks > 0) s.tempo.inView = { avg: this.viewSum / this.viewTicks, max: this.viewMax };
    return s;
  }
}

// ---- Identity ----

function storageOf(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try { return typeof window === 'undefined' ? null : window[kind]; } catch { return null; }
}

/** The `sessionStorage` methods the session id needs (a fake in tests). */
export type SessionStore = Pick<KeyValueStore, 'getItem' | 'setItem'>;

/** A new session id: `crypto.randomUUID()`; without it — `sessionKey(time, random)`. */
function newSessionId(): string {
  try { return crypto.randomUUID(); } catch {
    let salt: number;
    try { const a = new Uint32Array(1); crypto.getRandomValues(a); salt = a[0]; } catch { salt = Math.floor(Math.random() * 0x100000000); }
    return sessionKey(Date.now(), salt);
  }
}

/** The browser session id kept in `sessionStorage` (`fresh` — a new one replaces it: a duplicated tab). */
export function browserSession(store: SessionStore | null = storageOf('sessionStorage'), fresh = false): string {
  const saved = fresh ? null : safe<string | null>(null, () => store?.getItem(TLM_SESSION_KEY) ?? null);
  if (saved && isIdSegment(saved)) return saved;
  const id = newSessionId();
  safe(undefined, () => store?.setItem(TLM_SESSION_KEY, id));
  return id;
}

/** The part of `BroadcastChannel` the session check uses (a fake in tests). */
export interface TabChannel {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}
const browserChannel = (): TabChannel | null =>
  typeof window !== 'undefined' && typeof BroadcastChannel === 'function' ? new BroadcastChannel(TLM_CHANNEL) as unknown as TabChannel : null;

export const buildId = (): string => (typeof __RT_BUILD__ !== 'undefined' ? __RT_BUILD__ : 'unknown');

// ---- Run choices (pure: the run state before and after a step) ----

function giftLabel(o: GiftOption): string {
  switch (o.kind) {
    case 'resources': return `resources:${o.resources.join('+')}`;
    case 'max-hp': return `max-hp:${o.amount}`;
    case 'pick-item': return `pick-item:${o.items.join('+')}`;
    case 'items': return `items:${o.items.join('+')}`;
    case 'energy': return `energy:${o.amount}`;
    case 'calm': return `calm:${o.battles}`;
    case 'deal': return `deal:${o.price}:${o.reward.kind === 'pick-talisman' ? o.reward.talismans.join('+') : o.reward.talisman ?? ''}`;
    case 'oath': return `oath:${o.oath ?? ''}`;
  }
}

/** The choices a run step made (gift, talisman, oath or relic, hammer, find, event, rest, shop); merged per node and source by the caller. */
export function stepChoices(before: RtRunState | null, step: Extract<RtRunStep, { ok: true }>): RunChoice[] {
  const pending = before?.pending, after = step.run, events = step.events, out: RunChoice[] = [];
  if (!before || !pending) return out;
  const choice = (nodeId: string, source: string, offered: string[], taken: string[]): void => { out.push({ nodeId, source, offered, taken, refused: offered.filter(o => !taken.includes(o)) }); };
  switch (pending.kind) {
    case 'gift': {
      const view = rtGiftView(before);
      if (!view) break;
      if (view.chosen === null) {
        const chosen = events.find(e => e.type === 'gift-chosen');
        if (!chosen || chosen.type !== 'gift-chosen') break;
        const labels = view.options.map(e => giftLabel(e.option));
        choice('start', 'gift', labels, chosen.index === null ? [] : [labels[chosen.index]]);
      } else if (after.gift?.pick !== undefined) choice('start', 'gift-pick', view.picks, [String(after.gift.pick)]);
      break;
    }
    case 'talisman': {
      const taken = events.flatMap(e => (e.type === 'talisman-taken' ? [e.id as string] : []));
      choice(pending.nodeId, pending.source === 'oath' ? 'oath' : 'talisman', pending.options.map(String), taken);
      break;
    }
    case 'hammer':
      choice(pending.nodeId, 'hammer', pending.options.map(String), events.flatMap(e => (e.type === 'hammer-taken' ? [e.id as string] : [])));
      break;
    case 'find':
      choice(pending.nodeId, 'find', pending.options.map(String), events.flatMap(e => (e.type === 'items-gained' ? e.items.map(String) : [])));
      break;
    case 'event': {
      const view = rtEventView(before);
      const taken = events.flatMap(e => (e.type === 'event-resolved' || e.type === 'event-attempt' ? [e.option] : []));
      if (view && taken.length) choice(pending.nodeId, 'event', view.options.map(o => o.id), taken);
      break;
    }
    case 'rest': {
      const view = rtRestView(before);
      if (!view) break;
      const taken = events.flatMap(e => (e.type === 'healed' ? ['heal'] : e.type === 'rest-crafted' ? [`craft:${e.item}`] : []));
      choice(pending.nodeId, 'rest', ['heal', ...view.recipes.map(r => `craft:${r.item}`)], taken);
      break;
    }
    case 'shop': {
      const view = rtShopView(before);
      if (!view) break;
      const label = (good: string, item?: string, talisman?: string): string => (item ? `item:${item}` : talisman ? `talisman:${talisman}` : good);
      const taken = events.flatMap(e => (e.type === 'shop-bought' ? [label(e.purchase.good, e.purchase.item, e.purchase.talisman)] : []));
      choice(pending.nodeId, 'shop', view.goods.map(g => label(g.good, g.item, g.talisman)), taken);
      break;
    }
    default: break;
  }
  return out;
}

/** Adds a step's choice to the run's list: one entry per node and source (a rest, a shop, an event take several steps). */
export function mergeChoice(list: RunChoice[], c: RunChoice): void {
  const old = list.find(o => o.nodeId === c.nodeId && o.source === c.source);
  if (!old) { list.push(c); return; }
  for (const o of c.offered) if (!old.offered.includes(o)) old.offered.push(o);
  old.taken.push(...c.taken);
  old.refused = old.offered.filter(o => !old.taken.includes(o));
}

/** The build at the end of the run (or now). */
export function runKit(run: RtRunState): RunRecord['kit'] {
  const rarity = (id: string) => rtTalisman(id)?.rarity;
  return {
    hp: run.hp, maxHp: run.maxHp, energy: run.energy, talismans: [...run.talismans], hammer: run.hammer ?? null,
    relics: run.talismans.filter(id => rarity(id) === 'relic'), oath: run.talismans.find(id => rarity(id) === 'oath') ?? null,
    items: { ...run.items }, resources: { ...run.materials },
  };
}

// ---- The recorder ----

/** The run's telemetry state, kept under its own key across reloads. */
interface RunMeta {
  key: string;
  seed: number;
  outcome: RunOutcome;
  farRow: number;
  death: RunDeath | null;
  nodes: RunNodeVisit[];
  choices: RunChoice[];
  fights: string[];
  /** Fights started in this run (the index of the next fight key). */
  fightCount: number;
  /** Arena starts of each node (the attempt of its fight key). */
  attempts: Record<string, number>;
}

/** Where a fight is: a run node or the sandbox. */
export interface FightContext { nodeId?: string; row?: number; roster?: string; /** The run of a node's fight (its telemetry key and fight numbering). */ runState?: RtRunState }

interface OpenFight {
  sim: Simulation;
  tap: FightTap;
  key: string;
  run: string;
  ctx: FightContext;
  hpIn: number;
  done: boolean;
  /** `pagehide` cut the fight (its stash key): a page restored from the back-forward cache records it on. */
  hidden?: string;
}

/** The fight record without the header and journal meta (the stash of `pagehide` keeps this). */
type FightBody = Omit<FightRecord, keyof RtHeader | 'journal'>;
interface UnloadStash { session: string; run: string; paramsHash: string; tester?: string; body: FightBody; compact: string }

export interface RecorderOptions {
  sandbox: boolean;
  /** The storage key of the Params panel (`params.storage` of the header). */
  paramsStorage: string;
  /** The Params of the page (a run: the run's Params, the run record keeps them once). */
  params: Params;
  /** Makes the fight observer: `nullObserver` until track ТB lands (its `observeFight` is one line in main.ts). */
  observer?: FightObserverFactory;
  /** The dev-server sink (`devSource`, POST /__rt-telemetry); the view makes it only under `vite` (absent from the build). */
  devSink?: SinkSource | null;
  /** Where to look for the artifact's sink and export hook. */
  win?: RtTelemetryWindow;
  buffer?: BufferOptions;
  /** Polls for `window.__rtTelemetrySink` appearing (ms; 0 — no polling). */
  sinkPollMs?: number;
  /** `localStorage` (the stash, the tester, the run state) and `sessionStorage` (the session id); fakes in Node tests. */
  local?: KeyValueStore | null;
  sessionStore?: SessionStore | null;
  /** Opens the channel of the tabs: absent — `BroadcastChannel` when the browser has it; null — no check. */
  channel?: (() => TabChannel | null) | null;
}

export interface TelemetryStats extends BufferStats { session: string }

export class RtRecorder {
  readonly buffer: TelemetryBuffer;
  readonly queue: DeliveryQueue;
  private sessionId: string;
  readonly build = buildId();
  private readonly observer: FightObserverFactory;
  private readonly local: KeyValueStore | null;
  private readonly sessionStore: SessionStore | null;
  /** This page among the tabs (not stored: a duplicated tab gets its own). */
  private readonly tab = Math.random().toString(36).slice(2);
  private channel: TabChannel | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private fight: OpenFight | null = null;
  private meta: RunMeta | null = null;
  /** The last sandbox arena and how many times in a row it started (its fight key's attempt). */
  private sandboxLast: { arena: string; attempt: number } | null = null;
  /** Writes in flight (tests and the export wait for them). */
  private writes: Promise<unknown> = Promise.resolve();
  /** Telemetry time per tick: total ms of the tap and the ticks it saw (the check «< 0.1 ms per tick»). */
  costMs = 0;
  costTicks = 0;

  constructor(private readonly options: RecorderOptions) {
    this.local = options.local !== undefined ? options.local : storageOf('localStorage');
    this.sessionStore = options.sessionStore !== undefined ? options.sessionStore : storageOf('sessionStorage');
    this.sessionId = browserSession(this.sessionStore);
    this.openChannel();
    this.observer = options.observer ?? nullObserver;
    this.buffer = new TelemetryBuffer(options.buffer);
    const win = options.win ?? (typeof window !== 'undefined' ? window as RtTelemetryWindow : {});
    const sources: SinkSource[] = [artifactSource(win)];
    if (options.devSink) sources.push(options.devSink);
    this.queue = new DeliveryQueue(this.buffer, sources);
    this.meta = this.loadMeta();
    this.track(this.recoverUnload().then(() => this.queue.kick()));
    const poll = options.sinkPollMs ?? 2000;
    if (poll > 0 && typeof setInterval === 'function') {
      let had = sources[0].present();
      this.poll = setInterval(() => { const has = sources[0].present(); if (has && !had) void this.queue.kick(); had = has; }, poll);
    }
  }

  /** The browser session of the records written from now on (a duplicated tab gets a new one, see `openChannel`). */
  get session(): string { return this.sessionId; }

  /**
   * A duplicated tab copies `sessionStorage`, its session id too. On load (and on a return from the back-forward cache)
   * the page asks the other tabs on `TLM_CHANNEL` «who has session X»; a tab with X answers, and the asking page takes a
   * new session. Without `BroadcastChannel` the session stays as it is.
   */
  private openChannel(): void {
    const make = this.options.channel === undefined ? browserChannel : this.options.channel;
    if (!make || this.channel) return;
    const channel = safe<TabChannel | null>(null, make);
    if (!channel) return;
    this.channel = channel;
    channel.onmessage = event => safe(undefined, () => this.onChannel(event.data));
    safe(undefined, () => channel.postMessage({ t: 'who', session: this.sessionId, tab: this.tab }));
  }

  private onChannel(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const m = data as { t?: unknown; session?: unknown; tab?: unknown; to?: unknown };
    if (m.session !== this.sessionId || m.tab === this.tab) return;
    if (m.t === 'who') this.channel?.postMessage({ t: 'mine', session: this.sessionId, tab: this.tab, to: m.tab });
    else if (m.t === 'mine' && m.to === this.tab) this.sessionId = browserSession(this.sessionStore, true);
  }

  private closeChannel(): void {
    const channel = this.channel;
    this.channel = null;
    if (channel) safe(undefined, () => { channel.onmessage = null; channel.close(); });
  }

  /** Stops the sink polling and closes the tab channel (Node tests; the page keeps them for its life). */
  dispose(): void {
    this.closeChannel();
    if (this.poll !== null) { clearInterval(this.poll); this.poll = null; }
  }

  private track(p: Promise<unknown>): void { this.writes = Promise.all([this.writes, p.catch(() => undefined)]); }
  /** Resolves when every record written so far is in the buffer (and one delivery pass ran). */
  async settle(): Promise<void> { await this.writes; await this.queue.kick(); }

  get tester(): string { return safe('', () => this.local?.getItem(TLM_TESTER_KEY) ?? ''); }
  set tester(name: string) {
    const v = name.trim().slice(0, 64);
    safe(undefined, () => { if (v) this.local?.setItem(TLM_TESTER_KEY, v); else this.local?.removeItem(TLM_TESTER_KEY); });
  }

  stats(): TelemetryStats { return { ...this.buffer.stats(this.queue.activeNames()), session: this.session }; }

  private header<K extends RtRecordKind>(id: string, kind: K, run: string, hash: string): RtHeader & { kind: K } {
    const tester = this.tester;
    return { schema: RT_TELEMETRY_SCHEMA, id, kind, build: this.build, params: { storage: this.options.paramsStorage, hash }, session: this.session, run, at: new Date().toISOString(), ...tester ? { tester } : {} };
  }

  private put(records: RtRecord[]): Promise<void> {
    const p = (async () => { for (const r of records) await this.buffer.put(r); void this.queue.kick(); })();
    this.track(p);
    return p.catch(() => undefined);
  }

  // ---- Fights ----

  /** A new fight on screen. A fight before it that has no result is recorded as left (`menu`). */
  beginFight(sim: Simulation, ctx: FightContext = {}): void {
    safe(undefined, () => {
      if (this.fight && !this.fight.done) this.leaveFight('menu');
      const world = sim.world, arena = world.arena.id;
      let key: string, run: string;
      if (this.options.sandbox || ctx.nodeId === undefined) {
        run = SANDBOX_RUN;
        const store = this.sessionStore;
        const n = safe(0, () => Number(store?.getItem(TLM_SANDBOX_COUNT_KEY) ?? 0)) + 1;
        safe(undefined, () => store?.setItem(TLM_SANDBOX_COUNT_KEY, String(n)));
        this.sandboxLast = this.sandboxLast?.arena === arena ? { arena, attempt: this.sandboxLast.attempt + 1 } : { arena, attempt: 1 };
        key = fightKey(n, null, this.sandboxLast.attempt);
      } else {
        const meta = ctx.runState ? this.metaFor(ctx.runState) : this.meta;
        if (!meta) return;
        run = meta.key;
        meta.fightCount++;
        meta.attempts[ctx.nodeId] = (meta.attempts[ctx.nodeId] ?? 0) + 1;
        key = fightKey(meta.fightCount, ctx.nodeId, meta.attempts[ctx.nodeId]);
        this.saveMeta();
      }
      this.fight = { sim, tap: new FightTap(this.observer(world), world), key, run, ctx, hpIn: world.hero.hp, done: false };
    });
  }

  /** The replayed world of `replayTo` is not recorded: the current fight (left) is detached. */
  detach(): void { this.fight = null; }

  private own(world: World): FightTap | null { const f = this.fight; return f && !f.done && f.sim.world === world ? f.tap : null; }

  beforeTick(world: World): void {
    const tap = this.own(world);
    if (!tap) return;
    const t0 = performance.now();
    safe(undefined, () => tap.flush(world));
    this.costMs += performance.now() - t0; this.costTicks++;
  }
  beforeCommand(world: World): void { const tap = this.own(world); if (tap) safe(undefined, () => tap.beforeCommand(world)); }
  afterCommand(cmd: Command, world: World): void { const tap = this.own(world); if (tap) safe(undefined, () => tap.afterCommand(cmd, world)); }
  /** The frame is about to clear `world.events`; `inView` — enemies in the camera now, `ticks` — ticks this frame ran. */
  frameEnd(world: World, inView: number | null, ticks: number): void {
    const tap = this.own(world);
    if (!tap) return;
    const t0 = performance.now();
    safe(undefined, () => { tap.beforeClear(world); if (inView !== null) tap.sampleView(inView, ticks); });
    this.costMs += performance.now() - t0;
  }
  /** True while a fight is recorded (the view counts enemies in view only then). */
  get recording(): boolean { return !!this.fight && !this.fight.done; }

  /** The body of the fight record and its journal, taken in this frame (the journal and the hash of the same tick). */
  private capture(outcome: FightOutcome, view?: { w: number; h: number }): { body: FightBody; journal: Journal; f: OpenFight } | null {
    const f = this.fight;
    if (!f || f.done) return null;
    const world = f.sim.world;
    const journal = f.sim.exportJournal();
    const endHash = f.sim.hash();
    f.done = true;
    if (!journal || (journal.ticks === 0 && outcome !== 'victory' && outcome !== 'defeat')) return null;
    const body: FightBody = {
      fight: f.key, ...f.ctx.nodeId !== undefined ? { nodeId: f.ctx.nodeId } : {}, arena: world.arena.id, ...f.ctx.roster !== undefined ? { roster: f.ctx.roster } : {},
      ...f.ctx.row !== undefined ? { row: f.ctx.row } : {}, seed: f.sim.seed, outcome, ticks: journal.ticks, time: world.time, hpIn: f.hpIn, hpOut: world.hero.hp, endHash,
      ...view ? { view } : {}, summary: f.tap.summary(world),
    };
    if (f.run !== SANDBOX_RUN && this.meta?.key === f.run) {
      const meta = this.meta;
      if (!meta.fights.includes(f.key)) meta.fights.push(f.key);
      const visit = [...meta.nodes].reverse().find(v => v.nodeId === f.ctx.nodeId);
      if (visit) { visit.fight = f.key; visit.arena = world.arena.id; if (f.ctx.roster !== undefined) visit.roster = f.ctx.roster; }
      if (outcome === 'defeat') meta.death = { ...f.tap.lastHit ?? { source: 'unknown' }, fight: f.key, tick: f.tap.lastHit?.tick ?? world.tick };
      this.saveMeta();
    }
    return { body, journal, f };
  }

  /** The fight ended (`victory`/`defeat`) or was left (`restart`, `menu`): the record and the journal go into the buffer. */
  endFight(outcome: FightOutcome, view?: { w: number; h: number }): void {
    const got = safe(null, () => this.capture(outcome, view));
    if (!got) return;
    const { body, journal, f } = got;
    const ref = f.run === SANDBOX_RUN ? undefined : paramsHash(this.options.params);
    this.track(this.storeFight(f.run, body, journal, ref).catch(() => undefined));
  }
  leaveFight(outcome: 'restart' | 'menu'): void { this.endFight(outcome); }

  private async storeFight(run: string, body: FightBody, journal: Journal, paramsRef?: string): Promise<void> {
    const packed = await packJournal(journal, paramsRef ? { paramsRef } : {});
    await this.putFight(run, body, packed.parts, packed.meta, paramsHash(journal.params));
  }

  private async putFight(run: string, body: FightBody, parts: string[], meta: JournalMeta, hash: string, header?: { session: string; tester?: string }): Promise<void> {
    const session = header?.session ?? this.session;
    const head = <K extends RtRecordKind>(id: string, kind: K) => {
      const h = this.header(id, kind, run, hash);
      return header ? { ...h, session, ...header.tester ? { tester: header.tester } : {} } : h;
    };
    const records: RtRecord[] = parts.map((data, index): JournalPart => ({
      ...head(journalPartId(session, run, body.fight, index, parts.length), 'journal'), fight: body.fight, index, count: parts.length, digest: meta.digest, encoding: meta.encoding, data,
    }));
    records.push({ ...head(fightRecordId(session, run, body.fight), 'fight'), ...body, journal: meta } as FightRecord);
    await this.put(records);
  }

  /**
   * `pagehide`: the fight on screen goes into a stash under its own key (synchronously); the next load packs it into
   * the buffer. The page may come back from the back-forward cache instead (`pageShow`).
   */
  pageHide(): void {
    safe(undefined, () => {
      // A page in the back-forward cache does not answer the other tabs; restored, it asks again.
      this.closeChannel();
      const f = this.fight;
      if (!f || f.done || f.sim.world.tick === 0) return;
      const ref = f.run === SANDBOX_RUN ? undefined : paramsHash(this.options.params);
      const got = this.capture('unload');
      if (!got) return;
      const key = unloadKey(this.session, f.run, f.key);
      f.hidden = key;
      const compact = encodeJournal(got.journal, ref);
      if (compact.length > UNLOAD_MAX_CHARS) return;
      const tester = this.tester;
      const stash: UnloadStash = { session: this.session, run: f.run, paramsHash: paramsHash(got.journal.params), ...tester ? { tester } : {}, body: got.body, compact };
      this.local?.setItem(key, JSON.stringify(stash));
    });
  }

  /**
   * `pageshow`: a page restored from the back-forward cache (`persisted`) goes on recording the fight `pagehide` cut —
   * its stash is removed and its result is written as usual when it ends.
   */
  pageShow(persisted: boolean): void {
    safe(undefined, () => {
      if (!persisted) return;
      this.openChannel();
      const f = this.fight;
      if (!f || !f.hidden) return;
      const key = f.hidden;
      safe(undefined, () => this.local?.removeItem(key));
      f.hidden = undefined;
      f.done = false;
    });
  }

  /** Packs every stash `pagehide` left (this page's earlier load, other tabs, the bare key of older pages). */
  private async recoverUnload(): Promise<void> {
    const keys = telemetryKeys(this.local).filter(k => k === TLM_UNLOAD_KEY || k.startsWith(`${TLM_UNLOAD_KEY}:`));
    for (const key of keys) {
      const text = safe<string | null>(null, () => this.local?.getItem(key) ?? null);
      if (!text) continue;
      safe(undefined, () => this.local?.removeItem(key));
      try {
        const stash = JSON.parse(text) as UnloadStash;
        const packedText = await gzipBase64(stash.compact);
        const parts = splitParts(packedText);
        await this.putFight(stash.run, stash.body, parts, { parts: parts.length, chars: packedText.length, digest: hashText(packedText), encoding: 'compact+gzip+b64' }, stash.paramsHash, { session: stash.session, ...stash.tester ? { tester: stash.tester } : {} });
      } catch { /* a broken stash is dropped */ }
    }
  }

  /** The N key: a note at this tick of the fight on screen. False — no fight to note. */
  note(): boolean {
    return safe(false, () => {
      const f = this.fight;
      if (!f) return false;
      const w = f.sim.world;
      const hash = paramsHash(this.options.params);
      const note: NoteRecord = { ...this.header(noteRecordId(this.session, f.run, f.key, w.tick), 'note', f.run, hash), fight: f.key, tick: w.tick, arena: w.arena.id, hero: { x: w.hero.x, y: w.hero.y } };
      void this.put([note]);
      return true;
    });
  }

  // ---- The run ----

  private loadMeta(): RunMeta | null {
    return safe(null, () => {
      const raw = JSON.parse(this.local?.getItem(TLM_RUN_META_KEY) ?? 'null') as RunMeta | null;
      return raw && typeof raw.key === 'string' && isIdSegment(raw.key) && Array.isArray(raw.nodes) ? raw : null;
    });
  }
  private saveMeta(): void { safe(undefined, () => this.local?.setItem(TLM_RUN_META_KEY, JSON.stringify(this.meta))); }

  private freshMeta(run: RtRunState): RunMeta {
    return { key: runKey(Date.now(), run.seed), seed: run.seed, outcome: 'open', farRow: 0, death: null, nodes: [], choices: [], fights: [], fightCount: 0, attempts: {} };
  }

  /** The telemetry of this run (a saved run started before the telemetry, or after the meta was lost, gets a new key). */
  private metaFor(run: RtRunState): RunMeta {
    if (!this.meta || this.meta.seed !== run.seed) { this.meta = this.freshMeta(run); this.saveMeta(); }
    return this.meta;
  }

  private writeRun(run: RtRunState): void {
    const meta = this.metaFor(run), runParams = JSON.parse(JSON.stringify(this.options.params)) as Params;
    const record: RunRecord = {
      ...this.header(runRecordId(this.session, meta.key), 'run', meta.key, paramsHash(runParams)),
      seed: run.seed, outcome: meta.outcome, farRow: meta.farRow, death: meta.death, nodes: meta.nodes, choices: meta.choices, kit: runKit(run), fights: meta.fights, runParams,
    };
    void this.put([JSON.parse(JSON.stringify(record)) as RunRecord]);
  }

  /** A new run; the one before it without a result is `abandoned`. */
  runStarted(previous: RtRunState | null, run: RtRunState): void {
    safe(undefined, () => {
      if (previous && !previous.result) {
        const meta = this.metaFor(previous);
        meta.outcome = 'abandoned';
        this.saveMeta();
        this.writeRun(previous);
      }
      this.meta = this.freshMeta(run);
      this.saveMeta();
      this.writeRun(run);
    });
  }

  /** A run step went through (`RunView.apply`): nodes, choices, the end; the run record is written again (same id). */
  runStep(before: RtRunState | null, step: Extract<RtRunStep, { ok: true }>): void {
    safe(undefined, () => {
      const after = step.run, meta = this.metaFor(before && before.seed === after.seed ? before : after);
      for (const ev of step.events) {
        if (ev.type === 'node-entered') {
          const node = rtNode(after, ev.nodeId), row = node ? runRow(node.row) : ev.row;
          meta.nodes.push({ nodeId: ev.nodeId, row, type: node?.type ?? 'unknown', hpIn: before?.hp ?? after.hp, hpOut: after.hp, maxHp: after.maxHp });
          meta.farRow = Math.max(meta.farRow, row);
        } else if (ev.type === 'battle-ready') {
          const visit = meta.nodes[meta.nodes.length - 1], pending = after.pending;
          if (visit) { visit.arena = ev.arena; if (pending?.kind === 'battle' && pending.roster !== undefined) visit.roster = pending.roster; }
        } else if (ev.type === 'event-resolved') {
          const visit = [...meta.nodes].reverse().find(v => v.nodeId === ev.nodeId), id = before ? rtEventView(before)?.event.id : undefined;
          if (visit) visit.event = { id: id ?? 'unknown', option: ev.option, outcome: ev.outcome };
        } else if (ev.type === 'run-won') meta.outcome = 'victory';
        else if (ev.type === 'run-lost') meta.outcome = 'defeat';
      }
      for (const c of stepChoices(before, step)) mergeChoice(meta.choices, c);
      const last = meta.nodes[meta.nodes.length - 1];
      if (last) { last.hpOut = after.hp; last.maxHp = after.maxHp; }
      this.saveMeta();
      this.writeRun(after);
    });
  }

  // ---- The «Логи» panel ----

  async exportFile(): Promise<{ filename: string; text: string; records: number }> {
    await this.writes;
    const records = await this.buffer.all(), at = new Date().toISOString();
    return { filename: `ashen-oath-rt-telemetry-${this.session}-${at.slice(0, 19).replace(/[:T]/g, '-')}.json`, text: JSON.stringify(makeExport(this.session, records, at)), records: records.length };
  }

  async clear(): Promise<void> { await this.writes; await this.buffer.clear(); }
}
