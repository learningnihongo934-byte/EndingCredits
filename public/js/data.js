import { buildIndex } from './match.js';

let D = null;
export async function loadData() {
  if (D) return D;
  const r = await fetch('/data/songs.json');
  D = await r.json();
  D.byId = new Map(D.songs.map((s) => [s.id, s]));
  D.index = buildIndex(D);
  return D;
}
