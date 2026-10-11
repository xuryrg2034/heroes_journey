/**
 * B6 К7 «Проклятый сундук» (sim/chest.ts; docs/realtime-casino.md, «Проклятый сундук (К7)»). Node only:
 * `npm run test:realtime-chest`. The run's reward screen — run/chestRun.spec.ts.
 *
 * Every check plays journalled commands (place, teleport, walk, begin, drag, release, jump, clear, param) and looks at what
 * the player gets: the chest on «Застава» and nowhere else, taken by a chain link or a touch (not by a dash flying over it),
 * the highlight equal to the dash with the chest in the chain (no power, no embers, no colour change), the touch +1 while
 * cursed (normal, tough, armoured elite; not the reaper; not arrows or quills), 12 kills of the dash lift it (a hammer's
 * blast does not count), the fight replays from its journal, a journal without the key plays the old world.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena, arenaTemplate } from './arenas';
import { enemyRefusal, planChain } from './chain';
import { CHEST_CURSE_KILLS } from './chest';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { rtRunParams } from '../run/rtRun';
import { playChestFight } from '../telemetry/chestFight.testkit';
import { analyzeJournal } from '../telemetry/report';
import { emptyFightSummary, withSummaryDefaults } from '../telemetry/schema';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A test field with an authored chest point (as «Застава» has one): open ground, the hero on the left. */
const CHEST = { x: 8, y: 6 };
registerArena({
  id: 'chest-field', name: 'Поле сундука', summary: 'Тест проклятого сундука', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999, chest: CHEST,
});

/** The run's params (the chest on, touch numbers of the run) on a quiet field: no newcomers, enemies stand still. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = rtRunParams(defaultParams());
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  for (const phase of p.phases) phase.floor = 0;
  return Object.assign(p, extra);
}

function fight(params: Params = quiet(), k = 1, arena = 'chest-field', loadout?: ConstructorParameters<typeof Simulation>[0]['loadout']): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, color = 0, hp = 0, kind = 'basic', elite = false): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind, ...elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Ticks while the world plays (at most `n`); every tick's events go to `seen`. */
function ticks(sim: Simulation, n: number, seen: WorldEvent[] = [], until: (w: World) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing' && !until(sim.world); i++) { sim.tick(); seen.push(...sim.world.events); sim.world.events.length = 0; }
  return seen;
}
const chestOf = (w: World) => w.objects.find(o => o.kind === 'chest');
/** Read through functions: an assertion narrows a field, and a later command changes it. */
const curseOf = (w: World) => w.curse;
const chainLength = (w: World): number => w.chain.length;
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** The walking hero steps onto the chest (a teleport next to it, a walk into it): the curse by touch. */
function takeByTouch(sim: Simulation): void {
  const chest = chestOf(sim.world)!;
  sim.command({ t: 'teleport', x: chest.x - 1.2, y: chest.y });
  sim.command({ t: 'walk', x: 1, y: 0 });
  ticks(sim, 120, [], w => !!w.curse);
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(sim.world.curse?.by === 'touch' && !chestOf(sim.world), 'the chest is taken by touch');
}

/** A chain of `n` weak enemies of colour 0 in a row from the hero, drawn and released; ticks until the dash ends. */
function chainOf(sim: Simulation, n: number, seen: WorldEvent[] = []): Enemy[] {
  const h = sim.world.hero, row = h.y < 6 ? h.y + 2 : h.y - 2;
  const links = Array.from({ length: n }, (_, i) => place(sim, h.x + 1.2 * (i + 1) - 0.6, row - (i % 2) * 0.3, 0, 0));
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(sim.world.chain.length === n, `the chain took ${sim.world.chain.length} of ${n}`);
  sim.command({ t: 'release' });
  ticks(sim, 900, seen, w => !w.move);
  return links;
}

/** The touch damage the hero takes from one enemy placed on him (the first hit). */
function touchHit(sim: Simulation, kind: string, hp: number, elite = false): number {
  const h = sim.world.hero;
  sim.command({ t: 'param', key: 'contactDamage', value: 1 });
  ticks(sim, 180, [], w => w.hero.invulnerable <= 0 && w.hero.chainShield <= 0);
  const e = place(sim, h.x + 0.3, h.y, 1, hp, kind, elite);
  const hit = ticks(sim, 60, [], w => w.events.some(ev => ev.type === 'hit')).concat(sim.world.events).find(ev => ev.type === 'hit');
  sim.world.events.length = 0;
  assert(hit?.type === 'hit' && hit.enemyId === e.id, `${kind} hits the hero`);
  sim.command({ t: 'clear', keepMarked: false });
  return hit.damage;
}

check('the chest stands on «Застава» with the flag (and on no other arena); without it — no chest, the start enemies keep their ids', () => {
  for (const k of [1, 2, 3]) {
    const on = new Simulation({ arena: 'outpost', params: rtRunParams(defaultParams()), seed: seedOf(k) });
    const off = new Simulation({ arena: 'outpost', params: { ...rtRunParams(defaultParams()), cursedChest: false }, seed: seedOf(k) });
    const chest = chestOf(on.world), at = arenaTemplate('outpost').chest!;
    assert(chest && chest.x === at.x && chest.y === at.y && !chestOf(off.world), `seed ${k}: the chest at its point`);
    assert(same(on.world.enemies.map(e => e.id), off.world.enemies.map(e => e.id)), 'the start enemies keep their ids');
    assert(!on.world.curse && !off.world.curse, 'no curse until taken');
  }
  for (const arena of ['ford', 'last-stand', 'kills']) assert(!chestOf(new Simulation({ arena, params: rtRunParams(defaultParams()), seed: 1 }).world), `${arena}: no chest`);
});

check('«Застава»: the chest is reached by a chain from the yard and taken — the curse starts', () => {
  const sim = fight(quiet(), 4, 'outpost'), w = sim.world, chest = chestOf(w)!;
  sim.command({ t: 'teleport', x: 11.5, y: 7.6 });
  assert(sim.command({ t: 'begin', x: chest.x, y: chest.y }) === true && w.chain.length === 1, 'a chain of just the chest');
  sim.command({ t: 'release' });
  const seen = ticks(sim, 300, [], world => !world.move);
  assert(w.curse?.by === 'chain' && w.curse.kills === 0 && !chestOf(w) && seen.some(ev => ev.type === 'chest'), 'taken by the chain');
  assert(Math.abs(w.hero.x - chest.x) < 0.5 && Math.abs(w.hero.y - chest.y) < 0.5, 'the hero takes its spot');
  assert(replays(sim), 'replay');
});

check('a chain link: any colour, the chain goes on; the highlight equals the dash; no power, no embers, no colour change; kills after it count', () => {
  for (const k of [5, 6, 7]) {
    const p = quiet({ purse: true });
    // a (colour 2) → the chest → b (HP 1) → c, and the twin without the chest: the same enemy links.
    const sim = fight(p, k), w = sim.world, twin = fight(p, k), tw = twin.world;
    for (const s of [sim, twin]) s.command({ t: 'teleport', x: 5.9, y: 6.8 });
    const links = [place(sim, 7.2, 6.8, 2), place(sim, 8.8, 6.8, 2, 1), place(sim, 10.2, 6.8, 2)];
    const tlinks = [place(twin, 7.2, 6.8, 2), place(twin, 8.8, 6.8, 2, 1), place(twin, 10.2, 6.8, 2)];
    const other = place(sim, 9, 5.2, 3); place(twin, 9, 5.2, 3);
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    sim.command({ t: 'drag', x: CHEST.x, y: CHEST.y, mode: 'full' });
    // The chest keeps the colour: an enemy of another colour is refused after it.
    assert(w.chain.length === 2 && enemyRefusal(w, other) === 'color', `another colour after the chest: ${enemyRefusal(w, other)}`);
    for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    twin.command({ t: 'begin', x: tlinks[0].x, y: tlinks[0].y });
    for (const e of tlinks.slice(1)) twin.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    assert(chainLength(w) === 4 && w.chain[1].kind === 'object' && tw.chain.length === 3, `the chain: a, the chest, b, c (${JSON.stringify(w.chain)}; the twin ${JSON.stringify(tw.chain)})`);
    const plan = planChain(w), tplan = planChain(tw);
    assert(plan.links[1].outcome === null && plan.power === tplan.power && plan.kills === tplan.kills && same(plan.cheque, tplan.cheque), `the chest adds nothing: power ${plan.power}/${tplan.power}, cheque ${JSON.stringify(plan.cheque)}`);
    sim.command({ t: 'release' }); twin.command({ t: 'release' });
    const seen = ticks(sim, 600, [], world => !world.move), tseen = ticks(twin, 600, [], world => !world.move);
    const hitsOf = (events: WorldEvent[]) => events.flatMap(ev => ev.type === 'chainHit' ? [{ damage: ev.damage, killed: ev.killed }] : []);
    const planned = plan.links.flatMap(l => l.outcome ? [{ damage: l.outcome.damage, killed: l.outcome.killed }] : []);
    assert(same(hitsOf(seen), planned) && w.lastChain?.kills === plan.kills, `the dash did what the highlight showed: ${JSON.stringify(hitsOf(seen))} vs ${JSON.stringify(planned)}`);
    const cheque = seen.find(ev => ev.type === 'cheque'), tcheque = tseen.find(ev => ev.type === 'cheque');
    assert(cheque?.type === 'cheque' && tcheque?.type === 'cheque' && cheque.embers === tcheque.embers && cheque.heat === tcheque.heat && cheque.total === tcheque.total, 'the same cheque as without the chest');
    assert(w.curse?.by === 'chain' && w.curse.kills === plan.kills - 1 && plan.kills === 3, `kills after the chest count: ${w.curse?.kills} (of ${plan.kills})`);
    assert(replays(sim), 'replay');
  }
});

check('a dash flying over the chest without it in the chain does not take it; a jump onto it takes it when the hero stands', () => {
  const sim = fight(), w = sim.world;
  const e = place(sim, 10, 6, 0);
  sim.command({ t: 'begin', x: e.x, y: e.y });
  sim.command({ t: 'release' });
  ticks(sim, 300, [], world => !world.move);
  assert(!w.curse && chestOf(w), 'the dash over it: no curse');
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  sim.command({ t: 'energy', value: 7 });
  assert(sim.command({ t: 'jump', x: CHEST.x, y: CHEST.y }) !== false, 'a jump');
  let during = false;
  ticks(sim, 300, [], world => { if (world.move && world.curse) during = true; return !world.move; });
  assert(!during, 'not taken in the jump');
  ticks(sim, 2);
  assert(curseOf(w)?.by === 'touch', 'taken by touch on landing');
});

check('the curse: a touch +1 — normal 1 → 2, tough 2 → 3, armoured elite 2 → 3; the reaper 3 stays 3', () => {
  const cases: [string, number, boolean, number][] = [['basic', 0, false, 1], ['basic', 2, false, 2], ['basic', 0, true, 2], ['reaper', 0, false, 3]];
  for (const [kind, hp, elite, plain] of cases) {
    for (const k of [8, 9]) {
      const free = fight(quiet(), k), cursed = fight(quiet(), k);
      takeByTouch(cursed);
      free.command({ t: 'teleport', x: 12, y: 6 }); cursed.command({ t: 'teleport', x: 12, y: 6 });
      const a = touchHit(free, kind, hp, elite), b = touchHit(cursed, kind, hp, elite);
      const want = kind === 'reaper' ? plain : plain + 1;
      assert(a === plain && b === want, `${kind} hp ${hp}${elite ? ' elite' : ''}: ${a} → ${b} (want ${plain} → ${want})`);
      assert(replays(cursed), 'replay');
    }
  }
});

check('the curse does not touch arrows and quills: the same damage cursed or not', () => {
  for (const k of [10, 11]) {
    const out: number[][] = [];
    for (const curse of [false, true]) {
      const sim = fight(quiet({ porcupineDownTime: 0 }), k), w = sim.world;
      if (curse) takeByTouch(sim);
      sim.command({ t: 'teleport', x: 12, y: 6 });
      // An archer's point shot at the standing hero.
      const archer = place(sim, 17, 6, 2, 0, 'archer');
      const arrow = ticks(sim, 400, [], world => world.events.some(ev => ev.type === 'hit')).concat(w.events).find(ev => ev.type === 'hit');
      w.events.length = 0;
      assert(arrow?.type === 'hit' && arrow.source === 'arrow' && arrow.enemyId === archer.id, `seed ${k}: an arrow`);
      sim.command({ t: 'clear', keepMarked: false });
      ticks(sim, 180, [], world => world.hero.invulnerable <= 0);
      // A chain hit on a porcupine with its quills up.
      const pc = place(sim, w.hero.x + 1.2, w.hero.y, 1, 1, 'porcupine');
      sim.command({ t: 'begin', x: pc.x, y: pc.y });
      sim.command({ t: 'release' });
      const quill = ticks(sim, 300, [], world => !world.move).find(ev => ev.type === 'hit');
      assert(quill?.type === 'hit' && quill.source === 'quills', `seed ${k}: the quills`);
      out.push([arrow.damage, quill.damage]);
      assert(!curse || !!w.curse && w.curse.lifted === undefined, 'still cursed');
    }
    assert(same(out[0], out[1]) && out[0][0] === 1 && out[0][1] === 1, `arrows and quills: ${JSON.stringify(out)}`);
  }
});

check(`${CHEST_CURSE_KILLS} kills of the dash lift the curse (5 + 5 + 3); then the touch is plain again`, () => {
  for (const k of [12, 13]) {
    const sim = fight(quiet(), k), w = sim.world;
    takeByTouch(sim);
    sim.command({ t: 'teleport', x: 4, y: 3 });
    const seen: WorldEvent[] = [];
    chainOf(sim, 5, seen);
    assert(w.curse!.kills === 5 && w.curse!.lifted === undefined, `5: ${w.curse!.kills}`);
    sim.command({ t: 'teleport', x: 4, y: 3 });
    chainOf(sim, 5, seen);
    assert(curseOf(w)!.kills === 10 && curseOf(w)!.lifted === undefined, `10: ${curseOf(w)!.kills}`);
    sim.command({ t: 'teleport', x: 4, y: 3 });
    chainOf(sim, 3, seen);
    const lifted = seen.filter(ev => ev.type === 'curseLifted');
    assert(curseOf(w)!.kills === CHEST_CURSE_KILLS && curseOf(w)!.lifted !== undefined && lifted.length === 1, `lifted at 12: ${JSON.stringify(w.curse)}`);
    sim.command({ t: 'teleport', x: 12, y: 6 });
    assert(touchHit(sim, 'basic', 0) === 1, 'the touch is plain after the curse');
    assert(replays(sim), 'replay');
  }
});

check('a hammer\'s kills do not count: the end blast kills 2 more, the curse counts the 3 of the dash', () => {
  const sim = fight(quiet(), 14, 'chest-field', { hammer: 'end-blast' }), w = sim.world;
  takeByTouch(sim);
  sim.command({ t: 'teleport', x: 4, y: 3 });
  const h = w.hero;
  const links = [place(sim, h.x + 1.2, h.y + 1, 0), place(sim, h.x + 2.4, h.y + 1, 0), place(sim, h.x + 3.6, h.y + 1, 0)];
  const last = links[2];
  place(sim, last.x + 0.8, last.y + 0.4, 3); place(sim, last.x - 0.2, last.y + 0.9, 3);
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  sim.command({ t: 'release' });
  ticks(sim, 600, [], world => !world.move && world.enemies.length === 0);
  ticks(sim, 30);
  assert(w.stats.kills === 5 && w.enemies.length === 0, `the blast killed the two: kills ${w.stats.kills}`);
  assert(w.curse!.kills === 3, `the curse counts the dash only: ${w.curse!.kills}`);
  assert(replays(sim), 'replay');
});

check('a cursed fight on «Застава» with its enemies replays from its journal (hashes every 300 ticks), seeds differ', () => {
  const hashes = new Set<string>();
  for (const k of [1, 2, 3]) {
    const sim = new Simulation({ arena: 'outpost', params: rtRunParams(defaultParams()), seed: seedOf(k), record: true });
    const chest = chestOf(sim.world)!;
    sim.command({ t: 'teleport', x: chest.x - 1.2, y: chest.y });
    sim.command({ t: 'walk', x: 1, y: 0 });
    const marks: string[] = [];
    for (let t = 1; t <= 1800 && sim.world.status === 'playing'; t++) {
      sim.tick(); sim.world.events.length = 0;
      if (t === 30) sim.command({ t: 'walk', x: 0, y: 0 });
      if (t % 300 === 0) marks.push(sim.hash());
    }
    assert(sim.world.curse, `seed ${k}: cursed`);
    const got: string[] = [];
    const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)), r => { r.world.events.length = 0; if (r.world.tick % 300 === 0) got.push(r.hash()); });
    assert(again.hash() === sim.hash() && same(got, marks), `seed ${k}: the same hash and checkpoints`);
    hashes.add(sim.hash());
  }
  assert(hashes.size === 3, 'different seeds, different fights');
});

check('a journal without the key plays the old world: no chest, the same state', () => {
  for (const k of [1, 2]) {
    const params = { ...rtRunParams(defaultParams()), cursedChest: false };
    const sim = new Simulation({ arena: 'outpost', params, seed: seedOf(k), record: true });
    sim.command({ t: 'walk', x: 1, y: -1 });
    for (let t = 0; t < 900 && sim.world.status === 'playing'; t++) { sim.tick(); sim.world.events.length = 0; }
    const journal = JSON.parse(JSON.stringify(sim.exportJournal()!));
    delete journal.params.cursedChest;
    const old = replay(journal);
    const strip = (w: World) => { const s = worldState(w) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(old.world) === strip(sim.world) && !chestOf(old.world) && !old.world.curse, `seed ${k}: the old world`);
  }
});

// ---- Telemetry (design 12.10.2026): FightSummary.chest — taken, liftedAt, cursedDamage; read through the report's path ----

check('telemetry: a played fight (plain touch, chest, arrow, cursed touch, 12 dash kills, plain touch) — taken, liftedAt, damage under the curse by source', () => {
  const f = playChestFight(true), journal = JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal;
  const a = analyzeJournal(journal), c = a.summary.chest, w = a.world;
  assert(w.curse?.lifted !== undefined && a.hash === f.sim.hash(), 'the report path replays the fight to the same hash, the curse lifted');
  assert(c.taken === w.curse!.tick && c.liftedAt === w.curse!.lifted && c.taken! > 0 && c.liftedAt! > c.taken!, `taken ${c.taken}, lifted ${c.liftedAt}`);
  // What the player took, from the hits themselves (not from the summary): 1 plain touch, 1 arrow and 2 of a touch under the curse, 1 plain touch after.
  assert(same(f.hits.map(h => [h.source, h.damage, h.cursed]), [['touch', 1, false], ['arrow', 1, true], ['touch', 2, true], ['touch', 1, false]]), `hits ${JSON.stringify(f.hits)}`);
  assert(same(c.cursedDamage, { arrow: 1, touch: 2 }), `cursed damage ${JSON.stringify(c.cursedDamage)}`);
  assert(a.summary.damage.total === 5 && a.summary.damage.bySource.touch === 4, `all damage ${JSON.stringify(a.summary.damage.bySource)}`);
  // The live observer (the browser's) and the replay's agree on the chest.
  assert(same(f.summary.chest, c), `live ${JSON.stringify(f.summary.chest)} vs replay ${JSON.stringify(c)}`);
});

check('telemetry: the chest taken by a chain and never lifted — liftedAt null, every hit to the end of the fight counts', () => {
  for (const k of [20, 21]) {
    const sim = fight(quiet(), k, 'chest-field'), w = sim.world, seen: WorldEvent[] = [];
    /** An enemy placed on the hero hurts him for a second (every hit is read from the events); then the arena is cleared. */
    const hurt = (hp: number): void => {
      ticks(sim, 180, [], world => world.hero.invulnerable <= 0 && world.hero.chainShield <= 0);
      place(sim, w.hero.x + 0.3, w.hero.y, 1, hp);
      ticks(sim, 90, seen);
      sim.command({ t: 'clear', keepMarked: false });
    };
    const damageOf = (from: number): number => seen.slice(from).reduce((a, ev) => a + (ev.type === 'hit' ? ev.damage : 0), 0);
    sim.command({ t: 'param', key: 'contactDamage', value: 1 });
    hurt(0);
    const plain = damageOf(0);
    sim.command({ t: 'teleport', x: 5.9, y: 6 });
    assert(sim.command({ t: 'begin', x: CHEST.x, y: CHEST.y }) === true, 'a chain of just the chest');
    sim.command({ t: 'release' });
    ticks(sim, 300, [], world => !world.move);
    assert(w.curse?.by === 'chain', 'taken by the chain');
    sim.command({ t: 'teleport', x: 12, y: 6 });
    const mark = seen.length;
    hurt(0); hurt(2);
    const cursedHits = seen.slice(mark).filter(ev => ev.type === 'hit');
    assert(plain >= 1 && cursedHits.length >= 2 && cursedHits.every(ev => ev.type === 'hit' && ev.source === 'touch'), `touches before ${plain}, under the curse ${cursedHits.length}`);
    const a = analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal), c = a.summary.chest;
    assert(c.taken === w.curse!.tick && c.liftedAt === null, `seed ${k}: taken ${c.taken}, lifted ${c.liftedAt}`);
    const cursed = damageOf(mark);
    assert(same(c.cursedDamage, { touch: cursed }) && a.summary.damage.total === plain + cursed && cursed > cursedHits.length, `seed ${k}: ${JSON.stringify(c.cursedDamage)} of ${a.summary.damage.total} (touches before ${plain})`);
  }
});

check('telemetry: a fight where the chest stands and is not taken, a fight with the rule off — taken null, liftedAt null, no cursed damage', () => {
  const f = playChestFight(false), a = analyzeJournal(JSON.parse(JSON.stringify(f.sim.exportJournal()!)) as Journal);
  assert(a.world.objects.some(o => o.kind === 'chest') && !a.world.curse, 'the chest still stands');
  assert(same(a.summary.chest, { taken: null, liftedAt: null, cursedDamage: {} }) && a.summary.damage.total === 2, `${JSON.stringify(a.summary.chest)}, damage ${a.summary.damage.total}`);
  const off = new Simulation({ arena: 'outpost', params: { ...rtRunParams(defaultParams()), cursedChest: false }, seed: seedOf(1), record: true });
  for (let t = 0; t < 300; t++) { off.tick(); off.world.events.length = 0; }
  assert(same(analyzeJournal(JSON.parse(JSON.stringify(off.exportJournal()!)) as Journal).summary.chest, { taken: null, liftedAt: null, cursedDamage: {} }), 'rule off: nulls');
});

check('telemetry: a record written before the field has no chest — withSummaryDefaults reads it as «not taken»; a record with it keeps it', () => {
  const old = JSON.parse(JSON.stringify(emptyFightSummary())) as Record<string, unknown>;
  delete old.chest;
  assert(same(withSummaryDefaults(old).chest, { taken: null, liftedAt: null, cursedDamage: {} }) && !('chest' in old), 'defaults; the input is not changed');
  const had = withSummaryDefaults({ ...old, chest: { taken: 120, liftedAt: null, cursedDamage: { touch: 2 } } }).chest;
  assert(same(had, { taken: 120, liftedAt: null, cursedDamage: { touch: 2 } }), 'kept as it is');
});

console.log(`chest: ${checks} checks ok`);
