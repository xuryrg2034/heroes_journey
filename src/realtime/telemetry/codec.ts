/**
 * Track Т0 of the real-time telemetry (docs/realtime-telemetry.md, sections 7 and 8): the lossless journal codec, gzip +
 * base64, cutting a text into parts and assembling it back with a check. No DOM: the same code runs in the browser and in
 * Node (`CompressionStream`, `btoa` and `atob` are globals of both; Node ≥ 18).
 *
 * The codec never rounds: a journal is already JSON (the simulation journals a JSON copy of each command), and a JSON
 * round trip of a double is exact. It only drops what the decoder can restore exactly:
 * - a command is an array `[tick delta, code, …fields]`; the tick is an integer, so its delta is exact;
 * - `sweep` leaves out `fx, fy` when they equal the last pointer point (the view sends the previous pointer as `from`);
 * - `drag` leaves out `mode` when it is `'full'`;
 * - a command of another shape (debug and test commands, a field added later) goes whole: `[dt, 'o', {…}]`;
 * - with `paramsRef` the start Params are left out when their hash is that ref (the run record keeps them once per run);
 *   Params of another hash stay in the journal whole.
 * Every top-level field of the journal other than `params` and `commands` is kept as it is (fields added later too).
 */
import type { Command } from '../sim/commands';
import { hashText } from '../sim/hash';
import type { Params } from '../sim/params';
import type { Journal, JournalEntry } from '../sim/simulation';

/** How a journal text is written: plain JSON of `Journal`, the compact codec, the compact codec gzipped into base64. */
export type JournalEncoding = 'json' | 'compact' | 'compact+gzip+b64';

/** A journal part carries at most this many characters (decision 9: parts are cut by characters). */
export const MAX_PART_CHARS = 200_000;

/** Format tag of a compact journal (the codec's own version). */
const COMPACT_FORMAT = 'rtj1';

/**
 * Canonical JSON: object keys sorted at every depth, arrays in order. Two Params with the same values give the same text
 * whatever the key order they were built with.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

/** Hash of Params (the header's `params.hash`, the journal's ref to the Params of its run record). */
export function paramsHash(params: Params): string { return hashText(canonicalJson(params)); }

// ---- The compact journal ----

type Point = { x: number; y: number } | null;
type Entry = unknown[];

interface CompactJournal {
  f: typeof COMPACT_FORMAT;
  /** The journal without `params` and `commands`. */
  j: Record<string, unknown>;
  /** The start Params (absent when `pr` names them). */
  p?: Params;
  /** The hash of the start Params kept in the run record. */
  pr?: string;
  /** The commands. */
  c: Entry[];
}

const hasExactly = (cmd: object, keys: readonly string[]): boolean => {
  const own = Object.keys(cmd);
  return own.length === keys.length && keys.every(k => own.includes(k));
};
const isNum = (v: unknown): v is number => typeof v === 'number';

/** One command to an array; `last` is the last pointer point (updated by the caller with `pointOf`). */
function encodeCommand(cmd: Command, dt: number, last: Point): Entry {
  const c = cmd as unknown as Record<string, unknown>;
  switch (cmd.t) {
    case 'walk': if (hasExactly(cmd, ['t', 'x', 'y']) && isNum(c.x) && isNum(c.y)) return [dt, 'w', c.x, c.y]; break;
    case 'begin': if (hasExactly(cmd, ['t', 'x', 'y']) && isNum(c.x) && isNum(c.y)) return [dt, 'b', c.x, c.y]; break;
    case 'drag':
      if (hasExactly(cmd, ['t', 'x', 'y', 'mode']) && isNum(c.x) && isNum(c.y) && typeof c.mode === 'string') {
        return c.mode === 'full' ? [dt, 'd', c.x, c.y] : [dt, 'd', c.x, c.y, c.mode];
      }
      break;
    case 'sweep':
      if (hasExactly(cmd, ['t', 'fx', 'fy', 'x', 'y']) && isNum(c.fx) && isNum(c.fy) && isNum(c.x) && isNum(c.y)) {
        return last && last.x === c.fx && last.y === c.fy ? [dt, 's', c.x, c.y] : [dt, 's', c.x, c.y, c.fx, c.fy];
      }
      break;
    case 'release': if (hasExactly(cmd, ['t'])) return [dt, 'r']; break;
    case 'cancel': if (hasExactly(cmd, ['t'])) return [dt, 'c']; break;
    case 'spin': if (hasExactly(cmd, ['t'])) return [dt, 'q']; break;
    case 'jump': if (hasExactly(cmd, ['t', 'x', 'y']) && isNum(c.x) && isNum(c.y)) return [dt, 'j', c.x, c.y]; break;
    case 'item':
      if (hasExactly(cmd, ['t', 'kind', 'x', 'y']) && isNum(c.x) && isNum(c.y) && typeof c.kind === 'string') return [dt, 'i', c.x, c.y, c.kind];
      break;
    default: break;
  }
  return [dt, 'o', cmd];
}

/** The pointer point a command leaves behind (for the `sweep` that follows), or the old one. */
function pointOf(cmd: Command, last: Point): Point {
  switch (cmd.t) {
    case 'begin': case 'drag': case 'sweep': case 'jump': case 'item': return { x: cmd.x, y: cmd.y };
    default: return last;
  }
}

function decodeCommand(e: Entry, last: Point): Command {
  const code = e[1], n = (i: number): number => {
    const v = e[i];
    if (typeof v !== 'number') throw new Error(`compact journal: entry ${JSON.stringify(e)} field ${i} is not a number`);
    return v;
  };
  switch (code) {
    case 'w': return { t: 'walk', x: n(2), y: n(3) };
    case 'b': return { t: 'begin', x: n(2), y: n(3) };
    case 'd': return { t: 'drag', x: n(2), y: n(3), mode: (e.length > 4 ? e[4] : 'full') as Extract<Command, { t: 'drag' }>['mode'] };
    case 's': {
      if (e.length > 4) return { t: 'sweep', fx: n(4), fy: n(5), x: n(2), y: n(3) };
      if (!last) throw new Error('compact journal: a sweep without a point before it');
      return { t: 'sweep', fx: last.x, fy: last.y, x: n(2), y: n(3) };
    }
    case 'r': return { t: 'release' };
    case 'c': return { t: 'cancel' };
    case 'q': return { t: 'spin' };
    case 'j': return { t: 'jump', x: n(2), y: n(3) };
    case 'i': return { t: 'item', kind: e[4] as Extract<Command, { t: 'item' }>['kind'], x: n(2), y: n(3) };
    case 'o': return JSON.parse(JSON.stringify(e[2])) as Command;
    default: throw new Error(`compact journal: unknown code ${JSON.stringify(code)}`);
  }
}

/**
 * The journal as compact JSON. `paramsRef` — the hash of the run's Params (`paramsHash`): when the journal's start Params
 * have this hash they are left out; otherwise they stay whole (the journal decodes without the run record).
 */
export function encodeJournal(journal: Journal, paramsRef?: string): string {
  const { params, commands, ...rest } = journal;
  const out: CompactJournal = { f: COMPACT_FORMAT, j: rest as unknown as Record<string, unknown>, c: [] };
  if (paramsRef !== undefined && paramsHash(params) === paramsRef) out.pr = paramsRef; else out.p = params;
  let tick = 0, last: Point = null;
  for (const { tick: t, cmd } of commands) {
    out.c.push(encodeCommand(cmd, t - tick, last));
    tick = t; last = pointOf(cmd, last);
  }
  return JSON.stringify(out);
}

/**
 * The exact journal back from `encodeJournal` (or from plain JSON of a `Journal`). `params` — the run record's Params,
 * needed when the journal names them by hash; their hash is checked.
 */
export function decodeJournal(text: string, params?: Params): Journal {
  const raw = JSON.parse(text) as Partial<CompactJournal> & Partial<Journal>;
  if (raw.f !== COMPACT_FORMAT) {
    if (Array.isArray(raw.commands) && raw.params) return raw as Journal;
    throw new Error('not a journal: neither the compact format nor plain JSON');
  }
  let start: Params;
  if (raw.p) start = raw.p;
  else {
    if (!params) throw new Error(`the journal names its Params by hash ${raw.pr}: pass the Params of the run record`);
    const h = paramsHash(params);
    if (h !== raw.pr) throw new Error(`the Params passed have hash ${h}, the journal names ${raw.pr}`);
    start = JSON.parse(JSON.stringify(params)) as Params;
  }
  const commands: JournalEntry[] = [];
  let tick = 0, last: Point = null;
  for (const e of raw.c ?? []) {
    if (!Array.isArray(e) || typeof e[0] !== 'number') throw new Error(`compact journal: bad entry ${JSON.stringify(e)}`);
    tick += e[0];
    const cmd = decodeCommand(e, last);
    commands.push({ tick, cmd });
    last = pointOf(cmd, last);
  }
  // The field order of `Simulation.exportJournal`: version, seed, arena, params, ticks, commands, then the optional ones.
  const { version, seed, arena, ticks, ...optional } = raw.j as Record<string, unknown>;
  return { version, seed, arena, params: start, ticks, commands, ...optional } as Journal;
}

// ---- gzip + base64 ----

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A text gzipped (`CompressionStream`) and written in base64. */
export async function gzipBase64(text: string): Promise<string> {
  return bytesToBase64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
}

/** The text back from `gzipBase64`. */
export async function gunzipBase64(text: string): Promise<string> {
  return new TextDecoder().decode(await pipe(base64ToBytes(text), new DecompressionStream('gzip')));
}

// ---- Parts ----

/** What the fight record keeps of its journal: the number of parts, the length and the digest of the assembled text. */
export interface JournalMeta { parts: number; chars: number; digest: string; encoding: JournalEncoding }

/**
 * A text cut into parts of at most `max` characters (by characters, decision 9). A cut never falls inside a surrogate
 * pair. An empty text is one empty part.
 */
export function splitParts(text: string, max = MAX_PART_CHARS): string[] {
  if (!(max >= 2)) throw new Error(`part size ${max}: at least 2`);
  const parts: string[] = [];
  let at = 0;
  do {
    let end = Math.min(text.length, at + max);
    if (end < text.length) {
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    parts.push(text.slice(at, end));
    at = end;
  } while (at < text.length);
  return parts;
}

/** The text back from its parts; the number of parts, the length and the digest are checked against `meta`. */
export function assembleParts(parts: readonly string[], meta: Pick<JournalMeta, 'parts' | 'chars' | 'digest'>): string {
  if (parts.length !== meta.parts) throw new Error(`journal: ${parts.length} parts, the record says ${meta.parts}`);
  const text = parts.join('');
  if (text.length !== meta.chars) throw new Error(`journal: ${text.length} characters, the record says ${meta.chars}`);
  const digest = hashText(text);
  if (digest !== meta.digest) throw new Error(`journal: digest ${digest}, the record says ${meta.digest}`);
  return text;
}

/** A packed journal: the parts and what the fight record keeps of them. */
export interface PackedJournal { parts: string[]; meta: JournalMeta }

/** The journal encoded (`'compact+gzip+b64'` by default), cut into parts, with its meta. */
export async function packJournal(journal: Journal, options: { paramsRef?: string; encoding?: JournalEncoding; max?: number } = {}): Promise<PackedJournal> {
  const encoding = options.encoding ?? 'compact+gzip+b64';
  const text = encoding === 'json' ? JSON.stringify(journal)
    : encoding === 'compact' ? encodeJournal(journal, options.paramsRef)
    : await gzipBase64(encodeJournal(journal, options.paramsRef));
  const parts = splitParts(text, options.max);
  return { parts, meta: { parts: parts.length, chars: text.length, digest: hashText(text), encoding } };
}

/** The journal back from its parts (in order) and meta; `params` — the run record's Params when the journal names them by hash. */
export async function unpackJournal(parts: readonly string[], meta: JournalMeta, params?: Params): Promise<Journal> {
  const text = assembleParts(parts, meta);
  if (meta.encoding === 'json') return decodeJournal(text, params);
  if (meta.encoding === 'compact') return decodeJournal(text, params);
  if (meta.encoding === 'compact+gzip+b64') return decodeJournal(await gunzipBase64(text), params);
  throw new Error(`journal: unknown encoding ${String(meta.encoding)}`);
}
