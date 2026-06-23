const fs = require('fs');
const path = require('path');
const ccxt = require('ccxt');
const { 
  calculateSMA, 
  calculateRSI, 
  calculateADX, 
  calculateRelativeVolume 
} = require('../indicators');

/**
 * Classifies market regime based on indicators (matching server.js logic)
 */
function classifyRegime(adx, plusDI, minusDI, rvol, close, sma21, prevADX) {
  if (adx === null || adx === undefined) return "TRANSITIONING_ZONE";
  
  const isADXRising = prevADX !== undefined ? adx > prevADX : false;

  if (adx > 25) {
    if (plusDI > minusDI && close > sma21) {
      return "TRENDING_BULLISH";
    } else if (minusDI > plusDI && close < sma21) {
      return "TRENDING_BEARISH";
    } else {
      return "STRONG_TREND_CONSOLIDATION";
    }
  } else if (adx < 20) {
    return "CHOPPY_RANGE";
  } else {
    if (isADXRising && rvol > 1.5) {
      return "HIGH_VOLATILITY_SQUEEZE";
    } else {
      return "TRANSITIONING_ZONE";
    }
  }
}

/**
 * Runs historical evaluation on all Obsidian hypotheses.
 * Updates frontmatter metrics and deprecates failed theories.
 */
async function runHypothesisTester(settings, logCallback) {
  const vaultPath = settings.obsidianVaultPath;
  if (!vaultPath) {
    if (logCallback) logCallback("Obsidian vault path not configured. Skipping Hypothesis Tester.", "warning");
    return;
  }

  const hypothesesDir = path.join(vaultPath, 'Hypotheses');
  if (!fs.existsSync(hypothesesDir)) {
    if (logCallback) logCallback("No Hypotheses directory found in Obsidian vault. Skipping Tester.", "info");
    return;
  }

  const files = fs.readdirSync(hypothesesDir).filter(f => f.startsWith('Hypothesis_') && f.endsWith('.md'));
  if (files.length === 0) {
    if (logCallback) logCallback("No hypotheses found. Skipping Tester.", "info");
    return;
  }

  if (logCallback) logCallback(`Hypothesis Tester: Found ${files.length} hypotheses to evaluate.`, "info");

  // Fetch historical candles for backtesting
  const symbol = settings.selectedAsset || 'XRP/USDC';
  const timeframe = settings.selectedTimeframe || '4h';
  const limit = 200; // Lookback candles for validation

  let candles = [];
  try {
    const exchangeName = (settings.exchangeName || 'coinbase').toLowerCase();
    const exchangeConfig = { timeout: 15000 };
    if (settings.exchangeApiKey && settings.exchangeApiSecret) {
      exchangeConfig.apiKey = cleanCDPApiKey(settings.exchangeApiKey);
      exchangeConfig.secret = cleanCDPSecret(settings.exchangeApiSecret);
    }
    const exchange = ccxt[exchangeName] ? new ccxt[exchangeName](exchangeConfig) : new ccxt.coinbase({ timeout: 15000 });
    if (exchangeName === 'coinbase') {
      exchange.options['createMarketBuyOrderRequiresPrice'] = false;
    }

    if (logCallback) logCallback(`Fetching ${limit} historical ${timeframe} candles from ${exchange.id} for hypothesis tester...`, "info");
    let rawCandles;
    if (timeframe === '4h') {
      const raw1h = await exchange.fetchOHLCV(symbol, '1h', undefined, limit * 4 + 4);
      const buckets = {};
      for (const c of raw1h) {
        if (!c || c.length < 6) continue;
        const timestamp = c[0];
        const date = new Date(timestamp);
        const utcHours = date.getUTCHours();
        const bucketHours = Math.floor(utcHours / 4) * 4;
        const bucketDate = new Date(date);
        bucketDate.setUTCHours(bucketHours, 0, 0, 0);
        const bucketTimestamp = bucketDate.getTime();
        if (!buckets[bucketTimestamp]) buckets[bucketTimestamp] = [];
        buckets[bucketTimestamp].push(c);
      }
      const sortedTimestamps = Object.keys(buckets).map(Number).sort((a, b) => a - b);
      rawCandles = [];
      for (const t of sortedTimestamps) {
        const chunk = buckets[t];
        const open = chunk[0][1];
        const close = chunk[chunk.length - 1][4];
        const high = Math.max(...chunk.map(c => c[2]));
        const low = Math.min(...chunk.map(c => c[3]));
        const volume = chunk.reduce((sum, c) => sum + (c[5] || 0), 0);
        rawCandles.push([t, open, high, low, close, volume]);
      }
      if (rawCandles.length > limit) {
        rawCandles = rawCandles.slice(-limit);
      }
    } else {
      rawCandles = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    }
    
    candles = rawCandles.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));
  } catch (err) {
    if (logCallback) logCallback(`Failed to fetch candles from exchange: ${err.message}. Falling back to cached data.`, "warning");
    // Fallback: load macroCache or similar if available in db.json
    try {
      const dbPath = path.join(__dirname, '..', 'db.json');
      if (fs.existsSync(dbPath)) {
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (db.macroCache && db.macroCache.data) {
          const cacheData = db.macroCache.data;
          const cacheCandles = cacheData.recentCandles || (Array.isArray(cacheData) ? cacheData : []);
          if (cacheCandles.length > 0) {
            candles = cacheCandles.map(c => ({
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume
            }));
          }
        }
      }
    } catch (dbErr) {
      console.error("Failed to read from db.json fallback:", dbErr.message);
    }
  }

  if (candles.length < 50) {
    if (logCallback) logCallback("Insufficient candle history to run hypothesis testing. Minimum required: 50 candles.", "error");
    return;
  }

  // Pre-calculate indicators
  const closePrices = candles.map(c => c.close);
  const rsiArr = calculateRSI(closePrices, 14);
  const sma21Arr = calculateSMA(closePrices, 21);
  const adxObj = calculateADX(candles, 14);
  const rvolArr = calculateRelativeVolume(candles, 20);

  // Compile historical states array
  const history = candles.map((c, idx) => {
    const adx = adxObj.adx[idx];
    const plusDI = adxObj.plusDI[idx];
    const minusDI = adxObj.minusDI[idx];
    const rvol = rvolArr[idx];
    const rsi = rsiArr[idx];
    const close = c.close;
    const sma21 = sma21Arr[idx];
    const prevADX = idx > 0 ? adxObj.adx[idx - 1] : adx;

    const regime = classifyRegime(adx, plusDI, minusDI, rvol, close, sma21, prevADX);

    return {
      index: idx,
      time: c.time,
      close: close,
      high: c.high,
      low: c.low,
      regime: regime,
      rsi: rsi,
      adx: adx,
      rvol: rvol
    };
  });

  // Evaluate each hypothesis file
  for (const file of files) {
    const filePath = path.join(hypothesesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Extract JSON block
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      if (logCallback) logCallback(`Could not parse JSON predicate in ${file}. Skipping.`, "warning");
      continue;
    }

    let predicate = null;
    try {
      predicate = JSON.parse(jsonMatch[1]);
    } catch (e) {
      if (logCallback) logCallback(`Invalid JSON format in ${file}: ${e.message}`, "warning");
      continue;
    }

    if (logCallback) logCallback(`Evaluating Hypothesis in ${file}: "${predicate.regime}" regime targets "${predicate.outcome_target}"...`, "info");

    let sampleSize = 0;
    let winCount = 0;

    // Scan history (leaving at least 8 candles at the end for forward outcome check)
    for (let i = 20; i < history.length - 8; i++) {
      const state = history[i];

      // Check regime condition
      if (predicate.regime && state.regime !== predicate.regime) continue;

      // Check specific conditions
      let conditionsMatch = true;
      if (predicate.conditions && Array.isArray(predicate.conditions)) {
        for (const cond of predicate.conditions) {
          const val = state[cond.indicator.toLowerCase()];
          if (val === undefined || val === null) {
            conditionsMatch = false;
            break;
          }
          if (cond.operator === 'gt' && !(val > cond.value)) {
            conditionsMatch = false;
            break;
          }
          if (cond.operator === 'lt' && !(val < cond.value)) {
            conditionsMatch = false;
            break;
          }
        }
      }

      if (!conditionsMatch) continue;

      // We have a trigger!
      sampleSize++;

      // Check forward outcome over next 8 candles (e.g. 32 hours)
      // A "win" path: rises by +2% before dropping by -1.5% from trigger price
      const triggerPrice = state.close;
      let resolvedOutcome = null;

      for (let j = i + 1; j <= i + 8; j++) {
        const fut = history[j];
        const pctChangeHigh = ((fut.high - triggerPrice) / triggerPrice) * 100;
        const pctChangeLow = ((fut.low - triggerPrice) / triggerPrice) * 100;

        if (pctChangeLow <= -1.5) {
          resolvedOutcome = 'loss';
          break;
        }
        if (pctChangeHigh >= 2.0) {
          resolvedOutcome = 'win';
          break;
        }
      }

      // If not resolved in 8 candles, check net close change
      if (!resolvedOutcome) {
        const finalClose = history[i + 8].close;
        resolvedOutcome = finalClose > triggerPrice ? 'win' : 'loss';
      }

      // Increment winCount if resolvedOutcome matches target
      if (resolvedOutcome === predicate.outcome_target) {
        winCount++;
      }
    }

    const winRate = sampleSize > 0 ? (winCount / sampleSize) : 0.0;
    
    // Simple p-value estimate using normal approximation of binomial distribution (null hyp: 50% probability)
    let pValue = 1.0;
    if (sampleSize >= 4) {
      const expectedWins = sampleSize * 0.5;
      const stdDev = Math.sqrt(sampleSize * 0.5 * 0.5);
      const z = Math.abs(winCount - expectedWins) / stdDev;
      // Rough z-to-p conversion
      pValue = Math.exp(-0.717 * z - 0.416 * z * z);
    }

    // Determine new status and credibility
    let status = 'Proposed';
    let credibility = 'Low';

    if (sampleSize >= 5) {
      if (winRate >= 0.60 && pValue < 0.15) {
        status = 'Active';
        credibility = winRate >= 0.75 ? 'High' : 'Medium';
      } else if (winRate < 0.45) {
        status = 'Deprecated';
        credibility = 'Low';
      } else {
        status = 'Proposed';
        credibility = 'Low';
      }
    }

    // Rewrite note frontmatter
    const dateStr = new Date().toISOString().split('T')[0];
    const newFrontmatter = `---
id: ${predicate.id || 1}
description: "${predicate.description || content.match(/description:\s*"([^"]*)"/)?.[1] || ''}"
status: ${status}
credibility_score: ${credibility}
win_rate: ${winRate.toFixed(2)}
sample_size: ${sampleSize}
p_value: ${pValue.toFixed(3)}
last_evaluated: ${dateStr}
---`;

    // Replace old frontmatter
    const oldFrontmatterRegex = /^---[\s\S]*?---/;
    const updatedContent = content.replace(oldFrontmatterRegex, newFrontmatter);
    fs.writeFileSync(filePath, updatedContent, 'utf8');

    if (logCallback) {
      logCallback(`Updated ${file}: Status=${status}, Credibility=${credibility}, WinRate=${(winRate * 100).toFixed(0)}% (Sample: ${sampleSize})`, "info");
    }
  }

  if (logCallback) logCallback("Hypothesis Tester run complete.", "info");
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

module.exports = {
  runHypothesisTester
};
