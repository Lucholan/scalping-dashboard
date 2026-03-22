const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const path      = require('path');
const { fetchAll } = require('./yahooFinance');
const { computeIndicators, generateSignal } = require('./indicators');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const ASSETS = {
  'AAPL':  { name:'Apple',              type:'stock',     region:'USA' },
  'MSFT':  { name:'Microsoft',          type:'stock',     region:'USA' },
  'NVDA':  { name:'NVIDIA',             type:'stock',     region:'USA' },
  'TSLA':  { name:'Tesla',              type:'stock',     region:'USA' },
  'AMZN':  { name:'Amazon',             type:'stock',     region:'USA' },
  'GOOGL': { name:'Alphabet',           type:'stock',     region:'USA' },
  'META':  { name:'Meta Platforms',     type:'stock',     region:'USA' },
  'JPM':   { name:'JPMorgan Chase',     type:'stock',     region:'USA' },
  'BAC':   { name:'Bank of America',    type:'stock',     region:'USA' },
  'V':     { name:'Visa',               type:'stock',     region:'USA' },
  'WMT':   { name:'Walmart',            type:'stock',     region:'USA' },
  'XOM':   { name:'ExxonMobil',         type:'stock',     region:'USA' },
  'BRK-B': { name:'Berkshire Hathaway', type:'stock',     region:'USA' },
  'JNJ':   { name:'Johnson & Johnson',  type:'stock',     region:'USA' },
  'PG':    { name:'Procter & Gamble',   type:'stock',     region:'USA' },
  'MA':    { name:'Mastercard',         type:'stock',     region:'USA' },
  'HD':    { name:'Home Depot',         type:'stock',     region:'USA' },
  'CVX':   { name:'Chevron',            type:'stock',     region:'USA' },
  'ABBV':  { name:'AbbVie',             type:'stock',     region:'USA' },
  'AMD':   { name:'AMD',                type:'stock',     region:'USA' },
  'INTC':  { name:'Intel',              type:'stock',     region:'USA' },
  'NFLX':  { name:'Netflix',            type:'stock',     region:'USA' },
  'DIS':   { name:'Walt Disney',        type:'stock',     region:'USA' },
  'PYPL':  { name:'PayPal',             type:'stock',     region:'USA' },
  'AVGO':  { name:'Broadcom',           type:'stock',     region:'USA' },
  'CRM':   { name:'Salesforce',         type:'stock',     region:'USA' },
  'PEP':   { name:'PepsiCo',            type:'stock',     region:'USA' },
  'KO':    { name:'Coca-Cola',          type:'stock',     region:'USA' },
  'UNH':   { name:'UnitedHealth',       type:'stock',     region:'USA' },
  'MRK':   { name:'Merck',              type:'stock',     region:'USA' },
  'SPY':   { name:'S&P 500 ETF',        type:'etf',       region:'USA' },
  'QQQ':   { name:'Nasdaq 100 ETF',     type:'etf',       region:'USA' },
  'DIA':   { name:'Dow Jones ETF',      type:'etf',       region:'USA' },
  'IWM':   { name:'Russell 2000 ETF',   type:'etf',       region:'USA' },
  'XLK':   { name:'Tech Select',        type:'etf',       region:'USA' },
  'XLF':   { name:'Financial Select',   type:'etf',       region:'USA' },
  'XLE':   { name:'Energy Select',      type:'etf',       region:'USA' },
  'XLV':   { name:'Health Care',        type:'etf',       region:'USA' },
  'XLI':   { name:'Industrial Select',  type:'etf',       region:'USA' },
  'XLY':   { name:'Consumer Discret.',  type:'etf',       region:'USA' },
  'XLP':   { name:'Consumer Staples',   type:'etf',       region:'USA' },
  'SOXX':  { name:'Semiconductors ETF', type:'etf',       region:'USA' },
  'ARKK':  { name:'ARK Innovation',     type:'etf',       region:'USA' },
  'VTI':   { name:'Vanguard Total US',  type:'etf',       region:'USA' },
  'GC=F':  { name:'Oro Futures',        type:'commodity', region:'Globale' },
  'SI=F':  { name:'Argento Futures',    type:'commodity', region:'Globale' },
  'CL=F':  { name:'Petrolio WTI',       type:'commodity', region:'Globale' },
  'BZ=F':  { name:'Petrolio Brent',     type:'commodity', region:'Globale' },
  'NG=F':  { name:'Gas Naturale',       type:'commodity', region:'Globale' },
  'HG=F':  { name:'Rame Futures',       type:'commodity', region:'Globale' },
  'GLD':   { name:'Gold ETF',           type:'etf',       region:'Globale' },
  'SLV':   { name:'Silver ETF',         type:'etf',       region:'Globale' },
  'USO':   { name:'Oil ETF',            type:'etf',       region:'Globale' },
  'DBA':   { name:'Agricoltura ETF',    type:'etf',       region:'Globale' },
};

const state   = {};
const symbols = Object.keys(ASSETS);
for (const s of symbols) state[s] = { quote:null, candles:[], indicators:null, signal:null };

// ─── Orari di mercato USA (NYSE) ─────────────────────────────────────────────
// Il server gira in UTC. NYSE apre 14:30 UTC, chiude 21:00 UTC
// Pre-market: 09:00–14:30 UTC | After-hours: 21:00–01:00 UTC
function marketStatus() {
  const now  = new Date();
  const day  = now.getUTCDay(); // 0=Dom, 6=Sab
  const hour = now.getUTCHours();
  const min  = now.getUTCMinutes();
  const time = hour * 60 + min; // minuti dalla mezzanotte UTC

  // Weekend — mercati chiusi
  if (day === 0 || day === 6) {
    return { open: false, reason: 'Weekend — mercati chiusi' };
  }

  // Pre-market (09:00–14:30 UTC = 11:00–16:30 ora italiana)
  if (time >= 540 && time < 870) {
    return { open: true, reason: 'Pre-market USA aperto', premarket: true };
  }

  // Mercato regolare (14:30–21:00 UTC = 16:30–23:00 ora italiana)
  if (time >= 870 && time < 1260) {
    return { open: true, reason: 'NYSE/Nasdaq aperto' };
  }

  // After-hours (21:00–01:00 UTC)
  if (time >= 1260 || time < 60) {
    return { open: true, reason: 'After-hours USA', afterhours: true };
  }

  // Notte profonda — pausa
  return { open: false, reason: 'Mercati chiusi — riprende alle 11:00 ora italiana' };
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// Notifica stato mercato a tutti i client
function broadcastMarketStatus(status) {
  broadcast({ type: 'market_status', ...status });
}

async function refreshAsset(symbol) {
  try {
    const { quote, candles } = await fetchAll(symbol, '1min', 60);
    const indicators = computeIndicators(candles);
    const signal     = generateSignal(indicators, quote.price);
    state[symbol]    = { quote, candles, indicators, signal, updatedAt: Date.now() };
    broadcast({ type:'asset_update', symbol, meta:ASSETS[symbol],
                quote, candles:candles.slice(-60), indicators, signal });
    console.log(`[${new Date().toLocaleTimeString()}] ${symbol.padEnd(8)} ${String(quote.price.toFixed(2)).padStart(10)} | ${signal.type} (${signal.confidence})`);
  } catch (err) {
    if (err.response?.status !== 404) console.error(`Error ${symbol}: ${err.message?.slice(0,80)}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Loop principale con controllo orari ──────────────────────────────────────
let idx     = 0;
let paused  = false;

setInterval(async () => {
  const status = marketStatus();

  if (!status.open) {
    if (!paused) {
      paused = true;
      console.log(`\n⏸ ${status.reason}\n`);
      broadcastMarketStatus(status);
    }
    return; // non fare nulla fuori orario
  }

  if (paused) {
    paused = false;
    console.log(`\n▶ ${status.reason}\n`);
    broadcastMarketStatus(status);
  }

  const sym = symbols[idx % symbols.length];
  idx++;
  await refreshAsset(sym);
}, 5500); // 5.5s tra asset → ~5 min ciclo completo, max 11/min

// ─── Avvio ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n🚀 ScalpingOS — ${symbols.length} asset`);
  console.log(`🌐 http://localhost:${PORT}\n`);

  const status = marketStatus();
  console.log(`Stato mercato: ${status.reason}`);

  if (status.open) {
    console.log('Carico i primi 10 asset…');
    for (const sym of symbols.slice(0, 10)) {
      await refreshAsset(sym);
    }
    console.log('Pronti. Gli altri asset arriveranno nei prossimi minuti.\n');
  } else {
    console.log('Mercato chiuso — il sistema si attiverà automaticamente all\'apertura.\n');
  }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Client connesso');
  // Invia stato mercato
  ws.send(JSON.stringify({ type: 'market_status', ...marketStatus() }));
  // Invia dati disponibili
  for (const [sym, d] of Object.entries(state)) {
    if (!d.quote) continue;
    ws.send(JSON.stringify({ type:'asset_update', symbol:sym, meta:ASSETS[sym],
      quote:d.quote, candles:d.candles.slice(-60), indicators:d.indicators, signal:d.signal }));
  }
  ws.on('close', () => console.log('Client disconnesso'));
});

app.get('/api/state',  (req, res) => res.json(state));
app.get('/api/market', (req, res) => res.json(marketStatus()));
