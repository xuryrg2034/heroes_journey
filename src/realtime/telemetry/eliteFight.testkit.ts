/**
 * Test kit (Node specs only, not imported by the game): a recorded sandbox fight with the package «Урон имеет значение»
 * (docs/realtime-damage.md) on — armoured elites (`eliteArmor`, 3 plates) and the raised touch (`toughTouch`) — played by
 * real commands, for the observer and the report specs (threats.spec.ts, scripts/realtime-report.spec.ts). A quiet field:
 * nobody walks, no newcomers; touches hurt only at the end (`contactDamage` 0 until then).
 *
 * What the player does, in order:
 * 1. Elite A between two weak links: the chain goes through it (−1 plate, the links after it die). A second chain ends on A
 *    (−1 plate; not a survivor). A bomb takes the last plate (the window opens); a chain at once kills A — a clean break.
 * 2. The goals are done (the `goals` command).
 * 3. Elite B: two bombs (3 → 1 → 0), the hero waits 1.5 s of the window, then a chain kills B — a late kill in the window;
 *    the hero steps on a loot (picked up).
 * 4. A chain of a weak link and a tough one (HP 3) behind it: the tough one survives (a real survivor; tough not first).
 * 5. Touches on: the hero steps into a tough enemy of HP 2 (a raised touch, 2), walks off, then into one of HP 1 (1).
 * Elite C stands untouched to the end (alive at the end).
 */
import { registerArena } from '../sim/arenas';
import type { Command } from '../sim/commands';
import type { Vec } from '../sim/geometry';
import { defaultParams } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import { touchDistanceOf, type Enemy, type WorldEvent } from '../sim/world';
import { createFightObserver } from './observe';
import type { FightSummary } from './schema';

export const ELITE_TEST_ARENA = 'tlm-elite-field';

registerArena({
  id: ELITE_TEST_ARENA, name: 'Поле элит (телеметрия)', summary: 'Тест телеметрии пакета «Урон имеет значение»', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export interface EliteFight {
  sim: Simulation;
  /** The summary of an observer that watched it live (commands and ticks as they happened). */
  summary: FightSummary;
  /** Game seconds from placing elites A and B to their deaths, by the test's own clock. */
  lifeA: number;
  lifeB: number;
  /** Every event of the fight (the test reads the loot picked from them). */
  events: WorldEvent[];
}

export function playEliteFight(seed = 20261011): EliteFight {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.eliteArmor = true; p.elitePlates = 3; p.toughTouch = true;
  const sim = new Simulation({ arena: ELITE_TEST_ARENA, params: p, seed, record: true, loadout: { items: { bomb: 3 }, openItems: ['frost'] } });
  const w = sim.world, live = createFightObserver(w), events: WorldEvent[] = [];
  const cmd = (c: Command): unknown => { const out = sim.command(c); live.command(c, w); events.push(...w.events); w.events.length = 0; return out; };
  const tick = (n: number): void => {
    for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); live.tick(w); events.push(...w.events); w.events.length = 0; }
  };
  const settle = (): void => { tick(1); for (let i = 0; i < 900 && w.move; i++) tick(1); };
  const place = (q: Vec, color: number, hp: number, elite = false): Enemy => {
    const id = cmd({ t: 'place', x: q.x, y: q.y, color, hp, kind: 'basic', ...elite ? { elite: true } : {} }) as number;
    return w.enemies.find(e => e.id === id)!;
  };
  const chain = (links: readonly Vec[]): void => {
    assert(cmd({ t: 'begin', x: links[0].x, y: links[0].y }), 'the chain starts');
    for (const q of links.slice(1)) cmd({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
    assert(w.chain.length === links.length, `the chain takes ${links.length} links (${w.chain.length})`);
    assert(cmd({ t: 'release' }), 'released');
    settle();
  };
  const alive = (e: Enemy): boolean => w.enemies.includes(e);
  const plates = (e: Enemy): number => e.armor?.plates ?? -1;
  const diedAt = (e: Enemy): number => { const d = events.find(x => x.type === 'eliteDown' && x.enemyId === e.id); assert(d, 'eliteDown'); return dieTimes.get(e.id)!; };
  // The test's own clock of the deaths: the world time after the tick or command whose events had the elite's `kill`.
  const dieTimes = new Map<number, number>();
  const clockDeaths = (from: number): void => { for (const ev of events.slice(from)) if (ev.type === 'kill' && !dieTimes.has(ev.enemyId)) dieTimes.set(ev.enemyId, w.time); };

  cmd({ t: 'clear', keepMarked: false });
  cmd({ t: 'teleport', x: 4.5, y: 5 });
  const bornA = w.time;
  const a1 = { x: 6, y: 5 }, A = place({ x: 7.5, y: 5 }, 0, 0, true), b1 = { x: 9, y: 5 };
  place(a1, 0, 0); place(b1, 0, 0);
  const a2 = { x: 8.5, y: 6.2 };
  place(a2, 0, 0);
  const B = place({ x: 12, y: 9 }, 1, 0, true), C = place({ x: 18, y: 10.5 }, 3, 0, true);
  assert(plates(A) === 3 && plates(B) === 3 && plates(C) === 3, 'three plates each');

  // 1. Elite A.
  chain([a1, A, b1]);
  assert(alive(A) && plates(A) === 2, `A: through it, 2 plates (${plates(A)})`);
  chain([a2, A]);
  assert(alive(A) && plates(A) === 1, `A: the chain ends on it, 1 plate (${plates(A)})`);
  cmd({ t: 'item', kind: 'bomb', x: A.x, y: A.y });
  tick(1);
  assert(plates(A) === 0 && (A.armor?.clean ?? 0) > 0, 'A: the window, its clean second');
  let from = events.length;
  chain([A]);
  clockDeaths(from);
  assert(!alive(A), 'A: killed in the window');
  const lifeA = diedAt(A) - bornA;

  // 2. The goals.
  cmd({ t: 'goals' });

  // 3. Elite B: two bombs, a late kill.
  cmd({ t: 'teleport', x: 12, y: 7.8 });
  cmd({ t: 'item', kind: 'bomb', x: B.x, y: B.y });
  tick(1);
  cmd({ t: 'item', kind: 'bomb', x: B.x, y: B.y });
  tick(1);
  assert(plates(B) === 0 && (B.armor?.open ?? 0) > 0, `B: the window (${plates(B)})`);
  tick(Math.round(1.5 / SIM_DT));
  assert((B.armor?.open ?? 0) > 0 && !B.armor?.clean, 'B: still in the window, past its clean second');
  from = events.length;
  chain([B]);
  clockDeaths(from);
  assert(!alive(B), 'B: killed late in the window');
  const lifeB = diedAt(B) - bornA;
  // The hero steps on B's loot: picked up.
  const loot = w.objects.find(o => o.kind === 'loot');
  assert(loot, 'B dropped its loot');
  cmd({ t: 'teleport', x: loot.x, y: loot.y });
  tick(2);
  assert(!w.objects.includes(loot), 'the loot is picked up');

  // 4. A tough one behind a weak one: a real survivor.
  const d = { x: 15, y: 3 }, t = { x: 16.5, y: 3 };
  place(d, 2, 0);
  const tough = place(t, 2, 3);
  cmd({ t: 'teleport', x: 13.5, y: 3 });
  chain([d, t]);
  assert(alive(tough) && tough.hp > 0, `the tough one survives (${tough.hp} HP)`);

  // 5. The touches: HP 2 (raised, 2) and HP 1 (1).
  cmd({ t: 'param', key: 'contactDamage', value: 1 });
  const u = place({ x: 3, y: 10 }, 4, 2), v = place({ x: 8, y: 10 }, 4, 1);
  const touch = (e: Enemy): void => {
    cmd({ t: 'teleport', x: e.x + touchDistanceOf(p, e) - 0.05, y: e.y });
    const before = events.length;
    for (let i = 0; i < 30 && !events.slice(before).some(x => x.type === 'hit'); i++) tick(1);
    cmd({ t: 'teleport', x: 6, y: 1.5 });
    tick(Math.round(3 / SIM_DT));
  };
  touch(u);
  touch(v);
  assert(alive(C) && plates(C) === 3, 'C: untouched');
  return { sim, summary: live.summary(), lifeA, lifeB, events };
}
