/**
 * Phase A of the real time, track D1 (docs/realtime-phase-a.md, sections 2–3): speed classes (T1) and the elites' affixes
 * (T4). Node only: `npm run test:realtime-affixes`.
 *
 * Every check plays the simulation through journalled commands (place, teleport, walk, begin, drag, release, chill, param)
 * and looks at what the player meets: how fast a kind walks, what an elite's HP is, where the fire trail lies and whom it
 * burns, when the chameleon turns and whether a chain of another colour takes it. Seeds are spread
 * (`Math.imul(k, 2654435761) >>> 0`); fights replay from their journals to the same hash.
 */
import { registerArena, type StartEnemy } from './arenas';
import { enemyRefusal } from './chain';
import { AFFIX_IDS, chameleonWarn, eliteAffixes, type AffixId } from './elites';
import { dist, type Vec } from './geometry';
import { hashWorld, worldState } from './hash';
import { defaultParams, runParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, WorldEvent } from './world';
import { createRtRun, rtArenaLoadout, rtEliteAffixes, rtMapNodes, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, nobody touches the hero, the hero cannot fall; `enemySpeed` explicit (default 0: all stand). */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  // The first group of the fight is rolled at once: the arena limit 1 keeps it waiting (placed enemies are over it).
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.heroHp = 40;
  p.hitstop = false;
  return Object.assign(p, extra);
}

registerArena({
  id: 'affix-open', name: 'Открытое поле', summary: 'Тест фазы A', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** One start elite of every kind a chain may take, far from the hero (the affixes of start elites are drawn). */
const ELITE_KINDS = ['basic', 'wolf', 'boar', 'shield', 'archer', 'sapper', 'porcupine', 'lynx', 'shaman'];
const FAST = ['wolf', 'lynx'], SLOW = ['shield', 'porcupine', 'shaman'];
registerArena({
  id: 'affix-elites', name: 'Элиты всех видов', summary: 'Тест фазы A', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 10.5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, killGoal: 999,
  enemies: ELITE_KINDS.map((kind, i): StartEnemy => ({ x: 2 + i * 2, y: 2, color: i % 4, hp: 1, kind, elite: true })),
});

/** A recorded fight; on the open field the first rolled group is cleared (only what the test places acts). */
function fight(arena: string, params: Params, k: number): Simulation {
  const sim = new Simulation({ arena, params, seed: seedOf(k), record: true });
  if (arena === 'affix-open') sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, at: Vec, kind: string, opts: { color?: number; hp?: number; elite?: boolean; affixes?: AffixId[] } = {}): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind, ...opts.elite ? { elite: true } : {}, ...opts.affixes ? { affixes: opts.affixes } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function run(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function replays(sim: Simulation): boolean {
  return replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
}
/** Units a placed enemy walks in `ticks` (straight at the hero on the open field). */
function walked(sim: Simulation, e: Enemy, ticks: number): number {
  const from = { x: e.x, y: e.y };
  run(sim, ticks);
  return dist(from, e);
}
const fireHits = (events: WorldEvent[]): Extract<WorldEvent, { type: 'hit' }>[] =>
  events.filter((ev): ev is Extract<WorldEvent, { type: 'hit' }> => ev.type === 'hit' && ev.source === 'fire-trail');

// ---------- T1: speed classes ----------

check('T1: a kind walks by its class — slow ×0.7 (shield, porcupine, shaman), normal ×1 (basic, archer, sapper, boar), fast ×1.4 (wolf, lynx) of the pace', () => {
  const want: Record<string, number> = { basic: 1.2, archer: 1.2, sapper: 1.2, boar: 1.2, shield: 0.84, porcupine: 0.84, shaman: 0.84, wolf: 1.68, lynx: 1.68 };
  for (const [kind, speed] of Object.entries(want)) {
    const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 1);
    const e = place(sim, { x: 1, y: 6 }, kind);
    const v = walked(sim, e, 30) / 0.5;
    assert(Math.abs(v - speed) < 0.01, `${kind}: ${v.toFixed(3)} u/s, want ${speed}`);
  }
});

check('T1: with the toggle off — the old speeds of the kinds (shield ×0.8, porcupine ×1, lynx ×1, the wolf 1.6 u/s whatever the pace)', () => {
  const want: Record<string, number> = { basic: 1.2, shield: 0.96, porcupine: 1.2, shaman: 0.84, wolf: 1.6, lynx: 1.2 };
  for (const [kind, speed] of Object.entries(want)) {
    const sim = fight('affix-open', quiet({ enemySpeed: 1.2, speedClasses: false }), 2);
    const e = place(sim, { x: 1, y: 6 }, kind);
    const v = walked(sim, e, 30) / 0.5;
    assert(Math.abs(v - speed) < 0.01, `${kind}: ${v.toFixed(3)} u/s, want ${speed}`);
  }
  const p = defaultParams(); p.speedClasses = false;
  assert(runParams(p).speedClasses === true, 'a run plays the classes');
});

check('T1: the wolf now grows with the anger tiers of the pace (×(1 + step) per tier), the old wolf did not', () => {
  const at = (classes: boolean): number => {
    const sim = fight('affix-open', quiet({ enemySpeed: 1.2, angerSpeedStep: 0.1, angerTierSeconds: 5, speedClasses: classes }), 3);
    run(sim, 305);
    const wolf = place(sim, { x: 1, y: 6 }, 'wolf');
    return walked(sim, wolf, 30) / 0.5;
  };
  const tiered = at(true), old = at(false);
  assert(Math.abs(tiered - 1.2 * 1.1 * 1.4) < 0.01 && Math.abs(old - 1.6) < 0.01, `tier 1: ${tiered.toFixed(3)} (classes), ${old.toFixed(3)} (old)`);
});

check('T1 acceptance: the fastest wolf (fast class × the spread +0.35) walks at most 3.0 u/s — 25% under the hero (4)', () => {
  const p = defaultParams();
  const bound = p.enemySpeed * p.speedFast * (1 + p.speedSpread);
  let fastest = 0;
  for (let k = 1; k <= 60; k++) {
    const sim = fight('affix-open', quiet({ enemySpeed: p.enemySpeed, speedSpread: p.speedSpread }), 100 + k);
    const wolf = place(sim, { x: 1, y: 6 }, 'wolf');
    fastest = Math.max(fastest, walked(sim, wolf, 30) / 0.5);
  }
  assert(p.angerSpeedStep === 0, 'the pace does not grow with anger by default');
  assert(fastest <= bound + 1e-6 && bound <= 0.75 * p.heroSpeed, `fastest ${fastest.toFixed(3)}, bound ${bound.toFixed(3)}, hero ${p.heroSpeed}`);
  console.log(`   fastest wolf of 60 seeds ${fastest.toFixed(3)} u/s; bound ${bound.toFixed(3)} = ${(100 * (1 - bound / p.heroSpeed)).toFixed(0)}% under the hero`);
});

check('T1: a journal without `speedClasses` replays with the old formulas (the shield at ×0.8, the wolf at 1.6)', () => {
  const sim = fight('affix-open', quiet({ enemySpeed: 1.2, speedClasses: false }), 4);
  const shield = place(sim, { x: 1, y: 4 }, 'shield'), wolf = place(sim, { x: 1, y: 8 }, 'wolf');
  run(sim, 30);
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!));
  delete journal.params.speedClasses; delete journal.params.speedSlow; delete journal.params.speedFast;
  const again = replay(journal), w2 = again.world;
  const s2 = w2.enemies.find(e => e.id === shield.id)!, f2 = w2.enemies.find(e => e.id === wolf.id)!;
  assert(Math.abs(s2.x - shield.x) < 1e-12 && Math.abs(f2.x - wolf.x) < 1e-12, `replayed: shield ${s2.x} vs ${shield.x}, wolf ${f2.x} vs ${wolf.x}`);
  assert(Math.abs(walked(again, f2, 30) / 0.5 - 1.6) < 0.01, 'the wolf of the old journal walks 1.6');
});

// ---------- T4: affixes ----------

check('T4: HP — «Огненный» and «Хамелеон» ×2, «Стремительный» ×1, «Толстый» ×3; a weak one 1 («Толстый» 2); `place {elite}` without affixes is the slice\'s elite', () => {
  const sim = fight('affix-open', quiet(), 10);
  const hpOf = (hp: number, affixes?: AffixId[]): number => place(sim, { x: 2, y: 2 }, 'basic', { hp, elite: true, affixes }).hp;
  assert(hpOf(2) === 4 && hpOf(2, ['fiery']) === 4 && hpOf(2, ['chameleon']) === 4 && hpOf(2, ['swift']) === 2 && hpOf(2, ['fat']) === 6, 'tough');
  assert(hpOf(0) === 1 && hpOf(0, ['fiery']) === 1 && hpOf(0, ['swift']) === 1 && hpOf(0, ['fat']) === 2, 'weak');
  const plain = place(sim, { x: 3, y: 2 }, 'basic', { hp: 1, elite: true });
  assert(plain.affixes === undefined && eliteAffixes(plain).length === 0 && plain.hp === 2, 'the plain elite');
  assert(!sim.world.rng.states().some(([name]) => name === 'affix'), 'no affix stream drawn without affixes');
  // A named pair that cannot be: «Стремительный» wins (canonical order), «Толстый» dropped; «Стремительный» never on a wolf.
  assert(eliteAffixes(place(sim, { x: 4, y: 2 }, 'basic', { elite: true, affixes: ['fat', 'swift'] })).join() === 'swift', 'swift + fat');
  assert(eliteAffixes(place(sim, { x: 5, y: 2 }, 'wolf', { hp: 1, elite: true, affixes: ['swift'] })).length === 0, 'no swift wolf');
  assert(eliteAffixes(place(sim, { x: 6, y: 2 }, 'shield', { hp: 1, elite: true, affixes: ['fat'] })).length === 0, 'no fat shield');
});

check('T4: «Стремительный» walks ×1.4 over its class, «Толстый» ×0.7', () => {
  for (const [affix, speed] of [['swift', 1.68], ['fat', 0.84]] as const) {
    const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 11);
    const e = place(sim, { x: 1, y: 6 }, 'basic', { hp: 1, elite: true, affixes: [affix] });
    const v = walked(sim, e, 30) / 0.5;
    assert(Math.abs(v - speed) < 0.01, `${affix}: ${v.toFixed(3)}`);
  }
});

check('T4: drawn affixes — as many as the count; «Стремительный» never on the wolf or the lynx, «Толстый» never on a slow kind, never both', () => {
  const seen = new Map<string, Set<AffixId>>();
  for (const count of [1, 2, 3]) {
    for (let k = 1; k <= 40; k++) {
      const sim = fight('affix-elites', quiet({ eliteAffixes: count }), 200 + k), w = sim.world;
      assert(w.enemies.length === ELITE_KINDS.length, 'all start elites');
      for (const e of w.enemies) {
        const ids = eliteAffixes(e);
        assert(ids.length === count, `${e.kind}: ${ids.length} affixes, want ${count}`);
        assert(!(FAST.includes(e.kind) && ids.includes('swift')), `${e.kind}: swift`);
        assert(!(SLOW.includes(e.kind) && ids.includes('fat')), `${e.kind}: fat`);
        assert(!(ids.includes('swift') && ids.includes('fat')), `${e.kind}: swift and fat together`);
        for (const id of ids) (seen.get(e.kind) ?? seen.set(e.kind, new Set()).get(e.kind)!).add(id);
      }
    }
  }
  for (const kind of ELITE_KINDS) {
    const allowed = AFFIX_IDS.filter(id => !(FAST.includes(kind) && id === 'swift') && !(SLOW.includes(kind) && id === 'fat'));
    assert(allowed.every(id => seen.get(kind)!.has(id)), `${kind}: seen ${[...seen.get(kind)!].join()}`);
  }
  // The sandbox default (0): no affixes, the stream untouched — and the same fight as without the value.
  const plain = fight('affix-elites', quiet(), 201), old = quiet() as Partial<Params>;
  delete old.eliteAffixes;
  const before = fight('affix-elites', old as Params, 201);
  assert(plain.world.enemies.every(e => !e.affixes) && hashWorld(plain.world).length === 16, 'no affixes at 0');
  assert(JSON.stringify(plain.world.enemies) === JSON.stringify(before.world.enemies), 'the same elites as a journal without the value');
});

check('T4: the run row decides the count — rows 1–4: 0, 5–8: 1, 9: 2 (the loadout of the node\'s arena, and its start elites)', () => {
  const base = createRtRun(seedOf(300)), nodes = rtMapNodes(base);
  const rows = new Set<number>();
  for (const node of nodes) {
    const row = runRow(node.row);
    if (row < 1 || row > 9 || rows.has(row)) continue;
    rows.add(row);
    const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'affix-elites', seed: seedOf(row), battle: 'battle' } };
    const loadout = rtArenaLoadout(run), want = row >= 9 ? 2 : row >= 5 ? 1 : 0;
    assert((loadout.eliteAffixes ?? 0) === want && rtEliteAffixes(row) === want, `row ${row}: loadout ${loadout.eliteAffixes}`);
    const sim = new Simulation({ arena: 'affix-elites', params: runParams(defaultParams()), seed: seedOf(row), loadout });
    assert(sim.world.enemies.every(e => eliteAffixes(e).length === want), `row ${row}: start elites ${sim.world.enemies.map(e => eliteAffixes(e).length)}`);
    // Rows 1–4: the kit has no such field — the arena hashes as before phase A.
    assert((sim.world.kit!.eliteAffixes === undefined) === (want === 0), `row ${row}: kit field`);
  }
  assert([1, 2, 3, 4, 5, 6, 7, 8, 9].every(row => rows.has(row)), `rows seen ${[...rows].sort().join()}`);
});

check('T4 «Огненный»: a trail point every 0.4 of its path, radius 0.4, burning 3 s; the hero walking in loses 1 at once (no elite bonus), then 1 a second; out of it — nothing', () => {
  const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 20), w = sim.world;
  const fiery = place(sim, { x: 2, y: 6 }, 'basic', { hp: 1, elite: true, affixes: ['fiery'] });
  sim.command({ t: 'teleport', x: 18, y: 6 });
  run(sim, 120);
  const pts = w.trails;
  assert(pts.length === 6 && pts.every(t => t.ownerId === fiery.id), `after 2 s (2.4 walked): ${pts.length} points`);
  for (let i = 1; i < pts.length; i++) assert(Math.abs(dist(pts[i], pts[i - 1]) - 0.4) < 0.03, `spacing ${dist(pts[i], pts[i - 1]).toFixed(3)}`);
  // It stands now (the pace 0): no new points; the hero steps onto the youngest one.
  sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
  // The third youngest point: about 2.3 s of it left, and the hero stands clear of the elite's body (no pushing).
  const young = pts[pts.length - 3];
  sim.command({ t: 'teleport', x: young.x, y: young.y + 0.2 });
  const events = run(sim, 150);
  const burns = fireHits(events);
  assert(burns.length === 3 && burns.every(b => b.damage === 1 && b.enemyId === fiery.id), `burns ${JSON.stringify(burns.map(b => b.damage))}`);
  assert(w.hero.hp === 37, `hp ${w.hero.hp}`);
  // Out of the trail: no burn; and 3 s after it was dropped the trail is gone (and leaves the hash).
  sim.command({ t: 'teleport', x: 18, y: 2 });
  const later = run(sim, 60);
  assert(fireHits(later).length === 0 && w.hero.flames === undefined, 'no burn out of the trail');
  run(sim, 60);
  assert(w.trails.length === 0 && !('trails' in (worldState(w) as object)), `trail gone: ${w.trails.length}`);
  assert(replays(sim), 'replay');
});

check('T4 «Огненный»: enemies in the trail lose 1, then 1 a second later, never below 0 — no kill, no credit; a weak one is untouched', () => {
  const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 21), w = sim.world;
  place(sim, { x: 2, y: 6 }, 'basic', { hp: 1, elite: true, affixes: ['fiery'] });
  sim.command({ t: 'teleport', x: 18, y: 6 });
  run(sim, 100);
  sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
  const spot = w.trails[w.trails.length - 2];
  // HP 2: burnt at once and a second later down to 0; the third second finds it at 0 — no burn, no death.
  const tough = place(sim, { x: spot.x, y: spot.y - 0.1 }, 'basic', { hp: 2 });
  const weak = place(sim, { x: w.trails[w.trails.length - 4].x, y: spot.y + 0.1 }, 'basic', { hp: 0 });
  const events = run(sim, 150);
  const struck = events.filter((ev): ev is Extract<WorldEvent, { type: 'enemyHit' }> => ev.type === 'enemyHit' && ev.source === 'fire-trail');
  assert(struck.length === 2 && struck.every(ev => ev.enemyId === tough.id && ev.damage === 1 && !ev.killed), `struck ${JSON.stringify(struck.map(ev => [ev.enemyId, ev.damage]))}`);
  assert(tough.hp === 0 && w.enemies.includes(tough) && w.enemies.includes(weak) && weak.hp === 0, `tough ${tough.hp}, both alive`);
  assert(!events.some(ev => ev.type === 'kill') && w.stats.kills === 0 && w.stats.score === 0, 'no kill, no credit');
  assert(replays(sim), 'replay');
});

check('T4 «Огненный»: a dash ending in the trail gives the hero a full second to walk out (as thorns)', () => {
  const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 22), w = sim.world;
  place(sim, { x: 2, y: 6 }, 'basic', { hp: 1, elite: true, affixes: ['fiery'] });
  sim.command({ t: 'teleport', x: 18, y: 6 });
  run(sim, 120);
  sim.command({ t: 'param', key: 'enemySpeed', value: 0 });
  const spot = w.trails[w.trails.length - 1];
  const target = place(sim, { x: spot.x, y: spot.y + 0.1 }, 'basic', { hp: 0, color: 2 });
  sim.command({ t: 'teleport', x: spot.x, y: spot.y + 1.6 });
  assert(sim.command({ t: 'begin', x: target.x, y: target.y }) === true, 'a link');
  sim.command({ t: 'release' });
  // No burn during the dash; it lands on the killed link, in the trail.
  let landed = -1, firstBurn = -1;
  for (let i = 0; i < 150 && firstBurn < 0; i++) {
    sim.tick();
    if (landed < 0 && !w.move) landed = w.tick;
    if (w.events.some(ev => ev.type === 'hit' && ev.source === 'fire-trail')) firstBurn = w.tick;
    w.events.length = 0;
  }
  assert(landed > 0 && firstBurn > landed && !w.enemies.includes(target), `landed at ${landed}, first burn at ${firstBurn}`);
  assert(Math.abs((firstBurn - landed) / 60 - 1) < 0.03, `first burn ${((firstBurn - landed) / 60).toFixed(2)} s after the landing`);
  assert(replays(sim), 'replay');
});

check('T4 «Хамелеон»: turns to the next colour every 4 s by itself (3 → 0 → 1), the timer stands while it is frozen or a link', () => {
  const sim = fight('affix-open', quiet(), 30);
  const ch = place(sim, { x: 12, y: 6 }, 'basic', { hp: 1, color: 3, elite: true, affixes: ['chameleon'] });
  // A function: a colour narrowed by an assertion stays readable after more ticks.
  const colour = (): number => ch.color;
  run(sim, 239);
  assert(colour() === 3, 'still 3 before 4 s');
  run(sim, 1);
  assert(colour() === 0, `0 at 4 s: ${colour()}`);
  run(sim, 240);
  assert(colour() === 1, `1 at 8 s: ${colour()}`);
  // Frozen 2 s at once: the next turn comes 2 s late.
  sim.command({ t: 'chill', id: ch.id, seconds: 2 });
  run(sim, 359);
  assert(colour() === 1, 'frozen: no turn at 12 s');
  run(sim, 2);
  assert(colour() === 2, `turned 2 s late: ${colour()}`);
  // A link of the drawn chain: the timer stands while the chain is held.
  run(sim, 60);
  const left = ch.chameleon!;
  assert(sim.command({ t: 'begin', x: ch.x, y: ch.y }) === true, 'the chameleon starts a chain');
  run(sim, 90);
  assert(ch.chameleon === left && colour() === 2, `held: ${ch.chameleon} vs ${left}`);
  sim.command({ t: 'cancel' });
  assert(replays(sim), 'replay');
});

check('T4 «Хамелеон» acceptance: a chain of another colour takes it only in the 0.6 s window, and it takes the chain\'s colour; replays to the same hash', () => {
  const sim = fight('affix-open', quiet(), 31), w = sim.world;
  const basic = place(sim, { x: 11, y: 6 }, 'basic', { color: 0 });
  const ch = place(sim, { x: 12.2, y: 6 }, 'basic', { hp: 2, color: 1, elite: true, affixes: ['chameleon'] });
  // Functions: values narrowed by an assertion stay readable after more commands.
  const colour = (): number => ch.color, links = (): number => w.chain.length;
  // Out of the window (3.4 s of 4 left … 0.6 s): the chain of colour 0 cannot take it.
  run(sim, 150);
  assert(chameleonWarn(w, ch) === null, 'no window at 1.5 s');
  assert(sim.command({ t: 'begin', x: basic.x, y: basic.y }) === true, 'chain of colour 0');
  sim.command({ t: 'drag', x: ch.x, y: ch.y, mode: 'full' });
  assert(links() === 1 && enemyRefusal(w, ch) === 'color' && colour() === 1, `out of the window: ${links()}, ${enemyRefusal(w, ch)}`);
  sim.command({ t: 'cancel' });
  // Just before the window (0.62 s left): still refused.
  run(sim, 4 * 60 - 150 - 38);
  assert(chameleonWarn(w, ch) === null && ch.chameleon! > 0.6, `0.62 s left: ${ch.chameleon}`);
  sim.command({ t: 'begin', x: basic.x, y: basic.y });
  sim.command({ t: 'drag', x: ch.x, y: ch.y, mode: 'full' });
  assert(links() === 1 && colour() === 1, 'refused 0.62 s before the turn');
  sim.command({ t: 'cancel' });
  // In the window: the rim shows the next colour; the chain of colour 0 takes it, and it is colour 0 now.
  run(sim, 4);
  const warn = chameleonWarn(w, ch);
  assert(warn !== null && warn.next === 2 && warn.left <= 0.6 && warn.left > 0.5, `window: ${JSON.stringify(warn)}`);
  sim.command({ t: 'begin', x: basic.x, y: basic.y });
  sim.command({ t: 'drag', x: ch.x, y: ch.y, mode: 'full' });
  assert(links() === 2 && colour() === 0, `taken in the window: ${links()}, colour ${colour()}`);
  sim.command({ t: 'release' });
  run(sim, 60);
  // The basic died (power 1), the chameleon (HP 4) survived, colour 0; its period starts again from the taking.
  assert(!w.enemies.includes(basic) && w.enemies.includes(ch) && colour() === 0 && ch.chameleon! > 2.9, `after the dash: colour ${colour()}, ${ch.chameleon}`);
  assert(replays(sim), 'the journal replays to the same hash');
});

check('T4: the affixes live outside `vars` — the wolves\' ring keeps a wolf elite\'s affixes; elites of a fight replay with their affixes', () => {
  const sim = fight('affix-open', quiet({ enemySpeed: 1.2 }), 40), w = sim.world;
  const wolf = place(sim, { x: 4, y: 6 }, 'wolf', { hp: 1, elite: true, affixes: ['fiery', 'chameleon'] });
  run(sim, 600);
  assert(eliteAffixes(wolf).join() === 'fiery,chameleon' && w.enemies.includes(wolf), `affixes ${eliteAffixes(wolf).join()}`);
  assert(replays(sim), 'replay');
});

console.log(`realtime-affixes: ${checks} checks passed`);
