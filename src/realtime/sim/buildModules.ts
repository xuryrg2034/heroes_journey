/**
 * The build modules of phase B register on import (docs/realtime-phase-b.md, section 9, «Д0»), in this order: the counter
 * talismans (Т1, track Д1), the hammers (Т2, Д2), the relics and the new «Клятва голода» (Т3, 5а, Д3). world.ts imports
 * this file, as it imports enemies/index.ts: the core reads the modules through the registry of build.ts only.
 */
import './talismansRt';
import './hammers';
import './relics';
// Task 29: the forms of the field «Звено» (pure hooks only).
import './forms';
// Task 29: the sandbox form «Наледь» (after the relics: its frost lies after the hammer's fire in a tick).
import './frostPass';
// Task 46: the fusions of the dash's end (after the hammers: the paint of «Клеймо» comes after the end blast).
import './fusionEnds';
