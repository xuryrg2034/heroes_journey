/**
 * Task 49 «Второй герой», the view of the fight (view/toadLesson.ts, view/loopHint.ts `only`, view/buildColumn.ts `buildEntries`):
 * the mage's lesson on the spot read from real dashes of the simulation (journalled commands, the run's values) — the labels «Замкни на
 * себя» and «Без кольца — без щита» once per viewer, the hand's links, the crack, the brighter shield after the first seal; the lesson never
 * changes the world (the hash with and without it is the same); the cat gets nothing; the column keeps the form «Печать» and has no row
 * for the law module. Node only: `npm run test:realtime-toad-view`. The end-to-end view is tests/realtime-toad-fight.spec.ts.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import './nodeNavigator.testkit';
import { registerArena } from '../sim/arenas';
import { FORMS, HERO_LAWS } from '../sim/buildIds';
import type { Vec } from '../sim/geometry';
import type { Loadout } from '../sim/kit';
import { defaultParams, type Params } from '../sim/params';
import { Simulation } from '../sim/simulation';
import { rtRunParams, RT_FORMS_PARAMS } from '../run/rtRun';
import { buildEntries } from './buildColumn';
import { HintStore } from './hints';
import { findLoopHint } from './loopHint';
import { isToad, TOAD_BARE_LIFE, TOAD_HAND_IDLE, TOAD_KEYS, TOAD_TEXT, ToadLesson } from './toadLesson';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'toad-view-field', name: 'Поле вида', summary: 'Тест вида Ведуньи', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
function quiet(): Params {
  const p = { ...rtRunParams(defaultParams()), ...RT_FORMS_PARAMS };
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.enemySpeed = 0; p.speedSpread = 0; p.heroHp = 40; p.hitstop = false;
  return p;
}
function field(loadout: Loadout, k = 1): Simulation {
  const sim = new Simulation({ arena: 'toad-view-field', params: quiet(), seed: seedOf(k), record: true, hero: { hp: 40, maxHp: 40 }, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, at: Vec, color = 0, hp = 0): number => sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind: 'basic' }) as number;
const draw = (sim: Simulation, pts: readonly Vec[]): void => { sim.command({ t: 'begin', x: pts[0].x, y: pts[0].y }); for (const p of pts.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); };
const ARC: Vec[] = [{ x: 6, y: 3.6 }, { x: 7.6, y: 5 }, { x: 6, y: 6.4 }];
const THREAD: Vec[] = [{ x: 6, y: 5 }, { x: 7.5, y: 5 }, { x: 9, y: 5 }];

/** One frame of the host's order: the sim's tick, then the lesson reads the frame's events, then the events are cleared. */
interface Frame { specs: string[]; hand: number; crack: boolean; boost: boolean }
function frames(sim: Simulation, lesson: ToadLesson | null, n: number, figure = false): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < n; i++) {
    sim.tick();
    const w = sim.world;
    const fig = figure && lesson?.needsFigure(w) ? findLoopHint(w, 'hero') : null;
    const f = lesson?.frame(w, 1 / 60, fig);
    out.push({ specs: f?.specs.map(s => s.text) ?? [], hand: f?.hand.length ?? 0, crack: f?.crack ?? false, boost: f?.boost ?? false });
    w.events.length = 0;
  }
  return out;
}
const TOAD: Loadout = { hero: 'toad' };

check('the loadout: isToad reads the kit (her law module); the cat\'s world is not hers', () => {
  assert(isToad(field(TOAD).world) && !isToad(field({}).world), 'isToad');
});

check('the arc on the hero: the label stands while the figure is ready and no chain is drawn; the hand comes after the rest; `only` filters the figure', () => {
  const sim = field(TOAD), lesson = new ToadLesson(new HintStore(null));
  for (const p of ARC) place(sim, p);
  place(sim, { x: 6.2, y: 5 }, 1, 3);
  const seen = frames(sim, lesson, 30, true);
  assert(seen.every(f => f.specs.join() === TOAD_TEXT.ring) && seen.every(f => f.hand === 0), 'label at once, no hand yet');
  const figure = findLoopHint(sim.world, 'hero');
  assert(figure !== null && figure.kind === 'hero' && figure.ring.length === 4, 'the arc is a hero figure');
  assert(findLoopHint(sim.world, 'first') === null, 'only filters the other figure out');
  const late = frames(sim, lesson, Math.ceil(TOAD_HAND_IDLE * 60), true);
  assert(late[late.length - 1].hand === 3, `the hand draws the 3 links of the ring: ${late[late.length - 1].hand}`);
});

check('the first seal: both go for good, the brighter glow lasts the first seal\'s shield only; the world is the same with and without the lesson', () => {
  const run = (withLesson: boolean): { sim: Simulation; all: Frame[]; store: HintStore } => {
    const sim = field(TOAD), store = new HintStore(null), lesson = withLesson ? new ToadLesson(store) : null;
    for (const p of ARC) place(sim, p);
    place(sim, { x: 6.2, y: 5 }, 1, 3);
    const all = frames(sim, lesson, 5, true);
    draw(sim, ARC); sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' }); sim.command({ t: 'release' });
    all.push(...frames(sim, lesson, 200, true));
    return { sim, all, store };
  };
  const a = run(true), b = run(false);
  assert(a.sim.hash() === b.sim.hash(), 'the lesson reads, never writes: the same hash');
  assert(a.store.count(TOAD_KEYS.ring) === 1, 'the first seal is in the memory');
  assert(a.all.some(f => f.boost), 'the brighter glow came');
  const last = a.all[a.all.length - 1];
  assert(!last.boost && last.specs.length === 0 && last.hand === 0, 'after the shield: no boost, no label, no hand');
});

check('the price: the first hit right after an open chain cracks once and says «Без кольца — без щита» for its life', () => {
  const sim = field(TOAD), store = new HintStore(null), lesson = new ToadLesson(store);
  sim.command({ t: 'param', key: 'contactDamage', value: 1 });
  for (const p of THREAD) place(sim, p);
  draw(sim, THREAD); sim.command({ t: 'release' });
  let all: Frame[] = [];
  for (let i = 0; i < 400 && (i === 0 || sim.world.move); i++) all.push(...frames(sim, lesson, 1));
  assert(!sim.world.move && all.every(f => !f.crack), 'the dash is over, no hit yet');
  assert(sim.world.hero.chainShield === 0, 'the thread gave no shield');
  const h = sim.world.hero;
  place(sim, { x: h.x + 0.4, y: h.y }, 2, 9);
  all = frames(sim, lesson, 60);
  assert(all.filter(f => f.crack).length === 1, 'one crack');
  assert(all.some(f => f.specs.includes(TOAD_TEXT.bare)), 'the label');
  assert(store.count(TOAD_KEYS.bare) === 1, 'in the memory');
  all = frames(sim, lesson, Math.ceil(TOAD_BARE_LIFE * 60) + 20);
  assert(all[all.length - 1].specs.every(t => t !== TOAD_TEXT.bare), 'gone after its life');
  assert(all.every(f => !f.crack), 'no second crack');
});

check('a hit long after the chain (outside the window) is not «right after»; the cat needs no figure', () => {
  const sim = field(TOAD), lesson = new ToadLesson(new HintStore(null));
  sim.command({ t: 'param', key: 'contactDamage', value: 1 });
  for (const p of THREAD) place(sim, p);
  draw(sim, THREAD); sim.command({ t: 'release' });
  for (let i = 0; i < 400 && (i === 0 || sim.world.move); i++) frames(sim, lesson, 1);
  frames(sim, lesson, 150);
  const h = sim.world.hero;
  place(sim, { x: h.x + 0.4, y: h.y }, 2, 9);
  const all = frames(sim, lesson, 60);
  assert(all.every(f => !f.crack), 'no crack: the chain was long ago');
  assert(!new ToadLesson(new HintStore(null)).needsFigure(field({}).world), 'the cat needs no figure');
});

check('the column: the innate «Печать» is a row, the law module has none; the cat\'s column is as before', () => {
  const ids = buildEntries(field(TOAD).world).map(e => e.id);
  assert(ids.includes(FORMS.seal) && !ids.includes(HERO_LAWS.toad), `rows ${ids}`);
  assert(buildEntries(field({}).world).length === 0, 'the cat holds nothing');
});

console.log('toad view: all checks passed');
