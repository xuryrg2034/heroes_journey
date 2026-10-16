/**
 * Rosters of the real-time arenas (phase A, track Т2, docs/realtime-phase-a.md, sections 2 and 4): the composition of an
 * arena apart from its layout. A layout (arenas.ts) is the size, terrain, goal, buttons, door and the enemies that are
 * part of the goal (marked ones and elites of the template); a roster is who comes: the newcomers of other kinds by their
 * shares, the share of wolf packs among the groups and the share of boars among the single newcomers.
 *
 * Three kinds of arenas in the run (design answer 2, 09.10.2026):
 * - fixed composition (`FIXED_ROSTER_ARENAS`; «Поляна» on run row 1 — the chain lesson): the template's own, no roster
 *   (the roster mix of 11.10.2026 below is the run's exception for «Застава» and «Брод»);
 * - pool arenas (`POOL_ROSTER_ARENAS`: «Двор кнопок», «Логово», «Поляна» from run row 2): one roster of `POOL_ROSTERS`
 *   replaces the template's newcomers and its pack and boar shares;
 * - anchor arenas (`ANCHOR_ARENAS`: «Стена щитов», «Пороховой склад», «Колючие заросли», «Рысье логово»): the anchor
 *   kind keeps its share and one role of `ANCHOR_ROLES` is added — when the kind was met before, or from run row
 *   `ANCHOR_ROLE_ROW` (4) on; at the first meeting of the anchor kind on rows 1–3 the composition is the template's own.
 * A roster or a role is admissible only when every kind in it was met in the run (`rosterChoices`); basic enemies, wolves
 * and boars need no meeting. Which one comes is the run's decision (run/arenaPools.ts, `pickRoster`);
 * in a run with the roster mix (11.10.2026) «Застава» and «Брод» take a pool roster in about half of their fights.
 *
 * The simulation takes a roster by id (`withRoster`, `Simulation` option `roster`, journal field `roster`); without one
 * the arena plays its template as before (old journals replay to the same hash).
 */
import type { ArenaTemplate, NewcomerShare } from './arenas';

/** Task 43, part Г: the guard and the knight of the garrison (enemies/garrison.ts `GUARD`, `KNIGHT`; no import: the registry loads after). */
const GUARD_KIND = 'guard', KNIGHT_KIND = 'knight';
/** Task 28: the kind whose shield is the shieldbearer's (the Jailer's core, enemies/jailer.ts `JAILER`; no import: the registry loads after). */
const SHIELDED_CORE = 'jailer';

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
 * (capped by the roster's `boarMax`, else the panel's «Кабанов на арене»). A replacing roster sets both shares (absent — 0); an added role sets only
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
  /** Cap of boars on the arena for this roster (design 09.10.2026: «Натиск» — 5); absent — the panel's «Кабанов на арене». */
  boarMax?: number;
}

/**
 * Баланс: the pool rosters (docs/realtime-phase-a.md, section 4). Two kinds at 10–15% each — about 60% of the kind's
 * share on its own arena (15–25%), above the mixed arenas' 10%; «Натиск» and «Волки» need no meeting (the early rows).
 */
export const POOL_ROSTERS: readonly RosterDef[] = [
  { id: 'onslaught', title: 'Натиск', mode: 'replace', kinds: [], boarShare: 0.15, boarMax: 5 },
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

/**
 * Arenas whose composition is fixed (their goal or their lesson is the composition), whatever the row. A run with the
 * roster mix (11.10.2026, run/arenaPools.ts `MIXED_ROSTER_ARENAS`) gives «Застава» and «Брод» a pool roster in about half
 * of their fights; `rosterChoices` keeps them fixed (null).
 */
export const FIXED_ROSTER_ARENAS: readonly string[] = ['archers', 'ford', 'shaman-circle', 'outpost', 'last-stand'];
/** Arenas whose composition comes from `POOL_ROSTERS`. «Поляна» only past `GLADE_LESSON_ROW`. */
export const POOL_ROSTER_ARENAS: readonly string[] = ['buttons', 'marked', 'glade'];
/** «Поляна» on this run row (and before) keeps its own composition: basic enemies only, the lesson of the chain. */
export const GLADE_LESSON_ROW = 1;
/**
 * Решение дизайна 09.10.2026 (вариант А с порогом): from this run row on an anchor arena adds a role at the first meeting
 * of its kind too; on rows 1–3 the first meeting keeps the template's own composition.
 */
export const ANCHOR_ROLE_ROW = 4;
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

/** Whether every kind of a roster or a role was met (`met`, without `ALWAYS_MET`). */
const knownTo = (met: ReadonlySet<string>) => (def: RosterDef): boolean => rosterKinds(def).every(kind => ALWAYS_MET.includes(kind) || met.has(kind));
/**
 * The pool rosters admissible with the kinds met (`met`), in the order of `POOL_ROSTERS`: what a pool arena takes, and —
 * in a run with the roster mix (run/arenaPools.ts `MIXED_ROSTER_ARENAS`, 11.10.2026) — «Застава» and «Брод» in place of
 * their own composition. Never empty («Натиск» and «Волки» need no meeting).
 */
export function poolRosterChoices(met: ReadonlySet<string>): string[] {
  return POOL_ROSTERS.filter(knownTo(met)).map(def => def.id);
}

/**
 * The rosters an arena may take on run row `row` given the kinds met (`met`, without `ALWAYS_MET`): null — the arena plays
 * its template (fixed composition, «Поляна» of the lesson row, an anchor at the first meeting of its kind before run row
 * `ANCHOR_ROLE_ROW`, an arena the
 * rule does not know); otherwise the admissible ids in a fixed order (never empty: «Натиск», «Волки» and the role
 * «кабаны» need no meeting, and no anchor is a presser). An anchor adds a role other than its own (no second punisher
 * on «Колючие заросли», no wolves on «Рысье логово»).
 */
export function rosterChoices(arena: string, row: number, met: ReadonlySet<string>): string[] | null {
  const known = knownTo(met);
  if (POOL_ROSTER_ARENAS.includes(arena)) {
    if (arena === 'glade' && row <= GLADE_LESSON_ROW) return null;
    return poolRosterChoices(met);
  }
  const anchor = ANCHOR_ARENAS[arena];
  if (!anchor || (!met.has(anchor.kind) && row < ANCHOR_ROLE_ROW)) return null;
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

/**
 * Task 17 (design 13.10.2026; a gentle run's final with the porcupine not met): the template without the kinds `kinds` — the
 * newcomers of those kinds leave the mix and their share of all single newcomers goes to the other kinds of the template's
 * own mix in equal parts (the total share of the mix stays; none left — to basic enemies); a start enemy of such a kind stands
 * as a basic enemy (its place, colour, elite and HP kept). The arena id stays (the journal names the kit's list,
 * `Loadout.withoutKinds`, and a replay applies it again).
 * Task 26 «Расписание леса»: the wolf and the boar come by the pace's shares — with them in `kinds` the shares are 0 before the
 * goals and in every phase (`phaseOverride`). Kits before task 26 never named them (only the porcupine): they hash as before.
 * Task 28 «Тюремщик в походе»: with the shieldbearer (`shield`) out, the Jailer's core stands without its shield (`shieldless`;
 * the Jailer is not taken out — its shield is the shieldbearer's lesson).
 */
export function withoutKinds<T extends ArenaTemplate>(template: T, kinds: readonly string[]): T {
  if (!kinds.length) return template;
  const all = ofAllShares(template.newcomers ?? []), gone = all.filter(entry => kinds.includes(entry.kind)), kept = all.filter(entry => !kinds.includes(entry.kind));
  const extra = gone.reduce((sum, entry) => sum + entry.ofAll, 0) / Math.max(1, kept.length);
  const newcomers = kept.length ? rollShares(kept.map(entry => ({ ...entry, ofAll: entry.ofAll + extra }))) : [];
  const bare = kinds.includes('shield');
  const enemies = template.enemies.map(e => kinds.includes(e.kind ?? 'basic') ? { ...e, kind: 'basic' as const } : bare && e.kind === SHIELDED_CORE ? { ...e, shieldless: true } : e);
  const shares = { ...kinds.includes('wolf') ? { wolfShare: 0 } : {}, ...kinds.includes('boar') ? { boarShare: 0 } : {} };
  return { ...template, newcomers, enemies, ...Object.keys(shares).length ? { phaseOverride: { ...template.phaseOverride, ...shares } } : {} };
}

/** A template with a roster applied: the layout as it is, `roster` names what was applied (the journal keeps it). */
export type RosterArena = ArenaTemplate & { readonly roster?: string };

/**
 * The arena `template` with roster or role `id`: the same layout (size, terrain, goal, buttons, door, the start enemies —
 * no arena with rosters has start enemies outside its goal except the anchor's own lynxes; «Брод» and «Застава» of the
 * roster mix have only marked enemies and elites at the start), the newcomers and the pack
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
  return { ...template, newcomers, phaseOverride: { ...template.phaseOverride, ...shares }, ...def.boarMax !== undefined ? { boarMax: def.boarMax } : {}, roster: id };
}

/**
 * Task 43 «Гарнизон, шаг 2», part Г (`Loadout.knights`, world.ts `createWorld`): the template with a knight in place of the middle
 * guard of each of its first `n` start formations (by the formation's number; the knight keeps the guard's place, colour and
 * formation, its HP is its kind's). The run gives it to «Галерея» and the hard «Караульня» once the knight was met on «Ристалище». `n` 0 (or no
 * formation) — the template as it is.
 */
export function withKnights<T extends ArenaTemplate>(template: T, n: number): T {
  if (n < 1) return template;
  const formations = [...new Set(template.enemies.flatMap(e => (e.kind === GUARD_KIND && e.formation !== undefined ? [e.formation] : [])))].sort((a, b) => a - b).slice(0, n);
  if (!formations.length) return template;
  const middle = new Set(formations.map(f => {
    const members = template.enemies.flatMap((e, i) => (e.kind === GUARD_KIND && e.formation === f ? [i] : []));
    return members[(members.length - 1) >> 1];
  }));
  return { ...template, enemies: template.enemies.map((e, i) => { if (!middle.has(i)) return e; const { hp: _hp, ...rest } = e; return { ...rest, kind: KNIGHT_KIND }; }) };
}
