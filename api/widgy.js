function ymdJakarta(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatJakarta(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
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
  const attempts = [
    url,
    'https://r.jina.ai/http://r.jina.ai/http://example.com'.replace('http://r.jina.ai/http://example.com', url),
    'https://r.jina.ai/http://' + url.replace(/^https?:\/\//, ''),
    'https://r.jina.ai/http://r.jina.ai/http://example.com'.replace('http://r.jina.ai/http://example.com', url.replace(/^https:\/\//, 'http://'))
  ];
  let lastErr;
  for (const target of [...new Set(attempts)]) {
    try {
      const res = await fetch(target, {
        headers: { 'user-agent': 'Mozilla/5.0 HargaEmasBudi/1.0' },
        cache: 'no-store'
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 50) return text;
      }
      lastErr = new Error(`HTTP ${res.status} from ${target}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Gagal mengambil data');
}

function parseOfficialBuyback(text) {
  const patterns = [
    /Harga\s*Buyback\s*:?\s*Rp\s*([0-9.,]+)/i,
    /buyback[^\n\r]{0,160}?Rp\s*([0-9.,]+)/i,
    /jual\s*kembali[^\n\r]{0,160}?Rp\s*([0-9.,]+)/i,
    /pembelian\s*kembali[^\n\r]{0,160}?Rp\s*([0-9.,]+)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = Number(m[1].replace(/[,.]/g, ''));
      if (v > 1000000 && v < 5000000) return v;
    }
  }
  return null;
}

function parseHargaEmasOrgBuyback(text) {
  const m = text.match(/Harga\s+pembelian\s+kembali\s*:?\s*Rp\s*([0-9.]+)\s*\/\s*gr/i) ||
            text.match(/Buyback[^\n\r]{0,120}?Rp\s*([0-9.]+)/i);
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, ''));
  return v > 1000000 && v < 5000000 ? v : null;
}

function monthNameID(monthNumber) {
  return ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'][monthNumber - 1];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = ymdJakarta();
  const [y, m, d] = today.split('-');
  let perGram = null;
  let source = '';
  let warning = null;

  try {
    const text = await fetchText('https://www.logammulia.com/id/sell/gold');
    perGram = parseOfficialBuyback(text);
    if (perGram) source = 'Logam Mulia ANTAM buyback';
  } catch (e) {
    warning = String(e.message || e);
  }

  if (!perGram) {
    try {
      const url = `https://harga-emas.org/history-harga/${y}/${monthNameID(Number(m))}/${d}`;
      const text = await fetchText(url);
      perGram = parseHargaEmasOrgBuyback(text);
      if (perGram) source = 'Harga-Emas.org history';
    } catch (e) {
      warning = warning || String(e.message || e);
    }
  }

  if (!perGram) {
    return res.status(502).json({
      ok: false,
      error: 'Buyback belum berhasil dibaca dari sumber online',
      warning,
      date: today,
      updated_at: new Date().toISOString()
    });
  }

  const buyback100 = perGram * 100;
  return res.status(200).json({
    ok: true,
    date: today,
    updated_at: new Date().toISOString(),
    updated_jakarta: formatJakarta(),
    source,
    buyback_per_gram: perGram,
    buyback_100gr: buyback100,
    buyback_per_gram_text: rupiah(perGram),
    buyback_100gr_text: rupiah(buyback100),
    buyback_100gr_short: compactJuta(buyback100),
    label: 'ANTAM buyback 100 gr',
    note: 'Nilai jual 100 gr = harga buyback per gram × 100. Belum termasuk potensi pajak/biaya.'
  });
}
