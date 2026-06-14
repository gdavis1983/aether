/**
 * LLM Decision Brain using Gemini API
 */

/**
 * Ask Gemini for a trading decision
 * @param {string} apiKey - Gemini API Key
 * @param {object} marketData - Market data containing ticker, indicators, and recent candles
 * @param {object} portfolio - Current portfolio state (cash and positions)
 * @param {object} settings - Bot settings including custom prompt
 * @returns {Promise<object>} The parsed JSON response from Gemini
 */
async function getTradingDecision(apiKey, marketData, portfolio, settings, logWarning) {
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please configure it in Settings.");
  }

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

  const promptText = `
=== STRATEGY PROMPT RULES & GUIDELINES ===
${settings.customPrompt}

=== MANDATORY SYSTEM RULES ===
1. **Chain-of-Thought Decision Checklist**:
   You MUST evaluate the following checklist step-by-step inside your "reasoning" output:
   - Check Macro daily trend/regime alignment.
   - Verify the current Elliott Wave count.
   - Check if Relative Volume (RVol) validates the move.
   - Cross-examine the active ADX Market Regime.
   - Reflect on your Performance Memory Journal history (avoid repeating past entry/exit errors).
   - Calculate risk-to-reward ratio.
   
2. **Regime-Based Trade Sizing**:
   You MUST scale your "amount_pct" allocation according to the active Market Regime:
   - If marketRegime is "CHOPPY_RANGE" (ADX < 20), you are prohibited from setting amount_pct > 30%. You must make small, defensive trades.
   - If marketRegime is "TRENDING_BULLISH" and RVol > 1.5 (confirmed Wave 3 breakout), you are encouraged to scale up amount_pct to 75%-100% to maximize compounding.
   - In "TRENDING_BEARISH" regimes, your default action should be HOLD (remaining in cash) or SELL to liquidate remaining assets. Avoid buying.

${mtfInstruction}

${marketContext}

INSTRUCTIONS FOR RETURNING EXTRA JSON SCHEMA FIELDS:
1. "market_structure": Analyze the chart and describe the current Elliott Wave or chart pattern context (e.g., "Wave 3 Impulse starting", "Wave C bottoming", "Consolidation floor", "Wave 5 overextended").
2. "support_level": Calculate the nearest key price floor based on recent candle history or Fibonacci levels.
3. "resistance_level": Calculate the nearest key price ceiling based on recent candle history or Fibonacci levels.
4. "news_sentiment_score": Grade the news headlines you read on a scale from -10 (extremely bearish/panic) to +10 (extremely bullish/optimism). If news sentiment is disabled, return 0.
5. "risk_reward_ratio": Estimate the risk-to-reward ratio for this asset context (e.g., 2.5).

Remember: Output ONLY valid raw JSON matching the required schema. Do not include markdown codeblocks or extra text.
`;

  // Try candidate models in order of current availability/reliability
  const candidateModels = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash"];
  let data = null;
  let lastError = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    let backoffMs = 1000;
    const attempts = 2; // Try each model up to 2 times

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second timeout

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: promptText
              }]
            }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  decision: {
                    type: "STRING",
                    enum: ["BUY", "SELL", "HOLD"]
                  },
                  reasoning: {
                    type: "STRING"
                  },
                  confidence: {
                    type: "NUMBER"
                  },
                  amount_pct: {
                    type: "INTEGER"
                  },
                  market_structure: {
                    type: "STRING"
                  },
                  support_level: {
                    type: "NUMBER"
                  },
                  resistance_level: {
                    type: "NUMBER"
                  },
                  news_sentiment_score: {
                    type: "INTEGER"
                  },
                  risk_reward_ratio: {
                    type: "NUMBER"
                  }
                },
                required: ["decision", "reasoning", "confidence", "amount_pct", "market_structure", "support_level", "resistance_level", "news_sentiment_score", "risk_reward_ratio"]
              }
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const resJson = await response.json();
          if (!resJson.candidates || resJson.candidates.length === 0) {
            throw new Error("No response candidates returned from Gemini.");
          }
          
          let resultText = resJson.candidates[0].content.parts[0].text.trim();
          
          // Extract the JSON object block (everything between first { and last })
          const jsonMatch = resultText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resultText = jsonMatch[0];
          }

          // Attempt to parse and validate the JSON output
          const decisionObj = JSON.parse(resultText);
          
          // Normalize and validate
          if (!["BUY", "SELL", "HOLD"].includes(decisionObj.decision)) {
            decisionObj.decision = "HOLD";
          }
          decisionObj.confidence = Math.max(0, Math.min(1, Number(decisionObj.confidence) || 0));
          decisionObj.amount_pct = Math.max(1, Math.min(100, Number(decisionObj.amount_pct) || 10));
          decisionObj.market_structure = String(decisionObj.market_structure || "N/A");
          decisionObj.support_level = Number(decisionObj.support_level) || 0;
          decisionObj.resistance_level = Number(decisionObj.resistance_level) || 0;
          decisionObj.news_sentiment_score = Math.max(-10, Math.min(10, Number(decisionObj.news_sentiment_score) || 0));
          decisionObj.risk_reward_ratio = Number(decisionObj.risk_reward_ratio) || 0;

          // Successfully obtained and validated decision object
          data = decisionObj;
          break;
        }

        const errorText = await response.text();
        const isRetryable = response.status === 429 || response.status === 503 || response.status === 500;
        
        lastError = new Error(`Gemini API Error (${response.status}) for ${model}: ${errorText}`);
        
        // If it's not a retryable error, break the retry loop and try the next model
        if (!isRetryable) {
          break;
        }

        const warningMsg = `Gemini API returned ${response.status} for ${model} (attempt ${attempt}/${attempts}). Retrying in ${backoffMs}ms...`;
        console.warn(`[WARNING] ${warningMsg}`);
        if (logWarning) {
          logWarning(warningMsg);
        }
        
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs *= 2;
      } catch (err) {
        lastError = err;
        const warningMsg = `Model ${model} (attempt ${attempt}/${attempts}) failed or returned invalid output: ${err.message}`;
        console.warn(`[WARNING] ${warningMsg}`);
        if (logWarning) {
          logWarning(warningMsg);
        }
        
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs *= 2;
      }
    }

    if (data) {
      break; // Successfully got valid data from this model
    } else {
      const fallbackMsg = `Model ${model} was unable to return a valid decision. Trying next fallback model...`;
      console.warn(`[WARNING] ${fallbackMsg}`);
      if (logWarning) {
        logWarning(fallbackMsg);
      }
    }
  }

  if (!data) {
    throw lastError || new Error("All Gemini candidate models failed to return a valid parseable response.");
  }

  return data;
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
  if (!apiKey) {
    throw new Error("Gemini API Key is missing.");
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

  const candidateModels = ["gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash"];
  let responseText = "";

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

module.exports = {
  getTradingDecision,
  askBrainQuestion
};
