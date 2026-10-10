/**
 * Makes the playtest log fixtures of the real-time report (docs/realtime-telemetry.md, section 8, «ТB»):
 *
 *   npx tsx scripts/realtime-make-log-fixtures.ts
 *
 * Writes `tests/fixtures/realtime-logs/` as the dev-server plugin lays out its files (`<session>/<run>/run.json`,
 * `<fight>-fight.json`, `<fight>-j<i>of<n>.json`, `<fight>-n<tick>.json`) plus one «Экспорт» file:
 * - a run of three arenas played by a bot through the run's own steps (rtRun.ts): two won (the goals by the debug command,
 *   then the hero walks into the door), the third lost in a ring of enemies (the death of the run record); the gift and
 *   any talisman choice on the way; an N mark in the second fight; the run record also comes once more, older, in the
 *   export (a duplicate the report drops);
 * - the sandbox (`run: 'sandbox'`, in the export file): a fight on «Лучники» with the bot, a fight whose `endHash` is spoiled
 *   (the report must show it), and a fight cut short by an unloaded page (`outcome: 'unload'`).
 * The bot is the fixture's own: chains of nearby enemies of one colour, a cancel now and then, walks, jumps. Its random
 * stream is a seeded LCG: the fixtures come out the same every time (gzip of this Node included).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultParams, type Params } from '../src/realtime/sim/params';
import { Simulation, type Journal } from '../src/realtime/sim/simulation';
import type { Command } from '../src/realtime/sim/commands';
import type { World } from '../src/realtime/sim/world';
import {
  createRtRun, resolveArena, rtArenaLoadout, rtAvailableNodes, rtChooseEventOption, rtChooseFind, rtChooseGift, rtChooseGiftPick, rtChooseHammer,
  rtChooseTalisman, rtEnterNode, rtEventView, rtGiftView, rtNode, rtRestHeal, rtRunParams, rtShopLeave, type RtRunState, type RtRunStep,
} from '../src/realtime/run/rtRun';
import { createFightObserver } from '../src/realtime/telemetry/observe';
import {
  fightKey, fightRecordId, journalPartId, makeExport, noteRecordId, packJournal, paramsHash, runKey, runRecordId, sessionKey, RT_TELEMETRY_SCHEMA, SANDBOX_RUN,
  type FightOutcome, type FightRecord, type FightSummary, type JournalPart, type NoteRecord, type RtHeader, type RtRecord, type RunChoice, type RunNodeVisit, type RunRecord,
} from '../src/realtime/telemetry/schema';

const OUT = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'realtime-logs');
const BUILD = 'fixture';
const STORAGE = 'ashen-oath-realtime-params-v17';
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);
const SESSION = sessionKey(T0, 0x7e57);
const RUN_SEED = 0x5eed01;
const RUN = runKey(T0, RUN_SEED);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function ok(step: RtRunStep, what: string): RtRunState {
  if (!step.ok) throw new Error(`${what}: ${step.reason}`);
  return step.run;
}
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const header = (id: string, kind: RtHeader['kind'], run: string, params: Params, minutes: number): RtHeader =>
  ({ schema: RT_TELEMETRY_SCHEMA, id, kind, build: BUILD, params: { storage: STORAGE, hash: paramsHash(params) }, session: SESSION, run, at: at(minutes) });

// ---- The bot ----

type Finish = 'door' | 'defeat' | 'unload';

interface Played { sim: Simulation; summary: FightSummary; note: { tick: number; x: number; y: number } | null; lastHit: { enemy?: string; elite?: boolean; source: string; tick: number } | null }

/**
 * Plays an arena: `seconds` of chains and walking, then — `door`: the goals by the debug command and a walk into the door;
 * `defeat`: a ring of enemies round the standing hero; `unload`: the page closes (the fight stays open). `noteAt` — the
 * tick of an N mark.
 */
function play(sim: Simulation, seed: number, seconds: number, finish: Finish, noteAt?: number): Played {
  const w = sim.world, observer = createFightObserver(w), rnd = lcg(seed);
  const cmd = (c: Command): unknown => { const r = sim.command(c); observer.command(c, w); return r; };
  let note: Played['note'] = null, lastHit: Played['lastHit'] = null, held = 0, rest = 30;
  const tick = (): void => {
    const kinds = new Map(w.enemies.map(e => [e.id, e]));
    sim.tick();
    observer.tick(w);
    for (const ev of w.events) if (ev.type === 'hit') { const e = kinds.get(ev.enemyId); lastHit = { ...e ? { enemy: e.kind, ...e.elite ? { elite: true } : {} } : {}, source: ev.source, tick: w.tick }; }
    w.events.length = 0;
  };
  for (let t = 0; t < seconds * 60 && w.status === 'playing'; t++) {
    if (t === noteAt) note = { tick: w.tick, x: w.hero.x, y: w.hero.y };
    if (t % 45 === 0) { const d = [-1, 0, 1]; cmd({ t: 'walk', x: d[Math.floor(rnd() * 3)], y: d[Math.floor(rnd() * 3)] }); }
    if (held > 0) {
      if (--held === 0) cmd(rnd() < 0.12 ? { t: 'cancel' } : { t: 'release' });
    } else if (!w.move && --rest <= 0) {
      const near = [...w.enemies].filter(e => e.color >= 0).sort((a, b) => Math.hypot(a.x - w.hero.x, a.y - w.hero.y) - Math.hypot(b.x - w.hero.x, b.y - w.hero.y));
      if (rnd() < 0.08 && w.energy >= 2 && near[0]) cmd({ t: 'jump', x: w.hero.x + (rnd() - 0.5) * 4, y: w.hero.y + (rnd() - 0.5) * 4 });
      else if (near[0] && cmd({ t: 'begin', x: near[0].x, y: near[0].y })) {
        let last = near[0];
        for (let k = 0; k < 4; k++) {
          const next = near.find(e => e !== last && e.color === near[0].color && !w.chain.some(l => l.id === e.id) && Math.hypot(e.x - last.x, e.y - last.y) < 2.2);
          if (!next) break;
          cmd({ t: 'sweep', fx: last.x + 0.013, fy: last.y - 0.007, x: next.x + (rnd() - 0.5) * 0.05, y: next.y + (rnd() - 0.5) * 0.05 });
          last = next;
        }
        held = 12 + Math.floor(rnd() * 24);
      }
      rest = 20 + Math.floor(rnd() * 30);
    }
    tick();
  }
  if (finish === 'door' && w.status === 'playing') {
    cmd({ t: 'cancel' });
    for (let i = 0; i < 120 && w.move; i++) tick();
    cmd({ t: 'goals' });
    const door = w.objects.find(o => o.kind === 'door')!, dx = w.arena.width / 2 - door.x, dy = w.arena.height / 2 - door.y, len = Math.hypot(dx, dy);
    cmd({ t: 'teleport', x: door.x + dx / len * 1.4, y: door.y + dy / len * 1.4 });
    cmd({ t: 'walk', x: -dx / len, y: -dy / len });
    for (let i = 0; i < 600 && w.status === 'playing'; i++) tick();
  }
  if (finish === 'defeat' && w.status === 'playing') {
    cmd({ t: 'walk', x: 0, y: 0 });
    for (let k = 0; k < 8; k++) cmd({ t: 'place', x: w.hero.x + Math.cos(k * Math.PI / 4) * 0.6, y: w.hero.y + Math.sin(k * Math.PI / 4) * 0.6, color: k % 4, hp: 2, kind: 'basic' });
    for (let i = 0; i < 60 * 120 && w.status === 'playing'; i++) tick();
  }
  return { sim, summary: observer.summary(), note, lastHit };
}

// ---- Records of a fight ----

async function fightRecords(played: Played, o: { run: string; fight: string; arena: string; roster?: string; nodeId?: string; row?: number; seed: number; hpIn: number; params: Params; minutes: number; outcome?: FightOutcome; spoil?: boolean; paramsRef?: string }): Promise<RtRecord[]> {
  const { sim } = played, w: World = sim.world, journal: Journal = sim.exportJournal()!;
  const packed = await packJournal(journal, o.paramsRef ? { paramsRef: o.paramsRef } : {});
  const outcome: FightOutcome = o.outcome ?? (w.status === 'victory' ? 'victory' : w.status === 'defeat' ? 'defeat' : 'unload');
  const fight: FightRecord = {
    ...header(fightRecordId(SESSION, o.run, o.fight), 'fight', o.run, o.params, o.minutes) as RtHeader & { kind: 'fight' }, kind: 'fight',
    fight: o.fight, ...o.nodeId ? { nodeId: o.nodeId } : {}, arena: o.arena, ...o.roster !== undefined ? { roster: o.roster } : {}, ...o.row !== undefined ? { row: o.row } : {},
    seed: o.seed, outcome, ticks: w.tick, time: w.endTime ?? w.time, hpIn: o.hpIn, hpOut: w.hero.hp,
    endHash: o.spoil ? '0123456789abcdef' : sim.hash(), journal: packed.meta, view: { w: 18.4, h: 10.3 }, summary: played.summary,
  };
  const parts: JournalPart[] = packed.parts.map((data, i) => ({
    ...header(journalPartId(SESSION, o.run, o.fight, i, packed.parts.length), 'journal', o.run, o.params, o.minutes) as RtHeader & { kind: 'journal' }, kind: 'journal',
    fight: o.fight, index: i, count: packed.parts.length, digest: packed.meta.digest, encoding: packed.meta.encoding, data,
  }));
  const notes: NoteRecord[] = played.note ? [{
    ...header(noteRecordId(SESSION, o.run, o.fight, played.note.tick), 'note', o.run, o.params, o.minutes) as RtHeader & { kind: 'note' }, kind: 'note',
    fight: o.fight, tick: played.note.tick, arena: o.arena, hero: { x: played.note.x, y: played.note.y },
  }] : [];
  return [fight, ...parts, ...notes];
}

// ---- The run ----

async function makeRun(): Promise<{ records: RtRecord[]; older: RunRecord }> {
  const params = rtRunParams(defaultParams());
  let run = createRtRun(RUN_SEED, { gift: 'mini' });
  const records: RtRecord[] = [], nodes: RunNodeVisit[] = [], choices: RunChoice[] = [], fights: string[] = [];
  let older: RunRecord | null = null, minutes = 1, death: RunRecord['death'] = null;
  // The gift: the first button that is on (and the first of its own choice).
  const gift = rtGiftView(run)!, on = gift.options.filter(e => e.available), first = on[0];
  run = ok(rtChooseGift(run, first ? first.index : null), 'gift');
  const open = rtGiftView(run);
  if (open && open.chosen !== null) run = ok(rtChooseGiftPick(run, open.picks[0]), 'gift pick');
  choices.push({ nodeId: 'start', source: 'gift', offered: gift.options.map(e => e.option.kind), taken: first ? [first.option.kind, ...open?.picks.length ? [open.picks[0]] : []] : [], refused: gift.options.filter(e => e !== first).map(e => e.option.kind) });
  const record = (outcome: RunRecord['outcome'], at: number): RunRecord => ({
    ...header(runRecordId(SESSION, RUN), 'run', RUN, params, at) as RtHeader & { kind: 'run' }, kind: 'run',
    seed: RUN_SEED, outcome, farRow: Math.max(0, ...nodes.map(n => n.row)), death, nodes: structuredClone(nodes), choices: structuredClone(choices),
    kit: { hp: run.hp, maxHp: run.maxHp, energy: run.energy, talismans: [...run.talismans], hammer: run.hammer ?? null, items: { ...run.items }, resources: { ...run.materials } },
    fights: [...fights], runParams: params,
  });
  for (let step = 0; step < 40 && !run.result && fights.length < 3; step++) {
    const pending = run.pending;
    if (!pending) {
      const avail = rtAvailableNodes(run), node = avail.find(n => ['battle', 'hard', 'checkpoint'].includes(n.type)) ?? avail[0];
      run = ok(rtEnterNode(run, node.id), `enter ${node.id}`);
      continue;
    }
    if (pending.kind === 'battle') {
      const node = rtNode(run, pending.nodeId)!, index = fights.length + 1, key = fightKey(index, node.id, 1), hpIn = run.hp;
      const sim = new Simulation({ arena: pending.arena, params, seed: pending.seed, record: true, hero: { hp: run.hp, maxHp: run.maxHp }, loadout: rtArenaLoadout(run), ...pending.roster !== undefined ? { roster: pending.roster } : {} });
      const finish: Finish = index === 3 ? 'defeat' : 'door';
      const played = play(sim, 1000 + index, index === 3 ? 12 : 8, finish, index === 2 ? 300 : undefined), w = sim.world;
      fights.push(key);
      nodes.push({ nodeId: node.id, row: node.row, type: node.type, hpIn, hpOut: w.hero.hp, maxHp: run.maxHp, arena: pending.arena, ...pending.roster !== undefined ? { roster: pending.roster } : {}, fight: key });
      records.push(...await fightRecords(played, { run: RUN, fight: key, arena: pending.arena, roster: pending.roster, nodeId: node.id, row: node.row, seed: pending.seed, hpIn, params, minutes: minutes++, paramsRef: paramsHash(params) }));
      if (w.status === 'defeat' && played.lastHit) death = { ...played.lastHit, fight: key };
      run = ok(resolveArena(run, { nodeId: pending.nodeId, won: w.status === 'victory', hp: w.hero.hp, kills: w.stats.kills, damage: w.stats.damageTaken, time: w.endTime ?? w.time, ...w.kit ? { items: { ...w.kit.items }, materials: { ...w.kit.materials }, wardUsed: w.kit.wardUsed } : {} }), 'resolve');
      if (index === 1) older = record('open', minutes - 0.5);
      continue;
    }
    if (pending.kind === 'hammer') { choices.push({ nodeId: pending.nodeId, source: 'hammer', offered: [...pending.options], taken: [pending.options[0]], refused: pending.options.slice(1) }); run = ok(rtChooseHammer(run, pending.options[0]), 'hammer'); continue; }
    if (pending.kind === 'talisman') {
      const pick = pending.options[0] ?? null;
      choices.push({ nodeId: pending.nodeId, source: pending.source === 'oath' ? 'oath' : 'talisman', offered: [...pending.options], taken: pick ? [pick] : [], refused: pending.options.filter(o => o !== pick) });
      run = ok(rtChooseTalisman(run, pick), 'talisman');
      continue;
    }
    if (pending.kind === 'rest') { choices.push({ nodeId: pending.nodeId, source: 'rest', offered: ['heal'], taken: ['heal'], refused: [] }); run = ok(rtRestHeal(run), 'rest'); continue; }
    if (pending.kind === 'find') { choices.push({ nodeId: pending.nodeId, source: 'find', offered: [...pending.options], taken: [pending.options[0]], refused: pending.options.slice(1) }); run = ok(rtChooseFind(run, pending.options[0]), 'find'); continue; }
    if (pending.kind === 'shop') { choices.push({ nodeId: pending.nodeId, source: 'shop', offered: [...pending.stock.items], taken: [], refused: [...pending.stock.items] }); run = ok(rtShopLeave(run), 'shop'); continue; }
    if (pending.kind === 'event') {
      const view = rtEventView(run)!, option = view.options.find(e => e.available)!;
      choices.push({ nodeId: pending.nodeId, source: 'event', offered: view.options.map(e => e.id), taken: [option.id], refused: view.options.filter(e => e !== option).map(e => e.id) });
      run = ok(rtChooseEventOption(run, option.id), 'event');
      continue;
    }
    throw new Error(`unexpected pending ${pending.kind}`);
  }
  if (!older) throw new Error('no first fight');
  records.unshift(record(run.result?.outcome === 'defeat' ? 'defeat' : 'open', minutes + 1));
  return { records, older };
}

// ---- The sandbox ----

async function makeSandbox(): Promise<RtRecord[]> {
  // The sandbox panel: more HP, so the bot plays the whole time.
  const params = defaultParams(), out: RtRecord[] = [];
  params.heroHp = 60;
  const cases: { arena: string; seed: number; finish: Finish; spoil?: boolean; seconds: number }[] = [
    { arena: 'archers', seed: 11, finish: 'door', seconds: 25 },
    { arena: 'kills', seed: 12, finish: 'door', seconds: 15, spoil: true },
    { arena: 'powder', seed: 13, finish: 'unload', seconds: 12 },
  ];
  for (const [i, c] of cases.entries()) {
    const sim = new Simulation({ arena: c.arena, params, seed: c.seed, record: true });
    const played = play(sim, 2000 + i, c.seconds, c.finish);
    out.push(...await fightRecords(played, { run: SANDBOX_RUN, fight: fightKey(i + 1, null, 1), arena: c.arena, seed: c.seed, hpIn: params.heroHp, params, minutes: 30 + i, spoil: c.spoil }));
  }
  return out;
}

/** The plugin's file name of a record: the segments after the run, joined by «-» (vite/rtTelemetryPlugin.ts). */
const fileOf = (id: string): string => { const [s, r, ...rest] = id.split('/'); return join(s, r, `${rest.join('-')}.json`); };

async function main(): Promise<void> {
  const { records, older } = await makeRun();
  const sandbox = await makeSandbox();
  rmSync(OUT, { recursive: true, force: true });
  for (const r of records) {
    const path = join(OUT, fileOf(r.id));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(r));
  }
  // The export of the browser buffer: the sandbox, and an older copy of the run record (a duplicate by id).
  writeFileSync(join(OUT, 'export-sandbox.json'), JSON.stringify(makeExport(SESSION, [older, ...sandbox], at(40)), null, 0));
  const fights = [...records, ...sandbox].filter(r => r.kind === 'fight') as FightRecord[];
  for (const f of fights) console.log(`${f.run}/${f.fight}: ${f.arena}, ${f.outcome}, ${f.ticks} ticks, HP ${f.hpIn} → ${f.hpOut}, chains ${f.summary.chain.count}, journal ${f.journal.chars} chars`);
  console.log(`fixtures: ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
