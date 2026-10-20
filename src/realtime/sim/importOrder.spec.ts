/**
 * Task 57а (ui report 17.10.2026: the page fell with «Cannot access 'shooters' before initialization»): every module of the simulation
 * that registers or reads a registry at its load must work when it is the FIRST module imported — the view imports them in its own
 * order (a cycle shots ⇄ enemies broke it). Each module below is imported first in a fresh Node process. Node only:
 * `npm run test:realtime-import-order`.
 */
// @ts-expect-error node modules have no declarations here
import { spawnSync } from 'node:child_process';
// @ts-expect-error node modules have no declarations here
import { readdirSync } from 'node:fs';
// @ts-expect-error node modules have no declarations here
import { dirname, join } from 'node:path';
// @ts-expect-error node modules have no declarations here
import { fileURLToPath, pathToFileURL } from 'node:url';

declare const process: { execPath: string };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const here = dirname(fileURLToPath(import.meta.url));
const plain = (f: string): boolean => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.testkit.ts');
// The registries' modules and every kind (they register at load), the world and the runner.
const modules = [
  ...['shots.ts', 'shooterRegistry.ts', 'world.ts', 'chain.ts', 'simulation.ts', 'hash.ts', 'items.ts', 'spawn.ts'].map(f => join(here, f)),
  ...readdirSync(join(here, 'enemies')).filter(plain).map((f: string) => join(here, 'enemies', f)),
];
const failed: string[] = [];
for (const file of modules) {
  const run = spawnSync(process.execPath, ['--import', 'tsx', '-e', `import(${JSON.stringify(pathToFileURL(file).href)}).catch(e => { console.error(String(e)); process.exit(1); })`], { encoding: 'utf-8' });
  if (run.status !== 0) failed.push(`${file.slice(here.length + 1)}: ${(run.stderr || run.stdout).split('\n').find((l: string) => /Error/.test(l)) ?? run.stderr}`);
}
assert(!failed.length, `imported first, these modules fail:\n${failed.join('\n')}`);
console.log(`ok - ${modules.length} modules of the simulation load when imported first`);
console.log('import order: 1 check passed');
