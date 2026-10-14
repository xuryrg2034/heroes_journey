// Smoke checks of the built artifact page (tools/artifact/README.md): a static server on 127.0.0.1:8799
// serves the build output, each script in checks/ drives local-test.html with Playwright and prints one JSON line.
// Usage: node tools/artifact/smoke.mjs [shotsDir]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.ARTIFACT_OUT || join(here, 'out');
const shots = process.argv[2] || join(out, 'shots');
mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = createServer((req, res) => {
  const file = normalize(join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!file.startsWith(normalize(out)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(ok => server.listen(8799, '127.0.0.1', ok));

const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
let failed = 0;
for (const f of readdirSync(join(here, 'checks')).filter(n => n.endsWith('.mjs')).sort()) {
  // async child: the server in this process must keep answering while the check runs
  const { code, text } = await new Promise(done => {
    const child = spawn(process.execPath, [join(here, 'checks', f), shots], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', d => { text += d; });
    child.on('close', code => done({ code, text: text.trim() }));
  });
  console.log(`${f}: ${text}`);
  let errs = [];
  try { errs = JSON.parse(text.split('\n').pop()).errs || []; } catch { errs = ['no JSON line']; }
  if (code !== 0 || errs.length) failed++;
}
server.close();
console.log(failed ? `${failed} check(s) failed (exit code or page errors)` : `all checks clean; shots in ${shots}`);
process.exit(failed ? 1 : 0);
