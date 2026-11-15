(() => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const socket = io();
const CID = (() => { try { let c = localStorage.getItem('cid'); if (!c) { c = crypto.randomUUID?.() || String(Math.random()).slice(2); localStorage.setItem('cid', c); } return c; } catch { return 'x' + Math.random(); } })();
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
  socket.emit('room:create', { cid: CID, name: $('#roomName').value || `Sala de ${nick}`, isPublic: visibility === 'public', password, everyoneControls: $('#everyone').checked }, ({ id }) => join(id, password));
};
$('#joinBtn').onclick = () => { const c = $('#joinCode').value.trim(); if (c) join(c); };
$('#joinCode').onkeydown = e => e.key === 'Enter' && $('#joinBtn').click();

function renderList(list) {
  const el = $('#roomList');
  el.innerHTML = list.length ? '' : '<div class="empty-list"><i data-lucide="popcorn"></i><p class="sm">Nenhuma sala aberta agora.<br>Crie a sua e chame a galera.</p></div>';
  list.sort((a, b) => b.users - a.users).forEach(r => {
    const d = document.createElement('div'); d.className = 'room-item'; d.tabIndex = 0;
    d.innerHTML = `<div class="ava"><i data-lucide="${r.title ? 'play' : 'clapperboard'}"></i></div><div class="meta"><b>${r.hasPassword ? '<i data-lucide="lock"></i>' : ''}${esc(r.name)}</b><small>${r.title ? esc(r.title) : 'Escolhendo o que assistir'}</small></div><span class="badge"><i data-lucide="users"></i>${r.users}</span>`;
    d.onclick = () => join(r.id); d.onkeydown = e => e.key === 'Enter' && join(r.id); el.appendChild(d);
  });
}
// ícones Lucide em elementos criados dinamicamente
let iconQ = 0;
const icons = () => { if (iconQ) return; iconQ = requestAnimationFrame(() => { iconQ = 0; try { lucide.createIcons(); } catch {} }); };
new MutationObserver(muts => { if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('[data-lucide]') || n.querySelector?.('[data-lucide]'))))) icons(); }).observe(document.body, { childList: true, subtree: true });
icons();
socket.on('rooms:list', renderList);
socket.emit('rooms:list', renderList);

// ---------- ROOM STATE ----------
let me = null, R = null; // R = room state
const isHost = () => R && R.hostId === me;
const canControl = () => R && (R.everyoneControls || isHost());

function join(id, password) {
  const nick = getNick(); if (!nick) return;
  socket.emit('room:join', { id, nick, password, cid: CID }, (res) => {
    if (res.needPassword) { const p = prompt(password ? 'Senha incorreta. Tente de novo:' : 'Sala com senha:'); if (p != null) join(id, p); return; }
    if (res.error) {
      toast(res.error === 'Sala não encontrada' ? 'Essa sala foi encerrada.' : res.error);
      if (!$('#room').classList.contains('hidden')) { stopStreaming(true); closeViewerPc(); unloadMedia(); R = null; $('#room').classList.add('hidden'); $('#home').classList.remove('hidden'); socket.emit('rooms:list', renderList); }
      if (location.pathname !== '/') history.replaceState(null, '', '/');
      return;
    }
    me = res.me; R = res.state; R._pw = password;
    if (location.pathname !== '/r/' + R.id) history.pushState(null, '', '/r/' + R.id);
    $('#home').classList.add('hidden'); $('#room').classList.remove('hidden');
    $('#msgs').innerHTML = ''; R.messages.forEach(addMsg);
    renderHeader(); renderUsers();
    loadMedia(R.media, R.playback, Date.now()); renderQual();
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
  $('#rSub').textContent = `${R.isPublic ? 'Aberta' : 'Privada'} · código ${R.id}${isHost() ? ' · você é o anfitrião' : ''}${R.everyoneControls ? '' : ' · só o anfitrião controla'}`;
  document.title = R.name + ' · Watch Party';
}
function renderUsers() {
  $('#pCount').textContent = R.users.length;
  $('#people').innerHTML = '';
  R.users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="av" style="background:${u.color}">${esc(u.name[0].toUpperCase())}</span><span class="nm">${esc(u.name)}${u.id === me ? ' <span class="muted">(você)</span>' : ''}</span>${u.id === R.hostId ? '<span class="badge"><i data-lucide="crown"></i>anfitrião</span>' : ''}`;
    if (isHost() && u.id !== me) { const b = document.createElement('button'); b.className = 'btn btn-outline btn-sm'; b.textContent = 'Tornar anfitrião'; b.onclick = () => socket.emit('host:transfer', u.id); li.appendChild(b); }
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
  $('#setHint').textContent = isHost() ? 'Você é o anfitrião.' : `Só o anfitrião (${R.users.find(u => u.id === R.hostId)?.name || '?'}) pode mudar.`;
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
    const onlyEmoji = m.text && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u.test(m.text);
    const content = m.sticker ? `<img class="stk" src="${esc(m.sticker)}" alt="figurinha" loading="lazy">` : `<div class="txt${onlyEmoji ? ' big' : ''}">${esc(m.text)}</div>`;
    d.innerHTML = `<span class="ava" style="background:${esc(m.color)}">${esc((m.name || '?')[0].toUpperCase())}</span><div class="body"><div class="who"><b>${esc(m.name)}</b><time>${t}</time></div>${content}</div>`;
    if (m.sticker) d.querySelector('img').onload = () => { if (atBottom || m.uid === me) box.scrollTop = box.scrollHeight; };
  }
  box.appendChild(d);
  while (box.children.length > 200) box.firstChild.remove();
  if (atBottom || m.uid === me) box.scrollTop = box.scrollHeight;
}
socket.on('chat', m => R && addMsg(m));
$('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) socket.emit('chat', v); $('#chatIn').value = ''; closePicker(); };

// ---- Emojis e figurinhas ----
const EMOJIS = {
  'Rostos': '😂🤣😅😊😍🥰😘😎🤩🥳😏😴🥱🤔🤨😐🙄😬😮😱😳🥺😭😢😤😡🤯🤬🤡💀👻🤢🤮😈🫠🫣🫡🤫🤭',
  'Gestos': '👍👎👏🙌🙏👀💪🤝✌️🤞👋🫶❤️🔥💯✨🎉💔💩',
  'Filme': '🍿🎬📺🎥🍕🍔🍟🥤🍺🍷☕🛋️🌙⚽🎮🎵',
};
const FLUENT = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/';
const STICKERS = ['Face with tears of joy', 'Rolling on the floor laughing', 'Smiling face with heart-eyes', 'Loudly crying face', 'Face screaming in fear', 'Exploding head', 'Skull', 'Ghost', 'Popcorn', 'Fire', 'Red heart', 'Clapping hands*', 'Thumbs up*', 'Party popper', 'Sleeping face', 'Yawning face', 'Thinking face', 'Face with rolling eyes', 'Pleading face', 'Smiling face with sunglasses', 'Zany face', 'Face vomiting', 'Clown face', 'Pile of poo', 'Hundred points', 'Eyes', 'Clapper board', 'Television', 'Pizza', 'Beer mug', 'Face holding back tears', 'Melting face']
  .map(n => { const tone = n.endsWith('*'), name = n.replace('*', ''), f = name.toLowerCase().replace(/ /g, '_'); return FLUENT + encodeURIComponent(name) + (tone ? `/Default/3D/${f}_3d_default.png` : `/3D/${f}_3d.png`); });
const myStickers = () => { try { return JSON.parse(store.get('stickers') || '[]'); } catch { return []; } };
const saveStickers = (a) => { try { localStorage.setItem('stickers', JSON.stringify(a)); return true; } catch { toast('Sem espaço para mais figurinhas. Apague algumas.'); return false; } };
let pickerTab = 'emoji';
function closePicker() { $('#picker')?.remove(); }
function sendSticker(src) { socket.emit('chat', { sticker: src }); closePicker(); }
function renderPicker() {
  let p = $('#picker');
  if (!p) {
    p = document.createElement('div'); p.id = 'picker'; p.className = 'picker';
    p.innerHTML = '<div class="tabs ptabs"><button data-p="emoji"><i data-lucide="smile"></i>Emojis</button><button data-p="sticker"><i data-lucide="sticker"></i>Figurinhas</button></div><div class="picker-body"></div>';
    p.querySelectorAll('.ptabs button').forEach(b => b.onclick = () => { pickerTab = b.dataset.p; renderPicker(); });
    $('#chatPane').appendChild(p);
  }
  p.querySelectorAll('.ptabs button').forEach(b => b.classList.toggle('on', b.dataset.p === pickerTab));
  const body = p.querySelector('.picker-body'); body.innerHTML = '';
  if (pickerTab === 'emoji') {
    for (const [cat, list] of Object.entries(EMOJIS)) {
      body.insertAdjacentHTML('beforeend', `<h4>${cat}</h4>`);
      const g = document.createElement('div'); g.className = 'emoji-grid';
      for (const e of list.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu)) {
        const b = document.createElement('button'); b.textContent = e; b.type = 'button';
        b.onclick = () => { const i = $('#chatIn'); const s = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, s) + e + i.value.slice(i.selectionEnd ?? s); i.focus(); i.selectionStart = i.selectionEnd = s + e.length; };
        g.appendChild(b);
      }
      body.appendChild(g);
    }
  } else {
    body.insertAdjacentHTML('beforeend', '<h4>Minhas figurinhas</h4>');
    const mine = document.createElement('div'); mine.className = 'sticker-grid';
    const add = document.createElement('label'); add.className = 'add'; add.tabIndex = 0;
    add.innerHTML = '<i data-lucide="image-plus"></i>Criar<input type="file" accept="image/*" hidden>';
    add.querySelector('input').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) makeSticker(f); };
    add.onkeydown = e => e.key === 'Enter' && add.querySelector('input').click();
    mine.appendChild(add);
    myStickers().forEach((src, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<img src="${esc(src)}" alt=""><span class="del" title="Apagar">✕</span>`;
      b.onclick = e => { if (e.target.classList.contains('del')) { const a = myStickers(); a.splice(i, 1); saveStickers(a); return renderPicker(); } sendSticker(src); };
      mine.appendChild(b);
    });
    body.appendChild(mine);
    body.insertAdjacentHTML('beforeend', '<h4>Prontas</h4>');
    const g = document.createElement('div'); g.className = 'sticker-grid';
    STICKERS.forEach(src => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<img loading="lazy" src="${src}" alt="">`; b.onclick = () => sendSticker(src); g.appendChild(b); });
    body.appendChild(g);
  }
}
// cria figurinha: recorta quadrado, 256px, WebP (GIF pequeno vai como está, animado)
function makeSticker(file) {
  const done = (src) => { const a = myStickers(); a.unshift(src); if (saveStickers(a.slice(0, 40))) { renderPicker(); toast('Figurinha criada! Toque nela para enviar.'); } };
  if (file.type === 'image/gif' && file.size < 400e3) { const r = new FileReader(); r.onload = () => done(r.result); r.readAsDataURL(file); return; }
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const k = Math.min(img.width, img.height), sx = (img.width - k) / 2, sy = (img.height - k) / 2;
    c.getContext('2d').drawImage(img, sx, sy, k, k, 0, 0, S, S);
    URL.revokeObjectURL(url);
    let src = c.toDataURL('image/webp', 0.82); if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
    if (src.length > 180e3) src = c.toDataURL('image/jpeg', 0.7);
    done(src);
  };
  img.onerror = () => toast('Não consegui ler essa imagem');
  img.src = url;
}
$('#pickBtn').onclick = (e) => { e.preventDefault(); $('#picker') ? closePicker() : renderPicker(); };
document.addEventListener('click', e => { if ($('#picker') && e.target.isConnected && !e.target.closest('#picker,#pickBtn')) closePicker(); });

$$('.side > .tabs button').forEach(b => b.onclick = () => {
  $$('.side > .tabs button').forEach(x => x.classList.toggle('on', x === b));
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
  ytFirstLoad();
});
// fechar modais: botão X, clique fora ou Esc (delegado, funciona em qualquer navegador)
document.addEventListener('click', e => {
  const x = e.target.closest?.('[data-close]');
  if (x) { x.closest('.modal')?.classList.add('hidden'); return; }
  if (e.target.classList?.contains('modal')) e.target.classList.add('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal:not(.hidden)').forEach(m => m.classList.add('hidden')); });
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

// YouTube: busca, canais, categorias e conta Google
const CHIPS = [
  ['Filmes completos', 'filme completo dublado', 'long'], ['Lançamentos', 'filme lançamento 2026 completo dublado', 'long'],
  ['Comédia', 'filme de comédia completo dublado', 'long'], ['Ação', 'filme de ação completo dublado', 'long'],
  ['Terror', 'filme de terror completo dublado', 'long'], ['Desenhos', 'desenho animado completo dublado', 'long'],
  ['Trailers', 'trailer oficial dublado 2026', 'video'], ['Música', 'clipes mais tocados brasil', 'video'],
  ['Futebol', 'melhores momentos futebol', 'video'], ['Ao vivo', 'ao vivo agora', 'live'],
];
let ytLast = null;
const ytBox = () => $('#ytResults');
const setChip = (chip) => $$('#ytChips button').forEach(b => b.classList.toggle('on', b === chip));
const fmtDate = (d) => { if (!d) return ''; const s = (Date.now() - new Date(d)) / 1000; return s < 3600 ? `há ${Math.max(1, s / 60 | 0)} min` : s < 86400 ? `há ${s / 3600 | 0} h` : s < 86400 * 30 ? `há ${s / 86400 | 0} d` : new Date(d).toLocaleDateString('pt-BR'); };
const isoDur = (p) => { const m = String(p || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return ''; const [h, mi, s] = [m[1] | 0, m[2] | 0, m[3] | 0]; return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(s).padStart(2, '0'); };

async function ytTask(key, fn) {
  ytLast = key; ytBox().innerHTML = '<div class="loading">Carregando...</div>';
  let items, err;
  for (let k = 0; k < 3; k++) { try { items = await fn(); break; } catch (e) { err = e; if (key !== ytLast) return; await new Promise(r => setTimeout(r, 2500)); } }
  if (key !== ytLast) return;
  if (!items) return ytBox().innerHTML = `<div class="loading">${esc(err?.message === 'login' ? 'Sua sessão do Google expirou. Entre de novo.' : 'Não deu pra carregar agora. Tente de novo.')}</div>`;
  renderVideos(items);
}
function renderVideos(items, header) {
  const box = ytBox(); box.innerHTML = '';
  if (header) box.appendChild(header);
  if (!items.length) box.insertAdjacentHTML('beforeend', '<div class="loading">Nada encontrado.</div>');
  items.forEach(v => {
    const d = document.createElement('div');
    if (v.type === 'channel') {
      d.className = 'vcard chan';
      d.innerHTML = `<div class="th"><img loading="lazy" src="${esc(v.thumb)}" alt=""></div><div class="info"><b>${esc(v.title)}</b><small>Canal${v.subs ? ' · ' + esc(v.subs) : ''}</small></div>`;
      d.onclick = () => openChannel(v.id, v.title);
    } else if (v.type === 'playlist') {
      d.className = 'vcard';
      d.innerHTML = `<div class="th"><img loading="lazy" src="${esc(v.thumb)}" alt=""><span class="dur">${v.count ?? ''} vídeos</span></div><div class="info"><b>${esc(v.title)}</b><small>Playlist</small></div>`;
      d.onclick = () => openPlaylist(v.id, v.title);
    } else {
      d.className = 'vcard';
      const badge = v.duration ? `<span class="dur">${esc(v.duration)}</span>` : v.live ? '<span class="dur live">AO VIVO</span>' : '';
      d.innerHTML = `<div class="th"><img loading="lazy" src="${esc(v.thumb)}" alt="">${badge}</div><div class="info"><b>${esc(v.title)}</b><small>${v.channelId ? `<a data-ch="${esc(v.channelId)}">${esc(v.channel || '')}</a>` : esc(v.channel || '')}${v.views ? ' · ' + esc(v.views) : ''}${v.published ? ' · ' + fmtDate(v.published) : ''}</small></div>`;
      d.onclick = (e) => { const a = e.target.closest('[data-ch]'); if (a) return openChannel(a.dataset.ch, a.textContent); playYT(v.id, v.title); };
    }
    box.appendChild(d);
  });
}
const backHeader = (title, back) => {
  const h = document.createElement('div'); h.className = 'gridhead';
  h.innerHTML = `<button class="btn btn-outline btn-sm"><i data-lucide="arrow-left"></i>Voltar</button><b>${esc(title)}</b>`;
  h.querySelector('button').onclick = back; return h;
};
let lastList = null;
function ytLoad(q, f = 'video', chip) {
  setChip(chip);
  ytTask(q + f, () => api(`/api/yt?q=${encodeURIComponent(q)}&f=${f}`)).then(() => { lastList = () => ytLoad(q, f, chip); });
}
function openChannel(id, title) {
  const back = lastList; const key = 'ch' + id; ytLast = key;
  ytBox().innerHTML = '<div class="loading">Carregando canal...</div>';
  api('/api/ytchannel?id=' + id).then(d => { if (ytLast === key) renderVideos(d.items.map(v => ({ ...v, channelId: null })), backHeader(d.title || title, () => back ? back() : ytLoad('filme completo dublado', 'long'))); })
    .catch(() => { if (ytLast === key) ytBox().innerHTML = '<div class="loading">Não consegui abrir o canal.</div>'; });
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
function ytFirstLoad() {
  if (ytLast) return;
  if (gToken()) $('#ytChips [data-me=subs]')?.click(); else $('#ytChips button:not([data-me])').click();
}

// ---- Conta Google (feed próprio) ----
let gClientId = null, gTokenClient = null;
const gToken = () => { try { const t = JSON.parse(sessionStorage.getItem('gtok') || 'null'); return t && t.exp > Date.now() ? t.v : null; } catch { return null; } };
async function gapi(path, params = {}) {
  const t = gToken(); if (!t) throw new Error('login');
  const r = await fetch('https://www.googleapis.com/youtube/v3/' + path + '?' + new URLSearchParams(params), { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401) { try { sessionStorage.removeItem('gtok'); } catch {} renderAcct(); throw new Error('login'); }
  if (!r.ok) throw new Error('api');
  return r.json();
}
const thumbOf = (sn) => sn?.thumbnails?.medium?.url || sn?.thumbnails?.default?.url || '';
async function mySubs() {
  let ids = [], page = '';
  for (let k = 0; k < 4; k++) {
    const d = await gapi('subscriptions', { part: 'snippet', mine: 'true', maxResults: 50, order: 'relevance', ...(page && { pageToken: page }) });
    ids.push(...d.items.map(i => ({ id: i.snippet.resourceId.channelId, title: i.snippet.title, thumb: thumbOf(i.snippet) })));
    page = d.nextPageToken; if (!page) break;
  }
  return ids;
}
let subsCache = null;
const loaders = {
  subs: async () => {
    subsCache = subsCache || await mySubs();
    if (!subsCache.length) return [];
    const feed = await fetch('/api/ytfeed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: subsCache.map(s => s.id) }) }).then(r => r.ok ? r.json() : Promise.reject(new Error('feed')));
    return feed.filter(v => !v.short).map(v => ({ ...v, channelId: subsCache.find(s => s.title === v.channel)?.id }));
  },
  channels: async () => { subsCache = subsCache || await mySubs(); return subsCache.map(s => ({ type: 'channel', ...s })); },
  liked: async () => {
    const d = await gapi('videos', { part: 'snippet,contentDetails', myRating: 'like', maxResults: 50 });
    return d.items.map(v => ({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, channelId: v.snippet.channelId, thumb: thumbOf(v.snippet), duration: isoDur(v.contentDetails?.duration) }));
  },
  playlists: async () => {
    const d = await gapi('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50 });
    return d.items.map(p => ({ type: 'playlist', id: p.id, title: p.snippet.title, thumb: thumbOf(p.snippet), count: p.contentDetails?.itemCount }));
  },
};
async function openPlaylist(id, title) {
  const back = lastList; const key = 'pl' + id; ytLast = key;
  ytBox().innerHTML = '<div class="loading">Carregando playlist...</div>';
  try {
    const d = await gapi('playlistItems', { part: 'snippet', playlistId: id, maxResults: 50 });
    if (ytLast !== key) return;
    renderVideos(d.items.filter(i => i.snippet.resourceId?.videoId && thumbOf(i.snippet)).map(i => ({ id: i.snippet.resourceId.videoId, title: i.snippet.title, channel: i.snippet.videoOwnerChannelTitle, channelId: i.snippet.videoOwnerChannelId, thumb: thumbOf(i.snippet) })), backHeader(title, () => back && back()));
  } catch { if (ytLast === key) ytBox().innerHTML = '<div class="loading">Não consegui abrir a playlist.</div>'; }
}
const ME_CHIPS = [['subs', 'Inscrições', 'rss'], ['channels', 'Meus canais', 'user'], ['liked', 'Curtidos', 'thumbs-up'], ['playlists', 'Playlists', 'list-video']];
function renderAcct() {
  const box = $('#ytAcct');
  $$('#ytChips [data-me]').forEach(b => b.remove());
  if (!gClientId) { box.innerHTML = ''; return; }
  if (gToken()) {
    box.innerHTML = '<span class="badge"><i data-lucide="check"></i>Conectado ao YouTube</span><button class="btn btn-ghost btn-sm" id="gOut">Sair</button>';
    $('#gOut').onclick = () => { try { google.accounts.oauth2.revoke(gToken()); sessionStorage.removeItem('gtok'); } catch {} subsCache = null; renderAcct(); ytLast = null; ytFirstLoad(); };
    [...ME_CHIPS].reverse().forEach(([k, label, ic]) => {
      const b = document.createElement('button'); b.dataset.me = k; b.innerHTML = `<i data-lucide="${ic}"></i>${label}`; b.className = 'me';
      b.onclick = () => { setChip(b); $('#ytQ').value = ''; ytTask('me' + k, loaders[k]).then(() => { lastList = () => b.click(); }); };
      $('#ytChips').prepend(b);
    });
  } else {
    box.innerHTML = '<button class="gbtn" id="gIn"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Entrar com Google para ver seu feed</button>';
    $('#gIn').onclick = gLogin;
  }
}
function gLogin() {
  if (!window.google?.accounts?.oauth2) return toast('Carregando login do Google, tente de novo em 2s');
  gTokenClient = gTokenClient || google.accounts.oauth2.initTokenClient({
    client_id: gClientId, scope: 'https://www.googleapis.com/auth/youtube.readonly',
    callback: (r) => {
      if (!r.access_token) return toast('Login cancelado');
      try { sessionStorage.setItem('gtok', JSON.stringify({ v: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 })); } catch {}
      subsCache = null; renderAcct(); $('#ytChips [data-me=subs]').click();
    },
  });
  gTokenClient.requestAccessToken();
}
fetch('/api/config').then(r => r.json()).then(c => {
  gClientId = c.googleClientId; if (!gClientId) return;
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; document.head.appendChild(s);
  renderAcct();
}).catch(() => {});

// Streaming: atalhos
const SI = (n) => `https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/${n}.svg`;
const FAV = (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;
const SERVICES = [
  ['Netflix', 'https://www.netflix.com/browse', '#000', SI('netflix'), '#e50914'],
  ['Prime Video', 'https://www.primevideo.com', '#0f171e', SI('primevideo'), '#fff'],
  ['Disney+', 'https://www.disneyplus.com', '#0e1846', FAV('disneyplus.com')],
  ['Max', 'https://play.max.com', '#002be7', SI('max'), '#fff'],
  ['Globoplay', 'https://globoplay.globo.com', '#fb0234', FAV('globoplay.globo.com')],
  ['Apple TV+', 'https://tv.apple.com', '#000', SI('appletv'), '#fff'],
  ['Paramount+', 'https://www.paramountplus.com/br/', '#0064ff', SI('paramountplus'), '#fff'],
  ['Crunchyroll', 'https://www.crunchyroll.com', '#f47521', SI('crunchyroll'), '#fff'],
  ['Pluto TV', 'https://pluto.tv/br', '#111', FAV('pluto.tv')],
  ['Twitch', 'https://www.twitch.tv', '#9146ff', SI('twitch'), '#fff'],
  ['Mercado Play', 'https://play.mercadolivre.com.br', '#ffe600', FAV('mercadolivre.com.br'), null, '#2d3277'],
  ['Kick', 'https://kick.com', '#0b0e0f', SI('kick'), '#53fc18'],
];
SERVICES.forEach(([n, u, bg, logo, tint, fg]) => {
  const b = document.createElement('button'); b.className = 'svc'; b.style.background = bg; if (fg) b.style.color = fg;
  const img = tint
    ? `<span class="si" style="background:${tint};-webkit-mask:url(${logo}) center/contain no-repeat;mask:url(${logo}) center/contain no-repeat"></span>`
    : `<img class="fav" src="${logo}" alt="">`;
  b.innerHTML = `${img}<span>${n}</span>`;
  b.onclick = () => { window.open(u, '_blank'); toast('Entre na sua conta, dê play e volte aqui para transmitir a aba', 5000); };
  $('#services').appendChild(b);
});

// Google Drive: pastas
const savedFolders = () => { try { return JSON.parse(store.get('driveFolders') || '[]'); } catch { return []; } };
let driveStack = [];
function renderSaved() {
  const box = $('#driveSaved'); box.innerHTML = '';
  savedFolders().forEach(f => {
    const b = document.createElement('button'); b.innerHTML = `<i data-lucide="folder"></i>${esc(f.title)}<span class="x" title="Remover">✕</span>`;
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
      d.innerHTML = `<i data-lucide="${it.folder ? 'folder' : /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(it.name) ? 'film' : 'file'}"></i><span>${esc(it.name)}</span><i data-lucide="${it.folder ? 'chevron-right' : 'play'}"></i>`;
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
const suppress = (ms = 1600) => { suppressUntil = Date.now() + ms; };

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
  $('#nowTitle').innerHTML = '<span class="dot-live"></span>' + esc(media.title);
  mode = media.type;
  if (mode === 'youtube') {
    $('#ytBox').classList.remove('hidden');
    loadYTApi().then(() => {
      if (mode !== 'youtube') return;
      yt = new YT.Player('yt', {
        videoId: media.src, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 0 },
        events: {
          onReady: () => { ytReady = true; const d = yt.getVideoData?.(); if (d?.title) $('#nowTitle').innerHTML = '<span class="dot-live"></span>' + esc(d.title); resync(); },
          onStateChange: (e) => {
            if (e.data === 1) $('#tapSync').classList.add('hidden');
            if (e.data !== 1 && e.data !== 2) return;
            if (isEcho(e.data === 1)) return;
            sendPlayback();
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
    else { vid.controls = true; requestStream(); }
  }
}
socket.on('media', ({ media, streamer, playback }) => { if (!R) return; R.media = media; R.streamer = streamer; $('#qualSel').dataset.v = 'auto'; loadMedia(media, playback, Date.now()); renderQual(); });

// tempo/estado local
function getTime() { return mode === 'youtube' ? (ytReady ? yt.getCurrentTime() : 0) : vid.currentTime; }
function isPlaying() { return mode === 'youtube' ? (ytReady && [1, 3].includes(yt.getPlayerState())) : !vid.paused; }
function getRate() { return mode === 'youtube' ? (ytReady ? yt.getPlaybackRate() : 1) : vid.playbackRate; }

function sendPlayback(heartbeat = false) {
  if (!R || !R.media || mode === 'stream') return;
  if (!heartbeat && !canControl()) { resync(); if (Date.now() - (sendPlayback.warned || 0) > 15000) { sendPlayback.warned = Date.now(); toast('Só o anfitrião controla o vídeo'); } return; }
  socket.emit('playback', { playing: isPlaying(), time: getTime(), rate: getRate(), heartbeat });
}

let appliedPlaying = null;
// ignora só o eco das nossas próprias correções; ação real do usuário (estado diferente) passa
const isEcho = (playing) => suppressed() && (playing === undefined || playing === appliedPlaying);
function applyPlayback(pb, recvAt, force = false) {
  if (!pb || !mode || mode === 'stream') return;
  if (mode === 'youtube' && !ytReady) return;
  appliedPlaying = !!pb.playing;
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
  if (mode !== 'video') return;
  if (isEcho(ev === 'play' ? true : ev === 'pause' ? false : undefined)) return;
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

// ---- Qualidade da transmissão ----
const QUAL = { auto: null, '1080': { h: 1080, br: 4_500_000 }, '720': { h: 720, br: 2_200_000 }, '480': { h: 480, br: 1_000_000 }, '360': { h: 360, br: 550_000 } };
let hostQual = (() => { try { return localStorage.getItem('hostQual') || 'auto'; } catch { return 'auto'; } })();
const viewerQual = new Map(); // viewerId -> qualidade pedida pelo convidado
function applyQuality(viewerId) {
  const pc = hostPcs.get(viewerId); if (!pc) return;
  // vale a menor entre a do anfitrião e a pedida pelo convidado
  const order = ['360', '480', '720', '1080'];
  const vq = viewerQual.get(viewerId), hq = hostQual === 'auto' ? '1080' : hostQual;
  const q = QUAL[vq && vq !== 'auto' && order.indexOf(vq) < order.indexOf(hq) ? vq : hq];
  pc.getSenders().forEach(snd => {
    if (snd.track?.kind !== 'video') return;
    const p = snd.getParameters(); p.encodings = p.encodings?.length ? p.encodings : [{}];
    const th = snd.track.getSettings().height || q.h;
    p.encodings[0].maxBitrate = q.br; p.encodings[0].maxFramerate = 30;
    p.encodings[0].scaleResolutionDownBy = Math.max(1, th / q.h);
    p.degradationPreference = 'balanced';
    snd.setParameters(p).catch(() => {});
  });
}
function renderQual() {
  const sel = $('#qualSel'); if (!sel) return;
  const streamingMine = mode === 'stream' && localStream, watching = mode === 'stream' && !localStream;
  sel.classList.toggle('hidden', !(streamingMine || watching));
  sel.title = streamingMine ? 'Qualidade que você envia' : 'Qualidade que você recebe';
  sel.value = streamingMine ? hostQual : (sel.dataset.v || 'auto');
}
$('#qualSel').onchange = e => {
  const v = e.target.value;
  if (localStream) { hostQual = v; try { localStorage.setItem('hostQual', v); } catch {} hostPcs.forEach((_, id) => applyQuality(id)); toast('Qualidade da transmissão: ' + (v === 'auto' ? 'automática' : v + 'p')); }
  else if (R?.streamer) { e.target.dataset.v = v; socket.emit('rtc:signal', { to: R.streamer, data: { quality: v } }); toast('Qualidade: ' + (v === 'auto' ? 'automática' : v + 'p')); }
};

function makeHostPc(viewerId) {
  hostPcs.get(viewerId)?.close();
  const pc = new RTCPeerConnection(ICE); hostPcs.set(viewerId, pc);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => e.candidate && socket.emit('rtc:signal', { to: viewerId, data: { candidate: e.candidate } });
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) hostPcs.delete(viewerId); };
  pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => { socket.emit('rtc:signal', { to: viewerId, data: { sdp: pc.localDescription } }); applyQuality(viewerId); });
  pc.addEventListener('connectionstatechange', () => pc.connectionState === 'connected' && applyQuality(viewerId));
}
socket.on('stream:stop', () => stopStreaming(true));
socket.on('rtc:want', viewerId => { if (localStream) makeHostPc(viewerId); });
socket.on('rtc:gone', id => { hostPcs.get(id)?.close(); hostPcs.delete(id); viewerQual.delete(id); });

function requestStream() { socket.emit('rtc:want'); }
function closeViewerPc() { if (viewerPc) { viewerPc.close(); viewerPc = null; } }

socket.on('rtc:signal', async ({ from, data }) => {
  if (localStream && hostPcs.has(from)) { // sou o host
    const pc = hostPcs.get(from);
    if (data.quality && (data.quality in QUAL)) { viewerQual.set(from, data.quality); applyQuality(from); return; }
    if (data.sdp) await pc.setRemoteDescription(data.sdp).catch(() => {});
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
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && pc === viewerPc) { toast('Falha na conexão da transmissão. Tentando de novo...'); setTimeout(() => { if (pc === viewerPc && mode === 'stream' && R?.streamer === from) requestStream(); }, 1500); } };
    try {
      await pc.setRemoteDescription(data.sdp); if (pc !== viewerPc) return;
      const ans = await pc.createAnswer(); if (pc !== viewerPc) return;
      await pc.setLocalDescription(ans); if (pc !== viewerPc) return;
      socket.emit('rtc:signal', { to: from, data: { sdp: pc.localDescription } });
    } catch (e) { console.warn(e); }
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
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include' });
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

// ---------- APP INSTALÁVEL ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
let installEvt = null;
// de onde o app foi aberto (instalador Android/Windows passam ?source=...&v=...)
const qs = new URLSearchParams(location.search);
try { if (qs.get('source')) sessionStorage.setItem('appSrc', JSON.stringify({ s: qs.get('source'), v: +qs.get('v') || 0 })); } catch {}
const appSrc = (() => { try { return JSON.parse(sessionStorage.getItem('appSrc') || 'null'); } catch { return null; } })();
if (qs.get('source')) history.replaceState(null, '', location.pathname);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone || (appSrc && appSrc.s !== 'app');
if (!standalone) $('#installBtn').classList.remove('hidden');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { $('#installBtn').classList.add('hidden'); toast('App instalado!'); });

const UA = navigator.userAgent, isIOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && 'ontouchend' in document), isAndroid = /Android/.test(UA);
const device = isIOS ? 'ios' : isAndroid ? 'android' : 'pc';
function installHelp(msg) { $('#installMsg').textContent = msg; $('#installModal').classList.remove('hidden'); }
function installPC() {
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(r => { if (r.outcome === 'accepted') toast('App instalado!'); }); installEvt = null; return; }
  // navegador sem instalação de app (Opera, Firefox, Safari...): baixa um atalho com o ícone do Watch Party
  const mac = /Macintosh|Mac OS X/.test(UA), linux = /Linux/.test(UA) && !isAndroid;
  if (device === 'pc') location.href = '/downloads/' + (mac ? 'WatchParty-Mac.zip' : 'WatchParty-PC.zip');
  installHelp(device !== 'pc' ? `No computador, abra ${location.host} e clique em “Baixar app” → Computador.`
    : mac ? 'Baixou o WatchParty-Mac.zip. Abra ele e arraste o “Watch Party” para a Mesa ou para o Dock.'
    : 'Baixou o WatchParty-PC.zip. Abra ele e arraste o “Watch Party” para a área de trabalho. Pronto: é só abrir por ali.');
}
const INSTALL_OPTS = [
  { k: 'android', icon: 'smartphone', title: 'Android e Android TV', sub: 'Baixar .apk', run: () => { location.href = '/downloads/WatchParty.apk'; toast('Abra o arquivo baixado e permita instalar. Se pedir, libere “instalar apps desconhecidos”.', 7000); } },
  { k: 'pc', icon: 'laptop', title: 'Computador', sub: 'Windows, Mac ou Linux', run: installPC },
  { k: 'ios', icon: 'tablet-smartphone', title: 'iPhone e iPad', sub: 'Pela tela de início', run: () => installHelp(/CriOS|FxiOS|OPT\//.test(UA) || !isIOS ? 'No iPhone, abra este site no Safari, toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”. A Apple não permite baixar apps fora da App Store.' : 'Toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”. A Apple não permite baixar apps fora da App Store.') },
];
function closeInstallMenu() { $('#installMenu')?.remove(); }
$('#installBtn').onclick = (e) => {
  e.stopPropagation();
  if ($('#installMenu')) return closeInstallMenu();
  const m = document.createElement('div'); m.id = 'installMenu'; m.className = 'menu'; m.setAttribute('role', 'menu');
  [...INSTALL_OPTS].sort((a, b) => (b.k === device) - (a.k === device)).forEach(o => {
    const b = document.createElement('button'); b.setAttribute('role', 'menuitem');
    b.innerHTML = `<i data-lucide="${o.icon}"></i><span><b>${o.title}</b><small>${o.sub}</small></span>${o.k === device ? '<span class="badge">este aparelho</span>' : ''}`;
    b.onclick = () => { closeInstallMenu(); o.run(); };
    m.appendChild(b);
  });
  $('#installBtn').parentElement.appendChild(m);
  m.querySelector('button').focus();
};
document.addEventListener('click', e => { if (!e.target.closest('#installMenu')) closeInstallMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInstallMenu(); });

// ---------- AVISO DE ATUALIZAÇÃO ----------
let webBuild = null;
function updateBanner(text, label, act) {
  if ($('#updBar')) return;
  const d = document.createElement('div'); d.id = 'updBar'; d.className = 'updbar';
  d.innerHTML = `<i data-lucide="sparkles"></i><span>${text}</span><button class="btn btn-primary btn-sm">${label}</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Fechar"><i data-lucide="x"></i></button>`;
  const [go, close] = d.querySelectorAll('button'); go.onclick = act; close.onclick = () => d.remove();
  document.body.appendChild(d);
}
function checkUpdate() {
  fetch('/api/version', { cache: 'no-store' }).then(r => r.json()).then(v => {
    if (appSrc?.s === 'android' && v.android > appSrc.v) updateBanner('Nova versão do app disponível.', 'Baixar', () => { location.href = '/downloads/WatchParty.apk'; });
    if (webBuild && v.web !== webBuild) updateBanner('O Watch Party foi atualizado.', 'Atualizar', () => location.reload());
    webBuild = webBuild || v.web;
  }).catch(() => {});
}
checkUpdate(); setInterval(checkUpdate, 10 * 60e3);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkUpdate());

// ---------- BOOT ----------
const m = location.pathname.match(/^\/r\/([\w-]+)/);
if (m) join(m[1].toUpperCase());
})();
