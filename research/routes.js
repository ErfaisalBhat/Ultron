// Free, key-less research sources: Google News RSS, DuckDuckGo HTML, Wikipedia.
const router = require('express').Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const get = (url, ms = 10000) => fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA } });
const decode = (s = '') => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();
const tag = (xml, t) => decode((xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);

async function news(query) {
  // Set NEWS_COUNTRY in .env (e.g. IN, GB, US) for local headlines.
  const c = (process.env.NEWS_COUNTRY || 'US').toUpperCase();
  const loc = `hl=en-${c}&gl=${c}&ceid=${c}:en`;
  const url = query ? `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:7d')}&${loc}` : `https://news.google.com/rss?${loc}`;
  const xml = await (await get(url)).text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const sourceUrl = (it.match(/<source url="([^"]+)"/) || [])[1];
    return { title, source, sourceUrl, link: tag(it, 'link'), published: tag(it, 'pubDate') };
  });
  return { query: query || 'top headlines', count: items.length, items };
}

async function wikipedia(query) {
  try {
    const sr = await (await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`)).json();
    const title = sr.query?.search?.[0]?.title;
    if (!title) return null;
    const s = await (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)).json();
    if (s.type === 'disambiguation') return null;
    return { title: s.title, description: s.description, extract: s.extract, image: s.thumbnail?.source, url: s.content_urls?.desktop?.page };
  } catch { return null; }
}

async function bing(query) {
  try {
    const xml = await (await get(`https://www.bing.com/search?format=rss&setlang=en&q=${encodeURIComponent(query)}`)).text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8)
      .map(([, it]) => ({ title: tag(it, 'title'), url: tag(it, 'link'), snippet: tag(it, 'description') }));
  } catch { return []; }
}

// Bing RSS first; DuckDuckGo as a fallback (it sometimes challenges scripted requests).
async function web(query) {
  // Bing RSS matches loosely; quoting short names keeps results on-topic.
  const q = query.split(/\s+/).length <= 4 && !query.includes('"') ? `"${query}"` : query;
  const r = await bing(q);
  return r.length ? r : duck(query);
}

async function duck(query) {
  try {
    const html = await (await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)).text();
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => decode(m[1]));
    return links.slice(0, 8).map(([, href, title], i) => {
      let url = decode(href);
      const u = url.match(/[?&]uddg=([^&]+)/);
      if (u) url = decodeURIComponent(u[1]);
      if (url.startsWith('//')) url = 'https:' + url;
      return { title: decode(title), url, snippet: snippets[i] || '' };
    }).filter((r) => !/duckduckgo\.com\/y\.js/.test(r.url));
  } catch { return []; }
}

async function search(query) {
  const [wiki, results] = await Promise.all([wikipedia(query), web(query)]);
  return { query, wiki, results };
}

const tools = { news, search };

router.post('/:tool', async (req, res) => {
  const fn = tools[req.params.tool];
  if (!fn) return res.status(404).json({ error: 'unknown tool' });
  const query = String(req.body.query || '').trim().slice(0, 300);
  if (!query && req.params.tool !== 'news') return res.status(400).json({ error: 'query required' });
  try {
    res.json({ tool: req.params.tool, target: query, data: await fn(query) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
