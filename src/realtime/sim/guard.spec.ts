/**
 * Task 23 «Щит виден» (design 15.10.2026, docs/design-notes/tasks-21-25.md), the simulation's part, by real journal commands:
 * - (а) a hit the shield absorbs gives the event `block` (here: the crowd's touch in the invulnerability after a hit) and nothing
 *   else — the HP stays, the journal replays to the same hash;
 * - (б) «щит не держит»: `bustThreat` in the last frame before the bust blast equals the blast's `hurt` (the hero stands in the
 *   circle — true and −4; he walked off — false and 0), with the after-chain shield up too (`shieldFails` true, and the blast
 *   still takes 4: the shield does not hold it); the quills of a porcupine in the drawn chain (`quillThreat`) hurt through
 *   «Щит фокуса».
 */
import { registerArena } from './arenas';
import { objectRefusal } from './chain';
import { bustThreat, quillThreat, shieldFails } from './guard';
import { defaultParams, type Params } from './params';
import { Simulation, SIM_DT, replay, type Journal } from './simulation';
import { goblinOf, leverOf } from './slot';
import { focusGuarded, type WorldEvent } from './world';
import { rtArenaParams, rtRunParams } from '../run/rtRun';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const tick = (seconds: number): number => Math.round(seconds / SIM_DT);
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
const slotOf = (events: readonly WorldEvent[], action: Ev<'slot'>['action']): Ev<'slot'>[] => of(events, 'slot').filter(e => e.action === action);
function ticks(sim: Simulation, n: number, out: WorldEvent[]): void {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
}
function replays(sim: Simulation): boolean {
  const journal = JSON.parse(JSON.stringify(sim.exportJournal()!)) as Journal;
  return replay(journal).hash() === sim.hash();
}

registerArena({
  id: 'guard-field', name: 'Поле щита', summary: 'Тест задачи 23', goal: 'kills', width: 60, height: 40,
  heroStart: { x: 30, y: 20 }, obstacles: [], buttons: [], door: { x: 59.3, y: 20 }, enemies: [], killGoal: 999,
});
registerArena({
  id: 'guard-touch', name: 'Касание в щит', summary: 'Тест задачи 23', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, killGoal: 999,
  enemies: [{ x: 10.45, y: 6, color: 0 }, { x: 9.55, y: 6, color: 1 }],
});
registerArena({
  id: 'guard-quills', name: 'Иглы в щит', summary: 'Тест задачи 23', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 10, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, killGoal: 999,
  enemies: [{ x: 11.6, y: 6, color: 0, kind: 'porcupine' }],
});

/** No newcomers, no reaper, nobody walks, no hit-stop. */
function quiet(): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 0; p.reaperEnabled = false;
  p.enemySpeed = 0; p.speedSpread = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  return p;
}

check('(а) the touch in the invulnerability after a hit: one hit, then `block` events of the touching enemies — no HP lost, the same hash on replay', () => {
  for (let k = 1; k <= 3; k++) {
    const p = quiet();
    p.contactDamage = 1; p.invulnerability = 0.5; p.invulnerabilityMode = 'constant';
    const sim = new Simulation({ arena: 'guard-touch', params: p, seed: seedOf(k), record: true });
    const w = sim.world, events: WorldEvent[] = [];
    let blocksInGrace = 0, blocksOutside = 0;
    for (let i = 0; i < tick(1.2); i++) {
      const guarded = w.hero.invulnerable > SIM_DT;
      const at = events.length;
      ticks(sim, 1, events);
      const blocks = of(events.slice(at), 'block');
      if (guarded) blocksInGrace += blocks.length; else blocksOutside += blocks.length;
    }
    const hits = of(events, 'hit'), blocks = of(events, 'block');
    assert(hits.length >= 2 && hits.every(h => h.source === 'touch'), `seed ${k}: touches hurt between the graces (${hits.length})`);
    assert(w.hero.hp === 40 - hits.length, `seed ${k}: only the hits took HP (${w.hero.hp})`);
    assert(blocks.length > 0 && blocksOutside === 0 && blocksInGrace === blocks.length, `seed ${k}: blocks only in the grace (${blocksInGrace}/${blocksOutside})`);
    const ids = new Set(w.enemies.map(e => e.id));
    assert(blocks.every(b => b.source === 'touch' && b.enemyId !== undefined && ids.has(b.enemyId)), `seed ${k}: a block names the touching enemy`);
    assert(new Set(blocks.map(b => b.enemyId)).size === 2, `seed ${k}: both touching enemies are blocked`);
    assert(replays(sim), `seed ${k}: the journal replays to the same hash`);
  }
});

interface Bust { damage: number; blast: Ev<'slot'>; before: { threat: boolean; fails: boolean }; blocks: number; sim: Simulation }

/**
 * A run battle (fuse 0.6 s) on an open field: bare pulls of the lever until one busts; then `leave` (walk off at once) or `stand`
 * (stand until the idol lights, then walk off). `shield` — the after-chain shield is put on the hero when the idol lights (a test
 * fixture: the shield of a chain with 3+ kills). `before` — `bustThreat` and `shieldFails` in the last frame before the blast.
 */
function bust(k: number, plan: 'leave' | 'stand', shield: boolean): Bust | null {
  const params = rtArenaParams({ shortFuse: true }, rtRunParams(quiet()));
  const sim = new Simulation({ arena: 'guard-field', params, seed: seedOf(k), record: true, loadout: { slot: true } });
  const w = sim.world, events: WorldEvent[] = [];
  sim.command({ t: 'goals' });
  ticks(sim, tick(3.2), events);
  if (!goblinOf(w)) return null;
  for (let pull = 0; pull < 6; pull++) {
    for (let i = 0; i < tick(20) && leverOf(w) && objectRefusal(w, leverOf(w)!) === 'lever'; i++) ticks(sim, 1, events);
    const L = leverOf(w);
    if (!L) return null;
    const dx = w.arena.width / 2 - L.x, dy = w.arena.height / 2 - L.y, d = Math.hypot(dx, dy) || 1;
    sim.command({ t: 'teleport', x: L.x + dx / d * 1.2, y: L.y + dy / d * 1.2 });
    assert(sim.command({ t: 'begin', x: L.x, y: L.y }) === true, 'a chain of just the lever');
    sim.command({ t: 'release' });
    const from = events.length;
    for (let i = 0; i < tick(5) && !slotOf(events.slice(from), 'pull').length; i++) ticks(sim, 1, events);
    const pulled = slotOf(events.slice(from), 'pull')[0];
    assert(pulled, `seed ${k}: the dash pulled`);
    if (!pulled.bust) { ticks(sim, tick(1.2) + 2, events); continue; }
    const g = goblinOf(w)!, idol = { x: g.x, y: g.y };
    for (let i = 0; i < tick(1) && w.move; i++) ticks(sim, 1, events);
    const away = (): void => {
      const ax = w.arena.width / 2 - idol.x, ay = w.arena.height / 2 - idol.y, a = Math.hypot(ax, ay) || 1;
      sim.command({ t: 'walk', x: ax / a, y: ay / a });
    };
    if (plan === 'leave') away();
    let lit = false, before = { threat: false, fails: false }, blast: Ev<'slot'> | undefined;
    const start = events.length;
    for (let i = 0; i < tick(4) && !blast && w.status === 'playing'; i++) {
      const frame = { threat: bustThreat(w), fails: shieldFails(w) };
      const at = events.length;
      ticks(sim, 1, events);
      const now = events.slice(at);
      blast = slotOf(now, 'blast')[0];
      if (blast) before = frame;
      if (!lit && slotOf(now, 'lit').length) {
        lit = true;
        if (shield) w.hero.chainShield = 5;
        if (plan === 'stand') away();
      }
    }
    assert(lit && blast, `seed ${k}: the idol lit and blew up`);
    sim.command({ t: 'walk', x: 0, y: 0 });
    const after = events.slice(start);
    const damage = of(after, 'hit').filter(e => e.source === 'slot-bust').reduce((s, e) => s + e.damage, 0);
    return { damage, blast, before, blocks: of(after, 'block').filter(b => b.source === 'slot-bust').length, sim };
  }
  return null;
}
const SEEDS: number[] = [];
for (let k = 1; SEEDS.length < 5 && k < 200; k++) if (bust(k, 'leave', false)) SEEDS.push(k);
assert(SEEDS.length === 5, `busting seeds: ${SEEDS.length}`);

check('(б) the last frame before the bust blast: `bustThreat` equals the blast\'s `hurt` — he stands in the circle: true and −4; he walked off: false and 0', () => {
  for (const k of SEEDS) {
    const stand = bust(k, 'stand', false)!, leave = bust(k, 'leave', false)!;
    assert(stand.before.threat === true && stand.blast.hurt === true && stand.damage === 4, `seed ${k} stand: threat ${stand.before.threat}, hurt ${stand.blast.hurt}, damage ${stand.damage}`);
    assert(leave.before.threat === false && leave.blast.hurt === false && leave.damage === 0, `seed ${k} leave: threat ${leave.before.threat}, hurt ${leave.blast.hurt}, damage ${leave.damage}`);
    assert(!stand.before.fails && !leave.before.fails, `seed ${k}: no shield — «щит не держит» stays off`);
    assert(replays(stand.sim) && replays(leave.sim), `seed ${k}: the journals replay`);
  }
});

check('(б) the after-chain shield up in the circle: `shieldFails` before the blast, and the blast still takes 4 (no `block`); walked off — off and 0', () => {
  for (const k of SEEDS) {
    const stand = bust(k, 'stand', true)!, leave = bust(k, 'leave', true)!;
    assert(stand.before.fails === true && stand.blast.hurt === true && stand.damage === 4 && stand.blocks === 0, `seed ${k} stand: fails ${stand.before.fails}, damage ${stand.damage}, blocks ${stand.blocks}`);
    assert(leave.before.fails === false && leave.damage === 0, `seed ${k} leave: fails ${leave.before.fails}, damage ${leave.damage}`);
  }
});

check('(б) the quills: a porcupine with its quills up in the drawn chain — «Щит фокуса» is up and `shieldFails`; the release hurts through it', () => {
  for (const up of [true, false]) {
    const p = quiet();
    p.contactDamage = 0; p.focusGuardLinks = 1; p.porcupineQuills = 2;
    if (up) { p.porcupineUpTime = 5; p.porcupineDownTime = 0; } else { p.porcupineUpTime = 0; p.porcupineDownTime = 5; }
    const sim = new Simulation({ arena: 'guard-quills', params: p, seed: seedOf(7), record: true });
    const w = sim.world, events: WorldEvent[] = [];
    ticks(sim, 2, events);
    const porcupine = w.enemies.find(e => e.kind === 'porcupine')!;
    assert(sim.command({ t: 'begin', x: porcupine.x, y: porcupine.y }) === true, 'the chain starts on the porcupine');
    ticks(sim, 2, events);
    assert(focusGuarded(w), '«Щит фокуса» is up while drawing');
    assert(quillThreat(w) === up && shieldFails(w) === up, `quills up ${up}: threat ${quillThreat(w)}, fails ${shieldFails(w)}`);
    sim.command({ t: 'release' });
    ticks(sim, tick(1), events);
    const quills = of(events, 'hit').filter(h => h.source === 'quills');
    assert(up ? quills.length === 1 && w.hero.hp === 38 : quills.length === 0 && w.hero.hp === 40, `quills up ${up}: ${quills.length} hits, HP ${w.hero.hp}`);
    assert(replays(sim), 'the journal replays');
  }
});

console.log(`guard: ${checks} checks passed (seeds ${SEEDS.join(', ')})`);
