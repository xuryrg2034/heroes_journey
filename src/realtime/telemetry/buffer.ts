/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, decision 2): the browser buffer of records.
 *
 * - Journal parts live in IndexedDB (async: they are large); without IndexedDB (or when it fails) — in memory for this
 *   tab, the «Экспорт» button still takes them.
 * - Fight, run and note records live in `localStorage`: one record — one key `ashen-oath-rt-tlm-v1:<id>`, plus an index
 *   (`ashen-oath-rt-tlm-v1:index`) with the size and the delivery marks of every record, journals included, so the
 *   counts are read without touching IndexedDB.
 * - The whole buffer holds at most `TLM_LIMIT` characters. Over the limit records are evicted in this order: journals
 *   delivered somewhere → undelivered journals → notes → summaries (fights, runs); oldest first, the parts of one journal
 *   (one `session/run/fight`) together. A `QuotaExceededError` of `localStorage` evicts notes and summaries and tries
 *   once more; failing again the record stays in memory of this tab and the buffer reports `bufferFull`.
 * - Several tabs share `localStorage` (review 10.10.2026): every write, eviction and delivery mark reads the index again
 *   and writes it back in one synchronous step (read, change, write); record keys with the prefix that the index does
 *   not list (orphans) are adopted into it, so they count toward the limit and can be evicted. Records kept in memory
 *   stay out of the shared index (another tab cannot read them); on load the index drops entries whose record is gone.
 *
 * Nothing here throws into the game: storage errors fall back to memory.
 */
import { isRecordId, type JournalPart, type RtRecord, type RtRecordKind } from './schema';

export const TLM_PREFIX = 'ashen-oath-rt-tlm-v1:';
export const TLM_INDEX_KEY = `${TLM_PREFIX}index`;
export const TLM_SESSION_KEY = `${TLM_PREFIX}session`;
export const TLM_TESTER_KEY = `${TLM_PREFIX}tester`;
/** The run's telemetry state (run key, nodes, choices, fights) — its own key: `RtRunState` and its save stay as they are. */
export const TLM_RUN_META_KEY = `${TLM_PREFIX}run-meta`;
/** Keys with the prefix that «Очистить» keeps (they are not records). */
const KEPT_KEYS = new Set([TLM_SESSION_KEY, TLM_TESTER_KEY, TLM_RUN_META_KEY]);
/** The buffer's limit in characters of record JSON (all kinds; `localStorage` of a browser holds about 5 M characters). */
export const TLM_LIMIT = 2_500_000;
/** IndexedDB of the journal parts. */
export const TLM_DB_NAME = 'ashen-oath-rt-tlm-v1';
const TLM_DB_STORE = 'journals';

/** One record of the index: what the counts and the delivery need without reading the record. */
export interface IndexEntry {
  id: string;
  kind: RtRecordKind;
  /** Characters of the record's JSON. */
  chars: number;
  /** Names of the sinks that took this copy of the record. */
  delivered: string[];
  /** Order of writing (eviction takes the oldest first). */
  seq: number;
  /** The fight key of a journal part, a fight or a note (a key repeats across runs and sessions: groups use the id). */
  fight?: string;
}

/** The `localStorage` methods the buffer uses (a fake in tests); `length` and `key` find the keys the index lost. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** Keys of `store` with the telemetry prefix (read first, then acted on: removing shifts the indices). */
export function telemetryKeys(store: KeyValueStore | null): string[] {
  const out: string[] = [];
  try {
    if (!store) return out;
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k !== null && k.startsWith(TLM_PREFIX)) out.push(k); }
  } catch { /* storage optional */ }
  return out;
}

/** The journal a part belongs to — `session/run/fight` (the fight key alone repeats across runs and sessions). */
export const journalOf = (partId: string): string => partId.slice(0, partId.lastIndexOf('/'));

/** Where the journal parts live. */
export interface JournalStore {
  put(id: string, record: JournalPart): Promise<void>;
  get(id: string): Promise<JournalPart | undefined>;
  delete(id: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export function memoryJournalStore(): JournalStore {
  const map = new Map<string, JournalPart>();
  return {
    async put(id, record) { map.set(id, record); },
    async get(id) { return map.get(id); },
    async delete(id) { map.delete(id); },
    async keys() { return [...map.keys()]; },
    async clear() { map.clear(); },
  };
}

const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
});

/** The journal store in IndexedDB; null when the browser has none or it cannot be opened. */
export async function openIdbJournalStore(name = TLM_DB_NAME): Promise<JournalStore | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(TLM_DB_STORE)) open.result.createObjectStore(TLM_DB_STORE); };
    const db = await request(open);
    const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => request(run(db.transaction(TLM_DB_STORE, mode).objectStore(TLM_DB_STORE)));
    return {
      async put(id, record) { await tx('readwrite', s => s.put(record, id)); },
      async get(id) { return (await tx('readonly', s => s.get(id))) as JournalPart | undefined; },
      async delete(id) { await tx('readwrite', s => s.delete(id)); },
      async keys() { return (await tx('readonly', s => s.getAllKeys())).map(String); },
      async clear() { await tx('readwrite', s => s.clear()); },
    };
  } catch {
    return null;
  }
}

function browserStorage(): KeyValueStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const isQuota = (error: unknown): boolean => error instanceof DOMException
  ? error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22
  : /quota/i.test(String(error));

export interface BufferStats {
  /** Records in the buffer (journal parts count one each). */
  records: number;
  /** Characters of their JSON. */
  chars: number;
  /** Records not yet taken by every sink present (no sink present — records no sink took). */
  undelivered: number;
  notes: number;
  /** A record did not fit (over the limit or the storage quota) and lives in memory only. */
  bufferFull: boolean;
}

export interface BufferOptions {
  storage?: KeyValueStore | null;
  /** The journal store; absent — IndexedDB when it opens, else memory. */
  journals?: JournalStore | null;
  limit?: number;
}

/** Eviction rank: delivered journals first, then undelivered journals, notes, summaries. */
const rank = (e: IndexEntry): number => e.kind === 'journal' ? (e.delivered.length ? 0 : 1) : e.kind === 'note' ? 2 : 3;
const validEntry = (e: IndexEntry): boolean => !!e && typeof e.id === 'string' && typeof e.chars === 'number' && Array.isArray(e.delivered);

function safeGet(store: KeyValueStore | null, key: string): string | null {
  try { return store?.getItem(key) ?? null; } catch { return null; }
}

export class TelemetryBuffer {
  private readonly storage: KeyValueStore | null;
  private journals: JournalStore;
  readonly limit: number;
  /** The shared index as last read or written (records in `localStorage` and journal parts, of every tab). */
  private shared: IndexEntry[] = [];
  private seq = 0;
  /** The index text last read or written: the same text is not parsed again. */
  private lastRaw: string | null | undefined = undefined;
  /** Records of this tab that did not reach storage (export and delivery still see them) and their entries. */
  private readonly memory = new Map<string, RtRecord>();
  private memoryEntries: IndexEntry[] = [];
  private full = false;
  private ready: Promise<void>;
  /** Writes of this tab run one after another. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: BufferOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.limit = options.limit ?? TLM_LIMIT;
    this.journals = options.journals ?? memoryJournalStore();
    this.refresh();
    this.ready = this.init(options.journals);
  }

  /** The index is loaded and the journal store reconciled with it. */
  whenReady(): Promise<void> { return this.ready; }

  private async init(given: JournalStore | null | undefined): Promise<void> {
    if (given === undefined) {
      const idb = await openIdbJournalStore();
      if (idb) this.journals = idb;
    }
    // `localStorage`: orphan keys join the index; entries whose key is gone leave it (a record an older page kept in
    // memory only, a key removed by hand) — else they would stay «not delivered» for ever.
    this.mutate(() => {
      this.adoptOrphans();
      if (this.storage) this.shared = this.shared.filter(e => e.kind === 'journal' || safeGet(this.storage, TLM_PREFIX + e.id) !== null);
    });
    // Journals the index lists but the store lost (a memory store after a reload, a cleared IndexedDB) leave the index.
    // Only entries listed before the store answered: a part another tab writes meanwhile is stored before it is listed.
    const listed = this.shared.filter(e => e.kind === 'journal').map(e => e.id);
    try {
      const keys = new Set(await this.journals.keys());
      const lost = new Set(listed.filter(id => !keys.has(id)));
      if (lost.size) this.mutate(() => { this.shared = this.shared.filter(e => !lost.has(e.id)); });
    } catch { /* the store answers later or never: the entries stay */ }
  }

  /** Reads the shared index again (another tab may have written it). */
  private refresh(): void {
    if (!this.storage) return;
    let raw: string | null;
    try { raw = this.storage.getItem(TLM_INDEX_KEY); } catch { return; }
    if (raw === this.lastRaw) return;
    this.lastRaw = raw;
    this.shared = [];
    this.seq = 0;
    try {
      const parsed = JSON.parse(raw ?? 'null') as { seq?: number; entries?: IndexEntry[] } | null;
      if (parsed && Array.isArray(parsed.entries)) {
        this.shared = parsed.entries.filter(validEntry);
        this.seq = Math.max(typeof parsed.seq === 'number' ? parsed.seq : 0, ...this.shared.map(e => e.seq + 1));
      }
    } catch { /* a broken index starts empty; its records come back as orphans */ }
  }

  private saveIndex(): void {
    const raw = JSON.stringify({ seq: this.seq, entries: this.shared });
    try { this.storage?.setItem(TLM_INDEX_KEY, raw); this.lastRaw = raw; } catch { /* the index lives in memory until the next write */ }
  }

  /** Read, change, write — in one synchronous step, so a second tab never writes between the read and the write. */
  private mutate(change: () => void): void {
    this.refresh();
    change();
    this.saveIndex();
  }

  /** Record keys the index does not list (another tab's index write lost, an old page) join it (inside `mutate`). */
  private adoptOrphans(): void {
    if (!this.storage) return;
    const listed = new Set(this.shared.map(e => e.id));
    for (const key of telemetryKeys(this.storage)) {
      const id = key.slice(TLM_PREFIX.length);
      if (!isRecordId(id) || listed.has(id)) continue;
      const text = safeGet(this.storage, key);
      let record: Partial<RtRecord> | null = null;
      try { record = text === null ? null : JSON.parse(text) as Partial<RtRecord>; } catch { record = null; }
      if (text === null || !record || record.id !== id || typeof record.kind !== 'string' || record.kind === 'journal') {
        try { this.storage.removeItem(key); } catch { /* optional */ }
        continue;
      }
      const fight = 'fight' in record && typeof record.fight === 'string' ? record.fight : undefined;
      this.shared.push({ id, kind: record.kind, chars: text.length, delivered: [], seq: this.seq++, ...fight ? { fight } : {} });
      listed.add(id);
    }
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Every entry this tab sees: the shared index (read again) and its own records kept in memory. */
  private view(): IndexEntry[] {
    this.refresh();
    return [...this.shared, ...this.memoryEntries];
  }

  get bufferFull(): boolean { return this.full; }
  get entryList(): readonly IndexEntry[] { return this.view(); }

  stats(activeSinks: readonly string[]): BufferStats {
    let chars = 0, undelivered = 0, notes = 0;
    const all = this.view();
    for (const e of all) {
      chars += e.chars;
      if (e.kind === 'note') notes++;
      if (activeSinks.length ? activeSinks.some(s => !e.delivered.includes(s)) : !e.delivered.length) undelivered++;
    }
    return { records: all.length, chars, undelivered, notes, bufferFull: this.full };
  }

  /** Index entries a sink has not taken, oldest first. */
  pendingFor(sink: string): IndexEntry[] {
    return this.view().filter(e => !e.delivered.includes(sink)).sort((a, b) => a.seq - b.seq);
  }

  /** Stores a record (the same id replaces the old copy and its delivery marks). */
  put(record: RtRecord): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      const text = JSON.stringify(record), chars = text.length;
      const fight = 'fight' in record ? record.fight : undefined;
      const entry: IndexEntry = { id: record.id, kind: record.kind, chars, delivered: [], seq: 0, ...fight ? { fight } : {} };
      // The old copy of this id leaves first (its marks go; its key or part is written again below).
      const old = this.dropNow(this.view().filter(e => e.id === record.id));
      if (chars > this.limit) { await this.deleteJournals(old); this.toMemory(record, entry); return; }
      let stale: string[] = [];
      if (record.kind === 'journal') {
        try { await this.journals.put(record.id, record); } catch { this.toMemory(record, entry); return; }
        // The part is stored: the eviction for it and its entry in one index step.
        this.mutate(() => {
          this.shared = this.shared.filter(e => e.id !== record.id);
          stale = this.evictNow(chars, record.id);
          entry.seq = this.seq++;
          this.shared.push(entry);
        });
        await this.deleteJournals(stale);
        return;
      }
      // A record in `localStorage`: the eviction, the key and the index entry in one synchronous step.
      let stored = false;
      this.mutate(() => {
        this.shared = this.shared.filter(e => e.id !== record.id);
        stale = this.evictNow(chars, record.id);
        stored = this.storeText(record.id, text, stale);
        if (stored) { entry.seq = this.seq++; this.shared.push(entry); }
      });
      await this.deleteJournals(stale);
      if (!stored) this.toMemory(record, entry);
    });
  }

  private toMemory(record: RtRecord, entry: IndexEntry): void {
    this.memory.set(record.id, record);
    this.memoryEntries.push({ ...entry, seq: this.seq++ });
    this.full = true;
  }

  /** `localStorage` (inside `mutate`): on a quota error evict notes and summaries for the record's size and try once more. */
  private storeText(id: string, text: string, stale: string[]): boolean {
    if (!this.storage) return false;
    try { this.storage.setItem(TLM_PREFIX + id, text); return true; } catch (error) {
      if (!isQuota(error)) return false;
    }
    let freed = 0;
    const victims: IndexEntry[] = [];
    for (const e of this.shared.filter(e => e.kind !== 'journal').sort((a, b) => rank(a) - rank(b) || a.seq - b.seq)) {
      if (freed >= text.length) break;
      victims.push(e); freed += e.chars;
    }
    stale.push(...this.removeEntries(victims));
    this.saveIndex(); // the shorter index frees its room too
    try { this.storage.setItem(TLM_PREFIX + id, text); return true; } catch { return false; }
  }

  /** Evicts records (inside `mutate`) so that `chars` more fit the limit; returns the journal parts to delete. */
  private evictNow(chars: number, keep: string): string[] {
    this.adoptOrphans();
    const all = [...this.shared, ...this.memoryEntries].filter(e => e.id !== keep);
    let total = all.reduce((s, e) => s + e.chars, 0);
    if (total + chars <= this.limit) return [];
    const order = [...all].sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
    const victims = new Set<IndexEntry>();
    for (const e of order) {
      if (total + chars <= this.limit) break;
      if (victims.has(e)) continue;
      // The parts of one journal go together: the same session, run and fight, not only the same fight key.
      const group = e.kind === 'journal' ? all.filter(o => o.kind === 'journal' && journalOf(o.id) === journalOf(e.id)) : [e];
      for (const g of group) if (!victims.has(g)) { victims.add(g); total -= g.chars; }
    }
    return this.removeEntries([...victims]);
  }

  /**
   * Removes entries now (inside `mutate`): from the index or this tab's memory, their `localStorage` keys too; returns
   * the journal parts to delete from the journal store (after the index no longer lists them).
   */
  private removeEntries(list: readonly IndexEntry[]): string[] {
    if (!list.length) return [];
    const ids = new Set(list.map(e => e.id)), journals: string[] = [];
    this.shared = this.shared.filter(e => !ids.has(e.id));
    this.memoryEntries = this.memoryEntries.filter(e => !ids.has(e.id));
    for (const e of list) {
      if (this.memory.delete(e.id)) continue;
      if (e.kind === 'journal') journals.push(e.id);
      else { try { this.storage?.removeItem(TLM_PREFIX + e.id); } catch { /* storage optional */ } }
    }
    if (!this.memory.size) this.full = false;
    return journals;
  }

  /** Removes entries from the index in one step; returns their journal parts (a rewritten id: its part is written again). */
  private dropNow(list: readonly IndexEntry[]): string[] {
    let parts: string[] = [];
    if (list.length) this.mutate(() => { parts = this.removeEntries(list); });
    return parts;
  }

  private async deleteJournals(ids: readonly string[]): Promise<void> {
    for (const id of ids) { try { await this.journals.delete(id); } catch { /* gone anyway */ } }
  }

  async get(id: string): Promise<RtRecord | null> {
    await this.ready;
    const mem = this.memory.get(id);
    if (mem) return mem;
    const entry = this.view().find(e => e.id === id);
    if (!entry) return null;
    try {
      if (entry.kind === 'journal') return (await this.journals.get(id)) ?? null;
      const text = this.storage?.getItem(TLM_PREFIX + id);
      return text ? JSON.parse(text) as RtRecord : null;
    } catch { return null; }
  }

  /** Every record, oldest first (records that cannot be read are left out). */
  async all(): Promise<RtRecord[]> {
    await this.ready;
    const out: RtRecord[] = [];
    for (const e of this.view().sort((a, b) => a.seq - b.seq)) {
      const r = await this.get(e.id);
      if (r) out.push(r);
    }
    return out;
  }

  /** A sink took this copy of the record (a copy written since keeps its own marks). */
  markDelivered(id: string, sink: string, seq: number): void {
    const own = this.memoryEntries.find(o => o.id === id && o.seq === seq);
    if (own) { if (!own.delivered.includes(sink)) own.delivered.push(sink); return; }
    this.mutate(() => {
      const e = this.shared.find(o => o.id === id && o.seq === seq);
      if (e && !e.delivered.includes(sink)) e.delivered.push(sink);
    });
  }

  /** Removes everything (the «Логи» panel's «Очистить»): every key with the prefix but the session, tester and run state. */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      for (const key of telemetryKeys(this.storage)) if (!KEPT_KEYS.has(key)) { try { this.storage?.removeItem(key); } catch { /* optional */ } }
      try { await this.journals.clear(); } catch { /* optional */ }
      this.lastRaw = undefined;
      this.shared = [];
      this.memoryEntries = [];
      this.memory.clear();
      this.full = false;
      this.saveIndex();
    });
  }
}
