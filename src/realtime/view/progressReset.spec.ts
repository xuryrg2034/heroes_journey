/**
 * «Сбросить прогресс» (view/progressReset.ts, user request 22.10.2026) on a plain-object storage: a profile and a run built by the
 * real stores go, the settings and the telemetry stay, and the stores then read as a first-time player's. Every storage key the
 * game's code names is either progress or kept on purpose, so a new key needs a decision here. Node only:
 * `npm run test:realtime-progress-reset`. The button in the gear is tests/realtime-progress-reset.spec.ts.
 */
import './nodeNavigator.testkit';
import { createRtRun } from '../run/rtRun';
import { createRtProfileStore, createRtRunStore, emptyRtProfile, RT_PROFILE_STORAGE_KEY, RT_RUN_STORAGE_KEY } from '../run/rtRunStorage';
import { TLM_PREFIX } from '../telemetry/buffer';
import { PARAMS_STORAGE_KEY } from './paramStorage';
import { PROLOGUE_KEY } from './prologueFlow';
import { SESSION_STORAGE_KEY } from './session';
import { PROGRESS_KEYS, resetProgress } from './progressReset';

// Node's file system, loaded by name: the project's typecheck has no Node types under src/ (as sim/detMath.spec.ts).
interface NodeFs { readdirSync(path: string): string[]; readFileSync(path: string, encoding: 'utf8'): string; statSync(path: string): { isDirectory(): boolean } }
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ name);
const { readdirSync, readFileSync, statSync } = await nodeModule('node:fs') as NodeFs;
const { fileURLToPath } = await nodeModule('node:url') as { fileURLToPath(url: URL): string };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data, get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); },
  };
}

// 1. A played profile and an open run go; the settings, the session clock and the telemetry stay.
{
  const storage = memoryStorage();
  const profile = createRtProfileStore(storage), runs = createRtRunStore(storage);
  profile.startRun();
  profile.endRun({ reachedJailer: true, seeded: false, won: true });
  assert(runs.save(createRtRun(Math.imul(1, 2654435761) >>> 0)), 'the run is saved');
  for (const key of PROGRESS_KEYS) if (!storage.data.has(key)) storage.setItem(key, '1');
  const kept: Record<string, string> = {
    [PARAMS_STORAGE_KEY]: '{}', 'ashen-oath-realtime-sound': '{"on":true,"volume":0.4}', 'ashen-oath-realtime-fx': '50',
    'ashen-oath-realtime-hints-on': '0', [SESSION_STORAGE_KEY]: '{}', [`${TLM_PREFIX}fight-1`]: '{}', 'other-site-key': 'x',
  };
  for (const [k, v] of Object.entries(kept)) storage.setItem(k, v);
  assert(profile.load().won === true && runs.load() !== null && storage.getItem(PROLOGUE_KEY) === '1', 'progress before the reset');

  resetProgress(storage);
  for (const key of PROGRESS_KEYS) assert(storage.getItem(key) === null, `${key} is removed`);
  for (const [k, v] of Object.entries(kept)) assert(storage.getItem(k) === v, `${k} is kept`);
  assert(JSON.stringify(createRtProfileStore(storage).load()) === JSON.stringify(emptyRtProfile()), 'the profile reads as a first-time player\'s');
  assert(createRtRunStore(storage).load() === null, 'no run is open');
  assert(createRtProfileStore(storage).startRun().run === 1, 'the next run is the viewer\'s first');
}

// 2. Without storage, or with a storage that throws, nothing breaks.
{
  resetProgress(null);
  resetProgress({ removeItem: () => { throw new Error('blocked'); } });
}

// 3. Every `ashen-oath-…` key the game's code names has a decision: progress (removed) or kept on purpose.
{
  const KEPT_ON_PURPOSE = new Set([
    // Settings: the sandbox's params and build, the view toggles, the sound, the flashes, «Подсказки», the debug panel.
    'ashen-oath-realtime-params-v17', 'ashen-oath-realtime-role-badges', 'ashen-oath-realtime-link-depth', 'ashen-oath-realtime-show-glyph',
    'ashen-oath-realtime-sound', 'ashen-oath-realtime-sandbox-build', 'ashen-oath-realtime-session-clock', 'ashen-oath-realtime-new-on-map',
    'ashen-oath-realtime-hints-on', 'ashen-oath-realtime-fx', 'ashen-oath-realtime-panel-open',
    // The session clock (time of play) and the telemetry (the logs of «Логи»: its database, channel and format).
    'ashen-oath-realtime-session', 'ashen-oath-rt-tlm-v1', 'ashen-oath-rt-telemetry',
    // Not a storage key: the kind of the day's proof file.
    'ashen-oath-daily',
  ]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.(spec|testkit)\.ts$/.test(name)) files.push(path);
    }
  };
  walk(fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, ''));
  const named = new Set(files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/'(ashen-oath-[a-z0-9-]+)'/g)].map(m => m[1])));
  assert(named.has(RT_PROFILE_STORAGE_KEY) && named.has(RT_RUN_STORAGE_KEY), 'the walk finds the stores\' keys');
  const open = [...named].filter(k => !PROGRESS_KEYS.includes(k) && !KEPT_ON_PURPOSE.has(k));
  assert(!open.length, `keys without a decision (progress or kept): ${open.join(', ')}`);
}

console.log('progressReset: 3 checks passed');
