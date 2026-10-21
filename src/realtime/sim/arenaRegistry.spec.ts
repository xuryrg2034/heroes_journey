/**
 * Task 59а (review of ui, 21.10.2026): every arena a journal may name is known to a bare `replay` — sim/simulation.ts alone, no view and
 * no run module (the probes of step 3 and the warm-up registered only through view/main.ts and run/warmup.ts). This process loads every
 * `sim/arenas*.ts` and records a short fight on each registered arena; a fresh Node process that imports only sim/simulation.ts lists its
 * registry and replays every journal — the lists are equal, every hash the same. Node only: `npm run test:realtime-arena-registry`.
 */
// @ts-expect-error node modules have no declarations here
import { spawnSync } from 'node:child_process';
// @ts-expect-error node modules have no declarations here
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
// @ts-expect-error node modules have no declarations here
import { tmpdir } from 'node:os';
// @ts-expect-error node modules have no declarations here
import { dirname, join } from 'node:path';
// @ts-expect-error node modules have no declarations here
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registeredArenas } from './arenas';
import { defaultParams } from './params';
import { Simulation } from './simulation';

declare const process: { execPath: string };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const here: string = dirname(fileURLToPath(import.meta.url));
const arenaFiles: string[] = readdirSync(here).filter((f: string) => /^arenas.*[.]ts$/.test(f) && !f.endsWith('.spec.ts'));
for (const file of arenaFiles) await import(pathToFileURL(join(here, file)).href);

check('a fresh process with sim/simulation.ts alone knows every arena of sim/arenas*.ts and replays a short fight on each to the same hash', () => {
  const fights = registeredArenas().map(arena => {
    const sim = new Simulation({ arena: arena.id, params: defaultParams(), seed: Math.imul(arena.id.length, 2654435761) >>> 0, record: true });
    for (let i = 0; i < 30; i++) sim.tick();
    return { id: arena.id, journal: sim.exportJournal(), hash: sim.hash() };
  });
  const dir: string = mkdtempSync(join(tmpdir(), 'arena-registry-'));
  const data: string = join(dir, 'fights.json'), child: string = join(dir, 'child.mts');
  writeFileSync(data, JSON.stringify(fights));
  writeFileSync(child, [
    `import { registeredArenas } from ${JSON.stringify(pathToFileURL(join(here, 'arenas.ts')).href)};`,
    `import { replay } from ${JSON.stringify(pathToFileURL(join(here, 'simulation.ts')).href)};`,
    `import { readFileSync } from 'node:fs';`,
    `const fights = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8'));`,
    `const hashes = fights.map(f => { try { return replay(f.journal).hash(); } catch (e) { return 'error: ' + e.message; } });`,
    `console.log(JSON.stringify({ ids: registeredArenas().map(a => a.id), hashes }));`,
  ].join('\n'));
  const run = spawnSync(process.execPath, ['--import', 'tsx', child], { encoding: 'utf-8' });
  assert(run.status === 0, `the bare process failed: ${run.stderr}`);
  const out = JSON.parse(String(run.stdout).trim().split('\n').pop() ?? '{}') as { ids: string[]; hashes: string[] };
  const missing = fights.map(f => f.id).filter(id => !out.ids.includes(id));
  assert(!missing.length, `arenas unknown to a bare replay (import them in sim/simulation.ts): ${missing.join(', ')}`);
  const bad = fights.flatMap((f, i) => (out.hashes[i] !== f.hash ? [`${f.id}: ${out.hashes[i]}`] : []));
  assert(!bad.length, `journals that do not replay in a bare process: ${bad.join('; ')}`);
  console.log(`   ${fights.length} arenas of ${arenaFiles.length} modules`);
});

console.log(`arena registry: ${checks} checks passed`);
