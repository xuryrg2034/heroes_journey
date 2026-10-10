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
 *   together. A `QuotaExceededError` of `localStorage` evicts notes and summaries and tries once more; failing again the
 *   record stays in memory and the buffer reports `bufferFull`.
 *
 * Nothing here throws into the game: storage errors fall back to memory.
 */
import type { JournalPart, RtRecord, RtRecordKind } from './schema';

export const TLM_PREFIX = 'ashen-oath-rt-tlm-v1:';
export const TLM_INDEX_KEY = `${TLM_PREFIX}index`;
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
  /** The fight of a journal part, a fight or a note (the parts of one journal are evicted together). */
  fight?: string;
}

/** The `localStorage` methods the buffer uses (a fake in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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

export class TelemetryBuffer {
  private readonly storage: KeyValueStore | null;
  private journals: JournalStore;
  readonly limit: number;
  private entries: IndexEntry[] = [];
  private seq = 0;
  /** Records that did not reach storage (kept for this tab: export and delivery still see them). */
  private readonly memory = new Map<string, RtRecord>();
  private full = false;
  private ready: Promise<void>;
  /** Writes run one after another (the index is read and written whole). */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: BufferOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.limit = options.limit ?? TLM_LIMIT;
    this.journals = options.journals ?? memoryJournalStore();
    this.loadIndex();
    this.ready = this.init(options.journals);
  }

  /** The index is loaded and the journal store reconciled with it. */
  whenReady(): Promise<void> { return this.ready; }

  private async init(given: JournalStore | null | undefined): Promise<void> {
    if (given === undefined) {
      const idb = await openIdbJournalStore();
      if (idb) this.journals = idb;
    }
    // Journals the index lists but the store lost (a memory store after a reload, a cleared IndexedDB) leave the index.
    try {
      const keys = new Set(await this.journals.keys());
      const before = this.entries.length;
      this.entries = this.entries.filter(e => e.kind !== 'journal' || keys.has(e.id));
      if (this.entries.length !== before) this.saveIndex();
    } catch { /* the store answers later or never: the entries stay */ }
  }

  private loadIndex(): void {
    try {
      const raw = JSON.parse(this.storage?.getItem(TLM_INDEX_KEY) ?? 'null') as { seq?: number; entries?: IndexEntry[] } | null;
      if (raw && Array.isArray(raw.entries)) {
        this.entries = raw.entries.filter(e => e && typeof e.id === 'string' && typeof e.chars === 'number' && Array.isArray(e.delivered));
        this.seq = Math.max(raw.seq ?? 0, ...this.entries.map(e => e.seq + 1));
      }
    } catch { this.entries = []; }
  }

  private saveIndex(): void {
    try { this.storage?.setItem(TLM_INDEX_KEY, JSON.stringify({ seq: this.seq, entries: this.entries })); } catch { /* the index lives in memory */ }
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  get bufferFull(): boolean { return this.full; }
  get entryList(): readonly IndexEntry[] { return this.entries; }

  stats(activeSinks: readonly string[]): BufferStats {
    let chars = 0, undelivered = 0, notes = 0;
    for (const e of this.entries) {
      chars += e.chars;
      if (e.kind === 'note') notes++;
      if (activeSinks.length ? activeSinks.some(s => !e.delivered.includes(s)) : !e.delivered.length) undelivered++;
    }
    return { records: this.entries.length, chars, undelivered, notes, bufferFull: this.full };
  }

  /** Index entries a sink has not taken, oldest first. */
  pendingFor(sink: string): IndexEntry[] {
    return this.entries.filter(e => !e.delivered.includes(sink)).sort((a, b) => a.seq - b.seq);
  }

  /** Stores a record (the same id replaces the old copy and its delivery marks). */
  put(record: RtRecord): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      const text = JSON.stringify(record), chars = text.length;
      const old = this.entries.find(e => e.id === record.id);
      if (old) await this.drop([old]);
      const fight = 'fight' in record ? record.fight : undefined;
      const entry: IndexEntry = { id: record.id, kind: record.kind, chars, delivered: [], seq: this.seq++, ...fight ? { fight } : {} };
      if (chars > this.limit) { this.toMemory(record, entry); return; }
      await this.evictFor(chars, entry);
      if (record.kind === 'journal') {
        try { await this.journals.put(record.id, record); } catch { this.toMemory(record, entry); return; }
      } else if (!this.storeText(record.id, text, entry)) { this.toMemory(record, entry); return; }
      this.entries.push(entry);
      this.saveIndex();
    });
  }

  private toMemory(record: RtRecord, entry: IndexEntry): void {
    this.memory.set(record.id, record);
    this.entries.push(entry);
    this.full = true;
    this.saveIndex();
  }

  /** `localStorage`: on a quota error evict notes and summaries for the record's size and try once more. */
  private storeText(id: string, text: string, entry: IndexEntry): boolean {
    if (!this.storage) return false;
    try { this.storage.setItem(TLM_PREFIX + id, text); return true; } catch (error) {
      if (!isQuota(error)) return false;
    }
    let freed = 0;
    const victims: IndexEntry[] = [];
    for (const e of [...this.entries].filter(e => e.kind !== 'journal' && !this.memory.has(e.id)).sort((a, b) => rank(a) - rank(b) || a.seq - b.seq)) {
      if (freed >= text.length) break;
      victims.push(e); freed += e.chars;
    }
    void this.drop(victims);
    try { this.storage.setItem(TLM_PREFIX + id, text); return true; } catch { void entry; return false; }
  }

  /** Evicts records so that `chars` more fit the limit. */
  private async evictFor(chars: number, keep: IndexEntry): Promise<void> {
    let total = this.entries.reduce((s, e) => s + e.chars, 0);
    if (total + chars <= this.limit) return;
    const order = [...this.entries].filter(e => e.id !== keep.id).sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
    const victims = new Set<IndexEntry>();
    for (const e of order) {
      if (total + chars <= this.limit) break;
      if (victims.has(e)) continue;
      // The parts of one journal go together.
      const group = e.kind === 'journal' ? this.entries.filter(o => o.kind === 'journal' && o.fight === e.fight) : [e];
      for (const g of group) if (!victims.has(g)) { victims.add(g); total -= g.chars; }
    }
    await this.drop([...victims]);
  }

  private async drop(list: readonly IndexEntry[]): Promise<void> {
    if (!list.length) return;
    const ids = new Set(list.map(e => e.id));
    this.entries = this.entries.filter(e => !ids.has(e.id));
    for (const e of list) {
      this.memory.delete(e.id);
      if (e.kind === 'journal') { try { await this.journals.delete(e.id); } catch { /* gone anyway */ } }
      else { try { this.storage?.removeItem(TLM_PREFIX + e.id); } catch { /* storage optional */ } }
    }
    if (!this.memory.size) this.full = false;
    this.saveIndex();
  }

  async get(id: string): Promise<RtRecord | null> {
    await this.ready;
    const mem = this.memory.get(id);
    if (mem) return mem;
    const entry = this.entries.find(e => e.id === id);
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
    for (const e of [...this.entries].sort((a, b) => a.seq - b.seq)) {
      const r = await this.get(e.id);
      if (r) out.push(r);
    }
    return out;
  }

  /** A sink took this copy of the record (a copy written since keeps its own marks). */
  markDelivered(id: string, sink: string, seq: number): void {
    const e = this.entries.find(o => o.id === id && o.seq === seq);
    if (!e || e.delivered.includes(sink)) return;
    e.delivered.push(sink);
    this.saveIndex();
  }

  /** Removes everything (the «Очистить» button). */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      for (const e of this.entries) if (e.kind !== 'journal') { try { this.storage?.removeItem(TLM_PREFIX + e.id); } catch { /* optional */ } }
      try { await this.journals.clear(); } catch { /* optional */ }
      this.entries = [];
      this.memory.clear();
      this.full = false;
      this.saveIndex();
    });
  }
}
