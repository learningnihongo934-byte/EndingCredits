// Answer matching, shared by the browser and the multiplayer Worker.
// A guess is right if it names the song's anime franchise (any season, any title) or the song itself.

export function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[([（【].*?[)\]）】]/g, ' ')
    .replace(/[^0-9a-z\u3040-\u30ff\u4e00-\u9fff]+/g, '');
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const keyCache = new WeakMap();
function keysFor(D, song) {
  let ks = keyCache.get(song);
  if (!ks) {
    const fr = D.franchises[song.f] || { n: '', alt: [] };
    ks = new Set([fr.n, ...fr.alt, song.anime, song.romaji].map(norm).filter((k) => k.length > 1));
    keyCache.set(song, ks);
  }
  return ks;
}

// guess = { text, kind?: 'anime' | 'song', f?: franchise index }
export function isCorrect(D, song, guess) {
  if (guess.kind === 'anime' && Number.isInteger(guess.f)) return guess.f === song.f;
  const g = norm(guess.text);
  if (!g) return false;
  const title = norm(song.song);
  if (g === title) return true;
  if (guess.kind === 'song') return false;
  const ks = keysFor(D, song);
  if (ks.has(g)) return true;
  if (g.length >= 5) {
    const tol = g.length >= 12 ? 2 : 1;
    for (const k of [...ks, title]) if (lev(g, k) <= tol) return true;
  }
  return false;
}

// Autocomplete entries: every franchise (by any of its titles) and every song title.
export function buildIndex(D) {
  const items = D.franchises.map((f, i) => ({ kind: 'anime', f: i, label: f.n, keys: [f.n, ...f.alt].map((x) => x.toLowerCase()) }));
  const seen = new Set();
  for (const s of D.songs) {
    const k = norm(s.song);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ kind: 'song', label: s.song, sub: s.artist, keys: [s.song.toLowerCase()] });
  }
  return items;
}

export function search(items, q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const it of items) {
    let best = -1, hit = '';
    for (const k of it.keys) {
      const i = k.indexOf(q);
      if (i < 0) continue;
      const sc = i === 0 ? 3 : /[\s:\-!]/.test(k[i - 1]) ? 2 : 1;
      if (sc > best) { best = sc; hit = k; }
    }
    if (best > 0) out.push({ it, best, hit });
  }
  out.sort((a, b) => b.best - a.best); // stable: franchises stay in popularity order
  return out.slice(0, limit).map(({ it, hit }) => ({ ...it, alt: hit !== it.label.toLowerCase() ? hit : '' }));
}
