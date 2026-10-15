/**
 * The node card of the run map (task 8c, design 13.10.2026): what a battle node holds, said before the choice, in the middle of
 * the screen — the goal, the enemies, the elites and the terrain, one line each, in the player's words (no «пул», «аффикс»).
 * The fight's HUD keeps the goal only.
 *
 * Pure part (Node-testable, `npm run test:realtime-node-card`): it reads the arena template, the roster and the run row's
 * numbers (run/rtRun.ts); it changes nothing, it is not a Param, not in the journal, the hash or the save.
 */
import { arenaTemplate, markedGoalArena } from '../sim/arenas';
import type { TerrainKind } from '../sim/geometry';
import { arenaPreview, arenaSeed, RT_GENTLE_ELITE_ROW, rtAsh, rtEliteAffixes, rtEliteKinds, rtElitePlates, rtGentle, rtGuaranteedElite, rtMetKinds, rtRandomElites, rtScheduleMet, scheduleKit, type RtAshLevel, type RtBattleKind, type RtRunState } from '../run/rtRun';
import type { Loadout } from '../sim/kit';
import { runRow } from '../run/arenaPools';
import type { ForestMapNode } from '../forest/forestMap';
import { arenaKinds } from './newSeen';
import { arenaElements } from '../run/schedule';

/** The battle a node's card speaks of (the Jailer's «Застава» is `hard`, the final `final`, an event's reward battle `event`). */
export const cardBattle = (node: Pick<ForestMapNode, 'type'> | undefined): RtBattleKind =>
  node?.type === 'boss' ? 'final' : node?.type === 'hard' ? 'hard' : node?.type === 'event' ? 'event' : 'battle';

/**
 * The run's rules of a node's fight that the card reads — the same conditions as `rtArenaLoadout` (run/rtRun.ts) gives the fight:
 * the row, the gentle tables, the guaranteed elite, the event's start elite, the first elite row's kinds (Е2) and the gentle
 * final without the porcupine not met; task 18 — the run's level of «Испытание» (IV: 2 traits from row 6). A card that reads anything
 * else promises what the fight does not play (review 14.10.2026).
 */
export function cardRules(run: RtRunState, node: Pick<ForestMapNode, 'type' | 'row'> | ForestMapNode | undefined): Pick<NodeDangerInput, 'row' | 'guaranteedElite' | 'startElite' | 'markedGoals' | 'gentle' | 'eliteKinds' | 'withoutKinds' | 'ash' | 'randomElites' | 'elitePlates' | 'eliteAffixes'> {
  const row = node ? runRow(node.row) : 1, battle = cardBattle(node), gentle = rtGentle(run), ash = rtAsh(run);
  // Task 26 «Расписание леса»: a scheduled run's card reads the schedule's rules of the fight (`scheduleKit`, as `rtArenaLoadout`).
  const schedule = run.schedule && node && 'id' in node ? cardSchedule(run, node, battle) : null;
  if (schedule) return { row, startElite: !!run.modifiers?.includes('start-elite'), markedGoals: !!run.markedGoals, ...gentle ? { gentle: true } : {}, ...schedule };
  return {
    row, guaranteedElite: !!node && rtGuaranteedElite(node, battle, gentle), startElite: !!run.modifiers?.includes('start-elite'), markedGoals: !!run.markedGoals,
    ...gentle ? { gentle: true } : {},
    ...ash > 0 ? { ash } : {},
    ...gentle && node && row === RT_GENTLE_ELITE_ROW ? { eliteKinds: rtEliteKinds(run) } : {},
    ...gentle && battle === 'final' && !rtMetKinds(run).has('porcupine') ? { withoutKinds: ['porcupine'] } : {},
  };
}

/** Task 26: the elite and enemy rules of a scheduled node's fight — the node's pick (entered) or its preview; null — no arena known. */
function cardSchedule(run: RtRunState, node: ForestMapNode, battle: RtBattleKind): Pick<NodeDangerInput, 'guaranteedElite' | 'eliteKinds' | 'withoutKinds' | 'randomElites' | 'elitePlates' | 'eliteAffixes'> | null {
  const entered = run.picks.find(pick => pick.nodeId === node.id && pick.arena !== undefined), pick = entered?.arena ? { arena: entered.arena, roster: entered.roster, arc: entered.arc } : arenaPreview(run, node);
  if (!pick) return null;
  const kit = { elitePlates: rtElitePlates(runRow(node.row), rtGentle(run)) } as Loadout;
  scheduleKit(kit, run, node, battle, { arena: pick.arena, ...pick.roster !== undefined ? { roster: pick.roster } : {}, ...pick.arc !== undefined ? { arc: pick.arc } : {} }, rtScheduleMet(run), arenaSeed(run, node.id));
  return { guaranteedElite: !!kit.guaranteedElite, randomElites: !!kit.randomElites, elitePlates: kit.elitePlates ?? 2, eliteAffixes: kit.eliteAffixes ?? 0,
    ...kit.eliteKinds ? { eliteKinds: kit.eliteKinds } : {}, ...kit.withoutKinds ? { withoutKinds: kit.withoutKinds } : {} };
}

/** The kinds in the plural, the card's enemy line («Враги: обычные, волки»); a kind without a row is left out. */
export const KIND_PLURAL: Readonly<Record<string, string>> = {
  basic: 'обычные', wolf: 'волки', boar: 'кабаны', reaper: 'жнец', shield: 'щитоносцы', archer: 'лучники', sapper: 'сапёры', porcupine: 'дикобразы', lynx: 'рыси', shaman: 'шаманы',
};

/** The terrain words, in this order: the zones of the template (river, cliff, thorns), then the pond among the obstacles. */
const TERRAIN_WORD: Readonly<Record<TerrainKind | 'pond', string>> = { river: 'река', cliff: 'обрыв', thorns: 'терновник', pond: 'пруд' };
const TERRAIN_ORDER: readonly (TerrainKind | 'pond')[] = ['river', 'cliff', 'thorns', 'pond'];
/** The schedule's terrain elements (run/schedule.ts `arenaElements`: a river or a pond of r ≥ 2 — water). */
const TERRAIN_ELEMENTS: readonly string[] = ['water', 'cliff', 'thorns'];

export interface NodeDangerInput {
  arena: string;
  roster?: string;
  /** The run row of the node (1–10). */
  row: number;
  /** The battle brings one guaranteed elite (`rtGuaranteedElite`). */
  guaranteedElite: boolean;
  /** An event's modifier puts one more elite at the start (`start-elite`). */
  startElite?: boolean;
  /** Kinds the viewer has not met yet (they get «✦»), from «Новое на карте»; empty — none or the toggle off. */
  newKinds?: readonly string[];
  /** Task 12: the run's flag `RtRunState.markedGoals` — the goal line of a `marked` arena from its goal layout (`markedGoal`). */
  markedGoals?: boolean;
  /**
   * Task 17 «Пологий вход»: the run's `gentleEntry` — the gentle row tables (`rtRandomElites`, `rtElitePlates`, `rtEliteAffixes` with
   * the flag: elites from row 4, 3 plates and 1 trait from row 6, 2 traits from 9). Absent — an old run: the old tables.
   */
  gentle?: boolean;
  /**
   * Task 17 Е2: the kinds an elite may be in this fight (`rtEliteKinds`: the first elite row of a gentle run). An elite comes only
   * from a newcomer of these kinds; none of them in the arena — no elite but the template's own. Absent — every kind.
   */
  eliteKinds?: readonly string[];
  /** Task 17: kinds taken out of this fight (`Loadout.withoutKinds`: a gentle run's final without the porcupine not met). */
  withoutKinds?: readonly string[];
  /** Task 18: the run's level of «Испытание» (`rtAsh`; IV — 2 traits from row 6, `rtEliteAffixes`). Absent — 0. */
  ash?: RtAshLevel;
  /** Task 26: a scheduled fight's own numbers (`scheduleKit`): random elites, plates, traits. Absent — the row tables. */
  randomElites?: boolean;
  elitePlates?: number;
  eliteAffixes?: number;
  /**
   * Design 15.10.2026 (after task 26): the living elements the viewer has met (`rtScheduleMet`: the schedule's snapshot and this
   * run's fights) — the terrain line gets «✦» when the arena's terrain is not among them. Absent — no sign (a run without a
   * schedule, the toggle «Новое на карте» off, a node not available).
   */
  met?: ReadonlySet<string>;
}

export interface NodeDangerLine {
  id: 'goal' | 'enemies' | 'elites' | 'terrain';
  label: string;
  text: string;
  /** The enemies' line: kinds the viewer has not met. */
  newKinds?: string[];
  /** The terrain line: the terrain elements the viewer has not met (`water`, `cliff`, `thorns`). */
  newTerrain?: string[];
}

const few = (n: number): boolean => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);

/** The elites' line: how many stand for sure, whether more may come (run row 3 on; a gentle run — 4), the plates and the special traits of the row. */
export function eliteText(sure: number, random: boolean, plates: number, traits: number): string | null {
  if (sure <= 0 && !random) return null;
  const head = sure > 0 ? `${sure}${random ? ', могут прийти ещё' : ''}` : 'могут прийти';
  const traitWord = traits === 1 ? 'особое свойство' : `${traits} ${few(traits) ? 'особых свойства' : 'особых свойств'}`;
  return `${head} · броня ${plates}${traits > 0 ? ` · ${traitWord}` : ''}`;
}

/** The goal from the template's summary without its name in front («Поляна: убей…» → «Убей…»): the card names the arena above. */
export function goalText(summary: string): string {
  const rest = summary.replace(/^[^:.]{1,30}:\s*/, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** The lines of a battle node's card in the design's order: goal, enemies, elites, terrain (a line without content is left out). */
export function nodeDangers(input: NodeDangerInput): NodeDangerLine[] {
  let template;
  try { template = markedGoalArena(arenaTemplate(input.arena), input.markedGoals); } catch { return []; }
  const lines: NodeDangerLine[] = [{ id: 'goal', label: 'Цель', text: goalText(template.summary) }];
  // The ordinary enemies come to every arena (the default newcomer; the template lists only its other kinds).
  const kinds = [...new Set(['basic', ...arenaKinds(input.arena, input.roster)])].filter(kind => KIND_PLURAL[kind] && !input.withoutKinds?.includes(kind));
  // `basic` first, then the kinds in the order of the plural table (stable across arenas).
  const order = Object.keys(KIND_PLURAL);
  kinds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (kinds.length) {
    const fresh = kinds.filter(kind => input.newKinds?.includes(kind));
    lines.push({ id: 'enemies', label: 'Враги', text: kinds.map(kind => KIND_PLURAL[kind]).join(', '), ...fresh.length ? { newKinds: fresh } : {} });
  }
  // Task 17 Е2: the guaranteed, the start and the random elites come from a newcomer of an allowed kind (the template's own stay).
  const allowed = !input.eliteKinds || input.eliteKinds.some(kind => kinds.includes(kind));
  const sure = template.enemies.filter(e => e.elite).length + (allowed && input.guaranteedElite ? 1 : 0) + (allowed && input.startElite ? 1 : 0);
  const elites = eliteText(sure, allowed && (input.randomElites ?? rtRandomElites(input.row, input.gentle)), input.elitePlates ?? rtElitePlates(input.row, input.gentle), input.eliteAffixes ?? rtEliteAffixes(input.row, input.gentle, input.ash ?? 0));
  if (elites) lines.push({ id: 'elites', label: 'Элиты', text: elites });
  const present = new Set<TerrainKind | 'pond'>([...(template.terrain ?? []).map(z => z.kind), ...template.obstacles.flatMap(o => o.kind === 'pond' ? ['pond' as const] : [])]);
  const terrain = TERRAIN_ORDER.filter(kind => present.has(kind)).map(kind => TERRAIN_WORD[kind]);
  if (terrain.length) {
    // A small pond (r < 2) is not the schedule's water: it never gets the sign (it would stay «new» for ever).
    const fresh = input.met ? arenaElements(input.arena, !!input.markedGoals).filter(id => TERRAIN_ELEMENTS.includes(id) && !input.met!.has(id)) : [];
    lines.push({ id: 'terrain', label: 'Местность', text: terrain.join(', '), ...fresh.length ? { newTerrain: fresh } : {} });
  }
  return lines;
}
