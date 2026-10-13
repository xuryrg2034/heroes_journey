/**
 * The run's sound (design 14.10.2026; view/paramStorage.ts `loadSound`, `saveSound`): the gear's setting kept in its own key —
 * the defaults, a round trip, junk, and storage that throws (an artifact may give none). Node only: `npm run test:realtime-sound`.
 * The end-to-end result (the gear, a reload, a fight without tones) is tests/realtime-sound.spec.ts.
 */
import { loadSound, saveSound, SOUND_DEFAULT } from './paramStorage';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const KEY = 'ashen-oath-realtime-sound';
const data = new Map<string, string>();
const memory = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
const broken = { getItem: (): string | null => { throw new Error('no storage'); }, setItem: (): void => { throw new Error('no storage'); } };
const use = (store: unknown): void => { (globalThis as { localStorage?: unknown }).localStorage = store; };

check('nothing stored: on, volume 0.3 (the Params defaults)', () => {
  use(memory); data.clear();
  assert(SOUND_DEFAULT.on === true && SOUND_DEFAULT.volume === 0.3, JSON.stringify(SOUND_DEFAULT));
  assert(JSON.stringify(loadSound()) === JSON.stringify({ on: true, volume: 0.3 }), JSON.stringify(loadSound()));
});

check('saved off with its volume, read back the same', () => {
  use(memory); data.clear();
  saveSound({ on: false, volume: 0.55 });
  assert(JSON.stringify(loadSound()) === JSON.stringify({ on: false, volume: 0.55 }), JSON.stringify(loadSound()));
  saveSound({ on: true, volume: 0 });
  assert(JSON.stringify(loadSound()) === JSON.stringify({ on: true, volume: 0 }), 'volume 0 is a value, not junk');
});

check('junk in the key: each field falls back alone', () => {
  use(memory);
  data.set(KEY, 'not json');
  assert(JSON.stringify(loadSound()) === JSON.stringify(SOUND_DEFAULT), 'not json');
  data.set(KEY, JSON.stringify({ on: false, volume: 7 }));
  assert(JSON.stringify(loadSound()) === JSON.stringify({ on: false, volume: 0.3 }), 'volume out of range');
  data.set(KEY, JSON.stringify({ on: 'no', volume: 0.4 }));
  assert(JSON.stringify(loadSound()) === JSON.stringify({ on: true, volume: 0.4 }), 'on not a boolean');
});

check('storage throws (or is absent): the defaults, and a save does not throw', () => {
  use(broken);
  assert(JSON.stringify(loadSound()) === JSON.stringify(SOUND_DEFAULT), 'throwing storage');
  saveSound({ on: false, volume: 0.1 });
  use(undefined);
  assert(JSON.stringify(loadSound()) === JSON.stringify(SOUND_DEFAULT), 'no storage');
  saveSound({ on: false, volume: 0.1 });
});

console.log('\nsound setting: all checks passed');
