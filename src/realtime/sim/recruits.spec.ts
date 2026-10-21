/**
 * Task 59а «Гарнизон, шаг 3», Б — «Новобранцы» and the law of order (enemies/recruit.ts; docs/realtime-elite-behaviors.md, «Гарнизон, шаг
 * 3»). Node only: `npm run test:realtime-recruits`.
 *
 * Every check plays journalled commands (begin, drag, release, items, item, teleport, param) and looks at what the player meets:
 * - the numbers 1–4: neighbours at most two places apart, never in line order, different by seed, the same for the same seed; the route
 *   1 → 2 → 3 → 4 is always one chain;
 * - the chain takes only the current number (refusal «не по порядку», a press on another starts nothing); 1 → 4 by one chain: all fall,
 *   the highlight = the dash, +2 energy; a formation begun by an earlier chain gives none;
 * - out of order nothing hurts a recruit (the bomb: no damage, event `recruit` `refused`); the current one dies;
 * - a hit on many at once (a sapper's blast) takes a formation by its numbers: all inside — all fall; the current one outside — none;
 * - «Прямая»: the run passes the formation in its order — the highlight marks the refused, the run does the same;
 * - the law off — plain slow enemies of a line; a journal without the keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { enemyRefusal, planChain, REFUSAL_TEXT } from './chain';
import { BOLT_SOURCE, CROSSBOW } from './enemies/crossbow';
import { HAMMERS } from './buildIds';
import { RECRUIT } from './enemies/recruit';
import type { Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

/** A formation of 4 recruits of colour 0 across the yard at y = 4 (places 0…3 west to east), the hero below. */
const LINE = [8.65, 9.55, 10.45, 11.35];
registerArena({
  id: 'recruit-yard', name: 'Двор новобранцев', summary: 'Тест новобранцев', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 5.6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: LINE.map(x => ({ x, y: 4, color: 0, kind: RECRUIT, formation: 1 })),
});

/** Nothing comes, nobody walks; the hero has 99 HP. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.recruits = true;
  return Object.assign(p, extra);
}
function yard(k: number, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena: 'recruit-yard', params: quiet(extra), seed: seedOf(k), record: true });
  sim.tick();
  return sim;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** The recruits by their numbers 1…4. */
const byNumber = (w: World): Enemy[] => w.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn);
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
function release(sim: Simulation): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(3), [], w => !w.move);
}
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};

check('the numbers 1–4: neighbours at most two places apart, never in line order; different on 8 seeds, the same for the same seed; the route 1 → 4 is one chain on every seed', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const sim = yard(k), w = sim.world, line = byNumber(w);
    assert(line.length === 4 && line.map(e => e.vars.rn).join() === '1,2,3,4', `seed ${k}: numbers ${line.map(e => e.vars.rn)}`);
    const placeOf = line.map(e => LINE.findIndex(x => Math.abs(x - e.x) < 0.3));
    const key = placeOf.join('-');
    assert(placeOf.every((p, i) => i === 0 || Math.abs(p - placeOf[i - 1]) <= 2) && key !== '0-1-2-3' && key !== '3-2-1-0', `seed ${k}: places ${key}`);
    seen.add(key);
    assert(yard(k).world.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.vars.rn - b.vars.rn).map(e => e.id).join() === line.map(e => e.id).join(), `seed ${k}: the same numbers again`);
    draw(sim, line);
    assert(w.chain.length === 4, `seed ${k}: 1 → 4 in one chain (${w.chain.length})`);
  }
  assert(seen.size >= 3, `the orders differ by seed (${[...seen].join(', ')})`);
});

check('the chain takes only the current number: a press on another starts nothing (refusal «не по порядку»); 1 → 4 by one chain — all fall as the highlight says, +2 energy (event `drill`), the player\'s kills (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = yard(k), w = sim.world, line = byNumber(w);
    assert(enemyRefusal(w, line[1]) === 'order' && REFUSAL_TEXT.order === 'не по порядку', `seed ${k}: #2 refused`);
    sim.command({ t: 'begin', x: line[1].x, y: line[1].y });
    assert(w.chain.length === 0, `seed ${k}: a press on #2 starts nothing`);
    draw(sim, line);
    const plan = planChain(w);
    assert(plan.links.every(l => l.outcome?.killed), `seed ${k}: the highlight — all fall`);
    const energy = w.energy, kills = w.stats.kills, events = release(sim);
    assert(byNumber(w).length === 0 && w.stats.kills === kills + 4, `seed ${k}: all fell`);
    const drill = of(events, 'recruit').find(e => e.action === 'drill');
    assert(drill?.energy === 2 && w.energy === Math.min(7, energy + 2 + 4 * w.params.energyPerKill), `seed ${k}: +2 energy (${energy} → ${w.energy})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a formation begun by an earlier chain gives no bonus: #1 alone, then 2 → 4 (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = yard(k), w = sim.world, line = byNumber(w);
    draw(sim, [line[0]]); release(sim);
    sim.command({ t: 'teleport', x: line[1].x, y: 5.6 });
    draw(sim, line.slice(1));
    assert(w.chain.length === 3, `seed ${k}: 2 → 4 drawn`);
    const events = release(sim);
    assert(byNumber(w).length === 0 && !of(events, 'recruit').some(e => e.action === 'drill'), `seed ${k}: no bonus`);
  }
});

check('the bonus is the pass hits only (design 21.10.2026): #1 burnt by the fire consumable during the pass 1 → 4 — all fall, no bonus (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = yard(k, { fireRadius: 0.1 }), w = sim.world, line = byNumber(w);
    sim.command({ t: 'items', kind: 'fire', count: 1 });
    assert(sim.command({ t: 'item', kind: 'fire', x: line[0].x, y: line[0].y }) && line[0].burn && !line[1].burn, `seed ${k}: #1 burns alone`);
    // Released just before its burn: it dies in the pass, before the hero reaches it.
    ticks(sim, ticksOf(3), [], () => (line[0].burn?.timer ?? 0) <= 2 * SIM_DT);
    draw(sim, line);
    assert(w.chain.length === 4, `seed ${k}: 1 → 4 drawn`);
    const events = release(sim);
    const fire = of(events, 'kill').find(e => e.enemyId === line[0].id);
    assert(byNumber(w).length === 0 && fire?.source === 'fire', `seed ${k}: all fell, #1 by the fire (${fire?.source})`);
    assert(!of(events, 'recruit').some(e => e.action === 'drill'), `seed ${k}: no bonus`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the bonus by the pass: a ring of «Печать» round the formation kills it by its numbers — +2; a bolt that finishes #1 in the pass 1 → 4 — none (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = yard(k, { loopEnabled: true }), w = sim.world;
    const ring = [{ x: 10, y: 5.3 }, { x: 8.6, y: 5.1 }, { x: 7.8, y: 4 }, { x: 8.6, y: 2.9 }, { x: 10, y: 2.7 }, { x: 11.4, y: 2.9 }, { x: 12.2, y: 4 }, { x: 11.4, y: 5.1 }].map(at => place(sim, at, 0, 'basic', 1));
    draw(sim, [...ring, ring[0]]);
    const seal = planChain(w).seal;
    assert(w.chainClosed && seal && byNumber(w).every(e => seal.inside.includes(e.id)), `seed ${k}: the ring closed round the formation`);
    const events = release(sim);
    ticks(sim, 5, events);
    const drill = of(events, 'recruit').find(e => e.action === 'drill');
    assert(byNumber(w).length === 0 && drill?.energy === 2, `seed ${k}: the seal killed it by its numbers, +2 (${byNumber(w).length} left)`);
    assert(replays(sim), `seed ${k}: replay`);
    // A crossbowman above #1 shoots through it at the hero below: the bolt kills #1 in the pass.
    // No newcomers (one could stand on the bolt's line first).
    const shot = yard(k, { maxEnemies: 1 }), sw = shot.world, line = byNumber(sw), first = line[0];
    shot.command({ t: 'teleport', x: first.x, y: 6 });
    const cb = place(shot, { x: first.x, y: 1 }, 1, CROSSBOW, 2);
    ticks(shot, ticksOf(3), [], () => cb.vars.cb === 1 && cb.vars.ct <= 2 * SIM_DT);
    assert(cb.vars.cb === 1, `seed ${k}: the crossbow aims`);
    draw(shot, line);
    assert(sw.chain.length === 4, `seed ${k}: 1 → 4 drawn`);
    const passed = release(shot);
    const bolt = of(passed, 'kill').find(e => e.enemyId === first.id);
    assert(byNumber(sw).length === 0 && bolt?.source === 'bolt', `seed ${k}: all fell, #1 by the bolt (${bolt?.source}; ${JSON.stringify(of(passed, 'bolt'))}; first ${first.x.toFixed(2)},${first.y.toFixed(2)})`);
    assert(!of(passed, 'recruit').some(e => e.action === 'drill'), `seed ${k}: no bonus`);
    assert(replays(shot), `seed ${k}: replay`);
  }
});

registerArena({
  id: 'recruit-barracks', name: 'Казарма (тест)', summary: 'Тест притока новобранцев', goal: 'kills', killGoal: 999, width: 22, height: 14,
  heroStart: { x: 11, y: 12 }, obstacles: [], buttons: [], door: { x: 21.3, y: 7 }, garrison: true, enemies: [],
  newcomers: [{ kind: RECRUIT, share: 1, group: 4 }],
});

check('spec 4.3: the newcomers never bring a third formation of recruits, nor a second of the same colour — standing, at markers and in the queue (60 s with a clear every 8 s, 4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const p = defaultParams();
    p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.recruits = true;
    const sim = new Simulation({ arena: 'recruit-barracks', params: p, seed: seedOf(k), record: true }), w = sim.world;
    const seen = new Set<number>();
    let most = 0;
    for (let t = 1; t <= ticksOf(60); t++) {
      if (t % ticksOf(8) === 0) sim.command({ t: 'clear', keepMarked: false });
      sim.tick(); w.events.length = 0;
      const groups = new Map<number, number>();
      for (const e of w.enemies) if (e.kind === RECRUIT) groups.set(e.vars.fm ?? -e.id, e.color);
      for (const m of w.markers) if (m.kind === RECRUIT) groups.set(m.formation ?? -m.id, m.color);
      for (const q of w.queue) if (q.kind === RECRUIT && q.formation !== undefined) groups.set(q.formation, q.color);
      for (const g of groups.keys()) seen.add(g);
      most = Math.max(most, groups.size);
      assert(groups.size <= 2, `seed ${k}, tick ${t}: ${groups.size} formations`);
      assert(new Set(groups.values()).size === groups.size, `seed ${k}, tick ${t}: two formations of one colour (${JSON.stringify([...groups])})`);
    }
    assert(most === 2 && seen.size >= 4, `seed ${k}: the cap acted (most ${most}, formations ${seen.size})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the castle\u2019s shove (task 55а) by the law of order: a barrel shoved through #1 crushes it and rolls on; through #3 with #1 alive it stops on #3, which stays whole — the highlight\u2019s shove = the run (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    for (const n of [0, 2]) {
      const sim = yard(k, { shove: true, maxEnemies: 1 }), w = sim.world, line = byNumber(w), target = line[n], x = target.x;
      sim.command({ t: 'teleport', x, y: 7.6 });
      const weak = place(sim, { x, y: 6.7 }, 0, 'basic', 2), barrel = place(sim, { x, y: 5.5 }, 0, 'barrel');
      draw(sim, [weak, barrel]);
      assert(w.chain.length === 2, `seed ${k}, #${n + 1}: the chain ends on the barrel`);
      const plan = planChain(w).shove!;
      assert(plan, `seed ${k}, #${n + 1}: the highlight shows the shove`);
      sim.command({ t: 'release' });
      const events = ticks(sim, ticksOf(4), [], ww => !ww.move && !ww.shoves);
      const crushed = of(events, 'shove').filter(e => e.action === 'crush').map(e => e.target);
      assert(JSON.stringify(crushed) === JSON.stringify(plan.crushed.map(c => c.id)), `seed ${k}, #${n + 1}: crushed as planned (${JSON.stringify(crushed)} / ${JSON.stringify(plan.crushed)})`);
      if (n === 0) {
        assert(plan.crushed.some(c => c.id === target.id) && !w.enemies.includes(target), `seed ${k}: #1 crushed`);
      } else {
        assert(plan.stop === 'body' && plan.target === target.id && !plan.impact && !plan.crushed.length, `seed ${k}: the plan stops on #3 without a strike (${JSON.stringify(plan)})`);
        assert(w.enemies.includes(target) && target.hp === 0, `seed ${k}: #3 whole`);
      }
      assert(replays(sim), `seed ${k}, #${n + 1}: replay`);
    }
  }
});

registerArena({
  id: 'recruit-trio', name: 'Трое новобранцев', summary: 'Тест номеров во время рисования', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 5.6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: [9.1, 10, 10.9].map(x => ({ x, y: 4, color: 0, kind: RECRUIT, formation: 1 })),
});
function trio(k: number, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena: 'recruit-trio', params: quiet({ maxEnemies: 1, ...extra }), seed: seedOf(k), record: true });
  sim.tick();
  return sim;
}

check('spec 4.2, variant А: numbers drawn while a chain holds a formation — read from its start, a recruit link stays only as its group\u2019s current number (the kept ones counted), any other drops alone (event `recruit` `unlink`); the highlight = the pass (8 seeds)', () => {
  const patterns = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const sim = trio(k), w = sim.world, west = w.enemies.filter(e => e.kind === RECRUIT).sort((a, b) => a.x - b.x);
    assert(west.length === 3 && west.every(e => !e.vars.rn), `seed ${k}: three recruits, no numbers yet (the formation is not whole)`);
    draw(sim, west);
    assert(w.chain.length === 3, `seed ${k}: all three drawn before the numbers`);
    const events = ticks(sim, ticksOf(1.5), [], ww => west.every(e => ww.enemies.includes(e) && e.vars.rn));
    ticks(sim, 1, events);
    // The rule read from the numbers: the next kept link must hold the smallest number not kept yet.
    const expect: number[] = [];
    let next = 1;
    for (const e of west) if (e.vars.rn === next) { expect.push(e.id); next++; }
    const kept = w.chain.map(l => l.id), unlinked = of(events, 'recruit').filter(e => e.action === 'unlink').map(e => e.id);
    assert(JSON.stringify(kept) === JSON.stringify(expect), `seed ${k}: kept ${JSON.stringify(kept)}, the rule ${JSON.stringify(expect)} (numbers ${west.map(e => e.vars.rn).join('-')})`);
    assert(JSON.stringify(unlinked.sort()) === JSON.stringify(west.map(e => e.id).filter(id => !expect.includes(id)).sort()), `seed ${k}: the dropped ones unlinked (${JSON.stringify(unlinked)})`);
    assert(!of(events, 'recruit').some(e => e.action === 'refused'), `seed ${k}: a drop is no hit`);
    patterns.add(west.map(e => e.vars.rn).join('-'));
    const plan = planChain(w);
    assert(plan.links.every(l => l.outcome?.killed), `seed ${k}: the highlight — the kept ones fall`);
    const pass = release(sim);
    assert(expect.every(id => !w.enemies.some(e => e.id === id)) && west.filter(e => !expect.includes(e.id)).every(e => w.enemies.includes(e)), `seed ${k}: the pass = the highlight`);
    assert(!of(pass, 'recruit').some(e => e.action === 'refused'), `seed ${k}: nothing refused in the pass`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(patterns.size >= 2, `the numbers differ by seed (${[...patterns].join(', ')})`);
});

check('design 21.10.2026: no numbers during the hero\u2019s move — the formation due in the pass gets them after it (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = trio(k), w = sim.world, members = w.enemies.filter(e => e.kind === RECRUIT);
    const away = [{ x: 8.2, y: 6.2 }, { x: 6.6, y: 6.8 }, { x: 5, y: 7.4 }, { x: 3.4, y: 8 }].map(at => place(sim, at, 0, 'basic', 2));
    ticks(sim, ticksOf(0.6));
    draw(sim, away);
    sim.command({ t: 'release' });
    let during = 0;
    for (let i = 0; i < 120 && w.move; i++) { sim.tick(); w.events.length = 0; if (w.move) during = Math.max(during, members[0].age); assert(members.every(e => !e.vars.rn) || !w.move, `seed ${k}: no numbers in the pass`); }
    assert(during >= 1, `seed ${k}: the pass outlived the wait (${during.toFixed(2)})`);
    ticks(sim, 1);
    assert(members.every(e => e.vars.rn), `seed ${k}: the numbers after the pass`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the fire of «Огненный проход» is no hit of the pass (design 21.10.2026, variant б): the chain 1 → 3 lights its path, a link past #3 leads it over #4 — the fire finishes #4 in the pass, no bonus; the highlight promises none (3 seeds)', () => {
  let seen = 0;
  for (let k = 1; k <= 40 && seen < 3; k++) {
    const sim = new Simulation({ arena: 'recruit-yard', params: quiet({ maxEnemies: 1 }), seed: seedOf(k), record: true, loadout: { talismans: [], hammer: HAMMERS.fire } });
    sim.tick();
    const w = sim.world, line = byNumber(w), slot = (e: Enemy): number => LINE.findIndex(x => Math.abs(x - e.x) < 0.05);
    // #4 next to #3 in the line: the way on from #3 to a weak link past #4 runs over #4 (0.25 off its centre, within the fire's 0.4) —
    // the path is lit since #3 (the threshold 3), #4 is the current one then.
    if (Math.abs(slot(line[2]) - slot(line[3])) !== 1) continue;
    seen++;
    const three = line[2], four = line[3];
    const past = place(sim, { x: 2 * four.x - three.x, y: 4.5 }, 0);
    draw(sim, [...line.slice(0, 3), past]);
    assert(w.chain.length === 4, `seed ${k}: 1 → 3 and the link past #4 drawn`);
    const plan = planChain(w);
    assert(plan.fire?.lit && plan.links.every(l => l.outcome?.killed), `seed ${k}: the highlight — the path lights, all links fall`);
    assert(!('drill' in plan), `seed ${k}: the highlight promises no bonus`);
    sim.command({ t: 'release' });
    const events: WorldEvent[] = [];
    let inPass = false;
    for (let i = 0; i < 240 && (w.move || i === 0); i++) {
      sim.tick();
      const now = w.events.splice(0);
      events.push(...now);
      if (now.some(e => e.type === 'kill' && e.enemyId === four.id) && w.move) inPass = true;
    }
    const fire = of(events, 'kill').find(e => e.enemyId === four.id);
    assert(fire?.source === 'hammer-fire' && inPass && byNumber(w).length === 0, `seed ${k}: the fire finished #4 in the pass (${fire?.source}, in the pass ${inPass})`);
    assert(!of(events, 'recruit').some(e => e.action === 'drill'), `seed ${k}: no bonus`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(seen === 3, `seeds with #4 next to #1: ${seen}`);
});

/** A formation of 4 with room between the places (2.2 apart): a barrel fits between two of them. */
const WIDE = [6.7, 8.9, 11.1, 13.3];
registerArena({
  id: 'recruit-wide', name: 'Широкий строй', summary: 'Тест толчка по строю', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: WIDE.map(x => ({ x, y: 4, color: 0, kind: RECRUIT, formation: 1 })),
});

check('review 59а: the shove counts the chain\u2019s own kills — the chain [#1, barrel] with the barrel between #1 and #2 crushes #2 (dead #1 makes it current); the highlight = the run (4 seeds)', () => {
  let seen = 0;
  for (let k = 1; k <= 30 && seen < 4; k++) {
    const sim = new Simulation({ arena: 'recruit-wide', params: quiet({ shove: true, maxEnemies: 1 }), seed: seedOf(k), record: true });
    sim.tick();
    const w = sim.world, line = byNumber(w), one = line[0], two = line[1];
    // #1 and #2 next to each other: the barrel fits between them.
    if (Math.abs(one.x - two.x) > 2.3) continue;
    seen++;
    const dir = Math.sign(two.x - one.x), barrel = place(sim, { x: (one.x + two.x) / 2, y: 4 }, 0, 'barrel');
    sim.command({ t: 'teleport', x: one.x - dir * 1.2, y: 5.2 });
    draw(sim, [one, barrel]);
    assert(w.chain.length === 2, `seed ${k}: [#1, barrel] drawn`);
    const plan = planChain(w).shove!;
    assert(plan && plan.crushed.some(c => c.id === two.id), `seed ${k}: the highlight crushes #2 (${JSON.stringify(plan)})`);
    sim.command({ t: 'release' });
    const events = ticks(sim, ticksOf(4), [], ww => !ww.move && !ww.shoves);
    const crushed = of(events, 'shove').filter(e => e.action === 'crush').map(e => e.target);
    assert(JSON.stringify(crushed) === JSON.stringify(plan.crushed.map(c => c.id)) && !w.enemies.includes(two), `seed ${k}: crushed as planned, #2 gone (${JSON.stringify(crushed)})`);
    assert(!of(events, 'recruit').some(e => e.action === 'refused'), `seed ${k}: nothing refused`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(seen === 4, `seeds with #1 next to #2: ${seen}`);
});

check('review 59а: no numbers while a shoved barrel slides — a ride through a formation whose numbers fall due in it never crushes a recruit out of order; the highlight = the run (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = trio(k, { shove: true }), w = sim.world, members = w.enemies.filter(e => e.kind === RECRUIT);
    sim.command({ t: 'teleport', x: 6, y: 4.7 });
    const weak = place(sim, { x: 7, y: 4 }, 0, 'basic', 2), barrel = place(sim, { x: 8, y: 4 }, 0, 'barrel');
    // Released so that the numbers fall due during the ride (the formation of 3 waits 1 s).
    ticks(sim, ticksOf(0.9));
    assert(members.every(e => !e.vars.rn), `seed ${k}: no numbers yet`);
    draw(sim, [weak, barrel]);
    const plan = planChain(w).shove!;
    assert(plan && members.every(e => plan.crushed.some(c => c.id === e.id)), `seed ${k}: the highlight crushes all three`);
    sim.command({ t: 'release' });
    const events: WorldEvent[] = [];
    let rode = false;
    for (let i = 0; i < 300 && (w.move || w.shoves || i === 0); i++) { sim.tick(); events.push(...w.events.splice(0)); if (w.shoves) rode = true; }
    // The crushes go west to east; a numbered victim must come by its number (1, 2, 3 …), never out of order.
    const numbers = of(events, 'shove').filter(e => e.action === 'crush').map(e => members.find(m => m.id === e.target)?.vars.rn ?? 0);
    assert(numbers.every(n => !n) || numbers.every((n, i) => n === i + 1), `seed ${k}: crushed by the numbers ${numbers.join('-')}`);
    const crushed = of(events, 'shove').filter(e => e.action === 'crush').map(e => e.target);
    assert(rode && JSON.stringify(crushed) === JSON.stringify(plan.crushed.map(c => c.id)) && members.every(e => !w.enemies.includes(e)), `seed ${k}: crushed as planned (${JSON.stringify(crushed)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('out of order nothing hurts a recruit: the bomb on #3 with #1 alive — no damage, event `recruit` `refused`; the bomb on #1 — it dies (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = yard(k), w = sim.world, line = byNumber(w);
    sim.command({ t: 'items', kind: 'bomb', count: 2 });
    assert(sim.command({ t: 'item', kind: 'bomb', x: line[2].x, y: line[2].y }), `seed ${k}: thrown at #3`);
    const refused = of(w.events, 'recruit').find(e => e.action === 'refused');
    assert(w.enemies.includes(line[2]) && refused?.id === line[2].id && refused.source === 'bomb', `seed ${k}: #3 untouched`);
    w.events.length = 0;
    assert(sim.command({ t: 'item', kind: 'bomb', x: line[0].x, y: line[0].y }) && !w.enemies.includes(line[0]), `seed ${k}: #1 died`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the body stays a body (spec 4.2): a bolt through #3 with #1 alive stops on it — #3 untouched (event `refused`), the hero behind it unhurt; bodies pressed into #3 part it as any body (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = yard(k), w = sim.world, line = byNumber(w), third = line[2], x = third.x, y = third.y;
    // The crossbowman above the line, the hero below: the bolt's line runs through #3 first.
    sim.command({ t: 'teleport', x, y: y + 4 });
    place(sim, { x, y: y - 3 }, 1, CROSSBOW, 1);
    const hp = w.hero.hp, events = ticks(sim, ticksOf(2), [], ww => !!of(ww.events, 'bolt').find(e => e.action === 'shot'));
    events.push(...w.events.splice(0));
    const shot = of(events, 'bolt').find(e => e.action === 'shot');
    const refused = of(events, 'recruit').find(e => e.action === 'refused' && e.id === third.id);
    assert(shot?.hit === 'enemy' && shot.target === third.id, `seed ${k}: the bolt stopped on #3 (${JSON.stringify(shot)})`);
    assert(w.enemies.includes(third) && third.hp === 0 && refused?.source === BOLT_SOURCE && w.hero.hp === hp, `seed ${k}: #3 untouched, the hero unhurt (HP ${hp} → ${w.hero.hp})`);
    // A body put into #3: the parting pushes #3 aside, as any body.
    place(sim, { x: third.x + 0.1, y: third.y }, 1, 'basic', 2);
    ticks(sim, 1);
    assert(Math.abs(third.x - x) > 0.05, `seed ${k}: #3 parted (${(third.x - x).toFixed(3)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a hit on many at once takes a formation by its numbers: a sapper\'s blast round all four — all fall; round the formation without the current one — none (2 seeds)', () => {
  let partRuns = 0;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const all = yard(k, { sapperRadius: 2.5 }), w = all.world;
    const sapper = place(all, { x: 10, y: 2.6 }, 0, 'sapper', 1);
    all.command({ t: 'items', kind: 'bomb', count: 1 });
    assert(all.command({ t: 'item', kind: 'bomb', x: sapper.x, y: sapper.y }), 'the sapper bombed');
    ticks(all, ticksOf(1.5));
    assert(byNumber(w).length === 0, `seed ${k}: all four fell (${byNumber(w).length} left)`);
    // Without the current one in the circle: a small blast round the other three's middle.
    const part = yard(k, { sapperRadius: 0.9 }), pw = part.world, line = byNumber(pw), first = line[0];
    const rest = line.slice(1), cx = rest.reduce((a, e) => a + e.x, 0) / 3;
    if (rest.some(e => Math.abs(e.x - cx) > 1.3) || Math.abs(first.x - cx) < 1.3) continue;
    const s2 = place(part, { x: cx, y: 2.9 }, 0, 'sapper', 1);
    part.command({ t: 'items', kind: 'bomb', count: 1 });
    part.command({ t: 'item', kind: 'bomb', x: s2.x, y: s2.y });
    const events = ticks(part, ticksOf(1.5));
    assert(byNumber(pw).length === 4 && of(events, 'recruit').some(e => e.action === 'refused'), `seed ${k}: none fell without the current one`);
    partRuns++;
  }
  assert(partRuns >= 1, `a seed with the current one at an end of the line (${partRuns})`);
});

check('«Прямая»: the run passes the formation in its order — the highlight marks the refused (`order`), the run kills and refuses the same (4 seeds)', () => {
  let marked = 0;
  for (const k of [1, 2, 3, 4]) {
    const sim = yard(k, { pierceEnabled: true, pierceLength: 4 }), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 4 });
    // Three weak links west of the formation, in its line: the straight tail runs on through it.
    const links = [place(sim, { x: 3.5, y: 4 }, 0, 'basic', 1), place(sim, { x: 5, y: 4 }, 0, 'basic', 1), place(sim, { x: 6.5, y: 4 }, 0, 'basic', 1)];
    draw(sim, links);
    const pierce = planChain(w).pierce;
    if (!pierce) continue;
    const plannedKills = pierce.bodies.filter(b => b.outcome.killed).map(b => b.id).sort();
    const plannedOrder = pierce.bodies.filter(b => b.outcome.order).map(b => b.id).sort();
    marked += plannedOrder.length;
    const events = release(sim);
    ticks(sim, ticksOf(1), events);
    const died = of(events, 'kill').filter(e => e.source === 'pierce').map(e => e.enemyId).sort();
    const refused = of(events, 'recruit').filter(e => e.action === 'refused').map(e => e.id).sort();
    assert(JSON.stringify(died) === JSON.stringify(plannedKills) && JSON.stringify(refused) === JSON.stringify(plannedOrder), `seed ${k}: plan kills ${plannedKills} / order ${plannedOrder}, run kills ${died} / refused ${refused}`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(marked > 0, 'some seed passes a recruit out of order');
});

check('the law off: no numbers, plain links; a journal without the keys plays the same world (2 seeds)', () => {
  for (const k of [1, 2]) {
    const off = yard(k, { recruits: false }), w = off.world, line = w.enemies.filter(e => e.kind === RECRUIT);
    assert(line.every(e => e.vars.rn === undefined) && enemyRefusal(w, line[3]) !== 'order', `seed ${k}: no numbers, no refusal`);
    const sim = yard(k), sw = sim.world, nums = byNumber(sw);
    draw(sim, nums.slice(0, 2)); release(sim);
    ticks(sim, ticksOf(2));
    const journal = sim.exportJournal()! as Journal;
    delete (journal.params as unknown as Record<string, unknown>).recruitBonus;
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(sw), `seed ${k}: without recruitBonus the same world`);
  }
});

console.log(`recruits: ${checks} checks passed`);
