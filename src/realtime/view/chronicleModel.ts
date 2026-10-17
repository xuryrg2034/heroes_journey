/**
 * Task 58 «Летопись» (design 17.10.2026, docs/design-notes/task-58-discovery.md): what the view takes of the chronicle — the
 * contract of section 7.4 and the source the view reads. The rules (what counts, what is hidden, the retro) are core's (58а); the
 * view only draws the contract. A hidden entry or chapter is not in the contract, so the view cannot show it by mistake.
 * Names, captions and pictures are the view's (`chronicleView.ts`, from the catalogues of the code).
 */

/** An entry's state: a locked card (a pack not open), «?», seen (a kind, an event, an item shown), taken (an item, a fusion), a boss met / won, a hero or an NPC (met). */
export type ChronicleEntryState = 'locked' | 'unknown' | 'seen' | 'taken' | 'met' | 'won';

export interface ChronicleEntry {
  id: string;
  state: ChronicleEntryState;
  /** The run the entry was won / met in (a boss won, Ведунья freed); 0 — unknown (the retro). */
  run?: number;
  /** A fusion «?»: the id of the one part of the recipe the viewer has taken («Иней на клинке + ?»). */
  half?: string;
}

/** A chapter: `open` — its entries are shown; `blank` — the empty tab of the next level («…», no name, no entries). */
export interface ChronicleChapter { id: string; level: number; state: 'open' | 'blank'; entries: ChronicleEntry[] }

export type ChroniclePageId = 'bestiary' | 'bosses' | 'events' | 'items' | 'heroes' | 'hearth';
export interface ChroniclePage { id: ChroniclePageId; have: number; known: number; unread: boolean; chapters: ChronicleChapter[] }

/** The contract (core `rtChronicleView`, 58а). `hint` — the owl's honest hint of the visit (its key is for the line, the target for the place). */
export interface ChronicleView {
  total: [have: number, known: number];
  pages: ChroniclePage[];
  hint?: { key: string; target: string };
}

/** The P8 memory the view hands over once (the kinds and affixes the viewer met before the chronicle). */
export interface ChronicleMemory { kinds: string[]; affixes: string[] }

/**
 * What a run's end added (the end screen's line): the refs in the form of `unread` of section 7.1 — `kind:lynx`, `affix:fiery`,
 * `event:brook`, `item:prism`, `boss:troll`, `hero:toad`, `ash:cat:5`, `npc:herb`, `chapter:garrison`.
 */
export interface ChronicleAdded { refs: string[] }

/** What the view needs of the chronicle (core's profile; the stub `chronicleStub.ts` until 58а lands). */
export interface ChronicleSource {
  /** The contract for the hero chosen. */
  view(): ChronicleView;
  /** Kinds / affixes that came into view in a fight of a meta run (the caller has checked: not `?seed=`, not the sandbox, not the prologue). Repeats are the source's to ignore. */
  meet(kinds: readonly string[], affixes: readonly string[]): void;
  /** The retro: the P8 memory, handed over when the camp opens (the source ignores a repeat). */
  import(memory: ChronicleMemory): void;
  /** The chronicle was opened: the unread are read. */
  read(): void;
  /** The new entries a run added (its end screen); empty — no line. */
  added(runKey: string): ChronicleAdded;
}
