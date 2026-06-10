const cheerio = require('cheerio');

const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

function onlyDigits(s) {
  const n = String(s || '').replace(/[^0-9]/g, '');
  return n ? Number(n) : null;
}

function rupiah(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; HargaEmasBudi/1.0; +https://vercel.app)',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`Gagal mengambil ${url}: HTTP ${res.status}`);
  return await res.text();
}

function parseHargaEmasOrg(html, isoDate) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  // Harga-Emas.org can render rows like:
  // 100 265.512.000 266.133.000
  // or 100 Rp2.655.120.000 Rp2.661.330.000
  // depending on current/history page and browser rendering.
  let buy100 = null;
  const patterns = [
    /(?:^|\s)100\s*(?:gr|gram)?\s+(?:Rp\s*)?([0-9.,]{7,})\s+(?:Rp\s*)?([0-9.,]{7,})/i,
    /(?:^|\s)100\s+(?:Rp\s*)?([0-9.,]{7,})/i
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) { buy100 = onlyDigits(m[1]); break; }
  }

  let buybackPerGram = null;
  const bb = text.match(/Harga pembelian kembali:\s*Rp\s*([0-9.,]+)/i) || text.match(/Buyback[^0-9]*Rp\s*([0-9.,]+)/i);
  if (bb) buybackPerGram = onlyDigits(bb[1]);

  return {
    date: isoDate,
    buy100,
    buybackPerGram,
    sell100: buybackPerGram ? buybackPerGram * 100 : null,
    source: 'harga-emas.org'
  };
}

function parseLogamMuliaToday(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const titleDate = text.match(/Harga Emas Hari Ini,\s*([^B]+?)\s+Harga di-update/i);
  const row100 = text.match(/(?:^|\s)100\s*(?:gr|gram)\s+(?:Rp\s*)?([0-9,.]+)\s+(?:Rp\s*)?([0-9,.]+)/i)
    || text.match(/(?:^|\s)100\s+(?:Rp\s*)?([0-9,.]{7,})\s+(?:Rp\s*)?([0-9,.]{7,})/i);
  return {
    titleDate: titleDate ? titleDate[1].trim() : null,
    buy100Base: row100 ? onlyDigits(row100[1]) : null,
    buy100Tax: row100 ? onlyDigits(row100[2]) : null,
    source: 'logammulia.com'
  };
}

function parseLogamMuliaBuyback(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const bb = text.match(/Harga Buyback:\s*Rp\s*([0-9,.]+)/i);
  const changed = text.match(/Perubahan Terakhir:\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}\s+[0-9:]+)/i);
  return {
    buybackPerGram: bb ? onlyDigits(bb[1]) : null,
    changedAt: changed ? changed[1] : null,
    source: 'logammulia.com'
  };
}

function daysInMonth(year, monthIndex1) {
  return new Date(year, monthIndex1, 0).getDate();
}

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

async function getHistory(year, month) {
  const now = new Date();
  const todayJakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const maxDay = (year === todayJakarta.getFullYear() && month === todayJakarta.getMonth() + 1)
    ? todayJakarta.getDate()
    : daysInMonth(year, month);

  const monthName = MONTHS_ID[month - 1];
  const jobs = [];
  for (let day = 1; day <= maxDay; day++) {
    const date = iso(year, month, day);
    const url = `https://harga-emas.org/history-harga/${year}/${monthName}/${String(day).padStart(2,'0')}`;
    jobs.push(async () => {
      try {
        const html = await fetchText(url);
        return parseHargaEmasOrg(html, date);
      } catch (e) {
        return { date, buy100: null, buybackPerGram: null, sell100: null, source: 'harga-emas.org', error: e.message };
      }
    });
  }

  const results = [];
  const concurrency = 5;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      results.push(await job());
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.sort((a, b) => a.date.localeCompare(b.date)).filter(r => r.buy100 || r.sell100);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    const todayJakarta = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const monthParam = req.query.month || `${todayJakarta.getFullYear()}-${String(todayJakarta.getMonth()+1).padStart(2,'0')}`;
    const [yearStr, monthStr] = monthParam.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!year || !month || month < 1 || month > 12) throw new Error('Parameter month harus format YYYY-MM, contoh 2026-06');

    const [history, lmTodayHtml, lmBuybackHtml, hargaEmasTodayHtml] = await Promise.all([
      getHistory(year, month),
      fetchText('https://www.logammulia.com/id/harga-emas-hari-ini').catch(() => null),
      fetchText('https://www.logammulia.com/id/sell/gold').catch(() => null),
      fetchText('https://harga-emas.org/history-harga').catch(() => null)
    ]);

    const today = lmTodayHtml ? parseLogamMuliaToday(lmTodayHtml) : null;
    const buyback = lmBuybackHtml ? parseLogamMuliaBuyback(lmBuybackHtml) : null;
    const hargaEmasToday = hargaEmasTodayHtml ? parseHargaEmasOrg(hargaEmasTodayHtml, iso(todayJakarta.getFullYear(), todayJakarta.getMonth() + 1, todayJakarta.getDate())) : null;

    // Pakai data resmi ANTAM untuk tanggal hari ini bila bulan yang dibuka adalah bulan berjalan.
    // Ini penting karena beberapa arsip history kadang hanya punya buyback, sehingga harga beli 100 gr kosong.
    const todayIso = iso(todayJakarta.getFullYear(), todayJakarta.getMonth() + 1, todayJakarta.getDate());
    if (year === todayJakarta.getFullYear() && month === todayJakarta.getMonth() + 1) {
      const officialBuy100 = today?.buy100Base || today?.buy100Tax || hargaEmasToday?.buy100 || null;
      const officialBuyback = buyback?.buybackPerGram || hargaEmasToday?.buybackPerGram || null;
      const officialRow = {
        date: todayIso,
        buy100: officialBuy100,
        buy100Tax: today?.buy100Tax || null,
        buybackPerGram: officialBuyback,
        sell100: officialBuyback ? officialBuyback * 100 : null,
        source: 'logammulia.com'
      };
      const idx = history.findIndex(r => r.date === todayIso);
      if (idx >= 0) {
        history[idx] = { ...history[idx], ...Object.fromEntries(Object.entries(officialRow).filter(([,v]) => v != null)) };
      } else if (officialBuy100 || officialBuyback) {
        history.push(officialRow);
        history.sort((a, b) => a.date.localeCompare(b.date));
      }
    }

    const latest = history.length ? history[history.length - 1] : null;

    res.status(200).json({
      ok: true,
      month: monthParam,
      generatedAt: new Date().toISOString(),
      sources: [
        'https://www.logammulia.com/id/harga-emas-hari-ini',
        'https://www.logammulia.com/id/sell/gold',
        'https://harga-emas.org/history-harga'
      ],
      todayOfficial: today ? {
        buy100Base: today.buy100Base,
        buy100Tax: today.buy100Tax,
        buybackPerGram: buyback?.buybackPerGram || null,
        sell100: buyback?.buybackPerGram ? buyback.buybackPerGram * 100 : null,
        changedAt: buyback?.changedAt || null,
        source: 'logammulia.com'
      } : null,
      latestHistory: latest,
      data: history,
      labels: {
        buy100: 'Harga beli 100 gr',
        sell100: 'Harga jual/buyback 100 gr'
      },
      formattedLatest: latest ? {
        buy100: rupiah(latest.buy100),
        sell100: rupiah(latest.sell100),
        buybackPerGram: rupiah(latest.buybackPerGram)
      } : null
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
