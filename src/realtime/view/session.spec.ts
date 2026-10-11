/**
 * П7 «Часы сессии» (view/session.ts): the session definition on a fake clock and a plain-object storage. Node only:
 * `npm run test:realtime-session`. The end-to-end result (the lines on screen) is tests/realtime-session.spec.ts.
 */
import { formatMinutes, SessionClock, SESSION_BREAK_MS, SESSION_NUDGE_MS, SESSION_NUDGE_TEXT, type SessionStorage } from './session';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const MIN = 60_000;

function setup(): { data: Map<string, string>; wall: { t: number }; make: () => SessionClock } {
  const data = new Map<string, string>();
  const store: SessionStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const wall = { t: 1_000_000 };
  return { data, wall, make: () => new SessionClock(store, () => wall.t) };
}

check('minutes are written plainly', () => {
  assert(formatMinutes(20_000) === 'меньше минуты', 'under a minute');
  assert(formatMinutes(47 * MIN) === '47 мин', '47');
  assert(formatMinutes(77 * MIN) === '1 ч 17 мин', 'hours');
  assert(formatMinutes(120 * MIN) === '2 ч', 'whole hours');
});

check('the end line counts time and runs started; a pause under 10 minutes is play', () => {
  const { wall, make } = setup();
  const c = make();
  c.runStarted();
  wall.t += 9 * MIN; c.touch();
  c.runStarted();
  wall.t += 9 * MIN;
  assert(c.endLine() === 'В игре 18 мин · походов 2', c.endLine());
});

check('a gap of 10 minutes or more is a break: the session starts anew', () => {
  const { wall, make } = setup();
  const c = make();
  c.runStarted(); for (let i = 0; i < 6; i++) { wall.t += 5 * MIN; c.touch(); }
  wall.t += SESSION_BREAK_MS;
  assert(c.endLine() === 'В игре меньше минуты · походов 1', c.endLine());
  assert(c.info().runs === 0, 'runs reset');
});

check('the session survives a reload (a new clock on the same storage) while the break is short', () => {
  const { wall, make } = setup();
  let c = make(); c.runStarted(); for (let i = 0; i < 4; i++) { wall.t += 5 * MIN; c.touch(); }
  wall.t += 5 * MIN;
  c = make();
  assert(c.endLine() === 'В игре 25 мин · походов 1', c.endLine());
  wall.t += 11 * MIN;
  c = make();
  assert(c.info().minutes === 0 && c.info().runs === 0, 'a long break across a reload');
});

check('the nudge: none before 90 minutes, once after, again no sooner than 90 minutes later', () => {
  const { wall, make } = setup();
  const c = make(); c.touch();
  /** Plays `minutes` in 5-minute steps (a gap under 10 minutes is play). */
  const play = (minutes: number): void => { for (let m = 0; m < minutes; m += 5) { wall.t += 5 * MIN; c.touch(); } };
  play(85);
  assert(c.takeNudge() === null, 'under 90 minutes');
  play(5);
  assert(SESSION_NUDGE_MS === 90 * MIN, 'constant');
  assert(c.takeNudge() === SESSION_NUDGE_TEXT, 'due');
  assert(c.takeNudge() === null, 'only once');
  play(85);
  assert(c.takeNudge() === null, 'under 90 minutes after the nudge');
  play(5);
  assert(c.takeNudge() === SESSION_NUDGE_TEXT, '90 minutes after the nudge');
});

check('the test hook moves the clock; broken or missing storage does not throw', () => {
  const { data, make } = setup();
  const c = make(); c.touch(); c.advance(5 * MIN);
  assert(c.info().minutes === 5, 'advanced');
  data.set('ashen-oath-realtime-session', 'not json');
  assert(new SessionClock(null).endLine().startsWith('В игре'), 'no storage');
  assert(make().info().minutes === 0, 'unreadable record: a new session');
});
