// Client-side file forensics: the file never leaves the browser.
window.Forensics = (() => {
  const MAGIC = [
    ['89504E47', 'PNG image'], ['FFD8FF', 'JPEG image'], ['47494638', 'GIF image'], ['52494646', 'RIFF (WEBP/WAV/AVI)'],
    ['25504446', 'PDF document'], ['504B0304', 'ZIP / DOCX / XLSX / APK / JAR'], ['4D5A', 'Windows PE executable (EXE/DLL)'],
    ['7F454C46', 'ELF executable (Linux)'], ['CAFEBABE', 'Java class / Mach-O fat'], ['CFFAEDFE', 'Mach-O 64-bit'],
    ['1F8B', 'GZIP archive'], ['377ABCAF271C', '7-Zip archive'], ['526172211A07', 'RAR archive'],
    ['D0CF11E0A1B11AE1', 'MS Office legacy (DOC/XLS/PPT/MSI)'], ['53514C69746520666F726D6174', 'SQLite database'],
    ['49443303', 'MP3 (ID3)'], ['000000', 'MP4/MOV (ftyp, check offset 4)'], ['4F676753', 'OGG'], ['424D', 'BMP image'],
    ['7B5C727466', 'RTF document'], ['3C3F786D6C', 'XML'], ['3C21444F43', 'HTML'], ['2321', 'Script (shebang)'],
  ];

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  function detectType(bytes) {
    const head = hex(bytes.slice(0, 16)).toUpperCase();
    if (head.slice(8, 16) === '66747970') return 'MP4 / MOV / HEIC (ftyp)';
    const m = MAGIC.find(([sig]) => head.startsWith(sig));
    return m ? m[1] : 'Unknown / plain data';
  }

  function entropy(bytes) {
    const f = new Array(256).fill(0);
    for (const b of bytes) f[b]++;
    let e = 0;
    for (const c of f) if (c) { const p = c / bytes.length; e -= p * Math.log2(p); }
    return e;
  }

  function blockEntropy(bytes, blocks = 128) {
    const size = Math.max(256, Math.ceil(bytes.length / blocks));
    const out = [];
    for (let i = 0; i < bytes.length; i += size) out.push(entropy(bytes.subarray(i, i + size)));
    return out;
  }

  function strings(bytes, min = 5, max = 4000) {
    const out = []; let cur = '';
    for (let i = 0; i < bytes.length && out.length < max; i++) {
      const b = bytes[i];
      if (b >= 32 && b < 127) cur += String.fromCharCode(b);
      else { if (cur.length >= min) out.push(cur); cur = ''; }
    }
    if (cur.length >= min) out.push(cur);
    return out;
  }

  function iocs(strs) {
    const text = strs.join('\n');
    const uniq = (re) => [...new Set(text.match(re) || [])].slice(0, 100);
    return {
      urls: uniq(/https?:\/\/[^\s"'<>]{4,}/g),
      emails: uniq(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g),
      ips: uniq(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g),
      paths: uniq(/[A-Za-z]:\\[^\s"'<>]{3,}/g),
    };
  }

  function hexDump(bytes, n = 256) {
    let s = '';
    for (let i = 0; i < Math.min(n, bytes.length); i += 16) {
      const row = bytes.subarray(i, i + 16);
      s += i.toString(16).padStart(8, '0') + '  ' +
        [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(48) + '  ' +
        [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('') + '\n';
    }
    return s;
  }

  async function analyze(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const [sha1, sha256, sha512] = await Promise.all(
      ['SHA-1', 'SHA-256', 'SHA-512'].map((a) => crypto.subtle.digest(a, buf).then(hex))
    );
    let exif = null;
    if (window.exifr) { try { exif = await exifr.parse(file, true); } catch { /* not supported */ } }
    const strs = strings(bytes);
    return {
      name: file.name, size: file.size, mime: file.type || 'n/a',
      modified: new Date(file.lastModified).toISOString(),
      detected: detectType(bytes),
      entropy: entropy(bytes), blocks: blockEntropy(bytes),
      sha1, sha256, sha512, exif,
      gps: exif && exif.latitude ? { lat: exif.latitude, lon: exif.longitude } : null,
      strings: strs, iocs: iocs(strs), hexdump: hexDump(bytes),
      isImage: /^image\//.test(file.type),
    };
  }

  function drawEntropy(canvas, blocks) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    const bw = w / blocks.length;
    blocks.forEach((e, i) => {
      const bh = (e / 8) * h;
      ctx.fillStyle = e > 7.2 ? '#ff2a3c' : e > 6 ? '#f1c40f' : '#2e86de';
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
    });
  }

  return { analyze, drawEntropy };
})();
