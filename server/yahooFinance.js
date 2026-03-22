/**
 * yahooFinance.js — Alpha Vantage API
 * Funziona su server cloud senza problemi di cookie/crumb.
 * Piano gratuito: 25 chiamate/minuto, 250 chiamate/giorno.
 *
 * Strategia per restare nei limiti:
 * - Una sola chiamata per asset (quote + candles separate)
 * - Pausa minima 3s tra richieste (max 20/min sicuri)
 * - Candles: aggiornate ogni 10 minuti per risparmiare chiamate
 *   (le quote si aggiornano ad ogni ciclo, le candles solo se vecchie)
 */

const axios = require('axios');

const AV_KEY   = process.env.AV_KEY || 'IO3JP5GHOPI8G32S';
const BASE_URL = 'https://www.alphavantage.co/query';
const MIN_GAP  = 3000; // 3s tra richieste → max 20/min

let lastRequest = 0;

// Cache candles per non riscaricarle ad ogni ciclo
const candleCache = {};
const CANDLE_TTL  = 10 * 60 * 1000; // 10 minuti

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rateLimit() {
  const gap = Date.now() - lastRequest;
  if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
  lastRequest = Date.now();
}

async function avGet(params) {
  await rateLimit();
  const res = await axios.get(BASE_URL, {
    params: { ...params, apikey: AV_KEY },
    timeout: 12000,
  });
  // Alpha Vantage restituisce errori nel body, non nello status
  if (res.data?.['Error Message']) throw new Error(res.data['Error Message']);
  if (res.data?.['Note'])          throw new Error('Rate limit Alpha Vantage: ' + res.data['Note']);
  if (res.data?.['Information'])   throw new Error('Limite piano gratuito: ' + res.data['Information']);
  return res.data;
}

// ─── Quote real-time ──────────────────────────────────────────────────────────
async function fetchQuote(symbol) {
  // Alpha Vantage usa simboli senza suffissi per futures — mappatura
  const avSymbol = mapSymbol(symbol);

  const data = await avGet({
    function: 'GLOBAL_QUOTE',
    symbol:   avSymbol,
  });

  const q = data['Global Quote'];
  if (!q || !q['05. price']) throw new Error(`No quote data for ${symbol}`);

  const price    = parseFloat(q['05. price']);
  const prevClose= parseFloat(q['08. previous close']);
  const change   = parseFloat(q['09. change']);
  const changePct= parseFloat(q['10. change percent']?.replace('%',''));
  const volume   = parseInt(q['06. volume']) || 0;
  const open     = parseFloat(q['02. open']);
  const high     = parseFloat(q['03. high']);
  const low      = parseFloat(q['04. low']);

  return {
    symbol, price, change, changePct, volume,
    open, high, low, prevClose,
    bid: null, ask: null, spread: null,
    timestamp: Date.now(),
  };
}

// ─── Candles OHLCV — TIME_SERIES_INTRADAY ────────────────────────────────────
async function fetchCandles(symbol, interval = '1min', count = 60) {
  const avSymbol = mapSymbol(symbol);
  const cacheKey = `${avSymbol}_${interval}`;
  const cached   = candleCache[cacheKey];

  // Usa la cache se fresca
  if (cached && Date.now() - cached.ts < CANDLE_TTL) {
    return cached.candles;
  }

  const data = await avGet({
    function:        'TIME_SERIES_INTRADAY',
    symbol:          avSymbol,
    interval:        interval,
    outputsize:      'compact', // ultime 100 candele
    adjusted:        'true',
  });

  const key     = `Time Series (${interval})`;
  const series  = data[key];
  if (!series) throw new Error(`No candle data for ${symbol}`);

  const candles = Object.entries(series)
    .map(([time, v]) => ({
      time:   new Date(time).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: parseInt(v['5. volume']) || 0,
    }))
    .sort((a, b) => a.time - b.time)
    .slice(-count);

  // Salva in cache
  candleCache[cacheKey] = { ts: Date.now(), candles };
  return candles;
}

// ─── Mappatura simboli Yahoo → Alpha Vantage ──────────────────────────────────
// Alpha Vantage non supporta futures (=F) né alcuni simboli speciali
function mapSymbol(symbol) {
  const map = {
    'GC=F':  'GLD',   // Oro → Gold ETF
    'SI=F':  'SLV',   // Argento → Silver ETF
    'CL=F':  'USO',   // Petrolio WTI → Oil ETF
    'BZ=F':  'USO',   // Brent → Oil ETF
    'NG=F':  'UNG',   // Gas naturale → Natural Gas ETF
    'HG=F':  'COPX',  // Rame → Copper ETF
    'BRK-B': 'BRK-B', // Berkshire — supportato
  };
  return map[symbol] || symbol;
}

// ─── fetchAll — chiamata combinata usata dal server ───────────────────────────
async function fetchAll(symbol, interval = '1min', count = 60) {
  // Per i futures usiamo l'ETF mappato sia per quote che candles
  const [quote, candles] = await Promise.all([
    fetchQuote(symbol),
    fetchCandles(symbol, interval, count),
  ]);
  return { quote, candles };
}

module.exports = { fetchAll };
