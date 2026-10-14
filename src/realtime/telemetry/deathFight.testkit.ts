/**
 * Test kit (Node specs only, not imported by the game): recorded sandbox fights where the hero dies, played by real commands,
 * for the report's section «От чего умирают» (task 25; scripts/realtime-report.spec.ts). A quiet field: nobody walks, no
 * newcomers; an enemy hurts the hero only when the test puts it on him.
 *
 * `crowd` — the hero (6 HP) takes an arrow from an archer, dashes a chain of two (the after-chain shield goes up), and stands in a
 * crowd of three weak enemies put on him while the shield is still up: touches every 0.5 s (constant invulnerability) until he
 * falls. `quills` — the hero (1 HP) dashes a chain of two, and right after it, with the after-chain shield still up, releases a
 * chain whose first link is a porcupine with its quills up: the quills strike him in the dash, through the shield.
 *
 * The kit keeps its own clock of what happened (from the events and `world.move`, not from the observer): every hit with its tick
 * and game second, the tick the last dash ended, the tick of the defeat.
 */
import { registerArena } from '../sim/arenas';
import type { Command } from '../sim/commands';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { Enemy, EnemyKind, WorldEvent } from '../sim/world';
import { createFightObserver } from './observe';
import type { FightSummary } from './schema';

export const DEATH_TEST_ARENA = 'tlm-death-field';

registerArena({
  id: DEATH_TEST_ARENA, name: 'Поле смерти (телеметрия)', summary: 'Тест телеметрии раздела «От чего умирают»', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export type DeathScene = 'crowd' | 'quills';

export interface DeathFight {
  sim: Simulation;
  /** The summary of an observer that watched it live (commands and ticks as they happened). */
  summary: FightSummary;
  /** Every `hit` on the hero in order, with the tick (`world.tick` after it) and the game second. */
  hits: { tick: number; time: number; source: string; damage: number }[];
  /** The tick (`world.tick`) after which the last finished move was over (null — none finished). */
  landTick: number | null;
  /** The tick of the defeat (`world.tick` after it). */
  deathTick: number;
  /** The after-chain shield left (game seconds) on the look before the lethal tick. */
  shieldBefore: number;
  events: WorldEvent[];
}

export function playDeathFight(scene: DeathScene, seed = 20261015): DeathFight {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.hitstop = false; p.survivorKnockback = false;
  p.invulnerabilityMode = 'constant'; p.invulnerability = 0.5; p.chainShield = 0.5; p.chainShieldMinKills = 1;
  p.heroHp = scene === 'crowd' ? 6 : 1;
  // The porcupine's quills are always up.
  p.porcupineDownTime = 0;
  for (const phase of p.phases) phase.floor = 0;
  const sim = new Simulation({ arena: DEATH_TEST_ARENA, params: p, seed, record: true });
  const w = sim.world, live = createFightObserver(w), events: WorldEvent[] = [], hits: DeathFight['hits'] = [];
  let landTick: number | null = null, deathTick = -1, shieldBefore = 0;
  const drain = (): void => {
    for (const ev of w.events) {
      if (ev.type === 'hit') hits.push({ tick: w.tick, time: w.time, source: ev.source, damage: ev.damage });
      else if (ev.type === 'defeat') deathTick = w.tick;
    }
    events.push(...w.events);
    w.events.length = 0;
  };
  const cmd = (c: Command): unknown => { const out = sim.command(c); live.command(c, w); drain(); return out; };
  const tick = (n: number, until: () => boolean = () => false): void => {
    for (let i = 0; i < n && w.status === 'playing' && !until(); i++) {
      const moving = !!w.move;
      shieldBefore = w.hero.chainShield;
      sim.tick(); live.tick(w); drain();
      if (moving && !w.move && w.status === 'playing') landTick = w.tick;
    }
  };
  const place = (x: number, y: number, kind: EnemyKind = 'basic', color = 0): Enemy => {
    const id = cmd({ t: 'place', x, y, color, hp: 0, kind }) as number;
    return w.enemies.find(e => e.id === id)!;
  };
  /** A chain through `links` (the first one first), released; with `settle`, ticks until the dash ends. */
  const chain = (links: Enemy[], settle: boolean): void => {
    cmd({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const e of links.slice(1)) cmd({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    assert(w.chain.length === links.length, `the chain took ${w.chain.length} of ${links.length}`);
    cmd({ t: 'release' });
    tick(1);
    if (settle) tick(900, () => !w.move);
  };

  cmd({ t: 'clear', keepMarked: false });
  if (scene === 'crowd') {
    // An arrow first (another source in the series).
    cmd({ t: 'teleport', x: 12, y: 6 });
    place(17, 6, 'archer', 2);
    tick(400, () => hits.length > 0);
    assert(hits.length === 1 && hits[0].source === 'arrow', `an arrow hit (${JSON.stringify(hits)})`);
    cmd({ t: 'clear', keepMarked: false });
    // A chain of two: the dash, then the after-chain shield.
    cmd({ t: 'teleport', x: 4, y: 3 });
    chain([place(4.6, 5), place(5.8, 4.7)], true);
    assert(w.hero.chainShield > 0 && landTick !== null, 'landed with the after-chain shield up');
    // The crowd on him while the shield is up.
    place(w.hero.x + 0.3, w.hero.y); place(w.hero.x - 0.3, w.hero.y); place(w.hero.x, w.hero.y + 0.3);
    tick(900);
  } else {
    cmd({ t: 'teleport', x: 4, y: 3 });
    chain([place(4.6, 5), place(5.8, 4.7)], true);
    assert(w.hero.chainShield > 0 && landTick !== null, 'landed with the after-chain shield up');
    const h = w.hero;
    chain([place(h.x + 1.2, h.y, 'porcupine'), place(h.x + 2.4, h.y), place(h.x + 3.6, h.y)], false);
    tick(120);
  }
  assert(w.status === 'defeat' && deathTick >= 0, `the hero died (${w.status}, HP ${w.hero.hp})`);
  return { sim, summary: live.summary(), hits, landTick, deathTick, shieldBefore, events };
}
