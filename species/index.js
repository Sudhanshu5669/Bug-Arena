// Species barrel. Importing this module loads every species file for its
// self-registration side effect, so after `import "../species/index.js"` the
// registry is fully populated.
//
// To add a species: create the file, then add one import line below. That's it —
// no engine changes.

// --- soldier tier (ants) ---
import './fireAnt.js';
import './bulletAnt.js';
import './suicideAnt.js';
import './leafcutterAnt.js';
import './armyAnt.js';
import './trapjawAnt.js';
import './honeypotAnt.js';
import './workerAnt.js';
import './carpenterAnt.js';
import './crazyAnt.js';
import './harvesterAnt.js';
import './bulldogAnt.js';

// --- champion tier (bugs) ---
import './spider.js';
import './mantis.js';
import './scorpion.js';
import './beetle.js';
import './bombardier.js';
import './hornet.js';
import './centipede.js';
import './queenAnt.js';
import './assassinBug.js';
import './spitter.js';
import './widow.js';
import './antlion.js';

export { registerSpecies, getSpecies, listSpecies, getCatalog } from './registry.js';
