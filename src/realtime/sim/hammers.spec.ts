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
import { buildModules, registerBuildModule, setBuildState } from './build';
import { buildHit } from './buildHits';
import { BUILD_SOURCES, HAMMERS, type HammerId } from './buildIds';
import { chainScore, planChain } from './chain';
import { bodyRadiusOf } from './enemies/kinds';
import { dist, inWater, pond } from './geometry';
import { BLAST_RADIUS, CUT_RADIUS, END_BLAST_LEGACY_MIN_LINKS, FIRE_LEGACY_MIN_LINKS, FIRE_LIFE, FIRE_PAUSE, FIRE_RADIUS, RETURN_RADIUS, firePassPreview, hammerFirePoints, type FirePoint } from './hammers';
import { worldState } from './hash';
import { defaultParams, runParams, type Params } from './params';
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

check('fire (task 31, design 15.10.2026): the highlight\'s fire points (`firePassPreview`) before the release are the points the dash lays — none in the pond; a chain short of the threshold and a kit without the hammer show none', () => {
  for (const n of [2, 4, 13]) {
    const sim = fight(HAMMERS.fire, quiet(), 21, 'hammer-pond'), w = sim.world;
    sim.command({ t: 'teleport', x: 1.5, y: 6 });
    const links: Enemy[] = [];
    for (let i = 0; i < n; i++) links.push(place(sim, 2.7 + 1.2 * i, 6, 0));
    sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
    for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
    const before = sim.hash(), shown = firePassPreview(w);
    assert(sim.hash() === before, `${n} links: the preview does not change the world`);
    sim.command({ t: 'release' });
    const all: FirePoint[] = [];
    for (let i = 0; i < 900 && (w.move || i === 0); i++) {
      sim.tick(); w.events.length = 0;
      for (const p of hammerFirePoints(w)) if (!all.includes(p)) all.push(p);
    }
    if (n < 3) { assert(shown.length === 0 && all.length === 0, `${n} links: no fire shown (${shown.length}), none laid (${all.length})`); continue; }
    assert(shown.length === all.length && shown.every(p => all.some(q => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6)),
      `${n} links: shown ${shown.length} ${shown.map(p => p.x.toFixed(2)).join(' ')}, laid ${all.length} ${all.map(p => p.x.toFixed(2)).join(' ')}`);
    if (n === 13) assert(shown.every(p => !inWater(p, w.arena)) && shown.some(p => p.x > 16.5), `${n} links: across the pond, both banks, none in the water`);
    assert(replays(sim), `${n} links: replay`);
  }
  const none = fight(null, quiet(), 21, 'hammer-pond');
  const links = row(none, [0, 0, 0]);
  none.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) none.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(firePassPreview(none.world).length === 0, 'no hammer: no fire shown');
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

  // The door: goals done, a chain of three weak links (the threshold) and the open door — the dash wins, no end of the
  // chain, no blast.
  const door = fight(HAMMERS.blast), dw = door.world;
  door.command({ t: 'goals' });
  const d = doorOf(dw);
  door.command({ t: 'teleport', x: d.x, y: d.y + 4.2 });
  const doorLinks = [place(door, d.x, d.y + 3.3, 0), place(door, d.x, d.y + 2.4, 0), place(door, d.x, d.y + 1.5, 0)];
  const by = place(door, d.x - 0.7, d.y + 1.9, 0, { color: 1 });
  dash(door, [...doorLinks, d]);
  const doorEvents = settle(door);
  assert(dw.status === 'victory' && doorLinks.every(l => !alive(dw, l)), `victory (${dw.status})`);
  assert(alive(dw, by) && hammerEvents(doorEvents).length === 0, 'no blast after the victory');
  assert(replays(door), 'replay');
});

/** Test module: on the first tick of a dash a build hit kills the chain's 2nd enemy link ahead of the hero (a fallen link). */
const CUT_SECOND = 'test-hammers-cut-second';
registerBuildModule({
  id: CUT_SECOND,
  onDashStep: (w, step) => {
    const b = step.move.build;
    if (step.kind !== 'dash' || !b || w.build?.[CUT_SECOND]) return;
    const ahead = step.move.links.filter(l => l.kind === 'enemy');
    const target = ahead[2 - b.links - 1];
    const e = target && w.enemies.find(x => x.id === target.id);
    setBuildState(w, CUT_SECOND, 1);
    if (e) buildHit(w, e, 99, BUILD_SOURCES.hammerCut);
  },
});

check('end blast (decision of the user 11.10.2026): only a chain of 3+ enemy links (`endBlastMinLinks` 3) — 2 links: no blast and no event; 3: the blast; a link fallen ahead counts; the column shows the links up to 3', () => {
  assert(defaultParams().endBlastMinLinks === 3, 'the threshold by default');
  const blastOf = (hps: readonly number[], extra: Loadout = {}) => {
    const sim = fight(HAMMERS.blast, quiet(), 11, 'kills', extra), w = sim.world;
    const links = row(sim, hps);
    const last = links[links.length - 1];
    const near1 = place(sim, last.x + 0.9, last.y + 0.3, 0, { color: 1 });
    dash(sim, links);
    const events = settle(sim);
    assert(replays(sim), 'replay');
    return { w, events, near1, blasts: hammerEvents(events, 'blast') };
  };
  const two = blastOf([0, 0]);
  assert(two.blasts.length === 0 && hammerEvents(two.events).length === 0 && alive(two.w, two.near1), `2 links: no blast (${two.blasts.length})`);
  const three = blastOf([0, 0, 0]);
  assert(three.blasts.length === 1 && !alive(three.w, three.near1), `3 links: the blast (${three.blasts.length})`);
  // The 2nd link dies ahead of the dash (a fallen link, passed): the chain still counts 3.
  const fallen = blastOf([0, 0, 0], { talismans: [CUT_SECOND] });
  const cut = fallen.events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.source === BUILD_SOURCES.hammerCut);
  assert(cut && fallen.blasts.length === 1, `a fallen link counts: cut ${!!cut}, blasts ${fallen.blasts.length}`);
  // The progress of the drawn chain: 2 links — 2 of 3; none drawn — nothing.
  const sim = fight(HAMMERS.blast), w = sim.world, links = row(sim, [0, 0]);
  const module = buildModules().find(m => m.id === HAMMERS.blast)!;
  assert(module.progress!(w) === null, 'no chain — no progress');
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  sim.command({ t: 'drag', x: links[1].x, y: links[1].y, mode: 'full' });
  const p = module.progress!(w);
  assert(p !== null && p.value === 2 && p.max === 3, `progress ${JSON.stringify(p)}`);
});

check('end blast: a journal without `endBlastMinLinks` (recorded before the key, 12.10.2026) plays the old path — a chain of 1 or 2 links blasts; its replay is the fight recorded with the key absent; a run forces 3', () => {
  assert(END_BLAST_LEGACY_MIN_LINKS === 1, 'the old path: any chain with a last link');
  const noKey = (extra: Partial<Params> = {}): Params => { const p = quiet(extra); delete (p as Partial<Params>).endBlastMinLinks; return p; };
  /** The same commands as the threshold check: a row of weak links, one weak enemy of another colour by the last. */
  const blastOf = (params: Params, n: number) => {
    const sim = fight(HAMMERS.blast, params), w = sim.world;
    const links = row(sim, new Array<number>(n).fill(0));
    const last = links[links.length - 1];
    const near1 = place(sim, last.x + 0.9, last.y + 0.3, 0, { color: 1 });
    dash(sim, links);
    const events = settle(sim);
    ticks(sim, 30, events);
    return { sim, w, near1, blasts: hammerEvents(events, 'blast') };
  };
  for (const n of [1, 2]) {
    // Recorded today (the key 3): no blast.
    const today = blastOf(quiet(), n);
    assert(today.blasts.length === 0 && alive(today.w, today.near1), `key 3, ${n} link(s): no blast`);
    // Recorded with the key absent (a build before the key): the blast, and it replays to its hash.
    const old = blastOf(noKey(), n);
    assert(old.blasts.length === 1 && !alive(old.w, old.near1), `no key, ${n} link(s): the blast (${old.blasts.length})`);
    assert(replays(old.sim), `no key, ${n} link(s): replay`);
    // The panel at 1 plays the same world (only the hashed params differ).
    const one = blastOf(quiet({ endBlastMinLinks: 1 }), n);
    const strip = (w: World) => { const { params: _, ...rest } = worldState(w) as Record<string, unknown>; return JSON.stringify(rest); };
    assert(strip(one.w) === strip(old.w), `key 1 and no key: the same world (${n} link(s))`);
    // The journal of today's fight with the key taken out replays the old path: the fight recorded with the key absent.
    const journal = JSON.parse(JSON.stringify(today.sim.exportJournal()!)) as Journal;
    assert(journal.params.endBlastMinLinks === 3, 'the journal keeps the key');
    delete (journal.params as Partial<Params>).endBlastMinLinks;
    const again = replay(journal);
    assert(again.hash() === old.sim.hash() && again.hash() !== today.sim.hash(), `no key, ${n} link(s): the replay hash is the old fight's`);
    assert(!again.world.enemies.some(e => e.id === today.near1.id), `no key, ${n} link(s): the replay blasts`);
  }
  // The progress of a drawn chain of one link without the key: 1 of 1.
  const sim = fight(HAMMERS.blast, noKey()), w = sim.world, links = row(sim, [0]);
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  const p = buildModules().find(m => m.id === HAMMERS.blast)!.progress!(w);
  assert(p !== null && p.value === 1 && p.max === 1, `progress without the key ${JSON.stringify(p)}`);
  // A run plays the threshold of the user's decision whatever the saved panel holds.
  const panel = defaultParams(); panel.endBlastMinLinks = 1;
  assert(runParams(panel).endBlastMinLinks === 3, 'a run forces 3');
});

// ---- «Огненный проход» от трёх звеньев (task 31, decision of the user 15.10.2026) ----

/**
 * One dash of a fire hammer through `links` (drawn by commands): the highlight's fire before the release, then every tick until
 * the hero stands and 30 more — the fire points seen on each tick, the tick of the fire event and its `flare`, the tick the
 * dash reached each link (`chainHit`).
 */
function fireDash(sim: Simulation, links: readonly Enemy[]) {
  const w = sim.world;
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
  assert(w.chain.length === links.length, `chain drawn: ${w.chain.length} of ${links.length}`);
  return fireRelease(sim);
}
/** Releases the drawn chain of a fire hammer (`fireDash`). */
function fireRelease(sim: Simulation) {
  const w = sim.world;
  const plan = planChain(w).fire;
  sim.command({ t: 'release' });
  const events: WorldEvent[] = [], seen: FirePoint[][] = [], hitTick = new Map<number, number>();
  let fireTick = -1, tick = 0;
  for (let after = 0; after < 30 && tick < 2000 && w.status === 'playing'; tick++) {
    sim.tick();
    for (const e of w.events) {
      if (e.type === 'chainHit' && !hitTick.has(e.enemyId)) hitTick.set(e.enemyId, tick);
      if (e.type === 'hammer' && e.kind === 'fire' && fireTick < 0) fireTick = tick;
    }
    events.push(...w.events); w.events.length = 0;
    seen.push(hammerFirePoints(w).map(p => ({ ...p })));
    if (!w.move) after++;
  }
  return { plan, events, seen, hitTick, fireTick, fire: hammerEvents(events, 'fire') };
}

check('fire (task 31, `fireMinLinks` 3): a chain of 1 or 2 enemy links — not one point of fire, no event; 3 — the whole path from the start lights at once when the dash reaches the 3rd; the highlight before the release says the same', () => {
  assert(defaultParams().fireMinLinks === 3, 'the threshold by default');
  for (const n of [1, 2, 3, 4]) {
    const sim = fight(HAMMERS.fire), w = sim.world;
    const links = row(sim, new Array<number>(n).fill(0));
    // Off the chain by the start of the path: 1 HP of another colour — the fire of the whole path finds it, or nothing does.
    const byStart = place(sim, 4.5, 6.1, 1, { color: 1 });
    const { plan, events, seen, hitTick, fireTick, fire } = fireDash(sim, links);
    assert(plan !== undefined && plan.need === 3 && plan.links === n && plan.lit === (n >= 3), `${n} link(s): the highlight ${JSON.stringify(plan)}`);
    if (n < 3) {
      assert(seen.every(s => s.length === 0) && fire.length === 0, `${n} link(s): no fire (${Math.max(...seen.map(s => s.length))} points, ${fire.length} events)`);
      assert(alive(w, byStart) && byStart.hp === 1 && hitsOf(events, byStart).length === 0, `${n} link(s): nothing burns`);
      assert(w.build === undefined && !('build' in (worldState(w) as object)), `${n} link(s): no state left`);
    } else {
      const third = hitTick.get(links[2].id)!;
      assert(fire.length === 1 && fireTick === third, `${n} links: one fire event, in the tick the dash reached the 3rd link (${fireTick} / ${third})`);
      assert(seen.slice(0, third).every(s => s.length === 0), `${n} links: no fire before the 3rd link`);
      const lit = seen[third];
      assert(lit.length >= 8 && lit.every(p => p.life === lit[0].life && p.life >= FIRE_LIFE - SIM_DT - 1e-9) && lit.some(p => near(p.x, 4) && near(p.y, 6)) && lit.some(p => p.x > 7.2), `${n} links: the whole path from the start at once: ${lit.map(p => p.x.toFixed(2)).join(' ')}`);
      assert(fire[0].flare?.length === lit.length && near(fire[0].x, 4) && near(fire[0].y, 6), `${n} links: the event at the start with the lit points (${fire[0].flare?.length} / ${lit.length})`);
      assert(!alive(w, byStart) && killsOf(events, byStart)[0]?.source === BUILD_SOURCES.hammerFire, `${n} links: the fire by the start burns`);
      if (n === 4) assert(seen.flat().some(p => p.x > 8.6), 'the rest of the dash lays fire as before');
    }
    assert(replays(sim), `${n} link(s): replay`);
  }
});

check('fire (task 31): the survivor at the end and a link fallen ahead count as the end blast\'s; the highlight before the release equals the dash; the column shows the links up to 3', () => {
  // 0, 0, then a 9 HP survivor: 3 links reached — the path lights.
  const sim = fight(HAMMERS.fire), w = sim.world;
  const links = row(sim, [0, 0, 9]);
  const survivor = fireDash(sim, links);
  assert(survivor.plan?.lit === true && survivor.plan.links === 3 && alive(w, links[2]), `the survivor counts: ${JSON.stringify(survivor.plan)}`);
  assert(survivor.fire.length === 1 && survivor.fireTick === survivor.hitTick.get(links[2].id), 'lit when the survivor is struck');
  assert(replays(sim), 'replay');
  // The 2nd link dies ahead of the dash (a fallen link the dash passes): the chain still reaches 3.
  const cut = fight(HAMMERS.fire, quiet(), 11, 'kills', { talismans: [CUT_SECOND] });
  const fallen = fireDash(cut, row(cut, [0, 0, 0]));
  assert(fallen.events.some(e => e.type === 'kill' && e.source === BUILD_SOURCES.hammerCut), 'the 2nd link fell ahead');
  assert(fallen.plan?.lit === true && fallen.fire.length === 1 && fallen.seen.some(s => s.length > 0), 'a fallen link counts');
  assert(replays(cut), 'replay');
  // The progress of the drawn chain: 2 links — 2 of 3; none — nothing.
  const col = fight(HAMMERS.fire), cw = col.world, two = row(col, [0, 0]);
  const module = buildModules().find(m => m.id === HAMMERS.fire)!;
  assert(module.progress!(cw) === null, 'no chain — no progress');
  col.command({ t: 'begin', x: two[0].x, y: two[0].y });
  col.command({ t: 'drag', x: two[1].x, y: two[1].y, mode: 'full' });
  const p = module.progress!(cw);
  assert(p !== null && p.value === 2 && p.max === 3, `progress ${JSON.stringify(p)}`);
});

check('fire (task 31): on arenas of several seeds the highlight of every chain says whether the path lights, and the dash does exactly that', () => {
  const outcomes = new Set<string>();
  for (let k = 1; k <= 6; k++) {
    const seed = Math.imul(k, 2654435761) >>> 0;
    // The arena's own newcomers (they stand): 10 s to fill it, then chains of 1–4 links drawn by commands.
    const params = defaultParams();
    params.maxEnemies = 30; params.enemySpeed = 0; params.speedSpread = 0; params.contactDamage = 0; params.hitstop = false; params.survivorKnockback = false;
    const sim = new Simulation({ arena: 'kills', params, seed, record: true, loadout: { talismans: [], hammer: HAMMERS.fire } });
    const w = sim.world;
    ticks(sim, 600);
    for (let chain = 0; chain < 6 && w.status === 'playing' && w.enemies.length; chain++) {
      // Up to `want` links (1–4): the nearest enemy, then the nearest one the chain takes.
      const want = 1 + ((k + chain) % 4);
      // The fire of the chain before goes out first: the points seen after the release are this dash's.
      for (let i = 0; i < 300 && hammerFirePoints(w).length && w.status === 'playing'; i++) sim.tick();
      w.events.length = 0;
      if (w.status !== 'playing' || !w.enemies.length) break;
      const byDist = (from: { x: number; y: number }) => [...w.enemies].sort((a, b) => dist(a, from) - dist(b, from) || a.id - b.id);
      sim.command({ t: 'teleport', x: byDist(w.hero)[0].x + 0.9, y: byDist(w.hero)[0].y });
      sim.command({ t: 'begin', x: byDist(w.hero)[0].x, y: byDist(w.hero)[0].y });
      if (!w.chain.length) continue;
      for (let i = 1; i < want; i++) {
        const last = w.enemies.find(e => e.id === w.chain[w.chain.length - 1].id);
        if (!last) break;
        for (const e of byDist(last)) {
          if (w.chain.some(l => l.id === e.id)) continue;
          const before = w.chain.length;
          sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
          if (w.chain.length > before) break;
        }
      }
      const { plan, seen, fire } = fireRelease(sim);
      const lit = fire.length > 0;
      assert(plan !== undefined && plan.lit === lit && lit === seen.some(s => s.length > 0), `seed ${seed}, chain ${chain}: the highlight ${JSON.stringify(plan)}, the dash lit ${lit}`);
      outcomes.add(`${plan.links}:${lit}`);
    }
    assert(replays(sim), `seed ${seed}: replay`);
  }
  assert([...outcomes].some(o => o.endsWith('true')) && [...outcomes].some(o => o.endsWith('false')), `lit and unlit chains both met: ${[...outcomes].join(' ')}`);
});

check('fire (task 31): a journal without `fireMinLinks` (recorded before the key) plays the old path — fire from the release on a chain of 1 link; its replay is the fight recorded with the key absent; a run forces 3', () => {
  assert(FIRE_LEGACY_MIN_LINKS === 0, 'the old path: no threshold');
  const noKey = (): Params => { const p = quiet(); delete (p as Partial<Params>).fireMinLinks; return p; };
  const fireOf = (params: Params) => {
    const sim = fight(HAMMERS.fire, params);
    const out = fireDash(sim, row(sim, [0]));
    return { sim, ...out };
  };
  const today = fireOf(quiet());
  assert(today.fire.length === 0 && today.seen.every(s => s.length === 0), 'key 3, 1 link: no fire');
  const old = fireOf(noKey());
  assert(old.plan?.lit === true && old.plan.need === 0, `no key: the highlight lights (${JSON.stringify(old.plan)})`);
  assert(old.fire.length === 1 && old.seen[0].length > 0 && old.fire[0].flare === undefined, 'no key: fire from the first tick of the dash, the old event');
  assert(replays(old.sim), 'no key: replay');
  const journal = JSON.parse(JSON.stringify(today.sim.exportJournal()!)) as Journal;
  assert(journal.params.fireMinLinks === 3, 'the journal keeps the key');
  delete (journal.params as Partial<Params>).fireMinLinks;
  const again = replay(journal);
  assert(again.hash() === old.sim.hash() && again.hash() !== today.sim.hash(), 'no key: the replay hash is the old fight\'s');
  // The column: nothing on the old path.
  const sim = fight(HAMMERS.fire, noKey()), links = row(sim, [0]);
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  assert(buildModules().find(m => m.id === HAMMERS.fire)!.progress!(sim.world) === null, 'no key: no progress');
  const panel = defaultParams(); panel.fireMinLinks = 1;
  assert(runParams(panel).fireMinLinks === 3, 'a run forces 3');
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
