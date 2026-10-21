/**
 * Task 51з «Поход дня» (docs/design-notes/task-51-camp-l3.md, 6.3): the check of a proof file in Node — `npm run realtime:daily-check
 * <daily-ГГГГ-ММ-ДД.json>` (`--build <id>` — check as that build; default — this working copy's build, as vite.config.ts makes it:
 * the short commit, `+dirty` with local changes). The run is made again from the date and the preset, every step applied, every fight's
 * journal replayed to its outcome (run/rtDaily.ts `checkDailyProof`). Prints «Проверено» and the outcome, «Другая версия игры», or the
 * reason; exit code 1 unless checked.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkDailyProof, rtDailyClaimText } from '../src/realtime/run/rtDaily';

const args = process.argv.slice(2);
const at = args.indexOf('--build'), file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--build');
function buildId(): string {
  try {
    const run = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const head = run('git rev-parse --short HEAD');
    return run('git status --porcelain') ? `${head}+dirty` : head;
  } catch { return 'unknown'; }
}
if (!file) { console.error('usage: npm run realtime:daily-check <daily-ГГГГ-ММ-ДД.json> [--build <id>]'); process.exit(2); }
const build = at >= 0 ? args[at + 1] : buildId();
const result = await checkDailyProof(JSON.parse(readFileSync(file, 'utf8')) as unknown, build);
if (result.ok) console.log(`Проверено: ${rtDailyClaimText(result.claim)}${result.claim.done ? '' : ' (поход не закончен)'}, боёв ${result.fights} (сборка ${build})`);
else console.log(result.otherBuild ? `Другая версия игры (файл — другая сборка, эта — ${build})` : `Не проверено: ${result.reason}`);
process.exit(result.ok ? 0 : 1);
