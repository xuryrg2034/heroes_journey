/**
 * Rosters of the real-time arenas (phase A, track Т2, docs/realtime-phase-a.md, sections 2 and 4): the composition of an
 * arena apart from its layout. A layout (arenas.ts) is the size, terrain, goal, buttons, door and the enemies that are
 * part of the goal (marked ones and elites of the template); a roster is who comes: the newcomers of other kinds by their
 * shares, the share of wolf packs among the groups and the share of boars among the single newcomers.
 *
 * Three kinds of arenas in the run (design answer 2, 09.10.2026):
 * - fixed composition (`FIXED_ROSTER_ARENAS`; «Поляна» on run row 1 — the chain lesson): the template's own, no roster;
 * - pool arenas (`POOL_ROSTER_ARENAS`: «Двор кнопок», «Логово», «Поляна» from run row 2): one roster of `POOL_ROSTERS`
 *   replaces the template's newcomers and its pack and boar shares;
 * - anchor arenas (`ANCHOR_ARENAS`: «Стена щитов», «Пороховой склад», «Колючие заросли», «Рысье логово»): the anchor
 *   kind keeps its share; when it was met before, one role of `ANCHOR_ROLES` is added; at the first meeting of the
 *   anchor kind the composition is the template's own.
 * A roster or a role is admissible only when every kind in it was met in the run (`rosterChoices`); basic enemies, wolves
 * and boars need no meeting. Which one comes is the run's decision (run/arenaPools.ts, `nodeRoster`).
 *
 * The simulation takes a roster by id (`withRoster`, `Simulation` option `roster`, journal field `roster`); without one
 * the arena plays its template as before (old journals replay to the same hash).
 */
import type { ArenaTemplate, NewcomerShare } from './arenas';

/** Roles of the enemies (design 09.10.2026): what a kind does to the player. */
export type EnemyRole = 'presser' | 'shooter' | 'blocker' | 'punisher' | 'master' | 'diver';
export const ROLE_TITLES: Readonly<Record<EnemyRole, string>> = {
  presser: 'давитель', shooter: 'стрелок', blocker: 'блокер', punisher: 'наказатель', master: 'мастер', diver: 'ныряльщик',
};
/** The role of each kind a roster may bring. */
export const KIND_ROLE: Readonly<Record<string, EnemyRole>> = {
  basic: 'presser', boar: 'presser', archer: 'shooter', shield: 'blocker', porcupine: 'punisher', sapper: 'punisher', shaman: 'master', wolf: 'diver', lynx: 'diver',
};
/** Kinds every run has met from its start: no roster waits for them. */
export const ALWAYS_MET: readonly string[] = ['basic', 'wolf', 'boar'];

/**
 * A roster (`mode: 'replace'` — a pool roster) or a role added to an anchor (`mode: 'add'`). `kinds` — single newcomers of
 * other kinds as shares of all single newcomers (turned into the per-roll shares of spawn.ts by `rollShares`); `wolfShare`
 * — the share of groups that come as a wolf pack; `boarShare` — the share of boars among the other single newcomers
 * (capped by the panel's «Кабанов на арене»). A replacing roster sets both shares (absent — 0); an added role sets only
 * the share it names.
 */
export interface RosterDef {
  id: string;
  /** Name on the node preview («Состав: Стая»); a role — the tail after the anchor («Щитоносцы + лучники»). */
  title: string;
  mode: 'replace' | 'add';
  kinds: readonly (readonly [kind: string, share: number])[];
  wolfShare?: number;
  boarShare?: number;
}

/**
 * Баланс: the pool rosters (docs/realtime-phase-a.md, section 4). Two kinds at 10–15% each — about 60% of the kind's
 * share on its own arena (15–25%), above the mixed arenas' 10%; «Натиск» and «Волки» need no meeting (the early rows).
 */
export const POOL_ROSTERS: readonly RosterDef[] = [
  { id: 'onslaught', title: 'Натиск', mode: 'replace', kinds: [], boarShare: 0.15 },
  { id: 'wolves', title: 'Волки', mode: 'replace', kinds: [], wolfShare: 0.25 },
  { id: 'shield-archers', title: 'Стрелки за щитами', mode: 'replace', kinds: [['shield', 0.15], ['archer', 0.12]] },
  { id: 'pack', title: 'Стая', mode: 'replace', kinds: [['lynx', 0.1]], wolfShare: 0.2 },
  { id: 'quills-powder', title: 'Колючки и порох', mode: 'replace', kinds: [['porcupine', 0.12], ['sapper', 0.1]] },
  { id: 'shaman-shield', title: 'Шаманский щит', mode: 'replace', kinds: [['shaman', 0.06], ['shield', 0.15]] },
  { id: 'hunt', title: 'Охота', mode: 'replace', kinds: [['lynx', 0.1], ['archer', 0.12]] },
];

/** Баланс: the roles an anchor arena may add — one kind each, a little below a pool roster's share. */
export const ANCHOR_ROLES: readonly RosterDef[] = [
  { id: '+boar', title: 'кабаны', mode: 'add', kinds: [], boarShare: 0.1 },
  { id: '+wolf', title: 'волки', mode: 'add', kinds: [], wolfShare: 0.15 },
  { id: '+archer', title: 'лучники', mode: 'add', kinds: [['archer', 0.1]] },
  { id: '+shield', title: 'щитоносцы', mode: 'add', kinds: [['shield', 0.12]] },
  { id: '+porcupine', title: 'дикобразы', mode: 'add', kinds: [['porcupine', 0.1]] },
  { id: '+sapper', title: 'сапёры', mode: 'add', kinds: [['sapper', 0.1]] },
  { id: '+shaman', title: 'шаман', mode: 'add', kinds: [['shaman', 0.06]] },
  { id: '+lynx', title: 'рыси', mode: 'add', kinds: [['lynx', 0.08]] },
];

/** Arenas whose composition is fixed (their goal or their lesson is the composition), whatever the row. */
export const FIXED_ROSTER_ARENAS: readonly string[] = ['archers', 'ford', 'shaman-circle', 'outpost', 'last-stand'];
/** Arenas whose composition comes from `POOL_ROSTERS`. «Поляна» only past `GLADE_LESSON_ROW`. */
export const POOL_ROSTER_ARENAS: readonly string[] = ['buttons', 'marked', 'glade'];
/** «Поляна» on this run row (and before) keeps its own composition: basic enemies only, the lesson of the chain. */
export const GLADE_LESSON_ROW = 1;
/** Anchor arenas: the kind that stays, and its name on the preview. */
export const ANCHOR_ARENAS: Readonly<Record<string, { kind: string; title: string }>> = {
  shields: { kind: 'shield', title: 'Щитоносцы' },
  powder: { kind: 'sapper', title: 'Сапёры' },
  thorns: { kind: 'porcupine', title: 'Дикобразы' },
  'lynx-den': { kind: 'lynx', title: 'Рыси' },
};

const registry = new Map<string, RosterDef>([...POOL_ROSTERS, ...ANCHOR_ROLES].map(def => [def.id, def]));
/** The roster or role `id`, undefined when unknown. */
export const rosterDef = (id: string): RosterDef | undefined => registry.get(id);
export const isRoster = (id: unknown): id is string => typeof id === 'string' && registry.has(id);

/** Every kind a roster or a role brings (packs — `wolf`, boars — `boar`). */
export function rosterKinds(def: RosterDef): string[] {
  return [...def.kinds.map(([kind]) => kind), ...(def.wolfShare ?? 0) > 0 ? ['wolf'] : [], ...(def.boarShare ?? 0) > 0 ? ['boar'] : []];
}

/**
 * The rosters an arena may take on run row `row` given the kinds met (`met`, without `ALWAYS_MET`): null — the arena plays
 * its template (fixed composition, «Поляна» of the lesson row, an anchor at the first meeting of its kind, an arena the
 * rule does not know); otherwise the admissible ids in a fixed order (never empty: «Натиск», «Волки» and the role
 * «кабаны» need no meeting, and no anchor is a presser). An anchor adds a role other than its own (no second punisher
 * on «Колючие заросли», no wolves on «Рысье логово»).
 */
export function rosterChoices(arena: string, row: number, met: ReadonlySet<string>): string[] | null {
  const known = (def: RosterDef) => rosterKinds(def).every(kind => ALWAYS_MET.includes(kind) || met.has(kind));
  if (POOL_ROSTER_ARENAS.includes(arena)) {
    if (arena === 'glade' && row <= GLADE_LESSON_ROW) return null;
    return POOL_ROSTERS.filter(known).map(def => def.id);
  }
  const anchor = ANCHOR_ARENAS[arena];
  if (!anchor || !met.has(anchor.kind)) return null;
  const own = KIND_ROLE[anchor.kind];
  return ANCHOR_ROLES.filter(def => known(def) && rosterKinds(def).every(kind => KIND_ROLE[kind] !== own)).map(def => def.id);
}

/** The preview line's name: a pool roster's title, or «<anchor> + <role>». */
export function rosterTitle(arena: string, id: string): string {
  const def = rosterDef(id);
  if (!def) return id;
  const anchor = ANCHOR_ARENAS[arena];
  return def.mode === 'add' && anchor ? `${anchor.title} + ${def.title}` : def.title;
}

/** Per-roll shares of spawn.ts (each kind rolled in order) from shares of all single newcomers; the `hp` of an entry stays. */
function rollShares(entries: readonly { kind: string; ofAll: number; hp?: number }[]): NewcomerShare[] {
  let left = 1;
  return entries.map(({ kind, ofAll, hp }) => {
    const share = left > 0 ? Math.min(1, ofAll / left) : 0;
    left -= ofAll;
    return { kind, share, ...hp !== undefined ? { hp } : {} };
  });
}
/** The inverse: shares of all single newcomers of a template's per-roll list. */
function ofAllShares(newcomers: readonly NewcomerShare[]): { kind: string; ofAll: number; hp?: number }[] {
  let left = 1;
  return newcomers.map(({ kind, share, hp }) => {
    const ofAll = share * left;
    left -= ofAll;
    return { kind, ofAll, ...hp !== undefined ? { hp } : {} };
  });
}

/** A template with a roster applied: the layout as it is, `roster` names what was applied (the journal keeps it). */
export type RosterArena = ArenaTemplate & { readonly roster?: string };

/**
 * The arena `template` with roster or role `id`: the same layout (size, terrain, goal, buttons, door, the start enemies —
 * no arena with rosters has start enemies outside its goal except the anchor's own lynxes), the newcomers and the pack
 * and boar shares of the roster. A pool roster replaces the template's newcomers; a role keeps them (the anchor first,
 * its per-roll share unchanged) and adds its kind after them. The shares go to `phaseOverride`: before the goals and in
 * every phase of the greed table.
 */
export function withRoster(template: ArenaTemplate, id: string): RosterArena {
  const def = rosterDef(id);
  if (!def) throw new Error(`unknown roster «${id}»`);
  if ((template as RosterArena).roster !== undefined) throw new Error(`arena «${template.id}» already has roster «${(template as RosterArena).roster}»`);
  const added = def.kinds.map(([kind, ofAll]) => ({ kind, ofAll }));
  const newcomers = rollShares(def.mode === 'replace' ? added : [...ofAllShares(template.newcomers ?? []), ...added]);
  const shares = def.mode === 'replace'
    ? { wolfShare: def.wolfShare ?? 0, boarShare: def.boarShare ?? 0 }
    : { ...def.wolfShare !== undefined ? { wolfShare: def.wolfShare } : {}, ...def.boarShare !== undefined ? { boarShare: def.boarShare } : {} };
  return { ...template, newcomers, phaseOverride: { ...template.phaseOverride, ...shares }, roster: id };
}
