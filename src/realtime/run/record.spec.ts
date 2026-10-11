/**
 * П10 «Личный рекорд» (docs/realtime-slice.md, section 9; docs/realtime-engagement-research.md, П10). Node only:
 * `npm run test:realtime-record`.
 *
 * Run fights are real fights (journalled chains on a quiet field with the run's params and loadout), read as main.ts reads
 * them; the run goes on by its commands; the result line comes from the run save and the viewer's store as the result
 * screen builds it:
 * - the fight record keeps the fight's longest chain in kills (`bestChain`), won or lost; the run's best is the largest;
 * - the line «Лучшая цепь боя N · похода M · рекорд R» and its flash over a sequence of fights and two runs (hand-counted);
 * - a `?seed=` run and a lost fight count; the sandbox never writes the record (no run arena — no line);
 * - the save: version 7 with the optional field; a save written before it (fixture) loads and plays on as before;
 *   a malformed field is no run; the record store survives a broken value;
 * - the run's outputs for the seed (map, streams, nodes, payouts) do not depend on it.
 * Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { createRtRun, parseRtRun, resolveArena, rtRunBestChain, serializeRtRun, RT_RUN_VERSION, type RtRunState } from './rtRun';
import { createRtRunStore, RT_RUN_STORAGE_KEY, type RunStorage } from './rtRunStorage';
import { ChainRecordStore, chainLine, CHAIN_RECORD_KEY, type ChainLine } from '../view/chainRecord';
import { assert, closeNode, ok, playFight, same, seedOf, takeGift, toBattle, type FightPlan } from './runFight.testkit';
import saveBefore from '../../../tests/fixtures/rt-run-save-before-record.json';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }

/** A plain object as the viewer's storage. */
function memory(): RunStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, removeItem: key => { delete data[key]; } };
}

/**
 * What main.ts does when a run fight ends: the line from the run's best before it and the stored record before it, the
 * store takes the fight's chain, the run records the arena. Returns the run after the arena and the line.
 */
function endFight(run: RtRunState, store: ChainRecordStore, plan: FightPlan): { run: RtRunState; line: ChainLine } {
  const { outcome } = playFight(run, plan);
  const line = chainLine(outcome.bestChain!, rtRunBestChain(run), store.best());
  store.submit(outcome.bestChain!);
  return { run: ok(resolveArena(run, outcome), 'resolve'), line };
}
/** The next battle after a won one (the screens between closed by simple choices). */
const next = (run: RtRunState): RtRunState => toBattle(closeNode(run));

check('the fight record keeps the longest chain in kills; the run\'s best is the largest; a lost fight counts', () => {
  let run = toBattle(takeGift(createRtRun(seedOf(1), { gift: 'mini' })));
  assert(rtRunBestChain(run) === null, 'a new run has no best');
  const store = new ChainRecordStore(memory());
  // Fight 1: chains of 3 and 2 — the longest is 3 (kills 5).
  let step = endFight(run, store, { chains: [3, 2] });
  run = step.run;
  assert(run.battles[0].bestChain === 3 && run.battles[0].kills === 5 && rtRunBestChain(run) === 3, `fight 1: ${JSON.stringify(run.battles[0])}`);
  // Fight 2: a chain of 6 → the run's best 6.
  step = endFight(next(run), store, { chains: [6], k: 2 });
  run = step.run;
  assert(run.battles[1].bestChain === 6 && rtRunBestChain(run) === 6, 'fight 2');
  // Fight 3, lost: a chain of 4 before the fall — recorded, the best stays 6.
  step = endFight(next(run), store, { chains: [4], lose: true, k: 3 });
  run = step.run;
  assert(run.result?.outcome === 'defeat' && run.battles[2].won === false && run.battles[2].bestChain === 4 && rtRunBestChain(run) === 6, 'the lost fight is recorded');
  // A lost fight with the longest chain of the run raises the run's best.
  let other = toBattle(takeGift(createRtRun(seedOf(2), { gift: 'mini' })));
  other = endFight(other, store, { chains: [2] }).run;
  const lost = endFight(next(other), store, { chains: [7], lose: true });
  assert(lost.run.result?.outcome === 'defeat' && rtRunBestChain(lost.run) === 7 && lost.line.text === 'Лучшая цепь боя 7 · похода 7 · рекорд 7' && lost.line.flash === 'record', `a lost fight sets the records: ${lost.line.text}`);
});

check('the line and its flash over two runs (hand-counted); a ?seed= run counts; the record lives in the viewer\'s store', () => {
  const storage = memory(), store = new ChainRecordStore(storage);
  // Run 1. Fight 1: the viewer's first fight — 3 kills, nothing to beat: no flash.
  let run = toBattle(takeGift(createRtRun(seedOf(3), { gift: 'mini' })));
  let step = endFight(run, store, { chains: [3] });
  assert(step.line.text === 'Лучшая цепь боя 3 · похода 3 · рекорд 3' && step.line.flash === null, `run 1, fight 1: ${step.line.text} ${step.line.flash}`);
  // Fight 2: 5 beats the stored 3 — the all-time record flashes.
  step = endFight(next(step.run), store, { chains: [2, 5], k: 2 });
  assert(step.line.text === 'Лучшая цепь боя 5 · похода 5 · рекорд 5' && step.line.flash === 'record', `run 1, fight 2: ${step.line.text} ${step.line.flash}`);
  // Fight 3: 4 beats nothing.
  step = endFight(next(step.run), store, { chains: [4], k: 3 });
  assert(step.line.text === 'Лучшая цепь боя 4 · похода 5 · рекорд 5' && step.line.flash === null, `run 1, fight 3: ${step.line.text}`);
  assert(JSON.parse(storage.data[CHAIN_RECORD_KEY]).best === 5, 'the store keeps 5');

  // Run 2 — a ?seed= run (seeded). Fight 1: the first of the run, 2 < 5: no flash.
  run = toBattle(takeGift(createRtRun(seedOf(4), { gift: 'full', seeded: true })));
  assert(run.seeded === true, 'a seeded run');
  step = endFight(run, store, { chains: [2] });
  assert(step.line.text === 'Лучшая цепь боя 2 · похода 2 · рекорд 5' && step.line.flash === null, `run 2, fight 1: ${step.line.text}`);
  // Fight 2: 4 beats the run's 2, not the record 5 — the run record flashes.
  step = endFight(next(step.run), store, { chains: [4], k: 2 });
  assert(step.line.text === 'Лучшая цепь боя 4 · похода 4 · рекорд 5' && step.line.flash === 'run', `run 2, fight 2: ${step.line.text} ${step.line.flash}`);
  // Fight 3: 6 beats both — the all-time record flashes (one flash, the stronger), and the store takes 6.
  step = endFight(next(step.run), store, { chains: [6], k: 3 });
  assert(step.line.text === 'Лучшая цепь боя 6 · похода 6 · рекорд 6' && step.line.flash === 'record', `run 2, fight 3: ${step.line.text} ${step.line.flash}`);
  assert(store.best() === 6, 'the seeded run counts for the record');
  // Equal is no new record.
  step = endFight(next(step.run), store, { chains: [6], k: 4 });
  assert(step.line.text === 'Лучшая цепь боя 6 · похода 6 · рекорд 6' && step.line.flash === null, 'equal — no flash');
  // The run's best comes from the save: after a reload it is the same.
  const back = parseRtRun(serializeRtRun(step.run))!;
  assert(back && rtRunBestChain(back) === 6 && same(back.battles, step.run.battles), 'the save keeps the fight records');
});

check('the store: a broken or foreign value reads as none; a throwing storage keeps nothing and does not throw', () => {
  for (const bad of ['', 'x', '7', '{"version":2,"best":4}', '{"version":1,"best":-1}', '{"version":1,"best":2.5}', '{"version":1}']) {
    const storage = memory();
    storage.data[CHAIN_RECORD_KEY] = bad;
    const store = new ChainRecordStore(storage);
    assert(store.best() === null, `«${bad}» reads as none`);
    store.submit(3);
    assert(store.best() === 3, 'a new record replaces it');
  }
  const throwing = new ChainRecordStore({ getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } });
  throwing.submit(4);
  assert(throwing.best() === null, 'nothing kept');
  const none = new ChainRecordStore(null);
  none.submit(4);
  assert(none.best() === null, 'no storage');
  // A lower chain never lowers the record.
  const store = new ChainRecordStore(memory());
  store.submit(5); store.submit(2);
  assert(store.best() === 5, 'the record never drops');
});

check('the save: version 7, the optional field; malformed values are no run', () => {
  const run = toBattle(takeGift(createRtRun(seedOf(5), { gift: 'mini' })));
  const after = endFight(run, new ChainRecordStore(memory()), { chains: [3] }).run;
  assert(after.version === RT_RUN_VERSION && RT_RUN_VERSION === 7 && after.battles[0].bestChain === 3, 'version 7, the field');
  const storage = memory(), store = createRtRunStore(storage);
  assert(store.save(after) && JSON.parse(storage.data[RT_RUN_STORAGE_KEY]).battles[0].bestChain === 3, 'stored under -v7');
  assert(same(store.load(), after), 'loaded the same');
  for (const bad of [-1, 2.5, '3', null, true, Number.NaN]) {
    const forged = JSON.parse(serializeRtRun(after));
    forged.battles[0].bestChain = bad;
    assert(parseRtRun(JSON.stringify(forged)) === null, `bestChain ${String(bad)} is no run`);
  }
  // An outcome without the field records none (as before).
  const plain = ok(resolveArena(run, { nodeId: (run.pending as { nodeId: string }).nodeId, won: true, hp: run.hp, kills: 2, damage: 0, time: 1 }), 'plain');
  assert(!('bestChain' in plain.battles[0]) && rtRunBestChain(plain) === null, 'no field without the outcome\'s');
});

check('a save written before П10 (fixture, code of 223f54f) loads unchanged and plays on; its old fights have no best', () => {
  const text = saveBefore.save;
  const old = parseRtRun(text);
  assert(old && old.version === 7 && old.pending?.kind === 'battle', 'the fixture loads with its open battle');
  assert(serializeRtRun(old) === text, 'loaded unchanged');
  assert(old.battles.length === 3 && old.battles.every(record => !('bestChain' in record)) && rtRunBestChain(old) === null, 'no best in old records');
  const storage = memory();
  storage.data[RT_RUN_STORAGE_KEY] = text;
  assert(same(createRtRunStore(storage).load(), old), 'from the -v7 key');
  // It plays on: the open battle, then the next.
  const store = new ChainRecordStore(memory());
  let step = endFight(old, store, { chains: [4] });
  assert(step.run.battles.length === 4 && step.run.battles[3].bestChain === 4 && rtRunBestChain(step.run) === 4, 'the new fight records its best');
  assert(step.line.text === 'Лучшая цепь боя 4 · похода 4 · рекорд 4' && step.line.flash === null, 'the old fights count as unknown');
  assert(same(step.run.battles.slice(0, 3), old.battles), 'the old records as they were');
  step = endFight(next(step.run), store, { chains: [5], k: 2 });
  assert(rtRunBestChain(step.run) === 5 && step.line.flash === 'record', 'and on');
  assert(parseRtRun(serializeRtRun(step.run)) !== null, 'the save after it loads');
});

check('the run\'s outputs do not depend on the field: the same run without it differs only in the records', () => {
  for (let k = 6; k <= 9; k++) {
    let a = toBattle(takeGift(createRtRun(seedOf(k), { gift: 'mini' }))), b = a;
    for (let fight = 0; fight < 3 && !a.result; fight++) {
      const { outcome } = playFight(a, { chains: [3 + fight], k: fight + 1 });
      const plain = { ...outcome };
      delete plain.bestChain;
      a = ok(resolveArena(a, outcome), 'with'); b = ok(resolveArena(b, plain), 'without');
      const strip = (run: RtRunState) => ({ ...run, battles: run.battles.map(({ bestChain: _, ...rest }) => rest) });
      assert(same(strip(a), b), `seed ${k}, fight ${fight}: the runs differ only in bestChain`);
      if (a.result) break;
      a = next(a); b = next(b);
      assert(same(strip(a), b), 'the walks agree');
    }
  }
});

console.log(`\n${checks} checks passed`);
