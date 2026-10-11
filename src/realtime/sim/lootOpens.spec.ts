/**
 * The elite-loot cliff (calibration 12.10.2026, docs/realtime-casino.md, «Калибровка экономики»; docs/realtime-damage.md,
 * «Награда»): `Params.eliteLootOpens`. While no consumable is open, an armoured elite's loot opens one (its kind by the
 * arena's `loot` stream) and drops it instead of the 2 resources (4 for a clean break); from then on the rule of before.
 * Node only: `npm run test:realtime-loot-opens`.
 *
 * Every fight plays journalled commands (place, begin / drag, release, teleport, clear, item, items) and reads what the player
 * meets — the loot on the ground, what the hero picks up, what the run opens:
 * - none open: the first loot is a consumable (2 of it for a clean break, 1 for a later kill), no resource; the kind is
 *   open in the fight at once; the next elite of the fight drops that kind (the rule of before), no second kind;
 * - kinds vary over seeds, a replay repeats them; a kind already open — the flag changes nothing;
 * - off by default; a journal without the key plays the same world (2 resources, no opening);
 * - the run turns it on; a run with nothing open: a real fight's elite loot picked up — the run opens the kind, keeps the
 *   item, the next arena's loadout has it open and its elite drops that kind; picked up and used in the same fight — still
 *   open; left on the ground — still open (the loot opened it).
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from './arenas';
import { ARMOR_RESOURCES, CLEAN_BREAK_LOOT } from './elites';
import { worldState } from './hash';
import { SLOT_ITEMS, type ItemKind, type Loadout } from './kit';
import { defaultParams, type Params } from './params';
import { Simulation, replay } from './simulation';
import type { Enemy, WorldEvent } from './world';
import { createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtChooseGift, rtChooseGiftPick, rtGiftView, rtRunParams, serializeRtRun, RT_RUN_FORCED, type RtRunState } from '../run/rtRun';
import { closeNode, ok, playFight, toBattle } from '../run/runFight.testkit';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isItem = (kind: string): kind is ItemKind => (SLOT_ITEMS as readonly string[]).includes(kind);

registerArena({
  id: 'loot-open-field', name: 'Поле добычи', summary: 'Тест открытия расходника', goal: 'kills', width: 20, height: 12,
  heroStart: { x: 4.5, y: 5 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [], killGoal: 999,
});

/** A quiet fight with armour on: no newcomers, nobody walks or touches, no hit-stop. `eliteLootOpens` on unless said. */
function quiet(extra: Partial<Params> = {}): Params {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.maxEnemies = 1;
  p.enemySpeed = 0; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 40; p.hitstop = false; p.survivorKnockback = false;
  p.eliteArmor = true; p.elitePlates = 1; p.energyPerKill = 0; p.eliteLootOpens = true;
  return Object.assign(p, extra);
}
function field(params: Params, loadout: Loadout, k: number): Simulation {
  const sim = new Simulation({ arena: 'loot-open-field', params, seed: seedOf(k), record: true, loadout });
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 4.5, y: 5 });
  return sim;
}
type Ev<T extends WorldEvent['type']> = Extract<WorldEvent, { type: T }>;
const of = <T extends WorldEvent['type']>(events: readonly WorldEvent[], type: T): Ev<T>[] => events.filter((e): e is Ev<T> => e.type === type);
function ticks(sim: Simulation, n: number, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < n && sim.world.status === 'playing'; i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
function settle(sim: Simulation, out: WorldEvent[] = []): WorldEvent[] {
  for (let i = 0; i < 900 && (sim.world.move || i === 0); i++) { sim.tick(); out.push(...sim.world.events); sim.world.events.length = 0; }
  return out;
}
const replays = (sim: Simulation): boolean => replay(JSON.parse(JSON.stringify(sim.exportJournal()!))).hash() === sim.hash();
/** A chain of just `e` from the hero (put 2 to its left), released; the events of the dash. */
function hit(sim: Simulation, e: Enemy): WorldEvent[] {
  sim.command({ t: 'teleport', x: e.x - 2, y: 5 });
  sim.command({ t: 'begin', x: e.x, y: e.y });
  sim.command({ t: 'release' });
  return settle(sim);
}
/**
 * An armoured elite (1 plate) at (x, 5) killed by the player: `clean` — the bomb opens the window and a chain kills it at
 * once (a clean break); otherwise a chain takes the plate, the window runs past its clean second, a chain kills it.
 * Returns the loot dropped by its death.
 */
function killElite(sim: Simulation, x: number, clean: boolean): Ev<'loot'>[] {
  const id = sim.command({ t: 'place', x, y: 5, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
  const e = sim.world.enemies.find(en => en.id === id)!;
  if (clean) {
    sim.command({ t: 'items', kind: 'bomb', count: 1 });
    sim.command({ t: 'item', kind: 'bomb', x: e.x, y: e.y });
    ticks(sim, 1);
  } else {
    hit(sim, e);
    ticks(sim, 90);
  }
  assert(e.armor?.open, 'the window is open');
  const events = hit(sim, e);
  const down = of(events, 'eliteDown')[0];
  assert(!sim.world.enemies.includes(e) && down?.credited && down.clean === clean, `killed (clean ${clean}): ${JSON.stringify(down)}`);
  return of(events, 'loot').filter(l => !l.picked);
}

// ---- The fight ----

check('none open: the first loot opens a consumable — 2 of it for a clean break, 1 for a later kill, no resource; open in the fight at once', () => {
  const kinds = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    for (const clean of [true, false]) {
      const sim = field(quiet(), {}, k), w = sim.world;
      const loot = killElite(sim, 6.5, clean);
      assert(loot.length === (clean ? CLEAN_BREAK_LOOT : 1) && loot.every(l => isItem(l.loot) && l.loot === loot[0].loot), `seed ${k}: loot ${loot.map(l => l.loot)}`);
      assert(same(w.kit!.openItems, [loot[0].loot]), `seed ${k}: open now ${w.kit!.openItems}`);
      kinds.add(loot[0].loot);
      // The hero walks over the loot: it goes to his hand.
      for (const l of loot) { sim.command({ t: 'teleport', x: l.x, y: l.y }); ticks(sim, 2); }
      assert(w.kit!.items[loot[0].loot as ItemKind] === loot.length && !w.objects.some(o => o.kind === 'loot'), `seed ${k}: picked up`);
      assert(Object.values(w.kit!.materials).every(n => n === 0), 'no resource');
      assert(replays(sim), 'replay');
    }
  }
  assert(kinds.size >= 3, `kinds over 8 seeds: ${[...kinds]}`);
});

check('after the first: the rule of before — the next elite of the fight drops the opened kind; no second kind is opened', () => {
  for (let k = 1; k <= 4; k++) {
    const sim = field(quiet(), {}, k + 20), w = sim.world;
    const first = killElite(sim, 6.5, false)[0].loot;
    const second = killElite(sim, 8.5, true);
    assert(second.length === CLEAN_BREAK_LOOT && second.every(l => l.loot === first) && same(w.kit!.openItems, [first]), `seed ${k}: ${first}, then ${second.map(l => l.loot)}`);
    assert(replays(sim), 'replay');
  }
});

check('a kind already open: the flag changes nothing (the same world as without it, but the params)', () => {
  const strip = (sim: Simulation) => { const s = worldState(sim.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
  for (let k = 1; k <= 3; k++) {
    const play = (params: Params) => { const sim = field(params, { openItems: ['fire'] }, k); const loot = killElite(sim, 6.5, true); return { sim, loot }; };
    const on = play(quiet()), off = play(quiet({ eliteLootOpens: false }));
    assert(on.loot.every(l => l.loot === 'fire') && same(on.sim.world.kit!.openItems, ['fire']), `seed ${k}: the open kind drops`);
    assert(strip(on.sim) === strip(off.sim), `seed ${k}: the same world`);
  }
});

check('off by default: 2 resources a loot (4 for a clean break) as before; a journal without the key plays the same world', () => {
  assert(defaultParams().eliteLootOpens === false, 'off by default');
  for (let k = 1; k <= 3; k++) {
    const off = quiet({ eliteLootOpens: false });
    const old = { ...off } as Partial<Params>;
    delete old.eliteLootOpens;
    const a = field(off, {}, k), b = field(old as Params, {}, k);
    const la = killElite(a, 6.5, true), lb = killElite(b, 6.5, true);
    assert(la.length === CLEAN_BREAK_LOOT * ARMOR_RESOURCES && la.every(l => !isItem(l.loot)) && same(la, lb), `seed ${k}: resources ${la.map(l => l.loot)}`);
    assert(!a.world.kit || !a.world.kit.openItems.length, 'nothing opened');
    const strip = (sim: Simulation) => { const s = worldState(sim.world) as Record<string, unknown>; delete s.params; return JSON.stringify(s); };
    assert(strip(a) === strip(b), `seed ${k}: the same world without the key`);
    const journal = b.exportJournal()!;
    assert(!('eliteLootOpens' in journal.params) && replay(JSON.parse(JSON.stringify(journal))).hash() === b.hash(), 'the old journal replays');
  }
});

// ---- The run ----

/** A new run whose gift opened nothing (a gift option without consumables), at its first battle. */
function bareRun(k: number): RtRunState {
  let run = createRtRun(seedOf(k), { gift: 'mini' });
  const view = rtGiftView(run)!;
  const option = view.options.find(o => o.available && o.option.kind !== 'items') ?? view.options.find(o => o.available)!;
  run = ok(rtChooseGift(run, option.index), 'gift');
  const open = rtGiftView(run);
  if (open && open.chosen !== null) run = ok(rtChooseGiftPick(run, open.picks.find(p => !isItem(p)) ?? open.picks[0]), 'gift pick');
  return toBattle(run);
}
/** The run's fight on the test field: an armoured elite killed in its window; the hero picks the loot up unless `leave`; `use` — he throws it then. */
function eliteFight(run: RtRunState, k: number, options: { leave?: boolean; use?: boolean } = {}) {
  return playFight(run, { chains: [], k, play: (sim, seen) => {
    const id = sim.command({ t: 'place', x: 8, y: 6, color: 0, hp: 0, kind: 'basic', elite: true }) as number;
    const e = sim.world.enemies.find(en => en.id === id)!;
    const chainTo = () => { sim.command({ t: 'teleport', x: e.x - 2, y: 6 }); sim.command({ t: 'begin', x: e.x, y: e.y }); sim.command({ t: 'release' }); seen(sim.world); sim.world.events.length = 0; for (let i = 0; i < 900 && sim.world.move; i++) { sim.tick(); seen(sim.world); sim.world.events.length = 0; } };
    for (let i = 0; i < 8 && sim.world.enemies.includes(e); i++) chainTo();
    assert(!sim.world.enemies.includes(e), 'the elite died');
    if (options.leave) { sim.command({ t: 'teleport', x: 2, y: 2 }); return; }
    for (const o of sim.world.objects.filter(x => x.kind === 'loot')) { sim.command({ t: 'teleport', x: o.x, y: o.y }); sim.tick(); seen(sim.world); sim.world.events.length = 0; }
    if (options.use) {
      // Thrown at an enemy (the healing at full HP is refused: then it stays in hand — the check counts real uses).
      const kind = SLOT_ITEMS.find(item => sim.world.kit!.items[item] > 0)!;
      sim.command({ t: 'place', x: 12, y: 6, color: 1, hp: 0, kind: 'basic' });
      sim.command({ t: 'teleport', x: 10, y: 6 });
      sim.command({ t: 'item', kind, x: 12, y: 6 });
    }
  } });
}

check('the run turns it on; a run with nothing open: the fight\'s elite loot picked up — the run opens the kind and keeps the item; the next arena drops that kind', () => {
  assert(RT_RUN_FORCED.eliteLootOpens === true && rtRunParams(defaultParams()).eliteLootOpens === true, 'on in the run');
  const kinds = new Set<string>();
  let runs = 0;
  for (let k = 1; k <= 12 && runs < 5; k++) {
    const run = bareRun(k);
    if (run.openItems.length) continue;
    const { outcome, events } = eliteFight(run, k);
    const dropped = of(events, 'loot').filter(l => !l.picked).map(l => l.loot);
    assert(dropped.length >= 1 && dropped.every(l => l === dropped[0] && isItem(l)), `seed ${k}: a consumable dropped (${dropped})`);
    const kind = dropped[0] as ItemKind;
    assert(same(outcome.openItems, [kind]) && outcome.items?.[kind] === dropped.length, `seed ${k}: the outcome ${JSON.stringify(outcome.openItems)} ${JSON.stringify(outcome.items)}`);
    let after = ok(resolveArena(run, outcome), 'resolve');
    assert(same(after.openItems, [kind]) && after.items[kind] === dropped.length, `seed ${k}: the run opened ${after.openItems}`);
    const back = parseRtRun(serializeRtRun(after));
    assert(back && same(back, after), 'the save keeps it');
    kinds.add(kind);
    // The next arena (the walk there may open more by a find): the kind is open in its loadout; its elite drops an open
    // consumable by the rule of before, no resource, nothing new opened by the loot.
    after = toBattle(closeNode(after));
    const open = rtArenaLoadout(after).openItems!;
    assert(open.includes(kind), `open in the next arena: ${open}`);
    const next = eliteFight(after, k + 1);
    const again = of(next.events, 'loot').filter(l => !l.picked).map(l => l.loot);
    assert(again.length >= 1 && again.every(l => (open as string[]).includes(l)) && same(next.outcome.openItems, open), `seed ${k}: the next loot ${again} (open ${open})`);
    runs++;
  }
  assert(runs >= 3 && kinds.size >= 2, `runs ${runs}, kinds ${[...kinds]}`);
});

check('the run: the opened kind stays open if the hero used it in the same fight, or left it on the ground', () => {
  let checked = 0, used = 0;
  for (let k = 30; k <= 45 && checked < 6; k++) {
    const run = bareRun(k);
    if (run.openItems.length) continue;
    for (const options of [{ use: true }, { leave: true }]) {
      const { outcome, events } = eliteFight(run, k, options);
      const kind = of(events, 'loot').find(l => !l.picked)!.loot as ItemKind;
      const after = ok(resolveArena(run, outcome), 'resolve');
      assert(same(after.openItems, [kind]), `seed ${k} ${JSON.stringify(options)}: open ${after.openItems}`);
      if (options.use && of(events, 'item').some(e => e.kind === kind)) { used++; assert(after.items[kind] < of(events, 'loot').filter(l => l.picked).length, 'one used'); }
      const picked = of(events, 'loot').filter(l => l.picked).length;
      if (options.leave) assert(after.items[kind] === picked && picked < of(events, 'loot').filter(l => !l.picked).length, `left on the ground: ${picked} in hand`);
      checked++;
    }
  }
  assert(checked >= 6 && used >= 1, `checked ${checked}, used in the fight ${used}`);
});

console.log(`realtime-loot-opens: ${checks} checks passed`);
