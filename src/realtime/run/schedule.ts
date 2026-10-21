/**
 * Task 26 «Расписание леса» (design 15.10.2026, variant E of docs/design-notes/research_notes/Комплексити как ручка баланса/
 * proposal_sim.md, section 1; docs/realtime-slice.md, «Расписание леса»): the arena of a run fight by what the VIEWER has met
 * (the history snapshot the run took when created, plus what this run met) and the fight's number in the run — not by the run
 * row. A fight brings at most one new living element (ЖЭ) — its arc — next to a known one; with no arc ready it is a practice
 * fight of known elements. Pure data and rules: the run (rtRun.ts) asks, the view never decides.
 *
 * The roll is the node's own (the arena seed and the salt «rt-schedule», as `ROSTER_SALT`): the run's `pool` stream is spent
 * as before but not read, so the stream counters and the forest's outputs stay those of a run without the schedule.
 */
import { mixSeed } from '../forest/items';
import { arenaTemplate, markedGoalArena } from '../sim/arenas';
import { AFFIX_IDS, affixAllowed } from '../sim/elites';
import { FIXED_ROSTER_ARENAS, KIND_ROLE, POOL_ROSTERS } from '../sim/rosters';
import { arenaKinds } from './arenaKinds';
import { JAILER_ARENA, JAILER_YARD_ARENA } from '../sim/arenasBoss';
import { JAILER_WEIGHT } from '../sim/enemies/jailer';
import { TROLL_CLUB, TROLL_ROCK, TROLL_TAIL } from '../sim/enemies/troll';
import { TROLL_ARENA } from '../sim/arenasBoss';

/** Task 48: the Troll's parts (a boss with parts: the arc «part»). */
const TROLL_PARTS: readonly string[] = [TROLL_CLUB, TROLL_ROCK, TROLL_TAIL];
import { FINAL_ARENA, HARD_ARENA } from './arenaPools';

/** The special kinds (ЖЭ each); the basic enemy is not one. */
export const SCHEDULE_KINDS: readonly string[] = ['wolf', 'boar', 'lynx', 'shield', 'archer', 'sapper', 'porcupine', 'shaman'];
/**
 * The ids of the living elements (proposal: 20; task 28 adds the 21st): the special kinds, `elite`, `affix` (any affix type met)
 * with the types `affix:<id>`, `brazier`, `cliff`, `water` (a river, a big pond), `thorns`, `chest`, `buttons`, `leader` (атаман),
 * `horde`, `bust` (the goblin's bust), `bag` (котомка; outside the budget, variant E), `part` (a part of a boss — the Jailer's
 * weight, task 28).
 */
export const SCHEDULE_ELEMENTS: readonly string[] = [...SCHEDULE_KINDS, 'elite', 'affix', 'brazier', 'cliff', 'water', 'thorns', 'chest', 'buttons', 'leader', 'horde', 'bust', 'bag', 'part'];
/**
 * Task 57а «Лес: стрелки» (level design 20.10.2026, docs/design-notes/task-57-forest-enemies.md, 10.2): the new shooters — special
 * kinds (ЖЭ) of a run with the flag `forestShooters` only (`scheduleKinds`); a run without it plays the schedule byte for byte. The
 * history accepts their ids always (`isScheduleElement`: a profile's history from a run with the flag).
 */
export const SCHEDULE_SHOOTER_KINDS: readonly string[] = ['slinger', 'hive', 'wisp'];
/** The special kinds of a run (`shooters` — the flag `forestShooters`). */
export const scheduleKinds = (shooters = false): readonly string[] => (shooters ? [...SCHEDULE_KINDS, ...SCHEDULE_SHOOTER_KINDS] : SCHEDULE_KINDS);
export const affixElement = (id: string): string => `affix:${id}`;
/** A valid id of the history (an element, a new shooter of task 57а, or an affix type). */
export const isScheduleElement = (id: unknown): id is string =>
  typeof id === 'string' && (SCHEDULE_ELEMENTS.includes(id) || SCHEDULE_SHOOTER_KINDS.includes(id) || (id.startsWith('affix:') && (AFFIX_IDS as readonly string[]).includes(id.slice(6))));

/** The salt of the node's roll (a constant: changing it changes every scheduled run). */
export const SCHEDULE_SALT = [...'rt-schedule'].reduce((hash, ch) => Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

/** An arc: its new element, what must be met first, the first run row and fight number it may come on. */
interface Arc {
  id: string; needs?: readonly string[]; minRow?: number; minFight?: number;
  /**
   * Task 57а (design 21.10.2026, the bot's probe: the late rows, not the wisp, made the lesson deadly): the last run row of the first
   * meeting — an arc not played by then waits for the next run (the schedule takes the next ready arc). Only the new kinds' arcs.
   */
  maxRow?: number;
}
/**
 * The order of the arcs, variant E (proposal, table «Расписание», steps 3–19; the bust is fight 1, the bag takes no step, the
 * chest is the hard node's). Each fight takes the FIRST arc in this order that is ready (not met, its needs met, its row and
 * fight reached): the elite waits for fight 3 and row 4, the braziers come before it when it is not ready.
 */
export const SCHEDULE_ARCS: readonly Arc[] = [
  { id: 'wolf' }, { id: 'elite', minRow: 4, minFight: 3 }, { id: 'brazier' }, { id: 'cliff' }, { id: 'boar' }, { id: 'water' },
  { id: 'shield', needs: ['brazier'] }, { id: 'buttons' }, { id: 'archer' }, { id: 'sapper', needs: ['cliff'] }, { id: 'leader', needs: ['archer'] },
  { id: 'lynx' }, { id: 'affix', needs: ['elite'], minRow: 6 },
  { id: 'thorns' }, { id: 'porcupine', needs: ['thorns', 'buttons'] }, { id: 'shaman', needs: ['brazier', 'leader'] }, { id: 'horde' },
];
/**
 * Task 57а (level design 20.10.2026, spec 10.2): the arcs of the new shooters, after every arc above (a viewer's first run barely
 * changes; the new comes in the second to fourth). The slinger after the archer from run row 3, the hive after the slinger from
 * row 4, the wisp after the water from row 3; design 21.10.2026 — the first meeting no later than its first row + 2 (`maxRow`: 5, 6,
 * 5), else the next run. Only a run with the flag (`scheduleArcs`).
 */
export const SCHEDULE_SHOOTER_ARCS: readonly Arc[] = [
  { id: 'slinger', needs: ['archer'], minRow: 3, maxRow: 5 }, { id: 'hive', needs: ['slinger'], minRow: 4, maxRow: 6 }, { id: 'wisp', needs: ['water'], minRow: 3, maxRow: 5 },
];
/** The arcs of a run (`shooters` — the flag `forestShooters`). */
export const scheduleArcs = (shooters = false): readonly Arc[] => (shooters ? [...SCHEDULE_ARCS, ...SCHEDULE_SHOOTER_ARCS] : SCHEDULE_ARCS);
/** The first arc: the first fight of the run on run row 1 — «Поляна» with only basic enemies (the goblin's bust, its lesson in the prologue's room 8). */
export const BUST_ARC = 'bust';
/** The hard node's own arc: «Застава» (its chest). */
export const CHEST_ARC = 'chest';
/** Task 28: the Jailer's node's own arc — the part of a boss (the weight a chain severs). */
export const PART_ARC = 'part';
/** The arcs taught on a known fight with the elite rules (no arena of their own). */
const ELITE_ARCS: readonly string[] = ['elite', 'affix'];

/**
 * The teaching arena of an arc (its own element with known ones): `roster` — fixed; `partner` — a role of a known kind is added
 * (`partnerRoster`).
 */
export const SCHEDULE_TEACH: Readonly<Record<string, { arena: string; roster?: string; partner: boolean }>> = {
  wolf: { arena: 'glade', roster: 'wolves', partner: false }, boar: { arena: 'glade', roster: 'onslaught', partner: false },
  brazier: { arena: 'p-braziers', partner: true }, cliff: { arena: 'p-cliff', partner: true }, shield: { arena: 'shields', partner: true },
  buttons: { arena: 'buttons', partner: true }, archer: { arena: 'p-archer-yard', partner: true }, sapper: { arena: 'powder', partner: true },
  leader: { arena: 'archers', partner: false }, water: { arena: 'p-river', partner: true }, lynx: { arena: 'lynx-den', partner: true },
  thorns: { arena: 'p-thicket', partner: true }, porcupine: { arena: 'thorns', partner: false }, shaman: { arena: 'shaman-circle', partner: false },
  horde: { arena: 'marked', partner: true },
  // Task 57а (level design 20.10.2026): the new shooters' own arenas («Осыпь», «Пасека»; the hive alone — no partner on its first
  // meeting) and the wisp's roster on «Излучина» (wisps over the water).
  slinger: { arena: 'f-scree', partner: true }, hive: { arena: 'f-apiary', partner: false }, wisp: { arena: 'p-river', roster: 'wisps', partner: false },
};
/**
 * The practice arenas: a fight of known elements only — an arena is open when all its `own` elements are met (its other kinds
 * are taken out by `withoutKinds`), `minRow` — from that run row (proposal, «Бои без дуги»).
 */
export const SCHEDULE_PRACTICE: readonly { arena: string; own: readonly string[]; minRow?: number }[] = [
  { arena: 'glade', own: [] }, { arena: 'p-yard', own: [] }, { arena: 'p-gorge', own: [] },
  { arena: 'p-braziers', own: ['brazier'] }, { arena: 'p-cliff', own: ['cliff'] }, { arena: 'shields', own: ['shield', 'brazier'] },
  { arena: 'buttons', own: ['buttons'] }, { arena: 'p-archer-yard', own: ['archer'] }, { arena: 'powder', own: ['sapper', 'cliff'] },
  { arena: 'archers', own: ['archer', 'leader'] }, { arena: 'p-river', own: ['water'] }, { arena: 'lynx-den', own: ['lynx'] },
  { arena: 'p-thicket', own: ['thorns'] }, { arena: 'thorns', own: ['porcupine', 'thorns', 'buttons'], minRow: 6 },
  { arena: 'shaman-circle', own: ['shaman', 'leader', 'brazier'], minRow: 6 }, { arena: 'marked', own: ['horde'], minRow: 6 },
  { arena: 'ford', own: ['archer', 'wolf', 'leader', 'water'], minRow: 6 },
];
/** Task 57а: the practice arenas of the new shooters — a run with the flag only (`schedulePractice`). */
export const SCHEDULE_SHOOTER_PRACTICE: readonly { arena: string; own: readonly string[]; minRow?: number }[] = [
  { arena: 'f-scree', own: ['slinger'] }, { arena: 'f-apiary', own: ['hive', 'slinger'], minRow: 5 },
];
/** The practice arenas of a run (`shooters` — the flag `forestShooters`). */
const schedulePractice = (shooters = false) => (shooters ? [...SCHEDULE_PRACTICE, ...SCHEDULE_SHOOTER_PRACTICE] : SCHEDULE_PRACTICE);
/** Every arena the schedule may put in a fight (the run's saves name only these and the pools' ones). */
export const SCHEDULE_RUN_ARENAS: readonly string[] = [...new Set([...SCHEDULE_PRACTICE.map(p => p.arena), ...SCHEDULE_SHOOTER_PRACTICE.map(p => p.arena), ...Object.values(SCHEDULE_TEACH).map(t => t.arena), HARD_ARENA, FINAL_ARENA])];
/** The window of repeats of the practice fights: not one of the last 2 arenas, while another fits. */
export const SCHEDULE_REPEAT_WINDOW = 2;
/** В-1: special kinds on a fight at most — run rows 1–5: 2, rows 6–9: 3 (the partner role is added only below it). */
export const scheduleKindCap = (row: number): number => (row <= 5 ? 2 : 3);
/** The hard node: more bodies, one number (design 15.10.2026: bodies are no dial — 1,25 for «Застава» and its stand-in alike). */
export const SCHEDULE_HARD_FLOOR = 1.25;
/** Design answer 5 (15.10.2026): rows 6–8 of a scheduled run — elite plates +1 and tough HP +1 over the gentle tables (4 and 4). */
export const SCHEDULE_NUMBERS_ROWS: readonly [number, number] = [6, 8];

/** The node types whose fight takes an arc: an ordinary battle, an event's reward battle, the breakthrough, the Jailer's. */
export type ScheduleNode = 'battle' | 'event' | 'breakthrough' | 'checkpoint' | 'hard' | 'boss';
/** The plan of a fight: its arena, roster (absent — the template's own) and arc (null — a practice fight). */
export interface SchedulePlan { arena: string; roster?: string; arc: string | null }
export interface ScheduleContext {
  /** The arena seed of the node (rtRun.ts `arenaSeed`). */
  seed: number;
  node: ScheduleNode;
  row: number;
  /** 1-based: the arena fights of this run so far, this one included. */
  fight: number;
  /** The elements met: the history snapshot and this run's fights before this one. */
  met: ReadonlySet<string>;
  /** The arenas of the run's fights so far, in order. */
  recent: readonly string[];
  /** Task 28: the run plays the Jailer's fight on its Jailer node (`RtRunState.jailer`); absent — the pools' fight there, as before. */
  jailer?: boolean;
  /** Task 48: the node is the den branch's boss of a run with `troll` — the Troll's fight (arc null); absent — «Последний рубеж». */
  troll?: boolean;
  /** Task 57а: the run has the flag `forestShooters` — the new shooters' kinds, arcs and practice; absent — the schedule as before. */
  shooters?: boolean;
  /**
   * Task 57а (design 21.10.2026): the run has the key `arcsAlternate` — when an arc of task 26 and an arc of the new shooters are both
   * ready, the fights with arcs alternate (the old first: an old arc, a new one, an old one…; `readyArc`). Absent — the first ready arc of
   * the list, as before.
   */
  alternate?: boolean;
  /** Task 57а: the arcs of the run's fights before this one, in order (`alternate` reads the last). */
  arcs?: readonly string[];
}

/** The elite arcs need a guaranteed elite: not on the Jailer's node (it has none). Task 28 gives the Jailer's node its own arc (`jailerPlan`). */
const takesEliteArc = (node: ScheduleNode): boolean => node === 'battle' || node === 'event' || node === 'breakthrough' || node === 'hard';
/** The first arc ready for this fight (null — none: a practice fight). The Jailer's fight of task 28 has its own (`jailerPlan`). */
export function readyArc(ctx: Pick<ScheduleContext, 'node' | 'row' | 'fight' | 'met' | 'shooters' | 'alternate' | 'arcs'>): string | null {
  const ready = (a: Arc): boolean => !ctx.met.has(a.id) && (a.needs ?? []).every(n => ctx.met.has(n)) && ctx.row >= (a.minRow ?? 0) && ctx.row <= (a.maxRow ?? Infinity) && ctx.fight >= (a.minFight ?? 0)
    && (!ELITE_ARCS.includes(a.id) || takesEliteArc(ctx.node));
  // Task 57а (review 21.10.2026): the alternation only among the arcs the node teaches — a hard node teaches only the elite's arc
  // (`schedulePlan`: «Застава» or practice), so there the first ready arc of the list as before (the turn does not move).
  if (!ctx.alternate || !ctx.shooters || ctx.node === 'hard') return scheduleArcs(ctx.shooters).find(ready)?.id ?? null;
  // Task 57а (design 21.10.2026): both ready — the new shooters' arc when the run's last arc fight was an old one, else the old one
  // (the bust counts as old: it is the first fight's).
  const old = SCHEDULE_ARCS.find(ready), fresh = SCHEDULE_SHOOTER_ARCS.find(ready);
  if (!old || !fresh) return (old ?? fresh)?.id ?? null;
  const last = [...ctx.arcs ?? []].reverse().find(id => id === BUST_ARC || SCHEDULE_ARCS.some(a => a.id === id) || SCHEDULE_SHOOTER_ARCS.some(a => a.id === id));
  return last !== undefined && !SCHEDULE_SHOOTER_ARCS.some(a => a.id === last) ? fresh.id : old.id;
}

/** The plan of a fight (see the module's comment). */
export function schedulePlan(ctx: ScheduleContext): SchedulePlan {
  const roll = mixSeed(ctx.seed, SCHEDULE_SALT);
  if (ctx.node === 'boss') return { arena: ctx.troll ? TROLL_ARENA.id : FINAL_ARENA, arc: null };
  if (ctx.node === 'checkpoint' && ctx.jailer) return jailerPlan(ctx.met);
  if (ctx.node === 'hard') {
    // «Застава» once the cliff and the elite are met (its chest is the arc); else a practice stand-in — or the elite's arc.
    if (ctx.met.has('cliff') && ctx.met.has('elite')) return { arena: HARD_ARENA, arc: ctx.met.has(CHEST_ARC) ? null : CHEST_ARC };
    const arc = readyArc(ctx);
    return practice(ctx, roll, arc === 'elite' ? arc : null);
  }
  if (ctx.fight === 1 && ctx.row === 1 && !ctx.met.has(BUST_ARC)) return { arena: 'glade', arc: BUST_ARC };
  const arc = readyArc(ctx);
  const teach = arc ? SCHEDULE_TEACH[arc] : undefined;
  if (arc && teach) {
    const roster = teach.roster ?? (teach.partner && !FIXED_ROSTER_ARENAS.includes(teach.arena) ? partnerRoster(teach.arena, ctx.met, ctx.row, roll, arc, ctx.shooters) : undefined);
    return { arena: teach.arena, ...roster !== undefined ? { roster } : {}, arc };
  }
  return practice(ctx, roll, arc);
}

/**
 * Task 28 «Тюремщик в походе»: the Jailer's fight of a scheduled run — its arc is the part (`PART_ARC`) until the part is met, and no
 * other new element: the ravine stays out until the cliff is met (`JAILER_YARD_ARENA`); the run takes the core's shield away
 * until the shieldbearer is met (`jailerWithout`).
 */
export function jailerPlan(met: ReadonlySet<string>): SchedulePlan {
  return { arena: met.has('cliff') ? JAILER_ARENA.id : JAILER_YARD_ARENA.id, arc: met.has(PART_ARC) ? null : PART_ARC };
}
/** Task 28: what the run takes out of the Jailer's fight for a viewer (`Loadout.withoutKinds`): the shieldbearer not met — the core's shield. */
export const jailerWithout = (met: ReadonlySet<string>): string[] => (met.has('shield') ? [] : ['shield']);

/** A practice fight (`arc` — an elite arc taught on it, or null): an open arena, not one of the last two while another fits. */
function practice(ctx: ScheduleContext, roll: number, arc: string | null): SchedulePlan {
  const fit = schedulePractice(ctx.shooters).filter(p => p.own.every(o => ctx.met.has(o)) && ctx.row >= (p.minRow ?? 0));
  const recent = ctx.recent.slice(-SCHEDULE_REPEAT_WINDOW);
  const fresh = fit.filter(p => !recent.includes(p.arena)), list = fresh.length ? fresh : fit;
  const arena = list[mixSeed(roll, 1) % list.length].arena;
  const roster = FIXED_ROSTER_ARENAS.includes(arena) ? undefined : partnerRoster(arena, ctx.met, ctx.row, mixSeed(roll, 2), arc, ctx.shooters);
  return { arena, ...roster !== undefined ? { roster } : {}, arc };
}

/** Task 57а: a kind's role for the partner rule — its `KIND_ROLE`; the wisp (no role badge) counts as a shooter. */
const partnerRole = (kind: string): string => KIND_ROLE[kind] ?? (kind === 'wisp' ? 'shooter' : kind);

/**
 * A known partner (proposal: «новинка рядом со знакомым»): a met special kind of another role than the kinds that stand on the
 * arena, by the roll — as a pool roster on the pool-roster arenas when one brings just that kind (wolves, onslaught), else its role
 * `+<kind>`. None when the kinds that stand already reach the row's cap (В-1) or no such kind is met. The kinds that stand: those
 * the arena brings (its newcomers, start enemies and the wolf and boar shares of its pace) that are met, or the arc's own (review
 * 15.10.2026: the shares count — «Двор кнопок» with wolves and boars and one more role made three).
 */
export function partnerRoster(arena: string, met: ReadonlySet<string>, row: number, roll: number, arc: string | null = null, shooters = false): string | undefined {
  const kinds = scheduleKinds(shooters), brought = arenaKinds(arena), own = kinds.filter(kind => brought.has(kind) && (met.has(kind) || kind === arc));
  if (own.length >= scheduleKindCap(row)) return undefined;
  const roles = new Set(own.map(partnerRole));
  // Task 57а: the wisp has no role badge but partners as a shooter (no two shooters as partners); the hive comes on its own arena only
  // (its points are the template's).
  const candidates = kinds.filter(kind => met.has(kind) && !own.includes(kind) && !roles.has(partnerRole(kind)) && kind !== 'hive');
  if (!candidates.length) return undefined;
  const kind = candidates[roll % candidates.length];
  if (['buttons', 'marked', 'glade'].includes(arena)) {
    const pool = POOL_ROSTERS.find(def => def.kinds.length === 0 && ((kind === 'wolf' && (def.wolfShare ?? 0) > 0 && !def.boarShare) || (kind === 'boar' && (def.boarShare ?? 0) > 0 && !def.wolfShare)));
    if (pool) return pool.id;
  }
  return `+${kind}`;
}

/**
 * The elements a fight shows by its arena alone (from the first frame): the buttons, the leader or the horde of a `marked` goal
 * (the run's goal layouts), the terrain (cliff, river → water, thorns), a big pond (r ≥ 2) → water, the braziers, the chest.
 * The kinds, the elite and the affixes are read from the fight itself (`RtArenaOutcome`).
 */
export function arenaElements(arena: string, markedGoals: boolean): string[] {
  const t = markedGoalArena(arenaTemplate(arena), markedGoals), out = new Set<string>();
  if (t.goal === 'buttons') out.add('buttons');
  if (t.goal === 'marked') { if (t.horde) out.add('horde'); else if (t.enemies.some(e => e.leader)) out.add('leader'); }
  for (const zone of t.terrain ?? []) out.add(zone.kind === 'river' ? 'water' : zone.kind);
  for (const o of t.obstacles) if (o.kind === 'pond' && 'r' in o && o.r >= 2) out.add('water');
  if (t.braziers?.length) out.add('brazier');
  if (t.chest) out.add('chest');
  // Task 28: a boss with a part stands from the first frame (the Jailer's weight).
  // Task 48: the Troll's parts too.
  if (t.enemies.some(e => e.kind === JAILER_WEIGHT || TROLL_PARTS.includes(e.kind ?? ''))) out.add(PART_ARC);
  return SCHEDULE_ELEMENTS.filter(id => out.has(id));
}

/**
 * The elements met in a played fight (the run keeps them on its record, `RtBattleRecord.seen`): the arena's own, the special
 * kinds that stood on it, `elite` when an elite stood on it, `affix` and `affix:<id>` for the affixes seen on elites, the bust
 * when it was the fight of the bust arc (design 15.10.2026: counted when that fight is played) and the bag when the fight had one.
 */
export function fightElements(fight: { arena: string; markedGoals: boolean; arc: string | null; kinds?: readonly string[]; elite?: boolean; affixes?: readonly string[]; bag: boolean; shooters?: boolean }): string[] {
  const out = new Set(arenaElements(fight.arena, fight.markedGoals)), kinds = scheduleKinds(fight.shooters);
  for (const kind of fight.kinds ?? []) if (kinds.includes(kind)) out.add(kind);
  if (fight.elite) out.add('elite');
  for (const id of fight.affixes ?? []) if ((AFFIX_IDS as readonly string[]).includes(id)) { out.add('affix'); out.add(affixElement(id)); }
  if (fight.arc === BUST_ARC) out.add(BUST_ARC);
  if (fight.bag) out.add('bag');
  return [...out].sort();
}

/**
 * The special kinds a fight's arena may bring that are not met — the run takes them out (`Loadout.withoutKinds`); the arc's own
 * kind stays. Sorted.
 */
export function unmetKinds(arena: string, roster: string | undefined, met: ReadonlySet<string>, arc: string | null, shooters = false): string[] {
  const kinds = arenaKinds(arena, roster);
  return scheduleKinds(shooters).filter(kind => kinds.has(kind) && !met.has(kind) && kind !== arc);
}

/**
 * The affix types an elite of the fight may take: those met, and at most one more (by the node's roll) — one every kind the elite may
 * be (`kinds`) can take (review 15.10.2026: «Стремительный» is not for a fast kind, «Толстый» not for a slow one; the arc's only type
 * must reach its elite), else any. Sorted as `AFFIX_IDS`.
 */
export function allowedAffixes(met: ReadonlySet<string>, seed: number, kinds: readonly string[] = []): string[] {
  const known = AFFIX_IDS.filter(id => met.has(affixElement(id))), unmet = AFFIX_IDS.filter(id => !met.has(affixElement(id)));
  const legal = unmet.filter(id => kinds.every(kind => affixAllowed(kind, id))), unknown = legal.length ? legal : unmet;
  const extra = unknown.length ? unknown[mixSeed(mixSeed(seed, SCHEDULE_SALT), 3) % unknown.length] : undefined;
  return AFFIX_IDS.filter(id => known.includes(id) || id === extra);
}

/**
 * The history a viewer starts with before the schedule kept one (design answer 2, 15.10.2026): the kinds and affixes of the view's
 * «Новое на карте» memory and `elite`, `goblin-bust` → `bust`, `bag` of its first meetings. No terrain: arcs bring it one a fight.
 */
export function scheduleSeedHistory(kinds: readonly string[], affixes: readonly string[], firsts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const kind of kinds) if (SCHEDULE_KINDS.includes(kind)) out.add(kind);
  for (const id of affixes) if ((AFFIX_IDS as readonly string[]).includes(id)) { out.add('affix'); out.add(affixElement(id)); }
  if (firsts.includes('elite')) out.add('elite');
  if (firsts.includes('goblin-bust')) out.add(BUST_ARC);
  if (firsts.includes('bag')) out.add('bag');
  return [...out].sort();
}
