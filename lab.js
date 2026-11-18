// 小实验合集：打小人 / 一起养树 / 下班倒计时
// 一个 WebSocket（/lab-ws?room=xiaoren|tree|offwork）负责全站计数；同时统计每个页面的访问量。
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';

const PAGES = { '/xiaoren': 'xiaoren.html', '/tree': 'tree.html', '/offwork': 'offwork.html', '/hall': 'hall.html' };
const ROOMS = ['xiaoren', 'tree', 'offwork'];
const pageCache = {};
const gzCache = {};
for (const f of Object.values(PAGES)) { pageCache[f] = fs.readFileSync(new URL('./public/lab/' + f, import.meta.url)); gzCache[f] = zlib.gzipSync(pageCache[f], { level: 9 }); }

// ---------- 数据（存到 data/lab.json；Render 免费版重新部署后会清零） ----------
const DATA_DIR = new URL('./data/', import.meta.url);
const DATA = new URL('./data/lab.json', import.meta.url);
let db = { hits: 0, water: 0, held: 0, days: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
let dirtyData = false;

// 统一按东八区算“今天”
const dayKey = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
function today() {
  const k = dayKey();
  if (!db.days[k]) {
    db.days[k] = { hits: 0, water: 0, held: 0, pv: {}, uv: {} };
    const keys = Object.keys(db.days).sort();
    while (keys.length > 14) delete db.days[keys.shift()]; // 只留 14 天
  }
  return db.days[k];
}
function save() {
  if (!dirtyData) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(db)); dirtyData = false; } catch {}
}
setInterval(save, 15000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { save(); process.exit(0); });

// ---------- 访问统计 ----------
const uvSeen = new Map(); // `${day}|${path}` -> Set(hash)
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
export function trackView(path, req) {
  if (/bot|spider|crawl|uptime|curl|python|github/i.test(req.headers['user-agent'] || '')) return; // 保活和爬虫不算
  const d = today(), k = dayKey() + '|' + path;
  d.pv[path] = (d.pv[path] || 0) + 1;
  const h = crypto.createHash('sha1').update(ipOf(req) + (req.headers['user-agent'] || '')).digest('hex').slice(0, 12);
  let s = uvSeen.get(k); if (!s) uvSeen.set(k, s = new Set());
  if (!s.has(h)) { s.add(h); d.uv[path] = (d.uv[path] || 0) + 1; }
  dirtyData = true;
}

// ---------- 页面 ----------
export function labHttp(req, res, url) {
  const f = PAGES[url];
  if (!f) return false;
  trackView(url, req);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('content-encoding', 'gzip'); res.end(gzCache[f]); }
  else res.end(pageCache[f]);
  return true;
}

// ---------- 实时计数 ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 });
const rooms = Object.fromEntries(ROOMS.map(r => [r, new Set()]));
const heldIps = new Set();
const PER_IP = 8;
const nClamp = v => (typeof v === 'number' && isFinite(v) ? Math.max(1, Math.min(5, Math.floor(v))) : 1);

export function labUpgrade(req, socket, head) {
  const [path] = (req.url || '').split('?');
  if (path !== '/lab-ws') return false;
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  return true;
}

wss.on('connection', (ws, req) => {
  const room = new URL(req.url, 'http://x').searchParams.get('room');
  const ip = ipOf(req);
  if (!rooms[room] || [...ROOMS.flatMap(r => [...rooms[r]])].filter(c => c.ip === ip).length >= PER_IP) { ws.close(1008); return; }
  const c = { ws, ip, room, tokens: 12, last: Date.now(), own: 0, alive: true, changed: true };
  rooms[room].add(c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    c.tokens = Math.min(12, c.tokens + (now - c.last) / 1000 * 10); c.last = now; // 每秒最多 10 次
    const d = today();
    if (room === 'xiaoren' && m.t === 'hit') {
      const n = Math.min(nClamp(m.n), Math.floor(c.tokens)); if (n < 1) return;
      c.tokens -= n; db.hits += n; d.hits += n; dirtyData = true;
    } else if (room === 'tree' && m.t === 'water') {
      const n = Math.min(nClamp(m.n), Math.floor(c.tokens)); if (n < 1) return;
      c.tokens -= n; c.own += n; db.water += n; d.water += n; pendingWater += n; dirtyData = true;
    } else if (room === 'offwork' && m.t === 'held') {
      const k = ip + '|' + dayKey(); if (heldIps.has(k)) return;
      heldIps.add(k); db.held++; d.held++; dirtyData = true;
    }
  });
  ws.on('close', () => rooms[room].delete(c));
  ws.on('error', () => {});
});

let pendingWater = 0;
setInterval(() => {
  const d = today();
  const water = pendingWater; pendingWater = 0;
  for (const room of ROOMS) {
    const set = rooms[room];
    if (!set.size) continue;
    const base = { t: 's', on: set.size };
    if (room === 'xiaoren') Object.assign(base, { total: db.hits, today: d.hits });
    if (room === 'tree') Object.assign(base, { total: db.water, today: d.water });
    if (room === 'offwork') Object.assign(base, { total: db.held, today: d.held });
    for (const c of set) {
      if (c.ws.readyState !== 1) continue;
      const m = room === 'tree' ? { ...base, d: Math.max(0, water - c.own) } : base; // 树：别人浇的水，用来在你屏幕上掉水滴
      c.own = 0;
      c.ws.send(JSON.stringify(m));
    }
  }
}, 700);

setInterval(() => {
  for (const room of ROOMS) for (const c of rooms[room]) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; try { c.ws.ping(); } catch {}
  }
}, 30000);

export function labStats() {
  const d = today();
  return {
    online: Object.fromEntries(ROOMS.map(r => [r, rooms[r].size])),
    total: { hits: db.hits, water: db.water, held: db.held },
    today: d,
    days: db.days,
  };
}
