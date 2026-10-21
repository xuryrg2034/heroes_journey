/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md): what the view takes of the chronicle. The contract
 * (`RtChronicleView` of section 7.4) and the rules (what counts, what is hidden, the retro) are core's (58а, `run/chroniclePages.ts`,
 * `run/chronicle.ts`); the view only draws the contract and keeps no copy of it. A hidden entry or chapter is not in the contract, so
 * the view cannot show it by mistake. Names, captions and pictures are the view's (`chronicleView.ts`, from the catalogues of the code).
 */
import type { RtChronicleChapter, RtChronicleEntry, RtChronicleEntryState, RtChronicleHint, RtChroniclePage, RtChronicleView } from '../run/chroniclePages';
import type { RtChroniclePageId } from '../run/chronicleCatalog';
import type { RtChronicleMemory, RtChronicleMet } from '../run/chronicle';
import type { RtRunState } from '../run/rtRun';
import type { RtProfileStore } from '../run/rtRunStorage';

export type ChronicleEntryState = RtChronicleEntryState;
export type ChronicleEntry = RtChronicleEntry;
export type ChronicleChapter = RtChronicleChapter;
export type ChroniclePageId = RtChroniclePageId;
export type ChroniclePage = RtChroniclePage;
export type ChronicleHint = RtChronicleHint;
export type ChronicleView = RtChronicleView;
/** The P8 memory the view hands over once (the kinds and affixes the viewer met before the chronicle). */
export type ChronicleMemory = RtChronicleMemory;

/** What the view needs of the chronicle: the profile store's calls (`RtProfileStore.chronicle*`), nothing else. */
export interface ChronicleSource {
  /** The book for the chosen hero. */
  view(): ChronicleView;
  /** Kinds / affixes / an elite that came into view in a fight of `run` (the caller has checked: not the sandbox, not the prologue; a seeded run, the day's too, the core refuses). Repeats are the core's to ignore. */
  meet(run: Pick<RtRunState, 'seeded'>, met: RtChronicleMet): void;
  /** The retro: the P8 memory, handed over when the camp opens (the core ignores a repeat). */
  import(memory: ChronicleMemory): void;
  /** The chronicle was opened: the unread are read. */
  read(): void;
  /** The refs (`kind:lynx`, `item:prism`, `chapter:garrison` …) a run added (its end screen); empty — no line. */
  added(runKey: string): string[];
}

/** The source over the profile store. */
export const profileChronicle = (store: RtProfileStore): ChronicleSource => ({
  view: () => store.chronicle(),
  meet: (run, met) => { store.chronicleMeet(run, met); },
  import: memory => { store.chronicleImport(memory); },
  read: () => { store.chronicleRead(); },
  added: runKey => store.chronicleAdded(runKey),
});
