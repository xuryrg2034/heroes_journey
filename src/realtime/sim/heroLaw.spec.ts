/**
 * Task 49 «Второй герой», step 1 (docs/design-notes/task-49-second-hero.md, sections 4, 9 and 12.3; docs/realtime-prototype.md,
 * section 9к): the law of Ведунья in the fight — `Loadout.hero` `toad`. Node only: `npm run test:realtime-hero-law`.
 *
 * Every check plays journalled commands (place, teleport, begin, drag, release) with the run's values (`rtRunParams`: the loop toggle
 * off, the shield after 3+ kills, «Щит фокуса» from the 3rd link) and looks at what the player meets:
 * - the kit: «Печать» innate and the law's module; a loadout without `hero` — the cat's kit and hash of before;
 * - on run row 1 (nothing taken) the mage closes a ring on herself with 3 links and the ring strikes inside; the cat cannot;
 * - the price: after an open chain of 3 kills the mage is touched and hurt (no shield), the cat is not; after a ring she is not;
 *   the telemetry counts her hit as `damage.unshielded`; «Щит фокуса» while drawing stays; «Добивание» doubles only the ring's shield; «Быстрые ноги» take it away;
 * - the highlight is the dash: `ChainPlan.noShield` on an open chain, absent on a ring — a bot on several seeds and run arenas checks
 *   every release against the shield the dash gave;
 * - «Ледяная печать» from one «Иней на клинке» with the innate seal; «Прямая» beside it pierces an open chain;
 * - every fight replays from its journal to the same hash. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { chainAnchor, loopCandidates, nextCandidates, planChain, type ChainPlan } from './chain';
import { COUNTER_TALISMANS as CT, FORMS, FUSIONS, HERO_LAWS, RELICS } from './buildIds';
import { dist, type Vec } from './geometry';
import { worldState } from './hash';
import { kitOf, type Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import { focusGuarded, type WorldEvent } from './world';
import { rtRunParams, RT_FORMS_PARAMS } from '../run/rtRun';
import { RUN_ARENAS } from '../run/arenaPools';
import { analyzeJournal } from '../telemetry/report';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;

registerArena({
  id: 'hero-law-field', name: 'Поле закона', summary: 'Тест закона героя', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** The run's values on a quiet field: nobody walks, no newcomers; touches hurt (contact 1); the loop toggle off as in a run. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = { ...rtRunParams(defaultParams()), ...RT_FORMS_PARAMS };
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.heroHp = 40; p.hitstop = false;
  return Object.assign(p, extra);
}
function field(loadout: Loadout = {}, k = 1, extra: Partial<Params> = {}): Simulation {
  const sim = new Simulation({ arena: 'hero-law-field', params: quiet(extra), seed: seedOf(k), record: true, hero: { hp: 40, maxHp: 40 }, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
const TOAD: Loadout = { hero: 'toad' };
const place = (sim: Simulation, at: Vec, opts: { color?: number; hp?: number } = {}): number =>
  sim.command({ t: 'place', x: at.x, y: at.y, color: opts.color ?? 0, hp: opts.hp ?? 0, kind: 'basic' }) as number;
function draw(sim: Simulation, points: readonly Vec[]): void {
  sim.command({ t: 'begin', x: points[0].x, y: points[0].y });
  for (const p of points.slice(1)) sim.command({ t: 'drag', x: p.x, y: p.y, mode: 'full' });
}
/** Ticks until the dash is over; returns the hero's shield on the tick it ended and the events of the whole run. */
function toEnd(sim: Simulation): { shield: number; events: WorldEvent[] } {
  const events: WorldEvent[] = [];
  for (let t = 0; t < 240; t++) {
    sim.tick();
    events.push(...sim.world.events);
    const ended = sim.world.events.some(e => e.type === 'chainEnd');
    sim.world.events.length = 0;
    if (ended) return { shield: sim.world.hero.chainShield, events };
  }
  throw new Error('the dash did not end');
}
const ticks = (sim: Simulation, n: number): void => { for (let t = 0; t < n; t++) { sim.tick(); sim.world.events.length = 0; } };
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();

/** Three colour-0 links round the hero (4.5, 5): an arc the hero closes as a corner. */
const ARC: Vec[] = [{ x: 6, y: 3.6 }, { x: 7.6, y: 5 }, { x: 6, y: 6.4 }];
/** A body of another colour below the arc's last link (where the dash ends), outside the ring: the hero walks into it after the dash. */
const TOUCHER: Vec = { x: 6, y: 7.2 };

check('the kit: «Печать» innate and the law; without `hero` — the kit and the hash of before', () => {
  const toad = kitOf({ hero: 'toad', talismans: [CT.finisher] }), cat = kitOf({ talismans: [CT.finisher] });
  assert(JSON.stringify(toad.talismans) === JSON.stringify([CT.finisher, FORMS.seal, HERO_LAWS.toad]), `toad ${toad.talismans}`);
  assert(JSON.stringify(cat.talismans) === JSON.stringify([CT.finisher]) && JSON.stringify(kitOf({ talismans: [CT.finisher], hero: undefined })) === JSON.stringify(cat), 'cat kit');
  // A taken «Печать» (a run never offers it to her) stays once; an unknown hero is the cat.
  assert(kitOf({ hero: 'toad', talismans: [FORMS.seal] }).talismans.join() === `${FORMS.seal},${HERO_LAWS.toad}`, 'seal once');
  assert(JSON.stringify(kitOf({ hero: 'owl' as never })) === JSON.stringify(kitOf({})), 'unknown hero — the cat');
  // The same fight without `hero` and with `hero` undefined: one world.
  const a = field({}), b = field({ hero: undefined });
  for (const sim of [a, b]) { for (const p of ARC) place(sim, p); draw(sim, ARC); sim.command({ t: 'release' }); ticks(sim, 90); }
  assert(a.hash() === b.hash() && JSON.stringify(worldState(a.world)) === JSON.stringify(worldState(b.world)), 'same world');
  assert(!('hero' in a.exportJournal()!.loadout!), 'the journal keeps no hero');
});

check('run row 1, nothing taken: the mage closes a ring on herself with 3 links, the ring strikes inside; the cat cannot close', () => {
  const sim = field(TOAD);
  for (const p of ARC) place(sim, p);
  const inner = place(sim, { x: 6.4, y: 5 }, { color: 2, hp: 1 });
  draw(sim, ARC);
  assert(loopCandidates(sim.world).includes('hero'), 'the ring on herself is offered');
  sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  assert(sim.world.chainClosed === 'hero', 'closed on the hero');
  const plan = planChain(sim.world);
  assert(plan.seal && plan.seal.inside.join() === String(inner) && !plan.noShield, `plan ${JSON.stringify(plan.seal)}`);
  sim.command({ t: 'release' });
  const { events } = toEnd(sim);
  ticks(sim, 5);
  assert(events.some(e => e.type === 'seal' && e.phase === 'release') && !sim.world.enemies.some(e => e.id === inner), 'struck inside');
  const cat = field();
  for (const p of ARC) place(cat, p);
  draw(cat, ARC);
  cat.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  assert(!cat.world.chainClosed && !loopCandidates(cat.world).length && !planChain(cat.world).noShield, 'the cat has no ring in a run');
  assert(replays(sim) && replays(cat), 'replays');
});

/**
 * Draws the arc with the toucher below its end; `ring` — closes it on the hero. The player holds «down» from the release: after the
 * dash the hero stands in the toucher's reach. Returns the shield at the end of the dash and the HP 0.3 s later.
 */
function touched(loadout: Loadout, ring: boolean, k = 1): { plan: ChainPlan; shield: number; hpBefore: number; hpAfter: number; sim: Simulation } {
  const sim = field(loadout, k);
  for (const p of ARC) place(sim, p);
  place(sim, TOUCHER, { color: 3, hp: 5 });
  draw(sim, ARC);
  if (ring) sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  assert(!!sim.world.chainClosed === ring, 'closed as asked');
  const plan = planChain(sim.world), hpBefore = sim.world.hero.hp;
  sim.command({ t: 'release' });
  sim.command({ t: 'walk', x: 0, y: 1 });
  const { shield } = toEnd(sim);
  ticks(sim, 18);
  return { plan, shield, hpBefore, hpAfter: sim.world.hero.hp, sim };
}

check('the price: after an open chain of 3 kills the mage is touched and hurt; the cat is shielded; after a ring the mage is shielded', () => {
  const open = touched(TOAD, false), cat = touched({}, false), ring = touched(TOAD, true);
  assert(open.plan.noShield === true && open.shield === 0 && open.hpAfter < open.hpBefore, `mage open: shield ${open.shield}, hp ${open.hpBefore} → ${open.hpAfter}`);
  assert(!cat.plan.noShield && cat.shield > 0 && cat.hpAfter === cat.hpBefore, `cat open: shield ${cat.shield}, hp ${cat.hpBefore} → ${cat.hpAfter}`);
  assert(!ring.plan.noShield && ring.plan.seal && ring.shield === cat.shield && ring.hpAfter === ring.hpBefore, `mage ring: shield ${ring.shield}, hp ${ring.hpBefore} → ${ring.hpAfter}`);
  assert([open, cat, ring].every(x => replays(x.sim)), 'replays');
  // The telemetry's measure of the price (`damage.unshielded`, the report's replay): her hit after the open chain; none after the ring.
  const bare = (sim: Simulation) => analyzeJournal(JSON.parse(JSON.stringify(sim.exportJournal()!))).summary.damage.unshielded;
  assert(bare(open.sim)?.hits === 1 && bare(ring.sim)?.hits === 0 && bare(cat.sim) === undefined, `unshielded: open ${JSON.stringify(bare(open.sim))}, ring ${JSON.stringify(bare(ring.sim))}`);
});

check('«Щит фокуса» while drawing is the same for the mage; «Добивание» doubles only the ring\'s shield; «Быстрые ноги» take it away', () => {
  for (const loadout of [TOAD, {}]) {
    const sim = field(loadout);
    for (const p of ARC) place(sim, p);
    draw(sim, ARC);
    sim.tick();
    assert(focusGuarded(sim.world), `focus guard from the 3rd link (${loadout.hero ?? 'cat'})`);
  }
  const fin = { hero: 'toad' as const, talismans: [CT.finisher] };
  const base = touched(TOAD, true).shield, ring = touched(fin, true), open = touched(fin, false);
  // The shield is read on the tick the dash ended (one tick of it gone): ×2 of the length, not of the rest.
  const dt = 1 / 60;
  assert(Math.abs((ring.shield + dt) - 2 * (base + dt)) < 1e-9 && open.shield === 0 && open.hpAfter < open.hpBefore, `finisher: ring ${ring.shield} (base ${base}), open ${open.shield}`);
  const feet = touched({ hero: 'toad', talismans: [RELICS.swiftFeet] }, true);
  assert(feet.shield === 0 && feet.hpAfter < feet.hpBefore, `swift feet: ${feet.shield}`);
});

check('«Ледяная печать» from one «Иней на клинке» with the innate seal: survivors inside freeze; «Прямая» beside it pierces an open chain', () => {
  const kit = kitOf({ hero: 'toad', talismans: [FUSIONS.iceSeal, FORMS.pierce] });
  assert(kit.talismans.filter(id => id === FORMS.seal).length === 1 && kit.talismans.includes(CT.frostEdge) && kit.talismans.includes(HERO_LAWS.toad), `kit ${kit.talismans}`);
  const sim = field({ hero: 'toad', talismans: [FUSIONS.iceSeal] });
  for (const p of ARC) place(sim, p);
  const inner = place(sim, { x: 6.4, y: 5 }, { color: 2, hp: 5 });
  draw(sim, ARC);
  sim.command({ t: 'drag', x: 4.5, y: 5, mode: 'full' });
  const plan = planChain(sim.world);
  assert(plan.seal?.ice?.ids.includes(inner), `ice in the plan ${JSON.stringify(plan.seal)}`);
  sim.command({ t: 'release' });
  toEnd(sim); ticks(sim, 2);
  const e = sim.world.enemies.find(x => x.id === inner)!;
  assert(e && (e.chill ?? 0) >= 2.9 && e.brittle, `frozen ${e?.chill} brittle ${e?.brittle}`);
  // An open straight chain with «Прямая»: the pierce runs on; the ring would seal.
  const straight = field({ hero: 'toad', talismans: [FORMS.pierce] });
  const line: Vec[] = [{ x: 6, y: 5 }, { x: 7.6, y: 5 }, { x: 9.2, y: 5 }];
  for (const p of line) place(straight, p);
  const behind = place(straight, { x: 10.6, y: 5 }, { color: 2, hp: 1 });
  draw(straight, line);
  const p2 = planChain(straight.world);
  assert(p2.pierce && p2.pierce.bodies.some(b => b.id === behind) && p2.noShield, 'the open line pierces, no shield');
  straight.command({ t: 'release' });
  toEnd(straight); ticks(straight, 30);
  assert(!straight.world.enemies.some(x => x.id === behind) && straight.world.hero.chainShield === 0, 'pierced, no shield');
  assert(replays(sim) && replays(straight), 'replays');
});

check('the highlight is the dash: a bot on run arenas and 6 seeds — `noShield` ⇔ the dash gave no shield by the law; a ring ⇒ the cat\'s rule', () => {
  let rings = 0, opens = 0, shielded = 0;
  for (const arena of RUN_ARENAS.slice(0, 6)) for (let k = 1; k <= 6; k++) {
    const params = { ...rtRunParams(defaultParams()), ...RT_FORMS_PARAMS };
    const sim = new Simulation({ arena, params, seed: seedOf(k), record: true, hero: { hp: 40, maxHp: 40 }, loadout: { hero: 'toad', talismans: k % 3 === 0 ? [CT.finisher] : [], openItems: [] } });
    const w = sim.world;
    for (let tick = 0; tick < 1800 && w.status === 'playing'; tick++) {
      if (tick % 50 === 10 && !w.move && !w.chain.length) {
        const first = nextCandidates(w).sort((a, b) => dist(a, w.hero) - dist(b, w.hero))[0];
        if (first) {
          sim.command({ t: 'begin', x: first.x, y: first.y });
          for (let n = 0; n < 8 && w.chain.length; n++) {
            // Close on the hero when the ring is offered (on even seeds right away, on odd ones from the 4th link), else go on.
            if (loopCandidates(w).includes('hero') && (k % 2 === 0 || w.chain.length >= 4)) { sim.command({ t: 'drag', x: w.hero.x, y: w.hero.y, mode: 'full' }); break; }
            const plan = planChain(w);
            if (plan.endsOnSurvivor || plan.endsOnObject) break;
            const from = chainAnchor(w), next = nextCandidates(w).sort((a, b) => dist(a, from) - dist(b, from))[0];
            if (!next) break;
            const before = w.chain.length;
            sim.command({ t: 'drag', x: next.x, y: next.y, mode: 'full' });
            if (w.chain.length <= before) break;
          }
          if (w.chain.length) {
            const plan = planChain(w), closed = !!w.chainClosed;
            assert(!!plan.noShield === !closed && !!plan.seal === closed, `plan: noShield ${plan.noShield}, seal ${!!plan.seal}, closed ${closed}`);
            sim.command({ t: 'release' });
            if (w.move) {
              // The dash's end raises the shield or not: the shield of an earlier ring may still run down (a new one replaces it).
              let kills = -1, before = 0;
              for (let t = 0; t < 240 && kills < 0; t++) { before = w.hero.chainShield; sim.tick(); tick++; const end = w.events.find(e => e.type === 'chainEnd'); if (end && end.type === 'chainEnd') kills = end.kills; w.events.length = 0; }
              const raised = w.hero.chainShield > before;
              if (plan.noShield) { opens++; assert(!raised, `open chain ${arena} k${k}: shield ${before} → ${w.hero.chainShield}`); }
              else { rings++; if (kills >= params.chainShieldMinKills) { shielded++; assert(raised, `ring of ${kills} kills ${arena} k${k}: no shield`); } else assert(!raised, 'a ring of few kills: none'); }
              continue;
            }
          }
        }
      }
      if (tick % 60 === 0) sim.command({ t: 'walk', x: (tick / 60) % 2 ? 1 : -1, y: 0 });
      sim.tick();
      w.events.length = 0;
    }
    assert(replays(sim), `replays ${arena} k${k}`);
  }
  assert(rings > 10 && opens > 10 && shielded > 3, `variety: rings ${rings}, opens ${opens}, shielded rings ${shielded}`);
  console.log(`  (bot: ${rings} rings, ${shielded} of them shielded, ${opens} open chains)`);
});

console.log(`hero law: ${checks} checks passed`);
