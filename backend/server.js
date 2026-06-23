const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ccxt = require('ccxt');
const vm = require('vm');
const dotenv = require('dotenv');

const { calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateAwesomeOscillator, calculateFibonacciLevels, calculateElliottWaves, calculateATR, calculateADX, calculateRelativeVolume } = require('./indicators');
const { getTradingDecision, askBrainQuestion, runAIChatCompletion } = require('./brain');
const { sendTelegramAlert, sendSMSAlert, sendDiscordWebhook } = require('./notifications');

// Load environment variables if available
dotenv.config();

function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function convertMarkdownToTelegramHTML(md) {
  if (typeof md !== 'string') return md;
  
  let html = md;
  
  // 1. Escape basic HTML characters first
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // 2. Convert bold: **text** or __text__ -> <b>text</b>
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.*?)__/g, '<b>$1</b>');
  
  // 3. Convert italic: *text* or _text_ -> <i>text</i>
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
  
  // 4. Convert code blocks: ```lang ... ``` -> <pre>...</pre>
  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```/g, '<pre>$1</pre>');
  
  // 5. Convert inline code: `code` -> <code>code</code>
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  // 6. Convert headers: # text, ## text, ### text -> <b>text</b>
  html = html.replace(/^### (.*?)$/gm, '<b>$1</b>');
  html = html.replace(/^## (.*?)$/gm, '<b>$1</b>');
  html = html.replace(/^# (.*?)$/gm, '<b>$1</b>');
  
  // 7. Convert bullet points: - item or * item -> • item
  html = html.replace(/^[-\*] (.*?)$/gm, '• $1');
  
  return html;
}

const app = express();
app.use(cors());
app.use(express.json());

const userDataPath = process.env.AETHER_USER_DATA_PATH;
const DB_PATH = userDataPath ? path.join(userDataPath, 'db.json') : path.join(__dirname, 'db.json');
const LOGS_DIR = userDataPath ? path.join(userDataPath, 'logs') : path.join(__dirname, 'logs');
const TOOLS_PATH = userDataPath ? path.join(userDataPath, 'tools') : path.join(__dirname, 'tools');
const STRATEGIES_PATH = userDataPath ? path.join(userDataPath, 'strategies') : path.join(__dirname, 'strategies');

// Create required directories if they don't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(TOOLS_PATH)) {
  fs.mkdirSync(TOOLS_PATH, { recursive: true });
}
if (!fs.existsSync(STRATEGIES_PATH)) {
  fs.mkdirSync(STRATEGIES_PATH, { recursive: true });
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

// Default system configurations for backward compatibility
const defaultSettings = {
  geminiApiKey: "",
  openaiApiKey: "",
  claudeApiKey: "",
  activeLlmProvider: "gemini",
  activeLlmModel: "gemini-2.5-flash",
  enabledTools: [],
  enabledStrategies: [],
  selectedAsset: "BTC/USD",
  selectedTimeframe: "1h",
  tradingMode: "paper",
  botIntervalMin: 60,
  botEnabled: false,
  maxTradeSizePct: 10,
  stopLossPct: 10,
  customPrompt: "",
  exchangeName: "coinbase",
  exchangeApiKey: "",
  exchangeApiSecret: "",
  notificationType: "none",
  phoneNumber: "",
  phoneCarrier: "att",
  telegramBotToken: "",
  telegramChatId: "",
  smtpHost: "",
  smtpPort: "465",
  smtpUser: "",
  smtpPass: "",
  multiTimeframeEnabled: false,
  macroTimeframe: "1d",
  trailingStopEnabled: true,
  trailingStopPct: 4.0,
  takeProfitEnabled: false,
  takeProfitPct: 10.0,
  atrStopEnabled: true,
  atrStopMultiplier: 2.0,
  newsSentimentEnabled: false,
  maxPositionAllocationPct: 75,
  activeDesk: "spot",
  defaultLeverage: 5,
  obsidianVaultPath: "",
  dualLlmEnabled: true,
  auditorModel: "gemini-2.5-flash",
  boardroomWeights: {
    wave_theorist: 1.0,
    order_flow_scalper: 1.0,
    macro_economist: 1.0,
    margin_cop: 1.0,
    on_chain_detective: 1.0,
    cross_asset_tracker: 1.0,
    risk_range_quant: 1.0,
    fomo_miner: 1.0
  }
};

// Bot interval runtime state
let botIntervalId = null;
let isBotRunning = false;
let forceNextCycle = false;
let lastBalanceSyncTime = 0; // Throttle live balance API checks
let cachedOpenOrders = [];
let lastOrdersSyncTime = 0;
let multiTimeframeCache = null;
let lastMultiTimeframeSync = 0;

// Helpers to read/write local database
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error("db.json does not exist");
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed) {
      if (parsed.settings) {
        parsed.settings = { ...defaultSettings, ...parsed.settings };
      }
      if (!parsed.portfolio) {
        parsed.portfolio = { balanceUSD: 10000, positions: {} };
      }
      if (!parsed.portfolio.futures) {
        parsed.portfolio.futures = {
          marginBalanceUSD: 100.00,
          unrealizedPnL: 0.00,
          positions: {}
        };
      }
      if (!parsed.chatMessages) {
        parsed.chatMessages = [];
      }
      if (!parsed.conditionalOrders) {
        parsed.conditionalOrders = [];
      }
      if (!parsed.customTradingRules) {
        parsed.customTradingRules = [];
      }
    }
    return parsed;
  } catch (err) {
    console.error("Error reading database:", err);
    return { 
      portfolio: { 
        balanceUSD: 10000, 
        positions: {},
        futures: {
          marginBalanceUSD: 100.00,
          unrealizedPnL: 0.00,
          positions: {}
        }
      }, 
      trades: [], 
      logs: [], 
      settings: { ...defaultSettings }, 
      chatMessages: [],
      conditionalOrders: [],
      customTradingRules: []
    };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing database:", err);
  }
}

function writeToObsidianVault(subdir, filename, content) {
  try {
    const db = readDB();
    const vaultPath = db.settings?.obsidianVaultPath;
    if (!vaultPath) return; // Silent return if path is not configured

    const targetDir = path.join(vaultPath, subdir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[OBSIDIAN] Wrote note ${filename} inside subdirectory ${subdir}.`);
  } catch (err) {
    console.error("[OBSIDIAN] Failed to write to vault:", err.message);
  }
}

function syncRulesFromObsidian() {
  try {
    const db = readDB();
    const vaultPath = db.settings?.obsidianVaultPath;
    if (!vaultPath) return;

    const rulesFile = path.join(vaultPath, 'Aether_Rules.md');
    if (!fs.existsSync(rulesFile)) {
      const currentRules = db.customTradingRules || [];
      let initialContent = `# 🤖 Aether Custom Trading Rules\n\n`;
      initialContent += `Edit this file directly in Obsidian. Aether will sync rules on every tick.\n\n`;
      if (currentRules.length > 0) {
        currentRules.forEach(r => {
          initialContent += `- ${r}\n`;
        });
      } else {
        initialContent += `- We are strictly holding our XRP position long-term and dollar-cost averaging (DCA) through downturns.\n`;
      }
      fs.writeFileSync(rulesFile, initialContent, 'utf8');
      console.log(`[OBSIDIAN] Created initial Aether_Rules.md file in vault.`);
      return;
    }

    const content = fs.readFileSync(rulesFile, 'utf8');
    const lines = content.split('\n');
    const newRules = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const ruleText = trimmed.substring(1).trim();
        if (ruleText) {
          newRules.push(ruleText);
        }
      }
    }

    if (newRules.length > 0) {
      const rulesChanged = JSON.stringify(db.customTradingRules) !== JSON.stringify(newRules);
      if (rulesChanged) {
        db.customTradingRules = newRules;
        writeDB(db);
        console.log(`[OBSIDIAN] Synced ${newRules.length} rules from vault.`);
      }
    }
  } catch (err) {
    console.error("[OBSIDIAN] Failed to sync rules from vault:", err.message);
  }
}

function logCheckInToObsidian(analysis, marketRegime, currentPrice, assetName, db) {
  const date = new Date();
  const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `${dateString}_Aether_CheckIn.md`;
  
  let markdown = `# ☕ Aether Daily Strategist Check-In: ${db.settings?.selectedAsset || 'Asset'}
- **Timestamp**: ${date.toLocaleString()}
- **Market Price**: $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
- **Market Regime**: [[${marketRegime}]]
- **Net Portfolio Value**: $${(db.portfolio?.balanceUSD + (db.portfolio?.positions?.[assetName]?.amount || 0) * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD

## 📈 Wave Count / Structure
${analysis.market_structure}

## 🧠 Brain Outlook & Rationale
${analysis.forward_plan || analysis.reasoning}

---
*Links: [[Daily Notes]] | [[${dateString}]] | [[${assetName} Strategy]]*
`;
  writeToObsidianVault("Daily Notes", filename, markdown);
}

/**
 * Appends a hard code override note to the latest State note in Obsidian
 */
function appendOverrideToState(vaultPath, overrideMessage) {
  if (!vaultPath) return;
  try {
    const statesDir = path.join(vaultPath, 'States');
    if (!fs.existsSync(statesDir)) return;
    const files = fs.readdirSync(statesDir).filter(f => f.startsWith('State_') && f.endsWith('.md'));
    if (files.length === 0) return;
    files.sort((a, b) => b.localeCompare(a));
    const filePath = path.join(statesDir, files[0]);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes('## Hard Code Override')) {
        content += `\n\n## Hard Code Override\n- **Safety Gate Override**: ${overrideMessage}\n`;
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
  } catch (err) {
    console.error("Failed to append hard override to Obsidian:", err.message);
  }
}

function logTradeToObsidian(trade, assetName) {
  try {
    const db = readDB();
    const vaultPath = db.settings?.obsidianVaultPath;
    if (!vaultPath) return;

    const { writeTradeNode } = require('./obsidianWriter');
    
    // Build standardized trade data
    const tradeData = {
      symbol: trade.symbol || `${assetName}/USDC`,
      entryPrice: trade.entryPrice || trade.price,
      exitPrice: trade.price,
      pnlPct: trade.netReturnPct || 0,
      timestamp: trade.timestamp || new Date().toISOString(),
      activeStates: trade.activeStates || [trade.timestamp || new Date().toISOString()],
      reasoning: trade.reasoning || 'No reasoning stored.'
    };

    const tradeId = trade.id || Date.now();
    writeTradeNode(vaultPath, tradeId, tradeData);

    // If this is a SELL trade (closing a position), trigger post-mortem asynchronously
    if (trade.action === 'SELL') {
      const apiKey = db.settings?.geminiApiKey || process.env.GEMINI_API_KEY;
      if (apiKey) {
        const { generateTradePostMortem } = require('./brain');
        generateTradePostMortem(apiKey, tradeData, db.settings)
          .then(takeaway => {
            const { updateStateNodeWithOutcome } = require('./obsidianWriter');
            const outcomeLink = `[[Outcomes/Trade-${tradeData.pnlPct >= 0 ? 'Win' : 'Loss'}]]`;
            if (tradeData.activeStates && Array.isArray(tradeData.activeStates)) {
              tradeData.activeStates.forEach(stateTime => {
                updateStateNodeWithOutcome(vaultPath, stateTime, outcomeLink, takeaway);
              });
            }
            // Propose new hypothesis based on trade outcome
            const { proposeNewHypothesis } = require('./hypothesisEngine');
            proposeNewHypothesis(apiKey, { ...tradeData, takeaway }, db.settings, (msg, level) => console.log(`[HYPOTHESIS] ${msg}`));
          })
          .catch(err => {
            console.error("[OBSIDIAN] Asynchronous post-mortem generation failed:", err.message);
          });
      }
    }
  } catch (err) {
    console.error("[OBSIDIAN] Failed to write trade log using writeTradeNode:", err.message);
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
    const config = {
      timeout: 15000 // 15 seconds timeout to prevent indefinite hangs
    };
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

  const defaultExchange = new ccxt.coinbase({ timeout: 15000 });
  defaultExchange.options['createMarketBuyOrderRequiresPrice'] = false;
  return defaultExchange;
}

// Sync actual portfolio balance from exchange when in live mode
async function syncLiveBalance(db, exchange) {
  if (db.settings.tradingMode === 'live' && db.settings.exchangeApiKey && db.settings.exchangeApiSecret) {
    try {
      await exchange.loadMarkets();
      const balance = await exchange.fetchBalance();
      
      const symbol = db.settings.selectedAsset;
      const assetName = symbol.split('/')[0];
      const quoteCurrency = symbol.split('/')[1] || 'USD';
      
      const freshDb = readDB();
      freshDb.portfolio.balanceUSD = balance.free[quoteCurrency] || 0;
      
      if (!freshDb.portfolio.positions) freshDb.portfolio.positions = {};
      const holdings = balance.total[assetName] || balance.free[assetName] || 0;
      if (holdings > 0.00001) {
        let oldEntry = freshDb.portfolio.positions[assetName]?.avgEntryPrice || 0;
        if (!oldEntry) {
          try {
            const ticker = await exchange.fetchTicker(symbol);
            oldEntry = ticker.last || ticker.close || 0;
          } catch (pErr) {
            console.warn("Could not fetch price for new synced position:", pErr.message);
          }
        }
        const existingPos = freshDb.portfolio.positions[assetName] || {};
        freshDb.portfolio.positions[assetName] = {
          amount: holdings,
          avgEntryPrice: oldEntry || 0,
          activeStates: existingPos.activeStates || []
        };
      } else {
        delete freshDb.portfolio.positions[assetName];
      }
      
      writeDB(freshDb);
      return freshDb;
    } catch (err) {
      console.error("Failed to sync live portfolio balance:", err.message);
    }
  }
  return db;
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
 * Aggregate 1-hour candles into 4-hour candles aligned on standard UTC boundaries
 */
function aggregateCandles(candlesRaw1h, multiplier = 4) {
  const buckets = {};
  for (const c of candlesRaw1h) {
    if (!c || c.length < 6) continue;
    const timestamp = c[0];
    const date = new Date(timestamp);
    const utcHours = date.getUTCHours();
    const bucketHours = Math.floor(utcHours / multiplier) * multiplier;
    
    const bucketDate = new Date(date);
    bucketDate.setUTCHours(bucketHours, 0, 0, 0);
    const bucketTimestamp = bucketDate.getTime();
    
    if (!buckets[bucketTimestamp]) {
      buckets[bucketTimestamp] = [];
    }
    buckets[bucketTimestamp].push(c);
  }
  
  const sortedTimestamps = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  const aggregated = [];
  
  for (const t of sortedTimestamps) {
    const chunk = buckets[t];
    if (chunk.length === 0) continue;
    
    const open = chunk[0][1];
    const close = chunk[chunk.length - 1][4];
    const high = Math.max(...chunk.map(c => c[2]));
    const low = Math.min(...chunk.map(c => c[3]));
    const volume = chunk.reduce((sum, c) => sum + (c[5] || 0), 0);
    
    aggregated.push([t, open, high, low, close, volume]);
  }
  
  return aggregated;
}

/**
 * Fetch historical candles and calculate indicators
 */
async function getMarketContext(exchange, symbol, timeframe, limit = 200) {
  try {
    // CCXT fetchOHLCV returns: [ [timestamp, open, high, low, close, volume], ... ]
    let candlesRaw;
    if (timeframe === '4h') {
      const raw1h = await exchange.fetchOHLCV(symbol, '1h', undefined, limit * 4 + 4);
      candlesRaw = aggregateCandles(raw1h, 4);
      if (candlesRaw.length > limit) {
        candlesRaw = candlesRaw.slice(-limit);
      }
    } else {
      candlesRaw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    }
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
      fib: calculateFibonacciLevels(candles, 150),
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
 * Fetches the order book and calculates the imbalance ratio (Obi)
 */
async function fetchOrderBookImbalance(exchange, symbol) {
  try {
    const limit = 20;
    const orderBook = await exchange.fetchOrderBook(symbol, limit);
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      throw new Error("Invalid order book data received from exchange");
    }

    const topBids = orderBook.bids.slice(0, 10);
    const topAsks = orderBook.asks.slice(0, 10);

    const sumBids = topBids.reduce((sum, bid) => sum + bid[1], 0);
    const sumAsks = topAsks.reduce((sum, ask) => sum + ask[1], 0);

    if (sumAsks === 0) {
      return {
        imbalanceRatio: sumBids > 0 ? 999 : 1.0,
        wallStatus: "UNKNOWN"
      };
    }

    const imbalanceRatio = sumBids / sumAsks;
    let wallStatus = "NEUTRAL";
    if (imbalanceRatio > 1.5) {
      wallStatus = "BUY_WALL_SUPPORT";
    } else if (imbalanceRatio < 0.6) {
      wallStatus = "SELL_WALL_RESISTANCE";
    }

    return {
      imbalanceRatio: parseFloat(imbalanceRatio.toFixed(4)),
      wallStatus: wallStatus
    };
  } catch (err) {
    console.error(`Error fetching order book imbalance for ${symbol}:`, err.message);
    return {
      imbalanceRatio: null,
      wallStatus: "UNKNOWN",
      error: err.message
    };
  }
}

/**
 * Fetches BTC daily macro context: Price, RSI, and SMA crossover status
 */
async function fetchBtcMacroContext(exchange) {
  try {
    let btcSymbol = 'BTC/USDC';
    try {
      await exchange.loadMarkets();
      if (exchange.markets) {
        if (!exchange.markets[btcSymbol] && exchange.markets['BTC/USD']) {
          btcSymbol = 'BTC/USD';
        }
      }
    } catch (e) {
      // Ignore loadMarkets failure and proceed with BTC/USDC
    }

    const limit = 50;
    const candlesRaw = await exchange.fetchOHLCV(btcSymbol, '1d', undefined, limit);
    if (!candlesRaw || candlesRaw.length === 0) {
      throw new Error(`No daily candle data returned for ${btcSymbol}`);
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
    const sma9Arr = calculateSMA(closePrices, 9);
    const sma21Arr = calculateSMA(closePrices, 21);
    const rsiArr = calculateRSI(closePrices, 14);

    const currentPrice = closePrices[closePrices.length - 1];
    const currentSma9 = sma9Arr[sma9Arr.length - 1];
    const currentSma21 = sma21Arr[sma21Arr.length - 1];
    const currentRsi = rsiArr[rsiArr.length - 1];

    let smaCross = "NEUTRAL";
    if (currentSma9 !== null && currentSma21 !== null) {
      if (currentSma9 > currentSma21) {
        smaCross = "BULLISH (9 > 21)";
      } else if (currentSma9 < currentSma21) {
        smaCross = "BEARISH (9 < 21)";
      }
    }

    return {
      symbol: btcSymbol,
      price: currentPrice,
      rsi: currentRsi !== null ? parseFloat(currentRsi.toFixed(2)) : null,
      smaCross: smaCross,
      trend: currentSma9 > currentSma21 ? "BULLISH" : (currentSma9 < currentSma21 ? "BEARISH" : "NEUTRAL")
    };
  } catch (err) {
    console.error("Error fetching BTC macro context:", err.message);
    try {
      const btcSymbol = 'BTC/USD';
      const candlesRaw = await exchange.fetchOHLCV(btcSymbol, '1d', undefined, 50);
      const candles = candlesRaw.map(c => ({
        time: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
      }));
      const closePrices = candles.map(c => c.close);
      const sma9Arr = calculateSMA(closePrices, 9);
      const sma21Arr = calculateSMA(closePrices, 21);
      const rsiArr = calculateRSI(closePrices, 14);

      const currentPrice = closePrices[closePrices.length - 1];
      const currentSma9 = sma9Arr[sma9Arr.length - 1];
      const currentSma21 = sma21Arr[sma21Arr.length - 1];
      const currentRsi = rsiArr[rsiArr.length - 1];

      let smaCross = "NEUTRAL";
      if (currentSma9 !== null && currentSma21 !== null) {
        if (currentSma9 > currentSma21) {
          smaCross = "BULLISH (9 > 21)";
        } else if (currentSma9 < currentSma21) {
          smaCross = "BEARISH (9 < 21)";
        }
      }

      return {
        symbol: btcSymbol,
        price: currentPrice,
        rsi: currentRsi !== null ? parseFloat(currentRsi.toFixed(2)) : null,
        smaCross: smaCross,
        trend: currentSma9 > currentSma21 ? "BULLISH" : (currentSma9 < currentSma21 ? "BEARISH" : "NEUTRAL")
      };
    } catch (fallbackErr) {
      return {
        symbol: "BTC/USDC",
        price: null,
        rsi: null,
        smaCross: "UNKNOWN",
        trend: "UNKNOWN",
        error: err.message + " | " + fallbackErr.message
      };
    }
  }
}

/**
 * Execute a simulated paper trade
 */
function executePaperTrade(action, amountPct, currentPrice, assetName, db, reasoning = '', activeStates = null) {
  const feePct = 0.001; // 0.1% trade fee
  let tradeDetails = null;

  if (action === 'BUY') {
    const availableCash = db.portfolio.balanceUSD;
    if (availableCash <= 10) {
      return { success: false, message: "Insufficient USD balance to place a meaningful trade (must be > $10)." };
    }

    let allocation = availableCash * (amountPct / 100);
    
    // Enforce Max Position Allocation Cap for paper trading
    const maxAllocPct = db.settings?.maxPositionAllocationPct !== undefined ? db.settings.maxPositionAllocationPct : 75;
    let isCapped = false;
    let capLimit = 0;
    if (maxAllocPct > 0 && maxAllocPct < 100) {
      const holdings = db.portfolio.positions[assetName]?.amount || 0;
      const currentHoldingsValue = holdings * currentPrice;
      const totalPortfolioValue = availableCash + currentHoldingsValue;
      const maxHoldingsValueAllowed = totalPortfolioValue * (maxAllocPct / 100);
      const remainingAllowedPurchaseVal = maxHoldingsValueAllowed - currentHoldingsValue;
      
      if (remainingAllowedPurchaseVal <= 0) {
        return { success: false, message: `Cannot place paper BUY: Max Position Allocation Cap of ${maxAllocPct}% reached (Current: ${(currentHoldingsValue / totalPortfolioValue * 100).toFixed(1)}%).` };
      }
      
      if (allocation > remainingAllowedPurchaseVal) {
        addLog('info', `Capping paper BUY order size from $${allocation.toFixed(2)} to $${remainingAllowedPurchaseVal.toFixed(2)} to respect Max Position Allocation Cap of ${maxAllocPct}%.`);
        allocation = remainingAllowedPurchaseVal;
        isCapped = true;
        capLimit = remainingAllowedPurchaseVal;
      }
    }

    if (allocation < 10.0 && availableCash >= 10.0) {
      if (isCapped) {
        if (capLimit < 10.0) {
          return { success: false, message: `Cannot place paper BUY: Capped size of $${capLimit.toFixed(2)} (due to Max Position Allocation Cap of ${maxAllocPct}%) is below paper minimum of $10.00.` };
        } else {
          allocation = 10.0;
        }
      } else {
        allocation = 10.0;
      }
    }
    if (allocation > availableCash) {
      allocation = availableCash;
    }

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
      mode: db.settings?.tradingMode || 'paper',
      activeStates: activeStates || [new Date().toISOString()]
    };
    
    // Track active states on the position object
    if (!pos.activeStates) pos.activeStates = [];
    if (activeStates && Array.isArray(activeStates)) {
      activeStates.forEach(st => {
        if (!pos.activeStates.includes(st)) pos.activeStates.push(st);
      });
    }
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
      if (db.highestPriceReached && db.highestPriceReached[assetName]) {
        delete db.highestPriceReached[assetName];
      }
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
      netReturn: `${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}% ($${netReturnVal.toFixed(2)})`,
      activeStates: activeStates || [new Date().toISOString()]
    };
  }

  if (tradeDetails) {
    db.trades.unshift(tradeDetails);
    writeDB(db);
    logTradeToObsidian(tradeDetails, assetName);

    if (action === 'SELL') {
      try {
        const { evaluateBoardroomPerformance } = require('./rewardEngine');
        evaluateBoardroomPerformance(db, tradeDetails, (msg, level) => addLog(level || 'info', `[Boardroom Calibration] ${msg}`));
      } catch (err) {
        console.error("Failed to run boardroom performance evaluation in executePaperTrade:", err.message);
      }
    }

    return { success: true, trade: tradeDetails };
  }

  return { success: false, message: "No execution changes (HOLD or failed logic)." };
}

/**
 * Execute a real market trade on Coinbase Advanced
 */
async function executeLiveTrade(exchange, action, amountPct, currentPrice, assetName, db, symbol, reasoning = '', activeStates = null) {
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
      
      // Enforce Max Position Allocation Cap (respecting total portfolio value)
      const maxAllocPct = db.settings?.maxPositionAllocationPct !== undefined ? db.settings.maxPositionAllocationPct : 75;
      let isCapped = false;
      let capLimit = 0;
      if (maxAllocPct > 0 && maxAllocPct < 100) {
        const liveHoldings = balance.total[assetName] || balance.free[assetName] || 0;
        const currentHoldingsValue = liveHoldings * currentPrice;
        const totalPortfolioValue = availableCash + currentHoldingsValue;
        const maxHoldingsValueAllowed = totalPortfolioValue * (maxAllocPct / 100);
        const remainingAllowedPurchaseVal = maxHoldingsValueAllowed - currentHoldingsValue;
        
        if (remainingAllowedPurchaseVal <= 0) {
          throw new Error(`Cannot place BUY order: Max Position Allocation Cap of ${maxAllocPct}% reached (Current: ${(currentHoldingsValue / totalPortfolioValue * 100).toFixed(1)}% | XRP Value: $${currentHoldingsValue.toFixed(2)} | Portfolio: $${totalPortfolioValue.toFixed(2)}).`);
        }
        
        if (allocation > remainingAllowedPurchaseVal) {
          addLog('info', `Capping BUY order size from $${allocation.toFixed(2)} to $${remainingAllowedPurchaseVal.toFixed(2)} to respect Max Position Allocation Cap of ${maxAllocPct}%.`);
          allocation = remainingAllowedPurchaseVal;
          isCapped = true;
          capLimit = remainingAllowedPurchaseVal;
        }
      }

      if (allocation < 5.0 && availableCash >= 5.0) {
        if (isCapped) {
          if (capLimit < 5.0) {
            throw new Error(`Cannot place BUY order: Capped size of $${capLimit.toFixed(2)} (due to Max Position Allocation Cap of ${maxAllocPct}%) is below Coinbase minimum of $5.00.`);
          } else {
            allocation = 5.0;
          }
        } else {
          allocation = 5.0; // Auto scale up to exchange minimum
        }
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
        mode: 'live',
        activeStates: activeStates || [new Date().toISOString()]
      };
      
      // Track active states on the position object
      if (!db.portfolio.positions[assetName]) {
        db.portfolio.positions[assetName] = { amount: 0, avgEntryPrice: 0, activeStates: [] };
      }
      const pos = db.portfolio.positions[assetName];
      if (!pos.activeStates) pos.activeStates = [];
      if (activeStates && Array.isArray(activeStates)) {
        activeStates.forEach(st => {
          if (!pos.activeStates.includes(st)) pos.activeStates.push(st);
        });
      }

    } else if (action === 'SELL') {
      const holdings = balance.total[assetName] || balance.free[assetName] || 0;

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
        mode: 'live',
        activeStates: activeStates || [new Date().toISOString()]
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
        const liveAssetAmount = updatedBalance.total[assetName] || updatedBalance.free[assetName] || 0;
        const oldPos = db.portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };
        const oldAmount = oldPos.amount || 0;
        const oldAvg = oldPos.avgEntryPrice || 0;
        const fillAmount = orderDetails.amount;
        const fillPrice = orderDetails.price;
        
        const totalAmount = oldAmount + fillAmount;
        let newAvgPrice = fillPrice;
        if (totalAmount > 0) {
          newAvgPrice = ((oldAmount * oldAvg) + (fillAmount * fillPrice)) / totalAmount;
        }

        const existingPos = db.portfolio.positions[assetName] || {};
        db.portfolio.positions[assetName] = {
          amount: liveAssetAmount,
          avgEntryPrice: Number(newAvgPrice.toFixed(6)),
          activeStates: existingPos.activeStates || []
        };
      } else if (action === 'SELL') {
        const liveAssetAmount = updatedBalance.total[assetName] || updatedBalance.free[assetName] || 0;
        if (liveAssetAmount <= 0.00001) {
          delete db.portfolio.positions[assetName];
          if (db.highestPriceReached && db.highestPriceReached[assetName]) {
            delete db.highestPriceReached[assetName];
          }
        } else {
          const existingPos = db.portfolio.positions[assetName] || {};
          db.portfolio.positions[assetName] = {
            amount: liveAssetAmount,
            avgEntryPrice: existingPos.avgEntryPrice || orderDetails.price,
            activeStates: existingPos.activeStates || []
          };
        }
      }

      writeDB(db);
      logTradeToObsidian(orderDetails, assetName);

      if (action === 'SELL') {
        try {
          const { evaluateBoardroomPerformance } = require('./rewardEngine');
          evaluateBoardroomPerformance(db, orderDetails, (msg, level) => addLog(level || 'info', `[Boardroom Calibration] ${msg}`));
        } catch (err) {
          console.error("Failed to run boardroom performance evaluation in executeLiveTrade:", err.message);
        }
      }

      return { success: true, trade: orderDetails };
    }
  } catch (err) {
    addLog('error', `Live Trade Execution Failed: ${err.message}`);
    throw err;
  }
}

/**
 * Execute a simulated perpetual paper trade (Phase 1)
 */
function executePaperPerpTrade(action, amountPct, leverage, currentPrice, assetName, db, reasoning = '', activeStates = null) {
  const feePct = 0.0006; // Typical swap trading fee (0.06%)
  let tradeDetails = null;

  // Initialize futures database structure if missing
  if (!db.portfolio.futures) {
    db.portfolio.futures = {
      marginBalanceUSD: 100.00,
      unrealizedPnL: 0.00,
      positions: {}
    };
  }
  
  const futures = db.portfolio.futures;
  if (!futures.positions) {
    futures.positions = {};
  }

  // Handle open actions: BUY (Long) and SHORT (Short)
  if (action === 'BUY' || action === 'SHORT') {
    const availableMargin = futures.marginBalanceUSD;
    if (availableMargin <= 5) {
      return { success: false, message: `Insufficient isolated margin balance ($${availableMargin.toFixed(2)}) to open a trade (must be > $5).` };
    }

    // Amount to allocate as margin
    let allocatedMargin = availableMargin * (amountPct / 100);
    if (allocatedMargin < 5.0 && availableMargin >= 5.0) {
      allocatedMargin = 5.0; // minimum margin requirement
    }
    if (allocatedMargin > availableMargin) {
      allocatedMargin = availableMargin;
    }

    // Notional position value controlled
    const notionalValue = allocatedMargin * leverage;
    
    // Fee is calculated on notional size
    const fee = notionalValue * feePct;

    // Check if we can afford the margin + fee
    if (allocatedMargin + fee > availableMargin) {
      // Reduce allocated margin to fit within available margin including fee
      allocatedMargin = availableMargin / (1 + leverage * feePct);
      if (allocatedMargin < 1.0) {
        return { success: false, message: `Cannot afford position margin and trade fees with current balance.` };
      }
    }

    const finalNotional = allocatedMargin * leverage;
    const finalSize = finalNotional / currentPrice;
    const finalFee = finalNotional * feePct;

    // Deduct fee and subtract allocated margin from available balance
    futures.marginBalanceUSD -= (allocatedMargin + finalFee);

    const side = action === 'BUY' ? 'LONG' : 'SHORT';
    
    // Check if we already have an active opposite position
    const existingPos = futures.positions[assetName];
    if (existingPos && existingPos.side !== side) {
      return { success: false, message: `Cannot open ${side} while holding opposite ${existingPos.side} position. Please close/cover first.` };
    }

    if (!existingPos) {
      // Create new position
      const liquidationPrice = side === 'LONG' 
        ? currentPrice * (1 - 1 / leverage) 
        : currentPrice * (1 + 1 / leverage);

      futures.positions[assetName] = {
        side,
        amount: finalSize,
        entryPrice: currentPrice,
        leverage,
        margin: allocatedMargin,
        liquidationPrice: Number(liquidationPrice.toFixed(6)),
        unrealizedPnL: 0.00,
        activeStates: activeStates || [new Date().toISOString()]
      };
    } else {
      // Scale-in existing position
      const pos = futures.positions[assetName];
      if (activeStates && Array.isArray(activeStates)) {
        activeStates.forEach(st => {
          if (!pos.activeStates.includes(st)) pos.activeStates.push(st);
        });
      }
      const totalNotional = (pos.amount * pos.entryPrice) + finalNotional;
      pos.amount += finalSize;
      pos.margin += allocatedMargin;
      pos.entryPrice = totalNotional / pos.amount;
      pos.leverage = leverage; // update leverage to current action's leverage
      
      // Re-calculate liquidation price
      const liquidationPrice = pos.side === 'LONG'
        ? pos.entryPrice * (1 - 1 / pos.leverage)
        : pos.entryPrice * (1 + 1 / pos.leverage);
      pos.liquidationPrice = Number(liquidationPrice.toFixed(6));
    }

    tradeDetails = {
      timestamp: new Date().toISOString(),
      symbol: db.settings?.selectedAsset || `${assetName}/USD`,
      action: action, // BUY or SHORT
      price: currentPrice,
      amount: finalSize,
      total: finalNotional, // notional total
      fee: finalFee,
      balanceAfter: futures.marginBalanceUSD,
      reasoning: reasoning,
      mode: db.settings?.tradingMode || 'paper',
      tradeType: 'futures',
      leverage: leverage,
      activeStates: activeStates || [new Date().toISOString()]
    };

  } else if (action === 'SELL' || action === 'COVER') {
    // Handle close actions: SELL (Close Long) and COVER (Close Short)
    const pos = futures.positions[assetName];
    if (!pos) {
      return { success: false, message: `No active perpetual position in ${assetName} to close.` };
    }

    // Verify correct direction closing
    if (action === 'SELL' && pos.side !== 'LONG') {
      return { success: false, message: `Cannot SELL (Close Long) because active XRP position is SHORT. Use COVER to close/reduce short.` };
    }
    if (action === 'COVER' && pos.side !== 'SHORT') {
      return { success: false, message: `Cannot COVER (Close Short) because active XRP position is LONG. Use SELL to close/reduce long.` };
    }

    const closeAmount = pos.amount * (amountPct / 100);
    const releasedMargin = pos.margin * (amountPct / 100);
    const closeNotional = closeAmount * currentPrice;
    
    // Calculate PnL
    let pnl = 0;
    if (pos.side === 'LONG') {
      pnl = (currentPrice - pos.entryPrice) * closeAmount;
    } else {
      pnl = (pos.entryPrice - currentPrice) * closeAmount;
    }

    // Fee calculated on closed notional value
    const fee = closeNotional * feePct;
    
    // Return margin + PnL - fee to available balance
    futures.marginBalanceUSD += (releasedMargin + pnl - fee);

    // Record trade details
    const netReturnVal = pnl - fee;
    const netReturnPct = (pnl / (releasedMargin || 1)) * 100;

    tradeDetails = {
      timestamp: new Date().toISOString(),
      symbol: db.settings?.selectedAsset || `${assetName}/USD`,
      action: action, // SELL or COVER
      price: currentPrice,
      amount: closeAmount,
      total: closeNotional,
      fee: fee,
      balanceAfter: futures.marginBalanceUSD,
      reasoning: reasoning,
      mode: db.settings?.tradingMode || 'paper',
      tradeType: 'futures',
      leverage: pos.leverage,
      netReturnVal: Number(netReturnVal.toFixed(4)),
      netReturnPct: Number(netReturnPct.toFixed(2)),
      netReturn: `${netReturnVal >= 0 ? '+' : ''}${netReturnVal.toFixed(2)} USD (${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}%)`,
      activeStates: activeStates || [new Date().toISOString()]
    };

    // Update or remove position
    pos.amount -= closeAmount;
    pos.margin -= releasedMargin;

    if (pos.amount <= 0.0001 || amountPct >= 99.9) {
      delete futures.positions[assetName];
    } else {
      if (activeStates && Array.isArray(activeStates)) {
        activeStates.forEach(st => {
          if (!pos.activeStates.includes(st)) pos.activeStates.push(st);
        });
      }
    }
  }

  if (tradeDetails) {
    if (!db.trades) db.trades = [];
    db.trades.unshift(tradeDetails);
    
    // Recompute unrealized PnL and total portfolio values
    recalculatePaperFuturesPnL(db, currentPrice, assetName);
    writeDB(db);
    logTradeToObsidian(tradeDetails, assetName);
    return { success: true, trade: tradeDetails };
  }

  return { success: false, message: `Invalid action specified: ${action}` };
}

/**
 * Recomputes paper futures unrealized PnL
 */
function recalculatePaperFuturesPnL(db, currentPrice, assetName) {
  if (!db.portfolio.futures || !db.portfolio.futures.positions) return;
  const pos = db.portfolio.futures.positions[assetName];
  if (!pos) return;
  
  let pnl = 0;
  if (pos.side === 'LONG') {
    pnl = (currentPrice - pos.entryPrice) * pos.amount;
  } else {
    pnl = (pos.entryPrice - currentPrice) * pos.amount;
  }
  pos.unrealizedPnL = Number(pnl.toFixed(4));
  
  // Update global futures unrealized PnL
  let totalPnL = 0;
  for (const k of Object.keys(db.portfolio.futures.positions)) {
    totalPnL += db.portfolio.futures.positions[k].unrealizedPnL || 0;
  }
  db.portfolio.futures.unrealizedPnL = Number(totalPnL.toFixed(4));
}

/**
 * Helper to resolve the correct CCXT swap/futures symbol
 */
function getFuturesSymbol(exchange, symbol) {
  if (symbol.includes(':')) {
    // If it's already a resolved symbol, verify it is a swap/perp
    if (exchange.markets && exchange.markets[symbol]) {
      const market = exchange.markets[symbol];
      if (market.swap || symbol.includes('PERP')) {
        return symbol;
      }
      return null;
    }
    return symbol;
  }
  if (exchange.markets) {
    const parts = symbol.split('/');
    const base = parts[0];
    const quote = parts[1] || 'USDC';
    
    // 1. Try exact matches for perpetual swaps
    const candidate1 = `${base}/${quote}:${quote}`;
    if (exchange.markets[candidate1] && (exchange.markets[candidate1].swap || candidate1.includes('PERP'))) return candidate1;
    const candidate2 = `${base}/${quote}`;
    if (exchange.markets[candidate2] && (exchange.markets[candidate2].swap || candidate2.includes('PERP'))) return candidate2;
    const candidate3 = `${base}-${quote}-PERP`;
    if (exchange.markets[candidate3]) return candidate3;
    
    // 2. Loop through all markets to find any perpetual swap matching exact base and quote
    for (const key of Object.keys(exchange.markets)) {
      const market = exchange.markets[key];
      if (market.base === base && market.quote === quote && (market.swap || key.includes('PERP'))) {
        return key;
      }
    }
    
    // 3. Broad search: Find any perpetual swap for this base currency (e.g. route XRP/USD -> XRP/USDC:USDC)
    for (const key of Object.keys(exchange.markets)) {
      const market = exchange.markets[key];
      if (market.base === base && (market.swap || key.includes('PERP'))) {
        return key;
      }
    }
  }
  return null; // Return null if no perpetual swap market can be resolved
}

/**
 * Helper to dynamically set Coinbase Advanced Futures portfolio configuration
 */
async function ensureCoinbasePortfolio(exchange) {
  if (exchange.id === 'coinbase' && !exchange.options['portfolio']) {
    try {
      const portfolios = await exchange.fetchPortfolios();
      if (Array.isArray(portfolios) && portfolios.length > 0) {
        const activePort = portfolios.find(p => p.type === 'futures' || p.name?.toLowerCase().includes('futures') || p.status === 'active') || portfolios[0];
        if (activePort && activePort.id) {
          exchange.options['portfolio'] = activePort.id;
          console.log(`[INFO] Auto-configured Coinbase Futures portfolio option: ${activePort.id} (${activePort.name || 'Default'})`);
        }
      }
    } catch (e) {
      console.warn("[WARNING] Failed to fetch Coinbase portfolios:", e.message);
    }
  }
}

/**
 * Syncs the live futures portfolio state and active position for a symbol from CCXT
 */
async function syncLiveFuturesState(db, exchange, symbol, assetName, marginCurrency) {
  try {
    await ensureCoinbasePortfolio(exchange);
    if (!db.portfolio.futures) {
      db.portfolio.futures = {
        marginBalanceUSD: 100.0,
        unrealizedPnL: 0.0,
        positions: {}
      };
    }
    
    // Resolve futures symbol
    const futSymbol = getFuturesSymbol(exchange, symbol);

    // Fetch balance
    const balance = await exchange.fetchBalance({ type: 'future' });
    db.portfolio.futures.marginBalanceUSD = balance.free[marginCurrency] || balance.total[marginCurrency] || 0;

    // Fetch positions
    if (typeof exchange.fetchPositions === 'function') {
      const positions = await exchange.fetchPositions([futSymbol]);
      const activePos = positions.find(p => p.symbol === futSymbol);
      
      if (activePos && parseFloat(activePos.contracts || activePos.amount || 0) !== 0) {
        const side = activePos.side?.toUpperCase() || (parseFloat(activePos.contracts || activePos.amount || 0) > 0 ? 'LONG' : 'SHORT');
        const size = Math.abs(parseFloat(activePos.contracts || activePos.amount || 0));
        const entryPrice = parseFloat(activePos.entryPrice || activePos.avgEntryPrice || 0);
        const leverage = parseFloat(activePos.leverage || 1);
        const margin = parseFloat(activePos.initialMargin || activePos.margin || (size * entryPrice / leverage));
        const liquidationPrice = parseFloat(activePos.liquidationPrice || (side === 'LONG' ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage)));
        const unrealizedPnL = parseFloat(activePos.unrealizedPnl || activePos.pnl || 0);

        db.portfolio.futures.positions[assetName] = {
          side,
          amount: size,
          entryPrice,
          leverage,
          margin,
          liquidationPrice,
          unrealizedPnL,
          activeStates: db.portfolio.futures.positions[assetName]?.activeStates || [new Date().toISOString()]
        };
      } else {
        delete db.portfolio.futures.positions[assetName];
      }
    }
    
    // Recompute total unrealized futures PnL
    let totalPnL = 0;
    for (const k of Object.keys(db.portfolio.futures.positions)) {
      totalPnL += db.portfolio.futures.positions[k].unrealizedPnL || 0;
    }
    db.portfolio.futures.unrealizedPnL = Number(totalPnL.toFixed(4));
    
    return true;
  } catch (err) {
    addLog('warning', `Failed to sync live futures state: ${err.message}`);
    return false;
  }
}

/**
 * Execute a real swap/futures order on exchange
 */
async function executeLivePerpTrade(exchange, action, amountPct, leverage, currentPrice, assetName, db, symbol, reasoning = '', activeStates = null) {
  addLog('info', `Attempting Live Market Futures ${action} order on ${exchange.id} for ${symbol}...`);
  const feePct = 0.0006; // Typical swap trading fee (0.06%)

  try {
    await ensureCoinbasePortfolio(exchange);
    // 1. Load markets
    await exchange.loadMarkets();

    // 2. Fetch balance for futures
    const quoteCurrency = symbol.split('/')[1]?.split(':')[0] || 'USDC';
    const marginCurrency = quoteCurrency;

    const balance = await exchange.fetchBalance({ type: 'future' });
    const availableMargin = balance.free[marginCurrency] || balance.total[marginCurrency] || 0;
    
    if (availableMargin <= 5) {
      throw new Error(`Insufficient isolated futures margin balance in ${marginCurrency} (${availableMargin.toFixed(2)}) on ${exchange.id}.`);
    }

    // Resolve futures symbol (strictly perpetual swaps only)
    const futSymbol = getFuturesSymbol(exchange, symbol);
    if (!futSymbol) {
      throw new Error(`Only perpetual swaps (perps) are permitted. No active perpetual swap market was resolved on ${exchange.id} for base asset of ${symbol}.`);
    }

    // Set leverage on exchange
    try {
      if (typeof exchange.setLeverage === 'function') {
        addLog('info', `Configuring leverage to ${leverage}x on ${exchange.id} for ${futSymbol}...`);
        await exchange.setLeverage(leverage, futSymbol);
      }
    } catch (levErr) {
      addLog('warning', `Failed to set leverage on exchange: ${levErr.message}. Continuing order placement...`);
    }

    // Determine target size
    let allocatedMargin = availableMargin * (amountPct / 100);
    if (allocatedMargin < 5.0 && availableMargin >= 5.0) {
      allocatedMargin = 5.0;
    }
    if (allocatedMargin > availableMargin) {
      allocatedMargin = availableMargin;
    }

    const targetNotional = allocatedMargin * leverage;
    let sizeAmount = targetNotional / currentPrice;

    // CCXT order side & params
    let side = 'buy';
    let params = { leverage: leverage };

    if (action === 'BUY') {
      side = 'buy';
    } else if (action === 'SHORT') {
      side = 'sell';
    } else if (action === 'SELL') {
      side = 'sell';
      params.reduceOnly = true;
    } else if (action === 'COVER') {
      side = 'buy';
      params.reduceOnly = true;
    }

    // If closing, we close a percentage of active position size
    if (action === 'SELL' || action === 'COVER') {
      let activePosSize = 0;
      try {
        const positions = await exchange.fetchPositions([futSymbol]);
        const activePos = positions.find(p => p.symbol === futSymbol);
        if (activePos) {
          activePosSize = Math.abs(parseFloat(activePos.contracts || activePos.amount || 0));
        }
      } catch (posErr) {
        addLog('warning', `Could not fetch live position size: ${posErr.message}. Estimating from DB.`);
        const dbPos = db.portfolio.futures?.positions?.[assetName];
        if (dbPos) {
          activePosSize = dbPos.amount;
        }
      }

      if (activePosSize <= 0) {
        throw new Error(`No active live position found in ${futSymbol} to close.`);
      }

      sizeAmount = activePosSize * (amountPct / 100);
    }

    const sizeRounded = Number(exchange.amountToPrecision(futSymbol, sizeAmount));
    if (sizeRounded <= 0) {
      throw new Error(`Calculated contract size (${sizeAmount}) is too small for exchange rules.`);
    }

    addLog('info', `Placing Live Market Futures ${action.toUpperCase()} order on ${exchange.id} for ${sizeRounded} contracts of ${futSymbol}...`);

    // Place the order
    const order = await exchange.createOrder(futSymbol, 'market', side, sizeRounded, undefined, params);

    // Sync database state from exchange
    await syncLiveFuturesState(db, exchange, symbol, assetName, marginCurrency);
    
    // Construct trade details for logging
    const orderPrice = order.price || currentPrice;
    const orderAmount = order.amount || sizeRounded;
    const orderTotal = order.cost || (orderAmount * orderPrice);
    const orderFee = (order.fee && typeof order.fee.cost === 'number') ? order.fee.cost : (orderTotal * feePct);

    const tradeDetails = {
      timestamp: new Date().toISOString(),
      symbol: symbol,
      action: action,
      price: orderPrice,
      amount: orderAmount,
      total: orderTotal,
      fee: orderFee,
      balanceAfter: db.portfolio.futures?.marginBalanceUSD || 0,
      reasoning: reasoning,
      mode: 'live',
      tradeType: 'futures',
      leverage: leverage,
      activeStates: activeStates || [new Date().toISOString()]
    };
    
    // Track active states on the position object
    if (action === 'BUY' || action === 'SHORT') {
      if (!db.portfolio.futures) db.portfolio.futures = {};
      if (!db.portfolio.futures.positions) db.portfolio.futures.positions = {};
      const pos = db.portfolio.futures.positions[assetName];
      if (pos) {
        if (!pos.activeStates) pos.activeStates = [];
        if (activeStates && Array.isArray(activeStates)) {
          activeStates.forEach(st => {
            if (!pos.activeStates.includes(st)) pos.activeStates.push(st);
          });
        }
      }
    }

    if (action === 'SELL' || action === 'COVER') {
      const dbPos = db.portfolio.futures?.positions?.[assetName];
      const entryPrice = dbPos ? dbPos.entryPrice : orderPrice;
      const releasedMargin = dbPos ? (dbPos.margin * (amountPct / 100)) : (orderTotal / leverage);
      let pnl = 0;
      if (action === 'SELL') {
        pnl = (orderPrice - entryPrice) * orderAmount;
      } else {
        pnl = (entryPrice - orderPrice) * orderAmount;
      }
      const netReturnVal = pnl - orderFee;
      const netReturnPct = (pnl / (releasedMargin || 1)) * 100;
      
      tradeDetails.netReturnVal = Number(netReturnVal.toFixed(4));
      tradeDetails.netReturnPct = Number(netReturnPct.toFixed(2));
      tradeDetails.netReturn = `${netReturnVal >= 0 ? '+' : ''}${netReturnVal.toFixed(2)} USD (${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}%)`;
    }

    if (!db.trades) db.trades = [];
    db.trades.unshift(tradeDetails);
    writeDB(db);
    logTradeToObsidian(tradeDetails, assetName);

    return { success: true, trade: tradeDetails };

  } catch (err) {
    addLog('error', `Live Perpetual Trade Execution Failed: ${err.message}`);
    throw err;
  }
}

/**
 * Unified notifier that dispatches messages to Telegram (or SMS) and Discord,
 * and tracks the last sent message time to support silence breakers.
 */
async function sendTelegramAndDiscordAlert(msg, settings) {
  let sentAny = false;
  
  if (settings.notificationType === 'telegram' && settings.telegramBotToken && settings.telegramChatId) {
    try {
      await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg);
      sentAny = true;
    } catch (e) {
      console.error("[NOTIFIER ERROR] Telegram alert failed:", e.message);
    }
  } else if (settings.notificationType === 'sms' && settings.phoneNumber && settings.phoneCarrier) {
    try {
      const smtpConfig = {
        host: settings.smtpHost,
        port: settings.smtpPort,
        user: settings.smtpUser,
        pass: settings.smtpPass
      };
      const cleanMsg = msg.replace(/<[^>]*>/g, '');
      await sendSMSAlert(smtpConfig, settings.phoneNumber, settings.phoneCarrier, cleanMsg);
      sentAny = true;
    } catch (e) {
      console.error("[NOTIFIER ERROR] SMS alert failed:", e.message);
    }
  }

  if (settings.discordWebhookUrl) {
    try {
      await sendDiscordWebhook(settings.discordWebhookUrl, msg);
      sentAny = true;
    } catch (e) {
      console.error("[NOTIFIER ERROR] Discord webhook failed:", e.message);
    }
  }

  if (sentAny) {
    try {
      const db = readDB();
      db.lastTelegramMessageTime = Date.now();
      writeDB(db);
    } catch (dbErr) {
      console.error("Failed to update lastTelegramMessageTime in DB:", dbErr.message);
    }
  }
}

/**
 * Main trading bot ticker cycle
 */
async function runBotCycle() {
  syncRulesFromObsidian();
  let db = readDB();
  const settings = db.settings;
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

  // Weekly Meta-Cognitive Review Job Check
  if (settings.obsidianVaultPath) {
    const weeklyReviewMs = 7 * 24 * 60 * 60 * 1000;
    if (!db.lastWeeklyReviewTime || (Date.now() - db.lastWeeklyReviewTime > weeklyReviewMs)) {
      addLog('info', "Triggering Weekly Meta-Cognitive Performance Audit...");
      try {
        const { runWeeklyReview } = require('./jobs/reviewer');
        runWeeklyReview(settings).then(proposedPath => {
          if (proposedPath) {
            let currentDb = readDB();
            currentDb.lastWeeklyReviewTime = Date.now();
            writeDB(currentDb);
            addLog('info', `Weekly review completed. Proposed strategy era saved to ${proposedPath}`);
          }
        }).catch(err => {
          console.error("Weekly review execution failed:", err.message);
        });
      } catch (err) {
        console.error("Failed to load reviewer job:", err.message);
      }
    }
  }

  // Daily Hypothesis Tester Check
  if (settings.obsidianVaultPath) {
    const dailyTesterMs = 24 * 60 * 60 * 1000;
    if (!db.lastHypothesisTestTime || (Date.now() - db.lastHypothesisTestTime > dailyTesterMs)) {
      addLog('info', "Triggering Daily Hypothesis Testing Evaluation...");
      try {
        const { runHypothesisTester } = require('./jobs/hypothesisTester');
        runHypothesisTester(settings, (msg, level) => addLog(level || 'info', msg)).then(() => {
          let currentDb = readDB();
          currentDb.lastHypothesisTestTime = Date.now();
          writeDB(currentDb);
          addLog('info', "Daily hypothesis testing evaluation complete.");
        }).catch(err => {
          console.error("Hypothesis testing evaluation failed:", err.message);
        });
      } catch (err) {
        console.error("Failed to load hypothesis tester job:", err.message);
      }
    }
  }

  // Weekly Genetic Sizing Optimization Check
  if (settings.obsidianVaultPath) {
    const weeklySizingMs = 7 * 24 * 60 * 60 * 1000;
    if (!db.lastWeeklySizingTime || (Date.now() - db.lastWeeklySizingTime > weeklySizingMs)) {
      addLog('info', "Triggering Weekly Genetic Sizing Formula Optimization...");
      try {
        const { mutateAndBacktestSizing } = require('./sizingSandbox');
        mutateAndBacktestSizing(apiKey, settings, (msg, level) => addLog(level || 'info', msg)).then(() => {
          let currentDb = readDB();
          currentDb.lastWeeklySizingTime = Date.now();
          writeDB(currentDb);
          addLog('info', "Weekly genetic sizing optimization complete.");
        }).catch(err => {
          console.error("Weekly sizing optimization failed:", err.message);
        });
      } catch (err) {
        console.error("Failed to load sizing sandbox job:", err.message);
      }
    }
  }

  if (!db.lastTelegramMessageTime) {
    db.lastTelegramMessageTime = Date.now();
    writeDB(db);
  }

  if (!settings.botEnabled) {
    addLog('info', "Bot cycle skipped: Bot is disabled.");
    stopBotLoop();
    return;
  }

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
    // Sync balance at start of bot cycle to ensure we use up-to-date portfolio values
    db = await syncLiveBalance(db, exchange);
    
    let marketData = await getMarketContext(exchange, settings.selectedAsset, settings.selectedTimeframe, 200);
    const currentPrice = marketData.ticker.close;

    // Fetch Order Book imbalance and BTC Macro trend
    addLog('info', `Fetching order book depth for ${settings.selectedAsset}...`);
    let orderBook = { imbalanceRatio: null, wallStatus: "UNKNOWN" };
    try {
      orderBook = await fetchOrderBookImbalance(exchange, settings.selectedAsset);
    } catch (obErr) {
      addLog('warning', `Failed to fetch order book depth: ${obErr.message}`);
    }
    marketData.orderBook = orderBook;

    addLog('info', "Fetching BTC daily macro trend correlation...");
    let btcContext = { price: null, rsi: null, smaCross: "UNKNOWN", trend: "UNKNOWN" };
    try {
      btcContext = await fetchBtcMacroContext(exchange);
    } catch (btcErr) {
      addLog('warning', `Failed to fetch BTC macro trend: ${btcErr.message}`);
    }
    marketData.btcContext = btcContext;

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

    // --- PROACTIVE MARKET SHIFT DETECTION ---
    const prevDecision = db.latestDecision;
    if (prevDecision && prevDecision.indicators) {
      const prevRegime = prevDecision.indicators.marketRegime || "UNKNOWN";
      const prevSma9 = prevDecision.indicators.sma9;
      const prevSma21 = prevDecision.indicators.sma21;

      // 1. Regime Shift Alert
      if (prevRegime !== "UNKNOWN" && marketRegime !== prevRegime) {
        const regimeCleanNames = {
          "CHOPPY_RANGE": "Choppy Consolidation Range (defensive trading)",
          "TRENDING_BULLISH": "Trending Bullish breakout (aggressive buying mode)",
          "TRENDING_BEARISH": "Trending Bearish markdown (capital preservation mode)",
          "STRONG_TREND_CONSOLIDATION": "Strong Trend Consolidation range",
          "HIGH_VOLATILITY_SQUEEZE": "High Volatility Squeeze zone",
          "TRANSITIONING_ZONE": "Transitioning market zone"
        };
        const currentClean = regimeCleanNames[marketRegime] || marketRegime;
        const prevClean = regimeCleanNames[prevRegime] || prevRegime;

        let alertMsg = `📢 <b>Aether Market Shift Alert: Regime Transition</b>\n\n` +
                       `Hey Boss, I've just scanned the charts for <b>${settings.selectedAsset}</b> and detected an environmental shift!\n\n` +
                       `• Old Regime: <i>${prevClean}</i>\n` +
                       `• New Regime: <b>${currentClean}</b>\n` +
                       `• ADX Strength: <b>${currentADX ? currentADX.toFixed(2) : 'N/A'}</b> | Volume RVol: <b>${currentRVol ? currentRVol.toFixed(2) : 'N/A'}</b>\n\n` +
                       `This environmental transition signals that market participants are changing behavior. I will adjust my trade sizing and safety stops to align with the new <b>${marketRegime}</b> setup. I am keeping my strategy plans updated!`;
        await sendTelegramAndDiscordAlert(alertMsg, settings);
      }

      // 2. Momentum Cross Alert
      if (prevSma9 && prevSma21 && currentSma9 && currentSma21) {
        const wasBullish = prevSma9 > prevSma21;
        const isBullish = currentSma9 > currentSma21;
        if (wasBullish !== isBullish) {
          const crossType = isBullish ? "Golden Cross (Bullish Crossover)" : "Death Cross (Bearish Crossover)";
          const crossIcon = isBullish ? "⚡" : "⚠️";
          let alertMsg = `${crossIcon} <b>Aether Technical Alert: Momentum Cross</b>\n\n` +
                         `Hey Boss, we just got a crossover of the 9 SMA and 21 SMA on the <b>${settings.selectedAsset}</b> execution timeframe!\n\n` +
                         `• Event: <b>${crossType}</b>\n` +
                         `• SMA (9): <b>$${currentSma9.toLocaleString()}</b>\n` +
                         `• SMA (21): <b>$${currentSma21.toLocaleString()}</b>\n` +
                         `• Current Price: <b>$${currentPrice.toLocaleString()}</b>\n\n` +
                         `This cross confirms a major shift in short-term price momentum. I am recalculating our support/resistance targets and updating my watch triggers.`;
          await sendTelegramAndDiscordAlert(alertMsg, settings);
        }
      }
    }

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
          const macroContextRaw = await getMarketContext(exchange, settings.selectedAsset, macroTimeframe, 200);
          const macroData = {
            timeframe: macroTimeframe,
            indicators: macroContextRaw.indicators,
            recentCandles: macroContextRaw.recentCandles
          };
          marketData.macroContext = macroData;
          
          // Update database cache
          try {
            const freshDb = readDB();
            freshDb.macroCache = {
              timestamp: new Date().toISOString(),
              symbol: settings.selectedAsset,
              timeframe: macroTimeframe,
              data: macroData
            };
            writeDB(freshDb);
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
    if (pos && pos.amount > 0 && pos.avgEntryPrice > 0) {
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
      const freshDb = readDB();
      if (freshDb.highestPriceReached && freshDb.highestPriceReached[assetName]) {
        delete freshDb.highestPriceReached[assetName];
        writeDB(freshDb);
      }
    }
    
    // --- CANDLE BOUNDARY SKIP CHECK ---
    const latestCandle = marketData.recentCandles[marketData.recentCandles.length - 1];
    const latestCandleTime = latestCandle ? latestCandle.time : null;

    if (!forceNextCycle && latestCandleTime && db.latestDecision) {
      const isSameAsset = db.latestDecision.symbol === settings.selectedAsset;
      const isSameTimeframe = db.latestDecision.timeframe === settings.selectedTimeframe;
      const isSameCandle = db.latestDecision.candleTime === latestCandleTime;

      if (isSameAsset && isSameTimeframe && isSameCandle) {
        addLog('info', `Skipping Gemini Brain analysis: Already evaluated candle at ${new Date(latestCandleTime).toISOString()} for ${settings.selectedAsset} (${settings.selectedTimeframe}).`);
        return;
      }
    }
    
    // Reset force run flag if it was active
    forceNextCycle = false;

    // Smart Token Bypass Check
    const availableCash = db.portfolio.balanceUSD;
    const currentHoldings = pos ? pos.amount : 0;
    const minBuyAmount = settings.tradingMode === 'live' ? 5.0 : 10.0;
    const hasNoHoldings = currentHoldings <= 0.00001;
    const hasNoCash = availableCash < minBuyAmount;

    if (hasNoHoldings && hasNoCash) {
      addLog('info', `Skipping Gemini API call: Trade impossible (No XRP holdings to SELL and insufficient cash [$${availableCash.toFixed(2)}] to BUY). Defaulting to HOLD.`);
      
      const freshDb = readDB();
      freshDb.latestDecision = {
        decision: "HOLD",
        reasoning: `Skipped Gemini API call: No holdings to sell (XRP balance: ${currentHoldings.toFixed(4)}) and cash balance ($${availableCash.toFixed(2)}) is below the required minimum of $${minBuyAmount.toFixed(2)} to place a buy order.`,
        confidence: 1.0,
        amount_pct: 0,
        market_structure: "N/A - Insufficient funds",
        support_level: 0,
        resistance_level: 0,
        news_sentiment_score: 0,
        risk_reward_ratio: 0,
        timestamp: new Date().toISOString(),
        symbol: settings.selectedAsset,
        timeframe: settings.selectedTimeframe,
        candleTime: latestCandleTime,
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
        news: []
      };
      writeDB(freshDb);
      return;
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
    const analysis = await getTradingDecision(apiKey, marketData, db.portfolio, settings, (msg, type = 'warning') => addLog(type, msg));
    
    // Save latest AI diagnostic data to database
    const freshDb = readDB();
    
    if (analysis.wargameResult && analysis.stateTimestamp) {
      if (!freshDb.wargameHistory) freshDb.wargameHistory = {};
      freshDb.wargameHistory[analysis.stateTimestamp] = analysis.wargameResult;
      
      const wargameKeys = Object.keys(freshDb.wargameHistory).sort();
      if (wargameKeys.length > 200) {
        for (let i = 0; i < wargameKeys.length - 200; i++) {
          delete freshDb.wargameHistory[wargameKeys[i]];
        }
      }
    }
    delete analysis.wargameResult;

    freshDb.latestDecision = {
      ...analysis,
      timestamp: new Date().toISOString(),
      symbol: settings.selectedAsset,
      timeframe: settings.selectedTimeframe,
      candleTime: latestCandleTime,
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
    writeDB(freshDb);
    
    addLog('brain', `Gemini Decision: ${analysis.decision} | Confidence: ${(analysis.confidence * 100).toFixed(0)}% | Amount Allocation: ${analysis.amount_pct}%`);
    addLog('brain', `Gemini Rationale: "${analysis.reasoning}"`);

    // --- AUTONOMOUS PLANNING & CONDITIONAL ORDER SCHEDULING ---
    const proposed = analysis.proposed_conditional_orders || [];
    const newlyScheduled = [];
    const dbForOrders = readDB();
    if (!dbForOrders.conditionalOrders) {
      dbForOrders.conditionalOrders = [];
    }

    const symbol = settings.selectedAsset;

    // 1. Separate existing orders into:
    //    - existingAutos: autonomous orders for the current symbol (to be synced/diffed)
    //    - otherOrders: manual orders or orders for other symbols (to be preserved untouched)
    const existingAutos = [];
    const otherOrders = [];
    
    for (const o of dbForOrders.conditionalOrders) {
      if (o.symbol === symbol && o.id.startsWith('auto-')) {
        existingAutos.push(o);
      } else {
        otherOrders.push(o);
      }
    }

    const keptAutos = [];
    const obsoleteAutos = [...existingAutos]; // starts with all, we will remove matched ones

    // 2. Diff and sync proposed orders against existingAutos
    for (const order of proposed) {
      const action = order.action.toUpperCase();
      const amountPct = Math.max(1, Math.min(100, Number(order.amount_pct) || 10));
      const triggerType = order.trigger_type;
      const triggerValue = Number(order.trigger_value) || 0;
      const reasoning = order.reasoning || "Autonomous forward plan.";

      if (!triggerValue || (triggerType !== 'price_below' && triggerType !== 'price_above')) {
        continue;
      }

      // Check if there is an existing autonomous order that matches this proposal (within 3.0% tolerance)
      const matchIdx = obsoleteAutos.findIndex(o => 
        o.action === action &&
        o.triggerType === triggerType &&
        Math.abs(o.triggerValue - triggerValue) / triggerValue < 0.03
      );

      if (matchIdx !== -1) {
        // Similar order already exists: keep it (preserves ID and prevents duplicate notification alerts)
        const matchedOrder = obsoleteAutos.splice(matchIdx, 1)[0];
        keptAutos.push(matchedOrder);
      } else {
        // No similar order exists: create a new one
        const crypto = require('crypto');
        const orderId = 'auto-' + crypto.randomBytes(4).toString('hex');
        const newOrder = {
          id: orderId,
          symbol,
          action,
          amountPct,
          triggerType,
          triggerValue,
          executionType: 'virtual',
          reasoning
        };
        keptAutos.push(newOrder);
        newlyScheduled.push(newOrder);
      }
    }

    // 3. Reconstruct conditionalOrders array
    //    We combine preserved otherOrders + keptAutos (which includes kept existing ones and newly created ones)
    //    Obsolete orders (remaining in obsoleteAutos) are deleted.
    dbForOrders.conditionalOrders = [...otherOrders, ...keptAutos];

    if (newlyScheduled.length > 0 || obsoleteAutos.length > 0) {
      writeDB(dbForOrders);
      if (newlyScheduled.length > 0) {
        addLog('info', `[AUTONOMOUS PLAN] Scheduled ${newlyScheduled.length} new conditional orders.`);
      }
      if (obsoleteAutos.length > 0) {
        addLog('info', `[AUTONOMOUS PLAN] Cleared ${obsoleteAutos.length} obsolete conditional orders: ${obsoleteAutos.map(o => `${o.action} @ $${o.triggerValue}`).join(', ')}`);
      }
    }

    // Send real-time phone alerts
    if (settings.notificationType !== 'none' && analysis.decision !== 'HOLD') {
      const msg = `🚀 <b>AETHER BOT SIGNAL: ${analysis.decision} ${settings.selectedAsset}</b> at <b>$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> (Confidence: ${(analysis.confidence * 100).toFixed(0)}%, Size: ${analysis.amount_pct}%).\n` +
                  `📈 <b>Structure:</b> ${escapeHTML(analysis.market_structure)}.\n` +
                  `🛡️ <b>Key Zones:</b> Support $${analysis.support_level.toLocaleString()} | Resistance $${analysis.resistance_level.toLocaleString()} | Risk/Reward: ${analysis.risk_reward_ratio}.\n` +
                  `🧠 <b>Rationale:</b> <i>"${convertMarkdownToTelegramHTML(getFirstSentences(analysis.reasoning, 1))}"</i>`;
      await sendTelegramAndDiscordAlert(msg, settings);
    }

    // Send autonomous plan alert if new moves are scheduled autonomously
    if (newlyScheduled.length > 0) {
      let planMsg = `🧠 <b>AETHER AUTONOMOUS PLAN: ${settings.selectedAsset}</b>\n` +
                    `Current Price: <b>$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>\n\n` +
                    `<i>"${convertMarkdownToTelegramHTML(analysis.forward_plan || analysis.reasoning)}"</i>\n\n` +
                    `📋 <b>Scheduled Multi-Move Actions:</b>\n`;
      
      newlyScheduled.forEach((o, idx) => {
        planMsg += `<b>Move ${idx + 1}: ${o.action} ${o.amountPct}%</b> when price is <b>${o.triggerType === 'price_below' ? 'below' : 'above'} $${o.triggerValue.toLocaleString()}</b>\n` +
                   `  <i>Rationale: ${convertMarkdownToTelegramHTML(o.reasoning)}</i>\n`;
      });
      await sendTelegramAndDiscordAlert(planMsg, settings);
      addLog('info', `Autonomous plan announcement successfully dispatched to notification channels.`);
    }

    // Proactive Silence Breaker strategist desk check-in (12 hours)
    const isSilenceBreakerDue = !forceNextCycle && (db.lastTelegramMessageTime && (Date.now() - db.lastTelegramMessageTime > 12 * 60 * 60 * 1000));
    
    if (analysis.decision === 'HOLD' && newlyScheduled.length === 0 && isSilenceBreakerDue) {
      let checkInMsg = `☕ <b>Aether Daily Strategist Check-In: ${settings.selectedAsset}</b>\n\n` +
                       `Hey Boss, it's been quiet on the wire for the last 12 hours, so I wanted to tap your shoulder with a quick update from the trading desk.\n\n` +
                       `• Market Price: <b>$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>\n` +
                       `• Wave Count / Structure: <b>${escapeHTML(analysis.market_structure)}</b>\n` +
                       `• Market Regime: <b>${marketRegime}</b> (ADX: ${currentADX ? currentADX.toFixed(2) : 'N/A'})\n` +
                       `• Net Portfolio Value: <b>$${(db.portfolio.balanceUSD + (db.portfolio.positions[assetName]?.amount || 0) * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD</b>\n\n` +
                       `💬 <b>My Outlook:</b>\n<i>"${convertMarkdownToTelegramHTML(analysis.forward_plan || analysis.reasoning)}"</i>\n\n` +
                       `I am actively scanning the charts every ${settings.botIntervalMin} minutes. Let me know if you want to adjust our rules, scale any positions, or change timeframes!`;
      
      await sendTelegramAndDiscordAlert(checkInMsg, settings);
      addLog('info', `Silence-breaker daily strategist check-in dispatched.`);
      logCheckInToObsidian(analysis, marketRegime, currentPrice, assetName, db);
    }

    // --- POSITION ACTIVE STATES TRACKING ---
    const activeAsset = settings.selectedAsset.split('/')[0];
    const isFuturesDesk = (settings.activeDesk === 'futures') || ['SHORT', 'COVER'].includes(analysis.decision);
    const stateTimestamp = analysis.stateTimestamp;

    if (stateTimestamp) {
      const freshDbForStates = readDB();
      let posModified = false;
      if (isFuturesDesk) {
        if (freshDbForStates.portfolio.futures?.positions?.[activeAsset]) {
          const futuresPos = freshDbForStates.portfolio.futures.positions[activeAsset];
          if (!futuresPos.activeStates) futuresPos.activeStates = [];
          if (!futuresPos.activeStates.includes(stateTimestamp)) {
            futuresPos.activeStates.push(stateTimestamp);
            posModified = true;
          }
        }
      } else {
        if (freshDbForStates.portfolio.positions?.[activeAsset]) {
          const spotPos = freshDbForStates.portfolio.positions[activeAsset];
          if (!spotPos.activeStates) spotPos.activeStates = [];
          if (!spotPos.activeStates.includes(stateTimestamp)) {
            spotPos.activeStates.push(stateTimestamp);
            posModified = true;
          }
        }
      }
      if (posModified) {
        writeDB(freshDbForStates);
      }
    }

    if (analysis.decision === 'HOLD') {
      addLog('info', "Bot decision is HOLD. No orders placed.");
      return;
    }

    const isFutures = (settings.activeDesk === 'futures') || ['SHORT', 'COVER'].includes(analysis.decision);
    const leverageVal = settings.defaultLeverage || 5;

    if (isFutures) {
      if (settings.tradingMode === 'paper') {
        const finalDb = readDB();
        const activeStates = finalDb.portfolio.futures?.positions?.[assetName]?.activeStates || (stateTimestamp ? [stateTimestamp] : null);
        const result = executePaperPerpTrade(analysis.decision, analysis.amount_pct, leverageVal, currentPrice, assetName, finalDb, analysis.reasoning, activeStates);
        if (result.success) {
          addLog('trade', `Paper Futures Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} contracts of ${assetName} at $${currentPrice} with ${leverageVal}x leverage.`);
        } else {
          addLog('info', `Paper Futures Trade failed: ${result.message}`);
          appendOverrideToState(settings.obsidianVaultPath, `Paper Futures Trade Blocked: ${result.message}`);
        }
      } else {
        try {
          const finalDb = readDB();
          const activeStates = finalDb.portfolio.futures?.positions?.[assetName]?.activeStates || (stateTimestamp ? [stateTimestamp] : null);
          const result = await executeLivePerpTrade(exchange, analysis.decision, analysis.amount_pct, leverageVal, currentPrice, assetName, finalDb, settings.selectedAsset, analysis.reasoning, activeStates);
          if (result.success) {
            addLog('trade', `Live Futures Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} contracts of ${assetName} at $${result.trade.price} with ${leverageVal}x leverage.`);
          } else {
            addLog('warning', `Live Futures Trade Blocked/Failed: ${result.message}`);
            appendOverrideToState(settings.obsidianVaultPath, `Live Futures Trade Blocked: ${result.message}`);
          }
        } catch (liveErr) {
          addLog('error', `Live Bot Futures Order Trigger Failed: ${liveErr.message}`);
          appendOverrideToState(settings.obsidianVaultPath, `Live Futures Order Exception: ${liveErr.message}`);
        }
      }
    } else {
      if (settings.tradingMode === 'paper') {
        // Execute simulated trade
        const finalDb = readDB();
        const activeStates = finalDb.portfolio.positions?.[assetName]?.activeStates || (stateTimestamp ? [stateTimestamp] : null);
        const result = executePaperTrade(analysis.decision, analysis.amount_pct, currentPrice, assetName, finalDb, analysis.reasoning, activeStates);
        if (result.success) {
          addLog('trade', `Paper Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
        } else {
          addLog('info', `Paper Trade failed: ${result.message}`);
          appendOverrideToState(settings.obsidianVaultPath, `Paper Trade Blocked: ${result.message}`);
        }
      } else {
        // Real Live Trading Mode
        try {
          const finalDb = readDB();
          const activeStates = finalDb.portfolio.positions?.[assetName]?.activeStates || (stateTimestamp ? [stateTimestamp] : null);
          const result = await executeLiveTrade(exchange, analysis.decision, analysis.amount_pct, currentPrice, assetName, finalDb, settings.selectedAsset, analysis.reasoning, activeStates);
          if (result.success) {
            addLog('trade', `Live Trade executed: ${analysis.decision} ${result.trade.amount.toFixed(6)} ${assetName} at $${result.trade.price}`);
          } else {
            addLog('warning', `Live Trade Blocked/Failed: ${result.message}`);
            appendOverrideToState(settings.obsidianVaultPath, `Live Trade Blocked: ${result.message}`);
          }
        } catch (liveErr) {
          addLog('error', `Live Bot Order Trigger Failed: ${liveErr.message}`);
          appendOverrideToState(settings.obsidianVaultPath, `Live Order Exception: ${liveErr.message}`);
        }
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

// Helper to calculate active stop and target levels for open positions
function getActiveTradeStops(pos, settings, latestDecision, highestPrice) {
  if (!pos || pos.amount <= 0 || pos.avgEntryPrice <= 0) {
    return null;
  }

  const stops = {
    entryPrice: pos.avgEntryPrice,
    stopLossPrice: null,
    atrStopPrice: null,
    trailingStopPrice: null,
    takeProfitPrice: null,
    highestPrice: highestPrice || pos.avgEntryPrice
  };

  if (settings.stopLossPct > 0) {
    stops.stopLossPrice = pos.avgEntryPrice * (1 - settings.stopLossPct / 100);
  }

  if (settings.atrStopEnabled && latestDecision && latestDecision.indicators && typeof latestDecision.indicators.atr === 'number') {
    const atrMultiplier = settings.atrStopMultiplier || 2.0;
    stops.atrStopPrice = pos.avgEntryPrice - (atrMultiplier * latestDecision.indicators.atr);
  }

  if (settings.trailingStopEnabled) {
    const peak = highestPrice || pos.avgEntryPrice;
    stops.trailingStopPrice = peak * (1 - (settings.trailingStopPct || 2.5) / 100);
  }

  if (settings.takeProfitEnabled) {
    stops.takeProfitPrice = pos.avgEntryPrice * (1 + (settings.takeProfitPct || 10.0) / 100);
  }

  return stops;
}

// Get bot status and portfolio summary
app.get('/api/status', async (req, res) => {
  let db = readDB();
  
  // If in live trading mode and keys exist, periodically sync actual balance and fetch open orders
  let openOrders = [];
  if (db.settings.tradingMode === 'live' && db.settings.exchangeApiKey && db.settings.exchangeApiSecret) {
    const now = Date.now();
    const exchange = getExchangeInstance(db.settings);
    
    // Sync balance: Throttle every 30s (non-blocking background promise)
    if (now - lastBalanceSyncTime > 30000) {
      lastBalanceSyncTime = now;
      syncLiveBalance(db, exchange).then(async (updatedDb) => {
        if (updatedDb.settings.activeDesk === 'futures') {
          try {
            const quoteCurrency = updatedDb.settings.selectedAsset.split('/')[1]?.split(':')[0] || 'USDC';
            const assetName = updatedDb.settings.selectedAsset.split('/')[0];
            await syncLiveFuturesState(updatedDb, exchange, updatedDb.settings.selectedAsset, assetName, quoteCurrency);
          } catch (futSyncErr) {
            console.error("Failed to sync live futures state for status:", futSyncErr.message);
          }
        }
      }).catch(err => {
        console.error("Background balance sync failed:", err.message);
      });
    }
    
    // Fetch open orders: Throttle every 15s (non-blocking background promise)
    if (now - lastOrdersSyncTime > 15000) {
      lastOrdersSyncTime = now;
      const symbol = db.settings.selectedAsset;
      exchange.fetchOpenOrders(symbol).then(orders => {
        cachedOpenOrders = orders;
      }).catch(err => {
        console.error("Failed to fetch Coinbase open orders for status:", err.message);
      });
    }
    openOrders = cachedOpenOrders;
  }

  const finalDb = readDB();
  const assetName = finalDb.settings.selectedAsset.split('/')[0];
  const pos = finalDb.portfolio.positions ? finalDb.portfolio.positions[assetName] : null;
  const peakPrice = finalDb.highestPriceReached ? finalDb.highestPriceReached[assetName] : null;
  const activeTradeStops = getActiveTradeStops(pos, finalDb.settings, finalDb.latestDecision, peakPrice);

  res.json({
    isBotRunning,
    portfolio: finalDb.portfolio,
    highestPriceReached: finalDb.highestPriceReached || {},
    latestDecision: finalDb.latestDecision || null,
    activeTradeStops,
    conditionalOrders: finalDb.conditionalOrders || [],
    openOrders: openOrders,
    settings: {
      ...finalDb.settings,
      geminiApiKey: finalDb.settings.geminiApiKey ? '••••••••' : '',
      openaiApiKey: finalDb.settings.openaiApiKey ? '••••••••' : '',
      claudeApiKey: finalDb.settings.claudeApiKey ? '••••••••' : '',
      exchangeApiKey: finalDb.settings.exchangeApiKey ? '••••••••' : '',
      exchangeApiSecret: finalDb.settings.exchangeApiSecret ? '••••••••' : '',
      telegramBotToken: finalDb.settings.telegramBotToken ? '••••••••' : '',
      smtpPass: finalDb.settings.smtpPass ? '••••••••' : '',
      discordWebhookUrl: finalDb.settings.discordWebhookUrl ? '••••••••' : '',
      discordDebateWebhookUrl: finalDb.settings.discordDebateWebhookUrl ? '••••••••' : ''
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
  if (updatedSettings.openaiApiKey === '••••••••') updatedSettings.openaiApiKey = oldSettings.openaiApiKey;
  if (updatedSettings.claudeApiKey === '••••••••') updatedSettings.claudeApiKey = oldSettings.claudeApiKey;
  if (updatedSettings.exchangeApiKey === '••••••••') updatedSettings.exchangeApiKey = oldSettings.exchangeApiKey;
  if (updatedSettings.exchangeApiSecret === '••••••••') updatedSettings.exchangeApiSecret = oldSettings.exchangeApiSecret;
  if (updatedSettings.telegramBotToken === '••••••••') updatedSettings.telegramBotToken = oldSettings.telegramBotToken;
  if (updatedSettings.smtpPass === '••••••••') updatedSettings.smtpPass = oldSettings.smtpPass;
  if (updatedSettings.discordWebhookUrl === '••••••••') updatedSettings.discordWebhookUrl = oldSettings.discordWebhookUrl;
  if (updatedSettings.discordDebateWebhookUrl === '••••••••') updatedSettings.discordDebateWebhookUrl = oldSettings.discordDebateWebhookUrl;

  db.settings = { ...db.settings, ...updatedSettings };
  writeDB(db);

  addLog('info', "Bot settings updated by user.");

  // Restart loop if interval or asset or enabled status changed
  if (db.settings.botEnabled) {
    forceNextCycle = true;
    startBotLoop(db.settings.botIntervalMin);
  } else {
    stopBotLoop();
  }

  // Refresh Telegram Command listener status
  startTelegramCommandListener();

  res.json({ success: true, settings: db.settings });
});

app.post('/api/settings/verify-obsidian-path', (req, res) => {
  const { path: vaultPath } = req.body;
  if (!vaultPath) {
    return res.json({ success: false, message: "Path is empty." });
  }
  try {
    if (fs.existsSync(vaultPath)) {
      const stats = fs.statSync(vaultPath);
      if (stats.isDirectory()) {
        return res.json({ success: true, message: "Valid directory path found!" });
      } else {
        return res.json({ success: false, message: "Path exists but is not a directory." });
      }
    } else {
      return res.json({ success: false, message: "Path does not exist on this machine." });
    }
  } catch (err) {
    return res.json({ success: false, message: `Error verifying path: ${err.message}` });
  }
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
    positions: {},
    futures: {
      marginBalanceUSD: 100.0,
      unrealizedPnL: 0.0,
      positions: {}
    }
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

// ----------------------------------------------------
// CONDITIONAL ORDERS & CUSTOM RULES API
// ----------------------------------------------------

// Add a conditional order (supports virtual and direct exchange orders)
app.post('/api/conditional-orders/add', async (req, res) => {
  const { symbol, action, amountPct, triggerType, triggerValue, executionType, reasoning } = req.body;
  const assetName = symbol.split('/')[0];
  
  try {
    const db = readDB();
    const settings = db.settings;
    const orderId = `order_${Date.now()}`;
    let exchangeOrderId = null;
    let amountTokens = 0;
    
    // Fetch ticker price to calculate rounded token quantity
    const exchange = getExchangeInstance(settings);
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last || ticker.close;
    
    if (executionType === 'exchange' && settings.tradingMode === 'live') {
      // Direct Coinbase order requires calculating order size
      const balance = await exchange.fetchBalance();
      let allocation = 0;
      
      if (action === 'BUY') {
        const quoteCurrency = symbol.split('/')[1] || 'USD';
        const availableCash = balance.free[quoteCurrency] || 0;
        allocation = availableCash * (amountPct / 100);
      } else {
        const holdings = balance.total[assetName] || balance.free[assetName] || 0;
        allocation = holdings * currentPrice * (amountPct / 100);
      }
      
      amountTokens = allocation / triggerValue; // triggerValue is the limit price for direct orders
      const amountTokensRounded = Number(exchange.amountToPrecision(symbol, amountTokens));
      
      if (amountTokensRounded <= 0) {
        return res.status(400).json({ success: false, error: "Calculated order size is too small for exchange rules." });
      }
      
      addLog('info', `Placing direct limit ${action} order on Coinbase for ${amountTokensRounded} ${assetName} at $${triggerValue}...`);
      
      let cbOrder;
      if (action === 'BUY') {
        cbOrder = await exchange.createLimitBuyOrder(symbol, amountTokensRounded, triggerValue);
      } else {
        cbOrder = await exchange.createLimitSellOrder(symbol, amountTokensRounded, triggerValue);
      }
      exchangeOrderId = cbOrder.id;
      amountTokens = cbOrder.amount || amountTokensRounded;
    }
    
    // Write atomically
    const freshDb = readDB();
    if (!freshDb.conditionalOrders) freshDb.conditionalOrders = [];
    
    const newOrder = {
      id: orderId,
      exchangeOrderId,
      symbol,
      action,
      executionType,
      triggerType,
      triggerValue,
      amountPct,
      amountTokens: amountTokens || 0,
      reasoning: reasoning || 'Scheduled order.',
      timestamp: new Date().toISOString()
    };
    
    freshDb.conditionalOrders.push(newOrder);
    writeDB(freshDb);
    
    addLog('info', `Scheduled ${executionType} ${action} order for ${amountPct}% of ${symbol} successfully.`);
    res.json({ success: true, message: `Successfully scheduled order ${orderId}`, order: newOrder });
  } catch (err) {
    addLog('error', `Failed to schedule conditional order: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch scheduled orders
app.get('/api/conditional-orders/list', (req, res) => {
  const db = readDB();
  res.json(db.conditionalOrders || []);
});

// Cancel a scheduled order
app.post('/api/conditional-orders/cancel', async (req, res) => {
  const { orderId } = req.body;
  
  try {
    const db = readDB();
    const orderIndex = db.conditionalOrders?.findIndex(o => o.id === orderId);
    
    if (orderIndex === undefined || orderIndex === -1) {
      return res.status(404).json({ success: false, error: "Order not found." });
    }
    
    const order = db.conditionalOrders[orderIndex];
    if (order.executionType === 'exchange' && order.exchangeOrderId && db.settings.tradingMode === 'live') {
      try {
        const exchange = getExchangeInstance(db.settings);
        addLog('info', `Canceling direct limit order on Coinbase with ID: ${order.exchangeOrderId}...`);
        await exchange.cancelOrder(order.exchangeOrderId, order.symbol);
      } catch (err) {
        addLog('warning', `Failed to cancel order directly on Coinbase exchange: ${err.message}`);
      }
    }
    
    // Write atomically
    const freshDb = readDB();
    freshDb.conditionalOrders = freshDb.conditionalOrders.filter(o => o.id !== orderId);
    writeDB(freshDb);
    
    addLog('info', `Canceled scheduled order ${orderId} successfully.`);
    res.json({ success: true, message: `Successfully canceled order ${orderId}` });
  } catch (err) {
    addLog('error', `Failed to cancel order: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add a custom strategy rule
app.post('/api/custom-rules/add', (req, res) => {
  const { rule } = req.body;
  if (!rule || typeof rule !== 'string') {
    return res.status(400).json({ success: false, error: "Invalid rule format." });
  }
  
  const freshDb = readDB();
  if (!freshDb.customTradingRules) freshDb.customTradingRules = [];
  
  freshDb.customTradingRules.push(rule);
  writeDB(freshDb);
  
  addLog('info', `Learned new persistent strategy rule: "${rule}"`);
  
  if (isBotRunning) {
    forceNextCycle = true;
    runBotCycle();
  }
  
  res.json({ success: true, message: "Rule added successfully.", rules: freshDb.customTradingRules });
});

// Fetch custom rules
app.get('/api/custom-rules/list', (req, res) => {
  const db = readDB();
  res.json(db.customTradingRules || []);
});

// Delete a custom rule
app.post('/api/custom-rules/delete', (req, res) => {
  const { index } = req.body; // index is 0-indexed
  
  const freshDb = readDB();
  if (!freshDb.customTradingRules || index === undefined || index < 0 || index >= freshDb.customTradingRules.length) {
    return res.status(400).json({ success: false, error: "Invalid rule index." });
  }
  
  const removedRule = freshDb.customTradingRules.splice(index, 1);
  writeDB(freshDb);
  
  addLog('info', `Removed strategy rule: "${removedRule}"`);
  
  if (isBotRunning) {
    forceNextCycle = true;
    runBotCycle();
  }
  
  res.json({ success: true, message: "Rule deleted successfully.", rules: freshDb.customTradingRules });
});

// Force run the bot cycle immediately
app.post('/api/bot/force-run', (req, res) => {
  if (!isBotRunning) {
    return res.status(400).json({ success: false, error: "Bot loop is not running. Please start the bot first." });
  }
  forceNextCycle = true;
  runBotCycle();
  res.json({ success: true, message: "Immediate bot execution cycle triggered successfully." });
});

// Manual buy/sell override
app.post('/api/trade/manual', async (req, res) => {
  const { action, amountPct, symbol, tradeType, leverage } = req.body;
  const db = readDB();
  const settings = db.settings;
  const assetName = symbol.split('/')[0];
  const isFutures = tradeType === 'futures' || ['SHORT', 'COVER'].includes(action);
  const leverageVal = leverage || 5;

  try {
    const exchange = getExchangeInstance(settings);
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last || ticker.close;

    if (isFutures) {
      if (settings.tradingMode === 'live') {
        const finalDb = readDB();
        const result = await executeLivePerpTrade(exchange, action, amountPct, leverageVal, currentPrice, assetName, finalDb, symbol, `REST API manual override perpetual ${action} command.`);
        addLog('trade', `[MANUAL LIVE FUTURES ORDER] Executed perpetual ${action} ${result.trade.amount.toFixed(6)} contracts of ${assetName} at $${result.trade.price} with ${leverageVal}x leverage.`);
        res.json({ success: true, trade: result.trade });
      } else {
        const finalDb = readDB();
        const result = executePaperPerpTrade(action, amountPct, leverageVal, currentPrice, assetName, finalDb, `REST API manual override perpetual ${action} command.`);
        if (result.success) {
          addLog('trade', `[MANUAL FUTURES ORDER] Executed perpetual ${action} ${result.trade.amount.toFixed(6)} contracts of ${assetName} at $${currentPrice} with ${leverageVal}x leverage.`);
          res.json({ success: true, trade: result.trade });
        } else {
          res.status(400).json({ success: false, message: result.message });
        }
      }
    } else {
      if (settings.tradingMode === 'live') {
        const finalDb = readDB();
        const result = await executeLiveTrade(exchange, action, amountPct, currentPrice, assetName, finalDb, symbol, `REST API manual override ${action} command.`);
        addLog('trade', `[MANUAL LIVE ORDER] Executed ${action} ${result.trade.amount.toFixed(6)} ${assetName} at $${result.trade.price}`);
        res.json({ success: true, trade: result.trade });
      } else {
        const finalDb = readDB();
        const result = executePaperTrade(action, amountPct, currentPrice, assetName, finalDb, `REST API manual override ${action} command.`);
        if (result.success) {
          addLog('trade', `[MANUAL ORDER] Executed ${action} ${result.trade.amount.toFixed(6)} ${assetName} at $${currentPrice}`);
          res.json({ success: true, trade: result.trade });
        } else {
          res.status(400).json({ success: false, message: result.message });
        }
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
    if (incoming.discordWebhookUrl === '••••••••') incoming.discordWebhookUrl = oldSettings.discordWebhookUrl;
    if (incoming.discordDebateWebhookUrl === '••••••••') incoming.discordDebateWebhookUrl = oldSettings.discordDebateWebhookUrl;
    settings = { ...oldSettings, ...incoming };
  }

  const type = settings.notificationType;
  const msg = `⚡ <b>AETHER EW ALERT TEST</b>\n\nConnection check: SUCCESSFUL!\nTimestamp: <b>${new Date().toLocaleTimeString()}</b>`;
  const cleanMsg = msg.replace(/<[^>]*>/g, '');

  try {
    const results = [];

    if (type === 'telegram') {
      await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg);
      results.push('Telegram');
    } else if (type === 'sms') {
      const smtpConfig = {
        host: settings.smtpHost,
        port: settings.smtpPort,
        user: settings.smtpUser,
        pass: settings.smtpPass
      };
      await sendSMSAlert(smtpConfig, settings.phoneNumber, settings.phoneCarrier, cleanMsg);
      results.push('SMS');
    }

    // Also test Discord webhook if configured
    if (settings.discordWebhookUrl) {
      await sendDiscordWebhook(settings.discordWebhookUrl, msg);
      results.push('Discord Main Alert');
    }

    // Also test Discord Debate webhook if configured
    if (settings.discordDebateWebhookUrl) {
      await sendDiscordWebhook(settings.discordDebateWebhookUrl, `🧠 <b>AETHER DEBATE CHANNEL TEST</b>\n\nDebate channel integration: SUCCESSFUL!\nTimestamp: <b>${new Date().toLocaleTimeString()}</b>`);
      results.push('Discord Debate Feed');
    }

    if (results.length === 0) {
      res.status(400).json({ success: false, message: "Notifications are disabled. Change 'Notification Type' in Settings or add a Discord Webhook URL first." });
    } else {
      res.json({ success: true, message: `Test notification sent via: ${results.join(', ')}!` });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function getFirstSentences(text, count = 2) {
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  return sentences.slice(0, count).map(s => s.trim()).join(" ");
}

function classifyRegime(price, indicators) {
  const latestADXArr = indicators.adx.adx;
  const latestPlusDIArr = indicators.adx.plusDI;
  const latestMinusDIArr = indicators.adx.minusDI;
  const latestRVolArr = indicators.rvol;
  const sma21Arr = indicators.sma21;

  const currentADX = latestADXArr[latestADXArr.length - 1];
  const currentPlusDI = latestPlusDIArr[latestPlusDIArr.length - 1];
  const currentMinusDI = latestMinusDIArr[latestMinusDIArr.length - 1];
  const currentRVol = latestRVolArr[latestRVolArr.length - 1];
  const currentSma21 = sma21Arr[sma21Arr.length - 1];
  
  const prevADX = latestADXArr[latestADXArr.length - 2] || currentADX;
  const isADXRising = currentADX > prevADX;

  if (currentADX !== null && currentADX !== undefined) {
    if (currentADX > 25) {
      if (currentPlusDI > currentMinusDI && price > currentSma21) {
        return "TRENDING_BULLISH";
      } else if (currentMinusDI > currentPlusDI && price < currentSma21) {
        return "TRENDING_BEARISH";
      } else {
        return "STRONG_TREND_CONSOLIDATION";
      }
    } else if (currentADX < 20) {
      return "CHOPPY_RANGE";
    } else {
      if (isADXRising && currentRVol > 1.5) {
        return "HIGH_VOLATILITY_SQUEEZE";
      } else {
        return "TRANSITIONING_ZONE";
      }
    }
  }
  return "TRANSITIONING_ZONE";
}

// Fetch multi-timeframe indicators for the matrix widget
app.get('/api/market/multi-indicators', async (req, res) => {
  try {
    const db = readDB();
    const symbol = db.settings.selectedAsset;
    
    // Check cache (45 seconds limit)
    const now = Date.now();
    if (multiTimeframeCache && (now - lastMultiTimeframeSync < 45000)) {
      return res.json(multiTimeframeCache);
    }

    const exchange = getExchangeInstance(db.settings);
    const timeframes = ['15m', '1h', '4h', '1d'];
    const results = {};

    for (const tf of timeframes) {
      const data = await getMarketContext(exchange, symbol, tf, 100);
      const closePrices = data.recentCandles.map(c => c.close);
      const lastPrice = closePrices[closePrices.length - 1];
      
      const rsiVal = data.indicators.rsi[data.indicators.rsi.length - 1];
      const adxVal = data.indicators.adx.adx[data.indicators.adx.adx.length - 1];
      const sma9Val = data.indicators.sma9[data.indicators.sma9.length - 1];
      const sma21Val = data.indicators.sma21[data.indicators.sma21.length - 1];
      const macdVal = data.indicators.macd.histogram[data.indicators.macd.histogram.length - 1];
      const rvolVal = data.indicators.rvol[data.indicators.rvol.length - 1];
      
      const regime = classifyRegime(lastPrice, data.indicators);
      
      results[tf] = {
        price: lastPrice,
        rsi: rsiVal,
        adx: adxVal,
        sma9: sma9Val,
        sma21: sma21Val,
        macd: macdVal,
        rvol: rvolVal,
        regime: regime
      };
    }

    multiTimeframeCache = results;
    lastMultiTimeframeSync = now;
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: `Failed to load multi-timeframe indicators: ${err.message}` });
  }
});

// Helper to fetch any number of candles by paginating in parallel
async function fetchOHLCVWithLimit(exchange, symbol, timeframe, limit, beforeMs) {
  const maxSingleLimit = 300; // Coinbase API limit per request
  const tfMs = getTimeframeMs(timeframe);
  const endMs = beforeMs || Date.now();
  
  // Calculate total number of candles needed from the source timeframe
  const totalNeeded = limit;
  const numBatches = Math.ceil(totalNeeded / maxSingleLimit);
  
  const promises = [];
  for (let i = 0; i < numBatches; i++) {
    // Each batch ends i * maxSingleLimit candles before endMs
    const batchEndMs = endMs - (i * maxSingleLimit * tfMs);
    const sinceMs = batchEndMs - (maxSingleLimit * tfMs);
    
    promises.push(
      exchange.fetchOHLCV(symbol, timeframe, sinceMs, maxSingleLimit)
        .catch(e => {
          console.warn(`[API] Failed to fetch batch ${i} for ${symbol} (${timeframe}):`, e.message);
          return [];
        })
    );
  }
  
  const results = await Promise.all(promises);
  const allCandles = [];
  const seen = new Set();
  
  results.flat().forEach(c => {
    if (c && c[0] && !seen.has(c[0])) {
      seen.add(c[0]);
      allCandles.push(c);
    }
  });
  
  allCandles.sort((a, b) => a[0] - b[0]);
  return allCandles.slice(-totalNeeded);
}

// Fetch candles (for the UI chart)
app.get('/api/market/candles', async (req, res) => {
  const { symbol, timeframe, limit, before } = req.query;
  const db = readDB();
  try {
    const exchange = getExchangeInstance(db.settings);
    const limitNum = Number(limit) || 100;
    const beforeMs = before ? Number(before) * 1000 : undefined;
    
    let candlesRaw;
    if (timeframe === '4h') {
      // For 4h, we need limitNum * 4 1h candles
      const raw1h = await fetchOHLCVWithLimit(exchange, symbol || 'BTC/USD', '1h', limitNum * 4 + 4, beforeMs);
      candlesRaw = aggregateCandles(raw1h, 4);
      if (candlesRaw.length > limitNum) {
        candlesRaw = candlesRaw.slice(-limitNum);
      }
    } else {
      candlesRaw = await fetchOHLCVWithLimit(exchange, symbol || 'BTC/USD', timeframe || '1h', limitNum, beforeMs);
    }

    // If `before` was specified, exclude candles at or after that timestamp
    if (before) {
      const beforeMsValue = Number(before) * 1000;
      candlesRaw = candlesRaw.filter(c => c[0] < beforeMsValue);
    }

    const candles = candlesRaw.map(c => ({
      time: c[0] / 1000,
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

// Helper: convert timeframe string to milliseconds
function getTimeframeMs(tf) {
  const map = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000, '1d': 86400000, '1w': 604800000 };
  return map[tf] || 3600000;
}

// ----------------------------------------------------
// CUSTOM TOOLS & PLUGINS APIs
// ----------------------------------------------------

// Get all custom tools
app.get('/api/tools', (req, res) => {
  try {
    const files = fs.readdirSync(TOOLS_PATH).filter(f => f.endsWith('.js'));
    const db = readDB();
    const tools = files.map(f => {
      const filePath = path.join(TOOLS_PATH, f);
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const sandbox = { module: { exports: {} }, exports: {} };
        const context = vm.createContext(sandbox);
        const script = new vm.Script(fileContent);
        script.runInContext(context, { timeout: 1000 });
        const tool = sandbox.module.exports;
        return {
          filename: f,
          name: tool.name || f,
          description: tool.description || "No description.",
          parameters: tool.parameters || { type: "object", properties: {} },
          enabled: (db.settings.enabledTools || []).includes(f)
        };
      } catch (err) {
        return {
          filename: f,
          name: f,
          description: `Error loading tool script: ${err.message}`,
          parameters: { type: "object", properties: {} },
          enabled: false,
          error: true
        };
      }
    });
    res.json(tools);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a new custom tool (.js)
app.post('/api/tools/upload', (req, res) => {
  let { filename, code } = req.body;
  if (!filename || !code) {
    return res.status(400).json({ success: false, error: "Filename and code contents are required." });
  }
  
  if (!filename.endsWith('.js')) {
    filename += '.js';
  }
  filename = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Validate JavaScript syntax, properties, and execution structure
  try {
    const sandbox = { module: { exports: {} }, exports: {} };
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code);
    script.runInContext(context, { timeout: 1000 });
    const tool = sandbox.module.exports;
    
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error("Tool must export a string 'name'");
    }
    if (!tool.description || typeof tool.description !== 'string') {
      throw new Error("Tool must export a string 'description'");
    }
    if (typeof tool.execute !== 'function') {
      throw new Error("Tool must export an 'execute' function");
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: `Invalid tool script: ${err.message}` });
  }

  try {
    fs.writeFileSync(path.join(TOOLS_PATH, filename), code, 'utf8');
    
    // Auto-enable the newly uploaded tool
    const db = readDB();
    if (!db.settings.enabledTools) db.settings.enabledTools = [];
    if (!db.settings.enabledTools.includes(filename)) {
      db.settings.enabledTools.push(filename);
      writeDB(db);
    }
    
    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle a custom tool's enabled state
app.post('/api/tools/:filename/toggle', (req, res) => {
  const filename = path.basename(req.params.filename);
  const db = readDB();
  if (!db.settings.enabledTools) db.settings.enabledTools = [];
  
  const idx = db.settings.enabledTools.indexOf(filename);
  if (idx > -1) {
    db.settings.enabledTools.splice(idx, 1);
  } else {
    db.settings.enabledTools.push(filename);
  }
  writeDB(db);
  res.json({ success: true, enabled: db.settings.enabledTools.includes(filename) });
});

// Delete a custom tool
app.delete('/api/tools/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(TOOLS_PATH, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const db = readDB();
    if (!db.settings.enabledTools) db.settings.enabledTools = [];
    db.settings.enabledTools = db.settings.enabledTools.filter(f => f !== filename);
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// STRATEGY GUIDELINES APIs (.md)
// ----------------------------------------------------

// Get all strategy guidelines
app.get('/api/strategies', (req, res) => {
  try {
    const files = fs.readdirSync(STRATEGIES_PATH).filter(f => f.endsWith('.md'));
    const db = readDB();
    const strategies = files.map(f => {
      const filePath = path.join(STRATEGIES_PATH, f);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      let description = "No description provided.";
      const descLine = lines.find(l => l.trim() && !l.trim().startsWith('#'));
      if (descLine) {
        description = descLine.trim().slice(0, 150);
        if (descLine.length > 150) description += '...';
      }
      return {
        filename: f,
        title: f.replace('.md', '').replace(/_/g, ' '),
        description,
        content,
        enabled: (db.settings.enabledStrategies || []).includes(f)
      };
    });
    res.json(strategies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a strategy guideline (.md)
app.post('/api/strategies/upload', (req, res) => {
  let { filename, content } = req.body;
  if (!filename || !content) {
    return res.status(400).json({ success: false, error: "Filename and markdown contents are required." });
  }

  if (!filename.endsWith('.md')) {
    filename += '.md';
  }
  filename = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');

  // Enforce size limit (10KB)
  if (Buffer.byteLength(content, 'utf8') > 10240) {
    return res.status(400).json({ success: false, error: "Strategy guideline file exceeds 10KB size limit." });
  }

  try {
    fs.writeFileSync(path.join(STRATEGIES_PATH, filename), content, 'utf8');
    
    // Auto-enable
    const db = readDB();
    if (!db.settings.enabledStrategies) db.settings.enabledStrategies = [];
    if (!db.settings.enabledStrategies.includes(filename)) {
      db.settings.enabledStrategies.push(filename);
      writeDB(db);
    }
    
    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle strategy guideline active state
app.post('/api/strategies/:filename/toggle', (req, res) => {
  const filename = path.basename(req.params.filename);
  const db = readDB();
  if (!db.settings.enabledStrategies) db.settings.enabledStrategies = [];
  
  const idx = db.settings.enabledStrategies.indexOf(filename);
  if (idx > -1) {
    db.settings.enabledStrategies.splice(idx, 1);
  } else {
    db.settings.enabledStrategies.push(filename);
  }
  writeDB(db);
  res.json({ success: true, enabled: db.settings.enabledStrategies.includes(filename) });
});

// Delete strategy guideline
app.delete('/api/strategies/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(STRATEGIES_PATH, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const db = readDB();
    if (!db.settings.enabledStrategies) db.settings.enabledStrategies = [];
    db.settings.enabledStrategies = db.settings.enabledStrategies.filter(f => f !== filename);
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// CONVERSATIONAL AI CHAT API
// ----------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid conversation thread." });
  }

  const db = readDB();
  const settings = db.settings;
  const provider = settings.activeLlmProvider || "gemini";
  
  let apiKey = "";
  if (provider === "gemini") {
    apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  } else if (provider === "openai") {
    apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  } else if (provider === "claude") {
    apiKey = settings.claudeApiKey || process.env.CLAUDE_API_KEY;
  }

  if (!apiKey) {
    return res.status(400).json({ error: `API Key for ${provider} is missing. Please configure it in Settings.` });
  }

  try {
    // Get live exchange data for portfolio status context (if any)
    const exchange = getExchangeInstance(settings);
    let marketData = {};
    try {
      marketData = await getMarketContext(exchange, settings.selectedAsset, settings.selectedTimeframe, 200);
      marketData.indicators.currentADX = marketData.indicators.adx.adx[marketData.indicators.adx.adx.length - 1];
      marketData.indicators.currentRVol = marketData.indicators.rvol[marketData.indicators.rvol.length - 1];
    } catch (e) {
      console.warn("Could not load market data for chat context:", e.message);
    }

    // Sliding window: only send the last 15 messages to the LLM to keep token usage low
    const contextMessages = messages.slice(-15);

    const result = await runAIChatCompletion({
      provider,
      model: settings.activeLlmModel,
      apiKey,
      messages: contextMessages,
      enabledTools: settings.enabledTools || [],
      enabledStrategies: settings.enabledStrategies || [],
      marketData,
      portfolio: db.portfolio,
      settings,
      trades: db.trades || []
    });

    if (result && !result.error) {
      const freshDb = readDB();
      const timestamp = Date.now();
      const userMsg = messages[messages.length - 1];
      const userMsgWithTime = { role: userMsg.role, content: userMsg.content, timestamp };
      const assistantMsgWithTime = { role: 'assistant', content: result.response, timestamp };
      
      if (!freshDb.chatMessages) {
        freshDb.chatMessages = [];
      }
      freshDb.chatMessages.push(userMsgWithTime);
      freshDb.chatMessages.push(assistantMsgWithTime);
      
      // Auto-prune messages older than 7 days
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      freshDb.chatMessages = freshDb.chatMessages.filter(msg => {
        if (!msg.timestamp) return true;
        return (Date.now() - msg.timestamp) < SEVEN_DAYS_MS;
      });
      
      writeDB(freshDb);
    }

    res.json(result);
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get chat messages history
app.get('/api/chat/history', (req, res) => {
  const db = readDB();
  if (db.chatMessages && Array.isArray(db.chatMessages)) {
    // Auto-prune on retrieval as well
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cleanHistory = db.chatMessages.filter(msg => {
      if (!msg.timestamp) return true;
      return (Date.now() - msg.timestamp) < SEVEN_DAYS_MS;
    });
    
    // Save back if changed
    if (cleanHistory.length !== db.chatMessages.length) {
      db.chatMessages = cleanHistory;
      writeDB(db);
    }
    
    res.json(cleanHistory);
  } else {
    res.json([]);
  }
});

// Clear chat messages history
app.post('/api/chat/clear', (req, res) => {
  const db = readDB();
  db.chatMessages = [];
  writeDB(db);
  res.json({ success: true });
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
    const limitNum = Number(limit) || 100;
    
    // Fetch raw candles
    let candlesRaw;
    if (timeframe === '4h') {
      const raw1h = await exchange.fetchOHLCV(symbol, '1h', undefined, limitNum * 4 + 4);
      candlesRaw = aggregateCandles(raw1h, 4);
      if (candlesRaw.length > limitNum) {
        candlesRaw = candlesRaw.slice(-limitNum);
      }
    } else {
      candlesRaw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limitNum);
    }
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
          fib: calculateFibonacciLevels(slicedCandles, 150)
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
        else if (timeframe === '30m') intervalsPerYear = 17520;
        else if (timeframe === '1h') intervalsPerYear = 8760;
        else if (timeframe === '2h') intervalsPerYear = 4380;
        else if (timeframe === '4h') intervalsPerYear = 2190;
        else if (timeframe === '6h') intervalsPerYear = 1460;
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
  const keywords = ['buy', 'sell', 'status', 'pause', 'start', 'run', 'cycle', 'help'];
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
                    `/run - Force run an immediate bot cycle\n` +
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
      forceNextCycle = true;
      startBotLoop(settings.botIntervalMin);
      addLog('info', "[TELEGRAM COMMAND] Bot started by user.");
      await sendResp(`▶️ <b>Bot loop successfully started.</b> Polling every ${settings.botIntervalMin} minutes.`);
    }
  }
  
  else if (cmd === '/run' || cmd === '/cycle') {
    if (!isBotRunning) {
      await sendResp(`❌ Bot is paused. Please start it with /start first.`);
    } else {
      forceNextCycle = true;
      runBotCycle();
      await sendResp(`⚡ <b>Forcing immediate bot execution cycle...</b>`);
    }
  }
  
  else if (cmd === '/approve_tool' || cmd === '/approve') {
    if (!arg) {
      await sendResp(`❌ <b>Error:</b> Please specify the tool file name to approve (e.g. /approve_tool coinbasePremium.js)`);
    } else {
      const { approveTool } = require('./selfAssembly');
      try {
        const res = await approveTool(arg, db, sendResp);
        if (res.success) {
          addLog('info', `[SELF-ASSEMBLY] Tool ${arg} successfully approved and registered.`);
        }
      } catch (err) {
        await sendResp(`❌ <b>Failed to approve tool:</b> ${err.message}`);
      }
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
        holdings = balance.total[assetName] || balance.free[assetName] || 0;
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
    
    await sendResp(`🧠 <i>Aether AI is analyzing and formulating a response...</i>`);
    try {
      const apiKey = settings.activeLlmProvider === 'openai' 
        ? (settings.openaiApiKey || process.env.OPENAI_API_KEY)
        : (settings.activeLlmProvider === 'claude' 
          ? (settings.claudeApiKey || process.env.CLAUDE_API_KEY)
          : (settings.geminiApiKey || process.env.GEMINI_API_KEY));
          
      if (!apiKey) {
        await sendResp(`❌ <b>Error:</b> API Key for provider "${settings.activeLlmProvider || 'gemini'}" is missing. Please configure it in Settings.`);
        return;
      }
      
      const exchange = getExchangeInstance(settings);
      const marketData = await getMarketContext(exchange, settings.selectedAsset, settings.selectedTimeframe, 200);
      marketData.indicators.currentADX = marketData.indicators.adx.adx[marketData.indicators.adx.adx.length - 1];
      marketData.indicators.currentRVol = marketData.indicators.rvol[marketData.indicators.rvol.length - 1];
      marketData.indicators.marketRegime = marketData.indicators.marketRegime || "UNKNOWN";
      
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
            const macroContextRaw = await getMarketContext(exchange, settings.selectedAsset, macroTimeframe, 200);
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
      
      // Load interactive Telegram chat history
      let telegramDb = readDB();
      if (!telegramDb.telegramChatMessages) {
        telegramDb.telegramChatMessages = [];
      }
      
      // Push user message
      telegramDb.telegramChatMessages.push({ role: 'user', content: cleanText, timestamp: Date.now() });
      
      // sliding window: send last 15 messages to LLM
      const contextMessages = telegramDb.telegramChatMessages.slice(-15);
      
      // Call runAIChatCompletion with tool execution capabilities!
      const result = await runAIChatCompletion({
        provider: settings.activeLlmProvider || 'gemini',
        model: settings.activeLlmModel,
        apiKey,
        messages: contextMessages,
        enabledTools: settings.enabledTools || [],
        enabledStrategies: settings.enabledStrategies || [],
        marketData,
        portfolio: telegramDb.portfolio,
        settings,
        trades: telegramDb.trades || []
      });
      
      if (result && result.response) {
        // Save assistant message to DB
        const freshDb = readDB();
        if (!freshDb.telegramChatMessages) {
          freshDb.telegramChatMessages = [];
        }
        freshDb.telegramChatMessages.push({ role: 'user', content: cleanText, timestamp: Date.now() });
        freshDb.telegramChatMessages.push({ role: 'assistant', content: result.response, timestamp: Date.now() });
        
        // Auto-prune messages older than 7 days
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        freshDb.telegramChatMessages = freshDb.telegramChatMessages.filter(msg => {
          if (!msg.timestamp) return true;
          return (Date.now() - msg.timestamp) < SEVEN_DAYS_MS;
        });
        writeDB(freshDb);
        
        // Send final response back to Telegram
        await sendResp(convertMarkdownToTelegramHTML(result.response));
      } else {
        await sendResp(`❌ Aether processed the request but returned no response.`);
      }
    } catch (err) {
      await sendResp(`❌ <b>Failed to process request:</b> ${err.message}`);
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

// ----------------------------------------------------
// HIGH-FREQUENCY CONDITIONAL ORDER POLLER
// ----------------------------------------------------
let conditionalOrderIntervalId = null;

async function pollConditionalOrders() {
  const db = readDB();
  const orders = db.conditionalOrders || [];
  
  if (orders.length === 0) return;
  
  const settings = db.settings;
  const exchange = getExchangeInstance(settings);
  
  // Group orders by symbol to batch ticker queries
  const symbols = [...new Set(orders.map(o => o.symbol))];
  const prices = {};
  
  // 1. Fetch current prices for all required symbols
  for (const sym of symbols) {
    try {
      const ticker = await exchange.fetchTicker(sym);
      prices[sym] = ticker.last || ticker.close;
    } catch (err) {
      console.error(`[POLLER] Failed to fetch ticker for ${sym}:`, err.message);
    }
  }
  
  // 2. Process each order
  for (const order of orders) {
    const currentPrice = prices[order.symbol];
    if (currentPrice === undefined && order.executionType === 'virtual') continue;
    
    let isTriggered = false;
    let triggerDetails = "";
    
    if (order.executionType === 'virtual') {
      // Virtual order triggers based on price or time
      if (order.triggerType === 'price_below' && currentPrice <= order.triggerValue) {
        isTriggered = true;
        triggerDetails = `price fell below $${order.triggerValue} (Current: $${currentPrice})`;
      } else if (order.triggerType === 'price_above' && currentPrice >= order.triggerValue) {
        isTriggered = true;
        triggerDetails = `price rose above $${order.triggerValue} (Current: $${currentPrice})`;
      } else if (order.triggerType === 'time' && Date.now() >= order.triggerValue) {
        isTriggered = true;
        triggerDetails = `scheduled execution timeframe reached`;
      }
      
      if (isTriggered) {
        addLog('info', `[TRIGGER] Virtual conditional order ${order.id} triggered: ${triggerDetails}.`);
        
        try {
          const finalDb = readDB();
          const assetName = order.symbol.split('/')[0];
          
          let tradeRes;
          const isFutures = order.tradeType === 'futures' || ['SHORT', 'COVER'].includes(order.action);
          const leverageVal = order.leverage || 5;
          if (isFutures) {
            if (settings.tradingMode === 'live') {
              tradeRes = await executeLivePerpTrade(exchange, order.action, order.amountPct, leverageVal, currentPrice, assetName, finalDb, order.symbol, `Triggered conditional order ${order.id}. Reasoning: ${order.reasoning}`);
            } else {
              tradeRes = executePaperPerpTrade(order.action, order.amountPct, leverageVal, currentPrice, assetName, finalDb, `Triggered conditional order ${order.id}. Reasoning: ${order.reasoning}`);
            }
          } else {
            if (settings.tradingMode === 'live') {
              tradeRes = await executeLiveTrade(exchange, order.action, order.amountPct, currentPrice, assetName, finalDb, order.symbol, `Triggered conditional order ${order.id}. Reasoning: ${order.reasoning}`);
            } else {
              tradeRes = executePaperTrade(order.action, order.amountPct, currentPrice, assetName, finalDb, `Triggered conditional order ${order.id}. Reasoning: ${order.reasoning}`);
            }
          }
          
          if (tradeRes.success) {
            // Send Telegram Notification
            if (settings.notificationType === 'telegram' && settings.telegramBotToken && settings.telegramChatId) {
              const msg = `⚡ <b>AETHER CONDITIONAL ORDER TRIGGERED: ${order.action} ${order.symbol}</b> at <b>$${currentPrice.toLocaleString()}</b> (Size: ${order.amountPct}%).\n` +
                          `🎯 <b>Trigger Details:</b> ${escapeHTML(triggerDetails)}.\n` +
                          `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
              await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg).catch(e => console.error(e));
            }
            // Send Discord Webhook Notification
            if (settings.discordWebhookUrl) {
              const discMsg = `⚡ <b>AETHER CONDITIONAL ORDER TRIGGERED: ${order.action} ${order.symbol}</b> at <b>$${currentPrice.toLocaleString()}</b> (Size: ${order.amountPct}%).\n` +
                          `🎯 <b>Trigger Details:</b> ${escapeHTML(triggerDetails)}.\n` +
                          `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
              sendDiscordWebhook(settings.discordWebhookUrl, discMsg).catch(e => console.error('Discord webhook error:', e.message));
            }
          }
        } catch (execErr) {
          addLog('error', `Failed to execute triggered conditional order ${order.id}: ${execErr.message}`);
        } finally {
          // Remove order from database atomically
          const freshDb = readDB();
          freshDb.conditionalOrders = freshDb.conditionalOrders.filter(o => o.id !== order.id);
          writeDB(freshDb);
        }
      }
    } else if (order.executionType === 'exchange') {
      // Exchange order checks if Coinbase has executed it
      if (settings.tradingMode === 'live' && order.exchangeOrderId) {
        try {
          const cbOrder = await exchange.fetchOrder(order.exchangeOrderId, order.symbol);
          if (cbOrder.status === 'closed') {
            addLog('info', `[TRIGGER] Coinbase native limit order filled: ${order.exchangeOrderId}`);
            
            const finalDb = readDB();
            const assetName = order.symbol.split('/')[0];
            const quoteCurrency = order.symbol.split('/')[1] || 'USDC';
            
            // Sync final balance from Coinbase
            const updatedBalance = await exchange.fetchBalance();
            finalDb.portfolio.balanceUSD = updatedBalance.free[quoteCurrency] || 0;
            
            if (!finalDb.portfolio.positions) finalDb.portfolio.positions = {};
            const liveAssetAmount = updatedBalance.total[assetName] || updatedBalance.free[assetName] || 0;
            
            if (liveAssetAmount <= 0.00001) {
              delete finalDb.portfolio.positions[assetName];
              if (finalDb.highestPriceReached) {
                delete finalDb.highestPriceReached[assetName];
              }
            } else {
              const oldPos = finalDb.portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };
              const oldAmount = oldPos.amount || 0;
              const oldAvg = oldPos.avgEntryPrice || 0;
              const fillPrice = cbOrder.price || order.triggerValue;
              const fillAmount = cbOrder.amount || order.amountTokens;
              
              const totalAmount = oldAmount + fillAmount;
              let newAvgPrice = fillPrice;
              if (order.action === 'BUY') {
                if (totalAmount > 0) {
                  newAvgPrice = ((oldAmount * oldAvg) + (fillAmount * fillPrice)) / totalAmount;
                }
              } else {
                newAvgPrice = oldAvg;
              }
              
              finalDb.portfolio.positions[assetName] = {
                amount: liveAssetAmount,
                avgEntryPrice: Number(newAvgPrice.toFixed(6)),
                activeStates: oldPos.activeStates || []
              };
            }
            
            const orderTotal = cbOrder.cost || (cbOrder.amount * cbOrder.price) || (order.amountTokens * order.triggerValue);
            const orderFee = (cbOrder.fee && typeof cbOrder.fee.cost === 'number') ? cbOrder.fee.cost : orderTotal * 0.001;
            
            const tradeDetails = {
              timestamp: new Date().toISOString(),
              symbol: order.symbol,
              action: order.action,
              price: cbOrder.price || order.triggerValue,
              amount: cbOrder.amount || order.amountTokens,
              total: orderTotal,
              fee: orderFee,
              balanceAfter: finalDb.portfolio.balanceUSD,
              reasoning: `Coinbase native limit order executed. Setup reasoning: ${order.reasoning}`,
              mode: 'live'
            };
            
            if (order.action === 'SELL') {
              const oldPos = db.portfolio.positions[assetName];
              const avgEntry = oldPos ? oldPos.avgEntryPrice : (cbOrder.price || order.triggerValue);
              const buyCost = tradeDetails.amount * avgEntry;
              const netProceeds = orderTotal - orderFee;
              const netReturnVal = netProceeds - buyCost;
              const netReturnPct = avgEntry > 0 ? (((tradeDetails.price - avgEntry) / avgEntry) * 100) : 0;
              
              tradeDetails.netReturnVal = Number(netReturnVal.toFixed(4));
              tradeDetails.netReturnPct = Number(netReturnPct.toFixed(2));
              tradeDetails.netReturn = `${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}% ($${netReturnVal.toFixed(2)})`;
            }
            
            finalDb.trades.unshift(tradeDetails);
            writeDB(finalDb);
            logTradeToObsidian(tradeDetails, assetName);
            
            // Send Telegram alert
            if (settings.notificationType === 'telegram' && settings.telegramBotToken && settings.telegramChatId) {
              const msg = `⚡ <b>COINBASE LIMIT ORDER FILLED: ${order.action} ${order.symbol}</b> at <b>$${(cbOrder.price || order.triggerValue).toLocaleString()}</b>.\n` +
                          `📦 <b>Amount:</b> ${(cbOrder.amount || order.amountTokens).toFixed(4)} ${assetName} (Total: $${orderTotal.toFixed(2)}).\n` +
                          `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
              await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg).catch(e => console.error(e));
            }
            // Send Discord Webhook alert
            if (settings.discordWebhookUrl) {
              const discMsg = `⚡ <b>COINBASE LIMIT ORDER FILLED: ${order.action} ${order.symbol}</b> at <b>$${(cbOrder.price || order.triggerValue).toLocaleString()}</b>.\n` +
                          `📦 <b>Amount:</b> ${(cbOrder.amount || order.amountTokens).toFixed(4)} ${assetName} (Total: $${orderTotal.toFixed(2)}).\n` +
                          `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
              sendDiscordWebhook(settings.discordWebhookUrl, discMsg).catch(e => console.error('Discord webhook error:', e.message));
            }
            
            // Remove order atomically
            const freshDb = readDB();
            freshDb.conditionalOrders = freshDb.conditionalOrders.filter(o => o.id !== order.id);
            writeDB(freshDb);
          } else if (cbOrder.status === 'canceled' || cbOrder.status === 'rejected') {
            addLog('warning', `[TRIGGER] Coinbase native order ${order.exchangeOrderId} was ${cbOrder.status}. Removing from tracking.`);
            const freshDb = readDB();
            freshDb.conditionalOrders = freshDb.conditionalOrders.filter(o => o.id !== order.id);
            writeDB(freshDb);
          }
        } catch (fetchErr) {
          console.error(`[POLLER] Error fetching order ${order.exchangeOrderId} status from Coinbase:`, fetchErr.message);
        }
      } else if (settings.tradingMode === 'paper') {
        // In paper mode, simulated limit order triggers just like virtual price triggers
        if (order.triggerType === 'price_below' && currentPrice <= order.triggerValue) {
          isTriggered = true;
          triggerDetails = `price fell below simulated limit of $${order.triggerValue} (Current: $${currentPrice})`;
        } else if (order.triggerType === 'price_above' && currentPrice >= order.triggerValue) {
          isTriggered = true;
          triggerDetails = `price rose above simulated limit of $${order.triggerValue} (Current: $${currentPrice})`;
        }
        
        if (isTriggered) {
          addLog('info', `[TRIGGER] Paper Limit order ${order.id} triggered: ${triggerDetails}.`);
          try {
            const finalDb = readDB();
            const assetName = order.symbol.split('/')[0];
            let tradeRes;
            const isFutures = order.tradeType === 'futures' || ['SHORT', 'COVER'].includes(order.action);
            const leverageVal = order.leverage || 5;
            if (isFutures) {
              tradeRes = executePaperPerpTrade(order.action, order.amountPct, leverageVal, currentPrice, assetName, finalDb, `Simulated limit order ${order.id}. Setup reasoning: ${order.reasoning}`);
            } else {
              tradeRes = executePaperTrade(order.action, order.amountPct, currentPrice, assetName, finalDb, `Simulated limit order ${order.id}. Setup reasoning: ${order.reasoning}`);
            }
            if (tradeRes.success) {
              if (settings.notificationType === 'telegram' && settings.telegramBotToken && settings.telegramChatId) {
                const msg = `⚡ <b>PAPER LIMIT ORDER FILLED: ${order.action} ${order.symbol}</b> at <b>$${currentPrice.toLocaleString()}</b> (Size: ${order.amountPct}%).\n` +
                            `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
                await sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, msg).catch(e => console.error(e));
              }
              // Send Discord Webhook alert
              if (settings.discordWebhookUrl) {
                const discMsg = `⚡ <b>PAPER LIMIT ORDER FILLED: ${order.action} ${order.symbol}</b> at <b>$${currentPrice.toLocaleString()}</b> (Size: ${order.amountPct}%).\n` +
                            `🧠 <b>Setup Rationale:</b> <i>"${escapeHTML(getFirstSentences(order.reasoning, 2))}"</i>`;
                sendDiscordWebhook(settings.discordWebhookUrl, discMsg).catch(e => console.error('Discord webhook error:', e.message));
              }
            }
          } catch (paperErr) {
            addLog('error', `Failed to execute paper limit order ${order.id}: ${paperErr.message}`);
          } finally {
            const freshDb = readDB();
            freshDb.conditionalOrders = freshDb.conditionalOrders.filter(o => o.id !== order.id);
            writeDB(freshDb);
          }
        }
      }
    }
  }

  // 3. Scan active virtual/paper perpetual positions for liquidations (in paper/sim mode)
  if (db.portfolio.futures && db.portfolio.futures.positions) {
    const activeFuturesAssets = Object.keys(db.portfolio.futures.positions);
    for (const asset of activeFuturesAssets) {
      const pos = db.portfolio.futures.positions[asset];
      const selectedAssetSymbol = settings.selectedAsset; // e.g. XRP/USDC or XRP/USD
      const currentPrice = prices[selectedAssetSymbol];
      
      if (currentPrice === undefined) continue;

      let isLiquidated = false;
      if (pos.side === 'LONG' && currentPrice <= pos.liquidationPrice) {
        isLiquidated = true;
      } else if (pos.side === 'SHORT' && currentPrice >= pos.liquidationPrice) {
        isLiquidated = true;
      }

      if (isLiquidated) {
        addLog('error', `🔥 [LIQUIDATION ALERT] Isolated margin liquidation triggered for ${pos.side} ${asset} position! Price: $${currentPrice} crossed barrier: $${pos.liquidationPrice}.`);
        
        const freshDb = readDB();
        if (freshDb.portfolio.futures && freshDb.portfolio.futures.positions && freshDb.portfolio.futures.positions[asset]) {
          const liquidatedPos = freshDb.portfolio.futures.positions[asset];
          delete freshDb.portfolio.futures.positions[asset];
          
          const tradeDetails = {
            timestamp: new Date().toISOString(),
            symbol: selectedAssetSymbol,
            action: liquidatedPos.side === 'LONG' ? 'SELL' : 'COVER',
            price: currentPrice,
            amount: liquidatedPos.amount,
            total: liquidatedPos.amount * currentPrice,
            fee: 0,
            balanceAfter: freshDb.portfolio.futures.marginBalanceUSD,
            reasoning: `🔥 FORCED MARGIN LIQUIDATION: Price crossed barrier $${liquidatedPos.liquidationPrice}`,
            mode: settings.tradingMode,
            tradeType: 'futures',
            leverage: liquidatedPos.leverage,
            netReturnVal: -liquidatedPos.margin,
            netReturnPct: -100.00,
            netReturn: `-100.00% (-$${liquidatedPos.margin.toFixed(2)} USD)`
          };
          
          if (!freshDb.trades) freshDb.trades = [];
          freshDb.trades.unshift(tradeDetails);
          
          let totalPnL = 0;
          for (const k of Object.keys(freshDb.portfolio.futures.positions)) {
            totalPnL += freshDb.portfolio.futures.positions[k].unrealizedPnL || 0;
          }
          freshDb.portfolio.futures.unrealizedPnL = Number(totalPnL.toFixed(4));
          writeDB(freshDb);
          logTradeToObsidian(tradeDetails, asset);
          
          const alertMsg = `🔥 <b>FORCED MARGIN LIQUIDATION DETECTED</b> 🔥\n\n` +
                           `Position: <b>${liquidatedPos.side} ${asset}</b> at ${liquidatedPos.leverage}x leverage.\n` +
                           `Entry Price: <b>$${liquidatedPos.entryPrice}</b>\n` +
                           `Liquidation Barrier: <b>$${liquidatedPos.liquidationPrice}</b>\n` +
                           `Trigger Price: <b>$${currentPrice}</b>\n` +
                           `Loss: <b>-$${liquidatedPos.margin.toFixed(2)} USD</b> (100% of isolated margin)`;
          
          if (settings.notificationType === 'telegram' && settings.telegramBotToken && settings.telegramChatId) {
            sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, alertMsg).catch(e => console.error(e));
          }
          if (settings.discordWebhookUrl) {
            sendDiscordWebhook(settings.discordWebhookUrl, alertMsg).catch(e => console.error('Discord webhook error:', e.message));
          }
        }
      } else {
        const freshDb = readDB();
        recalculatePaperFuturesPnL(freshDb, currentPrice, asset);
        writeDB(freshDb);
      }
    }
  }
}

function startConditionalOrderPoller() {
  if (conditionalOrderIntervalId) {
    clearInterval(conditionalOrderIntervalId);
  }
  // Run checks every 30 seconds for near real-time price monitoring
  conditionalOrderIntervalId = setInterval(pollConditionalOrders, 30000);
  console.log("Aether high-frequency conditional order poller started (30s interval).");
}

// Start bot interval loop if enabled on startup
const dbOnStart = readDB();
writeDB(dbOnStart); // serialize defaults on start
if (dbOnStart.settings && dbOnStart.settings.botEnabled) {
  startBotLoop(dbOnStart.settings.botIntervalMin);
}
startTelegramCommandListener();
startConditionalOrderPoller();

// Serve index.html for client-side routing fallback (placed after all API routes)
if (fs.existsSync(frontendDistPath)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const os = require('os');
  let localIp = 'localhost';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
      if (localIp !== 'localhost') break;
    }
  } catch (e) {
    // ignore
  }
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`To access on your phone, open: http://${localIp}:${PORT}`);
});
