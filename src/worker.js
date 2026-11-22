// Ending Credits Worker: static site + YouTube lookup for the reveal + multiplayer rooms (Durable Object).
import data from '../public/data/songs.json';
import { isCorrect } from '../public/js/match.js';
import { filterSongs, pickRamp, rng } from '../public/js/pools.js';

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...extra } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/yt') return yt((url.searchParams.get('q') || '').slice(0, 200), ctx);
    if (url.pathname === '/api/room/new') {
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => A[b % A.length]).join('');
      return json({ code });
    }
    const m = url.pathname.match(/^\/api\/room\/([A-Z]{4})\/ws$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

// ---------- YouTube: find the opening's video for the reveal ----------
async function yt(q, ctx) {
  if (!q) return json({ error: 'missing q' }, 400);
  const cache = caches.default;
  const key = new Request('https://cache.endingcredits/yt?q=' + encodeURIComponent(q.toLowerCase()));
  const hit = await cache.match(key);
  if (hit) return hit;
  let d;
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        origin: 'https://www.youtube.com',
        'x-youtube-client-name': '1',
        'x-youtube-client-version': '2.20251110.01.00',
      },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20251110.01.00', hl: 'en', gl: 'US' } }, query: q }),
    });
    if (!r.ok) return json({ error: 'search ' + r.status }, 502);
    d = await r.json();
  } catch {
    return json({ error: 'search failed' }, 502);
  }
  const vids = [];
  walk(d, vids);
  const good = /creditless|textless|\bnc ?(op|ed)\b|\bopening\b|\bending\b|\bop ?\d*\b|\bed ?\d*\b/i;
  const v = vids.find((x) => good.test(x.title)) || vids[0];
  const res = json(v ? { id: v.id, title: v.title } : { id: null }, 200, { 'cache-control': 'public, max-age=2592000' });
  if (v) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
function walk(o, out) {
  if (!o || typeof o !== 'object' || out.length >= 10) return;
  if (Array.isArray(o)) { for (const x of o) walk(x, out); return; }
  if (o.videoRenderer?.videoId) {
    const v = o.videoRenderer;
    out.push({ id: v.videoId, title: (v.title?.runs || []).map((r) => r.text).join('') || v.title?.simpleText || '' });
    return;
  }
  for (const k in o) walk(o[k], out);
}

// ---------- Rooms ----------
const ROUND_MS = 20000, LEAD_MS = 3000, REVEAL_MS = 8000, MAX_PLAYERS = 8;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.players = new Map(); // id -> { id, name, ws, score, got, gotAt, last, lock }
    this.host = null;
    this.phase = 'lobby';
    this.settings = { rounds: 10, type: 'both', era: 'any' };
    this.round = 0;
    this.song = null;
    this.used = new Set();
    this.timer = null;
    this.code = '';
  }

  async fetch(req) {
    this.code = new URL(req.url).pathname.split('/')[3] || this.code;
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = crypto.randomUUID().slice(0, 8);
    server.addEventListener('message', (e) => { try { this.onMsg(id, server, JSON.parse(e.data)); } catch {} });
    const bye = () => this.leave(id);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch {} }
  broadcast(m) { const s = JSON.stringify(m); for (const p of this.players.values()) { try { p.ws.send(s); } catch {} } }

  state() {
    return {
      t: 'state', code: this.code, phase: this.phase, host: this.host, round: this.round, settings: this.settings,
      players: [...this.players.values()].map(({ id, name, score, got, gotAt, last }) => ({ id, name, score, got, gotAt, last })),
    };
  }
  sync() { this.broadcast(this.state()); }

  onMsg(id, ws, m) {
    if (m.t === 'join') {
      if (!this.players.has(id) && this.players.size >= MAX_PLAYERS) return this.send(ws, { t: 'error', msg: 'This room is full (8 players).' });
      const name = String(m.name || '').trim().slice(0, 16) || 'Player';
      this.players.set(id, { id, name, ws, score: 0, got: false, gotAt: 0, last: 0, lock: 0 });
      if (!this.host || !this.players.has(this.host)) this.host = id;
      this.send(ws, { t: 'you', id });
      this.sync();
      if (this.phase === 'round') this.send(ws, this.roundMsg());
      if (this.phase === 'reveal') this.send(ws, { t: 'reveal', id: this.song.id, ms: Math.max(1000, this.revealEnd - Date.now()) });
      return;
    }
    const p = this.players.get(id);
    if (!p) return;
    const isHost = id === this.host;

    if (m.t === 'settings' && isHost && this.phase !== 'round' && this.phase !== 'reveal') {
      const rounds = [5, 10, 15, 20].includes(+m.rounds) ? +m.rounds : this.settings.rounds;
      const type = ['both', 'OP', 'ED'].includes(m.type) ? m.type : this.settings.type;
      const era = ['any', '2020s', '2010s', '2000s', 'older'].includes(m.era) ? m.era : this.settings.era;
      this.settings = { rounds, type, era };
      this.sync();
    } else if (m.t === 'start' && isHost && (this.phase === 'lobby' || this.phase === 'over')) {
      this.pool = filterSongs(data.songs, this.settings);
      if (this.pool.length < this.settings.rounds) return this.send(ws, { t: 'error', msg: 'Not enough songs for those settings.' });
      for (const q of this.players.values()) { q.score = 0; q.got = false; q.last = 0; }
      this.round = 0;
      this.used = new Set();
      this.r = rng((Date.now() ^ (Math.random() * 2 ** 31)) | 0);
      this.nextRound();
    } else if (m.t === 'lobby' && isHost && this.phase === 'over') {
      this.phase = 'lobby';
      this.sync();
    } else if (m.t === 'guess' && this.phase === 'round' && !p.got) {
      const now = Date.now();
      if (now < this.startAt || now < p.lock) return;
      const text = String(m.text || '').slice(0, 120);
      const ok = isCorrect(data, this.song, { text, kind: m.kind === 'anime' || m.kind === 'song' ? m.kind : undefined, f: Number.isInteger(m.f) ? m.f : undefined });
      if (!ok) { p.lock = now + 1200; return this.send(ws, { t: 'guess', ok: false, text }); }
      const e = now - this.startAt;
      const first = ![...this.players.values()].some((q) => q.got);
      p.got = true;
      p.gotAt = e;
      p.last = Math.max(200, 1000 - Math.floor((e / ROUND_MS) * 800)) + (first ? 100 : 0);
      p.score += p.last;
      this.send(ws, { t: 'guess', ok: true, pts: p.last });
      this.sync();
      if ([...this.players.values()].every((q) => q.got)) this.endRound();
    }
  }

  roundMsg() {
    return { t: 'round', i: this.round, n: this.settings.rounds, id: this.song.id, startAt: this.startAt, now: Date.now(), ms: ROUND_MS };
  }

  nextRound() {
    const s = pickRamp(this.pool, this.round + 2, this.used, this.r);
    if (!s) return this.finish();
    this.round++;
    this.song = s;
    this.used.add(s.id);
    for (const q of this.players.values()) { q.got = false; q.last = 0; q.gotAt = 0; q.lock = 0; }
    this.phase = 'round';
    this.startAt = Date.now() + LEAD_MS;
    this.broadcast(this.roundMsg());
    this.sync();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.endRound(), LEAD_MS + ROUND_MS);
  }

  endRound() {
    if (this.phase !== 'round') return;
    clearTimeout(this.timer);
    this.phase = 'reveal';
    this.revealEnd = Date.now() + REVEAL_MS;
    this.broadcast({ t: 'reveal', id: this.song.id, ms: REVEAL_MS });
    this.sync();
    this.timer = setTimeout(() => (this.round >= this.settings.rounds ? this.finish() : this.nextRound()), REVEAL_MS);
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'over';
    this.sync();
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    if (this.host === id) this.host = this.players.keys().next().value || null;
    if (!this.players.size) { clearTimeout(this.timer); this.phase = 'lobby'; this.round = 0; return; }
    if (this.phase === 'round' && [...this.players.values()].every((q) => q.got)) this.endRound();
    this.sync();
  }
}
