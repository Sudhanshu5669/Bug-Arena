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
import './weaverAnt.js';
import './amazonAnt.js';
import './acrobatAnt.js';
import './turtleAnt.js';
import './draculaAnt.js';
import './jackJumperAnt.js';
import './pharaohAnt.js';
import './thiefAnt.js';
import './argentineAnt.js';
import './zombieAnt.js';

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
import './tarantulaHawk.js';
import './waterBug.js';
import './vinegaroon.js';
import './goliathBeetle.js';
import './dragonfly.js';
import './jumpingSpider.js';
import './velvetWorm.js';
import './jewelWasp.js';
import './coachHorse.js';
import './solifuge.js';

export { registerSpecies, getSpecies, listSpecies, getCatalog } from './registry.js';
