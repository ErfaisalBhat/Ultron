const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusEl = $('#status'), orb = $('#orb'), results = $('#results');
const setStatus = (s) => (statusEl.textContent = s);

/* ---------------- VOICE OUT (calm female, Irish/British preferred) ---------------- */
let voice = null;
const PREFS = [
  (v) => /en-IE/i.test(v.lang) && /emily|female|natural/i.test(v.name),
  (v) => /en-IE/i.test(v.lang),
  (v) => /en-GB/i.test(v.lang) && /sonia|libby|maisie|hazel|susan|female|natural/i.test(v.name),
  (v) => /^en/i.test(v.lang) && /aria|jenny|zira|samantha|female/i.test(v.name),
  (v) => /^en/i.test(v.lang),
];
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return;
  let saved = null;
  try { saved = localStorage.getItem('voice'); } catch { /* storage blocked */ }
  voice = vs.find((v) => v.name === saved);
  for (const p of PREFS) { if (voice) break; voice = vs.find(p); }
  voice = voice || vs[0];
  const sel = $('#voiceSel');
  sel.innerHTML = vs.filter((v) => /^en/i.test(v.lang)).map((v) => `<option ${v === voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  sel.onchange = () => {
    voice = vs.find((v) => v.name === sel.value);
    try { localStorage.setItem('voice', sel.value); } catch { /* storage blocked */ }
    say('Voice updated. Ready when you are.');
  };
}
speechSynthesis.onvoiceschanged = pickVoice; pickVoice();

function say(text) {
  if (!$('#voiceOn').checked || !text) return Promise.resolve();
  return new Promise((res) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice; u.pitch = 1.05; u.rate = 1.02;
    u.onstart = () => orb.classList.add('speaking');
    u.onend = u.onerror = () => { orb.classList.remove('speaking'); res(); };
    speechSynthesis.speak(u);
  });
}

/* ---------------- VOICE IN ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, pendingAuth = null, busy = false;
if (SR) {
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const text = r[0].transcript.trim();
    $('#transcript').textContent = `“${text}”`;
    if (r.isFinal) handleSpoken(text);
  };
  rec.onend = () => { orb.classList.remove('listening'); if (statusEl.textContent === 'LISTENING') setStatus('STANDBY'); };
  rec.onerror = (e) => setStatus('MIC ' + e.error.toUpperCase());
}
function listen() {
  if (!rec) { say('Voice input needs Chrome or Edge.'); return; }
  speechSynthesis.cancel();
  try { rec.start(); orb.classList.add('listening'); setStatus('LISTENING'); } catch { /* already running */ }
}
orb.onclick = listen;
function handleSpoken(text) {
  if (pendingAuth) {
    if (/\b(yes|approve|approved|proceed|confirm|go ahead|do it|affirmative|sure)\b/i.test(text)) return pendingAuth(true, true);
    if (/\b(no|deny|denied|cancel|stop|abort|negative)\b/i.test(text)) return pendingAuth(false);
    return;
  }
  run(text);
}

/* ---------------- AUTHORIZATION ---------------- */
function authorize(message, needsOwnership = false) {
  return new Promise((resolve) => {
    $('#modalText').innerHTML = message;
    $('#modalAuthWrap').classList.toggle('hidden', !needsOwnership);
    $('#modalAuthWrap').style.color = '';
    $('#modalAuth').checked = false;
    $('#modal').classList.remove('hidden');
    setStatus('AWAITING AUTHORIZATION');
    const finish = (ok, viaVoice) => {
      if (ok && needsOwnership && !$('#modalAuth').checked) {
        $('#modalAuthWrap').style.color = '#ff2a3c';
        if (viaVoice) say('Tick the ownership confirmation box first.');
        return;
      }
      pendingAuth = null;
      $('#modal').classList.add('hidden');
      resolve(ok);
    };
    pendingAuth = finish;
    $('#approve').onclick = () => finish(true);
    $('#deny').onclick = () => finish(false);
    const spoken = $('#modalText').textContent;
    say(spoken + ' Shall I proceed?').then(() => { if (pendingAuth && rec) listen(); });
  });
}

/* ---------------- AGENT LOOP ---------------- */
let history = [];
const LABELS = { news: 'News', web_search: 'Web search', dns: 'DNS records', whois: 'WHOIS / RDAP', geoip: 'IP geolocation', headers: 'HTTP headers & tech', ssl: 'SSL certificate', subdomains: 'Subdomain enumeration', port_scan: 'Port scan', my_ip: 'Your public IP', analyze_file: 'File forensics', open_url: 'Open web page' };
const SERVER_NAME = { port_scan: 'ports', my_ip: 'myip' };
const RESEARCH = { news: 'news', web_search: 'search' };

fetch('/api/brain/status').then((r) => r.json()).then((j) => { $('#mode').textContent = j.mode; }).catch(() => {});

async function run(text) {
  text = text.trim();
  if (!text || busy) return;
  if (/^(clear|reset|new (chat|session))\b/i.test(text)) { history = []; results.innerHTML = ''; return say('Clean slate. What next?'); }
  busy = true;
  const before = history.length;
  history.push({ role: 'user', content: text });
  userCard(text);
  try {
    for (let step = 0; step < 6; step++) {
      setStatus('THINKING');
      const r = await fetch('/api/brain/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const msg = j.assistant;
      history.push(msg);
      if (msg.tool_calls?.length) {
        const uses = msg.tool_calls.map((c) => ({ name: c.function.name, input: c.function.arguments || {} }));
        history.push(...await runTools(uses));
        continue;
      }
      answerCard(msg.content);
      say(spokenPart(msg.content));
      break;
    }
  } catch (e) {
    history = history.slice(0, before); // keep the conversation valid for the next try
    errorCard(e.message);
    say('Something went wrong. ' + e.message);
  }
  busy = false;
  setStatus('STANDBY');
}

async function runTools(uses) {
  const describe = (u) => {
    const a = u.input || {};
    return `<li><b>${esc(LABELS[u.name] || u.name)}</b>${a.target ? ' on ' + esc(a.target) : a.url ? ' → ' + esc(a.url) : a.purpose ? ': ' + esc(a.purpose) : ''}</li>`;
  };
  const active = uses.some((u) => u.name === 'port_scan');
  const autoOk = $('#autoSearch').checked && uses.every((u) => RESEARCH[u.name]);
  const ok = autoOk || await authorize(`I'd like to run:<ul>${uses.map(describe).join('')}</ul>${active ? 'Port scanning actively probes the target.' : ''}`, active);
  if (!ok) {
    say('Understood, standing down.');
    return uses.map((u) => ({ role: 'tool', tool_name: u.name, content: 'DENIED: the user did not authorise this operation.' }));
  }
  setStatus('EXECUTING');
  return Promise.all(uses.map(async (u) => {
    try {
      const data = await execTool(u.name, u.input || {}, active);
      let s = JSON.stringify(data);
      if (s.length > 8000) s = s.slice(0, 8000) + '…(truncated)';
      return { role: 'tool', tool_name: u.name, content: s };
    } catch (e) {
      return { role: 'tool', tool_name: u.name, content: 'ERROR: ' + e.message };
    }
  }));
}

async function execTool(name, input, authorized) {
  if (name === 'analyze_file') return analyzeFileTool(input.purpose);
  if (name === 'open_url') return openUrlTool(input.url);
  const el = card(LABELS[name] || name, input.target || input.query || '');
  try {
    const url = RESEARCH[name] ? `/api/research/${RESEARCH[name]}` : `/api/osint/${SERVER_NAME[name] || name}`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: input.target || 'self', query: input.query || '', authorized }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    el.querySelector('.body').innerHTML = (RENDER[name] || raw)(j.data, j.target);
    el.classList.remove('loading');
    return j.data;
  } catch (e) {
    el.classList.remove('loading'); el.classList.add('err');
    el.querySelector('.body').innerHTML = `<p>Failed: ${esc(e.message)}</p>`;
    throw e;
  }
}

function openUrlTool(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be opened');
  const el = card('Open web page', url);
  el.classList.remove('loading');
  el.querySelector('.body').innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)} ↗</a>`;
  const w = window.open(url, '_blank', 'noopener');
  return { opened: !!w || 'link shown to user (popup blocked)' };
}

/* ---------------- RENDERING ---------------- */
function card(title, sub, cls = '') {
  const el = document.createElement('div');
  el.className = 'card loading ' + cls;
  el.innerHTML = `<h4>${esc(title)} <small>${esc(sub)} · ${new Date().toLocaleTimeString()}</small></h4><div class="body"></div>`;
  results.prepend(el);
  return el;
}
function userCard(text) {
  const el = card('You', '', 'user'); el.classList.remove('loading');
  el.querySelector('.body').textContent = text;
}
function answerCard(md) {
  const el = card('ULTRON', '', 'answer'); el.classList.remove('loading');
  el.querySelector('.body').innerHTML = window.marked ? DOMPurify.sanitize(marked.parse(md)) : `<pre>${esc(md)}</pre>`;
  el.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
}
function errorCard(msg) {
  const el = card('Error', ''); el.classList.remove('loading'); el.classList.add('err');
  el.querySelector('.body').textContent = msg;
}
function spokenPart(md) {
  const first = md.split(/\n\s*\n/)[0] || md;
  return first.replace(/[#*_`>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').slice(0, 600);
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const srcCards = (list) => `<div class="sources">${list.map((s) =>
  `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?sz=32&domain=${esc(s.host || hostOf(s.url))}" alt=""><span><b>${esc(s.title)}</b><small>${esc(s.sub || hostOf(s.url))}</small></span></a>`).join('')}</div>`;

const kv = (o) => `<table>${Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) =>
  `<tr><th>${esc(k)}</th><td>${Array.isArray(v) ? v.map((x) => `<span class="tag">${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join('') : typeof v === 'object' ? `<pre>${esc(JSON.stringify(v, null, 2))}</pre>` : esc(v)}</td></tr>`).join('')}</table>`;
const raw = (d) => `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
const map = (lat, lon) => `<iframe class="map" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.05},${lat - 0.03},${lon + 0.05},${lat + 0.03}&layer=mapnik&marker=${lat},${lon}"></iframe>`;

const RENDER = {
  news: (d) => d.items.length ? srcCards(d.items.map((i) => ({ url: i.link, title: i.title, sub: `${i.source} · ${new Date(i.published).toLocaleString()}`, host: hostOf(i.sourceUrl) }))) : '<p>No recent stories.</p>',
  web_search: (d) => (d.wiki ? `<div class="wiki">${d.wiki.image ? `<img src="${esc(d.wiki.image)}" alt="">` : ''}<div><b>${esc(d.wiki.title)}</b> <small>${esc(d.wiki.description || '')}</small><p>${esc(d.wiki.extract)}</p><a href="${esc(d.wiki.url)}" target="_blank" rel="noopener">Wikipedia ↗</a></div></div>` : '') +
    (d.results.length ? srcCards(d.results.map((r) => ({ url: r.url, title: r.title, sub: r.snippet.slice(0, 110) }))) : ''),
  dns: (d) => Object.keys(d).length ? kv(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? (x.exchange ? `${x.priority} ${x.exchange}` : Array.isArray(x) ? x.join('') : JSON.stringify(x)) : x)) : v]))) : '<p>No records.</p>',
  whois: (d) => kv({ Name: d.name, Handle: d.handle, Range: d.range, Country: d.country, Status: d.status, Nameservers: d.nameservers }) +
    `<div class="grid2" style="margin-top:10px"><div>${kv(Object.fromEntries(d.events.map((e) => [e.action, new Date(e.date).toLocaleString()])))}</div><div>${kv(Object.fromEntries(d.entities.map((e, i) => [e.role || 'entity ' + i, e.name])))}</div></div>`,
  geoip: (d) => `<div class="grid2"><div>${kv({ IP: d.query, Reverse: d.reverse, City: d.city, Region: d.regionName, Country: d.country, ZIP: d.zip, Timezone: d.timezone, ISP: d.isp, Org: d.org, ASN: d.as, Proxy: d.proxy ? 'YES' : 'no', Hosting: d.hosting ? 'YES' : 'no' })}</div><div>${map(d.lat, d.lon)}</div></div>`,
  my_ip: (d) => `<div class="grid2"><div>${kv({ IP: d.query, City: d.city, Region: d.regionName, Country: d.country, ISP: d.isp, ASN: d.as })}</div><div>${map(d.lat, d.lon)}</div></div>`,
  headers: (d, t) => `<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><img src="https://www.google.com/s2/favicons?sz=64&domain=${esc(t)}" width="32" height="32" alt=""><div><b>${esc(d.title || '(no title)')}</b><br><span class="mono">${esc(d.status)} · ${esc(d.finalUrl)}</span></div></div>` +
    `<p>${d.security.map((s) => `<span class="tag ${s.present ? 'ok' : 'bad'}">${s.present ? '✓' : '✗'} ${esc(s.header)}</span>`).join('')}</p>` +
    (d.tech.length ? `<p>Tech: ${d.tech.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</p>` : '') +
    `<details><summary>All headers</summary>${kv(d.headers)}</details>`,
  ssl: (d) => `<p><span class="tag ${d.trusted ? 'ok' : 'bad'}">${d.trusted ? 'Trusted chain' : 'Untrusted: ' + esc(d.trustError)}</span><span class="tag ${d.daysLeft > 14 ? 'ok' : 'bad'}">${d.daysLeft} days left</span><span class="tag">${esc(d.protocol)}</span><span class="tag">${esc(d.cipher)}</span></p>` +
    kv({ Subject: d.subject?.CN, Issuer: [d.issuer?.O, d.issuer?.CN].filter(Boolean).join(' / '), 'Valid from': d.validFrom, 'Valid to': d.validTo, Serial: d.serial, 'SHA-256': d.fingerprint256, 'Alt names': d.altNames.slice(0, 60) }),
  subdomains: (d) => `<p><b>${d.count}</b> unique names from certificate transparency logs.</p><div class="scroll"><table>${d.subdomains.map((s) => `<tr><td class="mono">${esc(s)}</td></tr>`).join('')}</table></div>`,
  port_scan: (d) => `<p class="mono">Target IP: ${esc(d.ip)}</p><table><tr><th>Port</th><th>Service</th><th>State</th></tr>${d.results.map((p) => `<tr><td>${p.port}</td><td>${esc(p.service)}</td><td><span class="tag ${p.open ? 'bad' : ''}">${p.open ? 'OPEN' : 'closed/filtered'}</span></td></tr>`).join('')}</table>`,
};

/* ---------------- FILE FORENSICS (tool) ---------------- */
// The file picker needs a real click, so the card shows a button the user presses.
function analyzeFileTool(purpose) {
  const el = card('File forensics', purpose || 'select a file');
  el.classList.remove('loading');
  el.querySelector('.body').innerHTML = `<p>Choose the file to examine. It stays on this computer.</p><div class="row" style="display:flex;gap:8px"><button class="pick">Choose file</button><button class="ghost skip">Cancel</button></div>`;
  say('Please choose the file to examine.');
  return new Promise((resolve, reject) => {
    const input = $('#filePick');
    el.querySelector('.skip').onclick = () => { el.querySelector('.body').innerHTML = '<p>Cancelled.</p>'; reject(new Error('User cancelled file selection')); };
    el.querySelector('.pick').onclick = () => {
      input.value = '';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        el.classList.add('loading');
        try { resolve(await renderForensics(file, el)); } catch (e) { reject(e); }
        el.classList.remove('loading');
      };
      input.click();
    };
  });
}

async function renderForensics(file, el) {
  setStatus('ANALYZING');
  const r = await Forensics.analyze(file);
  const imgUrl = r.isImage ? URL.createObjectURL(file) : null;
  const ioc = Object.entries(r.iocs).filter(([, v]) => v.length);
  el.querySelector('h4 small').textContent = file.name;
  el.querySelector('.body').innerHTML =
    `<div class="grid2"><div>${kv({ Name: r.name, Size: `${r.size.toLocaleString()} bytes`, 'Browser MIME': r.mime, 'Magic-byte type': r.detected, 'Last modified': r.modified, Entropy: `${r.entropy.toFixed(3)} / 8 ${r.entropy > 7.5 ? '(likely packed/encrypted/compressed)' : ''}` })}</div>` +
    `<div>${imgUrl ? `<img class="preview" src="${imgUrl}" alt="">` : ''}${r.gps ? map(r.gps.lat, r.gps.lon) : ''}</div></div>` +
    `<h5>Hashes</h5>${kv({ 'SHA-1': r.sha1, 'SHA-256': r.sha256, 'SHA-512': r.sha512 })}<p><a href="https://www.virustotal.com/gui/search/${r.sha256}" target="_blank" rel="noopener">Look up SHA-256 on VirusTotal ↗</a></p>` +
    `<h5>Entropy map</h5><canvas></canvas>` +
    (r.exif ? `<h5>EXIF / metadata</h5><div class="scroll">${kv(r.exif)}</div>` : '') +
    (ioc.length ? `<h5>Indicators extracted</h5>${kv(Object.fromEntries(ioc))}` : '') +
    `<h5>Hex header</h5><pre>${esc(r.hexdump)}</pre>` +
    `<details><summary>Strings (${r.strings.length})</summary><pre>${esc(r.strings.slice(0, 1500).join('\n'))}</pre></details>`;
  Forensics.drawEntropy(el.querySelector('canvas'), r.blocks);
  // Compact version for the model.
  const exif = r.exif ? Object.fromEntries(Object.entries(r.exif).filter(([, v]) => typeof v !== 'object' || v instanceof Date).slice(0, 60)) : null;
  return {
    name: r.name, size: r.size, browserMime: r.mime, magicType: r.detected, modified: r.modified,
    entropy: +r.entropy.toFixed(3), sha256: r.sha256, sha1: r.sha1, gps: r.gps, exif,
    indicators: r.iocs, sampleStrings: r.strings.slice(0, 120),
  };
}

/* ---------------- UI ---------------- */
[
  "What's the latest cybersecurity news?",
  'Investigate github.com',
  'Where is 1.1.1.1 hosted?',
  "Is tesla.com's certificate healthy?",
  'Check a file for anything suspicious',
  "What's my IP?",
].forEach((c) => {
  const b = document.createElement('button'); b.textContent = c; b.onclick = () => { $('#transcript').textContent = `“${c}”`; run(c); }; $('#chips').append(b);
});
$('#cmdForm').onsubmit = (e) => { e.preventDefault(); const v = $('#cmd').value; $('#cmd').value = ''; $('#transcript').textContent = `“${v}”`; run(v); };
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.ctrlKey) listen(); });
