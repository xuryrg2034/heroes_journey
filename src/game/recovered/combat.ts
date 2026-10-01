/** Exact ports of the recovered_combat.py rules the game still uses: healing allowance and the arrow's board bounds. */
import type { Entity } from './sharedtypes';
export function canHeal(player: Entity, hasChild122 = false): boolean { return player.power < player.max_power || hasChild122; }
export function canFireArrowHit(col: number, row: number, width: number, height: number): boolean { return col >= 0 && col < width && row >= 0 && row < height; }
