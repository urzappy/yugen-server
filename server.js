// YugenShadow online server - STEP 181 (fix "sometimes we cannot hit each other": a player who is shot down now REALLY dies on his phone (the server sends a killing "hurt"), a player who rolls or slides cannot be hit (like on his phone), a shooter whose phone is alive can always shoot, a wall right behind or beside the target no longer cancels a hit, the shot may start farther from the last known position (fast dashes), faster shot gap, a little wider hit tube and 5 test moments around the seen time; before: STEP 177 (exact lag compensation: the shot says which time stamp the shooter was looking at; before: STEP 176 (a TEST BOT: a fake player on the server that runs in circles and shoots, for testing alone; set TEST_BOT to false to turn it off; before: STEP 173 (a shot is tested at 3 moments around the rewind time, so a moving target is hit more easily; before: STEP 171 (the up-down aim of every player is sent too; before: STEP 170 every shot is sent to the other players so they can draw the bullet; before: STEP 169 time stamps: every position gets the time it was really taken, so the phones can draw other players smoothly; lag compensation uses the same time; no packages needed)
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;
const TICK_MS = 33; // 30 snapshots per second
// step 162: the hit rules (the server decides, the phones only send "I fired from here in this direction")
const MAX_HP = 100;
const SHOT_DAMAGE = 10;      // hp lost per hit (10 hits to kill)
const HIT_RADIUS = 0.72;     // the invisible tube around a player (blocks) (step 181: a little wider, was 0.65)
const HIT_HEIGHT = 1.8;      // from his feet up
const SHOT_RANGE = 80;       // how far a shot reaches
const SHOT_GAP_MS = 50;      // the fastest the server accepts shots from one player (step 181: was 80)
const INTERP_MS = 100;       // step 169: the default drawing delay of a phone (every phone tells the server its real delay with the "rtt" message)
const MAX_REWIND_MS = 600;   // the most the server goes back in time to check a shot
const HIST_MS = 1500;        // how long the positions of every player are remembered
const SHOT_ORIGIN_MAX = 8;   // a shot must start this close to where the server knows the shooter is (step 181: was 4, a fast dash with a high ping moves farther than that)
const DOWN_MAX_MS = 1500;    // step 181: a player marked "down" whose phone never shows the dead flag is back after this long (was 20 s): his phone ignores hits while he rolls or slides, so it could be alive
const WALL_MARGIN = 0.4;     // step 181: a wall that is only this much nearer than the target does not cancel the hit
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

// step 169: the time of a position. The phone sends its own clock (c, in ms) with every position. Packets on a phone network arrive at uneven times,
// so the server does not trust the arrival time: it works out the clock difference from the FASTEST packets (the lowest value of now - c is the packet
// that was delayed the least) and gives every position the time c + difference. So the time stamps are as even as the phone's own clock.
function stampOf(p, c, now) {
  if (!Number.isFinite(c)) return Math.max(now, p.lastStamp + 1);
  const off = now - c;
  if (p.off === null) p.off = off;
  else p.off = Math.min(p.off + 0.05, off); // goes up very slowly, so a clock that runs a little different cannot get stuck
  let st = Math.round(c + p.off);
  if (st > now) st = now;                   // never in the future
  if (st <= p.lastStamp) st = p.lastStamp + 1;
  return st;
}

// LAG COMPENSATION. Where was player o at the time T (ms, in stamp time)? (from his remembered positions, in between two of them)
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
  // step 181: a shooter whose phone is alive can always shoot (before, a "down" mark on the server could block him although his phone still stood up)
  if (!p.has || (p.down && (p.a & 64) !== 0)) return;
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
  if (Math.hypot(ox - p.x, oz - p.z) > SHOT_ORIGIN_MAX) {
    console.log('shot refused: starts too far from the shooter', p.id);
    return;
  }
  // step 170: tell every OTHER player about this shot, so their phones draw the bullet (only a picture: the hit is decided below)
  for (const o of players.values()) {
    if (o !== p) sendJson(o, { t: 'fx', id: p.id, x: ox, y: oy, z: oz, dx: dx, dy: dy, dz: dz });
  }
  let best = null;
  let bestT = 1e9;
  // the shooter saw the others (his ping + his drawing delay) in the past: test the shot against where they WERE then
  const rewind = Math.max(0, Math.min(MAX_REWIND_MS, p.rtt + p.delay));
  // step 177: the phone says exactly which time stamp it was looking at (w). Without it the guess above is used.
  // step 181: 5 test moments around it (was 3)
  const w = Number(m.w);
  const tList = [];
  if (Number.isFinite(w) && w > 0) {
    for (const d of [0, -40, 40, -80, 80]) tList.push(Math.max(now - MAX_REWIND_MS, Math.min(now, w + d)));
  } else {
    for (const k of [1, 0.7, 1.3]) tList.push(now - Math.min(MAX_REWIND_MS, rewind * k));
  }
  for (const o of players.values()) {
    // step 181: a rolling or sliding player (flag 8) cannot be hurt, the same rule as on his phone (before, the server took his health but his phone did not, and they disagreed who was down)
    if (o === p || o.down || !o.has || (o.a & 8) !== 0) continue;
    // step 173: the rewind time is a guess (the ping jumps around), so the shot is tested at several moments around it and the nearest hit counts
    let t = -1;
    for (const T of tList) {
      const q = posAt(o, T);
      const tt = rayTube(ox, oy, oz, dx, dy, dz, q);
      if (tt >= 0 && (t < 0 || tt < t)) t = tt;
    }
    if (t >= 0 && t < bestT) { bestT = t; best = o; }
  }
  if (!best) return;
  // step 165: a wall in the way: no hit. Step 181: but only when the wall is clearly nearer than the target (a target that stands against a wall can be hit)
  if (rayWalls(ox, oy, oz, dx, dy, dz) < bestT - WALL_MARGIN) {
    console.log('shot refused: a wall is in the way', p.id);
    return;
  }
  best.hp = Math.max(0, best.hp - SHOT_DAMAGE);
  if (best.bot && best.hp <= 0) best.hp = MAX_HP; // step 176: the test bot never goes down
  // step 181: the killing hit tells the phone to die for sure (d = 100 = the whole health), so the server and the phone always agree who is down
  sendJson(best, { t: 'hurt', d: best.hp <= 0 ? 100 : SHOT_DAMAGE, hp: best.hp });
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
    const now = Date.now();
    p.x = num(m.x, -100, 100, p.x);
    p.y = num(m.y, -10, 60, p.y);
    p.z = num(m.z, -100, 100, p.z);
    p.yaw = num(m.yaw, -720, 720, p.yaw);
    p.pitch = num(m.p, -90, 90, p.pitch); // step 171: up-down aim in degrees
    p.a = Math.round(num(m.a, 0, 255, 0));
    p.has = true;
    // step 169: the time of this position (see stampOf) and the memory of where he was (for lag compensation)
    const st = stampOf(p, m.c === undefined ? NaN : Number(m.c), now);
    p.lastStamp = st;
    p.hist.push({ t: st, x: p.x, y: p.y, z: p.z, yaw: p.yaw, a: p.a, pt: p.pitch });
    while (p.hist.length > 0 && now - p.hist[0].t > HIST_MS) p.hist.shift();
    // a shot-down player is back when his phone stops sending the "dead" flag (64) after it had sent it (step 181: or after DOWN_MAX_MS)
    if (p.down) {
      if ((p.a & 64) !== 0) p.sawDead = true;
      else if (p.sawDead || Date.now() - p.downAt > DOWN_MAX_MS) {
        p.down = false;
        p.hp = MAX_HP;
        sendJson(p, { t: 'hp', hp: p.hp });
      }
    }
  } else if (m.t === 'shot') {
    onShot(p, m);
  } else if (m.t === 'p') {
    // ping: the phone sends its clock, the server sends it straight back (the phone works out the round trip time)
    sendJson(p, { t: 'q', c: m.c });
  } else if (m.t === 'rtt') {
    // the phone tells its ping and its drawing delay (both in ms)
    p.rtt = num(m.v, 0, 1000, p.rtt);
    p.delay = num(m.d, 0, 400, p.delay);
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
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, a: 0, lastSeen: Date.now(), sec: 0, count: 0,
    hp: MAX_HP, hist: [], sent: new Map(), rtt: 100, delay: INTERP_MS, off: null, lastStamp: 0,
    down: false, downAt: 0, sawDead: false, lastShot: 0,
  };
  players.set(p.id, p);
  console.log('joined', p.id, 'online', players.size);
  socket.on('data', (d) => { p.buf = Buffer.concat([p.buf, d]); parse(p); });
  socket.on('close', () => drop(p));
  socket.on('error', () => drop(p));
  sendJson(p, { t: 'welcome', id: p.id });
});

// 30 times per second: send every player the positions of the OTHER players.
// step 169: "s" = the time on the server now (ms), and the last number of every player = the time stamp of his position (see stampOf).
// The phone draws every player at (now - its delay) between two stamped positions, so late packets do not make him jump.
// A snapshot can hold several positions of the same player (the ones the phone has not got yet), oldest first.
setInterval(() => {
  if (players.size < 2) return;
  const s = Date.now();
  for (const me of players.values()) {
    if (me.bot) continue; // step 176: the test bot has no phone to send to
    const list = [];
    for (const o of players.values()) {
      if (o === me || !o.has || o.hist.length === 0) continue;
      // every position of o that this phone has not got yet (oldest first, at most 5), so a late packet does not make a hole in his movement.
      // If there is nothing new, the newest one is sent again (the phone ignores it, but it keeps him alive and shows his health).
      const h = o.hist;
      const lastSent = me.sent.get(o.id) || 0;
      let from = h.length;
      while (from > 0 && h[from - 1].t > lastSent && h.length - from < 5) from--;
      if (from === h.length) from = h.length - 1;
      for (let i = from; i < h.length; i++) {
        const e = h[i];
        list.push([o.id, e.x, e.y, e.z, e.yaw, e.a, o.hp, e.t, e.pt]);
      }
      me.sent.set(o.id, h[h.length - 1].t);
    }
    sendJson(me, { t: 'snap', s: s, p: list });
  }
}, TICK_MS);

// step 176: THE TEST BOT. A fake player that lives on the server: it runs in a circle in the middle of the village and fires bursts at the nearest real player
// (its bullets are only drawn, they do not hurt). It sends its positions through the same snapshots as a real phone, so you can test the run animation,
// the aim, the bullets and your own hits alone. Your shots CAN hit it (it never goes down). Set TEST_BOT to false to turn it off.
const TEST_BOT = true;
const BOT_RADIUS = 9;        // the circle (blocks)
const BOT_SPEED = 5;         // blocks per second
function startBot() {
  const stub = { write() {}, destroy() {}, setNoDelay() {} };
  const bot = {
    id: nextId++, socket: stub, buf: Buffer.alloc(0), dead: false, has: true, bot: true,
    x: BOT_RADIUS, y: 0, z: 0, yaw: 0, pitch: 0, a: 0, lastSeen: Date.now(), sec: 0, count: 0,
    hp: MAX_HP, hist: [], sent: new Map(), rtt: 0, delay: 0, off: null, lastStamp: 0,
    down: false, downAt: 0, sawDead: false, lastShot: 0,
  };
  players.set(bot.id, bot);
  console.log('test bot joined', bot.id);
  let ang = 0;
  let nextBurst = Date.now() + 3000;
  let burstUntil = 0;
  let lastFire = 0;
  setInterval(() => {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    bot.lastSeen = now;
    ang += (BOT_SPEED / BOT_RADIUS) * dt;
    const nx = Math.cos(ang) * BOT_RADIUS;
    const nz = Math.sin(ang) * BOT_RADIUS;
    const vx = nx - bot.x;
    const vz = nz - bot.z;
    bot.x = nx;
    bot.z = nz;
    // facing = the way he runs (forward = (sin yaw, -cos yaw))
    bot.yaw = Math.atan2(vx, -vz) * 180 / Math.PI;
    // the nearest real player
    let target = null;
    let td = 1e9;
    for (const o of players.values()) {
      if (o.bot || !o.has || o.down) continue;
      const d = Math.hypot(o.x - bot.x, o.z - bot.z);
      if (d < td) { td = d; target = o; }
    }
    let firing = false;
    if (now >= nextBurst) { burstUntil = now + 1000; nextBurst = now + 4000; }
    if (target && now < burstUntil) {
      firing = true;
      const ox = bot.x, oy = bot.y + 1.3, oz = bot.z;
      let dx = target.x - ox + (Math.random() - 0.5) * 1.0;
      let dy = target.y + 1.0 - oy;
      let dz = target.z - oz + (Math.random() - 0.5) * 1.0;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      bot.yaw = Math.atan2(dx, -dz) * 180 / Math.PI;
      bot.pitch = Math.asin(dy) * 180 / Math.PI;
      if (now - lastFire >= 125) {
        lastFire = now;
        for (const o of players.values()) {
          if (!o.bot) sendJson(o, { t: 'fx', id: bot.id, x: ox, y: oy, z: oz, dx: dx, dy: dy, dz: dz });
        }
      }
    } else {
      bot.pitch = 0;
    }
    bot.a = (firing ? 1 : 0);
    bot.lastStamp = Math.max(now, bot.lastStamp + 1);
    bot.hist.push({ t: bot.lastStamp, x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw, a: bot.a, pt: bot.pitch });
    while (bot.hist.length > 0 && now - bot.hist[0].t > HIST_MS) bot.hist.shift();
  }, TICK_MS);
}
if (TEST_BOT) startBot();

// every 20 s: ping everybody, drop players silent for 45 s
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (now - p.lastSeen > 45000) { drop(p); continue; }
    try { p.socket.write(frame(9, Buffer.alloc(0))); } catch (e) { drop(p); }
  }
}, 20000);

server.listen(PORT, () => console.log('YugenShadow server on port ' + PORT));
