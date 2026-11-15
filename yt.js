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
  for (const k in node) walk(node[k], out);
}

const cache = new Map();
async function ytSearch(q, filter) {
  const sp = { video: 'EgIQAQ%3D%3D', long: 'EgIYAg%3D%3D', live: 'EgJAAQ%3D%3D' }[filter] || 'EgIQAQ%3D%3D';
  const key = q + '|' + sp;
  const c = cache.get(key); if (c && Date.now() - c.at < 30 * 60e3) return c.items;
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}&hl=pt-BR&gl=BR`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  const html = await r.text();
  const i = html.indexOf('var ytInitialData = ');
  if (i < 0) throw new Error('sem dados');
  const j = html.indexOf(';</script>', i);
  const data = JSON.parse(html.slice(i + 20, j));
  const out = []; walk(data, out);
  const items = out.filter((v, k, a) => v.id && a.findIndex(x => x.id === v.id) === k).slice(0, 40);
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
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

module.exports = { ytSearch, driveFolder };
