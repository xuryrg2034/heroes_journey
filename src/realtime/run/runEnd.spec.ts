/**
 * П6 «Незакрытое дело» (run/rtRunEnd.ts; docs/realtime-slice.md, section 9; docs/realtime-engagement-research.md, П6). Node
 * only: `npm run test:realtime-run-end`.
 *
 * Run fights are real fights (journalled commands on the quiet test field with the run's params and loadout, runFight.testkit.ts);
 * the killing blow is read from every tick's events as main.ts reads them every frame (`RtDeathWatch`), the outcome goes
 * into the run by its commands (`resolveArena`), the end screen's lines are read from the run (`rtRunEndLines`). Other fights
 * of a walk are won by the run's command with a plain outcome. Expected texts are written by hand.
 * - the killer: an elite's touch (its kind, the elite mark, armour, affixes), a plain enemy's touch, an archer's arrow, a
 *   sapper's blast (the sapper dies in its own blast before it hits: the watch knows it from before the tick);
 * - the lines in their order: defeat — killer, row and rows left, Jailer, peak; victory — the final row and the peak only;
 * - the save: version 7, the optional field on the lost record; a reload keeps the lines; a save written before it (fixture)
 *   loads unchanged and, lost, shows no killer line; malformed deaths are no run; a won fight keeps no death.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtNode, rtRunParams, serializeRtRun, type RtArenaOutcome, type RtRunState } from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { RT_DEATH_ABILITY, RT_DEATH_TOUCH, RT_KIND_TITLES, RtDeathWatch, rtDeathLine, rtRunEndLines } from './rtRunEnd';
import { enemyKind, registeredEnemyKinds } from '../sim/enemies/kinds';
import { runRow } from './arenaPools';
import { assert, closeNode, ok, outcomeOf, playFight, pullBare, quiet, same, seedOf, summonGoblin, takeGift, ticks, toBattle } from './runFight.testkit';
import { inThorns } from '../sim/geometry';
import { defaultParams } from '../sim/params';
import { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import saveBefore from '../../../tests/fixtures/rt-run-save-before-record.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

// Task 48: without the Troll — the den's final is «Последний рубеж» here; the Troll's lines are in trollRun.spec.
const newRun = (k: number): RtRunState => toBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini', garrison: false, troll: false })));
const rowOf = (run: RtRunState): number => { const p = run.pending; assert(p?.kind === 'battle', 'an open battle'); return runRow(rtNode(run, p.nodeId)!.row); };
const lines = (run: RtRunState): string[] => rtRunEndLines(run).map(line => line.text);
/** The open battle won by the run's command with a plain outcome (no chain recorded). */
const winPlain = (run: RtRunState): RtRunState => {
  const p = run.pending;
  assert(p?.kind === 'battle', 'an open battle');
  return ok(resolveArena(run, { nodeId: p.nodeId, won: true, hp: run.hp, kills: 0, damage: 0, time: 1 }), 'win');
};
/** Walks on (plain wins, screens closed) until the open battle stands on run row `row` or later. */
const walkTo = (run: RtRunState, row: number): RtRunState => {
  for (let step = 0; step < 60 && rowOf(run) < row; step++) run = toBattle(closeNode(winPlain(run)));
  assert(rowOf(run) >= row, `reached row ${row}`);
  return run;
};

/** The touching enemies' default numbers back on (the quiet field has them off). */
const touchOn = (sim: Simulation): void => {
  sim.command({ t: 'param', key: 'contactDamage', value: defaultParams().contactDamage });
  sim.command({ t: 'param', key: 'enemySpeed', value: defaultParams().enemySpeed });
};
/** Places an enemy touching the standing hero and ticks until the fight ends. */
const touchedBy = (kind: string, elite: boolean, affixes: string[] = []) => (sim: Simulation, seen: (w: World) => void): void => {
  touchOn(sim);
  const hero = sim.world.hero;
  sim.command({ t: 'place', x: hero.x + 0.6, y: hero.y, color: 0, hp: 2, kind, ...elite ? { elite: true, affixes } : {} });
  ticks(sim, 60 * 120, seen);
};

check('the killer of an elite\'s touch: its kind, «-элита» (the basic enemy\'s elite — «элита»), armour and affixes; a plain enemy\'s touch — «враг»', () => {
  const cases: { kind: string; affixes: string[]; elite: boolean; death: object; text: string }[] = [
    // The shield-bearer is slow: «Толстый» is not its affix (sim/elites.ts `affixAllowed`).
    { kind: 'shield', elite: true, affixes: ['swift'], death: { source: 'touch', enemy: 'shield', elite: true, armor: true, affixes: ['swift'] }, text: 'Сразил: щитоносец-элита (броня, стремительный)' },
    { kind: 'wolf', elite: true, affixes: [], death: { source: 'wolf', enemy: 'wolf', elite: true, armor: true }, text: 'Сразил: волк-элита (броня)' },
    { kind: 'basic', elite: true, affixes: ['fat', 'chameleon'], death: { source: 'touch', enemy: 'basic', elite: true, armor: true, affixes: ['chameleon', 'fat'] }, text: 'Сразил: элита (броня, хамелеон, толстый)' },
    { kind: 'basic', elite: true, affixes: ['fiery'], death: { source: 'touch', enemy: 'basic', elite: true, armor: true, affixes: ['fiery'] }, text: 'Сразил: элита (броня, огненный)' },
    { kind: 'basic', elite: false, affixes: [], death: { source: 'touch', enemy: 'basic' }, text: 'Сразил: враг' },
  ];
  cases.forEach((c, i) => {
    const run = newRun(1 + i);
    const { outcome, sim } = playFight(run, { chains: [], k: i + 1, finish: touchedBy(c.kind, c.elite, c.affixes) });
    assert(sim.world.status === 'defeat', `${c.kind}: the hero fell`);
    assert(same(outcome.death, c.death), `${c.kind}: ${JSON.stringify(outcome.death)}`);
    const after = ok(resolveArena(run, outcome), 'lost');
    assert(after.result?.outcome === 'defeat' && same(after.battles[after.battles.length - 1].death, c.death), 'the lost record keeps it');
    assert(lines(after)[0] === c.text, `${c.kind}: ${lines(after)[0]}`);
  });
});

check('task 40: the killer of a garrison touch — «стражник», «псарь», «пёс», «ключник», «Кастелян»; a hound in its frenzy — «пёс» too (a real death)', () => {
  const cases: { kind: string; text: string }[] = [
    { kind: 'guard', text: 'Сразил: стражник' }, { kind: 'hound', text: 'Сразил: пёс' }, { kind: 'keymaster', text: 'Сразил: ключник' }, { kind: 'castellan', text: 'Сразил: Кастелян' },
  ];
  cases.forEach((c, i) => {
    const run = newRun(21 + i);
    // The hero keeps at the body (the keymaster backs off to 4–5 from him): a teleport next to it every half second.
    const { outcome, sim } = playFight(run, { chains: [], k: 21 + i, finish: (fight, seen) => {
      touchOn(fight);
      const hero = fight.world.hero;
      const id = fight.command({ t: 'place', x: hero.x + 0.45, y: hero.y, color: 0, hp: 2, kind: c.kind }) as number;
      for (let n = 0; n < 240 && fight.world.status === 'playing'; n++) {
        const e = fight.world.enemies.find(x => x.id === id)!;
        fight.command({ t: 'teleport', x: e.x - 0.45, y: e.y });
        ticks(fight, 30, seen);
      }
    } });
    assert(sim.world.status === 'defeat', `${c.kind}: the hero fell`);
    assert(same(outcome.death, { source: c.kind, enemy: c.kind }), `${c.kind}: ${JSON.stringify(outcome.death)}`);
    const after = ok(resolveArena(run, outcome), 'lost');
    assert(lines(after)[0] === c.text, `${c.kind}: ${lines(after)[0]}`);
    assert(serializeRtRun(parseRtRun(serializeRtRun(after))!) === serializeRtRun(after), `${c.kind}: the save with the death reads back`);
  });
  // The dog handler at the hero; its hounds held by the cold (a frozen body does not touch): only the handler's touch kills.
  const handlerRun = newRun(26);
  const byHandler = playFight(handlerRun, { chains: [], k: 26, finish: (sim, seen) => {
    touchOn(sim);
    const hero = sim.world.hero;
    const id = sim.command({ t: 'place', x: hero.x + 0.45, y: hero.y, color: 0, hp: 1, kind: 'handler' }) as number;
    ticks(sim, 1, seen);
    for (const hound of sim.world.enemies.filter(e => e.kind === 'hound')) sim.command({ t: 'chill', id: hound.id, seconds: 600 });
    for (let n = 0; n < 240 && sim.world.status === 'playing'; n++) {
      const e = sim.world.enemies.find(x => x.id === id)!;
      sim.command({ t: 'teleport', x: e.x - 0.45, y: e.y });
      ticks(sim, 30, seen);
    }
  } });
  assert(same(byHandler.outcome.death, { source: 'handler', enemy: 'handler' }), `the handler: ${JSON.stringify(byHandler.outcome.death)}`);
  assert(lines(ok(resolveArena(handlerRun, byHandler.outcome), 'lost'))[0] === 'Сразил: псарь', 'the line of the handler');
  // A hound in its frenzy: the dog handler dies by a bomb, its hounds run mad and the nearest body is the hero.
  const mad = newRun(27);
  let frenzied = false;
  const byMad = playFight(mad, { chains: [], k: 27, finish: (sim, seen) => {
    const hero = sim.world.hero;
    sim.command({ t: 'param', key: 'houndFrenzy', value: 60 });
    const handler = sim.command({ t: 'place', x: hero.x + 3, y: hero.y, color: 0, hp: 1, kind: 'handler' }) as number;
    ticks(sim, 2, seen);
    assert(sim.world.enemies.filter(e => e.kind === 'hound').length === 2, 'two hounds at the handler');
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    const h = sim.world.enemies.find(e => e.id === handler)!;
    sim.command({ t: 'item', kind: 'bomb', x: h.x, y: h.y });
    touchOn(sim);
    ticks(sim, 60 * 120, w => { seen(w); if (w.events.some(ev => ev.type === 'hit' && ev.source === 'hound' && (w.enemies.find(e => e.id === ev.enemyId)?.vars.fz ?? 0) > 0)) frenzied = true; });
  } });
  assert(frenzied && byMad.sim.world.status === 'defeat', 'a frenzied hound hit the hero, the hero fell');
  assert(same(byMad.outcome.death, { source: 'hound', enemy: 'hound' }), JSON.stringify(byMad.outcome.death));
  assert(lines(ok(resolveArena(mad, byMad.outcome), 'lost'))[0] === 'Сразил: пёс', 'the frenzied hound is «пёс»');
});

check('task 57б: the killer of a forest mechanic\'s touch — «корневик», «слизень», «головешка» (a put-out one: no trail to burn first; a real death)', () => {
  const cases: { kind: string; text: string; douse?: true }[] = [
    { kind: 'rootling', text: 'Сразил: корневик' }, { kind: 'slime', text: 'Сразил: слизень' }, { kind: 'firebrand', text: 'Сразил: головешка', douse: true },
  ];
  cases.forEach((c, i) => {
    const run = newRun(31 + i);
    const { outcome, sim } = playFight(run, { chains: [], k: 31 + i, finish: (fight, seen) => {
      const hero = fight.world.hero;
      const id = fight.command({ t: 'place', x: hero.x + 3, y: hero.y, color: 0, hp: 0, kind: c.kind }) as number;
      if (c.douse) {
        // A bomb puts the burning one out (a survivor); with no brazier it walks to the hero, unlit — its touch, not its trail.
        fight.command({ t: 'items', kind: 'bomb', count: 1 });
        const e = fight.world.enemies.find(x => x.id === id)!;
        fight.command({ t: 'item', kind: 'bomb', x: e.x, y: e.y });
        ticks(fight, 1, seen);
      }
      touchOn(fight);
      for (let n = 0; n < 240 && fight.world.status === 'playing'; n++) {
        const e = fight.world.enemies.find(x => x.id === id)!;
        fight.command({ t: 'teleport', x: e.x - 0.45, y: e.y });
        ticks(fight, 30, seen);
      }
    } });
    assert(sim.world.status === 'defeat', `${c.kind}: the hero fell`);
    assert(same(outcome.death, { source: c.kind, enemy: c.kind }), `${c.kind}: ${JSON.stringify(outcome.death)}`);
    assert(lines(ok(resolveArena(run, outcome), 'lost'))[0] === c.text, `${c.kind}: ${lines(ok(resolveArena(run, outcome), 'lost'))[0]}`);
  });
});

check('every enemy kind whose touch hurts has a killer line: its hit source is an ability, or a touch with the kind\'s name (a new kind without one fails here)', () => {
  const sim = new Simulation({ arena: 'kills', params: defaultParams(), seed: seedOf(1) }), world = sim.world;
  /** The kind's touch on a body of it placed on the field (`touchDamage` may read the body). */
  const touches = (kind: string): boolean => {
    sim.command({ t: 'clear', keepMarked: false });
    const id = sim.command({ t: 'place', x: 8, y: 5, color: 0, hp: 1, kind }) as number;
    const e = world.enemies.find(x => x.id === id)!;
    return enemyKind(kind).touchDamage(world, e) > 0;
  };
  // Design 22.10.2026: every body whose touch hurts has its line — no exceptions (the Warlock, the Chief and his parts and the
  // Castellan's crossbow on its stand were the last ones without it).
  const touching = registeredEnemyKinds().filter(k => touches(k.id));
  const missing = touching
    .filter(k => !Object.hasOwn(RT_DEATH_ABILITY, k.hitSource) && !(RT_DEATH_TOUCH.includes(k.hitSource) && Object.hasOwn(RT_KIND_TITLES, k.id)))
    .map(k => `${k.id} (${k.hitSource})`);
  assert(!missing.length, `no killer line for: ${missing.join(', ')}`);
  assert(['warlock', 'chief', 'chief-ladle', 'chief-sack', 'castellan-crossbow', 'rootling', 'slime', 'firebrand'].every(id => touching.some(k => k.id === id)), 'the guard sees the touching bodies');
  // The lines themselves (a touch death saved by the run: its source and kind).
  const lineOf = (id: string): string | null => rtDeathLine({ source: enemyKind(id).hitSource, enemy: id });
  const expected: Record<string, string> = { warlock: 'Колдун', chief: 'Главарь', 'chief-ladle': 'половник Главаря', 'chief-sack': 'мешок Главаря', 'castellan-crossbow': 'арбалет Кастеляна' };
  for (const [id, name] of Object.entries(expected)) assert(lineOf(id) === `Сразил: ${name}`, `${id}: ${lineOf(id)}`);
  // The moves without a striker kind in the line (22.10.2026): the Chief's ladle and pepper, the omen «Гроза».
  const moves: Record<string, string> = { 'chief-ladle': 'взмах половником Главаря', 'chief-pepper': 'горсть перца Главаря', storm: 'удар грозы' };
  for (const [source, text] of Object.entries(moves)) assert(rtDeathLine({ source }) === `Сразил: ${text}`, `${source}: ${rtDeathLine({ source })}`);
});

check('task 40: a death by the Castellan\'s «Спустить пса» — «Сразил: рывок пса Кастеляна» (a real fight on «Двор кастеляна»)', () => {
  const run = newRun(28), pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  const watch = new RtDeathWatch();
  // The quiet values (nothing comes, nobody walks or touches): only the lunges hurt; the arena turns the boss frame on itself.
  // Task 43: the run plays the full Castellan — his crossbow on the stand kept silent (its windup never ends): only the lunges.
  const sim = new Simulation({ arena: 'g-castellan', params: { ...rtRunParams(quiet()), crossbowWindup: 1e6 }, seed: seedOf(28), hero: { hp: run.hp, maxHp: run.maxHp }, loadout: rtArenaLoadout(run), beforeTick: w => watch.seen(w) });
  sim.tick(); watch.read(sim.world, sim.world.events); sim.world.events.length = 0;
  const hound = sim.world.enemies.find(e => e.kind === 'hound')!;
  sim.command({ t: 'teleport', x: hound.x, y: hound.y + 2.5 });
  const sources = new Set<string>();
  ticks(sim, 60 * 300, w => { watch.read(w, w.events); for (const ev of w.events) if (ev.type === 'hit') sources.add(ev.source); });
  assert(sim.world.status === 'defeat' && [...sources].join() === 'lunge', `the lunges took him (${sim.world.status}, ${[...sources]})`);
  const outcome = outcomeOf(run, sim.world, {}, watch.death);
  assert(same(outcome.death, { source: 'lunge', enemy: 'hound' }), JSON.stringify(outcome.death));
  const after = ok(resolveArena(run, outcome), 'lost');
  assert(lines(after)[0] === 'Сразил: рывок пса Кастеляна', lines(after)[0]);
  assert(serializeRtRun(parseRtRun(serializeRtRun(after))!) === serializeRtRun(after), 'the save with the death reads back');
});

check('task 43: a death by the full Castellan\'s «Болт» — «Сразил: болт Кастеляна» (the run\'s «Двор кастеляна», the hero out of the hounds\' reach)', () => {
  const run = newRun(29), pending = run.pending;
  assert(pending?.kind === 'battle', 'an open battle');
  const watch = new RtDeathWatch();
  const sim = new Simulation({ arena: 'g-castellan', params: rtRunParams(quiet()), seed: seedOf(29), hero: { hp: run.hp, maxHp: run.maxHp }, loadout: rtArenaLoadout(run), beforeTick: w => watch.seen(w) });
  sim.tick(); watch.read(sim.world, sim.world.events); sim.world.events.length = 0;
  const stand = sim.world.enemies.find(e => e.kind === 'castellan-crossbow')!;
  sim.command({ t: 'teleport', x: stand.x, y: 10 });
  const sources = new Set<string>();
  ticks(sim, 60 * 300, w => { watch.read(w, w.events); for (const ev of w.events) if (ev.type === 'hit') sources.add(ev.source); });
  assert(sim.world.status === 'defeat' && [...sources].join() === 'castellan-bolt', `the bolts took him (${sim.world.status}, ${[...sources]})`);
  const outcome = outcomeOf(run, sim.world, {}, watch.death);
  assert(same(outcome.death, { source: 'castellan-bolt', enemy: 'castellan-crossbow' }), JSON.stringify(outcome.death));
  assert(lines(ok(resolveArena(run, outcome), 'lost'))[0] === 'Сразил: болт Кастеляна', lines(ok(resolveArena(run, outcome), 'lost'))[0]);
});

check('the killer of an ability: an archer\'s arrow; a sapper\'s blast (the sapper is gone before its blast hits)', () => {
  // Archers at a distance: nothing touches (the quiet field), only arrows hurt.
  const archers = newRun(11);
  const shot = playFight(archers, { chains: [], k: 11, finish: (sim, seen) => {
    const hero = sim.world.hero;
    for (let a = 0; a < 4; a++) sim.command({ t: 'place', x: hero.x + 5, y: 2 + a * 2.5, color: a, hp: 0, kind: 'archer' });
    ticks(sim, 60 * 180, seen);
  } });
  assert(shot.events.filter(ev => ev.type === 'hit').every(ev => ev.type === 'hit' && ev.source === 'arrow'), 'only arrows hit');
  assert(same(shot.outcome.death, { source: 'arrow', enemy: 'archer' }), JSON.stringify(shot.outcome.death));
  const lostToArrows = ok(resolveArena(archers, shot.outcome), 'lost');
  assert(lines(lostToArrows)[0] === 'Сразил: стрела лучника', lines(lostToArrows)[0]);

  // Sappers one by one at the hero's side: each lights by touch and blows up (2 damage).
  const sappers = newRun(12);
  let lastSapper = 0;
  const blown = playFight(sappers, { chains: [], k: 12, finish: (sim, seen) => {
    for (let n = 0; n < 20 && sim.world.status === 'playing'; n++) {
      const hero = sim.world.hero;
      lastSapper = sim.command({ t: 'place', x: hero.x - 0.6, y: hero.y, color: 0, hp: 0, kind: 'sapper' }) as number;
      ticks(sim, 60 * 5, seen, w => !w.enemies.length && !w.blasts.length);
    }
  } });
  assert(!blown.sim.world.enemies.some(e => e.id === lastSapper), 'the last sapper died in its own blast');
  assert(same(blown.outcome.death, { source: 'blast', enemy: 'sapper' }), JSON.stringify(blown.outcome.death));
  const lostToBlast = ok(resolveArena(sappers, blown.outcome), 'lost');
  assert(lines(lostToBlast)[0] === 'Сразил: взрыв сапёра', lines(lostToBlast)[0]);
});

/**
 * The goblin's arrows kill: the hero's HP is set low and the arrows' damage to its highest (journalled `param` commands, clamped
 * by the panel's ranges), bare pulls until the pull is a rain or a volley, then the arrows land (marks over the hero).
 */
const killedByArrows = (outcomeName: 'rain' | 'volley') => (sim: Simulation, seen: (w: World) => void): void => {
  sim.command({ t: 'param', key: 'heroHp', value: 3 });
  sim.command({ t: 'param', key: 'slotDamage', value: 5 });
  if (outcomeName === 'rain') { sim.command({ t: 'param', key: 'slotRainMin', value: 30 }); sim.command({ t: 'param', key: 'slotRainMax', value: 30 }); }
  else sim.command({ t: 'param', key: 'slotVolleyMarks', value: 12 });
  summonGoblin(sim);
  for (let pull = 0; pull < 3 && sim.world.status === 'playing'; pull++) {
    let got: ReturnType<typeof pullBare>;
    // The other arrows of an earlier pull may fell the hero before this pull's dash: that seed does not serve.
    try { got = pullBare(sim, seen); } catch (error) { if (sim.world.status !== 'playing') break; throw error; }
    if (got.outcome !== outcomeName) continue;
    ticks(sim, 60 * 20, seen);
    break;
  }
  if (sim.world.status === 'playing') throw new Error(MISS);
};
const MISS = 'no such pull on this seed';

check('the killer of the field and of the goblin: thorns — «шипы»; the goblin\'s rain or volley — «стрелы гоблина»', () => {
  // Thorns: the hero stands in a hedge of the thorns arena; it pricks at once and every interval until he falls.
  const hedge = newRun(41);
  const pricked = playFight(hedge, { chains: [], k: 41, arena: 'thorns', finish: (sim, seen) => {
    sim.command({ t: 'teleport', x: 8, y: 7.05 });
    assert(inThorns(sim.world.hero, sim.world.arena), 'the hero stands in thorns');
    ticks(sim, 60 * 300, seen);
  } });
  assert(pricked.sim.world.status === 'defeat', 'the thorns took him');
  assert(pricked.events.filter(ev => ev.type === 'hit').every(ev => ev.type === 'hit' && ev.source === 'thorns'), 'only thorns hit');
  assert(same(pricked.outcome.death, { source: 'thorns' }), JSON.stringify(pricked.outcome.death));
  assert(lines(ok(resolveArena(hedge, pricked.outcome), 'lost'))[0] === 'Сразил: шипы', 'thorns line');

  // The goblin: the pull must be a rain / a volley, which depends on the seed's reels: the first seeds that give one.
  for (const outcomeName of ['rain', 'volley'] as const) {
    let found = false;
    for (let k = 1; k <= 120 && !found; k++) {
      const run = newRun(k);
      let fight: ReturnType<typeof playFight>;
      // The arrows come only from the skull reels — the run's before task 11 (13.10.2026); today's run goblin gives sure
      // triples and busts, the line stays for the reels.
      try { fight = playFight(run, { chains: [], k, params: { ...rtRunParams(quiet()), slotSafeRandom: false, slotSafeTriple: false }, finish: killedByArrows(outcomeName) }); } catch (error) { if (error instanceof Error && error.message === MISS) continue; throw error; }
      found = true;
      const source = outcomeName === 'rain' ? 'slot-rain' : 'slot-volley';
      // An earlier pull of the other arrows may have been the lethal one (the damage is 5, the HP 3): then the seed does not serve.
      if (fight.outcome.death?.source !== source) { found = false; continue; }
      assert(same(fight.outcome.death, { source }), JSON.stringify(fight.outcome.death));
      assert(lines(ok(resolveArena(run, fight.outcome), 'lost'))[0] === 'Сразил: стрелы гоблина', `${outcomeName}: goblin line`);
    }
    assert(found, `a seed with a lethal ${outcomeName} within 120`);
  }
});

check('a defeat before the Jailer: killer, row and rows left, «Тюремщик не пройден», the peak (kills, its row); a reload keeps them', () => {
  let run = newRun(21);
  assert(rowOf(run) === 1, 'the first battle is on row 1');
  run = ok(resolveArena(run, playFight(run, { chains: [4], k: 1 }).outcome), 'fight 1');
  run = walkTo(toBattle(closeNode(run)), 3);
  assert(rowOf(run) === 3, `row ${rowOf(run)}`);
  run = ok(resolveArena(run, playFight(run, { chains: [6], k: 2, finish: touchedBy('shield', true, ['swift']) }).outcome), 'fight 2');
  const expected = ['Сразил: щитоносец-элита (броня, стремительный)', 'Ряд 3 · до «Последнего рубежа» 7', 'Тюремщик не пройден', 'Лучшая цепь похода: 6 убийств · ряд 3'];
  assert(same(lines(run), expected), JSON.stringify(lines(run)));
  assert(same(rtRunEndLines(run).map(line => line.id), ['killer', 'row', 'jailer', 'peak']), 'the order');
  // The save: the store writes it, a reload reads the same run and the same lines.
  const memory = new Map<string, string>(), storage: RunStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); }, removeItem: k => { memory.delete(k); } };
  assert(createRtRunStore(storage).save(run), 'saved');
  const back = createRtRunStore(storage).load();
  assert(back && same(back, run) && same(lines(back), expected), 'a reload keeps the lines');
  assert(JSON.parse(memory.get(RT_RUN_STORAGE_KEY)!).version === 7, 'version 7');
});

check('a defeat after the Jailer says «Тюремщик пройден»; a defeat on the final arena — «Последний рубеж» не пройден', () => {
  // The first seed whose walk (first available nodes) meets a battle on row 6.
  let run = walkTo(newRun(22), 6);
  for (let k = 40; k < 80 && rowOf(run) !== 6; k++) run = walkTo(newRun(k), 6);
  assert(rowOf(run) === 6, `row ${rowOf(run)}`);
  run = ok(resolveArena(run, playFight(run, { chains: [3], k: 3, lose: true }).outcome), 'lost on row 6');
  assert(same(lines(run), ['Сразил: враг', 'Ряд 6 · до «Последнего рубежа» 4', 'Тюремщик пройден', 'Лучшая цепь похода: 3 убийства · ряд 6']), JSON.stringify(lines(run)));

  let final = walkTo(newRun(23), 10);
  assert(rtNode(final, final.pending!.kind === 'battle' ? final.pending!.nodeId : '')!.type === 'boss', 'the final arena');
  final = ok(resolveArena(final, playFight(final, { chains: [], k: 4, lose: true }).outcome), 'lost on the final');
  assert(same(lines(final), ['Сразил: враг', 'Ряд 10 · «Последний рубеж» не пройден', 'Тюремщик пройден']), JSON.stringify(lines(final)));
});

check('victory: only the final row and the peak (no killer, no Jailer line); no chain recorded — no peak line', () => {
  let run = newRun(24);
  run = ok(resolveArena(run, playFight(run, { chains: [5], k: 5 }).outcome), 'fight 1');
  run = walkTo(toBattle(closeNode(run)), 10);
  run = ok(resolveArena(run, playFight(run, { chains: [2], k: 6 }).outcome), 'the final');
  assert(run.result?.outcome === 'victory', 'won');
  assert(same(lines(run), ['Ряд 10 · «Последний рубеж» пройден', 'Лучшая цепь похода: 5 убийств · ряд 1']), JSON.stringify(lines(run)));
  assert(run.battles.every(record => record.death === undefined), 'no death on a won run');
  // A won run of plain outcomes (no chain recorded): the final row only.
  let plain = walkTo(newRun(25), 10);
  plain = winPlain(plain);
  assert(plain.result?.outcome === 'victory' && same(lines(plain), ['Ряд 10 · «Последний рубеж» пройден']), JSON.stringify(lines(plain)));
});

check('the save: a won fight keeps no death; a malformed death is not kept; malformed saved deaths are no run', () => {
  const run = newRun(31);
  const won = ok(resolveArena(run, { ...playFight(run, { chains: [2], k: 7 }).outcome, death: { source: 'touch', enemy: 'basic' } }), 'won');
  assert(won.battles[0].death === undefined, 'a won fight has no death');
  const lost = playFight(run, { chains: [], k: 8, lose: true }).outcome;
  const bad = ok(resolveArena(run, { ...lost, death: { source: 'touch', enemy: 'dragon' } as RtArenaOutcome['death'] }), 'lost');
  assert(bad.battles[0].death === undefined && lines(bad)[0] === 'Ряд 1 · до «Последнего рубежа» 9', 'an unknown kind is not kept, no killer line');
  const good = ok(resolveArena(run, lost), 'lost');
  assert(parseRtRun(serializeRtRun(good)) !== null, 'the good save loads');
  const forged = (edit: (value: any) => void): string => { const value = JSON.parse(serializeRtRun(good)); edit(value); return JSON.stringify(value); };
  const last = (value: any) => value.battles[value.battles.length - 1];
  const malformed: [string, (value: any) => void][] = [
    ['an unknown kind', v => { last(v).death.enemy = 'dragon'; }],
    ['no source', v => { delete last(v).death.source; }],
    ['a source with spaces', v => { last(v).death.source = 'a b'; }],
    ['an unknown field', v => { last(v).death.by = 'x'; }],
    ['elite false', v => { last(v).death.elite = false; }],
    ['armour without the elite mark', v => { last(v).death.armor = true; }],
    ['an unknown affix', v => { Object.assign(last(v).death, { elite: true, affixes: ['huge'] }); }],
    ['a repeated affix', v => { Object.assign(last(v).death, { elite: true, affixes: ['fat', 'fat'] }); }],
    ['an empty affix list', v => { Object.assign(last(v).death, { elite: true, affixes: [] }); }],
    ['a death on a won record', v => { last(v).won = true; }],
    ['a death that is not an object', v => { last(v).death = 'touch'; }],
  ];
  for (const [what, edit] of malformed) assert(parseRtRun(forged(edit)) === null, `${what}: no run`);
  // A death on a record of a run that has not ended in defeat there (an earlier won record gets it).
  const walked = ok(resolveArena(toBattle(closeNode(won)), playFight(toBattle(closeNode(won)), { chains: [], k: 9, lose: true }).outcome), 'lost later');
  const moved = JSON.parse(serializeRtRun(walked));
  moved.battles[0].death = moved.battles[1].death;
  assert(parseRtRun(JSON.stringify(moved)) === null, 'a death on a won earlier record: no run');
  // Known kinds' lines: the elite mark only with the kind; an unknown source has none.
  assert(rtDeathLine({ source: 'touch' }) === null && rtDeathLine({ source: 'slot-other' }) === null && rtDeathLine({ source: 'thorns', enemy: 'wolf' }) === 'Сразил: шипы', 'no line');
  assert(rtDeathLine({ source: 'quills', enemy: 'porcupine', elite: true, armor: true }) === 'Сразил: иглы дикобраза', 'quills');
  assert(rtDeathLine({ source: 'lynx', enemy: 'lynx' }) === 'Сразил: прыжок рыси' && rtDeathLine({ source: 'boar', enemy: 'boar' }) === 'Сразил: рывок кабана'
    && rtDeathLine({ source: 'fire-trail', enemy: 'boar', elite: true, armor: true, affixes: ['fiery'] }) === 'Сразил: огненный след', 'abilities');
  assert(rtDeathLine({ source: 'touch', enemy: 'boar', elite: true, armor: true }) === 'Сразил: кабан-элита (броня)', 'the draft example');
});

check('a save written before П6 (fixture) loads unchanged; lost the old way it shows no killer line; lost now it shows one', () => {
  const text = saveBefore.save;
  const run = parseRtRun(text);
  assert(run && serializeRtRun(run) === text, 'the fixture loads and saves byte for byte');
  assert(run.battles.every(record => record.death === undefined), 'no death in the fixture');
  // Lost the old way: the outcome without the field (as the build before П6 sent it).
  const old = playFight(run, { chains: [], k: 10, lose: true }).outcome;
  const { death: _drop, ...withoutDeath } = old;
  const lostOld = ok(resolveArena(run, withoutDeath), 'lost the old way');
  const reloaded = parseRtRun(serializeRtRun(lostOld));
  assert(reloaded && same(reloaded, lostOld), 'the old-shape lost save loads');
  const row = runRow(rtNode(run, run.pending!.kind === 'battle' ? run.pending!.nodeId : '')!.row);
  assert(row === 9, `the fixture's battle is on row ${row}`);
  assert(same(lines(reloaded), ['Ряд 9 · до «Последнего рубежа» 1', 'Тюремщик пройден']), JSON.stringify(lines(reloaded)));
  // Played on with this build: the killer is there.
  const lostNow = ok(resolveArena(run, old), 'lost now');
  assert(same(lines(lostNow), ['Сразил: враг', 'Ряд 9 · до «Последнего рубежа» 1', 'Тюремщик пройден']), JSON.stringify(lines(lostNow)));
});

console.log(`\n${checks} checks passed`);
