# ULTRON

A voice-controlled OSINT, digital-forensics and news assistant that runs in your browser. Speak or type in plain English; ULTRON works out what to do, **asks your permission before every operation**, and shows the results as text, maps, images and charts.

No API keys or paid services required.

## Features

- **Voice in and out** – speech recognition and a calm assistant voice (Chrome / Edge).
- **News** – latest headlines on any topic (Google News).
- **Research** – web results (Bing) plus Wikipedia summaries with images.
- **OSINT** – DNS records, WHOIS/RDAP, IP geolocation with map, HTTP headers and tech stack, TLS certificate checks, subdomain discovery from certificate-transparency logs.
- **Port scan** – 20 common TCP ports, only after you confirm you are authorised.
- **File forensics** – runs entirely in the browser (files never leave your machine): SHA hashes, real file type from magic bytes, entropy map, EXIF/GPS on a map, strings and extracted indicators (URLs, emails, IPs).
- **Permission gate** – every operation shows an approval dialog; say "yes" / "no" or click.
- **Optional local AI** – if [Ollama](https://ollama.com) is running with `qwen2.5:3b`, ULTRON uses it automatically for smarter understanding. Otherwise a fast built-in brain handles requests.

## Quick start

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:5050 in Chrome or Edge. Click the red core and speak, or type, e.g.:

- "What's the latest cybersecurity news?"
- "Investigate example.com"
- "Where is 1.1.1.1 hosted?"
- "Check this photo for location data"

Optional settings: copy `.env.example` to `.env` and edit.

## Project layout

```
server.js          Express server (binds to localhost only)
brain/             Understanding: built-in rules + optional Ollama
osint/             DNS, WHOIS, geo-IP, headers, TLS, subdomains, ports
research/          News and web search
public/            Browser UI, voice, permission dialog, file forensics
```

## Responsible use

Use ULTRON only on domains, IPs and systems you own or are authorised to test, and on publicly available information. Do not use it to track or profile private individuals. Port scanning without permission may be illegal where you live.

## Privacy

- The server listens on `127.0.0.1` only.
- Analysed files stay in your browser.
- Lookups contact public services (ip-api.com, rdap.org, crt.sh, Google News, Bing, Wikipedia) with the target you approve.
