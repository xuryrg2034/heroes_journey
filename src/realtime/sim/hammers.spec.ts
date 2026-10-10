/**
 * Т2. Hammers of the dash (track Д2; docs/realtime-phase-b.md, sections 4, 8 — decisions 15–18 — and 9, «Д2»). Node only:
 * `npm run test:realtime-hammers`. Every fight runs through journal commands (place, begin / drag, release, walk, item …)
 * with the hammer in the loadout, next to the same fight without it, and replays from its journal to the same hash.
 *
 * - «Огненный проход»: the dash leaves fire; an enemy in it burns 1, then again after the 1 s pause — a credited kill that
 *   completes the kill goal and is not a kill of the chain; a fiery elite and the hero do not burn; the fire is gone after
 *   2 s; no point in water.
 * - «Взрыв на конце»: a blast of 1.5 around the last link (around a survivor where it stands), by body touch, no push;
 *   none when the dash ends in the door (victory).
 * - «Режущий проход»: any colour within 0.5 of the path is hit once a dash (a bounce off a survivor does not hit twice); the
 *   links, the reaper are not; the shieldbearer dies through its shield; raised quills do not answer; no ×2 on a frozen one.
 * - «Возврат»: the hero runs back to the start untouchable; power ⌊end power / 2⌋ (at least 1) spent on the HP removed;
 *   the way back folds the bounce off a survivor away.
 * - Journals recorded before phase B replay to their recorded hash.
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import legacyJournals from '../../../tests/fixtures/realtime-legacy-build-journals.json';
import { registerArena } from './arenas';
import { BUILD_SOURCES, HAMMERS, type HammerId } from './buildIds';
import { chainScore } from './chain';
import { bodyRadiusOf } from './enemies/kinds';
import { inWater, pond } from './geometry';
import { BLAST_RADIUS, CUT_RADIUS, FIRE_LIFE, FIRE_PAUSE, FIRE_RADIUS, RETURN_RADIUS, hammerFirePoints, type FirePoint } from './hammers';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { SIM_DT, Simulation, replay, type Journal } from './simulation';
import { canBeHurt, doorOf, type Enemy, type World, type WorldEvent } from './world';
import type { Loadout } from './kit';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

/** A quiet fight: no newcomers, enemies stand, touches do not hurt, no knockback of a survivor, no hit-stop. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
function fight(hammer: HammerId | null, params: Params = quiet(), seed = 11, arena = 'kills', extra: Loadout = {}): Simulation {
  const loadout: Loadout = { talismans: [], ...extra, ...hammer ? { hammer } : {} };
  const sim = new Simulation({ arena, params, seed, record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, extra: { elite?: boolean; kind?: string; color?: number; affixes?: string[] } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true } : {}, ...extra.affixes ? { affixes: extra.affixes } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Draws a chain through the links in order (the first press, then drags) and releases it. */
function dash(sim: Simulation, links: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(sim.world.chain.length === links.length, `chain drawn: ${sim.world.chain.length} of ${links.length}`);
  sim.command({ t: 'release' });
}
/** Ticks until the hero stands (the dash and any return run after it), collecting the events. */
function settle(sim: Simulation, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function ticks(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
type Kill = Extract<WorldEvent, { type: 'kill' }>;
type Hit = Extract<WorldEvent, { type: 'enemyHit' }>;
type HammerEvent = Extract<WorldEvent, { type: 'hammer' }>;
const killsOf = (events: readonly WorldEvent[], e: Enemy): Kill[] => events.filter((x): x is Kill => x.type === 'kill' && x.enemyId === e.id);
const hitsOf = (events: readonly WorldEvent[], e: Enemy): Hit[] => events.filter((x): x is Hit => x.type === 'enemyHit' && x.enemyId === e.id);
const hammerEvents = (events: readonly WorldEvent[], kind?: HammerEvent['kind']): HammerEvent[] => events.filter((x): x is HammerEvent => x.type === 'hammer' && (!kind || x.kind === kind));
const body = (sim: Simulation, kind = 'basic'): number => bodyRadiusOf(sim.world.params, { kind } as Enemy);

/** Three weak links on the row y 6 from the hero at (4, 6): x 5.2, 6.4, 7.6. */
function row(sim: Simulation, hps: readonly number[] = [0, 0, 0], from = 4, y = 6): Enemy[] {
  sim.command({ t: 'teleport', x: from, y });
  return hps.map((hp, i) => place(sim, from + 1.2 * (i + 1), y, hp));
}

// ---- Old journals ----

check('journals recorded before phase B replay to their recorded hash (the hammers registered, none taken)', () => {
  const fixtures = [browserJournal, shieldsWolvesJournal].map(f => f as unknown as { journal: Journal; hash: string });
  const legacy = (legacyJournals as unknown as { cases: { name: string; hash: string; journal: Journal }[] }).cases;
  for (const f of [...fixtures, ...legacy]) {
    const sim = replay(f.journal);
    assert(sim.hash() === f.hash, `${'name' in f ? f.name : f.journal.arena}: recorded ${f.hash}, now ${sim.hash()}`);
  }
});

// ---- «Огненный проход» ----

check('fire: the dash leaves fire; an enemy in it takes 1, then 1 more after the 1 s pause — a credited kill (the kill goal), not a kill of the chain', () => {
  const run = (hammer: HammerId | null) => {
    const sim = fight(hammer, quiet({ killGoal: 4 })), w = sim.world;
    const links = row(sim);
    const events: WorldEvent[] = [];
    dash(sim, links);
    settle(sim, events);
    // After the dash an enemy appears on the burning path (it enters the fire), 2 HP.
    const victim = place(sim, 5.6, 6.1, 2, { color: 1 });
    const out = ticks(sim, Math.round(1.5 / SIM_DT), events);
    return { sim, w, links, victim, events: out };
  };
  const plain = run(null);
  assert(alive(plain.w, plain.victim) && plain.victim.hp === 2 && hitsOf(plain.events, plain.victim).length === 0, 'without the hammer: no fire');
  assert(plain.w.build === undefined && plain.w.stage === 'goals', 'without the hammer: no state, the goal is not done');
  const { sim, w, links, victim, events } = run(HAMMERS.fire);
  assert(hammerEvents(events, 'fire').length === 1, `one fire event a dash (${hammerEvents(events, 'fire').length})`);
  const hits = hitsOf(events, victim);
  assert(hits.length === 2 && hits.every(h => h.damage === 1 && h.source === BUILD_SOURCES.hammerFire), `two burns of 1: ${JSON.stringify(hits)}`);
  const kill = killsOf(events, victim)[0];
  assert(kill?.source === BUILD_SOURCES.hammerFire && kill.credited === true && !alive(w, victim), `the burn kills, credited: ${JSON.stringify(kill)}`);
  assert(w.stats.kills === 4 && w.stage === 'greed', `kills ${w.stats.kills}, the kill goal (4) done by the fire: ${w.stage}`);
  assert(w.lastChain?.kills === 3, `the chain's own kills stay 3 (${w.lastChain?.kills})`);
  assert(w.stats.score === chainScore(w.params, 3) + w.params.scorePerKill, `score: the chain's + a flat kill (${w.stats.score})`);
  assert(links.every(e => !alive(w, e)), 'the chain killed');
  assert(replays(sim), 'replay');
});

check('fire: the pause is 1 s, the fire burns 2 s and leaves the state; the hero standing in it is never hurt', () => {
  const sim = fight(HAMMERS.fire, quiet({ contactDamage: 1 })), w = sim.world;
  const links = row(sim);
  dash(sim, links);
  settle(sim);
  const laid = hammerFirePoints(w);
  assert(laid.length >= 8 && laid.every(p => near(p.y, 6)) && laid.some(p => near(p.x, 4)) && laid.some(p => p.x > 7.2), `points along the path: ${laid.map(p => p.x.toFixed(2)).join(' ')}`);
  // A 3 HP enemy in the fire: burns at once, again after the pause, then the fire is out. One whose centre is just out of
  // every point's radius (its body overlaps the fire) does not burn: the fire reads the centre, as the elite's trail.
  const victim = place(sim, 6.0, 5.9, 3, { color: 2 });
  const beside = place(sim, 5.0, 6 - FIRE_RADIUS - 0.05, 3, { color: 1 });
  const hp = w.hero.hp, burns: number[] = [];
  let tick = 0;
  for (; tick < Math.round(3 / SIM_DT) && w.status === 'playing'; tick++) {
    sim.tick();
    for (const e of w.events) if (e.type === 'enemyHit' && e.enemyId === victim.id) burns.push(tick);
    w.events.length = 0;
  }
  assert(burns.length === 2 && burns[0] === 0, `burns at ticks ${burns.join(',')}`);
  assert(Math.abs((burns[1] - burns[0]) * SIM_DT - FIRE_PAUSE) <= SIM_DT + 1e-9, `the pause ${(burns[1] - burns[0]) * SIM_DT}`);
  assert(victim.hp === 1 && alive(w, victim), `HP ${victim.hp}`);
  assert(beside.hp === 3, `the centre out of the fire: ${beside.hp} HP`);
  assert(w.hero.hp === hp && w.stats.hitsTaken === 0, `the hero in the fire is not hurt (HP ${hp} → ${w.hero.hp})`);
  assert(hammerFirePoints(w).length === 0 && w.build === undefined && !('build' in (worldState(w) as object)), 'the fire is out after 2 s, no state left');
  assert(FIRE_LIFE === 2 && FIRE_PAUSE === 1, 'numbers of the design');
  assert(replays(sim), 'replay');
});

check('fire: a fiery elite does not burn, the reaper is not touched; an ordinary enemy next to them does', () => {
  const sim = fight(HAMMERS.fire), w = sim.world;
  dash(sim, row(sim));
  settle(sim);
  const fiery = place(sim, 5.0, 6.05, 2, { elite: true, affixes: ['fiery'], color: 1 });
  const plain = place(sim, 6.6, 6.05, 2, { color: 1 });
  const reaper = place(sim, 7.0, 6.05, 0, { kind: 'reaper', color: -1 });
  const events = ticks(sim, 30);
  assert(hitsOf(events, reaper).length === 0 && alive(w, reaper), 'the reaper is not touched');
  assert(fiery.affixes?.includes('fiery') && hitsOf(events, fiery).length === 0 && fiery.hp === 4, `fiery elite: ${fiery.hp} HP, hits ${hitsOf(events, fiery).length}`);
  assert(hitsOf(events, plain).length === 1 && plain.hp === 1, `ordinary: ${plain.hp} HP`);
  assert(replays(sim), 'replay');
});

registerArena({
  id: 'hammer-pond', name: 'Пруд (молоты)', summary: 'Тест фазы B', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 1.5, y: 6 }, obstacles: [pond(10, 6, 6.5)], buttons: [], door: { x: 19.3, y: 1 }, enemies: [], killGoal: 999,
});

check('fire: no point falls in water — a dash across the pond leaves fire on both banks only; an enemy in the water does not burn', () => {
  const sim = fight(HAMMERS.fire, quiet(), 21, 'hammer-pond'), w = sim.world;
  sim.command({ t: 'teleport', x: 1.5, y: 6 });
  const links: Enemy[] = [];
  for (let x = 2.7; x < 18.5; x += 1.2) links.push(place(sim, x, 6, 0));
  dash(sim, links);
  const all: FirePoint[] = [];
  for (let i = 0; i < 900 && (w.move || i === 0); i++) {
    sim.tick(); w.events.length = 0;
    for (const p of hammerFirePoints(w)) if (!all.includes(p)) all.push(p);
  }
  assert(links.every(e => !alive(w, e)), 'the chain crossed the pond');
  assert(all.length > 6 && all.every(p => !inWater(p, w.arena)), `${all.filter(p => inWater(p, w.arena)).length} of ${all.length} points in water`);
  assert(all.some(p => p.x < 3.5) && all.some(p => p.x > 16.5), `points on both banks: ${all.map(p => p.x.toFixed(1)).join(' ')}`);
  const wading = place(sim, 10, 6.1, 2, { color: 1 });
  const events = ticks(sim, 30);
  assert(inWater(wading, w.arena) && hitsOf(events, wading).length === 0, 'an enemy in the water on the path does not burn');
  assert(replays(sim), 'replay');
});

// ---- «Взрыв на конце» ----

check('end blast: 1.5 around the last link, 1 to every body it touches — credited (the kill goal), no push; nothing without the hammer', () => {
  const run = (hammer: HammerId | null) => {
    const sim = fight(hammer, quiet({ killGoal: 4 })), w = sim.world;
    const links = row(sim);
    const r = body(sim);
    // Around the last link (7.6, 6): one touched at the edge (2 HP), one weak touched, one just out of reach.
    const edge = place(sim, 7.6, 6 + BLAST_RADIUS + r - 0.05, 2, { color: 1 });
    const weak = place(sim, 7.6 + 1.0, 5.5, 0, { color: 2 });
    const out = place(sim, 7.6 + BLAST_RADIUS + r + 0.1, 6, 0, { color: 3 });
    const at = { x: edge.x, y: edge.y };
    dash(sim, links);
    const events = settle(sim);
    return { sim, w, edge, weak, out, at, events };
  };
  const plain = run(null);
  assert(plain.edge.hp === 2 && alive(plain.w, plain.weak) && hammerEvents(plain.events).length === 0, 'without the hammer: no blast');
  const { sim, w, edge, weak, out, at, events } = run(HAMMERS.blast);
  const blast = hammerEvents(events, 'blast');
  assert(blast.length === 1 && near(blast[0].x, 7.6) && near(blast[0].y, 6) && blast[0].r === BLAST_RADIUS, `one blast at the last link: ${JSON.stringify(blast)}`);
  assert(edge.hp === 1 && alive(w, edge) && near(edge.x, at.x) && near(edge.y, at.y) && edge.knock === 0, `the edge one: 1 HP, not pushed (${edge.hp}, ${edge.x}, ${edge.y})`);
  const kill = killsOf(events, weak)[0];
  assert(kill?.source === BUILD_SOURCES.hammerBlast && kill.credited && !alive(w, weak), `the weak one killed, credited: ${JSON.stringify(kill)}`);
  assert(alive(w, out) && hitsOf(events, out).length === 0, 'out of reach: untouched');
  assert(w.stats.kills === 4 && w.stage === 'greed' && w.lastChain?.kills === 3, `kills ${w.stats.kills}, goal ${w.stage}, chain ${w.lastChain?.kills}`);
  assert(w.hero.hp === w.hero.maxHp, 'the hero is not hurt by his blast');
  assert(replays(sim), 'replay');
});

check('end blast: a surviving last link — the blast is around the survivor (it takes 1 too); a dash ending in the door (victory) — no blast', () => {
  // The survivor is knocked back 0.8 at once: the blast follows it to where it stands at the end of the dash.
  const sim = fight(HAMMERS.blast, quiet({ survivorKnockback: true, survivorKnockbackTime: 0.02 })), w = sim.world;
  // Two weak links, then a 9 HP survivor at 7.6 (knocked to ≈ 8.4): the hero stops at 6.4.
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 0), place(sim, 7.6, 6, 9)];
  const byStop = place(sim, 5.6, 5.1, 0, { color: 1 });
  const bySurvivor = place(sim, 10.2, 6, 0, { color: 2 });
  dash(sim, links);
  const events = settle(sim);
  const blast = hammerEvents(events, 'blast')[0];
  assert(links[2].x > 8.2 && blast && near(blast.x, links[2].x) && near(blast.y, links[2].y), `blast around the knocked survivor (${links[2].x}): ${JSON.stringify(blast)}`);
  assert(links[2].hp === 9 - 3 - 1 && alive(w, links[2]), `the survivor: chain 3 + blast 1 (${links[2].hp})`);
  assert(!alive(w, bySurvivor) && alive(w, byStop), 'the one by the survivor dies, the one by the hero\'s stop does not');
  assert(replays(sim), 'replay');

  // The door: goals done, a chain of a weak link and the open door — the dash wins, no end of the chain, no blast.
  const door = fight(HAMMERS.blast), dw = door.world;
  door.command({ t: 'goals' });
  const d = doorOf(dw);
  door.command({ t: 'teleport', x: d.x, y: d.y + 2.7 });
  const link = place(door, d.x, d.y + 1.5, 0);
  const by = place(door, d.x - 0.7, d.y + 1.9, 0, { color: 1 });
  dash(door, [link, d]);
  const doorEvents = settle(door);
  assert(dw.status === 'victory' && !alive(dw, link), `victory (${dw.status})`);
  assert(alive(dw, by) && hammerEvents(doorEvents).length === 0, 'no blast after the victory');
  assert(replays(door), 'replay');
});

// ---- «Режущий проход» ----

check('cutting pass: any colour within 0.5 of the path (body touch) takes 1 once a dash — not the links, not the reaper; credited, not a chain kill', () => {
  const run = (hammer: HammerId | null) => {
    const sim = fight(hammer, quiet({ killGoal: 5, survivorKnockback: false })), w = sim.world;
    const r = body(sim);
    const links = row(sim);
    const inReach = place(sim, 5.8, 6 - (CUT_RADIUS + r - 0.05), 0, { color: 1 });
    const tough = place(sim, 6.9, 6 + (CUT_RADIUS + r - 0.1), 3, { color: 2 });
    const outReach = place(sim, 6.2, 6 + CUT_RADIUS + r + 0.1, 0, { color: 3 });
    const reaper = place(sim, 4.6, 6.4, 0, { kind: 'reaper', color: -1 });
    const shield = place(sim, 7.0, 5.5, 1, { kind: 'shield', color: 1 });
    dash(sim, links);
    const events = settle(sim);
    return { sim, w, links, inReach, tough, outReach, reaper, shield, events };
  };
  const plain = run(null);
  assert(alive(plain.w, plain.inReach) && plain.tough.hp === 3 && alive(plain.w, plain.shield) && hammerEvents(plain.events).length === 0, 'without the hammer: nobody is cut');
  const { sim, w, links, inReach, tough, outReach, reaper, shield, events } = run(HAMMERS.cut);
  assert(links.every(e => !alive(w, e)) && links.every(e => hitsOf(events, e).length === 0), 'the links die by the chain, never cut');
  const cut = killsOf(events, inReach)[0];
  assert(cut?.source === BUILD_SOURCES.hammerCut && cut.credited, `cut in reach: ${JSON.stringify(cut)}`);
  assert(tough.hp === 2 && hitsOf(events, tough).length === 1, `the tough one cut once (${tough.hp} HP)`);
  assert(alive(w, outReach) && hitsOf(events, outReach).length === 0, 'out of reach: untouched');
  assert(alive(w, reaper) && hitsOf(events, reaper).length === 0, 'the reaper is not cut');
  assert(!alive(w, shield) && killsOf(events, shield)[0]?.source === BUILD_SOURCES.hammerCut, 'the shieldbearer is cut through its shield');
  assert(hammerEvents(events, 'cut').length === 3, `a cut event per enemy cut (${hammerEvents(events, 'cut').length})`);
  assert(w.stats.kills === 5 && w.stage === 'greed' && w.lastChain?.kills === 3, `kills ${w.stats.kills}, goal ${w.stage}, chain ${w.lastChain?.kills}`);
  assert(replays(sim), 'replay');
});

check('cutting pass: the bounce off a survivor does not cut twice; raised quills do not answer; a frozen brittle enemy takes 1, not 2, and stays brittle', () => {
  const sim = fight(HAMMERS.cut, quiet({ porcupineDownTime: 0 }), 13, 'kills', { items: { frost: 1 } }), w = sim.world;
  const r = body(sim);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  // Two weak links and a 9 HP survivor: the hero runs to it and back to 6.4.
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 0), place(sim, 7.6, 6, 9)];
  const between = place(sim, 7.0, 6 + CUT_RADIUS + r - 0.1, 3, { color: 1 });
  const quills = place(sim, 5.8, 6 - (CUT_RADIUS + r - 0.1), 3, { kind: 'porcupine', color: 2 });
  const frozen = place(sim, 4.6, 6 + CUT_RADIUS + r - 0.1, 4, { color: 3 });
  sim.command({ t: 'item', kind: 'frost', x: 4.6, y: 7.2 });
  assert(frozen.brittle === true && (frozen.chill ?? 0) > 0, 'frozen and brittle');
  assert(quills.vars.up === 1, 'quills up');
  const hp = w.hero.hp;
  dash(sim, links);
  const events = settle(sim);
  assert(hitsOf(events, between).length === 1 && between.hp === 2, `cut once over the bounce (${between.hp} HP)`);
  assert(hitsOf(events, quills).length === 1 && quills.hp === 2 && w.hero.hp === hp, `the porcupine cut, the hero untouched (${hp} → ${w.hero.hp})`);
  assert(hitsOf(events, frozen)[0]?.damage === 1 && frozen.hp === 3 && frozen.brittle === true, `frozen: 1 damage, ${frozen.hp} HP, brittle ${frozen.brittle}`);
  assert(replays(sim), 'replay');
});

// ---- «Возврат» ----

check('return: after the dash the hero runs back to the chain start untouchable; power ⌊5 / 2⌋ = 2 is spent on the HP removed; credited', () => {
  const run = (hammer: HammerId | null) => {
    const sim = fight(hammer, quiet({ contactDamage: 1, killGoal: 6 })), w = sim.world;
    const r = body(sim);
    const links = row(sim, [0, 0, 0, 0, 0]);
    // Off the chain, near the way back (reached from the end: 6.6, then 5.4, then 4.5).
    const first = place(sim, 6.6, 6 + RETURN_RADIUS + r - 0.1, 1, { color: 1 });
    const second = place(sim, 5.4, 6 - (RETURN_RADIUS + r - 0.1), 3, { color: 2 });
    const third = place(sim, 4.5, 6 + RETURN_RADIUS + r - 0.1, 0, { color: 3 });
    dash(sim, links);
    const hp = w.hero.hp, events: WorldEvent[] = [];
    let returning = 0, hurtable = 0;
    for (let i = 0; i < 900 && (w.move || i === 0); i++) {
      sim.tick(); events.push(...w.events); w.events.length = 0;
      if (w.move?.kind === 'return') { returning++; if (canBeHurt(w)) hurtable++; }
    }
    return { sim, w, links, first, second, third, events, hp, returning, hurtable };
  };
  const plain = run(null);
  assert(plain.returning === 0 && near(plain.w.hero.x, 10) && plain.first.hp === 1 && plain.second.hp === 3 && alive(plain.w, plain.third), 'without the hammer: the hero stays at the end, nobody is hit');
  const { sim, w, first, second, third, events, hp, returning, hurtable } = run(HAMMERS.return);
  assert(returning > 5 && hurtable === 0 && w.hero.hp === hp, `return ticks ${returning}, hurtable ${hurtable}, HP ${hp} → ${w.hero.hp}`);
  assert(near(w.hero.x, 4) && near(w.hero.y, 6) && w.move === null, `back at the start (${w.hero.x}, ${w.hero.y})`);
  assert(hammerEvents(events, 'return').length === 1 && events.filter(e => e.type === 'chainEnd').length === 1, 'one return event, one chain end');
  assert(killsOf(events, first)[0]?.source === BUILD_SOURCES.hammerReturn && killsOf(events, first)[0]?.credited, 'the first (1 HP) killed with power 2, credited');
  assert(second.hp === 2 && hitsOf(events, second)[0]?.damage === 1, `the second (3 HP) wounded by the power left, 1 (${second.hp} HP)`);
  assert(alive(w, third) && hitsOf(events, third).length === 0, 'the power is spent: the weak third one is not hit');
  assert(w.stats.kills === 6 && w.stage === 'greed' && w.lastChain?.kills === 5, `kills ${w.stats.kills}, goal ${w.stage}, chain ${w.lastChain?.kills}`);
  assert(replays(sim), 'replay');
});

check('return: at least power 1; the way back starts at the hero\'s stop — the bounce off a survivor is folded away (it is not hit again)', () => {
  const sim = fight(HAMMERS.return), w = sim.world;
  const r = body(sim);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  // Two weak links and a 9 HP survivor at 8.4: power at the end 0 → the return hits with 1.
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 0), place(sim, 8.4, 6, 9)];
  const near5 = place(sim, 5.8, 6 + RETURN_RADIUS + r - 0.1, 1, { color: 1 });
  dash(sim, links);
  const events = settle(sim);
  assert(links[2].hp === 9 - 3 && hitsOf(events, links[2]).length === 0, `the survivor is struck by the chain only (${links[2].hp} HP)`);
  assert(!alive(w, near5) && killsOf(events, near5)[0]?.source === BUILD_SOURCES.hammerReturn, 'power 1 kills the 1 HP one on the way back');
  assert(near(w.hero.x, 4) && near(w.hero.y, 6), `back at the start (${w.hero.x}, ${w.hero.y})`);
  assert(w.build === undefined && !('build' in (worldState(w) as object)), 'no state left after the return');
  assert(replays(sim), 'replay');
});

console.log(`realtime-hammers: ${checks} checks passed`);
