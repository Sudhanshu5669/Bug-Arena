// Browser adapter for the bare specifier `matter-js`.
//
// engine/engine.js does `import Matter from 'matter-js'`, which Node resolves from
// node_modules. The browser can't — so index.html's import map points that
// specifier here, and this module hands back the global that the UMD build
// (`vendor/matter.min.js`, loaded as a classic script in <head>) already put on
// `window`.
//
// Why this shape: it means the ENGINE IS NEVER MODIFIED for the browser. The same
// engine/ source runs unchanged in Node (real matter-js) and in the browser (this
// shim), which is the whole point of keeping the engine renderer-agnostic.

const Matter = globalThis.Matter;

if (!Matter) {
  throw new Error(
    'matter-js global missing. `vendor/matter.min.js` must load as a classic ' +
      '<script> in <head>, BEFORE any module script runs.'
  );
}

export default Matter;
