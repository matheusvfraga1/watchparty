(() => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const socket = io();
const store = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch {} } };
const toast = (t, ms = 2600) => { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), ms); };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

// ---------- HOME ----------
let visibility = 'public';
$('#nick').value = store.get('nick') || '';
$('#nick').addEventListener('change', e => store.set('nick', e.target.value.trim()));
$$('#visSeg button').forEach(b => b.onclick = () => {
  visibility = b.dataset.v;
  $$('#visSeg button').forEach(x => x.classList.toggle('on', x === b));
  $('#visHint').textContent = visibility === 'public' ? 'Aparece na lista para qualquer pessoa entrar.' : 'Só entra quem tiver o link/código.';
});
const getNick = () => {
  let n = $('#nick').value.trim() || store.get('nick');
  if (!n) { n = prompt('Seu apelido:')?.trim(); if (!n) return null; }
  store.set('nick', n); $('#nick').value = n; return n;
};
$('#createBtn').onclick = () => {
  const nick = getNick(); if (!nick) return;
  const password = $('#roomPass').value;
  socket.emit('room:create', { name: $('#roomName').value || `Sala de ${nick}`, isPublic: visibility === 'public', password, everyoneControls: $('#everyone').checked }, ({ id }) => join(id, password));
};
$('#joinBtn').onclick = () => { const c = $('#joinCode').value.trim(); if (c) join(c); };
$('#joinCode').onkeydown = e => e.key === 'Enter' && $('#joinBtn').click();

function renderList(list) {
  const el = $('#roomList');
  el.innerHTML = list.length ? '' : '<p class="hint">Nenhuma sala aberta agora. Crie a sua!</p>';
  list.sort((a, b) => b.users - a.users).forEach(r => {
    const d = document.createElement('div'); d.className = 'room-item';
    d.innerHTML = `<div class="meta"><b>${r.hasPassword ? '🔒 ' : ''}${esc(r.name)}</b><small>${r.title ? '▶ ' + esc(r.title) : 'Escolhendo...'}</small></div><span class="badge">👥 ${r.users}</span>`;
    d.onclick = () => join(r.id); el.appendChild(d);
  });
}
socket.on('rooms:list', renderList);
socket.emit('rooms:list', renderList);

// ---------- ROOM STATE ----------
let me = null, R = null; // R = room state
const isHost = () => R && R.hostId === me;
const canControl = () => R && (R.everyoneControls || isHost());

function join(id, password) {
  const nick = getNick(); if (!nick) return;
  socket.emit('room:join', { id, nick, password }, (res) => {
    if (res.needPassword) { const p = prompt(password ? 'Senha incorreta. Tente de novo:' : 'Sala com senha:'); if (p != null) join(id, p); return; }
    if (res.error) { toast(res.error); if (location.pathname !== '/') history.replaceState(null, '', '/'); return; }
    me = res.me; R = res.state; R._pw = password;
    if (location.pathname !== '/r/' + R.id) history.pushState(null, '', '/r/' + R.id);
    $('#home').classList.add('hidden'); $('#room').classList.remove('hidden');
    $('#msgs').innerHTML = ''; R.messages.forEach(addMsg);
    renderHeader(); renderUsers();
    loadMedia(R.media, R.playback, Date.now());
  });
}
function leaveRoom() {
  socket.emit('room:leave'); stopStreaming(); closeViewerPc(); unloadMedia(); R = null;
  history.pushState(null, '', '/');
  $('#room').classList.add('hidden'); $('#home').classList.remove('hidden');
  socket.emit('rooms:list', renderList);
}
$('#leaveBtn').onclick = leaveRoom;
window.addEventListener('popstate', () => { if (R && !location.pathname.startsWith('/r/')) leaveRoom(); });

// reconexão
socket.on('connect', () => { if (R) { const id = R.id, pw = R._pw; R = null; stopStreaming(); closeViewerPc(); join(id, pw); } });

function renderHeader() {
  $('#rTitle').textContent = R.name;
  $('#rSub').textContent = `${R.isPublic ? '🌐 Aberta' : '🔒 Privada'} · código ${R.id}${isHost() ? ' · você é o anfitrião' : ''}${R.everyoneControls ? '' : ' · só o anfitrião controla'}`;
  document.title = R.name + ' · Sessão';
}
function renderUsers() {
  $('#pCount').textContent = R.users.length;
  $('#people').innerHTML = '';
  R.users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="av" style="background:${u.color}">${esc(u.name[0].toUpperCase())}</span><span class="nm">${esc(u.name)}${u.id === me ? ' (você)' : ''}</span>${u.id === R.hostId ? '<small>👑 anfitrião</small>' : ''}`;
    if (isHost() && u.id !== me) { const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Tornar anfitrião'; b.onclick = () => socket.emit('host:transfer', u.id); li.appendChild(b); }
    $('#people').appendChild(li);
  });
}
socket.on('room:users', ({ users, hostId }) => { if (!R) return; R.users = users; R.hostId = hostId; renderUsers(); renderHeader(); });
socket.on('room:settings', s => { if (!R) return; Object.assign(R, s); renderHeader(); });

$('#inviteBtn').onclick = async () => {
  const url = location.origin + '/r/' + R.id;
  if (navigator.share && /Mobi/i.test(navigator.userAgent)) { try { await navigator.share({ title: R.name, text: 'Bora assistir junto!', url }); return; } catch {} }
  try { await navigator.clipboard.writeText(url); toast('Link copiado!'); } catch { prompt('Copie o link:', url); }
};
$('#settingsBtn').onclick = () => {
  $('#setPublic').checked = R.isPublic; $('#setEveryone').checked = R.everyoneControls;
  $('#setPublic').disabled = $('#setEveryone').disabled = !isHost();
  $('#setHint').textContent = isHost() ? 'Você é o anfitrião.' : 'Só o anfitrião pode mudar.';
  $('#setModal').classList.remove('hidden');
};
$('#setPublic').onchange = e => socket.emit('room:settings', { isPublic: e.target.checked });
$('#setEveryone').onchange = e => socket.emit('room:settings', { everyoneControls: e.target.checked });

// ---------- CHAT ----------
function addMsg(m) {
  const box = $('#msgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const d = document.createElement('div');
  if (m.sys) { d.className = 'msg sys'; d.textContent = m.text; }
  else {
    d.className = 'msg';
    const t = new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    d.innerHTML = `<b style="color:${m.color}">${esc(m.name)}</b>${esc(m.text)}<time>${t}</time>`;
  }
  box.appendChild(d);
  while (box.children.length > 200) box.firstChild.remove();
  if (atBottom || m.uid === me) box.scrollTop = box.scrollHeight;
}
socket.on('chat', m => R && addMsg(m));
$('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) socket.emit('chat', v); $('#chatIn').value = ''; };
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#chatPane').classList.toggle('hidden', b.dataset.tab !== 'chat');
  $('#peoplePane').classList.toggle('hidden', b.dataset.tab !== 'people');
});
$$('.reacts button').forEach(b => b.onclick = () => socket.emit('react', b.dataset.r));
socket.on('react', ({ emoji }) => {
  const f = document.createElement('div'); f.className = 'floater'; f.textContent = emoji;
  f.style.left = (10 + Math.random() * 80) + '%'; $('#floaters').appendChild(f); setTimeout(() => f.remove(), 2700);
});

// ---------- ADD MEDIA ----------
$$('[data-open-add]').forEach(b => b.onclick = () => {
  if (!canControl()) return toast('Só o anfitrião pode trocar o vídeo');
  $('#addModal').classList.remove('hidden');
  if (!ytLast) $('#ytChips button').click();
});
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));
$$('.modal').forEach(m => m.onclick = e => e.target === m && m.classList.add('hidden'));
$$('.src-tabs button').forEach(b => b.onclick = () => {
  $$('.src-tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.src-body').forEach(x => x.classList.toggle('hidden', x.dataset.body !== b.dataset.src));
});
const closeAdd = () => $('#addModal').classList.add('hidden');

function ytId(u) {
  const m = String(u).match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m && m[1];
}
function driveId(u) { const m = String(u).match(/\/(?:d|folders)\/([\w-]{20,})/) || String(u).match(/[?&]id=([\w-]{20,})/); return m && m[1]; }
const playYT = (id, title) => { socket.emit('media:set', { type: 'youtube', src: id, title: title || 'YouTube', kind: 'youtube' }); closeAdd(); };
const playDrive = (id, title) => { socket.emit('media:set', { type: 'video', src: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, title: title || 'Google Drive', kind: 'drive' }); closeAdd(); };
const api = (u) => fetch(u).then(r => r.ok ? r.json() : Promise.reject(new Error('erro')));

// YouTube: busca e categorias
const CHIPS = [
  ['🎬 Filmes completos', 'filme completo dublado', 'long'], ['🍿 Lançamentos', 'filme lançamento 2026 completo dublado', 'long'],
  ['😂 Comédia', 'filme de comédia completo dublado', 'long'], ['💥 Ação', 'filme de ação completo dublado', 'long'],
  ['👻 Terror', 'filme de terror completo dublado', 'long'], ['🧸 Desenhos', 'desenho animado completo dublado', 'long'],
  ['🎞️ Trailers', 'trailer oficial dublado 2026', 'video'], ['🎵 Música', 'clipes mais tocados brasil', 'video'],
  ['⚽ Futebol', 'melhores momentos futebol', 'video'], ['🔴 Ao vivo', 'ao vivo agora', 'live'],
];
let ytLast = null;
function ytLoad(q, f = 'video', chip) {
  ytLast = q + f;
  $$('#ytChips button').forEach(b => b.classList.toggle('on', b === chip));
  const box = $('#ytResults'); box.innerHTML = '<div class="loading">Carregando...</div>';
  const key = ytLast;
  api(`/api/yt?q=${encodeURIComponent(q)}&f=${f}`).then(items => {
    if (key !== ytLast) return;
    box.innerHTML = items.length ? '' : '<div class="loading">Nada encontrado.</div>';
    items.forEach(v => {
      const d = document.createElement('div'); d.className = 'vcard';
      d.innerHTML = `<div class="th"><img loading="lazy" src="${esc(v.thumb)}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : v.live ? '<span class="dur live">AO VIVO</span>' : ''}</div><div class="info"><b>${esc(v.title)}</b><small>${esc(v.channel)}${v.views ? ' · ' + esc(v.views) : ''}</small></div>`;
      d.onclick = () => playYT(v.id, v.title);
      box.appendChild(d);
    });
  }).catch(() => { if (key === ytLast) box.innerHTML = '<div class="loading">Não deu pra buscar agora. Tente de novo.</div>'; });
}
CHIPS.forEach(([label, q, f]) => {
  const b = document.createElement('button'); b.textContent = label; b.onclick = () => { $('#ytQ').value = ''; ytLoad(q, f, b); };
  $('#ytChips').appendChild(b);
});
$('#ytForm').onsubmit = e => {
  e.preventDefault(); const v = $('#ytQ').value.trim(); if (!v) return;
  const id = ytId(v); if (id) { $('#ytQ').value = ''; return playYT(id); }
  ytLoad(v, 'video');
};

// Streaming: atalhos
const SERVICES = [
  ['Netflix', 'https://www.netflix.com/browse', '#e50914'], ['Prime Video', 'https://www.primevideo.com', '#00a8e1'],
  ['Disney+', 'https://www.disneyplus.com', '#113ccf'], ['Max', 'https://play.max.com', '#002be7'],
  ['Globoplay', 'https://globoplay.globo.com', '#fb0234'], ['Apple TV+', 'https://tv.apple.com', '#333'],
  ['Paramount+', 'https://www.paramountplus.com/br/', '#0064ff'], ['Crunchyroll', 'https://www.crunchyroll.com', '#f47521'],
  ['Pluto TV', 'https://pluto.tv/br', '#2d2d2d'], ['Twitch', 'https://www.twitch.tv', '#9146ff'],
  ['Mercado Play', 'https://play.mercadolivre.com.br', '#2d3277'], ['Kick', 'https://kick.com', '#2a2a2a'],
];
SERVICES.forEach(([n, u, c]) => {
  const b = document.createElement('button'); b.className = 'svc'; b.style.background = c; b.textContent = n;
  b.onclick = () => { window.open(u, '_blank', 'noopener'); toast('Coloque o filme na outra aba e volte aqui para compartilhar', 4000); };
  $('#services').appendChild(b);
});

// Google Drive: pastas
const savedFolders = () => { try { return JSON.parse(store.get('driveFolders') || '[]'); } catch { return []; } };
let driveStack = [];
function renderSaved() {
  const box = $('#driveSaved'); box.innerHTML = '';
  savedFolders().forEach(f => {
    const b = document.createElement('button'); b.innerHTML = `📁 ${esc(f.title)}<span class="x" title="Remover">✕</span>`;
    b.onclick = e => {
      if (e.target.classList.contains('x')) { store.set('driveFolders', JSON.stringify(savedFolders().filter(x => x.id !== f.id))); return renderSaved(); }
      driveStack = []; openFolder(f.id);
    };
    box.appendChild(b);
  });
}
function openFolder(id, title) {
  const box = $('#driveList'); box.innerHTML = '<div class="loading">Carregando...</div>';
  api('/api/drive?id=' + encodeURIComponent(id)).then(({ title: t, items }) => {
    const idx = driveStack.findIndex(x => x.id === id);
    if (idx >= 0) driveStack = driveStack.slice(0, idx + 1); else driveStack.push({ id, title: t || title });
    if (driveStack.length === 1 && !savedFolders().find(x => x.id === id)) { store.set('driveFolders', JSON.stringify([{ id, title: t }, ...savedFolders()].slice(0, 12))); renderSaved(); }
    $('#drivePath').innerHTML = '';
    driveStack.forEach((f, i) => {
      if (i) $('#drivePath').append(' › ');
      const a = document.createElement('a'); a.textContent = f.title; a.onclick = () => openFolder(f.id); $('#drivePath').appendChild(a);
    });
    box.innerHTML = items.length ? '' : '<div class="loading">Pasta vazia (ou não é pública).</div>';
    items.sort((a, b) => b.folder - a.folder || a.name.localeCompare(b.name, 'pt', { numeric: true }));
    items.forEach(it => {
      const d = document.createElement('div'); d.className = 'it';
      d.innerHTML = `${it.folder ? '📁' : /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(it.name) ? '🎬' : '📄'}<span>${esc(it.name)}</span>${it.folder ? '›' : '▶'}`;
      d.onclick = () => it.folder ? openFolder(it.id, it.name) : playDrive(it.id, it.name.replace(/\.[^.]+$/, ''));
      box.appendChild(d);
    });
  }).catch(() => { box.innerHTML = '<div class="loading">Não consegui abrir. A pasta precisa estar como “Qualquer pessoa com o link”.</div>'; });
}
$('#driveForm').onsubmit = e => {
  e.preventDefault(); const u = $('#driveUrl').value.trim(); const id = driveId(u);
  if (!id) return toast('Link do Drive inválido');
  $('#driveUrl').value = '';
  if (/\/folders\//.test(u)) { driveStack = []; openFolder(id); } else playDrive(id);
};
renderSaved();

$('#linkGo').onclick = () => {
  const u = $('#linkUrl').value.trim(); if (!/^https?:\/\//.test(u)) return toast('Link inválido');
  $('#linkUrl').value = '';
  if (/youtu/.test(u) && ytId(u)) return playYT(ytId(u));
  if (/drive\.google/.test(u) && driveId(u)) {
    if (!/\/folders\//.test(u)) return playDrive(driveId(u));
    document.querySelector('[data-src=drive]').click(); driveStack = []; return openFolder(driveId(u));
  }
  socket.emit('media:set', { type: 'video', src: u, title: decodeURIComponent(u.split('/').pop().split('?')[0]) || 'Vídeo', kind: 'link' }); closeAdd();
};
$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) startFileStream(f); };
$('#screenGo').onclick = startScreenStream;

// ---------- PLAYER ----------
const vid = $('#vid');
let mode = null;          // 'youtube' | 'video' | 'stream' | null
let yt = null, ytReady = false, hls = null;
let suppressUntil = 0;
const suppressed = () => Date.now() < suppressUntil;
const suppress = (ms = 900) => { suppressUntil = Date.now() + ms; };

function loadYTApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (loadYTApi.p) return loadYTApi.p;
  return loadYTApi.p = new Promise(res => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
}

function unloadMedia() {
  mode = null; ytReady = false;
  if (yt) { try { yt.destroy(); } catch {} yt = null; $('#ytBox').innerHTML = '<div id="yt"></div>'; }
  if (hls) { hls.destroy(); hls = null; }
  if (!localStreamVideo) { vid.pause(); vid.removeAttribute('src'); vid.srcObject = null; vid.load(); }
  $('#ytBox').classList.add('hidden'); vid.classList.add('hidden'); $('#tapSync').classList.add('hidden');
  $('#empty').classList.remove('hidden'); $('#nowTitle').textContent = '';
}

function loadMedia(media, pb, recvAt) {
  closeViewerPc();
  if (!media || media.type !== 'stream' || media.by !== me) { if (localStreamVideo || localStream) stopStreaming(true); }
  unloadMedia();
  if (!media) return;
  $('#empty').classList.add('hidden');
  $('#nowTitle').textContent = '▶ ' + media.title;
  mode = media.type;
  if (mode === 'youtube') {
    $('#ytBox').classList.remove('hidden');
    loadYTApi().then(() => {
      if (mode !== 'youtube') return;
      yt = new YT.Player('yt', {
        videoId: media.src, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 0 },
        events: {
          onReady: () => { ytReady = true; const d = yt.getVideoData?.(); if (d?.title) $('#nowTitle').textContent = '▶ ' + d.title; resync(); },
          onStateChange: (e) => {
            if (e.data === 1) $('#tapSync').classList.add('hidden');
            if (suppressed()) return;
            if (e.data === 1 || e.data === 2) sendPlayback();
          },
        },
      });
    });
  } else if (mode === 'video') {
    vid.classList.remove('hidden'); vid.controls = true; vid.muted = false;
    if (/\.m3u8(\?|$)/i.test(media.src) && window.Hls?.isSupported()) { hls = new Hls(); hls.loadSource(media.src); hls.attachMedia(vid); }
    else vid.src = media.src;
    vid.onerror = () => toast(media.kind === 'drive' ? 'Não deu pra carregar do Drive. Confira se está público, ou use “Arquivo local”.' : 'Não foi possível carregar o vídeo', 5000);
    vid.addEventListener('loadedmetadata', () => applyPlayback(pb, recvAt), { once: true });
  } else if (mode === 'stream') {
    vid.classList.remove('hidden');
    if (media.by === me) { /* host já está com o vídeo local */ if (localStreamVideo) { if (vid.src !== localStreamVideo) { vid.srcObject = null; vid.src = localStreamVideo; } vid.controls = true; } else if (localStream) { vid.srcObject = localStream; vid.muted = true; vid.controls = false; vid.play().catch(() => {}); } }
    else { vid.controls = false; requestStream(); }
  }
}
socket.on('media', ({ media, streamer, playback }) => { if (!R) return; R.media = media; R.streamer = streamer; loadMedia(media, playback, Date.now()); });

// tempo/estado local
function getTime() { return mode === 'youtube' ? (ytReady ? yt.getCurrentTime() : 0) : vid.currentTime; }
function isPlaying() { return mode === 'youtube' ? (ytReady && [1, 3].includes(yt.getPlayerState())) : !vid.paused; }
function getRate() { return mode === 'youtube' ? (ytReady ? yt.getPlaybackRate() : 1) : vid.playbackRate; }

function sendPlayback(heartbeat = false) {
  if (!R || !R.media || mode === 'stream') return;
  if (!heartbeat && !canControl()) { resync(); return toast('Só o anfitrião controla o vídeo'); }
  socket.emit('playback', { playing: isPlaying(), time: getTime(), rate: getRate(), heartbeat });
}

function applyPlayback(pb, recvAt, force = false) {
  if (!pb || !mode || mode === 'stream') return;
  if (mode === 'youtube' && !ytReady) return;
  const target = pb.time + (pb.playing ? (Date.now() - recvAt) / 1000 * (pb.rate || 1) : 0);
  const diff = Math.abs(getTime() - target);
  if (diff > (force ? 0.4 : 1.2)) { suppress(); mode === 'youtube' ? yt.seekTo(target, true) : (vid.currentTime = target); }
  if (getRate() !== (pb.rate || 1)) { suppress(); mode === 'youtube' ? yt.setPlaybackRate(pb.rate || 1) : (vid.playbackRate = pb.rate || 1); }
  if (pb.playing && !isPlaying()) {
    suppress(1500);
    if (mode === 'youtube') { yt.playVideo(); setTimeout(() => { if (mode === 'youtube' && ytReady && yt.getPlayerState() !== 1 && yt.getPlayerState() !== 3) showTap(); }, 1500); }
    else vid.play().catch(showTap);
  } else if (!pb.playing && isPlaying()) { suppress(); mode === 'youtube' ? yt.pauseVideo() : vid.pause(); }
}
function showTap() { $('#tapSync').classList.remove('hidden'); }
$('#tapSync').onclick = () => {
  $('#tapSync').classList.add('hidden');
  if (mode === 'youtube' && ytReady) yt.playVideo(); else vid.play().catch(() => {});
  setTimeout(resync, 400);
};
function resync(force) { const t = Date.now(); socket.emit('sync:get', pb => applyPlayback(pb, t + 0, force)); }

socket.on('playback', pb => { if (!R) return; applyPlayback(pb, Date.now(), !pb.heartbeat); });

// eventos do <video>
['play', 'pause', 'seeked', 'ratechange'].forEach(ev => vid.addEventListener(ev, () => {
  if (ev === 'play') $('#tapSync').classList.add('hidden');
  if (mode !== 'video' || suppressed()) return;
  sendPlayback();
}));

// detector de "seek" no YouTube + heartbeat do anfitrião + correção de deriva
let lastT = null, lastAt = 0;
setInterval(() => {
  if (mode !== 'youtube' || !ytReady) { lastT = null; return; }
  const t = yt.getCurrentTime(), now = Date.now();
  if (lastT != null && !suppressed()) {
    const expected = lastT + (yt.getPlayerState() === 1 ? (now - lastAt) / 1000 * getRate() : 0);
    if (Math.abs(t - expected) > 2) sendPlayback();
  }
  lastT = t; lastAt = now;
}, 1000);
setInterval(() => {
  if (!R || !R.media || mode === 'stream' || !mode) return;
  if (isHost()) { if (isPlaying() && !suppressed()) sendPlayback(true); }
  else if (!suppressed()) resync();
}, 4000);

// ---------- STREAMING (WebRTC) ----------
let localStream = null, localStreamVideo = null; // host
const hostPcs = new Map(); // viewerId -> pc
let viewerPc = null;

function makeHostPc(viewerId) {
  hostPcs.get(viewerId)?.close();
  const pc = new RTCPeerConnection(ICE); hostPcs.set(viewerId, pc);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.getSenders().forEach(s => { if (s.track?.kind === 'video') { const p = s.getParameters(); p.encodings = p.encodings?.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = 6_000_000; s.setParameters(p).catch(() => {}); } });
  pc.onicecandidate = e => e.candidate && socket.emit('rtc:signal', { to: viewerId, data: { candidate: e.candidate } });
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) hostPcs.delete(viewerId); };
  pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('rtc:signal', { to: viewerId, data: { sdp: pc.localDescription } }));
}
socket.on('stream:stop', () => stopStreaming(true));
socket.on('rtc:want', viewerId => { if (localStream) makeHostPc(viewerId); });
socket.on('rtc:gone', id => { hostPcs.get(id)?.close(); hostPcs.delete(id); });

function requestStream() { socket.emit('rtc:want'); }
function closeViewerPc() { if (viewerPc) { viewerPc.close(); viewerPc = null; } }

socket.on('rtc:signal', async ({ from, data }) => {
  if (localStream && hostPcs.has(from)) { // sou o host
    const pc = hostPcs.get(from);
    if (data.sdp) await pc.setRemoteDescription(data.sdp);
    else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
    return;
  }
  if (!R || R.streamer !== from) return;
  if (data.sdp?.type === 'offer') {
    closeViewerPc();
    const pc = viewerPc = new RTCPeerConnection(ICE);
    pc.onicecandidate = e => e.candidate && socket.emit('rtc:signal', { to: from, data: { candidate: e.candidate } });
    pc.ontrack = e => {
      vid.srcObject = e.streams[0]; vid.muted = false;
      vid.play().catch(() => { showTap(); });
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') toast('Falha na conexão do streaming. Tentando de novo...'), setTimeout(requestStream, 1500); };
    await pc.setRemoteDescription(data.sdp);
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    socket.emit('rtc:signal', { to: from, data: { sdp: pc.localDescription } });
  } else if (data.candidate && viewerPc) await viewerPc.addIceCandidate(data.candidate).catch(() => {});
});

function startFileStream(file) {
  stopStreaming(true);
  const url = URL.createObjectURL(file);
  const v = vid;
  if (!(v.captureStream || v.mozCaptureStream)) return toast('Seu navegador não permite transmitir arquivo. Use Chrome/Edge/Firefox no PC.', 5000);
  closeAdd();
  // prepara o player local antes de avisar a sala
  unloadMedia(); localStreamVideo = url;
  $('#empty').classList.add('hidden'); v.classList.remove('hidden');
  v.srcObject = null; v.src = url; v.controls = true; v.muted = false;
  v.play().catch(() => {});
  v.addEventListener('loadedmetadata', () => {
    localStream = v.captureStream ? v.captureStream() : v.mozCaptureStream();
    // tracks podem mudar (áudio aparece depois): renegocia
    localStream.onaddtrack = () => [...hostPcs.keys()].forEach(makeHostPc);
    socket.emit('media:set', { type: 'stream', src: '', title: file.name.replace(/\.[^.]+$/, ''), kind: 'file' });
  }, { once: true });
}
async function startScreenStream() {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('Compartilhar tela só funciona no navegador do PC.', 4000);
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include' });
    stopStreaming(true); closeAdd();
    localStream = s;
    s.getVideoTracks()[0].contentHint = 'motion';
    s.getVideoTracks()[0].onended = () => { stopStreaming(); };
    if (!s.getAudioTracks().length) toast('Sem áudio: marque “Compartilhar áudio da aba”.', 5000);
    socket.emit('media:set', { type: 'stream', src: '', title: s.getVideoTracks()[0].label || 'Tela compartilhada', kind: 'screen' });
  } catch (e) { if (e.name !== 'NotAllowedError') toast('Não foi possível compartilhar: ' + e.message); }
}
function stopStreaming(silent) {
  const had = !!localStream;
  hostPcs.forEach(pc => pc.close()); hostPcs.clear();
  if (localStream && !localStreamVideo) localStream.getTracks().forEach(t => t.stop());
  localStream = null;
  if (localStreamVideo) { vid.pause(); URL.revokeObjectURL(localStreamVideo); localStreamVideo = null; vid.removeAttribute('src'); vid.load(); }
  if (had && !silent) socket.emit('stream:end');
}

// ---------- BOOT ----------
const m = location.pathname.match(/^\/r\/([\w-]+)/);
if (m) join(m[1].toUpperCase());
})();
