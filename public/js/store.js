// localStorage helpers (wrapped: private windows can throw).
const P = 'ec.';
export function get(k, d) {
  try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; }
}
export function set(k, v) {
  try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {}
}
