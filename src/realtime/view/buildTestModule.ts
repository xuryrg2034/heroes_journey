/**
 * Phase B, track Д5: a test build module for the view (sandbox hook `__realtime.useBuild({ testModule: true })`, Playwright).
 * The real items (Д1–Д3) are written in parallel; this module lets the column, its progress, the icon flash and the player's
 * effects be checked through real chains now. It registers only when the hook asks (never in a run) and acts only while the
 * kit holds its id `view-test-counter` (a talisman id no run gives).
 *
 * Rule: every chain kill +1 on its counter; on the 3rd the counter goes back to 0 and the item fires (`talismanFired`). At
 * the end of each dash it sends the view events of the build — a wave around the hero, a hammer blast at the last link, a
 * cut and fire along the chain — so the effects are drawn without the real hammers. Events are not hashed; the counter is
 * (`Kit.counters`): a journal of a fight with this module replays only where the module is registered (not in Node).
 */
import { addCounter, buildModules, counterOf, registerBuildModule, setCounter, talismanFired } from '../sim/build';

export const VIEW_TEST_MODULE = 'view-test-counter';
/** The test counter fires on this many chain kills (progress shown as dots). */
export const VIEW_TEST_EVERY = 3;

export function registerViewTestModule(): void {
  if (buildModules().some(m => m.id === VIEW_TEST_MODULE)) return;
  registerBuildModule({
    id: VIEW_TEST_MODULE,
    progress: world => ({ value: counterOf(world, VIEW_TEST_MODULE), max: VIEW_TEST_EVERY }),
    onChainKill(world) {
      if (addCounter(world, VIEW_TEST_MODULE, 1) < VIEW_TEST_EVERY) return;
      setCounter(world, VIEW_TEST_MODULE, 0);
      talismanFired(world, VIEW_TEST_MODULE);
    },
    onChainEnd(world, end) {
      const at = end.last ?? end.end;
      world.events.push({ type: 'wave', x: end.end.x, y: end.end.y, r: 2 });
      world.events.push({ type: 'hammer', kind: 'blast', x: at.x, y: at.y, r: 1.5 });
      world.events.push({ type: 'hammer', kind: 'cut', x: end.end.x, y: end.end.y });
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        world.events.push({ type: 'hammer', kind: 'fire', x: end.start.x + (end.end.x - end.start.x) * t, y: end.start.y + (end.end.y - end.start.y) * t });
      }
    },
  });
}
