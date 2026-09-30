const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 8080;

// v2 recorder saves sessions here (one subfolder per session).
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

// Only allow simple names so a request can't write outside RECORDINGS_DIR.
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

function readBody(req, cb) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks)));
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// --- v2 recorder API (v1 index.html never calls these) ---
// POST /api/v2/append?session=S&file=F  -> append body to recordings/S/F
// POST /api/v2/write?session=S&file=F   -> overwrite recordings/S/F with body
// POST /api/v2/reveal?session=S         -> open the session folder in Finder
function handleApi(req, res, url) {
  const session = url.searchParams.get('session') || '';
  const file = url.searchParams.get('file') || '';
  if (!SAFE_NAME.test(session)) return sendJSON(res, 400, { error: 'bad session name' });
  const dir = path.join(RECORDINGS_DIR, session);

  if (url.pathname === '/api/v2/reveal') {
    fs.mkdirSync(dir, { recursive: true });
    execFile('open', [dir]);
    return sendJSON(res, 200, { ok: true, dir });
  }

  if (!SAFE_NAME.test(file)) return sendJSON(res, 400, { error: 'bad file name' });
  const target = path.join(dir, file);
  readBody(req, (body) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (url.pathname === '/api/v2/append') fs.appendFileSync(target, body);
      else if (url.pathname === '/api/v2/write') fs.writeFileSync(target, body);
      else return sendJSON(res, 404, { error: 'unknown endpoint' });
      sendJSON(res, 200, { ok: true, bytes: body.length, dir });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'POST' && url.pathname.startsWith('/api/v2/')) return handleApi(req, res, url);

  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(__dirname, reqPath);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`EEG app running at http://localhost:${PORT}`);
  console.log(`v2 recorder: http://localhost:${PORT}/recorder-v2.html`);
});
