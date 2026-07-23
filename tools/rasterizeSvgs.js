// SVG -> PNG rasterizer (dev/build tool — NOT part of the runtime).
//
// Authoring sprites as SVG keeps them crisp and editable, but the renderer (and
// the future headless node-canvas video path) loads PNGs. This tool bridges the
// two with zero native image dependencies: it serves the SVG sources plus a tiny
// page that draws each into a 128x128 canvas and POSTs the PNG bytes back, which
// this server writes to /public/assets/sprites/<id>.png (the exact paths/format
// the app already consumes).
//
//   node tools/rasterizeSvgs.js      # then open the printed URL (or it's driven headlessly)
//
// Edit the SVGs in public/assets/sprites/src/ and re-run to regenerate.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'assets', 'sprites', 'src');
const OUT = path.join(ROOT, 'public', 'assets', 'sprites');
const PORT = process.env.PORT || 3141;
const SIZE = 128;

const ids = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>rasterizing…</title>
<style>body{background:#181410;color:#e6e0d6;font:14px system-ui;padding:20px}
img{width:128px;height:128px;background:#2a241d;border:1px solid #443;margin:6px;vertical-align:middle}
.row{display:flex;align-items:center;gap:10px}</style></head>
<body><h3>SVG → PNG (${SIZE}×${SIZE})</h3><div id="out">working…</div>
<script>
const ids = ${JSON.stringify(ids)};
const SIZE = ${SIZE};
async function raster(id){
  const img = new Image();
  await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('load '+id));img.src='/src/'+id+'.svg';});
  const c = document.createElement('canvas'); c.width=SIZE; c.height=SIZE;
  const ctx = c.getContext('2d'); ctx.clearRect(0,0,SIZE,SIZE); ctx.drawImage(img,0,0,SIZE,SIZE);
  const url = c.toDataURL('image/png');
  await fetch('/save?id='+encodeURIComponent(id), {method:'POST', body:url});
  const row=document.createElement('div'); row.className='row';
  const im=document.createElement('img'); im.src=url;
  row.appendChild(im); row.appendChild(document.createTextNode(id+'.png saved'));
  return row;
}
(async ()=>{
  const out=document.getElementById('out'); out.textContent='';
  for(const id of ids){ try{ out.appendChild(await raster(id)); }catch(e){ console.error(e); } }
  document.title = 'DONE '+ids.length;
})();
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && u.pathname === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end(PAGE);
  }

  if (req.method === 'GET' && u.pathname.startsWith('/src/')) {
    const file = path.join(SRC, path.basename(u.pathname));
    if (fs.existsSync(file)) {
      res.setHeader('content-type', 'image/svg+xml');
      return res.end(fs.readFileSync(file));
    }
    res.statusCode = 404;
    return res.end('not found');
  }

  if (req.method === 'POST' && u.pathname === '/save') {
    const id = u.searchParams.get('id');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      const file = path.join(OUT, `${id}.png`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      console.log(`wrote ${path.relative(ROOT, file)} (${fs.statSync(file).size} bytes)`);
      res.end('ok');
    });
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n  SVG rasterizer → http://localhost:${PORT}   (ids: ${ids.join(', ')})`);
  console.log('  Open it in a browser to (re)generate the PNGs, then Ctrl+C.\n');
});
