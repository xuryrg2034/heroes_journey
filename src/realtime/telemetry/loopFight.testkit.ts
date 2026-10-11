/**
 * Test kit (Node specs only, not imported by the game): a recorded sandbox fight with the loop «Печать» on (loop research,
 * step 2; docs/realtime-loop-research.md, 3.3), played by real commands, for the observer and the report specs
 * (threats.spec.ts, recorder.spec.ts). Geometry from src/realtime/sim/loop.spec.ts: squares of 4 links at side 2, the hero
 * 1.8 from the first link. A quiet field: nobody walks or touches, no newcomers.
 *
 * What the player does, in order:
 * 1. A crossed zigzag Z of 4 links: the pointer on its first link three times — refused («нить пересеклась») each time, the
 *    chain unchanged; a step back off Z4 and Z4 taken again 3 focus ticks later (0.2 real s, a re-add); the pointer on the
 *    first link again — refused after a chain change; cancel.
 * 2. A square S of 4 links round two enemies (one weak, one tough): a step back off S4 and S4 taken again 6 focus ticks
 *    later (0.4 real s but only 0.1 game s — not a re-add); close on S1, open on S4, close again; release — the seal
 *    strikes both, kills the weak one.
 * 3. A square T with nobody inside: close, release — an empty seal.
 */
import { registerArena } from '../sim/arenas';
import { tickScale } from '../sim/chain';
import type { Command } from '../sim/commands';
import type { Vec } from '../sim/geometry';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import { createFightObserver, tickRealCost } from './observe';
import type { FightSummary } from './schema';

export const LOOP_TEST_ARENA = 'tlm-loop-field';

registerArena({
  id: LOOP_TEST_ARENA, name: 'Поле петли (телеметрия)', summary: 'Тест телеметрии петли', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export interface LoopFight {
  /** The recorded fight (its journal replays in the report). */
  sim: Simulation;
  /** The summary of an observer that watched it live (commands and ticks as they happened). */
  summary: FightSummary;
  /** Ticks where the observer's tick price was compared with `Simulation.nextTickCost` (all agreed). */
  priced: number;
  /** Ticks run in focus (the game slowed). */
  focusTicks: number;
  /** The weak and the tough enemy inside the square S. */
  weak: number;
  tough: number;
}

/** The zigzag of loop.spec («crossed»: the closing edge crosses the ring), moved right. */
const ZIGZAG: Vec[] = [{ x: 14, y: 4 }, { x: 14, y: 5.5 }, { x: 15.5, y: 4 }, { x: 15.5, y: 5.5 }];
const SQUARE: Vec[] = [{ x: 6, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 6 }, { x: 6, y: 6 }];
const EMPTY_SQUARE: Vec[] = SQUARE.map(p => ({ x: p.x, y: p.y + 4 }));

export function playLoopFight(seed = 20261011): LoopFight {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false;
  p.loopEnabled = true;
  const sim = new Simulation({ arena: LOOP_TEST_ARENA, params: p, seed, record: true });
  const live = createFightObserver(sim.world);
  let priced = 0, focusTicks = 0;
  const cmd = (c: Command): unknown => { const out = sim.command(c); live.command(c, sim.world); return out; };
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) {
      assert(tickRealCost(sim.world) === sim.nextTickCost(), `tick ${sim.world.tick}: the observer's price ${tickRealCost(sim.world)} ≠ ${sim.nextTickCost()}`);
      priced++;
      if (tickScale(sim.world) < 1) focusTicks++;
      sim.tick(); live.tick(sim.world); sim.world.events.length = 0;
    }
  };
  const at = (q: Vec): void => { cmd({ t: 'drag', x: q.x, y: q.y, mode: 'full' }); };
  const place = (q: Vec, color: number, hp = 0): number => cmd({ t: 'place', x: q.x, y: q.y, color, hp, kind: 'basic' }) as number;
  const lastEvent = (): string => { const e = sim.world.events.filter(x => x.type === 'loop').pop(); return e?.type === 'loop' ? `${e.action}${e.refusal ? `/${e.refusal}` : ''}` : 'none'; };
  // A function, not the field: the type checker would keep a length it narrowed across commands.
  const len = (): number => sim.world.chain.length;
  const inFocus = (): void => assert(tickScale(sim.world) === p.focusSlow, `focus runs (scale ${tickScale(sim.world)})`);

  cmd({ t: 'clear', keepMarked: false });
  for (const q of SQUARE) place(q, 0);
  const weak = place({ x: 7, y: 5 }, 2, 0), tough = place({ x: 7.4, y: 5.4 }, 2, 3);
  for (const q of ZIGZAG) place(q, 1);
  for (const q of EMPTY_SQUARE) place(q, 3);

  // 1. The zigzag: a refusal repeated, a quick step back and re-add, the refusal after the change, cancel.
  cmd({ t: 'teleport', x: 12.5, y: 5 });
  assert(cmd({ t: 'begin', x: ZIGZAG[0].x, y: ZIGZAG[0].y }), 'Z: begins');
  for (const q of ZIGZAG.slice(1)) at(q);
  assert(len() === 4, `Z: 4 links (${len()})`);
  tick(2);
  for (let i = 0; i < 3; i++) {
    at(ZIGZAG[0]);
    assert(lastEvent() === 'refused/crossed' && len() === 4, `Z: refused ${i + 1} (${lastEvent()})`);
    tick(2);
  }
  at(ZIGZAG[2]);
  assert(len() === 3, 'Z: the step back');
  inFocus();
  tick(3);
  at(ZIGZAG[3]);
  assert(len() === 4, 'Z: Z4 taken again');
  at(ZIGZAG[0]);
  assert(lastEvent() === 'refused/crossed', 'Z: refused after the change');
  cmd({ t: 'cancel' });
  tick(40);

  // 2. The square: a slow step back and re-add, close, open, close, release — the seal on two.
  cmd({ t: 'teleport', x: 4.5, y: 5 });
  assert(cmd({ t: 'begin', x: SQUARE[0].x, y: SQUARE[0].y }), 'S: begins');
  for (const q of SQUARE.slice(1)) at(q);
  at(SQUARE[2]);
  assert(len() === 3, 'S: the step back');
  inFocus();
  tick(6);
  at(SQUARE[3]);
  assert(len() === 4, 'S: S4 taken again');
  at(SQUARE[0]);
  assert(sim.world.chainClosed === 'first' && lastEvent() === 'close', `S: closed (${lastEvent()})`);
  at(SQUARE[3]);
  assert(!sim.world.chainClosed && lastEvent() === 'open', `S: opened (${lastEvent()})`);
  at(SQUARE[0]);
  assert(sim.world.chainClosed === 'first', 'S: closed again');
  tick(2);
  assert(cmd({ t: 'release' }), 'S: released');
  tick(150);

  // 3. The empty square.
  cmd({ t: 'teleport', x: 4.5, y: 9 });
  assert(cmd({ t: 'begin', x: EMPTY_SQUARE[0].x, y: EMPTY_SQUARE[0].y }), 'T: begins');
  for (const q of EMPTY_SQUARE.slice(1)) at(q);
  at(EMPTY_SQUARE[0]);
  assert(sim.world.chainClosed === 'first', 'T: closed');
  assert(cmd({ t: 'release' }), 'T: released');
  tick(150);

  return { sim, summary: live.summary(), priced, focusTicks, weak, tough };
}
