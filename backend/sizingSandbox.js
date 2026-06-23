const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ccxt = require('ccxt');
const { queryModel } = require('./brain');
const { 
  calculateSMA, 
  calculateRSI, 
  calculateADX, 
  calculateRelativeVolume 
} = require('./indicators');

/**
 * Executes a sizing formula JS string inside a secure VM context.
 */
function runFormulaInSandbox(formulaCode, metrics) {
  try {
    const sandbox = {
      metrics: metrics,
      console: { log: () => {} }
    };
    const script = new vm.Script(`(function() {
      const fn = ${formulaCode};
      return fn(metrics);
    })()`);
    const context = vm.createContext(sandbox);
    const result = script.runInContext(context, { timeout: 100 });
    return Number(result) || 0;
  } catch (err) {
    return 0; // Default to 0 size on error
  }
}

/**
 * Backtests a sizing formula JS code against historical candles.
 */
function backtestSizingFormula(formulaCode, candles) {
  const closePrices = candles.map(c => c.close);
  const rsiArr = calculateRSI(closePrices, 14);
  const sma21Arr = calculateSMA(closePrices, 21);
  const adxObj = calculateADX(candles, 14);
  const rvolArr = calculateRelativeVolume(candles, 20);

  let cash = 10000;
  let position = 0;
  let peakValue = 10000;
  let maxDrawdown = 0;
  let returns = [];

  // Simulate trading on 4h candles
  for (let i = 20; i < candles.length; i++) {
    const close = candles[i].close;
    const adx = adxObj.adx[i] || 20;
    const plusDI = adxObj.plusDI[i] || 20;
    const minusDI = adxObj.minusDI[i] || 20;
    const rvol = rvolArr[i] || 1.0;
    const rsi = rsiArr[i] || 50;

    const metrics = { adx, plusDI, minusDI, rvol, rsi, close };

    // Get size percentage (0 to 100) from formula
    const sizePct = Math.max(0, Math.min(100, runFormulaInSandbox(formulaCode, metrics)));

    // Simple paper execution simulation:
    // If sizePct > 0 and position is 0, we BUY.
    // If sizePct === 0 and position > 0, we SELL.
    // If sizePct shifts, we adjust position size.
    const currentPortfolioValue = cash + position * close;
    if (currentPortfolioValue > peakValue) {
      peakValue = currentPortfolioValue;
    }
    const dd = ((peakValue - currentPortfolioValue) / peakValue) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;

    const targetPositionValue = (sizePct / 100) * currentPortfolioValue;
    const currentPositionValue = position * close;
    const diffUSD = targetPositionValue - currentPositionValue;

    if (diffUSD > 10 && cash >= diffUSD) {
      // BUY scaling
      const amountToBuy = diffUSD / close;
      position += amountToBuy;
      cash -= diffUSD;
    } else if (diffUSD < -10 && position > 0) {
      // SELL scaling
      const amountToSell = Math.min(position, Math.abs(diffUSD) / close);
      position -= amountToSell;
      cash += amountToSell * close;
    }

    if (i > 20) {
      const prevVal = cash + position * candles[i-1].close;
      const ret = (currentPortfolioValue - prevVal) / prevVal;
      returns.push(ret);
    }
  }

  const finalValue = cash + position * candles[candles.length - 1].close;
  const netReturn = ((finalValue - 10000) / 10000) * 100;

  // Calculate Sharpe Ratio (rough estimate)
  let sharpeRatio = 0;
  if (returns.length > 0) {
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 6) : 0; // annualized for 4h candles
  }

  return {
    netReturn,
    maxDrawdown: -maxDrawdown,
    sharpeRatio
  };
}

/**
 * Prompts Gemini to mutate the active sizing formula, backtests both,
 * and updates db.json if the mutation yields a higher Sharpe Ratio.
 */
async function mutateAndBacktestSizing(apiKey, settings, logCallback) {
  const vaultPath = settings.obsidianVaultPath;
  const symbol = settings.selectedAsset || 'XRP/USDC';
  const timeframe = settings.selectedTimeframe || '4h';
  const limit = 200;

  if (logCallback) logCallback("Genetic Sizing Sandbox: Fetching historical candles...", "info");

  // Fetch candles
  let candles = [];
  try {
    const exchangeName = (settings.exchangeName || 'coinbase').toLowerCase();
    const exchange = ccxt[exchangeName] ? new ccxt[exchangeName]({ timeout: 15000 }) : new ccxt.coinbase({ timeout: 15000 });
    
    let raw;
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
      raw = [];
      for (const t of sortedTimestamps) {
        const chunk = buckets[t];
        const open = chunk[0][1];
        const close = chunk[chunk.length - 1][4];
        const high = Math.max(...chunk.map(c => c[2]));
        const low = Math.min(...chunk.map(c => c[3]));
        const volume = chunk.reduce((sum, c) => sum + (c[5] || 0), 0);
        raw.push([t, open, high, low, close, volume]);
      }
      if (raw.length > limit) {
        raw = raw.slice(-limit);
      }
    } else {
      raw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    }
    
    candles = raw.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
  } catch (err) {
    if (logCallback) logCallback(`Exchange candle fetch failed: ${err.message}. Sandbox falling back to db.json.`, "warning");
    try {
      const dbPath = path.join(__dirname, 'db.json');
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
    } catch (e) {}
  }

  if (candles.length < 50) {
    if (logCallback) logCallback("Insufficient candles for genetic sizing backtest.", "error");
    return;
  }

  // Load current active sizing formula from DB
  const dbPath = path.join(__dirname, 'db.json');
  let db = { settings: {} };
  if (fs.existsSync(dbPath)) {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }

  const defaultFormula = `(metrics) => {
    let size = 15;
    if (metrics.rsi < 35) size += 20;
    if (metrics.adx > 25 && metrics.plusDI > metrics.minusDI) size += 15;
    if (metrics.rvol > 1.5) size += 10;
    if (metrics.adx < 20) size = Math.min(size, 30); // Choppy Range cap
    return size;
  }`;

  const currentFormula = db.settings.activeSizingFormula || defaultFormula;

  // Run current backtest
  if (logCallback) logCallback("Genetic Sizing Sandbox: Evaluating active sizing formula...", "info");
  const currentMetrics = backtestSizingFormula(currentFormula, candles);
  if (logCallback) logCallback(`Active Formula Metrics: Return=${currentMetrics.netReturn.toFixed(1)}%, DD=${currentMetrics.maxDrawdown.toFixed(1)}%, Sharpe=${currentMetrics.sharpeRatio.toFixed(2)}`, "info");

  // Query Gemini for mutation
  if (logCallback) logCallback("Genetic Sizing Sandbox: Requesting sizing formula mutation from Gemini...", "info");
  
  const systemInstruction = `You are Aether's Sizing Mutator and Risk Scientist. Your job is to mutate a JavaScript trading size calculation function to optimize Sharpe Ratio and minimize Drawdown.
The function signature must remain: (metrics) => { ... return sizePercentage; }
Respond ONLY with a clean JS codeblock containing the mutated function. No comments outside the block, no other text.`;

  const promptText = `
=== CURRENT SIZING FORMULA ===
${currentFormula}

=== ACTIVE FORMULA BACKTEST PERFORMANCE ===
- Net Return: ${currentMetrics.netReturn.toFixed(2)}%
- Max Drawdown: ${currentMetrics.maxDrawdown.toFixed(2)}%
- Sharpe Ratio: ${currentMetrics.sharpeRatio.toFixed(2)}

The metrics object passed to the function contains:
- metrics.rsi: number (14-period RSI)
- metrics.adx: number (14-period ADX)
- metrics.plusDI: number (14-period +DI)
- metrics.minusDI: number (14-period -DI)
- metrics.rvol: number (relative volume)
- metrics.close: number (price)

Mutate the current sizing formula to improve performance. Use conditional structures to scale size up during bullish momentum and scale down or cap size (e.g. <=30%) during low volume or choppy ADX < 20.

Return ONLY the raw JavaScript function, no markdown wrapper codeblocks (or standard \`\`\`javascript wrappers are fine).
`;

  try {
    const provider = settings.activeLlmProvider || "gemini";
    let mutatedRaw = await queryModel(provider, "gemini-2.5-flash", apiKey, systemInstruction, promptText, null, settings);
    
    // Clean up code block
    mutatedRaw = mutatedRaw.trim().replace(/^```javascript\s*/, '').replace(/^```\s*/, '').replace(/```$/, '');

    // Dry-run run check
    const dryRunResult = runFormulaInSandbox(mutatedRaw, { rsi: 50, adx: 20, plusDI: 20, minusDI: 20, rvol: 1.0, close: 1.0 });
    if (dryRunResult === null || isNaN(dryRunResult)) {
      throw new Error("Mutated formula dry-run compilation failed or returned NaN.");
    }

    // Backtest mutated formula
    if (logCallback) logCallback("Genetic Sizing Sandbox: Backtesting mutated sizing formula...", "info");
    const mutatedMetrics = backtestSizingFormula(mutatedRaw, candles);
    if (logCallback) logCallback(`Mutated Formula Metrics: Return=${mutatedMetrics.netReturn.toFixed(1)}%, DD=${mutatedMetrics.maxDrawdown.toFixed(1)}%, Sharpe=${mutatedMetrics.sharpeRatio.toFixed(2)}`, "info");

    const isImproved = mutatedMetrics.sharpeRatio > currentMetrics.sharpeRatio;

    // Write backtest report to Obsidian if vaultPath is set
    if (vaultPath) {
      try {
        const reportsDir = path.join(vaultPath, 'Backtests');
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }
        const reportDate = new Date().toISOString().split('T')[0];
        const reportPath = path.join(reportsDir, `Sizing_Mutation_${reportDate}.md`);

        const reportMarkdown = `---
type: sizing_mutation_report
improved: ${isImproved}
timestamp: ${new Date().toISOString()}
---
# 🧬 Genetic Sizing Sandbox Backtest Report

A genetic mutation tick was run to optimize risk sizing heuristics.

## 📊 Backtest Performance Comparisons

| Formula | Net Return | Max Drawdown | Sharpe Ratio | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Active Formula** | ${currentMetrics.netReturn.toFixed(2)}% | ${currentMetrics.maxDrawdown.toFixed(2)}% | ${currentMetrics.sharpeRatio.toFixed(2)} | ${isImproved ? 'Replaced' : 'Maintained Active'} |
| **Mutated Formula** | ${mutatedMetrics.netReturn.toFixed(2)}% | ${mutatedMetrics.maxDrawdown.toFixed(2)}% | ${mutatedMetrics.sharpeRatio.toFixed(2)} | ${isImproved ? 'Adopted [NEW]' : 'Rejected'} |

## 💻 Mutated Code Formulation
\`\`\`javascript
${mutatedRaw}
\`\`\`
`;
        fs.writeFileSync(reportPath, reportMarkdown, 'utf8');
        if (logCallback) logCallback(`Sizing mutation report written to Obsidian: Backtests/Sizing_Mutation_${reportDate}.md`, "info");
      } catch (err) {
        console.error("Failed to write sizing report to Obsidian:", err.message);
      }
    }

    if (isImproved) {
      if (logCallback) logCallback("Genetic Sizing Sandbox: Mutated formula outperformed active. Updating db.json...", "info");
      db.settings.activeSizingFormula = mutatedRaw;
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      return mutatedRaw;
    } else {
      if (logCallback) logCallback("Genetic Sizing Sandbox: Mutated formula did not outperform active. Maintaining current active formula.", "info");
      return currentFormula;
    }

  } catch (err) {
    if (logCallback) logCallback(`Sizing mutation sandbox error: ${err.message}`, "error");
  }

  return currentFormula;
}

module.exports = {
  runFormulaInSandbox,
  backtestSizingFormula,
  mutateAndBacktestSizing
};
