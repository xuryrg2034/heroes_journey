/**
 * Test kit (Node specs only, not imported by the game): a recorded sandbox fight with the cursed chest (К7, sim/chest.ts) on,
 * played by real commands, for the telemetry specs (src/realtime/sim/chest.spec.ts, scripts/realtime-report.spec.ts). A quiet
 * field with an authored chest point: nobody walks, no newcomers; an enemy hurts the hero only when the test puts it on him.
 *
 * What the player does, in order (`take: true`):
 * 1. A weak enemy on the hero: a plain touch (1 HP), before the chest.
 * 2. The hero walks onto the chest: the curse starts.
 * 3. An archer shoots the standing hero: an arrow (1 HP, cursed — an arrow gets no bonus, but it is damage while cursed).
 * 4. A weak enemy on the hero: a cursed touch (2 HP).
 * 5. Three chains (5 + 5 + 3 weak enemies): the 12th kill of the dash lifts the curse.
 * 6. A weak enemy on the hero: a plain touch (1 HP), after the curse.
 * With `take: false` the hero never goes to the chest: steps 1 and 6 only.
 */
import { registerArena } from '../sim/arenas';
import type { Command } from '../sim/commands';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { Enemy, WorldEvent } from '../sim/world';
import { createFightObserver } from './observe';
import type { FightSummary } from './schema';

export const CHEST_TEST_ARENA = 'tlm-chest-field';
const CHEST_AT = { x: 8, y: 6 };

registerArena({
  id: CHEST_TEST_ARENA, name: 'Поле сундука (телеметрия)', summary: 'Тест телеметрии проклятого сундука', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999, chest: CHEST_AT,
});

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export interface ChestFight {
  sim: Simulation;
  /** The summary of an observer that watched it live (commands and ticks as they happened). */
  summary: FightSummary;
  /** Every `hit` event of the fight in order: what the hero took, from whom (the test compares the summary with them). */
  hits: { damage: number; source: string; cursed: boolean }[];
  /** Every event of the fight. */
  events: WorldEvent[];
}

export function playChestFight(take = true, seed = 20261012): ChestFight {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 1; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.cursedChest = true;
  for (const phase of p.phases) phase.floor = 0;
  const sim = new Simulation({ arena: CHEST_TEST_ARENA, params: p, seed, record: true });
  const w = sim.world, live = createFightObserver(w), events: WorldEvent[] = [], hits: ChestFight['hits'] = [];
  // The curse is on between the `chest` and `curseLifted` events — read from the events themselves, in order.
  let cursed = false;
  const drain = (): void => {
    for (const ev of w.events) {
      if (ev.type === 'chest') cursed = true;
      else if (ev.type === 'curseLifted') cursed = false;
      else if (ev.type === 'hit') hits.push({ damage: ev.damage, source: ev.source, cursed });
    }
    events.push(...w.events);
    w.events.length = 0;
  };
  const cmd = (c: Command): unknown => { const out = sim.command(c); live.command(c, w); drain(); return out; };
  const tick = (n: number, until: () => boolean = () => false): void => {
    for (let i = 0; i < n && w.status === 'playing' && !until(); i++) {
      sim.tick(); live.tick(w); drain();
    }
  };
  const place = (x: number, y: number, kind = 'basic', color = 0, hp = 0): Enemy => {
    const id = cmd({ t: 'place', x, y, color, hp, kind }) as number;
    return w.enemies.find(e => e.id === id)!;
  };
  /** A weak enemy placed on the hero hits once (after his invulnerability ran out); then the arena is cleared. */
  const touch = (): void => {
    tick(180, () => w.hero.invulnerable <= 0 && w.hero.chainShield <= 0);
    const before = hits.length;
    place(w.hero.x + 0.3, w.hero.y, 'basic', 1);
    tick(60, () => hits.length > before);
    assert(hits.length === before + 1, 'the touch hurt the hero once');
    cmd({ t: 'clear', keepMarked: false });
  };
  /** `n` weak enemies of one colour drawn as a chain and released; ticks until the dash ends. */
  const chain = (n: number): void => {
    cmd({ t: 'teleport', x: 4, y: 3 });
    const links = Array.from({ length: n }, (_, i) => place(w.hero.x + 1.2 * (i + 1) - 0.6, w.hero.y + 2 - (i % 2) * 0.3));
    cmd({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const e of links.slice(1)) cmd({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    assert(w.chain.length === n, `the chain took ${w.chain.length} of ${n}`);
    cmd({ t: 'release' });
    tick(1);
    tick(900, () => !w.move);
  };

  cmd({ t: 'clear', keepMarked: false });
  touch();
  if (take) {
    cmd({ t: 'teleport', x: CHEST_AT.x - 1.2, y: CHEST_AT.y });
    cmd({ t: 'walk', x: 1, y: 0 });
    tick(120, () => !!w.curse);
    cmd({ t: 'walk', x: 0, y: 0 });
    assert(w.curse?.by === 'touch', 'the chest is taken');
    cmd({ t: 'teleport', x: 12, y: 6 });
    tick(180, () => w.hero.invulnerable <= 0);
    const before = hits.length;
    place(17, 6, 'archer', 2);
    tick(400, () => hits.length > before);
    assert(hits.length === before + 1 && hits[before].source === 'arrow', `an arrow hit (${JSON.stringify(hits.slice(before))})`);
    cmd({ t: 'clear', keepMarked: false });
    touch();
    chain(5); chain(5); chain(3);
    assert(w.curse?.lifted !== undefined, 'the curse is lifted');
    cmd({ t: 'teleport', x: 12, y: 6 });
  }
  touch();
  return { sim, summary: live.summary(), hits, events };
}
