/**
 * yahooFinance.js — versione stabile con rate limiting
 * Una sola sessione condivisa, rinnovata ogni 5 minuti.
 * Pausa minima di 1.5s tra richieste per evitare 401.
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REFERER = 'https://finance.yahoo.com/';

let cookie    = '';
let crumb     = '';
let sessionAt = 0;
const TTL     = 5 * 60 * 1000; // 5 minuti

// Ultima richiesta — rispetta il rate limit
let lastRequest = 0;
const MIN_GAP   = 1500; // ms tra richieste

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function rateLimit() {
  const gap = Date.now() - lastRequest;
  if (gap < MIN_GAP) await wait(MIN_GAP - gap);
  lastRequest = Date.now();
}

async function initSession(force = false) {
  if (!force && crumb && Date.now() - sessionAt < TTL) return;
  try {
    // Cookie
    const r1 = await axios.get('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA, 'Referer': REFERER },
      validateStatus: () => true, timeout: 8000, maxRedirects: 5,
    });
    cookie = (r1.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');

    await wait(500);

    // Crumb
    const r2 = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, 'Referer': REFERER, 'Cookie': cookie },
      validateStatus: () => true, timeout: 8000,
    });
    const c = String(r2.data ?? '').trim();
    if (c && c.length < 30 && !c.includes('<')) {
      crumb     = c;
      sessionAt = Date.now();
      console.log(`[Yahoo] Sessione rinnovata — crumb: ${crumb.slice(0,6)}…`);
    } else {
      throw new Error('Crumb non valido: ' + c.slice(0, 30));
    }
  } catch (e) {
    console.error('[Yahoo] Errore sessione:', e.message);
    throw e;
  }
}

// Fetch combinato: quote + candles in un'unica chiamata chart
async function fetchAll(symbol, interval = '1m', count = 60) {
  await initSession();
  await rateLimit();

  const enc  = encodeURIComponent(symbol);
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 2 * 24 * 60 * 60;

  let data;
  try {
    const res = await axios.get(
      `https://query2.finance.yahoo.com/v8/finance/chart/${enc}?period1=${from}&period2=${now}&interval=${interval}&crumb=${encodeURIComponent(crumb)}`,
      {
        headers: { 'User-Agent': UA, 'Referer': REFERER, 'Cookie': cookie },
        timeout: 10000,
      }
    );
    data = res.data;
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) {
      console.log(`[Yahoo] 401 su ${symbol} — rinnovo sessione…`);
      await initSession(true);
      await rateLimit();
      const res2 = await axios.get(
        `https://query2.finance.yahoo.com/v8/finance/chart/${enc}?period1=${from}&period2=${now}&interval=${interval}&crumb=${encodeURIComponent(crumb)}`,
        {
          headers: { 'User-Agent': UA, 'Referer': REFERER, 'Cookie': cookie },
          timeout: 10000,
        }
      );
      data = res2.data;
    } else {
      throw e;
    }
  }

  const chart = data?.chart?.result?.[0];
  if (!chart) throw new Error(`No chart data for ${symbol}`);

  // Meta da chart
  const meta  = chart.meta ?? {};
  const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? null;
  if (!price) throw new Error(`No price for ${symbol}`);

  const quote = {
    symbol,
    price,
    change:    meta.regularMarketPrice && meta.chartPreviousClose
                 ? +(meta.regularMarketPrice - meta.chartPreviousClose).toFixed(4) : 0,
    changePct: meta.regularMarketPrice && meta.chartPreviousClose
                 ? +((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2) : 0,
    volume:    meta.regularMarketVolume ?? 0,
    open:      meta.regularMarketOpen   ?? price,
    high:      meta.regularMarketDayHigh ?? price,
    low:       meta.regularMarketDayLow  ?? price,
    prevClose: meta.chartPreviousClose   ?? price,
    bid:       null, ask: null, spread: null,
    timestamp: Date.now(),
  };

  // Candles
  const ts = chart.timestamp ?? [];
  const q  = chart.indicators?.quote?.[0] ?? {};
  const candles = ts
    .map((t, i) => ({
      time:   t * 1000,
      open:   q.open?.[i]   ?? q.close?.[i] ?? price,
      high:   q.high?.[i]   ?? q.close?.[i] ?? price,
      low:    q.low?.[i]    ?? q.close?.[i] ?? price,
      close:  q.close?.[i]  ?? price,
      volume: q.volume?.[i] ?? 0,
    }))
    .filter(c => c.close != null)
    .slice(-count);

  return { quote, candles };
}

module.exports = { fetchAll };
