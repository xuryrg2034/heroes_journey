/**
 * Task 51з «Поход дня» (view): the one place of the run's steps and the session's memory. Node only: `npm run test:realtime-daily-view`.
 * The end-to-end result (the button, the run, the proof saved and checked) is tests/realtime-daily.spec.ts.
 * - A step the view skips makes the proof fail, so the source of RunView is read: every step function of the core (`RT_STEP_FNS`) is made
 *   through `this.go(...)`, and no run step is applied outside it.
 * - The session (the steps, the fights' journals) survives a reload; a missing journal marks it `broken` (no proof).
 */
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';
import { RT_STEP_FNS } from '../run/rtDaily';
import type { Journal } from '../sim/simulation';
import { DailySessionStore, type DailySession } from './dailyView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

const source: string = readFileSync(new URL('./runView.ts', import.meta.url), 'utf8');
/** The source without block and line comments (a comment may name a function). */
const code = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const lines = code.split('\n');
const STEP_NAMES: string[] = [...RT_STEP_FNS, 'rtMeetDeal', 'rtShopReroll', 'rtShopSwap'];

check('every step of the core is made through RunView.go', () => {
  for (const fn of RT_STEP_FNS) assert(code.includes(`'${fn}'`) && lines.some(line => line.includes('this.go(') && line.includes(`'${fn}'`)), `${fn} is not made through this.go`);
});

check('no run step is made outside go (a call of a step function is only the closure `direct` of go)', () => {
  const direct: string[] = [];
  lines.forEach((line, i) => {
    if (/^\s*import/.test(line) || /^\s+\w+, .*type Rt/.test(line)) return;
    for (const name of STEP_NAMES) {
      for (let at = line.indexOf(`${name}(`); at >= 0; at = line.indexOf(`${name}(`, at + 1)) {
        const before = line.slice(0, at);
        if (/function\s+$/.test(before) || before.endsWith('=> ') || before.endsWith("'")) continue;
        direct.push(`${i + 1}: ${name}`);
      }
    }
  });
  assert(direct.length === 0, `step calls outside go: ${direct.join(', ')}`);
});

check('the session: steps and journals come back after a reload; a missing journal marks it broken', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null };
  const sessions = new DailySessionStore(store);
  assert(sessions.load() === null, 'a fresh store has no session');
  const journal = { version: 1, commands: [] } as unknown as Journal;
  const session: DailySession = { date: '2026-10-20', attempt: 2, steps: [{ fn: 'rtChooseHabit', args: [null] }, { fn: 'resolveArena', args: [{ nodeId: 'n1' }] }], journals: [journal], broken: false };
  sessions.save(session, true);
  const back = sessions.load()!;
  assert(back.date === '2026-10-20' && back.attempt === 2 && back.steps.length === 2 && back.journals.length === 1 && !back.broken, 'the session round-trips');
  sessions.save({ ...session, journals: [] }, true);
  assert(sessions.load()!.broken, 'a fight step with no journal: broken');
  sessions.clear();
  assert(sessions.load() === null && data.size === 0, 'cleared');
});
