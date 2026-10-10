/**
 * The build modules of phase B register on import (docs/realtime-phase-b.md, section 9, «Д0»), in this order: the counter
 * talismans (Т1, track Д1), the hammers (Т2, Д2), the relics and the new «Клятва голода» (Т3, 5а, Д3). world.ts imports
 * this file, as it imports enemies/index.ts: the core reads the modules through the registry of build.ts only.
 */
import './talismansRt';
import './hammers';
import './relics';
