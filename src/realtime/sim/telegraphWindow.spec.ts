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
import { CASTELLAN, KNIGHT, KNIGHT_LANE_WIDTH, LUNGE_WIDTH, LUNGE_WINDUP, PAIR_GAP, PHASE3_WINDUP, STAND } from './enemies/garrison';
import { BOLT_HALF } from './enemies/crossbow';
import {
  CLUB_WIDTH, CLUB_WINDUP, PHASE3_WINDUP as TROLL_PHASE3_WINDUP, ROCK_FLIGHT, ROCK_RADIUS, ROCK_WINDUP, TAIL_INNER, TAIL_OUTER, TAIL_WINDUP, TROLL, TROLL_CLUB,
  TROLL_MOVES, TROLL_ROCK, TROLL_TAIL,
} from './enemies/troll';
import {
  CHIEF, CHIEF_LADLE, CHIEF_MOVES, CHIEF_SACK, PEPPER_RADIUS, PEPPER_WINDUP, PHASE3_WINDUP as CHIEF_PHASE3_WINDUP, SWING_RADIUS, SWING_WINDUP,
} from './enemies/chief';
import { BARREL, ROOK, ROOK_HALF, ROOK_WINDUP, TOPPLE_WIDTH, WARDROBE, WARDROBE_WINDUP } from './enemies/castle';
import { SLINGER, SLING_MIN, SLING_WINDUP, STONE_RADIUS } from './enemies/slinger';
import { HIVE, HIVE_NEAR, HIVE_RING, HIVE_SPEED, RING_RADIUS, WASP_HANG, WASP_RADIUS } from './enemies/hive';
import { WISP, WISP_LIGHT, WISP_SPEED } from './enemies/wisp';
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
  /** Task 27: the boss's move it is (`JAILER_MOVES`; task 48 — `TROLL_MOVES`); a boss of the sandbox — checked with the sandbox's values too. */
  move?: string;
}

const THREATS: readonly Threat[] = [
  { id: 'archer-mark', source: 'archer', title: 'лучник: метка', window: p => p.archerWindup, exit: p => p.archerMarkRadius + heroRadius(p) },
  { id: 'archer-line', source: 'archer', title: 'лучник: линия', window: p => p.archerWindup, exit: p => p.archerWidth / 2 + heroRadius(p) },
  // Task 43: the law of the crossbow — the line fixed at the windup's start, `BOLT_HALF` each side.
  { id: 'crossbow-bolt', source: 'crossbow', title: 'арбалетчик: болт', window: p => p.crossbowWindup, exit: p => BOLT_HALF + heroRadius(p) },
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
  // Task 38 (the Castellan v0, design 2.4): «Спустить пса» — a lane of 4 × 0.8 from the hound; the worst point is the lane's axis,
  // the way out sideways (half its width + the hero's body). The shorter windup 0.8 s (the first of a fight is 1.2).
  { id: 'castellan-lunge', source: CASTELLAN, title: 'Кастелян: спустить пса', window: () => LUNGE_WINDUP, exit: p => LUNGE_WIDTH / 2 + heroRadius(p) },
  // Task 43 (the full Castellan): «Болт» from the stand — the law of the crossbow; the shortest windup: the pair's second bolt
  // (`PAIR_GAP` 0.6 s, phase 2 and 3) or phase 3's windup ×0.8.
  { id: 'castellan-bolt', source: STAND, title: 'Кастелян: болт со станка', window: p => Math.min(PAIR_GAP, p.crossbowWindup * PHASE3_WINDUP), exit: p => BOLT_HALF + heroRadius(p) },
  // Task 43 (the knight, design 5): «Рывок» — a lane of 5 × 0.8 from the knight, the way out sideways from its axis; «Размах» — the
  // circle of 1.6 around the knight, the worst point its centre (conservative: the hero never stands closer than a touch).
  { id: 'knight-charge', source: KNIGHT, title: 'рыцарь: рывок', window: p => p.knightChargeWindup, exit: p => KNIGHT_LANE_WIDTH / 2 + heroRadius(p) },
  { id: 'knight-swing', source: KNIGHT, title: 'рыцарь: размах', window: p => p.knightSwingWindup, exit: p => p.knightSwingRadius + heroRadius(p) },
  // Task 48 (the Troll, design 7): the shortest windups — phase 3's ×0.8 for the club and the rock (the tail is not sped up, spec 24.4; the first of a fight is ×1.5). «Удар дубиной» — a lane of
  // 4.5 × 1.6, the way out sideways from its axis; «Бросок камня» — the circle of 1.2 on the hero, its windup and the flight 0.4;
  // «Хвост метёт» — the ring 1.2–3.2 around the core, the worst point its inner edge (inside 1.2 is the core's body and touch).
  { id: 'troll-club', source: TROLL_CLUB, move: 'club', title: 'Тролль: удар дубиной', window: () => CLUB_WINDUP * TROLL_PHASE3_WINDUP, exit: p => CLUB_WIDTH / 2 + heroRadius(p) },
  { id: 'troll-rock', source: TROLL_ROCK, move: 'rock', title: 'Тролль: бросок камня', window: () => ROCK_WINDUP * TROLL_PHASE3_WINDUP + ROCK_FLIGHT, exit: p => ROCK_RADIUS + heroRadius(p) },
  // Task 55а (spec 3.2, 3.3): «Падение шкафа» — the lane 3 × 1.2 from the wardrobe, the way out sideways from its axis (the first windup
  // of a fight ×1.5 is extra); «Удар ладьи» — the axis 0.5 wide, the way out sideways (the first windup 1.5 is extra).
  { id: 'wardrobe-topple', source: WARDROBE, title: 'шкаф: падение', window: p => p.wardrobeWindup ?? WARDROBE_WINDUP, exit: p => TOPPLE_WIDTH / 2 + heroRadius(p) },
  { id: 'rook-strike', source: ROOK, title: 'ладья: удар', window: p => p.rookWindup ?? ROOK_WINDUP, exit: p => ROOK_HALF + heroRadius(p) },
  // Task 57а (design 7): the slinger's stone — its windup alone (the flight is extra), the way out sideways from the middle line at its
  // nearest aim (`SLING_MIN`); the hive's wasp — from the hanging wasps to the hero at `HIVE_NEAR` (nearer the hive is silent), the
  // swell before them is extra.
  { id: 'slinger-stone', source: SLINGER, title: 'пращник: камень', window: p => p.slingWindup ?? SLING_WINDUP, exit: p => STONE_RADIUS + heroRadius(p) },
  { id: 'hive-wasp', source: HIVE, title: 'улей: оса', window: p => WASP_HANG + (HIVE_NEAR - RING_RADIUS) / (p.hiveSpeed ?? HIVE_SPEED), exit: p => WASP_RADIUS + heroRadius(p) },
  { id: 'troll-tail', source: TROLL_TAIL, move: 'tail', title: 'Тролль: хвост метёт', window: () => TAIL_WINDUP, exit: p => TAIL_OUTER + heroRadius(p) - TAIL_INNER },
  // Task 54 (spec 8): «Взмах половником» — the worst point pressed to the core's front (a solid body: the touch's distance), the way
  // out along the radius; «Горсть перца» — a circle's centre, out across the line; phase 3's windup ×0.8.
  { id: 'chief-ladle', source: CHIEF_LADLE, move: 'swing', title: 'Главарь: взмах половником', window: () => SWING_WINDUP, exit: p => SWING_RADIUS + heroRadius(p) - touchDistance(p) },
  { id: 'chief-pepper', source: CHIEF_SACK, move: 'pepper', title: 'Главарь: горсть перца', window: () => PEPPER_WINDUP * CHIEF_PHASE3_WINDUP, exit: p => PEPPER_RADIUS + heroRadius(p) },
];

/** Task 27: the Jailer's moves without a hit on the hero, and why. */
const MOVES_OUTSIDE: Readonly<Record<string, string>> = {
  whistle: 'свисток: героя не бьёт — метки появления у ворот (враги выходят через обычную задержку метки)',
  // Task 48: the Troll's core.
  roar: 'рык Тролля: героя не бьёт — метки волков у нор (1 с)',
  snore: 'храп Тролля: героя не бьёт — окно ядра, части не бьют',
  // Task 54: the Chief's core and his sack («Свисток» — the record of the Jailer's: markers at the gate).
  feast: '«Обед!» Главаря: героя не бьёт — перекраска у котелка, едоки, окно ядра',
  season: '«Приправа» Главаря: героя не бьёт — новый цвет варева',
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
  // Task 38 «Гарнизон».
  guard: 'касание, без телеграфа (строй — готовая цепь)',
  handler: 'касание, без телеграфа (держит псов на поводках)',
  hound: 'касание, без телеграфа (ярость кусает врагов; рывок у Кастеляна — запись «Кастелян: спустить пса»)',
  // Task 40 «Гарнизон, шаг 1б».
  keymaster: 'касание, без телеграфа (кандалы держат врага, героя не бьют)',
  // Task 48 «Тролль»: the core's own moves («Рык», «Храп») do not hit the hero — `MOVES_OUTSIDE`.
  [TROLL]: 'касание, без телеграфа (рык и храп героя не бьют; удары — у частей)',
  // Task 54 «Главарь»: the core's own moves («Обед!», «Приправа», «Свисток») do not hit the hero — `MOVES_OUTSIDE`.
  [CHIEF]: 'касание, без телеграфа (обед, приправа и свисток героя не бьют; удары — у половника и мешка)',
  // Task 55а: the barrel is a thing — it never strikes (the player shoves it).
  [BARREL]: 'вещь: не бьёт и не касается; толкает её игрок',
  // Task 57а: the wisp is a living shot — no zone and moment; it lights 1.6 s from its marker and is slower than the hero (checked below).
  [WISP]: 'живой снаряд: метка и зажигание 1,6 с до полёта, летит медленнее героя — догнать не может (проверка ниже)',
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

check('task 27: every move of the Jailer (task 48: of the Troll) is a threat of the table or listed outside it with a reason; no record of an unknown move', () => {
  const recorded = new Set([...THREATS.flatMap(t => t.move ? [t.move] : []), ...Object.keys(MOVES_OUTSIDE)]);
  const moves: readonly string[] = [...new Set([...JAILER_MOVES, ...TROLL_MOVES, ...CHIEF_MOVES])];
  const missing = moves.filter(m => !recorded.has(m));
  assert(!missing.length, `the bosses' moves with no record of their window: ${missing.join(', ')}`);
  const stale = [...recorded].filter(m => !moves.includes(m));
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

check("task 57а: the patterns leave a gap — between the slinger's lines at its nearest aim and between the hive's wasps at its nearest swell the hero's body passes; the wisp is slower than the hero; the wisp lights 1.6 s from its marker", () => {
  const r = heroRadius(RUN), a = (RUN.slingSpread ?? 20) * Math.PI / 180;
  // Rays from the slinger's centre: a point on the middle line at d, h aside, is (d sin a − h cos a) from the side line.
  const slingFree = (SLING_MIN * Math.sin(a) - (STONE_RADIUS + r)) / Math.cos(a) - (STONE_RADIUS + r);
  const n = RUN.hiveRing ?? HIVE_RING, hiveFree = 2 * (HIVE_NEAR * Math.sin(Math.PI / n) - (WASP_RADIUS + r));
  console.log(`   пращник: свободно между линиями на ${SLING_MIN} ед. — ${round2(slingFree)}; улей: просвет на ${HIVE_NEAR} ед. — ${round2(hiveFree)}`);
  assert(slingFree >= 0 && hiveFree >= 0, `a gap closed (slinger ${slingFree}, hive ${hiveFree})`);
  assert((RUN.wispSpeed ?? WISP_SPEED) < RUN.heroSpeed, `the wisp is slower than the hero (${RUN.wispSpeed} < ${RUN.heroSpeed})`);
  assert(round2(RUN.markerDelay + WISP_LIGHT) === 1.6, `marker + lighting ${RUN.markerDelay + WISP_LIGHT}`);
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
