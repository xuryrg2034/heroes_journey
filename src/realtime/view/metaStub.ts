/**
 * Tasks 36–37: a STAND-IN for the profile's meta (core, branch core/meta3637) so that the view's screens play before it lands.
 * The same contract (`MetaSource`, `MetaEnd`); the numbers follow the spec (docs/design-notes/tasks-36-37-meta.md) roughly — the
 * real ones are core's. Its own key `ashen-oath-rt-meta-stub` (dropped when core's profile replaces this file). Nothing reaches a
 * run's flags: the start choice only picks the seed and the consumable shown.
 */
import { rtNode, rtReachedRow, rtResourceTotal, rtRunWon, type RtRunState } from '../run/rtRun';
import { runRow } from '../run/arenaPools';
import type { ItemKind } from '../sim/kit';
import { HEARTH_PRICES, META_PACKS, META_THRESHOLDS, type HearthState, type MetaEnd, type MetaSource, type MetaXpPart, type NpcId } from './metaModel';

const KEY = 'ashen-oath-rt-meta-stub';
interface StubState {
  xp: number; packs: string[]; record: { row: number; won: boolean } | null; stock: number;
  levels: Record<NpcId, number>; met: Record<NpcId, boolean>; runs: number; lines: Record<string, number>;
  ends: Record<string, MetaEnd>; last?: HearthState['last']; quest?: { npc: NpcId; id: string };
}
const empty = (): StubState => ({ xp: 0, packs: [], record: null, stock: 0, levels: { owl: 0, herb: 0, smith: 0 }, met: { owl: true, herb: false, smith: false }, runs: 0, lines: {}, ends: {} });

function load(): StubState {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v && typeof v === 'object' ? { ...empty(), ...v } : empty(); } catch { return empty(); }
}
function save(s: StubState): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be unavailable */ } }

const nextPackOf = (xp: number, packs: readonly string[]): MetaEnd['nextPack'] => {
  const p = META_PACKS.find(x => !packs.includes(x.id) && x.at > xp) ?? META_PACKS.find(x => !packs.includes(x.id));
  return p ? { id: p.id, title: p.title, at: p.at, size: p.items.length } : null;
};

export class MetaStub implements MetaSource {
  /** The end of a run (once per run: a repeated call returns the same). Null — a seeded run. */
  endRun(run: RtRunState, seen: readonly string[]): MetaEnd | null {
    if (run.seeded || !run.result) return null;
    const s = load(), key = `${run.seed}:${run.result.nodeId}`;
    if (s.ends[key]) return s.ends[key];
    const won = rtRunWon(run), rows = run.battles.map(b => rtNode(run, b.nodeId)?.row ?? 0), last = Math.max(0, ...rows);
    const parts: { id: MetaXpPart; xp: number; n?: number }[] = [];
    let battles = 0, elite = 0, jailer = 0, final = 0, feats = 0;
    run.battles.forEach(b => {
      if (b.feat?.done) feats++;
      if (!b.won) return;
      const node = rtNode(run, b.nodeId);
      if (node?.type === 'boss') { if (won && node.row === last) final++; else jailer++; }
      else if (node && ['hard', 'checkpoint', 'breakthrough'].includes(node.type)) elite++;
      else battles++;
    });
    if (battles) parts.push({ id: 'battles', xp: battles * 5, n: battles });
    if (elite) parts.push({ id: 'elite', xp: elite * 10, n: elite });
    if (jailer) parts.push({ id: 'jailer', xp: jailer * 30 });
    if (final) parts.push({ id: 'final', xp: final * 50 });
    if (feats) parts.push({ id: 'feats', xp: feats * 5, n: feats });
    if (won) parts.push({ id: 'victory', xp: 25 });
    const base = parts.reduce((a, p) => a + p.xp, 0), ash = run.ash ?? 0, withAsh = Math.floor(base * (1 + 0.1 * ash));
    if (withAsh > base) parts.push({ id: 'ash', xp: withAsh - base });
    const before = s.xp;
    let after = before + withAsh;
    // At most one pack a run; the rest is cut to «next threshold − 1».
    const crossed = META_THRESHOLDS.filter(t => before < t && after >= t);
    let pack: MetaEnd['pack'] = null;
    if (crossed.length) {
      const p = META_PACKS.find(x => x.at === crossed[0])!;
      pack = { id: p.id, title: p.title, items: p.items };
      s.packs.push(p.id);
      const next = META_THRESHOLDS.find(t => t > crossed[0]);
      if (next !== undefined) after = Math.min(after, next - 1);
    }
    // The record in run rows (1…), as the run-end facts write «Ряд N».
    const row = runRow(won ? last : rtReachedRow(run)), rec = { row, won };
    const beaten = !s.record || (won && !s.record.won) || (!s.record.won && row > s.record.row);
    const resources = rtResourceTotal(run), n = Math.min(20, won ? resources : Math.max(Math.floor(resources / 2), Math.min(resources, 6)));
    const end: MetaEnd = {
      hero: 'cat', xp: { gained: withAsh, parts, before, after }, thresholds: [...META_THRESHOLDS], pack, nextPack: nextPackOf(after, s.packs),
      record: { before: s.record, after: beaten ? rec : s.record ?? rec, beaten }, carry: { n, share: won ? 1 : 0.5, cap: 20, resources },
      stock: { before: s.stock, after: s.stock + n },
    };
    const death = run.battles.find(b => b.death)?.death;
    const cause = !death ? undefined : death.enemy === 'jailer' ? 'jailer' : death.enemy === 'archer' ? 'archer' : death.enemy === 'sapper' ? 'sapper' : death.source === 'fire' ? 'fire' : 'crowd';
    Object.assign(s, { xp: after, record: end.record.after, stock: end.stock.after, runs: s.runs + 1, last: { won, row, beaten, ...cause ? { cause } : {}, ...pack ? { pack: true } : {} } });
    if (s.runs >= 3 && !s.met.herb) s.met.herb = true;
    else if (s.runs >= 6 && !s.met.smith) s.met.smith = true;
    void seen;
    s.ends[key] = end;
    save(s);
    return end;
  }

  hearthOpen(): boolean { return load().runs > 0; }

  hearth(): HearthState {
    const s = load();
    return { stock: s.stock, levels: s.levels, met: s.met, xp: s.xp, thresholds: [...META_THRESHOLDS], nextPack: nextPackOf(s.xp, s.packs), record: s.record, seen: [], lines: s.lines, ...s.quest ? { quest: s.quest } : {}, ...s.last ? { last: s.last } : {} };
  }

  buy(npc: NpcId, level: number): { ok: true } | { ok: false; need: number; have: number } {
    const s = load(), price = HEARTH_PRICES[level - 1];
    if (price === undefined || level >= 3 || s.levels[npc] !== level - 1) return { ok: false, need: price ?? 0, have: s.stock };
    if (s.stock < price) return { ok: false, need: price, have: s.stock };
    s.stock -= price; s.levels[npc] = level; save(s);
    return { ok: true };
  }

  start(seed: number): { maps?: number[]; items?: ItemKind[] } {
    const s = load(), maps = s.levels.owl >= 1 ? Array.from({ length: s.levels.owl + 1 }, (_, i) => (Math.imul(seed + i * 7919, 2654435761) >>> 0)) : undefined;
    // Марфа's consumable comes with core (the run's `hearth` flag): the stand-in offers no choice that would do nothing.
    const items: ItemKind[] | undefined = undefined;
    return { ...maps ? { maps } : {}, ...items ? { items } : {} };
  }

  markLine(id: string): void { const s = load(); s.lines[id] = (s.lines[id] ?? 0) + 1; save(s); }
}
