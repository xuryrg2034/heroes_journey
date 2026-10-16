/**
 * П6 «Незакрытое дело» (docs/realtime-engagement-research.md, П6; docs/realtime-slice.md, section 9; design decisions
 * 12.10.2026): the run-end screen says true facts of the run in a fixed order, no chance in the choice:
 * - defeat — who killed the hero («Сразил: …»), the row of the lost node and the rows left to the final arena, whether the
 *   Jailer was passed, then the run's peak chain;
 * - victory — only the final row («… «Последний рубеж» пройден») and the peak.
 *
 * The killer is the lost fight's lethal `hit` (the last `hit` before `defeat` in the sim's events), read by the view as the
 * fight's luck is read (main.ts, every frame; `RtDeathWatch`) and kept on the lost battle record (`RtBattleRecord.death`, an
 * optional field of save version 7). The striker is looked up at the hit: an enemy on the arena when its events are read, or
 * one seen before a tick of the fight (a sapper dies in its own blast, a porcupine may die in the dash its quills hit).
 * A view and save feature only: no Param, never in the journal or the hash; the simulation does not read it.
 *
 * Every text of П6 is here (`RT_RUN_END_TEXT`, `RT_DEATH_ABILITY`, `RT_KIND_TITLES`): design approves and edits them in one place.
 */
import { AFFIX_IDS, AFFIX_TITLES, type AffixId } from '../sim/elites';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { generatedRunMap } from '../forest/mapGenerator';
import type { ForestRunMap } from '../forest/forestMap';
import { runRow } from './arenaPools';
// Types only: rtRun.ts reads `validDeath` from here (no import cycle at run time).
import type { RtBattleRecord, RtRunState } from './rtRun';

/**
 * Russian names of the enemy kinds (the telemetry report's names, telemetry/report.ts reads them from here). `basic` names an
 * adjective there («обычный»); the killer line says «враг», and «элита» for its elite (design 12.10.2026, `RT_RUN_END_TEXT`).
 */
export const RT_KIND_TITLES: Readonly<Record<string, string>> = {
  basic: 'обычный', wolf: 'волк', boar: 'кабан', reaper: 'жнец', shield: 'щитоносец', archer: 'лучник', sapper: 'сапёр', porcupine: 'дикобраз', lynx: 'рысь', shaman: 'шаман',
  // Task 28 «Тюремщик в походе»: the boss and its part (a touch of either may kill in the run's Jailer fight).
  jailer: 'Тюремщик', 'jailer-weight': 'гиря Тюремщика',
  // Tasks 38–40 «Гарнизон» (the report's and the killer line's names; task 40: their touches are in `RT_DEATH_TOUCH`).
  // Design 16.10.2026 (task-40 spec, section 10): a capital only for a unique boss («Тюремщик», «Кастелян»); the kinds in lower case.
  guard: 'стражник', handler: 'псарь', hound: 'пёс', castellan: 'Кастелян', keymaster: 'ключник',
  // Task 43 «Гарнизон, шаг 2».
  crossbow: 'арбалетчик', 'castellan-crossbow': 'арбалет Кастеляна',
  // Task 43 «Гарнизон, шаг 2»: the knight (lower case, the decision of task 40).
  knight: 'рыцарь',
};

/**
 * The killing blow of an ability or of the field (its `hit.source`) — the line names it, not the kind: the enemies' abilities,
 * the thorns (`thorns`, no striker) and the goblin's arrows (`slot-rain` the rain, `slot-volley` the volley, no striker;
 * design 12.10.2026) and its bust («Перебор», `slot-bust`, no striker). A hit source not here and not a touch has no killer line.
 */
export const RT_DEATH_ABILITY: Readonly<Record<string, string>> = {
  arrow: 'стрела лучника', blast: 'взрыв сапёра', quills: 'иглы дикобраза', lynx: 'прыжок рыси', boar: 'рывок кабана', 'fire-trail': 'огненный след',
  thorns: 'шипы', 'slot-rain': 'стрелы гоблина', 'slot-volley': 'стрелы гоблина', 'slot-bust': 'взрыв гоблина',
  // Task 28: the Jailer's moves.
  flail: 'кистень Тюремщика', throw: 'бросок гири',
  // Task 40 (design 16.10.2026, task-40 spec section 10): the Castellan's «Спустить пса» (a hound's touch outside it — «пёс»).
  lunge: 'рывок пса Кастеляна',
  // Task 43: the crossbowman's bolt (a kind in lower case, task 40's rule).
  bolt: 'болт арбалетчика',
  // Task 43: the Castellan's crossbow on its stand (design 16.10.2026).
  'castellan-bolt': 'болт Кастеляна',
  // Task 43 (spec section 5): the knight's moves (its touch — «рыцарь»).
  'knight-charge': 'рывок рыцаря', 'knight-swing': 'размах рыцаря',
};
/**
 * The touch sources (each kind's `hitSource`): the line names the striker's kind, its elite mark, armour and affixes. Task 40 (design
 * 16.10.2026, spec section 10): the garrison's touches too — the guard, the dog handler, the hound (on its leash or in its frenzy: the
 * same body, «пёс»), the keymaster, the Castellan.
 */
export const RT_DEATH_TOUCH: readonly string[] = ['touch', 'wolf', 'reaper', 'guard', 'handler', 'hound', 'keymaster', 'castellan', 'crossbow', 'knight'];

/** Drafts sent to design 12.10.2026 (pending approval). */
export const RT_RUN_END_TEXT = {
  killer: (what: string): string => `Сразил: ${what}`,
  /** The basic enemy and its elite (design 12.10.2026); the other kinds name themselves, an elite adds `eliteMark`. */
  basicKiller: 'враг',
  basicEliteKiller: 'элита',
  eliteMark: '-элита',
  armor: 'броня',
  rowLeft: (row: number, left: number): string => `Ряд ${row} · до «Последнего рубежа» ${left}`,
  /** A defeat on the final arena itself (no rows left). */
  rowFinalLost: (row: number): string => `Ряд ${row} · «Последний рубеж» не пройден`,
  rowFinalWon: (row: number): string => `Ряд ${row} · «Последний рубеж» пройден`,
  jailerPassed: 'Тюремщик пройден',
  jailerNotPassed: 'Тюремщик не пройден',
  peak: (kills: number, row: number): string => `Лучшая цепь похода: ${kills} ${killsWord(kills)} · ряд ${row}`,
} as const;

function killsWord(n: number): string {
  const tens = n % 100, ones = n % 10;
  return tens >= 11 && tens <= 14 ? 'убийств' : ones === 1 ? 'убийство' : ones >= 2 && ones <= 4 ? 'убийства' : 'убийств';
}

/**
 * The lethal hit of a lost fight as the run keeps it: its source (`hit.source`) and, when the striker was an enemy, its kind,
 * its elite mark, its armour (the package's plates, `Enemy.armor`) and its affixes. Absent fields — not so (or unknown).
 */
export interface RtDeath { source: string; enemy?: string; elite?: true; armor?: true; affixes?: AffixId[] }

/** The death of a hit `source` struck by `striker` (null — no enemy, or unknown). */
export function rtDeathOf(source: string, striker: Pick<Enemy, 'kind' | 'elite' | 'armor' | 'affixes'> | null | undefined): RtDeath {
  const affixes = striker?.affixes?.filter(id => (AFFIX_IDS as readonly string[]).includes(id)) ?? [];
  return { source, ...striker ? { enemy: striker.kind } : {}, ...striker?.elite ? { elite: true as const } : {},
    // The elite's armour only (task 43: a boss part's plates — the Castellan's crossbow on its stand, the cores — and the knight's are no mark: a
    // record with `armor` and no `elite` is not a valid death, `validDeath`).
    ...striker?.elite && striker.armor ? { armor: true as const } : {},
    ...affixes.length ? { affixes: [...affixes] } : {} };
}

const SOURCE = /^[a-z][a-z0-9-]{0,31}$/;
const DEATH_KEYS = new Set(['source', 'enemy', 'elite', 'armor', 'affixes']);
/** A saved `death` is well formed: a source, a known kind, flags `true`, known affixes without repeats; armour and affixes only on an elite. */
export function validDeath(value: unknown): value is RtDeath {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (Object.keys(d).some(key => !DEATH_KEYS.has(key)) || typeof d.source !== 'string' || !SOURCE.test(d.source)) return false;
  if (d.enemy !== undefined && !(typeof d.enemy === 'string' && Object.hasOwn(RT_KIND_TITLES, d.enemy))) return false;
  if ((d.elite !== undefined && d.elite !== true) || (d.armor !== undefined && d.armor !== true)) return false;
  if (d.affixes !== undefined && !(Array.isArray(d.affixes) && d.affixes.length > 0 && new Set(d.affixes).size === d.affixes.length
    && d.affixes.every(id => typeof id === 'string' && (AFFIX_IDS as readonly string[]).includes(id)))) return false;
  if ((d.armor || d.affixes) && !d.elite) return false;
  return (d.elite === undefined && d.armor === undefined && d.affixes === undefined) || d.enemy !== undefined;
}

/** «Сразил: …» of a saved death; null — no line (an unknown source, a touch without a known kind). */
export function rtDeathLine(death: RtDeath | undefined): string | null {
  if (!death) return null;
  const ability = Object.hasOwn(RT_DEATH_ABILITY, death.source) ? RT_DEATH_ABILITY[death.source] : undefined;
  if (ability) return RT_RUN_END_TEXT.killer(ability);
  if (!RT_DEATH_TOUCH.includes(death.source) || !death.enemy || !Object.hasOwn(RT_KIND_TITLES, death.enemy)) return null;
  const basic = death.enemy === 'basic';
  const name = basic ? (death.elite ? RT_RUN_END_TEXT.basicEliteKiller : RT_RUN_END_TEXT.basicKiller) : RT_KIND_TITLES[death.enemy];
  const marks = [...death.armor ? [RT_RUN_END_TEXT.armor] : [], ...(death.affixes ?? []).map(id => AFFIX_TITLES[id].toLowerCase())];
  return RT_RUN_END_TEXT.killer(`${name}${death.elite && !basic ? RT_RUN_END_TEXT.eliteMark : ''}${marks.length ? ` (${marks.join(', ')})` : ''}`);
}

/**
 * Reads a run fight's lethal hit from the sim's events (main.ts: `seen` before every tick, `read` every frame before the
 * events go; the Node tests do the same). The fight's death stays once found; a new fight needs a new watch (or `reset`).
 */
export class RtDeathWatch {
  /** Every enemy seen on the arena before a tick of this fight, by id (ids are never reused in a world). */
  private readonly enemies = new Map<number, Enemy>();
  death: RtDeath | null = null;

  reset(): void { this.enemies.clear(); this.death = null; }

  seen(world: World): void { for (const e of world.enemies) if (!this.enemies.has(e.id)) this.enemies.set(e.id, e); }

  /**
   * Task 17 (review 13.10.2026): the kinds of every enemy that stood on the arena in this fight — seen before a tick, and those on
   * it now (`world`) — sorted. A marker that never stepped out is not counted. The run keeps them as met (`RtArenaOutcome.kinds`).
   */
  kinds(world?: World): string[] {
    const kinds = new Set<string>([...this.enemies.values()].map(e => e.kind));
    for (const e of world?.enemies ?? []) kinds.add(e.kind);
    return [...kinds].sort();
  }

  /** Task 26: an elite stood on the arena in this fight (seen before a tick, or on it now). The run keeps it as met (`RtArenaOutcome.elite`). */
  elite(world?: World): boolean {
    return [...this.enemies.values(), ...world?.enemies ?? []].some(e => !!e.elite);
  }

  /** Task 26: the affix types on the elites that stood on the arena in this fight, sorted (`RtArenaOutcome.affixes`). */
  affixes(world?: World): string[] {
    const ids = new Set<string>();
    for (const e of [...this.enemies.values(), ...world?.enemies ?? []]) if (e.elite) for (const id of e.affixes ?? []) ids.add(id);
    return [...ids].sort();
  }

  read(world: World, events: readonly WorldEvent[]): void {
    let hit: Extract<WorldEvent, { type: 'hit' }> | null = null;
    for (const ev of events) {
      if (ev.type === 'hit') hit = ev;
      // `hurtHero` pushes the lethal hit, then (the same call) `defeat`: the last hit before it is the killing blow.
      else if (ev.type === 'defeat' && hit && !this.death) {
        const id = hit.enemyId, striker = id > 0 ? world.enemies.find(e => e.id === id) ?? this.enemies.get(id) : undefined;
        this.death = rtDeathOf(hit.source, striker);
      }
    }
  }
}

/** One fact line of the run-end screen (`id` — killer, row, jailer, peak). */
export interface RtRunEndLine { id: 'killer' | 'row' | 'jailer' | 'peak'; text: string }

/** The run row of the final arena on this map (its boss nodes; run row 10 on the forest map). */
export function rtFinalRow(map: ForestRunMap): number {
  return Math.max(0, ...map.nodes.filter(node => node.type === 'boss').map(node => runRow(node.row)));
}

/** The Jailer's fight was won in this run (a won record on the checkpoint node). */
export function rtJailerPassed(map: ForestRunMap, battles: readonly RtBattleRecord[]): boolean {
  return battles.some(record => record.won && map.node(record.nodeId)?.type === 'checkpoint');
}

/**
 * The peak: the run's longest chain in kills (rtRun.ts `rtRunBestChain`, П10) and the run row of the first fight that reached
 * it; null — no fight recorded one (records saved before 12.10.2026), or no chain killed.
 */
export function rtRunPeak(map: ForestRunMap, battles: readonly RtBattleRecord[]): { kills: number; row: number } | null {
  let best = 0, row = 0;
  for (const record of battles) {
    const node = map.node(record.nodeId);
    if (record.bestChain !== undefined && record.bestChain > best && node) { best = record.bestChain; row = runRow(node.row); }
  }
  return best > 0 ? { kills: best, row } : null;
}

/**
 * The fact lines of an ended run, in the screen's order: defeat — killer (when known), row, Jailer, peak; victory — row,
 * peak. An open run has none.
 */
export function rtRunEndLines(run: RtRunState): RtRunEndLine[] {
  const result = run.result, map = generatedRunMap(run.map), node = result ? map.node(result.nodeId) : undefined;
  if (!result || !node) return [];
  const lines: RtRunEndLine[] = [], row = runRow(node.row), finalRow = rtFinalRow(map), peak = rtRunPeak(map, run.battles);
  if (result.outcome === 'victory') lines.push({ id: 'row', text: RT_RUN_END_TEXT.rowFinalWon(row) });
  else {
    const lost = [...run.battles].reverse().find(record => record.nodeId === result.nodeId && !record.won);
    const killer = rtDeathLine(lost?.death);
    if (killer) lines.push({ id: 'killer', text: killer });
    lines.push({ id: 'row', text: row >= finalRow ? RT_RUN_END_TEXT.rowFinalLost(row) : RT_RUN_END_TEXT.rowLeft(row, finalRow - row) });
    lines.push({ id: 'jailer', text: rtJailerPassed(map, run.battles) ? RT_RUN_END_TEXT.jailerPassed : RT_RUN_END_TEXT.jailerNotPassed });
  }
  if (peak) lines.push({ id: 'peak', text: RT_RUN_END_TEXT.peak(peak.kills, peak.row) });
  return lines;
}
