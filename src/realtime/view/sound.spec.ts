/**
 * The run's sound (design 14.10.2026; view/paramStorage.ts `loadSound`, `saveSound`): the gear's setting kept in its own key —
 * the defaults, a round trip, junk, and storage that throws (an artifact may give none). Node only: `npm run test:realtime-sound`.
 * The end-to-end result (the gear, a reload, a fight without tones) is tests/realtime-sound.spec.ts.
 * Task 22 «Удар слышен» (view/soundGate.ts): one sound of a kind per 0.3 real seconds; the threats' starts read from real worlds
 * (journalled commands on the quiet run field) — each archer's aim once, a boar's windup, a sapper's fuse once (lit by a touch,
 * or by its death in the chain), none of them again while it lasts.
 */
import { loadSound, saveSound, SOUND_DEFAULT } from './paramStorage';
import { SoundGate, ThreatWatch, SOUND_GAP, type ThreatSound } from './soundGate';
import { quiet, seedOf } from '../run/runFight.testkit';
import { rtRunParams } from '../run/rtRun';
import { Simulation } from '../sim/simulation';

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

check('task 22: one sound of a kind per 0.3 s — the same kind waits, another kind does not, the counts say so', () => {
  const gate = new SoundGate();
  assert(gate.pass('hurt', 10) && !gate.pass('hurt', 10.1) && !gate.pass('hurt', 10 + SOUND_GAP - 0.01), 'the same kind waits');
  assert(gate.pass('aim', 10.1) && gate.pass('charge', 10.1) && gate.pass('fuse', 10.1), 'other kinds sound');
  assert(gate.pass('hurt', 10 + SOUND_GAP) && gate.pass('hurt', 10.6 + 0.01), 'after 0.3 s it sounds again');
  assert(gate.asked.hurt === 5 && gate.played.hurt === 3, JSON.stringify(gate));
});

/** A quiet run field (nobody comes) with the threats placed by `setup`; the watch read after every tick, as main.ts every frame. */
function threatsOf(setup: (sim: Simulation) => void, seconds: number): ThreatSound[] {
  const sim = new Simulation({ arena: 'run-fight-field', params: rtRunParams(quiet()), seed: seedOf(22), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  setup(sim);
  const watch = new ThreatWatch(), out: ThreatSound[] = [];
  for (let i = 0; i < seconds * 60 && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...watch.read(sim.world)); sim.world.events.length = 0; }
  return out;
}
const count = (sounds: ThreatSound[], kind: ThreatSound): number => sounds.filter(k => k === kind).length;

check('task 22: real worlds — an archer\'s aim once per aim, a boar\'s windup, a sapper\'s fuse once (touch, or its death in the chain)', () => {
  // One archer within reach aims every `archerCooldown` (3 s): 2–3 aims in 8 s, each heard once (not once a tick).
  const archer = threatsOf(sim => { const h = sim.world.hero; sim.command({ t: 'place', x: h.x + 4.5, y: h.y, color: 0, hp: 0, kind: 'archer' }); }, 8);
  assert(count(archer, 'aim') >= 2 && count(archer, 'aim') <= 3 && archer.every(k => k === 'aim'), JSON.stringify(archer));
  // A boar in reach and sight winds up.
  const boar = threatsOf(sim => { const h = sim.world.hero; sim.command({ t: 'place', x: h.x + 3, y: h.y, color: 0, hp: 2, kind: 'boar' }); }, 6);
  assert(count(boar, 'charge') >= 1, JSON.stringify(boar));
  // A sapper walking into the hero lights by its touch: one fuse, not again when it blows.
  const touched = threatsOf(sim => { const h = sim.world.hero; sim.command({ t: 'param', key: 'enemySpeed', value: 1.2 }); sim.command({ t: 'place', x: h.x - 0.6, y: h.y, color: 0, hp: 0, kind: 'sapper' }); }, 4);
  assert(count(touched, 'fuse') === 1, JSON.stringify(touched));
  // A sapper killed by a chain: its death lights the blast — one fuse.
  const killed = threatsOf(sim => {
    const h = sim.world.hero, at = { x: h.x + 1.2, y: h.y };
    sim.command({ t: 'place', x: at.x, y: at.y, color: 0, hp: 0, kind: 'sapper' });
    assert(sim.command({ t: 'begin', x: at.x, y: at.y }) === true, 'the chain takes the sapper');
    sim.command({ t: 'release' });
  }, 3);
  assert(count(killed, 'fuse') === 1, JSON.stringify(killed));
});

console.log('\nsound setting: all checks passed');
