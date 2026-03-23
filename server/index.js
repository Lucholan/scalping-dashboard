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
  // ── USA ────────────────────────────────────────────────────────────────
  'NVDA':  { name:'NVIDIA',                  type:'stock', region:'USA' },
  'GOOGL': { name:'Alphabet',                type:'stock', region:'USA' },
  'PLTR':  { name:'Palantir',                type:'stock', region:'USA' },
  'TSM':   { name:'Taiwan Semiconductor',    type:'stock', region:'USA' },
  'ORCL':  { name:'Oracle',                  type:'stock', region:'USA' },
  'SMCI':  { name:'Super Micro Computer',    type:'stock', region:'USA' },
  'SNDK':  { name:'SanDisk (WD)',            type:'stock', region:'USA' },
  'RKLB':  { name:'Rocket Lab',              type:'stock', region:'USA' },
  'SOFI':  { name:'SoFi Technologies',       type:'stock', region:'USA' },
  'MU':    { name:'Micron Technology',       type:'stock', region:'USA' },
  // ── Brasile ────────────────────────────────────────────────────────────
  'NU':    { name:'Nu Holdings (Nubank)',     type:'stock', region:'Brasile' },
  // ── Argentina ──────────────────────────────────────────────────────────
  'MELI':  { name:'MercadoLibre',            type:'stock', region:'Argentina' },
};

const state   = {};
const symbols = Object.keys(ASSETS);
for (const s of symbols) state[s] = { quote:null, candles:[], indicators:null, signal:null };

// ─── Orari di mercato USA (NYSE) ─────────────────────────────────────────────
// NYSE apre 09:30 New York, chiude 16:00 New York
// New York è UTC-5 (inverno) o UTC-4 (estate, dal secondo domenica marzo)
// In UTC: apertura 14:30 UTC, chiusura 21:00 UTC — sempre fisso
// Pre-market NYC: 04:00–09:30 NY = 09:00–14:30 UTC
// After-hours NYC: 16:00–20:00 NY = 21:00–01:00 UTC

function isNYDST(date) {
  // DST USA: inizia seconda domenica di marzo, finisce prima domenica di novembre
  const year = date.getUTCFullYear();

  // Seconda domenica di marzo
  const march = new Date(Date.UTC(year, 2, 1));
  const marchDay = march.getUTCDay(); // 0=Dom
  const dstStart = new Date(Date.UTC(year, 2, 8 + (7 - marchDay) % 7, 7)); // 02:00 NY = 07:00 UTC

  // Prima domenica di novembre
  const nov = new Date(Date.UTC(year, 10, 1));
  const novDay = nov.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, 1 + (7 - novDay) % 7, 6)); // 02:00 NY = 06:00 UTC

  return date >= dstStart && date < dstEnd;
}

function marketStatus() {
  const now    = new Date();
  const day    = now.getUTCDay(); // 0=Dom, 6=Sab
  const dst    = isNYDST(now);
  const offset = dst ? 4 : 5; // ore da sottrarre per avere ora NY

  // Ora New York in minuti dalla mezzanotte
  const nyMinutes = ((now.getUTCHours() - offset + 24) % 24) * 60 + now.getUTCMinutes();

  // Ora italiana per i messaggi (UTC+1 inverno, UTC+2 estate)
  const itDST   = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 9; // approssimazione
  const itOffset = itDST ? 2 : 1;
  const itHour  = (now.getUTCHours() + itOffset) % 24;
  const itMin   = now.getUTCMinutes().toString().padStart(2,'0');
  const itTime  = `${itHour.toString().padStart(2,'0')}:${itMin}`;

  // Weekend NYSE (sabato e domenica ora NY)
  // Calcola giorno NY
  const nyDate = new Date(now.getTime() - offset * 3600000);
  const nyDay  = nyDate.getUTCDay();
  if (nyDay === 0 || nyDay === 6) {
    return { open: false, reason: `Weekend — mercati chiusi (${itTime} ora italiana)` };
  }

  // Pre-market (04:00–09:30 NY)
  if (nyMinutes >= 240 && nyMinutes < 570) {
    return { open: true, reason: `Pre-market USA (${itTime} ora italiana)`, premarket: true };
  }

  // Mercato regolare (09:30–16:00 NY)
  if (nyMinutes >= 570 && nyMinutes < 960) {
    return { open: true, reason: `NYSE/Nasdaq aperto (${itTime} ora italiana)` };
  }

  // After-hours (16:00–20:00 NY)
  if (nyMinutes >= 960 && nyMinutes < 1200) {
    return { open: true, reason: `After-hours USA (${itTime} ora italiana)`, afterhours: true };
  }

  // Notte — pausa
  const openItHour = dst ? 10 : 9; // pre-market 04:00 NY
  return { open: false, reason: `Mercati chiusi — pre-market alle ${openItHour}:00 ora italiana` };
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
}, 10000); // 10s tra asset → 3 asset ogni 30s, ~6 req/min, ~90 req/giorno

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
