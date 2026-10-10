/**
 * The build layer of phase B (track Д0; docs/realtime-phase-b.md, section 9, «Д0»). Node only: `npm run test:realtime-build`.
 *
 * - Journals recorded before phase B replay to their hash: the two browser fixtures and two bot fights recorded on the code
 *   before the layer (tests/fixtures/realtime-legacy-build-journals.json: a run-like loadout with every old talisman,
 *   consumables, elites with affixes; a sandbox fight without a loadout).
 * - Without a build item the getters give the old numbers and the layer writes no state.
 * - Test modules registered here (the core is not edited) act through real commands: a power hook — the highlight and the
 *   dash agree on who dies, and the hook decides it; number modifiers change R, focus, speeds, healing, the jump, crystals,
 *   the gain and the after-chain shield; a build hit on a link ahead makes it a fallen link of the player; a return run after
 *   the dash leaves the hero untouchable and ends where it started; every fight replays from its journal to the same hash.
 */
import browserJournal from '../../../tests/fixtures/realtime-browser-journal.json';
import shieldsWolvesJournal from '../../../tests/fixtures/realtime-browser-journal-shields-wolves.json';
import legacyJournals from '../../../tests/fixtures/realtime-legacy-build-journals.json';
import {
  addCounter, buildModules, chainShieldOf, counterOf, crystalEveryOf, enemyWalkFactorOf, focusMaxOf, heroSpeedOf, itemHealOf, jumpCostOf, linkGainOf,
  linkRadiusOf, registerBuildModule, setBuildState, talismanFired, type ChainEnd, type LinkContext,
} from './build';
import { BUILD_SOURCES, HAMMERS } from './buildIds';
import { buildHit, buildHitAll, enemiesInCircle } from './buildHits';
import { planChain, startReturnRun } from './chain';
import { worldState } from './hash';
import { defaultParams, type Params } from './params';
import { Simulation, replay, type Journal } from './simulation';
import { canBeHurt, createWorld, type Enemy, type World, type WorldEvent } from './world';
import { arenaTemplate } from './arenas';
import { dhypot } from './detMath';
import type { Loadout } from './kit';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/** Every talisman of the real-time run before phase B. */
const OLD_TALISMANS = ['whetstone', 'dew-flask', 'tough-hide', 'millstone-shard', 'hourglass', 'nimble-paws', 'ash-ward', 'hero-anchor', 'oath-hunger'];

/** A quiet fight: no newcomers, enemies stand, touches do not hurt — only what the test places acts. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6;
  p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0;
  p.hitstop = false;
  return Object.assign(p, extra);
}
function fight(params: Params, loadout: Loadout, seed = 11, hero?: { hp: number; maxHp: number }): Simulation {
  const sim = new Simulation({ arena: 'kills', params, seed, record: true, loadout, ...hero ? { hero } : {} });
  sim.command({ t: 'clear', keepMarked: false });
  return sim;
}
const place = (sim: Simulation, x: number, y: number, hp: number, extra: { elite?: boolean; kind?: string; color?: number } = {}): Enemy => {
  const id = sim.command({ t: 'place', x, y, color: extra.color ?? 0, hp, kind: extra.kind ?? 'basic', ...extra.elite ? { elite: true } : {} }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
/** Draws a chain through the enemies in order (the first press, then drags). */
function draw(sim: Simulation, links: readonly Enemy[]): void {
  sim.command({ t: 'begin', x: links[0].x, y: links[0].y });
  for (const e of links.slice(1)) sim.command({ t: 'drag', x: e.x, y: e.y, mode: 'full' });
}
/** Ticks until the hero stands (the dash and anything the build started after it), collecting the events. */
function settle(sim: Simulation, events: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 600 && (sim.world.move || i === 0); i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; }
  return events;
}
const ticks = (sim: Simulation, n: number): void => { for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); sim.world.events.length = 0; } };
const alive = (w: World, e: Enemy): boolean => w.enemies.some(x => x.id === e.id);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const kitOf = (w: World): NonNullable<World['kit']> => w.kit!;

// ---- Test modules (registered here, as a talisman of the kit; `test-*` ids never reach a run) ----

/** What the hooks of the test modules saw (test-side log, outside the world: it is not hashed). */
const seen = { release: [] as number[], links: [] as { index: number; plan: boolean; elite: boolean }[], kills: [] as { id: number; fallen: boolean }[], crystals: 0, ends: [] as ChainEnd[], steps: [] as { kind: string; length: number }[], moveEnds: [] as string[], starts: 0, jumps: [] as number[] };
const resetSeen = (): void => {
  seen.release = []; seen.links = []; seen.kills = []; seen.crystals = 0; seen.ends = []; seen.steps = []; seen.moveEnds = []; seen.starts = 0; seen.jumps = [];
};
const pathLength = (path: readonly { x: number; y: number }[]): number => {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += dhypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return sum;
};

/** Power: +2 before every 3rd enemy link; +1 after the first elite of the chain. Counts chain kills in the kit. */
const POWER = 'test-build-power';
registerBuildModule({
  id: POWER,
  linkPower: (_w, link: LinkContext) => (link.index % 3 === 0 ? 2 : 0),
  afterLinkPower: (_w, link) => (link.elite && link.elitesBefore === 0 ? 1 : 0),
  progress: w => ({ value: counterOf(w, 'test-kills') % 5, max: 5 }),
  onArenaStart: () => { seen.starts++; },
  onRelease: (_w, release) => { seen.release.push(release.chain); },
  onLink: (_w, link) => { seen.links.push({ index: link.index, plan: link.plan, elite: link.elite }); },
  onChainKill: (w, kill) => { seen.kills.push({ id: kill.id, fallen: kill.fallen }); if (addCounter(w, 'test-kills', 1) % 5 === 0) talismanFired(w, POWER); },
  onCrystal: () => { seen.crystals++; },
  onChainEnd: (_w, end) => { seen.ends.push(end); },
  onDashStep: (_w, step) => { seen.steps.push({ kind: step.kind, length: pathLength(step.path) }); },
  onJump: (_w, cost) => { seen.jumps.push(cost); },
});

/** Numbers: R ×1.5, focus ×0.5, hero ×1.25, enemies' walk ×1.1, healing halved up, jump free, a crystal per 3, gain 2, shield ×2 after a killed last link. */
const NUMBERS = 'test-build-numbers';
registerBuildModule({
  id: NUMBERS,
  modify: {
    linkRadius: (_w, v) => v * 1.5,
    focusMax: (_w, v) => v * 0.5,
    heroSpeed: (_w, v) => v * 1.25,
    enemyWalk: (_w, v) => v * 1.1,
    itemHeal: (_w, v) => Math.ceil(v / 2),
    jumpCost: () => 0,
    crystalEvery: () => 3,
    linkGain: () => 2,
    chainShield: (_w, v, end) => (end?.last?.killed ? v * 2 : v),
  },
  onJump: (_w, cost) => { seen.jumps.push(cost); },
});

/** A build hit on a link ahead: the first tick of the dash cuts the chain's 3rd enemy link (as a hammer would, credited). */
const CUT_AHEAD = 'test-build-cut-ahead';
registerBuildModule({
  id: CUT_AHEAD,
  onDashStep: (w, step) => {
    const move = step.move;
    if (step.kind !== 'dash' || !move.build || w.build?.[CUT_AHEAD]) return;
    const target = move.links.filter(l => l.kind === 'enemy')[1];
    const e = target && w.enemies.find(x => x.id === target.id);
    setBuildState(w, CUT_AHEAD, { cut: target?.id ?? 0 });
    if (e) buildHit(w, e, 99, BUILD_SOURCES.hammerCut);
  },
  onChainKill: (_w, kill) => { seen.kills.push({ id: kill.id, fallen: kill.fallen }); },
});

/** A return run to the start of the chain after the dash, and a wave of 2 around the hero at its end. */
const RETURN = 'test-build-return';
registerBuildModule({
  id: RETURN,
  onChainEnd: (w, end) => {
    seen.ends.push(end);
    startReturnRun(w, [end.start], Math.max(1, Math.floor(end.power / 2)));
  },
  onDashStep: (_w, step) => { seen.steps.push({ kind: step.kind, length: pathLength(step.path) }); },
  onMoveEnd: (w, move) => {
    seen.moveEnds.push(move.kind);
    const hero = w.hero;
    w.events.push({ type: 'wave', x: hero.x, y: hero.y, r: 2 });
    buildHitAll(w, enemiesInCircle(w, hero, 2), 1, BUILD_SOURCES.wave);
  },
});

// ---- Old journals and the old numbers ----

check('journals recorded before phase B replay to their hash (browser fixtures, a run-like loadout with every old talisman, the sandbox)', () => {
  const fixtures = [browserJournal, shieldsWolvesJournal].map(f => f as unknown as { journal: Journal; hash: string });
  const legacy = (legacyJournals as unknown as { cases: { name: string; hash: string; journal: Journal }[] }).cases;
  assert(legacy.length === 2, 'two legacy journals');
  for (const f of [...fixtures, ...legacy]) {
    const sim = replay(f.journal);
    assert(sim.hash() === f.hash, `${'name' in f ? f.name : f.journal.arena}: recorded ${f.hash}, now ${sim.hash()}`);
  }
  const run = legacy[0].journal;
  assert(run.loadout?.talismans?.length === 8 && run.loadout.items && run.commands.some(c => c.cmd.t === 'jump') && run.commands.some(c => c.cmd.t === 'item'),
    'the run-like journal carries the old talismans, consumables, jumps and items');
});

check('without a build item the getters give the old numbers and the layer writes no state (registered modules wait)', () => {
  const params = defaultParams();
  const bare = createWorld(arenaTemplate('kills'), params, 3);
  const old = createWorld(arenaTemplate('kills'), params, 3, undefined, { talismans: OLD_TALISMANS, items: { healing: 2 } });
  for (const w of [bare, old]) {
    assert(linkRadiusOf(w) === params.linkRadius && focusMaxOf(w) === params.focusMax && heroSpeedOf(w) === params.heroSpeed, 'R, focus, hero speed');
    assert(enemyWalkFactorOf(w) === 1 && itemHealOf(w) === params.itemHeal && linkGainOf(w) === 1 && chainShieldOf(w) === params.chainShield, 'walk, healing, gain, shield');
    assert(w.focus === params.focusMax, `start focus ${w.focus}`);
  }
  assert(jumpCostOf(bare) === params.jumpCost && jumpCostOf(old) === params.jumpCost - 1, 'jump: 2, «Ловкие лапы» 1');
  assert(crystalEveryOf(bare) === params.crystalEvery && crystalEveryOf(old) === params.crystalEvery - 1, 'crystal: 6, «Осколок жернова» 5');
  // A fight with every old talisman: a chain, a dash — no `build`, no kit `chains` / `counters` / `hammer`, no `move.build`.
  const sim = fight(quiet(), { talismans: OLD_TALISMANS }), w = sim.world;
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 0, { elite: true }), place(sim, 7.6, 6, 0)];
  draw(sim, links);
  sim.command({ t: 'release' });
  sim.tick();
  assert(w.move?.kind === 'dash' && w.move.build === undefined, 'no layer count on the dash');
  settle(sim);
  const state = worldState(w) as Record<string, unknown>;
  assert(!('build' in state) && !('chains' in kitOf(w)) && !('counters' in kitOf(w)) && !('hammer' in kitOf(w)), `state keys: ${Object.keys(kitOf(w)).join(', ')}`);
  assert(links.every(e => !alive(w, e)), 'the chain killed');
  assert(seen.release.length === 0 && seen.ends.length === 0, 'no hook ran');
  assert(replays(sim), 'replay');
});

check('the hammer of the loadout reaches the kit (an unknown id is dropped)', () => {
  const params = defaultParams();
  const w = createWorld(arenaTemplate('kills'), params, 3, undefined, { hammer: HAMMERS.cut });
  assert(w.kit?.hammer === HAMMERS.cut, 'hammer in the kit');
  const bad = createWorld(arenaTemplate('kills'), params, 3, undefined, { hammer: 'stone-club' as never });
  assert(bad.kit && !('hammer' in bad.kit), 'unknown hammer dropped');
});

// ---- Power hooks: the highlight is the dash ----

/**
 * Seven links in a row, HP so that only the module's power kills them all: the 3rd (4 HP) needs +2 before it, the 5th (3 HP)
 * the +1 after the elite (the 4th), the 7th (4 HP) the +2 before the 6th. No old talisman: «Точильный камень» would add power.
 */
function powerChain(talismans: string[], seed = 21): { sim: Simulation; links: Enemy[] } {
  const sim = fight(quiet({ survivorKnockback: false }), { talismans }, seed);
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const hps = [0, 0, 4, 0, 3, 0, 4];
  const links = hps.map((hp, i) => place(sim, 5.2 + 1.2 * i, 6, hp, i === 3 ? { elite: true } : {}));
  draw(sim, links);
  return { sim, links };
}

check('a power hook: the highlight and the dash agree on every link, the hook decides who dies; the plan changes nothing', () => {
  resetSeen();
  // Control: without the module the 3rd link (4 HP, power 3) survives and ends the chain.
  const control = powerChain([]);
  const controlPlan = planChain(control.sim.world);
  assert(controlPlan.links.length === 3 && controlPlan.endsOnSurvivor, `control: the chain stops on the 3rd link (${controlPlan.links.length} links)`);
  // With the module: all seven die in the highlight.
  const { sim, links } = powerChain([POWER]), w = sim.world;
  assert(seen.starts === 1, 'onArenaStart once');
  assert(w.chain.length === 7, `seven links drawn (${w.chain.length})`);
  const before = sim.hash();
  const plan = planChain(w);
  for (let i = 0; i < 5; i++) planChain(w);
  assert(sim.hash() === before && seen.links.length === 0, 'the plan changes nothing and calls no event hook');
  assert(plan.links.every(l => l.outcome?.killed) && plan.kills === 7, `plan: ${plan.links.map(l => l.outcome?.killed).join(',')}`);
  sim.command({ t: 'release' });
  const events = settle(sim);
  const hits = events.filter((e): e is Extract<WorldEvent, { type: 'chainHit' }> => e.type === 'chainHit');
  assert(hits.length === 7, `seven hits (${hits.length})`);
  plan.links.forEach((l, i) => {
    assert(hits[i].enemyId === links[i].id && hits[i].damage === l.outcome!.damage && hits[i].killed === l.outcome!.killed, `link ${i + 1}: plan ${l.outcome!.damage}, dash ${hits[i].damage}`);
  });
  assert(links.every(e => !alive(w, e)) && w.stats.kills === 7, 'all seven dead');
  assert(seen.release.join() === '1' && seen.links.map(l => l.index).join() === '1,2,3,4,5,6,7' && seen.links.every(l => !l.plan), `hooks: release ${seen.release}, links ${seen.links.map(l => l.index)}`);
  assert(seen.links.filter(l => l.elite).length === 1 && seen.kills.length === 7, 'one elite link, seven chain kills');
  const end = seen.ends[0];
  assert(seen.ends.length === 1 && end.chain === 1 && end.kills === 7 && end.links === 7 && end.elites === 1 && end.last?.killed && end.last.id === links[6].id, `chain end ${JSON.stringify(end)}`);
  assert(near(end.start.x, 4) && near(end.start.y, 6), 'the chain started at the hero');
  // The dash path went to the hooks tick by tick: its length is the way from the hero to the last link.
  assert(seen.steps.every(s => s.kind === 'dash') && near(seen.steps.reduce((a, s) => a + s.length, 0), links[6].x - 4, 1e-6), `dash path ${seen.steps.reduce((a, s) => a + s.length, 0)}`);
  assert(kitOf(w).chains === 1 && counterOf(w, 'test-kills') === 7 && events.filter(e => e.type === 'talismanFired').length === 1, 'kit counts: one chain, seven kills, one signal at the 5th');
  const progress = buildModules().find(m => m.id === POWER)!.progress!(w);
  assert(progress?.value === 2 && progress.max === 5, `HUD progress ${JSON.stringify(progress)}`);
  assert(w.move === null && replays(sim), 'replay');
});

check('a power hook: the second chain on the arena gets the next number in the plan and in the dash', () => {
  resetSeen();
  const { sim } = powerChain([POWER], 23), w = sim.world;
  sim.command({ t: 'release' });
  settle(sim);
  const a = place(sim, w.hero.x + 1.2, w.hero.y, 0), b = place(sim, w.hero.x + 2.4, w.hero.y, 0), c = place(sim, w.hero.x + 3.6, w.hero.y, 4);
  draw(sim, [a, b, c]);
  assert(planChain(w).links[2].outcome?.killed, 'plan: the 3rd link of the 2nd chain dies (+2)');
  sim.command({ t: 'release' });
  settle(sim);
  assert(seen.release.join() === '1,2' && kitOf(w).chains === 2 && !alive(w, c), `chains ${seen.release}`);
  assert(replays(sim), 'replay');
});

// ---- Number modifiers through real actions ----

check('number modifiers act through the getters: R, focus, hero and enemy speed, healing, jump, crystals, gain, the after-chain shield', () => {
  resetSeen();
  const run = (talismans: string[]) => {
    const sim = fight(quiet({ enemySpeed: 1.2, survivorKnockback: false }), { talismans, items: { healing: 1 } }, 31, { hp: 1, maxHp: 15 });
    return { sim, w: sim.world };
  };
  const plain = run([]), mod = run([NUMBERS]);
  // Focus reserve at the start.
  assert(plain.w.focus === plain.w.params.focusMax && near(mod.w.focus, plain.w.params.focusMax / 2), `focus ${plain.w.focus} / ${mod.w.focus}`);
  // R: an enemy 2.5 from the hero (R 1.875 → 2.81) — a chain begins on it only with the module.
  for (const f of [plain, mod]) { f.sim.command({ t: 'teleport', x: 4, y: 6 }); place(f.sim, 6.5, 6, 0); }
  assert(plain.sim.command({ t: 'begin', x: 6.5, y: 6 }) === false && mod.sim.command({ t: 'begin', x: 6.5, y: 6 }) === true, 'R ×1.5');
  for (const f of [plain, mod]) { f.sim.command({ t: 'cancel' }); f.sim.command({ t: 'clear', keepMarked: false }); }
  // Healing 9 → 5.
  for (const f of [plain, mod]) f.sim.command({ t: 'item', kind: 'healing', x: 4, y: 6 });
  assert(plain.w.hero.hp === 10 && mod.w.hero.hp === 6, `healing ${plain.w.hero.hp - 1} / ${mod.w.hero.hp - 1}`);
  // Hero walk 30 ticks to the right; an enemy walks towards him from afar.
  const walkers = [plain, mod].map(f => {
    f.sim.command({ t: 'teleport', x: 4, y: 6 });
    const e = place(f.sim, 13, 4.5, 0, { color: 2 });
    f.sim.command({ t: 'walk', x: 1, y: 0 });
    const from = { x: e.x, y: e.y };
    ticks(f.sim, 30);
    f.sim.command({ t: 'walk', x: 0, y: 0 });
    return { hero: f.w.hero.x - 4, enemy: dhypot(e.x - from.x, e.y - from.y) };
  });
  assert(near(walkers[1].hero, walkers[0].hero * 1.25, 1e-6), `hero ${walkers[0].hero} → ${walkers[1].hero}`);
  assert(walkers[0].enemy > 0.3 && near(walkers[1].enemy, walkers[0].enemy * 1.1, 0.02), `enemy ${walkers[0].enemy} → ${walkers[1].enemy}`);
  // Jump at 0 energy: free with the module (onJump sees 0).
  for (const f of [plain, mod]) { f.sim.command({ t: 'clear', keepMarked: false }); f.sim.command({ t: 'teleport', x: 6, y: 6 }); f.sim.command({ t: 'energy', value: 0 }); }
  assert(plain.sim.command({ t: 'jump', x: 7, y: 6 }) === false && mod.sim.command({ t: 'jump', x: 7, y: 6 }) === true && seen.jumps.join() === '0', `jump ${seen.jumps}`);
  settle(mod.sim);
  // Gain 2 and a crystal per 3: three links (2, 0, 0 HP) — the first dies only with gain 2; the 3rd kill drops a crystal.
  for (const f of [plain, mod]) {
    f.sim.command({ t: 'teleport', x: 4, y: 6 });
    const links = [place(f.sim, 5.2, 6, 2), place(f.sim, 6.4, 6, 0), place(f.sim, 7.6, 6, 0)];
    draw(f.sim, links);
    f.sim.command({ t: 'release' });
    settle(f.sim);
  }
  assert(plain.w.stats.kills === 0 && plain.w.hero.chainShield === 0, `plain: the 2 HP link survives (kills ${plain.w.stats.kills})`);
  assert(mod.w.stats.kills === 3 && mod.w.stats.crystals === 1, `module: kills ${mod.w.stats.kills}, crystals ${mod.w.stats.crystals}`);
  // The shield ×2 after a killed last link: 0.5 → 1 (read on the tick the dash ended — it runs down after).
  assert(mod.w.hero.chainShield > mod.w.params.chainShield && mod.w.hero.chainShield <= 2 * mod.w.params.chainShield, `shield ${mod.w.hero.chainShield}`);
  assert(replays(plain.sim) && replays(mod.sim), 'replay');
});

// ---- A build hit on a link ahead; a return run ----

check('a build hit kills a link ahead during the dash: it is a fallen link — passed with +1, a credited kill of the chain', () => {
  resetSeen();
  const sim = fight(quiet({ survivorKnockback: false }), { talismans: [CUT_AHEAD] }, 41), w = sim.world;
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 1), place(sim, 7.6, 6, 1)];
  draw(sim, links);
  assert(w.chain.length === 3 && planChain(w).kills === 3, 'three links drawn');
  sim.command({ t: 'release' });
  const events = settle(sim);
  const cut = events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === links[1].id);
  assert(cut?.source === BUILD_SOURCES.hammerCut && cut.credited === true, `the cut kill: ${JSON.stringify(cut)}`);
  // The dash passed it (+1, no hit) and killed the link after it.
  assert(links.every(e => !alive(w, e)) && w.stats.kills === 3, `kills ${w.stats.kills}`);
  assert(seen.kills.map(k => `${k.id === links[1].id ? 'cut' : 'chain'}:${k.fallen}`).join() === 'chain:false,cut:true,chain:false', `chain kills ${JSON.stringify(seen.kills)}`);
  assert(w.lastChain?.kills === 3, `chain kills ${w.lastChain?.kills}`);
  assert(replays(sim), 'replay');
});

check('a return run after the dash: the hero runs back to the chain start untouchable, one chain end, a wave at the end credited to the player', () => {
  resetSeen();
  const sim = fight(quiet({ contactDamage: 1, survivorKnockback: false }), { talismans: [RETURN] }, 51), w = sim.world;
  sim.command({ t: 'teleport', x: 4, y: 6 });
  const links = [place(sim, 5.2, 6, 0), place(sim, 6.4, 6, 0), place(sim, 7.6, 6, 0)];
  // Enemies of another colour near the way back (they touch the hero) and one by the start (the wave takes it).
  place(sim, 6.4, 6.6, 3, { color: 1 });
  const byStart = place(sim, 4.6, 6.9, 0, { color: 2 });
  draw(sim, links);
  sim.command({ t: 'release' });
  const hp = w.hero.hp;
  let returning = 0, hurtable = 0;
  const events: WorldEvent[] = [];
  for (let i = 0; i < 600 && (w.move || i === 0); i++) {
    sim.tick(); events.push(...w.events); w.events.length = 0;
    if (w.move?.kind === 'return') { returning++; if (canBeHurt(w)) hurtable++; }
  }
  assert(returning > 3 && hurtable === 0 && w.hero.hp === hp, `return ticks ${returning}, hurtable ${hurtable}, HP ${hp} → ${w.hero.hp}`);
  assert(events.filter(e => e.type === 'chainEnd').length === 1 && seen.ends.length === 1 && seen.moveEnds.join() === 'return', 'one chain end, one return end');
  assert(near(w.hero.x, 4, 1e-6) && near(w.hero.y, 6, 1e-6), `the hero is back at the start (${w.hero.x}, ${w.hero.y})`);
  const back = seen.steps.filter(s => s.kind === 'return').reduce((a, s) => a + s.length, 0);
  assert(near(back, 3.6, 1e-6), `the return path ${back}`);
  const wave = events.find((e): e is Extract<WorldEvent, { type: 'kill' }> => e.type === 'kill' && e.enemyId === byStart.id);
  assert(wave?.source === BUILD_SOURCES.wave && wave.credited && w.stats.kills === 4 && events.some(e => e.type === 'wave'), `wave kill ${JSON.stringify(wave)}, kills ${w.stats.kills}`);
  assert(replays(sim), 'replay');
});

console.log(`realtime-build: ${checks} checks passed`);
