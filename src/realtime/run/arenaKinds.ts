/**
 * The kinds an arena brings as a run plays it (П8 «Новое на карте» first, view/newSeen.ts; task 26 «Расписание леса» reads
 * them too, run/schedule.ts). Moved here from the view 15.10.2026: unchanged.
 */
import { DEFAULT_PARAMS, DEFAULT_PHASES } from '../sim/params';
import { arenaTemplate, type ArenaTemplate } from '../sim/arenas';
import { rosterDef, rosterKinds } from '../sim/rosters';

/** The kinds an arena template brings: its start enemies and newcomers; wolves and boars when a phase gives them a share. */
export function templateKinds(template: ArenaTemplate): Set<string> {
  const kinds = new Set<string>();
  for (const e of template.enemies) kinds.add(e.kind ?? 'basic');
  for (const n of template.newcomers ?? []) if (n.share > 0) kinds.add(n.kind);
  const base = { wolfShare: template.pace?.wolfShare ?? DEFAULT_PARAMS.baseWolfShare, boarShare: template.pace?.boarShare ?? DEFAULT_PARAMS.baseBoarShare, ...template.phaseOverride };
  const phases = [base, ...(template.phases?.length ? template.phases : DEFAULT_PHASES).map(p => ({ ...p, ...template.phaseOverride }))];
  if (phases.some(p => (p.wolfShare ?? 0) > 0)) kinds.add('wolf');
  if (phases.some(p => (p.boarShare ?? 0) > 0)) kinds.add('boar');
  return kinds;
}

/**
 * The kinds an arena brings as a run plays it (`roster` — the node's roster over the template, rosters.ts `withRoster`): a
 * pool roster replaces the newcomers and both shares (the start enemies stay), a role adds its kinds.
 */
export function arenaKinds(arena: string, roster?: string): Set<string> {
  try {
    const template = arenaTemplate(arena), def = roster !== undefined ? rosterDef(roster) : undefined;
    if (!def) return templateKinds(template);
    const kinds = def.mode === 'replace' ? new Set(template.enemies.map(e => e.kind ?? 'basic')) : templateKinds(template);
    for (const kind of rosterKinds(def)) kinds.add(kind);
    return kinds;
  } catch { return new Set(); }
}
