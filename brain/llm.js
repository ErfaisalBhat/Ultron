// Optional local AI via Ollama (free, offline, no key). Used automatically when running.
const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

const SYSTEM = `You are ULTRON, a composed, quick-witted voice assistant for OSINT, digital forensics, news and research, running on the user's PC.
Use the tools to act: news for current events, web_search for facts and people in the public eye, and the network tools for domains and IPs. Chain tools when helpful.
Each tool needs the user's approval; if denied, continue without it. Only use port_scan when the user explicitly asks to scan.
Do not help track or profile private individuals.
Reply format: first a spoken summary of at most 3 short sentences with no markdown or URLs; then optionally a blank line and markdown details.`;

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
});
const target = { target: { type: 'string', description: 'domain or IP address' } };
const TOOLS = [
  fn('news', 'Latest news headlines on a topic (empty for top headlines)', { query: { type: 'string' } }, ['query']),
  fn('web_search', 'Search the web and Wikipedia', { query: { type: 'string' } }, ['query']),
  fn('dns', 'DNS records of a domain', target, ['target']),
  fn('whois', 'Registration / owner of a domain or IP', target, ['target']),
  fn('geoip', 'Location and ISP of a domain or IP', target, ['target']),
  fn('headers', 'Website status, technology and security headers', target, ['target']),
  fn('ssl', 'TLS certificate details', target, ['target']),
  fn('subdomains', 'Subdomains from certificate logs', target, ['target']),
  fn('port_scan', 'Scan common TCP ports (only when asked)', target, ['target']),
  fn('my_ip', "User's public IP and location"),
  fn('analyze_file', 'Ask the user for a local file and run forensics on it', { purpose: { type: 'string' } }, ['purpose']),
  fn('open_url', 'Open a web page for the user', { url: { type: 'string' } }, ['url']),
];
const NAMES = new Set(TOOLS.map((t) => t.function.name));

let cache = { at: 0, ok: false };
async function available() {
  if (process.env.BRAIN === 'rules') return false;
  if (Date.now() - cache.at < 30000) return cache.ok;
  let ok = false;
  try {
    const r = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    ok = (j.models || []).some((m) => m.name === MODEL || m.name.startsWith(MODEL + ':'));
  } catch { /* not running */ }
  cache = { at: Date.now(), ok };
  return ok;
}

async function step(history) {
  const r = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: false, tools: TOOLS, options: { temperature: 0.3 },
      messages: [{ role: 'system', content: SYSTEM }, ...history],
    }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const { message } = await r.json();
  const tool_calls = (message.tool_calls || []).filter((c) => NAMES.has(c.function?.name));
  return { role: 'assistant', content: message.content || '', ...(tool_calls.length ? { tool_calls } : {}) };
}

module.exports = { available, step, MODEL };
