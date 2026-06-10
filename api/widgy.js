function ymdJakarta(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
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

async function fetchText(url) {
  const targets = [
    url,
    'https://r.jina.ai/' + url,
    'https://r.jina.ai/http://' + url.replace(/^https?:\/\//, ''),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)
  ];
  let lastErr;
  for (const target of [...new Set(targets)]) {
    try {
      const res = await fetch(target, {
        headers: { 'user-agent': 'Mozilla/5.0 HargaEmasBudiWidgy/2.0' },
        cache: 'no-store'
      });
      const text = await res.text();
      if (res.ok && text && text.length > 50) return text;
      lastErr = new Error(`HTTP ${res.status} ${text.slice(0, 80)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gagal mengambil data');
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
  // Some parsers return value for 100 gr, some per gram.
  if (n > 100000000 && n < 500000000) return Math.round(n / 100);
  if (n > 1000000 && n < 5000000) return n;
  return null;
}

function parseBuybackPerGram(text) {
  const clean = String(text).replace(/\r/g, '\n');
  const patterns = [
    /Harga\s*Buyback\s*:?\s*Rp\s*([0-9.,]+)/i,
    /Harga\s+pembelian\s+kembali\s*:?\s*Rp\s*([0-9.,]+)\s*\/\s*gr/i,
    /buyback[^\n\r]{0,180}?Rp\s*([0-9.,]+)/i,
    /harga\s+jual\s+kembali[^\n\r]{0,180}?Rp\s*([0-9.,]+)/i,
    /pembelian\s+kembali[^\n\r]{0,180}?Rp\s*([0-9.,]+)/i,
    /dihargai\s*Rp\s*([0-9.,]+)\s*per\s*gram/i
  ];
  for (const p of patterns) {
    const m = clean.match(p);
    const n = normalizePerGram(parseNumber(m && m[1]));
    if (n) return n;
  }
  return null;
}

function todayKontanSlug(dateStr) {
  const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d}-${months[m - 1]}-${y}`;
}

async function getBuyback() {
  const today = ymdJakarta();
  const sources = [
    { name: 'Logam Mulia ANTAM buyback', url: 'https://www.logammulia.com/sell/gold' },
    { name: 'Logam Mulia ANTAM buyback', url: 'https://www.logammulia.com/id/sell/gold' },
    { name: 'Harga-Emas.org', url: 'https://harga-emas.org/history-harga' },
    { name: 'Harga-Emas.org today', url: `https://harga-emas.org/history-harga/${today.split('-')[0]}/Juni/${today.split('-')[2]}` },
    { name: 'Kontan Pusat Data', url: `https://pusatdata.kontan.co.id/news/grafik-harga-emas-antam-batangan-${todayKontanSlug(today)}-hari-ini-naik-atau-turun` }
  ];

  const errors = [];
  for (const src of sources) {
    try {
      const text = await fetchText(src.url);
      const perGram = parseBuybackPerGram(text);
      if (perGram) return { perGram, source: src.name };
      errors.push(`${src.name}: parse kosong`);
    } catch (e) {
      errors.push(`${src.name}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return { perGram: null, source: null, errors };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = ymdJakarta();
  const result = await getBuyback();

  if (!result.perGram) {
    return res.status(200).json({
      ok: false,
      date: today,
      updated_at: new Date().toISOString(),
      updated_jakarta: formatJakarta(),
      error: 'Buyback belum berhasil dibaca dari sumber online',
      debug: result.errors || []
    });
  }

  const buyback100 = result.perGram * 100;
  return res.status(200).json({
    ok: true,
    date: today,
    updated_at: new Date().toISOString(),
    updated_jakarta: formatJakarta(),
    source: result.source,
    buyback_per_gram: result.perGram,
    buyback_100gr: buyback100,
    buyback_per_gram_text: rupiah(result.perGram),
    buyback_100gr_text: rupiah(buyback100),
    buyback_100gr_short: compactJuta(buyback100),
    label: 'ANTAM buyback 100 gr',
    note: 'Nilai jual 100 gr = harga buyback per gram × 100. Belum termasuk potensi pajak/biaya.'
  });
}
