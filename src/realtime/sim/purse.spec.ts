/**
 * Casino stage 1, item 1 — «Котёл» (sim/purse.ts, docs/realtime-casino.md; docs/realtime-casino-research.md, K1, K4, 3.2,
 * 8.5). Node only: `npm run test:realtime-purse`.
 *
 * Every check plays journalled commands (place, crystal, begin / drag, release, goals, teleport, walk, param …) and reads
 * what the player sees: the cheque at the end of the dash (`cheque` event), the cauldron, the door's record and what the run
 * gets for it:
 * - the rows of the table: a weak link 1, a tough one its HP (a survivor — the HP it lost), a plate 2, an armoured elite's
 *   kill +5; heat +1 at every 3rd enemy link, +1 «добивание» from 4 links when the last died; a crystal ×2, two ×4, three
 *   still ×4; a crystal dropped during the dash is not in the cheque; the seal (sandbox loop) +1 ember per enemy inside, +2
 *   heat;
 * - the hammer's kills outside the chain: 1 ember each, no heat;
 * - the highlight's cheque (`planChain`) is the dash's (several shapes, the sketch of 3.2: 8 × 3 × ◆2 = 48);
 * - the door: a chain into the door puts its cheque first; the payout ⌊котёл ÷ 40⌋, at most 3 (the function with M 0.5 / 2 /
 *   4: caps 1 / 6 / 6); the resource kinds by the stream `purse:loot` vary over seeds, a replay repeats them; the other
 *   streams and the fight itself do not change with the cauldron;
 * - the run turns the cauldron on and its materials get the door's payout on a win;
 * - off by default: a journal without the value plays the same world (everything but the params), no new world fields.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { planChain } from './chain';
import { BUILD_SOURCES, HAMMERS } from './buildIds';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { doorPayout, purseResources, type Cheque } from './purse';
import { Simulation, replay } from './simulation';
import type { Enemy, World, WorldEvent } from './world';
import { createRtRun, resolveArena, rtAvailableNodes, rtChooseGift, rtEnterNode, rtRunParams, RT_RUN_FORCED, type RtRunState, type RtRunStep } from '../run/rtRun';
import { RESOURCE_KINDS } from '../forest/resources';
import { createFightObserver } from '../telemetry/observe';
import type { Journal } from './simulation';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'purse-field', name: 'Поле котла', summary: 'Тест котла', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** A quiet fight with the cauldron on: no newcomers, nobody walks or touches, no hit-stop, no survivor knockback. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.purse = true;
  return Object.assign(p, extra);
}
function field(params: Params = quiet(), k = 1, loadout?: Loadout): Simulation {
  const sim = new Simulation({ arena: 'purse-field', params, seed: seedOf(k), record: true, ...loadout ? { loadout } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp = 0, extra: { elite?: boolean; color?: number } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: 'basic', ...extra.elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
type Pt = { x: number; y: number };
/**
 * A row of links from the hero along y = 6, 1.4 apart: a number — an enemy of that HP, `'crystal'` — a crystal, `'elite'`
 * — an armoured elite of HP 0. Returns the points in order.
 */
function lay(sim: Simulation, spec: readonly (number | 'crystal' | 'crystal0' | 'elite')[], from = sim.world.hero.x, y = 6): Pt[] {
  return spec.map((s, i) => {
    const x = from + 1.4 * (i + 1);
    // `crystal0` — a crystal worth 0 (as the goblin's ◆ drops near the hero): the ×2 is by kind, not by its value.
    if (s === 'crystal' || s === 'crystal0') { sim.command({ t: 'crystal', x, y, value: s === 'crystal0' ? 0 : 6 }); return { x, y }; }
    place(sim, x, y, s === 'elite' ? 0 : s, s === 'elite' ? { elite: true } : {});
    return { x, y };
  });
}
function draw(sim: Simulation, points: readonly Pt[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the hero stands again, collecting the events. */
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
function ticks(sim: Simulation, n: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const short = (c: Pick<Cheque, 'embers' | 'heat' | 'mult' | 'total'>): string => `${c.embers}×${c.heat}×${c.mult}=${c.total}`;

/**
 * Draws the chain through `points`, checks the highlight's cheque, releases, plays the dash: the one cheque of the dash must
 * be the highlight's. Returns the cheque and the events.
 */
function chain(sim: Simulation, points: readonly Pt[], links = points.length): { cheque: Ev<'cheque'>; events: WorldEvent[] } {
  draw(sim, points);
  assert(sim.world.chain.length === links, `the chain took ${sim.world.chain.length} links, wanted ${links}`);
  const planned = planChain(sim.world).cheque;
  assert(planned, 'the highlight has a cheque');
  sim.command({ t: 'release' });
  const events = settle(sim), cheques = of(events, 'cheque');
  assert(cheques.length === 1, `one cheque: ${cheques.length}`);
  const cheque = cheques[0];
  assert(short(cheque) === short(planned) && cheque.links === planned.links && cheque.crystals === planned.crystals,
    `the highlight ${short(planned)} = the dash ${short(cheque)}`);
  return { cheque, events };
}

// ---- The table (K1, K4) ----

check('weak links: 1 = 1, 2 = 2, 3 = 3 × 2 (the 3rd link), 4 dead = 4 × 3 (the «добивание»), 6 = 6 × 4; the cauldron adds them', () => {
  const sim = field(), w = sim.world;
  const want: [number, string][] = [[1, '1×1×1=1'], [2, '2×1×1=2'], [3, '3×2×1=6'], [4, '4×3×1=12'], [6, '6×4×1=24']];
  let cauldron = 0;
  for (const [n, text] of want) {
    sim.command({ t: 'teleport', x: 4.5, y: 6 });
    const { cheque } = chain(sim, lay(sim, Array<number>(n).fill(0)));
    assert(short(cheque) === text, `${n} weak: ${short(cheque)}, wanted ${text}`);
    cauldron += cheque.total;
    assert(w.purse?.cauldron === cauldron && cheque.cauldron === cauldron, `the cauldron ${w.purse?.cauldron}, wanted ${cauldron}`);
  }
  assert(replays(sim), 'replay');
});

check('a tough link gives its HP (killed at the end: 3 × 2 + 2 = 4 × 2 = 8; 1+1+1+3 × 3 = 18); a survivor gives the HP it lost and no «добивание»', () => {
  const a = field();
  assert(short(chain(a, lay(a, [0, 0, 2])).cheque) === '4×2×1=8', 'weak, weak, tough 2');
  const b = field();
  assert(short(chain(b, lay(b, [0, 0, 0, 3])).cheque) === '6×3×1=18', 'three weak, tough 3 at the end');
  // Four links, the last a survivor (HP 6, power 4): 1+1+1+4 embers, heat 1 + 1 (3rd) — no «добивание».
  const c = field();
  const { cheque, events } = chain(c, lay(c, [0, 0, 0, 6]));
  assert(of(events, 'chainHit').at(-1)?.killed === false && short(cheque) === '7×2×1=14' && !cheque.finish, `the survivor: ${short(cheque)}`);
  // The same chain with the tough one killed (HP 4): the «добивание» — ×3.
  const d = field();
  assert(short(chain(d, lay(d, [0, 0, 0, 4])).cheque) === '7×3×1=21', 'killed at the end: ×3');
  // A tough one first survives and stops the chain: only its own HP lost (1) — the order matters.
  const e = field();
  const first = lay(e, [3, 0, 0]);
  draw(e, first);
  assert(e.world.chain.length === 1, 'nothing after a survivor');
  e.command({ t: 'release' });
  const late = of(settle(e), 'cheque')[0];
  assert(short(late) === '1×1×1=1', `the tough one first: ${short(late)}`);
  for (const s of [a, b, c, d, e]) assert(replays(s), 'replay');
});

check('an armoured elite: each plate 2 embers, the chain goes on; its kill in the window +5 (K4)', () => {
  const sim = field(quiet({ eliteArmor: true })), w = sim.world;
  // A plated elite in the middle: 1 + 2 + 1 + 1 embers, 4 links, the last died — ×3.
  const { cheque } = chain(sim, lay(sim, [0, 'elite', 0, 0]));
  assert(short(cheque) === '5×3×1=15', `the plate in the middle: ${short(cheque)}`);
  // One plate left on a sandbox elite: the first chain takes it (2), the next kills it in the window (1 + 5).
  const one = field(quiet({ eliteArmor: true, elitePlates: 1 }));
  const at = lay(one, ['elite']);
  const plate = chain(one, at).cheque;
  assert(short(plate) === '2×1×1=2', `the plate: ${short(plate)}`);
  const { cheque: kill, events } = chain(one, at);
  assert(of(events, 'eliteDown')[0]?.inWindow === true && short(kill) === '6×1×1=6', `the kill in the window: ${short(kill)}`);
  assert(one.world.purse?.cauldron === 8 && w.purse?.cauldron === 15, 'the cauldrons');
  assert(replays(sim) && replays(one), 'replay');
});

check('every 3rd enemy link +1 heat: 9 weak = 9 × 5; a crystal dropped during the dash (the 6th kill) is not in its cheque', () => {
  const sim = field(), w = sim.world;
  const { cheque, events } = chain(sim, lay(sim, Array<number>(9).fill(0), 4.5));
  assert(of(events, 'crystal').length === 1 && w.objects.some(o => o.kind === 'crystal'), 'a crystal dropped at the 6th kill');
  assert(short(cheque) === '9×5×1=45' && cheque.crystals === 0, `9 links: ${short(cheque)}`);
  assert(replays(sim), 'replay');
});

check('crystals in the chain: the 3.2 sketch 8 × 3 × ◆2 = 48; two crystals ×4, three still ×4 (the cap); crystals give no embers', () => {
  const sim = field();
  const { cheque } = chain(sim, lay(sim, [0, 0, 'crystal', 0, 0, 4]));
  assert(short(cheque) === '8×3×2=48' && cheque.crystals === 1, `the sketch: ${short(cheque)}`);
  const two = field();
  assert(short(chain(two, lay(two, [0, 'crystal', 0, 'crystal', 0])).cheque) === '3×2×4=24', 'two crystals ×4');
  const three = field();
  const capped = chain(three, lay(three, [0, 'crystal', 0, 'crystal', 0, 'crystal'])).cheque;
  assert(short(capped) === '3×2×4=24' && capped.crystals === 3, `three crystals, still ×4: ${short(capped)}`);
  for (const s of [sim, two, three]) assert(replays(s), 'replay');
});

check('a crystal worth 0 (the goblin\'s ◆ near the hero) multiplies the cheque as any crystal: ×2, two ×4 — by kind, not by value', () => {
  const one = field();
  const a = chain(one, lay(one, [0, 0, 'crystal0', 0, 0, 4])).cheque;
  assert(short(a) === '8×3×2=48' && a.crystals === 1, `a crystal worth 0: ${short(a)}`);
  const mixed = field();
  const b = chain(mixed, lay(mixed, [0, 'crystal0', 0, 'crystal', 0])).cheque;
  assert(short(b) === '3×2×4=24' && b.crystals === 2, `worth 0 and worth 6: ${short(b)}`);
  for (const s of [one, mixed]) assert(replays(s), 'replay');
});

check('the seal (sandbox loop): +1 ember per enemy inside, +2 heat to the chain that closed it; the highlight is the dash', () => {
  const sim = field(quiet({ loopEnabled: true }));
  const square: Pt[] = [{ x: 6, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 7 }, { x: 6, y: 7 }];
  for (const p of square) place(sim, p.x, p.y);
  place(sim, 7, 6, 2, { color: 2 });
  place(sim, 10.5, 6, 2, { color: 2 });
  draw(sim, square);
  sim.command({ t: 'drag', x: square[0].x, y: square[0].y, mode: 'full' });
  assert(sim.world.chainClosed === 'first', 'closed');
  const planned = planChain(sim.world).cheque!;
  sim.command({ t: 'release' });
  const cheque = of(settle(sim), 'cheque')[0];
  // 4 weak + 1 inside; heat 1 + 1 (3rd) + 1 («добивание») + 2 (the seal).
  assert(short(cheque) === '5×5×1=25' && short(planned) === short(cheque), `the seal: plan ${short(planned)}, dash ${short(cheque)}`);
  assert(replays(sim), 'replay');
});

check('the hammer «Взрыв на конце»: its kills put 1 ember each, no heat; the chain\'s cheque is the same as without it', () => {
  const run = (hammer: boolean) => {
    const sim = field(quiet(), 1, { talismans: [], ...hammer ? { hammer: HAMMERS.blast } : {} });
    const links = lay(sim, [0, 0, 0]);
    const last = links[2];
    place(sim, last.x + 1, last.y - 0.5, 0, { color: 2 });
    place(sim, last.x, last.y + 1, 0, { color: 3 });
    return { sim, ...chain(sim, links) };
  };
  const plain = run(false), blast = run(true);
  const kills = of(blast.events, 'purseKill');
  assert(short(plain.cheque) === '3×2×1=6' && short(blast.cheque) === '3×2×1=6', `the cheque with and without the hammer: ${short(plain.cheque)} / ${short(blast.cheque)}`);
  assert(kills.length === 2 && kills.every(k => k.source === 'hammer-blast'), `two blast kills, 1 ember each: ${JSON.stringify(kills)}`);
  assert(blast.sim.world.purse?.cauldron === 8 && plain.sim.world.purse?.cauldron === 6, `the cauldrons ${blast.sim.world.purse?.cauldron} / ${plain.sim.world.purse?.cauldron}`);
  assert(replays(blast.sim), 'replay');
});

check('the hammer «Огненный проход» burns links ahead of the hero: they bring their embers into the cheque, the highlight is the dash (review 11.10.2026)', () => {
  for (const [spec, want] of [[[0, 0, 0, 0, 0, 0], '6×4×1=24'], [[0, 0, 0, 0, 0, 2], '7×4×1=28']] as const) {
    const sim = field(quiet(), 1, { talismans: [], hammer: HAMMERS.fire });
    const links = lay(sim, spec);
    const { cheque, events } = chain(sim, links);
    const burned = of(events, 'kill').filter(e => e.source === BUILD_SOURCES.hammerFire);
    assert(burned.length > 0, 'the fire burned links ahead of the hero');
    assert(short(cheque) === want, `the cheque ${short(cheque)} (want ${want})`);
    assert(of(events, 'purseKill').length === 0 && sim.world.purse?.cauldron === cheque.total, `no separate embers for the dash's links; the cauldron ${sim.world.purse?.cauldron}`);
    assert(replays(sim), 'replay');
  }
});

check('the bomb, the fire item and the spin put no embers (decision 2): the cauldron stays 0', () => {
  const sim = field(quiet({ spinCost: 1 }), 2, { items: { frost: 0, bomb: 2, healing: 0, fire: 1 }, energy: 7 });
  const h = sim.world.hero;
  const a = place(sim, h.x + 1.5, h.y, 0), b = place(sim, h.x - 1.5, h.y, 0), c = place(sim, h.x, h.y + 1, 0);
  sim.command({ t: 'item', kind: 'bomb', x: a.x, y: a.y });
  sim.command({ t: 'item', kind: 'fire', x: b.x, y: b.y });
  sim.command({ t: 'spin' });
  const events = ticks(sim, 240);
  const credited = of(events, 'kill').filter(e => e.credited).length;
  assert(credited >= 2 && !sim.world.enemies.includes(c), `the tools killed (${credited})`);
  assert(of(events, 'purseKill').length === 0 && (sim.world.purse?.cauldron ?? 0) === 0, `no embers: ${sim.world.purse?.cauldron}`);
  assert(replays(sim), 'replay');
});

// ---- The door and the payout ----

check('the payout function: ⌊котёл × M ÷ 40⌋; cap min(6, ⌊3 × M⌋), at least 1 — M 1: 3, M 0.5: 1, M 2: 6, M 4: 6', () => {
  const at = (cauldron: number, oath = 1, die = 1) => purseResources(cauldron, oath, die);
  assert(at(0) === 0 && at(39) === 0 && at(40) === 1 && at(119) === 2 && at(120) === 3 && at(1000) === 3, 'M 1: floor, cap 3');
  assert(at(79, 0.5) === 0 && at(80, 0.5) === 1 && at(1000, 0.5) === 1 && at(1000, 1, 0.5) === 1, 'M 0.5: cap 1');
  assert(at(1000, 2) === 6 && at(1000, 1, 2) === 6 && at(100, 2) === 5, 'M 2: cap 6');
  assert(at(1000, 2, 2) === 6 && at(1000, 4) === 6, 'M 4: cap 6, not 12');
});

/** Chains of 5 weak links (5 × 3 = 15, no crystal drop) until the cauldron reaches `target`, then a chain of 4 into the open door (12). */
function fillAndExit(sim: Simulation, target: number): { door: Ev<'purseDoor'>; last: Ev<'cheque'> } {
  const w = sim.world;
  while ((w.purse?.cauldron ?? 0) < target) {
    sim.command({ t: 'teleport', x: 4.5, y: 6 });
    chain(sim, lay(sim, Array<number>(5).fill(0)));
  }
  sim.command({ t: 'goals' });
  sim.command({ t: 'teleport', x: 12.1, y: 6 });
  const points = lay(sim, [0, 0, 0, 0]);
  const door = w.objects.find(o => o.kind === 'door')!;
  draw(sim, [...points, { x: door.x, y: door.y }]);
  assert(w.chain.length === 5, `the chain ends on the door: ${w.chain.length}`);
  sim.command({ t: 'release' });
  const events = settle(sim);
  assert(w.status === 'victory', 'the door won the arena');
  const cheques = of(events, 'cheque'), doors = of(events, 'purseDoor');
  assert(cheques.length === 1 && doors.length === 1 && events.indexOf(cheques[0]) < events.indexOf(doors[0]), 'the chain\'s cheque comes before the door');
  assert(doors[0].cauldron === w.purse!.cauldron && w.purse!.door!.cauldron === w.purse!.cauldron, 'the door records the cauldron with the last cheque');
  return { door: doors[0], last: cheques[0] };
}

check('the door: a chain into the door puts its cheque first; ⌊котёл ÷ 40⌋ (27 — 0, 42 — 1); without stakes it stops at 3 (192 pays 3, not 4)', () => {
  const sim = field();
  const { door, last } = fillAndExit(sim, 180);
  assert(short(last) === '4×3×1=12' && door.cauldron === 192 && door.oath === 1, `cauldron ${door.cauldron}, last ${short(last)}`);
  assert(door.resources === 3 && doorPayout(sim.world.purse!.door!).length === 3, `the payout ${door.resources}`);
  const none = field(), one = field();
  const zero = fillAndExit(none, 1).door, low = fillAndExit(one, 30).door;
  assert(zero.cauldron === 27 && zero.resources === 0 && doorPayout(none.world.purse!.door!).length === 0, `a cauldron of 27 pays 0: ${zero.resources}`);
  assert(low.cauldron === 42 && low.resources === 1, `a cauldron of 42 pays 1: ${low.resources}`);
  assert(replays(sim) && replays(none) && replays(one), 'replay');
});

check('the resource kinds come from the stream `purse:loot`: they vary over seeds, a replay repeats them; the fight and the other streams are as without the cauldron', () => {
  const seen = new Set<string>(), kinds = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const sim = field(quiet(), k);
    fillAndExit(sim, 100);
    const door = sim.world.purse!.door!;
    assert(door.kinds.length === 6 && door.kinds.every(x => RESOURCE_KINDS.includes(x)), `seed ${k}: kinds ${door.kinds.join()}`);
    const again = replay(JSON.parse(JSON.stringify(sim.exportJournal()!)));
    assert(again.hash() === sim.hash() && JSON.stringify(again.world.purse) === JSON.stringify(sim.world.purse), `seed ${k}: the replay repeats the door`);
    seen.add(doorPayout(door).join());
    for (const x of doorPayout(door)) kinds.add(x);
    // The same commands with the cauldron off: the same fight, the other streams where they were.
    const off = field(quiet({ purse: false }), k);
    fillAndExitOff(off, sim);
    const strip = (w: World) => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; delete s.purse; delete s.rng; return JSON.stringify(s); };
    assert(strip(off.world) === strip(sim.world), `seed ${k}: the fight is the same without the cauldron`);
    const streams = (w: World) => JSON.stringify(w.rng.states().filter(([name]) => name !== 'purse:loot'));
    assert(streams(off.world) === streams(sim.world) && !off.world.rng.states().some(([name]) => name === 'purse:loot'), `seed ${k}: the other streams did not shift`);
  }
  assert(seen.size >= 3 && kinds.size >= 3, `the kinds vary: ${[...seen].join(' | ')}`);
});

/** Plays the commands of `on`'s journal (after its start) on `off`: the same fight with the cauldron off. */
function fillAndExitOff(off: Simulation, on: Simulation): void {
  const journal = on.exportJournal()!, start = off.exportJournal()!.commands.length;
  const commands = journal.commands.slice(start);
  let next = 0;
  for (let tick = off.world.tick; tick < journal.ticks; tick++) {
    while (next < commands.length && commands[next].tick <= tick) off.command(commands[next++].cmd);
    off.tick();
    off.world.events.length = 0;
  }
  while (next < commands.length) off.command(commands[next++].cmd);
}

// ---- The logs ----

/** Replays a journal with the fight observer of the telemetry (as the report does) and returns its summary. */
function observed(journal: Journal): ReturnType<ReturnType<typeof createFightObserver>['summary']> {
  const sim = new Simulation({ arena: journal.arena, params: JSON.parse(JSON.stringify(journal.params)) as Params, seed: journal.seed, ...journal.loadout ? { loadout: journal.loadout } : {} });
  const observer = createFightObserver(sim.world);
  let next = 0;
  const upTo = (tick: number) => { while (next < journal.commands.length && journal.commands[next].tick <= tick) { const c = journal.commands[next++].cmd; sim.command(c); observer.command(c, sim.world); } };
  for (let tick = 0; tick < journal.ticks; tick++) { upTo(tick); sim.tick(); observer.tick(sim.world); sim.world.events.length = 0; }
  upTo(journal.ticks);
  return observer.summary();
}

check('the logs: `purse` of the fight summary — the cheques (embers, heat, totals), crystals in chains, the build\'s kill embers, the cauldron, the door\'s resources', () => {
  const sim = field(quiet(), 1, { talismans: [], hammer: HAMMERS.blast });
  chain(sim, lay(sim, [0, 0, 'crystal', 0, 0, 4]));
  sim.command({ t: 'teleport', x: 4.5, y: 6 });
  const links = lay(sim, [0, 0, 0]);
  place(sim, links[2].x + 1, links[2].y - 0.5, 0, { color: 2 });
  chain(sim, links);
  const { door } = fillAndExit(sim, 100);
  const s = observed(sim.exportJournal()!).purse;
  assert(s.on && s.cauldron === sim.world.purse!.cauldron && s.resources === door.resources, `on, cauldron ${s.cauldron}, resources ${s.resources}`);
  assert(s.embers.slice(0, 2).join() === '8,3' && s.heat.slice(0, 2).join() === '3,2' && s.totals.slice(0, 2).join() === '48,6', `the first cheques: ${s.embers.join()} / ${s.heat.join()} / ${s.totals.join()}`);
  assert(s.crystals === 1 && (s.killEmbers['hammer-blast'] ?? 0) >= 1, `crystals ${s.crystals}, kill embers ${JSON.stringify(s.killEmbers)}`);
  assert(s.totals.reduce((a, x) => a + x, 0) + Object.values(s.killEmbers).reduce((a, x) => a + x, 0) === s.cauldron, 'the cheques and the kill embers make the cauldron');
  const off = field(quiet({ purse: false }));
  chain2(off);
  const none = observed(off.exportJournal()!).purse;
  assert(!none.on && none.cauldron === 0 && !none.embers.length && none.resources === null, 'off: an empty `purse`');
});

/** A chain on a fight with the cauldron off (no cheque to compare). */
function chain2(sim: Simulation): void {
  draw(sim, lay(sim, [0, 0, 0]));
  sim.command({ t: 'release' });
  settle(sim);
}

// ---- The run ----

function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}

check('the run turns the cauldron on; a won arena pays the door\'s resources into the run\'s materials', () => {
  assert(RT_RUN_FORCED.purse === true && rtRunParams(defaultParams()).purse === true && defaultParams().purse === false, 'on in the run, off in the sandbox by default');
  let paidTotal = 0;
  for (let k = 1; k <= 3; k++) {
    let run = ok(rtChooseGift(createRtRun(seedOf(k), { gift: 'mini' }), 1), 'gift');
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
    const pending = run.pending;
    assert(pending?.kind === 'battle', 'a battle node');
    // The run's values on a quiet field (the arena of the node is not needed: the run reads the finished world as main.ts does).
    const sim = field(rtRunParams(quiet({ purse: false })), k), w = sim.world;
    assert(w.params.purse === true, 'the run arena plays with the cauldron');
    fillAndExit(sim, 60 + 30 * k);
    const door = w.purse!.door!, pay = doorPayout(door);
    assert(pay.length === purseResources(door.cauldron) && pay.length >= 1, `seed ${k}: pays ${pay.length}`);
    const before = { ...run.materials };
    const after = ok(resolveArena(run, { nodeId: pending.nodeId, won: true, hp: w.hero.hp, kills: w.stats.kills, damage: w.stats.damageTaken, time: w.endTime ?? w.time, purse: door }), 'resolve');
    for (const kind of RESOURCE_KINDS) {
      const want = before[kind] + pay.filter(x => x === kind).length;
      assert(after.materials[kind] === want, `seed ${k}: ${kind} ${after.materials[kind]}, wanted ${want}`);
    }
    paidTotal += pay.length;
    // A lost arena pays nothing (the run is over anyway).
    const lost = ok(resolveArena(run, { nodeId: pending.nodeId, won: false, hp: 0, kills: 0, damage: 0, time: 1, purse: door }), 'lose');
    assert(RESOURCE_KINDS.every(kind => lost.materials[kind] === before[kind]), 'a defeat pays nothing');
  }
  assert(paidTotal >= 3, `paid ${paidTotal}`);
});

// ---- Off by default ----

check('off by default: a journal without the value plays the same world; no cauldron, no cheque, no stream', () => {
  for (let k = 1; k <= 3; k++) {
    const old = quiet({ purse: false }) as Partial<Params>;
    delete old.purse;
    const a = field(quiet({ purse: false }), k), b = field(old as Params, k);
    for (const sim of [a, b]) {
      sim.command({ t: 'teleport', x: 4.5, y: 6 });
      draw(sim, lay(sim, [0, 0, 'crystal', 0, 0, 4]));
      sim.command({ t: 'release' });
      const events = settle(sim);
      assert(!of(events, 'cheque').length && !sim.world.purse, 'no cheque, no cauldron');
      sim.command({ t: 'goals' });
      sim.command({ t: 'teleport', x: 12.1, y: 6 });
      const door = sim.world.objects.find(o => o.kind === 'door')!;
      draw(sim, [...lay(sim, [0, 0, 0, 0]), { x: door.x, y: door.y }]);
      sim.command({ t: 'release' });
      settle(sim);
      assert(sim.world.status === 'victory' && !sim.world.purse && !sim.world.rng.states().some(([n]) => n === 'purse:loot'), 'the door records nothing');
      assert(planChain(sim.world).cheque === undefined, 'the highlight has no cheque');
    }
    const without = (w: World) => { const s = { ...(worldState(w) as Record<string, unknown>) }; delete s.params; return JSON.stringify(s); };
    assert(without(a.world) === without(b.world), `seed ${k}: the same world`);
    const journal = b.exportJournal()!;
    assert(!('purse' in journal.params) && replay(JSON.parse(JSON.stringify(journal))).hash() === b.hash(), 'the old journal replays');
  }
});

console.log(`realtime-purse: ${checks} checks passed`);
