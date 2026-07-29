// Canvas A — the deploy sand. 960×600 logical (8:5), painted per UI spec 08.
//
// The floor, grit, scuffs, zones and stone wall are static: they are painted
// once into an offscreen buffer and blitted, so dragging a unit across the sand
// never re-randomizes the grit underneath it. Only units are drawn per frame.
//
// Every measurement is expressed as a fraction of W/H so the layer survives any
// DPR or letterbox scaling.

export const T = {
  ink0: '#120d09', ink1: '#1a140e', ink2: '#241b12', ink3: '#2f2417',
  line1: '#3e2f1f', line2: '#584330',
  amber: '#e8a33d', amberDeep: '#a9741f', amberGlow: '#ffd98a',
  bone: '#efe6d6', muted: '#a8937c', faint: '#71624f',
  good: '#84c98b', danger: '#d9584a',
  // ⚑ Must match --team-a / --team-b in tokens.css and TEAM in canvasRenderer.js.
  teamA: '#58a4e8', teamB: '#e85f6e',
};

export const ZONE = { A_MAX: 0.4, B_MIN: 0.6 }; // deploy zones as fractions of W

const artCache = new Map();

/** Load a species SVG once; callers redraw when `onReady` fires. */
export function loadArt(src, onReady) {
  if (artCache.has(src)) return artCache.get(src);
  const img = new Image();
  img.onload = () => onReady && onReady();
  img.onerror = () => artCache.set(src, null);
  img.src = src;
  artCache.set(src, img);
  return img;
}

function art(src) {
  const img = artCache.get(src);
  return img && img.complete && img.naturalWidth ? img : null;
}

// --- Static layer ----------------------------------------------------------

function buildStatic(W, H) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  // Floor: radial gradient off-centre, so the pit reads as lit from one side.
  const g = ctx.createRadialGradient(W * 0.48, H * 0.42, H * 0.08, W * 0.5, H * 0.5, W * 0.62);
  g.addColorStop(0, '#33261a');
  g.addColorStop(0.72, '#241a11');
  g.addColorStop(1, '#1a1209');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Grit: ~900 1.4px specks, half light half dark.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.fillStyle =
      Math.random() < 0.5
        ? `rgba(239,230,214,${0.03 + Math.random() * 0.05})`
        : `rgba(0,0,0,${0.04 + Math.random() * 0.06})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  // Scuffs: drag marks from every colony that fought here before.
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const x = W * 0.15 + Math.random() * W * 0.7;
    const y = H * 0.15 + Math.random() * H * 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 10 + Math.random() * 26, Math.random() * 3, Math.random() * 3 + 2.2);
    ctx.stroke();
  }

  // No-man's-land: the middle 20% is simply darker. The band IS the divider —
  // there is no centre line to compete with the frontier dashes.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(W * ZONE.A_MAX, 0, W * (ZONE.B_MIN - ZONE.A_MAX), H);

  // Deploy zones: 7% tint, an inset frame, and a dashed inner frontier.
  const zone = (x0, color, label, align) => {
    ctx.fillStyle = color + '12';
    ctx.fillRect(x0, 0, W * 0.4, H);
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(x0 + 8, 8, W * 0.4 - 16, H - 16);
    ctx.strokeStyle = color + '99';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 9]);
    const inner = align === 'left' ? x0 + W * 0.4 : x0;
    ctx.beginPath();
    ctx.moveTo(inner, 10);
    ctx.lineTo(inner, H - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color + 'bb';
    ctx.font = `600 ${Math.round(H * 0.028)}px ui-monospace, monospace`;
    ctx.textAlign = align === 'left' ? 'left' : 'right';
    ctx.fillText(label, align === 'left' ? x0 + 22 : x0 + W * 0.4 - 22, H - 24);
  };
  zone(0, T.teamA, 'YOUR COLONY', 'left');
  zone(W * ZONE.B_MIN, T.teamB, 'OPPOSITION', 'right');

  // Stone wall: a heavy dark stroke with a lit inner seam and masonry ticks.
  ctx.strokeStyle = '#0f0a06';
  ctx.lineWidth = H * 0.035;
  ctx.strokeRect(0, 0, W, H);
  const b = (H * 0.035) / 2;
  ctx.strokeStyle = '#4a3826';
  ctx.lineWidth = 1;
  ctx.strokeRect(b, b, W - 2 * b, H - 2 * b);
  ctx.strokeStyle = 'rgba(74,56,38,0.5)';
  for (let x = 0; x < W; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, b * 2);
    ctx.moveTo(x + 36, H - b * 2);
    ctx.lineTo(x + 36, H);
    ctx.stroke();
  }
  return cv;
}

let cached = null;

/** Discard the static buffer (e.g. entering a new level). */
export function reseed() {
  cached = null;
}

// --- Unit layer ------------------------------------------------------------

function drawUnit(ctx, u, W, H) {
  const x = u.x * W;
  const y = u.y * H;
  const s = H * 0.052;
  const color = u.team === 'b' ? T.teamB : T.teamA;

  // Contact shadow — without it, units float.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.55, s * 0.75, s * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // Team ring. A selected unit flips amber and gains a dashed halo.
  ctx.strokeStyle = u.selected ? T.amber : color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (u.selected) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = T.amber + '88';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const img = art(u.art);
  if (img) {
    const d = s * 1.45;
    ctx.drawImage(img, x - d / 2, y - d / 2, d, d);
  } else {
    // Procedural stand-in until the sprite resolves, so a unit is never invisible.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.18, s * 0.28, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - s * 0.4, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Paint the sand.
 * @param {HTMLCanvasElement} cv
 * @param {Array<{x,y,team,art,selected}>} units - positions are 0..1 fractions.
 * @param {{ghost?:{x,y,art}}} [opts] - a unit being dragged but not yet dropped.
 */
export function paintSand(cv, units = [], opts = {}) {
  const W = cv.width;
  const H = cv.height;
  const ctx = cv.getContext('2d');
  if (!cached || cached.width !== W || cached.height !== H) cached = buildStatic(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(cached, 0, 0);

  // Painter's order: far units (higher on the sand) first.
  for (const u of [...units].sort((a, b) => a.y - b.y)) drawUnit(ctx, u, W, H);

  if (opts.ghost) {
    ctx.globalAlpha = 0.65;
    drawUnit(ctx, { ...opts.ghost, team: 'a', selected: true }, W, H);
    ctx.globalAlpha = 1;
  }

  // Illegal drop feedback: the whole enemy half flashes when a placement is
  // rejected, which is faster to read than a toast.
  if (opts.reject) {
    ctx.fillStyle = 'rgba(232,95,110,0.18)';
    ctx.fillRect(W * ZONE.A_MAX, 0, W * (1 - ZONE.A_MAX), H);
  }
}

/** True when a normalized point is inside the player's deploy zone. */
export function inPlayerZone(x, y) {
  return x > 0.02 && x < ZONE.A_MAX - 0.01 && y > 0.03 && y < 0.97;
}

/** Convert a pointer event to normalized sand coordinates. */
export function pointerToSand(cv, ev) {
  const r = cv.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) / r.width,
    y: (ev.clientY - r.top) / r.height,
  };
}

/**
 * Tidy formation — pack units into neat ranks inside the deploy zone. Spacing
 * is at least 1.6× the unit size so rings never overlap illegibly, which is the
 * legibility rule the spec sets for 30+ units.
 */
export function tidy(units) {
  const cols = Math.max(3, Math.ceil(Math.sqrt(units.length * 0.8)));
  const rows = Math.ceil(units.length / cols);
  const dx = Math.min(0.085, (ZONE.A_MAX - 0.1) / cols);
  const dy = Math.min(0.14, 0.86 / Math.max(1, rows));
  const y0 = 0.5 - ((rows - 1) * dy) / 2;
  return units.map((u, i) => ({
    ...u,
    x: 0.07 + (i % cols) * dx,
    y: y0 + Math.floor(i / cols) * dy,
  }));
}

/** Lay the opposition out on their half so the player can read the matchup. */
export function enemyPositions(lineup) {
  const out = [];
  let i = 0;
  const total = lineup.reduce((n, l) => n + l.count, 0);
  const cols = Math.max(2, Math.ceil(Math.sqrt(total * 0.7)));
  const rows = Math.ceil(total / cols);
  const dy = Math.min(0.14, 0.86 / Math.max(1, rows));
  const y0 = 0.5 - ((rows - 1) * dy) / 2;
  for (const l of lineup) {
    for (let k = 0; k < l.count; k++, i++) {
      out.push({
        team: 'b',
        art: l.art,
        x: 0.93 - (i % cols) * 0.075,
        y: y0 + Math.floor(i / cols) * dy,
      });
    }
  }
  return out;
}
