// Browser adapter for the bare specifier `events` (a Node builtin).
//
// BugArenaEngine extends Node's EventEmitter. Rather than change the engine to
// suit the browser, index.html's import map points `events` here and this
// provides the small subset the engine actually uses: on / once / off / emit /
// removeAllListeners / listenerCount.
//
// Deliberately minimal — this is not a general EventEmitter polyfill, it is
// exactly enough for the engine's snapshot/start/end stream.

export class EventEmitter {
  constructor() {
    this._listeners = new Map(); // event -> Set<fn>
  }

  on(event, fn) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(fn);
    return this;
  }

  addListener(event, fn) {
    return this.on(event, fn);
  }

  once(event, fn) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    // Keep a handle on the original so `off(event, fn)` still works after `once`.
    wrapper.listener = fn;
    return this.on(event, wrapper);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (!set) return this;
    for (const l of set) {
      if (l === fn || l.listener === fn) set.delete(l);
    }
    if (set.size === 0) this._listeners.delete(event);
    return this;
  }

  removeListener(event, fn) {
    return this.off(event, fn);
  }

  removeAllListeners(event) {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
    return this;
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return false;
    // Iterate a copy: a listener is allowed to unsubscribe itself mid-emit
    // (the showreel's one-shot `end` handler does exactly that).
    for (const fn of [...set]) fn(...args);
    return true;
  }

  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }
}

export default { EventEmitter };
