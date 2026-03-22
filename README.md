# Scalping Dashboard — Live

Dashboard per scalping trading con dati reali da Yahoo Finance, WebSocket live e analisi AI powered by Claude.

---

## Requisiti

- **Node.js** v18 o superiore → https://nodejs.org
- Connessione internet
- (Opzionale) API key Anthropic per analisi AI → https://console.anthropic.com

---

## Installazione e avvio

```bash
# 1. Entra nella cartella
cd scalping-dashboard

# 2. Installa le dipendenze
npm install

# 3. Avvia il server
npm start
```

Apri il browser su **http://localhost:3000**

---

## Architettura

```
Browser (Dashboard HTML)
    │
    │  WebSocket ws://localhost:3000
    │
Node.js Server (Express + WS)
    │
    ├── Yahoo Finance v7 API  →  Quote real-time
    ├── Yahoo Finance v8 API  →  Candele 1m/5m/15m
    │
    └── Indicators Engine
            RSI(14), MACD(12,26,9), EMA9/21/50
            VWAP, Bollinger Bands(20,2), ATR(14)
            Order Flow proxy (volume delta)
            Signal Generator (score-based multi-factor)
```

---

## Asset monitorati

| Simbolo | Asset           | Tipo      |
|---------|-----------------|-----------|
| SPY     | S&P 500 ETF     | Index     |
| QQQ     | Nasdaq 100      | Index     |
| AAPL    | Apple Inc.      | Stock     |
| MSFT    | Microsoft       | Stock     |
| GC=F    | Oro Futures     | Commodity |
| CL=F    | Petrolio WTI    | Commodity |
| GLD     | Gold ETF        | Commodity |

Per aggiungere altri asset, modifica l'oggetto `ASSETS` in `server/index.js`.

---

## Indicatori tecnici

| Indicatore       | Parametri | Segnale                          |
|------------------|-----------|----------------------------------|
| RSI              | 14p       | <30 oversold / >70 overbought    |
| MACD             | 12/26/9   | histogram + cross                |
| EMA Crossover    | 9/21      | golden/death cross               |
| VWAP             | intraday  | price sopra/sotto                |
| Bollinger Bands  | 20p, 2σ   | squeeze + breakout               |
| ATR              | 14p       | stop loss / take profit dinamici |
| Order Flow       | 10 candle | volume delta buy/sell            |

---

## Logica segnali

Il sistema assegna un **punteggio** da -10 a +10 sommando contributi di ogni indicatore:

| Condizione              | Score |
|-------------------------|-------|
| RSI < 30 (oversold)     | +3    |
| RSI 30-40               | +1    |
| RSI > 70 (overbought)   | -3    |
| MACD histogram > 0      | +2    |
| EMA9 > EMA21 (bull)     | +2    |
| Price > VWAP            | +1    |
| Order flow buy > 65%    | +2    |
| Price < BB lower        | +1    |
| Momentum positivo       | +1    |

- Score ≥ 6 → **BUY Alta confidenza**
- Score 3-5 → **BUY Media confidenza**
- Score ≤ -6 → **SELL Alta confidenza**
- Score -3/-5 → **SELL Media confidenza**
- Altrimenti → **ATTENDI**

Stop Loss e Take Profit sono calcolati dinamicamente con **ATR × 1.5** (SL) e **ATR × 3** (TP), garantendo un Risk/Reward di 1:2.

---

## Analisi AI (Claude)

Il bottone "Analizza con AI" invia tutti gli indicatori e il segnale corrente a Claude per un'analisi contestuale in linguaggio naturale: contesto di mercato, validità del segnale, rischi e consiglio operativo preciso.

L'API key Anthropic è gestita automaticamente dalla dashboard Claude.ai. Se usi la dashboard standalone, aggiungi la tua chiave in `public/index.html` nell'header della fetch verso `api.anthropic.com`.

---

## Disclaimer

⚠️ Questo strumento è a scopo **educativo e informativo**. Non costituisce consulenza finanziaria. Il trading comporta rischi significativi di perdita del capitale. Operi sempre con capitale che puoi permetterti di perdere.
