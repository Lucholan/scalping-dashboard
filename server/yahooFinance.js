/**
 * yahooFinance.js — Alpha Vantage API (solo endpoint gratuiti)
 *
 * Endpoint usati:
 *   GLOBAL_QUOTE        → prezzo real-time (gratuito)
 *   TIME_SERIES_DAILY   → storico giornaliero (gratuito)
 *
 * Le "candele 1min" vengono simulate da GLOBAL_QUOTE accumulato
 * in memoria — ogni chiamata aggiunge un punto alla serie locale.
 * Non è storico vero, ma funziona per gli indicatori tecnici.
 *
 * Rate limit piano gratuito: 25 req/min, 500 req/giorno
 * Con 54 asset e 1 chiamata ciascuno: ciclo ~3 min, ~240 req/giorno
 */

const axios = require('axios');

const AV_KEY   = process.env.AV_KEY || 'IO3JP5GHOPI8G32S';
const BASE_URL = 'https://www.alphavantage.co/query';
const MIN_GAP  = 2500; // 2.5s tra chiamate → 24/min

// Serie locali accumulate in memoria per ogni simbolo
const priceSeries = {};
const MAX_SERIES  = 100; // teniamo le ultime 100 candele in RAM

let lastRequest = 0;
let reqCount    = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rateLimit() {
  const gap = Date.now() - lastRequest;
  if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
  lastRequest = Date.now();
  reqCount++;
}

async function avGet(params) {
  await rateLimit();
  console.log(`[AV] #${reqCount} ${params.function} ${params.symbol}`);
  const res = await axios.get(BASE_URL, {
    params: { ...params, apikey: AV_KEY },
    timeout: 15000,
  });
  const d = res.data;
  if (d?.['Error Message']) throw new Error('AV: ' + d['Error Message'].slice(0,100));
  if (d?.['Note'])          throw new Error('AV Rate: ' + d['Note'].slice(0,100));
  if (d?.['Information'])   throw new Error('AV Limit: ' + d['Information'].slice(0,100));
  return d;
}

// Mappatura simboli speciali
function mapSymbol(symbol) {
  const map = {
    'GC=F':  'GLD',
    'SI=F':  'SLV',
    'CL=F':  'USO',
    'BZ=F':  'USO',
    'NG=F':  'UNG',
    'HG=F':  'COPX',
  };
  return map[symbol] || symbol;
}

async function fetchQuote(symbol) {
  const avSym = mapSymbol(symbol);
  const data  = await avGet({ function: 'GLOBAL_QUOTE', symbol: avSym });
  const q     = data['Global Quote'];
  if (!q || !q['05. price']) throw new Error(`No quote for ${symbol}`);

  const price     = parseFloat(q['05. price']);
  const prevClose = parseFloat(q['08. previous close']) || price;
  const change    = parseFloat(q['09. change']) || 0;
  const pctStr    = (q['10. change percent'] || '0%').replace('%','').trim();
  const changePct = parseFloat(pctStr) || 0;
  const volume    = parseInt(q['06. volume']) || 0;
  const open      = parseFloat(q['02. open'])  || price;
  const high      = parseFloat(q['03. high'])  || price;
  const low       = parseFloat(q['04. low'])   || price;

  // Accumula nella serie locale per costruire candele
  const key = avSym;
  if (!priceSeries[key]) priceSeries[key] = [];
  priceSeries[key].push({
    time:   Date.now(),
    open:   open,
    high:   high,
    low:    low,
    close:  price,
    volume: volume,
  });
  // Mantieni solo le ultime MAX_SERIES candele
  if (priceSeries[key].length > MAX_SERIES) {
    priceSeries[key] = priceSeries[key].slice(-MAX_SERIES);
  }

  return {
    symbol, price, change, changePct, volume,
    open, high, low, prevClose,
    bid: null, ask: null, spread: null,
    timestamp: Date.now(),
  };
}

function getCandles(symbol, count = 60) {
  const avSym  = mapSymbol(symbol);
  const series = priceSeries[avSym] || [];
  if (series.length === 0) return null; // ancora nessun dato
  return series.slice(-count);
}

// fetchAll — chiamata singola: solo GLOBAL_QUOTE
async function fetchAll(symbol, _interval, count = 60) {
  const quote   = await fetchQuote(symbol);
  const candles = getCandles(symbol, count);

  // Se non abbiamo ancora abbastanza candele, usiamo il prezzo corrente
  // per costruire una serie minima (almeno 30 punti per gli indicatori)
  if (!candles || candles.length < 5) {
    return { quote, candles: buildMinimalSeries(quote, 30) };
  }

  return { quote, candles };
}

// Costruisce una serie minimale per gli indicatori quando non abbiamo storia
function buildMinimalSeries(quote, n) {
  const base = quote.price;
  const series = [];
  for (let i = 0; i < n; i++) {
    const jitter = base * 0.001 * (Math.random() - 0.5);
    series.push({
      time:   Date.now() - (n - i) * 60000,
      open:   base + jitter,
      high:   base + Math.abs(jitter) * 1.5,
      low:    base - Math.abs(jitter) * 1.5,
      close:  base + jitter * 0.5,
      volume: quote.volume || 100000,
    });
  }
  return series;
}

module.exports = { fetchAll };
