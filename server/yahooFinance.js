/**
 * marketData.js — Alpaca Markets API
 * Dati in tempo reale (paper trading account)
 * Nessun rate limit aggressivo — fino a 200 req/min
 */

const axios = require('axios');

const API_KEY    = process.env.ALPACA_KEY    || 'PKNCURSU5H4KIFEARNLRCABUDT';
const API_SECRET = process.env.ALPACA_SECRET || 'DFAs6fu8FQcGkSwfumVzA7edhpVup6u7g8wNBuqw1Rrd';

const HEADERS = {
  'APCA-API-KEY-ID':     API_KEY,
  'APCA-API-SECRET-KEY': API_SECRET,
  'Content-Type':        'application/json',
};

const DATA_URL   = 'https://data.alpaca.markets';
const BROKER_URL = 'https://paper-api.alpaca.markets';

console.log('[Alpaca] Chiave:', API_KEY.slice(0,6) + '****');

// Cache candles in memoria
const priceSeries = {};
const MAX_SERIES  = 100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Quote real-time ──────────────────────────────────────────────────────────
async function fetchQuote(symbol) {
  const res = await axios.get(`${DATA_URL}/v2/stocks/${symbol}/quotes/latest`, {
    headers: HEADERS,
    timeout: 10000,
  });

  const q = res.data?.quote;
  if (!q) throw new Error(`No quote for ${symbol}`);

  // Prezzo mid tra bid e ask
  const bid   = q.bp || 0;
  const ask   = q.ap || 0;
  const price = bid && ask ? (bid + ask) / 2 : bid || ask;
  if (!price) throw new Error(`No price for ${symbol}`);

  // Accumula serie locale
  if (!priceSeries[symbol]) priceSeries[symbol] = [];
  priceSeries[symbol].push({
    time:   Date.now(),
    open:   price,
    high:   price,
    low:    price,
    close:  price,
    volume: q.as || 0,
  });
  if (priceSeries[symbol].length > MAX_SERIES)
    priceSeries[symbol] = priceSeries[symbol].slice(-MAX_SERIES);

  return {
    symbol,
    price,
    change:    0,
    changePct: 0,
    volume:    q.as || 0,
    open:      price,
    high:      price,
    low:       price,
    prevClose: price,
    bid, ask,
    spread:    ask && bid ? +(ask - bid).toFixed(4) : null,
    timestamp: Date.now(),
  };
}

// ─── Bars (candele) reali 1 minuto ────────────────────────────────────────────
async function fetchBars(symbol, count = 60) {
  const now   = new Date();
  const start = new Date(now.getTime() - 2 * 60 * 60 * 1000); // ultime 2 ore

  const res = await axios.get(`${DATA_URL}/v2/stocks/${symbol}/bars`, {
    headers: HEADERS,
    timeout: 10000,
    params: {
      timeframe: '1Min',
      start:     start.toISOString(),
      end:       now.toISOString(),
      limit:     count,
      feed:      'iex', // feed gratuito
    },
  });

  const bars = res.data?.bars;
  if (!bars || bars.length === 0) return null;

  return bars.map(b => ({
    time:   new Date(b.t).getTime(),
    open:   b.o,
    high:   b.h,
    low:    b.l,
    close:  b.c,
    volume: b.v,
  }));
}

function getLocalSeries(symbol, count = 60) {
  const series = priceSeries[symbol] || [];
  if (series.length === 0) return null;
  return series.slice(-count);
}

function buildMinimalSeries(price, n = 30) {
  return Array.from({ length: n }, (_, i) => {
    const j = price * 0.001 * (Math.random() - 0.5);
    return {
      time:   Date.now() - (n - i) * 60000,
      open:   price + j, high: price + Math.abs(j) * 1.5,
      low:    price - Math.abs(j) * 1.5, close: price + j * 0.5,
      volume: 100000,
    };
  });
}

// ─── fetchAll — usato dal server ──────────────────────────────────────────────
async function fetchAll(symbol, _interval, count = 60) {
  const quote = await fetchQuote(symbol);

  // Prima prova le bars reali, poi la serie locale, poi minimale
  let candles = null;
  try {
    candles = await fetchBars(symbol, count);
  } catch(e) {
    candles = null;
  }

  if (!candles || candles.length < 5) candles = getLocalSeries(symbol, count);
  if (!candles || candles.length < 5) candles = buildMinimalSeries(quote.price);

  // Aggiorna change% usando prima e ultima candela
  if (candles && candles.length >= 2) {
    const first = candles[0].close;
    const last  = quote.price;
    quote.change    = +(last - first).toFixed(4);
    quote.changePct = +(((last - first) / first) * 100).toFixed(2);
    quote.open      = candles[0].open;
    quote.high      = Math.max(...candles.map(c => c.high));
    quote.low       = Math.min(...candles.map(c => c.low));
  }

  return { quote, candles };
}

module.exports = { fetchAll };
