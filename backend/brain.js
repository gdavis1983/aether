/**
 * LLM Decision Brain using Gemini API
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { writeStateNode, writeDebateLog } = require('./obsidianWriter');

/**
 * Ask Gemini for a trading decision
 * @param {string} apiKey - Gemini API Key
 * @param {object} marketData - Market data containing ticker, indicators, and recent candles
 * @param {object} portfolio - Current portfolio state (cash and positions)
 * @param {object} settings - Bot settings including custom prompt
 * @returns {Promise<object>} The parsed JSON response from Gemini
 */
async function getOpenAiDecision(model, apiKey, promptText) {
  const url = "https://api.openai.com/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: "You are a master algorithmic cryptocurrency trader specializing in Elliott Wave Theory, Fibonacci Retracements, and momentum analysis. Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text." },
        { role: "user", content: promptText }
      ],
      response_format: { type: "json_object" }
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
  }
  
  const resJson = await response.json();
  return resJson.choices[0].message.content.trim();
}

async function getClaudeDecision(model, apiKey, promptText) {
  const url = "https://api.anthropic.com/v1/messages";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: model || "claude-3-5-sonnet-latest",
      max_tokens: 2000,
      system: "You are a master algorithmic cryptocurrency trader specializing in Elliott Wave Theory, Fibonacci Retracements, and momentum analysis. Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.",
      messages: [
        { role: "user", content: promptText }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API Error (${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  return resJson.content[0].text.trim();
}

async function queryModel(provider, model, apiKey, systemInstruction, userPrompt, responseSchema, settings) {
  if (provider === "openai") {
    const url = "https://api.openai.com/v1/chat/completions";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
    }
    const resJson = await response.json();
    return resJson.choices[0].message.content.trim();
  } else if (provider === "claude") {
    const url = "https://api.anthropic.com/v1/messages";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 2000,
        system: systemInstruction,
        messages: [
          { role: "user", content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API Error (${response.status}): ${errText}`);
    }
    const resJson = await response.json();
    return resJson.content[0].text.trim();
  } else {
    // Gemini logic
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: userPrompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      }
    };
    if (responseSchema) {
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: responseSchema
      };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errText}`);
    }
    const resJson = await response.json();
    if (!resJson.candidates || resJson.candidates.length === 0) {
      throw new Error("No response candidates returned from Gemini.");
    }
    return resJson.candidates[0].content.parts[0].text.trim();
  }
}

async function queryModelWithFallback(provider, model, apiKey, systemInstruction, userPrompt, responseSchema, settings, logCallback) {
  let resultText = "";
  let lastError = null;

  if (provider === "openai" || provider === "claude") {
    try {
      resultText = await queryModel(provider, model, apiKey, systemInstruction, userPrompt, responseSchema, settings);
    } catch (err) {
      lastError = err;
    }
  } else {
    // Gemini fallback logic
    const candidateModels = Array.from(new Set(
      model.startsWith("gemini") 
        ? [model, "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"] 
        : ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]
    ));
    
    for (const curModel of candidateModels) {
      let backoffMs = 1000;
      const attempts = 2;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          resultText = await queryModel(provider, curModel, apiKey, systemInstruction, userPrompt, responseSchema, settings);
          clearTimeout(timeoutId);
          break;
        } catch (err) {
          lastError = err;
          if (logCallback) {
            logCallback(`Gemini model ${curModel} (attempt ${attempt}/${attempts}) failed: ${err.message}`, "warning");
          }
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
        }
      }
      if (resultText) break;
    }
  }

  if (!resultText) {
    throw lastError || new Error(`All candidate models for provider ${provider} failed to return a response.`);
  }

  return resultText;
}

async function getTradingDecision(apiKey, marketData, portfolio, settings, logWarning) {
  const provider = settings.activeLlmProvider || "gemini";
  let activeApiKey = apiKey;
  if (provider === "openai") {
    activeApiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  } else if (provider === "claude") {
    activeApiKey = settings.claudeApiKey || process.env.CLAUDE_API_KEY;
  } else {
    activeApiKey = settings.geminiApiKey || apiKey || process.env.GEMINI_API_KEY;
  }
  
  if (!activeApiKey) {
    throw new Error(`API Key for active provider (${provider}) is missing. Please configure it in Settings.`);
  }

  const logCallback = typeof logWarning === 'function' ? logWarning : null;
  const { ticker, indicators, recentCandles, macroContext } = marketData;
  const currentPrice = ticker.close;
  const assetName = settings.selectedAsset.split("/")[0];
  const cash = portfolio.balanceUSD;
  const position = portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };

  // Format candles for prompt
  const candleSummary = recentCandles.slice(-10).map(c => 
    `Time: ${new Date(c.time).toISOString()} | O: ${c.open} | H: ${c.high} | L: ${c.low} | C: ${c.close} | V: ${c.volume.toFixed(2)}`
  ).join("\n");

  // Format technical indicators
  const latestRsi = indicators.rsi[indicators.rsi.length - 1];
  const latestSma9 = indicators.sma9[indicators.sma9.length - 1];
  const latestSma21 = indicators.sma21[indicators.sma21.length - 1];
  const latestMacd = indicators.macd.macdLine[indicators.macd.macdLine.length - 1];
  const latestMacdSignal = indicators.macd.signalLine[indicators.macd.signalLine.length - 1];
  const latestMacdHist = indicators.macd.histogram[indicators.macd.histogram.length - 1];

  // ADX & Relative Volume (Local mathematical indicators)
  const currentADX = indicators.currentADX !== undefined ? indicators.currentADX : (indicators.adx ? indicators.adx.adx[indicators.adx.adx.length - 1] : null);
  const currentPlusDI = indicators.currentPlusDI !== undefined ? indicators.currentPlusDI : (indicators.adx ? indicators.adx.plusDI[indicators.adx.plusDI.length - 1] : null);
  const currentMinusDI = indicators.currentMinusDI !== undefined ? indicators.currentMinusDI : (indicators.adx ? indicators.adx.minusDI[indicators.adx.minusDI.length - 1] : null);
  const currentRVol = indicators.currentRVol !== undefined ? indicators.currentRVol : (indicators.rvol ? indicators.rvol[indicators.rvol.length - 1] : null);
  const marketRegime = indicators.marketRegime || "UNKNOWN";

  // Elliott Wave specific indicators
  const latestAo = indicators.ao ? indicators.ao[indicators.ao.length - 1] : null;
  const prevAo = indicators.ao ? indicators.ao[indicators.ao.length - 2] : null;
  const fib = indicators.fib || {};

  let marketContext = "";

  if (macroContext) {
    const macroIndicators = macroContext.indicators;
    const macroRsi = macroIndicators.rsi[macroIndicators.rsi.length - 1];
    const macroSma9 = macroIndicators.sma9[macroIndicators.sma9.length - 1];
    const macroSma21 = macroIndicators.sma21[macroIndicators.sma21.length - 1];
    const macroMacdHist = macroIndicators.macd.histogram[macroIndicators.macd.histogram.length - 1];
    const macroAo = macroIndicators.ao ? macroIndicators.ao[macroIndicators.ao.length - 1] : null;
    const prevMacroAo = macroIndicators.ao ? macroIndicators.ao[macroIndicators.ao.length - 2] : null;
    const macroFib = macroIndicators.fib || {};

    const macroCandleSummary = macroContext.recentCandles.slice(-10).map(c => 
      `Time: ${new Date(c.time).toISOString()} | O: ${c.open} | H: ${c.high} | L: ${c.low} | C: ${c.close} | V: ${c.volume.toFixed(2)}`
    ).join("\n");

    marketContext += `
=== MACRO TREND CONTEXT (${macroContext.timeframe} Chart) ===
- SMA (9): ${macroSma9 !== null ? `$${macroSma9}` : "N/A"}
- SMA (21): ${macroSma21 !== null ? `$${macroSma21}` : "N/A"}
- SMA Cross: ${macroSma9 && macroSma21 ? (macroSma9 > macroSma21 ? "Bullish (9 > 21)" : "Bearish (9 < 21)") : "N/A"}
- RSI (14): ${macroRsi !== null ? macroRsi.toFixed(2) : "N/A"}
- MACD Hist: ${macroMacdHist !== null ? macroMacdHist.toFixed(4) : "N/A"}
- Awesome Oscillator (AO): ${macroAo !== null ? macroAo.toFixed(4) : "N/A"} (Prev: ${prevMacroAo !== null ? prevMacroAo.toFixed(4) : "N/A"})
- Fibonacci Retracements (Macro):
  * Range High: $${macroFib.high || "N/A"}
  * Range Low: $${macroFib.low || "N/A"}
  * 38.2% Level: $${macroFib.level382 || "N/A"}
  * 61.8% Level: $${macroFib.level618 || "N/A"}

--- MACRO RECENT CANDLE HISTORY (Last 10 intervals) ---
${macroCandleSummary}
`;
  }

  const microTimeframeLabel = macroContext ? `MICRO EXECUTION CONTEXT (${settings.selectedTimeframe} Chart)` : "MARKET CONTEXT";
  
  marketContext += `
=== ${microTimeframeLabel} ===
Asset: ${settings.selectedAsset}
Current Price: $${currentPrice}

--- MARKET REGIME & VOLUME ---
- Average Directional Index (ADX): ${currentADX !== null ? currentADX.toFixed(2) : "N/A"}
- Positive Directional Index (+DI): ${currentPlusDI !== null ? currentPlusDI.toFixed(2) : "N/A"}
- Negative Directional Index (-DI): ${currentMinusDI !== null ? currentMinusDI.toFixed(2) : "N/A"}
- Relative Volume (RVol): ${currentRVol !== null ? currentRVol.toFixed(4) : "N/A"}
- Classified Market Regime: ${marketRegime}

--- TECHNICAL INDICATORS (Latest) ---
- RSI (14): ${latestRsi !== null ? latestRsi.toFixed(2) : "N/A"} (Overbought > 70, Oversold < 30)
- SMA (9): ${latestSma9 !== null ? `$${latestSma9}` : "N/A"}
- SMA (21): ${latestSma21 !== null ? `$${latestSma21}` : "N/A"}
- SMA Cross: ${latestSma9 && latestSma21 ? (latestSma9 > latestSma21 ? "Bullish (9 > 21)" : "Bearish (9 < 21)") : "N/A"}
- MACD Line: ${latestMacd !== null ? latestMacd : "N/A"}
- MACD Signal: ${latestMacdSignal !== null ? latestMacdSignal : "N/A"}
- MACD Histogram: ${latestMacdHist !== null ? latestMacdHist.toFixed(4) : "N/A"}
- Awesome Oscillator (AO): ${latestAo !== null ? latestAo.toFixed(4) : "N/A"} (Prev: ${prevAo !== null ? prevAo.toFixed(4) : "N/A"})
  * Note: Peaks in Awesome Oscillator often designate Wave 3. Divergences in AO peaks designate Wave 5.

--- FIBONACCI RETRACEMENT LEVELS (50-Candle Lookback) ---
- Range High: $${fib.high || "N/A"}
- Range Low: $${fib.low || "N/A"}
- 23.6% Retracement: $${fib.level236 || "N/A"}
- 38.2% Retracement: $${fib.level382 || "N/A"} (Key Wave 4 Target)
- 50.0% Retracement: $${fib.level500 || "N/A"} (Key Wave 2 Target)
- 61.8% Retracement: $${fib.level618 || "N/A"} (Key Wave 2 Target)

--- PORTFOLIO STATE ---
- Available Cash: $${cash.toFixed(2)} USD
- Current ${assetName} Holdings: ${position.amount}
- Average Entry Price: $${position.avgEntryPrice.toFixed(4)} USD
- Current Value of Holdings: $${(position.amount * currentPrice).toFixed(2)} USD
- Total Portfolio Value: $${(cash + position.amount * currentPrice).toFixed(2)} USD

--- RECENT PERFORMANCE JOURNAL ---
${marketData.performanceJournal || "No recent trade history available."}

--- RECENT CANDLE HISTORY (Last 10 intervals) ---
${candleSummary}
`;

  // Append BTC Macro and Order Book Imbalance Context if available
  let btcAndOrderBookContext = "";
  if (marketData.btcContext || marketData.orderBook) {
    btcAndOrderBookContext += "\n=== CROSS-ASSET CORRELATION & LIQUIDITY DEPTH ===\n";
    
    if (marketData.btcContext) {
      const btc = marketData.btcContext;
      btcAndOrderBookContext += `--- Bitcoin (BTC) Macro Trend ---\n`;
      btcAndOrderBookContext += `- BTC Price: ${btc.price !== null && btc.price !== undefined ? `$${btc.price}` : "N/A"}\n`;
      btcAndOrderBookContext += `- BTC Daily RSI: ${btc.rsi !== null && btc.rsi !== undefined ? btc.rsi : "N/A"}\n`;
      btcAndOrderBookContext += `- BTC Daily SMA Cross: ${btc.smaCross || "N/A"}\n`;
      btcAndOrderBookContext += `- BTC Trend Status: ${btc.trend || "N/A"}\n`;
    }
    
    if (marketData.orderBook) {
      const ob = marketData.orderBook;
      btcAndOrderBookContext += `--- Order Book Liquidity Imbalance (${settings.selectedAsset}) ---\n`;
      btcAndOrderBookContext += `- Bid/Ask Volume Ratio (Obi): ${ob.imbalanceRatio !== null && ob.imbalanceRatio !== undefined ? ob.imbalanceRatio : "N/A"}\n`;
      btcAndOrderBookContext += `- Whale Wall Status: ${ob.wallStatus || "N/A"}\n`;
      btcAndOrderBookContext += `  *(Obi > 1.5 indicates heavy buying support / BUY_WALL_SUPPORT; Obi < 0.6 indicates heavy selling resistance / SELL_WALL_RESISTANCE)*\n`;
    }
    btcAndOrderBookContext += "\n";
  }
  marketContext += btcAndOrderBookContext;

  let sentimentContext = "";
  if (settings.newsSentimentEnabled && marketData.news && marketData.news.length > 0) {
    const newsSummary = marketData.news.map((item, idx) => 
      `${idx + 1}. Title: ${item.title}\n   Summary: ${item.body}\n   Category: ${item.categories || 'Crypto'}`
    ).join("\n\n");
    
    sentimentContext = `
=== GLOBAL CRYPTO SENTIMENT NEWS ===
Use the following headlines to assess overall market mood (fear, greed, optimism, panic):
${newsSummary}

Evaluate if these news catalysts align with your wave count or suggest an imminent breakout/breakdown.
`;
  }
  marketContext += sentimentContext;

  let mtfInstruction = "";
  if (macroContext) {
    mtfInstruction = `
=== MULTI-TIMEFRAME ANALYSIS INSTRUCTIONS ===
You are executing a TOP-DOWN trading strategy.
1. First, analyze the MACRO TREND CONTEXT (${macroContext.timeframe} Chart) to identify the major market cycle. Check if the daily chart is bottoming out on an A-B-C correction (e.g. near the 61.8% Fibonacci retracement) or running in an impulsive Wave 3/5.
2. Second, check the MICRO EXECUTION CONTEXT (${settings.selectedTimeframe} Chart) to verify short-term momentum. 
3. Rules of Alignment:
   * Do NOT buy if the micro-trend is in a steep downward slide (bearish SMA cross or falling MACD), even if the macro chart looks like a bottom. Wait for the micro chart to show stabilization or a bullish crossover to confirm the turn.
   * Only trigger a BUY or SELL when the micro momentum aligns with the macro direction.
`;
  }

  // Load and compile modular strategy guidelines
  const userDataPath = process.env.AETHER_USER_DATA_PATH;
  let stratInstructions = "";
  if (settings.enabledStrategies && settings.enabledStrategies.length > 0) {
    stratInstructions += "\n=== ACTIVE STRATEGY GUIDELINES ===\n";
    for (const f of settings.enabledStrategies) {
      const stratPath = userDataPath ? path.join(userDataPath, 'strategies', f) : path.join(__dirname, 'strategies', f);
      if (fs.existsSync(stratPath)) {
        const stratContent = fs.readFileSync(stratPath, 'utf8');
        stratInstructions += `\n--- Guideline: ${f.replace('.md', '')} ---\n${stratContent}\n`;
      }
    }
  }

  // Load user-defined persistent strategy rules
  let customRulesInstruction = "";
  try {
    const dbPath = userDataPath ? path.join(userDataPath, 'db.json') : path.join(__dirname, 'db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      if (db.customTradingRules && db.customTradingRules.length > 0) {
        customRulesInstruction += "\n=== PERSISTENT STRATEGY TRAINING RULES ===\n";
        customRulesInstruction += "You MUST strictly adhere to the following custom strategy rules taught to you by your human trading partner:\n";
        db.customTradingRules.forEach((rule, idx) => {
          customRulesInstruction += `${idx + 1}. ${rule}\n`;
        });
        customRulesInstruction += "\n";
      }
    }
  } catch (err) {
    console.error("Failed to load custom trading rules for prompt context:", err.message);
  }

  // Load dynamic strategy rules from Obsidian Vault
  let obsidianStrategyRules = "";
  if (settings.obsidianVaultPath) {
    const activeObsidianStrat = readActiveObsidianStrategy(settings.obsidianVaultPath);
    if (activeObsidianStrat) {
      obsidianStrategyRules = `\n=== DYNAMIC OBSIDIAN STRATEGY RULES (ERA ACTIVE) ===\n${activeObsidianStrat}\n`;
    }
  }

  // Load historical memory query from Obsidian Vault (RAG)
  let obsidianMemoryContext = "";
  if (settings.obsidianVaultPath) {
    obsidianMemoryContext = queryHistoricalStates(settings.obsidianVaultPath, marketRegime, latestRsi);
  }

  // Load empirically verified hypotheses from Obsidian Vault
  let obsidianHypothesesContext = "";
  if (settings.obsidianVaultPath) {
    const { readActiveHypotheses } = require('./hypothesisEngine');
    obsidianHypothesesContext = readActiveHypotheses(settings.obsidianVaultPath);
  }

  // Load and evaluate sizing formula from db.json if available
  let mathSizingRecommendation = null;
  try {
    const dbPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      if (db.settings && db.settings.activeSizingFormula) {
        const { runFormulaInSandbox } = require('./sizingSandbox');
        const metrics = {
          rsi: latestRsi,
          adx: currentADX,
          plusDI: currentPlusDI,
          minusDI: currentMinusDI,
          rvol: currentRVol,
          close: currentPrice
        };
        const recommendedSize = runFormulaInSandbox(db.settings.activeSizingFormula, metrics);
        mathSizingRecommendation = Math.max(0, Math.min(100, recommendedSize));
      }
    }
  } catch (err) {
    console.error("Failed to execute active sizing formula for prompt context:", err.message);
  }

  const strategistSystemInstruction = `You are a master algorithmic cryptocurrency trader specializing in Elliott Wave Theory, Fibonacci Retracements, and momentum analysis. Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`;

  const strategistPrompt = `
=== STRATEGY PROMPT RULES & GUIDELINES ===
${settings.customPrompt}

${stratInstructions}
${customRulesInstruction}
${obsidianStrategyRules}
${obsidianHypothesesContext}
${obsidianMemoryContext}

=== 3D COGNITIVE THINKING SPACE ===
You must process and structure your analysis inside a 3-Dimensional Cognitive Space, rather than standard linear thinking:
- Axis X: Structural/EWT & Memory Space (evaluate the macro cycle, Elliott wave count, Fibonacci retracements, and performance history to locate where we are in structural coordinate space).
- Axis Y: Quantitative/Momentum Space (evaluate micro technical indicators, SMA crossovers, RSI overbought/oversold, ADX trend regimes, MACD hist, RVol, and Awesome Oscillator to locate velocity and direction).
- Axis Z: Risk/Consensus Space (evaluate invalidation points, isolated futures leverage, isolated margin ratios, size allocation caps, and adversarial consensus critiques to locate trade validity).

Your output "reasoning" MUST begin with a clearly structured "[3D COGNITIVE CO-ORDINATES]" mapping detailing the coordinates of this trade on Axis X, Axis Y, and Axis Z.

=== MANDATORY HEURISTIC GUIDELINES ===
1. **Chain-of-Thought Decision Heuristics**:
   You MUST evaluate the following heuristics step-by-step inside your "reasoning" output:
   - Structural Maturity (Elliott Wave/EWT Map): Where are we in the macro structure? Is this a high-probability swing accumulation floor (like Wave 2, 4, or corrective ABC bottom)?
   - Momentum Confirmation (Indicators Radar): Do micro indicators (RSI, MACD, SMA crossover, AO, RVol) confirm the structural turn?
   - External Dynamics (BTC & Order Book): How hostile is the macro environment? Weigh the BTC trend and immediate sell/buy walls.
   - Historical Precedent (Obsidian Memory): Review matching past outcomes and takeaways to avoid repeating errors.

2. **Heuristic Trade Sizing (Opportunity vs. Risk Weighting)**:
   You have the autonomy to recommend any position size 'amount_pct', but you must scale it dynamically based on your confidence across the heuristics:
   - Clear bull market alignment (Bullish EWT + Bullish indicators + Bullish BTC + no sell walls): Scale sizing up (up to 75%-100% cap).
   - Choppy or consolidating markets (ADX < 20): Cap sizing to <= 30%.
   - Bearish BTC trend or Overbought BTC RSI (>75) represents systemic drag. Do not block trades completely; instead, scale size down (e.g. cut by 50% to 10%-20% size) and tighten stop-loss invalidation thresholds.
   - Severe sell-side order book walls (Obi < 0.6 or "SELL_WALL_RESISTANCE") represent high overhead supply. Scale size down (to <=30%) unless XRP is showing clear decoupling (low correlation and very high volume breakout).

${mtfInstruction}

${marketContext}

INSTRUCTIONS FOR RETURNING EXTRA JSON SCHEMA FIELDS:
1. "market_structure": Analyze the chart and describe the current Elliott Wave or chart pattern context (e.g., "Wave 3 Impulse starting", "Wave C bottoming", "Consolidation floor", "Wave 5 overextended").
2. "support_level": Calculate the nearest key price floor based on recent candle history or Fibonacci levels.
3. "resistance_level": Calculate the nearest key price ceiling based on recent candle history or Fibonacci levels.
4. "news_sentiment_score": Grade the news headlines you read on a scale from -10 (extremely bearish/panic) to +10 (extremely bullish/optimism). If news sentiment is disabled, return 0.
5. "risk_reward_ratio": Estimate the risk-to-reward ratio for this asset context (e.g., 2.5).
6. "forward_plan": Write a conversational, detailed summary of your forward trading strategy and outlook for this asset (e.g., "I'm holding for now, but I see a prime Wave C correction bottom forming around $0.52. I plan to schedule a buy entry there, and set a target exit at $0.65 which is our Wave 3 resistance."). Speak directly as a professional employee/partner explaining the plan to the user.
7. "proposed_conditional_orders": An optional array of virtual target orders representing your multi-legged trading strategy. Propose entry (BUY/SHORT), target (SELL/COVER), and stop invalidation (SELL/COVER) targets simultaneously so the bot can track and execute multiple moves over time. Each object requires "action" ("BUY"/"SELL"/"SHORT"/"COVER"), "amount_pct" (1-100), "trigger_type" ("price_below"/"price_above"), "trigger_value" (number price), and "reasoning" (brief sentence explaining this leg of the plan).

Remember: Output ONLY valid raw JSON matching the required schema. Do not include markdown codeblocks or extra text.
`;

  const resolverSchema = {
    type: "OBJECT",
    properties: {
      decision: { type: "STRING", enum: ["BUY", "SELL", "HOLD", "SHORT", "COVER"] },
      reasoning: { type: "STRING" },
      confidence: { type: "NUMBER" },
      amount_pct: { type: "INTEGER" },
      market_structure: { type: "STRING" },
      support_level: { type: "NUMBER" },
      resistance_level: { type: "NUMBER" },
      news_sentiment_score: { type: "INTEGER" },
      risk_reward_ratio: { type: "NUMBER" },
      forward_plan: { type: "STRING" },
      proposed_conditional_orders: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            action: { type: "STRING", enum: ["BUY", "SELL", "SHORT", "COVER"] },
            amount_pct: { type: "INTEGER" },
            trigger_type: { type: "STRING", enum: ["price_below", "price_above"] },
            trigger_value: { type: "NUMBER" },
            reasoning: { type: "STRING" }
          },
          required: ["action", "amount_pct", "trigger_type", "trigger_value", "reasoning"]
        }
      }
    },
    required: [
      "decision", "reasoning", "confidence", "amount_pct", 
      "market_structure", "support_level", "resistance_level", 
      "news_sentiment_score", "risk_reward_ratio", "forward_plan", 
      "proposed_conditional_orders"
    ]
  };

  const auditorSchema = {
    type: "OBJECT",
    properties: {
      critique_summary: { type: "STRING" },
      dimension_x_critique: { type: "STRING" },
      dimension_y_critique: { type: "STRING" },
      dimension_z_critique: { type: "STRING" },
      suggested_action_override: { type: "STRING", enum: ["HOLD", "REDUCE_SIZE", "CONFIRM_AS_IS", "REVERSE_DIRECTION"] },
      suggested_amount_pct: { type: "INTEGER" },
      auditor_confidence: { type: "NUMBER" }
    },
    required: [
      "critique_summary", "dimension_x_critique", "dimension_y_critique", 
      "dimension_z_critique", "suggested_action_override", 
      "suggested_amount_pct", "auditor_confidence"
    ]
  };

  let decisionObj = null;
  let wargameResult = null;

  if (settings.dualLlmEnabled) {
    if (logCallback) logCallback("Executing Multi-Desk Wargaming simulation...", "info");
    const { runWargamingSimulation } = require('./wargame');
    wargameResult = await runWargamingSimulation(activeApiKey, marketData, portfolio, settings, logCallback, queryModelWithFallback);
    
    // Construct decisionObj from Wave Theorist to maintain compatibility with downstream logging/structure
    decisionObj = {
      decision: wargameResult.waveDesk.proposed_action,
      amount_pct: Math.round(wargameResult.waveDesk.confidence * 100),
      confidence: wargameResult.waveDesk.confidence,
      reasoning: `[Wave Theorist Summary] ${wargameResult.waveDesk.summary} (Targets: ${wargameResult.waveDesk.target_levels})`,
      market_structure: wargameResult.waveDesk.summary,
      support_level: currentPrice * 0.95,
      resistance_level: currentPrice * 1.05,
      news_sentiment_score: 0,
      risk_reward_ratio: 2.0,
      forward_plan: `Wargame debate concluded. Scenarios projected: ${wargameResult.scenarios.map(s => `${s.scenario} (${s.probability_pct}%)`).join(", ")}`,
      proposed_conditional_orders: []
    };
  } else {
    // Run normal single-LLM strategist
    if (logCallback) logCallback("Executing Strategist analysis cycle...", "info");
    const strategistModel = settings.activeLlmModel || "gemini-2.5-flash";
    let strategistRaw = await queryModelWithFallback(
      provider,
      strategistModel,
      activeApiKey,
      strategistSystemInstruction,
      strategistPrompt,
      resolverSchema,
      settings,
      logCallback
    );

    const stratJsonMatch = strategistRaw.match(/\{[\s\S]*\}/);
    if (stratJsonMatch) strategistRaw = stratJsonMatch[0];
    decisionObj = JSON.parse(strategistRaw);

    // Normalize strategistDecision fields
    if (!["BUY", "SELL", "HOLD", "SHORT", "COVER"].includes(decisionObj.decision)) {
      decisionObj.decision = "HOLD";
    }
    decisionObj.confidence = Math.max(0, Math.min(1, Number(decisionObj.confidence) || 0));
    decisionObj.amount_pct = Math.max(1, Math.min(100, Number(decisionObj.amount_pct) || 10));
    decisionObj.market_structure = String(decisionObj.market_structure || "N/A");
    decisionObj.support_level = Number(decisionObj.support_level) || 0;
    decisionObj.resistance_level = Number(decisionObj.resistance_level) || 0;
    decisionObj.news_sentiment_score = Math.max(-10, Math.min(10, Number(decisionObj.news_sentiment_score) || 0));
    decisionObj.risk_reward_ratio = Number(decisionObj.risk_reward_ratio) || 0;
    decisionObj.forward_plan = String(decisionObj.forward_plan || "");
    decisionObj.proposed_conditional_orders = Array.isArray(decisionObj.proposed_conditional_orders)
      ? decisionObj.proposed_conditional_orders
      : [];

    const hasConditionalOrders = decisionObj.proposed_conditional_orders.length > 0;
    if (!settings.dualLlmEnabled && decisionObj.decision === "HOLD" && !hasConditionalOrders) {
      if (logCallback) {
        logCallback("Strategist resolved to HOLD with no target orders. Skipping Dual-LLM Audit.", "info");
      }
      try {
        saveStateToObsidian(settings, marketData, decisionObj);
      } catch (e) {
        console.error("Error writing Obsidian state node:", e.message);
      }
      return decisionObj;
    }
  }

  // --- DUAL-LLM consensus debate engine ---
  if (logCallback) {
    logCallback(`[STRATEGIST] Proposed Action: ${decisionObj.decision} | Sizing: ${decisionObj.amount_pct}% | Confidence: ${(decisionObj.confidence * 100).toFixed(0)}%`, "info");
  }

  // 2. Query the Risk Auditor
  const auditorModel = settings.auditorModel || "gemini-2.5-flash";
  const auditorSystemInstruction = wargameResult 
    ? `You are Aether's Risk Auditor and Lead Critic. Your job is to act as a cynical, skeptical short seller and risk auditor. You must cross-examine the Wargaming Scenarios & Debate projections and highlight every possible reason why these projections could fail, including wave count invalidation, trend weakness, volume discrepancies, leverage/margin risks, and sizing errors. Think in the 3D Cognitive Space:
- Axis X: Structural flaws, incorrect wave counts, or ignored resistance/support.
- Axis Y: Divergences in momentum, weak volume support, or conflicting indicators.
- Axis Z: Sizing concerns, liquidation proximity, and rule violations.

You MUST evaluate and enforce the following Heuristic Sizing modifiers:
1. BTC Macro Trend: If BTC's daily trend is BEARISH, SMA cross is Bearish, or Daily RSI is overbought (>75), object to large sizes (recommend REDUCE_SIZE to 10%-20% or HOLD) due to systemic drag.
2. Whale Wall Resistance: If Obi < 0.6 or Wall Status is "SELL_WALL_RESISTANCE", recommend REDUCE_SIZE (capping at <=30% size) or HOLD, unless the Strategist has presented a high-volume, low-correlation XRP decoupling thesis.
3. Historical Lessons: Review past RAG memories. If the projected structure matches a past trade failure, recommend HOLD or size reduction.

Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`
    : `You are Aether's Risk Auditor and Lead Critic. Your job is to act as a cynical, skeptical short seller and risk auditor. You must cross-examine the Strategist's trading proposal and highlight every possible reason why this trade could fail, including wave count invalidation, trend weakness, volume discrepancies, leverage/margin risks, and sizing errors. Think in the 3D Cognitive Space:
- Axis X: Structural flaws, incorrect wave counts, or ignored resistance/support.
- Axis Y: Divergences in momentum, weak volume support, or conflicting indicators.
- Axis Z: Sizing concerns, liquidation proximity, and rule violations.

You MUST evaluate and enforce the following Heuristic Sizing modifiers:
1. BTC Macro Trend: If BTC's daily trend is BEARISH, SMA cross is Bearish, or Daily RSI is overbought (>75), object to large sizes (recommend REDUCE_SIZE to 10%-20% or HOLD) due to systemic drag.
2. Whale Wall Resistance: If Obi < 0.6 or Wall Status is "SELL_WALL_RESISTANCE", recommend REDUCE_SIZE (capping at <=30% size) or HOLD, unless the Strategist has presented a high-volume, low-correlation XRP decoupling thesis.
3. Historical Lessons: Review past RAG memories. If the Strategist proposes a trade structure that matches a past trade failure, recommend HOLD or size reduction.

Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`;

  const auditorPrompt = wargameResult
    ? `
=== WARGAMING SCENARIOS & DEBATE ===
${wargameResult.transcript}

=== CURRENT MARKET & PORTFOLIO STATE ===
${marketContext}

=== PERSISTENT STRATEGY RULES ===
${customRulesInstruction}
${obsidianStrategyRules}
${obsidianHypothesesContext}

Analyze the wargaming scenarios and debate projections skeptically. Highlight risks in each scenario path. Output a JSON object with the following fields:
1. "critique_summary": "High-level summary of risks"
2. "dimension_x_critique": "Critique of wave/structural projections"
3. "dimension_y_critique": "Critique of flow/momentum projections"
4. "dimension_z_critique": "Critique of risk, sizing, and safety"
5. "suggested_action_override": "HOLD", "REDUCE_SIZE", "CONFIRM_AS_IS", or "REVERSE_DIRECTION"
6. "suggested_amount_pct": integer between 0 and 100
7. "auditor_confidence": float between 0.0 and 1.0

Remember: Respond ONLY with a valid raw JSON object matching the schema. No markdown codeblocks.
`
    : `
=== STRATEGIST PROPOSAL ===
${JSON.stringify(decisionObj, null, 2)}

=== CURRENT MARKET & PORTFOLIO STATE ===
${marketContext}

=== PERSISTENT STRATEGY RULES ===
${customRulesInstruction}
${obsidianStrategyRules}
${obsidianHypothesesContext}

Analyze the strategist's proposal skeptically. Output a JSON object with the following fields:
1. "critique_summary": "High-level summary of risks"
2. "dimension_x_critique": "Critique of structural/EWT pattern"
3. "dimension_y_critique": "Critique of indicators/momentum"
4. "dimension_z_critique": "Critique of leverage, size, and safety"
5. "suggested_action_override": "HOLD", "REDUCE_SIZE", "CONFIRM_AS_IS", or "REVERSE_DIRECTION"
6. "suggested_amount_pct": integer between 0 and 100
7. "auditor_confidence": float between 0.0 and 1.0

Remember: Respond ONLY with a valid raw JSON object matching the schema. No markdown codeblocks.
`;

  if (logCallback) logCallback(`[AUDITOR] Auditing proposed trade with model ${auditorModel}...`, "info");

  let auditorRaw = await queryModelWithFallback(
    provider,
    auditorModel,
    activeApiKey,
    auditorSystemInstruction,
    auditorPrompt,
    auditorSchema,
    settings,
    logCallback
  );

  const auditorJsonMatch = auditorRaw.match(/\{[\s\S]*\}/);
  if (auditorJsonMatch) auditorRaw = auditorJsonMatch[0];
  const auditorCritique = JSON.parse(auditorRaw);

  if (logCallback) {
    logCallback(`[AUDITOR] Override recommendation: ${auditorCritique.suggested_action_override} | Suggested Size: ${auditorCritique.suggested_amount_pct}% | Critique: "${auditorCritique.critique_summary}"`, "info");
  }

  const boardroomWeights = settings.boardroomWeights || {
    wave_theorist: 1.0,
    order_flow_scalper: 1.0,
    macro_economist: 1.0,
    margin_cop: 1.0,
    on_chain_detective: 1.0,
    cross_asset_tracker: 1.0,
    risk_range_quant: 1.0,
    fomo_miner: 1.0
  };

  const weightsStr = `
=== ACTIVE BOARDROOM VOTING WEIGHTS ===
- Wave Theorist (EWT): Weight ${boardroomWeights.wave_theorist.toFixed(2)}
- Order Flow Scalper: Weight ${boardroomWeights.order_flow_scalper.toFixed(2)}
- Macro Sentiment Economist: Weight ${boardroomWeights.macro_economist.toFixed(2)}
- Margin Cop: Weight ${boardroomWeights.margin_cop.toFixed(2)}
- On-Chain Detective: Weight ${boardroomWeights.on_chain_detective.toFixed(2)}
- Cross-Asset Tracker: Weight ${boardroomWeights.cross_asset_tracker.toFixed(2)}
- Volatility Quant: Weight ${boardroomWeights.risk_range_quant.toFixed(2)}
- FOMO Miner: Weight ${boardroomWeights.fomo_miner.toFixed(2)}
`;

  // 3. Query the Debate Resolver
  const resolverModel = settings.activeLlmModel || "gemini-2.5-pro";
  const resolverSystemInstruction = wargameResult
    ? `You are Aether's Debate Resolver and Consensus Arbiter. Your job is to review the Wargaming Scenarios & Debate projections and the Risk Auditor's skeptical critique, resolve any conflicts, verify compliance with all custom trading rules, and determine the final trading action. Think in the 3D Cognitive Space:
- Axis X: Reconcile structural patterns and Elliott Wave counts.
- Axis Y: Reconcile indicator momentum and volume validation.
- Axis Z: Determine final safe positioning, size allocations (must not exceed max allocation caps), and invalidation triggers.

You MUST evaluate the desks' wargaming recommendations in alignment with their active Voting Weights. Desks with higher weights represent proven predictive accuracy in the current market regime and should carry more influence in your final consensus, whereas desks with lower weights should be given less sway.

You MUST enforce the following Heuristic Sizing modifiers in your final consensus:
1. BTC Macro Trend Drag: If BTC's daily trend is BEARISH, SMA cross is Bearish, or Daily RSI is overbought (>75), scale down the final trade size (e.g. cut by 50% to a 10%-20% range) and tighten stops, rather than blocking the trade completely, unless you agree there is a clear decoupling breakout.
2. Whale Wall Resistance: If Obi < 0.6 or Wall Status is "SELL_WALL_RESISTANCE", cap the final trade size to <=30% to mitigate liquidity friction, unless the Strategist's decoupling thesis is validated by low correlation and high volume.
3. Historical Lesson Reconciliation: Cross-reference past outcomes and takeaways to ensure we don't repeat historical trading errors.

Explain how you reconciled the opportunity vs. risk factors along Axis X (Structure), Axis Y (Momentum), and Axis Z (Risk) inside your reasoning.
Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`
    : `You are Aether's Debate Resolver and Consensus Arbiter. Your job is to review the Strategist's trading proposal and the Risk Auditor's skeptical critique, resolve any conflicts, verify compliance with all custom trading rules, and determine the final trading action. Think in the 3D Cognitive Space:
- Axis X: Reconcile structural patterns and Elliott Wave counts.
- Axis Y: Reconcile indicator momentum and volume validation.
- Axis Z: Determine final safe positioning, size allocations (must not exceed max allocation caps), and invalidation triggers.

You MUST enforce the following Heuristic Sizing modifiers in your final consensus:
1. BTC Macro Trend Drag: If BTC's daily trend is BEARISH, SMA cross is Bearish, or Daily RSI is overbought (>75), scale down the final trade size (e.g. cut by 50% to a 10%-20% range) and tighten stops, rather than blocking the trade completely, unless you agree there is a clear decoupling breakout.
2. Whale Wall Resistance: If Obi < 0.6 or Wall Status is "SELL_WALL_RESISTANCE", cap the final trade size to <=30% to mitigate liquidity friction, unless the Strategist's decoupling thesis is validated by low correlation and high volume.
3. Historical Lesson Reconciliation: Cross-reference past outcomes and takeaways to ensure we don't repeat historical trading errors.

Explain how you reconciled the opportunity vs. risk factors along Axis X (Structure), Axis Y (Momentum), and Axis Z (Risk) inside your reasoning.
Respond ONLY with a valid raw JSON object matching the required schema. Do not include markdown codeblocks or extra text.`;

  const resolverPrompt = wargameResult
    ? `
=== WARGAMING SCENARIOS & DEBATE ===
${wargameResult.transcript}

${weightsStr}

=== RISK AUDITOR CRITIQUE ===
${JSON.stringify(auditorCritique, null, 2)}

=== CURRENT MARKET & PORTFOLIO STATE ===
${marketContext}

=== PERSISTENT STRATEGY RULES ===
${customRulesInstruction}
${obsidianStrategyRules}
${obsidianHypothesesContext}

${mathSizingRecommendation !== null ? `=== SANDBOX OPTIMIZED SIZING RECOMMENDATION ===\nRecommended position size based on backtested sizing formula: ${mathSizingRecommendation}%\nYou must adhere to this recommendation for your final 'amount_pct' sizing decision along Axis Z unless you document a strong structural EWT breakout reason.\n` : ""}

Reconcile the debate. Output the final, resolved decision in JSON format matching the main schema:
{
  "decision": "BUY" | "SELL" | "HOLD" | "SHORT" | "COVER",
  "reasoning": "A paragraph explaining the final decision. Detail the consensus reached. Explain how the wargaming scenarios and the Auditor's arguments were reconciled along the 3D axes: Axis X (Structure), Axis Y (Momentum), and Axis Z (Risk).",
  "confidence": float,
  "amount_pct": integer,
  "market_structure": "string",
  "support_level": number,
  "resistance_level": number,
  "news_sentiment_score": integer,
  "risk_reward_ratio": number,
  "forward_plan": "A conversational forward-looking strategy note",
  "proposed_conditional_orders": [...]
}

Remember: Output ONLY valid raw JSON matching the required schema. No markdown codeblocks.
`
    : `
=== STRATEGIST PROPOSAL ===
${JSON.stringify(decisionObj, null, 2)}

=== RISK AUDITOR CRITIQUE ===
${JSON.stringify(auditorCritique, null, 2)}

=== CURRENT MARKET & PORTFOLIO STATE ===
${marketContext}

=== PERSISTENT STRATEGY RULES ===
${customRulesInstruction}
${obsidianStrategyRules}
${obsidianHypothesesContext}

${mathSizingRecommendation !== null ? `=== SANDBOX OPTIMIZED SIZING RECOMMENDATION ===\nRecommended position size based on backtested sizing formula: ${mathSizingRecommendation}%\nYou must adhere to this recommendation for your final 'amount_pct' sizing decision along Axis Z unless you document a strong structural EWT breakout reason.\n` : ""}

Reconcile the debate. Output the final, resolved decision in JSON format matching the main schema:
{
  "decision": "BUY" | "SELL" | "HOLD" | "SHORT" | "COVER",
  "reasoning": "A paragraph explaining the final decision. Detail the consensus reached. Explain how the Strategist's and Auditor's arguments were reconciled along the 3D axes: Axis X (Structure), Axis Y (Momentum), and Axis Z (Risk).",
  "confidence": float,
  "amount_pct": integer,
  "market_structure": "string",
  "support_level": number,
  "resistance_level": number,
  "news_sentiment_score": integer,
  "risk_reward_ratio": number,
  "forward_plan": "A conversational forward-looking strategy note",
  "proposed_conditional_orders": [...]
}

Remember: Output ONLY valid raw JSON matching the required schema. No markdown codeblocks.
`;

  if (logCallback) logCallback("Reconciling strategist and auditor perspectives for final consensus...", "info");

  let resolverRaw = await queryModelWithFallback(
    provider,
    resolverModel,
    activeApiKey,
    resolverSystemInstruction,
    resolverPrompt,
    resolverSchema,
    settings,
    logCallback
  );

  const resolverJsonMatch = resolverRaw.match(/\{[\s\S]*\}/);
  if (resolverJsonMatch) resolverRaw = resolverJsonMatch[0];
  const finalDecision = JSON.parse(resolverRaw);

  // Normalize final decision fields
  if (!["BUY", "SELL", "HOLD", "SHORT", "COVER"].includes(finalDecision.decision)) {
    finalDecision.decision = "HOLD";
  }
  finalDecision.confidence = Math.max(0, Math.min(1, Number(finalDecision.confidence) || 0));
  finalDecision.amount_pct = Math.max(1, Math.min(100, Number(finalDecision.amount_pct) || 10));
  finalDecision.market_structure = String(finalDecision.market_structure || "N/A");
  finalDecision.support_level = Number(finalDecision.support_level) || 0;
  finalDecision.resistance_level = Number(finalDecision.resistance_level) || 0;
  finalDecision.news_sentiment_score = Math.max(-10, Math.min(10, Number(finalDecision.news_sentiment_score) || 0));
  finalDecision.risk_reward_ratio = Number(finalDecision.risk_reward_ratio) || 0;
  finalDecision.forward_plan = String(finalDecision.forward_plan || "");
  finalDecision.proposed_conditional_orders = Array.isArray(finalDecision.proposed_conditional_orders)
    ? finalDecision.proposed_conditional_orders
    : [];

  if (logCallback) {
    logCallback(`[CONSENSUS] Final Decision: ${finalDecision.decision} | Sizing: ${finalDecision.amount_pct}% | Reasoning: "${finalDecision.reasoning}"`, "info");
  }

  let stateTimestamp = null;
  try {
    saveDebateToObsidianAndDiscord(settings, currentPrice, decisionObj, auditorCritique, finalDecision);
    stateTimestamp = saveStateToObsidian(settings, marketData, finalDecision);
  } catch (e) {
    console.error("Error writing Obsidian logs:", e.message);
  }

  finalDecision.stateTimestamp = stateTimestamp;
  finalDecision.wargameResult = wargameResult; // attach wargame history for reward engine
  return finalDecision;
}

/**
 * Helper to save state node to Obsidian vault
 */
function saveStateToObsidian(settings, marketData, decisionObj) {
  if (!settings.obsidianVaultPath) return;
  const { ticker, indicators } = marketData;
  const currentPrice = ticker ? ticker.close : 0;
  
  // Extract indicator values safely
  const latestAo = indicators && indicators.ao ? indicators.ao[indicators.ao.length - 1] : null;
  const latestRsi = indicators && indicators.rsi ? indicators.rsi[indicators.rsi.length - 1] : null;
  const latestSma9 = indicators && indicators.sma9 ? indicators.sma9[indicators.sma9.length - 1] : null;
  const latestSma21 = indicators && indicators.sma21 ? indicators.sma21[indicators.sma21.length - 1] : null;
  const currentADX = indicators && indicators.currentADX !== undefined ? indicators.currentADX : (indicators && indicators.adx ? indicators.adx.adx[indicators.adx.adx.length - 1] : null);
  const currentRVol = indicators && indicators.currentRVol !== undefined ? indicators.currentRVol : (indicators && indicators.rvol ? indicators.rvol[indicators.rvol.length - 1] : null);
  const marketRegime = (indicators && indicators.marketRegime) || "UNKNOWN";
  const fib = (indicators && indicators.fib) || {};

  const stateData = {
    symbol: settings.selectedAsset,
    price: currentPrice,
    primary_indicators: {
      ao: latestAo,
      wave: decisionObj.market_structure || 'N/A',
      fib: fib.level382 || 'N/A',
      sma9: latestSma9,
      sma21: latestSma21
    },
    secondary_indicators: {
      rsi: latestRsi,
      macd: indicators && indicators.macd && indicators.macd.histogram ? (indicators.macd.histogram[indicators.macd.histogram.length - 1] >= 0 ? "BULLISH" : "BEARISH") : "N/A",
      rvol: currentRVol,
      adx: currentADX,
      market_regime: marketRegime
    },
    btc_context: marketData.btcContext || { price: null, rsi: null, smaCross: "UNKNOWN", trend: "UNKNOWN" },
    order_book: marketData.orderBook || { imbalanceRatio: null, wallStatus: "UNKNOWN" }
  };

  const timestamp = new Date().toISOString();
  writeStateNode(settings.obsidianVaultPath, timestamp, stateData, decisionObj.reasoning);
  return timestamp;
}

/**
 * Helper to save debate logs to Obsidian vault and post to Discord
 */
function saveDebateToObsidianAndDiscord(settings, currentPrice, decisionObj, auditorCritique, finalDecision) {
  if (settings.obsidianVaultPath) {
    const debateData = {
      symbol: settings.selectedAsset,
      currentPrice: currentPrice,
      finalDecision: finalDecision.decision,
      transcript: [
        { role: 'trader', text: `Proposed: ${decisionObj.decision} (Size: ${decisionObj.amount_pct}%, Confidence: ${decisionObj.confidence}) - Reasoning: ${decisionObj.reasoning}` },
        { role: 'critic', text: `Suggested: ${auditorCritique.suggested_action_override} (Size: ${auditorCritique.suggested_amount_pct}%, Confidence: ${auditorCritique.auditor_confidence}) - Critique: ${auditorCritique.critique_summary}\n\n- Critique X (Structure): ${auditorCritique.dimension_x_critique}\n- Critique Y (Momentum): ${auditorCritique.dimension_y_critique}\n- Critique Z (Risk): ${auditorCritique.dimension_z_critique}` }
      ]
    };
    writeDebateLog(settings.obsidianVaultPath, new Date().toISOString(), debateData);
  }

  if (settings.discordDebateWebhookUrl) {
    try {
      const { sendDiscordWebhook } = require('./notifications');
      const debateMsg = `🧠 **AETHER DEBATE CONSENSUS RESOLUTION**\n\n` +
        `🔴 **Trader Proposal**: **${decisionObj.decision}** (Size: ${decisionObj.amount_pct}%, Conf: ${(decisionObj.confidence * 100).toFixed(0)}%)\n` +
        `*Reasoning*: "${decisionObj.reasoning.substring(0, 400)}${decisionObj.reasoning.length > 400 ? '...' : ''}"\n\n` +
        `🔵 **Auditor Critique**: **${auditorCritique.suggested_action_override}** (Size: ${auditorCritique.suggested_amount_pct}%, Conf: ${(auditorCritique.auditor_confidence * 100).toFixed(0)}%)\n` +
        `*Critique*: "${auditorCritique.critique_summary}"\n\n` +
        `🟢 **Consensus Decision**: **${finalDecision.decision}** (Size: ${finalDecision.amount_pct}%)\n` +
        `*Consensus Reasoning*: "${finalDecision.reasoning.substring(0, 800)}${finalDecision.reasoning.length > 800 ? '...' : ''}"`;
      
      sendDiscordWebhook(settings.discordDebateWebhookUrl, debateMsg).catch(e => console.error("Error sending debate webhook:", e.message));
    } catch (err) {
      console.error("Failed to require notifications or send debate webhook:", err.message);
    }
  }
}

/**
 * Ask Gemini a natural language question about the market/portfolio
 * @param {string} apiKey - Gemini API Key
 * @param {string} question - The user's question
 * @param {object} marketData - Current market indicators and price context
 * @param {object} portfolio - Current portfolio balances and positions
 * @param {object} settings - Bot settings
 * @returns {Promise<string>} The textual response from Gemini
 */
async function askBrainQuestion(apiKey, question, marketData, portfolio, settings) {
  const provider = settings.activeLlmProvider || "gemini";
  let activeApiKey = apiKey;
  if (provider === "openai") {
    activeApiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
  } else if (provider === "claude") {
    activeApiKey = settings.claudeApiKey || process.env.CLAUDE_API_KEY;
  } else {
    activeApiKey = settings.geminiApiKey || apiKey || process.env.GEMINI_API_KEY;
  }
  
  if (!activeApiKey) {
    throw new Error("API Key is missing. Please configure it in Settings.");
  }

  const { ticker, indicators, macroContext } = marketData;
  const currentPrice = ticker.close;
  const assetName = settings.selectedAsset.split("/")[0];
  const cash = portfolio.balanceUSD;
  const position = portfolio.positions[assetName] || { amount: 0, avgEntryPrice: 0 };

  const latestRsi = indicators.rsi[indicators.rsi.length - 1];
  const latestSma9 = indicators.sma9[indicators.sma9.length - 1];
  const latestSma21 = indicators.sma21[indicators.sma21.length - 1];
  const latestAo = indicators.ao ? indicators.ao[indicators.ao.length - 1] : null;

  let marketContext = `
=== CURRENT BOT MARKET & PORTFOLIO STATE ===
- Asset: ${settings.selectedAsset}
- Current Price: $${currentPrice}
- SMA(9): ${latestSma9 !== null ? `$${latestSma9}` : "N/A"} | SMA(21): ${latestSma21 !== null ? `$${latestSma21}` : "N/A"}
- RSI(14): ${latestRsi !== null ? latestRsi.toFixed(2) : "N/A"}
- Awesome Oscillator (AO): ${latestAo !== null ? latestAo.toFixed(4) : "N/A"}
- Portfolio USD Cash: $${cash.toFixed(2)}
- Current Position: ${position.amount} ${assetName} (Avg Entry: $${position.avgEntryPrice.toFixed(2)})
`;

  if (macroContext) {
    const macroIndicators = macroContext.indicators;
    const macroRsi = macroIndicators.rsi[macroIndicators.rsi.length - 1];
    const macroSma9 = macroIndicators.sma9[macroIndicators.sma9.length - 1];
    const macroSma21 = macroIndicators.sma21[macroIndicators.sma21.length - 1];
    const macroAo = macroIndicators.ao ? macroIndicators.ao[macroIndicators.ao.length - 1] : null;
    
    marketContext += `
=== MACRO TREND CONTEXT (${macroContext.timeframe} Chart) ===
- SMA (9): ${macroSma9 !== null ? `$${macroSma9}` : "N/A"}
- SMA (21): ${macroSma21 !== null ? `$${macroSma21}` : "N/A"}
- RSI (14): ${macroRsi !== null ? macroRsi.toFixed(2) : "N/A"}
- Awesome Oscillator (AO): ${macroAo !== null ? macroAo.toFixed(4) : "N/A"}
`;
  }

  const promptText = `
You are Aether AI, the advanced trading intelligence bot managing this user's cryptocurrency portfolio.
The user has messaged you with the following question/request in their Telegram private chat:
"${question}"

Provide a professional, clear, and context-aware answer. Make reference to the current market data and portfolio state if relevant to their question. If they ask for advice (e.g. "is it wise to buy more?"), give a balanced risk-conscious assessment based on the indicators, but remember to disclaim that this is AI analysis and not official financial advice.

Current Market/Portfolio Context:
${marketContext}

Write your response directly as natural text. Keep it under 250 words and friendly, formatted with bold tags or bullet points where appropriate (Telegram HTML format friendly, e.g. <b>bold</b>, <i>italic</i>). Do not include markdown headers or codeblocks.
`;

  if (provider === "openai") {
    const res = await queryOpenAiChat(settings.activeLlmModel || "gpt-4o", activeApiKey, "You are Aether AI, the advanced trading intelligence bot.", [{ role: "user", content: promptText }], []);
    return res.text;
  } else if (provider === "claude") {
    const res = await queryClaudeChat(settings.activeLlmModel || "claude-3-5-sonnet-latest", activeApiKey, "You are Aether AI, the advanced trading intelligence bot.", [{ role: "user", content: promptText }], []);
    return res.text;
  }

  // Gemini fallback
  const candidateModels = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash"];
  let responseText = "";

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeApiKey}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      if (response.ok) {
        const resJson = await response.json();
        responseText = resJson.candidates[0].content.parts[0].text.trim();
        break;
      }
    } catch (err) {
      console.warn(`Model ${model} failed for question answering:`, err.message);
    }
  }

  if (!responseText) {
    throw new Error("Unable to contact Gemini to answer your question.");
  }

  return responseText;
}

// Built-in system tools list
const systemTools = [
  {
    name: "get_market_context",
    description: "Fetch real-time price, SMA/RSI/ADX indicators, classified market regime, Elliott Wave lookback values, and recent candles for the currently selected asset/timeframe in Aether.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(args, context) {
      const { marketData, settings } = context;
      if (!marketData || !marketData.ticker) {
        return "Market data is currently unavailable. Try again in a few seconds.";
      }
      const asset = settings.selectedAsset;
      const price = marketData.ticker.close;
      const regime = marketData.indicators?.marketRegime || "UNKNOWN";
      const rsi = marketData.indicators?.rsi ? marketData.indicators.rsi[marketData.indicators.rsi.length - 1] : "N/A";
      const sma9 = marketData.indicators?.sma9 ? marketData.indicators.sma9[marketData.indicators.sma9.length - 1] : "N/A";
      const sma21 = marketData.indicators?.sma21 ? marketData.indicators.sma21[marketData.indicators.sma21.length - 1] : "N/A";
      const rvol = marketData.indicators?.currentRVol || "N/A";
      const adx = marketData.indicators?.currentADX || "N/A";
      
      return JSON.stringify({
        asset,
        currentPrice: price,
        timeframe: settings.selectedTimeframe,
        marketRegime: regime,
        rsi: typeof rsi === 'number' ? rsi.toFixed(2) : rsi,
        sma9,
        sma21,
        relativeVolume: typeof rvol === 'number' ? rvol.toFixed(2) : rvol,
        adx: typeof adx === 'number' ? adx.toFixed(2) : adx,
        performanceJournal: marketData.performanceJournal || "No recent history."
      }, null, 2);
    }
  },
  {
    name: "get_portfolio_status",
    description: "Fetch current Aether cash balances and active coin positions.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(args, context) {
      const { portfolio, settings } = context;
      if (!portfolio) {
        return "Portfolio data unavailable.";
      }
      return JSON.stringify({
        mode: settings.tradingMode, // "paper" or "live"
        balanceUSD: portfolio.balanceUSD,
        positions: portfolio.positions || {}
      }, null, 2);
    }
  },
  {
    name: "execute_trade",
    description: "Place a simulated paper trade or real live Coinbase trade. In live mode, only set 'user_has_approved' to true if the user has explicitly given you permission or confirmed to execute this trade in the chat history.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["BUY", "SELL"], description: "The trading action to execute." },
        amount_pct: { type: "integer", minimum: 1, maximum: 100, description: "The percentage of available cash or asset holdings to allocate." },
        user_has_approved: { type: "boolean", description: "Set to true only if the user has explicitly confirmed or given permission to execute this specific trade in the recent chat history." }
      },
      required: ["action", "amount_pct", "user_has_approved"]
    },
    async execute(args, context) {
      const { action, amount_pct, user_has_approved } = args;
      const { settings } = context;
      
      if (settings.tradingMode === 'live' && !user_has_approved) {
        return JSON.stringify({
          status: "AWAITING_CONFIRMATION",
          message: `I have prepared a LIVE Coinbase Advanced trade order to ${action} ${amount_pct}% of the portfolio asset. Do you give me permission to execute this trade?`
        });
      }

      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/trade/manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            amountPct: amount_pct,
            symbol: settings.selectedAsset
          })
        });
        const tradeRes = await res.json();
        if (tradeRes.success) {
          return JSON.stringify({
            status: "SUCCESS",
            message: `Successfully executed manual ${action} order for ${amount_pct}% allocation.`,
            trade: tradeRes.trade
          }, null, 2);
        } else {
          return JSON.stringify({
            status: "FAILED",
            message: `Trade execution failed: ${tradeRes.message}`
          }, null, 2);
        }
      } catch (err) {
        return JSON.stringify({
          status: "ERROR",
          message: `Failed to connect to Aether's trading server: ${err.message}`
        }, null, 2);
      }
    }
  },
  {
    name: "schedule_conditional_order",
    description: "Schedule a future limit/conditional order to BUY or SELL an asset when a specific trigger condition (price_below, price_above, or time) is met. Price checks run in real-time (every 30 seconds).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["BUY", "SELL"], description: "The trading action to execute." },
        amount_pct: { type: "integer", minimum: 1, maximum: 100, description: "The percentage allocation for the trade." },
        trigger_type: { type: "string", enum: ["price_below", "price_above", "time"], description: "The condition type: price drops below, price rises above, or a timeframe is reached." },
        trigger_value: { type: "number", description: "The target trigger price (e.g. 1.18) or duration in minutes from now if type is time." },
        symbol: { type: "string", description: "Optional. The target symbol (e.g. XRP/USDC). Defaults to currently selected asset." },
        execution_type: { type: "string", enum: ["exchange", "virtual"], description: "Use 'exchange' to place a direct limit order on Coinbase (locks funds). Use 'virtual' for background tracking by Aether (no locked funds)." }
      },
      required: ["action", "amount_pct", "trigger_type", "trigger_value"]
    },
    async execute(args, context) {
      const { action, amount_pct, trigger_type, trigger_value, symbol, execution_type } = args;
      const { settings } = context;
      
      const targetSymbol = symbol || settings.selectedAsset;
      const triggerTime = trigger_type === 'time' ? Date.now() + (trigger_value * 60 * 1000) : trigger_value;
      const typeOfExecution = execution_type || 'virtual';
      
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/conditional-orders/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: targetSymbol,
            action,
            amountPct: amount_pct,
            triggerType: trigger_type,
            triggerValue: triggerTime,
            executionType: typeOfExecution,
            reasoning: `Scheduled via chat conversation.`
          })
        });
        const orderRes = await res.json();
        return JSON.stringify(orderRes, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect to Aether's trading server: ${err.message}` }, null, 2);
      }
    }
  },
  {
    name: "get_scheduled_orders",
    description: "Fetch all active scheduled conditional/limit orders currently waiting to trigger.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(args, context) {
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/conditional-orders/list`);
        const orders = await res.json();
        return JSON.stringify(orders, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect: ${err.message}` }, null, 2);
      }
    }
  },
  {
    name: "cancel_scheduled_order",
    description: "Cancel a pending scheduled conditional/limit order by its ID.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The unique ID of the scheduled order to cancel." }
      },
      required: ["order_id"]
    },
    async execute(args, context) {
      const { order_id } = args;
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/conditional-orders/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order_id })
        });
        const cancelRes = await res.json();
        return JSON.stringify(cancelRes, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect: ${err.message}` }, null, 2);
      }
    }
  },
  {
    name: "add_custom_trading_rule",
    description: "Teach Aether a persistent strategy rule or guideline. The bot will strictly remember and follow this rule in future trades and analysis until deleted.",
    parameters: {
      type: "object",
      properties: {
        rule_description: { type: "string", description: "The strategy rule to remember (e.g. 'Never trade XRP if 6h RSI is above 60')." }
      },
      required: ["rule_description"]
    },
    async execute(args, context) {
      const { rule_description } = args;
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/custom-rules/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: rule_description })
        });
        const ruleRes = await res.json();
        return JSON.stringify(ruleRes, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect: ${err.message}` }, null, 2);
      }
    }
  },
  {
    name: "get_custom_trading_rules",
    description: "Fetch the list of all persistent strategy rules currently taught to Aether.",
    parameters: {
      type: "object",
      properties: {}
    },
    async execute(args, context) {
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/custom-rules/list`);
        const rules = await res.json();
        return JSON.stringify(rules, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect: ${err.message}` }, null, 2);
      }
    }
  },
  {
    name: "delete_custom_trading_rule",
    description: "Delete a persistent strategy rule by its index number.",
    parameters: {
      type: "object",
      properties: {
        index: { type: "integer", description: "The index number of the rule to delete (starting at 1)." }
      },
      required: ["index"]
    },
    async execute(args, context) {
      const { index } = args;
      try {
        const port = process.env.PORT || 5000;
        const res = await fetch(`http://localhost:${port}/api/custom-rules/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: index - 1 })
        });
        const ruleRes = await res.json();
        return JSON.stringify(ruleRes, null, 2);
      } catch (err) {
        return JSON.stringify({ status: "ERROR", message: `Failed to connect: ${err.message}` }, null, 2);
      }
    }
  }
];

// Helper to execute custom tools in a Node VM sandbox
async function executeCustomTool(fileName, args) {
  const userDataPath = process.env.AETHER_USER_DATA_PATH;
  const toolsDir = userDataPath ? path.join(userDataPath, 'tools') : path.join(__dirname, 'tools');
  const filePath = path.join(toolsDir, fileName);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tool script file ${fileName} not found.`);
  }

  const code = fs.readFileSync(filePath, 'utf8');

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: {
      log: (...msg) => console.log(`[Tool Sandbox Log: ${fileName}]`, ...msg),
      error: (...msg) => console.error(`[Tool Sandbox Error: ${fileName}]`, ...msg)
    },
    fetch: global.fetch || fetch,
    setTimeout,
    clearTimeout,
    Promise,
    Buffer,
    JSON,
    Math,
    Date,
    URL,
    URLSearchParams
  };

  const context = vm.createContext(sandbox);
  const script = new vm.Script(code);
  script.runInContext(context, { timeout: 3000 }); // 3 second script timeout limit

  const tool = sandbox.module.exports;
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error(`Tool script ${fileName} does not export an execute function.`);
  }

  const result = await tool.execute(args);
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

// Conversation completion loop supporting tools
async function runAIChatCompletion(options) {
  const { provider, model, apiKey, messages, enabledTools, enabledStrategies, marketData, portfolio, settings, trades } = options;
  const toolExecutionLogs = [];

  // Load strategy guidelines
  const userDataPath = process.env.AETHER_USER_DATA_PATH;
  let systemInstruction = `You are Aether AI, an advanced, lifelike trading partner, dedicated analyst, and strategic partner executing trades and plans for the user. You are not a passive, robotic assistant; you are a sharp, conversational, and intuitive employee-partner who does the heavy lifting, makes complex multi-move forward plans, and actively works to grow the portfolio.

Tone and Style Guidelines:
1. **Conversational & Lifelike**: Speak naturally, fluidly, and dynamically. Avoid dry, bulleted lists or wiki-like formatting unless specifically asked for a structured report. Write like a real, experienced trader chatting on Discord or Telegram.
2. **Dedicated Strategist & Risk Challenger**: Talk to the user as a peer, teammate, and strategist. DO NOT be a yes-man. If the user questions your plans, do not back down immediately. Defend your logic mathematically (referencing Awesome Oscillator peaks, RSI, SMA cross, Fibonacci retracements, or Relative Volume) and "talk it out" with the user. However, if the user reasons through it and insists on a different direction or manual override, cooperate fully and implement their override.
3. **First-Person Perspective**: Speak in the first person ("I checked the market...", "I'm looking at...", "I can execute that trade for you", "I have scheduled our plan"). Do not say "As an AI..." or "Based on my algorithms...".
4. **Autonomous Driver**: Make the user feel like you are actively managing the portfolio. Present complex, multi-legged plans with multiple moves over time (e.g., scale-in entry targets, take-profit exits, stop-loss support invalidation triggers) rather than narrow, single orders.
5. **Tool Integration & Consent**: You can execute actions (like checking price, indicators, balance, scheduling orders, or placing trades) using your built-in tools. Always explain what you did and the results in a human, conversational way.
   - When executing trades in live mode, you require explicit user permission. If the user gives you verbal/text permission (e.g. "go ahead", "do it", "yes execute the trade"), set "user_has_approved" to true in your "execute_trade" tool call. If they have not approved it yet, set it to false.
6. **Built-in Tools**: When referring to your capabilities, call them "built-in tools" or "actions". Do not refer to them as "default_api" or "default_api functions".
7. **Formatting**: Write your final responses in standard Markdown (e.g. use **bold**, *italic*, list bullet points, and \`code\` formatting). Avoid writing raw HTML tags (like <b>, <i>, <code>, or <pre>) directly in your responses.
  `;

  // Inject recent trades context to keep Aether AI aware of actual actions
  if (trades && Array.isArray(trades) && trades.length > 0) {
    systemInstruction += `\n=== RECENT COMPLETED TRADES ===\n`;
    // Show the last 5 trades to give rich context
    const recent = trades.slice(0, 5);
    recent.forEach((t, idx) => {
      systemInstruction += `- [${t.timestamp}] ${t.action} ${t.amount.toFixed(6)} ${t.symbol} at $${t.price.toFixed(4)} (Mode: ${t.mode || 'unknown'})\n  Reasoning/Trigger: ${t.reasoning || 'No details recorded.'}\n`;
    });
    systemInstruction += `\n`;
  }

  if (enabledStrategies && enabledStrategies.length > 0) {
    systemInstruction += `\n=== ACTIVE STRATEGY GUIDELINES ===\n`;
    for (const f of enabledStrategies) {
      const stratPath = userDataPath ? path.join(userDataPath, 'strategies', f) : path.join(__dirname, 'strategies', f);
      if (fs.existsSync(stratPath)) {
        const stratContent = fs.readFileSync(stratPath, 'utf8');
        systemInstruction += `\n--- Guideline: ${f.replace('.md', '')} ---\n${stratContent}\n`;
      }
    }
  }

  // Inject user-defined strategy training rules
  try {
    const dbPath = userDataPath ? path.join(userDataPath, 'db.json') : path.join(__dirname, 'db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      if (db.customTradingRules && db.customTradingRules.length > 0) {
        systemInstruction += `\n=== PERSISTENT STRATEGY TRAINING RULES ===\n`;
        systemInstruction += `You MUST strictly follow and reference these custom rules defined by the user during your conversations:\n`;
        db.customTradingRules.forEach((rule, idx) => {
          systemInstruction += `${idx + 1}. ${rule}\n`;
        });
        systemInstruction += `\n`;
      }
    }
  } catch (err) {
    console.error("Failed to load custom rules for chat context:", err.message);
  }

  // Load custom tools metadata
  const customToolsList = [];
  const toolsDir = userDataPath ? path.join(userDataPath, 'tools') : path.join(__dirname, 'tools');
  for (const f of enabledTools) {
    const filePath = path.join(toolsDir, f);
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const sandbox = { module: { exports: {} }, exports: {} };
        const context = vm.createContext(sandbox);
        const script = new vm.Script(fileContent);
        script.runInContext(context, { timeout: 1000 });
        const tool = sandbox.module.exports;
        customToolsList.push({
          filename: f,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || { type: "object", properties: {} },
          execute: async (args) => executeCustomTool(f, args)
        });
      } catch (err) {
        console.error(`Failed to load tool ${f} for chat completion:`, err.message);
      }
    }
  }

  // Combine system tools and custom tools
  const allTools = [...systemTools, ...customToolsList];

  // We loop up to 5 times to handle multi-turn function calls
  let currentMessages = [...messages];
  let finalResponseText = "";
  
  for (let loopCount = 0; loopCount < 5; loopCount++) {
    // Call active provider
    let llmResponse = null;
    if (provider === "openai") {
      llmResponse = await queryOpenAiChat(model || "gpt-4o", apiKey, systemInstruction, currentMessages, allTools);
    } else if (provider === "claude") {
      llmResponse = await queryClaudeChat(model || "claude-3-5-sonnet-latest", apiKey, systemInstruction, currentMessages, allTools);
    } else {
      llmResponse = await queryGeminiChat(model || "gemini-2.5-flash", apiKey, systemInstruction, currentMessages, allTools);
    }

    if (llmResponse.text) {
      finalResponseText = llmResponse.text;
    }

    if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
      // No more tool calls, return text response
      break;
    }

    // Execute tool calls
    const toolMessagesToAppend = [];
    
    // assistantMessage must be appended first
    if (llmResponse.assistantMessage) {
      currentMessages.push(llmResponse.assistantMessage);
    }

    for (const toolCall of llmResponse.toolCalls) {
      const matchedTool = allTools.find(t => t.name === toolCall.name);
      let output = "";
      if (matchedTool) {
        toolExecutionLogs.push({ name: toolCall.name, args: toolCall.args });
        try {
          const context = { marketData, portfolio, settings, messages: currentMessages };
          output = await matchedTool.execute(toolCall.args, context);
        } catch (err) {
          output = `Error executing tool '${toolCall.name}': ${err.message}`;
        }
      } else {
        output = `Tool '${toolCall.name}' is not registered or enabled.`;
      }

      // Format tool response for the provider message list
      if (provider === "openai") {
        toolMessagesToAppend.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: output
        });
      } else if (provider === "claude") {
        toolMessagesToAppend.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: output
            }
          ]
        });
      } else {
        // Gemini
        toolMessagesToAppend.push({
          role: "function",
          parts: [{
            functionResponse: {
              name: toolCall.name,
              response: { result: output }
            }
          }]
        });
      }
    }

    currentMessages.push(...toolMessagesToAppend);
  }

  return {
    response: finalResponseText || "No response generated.",
    toolLogs: toolExecutionLogs
  };
}

async function queryOpenAiChat(model, apiKey, systemInstruction, messages, tools) {
  const url = "https://api.openai.com/v1/chat/completions";
  const formattedMessages = [];
  if (systemInstruction) {
    formattedMessages.push({ role: "system", content: systemInstruction });
  }
  for (const m of messages) {
    formattedMessages.push({
      role: m.role,
      content: m.content || "",
      name: m.name,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls
    });
  }

  const payload = {
    model: model,
    messages: formattedMessages
  };

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Chat API Error (${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  const choice = resJson.choices[0];
  const responseMessage = choice.message;
  
  const toolCalls = [];
  if (responseMessage.tool_calls) {
    for (const tc of responseMessage.tool_calls) {
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || "{}")
      });
    }
  }

  return {
    text: responseMessage.content || "",
    toolCalls,
    assistantMessage: responseMessage
  };
}

async function queryClaudeChat(model, apiKey, systemInstruction, messages, tools) {
  const url = "https://api.anthropic.com/v1/messages";
  
  const formattedMessages = messages.map(m => {
    if (m.role === "user" && Array.isArray(m.content)) {
      return { role: "user", content: m.content };
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    if (m.tool_calls && m.tool_calls.length > 0) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args
        });
      }
      return { role: "assistant", content };
    }
    return { role, content: m.content || "" };
  });

  const payload = {
    model: model,
    max_tokens: 4000,
    system: systemInstruction,
    messages: formattedMessages
  };

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }));
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude Chat API Error (${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  let text = "";
  const toolCalls = [];
  const contentArray = resJson.content || [];
  
  for (const block of contentArray) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input || {}
      });
    }
  }

  const assistantMessage = {
    role: "assistant",
    tool_calls: toolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
    content: text
  };

  return {
    text,
    toolCalls,
    assistantMessage
  };
}

async function queryGeminiChat(model, apiKey, systemInstruction, messages, tools) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const formattedContents = messages.map(m => {
    let role = m.role === "assistant" ? "model" : "user";
    if (m.role === "function") role = "function";
    
    let parts = [];
    if (m.role === "function") {
      parts = m.parts;
    } else if (m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.args
          }
        });
      }
    } else {
      parts = [{ text: m.content || "" }];
    }
    
    return { role, parts };
  });

  const payload = {
    contents: formattedContents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    }
  };

  if (tools && tools.length > 0) {
    payload.tools = [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }];
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Chat API Error (${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  if (!resJson.candidates || resJson.candidates.length === 0) {
    throw new Error("No response candidates returned from Gemini chat.");
  }
  
  const content = resJson.candidates[0].content;
  const parts = content.parts || [];
  let text = "";
  const toolCalls = [];
  
  for (const part of parts) {
    if (part.text) {
      text += part.text;
    } else if (part.functionCall) {
      toolCalls.push({
        id: part.functionCall.name, // Gemini does not have unique tool call IDs; reuse function name
        name: part.functionCall.name,
        args: part.functionCall.args || {}
      });
    }
  }

  const assistantMessage = {
    role: "assistant",
    tool_calls: toolCalls.map(tc => ({ id: tc.id, name: tc.name, args: tc.args })),
    content: text
  };

  return {
    text,
    toolCalls,
    assistantMessage
  };
}

/**
 * Read dynamic strategy rules from Obsidian Vault
 */
function readActiveObsidianStrategy(vaultPath) {
  if (!vaultPath) return "";
  try {
    const filePath = path.join(vaultPath, 'Beliefs', 'Strategy-Era-Active.md');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error("Error reading Strategy-Era-Active.md:", err.message);
  }
  return "";
}

/**
 * Query historical states matching current regime or indicators (local RAG)
 */
function queryHistoricalStates(vaultPath, currentRegime, currentRsiVal) {
  if (!vaultPath) return "";
  try {
    const statesDir = path.join(vaultPath, 'States');
    if (!fs.existsSync(statesDir)) return "";

    const files = fs.readdirSync(statesDir).filter(f => f.startsWith('State_') && f.endsWith('.md'));
    if (files.length === 0) return "";

    // Sort files descending (most recent first)
    files.sort((a, b) => b.localeCompare(a));

    const matches = [];
    const maxMatches = 3;

    // Classify current RSI range
    let currentRsiLabel = "NEUTRAL";
    if (currentRsiVal !== null && currentRsiVal < 30) currentRsiLabel = "OVERSOLD";
    if (currentRsiVal !== null && currentRsiVal > 70) currentRsiLabel = "OVERBOUGHT";

    for (const file of files) {
      if (matches.length >= maxMatches) break;

      const filePath = path.join(statesDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Fast frontmatter parsing
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch) continue;

      const fmText = fmMatch[1];
      
      const regimeRegex = /market_regime:\s*"(.*?)"/;
      const rsiRegex = /rsi:\s*(\d+(\.\d+)?)/;
      const outcomeRegex = /outcome:\s*"(.*?)"/;
      const takeawayRegex = /takeaway:\s*"(.*?)"/;

      const regMatch = fmText.match(regimeRegex);
      const rsiMatch = fmText.match(rsiRegex);
      const outMatch = fmText.match(outcomeRegex);
      const takeMatch = fmText.match(takeawayRegex);

      const stateRegime = regMatch ? regMatch[1] : null;
      const stateRsiVal = rsiMatch ? parseFloat(rsiMatch[1]) : null;
      const stateOutcome = outMatch ? outMatch[1] : null;
      const stateTakeaway = takeMatch ? takeMatch[1] : null;

      let stateRsiLabel = "NEUTRAL";
      if (stateRsiVal !== null && stateRsiVal < 30) stateRsiLabel = "OVERSOLD";
      if (stateRsiVal !== null && stateRsiVal > 70) stateRsiLabel = "OVERBOUGHT";

      // If we match the regime, or we match an extreme RSI state, and it has a resolved outcome
      if ((stateRegime === currentRegime || (currentRsiLabel !== "NEUTRAL" && stateRsiLabel === currentRsiLabel)) && stateOutcome) {
        // Extract the narrative/reasoning (the text in the ```text block)
        const narrativeMatch = content.match(/```text\r?\n([\s\S]*?)\r?\n```/);
        const narrative = narrativeMatch ? narrativeMatch[1].trim() : "";

        matches.push({
          file: file,
          regime: stateRegime,
          rsi: stateRsiVal,
          outcome: stateOutcome,
          takeaway: stateTakeaway,
          narrative: narrative
        });
      }
    }

    if (matches.length === 0) return "";

    let summary = "\n=== HISTORICAL GRAPH BRAIN MEMORIES (RAG) ===\n";
    summary += "Here are the outcomes of historical states matching our current market regime or indicators:\n\n";
    matches.forEach((m, idx) => {
      summary += `${idx + 1}. Note: [[States/${m.file.replace('.md', '')}]]\n`;
      summary += `   - Market Regime: ${m.regime}\n`;
      summary += `   - RSI: ${m.rsi || 'N/A'}\n`;
      summary += `   - Historical Outcome: ${m.outcome}\n`;
      if (m.takeaway) {
        summary += `   - Post-Mortem Lesson: "${m.takeaway}"\n`;
      }
      summary += `   - Historical Brain Reasoning: "${m.narrative.substring(0, 1500)}${m.narrative.length > 1500 ? '...' : ''}"\n\n`;
    });
    summary += "Adhere to the lessons of these outcomes to avoid repeating past failures or to replicate past successes.\n";
    return summary;
  } catch (err) {
    console.error("Error querying historical states:", err.message);
  }
  return "";
}

/**
 * Generates a concise (1-sentence) cognitive lesson from a completed trade's outcome.
 */
async function generateTradePostMortem(apiKey, tradeData, settings) {
  try {
    const provider = settings.activeLlmProvider || 'gemini';
    const model = settings.activeLlmModel || 'gemini-2.5-flash';
    const systemInstruction = "You are Aether's Performance Auditor. Your job is to analyze a completed trade's parameters, entry reasoning, and final profit/loss outcome, and write a single, direct, 1-sentence lesson (takeaway) to improve future heuristic decisions. Avoid platitudes; be specific about wave counts, indicators, size, or macro conditions.";
    const userPrompt = `
Completed Trade Details:
- Action: ${tradeData.action} (Closed Position)
- Entry Price: $${tradeData.entryPrice}
- Exit Price: $${tradeData.exitPrice}
- PnL (%): ${tradeData.pnlPct}%
- Entry/Exit Reasoning: "${tradeData.reasoning}"

Write exactly 1 concise sentence (maximum 25 words) summarizing the key trading lesson from this outcome. Begin with "Lesson:". Do not use quotes or backticks around the sentence.
`;

    const result = await queryModel(provider, model, apiKey, systemInstruction, userPrompt, null, settings);
    return result.trim().replace(/^['"`]+|['"`]+$/g, '');
  } catch (err) {
    console.error("Error generating trade post-mortem:", err.message);
    return `Lesson: Manage position dynamically based on EWT invalidation thresholds (Failed to query LLM: ${err.message})`;
  }
}

module.exports = {
  getTradingDecision,
  askBrainQuestion,
  runAIChatCompletion,
  generateTradePostMortem,
  queryHistoricalStates,
  queryModelWithFallback,
  queryModel
};
