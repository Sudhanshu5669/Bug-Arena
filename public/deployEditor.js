// The deploy editor — where you arrange an army before it is allowed to move.
//
// One widget, two customers: the campaign deploys team A against a fixed enemy
// line, and the battle maker deploys BOTH teams. The difference is entirely in
// `editableTeams`; nothing below branches on which screen it is running in.
//
// The units it holds are inert. They are drawn, dragged and counted here, and
// they do not exist to the simulation until `toEngineRoster()` hands their exact
// coordinates to the engine — which is the whole point: what you arranged is
// what starts, standing exactly where you left it.
//
// Input is Pointer Events throughout, which is what makes one code path serve
// both a mouse and a thumb. Three ways to place a unit, because the fastest one
// differs by device:
//
//   drag from the tray onto the floor   — the obvious one with a mouse
//   tap a tray card, then tap the floor — the obvious one on a phone
//   tap a card's +                      — bulk placement without aiming 18 times
//
// ...and one way to remove: drag a unit off its own deploy zone. That reads as
// "take it back off the field" on both devices and needs no separate erase mode.

import { drawAgent, SpriteCache } from './render/rendererAbstraction.js';
import { preloadSprites } from './render/spriteLoader.js';
// The layout maths lives in game/ because the headless campaign probe uses it
// too — a balance tool that arranged armies differently from the way the game
// arranges them would be measuring a fight nobody ever plays.
import { layout, nextSlot, settle, zoneOf } from './game/formation.js';

const SPRITE_BASE = new URL('./assets/sprites', import.meta.url).href;

/** Team colours, matched to the battle renderer so a lineup looks like itself. */
const TEAM = {
  A: { ring: '#4aa3ff', glow: 'rgba(74,163,255,0.22)', zone: 'rgba(74,163,255,0.075)', label: 'YOUR COLONY' },
  B: { ring: '#ff5d73', glow: 'rgba(255,93,115,0.22)', zone: 'rgba(255,93,115,0.075)', label: 'OPPOSITION' },
};

let _seq = 0;

/**
 * Deterministic value noise, so the sand's grit is identical on every repaint.
 *
 * The editor redraws on every pointer move. Grit from `Math.random()` would boil
 * — a field of speckles crawling under a dragged unit — which reads as the canvas
 * being broken rather than as texture. Hashing the coordinate instead makes the
 * floor a fixed thing the player is arranging units ON.
 */
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export class DeployEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {object} opts.arena          - { width, height, wallThickness }
   * @param {Array}  opts.catalog        - species catalog (for visuals + stats)
   * @param {string[]} [opts.editableTeams] - which teams the player may arrange
   * @param {(state:object) => void} [opts.onChange] - fired whenever the field changes
   */
  constructor(canvas, { arena, catalog, editableTeams = ['A'], onChange = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.arena = { width: 960, height: 600, wallThickness: 24, ...(arena ?? {}) };
    this.catalog = catalog;
    this.byId = new Map(catalog.map((s) => [s.id, s]));
    this.editableTeams = new Set(editableTeams);
    this.onChange = onChange;

    this.units = [];
    this.limits = { A: { budget: Infinity, cap: Infinity }, B: { budget: Infinity, cap: Infinity } };
    this.prices = {};
    this.activeTeam = editableTeams[0] ?? 'A';
    this.brush = null; // species id armed for tap-to-place

    this.spriteCache = new SpriteCache();
    // Sprites are optional decoration here: drawAgent falls back to the species'
    // shape descriptor while they load, so the editor is usable from frame one.
    preloadSprites(catalog, this.spriteCache, SPRITE_BASE, () => this._paint());

    this._drag = null;
    this._pointer = null;
    this._raf = 0;
    this._alive = true;

    this._sizeCanvas();
    this._bind();
    this._paint();
  }

  // --- configuration ---------------------------------------------------------

  /** Price list used for budget accounting (`{ speciesId: larvae }`). */
  setPrices(prices) {
    this.prices = prices ?? {};
  }

  /** Per-team limits. Either may be Infinity (the battle maker uses that). */
  setLimits(team, { budget = Infinity, cap = Infinity } = {}) {
    this.limits[team] = { budget, cap };
  }

  setActiveTeam(team) {
    this.activeTeam = team;
    this.brush = null;
    this._paint();
  }

  setBrush(speciesId) {
    this.brush = this.brush === speciesId ? null : speciesId;
    this._paint();
    return this.brush;
  }

  // --- the field -------------------------------------------------------------

  /** Replace a team's units wholesale. Coordinates are arena-space. */
  setTeam(team, units) {
    this.units = this.units.filter((u) => u.team !== team);
    for (const u of units ?? []) {
      if (!this.byId.has(u.species ?? u.speciesId)) continue;
      this.units.push({
        id: `u${_seq++}`,
        team,
        speciesId: u.species ?? u.speciesId,
        x: u.x,
        y: u.y,
      });
    }
    this._changed();
  }

  /**
   * Lay a roster map (`{ speciesId: count }`) out in formation for one team.
   * This is how the campaign's fixed enemy line gets onto the field, and what
   * the tray's + button and "Auto-arrange" both ultimately call.
   */
  fillFormation(team, roster) {
    this.units = this.units.filter((u) => u.team !== team);
    const flat = [];
    for (const [id, n] of Object.entries(roster ?? {})) {
      const sp = this.byId.get(id);
      if (!sp) continue;
      for (let i = 0; i < n; i++) flat.push({ id: sp.id, tier: sp.tier, r: this._radius(sp) });
    }
    for (const at of layout(team, this.arena, flat)) {
      this.units.push({ id: `u${_seq++}`, team, speciesId: at.species, x: at.x, y: at.y });
    }
    this._changed();
  }

  /** Add one unit at an auto-chosen slot. Returns why it failed, or null. */
  addAuto(team, speciesId) {
    const sp = this.byId.get(speciesId);
    if (!sp) return 'unknown';
    const blocked = this._canAdd(team, speciesId);
    if (blocked) return blocked;
    const at = this._nextSlot(team, sp);
    this.units.push({ id: `u${_seq++}`, team, speciesId, x: at.x, y: at.y });
    this._changed();
    return null;
  }

  /** Add one unit at an exact point (a drop). Returns why it failed, or null. */
  addAt(team, speciesId, x, y) {
    const sp = this.byId.get(speciesId);
    if (!sp) return 'unknown';
    if (!this._inZone(team, x, y)) return 'zone';
    const blocked = this._canAdd(team, speciesId);
    if (blocked) return blocked;
    const at = this._settle(team, sp, x, y, null);
    this.units.push({ id: `u${_seq++}`, team, speciesId, x: at.x, y: at.y });
    this._changed();
    return null;
  }

  /** Remove the most recently placed unit of a species. */
  removeOne(team, speciesId) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.team === team && u.speciesId === speciesId) {
        this.units.splice(i, 1);
        this._changed();
        return true;
      }
    }
    return false;
  }

  clear(team) {
    this.units = this.units.filter((u) => u.team !== team);
    this._changed();
  }

  /** Re-run the formation layout over whatever is already on the field. */
  tidy(team) {
    const roster = this.rosterOf(team);
    this.fillFormation(team, roster);
  }

  // --- readouts --------------------------------------------------------------

  rosterOf(team) {
    const out = {};
    for (const u of this.units) if (u.team === team) out[u.speciesId] = (out[u.speciesId] ?? 0) + 1;
    return out;
  }

  countOf(team) {
    return this.units.reduce((n, u) => n + (u.team === team ? 1 : 0), 0);
  }

  spentBy(team) {
    return this.units.reduce((n, u) => n + (u.team === team ? (this.prices[u.speciesId] ?? 0) : 0), 0);
  }

  remainingBudget(team) {
    return this.limits[team].budget - this.spentBy(team);
  }

  /**
   * The rosters in the shape `teams.custom` wants — one entry per unit, carrying
   * the coordinates the player chose.
   */
  toEngineRoster() {
    const out = { A: [], B: [] };
    for (const u of this.units) out[u.team]?.push({ species: u.speciesId, x: u.x, y: u.y });
    return out;
  }

  /** Everything a UI needs to redraw its counters after a change. */
  snapshot() {
    return {
      A: { roster: this.rosterOf('A'), count: this.countOf('A'), spent: this.spentBy('A') },
      B: { roster: this.rosterOf('B'), count: this.countOf('B'), spent: this.spentBy('B') },
      brush: this.brush,
      activeTeam: this.activeTeam,
    };
  }

  // --- tray drag -------------------------------------------------------------

  /**
   * Start a drag that began on a TRAY CARD rather than on the canvas.
   *
   * The pointer is captured on the document, not the canvas, because the gesture
   * starts outside it — without this the drag would only register once the finger
   * had already crossed onto the floor, which feels like the card "didn't take".
   */
  beginTrayDrag(speciesId, ev) {
    if (!this.editableTeams.has(this.activeTeam)) return;
    if (!this.byId.has(speciesId)) return;
    this._drag = { kind: 'tray', speciesId, team: this.activeTeam, pointerId: ev.pointerId, moved: false };
    this._pointer = this._toScene(ev);
    this._paint();
  }

  // --- internals: geometry ---------------------------------------------------

  zoneOf(team) {
    return zoneOf(team, this.arena);
  }

  _inZone(team, x, y) {
    const z = this.zoneOf(team);
    return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
  }

  /** Occupied points, for the layout helpers. `ignoreId` excludes a dragged unit. */
  _occupied(ignoreId) {
    return this.units
      .filter((u) => u.id !== ignoreId)
      .map((u) => ({ x: u.x, y: u.y, r: this._radius(this.byId.get(u.speciesId)) }));
  }

  _canAdd(team, speciesId) {
    const lim = this.limits[team];
    if (this.countOf(team) >= lim.cap) return 'cap';
    const price = this.prices[speciesId] ?? 0;
    if (this.spentBy(team) + price > lim.budget) return 'budget';
    return null;
  }

  _radius(sp) {
    return sp?.stats?.size ?? 10;
  }

  _settle(team, sp, x, y, ignoreId) {
    return settle(team, this.arena, this._radius(sp), x, y, this._occupied(ignoreId));
  }

  _nextSlot(team, sp) {
    return nextSlot(team, this.arena, this._radius(sp), this._occupied(null));
  }

  // --- internals: input ------------------------------------------------------

  _bind() {
    const c = this.canvas;
    this._onDown = (ev) => this._pointerDown(ev);
    this._onMove = (ev) => this._pointerMove(ev);
    this._onUp = (ev) => this._pointerUp(ev);
    this._onResize = () => {
      this._sizeCanvas();
      this._paint();
    };

    c.addEventListener('pointerdown', this._onDown);
    // A ResizeObserver, not just the window event: the canvas is laid out AFTER
    // open() constructs this (the deploy screen is still hidden at that point),
    // so the first real size only arrives once the screen is shown — and it also
    // changes when the sidebar reflows at a breakpoint, which fires no resize.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this._sizeCanvas();
        this._paint();
      });
      this._ro.observe(c);
    }
    // Move/up live on the window so a drag that leaves the canvas — which every
    // remove gesture does by definition — still tracks and still completes.
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
    window.addEventListener('resize', this._onResize);
    // The canvas is a drawing surface, not a document: scrolling or pinch-zooming
    // it mid-arrangement is never the intent. CSS `touch-action:none` does the
    // real work; this is the belt to that suspenders.
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    this._alive = false;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._ro = null;
    this.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._onResize);
  }

  /** Client coordinates -> arena coordinates. */
  _toScene(ev) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: ((ev.clientX - rect.left) / rect.width) * this.arena.width,
      y: ((ev.clientY - rect.top) / rect.height) * this.arena.height,
    };
  }

  _hitTest(p) {
    // Back to front, so the unit drawn on top is the one you grab.
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!this.editableTeams.has(u.team)) continue;
      const r = Math.max(14, this._radius(this.byId.get(u.speciesId)) * 1.3);
      if (Math.hypot(u.x - p.x, u.y - p.y) <= r) return u;
    }
    return null;
  }

  _pointerDown(ev) {
    const p = this._toScene(ev);
    this._pointer = p;

    const hit = this._hitTest(p);
    if (hit) {
      ev.preventDefault();
      this.canvas.setPointerCapture?.(ev.pointerId);
      this._drag = { kind: 'move', unit: hit, pointerId: ev.pointerId, moved: false, from: { x: hit.x, y: hit.y } };
      this._paint();
      return;
    }

    // Empty floor with a card armed: place one there.
    if (this.brush && this.editableTeams.has(this.activeTeam)) {
      ev.preventDefault();
      const why = this.addAt(this.activeTeam, this.brush, p.x, p.y);
      if (why) this._reject(why);
    }
  }

  _pointerMove(ev) {
    if (!this._drag) return;
    if (this._drag.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    const p = this._toScene(ev);
    this._pointer = p;
    this._drag.moved = true;

    if (this._drag.kind === 'move') {
      const u = this._drag.unit;
      // Follow the finger exactly while dragging; the separation pass runs on
      // release. Settling every frame makes a dragged unit squirm away from the
      // pointer, which feels broken even though the end state is the same.
      u.x = p.x;
      u.y = p.y;
    }
    this._paint();
  }

  _pointerUp(ev) {
    const drag = this._drag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    this._drag = null;
    const p = this._toScene(ev);

    if (drag.kind === 'tray') {
      // A tray press that never moved is a tap: arm the card instead of placing,
      // so the two gestures don't fight each other. Reported back rather than
      // handled here — what a tap MEANS is the tray's business, not the floor's.
      if (drag.moved) {
        const why = this.addAt(drag.team, drag.speciesId, p.x, p.y);
        if (why) this._reject(why);
      } else {
        this.onTrayTap?.(drag.speciesId);
      }
      this._pointer = null;
      this._paint();
      return;
    }

    const u = drag.unit;
    if (!drag.moved) {
      this._paint();
      return;
    }

    if (!this._inZone(u.team, p.x, p.y)) {
      // Dragged off its own deploy zone — taken back off the field, budget refunded.
      this.units = this.units.filter((x) => x.id !== u.id);
      this._changed();
      return;
    }

    const settled = this._settle(u.team, this.byId.get(u.speciesId), p.x, p.y, u.id);
    u.x = settled.x;
    u.y = settled.y;
    this._pointer = null;
    this._changed();
  }

  _reject(why) {
    this.onReject?.(why);
  }

  _changed() {
    this.onChange?.(this.snapshot());
    this._paint();
  }

  // --- internals: drawing ----------------------------------------------------

  /**
   * Match the backing store to how big the canvas is actually being DISPLAYED.
   *
   * Sizing it to the arena's logical dimensions instead meant a 1180px-wide sand
   * on a desktop was an 820px image stretched up — soft edges on every sprite and
   * a visibly fuzzy dashed zone border, on the screen the player spends most of
   * their time looking at. Capped so a 4K monitor does not rasterize a canvas
   * nobody asked for.
   */
  _sizeCanvas() {
    const MAX_BACKING = 2400;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Before first layout the element has no box; the arena's own size is the
    // right guess and the resize handler corrects it a frame later.
    const cssW = this.canvas.getBoundingClientRect().width || this.arena.width;
    const w = Math.min(MAX_BACKING, Math.max(320, Math.round(cssW * dpr)));

    this.canvas.width = w;
    this.canvas.height = Math.round((w * this.arena.height) / this.arena.width);
    // Everything below draws in ARENA coordinates; this is the one place that
    // knows how many device pixels one of those is worth.
    this._scale = this.canvas.width / this.arena.width;
  }

  _paint() {
    if (!this._alive) return;
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const ctx = this.ctx;
    const { width: W, height: H, wallThickness: t } = this.arena;
    ctx.save();
    ctx.setTransform(this._scale, 0, 0, this._scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- the sand ------------------------------------------------------------
    // Lit from above like the pit it is, with grit and a few scuff arcs so it is
    // a SURFACE rather than a gradient. The player stares at this rectangle for
    // longer than any other pixel in the game.
    const g = ctx.createRadialGradient(W / 2, H * 0.36, 40, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, '#6a5138');
    g.addColorStop(0.55, '#4a3826');
    g.addColorStop(1, '#2b2015');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // grit
    for (let i = 0; i < 520; i++) {
      const x = hash2(i, 1) * W;
      const y = hash2(i, 2) * H;
      const a = hash2(i, 3);
      ctx.fillStyle = a > 0.5 ? `rgba(255,231,190,${0.05 + a * 0.05})` : `rgba(0,0,0,${0.05 + a * 0.09})`;
      ctx.fillRect(x, y, 1 + (a > 0.85 ? 1 : 0), 1);
    }

    // drag scuffs — the marks of every fight that came before this one
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      const x = hash2(i, 11) * W;
      const y = hash2(i, 12) * H;
      const r = 22 + hash2(i, 13) * 70;
      const a0 = hash2(i, 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a0 + 0.7 + hash2(i, 15));
      ctx.stroke();
    }

    // --- deploy zones --------------------------------------------------------
    for (const team of ['A', 'B']) {
      const z = this.zoneOf(team);
      const editable = this.editableTeams.has(team);
      const live = editable && team === this.activeTeam;
      const zw = z.x1 - z.x0;
      const zh = z.y1 - z.y0;

      // A gradient that fades toward no-man's-land, so the two halves read as
      // territory rather than as two boxes drawn on a floor.
      const zg = ctx.createLinearGradient(team === 'A' ? z.x0 : z.x1, 0, team === 'A' ? z.x1 : z.x0, 0);
      zg.addColorStop(0, TEAM[team].zone);
      zg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = zg;
      ctx.fillRect(z.x0, z.y0, zw, zh);

      ctx.save();
      ctx.setLineDash([10, 9]);
      ctx.lineWidth = live ? 2.5 : 2;
      ctx.strokeStyle = live ? TEAM[team].ring : 'rgba(255,255,255,0.15)';
      if (live) {
        ctx.shadowColor = TEAM[team].ring;
        ctx.shadowBlur = 12;
      }
      ctx.strokeRect(z.x0, z.y0, zw, zh);
      ctx.restore();

      // Corner brackets: a HUD tell that this rectangle is a place you act in.
      const c = 18;
      ctx.strokeStyle = live ? TEAM[team].ring : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      for (const [cx, cy, sx, sy] of [
        [z.x0, z.y0, 1, 1],
        [z.x1, z.y0, -1, 1],
        [z.x0, z.y1, 1, -1],
        [z.x1, z.y1, -1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * c, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + sy * c);
        ctx.stroke();
      }

      ctx.font = '700 13px ui-monospace, "Cascadia Mono", Consolas, monospace';
      ctx.fillStyle = live ? TEAM[team].ring : 'rgba(255,255,255,0.34)';
      ctx.textAlign = team === 'A' ? 'left' : 'right';
      ctx.textBaseline = 'bottom';
      ctx.letterSpacing = '2px';
      ctx.fillText(TEAM[team].label, team === 'A' ? z.x0 + 2 : z.x1 - 2, z.y0 - 7);
      ctx.letterSpacing = '0px';
    }

    // --- no-man's-land -------------------------------------------------------
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 11]);
    ctx.beginPath();
    ctx.moveTo(W / 2, t);
    ctx.lineTo(W / 2, H - t);
    ctx.stroke();
    ctx.restore();

    // --- walls ---------------------------------------------------------------
    // Stone rather than a flat stroke: a lit inner lip, a dark body, and seams.
    ctx.strokeStyle = '#241a11';
    ctx.lineWidth = t;
    ctx.strokeRect(t / 2, t / 2, W - t, H - t);
    ctx.strokeStyle = 'rgba(255,214,150,0.10)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(t, t, W - t * 2, H - t * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = t * 2; x < W - t; x += 46) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, t);
      ctx.moveTo(x + 23, H - t);
      ctx.lineTo(x + 23, H);
    }
    for (let y = t * 2; y < H - t; y += 46) {
      ctx.moveTo(0, y);
      ctx.lineTo(t, y);
      ctx.moveTo(W - t, y + 23);
      ctx.lineTo(W, y + 23);
    }
    ctx.stroke();

    // Units
    const dragged = this._drag?.kind === 'move' ? this._drag.unit : null;
    for (const u of this.units) this._drawUnit(ctx, u, u === dragged);

    // Ghost of a tray drag in flight
    if (this._drag?.kind === 'tray' && this._drag.moved && this._pointer) {
      const sp = this.byId.get(this._drag.speciesId);
      const ok = this._inZone(this._drag.team, this._pointer.x, this._pointer.y) && !this._canAdd(this._drag.team, this._drag.speciesId);
      ctx.globalAlpha = ok ? 0.85 : 0.35;
      this._drawUnit(ctx, { team: this._drag.team, speciesId: this._drag.speciesId, x: this._pointer.x, y: this._pointer.y }, true);
      ctx.globalAlpha = 1;
      if (!ok) {
        ctx.strokeStyle = '#ff5d73';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this._pointer.x, this._pointer.y, this._radius(sp) * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Empty-field hint, so a first-time player is never looking at a blank floor
    // with no idea what is being asked of them.
    if (!this.units.some((u) => this.editableTeams.has(u.team))) {
      const z = this.zoneOf(this.activeTeam);
      const cx = (z.x0 + z.x1) / 2;
      const cy = H / 2;
      ctx.save();
      ctx.textAlign = 'center';

      // A dashed target with the instruction under it. Two short lines, because
      // one long one wrapped off the zone on a phone.
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.26)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 34, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 48);
      ctx.lineTo(cx, cy - 20);
      ctx.moveTo(cx - 14, cy - 34);
      ctx.lineTo(cx + 14, cy - 34);
      ctx.stroke();

      // Sized against the ZONE, not the canvas: the hint has to fit inside the
      // player's own half, and on a phone that half is about 290 arena units
      // wide — narrow enough that a fixed 14px sub-line ran out past the dashed
      // border and read as a rendering fault.
      const zw = z.x1 - z.x0;
      const fit = (text, px) => {
        let size = px;
        ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
        while (size > 9 && ctx.measureText(text).width > zw - 20) {
          size -= 1;
          ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
        }
        return size;
      };

      const sub = 'drag one from the tray, or tap a card then tap here';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.textBaseline = 'top';
      const head = fit('Put your colony here', 19);
      ctx.font = `650 ${head}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText('Put your colony here', cx, cy + 6);

      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      fit(sub, 13);
      ctx.fillText(sub, cx, cy + head + 13);
      ctx.restore();
    }

    ctx.restore();
  }

  _drawUnit(ctx, u, highlighted) {
    const sp = this.byId.get(u.speciesId);
    if (!sp) return;
    const r = this._radius(sp);
    const col = TEAM[u.team];

    // Shadow, cast away from the light at the top of the pit.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + r * 0.7, r * 1.15, r * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Team footprint: a filled disc under the sprite plus a ring around it. The
    // disc is what makes a 30-unit field readable — at a glance you see two
    // coloured masses, and only then which species they are made of.
    ctx.save();
    const rr = r * 1.55;
    const disc = ctx.createRadialGradient(u.x, u.y, 0, u.x, u.y, rr);
    disc.addColorStop(0, col.glow);
    disc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(u.x, u.y, rr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = col.ring;
    ctx.lineWidth = highlighted ? 3 : 1.8;
    ctx.globalAlpha = highlighted ? 1 : 0.72;
    if (highlighted) {
      ctx.shadowColor = col.ring;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(u.x, u.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // The unit, facing the enemy it is about to meet.
    drawAgent(ctx, { x: u.x, y: u.y, angle: u.team === 'A' ? 0 : Math.PI }, sp.visual, {
      spriteCache: this.spriteCache,
    });
  }
}
