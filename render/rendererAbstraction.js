// Renderer abstraction — the pluggable "how a species looks" layer.
//
// `drawAgent` switches on `visual.type`. Today only 'shape' is implemented; the
// 'sprite' branch is stubbed with the full call signature so a real sprite-based
// species can be dropped in later WITHOUT touching the engine or other species.
//
// Everything here uses only standard CanvasRenderingContext2D calls, so the SAME
// module works with the browser canvas today and with node-canvas in a future
// headless `videoRenderer.js`. It has zero engine imports.

/**
 * Draw one agent's body per its visual descriptor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} agent   - snapshot agent { x, y, angle, action, ... }
 * @param {object} visual  - the species visual descriptor (from the catalog)
 * @param {object} [opts]  - { spriteCache, scaleX, scaleY } — scaleX/scaleY drive
 *                           squash-and-stretch; the scene renderer computes them.
 */
export function drawAgent(ctx, agent, visual, opts = {}) {
  const v = visual || { type: 'shape', shape: 'circle', color: '#cccccc', size: 8 };
  switch (v.type) {
    case 'sprite':
      return drawSprite(ctx, agent, v, opts);
    case 'shape':
    default:
      return drawShape(ctx, agent, v, opts);
  }
}

// -----------------------------------------------------------------------------
// Shape descriptors (also the fallback when a sprite image is unavailable)
// -----------------------------------------------------------------------------

function drawShape(ctx, agent, v, opts = {}) {
  const size = v.size ?? 8;
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  ctx.save();
  ctx.translate(agent.x, agent.y);
  ctx.rotate(agent.angle || 0);
  ctx.scale(sx, sy);

  ctx.beginPath();
  tracePath(ctx, v.shape || 'circle', size);
  ctx.fillStyle = v.color || '#cccccc';
  ctx.fill();
  if (v.stroke) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = v.stroke;
    ctx.stroke();
  }
  ctx.restore();
}

/** Build the path for a named shape at the origin (caller handles transform). */
function tracePath(ctx, shape, size) {
  switch (shape) {
    case 'triangle':
      // Points along +x so body.angle aims the nose at the target.
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.8, size * 0.8);
      ctx.lineTo(-size * 0.8, -size * 0.8);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(-size, -size, size * 2, size * 2);
      break;
    case 'diamond':
      ctx.moveTo(size, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size, 0);
      ctx.lineTo(0, -size);
      ctx.closePath();
      break;
    case 'polygon': {
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const px = Math.cos(a) * size;
        const py = Math.sin(a) * size;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'circle':
    default:
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      break;
  }
}

// -----------------------------------------------------------------------------
// Sprite descriptors
// -----------------------------------------------------------------------------

/**
 * Draw a sprite-based agent. Descriptor shape:
 *   {
 *     type: 'sprite',
 *     sprite: 'fireAnt',          // -> resolved by the loader to <base>/fireAnt.png
 *     spriteScale: 2.6,           // drawn half-extent = size * spriteScale
 *     spriteFacing: 'up',         // orientation the source art faces ('up' | 'right')
 *     size, shape, color, stroke, // fallback shape fields (used if image absent)
 *     // --- optional, for FUTURE frame-based animation (single image for v1) ---
 *     frameWidth, frameHeight,
 *     animations: { idle:{row:0,frames:4,fps:6}, attack:{row:1,frames:6,fps:12} },
 *   }
 *
 * If the image isn't loaded yet (or is missing), this falls back to the shape
 * renderer so the sim never blanks out or crashes during development.
 */
function drawSprite(ctx, agent, v, opts = {}) {
  const cache = opts.spriteCache;
  const key = v.sprite || v.spriteSheet;
  const image = cache && key ? cache.get(key) : null;

  if (!image) {
    return drawShape(ctx, agent, v, opts); // graceful fallback — same descriptor's shape fields
  }

  const size = v.size ?? 12;
  const half = size * (v.spriteScale ?? 2.5);
  const facingOffset = v.spriteFacing === 'right' ? 0 : Math.PI / 2; // 'up' is the default convention
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;

  ctx.save();
  ctx.translate(agent.x, agent.y);
  ctx.rotate((agent.angle || 0) + facingOffset);
  ctx.scale(sx, sy);

  if (v.frameWidth && v.animations) {
    // Spritesheet path — kept ready for later; unused while species ship single images.
    const anim = v.animations[agent.action] || v.animations.idle || {};
    const frames = anim.frames ?? 1;
    const fps = anim.fps ?? 8;
    const row = anim.row ?? 0;
    const frame = Math.floor((Date.now() / (1000 / fps)) % frames);
    ctx.drawImage(
      image,
      frame * v.frameWidth,
      row * v.frameHeight,
      v.frameWidth,
      v.frameHeight,
      -half,
      -half,
      half * 2,
      half * 2
    );
  } else {
    // Single static image (v1). Drawn square, scaled to the agent's size stat.
    ctx.drawImage(image, -half, -half, half * 2, half * 2);
  }
  ctx.restore();
}

/**
 * Minimal sprite cache placeholder. A browser build would `new Image()` + set
 * src; a node-canvas build would `loadImage()`. Left unimplemented for v1 since
 * no species ships art yet — the interface is what matters here.
 */
export class SpriteCache {
  constructor() {
    this._images = new Map();
  }

  get(key) {
    return this._images.get(key) || null;
  }

  set(key, image) {
    this._images.set(key, image);
  }
}
