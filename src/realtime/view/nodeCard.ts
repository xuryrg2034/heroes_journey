/**
 * The node card of the run map (task 8c, design 13.10.2026): what a battle node holds, said before the choice, in the middle of
 * the screen — the goal, the enemies, the elites and the terrain, one line each, in the player's words (no «пул», «аффикс»).
 * The fight's HUD keeps the goal only.
 *
 * Pure part (Node-testable, `npm run test:realtime-node-card`): it reads the arena template, the roster and the run row's
 * numbers (run/rtRun.ts); it changes nothing, it is not a Param, not in the journal, the hash or the save.
 */
import { arenaTemplate } from '../sim/arenas';
import type { TerrainKind } from '../sim/geometry';
import { RT_RANDOM_ELITE_ROW, rtEliteAffixes, rtElitePlates } from '../run/rtRun';
import { arenaKinds } from './newSeen';

/** The kinds in the plural, the card's enemy line («Враги: обычные, волки»); a kind without a row is left out. */
export const KIND_PLURAL: Readonly<Record<string, string>> = {
  basic: 'обычные', wolf: 'волки', boar: 'кабаны', reaper: 'жнец', shield: 'щитоносцы', archer: 'лучники', sapper: 'сапёры', porcupine: 'дикобразы', lynx: 'рыси', shaman: 'шаманы',
};

/** The terrain words, in this order: the zones of the template (river, cliff, thorns), then the pond among the obstacles. */
const TERRAIN_WORD: Readonly<Record<TerrainKind | 'pond', string>> = { river: 'река', cliff: 'обрыв', thorns: 'терновник', pond: 'пруд' };
const TERRAIN_ORDER: readonly (TerrainKind | 'pond')[] = ['river', 'cliff', 'thorns', 'pond'];

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
}

export interface NodeDangerLine { id: 'goal' | 'enemies' | 'elites' | 'terrain'; label: string; text: string; newKinds?: string[] }

const few = (n: number): boolean => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);

/** The elites' line: how many stand for sure, whether more may come (run row 3 on), the plates and the special traits of the row. */
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
  try { template = arenaTemplate(input.arena); } catch { return []; }
  const lines: NodeDangerLine[] = [{ id: 'goal', label: 'Цель', text: goalText(template.summary) }];
  // The ordinary enemies come to every arena (the default newcomer; the template lists only its other kinds).
  const kinds = [...new Set(['basic', ...arenaKinds(input.arena, input.roster)])].filter(kind => KIND_PLURAL[kind]);
  // `basic` first, then the kinds in the order of the plural table (stable across arenas).
  const order = Object.keys(KIND_PLURAL);
  kinds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (kinds.length) {
    const fresh = kinds.filter(kind => input.newKinds?.includes(kind));
    lines.push({ id: 'enemies', label: 'Враги', text: kinds.map(kind => KIND_PLURAL[kind]).join(', '), ...fresh.length ? { newKinds: fresh } : {} });
  }
  const sure = template.enemies.filter(e => e.elite).length + (input.guaranteedElite ? 1 : 0) + (input.startElite ? 1 : 0);
  const elites = eliteText(sure, input.row >= RT_RANDOM_ELITE_ROW, rtElitePlates(input.row), rtEliteAffixes(input.row));
  if (elites) lines.push({ id: 'elites', label: 'Элиты', text: elites });
  const present = new Set<TerrainKind | 'pond'>([...(template.terrain ?? []).map(z => z.kind), ...template.obstacles.flatMap(o => o.kind === 'pond' ? ['pond' as const] : [])]);
  const terrain = TERRAIN_ORDER.filter(kind => present.has(kind)).map(kind => TERRAIN_WORD[kind]);
  if (terrain.length) lines.push({ id: 'terrain', label: 'Местность', text: terrain.join(', ') });
  return lines;
}
