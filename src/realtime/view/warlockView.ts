/**
 * Task 55 stage Д «Колдун v0», part ui (design 17.10.2026, docs/design-notes/task-55-castle-step1a.md, 6 and 11; docs/realtime-elite-behaviors.md,
 * «Замок: Колдун v0»): the view of the castle's final boss. Everything is read from the sim (`warlockState`, `warlockLinkDrop`, the events
 * `warlockCharm`, `warlockWindow`, `warlockShift`); nothing here changes the world and no rule is copied:
 * - the core — a large drawing over its grey disc, floating (a slow bob); in his window («сбит») the dazed drawing, a lemon glow round the
 *   contour while the window takes the hit (it blinks in the last half second) and a whole-second count over the head (the art is never
 *   recoloured); the plate pips under his right foot as the Troll's;
 * - «Под чарами» — a violet beam from the core to his wardrobe (magic: not a chain colour, not the garrison's rope) while the charm holds;
 *   it snaps when the charm falls (`warlockCharm` `broken`): the halves shrink to their ends and shards fall;
 * - the candles — four on the floor (`ArenaTemplate.warlock.candles`); the target one blooms by the sim's `shift.progress` (the flame
 *   grows, a violet ring closes in), the core's haze gathers round him while the sign burns; on the arrival smoke rises from the old
 *   candle and a flash opens at the new one;
 * - «звон» (a hit that does not land: the charm, a closed window, a spent one) — a short grey spark at the core, no text; the window's
 *   landed hit — a lemon ring; a window that ended with the core in the drawn chain — a white ring on each link that dropped out, and in
 *   the window's last second (the sim's `warlockLinkDrop`, the same as `planChain(...).warlockDrop`) those links blink.
 * Coordinates are arena pixels (`unit` per arena unit); `r` is the drawing radius of a body in px.
 */
import { BOSS_ART } from '../sim/bossArt';
import { countPlace, type VisibleArea } from './edgeMarkers';
import { ColorMatrixFilter, Container, Graphics, Text } from 'pixi.js';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import { eliteArmorView } from '../sim/elites';
import { WARLOCK, warlockCore, warlockLinkDrop, warlockState } from '../sim/enemies/warlock';
import type { Vec } from '../sim/geometry';
import type { Enemy, World, WorldEvent } from '../sim/world';
import { drawPlatePips, ELITE_LEMON } from './eliteView';
import { corePips, windowCount } from './trollView';

const NAVY = 0x18232d;
const SPARK_GREY = 0xc7ccd1;
/** The magic of the castle: the beam, the ring and the haze (not a colour of the chain). */
export const MAGIC = 0xa070ff;
const MAGIC_DARK = 0x4a2f8a;
const FLAME = 0xffd36a, WAX = 0xe9e2cc, STONE = 0x6c6558;
const ROBE = 0x4a3563, HAT = 0x2c2748, SKIN = 0xd9d2a8, STAFF = 0x7a5a3f;

/** The core's drawing: its box side in body radii (about 2 heroes tall), the feet's place. */
export const WARLOCK_ART = BOSS_ART.warlock.side;
export const WARLOCK_FEET = BOSS_ART.warlock.feet ?? 0;
/** Real seconds the effects last. */
export const SPARK_LIFE = 0.25, HIT_LIFE = 0.35, UNLINK_LIFE = 0.3, SNAP_LIFE = 0.6, SMOKE_LIFE = 0.9, ARRIVE_LIFE = 0.5;
/** Arena units: the beam's ends over the floor (the core's middle, the wardrobe's top). */
const BEAM_FROM_LIFT = 0.55, BEAM_TO_LIFT = 0.35;

/** The ink of a marked enemy's reticle: the charm's violet on the warlock while he is `spellbound` (not to be struck), null — the common lemon. */
export const reticleInk = (world: World, e: Pick<Enemy, 'kind'>): number | null => e.kind === WARLOCK && warlockState(world)?.spellbound ? MAGIC : null;

export const isWarlockKind = (kind: string): boolean => kind === WARLOCK;
/** The core's HP plaque: by the drawing's head, on the right (body-local px). */
export const warlockBadgeAt = (r: number): { x: number; y: number } => ({ x: r * WARLOCK_ART * 0.36, y: r * (WARLOCK_FEET - WARLOCK_ART * 0.88) });

// ---- The drawings ----

/** The core's drawing: the normal one, the dazed one («сбит», in the window) and a copy of the dazed one for the glow; the feet at the root's origin. */
export interface WarlockArt { root: Container; art: Container; dazed: Container; glow: Container; filter: ColorMatrixFilter | null; base: number }

function glowFilter(): ColorMatrixFilter | null {
  try { return new ColorMatrixFilter(); } catch { return null; }
}

/** A thin warlock under a huge crooked hat, a candle on his staff; `dazed` — the hat aside, spirals for eyes, the candle out. */
function procWarlock(r: number, dazed: boolean): Container {
  const root = new Container(), h = r * WARLOCK_ART, w = h * 0.2;
  const body = new Graphics();
  body.poly([-w, -h * 0.1, -w * 0.6, 0, -w * 0.2, -h * 0.07, w * 0.2, 0, w * 0.6, -h * 0.07, w, -h * 0.1, w * 0.7, -h * 0.5, -w * 0.7, -h * 0.5]).fill(ROBE).stroke({ color: NAVY, width: 4, join: 'round' });
  body.ellipse(0, -h * 0.58, w * 0.5, h * 0.09).fill(SKIN).stroke({ color: NAVY, width: 3 });
  if (dazed) {
    for (const sx of [-1, 1]) body.circle(sx * w * 0.2, -h * 0.6, r * 0.2).stroke({ color: NAVY, width: 2.5 }).circle(sx * w * 0.2, -h * 0.6, r * 0.09).stroke({ color: NAVY, width: 2 });
    body.moveTo(-w * 0.22, -h * 0.53).quadraticCurveTo(0, -h * 0.5, w * 0.22, -h * 0.54).stroke({ color: NAVY, width: 3, cap: 'round' });
  } else {
    for (const sx of [-1, 1]) body.circle(sx * w * 0.2, -h * 0.6, r * 0.16).fill(0xfff2a0).stroke({ color: NAVY, width: 2 });
    body.moveTo(-w * 0.3, -h * 0.545).quadraticCurveTo(0, -h * 0.5, w * 0.3, -h * 0.55).stroke({ color: NAVY, width: 3, cap: 'round' });
  }
  const staff = new Graphics();
  staff.roundRect(w * 1.25, -h * 0.72, h * 0.03, h * 0.72, 3).fill(STAFF).stroke({ color: NAVY, width: 2.5 });
  staff.roundRect(w * 1.17, -h * 0.82, h * 0.07, h * 0.12, 3).fill(WAX).stroke({ color: NAVY, width: 2.5 });
  if (!dazed) staff.poly([w * 1.205, -h * 0.82, w * 1.275, -h * 0.82, w * 1.24, -h * 0.93]).fill(FLAME).stroke({ color: NAVY, width: 2, join: 'round' });
  const hat = new Graphics();
  hat.ellipse(0, 0, w * 1.5, h * 0.05).fill(HAT).stroke({ color: NAVY, width: 4 });
  hat.poly([-w * 0.85, -h * 0.01, w * 0.75, -h * 0.01, w * 0.35, -h * 0.2, w * 0.7, -h * 0.34, -w * 0.05, -h * 0.26]).fill(HAT).stroke({ color: NAVY, width: 4, join: 'round' });
  hat.circle(-w * 0.1, -h * 0.1, r * 0.17).fill(0xd9b44a).stroke({ color: NAVY, width: 2 });
  hat.position.set(dazed ? w * 0.35 : 0, -h * (dazed ? 0.64 : 0.67)); hat.rotation = dazed ? 0.55 : -0.08;
  root.addChild(body, staff, hat);
  return root;
}

/** The core's drawing, its dazed one and the glow's copy of that. */
export function buildWarlock(r: number): WarlockArt {
  const root = new Container(), filter = glowFilter();
  const make = (id: 'warlock' | 'warlock-dazed', dazed: boolean, glow: boolean): Container => {
    const sprite = hasCharacterArt(id) ? characterSprite(id, r * WARLOCK_ART, r * WARLOCK_ART) : null;
    const node: Container = sprite ?? procWarlock(r, dazed);
    if (sprite) sprite.position.set(0, -sprite.height / 2);
    if (glow) { if (filter) node.filters = [filter]; node.scale.set(node.scale.x * (sprite ? 1.14 : 1.1), node.scale.y * (sprite ? 1.14 : 1.1)); node.alpha = 0; node.visible = false; }
    else if (dazed) node.visible = false;
    return node;
  };
  const art = make('warlock', false, false), dazed = make('warlock-dazed', true, false), glow = make('warlock-dazed', true, true);
  root.addChild(glow, art, dazed);
  const base = r * WARLOCK_FEET;
  root.position.set(0, base);
  if (filter) filter.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.4, 0, 0, 0, 1, 0];
  else (glow as Container & { tint: number }).tint = ELITE_LEMON;
  return { root, art, dazed, glow, filter, base };
}

// ---- The view ----

type FxKind = 'spark' | 'ring' | 'hit' | 'snap' | 'smoke' | 'arrive';
interface Fx { kind: FxKind; x: number; y: number; r: number; born: number; life: number; x1?: number; y1?: number }

export class WarlockView {
  readonly shown = {
    /** The core is drawn this frame (0/1), dazed (his window stands), its glow is lit, the count over the head ('' — none) and by his goal arrow. */
    core: 0, dazed: 0, glow: 0, count: '', edgeCount: '',
    /** The core is in the camera's view but the centre of his ring is under the HUD or the action bar (he gets the pointer: render.ts `bossCoreHidden`). */
    hud: 0,
    /** Where the window's count stands, in arena units (null — none). */
    countAt: null as { x: number; y: number } | null,
    /** The charm's beam drawn (0/1) and the id of the wardrobe it ends at (−1 none). */
    beam: 0, beamTo: -1,
    /** The candles drawn, the target one (−1 none) with its flame's size in arena units and the sign's fill 0…1, the core's haze drawn (0/1), the drawn chain's dropping core blinks (0/1). */
    candles: 0, target: -1, flame: 0, signProgress: 0, haze: 0, dropping: 0,
    /** Seen so far: «звон» sparks, the window's landed hits, windows opened, white rings of links dropped, beams snapped, signs lit, arrivals, smokes at the old candle. */
    sparks: 0, hits: 0, opens: 0, unlinks: 0, snaps: 0, marks: 0, arrivals: 0, smokes: 0,
  };
  /** Under the enemies: the candles and the beam. */
  readonly floor = new Container();
  /** Over the enemies: the count and the effects. */
  readonly layer = new Container();
  private readonly floorG = new Graphics();
  private readonly fxG = new Graphics();
  private fx: Fx[] = [];
  private countLabel: Text | null = null;
  private edgeLabel: Text | null = null;
  /** The dark plate under the count by the goal pointer (as under «далеко»): the count never lies on a body's disc. */
  private edgeBack: Graphics | null = null;
  /** The last places seen at the end of a frame: his wardrobe (the beam's far end when it breaks), the candle he stood at (the smoke rises there). */
  private lastWardrobe: Vec | null = null;
  private lastCandle: Vec | null = null;

  /** `unit` — arena pixels per unit (render.ts `UNIT`). */
  constructor(private readonly unit: number) { this.floor.addChild(this.floorG); this.layer.addChild(this.fxG); }

  beginFrame(): void {
    const s = this.shown;
    s.core = 0; s.hud = 0; s.countAt = null; s.dazed = 0; s.glow = 0; s.count = ''; s.beam = 0; s.beamTo = -1; s.candles = 0; s.target = -1; s.flame = 0; s.signProgress = 0; s.haze = 0; s.dropping = 0;
  }

  /** The new fight: no effects, no memory. */
  reset(): void {
    this.fx = []; this.lastWardrobe = null; this.lastCandle = null;
    this.fxG.clear(); this.floorG.clear();
    if (this.countLabel) this.countLabel.visible = false;
    if (this.edgeLabel) this.edgeLabel.visible = false;
    if (this.edgeBack) this.edgeBack.visible = false;
    Object.assign(this.shown, { sparks: 0, hits: 0, opens: 0, unlinks: 0, snaps: 0, marks: 0, arrivals: 0, smokes: 0 });
  }

  /**
   * The sim's events of the frame, in order. «звон» sparks at the core; a landed hit in the window — a lemon ring; the links a window dropped —
   * a white ring each; the charm's end — the beam snaps; an arrival — smoke at the old candle and a flash at the new. Returns whether the
   * event was the warlock's (the rest go on to the common handlers).
   */
  onEvent(ev: WorldEvent, world: World, clock: number, r: number): boolean {
    const U = this.unit;
    if (ev.type === 'warlockCharm') {
      if (ev.action === 'block') this.spark(world, ev.x, ev.y, clock, r);
      else {
        const from = { x: ev.x * U, y: (ev.y - BEAM_FROM_LIFT) * U }, to = this.lastWardrobe;
        if (to) this.fx.push({ kind: 'snap', x: from.x, y: from.y, x1: to.x * U, y1: (to.y - BEAM_TO_LIFT) * U, r, born: clock, life: SNAP_LIFE });
        this.shown.snaps++;
      }
      return true;
    }
    if (ev.type === 'warlockWindow') {
      if (ev.action === 'open') this.shown.opens++;
      else if (ev.action === 'block') this.spark(world, ev.x, ev.y, clock, r);
      else if (ev.action === 'hit') { this.fx.push({ kind: 'hit', x: ev.x * U, y: (ev.y - 0.5) * U, r, born: clock, life: HIT_LIFE }); this.shown.hits++; }
      else if (ev.action === 'unlink') {
        for (const id of ev.dropped ?? []) {
          const e = world.enemies.find(x => x.id === id);
          if (e) { this.fx.push({ kind: 'ring', x: e.x * U, y: e.y * U, r: r + 6, born: clock, life: UNLINK_LIFE }); this.shown.unlinks++; }
        }
      }
      return true;
    }
    if (ev.type === 'warlockShift') {
      if (ev.action === 'mark') this.shown.marks++;
      else {
        const old = this.lastCandle;
        if (old) { this.fx.push({ kind: 'smoke', x: old.x * U, y: old.y * U, r, born: clock, life: SMOKE_LIFE }); this.shown.smokes++; }
        this.fx.push({ kind: 'arrive', x: ev.x * U, y: ev.y * U, r, born: clock, life: ARRIVE_LIFE });
        this.shown.arrivals++;
      }
      return true;
    }
    return false;
  }

  /** A short grey spark at the hide, towards the hero, no text. */
  private spark(world: World, x: number, y: number, clock: number, r: number): void {
    const U = this.unit, hero = world.hero, dx = hero.x - x, dy = hero.y - y, d = Math.hypot(dx, dy) || 1;
    this.fx.push({ kind: 'spark', x: (x + dx / d * 0.6) * U, y: (y - 0.9 + dy / d * 0.2) * U, r, born: clock, life: SPARK_LIFE });
    this.shown.sparks++;
  }

  /** The places of this frame's end: his wardrobe and the candle he stands at (the next frame's events draw from them). */
  note(world: World): void {
    const st = warlockState(world);
    if (!st) return;
    const ward = st.wardrobe === null ? undefined : world.enemies.find(e => e.id === st.wardrobe);
    if (ward) this.lastWardrobe = { x: ward.x, y: ward.y };
    const c = st.candles[st.candle];
    if (c) this.lastCandle = { x: c.x, y: c.y };
  }

  // ---- The floor: the candles and the beam ----

  drawFloor(world: World, clock: number): void {
    const g = this.floorG.clear(), st = warlockState(world), U = this.unit, s = this.shown;
    if (!st) return;
    s.candles = st.candles.length;
    st.candles.forEach((c, i) => {
      const x = c.x * U, y = c.y * U, target = st.shift?.candle === i, here = st.candle === i, p = target ? st.shift!.progress : 0;
      g.ellipse(x, y + 0.12 * U, 0.34 * U, 0.13 * U).fill({ color: 0x000000, alpha: 0.28 });
      g.ellipse(x, y + 0.08 * U, 0.26 * U, 0.1 * U).fill(STONE).stroke({ color: NAVY, width: 2.5 });
      g.roundRect(x - 0.1 * U, y - 0.3 * U, 0.2 * U, 0.38 * U, 0.04 * U).fill(WAX).stroke({ color: NAVY, width: 2.5 });
      const flame = (target ? 0.1 + 0.26 * p : here ? 0.1 : 0.08) * U, fy = y - 0.34 * U - flame;
      if (target) {
        // The sign: a halo grows and a violet ring closes in on the candle while the flame blooms.
        g.circle(x, y, (1.1 - 0.7 * p) * U).stroke({ color: MAGIC, width: 3, alpha: 0.35 + 0.55 * p });
        g.circle(x, y - 0.3 * U, (0.5 + 0.4 * p) * U).fill({ color: FLAME, alpha: 0.12 + 0.2 * p });
        s.target = i; s.flame = flame / U; s.signProgress = p;
      } else if (here) g.circle(x, y - 0.3 * U, 0.4 * U).fill({ color: MAGIC, alpha: 0.12 });
      g.ellipse(x, fy + flame * 0.2, flame * 0.55, flame).fill(FLAME).stroke({ color: NAVY, width: 2 });
      g.ellipse(x, fy + flame * 0.45, flame * 0.22, flame * 0.45).fill({ color: 0xffffff, alpha: 0.7 });
    });
    const core = warlockCore(world), ward = st.wardrobe === null ? undefined : world.enemies.find(e => e.id === st.wardrobe);
    if (!core || !ward || !st.spellbound) return;
    this.beam(g, core.x * U, (core.y - BEAM_FROM_LIFT) * U, ward.x * U, (ward.y - BEAM_TO_LIFT) * U, clock, 1);
    s.beam = 1; s.beamTo = ward.id;
  }

  /** A wavy violet beam with beads running to the wardrobe; `k` fades it. */
  private beam(g: Graphics, x0: number, y0: number, x1: number, y1: number, clock: number, k: number): void {
    const N = 16, dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, amp = 0.12 * this.unit;
    const at = (t: number): { x: number; y: number } => { const w = Math.sin(t * Math.PI) * Math.sin(t * 14 - clock * 7) * amp; return { x: x0 + dx * t + nx * w, y: y0 + dy * t + ny * w }; };
    for (const [width, color, alpha] of [[22, MAGIC, 0.16], [13, NAVY, 0.6], [8, MAGIC, 1], [3, 0xe9dcff, 0.95]] as const) {
      const a = at(0); g.moveTo(a.x, a.y);
      for (let i = 1; i <= N; i++) { const p = at(i / N); g.lineTo(p.x, p.y); }
      g.stroke({ color, width, alpha: alpha * k, cap: 'round', join: 'round' });
    }
    for (let i = 0; i < 3; i++) {
      const t = (clock * 0.7 + i / 3) % 1, p = at(t);
      g.circle(p.x, p.y, 0.11 * this.unit).fill({ color: 0xffffff, alpha: 0.95 * k }).stroke({ color: MAGIC_DARK, width: 2.5, alpha: k });
    }
  }

  // ---- The core's frame ----

  /**
   * The core's frame: the drawing floats; in the window the dazed drawing replaces it, a lemon glow rings the contour while the window takes
   * the hit (it blinks in the last half second), the whole-second count over the head. `art` — `buildWarlock`, null when the body is not drawn.
   */
  syncCore(art: WarlockArt | null, world: World, clock: number, r: number, visible: boolean, area?: VisibleArea): void {
    const st = warlockState(world), s = this.shown;
    if (this.countLabel) this.countLabel.visible = false;
    if (!art || !st) return;
    const win = st.window, lit = !!win && win.open && !win.hit;
    s.core = 1; s.dazed = win ? 1 : 0;
    art.art.visible = !win; art.dazed.visible = !!win;
    art.root.position.y = art.base + (win ? 0 : Math.sin(clock * 2.2) * r * 0.07);
    const urgent = !!win && win.left < 0.5 && Math.floor(clock * 12) % 2 === 0, a = lit ? (0.8 + 0.2 * Math.sin(clock * 9)) * (urgent ? 0.4 : 1) : 0;
    art.glow.visible = lit; art.glow.alpha = a;
    if (lit) s.glow = 1;
    if (!lit || !win || !visible) return;
    const U = this.unit, label = this.countLabel ??= (() => {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 34, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: NAVY, width: 6 } } });
      text.anchor.set(0.5, 0.5);
      this.layer.addChild(text);
      return text;
    })();
    s.count = windowCount(win.left);
    label.text = s.count;
    label.style.fill = win.left <= 1 ? 0xff8a6a : 0xfff2c4;
    const at = { x: st.x * U - r * WARLOCK_ART * 0.4, y: st.y * U - r * WARLOCK_ART * 0.5 };
    const put = area ? countPlace(at, { x: st.x * U, y: st.y * U }, r * 1.4, area, 18) : at;
    label.position.set(put.x, put.y);
    label.visible = true;
    s.countAt = { x: put.x / U, y: put.y / U };
  }

  /** The count by the core's goal arrow while the core is off screen (the window is seen wherever the hero is). */
  drawEdge(world: World, goal: { x: number; y: number; angle: number } | undefined, coreSeen: boolean, parent: Container): void {
    const st = warlockState(world), s = this.shown, win = st?.window;
    s.edgeCount = '';
    if (this.edgeLabel) this.edgeLabel.visible = false;
    if (this.edgeBack) this.edgeBack.visible = false;
    if (!win || !win.open || win.hit || !goal || coreSeen) return;
    const label = this.edgeLabel ??= (() => {
      const text = new Text({ text: '', style: { fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 'bold', fill: 0xfff2c4, stroke: { color: NAVY, width: 5 } } });
      text.anchor.set(0.5, 0.5);
      parent.addChild(text);
      return text;
    })();
    s.edgeCount = windowCount(win.left);
    label.text = s.edgeCount;
    label.style.fill = win.left <= 1 ? 0xff8a6a : 0xfff2c4;
    label.position.set(goal.x - Math.cos(goal.angle) * 30, goal.y - Math.sin(goal.angle) * 30);
    const back = this.edgeBack ??= (() => { const g = new Graphics(); parent.addChildAt(g, Math.max(0, parent.getChildIndex(label))); return g; })();
    back.clear().roundRect(label.position.x - 17, label.position.y - 17, 34, 34, 8).fill({ color: 0x0f1720, alpha: 0.88 }).stroke({ color: 0x55616e, width: 2 });
    back.visible = true;
    label.visible = true;
  }

  // ---- Over the enemies ----

  /**
   * Over the bodies (`g` — the elite layer): the core's plate pips, the dropping links' blink, the haze round the core while the sign burns;
   * then the running effects (`fxG`). One call a frame, after the enemies are placed.
   */
  drawOver(g: Graphics, world: World, clock: number, r: number, px: number, sees: (e: { x: number; y: number }) => boolean): void {
    const U = this.unit, st = warlockState(world), s = this.shown, core = warlockCore(world), fxG = this.fxG;
    fxG.clear();
    if (!st && this.countLabel) this.countLabel.visible = false;
    if (core && st) {
      const armor = eliteArmorView(core);
      if (armor && sees(core)) { const at = corePips(core.x * U, core.y * U, r); drawPlatePips(g, at.x, at.y, at.R, armor, 0, px, true); }
      // The window's last second with the core in the drawn chain: the links that will drop blink (the sim's own list).
      const drop = warlockLinkDrop(world, world.chain);
      if (drop && st.window?.open && drop.left < 1 && Math.floor(clock * 8) % 2 === 0) {
        for (const l of world.chain.slice(drop.index)) {
          const e = l.kind === 'enemy' ? world.enemies.find(x => x.id === l.id) : undefined;
          if (e) g.circle(e.x * U, e.y * U, r + 7).stroke({ color: 0xff8a6a, width: 4, alpha: 0.95 });
        }
        s.dropping = 1;
      }
      if (st.shift && sees(core)) {
        // The haze: violet wisps circle the core and thicken with the sign.
        const p = st.shift.progress;
        for (let i = 0; i < 6; i++) {
          const a = clock * 2.4 + i * Math.PI / 3, rad = r * (1.2 + 0.5 * Math.sin(clock * 3 + i)), x = core.x * U + Math.cos(a) * rad, y = (core.y - 0.3) * U + Math.sin(a) * rad * 0.6;
          fxG.circle(x, y, r * (0.22 + 0.18 * p)).fill({ color: MAGIC, alpha: 0.18 + 0.3 * p });
        }
        s.haze = 1;
      }
    }
    this.fx = this.fx.filter(f => clock - f.born < f.life);
    for (const f of this.fx) this.drawFx(fxG, f, 1 - (clock - f.born) / f.life, clock);
  }

  private drawFx(g: Graphics, f: Fx, k: number, clock: number): void {
    const U = this.unit;
    if (f.kind === 'spark') {
      const R = f.r * (0.5 + 0.5 * (1 - k));
      for (const [w, color] of [[6, NAVY], [3, SPARK_GREY]] as const) {
        for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a); g.moveTo(f.x + c * R * 0.3, f.y + sn * R * 0.3).lineTo(f.x + c * R, f.y + sn * R); }
        g.stroke({ color, width: w, alpha: k, cap: 'round' });
      }
    } else if (f.kind === 'ring') {
      g.circle(f.x, f.y, f.r * (1 + 0.5 * (1 - k))).stroke({ color: 0xffffff, width: 5, alpha: 0.9 * k });
    } else if (f.kind === 'hit') {
      g.circle(f.x, f.y, f.r * (1.2 + 1.4 * (1 - k))).stroke({ color: ELITE_LEMON, width: 6, alpha: k });
      g.circle(f.x, f.y, f.r * (1.2 + 1.4 * (1 - k))).fill({ color: ELITE_LEMON, alpha: 0.2 * k });
    } else if (f.kind === 'snap' && f.x1 !== undefined && f.y1 !== undefined) {
      // The halves shrink to their ends; the shards of the magic fall.
      const t = 1 - k, keep = 0.45 * k;
      for (const [fromX, fromY, toX, toY] of [[f.x, f.y, f.x1, f.y1], [f.x1, f.y1, f.x, f.y]] as const) {
        g.moveTo(fromX, fromY).lineTo(fromX + (toX - fromX) * keep, fromY + (toY - fromY) * keep).stroke({ color: MAGIC, width: 4, alpha: k, cap: 'round' });
      }
      for (let i = 0; i < 6; i++) {
        const u = (i + 0.5) / 6, x = f.x + (f.x1 - f.x) * u, y = f.y + (f.y1 - f.y) * u + t * t * 0.9 * U * (1 + (i % 3) * 0.3);
        g.poly([x - 4, y, x, y - 6, x + 4, y, x, y + 5]).fill({ color: MAGIC, alpha: k }).stroke({ color: NAVY, width: 1.5, alpha: k });
      }
    } else if (f.kind === 'smoke') {
      for (let i = 0; i < 5; i++) {
        const t = 1 - k, x = f.x + Math.sin(i * 2.3 + clock * 2) * 0.22 * U, y = f.y - 0.3 * U - t * (0.9 + i * 0.18) * U, rad = (0.14 + 0.3 * t) * U;
        g.circle(x, y, rad).fill({ color: 0x8c88a8, alpha: 0.5 * k });
      }
    } else if (f.kind === 'arrive') {
      g.circle(f.x, f.y, f.r * (0.8 + 2.2 * (1 - k))).stroke({ color: MAGIC, width: 6, alpha: k });
      g.circle(f.x, f.y, f.r * (0.6 + 1.2 * (1 - k))).fill({ color: ELITE_LEMON, alpha: 0.35 * k });
    }
  }
}
