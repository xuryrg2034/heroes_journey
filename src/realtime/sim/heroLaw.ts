/**
 * Task 49 «Второй герой» (docs/design-notes/task-49-second-hero.md, sections 4 and 9; docs/realtime-prototype.md, section 9к): the
 * law of a hero other than the cat — a build module that acts while the kit holds its id (kit.ts `kitOf` puts it there for
 * `Loadout.hero`). A kit without it — the cat — plays the old path; no `Params` key, nothing in the world.
 *
 * Ведунья (`hero-toad`): «Печать» is innate (the kit holds `form-seal` from the first fight: chain.ts `loopOn`, the ring on the first
 * link or on the hero, the rank of the field «Конец» as for the form). The price — the after-chain shield (`chainShield`) only after a
 * closed chain: a dash whose end did not strike a seal (`ChainEnd.endForm` other than `seal`) gives no shield, whatever it killed.
 * «Щит фокуса» is not touched; «Добивание» doubles only the shield a ring gives; «Быстрые ноги» take it away as from the cat.
 * The plan reads the same rule (kit.ts `sealOnlyShield`): the drawn open chain is marked `ChainPlan.noShield`.
 */
import { HERO_LAWS } from './buildIds';
import { registerBuildModule } from './build';

registerBuildModule({
  id: HERO_LAWS.toad,
  // `end` null — the base number asked without a dash (the plan of «Добивание» II reads the seal itself, chain.ts `planHoned`).
  modify: { chainShield: (_world, value, end) => (end && end.endForm !== 'seal' ? 0 : value) },
});
