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
  A: { ring: '#4aa3ff', glow: 'rgba(74,163,255,0.20)', zone: 'rgba(74,163,255,0.055)', label: 'YOUR COLONY' },
  B: { ring: '#ff5d73', glow: 'rgba(255,93,115,0.20)', zone: 'rgba(255,93,115,0.055)', label: 'OPPOSITION' },
};

let _seq = 0;

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

  _sizeCanvas() {
    // Backing store at up to 2x the arena's logical size: sharp on a phone
    // without paying 3x the fill rate on a high-DPR desktop for a static scene.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.arena.width * dpr);
    this.canvas.height = Math.round(this.arena.height * dpr);
    this._dpr = dpr;
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
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Floor
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, '#5b4530');
    g.addColorStop(1, '#33261a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Deploy zones
    for (const team of ['A', 'B']) {
      const z = this.zoneOf(team);
      const editable = this.editableTeams.has(team);
      ctx.fillStyle = TEAM[team].zone;
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.setLineDash([9, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = editable && team === this.activeTeam ? TEAM[team].ring : 'rgba(255,255,255,0.13)';
      ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.setLineDash([]);

      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = editable && team === this.activeTeam ? TEAM[team].ring : 'rgba(255,255,255,0.30)';
      ctx.textAlign = team === 'A' ? 'left' : 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(TEAM[team].label, team === 'A' ? z.x0 + 6 : z.x1 - 6, z.y0 + 6);
    }

    // Centre line
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 10]);
    ctx.beginPath();
    ctx.moveTo(W / 2, t);
    ctx.lineTo(W / 2, H - t);
    ctx.stroke();
    ctx.setLineDash([]);

    // Walls
    ctx.strokeStyle = '#2a1e14';
    ctx.lineWidth = t;
    ctx.strokeRect(t / 2, t / 2, W - t, H - t);

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
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.font = '500 17px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const z = this.zoneOf(this.activeTeam);
      ctx.fillText('Drag a specimen here, or tap one then tap the floor', (z.x0 + z.x1) / 2, H / 2);
    }

    ctx.restore();
  }

  _drawUnit(ctx, u, highlighted) {
    const sp = this.byId.get(u.speciesId);
    if (!sp) return;
    const r = this._radius(sp);
    const col = TEAM[u.team];

    // Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + r * 0.55, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Team footprint
    ctx.save();
    ctx.fillStyle = col.glow;
    ctx.beginPath();
    ctx.arc(u.x, u.y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col.ring;
    ctx.lineWidth = highlighted ? 3 : 1.6;
    ctx.globalAlpha = highlighted ? 1 : 0.75;
    ctx.beginPath();
    ctx.arc(u.x, u.y, r * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // The unit, facing the enemy it is about to meet.
    drawAgent(ctx, { x: u.x, y: u.y, angle: u.team === 'A' ? 0 : Math.PI }, sp.visual, {
      spriteCache: this.spriteCache,
    });
  }
}
