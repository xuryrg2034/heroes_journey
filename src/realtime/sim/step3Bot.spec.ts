/**
 * Task 59б: the bot of the step-3 measures (scripts/shotDodge.ts `potDodge`, scripts/step3Bot.ts `step3Chain`; spec 13: its three skills)
 * does what its policy says, by the game's own commands on the arenas of step 3 (sim/arenasStep3.ts). A check of the measuring tool on a
 * few seeds, not of a bot's win: the dodge leaves a pot's mark and is silent with no pot; the chain goes by the numbers 1 → 4; the
 * planner clears the pair in one pass when five links of A lead to it, and never releases a chain the highlight angers; with nothing
 * of step 3 the chain is the greedy one, command for command. Node only: `npm run test:realtime-step3-bot`. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { playChain } from '../../../scripts/loopBot';
import { potDodge } from '../../../scripts/shotDodge';
import { step3Chain } from '../../../scripts/step3Bot';
import { BARBICAN_ARENA, BARRACKS_ARENA, TARWORKS_ARENA } from './arenasStep3';
import { planChain } from './chain';
import { GUARD } from './enemies/garrison';
import { RECRUIT } from './enemies/recruit';
import { WARDEN, wardenAngry } from './enemies/warden';
import { defaultParams, type Params } from './params';
import { potsInFlight } from './pitch';
import { Simulation, SIM_DT } from './simulation';
import type { Enemy, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3, 4];

/** Nothing comes, touches do not hurt, the hero cannot fall; `walk` — the enemies walk at the default pace. */
function quiet(extra: Partial<Params> = {}, walk = false): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false;
  if (!walk) p.enemySpeed = 0;
  p.invulnerability = 0; p.chainShield = 0; p.maxEnemies = 1;
  return Object.assign(p, extra);
}
function fight(arena: string, k: number, walk = false, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena, params: quiet(extra, walk), seed: seedOf(k), record: true });
  sim.tick();
  return sim;
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events.splice(0)); }
  return out;
}

check('the pot dodge: in «Смолокурня» the bot steps off every mark under it (botFight\'s cadence: every 3 ticks) — no pot hits it in 20 s; the hero who stands is hit (4 seeds)', () => {
  for (const k of SEEDS) {
    const dodge = fight(TARWORKS_ARENA.id, k, true), w = dodge.world, events: WorldEvent[] = [];
    let dodging = false, asides = 0;
    for (let tick = 0; tick < ticksOf(20) && w.status === 'playing'; tick++) {
      if (tick % 3 === 0 && !w.move) {
        const aside = potDodge(w);
        if (aside) { dodge.command({ t: 'walk', x: aside.x, y: aside.y }); dodging = true; asides++; }
        else if (dodging) { dodge.command({ t: 'walk', x: 0, y: 0 }); dodging = false; }
      }
      ticks(dodge, 1, events);
    }
    const lands = events.filter(e => e.type === 'pot' && e.action === 'land');
    assert(lands.length >= 2 && asides > 0, `seed ${k}: pots fell (${lands.length}), the bot stepped aside`);
    assert(!lands.some(e => e.type === 'pot' && e.hit === 'hero'), `seed ${k}: no pot hit the dodging bot`);
    const stand = fight(TARWORKS_ARENA.id, k, true);
    assert(ticks(stand, ticksOf(20)).some(e => e.type === 'pot' && e.action === 'land' && e.hit === 'hero'), `seed ${k}: the one who stands is hit`);
  }
});

check('the pot dodge is silent with no pot: «Казарма» and «Барбакан» 20 s, the dodge never answers', () => {
  for (const arena of [BARRACKS_ARENA.id, BARBICAN_ARENA.id]) {
    const sim = fight(arena, 1, true);
    for (let tick = 0; tick < ticksOf(20); tick++) { assert(!potsInFlight(sim.world).length && potDodge(sim.world) === null, `${arena}: silent`); sim.tick(); }
  }
});

/** «Барбакан»: the hero below the right weak one of A (the start of the five), the pair. */
function atBarbican(k: number, extra: Partial<Params>): { sim: Simulation; a: Enemy; b: Enemy } {
  const sim = fight(BARBICAN_ARENA.id, k, false, extra), w = sim.world;
  const [a, b] = w.enemies.filter(e => e.kind === WARDEN).sort((x, y) => x.id - y.id);
  const right = w.enemies.filter(e => e.kind !== GUARD && e.kind !== WARDEN && e.color === a.color && e.y < 4).sort((x, y) => y.x - x.x)[0];
  sim.command({ t: 'teleport', x: right.x, y: right.y + 1.4 });
  return { sim, a, b };
}

check('the planner, «Смена цвета» 6 (the run\'s): from the five links of A it draws five A → A → B and releases — both wardens fall in one pass, no anger (4 seeds)', () => {
  for (const k of SEEDS) {
    const { sim, a, b } = atBarbican(k, { colorShiftLinks: 6 }), w = sim.world;
    assert(step3Chain(sim, true) === 1, `seed ${k}: released`);
    const events = ticks(sim, ticksOf(3));
    assert(!w.enemies.includes(a) && !w.enemies.includes(b) && !events.some(e => e.type === 'warden'), `seed ${k}: both fell, no anger`);
  }
});

check('the planner, «Смена цвета» off: a warden of a standing pair is never its link — the chain goes without the pair, both stand calm (4 seeds)', () => {
  for (const k of SEEDS) {
    const { sim, a, b } = atBarbican(k, { colorShiftLinks: 0 }), w = sim.world;
    assert(step3Chain(sim, true) === 1, `seed ${k}: a chain released`);
    ticks(sim, ticksOf(3));
    assert(w.enemies.includes(a) && w.enemies.includes(b) && !wardenAngry(a) && !wardenAngry(b), `seed ${k}: the pair stands, calm`);
  }
});

check('the planner reads the highlight: B moved out of reach (a built scene: 3 units off) — the chain that frees the colour at A would anger B, so it is cancelled; the released chain angers nobody, the pair stands calm (4 seeds)', () => {
  for (const k of SEEDS) {
    const { sim, a, b } = atBarbican(k, { colorShiftLinks: 6 }), w = sim.world;
    b.x += 3;
    let shown: number[] | undefined;
    const command = sim.command.bind(sim);
    sim.command = (c => { if (c.t === 'release') shown = planChain(w).anger; return command(c); }) as typeof sim.command;
    assert(step3Chain(sim, true) === 1, `seed ${k}: a chain released`);
    assert(!shown?.length, `seed ${k}: the released chain angers nobody in the highlight`);
    ticks(sim, ticksOf(3));
    assert(w.enemies.includes(a) && w.enemies.includes(b) && !wardenAngry(a) && !wardenAngry(b), `seed ${k}: the pair stands, calm`);
  }
});

check('the numbers: in «Казарма» from where the hero stands the chain goes 1 → 4 through the near formation — it falls whole, +2 (both modes, 4 seeds)', () => {
  for (const k of SEEDS) for (const planner of [false, true]) {
    const sim = fight(BARRACKS_ARENA.id, k), w = sim.world, near = w.enemies.filter(e => e.kind === RECRUIT && e.color === 0);
    assert(step3Chain(sim, planner) === 1, `seed ${k}: released`);
    const events = ticks(sim, ticksOf(3));
    assert(near.every(e => !w.enemies.includes(e)) && events.some(e => e.type === 'recruit' && e.action === 'drill' && e.energy === 2), `seed ${k} ${planner ? 'planner' : 'careless'}: the formation fell whole, +2`);
  }
});

check('the numbers first: a plain enemy of colour 0 nearer the hero than the formation and out of its reach (a built scene) — the bot still begins at the current number and the formation falls whole in the first chain (4 seeds)', () => {
  for (const k of SEEDS) {
    const sim = fight(BARRACKS_ARENA.id, k), w = sim.world;
    const plain = w.enemies.find(e => e.kind === 'basic' && e.color === 0)!;
    plain.x = w.hero.x; plain.y = w.hero.y + 1.1;
    assert(step3Chain(sim, false) === 1, `seed ${k}: released`);
    const events = ticks(sim, ticksOf(3));
    assert(events.some(e => e.type === 'recruit' && e.action === 'drill' && e.energy === 2) && w.enemies.includes(plain), `seed ${k}: the formation fell whole, the plain one stands`);
  }
});

check('nothing of step 3 for the bot (no numbered recruit; the pair without the planner): the chain is the greedy one, command for command (journal hash)', () => {
  for (const [arena, k] of [['g-yard', 1], ['g-gallery', 2], [BARBICAN_ARENA.id, 3], [TARWORKS_ARENA.id, 4]] as const) {
    const a = fight(arena, k, true), b = fight(arena, k, true);
    for (let tick = 0; tick < ticksOf(12); tick++) {
      if (tick % 45 === 20) { step3Chain(a, false); playChain(b); }
      a.tick(); b.tick();
    }
    assert(a.hash() === b.hash() && JSON.stringify(a.exportJournal()) === JSON.stringify(b.exportJournal()), `${arena}: the same fight`);
  }
});

console.log(`step 3 bot: ${checks} checks passed`);
