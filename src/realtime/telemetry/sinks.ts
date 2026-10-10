/**
 * Track ТA of the real-time telemetry (docs/realtime-telemetry.md, section 4): the sinks and the delivery queue.
 *
 * - The artifact sink — `window.__rtTelemetrySink` (`RtTelemetrySink`), looked up lazily before every send.
 * - The dev-server sink — POST `/__rt-telemetry` (track ТC); only under `import.meta.env.DEV` and only when GET answered
 *   `{ok: true}` (asked once per page).
 * - The queue sends one record at a time, oldest first, to every sink present; a sink that took a record marks it in the
 *   buffer. A failed write keeps the record and retries that sink after 1 s, doubling up to 30 s over failures in a row
 *   (a write that went through resets the pause to 1 s). It runs on page load,
 *   after every write and when a sink appears. A sink's error never reaches the game.
 */
import type { TelemetryBuffer } from './buffer';
import type { RtRecord, RtTelemetrySink, RtTelemetryWindow } from './schema';

export const DEV_SINK_PATH = '/__rt-telemetry';
export const RETRY_FIRST_MS = 1000;
export const RETRY_MAX_MS = 30_000;

/** A sink that may or may not be there right now. */
export interface SinkSource {
  /** The name the delivery marks use. */
  readonly name: string;
  /** The sink now, or null when it is absent. */
  get(): Promise<RtTelemetrySink | null>;
  /** Cheap check without waiting (the panel's «undelivered» count). */
  present(): boolean;
}

/** `window.__rtTelemetrySink`, read lazily. */
export function artifactSource(win: RtTelemetryWindow): SinkSource {
  return {
    name: 'artifact',
    async get() { const s = win.__rtTelemetrySink; return s && typeof s.write === 'function' ? s : null; },
    present() { const s = win.__rtTelemetrySink; return !!s && typeof s.write === 'function'; },
  };
}

/** The dev-server receiver (track ТC): GET once; when it answers ok — POST every record. */
export function devSource(fetchFn: typeof fetch, base = ''): SinkSource {
  let probe: Promise<boolean> | null = null, ok = false;
  const sink: RtTelemetrySink = {
    name: 'dev',
    async write(record: RtRecord) {
      const res = await fetchFn(`${base}${DEV_SINK_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
      if (!res.ok) throw new Error(`dev sink: ${res.status}`);
    },
  };
  return {
    name: 'dev',
    async get() {
      probe ??= fetchFn(`${base}${DEV_SINK_PATH}`).then(async r => r.ok && (await r.json() as { ok?: boolean }).ok === true).catch(() => false);
      ok = await probe;
      return ok ? sink : null;
    },
    present() { return ok; },
  };
}

/** A write that hangs this long counts as failed (the queue must not stall behind it). */
export const WRITE_TIMEOUT_MS = 20_000;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sink write timed out')), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

export interface QueueTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  now(): number;
}

/** Sends the buffer's records to every sink present, one at a time. */
export class DeliveryQueue {
  private running = false;
  private again = false;
  private readonly retry = new Map<string, { at: number; delay: number }>();
  /** When the pending retry timer fires (null — none). */
  private timerAt: number | null = null;
  /** Writes done and failed (diagnostics, tests). */
  sent = 0;
  failed = 0;

  constructor(private readonly buffer: TelemetryBuffer, private readonly sources: readonly SinkSource[], private readonly timers: QueueTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), now: () => Date.now() }) {}

  /** Names of the sinks present now. */
  activeNames(): string[] { return this.sources.filter(s => s.present()).map(s => s.name); }

  /** Runs the queue (again, if it is running now). Never rejects. */
  kick(): Promise<void> {
    if (this.running) { this.again = true; return Promise.resolve(); }
    this.running = true;
    return this.run().catch(() => undefined).finally(() => {
      this.running = false;
      if (this.again) { this.again = false; void this.kick(); }
    });
  }

  private async run(): Promise<void> {
    await this.buffer.whenReady();
    for (const source of this.sources) {
      const wait = this.retry.get(source.name);
      if (wait && wait.at > this.timers.now()) { this.schedule(wait.at - this.timers.now()); continue; }
      let sink: RtTelemetrySink | null = null;
      try { sink = await source.get(); } catch { sink = null; }
      if (!sink) continue;
      for (const entry of this.buffer.pendingFor(source.name)) {
        const record = await this.buffer.get(entry.id);
        if (!record) continue;
        try {
          await withTimeout(sink.write(record), WRITE_TIMEOUT_MS);
        } catch {
          this.failed++;
          // The pause doubles only over failures in a row: a write that went through since resets it to 1 s.
          const last = this.retry.get(source.name);
          const delay = Math.min(RETRY_MAX_MS, last ? last.delay * 2 : RETRY_FIRST_MS);
          this.retry.set(source.name, { at: this.timers.now() + delay, delay });
          this.schedule(delay);
          break;
        }
        this.sent++;
        this.retry.delete(source.name);
        this.buffer.markDelivered(entry.id, source.name, entry.seq);
      }
    }
  }

  private schedule(ms: number): void {
    const at = this.timers.now() + ms;
    if (this.timerAt !== null && this.timerAt <= at) return;
    this.timerAt = at;
    this.timers.setTimeout(() => { if (this.timerAt === at) this.timerAt = null; void this.kick(); }, ms);
  }
}
