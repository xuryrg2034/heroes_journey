import { Container, Graphics, Text } from 'pixi.js';
import { summarizeDamageEffects, type DamageEffects } from '../game/damageEffects';

/** One compact row for every creature, including shared-footprint sprites. */
export function addDamageEffectBadges(parent: Container, effects: DamageEffects | undefined, y = 34): void {
  const status = summarizeDamageEffects(effects);
  const active = [
    { count: status.burning, mark: 'Г', color: 0xe28a5b, background: 0x583526 },
    { count: status.poison, mark: 'Я', color: 0xb6d884, background: 0x384b2c },
    { count: status.bleeding, mark: 'К', color: 0xe19a9c, background: 0x593638 },
  ].filter(badge => badge.count > 0);
  active.forEach((badge, index) => {
    const x = (index - (active.length - 1) / 2) * 24;
    const tile = new Graphics().roundRect(x - 11, y - 7, 22, 14, 3)
      .fill(badge.background).stroke({ color: badge.color, width: 1 });
    const label = new Text({ text: `${badge.mark}${badge.count}`, style: {
      fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 'bold', fill: badge.color,
    } });
    label.anchor.set(0.5); label.position.set(x, y);
    parent.addChild(tile, label);
  });
}
