/**
 * Package «Урон имеет значение» (docs/realtime-damage.md; docs/realtime-design-research.md, sections 4.3 and 10; user
 * decision 11.10.2026): elite armour, tough enemies 3–4 HP, the raised touch. Node only: `npm run test:realtime-elite-armor`.
 *
 * Every check plays journalled commands (place, begin / drag, release, item, spin, chill, param, goals …) and looks at what
 * the player meets:
 * - a plated elite in the middle of a chain loses one plate, the chain goes on through it (the links after it die); the
 *   highlight's outcome of every link is the dash's;
 * - the bomb takes 2 plates, the spin, a burning tick, a sapper's blast, the seal of the loop — 1 each; the end blast of the
 *   hammer — 1, however it touches the elite;
 * - 0 plates — the window: the elite stands and does not touch; a kill in its first second — +1 energy, the loot ×2
 *   (later — the plain loot; design answer 11.10.2026); the loot always
 *   drops; after the window 1 plate at once, +1 every 4 s; the cold stops the regrowth;
 * - the elite's touch: 2 (no elite bonus on top) and the hero knocked back 1;
 * - tough newcomers 1–3 / 1–4 HP by the table (the sandbox slider, the run by its row); with the raised touch HP ≥ 2 at the
 *   moment of the touch hurts 2, HP 0–1 — 1;
 * - the run turns the package on; from its row 3 one guaranteed elite in the first 10 s of an ordinary battle; caps 1 / 2;
 * - off by default: a journal without the new values plays the same fight to the bit; every fight replays to its hash.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain, type StrikeOutcome } from './chain';
import { BUILD_SOURCES, HAMMERS } from './buildIds';
import { CLEAN_BREAK_LOOT, ARMOR_RESOURCES, ELITE_DOWN_HITSTOP } from './elites';
import { BLAST_RADIUS } from './hammers';
import { worldState } from './hash';
import { defaultParams, sanitizeParams, type Params } from './params';
import { Simulation, SIM_DT, replay } from './simulation';
import type { Loadout } from './kit';
import { focusGuarded, touchDistanceOf, type Enemy, type World, type WorldEvent } from './world';
import { createRtRun, rtArenaLoadout, rtElitePlates, rtMapNodes, rtRunParams, rtToughHp, type RtBattleKind, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

registerArena({
  id: 'armor-field', name: 'Поле брони', summary: 'Тест брони элит', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});
registerArena({
  id: 'armor-open', name: 'Поле новичков', summary: 'Тест брони элит', goal: 'kills', width: 16, height: 10,
  heroStart: { x: 8, y: 5 }, obstacles: [], buttons: [], door: { x: 15.3, y: 5 }, enemies: [], killGoal: 9999,
});

/** A quiet fight with armour on: no newcomers, nobody walks or touches, no hit-stop, no survivor knockback. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.eliteArmor = true;
  return Object.assign(p, extra);
}
/** Harmless params: the hero cannot fall, the fight runs on (newcomers come). */
function harmless(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.contactDamage = 0; p.heroHp = 999; p.archerDamage = 0; p.sapperDamage = 0; p.boarDamage = 0; p.eliteDamageBonus = 0;
  p.porcupineQuills = 0; p.lynxDamage = 0;
  return Object.assign(p, extra);
}
function field(params: Params = quiet(), loadout?: Loadout, k = 1): Simulation {
  const sim = new Simulation({ arena: 'armor-field', params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, extra: { elite?: boolean; kind?: string; color?: number; affixes?: string[] } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true } : {}, ...extra.affixes ? { affixes: extra.affixes } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Draws the chain through `points` (a press, then drags). */
function draw(sim: Simulation, points: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
/** Ticks until the hero stands again (the dash over), collecting the events. */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const alive = (w: World, e: Enemy): boolean => w.enemies.includes(e);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const plates = (e: Enemy): number => e.armor?.plates ?? -1;
const strips = (events: readonly WorldEvent[], e: Enemy): Ev<'elitePlates'>[] => of(events, 'elitePlates').filter(x => x.enemyId === e.id && x.action === 'strip');
const tick = (seconds: number): number => Math.round(seconds / SIM_DT);

check('a plated elite in the middle of a chain loses one plate; the chain goes on, the links after it die; the highlight is the dash', () => {
  const sim = field(), w = sim.world;
  const a = place(sim, 6, 5, 0), elite = place(sim, 7.5, 5, 0, { elite: true }), b = place(sim, 9, 5, 0), c = place(sim, 10.5, 5, 1);
  assert(elite.armor?.plates === 3 && elite.armor.max === 3 && elite.hp === 0, `the sandbox elite: 3 plates, its kind's HP 0 (${JSON.stringify(elite.armor)}, ${elite.hp})`);
  draw(sim, [a, elite, b, c]);
  assert(w.chain.length === 4, `the chain takes the links after the elite: ${w.chain.length}`);
  const plan = planChain(w);
  assert(!plan.endsOnSurvivor && plan.kills === 3, `the plan: no survivor, 3 kills (${plan.endsOnSurvivor}, ${plan.kills})`);
  const planned = plan.links.map(l => l.outcome as StrikeOutcome);
  assert(planned[1].plate === true && planned[1].platesAfter === 2 && !planned[1].killed && planned[1].damage === 0, `the highlight shows «−1 пластина»: ${JSON.stringify(planned[1])}`);
  assert(planned[1].powerAfter === 1 && planned[3].available === 3, `the elite gives +1 and takes 1: ${planned[1].powerAfter}, last ${planned[3].available}`);
  sim.command({ t: 'release' });
  const events = settle(sim);
  const hits = of(events, 'chainHit');
  assert(hits.length === 4, `four hits: ${hits.length}`);
  for (let i = 0; i < 4; i++) {
    const o = planned[i], h = hits[i];
    assert(h.damage === o.damage && h.killed === o.killed && h.plates === o.platesAfter, `link ${i}: the dash ${JSON.stringify(h)} = the plan ${JSON.stringify(o)}`);
  }
  assert(!alive(w, a) && !alive(w, b) && !alive(w, c) && alive(w, elite) && plates(elite) === 2 && elite.hp === 0, 'the links after the elite died, the elite lost one plate');
  assert(w.lastChain?.kills === 3 && strips(events, elite).length === 1 && strips(events, elite)[0].source === 'chain', 'one strip by the chain');
  assert(near(w.hero.x, c.x) && near(w.hero.y, c.y), `the hero stands on the last kill (${w.hero.x}, ${w.hero.y})`);
  assert(replays(sim), 'replay');
});

check('a chain ending on a plated elite: no survivor, the hero runs back to the last kill; without armour the old elite (HP ×2)', () => {
  const sim = field(), w = sim.world;
  const a = place(sim, 6, 5, 0), elite = place(sim, 7.5, 5, 2, { elite: true });
  draw(sim, [a, elite]);
  assert(!planChain(w).endsOnSurvivor, 'not a survivor');
  sim.command({ t: 'release' });
  settle(sim);
  assert(alive(w, elite) && plates(elite) === 2 && elite.hp === 2 && near(w.hero.x, a.x) && near(w.hero.y, a.y), `back on the kill (${w.hero.x}), the elite 2 plates, HP 2`);
  assert(replays(sim), 'replay');
  const old = field(quiet({ eliteArmor: false }));
  const oldElite = place(old, 7.5, 5, 2, { elite: true });
  assert(oldElite.hp === 4 && oldElite.armor === undefined, `armour off: HP ×2, no plates (${oldElite.hp})`);
});

check('the bomb takes 2 plates, the spin 1, a burning tick 1; the rest of the hit is lost on the plates', () => {
  const sim = field(quiet(), { items: { bomb: 1, fire: 1 } });
  const elite = place(sim, 7, 5, 2, { elite: true });
  sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
  let events = ticks(sim, 1);
  assert(plates(elite) === 1 && elite.hp === 2 && strips(events, elite)[0]?.removed === 2 && strips(events, elite)[0].source === 'bomb', `bomb: 3 → 1 plates, HP kept (${plates(elite)}, ${elite.hp})`);
  assert(of(events, 'enemyHit').length === 0, 'no HP hit');
  const spinner = field(quiet({ elitePlates: 3 })), sw = spinner.world;
  const e2 = place(spinner, 5.5, 5, 1, { elite: true });
  spinner.command({ t: 'energy', value: 7 });
  spinner.command({ t: 'spin' });
  events = ticks(spinner, 1);
  assert(plates(e2) === 2 && e2.hp === 1 && strips(events, e2).length === 1, `spin: 3 → 2 (${plates(e2)})`);
  assert(sw.energy === 7 - sw.params.spinCost, 'the spin paid');
  const burner = field(quiet(), { items: { fire: 1 } });
  const e3 = place(burner, 7, 5, 1, { elite: true });
  burner.command({ t: 'item', kind: 'fire', x: e3.x, y: e3.y });
  events = ticks(burner, tick(burner.world.params.fireInterval) + 2);
  assert(plates(e3) === 2 && e3.hp === 1 && strips(events, e3).length === 1 && strips(events, e3)[0].source === 'fire', `one burning tick: 3 → 2 (${plates(e3)})`);
  assert(replays(sim) && replays(spinner) && replays(burner), 'replays');
});

check('0 plates — the window: the elite stands and does not touch; after it 1 plate, the touch hurts 2 (no bonus) and knocks the hero 1 back', () => {
  const p = quiet({ elitePlates: 2, contactDamage: 1, enemySpeed: 1.5 });
  const sim = field(p, { items: { bomb: 1 } }), w = sim.world;
  const d = touchDistanceOf(p, { kind: 'basic' } as Enemy);
  const elite = place(sim, 4.5 + d - 0.02, 5, 1, { elite: true });
  sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
  const at = { x: elite.x, y: elite.y };
  let events = ticks(sim, 1);
  assert(plates(elite) === 0 && elite.armor?.open !== undefined && of(events, 'elitePlates').some(e => e.action === 'open'), 'the window opens');
  events = ticks(sim, tick(p.eliteWindow) - 3, events);
  assert(of(events, 'hit').length === 0 && w.hero.hp === 40, `no touch in the window (hits ${of(events, 'hit').length})`);
  // The hero's body may part it by a hair; walking at 1.5 for 3 s would take it 4.5 away.
  assert(near(elite.x, at.x, 0.05) && near(elite.y, at.y, 0.05), `it stands (${elite.x}, ${elite.y})`);
  events = ticks(sim, 10);
  const close = of(events, 'elitePlates').find(e => e.action === 'close');
  assert(close && close.plates === 1 && plates(elite) === 1, 'the window ends with 1 plate');
  const hit = of(events, 'hit')[0];
  assert(hit && hit.damage === 2 && hit.enemyId === elite.id && (w.hero.hp as number) === 38, `the touch: 2 (${JSON.stringify(hit)})`);
  events = ticks(sim, 15, events);
  assert(w.hero.x < 4.5 - 0.9, `knocked back about 1 (${w.hero.x})`);
  assert(replays(sim), 'replay');
});

check('a kill in the window: +1 energy and the loot ×2 (one open consumable each, or 2 resources each); the loot always drops', () => {
  for (const [open, want] of [[['frost'], CLEAN_BREAK_LOOT], [[], CLEAN_BREAK_LOOT * ARMOR_RESOURCES]] as const) {
    for (let k = 1; k <= 3; k++) {
      const sim = field(quiet({ elitePlates: 1, energyPerKill: 0 }), { openItems: [...open], items: { bomb: 1 } }, k), w = sim.world;
      const elite = place(sim, 6, 5, 0, { elite: true });
      sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
      ticks(sim, 1);
      assert(plates(elite) === 0 && elite.armor?.open, 'open');
      const energy = w.energy;
      draw(sim, [elite]);
      sim.command({ t: 'release' });
      const events = settle(sim);
      const down = of(events, 'eliteDown')[0];
      assert(!alive(w, elite) && down?.clean && down.credited, `a clean break: ${JSON.stringify(down)}`);
      assert(w.energy === energy + 1, `+1 energy: ${energy} → ${w.energy}`);
      const loot = of(events, 'loot').filter(l => !l.picked);
      assert(loot.length === want && (open.length ? loot.every(l => l.loot === 'frost') : loot.every(l => !['frost', 'bomb', 'healing', 'fire'].includes(l.loot))), `seed ${k}: loot ${loot.map(l => l.loot).join(',')}`);
      assert(replays(sim), 'replay');
    }
  }
});

check('a kill later than the first second of the window (design answer 11.10.2026, variant 3): the plain loot, no energy; the clean second is a param', () => {
  for (const [wait, clean] of [[0.5, true], [1.5, false]] as const) {
    const sim = field(quiet({ elitePlates: 1, energyPerKill: 0 }), { openItems: ['frost'], items: { bomb: 1 } }, 7), w = sim.world;
    const elite = place(sim, 6, 5, 0, { elite: true });
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    ticks(sim, tick(wait));
    assert(plates(elite) === 0 && elite.armor?.open, 'still open');
    assert(clean ? (elite.armor?.clean ?? 0) > 0 : elite.armor?.clean === undefined, `the clean second ${clean ? 'runs' : 'is over'}`);
    const energy = w.energy;
    draw(sim, [elite]);
    sim.command({ t: 'release' });
    const events = settle(sim);
    const down = of(events, 'eliteDown')[0];
    const loot = of(events, 'loot').filter(l => !l.picked);
    assert(!alive(w, elite) && down?.inWindow && down.clean === clean, `wait ${wait}: ${JSON.stringify(down)}`);
    assert(w.energy === energy + (clean ? 1 : 0) && loot.length === (clean ? 2 : 1), `wait ${wait}: energy ${energy} → ${w.energy}, loot ${loot.length}`);
    assert(replays(sim), 'replay');
  }
  // The param: 0 — no clean break at all.
  const none = field(quiet({ elitePlates: 1, eliteCleanWindow: 0 }), { items: { bomb: 1 } }, 8);
  const e = place(none, 6, 5, 0, { elite: true });
  none.command({ t: 'item', kind: 'bomb', x: e.x, y: e.y });
  ticks(none, 1);
  assert(e.armor?.open && e.armor.clean === undefined, 'no clean second');
});

check('the death of an armoured elite: the hit-stop 0.08 s with the toggle, none without it', () => {
  for (const hitstop of [true, false]) {
    const sim = field(quiet({ elitePlates: 1, hitstop }), { items: { bomb: 1 } }), w = sim.world;
    const elite = place(sim, 6, 5, 0, { elite: true });
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    ticks(sim, 1);
    draw(sim, [elite]);
    sim.command({ t: 'release' });
    let peak = 0;
    for (let i = 0; i < 120 && alive(w, elite); i++) { sim.tick(); peak = Math.max(peak, w.hitstop); w.events.length = 0; }
    assert(!alive(w, elite) && (hitstop ? peak >= ELITE_DOWN_HITSTOP - SIM_DT - 1e-9 : peak === 0), `hit-stop ${hitstop}: ${peak}`);
  }
});

check('the regrowth: 1 plate at the end of the window, +1 every 4 s up to the maximum; the cold stops it', () => {
  const run = (cold: boolean) => {
    const sim = field(quiet({ elitePlates: 3 }), { items: { bomb: 2 } }), w = sim.world;
    const elite = place(sim, 7, 5, 1, { elite: true });
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    sim.command({ t: 'item', kind: 'bomb', x: elite.x, y: elite.y });
    const events: WorldEvent[] = [];
    const times: Record<string, number[]> = { open: [], close: [], regrow: [] };
    for (let i = 0; i < tick(20); i++) {
      sim.tick();
      for (const e of w.events) if (e.type === 'elitePlates' && e.action !== 'strip') times[e.action].push(w.time);
      events.push(...w.events); w.events.length = 0;
      if (cold && times.close.length === 1 && w.time - times.close[0] < SIM_DT / 2) sim.command({ t: 'chill', id: elite.id, seconds: 6 });
    }
    return { sim, elite, times, events };
  };
  const plain = run(false);
  assert(plain.times.open.length === 1 && plain.times.close.length === 1 && plain.times.regrow.length === 2, `events ${JSON.stringify(plain.times)}`);
  const w0 = plain.times.open[0];
  assert(Math.abs(plain.times.close[0] - w0 - 3) <= 2 * SIM_DT, `the window 3 s: ${plain.times.close[0] - w0}`);
  assert(Math.abs(plain.times.regrow[0] - plain.times.close[0] - 4) <= 2 * SIM_DT && Math.abs(plain.times.regrow[1] - plain.times.regrow[0] - 4) <= 2 * SIM_DT, `+1 every 4 s: ${plain.times.regrow}`);
  assert(plates(plain.elite) === 3 && plain.elite.armor?.regrow === undefined, 'stops at the maximum');
  const cold = run(true);
  assert(cold.times.regrow.length >= 1 && Math.abs(cold.times.regrow[0] - cold.times.close[0] - 10) <= 3 * SIM_DT, `the cold holds the regrowth 6 s: ${cold.times.regrow[0] - cold.times.close[0]}`);
  assert(replays(plain.sim) && replays(cold.sim), 'replays');
});

check('the end blast of the hammer takes one plate however it touches; a sapper\'s blast one; the loop\'s seal one, in the window the HP', () => {
  const sim = field(quiet(), { talismans: [], hammer: HAMMERS.blast });
  const links = [place(sim, 6, 5, 0), place(sim, 7.5, 5, 0), place(sim, 9, 5, 0)];
  // Inside the blast, close to the last link: touched by its circle (and it would be by every overlapping path).
  const elite = place(sim, 9.6, 5.3, 2, { elite: true, color: 1 });
  draw(sim, links);
  sim.command({ t: 'release' });
  const events = settle(sim);
  const blast = of(events, 'hammer').filter(h => h.kind === 'blast');
  assert(blast.length === 1 && blast[0].r === BLAST_RADIUS, 'one blast');
  const s = strips(events, elite);
  assert(s.length === 1 && s[0].removed === 1 && s[0].source === BUILD_SOURCES.hammerBlast && plates(elite) === 2 && elite.hp === 2, `one plate by the blast: ${JSON.stringify(s)}`);
  assert(replays(sim), 'replay');

  const sap = field(quiet({ sapperFuse: 0.2 })), sw = sap.world;
  const sapper = place(sap, 6, 5, 0, { kind: 'sapper' });
  const e2 = place(sap, 6.8, 5.4, 1, { elite: true, color: 1 });
  draw(sap, [sapper]);
  sap.command({ t: 'release' });
  const ev2 = ticks(sap, 60);
  assert(of(ev2, 'blast').length === 1 && strips(ev2, e2).length === 1 && plates(e2) === 2 && e2.hp === 1, `the sapper's blast: one plate (${plates(e2)})`);
  assert(sw.status === 'playing' && replays(sap), 'replay');

  const loop = field(quiet({ loopEnabled: true, elitePlates: 1 })), lw = loop.world;
  const square = [{ x: 6, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 6 }, { x: 6, y: 6 }];
  for (const p of square) place(loop, p.x, p.y, 0);
  const inside = place(loop, 7, 5, 3, { elite: true, color: 1 });
  draw(loop, [...square, square[0]]);
  assert(lw.chainClosed === 'first', 'the loop closed');
  loop.command({ t: 'release' });
  const ev3 = settle(loop);
  assert(strips(ev3, inside).length === 1 && plates(inside) === 0 && inside.hp === 3 && inside.armor?.open, `the seal: one plate, the window opens (${plates(inside)}, ${inside.hp})`);
  assert(replays(loop), 'replay');
  // A second ring in the window: the seal hits its HP (⌊(4 − 2) ÷ 2⌋ = 1) like the chain would.
  for (const p of square) place(loop, p.x, p.y, 0);
  loop.command({ t: 'teleport', x: 4.5, y: 5 });
  draw(loop, [...square, square[0]]);
  loop.command({ t: 'release' });
  const ev4 = settle(loop);
  const hit = of(ev4, 'enemyHit').find(h => h.enemyId === inside.id);
  assert(hit?.damage === 1 && (inside.hp as number) === 2 && strips(ev4, inside).length === 0, `the seal in the window: −1 HP (${JSON.stringify(hit)})`);
  assert(replays(loop), 'replay');
});

check('two firings of one source in one tick take a plate each: two archers\' line arrows; two spins (review 11.10.2026)', () => {
  const s1 = field(quiet({ archerPoint: false, archerHit: 1, archerDamage: 0, elitePlates: 4, archerFirstDelay: 1 } as Partial<Params>));
  place(s1, 10, 4.8, 0, { kind: 'archer', color: 1 }); place(s1, 10, 5.2, 0, { kind: 'archer', color: 2 });
  const target = place(s1, 7.2, 5, 1, { elite: true, color: 3 });
  const ev1 = ticks(s1, 240);
  const arrowTicks = new Map<number, number>();
  let tickNo = 0;
  for (const e of ev1) if (e.type === 'elitePlates' && e.action === 'strip' && e.source === 'arrow') arrowTicks.set(tickNo++, e.plates);
  assert(strips(ev1, target).filter(e => e.source === 'arrow').length >= 2 && plates(target) <= 2, `both arrows took a plate (${plates(target)} left)`);
  assert(replays(s1), 'replay');
  const s2 = field(quiet({ elitePlates: 1, spinCost: 3 }), { items: { bomb: 3 } });
  const opens = [place(s2, 5.5, 5, 0, { elite: true }), place(s2, 4.5, 6, 0, { elite: true }), place(s2, 3.5, 5, 0, { elite: true })];
  for (const o of opens) s2.command({ t: 'item', kind: 'bomb', x: o.x, y: o.y });
  ticks(s2, 1);
  s2.command({ t: 'param', key: 'elitePlates', value: 3 });
  const b = place(s2, 4.5, 4, 0, { elite: true });
  assert(plates(b) === 3, 'a 3-plate elite');
  s2.command({ t: 'energy', value: 7 });
  s2.command({ t: 'spin' });
  s2.command({ t: 'spin' });
  assert(plates(b) === 1, `two spins in one tick: 3 → 1 (${plates(b)})`);
  assert(replays(s2), 'replay');
});

check('the highlight released is what the dash does: the window of an elite the dash heads for waits for it (review 11.10.2026)', () => {
  const sim = field(quiet({ elitePlates: 1, eliteWindow: 3 }), { items: { bomb: 1 } });
  const links = [6, 7.5, 9, 10.5, 12, 13.5].map(x => place(sim, x, 5, 0));
  const el = place(sim, 15, 5, 0, { elite: true });
  // The bomb's throw reaches it from nearby; the hero goes back to the start of the chain.
  sim.command({ t: 'teleport', x: 12, y: 6.5 });
  assert(sim.command({ t: 'item', kind: 'bomb', x: el.x, y: el.y }) === true, 'the bomb is thrown');
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  ticks(sim, 1);
  for (let i = 0; i < 400 && (el.armor!.open ?? 0) > 0.3; i++) ticks(sim, 1);
  assert((el.armor!.open ?? 0) > 0, 'the window still open');
  draw(sim, [...links, el]);
  const plan = planChain(sim.world), o = plan.links[plan.links.length - 1].outcome!;
  assert(o.killed && !o.plate, `the plan: killed in the window (${plan.links.length} links, ${JSON.stringify(o)}, open ${el.armor?.open})`);
  sim.command({ t: 'release' });
  const events = settle(sim);
  const hit = of(events, 'chainHit').find(e => e.enemyId === el.id);
  assert(hit && hit.killed && hit.plates === undefined && !alive(sim.world, el), `the dash: killed (${JSON.stringify(hit)})`);
  assert(replays(sim), 'replay');
});

check('«Охотник на элит» gives the tail its power after a plate pass too (4.3, «Связь с силой цепи»)', () => {
  for (const hunter of [false, true]) {
    const sim = field(quiet({ elitePlates: 3 }), { talismans: hunter ? ['elite-hunter'] : [] });
    const a = place(sim, 6, 5, 0), el = place(sim, 7.5, 5, 0, { elite: true }), b = place(sim, 9, 5, 0), c = place(sim, 10.5, 5, 0);
    draw(sim, [a, el, b, c]);
    const plan = planChain(sim.world);
    // The next link's power: what the chain carried past the elite (+1 of the link itself).
    const next = plan.links[2].outcome!.available;
    sim.command({ t: 'release' });
    settle(sim);
    assert(plan.links[1].outcome!.plate && next === (hunter ? 1 + 3 + 1 : 1 + 1), `hunter ${hunter}: the link after the elite strikes with ${next}`);
    assert(!alive(sim.world, c) && plates(el) === 2, 'the tail died, one plate gone');
    assert(replays(sim), 'replay');
  }
});

check('armour with the elite behaviours (the run turns both on): a column leader in its window releases its followers and takes them again after it', () => {
  registerArena({ id: 'armor-wide', name: 'Широкое поле', summary: 'Тест брони элит', goal: 'kills', width: 24, height: 12,
    heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 23.3, y: 6 }, enemies: [], killGoal: 999 });
  const p = quiet({ eliteBehaviors: true, elitePlates: 2, enemySpeed: defaultParams().enemySpeed, contactDamage: 0 });
  const sim = new Simulation({ arena: 'armor-wide', params: p, seed: seedOf(5), record: true, loadout: { items: { bomb: 2 } } });
  sim.command({ t: 'clear', keepMarked: false }); sim.command({ t: 'teleport', x: 3, y: 6 });
  const leader = place(sim, 16, 6, 0, { elite: true }), followers = [place(sim, 18, 5, 0), place(sim, 18, 7, 0), place(sim, 19, 6, 0)];
  ticks(sim, 60);
  const lead = (): number => followers.filter(f => f.vars.lead === leader.id).length;
  assert(lead() === 3, `led before (${lead()})`);
  sim.command({ t: 'teleport', x: leader.x - 1.5, y: leader.y });
  sim.command({ t: 'item', kind: 'bomb', x: leader.x, y: leader.y });
  ticks(sim, 2);
  assert(leader.armor?.open && lead() === 0, `released in the window (${lead()})`);
  ticks(sim, 200);
  assert(plates(leader) >= 1 && lead() === 3, `led again after it (${plates(leader)} plates, ${lead()})`);
  assert(replays(sim), 'replay');
});

check('affixes: «Стремительный» −1 plate, «Толстый» +1, no HP change with armour', () => {
  const sim = field(quiet({ elitePlates: 3 }));
  const swift = place(sim, 7, 4, 2, { elite: true, affixes: ['swift'] }), fat = place(sim, 7, 6, 2, { elite: true, affixes: ['fat'] });
  assert(swift.armor?.max === 2 && fat.armor?.max === 4 && swift.hp === 2 && fat.hp === 2, `${swift.armor?.max} / ${fat.armor?.max}, HP ${swift.hp} / ${fat.hp}`);
  const thin = field(quiet({ elitePlates: 1 }));
  assert(place(thin, 7, 4, 0, { elite: true, affixes: ['swift'] }).armor?.max === 1, 'at least 1 plate');
});

check('tough newcomers by the table: 2 — 1 or 2 HP as before; 3 — 1–3; 4 — 1–4; the run by its row', () => {
  const seen = (params: Params, loadout?: Loadout): Set<number> => {
    const hps = new Set<number>();
    for (let k = 1; k <= 3; k++) {
      const sim = new Simulation({ arena: 'armor-open', params, seed: seedOf(k), ...loadout ? { loadout } : {} });
      for (let t = 0; t < tick(40); t++) { sim.tick(); for (const e of sim.world.enemies) if (e.kind === 'basic' || e.kind === 'wolf') hps.add(e.hp); sim.world.events.length = 0; }
    }
    return hps;
  };
  const list = (s: Set<number>): string => [...s].sort((a, b) => a - b).join();
  assert(list(seen(harmless({ baseToughShare: 1 }))) === '1,2', 'the default table');
  assert(list(seen(harmless({ baseToughShare: 1, toughHpMax: 3 }))) === '1,2,3', 'the slider 3');
  assert(list(seen(harmless({ baseToughShare: 1, toughHpMax: 4 }))) === '1,2,3,4', 'the slider 4');
  assert(list(seen(harmless({ baseToughShare: 1 }), { toughHp: 3 })) === '1,2,3', 'the run\'s kit 3');
  assert([1, 4, 5, 8, 9].map(row => rtToughHp(row)).join() === '2,2,3,3,4' && [1, 4, 5, 8, 9, 10].map(row => rtElitePlates(row)).join() === '2,2,3,3,4,4', 'the row tables');
});

check('the raised touch: HP ≥ 2 at the moment of the touch hurts 2, HP 0–1 — 1; an elite 2 without its bonus', () => {
  const touch = (hp: number, extra: Partial<Params> = {}, elite = false): number => {
    const p = quiet({ contactDamage: 1, toughTouch: true, ...extra });
    const sim = field(p);
    const d = touchDistanceOf(p, { kind: 'basic' } as Enemy);
    place(sim, 4.5 + d - 0.02, 5, hp, { elite });
    const hit = of(ticks(sim, 5), 'hit')[0];
    assert(replays(sim), 'replay');
    return hit?.damage ?? 0;
  };
  assert(touch(0) === 1 && touch(1) === 1 && touch(2) === 2 && touch(3) === 2, `0/1/2/3 HP: ${touch(0)} ${touch(1)} ${touch(2)} ${touch(3)}`);
  assert(touch(2, { toughTouch: false, eliteArmor: false }) === 1, 'off: 1');
  assert(touch(1, { eliteArmor: false }, true) === 2, 'an elite without armour, the raised touch: 2, no +1 on top');
  // HP at the moment of the touch: a 2 HP enemy burnt down to 1 touches for 1.
  const p = quiet({ contactDamage: 1, toughTouch: true });
  const sim = field(p, { items: { fire: 1 } }), w = sim.world;
  const e = place(sim, 9, 5, 2);
  sim.command({ t: 'item', kind: 'fire', x: e.x, y: e.y });
  ticks(sim, tick(p.fireInterval) + 2);
  assert(e.hp === 1, `burnt to 1 (${e.hp})`);
  sim.command({ t: 'teleport', x: 9 - touchDistanceOf(p, e) + 0.02, y: 5 });
  const hit = of(ticks(sim, 3), 'hit')[0];
  assert(hit?.damage === 1 && (w.hero.hp as number) === 39, `the touch at 1 HP: ${JSON.stringify(hit)}`);
  assert(replays(sim), 'replay');
});

check('the run: the after-chain shield only for 3+ kills (design 12.10.2026) — a chain of 1 leaves the hero open to a touch, of 3 shields him 0.5 s', () => {
  assert(rtRunParams(defaultParams()).chainShieldMinKills === 3 && defaultParams().chainShieldMinKills === 1, 'the run 3, the sandbox 1');
  /** A chain of `n` weak enemies to the right, then the hero beside a standing enemy of another colour: [shield, first hurt tick]. */
  const after = (n: number): { shield: number; hurtAt: number } => {
    const p = rtRunParams(quiet({ contactDamage: 1 }));
    const sim = field(p), w = sim.world;
    const links = Array.from({ length: n }, (_, i) => place(sim, 5.6 + 1.1 * i, 5, 0));
    const blocker = place(sim, 12, 8, 0, { color: 1 });
    draw(sim, links);
    sim.command({ t: 'release' });
    settle(sim);
    assert(w.stats.kills === n && !w.move, `${n} kills (${w.stats.kills})`);
    const shield = w.hero.chainShield, hp = w.hero.hp as number;
    sim.command({ t: 'teleport', x: blocker.x - touchDistanceOf(p, blocker) + 0.02, y: blocker.y });
    let hurtAt = -1;
    for (let t = 0; t < tick(1.5) && hurtAt < 0; t++) { ticks(sim, 1); if ((w.hero.hp as number) < hp) hurtAt = t; }
    assert(replays(sim), `replay ${n}`);
    return { shield, hurtAt };
  };
  const one = after(1), two = after(2), three = after(3);
  assert(one.shield === 0 && one.hurtAt >= 0 && one.hurtAt <= 2, `a chain of 1: no shield, the touch hurts at once (${JSON.stringify(one)})`);
  assert(two.shield === 0 && two.hurtAt <= 2, `a chain of 2: no shield (${JSON.stringify(two)})`);
  assert(near(three.shield, 0.5, 2 * SIM_DT) && three.hurtAt >= tick(0.5) - 2, `a chain of 3: 0.5 s (less the tick the dash ended in), the touch hurts only after it (${JSON.stringify(three)})`);
});

check('«Щит фокуса» (design 12.10.2026): drawing a chain of 2 in a crowd — a touch hurts; of 3 — no wound while the focus lasts; the focus empty — it hurts', () => {
  assert(rtRunParams(defaultParams()).focusGuardLinks === 3 && defaultParams().focusGuardLinks === 0, 'the run 3, the sandbox 0');
  /** Draws (holds, never releases) a chain of `n` weak enemies, then a standing enemy of another colour against the hero. */
  const hold = (n: number, params: Params): { hurtAt: number; emptyAt: number; guardedTicks: number } => {
    const sim = field(params), w = sim.world;
    const links = Array.from({ length: n }, (_, i) => place(sim, 5.6 + 1.1 * i, 5, 0));
    draw(sim, links);
    assert(w.chain.length === n, `the chain of ${n} drawn (${w.chain.length})`);
    place(sim, 4.5 - touchDistanceOf(params, { kind: 'basic' } as Enemy) + 0.02, 5, 0, { color: 1 });
    const hp = w.hero.hp as number;
    let hurtAt = -1, emptyAt = -1, guardedTicks = 0;
    for (let t = 0; t < tick(3) && hurtAt < 0; t++) {
      ticks(sim, 1);
      if (focusGuarded(w)) guardedTicks++;
      if (emptyAt < 0 && w.focus <= 0) emptyAt = t;
      if ((w.hero.hp as number) < hp) hurtAt = t;
    }
    assert(w.chain.length === n && !w.move, 'the chain is still held');
    assert(replays(sim), `replay ${n}`);
    return { hurtAt, emptyAt, guardedTicks };
  };
  const run = rtRunParams(quiet({ contactDamage: 1 }));
  const two = hold(2, run), three = hold(3, run), four = hold(4, run);
  assert(two.hurtAt >= 0 && two.hurtAt <= 1 && two.guardedTicks === 0, `2 links: hurt at once (${JSON.stringify(two)})`);
  for (const [n, r] of [[3, three], [4, four]] as const) {
    assert(r.emptyAt > tick(0.5) && r.guardedTicks >= r.emptyAt - 1, `${n} links: guarded until the focus is empty (${JSON.stringify(r)})`);
    assert(r.hurtAt >= r.emptyAt && r.hurtAt <= r.emptyAt + 2, `${n} links: the first wound right after the focus ran out (${JSON.stringify(r)})`);
  }
  // The sandbox default (0): a chain of 3 does not guard; a journal without the key plays the old path.
  const off = hold(3, quiet({ contactDamage: 1 }));
  assert(off.hurtAt >= 0 && off.hurtAt <= 1 && off.guardedTicks === 0, `the key 0: hurt at once (${JSON.stringify(off)})`);
  const old = quiet({ contactDamage: 1 }) as Partial<Params>;
  delete old.focusGuardLinks;
  assert(JSON.stringify(hold(3, old as Params)) === JSON.stringify(off), 'no key — the old path');
});

check('caps with armour: random elites at most 1 before the goals and 2 after', () => {
  for (let k = 1; k <= 2; k++) {
    const sim = new Simulation({ arena: 'armor-open', params: harmless({ eliteArmor: true, eliteSandbox: true, eliteChance: 1, eliteChanceAfter: 1 }), seed: seedOf(60 + k), record: true });
    const w = sim.world;
    let before = 0, after = 0;
    for (let t = 0; t < tick(15); t++) { sim.tick(); before = Math.max(before, w.enemies.filter(e => e.elite).length); w.events.length = 0; }
    sim.command({ t: 'goals' });
    for (let t = 0; t < tick(15); t++) { sim.tick(); after = Math.max(after, w.enemies.filter(e => e.elite).length); w.events.length = 0; }
    assert(before === 1 && after === 2, `seed ${k}: ${before} / ${after}`);
    assert(w.enemies.filter(e => e.elite).every(e => e.armor?.max === 3), 'armoured');
    assert(replays(sim), 'replay');
  }
});

/** The run arena of a battle node of run row `row` (`battle` kind) on the open field (a run without the gentle entry, task 17). */
function runArena(row: number, battle: RtBattleKind, k: number): { run: RtRunState; sim: Simulation } | null {
  const base = createRtRun(seedOf(70 + row), { gentleEntry: false });
  const node = rtMapNodes(base).find(n => runRow(n.row) === row);
  if (!node) return null;
  const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'armor-open', seed: seedOf(k), battle } };
  const sim = new Simulation({ arena: 'armor-open', params: rtRunParams(harmless()), seed: seedOf(k), record: true, loadout: rtArenaLoadout(run) });
  return { run, sim };
}

check('the run turns the package on; from row 3 one guaranteed armoured elite in the first 10 s of an ordinary battle', () => {
  const params = rtRunParams(defaultParams());
  assert(params.eliteArmor && params.toughTouch && params.toughHpMax === 2, 'the run copy');
  for (const row of [3, 5, 9]) {
    for (let k = 1; k <= 3; k++) {
      const arena = runArena(row, 'battle', k);
      assert(arena, `row ${row}`);
      const { sim } = arena, w = sim.world;
      const elites = new Map<number, Enemy>();
      for (let t = 0; t < tick(10); t++) { sim.tick(); for (const e of w.enemies) if (e.elite && !elites.has(e.id)) elites.set(e.id, e); w.events.length = 0; }
      // Random elites (3%) may add one on top of the guaranteed one, never before it.
      assert(elites.size >= 1 && w.kit?.guaranteedElite === undefined, `row ${row} seed ${k}: elites ${elites.size}`);
      // Its plates by the row, «Стремительный» −1 and «Толстый» +1 (rows 5+ give affixes).
      const first = [...elites.values()][0], affixes = first.affixes ?? [];
      const want = rtElitePlates(row) + (affixes.includes('fat') ? 1 : 0) - (affixes.includes('swift') ? 1 : 0);
      assert(first.armor?.max === want && first.armor.plates <= want, `row ${row}: plates ${first.armor?.max}, affixes ${affixes}`);
      assert(replays(sim), 'replay');
    }
  }
  for (const [row, battle] of [[1, 'battle'], [2, 'battle'], [3, 'hard'], [5, 'final']] as const) {
    const arena = runArena(row, battle, 1);
    if (!arena) continue;
    assert(!rtArenaLoadout(arena.run).guaranteedElite, `row ${row} ${battle}: no guarantee`);
  }
  const ev = runArena(4, 'event', 1);
  assert(ev && rtArenaLoadout(ev.run).guaranteedElite === true, 'an event\'s reward battle is ordinary');
});

check('the guaranteed elite: not on the Jailer\'s node, on a breakthrough (design answer 11.10.2026)', () => {
  let jailer = 0, breakthrough = 0;
  for (let k = 1; k <= 6 && (!jailer || !breakthrough); k++) {
    const base = createRtRun(seedOf(900 + k), { gentleEntry: false });
    for (const node of rtMapNodes(base)) {
      if (runRow(node.row) < 3 || (node.type !== 'checkpoint' && node.type !== 'breakthrough')) continue;
      const run: RtRunState = { ...structuredClone(base), pending: { kind: 'battle', nodeId: node.id, arena: 'armor-open', seed: seedOf(k), battle: 'battle' } };
      const due = !!rtArenaLoadout(run).guaranteedElite;
      if (node.type === 'checkpoint') { assert(!due, `the Jailer ${node.id}: no guaranteed elite`); jailer++; }
      else { assert(due, `the breakthrough ${node.id}: a guaranteed elite`); breakthrough++; }
    }
  }
  assert(jailer > 0 && breakthrough > 0, `checked: Jailer ${jailer}, breakthrough ${breakthrough}`);
});

check('with armour the marker announces the elite: decided as it appears, it waits 2 s, the newcomer is the elite; without armour the old marker', () => {
  for (const armor of [true, false]) {
    const p = harmless({ eliteArmor: armor, eliteSandbox: true, eliteChance: 1, eliteChanceAfter: 1, eliteCap: 1, eliteArmorCap: 1 });
    const sim = new Simulation({ arena: 'armor-open', params: p, seed: seedOf(31), record: true }), w = sim.world;
    let eliteMarker: { id: number; total: number } | null = null, plainTotal = 0, elites = 0;
    const flagged = new Set<number>();
    for (let t = 0; t < 900; t++) {
      for (const m of w.markers) { if (m.elite) { flagged.add(m.id); eliteMarker ??= { id: m.id, total: m.total }; } else plainTotal = m.total; }
      sim.tick();
      for (const e of w.events) if (e.type === 'elite') elites++;
      w.events.length = 0;
    }
    if (armor) {
      assert(eliteMarker && near(eliteMarker.total, 2) && near(plainTotal, p.markerDelay), `the elite marker waits 2 s (${eliteMarker?.total}), a plain one ${plainTotal}`);
      assert(elites === flagged.size && elites >= 1 && w.enemies.filter(e => e.elite).length <= 1, `every flagged marker gave an elite (${elites} of ${flagged.size}), the cap 1 counts markers`);
    } else {
      assert(!eliteMarker && elites >= 1, `no elite marker without armour; elites still come at the step-out (${elites})`);
    }
    assert(replays(sim), 'replay');
  }
});

check('off by default: a journal without the new values plays the same fight to the bit (elites, newcomers, a bomb)', () => {
  const p = defaultParams();
  assert(!p.eliteArmor && !p.toughTouch && p.toughHpMax === 2, 'the defaults');
  const keys = ['eliteArmor', 'elitePlates', 'eliteWindow', 'elitePlateRegrow', 'eliteTouchDamage', 'eliteKnockback', 'eliteArmorCap', 'eliteArmorCapAfter', 'toughHpMax', 'toughTouch', 'toughTouchDamage'] as const;
  const without = (state: unknown): unknown => { const s = { ...(state as Record<string, unknown>) }; delete s.params; return s; };
  for (let k = 1; k <= 3; k++) {
    const extra = { eliteSandbox: true, eliteChance: 0.3, eliteChanceAfter: 0.5, contactDamage: 1, heroHp: 999 };
    const old = harmless(extra) as Partial<Params>;
    for (const key of keys) delete old[key];
    const play = (params: Params): Simulation => {
      const sim = new Simulation({ arena: 'armor-open', params, seed: seedOf(80 + k), record: true, loadout: { items: { bomb: 2 } } });
      const id = sim.command({ t: 'place', x: 10, y: 5, color: 0, hp: 1, kind: 'basic', elite: true }) as number;
      for (let t = 0; t < tick(30); t++) {
        if (t === tick(2)) sim.command({ t: 'item', kind: 'bomb', x: 10, y: 5 });
        if (t === tick(20)) sim.command({ t: 'goals' });
        sim.tick(); sim.world.events.length = 0;
      }
      void id;
      return sim;
    };
    const a = play(harmless(extra)), b = play(old as Params);
    assert(JSON.stringify(without(worldState(a.world))) === JSON.stringify(without(worldState(b.world))), `seed ${k}: the same world`);
    assert(a.world.enemies.every(e => e.armor === undefined), 'no armour');
    assert(replays(a) && replays(b), 'replays');
  }
  assert(sanitizeParams({ toughHpMax: 9 }).toughHpMax === 4 && sanitizeParams({ elitePlates: 0 }).elitePlates === 1, 'clamped');
});

console.log(`${checks} checks passed`);
