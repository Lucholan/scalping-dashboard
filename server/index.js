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
  'NVDA':  { name:'NVIDIA',                type:'stock', region:'USA' },
  'GOOGL': { name:'Alphabet',              type:'stock', region:'USA' },
  'PLTR':  { name:'Palantir',              type:'stock', region:'USA' },
  'TSM':   { name:'Taiwan Semiconductor', type:'stock', region:'USA' },
  'ORCL':  { name:'Oracle',               type:'stock', region:'USA' },
  'SMCI':  { name:'Super Micro Computer', type:'stock', region:'USA' },
  'SNDK':  { name:'SanDisk',              type:'stock', region:'USA' },
  'RKLB':  { name:'Rocket Lab',           type:'stock', region:'USA' },
  'SOFI':  { name:'SoFi Technologies',    type:'stock', region:'USA' },
  'MU':    { name:'Micron Technology',    type:'stock', region:'USA' },
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
  const nyDate = new Date(now.getTime() - offset * 3600000);
  const nyDay  = nyDate.getUTCDay();
  const nyMin  = nyDate.getUTCHours() * 60 + nyDate.getUTCMinutes();
  const itOff  = (now.getUTCMonth() >= 2 && now.getUTCMonth() <= 9) ? 2 : 1;
  const itH    = (now.getUTCHours() + itOff) % 24;
  const itTime = `${itH.toString().padStart(2,'0')}:${now.getUTCMinutes().toString().padStart(2,'0')}`;

  if (nyDay === 0 || nyDay === 6)
    return { open: false, reason: `Weekend — mercati chiusi (${itTime} ora italiana)` };
  if (nyMin >= 240 && nyMin < 570)
    return { open: true, reason: `Pre-market USA (${itTime} ora italiana)`, premarket: true };
  if (nyMin >= 570 && nyMin < 960)
    return { open: true, reason: `NYSE/Nasdaq aperto (${itTime} ora italiana)` };
  if (nyMin >= 960 && nyMin < 1200)
    return { open: true, reason: `After-hours USA (${itTime} ora italiana)`, afterhours: true };
  return { open: false, reason: `Mercati chiusi — pre-market alle ${dst ? 10 : 9}:00 ora italiana` };
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

    await sleep(8000); // 8s tra ogni asset → max 7.5/min, ~270/giorno
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
