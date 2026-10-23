/**
 * Task 49, the camp's lines by the hero of the last run (view/npcLines.ts `CAT_MARKED`, `pickLine`; view/heroLines.ts `toadRunKey`):
 * after Ведунья's run (`LineContext.hero` 'toad') no line that carries the mark `cat` is said — on any occasion, on many turns of the
 * memory — and every occasion still has a line; after the cat's run (no hero) the marked lines are said as before. Her own lines of
 * the run: the record, the death by the crowd / the Jailer / any other cause. Node only: `npm run test:realtime-npc-lines`.
 */
// The project has no Node typings (the design table is read as text, Node only).
// @ts-expect-error node:fs has no declarations here
import { readFileSync } from 'node:fs';
import { CAT_MARKED, NPC_LINES, pickLine, RETURN_KEYS, type DeathCause, type LineContext, type LineKey, type ReturnKey } from './npcLines';
import { toadRunKey, TOAD_LINES } from './heroLines';
import type { NpcId } from './metaModel';
import { TOAD_LINES_BY_NPC } from './npcToadLines';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function check(name: string, run: () => void): void { run(); console.log(`ok - ${name}`); }
const NPCS: NpcId[] = ['owl', 'herb', 'smith', 'gambler', 'monk'];
const CAUSES: DeathCause[] = ['crowd', 'archer', 'sapper', 'jailer', 'final', 'fire', 'other'];
const OCCASIONS: Partial<LineContext>[] = [
  {}, { self: true }, { bought: 2 },
  { last: { won: true, firstWin: true } }, { last: { won: true } }, { last: { won: true, record: true } }, { last: { won: false, record: true } },
  { last: { won: false, questDone: true } }, { last: { won: false, questFail: true } }, { last: { won: false, pack: true } },
  ...CAUSES.map(cause => ({ last: { won: false, cause } })),
];
const marked = (npc: NpcId, key: LineKey, text: string): boolean => (CAT_MARKED[npc][key] ?? []).some(i => NPC_LINES[npc][key]![i - 1] === text);

check('the marks point at real lines (every place is inside its key\'s list) and name the cat\'s words', () => {
  let n = 0;
  for (const npc of NPCS) for (const [key, places] of Object.entries(CAT_MARKED[npc])) for (const i of places!) {
    const list = NPC_LINES[npc][key as LineKey];
    assert(list && i >= 1 && i <= list.length, `${npc}.${key}(${i}) is not a line`);
    n++;
  }
  assert(n >= 50, `${n} marks`);
});

check('after her run no marked line is said, on any occasion and any turn of the memory; every occasion still has a line', () => {
  for (const npc of NPCS) for (const ctx of OCCASIONS) for (let turn = 0; turn < 6; turn++) {
    const memory = Object.fromEntries((Object.keys(NPC_LINES[npc]) as LineKey[]).flatMap(k => [[`${npc}:${k}`, turn], [`${npc}:${k}:toad`, turn]]));
    const line = pickLine(npc, { others: NPCS, hero: 'toad', ...ctx }, memory);
    assert(line.text, `${npc}: a line`);
    assert(!marked(npc, line.key, line.text), `${npc} ${JSON.stringify(ctx)} turn ${turn}: marked «${line.text}» after her run`);
  }
});

check('after the cat\'s run (no hero) the marked lines are said as before: the first death by the crowd of the owl is her first line', () => {
  const line = pickLine('owl', { others: NPCS, last: { won: false, cause: 'crowd' } }, { 'owl:first': 9 });
  assert(line.key === 'death_crowd' && line.text === NPC_LINES.owl.death_crowd![0], `got ${line.text}`);
  const hers = pickLine('owl', { others: NPCS, hero: 'toad', last: { won: false, cause: 'crowd' } }, { 'owl:first': 9 });
  assert(hers.text !== line.text, 'after her run the first line is skipped');
  let said = 0;
  for (let t = 0; t < 4; t++) if (marked('owl', 'death_crowd', pickLine('owl', { others: NPCS, last: { won: false, cause: 'crowd' } }, { 'owl:first': 9, 'owl:death_crowd': t }).text)) said++;
  assert(said === 4, 'the cat hears both marked lines in turn');
});

check('her lines of the run: the record first, then the death by cause (crowd, Jailer, any other); a win without a record — none', () => {
  assert(toadRunKey({ won: false, beaten: true, cause: 'crowd' }) === 'record', 'record first');
  assert(toadRunKey({ won: false, beaten: false, cause: 'crowd' }) === 'death_crowd' && toadRunKey({ won: false, beaten: false, cause: 'jailer' }) === 'death_jailer', 'crowd and Jailer');
  for (const cause of ['archer', 'sapper', 'final', 'fire', 'troll', undefined]) assert(toadRunKey({ won: false, beaten: false, cause }) === 'death_other', `other: ${cause}`);
  assert(toadRunKey({ won: true, beaten: false }) === null, 'a win without a record');
  assert(TOAD_LINES.death_crowd[0].includes('замкнуть') && TOAD_LINES.record.length === 1, 'the design\'s lines');
});

const DOC = readFileSync(new URL('../../../docs/design-notes/npc-lines-v2.md', import.meta.url), 'utf8').split(/\r?\n/);
const NAMES: Record<string, NpcId | undefined> = { 'Неясыть': 'owl', 'Марфа': 'herb', 'Ерофей': 'smith', 'Шиш': 'gambler', 'Евлампий': 'monk' };

check('the 89 variants of the design table: every row of Неясыть, Марфа, Ерофей, Шиш, Евлампий is in the data under its NPC and key, in the table order, word for word', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('### Варианты для Ведуньи')), rows: { who: string; key: string; text: string }[] = [];
  for (const l of DOC.slice(from)) {
    if (l.startsWith('| NPC | Метка')) break;
    const m = /^\| (Неясыть|Марфа|Ерофей|Шиш|Евлампий) \| `([a-z_0-9]+)` \| (.*) \|\s*$/.exec(l);
    if (m) rows.push({ who: m[1], key: m[2], text: m[3] });
  }
  assert(rows.length === 89, `${rows.length} rows in the table`);
  const ours = rows.filter(r => NAMES[r.who]);
  const expected: Record<string, string[]> = {};
  for (const r of ours) (expected[`${NAMES[r.who]}.${r.key}`] ??= []).push(r.text);
  const got: Record<string, string[]> = {};
  // Task 61: its keys follow the task's spec (checked below), not this table.
  for (const npc of NPCS) for (const [key, list] of Object.entries(TOAD_LINES_BY_NPC[npc])) if (!RETURN_KEYS.includes(key as ReturnKey)) got[`${npc}.${key}`] = [...list!];
  assert(JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(Object.keys(got).sort()), 'the same NPC and key pairs');
  for (const k of Object.keys(expected)) assert(JSON.stringify(expected[k]) === JSON.stringify(got[k]), `${k}: the text of the table`);
  assert(ours.length === 89 && Object.values(got).flat().length === 89, `${ours.length} rows of the five NPC`);
});

check('the table of the mark cat (v1 rows) is CAT_MARKED, place for place', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('### Метка `cat`')), table: Record<string, number[]> = {};
  for (const l of DOC.slice(from)) {
    if (l.startsWith('### ') && !l.includes('Метка')) break;
    const m = /^\| (Неясыть|Марфа|Ерофей|Шиш|Евлампий) \| (v1|v2) \| `([a-z_0-9]+)`(?: \((\d+)\))? \|/.exec(l);
    // Task 51д: every row of the table — the v2 rows of Марфа, Ерофей (win_garrison_first, back_met, meet_hello) are in the data too.
    if (m) (table[`${NAMES[m[1]]}.${m[3]}`] ??= []).push(m[4] ? Number(m[4]) : 1);
  }
  const ours: Record<string, number[]> = {};
  for (const npc of NPCS) for (const [key, places] of Object.entries(CAT_MARKED[npc])) if (!RETURN_KEYS.includes(key as ReturnKey)) ours[`${npc}.${key}`] = [...places!];
  assert(Object.values(table).flat().length === 75, `${Object.values(table).flat().length} marks in the table`);
  assert(JSON.stringify(Object.keys(table).sort()) === JSON.stringify(Object.keys(ours).sort()), 'the same keys');
  for (const k of Object.keys(table)) assert(JSON.stringify([...table[k]].sort()) === JSON.stringify([...ours[k]].sort()), `${k}: marks ${table[k]} vs ${ours[k]}`);
});

check('after her run her variant goes first and is counted apart (npc:key:toad); after the cat run no variant is said', () => {
  for (const npc of NPCS) for (const key of ['win', 'record', 'death_crowd', 'death_other'] as const) {
    const variants = TOAD_LINES_BY_NPC[npc][key];
    if (!variants?.length) continue;
    const ctx = key === 'win' ? { won: true } : key === 'record' ? { won: false, record: true } : { won: false, cause: key === 'death_crowd' ? 'crowd' as const : 'other' as const };
    // The cat has said this key many times: her counter is her own, the first show is her first variant, without «опять».
    const met = { [`${npc}:first`]: 99, [`${npc}:win_first:toad`]: 99 };
    const first = pickLine(npc, { others: NPCS, hero: 'toad', last: ctx }, { ...met, [`${npc}:${key}`]: 7 });
    assert(first.text === variants[0] && first.id === `${npc}:${key}:toad`, `${npc} ${key}: first ${first.text}`);
    const second = pickLine(npc, { others: NPCS, hero: 'toad', last: ctx }, { ...met, [`${npc}:${key}`]: 7, [`${npc}:${key}:toad`]: 1 });
    const list = [...variants, ...(NPC_LINES[npc][key] ?? []).filter((_, i) => !(CAT_MARKED[npc][key] ?? []).includes(i + 1))];
    assert(second.text === list[1 % list.length], `${npc} ${key}: second`);
    for (let t = 0; t < 6; t++) {
      const cat = pickLine(npc, { others: NPCS, last: ctx }, { [`${npc}:first`]: 99, [`${npc}:${key}`]: t, [`${npc}:${key}:toad`]: t });
      assert(!variants.includes(cat.text) && cat.id === `${npc}:${key}`, `${npc} ${key}: the cat hears no variant`);
    }
  }
});

check('design 17.10.2026: the meeting keys are one count for the profile (not met again after her first run); her first win is her variant, else the ordinary win', () => {
  for (const npc of NPCS) {
    // The cat met the NPC (the key's lines are all said): her run brings no meeting, on any occasion.
    const met = { [`${npc}:first`]: (NPC_LINES[npc].first ?? [NPC_LINES[npc].first_won![0]]).length, [`${npc}:first_self`]: 5 };
    for (const ctx of OCCASIONS) {
      const line = pickLine(npc, { others: NPCS, hero: 'toad', ...ctx }, met);
      assert(line.key !== 'first' && line.key !== 'first_self', `${npc} ${JSON.stringify(ctx)}: met again (${line.key})`);
    }
    if (!NPC_LINES[npc].win_first) continue; // Шиш has no `win_first` (his first win is the ordinary `win`)
    // The first win of the profile is hers (`firstWin`); the cat's own first win does not count for her.
    const cat = { [`${npc}:first`]: 99, [`${npc}:win_first`]: 1 };
    const variant = TOAD_LINES_BY_NPC[npc].win_first![0];
    const news = pickLine(npc, { others: NPCS, hero: 'toad', last: { won: true, firstWin: true } }, cat);
    assert(news.key === 'win_first' && news.text === variant && news.id === `${npc}:win_first:toad`, `${npc}: her first win is her variant (${news.text})`);
    // Said once: the next camp takes her ordinary `win` (her variants first, then the unmarked lines).
    const next = pickLine(npc, { others: NPCS, hero: 'toad', last: { won: true, firstWin: true } }, { ...cat, [`${npc}:win_first:toad`]: 1 });
    assert(next.key === 'win' && next.id === `${npc}:win:toad`, `${npc}: then the ordinary win (${next.key})`);
    // The cat's first win keeps its own counter and its own lines.
    const his = pickLine(npc, { others: NPCS, last: { won: true, firstWin: true } }, { [`${npc}:first`]: 99 });
    assert(his.key === 'win_first' && his.id === `${npc}:win_first` && his.text === NPC_LINES[npc].win_first![0], `${npc}: the cat's first win`);
  }
});

check('task 51 (design 17.10.2026): `buy_3` and `locked3` of Неясыть, Марфа, Ерофей are the design table words (`Добавки`, `Сверх счёта 3.5`), no mark cat; a purchase of level 3 says `buy_3`', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('## Добавки')), to = DOC.findIndex((l: string) => l.startsWith('## v2.1')), got: Record<string, string> = {};
  for (const l of DOC.slice(from, to)) {
    const m = /^\| (Неясыть|Марфа|Ерофей) \| `(buy_3|locked3)` \| (?:[^|]*\| )?(.*?) \|\s*$/.exec(l);
    if (m) got[`${NAMES[m[1]]}.${m[2]}`] = m[3];
  }
  assert(Object.keys(got).length === 6, `${Object.keys(got).length} rows`);
  for (const npc of NPCS.slice(0, 3)) for (const key of ['buy_3', 'locked3'] as const) {
    assert(JSON.stringify(NPC_LINES[npc][key]) === JSON.stringify([got[`${npc}.${key}`]]), `${npc}.${key}: ${NPC_LINES[npc][key]} vs ${got[`${npc}.${key}`]}`);
    assert(!CAT_MARKED[npc][key], `${npc}.${key} has no mark`);
  }
  for (const npc of NPCS.slice(0, 3)) for (const hero of [undefined, 'toad' as const]) {
    const line = pickLine(npc, { others: NPCS, bought: 3, ...hero ? { hero } : {} }, { [`${npc}:first`]: 99 });
    assert(line.key === 'buy_3' && line.text === NPC_LINES[npc].buy_3![0], `${npc} ${hero}: ${line.key}`);
  }
});

check('task 51в: lines of Шиш are the design table words (the Шиш table, `locked3`); the first meeting is `first_won` / `first_lost` by the circle and one count with `first_self`', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('## Шиш')), to = DOC.findIndex((l: string) => l.startsWith('## Евлампий')), want: Record<string, string[]> = {};
  for (const l of DOC.slice(from, to)) { const m = /^\| `([a-z_0-9]+)` \| (.*) \|\s*$/.exec(l); if (m) (want[m[1]] ??= []).push(m[2]); }
  for (const l of DOC) { const m = /^\| Шиш \| `locked3` \| [^|]*\| (.*) \|\s*$/.exec(l); if (m) want.locked3 = [m[1]]; }
  assert(JSON.stringify(Object.keys(want).sort()) === JSON.stringify(Object.keys(NPC_LINES.gambler).filter(k => !RETURN_KEYS.includes(k as ReturnKey)).sort()), `keys ${Object.keys(want)} vs ${Object.keys(NPC_LINES.gambler)}`);
  for (const k of Object.keys(want)) assert(JSON.stringify(want[k]) === JSON.stringify(NPC_LINES.gambler[k as LineKey]), `${k}: the text of the table`);
  const won = pickLine('gambler', { others: NPCS, last: { won: true, casino: 'won' } }, {}), lost = pickLine('gambler', { others: NPCS, last: { won: false, casino: 'lost' } }, {});
  assert(won.key === 'first_won' && won.text === NPC_LINES.gambler.first_won![0] && won.id === 'gambler:first', `won: ${won.key}`);
  assert(lost.key === 'first_lost' && lost.id === 'gambler:first', `lost: ${lost.key}`);
  // Met once (one count): the next camp after any game is the game's line, not a second meeting.
  const met = { 'gambler:first': 1 };
  assert(pickLine('gambler', { others: NPCS, last: { won: false, casino: 'lost' } }, met).key === 'casino_lost', 'a game after the meeting');
  assert(pickLine('gambler', { others: NPCS, last: { won: true, casino: 'won' } }, met).key === 'casino_won', 'a won game');
  // He came by himself: first_self, and no second meeting by the circle after it.
  assert(pickLine('gambler', { others: NPCS, self: true }, {}).key === 'first_self', 'first_self');
  assert(pickLine('gambler', { others: NPCS, last: { won: false, casino: 'lost' } }, { 'gambler:first_self': 1 }).key === 'casino_lost', 'no meeting after first_self');
  // After her run the marked lines are skipped, the variants first.
  const hers = pickLine('gambler', { others: NPCS, hero: 'toad', last: { won: false, casino: 'won' } }, {});
  assert(hers.key === 'first_won' && hers.text === TOAD_LINES_BY_NPC.gambler.first_won![0], 'her meeting line');
});

check('task 51г: lines of Евлампий are the design table words (his table); about_monk of the others; the occasions vow_kept / vow_broken / memory_castellan / memory_cuts; after her run the marked ones are skipped', () => {
  const from = DOC.findIndex((l: string) => l.startsWith('## Евлампий')), to = DOC.findIndex((l: string) => l.startsWith('## Добавки')), want: Record<string, string[]> = {};
  for (const l of DOC.slice(from, to)) { const m = /^\| `([a-z_0-9]+)` \| (.*) \|\s*$/.exec(l); if (m) (want[m[1]] ??= []).push(m[2]); }
  assert(JSON.stringify(Object.keys(want).sort()) === JSON.stringify(Object.keys(NPC_LINES.monk).filter(k => !RETURN_KEYS.includes(k as ReturnKey)).sort()), `keys ${Object.keys(want)} vs ${Object.keys(NPC_LINES.monk)}`);
  for (const k of Object.keys(want)) assert(JSON.stringify(want[k]) === JSON.stringify(NPC_LINES.monk[k as LineKey]), `${k}: the text of the table`);
  const about: Record<string, string> = {};
  for (const l of DOC.slice(0, DOC.findIndex((l: string) => l.startsWith('## Евлампий')) + 0)) { const m = /^\| `about_monk` \| (.*) \|\s*$/.exec(l); if (m) about.gambler = m[1]; }
  for (const l of DOC) { const m = /^\| (Неясыть|Марфа|Ерофей) \| `about_monk` \| (.*) \|\s*$/.exec(l); if (m) about[NAMES[m[1]]!] = m[2]; }
  for (const npc of ['owl', 'herb', 'smith', 'gambler'] as const) assert(JSON.stringify(NPC_LINES[npc].about_monk) === JSON.stringify([about[npc]]), `${npc}.about_monk`);
  const met = { 'monk:first': 2 };
  const say = (last: LineContext['last'], hero?: 'toad', memory: Record<string, number> = met) => pickLine('monk', { others: NPCS, ...hero ? { hero } : {}, last }, memory);
  assert(say({ won: false, vows: 'kept' }).key === 'vow_kept' && say({ won: false, vows: 'broken' }).key === 'vow_broken', 'the vows');
  assert(say({ won: true, castellan: true, cuts: 2 }).key === 'memory_castellan' && say({ won: false, cuts: 1 }).key === 'memory_cuts', 'the memories');
  assert(say({ won: false, cuts: 1 }, 'toad').text === TOAD_LINES_BY_NPC.monk.memory_cuts![0], 'her variant of the memory');
  for (const key of ['vow_kept', 'vow_broken'] as const) for (const t of [0, 1]) {
    const line = say({ won: false, vows: key === 'vow_kept' ? 'kept' : 'broken' }, 'toad', { ...met, [`monk:${key}:toad`]: t });
    assert(line.key === key && !marked('monk', key, line.text), `${key} after her run: ${line.text}`);
  }
  // First meeting: both lines of `first`, then none.
  assert(pickLine('monk', { others: NPCS }, {}).text === NPC_LINES.monk.first![0] && pickLine('monk', { others: NPCS }, { 'monk:first': 1 }).text === NPC_LINES.monk.first![1], 'first');
});

check('task 51д: leave, back_met, back_missed, meet_hello, meet_deal, meet_no (Марфа, Ерофей, Шиш), win_garrison_first (Неясыть, Марфа, Ерофей) and trace_* (Неясыть) are the design table words', () => {
  const want: Record<string, string[]> = {}, wanted = ['win_garrison_first', 'leave', 'back_met', 'back_missed', 'meet_hello', 'meet_deal', 'meet_no', 'trace_herb', 'trace_smith', 'trace_gambler'];
  const from = DOC.findIndex((l: string) => l.startsWith('## Шиш')), mid = DOC.findIndex((l: string) => l.startsWith('## Евлампий'));
  for (const l of DOC.slice(0, DOC.findIndex((l: string) => l.startsWith('### Варианты для Ведуньи')))) {
    const m = /^\| (Неясыть|Марфа|Ерофей) \| `([a-z_]+)` \| (?:[^|]*\| )?(.*?) \|\s*$/.exec(l);
    if (m && wanted.includes(m[2])) (want[`${NAMES[m[1]]}.${m[2]}`] ??= []).push(m[3]);
  }
  for (const l of DOC.slice(from, mid)) { const m = /^\| `(leave|back_met|back_missed|meet_hello|meet_deal|meet_no)` \| (.*) \|\s*$/.exec(l); if (m) (want[`gambler.${m[1]}`] ??= []).push(m[2]); }
  assert(Object.keys(want).length === 4 + 7 + 7 + 6, `${Object.keys(want).length} keys`);
  for (const [k, texts] of Object.entries(want)) { const [npc, key] = k.split('.'); assert(JSON.stringify(NPC_LINES[npc as NpcId][key as LineKey]) === JSON.stringify(texts), `${k}: the text of the table`); }
});

check('task 51: the garrison passed — win_garrison_first for the three of v1 once by hero, then the ordinary occasion; memory_castellan of Евлампий at every such run', () => {
  const won = { won: true, garrisonWon: true } as const;
  for (const npc of ['owl', 'herb', 'smith'] as const) {
    const memory = { [`${npc}:first`]: 9, [`${npc}:first_self`]: 9 };
    const first = pickLine(npc, { others: NPCS, last: won }, memory);
    assert(first.key === 'win_garrison_first' && first.text === NPC_LINES[npc].win_garrison_first![0], `${npc}: first`);
    const next = pickLine(npc, { others: NPCS, last: won }, { ...memory, [`${npc}:win_garrison_first`]: 1 });
    assert(next.key !== 'win_garrison_first', `${npc}: then ${next.key}`);
    // Her first is her own count: after the cat's, her variant still comes.
    const hers = pickLine(npc, { others: NPCS, hero: 'toad', last: won }, { ...memory, [`${npc}:win_garrison_first`]: 1 });
    assert(hers.key === 'win_garrison_first' && hers.text === TOAD_LINES_BY_NPC[npc].win_garrison_first![0], `${npc}: her first`);
  }
  for (const n of [0, 1, 2]) assert(pickLine('monk', { others: NPCS, last: { won: true, castellan: true, garrisonWon: true } }, { 'monk:first': 2, 'monk:memory_castellan': n }).key === 'memory_castellan', 'memory_castellan every time');
});

check('task 50 §18: habit_first (Неясыть) and knack_first (Ерофей) are the words of the spec; said once a profile after the first run that offered the system, by the cat and by her', () => {
  const spec = readFileSync(new URL('../../../docs/design-notes/task-50-levels-archetype.md', import.meta.url), 'utf8');
  const habit = NPC_LINES.owl.habit_first![0], knack = NPC_LINES.smith.knack_first![0];
  assert(spec.includes(`\`habit_first\`: «${habit}».`) && spec.includes(`\`knack_first\`: «${knack}».`), 'the words of the spec');
  for (const hero of [undefined, 'toad' as const]) {
    const ctx = { others: NPCS, ...hero ? { hero } : {}, last: { won: false, cause: 'crowd' as const, habitOffered: true as const, knackOffered: true as const } };
    const met = { 'owl:first': 9, 'smith:first': 9, 'herb:first': 9 };
    const owl = pickLine('owl', ctx, met), smith = pickLine('smith', ctx, met);
    assert(owl.key === 'habit_first' && owl.text === habit && smith.key === 'knack_first' && smith.text === knack, `${hero}: the first visit says them`);
    // Said once: the memory has the key counted (`npc:key`), the next visit goes back to the run's own occasion.
    assert(pickLine('owl', ctx, { ...met, 'owl:habit_first': 1 }).key === 'death_crowd' && pickLine('smith', ctx, { ...met, 'smith:knack_first': 1 }).key === 'death_crowd', `${hero}: once`);
    // The others never say them, and a run that offered nothing does not either.
    assert(pickLine('herb', ctx, met).key === 'death_crowd' && pickLine('owl', { ...ctx, last: { won: false, cause: 'crowd' } }, met).key === 'death_crowd', `${hero}: only the two, only when offered`);
  }
});
