/**
 * yahooFinance.js — Alpha Vantage API
 * Chiamate sequenziali con rate limit rigoroso.
 */

const axios = require('axios');

const AV_KEY   = process.env.AV_KEY || 'IO3JP5GHOPI8G32S';
const BASE_URL = 'https://www.alphavantage.co/query';
const MIN_GAP  = 3500; // 3.5s tra chiamate → ~17/min (limite 25/min)

let lastRequest = 0;
const candleCache = {};
const CANDLE_TTL  = 15 * 60 * 1000; // 15 minuti

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rateLimit() {
  const gap = Date.now() - lastRequest;
  if (gap < MIN_GAP) await sleep(MIN_GAP - gap);
  lastRequest = Date.now();
}

async function avGet(params) {
  await rateLimit();
  console.log(`[AV] Chiamata: ${params.function} ${params.symbol}`);
  const res = await axios.get(BASE_URL, {
    params: { ...params, apikey: AV_KEY },
    timeout: 15000,
  });
  const d = res.data;
  if (d?.['Error Message'])  throw new Error('AV Error: ' + d['Error Message']);
  if (d?.['Note'])           throw new Error('AV RateLimit: ' + d['Note'].slice(0,80));
  if (d?.['Information'])    throw new Error('AV Limit: ' + d['Information'].slice(0,80));
  return d;
}

// Mappatura simboli non supportati da Alpha Vantage
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
  return {
    symbol,
    price:     parseFloat(q['05. price']),
    change:    parseFloat(q['09. change']),
    changePct: parseFloat((q['10. change percent'] || '0%').replace('%','')),
    volume:    parseInt(q['06. volume']) || 0,
    open:      parseFloat(q['02. open']),
    high:      parseFloat(q['03. high']),
    low:       parseFloat(q['04. low']),
    prevClose: parseFloat(q['08. previous close']),
    bid: null, ask: null, spread: null,
    timestamp: Date.now(),
  };
}

async function fetchCandles(symbol, count = 60) {
  const avSym   = mapSymbol(symbol);
  const cacheKey = avSym;
  const cached   = candleCache[cacheKey];
  if (cached && Date.now() - cached.ts < CANDLE_TTL) {
    console.log(`[AV] Cache hit per ${symbol}`);
    return cached.candles;
  }
  const data   = await avGet({ function: 'TIME_SERIES_INTRADAY', symbol: avSym, interval: '1min', outputsize: 'compact' });
  const series = data['Time Series (1min)'];
  if (!series) throw new Error(`No candles for ${symbol}`);
  const candles = Object.entries(series)
    .map(([t, v]) => ({
      time:   new Date(t).getTime(),
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: parseInt(v['5. volume']) || 0,
    }))
    .sort((a, b) => a.time - b.time)
    .slice(-count);
  candleCache[cacheKey] = { ts: Date.now(), candles };
  return candles;
}

// Chiamate SEQUENZIALI — prima quote, poi candles (se non in cache)
async function fetchAll(symbol, _interval, count = 60) {
  const quote   = await fetchQuote(symbol);
  const candles = await fetchCandles(symbol, count);
  return { quote, candles };
}

module.exports = { fetchAll };
