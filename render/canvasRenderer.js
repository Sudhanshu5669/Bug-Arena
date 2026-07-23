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
const STATUS_COLOR = { burn: '#ff7a2c', web: '#c9a8ff' };
// Floating damage-number color by cause (falls back to a neutral hit color).
const DAMAGE_COLOR = {
  burn: '#ff9a3c',
  ember_burst: '#ff7a2c',
  dash_strike: '#ffd24a',
  chemical_blast: '#c8ff6a',
};

export class CanvasRenderer {
  constructor(canvas, init) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.spriteCache = new SpriteCache();

    this.RENDER_W = 1280; // 16:9 render target (see camera note above)
    this.RENDER_H = 720;

    this.latest = null;
    this.effects = [];
    this._floatText = []; // rising combat text: damage numbers, ability tags, K.O.
    this._prevPos = new Map(); // id -> {x,y} for movement detection
    this._agentFx = new Map(); // id -> { flash } attack pop timers
    this._lastFrameTs = 0;

    this.setInit(init);
  }

  /** (Re)configure from an init payload: scene dims, catalog, camera, background, sprites. */
  setInit(init) {
    this.arena = init.arena; // scene dimensions
    this.catalog = {};
    for (const s of init.catalog) this.catalog[s.id] = s;

    this.canvas.width = this.RENDER_W;
    this.canvas.height = this.RENDER_H;

    this._setupCamera();
    this._buildBackground();

    // Preload one sprite image per species (async; shapes show until loaded).
    preloadSprites(init.catalog, this.spriteCache, '/assets/sprites');

    this.effects = [];
    this._floatText = [];
    this._prevPos.clear();
    this._agentFx.clear();
  }

  /** Map scene(arena) space into the 16:9 canvas, centered, with room for dressing. */
  _setupCamera() {
    const cw = this.RENDER_W;
    const ch = this.RENDER_H;
    const sw = this.arena.width;
    const sh = this.arena.height;
    // Arena floor fills ~72% width / ~84% height; the remainder frames the stadium.
    const scale = Math.min((cw * 0.72) / sw, (ch * 0.84) / sh);
    const drawW = sw * scale;
    const drawH = sh * scale;
    const offX = (cw - drawW) / 2;
    const offY = (ch - drawH) * 0.62; // bias down slightly to leave headroom for banners
    this.camera = { scale, offX, offY, drawW, drawH, sw, sh };
  }

  toCanvasX(x) {
    return this.camera.offX + x * this.camera.scale;
  }

  toCanvasY(y) {
    return this.camera.offY + y * this.camera.scale;
  }

  // ---------------------------------------------------------------------------
  // Static background (built once per setInit into an offscreen canvas)
  // ---------------------------------------------------------------------------

  _buildBackground() {
    const W = this.RENDER_W;
    const H = this.RENDER_H;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const c = off.getContext('2d');

    const { offX, offY, drawW, drawH } = this.camera;
    const ring = 30; // stone wall thickness (canvas px)
    const ax = offX;
    const ay = offY;
    const aw = drawW;
    const ah = drawH;
    const cornerFloor = Math.min(aw, ah) * 0.14;
    const cornerRing = cornerFloor + ring * 0.5;

    // 1) Stadium backdrop (dark, warm stone) + faint speckle.
    const back = c.createLinearGradient(0, 0, 0, H);
    back.addColorStop(0, '#0d0b09');
    back.addColorStop(0.55, '#16110c');
    back.addColorStop(1, '#0a0806');
    c.fillStyle = back;
    c.fillRect(0, 0, W, H);
    this._speckle(c, 0, 0, W, H, 1400, 'rgba(255,225,190,0.02)');

    // 2) Stone boundary ring (rounded square just outside the floor).
    roundRect(c, ax - ring, ay - ring, aw + ring * 2, ah + ring * 2, cornerRing);
    const stone = c.createLinearGradient(0, ay - ring, 0, ay + ah + ring);
    stone.addColorStop(0, '#5b5048');
    stone.addColorStop(0.5, '#3a322c');
    stone.addColorStop(1, '#241e19');
    c.fillStyle = stone;
    c.fill();
    // top bevel highlight on the ring
    c.save();
    roundRect(c, ax - ring, ay - ring, aw + ring * 2, ah + ring * 2, cornerRing);
    c.clip();
    c.strokeStyle = 'rgba(255,220,180,0.10)';
    c.lineWidth = 3;
    roundRect(c, ax - ring + 2, ay - ring + 2, aw + ring * 2 - 4, ah + ring * 2 - 4, cornerRing);
    c.stroke();
    c.restore();
    this._ringBlocks(c, ax - ring, ay - ring, aw + ring * 2, ah + ring * 2, cornerRing, ring);

    // 3) Sand / dirt floor (radial light pooling in the center + grit + scuffs).
    c.save();
    roundRect(c, ax, ay, aw, ah, cornerFloor);
    c.clip();
    const cx = ax + aw / 2;
    const cy = ay + ah / 2;
    const sand = c.createRadialGradient(cx, cy * 0.98, aw * 0.05, cx, cy, Math.max(aw, ah) * 0.72);
    sand.addColorStop(0, '#d8b483');
    sand.addColorStop(0.55, '#bd925f');
    sand.addColorStop(1, '#7f5433');
    c.fillStyle = sand;
    c.fillRect(ax, ay, aw, ah);
    this._speckle(c, ax, ay, aw, ah, 5200, 'rgba(60,38,20,0.16)'); // dark grit
    this._speckle(c, ax, ay, aw, ah, 3200, 'rgba(255,240,210,0.10)'); // light grit
    this._scuffs(c, cx, cy, aw, ah); // drag-mark arcs
    // inner shadow from the wall
    c.strokeStyle = 'rgba(0,0,0,0.38)';
    c.lineWidth = 18;
    roundRect(c, ax + 9, ay + 9, aw - 18, ah - 18, cornerFloor);
    c.stroke();
    c.restore();

    // 4) Stadium dressing: banners along the top, torches at the four corners.
    this._banners(c, ax, ay - ring, aw);
    this._torches = [
      { x: ax - ring, y: ay - ring },
      { x: ax + aw + ring, y: ay - ring },
      { x: ax - ring, y: ay + ah + ring },
      { x: ax + aw + ring, y: ay + ah + ring },
    ];
    for (const t of this._torches) this._torchBase(c, t.x, t.y);

    // 5) Vignette — darken toward the edges so the center action pops.
    const vig = c.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = vig;
    c.fillRect(0, 0, W, H);

    this.bg = off;
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
    this.latest = snapshot;
    for (const ev of snapshot.events) {
      if (ev.type === 'effect') {
        this.effects.push({ ...ev, life: 1, ttl: ttlFor(ev.kind) });
      } else if (ev.type === 'attack') {
        // Attack "pop" on the attacker + a themed strike mark at the target.
        this._agentFx.set(ev.attackerId, { flash: 1 });
        if (ev.kind === 'melee') {
          this.effects.push({ kind: 'slash', x: ev.x, y: ev.y, life: 1, ttl: 0.18 });
        }
      } else if (ev.type === 'damage') {
        this._addDamageNumber(ev);
      } else if (ev.type === 'ability') {
        // Floating ability tag above the caster (e.g. "Web Trap!").
        this._floatText.push({
          kind: 'ability',
          text: `${ev.ability ?? 'Ability'}!`,
          x: ev.x ?? 0,
          y: (ev.y ?? 0) - 6,
          color: '#ffe08a',
          rise: 26,
          life: 1,
          ttl: 1.0,
        });
      } else if (ev.type === 'death') {
        const color = this.catalog[ev.victimSpecies]?.visual?.color || '#caa';
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    this._drawFlames(ctx, now);

    if (!this.latest) return;

    // Enter scene space: everything below is in engine/arena coordinates.
    const { scale, offX, offY } = this.camera;
    ctx.setTransform(scale, 0, 0, scale, offX, offY);

    this._drawFood(ctx, this.latest.food);
    this._drawShadows(ctx, this.latest.agents);
    this._drawAgents(ctx, this.latest.agents, now);
    this._drawEffects(ctx);
    this._drawFloatText(ctx); // damage numbers, ability tags, K.O. — on top

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._ageEffects(dt);
    this._ageAgentFx(dt);
    this._ageFloatText(dt);
  }

  _drawFloatText(ctx) {
    if (!this._floatText.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const f of this._floatText) {
      const a = Math.max(0, Math.min(1, f.life));
      const y = f.y - (1 - f.life) * (f.rise || 20); // rise as it fades
      ctx.globalAlpha = a;
      ctx.font = f.kind === 'dmg' ? 'bold 13px system-ui, sans-serif' : 'bold 11px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color || '#fff';
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _ageFloatText(dt) {
    for (const f of this._floatText) f.life -= dt / f.ttl;
    this._floatText = this._floatText.filter((f) => f.life > 0);
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
    for (const f of food) {
      // glisten
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,210,120,0.20)';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // morsel
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fillStyle = '#e7b96b';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#7a4f22';
      ctx.stroke();
      // highlight
      ctx.beginPath();
      ctx.arc(f.x - f.size * 0.3, f.y - f.size * 0.3, f.size * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
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

      // --- movement + action driven squash/stretch ---
      const prev = this._prevPos.get(a.id);
      const moved = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) : 0;
      this._prevPos.set(a.id, { x: a.x, y: a.y });
      const phase = t * 11 + hashId(a.id);
      let sx = 1;
      let sy = 1;
      if (a.action === 'attack') {
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

      // --- webbed / immobilized: struggle shake on the body + overlay ---
      const webbed = a.statuses.some((s) => s.immobilize || s.type === 'web');
      const jx = webbed ? Math.sin(t * 34 + hashId(a.id)) * 1.6 : 0;
      const jy = webbed ? Math.cos(t * 31 + hashId(a.id)) * 1.2 : 0;

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

  _drawStatusLabels(ctx, a, size) {
    if (!a.statuses.length) return;
    let y = a.y - size * 2.1 - 13;
    ctx.save();
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of a.statuses) {
      const text = s.remaining != null ? `${s.label} ${s.remaining}s` : s.label;
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      roundRect(ctx, a.x - w / 2, y - 6, w, 12, 3);
      ctx.fill();
      ctx.fillStyle = STATUS_COLOR[s.type] || '#dcdcdc';
      ctx.fillText(text, a.x, y + 0.5);
      y -= 14;
    }
    ctx.restore();
  }

  _drawHealthBar(ctx, a, size) {
    const pct = Math.max(0, Math.min(1, a.health / a.maxHealth));
    if (pct >= 1) return; // hide full bars to reduce clutter
    const barW = size * 2.4;
    const x = a.x - barW / 2;
    const y = a.y - size * 2.1 - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, barW + 2, 5);
    ctx.fillStyle = pct > 0.5 ? '#5ad86a' : pct > 0.25 ? '#e6c34a' : '#e6564a';
    ctx.fillRect(x, y, barW * pct, 3);
  }

  _drawEffects(ctx) {
    for (const fx of this.effects) drawEffect(ctx, fx);
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

function ttlFor(kind) {
  switch (kind) {
    case 'explosion':
      return 0.5;
    case 'web_cast':
      return 0.4; // strands shoot out then fade fast (not a lingering beam)
    case 'flare':
      return 0.45;
    case 'dash':
      return 0.28;
    case 'burn':
      return 0.3;
    default:
      return 0.3;
  }
}

/** Draw a single fading effect in scene coords. `fx.life` runs 1 -> 0. */
function drawEffect(ctx, fx) {
  const a = Math.max(0, Math.min(1, fx.life));
  ctx.save();
  ctx.globalAlpha = a;
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
