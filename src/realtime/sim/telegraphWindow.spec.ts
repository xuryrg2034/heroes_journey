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
 *
 * Task 27 (the boss frame, the Jailer in the sandbox): «Кистень» and «Бросок гири» are threats of the table (the run's values and
 * the sandbox's); every move of the Jailer has a record (a threat or `MOVES_OUTSIDE`); the worst point «the landing on the severed
 * weight» is played by journalled commands: the hero lands next to the core during the flail's windup — the flail is dropped.
 */
import { registeredEnemyKinds } from './enemies/kinds';
import { FLAIL_RADIUS, JAILER, JAILER_HP, JAILER_MOVES, JAILER_WEIGHT, JAILER_WINDUP, THROW_RADIUS, WEIGHT_HP } from './enemies/jailer';
import { registerArena } from './arenas';
import { defaultParams, heroRadius, type Params } from './params';
import { Simulation, SIM_DT } from './simulation';
import { touchDistance, type WorldEvent } from './world';
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
  /** Task 27: the boss's move it is (`JAILER_MOVES`); the Jailer plays in the sandbox — checked with the sandbox's values too. */
  move?: string;
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
  // Task 27 (the boss report, «Тюремщик»): the shorter windup (1.0 s; the first of a fight is 1.5). The flail's worst point — the
  // hero's centre as close to the core as a touch lets him (`touchDistance`), the way out along the radius (the report's bound;
  // sideways out of the half disc is shorter). The throw's — the circle's centre, as the archer's mark.
  { id: 'jailer-flail', source: JAILER, move: 'flail', title: 'Тюремщик: кистень', window: () => JAILER_WINDUP, exit: p => FLAIL_RADIUS + heroRadius(p) - touchDistance(p) },
  { id: 'jailer-throw', source: JAILER_WEIGHT, move: 'throw', title: 'Тюремщик: бросок гири', window: () => JAILER_WINDUP, exit: p => THROW_RADIUS + heroRadius(p) },
];

/** Task 27: the Jailer's moves without a hit on the hero, and why. */
const MOVES_OUTSIDE: Readonly<Record<string, string>> = {
  whistle: 'свисток: героя не бьёт — метки появления у ворот (враги выходят через обычную задержку метки)',
};

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
/** Task 27: the sandbox's values with the boss frame (the arena «Тюремщик» plays them). */
const SANDBOX: Params = { ...defaultParams(), bossFrame: true };
const need = (t: Threat, p: Params): number => REACTION + t.exit(p) / p.heroSpeed;
const round2 = (x: number): number => Math.round(x * 100) / 100;

check('window ≥ reaction 0.2 s + the walk out of the worst point at the hero\'s speed — every threat of the table in a run battle (the Jailer\'s moves in the sandbox too); the goblin\'s bust is the recorded exception and still short', () => {
  for (const t of THREATS) {
    for (const [mode, p] of t.move ? [['поход', RUN], ['песочница', SANDBOX]] as const : [['поход', RUN]] as const) {
      const w = t.window(p), n = need(t, p);
      console.log(`   ${t.title} (${mode}): окно ${round2(w)} с, выход ${round2(t.exit(p) / p.heroSpeed)} с, нужно ${round2(n)} с${t.exception ? ` — исключение: ${t.exception}` : ''}`);
      if (t.exception) assert(w < n, `${t.id}: the exception is stale — the window ${w} reaches ${round2(n)}; drop the record`);
      else assert(w >= n - 1e-9, `${t.id} (${mode}): the window ${w} s is shorter than ${round2(n)} s (reaction ${REACTION} + exit ${round2(t.exit(p))} / ${p.heroSpeed})`);
    }
  }
});

check('task 27: every move of the Jailer is a threat of the table or listed outside it with a reason; no record of an unknown move', () => {
  const recorded = new Set([...THREATS.flatMap(t => t.move ? [t.move] : []), ...Object.keys(MOVES_OUTSIDE)]);
  const missing = JAILER_MOVES.filter(m => !recorded.has(m));
  assert(!missing.length, `the Jailer's moves with no record of their window: ${missing.join(', ')}`);
  const stale = [...recorded].filter(m => !(JAILER_MOVES as readonly string[]).includes(m));
  assert(!stale.length, `records of unknown moves: ${stale.join(', ')}`);
});

registerArena({
  id: 'telegraph-jailer', name: 'Поле Тюремщика', summary: 'Тест окна посадки', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 6, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], bossFrame: true,
});

check('task 27, the worst point «посадка на месте отрубленной гири»: the chain severs the weight in the core\'s hand while «Кистень» winds up — the hero lands next to the core within the flail\'s reach, and the flail is dropped with its weight (no hit); several seeds', () => {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false;
  let seen = 0;
  for (let k = 1; k <= 12 && seen < 3; k++) {
    const sim = new Simulation({ arena: 'telegraph-jailer', params: { ...p, phases: p.phases.map(x => ({ ...x })) }, seed: Math.imul(k, 2654435761) >>> 0, record: true }), w = sim.world;
    const place = (x: number, y: number, hp: number, kind = 'basic', color = 0) => { const id = sim.command({ t: 'place', x, y, color, hp, kind }); return w.enemies.find(e => e.id === id)!; };
    const drawRelease = (pts: readonly { x: number; y: number }[]): WorldEvent[] => {
      sim.command({ t: 'begin', x: pts[0].x, y: pts[0].y });
      for (const q of pts.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
      sim.command({ t: 'release' });
      const out: WorldEvent[] = [];
      for (let i = 0; i < 600 && (w.move || i === 0); i++) { sim.tick(); out.push(...w.events.splice(0)); }
      return out;
    };
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 6, y: 6 });
    const core = place(8, 6, JAILER_HP, JAILER, 1), weight = place(8, 6, WEIGHT_HP, JAILER_WEIGHT, 0);
    // Its plate first (a plate pass: the hero goes back to his start).
    drawRelease([place(6.9, 5.3, 0), weight]);
    // The first move: a flail with the weight in hand (a throw first — not this seed).
    let start: WorldEvent | undefined;
    for (let i = 0; i < 180 && !start; i++) { sim.tick(); start = w.events.splice(0).find(e => e.type === 'bossMove' && e.stage === 'start'); }
    if (!start || start.type !== 'bossMove' || start.move !== 'flail') continue;
    seen++;
    const due = w.time + core.vars.t, dir = core.vars.dir;
    const at = { x: weight.x, y: weight.y };
    const a3 = place(at.x - 1.2, at.y, 0), a2 = place(at.x - 2.4, at.y, 0);
    sim.command({ t: 'teleport', x: at.x - 3.4, y: at.y });
    const events = drawRelease([a2, a3, weight]);
    assert(!w.enemies.includes(weight) && events.some(e => e.type === 'partSevered'), `seed ${k}: the weight severed`);
    const hero = w.hero, dx = hero.x - core.x, dy = hero.y - core.y, d = Math.sqrt(dx * dx + dy * dy);
    const inside = d <= FLAIL_RADIUS + heroRadius(p) && dx * Math.cos(dir) + dy * Math.sin(dir) >= -heroRadius(p);
    const left = due - w.time, exitNeed = REACTION + (FLAIL_RADIUS + heroRadius(p) - d) / p.heroSpeed;
    console.log(`   seed ${k}: посадка в ${round2(d)} от ядра, в полукруге: ${inside}; до удара оставалось ${round2(left)} с, выход по радиусу ${round2(exitNeed)} с — кистень снят вместе с гирей`);
    assert(d < FLAIL_RADIUS, `seed ${k}: the landing is next to the core, within the flail's reach (${round2(d)})`);
    const rest: WorldEvent[] = [];
    for (let i = 0; i < Math.round((left + 1) / SIM_DT); i++) { sim.tick(); rest.push(...w.events.splice(0)); }
    assert(!rest.some(e => (e.type === 'hit' && e.source === 'flail') || (e.type === 'bossMove' && e.stage === 'hit')) && !core.vars.mv,
      `seed ${k}: no flail hit after the landing`);
  }
  assert(seen >= 2, `seeds with a flail first: ${seen}`);
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
