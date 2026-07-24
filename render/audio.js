// ArenaAudio — the species sound layer.
//
// Sound is treated exactly like art: a species declares a data-only `sfx`
// descriptor and this module realizes it. Nothing here knows any species name,
// and no audio FILES are involved — every sound is SYNTHESIZED at play time from
// a small recipe format via the Web Audio API. That keeps the repo asset-free,
// makes a new species' voice a two-line edit in its own file, and means a sound
// can be tuned without re-exporting anything.
//
// Like the renderer, this is a pure *subscriber*: it reads engine events and the
// species catalog, and never touches the simulation.
//
// ── Recipe format ────────────────────────────────────────────────────────────
// A recipe is an array of layers (or a single layer object). Each layer is one
// voice that starts at `t0` seconds into the sound and lasts `dur` seconds:
//
//   { src: 'tone',                 // an oscillator
//     wave: 'sine'|'square'|'sawtooth'|'triangle',
//     f0: 440, f1: 110,            // frequency glide, start -> end (f1 optional)
//     glide: 'exp'|'lin',          // curve of that glide (default 'exp')
//     vibrato: { rate: 40, depth: 30 },   // optional wobble, Hz / Hz
//     cutoff: 2000, filter: 'lowpass',    // optional tone shaping
//     t0: 0, dur: 0.12, gain: 0.4, attack: 0.005 }
//
//   { src: 'noise',                // filtered white noise (bites, hisses, bursts)
//     filter: 'bandpass'|'lowpass'|'highpass',  // default 'bandpass'
//     f0: 3000, f1: 600,           // FILTER CUTOFF glide (not pitch)
//     q: 6,                        // filter resonance
//     t0: 0, dur: 0.08, gain: 0.5, attack: 0.002 }
//
// `repeat: { times: 3, every: 0.09 }` on any layer restates it — that's how the
// hornet's barrage and the army ant's chitter are built.

const NOISE_SECONDS = 1.2;

// Guard rails so a 20-ant melee can't turn into a wall of noise.
const MAX_VOICES = 14; // hard cap on simultaneously sounding layers
const DEFAULT_THROTTLE_MS = 55; // min gap between two plays of the SAME key

export class ArenaAudio {
  constructor({ volume = 0.7, muted = false } = {}) {
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.muted = muted;
    this.volume = volume;

    this.ctx = null;
    this.master = null;
    this._noise = null;
    this._voices = 0;
    this._lastPlayed = new Map(); // throttle key -> timestamp (ms)

    // Browsers refuse to start audio without a user gesture. Create the context
    // lazily and resume it on the first interaction, so the page never console-
    // errors and sound simply switches on the moment the user touches anything.
    this._armGestureUnlock();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  _armGestureUnlock() {
    if (!this.supported || typeof window === 'undefined') return;
    const unlock = () => {
      this.resume();
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Create the context on demand (safe to call repeatedly). */
  _ensureContext() {
    if (!this.supported || this.ctx) return this.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Resume after the first user gesture (autoplay policy). */
  resume() {
    this._ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** True once the context is actually allowed to make sound. */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
    if (!muted) this.resume();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  /** One second of white noise, generated once and shared by every noise layer. */
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  /**
   * Play a recipe.
   * @param {Array|object} recipe  layer or array of layers (see header)
   * @param {object} [opts]
   *   pan          -1..1 stereo position (the renderer maps arena x onto this)
   *   gain         extra level scaling for this one-shot (default 1)
   *   key          throttle bucket; repeats of the same key are rate-limited
   *   throttleMs   override the default throttle window
   */
  play(recipe, opts = {}) {
    if (!recipe || this.muted || !this.supported) return false;
    this._ensureContext();
    if (!this.ready) return false; // still waiting on the user's first gesture

    const layers = Array.isArray(recipe) ? recipe : [recipe];
    if (!layers.length) return false;

    // Throttle: identical sounds (a squad of ants all biting) collapse into one.
    const now = performance.now();
    if (opts.key) {
      const gap = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
      const last = this._lastPlayed.get(opts.key) ?? -Infinity;
      if (now - last < gap) return false;
      this._lastPlayed.set(opts.key, now);
    }
    if (this._voices >= MAX_VOICES) return false;

    const ctx = this.ctx;
    const start = ctx.currentTime + 0.001; // a hair ahead so ramps schedule cleanly

    // Per-sound bus: stereo placement + one-shot level, feeding the master.
    const bus = ctx.createGain();
    bus.gain.value = Math.max(0, opts.gain ?? 1);
    let tail = bus;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      bus.connect(panner);
      tail = panner;
    }
    tail.connect(this.master);

    for (const layer of layers) {
      const rep = layer.repeat;
      const times = Math.max(1, Math.min(8, rep?.times ?? 1));
      const every = rep?.every ?? 0;
      for (let i = 0; i < times; i++) this._playLayer(layer, start + i * every, bus);
    }
    return true;
  }

  /** Build and schedule one layer of a recipe. */
  _playLayer(layer, when, bus) {
    const ctx = this.ctx;
    const t0 = when + (layer.t0 ?? 0);
    const dur = Math.max(0.01, layer.dur ?? 0.12);
    const peak = Math.max(0.0002, layer.gain ?? 0.4);
    const attack = Math.max(0.001, layer.attack ?? Math.min(0.012, dur * 0.2));

    // Envelope: quick fade-in then an exponential decay to silence. Exponential
    // ramps can't reach 0, so we bottom out at a negligible value instead.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    env.connect(bus);

    let source;
    let head = env; // what the source (or its filter) connects into

    if (layer.src === 'noise') {
      source = ctx.createBufferSource();
      source.buffer = this._noiseBuffer();
      source.loop = true;
      // For noise layers f0/f1 are the FILTER cutoff glide — that's what turns
      // flat white noise into a bite, a hiss, or a steam blast.
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter ?? 'bandpass';
      filter.Q.value = layer.q ?? 4;
      this._glide(filter.frequency, layer.f0 ?? 1800, layer.f1, t0, dur, layer.glide);
      filter.connect(env);
      head = filter;
    } else {
      source = ctx.createOscillator();
      source.type = layer.wave ?? 'sine';
      this._glide(source.frequency, layer.f0 ?? 440, layer.f1, t0, dur, layer.glide);

      if (layer.vibrato) {
        // A second oscillator wobbling the pitch — this is what makes the hornet
        // buzz read as a living, angry insect rather than a flat tone.
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = layer.vibrato.rate ?? 30;
        depth.gain.value = layer.vibrato.depth ?? 20;
        lfo.connect(depth);
        depth.connect(source.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur);
      }

      if (layer.cutoff) {
        const filter = ctx.createBiquadFilter();
        filter.type = layer.filter ?? 'lowpass';
        filter.frequency.value = layer.cutoff;
        filter.Q.value = layer.q ?? 1;
        filter.connect(env);
        head = filter;
      }
    }

    source.connect(head);
    source.start(t0);
    source.stop(t0 + dur + 0.02);

    // Voice accounting. `onended` is the normal path, but it must NOT be the only
    // one: a missed callback would leak the slot forever and, once the budget
    // filled up, silence the arena permanently. A timer backstop releases the slot
    // regardless, and the `released` latch keeps the pair from double-counting.
    this._voices += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this._voices = Math.max(0, this._voices - 1);
      try {
        source.disconnect();
      } catch {
        /* already torn down */
      }
    };
    source.onended = release;
    const lifetimeMs = ((layer.t0 ?? 0) + dur + 0.1) * 1000;
    setTimeout(release, Math.ceil(lifetimeMs) + 50);
  }

  /** Schedule a parameter glide from `a` to `b` across the layer's duration. */
  _glide(param, a, b, t0, dur, curve) {
    const from = Math.max(1, a);
    param.setValueAtTime(from, t0);
    if (b == null || b === a) return;
    const to = Math.max(1, b);
    if (curve === 'lin') param.linearRampToValueAtTime(to, t0 + dur);
    else param.exponentialRampToValueAtTime(to, t0 + dur);
  }
}

// -----------------------------------------------------------------------------
// Arena sounds — the handful that belong to the STADIUM, not to any species.
// Species voices live in their own species file, next to their stats and art.
// -----------------------------------------------------------------------------

export const ARENA_SFX = {
  // Battle start: a low ceremonial horn with a bright fifth over it.
  battleStart: [
    { src: 'tone', wave: 'sawtooth', f0: 138, f1: 146, dur: 0.9, gain: 0.16, attack: 0.06, cutoff: 900 },
    { src: 'tone', wave: 'triangle', f0: 208, f1: 220, dur: 0.85, gain: 0.1, attack: 0.09, t0: 0.06 },
  ],
  // Victory: a rising three-note flourish.
  victory: [
    { src: 'tone', wave: 'triangle', f0: 392, dur: 0.16, gain: 0.16, t0: 0 },
    { src: 'tone', wave: 'triangle', f0: 523, dur: 0.16, gain: 0.16, t0: 0.15 },
    { src: 'tone', wave: 'triangle', f0: 659, dur: 0.42, gain: 0.2, t0: 0.3 },
    { src: 'tone', wave: 'sine', f0: 131, dur: 0.6, gain: 0.12, t0: 0.3 },
  ],
  // Draw: the same shape, unresolved and sagging.
  draw: [
    { src: 'tone', wave: 'triangle', f0: 392, dur: 0.18, gain: 0.14 },
    { src: 'tone', wave: 'triangle', f0: 330, f1: 294, dur: 0.5, gain: 0.14, t0: 0.17 },
  ],
  // A morsel picked up — a soft granular tick.
  eat: { src: 'noise', filter: 'bandpass', f0: 2600, f1: 1200, q: 7, dur: 0.05, gain: 0.12 },
  // A colony's foraging paid off and a new unit marches in. Spawning belongs to
  // the arena rather than to any one species, so both muster calls live here.
  muster: [
    { src: 'tone', wave: 'triangle', f0: 330, f1: 494, dur: 0.16, gain: 0.14 },
    { src: 'noise', filter: 'bandpass', f0: 1800, f1: 3200, q: 3, dur: 0.12, gain: 0.1 },
  ],
  // ...and the rarer, weightier version when what hatches is a BUG.
  musterBug: [
    { src: 'tone', wave: 'sawtooth', f0: 165, f1: 262, dur: 0.34, gain: 0.2, cutoff: 1200 },
    { src: 'tone', wave: 'triangle', f0: 330, f1: 523, dur: 0.3, gain: 0.14, t0: 0.08 },
    { src: 'noise', filter: 'lowpass', f0: 2200, f1: 500, dur: 0.2, gain: 0.16 },
  ],
};
