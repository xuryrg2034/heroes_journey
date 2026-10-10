/**
 * Dev-server telemetry receiver (docs/realtime-telemetry.md, section 8, ТC): `npm run test:realtime-telemetry-plugin`.
 * A real Vite dev server runs in a temp folder; the checks send records over HTTP and look at the files that appear
 * (or do not): good record, overwrite, bad ids, wrong type, big body, foreign Origin. Address rules are a pure function.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { allowedAddress, RECORD_ID_RE as PLUGIN_ID_RE, recordFile, rtTelemetryPlugin } from '../vite/rtTelemetryPlugin';
import { RECORD_ID_RE } from '../src/realtime/telemetry/schema';

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  checks += 1;
}

// --- address rules (pure) ---
for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
  assert(allowedAddress(a, false), `${a} is loopback`);
  assert(allowedAddress(a, true), `${a} is loopback with lan`);
}
assert(PLUGIN_ID_RE.source === RECORD_ID_RE.source, 'the plugin checks ids by the rule of the telemetry schema');
const lanOnly = ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.20', '::ffff:192.168.0.5'];
for (const a of lanOnly) {
  assert(!allowedAddress(a, false), `${a} refused by default`);
  assert(allowedAddress(a, true), `${a} allowed with lan`);
}
for (const a of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '10.0.0.256', '2001:db8::1', 'fe80::1', '']) {
  assert(!allowedAddress(a, true), `${a} refused even with lan`);
}
assert(!allowedAddress(undefined, true), 'no address is refused');
assert(recordFile('/x/logs', ['s', 'r', 'run']) === '/x/logs/s/r/run.json', 'file of a 3-segment id');
assert(recordFile('/x/logs', ['s', 'r', 'f03', 'fight']) === '/x/logs/s/r/f03-fight.json', 'file of a 4-segment id');
assert(recordFile('/x/logs', ['..', 'r', 'run']) === null, 'a ".." segment leaves the base');

// --- server ---
interface Reply { status: number; body: string }
function send(port: number, method: string, headers: Record<string, string>, body?: string | Buffer): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path: '/__rt-telemetry', method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end(body);
  });
}
const post = (port: number, record: unknown, extra: Record<string, string> = {}) =>
  send(port, 'POST', { 'Content-Type': 'application/json', ...extra }, typeof record === 'string' ? record : JSON.stringify(record));

const root = mkdtempSync(join(tmpdir(), 'rt-telemetry-'));
const logDir = join(root, 'playtest-logs');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  plugins: [rtTelemetryPlugin({ logDir, lan: false })],
  server: { host: '127.0.0.1', port: 4665, strictPort: false },
});
const warn = console.warn;
console.warn = () => undefined; // refusals are expected; the plugin logs one line each
try {
  await server.listen();
  const port = (server.httpServer!.address() as AddressInfo).port;
  const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);

  const probe = await send(port, 'GET', {});
  assert(probe.status === 200 && JSON.parse(probe.body).ok === true && JSON.parse(probe.body).lan === false, 'GET reports the receiver and lan=false');

  // good records
  const run = { id: 's1/r1/run', kind: 'run', n: 1 };
  assert((await post(port, run)).status === 204, 'a good run record is accepted');
  assert(JSON.parse(readFileSync(join(logDir, 's1/r1/run.json'), 'utf8')).n === 1, 'run.json holds the record');
  assert((await post(port, { ...run, n: 2 })).status === 204, 'the same id again is accepted');
  assert(JSON.parse(readFileSync(join(logDir, 's1/r1/run.json'), 'utf8')).n === 2, 'the same id overwrites');
  assert((await post(port, { id: 's1/r1/f03-n5a-a1/fight', kind: 'fight' }, { Origin: `http://127.0.0.1:${port}` })).status === 204, 'a fight record with own Origin');
  assert(existsSync(join(logDir, 's1/r1/f03-n5a-a1-fight.json')), 'the fight file name joins the rest with "-"');
  assert(files(join(logDir, 's1/r1')).join() === 'f03-n5a-a1-fight.json,run.json', 'no temp files are left');

  // bad ids: 400 and no new file anywhere under the temp root
  const before = JSON.stringify(files(logDir));
  const longSegment = 'a'.repeat(65);
  for (const id of ['../r/run', 's1/../../x', 'a/../../x', 's1/r1', 's1/r1/a/b/c', `s1/r1/${longSegment}`, 's1//run', 's1/r 1/run', 's1/r1/run.json', '/s1/r1/run', '', 7, null]) {
    const r = await post(port, { id, kind: 'run' });
    assert(r.status === 400, `bad id ${JSON.stringify(id)} gives 400 (got ${r.status})`);
  }
  assert((await post(port, { kind: 'run' })).status === 400, 'a record without id is 400');
  assert((await post(port, { id: 's1/r1/x' })).status === 400, 'a record without kind is 400');
  assert((await post(port, [1, 2])).status === 400, 'an array is not a record');
  assert(JSON.stringify(files(logDir)) === before, 'bad ids create no folder');
  assert(!existsSync(join(root, 'x')) && !existsSync(join(root, '..', 'x.json')), 'nothing is written outside the base');

  // not JSON / wrong type
  assert((await post(port, '{oops')).status === 400, 'broken JSON is 400');
  assert((await send(port, 'POST', { 'Content-Type': 'text/plain' }, JSON.stringify(run))).status === 415, 'text/plain is 415');
  assert((await send(port, 'POST', {}, JSON.stringify(run))).status === 415, 'no content type is 415');
  assert((await send(port, 'POST', { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ ...run, id: 's2/r1/run' }))).status === 204, 'a charset parameter is fine');

  // size
  const big = JSON.stringify({ id: 's3/r1/run', kind: 'run', pad: 'x'.repeat(512 * 1024) });
  assert((await post(port, big)).status === 413, 'a body over 512 KiB is 413');
  assert(!existsSync(join(logDir, 's3')), 'an oversized record leaves no file');
  const nearLimit = JSON.stringify({ id: 's3/r1/run', kind: 'run', pad: 'x'.repeat(500 * 1024) });
  assert((await post(port, nearLimit)).status === 204, 'a body under the limit is accepted');

  // origin
  const foreign = await post(port, { id: 's4/r1/run', kind: 'run' }, { Origin: 'http://evil.example' });
  assert(foreign.status === 403, 'a foreign Origin is 403');
  assert((await post(port, { id: 's4/r1/run', kind: 'run' }, { Origin: 'null' })).status === 403, 'Origin "null" is 403');
  assert(!existsSync(join(logDir, 's4')), 'a refused Origin leaves no file');

  // other methods and paths
  assert((await send(port, 'PUT', { 'Content-Type': 'application/json' }, '{}')).status === 400, 'PUT is refused');
} finally {
  console.warn = warn;
  await server.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(`rt-telemetry-plugin: ${checks} checks passed`);
