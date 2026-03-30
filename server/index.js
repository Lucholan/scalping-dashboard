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
  // ── Tecnologia & Semiconduttori ────────────────────────────────────────
  'NVDA':  { name:'NVIDIA',               type:'stock', region:'USA' },
  'TSM':   { name:'Taiwan Semiconductor', type:'stock', region:'USA' },
  'MU':    { name:'Micron Technology',    type:'stock', region:'USA' },
  'SMCI':  { name:'Super Micro Computer', type:'stock', region:'USA' },
  'SNDK':  { name:'SanDisk',              type:'stock', region:'USA' },
  'GOOGL': { name:'Alphabet',             type:'stock', region:'USA' },
  'ORCL':  { name:'Oracle',               type:'stock', region:'USA' },
  'PLTR':  { name:'Palantir',             type:'stock', region:'USA' },
  // ── Difesa & Aerospazio ────────────────────────────────────────────────
  'LMT':   { name:'Lockheed Martin',      type:'stock', region:'USA' },
  'KTOS':  { name:'Kratos Defense',       type:'stock', region:'USA' },
  'RKLB':  { name:'Rocket Lab',           type:'stock', region:'USA' },
  'AXON':  { name:'Axon Enterprise',      type:'stock', region:'USA' },
  // ── Cybersecurity ──────────────────────────────────────────────────────
  'CRWD':  { name:'CrowdStrike',          type:'stock', region:'USA' },
  'S':     { name:'SentinelOne',          type:'stock', region:'USA' },
  // ── Energia ───────────────────────────────────────────────────────────
  'VST':   { name:'Vistra Energy',        type:'stock', region:'USA' },
  // ── Salute & Biotech ───────────────────────────────────────────────────
  'ISRG':  { name:'Intuitive Surgical',   type:'stock', region:'USA' },
  'DXCM':  { name:'DexCom',              type:'stock', region:'USA' },
  'CRSP':  { name:'CRISPR Therapeutics',  type:'stock', region:'USA' },
  'LLY':   { name:'Eli Lilly',            type:'stock', region:'USA' },
  'ABBV':  { name:'AbbVie',               type:'stock', region:'USA' },
  'CELH':  { name:'Celsius Holdings',     type:'stock', region:'USA' },
  // ── Fintech & Social ───────────────────────────────────────────────────
  'SOFI':  { name:'SoFi Technologies',    type:'stock', region:'USA' },
  'RDDT':  { name:'Reddit',               type:'stock', region:'USA' },
  // ── Latam ─────────────────────────────────────────────────────────────
  'NU':    { name:'Nu Holdings (Nubank)', type:'stock', region:'Brasile' },
  'MELI':  { name:'MercadoLibre',         type:'stock', region:'Argentina' },
};

const state   = {};
const symbols = Object.keys(ASSETS);
for (const s of symbols) state[s] = { quote:null, candles:[], indicators:null, signal:null };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function broadcastMarketStatus(status) {
  broadcast({ type: 'market_status', ...status });
}

// ─── DST e orari mercato ──────────────────────────────────────────────────────
// Orari attivi (ora New York):
//   Pre-market ridotto:  08:30–09:30 NY  (1 ora prima apertura)
//   Mercato regolare:    09:30–16:00 NY
//   After-hours ridotto: 16:00–17:00 NY  (1 ora dopo chiusura)
//   Totale: ~8.5 ore al giorno

function isNYDST(date) {
  const year = date.getUTCFullYear();
  const march = new Date(Date.UTC(year, 2, 1));
  const dstStart = new Date(Date.UTC(year, 2, 8 + (7 - march.getUTCDay()) % 7, 7));
  const nov = new Date(Date.UTC(year, 10, 1));
  const dstEnd = new Date(Date.UTC(year, 10, 1 + (7 - nov.getUTCDay()) % 7, 6));
  return date >= dstStart && date < dstEnd;
}

function marketStatus() {
  const now    = new Date();
  const dst    = isNYDST(now);
  const offset = dst ? 4 : 5;

  // Ora New York
  const nyDate = new Date(now.getTime() - offset * 3600000);
  const nyDay  = nyDate.getUTCDay();
  const nyMin  = nyDate.getUTCHours() * 60 + nyDate.getUTCMinutes();

  // Ora italiana per i messaggi
  const itOff  = (now.getUTCMonth() >= 2 && now.getUTCMonth() <= 9) ? 2 : 1;
  const itH    = (now.getUTCHours() + itOff) % 24;
  const itTime = `${itH.toString().padStart(2,'0')}:${now.getUTCMinutes().toString().padStart(2,'0')}`;

  // Orari in minuti NY
  // 08:30 NY = 510 min  → pre-market inizia
  // 09:30 NY = 570 min  → apertura NYSE
  // 16:00 NY = 960 min  → chiusura NYSE
  // 17:00 NY = 1020 min → fine after-hours ridotto

  // Calcola ora apertura/chiusura in ora italiana per i messaggi
  const preOpenIT  = dst ? '13:30' : '14:30'; // 08:30 NY
  const openIT     = dst ? '14:30' : '15:30'; // 09:30 NY
  const closeIT    = dst ? '21:00' : '22:00'; // 16:00 NY
  const afterEndIT = dst ? '22:00' : '23:00'; // 17:00 NY

  // Weekend
  if (nyDay === 0 || nyDay === 6)
    return { open: false, reason: `Weekend — riprende lunedì alle ${preOpenIT} ora italiana` };

  // Pre-market ridotto: 08:30–09:30 NY
  if (nyMin >= 510 && nyMin < 570)
    return { open: true, reason: `Pre-market (${itTime} ora italiana)`, premarket: true };

  // Mercato regolare: 09:30–16:00 NY
  if (nyMin >= 570 && nyMin < 960)
    return { open: true, reason: `NYSE/Nasdaq aperto (${itTime} ora italiana)` };

  // After-hours ridotto: 16:00–17:00 NY
  if (nyMin >= 960 && nyMin < 1020)
    return { open: true, reason: `After-hours (${itTime} ora italiana)`, afterhours: true };

  // Tutto il resto — pausa
  return { open: false, reason: `Mercati chiusi — riprende alle ${preOpenIT} ora italiana` };
}

// ─── Loop principale SEQUENZIALE — un solo asset alla volta ──────────────────
async function mainLoop() {
  let idx = 0;
  while (true) {
    const status = marketStatus();

    if (!status.open) {
      broadcastMarketStatus(status);
      console.log(`⏸ ${status.reason}`);
      await sleep(60000); // controlla ogni minuto
      continue;
    }

    broadcastMarketStatus(status);
    const sym = symbols[idx % symbols.length];
    idx++;

    try {
      const { quote, candles } = await fetchAll(sym, '1min', 60);
      const indicators = computeIndicators(candles);
      const signal     = generateSignal(indicators, quote.price);
      state[sym]       = { quote, candles, indicators, signal, updatedAt: Date.now() };
      broadcast({ type:'asset_update', symbol:sym, meta:ASSETS[sym],
                  quote, candles:candles.slice(-60), indicators, signal });
      console.log(`[${new Date().toLocaleTimeString()}] ${sym.padEnd(6)} ${String(quote.price.toFixed(2)).padStart(10)} | ${signal.type} (${signal.confidence})`);
    } catch (err) {
      console.error(`Error ${sym}: ${err.message?.slice(0,80)}`);
    }

    await sleep(1000); // 1s tra ogni asset → ciclo 12s, max 60/min — ok con Alpaca (limite 200/min)
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Client connesso');
  ws.send(JSON.stringify({ type: 'market_status', ...marketStatus() }));
  for (const [sym, d] of Object.entries(state)) {
    if (!d.quote) continue;
    ws.send(JSON.stringify({ type:'asset_update', symbol:sym, meta:ASSETS[sym],
      quote:d.quote, candles:d.candles.slice(-60), indicators:d.indicators, signal:d.signal }));
  }
  ws.on('close', () => console.log('Client disconnesso'));
});

app.get('/api/state',  (req, res) => res.json(state));
app.get('/api/market', (req, res) => res.json(marketStatus()));

// ─── Avvio ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 ScalpingOS — ${symbols.length} asset`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`Stato mercato: ${marketStatus().reason}\n`);
  mainLoop(); // avvia loop sequenziale
});
