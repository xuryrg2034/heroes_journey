/**
 * Ids of the phase B build (docs/realtime-phase-b.md, sections 3–5 and 8; track Д0): the counter talismans (Т1), the hammers
 * (Т2), the relics (Т3), the kill sources of the player's build and the event kinds of the hammers. One place for the
 * simulation (sim/*) and the run (run/rtTalismans.ts, run/rtRun.ts): the simulation never imports the run.
 *
 * Plain strings: a loadout, a journal and a run save carry them as they are. The rules live in sim/talismansRt.ts (Д1),
 * sim/hammers.ts (Д2) and sim/relics.ts (Д3), registered through sim/build.ts.
 */

/** Т1. Counter talismans: a condition and a trigger (section 3). Kept in `Loadout.talismans` / `Kit.talismans`. */
export const COUNTER_TALISMANS = {
  /** «Пятое звено» (common): every 5th enemy link of a chain +2 power before its hit. */
  fifthLink: 'fifth-link',
  /** «Третья цепь» (common): every 3rd chain of the arena that killed — the next jump within 5 s is free. */
  thirdChain: 'third-chain',
  /** «Ударная волна» (uncommon): a chain of 8+ links — a wave around the hero at the end of the dash. */
  shockwave: 'shockwave',
  /** «Призма» (common): every crystal broken by the dash +1 energy. */
  prism: 'prism',
  /** «Добивание» (uncommon): the last enemy link died — the after-chain invulnerability twice as long. */
  finisher: 'finishing-blow',
  /** «Охотник на элит» (uncommon): an elite in the chain — the links after it +3 power (once). */
  eliteHunter: 'elite-hunter',
  /** «Длинная рука» (rare): every 4th released chain of the arena — link radius R ×1.5 for that chain. */
  longArm: 'long-arm',
  /** «Иней на клинке» (rare): every 4th chain of the arena — the surviving last enemy link freezes for 2 s. */
  frostEdge: 'frost-edge',
} as const;
export type CounterTalismanId = typeof COUNTER_TALISMANS[keyof typeof COUNTER_TALISMANS];

/** Т2. Hammers: they change the dash itself (section 4). One per run: `Loadout.hammer` / `Kit.hammer`. */
export const HAMMERS = {
  /** «Огненный проход»: the dash leaves fire for 2 s. */
  fire: 'fire-pass',
  /** «Взрыв на конце»: a blast of 1.5 around the last enemy link at the end of the dash. */
  blast: 'end-blast',
  /** «Режущий проход»: the dash hits enemies of any colour within 0.5 of its path. */
  cut: 'cutting-pass',
  /** «Возврат»: after the dash the hero runs back to the start of the chain, a second pass. */
  return: 'return-pass',
} as const;
export type HammerId = typeof HAMMERS[keyof typeof HAMMERS];
export const HAMMER_IDS: readonly HammerId[] = Object.values(HAMMERS);
export const isHammerId = (value: unknown): value is HammerId => typeof value === 'string' && (HAMMER_IDS as readonly string[]).includes(value);

/**
 * Т3. Relics: a strong plus and a price (section 5). Kept in `Loadout.talismans` / `Kit.talismans` with the rarity `relic`
 * of run/rtTalismans.ts (not `oath`: an oath gives +2 energy at the start of an arena, `isRtOath`).
 */
export const RELICS = {
  /** «Жернов»: a crystal for every 4 chain kills; max HP −3. */
  millstone: 'relic-millstone',
  /** «Тяжёлый клинок»: every link +2 power instead of +1; focus reserve halved. */
  heavyBlade: 'relic-heavy-blade',
  /** «Быстрые ноги»: hero speed +25%; no invulnerability after a chain. */
  swiftFeet: 'relic-swift-feet',
  /** «Широкий круг»: link radius R +25%; enemies walk 10% faster. */
  wideCircle: 'relic-wide-circle',
  /** «Кровавая клятва»: +1 energy for every 6 chain kills; healing consumable half as strong. */
  bloodOath: 'relic-blood-oath',
} as const;
export type RelicId = typeof RELICS[keyof typeof RELICS];
export const RELIC_IDS: readonly RelicId[] = Object.values(RELICS);

/** Т3а. The new «Клятва голода» keeps the old id (design answer 6). */
export const OATH_HUNGER = 'oath-hunger';

/**
 * Kill sources of the player's build (`KillCause.source`, the `kill` and `enemyHit` events). All are credited to the player
 * (section 2: tools of the player, as a blast of a sapper killed by the chain).
 */
export const BUILD_SOURCES = {
  wave: 'wave',
  hammerFire: 'hammer-fire',
  hammerBlast: 'hammer-blast',
  hammerCut: 'hammer-cut',
  hammerReturn: 'hammer-return',
} as const;
export type BuildSource = typeof BUILD_SOURCES[keyof typeof BUILD_SOURCES];

/** What a `hammer` event shows (view): fire laid, the end blast, a cut, the return run started. */
export type HammerEventKind = 'fire' | 'blast' | 'cut' | 'return';
