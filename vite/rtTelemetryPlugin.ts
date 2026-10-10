// Dev-server receiver of real-time playtest telemetry (docs/realtime-telemetry.md, sections 4 and 7).
// POST /__rt-telemetry writes one record to playtest-logs/<session>/<run>/<rest joined by '-'>.json.
// Serve only: the plugin is not part of `vite build`.
import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const RT_TELEMETRY_PATH = '/__rt-telemetry';
export const RT_TELEMETRY_MAX_BODY = 512 * 1024;
// Own copy of the id check; the schema in src/realtime/telemetry/schema.ts has the same rule.
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export interface RtTelemetryOptions {
  /** Folder for the logs. Default: `<vite root>/playtest-logs`. */
  logDir?: string;
  /** Allow private LAN clients. Default: env RT_TELEMETRY_LAN === '1'. */
  lan?: boolean;
}

/** Loopback always; private networks 10/8, 172.16/12, 192.168/16 only with `lan`. */
export function allowedAddress(addr: string | undefined, lan: boolean): boolean {
  if (!addr) return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  if (a === '::1' || a === '127.0.0.1') return true;
  if (!lan) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

/** Splits and checks a record id; returns the segments or null. */
export function parseRecordId(id: unknown): string[] | null {
  if (typeof id !== 'string') return null;
  const parts = id.split('/');
  if (parts.length < 3 || parts.length > 4) return null;
  return parts.every((p) => SEGMENT.test(p)) ? parts : null;
}

/** Target file of a record id inside `base`, or null when it would leave `base`. */
export function recordFile(base: string, parts: string[]): string | null {
  const root = resolve(base);
  const file = resolve(root, parts[0], parts[1], `${parts.slice(2).join('-')}.json`);
  return file.startsWith(root + sep) ? file : null;
}

function reply(res: ServerResponse, code: number, body?: string): void {
  res.statusCode = code;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

function refuse(req: IncomingMessage, res: ServerResponse, code: number, reason: string): void {
  console.warn(`[rt-telemetry] ${code} ${reason} (${req.socket.remoteAddress ?? '?'})`);
  reply(res, code, JSON.stringify({ ok: false, error: reason }));
}

function readBody(req: IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > RT_TELEMETRY_MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(c);
      }
    });
    req.on('end', () => done({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', fail);
  });
}

export function rtTelemetryPlugin(options: RtTelemetryOptions = {}): Plugin {
  const lan = options.lan ?? process.env.RT_TELEMETRY_LAN === '1';
  return {
    name: 'rt-telemetry',
    apply: 'serve',
    configureServer(server) {
      const base = resolve(options.logDir ?? resolve(server.config.root, 'playtest-logs'));
      server.middlewares.use(RT_TELEMETRY_PATH, (req, res, next) => {
        const rest = req.url ?? '/';
        if (rest !== '/' && !rest.startsWith('?') && !rest.startsWith('/?')) {
          next();
          return;
        }
        handle(req, res, base, lan).catch((e: unknown) => {
          console.warn(`[rt-telemetry] 500 ${e instanceof Error ? e.message : String(e)}`);
          if (!res.headersSent) reply(res, 500, JSON.stringify({ ok: false, error: 'write failed' }));
          else res.end();
        });
      });
    },
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, base: string, lan: boolean): Promise<void> {
  if (!allowedAddress(req.socket.remoteAddress, lan)) return refuse(req, res, 403, 'address not allowed');
  if (req.method === 'GET') return reply(res, 200, JSON.stringify({ ok: true, lan }));
  if (req.method !== 'POST') return refuse(req, res, 400, 'method');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* a bad origin stays null */
    }
    if (originHost === null || originHost !== req.headers.host) return refuse(req, res, 403, 'origin');
  }
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return refuse(req, res, 415, 'content-type');
  const declared = Number(req.headers['content-length'] ?? 0);
  const { text, tooLarge } = await readBody(req);
  if (tooLarge || declared > RT_TELEMETRY_MAX_BODY) return refuse(req, res, 413, 'body too large');
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return refuse(req, res, 400, 'bad json');
  }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return refuse(req, res, 400, 'record');
  const { id, kind } = record as { id?: unknown; kind?: unknown };
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > 32) return refuse(req, res, 400, 'kind');
  const parts = parseRecordId(id);
  if (!parts) return refuse(req, res, 400, 'id');
  const file = recordFile(base, parts);
  if (!file) return refuse(req, res, 400, 'id path');
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  reply(res, 204);
}
