/**
 * Т3 and 5а: the relics with a price and the new «Клятва голода» (track Д3; docs/realtime-phase-b.md, sections 5, 5а, 8 and
 * 9 «Д3»). Node only: `npm run test:realtime-relics`.
 *
 * Every rule is checked through the commands of a journalled fight (place, draw, release, walk, item), not through its
 * table: the plus and the price act; a counter fires on its count and not before; «Жернов» with «Осколок жернова» gives the
 * same step in any order of the modules; a fight replays from its journal to the same hash; without the item the numbers are
 * the old ones. The run's part (the maximum HP of «Жернов», the rest and the energy of the oath) — rtRun.spec.ts.
 */
import { buildModules, chainShieldOf, counterOf, crystalEveryOf, enemyWalkFactorOf, focusMaxOf, heroSpeedOf, itemHealOf, linkGainOf, linkRadiusOf, registerBuildModule } from './build';
import { COUNTER_TALISMANS, OATH_HUNGER, RELICS } from './buildIds';
import { planChain } from './chain';
import { arenaTemplate } from './arenas';
import { dhypot } from './detMath';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import {
  BLOOD_OATH_ENERGY, BLOOD_OATH_KILLS, HEAVY_BLADE_FOCUS, HUNGER_HEAL, HUNGER_KILLS, MILLSTONE_RELIC_STEP, SWIFT_FEET_SPEED, WIDE_CIRCLE_ENEMY_WALK,
  WIDE_CIRCLE_RADIUS, millstoneEvery,
} from './relics';
import { Simulation, replay } from './simulation';
import { canBeHurt, createWorld, enemySpeed, type Enemy, type World, type WorldEvent } from './world';
import { rtTalisman } from '../run/rtTalismans';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** A quiet fight: no newcomers, enemies stand, touches do not hurt, no energy per hit — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false; p.energyPerKill = 0; p.survivorKnockback = false; p.crystals = false;
  return Object.assign(p, extra);
}
function fight(talismans: string[], params = quiet(), hero = { hp: 15, maxHp: 15 }, loadout: Loadout = {}): Simulation {
  const sim = new Simulation({ arena: 'kills', params, seed: 23, record: true, hero, loadout: { ...loadout, talismans } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, kind = 'basic', color = 0): Enemy => {
  const id = sim.command({ t: 'place', x, y, color, hp, kind }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
function draw(sim: Simulation, links: readonly Enemy[]): void {
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
}
/** Ticks until the hero stands, collecting the events; `each` sees the world after every tick. */
function settle(sim: Simulation, each?: (w: World) => void): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < 600 && (sim.world.move || i === 0); i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; each?.(sim.world); }
  return events;
}
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); sim.world.events.length = 0; } };
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** A row of `n` (≤ 7) enemies right of the hero at (4; 6), drawn and released as one chain; the events of the dash. */
function chainRow(sim: Simulation, n: number, hp: number | number[] = 0, each?: (w: World) => void): WorldEvent[] {
  assert(n >= 1 && n <= 7, 'a row of 1–7');
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = Array.from({ length: n }, (_, i) => place(sim, 5.2 + 1.2 * i, 6, Array.isArray(hp) ? hp[i] : hp));
  draw(sim, links);
  assert(sim.world.chain.length === n, `drawn ${sim.world.chain.length} of ${n}`);
  sim.command({ t: 'release' });
  return settle(sim, each);
}
const fired = (events: WorldEvent[], id: string): number => events.filter(e => e.type === 'talismanFired' && e.id === id).length;
const progressOf = (w: World, id: string) => buildModules().find(m => m.id === id)!.progress!(w);

// A test module after the relics in the registry: the −1 / at least 2 of «Осколок жернова» as a modifier (the real shard is
// in the base of `crystalEveryOf`, before every module) — to see «Жернов» with a shard on either side of it.
const SHARD_AFTER = 'test-shard-after';
registerBuildModule({ id: SHARD_AFTER, modify: { crystalEvery: (_w, value) => Math.max(2, value - 1) } });
// A test module after the relics: the after-chain shield ×2 («Добивание»'s rule) — «Быстрые ноги» keeps it 0 on either side.
const DOUBLE_SHIELD = 'test-double-shield';
registerBuildModule({ id: DOUBLE_SHIELD, modify: { chainShield: (_w, value) => value * 2 } });

// ---- Without an item: the old numbers ----

check('without a relic the getters give the old numbers; the relics act only while the kit holds them', () => {
  const params = defaultParams();
  for (const talismans of [[], ['whetstone', 'millstone-shard']]) {
    const w = createWorld(arenaTemplate('kills'), params, 3, undefined, { talismans });
    assert(linkRadiusOf(w) === params.linkRadius && focusMaxOf(w) === params.focusMax && heroSpeedOf(w) === params.heroSpeed, 'R, focus, speed');
    assert(enemyWalkFactorOf(w) === 1 && itemHealOf(w) === params.itemHeal && linkGainOf(w) === 1 && chainShieldOf(w) === params.chainShield, 'walk, heal, gain, shield');
    assert(w.focus === params.focusMax, 'start focus');
  }
  // Each relic alone changes its own numbers only.
  const only = (id: string) => createWorld(arenaTemplate('kills'), params, 3, undefined, { talismans: [id] });
  const mill = only(RELICS.millstone), blade = only(RELICS.heavyBlade), feet = only(RELICS.swiftFeet), wide = only(RELICS.wideCircle), blood = only(RELICS.bloodOath), hunger = only(OATH_HUNGER);
  assert(crystalEveryOf(mill) === 4 && linkGainOf(mill) === 1 && focusMaxOf(mill) === 3, '«Жернов»: crystal 4, the rest as before');
  assert(linkGainOf(blade) === 2 && near(focusMaxOf(blade), 1.5) && crystalEveryOf(blade) === 6, '«Тяжёлый клинок»: gain 2, focus 1.5');
  assert(near(heroSpeedOf(feet), params.heroSpeed * 1.25) && chainShieldOf(feet) === 0 && linkRadiusOf(feet) === params.linkRadius, '«Быстрые ноги»: speed ×1.25, shield 0');
  assert(near(linkRadiusOf(wide), params.linkRadius * 1.25) && near(enemyWalkFactorOf(wide), 1.1) && heroSpeedOf(wide) === params.heroSpeed, '«Широкий круг»: R ×1.25, walk ×1.1');
  assert(itemHealOf(blood) === 5 && enemyWalkFactorOf(blood) === 1, '«Кровавая клятва»: heal 9 → 5');
  for (const w of [hunger]) {
    assert(linkRadiusOf(w) === params.linkRadius && focusMaxOf(w) === params.focusMax && itemHealOf(w) === params.itemHeal && crystalEveryOf(w) === 6, '«Клятва голода»: no number changes');
  }
  // The constants the cards and the doc read.
  assert(MILLSTONE_RELIC_STEP === 2 && HEAVY_BLADE_FOCUS === 0.5 && SWIFT_FEET_SPEED === 1.25 && WIDE_CIRCLE_RADIUS === 1.25 && WIDE_CIRCLE_ENEMY_WALK === 1.1, 'relic numbers');
  assert(BLOOD_OATH_KILLS === 6 && BLOOD_OATH_ENERGY === 1 && HUNGER_KILLS === 15 && HUNGER_HEAL === 1, 'counter numbers');
  // The run's card of the oath says its numbers as they are (design answer 20) — and no energy any more.
  const card = rtTalisman(OATH_HUNGER)!.effect;
  assert(card.includes(`+${HUNGER_HEAL} HP за ${HUNGER_KILLS} убийств цепью`) && card.includes('привал не лечит') && !card.includes('энерги'), `the oath card: ${card}`);
});

// ---- «Жернов» ----

/** The chain kill at which each crystal of one chain fell (7 links of 0 HP). */
function crystalKills(talismans: string[]): number[] {
  const sim = fight(talismans, quiet({ crystals: true })), at: number[] = [];
  let crystals = 0;
  chainRow(sim, 7, 0, w => { if (w.stats.crystals > crystals) { crystals = w.stats.crystals; at.push(w.stats.kills); } });
  assert(sim.world.stats.kills === 7, `seven kills (${sim.world.stats.kills})`);
  assert(replays(sim), `replay ${talismans}`);
  return at;
}

check('«Жернов»: a crystal at the 4th chain kill (not the 3rd), with «Осколок жернова» at the 3rd and 6th, in any order of the modules', () => {
  assert(crystalKills([]).join() === '6', `no relic: ${crystalKills([])}`);
  assert(crystalKills(['millstone-shard']).join() === '5', 'shard: 5');
  assert(crystalKills([RELICS.millstone]).join() === '4', `relic: ${crystalKills([RELICS.millstone])}`);
  // Both: the shard before the relic (in the base) and the shard as a module after it — the same 3 and 6.
  const before = crystalKills(['millstone-shard', RELICS.millstone]), after = crystalKills([RELICS.millstone, SHARD_AFTER]);
  assert(before.join() === '3,6' && after.join() === '3,6', `relic + shard: ${before} / ${after}`);
  // The rule commutes with the shard's on every panel step, and never goes below 2 (or raises a small step).
  for (let v = 1; v <= 12; v++) {
    const shard = (x: number) => Math.max(2, x - 1);
    assert(millstoneEvery(shard(v)) === shard(millstoneEvery(v)), `order at ${v}`);
    assert(millstoneEvery(v) >= Math.min(v, 2) && millstoneEvery(v) <= v, `bounds at ${v}`);
  }
  const small = createWorld(arenaTemplate('kills'), { ...defaultParams(), crystalEvery: 3 }, 3, undefined, { talismans: [RELICS.millstone, 'millstone-shard'] });
  assert(crystalEveryOf(small) === 2, `at least 2 (${crystalEveryOf(small)})`);
});

// ---- «Тяжёлый клинок» ----

check('«Тяжёлый клинок»: every link +2 power (not +1, not +3), the highlight shows it; the focus reserve 1.5', () => {
  // Links 1, 3, 0 HP: with +1 the 2nd survives (power 1 against 3); with +2 all three die (2 − 1 = 1, 1 + 2 = 3).
  const runs = [[], [RELICS.heavyBlade]].map(talismans => {
    const sim = fight(talismans), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const links = [place(sim, 5.2, 6, 1), place(sim, 6.4, 6, 3), place(sim, 7.6, 6, 0)];
    draw(sim, links);
    const before = sim.hash(), plan = planChain(w);
    assert(sim.hash() === before, 'the plan changes nothing');
    sim.command({ t: 'release' });
    const hits = settle(sim).filter((e): e is Extract<WorldEvent, { type: 'chainHit' }> => e.type === 'chainHit');
    plan.links.slice(0, hits.length).forEach((l, i) => assert(hits[i].damage === l.outcome!.damage && hits[i].killed === l.outcome!.killed, `link ${i + 1}: plan = dash`));
    assert(replays(sim), 'replay');
    return { sim, plan, kills: w.stats.kills };
  });
  assert(runs[0].kills === 1 && runs[0].plan.endsOnSurvivor, `+1: one kill, the 2nd survives (${runs[0].kills})`);
  assert(runs[1].kills === 3 && runs[1].plan.kills === 3, `+2: three kills (${runs[1].kills})`);
  // Exactly +2: a lone link of 2 HP dies, of 3 HP survives with 1.
  for (const [hp, dies, left] of [[2, true, 0], [3, false, 1]] as const) {
    const sim = fight([RELICS.heavyBlade]);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const e = place(sim, 5.2, 6, hp);
    draw(sim, [e]); sim.command({ t: 'release' }); settle(sim);
    assert(sim.world.enemies.some(x => x.id === e.id) === !dies && (dies || e.hp === left), `${hp} HP: ${dies ? 'dies' : `survives with ${left}`} (hp ${e.hp})`);
  }
  // The price: the reserve starts at 1.5, a new link refills it to 1.5, not to 3.
  const sim = fight([RELICS.heavyBlade], quiet({ focusPerLink: 0 })), w = sim.world;
  assert(near(w.focus, 1.5), `start focus ${w.focus}`);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const a = place(sim, 5.2, 6, 0), b = place(sim, 6.4, 6, 0);
  w.focus = 0.2;
  draw(sim, [a, b]);
  assert(w.focus > 0.2 && w.focus <= 1.5 + 1e-9, `refilled to the halved reserve (${w.focus})`);
  sim.command({ t: 'cancel' });
  const plain = fight([]);
  assert(plain.world.focus === plain.world.params.focusMax, 'without it: 3');
});

// ---- «Быстрые ноги» ----

check('«Быстрые ноги»: the hero walks 25% farther in the same time; no invulnerability after a killing chain (also beside a ×2 shield)', () => {
  const walked = [[], [RELICS.swiftFeet]].map(talismans => {
    const sim = fight(talismans);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    sim.command({ t: 'walk', x: 1, y: 0 });
    ticks(sim, 30);
    sim.command({ t: 'walk', x: 0, y: 0 });
    assert(replays(sim), 'replay');
    return sim.world.hero.x - 4;
  });
  assert(walked[0] > 0.5 && near(walked[1], walked[0] * 1.25, 1e-6), `walk ${walked[0]} → ${walked[1]}`);
  const shieldAfter = (talismans: string[]) => {
    const sim = fight(talismans);
    let shield = -1;
    chainRow(sim, 2, 0, w => { if (!w.move && shield < 0) shield = w.hero.chainShield; });
    return { shield, hurt: canBeHurt(sim.world), sim };
  };
  const plain = shieldAfter([]), feet = shieldAfter([RELICS.swiftFeet]), both = shieldAfter([DOUBLE_SHIELD, RELICS.swiftFeet]), doubled = shieldAfter([DOUBLE_SHIELD]);
  assert(plain.shield > 0 && !plain.hurt, `without it the hero is untouchable after the chain (${plain.shield})`);
  assert(feet.shield === 0 && feet.hurt, `with it the hero can be hurt at once (${feet.shield})`);
  assert(doubled.shield > plain.shield && both.shield === 0, `×2 alone ${doubled.shield}; with «Быстрые ноги» 0 (${both.shield})`);
  assert(replays(feet.sim), 'replay');
  // The catalogue keeps it apart from «Добивание» (track Д4); the id the sim knows.
  assert(COUNTER_TALISMANS.finisher === 'finishing-blow', 'the id of «Добивание»');
});

// ---- «Широкий круг» ----

check('«Широкий круг»: a link 2.2 away is in reach (R 1.875 → 2.34), 2.45 is not; enemies walk 10% faster, the reaper as before', () => {
  // R to the centre (the panel's «R до края тела» off) — the numbers are R itself.
  for (const [talismans, reach22] of [[[], false], [[RELICS.wideCircle], true]] as const) {
    const sim = fight([...talismans], quiet({ linkToEdge: false }));
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const near22 = place(sim, 6.2, 6, 0), far = place(sim, 4, 8.45, 0);
    assert((sim.command({ t: 'begin', x: near22.x, y: near22.y }) === true) === reach22, `begin at 2.2: ${reach22}`);
    sim.command({ t: 'cancel' });
    // A link from a link: the second 2.2 from the first.
    if (reach22) {
      const a = place(sim, 5.2, 4.5, 0), b = place(sim, 7.4, 4.5, 0);
      draw(sim, [a, b]);
      assert(sim.world.chain.length === 2 && dhypot(b.x - sim.world.hero.x, b.y - sim.world.hero.y) > 3, 'the next link 2.2 from the last one joins');
      sim.command({ t: 'cancel' });
    }
    assert(sim.command({ t: 'begin', x: far.x, y: far.y }) === false, 'beyond 2.34: no');
  }
  // The price: an enemy walks towards the hero 30 ticks — ×1.1 the way; the reaper's speed is the same.
  const ways = [[], [RELICS.wideCircle]].map(talismans => {
    const sim = fight(talismans, quiet({ enemySpeed: 1.2 }));
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const e = place(sim, 13, 4.5, 0, 'basic', 2), from = { x: e.x, y: e.y };
    ticks(sim, 30);
    const reaper = place(sim, 14, 8, 0, 'reaper', 1);
    assert(replays(sim), 'replay');
    return { way: dhypot(e.x - from.x, e.y - from.y), reaper: enemySpeed(sim.world, reaper) };
  });
  assert(ways[0].way > 0.3 && near(ways[1].way, ways[0].way * 1.1, 0.02), `walk ${ways[0].way} → ${ways[1].way}`);
  assert(ways[0].reaper > 0 && near(ways[1].reaper, ways[0].reaper), `reaper ${ways[0].reaper} / ${ways[1].reaper}`);
});

// ---- «Кровавая клятва» ----

check('«Кровавая клятва»: +1 energy at the 6th chain kill of the arena, across chains, not at the 5th; up to 7; healing 9 → 5', () => {
  const sim = fight([RELICS.bloodOath]), w = sim.world, id = RELICS.bloodOath, energy = (): number => w.energy;
  assert(energy() === 0 && progressOf(w, id)?.value === 0 && progressOf(w, id)?.max === 6, 'start: 0/6');
  let events = chainRow(sim, 5);
  assert(w.stats.kills === 5 && energy() === 0 && fired(events, id) === 0 && progressOf(w, id)?.value === 5, `5 kills: energy ${energy()}`);
  events = chainRow(sim, 1);
  assert(energy() === 1 && fired(events, id) === 1 && progressOf(w, id)?.value === 0, `6th kill (another chain): energy ${energy()}`);
  events = chainRow(sim, 6);
  assert(energy() === 2 && fired(events, id) === 1, `12th kill: energy ${energy()}`);
  // Kills not by the chain (a bomb) do not count.
  sim.command({ t: 'items', kind: 'bomb', count: 1 });
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const target = place(sim, 5.5, 6, 0);
  assert(sim.command({ t: 'item', kind: 'bomb', x: target.x, y: target.y }) === true, 'the bomb is thrown');
  ticks(sim, 10);
  assert(w.stats.kills > 12 && counterOf(w, id) === 0 && energy() === 2, `bomb kills ${w.stats.kills - 12}: counter ${counterOf(w, id)}`);
  // Up to 7.
  sim.command({ t: 'energy', value: 7 });
  chainRow(sim, 6);
  assert(energy() === 7, `capped (${energy()})`);
  assert(replays(sim), 'replay');
  // The price: the healing consumable heals 5 instead of 9.
  const heal = (talismans: string[]) => {
    const s = fight(talismans, quiet(), { hp: 1, maxHp: 15 }, { items: { healing: 1 } });
    s.command({ t: 'item', kind: 'healing', x: 8, y: 5 });
    assert(replays(s), 'replay heal');
    return s.world.hero.hp - 1;
  };
  assert(heal([]) === 9 && heal([id]) === 5, `heal ${heal([])} → ${heal([id])}`);
  // No relic: no counter, energy only from the panel's energy per hit (0 here).
  const plain = fight([]);
  chainRow(plain, 6);
  assert(plain.world.energy === 0 && !plain.world.kit!.counters, 'without it: nothing');
});

// ---- «Клятва голода» ----

check('«Клятва голода»: +1 HP at the 15th chain kill of the arena (not the 14th), not above the maximum; a new arena counts from 0', () => {
  const id = OATH_HUNGER;
  const sim = fight([id], quiet(), { hp: 5, maxHp: 15 }), w = sim.world, hp = (): number => w.hero.hp;
  assert(progressOf(w, id)?.max === 15 && progressOf(w, id)?.value === 0, 'start: 0/15');
  chainRow(sim, 7); chainRow(sim, 7);
  assert(w.stats.kills === 14 && hp() === 5 && progressOf(w, id)?.value === 14, `14 kills: HP ${hp()}`);
  const events = chainRow(sim, 1);
  assert(hp() === 6 && fired(events, id) === 1 && progressOf(w, id)?.value === 0, `15th kill: HP ${hp()}`);
  chainRow(sim, 7); chainRow(sim, 7);
  assert(hp() === 6, '29 kills: still 6');
  chainRow(sim, 1);
  assert(hp() === 7, `30th kill: HP ${hp()}`);
  assert(replays(sim), 'replay');
  // Full HP: the 15th kill fires, the HP stays at the maximum.
  const full = fight([id], quiet(), { hp: 15, maxHp: 15 });
  chainRow(full, 7); chainRow(full, 7);
  const fullEvents = chainRow(full, 1);
  assert(full.world.hero.hp === 15 && fired(fullEvents, id) === 1 && counterOf(full.world, id) === 0, `full: ${full.world.hero.hp}`);
  // A new arena (a new world from the same loadout): the counter starts from 0 — 14 here and 1 there give no HP.
  const first = fight([id], quiet(), { hp: 5, maxHp: 15 });
  chainRow(first, 7); chainRow(first, 7);
  const next = fight([id], quiet(), { hp: first.world.hero.hp, maxHp: 15 });
  assert(counterOf(next.world, id) === 0 && progressOf(next.world, id)?.value === 0, 'the next arena starts from 0');
  chainRow(next, 1);
  assert(next.world.hero.hp === 5, `the next arena's 1st kill: no HP (${next.world.hero.hp})`);
  // Without the oath: 15 chain kills heal nothing.
  const plain = fight([], quiet(), { hp: 5, maxHp: 15 });
  chainRow(plain, 7); chainRow(plain, 7); chainRow(plain, 1);
  assert(plain.world.hero.hp === 5, 'without it: no HP');
});

console.log(`realtime-relics: ${checks} checks passed`);
