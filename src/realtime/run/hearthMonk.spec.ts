/**
 * Task 51 «Лагерь, этап 3», step 51г (docs/design-notes/task-51-camp-l3.md, section 3.3; docs/realtime-slice.md, «Лагерь, этап 3»):
 * Евлампий, the defrocked priest. Node only: `npm run test:realtime-hearth-monk`. Whole runs walked by the run's own commands
 * (metaWalk.testkit.ts); the shackles are cut in a real fight played by journalled commands (a keymaster, its prisoner, a chain across
 * the shackle — the sim's `tether` `cut` events, counted as the view counts them: `rtShackleCuts`) and fed back as the fight's outcome;
 * the profile as the view keeps it (`createRtProfileStore(storage, { monk: true, gambler: false })` — his camp on; the game's default is off):
 * - he comes by shackles cut in a fight of the run, not without; `last.cuts`; with his camp off nothing changes; his fallback — the
 *   third finished run since the profile's first run into the garrison (forest-only runs do not count);
 * - «Обет»: 2 offered, 1 taken; «Два обета»: 3 offered, 2 taken; kept — +15 XP each outside «Испытание»; broken; not counted before the
 *   Jailer's row; «Без переброса» broken by a reroll;
 * - the quest «Разруби кандалы дважды» done with 2 cuts, not with 1.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from '../sim/arenas';
import { KEYMASTER, SHACKLE_FIRST } from '../sim/enemies/garrison';
import { defaultParams } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { WorldEvent } from '../sim/world';
import { seedOf, walkRun, type WalkOptions } from './metaWalk.testkit';
import { createRtProfileStore, RT_PROFILE_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { parseRtRun, rtNode, rtReachedJailer, rtShackleCuts, serializeRtRun, type RtArenaOutcome, type RtRunState } from './rtRun';
import { rtHearthFlagsWith, rtRunCuts, rtVowsNow, rtVowsOf, RT_XP_VOW } from './rtMeta';
import { RT_VOW_IDS } from './metaCatalog';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function memoryStorage(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

registerArena({
  id: 'monk-cut-field', name: 'Поле кандалов', summary: 'Тест кандалов в походе', goal: 'kills', killGoal: 999, width: 20, height: 12,
  heroStart: { x: 3, y: 6 }, obstacles: [], buttons: [], door: { x: 19.3, y: 6 }, enemies: [],
});
/**
 * A real fight that cuts one shackle: a keymaster shackles a plain enemy 2.5 to its side; two links on both sides of the shackle's middle;
 * the dash runs across it (as keymaster.spec.ts). Returns the fight's events (every tick's) — the view counts the cuts over them.
 */
function cutFight(k: number): WorldEvent[] {
  const p = defaultParams();
  p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 999; p.hitstop = false; p.survivorKnockback = false;
  p.tethers = true; p.shackles = true; p.enemySpeed = 0;
  const sim = new Simulation({ arena: 'monk-cut-field', params: p, seed: seedOf(k), record: true }), events: WorldEvent[] = [];
  const tick = (n: number) => { for (let i = 0; i < n; i++) { sim.tick(); events.push(...sim.world.events); sim.world.events.length = 0; } };
  sim.command({ t: 'clear', keepMarked: false });
  sim.command({ t: 'teleport', x: 3, y: 6 });
  const km = sim.command({ t: 'place', x: 8, y: 6, color: 1, hp: 1, kind: KEYMASTER }) as number;
  sim.command({ t: 'place', x: 8, y: 8.5, color: 0, hp: 0, kind: 'basic' });
  tick(Math.round((SHACKLE_FIRST + 0.2) / SIM_DT));
  const keeper = sim.world.enemies.find(e => e.id === km)!, mx = keeper.x, my = keeper.y + 1.25;
  const a = sim.command({ t: 'place', x: mx - 0.9, y: my, color: 0, hp: 0, kind: 'basic' }) as number, b = sim.command({ t: 'place', x: mx + 0.9, y: my, color: 0, hp: 0, kind: 'basic' }) as number;
  sim.command({ t: 'teleport', x: mx - 2.2, y: my });
  const at = (id: number) => sim.world.enemies.find(e => e.id === id)!;
  sim.command({ t: 'begin', x: at(a).x, y: at(a).y });
  sim.command({ t: 'drag', x: at(b).x, y: at(b).y, mode: 'full' });
  sim.command({ t: 'release' });
  tick(120);
  return events;
}
/** The walk's fight hook: the first `n` garrison battles are the real fight that cuts a shackle; the others made up by the walk. */
function cutting(n: number): WalkOptions['fight'] {
  let left = n;
  return run => {
    const pending = run.pending;
    if (pending?.kind !== 'battle' || !pending.nodeId.startsWith('g:') || left <= 0) return null;
    left--;
    const cuts = rtShackleCuts(cutFight(left + 1));
    assert(cuts === 1, `the real fight cut ${cuts}`);
    const outcome: RtArenaOutcome = { nodeId: pending.nodeId, won: true, hp: run.maxHp, kills: 2, damage: 0, time: 30, cuts };
    return outcome;
  };
}

check('Евлампий comes by shackles cut in a real fight of the run, not without; `last.cuts`; his camp off — nothing changes', () => {
  for (const k of [1, 2, 3]) {
    const on = createRtProfileStore(memoryStorage(), { monk: true, gambler: false }), offStorage = memoryStorage(), off = createRtProfileStore(offStorage, { gambler: false, monk: false });
    const walk = walkRun({ k, create: { gift: 'full', garrison: true, locked: on.locked() }, fight: cutting(1) });
    assert(rtRunCuts(walk.run) === 1 && walk.run.battles.some(b => b.cuts === 1 && b.nodeId.startsWith('g:')) && same(parseRtRun(serializeRtRun(walk.run)), walk.run), `seed ${k}: the record keeps the cut`);
    const end = on.endRunMeta(walk.run)!; off.endRunMeta(walk.run);
    assert(on.hearth().met.monk && on.hearth().last?.cuts === 1 && end.arrived?.some(a => a.npc === 'monk' && !a.self), `seed ${k}: came by the deed`);
    const plain = JSON.parse(offStorage.data.get(RT_PROFILE_STORAGE_KEY)!).meta.hearth;
    assert(!plain.met.monk && plain.last.cuts === undefined && plain.monkQuiet === undefined, `seed ${k}: his camp off — nothing`);
    const none = createRtProfileStore(memoryStorage(), { monk: true, gambler: false });
    none.endRunMeta(walkRun({ k, create: { gift: 'full', garrison: true, locked: none.locked() } }).run);
    assert(!none.hearth().met.monk && none.hearth().last?.cuts === undefined, `seed ${k}: no cut — no Евлампий`);
  }
});

check('his fallback: the third finished run since the profile\'s first run into the garrison; forest-only runs before it do not count', () => {
  const storage = memoryStorage(), store = createRtProfileStore(storage, { monk: true, gambler: false });
  for (let k = 1; k <= 3; k++) store.endRunMeta(walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked() } }).run);
  assert(!store.hearth().met.monk && JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!).meta.hearth.monkQuiet === undefined, 'forest-only runs: no count');
  const met: boolean[] = [];
  for (let k = 4; k <= 6; k++) {
    store.endRunMeta(walkRun({ k, create: { gift: 'full', garrison: k === 4, locked: store.locked() } }).run);
    met.push(store.hearth().met.monk);
  }
  assert(same(met, [false, false, true]) && store.hearth().self.monk === true && JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!).meta.hearth.monkQuiet === undefined, `came by himself on the third (${met})`);
});

/** A profile with Евлампий at `level` (met), his camp on: a stored profile as setup. */
function monkCamp(level: number): ReturnType<typeof createRtProfileStore> {
  // The setup's run has a seed of its own (a run of the same seed and end would read as already applied: `rtRunKey`).
  const storage = memoryStorage(), store = createRtProfileStore(storage, { monk: true, gambler: false });
  store.endRunMeta(walkRun({ k: 99, create: { gift: 'full', garrison: false, locked: store.locked() } }).run);
  const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
  p.meta.hearth.levels.monk = level; p.meta.hearth.met.monk = true; delete p.meta.hearth.quest;
  storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
  return store;
}
const avoid = (type: string): WalkOptions['pickNode'] => (run, ids) => ids.find(id => rtNode(run, id)?.type !== type) ?? null;
const prefer = (type: string): WalkOptions['pickNode'] => (run, ids) => ids.find(id => rtNode(run, id)?.type === type) ?? null;

check('«Обет»: 2 offered, 1 taken; kept — +15 XP outside «Испытание», broken — none; not counted before the Jailer\'s row; «Два обета» — 3 and 2', () => {
  // The offers by the level.
  for (const [level, offered, take] of [[1, 2, 1], [2, 3, 2]] as const) {
    const start = monkCamp(level).hearthStart(seedOf(3));
    assert(start.vows?.length === offered && start.vowCount === take && start.vows.every(id => RT_VOW_IDS.includes(id)) && new Set(start.vows).size === offered, `level ${level}: ${JSON.stringify(start.vows)}`);
    const flags = rtHearthFlagsWith(start, undefined, [...RT_VOW_IDS]);
    assert(flags.vows?.length === take && flags.vows.every(id => start.vows!.includes(id)), `level ${level}: ${take} taken`);
  }
  // «Мимо торговцев» kept and broken; «Без привала» the same way; by real walks of the forest (to the end: past the Jailer).
  const results: string[] = [];
  for (const [vow, type] of [['vow-no-shop', 'shop'], ['vow-no-rest', 'rest']] as const) {
    for (const keep of [true, false]) for (let k = 7; k <= 30; k++) {
      // The walk steered past (or into) the node type; the first seed whose walk did so.
      const store = monkCamp(1), flags = { ...store.hearthStart(seedOf(k)).flags, vows: [vow] };
      const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: flags, ash: 2 }, pickNode: keep ? avoid(type) : prefer(type) });
      const entered = walk.run.visited.some(id => rtNode(walk.run, id)?.type === type);
      if (entered === keep) continue;
      const end = store.endRunMeta(walk.run)!, part = end.xp.parts.find(x => x.id === 'vows');
      assert(same(store.hearth().last?.vows, [{ id: vow, kept: keep }]), `${vow} ${keep}: ${JSON.stringify(store.hearth().last?.vows)}`);
      assert(keep ? part?.xp === RT_XP_VOW && part.n === 1 : part === undefined, `${vow}: the XP part ${JSON.stringify(part)}`);
      // Outside «Испытание»: the ash part is of the base without the vow.
      const ash = end.xp.parts.find(x => x.id === 'ash')?.xp ?? 0, base = end.xp.parts.filter(x => !['ash', 'vows', 'quest'].includes(x.id)).reduce((s, x) => s + x.xp, 0);
      assert(ash === Math.floor(base * 12 / 10) - base, `${vow}: ash ${ash} of base ${base}`);
      results.push(`${vow}:${keep}`);
      break;
    }
  }
  assert(results.length === 4, `kept and broken of both: ${results}`);
  // Not counted when the run died before the Jailer's row.
  const store = monkCamp(1), early = walkRun({ k: 8, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: { ...store.hearthStart(seedOf(8)).flags, vows: ['vow-no-shop'] } }, loseAt: run => run.battles.length >= 1 });
  const end = store.endRunMeta(early.run)!;
  assert(store.hearth().last?.vows === undefined && !end.xp.parts.some(x => x.id === 'vows'), 'an early death counts no vow');
  // «Два обета»: each by what the run did, +15 a kept one.
  const two = monkCamp(2), both = walkRun({ k: 9, create: { gift: 'full', garrison: false, locked: two.locked(), hearth: { ...two.hearthStart(seedOf(9)).flags, vows: ['vow-no-shop', 'vow-no-mapheal'] } }, pickNode: avoid('shop') });
  const bothEnd = two.endRunMeta(both.run)!, noShop = !both.run.visited.some(id => rtNode(both.run, id)?.type === 'shop'), noHeal = !both.run.healBought;
  assert(same(two.hearth().last?.vows, [{ id: 'vow-no-shop', kept: noShop }, { id: 'vow-no-mapheal', kept: noHeal }]), `two vows: ${JSON.stringify(two.hearth().last?.vows)}`);
  assert((bothEnd.xp.parts.find(x => x.id === 'vows')?.xp ?? 0) === (Number(noShop) + Number(noHeal)) * RT_XP_VOW, 'the XP of the kept ones');
});

check('«Без переброса»: a reroll (a paid screen\'s) breaks it — the run keeps the mark only with that vow; the save round-trips', () => {
  let broken = 0, kept = 0;
  for (let k = 1; k <= 60 && (broken < 2 || kept < 1); k++) {
    const store = monkCamp(1), flags = { ...store.hearthStart(seedOf(k)).flags, vows: ['vow-no-reroll' as const] };
    // The walk rerolls the screens it can pay on some steps (its own rule).
    const walk = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: flags } });
    const plain = walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked() } });
    const rerolled = walk.run.vowRerolled === true;
    assert(plain.run.vowRerolled === undefined && same(parseRtRun(serializeRtRun(walk.run)), walk.run), 'the mark only with the vow');
    store.endRunMeta(walk.run);
    assert(same(store.hearth().last?.vows, [{ id: 'vow-no-reroll', kept: !rerolled }]), `seed ${k}: ${JSON.stringify(store.hearth().last?.vows)}`);
    if (rerolled) broken++; else kept++;
  }
  assert(broken >= 2 && kept >= 1, `broken ${broken}, kept ${kept}`);
});

check('`rtVowsNow`: the vows as they stand in the middle of the run — kept until the step that breaks one, broken from it (before the Jailer\'s row too); none — null', () => {
  let checked = 0;
  for (let k = 1; k <= 20 && checked < 3; k++) {
    const store = monkCamp(1), flags = { ...store.hearthStart(seedOf(k)).flags, vows: ['vow-no-shop' as const] };
    const states: RtRunState[] = [];
    walkRun({ k, create: { gift: 'full', garrison: false, locked: store.locked(), hearth: flags }, pickNode: prefer('shop'), each: r => states.push(r) });
    const at = states.findIndex(r => r.pending?.kind === 'shop');
    if (at < 0) continue;
    assert(states.slice(0, at).every(r => same(rtVowsNow(r), [{ id: 'vow-no-shop', kept: true }])), `seed ${k}: kept before the merchant`);
    assert(states.slice(at).every(r => same(rtVowsNow(r), [{ id: 'vow-no-shop', kept: false }])), `seed ${k}: broken from the merchant on`);
    assert(!rtReachedJailer(states[at]) ? rtVowsOf(states[at]) === null : true, 'rtVowsOf waits for the Jailer\'s row');
    checked++;
  }
  assert(checked >= 3 && rtVowsNow(walkRun({ k: 1, create: { gift: 'full', garrison: false } }).run) === null, `runs ${checked}; no vows — null`);
});

check('the quest «Разруби кандалы дважды»: done with 2 shackles cut in the run, not with 1', () => {
  const results: boolean[] = [];
  for (const n of [1, 2]) {
    const storage = memoryStorage(), store = createRtProfileStore(storage, { monk: true, gambler: false });
    store.endRunMeta(walkRun({ k: 2, create: { gift: 'full', garrison: false, locked: store.locked() } }).run);
    const p = JSON.parse(storage.data.get(RT_PROFILE_STORAGE_KEY)!);
    p.meta.hearth.met.monk = true; p.meta.hearth.quest = { npc: 'monk', id: 'monk-cuts' };
    storage.data.set(RT_PROFILE_STORAGE_KEY, JSON.stringify(p));
    const walk = walkRun({ k: 5, create: { gift: 'full', garrison: true, locked: store.locked(), hearth: store.hearthStart(seedOf(5)).flags }, fight: cutting(n) });
    const end = store.endRunMeta(walk.run)!;
    assert(end.quest?.id === 'monk-cuts' && rtRunCuts(walk.run) === n, `${n} cuts`);
    results.push(end.quest.done);
  }
  assert(same(results, [false, true]), `results ${results}`);
});

console.log(`hearth Евлампий (51г): ${checks} checks passed`);
