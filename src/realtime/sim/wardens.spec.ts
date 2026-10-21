/**
 * Task 59а «Гарнизон, шаг 3», В — «Привратники» and the anger (enemies/warden.ts; docs/realtime-elite-behaviors.md, «Гарнизон, шаг 3»).
 * Node only: `npm run test:realtime-wardens`.
 *
 * Every check plays journalled commands (begin, drag, release, items, item, teleport, param) and looks at what the player meets:
 * - the pair's colours: different, never twins (0 + 2, 1 + 3), different by seed, the same for the same seed;
 * - a chain that kills one of the pair: the highlight names the angry partner (`anger`) — after the pass it is angry: fast, its touch 2,
 *   «Размах» 2 s after (the first of a fight ×1.5), calm after 8 s;
 * - both by one pass (the colour freed by «Смена цвета») — no anger, as the highlight says;
 * - one killed outside a pass (the bomb) — the other angry at once;
 * - «Клеймо» never repaints a warden; the law off — no pair, no anger; a journal without the keys plays the same world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import './arenasStep3';
import { planChain } from './chain';
import { kindOf } from './enemies/kinds';
import { WARDEN, wardenAnger, wardenAngry, wardenPartner, wardenSwing } from './enemies/warden';
import { brandPaintable } from './fusions';
import { COUNTER_TALISMANS, FUSIONS, HAMMERS } from './buildIds';
import type { Loadout } from './kit';
import type { Vec } from './geometry';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { touchDamage, type Enemy, type World, type WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

registerArena({
  id: 'warden-gate', name: 'Ворота привратников', summary: 'Тест привратников', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 7 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true,
  enemies: [{ x: 9.4, y: 4, color: 0, kind: WARDEN, formation: 1 }, { x: 10.6, y: 4, color: 0, kind: WARDEN, formation: 1 }],
});

function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
  p.wardens = true; p.colorShiftLinks = 0; p.invulnerability = 0; p.chainShield = 0;
  return Object.assign(p, extra);
}
function gate(k: number, extra: Partial<Params> = {}, loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena: 'warden-gate', params: quiet(extra), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.tick();
  return sim;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Extract<WorldEvent, { type: T }>[] => events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const pair = (w: World): Enemy[] => w.enemies.filter(e => e.kind === WARDEN).sort((a, b) => a.id - b.id);
const place = (sim: Simulation, at: Vec, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const q of points.slice(1)) sim.command({ t: 'drag', x: q.x, y: q.y, mode: 'full' });
}
function release(sim: Simulation): WorldEvent[] {
  assert(sim.command({ t: 'release' }), 'the chain is released');
  return ticks(sim, ticksOf(3), [], w => !w.move);
}
const twin = (c: number): number => (c < 4 ? (c + 2) % 4 : -1);

check('the pair\'s colours: different, never twins; different on 8 seeds, the same for the same seed', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const [a, b] = pair(gate(k).world);
    assert(a.color !== b.color && b.color !== twin(a.color), `seed ${k}: ${a.color} / ${b.color}`);
    const again = pair(gate(k).world);
    assert(again[0].color === a.color && again[1].color === b.color, `seed ${k}: the same again`);
    seen.add(`${a.color}/${b.color}`);
  }
  assert(seen.size >= 3, `the colours differ by seed (${[...seen].join(', ')})`);
});

check('a chain that kills one: the highlight names the angry partner; after the pass it is angry — fast, its touch 2, «Размах» after 2 s (windup ×1.5), calm after 8 s (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const sim = gate(k), w = sim.world, [a, b] = pair(w);
    const weak = place(sim, { x: 9, y: 5.8 }, 0, 'basic', a.color);
    draw(sim, [weak, a]);
    assert(w.chain.length === 2 && JSON.stringify(planChain(w).anger) === JSON.stringify([b.id]), `seed ${k}: the highlight — ${JSON.stringify(planChain(w).anger)}`);
    const events = release(sim);
    assert(!w.enemies.includes(a) && wardenAngry(b) && of(events, 'warden').some(e => e.action === 'anger' && e.stage === 'start' && e.id === b.id), `seed ${k}: the partner angry`);
    assert(kindOf(b).speedClassOf!(b) === 'fast' && touchDamage(w, b) === 2, `seed ${k}: fast, touch 2`);
    const swing = ticks(sim, ticksOf(2.05));
    assert(of(swing, 'warden').some(e => e.action === 'swing' && e.stage === 'start'), `seed ${k}: «Размах» begins 2 s after`);
    // The view's helpers: the anger's clock, the swing's circle winding up.
    const sw = wardenSwing(w, b), ang = wardenAnger(w, b);
    assert(sw && sw.progress > 0 && sw.progress < 0.2 && ang && ang.total === 8 && ang.left < 6.1 && ang.left > 5.8, `seed ${k}: the view's anger ${JSON.stringify(ang)} and swing ${JSON.stringify(sw)}`);
    const rest = ticks(sim, ticksOf(6.1));
    assert(of(rest, 'warden').some(e => e.action === 'swing' && e.stage === 'hit') && of(rest, 'warden').some(e => e.action === 'anger' && e.stage === 'end'), `seed ${k}: struck, then calm`);
    assert(!wardenAngry(b) && kindOf(b).speedClassOf!(b) === 'slow' && touchDamage(w, b) === 0, `seed ${k}: calm again (touch as a plain enemy: 0 here)`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('the cold does not stop the anger: the angry warden frozen 3 s is calm 8 s after the anger began (spec В11; 2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = gate(k), w = sim.world, [a, b] = pair(w);
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    sim.command({ t: 'teleport', x: 9.4, y: 6 });
    sim.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
    ticks(sim, 2);
    assert(wardenAngry(b), `seed ${k}: angry`);
    sim.command({ t: 'chill', id: b.id, seconds: 3 });
    ticks(sim, ticksOf(7.7));
    assert(wardenAngry(b), `seed ${k}: still angry before 8 s`);
    const end = ticks(sim, ticksOf(0.4));
    assert(!wardenAngry(b) && of(end, 'warden').some(e => e.action === 'anger' && e.stage === 'end'), `seed ${k}: calm at 8 s, the cold did not stop the clock`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('both by one pass — the colour freed by «Смена цвета» (4 links): no anger, as the highlight says (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    // Three weak links of colour A first (power for both: HP 2 each), the colour free from the 4th link (A's warden) on.
    const sim = gate(k, { colorShiftLinks: 4 }), w = sim.world, [a, b] = pair(w);
    const weak = [{ x: 9.6, y: 5.6 }, { x: 8.4, y: 5.2 }, { x: 8.2, y: 4 }].map(at => place(sim, at, 0, 'basic', a.color));
    draw(sim, [...weak, a, b]);
    assert(w.chain.length === 5 && planChain(w).links.every(l => l.outcome?.killed) && !planChain(w).anger, `seed ${k}: both drawn and killed, no anger in the highlight (${w.chain.length})`);
    const events = release(sim);
    ticks(sim, ticksOf(1), events);
    assert(!w.enemies.includes(a) && !w.enemies.includes(b) && !of(events, 'warden').length, `seed ${k}: both fell, no anger`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

check('one killed outside a pass (the bomb): the other angry at once; «Клеймо» never repaints a warden', () => {
  for (const k of [1, 2]) {
    const sim = gate(k), w = sim.world, [a, b] = pair(w);
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    sim.command({ t: 'teleport', x: 9.4, y: 6 });
    assert(sim.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y }) && !w.enemies.includes(a), `seed ${k}: bombed`);
    const events = ticks(sim, 2);
    assert(wardenAngry(b) && of(events, 'warden').some(e => e.action === 'anger'), `seed ${k}: angry at once`);
    assert(!brandPaintable(b, false, []), 'never repainted');
  }
});

/**
 * Design 21.10.2026 (review of 59а): the highlight's `anger` is what the pass does with every hit of its end — a source kills one of the
 * pair (anger the plan promises), or the second too (no anger, though the chain killed the first). The pair at A (9.4, 4), B (10.6, 4),
 * HP 1; three weak links before. `other` — a colour of neither of the pair.
 */
interface AngerCase { title: string; loadout: Loadout; extra?: Partial<Params>; links: (a: Enemy, b: Enemy) => { at: Vec; color: 'a' | 'other' }[]; toA: boolean; angry: boolean }
const ANGER_CASES: readonly AngerCase[] = [
  // «Взрыв на конце» (radius 1.5 round the last link): the chain kills A, the blast B — no anger; the blast round a link by A — anger.
  { title: 'end blast kills the second', loadout: { talismans: [], hammer: HAMMERS.blast }, toA: true, angry: false,
    links: () => [{ at: { x: 9.2, y: 6.2 }, color: 'a' }, { at: { x: 8.4, y: 5.4 }, color: 'a' }, { at: { x: 8.2, y: 4.3 }, color: 'a' }] },
  { title: 'end blast kills one', loadout: { talismans: [], hammer: HAMMERS.blast }, toA: false, angry: true,
    links: () => [{ at: { x: 9.2, y: 6.2 }, color: 'other' }, { at: { x: 8.6, y: 5.3 }, color: 'other' }, { at: { x: 8.3, y: 4.3 }, color: 'other' }] },
  // «Ударная волна» (radius 2 round the dash's end; 3 links with the counter window).
  { title: 'shockwave kills the second', loadout: { talismans: [COUNTER_TALISMANS.shockwave] }, extra: { counterWindow: true, shockwaveLinks: 3 }, toA: true, angry: false,
    links: () => [{ at: { x: 9.2, y: 6.2 }, color: 'a' }, { at: { x: 8.4, y: 5.4 }, color: 'a' }, { at: { x: 8.2, y: 4.3 }, color: 'a' }] },
  { title: 'shockwave kills one', loadout: { talismans: [COUNTER_TALISMANS.shockwave] }, extra: { counterWindow: true, shockwaveLinks: 3 }, toA: false, angry: true,
    links: () => [{ at: { x: 8.9, y: 6.3 }, color: 'other' }, { at: { x: 8.1, y: 5.5 }, color: 'other' }, { at: { x: 7.6, y: 4.6 }, color: 'other' }] },
  // «Ледяная волна»: the same wave, the survivors frozen (the cold does not stop the anger).
  { title: 'frost wave kills the second', loadout: { talismans: [COUNTER_TALISMANS.shockwave, FUSIONS.frostWave] }, extra: { counterWindow: true, shockwaveLinks: 3 }, toA: true, angry: false,
    links: () => [{ at: { x: 9.2, y: 6.2 }, color: 'a' }, { at: { x: 8.4, y: 5.4 }, color: 'a' }, { at: { x: 8.2, y: 4.3 }, color: 'a' }] },
  { title: 'frost wave kills one', loadout: { talismans: [COUNTER_TALISMANS.shockwave, FUSIONS.frostWave] }, extra: { counterWindow: true, shockwaveLinks: 3 }, toA: false, angry: true,
    links: () => [{ at: { x: 8.9, y: 6.3 }, color: 'other' }, { at: { x: 8.1, y: 5.5 }, color: 'other' }, { at: { x: 7.6, y: 4.6 }, color: 'other' }] },
  // «Режущий проход» (0.5 + body from the path, not the links): the way to A passes by B — no anger; a way by A only — anger.
  { title: 'cut kills the second', loadout: { talismans: [], hammer: HAMMERS.cut }, toA: true, angry: false,
    links: () => [{ at: { x: 11.6, y: 5.8 }, color: 'a' }, { at: { x: 11.3, y: 4.4 }, color: 'a' }] },
  { title: 'cut kills one', loadout: { talismans: [], hammer: HAMMERS.cut }, toA: false, angry: true,
    links: () => [{ at: { x: 9.0, y: 6.0 }, color: 'other' }, { at: { x: 8.8, y: 4.5 }, color: 'other' }, { at: { x: 7.9, y: 3.4 }, color: 'other' }] },
];

check('the highlight\'s anger = the pass for every hit of its end: end blast, «Ударная волна», «Ледяная волна», «Режущий проход» — killing one (anger promised) and the second (none) (4 seeds each)', () => {
  for (const c of ANGER_CASES) {
    for (const k of [1, 2, 3, 4]) {
      const sim = gate(k, { wardenHp: 1, ...c.extra }, c.loadout), w = sim.world, [a, b] = pair(w);
      const other = [0, 1, 2, 3].find(x => x !== a.color && x !== b.color)!;
      const weak = c.links(a, b).map(l => place(sim, l.at, 0, 'basic', l.color === 'a' ? a.color : other));
      draw(sim, c.toA ? [...weak, a] : weak);
      assert(w.chain.length === weak.length + (c.toA ? 1 : 0), `${c.title}, seed ${k}: the chain drawn (${w.chain.length})`);
      const plan = planChain(w).anger ?? [];
      assert(JSON.stringify(plan) === JSON.stringify(c.angry ? [b.id] : []), `${c.title}, seed ${k}: the highlight's anger ${JSON.stringify(plan)}`);
      release(sim);
      ticks(sim, 2);
      const angry = pair(w).filter(e => wardenAngry(e)).map(e => e.id);
      assert(!w.enemies.includes(a), `${c.title}, seed ${k}: A fell`);
      assert(JSON.stringify(angry) === JSON.stringify(plan), `${c.title}, seed ${k}: the pass's anger ${JSON.stringify(angry)} = the highlight ${JSON.stringify(plan)} (B alive: ${w.enemies.includes(b)})`);
      assert(replays(sim), `${c.title}, seed ${k}: replay`);
    }
  }
});

check('a partner killed in a jump (a burn): the anger at once, in the jump — only the pass and its return run wait (design 21.10.2026; 2 seeds)', () => {
  for (const k of [1, 2]) {
    const sim = gate(k, { wardenHp: 1, fireRadius: 0.3 }), w = sim.world, [a, b] = pair(w);
    sim.command({ t: 'items', kind: 'fire', count: 1 });
    sim.command({ t: 'energy', value: 7 });
    assert(sim.command({ t: 'item', kind: 'fire', x: a.x, y: a.y }) && a.burn && !b.burn, `seed ${k}: A burns, B does not`);
    ticks(sim, ticksOf(3), [], ww => (ww.enemies.find(e => e.id === a.id)?.burn?.timer ?? 0) <= 3 * SIM_DT);
    assert(sim.command({ t: 'jump', x: 14, y: 8 }) && w.move?.kind === 'jump', `seed ${k}: the jump began`);
    ticks(sim, 12, [], ww => !ww.enemies.includes(a));
    // The group step of the next tick sees the partner gone (the jump still runs).
    ticks(sim, 1);
    assert(!w.enemies.includes(a) && w.move?.kind === 'jump' && wardenAngry(b), `seed ${k}: A burnt in the jump, B angry at once (in the jump: ${w.move?.kind})`);
    assert(replays(sim), `seed ${k}: replay`);
  }
});

registerArena({
  id: 'warden-gate-flag', name: 'Ворота привратников (флаг)', summary: 'Тест флага шаблона', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 7 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true, wardens: true,
  enemies: [{ x: 9.4, y: 4, color: 0, kind: WARDEN, formation: 1 }, { x: 10.6, y: 4, color: 0, kind: WARDEN, formation: 1 }],
});

check('the template flag `wardens` (sandbox arenas of step 3): the arena plays the pair with the key off; without the flag — no pair; a journal without the key replays the flagged world (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const flagged = new Simulation({ arena: 'warden-gate-flag', params: quiet({ wardens: false }), seed: seedOf(k), record: true });
    flagged.tick();
    const w = flagged.world, [a, b] = pair(w);
    assert(w.params.wardens === true && wardenPartner(w, a) === b, `seed ${k}: the flag turns the pair on`);
    const plain = gate(k, { wardens: false }), [pa] = pair(plain.world);
    assert(plain.world.params.wardens === false && !wardenPartner(plain.world, pa), `seed ${k}: no flag, no pair`);
    flagged.command({ t: 'items', kind: 'bomb', count: 1 });
    flagged.command({ t: 'teleport', x: 9.4, y: 6 });
    flagged.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
    ticks(flagged, ticksOf(1));
    assert(wardenAngry(b), `seed ${k}: angry`);
    assert(replays(flagged), `seed ${k}: replay`);
    const journal = flagged.exportJournal()! as Journal;
    delete (journal.params as unknown as Record<string, unknown>).wardens;
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(replay(JSON.parse(JSON.stringify(journal))).world) === strip(flagged.world), `seed ${k}: a journal without the key replays the flagged world (worldState minus params)`);
  }
});

registerArena({
  id: 'warden-tint', name: 'Ворота с тенью пары', summary: 'Тест pairTint и pairShare', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 10, y: 9 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, garrison: true, wardens: true,
  enemies: [
    { x: 9.4, y: 4, color: 0, kind: WARDEN, formation: 1 }, { x: 10.6, y: 4, color: 0, kind: WARDEN, formation: 1 },
    ...[7.6, 8.6, 11.4, 12.4].map(x => ({ x, y: 5.4, color: 3, hp: 0, pairTint: true as const })), { x: 10, y: 6.6, color: 3, hp: 0 },
  ],
  pairShare: 0.3,
});

check('task 59б «Барбакан»: start enemies with `pairTint` take A of the pair when it is drawn (no draw more: the pair\u2019s colours as on an arena without them); the rest keep theirs (6 seeds)', () => {
  const seen = new Set<number>();
  for (let k = 1; k <= 6; k++) {
    const sim = new Simulation({ arena: 'warden-tint', params: quiet(), seed: seedOf(k), record: true });
    sim.tick();
    const w = sim.world, [a, b] = pair(w), tinted = w.enemies.filter(e => e.kind === 'basic' && e.y < 6), plain = w.enemies.find(e => e.kind === 'basic' && e.y > 6)!;
    assert(tinted.length === 4 && tinted.every(e => e.color === a.color && e.vars.pt === undefined) && plain.color === 3, `seed ${k}: tinted ${tinted.map(e => e.color).join()} / A ${a.color}, the plain ${plain.color}`);
    const bare = gate(k);
    assert(pair(bare.world)[0].color === a.color && pair(bare.world)[1].color === b.color, `seed ${k}: the pair\u2019s colours are the draw of an arena without the field`);
    seen.add(a.color);
    assert(replays(sim), `seed ${k}: replay`);
  }
  assert(seen.size >= 2, `A differs by seed (${[...seen].join(', ')})`);
});

check('task 59б «Барбакан»: `pairShare` 0.3 — the newcomers take A of the living pair about 0.25 + 0.3 × 0.75 ≈ 0.48 of the time (heuristic, 0.36…0.6 over 3 long fights); replays', () => {
  let a = 0, all = 0;
  for (const k of [1, 2, 3]) {
    const p = defaultParams(); p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.wardens = true;
    const sim = new Simulation({ arena: 'warden-tint', params: p, seed: seedOf(k), record: true }), w = sim.world;
    sim.tick();
    const start = Math.max(...w.enemies.map(e => e.id)), colorA = pair(w)[0].color, counted = new Set<number>();
    for (let i = 0; i < ticksOf(60) && w.status === 'playing'; i++) {
      sim.tick(); w.events.length = 0;
      if (!pair(w).every(e => e.vars.wp !== undefined)) break;
      for (const e of w.enemies) if (e.id > start && e.kind === 'basic' && !counted.has(e.id)) { counted.add(e.id); all++; if (e.color === colorA) a++; }
    }
    assert(replays(sim), `seed ${k}: replay`);
  }
  console.log(`   цвет A у притока: ${a} из ${all} (${(a / all).toFixed(2)}; эвристика)`);
  assert(all >= 40 && a / all > 0.36 && a / all < 0.6, `the share of A ${a} / ${all}`);
});

check('task 59б: an arena without `pairTint` and `pairShare` draws as before — 30 s of «Привратники (проба)» with its newcomers on 3 seeds, the hashes of the base (main 15d09001, before 59б)', () => {
  // The base: main 15d09001 (with 59а, before 59б; on 8afcb20d before the merge of main — 1f69cda4…, 515505ba…, 448f69c0…).
  const want = ['52b223fbbb9c44aa', '887be2dd3484ef8b', '35770c47312b096d'];
  [1, 2, 3].forEach((k, i) => {
    const p = defaultParams(); p.contactDamage = 0; p.heroHp = 99; p.hitstop = false;
    const sim = new Simulation({ arena: 'g-warden-test', params: p, seed: seedOf(k), record: true });
    for (let t = 0; t < 60 * 30; t++) sim.tick();
    assert(sim.hash() === want[i], `seed ${k}: ${sim.hash()}`);
  });
});

check('the law off: no pair, no anger; a journal without the keys plays the same world (2 seeds)', () => {
  for (const k of [1, 2]) {
    const off = gate(k, { wardens: false }), w = off.world, [a, b] = pair(w);
    assert(!wardenPartner(w, a) && a.color === 0 && b.color === 0, `seed ${k}: no pair`);
    off.command({ t: 'items', kind: 'bomb', count: 1 });
    off.command({ t: 'teleport', x: 9.4, y: 6 });
    off.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
    ticks(off, 10);
    assert(!wardenAngry(b), `seed ${k}: no anger`);
    const sim = gate(k), sw = sim.world, [pa] = pair(sw);
    const weak = place(sim, { x: 9, y: 5.8 }, 0, 'basic', pa.color);
    draw(sim, [weak, pa]); release(sim);
    ticks(sim, ticksOf(4));
    const journal = sim.exportJournal()! as Journal;
    for (const key of ['wardenHp', 'wardenAnger', 'wardenAngerTouch']) delete (journal.params as unknown as Record<string, unknown>)[key];
    const again = replay(JSON.parse(JSON.stringify(journal)));
    const strip = (x: World): string => JSON.stringify({ ...(worldState(x) as Record<string, unknown>), params: null });
    assert(strip(again.world) === strip(sw), `seed ${k}: the same world without the numbers' keys`);
  }
});

console.log(`wardens: ${checks} checks passed`);
