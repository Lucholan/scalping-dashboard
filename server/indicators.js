/**
 * indicators.js — sistema migliorato
 *
 * Indicatori e pesi:
 *   Volume Ratio (20p)   ±3  NUOVO
 *   Order Flow (10p)     ±3  era ±2
 *   EMA crossover 9/21   ±2
 *   VWAP intraday        ±2  era ±1
 *   RSI (14)             ±2  era ±3
 *   ROC (5p)             ±2  NUOVO
 *   MACD (12/26/9)       ±1  era ±2
 *   Bollinger Bands      ±1
 *   Score massimo        ±16
 *   Soglia BUY/SELL      ±4 Media / ±8 Alta
 *
 * Filtri pre-segnale:
 *   1. ATR minimo   — mercato troppo piatto → ATTENDI
 *   2. Volume min   — liquidità insufficiente → ATTENDI
 *   3. Momentum     — conferma direzione (rimosso come score, usato come filtro)
 */

// ─── Utility ──────────────────────────────────────────────────────────────────

function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return +result.toFixed(6);
}

function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  return +(slice.reduce((a, b) => a + b, 0) / period).toFixed(6);
}

// ─── RSI ──────────────────────────────────────────────────────────────────────
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(-(period + 1))
    .map((v, i, a) => i === 0 ? 0 : v - a[i - 1])
    .slice(1);
  let gains = 0, losses = 0;
  for (const c of changes) {
    if (c > 0) gains += c;
    else losses += Math.abs(c);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────
function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  const macdSeries = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e12 = ema(slice, fast);
    const e26 = ema(slice, slow);
    if (e12 !== null && e26 !== null) macdSeries.push(e12 - e26);
  }
  const macdLine  = macdSeries[macdSeries.length - 1];
  const signalLine = ema(macdSeries, signal) ?? macdLine;
  const histogram  = macdLine - signalLine;
  return {
    macd:      +macdLine.toFixed(6),
    signal:    +signalLine.toFixed(6),
    histogram: +histogram.toFixed(6),
  };
}

// ─── VWAP ─────────────────────────────────────────────────────────────────────
function vwap(candles) {
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol === 0 ? null : +(cumTPV / cumVol).toFixed(6);
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────
function bollingerBands(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice  = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper:     +(middle + mult * stdDev).toFixed(6),
    middle:    +middle.toFixed(6),
    lower:     +(middle - mult * stdDev).toFixed(6),
    bandwidth: +((mult * 2 * stdDev) / middle * 100).toFixed(2),
  };
}

// ─── Order Flow proxy ─────────────────────────────────────────────────────────
function orderFlow(candles, lookback = 10) {
  const recent = candles.slice(-lookback);
  let buyVol = 0, sellVol = 0;
  for (const c of recent) {
    if (c.close >= c.open) buyVol  += c.volume;
    else                   sellVol += c.volume;
  }
  const total = buyVol + sellVol || 1;
  return {
    buyVolume:  buyVol,
    sellVolume: sellVol,
    buyPct:     +(buyVol / total * 100).toFixed(1),
    sellPct:    +(sellVol / total * 100).toFixed(1),
    delta:      buyVol - sellVol,
  };
}

// ─── Volume Ratio (NUOVO) ─────────────────────────────────────────────────────
// Rapporto tra volume ultima candela e media volume 20 periodi
function volumeRatio(candles, period = 20) {
  if (candles.length < period + 1) return null;
  const recent  = candles.slice(-period);
  const avgVol  = recent.reduce((a, c) => a + c.volume, 0) / period;
  const lastVol = candles[candles.length - 1].volume;
  if (avgVol === 0) return null;
  return +(lastVol / avgVol).toFixed(2);
}

// ─── ATR (Average True Range) ─────────────────────────────────────────────────
function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return +(trs.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(6);
}

// ─── Momentum ─────────────────────────────────────────────────────────────────
function momentum(closes, period = 10) {
  if (closes.length < period + 1) return 0;
  return +(closes[closes.length - 1] - closes[closes.length - 1 - period]).toFixed(6);
}

// ─── ROC — Rate of Change (NUOVO) ────────────────────────────────────────────
// Variazione percentuale del prezzo negli ultimi N periodi
function roc(closes, period = 5) {
  if (closes.length < period + 1) return null;
  const current = closes[closes.length - 1];
  const past    = closes[closes.length - 1 - period];
  if (past === 0) return null;
  return +((current - past) / past * 100).toFixed(4);
}

// ─── Compute all indicators ───────────────────────────────────────────────────
function computeIndicators(candles) {
  if (!candles || candles.length < 2) return null;
  const closes = candles.map(c => c.close);
  const price  = closes[closes.length - 1];

  return {
    price,
    rsi:        rsi(closes, 14),
    macd:       macd(closes),
    ema9:       ema(closes, 9),
    ema21:      ema(closes, 21),
    ema50:      ema(closes, 50),
    sma20:      sma(closes, 20),
    vwap:       vwap(candles),
    bb:         bollingerBands(closes),
    orderFlow:  orderFlow(candles),
    volumeRatio: volumeRatio(candles),
    momentum:   momentum(closes),
    roc:        roc(closes, 5),
    atr:        atr(candles),
  };
}

// ─── Filtri pre-segnale ───────────────────────────────────────────────────────
function applyFilters(ind, price) {
  const reasons = [];

  // Filtro 1: ATR minimo — mercato troppo piatto
  if (ind.atr !== null) {
    const atrPct = (ind.atr / price) * 100;
    if (atrPct < 0.05) {
      reasons.push('Mercato troppo piatto (ATR < 0.05%) — segnale soppresso');
      return { filtered: true, reasons };
    }
  }

  // Filtro 2: Volume minimo — liquidità insufficiente
  if (ind.volumeRatio !== null && ind.volumeRatio < 0.30) {
    reasons.push(`Volume insufficiente (${ind.volumeRatio}x media) — segnale soppresso`);
    return { filtered: true, reasons };
  }

  return { filtered: false, reasons: [] };
}

// ─── Signal generation ────────────────────────────────────────────────────────
function generateSignal(ind, price) {
  if (!ind) return { type:'ATTENDI', confidence:'Bassa', score:0, reasons:[] };

  // Applica filtri — se attivati, ritorna ATTENDI con motivazione
  const { filtered, reasons: filterReasons } = applyFilters(ind, price);
  if (filtered) {
    return { type:'ATTENDI', confidence:'Bassa', score:0, reasons: filterReasons,
      entry:price, stopLoss:null, takeProfit:null, riskReward:null, generatedAt:Date.now() };
  }

  let score = 0;
  const reasons = [];

  // ── 1. Volume Ratio ±3 (NUOVO) ────────────────────────────────────────────
  if (ind.volumeRatio !== null) {
    if (ind.volumeRatio > 2.0) {
      // Volume molto alto — amplifica la direzione del prezzo
      const priceDir = ind.roc !== null ? (ind.roc > 0 ? 1 : -1) : 0;
      score += 3 * priceDir;
      if (priceDir > 0) reasons.push(`Volume ${ind.volumeRatio.toFixed(1)}x media — forte pressione rialzista`);
      else if (priceDir < 0) reasons.push(`Volume ${ind.volumeRatio.toFixed(1)}x media — forte pressione ribassista`);
    } else if (ind.volumeRatio > 1.3) {
      const priceDir = ind.roc !== null ? (ind.roc > 0 ? 1 : -1) : 0;
      score += 1 * priceDir;
      if (priceDir !== 0) reasons.push(`Volume ${ind.volumeRatio.toFixed(1)}x media — conferma direzione`);
    }
    // Volume basso (0.3–1.0): neutro, già filtrato se < 0.3
  }

  // ── 2. Order Flow ±3 ─────────────────────────────────────────────────────
  if (ind.orderFlow) {
    if (ind.orderFlow.buyPct > 65) {
      score += 3; reasons.push(`Order flow buy ${ind.orderFlow.buyPct}% — compratori dominanti`);
    } else if (ind.orderFlow.buyPct > 55) {
      score += 1; reasons.push(`Order flow buy ${ind.orderFlow.buyPct}% — leggera pressione acquisti`);
    } else if (ind.orderFlow.sellPct > 65) {
      score -= 3; reasons.push(`Order flow sell ${ind.orderFlow.sellPct}% — venditori dominanti`);
    } else if (ind.orderFlow.sellPct > 55) {
      score -= 1; reasons.push(`Order flow sell ${ind.orderFlow.sellPct}% — leggera pressione vendite`);
    }
  }

  // ── 3. EMA crossover ±2 ──────────────────────────────────────────────────
  if (ind.ema9 !== null && ind.ema21 !== null) {
    if (ind.ema9 > ind.ema21) {
      score += 2; reasons.push('EMA9 > EMA21 — golden cross bullish');
    } else {
      score -= 2; reasons.push('EMA9 < EMA21 — death cross bearish');
    }
  }

  // ── 4. VWAP ±2 ───────────────────────────────────────────────────────────
  if (ind.vwap !== null) {
    const pctFromVwap = ((price - ind.vwap) / ind.vwap) * 100;
    if (pctFromVwap > 0.1) {
      score += 2; reasons.push(`Prezzo +${pctFromVwap.toFixed(2)}% sopra VWAP`);
    } else if (pctFromVwap > 0) {
      score += 1; reasons.push(`Prezzo appena sopra VWAP (+${pctFromVwap.toFixed(2)}%)`);
    } else if (pctFromVwap < -0.1) {
      score -= 2; reasons.push(`Prezzo ${pctFromVwap.toFixed(2)}% sotto VWAP`);
    } else {
      score -= 1; reasons.push(`Prezzo appena sotto VWAP (${pctFromVwap.toFixed(2)}%)`);
    }
  }

  // ── 5. RSI ±2 ────────────────────────────────────────────────────────────
  if (ind.rsi !== null) {
    if (ind.rsi < 30) {
      score += 2; reasons.push(`RSI ${ind.rsi} — oversold`);
    } else if (ind.rsi < 40) {
      score += 1; reasons.push(`RSI ${ind.rsi} — zona oversold`);
    } else if (ind.rsi > 70) {
      score -= 2; reasons.push(`RSI ${ind.rsi} — overbought`);
    } else if (ind.rsi > 60) {
      score -= 1; reasons.push(`RSI ${ind.rsi} — zona overbought`);
    }
  }

  // ── 6. ROC — Rate of Change ±2 (NUOVO) ───────────────────────────────────
  if (ind.roc !== null) {
    if (ind.roc > 0.3) {
      score += 2; reasons.push(`ROC +${ind.roc.toFixed(2)}% — forte accelerazione rialzista`);
    } else if (ind.roc > 0.1) {
      score += 1; reasons.push(`ROC +${ind.roc.toFixed(2)}% — momentum positivo`);
    } else if (ind.roc < -0.3) {
      score -= 2; reasons.push(`ROC ${ind.roc.toFixed(2)}% — forte accelerazione ribassista`);
    } else if (ind.roc < -0.1) {
      score -= 1; reasons.push(`ROC ${ind.roc.toFixed(2)}% — momentum negativo`);
    }
  }

  // ── 7. MACD histogram ±1 ─────────────────────────────────────────────────
  if (ind.macd) {
    if (ind.macd.histogram > 0) {
      score += 1; reasons.push(`MACD hist +${ind.macd.histogram.toFixed(4)} — positivo`);
    } else {
      score -= 1; reasons.push(`MACD hist ${ind.macd.histogram.toFixed(4)} — negativo`);
    }
  }

  // ── 8. Bollinger Bands ±1 ────────────────────────────────────────────────
  if (ind.bb) {
    if (price < ind.bb.lower) {
      score += 1; reasons.push(`Prezzo sotto banda BB inferiore (${ind.bb.lower.toFixed(2)})`);
    } else if (price > ind.bb.upper) {
      score -= 1; reasons.push(`Prezzo sopra banda BB superiore (${ind.bb.upper.toFixed(2)})`);
    }
  }

  // ── Classificazione finale ────────────────────────────────────────────────
  let type, confidence;
  if      (score >= 8)  { type = 'BUY';     confidence = 'Alta'; }
  else if (score >= 4)  { type = 'BUY';     confidence = 'Media'; }
  else if (score <= -8) { type = 'SELL';    confidence = 'Alta'; }
  else if (score <= -4) { type = 'SELL';    confidence = 'Media'; }
  else                  { type = 'ATTENDI'; confidence = 'Bassa'; }

  // ── Risk management dinamico con ATR ─────────────────────────────────────
  const atrVal   = ind.atr ?? price * 0.001;
  const slMult   = 1.5;
  const tpMult   = 3.0;
  const stopLoss   = type === 'BUY'  ? +(price - atrVal * slMult).toFixed(4)
                   : type === 'SELL' ? +(price + atrVal * slMult).toFixed(4) : null;
  const takeProfit = type === 'BUY'  ? +(price + atrVal * tpMult).toFixed(4)
                   : type === 'SELL' ? +(price - atrVal * tpMult).toFixed(4) : null;

  return {
    type,
    confidence,
    score,
    reasons,
    entry:       price,
    stopLoss,
    takeProfit,
    riskReward:  stopLoss && takeProfit ? 2.0 : null,
    generatedAt: Date.now(),
  };
}

module.exports = { computeIndicators, generateSignal, ema, rsi, macd, vwap, bollingerBands, orderFlow, volumeRatio, roc };
