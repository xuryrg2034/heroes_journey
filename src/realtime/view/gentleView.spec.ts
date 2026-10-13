/**
 * Task 17 «Пологий вход», the view of the run map (view/runView.ts): the winged heart by the HP (`secondWindMark`) and the start
 * potion's blink in the run's first fight (`arenaBlink`), read from runs walked by their own commands. Node only:
 * `npm run test:realtime-gentle-view`. The map and the fight by real input: tests/realtime-run.spec.ts (the blink),
 * tests/realtime-gentle.spec.ts (the heart lit, the second wind's text, the heart dim, the card of a gentle run).
 */
import { createRtRun, resolveArena, rtAvailableNodes, rtEnterNode, rtNode, RT_SECOND_WIND_LAST_ROW, RT_TASK17_OFF, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';
import { closeNode, ok, seedOf, takeGift } from '../run/runFight.testkit';
import { arenaBlink, secondWindMark } from './runView';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }

/** Walks the run (the first available node, screens closed simply, battles won); `seen` sees the map before each choice. */
function walk(run: RtRunState, seen: (run: RtRunState) => void, win: (run: RtRunState) => { secondWind?: boolean } = () => ({})): void {
  for (let step = 0; step < 400 && !run.result; step++) {
    if (run.pending?.kind === 'battle') {
      seen(run);
      run = ok(resolveArena(run, { nodeId: run.pending.nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic'], ...win(run) }), 'win');
      continue;
    }
    if (run.pending) { run = closeNode(run); continue; }
    seen(run);
    run = ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  }
}
const rowOf = (run: RtRunState): number => { const node = run.currentNodeId ? rtNode(run, run.currentNodeId) : undefined; return node ? runRow(node.row) : 0; };

check('the heart: lit on rows 1–4 (a row-4 battle open too), gone once the map offers row 5; a run without the flag — none', () => {
  for (let k = 1; k <= 8; k++) {
    let lit = 0, gone = 0;
    walk(takeGift(createRtRun(seedOf(k), { gift: 'mini' })), run => {
      const mark = secondWindMark(run), row = rowOf(run), next = rtAvailableNodes(run).map(n => runRow(n.row));
      if (run.pending?.kind === 'battle' && row <= RT_SECOND_WIND_LAST_ROW) { assert(mark === 'ready', `seed ${k}: a battle of row ${row}: ${mark}`); lit++; }
      if (!run.pending && next.length && next.every(r => r > RT_SECOND_WIND_LAST_ROW)) { assert(mark === null, `seed ${k}: the map offers row ${next}: ${mark}`); gone++; }
      if (!run.pending && next.length && next.every(r => r <= RT_SECOND_WIND_LAST_ROW)) assert(mark === 'ready', `seed ${k}: the map offers row ${next}: ${mark}`);
    });
    assert(lit >= 1 && gone > 0, `seed ${k}: lit ${lit}, gone ${gone}`);
    walk(takeGift(createRtRun(seedOf(k), { gift: 'mini', ...RT_TASK17_OFF })), run => assert(secondWindMark(run) === null, `seed ${k}: an old run: ${secondWindMark(run)}`));
  }
});

check('the heart: dim once the second wind stood the hero up (the outcome says so), until row 5', () => {
  let spentSeen = 0;
  walk(takeGift(createRtRun(seedOf(3), { gift: 'mini' })), run => {
    const mark = secondWindMark(run), row = rowOf(run);
    if (run.secondWindSpent && row < RT_SECOND_WIND_LAST_ROW) { assert(mark === 'spent', `row ${row}: ${mark}`); spentSeen++; }
  }, run => (rowOf(run) === 2 ? { secondWind: true } : {}));
  assert(spentSeen > 0, 'the spent heart seen');
});

check('the start potion blinks in the run\'s first fight only (as a gained kind); a run without it — the gained kinds alone', () => {
  const run = toFirstBattle(takeGift(createRtRun(seedOf(5), { gift: 'mini' })));
  assert(arenaBlink(run).includes('healing'), `first fight: ${arenaBlink(run)}`);
  const second = toFirstBattle(ok(resolveArena(run, { nodeId: (run.pending as { nodeId: string }).nodeId, won: true, hp: run.hp, kills: 20, damage: 0, time: 40, kinds: ['basic'] }), 'win'));
  assert(!arenaBlink(second).includes('healing') || (second.itemsNew ?? []).includes('healing'), `second fight: ${arenaBlink(second)} (new ${second.itemsNew})`);
  const old = toFirstBattle(takeGift(createRtRun(seedOf(5), { gift: 'mini', ...RT_TASK17_OFF })));
  assert(JSON.stringify(arenaBlink(old)) === JSON.stringify(old.itemsNew ?? []), `old: ${arenaBlink(old)} / ${old.itemsNew}`);
});

function toFirstBattle(run: RtRunState): RtRunState {
  for (let step = 0; step < 100 && run.pending?.kind !== 'battle'; step++) run = run.pending ? closeNode(run) : ok(rtEnterNode(run, rtAvailableNodes(run)[0].id), 'enter');
  return run;
}

console.log('\ngentle view: all checks passed');
