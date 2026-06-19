/**
 * LLM Decision Brain using Gemini API
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

  const promptText = `
=== STRATEGY PROMPT RULES & GUIDELINES ===
${settings.customPrompt}

${stratInstructions}
${customRulesInstruction}

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
6. "forward_plan": Write a conversational, detailed summary of your forward trading strategy and outlook for this asset (e.g., "I'm holding for now, but I see a prime Wave C correction bottom forming around $0.52. I plan to schedule a buy entry there, and set a target exit at $0.65 which is our Wave 3 resistance."). Speak directly as a professional employee/partner explaining the plan to the user.
7. "proposed_conditional_orders": An optional array of virtual target orders representing your multi-legged trading strategy. Propose entry (BUY), target (SELL), and stop invalidation (SELL) targets simultaneously so the bot can track and execute multiple moves over time. Each object requires "action" ("BUY"/"SELL"), "amount_pct" (1-100), "trigger_type" ("price_below"/"price_above"), "trigger_value" (number price), and "reasoning" (brief sentence explaining this leg of the plan).

Remember: Output ONLY valid raw JSON matching the required schema. Do not include markdown codeblocks or extra text.
`;

  let resultText = "";
  let lastError = null;

  if (provider === "openai") {
    try {
      resultText = await getOpenAiDecision(settings.activeLlmModel || "gpt-4o", activeApiKey, promptText);
    } catch (err) {
      lastError = err;
    }
  } else if (provider === "claude") {
    try {
      resultText = await getClaudeDecision(settings.activeLlmModel || "claude-3-5-sonnet-latest", activeApiKey, promptText);
    } catch (err) {
      lastError = err;
    }
  } else {
    // Gemini logic
    const selectedModel = settings.activeLlmModel || "gemini-2.5-flash";
    const candidateModels = Array.from(new Set(
      selectedModel.startsWith("gemini") 
        ? [selectedModel, "gemini-2.5-flash", "gemini-2.5-flash-lite"] 
        : ["gemini-2.5-flash", "gemini-2.5-flash-lite"]
    ));
    
    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeApiKey}`;
      let backoffMs = 1000;
      const attempts = 2; // Try each model up to 2 times

      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000); // 35-second timeout

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
                    },
                    forward_plan: {
                      type: "STRING"
                    },
                    proposed_conditional_orders: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          action: { type: "STRING", enum: ["BUY", "SELL"] },
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
                }
              }
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const resJson = await response.json();
            if (resJson.candidates && resJson.candidates.length > 0) {
              resultText = resJson.candidates[0].content.parts[0].text.trim();
              break;
            }
          }
          const errorText = await response.text();
          lastError = new Error(`Gemini API Error (${response.status}) for ${model}: ${errorText}`);
          if (logWarning) {
            logWarning(`Gemini API Error (${response.status}) for ${model} (attempt ${attempt}/${attempts}): ${errorText}`);
          }
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
        } catch (err) {
          lastError = err;
          if (logWarning) {
            logWarning(`Gemini model ${model} (attempt ${attempt}/${attempts}) failed: ${err.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
        }
      }
      if (resultText) break;
    }
  }

  if (!resultText) {
    throw lastError || new Error(`All candidate models for provider ${provider} failed to return a valid decision response.`);
  }

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
  decisionObj.forward_plan = String(decisionObj.forward_plan || "");
  decisionObj.proposed_conditional_orders = Array.isArray(decisionObj.proposed_conditional_orders)
    ? decisionObj.proposed_conditional_orders
    : [];

  return decisionObj;
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
7. **Telegram HTML Support**: IMPORTANT: Since the user communicates with you on Telegram as well, write your final responses in Telegram-friendly HTML (e.g., use <b>bold</b>, <i>italic</i>, and <code>code</code> blocks). Avoid using raw markdown symbols like **, *, or triple backticks.
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

module.exports = {
  getTradingDecision,
  askBrainQuestion,
  runAIChatCompletion
};
