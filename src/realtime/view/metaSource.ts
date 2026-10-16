/**
 * Tasks 36–37: the view's meta source over the profile (core, run/rtRunStorage.ts and run/rtMeta.ts): the camp's state with the
 * hero's experience, packs and record, the purchases, the start of a run from the camp, the lines' memory. The rules are core's;
 * this file only reshapes them into the view's forms (view/metaModel.ts).
 */
import { RT_HERO_ID, RT_META_PACKS, RT_META_THRESHOLDS } from '../run/metaCatalog';
import type { RtHearthStart } from '../run/rtMeta';
import type { RtProfileStore } from '../run/rtRunStorage';
import type { HearthState, MetaSource, NpcId } from './metaModel';

export class ProfileMeta implements MetaSource {
  constructor(private readonly profile: RtProfileStore) {}

  /** The camp exists after the first run's end (core keeps `meta.hearth` from then). */
  hearthOpen(): boolean { return !!this.profile.load().meta?.hearth; }

  hearth(): HearthState {
    const view = this.profile.hearth(), hero = this.profile.load().meta?.heroes[RT_HERO_ID];
    const xp = hero?.xp ?? 0, packs = hero?.packs ?? [];
    const next = RT_META_PACKS.find(p => !packs.includes(p.id));
    return {
      stock: view.stock, levels: view.levels, met: { owl: true, herb: view.met.herb, smith: view.met.smith }, xp, thresholds: [...RT_META_THRESHOLDS],
      nextPack: next ? { id: next.id, title: next.title, at: next.at, size: next.items.length } : null,
      record: hero?.record ? { row: hero.record.row, won: hero.record.won, ...hero.record.level ? { level: hero.record.level } : {} } : null, seen: view.seen, lines: view.lines,
      ...view.quest ? { quest: { npc: view.quest.npc as NpcId, id: view.quest.id } } : {},
      ...view.last ? { last: { ...view.last } } : {},
      ...view.self.herb || view.self.smith ? { self: { ...view.self.herb ? { herb: true } : {}, ...view.self.smith ? { smith: true } : {} } } : {},
    };
  }

  buy(npc: NpcId, level: number): { ok: true } | { ok: false; need: number; have: number } { return this.profile.buyHearth(npc, level); }

  /** The camp's start plan for a base seed (core's `hearthStart`; its flags go into the run with the choice made). */
  start(seed: number): RtHearthStart { return this.profile.hearthStart(seed); }

  markLine(id: string): void { this.profile.markLine(id); }
}
