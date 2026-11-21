const router = require('express').Router();
const dns = require('dns').promises;
const tls = require('tls');
const net = require('net');

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function cleanTarget(raw) {
  if (!raw) return null;
  let t = String(raw).trim().toLowerCase();
  t = t.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0];
  if (net.isIP(t) || HOST_RE.test(t)) return t;
  return null;
}

async function fetchJson(url, ms = 10000) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': 'ultron-console/1.0', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function toIp(target) {
  if (net.isIP(target)) return target;
  const { address } = await dns.lookup(target);
  return address;
}

const tools = {
  async dns(t) {
    const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA'];
    const out = {};
    await Promise.all(types.map(async (type) => {
      try { out[type] = await dns.resolve(t, type); } catch { /* no record */ }
    }));
    return out;
  },

  async whois(t) {
    const url = net.isIP(t) ? `https://rdap.org/ip/${t}` : `https://rdap.org/domain/${t}`;
    const d = await fetchJson(url, 12000);
    const vcardName = (e) => {
      const fn = e.vcardArray?.[1]?.find((x) => x[0] === 'fn');
      return fn ? fn[3] : e.handle;
    };
    return {
      name: d.ldhName || d.name || t,
      handle: d.handle,
      status: d.status,
      range: d.startAddress ? `${d.startAddress} - ${d.endAddress}` : undefined,
      country: d.country,
      events: (d.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate })),
      nameservers: (d.nameservers || []).map((n) => n.ldhName),
      entities: (d.entities || []).map((e) => ({ role: (e.roles || []).join(', '), name: vcardName(e) })),
    };
  },

  async geoip(t) {
    const ip = await toIp(t);
    const d = await fetchJson(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,proxy,hosting,query`);
    if (d.status !== 'success') throw new Error(d.message || 'lookup failed');
    return d;
  },

  async myip() {
    return fetchJson('http://ip-api.com/json/?fields=country,regionName,city,lat,lon,isp,org,as,query');
  },

  async headers(t) {
    const r = await fetch(`https://${t}`, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 ultron-console/1.0' },
    });
    const headers = Object.fromEntries(r.headers.entries());
    const body = (await r.text()).slice(0, 200000);
    const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim();
    const security = [
      'strict-transport-security', 'content-security-policy', 'x-frame-options',
      'x-content-type-options', 'referrer-policy', 'permissions-policy',
    ].map((h) => ({ header: h, present: h in headers }));
    const tech = [headers.server, headers['x-powered-by'], headers['x-generator']].filter(Boolean);
    return { finalUrl: r.url, status: r.status, title, tech, security, headers };
  },

  ssl(t) {
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host: t, port: 443, servername: t, rejectUnauthorized: false, timeout: 8000 }, () => {
        const c = sock.getPeerCertificate(true);
        const res = {
          trusted: sock.authorized,
          trustError: sock.authorizationError || null,
          protocol: sock.getProtocol(),
          cipher: sock.getCipher()?.name,
          subject: c.subject,
          issuer: c.issuer,
          validFrom: c.valid_from,
          validTo: c.valid_to,
          daysLeft: Math.floor((new Date(c.valid_to) - Date.now()) / 86400000),
          altNames: (c.subjectaltname || '').split(', ').map((s) => s.replace(/^DNS:/, '')).filter(Boolean),
          fingerprint256: c.fingerprint256,
          serial: c.serialNumber,
        };
        sock.end();
        resolve(res);
      });
      sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS timeout')); });
      sock.on('error', reject);
    });
  },

  async subdomains(t) {
    if (net.isIP(t)) throw new Error('subdomain enumeration needs a domain');
    const rows = await fetchJson(`https://crt.sh/?q=%25.${encodeURIComponent(t)}&output=json`, 30000);
    const set = new Set();
    rows.forEach((r) => String(r.name_value).split('\n').forEach((n) => {
      n = n.trim().toLowerCase().replace(/^\*\./, '');
      if (n.endsWith(t)) set.add(n);
    }));
    return { count: set.size, subdomains: [...set].sort() };
  },

  async ports(t, { authorized }) {
    if (!authorized) throw new Error('Port scan refused: authorization not confirmed');
    const ip = await toIp(t);
    const list = { 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3', 143: 'imap', 443: 'https', 445: 'smb', 993: 'imaps', 1433: 'mssql', 3306: 'mysql', 3389: 'rdp', 5432: 'postgres', 5900: 'vnc', 6379: 'redis', 8080: 'http-alt', 8443: 'https-alt', 27017: 'mongodb' };
    const probe = (port) => new Promise((res) => {
      const s = new net.Socket();
      const done = (open) => { s.destroy(); res({ port: +port, service: list[port], open }); };
      s.setTimeout(1500);
      s.once('connect', () => done(true));
      s.once('timeout', () => done(false));
      s.once('error', () => done(false));
      s.connect(+port, ip);
    });
    const results = await Promise.all(Object.keys(list).map(probe));
    return { ip, results };
  },
};

router.post('/:tool', async (req, res) => {
  const fn = tools[req.params.tool];
  if (!fn) return res.status(404).json({ error: 'unknown tool' });
  const target = req.params.tool === 'myip' ? 'self' : cleanTarget(req.body.target);
  if (!target) return res.status(400).json({ error: 'invalid target (domain or IP expected)' });
  try {
    res.json({ tool: req.params.tool, target, data: await fn(target, req.body) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
