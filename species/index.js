// Species barrel. Importing this module loads every species file for its
// self-registration side effect, so after `import "../species/index.js"` the
// registry is fully populated.
//
// To add a species: create the file, then add one import line below. That's it —
// no engine changes.

import './fireAnt.js';
import './spider.js';
import './mantis.js';

export { registerSpecies, getSpecies, listSpecies, getCatalog } from './registry.js';
