/**
 * Tasks 36–37: the view's meta source over the profile (core, run/rtRunStorage.ts and run/rtMeta.ts): the camp's state with the
 * hero's experience, packs and record, the purchases, the start of a run from the camp, the lines' memory. The rules are core's;
 * this file only reshapes them into the view's forms (view/metaModel.ts). Task 49: the experience, the next pack and the record
 * are the chosen hero's (`heroChoice`); the heroes and the choice come from the profile.
 */
import { RT_HERO_TITLES, RT_META_THRESHOLDS } from '../run/metaCatalog';
import type { RtHearthStart } from '../run/rtMeta';
import type { RtProfileStore } from '../run/rtRunStorage';
import type { HearthState, MetaHero, MetaHeroId, MetaSource, NpcId } from './metaModel';

export class ProfileMeta implements MetaSource {
  constructor(private readonly profile: RtProfileStore) {}

  /** The camp exists after the first run's end (core keeps `meta.hearth` from then). */
  hearthOpen(): boolean { return !!this.profile.load().meta?.hearth; }

  heroes(): MetaHero[] {
    return this.profile.heroes().map(h => ({ id: h.id, title: RT_HERO_TITLES[h.id], open: h.open, chosen: h.chosen, xp: h.xp, ...h.ashBest ? { ashBest: h.ashBest } : {} }));
  }

  chooseHero(id: MetaHeroId): boolean { return this.profile.chooseHero(id); }

  hearth(): HearthState {
    const hero = this.profile.heroChoice(), view = this.profile.hearth(hero), own = this.profile.heroes().find(h => h.id === hero)!;
    return {
      hero, stock: view.stock, ...view.away ? { away: view.away as NpcId } : {}, done: { ...view.done } as HearthState['done'], levels: view.levels, gate3: view.gate3, met: { owl: true, herb: view.met.herb, smith: view.met.smith, gambler: view.met.gambler, monk: view.met.monk }, xp: own.xp, thresholds: [...RT_META_THRESHOLDS],
      nextPack: own.nextPack,
      record: own.record ? { row: own.record.row, won: own.record.won, ...own.record.level ? { level: own.record.level } : {}, ...own.record.wonLevel ? { wonLevel: own.record.wonLevel } : {} } : null, seen: view.seen, lines: view.lines,
      ...view.quest ? { quest: { npc: view.quest.npc as NpcId, id: view.quest.id } } : {},
      ...view.last ? { last: { ...view.last } } : {},
      ...view.self.herb || view.self.smith || view.self.gambler || view.self.monk ? { self: { ...view.self.herb ? { herb: true } : {}, ...view.self.smith ? { smith: true } : {}, ...view.self.gambler ? { gambler: true } : {}, ...view.self.monk ? { monk: true } : {} } } : {},
    };
  }

  buy(npc: NpcId, level: number): ReturnType<MetaSource['buy']> { return this.profile.buyHearth(npc, level); }

  /** The camp's start plan for a base seed (core's `hearthStart` of the chosen hero; its flags go into the run with the choice made). */
  start(seed: number): RtHearthStart { return this.profile.hearthStart(seed); }

  markLine(id: string): void { this.profile.markLine(id); }
}
