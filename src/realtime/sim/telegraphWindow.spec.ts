/**
 * Task 25(2) «Окна и смерти» (design 15.10.2026, docs/design-notes/tasks-21-25.md; Т5 of the research «Причины смерти, телеграфы и
 * баланс»): the lower bound of a telegraph's window. A threat that marks a zone and hits everyone in it at a known moment must
 * leave the time to see it and walk out from its worst point: window ≥ reaction (0.2 s) + exit / the hero's speed. The worst point
 * is the zone's centre: the exit is the zone's reach (its radius or half width + the hero's body, as the hit tests it). Everything
 * is read from the same `Params` a run battle plays (`rtRunParams`, `rtArenaParams` with the run's short fuse).
 *
 * The goblin's bust is a recorded exception (task 19 «Короткий запал»: «уходи, пока крутятся барабаны»; the lesson is task 24's
 * room 8): the dash ends on the idol, its window after the light is shorter than the walk out. The exception must still hold — a
 * window that grew past the bound makes its record stale and fails the test.
 *
 * Coverage: every registered enemy kind is either a source of a threat in the table or listed outside it with the reason. A new
 * kind with neither fails the test.
 */
import { registeredEnemyKinds } from './enemies/kinds';
import { defaultParams, heroRadius, type Params } from './params';
import './simulation';
import { rtArenaParams, rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** Simple visual reaction, seconds (the research: 180–200 ms). */
const REACTION = 0.2;

interface Threat {
  id: string;
  /** The enemy kind it comes from, or `goblin` (the slot's idol, not an enemy kind). */
  source: string;
  title: string;
  /** Game seconds from the sign to the hit. */
  window: (p: Params) => number;
  /** Units from the worst point to out of the hit's reach. */
  exit: (p: Params) => number;
  /** A recorded exception: why the window may be shorter (with the decision). */
  exception?: string;
}

const THREATS: readonly Threat[] = [
  { id: 'archer-mark', source: 'archer', title: 'лучник: метка', window: p => p.archerWindup, exit: p => p.archerMarkRadius + heroRadius(p) },
  { id: 'archer-line', source: 'archer', title: 'лучник: линия', window: p => p.archerWindup, exit: p => p.archerWidth / 2 + heroRadius(p) },
  { id: 'sapper-death', source: 'sapper', title: 'сапёр: фитиль после гибели', window: p => p.sapperFuse, exit: p => p.sapperRadius + heroRadius(p) },
  { id: 'sapper-touch', source: 'sapper', title: 'сапёр: фитиль от касания', window: p => p.sapperTouchFuse, exit: p => p.sapperRadius + heroRadius(p) },
  {
    id: 'goblin-bust', source: 'goblin', title: 'гоблин: перебор', window: p => p.slotBustFuse, exit: p => p.slotBustRadius + heroRadius(p),
    exception: 'задача 19 «Короткий запал» (решение пользователя 14.10.2026): уходи, пока крутятся барабаны; урок — задача 24, комната 8 пролога',
  },
];

/** Kinds without a zone-and-moment telegraph, and why. */
const OUTSIDE: Readonly<Record<string, string>> = {
  basic: 'касание, без телеграфа',
  reaper: 'касание, без телеграфа',
  shield: 'касание, без телеграфа (щит — защита от цепи)',
  shaman: 'касание, без телеграфа (луч делает слабого врага крепким, героя не бьёт)',
  porcupine: 'иглы бьют при ударе цепью — значок игл в подсветке цепи, не зона',
  boar: 'полоса рывка: удар телом в пути, а не в зоне в момент; окно меряет телеметрия (исследование, И5)',
  lynx: 'линия прыжка: удар телом в пути; окно меряет телеметрия (И5)',
  wolf: 'бросок по линии: удар — касание в пути; окно меряет телеметрия (И5)',
};

/** A run battle's params (the run's numbers, the short fuse of task 19). */
const RUN = rtArenaParams({ shortFuse: true }, rtRunParams(defaultParams()));
const need = (t: Threat, p: Params): number => REACTION + t.exit(p) / p.heroSpeed;
const round2 = (x: number): number => Math.round(x * 100) / 100;

check('window ≥ reaction 0.2 s + the walk out of the worst point at the hero\'s speed — every threat of the table in a run battle; the goblin\'s bust is the recorded exception and still short', () => {
  for (const t of THREATS) {
    const w = t.window(RUN), n = need(t, RUN);
    console.log(`   ${t.title}: окно ${round2(w)} с, выход ${round2(t.exit(RUN) / RUN.heroSpeed)} с, нужно ${round2(n)} с${t.exception ? ` — исключение: ${t.exception}` : ''}`);
    if (t.exception) assert(w < n, `${t.id}: the exception is stale — the window ${w} reaches ${round2(n)}; drop the record`);
    else assert(w >= n - 1e-9, `${t.id}: the window ${w} s is shorter than ${round2(n)} s (reaction ${REACTION} + exit ${round2(t.exit(RUN))} / ${RUN.heroSpeed})`);
  }
});

check('the numbers of the research table (15.10.2026): the exit from the centre — archer\'s mark 0.32 s at a window of 1.0, killed sapper 0.45 s at 0.8, the goblin\'s bust 0.95 s at 0.6', () => {
  const at = (id: string): Threat => THREATS.find(t => t.id === id)!;
  const walk = (id: string): number => round2(at(id).exit(RUN) / RUN.heroSpeed);
  assert(walk('archer-mark') === 0.32 && at('archer-mark').window(RUN) === 1, `archer ${walk('archer-mark')} at ${at('archer-mark').window(RUN)}`);
  assert(Math.abs(walk('sapper-death') - 0.45) <= 0.01 && at('sapper-death').window(RUN) === 0.8, `sapper ${walk('sapper-death')} at ${at('sapper-death').window(RUN)}`);
  assert(Math.abs(walk('goblin-bust') - 0.95) <= 0.01 && at('goblin-bust').window(RUN) === 0.6, `goblin ${walk('goblin-bust')} at ${at('goblin-bust').window(RUN)}`);
});

check('coverage: every registered enemy kind is a source of the table or listed outside it with a reason; no entry for a kind that does not exist', () => {
  const kinds = registeredEnemyKinds().map(k => k.id);
  const inTable = new Set(THREATS.map(t => t.source));
  const missing = kinds.filter(k => !inTable.has(k) && !Object.hasOwn(OUTSIDE, k));
  assert(!missing.length, `kinds with no record of their telegraph window: ${missing.join(', ')} — add them to THREATS or OUTSIDE`);
  const stale = [...Object.keys(OUTSIDE), ...[...inTable].filter(s => s !== 'goblin')].filter(k => !kinds.includes(k));
  assert(!stale.length, `records of unknown kinds: ${stale.join(', ')}`);
  assert(!kinds.some(k => inTable.has(k) && Object.hasOwn(OUTSIDE, k)), 'a kind both in the table and outside it');
});

console.log(`telegraph window: ${checks} checks passed`);
