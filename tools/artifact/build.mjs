// Builds the playtest artifact page from the current tree (tools/artifact/README.md).
// Output (tools/artifact/out or $ARTIFACT_OUT): realtime.js, realtime.css, prototype.html (publish), local-test.html (smoke checks).
// Usage: node tools/artifact/build.mjs [--no-telemetry]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..');
const out = process.env.ARTIFACT_OUT || join(here, 'out');
const telemetry = !process.argv.includes('--no-telemetry');
const run = cmd => execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

const rev = run('git rev-parse --short HEAD');
if (run('git status --porcelain')) console.warn(`warning: the tree has local changes; the page says ${rev}, the code is not ${rev}`);
execSync(`npx vite build -c "${join(here, 'vite.artifact.config.mjs')}"`, {
  cwd: repo, stdio: 'inherit', env: { ...process.env, RT_BUILD: rev, ARTIFACT_OUT: out },
});

// Telemetry channels of the artifact page (docs/realtime-telemetry.md): installed only when this view can use them.
const sink = `<script>
(() => {
  const use = name => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
  const toPath = id => 'telemetry/' + String(id).replace(/\\//g, '__');
  Promise.all([use('db'), use('user')]).then(async ([db, user]) => {
    if (!db) return;
    let canWrite = null;
    try { canWrite = user ? await user.can('data.write') : null; } catch { canWrite = null; }
    if (canWrite === false) return;
    window.__rtTelemetrySink = {
      async write(record) {
        try { await db.doc(toPath(record.id)).set(record); }
        catch (e) {
          // No write level for this viewer: stop sending; the game keeps its browser buffer and «Экспорт».
          if (e && e.code === 'invalid_argument' && canWrite === null) delete window.__rtTelemetrySink;
          throw e;
        }
      },
    };
  });
  use('downloads').then(downloads => {
    if (!downloads) return;
    window.__rtTelemetryExport = async (filename, text) => {
      await downloads.save({ filename, data: new Blob([text], { type: 'application/json' }) });
    };
  });
})();
</script>
`;
const css = readFileSync(join(out, 'realtime.css'), 'utf8');
const head = '<title>Прототип Ashen Oath</title>\n<style>\n:root { color-scheme: dark; }\n' + css + '</style>\n<div id="rt-app"></div>\n';
const tail = '<script src="https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.min.js"></script>\n<script src="./realtime.js"></script>\n';
writeFileSync(join(out, 'prototype.html'), head + (telemetry ? sink : '') + tail);
writeFileSync(join(out, 'local-test.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' + head + tail);
console.log(`built ${rev} → ${out}`);
