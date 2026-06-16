const { SerialPort } = require('serialport');

const PORT_PATH = '/dev/cu.MindWaveMobile';

console.log('Opening serial port:', PORT_PATH);
console.log('Make sure TGC is CLOSED and headset is on your forehead.\n');

const port = new SerialPort({
  path: PORT_PATH,
  baudRate: 57600,
  autoOpen: false,
});

port.open((err) => {
  if (err) {
    console.log('FAILED to open port:', err.message);
    process.exit(1);
  }
  console.log('Port opened! Listening for data (10 sec)...\n');
});

port.on('data', (data) => {
  console.log('RAW HEX:', data.toString('hex'));
  console.log('Bytes:   ', [...data].map(b => b.toString(16).padStart(2,'0')).join(' '));
  console.log('---');
});

port.on('error', (err) => {
  console.log('ERROR:', err.message);
});

setTimeout(() => {
  console.log('Done.');
  port.close();
  process.exit(0);
}, 10000);
