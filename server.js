// 一起睡 · 多人同步服务器（Node.js + ws）
import http from 'node:http';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const MAX = +(process.env.MAX_PLAYERS || 24); // 同时在线上限（20 张床 + 几个走动的人）
const BEDS = 20, CHAT_MAX = 30, CHAT_GAP = 3000, PER_IP = +(process.env.PER_IP || 4);
const BAD = ['傻逼', '操你', 'fuck', 'shit', 'nigger', 'cnm', 'sb'];
const LINK = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|cn|io|xyz|top|me|co|cc|ly|gg)\b|t\.me|discord)/i;

const html = fs.readFileSync(new URL('./public/index.html', import.meta.url));
const gz = zlib.gzipSync(html, { level: 9 });
const started = Date.now();
let peak = 0, visits = 0;

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.end('ok'); return; }
  if (url === '/promo.mp4') {
    const f = new URL('./public/promo.mp4', import.meta.url);
    try { const b = fs.readFileSync(f); res.setHeader('content-type', 'video/mp4'); res.setHeader('access-control-allow-origin', '*'); res.setHeader('content-length', b.length); res.end(b); }
    catch { res.statusCode = 404; res.end('no'); }
    return;
  }
  if (url === '/status') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify({ online: clients.size, max: MAX, sleeping: [...clients.values()].filter(c => c.p.b >= 0).length, peak, visits, upMin: Math.round((Date.now() - started) / 6e4) }));
    return;
  }
  if (url !== '/' && url !== '/index.html') { res.statusCode = 404; res.end('not found'); return; }
  visits++;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=300');
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('content-encoding', 'gzip'); res.end(gz); }
  else res.end(html);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const clients = new Map(); // ws -> {id, ip, p, lastChat}
const dirty = new Set(), left = new Set();
let nextId = 1;

const num = (v, a, b, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(b, v)) : d);
const str = (v, n) => Array.from(String(v ?? '').replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202e\ufeff]/g, '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const bedOwner = b => { for (const c of clients.values()) if (c.p.b === b) return c; return null; };

function clean(c, patch) {
  const p = c.p, out = {};
  if ('n' in patch) out.n = str(patch.n, 8) || '小梦';
  if ('h' in patch) out.h = num(patch.h, 0, 1);
  if ('x' in patch) out.x = num(patch.x, -60, 60);
  if ('z' in patch) out.z = num(patch.z, -60, 60);
  if ('s' in patch) out.s = Math.floor(num(patch.s, 0, 1e9));
  if ('j' in patch) out.j = Math.floor(num(patch.j, 0, 5));
  if ('c' in patch) out.c = patch.c ? 1 : 0;
  if ('k' in patch) out.k = patch.k ? 1 : 0;
  if ('m' in patch && 'mt' in patch) { out.m = str(patch.m, 4); out.mt = Date.now(); }
  if ('b' in patch) {
    let b = Math.floor(num(patch.b, -1, BEDS - 1, -1));
    if (b >= 0) { const o = bedOwner(b); if (o && o !== c) { b = -1; send(c.ws, { t: 'deny', what: 'bed' }); } }
    out.b = b;
  }
  if ('cm' in patch) {
    let t = str(patch.cm, CHAT_MAX);
    const now = Date.now();
    if (!t) {} else if (LINK.test(t)) send(c.ws, { t: 'deny', what: 'chat', msg: '不能发送链接' });
    else if (now - c.lastChat < CHAT_GAP) send(c.ws, { t: 'deny', what: 'chat', msg: '说慢一点' });
    else { for (const w of BAD) t = t.split(w).join('*'.repeat(Array.from(w).length)); out.cm = t; out.ct = now; c.lastChat = now; }
  }
  Object.assign(p, out);
  if (Object.keys(out).length) dirty.add(c.id);
}

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  if (clients.size >= MAX) { send(ws, { t: 'full', n: clients.size }); ws.close(1013, 'full'); return; }
  if ([...clients.values()].filter(c => c.ip === ip).length >= PER_IP) { send(ws, { t: 'full', n: clients.size }); ws.close(1013, 'ip'); return; }
  const c = { id: 'p' + (nextId++).toString(36), ip, ws, p: { b: -1 }, lastChat: 0, alive: true };
  clients.set(ws, c);
  peak = Math.max(peak, clients.size);
  send(ws, { t: 'hi', id: c.id, peers: [...clients.values()].map(o => [o.id, o.p]) });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m && m.t === 'p' && m.p && typeof m.p === 'object') clean(c, m.p);
  });
  ws.on('close', () => { clients.delete(ws); dirty.delete(c.id); left.add(c.id); });
});

// 每 100ms 合并广播一次变化
setInterval(() => {
  if (!dirty.size && !left.size) return;
  const byId = new Map([...clients.values()].map(c => [c.id, c]));
  const u = [...dirty].filter(id => byId.has(id)).map(id => [id, byId.get(id).p]);
  const msg = JSON.stringify({ t: 'up', u, l: [...left] });
  dirty.clear(); left.clear();
  for (const ws of clients.keys()) if (ws.readyState === 1) ws.send(msg);
}, 100);

// 心跳：清理掉线的连接
setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) { ws.terminate(); continue; }
    c.alive = false; try { ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => console.log('一起睡 running on :' + PORT));
