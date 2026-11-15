const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { ytSearch, driveFolder, ytChannel, ytFeed } = require('./yt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/yt', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 120).trim();
  if (!q) return res.json([]);
  try { res.json(await ytSearch(q, String(req.query.f || ''))); } catch (e) { res.status(502).json({ error: 'busca falhou' }); }
});
app.get('/api/config', (_, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));
app.get('/api/ytchannel', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^UC[\w-]{22}$/.test(id)) return res.status(400).json({ error: 'id inválido' });
  try { res.json(await ytChannel(id)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/ytfeed', express.json({ limit: '50kb' }), async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(x => /^UC[\w-]{22}$/.test(x)).slice(0, 200);
  try { res.json(await ytFeed(ids)); } catch (e) { res.status(502).json({ error: 'feed falhou' }); }
});
app.get('/api/drive', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[\w-]{10,}$/.test(id)) return res.status(400).json({ error: 'id inválido' });
  try { res.json(await driveFolder(id)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/r/:id', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = new Map();
const COLORS = ['#ff5c8a', '#5cc8ff', '#ffd25c', '#7dff8a', '#c38bff', '#ff9a5c', '#5cffe1', '#ff6bd6'];

const newId = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function currentTime(r) {
  const p = r.playback;
  return p.playing ? p.time + (Date.now() - p.ts) / 1000 * p.rate : p.time;
}
function snapshot(r) {
  return {
    id: r.id, name: r.name, isPublic: r.isPublic, hostId: r.hostId,
    everyoneControls: r.everyoneControls, streamer: r.streamer,
    media: r.media,
    playback: { ...r.playback, time: currentTime(r), ts: Date.now() },
    users: [...r.users.entries()].map(([id, u]) => ({ id, ...u })),
    messages: r.messages,
  };
}
function publicList() {
  return [...rooms.values()].filter(r => r.isPublic).map(r => ({
    id: r.id, name: r.name, users: r.users.size,
    title: r.media?.title || null, hasPassword: !!r.password,
  }));
}
const broadcastList = () => io.emit('rooms:list', publicList());
const pushUsers = (r) => io.to(r.id).emit('room:users', { users: snapshot(r).users, hostId: r.hostId });
function sysMsg(r, text) {
  const m = { id: newId() + Date.now(), sys: true, text, at: Date.now() };
  r.messages.push(m); if (r.messages.length > 150) r.messages.shift();
  io.to(r.id).emit('chat', m);
}
const canControl = (r, sid) => r.everyoneControls || r.hostId === sid;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

io.on('connection', (socket) => {
  let room = null;

  socket.on('rooms:list', (cb) => typeof cb === 'function' && cb(publicList()));

  socket.on('room:create', (d, cb) => {
    if (typeof cb !== 'function') return;
    let id; do { id = newId(); } while (rooms.has(id));
    rooms.set(id, {
      id, name: clean(d?.name, 60) || 'Sala', isPublic: !!d?.isPublic,
      password: d?.password ? hash(d.password) : null,
      everyoneControls: d?.everyoneControls !== false,
      hostId: null, streamer: null, users: new Map(), messages: [],
      media: null, playback: { playing: false, time: 0, ts: Date.now(), rate: 1 },
      emptySince: Date.now(),
    });
    cb({ id });
    broadcastList();
  });

  socket.on('room:join', (d, cb) => {
    if (typeof cb !== 'function') return;
    const r = rooms.get(clean(d?.id, 10).toUpperCase());
    if (!r) return cb({ error: 'Sala não encontrada' });
    if (r.password && hash(d?.password || '') !== r.password) return cb({ error: 'senha', needPassword: true });
    if (room) leave();
    room = r;
    socket.join(r.id);
    const name = clean(d?.nick, 24) || 'Convidado';
    r.users.set(socket.id, { name, color: COLORS[r.users.size % COLORS.length] });
    if (!r.hostId) r.hostId = socket.id;
    r.emptySince = null;
    cb({ ok: true, me: socket.id, state: snapshot(r) });
    pushUsers(r);
    sysMsg(r, `${name} entrou`);
    broadcastList();
  });

  socket.on('chat', (text) => {
    if (!room) return;
    const u = room.users.get(socket.id); if (!u) return;
    const t = clean(text, 500); if (!t) return;
    const m = { id: newId() + Date.now(), uid: socket.id, name: u.name, color: u.color, text: t, at: Date.now() };
    room.messages.push(m); if (room.messages.length > 150) room.messages.shift();
    io.to(room.id).emit('chat', m);
  });

  socket.on('react', (emoji) => {
    if (!room) return;
    const e = clean(emoji, 8); if (!e) return;
    io.to(room.id).emit('react', { emoji: e, uid: socket.id });
  });

  socket.on('media:set', (m) => {
    if (!room || !canControl(room, socket.id)) return;
    const type = ['youtube', 'video', 'stream'].includes(m?.type) ? m.type : null;
    if (!type) return;
    if (room.streamer && room.streamer !== socket.id) io.to(room.streamer).emit('stream:stop');
    room.media = { type, src: clean(m.src, 2000), title: clean(m.title, 120) || 'Vídeo', by: socket.id, kind: clean(m.kind, 20) };
    room.streamer = type === 'stream' ? socket.id : null;
    room.playback = { playing: false, time: 0, ts: Date.now(), rate: 1 };
    io.to(room.id).emit('media', { media: room.media, streamer: room.streamer, playback: room.playback });
    sysMsg(room, `${room.users.get(socket.id)?.name} colocou: ${room.media.title}`);
    broadcastList();
  });

  socket.on('playback', (p) => {
    if (!room || !room.media || room.media.type === 'stream') return;
    const isHeartbeat = p?.heartbeat;
    if (isHeartbeat ? socket.id !== room.hostId : !canControl(room, socket.id)) return;
    const time = Number(p?.time); if (!isFinite(time) || time < 0) return;
    room.playback = { playing: !!p.playing, time, ts: Date.now(), rate: Number(p.rate) > 0 ? Math.min(Number(p.rate), 4) : 1 };
    socket.to(room.id).emit('playback', { ...room.playback, by: socket.id, heartbeat: !!isHeartbeat });
  });

  socket.on('sync:get', (cb) => {
    if (room && typeof cb === 'function') cb({ ...room.playback, time: currentTime(room), ts: Date.now() });
  });

  socket.on('room:settings', (s) => {
    if (!room || room.hostId !== socket.id) return;
    if (typeof s?.everyoneControls === 'boolean') room.everyoneControls = s.everyoneControls;
    if (typeof s?.isPublic === 'boolean') room.isPublic = s.isPublic;
    io.to(room.id).emit('room:settings', { everyoneControls: room.everyoneControls, isPublic: room.isPublic });
    broadcastList();
  });

  socket.on('host:transfer', (to) => {
    if (!room || room.hostId !== socket.id || !room.users.has(to)) return;
    room.hostId = to; pushUsers(room);
    sysMsg(room, `${room.users.get(to).name} agora é o anfitrião`);
  });

  // WebRTC signaling (streaming of local files / screen share)
  socket.on('rtc:want', () => {
    if (room?.streamer && room.streamer !== socket.id) io.to(room.streamer).emit('rtc:want', socket.id);
  });
  socket.on('rtc:signal', ({ to, data } = {}) => {
    if (!room || !room.users.has(to)) return;
    io.to(to).emit('rtc:signal', { from: socket.id, data });
  });
  socket.on('stream:end', () => {
    if (!room || room.streamer !== socket.id) return;
    room.streamer = null; room.media = null;
    io.to(room.id).emit('media', { media: null, streamer: null, playback: room.playback });
    broadcastList();
  });

  function leave() {
    const r = room; if (!r) return;
    const u = r.users.get(socket.id);
    r.users.delete(socket.id);
    socket.leave(r.id);
    room = null;
    if (r.streamer === socket.id) {
      r.streamer = null; r.media = null;
      io.to(r.id).emit('media', { media: null, streamer: null, playback: r.playback });
    }
    if (r.hostId === socket.id) r.hostId = r.users.keys().next().value || null;
    if (r.users.size === 0) r.emptySince = Date.now();
    else { pushUsers(r); if (u) sysMsg(r, `${u.name} saiu`); }
    io.to(r.id).emit('rtc:gone', socket.id);
    broadcastList();
  }
  socket.on('room:leave', leave);
  socket.on('disconnect', leave);
});

// remove salas vazias após 10 min
setInterval(() => {
  let changed = false;
  for (const [id, r] of rooms) if (r.emptySince && Date.now() - r.emptySince > 10 * 60e3) { rooms.delete(id); changed = true; }
  if (changed) broadcastList();
}, 60e3);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Rodando em http://localhost:' + PORT));
