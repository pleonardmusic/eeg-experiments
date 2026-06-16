const net = require('net');
const { WebSocketServer } = require('ws');

const TGC_HOST = '127.0.0.1';
const TGC_PORT = 13854;
const WS_PORT  = 8765;

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);

let latestPacket = null;

function pollTGC() {
  const sock = new net.Socket();
  let buf = '';

  sock.setTimeout(2000);

  sock.connect(TGC_PORT, TGC_HOST, () => {
    sock.write(JSON.stringify({ enableRawOutput: false, format: 'Json' }) + '\n');
  });

  sock.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\r');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        latestPacket = trimmed;
        broadcast(trimmed);
      } catch (_) {}
    }
  });

  sock.on('close', () => {});
  sock.on('error', () => {});
  sock.on('timeout', () => sock.destroy());
}

function broadcast(msg) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  console.log('[bridge] Browser connected');
  if (latestPacket) ws.send(latestPacket);
  ws.on('close', () => console.log('[bridge] Browser disconnected'));
});

// Poll TGC every second
setInterval(pollTGC, 1000);
pollTGC();
