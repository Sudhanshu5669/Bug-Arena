// CanvasRenderer — the browser preview renderer, styled as a gladiator arena.
//
// Still a pure *subscriber* to engine snapshots: it renders state, never mutates
// the sim. Two coordinate spaces are kept deliberately separate:
//
//   • SCENE space   = the engine's arena coords (e.g. 960x600). Agents live here.
//   • CANVAS space   = the render target (16:9, 1280x720). Stadium dressing lives here.
//
// A `camera` transform maps scene -> canvas. To re-letterbox for 9:16 shorts
// later, only RENDER_W/RENDER_H + the camera fit change — the scene, the engine,
// and every draw call in scene coords stay identical.
//
// Layering per frame:
//   1. static background (offscreen, built once): stadium, sand floor, stone ring,
//      banners, torch glows, vignette
//   2. torch flame flicker (cheap dynamic)
//   3. [camera transform] food, drop shadows, team glow, sprites, effects
//
// The species body is drawn by `drawAgent` (the pluggable descriptor layer);
// everything else here is scene chrome.

import { drawAgent, SpriteCache } from './rendererAbstraction.js';
import { preloadSprites } from './spriteLoader.js';

const TEAM = {
  A: { ring: '#4ea1ff', glow: 'rgba(78,161,255,0.55)' },
  B: { ring: '#ff5d73', glow: 'rgba(255,93,115,0.55)' },
};
// At most this many ability tags float at once — past a handful they stop being
// readable and just smear over the fight.
const MAX_ABILITY_TAGS = 4;
/**
 * Big area-of-effect flourishes. These are the ones that used to blow out to a
 * flat white smear when several landed together: each is a large, bright, mostly
 * additive shape, and additive blending SUMS — so three overlapping auras clip
 * to white and erase the fight underneath. They are capped in number and drawn
 * without additive blending (see `_drawEffects`).
 */
const WIDE_FX = new Set([
  'leaf_shield', 'rally', 'heal_burst', 'sand_pit', 'chemical_blast',
  'poison_cloud', 'web_splash', 'spawn_in', 'brood', 'enrage', 'explosion', 'acid',
]);
const MAX_WIDE_FX = 3; // concurrent; oldest is dropped past this

// --- showreel timing ---------------------------------------------------------
const INTRO_SECONDS = 2.0; // VS card holds, then fades off the opening
const REPLAY_FRAMES = 70; // snapshots of the finish that get replayed (~1.2s)
const REPLAY_HISTORY = 240; // ring buffer depth (must exceed REPLAY_FRAMES)
const REPLAY_RATE = 0.3; // playback speed of the replay — the slow-mo
const REPLAY_ZOOM = 2.6; // how far the camera punches in on the killing blow
const OUTRO_DELAY = 0.35; // beat between the replay ending and the winner card

// Status chips shown above a single agent; the rest are truncated to "+N".
const MAX_STATUS_LABELS = 2;
// ...and chips are suppressed entirely while more than this many bugs are alive.
const STATUS_LABEL_MAX_AGENTS = 8;

const STATUS_COLOR = {
  burn: '#ff7a2c',
  web: '#c9a8ff',
  stagger: '#ffd24a',
  poison: '#8fe04a',
  slow: '#6ad0d8',
  enraged: '#ff4d4d',
  // buffs read cool/bright, self-inflicted penalties read hot/sour
  bulwark: '#7bd88f',
  swarm: '#ff8a5c',
  rally: '#ffb14a',
  carapace: '#9aa8bd',
  recoil: '#e8a06a',
  overheat: '#ff6a3c',
  exhausted: '#b98ad8',
  coiled: '#ff8a6a',
  crushed: '#e0563c',
  hardened: '#c9a06a',
  weakened: '#d8e84a',
  gorged: '#ff9a5c',
  glued: '#8ff0e4',
  necrosis: '#8fd05a',
  pitted: '#e3c98a',
};
// Floating damage-number color by cause (falls back to a neutral hit color).
const DAMAGE_COLOR = {
  burn: '#ff9a3c',
  ember_burst: '#ff7a2c',
  dash_strike: '#ffd24a',
  chemical_blast: '#c8ff6a',
  poison: '#8fe04a',
  sting: '#d7c23a',
  snap: '#fff0b0',
  toss: '#e8c98a',
  barrage: '#ffe14a',
  crushed: '#e0563c',
  sweep: '#ff9a7c',
  backblast: '#ff6a3c', // the bombardier cooking itself
  thorns: '#c9a06a',
  acid: '#d8e84a',
  leap: '#ffab6a',
  execute: '#ff5a7a',
  spit: '#8ff0e4',
  necrosis: '#8fd05a',
  pit: '#e3c98a',
};

/** Render targets. 'wide' is the desktop preview; 'short' is 9:16 for YouTube Shorts. */
export const FORMATS = {
  wide: { w: 1280, h: 720, label: '16:9' },
  short: { w: 720, h: 1280, label: '9:16' },
};

export class CanvasRenderer {
  constructor(canvas, init, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.spriteCache = new SpriteCache();

    this.format = FORMATS[opts.format] ? opts.format : 'wide';
    this.RENDER_W = FORMATS[this.format].w;
    this.RENDER_H = FORMATS[this.format].h;

    // --- action camera -------------------------------------------------------
    // A static camera framed the whole arena, so the fight collapsed into a small
    // knot in the middle of a lot of empty sand and the bugs read as specks. The
    // camera now chases the action and zooms so the fighting fills the frame.
    this.cameraFollow = opts.cameraFollow !== false;
    this._cam = null; // smoothed { cx, cy, scale } in scene coords
    this._heat = []; // recent combat positions: where the camera should look

    // --- showreel director ---------------------------------------------------
    // Packages a battle as a piece of short-form video: a VS card over the
    // opening, a slow-motion instant replay of the killing blow, then a winner
    // card. Purely presentational — the simulation neither knows nor cares.
    this.showreel = opts.showreel !== false;
    this._phase = 'live'; // 'intro' | 'live' | 'replay' | 'outro'
    this._phaseT = 0; // seconds spent in the current phase
    this._history = []; // recent snapshots, for the replay
    this._summary = null;
    this._replayAt = 0; // fractional index into _history while replaying
    this._replayStart = 0; // first history frame of the replay window
    this._introChecked = false; // has the first post-init snapshot been vetted?
    this._finalBlow = null; // where the last kill landed (the replay's focus)
    this._rosterA = [];
    this._rosterB = [];

    this.latest = null;
    this.effects = [];
    this._floatText = []; // rising combat text: damage numbers, ability tags, K.O.
    this._prevPos = new Map(); // id -> {x,y} for movement detection
    this._agentFx = new Map(); // id -> { flash } attack pop timers
    this._lastFrameTs = 0;

    // Food morsel art, drawn directly from SVG (crisp at any zoom). Until it loads
    // — or if it 404s — `_drawFood` falls back to a procedural pellet, so food is
    // never invisible.
    this._foodImg = null;
    this._loadFoodSprite();

    this.setInit(init);
  }

  _loadFoodSprite() {
    const img = new Image();
    img.onload = () => {
      this._foodImg = img;
    };
    img.onerror = () => {
      this._foodImg = null; // keep the procedural fallback
      console.warn('[food] food.svg failed to load — using procedural morsel.');
    };
    img.src = '/assets/sprites/src/food.svg';
  }

  /** Switch render target between the wide preview and the 9:16 Shorts frame. */
  setFormat(format) {
    if (!FORMATS[format] || format === this.format) return;
    this.format = format;
    this.RENDER_W = FORMATS[format].w;
    this.RENDER_H = FORMATS[format].h;
    this._cam = null; // re-frame from scratch for the new aspect
    if (this.arena) {
      this.canvas.width = this.RENDER_W;
      this.canvas.height = this.RENDER_H;
      this._setupCamera();
      this._buildBackground();
    }
  }

  setCameraFollow(on) {
    this.cameraFollow = !!on;
  }

  /** Toggle the intro/replay/outro presentation without touching the simulation. */
  setShowreel(on) {
    this.showreel = !!on;
    if (!this.showreel && this._phase !== 'live') {
      // Leaving showreel mid-reel: drop straight back to the plain live view.
      this._phase = 'live';
      this._phaseT = 0;
      if (this._history.length) this.latest = this._history[this._history.length - 1];
    }
  }

  /** (Re)configure from an init payload: scene dims, catalog, camera, background, sprites. */
  setInit(init) {
    this.arena = init.arena; // scene dimensions
    this.catalog = {};
    for (const s of init.catalog) this.catalog[s.id] = s;

    this.canvas.width = this.RENDER_W;
    this.canvas.height = this.RENDER_H;

    this._cam = null;
    this._heat = [];
    this._setupCamera();
    this._buildBackground();

    // A fresh battle restarts the reel.
    this._phase = this.showreel ? 'intro' : 'live';
    this._phaseT = 0;
    this._introChecked = false;
    this._history = [];
    this._summary = null;
    this._finalBlow = null;
    this._rosterA = [];
    this._rosterB = [];

    // Preload one sprite image per species (async; shapes show until loaded).
    preloadSprites(init.catalog, this.spriteCache, '/assets/sprites');

    this.effects = [];
    this._floatText = [];
    this._prevPos.clear();
    this._agentFx.clear();
  }

  /**
   * The BASE camera: the fully zoomed-out framing that fits the whole arena. It
   * defines the minimum zoom and is what the action camera falls back to when
   * there's nothing in particular to look at.
   */
  _setupCamera() {
    const cw = this.RENDER_W;
    const ch = this.RENDER_H;
    const sw = this.arena.width;
    const sh = this.arena.height;
    // Leave a margin for the stone ring and stadium dressing.
    const fit = Math.min((cw * 0.86) / sw, (ch * 0.86) / sh);
    this.baseScale = fit;
    this.camera = { scale: fit, offX: (cw - sw * fit) / 2, offY: (ch - sh * fit) / 2, sw, sh };
  }

  toCanvasX(x) {
    return this.camera.offX + x * this.camera.scale;
  }

  toCanvasY(y) {
    return this.camera.offY + y * this.camera.scale;
  }

  /**
   * Drive the action camera one frame.
   *
   * The target framing is the bounding box of the LIVING agents, biased toward
   * where fighting actually happened recently (`_heat`), so the shot favours the
   * brawl over a lone forager wandering off in a corner. Zoom is capped so a
   * one-on-one doesn't balloon into an extreme close-up, and the result is
   * exponentially smoothed so the camera glides instead of snapping.
   */
  _updateCamera(dt) {
    const sw = this.arena.width;
    const sh = this.arena.height;
    const cw = this.RENDER_W;
    const ch = this.RENDER_H;

    // Where to look, and how much has to fit.
    let target = { cx: sw / 2, cy: sh / 2, scale: this.baseScale };

    if (this.cameraFollow && this.latest?.agents?.length) {
      const agents = this.latest.agents;
      let pts;

      if (this._heat.length >= 3) {
        // There IS a fight: aim at it, and only let bugs NEAR the fight influence
        // the framing. Otherwise a lone forager off in a corner drags the camera
        // wide and shrinks the actual battle back down to specks.
        //
        // Note this picks the DENSEST cluster of combat rather than the average of
        // all of it: when a battle splits into two brawls, the mean lands in the
        // empty gap between them and frames neither. Locking onto the busiest one
        // gives a real shot, the way a camera operator would cover it.
        const CLUSTER = 200;
        let best = this._heat[0];
        let bestScore = -1;
        for (const h of this._heat) {
          let score = 0;
          for (const o of this._heat) {
            if (Math.hypot(h.x - o.x, h.y - o.y) <= CLUSTER) score += o.life;
          }
          if (score > bestScore) {
            bestScore = score;
            best = h;
          }
        }
        const near = this._heat.filter((h) => Math.hypot(h.x - best.x, h.y - best.y) <= CLUSTER);
        let hx = 0;
        let hy = 0;
        for (const h of near) {
          hx += h.x;
          hy += h.y;
        }
        hx /= near.length;
        hy /= near.length;
        const NEAR = 260;
        pts = near.map((h) => ({ x: h.x, y: h.y, w: 3 }));
        for (const a of agents) {
          if (Math.hypot(a.x - hx, a.y - hy) <= NEAR) pts.push({ x: a.x, y: a.y, w: 1 });
        }
      } else {
        // Pre-contact (or a lull): frame everyone so the armies read as they close.
        pts = agents.map((a) => ({ x: a.x, y: a.y, w: 1 }));
      }

      let sumW = 0;
      let cx = 0;
      let cy = 0;
      for (const p of pts) {
        cx += p.x * p.w;
        cy += p.y * p.w;
        sumW += p.w;
      }
      cx /= sumW;
      cy /= sumW;

      // Spread around that centre — use a weighted stddev so a single far-flung
      // straggler can't yank the camera all the way out.
      let varX = 0;
      let varY = 0;
      for (const p of pts) {
        varX += p.w * (p.x - cx) ** 2;
        varY += p.w * (p.y - cy) ** 2;
      }
      const sdX = Math.sqrt(varX / sumW);
      const sdY = Math.sqrt(varY / sumW);

      // Frame ~2.2 standard deviations, with a floor so it never over-zooms.
      const needW = Math.max(220, sdX * 4.4 + 140);
      const needH = Math.max(220, sdY * 4.4 + 140);
      const want = Math.min(cw / needW, ch / needH);
      target = {
        cx,
        cy,
        scale: Math.max(this.baseScale, Math.min(this.baseScale * 3.2, want)),
      };
    }

    // During the slow-mo replay, override the framing to punch in on the killing
    // blow — that's the whole reason the replay exists.
    if (this._phase === 'replay' && this._finalBlow) {
      target = {
        cx: this._finalBlow.x,
        cy: this._finalBlow.y,
        scale: Math.min(this.baseScale * 3.2, this.baseScale * REPLAY_ZOOM),
      };
    }

    if (!this._cam) this._cam = { ...target };
    // Exponential smoothing, frame-rate independent. Zoom eases slower than pan
    // so rapid deaths don't make the frame pump in and out.
    const lerp = (a, b, k) => a + (b - a) * (1 - Math.exp(-k * dt));
    this._cam.cx = lerp(this._cam.cx, target.cx, 3.0);
    this._cam.cy = lerp(this._cam.cy, target.cy, 3.0);
    this._cam.scale = lerp(this._cam.scale, target.scale, 1.8);

    // Commit to the draw transform, clamped so we never pan past the arena edges
    // (which would reveal empty space beside the floor).
    const s = this._cam.scale;
    const halfW = cw / (2 * s);
    const halfH = ch / (2 * s);
    const cx = halfW * 2 >= sw ? sw / 2 : Math.max(halfW, Math.min(sw - halfW, this._cam.cx));
    const cy = halfH * 2 >= sh ? sh / 2 : Math.max(halfH, Math.min(sh - halfH, this._cam.cy));
    this.camera.scale = s;
    this.camera.offX = cw / 2 - cx * s;
    this.camera.offY = ch / 2 - cy * s;
  }

  /** Remember where combat is happening so the camera has something to aim at. */
  _addHeat(x, y) {
    if (x == null || y == null) return;
    this._heat.push({ x, y, life: 1 });
    if (this._heat.length > 40) this._heat.shift();
  }

  _ageHeat(dt) {
    for (const h of this._heat) h.life -= dt / 2.5; // combat stays "hot" for ~2.5s
    this._heat = this._heat.filter((h) => h.life > 0);
  }

  // ---------------------------------------------------------------------------
  // Static background (built once per setInit into an offscreen canvas)
  // ---------------------------------------------------------------------------

  /**
   * The background is built in TWO pieces, because the camera now moves:
   *
   *  • `bgFloor`  — the arena itself (stone ring, sand, grit, scuffs, banners,
   *                 torch sconces) rasterized once in SCENE coordinates. It is
   *                 drawn through the camera transform, so it pans and zooms with
   *                 the action exactly like the bugs standing on it.
   *  • `bgChrome` — the dark stadium surround, drawn in CANVAS space behind
   *                 everything, plus a vignette laid over the top at the end.
   *
   * Baking the floor at scene resolution (rather than at canvas resolution for one
   * fixed framing, as before) is what makes a zooming camera possible at all.
   */
  _buildBackground() {
    const sw = this.arena.width;
    const sh = this.arena.height;
    const ring = 26; // stone wall thickness, in SCENE units
    this._ring = ring;

    // --- 1) the floor, in scene space -----------------------------------------
    const floor = document.createElement('canvas');
    floor.width = Math.ceil(sw + ring * 2);
    floor.height = Math.ceil(sh + ring * 2);
    const c = floor.getContext('2d');

    const ax = ring; // arena origin inside this offscreen canvas
    const ay = ring;
    const cornerFloor = Math.min(sw, sh) * 0.14;
    const cornerRing = cornerFloor + ring * 0.5;

    // stone boundary ring
    roundRect(c, 0, 0, sw + ring * 2, sh + ring * 2, cornerRing);
    const stone = c.createLinearGradient(0, 0, 0, sh + ring * 2);
    stone.addColorStop(0, '#5b5048');
    stone.addColorStop(0.5, '#3a322c');
    stone.addColorStop(1, '#241e19');
    c.fillStyle = stone;
    c.fill();
    c.save();
    roundRect(c, 0, 0, sw + ring * 2, sh + ring * 2, cornerRing);
    c.clip();
    c.strokeStyle = 'rgba(255,220,180,0.10)';
    c.lineWidth = 3;
    roundRect(c, 2, 2, sw + ring * 2 - 4, sh + ring * 2 - 4, cornerRing);
    c.stroke();
    c.restore();
    this._ringBlocks(c, 0, 0, sw + ring * 2, sh + ring * 2, cornerRing, ring);

    // sand floor
    c.save();
    roundRect(c, ax, ay, sw, sh, cornerFloor);
    c.clip();
    const cx = ax + sw / 2;
    const cy = ay + sh / 2;
    const sand = c.createRadialGradient(cx, cy * 0.98, sw * 0.05, cx, cy, Math.max(sw, sh) * 0.72);
    sand.addColorStop(0, '#d8b483');
    sand.addColorStop(0.55, '#bd925f');
    sand.addColorStop(1, '#7f5433');
    c.fillStyle = sand;
    c.fillRect(ax, ay, sw, sh);
    this._speckle(c, ax, ay, sw, sh, 4200, 'rgba(60,38,20,0.16)');
    this._speckle(c, ax, ay, sw, sh, 2600, 'rgba(255,240,210,0.10)');
    this._scuffs(c, cx, cy, sw, sh);
    c.strokeStyle = 'rgba(0,0,0,0.38)';
    c.lineWidth = 16;
    roundRect(c, ax + 8, ay + 8, sw - 16, sh - 16, cornerFloor);
    c.stroke();
    c.restore();

    // dressing, also in scene space so it travels with the floor
    this._banners(c, ax, ay - ring, sw);
    // Torch positions are stored in ARENA coords (the flame layer draws them
    // inside the camera transform).
    this._torches = [
      { x: -ring, y: -ring },
      { x: sw + ring, y: -ring },
      { x: -ring, y: sh + ring },
      { x: sw + ring, y: sh + ring },
    ];
    for (const t of this._torches) this._torchBase(c, t.x + ring, t.y + ring);

    this.bgFloor = floor;

    // --- 2) stadium surround + vignette, in canvas space ----------------------
    const W = this.RENDER_W;
    const H = this.RENDER_H;
    const chrome = document.createElement('canvas');
    chrome.width = W;
    chrome.height = H;
    const k = chrome.getContext('2d');
    const back = k.createLinearGradient(0, 0, 0, H);
    back.addColorStop(0, '#0d0b09');
    back.addColorStop(0.55, '#16110c');
    back.addColorStop(1, '#0a0806');
    k.fillStyle = back;
    k.fillRect(0, 0, W, H);
    this._speckle(k, 0, 0, W, H, 1200, 'rgba(255,225,190,0.02)');
    this.bgChrome = chrome;

    const vig = document.createElement('canvas');
    vig.width = W;
    vig.height = H;
    const v = vig.getContext('2d');
    const g = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
    this.bgVignette = vig;
  }

  _speckle(c, x, y, w, h, count, color) {
    c.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const px = x + Math.random() * w;
      const py = y + Math.random() * h;
      const s = Math.random() < 0.15 ? 2 : 1;
      c.fillRect(px, py, s, s);
    }
  }

  _scuffs(c, cx, cy, aw, ah) {
    c.strokeStyle = 'rgba(60,40,22,0.14)';
    for (let i = 0; i < 10; i++) {
      c.lineWidth = 1 + Math.random() * 2;
      c.beginPath();
      const r = (0.15 + Math.random() * 0.32) * Math.min(aw, ah);
      const a0 = Math.random() * Math.PI * 2;
      c.arc(cx + (Math.random() - 0.5) * aw * 0.3, cy + (Math.random() - 0.5) * ah * 0.3, r, a0, a0 + 0.6 + Math.random());
      c.stroke();
    }
  }

  _ringBlocks(c, x, y, w, h, r, ring) {
    // Faint block seams around the stone ring for a masonry feel.
    c.save();
    roundRect(c, x, y, w, h, r);
    c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 1.5;
    const step = 46;
    for (let bx = x; bx < x + w; bx += step) {
      c.beginPath();
      c.moveTo(bx, y);
      c.lineTo(bx, y + ring);
      c.moveTo(bx + step / 2, y + h - ring);
      c.lineTo(bx + step / 2, y + h);
      c.stroke();
    }
    for (let by = y; by < y + h; by += step) {
      c.beginPath();
      c.moveTo(x, by);
      c.lineTo(x + ring, by);
      c.moveTo(x + w - ring, by + step / 2);
      c.lineTo(x + w, by + step / 2);
      c.stroke();
    }
    c.restore();
  }

  _banners(c, ax, topY, aw) {
    const colors = ['#8a1f2b', '#b8892b', '#2b4d8a', '#6a2b8a'];
    const n = 5;
    const gap = aw / n;
    for (let i = 0; i < n; i++) {
      const x = ax + gap * (i + 0.5);
      const w = gap * 0.34;
      const y = topY - 54;
      const h = 46;
      // pole/rod
      c.fillStyle = '#2a211a';
      c.fillRect(x - w / 2 - 4, y - 4, w + 8, 4);
      // cloth
      c.fillStyle = colors[i % colors.length];
      c.beginPath();
      c.moveTo(x - w / 2, y);
      c.lineTo(x + w / 2, y);
      c.lineTo(x + w / 2, y + h);
      c.lineTo(x, y + h + 10);
      c.lineTo(x - w / 2, y + h);
      c.closePath();
      c.fill();
      // emblem dot
      c.fillStyle = 'rgba(255,225,170,0.55)';
      c.beginPath();
      c.arc(x, y + h * 0.5, w * 0.16, 0, Math.PI * 2);
      c.fill();
    }
  }

  _torchBase(c, x, y) {
    // Warm glow pool baked into the background; the flame flickers in the fg layer.
    const g = c.createRadialGradient(x, y, 2, x, y, 60);
    g.addColorStop(0, 'rgba(255,170,70,0.45)');
    g.addColorStop(1, 'rgba(255,150,60,0)');
    c.fillStyle = g;
    c.fillRect(x - 60, y - 60, 120, 120);
    // sconce
    c.fillStyle = '#241a12';
    c.fillRect(x - 4, y - 2, 8, 16);
  }

  // ---------------------------------------------------------------------------
  // Snapshot intake + effect spawning
  // ---------------------------------------------------------------------------

  ingest(snapshot) {
    // During the replay/outro the renderer is driving itself off `_history`; live
    // snapshots would fight it for control of `latest`.
    if (this._phase === 'replay' || this._phase === 'outro') return;

    // The intro "VS" card is for a genuine battle OPENING. The live-preview socket
    // reconnects and replays the current snapshot on catch-up, which would slap the
    // card over a fight already in progress — so if the first snapshot after an init
    // is already well underway, skip straight to the live view.
    if (this._phase === 'intro' && !this._introChecked) {
      this._introChecked = true;
      if ((snapshot.time ?? 0) > 1.2) {
        this._phase = 'live';
        this._phaseT = 0;
      }
    }

    this.latest = snapshot;

    if (this.showreel) {
      // Ring buffer deep enough to cover the replay window.
      this._history.push(snapshot);
      if (this._history.length > REPLAY_HISTORY) this._history.shift();
      if (!this._rosterA.length) this._captureRosters(snapshot);

      // Remember where the last kill landed — that's what the replay frames.
      for (const ev of snapshot.events) {
        if (ev.type === 'death') this._finalBlow = { x: ev.x, y: ev.y };
      }
      if (snapshot.status === 'finished') {
        this._summary = snapshot.summary ?? null;
        this._applyEvents(snapshot);
        this._beginReplay();
        return;
      }
    }

    this._applyEvents(snapshot);
  }

  /** Roster tallies for the VS card, taken from the opening snapshot. */
  _captureRosters(snapshot) {
    const tally = (team) => {
      const counts = {};
      for (const a of snapshot.agents) {
        if (a.team !== team) continue;
        counts[a.speciesId] = (counts[a.speciesId] ?? 0) + 1;
      }
      return Object.entries(counts)
        .sort((x, y) => y[1] - x[1])
        .map(([id, n]) => ({ name: this.catalog[id]?.name ?? id, n, color: this.catalog[id]?.visual?.color ?? '#999' }));
    };
    this._rosterA = tally('A');
    this._rosterB = tally('B');
  }

  /** Rewind into the buffered final moments and play them back in slow motion. */
  _beginReplay() {
    const frames = Math.min(this._history.length, REPLAY_FRAMES);
    if (frames < 8) {
      // Too short to be worth replaying (an instant wipe) — go straight to the card.
      this._phase = 'outro';
      this._phaseT = 0;
      return;
    }
    this._replayStart = this._history.length - frames;
    this._replayAt = this._replayStart;
    this._phase = 'replay';
    this._phaseT = 0;
    // Clear transient art so the replay rebuilds it, in step, as the moment replays.
    this.effects = [];
    this._floatText = [];
    this._heat = [];
    this.latest = this._history[this._replayStart];
    this._applyEvents(this.latest);
  }

  /**
   * Drive the showreel clock one frame: hold the intro, scrub the slow-mo replay
   * through the buffered final moments, and hand off to the outro card. In 'live'
   * (and when showreel is off) this does nothing — the renderer just plays the
   * incoming snapshot stream straight.
   */
  _advancePhase(dt) {
    if (!this.showreel) return;
    this._phaseT += dt;

    if (this._phase === 'intro') {
      if (this._phaseT >= INTRO_SECONDS) {
        this._phase = 'live';
        this._phaseT = 0;
      }
      return;
    }

    if (this._phase === 'replay') {
      const prevIdx = Math.floor(this._replayAt);
      // History was captured at the tick rate; playing it at REPLAY_RATE gives the
      // slow-mo. dt-scaled so playback speed is the same at any frame rate.
      this._replayAt += REPLAY_RATE * 60 * dt;
      const last = this._history.length - 1;
      let idx = Math.floor(this._replayAt);
      if (idx >= last) {
        this.latest = this._history[last];
        this._applyEventsRange(prevIdx + 1, last);
        this._phase = 'outro';
        this._phaseT = 0;
        return;
      }
      this.latest = this._history[idx];
      this._applyEventsRange(prevIdx + 1, idx);
    }
  }

  /** Replay the events of every history frame in [from, to] (inclusive). */
  _applyEventsRange(from, to) {
    for (let f = Math.max(this._replayStart, from); f <= to; f++) {
      if (this._history[f]) this._applyEvents(this._history[f]);
    }
  }

  /** Turn one snapshot's events into effects, floating text and camera heat. */
  _applyEvents(snapshot) {
    for (const ev of snapshot.events) {
      if (ev.type === 'effect') {
        if (ev.kind === 'dash') {
          // The dash becomes a train of fading AFTERIMAGES of the caster along the
          // whole charge, plus a landing shock — far punchier than a plain line.
          this.effects.push({
            kind: 'afterimage',
            x1: ev.x1,
            y1: ev.y1,
            x2: ev.x2,
            y2: ev.y2,
            angle: ev.angle ?? Math.atan2((ev.y2 ?? 0) - (ev.y1 ?? 0), (ev.x2 ?? 0) - (ev.x1 ?? 0)),
            speciesId: ev.speciesId,
            life: 1,
            ttl: 0.42,
          });
          this.effects.push({ kind: 'dash_shock', x: ev.x2, y: ev.y2, life: 1, ttl: 0.32 });
        } else if (ev.kind === 'windup') {
          // Lives exactly as long as the engine's wind-up so the build-up lands
          // right as the ability fires.
          this.effects.push({ ...ev, life: 1, ttl: Math.max(0.12, ev.duration ?? 0.2) });
        } else {
          this.effects.push({ ...ev, life: 1, ttl: ttlFor(ev.kind) });
          // Keep the number of big auras bounded. In a scrum a dozen of these can
          // land inside a second and the arena disappears under them.
          if (WIDE_FX.has(ev.kind)) {
            const wide = this.effects.filter((f) => WIDE_FX.has(f.kind));
            for (let n = wide.length - MAX_WIDE_FX; n > 0; n--) {
              const oldest = wide.reduce((a, b) => (a.life <= b.life ? a : b));
              this.effects.splice(this.effects.indexOf(oldest), 1);
              wide.splice(wide.indexOf(oldest), 1);
            }
          }
        }
      } else if (ev.type === 'attack') {
        // Attack "pop" on the attacker + a themed strike mark at the target.
        this._agentFx.set(ev.attackerId, { flash: 1 });
        this._addHeat(ev.x, ev.y);
        if (ev.kind === 'melee') {
          this.effects.push({ kind: 'slash', x: ev.x, y: ev.y, life: 1, ttl: 0.18 });
        }
      } else if (ev.type === 'damage') {
        this._addDamageNumber(ev);
      } else if (ev.type === 'ability') {
        this._addHeat(ev.x, ev.y);
        this._addAbilityTag(ev);
      } else if (ev.type === 'reinforcement') {
        // A colony's foraging birthed a new unit — announce it above the muster point.
        this._floatText.push({
          kind: 'ability',
          text: ev.isBug ? `★ ${ev.speciesName}!` : `+ ${ev.speciesName}`,
          x: ev.x ?? 0,
          y: (ev.y ?? 0) - 8,
          color: ev.isBug ? '#ffd24a' : ev.team === 'B' ? '#ff9aa8' : '#9ec9ff',
          rise: 24,
          life: 1,
          ttl: 1.4,
        });
      } else if (ev.type === 'death') {
        const color = this.catalog[ev.victimSpecies]?.visual?.color || '#caa';
        this._addHeat(ev.x, ev.y);
        this.effects.push({ kind: 'poof', x: ev.x, y: ev.y, color, life: 1, ttl: 0.5 });
        this._floatText.push({
          kind: 'ko',
          text: 'K.O.',
          x: ev.x ?? 0,
          y: ev.y ?? 0,
          color: '#ff6b6b',
          rise: 16,
          life: 1,
          ttl: 1.1,
        });
      }
    }
  }

  /**
   * Floating ability tag ("Web Trap!").
   *
   * In a real melee a dozen of these fire within a second on top of each other and
   * the result is an unreadable smear of overlapping words. Two defences:
   *  - the SAME ability firing again nearby folds into the existing tag as "×N"
   *    rather than stacking a second copy on top of it;
   *  - the number of tags alive at once is capped, oldest dropped first.
   */
  _addAbilityTag(ev) {
    const name = ev.ability ?? 'Ability';
    const x = ev.x ?? 0;
    const y = (ev.y ?? 0) - 6;

    const twin = this._floatText.find(
      (f) => f.kind === 'ability' && f.ability === name && Math.hypot(f.x - x, f.y - y) < 110
    );
    if (twin) {
      twin.count = (twin.count ?? 1) + 1;
      twin.text = `${name}! ×${twin.count}`;
      twin.life = 1; // restart its dwell so the combined tag stays readable
      return;
    }

    this._floatText.push({
      kind: 'ability',
      ability: name,
      count: 1,
      text: `${name}!`,
      x,
      y,
      color: '#ffe08a',
      rise: 26,
      life: 1,
      ttl: 1.0,
    });

    // Cap concurrent tags — beyond a handful nobody can read them anyway.
    const tags = this._floatText.filter((f) => f.kind === 'ability');
    if (tags.length > MAX_ABILITY_TAGS) {
      const oldest = tags.reduce((a, b) => (a.life <= b.life ? a : b));
      this._floatText.splice(this._floatText.indexOf(oldest), 1);
    }
  }

  /**
   * Floating damage number. Rapid hits on the same target MERGE into one rising,
   * accumulating number (so damage-over-time ticks don't spam dozens of popups).
   */
  _addDamageNumber(ev) {
    const amount = Number(ev.amount) || 0;
    if (amount <= 0) return;
    const existing = this._floatText.find(
      (f) => f.kind === 'dmg' && f.targetId === ev.targetId && f.life > 0.62
    );
    if (existing) {
      existing.value += amount;
      existing.text = `-${Math.max(1, Math.round(existing.value))}`;
      existing.life = 1;
      existing.x = ev.x;
      existing.y = ev.y;
    } else {
      this._floatText.push({
        kind: 'dmg',
        targetId: ev.targetId,
        value: amount,
        text: `-${Math.max(1, Math.round(amount))}`,
        x: ev.x,
        y: ev.y,
        color: DAMAGE_COLOR[ev.cause] || '#ffe4d0',
        rise: 22,
        life: 1,
        ttl: 0.85,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Frame composition
  // ---------------------------------------------------------------------------

  render(now = performance.now()) {
    const dt = this._lastFrameTs ? Math.min(0.05, (now - this._lastFrameTs) / 1000) : 0.016;
    this._lastFrameTs = now;

    const ctx = this.ctx;
    this._advancePhase(dt); // hold the intro / scrub the slow-mo replay / cue the outro
    this._updateCamera(dt);

    // 1) stadium surround (static, canvas space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgChrome, 0, 0);

    if (!this.latest) return;

    // 2) enter scene space — floor, bugs and effects all move together
    const { scale, offX, offY } = this.camera;
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    const r = this._ring;
    ctx.drawImage(this.bgFloor, -r, -r);
    this._drawFlames(ctx, now);

    this._drawFood(ctx, this.latest.food);
    this._drawShadows(ctx, this.latest.agents);
    this._drawAgents(ctx, this.latest.agents, now);
    this._drawEffects(ctx);

    // 3) back to canvas space: vignette, then combat text at a CONSTANT readable
    //    size regardless of how far the camera has zoomed in.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bgVignette, 0, 0);
    this._drawFloatText(ctx);

    // 4) showreel dressing, on top of everything
    if (this.showreel) {
      if (this._phase === 'intro') this._drawIntroCard(ctx);
      else if (this._phase === 'replay') this._drawReplayBadge(ctx);
      else if (this._phase === 'outro') this._drawOutroCard(ctx);
    }

    this._ageEffects(dt);
    this._ageAgentFx(dt);
    this._ageFloatText(dt);
    this._ageHeat(dt);
  }

  /**
   * Combat text, drawn in CANVAS space so it stays a constant, legible size no
   * matter how far the action camera has zoomed in.
   *
   * Labels that would land on top of each other are nudged apart vertically —
   * without this, several kills and procs in the same spot render as one
   * illegible smear of overlapping words, which is exactly what a viewer sees at
   * the climax of a fight when it matters most.
   */
  _drawFloatText(ctx) {
    if (!this._floatText.length) return;

    // Project to screen, dropping anything the camera isn't looking at.
    const placed = [];
    for (const f of this._floatText) {
      const sx = this.toCanvasX(f.x);
      const sy = this.toCanvasY(f.y) - (1 - f.life) * (f.rise || 20);
      if (sx < -80 || sx > this.RENDER_W + 80 || sy < -40 || sy > this.RENDER_H + 40) continue;
      placed.push({ f, sx, sy });
    }
    if (!placed.length) return;

    // De-overlap: walk top-down and push each label clear of the one above it.
    placed.sort((a, b) => a.sy - b.sy);
    const MIN_DY = 14;
    for (let i = 1; i < placed.length; i++) {
      const cur = placed[i];
      for (let j = i - 1; j >= 0; j--) {
        const prev = placed[j];
        if (cur.sy - prev.sy >= MIN_DY) break;
        if (Math.abs(cur.sx - prev.sx) < 90) cur.sy = prev.sy + MIN_DY;
      }
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const { f, sx, sy } of placed) {
      const a = Math.max(0, Math.min(1, f.life));
      ctx.globalAlpha = a;
      ctx.font =
        f.kind === 'dmg'
          ? 'bold 15px system-ui, sans-serif'
          : f.kind === 'ko'
            ? 'bold 16px system-ui, sans-serif'
            : 'bold 13px system-ui, sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color || '#fff';
      ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _ageFloatText(dt) {
    for (const f of this._floatText) f.life -= dt / f.ttl;
    this._floatText = this._floatText.filter((f) => f.life > 0);
  }

  // ---------------------------------------------------------------------------
  // Showreel cards (intro "VS", replay badge, outro winner). Drawn in canvas
  // space over the finished frame; purely presentational.
  // ---------------------------------------------------------------------------

  /** A soft dark scrim over the whole frame, at the given alpha. */
  _scrim(ctx, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,5,4,0.82)';
    ctx.fillRect(0, 0, this.RENDER_W, this.RENDER_H);
    ctx.restore();
  }

  /** Team colours, matching the roster/HUD palette in the client. */
  _teamColor(team) {
    return team === 'A' ? '#4ea1ff' : '#ff5d73';
  }

  /**
   * The opening "VS" card: each team's roster stacked, a big VS between them.
   * Holds solid, then fades off over the last third of INTRO_SECONDS so the
   * marching armies are revealed underneath just as contact is about to happen.
   */
  _drawIntroCard(ctx) {
    const t = this._phaseT / INTRO_SECONDS; // 0..1 across the intro
    const fade = t < 0.66 ? 1 : Math.max(0, 1 - (t - 0.66) / 0.34);
    if (fade <= 0) return;
    const pop = Math.min(1, this._phaseT / 0.25); // quick scale-in at the start

    this._scrim(ctx, 0.72 * fade);

    const W = this.RENDER_W;
    const H = this.RENDER_H;
    const portrait = H > W;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "BUG ARENA" kicker
    ctx.font = `700 ${Math.round(16 + 6 * pop)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,225,160,0.85)';
    ctx.fillText('⚔  BUG ARENA  ⚔', W / 2, H * (portrait ? 0.14 : 0.13));

    if (portrait) {
      this._rosterColumn(ctx, this._rosterA, 'A', W / 2, H * 0.30, fade);
      this._drawVS(ctx, W / 2, H * 0.5, pop, fade);
      this._rosterColumn(ctx, this._rosterB, 'B', W / 2, H * 0.70, fade);
    } else {
      this._rosterColumn(ctx, this._rosterA, 'A', W * 0.26, H * 0.52, fade);
      this._drawVS(ctx, W / 2, H * 0.52, pop, fade);
      this._rosterColumn(ctx, this._rosterB, 'B', W * 0.74, H * 0.52, fade);
    }
    ctx.restore();
  }

  /** A big italic "VS" with a stroke, scaled in by `pop`. */
  _drawVS(ctx, cx, cy, pop, fade) {
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.round(46 + 22 * pop);
    ctx.font = `italic 800 ${size}px system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText('VS', cx, cy);
    const g = ctx.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2);
    g.addColorStop(0, '#fff2c8');
    g.addColorStop(1, '#f5a623');
    ctx.fillStyle = g;
    ctx.fillText('VS', cx, cy);
    ctx.restore();
  }

  /**
   * One team's roster centred on (cx, cy): a coloured team header and up to a
   * handful of "N× Species" lines. Extra species collapse into "+K more".
   */
  _rosterColumn(ctx, roster, team, cx, cy, fade) {
    const col = this._teamColor(team);
    const MAX_LINES = 5;
    const lines = roster.slice(0, MAX_LINES);
    const extra = roster.reduce((n, r, i) => (i >= MAX_LINES ? n + r.n : n), 0);
    const lineH = 22;
    const totalH = 30 + lines.length * lineH + (extra ? lineH : 0);
    let y = cy - totalH / 2;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // header
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText(`TEAM ${team}`, cx, y + 14);
    ctx.shadowBlur = 0;
    y += 30 + lineH / 2;

    ctx.font = '600 15px system-ui, sans-serif';
    for (const r of lines) {
      // species swatch
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(cx - 78, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8e2d8';
      ctx.textAlign = 'left';
      ctx.fillText(`${r.n}×  ${r.name}`, cx - 66, y);
      ctx.textAlign = 'center';
      y += lineH;
    }
    if (extra) {
      ctx.fillStyle = 'rgba(220,214,200,0.6)';
      ctx.font = 'italic 13px system-ui, sans-serif';
      ctx.fillText(`+${extra} more`, cx, y);
    }
    ctx.restore();
  }

  /** Small "◉ REPLAY" badge with a blinking dot, top-left during the slow-mo. */
  _drawReplayBadge(ctx) {
    const blink = 0.5 + 0.5 * Math.sin(this._phaseT * 6);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const x = 20;
    const y = 26;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = `rgba(255,80,80,${0.55 + 0.45 * blink})`;
    ctx.beginPath();
    ctx.arc(x + 6, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText('REPLAY', x + 18, y);
    ctx.fillStyle = '#ffe7e7';
    ctx.fillText('REPLAY', x + 18, y);
    ctx.restore();
  }

  /**
   * The winner card. Fades in a beat after the replay ends (OUTRO_DELAY), reads
   * the summary the engine attached to the final snapshot, and holds — a clean
   * end frame for a Short.
   */
  _drawOutroCard(ctx) {
    const fade = Math.max(0, Math.min(1, (this._phaseT - OUTRO_DELAY) / 0.5));
    if (fade <= 0) return;

    this._scrim(ctx, 0.7 * fade);

    const W = this.RENDER_W;
    const H = this.RENDER_H;
    const s = this._summary;
    const winner = s?.winner ?? 'draw';
    const draw = winner === 'draw';
    const col = draw ? '#ffd24a' : this._teamColor(winner);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const midY = H * (H > W ? 0.42 : 0.44);

    // headline
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,230,170,0.9)';
    ctx.fillText(draw ? 'STALEMATE' : 'VICTORY', W / 2, midY - 78);

    // winner line
    ctx.font = `italic 800 ${Math.round(50 + 8 * fade)}px system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    const title = draw ? 'DRAW' : `TEAM ${winner}`;
    ctx.strokeText(title, W / 2, midY - 24);
    ctx.shadowColor = col;
    ctx.shadowBlur = 24 * fade;
    ctx.fillStyle = col;
    ctx.fillText(title, W / 2, midY - 24);
    ctx.shadowBlur = 0;
    if (!draw) {
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillStyle = '#e8e2d8';
      ctx.fillText('WINS', W / 2, midY + 14);
    }

    // stat strip
    if (s) {
      const survA = s.teams?.A?.survivors ?? 0;
      const survB = s.teams?.B?.survivors ?? 0;
      const stats = [
        ['TIME', `${Math.round(s.durationSeconds ?? 0)}s`],
        ['KILLS', String(s.totalKills ?? 0)],
        ['SURVIVORS', `${survA} · ${survB}`],
      ];
      const gap = Math.min(150, W / 4);
      const baseX = W / 2 - gap;
      const statY = midY + 68;
      for (let i = 0; i < stats.length; i++) {
        const x = baseX + i * gap;
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.fillStyle = '#f5e9d0';
        ctx.fillText(stats[i][1], x, statY);
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,192,176,0.7)';
        ctx.fillText(stats[i][0], x, statY + 20);
      }
    }
    ctx.restore();
  }

  _drawFlames(ctx, now) {
    if (!this._torches) return;
    for (let i = 0; i < this._torches.length; i++) {
      const t = this._torches[i];
      const flick = 0.75 + 0.25 * Math.sin(now / 90 + i * 2.1) + 0.12 * Math.sin(now / 37 + i);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // outer flame
      ctx.fillStyle = `rgba(255,140,40,${0.5 * flick})`;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y - 6, 6 * flick, 13 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      // inner core
      ctx.fillStyle = `rgba(255,225,150,${0.85 * flick})`;
      ctx.beginPath();
      ctx.ellipse(t.x, t.y - 5, 3 * flick, 8 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawFood(ctx, food) {
    if (!food) return;
    const img = this._foodImg;
    for (const f of food) {
      // faint ground glisten so the morsel reads against the sand
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,210,120,0.16)';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (img) {
        // The SVG grain, drawn a touch larger than the hit radius so it feels chunky.
        const half = f.size * 2.2;
        ctx.drawImage(img, f.x - half, f.y - half, half * 2, half * 2);
      } else {
        // Procedural fallback morsel (until the SVG loads / if it fails).
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fillStyle = '#e7b96b';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#7a4f22';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(f.x - f.size * 0.3, f.y - f.size * 0.3, f.size * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
      }
    }
  }

  _drawShadows(ctx, agents) {
    for (const a of agents) {
      const size = this.catalog[a.speciesId]?.visual?.size ?? 10;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + size * 0.55, size * 1.15, size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawAgents(ctx, agents, now) {
    const t = now / 1000;
    for (const a of agents) {
      const species = this.catalog[a.speciesId];
      const visual = species?.visual;
      const size = visual?.size ?? 10;

      // --- team glow + footprint ring under the sprite (species-independent identity) ---
      const team = TEAM[a.team] || TEAM.A;
      // soft ground glow
      const glow = ctx.createRadialGradient(a.x, a.y, size * 0.4, a.x, a.y, size * 2.6);
      glow.addColorStop(0, team.glow);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(a.x, a.y, size * 2.6, 0, Math.PI * 2);
      ctx.fill();
      // tinted footprint disc + crisp ring so the side reads at a glance
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = team.ring;
      ctx.beginPath();
      ctx.arc(a.x, a.y, size * 1.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(a.x, a.y, size * 1.75, 0, Math.PI * 2);
      ctx.strokeStyle = team.ring;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // --- last-stand rage: a pulsing red aura under the body (persistent tell) ---
      if (a.statuses.some((s) => s.type === 'enraged')) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 8 + hashId(a.id));
        const rr = size * (1.9 + 0.3 * pulse);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28 + 0.32 * pulse;
        const rage = ctx.createRadialGradient(a.x, a.y, size * 0.5, a.x, a.y, rr);
        rage.addColorStop(0, 'rgba(255,70,55,0.55)');
        rage.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = rage;
        ctx.beginPath();
        ctx.arc(a.x, a.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // --- movement + action driven squash/stretch ---
      const prev = this._prevPos.get(a.id);
      const moved = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) : 0;
      this._prevPos.set(a.id, { x: a.x, y: a.y });
      const phase = t * 11 + hashId(a.id);
      let sx = 1;
      let sy = 1;
      if (a.action === 'windup') {
        // Coil: compress low and wide with a taut quiver — anticipation before release.
        const q = 0.03 * Math.sin(t * 40 + hashId(a.id));
        sy = 0.82 + q;
        sx = 1.16 - q;
      } else if (a.action === 'attack') {
        sy = 1 + 0.1 * Math.sin(t * 22);
        sx = 1 - 0.06 * Math.sin(t * 22);
      } else if (moved > 0.35) {
        sy = 1 + 0.13 * Math.sin(phase); // bounce
        sx = 1 - 0.11 * Math.sin(phase);
      } else {
        const b = 0.04 * Math.sin(t * 3 + hashId(a.id)); // idle breathing
        sy = 1 + b;
        sx = 1 - b;
      }
      // attack lunge pop
      const flash = this._agentFx.get(a.id)?.flash ?? 0;
      if (flash > 0) {
        const pop = 1 + 0.22 * flash;
        sx *= pop;
        sy *= pop;
      }

      // --- webbed / staggered: struggle shake on the body + the right overlay ---
      const webbed = a.statuses.some((s) => s.type === 'web');
      const staggered = a.statuses.some((s) => s.type === 'stagger');
      const shaking = webbed || staggered;
      const jx = shaking ? Math.sin(t * 34 + hashId(a.id)) * 1.6 : 0;
      const jy = shaking ? Math.cos(t * 31 + hashId(a.id)) * 1.2 : 0;

      // --- the species body (sprite, or shape fallback) ---
      ctx.save();
      ctx.translate(jx, jy);
      drawAgent(ctx, a, visual, { spriteCache: this.spriteCache, scaleX: sx, scaleY: sy });
      ctx.restore();

      // --- attack flash glow over the body ---
      if (flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,245,200,${0.5 * flash})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, size * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // --- web net overlaying trapped targets (the "locked down" tell) ---
      if (webbed) drawWebOverlay(ctx, a.x + jx, a.y + jy, size * 1.9);
      // --- dazed: little orbiting stars above a knocked-about bug ---
      if (staggered) drawStaggerOverlay(ctx, a.x + jx, a.y + jy - size * 1.6, size, t + hashId(a.id));

      // --- status halo (subtle colored ring) ---
      const tint = a.statuses.map((s) => STATUS_COLOR[s.type]).find(Boolean);
      if (tint) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x, a.y, size + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      this._drawHealthBar(ctx, a, size);
      this._drawStatusLabels(ctx, a, size); // "Webbed 2.1s", "Burning", ...
    }
  }

  /**
   * Status chips above an agent. Fonts and box sizes are divided by the camera
   * scale so they hold a constant on-screen size while the camera zooms, and the
   * list is truncated — a bug carrying six statuses used to grow a tower of text
   * taller than the fight it was in.
   */
  _drawStatusLabels(ctx, a, size) {
    if (!a.statuses.length) return;
    // Adaptive: in a big melee these are pure noise — a team-wide buff paints the
    // SAME chip over every unit at once, and a dozen of them bury the fight. They
    // only earn their space once the field has thinned to a readable duel, which
    // is also exactly when knowing who's burning or webbed actually matters.
    if ((this.latest?.agents?.length ?? 0) > STATUS_LABEL_MAX_AGENTS) return;
    const k = 1 / this.camera.scale; // keep chips screen-constant
    const shown = a.statuses.slice(0, MAX_STATUS_LABELS);
    const hidden = a.statuses.length - shown.length;
    let y = a.y - size * 2.1 - 13 * k;

    ctx.save();
    ctx.font = `600 ${9 * k}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows = shown.map((s) => ({
      text: s.remaining != null ? `${s.label} ${s.remaining}s` : s.label,
      color: STATUS_COLOR[s.type] || '#dcdcdc',
    }));
    if (hidden > 0) rows.push({ text: `+${hidden}`, color: '#b9c0cf' });

    for (const r of rows) {
      const w = ctx.measureText(r.text).width + 8 * k;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      roundRect(ctx, a.x - w / 2, y - 6 * k, w, 12 * k, 3 * k);
      ctx.fill();
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, a.x, y + 0.5 * k);
      y -= 14 * k;
    }
    ctx.restore();
  }

  _drawHealthBar(ctx, a, size) {
    const pct = Math.max(0, Math.min(1, a.health / a.maxHealth));
    if (pct >= 1) return; // hide full bars to reduce clutter
    const k = 1 / this.camera.scale;
    const barW = size * 2.4;
    const x = a.x - barW / 2;
    const y = a.y - size * 2.1 - 4 * k;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - k, y - k, barW + 2 * k, 5 * k);
    ctx.fillStyle = pct > 0.5 ? '#5ad86a' : pct > 0.25 ? '#e6c34a' : '#e6564a';
    ctx.fillRect(x, y, barW * pct, 3 * k);
  }

  _drawEffects(ctx) {
    // Fade the big auras down further the more of them are on screen at once, so
    // two overlapping ones read as two effects rather than one bright blob.
    const wideAlive = this.effects.reduce((n, f) => n + (WIDE_FX.has(f.kind) ? 1 : 0), 0);
    const crowd = wideAlive > 1 ? 1 / (1 + 0.4 * (wideAlive - 1)) : 1;

    for (const fx of this.effects) {
      // These two need renderer state (the sprite catalog / live caster position),
      // so they're drawn here rather than by the stateless `drawEffect`.
      if (fx.kind === 'afterimage') this._drawAfterimages(ctx, fx);
      else if (fx.kind === 'windup') this._drawWindup(ctx, fx);
      else drawEffect(ctx, fx, WIDE_FX.has(fx.kind) ? crowd : 1);
    }
  }

  /**
   * Fading ghosts of the caster strung along a dash. Ghosts near the START are the
   * faintest and they get more solid toward the landing point — so the trail reads
   * as "he was just there, and there, and there" as he tore forward.
   */
  _drawAfterimages(ctx, fx) {
    const visual = this.catalog[fx.speciesId]?.visual;
    if (!visual) return;
    const ghosts = 6;
    const life = Math.max(0, fx.life);
    for (let i = 0; i < ghosts - 1; i++) {
      const s = i / (ghosts - 1); // 0 = wind-up spot, 1 = landing spot
      const x = fx.x1 + (fx.x2 - fx.x1) * s;
      const y = fx.y1 + (fx.y2 - fx.y1) * s;
      const alpha = (0.06 + 0.34 * s) * life; // fainter the further back it is
      ctx.save();
      ctx.globalAlpha = alpha;
      drawAgent(
        ctx,
        { x, y, angle: fx.angle || 0, action: 'idle', id: 'ghost', statuses: [] },
        visual,
        { spriteCache: this.spriteCache, scaleX: 1, scaleY: 1 }
      );
      ctx.restore();
    }
  }

  /**
   * The ability wind-up telegraph: a gathering ring that tightens and brightens as
   * release nears, tracking the live caster so it stays glued to a recoiling body.
   */
  _drawWindup(ctx, fx) {
    // Follow the caster if it's still on the field (the mantis slides back mid-coil).
    let x = fx.x;
    let y = fx.y;
    if (fx.casterId && this.latest) {
      const live = this.latest.agents.find((a) => a.id === fx.casterId);
      if (live) {
        x = live.x;
        y = live.y;
      }
    }
    const build = 1 - Math.max(0, Math.min(1, fx.life)); // 0 at cast start → ~1 at release
    const col = fx.color || '#ffe08a';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Aim tick: a short arrow of energy in the ability's direction.
    if (fx.dirX != null && fx.dirY != null) {
      ctx.globalAlpha = 0.25 + 0.55 * build;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 + 2 * build;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + fx.dirX * (14 + 20 * build), y + fx.dirY * (14 + 20 * build));
      ctx.stroke();
    }

    // Gathering ring: wide + faint at first, tightening to a bright core.
    const r = 30 * (1 - 0.55 * build);
    ctx.globalAlpha = 0.2 + 0.55 * build;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 + 2.5 * build;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    const core = ctx.createRadialGradient(x, y, 0, x, y, 16);
    core.addColorStop(0, col);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.25 + 0.55 * build;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _ageEffects(dt) {
    for (const fx of this.effects) fx.life -= dt / fx.ttl;
    this.effects = this.effects.filter((fx) => fx.life > 0);
  }

  _ageAgentFx(dt) {
    for (const [id, fx] of this._agentFx) {
      fx.flash -= dt / 0.18;
      if (fx.flash <= 0) this._agentFx.delete(id);
    }
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h % 628) / 100; // 0..~6.28 so it seeds a phase offset
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A spider-web net drawn over a trapped bug (radial spokes + concentric rings). */
function drawWebOverlay(ctx, cx, cy, r) {
  const spokes = 8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = 'rgba(235,228,255,0.9)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    ctx.stroke();
  }
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (r * ring) / 3;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2;
      const px = Math.cos(ang) * rr;
      const py = Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Cartoon "dazed" stars orbiting above a knocked-about, stunned bug. */
function drawStaggerOverlay(ctx, cx, cy, size, phase) {
  const stars = 3;
  const r = size * 1.1;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < stars; i++) {
    const ang = phase * 2 + (i / stars) * Math.PI * 2;
    const sx = Math.cos(ang) * r;
    const sy = Math.sin(ang) * r * 0.45; // squashed orbit reads as "above the head"
    drawStar(ctx, sx, sy, 2.6, '#ffe27a');
  }
  ctx.restore();
}

function drawStar(ctx, x, y, rad, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a2 = a1 + Math.PI / 5;
    ctx.lineTo(Math.cos(a1) * rad, Math.sin(a1) * rad);
    ctx.lineTo(Math.cos(a2) * rad * 0.45, Math.sin(a2) * rad * 0.45);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function ttlFor(kind) {
  switch (kind) {
    case 'leaf_shield':
      return 0.85; // the canopy unfurls and settles
    case 'rally':
      return 0.7; // the raid signal rippling outward
    case 'snap':
      return 0.26; // a hard, fast crack — gone almost immediately
    case 'nectar':
      return 0.55; // a thread of nectar passing to a wounded ally
    case 'heal_burst':
      return 0.9; // the honeypot's cask giving way
    case 'toss':
      return 0.5; // the arc of a hurled bug
    case 'chemical_blast':
      return 0.55; // the boiling cone
    case 'barrage':
      return 0.34; // three stings in quick succession
    case 'coil':
      return 0.75; // constricting rings
    case 'thorns':
      return 0.32; // a brief spike flare where a blow was turned back
    case 'acid':
      return 0.7; // corrosive splash + lingering fizz
    case 'gorge':
      return 0.8; // the harvester visibly growing
    case 'leap':
      return 0.38; // the arc of a pounce
    case 'drain':
      return 0.6; // life pulled back down a thread
    case 'spit':
      return 0.45; // projectile + splat
    case 'necrosis':
      return 0.8; // a wound blooming open
    case 'sand_pit':
      return 1.0; // the ground collapsing inward — the longest of the set
    case 'brood':
      return 0.8; // a clutch hatching around the queen
    case 'explosion':
      return 0.5;
    case 'web_cast':
      return 0.4; // strands shoot out then fade fast (not a lingering beam)
    case 'web_splash':
      return 0.6; // the wide net flashes over the caught area, then fades
    case 'spawn_in':
      return 0.7; // reinforcement muster flourish
    case 'venom':
      return 0.5; // a splash of venom on a stung target
    case 'poison_cloud':
      return 0.9; // the suicide ant's lingering death spray
    case 'enrage':
      return 0.9; // last-stand burst
    case 'flare':
      return 0.45;
    case 'dash':
      return 0.34;
    case 'burn':
      return 0.3;
    default:
      return 0.3;
  }
}

/**
 * Draw a single fading effect in scene coords. `fx.life` runs 1 -> 0.
 *
 * `dim` (<=1) is the crowding dampener for wide area effects. It multiplies the
 * ALPHA only — geometry still animates off the raw `a`, so an effect shrinking
 * or expanding over its life keeps its timing while simply drawing fainter.
 */
function drawEffect(ctx, fx, dim = 1) {
  const a = Math.max(0, Math.min(1, fx.life));
  ctx.save();
  ctx.globalAlpha = a * dim;
  if (dim < 1) {
    // Additive blending is what makes overlapping auras clip to white; once
    // several are on screen, layer them normally instead.
    ctx.globalCompositeOperation = 'source-over';
  }
  switch (fx.kind) {
    case 'poof': {
      // Death dust: expanding ring + a few puffs.
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = fx.color || '#ddd';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 22 * (1 - a) + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,130,110,0.5)';
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const d = (1 - a) * 20;
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d, 5 * a + 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'web_cast': {
      // Several slightly-splayed strands from spider -> target that fade quickly,
      // ending in a small net burst on the target. Reads as "casting a web".
      ctx.strokeStyle = 'rgba(220,210,255,0.95)';
      ctx.lineWidth = 1.4;
      const dx = fx.x2 - fx.x1;
      const dy = fx.y2 - fx.y1;
      const nx = -dy;
      const ny = dx;
      const len = Math.hypot(nx, ny) || 1;
      for (let i = -1; i <= 1; i++) {
        const off = (i * 5) / len;
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        ctx.lineTo(fx.x2 + nx * off, fx.y2 + ny * off);
        ctx.stroke();
      }
      // little net burst at the target
      ctx.beginPath();
      ctx.arc(fx.x2, fx.y2, 8 * (1 - a) + 4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'web_splash': {
      // A wide web net that flashes over the whole caught area, then fades. Reads
      // as the spider's snare landing on a cluster, not a single strand.
      const r = (fx.radius || 60) * (0.86 + 0.14 * (1 - a));
      ctx.globalAlpha = a * 0.62;
      ctx.strokeStyle = 'rgba(225,215,255,0.92)';
      ctx.lineWidth = 1.1;
      ctx.translate(fx.x, fx.y);
      const spokes = 12;
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        ctx.stroke();
      }
      for (let ring = 1; ring <= 4; ring++) {
        const ringR = (r * ring) / 4;
        ctx.beginPath();
        for (let i = 0; i <= spokes; i++) {
          const ang = (i / spokes) * Math.PI * 2;
          const x = Math.cos(ang) * ringR;
          const y = Math.sin(ang) * ringR;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'spawn_in': {
      // Reinforcement muster: an expanding team-tinted ring + soft core. Gold when
      // the newborn is a BUG rather than an ant.
      const base = fx.isBug
        ? 'rgba(255,205,90,'
        : fx.team === 'B'
          ? 'rgba(255,93,115,'
          : 'rgba(78,161,255,';
      // A queen's brood makes these arrive several at a time — layered, not summed.
      const r = 8 + (1 - a) * 24;
      ctx.strokeStyle = `${base}${0.9 * a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, `${base}${0.5 * a})`);
      g.addColorStop(1, `${base}0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'dash': {
      // Motion streak with a couple of trailing ghost strokes — a clear dash tell.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = a * (0.5 - i * 0.14);
        ctx.strokeStyle = '#b6ffb0';
        ctx.lineWidth = 5 - i * 1.4;
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();
      }
      // bright strike head
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(230,255,220,0.9)';
      ctx.beginPath();
      ctx.arc(fx.x2, fx.y2, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'dash_shock': {
      // Bright shock ring where the mantis lands its charge.
      ctx.globalCompositeOperation = 'lighter';
      const r = 26 * (1 - a) + 6;
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = 'rgba(180,255,170,0.95)';
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r * 0.6);
      g.addColorStop(0, `rgba(230,255,220,${0.7 * a})`);
      g.addColorStop(1, 'rgba(120,255,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'impact': {
      // A foe getting bowled aside: a streak from where it was struck to where it
      // lands, capped by a little dust ring — so the knockback actually reads.
      if (fx.x0 != null) {
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = 'rgba(255,226,185,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(fx.x0, fx.y0);
        ctx.lineTo(fx.x, fx.y);
        ctx.stroke();
      }
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = 'rgba(255,240,215,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 12 * (1 - a) + 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'venom': {
      // A small green splash where a sting/venom lands.
      ctx.globalCompositeOperation = 'lighter';
      const r = (fx.radius || 12) * (1.2 - a);
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, 'rgba(180,255,120,0.85)');
      g.addColorStop(0.6, 'rgba(120,220,70,0.5)');
      g.addColorStop(1, 'rgba(90,180,50,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'poison_cloud': {
      // The suicide ant's death spray: a billowing green cloud of drifting blobs.
      const R = fx.radius || 46;
      const grow = 0.6 + 0.4 * (1 - a);
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = 'rgba(120,200,60,0.5)';
      const blobs = 9;
      for (let i = 0; i < blobs; i++) {
        const ang = (i / blobs) * Math.PI * 2 + (1 - a) * 1.4;
        const d = R * grow * (0.35 + 0.6 * ((i % 3) / 2));
        const br = R * 0.32 * (0.8 + 0.4 * ((i % 2)));
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d, br, 0, Math.PI * 2);
        ctx.fill();
      }
      // faint toxic core
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = 'rgba(150,230,80,0.6)';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, R * 0.5 * grow, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'enrage': {
      // Last-stand burst: a red shockwave + rising embers around the newly-enraged bug.
      ctx.globalCompositeOperation = 'lighter';
      const r = 30 * (1 - a) + 8;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = 'rgba(255,80,70,0.95)';
      ctx.lineWidth = 3 * a + 1.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, `rgba(255,120,90,${0.6 * a})`);
      g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'flare': {
      // Ignite burst on the target.
      ctx.globalCompositeOperation = 'lighter';
      const r = (fx.radius || 14) * (1.2 - a);
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, 'rgba(255,220,120,0.9)');
      g.addColorStop(0.5, 'rgba(255,120,40,0.6)');
      g.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'leaf_shield': {
      // The leafcutter's canopy: a green dome ring that snaps open and holds, with
      // leaf blades fanned around the rim so it reads as foliage, not a force field.
      const R = fx.radius || 100;
      const open = Math.min(1, (1 - a) * 3); // unfurls fast, then sits
      const r = R * (0.55 + 0.45 * open);
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = 'rgba(150,225,110,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // soft interior
      const g = ctx.createRadialGradient(fx.x, fx.y, r * 0.2, fx.x, fx.y, r);
      g.addColorStop(0, `rgba(120,210,90,${0.05 * a})`);
      g.addColorStop(1, `rgba(90,190,70,${0.22 * a})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      // leaf blades around the rim
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = 'rgba(110,200,80,0.85)';
      const blades = 10;
      for (let i = 0; i < blades; i++) {
        const ang = (i / blades) * Math.PI * 2 + open * 0.5;
        ctx.save();
        ctx.translate(fx.x + Math.cos(ang) * r, fx.y + Math.sin(ang) * r);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'rally': {
      // The army ant's raid call: concentric chevron rings racing outward.
      // Deliberately NOT additive — it's a wide ambient aura, and three of these
      // overlapping used to sum straight to white.
      const R = fx.radius || 140;
      for (let ring = 0; ring < 3; ring++) {
        const p = Math.min(1, (1 - a) * 1.4 + ring * 0.18);
        if (p > 1) continue;
        ctx.globalAlpha = a * dim * (0.55 - ring * 0.14);
        ctx.strokeStyle = 'rgba(255,160,80,0.95)';
        ctx.lineWidth = 3 - ring * 0.7;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, R * p, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'snap': {
      // The trap-jaw crack: a hard white flash with four radiating shock spurs.
      ctx.globalCompositeOperation = 'lighter';
      const r = (fx.radius || 26) * (1.5 - a);
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, 'rgba(255,255,235,0.95)');
      g.addColorStop(0.5, 'rgba(255,220,150,0.5)');
      g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,250,220,${0.9 * a})`;
      ctx.lineWidth = 2.5 * a + 0.8;
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * r * 0.5, fx.y + Math.sin(ang) * r * 0.5);
        ctx.lineTo(fx.x + Math.cos(ang) * r * 1.5, fx.y + Math.sin(ang) * r * 1.5);
        ctx.stroke();
      }
      break;
    }
    case 'nectar': {
      // A golden thread of nectar drawn from the honeypot to the ally it's feeding,
      // with a bead travelling along it.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = 'rgba(255,205,90,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
      const p = 1 - a; // the bead slides toward the recipient as it fades
      const bx = fx.x1 + (fx.x2 - fx.x1) * p;
      const by = fx.y1 + (fx.y2 - fx.y1) * p;
      ctx.fillStyle = 'rgba(255,235,160,0.95)';
      ctx.beginPath();
      ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'heal_burst': {
      // Sweet Rupture: a warm golden wave with rising motes. Non-additive for the
      // same reason as `rally` — it is large, bright, and often fires in clusters.
      const R = fx.radius || 130;
      const r = R * (1 - a);
      ctx.globalAlpha = a * dim * 0.85;
      ctx.strokeStyle = 'rgba(255,215,110,0.9)';
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, `rgba(255,235,160,${0.45 * a})`);
      g.addColorStop(1, 'rgba(255,190,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      // motes drifting up out of the burst
      ctx.fillStyle = `rgba(255,240,190,${0.8 * a})`;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const d = R * 0.55 * (1 - a);
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d - (1 - a) * 16, 2.6 * a + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'toss': {
      // The beetle's throw: an arcing trail from where the victim was scooped to
      // where it lands, so the flight path reads rather than a teleport.
      const dx = fx.x2 - fx.x1;
      const dy = fx.y2 - fx.y1;
      const lift = Math.hypot(dx, dy) * 0.28; // how high the arc bows
      const mx = (fx.x1 + fx.x2) / 2 - (dy / (Math.hypot(dx, dy) || 1)) * lift;
      const my = (fx.y1 + fx.y2) / 2 + (dx / (Math.hypot(dx, dy) || 1)) * lift;
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = 'rgba(240,215,160,0.9)';
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.quadraticCurveTo(mx, my, fx.x2, fx.y2);
      ctx.stroke();
      // dust where it comes down
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = 'rgba(255,235,200,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x2, fx.y2, 16 * (1 - a) + 4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'chemical_blast': {
      // The bombardier's cone: a boiling wedge of gas that widens as it fades,
      // drawn along the heading the beetle actually fired on.
      const R = (fx.radius || 135) * (0.55 + 0.45 * (1 - a));
      const half = fx.halfAngle ?? 0.74;
      const base = Math.atan2(fx.dirY ?? 0, fx.dirX ?? 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.7;
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, R);
      g.addColorStop(0, 'rgba(255,245,180,0.9)');
      g.addColorStop(0.35, 'rgba(200,255,106,0.55)');
      g.addColorStop(1, 'rgba(140,220,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y);
      ctx.arc(fx.x, fx.y, R, base - half, base + half);
      ctx.closePath();
      ctx.fill();
      // roiling blobs inside the cone
      ctx.globalAlpha = a * 0.4;
      ctx.fillStyle = 'rgba(210,255,130,0.7)';
      for (let i = 0; i < 7; i++) {
        const t = (i + 1) / 8;
        const spread = (((i * 7919) % 100) / 100 - 0.5) * 2 * half * 0.8;
        const ang = base + spread;
        const d = R * t;
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d, 4 + 7 * t, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'barrage': {
      // The hornet's three stings: staggered strike ticks along the dive line.
      const n = fx.stings || 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = 'rgba(255,230,110,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 7;
        ctx.globalAlpha = a * (0.9 - i * 0.15);
        ctx.beginPath();
        ctx.arc(fx.x2 + off, fx.y2 - off * 0.6, 5 * a + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,245,180,0.95)';
        ctx.stroke();
      }
      break;
    }
    case 'coil': {
      // The centipede's crush: rings cinching inward on the pinned victim.
      const R = fx.radius || 26;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = 'rgba(255,140,110,0.95)';
      for (let i = 0; i < 3; i++) {
        const squeeze = 1 - (1 - a) * 0.45; // tightens over the effect's life
        const rr = R * squeeze * (0.5 + i * 0.28);
        ctx.lineWidth = 3 - i * 0.6;
        ctx.beginPath();
        ctx.ellipse(fx.x, fx.y, rr, rr * 0.62, i * 0.7 + (1 - a) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'thorns': {
      // A blow turned back: a ring of short spikes flaring outward at the attacker.
      const R = fx.radius || 16;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = 'rgba(230,190,130,0.95)';
      ctx.lineWidth = 2;
      const spikes = 8;
      for (let i = 0; i < spikes; i++) {
        const ang = (i / spikes) * Math.PI * 2;
        const inner = R * 0.5;
        const outer = R * (0.9 + 0.5 * (1 - a));
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * inner, fx.y + Math.sin(ang) * inner);
        ctx.lineTo(fx.x + Math.cos(ang) * outer, fx.y + Math.sin(ang) * outer);
        ctx.stroke();
      }
      break;
    }
    case 'acid': {
      // Corrosive splash: a sour yellow-green pool with fizzing specks over it.
      const R = (fx.radius || 70) * (0.6 + 0.4 * (1 - a));
      ctx.globalAlpha = a * 0.55;
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, R);
      g.addColorStop(0, 'rgba(240,255,140,0.75)');
      g.addColorStop(0.55, 'rgba(200,225,60,0.4)');
      g.addColorStop(1, 'rgba(150,180,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, R, 0, Math.PI * 2);
      ctx.fill();
      // fizz
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = 'rgba(245,255,180,0.9)';
      for (let i = 0; i < 10; i++) {
        const ang = (i * 2.39996) + (1 - a) * 2; // golden-angle scatter
        const d = R * (0.25 + 0.7 * ((i % 4) / 3));
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d, 1.6 * a + 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'gorge': {
      // The harvester growing: chevrons rising off it, one per stack.
      const stacks = Math.max(1, Math.min(8, fx.stacks || 1));
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,170,100,0.95)';
      ctx.lineWidth = 2.2;
      for (let i = 0; i < stacks; i++) {
        const rise = (1 - a) * 26 + i * 5;
        ctx.globalAlpha = a * (0.8 - i * 0.07);
        ctx.beginPath();
        ctx.moveTo(fx.x - 7, fx.y - rise + 4);
        ctx.lineTo(fx.x, fx.y - rise - 2);
        ctx.lineTo(fx.x + 7, fx.y - rise + 4);
        ctx.stroke();
      }
      break;
    }
    case 'leap': {
      // A pounce: a tight arc from the crouch to the landing, plus a landing ring.
      const dx = fx.x2 - fx.x1;
      const dy = fx.y2 - fx.y1;
      const len = Math.hypot(dx, dy) || 1;
      const lift = len * 0.22;
      const mx = (fx.x1 + fx.x2) / 2 - (dy / len) * lift;
      const my = (fx.y1 + fx.y2) / 2 + (dx / len) * lift;
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = 'rgba(255,180,120,0.9)';
      ctx.lineWidth = 3 * a + 1;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.quadraticCurveTo(mx, my, fx.x2, fx.y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx.x2, fx.y2, 14 * (1 - a) + 4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'drain': {
      // Life pulled off the victim and back down a thread to the assassin, with
      // beads travelling along it toward the drinker.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = 'rgba(255,80,120,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(fx.x2, fx.y2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,150,180,0.95)';
      for (let i = 0; i < 3; i++) {
        const p = Math.min(1, (1 - a) + i * 0.22);
        ctx.beginPath();
        ctx.arc(fx.x1 + (fx.x2 - fx.x1) * p, fx.y1 + (fx.y2 - fx.y1) * p, 3 * a + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'spit': {
      // The gob in flight along the shot line, then the sticky splat where it lands.
      const p = Math.min(1, (1 - a) * 2.2); // travels fast, then the splat holds
      const gx = fx.x1 + (fx.x2 - fx.x1) * p;
      const gy = fx.y1 + (fx.y2 - fx.y1) * p;
      ctx.globalAlpha = a * 0.6;
      ctx.strokeStyle = 'rgba(180,255,244,0.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(fx.x1, fx.y1);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      if (p < 1) {
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(200,255,248,0.95)';
        ctx.beginPath();
        ctx.arc(gx, gy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const R = (fx.radius || 55) * 0.6;
        ctx.globalAlpha = a * 0.5;
        const g = ctx.createRadialGradient(fx.x2, fx.y2, 0, fx.x2, fx.y2, R);
        g.addColorStop(0, 'rgba(200,255,248,0.7)');
        g.addColorStop(1, 'rgba(120,220,210,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx.x2, fx.y2, R, 0, Math.PI * 2);
        ctx.fill();
        // sticky strands radiating from the splat
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = 'rgba(210,255,250,0.8)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(fx.x2, fx.y2);
          ctx.lineTo(fx.x2 + Math.cos(ang) * R * 0.9, fx.y2 + Math.sin(ang) * R * 0.9);
          ctx.stroke();
        }
      }
      break;
    }
    case 'necrosis': {
      // A wound that won't close: a dark rotting bloom with a sickly green rim.
      const R = (fx.radius || 18) * (0.8 + 0.5 * (1 - a));
      ctx.globalAlpha = a * 0.8;
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, R);
      g.addColorStop(0, 'rgba(40,20,30,0.85)');
      g.addColorStop(0.6, 'rgba(90,120,50,0.5)');
      g.addColorStop(1, 'rgba(140,200,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, R, 0, Math.PI * 2);
      ctx.fill();
      // creeping tendrils of rot
      ctx.strokeStyle = `rgba(143,208,90,${0.7 * a})`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + (1 - a);
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * R * 0.4, fx.y + Math.sin(ang) * R * 0.4);
        ctx.lineTo(fx.x + Math.cos(ang) * R * 1.1, fx.y + Math.sin(ang) * R * 1.1);
        ctx.stroke();
      }
      break;
    }
    case 'sand_pit': {
      // The ground collapsing: rings spiralling INWARD (the opposite of every
      // other burst here) plus inward-streaking grit, so the pull reads clearly.
      const R = fx.radius || 135;
      const collapse = 1 - a; // 0 -> 1 as it resolves
      ctx.globalAlpha = a * 0.5;
      const g = ctx.createRadialGradient(fx.x, fx.y, R * 0.1, fx.x, fx.y, R);
      g.addColorStop(0, 'rgba(60,44,22,0.6)');
      g.addColorStop(0.7, 'rgba(150,124,80,0.28)');
      g.addColorStop(1, 'rgba(190,164,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(225,200,140,${0.7 * a})`;
      ctx.lineWidth = 2;
      for (let ring = 0; ring < 3; ring++) {
        const rr = R * (1 - collapse * 0.75) * (0.4 + ring * 0.3);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, Math.max(2, rr), 0, Math.PI * 2);
        ctx.stroke();
      }
      // grit streaking inward
      ctx.strokeStyle = `rgba(240,220,170,${0.55 * a})`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + collapse * 0.8;
        const from = R * (1 - collapse * 0.5);
        const to = from * 0.55;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(ang) * from, fx.y + Math.sin(ang) * from);
        ctx.lineTo(fx.x + Math.cos(ang) * to, fx.y + Math.sin(ang) * to);
        ctx.stroke();
      }
      break;
    }
    case 'brood': {
      // A clutch hatching: soft pale eggs blooming outward around the queen.
      const R = fx.radius || 46;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = 'rgba(242,228,255,0.85)';
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2 + (1 - a) * 0.6;
        const d = R * (0.4 + 0.6 * (1 - a));
        ctx.save();
        ctx.translate(fx.x + Math.cos(ang) * d, fx.y + Math.sin(ang) * d);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0, 0, 4 * a + 1.5, 2.6 * a + 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = 'rgba(200,140,235,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, R * (1 - a) + 6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'slash': {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 14 * (1 - a) + 6, -0.4, Math.PI * 1.1);
      ctx.stroke();
      break;
    }
    case 'explosion': {
      ctx.globalCompositeOperation = 'lighter';
      const r = (fx.radius || 30) * (1.15 - a);
      const g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      g.addColorStop(0, fx.color || '#ff9a3c');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'burn': {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff7a2c';
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius || 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
