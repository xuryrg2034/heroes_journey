/**
 * B6 К7 «Проклятый сундук» in the run (run/rtRun.ts `rtChooseTalisman`, `rtChestOwed`, `rtRerollTalismans`; docs/realtime-casino.md,
 * «Проклятый сундук (К7)»). Node only: `npm run test:realtime-chest` (with sim/chest.spec.ts).
 *
 * The run goes by its own commands; «Застава» is a real fight (journalled commands) on the test field with a chest point
 * (runFight.testkit.ts `RUN_CHEST_FIELD`), the outcome read from the finished world as main.ts reads it:
 * - the chest taken (by touch), the fight won — after the «Застава» talismans the chest's own screen: 2 common talismans
 *   (an empty rarity gives way to uncommon), none of the «Застава» offer, the next `talismans` draw; the node completes
 *   after it — also when the curse was lifted (12 kills of the dash) and when the die screen came first;
 * - the chest not taken (on the same field) — no chest screen, the node completes after the «Застава» choice;
 * - the reroll works on the chest screen (price 1, 2 …; new options; a reload keeps it);
 * - several seeds: different chest offers; the same state gives the same offer;
 * - saves: a save written before B6 at the «Застава» choice (fixture of 7ae55fc) loads and completes the node as before; with `chest` on its
 *   record (as the new code writes) the chest screen follows; the chest screen survives a reload; malformed chest fields are
 *   no run;
 * - a run that never takes the chest saves byte for byte as the reroll fixture's whole walks (code of 7ae55fc, re-recorded at the calibration and at task 5 of 12.10.2026), its
 *   «Застава» fights played on the field with the chest;
 * - telemetry: the chest's choice is its own (`chest`), not merged with the «Застава» talismans; no luck line.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { RT_TASK17_OFF,
  createRtRun, parseRtRun, resolveArena, rtAvailableNodes, rtChestOwed, rtChooseEventOption, rtChooseTalisman, rtEnterNode, rtEventView, rtLuckReport, rtNode,
  rtRerollTalismans, rtRerollView, serializeRtRun, RT_CHEST_TALISMANS, type RtRunState,
} from './rtRun';
import { rtTalisman } from './rtTalismans';
import { stepChoices } from '../telemetry/recorder';
import { CHEST_SOURCE } from '../telemetry/schema';
import { CHEST_CURSE_KILLS } from '../sim/chest';
import type { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { assert, closeNode, ok, playFight, RUN_CHEST_FIELD, same, seedOf, takeGift, ticks, type FightPlan } from './runFight.testkit';
import before from '../../../tests/fixtures/rt-run-save-before-reroll.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

type Offer = Extract<NonNullable<RtRunState['pending']>, { kind: 'talisman' }>;
const offerOf = (run: RtRunState): Offer => { assert(run.pending?.kind === 'talisman', `an open talisman offer (${run.pending?.kind})`); return run.pending; };
const reload = (run: RtRunState): RtRunState => { const back = parseRtRun(serializeRtRun(run)); assert(back, 'the save loads'); return back; };
/** FNV-1a of a text (32 bits, hex) — as reroll.spec.ts hashes the walks. */
const fnv = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, '0'); };

/** The walking hero steps onto the chest (journalled teleport and walk) — the curse by touch. */
function takeChest(sim: Simulation, seen: (w: World) => void): void {
  const chest = sim.world.objects.find(o => o.kind === 'chest');
  assert(chest, 'the field has the chest');
  sim.command({ t: 'teleport', x: chest.x, y: chest.y - 1.2 });
  sim.command({ t: 'walk', x: 0, y: 1 });
  ticks(sim, 120, seen, w => !!w.curse);
  sim.command({ t: 'walk', x: 0, y: 0 });
  assert(sim.world.curse?.by === 'touch', 'the chest taken');
}

/** The run of seed `k` walked (hard nodes first; other fights won on the plain test field) until a «Застава» battle is open. */
function toHardBattle(k: number): RtRunState | null {
  let run = takeGift(createRtRun(seedOf(k), { gift: 'mini' }));
  for (let step = 0; step < 160 && !run.result; step++) {
    const p = run.pending;
    if (p?.kind === 'battle' && p.battle === 'hard') return run;
    if (p?.kind === 'battle') { run = ok(resolveArena(run, playFight(run, { chains: [6, 6, 6, 6], k }).outcome), 'fight'); continue; }
    if (p) { run = closeNode(run); continue; }
    const next = rtAvailableNodes(run);
    run = ok(rtEnterNode(run, (next.find(n => n.type === 'hard') ?? next[0]).id), 'enter');
  }
  return null;
}

/** The first `n` seeds (k = 1, 2, …) whose walk reaches a «Застава» battle, with that run. */
function hardSeeds(n: number): [number, RtRunState][] {
  const out: [number, RtRunState][] = [];
  for (let k = 1; k <= 60 && out.length < n; k++) { const at = toHardBattle(k); if (at) out.push([k, at]); }
  assert(out.length === n, `seeds with a «Застава»: ${out.length} of ${n}`);
  return out;
}

/** The open «Застава» fought on the chest field: `chest` — taken first; `chains` — the dash's kills. Then the screens up to the «Застава» offer. */
function fightHard(run: RtRunState, k: number, chest: boolean, chains: number[], roll = false): { run: RtRunState; world: World } {
  const plan: FightPlan = { chains, k, arena: RUN_CHEST_FIELD, ...chest ? { start: takeChest } : {} };
  const fight = playFight(run, plan);
  assert(!!fight.outcome.chest === chest, `the outcome says the chest ${chest ? 'was' : 'was not'} taken`);
  let next = ok(resolveArena(run, fight.outcome), 'resolve');
  // Casino «Кость у двери»: the die screen may come first; the node's victory (the talismans) follows it.
  if (next.pending?.kind === 'die') next = closeNode(next, roll);
  return { run: next, world: fight.sim.world };
}

check('the chest taken, the curse lifted or not: after the «Застава» talismans the chest\'s screen — 2 commons, the next talismans draw; then the node completes', () => {
  let screens = 0;
  for (const [k, at] of hardSeeds(6)) {
    for (const [chains, lifted] of [[[6, 6], true], [[6], false]] as const) {
      const { run, world } = fightHard(at, k, true, [...chains], k % 2 === 0);
      assert(!!world.curse && (world.curse.lifted !== undefined) === lifted && world.curse.kills === Math.min(CHEST_CURSE_KILLS, chains.reduce((a, b) => a + b, 0)), `seed ${k}: the curse ${JSON.stringify(world.curse)}`);
      const nodeId = offerOf(run).nodeId, record = run.battles[run.battles.length - 1];
      assert(record.chest === true && record.won && rtChestOwed(run, nodeId), `seed ${k}: the record has the chest`);
      const hard = offerOf(run);
      assert(hard.source === 'hard', 'the «Застава» offer first');
      const draws = run.streams.talismans, taken = hard.options[0] ?? null;
      const step = rtChooseTalisman(run, taken);
      assert(step.ok, 'the «Застава» choice');
      const after = step.run, chest = offerOf(after);
      assert(chest.source === 'chest' && chest.nodeId === nodeId && after.streams.talismans === draws + 1 && !after.visited.includes(nodeId), `seed ${k}: the chest's screen, one more draw`);
      assert(chest.options.length === RT_CHEST_TALISMANS && chest.options.every(id => ['common', 'uncommon'].includes(rtTalisman(id)!.rarity) && !hard.options.includes(id) && !after.talismans.includes(id)), `seed ${k}: ${chest.options}`);
      assert(step.events.some(e => e.type === 'talisman-offered' && same(e.options, chest.options)) && !step.events.some(e => e.type === 'node-completed'), 'offered; the node waits');
      assert(same(reload(after), after), 'the chest screen saves and loads');
      const done = ok(rtChooseTalisman(after, chest.options[1]), 'the chest choice');
      assert(done.pending === null && done.visited.includes(nodeId) && done.talismans.includes(chest.options[1]) && done.talismansGone.includes(chest.options[0]), 'the node completes; the other option leaves the pool');
      assert(!rtLuckReport(done).some(line => /сундук/i.test(line.label)), 'no luck line for the chest');
      screens++;
    }
  }
  assert(screens === 12, `chest screens: ${screens}`);
});

check('the chest not taken (the same field): no chest screen — the node completes after the «Застава» choice', () => {
  for (const [k, at] of hardSeeds(3)) {
    const { run } = fightHard(at, k, false, [6, 6]);
    assert(run.battles[run.battles.length - 1].chest === undefined && !serializeRtRun(run).includes('"chest"'), 'no chest field is written');
    const done = ok(rtChooseTalisman(run, offerOf(run).options[0] ?? null), 'choice');
    assert(done.pending === null && done.visited.includes(offerOf(run).nodeId), 'the node completes');
  }
});

check('the reroll works on the chest screen: price 1, then 2; new options none shown; a reload keeps the screen and the price', () => {
  let rerolled = 0;
  for (const [k, at] of hardSeeds(4)) {
    const won = fightHard(at, k, true, [6]).run;
    const rich0 = ok(rtChooseTalisman(won, null), 'refuse «Застава»');
    const run: RtRunState = { ...rich0, materials: { ...rich0.materials, dew: rich0.materials.dew + 5 } };
    const view = rtRerollView(run)!;
    assert(view && view.available && view.price === 1, `seed ${k}: the reroll is offered on the chest screen`);
    const once = ok(rtRerollTalismans(run), 'reroll'), offer = offerOf(once);
    assert(offer.source === 'chest' && offer.rerolls === 1 && same(offer.rerolled, offerOf(run).options) && offer.options.every(id => !offerOf(run).options.includes(id)), `seed ${k}: a new chest offer ${offer.options}`);
    assert(offer.options.length === RT_CHEST_TALISMANS && once.streams.talismans === run.streams.talismans + 1, 'two options, one more draw');
    const back = reload(once);
    assert(same(back, once) && rtRerollView(back)!.price === 2, 'a reload keeps it: price 2');
    const done = ok(rtChooseTalisman(back, offer.options[0]), 'take');
    assert(done.pending === null && done.talismans.includes(offer.options[0]), 'the node completes');
    rerolled++;
  }
  assert(rerolled === 4, `rerolled on ${rerolled} seeds`);
});

check('several seeds: different chest offers; the same state gives the same offer', () => {
  const offers = new Set<string>();
  for (const [k, at] of hardSeeds(8)) {
    const won = fightHard(at, k, true, [6]).run;
    const a = ok(rtChooseTalisman(won, null), 'refuse'), b = ok(rtChooseTalisman(structuredClone(won), null), 'refuse again');
    assert(same(a, b), `seed ${k}: the same state, the same offer`);
    offers.add(offerOf(a).options.join(','));
  }
  assert(offers.size >= 3, `different offers: ${[...offers].join(' | ')}`);
});

check('saves: a save written before B6 at the «Застава» choice completes as before; with `chest` on its record the chest screen follows; malformed fields are no run', () => {
  const old = parseRtRun(before.hard)!;
  assert(old && serializeRtRun(old) === before.hard && offerOf(old).source === 'hard', 'the fixture loads unchanged');
  const plain = ok(rtChooseTalisman(old, offerOf(old).options[0]), 'take');
  assert(plain.pending === null, 'it completes the node as before');
  const value = JSON.parse(before.hard), nodeId = value.pending.nodeId as string;
  const record = (value.battles as { nodeId: string }[]).find(entry => entry.nodeId === nodeId) as Record<string, unknown>;
  record.chest = true;
  const withChest = parseRtRun(JSON.stringify(value))!;
  assert(withChest && rtChestOwed(withChest, nodeId), 'a record with the chest loads');
  const chest = ok(rtChooseTalisman(withChest, offerOf(withChest).options[0]), 'take');
  assert(offerOf(chest).source === 'chest' && same(reload(chest), chest), 'the chest screen follows and reloads');
  const forge = (edit: (run: Record<string, any>) => void): string => { const v = JSON.parse(serializeRtRun(chest)); edit(v); return JSON.stringify(v); };
  assert(parseRtRun(forge(() => undefined)) !== null, 'the unedited save loads');
  const recordOf = (v: Record<string, any>) => v.battles.find((entry: { nodeId: string }) => entry.nodeId === nodeId);
  const bad: [string, (v: Record<string, any>) => void][] = [
    ['chest false', v => { recordOf(v).chest = false; }],
    ['chest a number', v => { recordOf(v).chest = 1; }],
    ['the chest screen without the record', v => { delete recordOf(v).chest; }],
    ['the chest on another arena', v => { recordOf(v).arena = 'ford'; v.picks.find((p: { nodeId: string }) => p.nodeId === nodeId).arena = 'ford'; }],
    ['the chest screen of a lost fight', v => { recordOf(v).won = false; }],
    ['the chest offer not of the draw', v => { v.pending.options = [...v.pending.options].reverse(); }],
    ['three options', v => { v.pending.options.push(v.talismansGone[0]); }],
  ];
  for (const [what, edit] of bad) assert(parseRtRun(forge(edit)) === null, `${what} is no run`);
});

/**
 * A whole run walked as reroll.spec.ts `walkSaves` walks it (the same choices), its «Застава» fights played on the field
 * with the chest without taking it.
 */
function walkSaves(k: number, chestField = true, events = true): string[] {
  // Task 12 (13.10.2026): the fixture's saves predate the run flag `markedGoals` (it adds one field to every save; the fights
  // here play the test field, not the marked arenas) — the walk keeps a run without it, so the bytes compare as before.
  // Task 15 (14.10.2026): the same for the flag `healMap` (one more field; the walk buys no map heal).
  // Task 28 (15.10.2026): the same for the flag `jailer` (one more field, and the Jailer's node plays its pool as the fixture's).
  let run: RtRunState = takeGift(createRtRun(seedOf(k), { gift: 'mini', markedGoals: false, ...RT_TASK17_OFF, healMap: false, shortFuse: false, jailer: false }));
  const saves = [serializeRtRun(run)];
  for (let step = 0; step < 160 && !run.result; step++) {
    const p = run.pending;
    if (p?.kind === 'battle') run = ok(resolveArena(run, playFight(run, { chains: [6, 6, 6, 6], k, ...p.battle === 'hard' && chestField ? { arena: RUN_CHEST_FIELD } : {} }).outcome), 'fight');
    else if (p?.kind === 'talisman') run = ok(rtChooseTalisman(run, p.options[0] ?? null), 'talisman');
    else if (p?.kind === 'event' && events) {
      const fight = rtEventView(run)!.options.find(option => option.battle && option.available);
      run = fight ? ok(rtChooseEventOption(run, fight.id), 'event battle') : closeNode(run);
    } else if (p) run = closeNode(run);
    else { const next = rtAvailableNodes(run); run = ok(rtEnterNode(run, (next.find(n => n.type === 'hard') ?? (events ? next.find(n => n.type === 'event') : undefined) ?? next[0]).id), 'enter'); }
    saves.push(serializeRtRun(run));
  }
  return saves;
}

check('a run that never takes the chest saves byte for byte as the fixture walks (code of 7ae55fc, re-recorded at the calibration and at task 5 of 12.10.2026): 8 whole runs, «Застава» on the field with the chest', () => {
  const walks = before.walks as Record<string, { steps: number; hash: string; talismansDraws: number; result: string }>;
  let hard = 0;
  for (const [k, want] of Object.entries(walks)) {
    const saves = walkSaves(Number(k)), last = JSON.parse(saves[saves.length - 1]) as RtRunState;
    assert(saves.length === want.steps && fnv(saves.join('\n')) === want.hash, `seed ${k}: ${saves.length} saves, hash ${fnv(saves.join('\n'))} (was ${want.steps}, ${want.hash})`);
    assert(saves.every(text => !text.includes('"chest"')), `seed ${k}: no chest field`);
    hard += last.battles.filter(record => rtNode(last, record.nodeId)?.type === 'hard').length;
  }
  assert(hard >= 2, `«Застава» fights on the way: ${hard}`);
  // More seeds with «Застава» on the way (hard nodes first, no event battles): the field with the chest (not taken) and the
  // plain field save the same.
  let more = 0;
  for (const [k] of hardSeeds(6)) {
    const a = walkSaves(k, true, false), b = walkSaves(k, false, false), last = JSON.parse(a[a.length - 1]) as RtRunState;
    assert(same(a, b), `seed ${k}: the same saves`);
    more += last.battles.filter(record => rtNode(last, record.nodeId)?.type === 'hard').length;
  }
  assert(more >= 6, `«Застава» fights: ${more}`);
});

check('telemetry: the chest\'s choice is its own source, not merged with the «Застава» talismans', () => {
  const [[k, at]] = hardSeeds(1);
  const won = fightHard(at, k, true, [6]).run;
  const hardStep = rtChooseTalisman(won, offerOf(won).options[0] ?? null);
  assert(hardStep.ok, 'the «Застава» choice');
  const hardChoices = stepChoices(won, hardStep);
  assert(hardChoices.length === 1 && hardChoices[0].source === 'talisman', JSON.stringify(hardChoices));
  const chestStep = rtChooseTalisman(hardStep.run, null);
  assert(chestStep.ok, 'the chest refused');
  const chestChoices = stepChoices(hardStep.run, chestStep);
  assert(chestChoices.length === 1 && chestChoices[0].source === CHEST_SOURCE && same(chestChoices[0].refused, offerOf(hardStep.run).options), JSON.stringify(chestChoices));
});

console.log(`chest run: ${checks} checks ok`);
