/**
 * The action bar (task 8a, design 13.10.2026): tiles of ~56 px at the bottom centre — «Пробел» (the jump) and «Q» (the spin)
 * with their energy price under the tile, then the consumables 1–4 with their count. A ready tile is bright; an ability short
 * of energy is dim and fills from the bottom as the energy comes (energy / price). An empty consumable slot is hidden. A tile
 * is clickable: the jump and a consumable that needs a point start aiming (the next click on the field), the spin and the
 * healing act at once. The name of each tile is its `title`.
 *
 * A view feature only: it reads the numbers main.ts hands it and calls back on a click; nothing here touches the world.
 */
import { ITEM_TITLES, SLOT_ITEMS, type ItemKind } from '../sim/kit';

export type TileId = 'jump' | 'spin' | ItemKind;

/** The glyphs (32×32, `currentColor` strokes in the art's language: thick round lines, flat fills). */
const GLYPHS: Readonly<Record<TileId, string>> = {
  jump: '<path d="M5 25 Q16 1 27 25" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M21.5 21.5 L27 25.5 L28.5 18.8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 28 H11 M21 28 H29" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/>',
  spin: '<path d="M16 5 A11 11 0 1 1 5.6 12.4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M3.2 6.6 L5.6 12.6 L11.6 10.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="3.2" fill="currentColor"/>',
  frost: '<g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M16 3 V29 M4.7 9.5 L27.3 22.5 M4.7 22.5 L27.3 9.5"/><path d="M12.5 5.5 L16 8.5 L19.5 5.5 M12.5 26.5 L16 23.5 L19.5 26.5" fill="none"/></g>',
  bomb: '<circle cx="14" cy="19" r="9.5" fill="currentColor"/><path d="M20 11 L23 8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M23 8 Q26 3 29 5" fill="none" stroke="#ffb347" stroke-width="2.2" stroke-linecap="round"/><circle cx="10.5" cy="15.5" r="2.4" fill="#ffffff" opacity=".45"/>',
  healing: '<path d="M12 3 H20 M13 3 V10 Q6 13 6 20 Q6 29 16 29 Q26 29 26 20 Q26 13 19 10 V3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M16 15 V25 M11 20 H21" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  fire: '<path d="M16 3 Q19 10 24 14 Q28 19 25 24 Q22 29 16 29 Q10 29 7 24 Q5 19 9 14 Q11 18 13 18 Q11 10 16 3 Z" fill="currentColor"/><path d="M16 17 Q19 21 19 24 Q19 27 16 27 Q13 27 13 24 Q13 21 16 17 Z" fill="#fff2c4" opacity=".8"/>',
};

/** The key in the tile's corner. */
const KEY_LABEL: Readonly<Record<'jump' | 'spin', string>> = { jump: 'Пробел', spin: 'Q' };

/** What a tile is for (its `title`). */
const ABILITY_TITLE: Readonly<Record<'jump' | 'spin', string>> = { jump: 'Прыжок: Пробел, затем клик в точку', spin: 'Круговой удар: Q' };

/** The consumables that act without a point (the hero): a click on the tile uses them at once. */
export const SELF_ITEMS: ReadonlySet<ItemKind> = new Set<ItemKind>(['healing']);

/** The fill of an ability short of energy: the share of its price there is now, 0…1 (1 — ready). */
export function energyFill(energy: number, cost: number): number {
  return cost <= 0 ? 1 : Math.max(0, Math.min(1, energy / cost));
}

export interface ActionBarState {
  energy: number;
  jumpCost: number;
  spinCost: number;
  jumpReady: boolean;
  spinReady: boolean;
  counts: Readonly<Record<ItemKind, number>>;
  /** The tile whose aim is on (the jump or a consumable), null — none. */
  aiming: TileId | null;
}

function tile(id: TileId, className: string, testId: string, title: string, key: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.tabIndex = -1;
  b.className = `rt-tile ${className}`;
  b.title = title;
  b.dataset.tile = id;
  b.setAttribute('data-testid', testId);
  b.innerHTML = `<span class="rt-tile-fill"></span><svg class="rt-tile-glyph" viewBox="0 0 32 32" aria-hidden="true">${GLYPHS[id]}</svg><kbd>${key}</kbd>`;
  return b;
}

export class ActionBar {
  readonly el: HTMLDivElement;
  readonly jump: HTMLButtonElement;
  readonly spin: HTMLButtonElement;
  /** The consumables' group (hidden in the prologue). */
  readonly items: HTMLDivElement;
  /** The consumable tiles in the order of `SLOT_ITEMS` (keys 1–4). */
  readonly slots: HTMLButtonElement[];
  private readonly costs: Record<'jump' | 'spin', HTMLElement>;
  private readonly countEls: HTMLElement[];

  constructor(onPress: (id: TileId) => void) {
    this.el = document.createElement('div');
    this.el.className = 'rt-actionbar';
    this.el.setAttribute('data-testid', 'action-bar');
    const abilities = document.createElement('div');
    abilities.className = 'rt-abilities';
    this.jump = tile('jump', 'rt-ability rt-tile-jump', 'ability-jump', ABILITY_TITLE.jump, KEY_LABEL.jump);
    this.spin = tile('spin', 'rt-ability rt-tile-spin', 'ability-spin', ABILITY_TITLE.spin, KEY_LABEL.spin);
    const cost = (b: HTMLButtonElement): HTMLElement => { const c = document.createElement('small'); c.className = 'rt-tile-cost'; b.appendChild(c); return c; };
    this.costs = { jump: cost(this.jump), spin: cost(this.spin) };
    abilities.append(this.jump, this.spin);
    this.items = document.createElement('div');
    this.items.className = 'rt-items';
    this.items.setAttribute('data-testid', 'items');
    this.countEls = [];
    this.slots = SLOT_ITEMS.map((kind, i) => {
      const b = tile(kind, `rt-item rt-empty rt-item-${kind}`, `item-${kind}`, `${ITEM_TITLES[kind]}: клавиша ${i + 1}`, String(i + 1));
      const n = document.createElement('b');
      n.className = 'rt-tile-count';
      n.textContent = '0';
      b.appendChild(n);
      b.hidden = true;
      this.countEls.push(n);
      this.items.appendChild(b);
      return b;
    });
    this.el.append(abilities, this.items);
    // A press must not take the focus (Space and Enter would press the tile again) nor reach the stage under it.
    this.el.addEventListener('pointerdown', event => { if ((event.target as HTMLElement).closest('.rt-tile')) event.preventDefault(); });
    this.el.addEventListener('click', event => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('.rt-tile');
      if (!b?.dataset.tile) return;
      b.blur();
      onPress(b.dataset.tile as TileId);
    });
  }

  update(s: ActionBarState): void {
    this.ability(this.jump, this.costs.jump, s.jumpCost, s.energy, s.jumpReady, s.aiming === 'jump');
    this.ability(this.spin, this.costs.spin, s.spinCost, s.energy, s.spinReady, false);
    SLOT_ITEMS.forEach((kind, i) => {
      const count = s.counts[kind] ?? 0, b = this.slots[i], n = this.countEls[i];
      if (n.textContent !== String(count)) n.textContent = String(count);
      b.hidden = count < 1;
      b.classList.toggle('rt-empty', count < 1);
      b.classList.toggle('rt-has', count >= 1);
      b.classList.toggle('rt-ready', count >= 1);
      b.classList.toggle('rt-on', s.aiming === kind);
    });
  }

  private ability(b: HTMLButtonElement, costEl: HTMLElement, cost: number, energy: number, ready: boolean, on: boolean): void {
    const text = `${cost} ⚡`;
    if (costEl.textContent !== text) costEl.textContent = text;
    b.classList.toggle('rt-ready', ready);
    b.classList.toggle('rt-on', on);
    b.style.setProperty('--fill', ready ? '0' : energyFill(energy, cost).toFixed(3));
  }
}
