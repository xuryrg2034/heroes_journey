/**
 * Task 48 «Тролль» with tasks 49 (Ведунья) and 50 (ranks II of the counter talismans): the Troll's window («одно попадание за окно»,
 * sim/enemies/troll.ts) met by the end shadows of rank II and by the law of Ведунья (docs/realtime-elite-behaviors.md, «Тролль
 * (задача 48)»). Node only: `npm run test:realtime-troll-combos`.
 *
 * Every check plays journalled commands (teleport, place, chill, begin / drag, release) on «Берлога тролля» in the club's window
 * and looks at what the player meets — the highlight (`planChain`) and then the dash:
 * - «Ударная волна» II and «Возврат»: the start's wave takes the window's hit (the core in `honed.waves[1]`), the return run passes
 *   the core by (not in `back.hits`); the window's hits are exactly the wave's, the core loses one plate, the run strikes what the
 *   highlight said; without rank II the core is not struck, or (the run's path through it) the run takes the hit instead;
 * - «Иней на клинке» II: a chain of 3 ending in the core in its window — the core takes a plate and lives: the highlight names its
 *   neighbour (`honed.frost`) and the dash freezes it (the defect of the merge review 17.10.2026: no plan, no frost);
 * - Ведунья (`hero: 'toad'`): an open chain gives no shield, a ring around the open core takes the window's hit (`seal`) and gives
 *   the shield, a ring around the closed core gives the shield and leaves the core whole, the core link dropped by the window's end
 *   (held) leaves an open chain — `plan.noShield` is exactly «no shield at the chain's end».
 * Every fight replays from its journal. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { COUNTER_TALISMANS, HAMMERS } from './buildIds';
import { planChain } from './chain';
import { bodyRadiusOf } from './enemies/kinds';
import { TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL } from './enemies/troll';
import type { Vec } from './geometry';
import type { Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { replay, Simulation, SIM_DT } from './simulation';
import { HONE } from './talismansRt';
import type { Enemy, World, WorldEvent } from './world';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);
const SEEDS = [1, 2, 3];

/** Nothing comes but the Troll's own, the hero cannot fall, nobody walks, no touch; the chain window of the ranks (`counterWindow`). */
function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  p.trollHp = 4; p.trollPlates = 5; p.counterWindow = true;
  // Task 48, section 25: the sitting Troll — the values without `trollMove` (a journal before it; the arena turns it on only when it is off).
  delete (p as Partial<Params>).trollMove;
  return p;
}
interface Den { sim: Simulation; w: World; core: Enemy; club: Enemy; rock: Enemy; tail: Enemy }
function den(k: number, loadout?: Loadout): Den {
  const sim = new Simulation({ arena: 'troll', params: quiet(), seed: seedOf(k), record: true, ...loadout ? { loadout } : {} }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 12 });
  ticks(sim, 1);
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  return { sim, w, core: kind(TROLL), club: kind(TROLL_CLUB), rock: kind(TROLL_ROCK), tail: kind(TROLL_TAIL) };
}
function ticks(sim: Simulation, n: number, out: WorldEvent[] = [], until: (events: readonly WorldEvent[]) => boolean = () => false): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (until(events)) break;
  }
  return out;
}
/** Ticks until the hero stands again; `chainEnd` — the hero's shield at the chain's end. */
function settle(sim: Simulation, out: WorldEvent[] = []): { events: WorldEvent[]; shield: number } {
  let shield = -1;
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) {
    sim.tick();
    const events = sim.world.events.splice(0);
    out.push(...events);
    if (events.some(e => e.type === 'chainEnd')) shield = sim.world.hero.chainShield;
  }
  return { events: out, shield };
}
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
const place = (sim: Simulation, at: Vec, hp = 0): Enemy => {
  const id = sim.command({ t: 'place', x: at.x, y: at.y, color: 0, hp, kind: 'basic' }) as number;
  return sim.world.enemies.find(e => e.id === id)!;
};
type Window = Extract<WorldEvent, { type: 'trollWindow' }>;
const windowOf = (events: readonly WorldEvent[]): Window[] => events.filter((e): e is Window => e.type === 'trollWindow');
const hits = (events: readonly WorldEvent[]): string[] => windowOf(events).filter(e => e.action === 'hit').map(e => e.source);
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
const freeze = (sim: Simulation, e: Enemy, seconds = 600): void => { sim.command({ t: 'chill', id: e.id, seconds }); };

/** The club's window: the rock frozen (the club's move alone), the hero in the club's reach until «Удар дубиной» strikes; `thaw` — the rock thawed then. */
function clubWindow(d: Den, thaw = false): void {
  freeze(d.sim, d.rock);
  d.sim.command({ t: 'teleport', x: 12, y: 6.5 });
  const out = ticks(d.sim, ticksOf(12), [], events => windowOf(events).some(e => e.action === 'open'));
  assert(windowOf(out).some(e => e.action === 'open' && e.source === 'club'), 'the club opened the window');
  if (thaw) freeze(d.sim, d.rock, 0);
}
/** The bodies the highlight's run strikes, as it said, after the dash (the core apart). */
function runAsPlanned(w: World, planned: readonly { e: Enemy; outcome: { killed: boolean; plate?: boolean; platesAfter?: number; hpAfter: number } }[]): string | null {
  for (const { e, outcome } of planned) {
    const now = w.enemies.includes(e) ? (outcome.plate ? e.armor?.plates : e.hp) : 'dead';
    const want = outcome.killed ? 'dead' : outcome.plate ? outcome.platesAfter : outcome.hpAfter;
    if (now !== want) return `${e.kind} ${e.id}: ${now} vs ${want}`;
  }
  return null;
}

check('«Ударная волна» II and «Возврат»: the start\'s wave takes the window\'s hit, the return run passes the core by; the window\'s hits are the wave\'s only, one plate, the run as the highlight; without rank II the core is untouched — and with the run\'s path through the core rank II takes the hit from the run', () => {
  const waveKit = (honed: boolean): Loadout => ({ talismans: [COUNTER_TALISMANS.shockwave], ...honed ? { honed: [COUNTER_TALISMANS.shockwave] } : {}, hammer: HAMMERS.return });
  for (const k of SEEDS) {
    // South: four weak links from beside the core; the end's wave strikes nothing of the Troll, the start's — the core.
    for (const honed of [true, false]) {
      const d = den(k, waveKit(honed)), { sim, w, core } = d;
      clubWindow(d);
      sim.command({ t: 'teleport', x: 11.2, y: 4.0 });
      const links = [5.6, 7.0, 8.4, 9.8].map(y => place(sim, { x: 11.2, y }));
      draw(sim, links);
      const plan = planChain(w);
      assert(w.chain.length === 4 && plan.back, `seed ${k}: four links and a run back (${w.chain.length})`);
      const back = plan.back.hits.map(h => h.id), planned = plan.back.hits.map(h => ({ e: w.enemies.find(x => x.id === h.id)!, outcome: h.outcome }));
      sim.command({ t: 'release' });
      const { events } = settle(sim);
      if (honed) {
        assert(plan.honed?.waves?.[1]?.ids.includes(core.id) && !back.includes(core.id), `seed ${k}: the highlight — the start's wave strikes the core, the run passes it (${JSON.stringify(plan.honed?.waves)}, ${back})`);
        assert(hits(events).join() === 'wave' && core.armor?.plates === 4, `seed ${k}: the window's hit — the wave's, one plate (${hits(events)}, ${core.armor?.plates})`);
      } else {
        assert(plan.honed?.waves === undefined && !back.includes(core.id), `seed ${k}: no rank II — no start's wave, the run does not reach the core`);
        assert(hits(events).length === 0 && core.armor?.plates === 5, `seed ${k}: without rank II the core is untouched (${hits(events)}, ${core.armor?.plates})`);
      }
      const off = runAsPlanned(w, planned);
      assert(off === null, `seed ${k}, honed ${honed}: the run struck as the highlight said (${off})`);
      assert(replays(sim), `seed ${k}, honed ${honed}: replay`);
    }
    // West: the hero beside the core (within the run's reach of it), four weak links away to the west — the run comes back to him past the core.
    for (const honed of [true, false]) {
      const d = den(k, waveKit(honed)), { sim, w, core } = d;
      clubWindow(d);
      sim.command({ t: 'teleport', x: 11.6, y: 2.8 });
      const links = [{ x: 10.4, y: 3.6 }, { x: 9.0, y: 4.4 }, { x: 7.6, y: 5.2 }, { x: 6.2, y: 6.0 }].map(p => place(sim, p));
      draw(sim, links);
      const plan = planChain(w), back = plan.back?.hits.map(h => h.id) ?? [];
      assert(w.chain.length === 4, `seed ${k}: four links (${w.chain.length})`);
      sim.command({ t: 'release' });
      const { events } = settle(sim);
      if (honed) {
        assert(plan.honed?.waves?.[1]?.ids.includes(core.id) && !back.includes(core.id), `seed ${k}: rank II — the core leaves the run (${back})`);
        assert(hits(events).join() === 'wave', `seed ${k}: the window's hit — the wave's (${hits(events)})`);
      } else {
        assert(back.includes(core.id), `seed ${k}: no rank II — the run strikes the core (${back})`);
        assert(hits(events).join() === 'hammer-return', `seed ${k}: the window's hit — the run's (${hits(events)})`);
      }
      assert(core.armor?.plates === 4, `seed ${k}, honed ${honed}: one plate (${core.armor?.plates})`);
      assert(replays(sim), `seed ${k}, honed ${honed}: replay`);
    }
  }
});

check('«Иней на клинке» II: a chain of 3 ending in the core in its window — the core takes a plate and lives; the highlight names its neighbour (`honed.frost`) and the dash freezes it; rank I only — the neighbour stays warm', () => {
  for (const k of SEEDS) {
    for (const honed of [true, false]) {
      const kit: Loadout = { talismans: [COUNTER_TALISMANS.frostEdge], ...honed ? { honed: [COUNTER_TALISMANS.frostEdge] } : {} };
      const d = den(k, kit), { sim, w, core, rock } = d;
      // The rock thawed with the window open: the neighbour the frost takes is warm before the chain.
      clubWindow(d, true);
      sim.command({ t: 'teleport', x: 13.6, y: 6.4 });
      const links = [place(sim, { x: 13.4, y: 5.0 }), place(sim, { x: 12.9, y: 3.6 })];
      draw(sim, [...links, core]);
      assert(w.chain.length === 3 && !rock.chill, `seed ${k}: the chain of 3 into the core, the rock warm (${w.chain.length}, ${rock.chill})`);
      const plan = planChain(w), last = plan.links.at(-1)?.outcome;
      assert(last?.plate && !last.killed, `seed ${k}: the core takes a plate and lives (${JSON.stringify(last)})`);
      // The neighbour as the player sees it: the nearest living body whose edge is within the rank's reach of the core (the links die).
      const near = w.enemies.filter(e => e !== core && !links.includes(e) && Math.hypot(e.x - core.x, e.y - core.y) <= HONE.frostNear + bodyRadiusOf(w.params, e))
        .sort((a, b) => Math.hypot(a.x - core.x, a.y - core.y) - Math.hypot(b.x - core.x, b.y - core.y))[0];
      if (honed) assert(near && plan.honed?.frost?.survivor === core.id && plan.honed.frost.near === near.id, `seed ${k}: the highlight's frost — the core and ${near?.kind} (${JSON.stringify(plan.honed?.frost)})`);
      else assert(plan.honed?.frost === undefined, `seed ${k}: rank I — no neighbour`);
      sim.command({ t: 'release' });
      const { events } = settle(sim);
      assert(hits(events).join() === 'chain' && core.armor?.plates === 4 && (core.chill ?? 0) > 0, `seed ${k}: the chain's hit, one plate, the core frozen (${hits(events)}, ${core.armor?.plates}, ${core.chill})`);
      const frozen = w.enemies.find(e => e.id === plan.honed?.frost?.near);
      if (honed) assert(frozen && (frozen.chill ?? 0) > 0, `seed ${k}: the dash froze the neighbour ${frozen?.kind} (${frozen?.chill})`);
      else assert(!near || !(near.chill ?? 0), `seed ${k}: rank I — ${near?.kind} warm (${near?.chill})`);
      assert(replays(sim), `seed ${k}, honed ${honed}: replay`);
    }
  }
});

check('Ведунья in the Troll\'s fight: an open chain — no shield; a ring around the open core — the seal\'s hit and the shield; a ring around the closed core — the shield, the core whole; the core link dropped by the window\'s end (held) — an open chain, no shield; `plan.noShield` ⇔ no shield at the chain\'s end', () => {
  for (const k of SEEDS) {
    for (const mode of ['open', 'ringOpen', 'ringClosed', 'coreHeld'] as const) {
      const d = den(k, { hero: 'toad' }), { sim, w, core } = d;
      const events: WorldEvent[] = [];
      if (mode === 'ringClosed') { freeze(sim, d.rock); freeze(sim, d.club); } else clubWindow(d);
      let points: Vec[];
      if (mode === 'open') { sim.command({ t: 'teleport', x: 11.4, y: 4.6 }); points = [place(sim, { x: 11.4, y: 6.0 }), place(sim, { x: 11.4, y: 7.4 })]; }
      else if (mode === 'coreHeld') { sim.command({ t: 'teleport', x: 12.0, y: 5.6 }); const a = place(sim, { x: 12.9, y: 3.6 }), b = place(sim, { x: 11.1, y: 3.6 }); points = [a, core, b]; }
      else { sim.command({ t: 'teleport', x: 10.8, y: 1.95 }); const ring = [[11.2, 1.95], [12.8, 1.95], [12.8, 3], [11.2, 3]].map(([x, y]) => place(sim, { x, y })); points = [...ring, ring[0]]; }
      draw(sim, points);
      if (mode === 'coreHeld') {
        assert(w.chain.some(l => l.id === core.id), `seed ${k}: the core in the drawn chain`);
        ticks(sim, ticksOf(2.5), events, ev => windowOf(ev).some(e => e.action === 'unlink'));
        assert(windowOf(events).some(e => e.action === 'unlink') && !w.chain.some(l => l.id === core.id) && w.chain.length === 1, `seed ${k}: the window's end dropped the core and the link after it (${w.chain.map(l => l.id)})`);
      }
      const plan = planChain(w);
      assert(['ringOpen', 'ringClosed'].includes(mode) === (!!w.chainClosed && !!plan.seal), `seed ${k}, ${mode}: the ring closed (${w.chainClosed}, ${!!plan.seal})`);
      assert(!!plan.noShield === ['open', 'coreHeld'].includes(mode), `seed ${k}, ${mode}: noShield ${plan.noShield}`);
      sim.command({ t: 'release' });
      const { shield } = settle(sim, events);
      assert(shield >= 0 && (shield === 0) === !!plan.noShield, `seed ${k}, ${mode}: the shield at the chain's end ${shield}, the highlight's noShield ${plan.noShield}`);
      const want = mode === 'ringOpen' ? 'seal' : '';
      assert(hits(events).join() === want && core.armor?.plates === (mode === 'ringOpen' ? 4 : 5), `seed ${k}, ${mode}: the window's hits «${hits(events)}», plates ${core.armor?.plates}`);
      if (mode === 'ringClosed') assert(windowOf(events).length === 0, `seed ${k}: no window, nothing of it (${windowOf(events).map(e => e.action)})`);
      assert(replays(sim), `seed ${k}, ${mode}: replay`);
    }
    // The law is Ведунья's: the same open chain of the plain hero gives the shield.
    const d = den(k), { sim, w } = d;
    clubWindow(d);
    sim.command({ t: 'teleport', x: 11.4, y: 4.6 });
    draw(sim, [place(sim, { x: 11.4, y: 6.0 }), place(sim, { x: 11.4, y: 7.4 })]);
    const plan = planChain(w);
    sim.command({ t: 'release' });
    const { shield } = settle(sim);
    assert(!plan.noShield && shield > 0, `seed ${k}: the plain hero's open chain — the shield (${plan.noShield}, ${shield})`);
  }
});

console.log(`troll combos: ${checks} checks passed`);
