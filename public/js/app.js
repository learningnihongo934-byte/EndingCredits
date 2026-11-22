import { loadData } from './data.js';
import { dayNumber, dailySong, filterSongs, levelPool, pickFor, rng } from './pools.js';
import { $, esc, heardle, credits, squares, toast, STAGES } from './ui.js';
import { clip } from './player.js';
import * as store from './store.js';
import { viewRooms, viewRoom, leaveRoom } from './room.js';

const view = $('#view');

// ---------- chrome: theme, volume, help ----------
const root = document.documentElement;
$('#theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
};
const vol = $('#vol');
vol.value = clip.a.volume = store.get('vol', 0.8);
vol.oninput = () => { clip.a.volume = +vol.value; store.set('vol', +vol.value); };
$('#help').onclick = () => help();
function help() {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog" class="dlg">
    <h2>How to play</h2>
    <p>Press play to hear the first second of an anime opening or ending. Name <b>the anime</b> (any season counts) <b>or the song</b>.</p>
    <p>Endless and Rooms also have <b>J-Pop</b> hits like Lemon and Bunny Girl. For those, name the song. Typing an artist lists their songs.</p>
    <p>Every wrong guess or skip unlocks more of the clip: 1s, 2s, 4s, 7s, 11s, then 16s. Six tries in all.</p>
    <dl class="modes">
      <dt>Daily</dt><dd>One song a day, the same for everyone. Share your squares.</dd>
      <dt>Endless</dt><dd>Three lives. A song you miss costs one. Songs get harder as you go.</dd>
      <dt>Rooms</dt><dd>Up to 8 friends hear the same clip at once. Faster right answers score more.</dd>
    </dl>
    <p class="muted small">Clips are official Apple Music and Deezer previews. Song data from AnisongDB, AniList and kworb.</p>
    <button class="btn primary">Got it</button></form>`;
  d.showModal();
}
if (!store.get('seenHelp', false)) { store.set('seenHelp', true); setTimeout(help, 400); }

// ---------- router ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'daily';
  const [page, arg] = h.split('/');
  clip.stop();
  if (page !== 'room') leaveRoom();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (page === 'room' ? 'rooms' : page)));
  view.innerHTML = '<p class="loading-page">Loading songs…</p>';
  try {
    const D = await loadData();
    if (page === 'endless') endless(D);
    else if (page === 'rooms') viewRooms(view);
    else if (page === 'room') viewRoom(view, D, (arg || '').toUpperCase());
    else daily(D);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<p class="loading-page">Could not load the songs. Check your connection and reload.</p>';
  }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();

// ---------- Daily ----------
function daily(D) {
  const n = dayNumber();
  const song = dailySong(D, n);
  const key = 'daily.' + n;
  const st = store.get(key, { guesses: [], done: false, ok: false });
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  view.innerHTML = `<section class="page">
    <header class="page-head"><p class="kicker">${esc(date)}</p><h1>Daily <span class="num">No. ${n}</span></h1></header>
    <div id="stage"></div></section>`;
  const stage = $('#stage');
  if (st.done) return done();
  heardle(stage, {
    D, song, label: 'Today’s song', initial: st.guesses,
    onChange: (g) => { st.guesses = g; store.set(key, st); },
    onDone: (r) => { st.done = true; st.ok = r.ok; store.set(key, st); record(n, r); done(true); },
  });

  function done(fresh) {
    const s = store.get('stats', { played: 0, won: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] });
    const sec = STAGES[Math.min(st.guesses.length, 6) - 1];
    const result = st.ok ? `Got it in <b>${sec} second${sec > 1 ? 's' : ''}</b>` : 'Not this time';
    stage.innerHTML = `<div class="done">
      <p class="sq" aria-label="Your guesses">${squares(st.guesses)}</p>
      <div class="cr-host"></div>
      <div class="after"><button class="btn primary share">Share result</button><span class="next muted"></span></div>
      <div class="stats">
        ${[['Played', s.played], ['Won', s.played ? Math.round((s.won / s.played) * 100) + '%' : '–'], ['Streak', s.streak], ['Best', s.best]]
          .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}
      </div>
      <div class="dist">${s.dist.map((c, i) => { const m = Math.max(1, ...s.dist); return `<div class="dist-row ${st.ok && st.guesses.length - 1 === i ? 'me' : ''}"><span>${STAGES[i]}s</span><i style="width:${Math.max(6, (c / m) * 100)}%">${c}</i></div>`; }).join('')}</div>
      <p class="muted small center">Try <a href="#/endless">Endless</a> while you wait, or start a <a href="#/rooms">room</a> with friends.</p>
    </div>`;
    credits($('.cr-host', stage), song, { result });
    if (fresh) clip.play(30).catch(() => {});
    $('.share', stage).onclick = async () => {
      const text = `Ending Credits No. ${n}\n${squares(st.guesses)}\n${location.origin}`;
      try {
        if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
      } catch {}
    };
    const nx = $('.next', stage);
    const tick = () => {
      if (!nx.isConnected) return;
      const t = new Date(), m = new Date(t); m.setHours(24, 0, 0, 0);
      const s2 = Math.floor((m - t) / 1000);
      nx.textContent = `Next song in ${Math.floor(s2 / 3600)}h ${String(Math.floor((s2 % 3600) / 60)).padStart(2, '0')}m`;
      setTimeout(tick, 15000);
    };
    tick();
  }
}

function record(n, r) {
  const s = store.get('stats', { played: 0, won: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], last: 0 });
  s.played++;
  if (r.ok) {
    s.won++;
    s.streak = s.last === n - 1 ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.dist[r.attempts - 1]++;
    s.last = n;
  } else s.streak = 0;
  store.set('stats', s);
}

// ---------- Endless ----------
const PTS = [6, 5, 4, 3, 2, 1];
function endless(D) {
  const f = { type: 'all', era: 'any', level: 'normal', ...store.get('endlessFilters', {}) };
  if (f.type === 'both') f.type = 'anime';
  const bestKey = () => `best.${f.type}.${f.era}${f.level === 'normal' ? '' : '.' + f.level}`;
  const seg = (name, opts) => `<div class="seg" role="radiogroup" data-k="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${f[name] === v}">${l}</button>`).join('')}</div>`;
  view.innerHTML = `<section class="page">
    <header class="page-head"><p class="kicker">Three lives</p><h1>Endless</h1></header>
    <div class="setup">
      <label class="field"><span>Level</span>${seg('level', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}</label>
      <label class="field"><span>Songs</span>${seg('type', [['all', 'All'], ['anime', 'Anime'], ['OP', 'Openings'], ['ED', 'Endings'], ['JP', 'J-Pop']])}</label>
      <label class="field"><span>Era</span>${seg('era', [['any', 'Any'], ['2020s', '2020s'], ['2010s', '2010s'], ['2000s', '2000s'], ['older', '90s & older']])}</label>
      <p class="pool muted small"></p>
      <button class="btn primary big go">Start</button>
    </div></section>`;
  const poolInfo = () => {
    const n = levelPool(filterSongs(D.songs, f), f.level).length;
    $('.pool', view).innerHTML = `${n.toLocaleString()} songs in this pool · best score <b>${store.get(bestKey(), 0)}</b>`;
    $('.go', view).disabled = n < 5;
  };
  view.querySelectorAll('.seg').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    f[g.dataset.k] = b.dataset.v;
    g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b));
    store.set('endlessFilters', f);
    poolInfo();
  }));
  poolInfo();
  $('.go', view).onclick = () => run();

  function run() {
    const pool = levelPool(filterSongs(D.songs, f), f.level);
    const g = { lives: 3, score: 0, round: 0, used: new Set(), r: rng((Math.random() * 2 ** 31) | 0), streak: 0 };
    view.innerHTML = `<section class="page">
      <header class="hud"><div><span class="muted">Round</span> <b class="h-round">1</b></div>
        <div class="lives" aria-label="Lives"></div>
        <div><span class="muted">Score</span> <b class="h-score">0</b></div></header>
      <div id="stage"></div></section>`;
    const stage = $('#stage');
    const hud = () => {
      $('.h-round', view).textContent = g.round;
      $('.h-score', view).textContent = g.score;
      $('.lives', view).innerHTML = [0, 1, 2].map((i) => `<i class="${i < g.lives ? 'on' : ''}"></i>`).join('');
    };
    const next = () => {
      const song = pickFor(pool, f.level, g.round, g.used, g.r);
      if (!song) return over(true);
      g.used.add(song.id);
      g.round++;
      hud();
      heardle(stage, {
        D, song, label: `Song ${g.round}`,
        onDone: (r) => {
          if (r.ok) { g.score += PTS[r.attempts - 1]; g.streak++; } else { g.lives--; g.streak = 0; }
          hud();
          stage.innerHTML = `<div class="done"><div class="cr-host"></div>
            <div class="after"><button class="btn primary big nxt">${g.lives ? 'Next song' : 'See score'}</button></div></div>`;
          credits($('.cr-host', stage), song, { result: r.ok ? `+${PTS[r.attempts - 1]} point${r.attempts === 6 ? '' : 's'}` : g.lives ? `Missed: ${g.lives} ${g.lives === 1 ? 'life' : 'lives'} left` : 'Out of lives' });
          clip.play(30).catch(() => {});
          const b = $('.nxt', stage);
          b.focus();
          b.onclick = () => (g.lives ? next() : over());
        },
      });
    };
    const over = (emptied) => {
      clip.stop();
      const best = store.get(bestKey(), 0);
      const nb = g.score > best;
      if (nb) store.set(bestKey(), g.score);
      stage.innerHTML = `<div class="over">
        <p class="kicker">${emptied ? 'You heard every song in this pool' : 'The credits roll'}</p>
        <p class="big-score">${g.score}</p><p class="muted">${nb ? 'New best score' : `Best: ${best}`} · ${g.round} songs</p>
        <div class="after"><button class="btn primary big again">Play again</button><button class="btn change">Change pool</button></div></div>`;
      $('.again', stage).onclick = run;
      $('.change', stage).onclick = () => endless(D);
    };
    next();
  }
}
