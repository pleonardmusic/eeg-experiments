// Fallback bridge: persistent TCP connection to TGC → WebSocket for browser
// Use this only if TGC's native WebSocket (port 13854) doesn't work from the browser.
// Run: node bridge.js
// Then open index.html — it auto-falls back to ws://localhost:8765

const net = require('net');
const { WebSocketServer } = require('ws');

const TGC_HOST = '127.0.0.1';
const TGC_PORT = 13854;
const WS_PORT  = 8765;

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[bridge] WebSocket on ws://localhost:${WS_PORT}`);

let latestPacket = null;

function broadcast(msg) {
  latestPacket = msg;
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  console.log('[bridge] Browser connected');
  if (latestPacket) ws.send(latestPacket);
  ws.on('close', () => console.log('[bridge] Browser disconnected'));
});

// Keep one persistent TCP connection to TGC open and stream all data
function connectToTGC() {
  console.log(`[bridge] Connecting to TGC on ${TGC_HOST}:${TGC_PORT}…`);
  const sock = new net.Socket();
  let buf = '';
  let connected = false;

  sock.connect(TGC_PORT, TGC_HOST, () => {
    connected = true;
    console.log('[bridge] TGC connected — streaming');
    sock.write(JSON.stringify({ enableRawOutput: false, format: 'Json' }) + '\n');
  });

  sock.on('data', (chunk) => {
    buf += chunk.toString();
    // TGC terminates packets with \r\n or just \r
    const lines = buf.split(/\r\n?|\n/);
    buf = lines.pop(); // keep incomplete last chunk
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        JSON.parse(trimmed);
        broadcast(trimmed);
      } catch (_) {}
    }
  });

  const reconnect = () => {
    if (connected) console.log('[bridge] TGC disconnected — reconnecting in 2s');
    else console.log('[bridge] TGC not available — retrying in 2s');
    connected = false;
    setTimeout(connectToTGC, 2000);
  };

  sock.on('close', reconnect);
  sock.on('error', (err) => {
    if (err.code !== 'ECONNREFUSED') console.log('[bridge] TGC error:', err.message);
    sock.destroy();
  });
}

connectToTGC();
