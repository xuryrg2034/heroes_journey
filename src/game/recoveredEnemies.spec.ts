import oracleData from '../../tests/fixtures/recovered-enemies.json';
import * as rules from './recovered/enemies';
import { ForestEngine } from './forestEngine';
import { canSwapEnemies, cloneCell, prepareIntents, rotationPreview } from './forestSystems';
import { hasOrdinaryChain } from './boardGeneration';
import { campaignBlueprint } from './campaignContent';
import type { ForestCell } from './forestTypes';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
interface World { width: number; height: number; cells: Record<string, rules.EnemyActor>; marsh: number[][]; blocked: number[][]; boss: boolean; draws: number[]; done: boolean[] }
interface Vector { id: string; fn: string; args: (number | boolean)[]; world: World; actor: rules.EnemyActor | null; expected: unknown; actorAfter: unknown; trace: unknown[][] }
function references() {
  for (const v of oracleData.vectors as unknown as Vector[]) {
    const w = v.world, trace: unknown[][] = [], a = structuredClone(v.actor); let draw = 0, done = 0;
    const record = (...values: unknown[]) => { trace.push(values); };
    const contains = (points: number[][], x: number, y: number) => points.some(point => point[0] === x && point[1] === y);
    const ops: rules.EnemyBoardOps & rules.ShieldOps & rules.BasicAttackOps = {
      valid: (x, y) => { record('valid', x, y); return x >= 0 && x < w.width && y >= 0 && y < w.height; },
      cell: (x, y) => { record('cell', x, y); return w.cells[`${x},${y}`] ?? null; },
      playableMove: (sx, sy, x, y) => { record('playableMove', sx, sy, x, y); return !contains(w.blocked, x, y); },
      marshAt: (x, y) => { record('marshAt', x, y); return contains(w.marsh, x, y); },
      playableSpawn: (x, y, power) => { record('playableSpawn', x, y, power); return !contains(w.blocked, x, y); },
      bossLevel: () => { record('bossLevel'); return w.boss; },
      rand: (min, max) => { record('rand', min, max); return min + w.draws[draw++] % (max - min); },
      remove: (e, prop) => { record('remove', prop); delete e.properties[prop]; },
      set: (e, prop, value) => { record('set', prop, value); e.properties[prop] = value; },
      spriteIndex: (_e, name) => { record('spriteIndex', name); const [prefix, suffix] = name.split('_'); return ['side', 'front', 'back'].indexOf(prefix) * 4 + ['idle', 'ready', 'attack', 'hit'].indexOf(suffix) + 10; },
      setAnim: (_e, anim, restart, reverse) => record('setAnim', anim, restart, reverse), sound: (_e, sound) => record('sound', sound),
      animDone: () => { record('animDone'); return w.done[done++ % w.done.length]; }, idle: () => record('idle'), meleeDamage: () => record('meleeDamage'), nextState: (_e, state) => record('nextState', state),
    };
    const n = (index: number) => v.args[index] as number, b = (index: number) => v.args[index] as boolean;
    let result: unknown;
    switch (v.fn) {
      case 'grid_distance': result = rules.gridDistance(n(0), n(1), n(2), n(3)); break;
      case 'can_move_to': result = rules.canMoveTo(n(0), n(1), n(2), n(3), b(4), b(5), ops); break;
      case 'can_random_attack': result = rules.canRandomAttack(n(0), n(1), b(2), b(3), b(4), b(5), ops); break;
      case 'can_land_fire_on': result = rules.canLandFireOn(n(0), n(1), b(2), ops); break;
      case 'is_trapped': result = rules.isTrapped(n(0), n(1), ops); break;
      case 'move_towards': result = rules.moveTowards(n(0), n(1), n(2), n(3), n(4), b(5), ops); break;
      case 'random_land_cell': result = rules.randomLandCell(n(0), n(1), n(2), n(3), n(4), n(5), ops); break;
      case 'random_launch_cell': result = rules.randomLaunchCell(n(0), n(1), n(2), n(3), n(4), n(5), ops); break;
      case 'is_visibly_agro': result = rules.isVisiblyAgro(a!); break;
      case 'update_shield_dir': rules.updateShieldDir(a!, n(0), n(1), ops); result = null; break;
      case 'update_basic_attack': result = rules.updateBasicAttack(a!, n(0), n(1), ops); break;
      case 'will_stop_osmium_missile': result = rules.willStopOsmiumMissile(a, ops); break;
      default: throw new Error(`Unknown oracle ${v.fn}`);
    }
    equal(result, v.expected, `${v.id} result`); equal(trace, v.trace, `${v.id} callback order`);
    equal(a ? { properties: a.properties, face_dir: a.face_dir } : null, v.actorAfter, `${v.id} mutations`);
  }
  console.log(`PASS ${oracleData.vectors.length} actual Python fixtures across all twelve enemy functions, exact results/mutations/callback order`);
}
let nextId = 80000;
function unit(kind: ForestCell['kind'] = 'melee', hp = kind === 'melee' ? 0 : 4): ForestCell { return { id: nextId++, kind, color: 0, hp, maxHp: hp, armor: 0, countdown: 1,
  status: { frozen: 0, brittle: false, wet: false }, behavior: { aggressive: false, restTurns: 0 }, intent: { cells: [], damage: 1, label: '' } }; }
function fixture() {
  const g = new ForestEngine(701); g.animationScale = 0; g.startLevel(); g.state.terrain.fill('floor'); g.state.board.fill(null);
  g.state.player.index = 31; g.state.wave = 3; g.state.spawnCounts = { archers: 2, boss: 1 };
  g.state.board[24] = unit('melee', 3); g.state.board[24]!.variant = 'sentinel';
  for (const index of [17, 18, 23, 25, 30, 32]) g.state.board[index] = unit(); prepareIntents(g.state); return g;
}
async function commit(g: ForestEngine, path: number[]) { assert(g.beginChain(path[0]), 'begin shield route'); for (const index of path.slice(1)) assert(g.extendChain(index), 'extend shield route'); assert(await g.releaseChain(), 'commit shield route'); }
async function shields() {
  const front = fixture(), sentinel = front.state.board[24]!;
  equal(sentinel.shield, { dx: 0, dy: 1 }, 'shield faces south toward hero');
  const clone = cloneCell(sentinel); clone.shield!.dy = -1; equal(sentinel.shield, { dx: 0, dy: 1 }, 'shield cloning isolates candidates');
  let reason = ''; front.subscribe((_state, event) => { if (event.type === 'invalid') reason = event.text ?? ''; });
  const before = JSON.stringify(front.state); assert(!front.beginChain(24) && !front.validStarts().includes(24) && reason.includes('Щит'), 'front rejected at input with precise reason');
  equal(JSON.stringify(front.state), before, 'front rejection costs no HP/energy/turn/state');
  front.state.player.energy = 7; assert(!front.preview([32, 24]).valid, 'ordinary diagonal from protected half-plane rejected');
  front.cancelChain();
  const side = front.preview([30, 23, 24]); assert(side.valid && side.hits.at(-1)!.availablePower === 3 && side.hits.at(-1)!.killed, 'side approach builds enough power from two weak targets to bypass shield');
  await commit(front, [30, 23, 24]); assert(!front.state.board.some(cell => cell?.id === sentinel.id) && front.state.lastDamage === side.damage, 'side preview matches committed death and incoming damage');
  const back = fixture(); back.state.player.index = 10; back.state.board[17] = unit(); assert(back.preview([17, 24]).valid, 'rear approach allowed without retargeting shield');
  const frozen = fixture(); frozen.state.board[24]!.hp = frozen.state.board[24]!.maxHp = 1;
  frozen.state.board[24]!.status.frozen = 1; frozen.state.board[24]!.status.brittle = true;
  assert(frozen.preview([24, 17]).valid, 'freeze disables shield and brittle doubles ordinary hit');
  const abilities = fixture(); abilities.state.player.energy = 7; abilities.state.board[24]!.hp = abilities.state.board[24]!.maxHp = 4;
  assert(abilities.previewAbility('jump', 24).valid && abilities.previewAbility('spin').hits.some(hit => hit.index === 24 && hit.damage === 4), 'jump/spin ignore directional shield');
  abilities.state.inventory.bomb = 1; assert(abilities.previewItem('bomb', 24).damage === 6 && abilities.useItem('bomb', 24), 'bomb ignores directional shield');
  assert(campaignBlueprint('barracks', 2, 701).actors.some(actor => actor.variant === 'sentinel'), 'later barracks introduces sentinel without changing first-room tutorial trap');
  for (const theme of ['library'] as const) {
    const g = new ForestEngine(701); g.animationScale = 0; g.startScenario(theme);
    const guard = g.state.board.find(cell => cell?.variant === 'sentinel')!; assert(guard?.hp === 7 && !!guard.shield && hasOrdinaryChain(g.state), 'authored sentinel room has a validated ordinary opening');
    const initial = JSON.stringify(g.state); await g.waitTurn(); const after = JSON.stringify(g.state); g.restartLevel(); equal(JSON.stringify(g.state), initial, 'entry snapshot restores guard and resources'); await g.waitTurn(); equal(JSON.stringify(g.state), after, 'sentinel preparation seeded replay');
  }
  console.log('PASS runtime sentinel front/flank/rear/diagonal, freeze, ability exceptions, shared preview/commit, cloning, validated scenes and restart');
}
async function summons() {
  const g = fixture(); g.state.board[3] = unit('boss', 18); const wizard = g.state.board[3]!; wizard.variant = 'wizard'; wizard.behavior.cycle = 2;
  for (const index of [0, 1, 2, 4, 5]) { g.state.board[index] = unit(); g.state.board[index]!.variant = 'chair'; }
  let draws = 0; prepareIntents(g.state, () => { draws++; return 0; });
  equal(wizard.intent.summonCells, [0, 1], 'seeded cyclic launch search chooses two distinct occupied normals'); assert(draws === 4, 'each target draws start column and row once');
  assert(!wizard.intent.summonCells!.includes(24), 'summon never replaces sentinel');
  const warning = [...wizard.intent.summonCells!]; g.preview([30, 23]); equal(wizard.intent.summonCells, warning, 'preview never rerolls warning');
  const firstId = g.state.board[0]!.id; g.state.board[0] = null;
  const events: number[] = []; g.subscribe((_state, event) => { if (event.type === 'special-arrival' && event.text === 'ПРИЗЫВ') events.push(event.index!); });
  await g.waitTurn(); assert(events.includes(1) && !events.includes(0) && !g.state.board.some(cell => cell?.id === firstId), 'dead warning target canceled without replacement retarget; second target summons');
  assert(g.state.board[1]?.variant === 'stool' && g.state.board[1]!.hp === 2 && g.state.board[1]!.behavior.aggressive, 'summoned stool preserves existing HP/aggression rules');
  console.log('PASS wizard fixed seeded distinct summon targets, protected roles, death cancellation and unchanged summoned enemy');
}
function wardrobeFixture(hp = 10) {
  const g = fixture(); g.state.board.fill(null); g.state.player.index = 38; g.state.player.energy = 7;
  const wardrobe = unit('melee', hp); wardrobe.variant = 'wardrobe'; wardrobe.footprint = [16, 17, 23, 24];
  for (const index of wardrobe.footprint) g.state.board[index] = wardrobe;
  for (const index of [30, 31]) g.state.board[index] = unit();
  prepareIntents(g.state); return { g, wardrobe };
}
async function wardrobes() {
  const { g, wardrobe } = wardrobeFixture(3); g.state.player.energy = 0;
  assert(!g.preview([31, 24, 23]).valid, 'shared footprint cannot supply repeated chain hits');
  const p = g.preview([31, 30, 23]); assert(p.valid && p.kills === 3 && p.energyGain === 1.5 && p.hits.at(-1)?.availablePower === 3, 'wardrobe contributes one enemy, kill and energy increment');
  const oldScore = g.state.score; await commit(g, [31, 30, 23]);
  assert(g.state.objective.kills === 3 && g.state.score > oldScore && g.state.player.energy === 1.5, 'score/objective/energy once per actual enemy');
  assert(!g.state.board.some(cell => cell?.id === wardrobe.id) && g.state.player.index === 23 && g.state.board[23] === null, 'kill clears all four parts and lands at contacted part');
  assert([16, 17, 24].every(index => !!g.state.board[index]), 'remaining freed footprint cells refill densely');
  const attack = wardrobeFixture(); attack.wardrobe.behavior.aggressive = true; attack.g.state.board[30]!.hp = attack.g.state.board[30]!.maxHp = 20; prepareIntents(attack.g.state);
  const incoming = attack.g.preview([31, 30]); assert(incoming.valid && incoming.damage === 1 && incoming.threats.filter(index => attack.g.state.board[index]?.id === attack.wardrobe.id).length === 1, 'perimeter threat forecasts one attack despite four aliases');
  await commit(attack.g, [31, 30]); assert(attack.g.state.lastDamage === 1 && !attack.wardrobe.behavior.aggressive, 'wardrobe attacks and calms once');
  const frozen = wardrobeFixture(); frozen.wardrobe.status.frozen = 2; await frozen.g.waitTurn(); assert(frozen.wardrobe.status.frozen === 1, 'status ticks once for shared entity');
  const spin = wardrobeFixture(); spin.g.state.player.index = 31; spin.g.state.board[31] = null;
  assert(spin.g.previewAbility('spin').hits.filter(hit => [16, 17, 23, 24].includes(hit.index)).length === 1, 'spin deduplicates footprint');
  await spin.g.useAbility('spin'); assert(spin.g.state.board.find(cell => cell?.id === spin.wardrobe.id)?.hp === 6, 'spin applies one physical hit');
  const fire = wardrobeFixture(); fire.g.state.inventory.fire = 1; fire.g.useItem('fire', 23);
  assert(fire.wardrobe.hp === 10 && fire.wardrobe.damageEffects?.burning === 1, 'fire cross adds one burning stack to shared wardrobe without impact damage');
  await fire.g.waitTurn(); assert(Number(fire.wardrobe.hp) === 9, 'burning ticks once across all four parts');
  const killsBeforeBomb = fire.g.state.objective.kills;
  fire.wardrobe.hp = 6;
  fire.g.state.itemPrepared = false; fire.g.state.inventory.bomb = 1; fire.g.useItem('bomb', 24);
  assert(!fire.g.state.board.some(cell => cell?.id === fire.wardrobe.id) && fire.g.state.objective.kills === killsBeforeBomb + 1, 'bomb clears all parts and credits one defeat');
  for (const lethal of [false, true]) {
    const arrows = wardrobeFixture(); arrows.wardrobe.hp = lethal ? 2 : 10;
    arrows.g.state.hazard = { cells: [16, 17, 23, 24], turnsUntil: 1, damage: 2 }; await arrows.g.waitTurn();
    assert(lethal ? !arrows.g.state.board.some(cell => cell?.id === arrows.wardrobe.id) : arrows.wardrobe.hp === 8, 'one global volley hits one entity once');
    assert(arrows.g.state.room.combatKills === (lethal ? 1 : 0) && arrows.g.state.objective.kills === 0, 'environment kill counted once without player credit');
  }
  const rotate = wardrobeFixture(); rotate.g.state.board[15] = unit('ranged');
  assert(!canSwapEnemies(rotate.g.state, 15, 16), 'large enemy cannot be selected as rotation partner');
  rotate.g.state.rotations = [{ from: 15, to: 16, sourceId: rotate.g.state.board[15]!.id, targetId: rotate.wardrobe.id, geometry: 'cardinal' }];
  assert(!rotationPreview(rotate.g.state)[0].active, 'defensive execution cancels any stale pair touching wardrobe');
  const arrival = wardrobeFixture(); arrival.g.state.wave = 2; arrival.g.state.spawnCounts = { archers: 0, boss: 0 };
  await arrival.g.waitTurn();
  assert(arrival.g.state.spawnCounts.archers === 2 && arrival.wardrobe.footprint!.every(index => arrival.g.state.board[index] === arrival.wardrobe), 'forest arrival batch cannot partially replace shared wardrobe');
  for (const seed of [21, 83, 701, 984]) {
    const natural = new ForestEngine(seed); natural.startScenario('banquet');
    const large = natural.state.board.find(cell => cell?.variant === 'wardrobe')!;
    assert(large.footprint?.length === 4 && large.footprint.every(index => natural.state.board[index] === large) && hasOrdinaryChain(natural.state), 'authored/mirrored wardrobe has shared identity and validated opening');
    const entry = JSON.stringify(natural.state); natural.restartLevel(); equal(JSON.stringify(natural.state), entry, 'wardrobe entry restart replay');
  }
  console.log('PASS shared 2x2 wardrobe chain/energy/score, perimeter preview/attack, status, spin/fire/bomb/volley dedupe, full clearing/refill, immobility and authored replay');
}
references(); await shields(); await summons(); await wardrobes();
