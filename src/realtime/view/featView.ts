/**
 * Task 16 «Подвиги» (design 13–14.10.2026; sim/feat.ts, run/rtRun.ts, docs/realtime-slice.md «Подвиги»): the view of a feat.
 * - The node card: one line «Подвиг: продержись 30 с после целей → 3 ресурса» (an event node: «Подвиг, если будет бой: …»); the
 *   resources by number only — their kinds show on the fight result, at the rest and at the merchant.
 * - The fight HUD: a short line by the timer — «Подвиг 12/30 с», «Подвиг 240/800»; done — «Подвиг ✓» (and a sound, main.ts).
 * - The open door: while the feat is not done, the same small line stands by the door (over the bag's number), so leaving now is
 *   seen to leave it undone (`FeatDoorView`).
 * - The result screen: its own row «Подвиг» (design 14.10.2026: the bag and the feat — a row each, always): «+3 — 3 Роса»,
 *   «талисман на выбор», grey «не выполнен — 240/800».
 * Drawing only: every number is the sim's (`featProgress`, `featResult`) or the run's (`rtNodeFeat`, `rtFeatKinds`).
 */
import { Container, Text } from 'pixi.js';
import { featProgress, type FeatKind, type FeatProgress } from '../sim/feat';
import type { World } from '../sim/world';
import { RESOURCE_KINDS, RESOURCES } from '../forest/resources';
import type { ResourceKind } from '../forest/types';
import type { RtFeat, RtFeatReward } from '../run/rtRun';
import { BAG_SIZE, BagView } from './bagView';

/** «1 ресурс», «3 ресурса», «5 ресурсов». */
function resourcesWord(n: number): string {
  const tens = n % 100, ones = n % 10;
  return `${n} ${tens >= 11 && tens <= 14 ? 'ресурсов' : ones === 1 ? 'ресурс' : ones >= 2 && ones <= 4 ? 'ресурса' : 'ресурсов'}`;
}
/** «1 очко», «2 очка», «800 очков». */
function pointsWord(n: number): string {
  const tens = n % 100, ones = n % 10;
  return `${n} ${tens >= 11 && tens <= 14 ? 'очков' : ones === 1 ? 'очко' : ones >= 2 && ones <= 4 ? 'очка' : 'очков'}`;
}

/** What the feat asks: «набери 800 очков», «продержись 30 с после целей», «продержись 60 с на арене». */
export function featGoalText(kind: FeatKind, n: number): string {
  return kind === 'score' ? `набери ${pointsWord(n)}` : kind === 'afterGoals' ? `продержись ${n} с после целей` : `продержись ${n} с на арене`;
}
/** Its reward, shown in advance: «3 ресурса» (the number only), «талисман на выбор». */
export function featRewardText(reward: RtFeatReward): string {
  return 'talisman' in reward ? 'талисман на выбор' : resourcesWord(reward.resources);
}
/** The node card's line: its label («Подвиг»; an event node — «Подвиг, если будет бой»: an event may have no fight) and text. */
export function featCardLine(feat: RtFeat, event: boolean): { label: string; text: string } {
  return { label: event ? 'Подвиг, если будет бой' : 'Подвиг', text: `${featGoalText(feat.kind, feat.n)} → ${featRewardText(feat.reward)}` };
}

/** The HUD line (and the door's): «Подвиг 240/800», «Подвиг 12/30 с»; done — «Подвиг ✓». Seconds are whole (floored). */
export function featHudText(p: FeatProgress): string {
  if (p.done) return 'Подвиг ✓';
  return p.kind === 'score' ? `Подвиг ${p.value}/${p.target}` : `Подвиг ${Math.floor(p.value + 1e-9)}/${p.target} с`;
}
/** The HUD line's tooltip: the whole goal; an `afterGoals` feat before the goals says its seconds have not started. */
export function featHudTitle(p: FeatProgress): string {
  return `Подвиг: ${featGoalText(p.kind, p.target)}${p.waiting ? ' (счёт пойдёт после целей)' : ''}`;
}

/**
 * The result screen's row «Подвиг»: done and won — the resources with their kinds («+3 — 2 Роса, 1 Смола») or «талисман на выбор»;
 * done but lost — «выполнен, но поражение — 0»; not done — «не выполнен — 240/800» (`grey`). Null — the fight had no feat.
 */
export function featResultRow(feat: { kind: FeatKind; n: number; reward: RtFeatReward } | null, result: { done: boolean; value: number } | null,
  won: boolean, kinds: readonly ResourceKind[]): { text: string; grey: boolean } | null {
  if (!feat || !result) return null;
  if (!result.done) {
    const value = feat.kind === 'score' ? `${result.value}/${feat.n}` : `${Math.floor(result.value + 1e-9)}/${feat.n} с`;
    return { text: `не выполнен — ${value}`, grey: true };
  }
  if (!won) return { text: 'выполнен, но поражение — 0', grey: true };
  if ('talisman' in feat.reward) return { text: 'талисман на выбор', grey: false };
  const counts = RESOURCE_KINDS.map(kind => [kind, kinds.filter(k => k === kind).length] as const).filter(([, n]) => n > 0);
  return { text: `+${kinds.length} — ${counts.map(([kind, n]) => `${n} ${RESOURCES[kind].label}`).join(', ')}`, grey: false };
}

/** Px between the bag's number and the feat's line over it (the bag's texts of a step start beyond both). */
export const FEAT_DOOR_GAP = 24;

/**
 * The small feat line by the open door while the feat is not done: in the bag's column beside the door — over the bag's number
 * (under it by the arena's top edge), or in the number's place when the fight has no bag.
 */
export class FeatDoorView {
  readonly layer = new Container();
  private readonly label = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 'bold', fill: 0xd9cfa8, stroke: { color: 0x200c08, width: 4 } } });
  /** Tests read it: what the door line drew in the last frame. */
  readonly shown = { visible: false, text: '', x: 0, y: 0 };

  constructor(private readonly unit: number) {
    this.layer.addChild(this.label);
    this.layer.visible = false;
  }

  draw(world: World, bagShown: boolean): void {
    const p = featProgress(world), at = BagView.spot(world);
    const visible = !!p && !p.done && !!at && world.status === 'playing' && world.stage === 'greed';
    this.shown.visible = visible;
    this.layer.visible = visible;
    if (!visible) { this.shown.text = ''; return; }
    const u = this.unit, s = u * BAG_SIZE, x = at!.x * u, y = at!.y * u, under = BagView.under(world), text = featHudText(p!);
    if (this.label.text !== text) this.label.text = text;
    this.label.anchor.set(0.5, under ? 0 : 1);
    const lift = bagShown ? FEAT_DOOR_GAP : 0;
    this.label.position.set(x, under ? y + s * 1.8 + lift : y - s * 1.1 - lift);
    Object.assign(this.shown, { text, x: at!.x, y: at!.y });
  }

  reset(): void {
    Object.assign(this.shown, { visible: false, text: '' });
    this.layer.visible = false;
  }
}
