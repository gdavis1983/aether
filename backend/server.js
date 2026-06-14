const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ccxt = require('ccxt');
const dotenv = require('dotenv');

const { calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateAwesomeOscillator, calculateFibonacciLevels, calculateElliottWaves, calculateATR, calculateADX, calculateRelativeVolume } = require('./indicators');
const { getTradingDecision, askBrainQuestion } = require('./brain');
const { sendTelegramAlert, sendSMSAlert } = require('./notifications');

// Load environment variables if available
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const userDataPath = process.env.AETHER_USER_DATA_PATH;
const DB_PATH = userDataPath ? path.join(userDataPath, 'db.json') : path.join(__dirname, 'db.json');
const LOGS_DIR = userDataPath ? path.join(userDataPath, 'logs') : path.join(__dirname, 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Migrate database file if running in Electron and AppData db.json doesn't exist yet
if (userDataPath && !fs.existsSync(DB_PATH)) {
  const localDBPath = path.join(__dirname, 'db.json');
  try {
    if (fs.existsSync(localDBPath)) {
      fs.copyFileSync(localDBPath, DB_PATH);
      console.log(`Migrated local database to AppData: ${DB_PATH}`);
    }
  } catch (err) {
    console.error("Failed to migrate local database to AppData:", err);
  }
}

// Bot interval runtime state
let botIntervalId = null;
let isBotRunning = false;
let lastBalanceSyncTime = 0; // Throttle live balance API checks

// Helpers to read/write local database
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error("db.json does not exist");
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading database:", err);
    return { portfolio: { balanceUSD: 10000, positions: {} }, trades: [], logs: [], settings: {} };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing database:", err);
  }
}

// Write to system logs
function addLog(type, message) {
  const db = readDB();
  const newLog = {
    timestamp: new Date().toISOString(),
    type, // 'info', 'trade', 'brain', 'error'
    message
  };
  
  // Keep logs list capped at 1000 items in JSON DB to prevent bloat
  db.logs.unshift(newLog);
  if (db.logs.length > 1000) {
    db.logs = db.logs.slice(0, 1000);
  }
  writeDB(db);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Compile the Performance Memory Journal for the LLM
 */
function compilePerformanceJournal(db, mode, limit = 3) {
  if (!db.trades) return "No recent trade history available.";
  
  const filteredTrades = db.trades
    .filter(t => t.mode === mode)
    .slice(0, limit);

  if (filteredTrades.length === 0) {
    return "No recent trade history available in this mode.";
  }

  let journal = "";
  filteredTrades.forEach((t, idx) => {
    const returnInfo = t.netReturn ? ` | Return: ${t.netReturn}` : "";
    journal += `${idx + 1}. ${t.action} (${t.symbol}) | Price: $${t.price.toFixed(4)} | Amount: ${t.amount.toFixed(6)} | Total Value: $${t.total.toFixed(2)}${returnInfo} | Timestamp: ${new Date(t.timestamp).toLocaleTimeString()}\n`;
    journal += `   - Rationale/Trigger: "${t.reasoning || 'No details recorded.'}"\n\n`;
  });

  return journal.trim();
}

// Clean up Coinbase CDP API Key formatting
function cleanCDPApiKey(key) {
  if (!key) return key;
  let clean = String(key).trim();
  
  if (clean.includes('organizations/')) {
    const startIdx = clean.indexOf('organizations/');
    const afterStart = clean.substring(startIdx);
    const nextQuote = afterStart.indexOf('"');
    const nextSingleQuote = afterStart.indexOf("'");
    
    let resolvedNextQuote = -1;
    if (nextQuote !== -1 && nextSingleQuote !== -1) {
      resolvedNextQuote = Math.min(nextQuote, nextSingleQuote);
    } else if (nextQuote !== -1) {
      resolvedNextQuote = nextQuote;
    } else if (nextSingleQuote !== -1) {
      resolvedNextQuote = nextSingleQuote;
    }
    
    if (resolvedNextQuote !== -1) {
      clean = afterStart.substring(0, resolvedNextQuote);
    } else {
      clean = afterStart;
    }
  }

  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.substring(1, clean.length - 1);
  }
  
  return clean.trim();
}

// Clean up Coinbase CDP Private Key PEM string formatting
function cleanCDPSecret(secret) {
  if (!secret) return secret;
  let clean = String(secret).trim();
  
  if (clean.includes('-----BEGIN EC PRIVATE KEY-----')) {
    const startIdx = clean.indexOf('-----BEGIN');
    const endIdx = clean.indexOf('-----END PRIVATE KEY-----');
    const endIdxAlt = clean.indexOf('-----END EC PRIVATE KEY-----');
    
    let resolvedEndIdx = -1;
    let pemLength = 0;
    
    if (endIdxAlt !== -1) {
      resolvedEndIdx = endIdxAlt;
      pemLength = '-----END EC PRIVATE KEY-----'.length;
    } else if (endIdx !== -1) {
      resolvedEndIdx = endIdx;
      pemLength = '-----END PRIVATE KEY-----'.length;
    }
    
    if (startIdx !== -1 && resolvedEndIdx !== -1) {
      clean = clean.substring(startIdx, resolvedEndIdx + pemLength);
    }
  }

  // Replace literal '\n' sequences with real newlines
  clean = clean.replace(/\\n/g, '\n');
  
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.substring(1, clean.length - 1);
  }
  
  return clean.trim();
}

// Instantiate CCXT Exchange (Public calls don't need credentials)
function getExchangeInstance(settings) {
  const name = settings.exchangeName.toLowerCase();
  if (ccxt[name]) {
    const config = {};
    if (settings.exchangeApiKey && settings.exchangeApiSecret) {
      config.apiKey = cleanCDPApiKey(settings.exchangeApiKey);
      config.secret = cleanCDPSecret(settings.exchangeApiSecret);
    }
    const exchange = new ccxt[name](config);
    // Disable price requirement for market buy orders on Coinbase Advanced
    if (name === 'coinbase') {
      exchange.options['createMarketBuyOrderRequiresPrice'] = false;
    }
    return exchange;
  }
  const defaultExchange = new ccxt.coinbase();
  defaultExchange.options['createMarketBuyOrderRequiresPrice'] = false;
  return defaultExchange;
}

/**
 * Fetch recent crypto news from CryptoCompare v2 news API
 */
async function fetchCryptoNews() {
  try {
    const res = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.Data)) {
        return data.Data.slice(0, 5).map(item => ({
          title: item.title,
          body: item.body ? (item.body.substring(0, 150) + "...") : "",
          categories: item.categories
        }));
      }
    }
  } catch (err) {
    console.error("Failed to fetch crypto news:", err.message);
  }
  return [
    { title: "Market consolidates near key support levels ahead of macroeconomic reports.", body: "Traders remain cautious as Bitcoin and major altcoins trade in tight ranges ahead of upcoming interest rate decisions.", categories: "Market" }
  ];
}

/**
 * Fetch historical candles and calculate indicators
 */
async function getMarketContext(exchange, symbol, timeframe, limit = 100) {
  try {
    // CCXT fetchOHLCV returns: [ [timestamp, open, high, low, close, volume], ... ]
    const candlesRaw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    if (!candlesRaw || candlesRaw.length === 0) {
      throw new Error(`No candle data returned from exchange for ${symbol} (${timeframe})`);
    }

    const candles = candlesRaw.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));

    const closePrices = candles.map(c => c.close);
    
    // Calculate technical indicators
    const indicators = {
      sma9: calculateSMA(closePrices, 9),
      sma21: calculateSMA(closePrices, 21),
      rsi: calculateRSI(closePrices, 14),
      macd: calculateMACD(closePrices, 12, 26, 9),
      ao: calculateAwesomeOscillator(candles),
      fib: calculateFibonacciLevels(candles, 50),
      atr: calculateATR(candles, 14),
      adx: calculateADX(candles, 14),
      rvol: calculateRelativeVolume(candles, 20)
    };

    const tickerRaw = await exchange.fetchTicker(symbol);
    const ticker = {
      symbol: tickerRaw.symbol,
      high: tickerRaw.high,
      low: tickerRaw.low,
      close: tickerRaw.last || tickerRaw.close,
      volume: tickerRaw.baseVolume
    };

    return {
      ticker,
      indicators,
      recentCandles: candles
    };
  } catch (err) {
    throw new Error(`Failed to fetch market data: ${err.message}`);
  }
}

/**
 * Execute a simulated paper trade
 */
function executePaperTrade(action, amountPct, currentPrice, assetName, db, reasoning = '') {
  const feePct = 0.001; // 0.1% trade fee
  let tradeDetails = null;

  if (action === 'BUY') {
    const availableCash = db.portfolio.balanceUSD;
    if (availableCash <= 10) {
      return { success: false, message: "Insufficient USD balance to place a meaningful trade (must be > $10)." };
    }

    const allocation = availableCash * (amountPct / 100);
    const fee = allocation * feePct;
    const netAllocation = allocation - fee;
    const buyAmount = netAllocation / currentPrice;

    db.portfolio.balanceUSD -= allocation;
    if (!db.portfolio.positions[assetName]) {
      db.portfolio.positions[assetName] = { amount: 0, avgEntryPrice: 0 };
    }

    const pos = db.portfolio.positions[assetName];
    const totalCost = (pos.amount * pos.avgEntryPrice) + netAllocation;
    pos.amount += buyAmount;
    pos.avgEntryPrice = pos.amount > 0 ? (totalCost / pos.amount) : 0;

    tradeDetails = {
      timestamp: new Date().toISOString(),
      symbol: db.settings?.selectedAsset || `${assetName}/USD`,
      action: 'BUY',
      price: currentPrice,
      amount: buyAmount,
      total: allocation,
      fee: fee,
      balanceAfter: db.portfolio.balanceUSD,
      reasoning: reasoning,
      mode: db.settings?.tradingMode || 'paper'
    };
  } else if (action === 'SELL') {
    const pos = db.portfolio.positions[assetName];
    if (!pos || pos.amount <= 0.00001) {
      return { success: false, message: `No holdings in ${assetName} to sell.` };
    }

    const avgEntry = pos.avgEntryPrice;
    const sellAmount = pos.amount * (amountPct / 100);
    const grossTotal = sellAmount * currentPrice;
    const fee = grossTotal * feePct;
    const netProceeds = grossTotal - fee;

    db.portfolio.balanceUSD += netProceeds;
    pos.amount -= sellAmount;
    
    const buyCost = sellAmount * avgEntry;
    const netReturnVal = netProceeds - buyCost;
    const netReturnPct = avgEntry > 0 ? (((currentPrice - avgEntry) / avgEntry) * 100) : 0;

    if (pos.amount <= 0.00001) {
      delete db.portfolio.positions[assetName];
    }

    tradeDetails = {
      timestamp: new Date().toISOString(),
      symbol: db.settings?.selectedAsset || `${assetName}/USD`,
      action: 'SELL',
      price: currentPrice,
      amount: sellAmount,
      total: grossTotal,
      fee: fee,
      balanceAfter: db.portfolio.balanceUSD,
      reasoning: reasoning,
      mode: db.settings?.tradingMode || 'paper',
      netReturnVal: Number(netReturnVal.toFixed(4)),
      netReturnPct: Number(netReturnPct.toFixed(2)),
      netReturn: `${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}% ($${netReturnVal.toFixed(2)})`
    };
  }

  if (tradeDetails) {
    db.trades.unshift(tradeDetails);
    writeDB(db);
    return { success: true, trade: tradeDetails };
  }

  return { success: false, message: "No execution changes (HOLD or failed logic)." };
}

/**
 * Execute a real market trade on Coinbase Advanced
 */
async function executeLiveTrade(exchange, action, amountPct, currentPrice, assetName, db, symbol, reasoning = '') {
  addLog('info', `Attempting Live Market ${action} order on Coinbase Advanced for ${symbol}...`);

  try {
    // 1. Ensure exchange markets are loaded
    await exchange.loadMarkets();

    // 2. Fetch current balance
    const balance = await exchange.fetchBalance();
    
    let orderDetails = null;

    if (action === 'BUY') {
      const quoteCurrency = symbol.split('/')[1] || 'USD';
      const availableCash = balance.free[quoteCurrency] || 0;
      
      if (availableCash <= 5) {
        throw new Error(`Insufficient ${quoteCurrency} cash balance in Coinbase account. Free balance: $${availableCash.toFixed(2)}. Minimum required: $5.`);
      }

      // Calculate purchase cost in quote currency (USD/USDC)
      let allocation = availableCash * (amountPct / 100);
      if (allocation < 5.0 && availableCash >= 5.0) {
        allocation = 5.0; // Auto scale up to exchange minimum
      }
      if (allocation > availableCash) {
        allocation = availableCash;
      }
      const costRounded = Number(exchange.costToPrecision(symbol, allocation));

      if (costRounded < 5) {
        throw new Error(`Calculated purchase amount ($${costRounded}) is below the exchange minimum of $5.`);
      }

      addLog('info', `Placing Live Market BUY spending $${costRounded} ${quoteCurrency}...`);

      // Execute order on Coinbase
      const order = await exchange.createMarketBuyOrder(symbol, costRounded);
      
      orderDetails = {
        timestamp: new Date().toISOString(),
        symbol: symbol,
        action: 'BUY',
        price: order.price || currentPrice,
        amount: order.amount || (costRounded / currentPrice),
        total: order.cost || (order.amount * order.price) || costRounded,
        fee: (order.fee && typeof order.fee.cost === 'number') ? order.fee.cost : (order.cost ? order.cost * 0.001 : costRounded * 0.001),
        balanceAfter: balance.free[quoteCurrency] - (order.cost || costRounded),
        reasoning: reasoning,
        mode: 'live'
      };

    } else if (action === 'SELL') {
      const holdings = balance.free[assetName] || 0;

      if (holdings <= 0.00001) {
        throw new Error(`No live holdings found for ${assetName} in Coinbase account.`);
      }

      // Calculate quantity to sell
      let sellAmount = holdings * (amountPct / 100);
      const positionValuation = holdings * currentPrice;

      // If the sell value is less than $5 but total position is worth more than $5, scale up to exchange minimum
      if (sellAmount * currentPrice < 5.0 && positionValuation >= 5.0) {
        sellAmount = 5.0 / currentPrice;
      }

      // If the remaining position value would be less than $2, just liquidate the whole position
      const remainingValuation = (holdings - sellAmount) * currentPrice;
      if (remainingValuation > 0 && remainingValuation < 2.0) {
        sellAmount = holdings;
      }

      const sellAmountRounded = Number(exchange.amountToPrecision(symbol, sellAmount));

      if (sellAmountRounded <= 0) {
        throw new Error(`Calculated sell size is too small for exchange rules. Raw size: ${sellAmount}, rounded size: ${sellAmountRounded}`);
      }

      addLog('info', `Placing Live Market SELL for ${sellAmountRounded} ${assetName}...`);

      // Execute order on Coinbase
      const order = await exchange.createMarketSellOrder(symbol, sellAmountRounded);

      const quoteCurrency = symbol.split('/')[1] || 'USD';
      
      const orderPrice = order.price || currentPrice;
      const orderAmount = order.amount || sellAmountRounded;
      const orderTotal = order.cost || (order.amount * order.price) || (sellAmountRounded * currentPrice);
      const orderFee = (order.fee && typeof order.fee.cost === 'number') ? order.fee.cost : (order.cost ? order.cost * 0.001 : (sellAmountRounded * currentPrice) * 0.001);

      orderDetails = {
        timestamp: new Date().toISOString(),
        symbol: symbol,
        action: 'SELL',
        price: orderPrice,
        amount: orderAmount,
        total: orderTotal,
        fee: orderFee,
        balanceAfter: balance.free[quoteCurrency] + (order.cost || (sellAmountRounded * currentPrice)),
        reasoning: reasoning,
        mode: 'live'
      };

      const pos = db.portfolio.positions[assetName];
      const avgEntry = pos ? pos.avgEntryPrice : currentPrice;
      const buyCost = orderAmount * avgEntry;
      const netProceeds = orderTotal - orderFee;
      const netReturnVal = netProceeds - buyCost;
      const netReturnPct = avgEntry > 0 ? (((orderPrice - avgEntry) / avgEntry) * 100) : 0;

      orderDetails.netReturnVal = Number(netReturnVal.toFixed(4));
      orderDetails.netReturnPct = Number(netReturnPct.toFixed(2));
      orderDetails.netReturn = `${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}% ($${netReturnVal.toFixed(2)})`;
    }

    if (orderDetails) {
      db.trades.unshift(orderDetails);
      
      // Update UI simulated portfolio with actual live balances to sync them
      const updatedBalance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[1] || 'USD';
      db.portfolio.balanceUSD = updatedBalance.free[quoteCurrency] || 0;
      
      if (!db.portfolio.positions) db.portfolio.positions = {};
      
      if (action === 'BUY') {
        const liveAssetAmount = updatedBalance.free[assetName] || 0;
        db.portfolio.positions[assetName] = {
          amount: liveAssetAmount,
          avgEntryPrice: orderDetails.price
        };
      } else if (action === 'SELL') {
        const liveAssetAmount = updatedBalance.free[assetName] || 0;
        if (liveAssetAmount <= 0.00001) {
          delete db.portfolio.positions[assetName];
        } else {
          db.portfolio.positions[assetName] = {
            amount: liveAssetAmount,
            avgEntryPrice: db.portfolio.positions[assetName]?.avgEntryPrice || orderDetails.price
          };
        }
      }

      writeDB(db);
      return { success: true, trade: orderDetails };
    }
  } catch (err) {
    addLog('error', `Live Trade Execution Failed: ${err.message}`);
    throw err;
  }
}

/**
 * Main trading bot ticker cycle
 */
async function runBotCycle() {
  const db = readDB();
  const settings = db.settings;

  if (!settings.botEnabled) {
    addLog('info', "Bot cycle skipped: Bot is disabled.");
    stopBotLoop();
    return;
  }

  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    addLog('error', "Bot cycle failed: Missing Gemini API Key. Please configure it in settings.");
    // Auto disable bot to prevent spam
    db.settings.botEnabled = false;
    writeDB(db);
    isBotRunning = false;
    return;
  }

  const assetName = settings.selectedAsset.split('/')[0];
  addLog('info', `Starting execution tick for ${settings.selectedAsset}...`);

  try {
    const exchange = getExchangeInstance(settings);
    let marketData = await getMarketContext(exchange, settings.selectedAsset, settings.selectedTimeframe, 100);
    const currentPrice = marketData.ticker.close;

    // Calculate Market Regime Indicators
    const latestADXArr = marketData.indicators.adx.adx;
    const latestPlusDIArr = marketData.indicators.adx.plusDI;
    const latestMinusDIArr = marketData.indicators.adx.minusDI;
    const latestRVolArr = marketData.indicators.rvol;

    const currentADX = latestADXArr[latestADXArr.length - 1];
    const currentPlusDI = latestPlusDIArr[latestPlusDIArr.length - 1];
    const currentMinusDI = latestMinusDIArr[latestMinusDIArr.length - 1];
    const currentRVol = latestRVolArr[latestRVolArr.length - 1];
    
    const prevADX = latestADXArr[latestADXArr.length - 2] || currentADX;
    const isADXRising = currentADX > prevADX;
    
    const currentSma9 = marketData.indicators.sma9[marketData.indicators.sma9.length - 1];
    const currentSma21 = marketData.indicators.sma21[marketData.indicators.sma21.length - 1];

    let marketRegime = "UNKNOWN";
    if (currentADX !== null && currentADX !== undefined) {
      if (currentADX > 25) {
        if (currentPlusDI > currentMinusDI && currentPrice > currentSma21) {
          marketRegime = "TRENDING_BULLISH";
        } else if (currentMinusDI > currentPlusDI && currentPrice < currentSma21) {
          marketRegime = "TRENDING_BEARISH";
        } else {
          marketRegime = "STRONG_TREND_CONSOLIDATION";
        }
      } else if (currentADX < 20) {
        marketRegime = "CHOPPY_RANGE";
      } else {
        if (isADXRising && currentRVol > 1.5) {
          marketRegime = "HIGH_VOLATILITY_SQUEEZE";
        } else {
          marketRegime = "TRANSITIONING_ZONE";
        }
      }
    } else {
      marketRegime = "TRANSITIONING_ZONE"; // fallback if insufficient history
    }
    
    marketData.indicators.currentADX = currentADX;
    marketData.indicators.currentPlusDI = currentPlusDI;
    marketData.indicators.currentMinusDI = currentMinusDI;
    marketData.indicators.currentRVol = currentRVol;
    marketData.indicators.marketRegime = marketRegime;

    addLog('info', `[MARKET REGIME] Classified state: ${marketRegime} | ADX: ${currentADX ? currentADX.toFixed(2) : 'N/A'} | RVol: ${currentRVol ? currentRVol.toFixed(2) : 'N/A'}`);

    if (settings.multiTimeframeEnabled) {
      const macroTimeframe = settings.macroTimeframe || "1d";
      const cache = db.macroCache;
      const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms
      
      let useCache = false;
      if (cache && cache.symbol === settings.selectedAsset && cache.timeframe === macroTimeframe && cache.timestamp) {
        const age = Date.now() - new Date(cache.timestamp).getTime();
        if (age < CACHE_DURATION) {
          useCache = true;
        }
      }
      
      if (useCache) {
        addLog('info', `Using cached Macro Trend Context (${macroTimeframe === '1d' ? 'Daily Chart' : macroTimeframe}) from memory bank...`);
        marketData.macroContext = cache.data;
      } else {
        addLog('info', `Macro memory bank expired/missing. Fetching fresh daily candles...`);
        try {
          const macroContextRaw = await getMarketContext(exchange, settings.selectedAsset, macroTimeframe, 100);
          const macroData = {
            timeframe: macroTimeframe,
            indicators: macroContextRaw.indicators,
            recentCandles: macroContextRaw.recentCandles
          };
          marketData.macroContext = macroData;
          
          // Update database cache
          try {
            db.macroCache = {
              timestamp: new Date().toISOString(),
              symbol: settings.selectedAsset,
              timeframe: macroTimeframe,
              data: macroData
            };
            writeDB(db);
          } catch (cacheErr) {
            console.error("Failed to write macro cache to db:", cacheErr.message);
          }
        } catch (macroErr) {
          addLog('warning', `Failed to fetch macro context (${macroTimeframe}): ${macroErr.message}. Falling back to single timeframe analysis.`);
        }
      }
    }

    // Safety checks: Stop Loss, ATR Stop, Trailing Stop, and Take Profit
    const pos = db.portfolio.positions[assetName];
    if (pos && pos.amount > 0) {
      if (!db.highestPriceReached) db.highestPriceReached = {};
      const lastHigh = db.highestPriceReached[assetName] || 0;
      if (currentPrice > lastHigh) {
        db.highestPriceReached[assetName] = currentPrice;
        writeDB(db);
        addLog('info', `[TRAILING STOP] High water mark updated for ${assetName}: $${currentPrice.toFixed(4)}`);
      }

      let triggerSell = false;
      let triggerReason = "";

      if (settings.stopLossPct > 0) {
        const dropPct = ((pos.avgEntryPrice - currentPrice) / pos.avgEntryPrice) * 100;
        if (dropPct >= settings.stopLossPct) {
          triggerSell = true;
          triggerReason = `Hard Stop Loss hit! Price fell ${dropPct.toFixed(2)}% below entry price $${pos.avgEntryPrice.toFixed(2)}`;
        }
      }

      if (!triggerSell && settings.atrStopEnabled) {
        const latestAtr = marketData.indicators.atr[marketData.indicators.atr.length - 1];
        if (latestAtr !== null && latestAtr !== undefined) {
          const atrMultiplier = settings.atrStopMultiplier || 2.0;
          const atrStopPrice = pos.avgEntryPrice - (atrMultiplier * latestAtr);
          if (currentPrice <= atrStopPrice) {
            triggerSell = true;
            triggerReason = `ATR Volatility Stop hit! Price fell below ATR floor of $${atrStopPrice.toFixed(4)} (Entry: $${pos.avgEntryPrice.toFixed(4)}, ATR: ${latestAtr.toFixed(4)} * ${atrMultiplier})`;
          }
        }
      }

      if (!triggerSell && settings.trailingStopEnabled) {
        const peakPrice = db.highestPriceReached[assetName] || pos.avgEntryPrice;
        const trailingStopPrice = peakPrice * (1 - (settings.trailingStopPct || 2.5) / 100);
        if (currentPrice <= trailingStopPrice) {
          triggerSell = true;
          triggerReason = `Trailing Stop Loss hit! Price fell below trailing floor of $${trailingStopPrice.toFixed(4)} (Peak: $${peakPrice.toFixed(4)}, Trailing: ${settings.trailingStopPct}%)`;
        }
      }

      if (!triggerSell && settings.takeProfitEnabled) {
        const takeProfitPrice = pos.avgEntryPrice * (1 + (settings.takeProfitPct || 10.0) / 100);
        if (currentPrice >= takeProfitPrice) {
          triggerSell = true;
          triggerReason = `Take Profit target reached! Price rose to $${currentPrice.toFixed(4)} (Target: $${takeProfitPrice.toFixed(4)}, Entry: $${pos.avgEntryPrice.toFixed(4)})`;
        }
      }

      if (triggerSell) {
        addLog('info', `[SAFETY TRIGGER] ${triggerReason}. Liquidating position.`);
        
        if (db.highestPriceReached) {
          delete db.highestPriceReached[assetName];
          writeDB(db);
        }

        if (settings.tradingMode === 'live') {
          try {
            const result = await executeLiveTrade(exchange, 'SELL', 100, currentPrice, assetName, db, settings.selectedAsset, triggerReason);
            if (result.success) {
              addLog('trade', `Executed Live Safety Sell: ${result.trade.amount.toFixed(4)} ${assetName} at $${result.trade.price}`);
            }
          } catch (liveErr) {
            addLog('error', `Failed to execute live safety sell: ${liveErr.message}`);
          }
        } else {
          const result = executePaperTrade('SELL', 100, currentPrice, assetName, db, triggerReason);
          if (result.success) {
            addLog('trade', `Executed Paper Safety Sell: ${result.trade.amount.toFixed(4)} ${assetName} at $${currentPrice}`);
          }
        }
        return;
      }
    } else {
      if (db.highestPriceReached && db.highestPriceReached[assetName]) {
        delete db.highestPriceReached[assetName];
        writeDB(db);
      }
    }

    // Fetch news sentiment if enabled
    if (settings.newsSentimentEnabled) {
      addLog('info', "Fetching recent cryptocurrency news sentiment...");
      try {
        marketData.news = await fetchCryptoNews();
      } catch (newsErr) {
        addLog('warning', `Failed to fetch crypto news: ${newsErr.message}. Continuing without news sentiment.`);
      }
    }

    // Compile Performance Journal
    marketData.performanceJournal = compilePerformanceJournal(db, settings.tradingMode, 3);

    // Call Brain (LLM)
    addLog('info', "Sending data pack to Gemini Brain for trade analysis...");
    const analysis = await getTradingDecision(apiKey, marketData, db.portfolio, settings, (msg) => addLog('warning', msg));
    
    // Save latest AI diagnostic data to database
    db.latestDecision = {
      ...analysis,
      timestamp: new Date().toISOString(),
      indicators: {
        rsi: marketData.indicators.rsi[marketData.indicators.rsi.length - 1],
        sma9: marketData.indicators.sma9[marketData.indicators.sma9.length - 1],
        sma21: marketData.indicators.sma21[marketData.indicators.sma21.length - 1],
        ao: marketData.indicators.ao ? marketData.indicators.ao[marketData.indicators.ao.length - 1] : null,
        macd: marketData.indicators.macd.histogram[marketData.indicators.macd.histogram.length - 1],
        atr: marketData.indicators.atr[marketData.indicators.atr.length - 1],
        adx: currentADX,
        rvol: currentRVol,
        marketRegime: marketRegime
      },
      news: marketData.news || []
    };
    writeDB(db);
    
    addLog('brain', `Gemini Decision: ${analysis.decision} | Confidence: ${(analysis.confidence * 100).toFixed(0)}% | Amount Allocation: ${analysis.amount_pct}%`);
    addLog('brain', `Gemini Rationale: "${analysis.reasoning}"`);

    // Send real-time phone alerts
    if (settings.notificationType !== 'none' && analysis.decision !== 'HOLD') {
      const msg = `🚀 <b>AETHER EW BOT SIGNAL: ${analysis.decision}</b>\n\n` +
                  `Asset: <b>${settings.selectedAsset}</b>\n` +
                  `Price: <b>$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>\n` +
                  `Confidence: <b>${(analysis.confidence * 100).toFixed(0)}%</b>\n` +
                  `Allocation: <b>${analysis.amount_pct}%</b>\n` +
                  `📈 <b>Structure:</b> ${analysis.market_structure}\n` +
                  `🛡️ <b>Key Zones:</b> Support $${analysis.support_level.toLocaleString()} | Resist $${analysis.resistance_level.toLocaleString()}\n` +
                  `📊 <b>Risk-to-Reward:</b> ${analysis.risk_reward_ratio}\n` +
                  `📰 <b>News Sentiment:</b> ${analysis.news_sentiment_score > 0 ? '+' : ''}${analysis.news_sentiment_score}/10\n\n` +
                  `🧠 <b>Wave Rationale:</b>\n<i>"${analysis.reasoning}"</i>`;
                  
      const cleanMsg = msg.replace(/<[^>]*>/g, ''); // strip HTML for carrier SMS compatibility

      try {
        if (settings.notificationType === 'telegram') {
          await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg);
        } else if (settings.notificationType === 'sms') {
          const smtpConfig = {
            host: settings.smtpHost,
            port: settings.smtpPort,
            user: settings.smtpUser,
            pass: settings.smtpPass
          };
          await sendSMSAlert(smtpConfig, settings.phoneNumber, settings.phoneCarrier, cleanMsg);
        }
        addLog('info', `Real-time phone alert dispatched successfully via ${settings.notificationType}.`);
      } catch (notifErr) {
        addLog('error', `Failed to dispatch mobile signal alert: ${notifErr.message}`);
      }
    }

    if (analysis.decision === 'HOLD') {
      addLog('info', "Bot decision is HOLD. No orders placed.");
      return;
    }

    if (settings.tradingMode === 'paper') {
      // Execute simulated trade
      const result = executePaperTrade(analysis.decision, analysis.amount_pct, currentPrice, assetName, db, analysis.reasoning);
      if (result.success) {
        addLog('trade', `Paper Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
      } else {
        addLog('info', `Paper Trade failed: ${result.message}`);
      }
    } else {
      // Real Live Trading Mode
      try {
        const result = await executeLiveTrade(exchange, analysis.decision, analysis.amount_pct, currentPrice, assetName, db, settings.selectedAsset, analysis.reasoning);
        if (result.success) {
          addLog('trade', `Live Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} ${assetName} at $${result.trade.price}`);
        }
      } catch (liveErr) {
        addLog('error', `Live Bot Order Trigger Failed: ${liveErr.message}`);
      }
    }
  } catch (err) {
    addLog('error', `Error in bot execution cycle: ${err.message}`);
  }
}

function startBotLoop(intervalMin) {
  stopBotLoop();
  const ms = intervalMin * 60 * 1000;
  isBotRunning = true;
  runBotCycle(); // Run immediately on start
  botIntervalId = setInterval(runBotCycle, ms);
  console.log(`Bot engine started. Polling every ${intervalMin} minutes.`);
}

function stopBotLoop() {
  if (botIntervalId) {
    clearInterval(botIntervalId);
    botIntervalId = null;
  }
  isBotRunning = false;
  console.log("Bot engine stopped.");
}

// ----------------------------------------------------
// Express API Endpoints
// ----------------------------------------------------

// Serve static frontend files if they exist (for production build)
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
}

// Get bot status and portfolio summary
app.get('/api/status', async (req, res) => {
  const db = readDB();
  
  // If in live trading mode and keys exist, periodically sync actual balance
  if (db.settings.tradingMode === 'live' && db.settings.exchangeApiKey && db.settings.exchangeApiSecret) {
    const now = Date.now();
    if (now - lastBalanceSyncTime > 30000) { // Throttle: Sync every 30 seconds max
      try {
        const exchange = getExchangeInstance(db.settings);
        await exchange.loadMarkets();
        const balance = await exchange.fetchBalance();
        
        const symbol = db.settings.selectedAsset;
        const assetName = symbol.split('/')[0];
        const quoteCurrency = symbol.split('/')[1] || 'USD';
        
        db.portfolio.balanceUSD = balance.free[quoteCurrency] || 0;
        
        if (!db.portfolio.positions) db.portfolio.positions = {};
        const holdings = balance.free[assetName] || 0;
        if (holdings > 0.00001) {
          const oldEntry = db.portfolio.positions[assetName]?.avgEntryPrice || 0;
          db.portfolio.positions[assetName] = {
            amount: holdings,
            avgEntryPrice: oldEntry || 0
          };
        } else {
          delete db.portfolio.positions[assetName];
        }
        
        writeDB(db);
        lastBalanceSyncTime = now;
      } catch (err) {
        console.error("Failed to sync live portfolio balance:", err.message);
      }
    }
  }

  res.json({
    isBotRunning,
    portfolio: db.portfolio,
    highestPriceReached: db.highestPriceReached || {},
    latestDecision: db.latestDecision || null,
    settings: {
      ...db.settings,
      geminiApiKey: db.settings.geminiApiKey ? '••••••••' : '',
      exchangeApiKey: db.settings.exchangeApiKey ? '••••••••' : '',
      exchangeApiSecret: db.settings.exchangeApiSecret ? '••••••••' : '',
      telegramBotToken: db.settings.telegramBotToken ? '••••••••' : '',
      smtpPass: db.settings.smtpPass ? '••••••••' : ''
    }
  });
});

// Update settings
app.post('/api/settings', (req, res) => {
  const db = readDB();
  const oldSettings = { ...db.settings };
  
  // Clean incoming settings: if key is masked, preserve old key
  const updatedSettings = req.body;
  if (updatedSettings.geminiApiKey === '••••••••') updatedSettings.geminiApiKey = oldSettings.geminiApiKey;
  if (updatedSettings.exchangeApiKey === '••••••••') updatedSettings.exchangeApiKey = oldSettings.exchangeApiKey;
  if (updatedSettings.exchangeApiSecret === '••••••••') updatedSettings.exchangeApiSecret = oldSettings.exchangeApiSecret;
  if (updatedSettings.telegramBotToken === '••••••••') updatedSettings.telegramBotToken = oldSettings.telegramBotToken;
  if (updatedSettings.smtpPass === '••••••••') updatedSettings.smtpPass = oldSettings.smtpPass;

  db.settings = { ...db.settings, ...updatedSettings };
  writeDB(db);

  addLog('info', "Bot settings updated by user.");

  // Restart loop if interval or asset or enabled status changed
  if (db.settings.botEnabled) {
    startBotLoop(db.settings.botIntervalMin);
  } else {
    stopBotLoop();
  }

  // Refresh Telegram Command listener status
  startTelegramCommandListener();

  res.json({ success: true, settings: db.settings });
});

// Get operations manual content
app.get('/api/manual', (req, res) => {
  try {
    const manualPath = path.join(__dirname, '..', 'Aether_Operations_Manual.md');
    if (!fs.existsSync(manualPath)) {
      return res.status(404).json({ error: "Manual file not found" });
    }
    const markdown = fs.readFileSync(manualPath, 'utf8');
    res.json({ markdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get trade history
app.get('/api/trades', (req, res) => {
  const db = readDB();
  res.json(db.trades);
});

// Get logs
app.get('/api/logs', (req, res) => {
  const db = readDB();
  res.json(db.logs);
});

// Clear logs
app.post('/api/logs/clear', (req, res) => {
  const db = readDB();
  db.logs = [
    {
      timestamp: new Date().toISOString(),
      type: "info",
      message: "System log trail cleared by user."
    }
  ];
  writeDB(db);
  res.json({ success: true });
});

// Reset portfolio
app.post('/api/reset-portfolio', (req, res) => {
  const db = readDB();
  db.portfolio = {
    balanceUSD: 10000.0,
    positions: {}
  };
  db.trades = [];
  db.logs.unshift({
    timestamp: new Date().toISOString(),
    type: "info",
    message: "Portfolio reset back to $10,000.00 USD. Trade history cleared."
  });
  writeDB(db);
  res.json({ success: true, portfolio: db.portfolio });
});

// Manual buy/sell override
app.post('/api/trade/manual', async (req, res) => {
  const { action, amountPct, symbol } = req.body;
  const db = readDB();
  const settings = db.settings;
  const assetName = symbol.split('/')[0];

  try {
    const exchange = getExchangeInstance(settings);
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last || ticker.close;

    if (settings.tradingMode === 'live') {
      const result = await executeLiveTrade(exchange, action, amountPct, currentPrice, assetName, db, symbol, `REST API manual override ${action} command.`);
      addLog('trade', `[MANUAL LIVE ORDER] Executed ${action} ${result.trade.amount.toFixed(6)} ${assetName} at $${result.trade.price}`);
      res.json({ success: true, trade: result.trade });
    } else {
      const result = executePaperTrade(action, amountPct, currentPrice, assetName, db, `REST API manual override ${action} command.`);
      if (result.success) {
        addLog('trade', `[MANUAL ORDER] Executed ${action} ${result.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
        res.json({ success: true, trade: result.trade });
      } else {
        res.status(400).json({ success: false, message: result.message });
      }
    }
  } catch (err) {
    addLog('error', `Manual trade override error: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger a test alert to phone
app.post('/api/test-alert', async (req, res) => {
  const db = readDB();
  const oldSettings = db.settings;
  
  // Use incoming body settings if available, otherwise fall back to db settings
  let settings = oldSettings;
  if (req.body && Object.keys(req.body).length > 0) {
    const incoming = { ...req.body };
    if (incoming.geminiApiKey === '••••••••') incoming.geminiApiKey = oldSettings.geminiApiKey;
    if (incoming.exchangeApiKey === '••••••••') incoming.exchangeApiKey = oldSettings.exchangeApiKey;
    if (incoming.exchangeApiSecret === '••••••••') incoming.exchangeApiSecret = oldSettings.exchangeApiSecret;
    if (incoming.telegramBotToken === '••••••••') incoming.telegramBotToken = oldSettings.telegramBotToken;
    if (incoming.smtpPass === '••••••••') incoming.smtpPass = oldSettings.smtpPass;
    settings = { ...oldSettings, ...incoming };
  }

  const type = settings.notificationType;
  const msg = `⚡ <b>AETHER EW ALERT TEST</b>\n\nConnection check: SUCCESSFUL!\nTimestamp: <b>${new Date().toLocaleTimeString()}</b>`;
  const cleanMsg = msg.replace(/<[^>]*>/g, '');

  try {
    if (type === 'telegram') {
      await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg);
      res.json({ success: true, message: "Test Telegram notification sent!" });
    } else if (type === 'sms') {
      const smtpConfig = {
        host: settings.smtpHost,
        port: settings.smtpPort,
        user: settings.smtpUser,
        pass: settings.smtpPass
      };
      await sendSMSAlert(smtpConfig, settings.phoneNumber, settings.phoneCarrier, cleanMsg);
      res.json({ success: true, message: "Test SMS notification sent!" });
    } else {
      res.status(400).json({ success: false, message: "Notifications are disabled. Change 'Notification Type' in Settings first." });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fetch candles (for the UI chart)
app.get('/api/market/candles', async (req, res) => {
  const { symbol, timeframe, limit } = req.query;
  const db = readDB();
  try {
    const exchange = getExchangeInstance(db.settings);
    const candlesRaw = await exchange.fetchOHLCV(symbol || 'BTC/USD', timeframe || '1h', undefined, Number(limit) || 100);
    const candles = candlesRaw.map(c => ({
      time: c[0] / 1000, // lightweight-charts expects seconds for unix time
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// BACKTESTING ENGINE
// ----------------------------------------------------
app.post('/api/backtest', async (req, res) => {
  const { symbol, timeframe, limit, useLlm, startCash, strategy } = req.body;
  const activeStrategy = strategy || (useLlm ? 'llm' : 'rules');
  const db = readDB();
  const apiKey = db.settings.geminiApiKey || process.env.GEMINI_API_KEY;

  if (activeStrategy === 'llm' && !apiKey) {
    return res.status(400).json({ error: "Gemini API Key is required for LLM backtesting. Configure in settings." });
  }

  try {
    const exchange = getExchangeInstance(db.settings);
    console.log(`Running backtest for ${symbol} | Timeframe: ${timeframe} | Limit: ${limit}`);
    
    // Fetch raw candles
    const candlesRaw = await exchange.fetchOHLCV(symbol, timeframe, undefined, Number(limit) || 100);
    if (!candlesRaw || candlesRaw.length < 30) {
      return res.status(400).json({ error: "Insufficient historical data. Need at least 30 candles." });
    }

    const candles = candlesRaw.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));

    // Backtest portfolios state
    let cash = Number(startCash) || 10000;
    let holdings = 0;
    let avgEntry = 0;
    const feePct = 0.001;
    const assetName = symbol.split('/')[0];

    const results = [];
    const trades = [];

    // Calculate indicators globally first (on entire set) to simulate running indicators step-by-step
    const closePrices = candles.map(c => c.close);
    const sma9Arr = calculateSMA(closePrices, 9);
    const sma21Arr = calculateSMA(closePrices, 21);
    const rsiArr = calculateRSI(closePrices, 14);
    const macdResult = calculateMACD(closePrices, 12, 26, 9);
    const aoArr = calculateAwesomeOscillator(candles);

    // Precompute Elliott Wave swing rules if selected
    const ewResult = activeStrategy === 'ew_rules' ? calculateElliottWaves(candles) : null;

    // Warm-up period (need at least 26 candles for indicators)
    const startIndex = 26;

    // Standard Algorithmic Rule (SMA cross + RSI fallback)
    // Runs instantly, doesn't query LLM
    const runRuleBasedStrategy = (idx) => {
      const currentPrice = closePrices[idx];
      const rsiVal = rsiArr[idx];
      const sma9Val = sma9Arr[idx];
      const sma21Val = sma21Arr[idx];
      
      const prevSma9Val = sma9Arr[idx - 1];
      const prevSma21Val = sma21Arr[idx - 1];

      // Buy signals:
      // 1. SMA 9 crosses above SMA 21 (Golden Cross)
      // 2. RSI is oversold (< 30) and starts hooking up
      const isGoldenCross = prevSma9Val && prevSma21Val && prevSma9Val <= prevSma21Val && sma9Val > sma21Val;
      const isOversoldBuy = rsiVal !== null && rsiVal < 32;

      // Sell signals:
      // 1. SMA 9 crosses below SMA 21 (Death Cross)
      // 2. RSI is overbought (> 70)
      const isDeathCross = prevSma9Val && prevSma21Val && prevSma9Val >= prevSma21Val && sma9Val < sma21Val;
      const isOverboughtSell = rsiVal !== null && rsiVal > 68;

      if (isGoldenCross || isOversoldBuy) {
        return { decision: 'BUY', confidence: 0.9, amount_pct: 100, reasoning: isGoldenCross ? "Golden Cross: Impulsive Wave 3 starting." : "RSI Oversold: Wave 2 correction appears complete." };
      } else if (isDeathCross || isOverboughtSell) {
        return { decision: 'SELL', confidence: 0.9, amount_pct: 100, reasoning: isDeathCross ? "Death Cross: Wave 5 peak identified." : "RSI Overbought: Wave 5 impulse has completed." };
      }
      return { decision: 'HOLD', confidence: 1.0, amount_pct: 0, reasoning: "No SMA crossover or RSI extremes detected." };
    };

    // Main backtesting iteration
    for (let i = startIndex; i < candles.length; i++) {
      const currentCandle = candles[i];
      const currentPrice = currentCandle.close;

      let decisionObj = { decision: 'HOLD', confidence: 1.0, amount_pct: 0, reasoning: "Hold" };

      if (activeStrategy === 'llm') {
        // Build slice of data up to this index to feed to LLM
        const slicedCandles = candles.slice(0, i + 1);
        const slicedIndicators = {
          sma9: sma9Arr.slice(0, i + 1),
          sma21: sma21Arr.slice(0, i + 1),
          rsi: rsiArr.slice(0, i + 1),
          macd: {
            macdLine: macdResult.macdLine.slice(0, i + 1),
            signalLine: macdResult.signalLine.slice(0, i + 1),
            histogram: macdResult.histogram.slice(0, i + 1)
          },
          ao: aoArr.slice(0, i + 1),
          fib: calculateFibonacciLevels(slicedCandles, 50)
        };

        const marketDataSlice = {
          ticker: { close: currentPrice },
          indicators: slicedIndicators,
          recentCandles: slicedCandles
        };

        const currentPortfolioState = {
          balanceUSD: cash,
          positions: { [assetName]: { amount: holdings, avgEntryPrice: avgEntry } }
        };

        try {
          // Delay to respect rate limits (Gemini free tiers)
          await new Promise(resolve => setTimeout(resolve, 800));
          decisionObj = await getTradingDecision(apiKey, marketDataSlice, currentPortfolioState, db.settings);
        } catch (err) {
          console.error(`Backtest LLM error at candle ${i}:`, err.message);
          decisionObj = { decision: 'HOLD', confidence: 0.0, amount_pct: 0, reasoning: `LLM Call failed: ${err.message}` };
        }
      } else if (activeStrategy === 'ew_rules') {
        const rawDecision = ewResult.decisions[i] || { decision: 'HOLD', reasoning: 'No pattern detected' };
        decisionObj = {
          decision: rawDecision.decision || 'HOLD',
          amount_pct: rawDecision.amount_pct || 100,
          confidence: rawDecision.confidence || 1.0,
          reasoning: rawDecision.reasoning || 'Hold'
        };
      } else {
        // Fast JS Rule-based strategy
        decisionObj = runRuleBasedStrategy(i);
      }

      // Execute Trade simulation
      if (decisionObj.decision === 'BUY' && cash > 10) {
        const allocation = cash * (decisionObj.amount_pct / 100);
        const fee = allocation * feePct;
        const netAllocation = allocation - fee;
        const buyAmt = netAllocation / currentPrice;

        cash -= allocation;
        const totalCost = (holdings * avgEntry) + netAllocation;
        holdings += buyAmt;
        avgEntry = holdings > 0 ? (totalCost / holdings) : 0;

        trades.push({
          time: currentCandle.time,
          action: 'BUY',
          price: currentPrice,
          amount: buyAmt,
          fee,
          total: allocation,
          cashAfter: cash,
          reasoning: decisionObj.reasoning
        });
      } else if (decisionObj.decision === 'SELL' && holdings > 0.0001) {
        const sellAmt = holdings * (decisionObj.amount_pct / 100);
        const grossTotal = sellAmt * currentPrice;
        const fee = grossTotal * feePct;
        const netProceeds = grossTotal - fee;

        cash += netProceeds;
        holdings -= sellAmt;
        
        trades.push({
          time: currentCandle.time,
          action: 'SELL',
          price: currentPrice,
          amount: sellAmt,
          fee,
          total: grossTotal,
          cashAfter: cash,
          reasoning: decisionObj.reasoning
        });
      }

      const totalVal = cash + (holdings * currentPrice);
      results.push({
        time: currentCandle.time / 1000, // in seconds for lightweight-charts
        price: currentPrice,
        portfolioValue: totalVal,
        cash: cash,
        holdings: holdings
      });
    }

    // Performance calculations
    const finalValue = cash + (holdings * candles[candles.length - 1].close);
    const pctChange = ((finalValue - startCash) / startCash) * 100;
    
    // Benchmark: Buy and Hold Strategy performance
    const initialPrice = candles[startIndex].close;
    const finalPrice = candles[candles.length - 1].close;
    const buyAndHoldVal = (startCash / initialPrice) * finalPrice;
    const buyAndHoldPct = ((buyAndHoldVal - startCash) / startCash) * 100;

    const winTrades = trades.filter((t, idx) => {
      if (t.action === 'SELL') {
        const prevBuy = trades.slice(0, idx).reverse().find(tb => tb.action === 'BUY');
        return prevBuy ? t.price > prevBuy.price : false;
      }
      return false;
    }).length;

    const sellTradesCount = trades.filter(t => t.action === 'SELL').length;
    const winRate = sellTradesCount > 0 ? (winTrades / sellTradesCount) * 100 : 0;

    // Calculate Sharpe Ratio, Max Drawdown, and Profit Factor
    let maxDrawdown = 0;
    let peak = startCash;
    for (const r of results) {
      if (r.portfolioValue > peak) {
        peak = r.portfolioValue;
      }
      const dd = ((peak - r.portfolioValue) / peak) * 100;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    }

    // Sharpe Ratio calculation
    let sharpeRatio = 0;
    if (results.length > 1) {
      const returns = [];
      for (let j = 1; j < results.length; j++) {
        const prev = results[j - 1].portfolioValue;
        const curr = results[j].portfolioValue;
        returns.push(prev > 0 ? (curr - prev) / prev : 0);
      }
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > 0) {
        let intervalsPerYear = 8760; // default to 1h
        if (timeframe === '1m') intervalsPerYear = 525600;
        else if (timeframe === '5m') intervalsPerYear = 105120;
        else if (timeframe === '15m') intervalsPerYear = 35040;
        else if (timeframe === '1h') intervalsPerYear = 8760;
        else if (timeframe === '1d') intervalsPerYear = 365;
        
        sharpeRatio = (meanReturn / stdDev) * Math.sqrt(intervalsPerYear);
      }
    }

    // Profit Factor calculation using FIFO matching
    let grossProfits = 0;
    let grossLosses = 0;
    const buyQueue = [];
    
    for (const t of trades) {
      if (t.action === 'BUY') {
        buyQueue.push({ price: t.price, amount: t.amount, fee: t.fee });
      } else if (t.action === 'SELL') {
        let remainingSell = t.amount;
        let sellPrice = t.price;
        let sellFeeAlloc = t.fee;
        
        while (remainingSell > 0 && buyQueue.length > 0) {
          const activeBuy = buyQueue[0];
          const matchAmount = Math.min(remainingSell, activeBuy.amount);
          
          const buyCost = matchAmount * activeBuy.price;
          const sellValue = matchAmount * sellPrice;
          
          const buyFeeShare = (matchAmount / activeBuy.amount) * activeBuy.fee;
          const sellFeeShare = (matchAmount / t.amount) * sellFeeAlloc;
          
          const netTradeResult = sellValue - buyCost - buyFeeShare - sellFeeShare;
          
          if (netTradeResult > 0) {
            grossProfits += netTradeResult;
          } else {
            grossLosses += Math.abs(netTradeResult);
          }
          
          remainingSell -= matchAmount;
          activeBuy.amount -= matchAmount;
          activeBuy.fee -= buyFeeShare;
          
          if (activeBuy.amount <= 0.00001) {
            buyQueue.shift();
          }
        }
      }
    }
    
    const profitFactor = grossLosses > 0 ? (grossProfits / grossLosses) : (grossProfits > 0 ? 999 : 0);

    res.json({
      pctChange: Number(pctChange.toFixed(2)),
      finalValue: Number(finalValue.toFixed(2)),
      buyAndHoldPct: Number(buyAndHoldPct.toFixed(2)),
      buyAndHoldValue: Number(buyAndHoldVal.toFixed(2)),
      tradesCount: trades.length,
      winRate: Number(winRate.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      results,
      trades
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let telegramPollIntervalId = null;
let lastTelegramUpdateId = 0;

async function pollTelegramUpdates() {
  const db = readDB();
  const settings = db.settings;
  
  if (settings.notificationType !== 'telegram' || !settings.telegramBotToken || !settings.telegramChatId) {
    if (telegramPollIntervalId) {
      clearInterval(telegramPollIntervalId);
      telegramPollIntervalId = null;
    }
    return;
  }
  
  const token = cleanCDPApiKey(settings.telegramBotToken);
  const chatId = settings.telegramChatId.trim();
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastTelegramUpdateId}&timeout=5`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
      for (const update of data.result) {
        lastTelegramUpdateId = update.update_id + 1;
        
        const message = update.message;
        if (!message || !message.text) continue;
        
        if (String(message.chat.id) !== String(chatId)) {
          console.warn(`[WARNING] Unauthorized Telegram message from chat ID ${message.chat.id}`);
          continue;
        }
        
        const text = message.text.trim();
        await handleTelegramCommand(text, token, chatId);
      }
    }
  } catch (err) {
    console.error("Error polling Telegram updates:", err.message);
  }
}

async function handleTelegramCommand(text, token, chatId) {
  let cleanText = text.trim();
  let firstWord = cleanText.split(' ')[0].toLowerCase();

  // Auto prepend slash if first word is a recognized keyword without a slash
  const keywords = ['buy', 'sell', 'status', 'pause', 'start', 'help'];
  if (keywords.includes(firstWord)) {
    cleanText = '/' + cleanText;
  }

  const cmd = cleanText.split(' ')[0].toLowerCase();
  const arg = cleanText.split(' ').slice(1).join(' ').trim();
  
  const sendResp = async (msg) => {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: 'HTML'
        })
      });
    } catch (err) {
      console.error("Failed to send Telegram command response:", err.message);
    }
  };
  
  const db = readDB();
  const settings = db.settings;
  const assetName = settings.selectedAsset.split('/')[0];
  
  if (cmd === '/help' || cmd === '/start@aether_bot' || cmd === '/help@aether_bot') {
    const helpMsg = `🤖 <b>AETHER BOT COMMAND MENU</b>\n\n` +
                    `/status - Get current portfolio valuation and active safety stops\n` +
                    `/start - Start the automated bot loop\n` +
                    `/pause - Pause the automated bot loop\n` +
                    `/buy &lt;pct&gt; - Execute manual paper/live market buy (e.g. /buy 50)\n` +
                    `/sell &lt;pct&gt; - Execute manual paper/live market sell (e.g. /sell 100)\n` +
                    `/help - Show this help menu`;
    await sendResp(helpMsg);
  } 
  
  else if (cmd === '/status') {
    let currentPrice = 0;
    try {
      const exchange = getExchangeInstance(settings);
      const ticker = await exchange.fetchTicker(settings.selectedAsset);
      currentPrice = ticker.last || ticker.close;
    } catch (e) {
      currentPrice = 0;
    }
    
    const pos = db.portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };
    const valuation = pos.amount * currentPrice;
    const totalNetWorth = db.portfolio.balanceUSD + valuation;
    
    let stopsInfo = `• Stop Loss (Hard): ${settings.stopLossPct > 0 ? `${settings.stopLossPct}%` : 'Disabled'}\n`;
    if (pos.amount > 0) {
      if (settings.atrStopEnabled) {
        stopsInfo += `• ATR Volatility Stop: Enabled (Multiplier: ${settings.atrStopMultiplier || 2.0})\n`;
      }
      if (settings.trailingStopEnabled) {
        const peak = (db.highestPriceReached && db.highestPriceReached[assetName]) || pos.avgEntryPrice;
        const trailFloor = peak * (1 - settings.trailingStopPct / 100);
        stopsInfo += `• Trailing Stop: Enabled (${settings.trailingStopPct}% | Floor: $${trailFloor.toFixed(4)})\n`;
      }
      if (settings.takeProfitEnabled) {
        const tpTarget = pos.avgEntryPrice * (1 + settings.takeProfitPct / 100);
        stopsInfo += `• Take Profit Target: Enabled (${settings.takeProfitPct}% | Target: $${tpTarget.toFixed(4)})\n`;
      }
    } else {
      stopsInfo += `<i>(No active position open)</i>\n`;
    }
    
    const statusMsg = `📊 <b>AETHER STATUS REPORT</b>\n\n` +
                      `• Bot Status: <b>${isBotRunning ? 'RUNNING' : 'PAUSED'}</b>\n` +
                      `• Active Asset: <b>${settings.selectedAsset}</b>\n` +
                      `• Market Price: <b>$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>\n\n` +
                      `💰 <b>PORTFOLIO SUMMARY</b>\n` +
                      `• Liquid Cash: <b>$${db.portfolio.balanceUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</b>\n` +
                      `• Position Value: <b>$${valuation.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</b> (${pos.amount.toFixed(4)} ${assetName})\n` +
                      `• Total Valuation: <b>$${totalNetWorth.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</b>\n\n` +
                      `🛡️ <b>SAFETY TARGETS</b>\n${stopsInfo}`;
    await sendResp(statusMsg);
  }
  
  else if (cmd === '/pause') {
    if (!settings.botEnabled) {
      await sendResp(`ℹ️ Bot is already paused.`);
    } else {
      db.settings.botEnabled = false;
      writeDB(db);
      stopBotLoop();
      addLog('info', "[TELEGRAM COMMAND] Bot paused by user.");
      await sendResp(`⏸️ <b>Bot loop successfully paused.</b>`);
    }
  }
  
  else if (cmd === '/start') {
    if (settings.botEnabled) {
      await sendResp(`ℹ️ Bot is already running.`);
    } else {
      db.settings.botEnabled = true;
      writeDB(db);
      startBotLoop(settings.botIntervalMin);
      addLog('info', "[TELEGRAM COMMAND] Bot started by user.");
      await sendResp(`▶️ <b>Bot loop successfully started.</b> Polling every ${settings.botIntervalMin} minutes.`);
    }
  }
  
  else if (cmd === '/buy') {
    let pct = 50;
    let usdAmount = null;
    let availableCash = db.portfolio.balanceUSD;

    const argLower = arg.toLowerCase();
    const isUsd = argLower.includes('$') || argLower.includes('usd') || argLower.includes('usdc') || argLower.includes('worth');
    const numMatch = arg.match(/\d+(\.\d+)?/);

    if (numMatch) {
      const val = Number(numMatch[0]);
      if (isUsd || arg.includes('.')) {
        usdAmount = val;
      } else if (argLower.includes('%')) {
        pct = Math.max(10, Math.min(100, val));
      } else {
        if (val <= 100) {
          pct = Math.max(10, Math.min(100, val));
        } else {
          usdAmount = val;
        }
      }
    }

    try {
      const exchange = getExchangeInstance(settings);
      const ticker = await exchange.fetchTicker(settings.selectedAsset);
      const currentPrice = ticker.last || ticker.close;

      if (usdAmount !== null) {
        if (settings.tradingMode === 'live') {
          const balance = await exchange.fetchBalance();
          const quoteCurrency = settings.selectedAsset.split('/')[1] || 'USD';
          availableCash = balance.free[quoteCurrency] || 0;
        }
        if (usdAmount > availableCash) {
          throw new Error(`Requested buy amount ($${usdAmount.toFixed(2)}) exceeds available cash ($${availableCash.toFixed(2)}).`);
        }
        pct = (usdAmount / availableCash) * 100;
      }

      await sendResp(`⏳ Executing market BUY override for ${usdAmount !== null ? `$${usdAmount.toFixed(2)} worth` : `${pct.toFixed(0)}%`}...`);

      let res;
      if (settings.tradingMode === 'live') {
        res = await executeLiveTrade(exchange, 'BUY', pct, currentPrice, assetName, db, settings.selectedAsset, `Telegram manual BUY override command.`);
        addLog('trade', `[TELEGRAM LIVE BUY] Executed BUY ${res.trade.amount.toFixed(6)} ${assetName} at $${res.trade.price}`);
        await sendResp(`✅ <b>Live BUY order completed!</b> Purchased ${res.trade.amount.toFixed(6)} ${assetName} at $${res.trade.price.toFixed(4)}`);
      } else {
        res = executePaperTrade('BUY', pct, currentPrice, assetName, db, `Telegram manual BUY override command.`);
        if (res.success) {
          addLog('trade', `[TELEGRAM BUY] Executed BUY ${res.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
          await sendResp(`✅ <b>Paper BUY order completed!</b> Purchased ${res.trade.amount.toFixed(6)} ${assetName} at $${currentPrice.toFixed(4)}`);
        } else {
          await sendResp(`❌ <b>Paper BUY rejected:</b> ${res.message}`);
        }
      }
    } catch (err) {
      await sendResp(`❌ <b>Order failed:</b> ${err.message}`);
    }
  }
  
  else if (cmd === '/sell') {
    let pct = 100;
    let usdAmount = null;

    const argLower = arg.toLowerCase();
    const isUsd = argLower.includes('$') || argLower.includes('usd') || argLower.includes('usdc') || argLower.includes('worth');
    const numMatch = arg.match(/\d+(\.\d+)?/);

    if (numMatch) {
      const val = Number(numMatch[0]);
      if (isUsd || arg.includes('.')) {
        usdAmount = val;
      } else if (argLower.includes('%')) {
        pct = Math.max(10, Math.min(100, val));
      } else {
        if (val <= 100) {
          pct = Math.max(10, Math.min(100, val));
        } else {
          usdAmount = val;
        }
      }
    }

    try {
      const exchange = getExchangeInstance(settings);
      const ticker = await exchange.fetchTicker(settings.selectedAsset);
      const currentPrice = ticker.last || ticker.close;

      let positionValuation = 0;
      let holdings = 0;

      if (settings.tradingMode === 'live') {
        const balance = await exchange.fetchBalance();
        holdings = balance.free[assetName] || 0;
      } else {
        holdings = db.portfolio.positions[assetName]?.amount || 0;
      }
      positionValuation = holdings * currentPrice;

      if (usdAmount !== null) {
        if (usdAmount > positionValuation) {
          throw new Error(`Requested sell amount ($${usdAmount.toFixed(2)}) exceeds total position value ($${positionValuation.toFixed(2)}).`);
        }
        pct = (usdAmount / positionValuation) * 100;
      }

      await sendResp(`⏳ Executing market SELL override for ${usdAmount !== null ? `$${usdAmount.toFixed(2)} worth` : `${pct.toFixed(0)}%`}...`);

      let res;
      if (settings.tradingMode === 'live') {
        res = await executeLiveTrade(exchange, 'SELL', pct, currentPrice, assetName, db, settings.selectedAsset, `Telegram manual SELL override command.`);
        addLog('trade', `[TELEGRAM LIVE SELL] Executed SELL ${res.trade.amount.toFixed(6)} ${assetName} at $${res.trade.price}`);
        await sendResp(`✅ <b>Live SELL order completed!</b> Sold ${res.trade.amount.toFixed(6)} ${assetName} at $${res.trade.price.toFixed(4)}`);
      } else {
        res = executePaperTrade('SELL', pct, currentPrice, assetName, db, `Telegram manual SELL override command.`);
        if (res.success) {
          addLog('trade', `[TELEGRAM SELL] Executed SELL ${res.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
          await sendResp(`✅ <b>Paper SELL order completed!</b> Sold ${res.trade.amount.toFixed(6)} ${assetName} at $${currentPrice.toFixed(4)}`);
        } else {
          await sendResp(`❌ <b>Paper SELL rejected:</b> ${res.message}`);
        }
      }
    } catch (err) {
      await sendResp(`❌ <b>Order failed:</b> ${err.message}`);
    }
  }
  
  else {
    // If it's a generic text message or question, treat it as a question to Aether AI
    if (text.startsWith('/')) {
      await sendResp(`❌ <b>Unknown Command.</b> Type /help to see all available overrides.`);
      return;
    }
    
    await sendResp(`🧠 <i>Aether AI is analyzing your question...</i>`);
    try {
      const apiKey = settings.geminiApiKey;
      if (!apiKey) {
        await sendResp(`❌ <b>Error:</b> Gemini API Key is not configured on the dashboard. Please configure it under Settings.`);
        return;
      }
      
      const exchange = getExchangeInstance(settings);
      const marketData = await getMarketContext(exchange, settings.selectedAsset, settings.selectedTimeframe, 50);
      
      if (settings.multiTimeframeEnabled) {
        const macroTimeframe = settings.macroTimeframe || "1d";
        const cache = db.macroCache;
        const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms
        
        let useCache = false;
        if (cache && cache.symbol === settings.selectedAsset && cache.timeframe === macroTimeframe && cache.timestamp) {
          const age = Date.now() - new Date(cache.timestamp).getTime();
          if (age < CACHE_DURATION) {
            useCache = true;
          }
        }
        
        if (useCache) {
          marketData.macroContext = cache.data;
        } else {
          try {
            const macroContextRaw = await getMarketContext(exchange, settings.selectedAsset, macroTimeframe, 100);
            const macroData = {
              timeframe: macroTimeframe,
              indicators: macroContextRaw.indicators,
              recentCandles: macroContextRaw.recentCandles
            };
            marketData.macroContext = macroData;
            
            // Save to DB cache
            db.macroCache = {
              timestamp: new Date().toISOString(),
              symbol: settings.selectedAsset,
              timeframe: macroTimeframe,
              data: macroData
            };
            writeDB(db);
          } catch (macroErr) {
            console.warn(`[TELEGRAM] Failed to fetch macro context (${macroTimeframe}): ${macroErr.message}`);
          }
        }
      }
      
      const answer = await askBrainQuestion(apiKey, text, marketData, db.portfolio, settings);
      await sendResp(answer);
    } catch (err) {
      await sendResp(`❌ <b>Failed to process question:</b> ${err.message}`);
    }
  }
}

function startTelegramCommandListener() {
  if (telegramPollIntervalId) {
    clearInterval(telegramPollIntervalId);
    telegramPollIntervalId = null;
  }
  
  const db = readDB();
  if (db.settings.notificationType === 'telegram') {
    const token = cleanCDPApiKey(db.settings.telegramBotToken);
    if (token) {
      fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=1`)
        .then(res => res.json())
        .then(data => {
          if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
            lastTelegramUpdateId = data.result[0].update_id + 1;
          }
          console.log(`Telegram bot command listener primed. Starting update poll.`);
          telegramPollIntervalId = setInterval(pollTelegramUpdates, 7000);
        })
        .catch(err => {
          console.error("Failed to initialize Telegram update ID offset:", err.message);
          telegramPollIntervalId = setInterval(pollTelegramUpdates, 7000);
        });
    }
  }
}

// Start bot interval loop if enabled on startup
const dbOnStart = readDB();
if (dbOnStart.settings && dbOnStart.settings.botEnabled) {
  startBotLoop(dbOnStart.settings.botIntervalMin);
}
startTelegramCommandListener();

// Serve index.html for client-side routing fallback (placed after all API routes)
if (fs.existsSync(frontendDistPath)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
