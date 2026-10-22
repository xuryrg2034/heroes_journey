/**
 * Task 57б-1 «Лес: механики» — «Корневик» (enemies/rootling.ts), «Слизень» (enemies/slime.ts), «Головешка» (enemies/firebrand.ts). Node
 * only: `npm run test:realtime-forest-tricks`.
 *
 * Every check plays journalled commands (clear, place, teleport, walk, items, item, begin / drag / release / cancel) and looks at what the
 * player meets (docs/design-notes/task-57-forest-enemies.md, 17):
 * - the rootling: one chain through the group of 4 — the stumps crumble, 4 kills counted then (none before); two chains 6 s apart — the
 *   first ones rose; the cold holds a stump, fire burns it for good, the hero on a stump keeps it down, a dash keeps every stump down;
 *   killed by fire — no stump; the highlight «рассыплются» is the pass's (several seeds, a group that walks in by the roster);
 * - the slime: two small ones of one colour touching 1 s merge (HP 2, no kill); not two colours, not in the drawn chain, not while the
 *   dash runs; the big one as the first link survives as the highlight says;
 * - the firebrand: a lethal link puts it out and ends the chain (the highlight's «погаснет», several seeds, walking); put out, it runs
 *   to a burning brazier and burns again after 1 s; a chain through the brazier leaves it nowhere to light; the cold and water put it
 *   out; in the drawn chain it never lights; its trail burns the hero on foot, never an enemy; fire lights a put-out one; a bomb puts a
 *   burning one out, kills a put-out one;
 * - a journal without the new keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain } from './chain';
import { BRAND_RELIGHT, FIREBRAND, brandLit } from './enemies/firebrand';
import { bodyRadiusOf } from './enemies/kinds';
import { ROOTLING, ROOT_GROUPS_MAX, rootGroup } from './enemies/rootling';
import { SLIME, slimeBig, slimePairs } from './enemies/slime';
import { pond, type Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { createFightObserver } from '../telemetry/observe';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

const base = { goal: 'kills' as const, killGoal: 999, buttons: [], enemies: [], summary: 'Тест механик леса' };
registerArena({ ...base, id: 'ft-field', name: 'Поле механик', width: 24, height: 14, heroStart: { x: 6, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 } });
registerArena({ ...base, id: 'ft-brazier', name: 'Жаровня', width: 24, height: 14, heroStart: { x: 6, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 }, braziers: [{ x: 10, y: 10 }] });
registerArena({ ...base, id: 'ft-pond', name: 'Пруд', width: 24, height: 14, heroStart: { x: 6, y: 7 }, obstacles: [pond(14, 7, 1.2)], door: { x: 23.3, y: 7 } });
registerArena({
  ...base, id: 'ft-roots', name: 'Корневики идут', width: 24, height: 14, heroStart: { x: 12, y: 7 }, obstacles: [], door: { x: 23.3, y: 7 },
  newcomers: [{ kind: ROOTLING, share: 1, group: 4 }], phaseOverride: { wolfShare: 0, boarShare: 0 },
});

/** Nothing comes, nobody walks (unless `enemySpeed` is given); the hero has 99 HP and no grace window to blur the count. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function field(k: number, extra: Partial<Params> = {}, arena = 'ft-field'): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra), seed: seedOf(k), record: true });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind: string, color = 1, hp = 0, formation?: number): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind, ...formation !== undefined ? { formation } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World, out: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world, out); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
type StumpEv = Extract<WorldEvent, { type: 'stump' }>;
type CrumbleEv = Extract<StumpEv, { action: 'crumble' }>;
type StumpOneEv = Exclude<StumpEv, CrumbleEv>;
function stumpEvents(events: readonly WorldEvent[], action: 'crumble'): CrumbleEv[];
function stumpEvents(events: readonly WorldEvent[], action: 'lie' | 'rise' | 'burn'): StumpOneEv[];
function stumpEvents(events: readonly WorldEvent[], action: string): StumpEv[] { return of(events, 'stump').filter(e => e.action === action); }
/** The kill counter now (no narrowing across the checks). */
const kills = (w: World): number => w.stats.kills;
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** Draws a chain through `points` (journalled begin / drag) — the chain stays drawn. */
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
/** Releases the drawn chain and ticks to the dash's end. */
function release(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, 600, out, w => !w.move);
}
const ids = (es: readonly Enemy[]): number[] => es.map(e => e.id);
/** A group of 4 rootlings of colour 1 (formation 1) in a row east of the hero at (6, 7). */
function rootRow(sim: Simulation, formation = 1, y = 7): Enemy[] {
  return [7.4, 8.8, 10.2, 11.6].map(x => place(sim, { x, y }, ROOTLING, 1, 0, formation));
}

// ---- «Корневик» ----

check('the rootling: one chain through the group of 4 — every stump crumbles at its end, the 4 kills count then (the chain\'s own count at once); the highlight showed «рассыплются» on those links (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    const row = rootRow(sim);
    draw(sim, row);
    assert(w.chain.length === 4, `seed ${k}: the chain takes the group (${w.chain.length})`);
    const plan = planChain(w);
    assert(plan.crumble?.length === 1 && plan.crumble[0].links.slice().sort().join() === ids(row).sort().join(), `seed ${k}: the highlight — the group crumbles (${JSON.stringify(plan.crumble)})`);
    const events = release(sim);
    const crumble = stumpEvents(events, 'crumble');
    assert(stumpEvents(events, 'lie').length === 4 && crumble.length === 1 && crumble[0].ids.length === 4, `seed ${k}: 4 stumps lay and crumbled (${crumble.length})`);
    assert(kills(w) === 4 && (w.stumps ?? []).length === 0 && !w.enemies.some(e => e.kind === ROOTLING), `seed ${k}: 4 kills, nothing left (${kills(w)})`);
    ticks(sim, ticksOf(7));
    assert(!w.enemies.some(e => e.kind === ROOTLING) && kills(w) === 4, `seed ${k}: nobody rises`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the rootling: two chains 6 s apart — the first two rose (no kill counted), the second chain through all 4 crumbles them; a chain through 3 of 4 counts no kill and shows no «рассыплются» (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    const row = rootRow(sim);
    draw(sim, row.slice(0, 3));
    assert(!planChain(w).crumble, `seed ${k}: 3 of 4 — no «рассыплются»`);
    // Two links only: the dash ends on the 2nd one's stump; the hero walks off it.
    sim.command({ t: 'cancel' });
    draw(sim, row.slice(0, 2));
    const first = release(sim);
    assert(stumpEvents(first, 'lie').length === 2 && kills(w) === 0 && w.lastChain?.kills === 2, `seed ${k}: 2 stumps, no kill counted, the chain counted 2 (${kills(w)}, ${w.lastChain?.kills})`);
    sim.command({ t: 'teleport', x: 6, y: 7 });
    const later = ticks(sim, ticksOf(6));
    const rose = stumpEvents(later, 'rise');
    assert(rose.length === 2 && w.enemies.filter(e => e.kind === ROOTLING).length === 4 && w.stumps!.length === 0, `seed ${k}: both rose (${rose.length})`);
    const risen = rose.map(e => w.enemies.find(x => x.id === e.riseId)!);
    assert(risen.every(e => e && rootGroup(e) === rootGroup(row[2]) && e.hp === 0 && e.color === 1 && !row.includes(e)), `seed ${k}: new rootlings of the same group and colour, HP 0`);
    const all = w.enemies.filter(e => e.kind === ROOTLING).sort((a, b) => a.x - b.x);
    draw(sim, all);
    assert(planChain(w).crumble?.length === 1, `seed ${k}: the highlight — they crumble`);
    const second = release(sim);
    assert(stumpEvents(second, 'crumble').length === 1 && kills(w) === 4, `seed ${k}: crumbled, 4 kills (${kills(w)})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the rootling: the cold on a stump holds its countdown (it rises 3 s late); fire on a stump burns it for good (its kill counts) and the group crumbles without it; killed by fire — no stump, the kill counts at once (2 seeds)', () => {
  for (const k of [1, 2]) {
    // The cold.
    const sim = field(k), w = sim.world;
    const row = rootRow(sim);
    draw(sim, [row[0]]);
    release(sim);
    sim.command({ t: 'teleport', x: 3, y: 3 });
    sim.command({ t: 'items', kind: 'frost', count: 1 });
    assert(sim.command({ t: 'item', kind: 'frost', x: 7.4, y: 7 }) === true && w.stumps![0].chill === w.params.frostTime, `seed ${k}: the cold took the stump`);
    const held = ticks(sim, ticksOf(6));
    assert(!stumpEvents(held, 'rise').length, `seed ${k}: the countdown waits (no rise at 6 s)`);
    const after = ticks(sim, ticksOf(2.2));
    assert(stumpEvents(after, 'rise').length === 1, `seed ${k}: it rises 3 s late`);
    assert(replays(sim), `seed ${k}: replay (cold)`);
    // Fire on a stump.
    const fire = field(k), fw = fire.world;
    const roots = rootRow(fire);
    draw(fire, [roots[0]]);
    release(fire);
    fire.command({ t: 'teleport', x: 6, y: 3 });
    fire.command({ t: 'items', kind: 'fire', count: 1 });
    const burnt = ticks(fire, 1);
    assert(fire.command({ t: 'item', kind: 'fire', x: 7.4, y: 7 }) === true, `seed ${k}: fire aimed at the stump`);
    burnt.push(...fw.events); fw.events.length = 0;
    assert(stumpEvents(burnt, 'burn').length === 1 && fw.stumps!.length === 0 && kills(fw) === 1, `seed ${k}: the stump burnt for good, its kill counted (${kills(fw)})`);
    assert(!roots.slice(1).some(e => e.burn), `seed ${k}: the living ones off its circle do not burn`);
    fire.command({ t: 'teleport', x: 8, y: 8 });
    draw(fire, roots.slice(1));
    assert(fw.chain.length === 3, `seed ${k}: the chain takes the other 3 (${fw.chain.length})`);
    assert(planChain(fw).crumble?.length === 1, `seed ${k}: the other 3 — «рассыплются»`);
    const rest = release(fire);
    assert(stumpEvents(rest, 'crumble').length === 1 && kills(fw) === 4, `seed ${k}: crumbled, 4 kills (${kills(fw)})`);
    assert(!ticks(fire, ticksOf(7)).some(e => e.type === 'stump') && !fw.enemies.some(e => e.kind === ROOTLING), `seed ${k}: nothing rises`);
    assert(replays(fire), `seed ${k}: replay (fire)`);
    // Killed by fire: no stump.
    const dot = field(k), dw = dot.world;
    const lone = rootRow(dot)[3];
    dot.command({ t: 'items', kind: 'fire', count: 1 });
    dot.command({ t: 'item', kind: 'fire', x: lone.x, y: lone.y });
    const burning = ticks(dot, ticksOf(2));
    assert(!dw.enemies.includes(lone) && burning.some(e => e.type === 'kill' && e.enemyId === lone.id && e.source === 'fire') && !stumpEvents(burning, 'lie').some(e => e.id === lone.id), `seed ${k}: burnt to death, no stump`);
    assert(kills(dw) >= 1, `seed ${k}: the fire's kill counts at once (${kills(dw)})`);
    assert(replays(dot), `seed ${k}: replay (burning)`);
  }
});

check('the rootling: the hero on a stump keeps it down until he steps off; no stump rises while the hero\'s dash runs (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    const row = rootRow(sim);
    draw(sim, [row[0]]);
    release(sim);
    assert(dist(w.hero, w.stumps![0]) < 0.3, `seed ${k}: the dash left the hero on the stump`);
    const on = ticks(sim, ticksOf(7));
    assert(!stumpEvents(on, 'rise').length && w.stumps!.length === 1, `seed ${k}: he stands on it — it waits`);
    sim.command({ t: 'teleport', x: 3, y: 3 });
    assert(stumpEvents(ticks(sim, 1), 'rise').length === 1, `seed ${k}: he stepped off — it rises at once`);
    // A dash keeps the stumps down: a stump due in this tick waits while a long dash runs (basic links far off the stump).
    const dash = field(k), dw = dash.world;
    // A group of two (a lone one would crumble at once): one lies.
    const lone = place(dash, { x: 7.4, y: 7 }, ROOTLING, 1, 0, 1);
    place(dash, { x: 3, y: 3 }, ROOTLING, 1, 0, 1);
    draw(dash, [lone]);
    release(dash);
    dash.command({ t: 'teleport', x: 6, y: 11 });
    const far = [7.4, 8.8, 10.2, 11.6, 13, 14.4, 15.8, 17.2].map(x => place(dash, { x, y: 11 }, 'basic', 2));
    const lie = dw.stumps![0].left;
    ticks(dash, ticksOf(lie) - 3);
    draw(dash, far);
    assert(dash.command({ t: 'release' }) === true, `seed ${k}: the long dash`);
    const during = ticks(dash, 600, [], x => !x.move);
    assert(!stumpEvents(during, 'rise').length && dw.stumps!.length === 1, `seed ${k}: no rise while the dash runs (${during.length} events)`);
    assert(stumpEvents(ticks(dash, ticksOf(0.2)), 'rise').length === 1, `seed ${k}: it rises once the dash is over`);
    assert(replays(sim) && replays(dash), `seed ${k}: replay`);
  }
});

check('the rootling by the roster: newcomers come in groups of 4 of one colour, never more than 2 groups; a greedy chain through a group — «рассыплются» in the highlight exactly when the pass crumbles it, its kills counted then (6 seeds, the rootlings walk)', () => {
  let crumbled = 0, whole = 0, partial = 0;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const p = defaultParams();
    p.hitstop = false; p.contactDamage = 0; p.heroHp = 99; p.survivorKnockback = false;
    const sim = new Simulation({ arena: 'ft-roots', params: p, seed: seedOf(k), record: true }), w = sim.world;
    let groups = 0, maxGroups = 0;
    for (let i = 0; i < ticksOf(40) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      const now = new Set<number>([...w.enemies.filter(e => e.kind === ROOTLING).map(rootGroup), ...(w.stumps ?? []).map(s => s.group)]);
      maxGroups = Math.max(maxGroups, now.size);
      for (const g of now) {
        const members = w.enemies.filter(e => e.kind === ROOTLING && rootGroup(e) === g);
        assert(new Set(members.map(e => e.color)).size <= 1, `seed ${k}: a group of one colour`);
      }
      // Every 4 s: the hero next to a whole group, a greedy chain through it (nearest first).
      if (i % ticksOf(4) !== 0 || w.move || w.chain.length) continue;
      const byGroup = new Map<number, Enemy[]>();
      for (const e of w.enemies) if (e.kind === ROOTLING) byGroup.set(rootGroup(e), [...byGroup.get(rootGroup(e)) ?? [], e]);
      const group = [...byGroup.values()].find(g => g.length === 4);
      if (!group) continue;
      groups++;
      const first = group.reduce((a, b) => (a.x < b.x ? a : b));
      sim.command({ t: 'teleport', x: Math.max(1, first.x - 1.2), y: first.y });
      const path = [first], left = group.filter(e => e !== first);
      while (left.length) { const last = path[path.length - 1], next = left.reduce((a, b) => (dist(a, last) <= dist(b, last) ? a : b)); path.push(next); left.splice(left.indexOf(next), 1); }
      // Every other try: 3 of the 4 only (no crumble).
      draw(sim, groups % 2 ? path : path.slice(0, 3));
      const plan = planChain(w), planned = (plan.crumble ?? []).map(c => c.group).sort(), killsBefore = kills(w);
      if (w.chain.length === 4) whole++; else partial++;
      const events = release(sim);
      const done = stumpEvents(events, 'crumble');
      assert(done.map(c => c.group).sort().join() === planned.join(), `seed ${k}: the highlight's crumble ${planned} is the pass's ${done.map(c => c.group)}`);
      const paid = done.reduce((n, c) => n + c.ids.length, 0);
      assert(kills(w) - killsBefore === paid, `seed ${k}: the kills counted are the crumbled stumps (${kills(w) - killsBefore} / ${paid})`);
      crumbled += done.length;
      i++;
    }
    assert(maxGroups <= ROOT_GROUPS_MAX && maxGroups >= 1, `seed ${k}: groups at most ${ROOT_GROUPS_MAX} (${maxGroups})`);
    assert(replays(sim), `seed ${k}: replay`);
    console.log(`   seed ${k}: chains through a group ${groups}, most groups at once ${maxGroups}`);
  }
  console.log(`   whole chains ${whole}, partial ${partial}, crumbled ${crumbled}`);
  assert(crumbled >= 3 && partial >= 3, `both cases met: crumbled ${crumbled}, partial chains ${partial}`);
});

// ---- «Слизень» ----

check('the slime: two small ones of one colour touching 1 s merge — the smaller id stays, big, HP 2, a bigger body; no kill; two colours never merge (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    const a = place(sim, { x: 12, y: 7 }, SLIME, 1), b = place(sim, { x: 12.5, y: 7 }, SLIME, 1);
    const c = place(sim, { x: 12, y: 10 }, SLIME, 2), d = place(sim, { x: 12.5, y: 10 }, SLIME, 3);
    const small = bodyRadiusOf(w.params, a);
    const early = ticks(sim, ticksOf(0.9));
    assert(!of(early, 'slime').length && slimePairs(w).some(q => q.a === a.id && q.b === b.id && q.share > 0.8), `seed ${k}: a pair, no merge before 1 s`);
    const merged = of(ticks(sim, ticksOf(0.2)), 'slime');
    assert(merged.length === 1 && merged[0].id === a.id && merged[0].goneId === b.id, `seed ${k}: merged (${JSON.stringify(merged)})`);
    assert(slimeBig(a) && a.hp === 2 && !w.enemies.includes(b) && bodyRadiusOf(w.params, a) > small * 1.5 && Math.abs(a.x - 12.25) < 1e-9, `seed ${k}: big, HP 2, at the midpoint`);
    assert(kills(w) === 0, `seed ${k}: no kill`);
    ticks(sim, ticksOf(3));
    assert(w.enemies.includes(c) && w.enemies.includes(d) && !slimeBig(c) && !slimeBig(d), `seed ${k}: two colours never merge`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the slime: a link of the drawn chain never merges (its pair\'s clock waits; out of the chain it merges); the clock waits while the dash runs (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k), w = sim.world;
    const a = place(sim, { x: 7.4, y: 7 }, SLIME, 1), b = place(sim, { x: 7.9, y: 7 }, SLIME, 1);
    ticks(sim, ticksOf(0.5));
    draw(sim, [a]);
    assert(w.chain.length === 1, `seed ${k}: taken into the chain`);
    const held = ticks(sim, ticksOf(2));
    assert(!of(held, 'slime').length && w.enemies.includes(b), `seed ${k}: in the chain — no merge`);
    sim.command({ t: 'cancel' });
    const out = of(ticks(sim, ticksOf(0.6)), 'slime');
    assert(out.length === 1, `seed ${k}: out of the chain it merges (the clock went on from where it waited)`);
    // The dash: the clock stands while it runs.
    const dash = field(k), dw = dash.world;
    const p = place(dash, { x: 12, y: 3 }, SLIME, 1), q = place(dash, { x: 12.5, y: 3 }, SLIME, 1);
    const far = [7.4, 8.8, 10.2, 11.6, 13, 14.4, 15.8, 17.2].map(x => place(dash, { x, y: 10 }, 'basic', 2));
    dash.command({ t: 'teleport', x: 6, y: 10 });
    ticks(dash, ticksOf(0.5));
    const before = p.vars.pt;
    draw(dash, far);
    assert(dash.command({ t: 'release' }) === true, `seed ${k}: the long dash`);
    let moving = 0;
    // (The tick the dash ends in runs the world after it: the clock goes on there.)
    for (let i = 0; i < 600 && dw.move; i++) { dash.tick(); dw.events.length = 0; moving++; if (dw.move) assert(p.vars.pt === before, `seed ${k}: the clock waits during the dash`); }
    assert(moving > 10 && dw.enemies.includes(q), `seed ${k}: the dash ran ${moving} ticks, no merge`);
    assert(replays(sim) && replays(dash), `seed ${k}: replay`);
  }
});

check('the slime: the big one as the first link survives (HP 2 → 1) and ends the chain, as the highlight says; a chain through a pair before it merges kills both (3 seeds, walking)', () => {
  for (const k of [1, 2, 3]) {
    const sim = field(k), w = sim.world;
    const a = place(sim, { x: 7.4, y: 7 }, SLIME, 1);
    place(sim, { x: 7.9, y: 7 }, SLIME, 1);
    ticks(sim, ticksOf(1.2));
    assert(slimeBig(a), `seed ${k}: merged`);
    draw(sim, [a]);
    const plan = planChain(w);
    assert(plan.endsOnSurvivor && plan.links[0].outcome?.hpAfter === 1, `seed ${k}: the highlight — a survivor with 1 HP`);
    release(sim);
    assert(w.enemies.includes(a) && a.hp === 1 && kills(w) === 0, `seed ${k}: it survived with 1 HP`);
    // Walking slimes: a chain through the pair before it merges.
    const walk = field(k, { enemySpeed: 1.2, speedSpread: 0.15 }), ww = walk.world;
    walk.command({ t: 'teleport', x: 5.6, y: 7 });
    const x = place(walk, { x: 7, y: 6.8 }, SLIME, 1), y = place(walk, { x: 7.5, y: 7.2 }, SLIME, 1);
    ticks(walk, ticksOf(0.4));
    draw(walk, [x, y]);
    assert(ww.chain.length === 2, `seed ${k}: the chain takes the pair (${ww.chain.length})`);
    const pp = planChain(ww);
    assert(pp.links.length === 2 && pp.links.every(l => l.outcome?.killed), `seed ${k}: the highlight — both die`);
    release(walk);
    assert(!ww.enemies.includes(x) && !ww.enemies.includes(y) && kills(ww) === 2, `seed ${k}: both died (${kills(ww)})`);
    assert(replays(sim) && replays(walk), `seed ${k}: replay`);
  }
});

// ---- «Головешка» ----

check('the firebrand: a lethal link puts it out — no kill, a survivor that ends the chain, as the highlight says («погаснет»); a weak link before it dies (4 seeds, walking)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = field(k, { enemySpeed: 1.2, speedSpread: 0.15 }), w = sim.world;
    const weak = place(sim, { x: 7.4, y: 7 }, 'basic', 1), brand = place(sim, { x: 8.8, y: 7.3 }, FIREBRAND, 1);
    ticks(sim, ticksOf(0.3));
    assert(brandLit(brand), `seed ${k}: it burns`);
    draw(sim, [weak, brand]);
    const plan = planChain(w);
    assert(plan.endsOnSurvivor && plan.links[1].outcome?.douse === true && !plan.links[1].outcome.killed && plan.links[0].outcome?.killed, `seed ${k}: the highlight — the weak one dies, the firebrand goes out`);
    const events = release(sim);
    const out = of(events, 'firebrand');
    assert(w.enemies.includes(brand) && !brandLit(brand) && out.length === 1 && out[0].why === 'hit', `seed ${k}: it went out (${JSON.stringify(out)})`);
    assert(!w.enemies.includes(weak) && kills(w) === 1, `seed ${k}: the weak one died, the firebrand did not (${kills(w)})`);
    // Put out: a plain link of HP 0 — the chain kills it.
    sim.command({ t: 'teleport', x: brand.x - 1.2, y: brand.y });
    draw(sim, [brand]);
    assert(planChain(w).links[0].outcome?.killed === true, `seed ${k}: the highlight — put out, it dies`);
    release(sim);
    assert(!w.enemies.includes(brand) && kills(w) === 2, `seed ${k}: killed`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the firebrand: put out, it runs to the burning brazier within 4 s and burns again 1 s after it reached it; a chain through the brazier leaves it nowhere to light (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { enemySpeed: 1.2 }, 'ft-brazier'), w = sim.world;
    const brand = place(sim, { x: 7.4, y: 7.5 }, FIREBRAND, 1);
    draw(sim, [brand]);
    const doused = release(sim);
    assert(of(doused, 'firebrand').some(e => e.action === 'out'), `seed ${k}: it went out`);
    sim.command({ t: 'teleport', x: 3, y: 3 });
    const t0 = w.time;
    const lit = ticks(sim, ticksOf(BRAND_RELIGHT + 4.5), [], (_w, out) => of(out, 'firebrand').some(e => e.action === 'lit'));
    const brazier = w.objects.find(o => o.kind === 'brazier')!;
    const event = of(lit, 'firebrand').find(e => e.action === 'lit');
    assert(event?.why === 'brazier' && brandLit(brand) && w.time - t0 <= 4 + BRAND_RELIGHT + 0.05 && dist(brand, brazier) < 1.1, `seed ${k}: it burns again at the brazier after ${(w.time - t0).toFixed(2)} s`);
    assert(replays(sim), `seed ${k}: replay`);
    // The chain takes the brazier while it runs: no burning brazier — it gives up and stays out.
    const take = field(k, { enemySpeed: 1.2 }, 'ft-brazier'), tw = take.world;
    const b2 = place(take, { x: 7.4, y: 7.5 }, FIREBRAND, 1);
    draw(take, [b2]);
    release(take);
    const br = tw.objects.find(o => o.kind === 'brazier')!;
    take.command({ t: 'teleport', x: br.x + 1.2, y: br.y + 1.2 });
    take.command({ t: 'begin', x: br.x, y: br.y });
    assert(tw.chain.length === 1, `seed ${k}: the chain takes the brazier`);
    release(take);
    assert(br.out !== undefined, `seed ${k}: the brazier went out`);
    take.command({ t: 'teleport', x: 20, y: 3 });
    const after = ticks(take, ticksOf(8));
    assert(!of(after, 'firebrand').some(e => e.action === 'lit') && !brandLit(b2) && tw.enemies.includes(b2), `seed ${k}: nowhere to light — it stays out`);
    assert(replays(take), `seed ${k}: replay (brazier taken)`);
  }
});

check('the firebrand: the cold and water put a burning one out with no hit; a link of the drawn chain never lights at the brazier (out of the chain it lights within 1 s) (2 seeds)', () => {
  for (const k of [1, 2]) {
    const cold = field(k), cw = cold.world;
    const a = place(cold, { x: 12, y: 7 }, FIREBRAND, 1);
    cold.command({ t: 'items', kind: 'frost', count: 1 });
    cold.command({ t: 'item', kind: 'frost', x: 12, y: 7 });
    const ce = of(ticks(cold, 2), 'firebrand');
    assert(ce.length === 1 && ce[0].why === 'cold' && !brandLit(a) && cw.enemies.includes(a) && cw.hero.hp === 99, `seed ${k}: the cold put it out (${JSON.stringify(ce)})`);
    const water = field(k, {}, 'ft-pond'), ww = water.world;
    const b = place(water, { x: 14, y: 7 }, FIREBRAND, 1);
    const we = of(ticks(water, 2), 'firebrand');
    assert(we.length === 1 && we[0].why === 'water' && !brandLit(b) && ww.enemies.includes(b), `seed ${k}: water put it out`);
    // At the brazier, a link of the drawn chain: it never lights.
    const sim = field(k, { enemySpeed: 1.2 }, 'ft-brazier'), w = sim.world;
    const brazier = w.objects.find(o => o.kind === 'brazier')!;
    const c = place(sim, { x: brazier.x + 0.9, y: brazier.y }, FIREBRAND, 1);
    sim.command({ t: 'teleport', x: brazier.x + 2.1, y: brazier.y });
    draw(sim, [c]);
    release(sim);
    ticks(sim, ticksOf(0.3), [], () => c.vars.fp === 2);
    assert(c.vars.fp === 2, `seed ${k}: it stands at the brazier`);
    sim.command({ t: 'teleport', x: c.x + 1.2, y: c.y + 0.3 });
    draw(sim, [c]);
    assert(w.chain.length === 1, `seed ${k}: taken into the chain`);
    const held = ticks(sim, ticksOf(2));
    assert(!of(held, 'firebrand').some(e => e.action === 'lit') && !brandLit(c), `seed ${k}: in the chain it never lights`);
    sim.command({ t: 'cancel' });
    const lit = ticks(sim, ticksOf(BRAND_RELIGHT + 0.05));
    assert(of(lit, 'firebrand').some(e => e.action === 'lit' && e.why === 'brazier') && brandLit(c), `seed ${k}: out of the chain it lights`);
    assert(replays(cold) && replays(water) && replays(sim), `seed ${k}: replay`);
  }
});

check('the firebrand: its trail burns the hero on foot (source `fire-trail`), never an enemy (an HP 2 one stays at 2); fire lights a put-out one (no burning), a burning one stays as it is; a bomb puts a burning one out, kills a put-out one (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { enemySpeed: 1.2 }), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 7 });
    const brand = place(sim, { x: 12, y: 7 }, FIREBRAND, 1);
    ticks(sim, ticksOf(2));
    const points = w.trails.filter(t => t.ownerId === brand.id);
    assert(points.length >= 4 && points.every(t => t.brand), `seed ${k}: it leaves its trail (${points.length})`);
    const tough = place(sim, { x: points[0].x, y: points[0].y }, 'basic', 2, 2);
    sim.command({ t: 'teleport', x: points[1].x, y: points[1].y });
    const burnt = ticks(sim, 3);
    assert(burnt.some(e => e.type === 'hit' && e.source === 'fire-trail') && w.hero.hp < 99, `seed ${k}: the hero on foot in it is burnt`);
    sim.command({ t: 'teleport', x: 20, y: 12 });
    ticks(sim, ticksOf(1.5));
    assert(tough.hp === 2, `seed ${k}: the enemy in it is not (${tough.hp})`);
    assert(replays(sim), `seed ${k}: replay (trail)`);
    // Fire and the bomb.
    const items = field(k), iw = items.world;
    const lit = place(items, { x: 12, y: 7 }, FIREBRAND, 1), out = place(items, { x: 16, y: 7 }, FIREBRAND, 2);
    items.command({ t: 'items', kind: 'frost', count: 1 });
    items.command({ t: 'item', kind: 'frost', x: 16, y: 7 });
    ticks(items, 2);
    items.command({ t: 'chill', id: out.id, seconds: 0 });
    assert(!brandLit(out), `seed ${k}: one put out by the cold`);
    items.command({ t: 'items', kind: 'fire', count: 2 });
    items.command({ t: 'item', kind: 'fire', x: 16, y: 7 });
    items.command({ t: 'item', kind: 'fire', x: 12, y: 7 });
    const fired = of(iw.events, 'firebrand'); iw.events.length = 0;
    assert(brandLit(out) && !out.burn && fired.some(e => e.id === out.id && e.action === 'lit' && e.why === 'fire'), `seed ${k}: fire lit the put-out one, no burning`);
    assert(brandLit(lit) && !lit.burn && !fired.some(e => e.id === lit.id), `seed ${k}: the burning one stays as it is`);
    items.command({ t: 'teleport', x: 13, y: 7 });
    items.command({ t: 'items', kind: 'bomb', count: 2 });
    items.command({ t: 'item', kind: 'bomb', x: 12, y: 7 });
    assert(iw.enemies.includes(lit) && !brandLit(lit) && kills(iw) === 0, `seed ${k}: the bomb put the burning one out`);
    items.command({ t: 'item', kind: 'bomb', x: lit.x, y: lit.y });
    assert(!iw.enemies.includes(lit) && kills(iw) === 1, `seed ${k}: the second bomb killed it`);
    assert(replays(items), `seed ${k}: replay (items)`);
  }
});

// ---- The keys, the telemetry ----

check('a journal without the new keys plays the same world (rootlings, slimes, firebrands); the telemetry counts the stumps, the merges and the firebrands\' fire (2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = field(k, { enemySpeed: 1.2 }, 'ft-brazier'), w = sim.world;
    const observer = createFightObserver(w);
    const tick = (n: number): void => { for (let i = 0; i < n && w.status === 'playing'; i++) { sim.tick(); observer.tick(w); w.events.length = 0; } };
    const cmd = (c: Parameters<Simulation['command']>[0]): unknown => { const r = sim.command(c); observer.command(c, w); return r; };
    const row = [7.4, 8.8, 10.2, 11.6].map(x => cmd({ t: 'place', x, y: 4, color: 1, hp: 0, kind: ROOTLING, formation: 1 }) as number);
    cmd({ t: 'place', x: 16, y: 4, color: 2, hp: 0, kind: SLIME });
    cmd({ t: 'place', x: 16.5, y: 4, color: 2, hp: 0, kind: SLIME });
    const brand = cmd({ t: 'place', x: 7.4, y: 7.4, color: 3, hp: 0, kind: FIREBRAND }) as number;
    cmd({ t: 'begin', x: w.enemies.find(e => e.id === brand)!.x, y: w.enemies.find(e => e.id === brand)!.y });
    cmd({ t: 'release' });
    tick(ticksOf(1));
    const root = w.enemies.find(e => e.id === row[0])!;
    cmd({ t: 'teleport', x: root.x - 1, y: root.y });
    cmd({ t: 'begin', x: root.x, y: root.y });
    assert(w.chain.length === 1, `seed ${k}: the chain takes a rootling`);
    cmd({ t: 'release' });
    tick(ticksOf(0.5));
    cmd({ t: 'teleport', x: 20, y: 12 });
    tick(ticksOf(7));
    const s = observer.summary().forest;
    assert(s.rootlings.lie >= 1 && s.rootlings.rise >= 1 && s.merges === 1 && (s.brands.out.hit ?? 0) === 1 && (s.brands.lit.brazier ?? 0) === 1, `seed ${k}: the telemetry (${JSON.stringify(s)})`);
    const journal = sim.exportJournal()! as Journal & { params: Partial<Params> };
    for (const key of ['rootRise', 'slimeMerge', 'slimeBigHp', 'brandSeek'] as const) delete journal.params[key];
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(w), `seed ${k}: the journal without the keys plays the same world`);
  }
});

console.log(`forest tricks: ${checks} checks passed`);
