/**
 * Task 55в «Замок» — the threats of the castle (threats.ts `wardrobe-topple`, `rook`; spec task-55 §10; docs/realtime-telemetry.md,
 * «Замок»). Node only: `npm run test:realtime-castle-threats`. Fights by journal commands on a quiet castle field, the threat tracker
 * watching every tick: «Падение шкафа» stood in — hit, stepped aside — dodged; «Удар ладьи» stood on — hit, stepped off — dodged, a
 * wardrobe put on the axis during the windup — dodged by cover. Seeds `Math.imul(k, 2654435761) >>> 0`.
 */
import { registerArena } from '../sim/arenas';
import type { Command } from '../sim/commands';
import { ROOK, ROOK_HP, WARDROBE, rookLine, wardrobeTopple } from '../sim/enemies/castle';
import { wall, type Vec } from '../sim/geometry';
import { defaultParams } from '../sim/params';
import { Simulation, SIM_DT } from '../sim/simulation';
import type { World } from '../sim/world';
import { ThreatTracker, type ThreatWarning } from './threats';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`ok - ${name}`); }
const seedOf = (k: number): number => Math.imul(k, 2654435761) >>> 0;
const ticksOf = (seconds: number): number => Math.round(seconds / SIM_DT);

const FIELD = 'tlm-castle-field';
registerArena({ id: FIELD, name: 'Поле замка (телеметрия)', summary: 'Тест угроз замка', goal: 'kills', killGoal: 999, width: 24, height: 14, heroStart: { x: 12, y: 7 },
  obstacles: [wall(22, 0, 2, 14)], buttons: [], door: { x: 1, y: 0.7 }, enemies: [], castle: true });

/** A quiet field (nobody comes, nobody walks, no grace window), the tracker watching. */
class Field {
  readonly sim: Simulation; readonly threats: ThreatTracker;
  constructor(k: number) {
    const p = defaultParams();
    p.baseFloor = 0; p.baseIntervalMin = 1e6; p.baseIntervalMax = 1e6; p.speedSpread = 0; p.contactDamage = 0; p.heroHp = 99; p.hitstop = false; p.enemySpeed = 0;
    p.invulnerability = 0; p.chainShield = 0;
    this.sim = new Simulation({ arena: FIELD, params: p, seed: seedOf(k), record: true });
    this.cmd({ t: 'clear', keepMarked: false });
    this.threats = new ThreatTracker(this.sim.world);
  }
  get world(): World { return this.sim.world; }
  cmd(c: Command): unknown { return this.sim.command(c); }
  place(at: Vec, kind: string, hp = 0): number { return this.cmd({ t: 'place', x: at.x, y: at.y, color: 0, hp, kind }) as number; }
  run(seconds: number, until: (w: World) => boolean = () => false): void {
    for (let i = 0; i < ticksOf(seconds) && this.world.status === 'playing'; i++) { this.sim.tick(); this.threats.tick(this.world); this.world.events.length = 0; if (until(this.world)) break; }
  }
  /** Walks (dx, dy) for `seconds`, then stands. */
  walk(dx: number, dy: number, seconds: number): void { this.cmd({ t: 'walk', x: dx, y: dy }); this.run(seconds); this.cmd({ t: 'walk', x: 0, y: 0 }); }
  of(kind: string): ThreatWarning[] { return this.threats.warnings.filter(w => w.kind === kind); }
}

check('«Падение шкафа»: the hero in its lane at the windup — a warning; he stays — hit; a step aside at the windup — dodged with its exit time (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const stay = new Field(k);
    stay.cmd({ t: 'teleport', x: 12.5, y: 7 });
    const wr = stay.place({ x: 10, y: 7 }, WARDROBE);
    stay.run(2, w => !!wardrobeTopple(w, w.enemies.find(e => e.id === wr)!));
    assert(stay.of('wardrobe-topple').length === 1 && stay.of('wardrobe-topple')[0].outcome === null, `seed ${k}: the warning opens at the windup`);
    const hp = stay.world.hero.hp;
    stay.run(2.5);
    const hit = stay.of('wardrobe-topple');
    assert(hit.length === 1 && hit[0].outcome === 'hit' && stay.world.hero.hp === hp - 2 && hit[0].enemies[0] === wr, `seed ${k}: hit (${JSON.stringify(hit)})`);
    const step = new Field(k);
    step.cmd({ t: 'teleport', x: 12.5, y: 7 });
    const wr2 = step.place({ x: 10, y: 7 }, WARDROBE);
    step.run(2, w => !!wardrobeTopple(w, w.enemies.find(e => e.id === wr2)!));
    step.walk(0, 1, 0.25);
    step.run(2.5);
    const dodged = step.of('wardrobe-topple');
    assert(dodged.length === 1 && dodged[0].outcome === 'dodged' && dodged[0].exitTicks !== null && dodged[0].exitTicks <= ticksOf(0.25), `seed ${k}: dodged (${JSON.stringify(dodged)})`);
    assert(step.threats.tally()['wardrobe-topple'].dodged === 1 && stay.threats.tally()['wardrobe-topple'].hit === 1, `seed ${k}: the tally`);
  }
});

check('«Удар ладьи»: the hero on its axis at the windup — a warning; he stays — hit; steps off — dodged; a wardrobe put on the axis during the windup shelters him — dodged by cover (4 seeds)', () => {
  for (const k of [1, 2, 3, 4]) {
    const stay = new Field(k);
    stay.cmd({ t: 'teleport', x: 17, y: 7.2 });
    const rook = stay.place({ x: 12, y: 7 }, ROOK, ROOK_HP);
    stay.run(1, w => !!rookLine(w, w.enemies.find(e => e.id === rook)!));
    assert(stay.of('rook').length === 1, `seed ${k}: the warning opens at the aim`);
    stay.run(2);
    const hit = stay.of('rook');
    assert(hit.length === 1 && hit[0].outcome === 'hit', `seed ${k}: hit (${JSON.stringify(hit)})`);
    const off = new Field(k);
    off.cmd({ t: 'teleport', x: 17, y: 7 });
    const r2 = off.place({ x: 12, y: 7 }, ROOK, ROOK_HP);
    off.run(1, w => !!rookLine(w, w.enemies.find(e => e.id === r2)!));
    off.walk(0, 1, 0.15);
    off.run(2);
    const dodged = off.of('rook');
    assert(dodged.length === 1 && dodged[0].outcome === 'dodged' && dodged[0].reason === undefined && dodged[0].exitTicks !== null, `seed ${k}: dodged (${JSON.stringify(dodged)})`);
    const cover = new Field(k);
    cover.cmd({ t: 'teleport', x: 19, y: 7.2 });
    const r3 = cover.place({ x: 12, y: 7 }, ROOK, ROOK_HP);
    cover.run(1, w => !!rookLine(w, w.enemies.find(e => e.id === r3)!));
    cover.place({ x: 14.5, y: 7 }, WARDROBE);
    const hp = cover.world.hero.hp;
    cover.run(2);
    const sheltered = cover.of('rook');
    assert(sheltered.length === 1 && sheltered[0].outcome === 'dodged' && sheltered[0].reason === 'cover' && cover.world.hero.hp === hp, `seed ${k}: cover (${JSON.stringify(sheltered)})`);
  }
});

console.log(`castle threats: ${checks} checks passed`);
