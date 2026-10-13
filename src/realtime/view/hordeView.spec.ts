/**
 * Task 12, the horde ring (view/hordeView.ts): it finds the crowd of marked bodies and leaves stragglers out; a leader alone, a
 * horde killed down to fewer than HORDE_MIN and scattered bodies make no ring. Node only: `npm run test:realtime-horde-view`.
 * The ring on screen by real play is tests/realtime-marked.spec.ts.
 */
import { HORDE_MIN, hordeGroup } from './hordeView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

// Twelve bodies packed round (10, 6) — the den's horde.
const den = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, x: 10 + Math.cos(i) * (0.4 + (i % 3) * 0.5), y: 6 + Math.sin(i) * (0.4 + (i % 3) * 0.5) }));

check('a packed horde of 12 is one ring round all', () => {
  const g = hordeGroup(den);
  assert(g && g.members.size === 12, 'all twelve in the ring');
  assert(Math.hypot(g.x - 10, g.y - 6) < 0.5 && g.radius <= 1.5 + 1e-9, 'centred on the crowd, round its bodies');
});

check('a straggler far away is left out and does not pull the ring', () => {
  const g = hordeGroup([...den, { id: 99, x: 22, y: 6 }]);
  assert(g && g.members.size === 12 && !g.members.has(99), 'the straggler keeps its own reticle');
  assert(Math.hypot(g.x - 10, g.y - 6) < 0.5, 'the ring stays on the crowd');
});

check('a leader alone, a horde killed down below HORDE_MIN: no ring; HORDE_MIN close together: a ring', () => {
  assert(hordeGroup([{ id: 1, x: 5, y: 5 }]) === null, 'one marked body');
  assert(hordeGroup(den.slice(0, HORDE_MIN - 1)) === null, `${HORDE_MIN - 1} left`);
  assert(hordeGroup(den.slice(0, HORDE_MIN)) !== null, `${HORDE_MIN} close together`);
});

check('scattered marked bodies are no horde', () => {
  assert(hordeGroup([{ id: 1, x: 2, y: 2 }, { id: 2, x: 12, y: 2 }, { id: 3, x: 2, y: 10 }, { id: 4, x: 12, y: 10 }, { id: 5, x: 7, y: 6 }]) === null, 'five spread over the arena');
});
