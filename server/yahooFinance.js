/**
 * yahooFinance.js — Alpha Vantage API (solo endpoint gratuiti)
 * Pausa 5s tra chiamate → max 12/min, ~200/giorno con 54 asset
 */

const axios = require('axios');

const AV_KEY   = process.env.AV_KEY;
const BASE_URL = 'https://www.alphavantage.co/query';
if (!AV_KEY) throw new Error('AV_KEY mancante — configurare la variabile su Railway');
console.log('[AV] Chiave caricata:', AV_KEY.slice(0,4) + '****');
const MIN_GAP  = 5000; // 5s tra chiamate

const priceSeries = {};
const MAX_SERIES  = 100;
let lastRequest   = 0;
let reqCount      = 0;

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

function mapSymbol(symbol) {
  const map = {
    'GC=F': 'GLD', 'SI=F': 'SLV', 'CL=F': 'USO',
    'BZ=F': 'USO', 'NG=F': 'UNG', 'HG=F': 'COPX',
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
  const changePct = parseFloat((q['10. change percent'] || '0%').replace('%','').trim()) || 0;
  const volume    = parseInt(q['06. volume']) || 0;
  const open      = parseFloat(q['02. open'])  || price;
  const high      = parseFloat(q['03. high'])  || price;
  const low       = parseFloat(q['04. low'])   || price;

  const key = avSym;
  if (!priceSeries[key]) priceSeries[key] = [];
  priceSeries[key].push({ time: Date.now(), open, high, low, close: price, volume });
  if (priceSeries[key].length > MAX_SERIES)
    priceSeries[key] = priceSeries[key].slice(-MAX_SERIES);

  return { symbol, price, change, changePct, volume, open, high, low, prevClose,
           bid: null, ask: null, spread: null, timestamp: Date.now() };
}

function getCandles(symbol, count = 60) {
  const series = priceSeries[mapSymbol(symbol)] || [];
  if (series.length === 0) return null;
  return series.slice(-count);
}

function buildMinimalSeries(quote, n) {
  const base = quote.price;
  return Array.from({ length: n }, (_, i) => {
    const j = base * 0.001 * (Math.random() - 0.5);
    return { time: Date.now() - (n - i) * 60000,
             open: base+j, high: base+Math.abs(j)*1.5,
             low: base-Math.abs(j)*1.5, close: base+j*0.5,
             volume: quote.volume || 100000 };
  });
}

async function fetchAll(symbol, _interval, count = 60) {
  const quote   = await fetchQuote(symbol);
  const candles = getCandles(symbol, count);
  return { quote, candles: (!candles || candles.length < 5)
    ? buildMinimalSeries(quote, 30) : candles };
}

module.exports = { fetchAll };
