/**
 * Task 48б «Тролль в походе» (design 16.10.2026, docs/design-notes/task-48-troll.md, 3, 9, 15, 18–19, 23; docs/realtime-slice.md,
 * «Тролль»): the boss node of the den branch plays the Troll. Node only: `npm run test:realtime-troll-run`. Everything goes through the
 * run's own commands (enter, resolve, choose) and, for the fight, the world the run starts:
 * - a new run's den boss plays «Берлога тролля» (the map's preview the same), the camp's boss «Последний рубеж»; the pool draws, the
 *   map, the visited nodes, the events and every stream counter are those of a run without the flag (300 seeds); a run without the
 *   flag (a save before the task) plays «Последний рубеж» on both branches;
 * - saves: the Troll's pick and its record's parts read back; a Troll pick in a run without the flag, another arena at the den boss of
 *   a run with it, a malformed flag or parts — no run; a scheduled run's den boss — the Troll, arc null;
 * - the fight the run starts: the frame, the boss's death ending it, the window, the crowd ×0.6, the part's loot;
 * - the won Troll's fight with all three parts severed offers its relic 1 of 4 (the three of 1 of 3 and one more), with two parts 1 of 3;
 * - the run's end lines: «Ряд 10 · Тролль не пройден» / «Тролль пройден» for the Troll's fight, «Последний рубеж» for the camp's;
 * - the camp's death causes: the Troll — `troll`, the camp's final — `final`, the garrison's guardroom — `guardroom`, its Castellan —
 *   `castellan`.
 * Seeds `Math.imul(k, 2654435761) >>> 0`. No claim on winning or losing a fight.
 */
import { Simulation } from '../sim/simulation';
import { TROLL, TROLL_CLUB } from '../sim/enemies/troll';
import { FINAL_ARENA } from './arenaPools';
import { rtDeathCause } from './rtMeta';
import { rtRunEndLines } from './rtRunEnd';
import {
  arenaPreview, createRtRun, parseRtRun, resolveArena, rtArenaLoadout, rtArenaParams, rtAvailableNodes, rtEnterGarrison, rtEnterNode, rtFightArc, rtNode, rtRunParams,
  serializeRtRun, RT_TROLL_ALL_PARTS_SLOTS, type RtArenaOutcome, type RtRunState,
} from './rtRun';
import { assert, closeNode, ok, quiet, same, seedOf } from './runFight.testkit';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

type Branch = 'den' | 'camp';
const pendingOf = (run: RtRunState): { nodeId: string; arena: string; seed: number } => run.pending as { nodeId: string; arena: string; seed: number };
/** The outcome of the open battle (no simulation). */
const outcome = (run: RtRunState, won: boolean, extra: Partial<RtArenaOutcome> = {}): RtArenaOutcome =>
  ({ nodeId: pendingOf(run).nodeId, won, hp: won ? run.maxHp : 0, kills: 20, damage: 0, time: 60, ...extra });
const fakeWin = (run: RtRunState): RtRunState => ok(resolveArena(run, outcome(run, true)), 'resolve');
/** The node to enter: the branch's own first, else the walk's choice `(k + step)`. */
function pickNode(run: RtRunState, branch: Branch, k: number, step: number): string {
  const next = rtAvailableNodes(run);
  return (next.find(n => n.id.startsWith(`${branch}-`)) ?? next[(k + step) % next.length]).id;
}
/** The run walks by its own commands (battles won without a fight, screens closed simply) until the forest boss's battle is open. */
function toBoss(run: RtRunState, branch: Branch, k: number): { run: RtRunState; preview: string | null } {
  let preview: string | null = null;
  for (let step = 0; step < 200 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') {
      if (rtNode(run, pending.nodeId)!.type === 'boss') return { run, preview };
      run = fakeWin(run);
    } else if (pending) run = closeNode(run);
    else {
      const id = pickNode(run, branch, k, step), node = rtNode(run, id)!;
      if (node.type === 'boss') preview = arenaPreview(run, node)?.arena ?? null;
      run = ok(rtEnterNode(run, id), 'enter');
    }
  }
  throw new Error(`seed ${k}: no boss node`);
}
/** The whole run by the same walk (every battle won without a fight; the garrison entered from «Предместье»). */
function walkAll(run: RtRunState, branch: Branch, k: number): RtRunState {
  for (let step = 0; step < 400 && !run.result; step++) {
    const pending = run.pending;
    if (pending?.kind === 'battle') run = fakeWin(run);
    else if (pending?.kind === 'outskirts') run = ok(rtEnterGarrison(run), 'garrison');
    else if (pending) run = closeNode(run);
    else run = ok(rtEnterNode(run, pickNode(run, branch, k, step)), 'enter');
  }
  return run;
}
const SEEDS = 300;

check('a new run (300 seeds): its den boss plays «Берлога тролля», its camp boss «Последний рубеж» (the previews the same); the pool draws, the map, the path, the events and the streams are those of a run without the flag, which plays «Последний рубеж» on both branches', () => {
  for (let k = 1; k <= SEEDS; k++) {
    for (const branch of ['den', 'camp'] as const) {
      const a = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), branch, k), b = toBoss(createRtRun(seedOf(k), { gift: 'mini', troll: false }), branch, k);
      const node = pendingOf(a.run).nodeId;
      assert(a.run.troll === true && b.run.troll === undefined, `seed ${k}: the flag`);
      assert(node.startsWith(`${branch}-`), `seed ${k}: the ${branch} boss (${node})`);
      const want = branch === 'den' ? TROLL : FINAL_ARENA;
      assert(pendingOf(a.run).arena === want && a.preview === want, `seed ${k}, ${branch}: ${pendingOf(a.run).arena} (preview ${a.preview})`);
      assert(pendingOf(b.run).arena === FINAL_ARENA && b.preview === FINAL_ARENA, `seed ${k}, ${branch}: the old run plays «Последний рубеж» (${pendingOf(b.run).arena})`);
      assert(same(a.run.streams, b.run.streams) && same(a.run.visited, b.run.visited) && same(a.run.map, b.run.map), `seed ${k}, ${branch}: the streams, the path, the map`);
      if (k <= 60) {
        const wa = walkAll(a.run, branch, k), wb = walkAll(b.run, branch, k);
        for (const [what, x, y] of [['visited', wa.visited, wb.visited], ['events', wa.picks.map(p => p.eventId ?? null), wb.picks.map(p => p.eventId ?? null)], ['streams', wa.streams, wb.streams], ['event choices', wa.eventChoices, wb.eventChoices]] as const)
          assert(same(x, y), `seed ${k}, ${branch}: ${what} differ over the whole run`);
      }
    }
  }
});

check('saves: the Troll\'s pick and its record\'s parts read back; a save without the flag keeps none; a Troll pick in a run without the flag, «Последний рубеж» at the den boss of a run with it, a malformed flag or parts — no run', () => {
  for (let k = 1; k <= 20; k++) {
    const a = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'den', k).run, b = toBoss(createRtRun(seedOf(k), { gift: 'mini', troll: false }), 'den', k).run;
    assert(same(parseRtRun(serializeRtRun(a)), a) && same(parseRtRun(serializeRtRun(b)), b), `seed ${k}: both read back`);
    assert(!serializeRtRun(b).includes('"troll"'), `seed ${k}: no flag in the old save`);
    const nodeId = pendingOf(a).nodeId;
    const swap = (run: RtRunState, arena: string): RtRunState => {
      const x = structuredClone(run);
      x.picks.find(p => p.nodeId === nodeId)!.arena = arena; (x.pending as { arena: string }).arena = arena;
      return x;
    };
    assert(parseRtRun(serializeRtRun(swap(a, FINAL_ARENA))) === null, `seed ${k}: «Последний рубеж» at the den boss of a run with the flag`);
    assert(parseRtRun(serializeRtRun(swap(b, TROLL))) === null, `seed ${k}: the Troll in a run without the flag`);
    assert(parseRtRun(serializeRtRun({ ...a, troll: 'yes' as unknown as true })) === null, `seed ${k}: a malformed flag`);
    // A lost fight keeps its parts; the record reads back; parts out of 1…3 — no run.
    const lost = ok(resolveArena(a, outcome(a, false, { parts: 2 })), 'lose');
    assert(lost.battles.at(-1)!.parts === 2 && same(parseRtRun(serializeRtRun(lost)), lost), `seed ${k}: the lost fight's parts`);
    const bad = structuredClone(lost);
    bad.battles.at(-1)!.parts = 4;
    assert(parseRtRun(serializeRtRun(bad)) === null, `seed ${k}: parts 4`);
    // Parts of a fight on another arena are not kept.
    const camp = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'camp', k).run, other = ok(resolveArena(camp, outcome(camp, false, { parts: 2 })), 'lose');
    assert(other.battles.at(-1)!.parts === undefined, `seed ${k}: no parts on «Последний рубеж»`);
  }
});

check('a scheduled run: the den boss plays the Troll, the camp boss «Последний рубеж», both without an arc', () => {
  for (let k = 1; k <= 12; k++) {
    for (const branch of ['den', 'camp'] as const) {
      const { run, preview } = toBoss(createRtRun(seedOf(k + 70), { gift: 'mini', schedule: [] }), branch, k);
      const want = branch === 'den' ? TROLL : FINAL_ARENA;
      assert(run.schedule && pendingOf(run).arena === want && preview === want && rtFightArc(run) === null, `seed ${k}, ${branch}: ${pendingOf(run).arena}, arc ${rtFightArc(run)}`);
    }
  }
});

check('the fight the run starts: the boss frame, the boss\'s death ending it, the window, the crowd ×0.6, the part\'s loot; the colours of the parts vary by seed', () => {
  const colors = new Set<string>();
  for (let k = 1; k <= 8; k++) {
    const run = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'den', k).run;
    const sim = new Simulation({ arena: pendingOf(run).arena, params: rtArenaParams(run, rtRunParams(quiet())), seed: pendingOf(run).seed, loadout: rtArenaLoadout(run) }), p = sim.world.params;
    assert(p.bossFrame && p.bossClears && p.trollWindow && p.trollCrowd === 0.6 && p.bossPartLoot && p.jailerColorless, `seed ${k}: the fight's rules`);
    const core = sim.world.enemies.find(e => e.kind === TROLL)!, club = sim.world.enemies.find(e => e.kind === TROLL_CLUB)!;
    assert(core.marked && core.armor?.plates === 5 && club.partOf === core.id, `seed ${k}: the Troll and his parts`);
    colors.add(sim.world.enemies.filter(e => e.partOf === core.id).map(e => e.color).join());
  }
  assert(colors.size >= 3, `the parts' colours vary (${[...colors]})`);
});

check('the won Troll\'s fight with all three parts severed offers its relic 1 of 4 — the three of 1 of 3 and one more; with two parts 1 of 3; the camp\'s final 1 of 3', () => {
  let fourth = 0, full3 = 0;
  for (let k = 1; k <= 30; k++) {
    const run = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'den', k).run;
    const all = ok(resolveArena(run, outcome(run, true, { parts: 3 })), 'won 3'), two = ok(resolveArena(run, outcome(run, true, { parts: 2 })), 'won 2');
    const four = (all.pending as { kind: string; source?: string; options?: string[] }), three = (two.pending as { kind: string; source?: string; options?: string[] });
    assert(four.kind === 'talisman' && four.source === 'level' && three.kind === 'talisman' && three.source === 'level', `seed ${k}: the relic screens`);
    // The relics left in the pool may be fewer than four (the screens before took some away): then the screen shows them all.
    assert(four.options!.length <= RT_TROLL_ALL_PARTS_SLOTS && four.options!.length >= three.options!.length && same(four.options!.slice(0, three.options!.length), three.options), `seed ${k}: ${four.options} vs ${three.options}`);
    if (three.options!.length === 3) full3++;
    assert(same(all.streams, two.streams), `seed ${k}: the same talismans draw`);
    assert(same(parseRtRun(serializeRtRun(all)), all), `seed ${k}: the 1 of 4 reads back`);
    if (four.options!.length === RT_TROLL_ALL_PARTS_SLOTS && !three.options!.includes(four.options![3])) fourth++;
    const camp = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'camp', k).run, won = ok(resolveArena(camp, outcome(camp, true, { parts: 3 })), 'camp won');
    assert((won.pending as { options: string[] }).options.length <= 3, `seed ${k}: the camp's final at most 1 of 3`);
  }
  console.log(`   1 из 3 полный (3 реликвии) — ${full3} из 30 seed; четвёртая реликвия добавилась — ${fourth} из 30`);
  // A fourth whenever the pool kept four: checked on the counts (a fourth never shows with fewer than three before it).
  assert(fourth <= full3, `a fourth relic only after three`);
});

check('the end lines: the Troll lost — «Ряд 10 · Тролль не пройден», won (a run without the garrison) — «Ряд 10 · Тролль пройден»; the camp\'s final — «Последний рубеж»', () => {
  for (let k = 1; k <= 10; k++) {
    const den = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'den', k).run, camp = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'camp', k).run;
    const row = (run: RtRunState): string | undefined => rtRunEndLines(run).find(l => l.id === 'row')?.text;
    assert(row(ok(resolveArena(den, outcome(den, false)), 'lose')) === 'Ряд 10 · Тролль не пройден', `seed ${k}: ${row(ok(resolveArena(den, outcome(den, false)), 'lose'))}`);
    assert(row(ok(resolveArena(camp, outcome(camp, false)), 'lose')) === 'Ряд 10 · «Последний рубеж» не пройден', `seed ${k}: the camp`);
    const solo = toBoss(createRtRun(seedOf(k), { gift: 'mini', garrison: false }), 'den', k).run, won = ok(resolveArena(solo, outcome(solo, true)), 'win');
    assert(won.result?.outcome === 'victory' && row(won) === 'Ряд 10 · Тролль пройден', `seed ${k}: ${row(won)}`);
  }
});

check('the camp\'s death causes by the level: the Troll — `troll`, the camp\'s final — `final`, the garrison\'s guardroom — `guardroom`, its Castellan — `castellan`', () => {
  const seen = new Set<string>();
  for (let k = 1; k <= 12; k++) {
    const den = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'den', k).run, camp = toBoss(createRtRun(seedOf(k), { gift: 'mini' }), 'camp', k).run;
    assert(rtDeathCause(ok(resolveArena(den, outcome(den, false)), 'lose')) === 'troll', `seed ${k}: troll`);
    assert(rtDeathCause(ok(resolveArena(camp, outcome(camp, false)), 'lose')) === 'final', `seed ${k}: final`);
    // Into the garrison: the forest won, then lost at the first garrison checkpoint (Караульня) or boss (Кастелян).
    for (const type of ['checkpoint', 'boss'] as const) {
      let run = fakeWin(den);
      for (let step = 0; step < 400 && !run.result; step++) {
        const pending = run.pending;
        if (pending?.kind === 'battle') {
          const node = rtNode(run, pending.nodeId)!;
          run = run.garrisonLevel && node.type === type ? ok(resolveArena(run, outcome(run, false)), 'lose') : fakeWin(run);
        } else if (pending?.kind === 'outskirts') run = ok(rtEnterGarrison(run), 'garrison');
        else if (pending) run = closeNode(run);
        else {
          const next = rtAvailableNodes(run);
          run = ok(rtEnterNode(run, (next.find(n => n.type === type) ?? next[(k + step) % next.length]).id), 'enter');
        }
      }
      const cause = rtDeathCause(run);
      assert(run.result?.outcome === 'defeat' && cause === (type === 'checkpoint' ? 'guardroom' : 'castellan'), `seed ${k}, ${type}: ${cause}`);
      seen.add(cause!);
    }
  }
  assert(seen.size === 2, `both garrison causes (${[...seen]})`);
});

console.log(`troll run: ${checks} checks passed`);
