/**
 * Task 21 «Почему погиб» (view/deathSeries.ts; design 15.10.2026, docs/design-notes/tasks-21-25.md). Node only:
 * `npm run test:realtime-death-series`.
 * - the line's rules on hand-written hits: the main source (most hits; a tie — more damage, then the later), «×N за t с» (up, at
 *   least 1), «· последний — …» when the last is another, one hit «1 удар · −N HP», the 5 s window, the sapper's marks;
 * - real run fights (journalled commands on the quiet test field, runFight.testkit.ts), the hits read every tick as main.ts reads
 *   them every frame: a ring of touching enemies — «касание ×N»; sappers lit by touch — «(поджёг касанием)»; sappers killed by the
 *   chain beside the hero — «(убит тобой)». Expected texts are written by hand.
 */
import { createRtRun } from '../run/rtRun';
import { assert, playFight, seedOf, takeGift, ticks, toBattle } from '../run/runFight.testkit';
import type { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { DeathSeries, deathSeriesLine, type SeriesHit } from './deathSeries';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const touch = (t: number, damage = 1): SeriesHit => ({ t, source: 'touch', damage });

check('the line on hand-written hits: main source, seconds up, the last one, one hit, the window, ties', () => {
  // Six touches over 3.2 s, then the blast: «касание ×6 за 4 с · последний — взрыв сапёра».
  const six = [0.8, 1.4, 2, 2.6, 3.2, 4].map(t => touch(t));
  assert(deathSeriesLine([...six, { t: 4.4, source: 'blast', damage: 2 }]) === 'касание ×6 за 4 с · последний — взрыв сапёра', deathSeriesLine([...six, { t: 4.4, source: 'blast', damage: 2 }])!);
  // The main source is the last: no «последний». A wolf's and a reaper's touch are «касание» too.
  assert(deathSeriesLine([touch(1), { t: 1.6, source: 'wolf', damage: 1 }, { t: 2.1, source: 'reaper', damage: 1 }]) === 'касание ×3 за 2 с', 'touch kinds');
  // At least 1 s.
  assert(deathSeriesLine([touch(5), touch(5.3)]) === 'касание ×2 за 1 с', 'one second at least');
  // One hit in the window: the damage.
  assert(deathSeriesLine([{ t: 9, source: 'slot-bust', damage: 4 }]) === '1 удар · −4 HP', 'one hit');
  assert(deathSeriesLine([touch(1), touch(1.5), { t: 9, source: 'slot-bust', damage: 4 }]) === '1 удар · −4 HP', 'older hits out of the 5 s window');
  // A tie of counts: the more damage wins (the arrows), then the later.
  assert(deathSeriesLine([touch(1), { t: 2, source: 'arrow', damage: 2 }, touch(3), { t: 4, source: 'arrow', damage: 2 }, { t: 5, source: 'blast', damage: 2 }]) === 'стрела лучника ×2 за 3 с · последний — взрыв сапёра', 'damage tie');
  assert(deathSeriesLine([{ t: 1, source: 'arrow', damage: 1 }, touch(2), { t: 3, source: 'arrow', damage: 1 }, touch(4)]) === 'касание ×2 за 2 с', 'the later wins');
  // The goblin's rain and volley are one name.
  assert(deathSeriesLine([{ t: 1, source: 'slot-rain', damage: 1 }, { t: 1.5, source: 'slot-volley', damage: 1 }]) === 'стрелы гоблина ×2 за 1 с', 'goblin arrows');
  // The sapper's marks, on the last hit.
  assert(deathSeriesLine([touch(1), touch(2), { t: 3, source: 'blast', damage: 2, blame: 'touch' }]) === 'касание ×2 за 2 с · последний — взрыв сапёра (поджёг касанием)', 'mark on the last');
  assert(deathSeriesLine([{ t: 1, source: 'blast', damage: 2, blame: 'yours' }, { t: 2.5, source: 'blast', damage: 2, blame: 'yours' }]) === 'взрыв сапёра ×2 за 2 с (убит тобой)', 'mark on the main');
  assert(deathSeriesLine([{ t: 1, source: 'blast', damage: 2, blame: 'yours' }]) === '1 удар · −2 HP (убит тобой)', 'mark on one hit');
  assert(deathSeriesLine([]) === null, 'no hits');
});

const newRun = (k: number) => toBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini' })));
/** A run fight played to its defeat by `finish`, its hits read by the series every tick (as main.ts every frame). */
function lostFight(k: number, finish: (sim: Simulation, seen: (w: World) => void) => void): { series: DeathSeries; hits: { t: number; source: string }[] } {
  const series = new DeathSeries(), hits: { t: number; source: string }[] = [];
  playFight(newRun(k), { chains: [], k, finish, seen: w => {
    series.read(w, w.events); series.seen(w);
    for (const ev of w.events) if (ev.type === 'hit') hits.push({ t: w.time, source: ev.source });
  } });
  return { series, hits };
}

check('a real run fight: a ring of touching enemies — «касание ×N за t с», N the touches of the last 5 s', () => {
  const { series, hits } = lostFight(21, (sim, seen) => {
    sim.command({ t: 'param', key: 'contactDamage', value: 1 });
    sim.command({ t: 'param', key: 'enemySpeed', value: 1.2 });
    const hero = sim.world.hero;
    for (let k = 0; k < 8; k++) sim.command({ t: 'place', x: hero.x + Math.cos(k * Math.PI / 4) * 0.6, y: hero.y + Math.sin(k * Math.PI / 4) * 0.6, color: k % 4, hp: 2, kind: 'basic' });
    ticks(sim, 60 * 120, seen);
  });
  const last = hits.at(-1)!, inWindow = hits.filter(h => h.t >= last.t - 5 - 1e-9);
  assert(hits.length >= 2 && hits.every(h => h.source === 'touch'), JSON.stringify(hits));
  const line = series.line()!;
  assert(line.startsWith(`касание ×${inWindow.length} за `) && !line.includes('последний'), line);
  console.log(`  ${line}`);
});

check('a real run fight: sappers lit by touch blow up — the series says «(поджёг касанием)»', () => {
  const { series, hits } = lostFight(22, (sim, seen) => {
    // They walk (the quiet field stands everyone still): each one reaches the hero and lights its fuse by the touch.
    sim.command({ t: 'param', key: 'enemySpeed', value: 1.2 });
    for (let n = 0; n < 20 && sim.world.status === 'playing'; n++) {
      const hero = sim.world.hero;
      sim.command({ t: 'place', x: hero.x - 0.6, y: hero.y, color: 0, hp: 0, kind: 'sapper' });
      ticks(sim, 60 * 5, seen, w => !w.enemies.length && !w.blasts.length);
    }
  });
  assert(hits.every(h => h.source === 'blast'), JSON.stringify(hits));
  const line = series.line()!;
  assert(/^(взрыв сапёра ×\d+ за \d+ с|1 удар · −\d+ HP) \(поджёг касанием\)$/.test(line), line);
  console.log(`  ${line}`);
});

check('a real run fight: sappers killed by the chain beside the hero — the series says «(убит тобой)»', () => {
  const { series, hits } = lostFight(23, (sim, seen) => {
    sim.command({ t: 'param', key: 'chainShield', value: 0 });
    for (let n = 0; n < 20 && sim.world.status === 'playing'; n++) {
      const hero = sim.world.hero, at = { x: hero.x + 1.2, y: hero.y };
      sim.command({ t: 'place', x: at.x, y: at.y, color: 0, hp: 0, kind: 'sapper' });
      assert(sim.command({ t: 'begin', x: at.x, y: at.y }) === true, 'the chain takes the sapper');
      sim.command({ t: 'release' });
      seen(sim.world); sim.world.events.length = 0;
      ticks(sim, 60 * 5, seen, w => !w.move && !w.enemies.length && !w.blasts.length && w.hero.invulnerable <= 0);
    }
  });
  assert(hits.length >= 1 && hits.every(h => h.source === 'blast'), JSON.stringify(hits));
  const line = series.line()!;
  assert(/^(взрыв сапёра ×\d+ за \d+ с|1 удар · −\d+ HP) \(убит тобой\)$/.test(line), line);
  console.log(`  ${line}`);
});

console.log(`\ndeath series: ${checks} checks passed`);
