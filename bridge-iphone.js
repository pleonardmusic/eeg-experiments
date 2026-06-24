// Bridges the MindWaveBridge iOS app to the browser.
// The iPhone connects OUT to this script (port 8767) and streams every
// parsed TGAM packet — including raw 512Hz samples — as soon as it arrives.
// We re-broadcast the same messages to the browser on port 8765, which
// index.html already expects (same shape TGC itself produces).
//
// Usage: node bridge-iphone.js
// Then open the MindWaveBridge app, enter this Mac's IP, and tap Connect.

const os = require('os');
const { WebSocketServer } = require('ws');

const INGEST_PORT    = 8767;
const BROADCAST_PORT = 8765;

const ingest    = new WebSocketServer({ port: INGEST_PORT });
const broadcast = new WebSocketServer({ port: BROADCAST_PORT });

let latestPacket = null;

function localIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '?.?.?.?';
}

console.log(`[bridge] Waiting for iPhone on ws://${localIP()}:${INGEST_PORT}`);
console.log(`[bridge] Browser should connect to ws://localhost:${BROADCAST_PORT}`);

ingest.on('connection', (ws) => {
  console.log('[bridge] iPhone connected');
  ws.on('message', (msg) => {
    const text = msg.toString();
    latestPacket = text;
    for (const client of broadcast.clients) {
      if (client.readyState === 1) client.send(text);
    }
  });
  ws.on('close', () => console.log('[bridge] iPhone disconnected'));
});

broadcast.on('connection', (ws) => {
  console.log('[bridge] Browser connected');
  if (latestPacket) ws.send(latestPacket);
});
