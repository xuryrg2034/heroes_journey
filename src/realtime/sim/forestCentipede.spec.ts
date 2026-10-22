/**
 * Task 57б-2 «Лес: механики» — «Сороконожка» (enemies/centipede.ts). Node only: `npm run test:realtime-forest-centipede`.
 *
 * Every check plays journalled commands (clear, place, teleport, walk, items, item, begin / drag / release) and looks at what the player
 * meets (docs/design-notes/task-57-forest-enemies.md, 17):
 * - the body: 5 parts of one colour, the head HP 1, the parts HP 0; walking, the parts keep their step behind the head;
 * - a chain from the tail to the head (and from the head to the tail) kills the whole body — no division;
 * - a chain that kills a middle part divides the body: two bodies, the new head the part nearest the break, stunned 1 s (it stands, then
 *   walks); the highlight's `splits` is the outcome — the chain's links and every pass off the links («Прямая», «Возврат», «Печать»,
 *   «Режущий проход», the end blast, «Огненный проход» — its first burn before the breaks settle), several seeds; past 4 bodies a break
 *   closes up (the highlight shows none there), a head killed alone at the cap still gets a new head; the new head's first lunge 2 s on;
 * - stuck (the measure of the rope): a part farther than 1.2 behind for 2 s;
 * - «Рывок»: the hero in the lane −1; the hero who steps out during the 1 s windup is untouched; the first lunge 2 s after it appeared;
 * - at most 2 heads come by a roster; the telemetry counts lunges, divisions and heads and the threat `centipede-lunge`; a journal
 *   without the new keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { HAMMERS } from './buildIds';
import { planChain } from './chain';
import {
  CENTIPEDE, CENTI_BODIES_MAX, CENTI_FIRST_LUNGE, CENTI_LUNGE_SOURCE, CENTI_STEP, CENTI_STUN, centipedeBodies, centipedeBody, centipedeHead,
  CENTI_CATCH_GAP, CENTI_STUCK, centipedeLane, centipedeStuck, centipedeStunned,
} from './enemies/centipede';
import { tree, wall, type Vec } from './geometry';
import { bodyRadiusOf } from './enemies/kinds';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { enemyLimit, floorWithScale } from './spawn';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { createFightObserver } from '../telemetry/observe';
import { ThreatTracker } from '../telemetry/threats';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест сороконожки' };
registerArena({ ...base, id: 'fc-field', name: 'Поле сороконожки', width: 26, height: 16, heroStart: { x: 6, y: 8 }, obstacles: [], door: { x: 25.3, y: 8 } });
registerArena({
  ...base, id: 'fc-come', name: 'Сороконожки идут', width: 26, height: 16, heroStart: { x: 13, y: 8 }, obstacles: [], door: { x: 25.3, y: 8 },
  newcomers: [{ kind: CENTIPEDE, share: 1 }], phaseOverride: { wolfShare: 0, boarShare: 0 },
});
// A wall from the top down to y 9 at x 9.6–10 and a tree: a centipede appearing next to them.
registerArena({ ...base, id: 'fc-wall', name: 'Стена', width: 26, height: 16, heroStart: { x: 3, y: 4 }, obstacles: [wall(9.6, 0, 0.4, 9), tree(16, 12)], door: { x: 25.3, y: 8 } });
// A long wall across the field: a body north of it walks round its east end to the hero south of it — its tail catches on the corner.
registerArena({ ...base, id: 'fc-corner', name: 'Угол', width: 26, height: 16, heroStart: { x: 13, y: 2 }, obstacles: [wall(4, 7.8, 16, 0.4)], door: { x: 25.3, y: 8 } });

/** Nothing comes, nobody walks (unless `enemySpeed` is given); the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}, loadout?: { hammer?: string }): Simulation {
  const sim = new Simulation({ arena: 'fc-field', params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout: { talismans: [], ...loadout.hammer ? { hammer: loadout.hammer as never } : {} } } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, out: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world, out); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type CentiEv = Extract<WorldEvent, { type: 'centipede' }>;
type LungeEv = Extract<CentiEv, { action: 'lunge' }>;
const lunges = (events: readonly WorldEvent[], stage: 'start' | 'end'): LungeEv[] => centi(events).filter((e): e is LungeEv => e.action === 'lunge' && e.stage === stage);
const centi = (events: readonly WorldEvent[]): CentiEv[] => events.filter((e): e is CentiEv => e.type === 'centipede');
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, 600, out, w => !w.move);
}
/**
 * A centipede of `color` whose head stands at `head`, its parts laid away from `from` (the hero stands there while it appears, then goes
 * back to where he stood). The body head → tail.
 */
function body(sim: Simulation, head: Vec, from: Vec, color = 1): Enemy[] {
  const w = sim.world, back = { x: w.hero.x, y: w.hero.y };
  sim.command({ t: 'teleport', x: from.x, y: from.y });
  const id = sim.command({ t: 'place', x: head.x, y: head.y, color, hp: 1, kind: CENTIPEDE }) as number;
  sim.command({ t: 'teleport', x: back.x, y: back.y });
  return centipedeBody(w, id).map(x => w.enemies.find(e => e.id === x)!);
}
/** A body along a column through `at`: its part `n` (0 — the head) at `at`, the head north of it. */
const column = (sim: Simulation, at: Vec, n = 2, color = 2): Enemy[] => body(sim, { x: at.x, y: at.y - CENTI_STEP * n }, { x: at.x, y: at.y - CENTI_STEP * n - 5 }, color);
/** The splits as a comparable string: new head, the front head, the cut part. */
const splitKey = (s: readonly { newHead: number; front?: number; cut: number }[]): string => s.map(x => `${x.newHead}<${x.front ?? '-'}/${x.cut}`).sort().join(' ');
const doneKey = (events: readonly WorldEvent[]): string => splitKey(centi(events).flatMap(e => (e.action === 'split' || e.action === 'head' ? [{ newHead: e.id, front: e.front, cut: e.cut }] : [])));

// ---- The body ----

check('the body: 5 parts of one colour, the head HP 1 and 4 parts HP 0 laid behind it 0.8 apart; walking, the parts keep their step (≤ 1.2) and stay one body in order (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k, { enemySpeed: 1.2 }), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 8 });
    const parts = body(sim, { x: 15, y: 9 }, { x: 3, y: 8 }, 3);
    assert(parts.length === 5 && parts.every(e => e.color === 3) && parts[0].hp === 1 && parts.slice(1).every(e => e.hp === 0), `seed ${k}: 5 parts, HP 1 + 0 (${parts.map(e => e.hp)})`);
    assert(centipedeHead(parts[0]) && parts.slice(1).every(e => !centipedeHead(e)), `seed ${k}: one head`);
    for (let i = 1; i < 5; i++) assert(Math.abs(dist(parts[i], parts[i - 1]) - CENTI_STEP) < 1e-6, `seed ${k}: part ${i} 0.8 behind`);
    let worst = 0;
    for (let t = 0; t < ticksOf(3); t++) { ticks(sim, 1); for (let i = 1; i < 5; i++) worst = Math.max(worst, dist(parts[i], parts[i - 1])); }
    assert(dist(parts[0], { x: 15, y: 9 }) > 3 && worst <= 1.2 + 1e-6, `seed ${k}: it walked ${dist(parts[0], { x: 15, y: 9 }).toFixed(2)}, the widest step ${worst.toFixed(3)}`);
    assert(centipedeBody(w, parts[0].id).join() === parts.map(e => e.id).join() && centipedeBodies(w).length === 1, `seed ${k}: one body in order`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('a chain from the tail to the head and from the head to the tail kills the whole body — no division, no new head; the highlight shows none (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    for (const reversed of [false, true]) {
      const sim = field(k), w = sim.world;
      sim.command({ t: 'teleport', x: 6, y: 8 });
      const parts = body(sim, { x: 7.4, y: 8 }, { x: 4, y: 8 });
      const order = reversed ? [...parts].reverse() : parts;
      sim.command({ t: 'teleport', x: order[0].x + (reversed ? 1 : -1), y: 8 });
      draw(sim, order);
      assert(w.chain.length === 5, `seed ${k}: the chain takes the body (${w.chain.length})`);
      const plan = planChain(w);
      assert(!plan.splits && plan.links.every(l => l.outcome?.killed), `seed ${k}: the highlight — all die, no «трещина» (${JSON.stringify(plan.splits)})`);
      const events = release(sim);
      ticks(sim, 2, events);
      assert(!w.enemies.some(e => e.kind === CENTIPEDE) && w.stats.kills === 5 && !centi(events).some(e => e.action !== 'lunge'), `seed ${k}${reversed ? ' tail→head' : ' head→tail'}: all 5 killed, no division`);
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

check('a chain that kills the middle part divides the body: two bodies, the new head the part behind the break (its own id), HP 1, stunned 1 s — it stands, no lunge, then walks; its first lunge 2 s after the division; the highlight `splits` is the outcome (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k, { enemySpeed: 1.2 }), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 8 });
    const parts = body(sim, { x: 12, y: 8 }, { x: 3, y: 8 });
    const [head, , mid, after] = parts;
    sim.command({ t: 'teleport', x: mid.x, y: mid.y - 1.2 });
    draw(sim, [mid]);
    const plan = planChain(w);
    assert(splitKey(plan.splits ?? []) === `${after.id}<${head.id}/${mid.id}`, `seed ${k}: the highlight — «трещина» at the middle, «новая голова» behind it (${JSON.stringify(plan.splits)})`);
    const events = release(sim);
    const split = w.time;
    assert(doneKey(events) === splitKey(plan.splits!), `seed ${k}: the outcome is the highlight's (${doneKey(events)})`);
    const bodies = centipedeBodies(w);
    assert(bodies.length === 2 && bodies.map(b => b.parts.join()).join(' | ') === `${head.id},${parts[1].id} | ${after.id},${parts[4].id}`, `seed ${k}: two bodies (${JSON.stringify(bodies)})`);
    assert(after.hp === 1 && centipedeStunned(after), `seed ${k}: the new head HP 1, stunned`);
    // Stunned: it stands (the hero near and in sight), no lunge; then it walks.
    const at = { x: after.x, y: after.y };
    sim.command({ t: 'teleport', x: after.x + 2.5, y: after.y + 0.5 });
    const stunned = ticks(sim, ticksOf(CENTI_STUN) - 2);
    assert(dist(after, at) < 1e-9 && centipedeStunned(after) && !centi(stunned).some(e => e.action === 'lunge' && e.id === after.id), `seed ${k}: stunned 1 s — it stood`);
    ticks(sim, ticksOf(0.5));
    assert(!centipedeStunned(after) && dist(after, at) > 0.1, `seed ${k}: then it walks (${dist(after, at).toFixed(2)})`);
    const later = ticks(sim, ticksOf(2), [], (_w, out) => lunges(out, 'start').some(e => e.id === after.id));
    assert(lunges(later, 'start').some(e => e.id === after.id) && Math.abs(w.time - split - CENTI_FIRST_LUNGE) < 0.05, `seed ${k}: its first lunge ${(w.time - split).toFixed(2)} s after the division`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the head killed alone: the next part becomes the head (event `head`, stunned), one body of 4; the tail killed alone: nothing (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 8 });
    const parts = body(sim, { x: 6, y: 8 }, { x: 3, y: 8 });
    sim.command({ t: 'teleport', x: 6, y: 6.8 });
    draw(sim, [parts[0]]);
    const plan = planChain(w);
    assert(splitKey(plan.splits ?? []) === `${parts[1].id}<-/${parts[0].id}`, `seed ${k}: the highlight — a new head behind the head (${JSON.stringify(plan.splits)})`);
    const events = release(sim);
    assert(doneKey(events) === splitKey(plan.splits!) && centi(events).some(e => e.action === 'head' && e.id === parts[1].id), `seed ${k}: event head`);
    assert(centipedeBodies(w).map(b => b.parts.join()).join() === parts.slice(1).map(e => e.id).join() && parts[1].hp === 1 && centipedeStunned(parts[1]), `seed ${k}: one body of 4, the new head HP 1, stunned`);
    const tail = parts[4];
    sim.command({ t: 'teleport', x: tail.x, y: tail.y - 1.2 });
    draw(sim, [tail]);
    assert(!planChain(w).splits, `seed ${k}: the tail — no «трещина»`);
    const after = release(sim);
    ticks(sim, 2, after);
    assert(!centi(after).some(e => e.action !== 'lunge') && centipedeBodies(w).length === 1, `seed ${k}: the tail — nothing`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check(`past ${CENTI_BODIES_MAX} bodies a break closes up: two bodies, one chain kills parts 1 and 3 of the first and part 2 of the second — two divisions (4 bodies), the third closes up (\`join\`); the highlight shows exactly the two, no «трещина» at the third; then a head killed alone at the cap still gets a new head (the cap does not count it) (3 seeds)`, () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 8 });
    const a = body(sim, { x: 8, y: 7.5 }, { x: 2, y: 8 }), b = body(sim, { x: 8, y: 8.5 }, { x: 2, y: 8 });
    sim.command({ t: 'teleport', x: a[1].x - 1, y: a[1].y - 0.5 });
    draw(sim, [a[1], a[3], b[2]]);
    assert(w.chain.length === 3, `seed ${k}: the chain (${w.chain.length})`);
    const plan = planChain(w);
    assert(splitKey(plan.splits ?? []) === splitKey([{ newHead: a[2].id, front: a[0].id, cut: a[1].id }, { newHead: a[4].id, front: a[2].id, cut: a[3].id }]), `seed ${k}: the highlight — two divisions (${JSON.stringify(plan.splits)})`);
    const events = release(sim);
    assert(doneKey(events) === splitKey(plan.splits!), `seed ${k}: the outcome is the highlight's (${doneKey(events)})`);
    const join = centi(events).find(e => e.action === 'join');
    assert(join?.id === b[3].id && join.front === b[1].id && centipedeBodies(w).length === CENTI_BODIES_MAX, `seed ${k}: the third closed up — ${centipedeBodies(w).length} bodies`);
    assert(!plan.splits!.some(x => x.newHead === b[3].id || x.cut === b[2].id), `seed ${k}: no «трещина» or new head at the third break`);
    assert(centipedeBody(w, b[0].id).join() === [b[0], b[1], b[3], b[4]].map(e => e.id).join(), `seed ${k}: the second body closed up in order`);
    // At the cap: the second body's head killed alone — its next part leads (the body count stays 4).
    ticks(sim, ticksOf(CENTI_STUN) + 2);
    sim.command({ t: 'teleport', x: b[0].x - 0.9, y: b[0].y + 0.6 });
    draw(sim, [b[0]]);
    const lone = planChain(w);
    assert((w.chain.length as number) === 1 && splitKey(lone.splits ?? []) === `${b[1].id}<-/${b[0].id}`, `seed ${k}: the highlight at the cap — a new head (${JSON.stringify(lone.splits)})`);
    const headEvents = release(sim);
    assert(doneKey(headEvents) === splitKey(lone.splits!) && centipedeBodies(w).length === CENTI_BODIES_MAX && centipedeHead(b[1]) && b[1].hp === 1, `seed ${k}: the new head at the cap (${doneKey(headEvents)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check(`at the cap the piece whose head died is not counted: 4 bodies, one chain kills the head of the second and a middle part of the first (lower ids: the division comes first in id order) — the second gets its new head, the first's break closes up (\`join\`), still ${CENTI_BODIES_MAX} bodies; the highlight is the outcome (3 seeds)`, () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 8 });
    const a = body(sim, { x: 8, y: 7.5 }, { x: 2, y: 8 }), b = body(sim, { x: 8, y: 8.5 }, { x: 2, y: 8 });
    body(sim, { x: 8, y: 13 }, { x: 2, y: 13 }); body(sim, { x: 8, y: 3 }, { x: 2, y: 3 });
    sim.command({ t: 'teleport', x: b[0].x - 1, y: b[0].y + 0.5 });
    draw(sim, [b[0], a[1]]);
    assert(w.chain.length === 2 && centipedeBodies(w).length === CENTI_BODIES_MAX, `seed ${k}: the chain, 4 bodies`);
    const plan = planChain(w);
    assert(splitKey(plan.splits ?? []) === `${b[1].id}<-/${b[0].id}`, `seed ${k}: the highlight — the new head only (${JSON.stringify(plan.splits)})`);
    const events = release(sim);
    const join = centi(events).find(e => e.action === 'join');
    assert(doneKey(events) === splitKey(plan.splits!) && join?.id === a[2].id && centipedeBodies(w).length === CENTI_BODIES_MAX, `seed ${k}: the new head, the break closed up, 4 bodies (${doneKey(events)}, ${centipedeBodies(w).length})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- Off the links ----

/** A pass whose rule strikes a body off the chain's links (basic links of colour 1, a body of colour 2): its `splits` are the outcome. */
function offLink(k: number, setup: { name: string; params?: Partial<Params>; hammer?: string; hero: Vec; links: Vec[]; at: Vec; close?: true }): void {
  const sim = field(k, setup.params, setup.hammer ? { hammer: setup.hammer } : {}), w = sim.world;
  sim.command({ t: 'teleport', x: setup.hero.x, y: setup.hero.y });
  const links = setup.links.map(p => { const id = sim.command({ t: 'place', x: p.x, y: p.y, color: 1, hp: 0, kind: 'basic' }); return w.enemies.find(e => e.id === id)!; });
  const parts = column(sim, setup.at);
  draw(sim, links);
  if (setup.close) sim.command({ t: 'drag', x: links[0].x, y: links[0].y, mode: 'full' });
  assert(w.chain.length === links.length, `${setup.name} seed ${k}: the chain (${w.chain.length})`);
  const plan = planChain(w);
  assert((plan.splits ?? []).length >= 1, `${setup.name} seed ${k}: the highlight shows a «трещина» (${JSON.stringify(plan.splits)})`);
  const events = release(sim);
  assert(doneKey(events) === splitKey(plan.splits!), `${setup.name} seed ${k}: highlight ${splitKey(plan.splits!)} = the pass ${doneKey(events)}`);
  assert(parts.some(e => !w.enemies.includes(e)), `${setup.name} seed ${k}: a part died`);
  assert(replays(sim), `${setup.name} seed ${k}: replay`);
}

check('off the links — «Прямая», «Возврат», «Печать», «Режущий проход», the end blast, «Огненный проход»: the highlight\'s divisions are the pass\'s (3 seeds each)', () => {
  const row = [{ x: 7.4, y: 8 }, { x: 8.8, y: 8 }, { x: 10.2, y: 8 }];
  for (const k of [1, 2, 3]) {
    offLink(k, { name: 'pierce', params: { pierceEnabled: true }, hero: { x: 6, y: 8 }, links: row, at: { x: 11.4, y: 8 } });
    offLink(k, { name: 'return', hammer: HAMMERS.return, hero: { x: 6, y: 8 }, links: row, at: { x: 8.1, y: 8.3 } });
    offLink(k, { name: 'seal', params: { loopEnabled: true }, hero: { x: 4.5, y: 8 }, links: [{ x: 6, y: 7 }, { x: 8, y: 7 }, { x: 8, y: 9 }, { x: 6, y: 9 }], at: { x: 7, y: 8 }, close: true });
    offLink(k, { name: HAMMERS.cut, hammer: HAMMERS.cut, hero: { x: 6, y: 8 }, links: row, at: { x: 9.5, y: 8.5 } });
    // «Огненный проход»: its first burn of the last points comes in the tick the dash ends, after the move — the breaks settle after
    // it (a settle before it would promote a part the burn then kills: the highlight would differ; checked by mutation 22.10.2026).
    offLink(k, { name: HAMMERS.fire, hammer: HAMMERS.fire, hero: { x: 6, y: 8 }, links: row, at: { x: 9.5, y: 8.3 } });
    offLink(k, { name: 'blast', hammer: HAMMERS.blast, hero: { x: 6, y: 8 }, links: row, at: { x: 10.2, y: 9.2 } });
  }
});

// ---- The measure of the rope ----

check(`stuck (the measure of the rope): a body walking round the east end of a long wall to the hero behind it — its tail catches on the corner, farther than ${CENTI_CATCH_GAP} behind for ${CENTI_STUCK} s: \`centipedeStuck\`, event \`stuck\` once per part; on the open field and in a lunge none is (2 seeds)`, () => {
  for (const k of [1, 2]) {
    const sim = new Simulation({ arena: 'fc-corner', params: quiet({ enemySpeed: 1.2 }), seed: seedOf(k), record: true }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    sim.command({ t: 'teleport', x: 13, y: 2 });
    const parts = body(sim, { x: 13, y: 6.8 }, { x: 13, y: 2 });
    sim.command({ t: 'teleport', x: 13, y: 12 });
    const events = ticks(sim, ticksOf(14), [], (_w, out) => centi(out).some(e => e.action === 'stuck'));
    const stuck = centi(events).filter(e => e.action === 'stuck');
    assert(stuck.length >= 1 && stuck.every(e => parts.some(q => q.id === e.id) && centipedeStuck(w).includes(e.id)), `seed ${k}: stuck at the corner (${stuck.length}, now ${centipedeStuck(w)})`);
    const more = ticks(sim, ticksOf(1));
    assert(!centi(more).some(e => e.action === 'stuck' && stuck.some(x => x.id === e.id)), `seed ${k}: one event per part while it stays stuck`);
    // The open field, with a lunge (the hero near): none.
    const open = field(k, { enemySpeed: 1.2 }), ow = open.world;
    open.command({ t: 'teleport', x: 6, y: 8 });
    body(open, { x: 9.5, y: 8 }, { x: 6, y: 8 });
    const free = ticks(open, ticksOf(6));
    assert(lunges(free, 'start').length >= 1 && !centi(free).some(e => e.action === 'stuck') && !centipedeStuck(ow).length, `seed ${k}: none stuck on the open field`);
    assert(replays(sim) && replays(open), `seed ${k}: replay`);
  }
});

check('a centipede appearing next to a wall or a tree, the hero beyond its head: no part lies across the wall or in the tree; none stuck in the first 3 s (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'fc-wall', params: quiet({ enemySpeed: 1.2 }), seed: seedOf(k), record: true }), w = sim.world;
    sim.command({ t: 'clear', keepMarked: false });
    // The wall: the hero west of the head, the line through the head goes east into the wall (x 9.6–10).
    sim.command({ t: 'teleport', x: 3, y: 4 });
    const atWall = body(sim, { x: 9.0, y: 4 }, { x: 3, y: 4 });
    assert(atWall.length === 5 && atWall.every(e => e.x < 9.6 - bodyRadiusOf(w.params, e) + 1e-9), `seed ${k}: no part across the wall (${atWall.map(e => e.x.toFixed(2))})`);
    // The tree at (16, 12): the line from the hero through the head goes into it.
    const atTree = body(sim, { x: 15.2, y: 12 }, { x: 10, y: 12 });
    const r = bodyRadiusOf(w.params, atTree[0]);
    assert(atTree.length === 5 && atTree.every(e => dist(e, { x: 16, y: 12 }) >= 0.42 + r - 1e-9), `seed ${k}: no part in the tree`);
    sim.command({ t: 'teleport', x: 3, y: 4 });
    const first = ticks(sim, ticksOf(3));
    assert(!centi(first).some(e => e.action === 'stuck') && !centipedeStuck(w).length, `seed ${k}: none stuck in 3 s`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('two bodies part as ordinary ones, a body\'s own parts never push each other: the roster brings two, the hero stands — after 6 s the heads and every two parts of different bodies are apart (≥ two body radii), each body keeps its rope (5 seeds)', () => {
  for (const k of [1, 2, 3, 4, 5]) {
    const p = defaultParams();
    p.heroHp = 999; p.contactDamage = 0; p.hitstop = false;
    const sim = new Simulation({ arena: 'fc-come', params: p, seed: seedOf(k), record: true }), w = sim.world;
    let checked = false;
    for (let i = 0; i < ticksOf(30) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      sim.command({ t: 'teleport', x: 13, y: 8 });
      const bodies = centipedeBodies(w);
      if (bodies.length < 2) continue;
      const youngest = Math.min(...bodies.map(b => w.enemies.find(e => e.id === b.head)!.age));
      if (youngest < 6) continue;
      const parts = bodies.map(b => b.parts.map(id => w.enemies.find(e => e.id === id)!));
      const r2 = 2 * bodyRadiusOf(w.params, parts[0][0]);
      let closest = Infinity;
      for (const a of parts[0]) for (const b of parts[1]) closest = Math.min(closest, dist(a, b));
      assert(dist(parts[0][0], parts[1][0]) >= r2 - 0.02 && closest >= r2 - 0.02, `seed ${k}: the bodies apart — heads ${dist(parts[0][0], parts[1][0]).toFixed(3)}, closest parts ${closest.toFixed(3)} (2r ${r2.toFixed(3)})`);
      for (const one of parts) for (let j = 1; j < one.length; j++) assert(dist(one[j], one[j - 1]) <= CENTI_CATCH_GAP + 1e-6, `seed ${k}: the rope holds (${dist(one[j], one[j - 1]).toFixed(3)})`);
      checked = true;
      break;
    }
    assert(checked, `seed ${k}: two bodies 6 s on the arena`);
  }
});

check(`the cap at the settle counts the heads the highlight saw: 2 bodies, a chain with 2 breaks — the highlight promises 2 new heads (4 bodies); a third centipede appears while the dash runs (\`place\`: \`spawnEnemy\`, as a marker opens — reachable with a level's \`kindCaps.centipede\` ≥ 3); the outcome is still the highlight's, no \`join\` (3 seeds)`, () => {
  let landed = 0;
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 8 });
    const a = body(sim, { x: 8, y: 7.5 }, { x: 2, y: 8 }); body(sim, { x: 8, y: 11 }, { x: 2, y: 11 });
    sim.command({ t: 'teleport', x: a[1].x - 1, y: a[1].y - 0.5 });
    draw(sim, [a[1], a[3]]);
    const plan = planChain(w);
    assert(splitKey(plan.splits ?? []) === splitKey([{ newHead: a[2].id, front: a[0].id, cut: a[1].id }, { newHead: a[4].id, front: a[2].id, cut: a[3].id }]), `seed ${k}: the highlight — two new heads (${JSON.stringify(plan.splits)})`);
    assert(sim.command({ t: 'release' }), 'released');
    const events = ticks(sim, 1);
    const heads = (): number => centipedeBodies(w).length;
    const before = heads();
    sim.command({ t: 'place', x: 20, y: 3, color: 3, hp: 1, kind: CENTIPEDE });
    assert(w.move, `seed ${k}: still dashing`);
    if (heads() > before) landed++;
    ticks(sim, 600, events, x => !x.move);
    assert(doneKey(events) === splitKey(plan.splits!) && !centi(events).some(e => e.action === 'join'), `seed ${k}: the outcome is the highlight's (${doneKey(events)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(landed === 3, `a head landed during the dash on ${landed} of 3 seeds`);
});

check('a bomb kills a part while a chain is drawn: the highlight shows the break at once, the next tick settles it (the new head, HP 1, a link of the chain), the highlight recomputes and the dash plays it (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 8 });
    const parts = body(sim, { x: 6, y: 8 }, { x: 3, y: 8 });
    sim.command({ t: 'teleport', x: parts[3].x, y: parts[3].y - 1.2 });
    draw(sim, [parts[3], parts[4]]);
    assert(!planChain(w).splits, `seed ${k}: the tail end — no «трещина»`);
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    assert(sim.command({ t: 'item', kind: 'bomb', x: parts[1].x, y: parts[1].y }) === true && !w.enemies.includes(parts[1]), `seed ${k}: the bomb killed part 1`);
    const now = planChain(w);
    assert(splitKey(now.splits ?? []) === `${parts[2].id}<${parts[0].id}/${parts[1].id}`, `seed ${k}: the highlight shows the break at once (${JSON.stringify(now.splits)})`);
    const settle = ticks(sim, 1);
    assert(doneKey(settle) === splitKey(now.splits!) && parts[2].hp === 1 && w.chain.length === 2, `seed ${k}: the next tick settles it (${doneKey(settle)})`);
    // The chain now: part 3 → part 4, behind the new head: no break — the plan and the dash agree.
    const after = planChain(w);
    const events = release(sim);
    assert(doneKey(events) === splitKey(after.splits ?? []) && !w.enemies.includes(parts[3]) && !w.enemies.includes(parts[4]), `seed ${k}: the dash as the highlight (${doneKey(events)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('«Рывок» passes the hero dashing through its lane: the run meets him during his move — no hit, the run ends `pass` (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    sim.command({ t: 'teleport', x: 6, y: 8 });
    const parts = body(sim, { x: 9, y: 8 }, { x: 6, y: 8 });
    // Links of another colour on the lane, between the hero and the head.
    const links = [6.8, 7.6, 8.4].map(x => { const id = sim.command({ t: 'place', x, y: 8.3, color: 2, hp: 0, kind: 'basic' }); return w.enemies.find(e => e.id === id)!; });
    ticks(sim, ticksOf(3.5), [], () => parts[0].boar === 'charge');
    assert(parts[0].boar === 'charge', `seed ${k}: the run starts`);
    draw(sim, links);
    const events = release(sim);
    ticks(sim, ticksOf(0.5), events);
    const end = lunges(events, 'end').find(e => e.id === parts[0].id);
    assert(end?.met === 'pass' && !events.some(e => e.type === 'hit' && e.source === CENTI_LUNGE_SOURCE), `seed ${k}: passed during the dash (${JSON.stringify(end)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

// ---- «Рывок» ----

check('«Рывок»: the first windup 2 s after it appeared, the lane fixed toward the hero; the hero who stays in it −1 (`centipede-lunge`, its first hit); the hero who steps 1 unit aside after a 0.2 s reaction and stands is untouched, by the run and by the touches (touch 1 on, 3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    for (const dodge of [false, true]) {
      const sim = field(k, { contactDamage: 1 }), w = sim.world;
      sim.command({ t: 'teleport', x: 6, y: 8 });
      const parts = body(sim, { x: 9, y: 8 }, { x: 6, y: 8 });
      const t0 = w.time;
      const before = ticks(sim, ticksOf(3), [], (_w, out) => centi(out).some(e => e.action === 'lunge' && e.stage === 'start'));
      const start = lunges(before, 'start')[0];
      assert(start && Math.abs(w.time - t0 - CENTI_FIRST_LUNGE) < 0.05 && start.dx !== undefined && Math.abs(start.dx + 1) < 1e-6, `seed ${k}: the windup at ${(w.time - t0).toFixed(2)} s, toward the hero`);
      const lane = centipedeLane(w, parts[0]);
      assert(lane && !lane.charging && lane.len === 3, `seed ${k}: the lane 3 long (${JSON.stringify(lane)})`);
      const after = ticks(sim, ticksOf(0.2));
      // The dodge: one step aside (0.25 s, 1 unit — out of the lane fixed at the windup's start: 0.3 + the hero's body), then he stands.
      if (dodge) { sim.command({ t: 'walk', x: 0, y: 1 }); ticks(sim, ticksOf(0.25), after); sim.command({ t: 'walk', x: 0, y: 0 }); }
      ticks(sim, ticksOf(1.2), after);
      const hits = after.filter(e => e.type === 'hit');
      const end = lunges(after, 'end')[0];
      if (dodge) assert(!hits.length && w.hero.hp === 99 && end && !end.met, `seed ${k}: stepped out — untouched (${JSON.stringify(hits)})`);
      else {
        // The run ends on him: its one hit −1 (the touches after it are the body's, the grace window is off here).
        const lunge = hits.filter(e => e.type === 'hit' && e.source === CENTI_LUNGE_SOURCE);
        assert(lunge.length === 1 && lunge[0].type === 'hit' && lunge[0].damage === 1 && hits[0] === lunge[0] && end?.met === 'hit', `seed ${k}: in the lane — −1 (${JSON.stringify(hits)})`);
      }
      assert(replays(sim), `seed ${k}: replay`);
    }
  }
});

// ---- The roster, the telemetry, the keys ----

/** The roster's arena: its floor (`baseFloor`), no timed groups (only the floor tops up) unless `interval` is given. */
function rosterSim(k: number, floor: number, extra: Partial<Params> = {}, interval = 1e6): Simulation {
  const p = defaultParams();
  p.heroHp = 999; p.contactDamage = 0; p.hitstop = false; p.enemySpeed = 0;
  p.baseFloor = floor; p.baseIntervalMin = interval; p.baseIntervalMax = interval;
  return new Simulation({ arena: 'fc-come', params: Object.assign(p, extra), seed: seedOf(k), record: true });
}
const partsIn = (_w: World, list: readonly { kind: string }[]): number => list.reduce((n, m) => n + (m.kind === CENTIPEDE ? 5 : 1), 0);

check('the floor and the live limit count a centipede by its 5 parts, queued, marked or landed (design 22.10.2026): on a roster of centipedes the bodies never pass the floor (but by one newcomer\'s parts) nor the limit; «Врагов пришло» counts the parts (5 seeds)', () => {
  for (const k of [1, 2, 3, 4, 5]) {
    // The floor alone (no timed groups): the queue fills to it, then the markers open, then they land.
    const sim = rosterSim(k, 12), w = sim.world;
    const floor = Math.min(floorWithScale(w.pressure.phase.floor, w.arena), enemyLimit(w.params, w.arena));
    let worst = 0, landedMost = 0;
    for (let i = 0; i < ticksOf(20) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      sim.command({ t: 'teleport', x: 13, y: 8 });
      const present = w.enemies.length + partsIn(w, w.markers) + partsIn(w, w.queue);
      worst = Math.max(worst, present); landedMost = Math.max(landedMost, w.enemies.length);
    }
    const heads = w.enemies.filter(e => e.kind === CENTIPEDE && e.vars.ca === undefined).length;
    assert(heads >= 1 && worst <= floor + 4 && landedMost <= floor + 4, `seed ${k}: the floor ${floor} — at most ${worst} counted, ${landedMost} landed (${heads} centipedes)`);
    assert(w.stats.spawned === w.enemies.length, `seed ${k}: «Врагов пришло» counts the parts (${w.stats.spawned} of ${w.enemies.length})`);
    // The live limit: a small one, the groups come often.
    const lim = rosterSim(k, 40, { maxEnemies: 14 }, 0.5), lw = lim.world;
    const max = enemyLimit(lw.params, lw.arena);
    let most = 0;
    for (let i = 0; i < ticksOf(20) && lw.status === 'playing'; i++) {
      lim.tick(); lw.events.length = 0;
      lim.command({ t: 'teleport', x: 13, y: 8 });
      most = Math.max(most, lw.enemies.length + partsIn(lw, lw.markers));
    }
    assert(most <= max && lw.enemies.some(e => e.kind === CENTIPEDE), `seed ${k}: the limit ${max} — at most ${most} on the arena and at the markers`);
    assert(replays(sim) && replays(lim), `seed ${k}: replay`);
  }
});

check('a roster of centipedes brings at most 2 heads at a time (bodies of 5), several seeds', () => {
  for (const k of [1, 2, 3]) {
    const p = defaultParams();
    p.heroHp = 999; p.contactDamage = 0; p.hitstop = false;
    const sim = new Simulation({ arena: 'fc-come', params: p, seed: seedOf(k), record: true }), w = sim.world;
    let most = 0, parts = 0;
    for (let i = 0; i < ticksOf(40) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      most = Math.max(most, w.enemies.filter(e => e.kind === CENTIPEDE && e.vars.ca === undefined).length);
      parts = Math.max(parts, w.enemies.filter(e => e.kind === CENTIPEDE).length);
      sim.command({ t: 'teleport', x: 13, y: 8 });
    }
    assert(most === 2 && parts === 10, `seed ${k}: at most 2 heads (${most}), ${parts} parts`);
  }
});

check('the telemetry counts the lunges, the divisions and the new heads; the threat `centipede-lunge` — hit and dodged; a journal without the new keys plays the same world (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { contactDamage: 1 }), w = sim.world;
    const observer = createFightObserver(w), threats = new ThreatTracker(w);
    const tick = (n: number): void => { for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); observer.tick(w); threats.tick(w); w.events.length = 0; } };
    const cmd = (c: Parameters<Simulation['command']>[0]): unknown => { const r = sim.command(c); observer.command(c, w); return r; };
    cmd({ t: 'teleport', x: 6, y: 8 });
    const head = cmd({ t: 'place', x: 9, y: 8, color: 1, hp: 1, kind: CENTIPEDE }) as number;
    // The first lunge hits; the hero then steps out of the second one.
    const h = w.enemies.find(e => e.id === head)!;
    const lane = (): boolean => (centipedeLane(w, h)?.charging === false);
    tick(ticksOf(CENTI_FIRST_LUNGE + 1.5));
    assert(w.hero.hp < 99 && !centipedeLane(w, h), `seed ${k}: the first lunge hit and ended`);
    cmd({ t: 'teleport', x: h.x - 3, y: h.y });
    for (let i = 0; i < ticksOf(4) && !lane(); i++) tick(1);
    assert(lane(), `seed ${k}: a second windup`);
    tick(ticksOf(0.2));
    cmd({ t: 'walk', x: 0, y: 1 });
    tick(ticksOf(1.2));
    cmd({ t: 'walk', x: 0, y: 0 });
    // A division: the middle part.
    const parts = centipedeBody(w, head).map(id => w.enemies.find(e => e.id === id)!);
    cmd({ t: 'teleport', x: parts[2].x, y: parts[2].y - 1.2 });
    cmd({ t: 'begin', x: parts[2].x, y: parts[2].y });
    cmd({ t: 'release' });
    tick(ticksOf(1));
    threats.finish(w);
    const s = observer.summary().forest.centipedes, t = threats.tally()['centipede-lunge'];
    assert(s.lunges >= 2 && s.splits === 1 && s.heads === 1 && s.joins === 0 && s.stuck === 0, `seed ${k}: the telemetry (${JSON.stringify(s)})`);
    assert(t && t.hit >= 1 && t.dodged >= 1, `seed ${k}: the threats (${JSON.stringify(t)})`);
    const journal = sim.exportJournal()! as Journal & { params: Partial<Params> };
    for (const key of ['centiParts', 'centiLungeWindup'] as const) delete journal.params[key];
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(w), `seed ${k}: the journal without the keys plays the same world`);
  }
});

console.log(`forest centipede: ${checks} checks passed`);
