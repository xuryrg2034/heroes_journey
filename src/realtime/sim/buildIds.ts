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
 * Task 29 (form of the field «Путь»): «Наледь» — the dash's path freezes the enemies that enter it for 2 s (sim/frostPass.ts).
 * Kept in `Loadout.talismans` / `Kit.talismans`; task 30: a form of the run's catalogue (run/rtTalismans.ts `RT_FORMS`).
 */
export const FROST_PASS = 'frost-pass';

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

/**
 * Task 29 «Формы в песочнице» (docs/realtime-prototype.md, section 9ф): the forms — items that change the shape of the chain
 * rather than its numbers. Kept in `Loadout.talismans` / `Kit.talismans` (the sandbox gives them); not in the run's catalogue
 * (`RT_TALISMANS`); task 30: a run with the flag `forms` offers «Печать» and «Прямая» (run/rtTalismans.ts `RT_FORMS`) and «Близнецы»
 * (`RT_OPENERS`). A form acts while the kit holds its id; a journal without the id plays the old path.
 */
export const FORMS = {
  /** «Печать»: the loop (chain.ts `loopOn`), as the sandbox toggle `loopEnabled`. */
  seal: 'form-seal',
  /** «Прямая»: the pierce (pierce.ts `pierceOn`), as the sandbox toggle `pierceEnabled`. */
  pierce: 'form-pierce',
  /** «Развилка»: the next link is taken within R of any link of the chain (forms.ts, the hook `anchors`). */
  fork: 'form-fork',
  /** «Чужак»: once a chain, one link may be an enemy of another colour (forms.ts, the hook `color`). */
  alien: 'form-alien',
  /** «Близнецы»: the palette's colours 1 + 3 and 2 + 4 count as one colour (forms.ts, the hook `color`). */
  twins: 'form-twins',
} as const;
export type FormId = typeof FORMS[keyof typeof FORMS];
export const FORM_IDS: readonly FormId[] = Object.values(FORMS);

/** The field a form bends (report «Талисманы меняющие стиль игры», «Поля действия»): what joins, the run, after the last link. */
export type FormField = 'link' | 'path' | 'end';
/** Player-facing names of the fields. */
export const FORM_FIELD_TITLES: Readonly<Record<FormField, string>> = { link: 'Звено', path: 'Путь', end: 'Конец' };

/**
 * The field of every form by id: the forms of task 29 and the hammers («Огненный», «Режущий», «Возврат» — «Путь»; «Взрыв на
 * конце» — «Конец»); «Якорь у героя» (`hero-anchor`) is a «Звено» form too.
 */
export const FORM_FIELD: Readonly<Record<string, FormField>> = {
  [FORMS.seal]: 'end', [FORMS.pierce]: 'end', [HAMMERS.blast]: 'end',
  [FORMS.fork]: 'link', [FORMS.alien]: 'link', [FORMS.twins]: 'link', 'hero-anchor': 'link',
  [HAMMERS.fire]: 'path', [HAMMERS.cut]: 'path', [HAMMERS.return]: 'path', [FROST_PASS]: 'path',
  // Task 44: a fusion takes the field of its form part.
  'fusion-ice-seal': 'end', 'fusion-spear': 'end', 'fusion-boomerang': 'path',
  // Task 46.
  'fusion-brand': 'path', 'fusion-hunter-blast': 'end', 'fusion-frost-wave': 'path',
};

/**
 * Task 44 «Сплавы» (docs/design-notes/task-44-fusions.md; docs/realtime-prototype.md, section 9ц): a form (or the hammer «Возврат»)
 * and a counter talisman make one item with a new rule of the chain. A fusion keeps the rules of both parts: a kit holding the
 * fusion's id holds its parts too (kit.ts `kitOf`, `expandFusions`); its own rule acts while the kit holds its id (sim/fusions.ts).
 * A journal without a fusion id plays the old path.
 */
export const FUSIONS = {
  /** «Ледяная печать» = «Печать» + «Иней на клинке»: the survivors inside the ring freeze as from the cold consumable. */
  iceSeal: 'fusion-ice-seal',
  /** «Копьё» = «Прямая» + «Длинная рука»: the pierce twice as long, 2 plates off an elite instead of one. */
  spear: 'fusion-spear',
  /** «Бумеранг» = «Возврат» + «Добивание»: the second pass of «Возврат» at full power when the last enemy link died. */
  boomerang: 'fusion-boomerang',
  /** Task 46: «Клеймо» = «Огненный проход» + «Призма»: the lit path paints the bodies along it in the chain's colour. */
  brand: 'fusion-brand',
  /** Task 46: «Подрыв» = «Взрыв на конце» + «Охотник на элит»: the last link an elite or tough — a wider, stronger blast. */
  hunterBlast: 'fusion-hunter-blast',
  /** Task 46: «Ледяная волна» = «Наледь» + «Ударная волна»: the wave strikes as before and freezes its survivors. */
  frostWave: 'fusion-frost-wave',
} as const;
export type FusionId = typeof FUSIONS[keyof typeof FUSIONS];
export const FUSION_IDS: readonly FusionId[] = Object.values(FUSIONS);
export const isFusionId = (value: unknown): value is FusionId => typeof value === 'string' && (FUSION_IDS as readonly string[]).includes(value);
/** A recipe: the form part (its field is the fusion's) and the counter part. */
export interface FusionRecipe { fusion: FusionId; form: string; counter: string }
export const FUSION_RECIPES: readonly FusionRecipe[] = [
  { fusion: FUSIONS.iceSeal, form: FORMS.seal, counter: COUNTER_TALISMANS.frostEdge },
  { fusion: FUSIONS.spear, form: FORMS.pierce, counter: COUNTER_TALISMANS.longArm },
  { fusion: FUSIONS.boomerang, form: HAMMERS.return, counter: COUNTER_TALISMANS.finisher },
  { fusion: FUSIONS.brand, form: HAMMERS.fire, counter: COUNTER_TALISMANS.prism },
  { fusion: FUSIONS.hunterBlast, form: HAMMERS.blast, counter: COUNTER_TALISMANS.eliteHunter },
  { fusion: FUSIONS.frostWave, form: FROST_PASS, counter: COUNTER_TALISMANS.shockwave },
];
/** Task 46: the fusions of task 46 — a kit with one of them plays the slot rule of `kitOf` (task 44's fusions keep the old kit). */
export const FUSIONS_V2: readonly string[] = [FUSIONS.brand, FUSIONS.hunterBlast, FUSIONS.frostWave];
/**
 * Task 46 (design 16.10.2026, section 5): the hammers and fusions a fusion never stands with — a hammer of the loadout it excludes
 * leaves the kit (`kitOf`); the run's catalogue keeps them out of one build (run/rtTalismans.ts `excludes`).
 */
export const FUSION_EXCLUDES: Readonly<Record<string, readonly string[]>> = {
  [FUSIONS.boomerang]: [HAMMERS.blast, FUSIONS.hunterBlast],
  [FUSIONS.hunterBlast]: [HAMMERS.return, FUSIONS.boomerang],
};
/** The recipe of a fusion. */
export const fusionRecipe = (fusion: string): FusionRecipe | undefined => FUSION_RECIPES.find(r => r.fusion === fusion);
/** The recipe a half belongs to: its partner and the fusion; undefined — not a half of a recipe. */
export function fusionOfHalf(id: string): { partner: string; fusion: FusionId } | undefined {
  const r = FUSION_RECIPES.find(x => x.form === id || x.counter === id);
  return r ? { partner: r.form === id ? r.counter : r.form, fusion: r.fusion } : undefined;
}
/**
 * The talismans with every fusion's parts added after it (each id once, the order of the list kept): what a kit holds. A list
 * without a fusion comes back as it is.
 */
export function expandFusions(ids: readonly string[]): string[] {
  if (!ids.some(isFusionId)) return [...ids];
  const out: string[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
    const r = fusionRecipe(id);
    if (r) for (const part of [r.form, r.counter]) if (!out.includes(part)) out.push(part);
  }
  return out;
}

/**
 * Rank inside the field «Конец» (task 29, item 6), per chain: of the forms whose rule holds on the chain only the first acts —
 * a closed loop strikes its seal (no pierce, no end blast), a pierce that ran leaves no end blast. The end blast yields only
 * while the kit holds «Печать» or «Прямая» as a form (chain.ts `endRankOn`): the sandbox toggles alone keep the old path.
 */
export const END_RANK: readonly string[] = [FORMS.seal, FORMS.pierce, HAMMERS.blast];

/**
 * Rank of the colour rules of the field «Звено» (task 29, item 6): one colour rule acts — the first of this list in the kit.
 * «Близнецы» before «Чужак» (the report's order; «Близнецы» bends every link, «Чужак» one).
 */
export const COLOR_RULE_RANK: readonly string[] = [FORMS.twins, FORMS.alien];
