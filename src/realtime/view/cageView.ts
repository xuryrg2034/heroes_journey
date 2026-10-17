/**
 * Task 49 «Второй герой», spec 6.1: the cage of the Jailer's fight. Until Ведунья is freed (the profile's `freed` of the toad is empty), a
 * cage hangs in a corner of the Jailer's yard (public/art/characters/jailer-cage.png) with her inside (toad.png): she blinks and
 * flinches at the blows (and grumbles once a fight, `cage_1` of view/heroLines.ts, the host shows it as a speech bubble). DECORATION of the view: no object
 * of the world, no command, nothing in the hash; it stands inside the fight's frame at the fight's own scale (the camera is not moved).
 */
import { Container, Graphics } from 'pixi.js';
import { makeToad } from '../art/art';
import { characterSprite, hasCharacterArt } from '../art/characterAssets';
import type { World } from '../sim/world';


const NAVY = 0x14213d;
/** Arena units: the cage's size, and how far from the arena's right and bottom edge its hanging point and ground stand. */
const CAGE_W = 1.9, CAGE_H = 2.1;
/**
 * Where the cage hangs (arena units: the hanging point's x and the ground's y) in each arena of the Jailer's fight of a run
 * (`JAILER_RUN_ARENAS`): a place no newcomer comes to (checked by the spawn count of `toadLesson.spec.ts`: no spawn under the cage's
 * footprint in 20 seeds) and inside the first frame of the fight, where the camera opens on the boss (x 0–16, y 1.5–11.5).
 * «Тюремщик» — over the ravine at the yard's west edge (no shadow: nothing to cast it on); «Тюремщик» without the ravine (`jailer-yard`) —
 * the yard's east corner at the south palisade, clear of the gate and the boss's post.
 */
export const CAGE_PLACES: Readonly<Record<string, { x: number; y: number; shadow: boolean }>> = {
  jailer: { x: 2.4, y: 8.1, shadow: false },
  'jailer-yard': { x: 14.2, y: 8.9, shadow: true },
};
/** The cage's place in an arena: the table's, else the west side at 58 % of the height. */
export const cagePlace = (arenaId: string, height: number): { x: number; y: number; shadow: boolean } => CAGE_PLACES[arenaId] ?? { x: 2.4, y: height * 0.58, shadow: true };
/** Seconds between blinks, how long one blink lasts, how long a flinch lasts (real seconds). */
const BLINK_EVERY = 3.4, BLINK_LEN = 0.16, JOLT_LIFE = 0.55;

/** What the cage drew (tests read it through `snapshot().cage`). */
export interface CageShown {
  /** The cage stands in this frame, and where (arena units, the hanging point's x and the ground's y). */
  on: boolean; x: number; y: number;
  /** Blinks and flinches so far in this cage (a flinch per blow of the player: a `chainEnd` that killed). */
  blinks: number; jolts: number;
  /** Her sprite and the cage's sprite are the images (false — the drawn stand-ins). */
  art: boolean;
}

export class JailerCageView {
  readonly layer = new Container();
  private readonly shadow = new Graphics();
  private readonly body = new Container();
  private readonly lids = new Graphics();
  private toad: Container | null = null;
  private clock = 0;
  private joltLeft = 0;
  private blinkLeft = 0;
  private nextBlink = BLINK_EVERY * 0.6;
  private built = false;
  readonly shown: CageShown = { on: false, x: 0, y: 0, blinks: 0, jolts: 0, art: false };

  constructor() {
    this.layer.visible = false;
    this.layer.addChild(this.shadow, this.body);
  }

  get visible(): boolean { return this.shown.on; }

  /** The cage on or off (a new fight: off, then on where the fight is the Jailer's of a run whose Ведунья is not freed). */
  setOn(on: boolean): void {
    this.shown.on = on;
    this.layer.visible = on;
    this.joltLeft = 0; this.blinkLeft = 0; this.nextBlink = BLINK_EVERY * 0.6; this.clock = 0;
    this.shown.blinks = 0; this.shown.jolts = 0;
    if (on && !this.built) this.build();
  }

  /** Builds the picture once the images are known to be loaded or missing (the first frame the cage shows). */
  private build(): void {
    this.built = true;
    this.body.removeChildren();
    const toad = makeToad(0.86), cage = characterSprite('jailer-cage', CAGE_W * 72, CAGE_H * 72);
    this.toad = toad;
    toad.position.set(0, CAGE_H * 72 * 0.64);
    this.body.addChild(toad);
    if (cage) { cage.position.set(0, CAGE_H * 72 / 2); this.body.addChild(cage); }
    else this.drawBars();
    this.body.addChild(this.lids);
    this.shown.art = !!cage;
  }

  /** The stand-in: a dome of bars on a ring (no image of the cage). */
  private drawBars(): void {
    const g = new Graphics(), h = CAGE_H * 72, w = CAGE_W * 72 * 0.5;
    g.moveTo(0, -18).lineTo(0, 0).stroke({ color: 0x3a4152, width: 6 });
    g.ellipse(0, h * 0.88, w, 12).fill({ color: 0x4a3b2a, alpha: 0.8 }).stroke({ color: NAVY, width: 4 });
    for (const t of [-0.85, -0.45, 0, 0.45, 0.85]) g.moveTo(t * 4, 4).quadraticCurveTo(t * w * 1.2, h * 0.4, t * w, h * 0.88).stroke({ color: 0x3a4152, width: 6 });
    g.ellipse(0, h * 0.6, w * 0.98, 9).stroke({ color: 0x3a4152, width: 7 });
    g.ellipse(0, 6, 14, 7).fill(0x3a4152).stroke({ color: NAVY, width: 3 });
    g.roundRect(w * 0.55, h * 0.62, 18, 20, 4).fill(0x8a8f98).stroke({ color: NAVY, width: 3 });
    this.body.addChild(g);
  }

  /**
   * One frame: place the cage in the arena's corner, sway it, blink and flinch. `dt` real seconds while the fight is live.
   * The blows are read from the frame's events (before the host clears them): a flinch per `chainEnd` that killed.
   */
  update(world: World, dt: number): void {
    if (!this.shown.on) return;
    this.clock += dt;
    const place = cagePlace(world.arena.id, world.arena.height), x = place.x, ground = place.y;
    this.shown.x = x; this.shown.y = ground;
    for (const ev of world.events) if (ev.type === 'chainEnd' && ev.kills > 0) { this.joltLeft = JOLT_LIFE; this.shown.jolts++; }
    if (this.joltLeft > 0) this.joltLeft = Math.max(0, this.joltLeft - dt);
    const jolt = this.joltLeft / JOLT_LIFE;
    // The cage hangs by its top: the body is turned about that point, the ground's shadow stays.
    this.layer.position.set(x * 72, ground * 72);
    const top = -CAGE_H * 72 - 12;
    this.body.position.set(0, top);
    this.body.rotation = Math.sin(this.clock * 1.3) * 0.02 + Math.sin(this.clock * 24) * 0.09 * jolt * jolt;
    this.shadow.clear();
    if (place.shadow) this.shadow.ellipse(0, 4, CAGE_W * 72 * 0.34 * (1 - 0.1 * Math.sin(this.clock * 1.3)), 9).fill({ color: 0x050a07, alpha: 0.4 });
    // She flinches: a hop and a squash at the blow, then she settles.
    if (this.toad) {
      const base = CAGE_H * 72 * 0.64;
      this.toad.position.set(0, base - 7 * Math.sin(Math.min(1, jolt * 1.4) * Math.PI * 0.5) * jolt);
      this.toad.scale.set(1 + 0.05 * jolt, 1 - 0.07 * jolt);
    }
    // Blinks: heavy lids over the eyes (sprite: the two eyes; the stand-in: the same places) for a moment every few seconds.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blinkLeft = BLINK_LEN; this.nextBlink = BLINK_EVERY * (0.7 + 0.6 * Math.abs(Math.sin(this.clock * 3.1))); this.shown.blinks++; }
    this.lids.clear();
    if (this.blinkLeft > 0 && this.toad) {
      this.blinkLeft -= dt;
      const cy = CAGE_H * 72 * 0.64;
      for (const [ex, ey] of hasCharacterArt('toad') ? [[-5.4, -2.5], [8.4, -3.8]] as const : [[-8, -6], [8, -6]] as const)
        this.lids.ellipse(ex, cy + ey, 4.4, 2.4).fill(0x5f6b7b).stroke({ color: NAVY, width: 1.2 });
    }
  }
}
