// YugenShadow online server - STEP 122 (positions only, no packages needed)
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;
const TICK_MS = 50; // 20 snapshots per second
const players = new Map();
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('YugenShadow server OK. Players online: ' + players.size + '\n');
});

function frame(op, payload) {
  const len = payload.length;
  let h;
  if (len < 126) {
    h = Buffer.from([0x80 | op, len]);
  } else if (len < 65536) {
    h = Buffer.alloc(4);
    h[0] = 0x80 | op;
    h[1] = 126;
    h.writeUInt16BE(len, 2);
  } else {
    h = Buffer.alloc(10);
    h[0] = 0x80 | op;
    h[1] = 127;
    h.writeUInt32BE(0, 2);
    h.writeUInt32BE(len, 6);
  }
  return Buffer.concat([h, payload]);
}

function sendJson(p, obj) {
  if (p.dead) return;
  try {
    p.socket.write(frame(1, Buffer.from(JSON.stringify(obj))));
  } catch (e) {
    drop(p);
  }
}

function drop(p) {
  if (p.dead) return;
  p.dead = true;
  players.delete(p.id);
  try { p.socket.destroy(); } catch (e) {}
  console.log('left', p.id, 'online', players.size);
}

function num(v, lo, hi, d) {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, v));
}

function onText(p, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'pos') {
    p.x = num(m.x, -100, 100, p.x);
    p.y = num(m.y, -10, 60, p.y);
    p.z = num(m.z, -100, 100, p.z);
    p.yaw = num(m.yaw, -720, 720, p.yaw);
    p.a = Math.round(num(m.a, 0, 255, 0));
    p.has = true;
  }
}

function parse(p) {
  for (;;) {
    const b = p.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      if (b.readUInt32BE(2) !== 0) return drop(p);
      len = b.readUInt32BE(6);
      off = 10;
    }
    if (!masked || len > 65536) return drop(p);
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4);
    const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    p.buf = b.subarray(off + 4 + len);
    p.lastSeen = Date.now();
    if (op === 8) return drop(p);
    if (op === 9) { p.socket.write(frame(10, data)); continue; }
    if (op === 10) continue;
    if (!fin || op !== 1) return drop(p); // only whole text messages
    // simple flood guard: 100 messages per second
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== p.sec) { p.sec = sec; p.count = 0; }
    if (++p.count > 100) continue;
    onText(p, data.toString('utf8'));
    if (p.dead) return;
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || players.size >= MAX_PLAYERS) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  const p = {
    id: nextId++, socket, buf: Buffer.alloc(0), dead: false, has: false,
    x: 0, y: 0, z: 0, yaw: 0, a: 0, lastSeen: Date.now(), sec: 0, count: 0,
  };
  players.set(p.id, p);
  console.log('joined', p.id, 'online', players.size);
  socket.on('data', (d) => { p.buf = Buffer.concat([p.buf, d]); parse(p); });
  socket.on('close', () => drop(p));
  socket.on('error', () => drop(p));
  sendJson(p, { t: 'welcome', id: p.id });
});

// 20 times per second: send every player the positions of the OTHER players
setInterval(() => {
  if (players.size < 2) return;
  for (const me of players.values()) {
    const list = [];
    for (const o of players.values()) {
      if (o !== me && o.has) list.push([o.id, o.x, o.y, o.z, o.yaw, o.a]);
    }
    sendJson(me, { t: 'snap', p: list });
  }
}, TICK_MS);

// every 20 s: ping everybody, drop players silent for 45 s
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (now - p.lastSeen > 45000) { drop(p); continue; }
    try { p.socket.write(frame(9, Buffer.alloc(0))); } catch (e) { drop(p); }
  }
}, 20000);

server.listen(PORT, () => console.log('YugenShadow server on port ' + PORT));
