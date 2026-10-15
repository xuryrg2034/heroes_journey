/**
 * Task 29, track B (docs/design-notes/tasks-29-30.md, points 3 and 4; docs/realtime-phase-b.md, section 11): the eight counter
 * talismans with the chain window (`Params.counterWindow`) and the sandbox form «Наледь» (`frost-pass`). Node only:
 * `npm run test:realtime-counters-window`.
 *
 * Every check plays real journalled commands (place, crystal, teleport, begin, drag, release, jump, ticks) on the arena
 * «Убить 30» with a quiet panel:
 * - each counter with the key fires in its window (one chain) and not outside it; the same chain without the key plays the
 *   old rule (control);
 * - the highlight (`planChain`, `enemyRefusal`, `linkRadiusOf`) shows the power and R the dash uses; the plan changes nothing;
 * - «Наледь»: the path freezes the enemies that enter it, the trail lies 2 s, the highlight's trail (`frostPassPreview`) is
 *   the trail the dash lays, it stacks with the fire of the hammer;
 * - bot fights with the key and every item replay from their journals to the same hash; a journal without the new keys and
 *   ids plays the old world.
 */
import { buildModules, linkRadiusOf } from './build';
import { COUNTER_TALISMANS as T, FROST_PASS, HAMMERS } from './buildIds';
import { canJump, chainAnchor, enemyRefusal, nextCandidates, nextObjectCandidates, planChain } from './chain';
import { dist } from './geometry';
import { FROST_PASS_LIFE, frostPassPoints, frostPassPreview } from './frostPass';
import { hammerFirePoints } from './hammers';
import { worldState } from './hash';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { SIM_DT, Simulation, replay, type Journal } from './simulation';
import { SHOCKWAVE_RADIUS, THIRD_CHAIN_WINDOW } from './talismansRt';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

/** A quiet fight: no newcomers, enemies stand, touches do not hurt, no hit-stop, no knockback of a survivor. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false; p.survivorKnockback = false;
  return Object.assign(p, extra);
}
const WINDOW: Partial<Params> = { counterWindow: true };
function fight(talismans: string[], extra: Partial<Params> = {}, loadout: Loadout = {}, seed = 11): Simulation {
  const sim = new Simulation({ arena: 'kills', params: quiet(extra), seed, record: true, loadout: { ...loadout, talismans } });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, extra: { elite?: boolean; color?: number } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: 'basic', ...extra.elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Enemies in a row from (x0, y), 1 unit apart. */
const row = (sim: Simulation, x0: number, y: number, hps: readonly number[], color = 0): Enemy[] => hps.map((hp, i) => place(sim, x0 + i, y, hp, { color }));
function draw(sim: Simulation, points: readonly { x: number; y: number }[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
function settle(sim: Simulation, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 600 && (sim.world.move || i === 0); i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function ticks(sim: Simulation, n: number, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
function chain(sim: Simulation, points: readonly { x: number; y: number }[]): WorldEvent[] {
  draw(sim, points);
  sim.command({ t: 'release' });
  return settle(sim);
}
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const fired = (events: readonly WorldEvent[], id: string): number => events.filter(e => e.type === 'talismanFired' && e.id === id).length;
type Hit = Extract<WorldEvent, { type: 'chainHit' }>;
const hits = (events: readonly WorldEvent[]): Hit[] => events.filter((e): e is Hit => e.type === 'chainHit');
const marks = (list: readonly { damage: number; killed: boolean }[]): string => list.map(h => `${h.damage}${h.killed ? '' : '!'}`).join();
const progressOf = (w: World, id: string) => buildModules().find(m => m.id === id)!.progress?.(w) ?? null;

/**
 * Draws `points`, reads the highlight (and checks it changes nothing), releases and settles: the plan's outcomes and the
 * dash's hits, as «damage» or «damage!» (a survivor).
 */
function planAndDash(sim: Simulation, points: readonly { x: number; y: number }[], progress?: string) {
  const shown: (number | null)[] = [];
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  if (progress) shown.push(progressOf(sim.world, progress)?.value ?? null);
  for (const p of points.slice(1)) { sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' }); if (progress) shown.push(progressOf(sim.world, progress)?.value ?? null); }
  const before = sim.hash(), plan = planChain(sim.world);
  assert(sim.hash() === before, 'the plan changes nothing');
  sim.command({ t: 'release' });
  const events = settle(sim);
  const planned = marks(plan.links.flatMap(l => (l.outcome ? [l.outcome] : [])));
  return { plan, planned, dashed: marks(hits(events)), events, shown };
}

// ---- «Острие» (fifth-link) ----

check('«Острие»: with the window the 3rd enemy link gets +2 before its hit (the 5th does not); the highlight shows the same; without the key — the old 5th link', () => {
  const hps = [0, 0, 4, 0, 0, 7];
  const play = (extra: Partial<Params>, talismans = [T.fifthLink]) => {
    const sim = fight(talismans, extra);
    sim.command({ t: 'teleport', x: 1, y: 6 });
    const links = row(sim, 2, 6, hps);
    return { sim, links, ...planAndDash(sim, links, talismans.length ? T.fifthLink : undefined) };
  };
  const mod = play(WINDOW);
  assert(mod.dashed === '1,2,5,2,3,4!' && mod.planned === mod.dashed, `dash ${mod.dashed}, plan ${mod.planned}`);
  const order = mod.events.filter(e => e.type === 'chainHit' || e.type === 'talismanFired').map(e => (e.type === 'chainHit' ? 'h' : 'F')).join('');
  assert(order === 'hhhFhhh', `the signal right after the 3rd hit only (${order})`);
  assert(mod.shown.join() === '1,2,3,3,3,3', `HUD while drawing ${mod.shown}`);
  assert(replays(mod.sim), 'replay');
  // Without the key: the old window — the 3rd link (4 HP) survives power 2 + 1 and ends the chain.
  const old = play({});
  assert(old.dashed === '1,2,3!' && old.planned === old.dashed && alive(old.sim.world, old.links[2]), `old rule ${old.dashed}`);
  // Without the talisman, with the key: no bonus.
  const plain = play(WINDOW, []);
  assert(plain.dashed === '1,2,3!', `control ${plain.dashed}`);
});

// ---- «Улов» (third-chain) ----

check('«Улов»: with the window a chain that killed 3+ makes the next jump free for 5 s; chains of 2 kills never add up; without the key — the old count', () => {
  const sim = fight([T.thirdChain], WINDOW), w = sim.world;
  const kills = (n: number) => { sim.command({ t: 'clear', keepMarked: false }); sim.command({ t: 'teleport', x: 4, y: 6 }); return chain(sim, row(sim, 5, 6, new Array(n).fill(0))); };
  const jumpFree = (): boolean => { sim.command({ t: 'clear', keepMarked: false }); sim.command({ t: 'teleport', x: 4, y: 6 }); sim.command({ t: 'energy', value: 0 }); const ok = sim.command({ t: 'jump', x: 5.5, y: 6 }) === true; settle(sim); return ok; };
  const two = [...kills(2), ...kills(2), ...kills(2), ...kills(2)];
  assert(fired(two, T.thirdChain) === 0 && !jumpFree(), 'four chains of 2 kills: no free jump');
  assert(progressOf(w, T.thirdChain) === null, 'nothing to show at rest');
  const three = kills(3);
  assert(fired(three, T.thirdChain) === 1 && progressOf(w, T.thirdChain)?.value === 3, 'a chain of 3 kills fires; HUD armed');
  assert(jumpFree() && w.energy === 0, 'the jump is free');
  assert(!jumpFree(), 'only one free jump');
  kills(4);
  ticks(sim, Math.floor((THIRD_CHAIN_WINDOW - 0.2) / SIM_DT));
  assert(jumpFree(), 'still free just before 5 s');
  kills(3);
  ticks(sim, Math.ceil((THIRD_CHAIN_WINDOW + 0.1) / SIM_DT));
  assert(!jumpFree(), 'the window closed after 5 s');
  assert(replays(sim), 'replay');
  // Without the key: one chain of 3 kills is the 1st killing chain — no free jump.
  const old = fight([T.thirdChain]);
  old.command({ t: 'teleport', x: 4, y: 6 });
  chain(old, row(old, 5, 6, [0, 0, 0]));
  old.command({ t: 'teleport', x: 4, y: 6 }); old.command({ t: 'energy', value: 0 });
  assert(old.command({ t: 'jump', x: 5.5, y: 6 }) === false, 'old rule: the 1st killing chain gives no free jump');
});

// ---- «Призма» ----

check('«Призма»: with the window the links after a crystal get +1 power (no energy); the highlight shows it; without the key — +1 energy, no power', () => {
  const play = (talismans: string[], extra: Partial<Params>) => {
    const sim = fight(talismans, extra), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const a = place(sim, 5, 6, 0, { color: 0 });
    const c1 = { x: 6, y: 6 }; sim.command({ t: 'crystal', ...c1, value: 0 });
    const b = place(sim, 7, 6, 2, { color: 1 });
    const c = place(sim, 8, 6, 3, { color: 1 });
    sim.command({ t: 'energy', value: 0 });
    return { sim, w, ...planAndDash(sim, [a, c1, b, c]) };
  };
  const per = defaultParams().energyPerKill;
  const mod = play([T.prism], WINDOW);
  assert(mod.dashed === '1,3,3' && mod.planned === mod.dashed, `dash ${mod.dashed}, plan ${mod.planned}`);
  assert(near(mod.w.energy, 3 * per) && fired(mod.events, T.prism) === 2, `no energy (${mod.w.energy}), two signals`);
  assert(replays(mod.sim), 'replay');
  const old = play([T.prism], {});
  // Energy comes with every hit (three), the old «Призма» +1 for the crystal.
  assert(old.dashed === '1,2,1!' && old.planned === old.dashed && near(old.w.energy, 3 * per + 1), `old rule ${old.dashed}, energy ${old.w.energy}`);
  const plain = play([], WINDOW);
  assert(plain.dashed === '1,2,1!', `control ${plain.dashed}`);
});

check('«Призма»: with the window and «Смена цвета» the links after the link that freed the colour get +1; the link itself — not', () => {
  const play = (talismans: string[]) => {
    const sim = fight(talismans, { ...WINDOW, colorShiftLinks: 2 });
    sim.command({ t: 'teleport', x: 4, y: 6 });
    // Two of colour 0 free the colour on the 2nd; then 4 HP and a weak one of colour 1.
    const links = [place(sim, 5, 6, 0, { color: 0 }), place(sim, 6, 6, 0, { color: 0 }), place(sim, 7, 6, 4, { color: 1 }), place(sim, 8, 6, 0, { color: 1 })];
    return { sim, ...planAndDash(sim, links) };
  };
  const mod = play([T.prism]);
  assert(mod.dashed === '1,2,4,2' && mod.planned === mod.dashed, `dash ${mod.dashed}, plan ${mod.planned}`);
  const plain = play([]);
  assert(plain.dashed === '1,2,3!', `control ${plain.dashed}`);
  assert(replays(mod.sim), 'replay');
});

// ---- «Ударная волна» ----

check('«Ударная волна»: with the window a chain of 4 enemy links sends the wave, 3 — not; the panel threshold counts; without the key 4 links — none', () => {
  const play = (talismans: string[], links: number, extra: Partial<Params>) => {
    const sim = fight(talismans, extra), w = sim.world;
    sim.command({ t: 'teleport', x: 3, y: 6 });
    const chainLinks = row(sim, 4, 6, new Array(links).fill(0));
    const end = chainLinks[links - 1];
    const inside = place(sim, end.x - 0.5, end.y - 1.4, 0, { color: 1 });
    const events = chain(sim, chainLinks);
    return { sim, w, events, inside };
  };
  const mod = play([T.shockwave], 4, WINDOW);
  const wave = mod.events.find((e): e is Extract<WorldEvent, { type: 'wave' }> => e.type === 'wave');
  assert(wave && wave.r === SHOCKWAVE_RADIUS && !alive(mod.w, mod.inside) && fired(mod.events, T.shockwave) === 1, `wave ${JSON.stringify(wave)}`);
  assert(replays(mod.sim), 'replay');
  const three = play([T.shockwave], 3, WINDOW);
  assert(!three.events.some(e => e.type === 'wave') && alive(three.w, three.inside), '3 links: no wave');
  const five = play([T.shockwave], 4, { ...WINDOW, shockwaveLinks: 5 });
  assert(!five.events.some(e => e.type === 'wave'), 'the panel threshold 5: 4 links send no wave');
  const old = play([T.shockwave], 4, {});
  assert(!old.events.some(e => e.type === 'wave') && alive(old.w, old.inside), 'old rule: 4 links send no wave');
});

// ---- «Добивание» ----

check('«Добивание»: with the window the shield is ×2 only when the last link was the toughest of the chain and died; without the key — any dead last link', () => {
  const base = defaultParams().chainShield;
  const play = (hps: number[], extra: Partial<Params>) => {
    const sim = fight([T.finisher], extra);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const events = chain(sim, row(sim, 5, 6, hps));
    return { sim, shield: sim.world.hero.chainShield, events };
  };
  const doubled = (s: number) => near(s, 2 * base - SIM_DT, 1e-9), single = (s: number) => near(s, base - SIM_DT, 1e-9);
  const toughest = play([0, 0, 3], WINDOW);
  assert(doubled(toughest.shield) && fired(toughest.events, T.finisher) === 1, `the toughest last: ${toughest.shield}`);
  const weaker = play([0, 0, 2, 0], WINDOW);
  assert(single(weaker.shield) && fired(weaker.events, T.finisher) === 0, `a weaker last: ${weaker.shield}`);
  const tie = play([0, 0, 0], WINDOW);
  assert(doubled(tie.shield), `a tie counts: ${tie.shield}`);
  const survivor = play([0, 0, 9], WINDOW);
  assert(single(survivor.shield), `a surviving last: ${survivor.shield}`);
  assert(toughest.sim.world.build === undefined, 'the release note is gone after the chain');
  assert(replays(toughest.sim) && replays(weaker.sim), 'replay');
  const old = play([0, 0, 2, 0], {});
  assert(doubled(old.shield), `old rule: a weaker dead last still ×2 (${old.shield})`);
});

// ---- «Охотник на элит» ----

check('«Охотник на элит»: with the window a tough link (HP above 0) gives the tail +3 as an elite does, a weak one — nothing; the highlight shows it; without the key — only elites', () => {
  const play = (extra: Partial<Params>) => {
    const sim = fight([T.eliteHunter], extra);
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const links = row(sim, 5, 6, [0, 1, 5, 4]);
    return { sim, links, ...planAndDash(sim, links) };
  };
  const mod = play(WINDOW);
  // Weak (no +3: the 2nd is struck with 2), 1 HP (+3), 5 HP (+3), then 4 HP dies with 3 + 1.
  assert(mod.dashed === '1,2,5,4' && mod.planned === mod.dashed && mod.links.every(e => !alive(mod.sim.world, e)), `dash ${mod.dashed}, plan ${mod.planned}`);
  assert(fired(mod.events, T.eliteHunter) === 3, 'three signals (the tough links, as for an elite; the weak one gives nothing)');
  assert(replays(mod.sim), 'replay');
  const old = play({});
  assert(old.dashed === '1,2,2!' && old.planned === old.dashed, `old rule ${old.dashed}`);
  // An elite still gives +3 with the window: an elite (1 HP) spends the power, then 4 HP dies with 3 + 1.
  const sim = fight([T.eliteHunter], WINDOW);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const elite = place(sim, 5, 6, 0, { elite: true }), four = place(sim, 6, 6, 4);
  const e = planAndDash(sim, [elite, four]);
  assert(e.dashed === '1,4' && e.planned === e.dashed, `elite ${e.dashed}`);
});

// ---- «Длинная рука» ----

check('«Длинная рука»: with the window the 3rd link and later are taken with R ×1.5, the 2nd — not; the refusal, R and the drag agree; without the key — no', () => {
  const play = (extra: Partial<Params>) => {
    const sim = fight([T.longArm], { linkToEdge: false, ...extra }), w = sim.world, base = linkRadiusOf(w);
    sim.command({ t: 'teleport', x: 2, y: 5 });
    const a = place(sim, 3.5, 5, 0), b = place(sim, 5, 5, 0);
    // 1.3 R from the 2nd link (the 3rd), and a far 2nd candidate 1.3 R from the 1st link.
    const c = place(sim, 5 + 1.3 * base, 5, 0), far2 = place(sim, 3.5, 5 + 1.3 * base, 0);
    const r: number[] = [linkRadiusOf(w) / base];
    sim.command({ t: 'begin', x: a.x, y: a.y });
    r.push(linkRadiusOf(w) / base);
    const secondRefusal = enemyRefusal(w, far2), hud1 = progressOf(w, T.longArm)?.value ?? null;
    sim.command({ t: 'drag', x: b.x, y: b.y, mode: 'full' });
    r.push(linkRadiusOf(w) / base);
    const thirdRefusal = enemyRefusal(w, c), hud2 = progressOf(w, T.longArm)?.value ?? null;
    sim.command({ t: 'drag', x: c.x, y: c.y, mode: 'full' });
    const length = w.chain.length;
    sim.command({ t: 'release' });
    const events = settle(sim);
    return { sim, w, r, secondRefusal, thirdRefusal, length, events, base, hud: [hud1, hud2] };
  };
  const mod = play(WINDOW);
  assert(mod.r.join() === '1,1,1.5', `R factors ${mod.r}`);
  assert(mod.secondRefusal === 'far' && mod.thirdRefusal === null && mod.length === 3, `2nd ${mod.secondRefusal}, 3rd ${mod.thirdRefusal}, chain ${mod.length}`);
  assert(fired(mod.events, T.longArm) === 1 && mod.hud.join() === '1,2', `signal, HUD ${mod.hud}`);
  assert(near(linkRadiusOf(mod.w), mod.base), 'R back to usual after the chain');
  assert(replays(mod.sim), 'replay');
  const old = play({});
  assert(old.r.join() === '1,1,1' && old.thirdRefusal === 'far' && old.length === 2, `old rule: R ${old.r}, 3rd ${old.thirdRefusal}`);
});

// ---- «Иней на клинке» ----

check('«Иней на клинке»: with the window a chain of 3+ links ended on a survivor freezes it 2 s (not brittle); 2 links or no survivor — not; without the key — the 4th chain only', () => {
  const play = (extra: Partial<Params>, hps: number[]) => {
    const sim = fight([T.frostEdge], extra), w = sim.world;
    sim.command({ t: 'teleport', x: 4, y: 6 });
    const links = row(sim, 5, 6, hps);
    const events = chain(sim, links);
    const last = links[links.length - 1];
    return { sim, w, last, events, frozen: alive(w, last) && (last.chill ?? 0) > 0 };
  };
  const mod = play(WINDOW, [0, 0, 5]);
  assert(mod.frozen && mod.last.chill! > 2 - 2 * SIM_DT && mod.last.chill! <= 2 && !mod.last.brittle && fired(mod.events, T.frostEdge) === 1, `frozen 2 s (chill ${mod.last.chill})`);
  assert(replays(mod.sim), 'replay');
  assert(!play(WINDOW, [0, 5]).frozen, '2 links: no freeze');
  const all = play(WINDOW, [0, 0, 0]);
  assert(fired(all.events, T.frostEdge) === 0, 'no survivor: nothing');
  assert(!play({}, [0, 0, 5]).frozen, 'old rule: the 1st chain does not freeze');
});

// ---- «Наледь» (frost-pass) ----

/** Positions of points, sorted, rounded to 1e-6 (the dash lays them tick by tick, the preview at once). */
const spots = (points: readonly { x: number; y: number }[]): string => points.map(p => `${p.x.toFixed(6)}:${p.y.toFixed(6)}`).sort().join(' ');

check('«Наледь»: the dash leaves a trail that freezes enemies on it (the consumable\'s cold) and those that enter it; it lies 2 s; nothing without the talisman', () => {
  const play = (talismans: string[]) => {
    const sim = fight(talismans), w = sim.world;
    sim.command({ t: 'teleport', x: 2, y: 5 });
    const links = row(sim, 3, 5, [0, 0, 0]);
    const on = place(sim, 3.5, 5.2, 3, { color: 1 }), off = place(sim, 4.5, 6.2, 3, { color: 1 });
    // Placed bodies step out of the arena's trees on the first tick.
    ticks(sim, 2);
    const events = chain(sim, links);
    return { sim, w, on, off, events };
  };
  const mod = play([FROST_PASS]), w = mod.w, frostTime = w.params.frostTime;
  assert((mod.on.chill ?? 0) > frostTime - 1 && mod.on.brittle === true, `on the path: frozen and brittle (chill ${mod.on.chill})`);
  assert(mod.off.chill === undefined, 'off the path: not frozen');
  assert(frostPassPoints(w).length > 0 && fired(mod.events, FROST_PASS) >= 1, 'the trail lies; the signal');
  // An enemy that enters the trail (placed on it) freezes on the next tick.
  const point = frostPassPoints(w)[2];
  const enters = place(mod.sim, point.x, point.y, 2, { color: 2 });
  ticks(mod.sim, 1);
  assert((enters.chill ?? 0) > 0 && enters.brittle === true, 'an enemy entering the trail freezes');
  // The trail lies 2 s: after it an enemy on the same spot stays as it is, and the module's state is gone.
  ticks(mod.sim, Math.ceil(FROST_PASS_LIFE / SIM_DT) + 1);
  assert(frostPassPoints(w).length === 0 && w.build === undefined, 'the trail is gone after 2 s (no state left)');
  const late = place(mod.sim, point.x, point.y, 2, { color: 2 });
  ticks(mod.sim, 2);
  assert(late.chill === undefined, 'after 2 s nothing freezes');
  assert(replays(mod.sim), 'replay');
  const plain = play([]);
  assert(plain.on.chill === undefined && plain.w.build === undefined, 'control: no trail without the talisman');
});

check('«Наледь»: the highlight\'s trail is the trail the dash lays — kills, a crystal, a survivor and the way back; the pierce of «Прямая»; the preview changes nothing', () => {
  // 1. Kills, a crystal, then a survivor: the hero comes back to the last spot.
  const sim = fight([FROST_PASS]), w = sim.world;
  sim.command({ t: 'teleport', x: 2, y: 5 });
  const a = place(sim, 3, 5, 0, { color: 0 });
  const c1 = { x: 4, y: 5.6 }; sim.command({ t: 'crystal', ...c1, value: 0 });
  const b = place(sim, 5, 5, 0, { color: 1 }), s = place(sim, 6.2, 4.4, 5, { color: 1 });
  ticks(sim, 2);
  draw(sim, [a, c1, b, s]);
  const before = sim.hash(), preview = frostPassPreview(w);
  assert(sim.hash() === before && preview.length > 8,`the preview changes nothing (${preview.length} points)`);
  sim.command({ t: 'release' });
  settle(sim);
  assert(alive(w, s) && spots(frostPassPoints(w)) === spots(preview), `laid ${frostPassPoints(w).length} = shown ${preview.length}`);
  assert(frostPassPreview(w).length === 0, 'no preview without a drawn chain');
  assert(replays(sim), 'replay');
  // 2. «Прямая»: a straight killing tail runs on to the pierce's end — the trail goes along.
  const p = fight([FROST_PASS], { pierceEnabled: true }), pw = p.world;
  p.command({ t: 'teleport', x: 2, y: 5 });
  const tail = row(p, 3, 5, [0, 0, 0]);
  place(p, 6.8, 5, 9, { color: 1 });
  ticks(p, 2);
  draw(p, tail);
  const plan = planChain(pw), shown = frostPassPreview(pw);
  assert(plan.pierce && plan.pierce.length > 0.5, 'a pierce is planned');
  p.command({ t: 'release' });
  settle(p);
  const laid = frostPassPoints(pw);
  assert(spots(laid) === spots(shown) && laid.some(q => q.x > 5 + 0.3), `pierce trail: laid ${laid.length} = shown ${shown.length}`);
  assert(replays(p), 'replay');
});

check('«Наледь» stacks with a hammer (design answer 2): with «Огненный проход» fire and frost lie on one path; an enemy on it freezes and burns', () => {
  const sim = fight([FROST_PASS], {}, { hammer: HAMMERS.fire }), w = sim.world;
  sim.command({ t: 'teleport', x: 2, y: 5 });
  const links = row(sim, 3, 5, [0, 0, 0]);
  const on = place(sim, 3.5, 5.2, 3, { color: 1 });
  ticks(sim, 2);
  chain(sim, links);
  assert(spots(hammerFirePoints(w)) === spots(frostPassPoints(w)), 'fire and frost on the same spots');
  const hp = (): number => on.hp;
  assert((on.chill ?? 0) > 0 && hp() === 2, `frozen and burned (HP ${on.hp}, chill ${on.chill})`);
  ticks(sim, Math.ceil(1.1 / SIM_DT));
  assert(hp() === 1 && (on.chill ?? 0) > 0, `it stands in the fire, frozen: burned again (HP ${on.hp})`);
  assert(replays(sim), 'replay');
});

// ---- Bot fights: the key and every item replay; seeds differ; a journal without the keys and ids is the old world ----

const ALL = [...Object.values(T), FROST_PASS];

function playChain(sim: Simulation): void {
  const w = sim.world;
  if (w.move || w.chain.length || w.status !== 'playing') return;
  const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
  if (!first) return;
  sim.command({ t: 'begin', x: first.x, y: first.y });
  for (let k = 0; k < 12 && w.chain.length; k++) {
    const plan = planChain(w);
    if (plan.endsOnSurvivor || plan.endsOnObject) break;
    const from = chainAnchor(w);
    const next = [...nextCandidates(w), ...nextObjectCandidates(w).filter(o => o.kind === 'crystal')].sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (!next) break;
    const before = w.chain.length;
    sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
    if (w.chain.length <= before) break;
  }
  sim.command({ t: 'release' });
}

function botFight(arena: string, seed: number, extra: Partial<Params>, talismans: string[]) {
  const params = Object.assign(defaultParams(), extra);
  const sim = new Simulation({ arena, params, seed, record: true, hero: { hp: 30, maxHp: 30 }, loadout: { talismans, hammer: HAMMERS.fire, energy: 3 } });
  const w = sim.world, checkpoints: string[] = [];
  for (let tick = 0; tick < 1500 && w.status === 'playing'; tick++) {
    if (tick % 40 === 15) playChain(sim);
    if (tick % 500 === 300 && canJump(w)) sim.command({ t: 'jump', x: w.hero.x + 2, y: w.hero.y - 1 });
    sim.tick();
    w.events.length = 0;
    if (w.tick % 300 === 0) checkpoints.push(sim.hash());
  }
  return { sim, checkpoints };
}

check('bot fights with the window, all eight counters, «Наледь» and the fire hammer replay from their journals to the same hash at every 300 ticks; seeds give different fights', () => {
  for (const arena of ['glade', 'ford']) {
    const hashes: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const played = botFight(arena, seedOf(k), WINDOW, ALL);
      const journal = JSON.parse(JSON.stringify(played.sim.exportJournal()!)) as Journal;
      const again: string[] = [];
      const copy = replay(journal, step => { step.world.events.length = 0; if (step.world.tick % 300 === 0) again.push(step.hash()); });
      assert(copy.hash() === played.sim.hash(), `${arena} seed ${k}: replay`);
      assert(again.length === played.checkpoints.length && again.every((h, n) => h === played.checkpoints[n]), `${arena} seed ${k}: a checkpoint differs`);
      assert(played.sim.world.stats.kills > 0, `${arena} seed ${k}: the bot killed`);
      hashes.push(played.sim.hash());
    }
    assert(new Set(hashes).size === 3, `${arena}: three seeds, three fights`);
    assert(botFight(arena, seedOf(1), WINDOW, ALL).sim.hash() === hashes[0], `${arena}: the same seed, the same fight`);
  }
});

check('a journal without `counterWindow` and `shockwaveLinks` (the counters, the key off) plays the same world; a fight without «Наледь» keeps no state of it', () => {
  const stateWithoutParams = (sim: Simulation): string => { const { params: _p, ...rest } = worldState(sim.world) as Record<string, unknown>; return JSON.stringify(rest); };
  for (let k = 1; k <= 2; k++) {
    const played = botFight('glade', seedOf(k), { counterWindow: false }, Object.values(T));
    const journal = JSON.parse(JSON.stringify(played.sim.exportJournal()!)) as Journal;
    const raw = journal.params as unknown as Record<string, unknown>;
    delete raw.counterWindow; delete raw.shockwaveLinks;
    const copy = replay(journal, step => { step.world.events.length = 0; });
    assert(stateWithoutParams(copy) === stateWithoutParams(played.sim), `seed ${k}: the old world`);
    assert(played.sim.world.build?.[FROST_PASS] === undefined, `seed ${k}: no frost state`);
  }
});

console.log(`realtime-counters-window: ${checks} checks passed`);
