import { $, esc, guessBox, credits, toast, typeName, ICON } from './ui.js';
import { clip } from './player.js';
import * as store from './store.js';

let ws = null;
export function leaveRoom() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

// ---------- create / join ----------
export function viewRooms(view) {
  const name = store.get('name', '');
  view.innerHTML = `<section class="page">
    <header class="page-head"><p class="kicker">Up to 8 players</p><h1>Rooms</h1></header>
    <p class="lede">Everyone hears the same clip at the same moment. The faster you name it, the more you score.</p>
    <form class="room-forms">
      <label class="field"><span>Your name</span><input class="in name" maxlength="16" value="${esc(name)}" placeholder="Name" required></label>
      <div class="room-split">
        <div class="card"><h3>Start a room</h3><p class="muted small">You pick the rounds and songs, then share the code.</p><button class="btn primary create" type="button">Create room</button></div>
        <div class="card"><h3>Join a room</h3><input class="in code" maxlength="4" placeholder="CODE" autocapitalize="characters" aria-label="Room code"><button class="btn join" type="button">Join</button></div>
      </div>
    </form></section>`;
  const nameIn = $('.name', view), codeIn = $('.code', view);
  const ok = () => { const n = nameIn.value.trim(); if (!n) { nameIn.focus(); toast('Pick a name first'); return false; } store.set('name', n); return true; };
  $('.create', view).onclick = async () => {
    if (!ok()) return;
    try { const r = await fetch('/api/room/new'); const { code } = await r.json(); location.hash = '#/room/' + code; }
    catch { toast('Could not create a room'); }
  };
  const join = () => { if (!ok()) return; const c = codeIn.value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) { toast('Codes are 4 letters'); codeIn.focus(); return; } location.hash = '#/room/' + c; };
  $('.join', view).onclick = join;
  codeIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); join(); } };
}

// ---------- in a room ----------
export function viewRoom(view, D, code) {
  if (!/^[A-Z]{4}$/.test(code)) { location.hash = '#/rooms'; return; }
  // A click is needed before audio can play on its own, so every visit starts at this gate.
  view.innerHTML = `<section class="page narrow">
    <header class="page-head"><p class="kicker">Room</p><h1 class="code-big">${code}</h1></header>
    <label class="field"><span>Your name</span><input class="in name" maxlength="16" value="${esc(store.get('name', ''))}" placeholder="Name"></label>
    <button class="btn primary big enter">Join room</button></section>`;
  const nameIn = $('.name', view);
  const go = () => {
    const n = nameIn.value.trim();
    if (!n) { nameIn.focus(); return; }
    store.set('name', n);
    clip.load(D.songs[0].preview);
    clip.unlock();
    connect(view, D, code, n);
  };
  $('.enter', view).onclick = go;
  nameIn.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  if (!nameIn.value) nameIn.focus();
}

function connect(view, D, code, name) {
  leaveRoom();
  let me = null, st = null, phase = '', round = null, offset = 0, raf = 0, box = null, got = false;
  view.innerHTML = `<section class="room">
    <div class="room-main"><div class="room-stage"><p class="muted">Connecting…</p></div></div>
    <aside class="board"><div class="board-head"><span>Room <b>${code}</b></span><button class="link copy">Copy invite</button></div><ol class="players"></ol></aside>
  </section>`;
  const stage = $('.room-stage', view), players = $('.players', view);
  $('.copy', view).onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}/#/room/${code}`); toast('Invite link copied'); } catch { toast(code); } };

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room/${code}/ws`);
  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.onopen = () => send({ t: 'join', name });
  ws.onclose = () => {
    cancelAnimationFrame(raf); clip.stop();
    stage.innerHTML = `<div class="center"><p>Disconnected from the room.</p><button class="btn primary rejoin">Rejoin</button></div>`;
    $('.rejoin', stage).onclick = () => { clip.unlock(); connect(view, D, code, name); };
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'you') me = m.id;
    else if (m.t === 'error') toast(m.msg);
    else if (m.t === 'state') { st = m; board(); if (m.phase !== phase) { phase = m.phase; main(); } else if (phase === 'lobby') lobbySettings(); }
    else if (m.t === 'round') startRound(m);
    else if (m.t === 'reveal') reveal(m);
    else if (m.t === 'guess') feedback(m);
  };

  function board() {
    const ps = [...st.players].sort((a, b) => b.score - a.score);
    players.innerHTML = ps.map((p) => `<li class="${p.id === me ? 'me' : ''} ${p.got ? 'got' : ''}">
      <span class="p-name">${esc(p.name)}${p.id === st.host ? ' <small>host</small>' : ''}</span>
      <span class="p-mark">${p.got ? `+${p.last}` : ''}</span><b class="p-score">${p.score}</b></li>`).join('');
  }

  function main() {
    cancelAnimationFrame(raf);
    if (phase === 'lobby') lobby();
    else if (phase === 'over') over();
    // round / reveal screens are drawn by their own messages
  }

  function lobby() {
    clip.stop();
    stage.innerHTML = `<div class="lobby">
      <p class="kicker">Waiting room</p><h2>Share code <span class="code-inline">${code}</span></h2>
      <div class="settings"></div>
      <div class="lobby-go"></div></div>`;
    lobbySettings();
  }
  function lobbySettings() {
    const s = st.settings, host = st.host === me;
    const seg = (k, opts) => `<div class="seg ${host ? '' : 'ro'}" data-k="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-checked="${String(s[k]) === String(v)}" ${host ? '' : 'disabled'}>${l}</button>`).join('')}</div>`;
    const el = $('.settings', stage);
    if (!el) return;
    el.innerHTML = `
      <label class="field"><span>Rounds</span>${seg('rounds', [[5, '5'], [10, '10'], [15, '15'], [20, '20']])}</label>
      <label class="field"><span>Songs</span>${seg('type', [['both', 'Both'], ['OP', 'Openings'], ['ED', 'Endings']])}</label>
      <label class="field"><span>Era</span>${seg('era', [['any', 'Any'], ['2020s', '2020s'], ['2010s', '2010s'], ['2000s', '2000s'], ['older', 'Older']])}</label>`;
    el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || !host) return;
      const k = b.closest('.seg').dataset.k;
      send({ t: 'settings', ...st.settings, [k]: k === 'rounds' ? +b.dataset.v : b.dataset.v });
    };
    $('.lobby-go', stage).innerHTML = host
      ? `<button class="btn primary big start">Start game</button><p class="muted small">${st.players.length} player${st.players.length > 1 ? 's' : ''} here. You can start alone to test.</p>`
      : '<p class="muted">Waiting for the host to start…</p>';
    const sb = $('.start', stage);
    if (sb) sb.onclick = () => { clip.unlock(); send({ t: 'start' }); };
  }

  function startRound(m) {
    phase = 'round';
    round = m;
    got = false;
    offset = m.now - Date.now();
    const song = D.byId.get(m.id);
    clip.load(song.preview);
    clip.onTick = null;
    clip.onState = null;
    stage.innerHTML = `<div class="rnd">
      <div class="rnd-head"><span class="muted">Round ${m.i} of ${m.n}</span><span class="pill">${typeName(song)}</span><span class="rnd-clock">20</span></div>
      <div class="rnd-bar"><i></i></div>
      <div class="rnd-msg">Get ready…</div>
      <div class="guess-slot"></div>
      <div class="rnd-fb muted small"></div></div>`;
    box = guessBox($('.guess-slot', stage), D, (g) => send({ t: 'guess', ...g }));
    box.disable(true);
    const bar = $('.rnd-bar i', stage), clock = $('.rnd-clock', stage), msg = $('.rnd-msg', stage);
    let started = false;
    const tick = () => {
      const t = Date.now() + offset - m.startAt;
      if (t < 0) { msg.textContent = `Starts in ${Math.ceil(-t / 1000)}`; }
      else {
        if (!started) {
          started = true;
          if (!got) { box.disable(false); box.focus(); msg.textContent = 'Listen…'; }
          clip.play(m.ms / 1000, t / 1000).catch(() => {
            msg.innerHTML = `<button class="btn primary tap">${ICON.play} Tap to listen</button>`;
            $('.tap', stage).onclick = () => { msg.textContent = 'Listen…'; clip.play(m.ms / 1000, (Date.now() + offset - m.startAt) / 1000).catch(() => {}); };
          });
        }
        const left = Math.max(0, m.ms - t);
        bar.style.width = `${(left / m.ms) * 100}%`;
        clock.textContent = Math.ceil(left / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function feedback(m) {
    const fb = $('.rnd-fb', stage);
    if (!fb) return;
    if (m.ok) {
      got = true;
      box.disable(true);
      $('.rnd-msg', stage).innerHTML = `<span class="ok-big">Got it · +${m.pts}</span>`;
      fb.textContent = 'Waiting for the others…';
    } else {
      box.shake();
      fb.textContent = `“${m.text}” isn’t it`;
    }
  }

  function reveal(m) {
    phase = 'reveal';
    cancelAnimationFrame(raf);
    clip.stop();
    const song = D.byId.get(m.id);
    const meP = st?.players.find((p) => p.id === me);
    stage.innerHTML = `<div class="rv"><div class="cr-host"></div><div class="rv-bar"><i></i></div></div>`;
    credits($('.cr-host', stage), song, { compact: true, result: meP?.got ? `You got it · +${meP.last}` : 'Nobody’s perfect' });
    clip.play(30, 0).catch(() => {});
    const bar = $('.rv-bar i', stage);
    bar.style.transition = `width ${m.ms}ms linear`;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '0%'; }));
  }

  function over() {
    clip.stop();
    const ps = [...st.players].sort((a, b) => b.score - a.score);
    const host = st.host === me;
    stage.innerHTML = `<div class="over">
      <p class="kicker">Final credits</p>
      <ol class="podium">${ps.map((p, i) => `<li class="${p.id === me ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="p-name">${esc(p.name)}</span><b>${p.score}</b></li>`).join('')}</ol>
      ${host ? '<div class="after"><button class="btn primary big again">Play again</button><button class="btn lob">Change settings</button></div>' : '<p class="muted">The host can start another game.</p>'}
    </div>`;
    if (host) {
      $('.again', stage).onclick = () => { clip.unlock(); send({ t: 'start' }); };
      $('.lob', stage).onclick = () => send({ t: 'lobby' });
    }
  }
}
