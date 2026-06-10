function jakartaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  return parts;
}
function ymdJakarta(date = new Date()) {
  const p = jakartaParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function formatJakarta(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'medium'
  }).format(date);
}
function rupiah(n) {
  if (n == null || Number.isNaN(n)) return '-';
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}
function compactJuta(n) {
  if (n == null || Number.isNaN(n)) return '-';
  return 'Rp' + (n / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' jt';
}
function parseNumber(s) {
  if (!s) return null;
  const raw = String(s).replace(/\s/g, '');
  const m = raw.match(/([0-9]{1,3}(?:[.,][0-9]{3})+)/) || raw.match(/([0-9]{7,})/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function normalizePerGram(n) {
  if (!n) return null;
  if (n >= 1000000 && n <= 5000000) return n;
  if (n >= 100000000 && n <= 500000000) return Math.round(n / 100);
  return null;
}
async function fetchText(url) {
  const urls = [
    url,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`,
    `https://r.jina.ai/http://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  ];
  let lastError = null;
  for (const u of [...new Set(urls)]) {
    try {
      const res = await fetch(u, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 HargaEmasBudiWidgy/3.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain,*/*'
        }
      });
      const text = await res.text();
      if (res.ok && text && text.length > 40) return text;
      lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 90)}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Tidak ada respons');
}
function parseBuybackPerGram(text) {
  const t = String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');

  const patterns = [
    /Harga\s*Buyback\s*:?\s*Rp\s*([0-9.,]+)/i,
    /Buyback\s*:?\s*Rp\s*([0-9.,]+)/i,
    /Harga\s+pembelian\s+kembali[^0-9]{0,80}Rp\s*([0-9.,]+)/i,
    /harga\s+jual\s+kembali[^0-9]{0,100}Rp\s*([0-9.,]+)/i,
    /pembelian\s+kembali[^0-9]{0,100}Rp\s*([0-9.,]+)/i,
    /buyback[^0-9]{0,100}([0-9]{1,3}(?:[.,][0-9]{3})+)/i,
    /dihargai\s*Rp\s*([0-9.,]+)\s*per\s*gram/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    const n = normalizePerGram(parseNumber(m && m[1]));
    if (n) return n;
  }
  return null;
}
async function getLiveBuyback() {
  const sources = [
    { name: 'Logam Mulia ANTAM buyback', url: 'https://www.logammulia.com/sell/gold' },
    { name: 'Logam Mulia ANTAM buyback ID', url: 'https://www.logammulia.com/id/sell/gold' },
    { name: 'Logam Mulia ANTAM harga hari ini', url: 'https://www.logammulia.com/en/harga-emas-hari-ini' }
  ];
  const errors = [];
  for (const src of sources) {
    try {
      const text = await fetchText(src.url);
      const perGram = parseBuybackPerGram(text);
      if (perGram) return { perGram, source: src.name, live: true };
      errors.push(`${src.name}: format tidak ketemu`);
    } catch (e) {
      errors.push(`${src.name}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return { perGram: null, source: null, live: false, errors };
}

// Fallback ini hanya supaya Widgy tidak kosong kalau website sumber sedang memblokir server Vercel.
// Bapak bisa ganti angka ini sewaktu-waktu lewat upload update kecil.
const LAST_KNOWN_BUYBACK_PER_GRAM = 2576700;
const LAST_KNOWN_DATE = '2026-06-10';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = ymdJakarta();
  let result = await getLiveBuyback();
  let warning = null;

  if (!result.perGram) {
    result = { perGram: LAST_KNOWN_BUYBACK_PER_GRAM, source: 'fallback terakhir tersimpan', live: false, errors: result.errors || [] };
    warning = 'Live source belum berhasil dibaca oleh Vercel, memakai fallback terakhir tersimpan.';
  }

  const buyback100 = result.perGram * 100;
  return res.status(200).json({
    ok: true,
    live: result.live,
    warning,
    date: result.live ? today : LAST_KNOWN_DATE,
    updated_at: new Date().toISOString(),
    updated_jakarta: formatJakarta(),
    source: result.source,
    buyback_per_gram: result.perGram,
    buyback_100gr: buyback100,
    buyback_per_gram_text: rupiah(result.perGram),
    buyback_100gr_text: rupiah(buyback100),
    buyback_100gr_short: compactJuta(buyback100),
    label: 'ANTAM buyback 100 gr',
    status_text: result.live ? 'Live' : 'Fallback',
    note: 'Nilai jual 100 gr = harga buyback per gram × 100. Belum termasuk potensi pajak/biaya.'
  });
}
