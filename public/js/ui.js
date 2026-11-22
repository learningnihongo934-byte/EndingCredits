import { search, isCorrect } from './match.js';
import { clip } from './player.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const STAGES = [1, 2, 4, 7, 11, 16];
const MAX = STAGES[STAGES.length - 1];
export const fmt = (t) => `0:${String(Math.floor(t)).padStart(2, '0')}`;
export const typeName = (s) => (s.type === 'OP' ? 'Opening' : 'Ending');

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
};
export { ICON };

export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- Guess input with autocomplete ----------
export function guessBox(el, D, onSubmit, { placeholder = 'Name the anime or the song…' } = {}) {
  el.innerHTML = `<div class="gb"><input class="gb-in" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" aria-label="Your guess"><ul class="gb-list" role="listbox"></ul></div>`;
  const input = $('.gb-in', el), list = $('.gb-list', el);
  let items = [], active = -1, chosen = null;
  const close = () => { list.innerHTML = ''; list.classList.remove('on'); items = []; active = -1; };
  const draw = () => {
    list.innerHTML = items.map((it, i) => `<li role="option" class="${i === active ? 'on' : ''}" data-i="${i}">
      <span class="gb-kind">${it.kind === 'anime' ? 'Anime' : 'Song'}</span>
      <span class="gb-label">${esc(it.label)}${it.sub ? `<small> · ${esc(it.sub)}</small>` : ''}${it.alt ? `<small class="gb-alt">${esc(it.alt)}</small>` : ''}</span></li>`).join('');
    list.classList.toggle('on', items.length > 0);
  };
  const pick = (it) => { chosen = it; input.value = it.label; close(); };
  input.addEventListener('input', () => { chosen = null; items = search(D.index, input.value); active = items.length ? 0 : -1; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; draw(); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length && active >= 0) pick(items[active]);
      else submit();
    }
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    pick(items[+li.dataset.i]);
    input.focus();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  function submit() {
    const text = input.value.trim();
    if (!text) return false;
    const g = chosen && chosen.label === text ? { text, kind: chosen.kind, f: chosen.f } : { text };
    input.value = ''; chosen = null; close();
    onSubmit(g);
    return true;
  }
  return {
    submit,
    focus: () => input.focus({ preventScroll: true }),
    disable: (v) => { input.disabled = v; if (v) close(); },
    shake: () => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); },
  };
}

// ---------- Heardle round ----------
export function heardle(el, { D, song, label, initial = [], onChange, onDone }) {
  const guesses = initial.slice();
  const stage = () => STAGES[Math.min(guesses.length, STAGES.length - 1)];
  let finished = false;
  el.innerHTML = `<div class="hd">
    <div class="hd-meta"><span class="pill">${typeName(song)}</span><span class="hd-label">${esc(label)}</span></div>
    <ol class="slots">${STAGES.map(() => '<li><span></span></li>').join('')}</ol>
    <div class="track" aria-hidden="true">
      <div class="track-open"></div><div class="track-fill"></div>
      ${STAGES.slice(0, -1).map((s) => `<i style="left:${(s / MAX) * 100}%"></i>`).join('')}
    </div>
    <div class="track-times"><span class="t-now">0:00</span><span>0:${MAX}</span></div>
    <div class="hd-play"><button class="playbtn" aria-label="Play clip">${ICON.play}</button></div>
    <div class="guess-slot"></div>
    <div class="hd-actions"><button class="btn skip"></button><button class="btn primary submit">Submit</button></div>
  </div>`;
  const slots = el.querySelectorAll('.slots li');
  const open = $('.track-open', el), fill = $('.track-fill', el), now = $('.t-now', el), playBtn = $('.playbtn', el), skipBtn = $('.skip', el);
  const box = guessBox($('.guess-slot', el), D, (g) => guess(g));

  clip.load(song.preview);
  clip.onTick = (t) => { fill.style.width = `${(Math.min(t, MAX) / MAX) * 100}%`; now.textContent = fmt(Math.min(t, MAX)); };
  clip.onState = (p) => { playBtn.innerHTML = p ? ICON.pause : ICON.play; playBtn.classList.toggle('on', p); };
  clip.a.onerror = () => toast('This clip did not load. Try skipping.');
  const toggle = () => { if (finished) return; clip.playing ? clip.stop() : clip.play(stage()).catch(() => toast('Tap play to hear the clip')); };
  playBtn.onclick = toggle;
  skipBtn.onclick = () => guess({ skip: true });
  $('.submit', el).onclick = () => { if (!box.submit()) box.focus(); };
  const onKey = (e) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName)) { e.preventDefault(); toggle(); }
  };
  document.addEventListener('keydown', onKey);

  function draw() {
    guesses.forEach((g, i) => {
      slots[i].className = g.ok ? 'ok' : g.skip ? 'skip' : 'bad';
      slots[i].firstChild.textContent = g.ok ? g.text : g.skip ? `Skipped` : g.text;
    });
    open.style.width = `${(stage() / MAX) * 100}%`;
    const left = STAGES.length - guesses.length;
    const next = STAGES[guesses.length + 1];
    skipBtn.textContent = left <= 1 ? 'Give up' : `Skip (+${next - stage()}s)`;
  }
  function guess(g) {
    if (finished) return;
    const rec = g.skip ? { skip: true } : { text: g.text, ok: isCorrect(D, song, g) };
    guesses.push(rec);
    if (!rec.ok && !rec.skip) box.shake();
    onChange?.(guesses.slice());
    draw();
    if (rec.ok || guesses.length >= STAGES.length) {
      finished = true;
      clip.stop();
      document.removeEventListener('keydown', onKey);
      onDone?.({ ok: !!rec.ok, attempts: guesses.length, guesses: guesses.slice() });
    } else if (!rec.skip) box.focus();
  }
  draw();
  if (matchMedia('(pointer:fine)').matches) box.focus();
}

export function squares(guesses) {
  return STAGES.map((_, i) => { const g = guesses[i]; return !g ? '⬜' : g.ok ? '🟩' : g.skip ? '⬛' : '🟥'; }).join('');
}

// ---------- Credits (the reveal) ----------
export function credits(el, song, { result = '', compact = false } = {}) {
  el.innerHTML = `<article class="credits ${compact ? 'compact' : ''}" style="--tint:${esc(song.color || 'var(--accent)')}">
    ${result ? `<p class="cr-result">${result}</p>` : ''}
    <div class="cr-cover">${song.cover ? `<img src="${esc(song.cover)}" alt="" loading="lazy">` : ''}
      <button class="cr-play" aria-label="Play the full clip">${ICON.play}</button></div>
    <div class="cr-roll">
      <p class="cr-label">${typeName(song)} theme${song.n > 1 ? ` ${song.n}` : ''}</p>
      <h2 class="cr-title">${esc(song.anime)}</h2>
      ${song.romaji && song.romaji !== song.anime ? `<p class="cr-romaji">${esc(song.romaji)}</p>` : ''}
      <p class="cr-label">Song</p><p class="cr-song">${esc(song.song)}</p>
      <p class="cr-label">Performed by</p><p class="cr-name">${esc(song.artist)}</p>
      <div class="cr-pair">
        ${song.studio ? `<div><p class="cr-label">Studio</p><p class="cr-name">${esc(song.studio)}</p></div>` : ''}
        ${song.year ? `<div><p class="cr-label">Year</p><p class="cr-name">${song.year}</p></div>` : ''}
      </div>
    </div>
    ${compact ? '' : `<div class="cr-video"><button class="btn watch">Watch the ${typeName(song).toLowerCase()}</button></div>`}
    <div class="cr-links">
      ${song.apple ? `<a href="${esc(song.apple)}" target="_blank" rel="noopener">Apple Music</a>` : ''}
      <a class="yt-link" href="https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery(song))}" target="_blank" rel="noopener">YouTube</a>
    </div>
  </article>`;
  const pb = $('.cr-play', el);
  clip.load(song.preview);
  clip.onTick = null;
  clip.onState = (p) => { pb.innerHTML = p ? ICON.pause : ICON.play; };
  pb.onclick = () => (clip.playing ? clip.stop() : clip.play(30).catch(() => {}));
  const w = $('.watch', el);
  if (w) w.onclick = () => watch(el.querySelector('.cr-video'), song);
}

const ytQuery = (s) => `${s.romaji || s.anime} ${s.type === 'OP' ? 'opening' : 'ending'} ${s.n} ${s.song}`;

async function watch(box, song) {
  box.innerHTML = '<div class="yt-frame loading">Finding the video…</div>';
  clip.stop();
  try {
    const r = await fetch('/api/yt?q=' + encodeURIComponent(ytQuery(song)));
    const d = await r.json();
    if (!d.id) throw new Error('none');
    box.innerHTML = `<div class="yt-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.id)}?autoplay=1&rel=0" title="${esc(d.title || song.song)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  } catch {
    box.innerHTML = '<p class="muted">No video found. Try the YouTube link below.</p>';
  }
}
