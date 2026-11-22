// Song pools and seeded randomness, shared by the browser and the Worker.

// How guessable a song is: AMQ guess rate (0-100) plus a bonus for very popular shows.
export const ease = (s) => s.diff + Math.min(30, s.pop / 30000);

export const ERAS = { any: [0, 9999], '2020s': [2020, 9999], '2010s': [2010, 2019], '2000s': [2000, 2009], older: [1, 1999] };

// type: 'all' | 'anime' (OP + ED) | 'OP' | 'ED' | 'JP'. Old saves used 'both' for anime.
export const TYPES = ['all', 'anime', 'OP', 'ED', 'JP'];
export function filterSongs(songs, { type = 'all', era = 'any' } = {}) {
  if (type === 'both') type = 'anime';
  const [a, b] = ERAS[era] || ERAS.any;
  const typeOk = (s) => type === 'all' || (type === 'anime' ? s.type !== 'JP' : s.type === type);
  return songs.filter((s) => typeOk(s) && (era === 'any' || ((s.year || 0) >= a && (s.year || 0) <= b)));
}

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function shuffled(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Gets harder as rounds go on: easy songs first, then everything.
export function pickRamp(pool, round, used, r) {
  const floor = round < 5 ? 75 : round < 15 ? 50 : round < 30 ? 30 : -1e9;
  let c = pool.filter((s) => !used.has(s.id) && ease(s) >= floor);
  if (c.length < 3) c = pool.filter((s) => !used.has(s.id));
  return c.length ? c[Math.floor(r() * c.length)] : null;
}

// ---- Levels ----
// Easy = the best-known third, Hard = the lesser-known half, Normal = everything with a ramp.
// Anime and J-pop are ranked separately so every level keeps both.
export const LEVELS = ['easy', 'normal', 'hard'];
export function levelPool(pool, level = 'normal') {
  if (level !== 'easy' && level !== 'hard') return pool;
  const out = [];
  for (const group of [pool.filter((s) => s.type === 'JP'), pool.filter((s) => s.type !== 'JP')]) {
    const g = group.slice().sort((a, b) => ease(b) - ease(a));
    out.push(...(level === 'easy' ? g.slice(0, Math.ceil(g.length / 3)) : g.slice(Math.floor(g.length / 2))));
  }
  return out;
}
export function pickFor(pool, level, round, used, r) {
  if (level !== 'easy' && level !== 'hard') return pickRamp(pool, round, used, r);
  const c = pool.filter((s) => !used.has(s.id));
  return c.length ? c[Math.floor(r() * c.length)] : null;
}

// ---- Daily ----
const EPOCH = Date.UTC(2026, 10, 22); // Daily #1 = 22 Nov 2026
export function dayNumber(d = new Date()) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5) + 1;
}

let dailyOrder = null;
export function dailySong(D, n) {
  if (!dailyOrder) {
    const pool = D.songs
      .filter((s) => (s.type === 'OP' ? ease(s) >= 70 : s.type === 'ED' && ease(s) >= 85))
      .sort((a, b) => (a.song + a.artist < b.song + b.artist ? -1 : 1));
    dailyOrder = shuffled(pool, rng(hash('ending-credits-daily')));
  }
  const L = dailyOrder.length;
  return dailyOrder[(((n - 1) % L) + L) % L];
}
