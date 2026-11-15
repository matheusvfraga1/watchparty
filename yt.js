// Busca no YouTube sem chave de API (lê o ytInitialData da página de resultados)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const txt = (o) => o ? (o.simpleText ?? (o.runs || []).map(r => r.text).join('')) : '';

function walk(node, out, seen = 0) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return; }
  if (node.videoRenderer) {
    const v = node.videoRenderer;
    out.push({
      id: v.videoId, title: txt(v.title), channel: txt(v.ownerText || v.longBylineText),
      duration: txt(v.lengthText), views: txt(v.shortViewCountText || v.viewCountText),
      live: !v.lengthText && !!(v.badges || []).find(b => JSON.stringify(b).includes('LIVE')),
      thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    });
    return;
  }
  if (node.channelRenderer) {
    const c = node.channelRenderer, th = (c.thumbnail?.thumbnails || []).slice(-1)[0]?.url || '';
    out.push({ type: 'channel', id: c.channelId, title: txt(c.title), subs: txt(c.videoCountText) || txt(c.subscriberCountText), thumb: th.startsWith('//') ? 'https:' + th : th });
    return;
  }
  for (const k in node) walk(node[k], out);
}

const cache = new Map();
async function ytPage(q, sp) {
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}&hl=pt-BR&gl=BR`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
  const html = await r.text();
  const i = html.indexOf('var ytInitialData = ');
  if (i < 0) throw new Error('sem dados');
  const data = JSON.parse(html.slice(i + 20, html.indexOf(';</script>', i)));
  const out = []; walk(data, out); return out;
}
async function ytSearch(q, filter) {
  const sp = { video: 'EgIQAQ%3D%3D', long: 'EgIYAg%3D%3D', live: 'EgJAAQ%3D%3D' }[filter] || 'EgIQAQ%3D%3D';
  const key = q + '|' + sp;
  const c = cache.get(key); if (c && Date.now() - c.at < 30 * 60e3) return c.items;
  const [vids, chans] = await Promise.all([
    ytPage(q, sp).catch(() => ytPage(q, sp)),
    filter === 'video' ? ytPage(q, 'EgIQAg%3D%3D').catch(() => []) : [],
  ]);
  const ch = chans.filter(x => x.type === 'channel').slice(0, 3);
  const items = [...ch, ...vids.filter(x => !x.type)].filter((v, k, a) => v.id && a.findIndex(x => x.id === v.id) === k).slice(0, 43);
  if (!items.length) throw new Error('vazio');
  cache.set(key, { at: Date.now(), items }); if (cache.size > 300) cache.delete(cache.keys().next().value);
  return items;
}

// Lista uma pasta pública do Google Drive
async function driveFolder(id) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('pasta inacessível');
  const html = await r.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Pasta';
  const items = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const isFolder = /\/folders\//.test(m[2]);
    items.push({ id: m[1], name: decode(m[3]), folder: isFolder });
  }
  return { title: decode(title), items };
}
// Últimos vídeos de um canal (RSS, sem cota)
const rss = new Map();
async function ytChannel(id) {
  const c = rss.get(id); if (c && Date.now() - c.at < 15 * 60e3) return c.data;
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('canal não encontrado');
  const xml = await r.text();
  const title = decode((xml.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Canal');
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const id = (e.match(/<yt:videoId>([^<]+)/) || [])[1];
    return { id, title: decode((e.match(/<title>([^<]*)/) || [])[1] || ''), channel: title, published: (e.match(/<published>([^<]+)/) || [])[1], thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, short: /\/shorts\//.test(e) };
  }).filter(v => v.id);
  const data = { title, items };
  rss.set(id, { at: Date.now(), data }); if (rss.size > 2000) rss.delete(rss.keys().next().value);
  return data;
}
// Feed: junta os últimos vídeos de vários canais
async function ytFeed(ids) {
  const all = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < ids.length) { const id = ids[i++]; try { all.push(...(await ytChannel(id)).items.slice(0, 6)); } catch {} }
  }));
  return all.sort((a, b) => String(b.published).localeCompare(String(a.published))).slice(0, 80);
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

module.exports = { ytSearch, driveFolder, ytChannel, ytFeed };
