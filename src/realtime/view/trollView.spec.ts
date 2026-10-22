/**
 * Task 48 «Тролль», part ui (view/trollView.ts, bossBar.ts, worldLabels.ts, nodeCard.ts): the view of the forest's boss reads the sim.
 * Node only: `npm run test:realtime-troll-view`. The view is driven frame by frame against a real world of the arena «Берлога тролля»
 * (journalled commands: teleport, chill; the sim's own timers); it writes to real PixiJS `Graphics` without a renderer. What the player
 * sees in a browser by real input — tests/realtime-troll.spec.ts.
 * - the ring of «Хвост метёт» is cut by the rock walls (the scanlines and the hatching); the whole-second count; the part's line;
 * - «Удар дубиной»: the strip fills with the windup, the hit flashes it, the window opens — the glow and the count «2», «1»;
 * - a part severed — its drawing falls off (and the tail's line); «звон» — a spark, no text;
 * - the boss bar: `trollHp` + `trollPlates` cells, the line at 2 plates, lit in phase 3; the HUD's goal names «Тролль»;
 * - the names of the five moves at their first start; the node card's enemies line from the fight's start.
 */
// Node 20 has no global navigator; pixi.js reads it on load (nodeNavigator.testkit.ts). First import.
import './nodeNavigator.testkit';
import { Graphics, Text } from 'pixi.js';
import { enemyRefusal, hoverRefusal, nextCandidates, pickAt, pickRadius } from '../sim/chain';
import { bossArtEllipse, rockInFlight } from '../sim/bossArt';
import { PHASE3_PLATES, TAIL_INNER, TAIL_OUTER, TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL, trollMove, trollState } from '../sim/enemies/troll';
import { defaultParams, type Params } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import { killEnemy, type Enemy, type World, type WorldEvent } from '../sim/world';
import { bossBarState, goalLabelOf } from './bossBar';
import { nodeDangers } from './nodeCard';
import { bossMoveLabels, BOSS_MOVE_TEXT } from './worldLabels';
import { TrollView, buildCore, partOutward, ringSpans, subtractInterval, wallsOf, windowCount, type SignTools } from './trollView';
import { registerArena } from '../sim/arenas';
import { tree } from '../sim/geometry';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const U = 72, R = 28.8;

/** Nothing comes but the Troll's own, the hero cannot fall, no touch. */
function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.enemySpeed = 0;
  // Task 48, section 25: the sitting Troll — the values without `trollMove` (a journal before it; the arena turns it on only when it is off).
  delete (p as Partial<Params>).trollMove;
  return p;
}
interface Den { sim: Simulation; w: World; core: Enemy; club: Enemy; rock: Enemy; tail: Enemy }
function den(k = 1): Den {
  const sim = new Simulation({ arena: 'troll', params: quiet(), seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: 12, y: 12 });
  sim.tick(); w.events.splice(0);
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  return { sim, w, core: kind(TROLL), club: kind(TROLL_CLUB), rock: kind(TROLL_ROCK), tail: kind(TROLL_TAIL) };
}

/** The counts of the tools the signs draw with. */
function tools(): SignTools & { calls: { strip: number; head: number; hatch: number } } {
  const calls = { strip: 0, head: 0, hatch: 0 };
  return { calls, strip: () => { calls.strip++; }, head: () => { calls.head++; }, hatchCircle: () => { calls.hatch++; } };
}

/** One frame of the view over the tick just played (what render.ts does, in its order); returns the events it saw. */
function frame(view: TrollView, w: World, g: Graphics, tl: SignTools, art: ReturnType<typeof buildCore>, clock: number, events: readonly WorldEvent[]): void {
  for (const ev of events) view.onEvent(ev, w, clock, R);
  view.beginFrame();
  g.clear();
  view.drawSigns(g, w, tl, () => true);
  view.syncCore(art, w, clock, R, true);
  view.drawTail(g, w, R, clock);
  view.drawOver(g, w, clock, SIM_DT, R, tl);
  view.note(w, R);
}

check('the ring of «Хвост метёт» is cut by the rock walls; the count is whole seconds; a part stands on the line from the core', () => {
  const { w } = den(), walls = wallsOf(w), c = { x: 12, y: 2.2 };
  // The rock behind the Troll (y 0 … 1.6, x 9 … 15) covers the ring's top; a scanline at y 1.0 meets no free ring.
  assert(walls.length >= 3, `the den's walls (${walls.length})`);
  assert(ringSpans(c, TAIL_INNER, TAIL_OUTER, { x: 0, y: 1.0 }, { x: 1, y: 0 }, walls).length === 0, 'no ring inside the back rock');
  // At the core's height the ring's two arms are cut by the mouth's side walls (x 7.5 … 9, 15 … 16.5): 9 … 10.8 and 13.2 … 15.
  const arms = ringSpans(c, TAIL_INNER, TAIL_OUTER, { x: 0, y: 2.2 }, { x: 1, y: 0 }, walls).map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
  assert(JSON.stringify(arms) === JSON.stringify([[9, 10.8], [13.2, 15]]), `the arms at the core's height ${JSON.stringify(arms)}`);
  // Below the rock (y 4) the ring is whole: one span across, the hole of the inner circle cut out of it only near the core.
  const low = ringSpans(c, TAIL_INNER, TAIL_OUTER, { x: 0, y: 4.2 }, { x: 1, y: 0 }, walls);
  assert(low.length === 1 && low[0][1] - low[0][0] > 4, `below the rock the ring is whole (${JSON.stringify(low)})`);
  assert(JSON.stringify(subtractInterval([[0, 10]], [3, 4])) === '[[0,3],[4,10]]', 'an interval cut in two');
  assert(windowCount(1.5) === '2' && windowCount(1) === '1' && windowCount(0.2) === '1' && windowCount(4) === '4', 'the count — whole seconds, never 0');
  const out = partOutward({ x: 12, y: 2.2 }, { x: 10.5, y: 2.6 });
  assert(out.x < -0.9 && out.y > 0 && Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-9, 'the club stands left and down of the core');
});

check('«Удар дубиной»: the strip fills with the windup and flashes at the hit; the window glows and counts «2» → «1»; a closed core has no glow', () => {
  for (const k of [1, 2, 3]) {
    const d = den(k), { sim, w } = d, view = new TrollView(U, c => c), g = new Graphics(), tl = tools(), art = buildCore(R);
    sim.command({ t: 'chill', id: d.rock.id, seconds: 600 });
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    let clock = 0, sawStrip = false, fill = 0, opened = false, countedTwo = false, countedOne = false, hitSeen = 0, flashed = false;
    assert(enemyRefusal(w, d.core) === 'outOfWindow', `seed ${k}: closed before the blow`);
    for (let i = 0; i < 60 * 14; i++) {
      sim.tick(); clock += SIM_DT;
      const events = w.events.splice(0);
      frame(view, w, g, tl, art, clock, events);
      const m = trollMove(w);
      if (m?.move === 'club') { sawStrip ||= view.shown.strips === 1 && view.shown.sign === 'club'; fill = Math.max(fill, view.shown.signProgress); }
      if (view.shown.hits > hitSeen) { hitSeen = view.shown.hits; flashed = true; }
      if (view.shown.glow) { opened = true; countedTwo ||= view.shown.count === '2'; countedOne ||= view.shown.count === '1'; }
      if (!trollState(w)?.window && opened) break;
      if (!opened) assert(view.shown.glow === 0 && view.shown.count === '', `seed ${k}: a closed core has no glow and no count`);
    }
    assert(sawStrip && tl.calls.strip > 0 && tl.calls.head > 0, `seed ${k}: the strip was drawn (${tl.calls.strip})`);
    assert(fill > 0.95, `seed ${k}: the strip filled to ${fill.toFixed(2)}`);
    assert(flashed && opened && countedTwo && countedOne, `seed ${k}: flash ${flashed}, glow ${opened}, «2» ${countedTwo}, «1» ${countedOne}`);
    assert(view.shown.opens === 1, `seed ${k}: one window (${view.shown.opens})`);
  }
});

check('a severed part falls off with its weapon, the tail — with its line; a hit outside the window sparks, no text', () => {
  const d = den(1), { w } = d, view = new TrollView(U, c => c), g = new Graphics(), tl = tools(), art = buildCore(R);
  let clock = 0;
  const tick = (): void => { d.sim.tick(); clock += SIM_DT; frame(view, w, g, tl, art, clock, w.events.splice(0)); };
  tick(); tick();
  assert(view.shown.tail === 1, 'the tail line is drawn');
  // The tail's line falls when the tail is cut; its knot's drawing falls as a piece in the layer.
  const pieces = (): number => view.layer.children.length;
  const before = pieces();
  killEnemy(w, d.tail, { source: 'chain', credited: true });
  tick();
  assert(view.shown.severed === 1 && view.shown.tailFalls === 1 && pieces() > before, `the knot and its line fall (${view.shown.severed}, ${view.shown.tailFalls}, ${pieces() - before})`);
  for (let i = 0; i < 40; i++) tick();
  assert(pieces() === before, `the fallen pieces are gone after 0.5 s (${pieces()} vs ${before})`);
  // «Звон»: a hit of fire on the closed core — the sim blocks it; the view sparks.
  d.sim.command({ t: 'chill', id: d.club.id, seconds: 600 }); d.sim.command({ t: 'chill', id: d.rock.id, seconds: 600 });
  const sparks = view.shown.sparks;
  frame(view, w, g, tl, art, clock, [{ type: 'trollWindow', action: 'block', id: d.core.id, source: 'fire', x: d.core.x, y: d.core.y }]);
  assert(view.shown.sparks === sparks + 1, 'a spark for «звон»');
  assert(!view.layer.children.some(c => c instanceof Text && c.visible), 'the spark has no text (no label is shown)');
});

check('a whole fight played in the view: every sign is drawn at its move (strip, circle, ring, lairs), the rock flies, the snore draws its arc and the sleeping drawing; nothing throws', () => {
  const d = den(2), { sim, w } = d, view = new TrollView(U, c => c), g = new Graphics(), tl = tools(), art = buildCore(R);
  const seen = new Set<string>(), spots: [number, number][] = [[12, 6.5], [12, 4.4], [9, 9], [15, 9]];
  let clock = 0, flight = 0, arc = 0, asleep = 0, gates = 0, rings = 0;
  for (let i = 0; i < 60 * 90 && w.status === 'playing'; i++) {
    if (i % 180 === 0) { const [x, y] = spots[(i / 180) % spots.length]; sim.command({ t: 'teleport', x, y }); }
    // The phases by the spec's times are long: the view is read in all three at once (the state the sim keeps in `vars`).
    if (i === 60) d.core.vars.phase = 2;
    if (i === 60 * 30) d.core.vars.phase = 3;
    sim.tick(); clock += SIM_DT;
    frame(view, w, g, tl, art, clock, w.events.splice(0));
    if (view.shown.sign) seen.add(view.shown.sign);
    flight += view.shown.flight; arc += view.shown.snoreArc > 0 ? 1 : 0; asleep += view.shown.asleep; gates += view.shown.gateMarks; rings += view.shown.rings;
  }
  assert(['club', 'rock', 'tail', 'roar'].every(m => seen.has(m)), `the signs drawn: ${[...seen].join(', ')}`);
  assert(flight > 0 && arc > 0 && asleep > 0 && gates > 0 && rings > 0, `flight ${flight}, arc ${arc}, asleep ${asleep}, lairs ${gates}, rings ${rings}`);
  assert(tl.calls.hatch > 0, 'the rock circle was hatched');
});

check('the boss bar: HP and plate cells, the line at 2 plates, lit in phase 3; the goal names the Troll', () => {
  const d = den(1), s = bossBarState(d.w);
  assert(s && s.hpMax === 2 && s.platesMax === 4 && s.hp === 2 && s.plates === 4, `the bar's cells (${JSON.stringify(s)})`);
  assert(s.phaseAt === s.hpMax + PHASE3_PLATES && !s.phase2, `the line at ${s.phaseAt}, not lit`);
  d.core.vars.phase = 2;
  assert(!bossBarState(d.w)!.phase2, 'phase 2 does not light the line (it has none)');
  d.core.vars.phase = 3;
  assert(bossBarState(d.w)!.phase2, 'phase 3 lights the line');
  assert(goalLabelOf(d.w, 'отмеченные') === 'Тролль', `the goal's name (${goalLabelOf(d.w, 'отмеченные')})`);
});

check('the five moves are named at their first start, at their signs; nothing else is written', () => {
  const d = den(1), named = new Set<string>(), texts: string[] = [];
  for (const move of ['club', 'rock', 'tail', 'roar', 'snore'] as const) {
    d.core.vars.ax = 10; d.core.vars.ay = 7; d.core.vars.bx = 12; d.core.vars.by = 6;
    d.w.events.push({ type: 'bossMove', id: d.core.id, move, stage: 'start' });
    const labels = bossMoveLabels(d.w, named);
    d.w.events.splice(0);
    assert(labels.length === 1 && labels[0].text === BOSS_MOVE_TEXT[move], `${move}: ${JSON.stringify(labels.map(l => l.text))}`);
    texts.push(labels[0].text);
    // The second start of the same move in the fight is not named again.
    d.w.events.push({ type: 'bossMove', id: d.core.id, move, stage: 'start' });
    assert(bossMoveLabels(d.w, named).length === 0, `${move}: named once`);
    d.w.events.splice(0);
  }
  assert(JSON.stringify(texts) === JSON.stringify(['Удар дубиной', 'Бросок камня', 'Хвост метёт', 'Рык', 'Храп']), texts.join(' | '));
});

check('the node card: «Враги» counts the fight\'s start — the Troll and his three parts, then who comes', () => {
  const lines = nodeDangers({ arena: 'troll', row: 10, guaranteedElite: false, garrison: { start: [TROLL, TROLL_CLUB, TROLL_ROCK, TROLL_TAIL].map(kind => ({ kind, count: 1 })), newcomers: [], knights: 0, bolts: false, deep: false } });
  const enemies = lines.find(l => l.id === 'enemies');
  assert(enemies?.text === 'Тролль, дубина, камень, хвост · подходят: обычные', `the enemies line (${enemies?.text})`);
});

/** The pointer for which the rule and the nearest pick differ: inside the core's press ring (`pickRadius`), on the line to the body, nearer to the body than to the core. */
function ringPointer(w: World, core: Enemy, body: Enemy): { x: number; y: number } {
  const ring = pickRadius(w, core), d = Math.hypot(body.x - core.x, body.y - core.y);
  assert(d / 2 < ring, `the contact distance ${d.toFixed(2)} leaves room inside the ring ${ring.toFixed(2)}`);
  const t = Math.min((d / 2 + ring) / 2, d), at = { x: core.x + (body.x - core.x) / d * t, y: core.y + (body.y - core.y) / d * t };
  assert(Math.hypot(at.x - core.x, at.y - core.y) < ring && Math.hypot(at.x - body.x, at.y - body.y) < Math.hypot(at.x - core.x, at.y - core.y), 'the pointer is in the ring and nearer to the body');
  return at;
}

check('«Ядро в окне — первым» (core 21.10.2026): a body on the Troll core — shut, the pointer on it takes the body; in the window it takes the core, no refusal at the cursor, the core is a candidate, the press starts [core]', () => {
  for (const k of [1, 2, 3]) {
    const d = den(k), { sim, w } = d;
    sim.command({ t: 'chill', id: d.rock.id, seconds: 600 });
    sim.command({ t: 'teleport', x: 11.4, y: 4.2 });
    const put = (): { id: number; at: { x: number; y: number } } => {
      const id = sim.command({ t: 'place', x: d.core.x, y: d.core.y + 0.5, color: 1, hp: 0, kind: 'basic' }) as number, e = w.enemies.find(x => x.id === id)!;
      sim.command({ t: 'chill', id, seconds: 60 });
      for (let i = 0; i < 30; i++) { sim.tick(); w.events.splice(0); }
      return { id, at: ringPointer(w, d.core, e) };
    };
    assert(w.params.corePickFirst && enemyRefusal(w, d.core) === 'outOfWindow', `seed ${k}: the key is on in his den, the core is shut`);
    const shut = put(), pickShut = pickAt(w, shut.at);
    assert(pickShut?.kind === 'enemy' && pickShut.id === shut.id, `seed ${k}: shut — the pointer takes the body (${JSON.stringify(pickShut)})`);
    assert(hoverRefusal(w, shut.at) === null && !nextCandidates(w).some(e => e.id === d.core.id), `seed ${k}: no refusal on the body, no ring on the shut core`);
    // Open his window by his own club, then freeze him so the window stays.
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    for (let i = 0; i < 60 * 14 && !trollState(w)?.window?.open; i++) { sim.tick(); w.events.splice(0); }
    assert(trollState(w)?.window?.open, `seed ${k}: the window opened`);
    sim.command({ t: 'chill', id: d.core.id, seconds: 60 });
    sim.command({ t: 'teleport', x: 11.4, y: 4.2 });
    const fresh = put(), at = fresh.at;
    const pick = pickAt(w, at);
    assert(pick?.kind === 'enemy' && pick.id === d.core.id, `seed ${k}: in the window the pointer on the body takes the core (${JSON.stringify(pick)})`);
    assert(hoverRefusal(w, at) === null && nextCandidates(w).some(e => e.id === d.core.id), `seed ${k}: no refusal, the core's ring is drawn`);
    // The negative check: with the key off the same pointer takes the nearest — the body.
    w.params.corePickFirst = false;
    const off = pickAt(w, at);
    w.params.corePickFirst = true;
    assert(off?.kind === 'enemy' && off.id === fresh.id, `seed ${k}: key off — the body (${JSON.stringify(off)})`);
    sim.command({ t: 'begin', x: at.x, y: at.y });
    assert(w.chain.length === 1 && w.chain[0].id === d.core.id, `seed ${k}: the press starts [core]`);
  }
});

check('«Бросок камня»: in the ticks of the rock flight the view hides its drawing (`rockInAir`) and the sim has no press zone for it (`bossArtEllipse` null, `rockInFlight`); out of the flight both are there', () => {
  for (const k of [1, 2, 3]) {
    const d = den(k), { sim, w } = d, view = new TrollView(U, c => c);
    sim.command({ t: 'chill', id: d.club.id, seconds: 600 });
    sim.command({ t: 'teleport', x: 12, y: 6.5 });
    let air = 0, ground = 0;
    for (let i = 0; i < 60 * 20 && (air < 6 || ground < 6); i++) {
      sim.tick(); w.events.splice(0);
      const rock = w.enemies.find(e => e.kind === TROLL_ROCK);
      if (!rock) continue;
      const flying = rockInFlight(w, rock), drawn = view.rockInAir(w) !== null, zone = bossArtEllipse(w, rock);
      assert(flying === drawn, `seed ${k}, t ${w.time.toFixed(2)}: the sim says flight ${flying}, the view hides ${drawn}`);
      assert((zone === null) === flying, `seed ${k}, t ${w.time.toFixed(2)}: the press zone is ${zone ? 'there' : 'null'} in flight ${flying}`);
      if (flying) air++; else ground++;
    }
    assert(air >= 6 && ground >= 6, `seed ${k}: both seen (air ${air}, ground ${ground})`);
  }
});

// ---- Task 48 §25 «Рывок» (`Params.trollMove`) ----

/** An open field (30 × 20): the Troll at (8, 10), a tree east of him on his row — a charge east sticks in it (the core's own test field). */
registerArena({
  id: 'tv-charge-field', name: 'Поле рывка (вид)', summary: 'Тест вида рывка', goal: 'marked', width: 30, height: 20,
  heroStart: { x: 27, y: 10 }, obstacles: [tree(18, 10)], buttons: [], door: { x: 29.3, y: 1 },
  enemies: [
    { x: 8, y: 10, color: 1, kind: TROLL, marked: true },
    { x: 6.5, y: 10.4, color: 0, kind: TROLL_CLUB },
    { x: 9.5, y: 10.4, color: 1, kind: TROLL_ROCK },
    { x: 8, y: 11.7, color: 2, kind: TROLL_TAIL },
  ],
  phaseOverride: { wolfShare: 0, boarShare: 0 }, bossFrame: true, bossClears: true, jailerColorless: true, troll: true,
});

/** A fight with the walk and the charge on; the club and the rock frozen (their moves never open: «Рывок» alone). */
function charging(arena: string, k: number, hero: { x: number; y: number }): Den {
  const p = quiet();
  p.trollMove = true; p.trollHp = 4; p.trollPlates = 5;
  const sim = new Simulation({ arena, params: p, seed: seedOf(k), record: true }), w = sim.world;
  sim.command({ t: 'teleport', x: hero.x, y: hero.y });
  const kind = (id: string): Enemy => w.enemies.find(e => e.kind === id)!;
  const d = { sim, w, core: kind(TROLL), club: kind(TROLL_CLUB), rock: kind(TROLL_ROCK), tail: kind(TROLL_TAIL) };
  for (const e of [d.club, d.rock]) sim.command({ t: 'chill', id: e.id, seconds: 600 });
  return d;
}

check('«Рывок» in the open: its lane fills through the windup to the stop point (the sim\'s `to`) with its stop mark; running — dust at the feet; enemies on it thrown aside — a streak per push; the end flashes the lane (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const d = charging('troll', k, { x: 12, y: 9 }), { sim, w } = d, view = new TrollView(U, c => c), g = new Graphics(), tl = tools(), art = buildCore(R);
    const place = (x: number, y: number): number => sim.command({ t: 'place', x, y, color: 0, hp: 1, kind: 'basic' }) as number;
    const placed = [place(12.3, 6.5), place(11.7, 5.2)];
    let clock = 0, lanes = 0, last = -1, monotone = true, ran = false, ended = false, stopSeen = false, toSeen = false;
    const pushed: number[] = [];
    for (let i = 0; i < 60 * 10 && !ended; i++) {
      sim.tick(); clock += SIM_DT;
      const events = w.events.splice(0);
      frame(view, w, g, tl, art, clock, events);
      for (const e of events) if (e.type === 'trollPush') pushed.push(e.id);
      const m = trollMove(w);
      if (m?.move === 'charge' && !m.running) {
        lanes += view.shown.chargeLanes;
        if (view.shown.signProgress < last - 1e-9) monotone = false;
        last = view.shown.signProgress;
        stopSeen ||= view.shown.chargeStops === 1;
        toSeen ||= !!m.to && Math.abs(Math.hypot(m.to.x - m.from!.x, m.to.y - m.from!.y) - 10) < 1e-6;
      }
      if (m?.move === 'charge' && m.running) ran ||= view.shown.chargeRun === 1 && view.shown.chargeLanes === 1;
      ended = events.some(e => e.type === 'bossMove' && e.move === 'charge' && e.stage === 'hit');
    }
    assert(lanes >= 30 && monotone && last > 0.95 && stopSeen && toSeen, `seed ${k}: the lane through the windup (${lanes} frames, fill ${last.toFixed(2)}, stop ${stopSeen}, to ${toSeen})`);
    assert(ran && view.shown.dusts > 3, `seed ${k}: the run drawn, dust ${view.shown.dusts}`);
    // A body thrown aside may be met again further along the run (the sim's events): a streak per event.
    assert(placed.every(id => pushed.includes(id)) && view.shown.pushes === pushed.length && ended && view.shown.hits >= 1, `seed ${k}: both placed thrown aside (${JSON.stringify(pushed)}), a streak per push (${view.shown.pushes} of ${pushed.length}), the lane flashed at the end (${view.shown.hits})`);
    assert(view.shown.chargeStuck === 0 && view.shown.impacts === 0 && view.shown.stuckStars === 0, `seed ${k}: in the open — no impact, no stars`);
  }
});

check('«Рывок» into a tree: the lane shows the impact mark from the windup; the run sticks — sparks at the front, stars over the head while the window is open, then none (3 seeds)', () => {
  for (const k of [1, 2, 3]) {
    const d = charging('tv-charge-field', k, { x: 14, y: 10 }), { sim, w } = d, view = new TrollView(U, c => c), g = new Graphics(), tl = tools(), art = buildCore(R);
    let clock = 0, stuckLane = 0, stars = 0, walked = false, closed = false;
    for (let i = 0; i < 60 * 10 && !closed; i++) {
      sim.tick(); clock += SIM_DT;
      const events = w.events.splice(0);
      frame(view, w, g, tl, art, clock, events);
      const m = trollMove(w);
      if (m?.move === 'charge' && !m.running) {
        stuckLane += view.shown.chargeStuck;
        // The hero steps off the lane during the windup (the run must not strike him).
        if (!walked) { sim.command({ t: 'walk', x: 0, y: -1 }); walked = true; }
      } else if (walked && w.hero.y < 8) sim.command({ t: 'walk', x: 0, y: 0 });
      stars += view.shown.stuckStars;
      if (view.shown.stuckStars) assert(trollState(w)?.stuck === true, `seed ${k}: stars only while stuck`);
      closed = view.shown.opens === 1 && !trollState(w)?.window;
    }
    assert(stuckLane >= 30, `seed ${k}: the impact mark on the lane (${stuckLane} frames)`);
    assert(view.shown.impacts === 1 && view.shown.opens === 1 && stars >= 60, `seed ${k}: sparks ${view.shown.impacts}, the window ${view.shown.opens}, stars ${stars} frames`);
    assert(closed && view.shown.stuckStars === 0, `seed ${k}: the window closed — no stars`);
  }
});

check('a part carried out of reach (`trollLinkFar`): a white ring on each link that dropped out', () => {
  const d = den(1), { w } = d, view = new TrollView(U, c => c);
  assert(view.onEvent({ type: 'trollLinkFar', id: d.club.id, x: d.club.x, y: d.club.y, dropped: [d.club.id, d.rock.id], refusal: 'far' }, w, 0, R), 'the Troll\'s event');
  assert(view.onEvent({ type: 'trollPush', id: d.tail.id, x: 3, y: 3, fromX: 1, fromY: 3 }, w, 0, R), 'the push is the Troll\'s too');
  assert(view.shown.farDrops === 2 && view.shown.pushes === 1, `rings ${view.shown.farDrops}, pushes ${view.shown.pushes}`);
});

console.log('trollView.spec: done');
