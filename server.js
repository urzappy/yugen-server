// YugenShadow online server - STEP 168 (lag compensation: shots are checked where the players were when the shooter saw them; 30 snapshots per second; no packages needed)
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;
const TICK_MS = 33; // step 168: 30 snapshots per second
// step 162: the hit rules (the server decides, the phones only send "I fired from here in this direction")
const MAX_HP = 100;
const SHOT_DAMAGE = 10;      // hp lost per hit (10 hits to kill)
const HIT_RADIUS = 0.65;     // the invisible tube around a player (blocks)
const HIT_HEIGHT = 1.8;      // from his feet up
const SHOT_RANGE = 80;       // how far a shot reaches
const SHOT_GAP_MS = 80;      // the fastest the server accepts shots from one player
const INTERP_MS = 90;        // step 168: how far in the past the phones draw the other players (must match INTERP_DELAY in Online.kt)
const MAX_REWIND_MS = 500;   // step 168: the most the server goes back in time to check a shot
const HIST_MS = 1200;        // step 168: how long the positions of every player are remembered
const SHOT_ORIGIN_MAX = 4;   // a shot must start this close to where the server knows the shooter is
// step 165: the SOLID boxes of the village (x, y, z = middle, then the sizes): copied from VillageMap.kt (houses, temple, pagoda base, stalls, tree trunks, the map wall)
const WALLS = [[-23.0, 2.5, -38.5, 8.0, 5.0, 9.0], [-12.0, 2.4, -39.0, 8.0, 4.8, 10.0], [12.0, 2.5, -38.5, 8.0, 5.0, 9.0], [23.0, 2.4, -39.5, 8.0, 4.8, 11.0], [-23.0, 2.8, 39.0, 8.0, 5.6, 10.0], [-12.0, 3.1, 38.5, 8.0, 6.2, 9.0], [12.0, 2.8, 39.5, 8.0, 5.6, 11.0], [23.0, 3.1, 38.5, 8.0, 6.2, 9.0], [-38.5, 2.4, -23.0, 9.0, 4.8, 8.0], [-39.5, 2.5, -12.0, 11.0, 5.0, 8.0], [-38.5, 2.4, 12.0, 9.0, 4.8, 8.0], [-39.0, 2.5, 23.0, 10.0, 5.0, 8.0], [39.5, 3.1, -23.0, 11.0, 6.2, 8.0], [38.5, 2.8, -12.0, 9.0, 5.6, 8.0], [39.0, 3.1, 12.0, 10.0, 6.2, 8.0], [38.5, 2.8, 23.0, 9.0, 5.6, 8.0], [0.0, 3.5, -57.0, 22.0, 7.0, 14.0], [-24.0, 1.68, -56.0, 4.34, 3.36, 4.34], [-13.5, 0.5, -31.9, 3.0, 1.0, 1.4], [13.5, 0.5, -31.9, 3.0, 1.0, 1.4], [-13.5, 0.5, 31.9, 3.0, 1.0, 1.4], [13.5, 0.5, 31.9, 3.0, 1.0, 1.4], [-8.5, 1.1, -32.0, 0.5, 2.2, 0.5], [-8.5, 1.1, 32.0, 0.5, 2.2, 0.5], [-32.0, 1.1, -8.5, 0.5, 2.2, 0.5], [32.0, 1.1, -8.5, 0.5, 2.2, 0.5], [8.5, 1.1, -32.0, 0.5, 2.2, 0.5], [8.5, 1.1, 32.0, 0.5, 2.2, 0.5], [-32.0, 1.1, 8.5, 0.5, 2.2, 0.5], [32.0, 1.1, 8.5, 0.5, 2.2, 0.5], [-35.0, 1.1, -35.0, 0.5, 2.2, 0.5], [-35.0, 1.1, 35.0, 0.5, 2.2, 0.5], [35.0, 1.1, 35.0, 0.5, 2.2, 0.5], [0.0, 1.5, -72.0, 146.0, 3.0, 1.2], [0.0, 1.5, 72.0, 146.0, 3.0, 1.2], [-72.0, 1.5, 0.0, 1.2, 3.0, 146.0], [72.0, 1.5, 0.0, 1.2, 3.0, 146.0]];
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

// step 168: LAG COMPENSATION. Where was player o at the time T (ms)? (from his remembered positions, in between two of them)
function posAt(o, T) {
  const h = o.hist;
  if (h.length === 0) return { x: o.x, y: o.y, z: o.z };
  if (T <= h[0].t) return h[0];
  const last = h[h.length - 1];
  if (T >= last.t) return last;
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1].t <= T) {
      const a = h[i - 1], b = h[i];
      const f = (T - a.t) / Math.max(1, b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  return h[0];
}

// step 162: does the ray from (ox,oy,oz) along (dx,dy,dz) (length 1) hit the tube of player o? returns the distance or -1
function rayTube(ox, oy, oz, dx, dy, dz, o) {
  const a = dx * dx + dz * dz;
  if (a < 1e-6) return -1;
  const fx = ox - o.x;
  const fz = oz - o.z;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - HIT_RADIUS * HIT_RADIUS;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = Math.max(0, (-b - sq) / (2 * a));
  const t2 = (-b + sq) / (2 * a);
  if (t2 < 0) return -1;
  for (const t of [t1, t2]) {
    if (t > SHOT_RANGE) continue;
    const y = oy + dy * t;
    if (y >= o.y && y <= o.y + HIT_HEIGHT) return t;
  }
  return -1;
}

// step 165: where does the ray first enter a wall box? returns the distance, or 1e9 if it hits none (a ray that starts inside a box ignores that box, like the phone does)
function rayWalls(ox, oy, oz, dx, dy, dz) {
  let best = 1e9;
  for (const w of WALLS) {
    let tmin = -1e9, tmax = 1e9;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      const lo = w[i] - w[i + 3] / 2, hi = w[i] + w[i + 3] / 2;
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < lo || o[i] > hi) { ok = false; break; }
      } else {
        let t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
      }
    }
    if (ok && tmin <= tmax && tmin > 0.0001 && tmin < best) best = tmin;
  }
  return best;
}

function onShot(p, m) {
  if (p.down || !p.has) return;
  const now = Date.now();
  if (now - p.lastShot < SHOT_GAP_MS) return;
  p.lastShot = now;
  const ox = num(m.x, -200, 200, NaN);
  const oy = num(m.y, -20, 80, NaN);
  const oz = num(m.z, -200, 200, NaN);
  let dx = num(m.dx, -1, 1, NaN);
  let dy = num(m.dy, -1, 1, NaN);
  let dz = num(m.dz, -1, 1, NaN);
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl < 0.001) return;
  dx /= dl; dy /= dl; dz /= dl;
  // the shot must start near where the server knows the shooter is
  if (Math.hypot(ox - p.x, oz - p.z) > SHOT_ORIGIN_MAX) return;
  let best = null;
  let bestT = 1e9;
  // step 168: the shooter saw the others about (his ping + the phone delay) in the past: test the shot against where they WERE then
  const rewind = Math.max(0, Math.min(MAX_REWIND_MS, p.rtt + INTERP_MS));
  for (const o of players.values()) {
    if (o === p || o.down || !o.has) continue;
    const q = posAt(o, now - rewind);
    const t = rayTube(ox, oy, oz, dx, dy, dz, q);
    if (t >= 0 && t < bestT) { bestT = t; best = o; }
  }
  if (!best) return;
  // step 165: a wall in the way: no hit
  if (rayWalls(ox, oy, oz, dx, dy, dz) < bestT) return;
  best.hp = Math.max(0, best.hp - SHOT_DAMAGE);
  sendJson(best, { t: 'hurt', d: SHOT_DAMAGE, hp: best.hp });
  sendJson(p, { t: 'hitok', id: best.id, hp: best.hp });
  if (best.hp <= 0) {
    best.down = true;
    best.downAt = now;
    best.sawDead = false;
    console.log('player', best.id, 'was shot down by', p.id);
  }
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
    // step 168: remember where he is (for lag compensation)
    const nowH = Date.now();
    p.hist.push({ t: nowH, x: p.x, y: p.y, z: p.z });
    while (p.hist.length > 0 && nowH - p.hist[0].t > HIST_MS) p.hist.shift();
    // a shot-down player is back when his phone stops sending the "dead" flag (64) after it had sent it (or after 20 s)
    if (p.down) {
      if ((p.a & 64) !== 0) p.sawDead = true;
      else if (p.sawDead || Date.now() - p.downAt > 20000) {
        p.down = false;
        p.hp = MAX_HP;
        sendJson(p, { t: 'hp', hp: p.hp });
      }
    }
  } else if (m.t === 'shot') {
    onShot(p, m);
  } else if (m.t === 'p') {
    // step 168: ping: the phone sends its clock, the server sends it straight back (the phone works out the round trip time)
    sendJson(p, { t: 'q', c: m.c });
  } else if (m.t === 'rtt') {
    p.rtt = num(m.v, 0, 1000, p.rtt);
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
    hp: MAX_HP, hist: [], rtt: 100, down: false, downAt: 0, sawDead: false, lastShot: 0,
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
      if (o !== me && o.has) list.push([o.id, o.x, o.y, o.z, o.yaw, o.a, o.hp]);
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
