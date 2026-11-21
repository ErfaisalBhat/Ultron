// Built-in brain: understands free-form requests without any AI service.
// plan()  -> decides which tools to run from what the user said.
// compose() -> turns tool results into a spoken summary + markdown details.

const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi;
const FILE_EXT = /\.(jpe?g|png|gif|bmp|webp|heic|pdf|docx?|xlsx?|pptx?|exe|dll|zip|rar|7z|txt|csv|mp[34]|mov|apk|js|py|bat|ps1)$/i;

function normalize(text) {
  return text.toLowerCase().replace(/\s+dot\s+/g, '.').replace(/[“”"]/g, '').trim();
}

function extractTargets(text) {
  const t = normalize(text);
  const out = new Set();
  for (const m of t.matchAll(/https?:\/\/([^\s/?#]+)/g)) out.add(m[1].replace(/^www\./, ''));
  for (const m of t.match(IP_RE) || []) out.add(m);
  for (const m of t.match(DOMAIN_RE) || []) {
    if (FILE_EXT.test(m)) continue;
    out.add(m.replace(/^www\./, ''));
  }
  IP_RE.lastIndex = 0;
  return [...out];
}

function lastTarget(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    for (const c of m.tool_calls || []) if (c.function?.arguments?.target) return c.function.arguments.target;
    if (m.role === 'user') { const t = extractTargets(m.content); if (t.length) return t[0]; }
  }
  return null;
}

const call = (name, args = {}) => ({ function: { name, arguments: args } });
const has = (t, re) => re.test(t);

const FILLER = /\b(hey|hi|ok|okay|ultron|please|can you|could you|would you|will you|i want( you)? to|i need( you)? to|tell me|give me|show me|get me|find|fetch|bring|me|the|a|an|any|some|latest|recent|current|today'?s?|todays|top|breaking|news|headlines?|updates?|happening|going on|what'?s|what is|what are|about|on|for|regarding|in|of|with|now|right now|new)\b/g;

function topicFrom(t) {
  return t.replace(FILLER, ' ').replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchQueryFrom(t) {
  return t.replace(/^(hey |ok |okay )?(ultron[, ]+)?/, '')
    .replace(/\b(please|can you|could you|search( the web)?( for)?|google|look up|lookup|find( out)?|tell me( about)?|explain|define|who is|who was|what is|what are|what was|meaning of|information( on| about)?|info( on| about)?)\b/g, ' ')
    .replace(/[?!]/g, ' ').replace(/\s+/g, ' ').trim() || t;
}

function smallTalk(t) {
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b[\s!.]*(ultron)?[\s!.]*$/.test(t)) return 'Hello. ULTRON online and at your service. What do you need?';
  if (/\b(thank(s| you)|cheers|great job|well done)\b/.test(t)) return 'Always a pleasure. Anything else?';
  if (/\bwho are you\b|\bwhat are you\b|\byour name\b/.test(t)) return 'I am ULTRON, your OSINT, forensics and research assistant. Ask me for news, investigate a domain or IP, or hand me a file to examine.';
  if (/\b(what('s| is) the )?time\b/.test(t) && t.split(' ').length <= 6) return `It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  if (/\b(what('s| is) )?(the |today'?s )?date\b|\bwhat day is it\b/.test(t)) return `Today is ${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
  if (/^(help|what can you do|commands|capabilities)\b/.test(t)) return HELP;
  return null;
}

const HELP = `I can fetch news, search the web, investigate domains and IPs, check certificates and websites, scan ports you're authorised to test, and examine files for hidden data.

- **News:** "latest news on AI", "what's happening in London", "headlines"
- **Research:** "who is Satya Nadella", "explain ransomware"
- **Investigate:** "investigate example.com", "who owns google.com", "where is 1.1.1.1 hosted"
- **Website:** "is github.com secure", "what tech does wordpress.org use", "subdomains of tesla.com"
- **Forensics:** "check a photo for location data", "is this file suspicious"
- **Network:** "what's my IP", "scan ports on 192.168.1.1"
- **Actions:** "open shodan.io"`;

function plan(text, history) {
  const t = normalize(text);
  const talk = smallTalk(t);
  if (talk) return { reply: talk };

  // Forensics on a local file
  if (has(t, /\b(file|photo|picture|image|pic|document|pdf|attachment|evidence|metadata|exif|executable|malware sample)\b/) &&
      !extractTargets(t).length) {
    return { calls: [call('analyze_file', { purpose: text })] };
  }

  if (has(t, /\bmy (public )?ip\b|\bwhere am i\b|\bmy location\b/)) return { calls: [call('my_ip')] };

  let targets = extractTargets(t);
  if (!targets.length && has(t, /\b(it|its|that|this|same|the site|the domain|the server|the ip)\b/)) {
    const prev = lastTarget(history);
    if (prev) targets = [prev];
  }

  // News
  if (has(t, /\b(news|headlines?|happening|trending|breaking|current events|updates? on)\b/)) {
    return { calls: [call('news', { query: topicFrom(t) })] };
  }

  if (targets.length) {
    if (has(t, /\b(open|launch|visit|go to|browse)\b/)) return { calls: targets.map((x) => call('open_url', { url: `https://${x}` })) };
    const want = new Set();
    if (has(t, /\bport|scan\b|open services/)) want.add('port_scan');
    if (has(t, /\b(ssl|tls|cert|certificate|https|expir)/)) want.add('ssl');
    if (has(t, /\b(header|tech|technology|built with|stack|server|security headers|cms|up|down|online|status|title)\b/)) want.add('headers');
    if (has(t, /sub ?domains?/)) want.add('subdomains');
    if (has(t, /\b(whois|own|owns|owner|registrar|regist|created|age|rdap|belongs)/)) want.add('whois');
    if (has(t, /\b(where|locat|geo|hosted|hosting|host|country|isp|trace|provider)/)) want.add('geoip');
    if (has(t, /\b(dns|records?|mx|nameservers?|resolve|mail server|txt|spf)\b/)) want.add('dns');
    if (has(t, /\bsecure|safe|security\b/)) { want.add('ssl'); want.add('headers'); }
    if (!want.size || has(t, /\b(investigate|recon|everything|all|full|osint|profile|dig|look into|analy[sz]e|tell me about|info|information|details|check)\b/)) {
      const isIp = (x) => /^[\d.]+$/.test(x);
      ['dns', 'whois', 'geoip', 'headers', 'ssl', 'subdomains'].forEach((n) => want.add(n));
      if (targets.every(isIp)) { want.delete('dns'); want.delete('subdomains'); want.delete('headers'); want.delete('ssl'); }
    }
    return { calls: targets.flatMap((x) => [...want].map((n) => call(n, { target: x }))) };
  }

  // Anything else: research it on the web.
  return { calls: [call('web_search', { query: searchQueryFrom(t) })] };
}

/* ---------------- compose answers ---------------- */
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const COMPOSE = {
  news: (d) => d.items.length ? {
    say: `Here are the top stories on ${d.query}. Leading: ${d.items[0].title}, from ${d.items[0].source}.${d.items[1] ? ` Also, ${d.items[1].title}.` : ''}`,
    md: d.items.map((i) => `- [${i.title}](${i.link}) — *${i.source}, ${ago(i.published)}*`).join('\n'),
  } : { say: `I found no recent news on ${d.query}.`, md: '' },
  web_search: (d) => {
    const top = d.results[0];
    const say = d.wiki ? `${d.wiki.title}${d.wiki.description ? ', ' + d.wiki.description : ''}. ${d.wiki.extract.split('. ').slice(0, 2).join('. ')}.`
      : top ? `Top result: ${top.title}. ${top.snippet}` : `I couldn't find anything on ${d.query}.`;
    return { say, md: d.results.slice(0, 6).map((r) => `- [${r.title}](${r.url}) — ${r.snippet}`).join('\n') };
  },
  dns: (d, t) => ({ say: `${t} resolves to ${(d.A || []).slice(0, 2).join(' and ') || 'no IPv4 address'}${d.MX ? `, with ${d.MX.length} mail servers` : ''}.`, md: '' }),
  whois: (d, t) => {
    const reg = d.entities.find((e) => /registrar/.test(e.role)) || d.entities[0];
    const created = d.events.find((e) => /registration/.test(e.action));
    return { say: `${t} ${reg ? `is registered through ${reg.name}` : 'has registration data'}${created ? `, created ${new Date(created.date).getFullYear()}` : ''}.`, md: '' };
  },
  geoip: (d, t) => ({ say: `${t} is hosted in ${[d.city, d.country].filter(Boolean).join(', ')} on ${d.isp}${d.hosting ? ', a hosting provider' : ''}${d.proxy ? ', flagged as a proxy' : ''}.`, md: '' }),
  my_ip: (d) => ({ say: `Your public IP is ${d.query}, located around ${d.city}, ${d.country}, via ${d.isp}.`, md: '' }),
  headers: (d, t) => {
    const missing = d.security.filter((s) => !s.present).length;
    return { say: `${t} answered with status ${d.status}${d.tech.length ? `, running ${d.tech[0]}` : ''}. ${missing ? `${missing} security headers are missing.` : 'All key security headers are present.'}`, md: '' };
  },
  ssl: (d, t) => ({ say: `${t}'s certificate is ${d.trusted ? 'trusted' : 'not trusted'}, issued by ${d.issuer?.O || d.issuer?.CN}, with ${d.daysLeft} days left.`, md: '' }),
  subdomains: (d, t) => ({ say: `I found ${d.count} subdomains of ${t} in certificate logs.`, md: '' }),
  port_scan: (d, t) => {
    const open = d.results.filter((p) => p.open);
    return { say: open.length ? `${t} has ${open.length} open ports: ${open.map((p) => p.service).join(', ')}.` : `No common ports are open on ${t}.`, md: '' };
  },
  analyze_file: (d) => {
    const notes = [`${d.name} is a ${d.magicType}.`];
    if (d.gps) notes.push(`It contains GPS coordinates, ${d.gps.lat.toFixed(4)}, ${d.gps.lon.toFixed(4)}.`);
    if (d.exif?.Make || d.exif?.Model) notes.push(`Captured on a ${[d.exif.Make, d.exif.Model].filter(Boolean).join(' ')}.`);
    if (d.entropy > 7.5) notes.push('Entropy is very high, so it may be packed or encrypted.');
    if (/executable/i.test(d.magicType) && !/\.(exe|dll|sys|scr)$/i.test(d.name)) notes.push('Warning: executable content with a misleading extension.');
    const n = Object.values(d.indicators || {}).reduce((a, v) => a + v.length, 0);
    if (n) notes.push(`${n} embedded indicators such as links or IPs were extracted.`);
    return { say: notes.join(' '), md: '' };
  },
  open_url: (d) => ({ say: 'Opened.', md: '' }),
};

function compose(history) {
  let i = history.length - 1;
  const results = [];
  while (i >= 0 && history[i].role === 'tool') results.unshift(history[i--]);
  const asked = history[i]?.tool_calls || [];
  const spoken = [], details = [];
  results.forEach((r, idx) => {
    const c = asked[idx]?.function || { name: r.tool_name, arguments: {} };
    if (/^DENIED/.test(r.content)) { spoken.push(`${c.name.replace('_', ' ')} was not authorised.`); return; }
    let data;
    try { data = JSON.parse(r.content); } catch { spoken.push(`${c.name.replace('_', ' ')} failed: ${r.content}`); return; }
    const f = COMPOSE[c.name];
    if (!f) return;
    try {
      const { say, md } = f(data, c.arguments?.target || '');
      spoken.push(say); if (md) details.push(md);
    } catch { /* partial data */ }
  });
  const say = spoken.length > 3 ? `Investigation complete. ${spoken.slice(0, 4).join(' ')} Full results are on screen.` : spoken.join(' ') || 'Done.';
  return say + (details.length ? '\n\n' + details.join('\n\n') : '');
}

module.exports = { plan, compose, HELP };
